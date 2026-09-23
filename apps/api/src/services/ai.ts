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
  if (e instanceof Anthropic.AuthenticationError) throw new AppError(503, 'Der KI-Schlüssel (ANTHROPIC_API_KEY) ist ungültig.', 'AI_AUTH');
  if (e instanceof Anthropic.RateLimitError) throw new AppError(429, 'Die KI ist gerade ausgelastet. Bitte in einer Minute erneut versuchen.', 'AI_RATE_LIMIT');
  if (e instanceof Anthropic.BadRequestError) throw new AppError(400, `Die KI konnte die Anfrage nicht verarbeiten: ${e.message}`, 'AI_BAD_REQUEST');
  if (e instanceof Anthropic.APIConnectionError) throw new AppError(503, 'Die KI ist nicht erreichbar (Internetverbindung prüfen).', 'AI_CONNECTION');
  if (e instanceof Anthropic.APIError) throw new AppError(502, `KI-Fehler (${e.status}). Bitte später erneut versuchen.`, 'AI_ERROR');
  throw e;
}
