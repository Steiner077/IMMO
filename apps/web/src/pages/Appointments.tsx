import { CalendarDays, Download, MapPin, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MONTH_NAMES_DE } from '@immo/shared';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { isoDate, tenantName } from '@/lib/format';
import type { Property, TenantRef } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from '@/components/ui';

interface Appt { id: string; title: string; description: string | null; startAt: string; endAt: string | null; location: string | null; visibleToTenant: boolean; property: { name: string } | null; unit: { label: string } | null; tenant: TenantRef | null; damageReport: { id: string; ticketNumber: number } | null }
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const time = (d: string) => new Date(d).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

export function AppointmentsPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['appointments'], queryFn: () => api<Appt[]>(`/appointments?from=${new Date(Date.now() - 7 * 86400000).toISOString()}`) });
  const del = useAction((id: string) => api(`/appointments/${id}`, { method: 'DELETE' }), { success: 'Termin gelöscht', invalidate: [['appointments']] });
  const groups = new Map<string, Appt[]>();
  for (const a of data ?? []) {
    const k = isoDate(new Date(new Date(a.startAt).setHours(12)));
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return (
    <>
      <PageHeader title="Termine" subtitle="Besichtigungen, Reparaturen, Übergaben und Versammlungen" actions={
        <>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('/appointments/calendar.ics', 'immo-termine.ics')}>Kalender (.ics)</Button>
          {can('appointment:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Termin erstellen</Button>}
        </>
      } />
      {isLoading ? <Loading /> : !groups.size ? <Card><EmptyState title="Keine Termine" icon={<CalendarDays className="h-5 w-5" />} /></Card> : (
        <div className="space-y-5">
          {[...groups.entries()].map(([day, items]) => {
            const d = new Date(day);
            const past = d < new Date(new Date().setHours(0, 0, 0, 0));
            return (
              <div key={day} className={past ? 'opacity-60' : ''}>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{WEEKDAYS[d.getDay()]}, {d.getDate()}. {MONTH_NAMES_DE[d.getMonth()]} {d.getFullYear()}</p>
                <Card bodyClassName="p-0">
                  <ul className="divide-y divide-slate-100">
                    {items.map((a) => (
                      <li key={a.id} className="flex items-start gap-4 px-5 py-3.5">
                        <div className="w-24 shrink-0 text-sm font-medium tabular-nums text-slate-900">{time(a.startAt)}{a.endAt && <span className="text-slate-400"> – {time(a.endAt)}</span>}</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{a.title}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                            {a.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</span>}
                            {a.tenant && <span>{tenantName(a.tenant)}</span>}
                            {a.damageReport && <Link className="text-brand-700" to={`/maengel/${a.damageReport.id}`}>Ticket #{a.damageReport.ticketNumber}</Link>}
                          </p>
                          {a.description && <p className="mt-1 text-xs text-slate-600">{a.description}</p>}
                        </div>
                        {a.visibleToTenant && <Badge tone="green">Mieter informiert</Badge>}
                        {can('appointment:write') && <button className="text-slate-300 hover:text-red-600" onClick={() => confirm('Termin löschen?') && del.mutate(a.id)}><Trash2 className="h-4 w-4" /></button>}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            );
          })}
        </div>
      )}
      {open && <AppointmentForm onClose={() => setOpen(false)} />}
    </>
  );
}

function AppointmentForm({ onClose }: { onClose: () => void }) {
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const [f, setF] = useState({ title: '', description: '', date: isoDate(new Date()), time: '09:00', duration: '60', location: '', propertyId: '', unitId: '', visibleToTenant: false });
  const { data: units } = useQuery({ queryKey: ['units', f.propertyId], queryFn: () => api<{ id: string; label: string; leases: { tenant: { id: string } }[] }[]>(`/units?propertyId=${f.propertyId}`), enabled: !!f.propertyId });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => {
    const start = new Date(`${f.date}T${f.time}`);
    const tenantId = units?.find((u) => u.id === f.unitId)?.leases[0]?.tenant.id;
    return api('/appointments', { body: { title: f.title, description: f.description, startAt: start.toISOString(), endAt: new Date(start.getTime() + Number(f.duration) * 60000).toISOString(), location: f.location, propertyId: f.propertyId || null, unitId: f.unitId || null, tenantId: tenantId ?? null, visibleToTenant: f.visibleToTenant && !!tenantId } });
  }, { success: 'Termin erstellt', invalidate: [['appointments'], ['dashboard']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Neuer Termin" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!f.title} loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Titel" className="sm:col-span-3"><Input value={f.title} onChange={set('title')} /></Field>
        <Field label="Datum"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Zeit"><Input type="time" value={f.time} onChange={set('time')} /></Field>
        <Field label="Dauer (Min.)"><Input type="number" value={f.duration} onChange={set('duration')} /></Field>
        <Field label="Immobilie" className="sm:col-span-2"><Select value={f.propertyId} onChange={set('propertyId')} placeholder="– keine –" options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Wohnung"><Select value={f.unitId} onChange={set('unitId')} placeholder="–" options={(units ?? []).map((u) => ({ value: u.id, label: u.label }))} /></Field>
        <Field label="Ort" className="sm:col-span-3"><Input value={f.location} onChange={set('location')} /></Field>
        <Field label="Beschreibung" className="sm:col-span-3"><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={f.visibleToTenant} onChange={(e) => setF({ ...f, visibleToTenant: e.target.checked })} /> Mieter der Wohnung informieren (Mieter-App)</label>
      </div>
    </Modal>
  );
}
