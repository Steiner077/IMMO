import { Plus, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EXPENSE_CATEGORIES, MONTH_NAMES_DE } from '@immo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { chf, chfShort, formatDate, formatPeriod, isoDate, toCents } from '@/lib/format';
import type { Property } from '@/lib/types';
import { Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, StatCard, Tabs } from '@/components/ui';
import { AXIS, GRID, SERIES } from '@/components/charts/theme';
import { MoneyTooltip } from '@/components/charts/ChartTooltip';

interface Summary {
  year: number;
  totals: { dueCents: number; grossIncomeCents: number; expenseCents: number; netIncomeCents: number };
  monthly: { period: string; dueCents: number; incomeCents: number; expenseCents: number; netCents: number }[];
  byProperty: { id: string; name: string; dueCents: number; incomeCents: number; expenseCents: number; netCents: number; yieldPct: number | null; units: { id: string; label: string; incomeCents: number; expenseCents: number; netCents: number }[] }[];
  byCategory: { category: string; amountCents: number }[];
}
interface Expense { id: string; date: string; category: string; description: string; amountCents: number; invoiceNumber: string | null; property: { name: string }; unit: { label: string } | null; serviceProvider: { name: string } | null }

export function FinancePage() {
  const { can } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [propertyId, setPropertyId] = useState('');
  const [tab, setTab] = useState('overview');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const { data, isLoading } = useQuery({ queryKey: ['finance', year, propertyId], queryFn: () => api<Summary>(`/finance/summary?year=${year}${propertyId ? `&propertyId=${propertyId}` : ''}`) });
  const { data: expenses } = useQuery({ queryKey: ['expenses', year, propertyId], queryFn: () => api<Expense[]>(`/expenses?year=${year}${propertyId ? `&propertyId=${propertyId}` : ''}`), enabled: tab === 'expenses' });
  const del = useAction((id: string) => api(`/expenses/${id}`, { method: 'DELETE' }), { success: 'Ausgabe gelöscht', invalidate: [['expenses'], ['finance']] });
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  const monthsWithData = data?.monthly.filter((m) => m.incomeCents || m.expenseCents).length || 1;

  return (
    <>
      <PageHeader title="Finanzen" subtitle="Einnahmen, Ausgaben und Ergebnis je Immobilie und Wohnung" actions={
        <>
          <Select className="w-52" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} placeholder="Alle Immobilien" options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          <Select className="w-28" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          {can('expense:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Ausgabe erfassen</Button>}
        </>
      } />
      {isLoading || !data ? <Loading /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={`Bruttoeinnahmen ${year}`} value={chf(data.totals.grossIncomeCents)} sub={`Soll ${chf(data.totals.dueCents)}`} />
            <StatCard label="Ausgaben" value={chf(data.totals.expenseCents)} />
            <StatCard label="Nettoeinnahmen (Jahresergebnis)" value={chf(data.totals.netIncomeCents)} tone={data.totals.netIncomeCents >= 0 ? 'good' : 'bad'} />
            <StatCard label="Ø Monatsergebnis" value={chf(Math.round(data.totals.netIncomeCents / monthsWithData))} sub={`über ${monthsWithData} Monate`} />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Übersicht' }, { key: 'properties', label: 'Ertrag pro Immobilie / Wohnung' }, { key: 'expenses', label: 'Ausgaben' }]} />
          {tab === 'overview' && (
            <div className="grid gap-4 xl:grid-cols-3">
              <Card title="Monatliches Ergebnis" className="xl:col-span-2">
                <div className="h-80">
                  <ResponsiveContainer>
                    <ComposedChart data={data.monthly} barGap={2}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="period" tickFormatter={(p) => MONTH_NAMES_DE[+p.slice(5) - 1].slice(0, 3)} tick={AXIS.tick} stroke={AXIS.stroke} tickLine={false} />
                      <YAxis tickFormatter={chfShort} tick={AXIS.tick} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<MoneyTooltip labelFormatter={formatPeriod} />} cursor={{ fill: '#f1f5f9' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="incomeCents" name="Einnahmen" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={20} />
                      <Bar dataKey="expenseCents" name="Ausgaben" fill={SERIES.secondary} radius={[4, 4, 0, 0]} maxBarSize={20} />
                      <Line dataKey="netCents" name="Ergebnis" stroke={SERIES.tertiary} strokeWidth={2} dot={{ r: 4 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Ausgaben nach Kategorie" bodyClassName="p-0">
                {data.byCategory.length ? (
                  <ul className="divide-y divide-slate-100">
                    {data.byCategory.sort((a, b) => b.amountCents - a.amountCents).map((c) => {
                      const pct = Math.round((c.amountCents / data.totals.expenseCents) * 100);
                      return (
                        <li key={c.category} className="px-5 py-2.5">
                          <div className="flex justify-between text-sm"><span>{EXPENSE_CATEGORIES[c.category as keyof typeof EXPENSE_CATEGORIES]}</span><span className="tabular-nums">{chf(c.amountCents)}</span></div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: SERIES.secondary }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                ) : <EmptyState title="Keine Ausgaben erfasst" />}
              </Card>
              <Card title="Monatstabelle" className="xl:col-span-3" bodyClassName="overflow-x-auto p-0">
                <table className="table-base">
                  <thead><tr><th>Monat</th><th className="num">Soll-Miete</th><th className="num">Einnahmen</th><th className="num">Ausgaben</th><th className="num">Ergebnis</th></tr></thead>
                  <tbody>
                    {data.monthly.map((m) => <tr key={m.period}><td>{formatPeriod(m.period)}</td><td className="num">{chf(m.dueCents)}</td><td className="num">{chf(m.incomeCents)}</td><td className="num">{chf(m.expenseCents)}</td><td className={`num font-medium ${m.netCents < 0 ? 'text-red-700' : ''}`}>{chf(m.netCents)}</td></tr>)}
                    <tr className="bg-slate-50 font-semibold"><td>Total {year}</td><td className="num">{chf(data.totals.dueCents)}</td><td className="num">{chf(data.totals.grossIncomeCents)}</td><td className="num">{chf(data.totals.expenseCents)}</td><td className="num">{chf(data.totals.netIncomeCents)}</td></tr>
                  </tbody>
                </table>
              </Card>
            </div>
          )}
          {tab === 'properties' && (
            <Card bodyClassName="overflow-x-auto p-0">
              <table className="table-base">
                <thead><tr><th>Immobilie / Wohnung</th><th className="num">Soll</th><th className="num">Einnahmen</th><th className="num">Ausgaben</th><th className="num">Ertrag netto</th><th className="num">Nettorendite</th></tr></thead>
                <tbody>
                  {data.byProperty.map((p) => (
                    <Fragment key={p.id}>
                      <tr className="clickable" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                        <td className="font-medium text-slate-900">{expanded === p.id ? '▾' : '▸'} {p.name}</td>
                        <td className="num">{chf(p.dueCents)}</td><td className="num">{chf(p.incomeCents)}</td><td className="num">{chf(p.expenseCents)}</td>
                        <td className={`num font-semibold ${p.netCents < 0 ? 'text-red-700' : ''}`}>{chf(p.netCents)}</td>
                        <td className="num">{p.yieldPct !== null ? `${p.yieldPct.toFixed(2)} %` : '–'}</td>
                      </tr>
                      {expanded === p.id && p.units.map((u) => (
                        <tr key={u.id} className="bg-slate-50/60 text-slate-600"><td className="pl-10">{u.label}</td><td /><td className="num">{chf(u.incomeCents)}</td><td className="num">{chf(u.expenseCents)}</td><td className="num">{chf(u.netCents)}</td><td /></tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">Allgemeine Kosten (ohne Wohnungszuordnung) werden der Immobilie zugerechnet. Nettorendite = Ertrag netto / Anlagewert.</p>
            </Card>
          )}
          {tab === 'expenses' && (
            <Card bodyClassName="overflow-x-auto p-0">
              {!expenses?.length ? <EmptyState title="Keine Ausgaben" /> : (
                <table className="table-base">
                  <thead><tr><th>Datum</th><th>Immobilie</th><th>Kategorie</th><th>Beschreibung</th><th>Dienstleister</th><th className="num">Betrag</th><th /></tr></thead>
                  <tbody>
                    {expenses.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.date)}</td><td>{e.property.name}{e.unit && ` · ${e.unit.label}`}</td>
                        <td>{EXPENSE_CATEGORIES[e.category as keyof typeof EXPENSE_CATEGORIES]}</td>
                        <td>{e.description}{e.invoiceNumber && <p className="text-xs text-slate-500">Rg. {e.invoiceNumber}</p>}</td>
                        <td className="text-slate-600">{e.serviceProvider?.name ?? '–'}</td>
                        <td className="num font-medium">{chf(e.amountCents)}</td>
                        <td>{can('expense:write') && <button className="text-slate-300 hover:text-red-600" onClick={() => confirm('Ausgabe löschen?') && del.mutate(e.id)}><Trash2 className="h-4 w-4" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </>
      )}
      {open && <ExpenseForm properties={properties ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExpenseForm({ properties, onClose }: { properties: Property[]; onClose: () => void }) {
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: () => api<{ id: string; name: string }[]>('/providers') });
  const [f, setF] = useState({ propertyId: properties[0]?.id ?? '', unitId: '', category: 'REPAIR', date: isoDate(new Date()), amount: '', description: '', invoiceNumber: '', serviceProviderId: '' });
  const { data: units } = useQuery({ queryKey: ['units', f.propertyId], queryFn: () => api<{ id: string; label: string }[]>(`/units?propertyId=${f.propertyId}`), enabled: !!f.propertyId });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => api('/expenses', { body: { ...f, amountCents: toCents(f.amount), unitId: f.unitId || null, serviceProviderId: f.serviceProviderId || null } }), { success: 'Ausgabe erfasst', invalidate: [['expenses'], ['finance'], ['dashboard']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Ausgabe erfassen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!f.propertyId || !toCents(f.amount) || !f.description} loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Immobilie"><Select value={f.propertyId} onChange={set('propertyId')} options={properties.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Wohnung (optional)"><Select value={f.unitId} onChange={set('unitId')} placeholder="Ganze Immobilie" options={(units ?? []).map((u) => ({ value: u.id, label: u.label }))} /></Field>
        <Field label="Kategorie"><Select value={f.category} onChange={set('category')} options={EXPENSE_CATEGORIES} /></Field>
        <Field label="Datum"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Betrag (CHF)"><Input value={f.amount} onChange={set('amount')} inputMode="decimal" /></Field>
        <Field label="Rechnungsnummer"><Input value={f.invoiceNumber} onChange={set('invoiceNumber')} /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Input value={f.description} onChange={set('description')} /></Field>
        <Field label="Dienstleister" className="sm:col-span-2"><Select value={f.serviceProviderId} onChange={set('serviceProviderId')} placeholder="– keiner –" options={(providers ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
      </div>
    </Modal>
  );
}
