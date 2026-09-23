import { CalendarPlus, Camera, MessageSquare, Plus, Receipt, Send, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DAMAGE_CATEGORIES, DAMAGE_STATUS, EXPENSE_CATEGORIES, PRIORITIES, ROLE_LABELS, type Role } from '@immo/shared';
import { api, openInline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, formatDate, formatDateTime, fromCents, isoDate, tenantName, toCents } from '@/lib/format';
import type { Damage, Doc, Property, UserLite } from '@/lib/types';
import { Button, Card, EmptyState, Field, Input, KeyValue, Loading, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { DamageBadge, PriorityBadge } from '@/components/StatusBadge';
import { DocIcon } from '@/components/DocumentsPanel';

export function DamageList({ filter = {} }: { filter?: Record<string, string> }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const qs = new URLSearchParams({ ...filter, ...(status === 'open' ? { open: 'true' } : status ? { status } : {}), ...(search && { search }) });
  const { data, isLoading } = useQuery({ queryKey: ['damages', qs.toString()], queryFn: () => api<Damage[]>(`/damages?${qs}`) });
  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
        <Input className="max-w-xs" placeholder="Suchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open', label: 'Offene Tickets' }, ...Object.entries(DAMAGE_STATUS).map(([value, label]) => ({ value, label })), { value: '', label: 'Alle' }]} />
      </div>
      {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Keine Mängel" text="Es liegen keine passenden Mängelmeldungen vor." /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Ticket</th><th>Mangel</th><th>Objekt</th><th>Gemeldet</th><th>Zuständig</th><th>Priorität</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => navigate(`/maengel/${d.id}`)}>
                  <td className="font-mono text-xs text-slate-500">#{d.ticketNumber}</td>
                  <td><p className="font-medium text-slate-900">{d.title}</p><p className="text-xs text-slate-500">{DAMAGE_CATEGORIES[d.category as keyof typeof DAMAGE_CATEGORIES]}{d._count?.documents ? ` · ${d._count.documents} Anhänge` : ''}</p></td>
                  <td>{d.property.name}{d.unit && ` · ${d.unit.label}`}<p className="text-xs text-slate-500">{d.tenant ? tenantName(d.tenant) : ''}</p></td>
                  <td className="whitespace-nowrap">{formatDate(d.createdAt)}</td>
                  <td className="text-xs">{d.assignedCaretaker && <p>{d.assignedCaretaker.firstName} {d.assignedCaretaker.lastName}</p>}{d.serviceProvider && <p className="text-slate-500">{d.serviceProvider.name}</p>}{!d.assignedCaretaker && !d.serviceProvider && <span className="text-slate-400">–</span>}</td>
                  <td><PriorityBadge priority={d.priority} /></td>
                  <td><DamageBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function DamagesPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Mängel" subtitle="Mängelmeldungen, Tickets und Reparaturaufträge" actions={can('damage:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Mangel erfassen</Button>} />
      <DamageList />
      {open && <NewDamageModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NewDamageModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const [f, setF] = useState({ propertyId: '', unitId: '', category: 'OTHER', priority: 'MEDIUM', title: '', description: '', preferredAppointment: '' });
  const { data: units } = useQuery({ queryKey: ['units', f.propertyId], queryFn: () => api<{ id: string; label: string; leases: { tenant: { id: string } }[] }[]>(`/units?propertyId=${f.propertyId}`), enabled: !!f.propertyId });
  const [files, setFiles] = useState<FileList | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => {
    const fd = new FormData();
    const tenantId = units?.find((u) => u.id === f.unitId)?.leases[0]?.tenant.id;
    Object.entries({ ...f, ...(tenantId ? { tenantId } : {}) }).forEach(([k, v]) => v && fd.append(k, v));
    for (const file of Array.from(files ?? [])) fd.append('file', file);
    return api<{ id: string }>('/damages', { form: fd });
  }, { success: 'Ticket erstellt', invalidate: [['damages'], ['dashboard']], onSuccess: (r) => { onClose(); navigate(`/maengel/${r.id}`); } });
  return (
    <Modal open onClose={onClose} title="Mangel erfassen" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} disabled={!f.propertyId || f.title.length < 3 || f.description.length < 3} onClick={() => save.mutate(undefined)}>Ticket erstellen</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Immobilie"><Select value={f.propertyId} onChange={set('propertyId')} placeholder="Bitte wählen" options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Wohnung / Bereich"><Select value={f.unitId} onChange={set('unitId')} placeholder="Allgemeiner Bereich" options={(units ?? []).map((u) => ({ value: u.id, label: u.label }))} /></Field>
        <Field label="Kategorie"><Select value={f.category} onChange={set('category')} options={DAMAGE_CATEGORIES} /></Field>
        <Field label="Priorität"><Select value={f.priority} onChange={set('priority')} options={PRIORITIES} /></Field>
        <Field label="Titel" className="sm:col-span-2"><Input value={f.title} onChange={set('title')} placeholder="z. B. Heizung funktioniert nicht" /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Textarea value={f.description} onChange={set('description')} /></Field>
        <Field label="Terminwunsch"><Input value={f.preferredAppointment} onChange={set('preferredAppointment')} /></Field>
        <Field label="Fotos / Video"><input type="file" multiple accept="image/*,video/*,application/pdf" onChange={(e) => setFiles(e.target.files)} className="text-sm" /></Field>
      </div>
    </Modal>
  );
}

interface DamageDetail extends Damage {
  propertyId: string; unitId: string | null; tenantId: string | null;
  property: Damage['property'] & { street: string; city: string };
  tenant: (Damage['tenant'] & { phone: string | null; email: string | null }) | null;
  reportedBy: { firstName: string; lastName: string; role: string } | null;
  serviceProvider: { id: string; name: string; phone: string | null; email: string | null } | null;
  events: { id: string; type: string; message: string | null; createdAt: string; isPublic: boolean; user: { firstName: string; lastName: string; role: string } | null }[];
  documents: Doc[];
  appointments: { id: string; title: string; startAt: string }[];
  conversations: { id: string; subject: string }[];
  expenses?: { id: string; amountCents: number; description: string; date: string }[];
}

export function DamageDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const key = ['damage', id];
  const { data: d, isLoading } = useQuery({ queryKey: key, queryFn: () => api<DamageDetail>(`/damages/${id}`) });
  const { data: staff } = useQuery({ queryKey: ['directory'], queryFn: () => api<UserLite[]>('/users/directory?role=CARETAKER,EMPLOYEE,MANAGER,OWNER'), enabled: can('damage:assign') });
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: () => api<{ id: string; name: string; trade: string | null }[]>('/providers'), enabled: can('provider:read') });
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [appt, setAppt] = useState(false);
  const [expense, setExpense] = useState(false);
  const [contact, setContact] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState<string>('PHOTO');
  const inv = [key, ['damages'], ['dashboard']];
  const patch = useAction((body: Record<string, unknown>) => api(`/damages/${id}`, { method: 'PATCH', body }), { success: 'Ticket aktualisiert', invalidate: inv });
  const addComment = useAction(() => api(`/damages/${id}/comments`, { body: { message: comment, internal } }), { invalidate: [key], onSuccess: () => setComment('') });
  const upload = useAction((files: FileList) => {
    const fd = new FormData();
    fd.append('category', uploadCategory);
    fd.append('visibleToTenant', uploadCategory === 'PHOTO' ? 'true' : 'false');
    for (const f of Array.from(files)) fd.append('file', f);
    return api(`/damages/${id}/documents`, { form: fd });
  }, { success: 'Datei hinzugefügt', invalidate: [key] });

  if (isLoading || !d) return <Loading />;
  const editable = can('damage:write');
  return (
    <>
      <PageHeader
        back="/maengel"
        title={<span className="flex flex-wrap items-center gap-3">Ticket #{d.ticketNumber} · {d.title}</span>}
        subtitle={`${d.property.name}${d.unit ? ` · Wohnung ${d.unit.label}` : ''} · gemeldet ${formatDateTime(d.createdAt)}${d.reportedBy ? ` von ${d.reportedBy.firstName} ${d.reportedBy.lastName}` : ''}`}
        actions={
          <>
            {can('message:write') && d.tenant && <Button variant="secondary" icon={<MessageSquare className="h-4 w-4" />} onClick={() => setContact(true)}>Mieter kontaktieren</Button>}
            {can('appointment:write') && <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setAppt(true)}>Termin erstellen</Button>}
            {can('expense:write') && <Button variant="secondary" icon={<Receipt className="h-4 w-4" />} onClick={() => setExpense(true)}>Kosten erfassen</Button>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Meldung">
            <div className="mb-4 flex flex-wrap gap-2"><PriorityBadge priority={d.priority} /><DamageBadge status={d.status} /></div>
            <p className="text-sm whitespace-pre-line text-slate-800">{d.description}</p>
            <div className="mt-5"><KeyValue cols={3} items={[['Kategorie', DAMAGE_CATEGORIES[d.category as keyof typeof DAMAGE_CATEGORIES]], ['Terminwunsch', d.preferredAppointment], ['Ort', d.location], ['Mieter', d.tenant ? <Link className="text-brand-700" to={`/mieter/${d.tenant.id}`}>{tenantName(d.tenant)}</Link> : '–'], ['Telefon', d.tenant?.phone ? <a href={`tel:${d.tenant.phone}`} className="text-brand-700">{d.tenant.phone}</a> : '–'], ['Erledigt am', formatDate(d.resolvedAt)]]} /></div>
          </Card>
          <Card title="Fotos, Videos & Dokumente" actions={editable && (
            <div className="flex gap-2">
              <Select className="w-36 py-1 text-xs" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} options={{ PHOTO: 'Foto', VIDEO: 'Video', INVOICE: 'Rechnung', CORRESPONDENCE: 'Offerte / Bericht' }} />
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
              <Button size="sm" variant="secondary" icon={uploadCategory === 'PHOTO' ? <Camera className="h-4 w-4" /> : <Upload className="h-4 w-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>Hinzufügen</Button>
            </div>
          )}>
            {d.documents.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {d.documents.map((doc) => (
                  <button key={doc.id} onClick={() => openInline(`/documents/${doc.id}/download`)} className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-3 text-center hover:bg-slate-50">
                    <DocIcon mime={doc.mimeType} />
                    <span className="w-full truncate text-xs text-slate-700">{doc.name}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-slate-500">Keine Anhänge.</p>}
          </Card>
          <Card title="Verlauf">
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {d.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-white ${e.type === 'COMMENT' ? 'bg-brand-500' : 'bg-slate-300'}`} />
                  <p className="text-sm text-slate-800">{e.message}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(e.createdAt)} · {e.user ? `${e.user.firstName} ${e.user.lastName} (${ROLE_LABELS[e.user.role as Role]})` : 'System'}{!e.isPublic && ' · intern'}</p>
                </li>
              ))}
            </ol>
            {editable && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Kommentar / Rückmeldung schreiben …" />
                <div className="mt-2 flex items-center justify-between">
                  {user?.role !== 'SERVICE_PROVIDER' ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Nur intern (für Mieter nicht sichtbar)</label> : <span />}
                  <Button size="sm" icon={<Send className="h-4 w-4" />} disabled={!comment.trim()} loading={addComment.isPending} onClick={() => addComment.mutate(undefined)}>Senden</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Bearbeitung">
            <div className="space-y-4">
              <Field label="Status"><Select disabled={!editable} value={d.status} onChange={(e) => patch.mutate({ status: e.target.value })} options={DAMAGE_STATUS} /></Field>
              {user?.role !== 'SERVICE_PROVIDER' && <Field label="Priorität"><Select disabled={!editable} value={d.priority} onChange={(e) => patch.mutate({ priority: e.target.value })} options={PRIORITIES} /></Field>}
              {can('damage:assign') && (
                <>
                  <Field label="Hauswart / Zuständig"><Select value={d.assignedCaretaker?.id ?? ''} onChange={(e) => patch.mutate({ assignedCaretakerId: e.target.value || null })} placeholder="– niemand –" options={(staff ?? []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName} (${ROLE_LABELS[u.role as Role]})` }))} /></Field>
                  <Field label="Handwerker / Dienstleister"><Select value={d.serviceProvider?.id ?? ''} onChange={(e) => patch.mutate({ serviceProviderId: e.target.value || null })} placeholder="– keiner –" options={(providers ?? []).map((p) => ({ value: p.id, label: `${p.name}${p.trade ? ` (${p.trade})` : ''}` }))} /></Field>
                </>
              )}
              {can('finance:read') && <Field label="Kostenschätzung (CHF)"><Input defaultValue={fromCents(d.estimatedCostCents)} onBlur={(e) => toCents(e.target.value) !== (d.estimatedCostCents ?? 0) && patch.mutate({ estimatedCostCents: e.target.value ? toCents(e.target.value) : null })} inputMode="decimal" /></Field>}
            </div>
          </Card>
          {d.serviceProvider && <Card title="Dienstleister"><p className="text-sm font-medium">{d.serviceProvider.name}</p><p className="text-xs text-slate-500">{d.serviceProvider.phone} {d.serviceProvider.email}</p></Card>}
          <Card title="Termine" bodyClassName="p-0">
            {d.appointments.length ? <ul className="divide-y divide-slate-100">{d.appointments.map((a) => <li key={a.id} className="px-5 py-3 text-sm">{a.title}<p className="text-xs text-slate-500">{formatDateTime(a.startAt)}</p></li>)}</ul> : <p className="px-5 py-4 text-sm text-slate-500">Keine Termine.</p>}
          </Card>
          {!!d.conversations.length && <Card title="Nachrichten" bodyClassName="p-0"><ul className="divide-y divide-slate-100">{d.conversations.map((c) => <li key={c.id}><Link to={`/nachrichten/${c.id}`} className="block px-5 py-3 text-sm text-brand-700 hover:bg-slate-50">{c.subject}</Link></li>)}</ul></Card>}
          {!!d.expenses?.length && <Card title="Kosten" bodyClassName="p-0"><ul className="divide-y divide-slate-100">{d.expenses.map((x) => <li key={x.id} className="flex justify-between px-5 py-3 text-sm"><span>{x.description}<p className="text-xs text-slate-500">{formatDate(x.date)}</p></span><span className="tabular-nums">{chf(x.amountCents)}</span></li>)}</ul></Card>}
        </div>
      </div>
      {appt && <AppointmentQuick damage={d} onClose={() => setAppt(false)} />}
      {expense && <ExpenseQuick damage={d} onClose={() => setExpense(false)} />}
      {contact && d.tenant && <ContactTenant damage={d} onClose={() => setContact(false)} onDone={(cid) => navigate(`/nachrichten/${cid}`)} />}
    </>
  );
}

