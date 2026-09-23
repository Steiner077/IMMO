import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_SOURCES } from '@immo/shared';
import { api } from '@/lib/api';
import { chf, formatDate, formatPeriod } from '@/lib/format';
import { ChargeBadge, PaymentBadge } from './StatusBadge';
import { Card, Loading, StatCard } from './ui';

interface Account {
  summary: { dueCents: number; paidCents: number; openCents: number; balanceCents: number };
  leases: { id: string; unit: { label: string; property: { name: string } }; charges: { id: string; period: string; dueDate: string; amountCents: number; paidCents: number; status: string; note: string | null; assignments: { amountCents: number; payment: { id: string; number: number; bookingDate: string; reversedAt: string | null } }[] }[] }[];
  payments: { id: string; number: number; bookingDate: string; amountCents: number; status: string; source: string; reference: string | null; reversedAt: string | null; assignments: { amountCents: number; rentCharge: { period: string } }[] }[];
}

/** Vollständiges Mieterkonto: Soll/Ist je Monat und alle Zahlungen */
export function TenantAccount({ tenantId, compact }: { tenantId: string; compact?: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ['account', tenantId], queryFn: () => api<Account>(`/tenants/${tenantId}/account`) });
  if (isLoading || !data) return <Loading />;
  const charges = data.leases.flatMap((l) => l.charges.map((c) => ({ ...c, unit: `${l.unit.property.name} · ${l.unit.label}` }))).sort((a, b) => b.period.localeCompare(a.period));
  const bal = data.summary.balanceCents;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Fälliges Soll (gesamt)" value={chf(data.summary.dueCents)} />
        <StatCard label="Bezahlt (gesamt)" value={chf(data.summary.paidCents)} tone="good" />
        <StatCard label="Offen" value={chf(data.summary.openCents)} tone={data.summary.openCents ? 'bad' : 'default'} />
        <StatCard label="Kontosaldo" value={chf(bal)} sub={bal > 0 ? 'Guthaben' : bal < 0 ? 'Rückstand' : 'ausgeglichen'} tone={bal < 0 ? 'bad' : bal > 0 ? 'good' : 'default'} />
      </div>
      <div className={compact ? 'space-y-4' : 'grid gap-4 xl:grid-cols-2'}>
        <Card title="Monatsübersicht (Soll / Ist)" bodyClassName="max-h-[520px] overflow-auto p-0">
          <table className="table-base">
            <thead><tr><th>Monat</th><th className="num">Soll</th><th className="num">Bezahlt</th><th>Status</th><th>Zahlungen</th></tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td>
                    <p className="font-medium text-slate-800">{formatPeriod(c.period)}</p>
                    {data.leases.length > 1 && <p className="text-xs text-slate-500">{c.unit}</p>}
                    {c.note && <p className="text-xs text-slate-500">{c.note}</p>}
                  </td>
                  <td className="num">{chf(c.amountCents)}</td>
                  <td className="num">{chf(c.paidCents)}</td>
                  <td><ChargeBadge status={c.status} /></td>
                  <td className="text-xs">
                    {c.assignments.filter((a) => !a.payment.reversedAt).map((a) => (
                      <Link key={a.payment.id} to={`/zahlungen/${a.payment.id}`} className="mr-2 text-brand-700 hover:underline">#{a.payment.number}</Link>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Zahlungshistorie" bodyClassName="max-h-[520px] overflow-auto p-0">
          <table className="table-base">
            <thead><tr><th>Datum</th><th>Nr.</th><th className="num">Betrag</th><th>Monat(e)</th><th>Status</th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className={p.reversedAt ? 'opacity-50' : ''}>
                  <td>{formatDate(p.bookingDate)}<p className="text-xs text-slate-500">{PAYMENT_SOURCES[p.source as keyof typeof PAYMENT_SOURCES]}</p></td>
                  <td><Link to={`/zahlungen/${p.id}`} className="text-brand-700 hover:underline">#{p.number}</Link></td>
                  <td className="num font-medium">{chf(p.amountCents)}</td>
                  <td className="text-xs text-slate-600">{p.assignments.map((a) => formatPeriod(a.rentCharge.period)).join(', ') || '–'}</td>
                  <td><PaymentBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
