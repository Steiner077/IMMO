import { describe, expect, it } from 'vitest';
import { looksAligned, parseStatementText } from '../src/import/statement-parser.js';

// Typischer Text, wenn man einen Kontoauszug aus dem PDF-Viewer kopiert: Spalten gehen verloren.
const pasted = `Kontoauszug September 2026
IBAN CH12 0023 0230 1234 5678 9
Datum Buchungstext Belastung Gutschrift Valuta Saldo
01.09.2026 Saldovortrag 12'400.00
03.09.2026 Gutschrift 1'850.00 03.09.2026 14'250.00
Peter Müller
Mitteilung: Mietzins September Wohnung 3A
04.09.2026 Zahlung an 420.50 04.09.2026 13'829.50
EWZ Elektrizitätswerk
05.09.2026 Überweisung 1'500.00 05.09.2026 15'329.50
M. Arnold
06.09.2026 Dauerauftrag 900.00 06.09.2026 14'429.50
Hauswartung Gerber
07.09.2026 Gutschrift 2'110.00 07.09.2026 16'539.50
Weber Julia`;

describe('eingefügter Kontoauszugstext', () => {
  it('erkennt nicht ausgerichteten Text', () => {
    expect(looksAligned(pasted)).toBe(false);
  });

  it('bestimmt Gutschrift/Belastung zuverlässig über die Saldo-Kontrolle', () => {
    const r = parseStatementText(pasted);
    expect(r.transactions.map((t) => [t.amountCents, t.isCredit, t.verified])).toEqual([
      [185000, true, true],
      [42050, false, true],
      [150000, true, true], // "Überweisung" ist mehrdeutig – der Saldo entscheidet
      [90000, false, true], // "Dauerauftrag" ohne "an" – der Saldo entscheidet
      [211000, true, true],
    ]);
    expect(r.transactions[0].payerName).toBe('Peter Müller');
    expect(r.transactions[2].payerName).toBe('M. Arnold');
    expect(r.meta.balanceCheck).toMatchObject({ verified: 5, checked: 5 });
  });

  it('meldet Beträge, die nicht zum Saldo passen (z. B. Lesefehler)', () => {
    const broken = pasted.replace("1'850.00 03.09.2026", "1'650.00 03.09.2026");
    const r = parseStatementText(broken);
    expect(r.transactions[0].verified).toBe(false);
    expect(r.meta.warnings.join(' ')).toContain('passen nicht zum Saldo');
  });
});
