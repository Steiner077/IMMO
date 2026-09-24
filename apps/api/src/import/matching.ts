import { MONTH_NAMES_DE, addMonths, normalizeIban, normalizeText, toPeriod, tokens } from '@immo/shared';
import { allocate, type AllocationLine, type OpenCharge } from './allocation.js';

/**
 * Matching-Engine für eingehende Zahlungen.
 *
 * Ablauf: Zahler erkennen → Mieter suchen → Betrag vergleichen →
 * offene Monate prüfen → Monat bestimmen → Vertrag vergleichen →
 * Aufteilung vorschlagen → Sicherheit berechnen.
 *
 * Die Engine ist eine reine Funktion ohne Datenbankzugriff und
 * dadurch vollständig testbar. Sie verbucht niemals selbst.
 */

export interface MatchTransaction {
  bookingDate: Date;
  amountCents: number;
  payerName?: string | null;
  payerIban?: string | null;
  reference?: string | null;
  rawText?: string | null;
}

export interface MatchCandidate {
  tenantId: string;
  leaseId: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  iban?: string | null;
  unitLabel: string;
  propertyName: string;
  paymentReference?: string | null;
  monthlyCents: number;
  openCharges: OpenCharge[];
  /** Erster Monat mit Sollstellung (Abrechnungsbeginn im System) */
  chargesStart?: string;
  aliases: { normalizedName: string; iban?: string | null; timesConfirmed: number }[];
  /** Kombination mehrerer Verträge desselben Mieters (z. B. Wohnung + Parkplatz) */
  combined?: string;
}

export interface MatchResult {
  tenantId: string | null;
  leaseId: string | null;
  confidence: number;
  period: string | null;
  allocation: AllocationLine[];
  remainderCents: number;
  reasons: string[];
  status: 'READY' | 'NEEDS_REVIEW' | 'UNMATCHED';
  alternatives: { tenantId: string; leaseId: string; score: number }[];
}

export interface MatchOptions {
  readyThreshold?: number;
  reviewThreshold?: number;
}

const MONTHS: Record<string, number> = {};
MONTH_NAMES_DE.forEach((m, i) => {
  MONTHS[normalizeText(m)] = i + 1;
  MONTHS[normalizeText(m).slice(0, 3)] = i + 1;
});
Object.assign(MONTHS, {
  maerz: 3, mrz: 3, sept: 9, okt: 10, dez: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, october: 10, december: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
});

export const BEFORE_START = 'Zahlung liegt vor dem Abrechnungsbeginn des Vertrags';

/** Erkennt Monatsangaben in der Zahlungsmitteilung. */
export function detectPeriods(text: string, bookingDate: Date): string[] {
  const out: string[] = [];
  const norm = normalizeText(text);
  const bookingYear = bookingDate.getUTCFullYear();
  const bookingMonth = bookingDate.getUTCMonth() + 1;

  const inferYear = (month: number) => {
    // Zahlung im Dezember für Januar → Folgejahr; Zahlung im Januar für Dezember → Vorjahr
    if (month - bookingMonth > 6) return bookingYear - 1;
    if (bookingMonth - month > 6) return bookingYear + 1;
    return bookingYear;
  };

  // 2026-09 · 09/2026 · 09.2026 · 9/26
  const numeric = /\b(?:(20\d{2})[-/.](0?[1-9]|1[0-2])|(0?[1-9]|1[0-2])[/.](20\d{2}|\d{2}))\b/g;
  let m: RegExpExecArray | null;
  const raw = text.replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' '); // volle Daten ignorieren
  while ((m = numeric.exec(raw))) {
    const y = m[1] ? +m[1] : +m[4] < 100 ? 2000 + +m[4] : +m[4];
    const mo = m[2] ? +m[2] : +m[3];
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
  }
  const words = norm.split(' ');
  for (let i = 0; i < words.length; i++) {
    const mo = MONTHS[words[i]];
    if (!mo) continue;
    const next = words[i + 1];
    const prev = words[i - 1] ?? '';
    // Kurzformen (z. B. "Jan") nur mit Kontext werten – "Jan" kann auch ein Vorname sein
    const isShort = words[i].length <= 4 && !['mai', 'juni', 'juli'].includes(words[i]);
    const hasContext = (next && /^(20)?\d{2}$/.test(next)) || /miete|mietzins|monat|nk|nebenkosten|akonto|fuer|per/.test(prev);
    if (isShort && !hasContext) continue;
    const year = next && /^20\d{2}$/.test(next) ? +next : next && /^\d{2}$/.test(next) ? 2000 + +next : inferYear(mo);
    out.push(`${year}-${String(mo).padStart(2, '0')}`);
  }
  return [...new Set(out)];
}

/** Tippfehler-Abstand (Damerau-Levenshtein, begrenzt) */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Kommt das Wort (fast) im Text vor? Erlaubt 1 Tippfehler ab 4, 2 ab 8 Buchstaben ("Valtko" ≈ "Vlatko", "Sylvan" ≈ "Sylvain") */
function fuzzyIn(words: string[], w: string): boolean {
  const max = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
  return max > 0 && words.some((x) => x[0] === w[0] && editDistance(x, w, max) <= max);
}

