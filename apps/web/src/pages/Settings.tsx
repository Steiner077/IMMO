import { Download, FileSpreadsheet, KeyRound, Megaphone, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROLES, ROLE_LABELS, ROLE_PERMISSIONS, formatPeriod, type Role } from '@immo/shared';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Property } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea } from '@/components/ui';

export function SettingsPage() {
  const { can } = useAuth();
  const tabs = [
    ...(can('settings:manage') || can('automation:manage') ? [{ key: 'org', label: 'Organisation & Automatik' }] : []),
    ...(can('user:manage') ? [{ key: 'users', label: 'Benutzer & Rollen' }] : []),
    ...(can('provider:read') ? [{ key: 'providers', label: 'Dienstleister' }] : []),
    ...(can('excel:sync') ? [{ key: 'excel', label: 'Excel-Synchronisierung' }] : []),
    ...(can('announcement:write') ? [{ key: 'announcements', label: 'Mitteilungen an Mieter' }] : []),
    { key: 'security', label: 'Sicherheit' },
  ];
  const [tab, setTab] = useState(tabs[0].key);
  return (
    <>
      <PageHeader title="Einstellungen" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'org' && <OrgSettings />}
      {tab === 'users' && <Users />}
      {tab === 'providers' && <Providers />}
      {tab === 'excel' && <ExcelSync />}
      {tab === 'announcements' && <Announcements />}
      {tab === 'security' && <Security />}
    </>
  );
}

interface Settings { organization: { name: string; currency: string }; settings: { autoReadyThreshold: number; reviewThreshold: number; overdueGraceDays: number; leaseExpiryNoticeDays: number; autoExcelSnapshot: boolean; chargesMonthsAhead: number; notifyTenantsOverdue: boolean } }

function OrgSettings() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  if (!data) return <Loading />;
  return <OrgForm data={data} readOnly={!can('settings:manage')} />;
}
function OrgForm({ data, readOnly }: { data: Settings; readOnly: boolean }) {
  const [name, setName] = useState(data.organization.name);
  const [s, setS] = useState(data.settings);
  const num = (k: keyof Settings['settings']) => (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) });
  const save = useAction(() => api('/settings', { method: 'PATCH', body: { name, settings: s } }), { success: 'Einstellungen gespeichert', invalidate: [['settings']] });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Organisation">
        <Field label="Name der Verwaltung"><Input disabled={readOnly} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="mt-3 text-xs text-slate-500">Währung: {data.organization.currency}. Alle Beträge werden intern exakt in Rappen gespeichert.</p>
      </Card>
      <Card title="Zahlungsautomatik">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="„Bereit“ ab Sicherheit (%)" hint="Darunter muss manuell geprüft werden"><Input disabled={readOnly} type="number" min={60} max={100} value={s.autoReadyThreshold} onChange={num('autoReadyThreshold')} /></Field>
          <Field label="Mieter vorschlagen ab (%)" hint="Darunter gilt die Zahlung als unklar"><Input disabled={readOnly} type="number" min={20} max={90} value={s.reviewThreshold} onChange={num('reviewThreshold')} /></Field>
          <Field label="Karenzfrist Überfälligkeit (Tage)"><Input disabled={readOnly} type="number" value={s.overdueGraceDays} onChange={num('overdueGraceDays')} /></Field>
          <Field label="Sollstellungen im Voraus (Monate)"><Input disabled={readOnly} type="number" min={0} max={12} value={s.chargesMonthsAhead} onChange={num('chargesMonthsAhead')} /></Field>
          <Field label="Vorlauf auslaufende Verträge (Tage)"><Input disabled={readOnly} type="number" value={s.leaseExpiryNoticeDays} onChange={num('leaseExpiryNoticeDays')} /></Field>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <label className="flex items-center gap-2"><input disabled={readOnly} type="checkbox" checked={s.autoExcelSnapshot} onChange={(e) => setS({ ...s, autoExcelSnapshot: e.target.checked })} /> Nach jeder Verbuchung aktuelle Excel-Auswertung ablegen</label>
          <label className="flex items-center gap-2"><input disabled={readOnly} type="checkbox" checked={s.notifyTenantsOverdue} onChange={(e) => setS({ ...s, notifyTenantsOverdue: e.target.checked })} /> Mieter in der App über offene Mieten informieren</label>
        </div>
        {!readOnly && <div className="mt-5 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></div>}
      </Card>
    </div>
  );
}

