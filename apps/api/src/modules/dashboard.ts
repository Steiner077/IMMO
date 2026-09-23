import type { FastifyInstance } from 'fastify';
import { addMonths, toPeriod } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { can, propertyIdFilter, requirePermission } from '../auth/context.js';
import { ensureChargesForOrganization } from '../services/charges.js';
import { getOrgSettings } from '../services/settings.js';

const OPEN_DAMAGE = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING'] as const;

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('dashboard:read') }, async (req) => {
    const orgId = req.user.organizationId;
    const pf = propertyIdFilter(req.user);
    const period = toPeriod(new Date());
    const settings = await getOrgSettings(orgId);
    await ensureChargesForOrganization(orgId, period);

    const propertyWhere = { organizationId: orgId, archivedAt: null, id: pf };
    const [propertyCount, unitCount, activeLeases, openDamages, openTasks, expiringLeases] = await Promise.all([
      prisma.property.count({ where: propertyWhere }),
      prisma.unit.count({ where: { archivedAt: null, property: propertyWhere } }),
      prisma.lease.count({ where: { status: { in: ['ACTIVE', 'TERMINATED'] }, unit: { property: propertyWhere } } }),
      prisma.damageReport.count({ where: { organizationId: orgId, propertyId: pf, status: { in: [...OPEN_DAMAGE] } } }),
      prisma.task.count({
        where: {
          organizationId: orgId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          ...(pf ? { OR: [{ assigneeId: req.user.id }, { propertyId: pf }] } : {}),
        },
      }),
      prisma.lease.findMany({
        where: {
          status: { in: ['ACTIVE', 'TERMINATED'] },
          endDate: { gte: new Date(), lte: new Date(Date.now() + settings.leaseExpiryNoticeDays * 86400000) },
          unit: { property: propertyWhere },
        },
        include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } }, unit: { select: { label: true, property: { select: { name: true } } } } },
        orderBy: { endDate: 'asc' },
        take: 10,
      }),
    ]);

    const recentDamages = await prisma.damageReport.findMany({
      where: { organizationId: orgId, propertyId: pf, status: { in: [...OPEN_DAMAGE] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 6,
      include: { property: { select: { name: true } }, unit: { select: { label: true } } },
    });
    const upcoming = await prisma.appointment.findMany({
      where: { organizationId: orgId, startAt: { gte: new Date() }, ...(pf ? { OR: [{ propertyId: pf }, { createdById: req.user.id }] } : {}) },
      orderBy: { startAt: 'asc' },
      take: 5,
      include: { property: { select: { name: true } } },
    });

    // Mängelentwicklung (12 Monate)
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1));
    const damagesYear = await prisma.damageReport.findMany({
      where: { organizationId: orgId, propertyId: pf, OR: [{ createdAt: { gte: since } }, { resolvedAt: { gte: since } }] },
      select: { createdAt: true, resolvedAt: true },
    });
    const months = Array.from({ length: 12 }, (_, i) => addMonths(toPeriod(since), i));
    const damageTrend = months.map((m) => ({
      period: m,
      created: damagesYear.filter((d) => toPeriod(d.createdAt) === m).length,
      resolved: damagesYear.filter((d) => d.resolvedAt && toPeriod(d.resolvedAt) === m).length,
    }));

    const base = {
      period,
      kpis: { propertyCount, unitCount, activeLeases, openDamages, openTasks, expiringLeases: expiringLeases.length, vacancies: unitCount - activeLeases },
      expiringLeases,
      recentDamages,
      upcoming,
      damageTrend,
    };
    if (!can(req.user, 'finance:read')) return base;

    // ───── Finanzkennzahlen ─────
    const chargeScope = { lease: { unit: { property: propertyWhere } }, status: { not: 'CANCELLED' as const } };
    const current = await prisma.rentCharge.aggregate({ where: { ...chargeScope, period }, _sum: { amountCents: true, paidCents: true } });
    const overdue = await prisma.rentCharge.findMany({
      where: { ...chargeScope, status: { in: ['OVERDUE', 'PARTIAL'] }, dueDate: { lt: new Date() } },
      include: { lease: { include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } }, unit: { select: { label: true, property: { select: { name: true } } } } } } },
      orderBy: { dueDate: 'asc' },
    });
    const overdueCents = overdue.reduce((s, c) => s + c.amountCents - c.paidCents, 0);

    const charges12 = await prisma.rentCharge.groupBy({
      by: ['period'],
      where: { ...chargeScope, period: { gte: months[0], lte: months[11] } },
      _sum: { amountCents: true, paidCents: true },
    });
    const incomeByMonth = months.map((m) => {
      const c = charges12.find((x) => x.period === m);
      return { period: m, dueCents: c?._sum.amountCents ?? 0, paidCents: c?._sum.paidCents ?? 0 };
    });
    // Tatsächliche Zahlungseingänge (nach Buchungsdatum)
    const payments12 = await prisma.payment.findMany({
      where: { organizationId: orgId, reversedAt: null, bookingDate: { gte: since }, ...(pf ? { propertyId: pf } : {}) },
      select: { bookingDate: true, amountCents: true, propertyId: true },
    });
    const receivedByMonth = months.map((m) => payments12.filter((p) => toPeriod(p.bookingDate) === m).reduce((s, p) => s + p.amountCents, 0));

    const year = new Date().getUTCFullYear();
    const properties = await prisma.property.findMany({ where: propertyWhere, select: { id: true, name: true } });
    const yearPayments = payments12.filter((p) => p.bookingDate.getUTCFullYear() === year);
    const expenses = await prisma.expense.groupBy({
      by: ['propertyId'],
      where: { organizationId: orgId, propertyId: pf, date: { gte: new Date(Date.UTC(year, 0, 1)) } },
      _sum: { amountCents: true },
    });
    const byProperty = properties.map((p) => ({
      id: p.id,
      name: p.name,
      incomeCents: yearPayments.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amountCents, 0),
      expenseCents: expenses.find((e) => e.propertyId === p.id)?._sum.amountCents ?? 0,
    }));

    const receivablesByTenant = new Map<string, { tenant: unknown; unit: string; property: string; openCents: number; oldest: string }>();
    for (const c of overdue) {
      const key = c.lease.tenantId;
      const e = receivablesByTenant.get(key) ?? { tenant: c.lease.tenant, unit: c.lease.unit.label, property: c.lease.unit.property.name, openCents: 0, oldest: c.period };
      e.openCents += c.amountCents - c.paidCents;
      if (c.period < e.oldest) e.oldest = c.period;
      receivablesByTenant.set(key, e);
    }

    const pendingReview = await prisma.importRow.count({
      where: { batch: { organizationId: orgId, status: { in: ['READY', 'PARTIALLY_POSTED'] } }, status: { in: ['NEEDS_REVIEW', 'UNMATCHED'] } },
    });

    return {
      ...base,
      kpis: {
        ...base.kpis,
        dueCents: current._sum.amountCents ?? 0,
        paidCents: current._sum.paidCents ?? 0,
        openCents: (current._sum.amountCents ?? 0) - (current._sum.paidCents ?? 0),
        overdueCents,
        overdueCount: overdue.length,
        pendingReview,
      },
      incomeByMonth: incomeByMonth.map((m, i) => ({ ...m, receivedCents: receivedByMonth[i] })),
      byProperty,
      receivables: [...receivablesByTenant.values()].sort((a, b) => b.openCents - a.openCents).slice(0, 10),
    };
  });
}
