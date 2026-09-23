/** Normalisierung von Namen und Texten für robuste Vergleiche. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIban(iban: string | null | undefined): string {
  return (iban ?? '').replace(/\s+/g, '').toUpperCase();
}

export function tokens(input: string | null | undefined): string[] {
  return normalizeText(input).split(' ').filter(Boolean);
}
