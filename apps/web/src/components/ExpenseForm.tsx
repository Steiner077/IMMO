import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EXPENSE_CATEGORIES } from '@immo/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { isoDate, toCents } from '@/lib/format';
import type { Property } from '@/lib/types';
import { Button, Field, Input, Modal, Select } from './ui';

/**
 * Ausgabe erfassen – gemeinsam für die Finanzen-Seite und den Monats-Tab
 * einer Immobilie. Ist die Immobilie durch den Kontext schon bekannt
 * (`lockProperty`), wird sie nur angezeigt statt zur Auswahl gestellt.
 */
export function ExpenseForm({
  properties = [],
  onClose,
  initialPropertyId,
  initialDate,
  lockProperty,
  propertyName,
}: {
  properties?: Property[];
  onClose: () => void;
  initialPropertyId?: string;
  initialDate?: string;
  lockProperty?: boolean;
  /** Name der gesperrten Immobilie, falls sie nicht Teil von `properties` ist */
  propertyName?: string;
}) {
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: () => api<{ id: string; name: string }[]>('/providers') });
  const [f, setF] = useState({
    propertyId: initialPropertyId ?? properties[0]?.id ?? '',
    unitId: '',
    category: 'REPAIR',
    date: initialDate ?? isoDate(new Date()),
    amount: '',
    description: '',
    invoiceNumber: '',
    serviceProviderId: '',
  });
  const { data: units } = useQuery({ queryKey: ['units', f.propertyId], queryFn: () => api<{ id: string; label: string }[]>(`/units?propertyId=${f.propertyId}`), enabled: !!f.propertyId });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => api('/expenses', { body: { ...f, amountCents: toCents(f.amount), unitId: f.unitId || null, serviceProviderId: f.serviceProviderId || null } }),
    { success: 'Ausgabe erfasst', invalidate: [['expenses'], ['finance'], ['dashboard'], ['property']], onSuccess: onClose },
  );
  const property = propertyName ?? properties.find((p) => p.id === f.propertyId)?.name;
  return (
    <Modal open onClose={onClose} title="Ausgabe erfassen" footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!f.propertyId || !toCents(f.amount) || !f.description} loading={save.isPending} onClick={() => save.mutate(undefined)}>Speichern</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {lockProperty ? (
          <Field label="Immobilie" className="sm:col-span-2"><p className="input bg-slate-50 text-slate-700">{property ?? '–'}</p></Field>
        ) : (
          <Field label="Immobilie"><Select value={f.propertyId} onChange={set('propertyId')} options={properties.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        )}
        <Field label="Wohnung (optional)"><Select value={f.unitId} onChange={set('unitId')} placeholder="Ganze Immobilie" options={(units ?? []).map((u) => ({ value: u.id, label: u.label }))} /></Field>
        <Field label="Kategorie"><Select value={f.category} onChange={set('category')} options={EXPENSE_CATEGORIES} /></Field>
        <Field label="Datum"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Betrag (CHF)"><Input value={f.amount} onChange={set('amount')} inputMode="decimal" /></Field>
        <Field label="Rechnungsnummer"><Input value={f.invoiceNumber} onChange={set('invoiceNumber')} /></Field>
        <Field label="Beschreibung" className="sm:col-span-2"><Input value={f.description} onChange={set('description')} /></Field>
        <Field label="Dienstleister" className="sm:col-span-2"><Select value={f.serviceProviderId} onChange={set('serviceProviderId')} placeholder="– keiner –" options={(providers ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
      </div>
    </Modal>
  );
}
