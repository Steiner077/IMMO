import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PRIORITIES, TASK_STATUS } from '@immo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { formatDate } from '@/lib/format';
import type { Property, UserLite } from '@/lib/types';
import { Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { PriorityBadge, TaskBadge } from '@/components/StatusBadge';

interface Task { id: string; title: string; description: string | null; status: string; priority: string; dueDate: string | null; assignee: UserLite | null; property: { name: string } | null; unit: { label: string } | null; damageReport: { id: string; ticketNumber: number } | null }

export function TasksPage() {
  const { can, user } = useAuth();
  const [status, setStatus] = useState('OPEN,IN_PROGRESS');
  const [mine, setMine] = useState(false);
  const [edit, setEdit] = useState<Task | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['tasks', status, mine], queryFn: () => api<Task[]>(`/tasks?${new URLSearchParams({ ...(status && { status }), ...(mine && { mine: 'true' }) })}`) });
  const patch = useAction(({ id, ...body }: { id: string; status: string }) => api(`/tasks/${id}`, { method: 'PATCH', body }), { invalidate: [['tasks'], ['dashboard']] });
  const del = useAction((id: string) => api(`/tasks/${id}`, { method: 'DELETE' }), { success: 'Aufgabe gelöscht', invalidate: [['tasks']] });
  const overdue = (t: Task) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE';
  return (
    <>
      <PageHeader title="Aufgaben" subtitle={data ? `${data.length} Aufgaben` : undefined} actions={can('task:write') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Aufgabe erstellen</Button>} />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'OPEN,IN_PROGRESS', label: 'Offene Aufgaben' }, { value: 'DONE', label: 'Erledigte' }, { value: '', label: 'Alle' }]} />
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Nur meine</label>
        </div>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Keine Aufgaben" /> : (
          <ul className="divide-y divide-slate-100">
            {data.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3.5">
                <button
                  disabled={!can('task:write')}
                  onClick={() => patch.mutate({ id: t.id, status: t.status === 'DONE' ? 'OPEN' : 'DONE' })}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${t.status === 'DONE' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 hover:border-emerald-500'}`}
                  aria-label="Erledigt"
                >
                  {t.status === 'DONE' && <Check className="h-3.5 w-3.5" />}
                </button>
                <button className="min-w-0 flex-1 text-left" onClick={() => can('task:write') && setEdit(t)}>
                  <p className={`text-sm font-medium ${t.status === 'DONE' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[t.property?.name && `${t.property.name}${t.unit ? ` · ${t.unit.label}` : ''}`, t.damageReport && `Ticket #${t.damageReport.ticketNumber}`, t.assignee && `${t.assignee.id === user?.id ? 'Ich' : `${t.assignee.firstName} ${t.assignee.lastName}`}`].filter(Boolean).join(' · ')}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {t.dueDate && <span className={`text-xs ${overdue(t) ? 'font-medium text-red-600' : 'text-slate-500'}`}>{formatDate(t.dueDate)}</span>}
                  <PriorityBadge priority={t.priority} />
                  <TaskBadge status={t.status} />
                  {can('task:write') && <button className="rounded p-1 text-slate-300 hover:text-red-600" onClick={() => confirm('Aufgabe löschen?') && del.mutate(t.id)}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <TaskForm task={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { data: users } = useQuery({ queryKey: ['directory'], queryFn: () => api<UserLite[]>('/users/directory') });
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const [f, setF] = useState({ title: task?.title ?? '', description: task?.description ?? '', priority: task?.priority ?? 'MEDIUM', status: task?.status ?? 'OPEN', dueDate: task?.dueDate?.slice(0, 10) ?? '', assigneeId: task?.assignee?.id ?? '', propertyId: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => {
    const body = { ...f, dueDate: f.dueDate || null, assigneeId: f.assigneeId || null, propertyId: f.propertyId || undefined };
    return task ? api(`/tasks/${task.id}`, { method: 'PATCH', body }) : api('/tasks', { body });
  }, { success: 'Aufgabe gespeichert', invalidate: [['tasks'], ['dashboard']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!f.title} loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Titel" className="sm:col-span-2"><Input value={f.title} onChange={set('title')} autoFocus /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={set('description')} /></Field>
        <Field label="Zuständig"><Select value={f.assigneeId} onChange={set('assigneeId')} placeholder="– niemand –" options={(users ?? []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} /></Field>
        <Field label="Fällig am"><Input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Priorität"><Select value={f.priority} onChange={set('priority')} options={PRIORITIES} /></Field>
        <Field label="Status"><Select value={f.status} onChange={set('status')} options={TASK_STATUS} /></Field>
        {!task && <Field label="Immobilie" className="sm:col-span-2"><Select value={f.propertyId} onChange={set('propertyId')} placeholder="– keine –" options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>}
      </div>
    </Modal>
  );
}
