import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UNIT_TYPES } from '@immo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { chf, formatDate, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Button, Card, EmptyState, KeyValue, Loading, PageHeader, Tabs } from '@/components/ui';
import { DamageBadge, LeaseBadge } from '@/components/StatusBadge';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { UnitForm } from './Properties';
import { LeaseForm } from './Leases';

interface UnitDetail {
  id: string; label: string; type: string; floor: string | null; rooms: string | null; areaM2: string | null; targetRentCents: number | null; description: string | null; propertyId: string;
  property: { id: string; name: string; street: string; city: string };
  leases: { id: string; status: string; startDate: string; endDate: string | null; netRentCents: number; utilitiesCents: number; tenant: TenantRef }[];
  damageReports: { id: string; ticketNumber: number; title: string; status: string; createdAt: string }[];
}

export function UnitDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState('leases');
  const [edit, setEdit] = useState(false);
  const [lease, setLease] = useState(false);
  const { data: u, isLoading } = useQuery({ queryKey: ['unit', id], queryFn: () => api<UnitDetail>(`/units/${id}`) });
  if (isLoading || !u) return <Loading />;
  const active = u.leases.find((l) => l.status === 'ACTIVE' || l.status === 'TERMINATED');
  return (
    <>
      <PageHeader
        back={`/immobilien/${u.property.id}`}
        title={`${UNIT_TYPES[u.type as keyof typeof UNIT_TYPES]} ${u.label}`}
        subtitle={`${u.property.name} · ${u.property.street}, ${u.property.city}`}
        actions={
          <>
            {can('unit:write') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Bearbeiten</Button>}
            {can('lease:write') && !active && <Button onClick={() => setLease(true)}>Mietvertrag erfassen</Button>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Objektdaten" className="lg:col-span-2">
          <KeyValue cols={3} items={[['Etage', u.floor], ['Zimmer', u.rooms ? Number(u.rooms) : null], ['Fläche', u.areaM2 ? `${Number(u.areaM2)} m²` : null], ['Richtmiete', can('finance:read') ? chf(u.targetRentCents) : '–'], ['Beschreibung', u.description]]} />
        </Card>
        <Card title="Aktueller Mieter">
          {active ? (
            <div>
              <Link to={`/mieter/${active.tenant.id}`} className="text-base font-semibold text-brand-700 hover:underline">{tenantName(active.tenant)}</Link>
              <p className="mt-1 text-sm text-slate-500">seit {formatDate(active.startDate)}{active.endDate && ` · bis ${formatDate(active.endDate)}`}</p>
              {can('finance:read') && <p className="mt-3 text-lg font-semibold tabular-nums">{chf(active.netRentCents + active.utilitiesCents)} <span className="text-xs font-normal text-slate-500">/ Monat</span></p>}
              <Link to={`/mietvertraege/${active.id}`} className="mt-3 inline-block text-xs font-medium text-brand-700">Mietvertrag öffnen →</Link>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Leerstand</p>
          )}
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'leases', label: 'Mietverhältnisse', count: u.leases.length }, { key: 'damages', label: 'Mängel', count: u.damageReports.length }, { key: 'docs', label: 'Dokumente & Protokolle' }]} />
      {tab === 'leases' && (
        <Card bodyClassName="p-0">
          {u.leases.length ? (
            <table className="table-base">
              <thead><tr><th>Mieter</th><th>Beginn</th><th>Ende</th>{can('finance:read') && <th className="num">Miete</th>}<th>Status</th></tr></thead>
              <tbody>
                {u.leases.map((l) => (
                  <tr key={l.id}>
                    <td><Link className="text-brand-700 hover:underline" to={`/mietvertraege/${l.id}`}>{tenantName(l.tenant)}</Link></td>
                    <td>{formatDate(l.startDate)}</td>
                    <td>{formatDate(l.endDate)}</td>
                    {can('finance:read') && <td className="num">{chf(l.netRentCents + l.utilitiesCents)}</td>}
                    <td><LeaseBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState title="Keine Mietverhältnisse" />}
        </Card>
      )}
      {tab === 'damages' && (
        <Card bodyClassName="p-0">
          {u.damageReports.length ? (
            <ul className="divide-y divide-slate-100">
              {u.damageReports.map((d) => (
                <li key={d.id}><Link to={`/maengel/${d.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50"><span className="text-sm">#{d.ticketNumber} {d.title}</span><DamageBadge status={d.status} /></Link></li>
              ))}
            </ul>
          ) : <EmptyState title="Keine Mängel" />}
        </Card>
      )}
      {tab === 'docs' && <Card bodyClassName="p-0"><DocumentsPanel filter={{ unitId: u.id }} defaultCategory="HANDOVER" /></Card>}
      {edit && <UnitForm onClose={() => setEdit(false)} initial={u} />}
      {lease && <LeaseForm onClose={() => setLease(false)} unitId={u.id} />}
    </>
  );
}
