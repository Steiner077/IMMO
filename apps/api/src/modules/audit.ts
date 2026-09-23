import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pagination, parse } from '../lib/http.js';
import { requirePermission } from '../auth/context.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('audit:read') }, async (req) => {
    const q = parse(
      pagination.extend({ entityType: z.string().optional(), entityId: z.string().optional(), userId: z.string().optional(), action: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
      req.query,
    );
    const where = {
      organizationId: req.user.organizationId,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}
