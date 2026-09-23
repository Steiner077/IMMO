import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { runJob } from './jobs.js';

const DAILY = ['generate-charges', 'overdue-check', 'lease-expiry'];
const HOURLY = ['appointment-reminders'];

async function lastRun(organizationId: string, job: string) {
  return prisma.automationRun.findFirst({
    where: { organizationId, job, status: 'SUCCESS' },
    orderBy: { startedAt: 'desc' },
  });
}

export async function tick() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    for (const job of DAILY) {
      const last = await lastRun(org.id, job);
      if (!last || Date.now() - last.startedAt.getTime() > 20 * 3600000) {
        await runJob(job, { organizationId: org.id, trigger: 'SCHEDULE' });
      }
    }
    for (const job of HOURLY) {
      const last = await lastRun(org.id, job);
      if (!last || Date.now() - last.startedAt.getTime() > 55 * 60000) {
        await runJob(job, { organizationId: org.id, trigger: 'SCHEDULE' });
      }
    }
  }
}

export function startScheduler() {
  let running = false;
  const safeTick = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      logger.error({ err: e }, 'Scheduler-Fehler');
    } finally {
      running = false;
    }
  };
  setTimeout(safeTick, 10_000);
  return setInterval(safeTick, 10 * 60_000);
}
