import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { addMonths, formatMoney, toPeriod } from '@immo/shared';
import { prisma, financialTx } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { assertPropertyAccess, propertyIdFilter, requirePermission } from '../auth/context.js';
import { auditReq, diff } from '../services/audit.js';
import { ensureChargesForLease, recalcCharge } from '../services/charges.js';
import { getOrgSettings } from '../services/settings.js';
import { readMultipart } from '../lib/upload.js';
import { storeDocument } from '../services/documents.js';
import { extractContract, matchContract } from '../services/contract-extraction.js';

const leaseSchema = z.object({
  unitId: z.string(),
  tenantId: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE']).default('ACTIVE'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  chargesFrom: z.coerce.date().nullish(),
  noticePeriodMonths: z.coerce.number().int().min(0).max(24).default(3),
  netRentCents: z.coerce.number().int().min(0),
  utilitiesCents: z.coerce.number().int().min(0).default(0),
  depositCents: z.coerce.number().int().min(0).default(0),
  dueDay: z.coerce.number().int().min(1).max(28).default(1),
  paymentReference: optStr,
  notes: optStr,
});

/** Legt einen Mietvertrag mit allen Prüfungen und Sollstellungen an (manuell oder aus einem ausgelesenen Vertrag). */
export async function createLease(req: FastifyRequest, body: z.infer<typeof leaseSchema>) {
  const unit = await prisma.unit.findFirst({ where: { id: body.unitId, property: { organizationId: req.user.organizationId } }, include: { property: true } });
  if (!unit) throw notFound('Mietobjekt');
  assertPropertyAccess(req.user, unit.propertyId);
  const tenant = await prisma.tenant.findFirst({ where: { id: body.tenantId, organizationId: req.user.organizationId } });
  if (!tenant) throw notFound('Mieter');
  if (body.endDate && body.endDate < body.startDate) throw badRequest('Das Mietende liegt vor dem Mietbeginn.');
  // Überschneidende Verträge verhindern
  const overlap = await prisma.lease.findFirst({
    where: {
      unitId: body.unitId,
      status: { in: ['ACTIVE', 'TERMINATED'] },
      startDate: body.endDate ? { lte: body.endDate } : undefined,
      OR: [{ endDate: null }, { endDate: { gte: body.startDate } }],
    },
  });
  if (overlap && body.status === 'ACTIVE') throw conflict('Für dieses Mietobjekt besteht im Zeitraum bereits ein aktiver Mietvertrag.');
  const settings = await getOrgSettings(req.user.organizationId);
  // Bestehende (ältere) Verträge: Sollstellungen erst ab dem laufenden Monat, sofern nicht anders angegeben
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  if (!body.chargesFrom && body.startDate < monthStart) body.chargesFrom = monthStart;
  const lease = await financialTx(async (tx) => {
    const l = await tx.lease.create({ data: body });
    await ensureChargesForLease(tx, l, addMonths(toPeriod(new Date()), settings.chargesMonthsAhead));
    return l;
  });
  await auditReq(req, {
    action: 'lease.create',
    entityType: 'Lease',
    entityId: lease.id,
    summary: `Mietvertrag ${unit.property.name} / ${unit.label} mit ${tenant.lastName ?? tenant.companyName} (${formatMoney(body.netRentCents + body.utilitiesCents)}/Monat)`,
    newValues: body,
  });
  return lease;
}

