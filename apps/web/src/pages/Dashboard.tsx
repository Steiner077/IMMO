import { AlertTriangle, CheckSquare, Home, Upload, Users, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MONTH_NAMES_DE } from '@immo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { chf, chfShort, formatDate, formatDateTime, formatPeriod, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Button, Card, EmptyState, Loading, PageHeader, StatCard } from '@/components/ui';
import { DamageBadge, PriorityBadge } from '@/components/StatusBadge';
import { AXIS, GRID, SERIES } from '@/components/charts/theme';
import { MoneyTooltip } from '@/components/charts/ChartTooltip';

interface DashboardData {
  period: string;
  kpis: {
    propertyCount: number; unitCount: number; activeLeases: number; openDamages: number; openTasks: number; expiringLeases: number; vacancies: number;
    dueCents?: number; paidCents?: number; openCents?: number; overdueCents?: number; overdueCount?: number; pendingReview?: number;
  };
  expiringLeases: { id: string; endDate: string; tenant: TenantRef; unit: { label: string; property: { name: string } } }[];
  recentDamages: { id: string; ticketNumber: number; title: string; status: string; priority: string; property: { name: string }; unit: { label: string } | null }[];
  upcoming: { id: string; title: string; startAt: string; location: string | null; property: { name: string } | null }[];
  damageTrend: { period: string; created: number; resolved: number }[];
  incomeByMonth?: { period: string; dueCents: number; paidCents: number; receivedCents: number }[];
  byProperty?: { id: string; name: string; incomeCents: number; expenseCents: number }[];
  receivables?: { tenant: TenantRef; unit: string; property: string; openCents: number; oldest: string }[];
}

const shortMonth = (p: string) => MONTH_NAMES_DE[+p.slice(5, 7) - 1].slice(0, 3);

