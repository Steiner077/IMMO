import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, pagination, parse } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertPropertyAccess, can, propertyIdFilter, requirePermission, scopedPropertyId } from '../auth/context.js';
import { createPayment, reassignPayment, reversePayment } from '../services/payments.js';
import { allocatePreferring } from '../import/allocation.js';
import { detectPeriods } from '../import/matching.js';
import { ensureChargesForLease } from '../services/charges.js';
import { auditReq } from '../services/audit.js';
import { addMonths, formatPeriod, toPeriod } from '@immo/shared';

const allocationSchema = z.array(z.object({ chargeId: z.string(), amountCents: z.coerce.number().int().positive() }));

async function autoAssign(id: string, req: FastifyRequest) {
  const p = await prisma.payment.findFirst({
    where: { id, organizationId: req.user.organizationId },
    include: { assignments: true, lease: true },
  });
  if (!p) throw notFound('Zahlung');
  if (p.reversedAt) throw conflict('Stornierte Zahlungen können nicht geändert werden.');
  if (!p.lease) throw badRequest('Bitte zuerst einen Mieter wählen («Umbuchen»).');
  assertPropertyAccess(req.user, (await prisma.unit.findUniqueOrThrow({ where: { id: p.lease.unitId } })).propertyId);
  const assigned = p.assignments.reduce((s, a) => s + a.amountCents, 0);
  const rest = p.amountCents - assigned;
  if (rest <= 0) return { status: p.status, added: 0, message: 'Bereits vollständig zugeordnet.' };

  // Monat: aus der Mitteilung, sonst Buchungsmonat (ab dem 20. → Folgemonat, Vorauszahlung)
  const bookingPeriod = toPeriod(p.bookingDate);
  const period = detectPeriods(`${p.reference ?? ''} ${p.rawText ?? ''}`, p.bookingDate)[0] ?? (p.bookingDate.getUTCDate() >= 20 ? addMonths(bookingPeriod, 1) : bookingPeriod);

  // Fehlende Monatsmieten bis zu diesem Monat nachtragen
  // nur der Vertrag der Zahlung – sonst entstünden z. B. beim Parkplatz künstliche Rückstände
  const leases = [p.lease];
  const monthStart = new Date(`${period}-01T00:00:00Z`);
  let backfilled = 0;
  for (const l of leases) {
    const from = monthStart < l.startDate ? l.startDate : monthStart;
    if (l.chargesFrom && l.chargesFrom > from && (!l.endDate || from <= l.endDate)) {
      await prisma.lease.update({ where: { id: l.id }, data: { chargesFrom: from } });
      await auditReq(req, { action: 'lease.charges_backfill', entityType: 'Lease', entityId: l.id, summary: `Monatsmieten ab ${period} nachgetragen (Zahlung #${p.number})`, oldValues: { chargesFrom: l.chargesFrom }, newValues: { chargesFrom: from } });
      backfilled++;
    }
    // bis zum Zahlungsmonat (Vorauszahlung), höchstens 12 Monate im Voraus
    const horizon = addMonths(toPeriod(new Date()), 1);
    const until = period > horizon && period <= addMonths(toPeriod(new Date()), 12) ? period : horizon;
    await ensureChargesForLease(prisma, { ...l, chargesFrom: l.chargesFrom && l.chargesFrom > from ? from : l.chargesFrom }, until);
  }

  const charges = await prisma.rentCharge.findMany({
    where: { lease: { tenantId: p.lease.tenantId }, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] }, id: { notIn: p.assignments.map((a) => a.rentChargeId) } },
    include: { lease: { select: { unit: { select: { label: true } } } } },
    orderBy: { period: 'asc' },
  });
  const toOpen = (c: (typeof charges)[number]) => ({ id: c.id, period: c.period, outstandingCents: c.amountCents - c.paidCents, label: c.lease.unit.label });
  // ab dem Zahlungsmonat zuordnen (nicht rückwirkend ältere Schulden), Monate des Vertrags zuerst
  const fromPeriod = charges.filter((c) => c.period >= period);
  const plan = allocatePreferring(rest, fromPeriod.filter((c) => c.leaseId === p.leaseId).map(toOpen), fromPeriod.filter((c) => c.leaseId !== p.leaseId).map(toOpen), period);
  if (!plan.lines.length) return { status: p.status, added: 0, message: `Ab ${formatPeriod(period)} ist nichts offen – der Betrag bleibt als Guthaben.` };
  const allocations = [...p.assignments.map((a) => ({ chargeId: a.rentChargeId, amountCents: a.amountCents })), ...plan.lines.map((l) => ({ chargeId: l.chargeId, amountCents: l.amountCents }))];
  const r = await reassignPayment(id, { leaseId: p.leaseId, allocations, reason: 'Automatisch zugeordnet' }, { user: req.user, req });
  return { ...r, added: plan.lines.length, backfilled, periods: [...new Set(plan.lines.map((l) => l.period))] };
}

