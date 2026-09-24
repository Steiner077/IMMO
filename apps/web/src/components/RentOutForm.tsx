import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UNIT_TYPES } from '@immo/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { chf, fromCents, tenantName, toCents } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { TenantForm } from '@/pages/Tenants';

export interface RentUnit { id: string; label: string; type: string; targetRentCents: number | null; property?: { id: string; name: string } }

/** Mieter wählen, Objekte ankreuzen, Preise bei Bedarf anpassen → Mietverträge anlegen */
export function RentOutForm({ units, onClose, fixedTenantId, rented = [] }: { units: RentUnit[]; onClose: () => void; fixedTenantId?: string; rented?: { id: string; label: string; property?: string }[] }) {
  const { data: tenants } = useQuery({ queryKey: ['tenants', '', 'all'], queryFn: () => api<(TenantRef & { id: string })[]>('/tenants?status=all') });
  const [tenantId, setTenantId] = useState(fixedTenantId ?? '');
  const [newTenant, setNewTenant] = useState(false);
  const next = new Date();
  next.setMonth(next.getMonth() + 1, 1);
  const [startDate, setStartDate] = useState(next.toISOString().slice(0, 10));
  const [rows, setRows] = useState(() => Object.fromEntries(units.map((u) => [u.id, { checked: false, rent: fromCents(u.targetRentCents), nk: '' }])));
  const [errors, setErrors] = useState<string[]>([]);
  const multi = new Set(units.map((u) => u.property?.id)).size > 1 || rented.length > 0 && !!units[0]?.property;
  const chosen = units.filter((u) => rows[u.id].checked);
  const total = chosen.reduce((s, u) => s + toCents(rows[u.id].rent || '0') + toCents(rows[u.id].nk || '0'), 0);
  const save = useAction(
    async () => {
      const failed: string[] = [];
      let ok = 0;
      for (const u of chosen) {
        try {
          await api('/leases', { body: { unitId: u.id, tenantId, startDate, netRentCents: toCents(rows[u.id].rent || '0'), utilitiesCents: toCents(rows[u.id].nk || '0') } });
          ok++;
        } catch (e) {
          failed.push(`${u.label}: ${e instanceof Error ? e.message : 'Fehler'}`);
        }
      }
      setErrors(failed);
      if (failed.length) throw new Error(`${ok} von ${chosen.length} Verträgen angelegt`);
      return ok;
    },
    { success: (n) => `${n} Mietverträge angelegt`, invalidate: [['property'], ['properties'], ['units'], ['tenants'], ['tenant'], ['leases'], ['dashboard']], onSuccess: onClose },
  );
  const set = (id: string, patch: Partial<(typeof rows)[string]>) => setRows({ ...rows, [id]: { ...rows[id], ...patch } });
  return (
    <>
      <Modal
        open
        size="lg"
        onClose={onClose}
        title="Vermieten"
        footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!tenantId || !chosen.length || !startDate} loading={save.isPending} onClick={() => save.mutate(undefined)}>{chosen.length ? `${chosen.length} vermieten · ${chf(total)} / Monat` : 'Objekte ankreuzen'}</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {!fixedTenantId && <Field label="Mieter">
            <div className="flex gap-2">
              <Select className="flex-1" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Mieter wählen …" options={(tenants ?? []).map((t) => ({ value: t.id, label: tenantName(t) }))} />
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewTenant(true)}>Neu</Button>
            </div>
          </Field>}
          <Field label="Mietbeginn"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        </div>
        <table className="table-base mt-5">
          <thead><tr><th /><th>Objekt</th>{multi && <th>Immobilie</th>}<th>Art</th><th className="num">Miete netto (CHF)</th><th className="num">Nebenkosten (CHF)</th></tr></thead>
          <tbody>
            {rented.map((r) => (
              <tr key={r.id} className="text-slate-500">
                <td><input type="checkbox" checked disabled aria-label={`${r.label} bereits gemietet`} /></td>
                <td className="font-medium">{r.label}</td>{multi && <td>{r.property}</td>}<td colSpan={3}>bereits gemietet</td>
              </tr>
            ))}
            {units.map((u) => (
              <tr key={u.id} className={rows[u.id].checked ? 'bg-brand-50/40' : ''}>
                <td><input type="checkbox" aria-label={`${u.label} ankreuzen`} checked={rows[u.id].checked} onChange={(e) => set(u.id, { checked: e.target.checked })} /></td>
                <td className="cursor-pointer font-medium text-slate-900" onClick={() => set(u.id, { checked: !rows[u.id].checked })}>{u.label}</td>
                {multi && <td>{u.property?.name}</td>}
                <td>{UNIT_TYPES[u.type as keyof typeof UNIT_TYPES]}</td>
                <td className="num"><Input className="w-28 text-right" inputMode="decimal" value={rows[u.id].rent} placeholder="0.00" onChange={(e) => set(u.id, { rent: e.target.value, checked: true })} /></td>
                <td className="num"><Input className="w-28 text-right" inputMode="decimal" value={rows[u.id].nk} placeholder="0.00" onChange={(e) => set(u.id, { nk: e.target.value, checked: true })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">Die Preise kommen aus «Preise». Individuelle Abweichungen einfach hier eintragen. Details wie Kaution, Kündigungsfrist oder Zahlungsreferenz können Sie danach im Mietvertrag unter «Bearbeiten» ändern.</p>
        {!units.length && <p className="mt-3 text-sm text-slate-500">Keine freien Objekte vorhanden.</p>}
        {errors.map((e) => <p key={e} className="mt-2 text-sm text-red-700">{e}</p>)}
      </Modal>
      {newTenant && <TenantForm onClose={() => setNewTenant(false)} onCreated={(id) => { setTenantId(id); setNewTenant(false); }} />}
    </>
  );
}

