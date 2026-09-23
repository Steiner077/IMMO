/**
 * Geldbeträge werden im gesamten System als Ganzzahl in Rappen (Cent)
 * gespeichert, um Rundungsfehler bei Fliesskommazahlen auszuschliessen.
 */

export function formatMoney(cents: number | null | undefined, currency = 'CHF'): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '–';
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const francs = Math.floor(abs / 100);
  const rappen = abs % 100;
  const grouped = francs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const rp = rappen === 0 ? '–' : rappen.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${currency} ${grouped}.${rp}`;
}

export function formatMoneyPlain(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const grouped = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${negative ? '-' : ''}${grouped}.${(abs % 100).toString().padStart(2, '0')}`;
}

/**
 * Parst Beträge in Schweizer, deutschen und internationalen Schreibweisen:
 * 1'850.00 · 1’850.00 · 1850 · 1.850,00 · 1,850.00 · -1'850.00 · 1850.-
 * Gibt Rappen zurück oder null, wenn kein Betrag erkannt wurde.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.trim().replace(/\s|CHF|EUR|Fr\.?|SFr\.?/gi, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith('-') && !s.endsWith('.-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/\.-$/, '.00').replace(/,-$/, ',00');
  s = s.replace(/['’`]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 2 || decimals === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    const decimals = s.length - lastDot - 1;
    if (parts.length > 2 && decimals === 2) {
      // "1.850.00" (Texterkennung/Tausenderpunkt): letzter Punkt ist Dezimaltrenner
      s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    } else if (parts.length > 2 || decimals === 3) {
      // "1.850.000" oder "1.850" (deutsche Tausendertrennung)
      s = s.replace(/\./g, '');
    }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  return negative ? -cents : cents;
}
