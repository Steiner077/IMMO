/**
 * Abrechnungsperioden werden als "YYYY-MM" dargestellt (z. B. "2026-09").
 */

export const MONTH_NAMES_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

export function toPeriod(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodToDate(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function addMonths(period: string, delta: number): string {
  const d = periodToDate(period);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return toPeriod(d);
}

export function comparePeriods(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function periodRange(from: string, to: string): string[] {
  const out: string[] = [];
  let p = from;
  let guard = 0;
  while (comparePeriods(p, to) <= 0 && guard++ < 1200) {
    out.push(p);
    p = addMonths(p, 1);
  }
  return out;
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES_DE[m - 1]} ${y}`;
}

export function isValidPeriod(p: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '–';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
