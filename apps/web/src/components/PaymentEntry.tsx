import { ArrowLeft, Check, CheckCircle2, ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_METHODS } from '@immo/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { chf, formatPeriod, fromCents, isoDate, tenantName, toCents } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui';

interface OpenItem { chargeId: string; leaseId: string; period: string; label: string; property: string; outstandingCents: number; status: string }
interface TenantOpen {
  tenant: TenantRef & { id: string };
  leases: { id: string; label: string; property: string; monthlyCents: number; active: boolean }[];
  open: OpenItem[];
  openCents: number;
}

/**
 * Zahlung erfassen in drei Schritten: Mieter wählen → Monate ankreuzen → verbuchen.
 * Nach dem Verbuchen geht es direkt mit dem nächsten Mieter weiter.
 */
export function PaymentEntry({ onClose, tenantId: initialTenant, chargeId: initialCharge }: { onClose: () => void; tenantId?: string; chargeId?: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['payments', 'open-items'], queryFn: () => api<TenantOpen[]>('/payments/open-items') });
  const [tenantId, setTenantId] = useState<string | null>(initialTenant ?? null);
  const [done, setDone] = useState<string[]>([]);
  const current = data?.find((t) => t.tenant.id === tenantId) ?? null;

  return (
    <Modal open onClose={onClose} size="lg" title={current ? `Zahlung von ${tenantName(current.tenant)}` : 'Zahlung erfassen'}>
      {done.length > 0 && (
        <div className="mb-4 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          {done.map((d, i) => <p key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{d}</p>)}
        </div>
      )}
      {isLoading || !data ? <Loading /> : current ? (
        <EntryForm
          key={current.tenant.id}
          item={current}
          initialCharge={initialCharge}
          onBack={() => setTenantId(null)}
          onDone={(text) => { setDone([...done, text]); setTenantId(null); }}
          onClose={onClose}
        />
      ) : (
        <TenantPicker items={data} onPick={setTenantId} onClose={onClose} />
      )}
    </Modal>
  );
}

