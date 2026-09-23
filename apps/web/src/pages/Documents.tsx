import { Download, Eye, Search, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_CATEGORIES } from '@immo/shared';
import { api, download, openInline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { formatDate, tenantName } from '@/lib/format';
import type { Doc, Property } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select } from '@/components/ui';
import { DocIcon, fileSize } from '@/components/DocumentsPanel';

export function DocumentsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [category, setCategory] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [upload, setUpload] = useState(false);
  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('/properties') });
  const qs = new URLSearchParams({ ...(search && { search }), ...(category && { category }), ...(propertyId && { propertyId }) });
  const { data, isLoading } = useQuery({ queryKey: ['documents', 'all', qs.toString()], queryFn: () => api<Doc[]>(`/documents?${qs}`) });
  const counts = (data ?? []).reduce<Record<string, number>>((a, d) => ((a[d.category] = (a[d.category] ?? 0) + 1), a), {});
  return (
    <>
      <PageHeader title="Dokumente" subtitle="Zentrale Ablage – automatisch klassifiziert und mit Immobilien, Wohnungen, Mietern und Zahlungen verknüpft." actions={can('document:write') && <Button icon={<Upload className="h-4 w-4" />} onClick={() => setUpload(true)}>Hochladen</Button>} />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card bodyClassName="p-2">
          <button onClick={() => setCategory('')} className={`flex w-full justify-between rounded-lg px-3 py-2 text-sm ${!category ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'}`}>Alle Kategorien</button>
          {Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => (
            <button key={k} onClick={() => setCategory(k)} className={`flex w-full justify-between rounded-lg px-3 py-2 text-sm ${category === k ? 'bg-slate-100 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
              {v}{!category && counts[k] ? <span className="text-xs text-slate-400">{counts[k]}</span> : null}
            </button>
          ))}
        </Card>
        <Card bodyClassName="p-0">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <div className="relative min-w-60 flex-1"><Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" placeholder="Dateiname suchen" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Select className="w-56" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} placeholder="Alle Immobilien" options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          </div>
          {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Keine Dokumente" /> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Dokument</th><th>Kategorie</th><th>Zuordnung</th><th>Datum</th><th className="num">Grösse</th><th /></tr></thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.id}>
                      <td><div className="flex items-center gap-2"><DocIcon mime={d.mimeType} /><span className="max-w-72 truncate font-medium text-slate-800">{d.name}</span></div>{d.description && <p className="pl-6 text-xs text-slate-500">{d.description}</p>}</td>
                      <td><Badge>{DOCUMENT_CATEGORIES[d.category as keyof typeof DOCUMENT_CATEGORIES]}</Badge>{d.classificationScore !== null && d.classificationScore > 0 && d.classificationScore < 100 && <p className="mt-0.5 text-[11px] text-slate-400">automatisch ({d.classificationScore} %)</p>}</td>
                      <td className="text-xs text-slate-600">{[d.property?.name, d.unit?.label, d.tenant && tenantName(d.tenant)].filter(Boolean).join(' · ') || '–'}{d.visibleToTenant && <p className="text-emerald-700">für Mieter sichtbar</p>}</td>
                      <td className="whitespace-nowrap">{formatDate(d.createdAt)}</td>
                      <td className="num text-xs">{fileSize(d.sizeBytes)}</td>
                      <td className="whitespace-nowrap">
                        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => openInline(`/documents/${d.id}/download`)} title="Ansehen"><Eye className="h-4 w-4" /></button>
                        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => download(`/documents/${d.id}/download`, d.name)} title="Herunterladen"><Download className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {upload && <UploadModal properties={properties ?? []} onClose={() => setUpload(false)} />}
    </>
  );
}

function UploadModal({ properties, onClose }: { properties: Property[]; onClose: () => void }) {
  const [f, setF] = useState({ propertyId: '', category: '', description: '', visibleToTenant: false });
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const save = useAction(() => {
    const fd = new FormData();
    if (f.propertyId) fd.append('propertyId', f.propertyId);
    if (f.category) fd.append('category', f.category);
    if (f.description) fd.append('description', f.description);
    fd.append('visibleToTenant', String(f.visibleToTenant));
    for (const file of Array.from(files ?? [])) fd.append('file', file);
    return api('/documents', { form: fd });
  }, { success: 'Hochgeladen', invalidate: [['documents']], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Dokumente hochladen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!files?.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>Hochladen</Button></>}>
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center">
          <input ref={input} type="file" multiple hidden onChange={(e) => setFiles(e.target.files)} />
          <Button variant="secondary" onClick={() => input.current?.click()}>Dateien auswählen</Button>
          <p className="mt-2 text-xs text-slate-500">{files?.length ? `${files.length} Datei(en) ausgewählt` : 'PDF, Bilder, Office-Dateien'}</p>
        </div>
        <Field label="Immobilie"><Select value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })} placeholder="– ohne –" options={properties.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Kategorie" hint="Leer lassen für automatische Klassifizierung"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Automatisch erkennen" options={DOCUMENT_CATEGORIES} /></Field>
        <Field label="Beschreibung"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
