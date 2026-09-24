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


const IBAN_RE = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?)\b/;
const QR_REF_RE = /\b(\d{2}(?:\s?\d{5}){5})\b/;

const CREDIT_WORDS = /gutschrift|zahlungseingang|eingang|einzahlung|überweisung von|ueberweisung von|credit|vergütung|verguetung|qr-zahlung von|zahlung von/i;
const DEBIT_WORDS = /belastung|lastschrift|zahlung an|dauerauftrag|bezug|debit|e-banking auftrag|gebühr|gebuehr|kartenzahlung|abbuchung|spesen/i;
const SKIP_LINE = /^(saldo|saldovortrag|kontostand|übertrag|uebertrag|total|summe|seite \d|page \d|anfangssaldo|schlusssaldo|endsaldo|umsatztotal|zwischentotal|umsatz\b|total umsatz)/i;
const OPENING_BALANCE = /^(saldovortrag|anfangssaldo|saldo per|saldo vortrag|saldo$|saldo chf|übertrag|uebertrag|alter saldo|kontostand per|kontostand)/i;
const PAYER_PREFIX = /^(?:gutschrift von|zahlung von|überweisung von|ueberweisung von|auftraggeber|von|absender|zahler|qr-zahlung von|einzahlung von)\b:?\s*/i;
/** Buchungsarten am Zeilenanfang – sind nie der Name des Zahlers */
const BOOKING_TYPE = /^(gutschrift|überweisung|ueberweisung|dauerauftrag|zahlungseingang|zahlung|lastschrift|belastung|einzahlung|e-banking-auftrag|e-banking|qr-zahlung|vergütung|verguetung|twint|bankomat|kartenzahlung|sammelgutschrift)\b\s*(?:(?:von|an)\b)?[:\s]*/i;
/** Typische Fuss-/Kopfzeilen der Banken – gehören nie zu einer Buchung */
const PAGE_NOISE = /ohne gewähr|ohne gewaehr|druckdatum|erstellt am|seite \d+ (von|\/) \d+|page \d+ of \d+|^kontoinhaber:|^kontoart:/i;
/** Zeilenanfang einer neuen Buchung (für Buchungen ohne eigenes Datum) */
const BOOKING_START = /^(gutschrift|überweisung|ueberweisung|dauerauftrag|zahlungseingang|zahlung|lastschrift|belastung|einzahlung|auszahlung|e-banking|qr-zahlung|vergütung|verguetung|twint|bankomat|kartenzahlung|sammelgutschrift|sammelzahlung|sammelauftrag|gebühr|gebuehr|spesen|zins|übertrag an|uebertrag an)\b/i;
const REF_PREFIX = /^(mitteilung(?:en)?:?|zahlungszweck:?|verwendungszweck:?|referenz:?|ref\.?:?|zusätzliche informationen:?|zusaetzliche informationen:?|info:?|bemerkung:?)\s*/i;

