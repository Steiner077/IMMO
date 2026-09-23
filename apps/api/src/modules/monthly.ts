import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addMonths, isValidPeriod, toPeriod } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { parse } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { propertyIdFilter, requirePermission, scopedPropertyId } from '../auth/context.js';
import { ensureChargesForOrganization } from '../services/charges.js';

export async function monthlyRoutes(app: FastifyInstance) {
  /** Monatsabschluss: Soll / Ist / Offen pro Monat mit allen Mietern */
  app.get('/:period', { preHandler: requirePermission('finance:read') }, async (req) => {
    const { period } = parse(z.object({ period: z.string() }), req.params);
    const q = parse(z.object({ propertyId: z.string().optional() }), req.query);
    if (!isValidPeriod(period)) throw badRequest('Ungültige Periode (YYYY-MM)');
    if (period <= addMonths(toPeriod(new Date()), 1)) await ensureChargesForOrganization(req.user.organizationId, period);

    const pf = propertyIdFilter(req.user);
    const charges = await prisma.rentCharge.findMany({
      where: {
        period,
        status: { not: 'CANCELLED' },
        lease: { unit: { propertyId: scopedPropertyId(req.user, q.propertyId), property: { organizationId: req.user.organizationId } } },
      },
      include: {
        lease: {
          include: {
            tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
            unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
          },
        },
        assignments: { where: { payment: { reversedAt: null } }, include: { payment: { select: { id: true, number: true, bookingDate: true, amountCents: true, source: true } } } },
      },
      orderBy: [{ lease: { unit: { property: { name: 'asc' } } } }, { lease: { unit: { label: 'asc' } } }],
    });
    const dueCents = charges.reduce((s, c) => s + c.amountCents, 0);
    const paidCents = charges.reduce((s, c) => s + Math.min(c.paidCents, c.amountCents), 0);
    const overpaidCents = charges.reduce((s, c) => s + Math.max(0, c.paidCents - c.amountCents), 0);
    const paidCount = charges.filter((c) => c.status === 'PAID' || c.status === 'OVERPAID').length;

    const byProperty = new Map<string, { id: string; name: string; dueCents: number; paidCents: number; count: number; paidCount: number }>();
    for (const c of charges) {
      const p = c.lease.unit.property;
      const e = byProperty.get(p.id) ?? { id: p.id, name: p.name, dueCents: 0, paidCents: 0, count: 0, paidCount: 0 };
      e.dueCents += c.amountCents;
      e.paidCents += Math.min(c.paidCents, c.amountCents);
      e.count++;
      if (c.status === 'PAID' || c.status === 'OVERPAID') e.paidCount++;
      byProperty.set(p.id, e);
    }

    const unassigned = await prisma.payment.aggregate({
      where: {
        organizationId: req.user.organizationId,
        reversedAt: null,
        status: { in: ['UNCLEAR', 'REVIEW'] },
        bookingDate: { gte: new Date(`${period}-01T00:00:00Z`), lt: new Date(`${addMonths(period, 1)}-01T00:00:00Z`) },
      },
      _sum: { amountCents: true },
      _count: true,
    });

    return {
      period,
      summary: {
        dueCents,
        paidCents,
        openCents: dueCents - paidCents,
        overpaidCents,
        count: charges.length,
        paidCount,
        partialCount: charges.filter((c) => c.status === 'PARTIAL').length,
        overdueCount: charges.filter((c) => c.status === 'OVERDUE').length,
        unassignedPayments: unassigned._count,
        unassignedCents: unassigned._sum.amountCents ?? 0,
      },
      byProperty: [...byProperty.values()],
      rows: charges.map((c) => ({
        chargeId: c.id,
        leaseId: c.leaseId,
        tenant: c.lease.tenant,
        unit: { id: c.lease.unit.id, label: c.lease.unit.label },
        property: c.lease.unit.property,
        dueDate: c.dueDate,
        amountCents: c.amountCents,
        paidCents: c.paidCents,
        openCents: Math.max(0, c.amountCents - c.paidCents),
        status: c.status,
        note: c.note,
        payments: c.assignments.map((a) => ({ ...a.payment, assignedCents: a.amountCents })),
      })),
    };
  });

  /** Jahresmatrix: Mieter × Monate */
  app.get('/year/:year', { preHandler: requirePermission('finance:read') }, async (req) => {
    const { year } = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100) }), req.params);
    const pf = propertyIdFilter(req.user);
    const charges = await prisma.rentCharge.findMany({
      where: { period: { startsWith: `${year}-` }, status: { not: 'CANCELLED' }, lease: { unit: { propertyId: pf, property: { organizationId: req.user.organizationId } } } },
      include: { lease: { include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } }, unit: { select: { label: true, property: { select: { name: true } } } } } } },
    });
    const rows = new Map<string, { leaseId: string; tenant: unknown; unit: string; property: string; months: Record<string, { status: string; amountCents: number; paidCents: number }> }>();
    for (const c of charges) {
      const r = rows.get(c.leaseId) ?? { leaseId: c.leaseId, tenant: c.lease.tenant, unit: c.lease.unit.label, property: c.lease.unit.property.name, months: {} };
      r.months[c.period] = { status: c.status, amountCents: c.amountCents, paidCents: c.paidCents };
      rows.set(c.leaseId, r);
    }
    return [...rows.values()].sort((a, b) => a.property.localeCompare(b.property) || a.unit.localeCompare(b.unit));
  });
}