export async function leaseRoutes(app: FastifyInstance) {
  app.get('/leases', { preHandler: requirePermission('lease:read') }, async (req) => {
    const q = parse(
      z.object({ status: z.string().optional(), expiringDays: z.coerce.number().optional(), propertyId: z.string().optional() }),
      req.query,
    );
    if (q.propertyId) assertPropertyAccess(req.user, q.propertyId);
    return prisma.lease.findMany({
      where: {
        unit: { propertyId: q.propertyId ?? propertyIdFilter(req.user), property: { organizationId: req.user.organizationId } },
        ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
        ...(q.expiringDays ? { endDate: { gte: new Date(), lte: new Date(Date.now() + q.expiringDays * 86400000) } } : {}),
      },
      include: {
        tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
  });

  app.post('/leases', { preHandler: requirePermission('lease:write') }, async (req) => {
    const body = parse(leaseSchema, req.body);
    return createLease(req, body);
  });

  /** Mietvertrag (PDF/Foto) von der KI auslesen lassen – es wird noch nichts gespeichert ausser dem Dokument */
  app.post('/leases/extract', { preHandler: requirePermission('lease:write', 'tenant:write') }, async (req) => {
    const { files } = await readMultipart(req);
    const file = files[0];
    if (!file) throw badRequest('Keine Datei übermittelt.');
    const data = await extractContract(file);
    const match = await matchContract(req.user.organizationId, data);
    const doc = await storeDocument(prisma, req.user.organizationId, file, {
      category: 'LEASE',
      description: 'Mietvertrag (automatisch ausgelesen)',
      propertyId: match.propertyId,
      uploadedById: req.user.id,
    });
    await auditReq(req, { action: 'lease.extract', entityType: 'Document', entityId: doc.id, summary: `Mietvertrag "${file.filename}" per KI ausgelesen (Sicherheit ${data.confidence} %)` });
    return { documentId: doc.id, data, match };
  });

  /** Nach Prüfung: Mieter (neu oder bestehend), Mietobjekt (neu oder bestehend) und Vertrag in einem Schritt anlegen */
  app.post('/leases/from-contract', { preHandler: requirePermission('lease:write', 'tenant:write') }, async (req) => {
    const body = parse(
      z.object({
        documentId: z.string(),
        tenantId: z.string().nullish(),
        tenant: z
          .object({
            isCompany: z.boolean().default(false),
            firstName: optStr,
            lastName: optStr,
            companyName: optStr,
            email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
            phone: optStr,
            street: optStr,
            zip: optStr,
            city: optStr,
            dateOfBirth: z.coerce.date().nullish(),
            notes: optStr,
          })
          .nullish(),
        unitId: z.string().nullish(),
        newUnit: z.object({ propertyId: z.string(), label: z.string().trim().min(1), type: z.enum(['APARTMENT', 'HOUSE', 'COMMERCIAL', 'OFFICE', 'PARKING', 'GARAGE', 'STORAGE', 'OTHER']).default('APARTMENT'), floor: optStr, rooms: z.coerce.number().nullish(), areaM2: z.coerce.number().nullish() }).nullish(),
        lease: leaseSchema.omit({ unitId: true, tenantId: true }),
      }),
      req.body,
    );
    const doc = await prisma.document.findFirst({ where: { id: body.documentId, organizationId: req.user.organizationId } });
    if (!doc) throw notFound('Dokument');
    if (!body.tenantId && !body.tenant) throw badRequest('Bitte einen Mieter wählen oder erfassen.');
    if (body.tenant && !body.tenant.lastName && !body.tenant.companyName) throw badRequest('Nachname oder Firmenname des Mieters fehlt.');
    if (!body.unitId && !body.newUnit) throw badRequest('Bitte ein Mietobjekt wählen oder erfassen.');

    // Konflikte vorab prüfen, damit bei einem Fehler keine halbfertigen Datensätze entstehen
    if (body.unitId && body.lease.status !== 'DRAFT') {
      const overlap = await prisma.lease.findFirst({
        where: {
          unitId: body.unitId,
          status: { in: ['ACTIVE', 'TERMINATED'] },
          startDate: body.lease.endDate ? { lte: body.lease.endDate } : undefined,
          OR: [{ endDate: null }, { endDate: { gte: body.lease.startDate } }],
          unit: { property: { organizationId: req.user.organizationId } },
        },
      });
      if (overlap) throw conflict('Für dieses Mietobjekt besteht im Zeitraum bereits ein aktiver Mietvertrag. Bitte ein anderes Objekt wählen oder den bestehenden Vertrag zuerst beenden.');
    }
    if (body.lease.endDate && body.lease.endDate < body.lease.startDate) throw badRequest('Das Mietende liegt vor dem Mietbeginn.');

    let tenantId = body.tenantId ?? null;
    if (tenantId) {
      if (!(await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: req.user.organizationId } }))) throw notFound('Mieter');
    } else {
      const t = await prisma.tenant.create({ data: { ...body.tenant!, organizationId: req.user.organizationId } });
      tenantId = t.id;
      await auditReq(req, { action: 'tenant.create', entityType: 'Tenant', entityId: t.id, summary: `Mieter ${t.companyName ?? `${t.firstName ?? ''} ${t.lastName}`} aus Mietvertrag angelegt`, newValues: body.tenant });
    }
    let unitId = body.unitId ?? null;
    if (!unitId) {
      assertPropertyAccess(req.user, body.newUnit!.propertyId);
      const property = await prisma.property.findFirst({ where: { id: body.newUnit!.propertyId, organizationId: req.user.organizationId } });
      if (!property) throw notFound('Immobilie');
      const u = await prisma.unit.create({ data: { ...body.newUnit!, propertyId: property.id } });
      unitId = u.id;
      await auditReq(req, { action: 'unit.create', entityType: 'Unit', entityId: u.id, summary: `Mietobjekt ${u.label} in ${property.name} aus Mietvertrag angelegt` });
    }
    const lease = await createLease(req, { ...body.lease, unitId, tenantId });
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } });
    await prisma.document.update({ where: { id: doc.id }, data: { leaseId: lease.id, tenantId, unitId, propertyId: unit.propertyId, category: 'LEASE', visibleToTenant: true } });
    return lease;
  });

  app.get('/leases/:id', { preHandler: requirePermission('lease:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const l = await prisma.lease.findFirst({
      where: { id, unit: { property: { organizationId: req.user.organizationId } } },
      include: {
        tenant: true,
        unit: { include: { property: true } },
        charges: { orderBy: { period: 'desc' }, include: { assignments: { include: { payment: { select: { id: true, number: true, bookingDate: true, amountCents: true, reversedAt: true } } } } } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!l) throw notFound('Mietvertrag');
    assertPropertyAccess(req.user, l.unit.propertyId);
    return l;
  });

  app.patch('/leases/:id', { preHandler: requirePermission('lease:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const before = await prisma.lease.findFirst({ where: { id, unit: { property: { organizationId: req.user.organizationId } } }, include: { unit: true } });
    if (!before) throw notFound('Mietvertrag');
    assertPropertyAccess(req.user, before.unit.propertyId);
    const body = parse(
      leaseSchema.omit({ unitId: true, tenantId: true }).partial().extend({
        /** Mietänderung: ab welcher Periode gilt der neue Betrag für bestehende offene Sollstellungen */
        applyFromPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      }),
      req.body,
    );
    const { applyFromPeriod, ...fields } = body;
    const updated = await financialTx(async (tx) => {
      const l = await tx.lease.update({ where: { id }, data: fields });
      const rentChanged = fields.netRentCents !== undefined || fields.utilitiesCents !== undefined;
      if (rentChanged && applyFromPeriod) {
        // Nur noch unbezahlte Sollstellungen werden angepasst – bezahlte bleiben unverändert
        const charges = await tx.rentCharge.findMany({ where: { leaseId: id, period: { gte: applyFromPeriod }, paidCents: 0, status: { not: 'CANCELLED' } } });
        for (const c of charges) {
          await tx.rentCharge.update({
            where: { id: c.id },
            data: { netRentCents: l.netRentCents, utilitiesCents: l.utilitiesCents, amountCents: l.netRentCents + l.utilitiesCents },
          });
          await recalcCharge(tx, c.id);
        }
      }
      return l;
    });
    const d = diff(before as unknown as Record<string, unknown>, fields);
    if (d.changed) await auditReq(req, { action: 'lease.update', entityType: 'Lease', entityId: id, summary: `Mietvertrag geändert${applyFromPeriod ? ` (wirksam ab ${applyFromPeriod})` : ''}`, ...d });
    return updated;
  });

  app.post('/leases/:id/terminate', { preHandler: requirePermission('lease:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ endDate: z.coerce.date(), reason: optStr }), req.body);
    const l = await prisma.lease.findFirst({ where: { id, unit: { property: { organizationId: req.user.organizationId } } }, include: { unit: true } });
    if (!l) throw notFound('Mietvertrag');
    assertPropertyAccess(req.user, l.unit.propertyId);
    if (body.endDate < l.startDate) throw badRequest('Ungültiges Enddatum.');
    await financialTx(async (tx) => {
      await tx.lease.update({ where: { id }, data: { status: 'TERMINATED', endDate: body.endDate, terminatedAt: new Date(), terminationReason: body.reason } });
      // Sollstellungen nach Vertragsende stornieren (nur unbezahlte)
      const after = toPeriod(body.endDate);
      await tx.rentCharge.updateMany({ where: { leaseId: id, period: { gt: after }, paidCents: 0 }, data: { status: 'CANCELLED', note: 'Nach Vertragsende storniert' } });
    });
    await auditReq(req, {
      action: 'lease.terminate',
      entityType: 'Lease',
      entityId: id,
      summary: `Mietvertrag gekündigt per ${body.endDate.toISOString().slice(0, 10)}`,
      oldValues: { status: l.status, endDate: l.endDate },
      newValues: { status: 'TERMINATED', endDate: body.endDate, reason: body.reason },
    });
    return { ok: true };
  });

  app.post('/leases/:id/generate-charges', { preHandler: requirePermission('finance:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ until: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
    const l = await prisma.lease.findFirst({ where: { id, unit: { property: { organizationId: req.user.organizationId } } } });
    if (!l) throw notFound('Mietvertrag');
    const created = await ensureChargesForLease(prisma, l, body.until);
    await auditReq(req, { action: 'charges.generate', entityType: 'Lease', entityId: id, summary: `${created} Sollstellungen bis ${body.until} erzeugt` });
    return { created };
  });

  /** Sollstellung anpassen (z. B. Mietzinsreduktion) – nur mit Begründung */
  app.patch('/charges/:id', { preHandler: requirePermission('finance:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ amountCents: z.coerce.number().int().min(0).optional(), cancel: z.boolean().optional(), reason: z.string().min(3) }), req.body);
    const c = await prisma.rentCharge.findFirst({ where: { id, lease: { unit: { property: { organizationId: req.user.organizationId } } } } });
    if (!c) throw notFound('Sollstellung');
    await financialTx(async (tx) => {
      if (body.cancel) {
        if (c.paidCents > 0) throw conflict('Bereits (teil-)bezahlte Sollstellungen können nicht storniert werden. Bitte zuerst die Zahlung umbuchen.');
        await tx.rentCharge.update({ where: { id }, data: { status: 'CANCELLED', note: body.reason } });
      } else if (body.amountCents !== undefined) {
        await tx.rentCharge.update({ where: { id }, data: { amountCents: body.amountCents, note: body.reason } });
        await recalcCharge(tx, id);
      }
    });
    await auditReq(req, {
      action: body.cancel ? 'charge.cancel' : 'charge.update',
      entityType: 'RentCharge',
      entityId: id,
      summary: `Sollstellung ${c.period} ${body.cancel ? 'storniert' : `angepasst: ${formatMoney(c.amountCents)} → ${formatMoney(body.amountCents)}`} – ${body.reason}`,
      oldValues: { amountCents: c.amountCents, status: c.status },
      newValues: body.cancel ? { status: 'CANCELLED' } : { amountCents: body.amountCents },
    });
    return { ok: true };
  });
}
