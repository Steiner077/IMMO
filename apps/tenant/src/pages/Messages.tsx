import { ChevronRight, Plus, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Input, Loading, Modal, Textarea } from '@immo/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/hooks';
import { formatDateTime } from '../lib/format';
import { Tile, Title } from '../components/Section';

interface Conv { id: string; subject: string; lastMessageAt: string; unread: boolean; lastMessage: { body: string } | null; damageReport: { ticketNumber: number } | null }

export function MessagesPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['portal-conv'], queryFn: () => api<Conv[]>('/portal/conversations'), refetchInterval: 30_000 });
  const create = useAction(() => api<{ id: string }>('/portal/conversations', { body: { subject, body } }), { success: 'Nachricht gesendet', invalidate: [['portal-conv']], onSuccess: (r) => navigate(`/nachrichten/${r.id}`) });
  return (
    <>
      <Title action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Neu</Button>}>Nachrichten</Title>
      {isLoading ? <Loading /> : !data?.length ? <Tile><EmptyState title="Noch keine Nachrichten" text="Schreiben Sie der Verwaltung direkt aus der App." /></Tile> : (
        <div className="space-y-2">
          {data.map((c) => (
            <Link key={c.id} to={`/nachrichten/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              {c.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${c.unread ? 'font-semibold' : 'font-medium'} text-slate-900`}>{c.subject}</p>
                <p className="truncate text-xs text-slate-500">{c.lastMessage?.body}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(c.lastMessageAt)}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-300" />
            </Link>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nachricht an die Verwaltung" footer={<Button disabled={!subject || !body} loading={create.isPending} onClick={() => create.mutate(undefined)}>Senden</Button>}>
        <div className="space-y-4">
          <Field label="Betreff"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Nachricht"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

interface Thread { id: string; subject: string; messages: { id: string; body: string; createdAt: string; sender: { id: string; firstName: string; lastName: string } }[] }

export function ThreadPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['portal-thread', id], queryFn: () => api<Thread>(`/portal/conversations/${id}`), refetchInterval: 15_000 });
  const send = useAction(() => api(`/portal/conversations/${id}/messages`, { body: { body } }), { invalidate: [['portal-thread', id], ['portal-conv']], onSuccess: () => setBody('') });
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [data?.messages.length]);
  if (isLoading || !data) return <Loading />;
  return (
    <>
      <Title back="/nachrichten">{data.subject}</Title>
      <div className="space-y-3 pb-20">
        {data.messages.map((m) => {
          const mine = m.sender.id === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'}`}>
                <p className="whitespace-pre-line">{m.body}</p>
                <p className={`mt-1 text-[11px] ${mine ? 'text-brand-100' : 'text-slate-400'}`}>{mine ? 'Sie' : m.sender.firstName} · {formatDateTime(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="safe-bottom fixed inset-x-0 bottom-[60px] z-20 border-t border-slate-200 bg-white px-4 pt-2 md:bottom-0">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nachricht …" onKeyDown={(e) => e.key === 'Enter' && body.trim() && send.mutate(undefined)} />
          <Button icon={<Send className="h-4 w-4" />} disabled={!body.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)} aria-label="Senden" />
        </div>
      </div>
    </>
  );
}
