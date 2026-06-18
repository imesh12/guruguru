import type { ReactNode } from 'react';

import { mergeClasses } from './foundation';

type Tone = 'normal' | 'warning' | 'error' | 'offline';

const toneClasses: Record<Tone, string> = {
  normal: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  warning: 'border-amber-300 bg-amber-100 text-amber-800',
  error: 'border-rose-300 bg-rose-100 text-rose-800',
  offline: 'border-slate-300 bg-slate-200 text-slate-700',
};

type StatusIndicatorProps = {
  label: string;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
};

export function StatusIndicator({
  label,
  tone = 'normal',
  icon,
  className,
}: StatusIndicatorProps) {
  return (
    <span
      className={mergeClasses(
        'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold tracking-[0.16em]',
        toneClasses[tone],
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}
