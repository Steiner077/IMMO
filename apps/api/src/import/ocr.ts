import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TextLine } from './types.js';

const run = promisify(execFile);

/**
 * Texterkennung (OCR) für eingescannte/fotografierte Kontoauszüge.
 * Verwendet Tesseract (Sprachen Deutsch + Englisch) und poppler (pdftoppm),
 * die im Docker-Image installiert sind. Liefert Zeilen mit Wortpositionen,
 * damit die Spaltenerkennung (Belastung/Gutschrift/Saldo) auch hier greift.
 */

let available: boolean | null = null;
export async function ocrAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await run('tesseract', ['--version'], { timeout: 5000 });
    await run('pdftoppm', ['-v'], { timeout: 5000 });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

interface Word { page: number; block: number; par: number; line: number; left: number; top: number; width: number; height: number; conf: number; text: string }

/** Wandelt Tesseract-TSV in Textzeilen mit x-Positionen um. */
export function tsvToLines(tsv: string, page: number): TextLine[] {
  const words: Word[] = [];
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    if (!text) continue;
    words.push({ page, block: +c[2], par: +c[3], line: +c[4], left: +c[6], top: +c[7], width: +c[8], height: +c[9], conf: +c[10], text });
  }
  // Zeilen nach vertikaler Position gruppieren (Tesseract trennt Spalten teils in Blöcke)
  words.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: Word[][] = [];
  for (const w of words) {
    const mid = w.top + w.height / 2;
    const row = rows.find((r) => {
      const ref = r[0];
      return Math.abs(ref.top + ref.height / 2 - mid) < Math.max(ref.height, w.height) * 0.55;
    });
    if (row) row.push(w);
    else rows.push([w]);
  }
  const lines: TextLine[] = [];
  for (const r of rows) {
    r.sort((a, b) => a.left - b.left);
    const avgChar = r.reduce((s, w) => s + w.width / Math.max(1, w.text.length), 0) / r.length;
    const items: TextLine['items'] = [];
    for (const w of r) {
      const last = items[items.length - 1];
      // Wörter mit normalem Wortabstand zu einem Element zusammenfassen ("Peter Müller")
      if (last && w.left - (last.x + last.width) < avgChar * 1.6 && !/^-?[\d'’.,]+$/.test(w.text) && !/^-?[\d'’.,]+$/.test(last.str)) {
        last.str += ` ${w.text}`;
        last.width = w.left + w.width - last.x;
      } else {
        items.push({ str: w.text, x: w.left, width: w.width });
      }
    }
    lines.push({ page, y: r[0].top, text: items.map((i) => i.str).join('  '), items });
  }
  return lines.sort((a, b) => a.y - b.y);
}

async function ocrImageFile(file: string, page: number): Promise<TextLine[]> {
  const { stdout } = await run('tesseract', [file, 'stdout', '-l', 'deu+eng', '--psm', '6', '-c', 'preserve_interword_spaces=1', 'tsv'], {
    timeout: 120_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return tsvToLines(stdout, page);
}

export async function ocrPdf(data: Buffer, maxPages = 20): Promise<TextLine[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'immo-ocr-'));
  try {
    const input = path.join(dir, 'in.pdf');
    await writeFile(input, data);
    await run('pdftoppm', ['-r', '300', '-gray', '-png', '-l', String(maxPages), input, path.join(dir, 'p')], { timeout: 120_000 });
    const pages = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    const lines: TextLine[] = [];
    for (const [i, f] of pages.entries()) lines.push(...(await ocrImageFile(path.join(dir, f), i + 1)));
    return lines;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function ocrImage(data: Buffer, ext: string): Promise<TextLine[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'immo-ocr-'));
  try {
    const file = path.join(dir, `in${ext}`);
    await writeFile(file, data);
    return await ocrImageFile(file, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
