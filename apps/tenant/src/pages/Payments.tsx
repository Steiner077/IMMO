import { useQuery } from '@tanstack/react-query';
import { Badge, Loading, type Tone } from '@immo/ui';
import { CHARGE_STATUS } from '@immo/shared';
import { api } from '../lib/api';
import { chf, formatDate, formatPeriod } from '../lib/format';
import { Tile, Title } from '../components/Section';

interface Data {
  charges: { id: string; period: string; dueDate: string; amountCents: number; paidCents: number; status: string }[];
  payments: { id: string; number: number; bookingDate: string; amountCents: number; reversedAt: string | null; reference: string | null; assignments: { rentCharge: { period: string } }[] }[];
  summary: { openCents: number; paidTotalCents: number };
}
const tone: Record<string, Tone> = { PAID: 'green', OVERPAID: 'purple', PARTIAL: 'yellow', OPEN: 'gray', OVERDUE: 'red' };

export function PaymentsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-payments'], queryFn: () => api<Data>('/portal/payments') });
  if (isLoading || !data) return <Loading />;
  return (
    <>
      <Title>Zahlungen</Title>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tile><p className="text-xs text-slate-500">Offen</p><p className={`mt-1 text-xl font-semibold tabular-nums ${data.summary.openCents ? 'text-red-700' : 'text-emerald-700'}`}>{chf(data.summary.openCents)}</p></Tile>
        <Tile><p className="text-xs text-slate-500">Bezahlt (gesamt)</p><p className="mt-1 text-xl font-semibold tabular-nums">{chf(data.summary.paidTotalCents)}</p></Tile>
      </div>
      <Tile className="mb-4 p-0">
        <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Monatsmieten</p>
        <ul className="divide-y divide-slate-100">
          {data.charges.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{formatPeriod(c.period)}</p>
                <p className="text-xs text-slate-500">fällig {formatDate(c.dueDate)}{c.paidCents > 0 && c.paidCents < c.amountCents ? ` · bezahlt ${chf(c.paidCents)}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums">{chf(c.amountCents)}</p>
                <Badge tone={tone[c.status]}>{CHARGE_STATUS[c.status as keyof typeof CHARGE_STATUS]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Tile>
      <Tile className="p-0">
        <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Zahlungshistorie</p>
        <ul className="divide-y divide-slate-100">
          {data.payments.map((p) => (
            <li key={p.id} className={`flex items-center justify-between px-4 py-3 ${p.reversedAt ? 'opacity-50' : ''}`}>
              <div>
                <p className="text-sm text-slate-800">{formatDate(p.bookingDate)}</p>
                <p className="text-xs text-slate-500">{p.assignments.map((a) => formatPeriod(a.rentCharge.period)).join(', ') || 'Guthaben'}{p.reversedAt && ' · storniert'}</p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{chf(p.amountCents)}</p>
            </li>
          ))}
          {!data.payments.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Noch keine Zahlungen.</li>}
        </ul>
      </Tile>
    </>
  );
}
