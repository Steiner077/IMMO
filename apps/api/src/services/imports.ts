import type { ImportBatch, ImportRow, Prisma } from '@prisma/client';
import { addMonths, formatMoney, normalizeIban, normalizeText, toPeriod } from '@immo/shared';
import { prisma, financialTx } from '../lib/prisma.js';
import { storage } from '../lib/storage.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { extractPdfLines } from '../import/pdf.js';
import { parseStatementLines, parseStatementText } from '../import/statement-parser.js';
import { ocrAvailable, ocrImage, ocrPdf } from '../import/ocr.js';
import { parseCsvBuffer, parseXlsxBuffer } from '../import/table-parser.js';
import { parseCamtBuffer } from '../import/camt-parser.js';
import { matchTransaction, type MatchCandidate } from '../import/matching.js';
import { allocatePreferring, type AllocationLine } from '../import/allocation.js';
import type { ParseResult } from '../import/types.js';
import { ensureChargesForOrganization } from './charges.js';
import { createPayment, paymentFingerprint } from './payments.js';
import { notifyStaff } from './notifications.js';
import { audit } from './audit.js';
import { getOrgSettings } from './settings.js';
import { runPostPostingAutomations } from '../automation/hooks.js';
import type { AuthUser } from '../auth/context.js';
import type { FastifyRequest } from 'fastify';
import { logger } from '../lib/logger.js';
import { aiEnabled } from './ai.js';
import { parseStatementWithAI } from './statement-ai.js';

const OCR_HINT = 'Per Texterkennung (OCR) aus einem Scan/Foto gelesen – Beträge ohne Saldo-Bestätigung bitte besonders prüfen.';

async function ocrOrExplain(read: () => Promise<import('../import/types.js').TextLine[]>, what: string): Promise<ParseResult> {
  if (!(await ocrAvailable())) {
    return { transactions: [], meta: { format: 'ocr-unavailable', warnings: [`${what} enthält keinen lesbaren Text und die Texterkennung ist auf diesem Server nicht installiert (tesseract, poppler-utils).`] } };
  }
  const res = parseStatementLines(await read());
  res.meta.ocr = true;
  res.meta.format = `ocr:${res.meta.format}`;
  res.meta.warnings.unshift(OCR_HINT);
  return res;
}

/** Regelbasiertes Ergebnis unbrauchbar? (nichts erkannt oder Beträge widersprechen dem Saldo) */
function weak(res: ParseResult) {
  const bc = res.meta.balanceCheck;
  return res.transactions.length === 0 || (!!bc && bc.checked > 0 && bc.verified < bc.checked);
}

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** KI versuchen; bei Fehler das bisherige Ergebnis mit Hinweis behalten */
async function tryAi(run: () => Promise<ParseResult>, fallback: ParseResult | null, force: boolean): Promise<ParseResult | null> {
  try {
    const res = await run();
    if (res.transactions.length || force) return res;
  } catch (e) {
    if (force && !fallback) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'KI-Auslesen des Auszugs fehlgeschlagen');
    fallback?.meta.warnings.push(`KI-Auslesen nicht möglich: ${msg}`);
  }
  return null;
}

/**
 * Datei → Buchungen. Reihenfolge: eigener Leser (kostenlos, exakt) → bei schwachem Ergebnis
 * die KI (jedes Bankformat, Scans, Fotos) → sonst Texterkennung (OCR).
 * mode "force": direkt mit KI lesen; "off": nie KI.
 */
export async function parseFile(fileType: ImportBatch['fileType'], data: Buffer, fileName = '', mode: 'auto' | 'force' | 'off' = 'auto'): Promise<ParseResult> {
  const useAi = mode !== 'off' && aiEnabled();
  const force = mode === 'force' && useAi;
  if (fileType === 'PDF') {
    const lines = await extractPdfLines(data);
    const res = parseStatementLines(lines);
    if (!force && !weak(res)) return res;
    if (useAi) {
      const viaAi = await tryAi(() => parseStatementWithAI({ data, mimetype: 'application/pdf' }), res, force);
      if (viaAi) return viaAi;
    }
    // Kein oder kaum Text: eingescannter Ausdruck → Texterkennung
    if (lines.length < 5 || res.transactions.length === 0) {
      const ocr = await ocrOrExplain(() => ocrPdf(data), 'Das PDF');
      if (ocr.transactions.length || lines.length < 5) return ocr;
    }
    return res;
  }
  if (fileType === 'IMAGE') {
    const ext = (fileName.match(/\.\w+$/)?.[0] ?? '.png').toLowerCase();
    if (useAi && IMAGE_MIME[ext]) {
      const viaAi = await tryAi(() => parseStatementWithAI({ data, mimetype: IMAGE_MIME[ext] }), null, force);
      if (viaAi) return viaAi;
    }
    return ocrOrExplain(() => ocrImage(data, ext), 'Das Bild');
  }
  if (fileType === 'TEXT') {
    const text = data.toString('utf8');
    const res = parseStatementText(text);
    if (!force && !weak(res)) return res;
    const csv = parseCsvBuffer(data); // .txt kann auch ein Tabellen-Export sein
    if (!force && csv.transactions.length) return csv;
    if (useAi) {
      const viaAi = await tryAi(() => parseStatementWithAI({ text }), res, force);
      if (viaAi) return viaAi;
    }
    return res;
  }
  if (fileType === 'CSV') return parseCsvBuffer(data);
  if (fileType === 'CAMT') return parseCamtBuffer(data);
  return parseXlsxBuffer(data);
}