function nameScore(c: MatchCandidate, payerNorm: string, textNorm: string): { score: number; reason?: string } {
  const hay = ` ${payerNorm} ${textNorm} `;
  const words = hay.trim().split(/\s+/);
  const first = normalizeText(c.firstName);
  const last = normalizeText(c.lastName);
  const company = normalizeText(c.companyName);
  if (company && company.length >= 3 && hay.includes(` ${company} `)) return { score: 60, reason: `Firmenname "${c.companyName}" erkannt` };
  if (!last) return { score: 0 };
  const lastParts = last.split(' ');
  const firstParts = first ? first.split(' ') : [];
  const hasLast = lastParts.every((p) => hay.includes(` ${p} `));
  if (!hasLast) {
    // Nachname mit Tippfehler, Vorname exakt
    const lastFuzzy = lastParts.every((p) => hay.includes(` ${p} `) || fuzzyIn(words, p));
    if (lastFuzzy && firstParts.some((f) => f.length > 1 && hay.includes(` ${f} `)))
      return { score: 50, reason: `Name ähnlich "${c.firstName} ${c.lastName}" (Schreibweise weicht ab)` };
    return { score: 0 };
  }
  if (firstParts.length && firstParts.some((f) => f.length > 1 && hay.includes(` ${f} `)))
    return { score: 60, reason: `Vor- und Nachname "${c.firstName} ${c.lastName}" erkannt` };
  if (firstParts.length && firstParts.some((f) => new RegExp(` ${f[0]} (?:${lastParts.join(' ')}) `).test(hay) || new RegExp(` (?:${lastParts.join(' ')}) ${f[0]} `).test(hay)))
    return { score: 48, reason: `Nachname mit Initiale erkannt (${c.firstName?.[0]}. ${c.lastName})` };
  if (firstParts.some((f) => fuzzyIn(words, f)))
    return { score: 55, reason: `Name ähnlich "${c.firstName} ${c.lastName}" (Vorname weicht ab)` };
  return { score: 33, reason: `Nachname "${c.lastName}" erkannt` };
}

