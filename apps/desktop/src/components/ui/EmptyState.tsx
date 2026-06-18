import type { ReactNode } from 'react';

import { mergeClasses } from './foundation';

type EmptyTone = 'loading' | 'no-data' | 'disconnected' | 'error';

const toneClasses: Record<EmptyTone, string> = {
  loading: 'border-slate-300 bg-slate-50 text-slate-700',
  'no-data': 'border-slate-300 bg-slate-50 text-slate-700',
  disconnected: 'border-amber-300 bg-amber-50 text-amber-800',
  error: 'border-rose-300 bg-rose-50 text-rose-800',
};

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  tone?: EmptyTone;
  className?: string;
};

export function EmptyState({
  title,
  description,
  tone = 'no-data',
  className,
}: EmptyStateProps) {
  return (
    <div className={mergeClasses('rounded-2xl border px-4 py-5', toneClasses[tone], className)}>
      <p className="font-semibold">{title}</p>
      {description ? <p className="mt-2 text-sm">{description}</p> : null}
    </div>
  );
}
