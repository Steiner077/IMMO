import { AlertTriangle, CalendarRange, Camera, Check, EyeOff, Undo2, Sparkles, UserSearch, CheckCircle2, ChevronDown, ChevronRight, ClipboardPaste, FileSpreadsheet, FileText, Loader2, Pencil, RefreshCw, ScanLine, ShieldCheck, ShieldAlert, Trash2, UploadCloud } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, formatDate, formatDateTime, formatPeriod, fromCents, isoDate, tenantName, toCents } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, StatCard, Tabs, Textarea, useToast } from '@/components/ui';
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
  const camera = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [text, setText] = useState('');
  const paste = useAction(() => api<{ id: string }>('/imports/text', { body: { text } }), { invalidate: [['imports']], onSuccess: (r) => navigate(`/zahlungen/import/${r.id}`) });
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
    if (!/\.(pdf|csv|xlsx|txt|xml|jpe?g|png|webp)$/i.test(f.name)) return toast('Bitte PDF, Foto/Scan (JPG, PNG), camt-XML, CSV oder Excel hochladen.', 'error');
    upload.mutate(f);
  };
  return (
    <>
      <PageHeader title="Kontoauszug einlesen" subtitle="PDF, Scan oder Foto hochladen – das Programm erkennt die Zahlungen und ordnet sie Mietern und Monaten zu. Verbucht wird erst nach Ihrer Bestätigung." />
      <Tabs value={mode} onChange={(k) => setMode(k as 'file' | 'paste')} tabs={[{ key: 'file', label: <span className="flex items-center gap-2"><UploadCloud className="h-4 w-4" />PDF, Scan oder Foto</span> }, { key: 'paste', label: <span className="flex items-center gap-2"><ClipboardPaste className="h-4 w-4" />Text einfügen</span> }]} />
      {mode === 'paste' ? (
        <Card className="mb-6">
          <p className="mb-3 text-sm text-slate-600">Öffnen Sie den Kontoauszug (PDF oder E-Banking), markieren Sie alles (<kbd className="rounded border px-1 text-xs">Ctrl/⌘ A</kbd>), kopieren Sie es (<kbd className="rounded border px-1 text-xs">Ctrl/⌘ C</kbd>) und fügen Sie es hier ein.</p>
          <Textarea rows={14} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'01.09.2026 Saldovortrag 12\'400.00\n03.09.2026 Gutschrift 1\'850.00 03.09.2026 14\'250.00\nPeter Müller\nMitteilung: Mietzins September Wohnung 3A\n…'} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />Enthält der Text den Kontosaldo, prüft das System jeden Betrag per Saldo-Kontrolle.</p>
            <Button icon={<ScanLine className="h-4 w-4" />} disabled={text.trim().length < 20} loading={paste.isPending} onClick={() => paste.mutate(undefined)}>Text analysieren</Button>
          </div>
        </Card>
      ) : (
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`mb-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
      >
        <input ref={input} type="file" hidden accept=".pdf,.xml,.csv,.xlsx,.txt,.jpg,.jpeg,.png,.webp,image/*" onChange={(e) => onFiles(e.target.files)} />
        <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => onFiles(e.target.files)} />
        {upload.isPending ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : <UploadCloud className="h-8 w-8 text-slate-400" />}
        <p className="mt-3 text-sm font-medium text-slate-800">{upload.isPending ? 'Datei wird hochgeladen …' : 'Kontoauszug hierher ziehen oder klicken'}</p>
        <p className="mt-1 text-xs text-slate-500">PDF-Kontoauszug · eingescannter Ausdruck · Foto (JPG/PNG) · camt-XML · CSV · Excel — max. 25 MB</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-slate-500">
          <Badge><FileText className="h-3 w-3" /> PDF</Badge><Badge><ScanLine className="h-3 w-3" /> Scan (Texterkennung)</Badge><Badge><Camera className="h-3 w-3" /> Foto</Badge><Badge><FileSpreadsheet className="h-3 w-3" /> CSV / Excel</Badge><Badge><FileText className="h-3 w-3" /> camt XML</Badge>
        </div>
        <Button className="mt-4 md:hidden" variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); camera.current?.click(); }}>Ausdruck fotografieren</Button>
      </div>
      )}
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
  suggestedLeaseId: string | null; suggestedPeriod: string | null; allocation: { chargeId: string; period: string; amountCents: number; label?: string }[]; confidence: number; matchReasons: string[];
  status: string; confirmed: boolean; corrected: boolean; balanceVerified: boolean | null; tenant: TenantRef | null; unit: { id: string; label: string } | null; property: { id: string; name: string } | null; monthlyCents: number | null;
  payment: { id: string; number: number } | null;
}
interface BatchDetail extends Omit<Batch, 'counts' | 'creditCents'> { meta: { format?: string; warnings?: string[]; iban?: string | null; ocr?: boolean; ai?: boolean; balanceCheck?: { verified: number; checked: number; corrected: number } | null }; rows: Row[] }

/** Kurz, warum eine Zeile geprüft werden muss */
function reviewHint(r: Row): string | null {
  const hint = r.matchReasons.find((m) => /ähnlich|weicht|Mehrdeutig|nicht erkannt|Duplikat|Initiale|^Nachname "|Teilzahlung|Überzahlung|Restbetrag|kontrollieren|passt nicht|Abrechnungsbeginn/i.test(m));
  return hint ?? null;
}

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
  const reanalyzeAi = useAction(() => api(`/imports/${id}/reanalyze`, { body: { ai: true } }), { success: 'Die KI liest den Auszug – das kann bis zu einer Minute dauern', invalidate: [key] });
  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ enabled: boolean }>('/ai/status'), staleTime: 300_000 });
  const backfill = useAction(() => api<{ updated: number }>(`/imports/${id}/backfill-charges`, { body: {} }), { success: (r) => `Sollstellungen für ${r.updated} Verträge nachgetragen – Import neu zugeordnet`, invalidate: inv });
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
            {aiStatus?.enabled && !b.meta.ai && !b.rows.some((r) => r.status === 'POSTED') && ['PDF', 'IMAGE', 'TEXT'].includes(b.fileType) && <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={reanalyzeAi.isPending} title="Nur wenn die kostenlose Erkennung nicht reicht – kostet wenige Rappen" onClick={() => confirm('Den Auszug kostenpflichtig mit der KI einlesen (wenige Rappen)?') && reanalyzeAi.mutate(undefined)}>Mit KI einlesen</Button>}
            {!b.rows.some((r) => r.status === 'POSTED') && <Button variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => reanalyze.mutate(undefined)}>Neu analysieren</Button>}
            {!b.rows.some((r) => r.status === 'POSTED') && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => confirm('Import verwerfen?') && discard.mutate(undefined)}>Verwerfen</Button>}
          </>
        )}
      />
      {b.status === 'FAILED' && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Analyse fehlgeschlagen: {b.error}</div>}
      {b.meta.balanceCheck && (
        <div className={`mb-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${b.meta.balanceCheck.verified === b.meta.balanceCheck.checked ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {b.meta.balanceCheck.verified === b.meta.balanceCheck.checked ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          Saldo-Kontrolle: {b.meta.balanceCheck.verified} von {b.meta.balanceCheck.checked} Buchungen stimmen exakt mit dem Kontosaldo überein{b.meta.ai ? ' (von der KI gelesen)' : b.meta.ocr ? ' (Texterkennung)' : ''}.
        </div>
      )}
      {b.meta.warnings?.filter((w) => !w.startsWith('Saldo-Kontrolle: ') || !b.meta.balanceCheck).map((w) => <div key={w} className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" />{w}</div>)}

      {(() => {
        const early = b.rows.filter((r) => r.status !== 'POSTED' && r.matchReasons.some((m) => m.startsWith('Zahlung liegt vor dem Abrechnungsbeginn')));
        if (!early.length) return null;
        const first = early.reduce((min, r) => (r.bookingDate < min ? r.bookingDate : min), early[0].bookingDate);
        return (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <CalendarRange className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              <b>{early.length} Zahlung(en) sind älter als die erfassten Monatsmieten</b> (ab {formatDate(first)}). Mit «Monate nachtragen» werden die fehlenden Monatsmieten angelegt und die Zahlungen dem richtigen Monat zugeordnet – nie vor Mietbeginn.
            </p>
            {editable && can('lease:write') && !b.rows.some((r) => r.status === 'POSTED') && (
              <Button size="sm" loading={backfill.isPending} onClick={() => backfill.mutate(undefined)}>Monate nachtragen</Button>
            )}
          </div>
        );
      })()}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Zahlungseingänge" value={credits.length} sub={chf(credits.reduce((s, r) => s + r.amountCents, 0))} />
        <StatCard label="Sicher erkannt" value={count('READY')} tone="good" />
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

      {editable && b.status !== 'POSTED' && (count('NEEDS_REVIEW') > 0 || count('UNMATCHED') > 0 || count('READY') > 0 || confirmed.length > 0) && (
        <ol className="mb-4 grid gap-2 text-sm md:grid-cols-3">
          <li className={`rounded-xl border px-4 py-3 ${count('NEEDS_REVIEW') + count('UNMATCHED') ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-500'}`}>
            <b>1. Prüfen</b> – bei jeder gelben/roten Zeile auf <b>«Stimmt»</b> klicken oder mit <b>«Ändern» / «Mieter wählen»</b> korrigieren.
            {count('NEEDS_REVIEW') + count('UNMATCHED') > 0 && <span className="block text-xs">Noch {count('NEEDS_REVIEW') + count('UNMATCHED') - b.rows.filter((r) => r.confirmed && ['NEEDS_REVIEW', 'UNMATCHED'].includes(r.status)).length} offen</span>}
          </li>
          <li className={`rounded-xl border px-4 py-3 ${count('READY') ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-500'}`}>
            <b>2. Sichere bestätigen</b> – «Alle sicheren bestätigen» übernimmt alle Zeilen «Sicher erkannt» auf einmal.
          </li>
          <li className={`rounded-xl border px-4 py-3 ${confirmed.length ? 'border-brand-200 bg-brand-50 text-brand-900' : 'border-slate-200 bg-white text-slate-500'}`}>
            <b>3. Verbuchen</b> – «Alle bestätigten Zahlungen verbuchen». Erst dann werden die Mieten als bezahlt markiert.
          </li>
        </ol>
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
              <tr><th>Zahler / Mitteilung</th><th>Datum</th><th className="num">Betrag</th><th>Mieter / Objekt</th><th>Monat</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const done = r.status === 'POSTED';
                const canConfirm = editable && !done && !!r.suggestedLeaseId && !['IGNORED', 'DUPLICATE'].includes(r.status);
                return (
                  <Fragment key={r.id}>
                    <tr className={`${r.confirmed && !done ? 'bg-emerald-50/50' : ''} ${!r.isCredit || r.status === 'IGNORED' || r.status === 'DUPLICATE' ? 'text-slate-400' : ''}`}>
                      <td>
                        <button className="flex items-center gap-1 text-left font-medium text-slate-900" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                          {expanded === r.id ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                          {r.payerName ?? '–'}
                        </button>
                        <p className="max-w-52 truncate pl-4.5 text-xs text-slate-500" title={r.reference ?? ''}>{!r.isCredit && 'Belastung · '}{r.reference ?? ''}</p>
                      </td>
                      <td className="whitespace-nowrap">{formatDate(r.bookingDate)}</td>
                      <td className="num font-medium whitespace-nowrap">
                        {r.isCredit ? '' : '−'}{chf(r.amountCents)}
                        {r.balanceVerified === true && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-emerald-600" aria-label="Durch Saldo bestätigt" />}
                        {r.balanceVerified === false && <ShieldAlert className="ml-1 inline h-3.5 w-3.5 text-amber-600" aria-label="Passt nicht zum Saldo" />}
                      </td>
                      <td>
                        {r.tenant ? <span className="font-medium text-slate-800">{tenantName(r.tenant)}</span> : <span className="text-slate-400">–</span>}
                        {r.corrected && <Badge tone="purple" className="ml-1">korrigiert</Badge>}
                        {r.unit && <p className="text-xs whitespace-nowrap text-slate-500">{r.property?.name} · {r.unit.label}</p>}
                        {r.status === 'NEEDS_REVIEW' && !r.confirmed && reviewHint(r) && <p className="mt-0.5 max-w-60 text-xs text-amber-700">{reviewHint(r)}</p>}
                      </td>
                      <td>{r.allocation.length ? [...new Set(r.allocation.map((a) => formatPeriod(a.period)))].join(', ') : r.suggestedPeriod ? formatPeriod(r.suggestedPeriod) : '–'}
                        {new Set(r.allocation.map((a) => a.label)).size > 1 && <p className="text-xs text-slate-500">{r.allocation.map((a) => a.label).join(' + ')}</p>}</td>
                      <td className="whitespace-nowrap">
                        {done && r.payment ? <Link to={`/zahlungen/${r.payment.id}`}><Badge tone="blue">Verbucht #{r.payment.number}</Badge></Link> : r.confirmed ? <Badge tone="green"><Check className="mr-0.5 inline h-3 w-3" />Bestätigt</Badge> : <ImportBadge status={r.status} />}
                        {!done && r.isCredit && r.suggestedLeaseId && !['DUPLICATE', 'IGNORED'].includes(r.status) && <p className="mt-0.5 text-xs text-slate-400">Sicherheit {r.confidence} %</p>}
                      </td>
                      <td className="whitespace-nowrap">
                        {editable && !done && r.isCredit && r.status !== 'DUPLICATE' && (
                          <div className="flex items-center justify-end gap-1">
                            {canConfirm && !r.confirmed && (
                              <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => toggle.mutate(r)} title="Zuordnung stimmt – zur Verbuchung bestätigen">Stimmt</Button>
                            )}
                            {canConfirm && r.confirmed && (
                              <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => toggle.mutate(r)} title="Bestätigung zurücknehmen" aria-label="Bestätigung zurücknehmen"><Undo2 className="h-4 w-4" /></button>
                            )}
                            {!r.suggestedLeaseId && !['IGNORED', 'DUPLICATE'].includes(r.status) ? (
                              <Button size="sm" variant="secondary" icon={<UserSearch className="h-3.5 w-3.5" />} onClick={() => setEditRow(r)}>Mieter wählen</Button>
                            ) : (
                              r.status !== 'IGNORED' && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditRow(r)} title="Mieter oder Monat ändern">Ändern</Button>
                            )}
                            {r.status === 'IGNORED' ? (
                              <button className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => ignore.mutate(r)}>Wieder aufnehmen</button>
                            ) : (
                              <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Ignorieren (keine Mietzahlung)" aria-label="Ignorieren" onClick={() => ignore.mutate(r)}><EyeOff className="h-4 w-4" /></button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50/60">
                          <div className="grid gap-4 py-1 md:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-medium text-slate-500">Begründung der Automatik</p>
                              <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700">{r.matchReasons.map((m, i) => <li key={i}>{m}</li>)}</ul>
                              {r.allocation.length > 0 && <p className="mt-2 text-xs text-slate-600">Aufteilung: {r.allocation.map((a) => `${formatPeriod(a.period)}${a.label ? ` (${a.label})` : ''} ${chf(a.amountCents)}`).join(' · ')}</p>}
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
  // Betrag/Datum korrigierbar, falls die Erkennung sie falsch gelesen hat
  const [fixValues, setFixValues] = useState(false);
  const [amount, setAmount] = useState(fromCents(row.amountCents));
  const [date, setDate] = useState(isoDate(row.bookingDate));
  const amountChanged = fixValues && toCents(amount) !== row.amountCents && toCents(amount) > 0;
  const dateChanged = fixValues && date !== isoDate(row.bookingDate) && !!date;
  const save = useAction(
    () =>
      api(`/imports/rows/${row.id}`, {
        method: 'PATCH',
        body: {
          ...(amountChanged ? { amountCents: toCents(amount) } : {}),
          ...(dateChanged ? { bookingDate: date } : {}),
          ...(alloc.leaseId ? { leaseId: alloc.leaseId, allocation: alloc.allocations, confirmed: true } : { leaseId: null }),
        },
      }),
    { success: 'Zuordnung korrigiert und bestätigt', invalidate: [invalidateKey], onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Zuordnung korrigieren" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{alloc.leaseId ? 'Übernehmen & bestätigen' : 'Zuordnung entfernen'}</Button></>}>
      <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
        {!fixValues ? (
          <>
            <p><strong>{row.payerName}</strong> · {formatDate(row.bookingDate)} · <strong>{chf(row.amountCents)}</strong></p>
            <p className="text-xs text-slate-500">{row.reference}</p>
            <button className="mt-2 text-xs font-medium text-brand-700 hover:underline" onClick={() => setFixValues(true)}>
              Betrag oder Datum falsch erkannt? Hier korrigieren.
            </button>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Betrag (CHF)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Datum"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <p className="col-span-2 text-xs text-slate-500">{row.payerName} · {row.reference}</p>
          </div>
        )}
      </div>
      <AllocationEditor amountCents={amountChanged ? toCents(amount) : row.amountCents} value={alloc} onChange={setAlloc} initialLeaseId={row.suggestedLeaseId} initialPeriod={row.suggestedPeriod} />
      <p className="mt-3 text-xs text-slate-500">Die Korrektur wird gespeichert und für künftige Zahlungen von „{row.payerName}“ berücksichtigt (Lernlogik).</p>
    </Modal>
  );
}
