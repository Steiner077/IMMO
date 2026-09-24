#!/usr/bin/env node
/**
 * Lokale Sicherung (Windows, macOS, Linux) – für den Betrieb auf dem eigenen PC.
 *   npm run sichern                       → Ordner "backups" im Projekt
 *   npm run sichern -- "D:\Sicherung"     → z. B. USB-Stick oder OneDrive-Ordner
 *   npm run wiederherstellen -- <Datei.dump> --ja
 * Sichert die Datenbank (pg_dump) und die Dokumentenablage; behält die letzten 30 Sicherungen.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'apps', 'api');
const KEEP = 30;

function env() {
  const file = join(apiDir, '.env');
  const out = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...out, ...process.env };
}

/** pg_dump/pg_restore im PATH oder in der Standard-Installation von PostgreSQL für Windows finden */
function tool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  if (spawnSync(exe, ['--version']).status === 0) return exe;
  const base = 'C:\\Program Files\\PostgreSQL';
  if (existsSync(base)) {
    const versions = readdirSync(base).filter((v) => /^\d+/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a));
    for (const v of versions) {
      const p = join(base, v, 'bin', exe);
      if (existsSync(p)) return p;
    }
  }
  throw new Error(`${name} nicht gefunden. Ist PostgreSQL installiert?`);
}

function connection(e) {
  if (!e.DATABASE_URL) throw new Error('DATABASE_URL fehlt (apps/api/.env)');
  const u = new URL(e.DATABASE_URL);
  const db = decodeURIComponent(u.pathname.slice(1));
  return {
    db,
    args: ['--host', u.hostname, '--port', u.port || '5432', '--username', decodeURIComponent(u.username), '--dbname', db],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
  };
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} fehlgeschlagen (Code ${r.status ?? r.error?.message})`);
}

function backup(target) {
  const e = env();
  const c = connection(e);
  const dest = resolve(target ?? join(root, 'backups'));
  mkdirSync(dest, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const file = join(dest, `${c.db}_${stamp}.dump`);
  run(tool('pg_dump'), [...c.args, '--format=custom', '--no-owner', '--file', file], { env: c.env });
  run(tool('pg_restore'), ['--list', file], { env: c.env }); // Datei lesbar?

  const storage = resolve(apiDir, e.STORAGE_DIR ?? './storage');
  const docs = join(dest, `${c.db}_${stamp}_dokumente`);
  if (existsSync(storage)) cpSync(storage, docs, { recursive: true });

  // Aufräumen: nur die letzten KEEP Sicherungen dieser Datenbank behalten
  const old = readdirSync(dest).filter((f) => f.startsWith(`${c.db}_`) && f.endsWith('.dump')).sort().reverse().slice(KEEP);
  for (const f of old) {
    rmSync(join(dest, f), { force: true });
    rmSync(join(dest, f.replace(/\.dump$/, '_dokumente')), { recursive: true, force: true });
  }
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`✔ Sicherung erstellt: ${file} (${kb} KB)${existsSync(docs) ? `\n✔ Dokumente gesichert: ${docs}` : ''}`);
}

function restore(file, confirmed) {
  if (!file || !existsSync(file)) throw new Error('Bitte Sicherungsdatei (.dump) angeben.');
  const e = env();
  const c = connection(e);
  if (!confirmed) {
    console.log(`Achtung: Die Datenbank "${c.db}" wird durch den Stand aus\n  ${file}\nersetzt. Alles, was danach eingegeben wurde, geht verloren.\nZum Ausführen den Befehl mit --ja wiederholen.`);
    process.exit(1);
  }
  run(tool('pg_restore'), [...c.args, '--clean', '--if-exists', '--no-owner', '--single-transaction', file], { env: c.env });
  const docs = resolve(file).replace(/\.dump$/, '_dokumente');
  if (existsSync(docs)) cpSync(docs, resolve(apiDir, e.STORAGE_DIR ?? './storage'), { recursive: true });
  console.log(`✔ Datenbank "${c.db}" wiederhergestellt aus ${file}`);
}

try {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'restore') restore(rest.find((a) => !a.startsWith('--')), rest.includes('--ja'));
  else backup(cmd === 'backup' ? rest[0] : cmd);
} catch (err) {
  console.error(`✘ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
