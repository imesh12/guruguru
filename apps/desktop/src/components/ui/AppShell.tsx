import type { CSSProperties, ReactNode } from 'react';

import { AdminAuthControl } from '../AdminAuthControl';
import { mergeClasses, municipalFontStack, sectionGapClass, shellBaseClass } from './foundation';

type AppShellProps = {
  children: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  containerClassName?: string;
  contentClassName?: string;
  fullViewport?: boolean;
  headerless?: boolean;
};

export function AppShell({
  children,
  eyebrow,
  title,
  description,
  actions,
  className,
  containerClassName,
  contentClassName,
  fullViewport = false,
  headerless = false,
}: AppShellProps) {
  const rootStyle: CSSProperties = {
    fontFamily: municipalFontStack,
  };

  return (
    <main
      className={mergeClasses(
        fullViewport ? 'h-screen w-screen overflow-hidden' : 'min-h-screen px-6 py-8',
        shellBaseClass,
        className,
      )}
      style={rootStyle}
    >
      <div className={mergeClasses('mx-auto max-w-7xl', sectionGapClass, containerClassName)}>
        {!headerless && (eyebrow || title || description || actions) ? (
          <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              {eyebrow ? <p className="text-[16px] tracking-[0.18em] text-slate-600">{eyebrow}</p> : null}
              {title ? <h1 className="text-4xl font-semibold tracking-tight text-slate-900">{title}</h1> : null}
              {description ? <p className="mt-2 max-w-4xl text-[16px] leading-7 text-slate-700">{description}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {actions}
              <AdminAuthControl />
            </div>
          </header>
        ) : null}
        <div className={mergeClasses(sectionGapClass, contentClassName)}>{children}</div>
      </div>
    </main>
  );
}
