import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { requirePermission } from '../auth/context.js';
import { auditReq } from '../services/audit.js';
import { notifyUsers } from '../services/notifications.js';

export async function announcementRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('property:read') }, async (req) =>
    prisma.announcement.findMany({
      where: { organizationId: req.user.organizationId },
      include: { property: { select: { id: true, name: true } } },
      orderBy: { publishedAt: 'desc' },
    }),
  );

  /** Mitteilung an Mieter einer Immobilie (oder aller Immobilien) */
  app.post('/', { preHandler: requirePermission('announcement:write') }, async (req) => {
    const body = parse(z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10000), propertyId: optStr, important: z.boolean().default(false), expiresAt: z.coerce.date().nullish() }), req.body);
    if (body.propertyId && !(await prisma.property.findFirst({ where: { id: body.propertyId, organizationId: req.user.organizationId } }))) throw notFound('Immobilie');
    const a = await prisma.announcement.create({ data: { ...body, organizationId: req.user.organizationId, createdById: req.user.id } });
    const tenants = await prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        role: 'TENANT',
        isActive: true,
        tenant: { leases: { some: { status: { in: ['ACTIVE', 'TERMINATED'] }, ...(body.propertyId ? { unit: { propertyId: body.propertyId } } : {}) } } },
      },
      select: { id: true },
    });
    await notifyUsers(tenants.map((t) => t.id), { organizationId: req.user.organizationId, type: 'ANNOUNCEMENT', title: body.important ? `Wichtig: ${body.title}` : body.title, body: body.body.slice(0, 200), link: '/mitteilungen' });
    await auditReq(req, { action: 'announcement.create', entityType: 'Announcement', entityId: a.id, summary: `Mitteilung "${a.title}" an ${tenants.length} Mieter` });
    return a;
  });

  app.delete('/:id', { preHandler: requirePermission('announcement:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await prisma.announcement.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!a) throw notFound('Mitteilung');
    await prisma.announcement.delete({ where: { id } });
    await auditReq(req, { action: 'announcement.delete', entityType: 'Announcement', entityId: id, summary: `Mitteilung "${a.title}" gelöscht` });
    return { ok: true };
  });
}