/** Lädt alle potenziellen Zahler (aktive/gekündigte Verträge) inkl. offener Monate und gelernter Aliase. */
export async function loadCandidates(organizationId: string): Promise<MatchCandidate[]> {
  const leases = await prisma.lease.findMany({
    where: { status: { in: ['ACTIVE', 'TERMINATED', 'ENDED'] }, unit: { property: { organizationId } } },
    include: {
      tenant: { include: { payerAliases: true } },
      unit: { include: { property: { select: { name: true } } } },
      charges: { where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } }, orderBy: { period: 'asc' } },
    },
  });
  const single: MatchCandidate[] = leases
    .filter((l) => l.status !== 'ENDED' || l.charges.length > 0)
    .map((l) => ({
      tenantId: l.tenantId,
      leaseId: l.id,
      firstName: l.tenant.firstName,
      lastName: l.tenant.lastName,
      companyName: l.tenant.companyName,
      iban: l.tenant.iban,
      unitLabel: l.unit.label,
      propertyName: l.unit.property.name,
      paymentReference: l.paymentReference,
      monthlyCents: l.netRentCents + l.utilitiesCents,
      openCharges: l.charges.map((c) => ({ id: c.id, period: c.period, outstandingCents: c.amountCents - c.paidCents, label: l.unit.label })),
      chargesStart: toPeriod(l.chargesFrom && l.chargesFrom > l.startDate ? l.chargesFrom : l.startDate),
      aliases: l.tenant.payerAliases
        .filter((a) => !a.leaseId || a.leaseId === l.id)
        .map((a) => ({ normalizedName: a.normalizedName, iban: a.iban, timesConfirmed: a.timesConfirmed })),
    }));

  // Mieter mit mehreren laufenden Verträgen (Wohnung + Parkplatz/Garage): Sammelzahlung als eigener Kandidat
  const SECONDARY = ['PARKING', 'GARAGE', 'STORAGE'];
  const byTenant = new Map<string, typeof leases>();
  for (const l of leases.filter((x) => x.status !== 'ENDED')) byTenant.set(l.tenantId, [...(byTenant.get(l.tenantId) ?? []), l]);
  const combined: MatchCandidate[] = [];
  for (const group of byTenant.values()) {
    if (group.length < 2) continue;
    const primary = [...group].sort((a, b) => Number(SECONDARY.includes(a.unit.type)) - Number(SECONDARY.includes(b.unit.type)) || b.netRentCents - a.netRentCents)[0];
    const base = single.find((c) => c.leaseId === primary.id)!;
    combined.push({
      ...base,
      combined: group.map((l) => l.unit.label).join(' + '),
      monthlyCents: group.reduce((s, l) => s + l.netRentCents + l.utilitiesCents, 0),
      openCharges: group.flatMap((l) => l.charges.map((c) => ({ id: c.id, period: c.period, outstandingCents: c.amountCents - c.paidCents, label: l.unit.label }))),
      paymentReference: base.paymentReference,
      aliases: [...new Map(group.flatMap((l) => l.tenant.payerAliases).map((a) => [a.id, { normalizedName: a.normalizedName, iban: a.iban, timesConfirmed: a.timesConfirmed }])).values()],
    });
  }
  return [...single, ...combined];
}