function AppointmentQuick({ damage, onClose }: { damage: DamageDetail; onClose: () => void }) {
  const [f, setF] = useState({ title: `Reparatur: ${damage.title}`, date: isoDate(new Date(Date.now() + 86400000)), time: '08:00', duration: '60', location: `${damage.property.street}${damage.unit ? `, Wohnung ${damage.unit.label}` : ''}`, visibleToTenant: true });
  const save = useAction(() => {
    const start = new Date(`${f.date}T${f.time}`);
    return api('/appointments', { body: { title: f.title, startAt: start.toISOString(), endAt: new Date(start.getTime() + Number(f.duration) * 60000).toISOString(), location: f.location, propertyId: damage.propertyId, unitId: damage.unitId, tenantId: damage.tenantId, damageReportId: damage.id, visibleToTenant: f.visibleToTenant } });
  }, { success: 'Termin erstellt', invalidate: [['damage', damage.id], ['appointments']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Termin erstellen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Titel" className="sm:col-span-3"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Datum"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Zeit"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Dauer (Min.)"><Input type="number" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
        <Field label="Ort" className="sm:col-span-3"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={f.visibleToTenant} onChange={(e) => setF({ ...f, visibleToTenant: e.target.checked })} /> Termin in der Mieter-App anzeigen und Mieter benachrichtigen</label>
      </div>
    </Modal>
  );
}

function ExpenseQuick({ damage, onClose }: { damage: DamageDetail; onClose: () => void }) {
  const [f, setF] = useState({ amount: '', date: isoDate(new Date()), description: `Reparatur Ticket #${damage.ticketNumber}: ${damage.title}`, invoiceNumber: '', category: 'REPAIR' });
  const save = useAction(() => api('/expenses', { body: { propertyId: damage.propertyId, unitId: damage.unitId, serviceProviderId: damage.serviceProvider?.id ?? null, damageReportId: damage.id, category: f.category, date: f.date, amountCents: toCents(f.amount), description: f.description, invoiceNumber: f.invoiceNumber } }), { success: 'Kosten erfasst', invalidate: [['damage', damage.id], ['expenses']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Kosten / Rechnung erfassen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} disabled={!toCents(f.amount)} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Betrag (CHF)"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" autoFocus /></Field>
        <Field label="Datum"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Kategorie"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={EXPENSE_CATEGORIES} /></Field>
        <Field label="Rechnungsnummer"><Input value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">Die Rechnung selbst können Sie im Bereich „Fotos, Videos & Dokumente“ mit Kategorie „Rechnung“ hochladen.</p>
    </Modal>
  );
}

function ContactTenant({ damage, onClose, onDone }: { damage: DamageDetail; onClose: () => void; onDone: (id: string) => void }) {
  const { data: recipients } = useQuery({ queryKey: ['recipients'], queryFn: () => api<{ id: string; tenantId: string | null }[]>('/conversations/recipients') });
  const tenantUser = recipients?.find((r) => r.tenantId === damage.tenantId);
  const [body, setBody] = useState('');
  const save = useAction(() => api<{ id: string }>('/conversations', { body: { subject: `Ticket #${damage.ticketNumber}: ${damage.title}`, body, participantIds: [tenantUser!.id], tenantId: damage.tenantId, propertyId: damage.propertyId, unitId: damage.unitId, damageReportId: damage.id } }), { success: 'Nachricht gesendet', onSuccess: (r) => onDone(r.id) });
  return (
    <Modal open onClose={onClose} title={`Nachricht an ${tenantName(damage.tenant)}`} footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!tenantUser || !body.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>Senden</Button></>}>
      {!tenantUser && recipients && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Der Mieter hat noch keinen App-Zugang. Bitte kontaktieren Sie ihn telefonisch ({damage.tenant?.phone ?? 'keine Nummer'}) oder per E-Mail ({damage.tenant?.email ?? '–'}).</p>}
      <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nachricht …" />
    </Modal>
  );
}
