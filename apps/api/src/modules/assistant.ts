import type { FastifyInstance, FastifyRequest } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ROLE_LABELS, formatDate, toPeriod } from '@immo/shared';
import { config } from '../config.js';
import { parse } from '../lib/http.js';
import { requirePermission } from '../auth/context.js';
import { AI_BETAS, ai, aiEnabled, aiError, textOf } from '../services/ai.js';

/**
 * KI-Assistent der Verwaltungs-App.
 * - Beantwortet Fragen zu Daten (Mieten, Zahlungen, Mängel, Verträge …) über
 *   Lese-Werkzeuge, die intern die normale API mit der Anmeldung des Benutzers
 *   aufrufen. Dadurch gelten exakt dieselben Rollenrechte wie in der Oberfläche.
 * - Führt durch die Software und kann zu Seiten navigieren.
 * - Ändert oder verbucht nie selbst etwas.
 */

const ROUTES = `Seiten der Verwaltungs-App (für das Werkzeug "navigieren"):
/ – Dashboard (Kennzahlen, Diagramme, offene Mängel, Termine)
/immobilien – Liste der Immobilien · /immobilien/{id} – Immobilie mit Wohnungen, Mängeln, Dokumenten
/objekte/{id} – einzelne Wohnung / Mietobjekt
/mieter – Mieterliste · /mieter/{id} – Mieterprofil mit Mieterkonto und Zahlungshistorie
/mietvertraege – Verträge (Button "Aus Mietvertrag (PDF)" liest einen Vertrag automatisch ein) · /mietvertraege/{id}
/zahlungen – alle Zahlungen · /zahlungen/{id} – Zahlungsdetail (Zuordnung ändern, stornieren)
/zahlungen/import – Kontoauszug importieren (PDF, Scan, Foto oder Text einfügen), Vorschau, bestätigen, verbuchen
/monatsabschluss/{YYYY-MM} – Soll/Ist/Offen eines Monats, Status je Mieter
/finanzen – Einnahmen, Ausgaben, Ergebnis, Ausgabe erfassen · /berichte – Excel-Auswertung, Mieterspiegel
/maengel – Mängel/Tickets · /maengel/{id} – Ticket (Status, Hauswart, Handwerker, Termin, Kosten)
/dokumente – Dokumentenablage · /nachrichten – Kommunikation · /aufgaben – Aufgaben · /termine – Termine
/benachrichtigungen – Benachrichtigungen · /automatisierung – Automatisierungen & gelernte Zahler
/protokoll – Änderungsprotokoll · /einstellungen – Organisation, Benutzer & Rollen, Dienstleister, Excel-Sync, Mitteilungen an Mieter`;

