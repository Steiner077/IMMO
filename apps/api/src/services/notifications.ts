import type { Role } from '@immo/shared';
import { prisma, type Db } from '../lib/prisma.js';

export interface NotifyInput {
  organizationId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Zentrale Benachrichtigungslogik. Kanäle wie E-Mail, SMS, Push oder
 * WhatsApp werden später als zusätzliche "Dispatcher" angeschlossen.
 */
export type Dispatcher = (userId: string, input: NotifyInput) => Promise<void>;
const dispatchers: Dispatcher[] = [];
export function registerDispatcher(d: Dispatcher) {
  dispatchers.push(d);
}

export async function notifyUsers(userIds: string[], input: NotifyInput, db: Db = prisma) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return;
  await db.notification.createMany({
    data: unique.map((userId) => ({
      organizationId: input.organizationId,
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      entityType: input.entityType,
      entityId: input.entityId,
    })),
  });
  for (const d of dispatchers) {
    for (const u of unique) d(u, input).catch(() => undefined);
  }
}

/**
 * Benachrichtigt alle Verwaltungsbenutzer mit den angegebenen Rollen,
 * die Zugriff auf die Immobilie haben.
 */
export async function notifyStaff(
  input: NotifyInput & { propertyId?: string | null; roles?: Role[]; excludeUserId?: string },
  db: Db = prisma,
) {
  const roles: Role[] = input.roles ?? ['OWNER', 'MANAGER', 'EMPLOYEE'];
  const users = await db.user.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      role: { in: roles },
    },
    include: { propertyAccess: true },
  });
  const ids = users
    .filter((u) => {
      if (u.id === input.excludeUserId) return false;
      if (u.role === 'EMPLOYEE' || u.role === 'CARETAKER') {
        return input.propertyId ? u.propertyAccess.some((a) => a.propertyId === input.propertyId) : false;
      }
      return true;
    })
    .map((u) => u.id);
  await notifyUsers(ids, input, db);
}
