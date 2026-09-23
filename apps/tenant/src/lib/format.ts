import { formatMoney, formatPeriod, formatDate, formatDateTime } from '@immo/shared';
export { formatMoney, formatPeriod, formatDate, formatDateTime };

export const chf = (cents: number | null | undefined) => formatMoney(cents);
export const chfShort = (cents: number) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} Mio.`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`;
  return Math.round(v).toLocaleString('de-CH');
};

export function tenantName(t?: { firstName?: string | null; lastName?: string | null; companyName?: string | null } | null) {
  if (!t) return '–';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '–';
}

export function initials(first?: string | null, last?: string | null) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

export const toCents = (v: string) => {
  const n = Number(String(v).replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const fromCents = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

export const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const isoDate = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
