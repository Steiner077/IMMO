import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ROLES, ROLE_LABELS } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, parse } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requirePermission } from '../auth/context.js';
import { hashPassword, passwordPolicyError } from '../auth/password.js';
import { auditReq, diff } from '../services/audit.js';

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  tenantId: true,
  serviceProviderId: true,
  createdAt: true,
  propertyAccess: { select: { propertyId: true, property: { select: { name: true } } } },
} as const;

export function generateInitialPassword() {
  return randomBytes(9).toString('base64url') + '7a';
}

export async function userRoutes(app: FastifyInstance) {
  /** Kontaktliste für Nachrichten / Zuweisungen (ohne sensible Daten) */
  app.get('/directory', async (req) => {
    const q = parse(z.object({ role: z.string().optional() }), req.query);
    return prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        isActive: true,
        role: q.role ? { in: q.role.split(',') as never } : { notIn: ['TENANT'] },
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { lastName: 'asc' },
    });
  });

  app.get('/', { preHandler: requirePermission('user:manage') }, async (req) =>
    prisma.user.findMany({ where: { organizationId: req.user.organizationId }, select: userSelect, orderBy: [{ role: 'asc' }, { lastName: 'asc' }] }),
  );

  app.post('/', { preHandler: requirePermission('user:manage') }, async (req) => {
    const body = parse(
      z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().optional().nullable(),
        role: z.enum(ROLES),
        password: z.string().optional(),
        propertyIds: z.array(z.string()).default([]),
        tenantId: z.string().optional().nullable(),
        serviceProviderId: z.string().optional().nullable(),
      }),
      req.body,
    );
    if (body.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') throw forbidden('Nur Super Admins können Super Admins anlegen.');
    if (body.role === 'OWNER' && !['SUPER_ADMIN', 'OWNER'].includes(req.user.role)) throw forbidden('Nur Eigentümer können Eigentümer anlegen.');
    const password = body.password || generateInitialPassword();
    const policy = passwordPolicyError(password);
    if (policy) throw badRequest(policy);
    if (body.tenantId) {
      const t = await prisma.tenant.findFirst({ where: { id: body.tenantId, organizationId: req.user.organizationId } });
      if (!t) throw notFound('Mieter');
    }
    const user = await prisma.user.create({
      data: {
        organizationId: req.user.organizationId,
        email: body.email.toLowerCase(),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        role: body.role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        tenantId: body.role === 'TENANT' ? body.tenantId : null,
        serviceProviderId: body.role === 'SERVICE_PROVIDER' ? body.serviceProviderId : null,
        propertyAccess: { create: body.propertyIds.map((propertyId) => ({ propertyId })) },
      },
      select: userSelect,
    });
    await auditReq(req, { action: 'user.create', entityType: 'User', entityId: user.id, summary: `Benutzer ${user.email} (${ROLE_LABELS[body.role]}) angelegt`, newValues: { email: user.email, role: user.role } });
    return { user, initialPassword: body.password ? undefined : password };
  });

  app.patch('/:id', { preHandler: requirePermission('user:manage') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        phone: z.string().nullable().optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.boolean().optional(),
        propertyIds: z.array(z.string()).optional(),
      }),
      req.body,
    );
    const before = await prisma.user.findFirst({ where: { id, organizationId: req.user.organizationId }, include: { propertyAccess: true } });
    if (!before) throw notFound('Benutzer');
    if (id === req.user.id && (body.isActive === false || (body.role && body.role !== before.role))) throw badRequest('Eigene Rolle/Status kann nicht geändert werden.');
    if (body.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') throw forbidden();
    const { propertyIds, ...fields } = body;
    const updated = await prisma.$transaction(async (tx) => {
      if (propertyIds) {
        await tx.propertyAccess.deleteMany({ where: { userId: id } });
        const valid = await tx.property.findMany({ where: { id: { in: propertyIds }, organizationId: req.user.organizationId }, select: { id: true } });
        await tx.propertyAccess.createMany({ data: valid.map((p) => ({ userId: id, propertyId: p.id })) });
      }
      if (body.isActive === false) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.user.update({ where: { id }, data: fields, select: userSelect });
    });
    const d = diff(before as unknown as Record<string, unknown>, fields);
    await auditReq(req, {
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      summary: `Benutzer ${before.email} geändert`,
      oldValues: { ...d.oldValues, ...(propertyIds ? { propertyIds: before.propertyAccess.map((a) => a.propertyId) } : {}) },
      newValues: { ...d.newValues, ...(propertyIds ? { propertyIds } : {}) },
    });
    return updated;
  });

  app.post('/:id/reset-password', { preHandler: requirePermission('user:manage') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const user = await prisma.user.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!user) throw notFound('Benutzer');
    const password = generateInitialPassword();
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, lockedUntil: null, failedLoginCount: 0 } });
    await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await auditReq(req, { action: 'user.reset_password', entityType: 'User', entityId: id, summary: `Passwort für ${user.email} zurückgesetzt` });
    return { initialPassword: password };
  });
}
