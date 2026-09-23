import type { Db } from './prisma.js';

/** Liefert atomar die nächste Nummer eines Nummernkreises (z. B. Ticketnummer). */
export async function nextNumber(db: Db, organizationId: string, key: string, start = 1): Promise<number> {
  const row = await db.counter.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value: start },
    update: { value: { increment: 1 } },
  });
  return row.value;
}
