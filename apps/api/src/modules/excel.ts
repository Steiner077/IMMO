import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, parse } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requirePermission } from '../auth/context.js';
import { readMultipart } from '../lib/upload.js';
import { applyExcelUpdate, applyTenantSync, buildWorkbook, previewExcelUpdate, previewTenantSync } from '../services/excel.js';
import { auditReq } from '../services/audit.js';

export async function excelRoutes(app: FastifyInstance) {
  app.get('/jobs', { preHandler: requirePermission('excel:sync') }, async (req) =>
    prisma.syncJob.findMany({
      where: { organizationId: req.user.organizationId },
      select: { id: true, kind: true, fileName: true, status: true, createdAt: true, appliedAt: true, documentId: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  );

  app.get('/export', { preHandler: requirePermission('excel:sync') }, async (req, reply) => {
    const q = parse(z.object({ year: z.coerce.number().int().default(new Date().getUTCFullYear()) }), req.query);
    const buf = await buildWorkbook(req.user.organizationId, q.year);
    await auditReq(req, { action: 'excel.export', entityType: 'Excel', summary: `Excel-Export ${q.year}` });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="IMMO-${q.year}.xlsx"`);
    return reply.send(buf);
  });

  /** Mieter aus Excel synchronisieren – Schritt 1: Vorschau */
  app.post('/tenants/preview', { preHandler: requirePermission('excel:sync', 'tenant:write') }, async (req) => {
    const { files } = await readMultipart(req);
    const f = files[0];
    if (!f || !f.filename.toLowerCase().endsWith('.xlsx')) throw badRequest('Bitte eine .xlsx-Datei hochladen.');
    return previewTenantSync(req.user.organizationId, f.buffer, f.filename, req.user);
  });

  /** Schritt 2: nur ausgewählte Zeilen übernehmen */
  app.post('/tenants/:id/apply', { preHandler: requirePermission('excel:sync', 'tenant:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ rows: z.array(z.number().int()) }), req.body);
    return applyTenantSync(id, body.rows, req.user);
  });

  /** Bestehende Excel-Datei mit Zahlungsdaten aktualisieren – Vorschau */
  app.post('/update/preview', { preHandler: requirePermission('excel:sync', 'finance:read') }, async (req) => {
    const { files, fields } = await readMultipart(req);
    const f = files[0];
    if (!f || !f.filename.toLowerCase().endsWith('.xlsx')) throw badRequest('Bitte eine .xlsx-Datei hochladen.');
    const year = Number(fields.year) || new Date().getUTCFullYear();
    return previewExcelUpdate(req.user.organizationId, f.buffer, f.filename, year, req.user);
  });

  /** Anwenden: schreibt eine NEUE Kopie, das Original bleibt unverändert */
  app.post('/update/:id/apply', { preHandler: requirePermission('excel:sync', 'finance:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ changes: z.union([z.literal('all'), z.array(z.number().int())]) }), req.body);
    return applyExcelUpdate(id, body.changes, req.user);
  });
}
