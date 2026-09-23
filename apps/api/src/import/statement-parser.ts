import { parseMoneyToCents } from '@immo/shared';
import { parseDate } from './dates.js';
import type { ParseResult, ParsedTransaction, TextLine } from './types.js';

/**
 * Generischer Parser für Kontoauszüge (PDF-Text mit Positionen).
 *
 * Unterstützt die üblichen Layouts Schweizer und deutscher Banken:
 * Spalten "Belastung/Gutschrift" (UBS, ZKB, Raiffeisen, PostFinance),
 * "Soll/Haben", "Debit/Credit" oder vorzeichenbehaftete Beträge.
 * Eine Buchung beginnt mit einer Datumszeile; folgende Zeilen ohne
 * Datum gehören als Detailtext (Zahler, IBAN, Mitteilung) dazu.
 */

const LINE_DATE_START = /^\s*(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))\b/;
const AMOUNT_TOKEN = /^-?\d{1,3}(?:['’ ]\d{3})*(?:[.,]\d{2})$|^-?\d+[.,]\d{2}$/;
const IBAN_RE = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?)\b/;
const QR_REF_RE = /\b(\d{2}(?:\s?\d{5}){5})\b/;

const CREDIT_HEADERS = ['gutschrift', 'haben', 'credit', 'eingang', 'einnahmen'];
const DEBIT_HEADERS = ['belastung', 'soll', 'debit', 'lastschrift', 'ausgang', 'ausgaben'];
const BALANCE_HEADERS = ['saldo', 'balance', 'kontostand'];

const CREDIT_WORDS = /gutschrift|zahlungseingang|eingang|einzahlung|überweisung von|ueberweisung von|credit|vergütung|verguetung|qr-zahlung von|zahlung von/i;
const DEBIT_WORDS = /belastung|lastschrift|zahlung an|dauerauftrag an|bezug|debit|e-banking auftrag|gebühr|gebuehr|kartenzahlung|abbuchung/i;
const SKIP_LINE = /^(saldo|saldovortrag|kontostand|übertrag|uebertrag|total|summe|seite \d|page \d|anfangssaldo|schlusssaldo|endsaldo)/i;
const PAYER_PREFIX = /^(gutschrift von|zahlung von|überweisung von|ueberweisung von|auftraggeber:?|von:?|absender:?|zahler:?|qr-zahlung von|einzahlung von)\s*/i;
const REF_PREFIX = /^(mitteilung:?|zahlungszweck:?|verwendungszweck:?|referenz:?|ref\.?:?|zusätzliche informationen:?|zusaetzliche informationen:?|info:?|bemerkung:?)\s*/i;

interface Column {
  kind: 'credit' | 'debit' | 'balance';
  x: number;
}

function detectColumns(lines: TextLine[]): Column[] | null {
  for (const line of lines) {
    const cols: Column[] = [];
    for (const item of line.items) {
      const s = item.str.trim().toLowerCase();
      if (!s) continue;
      const center = item.x + item.width / 2;
      if (CREDIT_HEADERS.some((h) => s === h || s.startsWith(h))) cols.push({ kind: 'credit', x: center });
      else if (DEBIT_HEADERS.some((h) => s === h || s.startsWith(h))) cols.push({ kind: 'debit', x: center });
      else if (BALANCE_HEADERS.some((h) => s === h || s.startsWith(h))) cols.push({ kind: 'balance', x: center });
    }
    if (cols.some((c) => c.kind === 'credit') && cols.some((c) => c.kind === 'debit')) return cols;
  }
  return null;
}

function nearestColumn(cols: Column[], x: number): Column {
  return cols.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best));
}

