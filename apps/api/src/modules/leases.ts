import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addMonths, formatMoney, toPeriod } from '@immo/shared';
import { prisma, financialTx } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { assertPropertyAccess, propertyIdFilter, requirePermission } from '../auth/context.js';
import { auditReq, diff } from '../services/audit.js';
import { ensureChargesForLease, recalcCharge } from '../services/charges.js';
import { getOrgSettings } from '../services/settings.js';

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
