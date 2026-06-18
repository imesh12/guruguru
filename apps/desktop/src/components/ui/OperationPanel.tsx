import type { ElementType, ReactNode } from 'react';

import { mergeClasses, panelBaseClass } from './foundation';

type OperationPanelProps = {
  as?: ElementType;
  children: ReactNode;
  className?: string;
};

export function OperationPanel({
  as: Component = 'section',
  children,
  className,
}: OperationPanelProps) {
  return <Component className={mergeClasses(panelBaseClass, 'p-6', className)}>{children}</Component>;
}
