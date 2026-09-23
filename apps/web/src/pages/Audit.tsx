import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Card, EmptyState, Loading, PageHeader, Pagination, Select } from '@/components/ui';

interface Log { id: string; action: string; entityType: string; entityId: string | null; summary: string | null; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null; createdAt: string; ip: string | null; user: { firstName: string; lastName: string; email: string } | null }

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number' && /Cents$/.test('')) return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const fmtField = (k: string, v: unknown) => (/Cents$/.test(k) && typeof v === 'number' ? `CHF ${(v / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 })}` : fmt(v));

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['audit', page, entityType], queryFn: () => api<{ items: Log[]; total: number; page: number; pageSize: number }>(`/audit?page=${page}&pageSize=50${entityType ? `&entityType=${entityType}` : ''}`) });
  return (
    <>
      <PageHeader title="Änderungsprotokoll" subtitle="Unveränderliche Aufzeichnung aller wichtigen Aktionen – wer hat wann was geändert." />
      <Card bodyClassName="p-0">
        <div className="border-b border-slate-100 p-3">
          <Select className="w-56" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} placeholder="Alle Bereiche" options={{ Payment: 'Zahlungen', ImportBatch: 'Importe', RentCharge: 'Sollstellungen', Lease: 'Mietverträge', Tenant: 'Mieter', Property: 'Immobilien', Unit: 'Mietobjekte', DamageReport: 'Mängel', Document: 'Dokumente', Expense: 'Ausgaben', User: 'Benutzer', Organization: 'Einstellungen' }} />
        </div>
        {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Keine Einträge" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Aktion</th><th>Alter Wert</th><th>Neuer Wert</th></tr></thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id} className="align-top">
                      <td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</td>
                      <td className="text-xs">{l.user ? `${l.user.firstName} ${l.user.lastName}` : 'System'}{l.ip && <p className="text-slate-400">{l.ip}</p>}</td>
                      <td><p className="text-sm text-slate-800">{l.summary}</p><p className="font-mono text-[11px] text-slate-400">{l.action}</p></td>
                      <td className="max-w-64 text-xs text-red-700">{l.oldValues && Object.entries(l.oldValues).map(([k, v]) => <p key={k} className="truncate" title={fmt(v)}>{k}: {fmtField(k, v)}</p>)}</td>
                      <td className="max-w-64 text-xs text-emerald-700">{l.newValues && Object.entries(l.newValues).slice(0, 8).map(([k, v]) => <p key={k} className="truncate" title={fmt(v)}>{k}: {fmtField(k, v)}</p>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
