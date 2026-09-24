import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

/**
 * Zentraler Zugang zur Claude-API. Ohne ANTHROPIC_API_KEY sind die KI-Funktionen
 * deaktiviert – der Rest der Plattform funktioniert unverändert.
 *
 * Standard: Claude Opus 5 mit adaptivem Denken. Server-seitige Fallbacks
 * ("default") sind aktiviert: lehnt das Modell eine Anfrage ab, beantwortet
 * automatisch ein geeignetes Ersatzmodell dieselbe Anfrage.
 */
let client: Anthropic | null = null;

export function aiEnabled() {
  return !!config.ANTHROPIC_API_KEY;
}

export function ai(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new AppError(503, 'Die KI-Funktionen sind nicht eingerichtet. Bitte ANTHROPIC_API_KEY in apps/api/.env eintragen und den Server neu starten.', 'AI_DISABLED');
  }
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export const AI_BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];

export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Wandelt API-Fehler in verständliche Meldungen um. */
export function aiError(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof Anthropic.APIError) console.error(`[KI] Fehler ${e.status ?? ''}: ${e.message}`);
  if (e instanceof Anthropic.AuthenticationError) throw new AppError(503, 'Der KI-Schlüssel (ANTHROPIC_API_KEY) ist ungültig.', 'AI_AUTH');
  if (e instanceof Anthropic.RateLimitError) throw new AppError(429, 'Die KI ist gerade ausgelastet. Bitte in einer Minute erneut versuchen.', 'AI_RATE_LIMIT');
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) throw new AppError(402, 'Das KI-Guthaben ist aufgebraucht. Bitte unter console.anthropic.com → Billing Guthaben aufladen.', 'AI_CREDIT');
  if (e instanceof Anthropic.BadRequestError) throw new AppError(400, `Die KI konnte die Anfrage nicht verarbeiten: ${e.message}`, 'AI_BAD_REQUEST');
  if (e instanceof Anthropic.PermissionDeniedError) throw new AppError(503, 'Der KI-Schlüssel hat keine Berechtigung (Konto bei console.anthropic.com prüfen).', 'AI_PERMISSION');
  if (e instanceof Anthropic.NotFoundError) throw new AppError(503, `Das KI-Modell "${config.AI_MODEL}" ist für diesen Schlüssel nicht verfügbar. In apps/api/.env z. B. AI_MODEL=claude-sonnet-5 eintragen.`, 'AI_MODEL');
  if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AppError(504, 'Die KI hat zu lange gebraucht. Bitte ein kleineres Dokument (weniger Seiten) versuchen.', 'AI_TIMEOUT');
  if (e instanceof Anthropic.APIConnectionError) throw new AppError(503, 'Die KI ist nicht erreichbar (Internetverbindung prüfen).', 'AI_CONNECTION');
  if (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500)) throw new AppError(503, `Die KI ist gerade überlastet (${e.status}). Bitte in ein paar Minuten erneut versuchen.`, 'AI_OVERLOADED');
  if (e instanceof Anthropic.APIError) throw new AppError(502, `KI-Fehler (${e.status}): ${e.message}`, 'AI_ERROR');
  throw e;
}
