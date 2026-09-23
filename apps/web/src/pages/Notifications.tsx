import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NOTIFICATION_TYPES } from '@immo/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, Select } from '@/components/ui';

interface N { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }
const tone = (t: string) => (['RENT_OVERDUE', 'PAYMENT_UNCLEAR', 'DAMAGE_NEW'].includes(t) ? 'red' : ['LEASE_EXPIRING', 'RENT_OPEN'].includes(t) ? 'yellow' : ['PAYMENT_POSTED', 'IMPORT_READY'].includes(t) ? 'green' : 'blue') as 'red' | 'yellow' | 'green' | 'blue';

export function NotificationsPage() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(false);
  const [type, setType] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['notifications', unread, type], queryFn: () => api<{ items: N[]; unread: number }>(`/notifications?${new URLSearchParams({ ...(unread && { unread: 'true' }), ...(type && { type }) })}`) });
  const read = useAction((id: string) => api(`/notifications/${id}/read`, { body: {} }), { invalidate: [['notifications'], ['unread']] });
  const readAll = useAction(() => api('/notifications/read-all', { body: {} }), { success: 'Alle als gelesen markiert', invalidate: [['notifications'], ['unread']] });
  return (
    <>
      <PageHeader title="Benachrichtigungen" subtitle={data ? `${data.unread} ungelesen` : undefined} actions={<Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={() => readAll.mutate(undefined)}>Alle gelesen</Button>} />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Select className="w-60" value={type} onChange={(e) => setType(e.target.value)} placeholder="Alle Arten" options={NOTIFICATION_TYPES} />
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Nur ungelesene</label>
        </div>
        {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Keine Benachrichtigungen" icon={<Bell className="h-5 w-5" />} /> : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((n) => (
              <li key={n.id}>
                <button className={`flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/40'}`} onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link) navigate(n.link); }}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                  </div>
                  <Badge tone={tone(n.type)}>{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
