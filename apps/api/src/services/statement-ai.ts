import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { verifyByBalance } from '../import/statement-parser.js';
import type { ParsedTransaction, ParseResult } from '../import/types.js';
import { AI_BETAS, ai, aiError, textOf } from './ai.js';

/**
 * Liest einen Kontoauszug beliebiger Banken (PDF, Scan, Foto oder Text) mit Claude aus.
 * Die KI liefert nur Rohdaten; Richtung und Betrag werden danach – wo der Auszug einen
 * Saldo enthält – rechnerisch über die Saldo-Differenz geprüft.
 */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['iban', 'currency', 'openingBalance', 'closingBalance', 'transactions'],
  properties: {
    iban: { type: ['string', 'null'], description: 'IBAN des Kontos, dessen Auszug das ist' },
    currency: { type: ['string', 'null'] },
    openingBalance: { type: ['number', 'null'], description: 'Anfangssaldo / Saldovortrag' },
    closingBalance: { type: ['number', 'null'], description: 'Schlusssaldo' },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bookingDate', 'valueDate', 'amount', 'direction', 'counterpartyName', 'counterpartyIban', 'reference', 'balanceAfter'],
        properties: {
          bookingDate: { type: 'string', description: 'Buchungsdatum JJJJ-MM-TT' },
          valueDate: { type: ['string', 'null'], description: 'Valutadatum JJJJ-MM-TT' },
          amount: { type: 'number', description: 'Betrag, immer positiv' },
          direction: { type: 'string', enum: ['credit', 'debit'], description: 'credit = Gutschrift/Eingang, debit = Belastung/Ausgang' },
          counterpartyName: { type: ['string', 'null'], description: 'Auftraggeber (bei Gutschrift) bzw. Empfänger' },
          counterpartyIban: { type: ['string', 'null'] },
          reference: { type: ['string', 'null'], description: 'Mitteilung / Zahlungszweck / Referenz, vollständig' },
          balanceAfter: { type: ['number', 'null'], description: 'Saldo nach dieser Buchung, falls im Auszug angegeben' },
        },
      },
    },
  },
} as const;

const PROMPT = `Das ist ein Schweizer Bank- oder Postkonto-Auszug (evtl. gescannt oder fotografiert, evtl. mehrere Seiten oder ein ganzes Jahr).
Lies ALLE Buchungen vollständig und in der Reihenfolge des Auszugs aus – keine auslassen, keine erfinden, keine zusammenfassen.
- Sammelbuchungen mit Einzelpositionen: jede Einzelgutschrift als eigene Buchung.
- Beträge exakt wie gedruckt (Schweizer Format 1'234.50 → 1234.5).
- Saldovortrag/Anfangs- und Schlusssaldo sind keine Buchungen.
- Datum als JJJJ-MM-TT; fehlt das Jahr, aus dem Auszugszeitraum ableiten.
- Auftraggeber-Name ohne Buchungsart ("Gutschrift", "Überweisung", "E-Banking" usw.).
- Unlesbares als null, nicht raten.`;

type AiStatement = {
  iban: string | null;
  currency: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: { bookingDate: string; valueDate: string | null; amount: number; direction: 'credit' | 'debit'; counterpartyName: string | null; counterpartyIban: string | null; reference: string | null; balanceAfter: number | null }[];
};

const cents = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100));
const date = (s: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function parseStatementWithAI(input: { data: Buffer; mimetype: string } | { text: string }): Promise<ParseResult> {
  let source: Anthropic.Beta.BetaContentBlockParam;
  if ('text' in input) source = { type: 'text', text: `Kontoauszug (Text):\n\n${input.text}` };
  else if (input.mimetype === 'application/pdf') source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.data.toString('base64') } };
  else if (['image/jpeg', 'image/png', 'image/webp'].includes(input.mimetype)) {
    source = { type: 'image', source: { type: 'base64', media_type: input.mimetype as 'image/jpeg' | 'image/png' | 'image/webp', data: input.data.toString('base64') } };
  } else throw badRequest('Dieses Dateiformat kann die KI nicht lesen.');

  let parsed: AiStatement;
  try {
    // Streaming: Jahresauszüge können sehr viele Buchungen enthalten
    const response = await ai()
      .beta.messages.stream({
        model: config.AI_MODEL,
        max_tokens: 64000,
        betas: AI_BETAS,
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT }] }],
      })
      .finalMessage();
    if (response.stop_reason === 'refusal') throw badRequest('Die KI konnte diesen Auszug nicht verarbeiten.');
    if (response.stop_reason === 'max_tokens') throw badRequest('Der Auszug ist zu umfangreich – bitte in kleinere Teile (z. B. Quartale) aufteilen.');
    parsed = JSON.parse(textOf(response)) as AiStatement;
  } catch (e) {
    aiError(e);
  }

  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  for (const t of parsed.transactions) {
    const bookingDate = date(t.bookingDate);
    const amountCents = cents(Math.abs(t.amount));
    if (!bookingDate || !amountCents) {
      warnings.push(`Buchung übersprungen (Datum/Betrag unlesbar): ${t.counterpartyName ?? ''} ${t.amount ?? ''}`.trim());
      continue;
    }
    transactions.push({
      bookingDate,
      valueDate: date(t.valueDate),
      amountCents,
      isCredit: t.direction === 'credit',
      payerName: t.counterpartyName?.trim() || null,
      payerIban: t.counterpartyIban?.replace(/\s/g, '') || null,
      reference: t.reference?.trim() || null,
      rawText: [t.bookingDate, t.direction === 'credit' ? 'Gutschrift' : 'Belastung', t.amount.toFixed(2), t.counterpartyName, t.reference].filter(Boolean).join(' · '),
      balanceCents: cents(t.balanceAfter),
    });
  }

  const opening = cents(parsed.openingBalance);
  const balanceCheck = verifyByBalance(transactions, opening);
  const closing = cents(parsed.closingBalance);
  if (opening !== null && closing !== null) {
    const sum = transactions.reduce((s, t) => s + (t.isCredit ? t.amountCents : -t.amountCents), opening);
    if (sum !== closing) warnings.push(`Kontrolle: Anfangssaldo + Buchungen ergibt ${(sum / 100).toFixed(2)}, der Auszug zeigt ${(closing / 100).toFixed(2)} – bitte Buchungen mit dem Auszug vergleichen.`);
  }
  if (!balanceCheck.checked) warnings.push('Mit KI gelesen, ohne Saldo-Kontrolle – Beträge bitte vor dem Verbuchen kontrollieren.');
  const dates = transactions.map((t) => t.bookingDate.toISOString().slice(0, 10)).sort();
  return {
    transactions,
    meta: {
      format: 'KI',
      ai: true,
      currency: parsed.currency ?? 'CHF',
      iban: parsed.iban?.replace(/\s/g, '') ?? null,
      periodFrom: dates[0] ?? null,
      periodTo: dates[dates.length - 1] ?? null,
      warnings,
      balanceCheck: balanceCheck.checked ? balanceCheck : null,
    },
  };
}
