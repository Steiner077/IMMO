import { createHash } from 'node:crypto';
import { normalizeText, formatMoney, formatPeriod } from '@immo/shared';
import type { PaymentMethod, PaymentSource, PaymentStatus } from '@prisma/client';
import { financialTx, type Db, type Tx } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { nextNumber } from '../lib/counter.js';
import { recalcCharge } from './charges.js';
import { audit } from './audit.js';
import type { AuthUser } from '../auth/context.js';
import type { FastifyRequest } from 'fastify';

export function paymentFingerprint(p: { bookingDate: Date; amountCents: number; payerName?: string | null; reference?: string | null }) {
  const key = [p.bookingDate.toISOString().slice(0, 10), p.amountCents, normalizeText(p.payerName), normalizeText(p.reference)].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 40);
}

export interface AllocationInput {
  chargeId: string;
  amountCents: number;
}

export interface CreatePaymentInput {
  organizationId: string;
  tenantId?: string | null;
  leaseId?: string | null;
  bookingDate: Date;
  valueDate?: Date | null;
  amountCents: number;
  method?: PaymentMethod;
  reference?: string | null;
  payerName?: string | null;
  payerIban?: string | null;
  rawText?: string | null;
  source?: PaymentSource;
  documentId?: string | null;
  importRowId?: string | null;
  confidence?: number | null;
  note?: string | null;
  allocations: AllocationInput[];
  automatic?: boolean;
}

/** Leitet den Zahlungsstatus aus Zuordnung und Restbetrag ab. */
export function derivePaymentStatus(amountCents: number, assignedCents: number, hasLease: boolean, hasOpenCharges: boolean): PaymentStatus {
  if (!hasLease) return 'UNCLEAR';
  if (assignedCents === amountCents) return 'ASSIGNED';
  if (assignedCents === 0) return 'REVIEW';
  return hasOpenCharges ? 'PARTIAL' : 'OVERPAID';
}

async function validateAllocations(tx: Tx, leaseId: string | null | undefined, amountCents: number, allocations: AllocationInput[]) {
  const total = allocations.reduce((s, a) => s + a.amountCents, 0);
  if (allocations.some((a) => a.amountCents <= 0)) throw badRequest('Zuordnungsbeträge müssen positiv sein.');
  if (total > amountCents) throw badRequest('Die Zuordnung übersteigt den Zahlungsbetrag.');
  if (!allocations.length) return [];
  if (!leaseId) throw badRequest('Für eine Zuordnung muss ein Mietvertrag gewählt sein.');
  const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId }, select: { tenantId: true } });
  const charges = await tx.rentCharge.findMany({ where: { id: { in: allocations.map((a) => a.chargeId) } }, include: { lease: { select: { tenantId: true } } } });
  for (const a of allocations) {
    const c = charges.find((x) => x.id === a.chargeId);
    if (!c) throw badRequest('Sollstellung nicht gefunden.');
    // erlaubt: alle Verträge desselben Mieters (z. B. Wohnung + Parkplatz in einer Zahlung)
    if (c.lease.tenantId !== lease.tenantId) throw badRequest('Sollstellung gehört nicht zu diesem Mieter.');
  }
  return charges;
}

/**
 * Erfasst eine Zahlung inkl. Zuordnung zu Monaten in einer Transaktion.
 * Alle abhängigen Werte (Sollstellungen, Status) werden konsistent aktualisiert.
 */
