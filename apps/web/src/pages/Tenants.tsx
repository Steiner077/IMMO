import { KeyRound, Mail, Pencil, Phone, Plus, Search, Smartphone, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, formatDate, formatDateTime, isoDate, tenantName } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, KeyValue, Loading, Modal, PageHeader, Select, Tabs, Textarea } from '@/components/ui';
import { DamageBadge, LeaseBadge, PriorityBadge } from '@/components/StatusBadge';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { TenantAccount } from '@/components/TenantAccount';
import { ConversationList } from './Messages';
import { RentOutForm, type RentUnit } from '@/components/RentOutForm';
import { PaymentEntry } from '@/components/PaymentEntry';

interface TenantRow {
  id: string; firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null; portalAccess: boolean; openCents?: number;
  leases: { id: string; status: string; unit: { id: string; label: string }; property: { id: string; name: string }; monthlyCents?: number }[];
}

export function TenantsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['tenants', search, status], queryFn: () => api<TenantRow[]>(`/tenants?status=${status}&search=${encodeURIComponent(search)}`) });
  return (
    <>
      <PageHeader title="Mieter" subtitle={data ? `${data.length} Mieter` : undefined} actions={can('tenant:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Mieter erfassen</Button>} />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Name, Firma oder E-Mail" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} options={{ active: 'Aktive Mieter', former: 'Ehemalige', all: 'Alle' }} />
        </div>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Keine Mieter gefunden" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Mieter</th><th>Objekt</th><th>Kontakt</th>{can('finance:read') && <th className="num">Miete</th>}{can('finance:read') && <th className="num">Offen</th>}<th>App</th></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/mieter/${t.id}`)}>
                    <td className="font-medium text-slate-900">{tenantName(t)}</td>
                    <td className="text-slate-600">{t.leases.map((l) => <div key={l.id}>{l.property.name} · {l.unit.label}</div>)}</td>
                    <td className="text-xs text-slate-500"><div>{t.email}</div><div>{t.phone}</div></td>
                    {can('finance:read') && <td className="num">{chf(t.leases.reduce((s, l) => s + (l.monthlyCents ?? 0), 0))}</td>}
                    {can('finance:read') && <td className="num">{t.openCents ? <span className="font-medium text-red-700">{chf(t.openCents)}</span> : <span className="text-slate-400">–</span>}</td>}
                    <td>{t.portalAccess ? <Badge tone="green"><Smartphone className="h-3 w-3" />Aktiv</Badge> : <span className="text-xs text-slate-400">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <TenantForm onClose={() => setOpen(false)} />}
    </>
  );
}

type TenantData = Record<string, unknown> & { id: string };
export function TenantForm({ onClose, initial, onCreated }: { onClose: () => void; initial?: TenantData; onCreated?: (id: string) => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({
    isCompany: (initial?.isCompany as boolean) ?? false,
    firstName: (initial?.firstName as string) ?? '',
    lastName: (initial?.lastName as string) ?? '',
    companyName: (initial?.companyName as string) ?? '',
    email: (initial?.email as string) ?? '',
    phone: (initial?.phone as string) ?? '',
    street: (initial?.street as string) ?? '',
    zip: (initial?.zip as string) ?? '',
    city: (initial?.city as string) ?? '',
    iban: (initial?.iban as string) ?? '',
    dateOfBirth: isoDate(initial?.dateOfBirth as string),
    notes: (initial?.notes as string) ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => {
      const body = { ...f, dateOfBirth: f.dateOfBirth || null };
      return initial ? api<{ id: string }>(`/tenants/${initial.id}`, { method: 'PATCH', body }) : api<{ id: string }>('/tenants', { body });
    },
    { success: 'Mieter gespeichert', invalidate: [['tenants'], ['tenant']], onSuccess: (r) => { onClose(); if (!initial) (onCreated ? onCreated(r.id) : navigate(`/mieter/${r.id}`)); } },
  );
  return (
    <Modal open onClose={onClose} title={initial ? 'Mieter bearbeiten' : 'Neuer Mieter'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={!f.isCompany ? 'primary' : 'secondary'} onClick={() => setF({ ...f, isCompany: false })}>Privatperson</Button>
        <Button size="sm" variant={f.isCompany ? 'primary' : 'secondary'} onClick={() => setF({ ...f, isCompany: true })}>Firma</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {f.isCompany && <Field label="Firmenname" className="sm:col-span-2"><Input value={f.companyName} onChange={set('companyName')} /></Field>}
        <Field label={f.isCompany ? 'Kontaktperson Vorname' : 'Vorname'}><Input value={f.firstName} onChange={set('firstName')} /></Field>
        <Field label={f.isCompany ? 'Kontaktperson Nachname' : 'Nachname'}><Input value={f.lastName} onChange={set('lastName')} /></Field>
        <Field label="E-Mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Strasse" className="sm:col-span-2"><Input value={f.street} onChange={set('street')} /></Field>
        <Field label="PLZ"><Input value={f.zip} onChange={set('zip')} /></Field>
        <Field label="Ort"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="IBAN" hint="Verbessert die automatische Zahlungserkennung"><Input value={f.iban} onChange={set('iban')} /></Field>
        {!f.isCompany && <Field label="Geburtsdatum"><Input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></Field>}
        <Field label="Notizen" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

interface TenantDetail extends TenantData {
  firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null; street: string | null; zip: string | null; city: string | null; iban: string | null; notes: string | null; createdAt: string;
  leases: { id: string; status: string; startDate: string; endDate: string | null; netRentCents: number; utilitiesCents: number; unit: { id: string; label: string; property: { id: string; name: string } } }[];
  user: { id: string; email: string; isActive: boolean; lastLoginAt: string | null } | null;
  damageReports: { id: string; ticketNumber: number; title: string; status: string; priority: string; createdAt: string }[];
  payerAliases?: { id: string; normalizedName: string; iban: string | null; timesConfirmed: number }[];
}

export function TenantDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState(can('finance:read') ? 'account' : 'leases');
  const [edit, setEdit] = useState(false);
  const [creds, setCreds] = useState<{ email: string; initialPassword: string } | null>(null);
  const [assign, setAssign] = useState(false);
  const [pay, setPay] = useState(false);
  const { data: t, isLoading } = useQuery({ queryKey: ['tenant', id], queryFn: () => api<TenantDetail>(`/tenants/${id}`) });
  const access = useAction(() => api<{ email: string; initialPassword: string }>(`/tenants/${id}/portal-access`, { body: {} }), { success: 'Zugang erstellt', invalidate: [['tenant', id!]], onSuccess: setCreds });
  if (isLoading || !t) return <Loading />;
  return (
    <>
      <PageHeader
        back="/mieter"
        title={tenantName(t)}
        subtitle={t.leases.filter((l) => l.status !== 'ENDED').map((l) => `${l.unit.property.name} · ${l.unit.label}`).join(' | ') || 'Kein aktives Mietverhältnis'}
        actions={
          <>
            {can('finance:write') && <Button icon={<Wallet className="h-4 w-4" />} onClick={() => setPay(true)}>Zahlung erfassen</Button>}
            {can('lease:write') && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAssign(true)}>Objekte zuweisen</Button>}
            {can('tenant:write') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Bearbeiten</Button>}
            {can('user:manage') && !t.user && <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} loading={access.isPending} onClick={() => access.mutate(undefined)}>Mieter-App-Zugang erstellen</Button>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Kontakt" className="lg:col-span-2">
          <KeyValue cols={3} items={[
            ['E-Mail', t.email ? <a href={`mailto:${t.email}`} className="inline-flex items-center gap-1 text-brand-700"><Mail className="h-3.5 w-3.5" />{t.email}</a> : null],
            ['Telefon', t.phone ? <a href={`tel:${t.phone}`} className="inline-flex items-center gap-1 text-brand-700"><Phone className="h-3.5 w-3.5" />{t.phone}</a> : null],
            ['Adresse', [t.street, [t.zip, t.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null],
            ...(can('finance:read') ? [['IBAN', t.iban] as [string, string | null]] : []),
            ['Erfasst am', formatDate(t.createdAt)],
            ['Notizen', t.notes],
          ]} />
        </Card>
        <Card title="Mieter-App">
          {t.user ? (
            <div className="text-sm">
              <Badge tone={t.user.isActive ? 'green' : 'gray'}>{t.user.isActive ? 'Zugang aktiv' : 'Deaktiviert'}</Badge>
              <p className="mt-2 text-slate-600">{t.user.email}</p>
              <p className="text-xs text-slate-500">Letzte Anmeldung: {formatDateTime(t.user.lastLoginAt)}</p>
            </div>
          ) : <p className="text-sm text-slate-500">Noch kein Zugang eingerichtet.</p>}
          {!!t.payerAliases?.length && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-1 text-xs font-medium text-slate-500">Gelernte Zahlernamen</p>
              <div className="flex flex-wrap gap-1">{t.payerAliases.map((a) => <Badge key={a.id} tone="blue">{a.normalizedName} ({a.timesConfirmed}×)</Badge>)}</div>
            </div>
          )}
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[...(can('finance:read') ? [{ key: 'account', label: 'Mieterkonto & Zahlungen' }] : []), { key: 'leases', label: 'Mietverträge', count: t.leases.length }, { key: 'damages', label: 'Mängel', count: t.damageReports.length }, { key: 'docs', label: 'Dokumente' }, { key: 'messages', label: 'Nachrichten' }]} />
      {tab === 'account' && <TenantAccount tenantId={t.id} />}
      {tab === 'leases' && (
        <Card bodyClassName="p-0">
          <table className="table-base">
            <thead><tr><th>Objekt</th><th>Beginn</th><th>Ende</th>{can('finance:read') && <th className="num">Miete / Monat</th>}<th>Status</th></tr></thead>
            <tbody>
              {t.leases.map((l) => (
                <tr key={l.id}>
                  <td><Link className="text-brand-700 hover:underline" to={`/mietvertraege/${l.id}`}>{l.unit.property.name} · {l.unit.label}</Link></td>
                  <td>{formatDate(l.startDate)}</td><td>{formatDate(l.endDate)}</td>
                  {can('finance:read') && <td className="num">{chf(l.netRentCents + l.utilitiesCents)}</td>}
                  <td><LeaseBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!t.leases.length && <EmptyState title="Keine Mietverträge" />}
        </Card>
      )}
      {tab === 'damages' && (
        <Card bodyClassName="p-0">
          {t.damageReports.length ? (
            <ul className="divide-y divide-slate-100">
              {t.damageReports.map((d) => (
                <li key={d.id}><Link to={`/maengel/${d.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50"><span className="text-sm">#{d.ticketNumber} {d.title}<span className="ml-2 text-xs text-slate-500">{formatDate(d.createdAt)}</span></span><span className="flex gap-1"><PriorityBadge priority={d.priority} /><DamageBadge status={d.status} /></span></Link></li>
              ))}
            </ul>
          ) : <EmptyState title="Keine Mängelmeldungen" />}
        </Card>
      )}
      {tab === 'docs' && <Card bodyClassName="p-0"><DocumentsPanel filter={{ tenantId: t.id }} /></Card>}
      {tab === 'messages' && <ConversationList filter={{ tenantId: t.id }} />}
      {edit && <TenantForm onClose={() => setEdit(false)} initial={t} />}
      {pay && <PaymentEntry tenantId={t.id} onClose={() => setPay(false)} />}
      {assign && <AssignUnits tenantId={t.id} rented={t.leases.filter((l) => l.status !== 'ENDED').map((l) => ({ id: l.unit.id, label: l.unit.label, property: l.unit.property.name }))} onClose={() => setAssign(false)} />}
      <Modal open={!!creds} onClose={() => setCreds(null)} title="Zugangsdaten Mieter-App" footer={<Button onClick={() => setCreds(null)}>Verstanden</Button>}>
        <p className="text-sm text-slate-600">Bitte übermitteln Sie diese Zugangsdaten sicher an den Mieter. Beim ersten Login muss ein eigenes Passwort gesetzt werden. Das Passwort wird nur einmal angezeigt.</p>
        <div className="mt-4 rounded-lg bg-slate-50 p-4 font-mono text-sm">
          <p>E-Mail: {creds?.email}</p>
          <p>Passwort: {creds?.initialPassword}</p>
        </div>
      </Modal>
    </>
  );
}

function AssignUnits({ tenantId, rented, onClose }: { tenantId: string; rented: { id: string; label: string; property?: string }[]; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['units', 'vacant'], queryFn: () => api<RentUnit[]>('/units?vacant=true') });
  if (!data) return null;
  return <RentOutForm fixedTenantId={tenantId} units={data} rented={rented} onClose={onClose} />;
}