interface UserRow { id: string; email: string; firstName: string; lastName: string; phone: string | null; role: Role; isActive: boolean; lastLoginAt: string | null; propertyAccess: { propertyId: string; property: { name: string } }[] }

function Users() {
  const { user: me } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  const [creds, setCreds] = useState<string | null>(null);
  const reset = useAction((id: string) => api<{ initialPassword: string }>(`/users/${id}/reset-password`, { body: {} }), { onSuccess: (r) => setCreds(r.initialPassword) });
  return (
    <>
      <Card title="Benutzer" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Benutzer einladen</Button>} bodyClassName="overflow-x-auto p-0">
        {isLoading ? <Loading /> : (
          <table className="table-base">
            <thead><tr><th>Name</th><th>Rolle</th><th>Freigeschaltete Immobilien</th><th>Letzte Anmeldung</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td><p className="font-medium text-slate-900">{u.firstName} {u.lastName}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                  <td><Badge tone={u.role === 'TENANT' ? 'gray' : 'blue'}>{ROLE_LABELS[u.role]}</Badge></td>
                  <td className="text-xs text-slate-600">{['EMPLOYEE', 'CARETAKER'].includes(u.role) ? u.propertyAccess.map((a) => a.property.name).join(', ') || <span className="text-red-600">keine</span> : u.role === 'TENANT' ? 'eigene Mietverhältnisse' : u.role === 'SERVICE_PROVIDER' ? 'zugewiesene Tickets' : 'alle'}</td>
                  <td className="text-xs">{formatDateTime(u.lastLoginAt)}</td>
                  <td>{u.isActive ? <Badge tone="green">Aktiv</Badge> : <Badge>Deaktiviert</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    {u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Bearbeiten</Button>}
                    <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => confirm(`Passwort für ${u.email} zurücksetzen?`) && reset.mutate(u.id)}>Passwort</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Rollen & Berechtigungen" className="mt-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold">{ROLE_LABELS[r]}</p>
              <p className="mt-1 text-xs text-slate-500">{ROLE_PERMISSIONS[r].length} Berechtigungen{['EMPLOYEE', 'CARETAKER'].includes(r) ? ' · nur freigeschaltete Immobilien' : ''}{r === 'CARETAKER' ? ' · keine Finanzdaten' : ''}{r === 'TENANT' ? ' · ausschliesslich eigene Daten (Mieter-App)' : ''}</p>
            </div>
          ))}
        </div>
      </Card>
      {edit && <UserForm user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onCreated={setCreds} />}
      <Modal open={!!creds} onClose={() => setCreds(null)} title="Initiales Passwort" footer={<Button onClick={() => setCreds(null)}>Verstanden</Button>}>
        <p className="text-sm text-slate-600">Bitte übermitteln Sie das Passwort sicher. Es wird nur einmal angezeigt; beim ersten Login muss ein eigenes Passwort gesetzt werden.</p>
        <p className="mt-3 rounded-lg bg-slate-50 p-3 font-mono text-sm">{creds}</p>
      </Modal>
    </>
  );
}