export async function createPayment(input: CreatePaymentInput, actor: { user: AuthUser; req?: FastifyRequest }, db?: Tx) {
  const run = async (tx: Tx) => {
    let lease = null;
    if (input.leaseId) {
      lease = await tx.lease.findFirst({
        where: { id: input.leaseId, unit: { property: { organizationId: input.organizationId } } },
        include: { unit: true },
      });
      if (!lease) throw notFound('Mietvertrag');
      if (input.tenantId && input.tenantId !== lease.tenantId) throw badRequest('Mieter und Mietvertrag passen nicht zusammen.');
    }
    await validateAllocations(tx, input.leaseId, input.amountCents, input.allocations);

    const fingerprint = paymentFingerprint(input);
    const number = await nextNumber(tx, input.organizationId, 'payment', 1);
    const assigned = input.allocations.reduce((s, a) => s + a.amountCents, 0);

    const payment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        number,
        tenantId: lease?.tenantId ?? input.tenantId ?? null,
        leaseId: lease?.id ?? null,
        unitId: lease?.unitId ?? null,
        propertyId: lease?.unit.propertyId ?? null,
        bookingDate: input.bookingDate,
        valueDate: input.valueDate ?? null,
        amountCents: input.amountCents,
        expectedCents: lease ? lease.netRentCents + lease.utilitiesCents : null,
        method: input.method ?? 'BANK_TRANSFER',
        reference: input.reference ?? null,
        payerName: input.payerName ?? null,
        payerIban: input.payerIban ?? null,
        rawText: input.rawText ?? null,
        source: input.source ?? 'MANUAL',
        documentId: input.documentId ?? null,
        importRowId: input.importRowId ?? null,
        confidence: input.confidence ?? null,
        note: input.note ?? null,
        fingerprint,
        status: 'REVIEW',
        createdById: actor.user.id,
      },
    });
    for (const a of input.allocations) {
      await tx.paymentAssignment.create({
        data: {
          paymentId: payment.id,
          rentChargeId: a.chargeId,
          amountCents: a.amountCents,
          automatic: input.automatic ?? false,
          confidence: input.confidence ?? null,
          createdById: actor.user.id,
        },
      });
      await recalcCharge(tx, a.chargeId);
    }
    const status = await refreshPaymentStatus(tx, payment.id);
    await audit(
      { user: actor.user, organizationId: input.organizationId, req: actor.req },
      {
        action: 'payment.create',
        entityType: 'Payment',
        entityId: payment.id,
        summary: `Zahlung #${number} über ${formatMoney(input.amountCents)} erfasst (${input.source ?? 'MANUAL'})`,
        newValues: { amountCents: input.amountCents, leaseId: lease?.id, allocations: input.allocations, status, assigned },
      },
      tx,
    );
    return { ...payment, status };
  };
  return db ? run(db) : financialTx(run);
}

export async function refreshPaymentStatus(tx: Db, paymentId: string): Promise<PaymentStatus> {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { assignments: true } });
  if (p.reversedAt) return 'REVERSED';
  const assigned = p.assignments.reduce((s, a) => s + a.amountCents, 0);
  let hasOpen = false;
  if (p.leaseId && p.tenantId) {
    hasOpen = (await tx.rentCharge.count({ where: { lease: { tenantId: p.tenantId }, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } } })) > 0;
  }
  const status = derivePaymentStatus(p.amountCents, assigned, !!p.leaseId, hasOpen);
  if (status !== p.status) await tx.payment.update({ where: { id: p.id }, data: { status } });
  return status;
}

/** Ändert die Zuordnung einer Zahlung (inkl. Mieter/Vertrag). Vollständig protokolliert. */
export async function reassignPayment(
  paymentId: string,
  input: { leaseId: string | null; allocations: AllocationInput[]; reason?: string | null },
  actor: { user: AuthUser; req?: FastifyRequest },
) {
  return financialTx(
    async (tx) => {
      const p = await tx.payment.findFirst({
        where: { id: paymentId, organizationId: actor.user.organizationId },
        include: { assignments: { include: { rentCharge: true } } },
      });
      if (!p) throw notFound('Zahlung');
      if (p.reversedAt) throw conflict('Stornierte Zahlungen können nicht geändert werden.');
      let lease = null;
      if (input.leaseId) {
        lease = await tx.lease.findFirst({
          where: { id: input.leaseId, unit: { property: { organizationId: actor.user.organizationId } } },
          include: { unit: true },
        });
        if (!lease) throw notFound('Mietvertrag');
      }
      await validateAllocations(tx, input.leaseId, p.amountCents, input.allocations);
      const oldValues = {
        leaseId: p.leaseId,
        tenantId: p.tenantId,
        allocations: p.assignments.map((a) => ({ period: a.rentCharge.period, amountCents: a.amountCents })),
      };
      await tx.paymentAssignment.deleteMany({ where: { paymentId } });
      const touched = new Set(p.assignments.map((a) => a.rentChargeId));
      for (const a of input.allocations) {
        await tx.paymentAssignment.create({
          data: { paymentId, rentChargeId: a.chargeId, amountCents: a.amountCents, automatic: false, createdById: actor.user.id },
        });
        touched.add(a.chargeId);
      }
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          leaseId: lease?.id ?? null,
          tenantId: lease?.tenantId ?? null,
          unitId: lease?.unitId ?? null,
          propertyId: lease?.unit.propertyId ?? null,
          expectedCents: lease ? lease.netRentCents + lease.utilitiesCents : null,
        },
      });
      for (const id of touched) await recalcCharge(tx, id);
      const status = await refreshPaymentStatus(tx, paymentId);
      const charges = await tx.rentCharge.findMany({ where: { id: { in: input.allocations.map((a) => a.chargeId) } } });
      await audit(
        { user: actor.user, organizationId: actor.user.organizationId, req: actor.req },
        {
          action: 'payment.reassign',
          entityType: 'Payment',
          entityId: paymentId,
          summary: `Zuordnung von Zahlung #${p.number} geändert${input.reason ? `: ${input.reason}` : ''}`,
          oldValues,
          newValues: {
            leaseId: lease?.id ?? null,
            tenantId: lease?.tenantId ?? null,
            allocations: input.allocations.map((a) => ({
              period: charges.find((c) => c.id === a.chargeId)?.period,
              amountCents: a.amountCents,
            })),
            status,
          },
        },
        tx,
      );
      return { status };
    },
  );
}

