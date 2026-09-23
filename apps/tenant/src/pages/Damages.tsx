import { Camera, ChevronRight, Plus, Send, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Field, Input, Loading, Select, Textarea, type Tone } from '@immo/ui';
import { DAMAGE_CATEGORIES, DAMAGE_STATUS, PRIORITIES } from '@immo/shared';
import { api, openInline } from '../lib/api';
import { useAction } from '../lib/hooks';
import { formatDate, formatDateTime } from '../lib/format';
import { Tile, Title } from '../components/Section';

const stTone: Record<string, Tone> = { NEW: 'blue', ACKNOWLEDGED: 'purple', IN_PROGRESS: 'yellow', WAITING: 'gray', RESOLVED: 'green', CLOSED: 'green', REJECTED: 'gray' };
interface D { id: string; ticketNumber: number; title: string; category: string; priority: string; status: string; createdAt: string; unit: { label: string } | null }

export function DamagesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-damages'], queryFn: () => api<D[]>('/portal/damages') });
  return (
    <>
      <Title action={<Link to="/maengel/neu"><Button size="sm" icon={<Plus className="h-4 w-4" />}>Mangel melden</Button></Link>}>Mängel</Title>
      {isLoading ? <Loading /> : !data?.length ? <Tile><EmptyState title="Keine Meldungen" text="Etwas defekt? Melden Sie es direkt hier – mit Fotos." action={<Link to="/maengel/neu"><Button>Mangel melden</Button></Link>} /></Tile> : (
        <div className="space-y-2">
          {data.map((d) => (
            <Link key={d.id} to={`/maengel/${d.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">Ticket #{d.ticketNumber} · {formatDate(d.createdAt)}</p>
                <p className="truncate text-sm font-semibold text-slate-900">{d.title}</p>
                <div className="mt-1.5"><Badge tone={stTone[d.status]}>{DAMAGE_STATUS[d.status as keyof typeof DAMAGE_STATUS]}</Badge></div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-300" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function NewDamagePage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ category: '', title: '', description: '', priority: 'MEDIUM', preferredAppointment: '', location: '' });
  const [files, setFiles] = useState<File[]>([]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => {
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
    files.forEach((file) => fd.append('file', file));
    return api<{ id: string; ticketNumber: number }>('/portal/damages', { form: fd });
  }, { success: (r) => `Ticket #${r.ticketNumber} wurde erstellt`, invalidate: [['portal-damages'], ['overview']], onSuccess: (r) => navigate(`/maengel/${r.id}`, { replace: true }) });
  const valid = f.category && f.title.trim().length >= 3 && f.description.trim().length >= 3;
  return (
    <>
      <Title back="/maengel">Mangel melden</Title>
      <Tile>
        <div className="space-y-4">
          <Field label="Was ist betroffen?">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(DAMAGE_CATEGORIES).map(([k, v]) => (
                <button key={k} type="button" onClick={() => setF({ ...f, category: k })} className={`rounded-xl border px-3 py-2.5 text-left text-sm ${f.category === k ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-slate-200 text-slate-700'}`}>{v}</button>
              ))}
            </div>
          </Field>
          <Field label="Kurzbeschreibung"><Input value={f.title} onChange={set('title')} placeholder="z. B. Heizung funktioniert nicht" /></Field>
          <Field label="Beschreibung"><Textarea rows={4} value={f.description} onChange={set('description')} placeholder="Seit wann? Was genau ist passiert?" /></Field>
          <Field label="Wo in der Wohnung?"><Input value={f.location} onChange={set('location')} placeholder="z. B. Badezimmer" /></Field>
          <Field label="Dringlichkeit"><Select value={f.priority} onChange={set('priority')} options={PRIORITIES} /></Field>
          <Field label="Terminwunsch"><Input value={f.preferredAppointment} onChange={set('preferredAppointment')} placeholder="z. B. werktags ab 17 Uhr" /></Field>
          <Field label="Fotos / Video">
            <input ref={fileRef} type="file" accept="image/*,video/*" capture="environment" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
            <div className="flex flex-wrap gap-2">
              {files.map((file, i) => (
                <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl bg-slate-100">
                  {file.type.startsWith('image/') ? <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center p-1 text-center text-[10px]">{file.name}</span>}
                  <button type="button" className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Entfernen"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-500"><Camera className="h-5 w-5" /><span className="mt-1 text-[10px]">Hinzufügen</span></button>
            </div>
          </Field>
          <Button className="w-full py-3" disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>Meldung absenden</Button>
          <p className="text-center text-xs text-slate-500">Bei Notfällen (Wasserrohrbruch, Gas, Brand) bitte zusätzlich sofort telefonisch melden.</p>
        </div>
      </Tile>
    </>
  );
}

interface DD extends D { description: string; preferredAppointment: string | null; location: string | null; resolvedAt: string | null; property: { name: string }; events: { id: string; type: string; message: string | null; createdAt: string; user: { firstName: string; lastName: string; role: string } | null }[]; documents: { id: string; name: string; mimeType: string }[]; appointments: { id: string; title: string; startAt: string }[] }

export function DamageDetailPage() {
  const { id } = useParams();
  const [msg, setMsg] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['portal-damage', id], queryFn: () => api<DD>(`/portal/damages/${id}`) });
  const send = useAction(() => api(`/portal/damages/${id}/comments`, { body: { message: msg } }), { invalidate: [['portal-damage', id]], onSuccess: () => setMsg('') });
  if (isLoading || !d) return <Loading />;
  return (
    <>
      <Title back="/maengel">Ticket #{d.ticketNumber}</Title>
      <Tile className="mb-3">
        <div className="mb-2 flex flex-wrap gap-1.5"><Badge tone={stTone[d.status]}>{DAMAGE_STATUS[d.status as keyof typeof DAMAGE_STATUS]}</Badge><Badge>{DAMAGE_CATEGORIES[d.category as keyof typeof DAMAGE_CATEGORIES]}</Badge><Badge>{PRIORITIES[d.priority as keyof typeof PRIORITIES]}</Badge></div>
        <p className="text-base font-semibold text-slate-900">{d.title}</p>
        <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{d.description}</p>
        <p className="mt-3 text-xs text-slate-500">{d.property.name}{d.unit && ` · Wohnung ${d.unit.label}`}{d.location && ` · ${d.location}`} · gemeldet {formatDate(d.createdAt)}</p>
        {d.documents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">{d.documents.map((doc) => <button key={doc.id} onClick={() => openInline(`/portal/documents/${doc.id}/download`)} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700">{doc.name}</button>)}</div>
        )}
      </Tile>
      {d.appointments.map((a) => <Tile key={a.id} className="mb-3 border-brand-200 bg-brand-50"><p className="text-xs text-brand-700">Vereinbarter Termin</p><p className="text-sm font-semibold text-brand-900">{a.title}</p><p className="text-sm text-brand-800">{formatDateTime(a.startAt)} Uhr</p></Tile>)}
      <Tile>
        <p className="mb-3 text-sm font-semibold">Verlauf</p>
        <ol className="relative space-y-4 border-l border-slate-200 pl-4">
          {d.events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-slate-300 ring-4 ring-white" />
              <p className="text-sm text-slate-800">{e.message}</p>
              <p className="text-xs text-slate-500">{formatDateTime(e.createdAt)}{e.user && ` · ${e.user.role === 'TENANT' ? 'Sie' : `${e.user.firstName} ${e.user.lastName}`}`}</p>
            </li>
          ))}
        </ol>
        {!['CLOSED', 'REJECTED'].includes(d.status) && (
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Rückmeldung an die Verwaltung …" />
            <Button icon={<Send className="h-4 w-4" />} disabled={!msg.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)} aria-label="Senden" />
          </div>
        )}
      </Tile>
    </>
  );
}
