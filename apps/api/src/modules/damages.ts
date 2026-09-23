import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DAMAGE_STATUS, PRIORITIES } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { assertPropertyAccess, can, propertyIdFilter, requirePermission, scopedPropertyId, type AuthUser } from '../auth/context.js';
import { nextNumber } from '../lib/counter.js';
import { readMultipart } from '../lib/upload.js';
import { storeDocument } from '../services/documents.js';
import { auditReq } from '../services/audit.js';
import { notifyStaff, notifyUsers } from '../services/notifications.js';

export const DAMAGE_CATEGORY_ENUM = z.enum(['HEATING', 'WATER', 'ELECTRICITY', 'WINDOWS_DOORS', 'APPLIANCES', 'BATHROOM', 'KITCHEN', 'EXTERIOR', 'COMMON_AREAS', 'PESTS', 'OTHER']);
export const PRIORITY_ENUM = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const STATUS_ENUM = z.enum(['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'REJECTED']);

/** Sichtbarkeit von Tickets je Rolle */
export function damageScope(user: AuthUser): Prisma.DamageReportWhereInput {
  if (user.role === 'SERVICE_PROVIDER') return { organizationId: user.organizationId, serviceProviderId: user.serviceProviderId ?? '__none__' };
  if (user.role === 'TENANT') return { organizationId: user.organizationId, tenantId: user.tenantId ?? '__none__' };
  const pf = propertyIdFilter(user);
  return { organizationId: user.organizationId, ...(pf ? { propertyId: pf } : {}) };
}

export async function addDamageEvent(
  damageReportId: string,
  userId: string | null,
  type: string,
  message: string | null,
  data: Record<string, unknown> = {},
  isPublic = true,
) {
  return prisma.damageReportEvent.create({ data: { damageReportId, userId, type, message, data: data as Prisma.InputJsonValue, isPublic } });
}

/** Ticket anlegen – auch von der Mieter-App verwendet */
export async function createDamageReport(
  req: FastifyRequest,
  input: {
    propertyId: string;
    unitId?: string | null;
    tenantId?: string | null;
    category: z.infer<typeof DAMAGE_CATEGORY_ENUM>;
    title: string;
    description: string;
    priority: z.infer<typeof PRIORITY_ENUM>;
    preferredAppointment?: string | null;
    location?: string | null;
  },
  files: { filename: string; mimetype: string; buffer: Buffer }[] = [],
) {
  const user = req.user;
  const report = await prisma.$transaction(async (tx) => {
    const ticketNumber = await nextNumber(tx, user.organizationId, 'ticket', 1001);
    return tx.damageReport.create({
      data: {
        organizationId: user.organizationId,
        ticketNumber,
        propertyId: input.propertyId,
        unitId: input.unitId ?? null,
        tenantId: input.tenantId ?? null,
        reportedById: user.id,
        category: input.category,
        title: input.title,
        description: input.description,
        priority: input.priority,
        preferredAppointment: input.preferredAppointment ?? null,
        location: input.location ?? null,
      },
      include: { unit: true, property: true },
    });
  });
  for (const f of files) {
    await storeDocument(prisma, user.organizationId, f, {
      damageReportId: report.id,
      propertyId: report.propertyId,
      unitId: report.unitId,
      tenantId: report.tenantId,
      visibleToTenant: true,
      uploadedById: user.id,
    });
  }
  await addDamageEvent(report.id, user.id, 'CREATED', `Ticket #${report.ticketNumber} erstellt`, { files: files.length });
  await auditReq(req, { action: 'damage.create', entityType: 'DamageReport', entityId: report.id, summary: `Ticket #${report.ticketNumber}: ${report.title}` });
  await notifyStaff({
    organizationId: user.organizationId,
    type: 'DAMAGE_NEW',
    title: `Neue Mängelmeldung #${report.ticketNumber}`,
    body: `${report.title} · ${report.property.name}${report.unit ? ` / ${report.unit.label}` : ''} · Priorität ${PRIORITIES[report.priority]}`,
    link: `/maengel/${report.id}`,
    entityType: 'DamageReport',
    entityId: report.id,
    propertyId: report.propertyId,
    roles: ['OWNER', 'MANAGER', 'EMPLOYEE', 'CARETAKER'],
    excludeUserId: user.id,
  });
  return report;
}

export async function damageRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('damage:read') }, async (req) => {
    const q = parse(
      z.object({ status: z.string().optional(), propertyId: z.string().optional(), priority: z.string().optional(), open: z.coerce.boolean().optional(), search: z.string().optional() }),
      req.query,
    );
    return prisma.damageReport.findMany({
      where: {
        AND: [damageScope(req.user), q.propertyId ? { propertyId: scopedPropertyId(req.user, q.propertyId) } : {}],
        ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
        ...(q.open ? { status: { in: ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING'] } } : {}),
        ...(q.priority ? { priority: { in: q.priority.split(',') as never } } : {}),
        ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {}),
      },
      include: {
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true } },
        tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        assignedCaretaker: { select: { id: true, firstName: true, lastName: true } },
        serviceProvider: { select: { id: true, name: true } },
        _count: { select: { documents: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
  });

  app.post('/', { preHandler: requirePermission('damage:write') }, async (req) => {
    let body: Record<string, unknown>;
    let files: Awaited<ReturnType<typeof readMultipart>>['files'] = [];
    if (req.isMultipart()) {
      const mp = await readMultipart(req);
      body = mp.fields;
      files = mp.files;
    } else body = req.body as Record<string, unknown>;
    const input = parse(
      z.object({
        propertyId: z.string(),
        unitId: optStr,
        tenantId: optStr,
        category: DAMAGE_CATEGORY_ENUM,
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().min(3).max(5000),
        priority: PRIORITY_ENUM.default('MEDIUM'),
        preferredAppointment: optStr,
        location: optStr,
      }),
      body,
    );
    assertPropertyAccess(req.user, input.propertyId);
    const property = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: req.user.organizationId } });
    if (!property) throw notFound('Immobilie');
    return createDamageReport(req, input, files);
  });

  app.get('/:id', { preHandler: requirePermission('damage:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const d = await prisma.damageReport.findFirst({
      where: { id, ...damageScope(req.user) },
      include: {
        property: { select: { id: true, name: true, street: true, city: true } },
        unit: { select: { id: true, label: true, floor: true } },
        tenant: { select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, email: true } },
        reportedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        assignedCaretaker: { select: { id: true, firstName: true, lastName: true, phone: true } },
        serviceProvider: true,
        events: { orderBy: { createdAt: 'asc' }, include: { user: { select: { firstName: true, lastName: true, role: true } } } },
        documents: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        appointments: { orderBy: { startAt: 'asc' } },
        conversations: { select: { id: true, subject: true, lastMessageAt: true } },
        expenses: can(req.user, 'expense:read'),
        tasks: { select: { id: true, title: true, status: true, dueDate: true } },
      },
    });
    if (!d) throw notFound('Ticket');
    if (!can(req.user, 'finance:read')) {
      d.estimatedCostCents = null;
      d.documents = d.documents.filter((x) => x.category !== 'INVOICE');
    }
    return d;
  });

  app.patch('/:id', { preHandler: requirePermission('damage:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        status: STATUS_ENUM.optional(),
        priority: PRIORITY_ENUM.optional(),
        category: DAMAGE_CATEGORY_ENUM.optional(),
        assignedCaretakerId: z.string().nullable().optional(),
        serviceProviderId: z.string().nullable().optional(),
        estimatedCostCents: z.coerce.number().int().nullable().optional(),
        comment: optStr,
      }),
      req.body,
    );
    const before = await prisma.damageReport.findFirst({ where: { id, ...damageScope(req.user) }, include: { tenant: { include: { user: true } } } });
    if (!before) throw notFound('Ticket');
    if ((body.assignedCaretakerId !== undefined || body.serviceProviderId !== undefined) && !can(req.user, 'damage:assign')) throw forbidden();
    if (req.user.role === 'SERVICE_PROVIDER' && (body.priority || body.category || body.estimatedCostCents !== undefined)) throw forbidden();
    const { comment, ...fields } = body;
    if (fields.assignedCaretakerId) {
      const ct = await prisma.user.findFirst({ where: { id: fields.assignedCaretakerId, organizationId: req.user.organizationId, role: { in: ['CARETAKER', 'EMPLOYEE', 'MANAGER', 'OWNER'] } } });
      if (!ct) throw badRequest('Ungültiger Hauswart.');
    }
    if (fields.serviceProviderId) {
      const sp = await prisma.serviceProvider.findFirst({ where: { id: fields.serviceProviderId, organizationId: req.user.organizationId } });
      if (!sp) throw badRequest('Ungültiger Dienstleister.');
    }
    const data: Prisma.DamageReportUncheckedUpdateInput = { ...fields };
    if (fields.status && ['RESOLVED', 'CLOSED'].includes(fields.status) && !before.resolvedAt) data.resolvedAt = new Date();
    if (fields.status && !['RESOLVED', 'CLOSED'].includes(fields.status)) data.resolvedAt = null;
    const updated = await prisma.damageReport.update({ where: { id }, data });

    if (fields.status && fields.status !== before.status)
      await addDamageEvent(id, req.user.id, 'STATUS_CHANGED', `Status: ${DAMAGE_STATUS[before.status]} → ${DAMAGE_STATUS[fields.status]}`, { from: before.status, to: fields.status });
    if (fields.priority && fields.priority !== before.priority)
      await addDamageEvent(id, req.user.id, 'PRIORITY_CHANGED', `Priorität: ${PRIORITIES[before.priority]} → ${PRIORITIES[fields.priority]}`, {}, true);
    if (fields.assignedCaretakerId !== undefined && fields.assignedCaretakerId !== before.assignedCaretakerId) {
      const u = fields.assignedCaretakerId ? await prisma.user.findUnique({ where: { id: fields.assignedCaretakerId } }) : null;
      await addDamageEvent(id, req.user.id, 'ASSIGNED', u ? `Hauswart zugewiesen: ${u.firstName} ${u.lastName}` : 'Hauswart-Zuweisung entfernt');
      if (u) await notifyUsers([u.id], { organizationId: req.user.organizationId, type: 'DAMAGE_UPDATE', title: `Ticket #${before.ticketNumber} zugewiesen`, body: before.title, link: `/maengel/${id}`, entityType: 'DamageReport', entityId: id });
    }
    if (fields.serviceProviderId !== undefined && fields.serviceProviderId !== before.serviceProviderId) {
      const sp = fields.serviceProviderId ? await prisma.serviceProvider.findUnique({ where: { id: fields.serviceProviderId }, include: { user: true } }) : null;
      await addDamageEvent(id, req.user.id, 'PROVIDER_ASSIGNED', sp ? `Handwerker beauftragt: ${sp.name}` : 'Handwerker-Zuweisung entfernt');
      if (sp?.user) await notifyUsers([sp.user.id], { organizationId: req.user.organizationId, type: 'DAMAGE_UPDATE', title: `Neuer Auftrag #${before.ticketNumber}`, body: before.title, link: `/maengel/${id}`, entityType: 'DamageReport', entityId: id });
    }
    if (fields.estimatedCostCents !== undefined && fields.estimatedCostCents !== before.estimatedCostCents)
      await addDamageEvent(id, req.user.id, 'COST_ESTIMATE', 'Kostenschätzung aktualisiert', { from: before.estimatedCostCents, to: fields.estimatedCostCents }, false);
    if (comment) await addDamageEvent(id, req.user.id, 'COMMENT', comment);

    await auditReq(req, {
      action: 'damage.update',
      entityType: 'DamageReport',
      entityId: id,
      summary: `Ticket #${before.ticketNumber} aktualisiert`,
      oldValues: Object.fromEntries(Object.keys(fields).map((k) => [k, (before as Record<string, unknown>)[k]])),
      newValues: fields,
    });
    if (before.tenant?.user && fields.status && fields.status !== before.status) {
      await notifyUsers([before.tenant.user.id], {
        organizationId: req.user.organizationId,
        type: 'DAMAGE_UPDATE',
        title: `Ihre Meldung #${before.ticketNumber}: ${DAMAGE_STATUS[fields.status]}`,
        body: before.title,
        link: `/maengel/${id}`,
        entityType: 'DamageReport',
        entityId: id,
      });
    }
    return updated;
  });

  app.post('/:id/comments', { preHandler: requirePermission('damage:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ message: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) }), req.body);
    const d = await prisma.damageReport.findFirst({ where: { id, ...damageScope(req.user) } });
    if (!d) throw notFound('Ticket');
    return addDamageEvent(id, req.user.id, 'COMMENT', body.message, {}, !body.internal);
  });

  /** Fotos, Rechnungen, Offerten zum Ticket hinzufügen */
  app.post('/:id/documents', { preHandler: requirePermission('damage:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const d = await prisma.damageReport.findFirst({ where: { id, ...damageScope(req.user) } });
    if (!d) throw notFound('Ticket');
    const { files, fields } = await readMultipart(req);
    const category = (fields.category || undefined) as import('@prisma/client').DocumentCategory | undefined;
    if (category === 'INVOICE' && !can(req.user, 'document:read_financial')) throw forbidden();
    const docs = [];
    for (const f of files) {
      docs.push(
        await storeDocument(prisma, req.user.organizationId, f, {
          damageReportId: id,
          propertyId: d.propertyId,
          unitId: d.unitId,
          category: category ?? null,
          visibleToTenant: fields.visibleToTenant === 'true' && category !== 'INVOICE',
          uploadedById: req.user.id,
        }),
      );
    }
    await addDamageEvent(id, req.user.id, 'ATTACHMENT', `${docs.length} Datei(en) hinzugefügt`, { documentIds: docs.map((x) => x.id) }, category !== 'INVOICE');
    return docs;
  });
}
