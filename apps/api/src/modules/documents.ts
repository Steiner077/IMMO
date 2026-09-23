import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { FINANCIAL_DOCUMENT_CATEGORIES } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { can, propertyIdFilter, requirePermission, scopedPropertyId, type AuthUser } from '../auth/context.js';
import { readMultipart } from '../lib/upload.js';
import { storage } from '../lib/storage.js';
import { storeDocument } from '../services/documents.js';
import { auditReq } from '../services/audit.js';
import { notifyStaff } from '../services/notifications.js';

const CATEGORY = z.enum(['CONTRACT', 'INSURANCE', 'INVOICE', 'CONSTRUCTION', 'HANDOVER', 'PHOTO', 'VIDEO', 'LEASE', 'TERMINATION', 'CORRESPONDENCE', 'BANK_STATEMENT', 'RECEIPT', 'EXPORT', 'OTHER']);

/** Welche Dokumente darf ein Benutzer sehen? */
export function documentScope(user: AuthUser): Prisma.DocumentWhereInput {
  const where: Prisma.DocumentWhereInput = { organizationId: user.organizationId, deletedAt: null };
  if (user.role === 'TENANT') {
    return { ...where, visibleToTenant: true, OR: [{ tenantId: user.tenantId }, { lease: { tenantId: user.tenantId ?? '' } }, { damageReport: { tenantId: user.tenantId } }] };
  }
  const and: Prisma.DocumentWhereInput[] = [];
  const pf = propertyIdFilter(user);
  if (pf) {
    and.push({
      OR: [{ propertyId: pf }, { unit: { propertyId: pf } }, { damageReport: { propertyId: pf } }, { uploadedById: user.id }],
    });
  }
  if (!can(user, 'document:read_financial')) {
    and.push({ category: { notIn: [...FINANCIAL_DOCUMENT_CATEGORIES] }, paymentId: null, expenseId: null });
  }
  return and.length ? { ...where, AND: and } : where;
}