function UserForm({ user, onClose, onCreated }: { user: UserRow | null; onClose: () => void; onCreated: (pw: string) => void }) {
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: () => api<{ id: string; name: string }[]>('/providers') });
  const [f, setF] = useState({ email: user?.email ?? '', firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', phone: user?.phone ?? '', role: (user?.role ?? 'EMPLOYEE') as Role, isActive: user?.isActive ?? true, serviceProviderId: '' });
  const [props, setProps] = useState<string[]>(user?.propertyAccess.map((a) => a.propertyId) ?? []);
  const save = useAction(() => (user ? api(`/users/${user.id}`, { method: 'PATCH', body: { firstName: f.firstName, lastName: f.lastName, phone: f.phone, role: f.role, isActive: f.isActive, propertyIds: props } }) : api<{ initialPassword?: string }>('/users', { body: { ...f, propertyIds: props, serviceProviderId: f.serviceProviderId || null } })), {
    success: 'Benutzer gespeichert', invalidate: [['users']], onSuccess: (r) => { onClose(); const pw = (r as { initialPassword?: string })?.initialPassword; if (pw) onCreated(pw); },
  });
  const scoped = ['EMPLOYEE', 'CARETAKER'].includes(f.role);
  return (
    <Modal open onClose={onClose} title={user ? 'Benutzer bearbeiten' : 'Benutzer einladen'} footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vorname"><Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
        <Field label="Nachname"><Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
        <Field label="E-Mail"><Input disabled={!!user} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Rolle" className="sm:col-span-2"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} options={ROLES.filter((r) => r !== 'TENANT' && r !== 'SUPER_ADMIN').map((r) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
        {f.role === 'SERVICE_PROVIDER' && !user && <Field label="Dienstleister" className="sm:col-span-2"><Select value={f.serviceProviderId} onChange={(e) => setF({ ...f, serviceProviderId: e.target.value })} placeholder="Bitte wählen" options={(providers ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>}
        {scoped && (
          <Field label="Freigeschaltete Immobilien" className="sm:col-span-2">
            <div className="space-y-1.5 rounded-lg border border-slate-200 p-3">
              {properties?.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.includes(p.id)} onChange={(e) => setProps(e.target.checked ? [...props, p.id] : props.filter((x) => x !== p.id))} />{p.name}</label>
              ))}
            </div>
          </Field>
        )}
        {user && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Zugang aktiv</label>}
      </div>
    </Modal>
  );
}

function Providers() {
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['providers'], queryFn: () => api<{ id: string; name: string; trade: string | null; contactName: string | null; email: string | null; phone: string | null; city: string | null; _count: { damageReports: number; expenses: number } }[]>('/providers') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', trade: '', contactName: '', email: '', phone: '', city: '' });
  const save = useAction(() => api('/providers', { body: f }), { success: 'Dienstleister gespeichert', invalidate: [['providers']], onSuccess: () => { setOpen(false); setF({ name: '', trade: '', contactName: '', email: '', phone: '', city: '' }); } });
  return (
    <Card title="Handwerker & Dienstleister" actions={can('provider:write') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Hinzufügen</Button>} bodyClassName="overflow-x-auto p-0">
      {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Keine Dienstleister" /> : (
        <table className="table-base">
          <thead><tr><th>Firma</th><th>Fachgebiet</th><th>Kontakt</th><th>Ort</th><th className="num">Aufträge</th></tr></thead>
          <tbody>{data.map((p) => <tr key={p.id}><td className="font-medium">{p.name}</td><td>{p.trade ?? '–'}</td><td className="text-xs">{p.contactName}<p>{p.phone}</p><p className="text-slate-500">{p.email}</p></td><td>{p.city ?? '–'}</td><td className="num">{p._count.damageReports}</td></tr>)}</tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Dienstleister hinzufügen" footer={<Button disabled={!f.name} loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['name', 'trade', 'contactName', 'email', 'phone', 'city'] as const).map((k) => (
            <Field key={k} label={{ name: 'Firma', trade: 'Fachgebiet', contactName: 'Kontaktperson', email: 'E-Mail', phone: 'Telefon', city: 'Ort' }[k]}><Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
          ))}
        </div>
      </Modal>
    </Card>
  );
}

