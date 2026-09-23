import { ArrowRight, Brain, CheckCircle2, Play, Trash2, XCircle, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { formatDateTime, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, StatCard } from '@/components/ui';

interface Run { id: string; job: string; status: string; trigger: string; result: Record<string, unknown>; error: string | null; startedAt: string; finishedAt: string | null }
interface AutomationData {
  jobs: { key: string; name: string; description: string; schedule: string; lastRun: Run | null }[];
  runs: Run[];
  stats: { importRows: Record<string, number>; learnedAliases: number; automationRate: number | null };
  pipeline: string[];
}

const RESULT_LABELS: Record<string, string> = { created: 'erzeugt', until: 'bis', statusChanged: 'Status geändert', overdue: 'überfällig', notified: 'benachrichtigt', expiring: 'auslaufend', ended: 'beendet', reminded: 'erinnert', name: 'Datei' };
const describe = (r: Record<string, unknown> | null) =>
  Object.entries(r ?? {})
    .filter(([k]) => RESULT_LABELS[k])
    .map(([k, v]) => `${RESULT_LABELS[k]}: ${v}`)
    .join(' · ');

export function AutomationPage() {
  const { data, isLoading } = useQuery({ queryKey: ['automation'], queryFn: () => api<AutomationData>('/automation') });
  const { data: aliases } = useQuery({ queryKey: ['aliases'], queryFn: () => api<{ id: string; normalizedName: string; iban: string | null; timesConfirmed: number; lastUsedAt: string; tenant: TenantRef }[]>('/automation/aliases') });
  const run = useAction((key: string) => api<Run>(`/automation/jobs/${key}/run`, { body: {} }), { success: (r) => (r.status === 'SUCCESS' ? 'Automatisierung ausgeführt' : `Fehlgeschlagen: ${r.error}`), invalidate: [['automation'], ['dashboard']] });
  const delAlias = useAction((id: string) => api(`/automation/aliases/${id}`, { method: 'DELETE' }), { success: 'Zuordnung entfernt', invalidate: [['aliases']] });
  if (isLoading || !data) return <Loading />;
  const rows = data.stats.importRows;
  const totalRows = Object.values(rows).reduce((s, v) => s + v, 0);
  const jobName = (k: string) => data.jobs.find((j) => j.key === k)?.name ?? k;
  return (
    <>
      <PageHeader title="Automatisierungs-Zentrale" subtitle="Das System übernimmt Routinearbeiten – finanzielle Buchungen erfolgen nie ohne Ihre Bestätigung." actions={<Link to="/zahlungen/import"><Button icon={<Zap className="h-4 w-4" />}>Kontoauszug verarbeiten</Button></Link>} />
      <Card title="Zahlungsautomatik: Ablauf" className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {data.pipeline.map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              <span className={`rounded-lg px-3 py-1.5 text-xs font-medium ${i >= data.pipeline.length - 2 ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-700'}`}>{i + 1}. {s}</span>
              {i < data.pipeline.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-slate-300" />}
            </span>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-600">Nach dem Verbuchen aktualisiert das System automatisch: Mieterkonto, Monatsübersicht, Immobilie, Dashboard, Einnahmenstatistik, Zahlungsstatus und legt eine aktuelle Excel-Auswertung ab.</p>
      </Card>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Erkannte Buchungen (90 Tage)" value={totalRows} />
        <StatCard label="Automatisch sicher erkannt" value={totalRows ? `${Math.round((((rows.READY ?? 0) + (rows.POSTED ?? 0)) / Math.max(1, totalRows - (rows.IGNORED ?? 0))) * 100)} %` : '–'} tone="good" />
        <StatCard label="Ohne Korrektur übernommen" value={data.stats.automationRate !== null ? `${data.stats.automationRate} %` : '–'} sub="Anteil automatischer Zuordnungen" />
        <StatCard label="Gelernte Zahler" value={data.stats.learnedAliases} icon={<Brain className="h-4 w-4" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Automatisierungen" bodyClassName="p-0">
          <ul className="divide-y divide-slate-100">
            {data.jobs.map((j) => (
              <li key={j.key} className="flex items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{j.name} <Badge className="ml-1">{j.schedule}</Badge></p>
                  <p className="mt-0.5 text-xs text-slate-500">{j.description}</p>
                  {j.lastRun && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
                      {j.lastRun.status === 'SUCCESS' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}
                      Zuletzt {formatDateTime(j.lastRun.startedAt)} · {describe(j.lastRun.result)}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} loading={run.isPending && run.variables === j.key} onClick={() => run.mutate(j.key)}>Jetzt ausführen</Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Lernlogik: gelernte Zuordnungen" bodyClassName="max-h-[480px] overflow-y-auto p-0">
          {!aliases?.length ? <EmptyState title="Noch nichts gelernt" text="Bestätigte und korrigierte Zuordnungen werden hier gespeichert." /> : (
            <table className="table-base">
              <thead><tr><th>Zahlername</th><th>Mieter</th><th className="num">Bestätigt</th><th /></tr></thead>
              <tbody>
                {aliases.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{a.normalizedName}{a.iban && <p className="text-slate-400">{a.iban}</p>}</td>
                    <td>{tenantName(a.tenant)}</td>
                    <td className="num">{a.timesConfirmed}×</td>
                    <td><button className="text-slate-300 hover:text-red-600" title="Zuordnung vergessen" onClick={() => confirm('Diese gelernte Zuordnung entfernen?') && delAlias.mutate(a.id)}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Protokoll der Ausführungen" className="xl:col-span-2" bodyClassName="max-h-96 overflow-y-auto p-0">
          <table className="table-base">
            <thead><tr><th>Zeitpunkt</th><th>Automatisierung</th><th>Auslöser</th><th>Ergebnis</th><th>Status</th></tr></thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</td><td>{jobName(r.job)}</td>
                  <td className="text-xs">{{ SCHEDULE: 'Zeitplan', MANUAL: 'Manuell', EVENT: 'Ereignis' }[r.trigger] ?? r.trigger}</td>
                  <td className="text-xs text-slate-600">{r.error ?? describe(r.result)}</td>
                  <td><Badge tone={r.status === 'SUCCESS' ? 'green' : r.status === 'FAILED' ? 'red' : 'blue'}>{{ SUCCESS: 'Erfolgreich', FAILED: 'Fehler', RUNNING: 'Läuft' }[r.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
