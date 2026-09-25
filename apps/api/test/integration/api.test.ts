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

  it('eingefügter Kontoauszugstext wird analysiert und per Saldo geprüft', async () => {
    const t = await login('verwaltung@immo.local');
    const text = ["01.09.2026 Saldovortrag 10'000.00", "11.09.2026 Gutschrift 2'510.00 11.09.2026 12'510.00", 'Nicole Baumann', 'Mitteilung: Miete Juli'].join('\n');
    const up = await app.inject({ method: 'POST', url: '/api/v1/imports/text', headers: { authorization: `Bearer ${t}` }, payload: { text } });
    expect(up.statusCode, up.body).toBe(200);
    let batch: { status: string; meta: { balanceCheck: { verified: number } }; rows: { payerName: string; balanceVerified: boolean; allocation: { period: string }[]; status: string }[] } | undefined;
    for (let i = 0; i < 50; i++) {
      batch = (await get(t, `/api/v1/imports/${up.json().id}`)).json();
      if (batch!.status !== 'ANALYZING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(batch!.meta.balanceCheck.verified).toBe(1);
    expect(batch!.rows[0]).toMatchObject({ payerName: 'Nicole Baumann', balanceVerified: true, status: 'READY' });
    expect(batch!.rows[0].allocation[0].period).toBe('2026-07');
  });

  it('Sammelzahlung Wohnung + Parkplatz wird auf beide Verträge verteilt und verbucht', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const text = ["27.09.2026 Saldovortrag 5'000.00", "28.09.2026 Gutschrift 1'670.00 28.09.2026 6'670.00", 'Thomas Brunner', 'Mitteilung: Miete Oktober inkl. Parkplatz'].join('\n');
    const up = await app.inject({ method: 'POST', url: '/api/v1/imports/text', headers: auth, payload: { text } });
    let batch: { id: string; status: string; rows: { id: string; status: string; allocation: { period: string; amountCents: number; label?: string }[] }[] } | undefined;
    for (let i = 0; i < 50; i++) {
      batch = (await get(t, `/api/v1/imports/${up.json().id}`)).json();
      if (batch!.status !== 'ANALYZING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const row = batch!.rows[0];
    expect(row.status).toBe('READY');
    expect(row.allocation.map((a) => [a.label, a.amountCents]).sort()).toEqual([['1B', 155000], ['PP1', 12000]]);
    await app.inject({ method: 'POST', url: `/api/v1/imports/${batch!.id}/confirm-ready`, headers: auth, payload: {} });
    const posted = (await app.inject({ method: 'POST', url: `/api/v1/imports/${batch!.id}/post`, headers: auth, payload: {} })).json();
    expect(posted.failed).toEqual([]);
    const oct = (await get(t, '/api/v1/monthly/2026-10')).json();
    const brunner = oct.rows.filter((r: { tenant: { lastName: string } }) => r.tenant.lastName === 'Brunner');
    expect(brunner).toHaveLength(2);
    expect(brunner.every((r: { status: string }) => r.status === 'PAID')).toBe(true);
  });

  it('Jahresauszug: Parkplätze in Serie anlegen, frühere Monate nachtragen und korrekt zuordnen', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const props = (await get(t, '/api/v1/properties')).json();
    const propertyId = props[0].id;
    const bulk = await app.inject({ method: 'POST', url: `/api/v1/properties/${propertyId}/units/bulk`, headers: auth, payload: { prefix: 'TG', from: 1, to: 5, type: 'PARKING', targetRentCents: 12000 } });
    expect(bulk.json()).toEqual({ created: 5, skipped: [] });
    const again = await app.inject({ method: 'POST', url: `/api/v1/properties/${propertyId}/units/bulk`, headers: auth, payload: { prefix: 'TG', from: 4, to: 6, type: 'PARKING' } });
    expect(again.json()).toEqual({ created: 1, skipped: expect.arrayContaining(['TG4', 'TG5']) });
    const list = (await get(t, '/api/v1/properties')).json();
    expect(list[0].parkingCount).toBeGreaterThanOrEqual(6);
    const pr = await app.inject({ method: 'POST', url: `/api/v1/properties/${propertyId}/unit-prices`, headers: auth, payload: { overwrite: false, prices: [{ type: 'PARKING', targetRentCents: 13000 }] } });
    expect(pr.statusCode).toBe(200);
    const tg = (await get(t, `/api/v1/units?propertyId=${propertyId}`)).json();
    expect(tg.find((u: { label: string }) => u.label === 'TG6').targetRentCents).toBe(13000);
    expect(tg.find((u: { label: string }) => u.label === 'TG1').targetRentCents).toBe(12000);

    const unit = (await get(t, `/api/v1/units?propertyId=${propertyId}`)).json().find((u: { label: string }) => u.label === 'TG3');
    const tenant = (await app.inject({ method: 'POST', url: '/api/v1/tenants', headers: auth, payload: { firstName: 'Lena', lastName: 'Wyss' } })).json();
    const lease = await app.inject({ method: 'POST', url: '/api/v1/leases', headers: auth, payload: { unitId: unit.id, tenantId: tenant.id, startDate: '2025-06-01', netRentCents: 12000 } });
    expect(lease.statusCode).toBe(200);

    let saldo = 100000;
    const lines = ["31.12.2025 Saldovortrag 1'000.00"];
    for (let m = 1; m <= 6; m++) {
      saldo += 12000;
      const d = `02.${String(m).padStart(2, '0')}.2026`;
      lines.push(`${d} Gutschrift 120.00 ${d} ${(saldo / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`, 'Lena Wyss', 'Mitteilung: Parkplatz TG3');
    }
    const up = await app.inject({ method: 'POST', url: '/api/v1/imports/text', headers: auth, payload: { text: lines.join('\n') } });
    type B = { id: string; status: string; rows: { status: string; matchReasons: string[]; allocation: { period: string; amountCents: number }[] }[] };
    const wait = async (id: string) => {
      let b: B | undefined;
      for (let i = 0; i < 50; i++) {
        b = (await get(t, `/api/v1/imports/${id}`)).json();
        if (b!.status !== 'ANALYZING') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return b!;
    };
    let batch = await wait(up.json().id);
    expect(batch.rows).toHaveLength(6);
    expect(batch.rows.every((r) => r.allocation.length === 0 && r.matchReasons.some((x) => x.startsWith('Zahlung liegt vor dem Abrechnungsbeginn')))).toBe(true);

    const bf = await app.inject({ method: 'POST', url: `/api/v1/imports/${batch.id}/backfill-charges`, headers: auth, payload: {} });
    expect(bf.json()).toEqual({ updated: 1 });
    batch = await wait(batch.id);
    expect(batch.rows.map((r) => r.status)).toEqual(Array(6).fill('READY'));
    expect(batch.rows.map((r) => r.allocation.map((a) => a.period).join())).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    // Monate vor dem Auszug bleiben unberührt (keine künstlichen Rückstände)
    const dec = (await get(t, '/api/v1/monthly/2025-12')).json();
    expect(dec.rows.some((r: { tenant: { lastName: string } }) => r.tenant.lastName === 'Wyss')).toBe(false);
  });

  it('Zahlung «Zuordnung prüfen» automatisch zuordnen – fehlender Monat wird nachgetragen', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const props = (await get(t, '/api/v1/properties')).json();
    const bulk = await app.inject({ method: 'POST', url: `/api/v1/properties/${props[0].id}/units/bulk`, headers: auth, payload: { prefix: 'AZ', from: 1, to: 1, type: 'GARAGE' } });
    expect(bulk.statusCode).toBe(200);
    const unit = (await get(t, `/api/v1/units?propertyId=${props[0].id}`)).json().find((u: { label: string }) => u.label === 'AZ1');
    const tenant = (await app.inject({ method: 'POST', url: '/api/v1/tenants', headers: auth, payload: { firstName: 'Rita', lastName: 'Zuordnung' } })).json();
    const lease = (await app.inject({ method: 'POST', url: '/api/v1/leases', headers: auth, payload: { unitId: unit.id, tenantId: tenant.id, startDate: '2025-01-01', netRentCents: 10000 } })).json();
    // Zahlung vom März 2025 – Monatsmieten im Programm beginnen erst später
    const pay = (await app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth, payload: { leaseId: lease.id, bookingDate: '2025-03-03', amountCents: 10000, reference: 'Miete Garage März 2025', allocations: [] } })).json();
    expect(pay.status).toBe('REVIEW');
    const r = (await app.inject({ method: 'POST', url: `/api/v1/payments/${pay.id}/auto-assign`, headers: auth, payload: {} })).json();
    expect(r).toMatchObject({ added: 1, backfilled: 1, periods: ['2025-03'], status: 'ASSIGNED' });
    // Februar wurde NICHT nachgetragen (keine künstlichen Rückstände)
    const feb = (await get(t, '/api/v1/monthly/2025-02')).json();
    expect(feb.rows.some((x: { tenant: { lastName: string } }) => x.tenant.lastName === 'Zuordnung')).toBe(false);
    const all = (await app.inject({ method: 'POST', url: '/api/v1/payments/auto-assign-all', headers: auth, payload: {} })).json();
    expect(all).toHaveProperty('checked');
  });

  it('Import-Zeile: Betrag und Datum manuell korrigieren, wenn die Erkennung sie falsch gelesen hat', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const props = (await get(t, '/api/v1/properties')).json();
    const bulk = await app.inject({ method: 'POST', url: `/api/v1/properties/${props[0].id}/units/bulk`, headers: auth, payload: { prefix: 'KZ', from: 1, to: 1, type: 'APARTMENT' } });
    expect(bulk.statusCode).toBe(200);
    const unit = (await get(t, `/api/v1/units?propertyId=${props[0].id}`)).json().find((u: { label: string }) => u.label === 'KZ1');
    const tenant = (await app.inject({ method: 'POST', url: '/api/v1/tenants', headers: auth, payload: { firstName: 'Karin', lastName: 'Korrektur' } })).json();
    const lease = (await app.inject({ method: 'POST', url: '/api/v1/leases', headers: auth, payload: { unitId: unit.id, tenantId: tenant.id, startDate: '2025-06-01', netRentCents: 130000 } })).json();

    // Betrag/Datum bewusst falsch, Zahler unbekannt → keine automatische Zuordnung
    const up = await app.inject({ method: 'POST', url: '/api/v1/imports/text', headers: auth, payload: { text: "05.09.2026 Gutschrift 999'900.00\nFranz Unleserlich" } });
    expect(up.statusCode, up.body).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let batch: any;
    for (let i = 0; i < 50; i++) {
      batch = (await get(t, `/api/v1/imports/${up.json().id}`)).json();
      if (batch.status !== 'ANALYZING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const row = batch.rows[0];
    expect(row.status).toBe('UNMATCHED');
    expect(row.amountCents).toBe(99990000);

    // Betrag und Datum korrigieren und dem Mietvertrag zuordnen
    const fixed = await app.inject({
      method: 'PATCH', url: `/api/v1/imports/rows/${row.id}`, headers: auth,
      payload: { amountCents: 130000, bookingDate: '2026-09-05', leaseId: lease.id, confirmed: true },
    });
    expect(fixed.statusCode, fixed.body).toBe(200);
    const fixedRow = fixed.json();
    expect(fixedRow.amountCents).toBe(130000);
    expect(fixedRow.bookingDate.slice(0, 10)).toBe('2026-09-05');
    expect(fixedRow.status).toBe('READY');
    expect(fixedRow.matchReasons).toContain('Betrag/Datum manuell korrigiert');

    const posted = (await app.inject({ method: 'POST', url: `/api/v1/imports/${batch.id}/post`, headers: auth, payload: {} })).json();
    expect(posted.failed).toEqual([]);
    expect(posted.posted).toBe(1);
    const month = (await get(t, '/api/v1/monthly/2026-09')).json();
    expect(month.rows.find((x: { tenant: { lastName: string } }) => x.tenant.lastName === 'Korrektur').status).toBe('PAID');

    // Ein zweiter Import mit korrigiertem Betrag/Datum, der auf dieselbe (bereits verbuchte) Zahlung zeigt → Duplikat
    const up2 = await app.inject({ method: 'POST', url: '/api/v1/imports/text', headers: auth, payload: { text: "01.01.2026 Gutschrift 1.00\nFranz Unleserlich" } });
    let batch2: any;
    for (let i = 0; i < 50; i++) {
      batch2 = (await get(t, `/api/v1/imports/${up2.json().id}`)).json();
      if (batch2.status !== 'ANALYZING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const row2 = batch2.rows[0];
    const dupFix = await app.inject({
      method: 'PATCH', url: `/api/v1/imports/rows/${row2.id}`, headers: auth,
      payload: { amountCents: 130000, bookingDate: '2026-09-05' },
    });
    expect(dupFix.statusCode, dupFix.body).toBe(200);
    expect(dupFix.json().status).toBe('DUPLICATE');
  });

  it('«Selbst zuordnen»: einen Monat manuell hinzufügen, für den noch keine Sollstellung besteht', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const props = (await get(t, '/api/v1/properties')).json();
    const bulk = await app.inject({ method: 'POST', url: `/api/v1/properties/${props[0].id}/units/bulk`, headers: auth, payload: { prefix: 'MZ', from: 1, to: 1, type: 'APARTMENT' } });
    expect(bulk.statusCode).toBe(200);
    const unit = (await get(t, `/api/v1/units?propertyId=${props[0].id}`)).json().find((u: { label: string }) => u.label === 'MZ1');
    const tenant = (await app.inject({ method: 'POST', url: '/api/v1/tenants', headers: auth, payload: { firstName: 'Peter', lastName: 'Manuell' } })).json();
    const lease = (await app.inject({ method: 'POST', url: '/api/v1/leases', headers: auth, payload: { unitId: unit.id, tenantId: tenant.id, startDate: '2025-01-01', endDate: '2026-12-31', netRentCents: 90000 } })).json();

    // Monat weit in der Vergangenheit (vor dem bisherigen Abrechnungsbeginn) – wie bei einem Jahresauszug
    const past = await app.inject({ method: 'POST', url: '/api/v1/payments/ensure-open-charge', headers: auth, payload: { leaseId: lease.id, period: '2025-02' } });
    expect(past.statusCode, past.body).toBe(200);
    expect(past.json()).toMatchObject({ period: '2025-02', outstandingCents: 90000, label: 'MZ1' });
    // ein zweites Mal aufrufen darf nicht doppelt anlegen
    const again = await app.inject({ method: 'POST', url: '/api/v1/payments/ensure-open-charge', headers: auth, payload: { leaseId: lease.id, period: '2025-02' } });
    expect(again.json().id).toBe(past.json().id);
    const feb = (await get(t, '/api/v1/monthly/2025-02')).json();
    expect(feb.rows.filter((r: { tenant: { lastName: string } }) => r.tenant.lastName === 'Manuell')).toHaveLength(1);

    // Monat in der Zukunft
    const future = await app.inject({ method: 'POST', url: '/api/v1/payments/ensure-open-charge', headers: auth, payload: { leaseId: lease.id, period: '2026-11' } });
    expect(future.statusCode, future.body).toBe(200);
    expect(future.json().period).toBe('2026-11');

    // Nie vor Mietbeginn
    const beforeStart = await app.inject({ method: 'POST', url: '/api/v1/payments/ensure-open-charge', headers: auth, payload: { leaseId: lease.id, period: '2024-12' } });
    expect(beforeStart.statusCode).toBe(400);

    // Nie nach Vertragsende
    const afterEnd = await app.inject({ method: 'POST', url: '/api/v1/payments/ensure-open-charge', headers: auth, payload: { leaseId: lease.id, period: '2027-01' } });
    expect(afterEnd.statusCode).toBe(400);

    // Der so hinzugefügte Monat lässt sich normal einer Zahlung zuordnen
    const pay = (await app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth, payload: { leaseId: lease.id, bookingDate: '2025-02-10', amountCents: 90000, allocations: [{ chargeId: past.json().id, amountCents: 90000 }] } })).json();
    expect(pay.status).toBe('ASSIGNED');
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