const SYSTEM = `Du bist der Assistent in "IMMO", einer Schweizer Software für Immobilienverwaltung. Du hilfst Eigentümern und Verwaltungsmitarbeitenden, ihre Fragen zu beantworten und sich in der Software zurechtzufinden.

So arbeitest du:
- Antworte auf Deutsch (Schweizer Schreibweise mit "ss"), kurz, freundlich und konkret. Beträge als CHF 1'850.00.
- Zahlen, Namen und Stände holst du immer mit den Werkzeugen aus dem System – nie raten oder erfinden. Wenn ein Werkzeug keine Berechtigung liefert, sag, dass die Rolle des Benutzers diese Daten nicht sehen darf.
- Du kannst nichts ändern, verbuchen oder löschen. Erkläre stattdessen in wenigen Schritten, wo und wie der Benutzer es selbst erledigt, und biete an, ihn mit "navigieren" hinzuführen.
- Möchte der Benutzer irgendwohin ("zeig mir", "öffne", "bring mich zu"), rufe "navigieren" auf. Bei IDs aus Werkzeug-Ergebnissen kannst du direkt auf die Detailseite führen.
- Halte Antworten kurz: wenige Sätze oder eine knappe Liste. Keine Tabellen mit mehr als 8 Zeilen – verweise sonst auf die passende Seite.
- Latenz ist wichtig: beginne deine sichtbare Antwort ohne lange Vorrede.

Wichtige Abläufe:
- Kontoauszug verbuchen: Zahlungen importieren → Datei (PDF/Scan/Foto) hochladen oder Text einfügen → Vorschau prüfen, unsichere Zeilen korrigieren → "Alle sicheren bestätigen" → "Alle bestätigten Zahlungen verbuchen". Die Saldo-Kontrolle bestätigt Beträge gegen den Kontosaldo.
- Neuer Mietvertrag: Mietverträge → "Aus Mietvertrag (PDF)" (die KI liest Mieter, Wohnung, Miete, Daten aus; danach prüfen und bestätigen) oder "Mietvertrag erfassen".
- Mangel erfassen/bearbeiten: Mängel → Ticket öffnen → Status, Hauswart, Handwerker, Termin, Kosten.
- Mieter-App-Zugang: Mieterprofil → "Mieter-App-Zugang erstellen".

${ROUTES}`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'suche', description: 'Globale Suche über Mieter, Wohnungen, Immobilien, Zahlungen, Dokumente, Tickets und Nachrichten.', input_schema: { type: 'object', properties: { begriff: { type: 'string', description: 'Suchbegriff, mind. 2 Zeichen' } }, required: ['begriff'] } },
  { name: 'dashboard', description: 'Aktuelle Kennzahlen: Soll/Ist/offene Miete im laufenden Monat, Überfälliges, Anzahl Immobilien/Objekte/Verträge, offene Mängel/Aufgaben, auslaufende Verträge, offene Forderungen je Mieter.', input_schema: { type: 'object', properties: {} } },
  { name: 'monatsabschluss', description: 'Soll, Eingang, Offen und Status jedes Mieters für einen Monat. Beantwortet z. B. "wer hat noch nicht bezahlt".', input_schema: { type: 'object', properties: { monat: { type: 'string', description: 'YYYY-MM, Standard: aktueller Monat' } } } },
  { name: 'mieter', description: 'Mieterliste mit Wohnung, Monatsmiete und offenem Betrag (optional gefiltert).', input_schema: { type: 'object', properties: { suche: { type: 'string' } } } },
  { name: 'mieterkonto', description: 'Details und vollständiges Mieterkonto (alle Monate Soll/Ist, Zahlungen, Saldo) eines Mieters.', input_schema: { type: 'object', properties: { mieterId: { type: 'string' } }, required: ['mieterId'] } },
  { name: 'zahlungen', description: 'Zahlungen suchen/filtern. Status: ASSIGNED, PARTIAL, OVERPAID, UNCLEAR, REVIEW, REVERSED.', input_schema: { type: 'object', properties: { suche: { type: 'string' }, status: { type: 'string' } } } },
  { name: 'importe', description: 'Letzte Kontoauszug-Importe mit Anzahl bereiter, zu prüfender und unklarer Zahlungen.', input_schema: { type: 'object', properties: {} } },
  { name: 'maengel', description: 'Mängel/Tickets. nurOffene=true liefert offene Tickets.', input_schema: { type: 'object', properties: { nurOffene: { type: 'boolean' }, suche: { type: 'string' } } } },
  { name: 'vertraege', description: 'Mietverträge. auslaufendInTagen filtert Verträge, die bald enden.', input_schema: { type: 'object', properties: { auslaufendInTagen: { type: 'number' }, status: { type: 'string', description: 'ACTIVE,TERMINATED,ENDED,DRAFT' } } } },
  { name: 'finanzen', description: 'Jahresübersicht: Einnahmen, Ausgaben, Ergebnis, pro Monat, pro Immobilie, Ausgaben nach Kategorie.', input_schema: { type: 'object', properties: { jahr: { type: 'number' } } } },
  { name: 'aufgaben_termine', description: 'Offene Aufgaben und kommende Termine.', input_schema: { type: 'object', properties: {} } },
  { name: 'navigieren', description: 'Öffnet eine Seite der Verwaltungs-App für den Benutzer.', input_schema: { type: 'object', properties: { pfad: { type: 'string', description: 'z. B. /monatsabschluss/2026-09 oder /mieter/{id}' }, titel: { type: 'string', description: 'Kurzer Name der Seite für den Button' } }, required: ['pfad', 'titel'] } },
];

const ALLOWED_PATH = /^\/(immobilien(\/[\w-]+)?|objekte\/[\w-]+|mieter(\/[\w-]+)?|mietvertraege(\/[\w-]+)?|zahlungen(\/import(\/[\w-]+)?|\/[\w-]+)?|monatsabschluss(\/\d{4}-\d{2})?|finanzen|berichte|maengel(\/[\w-]+)?|dokumente|nachrichten(\/[\w-]+)?|aufgaben|termine|benachrichtigungen|automatisierung|protokoll|einstellungen)?$/;

type Action = { type: 'navigate'; path: string; label: string };

function compact(value: unknown, max = 14000): string {
  const json = JSON.stringify(value, (_k, v) => (v === null || (Array.isArray(v) && v.length === 0) ? undefined : v));
  return json.length > max ? `${json.slice(0, max)} … [gekürzt – für alle Einträge die passende Seite öffnen]` : json;
}