function TenantPicker({ items, onPick, onClose }: { items: TenantOpen[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = items.filter((t) => {
    const hay = `${tenantName(t.tenant)} ${t.leases.map((l) => `${l.property} ${l.label}`).join(' ')}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Wer hat bezahlt?</p>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input autoFocus className="pl-9" placeholder="Name, Wohnung oder Parkplatz suchen …" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && list[0] && onPick(list[0].tenant.id)} />
      </div>
      {!list.length ? <EmptyState title="Kein Mieter gefunden" /> : (
        <ul className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {list.map((t) => (
            <li key={t.tenant.id}>
              <button onClick={() => onPick(t.tenant.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{tenantName(t.tenant)}</p>
                  <p className="truncate text-xs text-slate-500">{t.leases.filter((l) => l.active).map((l) => `${l.property} · ${l.label}`).join(', ') || 'Vertrag beendet'}</p>
                </div>
                {t.openCents > 0 ? (
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-red-700 tabular-nums">{chf(t.openCents)}</p>
                    <p className="text-xs text-slate-500">{[...new Set(t.open.map((o) => formatPeriod(o.period)))].slice(0, 2).join(', ')}{new Set(t.open.map((o) => o.period)).size > 2 ? ' …' : ''}</p>
                  </div>
                ) : <Badge tone="green">nichts offen</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Fertig</Button></div>
    </>
  );
}

function EntryForm({ item, initialCharge, onBack, onDone, onClose }: { item: TenantOpen; initialCharge?: string; onBack: () => void; onDone: (text: string) => void; onClose: () => void }) {
  // Vorauswahl: gewählter Monat, sonst der älteste offene Monat (alle Objekte, z. B. Wohnung + Parkplatz)
  const oldest = item.open[0]?.period;
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialCharge ? [initialCharge] : item.open.filter((o) => o.period === oldest).map((o) => o.chargeId)));
  const [amountTouched, setAmountTouched] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [more, setMore] = useState(false);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const selected = item.open.filter((o) => checked.has(o.chargeId));
  const selectedSum = selected.reduce((s, o) => s + o.outstandingCents, 0);
  const monthly = item.leases.filter((l) => l.active).reduce((s, l) => s + l.monthlyCents, 0);
  const amountCents = amountTouched ? toCents(amountText) : selectedSum || 0;

  // Betrag auf die angekreuzten Monate verteilen (älteste zuerst); Rest = Guthaben
  const plan = useMemo(() => {
    let rest = amountCents;
    const lines: { chargeId: string; amountCents: number }[] = [];
    for (const o of selected) {
      if (rest <= 0) break;
      const part = Math.min(rest, o.outstandingCents);
      lines.push({ chargeId: o.chargeId, amountCents: part });
      rest -= part;
    }
    return { lines, remainder: rest };
  }, [amountCents, selected]);

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };
  const leaseId = selected[0]?.leaseId ?? item.leases.find((l) => l.active)?.id ?? item.leases[0]?.id ?? null;
  const name = tenantName(item.tenant);

  const save = useAction(
    () => api('/payments', { body: { leaseId, bookingDate: date, amountCents, method, payerName: name, reference: reference || null, note: note || null, allocations: plan.lines } }),
    {
      invalidate: [['payments'], ['dashboard'], ['monthly'], ['tenant'], ['tenants']],
      onSuccess: () => onDone(`${name}: ${chf(amountCents)} verbucht${plan.lines.length ? ` (${[...new Set(selected.filter((o) => plan.lines.some((l) => l.chargeId === o.chargeId)).map((o) => formatPeriod(o.period)))].join(', ')})` : ''}`),
    },
  );

  const periods = [...new Set(item.open.map((o) => o.period))];

  return (
    <>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" />Anderer Mieter</button>

      {item.open.length ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-slate-600">Welche Monate werden bezahlt?</p>
            <div className="flex gap-3 text-xs font-medium">
              <button className="text-brand-700 hover:underline" onClick={() => setChecked(new Set(item.open.map((o) => o.chargeId)))}>Alles offene</button>
              <button className="text-slate-500 hover:underline" onClick={() => setChecked(new Set())}>Keine</button>
            </div>
          </div>
          <div className="mb-5 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            {periods.map((p) => (
              <div key={p} className="border-b border-slate-100 last:border-0">
                {item.open.filter((o) => o.period === p).map((o) => (
                  <label key={o.chargeId} className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${checked.has(o.chargeId) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={checked.has(o.chargeId)} onChange={() => toggle(o.chargeId)} />
                    <span className="flex-1 text-sm text-slate-800">
                      {formatPeriod(o.period)}
                      <span className="ml-2 text-xs text-slate-500">{o.property} · {o.label}</span>
                      {o.status === 'OVERDUE' && <Badge tone="red" className="ml-2">überfällig</Badge>}
                      {o.status === 'PARTIAL' && <Badge tone="yellow" className="ml-2">teilbezahlt</Badge>}
                    </span>
                    <span className="text-sm font-medium tabular-nums text-slate-900">{chf(o.outstandingCents)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mb-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Keine offenen Monate. Der Betrag wird als <b>Guthaben/Vorauszahlung</b> verbucht und später automatisch verrechnet.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Betrag (CHF)" hint={!amountTouched && selectedSum ? 'aus den angekreuzten Monaten' : monthly ? `Monatsmiete ${chf(monthly)}` : undefined}>
          <Input
            inputMode="decimal"
            value={amountTouched ? amountText : amountCents ? fromCents(amountCents) : ''}
            placeholder={monthly ? fromCents(monthly) : '0.00'}
            onChange={(e) => { setAmountTouched(true); setAmountText(e.target.value); }}
          />
        </Field>
        <Field label="Bezahlt am"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Zahlungsart"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS} /></Field>
      </div>

      {amountCents > 0 && (
        <div className="mt-3 text-sm">
          {plan.remainder > 0 && <p className="text-violet-700">{chf(plan.remainder)} mehr als angekreuzt – wird als Guthaben verbucht.</p>}
          {amountCents < selectedSum && <p className="text-amber-700">{chf(selectedSum - amountCents)} weniger als angekreuzt – der Rest bleibt offen (Teilzahlung).</p>}
        </div>
      )}

      <button onClick={() => setMore(!more)} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${more ? 'rotate-180' : ''}`} />Mitteilung / Notiz
      </button>
      {more && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Mitteilung"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="z. B. Miete Oktober" /></Field>
          <Field label="Interne Notiz"><Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onClose}>Schliessen</Button>
        <Button icon={<Check className="h-4 w-4" />} disabled={!amountCents || !date} loading={save.isPending} onClick={() => save.mutate(undefined)}>
          {amountCents ? `${chf(amountCents)} verbuchen` : 'Betrag eingeben'}
        </Button>
      </div>
    </>
  );
}
