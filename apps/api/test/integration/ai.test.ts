import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * KI-Funktionen gegen einen nachgebauten Claude-API-Server (keine echten Kosten).
 * Geprüft werden Anfrageaufbau, Werkzeug-Schleife, Rollenrechte und das Anlegen
 * eines Vertrags aus den ausgelesenen Daten.
 */
const requests: Record<string, any>[] = [];
let mock: Server;

const CONTRACT = {
  tenant: { isCompany: false, firstName: 'Lea', lastName: 'Muster', companyName: null, email: 'lea.muster@example.ch', phone: '+41 79 000 11 22', street: 'Altweg 1', zip: '8000', city: 'Zürich', dateOfBirth: '1990-05-12', additionalTenants: null },
  property: { street: 'Bahnhofstrasse 5', zip: '8400', city: 'Winterthur' },
  unit: { label: 'A6', type: 'APARTMENT', floor: 'Attika', rooms: 2.5, areaM2: 58 },
  lease: { startDate: '2026-10-01', endDate: null, noticePeriodMonths: 3, netRentChf: 1650, utilitiesChf: 150, depositChf: 4950, dueDay: 1, paymentReference: null },
  landlord: 'Huber Immobilien AG',
  notes: 'Haustiere nur mit Zustimmung.',
  warnings: ['Telefonnummer schlecht lesbar'],
  confidence: 92,
};

const STATEMENT = {
  iban: 'CH93 0076 2011 6238 5295 7',
  currency: 'CHF',
  openingBalance: 1000,
  closingBalance: 2800,
  transactions: [
    { bookingDate: '2026-11-02', valueDate: '2026-11-02', amount: 1850, direction: 'credit', counterpartyName: 'Peter Müller', counterpartyIban: null, reference: 'Miete November Wohnung 3A', balanceAfter: 2850 },
    { bookingDate: '2026-11-03', valueDate: null, amount: 50, direction: 'debit', counterpartyName: 'Kontoführung', counterpartyIban: null, reference: null, balanceAfter: 2800 },
  ],
};

