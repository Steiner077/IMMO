import type { FastifyRequest } from 'fastify';
import path from 'node:path';
import { badRequest } from './errors.js';
import { ALLOWED_MIME } from './storage.js';

export interface UploadedFile {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Prüft die Datei anhand ihrer Signatur (Magic Bytes) – nicht nur anhand der Endung. */
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 2).toString() === 'PK') return 'zip';
  if (buf.subarray(4, 8).toString() === 'ftyp') return 'video-or-heic';
  return null;
}

export function resolveMime(filename: string, declared: string, buf: Buffer): string {
  const ext = path.extname(filename).toLowerCase();
  const byExt = EXT_MIME[ext];
  if (!byExt) throw badRequest(`Dateityp ${ext || '(ohne Endung)'} wird nicht unterstützt.`);
  const sig = sniff(buf);
  if (byExt === 'application/pdf' && sig !== 'application/pdf') throw badRequest('Die Datei ist kein gültiges PDF.');
  if (byExt.startsWith('image/') && !['image/heic'].includes(byExt) && sig !== byExt && !(byExt === 'image/jpeg' && sig === 'image/jpeg'))
    throw badRequest('Die Bilddatei ist beschädigt oder hat eine falsche Endung.');
  if ((ext === '.xlsx' || ext === '.docx') && sig !== 'zip') throw badRequest('Die Office-Datei ist ungültig.');
  if (!ALLOWED_MIME.has(byExt)) throw badRequest('Dateityp nicht erlaubt.');
  void declared;
  return byExt;
}

export async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  if (!req.isMultipart()) throw badRequest('Erwartet multipart/form-data');
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (!buffer.length) continue;
      const filename = path.basename(part.filename).replace(/[^\w.\-äöüÄÖÜ ()]/g, '_').slice(0, 180);
      files.push({ filename, mimetype: resolveMime(filename, part.mimetype, buffer), buffer });
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  return { fields, files };
}