export function matchTransaction(tx: MatchTransaction, candidates: MatchCandidate[], opts: MatchOptions = {}): MatchResult {
  const ready = opts.readyThreshold ?? 90;
  const review = opts.reviewThreshold ?? 50;
  const payerNorm = normalizeText(tx.payerName);
  const textNorm = normalizeText(`${tx.reference ?? ''} ${tx.rawText ?? ''}`);
  const payerIban = normalizeIban(tx.payerIban);
  const digits = `${tx.reference ?? ''} ${tx.rawText ?? ''}`.replace(/\s/g, '');
  const namedPeriods = detectPeriods(`${tx.reference ?? ''} ${tx.rawText ?? ''}`, tx.bookingDate);

  type Scored = { c: MatchCandidate; score: number; identity: number; reasons: string[]; period: string | null; amountOk: boolean; open: MatchCandidate['openCharges'] };
  const scored: Scored[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    let identity = 0;

    // 1. Eindeutige Zahlungsreferenz (QR-Referenz / Vertragsreferenz)
    if (c.paymentReference && c.paymentReference.replace(/\s/g, '').length >= 6 && digits.includes(c.paymentReference.replace(/\s/g, ''))) {
      identity = Math.max(identity, 72);
      reasons.push('Zahlungsreferenz des Mietvertrags gefunden');
    }
    // 2. IBAN
    if (payerIban) {
      if (c.iban && normalizeIban(c.iban) === payerIban) {
        identity = Math.max(identity, 70);
        reasons.push('IBAN des Mieters stimmt überein');
      } else if (c.aliases.some((a) => a.iban && normalizeIban(a.iban) === payerIban)) {
        identity = Math.max(identity, 68);
        reasons.push('IBAN aus früheren Zuordnungen bekannt');
      }
    }
    // 3. Gelernte Zuordnung (Lernlogik)
    if (payerNorm) {
      const sortedPayer = payerNorm.split(' ').sort().join(' ');
      const alias = c.aliases.find((a) => a.normalizedName === payerNorm || a.normalizedName.split(' ').sort().join(' ') === sortedPayer);
      if (alias) {
        identity = Math.max(identity, 66 + Math.min(alias.timesConfirmed, 4));
        reasons.push(`Gelernte Zuordnung "${tx.payerName}" (${alias.timesConfirmed}× bestätigt)`);
      }
    }
    // 4. Namensvergleich
    const ns = nameScore(c, payerNorm, textNorm);
    if (ns.score) {
      if (ns.score > identity) identity = ns.score;
      if (ns.reason) reasons.push(ns.reason);
    }
    if (identity === 0) continue;

    let score = identity;

    // 5. Wohnung in der Mitteilung erwähnt
    const unit = normalizeText(c.unitLabel);
    if (unit && (tokens(textNorm).includes(unit) || textNorm.includes(`wohnung ${unit}`) || textNorm.includes(`whg ${unit}`))) {
      score += 4;
      reasons.push(`Wohnung ${c.unitLabel} in der Mitteilung`);
    }

    // 6. Betrag vergleichen und Monat bestimmen
    // Nur Monate bis max. einen Monat nach Buchungsdatum (Vorauszahlung) – ausser ausdrücklich genannt.
    // Wichtig für Jahresauszüge: eine Januar-Zahlung darf nicht die September-Miete tilgen.
    const allOpen = c.openCharges.filter((o) => o.outstandingCents > 0).sort((a, b) => a.period.localeCompare(b.period));
    const latestAllowed = addMonths(toPeriod(tx.bookingDate), 1);
    const open = allOpen.filter((o) => o.period <= latestAllowed || namedPeriods.includes(o.period));
    const firstCharge = c.chargesStart;
    const beforeStart = !!firstCharge && firstCharge > toPeriod(tx.bookingDate) && !open.length;
    let period: string | null = null;
    const named = namedPeriods.find((p) => open.some((o) => o.period === p));
    if (named) {
      period = named;
      score += 5;
      reasons.push(`Monat aus Mitteilung erkannt`);
    } else if (open.length) {
      period = open[0].period;
    } else if (beforeStart) {
      period = toPeriod(tx.bookingDate);
      reasons.push(`${BEFORE_START} (erste Sollstellung ${firstCharge})`);
    } else {
      // Keine offenen Monate: Vorauszahlung für den Folgemonat
      const bookingPeriod = toPeriod(tx.bookingDate);
      period = tx.bookingDate.getUTCDate() >= 20 ? addMonths(bookingPeriod, 1) : bookingPeriod;
      reasons.push('Keine offenen Monate – mögliche Vorauszahlung/Guthaben');
    }

    let amountOk = false;
    const target = open.find((o) => o.period === period);
    if (target && tx.amountCents === target.outstandingCents) {
      score += 28;
      amountOk = true;
      reasons.push('Betrag entspricht exakt dem offenen Sollbetrag');
    } else if (tx.amountCents === c.monthlyCents) {
      score += c.combined ? 27 : 26;
      amountOk = true;
      reasons.push(c.combined ? `Betrag entspricht der Monatsmiete aller Verträge (${c.combined})` : 'Betrag entspricht der vertraglichen Monatsmiete');
    } else {
      // mehrere Monate auf einmal?
      let sum = 0;
      let months = 0;
      for (const o of open) {
        sum += o.outstandingCents;
        months++;
        if (sum === tx.amountCents && months > 1) {
          score += 22;
          amountOk = true;
          reasons.push(`Betrag entspricht ${months} offenen Monaten`);
          break;
        }
        if (sum > tx.amountCents) break;
      }
      if (!amountOk && c.monthlyCents > 0) {
        const diff = Math.abs(tx.amountCents - c.monthlyCents) / c.monthlyCents;
        if (diff <= 0.02) {
          score += 12;
          reasons.push('Betrag weicht leicht von der Monatsmiete ab (≤ 2 %)');
        } else if (tx.amountCents < c.monthlyCents) {
          reasons.push('Betrag kleiner als Monatsmiete – Teilzahlung');
        } else {
          reasons.push('Betrag höher als Monatsmiete – Überzahlung möglich');
        }
      }
    }
    scored.push({ c, score, identity, reasons, period, amountOk, open });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) {
    return {
      tenantId: null,
      leaseId: null,
      confidence: 0,
      period: null,
      allocation: [],
      remainderCents: tx.amountCents,
      reasons: ['Kein Mieter anhand von Name, IBAN oder Referenz erkannt'],
      status: 'UNMATCHED',
      alternatives: [],
    };
  }

  let confidence = Math.min(99, best.score);
  const reasons = [...best.reasons];
  const second = scored[1];
  if (second && second.c.tenantId !== best.c.tenantId && best.score - second.score < 12) {
    confidence = Math.max(0, confidence - 20);
    reasons.push('Mehrdeutig: weitere Mieter kommen in Frage');
  }

  const { lines, remainderCents } = allocate(tx.amountCents, best.open, best.period);
  let status: MatchResult['status'] = confidence >= ready && best.amountOk ? 'READY' : confidence >= review ? 'NEEDS_REVIEW' : 'UNMATCHED';
  if (status === 'READY' && remainderCents > 0) status = 'NEEDS_REVIEW';

  return {
    tenantId: best.c.tenantId,
    leaseId: best.c.leaseId,
    confidence,
    period: best.period,
    allocation: lines,
    remainderCents,
    reasons,
    status,
    alternatives: scored.slice(1, 4).map((s) => ({ tenantId: s.c.tenantId, leaseId: s.c.leaseId, score: Math.min(99, s.score) })),
  };
}

/** Die Allokationszeilen dürfen Sollstellungen mehrerer Verträge desselben Mieters betreffen. */
export type { AllocationLine } from './allocation.js';
