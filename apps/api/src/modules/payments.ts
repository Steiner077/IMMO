import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, pagination, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { propertyIdFilter, requirePermission, scopedPropertyId } from '../auth/context.js';
import { createPayment, reassignPayment, reversePayment } from '../services/payments.js';
import { allocatePreferring } from '../import/allocation.js';
import { addMonths, toPeriod } from '@immo/shared';

const allocationSchema = z.array(z.object({ chargeId: z.string(), amountCents: z.coerce.number().int().positive() }));

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

  /** Für "Zahlung erfassen": alle Mieter mit laufenden Verträgen und ihren offenen Monaten */
  app.get('/open-items', { preHandler: requirePermission('finance:read') }, async (req) => {
    const until = addMonths(toPeriod(new Date()), 1);
    const leases = await prisma.lease.findMany({
      where: {
        status: { in: ['ACTIVE', 'TERMINATED', 'ENDED'] },
        unit: { propertyId: propertyIdFilter(req.user), property: { organizationId: req.user.organizationId } },
      },
      include: {
        tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        unit: { select: { label: true, type: true, property: { select: { name: true } } } },
        charges: { where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] }, period: { lte: until } }, orderBy: { period: 'asc' } },
      },
    });
    const byTenant = new Map<string, { tenant: (typeof leases)[number]['tenant']; leases: { id: string; label: string; property: string; monthlyCents: number; active: boolean }[]; open: { chargeId: string; leaseId: string; period: string; label: string; property: string; outstandingCents: number; status: string; dueDate: Date }[] }>();
    for (const l of leases) {
      if (l.status === 'ENDED' && !l.charges.length) continue;
      const e = byTenant.get(l.tenantId) ?? { tenant: l.tenant, leases: [], open: [] };
      e.leases.push({ id: l.id, label: l.unit.label, property: l.unit.property.name, monthlyCents: l.netRentCents + l.utilitiesCents, active: l.status !== 'ENDED' });
      for (const c of l.charges) e.open.push({ chargeId: c.id, leaseId: l.id, period: c.period, label: l.unit.label, property: l.unit.property.name, outstandingCents: c.amountCents - c.paidCents, status: c.status, dueDate: c.dueDate });
      byTenant.set(l.tenantId, e);
    }
    return [...byTenant.values()]
      .map((e) => ({ ...e, open: e.open.sort((a, b) => a.period.localeCompare(b.period) || a.label.localeCompare(b.label, 'de', { numeric: true })), openCents: e.open.reduce((s, o) => s + o.outstandingCents, 0) }))
      .sort((a, b) => b.openCents - a.openCents || (a.tenant.lastName ?? a.tenant.companyName ?? '').localeCompare(b.tenant.lastName ?? b.tenant.companyName ?? ''));
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
