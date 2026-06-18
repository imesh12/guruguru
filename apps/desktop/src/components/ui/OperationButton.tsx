import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { mergeClasses } from './foundation';

type Variant = 'primary' | 'secondary' | 'danger' | 'success';

const variantClasses: Record<Variant, string> = {
  primary: 'border-sky-700 bg-sky-700 text-white',
  secondary: 'border-slate-400 bg-white text-slate-900',
  danger: 'border-rose-700 bg-white text-rose-700',
  success: 'border-emerald-700 bg-emerald-700 text-white',
};

type SharedProps = {
  children: ReactNode;
  variant?: Variant;
  className?: string;
};

type ButtonProps = SharedProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: never;
  };

type LinkProps = SharedProps & {
  to: string;
};

export function OperationButton(props: ButtonProps | LinkProps) {
  const variant = props.variant ?? 'secondary';
  const className = mergeClasses(
    'inline-flex min-h-12 items-center justify-center rounded-xl border px-4 py-3 text-[16px] font-semibold leading-6',
    variantClasses[variant],
    props.className,
  );

  if ('to' in props && props.to) {
    const { to, children, className: _className, variant: _variant } = props;
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  const { children, className: _className, variant: _variant, ...buttonProps } = props;
  return (
    <button {...buttonProps} className={className}>
      {children}
    </button>
  );
}
