import React, { useRef } from 'react';
import { useFocusScope } from '../hooks/useFocusScope';
import { ScopeOptions } from '../services/focusManager';

type Props = ScopeOptions &
  React.HTMLAttributes<HTMLDivElement> & {
    active?: boolean;
    children: React.ReactNode;
  };

/** Declarative focus scope: <FocusScope onBack={close}>...</FocusScope> */
export const FocusScope: React.FC<Props> = ({ active, onBack, onAction, onEdge, initialFocus, restoreFocus, nativeFocus, name, children, ...divProps }) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(ref, { active, onBack, onAction, onEdge, initialFocus, restoreFocus, nativeFocus, name });
  return (
    <div ref={ref} data-focus-scope={name || ''} {...divProps}>
      {children}
    </div>
  );
};
