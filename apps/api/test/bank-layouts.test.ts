import { describe, expect, it } from 'vitest';
import { parseStatementLines, textToLines } from '../src/import/statement-parser.js';
import type { TextLine } from '../src/import/types.js';

/** Wie pdf.js: mehrere Wörter/Zahlen landen oft in EINEM Textelement */
function pdfLines(rows: [number, string][][]): TextLine[] {
  return rows.map((items, i) => ({
    page: 1,
    y: i * 12,
    text: items.map(([, s]) => s).join('  '),
    items: items.map(([x, s]) => ({ str: s, x, width: s.length * 5 })),
  }));
}

const credits = (r: ReturnType<typeof parseStatementLines>) => r.transactions.filter((t) => t.isCredit).map((t) => [t.bookingDate.toISOString().slice(0, 10), t.amountCents, t.payerName]);

describe('Bank-Layouts', () => {
  it('PostFinance: Tausender mit Leerzeichen, Gutschrift vor Lastschrift', () => {
    const text = `
Kontoauszug 01.09.2026 - 30.09.2026        IBAN CH12 0900 0000 1234 5678 9
Datum       Text                                   Gutschrift     Lastschrift    Valuta        Saldo
01.09.26    Saldovortrag                                                                        12 400.00
03.09.26    GUTSCHRIFT AUFTRAGGEBER: Peter Müller   1 850.00                      03.09.26      14 250.00
            MITTEILUNGEN: Miete September 3A
04.09.26    LASTSCHRIFT EWZ                                        420.50         04.09.26      13 829.50
`;
    const r = parseStatementLines(textToLines(text));
    expect(credits(r)).toEqual([['2026-09-03', 185000, 'Peter Müller']]);
    expect(r.transactions[1]).toMatchObject({ isCredit: false, amountCents: 42050, verified: true });
    expect(r.meta.balanceCheck).toMatchObject({ verified: 2, checked: 2 });
  });

  it('UBS: Datum ohne Jahr, Jahr aus dem Auszugszeitraum', () => {
    const text = `
UBS Switzerland AG   Kontoauszug   Periode 01.12.2026 bis 31.01.2027
Abschluss   Buchungstext                        Belastung       Gutschrift     Valuta     Saldo
01.12.      Saldovortrag                                                                  5'000.00
28.12.      Gutschrift Mario Arnold                              1'500.00       28.12.     6'500.00
            Miete Januar
03.01.      Gutschrift Anna Keller                               2'100.00       03.01.     8'600.00
`;
    const r = parseStatementLines(textToLines(text));
    expect(credits(r)).toEqual([
      ['2026-12-28', 150000, 'Mario Arnold'],
      ['2027-01-03', 210000, 'Anna Keller'],
    ]);
  });

  it('Raiffeisen: mehrere Buchungen am selben Tag, Datum nur einmal', () => {
    const text = `
Datum        Text                                   Belastungen     Gutschriften    Valuta        Saldo CHF
02.10.2026   Saldovortrag                                                                         1'000.00
02.10.2026   Gutschrift Peter Müller                                1'850.00        02.10.2026    2'850.00
             Gutschrift Mario Arnold                                1'500.00        02.10.2026    4'350.00
             Zahlung an Swisscom                    80.00                           02.10.2026    4'270.00
`;
    const r = parseStatementLines(textToLines(text));
    expect(credits(r)).toEqual([
      ['2026-10-02', 185000, 'Peter Müller'],
      ['2026-10-02', 150000, 'Mario Arnold'],
    ]);
    expect(r.transactions).toHaveLength(3);
    expect(r.meta.balanceCheck).toMatchObject({ verified: 3, checked: 3 });
  });

  it('ZKB: eine Betragsspalte mit Vorzeichen, nachgestelltes Minus', () => {
    const text = `
Datum        Buchungstext                                 Betrag CHF      Valuta        Saldo CHF
01.11.2026   Saldo                                                                      2'000.00
02.11.2026   Gutschrift Anna Keller                         2'100.00      02.11.2026    4'100.00
05.11.2026   Dauerauftrag Hauswartung                         350.00-     05.11.2026    3'750.00
`;
    const r = parseStatementLines(textToLines(text));
    expect(credits(r)).toEqual([['2026-11-02', 210000, 'Anna Keller']]);
    expect(r.transactions[1]).toMatchObject({ isCredit: false, amountCents: 35000 });
  });

  it('Datum ausgeschrieben und ISO-Datum', () => {
    const text = `
Datum          Text                                   Belastung     Gutschrift     Saldo
3. Sep. 2026   Gutschrift von Peter Müller                          1'850.00       3'850.00
2026-09-04     Gutschrift von Mario Arnold                          1'500.00       5'350.00
`;
    const r = parseStatementLines(textToLines(text));
    expect(credits(r)).toEqual([
      ['2026-09-03', 185000, 'Peter Müller'],
      ['2026-09-04', 150000, 'Mario Arnold'],
    ]);
  });

  it('pdf.js fasst Beträge und Daten in einem Textelement zusammen', () => {
    const lines = pdfLines([
      [[40, 'Datum'], [120, 'Text'], [330, 'Belastung'], [420, 'Gutschrift'], [500, 'Valuta'], [580, 'Saldo']],
      [[40, '01.09.2026'], [120, 'Saldovortrag'], [580, "12'400.00"]],
      [[40, '03.09.2026 Gutschrift'], [120, 'Peter Müller'], [420, "1'850.00 03.09.2026"], [580, "14'250.00"]],
      [[120, 'Mitteilung: Miete September']],
      [[40, '04.09.2026'], [120, 'Zahlung an EWZ'], [330, "420.50"], [500, '04.09.2026'], [580, "13'829.50"]],
    ]);
    const r = parseStatementLines(lines);
    expect(credits(r)).toEqual([['2026-09-03', 185000, 'Peter Müller']]);
    expect(r.transactions[1]).toMatchObject({ isCredit: false, amountCents: 42050 });
  });

  it('Kopfzeile auf zwei Zeilen und Spaltenbezeichnungen Eingang/Ausgang, CHF vor dem Betrag', () => {
    const text = `
Buchung      Beschreibung                          Zahlungs-       Zahlungs-       Kontostand
                                                   ausgang         eingang
01.09.2026   Anfangssaldo                                                          CHF 500.00
06.09.2026   QR-Zahlung von Anna Keller                            CHF 2'100.00    CHF 2'600.00
`;
    const r = parseStatementLines(textToLines(text));
    expect(credits(r)).toEqual([['2026-09-06', 210000, 'Anna Keller']]);
    expect(r.transactions[0].verified).toBe(true);
  });
});

describe('Namen', () => {
  it('schneidet keine Namensteile ab (Anna, Vonlanthen)', () => {
    const r = parseStatementLines(textToLines(`
Datum        Text                                   Belastung     Gutschrift     Saldo
03.09.2026   Gutschrift Vonlanthen Marc                            1'000.00      1'000.00
04.09.2026   Gutschrift von Anna Andrist                           1'000.00      2'000.00
`));
    expect(r.transactions.map((t) => t.payerName)).toEqual(['Vonlanthen Marc', 'Anna Andrist']);
  });
});