/** Findet Beträge in einer Zeile inkl. x-Position (rechtsbündig → Ende des Textes). */
function amountsInLine(line: TextLine): { cents: number; x: number }[] {
  const out: { cents: number; x: number }[] = [];
  for (const item of line.items) {
    const raw = item.str.trim();
    if (AMOUNT_TOKEN.test(raw)) {
      const cents = parseMoneyToCents(raw);
      if (cents !== null) out.push({ cents, x: item.x + item.width / 2 });
    }
  }
  if (out.length === 0) {
    // Fallback: Beträge im Fliesstext (ohne Positionsinformation)
    const re = /(-?\d{1,3}(?:['’]\d{3})+(?:\.\d{2})|-?\d+\.\d{2})(?!\d)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text))) {
      const cents = parseMoneyToCents(m[1]);
      if (cents !== null) out.push({ cents, x: m.index * 5 });
    }
  }
  return out;
}

function stripDatesAndAmounts(text: string): string {
  return text
    .replace(/\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b/g, ' ')
    .replace(/-?\d{1,3}(?:['’]\d{3})+(?:\.\d{2})|-?\d+\.\d{2}(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractDetails(blockLines: string[]): { payerName: string | null; payerIban: string | null; reference: string | null } {
  let payerName: string | null = null;
  let payerIban: string | null = null;
  const refs: string[] = [];
  const candidates: string[] = [];

  for (const rawLine of blockLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const iban = line.match(IBAN_RE);
    if (iban && !payerIban) {
      payerIban = iban[1].replace(/\s/g, '');
      const rest = line.replace(iban[0], '').replace(/^(iban|konto)[: ]*/i, '').trim();
      if (!rest) continue;
    }
    if (PAYER_PREFIX.test(line)) {
      const name = line.replace(PAYER_PREFIX, '').replace(IBAN_RE, '').trim();
      if (name && !payerName) payerName = name.replace(/[,;]+$/, '');
      continue;
    }
    if (REF_PREFIX.test(line)) {
      refs.push(line.replace(REF_PREFIX, '').trim());
      continue;
    }
    const qr = line.match(QR_REF_RE);
    if (qr) refs.push(qr[1]);
    if (/miet|zins|nebenkost|wohnung|whg|nk\b|akonto|parkplatz|garage/i.test(line)) {
      refs.push(line);
      continue;
    }
    candidates.push(line);
  }

  if (!payerName) {
    // Erste Zeile, die wie ein Name aussieht (keine Adresse / PLZ / Ziffernfolge)
    payerName =
      candidates.find(
        (c) =>
          /[a-zA-ZäöüÄÖÜ]{2,}/.test(c) &&
          !/^\d{4,5}\s/.test(c) &&
          !/strasse|str\.|weg\b|gasse|platz\b|\d{4}\s+[a-z]/i.test(c) &&
          !CREDIT_WORDS.test(c) &&
          !DEBIT_WORDS.test(c),
      ) ?? null;
  }
  return {
    payerName: payerName ? payerName.slice(0, 200) : null,
    payerIban,
    reference: refs.length ? [...new Set(refs)].join(' · ').slice(0, 500) : null,
  };
}

export function parseStatementLines(lines: TextLine[]): ParseResult {
  const warnings: string[] = [];
  const columns = detectColumns(lines);
  const transactions: ParsedTransaction[] = [];

  let current: { head: TextLine; details: string[]; amounts: { cents: number; x: number }[] } | null = null;

  const flush = () => {
    if (!current) return;
    const { head, details, amounts } = current;
    current = null;
    const dateMatch = head.text.match(LINE_DATE_START);
    const bookingDate = dateMatch ? parseDate(dateMatch[1]) : null;
    if (!bookingDate || amounts.length === 0) return;
    const headText = stripDatesAndAmounts(head.text);
    const allText = [headText, ...details].join('\n');
    if (SKIP_LINE.test(headText)) return;

    const dates = head.text.match(/\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b/g) ?? [];
    const valueDate = dates.length > 1 ? parseDate(dates[dates.length - 1]) : null;

    let amountCents: number | null = null;
    let isCredit = true;

    if (columns) {
      const credit = amounts.find((a) => nearestColumn(columns, a.x).kind === 'credit');
      const debit = amounts.find((a) => nearestColumn(columns, a.x).kind === 'debit');
      if (credit) {
        amountCents = Math.abs(credit.cents);
        isCredit = true;
      } else if (debit) {
        amountCents = Math.abs(debit.cents);
        isCredit = false;
      }
    }
    if (amountCents === null) {
      // Ohne Spaltenerkennung: letzter Betrag ist häufig der Saldo
      const candidate = amounts.length >= 2 ? amounts[0] : amounts[0];
      amountCents = Math.abs(candidate.cents);
      if (candidate.cents < 0) isCredit = false;
      else if (DEBIT_WORDS.test(allText) && !CREDIT_WORDS.test(allText)) isCredit = false;
      else isCredit = true;
    }
    if (!amountCents) return;

    const detailLines = [headText.replace(CREDIT_WORDS, '').trim(), ...details];
    const d = extractDetails(detailLines.filter(Boolean));
    if (!d.payerName) {
      const cleaned = headText.replace(/^(gutschrift|zahlungseingang|einzahlung|überweisung|qr-zahlung)\s*/i, '').trim();
      if (cleaned && !CREDIT_WORDS.test(cleaned)) d.payerName = cleaned;
    }

    transactions.push({
      bookingDate,
      valueDate,
      amountCents,
      isCredit,
      payerName: d.payerName,
      payerIban: d.payerIban,
      reference: d.reference,
      rawText: [head.text.trim(), ...details].join('\n').slice(0, 2000),
    });
  };

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    if (LINE_DATE_START.test(text)) {
      flush();
      const amounts = amountsInLine(line);
      current = { head: line, details: [], amounts };
      continue;
    }
    if (!current) continue;
    if (SKIP_LINE.test(text) || /^(datum|buchungsdatum|valuta|text|buchungstext)\b/i.test(text)) {
      flush();
      continue;
    }
    // Betrag auf Folgezeile (manche Layouts)
    if (current.amounts.length === 0) {
      const a = amountsInLine(line);
      if (a.length) {
        current.amounts = a;
        const rest = stripDatesAndAmounts(text);
        if (rest) current.details.push(rest);
        continue;
      }
    }
    if (current.details.length < 8) current.details.push(text);
  }
  flush();

  if (!transactions.length) warnings.push('Im Dokument wurden keine Buchungen erkannt.');
  if (!columns) warnings.push('Keine Spalten Belastung/Gutschrift erkannt – Richtung wurde anhand des Buchungstextes bestimmt.');

  const ibanLine = lines.find((l) => /iban/i.test(l.text) && IBAN_RE.test(l.text));
  return {
    transactions,
    meta: {
      format: columns ? 'bank-statement-columns' : 'bank-statement-text',
      iban: ibanLine ? ibanLine.text.match(IBAN_RE)![1].replace(/\s/g, '') : null,
      warnings,
      lineCount: lines.length,
    },
  };
}

/** Hilfsfunktion für reinen Text ohne Positionsangaben (z. B. Tests, .txt). */
export function textToLines(text: string): TextLine[] {
  return text.split(/\r?\n/).map((t, i) => {
    const items: TextLine['items'] = [];
    let x = 0;
    for (const part of t.split(/(\s{2,})/)) {
      if (part.trim()) items.push({ str: part.trim(), x, width: part.length });
      x += part.length;
    }
    return { page: 1, y: i, text: t, items };
  });
}
