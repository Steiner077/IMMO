import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, Field, Input, Modal, useToast } from './ui';

export function ChangePasswordModal({ open, onClose, forced }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setErr('');
    if (next !== rep) return setErr('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { currentPassword: cur, newPassword: next } });
      toast('Passwort geändert');
      setCur('');
      setNext('');
      setRep('');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={forced ? 'Bitte legen Sie ein persönliches Passwort fest' : 'Passwort ändern'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {forced ? 'Später' : 'Abbrechen'}
          </Button>
          <Button onClick={submit} loading={busy}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Aktuelles Passwort">
          <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen, Buchstaben und Ziffern">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Neues Passwort wiederholen" error={err}>
          <Input type="password" value={rep} onChange={(e) => setRep(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}