// ───── Datum ─────

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, feb: 2, februar: 2, mär: 3, maer: 3, mar: 3, märz: 3, maerz: 3, apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12,
};
const FULL_DATE = /\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
/** Datum am Zeilenanfang: 03.09.2026 · 03.09.26 · 03/09/2026 · 2026-09-03 · 03.09. · 3. Sep. 2026 · 03 Sep 2026 */
const LINE_DATE = /^\s*(?:(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b|(\d{4})-(\d{2})-(\d{2})\b|(\d{1,2})\.(\d{1,2})\.(?!\d)|(\d{1,2})\.?\s+([a-zäA-ZÄ]{3,9})\.?\s+(\d{4})\b)/;
/** Alle Datumsformen im Text (zum Entfernen aus dem Buchungstext) */
const ANY_DATE = /\b\d{1,2}[./]\d{1,2}[./](?:\d{4}|\d{2})\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.(?!\d)|\b\d{1,2}\.?\s+[a-zäA-ZÄ]{3,9}\.?\s+\d{4}\b/g;

function mkDate(y: number, m: number, d: number): Date | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/** Liefert das Datum am Zeilenanfang; fehlt das Jahr, kommt es aus dem Kontext */
function lineDate(text: string, ctx: { year: number | null; lastMonth: number | null }): Date | null {
  const m = text.match(LINE_DATE);
  if (!m) return null;
  let date: Date | null = null;
  if (m[1]) date = mkDate(+m[3], +m[2], +m[1]);
  else if (m[4]) date = mkDate(+m[4], +m[5], +m[6]);
  else if (m[7]) {
    const month = +m[8];
    if (!ctx.year || month < 1 || month > 12) return null;
    // Jahreswechsel im Auszug (Dez → Jan)
    if (ctx.lastMonth && month < ctx.lastMonth - 6) ctx.year++;
    date = mkDate(ctx.year, month, +m[7]);
  } else if (m[9]) {
    const month = MONTHS[m[10].toLowerCase().replace(/\.$/, '')];
    if (!month) return null;
    date = mkDate(+m[11], month, +m[9]);
  }
  if (date) {
    ctx.year = date.getUTCFullYear();
    ctx.lastMonth = date.getUTCMonth() + 1;
  }
  return date;
}

// ───── Zeilen in Wörter mit Position zerlegen ─────

interface Token { s: string; x: number; left: number; right: number; cw: number }

function tokenize(line: TextLine): Token[] {
  const out: Token[] = [];
  for (const item of line.items) {
    const str = item.str;
    if (!str.trim()) continue;
    const cw = item.width / Math.max(1, str.length);
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(str))) {
      const left = item.x + m.index * cw;
      const right = left + m[0].length * cw;
      out.push({ s: m[0], x: (left + right) / 2, left, right, cw });
    }
  }
  out.sort((a, b) => a.left - b.left);
  // "1 850.00" (Tausender mit Leerzeichen, PostFinance) zu einem Betrag zusammenfügen
  const merged: Token[] = [];
  for (const t of out) {
    const prev = merged[merged.length - 1];
    if (prev && /^[+-]?\d{1,3}(?: \d{3})*$/.test(prev.s) && /^\d{3}(?:[.,]\d{2}|\.-)?-?$/.test(t.s) && t.left - prev.right <= Math.max(prev.cw, t.cw) * 1.3) {
      prev.s = `${prev.s} ${t.s}`;
      prev.right = t.right;
      prev.x = (prev.left + prev.right) / 2;
      continue;
    }
    merged.push({ ...t });
  }
  return merged;
}

const AMOUNT = /^[+-−]?(?:\d{1,3}(?:['’ ]\d{3})+|\d+)(?:[.,]\d{2}|\.-)-?$|^[+-−]?\d{1,3}(?:\.\d{3})+,\d{2}-?$/;

function amountOf(raw: string): number | null {
  const s = raw.replace(/^(CHF|SFr\.?|Fr\.?|EUR)/i, '').replace(/(CHF|EUR)$/i, '');
  if (!AMOUNT.test(s)) return null;
  return parseMoneyToCents(s.replace(/ /g, "'").replace('−', '-'));
}

// ───── Spalten ─────

type ColKind = 'credit' | 'debit' | 'balance' | 'amount' | 'date';
interface Column { kind: ColKind; x: number }

function headerKind(word: string): ColKind | null {
  const w = word.toLowerCase().replace(/[^a-zäöü]/g, '');
  if (!w) return null;
  if (/^(gutschrift|haben|credit|eingang|eingänge|einnahme|zahlungseingang|zugang)/.test(w) || w === 'eingang') return 'credit';
  if (/^(belastung|lastschrift|soll|debit|ausgang|ausgänge|ausgabe|zahlungsausgang|abgang)/.test(w)) return 'debit';
  if (/^(saldo|balance|kontostand)/.test(w)) return 'balance';
  if (/^(betrag|amount|umsatz)/.test(w)) return 'amount';
  if (/^(valuta|value|wert)/.test(w)) return 'date';
  return null;
}

function columnsOf(tokens: Token[]): Column[] {
  const cols: Column[] = [];
  for (const t of tokens) {
    const kind = headerKind(t.s);
    if (kind) cols.push({ kind, x: t.x });
  }
  return cols;
}

const usable = (cols: Column[]) => (cols.some((c) => c.kind === 'credit') && cols.some((c) => c.kind === 'debit')) || cols.some((c) => c.kind === 'amount');

function detectColumns(lines: TextLine[]): { columns: Column[]; headerIndex: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (LINE_DATE.test(lines[i].text)) continue;
    const cols = columnsOf(tokenize(lines[i]));
    if (!cols.length) continue;
    if (usable(cols)) return { columns: cols, headerIndex: i };
    // Kopfzeile auf zwei Zeilen ("Zahlungs-" / "eingang")
    const next = lines[i + 1];
    if (next && !LINE_DATE.test(next.text)) {
      const both = [...cols, ...columnsOf(tokenize(next))];
      if (usable(both)) return { columns: both, headerIndex: i + 1 };
    }
  }
  return null;
}

function nearest(cols: Column[], x: number): Column {
  return cols.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best));
}

