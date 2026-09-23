import clsx from 'clsx';
import { Bell, Home, LogOut, MessageSquare, MoreHorizontal, Wallet, Wrench } from 'lucide-react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loading } from '@immo/ui';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { PaymentsPage } from './pages/Payments';
import { DamagesPage, DamageDetailPage, NewDamagePage } from './pages/Damages';
import { MessagesPage, ThreadPage } from './pages/Messages';
import { MorePage, LeasePage, DocumentsPage, AppointmentsPage, AnnouncementsPage, PropertyPage, NotificationsPage } from './pages/More';
import { ChangePassword } from './pages/ChangePassword';

const TABS = [
  { to: '/', label: 'Übersicht', icon: Home },
  { to: '/zahlungen', label: 'Zahlungen', icon: Wallet },
  { to: '/maengel', label: 'Mängel', icon: Wrench },
  { to: '/nachrichten', label: 'Nachrichten', icon: MessageSquare },
  { to: '/mehr', label: 'Mehr', icon: MoreHorizontal },
];

function Shell() {
  const { user, logout, mustChangePassword } = useAuth();
  const loc = useLocation();
  const { data } = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  if (mustChangePassword) return <ChangePassword forced />;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="safe-top sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-white"><Home className="h-4 w-4" /></span>
            <span className="text-sm font-semibold text-ink">Mein Zuhause</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => clsx('rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-slate-100 text-ink' : 'text-slate-500 hover:text-slate-800')}>{t.label}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <Link to="/benachrichtigungen" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Benachrichtigungen">
              <Bell className="h-5 w-5" />
              {!!data?.unread && <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
            </Link>
            <button onClick={logout} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:block" aria-label="Abmelden" title={`${user?.firstName} ${user?.lastName} abmelden`}><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-28 md:pb-10" key={loc.pathname}>
        <Outlet />
      </main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}>
              <t.icon className="h-5 w-5" />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route index element={<HomePage />} />
        <Route path="zahlungen" element={<PaymentsPage />} />
        <Route path="maengel" element={<DamagesPage />} />
        <Route path="maengel/neu" element={<NewDamagePage />} />
        <Route path="maengel/:id" element={<DamageDetailPage />} />
        <Route path="nachrichten" element={<MessagesPage />} />
        <Route path="nachrichten/:id" element={<ThreadPage />} />
        <Route path="mehr" element={<MorePage />} />
        <Route path="vertrag" element={<LeasePage />} />
        <Route path="dokumente" element={<DocumentsPage />} />
        <Route path="termine" element={<AppointmentsPage />} />
        <Route path="mitteilungen" element={<AnnouncementsPage />} />
        <Route path="immobilie" element={<PropertyPage />} />
        <Route path="benachrichtigungen" element={<NotificationsPage />} />
        <Route path="passwort" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
