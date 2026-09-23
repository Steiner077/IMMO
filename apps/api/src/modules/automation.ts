import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { requirePermission } from '../auth/context.js';
import { JOBS, runJob } from '../automation/jobs.js';
import { auditReq } from '../services/audit.js';

export async function automationRoutes(app: FastifyInstance) {
  /** Automatisierungs-Zentrale: Jobs, letzte Läufe, Lernlogik, Kennzahlen */
  app.get('/', { preHandler: requirePermission('automation:manage') }, async (req) => {
    const orgId = req.user.organizationId;
    const runs = await prisma.automationRun.findMany({ where: { organizationId: orgId }, orderBy: { startedAt: 'desc' }, take: 50 });
    const since = new Date(Date.now() - 90 * 86400000);
    const [rows, aliases, autoPayments, totalPayments] = await Promise.all([
      prisma.importRow.groupBy({ by: ['status'], where: { batch: { organizationId: orgId }, createdAt: { gte: since } }, _count: true }),
      prisma.payerAlias.count({ where: { organizationId: orgId } }),
      prisma.paymentAssignment.count({ where: { automatic: true, payment: { organizationId: orgId, createdAt: { gte: since }, source: { not: 'MANUAL' } } } }),
      prisma.paymentAssignment.count({ where: { payment: { organizationId: orgId, createdAt: { gte: since }, source: { not: 'MANUAL' } } } }),
    ]);
    return {
      jobs: JOBS.map((j) => ({ key: j.key, name: j.name, description: j.description, schedule: j.schedule, lastRun: runs.find((r) => r.job === j.key) ?? null })),
      runs,
      stats: {
        importRows: Object.fromEntries(rows.map((r) => [r.status, r._count])),
        learnedAliases: aliases,
        automationRate: totalPayments ? Math.round((autoPayments / totalPayments) * 100) : null,
      },
      pipeline: [
        'Zahlung erkennen',
        'Zahler erkennen',
        'Mieter suchen',
        'Betrag vergleichen',
        'Offene Monate prüfen',
        'Passenden Monat bestimmen',
        'Mietvertrag vergleichen',
        'Zahlung zuordnen',
        'Sicherheit berechnen',
        'Vorschau anzeigen',
        'Nach Bestätigung verbuchen',
      ],
    };
  });

  app.post('/jobs/:key/run', { preHandler: requirePermission('automation:manage') }, async (req) => {
    const { key } = parse(z.object({ key: z.string() }), req.params);
    if (!JOBS.some((j) => j.key === key)) throw notFound('Automatisierung');
    const run = await runJob(key, { organizationId: req.user.organizationId, trigger: 'MANUAL', userId: req.user.id });
    await auditReq(req, { action: 'automation.run', entityType: 'AutomationRun', entityId: run.id, summary: `Automatisierung "${key}" manuell ausgeführt (${run.status})` });
    return run;
  });

  /** Lernlogik: gelernte Zuordnungen einsehen und korrigieren */
  app.get('/aliases', { preHandler: requirePermission('automation:manage') }, async (req) =>
    prisma.payerAlias.findMany({
      where: { organizationId: req.user.organizationId },
      include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } } },
      orderBy: { lastUsedAt: 'desc' },
    }),
  );

  app.delete('/aliases/:id', { preHandler: requirePermission('automation:manage') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await prisma.payerAlias.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!a) throw notFound('Zuordnung');
    await prisma.payerAlias.delete({ where: { id } });
    await auditReq(req, { action: 'alias.delete', entityType: 'PayerAlias', entityId: id, summary: `Gelernte Zuordnung "${a.normalizedName}" entfernt`, oldValues: a });
    return { ok: true };
  });
}
