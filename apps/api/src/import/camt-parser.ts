import { XMLParser } from 'fast-xml-parser';
import { parseMoneyToCents } from '@immo/shared';
import { parseDate } from './dates.js';
import type { ParseResult, ParsedTransaction } from './types.js';

/**
 * ISO 20022 camt.053 (Kontoauszug) und camt.054 (Gutschriftsanzeige),
 * Standard aller Schweizer Banken (inkl. QR-Referenz).
 * Sammelbuchungen werden in einzelne Zahlungen (TxDtls) aufgelöst.
 */
type Node = Record<string, unknown>;
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Node)[k] : undefined), o);
const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return text((v as Node)['#text']);
  return String(v).trim() || null;
};
const amount = (v: unknown): number | null => {
  const t = text(v);
  return t === null ? null : parseMoneyToCents(t);
};

function partyName(tx: unknown, role: 'Dbtr' | 'Cdtr'): string | null {
  return text(get(tx, `RltdPties.${role}.Nm`)) ?? text(get(tx, `RltdPties.${role}.Pty.Nm`)) ?? text(get(tx, `RltdPties.Ultmt${role}.Nm`)) ?? text(get(tx, `RltdPties.Ultmt${role}.Pty.Nm`));
}

export function isCamt(buf: Buffer): boolean {
  const head = buf.subarray(0, 600).toString('utf8');
  return /camt\.05[234]/.test(head) || (/<Document/.test(head) && /BkToCstmr/.test(buf.subarray(0, 4000).toString('utf8')));
}

export function parseCamtBuffer(buf: Buffer): ParseResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, processEntities: true });
  const doc = parser.parse(buf.toString('utf8')) as Node;
  const root = (get(doc, 'Document') ?? doc) as Node;
  const container = (root.BkToCstmrStmt ?? root.BkToCstmrDbtCdtNtfctn ?? root.BkToCstmrAcctRpt) as Node | undefined;
  if (!container) return { transactions: [], meta: { format: 'camt', warnings: ['Keine camt.053/054-Struktur gefunden.'] } };
  const statements = arr((container.Stmt ?? container.Ntfctn ?? container.Rpt) as Node | Node[]);
  const txs: ParsedTransaction[] = [];
  let iban: string | null = null;
  const warnings: string[] = [];

  for (const st of statements) {
    iban ??= text(get(st, 'Acct.Id.IBAN'));
    for (const ntry of arr(st.Ntry as Node | Node[])) {
      if (text(ntry.RvslInd) === 'true') continue;
      const isCredit = text(ntry.CdtDbtInd) === 'CRDT';
      const bookingDate = parseDate(text(get(ntry, 'BookgDt.Dt')) ?? text(get(ntry, 'BookgDt.DtTm'))?.slice(0, 10) ?? '');
      const valueDate = parseDate(text(get(ntry, 'ValDt.Dt')) ?? '');
      if (!bookingDate) continue;
      const entryText = text(ntry.AddtlNtryInf);
      const details = arr(ntry.NtryDtls as Node | Node[]).flatMap((d) => arr(d.TxDtls as Node | Node[]));
      const parts = details.length ? details : [null];
      for (const tx of parts) {
        const cents = tx ? (amount(get(tx, 'AmtDtls.TxAmt.Amt')) ?? amount(tx.Amt)) : null;
        const amountCents = Math.abs(cents ?? amount(ntry.Amt) ?? 0);
        if (!amountCents) continue;
        const role = isCredit ? 'Dbtr' : 'Cdtr';
        const payerName = tx ? partyName(tx, role) : null;
        const payerIban = tx ? text(get(tx, `RltdPties.${role}Acct.Id.IBAN`)) : null;
        const refs = tx
          ? [
              ...arr(get(tx, 'RmtInf.Ustrd') as unknown).map(text),
              ...arr(get(tx, 'RmtInf.Strd') as Node | Node[]).flatMap((s) => [text(get(s, 'CdtrRefInf.Ref')), ...arr(get(s, 'AddtlRmtInf') as unknown).map(text)]),
              text(tx.AddtlTxInf),
            ].filter(Boolean)
          : [];
        const reference = refs.length ? [...new Set(refs)].join(' · ') : entryText;
        txs.push({
          bookingDate,
          valueDate,
          amountCents,
          isCredit,
          payerName,
          payerIban: payerIban ? payerIban.replace(/\s/g, '') : null,
          reference,
          rawText: [entryText, payerName, payerIban, reference, tx ? text(get(tx, 'Refs.AcctSvcrRef')) : null].filter(Boolean).join('\n'),
        });
      }
    }
  }
  if (!txs.length) warnings.push('Die camt-Datei enthält keine Buchungen.');
  return { transactions: txs, meta: { format: 'camt', iban, warnings } };
}
