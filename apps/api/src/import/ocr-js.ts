import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { TextLine } from './types.js';
import { tsvToLines } from './ocr.js';

/**
 * Texterkennung ohne Zusatzprogramme (läuft auch unter Windows):
 * Seiten werden mit pdf.js gerendert (@napi-rs/canvas) und mit tesseract.js
 * (WebAssembly, Sprachdaten Deutsch + Englisch als npm-Paket) gelesen.
 * Wird verwendet, wenn Tesseract/poppler nicht installiert sind.
 */
const require = createRequire(import.meta.url);

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<Worker> | null = null;

function langDir(lang: string) {
  return path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int');
}

async function worker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    // Sprachdaten aus den npm-Paketen in einen gemeinsamen Ordner legen – kein Download nötig
    const dir = path.join(tmpdir(), 'immo-tessdata');
    await mkdir(dir, { recursive: true });
    for (const code of ['deu', 'eng']) {
      const target = path.join(dir, `${code}.traineddata.gz`);
      if (!existsSync(target)) await copyFile(path.join(langDir(code), `${code}.traineddata.gz`), target);
    }
    const w = await createWorker(['deu', 'eng'], OEM.LSTM_ONLY, { langPath: dir, cacheMethod: 'none', gzip: true });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    return w;
  })();
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

async function recognize(image: Buffer, page: number): Promise<TextLine[]> {
  const w = await worker();
  const { data } = await w.recognize(image, {}, { tsv: true, text: false, blocks: false });
  return tsvToLines(data.tsv ?? '', page);
}

async function renderPdf(data: Buffer, maxPages: number): Promise<Buffer[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, useSystemFonts: true }).promise;
  const out: Buffer[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 3 }); // ≈ 216 dpi
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    out.push(canvas.toBuffer('image/png'));
  }
  await doc.destroy();
  return out;
}

export async function ocrPdfJs(data: Buffer, maxPages = 20): Promise<TextLine[]> {
  const lines: TextLine[] = [];
  for (const [i, img] of (await renderPdf(data, maxPages)).entries()) lines.push(...(await recognize(img, i + 1)));
  return lines;
}

export async function ocrImageJs(data: Buffer): Promise<TextLine[]> {
  return recognize(data, 1);
}
