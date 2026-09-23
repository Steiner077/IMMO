import { MessageSquarePlus, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type Role } from '@immo/shared';
import { api, openInline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { formatDateTime, initials, tenantName } from '@/lib/format';
import type { TenantRef } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from '@/components/ui';

interface Conv {
  id: string; subject: string; lastMessageAt: string; unread: boolean;
  participants: { user: { id: string; firstName: string; lastName: string; role: string } }[];
  lastMessage: { body: string; sender: { firstName: string; lastName: string } } | null;
  property: { id: string; name: string } | null; unit: { label: string } | null; tenant: TenantRef | null; damageReport: { id: string; ticketNumber: number } | null;
}

export function ConversationList({ filter = {}, activeId }: { filter?: Record<string, string>; activeId?: string }) {
  const qs = new URLSearchParams(filter).toString();
  const { data, isLoading } = useQuery({ queryKey: ['conversations', qs], queryFn: () => api<Conv[]>(`/conversations?${qs}`), refetchInterval: 30_000 });
  const { user } = useAuth();
  if (isLoading) return <Loading />;
  if (!data?.length) return <Card><EmptyState title="Keine Unterhaltungen" /></Card>;
  return (
    <Card bodyClassName="p-0">
      <ul className="divide-y divide-slate-100">
        {data.map((c) => {
          const others = c.participants.filter((p) => p.user.id !== user?.id).map((p) => `${p.user.firstName} ${p.user.lastName}`);
          return (
            <li key={c.id}>
              <Link to={`/nachrichten/${c.id}`} className={`block px-4 py-3 hover:bg-slate-50 ${activeId === c.id ? 'bg-brand-50/60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className={`truncate text-sm ${c.unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>{c.subject}</p>
                  {c.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                </div>
                <p className="truncate text-xs text-slate-500">{others.join(', ')}</p>
                {c.lastMessage && <p className="mt-0.5 truncate text-xs text-slate-400">{c.lastMessage.body}</p>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.property && <Badge>{c.property.name}{c.unit && ` · ${c.unit.label}`}</Badge>}
                  {c.damageReport && <Badge tone="yellow">Ticket #{c.damageReport.ticketNumber}</Badge>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

interface ConvDetail extends Conv {
  messages: { id: string; body: string; createdAt: string; sender: { id: string; firstName: string; lastName: string; role: string }; attachments: { id: string; name: string }[] }[];
}

function Thread({ id }: { id: string }) {
  const { user, can } = useAuth();
  const [body, setBody] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const { data: c, isLoading } = useQuery({ queryKey: ['conversation', id], queryFn: () => api<ConvDetail>(`/conversations/${id}`), refetchInterval: 15_000 });
  const send = useAction(() => api(`/conversations/${id}/messages`, { body: { body } }), { invalidate: [['conversation', id], ['conversations']], onSuccess: () => setBody('') });
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [c?.messages.length]);
  if (isLoading || !c) return <Loading />;
  return (
    <Card className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col" bodyClassName="flex min-h-0 flex-1 flex-col p-0">
      <div className="border-b border-slate-100 px-5 py-3">
        <p className="font-semibold text-slate-900">{c.subject}</p>
        <p className="text-xs text-slate-500">{c.participants.map((p) => `${p.user.firstName} ${p.user.lastName} (${ROLE_LABELS[p.user.role as Role]})`).join(' · ')}</p>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {c.tenant && <Link className="text-brand-700" to={`/mieter/${c.tenant.id}`}>Mieter: {tenantName(c.tenant)}</Link>}
          {c.damageReport && <Link className="text-brand-700" to={`/maengel/${c.damageReport.id}`}>Ticket #{c.damageReport.ticketNumber}</Link>}
          {c.property && <Link className="text-brand-700" to={`/immobilien/${c.property.id}`}>{c.property.name}</Link>}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/50 px-5 py-4">
        {c.messages.map((m) => {
          const mine = m.sender.id === user?.id;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{initials(m.sender.firstName, m.sender.lastName)}</span>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'rounded-tr-sm bg-brand-600 text-white' : 'rounded-tl-sm bg-white text-slate-800 ring-1 ring-slate-200'}`}>
                <p className="whitespace-pre-line">{m.body}</p>
                {m.attachments.map((a) => <button key={a.id} onClick={() => openInline(`/documents/${a.id}/download`)} className="mt-1 block text-xs underline">{a.name}</button>)}
                <p className={`mt-1 text-[11px] ${mine ? 'text-brand-100' : 'text-slate-400'}`}>{m.sender.firstName} · {formatDateTime(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {can('message:write') && (
        <div className="flex gap-2 border-t border-slate-100 p-3">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nachricht schreiben …" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) send.mutate(undefined); }} />
          <Button icon={<Send className="h-4 w-4" />} disabled={!body.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)} className="self-end">Senden</Button>
        </div>
      )}
    </Card>
  );
}

export function MessagesPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Nachrichten" subtitle="Kommunikation mit Mietern, Hauswarten und Dienstleistern" actions={can('message:write') && <Button icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setOpen(true)}>Neue Nachricht</Button>} />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className={id ? 'hidden lg:block' : ''}><ConversationList activeId={id} /></div>
        {id ? <Thread id={id} /> : <Card className="hidden lg:block"><EmptyState title="Unterhaltung auswählen" text="Wählen Sie links eine Unterhaltung oder starten Sie eine neue." /></Card>}
      </div>
      {open && <NewConversation onClose={() => setOpen(false)} />}
    </>
  );
}

function NewConversation({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: recipients } = useQuery({ queryKey: ['recipients'], queryFn: () => api<{ id: string; firstName: string; lastName: string; role: string; tenantId: string | null; tenant: { leases: { unit: { label: string; propertyId: string; property: { name: string } } }[] } | null }[]>('/conversations/recipients') });
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const r = recipients?.find((x) => x.id === to);
  const save = useAction(() => {
    const lease = r?.tenant?.leases[0];
    return api<{ id: string }>('/conversations', { body: { subject, body, participantIds: [to], tenantId: r?.tenantId ?? null, propertyId: lease?.unit.propertyId ?? null } });
  }, { success: 'Nachricht gesendet', invalidate: [['conversations']], onSuccess: (res) => { onClose(); navigate(`/nachrichten/${res.id}`); } });
  const groups: Record<string, string> = { TENANT: 'Mieter', CARETAKER: 'Hauswart', SERVICE_PROVIDER: 'Dienstleister' };
  return (
    <Modal open onClose={onClose} title="Neue Nachricht" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!to || !subject || !body} loading={save.isPending} onClick={() => save.mutate(undefined)}>Senden</Button></>}>
      <div className="space-y-4">
        <Field label="Empfänger">
          <Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Bitte wählen" options={(recipients ?? []).map((x) => ({ value: x.id, label: `${x.firstName} ${x.lastName} – ${groups[x.role] ?? ROLE_LABELS[x.role as Role]}${x.tenant?.leases[0] ? ` (${x.tenant.leases[0].unit.property.name} ${x.tenant.leases[0].unit.label})` : ''}` }))} />
        </Field>
        <Field label="Betreff"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Nachricht"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Mieter ohne App-Zugang erscheinen nicht in der Liste. Kanäle wie E-Mail, SMS oder Push sind über die Schnittstelle vorbereitet.</p>
      </div>
    </Modal>
  );
}
