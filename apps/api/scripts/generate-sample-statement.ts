/**
 * Erzeugt einen realistischen Beispiel-Kontoauszug (PDF + CSV) für September 2026,
 * passend zu den Demo-Daten. Ausgabe: samples/
 */
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { formatMoneyPlain } from '@immo/shared';

const out = path.resolve(import.meta.dirname, '../../../samples');
mkdirSync(out, { recursive: true });

interface Tx { date: string; text: string[]; debit?: number; credit?: number }
const txs: Tx[] = [
  { date: '01.09.2026', text: ['Gutschrift', 'Sandra Meier', 'Mitteilung: Miete September 2026'], credit: 163000 },
  { date: '02.09.2026', text: ['Gutschrift', 'M. Arnold', 'Seestrasse 12, 8002 Zürich', 'Mitteilung: Miete'], credit: 150000 },
  { date: '03.09.2026', text: ['Gutschrift', 'Peter Müller', 'Seestrasse 12, 8002 Zürich', 'Mitteilung: Mietzins September Wohnung 3A'], credit: 185000 },
  { date: '03.09.2026', text: ['Gutschrift', 'Schneider L.', 'Mitteilung: Miete Sept'], credit: 181000 },
  { date: '04.09.2026', text: ['Zahlung an', 'EWZ Elektrizitätswerk Zürich', 'Rechnung 2026-08-4471'], debit: 42050 },
  { date: '04.09.2026', text: ['Gutschrift', 'Weber Julia', 'IBAN CH44 3199 9123 0008 8901 2', 'Mitteilung: Wohnung A2'], credit: 211000 },
  { date: '05.09.2026', text: ['Gutschrift', 'Bäckerei Sonnenschein GmbH', 'Mitteilung: Mietzins Laden Sept. 2026'], credit: 425000 },
  { date: '08.09.2026', text: ['Gutschrift', 'Daniel Frei', 'Mitteilung: Miete September'], credit: 195000 },
  { date: '10.09.2026', text: ['Gutschrift', 'Monika Keller', 'Mitteilung: Restbetrag August + September'], credit: 282000 },
  { date: '12.09.2026', text: ['Gutschrift', 'Hans Beispiel', 'Mitteilung: Anzahlung Parkplatz'], credit: 50000 },
  { date: '15.09.2026', text: ['Belastung', 'Gebäudeversicherung Kanton Zürich', 'Police 88-1120'], debit: 68400 },
];

let saldo = 1240000;
const rows = txs.map((t) => {
  saldo += (t.credit ?? 0) - (t.debit ?? 0);
  return { ...t, saldo };
});

// ───── PDF ─────
const doc = new PDFDocument({ size: 'A4', margin: 40 });
const pdfStream = createWriteStream(path.join(out, 'kontoauszug-2026-09.pdf'));
doc.pipe(pdfStream);
doc.font('Helvetica-Bold').fontSize(16).text('Zürcher Beispielbank AG', 40, 40);
doc.font('Helvetica').fontSize(9).fillColor('#555').text('Bahnhofplatz 1, 8001 Zürich', 40, 60);
doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text('Kontoauszug September 2026', 40, 95);
doc.font('Helvetica').fontSize(9).text('Kontoinhaber: Huber Immobilien AG', 40, 115).text('IBAN CH12 0023 0230 1234 5678 9', 40, 128).text('Periode: 01.09.2026 – 30.09.2026', 40, 141);

const col = { date: 40, text: 105, debit: 330, credit: 400, valuta: 465, saldo: 520 };
let y = 175;
doc.font('Helvetica-Bold').fontSize(8.5);
doc.text('Datum', col.date, y).text('Buchungstext', col.text, y).text('Belastung', col.debit, y, { width: 60, align: 'right' }).text('Gutschrift', col.credit, y, { width: 60, align: 'right' }).text('Valuta', col.valuta, y).text('Saldo', col.saldo, y, { width: 50, align: 'right' });
y += 14;
doc.moveTo(40, y - 3).lineTo(570, y - 3).strokeColor('#999').stroke();
doc.font('Helvetica').fontSize(8.5);
doc.text('01.09.2026', col.date, y).text('Saldovortrag', col.text, y).text(formatMoneyPlain(1240000), col.saldo - 20, y, { width: 70, align: 'right' });
y += 16;
for (const r of rows) {
  doc.font('Helvetica').text(r.date, col.date, y);
  r.text.forEach((line, i) => doc.text(line, col.text, y + i * 11, { width: 220 }));
  if (r.debit) doc.text(formatMoneyPlain(r.debit), col.debit, y, { width: 60, align: 'right' });
  if (r.credit) doc.text(formatMoneyPlain(r.credit), col.credit, y, { width: 60, align: 'right' });
  doc.text(r.date, col.valuta, y).text(formatMoneyPlain(r.saldo), col.saldo - 20, y, { width: 70, align: 'right' });
  y += r.text.length * 11 + 7;
}
doc.moveTo(40, y).lineTo(570, y).stroke();
doc.font('Helvetica-Bold').text('Schlusssaldo', col.text, y + 6).text(formatMoneyPlain(saldo), col.saldo - 20, y + 6, { width: 70, align: 'right' });
doc.end();
await once(pdfStream, 'finish');

