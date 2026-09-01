import type { ReactNode } from 'react';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  RUNNING: 'bg-sky-500/15 text-sky-300 border-sky-500/30 animate-pulse',
  READY: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  PENDING: 'bg-slate-600/20 text-slate-400 border-slate-600/40',
  WAITING_APPROVAL: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  FAILED: 'bg-red-500/15 text-red-300 border-red-500/30',
  ERROR: 'bg-red-500/15 text-red-300 border-red-500/30',
  CANCELLED: 'bg-slate-600/20 text-slate-500 border-slate-600/40',
  IDLE: 'bg-slate-600/15 text-slate-400 border-slate-600/40',
  DISABLED: 'bg-slate-800 text-slate-500 border-slate-700',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  const color = STATUS_COLORS[tone] ?? STATUS_COLORS[tone?.toUpperCase() ?? ''] ?? 'bg-slate-700/20 text-slate-300 border-slate-600/40';
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${color}`}>
      {children}
    </span>
  );
}

export function toneForStatus(status?: string): string {
  return (status ?? '').toUpperCase();
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-ink-700/60 bg-ink-900/70 ${className}`}>{children}</div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? 'text-slate-100'}`}>{value}</div>
    </Card>
  );
}

export function Btn({
  children,
  onClick,
  kind = 'default',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'default' | 'primary' | 'danger' | 'success' | 'ghost';
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed';
  const kinds: Record<string, string> = {
    default: 'bg-ink-700/60 hover:bg-ink-700 text-slate-200 border border-ink-700',
    primary: 'bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    danger: 'bg-red-600/80 hover:bg-red-600 text-white',
    ghost: 'bg-transparent hover:bg-ink-800 text-slate-300 border border-ink-700',
  };
  return (
    <button className={`${base} ${kinds[kind]}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">{children}</h2>
  );
}