export async function assistantRoutes(app: FastifyInstance) {
  app.get('/status', async () => ({ enabled: aiEnabled(), model: aiEnabled() ? config.AI_MODEL : null }));

  app.post('/chat', { preHandler: requirePermission('dashboard:read'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(
      z.object({
        messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).min(1).max(40),
        page: z.string().max(200).optional(),
      }),
      req.body,
    );
    const auth = req.headers.authorization!;
    const actions: Action[] = [];

    // Werkzeug ausführen: interner API-Aufruf mit der Anmeldung des Benutzers
    const call = async (url: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: auth } });
      if (res.statusCode === 403) return 'Keine Berechtigung: Die Rolle des Benutzers darf diese Daten nicht sehen.';
      if (res.statusCode >= 400) return `Fehler ${res.statusCode}: ${res.json().message ?? ''}`;
      return compact(res.json());
    };
    const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
      const q = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString();
      switch (name) {
        case 'suche':
          return call(`/search?${q({ q: input.begriff })}`);
        case 'dashboard':
          return call('/dashboard');
        case 'monatsabschluss':
          return call(`/monthly/${/^\d{4}-\d{2}$/.test(String(input.monat ?? '')) ? input.monat : toPeriod(new Date())}`);
        case 'mieter':
          return call(`/tenants?${q({ search: input.suche, status: 'all' })}`);
        case 'mieterkonto': {
          const id = encodeURIComponent(String(input.mieterId ?? ''));
          return `Stammdaten: ${await call(`/tenants/${id}`)}\nKonto: ${await call(`/tenants/${id}/account`)}`;
        }
        case 'zahlungen':
          return call(`/payments?${q({ search: input.suche, status: input.status, pageSize: 30 })}`);
        case 'importe':
          return call('/imports');
        case 'maengel':
          return call(`/damages?${q({ open: input.nurOffene ? 'true' : undefined, search: input.suche })}`);
        case 'vertraege':
          return call(`/leases?${q({ expiringDays: input.auslaufendInTagen, status: input.status ?? (input.auslaufendInTagen ? undefined : 'ACTIVE,TERMINATED') })}`);
        case 'finanzen':
          return call(`/finance/summary?${q({ year: input.jahr ?? new Date().getFullYear() })}`);
        case 'aufgaben_termine':
          return `Aufgaben: ${await call('/tasks?status=OPEN,IN_PROGRESS')}\nTermine: ${await call(`/appointments?from=${new Date().toISOString()}`)}`;
        case 'navigieren': {
          const path = String(input.pfad ?? '');
          if (!ALLOWED_PATH.test(path)) return `Unbekannte Seite ${path}. Erlaubt sind nur die Seiten aus der Liste.`;
          actions.push({ type: 'navigate', path, label: String(input.titel ?? 'Seite öffnen') });
          return `Seite ${path} wird geöffnet.`;
        }
        default:
          return `Unbekanntes Werkzeug ${name}`;
      }
    };

    const context = `Benutzer: ${req.user.firstName} ${req.user.lastName} (${ROLE_LABELS[req.user.role]}). Heute: ${formatDate(new Date())}, aktueller Monat ${toPeriod(new Date())}.${body.page ? ` Aktuell geöffnete Seite: ${body.page}` : ''}`;
    const messages: Anthropic.Beta.BetaMessageParam[] = body.messages.map((m) => ({ role: m.role, content: m.content }));
    const last = messages[messages.length - 1];
    if (last.role !== 'user') throw new Error('Letzte Nachricht muss vom Benutzer stammen');
    last.content = `${context}\n\n${last.content as string}`;

    try {
      for (let step = 0; step < 8; step++) {
        const response = await ai().beta.messages.create({
          model: config.AI_MODEL,
          max_tokens: 16000,
          betas: AI_BETAS,
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          tools: TOOLS,
          messages,
        });
        if (response.stop_reason === 'refusal') return { reply: 'Dazu kann ich leider nicht helfen.', actions };
        if (response.stop_reason !== 'tool_use') return { reply: textOf(response) || 'Erledigt.', actions };

        messages.push({ role: 'assistant', content: response.content });
        const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        const results = await Promise.all(
          uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
            try {
              return { type: 'tool_result', tool_use_id: u.id, content: await run(u.name, (u.input ?? {}) as Record<string, unknown>) };
            } catch (e) {
              return { type: 'tool_result', tool_use_id: u.id, content: `Fehler: ${(e as Error).message}`, is_error: true };
            }
          }),
        );
        messages.push({ role: 'user', content: results });
      }
      return { reply: 'Die Anfrage war zu umfangreich. Bitte stellen Sie die Frage etwas konkreter.', actions };
    } catch (e) {
      aiError(e);
    }
  });
}

export type { FastifyRequest };
