import { AlertTriangle, FileUp, Loader2, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UNIT_TYPES } from '@immo/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { fromCents, tenantName, toCents } from '@/lib/format';
import type { Property, TenantRef } from '@/lib/types';
import { Badge, Button, ConfidenceBar, Field, Input, Modal, Select, Textarea } from './ui';

interface Extracted {
  documentId: string;
  data: {
    tenant: { isCompany: boolean; firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null; street: string | null; zip: string | null; city: string | null; dateOfBirth: string | null; additionalTenants: string | null };
    property: { street: string | null; zip: string | null; city: string | null };
    unit: { label: string | null; type: string | null; floor: string | null; rooms: number | null; areaM2: number | null };
    lease: { startDate: string | null; endDate: string | null; noticePeriodMonths: number | null; netRentChf: number | null; utilitiesChf: number | null; depositChf: number | null; dueDay: number | null; paymentReference: string | null };
    landlord: string | null;
    notes: string | null;
    warnings: string[];
    confidence: number;
  };
  match: { propertyId: string | null; unitId: string | null; unitOccupied: boolean; tenantId: string | null; tenant: TenantRef | null };
}

const chfToField = (v: number | null) => (v === null || v === undefined ? '' : fromCents(Math.round(v * 100)));

/** Mietvertrag (PDF/Foto) hochladen → KI liest aus → prüfen → anlegen */
export function ContractImport({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [x, setX] = useState<Extracted | null>(null);
  const extract = useAction((file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<Extracted>('/leases/extract', { form: fd });
  }, { onSuccess: setX });

  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" />Mietvertrag automatisch erfassen</span>} size="xl">
      {!x ? (
        <div className="py-6 text-center">
          <input ref={input} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,image/*" onChange={(e) => e.target.files?.[0] && extract.mutate(e.target.files[0])} />
          {extract.isPending ? (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
              <p className="mt-4 font-semibold text-slate-900">Die KI liest den Mietvertrag …</p>
              <p className="mt-1 text-sm text-slate-500">Mieter, Mietobjekt, Mietbeginn, Mietzins, Nebenkosten, Kaution und Kündigungsfrist werden erkannt. Das dauert meist 20–60 Sekunden.</p>
            </div>
          ) : (
            <button onClick={() => input.current?.click()} className="mx-auto flex w-full max-w-lg flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-12 hover:border-brand-500 hover:bg-brand-50/40">
              <FileUp className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-800">Mietvertrag als PDF oder Foto auswählen</p>
              <p className="mt-1 text-xs text-slate-500">Auch eingescannte Verträge funktionieren. Nichts wird angelegt, bevor Sie die Angaben geprüft und bestätigt haben.</p>
            </button>
          )}
        </div>
      ) : (
        <ReviewForm x={x} onDone={(id) => { onClose(); navigate(`/mietvertraege/${id}`); }} onCancel={onClose} />
      )}
    </Modal>
  );
}

function ReviewForm({ x, onDone, onCancel }: { x: Extracted; onDone: (leaseId: string) => void; onCancel: () => void }) {
  const d = x.data;
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const { data: tenants } = useQuery({ queryKey: ['tenants', 'all-min'], queryFn: () => api<(TenantRef & { id: string })[]>('/tenants?status=all') });
  const [tenantMode, setTenantMode] = useState<'new' | 'existing'>(x.match.tenantId ? 'existing' : 'new');
  const [tenantId, setTenantId] = useState(x.match.tenantId ?? '');
  const [t, setT] = useState({
    isCompany: d.tenant.isCompany, firstName: d.tenant.firstName ?? '', lastName: d.tenant.lastName ?? '', companyName: d.tenant.companyName ?? '',
    email: d.tenant.email ?? '', phone: d.tenant.phone ?? '', street: d.tenant.street ?? '', zip: d.tenant.zip ?? '', city: d.tenant.city ?? '', dateOfBirth: d.tenant.dateOfBirth ?? '',
  });
  const [propertyId, setPropertyId] = useState(x.match.propertyId ?? '');
  const { data: units } = useQuery({ queryKey: ['units', propertyId], queryFn: () => api<{ id: string; label: string; leases: unknown[] }[]>(`/units?propertyId=${propertyId}`), enabled: !!propertyId });
  const [unitId, setUnitId] = useState(x.match.unitId ?? (d.unit.label ? '__new' : ''));
  const [nu, setNu] = useState({ label: d.unit.label ?? '', type: d.unit.type ?? 'APARTMENT', floor: d.unit.floor ?? '', rooms: d.unit.rooms?.toString() ?? '', areaM2: d.unit.areaM2?.toString() ?? '' });
  const [l, setL] = useState({
    startDate: d.lease.startDate ?? '', endDate: d.lease.endDate ?? '', net: chfToField(d.lease.netRentChf), util: chfToField(d.lease.utilitiesChf), deposit: chfToField(d.lease.depositChf),
    dueDay: String(d.lease.dueDay ?? 1), notice: String(d.lease.noticePeriodMonths ?? 3), paymentReference: d.lease.paymentReference ?? '',
    notes: [d.notes, d.tenant.additionalTenants && `Weitere Mieter: ${d.tenant.additionalTenants}`].filter(Boolean).join('\n'),
  });
  const setF = <T,>(setter: (v: T) => void, obj: T, k: keyof T) => (e: { target: { value: string } }) => setter({ ...obj, [k]: e.target.value });

  const save = useAction(() => api<{ id: string }>('/leases/from-contract', {
    body: {
      documentId: x.documentId,
      ...(tenantMode === 'existing' ? { tenantId } : { tenant: { ...t, dateOfBirth: t.dateOfBirth || null } }),
      ...(unitId && unitId !== '__new' ? { unitId } : { newUnit: { propertyId, label: nu.label, type: nu.type, floor: nu.floor, rooms: nu.rooms || null, areaM2: nu.areaM2 || null } }),
      lease: {
        status: 'ACTIVE', startDate: l.startDate, endDate: l.endDate || null, netRentCents: toCents(l.net), utilitiesCents: toCents(l.util), depositCents: toCents(l.deposit),
        dueDay: Number(l.dueDay) || 1, noticePeriodMonths: Number(l.notice) || 3, paymentReference: l.paymentReference, notes: l.notes,
      },
    },
  }), { success: 'Mieter und Mietvertrag angelegt', invalidate: [['leases'], ['tenants'], ['properties'], ['dashboard']], onSuccess: (r) => onDone(r.id) });

  const selectedUnit = units?.find((u) => u.id === unitId);
  const valid = l.startDate && toCents(l.net) > 0 && (tenantMode === 'existing' ? !!tenantId : !!(t.lastName || t.companyName)) && (unitId === '__new' ? !!(propertyId && nu.label) : !!unitId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
        <div className="flex items-center gap-3 text-sm"><span className="text-slate-600">Erkennungssicherheit</span><ConfidenceBar value={d.confidence} /></div>
        {d.landlord && <span className="text-xs text-slate-500">Vermieter laut Vertrag: {d.landlord}</span>}
      </div>
      {d.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Bitte prüfen</p>
          <ul className="list-disc pl-5">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">Mieter</h4>
          <div className="flex gap-1">
            <Button size="sm" variant={tenantMode === 'new' ? 'primary' : 'ghost'} onClick={() => setTenantMode('new')}>Neu anlegen</Button>
            <Button size="sm" variant={tenantMode === 'existing' ? 'primary' : 'ghost'} onClick={() => setTenantMode('existing')}>Bestehender Mieter</Button>
          </div>
        </div>
        {tenantMode === 'existing' ? (
          <Field label="Mieter" hint={x.match.tenant ? `Automatisch gefunden: ${tenantName(x.match.tenant)}` : undefined}>
            <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Bitte wählen" options={(tenants ?? []).map((m) => ({ value: m.id, label: tenantName(m) }))} />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {t.isCompany && <Field label="Firma" className="sm:col-span-3"><Input value={t.companyName} onChange={setF(setT, t, 'companyName')} /></Field>}
            <Field label="Vorname"><Input value={t.firstName} onChange={setF(setT, t, 'firstName')} /></Field>
            <Field label="Nachname"><Input value={t.lastName} onChange={setF(setT, t, 'lastName')} /></Field>
            <Field label="Geburtsdatum"><Input type="date" value={t.dateOfBirth} onChange={setF(setT, t, 'dateOfBirth')} /></Field>
            <Field label="E-Mail"><Input value={t.email} onChange={setF(setT, t, 'email')} /></Field>
            <Field label="Telefon"><Input value={t.phone} onChange={setF(setT, t, 'phone')} /></Field>
            <Field label="Bisherige Adresse"><Input value={[t.street, [t.zip, t.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')} disabled /></Field>
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Mietobjekt <span className="font-normal text-slate-500">– laut Vertrag: {[d.property.street, d.property.zip, d.property.city].filter(Boolean).join(', ') || 'keine Adresse erkannt'}{d.unit.label && `, ${d.unit.label}`}</span></h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Immobilie" hint={x.match.propertyId ? 'Automatisch zugeordnet' : 'Keine passende Immobilie gefunden – bitte wählen oder zuerst anlegen'}>
            <Select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitId('__new'); }} placeholder="Bitte wählen" options={(properties ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.street}, ${p.city})` }))} />
          </Field>
          <Field label="Wohnung / Objekt" error={selectedUnit && selectedUnit.leases.length ? 'Dieses Objekt ist bereits vermietet.' : undefined}>
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} placeholder="Bitte wählen" options={[...(units ?? []).map((u) => ({ value: u.id, label: `${u.label}${u.leases.length ? ' (vermietet)' : ''}` })), { value: '__new', label: '+ Neues Mietobjekt anlegen' }]} />
          </Field>
          {unitId === '__new' && (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-5">
              <Field label="Bezeichnung"><Input value={nu.label} onChange={setF(setNu, nu, 'label')} /></Field>
              <Field label="Art"><Select value={nu.type} onChange={setF(setNu, nu, 'type')} options={UNIT_TYPES} /></Field>
              <Field label="Etage"><Input value={nu.floor} onChange={setF(setNu, nu, 'floor')} /></Field>
              <Field label="Zimmer"><Input value={nu.rooms} onChange={setF(setNu, nu, 'rooms')} /></Field>
              <Field label="Fläche m²"><Input value={nu.areaM2} onChange={setF(setNu, nu, 'areaM2')} /></Field>
            </div>
          )}
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Vertrag</h4>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Mietbeginn"><Input type="date" value={l.startDate} onChange={setF(setL, l, 'startDate')} /></Field>
          <Field label="Mietende (befristet)"><Input type="date" value={l.endDate} onChange={setF(setL, l, 'endDate')} /></Field>
          <Field label="Kündigungsfrist (Mt.)"><Input type="number" value={l.notice} onChange={setF(setL, l, 'notice')} /></Field>
          <Field label="Fällig am (Tag)"><Input type="number" value={l.dueDay} onChange={setF(setL, l, 'dueDay')} /></Field>
          <Field label="Nettomiete CHF"><Input value={l.net} onChange={setF(setL, l, 'net')} inputMode="decimal" /></Field>
          <Field label="Nebenkosten CHF"><Input value={l.util} onChange={setF(setL, l, 'util')} inputMode="decimal" /></Field>
          <Field label="Kaution CHF"><Input value={l.deposit} onChange={setF(setL, l, 'deposit')} inputMode="decimal" /></Field>
          <Field label="Zahlungsreferenz"><Input value={l.paymentReference} onChange={setF(setL, l, 'paymentReference')} /></Field>
          <Field label="Wichtige Klauseln / Notizen" className="sm:col-span-4"><Textarea rows={3} value={l.notes} onChange={setF(setL, l, 'notes')} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Total pro Monat: <Badge>CHF {((toCents(l.net) + toCents(l.util)) / 100).toFixed(2)}</Badge> · Der Vertrag wird als PDF beim Mieter und im Mietvertrag abgelegt (auch in der Mieter-App sichtbar).</p>
      </section>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onCancel}>Abbrechen</Button>
        <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>Prüfung abgeschlossen – anlegen</Button>
      </div>
    </div>
  );
}
