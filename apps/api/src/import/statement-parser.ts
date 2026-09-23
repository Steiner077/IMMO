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
const AMOUNT_TOKEN = /^-?\d{1,3}(?:['’.,]\d{3})*(?:[.,]\d{2})$|^-?\d+[.,]\d{2}$|^-?\d{1,3}(?:['’]\d{3})+\.-$|^-?\d+\.-$/;
const IBAN_RE = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?)\b/;
const QR_REF_RE = /\b(\d{2}(?:\s?\d{5}){5})\b/;

const CREDIT_HEADERS = ['gutschrift', 'haben', 'credit', 'eingang', 'einnahmen'];
const DEBIT_HEADERS = ['belastung', 'soll', 'debit', 'lastschrift', 'ausgang', 'ausgaben'];
const BALANCE_HEADERS = ['saldo', 'balance', 'kontostand'];

const CREDIT_WORDS = /gutschrift|zahlungseingang|eingang|einzahlung|überweisung von|ueberweisung von|credit|vergütung|verguetung|qr-zahlung von|zahlung von/i;
const DEBIT_WORDS = /belastung|lastschrift|zahlung an|dauerauftrag an|bezug|debit|e-banking auftrag|gebühr|gebuehr|kartenzahlung|abbuchung/i;
const SKIP_LINE = /^(saldo|saldovortrag|kontostand|übertrag|uebertrag|total|summe|seite \d|page \d|anfangssaldo|schlusssaldo|endsaldo)/i;
const PAYER_PREFIX = /^(gutschrift von|zahlung von|überweisung von|ueberweisung von|auftraggeber:?|von:?|absender:?|zahler:?|qr-zahlung von|einzahlung von)\s*/i;
/** Buchungsarten am Zeilenanfang – sind nie der Name des Zahlers */
const BOOKING_TYPE = /^(gutschrift|überweisung|ueberweisung|dauerauftrag|zahlungseingang|zahlung|lastschrift|belastung|einzahlung|e-banking-auftrag|e-banking|qr-zahlung|vergütung|verguetung|twint|bankomat|kartenzahlung|sammelgutschrift)\b\s*(von|an)?[:\s]*/i;
const REF_PREFIX = /^(mitteilung:?|zahlungszweck:?|verwendungszweck:?|referenz:?|ref\.?:?|zusätzliche informationen:?|zusaetzliche informationen:?|info:?|bemerkung:?)\s*/i;

interface Column {
  kind: 'credit' | 'debit' | 'balance';
  x: number;
}

