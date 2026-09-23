import clsx from 'clsx';
import { ArrowRight, Loader2, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Msg { role: 'user' | 'assistant'; content: string; actions?: { type: 'navigate'; path: string; label: string }[]; error?: boolean }
const STORAGE_KEY = 'immo-assistant';

const SUGGESTIONS = ['Wer hat diesen Monat noch nicht bezahlt?', 'Welche Mängel sind offen?', 'Wie verbuche ich einen Kontoauszug?', 'Welche Verträge laufen bald aus?'];

/** Minimaler Markdown-Renderer: **fett**, Listen, Zeilenumbrüche */
function renderText(text: string): ReactNode {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length} className="my-1">{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return blocks;
}

export function AssistantWidget() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ enabled: boolean; assistant: boolean }>('/ai/status'), staleTime: 300_000 });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* ignore */
    }
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, open]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  // Fragen aus der Suchleiste übernehmen
  const sendRef = useRef<(t: string) => void>(() => undefined);
  useEffect(() => {
    const onAsk = (e: Event) => {
      setOpen(true);
      sendRef.current((e as CustomEvent<string>).detail);
    };
    window.addEventListener('immo:ask', onAsk);
    return () => window.removeEventListener('immo:ask', onAsk);
  }, []);

  // Nur anzeigen, wenn der Assistent in den Einstellungen eingeschaltet ist
  if (!can('dashboard:read') || !status?.assistant) return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const history = next.filter((m) => !m.error).slice(-20).map(({ role, content }) => ({ role, content }));
      const r = await api<{ reply: string; actions: Msg['actions'] }>('/ai/chat', { body: { messages: history, page: location.pathname } });
      setMessages([...next, { role: 'assistant', content: r.reply, actions: r.actions }]);
      const nav = r.actions?.find((a) => a.type === 'navigate');
      if (nav) navigate(nav.path);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  sendRef.current = send;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-ink py-3 pr-5 pl-4 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800"
          aria-label="KI-Assistent öffnen"
        >
          <Sparkles className="h-4 w-4" /> Fragen
        </button>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex h-[min(620px,calc(100vh-24px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]">
          <header className="flex items-center justify-between bg-ink px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10"><Sparkles className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-semibold">IMMO Assistent</p>
                <p className="text-[11px] text-slate-400">Beantwortet Fragen · führt Sie zur richtigen Seite</p>
              </div>
            </div>
            <div className="flex gap-1">
              {messages.length > 0 && <button onClick={() => setMessages([])} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Neues Gespräch"><RotateCcw className="h-4 w-4" /></button>}
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Schliessen"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4 text-sm">
            {status && !status.enabled && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Der Assistent ist noch nicht eingerichtet. Tragen Sie in <code>apps/api/.env</code> den Wert <code>ANTHROPIC_API_KEY=…</code> ein (Schlüssel von console.anthropic.com) und starten Sie die Software neu.
              </div>
            )}
            {messages.length === 0 && (
              <div>
                <p className="text-slate-700">Grüezi! Ich beantworte Fragen zu Ihren Immobilien, Mietern, Zahlungen und Mängeln und zeige Ihnen, wo Sie was erledigen.</p>
                <div className="mt-3 flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-slate-700 hover:border-brand-300 hover:bg-brand-50/50">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[88%] rounded-2xl px-3.5 py-2', m.role === 'user' ? 'rounded-br-sm bg-brand-600 text-white' : m.error ? 'rounded-bl-sm bg-red-50 text-red-800 ring-1 ring-red-200' : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200')}>
                  {m.role === 'assistant' ? renderText(m.content) : <p className="whitespace-pre-line">{m.content}</p>}
                  {m.actions?.map((a) => (
                    <button key={a.path} onClick={() => navigate(a.path)} className="mt-2 flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
                      {a.label} <ArrowRight className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Einen Moment, ich schaue nach …</div>
            )}
            <div ref={end} />
          </div>

          <div className="border-t border-slate-100 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Frage stellen … z. B. «Was schuldet Frau Keller?»"
                className="input max-h-28 resize-none"
              />
              <button onClick={() => send(input)} disabled={!input.trim() || busy} className="rounded-lg bg-brand-600 p-2.5 text-white hover:bg-brand-700 disabled:opacity-40" aria-label="Senden"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">Der Assistent liest nur Daten, die Sie sehen dürfen, und ändert nichts selbst. KI kann sich irren – wichtige Angaben bitte prüfen.</p>
          </div>
        </div>
      )}
    </>
  );
}
