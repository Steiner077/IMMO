import { addMonths, comparePeriods, periodToDate, toPeriod } from '@immo/shared';
import type { Lease } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { chargeStatus } from '../import/allocation.js';

function daysInMonth(period: string) {
  const d = periodToDate(period);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Berechnet den Sollbetrag eines Monats. Beginnt oder endet ein Vertrag
 * innerhalb des Monats, wird taggenau anteilig berechnet.
 */
export function chargeAmountForPeriod(lease: Pick<Lease, 'startDate' | 'endDate' | 'netRentCents' | 'utilitiesCents'>, period: string) {
  const dim = daysInMonth(period);
  const first = periodToDate(period);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), dim));
  const from = lease.startDate > first ? lease.startDate : first;
  const to = lease.endDate && lease.endDate < last ? lease.endDate : last;
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  if (days <= 0) return null;
  const ratio = days >= dim ? 1 : days / dim;
  const net = Math.round(lease.netRentCents * ratio);
  const util = Math.round(lease.utilitiesCents * ratio);
  return { netRentCents: net, utilitiesCents: util, amountCents: net + util, prorated: ratio < 1 };
}

export function dueDateFor(period: string, dueDay: number) {
  const d = periodToDate(period);
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(period));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day));
}

/** Erzeugt fehlende Sollstellungen eines Vertrags bis einschliesslich untilPeriod. */
export async function ensureChargesForLease(db: Db, lease: Lease, untilPeriod: string): Promise<number> {
  if (lease.status === 'DRAFT') return 0;
  const effectiveStart = lease.chargesFrom && lease.chargesFrom > lease.startDate ? lease.chargesFrom : lease.startDate;
  const startPeriod = toPeriod(effectiveStart);
  const endPeriod = lease.endDate ? toPeriod(lease.endDate) : null;
  const last = endPeriod && comparePeriods(endPeriod, untilPeriod) < 0 ? endPeriod : untilPeriod;
  if (comparePeriods(startPeriod, last) > 0) return 0;
  const existing = new Set(
    (await db.rentCharge.findMany({ where: { leaseId: lease.id }, select: { period: true } })).map((c) => c.period),
  );
  const data = [];
  for (let p = startPeriod; comparePeriods(p, last) <= 0; p = addMonths(p, 1)) {
    if (existing.has(p)) continue;
    const amt = chargeAmountForPeriod(lease, p);
    if (!amt) continue;
    const dueDate = dueDateFor(p, lease.dueDay);
    data.push({
      leaseId: lease.id,
      period: p,
      dueDate,
      netRentCents: amt.netRentCents,
      utilitiesCents: amt.utilitiesCents,
      amountCents: amt.amountCents,
      status: chargeStatus(amt.amountCents, 0, dueDate),
      note: amt.prorated ? 'Anteilig berechnet' : null,
    });
  }
  if (data.length) await db.rentCharge.createMany({ data, skipDuplicates: true });
  return data.length;
}

export async function ensureChargesForOrganization(organizationId: string, untilPeriod: string, db: Db = prisma) {
  const leases = await db.lease.findMany({
    where: { status: { in: ['ACTIVE', 'TERMINATED'] }, unit: { property: { organizationId } } },
  });
  let created = 0;
  for (const l of leases) created += await ensureChargesForLease(db, l, untilPeriod);
  return created;
}

/**
 * Berechnet Ist-Betrag und Status einer Sollstellung neu – ausschliesslich
 * aus den Zuordnungen nicht stornierter Zahlungen (Single Source of Truth).
 */
export async function recalcCharge(db: Db, chargeId: string, now = new Date()) {
  const charge = await db.rentCharge.findUniqueOrThrow({ where: { id: chargeId } });
  const agg = await db.paymentAssignment.aggregate({
    where: { rentChargeId: chargeId, payment: { reversedAt: null } },
    _sum: { amountCents: true },
  });
  const paid = agg._sum.amountCents ?? 0;
  const status = charge.status === 'CANCELLED' ? 'CANCELLED' : chargeStatus(charge.amountCents, paid, charge.dueDate, now);
  if (paid !== charge.paidCents || status !== charge.status) {
    await db.rentCharge.update({ where: { id: chargeId }, data: { paidCents: paid, status } });
  }
  return { paid, status };
}

/** Aktualisiert "Offen" → "Überfällig" für alle fälligen Sollstellungen. */
export async function refreshOverdue(organizationId: string, db: Db = prisma, now = new Date()) {
  const candidates = await db.rentCharge.findMany({
    where: { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now }, lease: { unit: { property: { organizationId } } } },
    select: { id: true },
  });
  let changed = 0;
  for (const c of candidates) {
    const before = await db.rentCharge.findUnique({ where: { id: c.id }, select: { status: true } });
    const r = await recalcCharge(db, c.id, now);
    if (before?.status !== r.status) changed++;
  }
  return changed;
}

export function monthlyTotal(lease: Pick<Lease, 'netRentCents' | 'utilitiesCents'>) {
  return lease.netRentCents + lease.utilitiesCents;
}
