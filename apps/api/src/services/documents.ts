import type { DocumentCategory, Prisma } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { makeStorageKey, sha256, storage } from '../lib/storage.js';
import type { UploadedFile } from '../lib/upload.js';

const RULES: { category: DocumentCategory; patterns: RegExp[] }[] = [
  { category: 'BANK_STATEMENT', patterns: [/kontoauszug/i, /account statement/i, /kontobewegung/i, /saldo/i] },
  { category: 'LEASE', patterns: [/mietvertrag/i, /lease/i] },
  { category: 'TERMINATION', patterns: [/kündigung/i, /kuendigung/i, /termination/i] },
  { category: 'HANDOVER', patterns: [/übergabe/i, /uebergabe/i, /abnahmeprotokoll/i, /wohnungsabnahme/i] },
  { category: 'INSURANCE', patterns: [/versicherung/i, /police/i, /insurance/i] },
  { category: 'INVOICE', patterns: [/rechnung/i, /invoice/i, /faktura/i, /offerte/i] },
  { category: 'RECEIPT', patterns: [/quittung/i, /beleg/i, /zahlungsbestätigung/i, /receipt/i] },
  { category: 'CONSTRUCTION', patterns: [/grundriss/i, /baupl/i, /baubewilligung/i, /plan\b/i] },
  { category: 'CONTRACT', patterns: [/vertrag/i, /contract/i, /vereinbarung/i] },
  { category: 'CORRESPONDENCE', patterns: [/brief/i, /schreiben/i, /korrespondenz/i, /mail/i] },
];

/** Automatische Klassifizierung anhand von Dateiname, Typ und (optional) Textinhalt. */
export function classifyDocument(name: string, mimeType: string, text = ''): { category: DocumentCategory; score: number } {
  if (mimeType.startsWith('image/')) return { category: 'PHOTO', score: 95 };
  if (mimeType.startsWith('video/')) return { category: 'VIDEO', score: 95 };
  for (const r of RULES) {
    if (r.patterns.some((p) => p.test(name))) return { category: r.category, score: 85 };
  }
  if (text) {
    let best: { category: DocumentCategory; hits: number } | null = null;
    for (const r of RULES) {
      const hits = r.patterns.reduce((s, p) => s + (text.match(new RegExp(p.source, 'gi'))?.length ?? 0), 0);
      if (hits && (!best || hits > best.hits)) best = { category: r.category, hits };
    }
    if (best) return { category: best.category, score: Math.min(80, 40 + best.hits * 8) };
  }
  return { category: 'OTHER', score: 0 };
}

export interface DocumentLinks {
  propertyId?: string | null;
  unitId?: string | null;
  tenantId?: string | null;
  leaseId?: string | null;
  paymentId?: string | null;
  damageReportId?: string | null;
  expenseId?: string | null;
  messageId?: string | null;
}

export async function storeDocument(
  db: Db,
  organizationId: string,
  file: UploadedFile,
  opts: DocumentLinks & { category?: DocumentCategory | null; description?: string | null; visibleToTenant?: boolean; uploadedById: string },
) {
  const key = makeStorageKey(organizationId, file.filename);
  await storage.put(key, file.buffer);
  let category = opts.category ?? null;
  let score: number | null = null;
  if (!category) {
    let text = '';
    if (file.mimetype === 'application/pdf') {
      try {
        const { extractPdfLines } = await import('../import/pdf.js');
        text = (await extractPdfLines(file.buffer)).slice(0, 80).map((l) => l.text).join('\n');
      } catch {
        text = '';
      }
    }
    const c = classifyDocument(file.filename, file.mimetype, text);
    category = c.category;
    score = c.score;
  }
  const data: Prisma.DocumentUncheckedCreateInput = {
    organizationId,
    name: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.buffer.length,
    storageKey: key,
    sha256: sha256(file.buffer),
    category,
    classificationScore: score,
    description: opts.description ?? null,
    propertyId: opts.propertyId ?? null,
    unitId: opts.unitId ?? null,
    tenantId: opts.tenantId ?? null,
    leaseId: opts.leaseId ?? null,
    paymentId: opts.paymentId ?? null,
    damageReportId: opts.damageReportId ?? null,
    expenseId: opts.expenseId ?? null,
    messageId: opts.messageId ?? null,
    visibleToTenant: opts.visibleToTenant ?? false,
    uploadedById: opts.uploadedById,
  };
  return db.document.create({ data });
}

export { prisma };
