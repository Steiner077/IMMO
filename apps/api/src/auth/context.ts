import type { FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_PERMISSIONS, ROLE_SCOPE, type Permission, type Role } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from './tokens.js';

export interface AuthUser {
  id: string;
  organizationId: string;
  role: Role;
  firstName: string;
  lastName: string;
  email: string;
  tenantId: string | null;
  serviceProviderId: string | null;
  permissions: readonly Permission[];
  /** null = Zugriff auf alle Immobilien der Organisation */
  propertyIds: string[] | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { propertyAccess: { select: { propertyId: true } } },
  });
  if (!user || !user.isActive) return null;
  const role = user.role as Role;
  const scope = ROLE_SCOPE[role];
  return {
    id: user.id,
    organizationId: user.organizationId,
    role,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    tenantId: user.tenantId,
    serviceProviderId: user.serviceProviderId,
    permissions: ROLE_PERMISSIONS[role],
    propertyIds: scope === 'ASSIGNED_PROPERTIES' ? user.propertyAccess.map((a) => a.propertyId) : scope === 'ORGANIZATION' ? null : [],
  };
}

/** Fastify-Hook: prüft das Access-Token und lädt den Benutzer inkl. Rechten. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Sitzung abgelaufen');
  }
  const user = await loadAuthUser(payload.sub);
  if (!user) throw unauthorized('Benutzer deaktiviert');
  req.user = user;
}

export function can(user: AuthUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

export function requirePermission(...permissions: Permission[]) {
  return async (req: FastifyRequest) => {
    for (const p of permissions) {
      if (!can(req.user, p)) throw forbidden();
    }
  };
}

/** Prisma-Filter für propertyId abhängig vom Scope des Benutzers. */
export function propertyIdFilter(user: AuthUser): { in: string[] } | undefined {
  return user.propertyIds === null ? undefined : { in: user.propertyIds };
}

export function assertPropertyAccess(user: AuthUser, propertyId: string | null | undefined) {
  if (user.propertyIds === null) return;
  if (!propertyId || !user.propertyIds.includes(propertyId)) throw forbidden('Kein Zugriff auf diese Immobilie');
}

export function isStaffUser(user: AuthUser) {
  return ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'EMPLOYEE', 'CARETAKER'].includes(user.role);
}

/**
 * Sicherer Immobilienfilter: Ein angefragter Filter darf den Scope nur
 * einschränken, nie erweitern. Wirft 403 bei nicht freigeschalteter Immobilie.
 */
export function scopedPropertyId(user: AuthUser, requested?: string | null): string | { in: string[] } | undefined {
  if (requested) {
    assertPropertyAccess(user, requested);
    return requested;
  }
  return propertyIdFilter(user);
}
