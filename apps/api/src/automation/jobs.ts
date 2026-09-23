import { addMonths, formatDate, formatMoney, formatPeriod, toPeriod } from '@immo/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { ensureChargesForOrganization, refreshOverdue } from '../services/charges.js';
import { notifyStaff, notifyUsers } from '../services/notifications.js';
import { getOrgSettings } from '../services/settings.js';
import { createExcelSnapshot } from '../services/excel.js';

export interface JobContext {
  organizationId: string;
  trigger: 'SCHEDULE' | 'MANUAL' | 'EVENT';
  userId?: string;
}

export interface JobDefinition {
  key: string;
  name: string;
  description: string;
  schedule: string;
  run: (ctx: JobContext) => Promise<Record<string, unknown>>;
}

async function alreadyNotified(userOrgId: string, type: string, entityId: string, sinceDays: number) {
  const since = new Date(Date.now() - sinceDays * 86400000);
  return (await prisma.notification.count({ where: { organizationId: userOrgId, type, entityId, createdAt: { gte: since } } })) > 0;
}

export const JOBS: JobDefinition[] = [
  {
    key: 'generate-charges',
    name: 'Monatliche Sollstellungen erzeugen',
    description: 'Erstellt für alle aktiven Mietverträge die monatlichen Mietforderungen (inkl. anteiliger Monate).',
    schedule: 'täglich',
    run: async ({ organizationId }) => {
      const s = await getOrgSettings(organizationId);
      const until = addMonths(toPeriod(new Date()), s.chargesMonthsAhead);
      const created = await ensureChargesForOrganization(organizationId, until);
      return { created, until };
    },
  },
  {
    key: 'overdue-check',
    name: 'Überfällige Mieten prüfen',
    description: 'Markiert fällige, unbezahlte Mieten als überfällig und informiert die Verwaltung.',
    schedule: 'täglich',
    run: async ({ organizationId }) => {
      const s = await getOrgSettings(organizationId);
      const changed = await refreshOverdue(organizationId);
      const overdue = await prisma.rentCharge.findMany({
        where: { status: { in: ['OVERDUE', 'PARTIAL'] }, dueDate: { lt: new Date(Date.now() - s.overdueGraceDays * 86400000) }, lease: { unit: { property: { organizationId } } } },
        include: { lease: { include: { tenant: { include: { user: true } }, unit: true } } },
      });
      let notified = 0;
      for (const c of overdue) {
        if (await alreadyNotified(organizationId, 'RENT_OVERDUE', c.id, 7)) continue;
        const name = c.lease.tenant.companyName ?? `${c.lease.tenant.firstName ?? ''} ${c.lease.tenant.lastName ?? ''}`.trim();
        await notifyStaff({
          organizationId,
          type: 'RENT_OVERDUE',
          title: `Miete überfällig: ${name}`,
          body: `${formatPeriod(c.period)} · offen ${formatMoney(c.amountCents - c.paidCents)} · Wohnung ${c.lease.unit.label}`,
          link: `/mieter/${c.lease.tenantId}`,
          entityType: 'RentCharge',
          entityId: c.id,
          propertyId: c.lease.unit.propertyId,
          roles: ['OWNER', 'MANAGER', 'EMPLOYEE'],
        });
        if (s.notifyTenantsOverdue && c.lease.tenant.user) {
          await notifyUsers([c.lease.tenant.user.id], {
            organizationId,
            type: 'RENT_OPEN',
            title: 'Offene Miete',
            body: `Für ${formatPeriod(c.period)} ist noch ${formatMoney(c.amountCents - c.paidCents)} offen.`,
            link: '/zahlungen',
            entityType: 'RentCharge',
            entityId: c.id,
          });
        }
        notified++;
      }
      return { statusChanged: changed, overdue: overdue.length, notified };
    },
  },
  {
    key: 'lease-expiry',
    name: 'Auslaufende Mietverträge',
    description: 'Informiert rechtzeitig über Verträge, die innerhalb der Vorlaufzeit enden.',
    schedule: 'täglich',
    run: async ({ organizationId }) => {
      const s = await getOrgSettings(organizationId);
      const until = new Date(Date.now() + s.leaseExpiryNoticeDays * 86400000);
      const leases = await prisma.lease.findMany({
        where: { status: { in: ['ACTIVE', 'TERMINATED'] }, endDate: { gte: new Date(), lte: until }, unit: { property: { organizationId } } },
        include: { tenant: true, unit: true },
      });
      let notified = 0;
      for (const l of leases) {
        if (await alreadyNotified(organizationId, 'LEASE_EXPIRING', l.id, 30)) continue;
        await notifyStaff({
          organizationId,
          type: 'LEASE_EXPIRING',
          title: `Mietvertrag endet am ${formatDate(l.endDate)}`,
          body: `${l.tenant.firstName ?? ''} ${l.tenant.lastName ?? l.tenant.companyName ?? ''} · Wohnung ${l.unit.label}`,
          link: `/mietvertraege/${l.id}`,
          entityType: 'Lease',
          entityId: l.id,
          propertyId: l.unit.propertyId,
        });
        notified++;
      }
      // Beendete Verträge automatisch abschliessen
      const ended = await prisma.lease.updateMany({
        where: { status: { in: ['ACTIVE', 'TERMINATED'] }, endDate: { lt: new Date() }, unit: { property: { organizationId } } },
        data: { status: 'ENDED' },
      });
      return { expiring: leases.length, notified, ended: ended.count };
    },
  },
  {
    key: 'appointment-reminders',
    name: 'Terminerinnerungen',
    description: 'Erinnert Beteiligte am Vortag an anstehende Termine.',
    schedule: 'stündlich',
    run: async ({ organizationId }) => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 36 * 3600000);
      const appts = await prisma.appointment.findMany({
        where: { organizationId, reminderSentAt: null, startAt: { gte: now, lte: tomorrow } },
        include: { tenant: { include: { user: true } } },
      });
      for (const a of appts) {
        const recipients = [a.createdById, a.visibleToTenant ? a.tenant?.user?.id : null].filter(Boolean) as string[];
        await notifyUsers(recipients, {
          organizationId,
          type: 'APPOINTMENT_REMINDER',
          title: `Termin: ${a.title}`,
          body: `${formatDate(a.startAt)} ${a.startAt.toISOString().slice(11, 16)} UTC${a.location ? ` · ${a.location}` : ''}`,
          link: '/termine',
          entityType: 'Appointment',
          entityId: a.id,
        });
        await prisma.appointment.update({ where: { id: a.id }, data: { reminderSentAt: now } });
      }
      return { reminded: appts.length };
    },
  },
  {
    key: 'excel-snapshot',
    name: 'Excel-Datei aktualisieren',
    description: 'Legt nach dem Verbuchen automatisch eine aktuelle Excel-Auswertung in den Dokumenten ab (bestehende Dateien werden nie überschrieben).',
    schedule: 'nach Verbuchung',
    run: async ({ organizationId, userId }) => {
      const doc = await createExcelSnapshot(organizationId, userId ?? null);
      return { documentId: doc.id, name: doc.name };
    },
  },
];

export async function runJob(key: string, ctx: JobContext) {
  const job = JOBS.find((j) => j.key === key);
  if (!job) throw new Error(`Unbekannter Job ${key}`);
  const run = await prisma.automationRun.create({ data: { organizationId: ctx.organizationId, job: key, trigger: ctx.trigger } });
  try {
    const result = await job.run(ctx);
    return await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', result: result as Prisma.InputJsonValue, finishedAt: new Date() },
    });
  } catch (e) {
    logger.error({ err: e, job: key }, 'Automatisierung fehlgeschlagen');
    return prisma.automationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: (e as Error).message, finishedAt: new Date() },
    });
  }
}