/** Storno: die Zahlung bleibt zur Nachvollziehbarkeit erhalten, wirkt aber nicht mehr. */
export async function reversePayment(paymentId: string, reason: string, actor: { user: AuthUser; req?: FastifyRequest }) {
  return financialTx(async (tx) => {
    const p = await tx.payment.findFirst({
      where: { id: paymentId, organizationId: actor.user.organizationId },
      include: { assignments: true },
    });
    if (!p) throw notFound('Zahlung');
    if (p.reversedAt) throw conflict('Zahlung ist bereits storniert.');
    await tx.payment.update({ where: { id: paymentId }, data: { reversedAt: new Date(), reversalReason: reason, status: 'REVERSED' } });
    for (const a of p.assignments) await recalcCharge(tx, a.rentChargeId);
    await audit(
      { user: actor.user, organizationId: actor.user.organizationId, req: actor.req },
      {
        action: 'payment.reverse',
        entityType: 'Payment',
        entityId: paymentId,
        summary: `Zahlung #${p.number} über ${formatMoney(p.amountCents)} storniert: ${reason}`,
        oldValues: { status: p.status },
        newValues: { status: 'REVERSED', reason },
      },
      tx,
    );
  });
}

/** Mieterkonto: Soll, Ist, Saldo und Monatsliste */
export async function tenantAccount(tenantId: string, organizationId: string) {
  const leases = await prisma.lease.findMany({
    where: { tenantId, unit: { property: { organizationId } } },
    include: {
      unit: { include: { property: { select: { id: true, name: true } } } },
      charges: { orderBy: { period: 'desc' }, include: { assignments: { include: { payment: { select: { id: true, number: true, bookingDate: true, reversedAt: true } } } } } },
    },
    orderBy: { startDate: 'desc' },
  });
  const payments = await prisma.payment.findMany({
    where: { tenantId, organizationId },
    orderBy: { bookingDate: 'desc' },
    include: { assignments: { include: { rentCharge: { select: { period: true } } } } },
  });
  const today = new Date();
  let dueCents = 0;
  for (const l of leases) for (const c of l.charges) if (c.dueDate <= today && c.status !== 'CANCELLED') dueCents += c.amountCents;
  const paidCents = payments.filter((p) => !p.reversedAt).reduce((s, p) => s + p.amountCents, 0);
  const openCents = leases
    .flatMap((l) => l.charges)
    .filter((c) => c.dueDate <= today && c.status !== 'CANCELLED')
    .reduce((s, c) => s + Math.max(0, c.amountCents - c.paidCents), 0);
  return {
    leases,
    payments,
    summary: {
      dueCents,
      paidCents,
      openCents,
      balanceCents: paidCents - dueCents,
    },
  };
}

export function periodLabel(p: string) {
  return formatPeriod(p);
}
