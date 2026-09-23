import { Bell, Building2, CalendarDays, ChevronRight, Download, FileText, KeyRound, LogOut, Megaphone, Phone, Upload } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, Loading } from '@immo/ui';
import { DOCUMENT_CATEGORIES, LEASE_STATUS, UNIT_TYPES } from '@immo/shared';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/hooks';
import { chf, formatDate, formatDateTime } from '../lib/format';
import { Tile, Title } from '../components/Section';

function Row({ to, icon, label, sub }: { to: string; icon: ReactNode; label: string; sub?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1"><span className="block text-sm font-medium text-slate-800">{label}</span>{sub && <span className="block text-xs text-slate-500">{sub}</span>}</span>
      <ChevronRight className="h-4 w-4 text-slate-300" />
    </Link>
  );
}

export function MorePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const i = 'h-5 w-5';
  return (
    <>
      <Title>Mehr</Title>
      <Tile className="mb-4 p-0 divide-y divide-slate-100">
        <Row to="/vertrag" icon={<FileText className={i} />} label="Mietvertrag" sub="Vertragsdaten & Vertragsdokumente" />
        <Row to="/dokumente" icon={<Download className={i} />} label="Dokumente" sub="Abrechnungen, Protokolle, Korrespondenz" />
        <Row to="/termine" icon={<CalendarDays className={i} />} label="Termine" />
        <Row to="/mitteilungen" icon={<Megaphone className={i} />} label="Wichtige Mitteilungen" />
        <Row to="/immobilie" icon={<Building2 className={i} />} label="Informationen zur Immobilie" sub="Hausordnung, Kontakte, Hauswart" />
        <Row to="/benachrichtigungen" icon={<Bell className={i} />} label="Benachrichtigungen" />
      </Tile>
      <Tile className="p-0 divide-y divide-slate-100">
        <div className="px-4 py-3 text-xs text-slate-500">Angemeldet als {user?.email}</div>
        <Row to="/passwort" icon={<KeyRound className={i} />} label="Passwort ändern" />
        <button onClick={async () => { await logout(); navigate('/login'); }} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-red-600"><LogOut className={i} /> Abmelden</button>
      </Tile>
    </>
  );
}

interface LeaseData { id: string; status: string; startDate: string; endDate: string | null; netRentCents: number; utilitiesCents: number; depositCents: number; noticePeriodMonths: number; dueDay: number; paymentReference: string | null; unit: { label: string; type: string; rooms: string | null; areaM2: string | null; floor: string | null; property: { name: string; street: string; zip: string; city: string } }; documents: { id: string; name: string }[] }

export function LeasePage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-lease'], queryFn: () => api<LeaseData[]>('/portal/lease') });
  if (isLoading || !data) return <Loading />;
  return (
    <>
      <Title back="/mehr">Mietvertrag</Title>
      <div className="space-y-4">
        {data.map((l) => (
          <Tile key={l.id}>
            <div className="mb-3 flex items-start justify-between">
              <div><p className="text-base font-semibold">{UNIT_TYPES[l.unit.type as keyof typeof UNIT_TYPES]} {l.unit.label}</p><p className="text-sm text-slate-500">{l.unit.property.street}, {l.unit.property.zip} {l.unit.property.city}</p></div>
              <Badge tone={l.status === 'ACTIVE' ? 'green' : 'yellow'}>{LEASE_STATUS[l.status as keyof typeof LEASE_STATUS]}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Mietbeginn', formatDate(l.startDate)], ['Mietende', l.endDate ? formatDate(l.endDate) : 'unbefristet'],
                ['Nettomiete', chf(l.netRentCents)], ['Nebenkosten', chf(l.utilitiesCents)], ['Total / Monat', chf(l.netRentCents + l.utilitiesCents)], ['Mietkaution', chf(l.depositCents)],
                ['Fällig', `am ${l.dueDay}. im Voraus`], ['Kündigungsfrist', `${l.noticePeriodMonths} Monate`],
                ['Zimmer', l.unit.rooms ? String(Number(l.unit.rooms)) : '–'], ['Fläche', l.unit.areaM2 ? `${Number(l.unit.areaM2)} m²` : '–'],
                ...(l.paymentReference ? [['Zahlungsreferenz', l.paymentReference]] : []),
              ].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-800">{v}</dd></div>)}
            </dl>
            {l.documents.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                {l.documents.map((d) => <button key={d.id} onClick={() => download(`/portal/documents/${d.id}/download`, d.name)} className="flex w-full items-center gap-2 py-1.5 text-sm text-brand-700"><FileText className="h-4 w-4" />{d.name}</button>)}
              </div>
            )}
          </Tile>
        ))}
      </div>
    </>
  );
}

