import { describe, expect, it } from 'vitest';
import { parseStatementLines, textToLines } from '../src/import/statement-parser.js';
import { parseCsvBuffer } from '../src/import/table-parser.js';

const statement = `
Kontoauszug  IBAN CH12 0023 0230 1234 5678 9
Datum        Buchungstext                          Belastung      Gutschrift      Valuta        Saldo
01.09.2026   Saldovortrag                                                                        12'400.00
03.09.2026   Gutschrift                                             1'850.00      03.09.2026    14'250.00
             Peter Müller
             Seestrasse 12, 8000 Zürich
             Mitteilung: Mietzins September Wohnung 3A
04.09.2026   Zahlung an                            420.50                         04.09.2026    13'829.50
             EWZ Elektrizitätswerk
05.09.2026   Gutschrift von M. Arnold                               1'500.00      05.09.2026    15'329.50
             IBAN CH56 0483 5012 3456 7800 9
`;

describe('parseStatementLines', () => {
  it('erkennt Gutschriften, Belastungen, Zahler und Mitteilungen', () => {
    const r = parseStatementLines(textToLines(statement));
    expect(r.transactions).toHaveLength(3);
    const [a, b, c] = r.transactions;
    expect(a.amountCents).toBe(185000);
    expect(a.isCredit).toBe(true);
    expect(a.payerName).toBe('Peter Müller');
    expect(a.reference).toContain('Mietzins September');
    expect(b.isCredit).toBe(false);
    expect(b.amountCents).toBe(42050);
    expect(c.payerName).toBe('M. Arnold');
    expect(c.payerIban).toBe('CH5604835012345678009');
  });
});

describe('parseCsvBuffer', () => {
  it('liest Bank-CSV mit Semikolon', () => {
    const csv = 'Buchungsdatum;Buchungstext;Belastung;Gutschrift;Valuta\n03.09.2026;Gutschrift von Peter Müller Mietzins September;;1850.00;03.09.2026\n04.09.2026;Zahlung an EWZ;420.50;;04.09.2026\n';
    const r = parseCsvBuffer(Buffer.from(csv));
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].payerName).toBe('Peter Müller Mietzins September');
    expect(r.transactions[0].isCredit).toBe(true);
    expect(r.transactions[1].isCredit).toBe(false);
  });
});
