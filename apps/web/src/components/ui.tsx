/**
 * Kleine, herbruikbare UI-elementen.
 *
 * Ze zitten bij elkaar zodat de schermen zelf alleen nog paginainhoud
 * hoeven te bevatten.
 */

import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card rounded-xl border border-slate-200 bg-white p-4 ${className}`}>{children}</section>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {action}
    </header>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  full?: boolean;
  title?: string;
  ariaLabel?: string;
};

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  full = false,
  title,
  ariaLabel,
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2.5 text-sm';
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    ghost: 'text-brand-700 hover:bg-brand-50',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`${base} ${sizes} ${variants} ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
}

/** Kleurvlakje met de naam van een winkel. */
export function StoreChip({ name, color, small = false }: { name: string; color?: string | null; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white ${small ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? '#94a3b8' }}
      />
      {name}
    </span>
  );
}

/** Statuslabel met kleur die de tekst ook draagt, niet alleen de kleur. */
export function StatusPill({ status, label }: { status: 'ok' | 'warn' | 'error' | 'info'; label: string }) {
  const styles = {
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-brand-50 text-brand-800 border-brand-200',
  }[status];

  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>{label}</span>;
}

/** Lege staat: zegt wat er aan is en wat je kunt doen. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children ? <div className="mt-2 text-sm text-slate-600">{children}</div> : null}
    </div>
  );
}

/** Meldingsblok. `soort` bepaalt kleur én icoon-tekst, zodat de betekenis
 *  ook zonder kleur te lezen is. */
export function Notice({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'warning' | 'error' | 'success';
  title: string;
  children?: ReactNode;
}) {
  const styles = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[kind];
  const prefix = { info: 'Let op:', warning: 'Let op:', error: 'Fout:', success: 'Gelukt:' }[kind];

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p className="font-medium">
        {prefix} {title}
      </p>
      {children ? <div className="mt-1 leading-relaxed">{children}</div> : null}
    </div>
  );
}

/** Laatst bijgewerkt, met de tijd die er sinds toen is verstreken. */
export function LastUpdated({ seconds, label = 'Bijgewerkt' }: { seconds: number | null; label?: string }) {
  return (
    <p className="text-xs text-slate-500">
      {label}:{' '}
      {seconds === null ? 'nog niet' : timeAgo(seconds)}
    </p>
  );
}

function timeAgo(seconds: number): string {
  if (seconds < 60) return 'zojuist';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} uur geleden`;
  return `${Math.round(hours / 24)} dagen geleden`;
}

export function Spinner({ label = 'Bezig' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600" role="status">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
      />
      {label}…
    </div>
  );
}

/** Datalijst voor kleine feiten (laatst bijgewerkt, aantal winkels, enz.). */
export function StatRow({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
