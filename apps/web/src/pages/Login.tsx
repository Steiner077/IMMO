import { Building2, Lock, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button, Field, Input } from '@/components/ui';

export function LoginPage() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">IMMO</span>
        </div>
        <div>
          <h1 className="max-w-md text-3xl leading-tight font-semibold tracking-tight">Die zentrale Plattform für Ihre Immobilienverwaltung.</h1>
          <p className="mt-4 max-w-md text-slate-400">Mieten, Zahlungen, Mängel, Dokumente und Kommunikation – nachvollziehbar, automatisiert und sicher an einem Ort.</p>
        </div>
        <div className="flex gap-6 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Rollenbasierte Zugriffe
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="h-4 w-4" /> Verschlüsselte Übertragung
          </span>
        </div>
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-white">
              <Building2 className="h-5 w-5" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Anmelden</h2>
          <p className="mt-1 text-sm text-slate-500">Verwaltungszugang für Eigentümer, Verwaltung und Team.</p>
          <div className="mt-8 space-y-4">
            <Field label="E-Mail">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Passwort" error={error}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" loading={busy} className="w-full">
              Anmelden
            </Button>
          </div>
          <p className="mt-8 text-xs text-slate-400">Sie sind Mieter? Bitte nutzen Sie die Mieter-App.</p>
        </form>
      </div>
    </div>
  );
}