// ───── Gescannter Ausdruck (Bild-PDF, leicht schräg) und Foto (JPG) ─────
try {
  const tmp = path.join(out, '.scan-tmp');
  mkdirSync(tmp, { recursive: true });
  execFileSync('pdftoppm', ['-r', '200', '-gray', '-png', '-singlefile', path.join(out, 'kontoauszug-2026-09.pdf'), path.join(tmp, 'page')]);
  const scan = new PDFDocument({ size: 'A4', margin: 0 });
  const scanStream = createWriteStream(path.join(out, 'kontoauszug-2026-09-scan.pdf'));
  scan.pipe(scanStream);
  scan.rect(0, 0, 595, 842).fill('#f4f4f1');
  scan.save().rotate(0.7, { origin: [297, 421] }).image(readFileSync(path.join(tmp, 'page.png')), 6, 4, { width: 583 }).restore();
  scan.end();
  await once(scanStream, 'finish');
  execFileSync('pdftoppm', ['-r', '150', '-jpeg', '-singlefile', path.join(out, 'kontoauszug-2026-09-scan.pdf'), path.join(out, 'kontoauszug-2026-09-foto')]);
  rmSync(tmp, { recursive: true, force: true });
} catch {
  console.log('Hinweis: pdftoppm (poppler-utils) nicht installiert – Scan-Beispiele übersprungen.');
}
void existsSync;

// ───── CSV (typischer Bank-Export) ─────
const csv = [
  'Buchungsdatum;Valuta;Buchungstext;Auftraggeber;Mitteilung;Belastung;Gutschrift',
  ...rows.map((r) => [r.date, r.date, r.text[0], r.text[1], r.text.slice(2).join(' ').replace('Mitteilung: ', ''), r.debit ? (r.debit / 100).toFixed(2) : '', r.credit ? (r.credit / 100).toFixed(2) : ''].join(';')),
].join('\n');
writeFileSync(path.join(out, 'kontoauszug-2026-09.csv'), csv);
// ───── camt.053 (ISO 20022) ─────
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const iso = (d: string) => d.split('.').reverse().join('-');
const entries = rows
  .map((r) => {
    const credit = !!r.credit;
    const amount = ((r.credit ?? r.debit)! / 100).toFixed(2);
    const party = credit ? `<Dbtr><Nm>${esc(r.text[1])}</Nm></Dbtr>` : `<Cdtr><Nm>${esc(r.text[1])}</Nm></Cdtr>`;
    const iban = r.text.find((t) => t.startsWith('IBAN'))?.replace('IBAN ', '').replace(/\s/g, '');
    const msg = r.text.slice(2).filter((t) => !t.startsWith('IBAN') && !/\d{4} [A-Z]/.test(t)).join(' ').replace('Mitteilung: ', '');
    return `   <Ntry>
    <Amt Ccy="CHF">${amount}</Amt><CdtDbtInd>${credit ? 'CRDT' : 'DBIT'}</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>${iso(r.date)}</Dt></BookgDt><ValDt><Dt>${iso(r.date)}</Dt></ValDt>
    <NtryDtls><TxDtls>
     <RltdPties>${party}${iban && credit ? `<DbtrAcct><Id><IBAN>${iban}</IBAN></Id></DbtrAcct>` : ''}</RltdPties>
     ${msg ? `<RmtInf><Ustrd>${esc(msg)}</Ustrd></RmtInf>` : ''}
    </TxDtls></NtryDtls>
   </Ntry>`;
  })
  .join('\n');
writeFileSync(
  path.join(out, 'kontoauszug-2026-09.camt053.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>SAMPLE-2026-09</MsgId><CreDtTm>2026-09-30T18:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>STMT-2026-09</Id>
   <Acct><Id><IBAN>CH1200230230123456789</IBAN></Id><Ccy>CHF</Ccy></Acct>
${entries}
  </Stmt>
 </BkToCstmrStmt>
</Document>
`,
);
console.log(`Beispieldateien erstellt in ${out}`);
