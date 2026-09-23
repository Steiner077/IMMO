import { AlertCircle, CalendarDays, CheckCircle2, ChevronRight, Megaphone, MessageSquare, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loading } from '@immo/ui';
import { api } from '../lib/api';
import { chf, formatDate, formatDateTime, formatPeriod } from '../lib/format';
import { Tile } from '../components/Section';

interface Overview {
  tenant: { firstName: string | null; lastName: string | null; companyName: string | null };
  leases: { id: string; unit: { label: string; rooms: string | null; floor: string | null }; property: { name: string; street: string; zip: string; city: string }; netRentCents: number; utilitiesCents: number; totalCents: number; paymentReference: string | null; startDate: string; endDate: string | null }[];
  currentMonth: { period: string; amountCents: number; paidCents: number; status: string | null };
  openCents: number;
  openPeriods: { period: string; openCents: number; status: string }[];
  recentPayments: { id: string; bookingDate: string; amountCents: number }[];
  openDamages: number;
  appointments: { id: string; title: string; startAt: string; location: string | null }[];
  announcements: { id: string; title: string; body: string; important: boolean; publishedAt: string }[];
  unreadMessages: number;
}

export function HomePage() {
  const { data, isLoading } = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/portal/overview') });
  if (isLoading || !data) return <Loading />;
  const lease = data.leases[0];
  const paid = data.currentMonth.status === 'PAID' || data.currentMonth.status === 'OVERPAID';
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">Grüezi</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{data.tenant.companyName ?? `${data.tenant.firstName ?? ''} ${data.tenant.lastName ?? ''}`}</h1>
        {lease && <p className="mt-0.5 text-sm text-slate-500">{lease.property.name} · Wohnung {lease.unit.label}</p>}
      </div>

      {data.announcements.filter((a) => a.important).map((a) => (
        <Link key={a.id} to="/mitteilungen" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div><p className="text-sm font-semibold text-amber-900">{a.title}</p><p className="mt-0.5 line-clamp-2 text-sm text-amber-800">{a.body}</p></div>
        </Link>
      ))}

      <Tile className="bg-gradient-to-br from-ink to-slate-800 text-white">
        <p className="text-xs text-slate-300">Monatsmiete {formatPeriod(data.currentMonth.period)}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{chf(data.currentMonth.amountCents || lease?.totalCents)}</p>
        {lease && <p className="mt-1 text-xs text-slate-300">Netto {chf(lease.netRentCents)} + Nebenkosten {chf(lease.utilitiesCents)}</p>}
        <div className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${paid ? 'bg-emerald-400/20 text-emerald-200' : 'bg-amber-400/20 text-amber-100'}`}>
          {paid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {paid ? 'Bezahlt – vielen Dank' : data.currentMonth.paidCents > 0 ? `Teilbezahlt (${chf(data.currentMonth.paidCents)})` : 'Noch offen'}
        </div>
        {lease?.paymentReference && <p className="mt-3 text-xs text-slate-400">Zahlungsreferenz: <span className="font-mono text-slate-200">{lease.paymentReference}</span></p>}
      </Tile>

      {data.openCents > 0 && (
        <Link to="/zahlungen" className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-4">
          <div>
            <p className="text-sm font-semibold text-red-800">Offene Zahlungen: {chf(data.openCents)}</p>
            <p className="text-xs text-red-700">{data.openPeriods.map((p) => formatPeriod(p.period)).join(', ')}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-red-400" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/maengel/neu" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs active:bg-slate-50">
          <Wrench className="h-5 w-5 text-brand-600" />
          <p className="mt-3 text-sm font-semibold text-slate-900">Mangel melden</p>
          <p className="text-xs text-slate-500">{data.openDamages ? `${data.openDamages} offene Meldung(en)` : 'Mit Fotos & Terminwunsch'}</p>
        </Link>
        <Link to="/nachrichten" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs active:bg-slate-50">
          <MessageSquare className="h-5 w-5 text-brand-600" />
          <p className="mt-3 text-sm font-semibold text-slate-900">Nachrichten</p>
          <p className="text-xs text-slate-500">{data.unreadMessages ? `${data.unreadMessages} ungelesen` : 'Verwaltung kontaktieren'}</p>
        </Link>
      </div>

      {!!data.appointments.length && (
        <Tile>
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarDays className="h-4 w-4 text-slate-400" /> Nächste Termine</p>
          <ul className="space-y-2">
            {data.appointments.map((a) => <li key={a.id} className="text-sm"><p className="font-medium text-slate-800">{a.title}</p><p className="text-xs text-slate-500">{formatDateTime(a.startAt)} Uhr{a.location ? ` · ${a.location}` : ''}</p></li>)}
          </ul>
        </Tile>
      )}

      <Tile>
        <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-slate-900">Letzte Zahlungen</p><Link to="/zahlungen" className="text-xs font-medium text-brand-700">Alle</Link></div>
        {data.recentPayments.length ? (
          <ul className="divide-y divide-slate-100">
            {data.recentPayments.map((p) => <li key={p.id} className="flex justify-between py-2 text-sm"><span className="text-slate-600">{formatDate(p.bookingDate)}</span><span className="font-medium tabular-nums">{chf(p.amountCents)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-slate-500">Noch keine Zahlungen erfasst.</p>}
      </Tile>

      {data.announcements.filter((a) => !a.important).slice(0, 2).map((a) => (
        <Link key={a.id} to="/mitteilungen" className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Mitteilung · {formatDate(a.publishedAt)}</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{a.title}</p>
        </Link>
      ))}
    </div>
  );
}