function detectColumns(lines: TextLine[]): Column[] | null {
  for (const line of lines) {
    const cols: Column[] = [];
    // Überschriften wortweise auswerten (OCR/PDF fassen z. B. "Gutschrift Valuta" zusammen)
    const words: { s: string; center: number }[] = [];
    for (const item of line.items) {
      const str = item.str.trim();
      if (!str) continue;
      const charW = item.width / Math.max(1, str.length);
      let offset = 0;
      for (const part of str.split(/(\s+)/)) {
        if (part.trim()) words.push({ s: part.toLowerCase(), center: item.x + (offset + part.length / 2) * charW });
        offset += part.length;
      }
    }
    for (const { s, center } of words) {
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
    const re = /(-?\d{1,3}(?:['’]\d{3})+(?:\.\d{2})|-?\d+\.\d{2})(?![\d.])/g;
    const withoutDates = line.text.replace(/\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b/g, (d) => ' '.repeat(d.length));
    let m: RegExpExecArray | null;
    while ((m = re.exec(withoutDates))) {
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
    const line = rawLine.replace(/\s+/g, ' ').trim();
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

export interface StatementOptions {
  /** Spaltenpositionen verwenden (nur bei positionsgetreuem Text: PDF/OCR/ausgerichteter Text) */
  trustColumns?: boolean;
}

const OPENING_BALANCE = /(saldovortrag|anfangssaldo|saldo per|saldo vortrag|übertrag|uebertrag|alter saldo|kontostand per)/i;

export function parseStatementLines(lines: TextLine[], opts: StatementOptions = {}): ParseResult {
  const warnings: string[] = [];
  const columns = opts.trustColumns === false ? null : detectColumns(lines);
  let openingBalance: number | null = null;
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
    if (SKIP_LINE.test(headText) || OPENING_BALANCE.test(headText)) {
      if (OPENING_BALANCE.test(headText) && openingBalance === null && transactions.length === 0) openingBalance = amounts[amounts.length - 1].cents;
      return;
    }

    const dates = head.text.match(/\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b/g) ?? [];
    const valueDate = dates.length > 1 ? parseDate(dates[dates.length - 1]) : null;

    let amountCents: number | null = null;
    let isCredit = true;
    let balanceCents: number | null = null;
    if (columns) {
      const bal = amounts.find((a) => nearestColumn(columns, a.x).kind === 'balance');
      if (bal) balanceCents = bal.cents;
    } else if (amounts.length >= 2) {
      balanceCents = amounts[amounts.length - 1].cents;
    }

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

    const headClean = headText.replace(BOOKING_TYPE, '').trim();
    const detailLines = [headClean, ...details.map((l) => (BOOKING_TYPE.test(l.trim()) && l.trim().replace(BOOKING_TYPE, '') === '' ? '' : l))];
    const d = extractDetails(detailLines.filter(Boolean));

    transactions.push({
      bookingDate,
      valueDate,
      amountCents,
      isCredit,
      payerName: d.payerName,
      payerIban: d.payerIban,
      reference: d.reference,
      rawText: [head.text.trim(), ...details].join('\n').slice(0, 2000),
      balanceCents,
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

  const balanceCheck = verifyByBalance(transactions, openingBalance);
  if (balanceCheck.corrected) warnings.push(`Saldo-Kontrolle: Bei ${balanceCheck.corrected} Buchung(en) wurde die Richtung (Gutschrift/Belastung) anhand des Kontosaldos korrigiert.`);
  if (balanceCheck.checked && balanceCheck.verified < balanceCheck.checked)
    warnings.push(`Saldo-Kontrolle: ${balanceCheck.checked - balanceCheck.verified} Betrag/Beträge passen nicht zum Saldo – bitte besonders prüfen.`);
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
      balanceCheck: balanceCheck.checked ? balanceCheck : null,
    },
  };
}

/**
 * Saldo-Kontrolle: Der Kontosaldo nach jeder Buchung muss dem vorherigen Saldo
 * ± Betrag entsprechen. Stimmt die Rechnung, sind Betrag UND Richtung bestätigt –
 * unabhängig vom Layout. Das deckt auch Lesefehler der Texterkennung auf.
 */
export function verifyByBalance(txs: ParsedTransaction[], opening: number | null) {
  let prev = opening;
  let verified = 0;
  let checked = 0;
  let corrected = 0;
  for (const t of txs) {
    const bal = t.balanceCents ?? null;
    if (bal !== null && bal !== t.amountCents && prev !== null) {
      checked++;
      const diff = bal - prev;
      if (Math.abs(diff) === t.amountCents) {
        const credit = diff > 0;
        if (credit !== t.isCredit) corrected++;
        t.isCredit = credit;
        t.verified = true;
        verified++;
      } else {
        t.verified = false;
      }
      prev = bal;
    } else if (bal !== null && bal !== t.amountCents) {
      prev = bal;
    } else if (prev !== null) {
      prev = prev + (t.isCredit ? t.amountCents : -t.amountCents);
    }
  }
  return { verified, checked, corrected };
}

/**
 * Wandelt reinen Text (eingefügt oder aus .txt) in Zeilen mit Wortpositionen um.
 * Die Zeichenposition dient als x-Koordinate.
 */
export function textToLines(text: string): TextLine[] {
  return text
    .replace(/\t/g, '    ')
    .split(/\r?\n/)
    .map((t, i) => {
      const items: TextLine['items'] = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) items.push({ str: m[0], x: m.index, width: m[0].length });
      return { page: 1, y: i, text: t, items };
    });
}

/** Ist der Text spaltengetreu ausgerichtet (mehrfache Leerzeichen/Tabs zwischen Spalten)? */
export function looksAligned(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => /\d/.test(l) && l.trim().length > 20);
  if (lines.length < 3) return false;
  const aligned = lines.filter((l) => /\S( {2,}|\t)\S/.test(l)).length;
  return aligned / lines.length > 0.6;
}

/** Eingefügten Kontoauszugstext analysieren */
export function parseStatementText(text: string): ParseResult {
  const aligned = looksAligned(text);
  const res = parseStatementLines(textToLines(text), { trustColumns: aligned });
  if (!aligned) res.meta.format = 'text-pasted';
  return res;
}