function sse(res: import('node:http').ServerResponse, text: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_mock' });
  const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`);
  ev('message_start', { message: { ...reply([], null as unknown as string), usage: { input_tokens: 10, output_tokens: 1 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  ev('message_stop', {});
  res.end();
}

function reply(content: unknown[], stop_reason: string) {
  return { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
}

beforeAll(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push({ ...body, _headers: req.headers });
      let out;
      if (body.output_config?.format?.schema?.properties?.transactions) {
        return sse(res, JSON.stringify(STATEMENT));
      }
      if (body.output_config?.format) {
        out = reply([{ type: 'text', text: JSON.stringify(CONTRACT) }], 'end_turn');
      } else {
        const last = body.messages[body.messages.length - 1];
        const hasResults = Array.isArray(last.content) && last.content.some((b: { type: string }) => b.type === 'tool_result');
        out = hasResults
          ? reply([{ type: 'text', text: 'Im **September** sind noch Mieten offen.' }], 'end_turn')
          : reply(
              [
                { type: 'tool_use', id: 'tu_1', name: 'monatsabschluss', input: { monat: '2026-09' } },
                { type: 'tool_use', id: 'tu_2', name: 'navigieren', input: { pfad: '/monatsabschluss/2026-09', titel: 'Monatsabschluss September' } },
              ],
              'tool_use',
            );
      }
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_mock' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.STORAGE_DIR = './storage-test';
  process.env.LOG_LEVEL = 'warn';
  process.env.LOGIN_RATE_LIMIT = '1000';
  process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret';
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
});
afterAll(async () => {
  await app?.close();
  mock?.close();
});

let app: Awaited<ReturnType<typeof import('../../src/app.js').buildApp>>;
const login = async (email: string, kind = 'admin') => {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-immo-app': kind }, payload: { email, password: 'Immo2026!demo' } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().accessToken as string;
};

describe('KI-Assistent', () => {
  it('ist standardmässig ausgeschaltet und lässt sich in den Einstellungen einschalten', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth })).json().assistant).toBe(false);
    const off = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers: auth, payload: { messages: [{ role: 'user', content: 'Hallo' }] } });
    expect(off.statusCode).toBe(403);
    const owner = await login('eigentuemer@immo.local');
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: { authorization: `Bearer ${owner}` }, payload: { settings: { assistantEnabled: true } } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth })).json().assistant).toBe(true);
  });

  it('ist aktiv und beantwortet Fragen über Werkzeuge mit Navigation', async () => {
    const t = await login('verwaltung@immo.local');
    expect((await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: { authorization: `Bearer ${t}` } })).json().enabled).toBe(true);
    const before = requests.length;
    const r = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers: { authorization: `Bearer ${t}` }, payload: { messages: [{ role: 'user', content: 'Wer hat noch nicht bezahlt?' }], page: '/' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().reply).toContain('September');
    expect(r.json().actions).toEqual([{ type: 'navigate', path: '/monatsabschluss/2026-09', label: 'Monatsabschluss September' }]);
    const [first, second] = requests.slice(before);
    expect(first.model).toBe('claude-opus-5');
    expect(first.fallbacks).toBe('default');
    expect(String(first._headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    const results = second.messages[second.messages.length - 1].content;
    expect(results[0].content).toContain('Müller'); // echte Daten aus dem Monatsabschluss
  });

  it('respektiert die Rolle: Hauswart erhält über den Assistenten keine Finanzdaten', async () => {
    const t = await login('hauswart@immo.local');
    const before = requests.length;
    const r = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers: { authorization: `Bearer ${t}` }, payload: { messages: [{ role: 'user', content: 'Wer hat noch nicht bezahlt?' }] } });
    expect(r.statusCode).toBe(200);
    const results = requests.slice(before)[1].messages.at(-1).content;
    expect(results[0].content).toContain('Keine Berechtigung');
    expect(results[0].content).not.toContain('Müller');
  });

  it('ist für Mieter gesperrt', async () => {
    const t = await login('mieter@immo.local', 'tenant');
    const r = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers: { authorization: `Bearer ${t}` }, payload: { messages: [{ role: 'user', content: 'Zeig mir alle Mieter' }] } });
    expect(r.statusCode).toBe(403);
  });
});

describe('Mietvertrag aus PDF', () => {
  it('liest den Vertrag aus, ordnet Immobilie/Wohnung zu und legt nach Bestätigung alles an', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const boundary = '----immocontract';
    const pdf = readFileSync(path.resolve(import.meta.dirname, '../../../../samples/kontoauszug-2026-09.pdf'));
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Mietvertrag Muster.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const before = requests.length;
    const ex = await app.inject({ method: 'POST', url: '/api/v1/leases/extract', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(ex.statusCode, ex.body).toBe(200);
    const { documentId, data, match } = ex.json();
    expect(data.tenant.lastName).toBe('Muster');
    expect(match.propertyId).toBeTruthy();
    expect(match.unitId).toBeTruthy(); // Wohnung A6 im Wohnpark Lindenhof
    expect(match.unitOccupied).toBe(false);
    const sent = requests[before];
    expect(sent.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/leases/from-contract',
      headers: auth,
      payload: {
        documentId,
        tenant: { firstName: 'Lea', lastName: 'Muster', email: 'lea.muster@example.ch' },
        unitId: match.unitId,
        lease: { startDate: '2026-10-01', netRentCents: 165000, utilitiesCents: 15000, depositCents: 495000, noticePeriodMonths: 3, dueDay: 1 },
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const lease = (await app.inject({ method: 'GET', url: `/api/v1/leases/${created.json().id}`, headers: auth })).json();
    expect(lease.tenant.lastName).toBe('Muster');
    expect(lease.unit.label).toBe('A6');
    expect(lease.charges.map((c: { period: string }) => c.period)).toContain('2026-10');
    expect(lease.documents.map((d: { id: string }) => d.id)).toContain(documentId);

    // Zweiter Vertrag für dieselbe Wohnung → Konflikt, ohne einen Mieter anzulegen
    const tenantsBefore = (await app.inject({ method: 'GET', url: '/api/v1/tenants?status=all', headers: auth })).json().length;
    const dup = await app.inject({ method: 'POST', url: '/api/v1/leases/from-contract', headers: auth, payload: { documentId, tenant: { lastName: 'Doppelt' }, unitId: match.unitId, lease: { startDate: '2026-11-01', netRentCents: 100000 } } });
    expect(dup.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/tenants?status=all', headers: auth })).json().length).toBe(tenantsBefore);
  });
});

describe('Kontoauszug mit KI', () => {
  it('liest ein unbekanntes Bankformat per KI, prüft per Saldo und speichert das Ergebnis zwischen', async () => {
    const t = await login('verwaltung@immo.local');
    const auth = { authorization: `Bearer ${t}` };
    const before = requests.length;
    const up = await app.inject({ method: 'POST', url: '/api/v1/imports/text', headers: auth, payload: { text: 'Kontobewegungen Muster-Bank\nPos 1 · Eingang · siehe Beleg\nPos 2 · Spesen' } });
    expect(up.statusCode, up.body).toBe(200);
    const wait = async () => {
      let b: any;
      for (let i = 0; i < 50; i++) {
        b = (await app.inject({ method: 'GET', url: `/api/v1/imports/${up.json().id}`, headers: auth })).json();
        if (b.status !== 'ANALYZING') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return b;
    };
    let b = await wait();
    expect(b.meta.ai).toBeFalsy(); // kostenlos: ohne Klick keine KI
    expect(requests.length - before).toBe(0);
    await app.inject({ method: 'POST', url: `/api/v1/imports/${b.id}/reanalyze`, headers: auth, payload: { ai: true } });
    b = await wait();
    expect(b.meta.ai).toBe(true);
    expect(b.meta.balanceCheck).toEqual({ verified: 2, checked: 2, corrected: 0 });
    expect(b.rows).toHaveLength(2);
    const credit = b.rows.find((r: any) => r.isCredit);
    expect(credit.payerName).toBe('Peter Müller');
    expect(credit.amountCents).toBe(185000);
    expect(credit.balanceVerified).toBe(true);
    expect(b.rows.find((r: any) => !r.isCredit).status).toBe('IGNORED');
    const aiCalls = requests.length - before;
    expect(aiCalls).toBe(1);
    expect(requests[requests.length - 1].stream).toBe(true);

    // erneut analysieren: Ergebnis aus dem Zwischenspeicher, kein weiterer KI-Aufruf
    await app.inject({ method: 'POST', url: `/api/v1/imports/${b.id}/reanalyze`, headers: auth, payload: {} });
    const again = await wait();
    expect(again.rows).toHaveLength(2);
    expect(requests.length - before).toBe(1);
  });
});
