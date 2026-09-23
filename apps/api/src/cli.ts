/**
 * Verwaltungsbefehle für den Betrieb.
 *   node dist/cli.js reset-password --email ich@example.ch
 *   node dist/cli.js create-owner --org "Meine Verwaltung" --email ich@example.ch --first Vorname --last Nachname
 * Das Startpasswort wird aus INITIAL_PASSWORD gelesen oder zufällig erzeugt und einmalig ausgegeben.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordPolicyError } from './auth/password.js';

// Lokal: Zugangsdaten aus apps/api/.env lesen (wie der Server)
if (existsSync('.env') && !process.env.DATABASE_URL) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  // Windows/npm reicht Anführungszeichen teils mit durch – entfernen
  return i >= 0 ? args[i + 1]?.replace(/^[\s"'^]+|[\s"'^]+$/g, '').replace(/\^/g, '') : undefined;
};

async function main() {
  const prisma = new PrismaClient();
  try {
    if (cmd === 'create-owner') {
      const org = opt('org');
      const email = opt('email')?.toLowerCase();
      const first = opt('first');
      const last = opt('last');
      if (!org || !email || !first || !last) throw new Error('Benötigt: --org --email --first --last');
      const password = process.env.INITIAL_PASSWORD ?? `${randomBytes(9).toString('base64url')}7a`;
      const policy = passwordPolicyError(password);
      if (policy) throw new Error(policy);
      const organization = (await prisma.organization.findFirst({ where: { name: org } })) ?? (await prisma.organization.create({ data: { name: org } }));
      await prisma.user.create({
        data: { organizationId: organization.id, email, firstName: first, lastName: last, role: 'OWNER', mustChangePassword: true, passwordHash: await hashPassword(password) },
      });
      console.log(`Eigentümer ${email} für "${org}" angelegt.`);
      if (!process.env.INITIAL_PASSWORD) console.log(`Startpasswort (einmalig angezeigt, beim ersten Login ändern): ${password}`);
    } else if (cmd === 'reset-password') {
      const email = opt('email')?.toLowerCase();
      if (!email) throw new Error('Benötigt: --email');
      const user = await prisma.user.findFirst({ where: { email } });
      if (!user) throw new Error(`Kein Benutzer mit E-Mail ${email} gefunden.`);
      const password = `${randomBytes(9).toString('base64url')}7a`;
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
      console.log(`Neues Startpasswort für ${email} (beim nächsten Login ändern): ${password}`);
    } else {
      console.log('Befehle: create-owner --org <Name> --email <E-Mail> --first <Vorname> --last <Nachname>');
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
