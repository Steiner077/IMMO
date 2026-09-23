import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Db = typeof prisma | Tx;

/**
 * Serialisierbare Transaktion mit automatischer Wiederholung bei
 * Serialisierungskonflikten (P2034). Für alle finanziellen Buchungen.
 */
export async function financialTx<T>(fn: (tx: Tx) => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2034' && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 50 * 2 ** i + Math.random() * 50));
        continue;
      }
      throw e;
    }
  }
}
