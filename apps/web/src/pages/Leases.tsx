import { FileSignature, Pencil, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LEASE_STATUS } from '@immo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, currentPeriod, formatDate, formatPeriod, fromCents, isoDate, tenantName, toCents } from '@/lib/format';
import type { Charge, Lease, TenantRef } from '@/lib/types';
import { Button, Card, EmptyState, Field, Input, KeyValue, Loading, Modal, PageHeader, Select, StatCard, Tabs, Textarea } from '@/components/ui';
import { ChargeBadge, LeaseBadge } from '@/components/StatusBadge';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { TenantForm } from './Tenants';

export function LeasesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('ACTIVE,TERMINATED');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['leases', status], queryFn: () => api<Lease[]>(`/leases${status ? `?status=${status}` : ''}`) });
  const fin = can('finance:read');
  const total = data?.filter((l) => l.status !== 'ENDED').reduce((s, l) => s + l.netRentCents + l.utilitiesCents, 0) ?? 0;
  return (
    <>
      <PageHeader title="Mietverträge" subtitle={data ? `${data.length} Verträge${fin ? ` · Soll ${chf(total)} / Monat` : ''}` : undefined} actions={can('lease:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Mietvertrag erfassen</Button>} />
      <Card bodyClassName="p-0">
        <div className="border-b border-slate-100 p-3">
          <Select className="w-56" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'ACTIVE,TERMINATED', label: 'Laufende Verträge' }, { value: 'TERMINATED', label: 'Gekündigte' }, { value: 'DRAFT', label: 'Entwürfe' }, { value: 'ENDED', label: 'Beendete' }, { value: '', label: 'Alle' }]} />
        </div>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Keine Mietverträge" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Mieter</th><th>Objekt</th><th>Beginn</th><th>Ende</th>{fin && <th className="num">Netto</th>}{fin && <th className="num">NK</th>}{fin && <th className="num">Total</th>}<th>Status</th></tr></thead>
              <tbody>
                {data.map((l) => (
                  <tr key={l.id} className="clickable" onClick={() => navigate(`/mietvertraege/${l.id}`)}>
                    <td className="font-medium text-slate-900">{tenantName(l.tenant)}</td>
                    <td>{l.unit.property.name} · {l.unit.label}</td>
                    <td>{formatDate(l.startDate)}</td>
                    <td>{l.endDate ? <span className={new Date(l.endDate).getTime() - Date.now() < 90 * 86400000 ? 'font-medium text-amber-700' : ''}>{formatDate(l.endDate)}</span> : 'unbefristet'}</td>
                    {fin && <td className="num">{chf(l.netRentCents)}</td>}
                    {fin && <td className="num">{chf(l.utilitiesCents)}</td>}
                    {fin && <td className="num font-medium">{chf(l.netRentCents + l.utilitiesCents)}</td>}
                    <td><LeaseBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <LeaseForm onClose={() => setOpen(false)} />}
    </>
  );
}

interface UnitOption { id: string; label: string; property: { id: string; name: string }; leases: unknown[] }

