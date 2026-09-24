import { RefObject, useLayoutEffect, useRef } from 'react';
import { focusManager, ScopeOptions } from '../services/focusManager';

/**
 * Registers `ref` as a focus scope while `active` is true. The newest scope is
 * the only navigable one (modal focus trap). Callbacks are kept in a ref so
 * changing handlers never re-creates the scope (which would reset focus).
 */
export function useFocusScope(ref: RefObject<HTMLElement | null>, options: ScopeOptions & { active?: boolean } = {}) {
  const { active = true, ...rest } = options;
  const optsRef = useRef(rest);
  optsRef.current = rest;

  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const pop = focusManager.pushScope(el, {
      name: rest.name,
      initialFocus: rest.initialFocus,
      restoreFocus: rest.restoreFocus,
      nativeFocus: rest.nativeFocus,
      base: rest.base,
      onBack: rest.onBack ? () => optsRef.current.onBack?.() : undefined,
      onAction: (a, m) => optsRef.current.onAction?.(a, m),
      onEdge: (d) => optsRef.current.onEdge?.(d),
    });
    return pop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref]);
}