export async function documentRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('document:read') }, async (req) => {
    const q = parse(
      z.object({
        propertyId: z.string().optional(),
        unitId: z.string().optional(),
        tenantId: z.string().optional(),
        leaseId: z.string().optional(),
        damageReportId: z.string().optional(),
        category: z.string().optional(),
        search: z.string().optional(),
      }),
      req.query,
    );
    return prisma.document.findMany({
      where: {
        ...documentScope(req.user),
        ...(q.propertyId ? { propertyId: scopedPropertyId(req.user, q.propertyId) } : {}),
        ...(q.unitId ? { unitId: q.unitId } : {}),
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
        ...(q.leaseId ? { leaseId: q.leaseId } : {}),
        ...(q.damageReportId ? { damageReportId: q.damageReportId } : {}),
        ...(q.category ? { category: { in: q.category.split(',') as never } } : {}),
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      include: {
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true } },
        tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  });

  app.post('/', { preHandler: requirePermission('document:write') }, async (req) => {
    const { files, fields } = await readMultipart(req);
    const meta = parse(
      z.object({
        category: CATEGORY.optional(),
        description: optStr,
        propertyId: optStr,
        unitId: optStr,
        tenantId: optStr,
        leaseId: optStr,
        paymentId: optStr,
        expenseId: optStr,
        visibleToTenant: z.enum(['true', 'false']).optional(),
      }),
      fields,
    );
    if (meta.category && (FINANCIAL_DOCUMENT_CATEGORIES as readonly string[]).includes(meta.category) && !can(req.user, 'document:read_financial')) throw forbidden();
    // Verknüpfungen validieren (Mandant + Scope)
    let propertyId = meta.propertyId;
    if (meta.unitId) {
      const u = await prisma.unit.findFirst({ where: { id: meta.unitId, property: { organizationId: req.user.organizationId } } });
      if (!u) throw notFound('Mietobjekt');
      propertyId = u.propertyId;
    }
    if (propertyId) {
      const p = await prisma.property.findFirst({ where: { id: propertyId, organizationId: req.user.organizationId } });
      if (!p) throw notFound('Immobilie');
      if (req.user.propertyIds && !req.user.propertyIds.includes(propertyId)) throw forbidden();
    }
    if (meta.tenantId && !(await prisma.tenant.findFirst({ where: { id: meta.tenantId, organizationId: req.user.organizationId } }))) throw notFound('Mieter');
    if (meta.leaseId && !(await prisma.lease.findFirst({ where: { id: meta.leaseId, unit: { property: { organizationId: req.user.organizationId } } } }))) throw notFound('Mietvertrag');
    if (meta.paymentId && !(await prisma.payment.findFirst({ where: { id: meta.paymentId, organizationId: req.user.organizationId } }))) throw notFound('Zahlung');
    if (meta.expenseId && !(await prisma.expense.findFirst({ where: { id: meta.expenseId, organizationId: req.user.organizationId } }))) throw notFound('Ausgabe');
    const docs = [];
    for (const f of files) {
      const d = await storeDocument(prisma, req.user.organizationId, f, {
        ...meta,
        propertyId,
        category: meta.category ?? null,
        visibleToTenant: meta.visibleToTenant === 'true',
        uploadedById: req.user.id,
      });
      docs.push(d);
      await auditReq(req, { action: 'document.upload', entityType: 'Document', entityId: d.id, summary: `Dokument "${d.name}" hochgeladen (${d.category})` });
    }
    return docs;
  });

  app.get('/:id/download', { preHandler: requirePermission('document:read') }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const d = await prisma.document.findFirst({ where: { id, ...documentScope(req.user) } });
    if (!d) throw notFound('Dokument');
    const inline = (req.query as { inline?: string }).inline === '1';
    reply.header('Content-Type', d.mimeType);
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.name)}`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(storage.stream(d.storageKey));
  });

  app.patch('/:id', { preHandler: requirePermission('document:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name: z.string().min(1).optional(), category: CATEGORY.optional(), description: optStr.optional(), visibleToTenant: z.boolean().optional() }), req.body);
    const d = await prisma.document.findFirst({ where: { id, ...documentScope(req.user) } });
    if (!d) throw notFound('Dokument');
    const updated = await prisma.document.update({ where: { id }, data: { ...body, classificationScore: body.category ? 100 : undefined } });
    await auditReq(req, { action: 'document.update', entityType: 'Document', entityId: id, summary: `Dokument "${d.name}" geändert`, oldValues: { category: d.category, visibleToTenant: d.visibleToTenant }, newValues: body });
    if (body.visibleToTenant && !d.visibleToTenant && d.tenantId) {
      const t = await prisma.tenant.findUnique({ where: { id: d.tenantId }, include: { user: true } });
      if (t?.user) {
        const { notifyUsers } = await import('../services/notifications.js');
        await notifyUsers([t.user.id], { organizationId: req.user.organizationId, type: 'DOCUMENT_UPLOADED', title: 'Neues Dokument verfügbar', body: d.name, link: '/dokumente' });
      }
    }
    return updated;
  });

  app.delete('/:id', { preHandler: requirePermission('document:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const d = await prisma.document.findFirst({ where: { id, ...documentScope(req.user) } });
    if (!d) throw notFound('Dokument');
    // Belege von Zahlungen/Importen bleiben zur Nachvollziehbarkeit erhalten
    const inUse = (await prisma.payment.count({ where: { documentId: id } })) + (await prisma.importBatch.count({ where: { documentId: id } }));
    if (inUse) throw forbidden('Dieses Dokument ist Buchungsbeleg und kann nicht gelöscht werden.');
    await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await auditReq(req, { action: 'document.delete', entityType: 'Document', entityId: id, summary: `Dokument "${d.name}" gelöscht` });
    return { ok: true };
  });
}

export { notifyStaff };
