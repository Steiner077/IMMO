import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { normalizeText, parseMoneyToCents } from '@immo/shared';
import { parseDate } from './dates.js';
import type { ParseResult, ParsedTransaction } from './types.js';

type Cell = string | number | Date | null;

/**
 * Spaltenerkennung für CSV- und Excel-Exporte gängiger Banken
 * sowie für eigene Excel-Listen.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['buchungsdatum', 'datum', 'buchungstag', 'date', 'booking date', 'abschlussdatum', 'transaktionsdatum', 'zahlungsdatum'],
  valueDate: ['valuta', 'valutadatum', 'value date', 'wertstellung'],
  amount: ['betrag', 'amount', 'betrag chf', 'betrag in chf', 'umsatz'],
  credit: ['gutschrift', 'haben', 'credit', 'gutschrift in chf', 'eingang'],
  debit: ['belastung', 'soll', 'debit', 'lastschrift', 'belastung in chf', 'ausgang'],
  payer: ['auftraggeber', 'zahler', 'name', 'absender', 'gegenpartei', 'beguenstigter auftraggeber', 'mieter', 'payer', 'counterparty', 'name des zahlungspflichtigen'],
  iban: ['iban', 'konto', 'kontonummer', 'iban auftraggeber', 'iban gegenpartei'],
  reference: ['mitteilung', 'referenz', 'zahlungszweck', 'verwendungszweck', 'reference', 'mitteilungen', 'zusaetzliche informationen', 'bemerkung'],
  text: ['buchungstext', 'text', 'beschreibung', 'description', 'details', 'avisierungstext'],
};

function detectHeader(rows: Cell[][]): { index: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const map: Record<string, number> = {};
    rows[i].forEach((cell, col) => {
      const n = normalizeText(String(cell ?? ''));
      if (!n) return;
      for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (map[key] !== undefined) continue;
        if (aliases.some((a) => n === a || n.startsWith(a + ' ') || (a.length > 5 && n.includes(a)))) {
          map[key] = col;
          break;
        }
      }
    });
    if (map.date !== undefined && (map.amount !== undefined || map.credit !== undefined)) return { index: i, map };
  }
  return null;
}

function cellStr(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

function toCents(c: Cell): number | null {
  if (c === null || c === undefined || c === '') return null;
  if (typeof c === 'number') return Math.round(c * 100);
  return parseMoneyToCents(String(c));
}

export function tableToTransactions(rows: Cell[][], format: string): ParseResult {
  const warnings: string[] = [];
  const header = detectHeader(rows);
  if (!header) {
    return { transactions: [], meta: { format, warnings: ['Keine Kopfzeile mit Datum und Betrag gefunden.'] } };
  }
  const { map } = header;
  const txs: ParsedTransaction[] = [];
  for (let i = header.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => c === null || c === '')) continue;
    const date = parseDate(r[map.date] as string | Date | number);
    if (!date) continue;
    let amount: number | null = null;
    let isCredit = true;
    if (map.credit !== undefined && toCents(r[map.credit])) {
      amount = Math.abs(toCents(r[map.credit])!);
      isCredit = true;
    } else if (map.debit !== undefined && toCents(r[map.debit])) {
      amount = Math.abs(toCents(r[map.debit])!);
      isCredit = false;
    } else if (map.amount !== undefined) {
      const v = toCents(r[map.amount]);
      if (v !== null) {
        amount = Math.abs(v);
        isCredit = v >= 0;
      }
    }
    if (!amount) continue;
    const text = map.text !== undefined ? cellStr(r[map.text]) : '';
    let payer = map.payer !== undefined ? cellStr(r[map.payer]) : '';
    let reference = map.reference !== undefined ? cellStr(r[map.reference]) : '';
    const iban = map.iban !== undefined ? cellStr(r[map.iban]).replace(/\s/g, '') : '';
    if (!payer && text) {
      const m = text.match(/(?:gutschrift von|zahlung von|auftraggeber:?|von:?)\s*([^,;\n]+)/i);
      payer = m ? m[1].trim() : '';
    }
    if (!reference && text) reference = text;
    txs.push({
      bookingDate: date,
      valueDate: map.valueDate !== undefined ? parseDate(r[map.valueDate] as string) : null,
      amountCents: amount,
      isCredit,
      payerName: payer || null,
      payerIban: /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/i.test(iban) ? iban.toUpperCase() : null,
      reference: reference || null,
      rawText: r.map(cellStr).filter(Boolean).join(' | ').slice(0, 2000),
    });
  }
  if (!txs.length) warnings.push('Keine Buchungen gefunden.');
  return { transactions: txs, meta: { format, warnings } };
}

export function parseCsvBuffer(buf: Buffer): ParseResult {
  let text = buf.toString('utf8');
  if (text.includes('�')) text = buf.toString('latin1');
  text = text.replace(/^﻿/, '');
  const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delimiter = [';', ',', '\t'].sort((a, b) => firstLines.split(b).length - firstLines.split(a).length)[0];
  const rows = parseCsv(text, {
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    bom: true,
  }) as string[][];
  return tableToTransactions(rows, 'csv');
}

export async function readWorkbookRows(buf: Buffer): Promise<{ name: string; rows: Cell[][] }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: { name: string; rows: Cell[][] }[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map((v): Cell => {
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v;
        if (typeof v === 'object') {
          const o = v as { result?: unknown; text?: string; richText?: { text: string }[] };
          if (o.result !== undefined) return o.result as Cell;
          if (o.richText) return o.richText.map((t) => t.text).join('');
          if (o.text) return o.text;
          return null;
        }
        return v as Cell;
      });
      rows.push(values);
    });
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

export async function parseXlsxBuffer(buf: Buffer): Promise<ParseResult> {
  const sheets = await readWorkbookRows(buf);
  for (const s of sheets) {
    const r = tableToTransactions(s.rows, 'xlsx');
    if (r.transactions.length) return { ...r, meta: { ...r.meta, format: `xlsx:${s.name}` } };
  }
  return { transactions: [], meta: { format: 'xlsx', warnings: ['In keinem Tabellenblatt wurden Zahlungen erkannt.'] } };
}
