import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.STORAGE_DIR = './storage-test';
process.env.LOG_LEVEL = 'warn';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret';

let app: Awaited<ReturnType<typeof import('../../src/app.js').buildApp>>;
const PASSWORD = 'Immo2026!demo';

async function login(email: string, appKind: 'admin' | 'tenant' = 'admin') {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-immo-app': appKind }, payload: { email, password: PASSWORD } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().accessToken as string;
}
const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

function multipart(file: string, type: string) {
  const boundary = '----immotest';
  const content = readFileSync(file);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, content, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
});
afterAll(async () => app?.close());

describe('Authentifizierung', () => {
  it('lehnt falsche Passwörter ab', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'verwaltung@immo.local', password: 'falsch' } });
    expect(r.statusCode).toBe(401);
  });
  it('trennt Mieter- und Verwaltungs-App', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'mieter@immo.local', password: PASSWORD } });
    expect(r.statusCode).toBe(403);
  });
  it('verlangt ein Token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments' })).statusCode).toBe(401);
  });
});

describe('Rollen und Datenumfang', () => {
  it('Mieter sieht ausschliesslich eigene Daten', async () => {
    const t = await login('mieter@immo.local', 'tenant');
    expect((await get(t, '/api/v1/payments')).statusCode).toBe(403);
    expect((await get(t, '/api/v1/tenants')).statusCode).toBe(403);
    const damages = (await get(t, '/api/v1/portal/damages')).json();
    expect(damages.map((d: { ticketNumber: number }) => d.ticketNumber)).toEqual([1047]);
    // Keine Liste anderer Benutzer/Mieter über Hilfs-Endpunkte
    expect((await get(t, '/api/v1/users/directory?role=TENANT')).statusCode).toBe(403);
    expect((await get(t, '/api/v1/conversations/recipients')).statusCode).toBe(403);
    expect((await get(t, '/api/v1/settings')).statusCode).toBe(403);
    const search = (await get(t, '/api/v1/search?q=Keller')).json();
    expect(Object.values(search).every((v) => (v as unknown[]).length === 0)).toBe(true);
    const conv = (await get(t, '/api/v1/portal/conversations')).json();
    expect(conv.every((c: { subject: string }) => c.subject !== 'Lift Wohnpark Lindenhof')).toBe(true);
  });

  it('Hauswart sieht Mängel, aber keine Finanzdaten', async () => {
    const t = await login('hauswart@immo.local');
    expect((await get(t, '/api/v1/payments')).statusCode).toBe(403);
    expect((await get(t, '/api/v1/finance/summary')).statusCode).toBe(403);
    expect((await get(t, '/api/v1/damages')).statusCode).toBe(200);
    const dash = (await get(t, '/api/v1/dashboard')).json();
    expect(dash.kpis.dueCents).toBeUndefined();
    expect(dash.incomeByMonth).toBeUndefined();
  });

  it('Mitarbeiter sieht nur freigeschaltete Immobilien – auch nicht über Filterparameter', async () => {
    const admin = await login('verwaltung@immo.local');
    const props = (await get(admin, '/api/v1/properties')).json() as { id: string; name: string }[];
    const foreign = props.find((p) => p.name === 'Seestrasse 12')!;
    const t = await login('mitarbeiter@immo.local');
    expect(((await get(t, '/api/v1/properties')).json() as { name: string }[]).map((p) => p.name)).toEqual(['Wohnpark Lindenhof']);
    const tenants = (await get(t, '/api/v1/tenants')).json() as { lastName: string }[];
    expect(tenants.map((x) => x.lastName)).not.toContain('Müller');
    const recipients = (await get(t, '/api/v1/conversations/recipients')).json() as { lastName: string; role: string }[];
    expect(recipients.filter((r) => r.role === 'TENANT').map((r) => r.lastName)).not.toContain('Müller');
    for (const url of [`/api/v1/properties/${foreign.id}`, `/api/v1/payments?propertyId=${foreign.id}`, `/api/v1/damages?propertyId=${foreign.id}`, `/api/v1/monthly/2026-09?propertyId=${foreign.id}`, `/api/v1/expenses?propertyId=${foreign.id}`]) {
      expect((await get(t, url)).statusCode, url).toBe(403);
    }
  });

  it('Mieter können keine Verwaltungsfunktionen ausführen', async () => {
    const t = await login('mieter2@immo.local', 'tenant');
    const r = await app.inject({ method: 'POST', url: '/api/v1/payments', headers: { authorization: `Bearer ${t}` }, payload: { bookingDate: '2026-09-01', amountCents: 100 } });
    expect(r.statusCode).toBe(403);
  });
});