/** Analysiert einen Import: Datei parsen → Buchungen erkennen → Mieter zuordnen → Vorschau erzeugen. */
export async function analyzeBatch(batchId: string, mode: 'auto' | 'force' | 'off' = 'auto') {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { document: true } });
  try {
    if (!batch.document) throw new Error('Importdatei fehlt');
    const data = await storage.get(batch.document.storageKey);
    // KI-Ergebnis zwischenspeichern: erneutes Analysieren (z. B. nach "Monate nachtragen") kostet nichts
    const cacheKey = `${batch.document.storageKey}.ki.json`;
    let parsed: ParseResult;
    if (mode === 'auto' && (batch.meta as { ai?: boolean } | null)?.ai && (await storage.exists(cacheKey))) {
      parsed = JSON.parse((await storage.get(cacheKey)).toString('utf8'), (k, v) => (['bookingDate', 'valueDate'].includes(k) && v ? new Date(v) : v));
    } else {
      parsed = await parseFile(batch.fileType, data, batch.fileName, mode);
      if (parsed.meta.ai) await storage.put(cacheKey, Buffer.from(JSON.stringify(parsed)));
    }
    const settings = await getOrgSettings(batch.organizationId);

    // Sollstellungen bis zum Folgemonat sicherstellen (Vorauszahlungen)
    const latest = parsed.transactions.reduce((max, t) => (t.bookingDate > max ? t.bookingDate : max), new Date());
    await ensureChargesForOrganization(batch.organizationId, addMonths(toPeriod(latest), 1));
    const candidates = await loadCandidates(batch.organizationId);

    // Bereits verbuchte Zahlungen für die Duplikaterkennung
    const fingerprints = parsed.transactions.map((t) => paymentFingerprint(t));
    const existing = new Set(
      (await prisma.payment.findMany({
        where: { organizationId: batch.organizationId, fingerprint: { in: fingerprints }, reversedAt: null },
        select: { fingerprint: true },
      })).map((p) => p.fingerprint),
    );
    const seenInFile = new Set<string>();
    const dates = parsed.transactions.map((t) => t.bookingDate.getTime());
    const recent = dates.length
      ? await prisma.payment.findMany({
          where: {
            organizationId: batch.organizationId,
            reversedAt: null,
            leaseId: { not: null },
            bookingDate: { gte: new Date(Math.min(...dates) - 5 * 86400000), lte: new Date(Math.max(...dates) + 5 * 86400000) },
          },
          select: { leaseId: true, amountCents: true, bookingDate: true, number: true },
        })
      : [];
    const recentByLease = new Map<string, typeof recent>();
    for (const p of recent) recentByLease.set(p.leaseId!, [...(recentByLease.get(p.leaseId!) ?? []), p]);

    const rows: Prisma.ImportRowCreateManyInput[] = [];
    const sorted = [...parsed.transactions].sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime());
    sorted.forEach((t, i) => {
      const fp = paymentFingerprint(t);
      const base = {
        batchId,
        rowIndex: i,
        bookingDate: t.bookingDate,
        amountCents: t.amountCents,
        isCredit: t.isCredit,
        payerName: t.payerName,
        payerIban: t.payerIban,
        reference: t.reference,
        rawText: t.rawText,
        balanceVerified: t.verified ?? null,
        fingerprint: fp,
      };
      if (!t.isCredit) {
        rows.push({ ...base, status: 'IGNORED', matchReasons: ['Belastung (Ausgang) – keine Mietzahlung'] });
        return;
      }
      if (existing.has(fp) || seenInFile.has(fp)) {
        rows.push({ ...base, status: 'DUPLICATE', matchReasons: ['Diese Zahlung wurde bereits verbucht'] });
        return;
      }
      seenInFile.add(fp);
      const m = matchTransaction(t, candidates, {
        readyThreshold: settings.autoReadyThreshold,
        reviewThreshold: settings.reviewThreshold,
      });
      if (t.verified) m.reasons.push('Betrag und Richtung durch Saldo-Kontrolle bestätigt');
      if (t.verified === false) {
        m.reasons.push('Betrag passt nicht zum Kontosaldo – bitte mit dem Auszug vergleichen');
        if (m.status === 'READY') m.status = 'NEEDS_REVIEW';
      }
      // Gescannte Belege: ohne Saldo-Bestätigung nie automatisch "bereit"
      if ((parsed.meta.ocr || parsed.meta.ai) && !t.verified && m.status === 'READY') {
        m.status = 'NEEDS_REVIEW';
        m.reasons.push(parsed.meta.ai ? 'Von der KI gelesen – Betrag bitte kontrollieren' : 'Per Texterkennung gelesen – Betrag bitte kontrollieren');
      }
      // Mögliches Duplikat: gleicher Vertrag, gleicher Betrag, ±5 Tage bereits verbucht
      if (m.leaseId) {
        const near = recentByLease.get(m.leaseId)?.find(
          (p) => p.amountCents === t.amountCents && Math.abs(p.bookingDate.getTime() - t.bookingDate.getTime()) <= 5 * 86400000,
        );
        if (near) {
          m.status = 'NEEDS_REVIEW';
          m.reasons.push(`Mögliches Duplikat von Zahlung #${near.number} vom ${near.bookingDate.toISOString().slice(0, 10)}`);
        }
      }
      // Offene Beträge virtuell reduzieren, damit mehrere Zahlungen im selben Import korrekt verteilt werden
      if (m.leaseId) {
        // dieselbe Sollstellung kann in mehreren Kandidaten vorkommen (Einzel- und Sammelkandidat)
        for (const a of m.allocation) {
          for (const cand of candidates) {
            const oc = cand.openCharges.find((o) => o.id === a.chargeId);
            if (oc) oc.outstandingCents -= a.amountCents;
          }
        }
      }
      rows.push({
        ...base,
        suggestedTenantId: m.tenantId,
        suggestedLeaseId: m.leaseId,
        suggestedPeriod: m.period,
        allocation: m.allocation as unknown as Prisma.InputJsonValue,
        confidence: m.confidence,
        matchReasons: [...m.reasons, ...(m.remainderCents > 0 && m.leaseId ? [`Restbetrag ${formatMoney(m.remainderCents)} wird als Guthaben geführt`] : [])],
        status: m.status,
        confirmed: false,
      });
    });

    await prisma.$transaction([
      prisma.importRow.deleteMany({ where: { batchId } }),
      prisma.importRow.createMany({ data: rows }),
      prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'READY', meta: parsed.meta as unknown as Prisma.InputJsonValue, error: null },
      }),
    ]);
    const unclear = rows.filter((r) => r.status === 'UNMATCHED' || r.status === 'NEEDS_REVIEW').length;
    await notifyStaff({
      organizationId: batch.organizationId,
      type: unclear ? 'PAYMENT_UNCLEAR' : 'IMPORT_READY',
      title: `Import "${batch.fileName}" analysiert`,
      body: `${rows.filter((r) => r.isCredit).length} Zahlungseingänge erkannt, ${unclear} benötigen eine Prüfung.`,
      link: `/zahlungen/import/${batchId}`,
      entityType: 'ImportBatch',
      entityId: batchId,
      roles: ['OWNER', 'MANAGER'],
    });
  } catch (e) {
    logger.error({ err: e, batchId }, 'Import-Analyse fehlgeschlagen');
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'FAILED', error: (e as Error).message } });
  }
}

