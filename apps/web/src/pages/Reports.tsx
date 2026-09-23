import { Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UNIT_TYPES } from '@immo/shared';
import { api, download } from '@/lib/api';
import { chf, formatDate, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Badge, Button, Card, Loading, PageHeader, Select, StatCard } from '@/components/ui';

interface RentRollRow { unitId: string; property: { id: string; name: string }; label: string; type: string; rooms: string | null; areaM2: string | null; tenant: TenantRef | null; startDate: string | null; endDate: string | null; netRentCents: number; utilitiesCents: number; targetRentCents: number | null; vacant: boolean }

export function ReportsPage() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data, isLoading } = useQuery({ queryKey: ['rent-roll'], queryFn: () => api<RentRollRow[]>('/reports/rent-roll') });
  const total = data?.reduce((s, r) => s + r.netRentCents + r.utilitiesCents, 0) ?? 0;
  const vacantLoss = data?.filter((r) => r.vacant).reduce((s, r) => s + (r.targetRentCents ?? 0), 0) ?? 0;
  const area = data?.reduce((s, r) => s + Number(r.areaM2 ?? 0), 0) ?? 0;
  const exportCsv = () => {
    if (!data) return;
    const lines = [['Immobilie', 'Objekt', 'Art', 'Zimmer', 'Fläche', 'Mieter', 'Beginn', 'Ende', 'Netto', 'NK', 'Total'].join(';'), ...data.map((r) => [r.property.name, r.label, UNIT_TYPES[r.type as keyof typeof UNIT_TYPES], r.rooms ?? '', r.areaM2 ?? '', r.tenant ? tenantName(r.tenant) : 'Leerstand', formatDate(r.startDate), formatDate(r.endDate), (r.netRentCents / 100).toFixed(2), (r.utilitiesCents / 100).toFixed(2), ((r.netRentCents + r.utilitiesCents) / 100).toFixed(2)].join(';'))];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Mieterspiegel.csv';
    a.click();
  };
  return (
    <>
      <PageHeader title="Berichte" subtitle="Auswertungen und Exporte" />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card title="Jahresauswertung (Excel)">
          <p className="text-sm text-slate-600">Mieter, Monatsübersicht (Soll/Ist mit Status-Farben), alle Zahlungen und Ausgaben in einer Arbeitsmappe.</p>
          <div className="mt-4 flex gap-2">
            <Select className="w-28" value={year} onChange={(e) => setYear(e.target.value)} options={Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => ({ value: y, label: y }))} />
            <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => download(`/reports/export.xlsx?year=${year}`)}>Excel herunterladen</Button>
          </div>
        </Card>
        <Card title="Mieterspiegel">
          <p className="text-sm text-slate-600">Alle Mietobjekte mit aktuellem Mieter, Mietbeginn und Mietzins – z. B. für Bank, Versicherung oder Revision.</p>
          <div className="mt-4"><Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Als CSV exportieren</Button></div>
        </Card>
      </div>
      {isLoading || !data ? <Loading /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Mietobjekte" value={data.length} />
            <StatCard label="Leerstand" value={data.filter((r) => r.vacant).length} sub={`Ertragsausfall ca. ${chf(vacantLoss)} / Monat`} tone={vacantLoss ? 'warn' : 'default'} />
            <StatCard label="Soll-Mietertrag / Monat" value={chf(total)} />
            <StatCard label="Vermietbare Fläche" value={`${Math.round(area).toLocaleString('de-CH')} m²`} />
          </div>
          <Card title="Mieterspiegel" bodyClassName="overflow-x-auto p-0">
            <table className="table-base">
              <thead><tr><th>Immobilie</th><th>Objekt</th><th className="num">Zimmer</th><th className="num">Fläche</th><th>Mieter</th><th>Seit</th><th>Bis</th><th className="num">Netto</th><th className="num">NK</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.unitId}>
                    <td>{r.property.name}</td><td className="font-medium">{r.label}</td>
                    <td className="num">{r.rooms ? Number(r.rooms) : '–'}</td><td className="num">{r.areaM2 ? `${Number(r.areaM2)} m²` : '–'}</td>
                    <td>{r.tenant ? tenantName(r.tenant) : <Badge tone="red">Leerstand</Badge>}</td>
                    <td>{formatDate(r.startDate)}</td><td>{formatDate(r.endDate)}</td>
                    <td className="num">{r.vacant ? '–' : chf(r.netRentCents)}</td><td className="num">{r.vacant ? '–' : chf(r.utilitiesCents)}</td>
                    <td className="num font-medium">{r.vacant ? <span className="text-slate-400">{r.targetRentCents ? chf(r.targetRentCents) : '–'}</span> : chf(r.netRentCents + r.utilitiesCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
