/**
 * API-Client mit kurzlebigem Access-Token (nur im Speicher) und
 * automatischer Erneuerung über das httpOnly-Refresh-Cookie.
 */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const APP = 'tenant';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function setAccessToken(t: string | null) {
  accessToken = t;
}

export async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'x-immo-app': APP } });
      if (!r.ok) return false;
      const data = await r.json();
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Options = { method?: string; body?: unknown; form?: FormData; raw?: boolean };

export async function api<T = unknown>(path: string, opts: Options = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'x-immo-app': APP };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, opts, false);
    window.dispatchEvent(new Event('immo:logout'));
  }
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    let details;
    try {
      const j = await res.json();
      msg = j.message ?? msg;
      details = j.details;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg, details);
  }
  if (opts.raw) return res as unknown as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** Datei herunterladen (mit Authentifizierung) */
export async function download(path: string, fallbackName = 'download') {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/);
  const name = m ? decodeURIComponent(m[1] ?? m[2]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openInline(path: string) {
  const res = await api<Response>(path + (path.includes('?') ? '&' : '?') + 'inline=1', { raw: true });
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}