export interface RowUpdate {
  leaseId?: string | null;
  period?: string | null;
  allocation?: { chargeId: string; amountCents: number }[];
  confirmed?: boolean;
  ignore?: boolean;
}

/** Manuelle Korrektur einer Importzeile vor dem Verbuchen. */
export async function updateImportRow(rowId: string, input: RowUpdate, user: AuthUser) {
  const row = await prisma.importRow.findFirst({
    where: { id: rowId, batch: { organizationId: user.organizationId } },
    include: { batch: true },
  });
  if (!row) throw notFound('Importzeile');
  if (row.status === 'POSTED') throw conflict('Die Zeile ist bereits verbucht.');

  const data: Prisma.ImportRowUpdateInput = {};
  if (input.ignore !== undefined) {
    data.status = input.ignore ? 'IGNORED' : row.suggestedLeaseId ? 'NEEDS_REVIEW' : 'UNMATCHED';
    data.confirmed = false;
  }
  const leaseChanged = input.leaseId !== undefined && input.leaseId !== row.suggestedLeaseId;
  if (input.leaseId !== undefined || input.period !== undefined || input.allocation) {
    const leaseId = input.leaseId !== undefined ? input.leaseId : row.suggestedLeaseId;
    if (!leaseId) {
      Object.assign(data, { suggestedLeaseId: null, suggestedTenantId: null, suggestedPeriod: null, allocation: [], status: 'UNMATCHED', confirmed: false });
    } else {
      const lease = await prisma.lease.findFirst({
        where: { id: leaseId, unit: { property: { organizationId: user.organizationId } } },
        include: { charges: { where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } } } },
      });
      if (!lease) throw notFound('Mietvertrag');
      const period = input.period !== undefined ? input.period : leaseChanged ? null : row.suggestedPeriod;
      if (period) await ensureChargesForOrganization(user.organizationId, period);
      const open = (
        await prisma.rentCharge.findMany({
          where: { lease: { tenantId: lease.tenantId, unit: { property: { organizationId: user.organizationId } } }, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
          include: { lease: { select: { id: true, unit: { select: { label: true } } } } },
        })
      )
        // Monate des gewählten Vertrags zuerst vorschlagen
        .sort((a, b) => Number(a.leaseId !== leaseId) - Number(b.leaseId !== leaseId))
        .map((c) => ({ id: c.id, period: c.period, outstandingCents: c.amountCents - c.paidCents, label: c.lease.unit.label }));
      let allocation: AllocationLine[];
      if (input.allocation) {
        const total = input.allocation.reduce((s, a) => s + a.amountCents, 0);
        if (total > row.amountCents) throw badRequest('Die Aufteilung übersteigt den Zahlungsbetrag.');
        allocation = input.allocation.map((a) => {
          const c = open.find((o) => o.id === a.chargeId);
          if (!c) throw badRequest('Monat ist nicht offen oder gehört nicht zum Vertrag.');
          if (a.amountCents > c.outstandingCents) throw badRequest(`Betrag für ${c.period} übersteigt den offenen Betrag.`);
          return { chargeId: c.id, period: c.period, amountCents: a.amountCents, label: c.label };
        });
      } else {
        const ownIds = new Set((await prisma.rentCharge.findMany({ where: { leaseId, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } }, select: { id: true } })).map((c) => c.id));
        allocation = allocatePreferring(row.amountCents, open.filter((o) => ownIds.has(o.id)), open.filter((o) => !ownIds.has(o.id)), period).lines;
      }
      Object.assign(data, {
        suggestedLeaseId: lease.id,
        suggestedTenantId: lease.tenantId,
        suggestedPeriod: period ?? allocation[0]?.period ?? null,
        allocation: allocation as unknown as Prisma.InputJsonValue,
        status: 'NEEDS_REVIEW',
        corrected: true,
        confidence: 100,
        matchReasons: ['Manuell zugeordnet'],
      });
    }
  }
  if (input.confirmed !== undefined) {
    const effectiveLease = (data.suggestedLeaseId as string | null | undefined) ?? (input.leaseId === null ? null : row.suggestedLeaseId);
    if (input.confirmed && !effectiveLease) throw badRequest('Nur zugeordnete Zahlungen können bestätigt werden.');
    if (input.confirmed && (row.status === 'IGNORED' || row.status === 'DUPLICATE') && input.ignore !== false)
      throw badRequest('Ignorierte oder doppelte Zeilen können nicht bestätigt werden.');
    data.confirmed = input.confirmed;
    if (input.confirmed) data.status = 'READY';
  }
  return prisma.importRow.update({ where: { id: rowId }, data });
}

