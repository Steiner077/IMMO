import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import type { AuthUser } from '../auth/context.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

const SENSITIVE = new Set(['passwordHash', 'password', 'tokenHash']);

function clean(values: unknown): Prisma.InputJsonValue | undefined {
  if (values === undefined || values === null) return undefined;
  return JSON.parse(
    JSON.stringify(values, (k, v) => (SENSITIVE.has(k) ? '[geschützt]' : typeof v === 'bigint' ? v.toString() : v)),
  );
}

/** Nur die tatsächlich geänderten Felder protokollieren. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : JSON.stringify(v));
    if (norm(a) !== norm(b)) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
    }
  }
  return { oldValues, newValues, changed: Object.keys(newValues).length > 0 };
}

export async function audit(
  ctx: { user?: AuthUser | null; organizationId: string; req?: FastifyRequest },
  entry: AuditEntry,
  db: Db = prisma,
) {
  await db.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.user?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      oldValues: clean(entry.oldValues),
      newValues: clean(entry.newValues),
      ip: ctx.req?.ip,
      userAgent: ctx.req?.headers['user-agent']?.slice(0, 300),
    },
  });
}

/** Kurzform im Request-Kontext */
export function auditReq(req: FastifyRequest, entry: AuditEntry, db: Db = prisma) {
  return audit({ user: req.user, organizationId: req.user.organizationId, req }, entry, db);
}