describe('Mieter-App: Mangel melden', () => {
  it('erstellt ein Ticket mit Foto und benachrichtigt die Verwaltung', async () => {
    const t = await login('mieter@immo.local', 'tenant');
    const boundary = '----immodamage';
    // 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const field = (n: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
    const payload = Buffer.concat([
      Buffer.from(field('category', 'HEATING') + field('title', 'Heizung kalt') + field('description', 'Alle Heizkörper sind kalt.') + field('priority', 'HIGH')),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({ method: 'POST', url: '/api/v1/portal/damages', headers: { authorization: `Bearer ${t}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(r.statusCode, r.body).toBe(200);
    const { id, ticketNumber } = r.json();
    expect(ticketNumber).toBeGreaterThan(1048);
    const detail = (await get(t, `/api/v1/portal/damages/${id}`)).json();
    expect(detail.documents).toHaveLength(1);
    expect(detail.status).toBe('NEW');
    // Andere Mieterin sieht das Ticket nicht
    const other = await login('mieter2@immo.local', 'tenant');
    expect((await get(other, `/api/v1/portal/damages/${id}`)).statusCode).toBe(404);
    // Verwaltung wurde benachrichtigt
    const admin = await login('verwaltung@immo.local');
    const notes = (await get(admin, '/api/v1/notifications?type=DAMAGE_NEW')).json();
    expect(notes.items.some((n: { title: string }) => n.title.includes(String(ticketNumber)))).toBe(true);
  });
});

describe('Zahlungsimport (PDF) End-to-End', () => {
  it('analysiert, verbucht nur bestätigte Zahlungen und lernt Zuordnungen', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const mp = multipart(path.resolve(import.meta.dirname, '../../../../samples/kontoauszug-2026-09.pdf'), 'application/pdf');
    const up = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...auth, ...mp.headers }, payload: mp.payload });
    expect(up.statusCode, up.body).toBe(200);
    const id = up.json().id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let batch: any;
    for (let i = 0; i < 50; i++) {
      batch = (await get(t, `/api/v1/imports/${id}`)).json();
      if (batch.status !== 'ANALYZING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(batch.status).toBe('READY');
    const byPayer = (n: string) => batch.rows.find((r: { payerName: string }) => r.payerName === n);
    expect(byPayer('Peter Müller').status).toBe('READY');
    expect(byPayer('Peter Müller').confidence).toBeGreaterThanOrEqual(95);
    expect(byPayer('Sandra Meier').status).toBe('DUPLICATE');
    expect(byPayer('Hans Beispiel').status).toBe('UNMATCHED');
    expect(byPayer('M. Arnold').status).toBe('NEEDS_REVIEW');

    // Ohne Bestätigung wird nichts verbucht
    const none = await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/post`, headers: auth, payload: {} });
    expect(none.json().posted).toBe(0);

    await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/confirm-ready`, headers: auth, payload: {} });
    await app.inject({ method: 'PATCH', url: `/api/v1/imports/rows/${byPayer('M. Arnold').id}`, headers: auth, payload: { confirmed: true } });
    const posted = (await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/post`, headers: auth, payload: {} })).json();
    expect(posted.failed).toEqual([]);
    expect(posted.posted).toBeGreaterThanOrEqual(5);

    const month = (await get(t, '/api/v1/monthly/2026-09')).json();
    const mueller = month.rows.find((r: { tenant: { lastName: string } }) => r.tenant.lastName === 'Müller');
    expect(mueller.status).toBe('PAID');

    const aliases = (await get(t, '/api/v1/automation/aliases')).json() as { normalizedName: string }[];
    expect(aliases.map((a) => a.normalizedName)).toContain('m arnold');

    // Audit-Log enthält die Verbuchung
    const audit = (await get(t, '/api/v1/audit?action=import.post')).json();
    expect(audit.total).toBeGreaterThan(0);
  });

  it('Stornierte Zahlung setzt den Monat wieder auf offen', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const list = (await get(t, '/api/v1/payments?search=Peter')).json();
    const p = list.items.find((x: { payerName: string; source: string }) => x.source === 'PDF_IMPORT');
    const r = await app.inject({ method: 'POST', url: `/api/v1/payments/${p.id}/reverse`, headers: auth, payload: { reason: 'Test-Storno' } });
    expect(r.statusCode).toBe(200);
    const month = (await get(t, '/api/v1/monthly/2026-09')).json();
    expect(month.rows.find((x: { tenant: { lastName: string } }) => x.tenant.lastName === 'Müller').status).not.toBe('PAID');
  });
});
