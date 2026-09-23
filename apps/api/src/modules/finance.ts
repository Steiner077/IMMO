import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, formatMoney, periodRange, toPeriod } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { assertPropertyAccess, propertyIdFilter, requirePermission, scopedPropertyId } from '../auth/context.js';
import { auditReq, diff } from '../services/audit.js';
import { buildWorkbook } from '../services/excel.js';

const CATEGORY = z.enum(['REPAIR', 'INSURANCE', 'MORTGAGE', 'CARETAKER', 'ELECTRICITY', 'WATER', 'HEATING', 'CLEANING', 'MANAGEMENT', 'CRAFTSMEN', 'TAXES', 'OTHER']);
const expenseSchema = z.object({
  propertyId: z.string(),
  unitId: optStr,
  serviceProviderId: optStr,
  damageReportId: optStr,
  category: CATEGORY,
  date: z.coerce.date(),
  amountCents: z.coerce.number().int().positive(),
  description: z.string().trim().min(1).max(500),
  invoiceNumber: optStr,
});

export async function financeRoutes(app: FastifyInstance) {
  // ───── Ausgaben ─────
  app.get('/expenses', { preHandler: requirePermission('expense:read') }, async (req) => {
    const q = parse(z.object({ propertyId: z.string().optional(), year: z.coerce.number().optional(), category: z.string().optional() }), req.query);
    return prisma.expense.findMany({
      where: {
        organizationId: req.user.organizationId,
        propertyId: scopedPropertyId(req.user, q.propertyId),
        ...(q.year ? { date: { gte: new Date(Date.UTC(q.year, 0, 1)), lt: new Date(Date.UTC(q.year + 1, 0, 1)) } } : {}),
        ...(q.category ? { category: q.category as never } : {}),
      },
      include: {
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true } },
        serviceProvider: { select: { id: true, name: true } },
        damageReport: { select: { id: true, ticketNumber: true } },
        _count: { select: { documents: true } },
      },
      orderBy: { date: 'desc' },
    });
  });

  app.post('/expenses', { preHandler: requirePermission('expense:write') }, async (req) => {
    const body = parse(expenseSchema, req.body);
    assertPropertyAccess(req.user, body.propertyId);
    const p = await prisma.property.findFirst({ where: { id: body.propertyId, organizationId: req.user.organizationId } });
    if (!p) throw notFound('Immobilie');
    const e = await prisma.expense.create({ data: { ...body, organizationId: req.user.organizationId, createdById: req.user.id } });
    await auditReq(req, { action: 'expense.create', entityType: 'Expense', entityId: e.id, summary: `Ausgabe ${formatMoney(e.amountCents)} (${EXPENSE_CATEGORIES[e.category]}) für ${p.name}`, newValues: body });
    return e;
  });

  app.patch('/expenses/:id', { preHandler: requirePermission('expense:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const before = await prisma.expense.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!before) throw notFound('Ausgabe');
    assertPropertyAccess(req.user, before.propertyId);
    const body = parse(expenseSchema.partial(), req.body);
    const e = await prisma.expense.update({ where: { id }, data: body });
    const d = diff(before as unknown as Record<string, unknown>, body);
    if (d.changed) await auditReq(req, { action: 'expense.update', entityType: 'Expense', entityId: id, summary: `Ausgabe geändert`, ...d });
    return e;
  });

  app.delete('/expenses/:id', { preHandler: requirePermission('expense:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const e = await prisma.expense.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!e) throw notFound('Ausgabe');
    assertPropertyAccess(req.user, e.propertyId);
    await prisma.expense.delete({ where: { id } });
    await auditReq(req, { action: 'expense.delete', entityType: 'Expense', entityId: id, summary: `Ausgabe ${formatMoney(e.amountCents)} gelöscht`, oldValues: e });
    return { ok: true };
  });

  // ───── Finanzübersicht / Erfolgsrechnung ─────
  app.get('/finance/summary', { preHandler: requirePermission('finance:read') }, async (req) => {
    const q = parse(z.object({ year: z.coerce.number().int().default(new Date().getUTCFullYear()), propertyId: z.string().optional() }), req.query);
    const pf = scopedPropertyId(req.user, q.propertyId);
    const from = new Date(Date.UTC(q.year, 0, 1));
    const to = new Date(Date.UTC(q.year + 1, 0, 1));
    const months = periodRange(`${q.year}-01`, `${q.year}-12`);

    const [payments, expenses, charges, properties] = await Promise.all([
      prisma.payment.findMany({
        where: { organizationId: req.user.organizationId, reversedAt: null, bookingDate: { gte: from, lt: to }, ...(pf ? { propertyId: pf } : {}) },
        select: { amountCents: true, bookingDate: true, propertyId: true, unitId: true },
      }),
      prisma.expense.findMany({
        where: { organizationId: req.user.organizationId, date: { gte: from, lt: to }, propertyId: pf },
        select: { amountCents: true, date: true, propertyId: true, unitId: true, category: true },
      }),
      prisma.rentCharge.findMany({
        where: { period: { startsWith: `${q.year}-` }, status: { not: 'CANCELLED' }, lease: { unit: { propertyId: pf, property: { organizationId: req.user.organizationId } } } },
        select: { amountCents: true, paidCents: true, period: true, lease: { select: { unitId: true, unit: { select: { propertyId: true } } } } },
      }),
      prisma.property.findMany({
        where: { organizationId: req.user.organizationId, id: pf, archivedAt: null },
        include: { units: { where: { archivedAt: null }, select: { id: true, label: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((s, x) => s + f(x), 0);
    const monthly = months.map((m) => {
      const income = sum(payments.filter((p) => toPeriod(p.bookingDate) === m), (p) => p.amountCents);
      const exp = sum(expenses.filter((e) => toPeriod(e.date) === m), (e) => e.amountCents);
      const due = sum(charges.filter((c) => c.period === m), (c) => c.amountCents);
      return { period: m, dueCents: due, incomeCents: income, expenseCents: exp, netCents: income - exp };
    });
    const byProperty = properties.map((p) => {
      const income = sum(payments.filter((x) => x.propertyId === p.id), (x) => x.amountCents);
      const exp = sum(expenses.filter((x) => x.propertyId === p.id), (x) => x.amountCents);
      const due = sum(charges.filter((c) => c.lease.unit.propertyId === p.id), (c) => c.amountCents);
      return {
        id: p.id,
        name: p.name,
        dueCents: due,
        incomeCents: income,
        expenseCents: exp,
        netCents: income - exp,
        yieldPct: p.purchasePriceCents ? ((income - exp) / p.purchasePriceCents) * 100 : null,
        units: p.units.map((u) => {
          const ui = sum(payments.filter((x) => x.unitId === u.id), (x) => x.amountCents);
          const ue = sum(expenses.filter((x) => x.unitId === u.id), (x) => x.amountCents);
          return { id: u.id, label: u.label, incomeCents: ui, expenseCents: ue, netCents: ui - ue };
        }),
      };
    });
    const byCategory = Object.keys(EXPENSE_CATEGORIES)
      .map((c) => ({ category: c, amountCents: sum(expenses.filter((e) => e.category === c), (e) => e.amountCents) }))
      .filter((c) => c.amountCents > 0);
    const grossIncome = sum(payments, (p) => p.amountCents);
    const totalExpenses = sum(expenses, (e) => e.amountCents);
    return {
      year: q.year,
      totals: {
        dueCents: sum(charges, (c) => c.amountCents),
        grossIncomeCents: grossIncome,
        expenseCents: totalExpenses,
        netIncomeCents: grossIncome - totalExpenses,
      },
      monthly,
      byProperty,
      byCategory,
    };
  });

  // ───── Berichte ─────
  app.get('/reports/export.xlsx', { preHandler: requirePermission('report:read', 'finance:read') }, async (req, reply) => {
    const q = parse(z.object({ year: z.coerce.number().int().default(new Date().getUTCFullYear()) }), req.query);
    const buf = await buildWorkbook(req.user.organizationId, q.year);
    await auditReq(req, { action: 'report.export', entityType: 'Report', summary: `Excel-Auswertung ${q.year} exportiert` });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="IMMO-Auswertung-${q.year}.xlsx"`);
    return reply.send(buf);
  });

  /** Mieterspiegel: alle Mietobjekte mit aktuellem Mieter und Mietzins */
  app.get('/reports/rent-roll', { preHandler: requirePermission('report:read', 'finance:read') }, async (req) => {
    const units = await prisma.unit.findMany({
      where: { archivedAt: null, propertyId: propertyIdFilter(req.user), property: { organizationId: req.user.organizationId, archivedAt: null } },
      include: {
        property: { select: { id: true, name: true } },
        leases: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } } } },
      },
      orderBy: [{ property: { name: 'asc' } }, { label: 'asc' }],
    });
    return units.map((u) => {
      const l = u.leases[0];
      return {
        unitId: u.id,
        property: u.property,
        label: u.label,
        type: u.type,
        rooms: u.rooms,
        areaM2: u.areaM2,
        tenant: l?.tenant ?? null,
        leaseId: l?.id ?? null,
        startDate: l?.startDate ?? null,
        endDate: l?.endDate ?? null,
        netRentCents: l?.netRentCents ?? 0,
        utilitiesCents: l?.utilitiesCents ?? 0,
        targetRentCents: u.targetRentCents,
        vacant: !l,
      };
    });
  });
}