interface Amount { cents: number; x: number; kind: ColKind | null }

function amountsOf(line: TextLine, cols: Column[] | null): Amount[] {
  const out: Amount[] = [];
  for (const t of tokenize(line)) {
    const cents = amountOf(t.s);
    if (cents === null) continue;
    const kind = cols ? nearest(cols, t.x).kind : null;
    if (kind === 'date') continue; // z. B. "04.09" in der Valuta-Spalte
    out.push({ cents, x: t.x, kind });
  }
  return out;
}

function stripDatesAndAmounts(text: string): string {
  return text
    .replace(ANY_DATE, ' ')
    .replace(/(?:CHF|Fr\.)\s*/gi, ' ')
    .replace(/[+-−]?\d{1,3}(?:['’ ]\d{3})+(?:[.,]\d{2}|\.-)-?|[+-−]?\d+[.,]\d{2}-?(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADDRESS_LINE = /^\d{4,5}\s+\p{L}|\b\d{4}\s+\p{L}|(strasse|str\.|weg|gasse|platz|rain|halde|matt|allee|ring|quai|vorstadt)\b.*\d|^\p{L}[\p{L}.\- ]*\s\d{1,4}[a-z]?(,|$)/iu;
const REF_WORDS = /miet|zins\b|nebenkost|wohnung|\bwhg\b|\bnk\b|akonto|parkplatz|parkgeb|einstellplatz|garage|gebühr|gebuehr|\bmonat|rechnung|beitrag|heizkost|\bstrom\b|kaution|depot|abrechnung|zimmer|\b(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/i;
/** "Keller Stefanie", "Moritz Beispiel-Muster", "Fakuri, Sebghatullah" */
const PERSON = /^[\p{Lu}][\p{L}'’.\-]+(?:,?\s+(?:von\s+|de\s+|van\s+)?[\p{Lu}][\p{L}'’.\-]*){1,3}$/u;

export function extractDetails(blockLines: string[]): { payerName: string | null; payerIban: string | null; reference: string | null } {
  let payerName: string | null = null;
  let payerIban: string | null = null;
  /** Name nach der Adresse = eigentlicher Zahler (Überweisung über ein anderes Konto) */
  let onBehalfOf: string | null = null;
  let afterAddress = false;
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
    if (REF_WORDS.test(line)) {
      refs.push(line);
      continue;
    }
    if (ADDRESS_LINE.test(line)) {
      afterAddress = true;
      continue;
    }
    if (afterAddress && !onBehalfOf && PERSON.test(line) && !CREDIT_WORDS.test(line) && !DEBIT_WORDS.test(line)) {
      onBehalfOf = line.replace(/[,;]+$/, '');
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
  if (onBehalfOf && onBehalfOf !== payerName) {
    if (payerName) refs.push(`über Konto ${payerName}`);
    payerName = onBehalfOf;
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

/** Kopf-/Fusszeilen, die auf mehreren Seiten an gleicher Stelle stehen (Kontoinhaber, "Alle Angaben ohne Gewähr" …) */
function withoutPageNoise(lines: TextLine[]): TextLine[] {
  const pages = new Set(lines.map((l) => l.page));
  if (pages.size < 2) return lines;
  const key = (l: TextLine) => `${Math.round(l.y / 4)}|${l.text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()}`;
  const seen = new Map<string, Set<number>>();
  for (const l of lines) seen.set(key(l), (seen.get(key(l)) ?? new Set()).add(l.page));
  return lines.filter((l) => (seen.get(key(l))?.size ?? 0) < 2 || LINE_DATE.test(l.text) || usable(columnsOf(tokenize(l))));
}

export function parseStatementLines(input: TextLine[], opts: StatementOptions = {}): ParseResult {
  const lines = withoutPageNoise(input);
  const warnings: string[] = [];
  let totals: { credit: number | null; debit: number | null } | null = null;
  const detected = opts.trustColumns === false ? null : detectColumns(lines);
  const columns = detected?.columns ?? null;
  const hasDirectionCols = !!columns && columns.some((c) => c.kind === 'credit') && columns.some((c) => c.kind === 'debit');
  let openingBalance: number | null = null;
  const transactions: ParsedTransaction[] = [];

  // Jahr für Daten ohne Jahr (z. B. "28.12.") aus dem ersten vollständigen Datum (Auszugszeitraum)
  const firstFull = lines.map((l) => l.text).join('\n').match(new RegExp(FULL_DATE.source));
  const ctx = { year: firstFull ? (firstFull[3] ? (+firstFull[3] < 100 ? 2000 + +firstFull[3] : +firstFull[3]) : +firstFull[4]) : null, lastMonth: null as number | null };
  if (firstFull && firstFull[2]) ctx.lastMonth = +firstFull[2];

  type Block = { date: Date; headText: string; raw: string[]; details: string[]; amounts: Amount[] };
  let current: Block | null = null;

  const isMoving = (a: Amount) => (columns ? a.kind === 'credit' || a.kind === 'debit' || a.kind === 'amount' : true);

  const flush = () => {
    if (!current) return;
    const { date: bookingDate, headText, details, amounts, raw } = current;
    current = null;
    if (amounts.length === 0) return;
    if (SKIP_LINE.test(headText) || OPENING_BALANCE.test(headText)) {
      if (OPENING_BALANCE.test(headText) && openingBalance === null && transactions.length === 0) openingBalance = amounts[amounts.length - 1].cents;
      return;
    }
    const valueDates = raw[0].match(ANY_DATE) ?? [];
    const valueDate = valueDates.length > 1 ? parseDate(valueDates[valueDates.length - 1]) : null;

    let amountCents: number | null = null;
    let isCredit = true;
    let balanceCents: number | null = null;
    if (columns) {
      const bal = amounts.find((a) => a.kind === 'balance');
      if (bal) balanceCents = bal.cents;
      const credit = amounts.find((a) => a.kind === 'credit');
      const debit = amounts.find((a) => a.kind === 'debit');
      const signed = amounts.find((a) => a.kind === 'amount');
      if (credit) {
        amountCents = Math.abs(credit.cents);
        isCredit = true;
      } else if (debit) {
        amountCents = Math.abs(debit.cents);
        isCredit = false;
      } else if (signed) {
        amountCents = Math.abs(signed.cents);
        isCredit = signed.cents >= 0;
      }
    } else if (amounts.length >= 2) {
      balanceCents = amounts[amounts.length - 1].cents;
    }
    const allText = [headText, ...details].join('\n');
    if (amountCents === null) {
      // Ohne Spaltenerkennung: erster Betrag = Buchung, letzter = Saldo
      const candidate = amounts[0];
      if (columns && candidate.kind === 'balance' && amounts.length === 1) return;
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
      rawText: raw.join('\n').slice(0, 2000),
      balanceCents,
    });
  };

  const start = detected ? detected.headerIndex + 1 : 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.trim();
    if (!text) continue;
    if (PAGE_NOISE.test(text) && !LINE_DATE.test(text)) continue;
    if (i < start) {
      // Kopfbereich: Jahr aus Zeitraum übernehmen, sonst nichts
      continue;
    }
    const date = lineDate(text, ctx);
    if (date) {
      flush();
      current = { date, headText: stripDatesAndAmounts(text), raw: [text], details: [], amounts: amountsOf(line, columns) };
      continue;
    }
    const amounts = amountsOf(line, columns);
    const rest = stripDatesAndAmounts(text);
    // Saldovortrag ohne Datum
    if (OPENING_BALANCE.test(rest) && amounts.length) {
      flush();
      if (openingBalance === null && transactions.length === 0) openingBalance = amounts[amounts.length - 1].cents;
      continue;
    }
    // Wiederholte Spaltenüberschrift (neue Seite): Buchung läuft weiter
    if (/^(datum|buchungsdatum|abschluss|valuta|text|buchungstext)\b/i.test(text) && (columns ? columnsOf(tokenize(line)).length > 0 : true)) continue;
    // Umsatz-/Totalzeile: Summen für die Vollständigkeitskontrolle merken
    if (/^(umsatz|total|summe|umsatztotal)\b/i.test(rest) && columns && amounts.length) {
      flush();
      totals = { credit: amounts.find((a) => a.kind === 'credit')?.cents ?? null, debit: amounts.find((a) => a.kind === 'debit')?.cents ?? null };
      continue;
    }
    if (!current) continue;
    if (SKIP_LINE.test(rest)) {
      flush();
      continue;
    }
    // Weitere Buchung am selben Tag (Datum nur einmal gedruckt)
    const moving = amounts.filter(isMoving);
    const currentMoving = current.amounts.filter(isMoving);
    // (nur wenn die Zeile wie eine Buchung beginnt – sonst ist der Betrag ein Detail, z. B. Einzelbetrag)
    const sameDay = currentMoving.length > 0 && moving.length > 0 && BOOKING_START.test(rest) && !/^sammel/i.test(current.headText);
    if (sameDay) {
      const d: Date = (current as Block).date;
      flush();
      current = { date: d, headText: rest, raw: [text], details: [], amounts };
      continue;
    }
    // Betrag auf Folgezeile (manche Layouts)
    if (currentMoving.length === 0 && amounts.length) {
      current.amounts.push(...amounts);
      if (rest) current.details.push(rest);
      current.raw.push(text);
      continue;
    }
    if (current.details.length < 8) {
      current.details.push(text);
      current.raw.push(text);
    }
  }
  flush();

  let balanceCheck = verifyByBalance(transactions, openingBalance);
  // Ohne Saldospalte: Vollständigkeit über die Umsatz-/Totalzeile prüfen
  if (!balanceCheck.checked && totals && (totals.credit !== null || totals.debit !== null)) {
    const sum = (credit: boolean) => transactions.filter((t) => t.isCredit === credit).reduce((a, t) => a + t.amountCents, 0);
    const okCredit = totals.credit === null || totals.credit === sum(true);
    const okDebit = totals.debit === null || totals.debit === sum(false);
    if (okCredit && okDebit) {
      for (const t of transactions) t.verified = true;
      balanceCheck = { verified: transactions.length, checked: transactions.length, corrected: 0 };
    } else {
      warnings.push(`Kontrolle mit der Umsatz-Zeile: Summe der erkannten ${okCredit ? 'Belastungen' : 'Gutschriften'} stimmt nicht mit dem Auszug überein – bitte Buchungen vergleichen.`);
    }
  }
  if (balanceCheck.corrected) warnings.push(`Saldo-Kontrolle: Bei ${balanceCheck.corrected} Buchung(en) wurde die Richtung (Gutschrift/Belastung) anhand des Kontosaldos korrigiert.`);
  if (balanceCheck.checked && balanceCheck.verified < balanceCheck.checked)
    warnings.push(`Saldo-Kontrolle: ${balanceCheck.checked - balanceCheck.verified} Betrag/Beträge passen nicht zum Saldo – bitte besonders prüfen.`);
  if (!transactions.length) warnings.push('Im Dokument wurden keine Buchungen erkannt.');
  void hasDirectionCols;
  if (!columns && transactions.length) warnings.push('Keine Spalten Belastung/Gutschrift erkannt – Richtung wurde anhand des Buchungstextes bestimmt.');

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