/** Lernlogik: bestätigte Zuordnung Zahlername/IBAN → Mieter merken. */
export async function learnFromRow(row: ImportRow, organizationId: string, userId: string) {
  if (!row.suggestedTenantId) return;
  const name = normalizeText(row.payerName);
  if (!name || name.length < 3) return;
  const existing = await prisma.payerAlias.findUnique({
    where: { organizationId_normalizedName_tenantId: { organizationId, normalizedName: name, tenantId: row.suggestedTenantId } },
  });
  if (existing) {
    await prisma.payerAlias.update({
      where: { id: existing.id },
      data: {
        timesConfirmed: { increment: 1 },
        lastUsedAt: new Date(),
        iban: row.payerIban ? normalizeIban(row.payerIban) : existing.iban,
        leaseId: row.suggestedLeaseId,
      },
    });
  } else {
    await prisma.payerAlias.create({
      data: {
        organizationId,
        normalizedName: name,
        iban: row.payerIban ? normalizeIban(row.payerIban) : null,
        tenantId: row.suggestedTenantId,
        leaseId: row.suggestedLeaseId,
        createdById: userId,
      },
    });
  }
  // Wurde eine falsche Zuordnung korrigiert, widersprechende Aliase entfernen
  if (row.corrected) {
    await prisma.payerAlias.deleteMany({
      where: { organizationId, normalizedName: name, tenantId: { not: row.suggestedTenantId } },
    });
  }
}

