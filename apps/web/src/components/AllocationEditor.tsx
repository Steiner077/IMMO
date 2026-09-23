import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { chf, formatPeriod, fromCents, tenantName, toCents } from '@/lib/format';
import type { Lease } from '@/lib/types';
import { Field, Input, Select } from './ui';

export interface OpenCharge { id: string; period: string; outstandingCents: number; label?: string }
export interface AllocationValue { leaseId: string | null; allocations: { chargeId: string; amountCents: number }[] }

/**
 * Auswahl Mietvertrag + Aufteilung eines Betrags auf offene Monate.
 * Vorschlag automatisch (Startmonat, dann älteste offene Monate).
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

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mieter / Mietvertrag">
          <Select value={leaseId} onChange={(e) => { setLeaseId(e.target.value); setAmounts({}); }} placeholder="– nicht zugeordnet –" options={(leases ?? []).map((l) => ({ value: l.id, label: `${tenantName(l.tenant)} · ${l.unit.property.name} ${l.unit.label}` }))} />
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
              {suggestion.open.map((o) => (
                <tr key={o.id}>
                  <td>{formatPeriod(o.period)}{o.label && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{o.label}</span>}</td>
                  <td className="num">{chf(o.outstandingCents)}</td>
                  <td className="num"><Input className="ml-auto w-32 text-right" value={amounts[o.id] ?? ''} inputMode="decimal" onChange={(e) => setAmounts({ ...amounts, [o.id]: e.target.value })} /></td>
                </tr>
              ))}
              {!suggestion.open.length && <tr><td colSpan={3} className="text-center text-sm text-slate-500">Keine offenen Monate – der Betrag wird als Guthaben geführt.</td></tr>}
            </tbody>
          </table>
          <div className="flex justify-between border-t border-slate-100 px-4 py-2.5 text-sm">
            <span>Zugeordnet: <strong className="tabular-nums">{chf(assigned)}</strong></span>
            <span className={rest < 0 ? 'font-medium text-red-600' : rest > 0 ? 'text-violet-700' : 'text-emerald-700'}>
              {rest < 0 ? `Überschreitung ${chf(-rest)}` : rest > 0 ? `Guthaben / nicht zugeordnet ${chf(rest)}` : 'Vollständig zugeordnet'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
