import { Building2, FileText, Home, MessageSquare, Search, Sparkles, User, Wallet, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { chf, formatDate, tenantName } from '@/lib/format';

interface Results {
  tenants: { id: string; firstName: string | null; lastName: string | null; companyName: string | null; leases: { unit: { label: string; property: { name: string } } }[] }[];
  units: { id: string; label: string; property: { name: string } }[];
  properties: { id: string; name: string; street: string; city: string }[];
  payments: { id: string; number: number; bookingDate: string; amountCents: number; payerName: string | null }[];
  documents: { id: string; name: string; category: string }[];
  tickets: { id: string; ticketNumber: number; title: string }[];
  messages: { id: string; body: string; conversation: { id: string; subject: string } }[];
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<Results>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });

  const { data: ai } = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ enabled: boolean }>('/ai/status'), staleTime: 300_000 });
  const ask = () => {
    window.dispatchEvent(new CustomEvent('immo:ask', { detail: q.trim() }));
    setOpen(false);
    setQ('');
  };
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };

  const groups: { label: string; icon: ReactNode; items: { key: string; title: string; sub?: string; to: string }[] }[] = data
    ? [
        { label: 'Mieter', icon: <User className="h-4 w-4" />, items: data.tenants.map((t) => ({ key: t.id, title: tenantName(t), sub: t.leases.map((l) => `${l.unit.property.name} · ${l.unit.label}`).join(', '), to: `/mieter/${t.id}` })) },
        { label: 'Wohnungen', icon: <Home className="h-4 w-4" />, items: data.units.map((u) => ({ key: u.id, title: `Wohnung ${u.label}`, sub: u.property.name, to: `/objekte/${u.id}` })) },
        { label: 'Immobilien', icon: <Building2 className="h-4 w-4" />, items: data.properties.map((p) => ({ key: p.id, title: p.name, sub: `${p.street}, ${p.city}`, to: `/immobilien/${p.id}` })) },
        { label: 'Zahlungen', icon: <Wallet className="h-4 w-4" />, items: data.payments.map((p) => ({ key: p.id, title: `#${p.number} · ${chf(p.amountCents)}`, sub: `${formatDate(p.bookingDate)} · ${p.payerName ?? ''}`, to: `/zahlungen/${p.id}` })) },
        { label: 'Dokumente', icon: <FileText className="h-4 w-4" />, items: data.documents.map((d) => ({ key: d.id, title: d.name, to: `/dokumente?search=${encodeURIComponent(d.name)}` })) },
        { label: 'Tickets', icon: <Wrench className="h-4 w-4" />, items: data.tickets.map((t) => ({ key: t.id, title: `#${t.ticketNumber} ${t.title}`, to: `/maengel/${t.id}` })) },
        { label: 'Nachrichten', icon: <MessageSquare className="h-4 w-4" />, items: data.messages.map((m) => ({ key: m.id, title: m.conversation.subject, sub: m.body.slice(0, 80), to: `/nachrichten/${m.conversation.id}` })) },
      ].filter((g) => g.items.length)
    : [];

  return (
    <div className="relative max-w-xl" ref={ref}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // Enter bei einer Frage/Mehrwort-Eingabe ohne Treffer → Assistent
          if (e.key === 'Enter' && ai?.enabled && q.trim().length > 2 && (!data || groups.length === 0 || /\?$|^(wer|was|wie|wo|wann|welche|zeig|öffne|bring)\b/i.test(q.trim()))) ask();
        }}
        placeholder="Suchen: Mieter, Wohnung, Zahlung, Dokument, Ticket …"
        className="input rounded-lg border-slate-200 bg-slate-50 pr-12 pl-9 focus:bg-white"
      />
      <kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400 sm:block">⌘K</kbd>
      {open && debounced.length >= 2 && (
        <div className="absolute z-50 mt-2 max-h-[70vh] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {isFetching && !data && <p className="px-3 py-4 text-sm text-slate-500">Suche …</p>}
          {data && groups.length === 0 && <p className="px-3 pt-3 pb-1 text-sm text-slate-500">Keine Treffer für „{debounced}“.</p>}
          {ai?.enabled && data && (
            <button onClick={ask} className="mb-1 flex w-full items-center gap-3 rounded-lg bg-brand-50/60 px-3 py-2.5 text-left hover:bg-brand-50">
              <Sparkles className="h-4 w-4 text-brand-600" />
              <span className="text-sm text-slate-800">„{q.trim()}“ <span className="font-medium text-brand-700">den Assistenten fragen</span></span>
            </button>
          )}
          {groups.map((g) => (
            <div key={g.label} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-slate-400 uppercase">{g.label}</p>
              {g.items.map((it) => (
                <button key={it.key} onClick={() => go(it.to)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                  <span className="text-slate-400">{g.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-800">{it.title}</span>
                    {it.sub && <span className="block truncate text-xs text-slate-500">{it.sub}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