/** Verbucht alle bestätigten Zeilen. Jede Zeile in einer eigenen Finanztransaktion. */
export async function postBatch(batchId: string, user: AuthUser, req?: FastifyRequest) {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, organizationId: user.organizationId } });
  if (!batch) throw notFound('Import');
  if (batch.status === 'ANALYZING') throw conflict('Der Import wird noch analysiert.');
  const rows = await prisma.importRow.findMany({ where: { batchId, confirmed: true, status: { not: 'POSTED' } }, orderBy: { rowIndex: 'asc' } });
  const results: { rowId: string; ok: boolean; paymentId?: string; error?: string }[] = [];
  const source = ({ PDF: 'PDF_IMPORT', CSV: 'CSV_IMPORT', XLSX: 'EXCEL_IMPORT', CAMT: 'CAMT_IMPORT', IMAGE: 'SCAN_IMPORT', TEXT: 'TEXT_IMPORT' } as const)[batch.fileType];

  for (const row of rows) {
    try {
      const planned = (row.allocation as unknown as AllocationLine[]) ?? [];
      const payment = await financialTx(async (tx) => {
        // Sicherheitsprüfung: Hat sich der offene Betrag seit der Analyse verändert?
        for (const a of planned) {
          const c = await tx.rentCharge.findUnique({ where: { id: a.chargeId }, include: { lease: { select: { tenantId: true } } } });
          if (!c || c.lease.tenantId !== row.suggestedTenantId) throw badRequest('Sollstellung passt nicht mehr zum Mieter.');
          if (a.amountCents > c.amountCents - c.paidCents)
            throw badRequest(`Der offene Betrag für ${a.period} hat sich seit der Analyse verändert – bitte Zeile erneut prüfen.`);
        }
        const dup = await tx.payment.findFirst({ where: { organizationId: user.organizationId, fingerprint: row.fingerprint, reversedAt: null } });
        if (dup) throw conflict(`Bereits als Zahlung #${dup.number} verbucht.`);
        const p = await createPayment(
          {
            organizationId: user.organizationId,
            leaseId: row.suggestedLeaseId,
            tenantId: row.suggestedTenantId,
            bookingDate: row.bookingDate,
            amountCents: row.amountCents,
            reference: row.reference,
            payerName: row.payerName,
            payerIban: row.payerIban,
            rawText: row.rawText,
            source,
            documentId: batch.documentId,
            importRowId: row.id,
            confidence: row.confidence,
            allocations: planned.map((a) => ({ chargeId: a.chargeId, amountCents: a.amountCents })),
            automatic: !row.corrected,
          },
          { user, req },
          tx,
        );
        await tx.importRow.update({ where: { id: row.id }, data: { status: 'POSTED' } });
        return p;
      });
      await learnFromRow(row, user.organizationId, user.id);
      results.push({ rowId: row.id, ok: true, paymentId: payment.id });
    } catch (e) {
      await prisma.importRow.update({ where: { id: row.id }, data: { confirmed: false, status: 'NEEDS_REVIEW' } });
      results.push({ rowId: row.id, ok: false, error: (e as Error).message });
    }
  }

  const remaining = await prisma.importRow.count({
    where: { batchId, status: { in: ['READY', 'NEEDS_REVIEW', 'UNMATCHED'] } },
  });
  const posted = results.filter((r) => r.ok).length;
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: remaining === 0 ? 'POSTED' : posted > 0 || batch.status === 'PARTIALLY_POSTED' ? 'PARTIALLY_POSTED' : batch.status, postedAt: posted ? new Date() : batch.postedAt },
  });
  const total = results.filter((r) => r.ok).reduce((s, r) => s + (rows.find((x) => x.id === r.rowId)?.amountCents ?? 0), 0);
  await audit(
    { user, organizationId: user.organizationId, req },
    {
      action: 'import.post',
      entityType: 'ImportBatch',
      entityId: batchId,
      summary: `${posted} Zahlungen über ${formatMoney(total)} aus "${batch.fileName}" verbucht`,
      newValues: { posted, failed: results.length - posted },
    },
  );
  if (posted) {
    await notifyStaff({
      organizationId: user.organizationId,
      type: 'PAYMENT_POSTED',
      title: `${posted} Zahlungen verbucht`,
      body: `Summe ${formatMoney(total)} aus "${batch.fileName}"`,
      link: `/zahlungen/import/${batchId}`,
      roles: ['OWNER', 'MANAGER'],
      excludeUserId: user.id,
    });
    await runPostPostingAutomations(user.organizationId, user).catch((e) => logger.error({ err: e }, 'Automation nach Verbuchung fehlgeschlagen'));
  }
  return { posted, failed: results.filter((r) => !r.ok), totalCents: total };
}
