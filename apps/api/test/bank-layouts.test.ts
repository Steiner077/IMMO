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

describe('Raiffeisen E-Banking-Auszug (ohne Saldospalte, neueste zuerst)', () => {
  // Nachbau des echten Layouts mit erfundenen Namen
  const P = (page: number, rows: [number, string][][]) =>
    rows.map((items, i) => ({ page, y: 800 - i * 12, text: items.map(([, s]) => s).join('  '), items: items.map(([x, s]) => ({ str: s, x, width: s.length * 4.6 })) }));
  const head = (p: number): [number, string][][] => [
    [[310, 'Kontoinhaber:'], [373, 'Hans und Rita Beispiel']],
    [[57, 'Raiffeisenbank']],
    [[57, 'Kontoauszug'], [124, '(Buchungsdatum vom 04.03.2025 bis 23.04.2025)'], [500, `Seite ${p} von 2`]],
    [[60, 'Datum'], [118, 'Text'], [322, 'Belastung'], [388, 'Gutschrift'], [520, 'Valuta']],
  ];
  const foot: [number, string][][] = [[[57, 'Alle Angaben erfolgen ohne Gewähr.'], [426, 'Druckdatum: 23.04.2025 14:16']], [[57, 'Raiffeisenbank Genossenschaft']]];
  const lines = [
    ...P(1, [
      ...head(1),
      [[60, '09.04.2025'], [118, 'Gutschrift Otto Vorbesitzer sel.'], [405, '60.00'], [505, '09.04.2025']],
      [[118, 'Seeweg 8, 6460 Altdorf UR'], [405, '60.00']],
      [[118, 'Keller Stefanie']],
      [[118, 'Miete Parkplatz April 2025']],
      [[60, '01.04.2025'], [118, 'Gutschrift Anna Brunner'], [401, '100.00'], [505, '01.04.2025']],
      [[118, 'Vorstadt 7'], [401, '100.00']],
      [[118, '6460 Altdorf UR']],
      [[60, '31.03.2025'], [118, 'Sammelzahlung'], [312, "1'451'355.00"], [505, '31.03.2025']],
      [[118, 'Papierauftrag']],
      [[118, 'Otto Vorbesitzer'], [312, "1'356'355.00"]],
      [[118, 'Kauf Liegenschaft Kreuzgasse 1']],
      [[118, 'Notar Muster'], [324, "95'000.00"]],
      [[60, '31.03.2025'], [118, 'Gutschrift Moritz Beispiel-Muster'], [405, '50.00'], [505, '31.03.2025']],
      [[118, 'Gotthardstrasse 32'], [405, '50.00']],
      [[118, '6460 Altdorf UR']],
      [[118, 'Monatliche Parkgebuehr']],
      [[60, '24.03.2025'], [118, 'Zahlung Muster Immobilien GmbH'], [324, "48'645.00"], [505, '24.03.2025']],
      ...foot,
    ]),
    ...P(2, [
      ...head(2),
      [[118, 'Axenstrasse 11, 6440 Brunnen'], [324, "48'645.00"]],
      [[118, 'Papierauftrag']],
      [[60, '21.03.2025'], [118, 'Gutschrift Otto Vorbesitzer sel.'], [394, "1'500.00"], [505, '21.03.2025']],
      [[118, 'Seeweg 8'], [394, "1'500.00"]],
      [[118, '6460 Altdorf UR']],
      [[118, 'Lars Wiesner']],
      [[118, 'Miete Wohnung OG April 2025']],
      [[60, 'Umsatz'], [312, "1'500'000.00"], [379, "1'710.00"]],
      ...foot,
    ]),
  ];
  const r = parseStatementLines(lines);

  it('erkennt jede Buchung genau einmal (Betrag auf Folgezeile nicht doppelt)', () => {
    expect(r.transactions.map((t) => [t.bookingDate.toISOString().slice(0, 10), t.isCredit ? '+' : '-', t.amountCents])).toEqual([
      ['2025-04-09', '+', 6000],
      ['2025-04-01', '+', 10000],
      ['2025-03-31', '-', 145135500],
      ['2025-03-31', '+', 5000],
      ['2025-03-24', '-', 4864500],
      ['2025-03-21', '+', 150000],
    ]);
  });

  it('nimmt den eigentlichen Mieter aus dem Text, wenn über ein anderes Konto überwiesen wird', () => {
    const c = r.transactions.filter((t) => t.isCredit);
    expect(c.map((t) => t.payerName)).toEqual(['Keller Stefanie', 'Anna Brunner', 'Moritz Beispiel-Muster', 'Lars Wiesner']);
    expect(c[0].reference).toContain('Miete Parkplatz April 2025');
    expect(c[0].reference).toContain('Otto Vorbesitzer');
    expect(c[2].reference).toContain('Monatliche Parkgebuehr');
  });

  it('Buchung über den Seitenwechsel bleibt zusammen, Kopf-/Fusszeilen stören nicht', () => {
    const z = r.transactions.find((t) => t.amountCents === 4864500)!;
    expect(z.rawText).toContain('Axenstrasse 11');
    expect(r.transactions.some((t) => /Druckdatum|Alle Angaben/.test(t.rawText))).toBe(false);
  });

  it('prüft die Vollständigkeit mit der Umsatz-Zeile', () => {
    expect(r.meta.balanceCheck).toEqual({ verified: 6, checked: 6, corrected: 0 });
    expect(r.transactions.every((t) => t.verified)).toBe(true);
  });
});
