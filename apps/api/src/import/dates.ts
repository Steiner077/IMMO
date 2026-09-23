/** Datumserkennung in Kontoauszügen: 03.09.2026 · 03.09.26 · 2026-09-03 · 03/09/2026 */
export const DATE_RE = /\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b|\b(\d{4})-(\d{2})-(\d{2})\b/;

export function parseDate(input: string | Date | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : toUtcDate(input);
  if (typeof input === 'number') {
    // Excel-Seriennummer
    if (input > 20000 && input < 80000) {
      const ms = Math.round((input - 25569) * 86400 * 1000);
      return new Date(ms);
    }
    return null;
  }
  const m = input.trim().match(DATE_RE);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[4]) {
    y = +m[4];
    mo = +m[5];
    d = +m[6];
  } else {
    d = +m[1];
    mo = +m[2];
    y = +m[3];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function toUtcDate(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
