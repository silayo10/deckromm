import { RefObject, useEffect } from 'react';
import { focusManager } from '../services/focusManager';

/**
 * Keeps a programmatically "selected" element visible inside its scroll
 * container (e.g. the active platform chip after LB/RB, or the active row of a
 * list that is not focused right now). Focus-driven scrolling is automatic in
 * the focus manager; this hook covers selection changes that do not move focus.
 */
export function useScrollIntoView(ref: RefObject<HTMLElement | null>, when: unknown, instant = false) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = requestAnimationFrame(() => focusManager.scrollIntoView(el, instant));
    return () => cancelAnimationFrame(id);
  }, [ref, when, instant]);
}
