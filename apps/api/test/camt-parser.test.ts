import { describe, expect, it } from 'vitest';
import { isCamt, parseCamtBuffer } from '../src/import/camt-parser.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
 <BkToCstmrStmt>
  <Stmt>
   <Acct><Id><IBAN>CH1200230230123456789</IBAN></Id></Acct>
   <Ntry>
    <Amt Ccy="CHF">3700.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>2026-09-03</Dt></BookgDt><ValDt><Dt>2026-09-03</Dt></ValDt>
    <AddtlNtryInf>Sammelgutschrift QR-Rechnungen</AddtlNtryInf>
    <NtryDtls>
     <TxDtls>
      <AmtDtls><TxAmt><Amt Ccy="CHF">1850.00</Amt></TxAmt></AmtDtls>
      <RltdPties><Dbtr><Nm>Peter Müller</Nm></Dbtr><DbtrAcct><Id><IBAN>CH93 0076 2011 6238 5295 7</IBAN></Id></DbtrAcct></RltdPties>
      <RmtInf><Strd><CdtrRefInf><Ref>210000000003139471430009017</Ref></CdtrRefInf></Strd><Ustrd>Mietzins September</Ustrd></RmtInf>
     </TxDtls>
     <TxDtls>
      <AmtDtls><TxAmt><Amt Ccy="CHF">1850.00</Amt></TxAmt></AmtDtls>
      <RltdPties><Dbtr><Pty><Nm>Anna Keller</Nm></Pty></Dbtr></RltdPties>
      <RmtInf><Ustrd>Miete 09/2026</Ustrd></RmtInf>
     </TxDtls>
    </NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="CHF">420.50</Amt><CdtDbtInd>DBIT</CdtDbtInd>
    <BookgDt><Dt>2026-09-04</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>EWZ</Nm></Cdtr></RltdPties></TxDtls></NtryDtls>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

describe('camt.053', () => {
  it('löst Sammelbuchungen auf und liest Zahler, IBAN und QR-Referenz', () => {
    const buf = Buffer.from(xml);
    expect(isCamt(buf)).toBe(true);
    const r = parseCamtBuffer(buf);
    expect(r.meta.iban).toBe('CH1200230230123456789');
    expect(r.transactions).toHaveLength(3);
    const [a, b, c] = r.transactions;
    expect(a).toMatchObject({ amountCents: 185000, isCredit: true, payerName: 'Peter Müller', payerIban: 'CH9300762011623852957' });
    expect(a.reference).toContain('210000000003139471430009017');
    expect(a.reference).toContain('Mietzins September');
    expect(b.payerName).toBe('Anna Keller');
    expect(c).toMatchObject({ isCredit: false, amountCents: 42050, payerName: 'EWZ' });
  });
});
