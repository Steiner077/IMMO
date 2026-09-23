import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Title({ children, back, action }: { children: ReactNode; back?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {back && <Link to={back} className="-ml-2 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Zurück"><ChevronLeft className="h-5 w-5" /></Link>}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{children}</h1>
      </div>
      {action}
    </div>
  );
}

export function Tile({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-xs ${className}`}>{children}</div>;
}
