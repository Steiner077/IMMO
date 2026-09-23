import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/services/imports.js';

const hasOcr = (() => {
  try {
    execFileSync('tesseract', ['--version'], { stdio: 'ignore' });
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const samples = path.resolve(import.meta.dirname, '../../../samples');
const expected = [163000, 150000, 185000, 181000, 42050, 211000, 425000, 195000, 282000, 50000, 68400];

describe.skipIf(!hasOcr || !existsSync(path.join(samples, 'kontoauszug-2026-09-foto.jpg')))('Texterkennung (OCR) für Ausdrucke', () => {
  it.each([
    ['PDF', 'kontoauszug-2026-09-scan.pdf'],
    ['IMAGE', 'kontoauszug-2026-09-foto.jpg'],
  ] as const)('%s-Scan: alle Beträge gelesen und durch den Saldo bestätigt', async (type, file) => {
    const r = await parseFile(type, readFileSync(path.join(samples, file)), file);
    expect(r.meta.ocr).toBe(true);
    expect(r.transactions.map((t) => t.amountCents)).toEqual(expected);
    expect(r.transactions.every((t) => t.verified)).toBe(true);
    expect(r.transactions.filter((t) => !t.isCredit).map((t) => t.amountCents)).toEqual([42050, 68400]);
    expect(r.transactions.find((t) => t.payerName === 'Weber Julia')?.payerIban).toBe('CH4431999123000889012');
  }, 60_000);
});
