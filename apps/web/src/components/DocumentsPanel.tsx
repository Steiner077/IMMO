import { Download, Eye, FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_CATEGORIES } from '@immo/shared';
import { api, download, openInline } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { Doc } from '@/lib/types';
import { Badge, Button, EmptyState, Loading, Select } from './ui';

export function fileSize(b: number) {
  return b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`;
}

export function DocIcon({ mime }: { mime: string }) {
  return mime.startsWith('image/') ? <ImageIcon className="h-4 w-4 text-slate-400" /> : <FileText className="h-4 w-4 text-slate-400" />;
}

/** Dokumentenablage für eine Entität (Immobilie, Objekt, Mieter, Vertrag, Zahlung …) */
export function DocumentsPanel({ filter, defaultCategory }: { filter: Record<string, string>; defaultCategory?: string }) {
  const { can } = useAuth();
  const qs = new URLSearchParams(filter).toString();
  const key = ['documents', qs];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<Doc[]>(`/documents?${qs}`) });
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(defaultCategory ?? '');
  const upload = useAction(
    async (files: FileList) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(filter)) fd.append(k, v);
      if (category) fd.append('category', category);
      for (const f of Array.from(files)) fd.append('file', f);
      return api('/documents', { form: fd });
    },
    { success: 'Dokument hochgeladen', invalidate: [['documents']] },
  );
  const remove = useAction((id: string) => api(`/documents/${id}`, { method: 'DELETE' }), { success: 'Dokument gelöscht', invalidate: [['documents']] });

  return (
    <div>
      {can('document:write') && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} options={DOCUMENT_CATEGORIES} placeholder="Kategorie automatisch erkennen" className="max-w-60" />
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
          <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} loading={upload.isPending} onClick={() => input.current?.click()}>
            Hochladen
          </Button>
        </div>
      )}
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="Keine Dokumente" text="Laden Sie Verträge, Protokolle, Fotos oder Rechnungen hoch." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-3">
              <DocIcon mime={d.mimeType} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-800">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(d.createdAt)} · {fileSize(d.sizeBytes)}
                  {d.visibleToTenant && ' · für Mieter sichtbar'}
                </p>
              </div>
              <Badge>{DOCUMENT_CATEGORIES[d.category as keyof typeof DOCUMENT_CATEGORIES]}</Badge>
              <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Ansehen" onClick={() => openInline(`/documents/${d.id}/download`)}>
                <Eye className="h-4 w-4" />
              </button>
              <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Herunterladen" onClick={() => download(`/documents/${d.id}/download`, d.name)}>
                <Download className="h-4 w-4" />
              </button>
              {can('document:write') && (
                <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Löschen" onClick={() => confirm(`"${d.name}" löschen?`) && remove.mutate(d.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