interface TenantSyncPreview { jobId: string; sheet: string; rows: { row: number; action: string; label: string; changes: { field: string; label: string; from: unknown; to: unknown }[]; message?: string }[] }
interface ExcelUpdatePreview { jobId: string; changes: { sheet: string; row: number; label: string; period: string; from: number | null; to: number }[]; unmatchedRows: string[] }

function ExcelSync() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const tenantFile = useRef<HTMLInputElement>(null);
  const updateFile = useRef<HTMLInputElement>(null);
  const [tp, setTp] = useState<TenantSyncPreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [up, setUp] = useState<ExcelUpdatePreview | null>(null);
  const [upSel, setUpSel] = useState<number[]>([]);
  const { data: jobs } = useQuery({ queryKey: ['sync-jobs'], queryFn: () => api<{ id: string; kind: string; fileName: string | null; status: string; createdAt: string; appliedAt: string | null; documentId: string | null }[]>('/excel/jobs') });

  const previewTenants = useAction((file: File) => { const fd = new FormData(); fd.append('file', file); return api<TenantSyncPreview>('/excel/tenants/preview', { form: fd }); }, { onSuccess: (r) => { setTp(r); setSelected(r.rows.filter((x) => x.action === 'CREATE' || x.action === 'UPDATE').map((x) => x.row)); } });
  const applyTenants = useAction(() => api<{ created: number; updated: number }>(`/excel/tenants/${tp!.jobId}/apply`, { body: { rows: selected } }), { success: (r) => `${r.created} Mieter angelegt, ${r.updated} aktualisiert`, invalidate: [['tenants'], ['sync-jobs']], onSuccess: () => setTp(null) });
  const previewUpdate = useAction((file: File) => { const fd = new FormData(); fd.append('year', year); fd.append('file', file); return api<ExcelUpdatePreview>('/excel/update/preview', { form: fd }); }, { onSuccess: (r) => { setUp(r); setUpSel(r.changes.map((_, i) => i)); } });
  const applyUpdate = useAction(() => api<{ documentId: string; name: string; applied: number }>(`/excel/update/${up!.jobId}/apply`, { body: { changes: upSel } }), {
    success: (r) => `${r.applied} Zellen aktualisiert – neue Datei „${r.name}“ in Dokumente abgelegt`, invalidate: [['sync-jobs'], ['documents']], onSuccess: (r) => { setUp(null); download(`/documents/${r.documentId}/download`, r.name); },
  });
  const kindLabel: Record<string, string> = { TENANTS_IMPORT: 'Mieter-Import', EXCEL_UPDATE: 'Excel aktualisieren' };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm text-brand-900">Die Datenbank ist die führende Quelle. Excel wird angebunden, aber nie unkontrolliert überschrieben: Jede Synchronisierung zeigt zuerst eine Vorschau, und Ihre Originaldatei bleibt immer unverändert.</div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="1 · Excel exportieren">
          <p className="text-sm text-slate-600">Vollständige Auswertung mit Mietern, Monatsübersicht, Zahlungen und Ausgaben.</p>
          <div className="mt-4 flex gap-2"><Select className="w-28" value={year} onChange={(e) => setYear(e.target.value)} options={Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => ({ value: y, label: y }))} /><Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/excel/export?year=${year}`)}>Exportieren</Button></div>
        </Card>
        <Card title="2 · Mieter aus Excel synchronisieren">
          <p className="text-sm text-slate-600">Tabelle mit Spalten wie Nachname, Vorname, E-Mail, Telefon, IBAN. Neue Mieter werden angelegt, Änderungen vorab angezeigt. Leere Zellen überschreiben nie bestehende Daten.</p>
          <input ref={tenantFile} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && previewTenants.mutate(e.target.files[0])} />
          <Button className="mt-4" variant="secondary" icon={<Upload className="h-4 w-4" />} loading={previewTenants.isPending} onClick={() => tenantFile.current?.click()}>Datei prüfen</Button>
        </Card>
        <Card title="3 · Bestehende Excel-Datei aktualisieren">
          <p className="text-sm text-slate-600">Ihre Liste mit Monatsspalten (Januar–Dezember) wird mit den verbuchten Zahlungen abgeglichen. Das Ergebnis wird als neue Kopie gespeichert.</p>
          <input ref={updateFile} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && previewUpdate.mutate(e.target.files[0])} />
          <Button className="mt-4" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={previewUpdate.isPending} onClick={() => updateFile.current?.click()}>Datei abgleichen ({year})</Button>
        </Card>
      </div>
      <Card title="Verlauf" bodyClassName="p-0">
        {!jobs?.length ? <EmptyState title="Noch keine Synchronisierungen" /> : (
          <table className="table-base"><thead><tr><th>Datum</th><th>Art</th><th>Datei</th><th>Status</th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.id}><td>{formatDateTime(j.createdAt)}</td><td>{kindLabel[j.kind] ?? j.kind}</td><td>{j.fileName}</td><td>{j.status === 'APPLIED' ? <Badge tone="green">Angewendet {formatDate(j.appliedAt)}</Badge> : <Badge>Nur Vorschau</Badge>}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Modal open={!!tp} onClose={() => setTp(null)} title={`Vorschau Mieter-Synchronisierung (${tp?.sheet})`} size="xl" footer={<><Button variant="secondary" onClick={() => setTp(null)}>Abbrechen</Button><Button disabled={!selected.length} loading={applyTenants.isPending} onClick={() => applyTenants.mutate(undefined)}>{selected.length} Änderungen übernehmen</Button></>}>
        <table className="table-base">
          <thead><tr><th /><th>Zeile</th><th>Mieter</th><th>Aktion</th><th>Änderungen</th></tr></thead>
          <tbody>
            {tp?.rows.map((r) => (
              <tr key={r.row}>
                <td>{(r.action === 'CREATE' || r.action === 'UPDATE') && <input type="checkbox" checked={selected.includes(r.row)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.row] : selected.filter((x) => x !== r.row))} />}</td>
                <td>{r.row}</td><td className="font-medium">{r.label}</td>
                <td><Badge tone={{ CREATE: 'green', UPDATE: 'yellow', UNCHANGED: 'gray', SKIP: 'red' }[r.action] as 'green'}>{{ CREATE: 'Neu anlegen', UPDATE: 'Aktualisieren', UNCHANGED: 'Unverändert', SKIP: 'Übersprungen' }[r.action]}</Badge></td>
                <td className="text-xs">{r.message}{r.changes.map((c) => <p key={c.field}>{c.label}: <span className="text-red-700 line-through">{String(c.from ?? '–')}</span> → <span className="text-emerald-700">{String(c.to)}</span></p>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
      <Modal open={!!up} onClose={() => setUp(null)} title="Vorschau: Excel-Datei aktualisieren" size="xl" footer={<><Button variant="secondary" onClick={() => setUp(null)}>Abbrechen</Button><Button disabled={!upSel.length} loading={applyUpdate.isPending} onClick={() => applyUpdate.mutate(undefined)}>{upSel.length} Zellen in neue Kopie schreiben</Button></>}>
        {!up?.changes.length ? <EmptyState title="Keine Abweichungen" text="Die Excel-Datei stimmt mit den verbuchten Zahlungen überein." /> : (
          <table className="table-base">
            <thead><tr><th /><th>Blatt / Zeile</th><th>Mieter</th><th>Monat</th><th className="num">In Excel</th><th className="num">Laut System</th></tr></thead>
            <tbody>{up.changes.map((c, i) => <tr key={i}><td><input type="checkbox" checked={upSel.includes(i)} onChange={(e) => setUpSel(e.target.checked ? [...upSel, i] : upSel.filter((x) => x !== i))} /></td><td className="text-xs">{c.sheet} / {c.row}</td><td>{c.label}</td><td>{formatPeriod(c.period)}</td><td className="num text-red-700">{c.from ?? '–'}</td><td className="num text-emerald-700">{c.to.toFixed(2)}</td></tr>)}</tbody>
          </table>
        )}
        {!!up?.unmatchedRows.length && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><p className="font-medium">Nicht zugeordnete Zeilen (werden nicht verändert):</p>{up.unmatchedRows.slice(0, 20).map((r) => <p key={r}>{r}</p>)}</div>}
      </Modal>
    </div>
  );
}

function Announcements() {
  const { data } = useQuery({ queryKey: ['announcements'], queryFn: () => api<{ id: string; title: string; body: string; important: boolean; publishedAt: string; property: { name: string } | null }[]>('/announcements') });
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const [f, setF] = useState({ title: '', body: '', propertyId: '', important: false });
  const save = useAction(() => api('/announcements', { body: { ...f, propertyId: f.propertyId || null } }), { success: 'Mitteilung veröffentlicht', invalidate: [['announcements']], onSuccess: () => setF({ title: '', body: '', propertyId: '', important: false }) });
  const del = useAction((id: string) => api(`/announcements/${id}`, { method: 'DELETE' }), { invalidate: [['announcements']] });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Neue Mitteilung">
        <div className="space-y-4">
          <Field label="Empfänger"><Select value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })} placeholder="Alle Mieter" options={(properties ?? []).map((p) => ({ value: p.id, label: `Mieter von ${p.name}` }))} /></Field>
          <Field label="Titel"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Text"><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} /> Als wichtig markieren</label>
          <Button icon={<Megaphone className="h-4 w-4" />} disabled={!f.title || !f.body} loading={save.isPending} onClick={() => save.mutate(undefined)}>Veröffentlichen & benachrichtigen</Button>
        </div>
      </Card>
      <Card title="Veröffentlichte Mitteilungen" bodyClassName="p-0">
        {!data?.length ? <EmptyState title="Keine Mitteilungen" /> : (
          <ul className="divide-y divide-slate-100">{data.map((a) => <li key={a.id} className="flex gap-3 px-5 py-3"><div className="flex-1"><p className="text-sm font-medium">{a.important && <Badge tone="red" className="mr-1">Wichtig</Badge>}{a.title}</p><p className="text-xs text-slate-500">{formatDate(a.publishedAt)} · {a.property?.name ?? 'Alle Mieter'}</p><p className="mt-1 text-sm text-slate-600">{a.body}</p></div><button className="text-slate-300 hover:text-red-600" onClick={() => del.mutate(a.id)}><Trash2 className="h-4 w-4" /></button></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

function Security() {
  return (
    <Card title="Sicherheit & Datenschutz">
      <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
        <li>Anmeldung mit kurzlebigen Zugriffstoken (15 Min.) und rotierenden, serverseitig widerrufbaren Sitzungen (httpOnly-Cookie).</li>
        <li>Passwörter werden mit bcrypt gehasht; Kontosperre nach 5 Fehlversuchen, Begrenzung der Anmeldeversuche.</li>
        <li>Rollenbasierte Zugriffe mit Immobilien-Freigaben; Mieter sehen ausschliesslich eigene Daten.</li>
        <li>Alle finanziellen Buchungen laufen in serialisierbaren Datenbanktransaktionen; Änderungen werden unveränderlich protokolliert.</li>
        <li>Dateien werden nach Signatur geprüft und nur über berechtigte, authentifizierte Downloads ausgeliefert.</li>
        <li>Automatische Datenbank- und Datei-Backups (siehe Betriebshandbuch), Übertragung ausschliesslich via TLS.</li>
      </ul>
    </Card>
  );
}
