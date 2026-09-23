import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Bereitet die dedizierte Test-Datenbank vor (TEST_DATABASE_URL):
 * Migrationen anwenden, Tabellen leeren, Demo-Daten einspielen.
 * Niemals gegen eine produktive Datenbank ausführen.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL fehlt');
  if (!/test/i.test(url)) throw new Error('TEST_DATABASE_URL muss auf eine Test-Datenbank zeigen (Name enthält "test").');
  const env = { ...process.env, DATABASE_URL: url, STORAGE_DIR: './storage-test', NODE_ENV: 'test' };
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
  );
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await prisma.$disconnect();
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
}
