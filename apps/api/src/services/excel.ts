import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import {
  CHARGE_STATUS,
  EXPENSE_CATEGORIES,
  MONTH_NAMES_DE,
  PAYMENT_SOURCES,
  PAYMENT_STATUS,
  formatDate,
  normalizeText,
  parseMoneyToCents,
} from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { makeStorageKey, sha256, storage } from '../lib/storage.js';
import { badRequest, notFound } from '../lib/errors.js';
import { readWorkbookRows } from '../import/table-parser.js';
import { audit } from './audit.js';
import type { AuthUser } from '../auth/context.js';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const CHF = '#,##0.00';

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

const tenantName = (t: { companyName: string | null; firstName: string | null; lastName: string | null }) =>
  t.companyName ?? `${t.lastName ?? ''} ${t.firstName ?? ''}`.trim();

/** Erstellt die vollständige Excel-Auswertung (Export). */
export async function buildWorkbook(organizationId: string, year = new Date().getFullYear()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IMMO Plattform';
  wb.created = new Date();

  const leases = await prisma.lease.findMany({
    where: { unit: { property: { organizationId } } },
    include: {
      tenant: true,
      unit: { include: { property: true } },
      charges: { where: { period: { startsWith: `${year}-` } } },
    },
    orderBy: [{ unit: { property: { name: 'asc' } } }, { unit: { label: 'asc' } }],
  });

  // Mieter
  const wsT = wb.addWorksheet('Mieter');
  wsT.columns = [
    { header: 'Mieter-ID', key: 'id', width: 28 },
    { header: 'Nachname', key: 'lastName', width: 18 },
    { header: 'Vorname', key: 'firstName', width: 16 },
    { header: 'Firma', key: 'companyName', width: 20 },
    { header: 'E-Mail', key: 'email', width: 26 },
    { header: 'Telefon', key: 'phone', width: 16 },
    { header: 'IBAN', key: 'iban', width: 26 },
    { header: 'Immobilie', key: 'property', width: 22 },
    { header: 'Wohnung', key: 'unit', width: 10 },
    { header: 'Mietbeginn', key: 'start', width: 12 },
    { header: 'Mietende', key: 'end', width: 12 },
    { header: 'Nettomiete', key: 'net', width: 12, style: { numFmt: CHF } },
    { header: 'Nebenkosten', key: 'util', width: 12, style: { numFmt: CHF } },
    { header: 'Total / Monat', key: 'total', width: 13, style: { numFmt: CHF } },
    { header: 'Status', key: 'status', width: 12 },
  ];
  for (const l of leases) {
    wsT.addRow({
      id: l.tenant.id,
      lastName: l.tenant.lastName,
      firstName: l.tenant.firstName,
      companyName: l.tenant.companyName,
      email: l.tenant.email,
      phone: l.tenant.phone,
      iban: l.tenant.iban,
      property: l.unit.property.name,
      unit: l.unit.label,
      start: formatDate(l.startDate),
      end: l.endDate ? formatDate(l.endDate) : '',
      net: l.netRentCents / 100,
      util: l.utilitiesCents / 100,
      total: (l.netRentCents + l.utilitiesCents) / 100,
      status: l.status,
    });
  }
  styleHeader(wsT);

  // Monatsübersicht
  const wsM = wb.addWorksheet(`Monatsübersicht ${year}`);
  wsM.columns = [
    { header: 'Immobilie', key: 'property', width: 22 },
    { header: 'Wohnung', key: 'unit', width: 10 },
    { header: 'Mieter', key: 'tenant', width: 24 },
    ...MONTH_NAMES_DE.map((m, i) => ({ header: m, key: `m${i + 1}`, width: 11, style: { numFmt: CHF } })),
    { header: 'Soll', key: 'soll', width: 12, style: { numFmt: CHF } },
    { header: 'Ist', key: 'ist', width: 12, style: { numFmt: CHF } },
    { header: 'Offen', key: 'offen', width: 12, style: { numFmt: CHF } },
  ];
  for (const l of leases.filter((x) => x.charges.length)) {
    const row: Record<string, unknown> = { property: l.unit.property.name, unit: l.unit.label, tenant: tenantName(l.tenant) };
    let soll = 0;
    let ist = 0;
    const statusByCol: Record<number, string> = {};
    for (const c of l.charges) {
      const m = +c.period.slice(5, 7);
      row[`m${m}`] = c.paidCents / 100;
      statusByCol[3 + m] = c.status;
      soll += c.amountCents;
      ist += Math.min(c.paidCents, c.amountCents);
    }
    row.soll = soll / 100;
    row.ist = ist / 100;
    row.offen = (soll - ist) / 100;
    const r = wsM.addRow(row);
    for (const [col, st] of Object.entries(statusByCol)) {
      const cell = r.getCell(+col);
      const color = st === 'PAID' || st === 'OVERPAID' ? 'FFD1FAE5' : st === 'PARTIAL' ? 'FFFEF3C7' : st === 'OVERDUE' ? 'FFFEE2E2' : 'FFF1F5F9';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      cell.note = CHARGE_STATUS[st as keyof typeof CHARGE_STATUS];
    }
  }
  styleHeader(wsM);

  // Zahlungen
  const payments = await prisma.payment.findMany({
    where: { organizationId, bookingDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    include: { tenant: true, property: true, unit: true, assignments: { include: { rentCharge: true } } },
    orderBy: { bookingDate: 'asc' },
  });
  const wsP = wb.addWorksheet('Zahlungen');
  wsP.columns = [
    { header: 'Zahlungs-ID', key: 'nr', width: 12 },
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Mieter', key: 'tenant', width: 24 },
    { header: 'Immobilie', key: 'property', width: 22 },
    { header: 'Wohnung', key: 'unit', width: 10 },
    { header: 'Betrag', key: 'amount', width: 12, style: { numFmt: CHF } },
    { header: 'Sollbetrag', key: 'expected', width: 12, style: { numFmt: CHF } },
    { header: 'Monat(e)', key: 'periods', width: 18 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Zahler', key: 'payer', width: 22 },
    { header: 'Referenz', key: 'reference', width: 34 },
    { header: 'Quelle', key: 'source', width: 12 },
    { header: 'Sicherheit', key: 'confidence', width: 10 },
  ];
  for (const p of payments) {
    wsP.addRow({
      nr: p.number,
      date: formatDate(p.bookingDate),
      tenant: p.tenant ? tenantName(p.tenant) : '',
      property: p.property?.name ?? '',
      unit: p.unit?.label ?? '',
      amount: p.amountCents / 100,
      expected: p.expectedCents ? p.expectedCents / 100 : null,
      periods: p.assignments.map((a) => a.rentCharge.period).join(', '),
      status: PAYMENT_STATUS[p.status],
      payer: p.payerName,
      reference: p.reference,
      source: PAYMENT_SOURCES[p.source],
      confidence: p.confidence !== null ? `${p.confidence} %` : '',
    });
  }
  styleHeader(wsP);

  // Finanzen
  const expenses = await prisma.expense.findMany({
    where: { organizationId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    include: { property: true },
    orderBy: { date: 'asc' },
  });
  const wsE = wb.addWorksheet('Ausgaben');
  wsE.columns = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Immobilie', key: 'property', width: 22 },
    { header: 'Kategorie', key: 'category', width: 18 },
    { header: 'Beschreibung', key: 'description', width: 36 },
    { header: 'Rechnungsnr.', key: 'invoice', width: 14 },
    { header: 'Betrag', key: 'amount', width: 12, style: { numFmt: CHF } },
  ];
  for (const e of expenses) {
    wsE.addRow({
      date: formatDate(e.date),
      property: e.property.name,
      category: EXPENSE_CATEGORIES[e.category],
      description: e.description,
      invoice: e.invoiceNumber,
      amount: e.amountCents / 100,
    });
  }
  styleHeader(wsE);

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

/** Legt eine neue Export-Version in der Dokumentenablage ab (nie überschreiben). */
export async function createExcelSnapshot(organizationId: string, userId: string | null, year = new Date().getFullYear()) {
  const buf = await buildWorkbook(organizationId, year);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `IMMO-Auswertung-${year}-${stamp}.xlsx`;
  const key = makeStorageKey(organizationId, name);
  await storage.put(key, buf);
  return prisma.document.create({
    data: {
      organizationId,
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: buf.length,
      storageKey: key,
      sha256: sha256(buf),
      category: 'EXPORT',
      description: 'Automatisch erzeugte Excel-Auswertung',
      uploadedById: userId,
    },
  });
}

// ───────────── Mieter-Synchronisation (Import mit Vorschau) ─────────────

type SyncAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'SKIP';
interface TenantSyncRow {
  row: number;
  action: SyncAction;
  tenantId: string | null;
  label: string;
  changes: { field: string; label: string; from: unknown; to: unknown }[];
  data: Record<string, string | null>;
  message?: string;
}

const TENANT_FIELDS: Record<string, { label: string; aliases: string[] }> = {
  id: { label: 'Mieter-ID', aliases: ['mieter id', 'id'] },
  lastName: { label: 'Nachname', aliases: ['nachname', 'name', 'familienname'] },
  firstName: { label: 'Vorname', aliases: ['vorname'] },
  companyName: { label: 'Firma', aliases: ['firma', 'unternehmen'] },
  email: { label: 'E-Mail', aliases: ['e mail', 'email', 'mail'] },
  phone: { label: 'Telefon', aliases: ['telefon', 'tel', 'mobile', 'natel', 'handy'] },
  iban: { label: 'IBAN', aliases: ['iban'] },
  street: { label: 'Strasse', aliases: ['strasse', 'adresse'] },
  zip: { label: 'PLZ', aliases: ['plz'] },
  city: { label: 'Ort', aliases: ['ort', 'stadt'] },
};

export async function previewTenantSync(organizationId: string, buf: Buffer, fileName: string, user: AuthUser) {
  const sheets = await readWorkbookRows(buf);
  const sheet = sheets.find((s) => normalizeText(s.name).includes('mieter')) ?? sheets[0];
  if (!sheet) throw badRequest('Die Datei enthält keine Tabellenblätter.');
  const header = sheet.rows[0]?.map((c) => normalizeText(String(c ?? ''))) ?? [];
  const col: Record<string, number> = {};
  for (const [field, def] of Object.entries(TENANT_FIELDS)) {
    const idx = header.findIndex((h) => def.aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  if (col.lastName === undefined && col.companyName === undefined) throw badRequest('Spalte "Nachname" oder "Firma" wurde nicht gefunden.');

  const tenants = await prisma.tenant.findMany({ where: { organizationId } });
  const rows: TenantSyncRow[] = [];
  sheet.rows.slice(1).forEach((r, i) => {
    const data: Record<string, string | null> = {};
    for (const [field, idx] of Object.entries(col)) {
      const v = r[idx];
      data[field] = v === null || v === undefined || v === '' ? null : String(v instanceof Date ? v.toISOString().slice(0, 10) : v).trim();
    }
    if (!data.lastName && !data.companyName) return;
    const label = data.companyName ?? `${data.lastName ?? ''} ${data.firstName ?? ''}`.trim();
    let match = data.id ? tenants.find((t) => t.id === data.id) : undefined;
    if (!match && data.email) match = tenants.find((t) => t.email && t.email.toLowerCase() === data.email!.toLowerCase());
    if (!match)
      match = tenants.find(
        (t) =>
          normalizeText(t.lastName) === normalizeText(data.lastName) &&
          normalizeText(t.firstName) === normalizeText(data.firstName) &&
          (data.lastName || normalizeText(t.companyName) === normalizeText(data.companyName)),
      );
    if (data.id && !match) {
      rows.push({ row: i + 2, action: 'SKIP', tenantId: null, label, changes: [], data, message: 'Unbekannte Mieter-ID' });
      return;
    }
    if (!match) {
      rows.push({ row: i + 2, action: 'CREATE', tenantId: null, label, changes: [], data });
      return;
    }
    const changes: TenantSyncRow['changes'] = [];
    for (const field of Object.keys(col)) {
      if (field === 'id') continue;
      const from = (match as unknown as Record<string, unknown>)[field] ?? null;
      const to = data[field];
      // Leere Excel-Zellen überschreiben niemals bestehende Daten
      if (to === null) continue;
      if (String(from ?? '') !== to) changes.push({ field, label: TENANT_FIELDS[field].label, from, to });
    }
    rows.push({ row: i + 2, action: changes.length ? 'UPDATE' : 'UNCHANGED', tenantId: match.id, label, changes, data });
  });

  const job = await prisma.syncJob.create({
    data: {
      organizationId,
      kind: 'TENANTS_IMPORT',
      fileName,
      status: 'PREVIEW',
      preview: { rows, sheet: sheet.name } as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });
  return { jobId: job.id, sheet: sheet.name, rows };
}

export async function applyTenantSync(jobId: string, selectedRows: number[], user: AuthUser) {
  const job = await prisma.syncJob.findFirst({ where: { id: jobId, organizationId: user.organizationId } });
  if (!job) throw notFound('Synchronisierung');
  if (job.status !== 'PREVIEW') throw badRequest('Diese Synchronisierung wurde bereits angewendet.');
  const { rows } = job.preview as unknown as { rows: TenantSyncRow[] };
  const selected = rows.filter((r) => selectedRows.includes(r.row) && (r.action === 'CREATE' || r.action === 'UPDATE'));
  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of selected) {
      const { id: _id, ...fields } = r.data;
      if (r.action === 'CREATE') {
        const t = await tx.tenant.create({
          data: { organizationId: user.organizationId, isCompany: !!fields.companyName && !fields.lastName, ...fields },
        });
        await audit({ user, organizationId: user.organizationId }, { action: 'tenant.create', entityType: 'Tenant', entityId: t.id, summary: `Mieter ${r.label} per Excel angelegt`, newValues: fields }, tx);
        created++;
      } else if (r.tenantId) {
        const patch = Object.fromEntries(r.changes.map((c) => [c.field, c.to]));
        await tx.tenant.update({ where: { id: r.tenantId }, data: patch });
        await audit(
          { user, organizationId: user.organizationId },
          {
            action: 'tenant.update',
            entityType: 'Tenant',
            entityId: r.tenantId,
            summary: `Mieter ${r.label} per Excel aktualisiert`,
            oldValues: Object.fromEntries(r.changes.map((c) => [c.field, c.from])),
            newValues: patch,
          },
          tx,
        );
        updated++;
      }
    }
    await tx.syncJob.update({ where: { id: jobId }, data: { status: 'APPLIED', appliedAt: new Date() } });
  });
  return { created, updated };
}

// ───────────── Bestehende Excel-Datei aktualisieren (Kopie, nie Original) ─────────────

interface CellChange {
  sheet: string;
  row: number;
  col: number;
  label: string;
  period: string;
  from: number | string | null;
  to: number;
}

/**
 * Liest eine bestehende Excel-Liste mit Monatsspalten (Januar … Dezember)
 * und ermittelt, welche Zellen gemäss verbuchten Zahlungen abweichen.
 * Die Zeilen werden über Wohnungsbezeichnung oder Mietername zugeordnet.
 */
export async function previewExcelUpdate(organizationId: string, buf: Buffer, fileName: string, year: number, user: AuthUser) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const leases = await prisma.lease.findMany({
    where: { unit: { property: { organizationId } } },
    include: { tenant: true, unit: true, charges: { where: { period: { startsWith: `${year}-` } } } },
  });
  const changes: CellChange[] = [];
  const unmatchedRows: string[] = [];
  const monthIdx = MONTH_NAMES_DE.map((m) => normalizeText(m));

  wb.eachSheet((ws) => {
    let headerRow = 0;
    const monthCols: Record<number, number> = {};
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
      const row = ws.getRow(r);
      const found: Record<number, number> = {};
      row.eachCell((cell, colNumber) => {
        const v = normalizeText(String(cell.text ?? ''));
        const i = monthIdx.findIndex((m) => v === m || v === m.slice(0, 3) || v.startsWith(m));
        if (i >= 0) found[i + 1] = colNumber;
      });
      if (Object.keys(found).length >= 6) {
        headerRow = r;
        Object.assign(monthCols, found);
      }
    }
    if (!headerRow) return;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const texts: string[] = [];
      row.eachCell((cell, c) => {
        if (!Object.values(monthCols).includes(c)) texts.push(normalizeText(cell.text));
      });
      const joined = ` ${texts.join(' ')} `;
      if (!joined.trim()) continue;
      const lease = leases.find((l) => {
        const last = normalizeText(l.tenant.lastName ?? l.tenant.companyName);
        return (last && joined.includes(` ${last} `)) || texts.includes(normalizeText(l.unit.label));
      });
      if (!lease) {
        if (texts.some((t) => t.length > 2) && !/total|summe/.test(joined)) unmatchedRows.push(`${ws.name}!${r}: ${texts.filter(Boolean).join(' / ')}`);
        continue;
      }
      for (const [month, col] of Object.entries(monthCols)) {
        const period = `${year}-${String(month).padStart(2, '0')}`;
        const charge = lease.charges.find((c) => c.period === period);
        if (!charge) continue;
        const cell = row.getCell(col);
        const current = typeof cell.value === 'number' ? Math.round(cell.value * 100) : parseMoneyToCents(cell.text || '') ;
        if (current !== charge.paidCents && !(current === null && charge.paidCents === 0)) {
          changes.push({
            sheet: ws.name,
            row: r,
            col,
            label: `${lease.tenant.lastName ?? lease.tenant.companyName} · ${lease.unit.label}`,
            period,
            from: current === null ? null : current / 100,
            to: charge.paidCents / 100,
          });
        }
      }
    }
  });

  const key = makeStorageKey(organizationId, fileName);
  await storage.put(key, buf);
  const job = await prisma.syncJob.create({
    data: {
      organizationId,
      kind: 'EXCEL_UPDATE',
      fileName,
      status: 'PREVIEW',
      preview: { changes, unmatchedRows, year, storageKey: key } as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });
  return { jobId: job.id, changes, unmatchedRows };
}

/** Schreibt die bestätigten Änderungen in eine NEUE Kopie der Datei. */
export async function applyExcelUpdate(jobId: string, selected: number[] | 'all', user: AuthUser) {
  const job = await prisma.syncJob.findFirst({ where: { id: jobId, organizationId: user.organizationId } });
  if (!job) throw notFound('Synchronisierung');
  if (job.status !== 'PREVIEW') throw badRequest('Bereits angewendet.');
  const preview = job.preview as unknown as { changes: CellChange[]; storageKey: string; year: number };
  const original = await storage.get(preview.storageKey);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(original as unknown as ArrayBuffer);
  const apply = preview.changes.filter((_, i) => selected === 'all' || selected.includes(i));
  for (const c of apply) {
    const ws = wb.getWorksheet(c.sheet);
    if (!ws) continue;
    const cell = ws.getRow(c.row).getCell(c.col);
    cell.value = c.to;
    cell.numFmt = CHF;
  }
  const out = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const base = (job.fileName ?? 'Excel.xlsx').replace(/\.xlsx$/i, '');
  const name = `${base}-aktualisiert-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const key = makeStorageKey(user.organizationId, name);
  await storage.put(key, out);
  const doc = await prisma.document.create({
    data: {
      organizationId: user.organizationId,
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: out.length,
      storageKey: key,
      sha256: sha256(out),
      category: 'EXPORT',
      description: `Aktualisierte Kopie von ${job.fileName} (${apply.length} Zellen)`,
      uploadedById: user.id,
    },
  });
  await prisma.syncJob.update({ where: { id: jobId }, data: { status: 'APPLIED', appliedAt: new Date(), documentId: doc.id } });
  await audit(
    { user, organizationId: user.organizationId },
    { action: 'excel.update', entityType: 'SyncJob', entityId: jobId, summary: `${apply.length} Zellen in Kopie von "${job.fileName}" aktualisiert`, newValues: { documentId: doc.id } },
  );
  return { documentId: doc.id, name, applied: apply.length };
}