export async function paymentRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('finance:read') }, async (req) => {
    const q = parse(
      pagination.extend({
        status: z.string().optional(),
        tenantId: z.string().optional(),
        propertyId: z.string().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        search: z.string().optional(),
        source: z.string().optional(),
      }),
      req.query,
    );
    const pf = propertyIdFilter(req.user);
    const where: Prisma.PaymentWhereInput = {
      organizationId: req.user.organizationId,
      ...(pf || q.propertyId ? { propertyId: scopedPropertyId(req.user, q.propertyId) } : {}),
      ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
      ...(q.source ? { source: q.source as never } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.from || q.to ? { bookingDate: { gte: q.from, lte: q.to } } : {}),
      ...(q.search
        ? {
            OR: [
              { payerName: { contains: q.search, mode: 'insensitive' } },
              { reference: { contains: q.search, mode: 'insensitive' } },
              { tenant: { lastName: { contains: q.search, mode: 'insensitive' } } },
              ...(Number.isInteger(+q.search) ? [{ number: +q.search }] : []),
            ],
          }
        : {}),
    };
    const [items, total, sum] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
          property: { select: { id: true, name: true } },
          unit: { select: { id: true, label: true } },
          assignments: { select: { amountCents: true, rentCharge: { select: { period: true } } } },
        },
        orderBy: [{ bookingDate: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({ where: { ...where, reversedAt: null }, _sum: { amountCents: true } }),
    ]);
    return { items, total, sumCents: sum._sum.amountCents ?? 0, page: q.page, pageSize: q.pageSize };
  });

  app.get('/:id', { preHandler: requirePermission('finance:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const p = await prisma.payment.findFirst({
      where: { id, organizationId: req.user.organizationId },
      include: {
        tenant: true,
        lease: { include: { unit: { include: { property: true } } } },
        assignments: { include: { rentCharge: true, createdBy: { select: { firstName: true, lastName: true } } } },
        document: { select: { id: true, name: true } },
        documents: { where: { deletedAt: null } },
        createdBy: { select: { firstName: true, lastName: true } },
        importRow: { select: { batchId: true, matchReasons: true } },
      },
    });
    if (!p) throw notFound('Zahlung');
    const history = await prisma.auditLog.findMany({
      where: { entityType: 'Payment', entityId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    return { ...p, history };
  });

  /**
   * "Selbst zuordnen": einen bestimmten Monat verfügbar machen, auch wenn dafür noch keine
   * Sollstellung besteht (künftiger Monat, oder ein Monat vor dem bisherigen Abrechnungsbeginn –
   * z. B. bei einem Jahresauszug). Nie vor Mietbeginn und nie nach Vertragsende.
   */
  app.post('/ensure-open-charge', {
    preHandler: async (req) => {
      if (!can(req.user, 'finance:read') || !(can(req.user, 'payment:import') || can(req.user, 'finance:write'))) throw forbidden();
    },
  }, async (req) => {
    const body = parse(z.object({ leaseId: z.string(), period: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
    const lease = await prisma.lease.findFirst({ where: { id: body.leaseId, unit: { property: { organizationId: req.user.organizationId } } }, include: { unit: { select: { label: true, propertyId: true } } } });
    if (!lease) throw notFound('Mietvertrag');
    assertPropertyAccess(req.user, lease.unit.propertyId);
    if (body.period < toPeriod(lease.startDate)) throw badRequest('Dieser Monat liegt vor dem Mietbeginn.');
    if (lease.endDate && body.period > toPeriod(lease.endDate)) throw badRequest('Dieser Monat liegt nach dem Vertragsende.');
    const farFuture = addMonths(toPeriod(new Date()), 24);
    if (body.period > farFuture) throw badRequest('Nicht mehr als 24 Monate im Voraus möglich.');

    const effectiveStartPeriod = toPeriod(lease.chargesFrom && lease.chargesFrom > lease.startDate ? lease.chargesFrom : lease.startDate);
    let updated = lease;
    if (body.period < effectiveStartPeriod) {
      const chargesFrom = new Date(`${body.period}-01T00:00:00Z`);
      await prisma.lease.update({ where: { id: lease.id }, data: { chargesFrom } });
      await auditReq(req, { action: 'lease.charges_backfill', entityType: 'Lease', entityId: lease.id, summary: `Sollstellung ${lease.unit.label} für ${body.period} manuell nachgetragen`, oldValues: { chargesFrom: lease.chargesFrom }, newValues: { chargesFrom } });
      updated = { ...lease, chargesFrom };
    }
    const horizon = addMonths(toPeriod(new Date()), 1);
    await ensureChargesForLease(prisma, updated, body.period > horizon ? body.period : horizon);

    const charge = await prisma.rentCharge.findFirst({ where: { leaseId: lease.id, period: body.period } });
    if (!charge) throw badRequest('Für diesen Monat besteht kein Mietverhältnis.');
    return { id: charge.id, period: charge.period, outstandingCents: charge.amountCents - charge.paidCents, label: lease.unit.label };
  });

  /** Vorschlag für die Aufteilung (ohne zu speichern) */
  app.post('/suggest-allocation', { preHandler: requirePermission('finance:read') }, async (req) => {
    const body = parse(z.object({ leaseId: z.string(), amountCents: z.coerce.number().int().positive(), period: z.string().nullish() }), req.body);
    const lease = await prisma.lease.findFirst({ where: { id: body.leaseId, unit: { property: { organizationId: req.user.organizationId } } } });
    if (!lease) throw notFound('Mietvertrag');
    // offene Monate aller Verträge des Mieters (z. B. Wohnung + Parkplatz); gewählter Vertrag zuerst
    const charges = await prisma.rentCharge.findMany({
      where: { lease: { tenantId: lease.tenantId, unit: { property: { organizationId: req.user.organizationId } } }, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
      include: { lease: { select: { unit: { select: { label: true } } } } },
      orderBy: { period: 'asc' },
    });
    const multi = new Set(charges.map((c) => c.leaseId)).size > 1;
    const toOpen = (c: (typeof charges)[number]) => ({ id: c.id, period: c.period, outstandingCents: c.amountCents - c.paidCents, ...(multi ? { label: c.lease.unit.label } : {}) });
    const open = charges
      .sort((a, b) => a.period.localeCompare(b.period) || Number(a.leaseId !== lease.id) - Number(b.leaseId !== lease.id))
      .map((c) => ({ id: c.id, period: c.period, outstandingCents: c.amountCents - c.paidCents, ...(multi ? { label: c.lease.unit.label } : {}) }));
    return {
      open,
      ...allocatePreferring(body.amountCents, charges.filter((c) => c.leaseId === lease.id).map(toOpen), charges.filter((c) => c.leaseId !== lease.id).map(toOpen), body.period),
    };
  });

  app.post('/', { preHandler: requirePermission('finance:write') }, async (req) => {
    const body = parse(
      z.object({
        leaseId: z.string().nullish(),
        bookingDate: z.coerce.date(),
        amountCents: z.coerce.number().int().positive(),
        method: z.enum(['BANK_TRANSFER', 'QR_BILL', 'STANDING_ORDER', 'DIRECT_DEBIT', 'CASH', 'OTHER']).default('BANK_TRANSFER'),
        reference: optStr,
        payerName: optStr,
        note: optStr,
        allocations: allocationSchema.default([]),
      }),
      req.body,
    );
    return createPayment({ ...body, organizationId: req.user.organizationId, source: 'MANUAL' }, { user: req.user, req });
  });

  /**
   * "Automatisch zuordnen": offenen Betrag auf den passenden Monat verteilen.
   * Fehlt die Monatsmiete (z. B. Zahlung vor dem Abrechnungsbeginn), wird sie nachgetragen – nie vor Mietbeginn.
   */
  app.post('/:id/auto-assign', { preHandler: requirePermission('finance:write') }, async (req) => autoAssign(parse(idParam, req.params).id, req));

  /** Alle Zahlungen "Zuordnung prüfen" auf einmal automatisch zuordnen */
  app.post('/auto-assign-all', { preHandler: requirePermission('finance:write') }, async (req) => {
    const list = await prisma.payment.findMany({
      where: { organizationId: req.user.organizationId, status: { in: ['REVIEW', 'PARTIAL', 'OVERPAID'] }, reversedAt: null, leaseId: { not: null }, propertyId: propertyIdFilter(req.user) },
      orderBy: { bookingDate: 'asc' },
      select: { id: true, number: true },
    });
    let assigned = 0;
    const failed: string[] = [];
    for (const p of list) {
      try {
        const r = await autoAssign(p.id, req);
        if (r.added) assigned++;
      } catch (e) {
        failed.push(`#${p.number}: ${e instanceof Error ? e.message : 'Fehler'}`);
      }
    }
    return { checked: list.length, assigned, failed };
  });

  app.post('/:id/reassign', { preHandler: requirePermission('finance:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ leaseId: z.string().nullable(), allocations: allocationSchema, reason: optStr }), req.body);
    return reassignPayment(id, body, { user: req.user, req });
  });

  app.post('/:id/reverse', { preHandler: requirePermission('finance:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ reason: z.string().trim().min(3) }), req.body);
    await reversePayment(id, body.reason, { user: req.user, req });
    return { ok: true };
  });
}
