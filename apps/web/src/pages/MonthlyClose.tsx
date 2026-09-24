import { Check, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addMonths } from '@immo/shared';
import { api, download } from '@/lib/api';
import { chf, currentPeriod, formatDate, formatPeriod, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Button, Card, EmptyState, Loading, Modal, PageHeader, Select, StatCard } from '@/components/ui';
import { ChargeBadge } from '@/components/StatusBadge';
import { TenantAccount } from '@/components/TenantAccount';
import { PaymentEntry } from '@/components/PaymentEntry';
import { useAuth } from '@/lib/auth';

interface Monthly {
  period: string;
  summary: { dueCents: number; paidCents: number; openCents: number; overpaidCents: number; count: number; paidCount: number; partialCount: number; overdueCount: number; unassignedPayments: number; unassignedCents: number };
  byProperty: { id: string; name: string; dueCents: number; paidCents: number; count: number; paidCount: number }[];
  rows: { chargeId: string; leaseId: string; tenant: TenantRef; unit: { label: string }; property: { id: string; name: string }; dueDate: string; amountCents: number; paidCents: number; openCents: number; status: string; note: string | null; payments: { id: string; number: number; bookingDate: string; assignedCents: number }[] }[];
}

export function MonthlyClosePage() {
  const params = useParams();
  const navigate = useNavigate();
  const period = params.period ?? currentPeriod();
  const [propertyId, setPropertyId] = useState('');
  const [status, setStatus] = useState('');
  const [tenant, setTenant] = useState<{ id: string; name: string } | null>(null);
  const [pay, setPay] = useState<{ tenantId: string; chargeId: string } | null>(null);
  const { can } = useAuth();
  const canPay = can('finance:write');
  const { data, isLoading } = useQuery({ queryKey: ['monthly', period, propertyId], queryFn: () => api<Monthly>(`/monthly/${period}${propertyId ? `?propertyId=${propertyId}` : ''}`) });
  const go = (p: string) => navigate(`/monatsabschluss/${p}`);
  const s = data?.summary;
  const pct = s && s.dueCents ? Math.round((s.paidCents / s.dueCents) * 100) : 0;
  const rows = data?.rows.filter((r) => !status || (status === 'OPEN' ? ['OPEN', 'OVERDUE', 'PARTIAL'].includes(r.status) : r.status === status)) ?? [];

  return (
    <>
      <PageHeader
        title="Monatsabschluss"
        subtitle="Soll, Eingang und offene Beträge je Monat – mit Status für jeden Mieter."
        actions={
          <>
            <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-xs">
              <button className="px-2.5 py-2 text-slate-500 hover:text-slate-900" onClick={() => go(addMonths(period, -1))} aria-label="Vorheriger Monat"><ChevronLeft className="h-4 w-4" /></button>
              <input type="month" value={period} onChange={(e) => e.target.value && go(e.target.value)} className="border-x border-slate-200 px-2 py-1.5 text-sm font-medium" />
              <button className="px-2.5 py-2 text-slate-500 hover:text-slate-900" onClick={() => go(addMonths(period, 1))} aria-label="Nächster Monat"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(`/reports/export.xlsx?year=${period.slice(0, 4)}`)}>Excel</Button>
          </>
        }
      />
      {isLoading || !data || !s ? <Loading /> : (
        <>
          <div className="card mb-5 p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{formatPeriod(period)}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{s.paidCount} von {s.count} Mietern bezahlt</p>
              </div>
              <p className="text-3xl font-semibold tabular-nums text-ink">{pct} %</p>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Soll" value={chf(s.dueCents)} />
            <StatCard label="Eingegangen" value={chf(s.paidCents)} tone="good" sub={s.overpaidCents ? `+ ${chf(s.overpaidCents)} Überzahlung` : undefined} />
            <StatCard label="Offen" value={chf(s.openCents)} tone={s.openCents ? 'bad' : 'good'} sub={`${s.overdueCount} überfällig · ${s.partialCount} teilbezahlt`} />
            <StatCard label="Nicht zugeordnete Zahlungen" value={s.unassignedPayments} sub={chf(s.unassignedCents)} tone={s.unassignedPayments ? 'warn' : 'default'} to="/zahlungen?status=UNCLEAR,REVIEW" />
          </div>
          {data.byProperty.length > 1 && (
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              {data.byProperty.map((p) => {
                const pp = p.dueCents ? Math.round((p.paidCents / p.dueCents) * 100) : 0;
                return (
                  <button key={p.id} onClick={() => setPropertyId(propertyId === p.id ? '' : p.id)} className={`card p-4 text-left transition hover:border-slate-300 ${propertyId === p.id ? 'ring-2 ring-brand-200' : ''}`}>
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{p.paidCount}/{p.count} bezahlt · offen {chf(p.dueCents - p.paidCents)}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pp}%` }} /></div>
                  </button>
                );
              })}
            </div>
          )}
          <Card bodyClassName="p-0">
            <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
              <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Alle Status" options={{ OPEN: 'Nicht vollständig bezahlt', PAID: 'Bezahlt', PARTIAL: 'Teilbezahlt', OVERDUE: 'Überfällig', OVERPAID: 'Überbezahlt' }} />
              {propertyId && <Button variant="ghost" size="sm" onClick={() => setPropertyId('')}>Immobilienfilter entfernen</Button>}
            </div>
            {!rows.length ? <EmptyState title="Keine Einträge" text="Für diesen Monat bestehen keine passenden Sollstellungen." /> : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Mieter</th><th>Immobilie / Wohnung</th><th>Fällig</th><th className="num">Soll</th><th className="num">Bezahlt</th><th className="num">Offen</th><th>Zahlung</th><th>Status</th>{canPay && <th />}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.chargeId} className="clickable" onClick={() => setTenant({ id: r.tenant.id, name: tenantName(r.tenant) })}>
                        <td className="font-medium text-slate-900">{tenantName(r.tenant)}</td>
                        <td>{r.property.name} · {r.unit.label}</td>
                        <td>{formatDate(r.dueDate)}</td>
                        <td className="num">{chf(r.amountCents)}</td>
                        <td className="num">{chf(r.paidCents)}</td>
                        <td className={`num ${r.openCents ? 'font-medium text-red-700' : 'text-slate-400'}`}>{r.openCents ? chf(r.openCents) : '–'}</td>
                        <td className="text-xs">{r.payments.map((p) => <Link key={p.id} onClick={(e) => e.stopPropagation()} to={`/zahlungen/${p.id}`} className="mr-2 text-brand-700 hover:underline">#{p.number} ({formatDate(p.bookingDate).slice(0, 6)})</Link>)}</td>
                        <td><ChargeBadge status={r.status} /></td>
                        {canPay && (
                          <td className="text-right">
                            {r.openCents > 0 && (
                              <Button size="sm" variant="secondary" icon={<Check className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setPay({ tenantId: r.tenant.id, chargeId: r.chargeId }); }}>
                                Bezahlt
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {pay && <PaymentEntry tenantId={pay.tenantId} chargeId={pay.chargeId} onClose={() => setPay(null)} />}
      <Modal open={!!tenant} onClose={() => setTenant(null)} title={`Zahlungshistorie · ${tenant?.name}`} size="xl" footer={<Link to={`/mieter/${tenant?.id}`}><Button variant="secondary">Zum Mieterprofil</Button></Link>}>
        {tenant && <TenantAccount tenantId={tenant.id} compact />}
      </Modal>
    </>
  );
}
