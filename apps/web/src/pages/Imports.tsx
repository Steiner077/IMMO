import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Loader2, Pencil, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, formatDate, formatDateTime, formatPeriod, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Badge, Button, Card, ConfidenceBar, EmptyState, Loading, Modal, PageHeader, StatCard, useToast } from '@/components/ui';
import { ImportBadge } from '@/components/StatusBadge';
import { AllocationEditor, type AllocationValue } from '@/components/AllocationEditor';

interface Batch { id: string; fileName: string; fileType: string; status: string; createdAt: string; postedAt: string | null; counts: Record<string, number>; creditCents: number; error: string | null }

const BATCH_STATUS: Record<string, { label: string; tone: 'gray' | 'green' | 'yellow' | 'red' | 'blue' }> = {
  ANALYZING: { label: 'Wird analysiert', tone: 'blue' },
  READY: { label: 'Bereit zur Prüfung', tone: 'yellow' },
  PARTIALLY_POSTED: { label: 'Teilweise verbucht', tone: 'yellow' },
  POSTED: { label: 'Verbucht', tone: 'green' },
  FAILED: { label: 'Fehler', tone: 'red' },
  DISCARDED: { label: 'Verworfen', tone: 'gray' },
};

export function ImportsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['imports'], queryFn: () => api<Batch[]>('/imports') });
  const upload = useAction(
    (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<{ id: string }>('/imports', { form: fd });
    },
    { invalidate: [['imports']], onSuccess: (r) => navigate(`/zahlungen/import/${r.id}`) },
  );
  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.(pdf|csv|xlsx|txt|xml)$/i.test(f.name)) return toast('Bitte PDF, camt-XML, CSV oder Excel (.xlsx) hochladen.', 'error');
    upload.mutate(f);
  };
  return (
    <>
      <PageHeader title="Zahlungen importieren" subtitle="Kontoauszug hochladen – das System erkennt Zahlungen, ordnet sie Mietern und Monaten zu und zeigt eine Vorschau." />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`mb-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
      >
        <input ref={input} type="file" hidden accept=".pdf,.xml,.csv,.xlsx,.txt" onChange={(e) => onFiles(e.target.files)} />
        {upload.isPending ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : <UploadCloud className="h-8 w-8 text-slate-400" />}
        <p className="mt-3 text-sm font-medium text-slate-800">{upload.isPending ? 'Datei wird hochgeladen …' : 'Kontoauszug hierher ziehen oder klicken'}</p>
        <p className="mt-1 text-xs text-slate-500">PDF-Kontoauszug · camt.053/054 (ISO 20022) · CSV-Export der Bank · Excel (.xlsx) — max. 25 MB</p>
        <div className="mt-4 flex gap-2 text-xs text-slate-500">
          <Badge><FileText className="h-3 w-3" /> PDF</Badge><Badge><FileText className="h-3 w-3" /> camt XML</Badge><Badge><FileSpreadsheet className="h-3 w-3" /> CSV</Badge><Badge><FileSpreadsheet className="h-3 w-3" /> Excel</Badge><Badge tone="gray">Bank-API (vorbereitet)</Badge>
        </div>
      </div>
      <Card title="Bisherige Importe" bodyClassName="p-0">
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Noch keine Importe" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Datei</th><th>Hochgeladen</th><th className="num">Eingänge</th><th>Ergebnis</th><th>Status</th></tr></thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => navigate(`/zahlungen/import/${b.id}`)}>
                    <td className="font-medium text-slate-900">{b.fileName}<span className="ml-2 text-xs text-slate-400">{b.fileType}</span></td>
                    <td>{formatDateTime(b.createdAt)}</td>
                    <td className="num">{chf(b.creditCents)}</td>
                    <td className="space-x-1 text-xs">
                      {b.counts.POSTED ? <Badge tone="blue">{b.counts.POSTED} verbucht</Badge> : null}
                      {b.counts.READY ? <Badge tone="green">{b.counts.READY} bereit</Badge> : null}
                      {b.counts.NEEDS_REVIEW ? <Badge tone="yellow">{b.counts.NEEDS_REVIEW} prüfen</Badge> : null}
                      {b.counts.UNMATCHED ? <Badge tone="red">{b.counts.UNMATCHED} unklar</Badge> : null}
                    </td>
                    <td><Badge tone={BATCH_STATUS[b.status]?.tone}>{BATCH_STATUS[b.status]?.label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

interface Row {
  id: string; rowIndex: number; bookingDate: string; amountCents: number; isCredit: boolean; payerName: string | null; payerIban: string | null; reference: string | null; rawText: string;
  suggestedLeaseId: string | null; suggestedPeriod: string | null; allocation: { chargeId: string; period: string; amountCents: number }[]; confidence: number; matchReasons: string[];
  status: string; confirmed: boolean; corrected: boolean; tenant: TenantRef | null; unit: { id: string; label: string } | null; property: { id: string; name: string } | null; monthlyCents: number | null;
  payment: { id: string; number: number } | null;
}
interface BatchDetail extends Omit<Batch, 'counts' | 'creditCents'> { meta: { format?: string; warnings?: string[]; iban?: string | null }; rows: Row[] }

const STEPS = ['Zahlung erkennen', 'Zahler erkennen', 'Mieter suchen', 'Betrag vergleichen', 'Offene Monate prüfen', 'Monat bestimmen', 'Vertrag vergleichen', 'Sicherheit berechnen'];

export function ImportDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'credit'>('credit');
  const [result, setResult] = useState<{ posted: number; failed: { rowId: string; error: string }[]; totalCents: number } | null>(null);
  const key = ['import', id];
  const { data: b, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<BatchDetail>(`/imports/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'ANALYZING' ? 1000 : false),
  });
  const inv = [key, ['imports'], ['dashboard'], ['payments'], ['monthly']];
  const toggle = useAction((r: Row) => api(`/imports/rows/${r.id}`, { method: 'PATCH', body: { confirmed: !r.confirmed } }), { invalidate: [key] });
  const ignore = useAction((r: Row) => api(`/imports/rows/${r.id}`, { method: 'PATCH', body: { ignore: r.status !== 'IGNORED' } }), { invalidate: [key] });
  const confirmReady = useAction(() => api<{ confirmed: number }>(`/imports/${id}/confirm-ready`, { body: {} }), { success: (r) => `${r.confirmed} sichere Zahlungen bestätigt`, invalidate: [key] });
  const post = useAction(() => api<{ posted: number; failed: { rowId: string; error: string }[]; totalCents: number }>(`/imports/${id}/post`, { body: {} }), { invalidate: inv, onSuccess: setResult });
  const reanalyze = useAction(() => api(`/imports/${id}/reanalyze`, { body: {} }), { success: 'Analyse neu gestartet', invalidate: [key] });
  const discard = useAction(() => api(`/imports/${id}/discard`, { body: {} }), { success: 'Import verworfen', invalidate: [['imports']], onSuccess: () => navigate('/zahlungen/import') });

  if (isLoading || !b) return <Loading />;

  if (b.status === 'ANALYZING') {
    return (
      <>
        <PageHeader back="/zahlungen/import" title={b.fileName} />
        <Card>
          <div className="flex flex-col items-center py-12 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
            <p className="mt-4 text-base font-semibold text-slate-900">Datei wird analysiert …</p>
            <p className="mt-1 text-sm text-slate-500">Die Automatisierung prüft jede Buchung Schritt für Schritt.</p>
            <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">{STEPS.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</div>
          </div>
        </Card>
      </>
    );
  }

  const credits = b.rows.filter((r) => r.isCredit);
  const rows = b.rows.filter((r) => (filter === 'all' ? true : filter === 'credit' ? r.isCredit : ['READY', 'NEEDS_REVIEW', 'UNMATCHED'].includes(r.status)));
  const confirmed = b.rows.filter((r) => r.confirmed && r.status !== 'POSTED');
  const confirmedSum = confirmed.reduce((s, r) => s + r.amountCents, 0);
  const count = (s: string) => b.rows.filter((r) => r.status === s).length;
  const editable = can('payment:import') && !['DISCARDED'].includes(b.status);

  return (
    <>
      <PageHeader
        back="/zahlungen/import"
        title={b.fileName}
        subtitle={`Hochgeladen ${formatDateTime(b.createdAt)} · ${BATCH_STATUS[b.status]?.label}${b.meta.iban ? ` · Konto ${b.meta.iban}` : ''}`}
        actions={editable && b.status !== 'POSTED' && (
          <>
            {!b.rows.some((r) => r.status === 'POSTED') && <Button variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => reanalyze.mutate(undefined)}>Neu analysieren</Button>}
            {!b.rows.some((r) => r.status === 'POSTED') && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => confirm('Import verwerfen?') && discard.mutate(undefined)}>Verwerfen</Button>}
          </>
        )}
      />
      {b.status === 'FAILED' && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Analyse fehlgeschlagen: {b.error}</div>}
      {b.meta.warnings?.map((w) => <div key={w} className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" />{w}</div>)}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Zahlungseingänge" value={credits.length} sub={chf(credits.reduce((s, r) => s + r.amountCents, 0))} />
        <StatCard label="Bereit zur Bestätigung" value={count('READY')} tone="good" />
        <StatCard label="Zuordnung prüfen" value={count('NEEDS_REVIEW')} tone={count('NEEDS_REVIEW') ? 'warn' : 'default'} />
        <StatCard label="Unklar" value={count('UNMATCHED')} tone={count('UNMATCHED') ? 'bad' : 'default'} />
        <StatCard label="Duplikate / ignoriert" value={count('DUPLICATE') + count('IGNORED')} />
        <StatCard label="Verbucht" value={count('POSTED')} />
      </div>

      {result && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${result.failed.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />{result.posted} Zahlungen über {chf(result.totalCents)} verbucht. Mieterkonten, Monatsübersicht, Dashboard und Excel-Auswertung wurden aktualisiert.</p>
          {result.failed.map((f) => <p key={f.rowId} className="mt-1">Nicht verbucht: {f.error}</p>)}
        </div>
      )}

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <div className="flex gap-1">
            {(['credit', 'open', 'all'] as const).map((k) => (
              <Button key={k} size="sm" variant={filter === k ? 'primary' : 'ghost'} onClick={() => setFilter(k)}>{{ credit: 'Zahlungseingänge', open: 'Offene', all: 'Alle Buchungen' }[k]}</Button>
            ))}
          </div>
          {editable && b.status !== 'POSTED' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} disabled={!count('READY')} loading={confirmReady.isPending} onClick={() => confirmReady.mutate(undefined)}>Alle sicheren bestätigen</Button>
              {can('payment:post') && (
                <Button variant="success" size="sm" disabled={!confirmed.length} loading={post.isPending} onClick={() => confirm(`${confirmed.length} bestätigte Zahlungen über ${chf(confirmedSum)} verbuchen?`) && post.mutate(undefined)}>
                  Alle bestätigten Zahlungen verbuchen ({confirmed.length} · {chf(confirmedSum)})
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th className="w-10" /><th>Zahler / Referenz</th><th>Datum</th><th className="num">Betrag</th><th>Erkannter Mieter / Wohnung</th><th>Vorgeschlagener Monat</th><th>Sicherheit</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const done = r.status === 'POSTED';
                const canConfirm = editable && !done && !!r.suggestedLeaseId && !['IGNORED', 'DUPLICATE'].includes(r.status);
                return (
                  <Fragment key={r.id}>
                    <tr className={`${r.confirmed && !done ? 'bg-emerald-50/50' : ''} ${!r.isCredit || r.status === 'IGNORED' || r.status === 'DUPLICATE' ? 'text-slate-400' : ''}`}>
                      <td>
                        {done ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : (
                          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-emerald-600" disabled={!canConfirm} checked={r.confirmed} onChange={() => toggle.mutate(r)} title="Zur Verbuchung bestätigen" />
                        )}
                      </td>
                      <td>
                        <button className="flex items-center gap-1 text-left font-medium text-slate-900" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                          {expanded === r.id ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                          {r.payerName ?? '–'}
                        </button>
                        <p className="max-w-64 truncate pl-4.5 text-xs text-slate-500" title={r.reference ?? ''}>{!r.isCredit && 'Belastung · '}{r.reference ?? ''}</p>
                      </td>
                      <td className="whitespace-nowrap">{formatDate(r.bookingDate)}</td>
                      <td className="num font-medium whitespace-nowrap">{r.isCredit ? '' : '−'}{chf(r.amountCents)}</td>
                      <td>
                        {r.tenant ? <span className="font-medium text-slate-800">{tenantName(r.tenant)}</span> : <span className="text-slate-400">–</span>}
                        {r.corrected && <Badge tone="purple" className="ml-1">korrigiert</Badge>}
                        {r.unit && <p className="text-xs whitespace-nowrap text-slate-500">{r.property?.name} · {r.unit.label}</p>}
                      </td>
                      <td>{r.allocation.length ? r.allocation.map((a) => formatPeriod(a.period)).join(', ') : r.suggestedPeriod ? formatPeriod(r.suggestedPeriod) : '–'}</td>
                      <td>{r.isCredit && !['DUPLICATE', 'IGNORED'].includes(r.status) ? <ConfidenceBar value={r.confidence} /> : null}</td>
                      <td>{done && r.payment ? <Link to={`/zahlungen/${r.payment.id}`}><Badge tone="blue">Verbucht #{r.payment.number}</Badge></Link> : <ImportBadge status={r.status} />}</td>
                      <td className="whitespace-nowrap">
                        {editable && !done && r.isCredit && (
                          <>
                            <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Zuordnung korrigieren" onClick={() => setEditRow(r)}><Pencil className="h-4 w-4" /></button>
                            <button className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => ignore.mutate(r)}>{r.status === 'IGNORED' ? 'Wieder aufnehmen' : 'Ignorieren'}</button>
                          </>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td />
                        <td colSpan={8} className="bg-slate-50/60">
                          <div className="grid gap-4 py-1 md:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-medium text-slate-500">Begründung der Automatik</p>
                              <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700">{r.matchReasons.map((m, i) => <li key={i}>{m}</li>)}</ul>
                              {r.allocation.length > 0 && <p className="mt-2 text-xs text-slate-600">Aufteilung: {r.allocation.map((a) => `${formatPeriod(a.period)} ${chf(a.amountCents)}`).join(' · ')}</p>}
                              {r.monthlyCents !== null && <p className="mt-1 text-xs text-slate-600">Vertragliche Monatsmiete: {chf(r.monthlyCents)}</p>}
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium text-slate-500">Originaltext{r.payerIban && ` · IBAN ${r.payerIban}`}</p>
                              <pre className="font-mono text-xs whitespace-pre-wrap text-slate-600">{r.rawText}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="Keine Buchungen in dieser Ansicht" />}
        </div>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Sicherheit: Es wird nur verbucht, was Sie ausdrücklich bestätigt haben. Unsichere oder mehrdeutige Zuordnungen müssen manuell geprüft werden. Korrekturen werden für künftige Importe gelernt.</p>
      {editRow && <RowEditModal row={editRow} onClose={() => setEditRow(null)} invalidateKey={key} />}
    </>
  );
}

function RowEditModal({ row, onClose, invalidateKey }: { row: Row; onClose: () => void; invalidateKey: unknown[] }) {
  const [alloc, setAlloc] = useState<AllocationValue>({ leaseId: row.suggestedLeaseId, allocations: [] });
  const save = useAction(
    () => api(`/imports/rows/${row.id}`, { method: 'PATCH', body: alloc.leaseId ? { leaseId: alloc.leaseId, allocation: alloc.allocations, confirmed: true } : { leaseId: null } }),
    { success: 'Zuordnung korrigiert und bestätigt', invalidate: [invalidateKey], onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Zuordnung korrigieren" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{alloc.leaseId ? 'Übernehmen & bestätigen' : 'Zuordnung entfernen'}</Button></>}>
      <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
        <p><strong>{row.payerName}</strong> · {formatDate(row.bookingDate)} · <strong>{chf(row.amountCents)}</strong></p>
        <p className="text-xs text-slate-500">{row.reference}</p>
      </div>
      <AllocationEditor amountCents={row.amountCents} value={alloc} onChange={setAlloc} initialLeaseId={row.suggestedLeaseId} initialPeriod={row.suggestedPeriod} />
      <p className="mt-3 text-xs text-slate-500">Die Korrektur wird gespeichert und für künftige Zahlungen von „{row.payerName}“ berücksichtigt (Lernlogik).</p>
    </Modal>
  );
}
