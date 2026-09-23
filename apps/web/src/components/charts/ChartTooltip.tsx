import { chf } from '@/lib/format';

interface Item { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }
export function MoneyTooltip({ active, payload, label, labelFormatter, money = true }: { active?: boolean; payload?: Item[]; label?: string | number; labelFormatter?: (l: string) => string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-800">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-slate-900">{money ? chf(Number(p.value)) : p.value}</span>
        </p>
      ))}
    </div>
  );
}
