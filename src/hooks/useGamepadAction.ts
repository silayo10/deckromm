import { useEffect, useRef, useState } from 'react';
import { NavigationAction, GamepadButtonState } from '../types';
import { ActionMeta, gamepadService } from '../services/gamepadService';

/** Subscribe to raw controller actions (prefer scope `onAction` for UI screens). */
export function useGamepadAction(
  handler: (action: NavigationAction, meta: ActionMeta) => boolean | void,
  { enabled = true, priority = 0 }: { enabled?: boolean; priority?: number } = {}
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return gamepadService.addListener((a, m) => ref.current(a, m), priority);
  }, [enabled, priority]);
}

/** Live controller connection state (for the HUD glyphs). */
export function useGamepadState(): GamepadButtonState {
  const [state, setState] = useState<GamepadButtonState>(gamepadService.currentState);
  useEffect(() => gamepadService.addStateListener(setState), []);
  return state;
}