export function LeaseForm({ onClose, unitId, initial }: { onClose: () => void; unitId?: string; initial?: Lease }) {
  const navigate = useNavigate();
  const { data: units } = useQuery({ queryKey: ['units'], queryFn: () => api<UnitOption[]>('/units'), enabled: !initial });
  const { data: tenants, refetch } = useQuery({ queryKey: ['tenants', 'all-min'], queryFn: () => api<(TenantRef & { id: string })[]>('/tenants?status=all'), enabled: !initial });
  const [newTenant, setNewTenant] = useState(false);
  const [f, setF] = useState({
    unitId: unitId ?? '',
    tenantId: '',
    status: initial?.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
    startDate: isoDate(initial?.startDate) || `${currentPeriod()}-01`,
    endDate: isoDate(initial?.endDate),
    chargesFrom: isoDate(initial?.chargesFrom),
    net: fromCents(initial?.netRentCents),
    util: fromCents(initial?.utilitiesCents ?? 0),
    deposit: fromCents(initial?.depositCents ?? 0),
    dueDay: String(initial?.dueDay ?? 1),
    notice: String(initial?.noticePeriodMonths ?? 3),
    paymentReference: initial?.paymentReference ?? '',
    notes: initial?.notes ?? '',
    applyFromPeriod: currentPeriod(),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const rentChanged = initial && (toCents(f.net) !== initial.netRentCents || toCents(f.util) !== initial.utilitiesCents);
  const save = useAction(
    () => {
      const common = {
        startDate: f.startDate, endDate: f.endDate || null, chargesFrom: f.chargesFrom || null, netRentCents: toCents(f.net), utilitiesCents: toCents(f.util), depositCents: toCents(f.deposit),
        dueDay: Number(f.dueDay), noticePeriodMonths: Number(f.notice), paymentReference: f.paymentReference, notes: f.notes,
      };
      return initial
        ? api<{ id: string }>(`/leases/${initial.id}`, { method: 'PATCH', body: { ...common, ...(rentChanged ? { applyFromPeriod: f.applyFromPeriod } : {}) } })
        : api<{ id: string }>('/leases', { body: { ...common, unitId: f.unitId, tenantId: f.tenantId, status: f.status } });
    },
    { success: 'Mietvertrag gespeichert', invalidate: [['leases'], ['lease'], ['unit'], ['property'], ['tenant']], onSuccess: (r) => { onClose(); if (!initial) navigate(`/mietvertraege/${r.id}`); } },
  );
  const vacant = units?.filter((u) => u.leases.length === 0 || u.id === unitId) ?? [];
  const olderStart = f.startDate && f.startDate < `${currentPeriod()}-01`;
  return (
    <Modal open onClose={onClose} title={initial ? 'Mietvertrag bearbeiten' : 'Neuer Mietvertrag'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!initial && (
          <>
            <Field label="Mietobjekt" className="sm:col-span-2">
              <Select value={f.unitId} onChange={set('unitId')} placeholder="Bitte wählen" options={vacant.map((u) => ({ value: u.id, label: `${u.property.name} · ${u.label}${u.leases.length ? ' (vermietet)' : ''}` }))} />
            </Field>
            <Field label="Mieter" className="sm:col-span-2">
              <div className="flex gap-2">
                <Select value={f.tenantId} onChange={set('tenantId')} placeholder="Bitte wählen" options={(tenants ?? []).map((t) => ({ value: t.id, label: tenantName(t) }))} />
                <Button variant="secondary" onClick={() => setNewTenant(true)}>Neu</Button>
              </div>
            </Field>
          </>
        )}
        <Field label="Mietbeginn"><Input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Mietende (optional)"><Input type="date" value={f.endDate} onChange={set('endDate')} /></Field>
        <Field label="Nettomiete (CHF)"><Input value={f.net} onChange={set('net')} inputMode="decimal" /></Field>
        <Field label="Nebenkosten-Akonto (CHF)"><Input value={f.util} onChange={set('util')} inputMode="decimal" /></Field>
        <Field label="Mietkaution (CHF)"><Input value={f.deposit} onChange={set('deposit')} inputMode="decimal" /></Field>
        <Field label="Fällig am (Tag im Monat)"><Input type="number" min={1} max={28} value={f.dueDay} onChange={set('dueDay')} /></Field>
        <Field label="Kündigungsfrist (Monate)"><Input type="number" value={f.notice} onChange={set('notice')} /></Field>
        <Field label="Zahlungsreferenz (z. B. QR-Referenz)" hint="Ermöglicht 100 % sichere Zuordnung"><Input value={f.paymentReference} onChange={set('paymentReference')} /></Field>
        {(olderStart || f.chargesFrom) && (
          <Field label="Sollstellungen ab" hint="Bei Übernahme bestehender Verträge: ab wann Mietforderungen im System geführt werden. Leer = aktueller Monat." className="sm:col-span-2">
            <Input type="date" value={f.chargesFrom} onChange={set('chargesFrom')} />
          </Field>
        )}
        {rentChanged && (
          <Field label="Neue Miete gilt ab Monat" hint="Nur noch unbezahlte Monate ab diesem Zeitpunkt werden angepasst." className="sm:col-span-2">
            <Input type="month" value={f.applyFromPeriod} onChange={set('applyFromPeriod')} />
          </Field>
        )}
        {!initial && (
          <Field label="Status"><Select value={f.status} onChange={set('status')} options={{ ACTIVE: LEASE_STATUS.ACTIVE, DRAFT: LEASE_STATUS.DRAFT }} /></Field>
        )}
        <Field label="Notizen" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {newTenant && <TenantForm onClose={() => setNewTenant(false)} onCreated={async (id) => { await refetch(); setF((x) => ({ ...x, tenantId: id })); }} />}
    </Modal>
  );
}

interface LeaseDetail extends Lease {
  terminatedAt: string | null; terminationReason: string | null; charges: Charge[];
  unit: Lease['unit'] & { property: { id: string; name: string; street: string; city: string } };
}

export function LeaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState('charges');
  const [edit, setEdit] = useState(false);
  const [terminate, setTerminate] = useState(false);
  const [charge, setCharge] = useState<Charge | null>(null);
  const { data: l, isLoading } = useQuery({ queryKey: ['lease', id], queryFn: () => api<LeaseDetail>(`/leases/${id}`) });
  if (isLoading || !l) return <Loading />;
  const fin = can('finance:read');
  const due = l.charges.filter((c) => new Date(c.dueDate) <= new Date() && c.status !== 'CANCELLED');
  const open = due.reduce((s, c) => s + Math.max(0, c.amountCents - c.paidCents), 0);
  return (
    <>
      <PageHeader
        back="/mietvertraege"
        title={<span className="flex items-center gap-3">{tenantName(l.tenant)} <LeaseBadge status={l.status} /></span>}
        subtitle={`${l.unit.property.name} · ${l.unit.label} · seit ${formatDate(l.startDate)}`}
        actions={can('lease:write') && (
          <>
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Bearbeiten</Button>
            {(l.status === 'ACTIVE') && <Button variant="secondary" icon={<XCircle className="h-4 w-4" />} onClick={() => setTerminate(true)}>Kündigung erfassen</Button>}
          </>
        )}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {fin && <StatCard label="Miete / Monat" value={chf(l.netRentCents + l.utilitiesCents)} sub={`Netto ${chf(l.netRentCents)} + NK ${chf(l.utilitiesCents)}`} />}
        {fin && <StatCard label="Offen (fällig)" value={chf(open)} tone={open ? 'bad' : 'good'} />}
        {fin && <StatCard label="Kaution" value={chf(l.depositCents)} />}
        <StatCard label="Vertragsende" value={l.endDate ? formatDate(l.endDate) : 'unbefristet'} sub={`Kündigungsfrist ${l.noticePeriodMonths} Monate`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[...(fin ? [{ key: 'charges', label: 'Sollstellungen & Zahlungen', count: l.charges.length }] : []), { key: 'details', label: 'Vertragsdetails' }, { key: 'docs', label: 'Dokumente' }]} />
      {tab === 'charges' && fin && (
        <Card bodyClassName="overflow-x-auto p-0">
          <table className="table-base">
            <thead><tr><th>Monat</th><th>Fällig</th><th className="num">Soll</th><th className="num">Bezahlt</th><th className="num">Offen</th><th>Status</th><th>Zahlungen</th><th /></tr></thead>
            <tbody>
              {l.charges.map((c) => (
                <tr key={c.id} className={c.status === 'CANCELLED' ? 'opacity-50' : ''}>
                  <td className="font-medium">{formatPeriod(c.period)}{c.note && <p className="text-xs font-normal text-slate-500">{c.note}</p>}</td>
                  <td>{formatDate(c.dueDate)}</td>
                  <td className="num">{chf(c.amountCents)}</td>
                  <td className="num">{chf(c.paidCents)}</td>
                  <td className="num">{c.status === 'CANCELLED' ? '–' : chf(Math.max(0, c.amountCents - c.paidCents))}</td>
                  <td><ChargeBadge status={c.status} /></td>
                  <td className="text-xs">{c.assignments?.filter((a) => !a.payment.reversedAt).map((a) => <Link key={a.payment.id} to={`/zahlungen/${a.payment.id}`} className="mr-2 text-brand-700 hover:underline">#{a.payment.number}</Link>)}</td>
                  <td>{can('finance:write') && c.status !== 'CANCELLED' && <Button size="sm" variant="ghost" onClick={() => setCharge(c)}>Anpassen</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === 'details' && (
        <Card title="Vertragsdetails">
          <KeyValue cols={3} items={[
            ['Mieter', <Link className="text-brand-700" to={`/mieter/${l.tenantId}`}>{tenantName(l.tenant)}</Link>],
            ['Objekt', <Link className="text-brand-700" to={`/objekte/${l.unitId}`}>{l.unit.property.name} · {l.unit.label}</Link>],
            ['Status', LEASE_STATUS[l.status as keyof typeof LEASE_STATUS]],
            ['Mietbeginn', formatDate(l.startDate)], ['Mietende', formatDate(l.endDate)], ['Sollstellungen ab', formatDate(l.chargesFrom ?? l.startDate)],
            ['Fälligkeit', `jeweils am ${l.dueDay}. des Monats (im Voraus)`], ['Zahlungsreferenz', l.paymentReference], ['Kündigungsfrist', `${l.noticePeriodMonths} Monate`],
            ...(l.terminatedAt ? [['Gekündigt am', formatDate(l.terminatedAt)] as [string, string], ['Kündigungsgrund', l.terminationReason] as [string, string | null]] : []),
            ['Notizen', l.notes],
          ]} />
        </Card>
      )}
      {tab === 'docs' && <Card bodyClassName="p-0"><DocumentsPanel filter={{ leaseId: l.id, tenantId: l.tenantId, unitId: l.unitId }} defaultCategory="LEASE" /></Card>}
      {edit && <LeaseForm onClose={() => setEdit(false)} initial={l} />}
      {terminate && <TerminateModal leaseId={l.id} onClose={() => setTerminate(false)} />}
      {charge && <ChargeModal charge={charge} onClose={() => setCharge(null)} />}
    </>
  );
}

function TerminateModal({ leaseId, onClose }: { leaseId: string; onClose: () => void }) {
  const [endDate, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const save = useAction(() => api(`/leases/${leaseId}/terminate`, { body: { endDate, reason } }), { success: 'Kündigung erfasst', invalidate: [['lease', leaseId], ['leases']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Kündigung erfassen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button variant="danger" icon={<FileSignature className="h-4 w-4" />} disabled={!endDate} loading={save.isPending} onClick={() => save.mutate(undefined)}>Kündigung speichern</Button></>}>
      <div className="space-y-4">
        <Field label="Mietende per"><Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Grund / Bemerkung"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Unbezahlte Sollstellungen nach dem Mietende werden automatisch storniert. Bereits bezahlte Monate bleiben unverändert.</p>
      </div>
    </Modal>
  );
}

function ChargeModal({ charge, onClose }: { charge: Charge; onClose: () => void }) {
  const [amount, setAmount] = useState(fromCents(charge.amountCents));
  const [reason, setReason] = useState('');
  const save = useAction((cancel: boolean) => api(`/charges/${charge.id}`, { method: 'PATCH', body: cancel ? { cancel: true, reason } : { amountCents: toCents(amount), reason } }), { success: 'Sollstellung angepasst', invalidate: [['lease'], ['account']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Sollstellung ${formatPeriod(charge.period)} anpassen`} footer={<>
      {charge.paidCents === 0 && <Button variant="danger" disabled={reason.length < 3} loading={save.isPending} onClick={() => save.mutate(true)}>Stornieren</Button>}
      <Button disabled={reason.length < 3} loading={save.isPending} onClick={() => save.mutate(false)}>Betrag speichern</Button></>}>
      <div className="space-y-4">
        <Field label="Sollbetrag (CHF)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Begründung (Pflicht, wird protokolliert)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Mietzinsreduktion wegen Heizungsausfall" /></Field>
      </div>
    </Modal>
  );
}
