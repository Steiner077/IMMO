import { Home } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Field, Input } from '@immo/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-6">
      <form
        className="mx-auto w-full max-w-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await login(email, password);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white"><Home className="h-7 w-7" /></div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Willkommen zu Hause</h1>
        <p className="mt-1 text-sm text-slate-500">Melden Sie sich mit den Zugangsdaten Ihrer Verwaltung an.</p>
        <div className="mt-8 space-y-4">
          <Field label="E-Mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Passwort" error={error}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Button type="submit" loading={busy} className="w-full py-3">Anmelden</Button>
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">Ihre Daten werden verschlüsselt übertragen und sind nur für Sie sichtbar.</p>
      </form>
    </div>
  );
}
