import clsx from 'clsx';
import { X, Loader2, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

// ───────────── Button ─────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-xs',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-xs',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs',
};
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ───────────── Formularfelder ─────────────
export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx('input', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={4} {...p} className={clsx('input', p.className)} />;
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] | Record<string, string>; placeholder?: string }) {
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([value, label]) => ({ value, label }));
  return (
    <select {...p} className={clsx('input pr-8', p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ───────────── Layout-Bausteine ─────────────
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            <ChevronLeft className="h-3.5 w-3.5" /> Zurück
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(bodyClassName ?? 'p-5')}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, sub, tone = 'default', icon, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad'; icon?: ReactNode; to?: string }) {
  const toneCls = { default: 'text-ink', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-700' }[tone];
  const body = (
    <div className="card h-full p-4 transition-colors hover:border-slate-300">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className={clsx('mt-2 text-xl font-semibold tabular-nums tracking-tight', toneCls)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

const badgeTones = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export type Tone = keyof typeof badgeTones;
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', badgeTones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-slate-400', className)} />;
}
export function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner />
    </div>
  );
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size])}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Schliessen">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: ReactNode; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>
        {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} von {total}
      </span>
      <div className="flex gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronLeft className="h-3.5 w-3.5" />} />
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)} icon={<ChevronRight className="h-3.5 w-3.5" />} />
      </div>
    </div>
  );
}

export function KeyValue({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3' }[cols])}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v ?? '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 90 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${Math.max(3, value)}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-slate-700">{value} %</span>
    </div>
  );
}

// ───────────── Toast-Benachrichtigungen ─────────────
type ToastItem = { id: number; text: string; tone: 'success' | 'error' | 'info' };
const ToastCtx = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg ring-1',
              t.tone === 'success' && 'bg-white text-slate-800 ring-emerald-200',
              t.tone === 'error' && 'bg-red-50 text-red-800 ring-red-200',
              t.tone === 'info' && 'bg-white text-slate-800 ring-slate-200',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
