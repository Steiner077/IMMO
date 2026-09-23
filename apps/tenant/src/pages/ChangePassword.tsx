import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input, useToast } from '@immo/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Tile, Title } from '../components/Section';

export function ChangePassword({ forced }: { forced?: boolean }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const { clearPasswordFlag } = useAuth();
  const body = (
    <Tile>
      {forced && <p className="mb-4 text-sm text-slate-600">Bitte legen Sie beim ersten Login ein persönliches Passwort fest.</p>}
      <div className="space-y-4">
        <Field label="Aktuelles Passwort"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen, Buchstaben und Ziffern" error={err}><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Button className="w-full" loading={busy} onClick={async () => {
          setBusy(true);
          setErr('');
          try {
            await api('/auth/change-password', { body: { currentPassword: cur, newPassword: next } });
            toast('Passwort geändert');
            clearPasswordFlag();
            navigate('/');
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>Speichern</Button>
      </div>
    </Tile>
  );
  return forced ? <div className="mx-auto max-w-sm px-4 py-16"><Title>Persönliches Passwort</Title>{body}</div> : <><Title back="/mehr">Passwort ändern</Title>{body}</>;
}
