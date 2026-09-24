import { Check, Plus, RotateCcw, Search, Shuffle, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_METHODS, PAYMENT_SOURCES, PAYMENT_STATUS } from '@immo/shared';
import { api, openInline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, formatDate, formatDateTime, formatPeriod, isoDate, tenantName, toCents } from '@/lib/format';
import type { Payment } from '@/lib/types';
import { Button, Card, ConfidenceBar, EmptyState, Field, Input, KeyValue, Loading, Modal, PageHeader, Pagination, Select, Textarea } from '@/components/ui';
import { PaymentBadge } from '@/components/StatusBadge';
import { AllocationEditor, type AllocationValue } from '@/components/AllocationEditor';
import { DocumentsPanel } from '@/components/DocumentsPanel';

export function PaymentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState(false);
  const qs = new URLSearchParams({ page: String(page), pageSize: '50', ...(search && { search }), ...(status && { status }), ...(source && { source }) });
  const { data, isLoading } = useQuery({ queryKey: ['payments', qs.toString()], queryFn: () => api<{ items: Payment[]; total: number; sumCents: number; page: number; pageSize: number }>(`/payments?${qs}`) });
  const { data: review } = useQuery({ queryKey: ['payments', 'review-count'], queryFn: () => api<{ total: number }>('/payments?status=REVIEW&pageSize=1') });
  const inv = [['payments'], ['payment'], ['dashboard'], ['monthly'], ['tenant']];
  const autoOne = useAction((pid: string) => api<{ added: number; periods?: string[]; message?: string }>(`/payments/${pid}/auto-assign`, { body: {} }), {
    success: (r) => (r.added ? `Zugeordnet: ${(r.periods ?? []).map(formatPeriod).join(', ')}` : r.message ?? 'Nichts zuzuordnen'),
    invalidate: inv,
  });
  const autoAll = useAction(() => api<{ checked: number; assigned: number; failed: string[] }>('/payments/auto-assign-all', { body: {} }), {
    success: (r) => `${r.assigned} von ${r.checked} Zahlungen zugeordnet${r.failed.length ? ` – ${r.failed.length} bitte einzeln prüfen` : ''}`,
    invalidate: inv,
  });
  return (
    <>
      <PageHeader
        title="Zahlungen"
        subtitle={data ? `${data.total} Zahlungen · Summe ${chf(data.sumCents)}` : undefined}
        actions={
          <>
            {can('payment:import') && <Link to="/zahlungen/import"><Button variant="secondary" icon={<Upload className="h-4 w-4" />}>Kontoauszug einlesen</Button></Link>}
            {can('finance:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Zahlung erfassen</Button>}
          </>
        }
      />
      {!!review?.total && can('finance:write') && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="min-w-0 flex-1">
            <b>{review.total} Zahlung(en) «Zuordnung prüfen»:</b> Der Mieter ist bekannt, aber die Zahlung ist noch keinem Monat zugeordnet (z. B. weil die Monatsmiete im Programm erst später beginnt).
          </p>
          <Button size="sm" variant="secondary" onClick={() => { setStatus('REVIEW'); setPage(1); }}>Anzeigen</Button>
          <Button size="sm" loading={autoAll.isPending} onClick={() => autoAll.mutate(undefined)}>Alle automatisch zuordnen</Button>
        </div>
      )}
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Zahler, Referenz, Mieter oder Zahlungs-ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-52" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={PAYMENT_STATUS} placeholder="Alle Status" />
          <Select className="w-44" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} options={PAYMENT_SOURCES} placeholder="Alle Quellen" />
        </div>
        {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Keine Zahlungen gefunden" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Datum</th><th>Mieter</th><th>Monat</th><th className="num">Betrag</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.items.map((p) => {
                    const name = p.tenant ? tenantName(p.tenant) : null;
                    const payerDiffers = p.payerName && name && p.payerName.toLowerCase() !== name.toLowerCase();
                    // nicht zugeordneter Rest (Guthaben); Teilzahlungen zeigt der Status
                    const credit = p.assignments.length ? p.amountCents - p.assignments.reduce((a, x) => a + x.amountCents, 0) : 0;
                    return (
                      <tr key={p.id} className={`clickable ${p.reversedAt ? 'opacity-50' : ''}`} onClick={() => navigate(`/zahlungen/${p.id}`)}>
                        <td className="whitespace-nowrap">
                          {formatDate(p.bookingDate)}
                          <p className="text-xs text-slate-400">#{p.number} · {PAYMENT_SOURCES[p.source as keyof typeof PAYMENT_SOURCES]}</p>
                        </td>
                        <td>
                          <p className="font-medium text-slate-900">{name ?? p.payerName ?? '–'}</p>
                          <p className="text-xs text-slate-500">{[p.property && `${p.property.name} · ${p.unit?.label}`, payerDiffers && `Zahler: ${p.payerName}`].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="text-sm text-slate-600">{[...new Set(p.assignments.map((a) => a.rentCharge.period))].sort().map(formatPeriod).join(', ') || '–'}</td>
                        <td className="num whitespace-nowrap">
                          <p className="font-medium">{chf(p.amountCents)}</p>
                          {credit > 0 && <p className="text-xs text-violet-700">{chf(credit)} Guthaben</p>}
                        </td>
                        <td><PaymentBadge status={p.status} /></td>
                        <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {can('finance:write') && !p.reversedAt && p.status === 'REVIEW' && (
                            <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} loading={autoOne.isPending && autoOne.variables === p.id} onClick={() => autoOne.mutate(p.id)}>Zuordnen</Button>
                          )}
                          {can('finance:write') && !p.reversedAt && p.status === 'UNCLEAR' && (
                            <Button size="sm" variant="secondary" onClick={() => navigate(`/zahlungen/${p.id}?zuordnen=1`)}>Mieter wählen</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
      {open && <NewPaymentModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NewPaymentModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ bookingDate: isoDate(new Date()), amount: '', method: 'BANK_TRANSFER', reference: '', payerName: '', note: '' });
  const [alloc, setAlloc] = useState<AllocationValue>({ leaseId: null, allocations: [] });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => api<{ id: string }>('/payments', { body: { ...f, amountCents: toCents(f.amount), leaseId: alloc.leaseId, allocations: alloc.allocations } }), {
    success: 'Zahlung verbucht',
    invalidate: [['payments'], ['dashboard'], ['monthly']],
    onSuccess: (r) => { onClose(); navigate(`/zahlungen/${r.id}`); },
  });
  return (
    <Modal open onClose={onClose} title="Zahlung manuell erfassen" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} disabled={!toCents(f.amount)} onClick={() => save.mutate(undefined)}>Verbuchen</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Zahlungsdatum"><Input type="date" value={f.bookingDate} onChange={set('bookingDate')} /></Field>
        <Field label="Betrag (CHF)"><Input value={f.amount} onChange={set('amount')} inputMode="decimal" autoFocus /></Field>
        <Field label="Zahlungsart"><Select value={f.method} onChange={set('method')} options={PAYMENT_METHODS} /></Field>
        <Field label="Zahler"><Input value={f.payerName} onChange={set('payerName')} /></Field>
        <Field label="Referenz / Mitteilung" className="sm:col-span-2"><Input value={f.reference} onChange={set('reference')} /></Field>
      </div>
      <div className="mt-5 border-t border-slate-100 pt-5">
        <AllocationEditor amountCents={toCents(f.amount)} value={alloc} onChange={setAlloc} />
      </div>
      <Field label="Interne Notiz" className="mt-4"><Textarea rows={2} value={f.note} onChange={set('note')} /></Field>
    </Modal>
  );
}

interface PaymentDetail extends Payment {
  valueDate: string | null; createdAt: string; createdBy: { firstName: string; lastName: string } | null;
  lease: { id: string; unit: { label: string; property: { name: string } } } | null;
  document: { id: string; name: string } | null;
  assignments: { id: string; amountCents: number; automatic: boolean; rentCharge: { id: string; period: string; amountCents: number; paidCents: number; status: string } }[];
  importRow: { batchId: string; matchReasons: string[] } | null;
  history: { id: string; action: string; summary: string | null; createdAt: string; oldValues: unknown; newValues: unknown; user: { firstName: string; lastName: string } | null }[];
}

export function PaymentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [reassign, setReassign] = useState(params.get('zuordnen') === '1');
  const [reverse, setReverse] = useState(false);
  const { data: p, isLoading } = useQuery({ queryKey: ['payment', id], queryFn: () => api<PaymentDetail>(`/payments/${id}`) });
  const auto = useAction(() => api<{ added: number; periods?: string[]; message?: string }>(`/payments/${id}/auto-assign`, { body: {} }), {
    success: (r) => (r.added ? `Zugeordnet: ${(r.periods ?? []).map(formatPeriod).join(', ')}` : r.message ?? 'Nichts zuzuordnen'),
    invalidate: [['payment', id!], ['payments'], ['dashboard'], ['monthly'], ['tenant']],
  });
  if (isLoading || !p) return <Loading />;
  const assigned = p.assignments.reduce((s, a) => s + a.amountCents, 0);
  return (
    <>
      <PageHeader
        back="/zahlungen"
        title={<span className="flex items-center gap-3">Zahlung #{p.number} <PaymentBadge status={p.status} /></span>}
        subtitle={`${formatDate(p.bookingDate)} · ${chf(p.amountCents)}${p.tenant ? ` · ${tenantName(p.tenant)}` : ''}`}
        actions={can('finance:write') && !p.reversedAt && (
          <>
            <Button variant="secondary" icon={<Shuffle className="h-4 w-4" />} onClick={() => setReassign(true)}>Zuordnung ändern</Button>
            <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setReverse(true)}>Stornieren</Button>
          </>
        )}
      />
      {p.reversedAt && <div className="mb-5 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">Storniert am {formatDateTime(p.reversedAt)}: {p.reversalReason}</div>}
      {!p.reversedAt && can('finance:write') && ['REVIEW', 'UNCLEAR', 'PARTIAL', 'OVERPAID'].includes(p.status) && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="min-w-0 flex-1">
            {p.status === 'UNCLEAR'
              ? <><b>Kein Mieter zugeordnet.</b> Bitte den Mieter wählen.</>
              : p.status === 'REVIEW'
                ? <><b>Noch keinem Monat zugeordnet.</b> «Automatisch zuordnen» nimmt den Monat aus der Mitteilung bzw. dem Zahlungsdatum und trägt die Monatsmiete bei Bedarf nach.</>
                : <><b>{chf(p.amountCents - assigned)} noch nicht zugeordnet.</b> Automatisch auf die nächsten offenen Monate verteilen oder selbst zuordnen.</>}
          </p>
          {p.status !== 'UNCLEAR' && <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={auto.isPending} onClick={() => auto.mutate(undefined)}>Automatisch zuordnen</Button>}
          <Button size="sm" variant="secondary" icon={<Shuffle className="h-3.5 w-3.5" />} onClick={() => setReassign(true)}>{p.status === 'UNCLEAR' ? 'Mieter wählen' : 'Selbst zuordnen'}</Button>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Zahlungsdatensatz">
            <KeyValue cols={3} items={[
              ['Zahlungs-ID', `#${p.number}`], ['Zahlungsdatum', formatDate(p.bookingDate)], ['Valuta', formatDate(p.valueDate)],
              ['Betrag', <strong className="tabular-nums">{chf(p.amountCents)}</strong>], ['Sollbetrag', chf(p.expectedCents)], ['Zugeordnet', chf(assigned)],
              ['Mieter', p.tenant ? <Link className="text-brand-700" to={`/mieter/${p.tenant.id}`}>{tenantName(p.tenant)}</Link> : '–'],
              ['Immobilie / Wohnung', p.property ? `${p.property.name} · ${p.unit?.label}` : '–'],
              ['Mietvertrag', p.lease ? <Link className="text-brand-700" to={`/mietvertraege/${p.lease.id}`}>öffnen</Link> : '–'],
              ['Zahlungsmethode', PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS]], ['Quelle', PAYMENT_SOURCES[p.source as keyof typeof PAYMENT_SOURCES]],
              ['Vertrauensscore', p.confidence !== null ? <ConfidenceBar value={p.confidence} /> : 'manuell erfasst'],
              ['Zahler', p.payerName], ['IBAN Zahler', p.payerIban], ['Referenz', p.reference],
              ['Erfasst von', p.createdBy ? `${p.createdBy.firstName} ${p.createdBy.lastName}` : '–'], ['Erfasst am', formatDateTime(p.createdAt)],
              ['Beleg', p.document ? <button className="text-brand-700 hover:underline" onClick={() => openInline(`/documents/${p.document!.id}/download`)}>{p.document.name}</button> : '–'],
            ]} />
            {p.rawText && (
              <div className="mt-5">
                <p className="mb-1 text-xs text-slate-500">Originaltext</p>
                <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-700">{p.rawText}</pre>
              </div>
            )}
          </Card>
          <Card title="Zuordnung zu Monaten" bodyClassName="p-0">
            {p.assignments.length ? (
              <table className="table-base">
                <thead><tr><th>Monat</th><th className="num">Zugeordnet</th><th className="num">Soll Monat</th><th>Art</th></tr></thead>
                <tbody>{p.assignments.map((a) => <tr key={a.id}><td>{formatPeriod(a.rentCharge.period)}</td><td className="num font-medium">{chf(a.amountCents)}</td><td className="num">{chf(a.rentCharge.amountCents)}</td><td className="text-xs text-slate-500">{a.automatic ? 'automatisch (bestätigt)' : 'manuell'}</td></tr>)}</tbody>
              </table>
            ) : <EmptyState title="Nicht zugeordnet" text="Diese Zahlung ist noch keinem Monat zugeordnet." />}
            {p.amountCents - assigned > 0 && <p className="border-t border-slate-100 px-4 py-2.5 text-sm text-violet-700">Nicht zugeordneter Betrag (Guthaben): {chf(p.amountCents - assigned)}</p>}
          </Card>
          {p.importRow && (
            <Card title="Automatische Erkennung">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{p.importRow.matchReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <Link to={`/zahlungen/import/${p.importRow.batchId}`} className="mt-3 inline-block text-xs font-medium text-brand-700">Zum Import →</Link>
            </Card>
          )}
          <Card title="Belege" bodyClassName="p-0"><DocumentsPanel filter={{ paymentId: p.id }} defaultCategory="RECEIPT" /></Card>
        </div>
        <Card title="Änderungsverlauf" bodyClassName="p-0">
          <ol className="divide-y divide-slate-100">
            {p.history.map((h) => (
              <li key={h.id} className="px-5 py-3">
                <p className="text-sm text-slate-800">{h.summary}</p>
                <p className="text-xs text-slate-500">{formatDateTime(h.createdAt)} · {h.user ? `${h.user.firstName} ${h.user.lastName}` : 'System'}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {reassign && <ReassignModal payment={p} onClose={() => setReassign(false)} />}
      {reverse && <ReverseModal id={p.id} onClose={() => setReverse(false)} />}
    </>
  );
}

function ReassignModal({ payment, onClose }: { payment: PaymentDetail; onClose: () => void }) {
  const [alloc, setAlloc] = useState<AllocationValue>({ leaseId: payment.leaseId, allocations: [] });
  const [reason, setReason] = useState('');
  const save = useAction(() => api(`/payments/${payment.id}/reassign`, { body: { leaseId: alloc.leaseId, allocations: alloc.allocations, reason } }), {
    success: 'Zuordnung geändert', invalidate: [['payment', payment.id], ['payments'], ['monthly'], ['account']], onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title={`Zuordnung von Zahlung #${payment.number} ändern`} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} disabled={reason.length < 3} onClick={() => save.mutate(undefined)}>Änderung speichern</Button></>}>
      <p className="mb-4 text-sm text-slate-600">Betrag: <strong>{chf(payment.amountCents)}</strong>. Die bisherige Zuordnung wird ersetzt; alle Änderungen werden im Änderungsprotokoll festgehalten.</p>
      <AllocationEditor amountCents={payment.amountCents} value={alloc} onChange={setAlloc} initialLeaseId={payment.leaseId} />
      <Field label="Begründung (Pflicht)" className="mt-4"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function ReverseModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useAction(() => api(`/payments/${id}/reverse`, { body: { reason } }), { success: 'Zahlung storniert', invalidate: [['payment', id], ['payments'], ['monthly']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Zahlung stornieren" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button variant="danger" loading={save.isPending} disabled={reason.length < 3} onClick={() => save.mutate(undefined)}>Stornieren</Button></>}>
      <p className="mb-4 text-sm text-slate-600">Die Zahlung bleibt zur Nachvollziehbarkeit erhalten, wird aber nicht mehr berücksichtigt. Die zugeordneten Monate werden wieder offen.</p>
      <Field label="Grund (Pflicht)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
