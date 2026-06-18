import type { ReactNode } from 'react';

import { mergeClasses } from './foundation';

type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div className={mergeClasses('flex items-start justify-between gap-4', className)}>
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-700">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
