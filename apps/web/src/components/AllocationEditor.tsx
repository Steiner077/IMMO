import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { chf, formatPeriod, fromCents, tenantName, toCents } from '@/lib/format';
import type { Lease } from '@/lib/types';
import { Button, Field, Input, Select } from './ui';

export interface OpenCharge { id: string; period: string; outstandingCents: number; label?: string }
export interface AllocationValue { leaseId: string | null; allocations: { chargeId: string; amountCents: number }[] }

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Auswahl Mietvertrag + Aufteilung eines Betrags auf offene Monate.
 * Vorschlag automatisch (Startmonat, dann älteste offene Monate).
 * Ist für einen Monat noch keine Sollstellung vorhanden (z. B. künftiger Monat oder
 * eine Zahlung vor dem bisherigen Abrechnungsbeginn), lässt er sich unten manuell
 * hinzufügen – nie vor Mietbeginn.
 */
export function AllocationEditor({ amountCents, value, onChange, initialLeaseId, initialPeriod }: { amountCents: number; value: AllocationValue; onChange: (v: AllocationValue) => void; initialLeaseId?: string | null; initialPeriod?: string | null }) {
  const { data: leases } = useQuery({ queryKey: ['leases', 'active-min'], queryFn: () => api<Lease[]>('/leases?status=ACTIVE,TERMINATED,ENDED') });
  const [leaseId, setLeaseId] = useState(initialLeaseId ?? value.leaseId ?? '');
  const [period, setPeriod] = useState(initialPeriod ?? '');
  const { data: suggestion } = useQuery({
    queryKey: ['suggest', leaseId, amountCents, period],
    queryFn: () => api<{ open: OpenCharge[]; lines: { chargeId: string; period: string; amountCents: number }[]; remainderCents: number }>('/payments/suggest-allocation', { body: { leaseId, amountCents, period: period || null } }),
    enabled: !!leaseId && amountCents > 0,
  });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Monate, die der Nutzer selbst hinzugefügt hat (noch nicht in suggestion.open enthalten)
  const [extra, setExtra] = useState<OpenCharge[]>([]);
  const [newPeriod, setNewPeriod] = useState(thisMonth());

  useEffect(() => {
    if (!suggestion) return;
    const next: Record<string, string> = {};
    for (const l of suggestion.lines) next[l.chargeId] = fromCents(l.amountCents);
    setAmounts(next);
  }, [suggestion]);

  useEffect(() => {
    onChange({ leaseId: leaseId || null, allocations: Object.entries(amounts).map(([chargeId, v]) => ({ chargeId, amountCents: toCents(v) })).filter((a) => a.amountCents > 0) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amounts, leaseId]);

  const assigned = Object.values(amounts).reduce((s, v) => s + toCents(v), 0);
  const rest = amountCents - assigned;

  const open = [...(suggestion?.open ?? []), ...extra.filter((e) => !suggestion?.open.some((o) => o.id === e.id))].sort((a, b) => a.period.localeCompare(b.period));

  const addMonth = useAction(
    () => api<OpenCharge>('/payments/ensure-open-charge', { body: { leaseId, period: newPeriod } }),
    {
      onSuccess: (charge) => {
        setExtra((x) => [...x.filter((e) => e.period !== charge.period), charge]);
        if (!amounts[charge.id]) setAmounts((a) => ({ ...a, [charge.id]: fromCents(Math.min(Math.max(rest, 0), charge.outstandingCents)) }));
      },
      invalidate: [['monthly'], ['tenant']],
    },
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mieter / Mietvertrag">
          <Select value={leaseId} onChange={(e) => { setLeaseId(e.target.value); setAmounts({}); setExtra([]); }} placeholder="– nicht zugeordnet –" options={(leases ?? []).map((l) => ({ value: l.id, label: `${tenantName(l.tenant)} · ${l.unit.property.name} ${l.unit.label}` }))} />
        </Field>
        <Field label="Beginnen mit Monat" hint="Standard: ältester offener Monat">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="automatisch" options={[...new Map((suggestion?.open ?? []).map((o) => [o.period, { value: o.period, label: formatPeriod(o.period) }])).values()]} />
        </Field>
      </div>
      {leaseId && suggestion && (
        <div className="rounded-lg border border-slate-200">
          <table className="table-base">
            <thead><tr><th>Offener Monat</th><th className="num">Offen</th><th className="num">Zuordnen (CHF)</th></tr></thead>
            <tbody>
              {open.map((o) => (
                <tr key={o.id}>
                  <td>{formatPeriod(o.period)}{o.label && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{o.label}</span>}</td>
                  <td className="num">{chf(o.outstandingCents)}</td>
                  <td className="num"><Input className="ml-auto w-32 text-right" value={amounts[o.id] ?? ''} inputMode="decimal" onChange={(e) => setAmounts({ ...amounts, [o.id]: e.target.value })} /></td>
                </tr>
              ))}
              {!open.length && <tr><td colSpan={3} className="text-center text-sm text-slate-500">Keine offenen Monate – der Betrag wird als Guthaben geführt.</td></tr>}
            </tbody>
          </table>
          <div className="flex justify-between border-t border-slate-100 px-4 py-2.5 text-sm">
            <span>Zugeordnet: <strong className="tabular-nums">{chf(assigned)}</strong></span>
            <span className={rest < 0 ? 'font-medium text-red-600' : rest > 0 ? 'text-violet-700' : 'text-emerald-700'}>
              {rest < 0 ? `Überschreitung ${chf(-rest)}` : rest > 0 ? `Guthaben / nicht zugeordnet ${chf(rest)}` : 'Vollständig zugeordnet'}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-4 py-2.5">
            <Field label="Anderer Monat" hint="Fehlt der gewünschte Monat oben? Hier hinzufügen." className="mb-0">
              <Input type="month" className="w-40" value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} />
            </Field>
            <Button type="button" size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} loading={addMonth.isPending} disabled={!newPeriod || open.some((o) => o.period === newPeriod)} onClick={() => addMonth.mutate(undefined)}>
              Monat hinzufügen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
