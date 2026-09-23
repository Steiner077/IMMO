import { Building2, Car, MapPin, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PROPERTY_TYPES, UNIT_TYPES } from '@immo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, fromCents, tenantName, toCents } from '@/lib/format';
import type { Property, TenantRef } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, KeyValue, Loading, Modal, PageHeader, Select, StatCard, Tabs, Textarea } from '@/components/ui';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { DamageList } from './Damages';

export function PropertiesPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  return (
    <>
      <PageHeader
        title="Immobilien"
        subtitle={data ? `${data.length} Liegenschaften · ${data.reduce((s, p) => s + p.unitCount, 0)} Mietobjekte` : undefined}
        actions={can('property:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Immobilie erfassen</Button>}
      />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Card><EmptyState title="Noch keine Immobilien" text="Erfassen Sie Ihre erste Liegenschaft." icon={<Building2 className="h-5 w-5" />} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const park = p.parkingCount ?? 0;
            const living = p.unitCount - park;
            const livingOcc = p.occupiedCount - (p.parkingOccupiedCount ?? 0);
            const occ = living ? Math.round((livingOcc / living) * 100) : 0;
            const paid = p.currentDueCents ? Math.round(((p.currentPaidCents ?? 0) / p.currentDueCents) * 100) : null;
            return (
              <Link key={p.id} to={`/immobilien/${p.id}`} className="card group block p-5 transition hover:border-slate-300 hover:shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <Badge>{PROPERTY_TYPES[p.type as keyof typeof PROPERTY_TYPES]}</Badge>
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-900 group-hover:text-brand-700">{p.name}</h3>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3" /> {p.street}, {p.zip} {p.city}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-xs">
                  <div>
                    <p className="text-slate-500">Belegung</p>
                    <p className="mt-0.5 font-semibold text-slate-800">
                      {livingOcc}/{living} <span className="font-normal text-slate-500">({occ} %)</span>
                    </p>
                    {park > 0 && <p className="mt-0.5 text-slate-500">PP/Garagen {p.parkingOccupiedCount ?? 0}/{park}</p>}
                  </div>
                  {p.monthlyRentCents !== undefined && (
                    <div>
                      <p className="text-slate-500">Soll / Monat</p>
                      <p className="mt-0.5 font-semibold tabular-nums text-slate-800">{chf(p.monthlyRentCents)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-slate-500">{paid !== null ? 'Bezahlt' : 'Mängel'}</p>
                    <p className="mt-0.5 font-semibold text-slate-800">{paid !== null ? `${paid} %` : p.openDamages}</p>
                  </div>
                </div>
                {paid !== null && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paid}%` }} />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      <PropertyForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}

type PropertyInput = { name: string; street: string; zip: string; city: string; type: string; yearBuilt: string; purchasePrice: string; description: string; tenantInfo: string };

function PropertyForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Record<string, unknown> & { id: string } }) {
  const navigate = useNavigate();
  const [f, setF] = useState<PropertyInput>({
    name: (initial?.name as string) ?? '',
    street: (initial?.street as string) ?? '',
    zip: (initial?.zip as string) ?? '',
    city: (initial?.city as string) ?? '',
    type: (initial?.type as string) ?? 'RESIDENTIAL',
    yearBuilt: initial?.yearBuilt ? String(initial.yearBuilt) : '',
    purchasePrice: fromCents(initial?.purchasePriceCents as number),
    description: (initial?.description as string) ?? '',
    tenantInfo: (initial?.tenantInfo as string) ?? '',
  });
  const set = (k: keyof PropertyInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => {
      const body = { name: f.name, street: f.street, zip: f.zip, city: f.city, type: f.type, yearBuilt: f.yearBuilt || null, purchasePriceCents: f.purchasePrice ? toCents(f.purchasePrice) : null, description: f.description, tenantInfo: f.tenantInfo };
      return initial ? api(`/properties/${initial.id}`, { method: 'PATCH', body }) : api<{ id: string }>('/properties', { body });
    },
    { success: 'Gespeichert', invalidate: [['properties'], ['property']], onSuccess: (r) => { onClose(); if (!initial) navigate(`/immobilien/${(r as { id: string }).id}`); } },
  );
  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Immobilie bearbeiten' : 'Neue Immobilie'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bezeichnung" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} placeholder="z. B. Seestrasse 12" /></Field>
        <Field label="Strasse" className="sm:col-span-2"><Input value={f.street} onChange={set('street')} /></Field>
        <Field label="PLZ"><Input value={f.zip} onChange={set('zip')} /></Field>
        <Field label="Ort"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="Art"><Select value={f.type} onChange={set('type')} options={PROPERTY_TYPES} /></Field>
        <Field label="Baujahr"><Input type="number" value={f.yearBuilt} onChange={set('yearBuilt')} /></Field>
        <Field label="Anlagewert / Kaufpreis (CHF)" hint="Für Renditeberechnung"><Input value={f.purchasePrice} onChange={set('purchasePrice')} inputMode="decimal" /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
        <Field label="Informationen für Mieter" hint="Wird in der Mieter-App angezeigt (Hausordnung, Kehricht, Notfallnummern …)" className="sm:col-span-2"><Textarea rows={4} value={f.tenantInfo} onChange={set('tenantInfo')} /></Field>
      </div>
    </Modal>
  );
}

const PARKING = new Set(['PARKING', 'GARAGE']);

function BulkUnitForm({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const [f, setF] = useState({ type: 'PARKING', prefix: 'PP', from: '1', to: '10', floor: '', targetRent: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const from = Number(f.from);
  const to = Number(f.to);
  const count = Number.isInteger(from) && Number.isInteger(to) && to >= from ? to - from + 1 : 0;
  const save = useAction(
    () => api<{ created: number; skipped: string[] }>(`/properties/${propertyId}/units/bulk`, { body: { type: f.type, prefix: f.prefix, from, to, floor: f.floor, targetRentCents: f.targetRent ? toCents(f.targetRent) : null } }),
    { success: (r) => `${r.created} Objekte angelegt`, invalidate: [['property'], ['properties'], ['units']], onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Mehrere Parkplätze / Garagen anlegen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} disabled={!count || count > 200} onClick={() => save.mutate(undefined)}>{count} anlegen</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Art"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, prefix: e.target.value === 'GARAGE' ? 'G' : e.target.value === 'PARKING' ? 'PP' : f.prefix })} options={{ PARKING: UNIT_TYPES.PARKING, GARAGE: UNIT_TYPES.GARAGE, STORAGE: UNIT_TYPES.STORAGE }} /></Field>
        <Field label="Bezeichnung (Vorsatz)" hint="z. B. PP → PP1, PP2 …"><Input value={f.prefix} onChange={set('prefix')} /></Field>
        <Field label="Von Nummer"><Input type="number" value={f.from} onChange={set('from')} /></Field>
        <Field label="Bis Nummer"><Input type="number" value={f.to} onChange={set('to')} /></Field>
        <Field label="Etage / Ort"><Input value={f.floor} onChange={set('floor')} placeholder="z. B. Tiefgarage" /></Field>
        <Field label="Richtmiete pro Objekt (CHF)"><Input value={f.targetRent} onChange={set('targetRent')} inputMode="decimal" /></Field>
      </div>
      <p className="mt-4 text-sm text-slate-500">
        {count ? <>Es werden <b>{count}</b> Objekte angelegt: {f.prefix}{from} bis {f.prefix}{to}. Bereits vorhandene Bezeichnungen werden übersprungen.</> : 'Bitte gültigen Bereich angeben.'}
      </p>
    </Modal>
  );
}

interface PropertyDetail extends Record<string, unknown> {
  id: string; name: string; street: string; zip: string; city: string; type: string; yearBuilt: number | null; description: string | null; tenantInfo: string | null; purchasePriceCents: number | null;
  units: { id: string; label: string; type: string; floor: string | null; rooms: string | null; areaM2: string | null; targetRentCents: number | null; leases: { id: string; netRentCents: number; utilitiesCents: number; endDate: string | null; status: string; tenant: TenantRef }[] }[];
}

export function PropertyDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState('units');
  const [edit, setEdit] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const navigate = useNavigate();
  const { data: p, isLoading } = useQuery({ queryKey: ['property', id], queryFn: () => api<PropertyDetail>(`/properties/${id}`) });
  if (isLoading || !p) return <Loading />;
  const fin = can('finance:read');
  const units = [...p.units].sort((a, b) => Number(PARKING.has(a.type)) - Number(PARKING.has(b.type)) || a.label.localeCompare(b.label, 'de', { numeric: true }));
  const living = units.filter((u) => !PARKING.has(u.type));
  const parking = units.filter((u) => PARKING.has(u.type));
  const occupiedLiving = living.filter((u) => u.leases.length).length;
  const occupiedParking = parking.filter((u) => u.leases.length).length;
  const monthly = p.units.reduce((s, u) => s + u.leases.reduce((a, l) => a + l.netRentCents + l.utilitiesCents, 0), 0);
  return (
    <>
      <PageHeader
        back="/immobilien"
        title={p.name}
        subtitle={`${p.street}, ${p.zip} ${p.city}${p.yearBuilt ? ` · Baujahr ${p.yearBuilt}` : ''}`}
        actions={can('property:write') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Bearbeiten</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Wohnungen / Gewerbe vermietet" value={`${occupiedLiving} / ${living.length}`} sub={`${living.length - occupiedLiving} leer`} />
        <StatCard label="Parkplätze / Garagen vermietet" value={`${occupiedParking} / ${parking.length}`} sub={`${parking.length - occupiedParking} frei`} />
        {fin && <StatCard label="Soll-Mietertrag / Monat" value={chf(monthly)} />}
        {fin && <StatCard label="Soll-Mietertrag / Jahr" value={chf(monthly * 12)} />}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'units', label: 'Mietobjekte', count: p.units.length }, { key: 'damages', label: 'Mängel' }, { key: 'docs', label: 'Dokumente' }, { key: 'info', label: 'Stammdaten' }]} />
      {tab === 'units' && (
        <Card title="Wohnungen und Mietobjekte" actions={can('unit:write') && <div className="flex gap-2"><Button size="sm" variant="secondary" icon={<Car className="h-4 w-4" />} onClick={() => setBulkOpen(true)}>Mehrere Parkplätze/Garagen</Button><Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setUnitOpen(true)}>Objekt hinzufügen</Button></div>} bodyClassName="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Objekt</th><th>Art</th><th>Etage</th><th className="num">Zimmer</th><th className="num">Fläche</th><th>Mieter</th>{fin && <th className="num">Miete / Monat</th>}<th>Status</th></tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const l = u.leases[0];
                return (
                  <tr key={u.id} className="clickable" onClick={() => navigate(`/objekte/${u.id}`)}>
                    <td className="font-medium text-slate-900">{u.label}</td>
                    <td>{UNIT_TYPES[u.type as keyof typeof UNIT_TYPES]}</td>
                    <td>{u.floor ?? '–'}</td>
                    <td className="num">{u.rooms ?? '–'}</td>
                    <td className="num">{u.areaM2 ? `${Number(u.areaM2)} m²` : '–'}</td>
                    <td>{l ? <Link to={`/mieter/${l.tenant.id}`} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">{tenantName(l.tenant)}</Link> : <span className="text-slate-400">–</span>}</td>
                    {fin && <td className="num">{l ? chf(l.netRentCents + l.utilitiesCents) : <span className="text-slate-400">{u.targetRentCents ? `Ziel ${chf(u.targetRentCents)}` : '–'}</span>}</td>}
                    <td>{l ? (l.status === 'TERMINATED' ? <Badge tone="yellow">Gekündigt</Badge> : <Badge tone="green">Vermietet</Badge>) : <Badge tone="red">Leerstand</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!p.units.length && <EmptyState title="Noch keine Mietobjekte" />}
        </Card>
      )}
      {tab === 'damages' && <DamageList filter={{ propertyId: p.id }} />}
      {tab === 'docs' && <Card title="Dokumentenablage der Immobilie" bodyClassName="p-0"><DocumentsPanel filter={{ propertyId: p.id }} /></Card>}
      {tab === 'info' && (
        <Card title="Stammdaten">
          <KeyValue items={[['Bezeichnung', p.name], ['Adresse', `${p.street}, ${p.zip} ${p.city}`], ['Art', PROPERTY_TYPES[p.type as keyof typeof PROPERTY_TYPES]], ['Baujahr', p.yearBuilt], ...(fin ? [['Anlagewert', chf(p.purchasePriceCents)] as [string, string]] : []), ['Beschreibung', p.description]]} />
          {p.tenantInfo && (
            <div className="mt-5 rounded-lg bg-slate-50 p-4">
              <p className="mb-1 text-xs font-medium text-slate-500">Informationen für Mieter</p>
              <p className="text-sm whitespace-pre-line text-slate-700">{p.tenantInfo}</p>
            </div>
          )}
        </Card>
      )}
      {edit && <PropertyForm open onClose={() => setEdit(false)} initial={p} />}
      {unitOpen && <UnitForm propertyId={p.id} onClose={() => setUnitOpen(false)} />}
      {bulkOpen && <BulkUnitForm propertyId={p.id} onClose={() => setBulkOpen(false)} />}
    </>
  );
}

export function UnitForm({ propertyId, onClose, initial }: { propertyId?: string; onClose: () => void; initial?: { id: string; label: string; type: string; floor: string | null; rooms: string | null; areaM2: string | null; targetRentCents: number | null; description: string | null } }) {
  const [f, setF] = useState({
    label: initial?.label ?? '',
    type: initial?.type ?? 'APARTMENT',
    floor: initial?.floor ?? '',
    rooms: initial?.rooms ? String(Number(initial.rooms)) : '',
    areaM2: initial?.areaM2 ? String(Number(initial.areaM2)) : '',
    targetRent: fromCents(initial?.targetRentCents),
    description: initial?.description ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => {
      const body = { label: f.label, type: f.type, floor: f.floor, rooms: f.rooms || null, areaM2: f.areaM2 || null, targetRentCents: f.targetRent ? toCents(f.targetRent) : null, description: f.description };
      return initial ? api(`/units/${initial.id}`, { method: 'PATCH', body }) : api(`/properties/${propertyId}/units`, { body });
    },
    { success: 'Mietobjekt gespeichert', invalidate: [['property'], ['unit'], ['properties']], onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title={initial ? 'Mietobjekt bearbeiten' : 'Neues Mietobjekt'} footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bezeichnung"><Input value={f.label} onChange={set('label')} placeholder="z. B. 3A" /></Field>
        <Field label="Art"><Select value={f.type} onChange={set('type')} options={UNIT_TYPES} /></Field>
        <Field label="Etage"><Input value={f.floor} onChange={set('floor')} /></Field>
        <Field label="Zimmer"><Input value={f.rooms} onChange={set('rooms')} inputMode="decimal" /></Field>
        <Field label="Fläche (m²)"><Input value={f.areaM2} onChange={set('areaM2')} inputMode="decimal" /></Field>
        <Field label="Richtmiete netto (CHF)"><Input value={f.targetRent} onChange={set('targetRent')} inputMode="decimal" /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}
