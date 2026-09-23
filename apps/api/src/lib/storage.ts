import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Dateispeicher-Abstraktion. Aktuell lokales Dateisystem; die Schnittstelle
 * ist so gehalten, dass später S3 / Azure Blob / andere Cloud-Speicher
 * angebunden werden können, ohne die Fachlogik zu ändern.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): NodeJS.ReadableStream;
  exists(key: string): Promise<boolean>;
}

class LocalStorage implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error('Ungültiger Speicherpfad');
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  get(key: string) {
    return readFile(this.resolve(key));
  }
  stream(key: string) {
    return createReadStream(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageDriver = new LocalStorage(config.STORAGE_DIR);

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function makeStorageKey(organizationId: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const now = new Date();
  return `${organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${ext}`;
}

export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
