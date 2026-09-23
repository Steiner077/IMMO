import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { requirePermission } from '../auth/context.js';
import { auditReq } from '../services/audit.js';

const schema = z.object({
  name: z.string().trim().min(1),
  trade: optStr,
  contactName: optStr,
  email: z.string().email().nullish().or(z.literal('').transform(() => null)),
  phone: optStr,
  street: optStr,
  zip: optStr,
  city: optStr,
  notes: optStr,
});

export async function providerRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('provider:read') }, async (req) =>
    prisma.serviceProvider.findMany({
      where: { organizationId: req.user.organizationId, archivedAt: null },
      include: { _count: { select: { damageReports: true, expenses: true } } },
      orderBy: { name: 'asc' },
    }),
  );
  app.post('/', { preHandler: requirePermission('provider:write') }, async (req) => {
    const body = parse(schema, req.body);
    const p = await prisma.serviceProvider.create({ data: { ...body, organizationId: req.user.organizationId } });
    await auditReq(req, { action: 'provider.create', entityType: 'ServiceProvider', entityId: p.id, summary: `Dienstleister ${p.name} angelegt` });
    return p;
  });
  app.patch('/:id', { preHandler: requirePermission('provider:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(schema.partial().extend({ archived: z.boolean().optional() }), req.body);
    const before = await prisma.serviceProvider.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!before) throw notFound('Dienstleister');
    const { archived, ...fields } = body;
    const p = await prisma.serviceProvider.update({ where: { id }, data: { ...fields, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    await auditReq(req, { action: 'provider.update', entityType: 'ServiceProvider', entityId: id, summary: `Dienstleister ${p.name} geändert`, newValues: body });
    return p;
  });
}
