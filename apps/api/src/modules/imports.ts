import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, parse } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { propertyIdFilter, requirePermission } from '../auth/context.js';
import { readMultipart } from '../lib/upload.js';
import { storeDocument } from '../services/documents.js';
import { analyzeBatch, postBatch, updateImportRow } from '../services/imports.js';
import { isCamt } from '../import/camt-parser.js';
import { BEFORE_START } from '../import/matching.js';
import { auditReq } from '../services/audit.js';

export async function importRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('payment:import') }, async (req) => {
    const batches = await prisma.importBatch.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { rows: { select: { status: true, amountCents: true, isCredit: true } } },
    });
    return batches.map(({ rows, ...b }) => ({
      ...b,
      counts: rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
      creditCents: rows.filter((r) => r.isCredit).reduce((s, r) => s + r.amountCents, 0),
    }));
  });

  /** Datei hochladen → Analyse startet asynchron ("Datei wird analysiert") */
  app.post('/', { preHandler: requirePermission('payment:import') }, async (req) => {
    const { files } = await readMultipart(req);
    const file = files[0];
    if (!file) throw badRequest('Keine Datei übermittelt.');
    const fileType =
      file.mimetype === 'application/pdf' ? 'PDF'
      : file.mimetype === 'application/xml' ? (isCamt(file.buffer) ? 'CAMT' : null)
      : file.mimetype === 'text/plain' ? 'TEXT'
      : file.mimetype === 'text/csv' ? 'CSV'
      : file.filename.toLowerCase().endsWith('.xlsx') ? 'XLSX'
      : ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? 'IMAGE' : null;
    if (!fileType) throw badRequest('Unterstützt werden PDF (auch gescannt), Fotos/Scans (JPG, PNG), camt.053/054 (XML), CSV und Excel (.xlsx).');
    const doc = await storeDocument(prisma, req.user.organizationId, file, {
      category: fileType === 'PDF' ? 'BANK_STATEMENT' : 'RECEIPT',
      description: 'Zahlungsimport',
      uploadedById: req.user.id,
    });
    const batch = await prisma.importBatch.create({
      data: { organizationId: req.user.organizationId, fileName: file.filename, fileType, documentId: doc.id, createdById: req.user.id },
    });
    await auditReq(req, { action: 'import.upload', entityType: 'ImportBatch', entityId: batch.id, summary: `Zahlungsdatei "${file.filename}" hochgeladen` });
    // Analyse im Hintergrund, Frontend pollt den Status
    setImmediate(() => void analyzeBatch(batch.id));
    return batch;
  });

  /** Kontoauszug als Text einfügen (z. B. aus PDF oder E-Banking kopiert) */
  app.post('/text', { preHandler: requirePermission('payment:import') }, async (req) => {
    const body = parse(z.object({ text: z.string().trim().min(20, 'Bitte den Text des Kontoauszugs einfügen.').max(500_000), name: z.string().max(120).optional() }), req.body);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const fileName = `${body.name?.trim() || 'Eingefügter Kontoauszug'} ${stamp}.txt`.replace(/[^\w.\-äöüÄÖÜ ()]/g, '_');
    const doc = await storeDocument(prisma, req.user.organizationId, { filename: fileName, mimetype: 'text/plain', buffer: Buffer.from(body.text, 'utf8') }, {
      category: 'BANK_STATEMENT',
      description: 'Eingefügter Kontoauszugstext',
      uploadedById: req.user.id,
    });
    const batch = await prisma.importBatch.create({
      data: { organizationId: req.user.organizationId, fileName, fileType: 'TEXT', documentId: doc.id, createdById: req.user.id },
    });
    await auditReq(req, { action: 'import.paste', entityType: 'ImportBatch', entityId: batch.id, summary: `Kontoauszugstext eingefügt (${body.text.length} Zeichen)` });
    setImmediate(() => void analyzeBatch(batch.id));
    return batch;
  });

  app.get('/:id', { preHandler: requirePermission('payment:import') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await prisma.importBatch.findFirst({
      where: { id, organizationId: req.user.organizationId },
      include: { rows: { orderBy: { rowIndex: 'asc' }, include: { payment: { select: { id: true, number: true } } } } },
    });
    if (!batch) throw notFound('Import');
    const leaseIds = [...new Set(batch.rows.map((r) => r.suggestedLeaseId).filter(Boolean))] as string[];
    const leases = await prisma.lease.findMany({
      where: { id: { in: leaseIds } },
      include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } }, unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } } },
    });
    const byId = new Map(leases.map((l) => [l.id, l]));
    return {
      ...batch,
      rows: batch.rows.map((r) => {
        const l = r.suggestedLeaseId ? byId.get(r.suggestedLeaseId) : undefined;
        return {
          ...r,
          tenant: l?.tenant ?? null,
          unit: l ? { id: l.unit.id, label: l.unit.label } : null,
          property: l?.unit.property ?? null,
          monthlyCents: l ? l.netRentCents + l.utilitiesCents : null,
        };
      }),
    };
  });

  app.patch('/rows/:id', { preHandler: requirePermission('payment:import') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        leaseId: z.string().nullable().optional(),
        period: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
        allocation: z.array(z.object({ chargeId: z.string(), amountCents: z.coerce.number().int().positive() })).optional(),
        confirmed: z.boolean().optional(),
        ignore: z.boolean().optional(),
      }),
      req.body,
    );
    return updateImportRow(id, body, req.user);
  });

  /** Alle Zeilen mit Status "Bereit" bestätigen */
  app.post('/:id/confirm-ready', { preHandler: requirePermission('payment:import') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!batch) throw notFound('Import');
    const r = await prisma.importRow.updateMany({ where: { batchId: id, status: 'READY', suggestedLeaseId: { not: null } }, data: { confirmed: true } });
    return { confirmed: r.count };
  });

  /** "Alle bestätigten Zahlungen verbuchen" */
  app.post('/:id/post', { preHandler: requirePermission('payment:post') }, async (req) => postBatch(parse(idParam, req.params).id, req.user, req));

  app.post('/:id/reanalyze', { preHandler: requirePermission('payment:import') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!batch) throw notFound('Import');
    if (await prisma.importRow.count({ where: { batchId: id, status: 'POSTED' } })) throw conflict('Bereits teilweise verbucht – erneute Analyse nicht möglich.');
    await prisma.importBatch.update({ where: { id }, data: { status: 'ANALYZING' } });
    setImmediate(() => void analyzeBatch(id));
    return { ok: true };
  });

  /**
   * Jahresauszug: Zahlungen vor dem Abrechnungsbeginn eines Vertrags → Sollstellungen
   * für diese Monate nachtragen (nie vor Mietbeginn) und den Import neu analysieren.
   */
  app.post('/:id/backfill-charges', { preHandler: requirePermission('payment:import', 'lease:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!batch) throw notFound('Import');
    if (await prisma.importRow.count({ where: { batchId: id, status: 'POSTED' } })) throw conflict('Bereits teilweise verbucht – bitte zuerst neuen Import anlegen.');
    const rows = await prisma.importRow.findMany({
      where: { batchId: id, isCredit: true, suggestedTenantId: { not: null } },
      select: { suggestedTenantId: true, bookingDate: true, matchReasons: true },
    });
    const earliest = new Map<string, Date>();
    for (const r of rows) {
      if (!((r.matchReasons as string[] | null) ?? []).some((m) => m.startsWith(BEFORE_START))) continue;
      const d = new Date(Date.UTC(r.bookingDate.getUTCFullYear(), r.bookingDate.getUTCMonth(), 1));
      const cur = earliest.get(r.suggestedTenantId!);
      if (!cur || d < cur) earliest.set(r.suggestedTenantId!, d);
    }
    if (!earliest.size) return { updated: 0 };
    const leases = await prisma.lease.findMany({
      where: { tenantId: { in: [...earliest.keys()] }, status: { in: ['ACTIVE', 'TERMINATED'] }, unit: { propertyId: propertyIdFilter(req.user), property: { organizationId: req.user.organizationId } } },
      include: { unit: { select: { label: true } } },
    });
    let updated = 0;
    for (const l of leases) {
      const target = earliest.get(l.tenantId)!;
      const from = target < l.startDate ? l.startDate : target;
      if (!l.chargesFrom || l.chargesFrom <= from) continue;
      await prisma.lease.update({ where: { id: l.id }, data: { chargesFrom: from } });
      await auditReq(req, {
        action: 'lease.charges_backfill',
        entityType: 'Lease',
        entityId: l.id,
        summary: `Sollstellungen ${l.unit.label} ab ${from.toISOString().slice(0, 7)} nachgetragen (Import "${batch.fileName}")`,
        oldValues: { chargesFrom: l.chargesFrom },
        newValues: { chargesFrom: from },
      });
      updated++;
    }
    await analyzeBatch(id);
    return { updated };
  });

  app.post('/:id/discard', { preHandler: requirePermission('payment:import') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!batch) throw notFound('Import');
    if (await prisma.importRow.count({ where: { batchId: id, status: 'POSTED' } })) throw conflict('Verbuchte Zahlungen müssen einzeln storniert werden.');
    await prisma.importBatch.update({ where: { id }, data: { status: 'DISCARDED' } });
    await auditReq(req, { action: 'import.discard', entityType: 'ImportBatch', entityId: id, summary: `Import "${batch.fileName}" verworfen` });
    return { ok: true };
  });
}
