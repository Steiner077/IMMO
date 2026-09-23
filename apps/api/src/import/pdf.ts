import type { TextLine } from './types.js';

/**
 * Extrahiert Textzeilen inkl. x-Positionen aus einem PDF (pdf.js).
 * Die Positionen erlauben die Zuordnung von Beträgen zu Spalten.
 */
export async function extractPdfLines(data: Buffer): Promise<TextLine[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const lines: TextLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { str: string; x: number; width: number }[]>();
    for (const raw of content.items as Array<{ str: string; transform: number[]; width: number }>) {
      if (!('str' in raw) || !raw.str.trim()) continue;
      const x = raw.transform[4];
      const y = Math.round(raw.transform[5]);
      // Zeilen mit leicht abweichender y-Position zusammenführen
      let key = y;
      for (const k of rows.keys()) {
        if (Math.abs(k - y) <= 2) {
          key = k;
          break;
        }
      }
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({ str: raw.str, x, width: raw.width });
    }
    const sorted = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [y, items] of sorted) {
      items.sort((a, b) => a.x - b.x);
      // benachbarte Fragmente zusammenführen (pdf.js liefert Wörter teils einzeln)
      const merged: { str: string; x: number; width: number }[] = [];
      for (const it of items) {
        const last = merged[merged.length - 1];
        if (last && it.x - (last.x + last.width) < 3) {
          last.str += (it.x - (last.x + last.width) > 1 ? ' ' : '') + it.str;
          last.width = it.x + it.width - last.x;
        } else merged.push({ ...it });
      }
      lines.push({ page: p, y, text: merged.map((m) => m.str).join('  '), items: merged });
    }
  }
  await doc.destroy();
  return lines;
}