export function DocumentsPage() {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['portal-docs'], queryFn: () => api<{ id: string; name: string; category: string; createdAt: string; uploadedById: string | null }[]>('/portal/documents') });
  const upload = useAction((files: FileList) => { const fd = new FormData(); Array.from(files).forEach((f) => fd.append('file', f)); return api('/portal/documents', { form: fd }); }, { success: 'Dokument an die Verwaltung übermittelt', invalidate: [['portal-docs']] });
  return (
    <>
      <Title back="/mehr" action={<><input ref={input} type="file" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} /><button onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white"><Upload className="h-3.5 w-3.5" />Hochladen</button></>}>Dokumente</Title>
      {isLoading ? <Loading /> : !data?.length ? <Tile><EmptyState title="Keine Dokumente" text="Hier erscheinen Dokumente, die Ihre Verwaltung für Sie freigibt." /></Tile> : (
        <Tile className="p-0 divide-y divide-slate-100">
          {data.map((d) => (
            <button key={d.id} onClick={() => download(`/portal/documents/${d.id}/download`, d.name)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <FileText className="h-5 w-5 text-slate-400" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-800">{d.name}</span><span className="text-xs text-slate-500">{DOCUMENT_CATEGORIES[d.category as keyof typeof DOCUMENT_CATEGORIES]} · {formatDate(d.createdAt)}{d.uploadedById === user?.id ? ' · von Ihnen' : ''}</span></span>
              <Download className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </Tile>
      )}
    </>
  );
}

export function AppointmentsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-appts'], queryFn: () => api<{ id: string; title: string; description: string | null; startAt: string; endAt: string | null; location: string | null; damageReport: { ticketNumber: number } | null }[]>('/portal/appointments') });
  return (
    <>
      <Title back="/mehr">Termine</Title>
      {isLoading ? <Loading /> : !data?.length ? <Tile><EmptyState title="Keine Termine" /></Tile> : (
        <div className="space-y-2">{data.map((a) => <Tile key={a.id}><p className="text-sm font-semibold">{a.title}</p><p className="text-sm text-slate-600">{formatDateTime(a.startAt)} Uhr</p>{a.location && <p className="text-xs text-slate-500">{a.location}</p>}{a.damageReport && <p className="mt-1 text-xs text-slate-500">zu Ticket #{a.damageReport.ticketNumber}</p>}</Tile>)}</div>
      )}
    </>
  );
}

export function AnnouncementsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-ann'], queryFn: () => api<{ id: string; title: string; body: string; important: boolean; publishedAt: string; property: { name: string } | null }[]>('/portal/announcements') });
  return (
    <>
      <Title back="/mehr">Mitteilungen</Title>
      {isLoading ? <Loading /> : !data?.length ? <Tile><EmptyState title="Keine Mitteilungen" /></Tile> : (
        <div className="space-y-3">{data.map((a) => <Tile key={a.id} className={a.important ? 'border-amber-200 bg-amber-50' : ''}><p className="text-xs text-slate-500">{formatDate(a.publishedAt)}{a.property && ` · ${a.property.name}`}</p><p className="mt-0.5 text-sm font-semibold">{a.important && <Badge tone="red" className="mr-1">Wichtig</Badge>}{a.title}</p><p className="mt-1 text-sm whitespace-pre-line text-slate-700">{a.body}</p></Tile>)}</div>
      )}
    </>
  );
}

export function PropertyPage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-prop'], queryFn: () => api<{ property: { name: string; street: string; zip: string; city: string; yearBuilt: number | null; tenantInfo: string | null }; unit: { label: string; floor: string | null }; caretakers: { firstName: string; lastName: string; phone: string | null; email: string }[] }[]>('/portal/property') });
  if (isLoading || !data) return <Loading />;
  return (
    <>
      <Title back="/mehr">Ihre Immobilie</Title>
      <div className="space-y-3">
        {data.map((p, i) => (
          <div key={i} className="space-y-3">
            <Tile><p className="text-base font-semibold">{p.property.name}</p><p className="text-sm text-slate-600">{p.property.street}, {p.property.zip} {p.property.city}</p><p className="mt-1 text-xs text-slate-500">Wohnung {p.unit.label}{p.unit.floor && ` · ${p.unit.floor}`}{p.property.yearBuilt && ` · Baujahr ${p.property.yearBuilt}`}</p></Tile>
            {p.caretakers.map((c) => (
              <Tile key={c.email}><p className="text-xs text-slate-500">Hauswart</p><p className="text-sm font-semibold">{c.firstName} {c.lastName}</p>{c.phone && <a href={`tel:${c.phone}`} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"><Phone className="h-4 w-4" />{c.phone}</a>}</Tile>
            ))}
            {p.property.tenantInfo && <Tile><p className="mb-1 text-sm font-semibold">Hausinformationen</p><p className="text-sm whitespace-pre-line text-slate-700">{p.property.tenantInfo}</p></Tile>}
          </div>
        ))}
      </div>
    </>
  );
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['portal-notif'], queryFn: () => api<{ items: { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[] }>('/notifications') });
  const read = useAction((id: string) => api(`/notifications/${id}/read`, { body: {} }), { invalidate: [['portal-notif'], ['unread']] });
  return (
    <>
      <Title back="/mehr">Benachrichtigungen</Title>
      {isLoading ? <Loading /> : !data?.items.length ? <Tile><EmptyState title="Keine Benachrichtigungen" /></Tile> : (
        <Tile className="p-0 divide-y divide-slate-100">
          {data.items.map((n) => (
            <button key={n.id} className={`block w-full px-4 py-3 text-left ${n.readAt ? '' : 'bg-brand-50/50'}`} onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link) navigate(n.link); }}>
              <p className={`text-sm ${n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</p>
              {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
              <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
            </button>
          ))}
        </Tile>
      )}
    </>
  );
}