export function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard') });
  if (isLoading || !data) return <Loading />;
  const k = data.kpis;
  const fin = can('finance:read') && k.dueCents !== undefined;
  const paidPct = fin && k.dueCents ? Math.round(((k.paidCents ?? 0) / k.dueCents) * 100) : 0;
  const hour = new Date().getHours();
  // Leere Monate vor den ersten Daten ausblenden
  const firstWithData = data.incomeByMonth?.findIndex((m) => m.dueCents || m.paidCents) ?? -1;
  const income = firstWithData > 0 ? data.incomeByMonth!.slice(firstWithData) : data.incomeByMonth;

  return (
    <>
      <PageHeader
        title={`${hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend'}, ${user?.firstName}`}
        subtitle={`Übersicht ${formatPeriod(data.period)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('tenant:write') && <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => navigate('/mieter')}>Mieter</Button>}
            {can('payment:import') && <Button icon={<Upload className="h-4 w-4" />} onClick={() => navigate('/zahlungen/import')}>Kontoauszug einlesen</Button>}
          </div>
        }
      />

      {fin && !!k.pendingReview && (
        <Link to="/zahlungen/import" className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <AlertTriangle className="h-4 w-4" />
          {k.pendingReview} importierte Zahlung(en) konnten nicht eindeutig zugeordnet werden – bitte prüfen.
        </Link>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {fin && <StatCard label={`Miete ${formatPeriod(data.period)}`} value={chf(k.paidCents)} sub={`von ${chf(k.dueCents)} erhalten (${paidPct} %)`} tone={paidPct >= 100 ? 'good' : 'default'} icon={<Wallet className="h-4 w-4" />} to="/monatsabschluss" />}
        {fin && <StatCard label="Noch offen" value={chf((k.openCents ?? 0) + (k.overdueCents ?? 0))} sub={k.overdueCents ? `davon ${chf(k.overdueCents)} überfällig` : 'nichts überfällig'} tone={k.overdueCents ? 'bad' : k.openCents ? 'warn' : 'good'} icon={<AlertTriangle className="h-4 w-4" />} to="/monatsabschluss" />}
        <StatCard label="Vermietet" value={`${k.unitCount - k.vacancies} / ${k.unitCount}`} sub={k.vacancies ? `${k.vacancies} frei` : 'alles vermietet'} icon={<Home className="h-4 w-4" />} to="/immobilien" />
        <StatCard label="Zu erledigen" value={k.openDamages + k.openTasks + k.expiringLeases} sub={[k.openDamages && `${k.openDamages} Mängel`, k.openTasks && `${k.openTasks} Aufgaben`, k.expiringLeases && `${k.expiringLeases} Vertragsende`].filter(Boolean).join(' · ') || 'nichts offen'} tone={k.openDamages ? 'warn' : 'default'} icon={<CheckSquare className="h-4 w-4" />} to="/maengel" />
      </div>

      {fin && data.incomeByMonth && (
        <div className="mb-6 grid gap-4 xl:grid-cols-3">
          <Card title="Mieteinnahmen pro Monat – Soll gegen Ist" className="xl:col-span-2">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={income} barGap={2} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="period" tickFormatter={shortMonth} tick={AXIS.tick} stroke={AXIS.stroke} tickLine={false} />
                  <YAxis tickFormatter={(v) => chfShort(v)} tick={AXIS.tick} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<MoneyTooltip labelFormatter={formatPeriod} />} cursor={{ fill: '#f1f5f9' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="dueCents" name="Soll" fill={SERIES.target} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="paidCents" name="Ist (zugeordnet)" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Offene Forderungen" actions={<Link to="/monatsabschluss" className="text-xs font-medium text-brand-700">Alle</Link>} bodyClassName="p-0">
            {data.receivables?.length ? (
              <ul className="divide-y divide-slate-100">
                {data.receivables.map((r, i) => (
                  <li key={i} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{tenantName(r.tenant)}</p>
                      <p className="text-xs text-slate-500">
                        {r.property} · {r.unit} · seit {formatPeriod(r.oldest)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold whitespace-nowrap tabular-nums text-red-700">{chf(r.openCents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Keine überfälligen Mieten" text="Alle fälligen Mieten sind bezahlt." />
            )}
          </Card>
        </div>
      )}

      <div className="mb-6">
        {fin && data.byProperty && k.propertyCount > 1 && (
          <Card title={`Einnahmen und Kosten pro Immobilie (${new Date().getFullYear()})`}>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data.byProperty} layout="vertical" barGap={2} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tickFormatter={(v) => chfShort(v)} tick={AXIS.tick} stroke={AXIS.stroke} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS.tick} axisLine={false} tickLine={false} width={130} />
                  <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f1f5f9' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="incomeCents" name="Mieteinnahmen" fill={SERIES.primary} radius={[0, 4, 4, 0]} maxBarSize={16} />
                  <Bar dataKey="expenseCents" name="Kosten" fill={SERIES.secondary} radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Offene Mängel" actions={<Link to="/maengel" className="text-xs font-medium text-brand-700">Alle</Link>} bodyClassName="p-0">
          {data.recentDamages.length ? (
            <ul className="divide-y divide-slate-100">
              {data.recentDamages.map((d) => (
                <li key={d.id}>
                  <Link to={`/maengel/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        #{d.ticketNumber} {d.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {d.property.name}
                        {d.unit && ` · ${d.unit.label}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <PriorityBadge priority={d.priority} />
                      <DamageBadge status={d.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Keine offenen Mängel" />
          )}
        </Card>
        <Card title="Nächste Termine" actions={<Link to="/termine" className="text-xs font-medium text-brand-700">Kalender</Link>} bodyClassName="p-0">
          {data.upcoming.length ? (
            <ul className="divide-y divide-slate-100">
              {data.upcoming.map((a) => (
                <li key={a.id} className="flex gap-3 px-5 py-3">
                  <div className="w-12 shrink-0 rounded-lg bg-slate-100 py-1 text-center">
                    <p className="text-[10px] font-medium text-slate-500 uppercase">{MONTH_NAMES_DE[new Date(a.startAt).getMonth()].slice(0, 3)}</p>
                    <p className="text-base font-semibold text-slate-800">{new Date(a.startAt).getDate()}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{a.title}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(a.startAt).slice(11)} Uhr{a.location ? ` · ${a.location}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Keine anstehenden Termine" />
          )}
        </Card>
        <Card title="Auslaufende Mietverträge" bodyClassName="p-0">
          {data.expiringLeases.length ? (
            <ul className="divide-y divide-slate-100">
              {data.expiringLeases.map((l) => (
                <li key={l.id}>
                  <Link to={`/mietvertraege/${l.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{tenantName(l.tenant)}</p>
                      <p className="text-xs text-slate-500">
                        {l.unit.property.name} · {l.unit.label}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-amber-700">{formatDate(l.endDate)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Keine auslaufenden Verträge" />
          )}
        </Card>
      </div>
    </>
  );
}
