import clsx from 'clsx';
import {
  Bell, Building2, CalendarDays, CheckSquare, ChevronDown, FileText, FolderOpen, Gauge, History, KeyRound, LogOut, Menu, MessageSquare,
  Settings, Upload, Users, Wallet, Wrench, X, Zap, BarChart3, CalendarCheck, PieChart, Search,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type Permission } from '@immo/shared';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { GlobalSearch } from './GlobalSearch';
import { ChangePasswordModal } from '../ChangePasswordModal';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm?: Permission;
}
const i = 'h-[18px] w-[18px]';
const NAV: { group: string; items: NavItem[] }[] = [
  { group: '', items: [{ to: '/', label: 'Dashboard', icon: <Gauge className={i} />, perm: 'dashboard:read' }] },
  {
    group: 'Bestand',
    items: [
      { to: '/immobilien', label: 'Immobilien', icon: <Building2 className={i} />, perm: 'property:read' },
      { to: '/mieter', label: 'Mieter', icon: <Users className={i} />, perm: 'tenant:read' },
      { to: '/mietvertraege', label: 'Mietverträge', icon: <KeyRound className={i} />, perm: 'lease:read' },
    ],
  },
  {
    group: 'Finanzen',
    items: [
      { to: '/zahlungen', label: 'Zahlungen', icon: <Wallet className={i} />, perm: 'finance:read' },
      { to: '/zahlungen/import', label: 'Zahlungen importieren', icon: <Upload className={i} />, perm: 'payment:import' },
      { to: '/monatsabschluss', label: 'Monatsabschluss', icon: <CalendarCheck className={i} />, perm: 'finance:read' },
      { to: '/finanzen', label: 'Finanzen', icon: <PieChart className={i} />, perm: 'finance:read' },
      { to: '/berichte', label: 'Berichte', icon: <BarChart3 className={i} />, perm: 'report:read' },
    ],
  },
  {
    group: 'Betrieb',
    items: [
      { to: '/maengel', label: 'Mängel', icon: <Wrench className={i} />, perm: 'damage:read' },
      { to: '/dokumente', label: 'Dokumente', icon: <FolderOpen className={i} />, perm: 'document:read' },
      { to: '/nachrichten', label: 'Nachrichten', icon: <MessageSquare className={i} />, perm: 'message:read' },
      { to: '/aufgaben', label: 'Aufgaben', icon: <CheckSquare className={i} />, perm: 'task:read' },
      { to: '/termine', label: 'Termine', icon: <CalendarDays className={i} />, perm: 'appointment:read' },
    ],
  },
  {
    group: 'System',
    items: [
      { to: '/automatisierung', label: 'Automatisierung', icon: <Zap className={i} />, perm: 'automation:manage' },
      { to: '/protokoll', label: 'Änderungsprotokoll', icon: <History className={i} />, perm: 'audit:read' },
      { to: '/einstellungen', label: 'Einstellungen', icon: <Settings className={i} />, perm: 'dashboard:read' },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const { data: org } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ organization: { name: string } }>('/settings') });
  return (
    <div className="flex h-full flex-col bg-ink text-slate-300">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
          <Building2 className="h-4.5 w-4.5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-white">IMMO</p>
          <p className="truncate text-[11px] text-slate-400">{org?.organization.name ?? 'Verwaltung'}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV.map((g) => {
          const items = g.items.filter((it) => !it.perm || can(it.perm));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              {g.group && <p className="mb-1.5 px-2 text-[11px] font-medium tracking-wider text-slate-500 uppercase">{g.group}</p>}
              <div className="space-y-0.5">
                {items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.to === '/' || it.to === '/zahlungen'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                        isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                      )
                    }
                  >
                    {it.icon}
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-5 py-3 text-[11px] text-slate-500">Version 1.0 · Daten verschlüsselt übertragen</div>
    </div>
  );
}

function NotificationBell() {
  const { data } = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  return (
    <Link to="/benachrichtigungen" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Benachrichtigungen">
      <Bell className="h-5 w-5" />
      {!!data?.unread && (
        <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
          {data.unread > 99 ? '99+' : data.unread}
        </span>
      )}
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 hover:bg-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials(user.firstName, user.lastName)}</span>
        <span className="hidden text-left md:block">
          <span className="block text-sm leading-4 font-medium text-slate-800">
            {user.firstName} {user.lastName}
          </span>
          <span className="block text-[11px] text-slate-500">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">{user.email}</div>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPw(true); setOpen(false); }}>
            <KeyRound className="h-4 w-4" /> Passwort ändern
          </button>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50" onClick={async () => { await logout(); navigate('/login'); }}>
            <LogOut className="h-4 w-4" /> Abmelden
          </button>
        </div>
      )}
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  const { mustChangePassword, clearPasswordFlag } = useAuth();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button className="absolute top-4 -right-10 text-white" onClick={() => setMobileOpen(false)} aria-label="Menü schliessen">
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menü">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden flex-1 md:block">
            <GlobalSearch />
          </div>
          <div className="flex-1 md:hidden" />
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setSearchOpen(!searchOpen)} aria-label="Suche">
            <Search className="h-5 w-5" />
          </button>
          <NotificationBell />
          <UserMenu />
        </header>
        {searchOpen && (
          <div className="border-b border-slate-200 bg-white p-3 md:hidden">
            <GlobalSearch />
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <ChangePasswordModal open={mustChangePassword} onClose={clearPasswordFlag} forced />
    </div>
  );
}

export { FileText };
