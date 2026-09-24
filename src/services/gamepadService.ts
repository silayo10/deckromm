/**
 * Gamepad service - single source of controller input for the whole app.
 *
 * - Polls the W3C Gamepad API once per animation frame and MERGES every
 *   connected pad (Steam Deck exposes the built-in controller and/or the
 *   "Steam Virtual Gamepad" depending on mode; merging avoids "wrong pad" bugs).
 * - Standard (XInput) mapping:
 *     A=SELECT  B=BACK  X=ACTION_X  Y=ACTION_Y  LB/RB=PREV/NEXT_PLATFORM
 *     LT/RT=PAGE_UP/PAGE_DOWN  View(Select)=FILTER  Menu(Start)=MENU
 *     L3=VIEW_MODE_TOGGLE  R3=HELP  D-pad / left stick=UP/DOWN/LEFT/RIGHT
 *     right stick Y=SCROLL_UP/SCROLL_DOWN (analog speed)
 * - Only directional/scroll/page actions auto-repeat. Holding A never re-fires,
 *   so a game cannot be launched twice by a long press.
 * - Listeners have priorities; a listener that returns `true` consumes the
 *   action. The spatial focus engine listens at the lowest priority, so modal
 *   components with bespoke handlers (web emulator overlay) win.
 * - Input is suspended while an external emulator runs, when the window loses
 *   focus, and on shutdown (`destroy()`), which also clears every held button so
 *   nothing "sticks" when control returns from a game.
 *
 * The v1 public API (addListener, addStateListener, currentState,
 * setEmulationMode, setOverlayOpen, setOverlayCombo, isEmulationActive,
 * isOverlayOpen, startPolling, stopPolling) is preserved.
 */
import { GamepadButtonState, NavigationAction, OverlayButtonCombo } from '../types';
import { soundService } from './soundService';

type ActionCallback = (action: NavigationAction, meta: ActionMeta) => boolean | void;

export interface ActionMeta {
  source: 'gamepad' | 'keyboard';
  repeat: boolean;
  /** 0..1 analog magnitude for SCROLL_* actions */
  magnitude?: number;
}

interface ListenerEntry {
  cb: ActionCallback;
  priority: number;
  order: number;
}

const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16,
} as const;

const BUTTON_ACTIONS: Array<[number, NavigationAction, boolean]> = [
  // [button index, action, repeats]
  [BTN.A, 'SELECT', false],
  [BTN.B, 'BACK', false],
  [BTN.X, 'ACTION_X', false],
  [BTN.Y, 'ACTION_Y', false],
  [BTN.LB, 'PREV_PLATFORM', true],
  [BTN.RB, 'NEXT_PLATFORM', true],
  [BTN.LT, 'PAGE_UP', true],
  [BTN.RT, 'PAGE_DOWN', true],
  [BTN.SELECT, 'FILTER', false],
  [BTN.START, 'MENU', false],
  [BTN.L3, 'VIEW_MODE_TOGGLE', false],
  [BTN.R3, 'HELP', false],
  [BTN.UP, 'UP', true],
  [BTN.DOWN, 'DOWN', true],
  [BTN.LEFT, 'LEFT', true],
  [BTN.RIGHT, 'RIGHT', true],
];

const REPEAT_DELAY_MS = 320;
const REPEAT_RATE_MS = 85;
const STICK_PRESS = 0.55; // hysteresis: engage above, release below STICK_RELEASE
const STICK_RELEASE = 0.35;
const SCROLL_DEADZONE = 0.22;

const emptyState = (): GamepadButtonState => ({
  a: false, b: false, x: false, y: false, lb: false, rb: false, lt: false, rt: false,
  select: false, start: false, dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false,
  l3: false, r3: false, connected: false, id: '', axes: [0, 0, 0, 0],
});

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(type);
  }
  return (el as HTMLElement).isContentEditable;
}

class GamepadService {
  public currentState: GamepadButtonState = emptyState();
  public isEmulationActive = false;
  public isOverlayOpen = false;
  public overlayCombo: OverlayButtonCombo = 'select_start';
  public lastSource: 'gamepad' | 'keyboard' = 'keyboard';

  private listeners: ListenerEntry[] = [];
  private stateListeners = new Set<(s: GamepadButtonState) => void>();
  private order = 0;
  private rafId: number | null = null;
  private running = false;
  private suspended = false;
  private destroyed = false;
  private held = new Map<string, { since: number; next: number }>();
  private stickLatched = { up: false, down: false, left: false, right: false };
  private wasComboPressed = false;
  private scrollNext = 0;
  private keyHandler = (e: KeyboardEvent) => this.handleKeyboard(e);
  private blurHandler = () => this.resetHeld();
  private visHandler = () => {
    if (document.hidden) this.resetHeld();
  };

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('gamepadconnected', (e) => {
      this.currentState.connected = true;
      this.currentState.id = (e as GamepadEvent).gamepad?.id || 'Gamepad';
      this.lastSource = 'gamepad';
      this.notifyState();
      this.startPolling();
    });
    window.addEventListener('gamepaddisconnected', () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      this.currentState.connected = Array.from(pads).some(Boolean);
      this.resetHeld();
      this.notifyState();
    });
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('blur', this.blurHandler);
    document.addEventListener('visibilitychange', this.visHandler);
    this.startPolling();
  }

  // ------------------------------------------------------------ public API
  /**
   * Subscribe to navigation actions. Higher `priority` runs first; return `true`
   * to consume the action. Returns an unsubscribe function.
   */
  addListener(cb: ActionCallback | ((action: NavigationAction) => void), priority = 0): () => void {
    const entry: ListenerEntry = { cb: cb as ActionCallback, priority, order: this.order++ };
    this.listeners.push(entry);
    this.listeners.sort((a, b) => b.priority - a.priority || b.order - a.order);
    this.startPolling();
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  addStateListener(cb: (state: GamepadButtonState) => void): () => void {
    this.stateListeners.add(cb);
    cb({ ...this.currentState });
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  setEmulationMode(active: boolean, overlayOpen = false) {
    this.isEmulationActive = active;
    this.isOverlayOpen = overlayOpen;
    this.resetHeld();
  }

  setOverlayOpen(open: boolean) {
    this.isOverlayOpen = open;
  }

  setOverlayCombo(combo: OverlayButtonCombo) {
    this.overlayCombo = combo;
  }

  /** Suspend all UI input (external emulator in the foreground, window hidden). */
  setSuspended(suspended: boolean) {
    this.suspended = suspended;
    this.resetHeld();
  }

  isSuspended() {
    return this.suspended;
  }

  /** Programmatically dispatch (used by on-screen HUD buttons and tests). */
  dispatch(action: NavigationAction) {
    this.dispatchAction(action, { source: this.lastSource, repeat: false });
  }

  startPolling() {
    if (this.running || this.destroyed || typeof window === 'undefined') return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.poll();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopPolling() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** Release every held input and stop polling for good (app shutdown). */
  destroy() {
    this.destroyed = true;
    this.stopPolling();
    this.resetHeld();
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('blur', this.blurHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
    this.listeners = [];
    this.stateListeners.clear();
  }

  // ------------------------------------------------------------ internals
  private resetHeld() {
    this.held.clear();
    this.stickLatched = { up: false, down: false, left: false, right: false };
    this.wasComboPressed = false;
    const { connected, id } = this.currentState;
    this.currentState = { ...emptyState(), connected, id };
  }

  private dispatchAction(action: NavigationAction, meta: ActionMeta) {
    if (this.suspended && action !== 'TOGGLE_OVERLAY') return;
    if (this.isEmulationActive && !this.isOverlayOpen && action !== 'TOGGLE_OVERLAY') return;

    if (!meta.repeat || ['UP', 'DOWN', 'LEFT', 'RIGHT', 'PREV_PLATFORM', 'NEXT_PLATFORM'].includes(action)) {
      if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'PREV_PLATFORM', 'NEXT_PLATFORM'].includes(action)) soundService.playTick();
      else if (action === 'SELECT' || action === 'TOGGLE_OVERLAY' || action === 'MENU') soundService.playSelect();
      else if (action === 'BACK') soundService.playBack();
    }

    for (const l of [...this.listeners]) {
      try {
        if (l.cb(action, meta) === true) break;
      } catch (e) {
        console.error('gamepad listener failed', e);
      }
    }
  }

  private notifyState() {
    const snapshot = { ...this.currentState };
    this.stateListeners.forEach((cb) => cb(snapshot));
  }

  private isComboActive(p: (i: number) => boolean): boolean {
    switch (this.overlayCombo) {
      case 'l3_r3':
        return p(BTN.L3) && p(BTN.R3);
      case 'select_x':
        return p(BTN.SELECT) && p(BTN.X);
      case 'l1_r1_start':
        return p(BTN.LB) && p(BTN.RB) && p(BTN.START);
      case 'select_start':
      default:
        return p(BTN.SELECT) && p(BTN.START);
    }
  }

  /** Edge detection + repeat for a logical key. */
  private handleHeld(key: string, pressed: boolean, action: NavigationAction, repeats: boolean, now: number) {
    const h = this.held.get(key);
    if (pressed && !h) {
      this.held.set(key, { since: now, next: now + REPEAT_DELAY_MS });
      this.dispatchAction(action, { source: 'gamepad', repeat: false });
    } else if (pressed && h && repeats && now >= h.next) {
      // Accelerate after 1.2 s of holding for fast list travel
      h.next = now + (now - h.since > 1200 ? REPEAT_RATE_MS / 2 : REPEAT_RATE_MS);
      this.dispatchAction(action, { source: 'gamepad', repeat: true });
    } else if (!pressed && h) {
      this.held.delete(key);
    }
  }

  private poll() {
    if (!navigator.getGamepads) return;
    const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => Boolean(p && p.connected));
    if (pads.length === 0) return;

    const pressed = (i: number) =>
      pads.some((gp) => {
        const b = gp.buttons[i];
        return Boolean(b && (b.pressed || b.value > 0.5));
      });
    const axis = (i: number) => {
      let best = 0;
      for (const gp of pads) {
        const v = gp.axes[i] || 0;
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
      return best;
    };

    const s = this.currentState;
    const prevSig = `${s.a}${s.b}${s.x}${s.y}${s.lb}${s.rb}${s.lt}${s.rt}${s.select}${s.start}${s.dpadUp}${s.dpadDown}${s.dpadLeft}${s.dpadRight}${s.l3}${s.r3}`;
    s.connected = true;
    s.id = pads[0].id;
    s.a = pressed(BTN.A);
    s.b = pressed(BTN.B);
    s.x = pressed(BTN.X);
    s.y = pressed(BTN.Y);
    s.lb = pressed(BTN.LB);
    s.rb = pressed(BTN.RB);
    s.lt = pressed(BTN.LT);
    s.rt = pressed(BTN.RT);
    s.select = pressed(BTN.SELECT);
    s.start = pressed(BTN.START);
    s.l3 = pressed(BTN.L3);
    s.r3 = pressed(BTN.R3);
    s.dpadUp = pressed(BTN.UP);
    s.dpadDown = pressed(BTN.DOWN);
    s.dpadLeft = pressed(BTN.LEFT);
    s.dpadRight = pressed(BTN.RIGHT);
    s.axes = [axis(0), axis(1), axis(2), axis(3)];
    const sig = `${s.a}${s.b}${s.x}${s.y}${s.lb}${s.rb}${s.lt}${s.rt}${s.select}${s.start}${s.dpadUp}${s.dpadDown}${s.dpadLeft}${s.dpadRight}${s.l3}${s.r3}`;
    const anyActivity = sig.includes('true') || s.axes.some((v) => Math.abs(v) > STICK_RELEASE);
    if (anyActivity) this.lastSource = 'gamepad';

    // Web emulator: stream state; only the overlay combo is a UI action.
    if (this.isEmulationActive && !this.isOverlayOpen) {
      const combo = this.isComboActive(pressed) || pressed(BTN.GUIDE);
      if (combo && !this.wasComboPressed) this.dispatchAction('TOGGLE_OVERLAY', { source: 'gamepad', repeat: false });
      this.wasComboPressed = combo;
      this.notifyState();
      return;
    }
    if (sig !== prevSig) this.notifyState();
    if (this.suspended || document.hidden) return;

    const now = performance.now();
    for (const [idx, action, repeats] of BUTTON_ACTIONS) {
      this.handleHeld(`b${idx}`, pressed(idx), action, repeats, now);
    }

    // Left stick -> directions with hysteresis
    const lx = axis(0);
    const ly = axis(1);
    const latch = (dir: keyof typeof this.stickLatched, v: number) => {
      const on = this.stickLatched[dir] ? v > STICK_RELEASE : v > STICK_PRESS;
      this.stickLatched[dir] = on;
      return on;
    };
    // Suppress the weaker axis so diagonals do not jump twice
    const horizontalDominant = Math.abs(lx) > Math.abs(ly);
    this.handleHeld('ls-up', latch('up', -ly) && !horizontalDominant, 'UP', true, now);
    this.handleHeld('ls-down', latch('down', ly) && !horizontalDominant, 'DOWN', true, now);
    this.handleHeld('ls-left', latch('left', -lx) && horizontalDominant, 'LEFT', true, now);
    this.handleHeld('ls-right', latch('right', lx) && horizontalDominant, 'RIGHT', true, now);

    // Right stick Y -> analog scroll (rate proportional to deflection)
    const ry = axis(3);
    const mag = Math.abs(ry);
    if (mag > SCROLL_DEADZONE && now >= this.scrollNext) {
      const norm = (mag - SCROLL_DEADZONE) / (1 - SCROLL_DEADZONE);
      this.scrollNext = now + 16;
      this.dispatchAction(ry < 0 ? 'SCROLL_UP' : 'SCROLL_DOWN', { source: 'gamepad', repeat: true, magnitude: norm });
    }
  }

  private handleKeyboard(e: KeyboardEvent) {
    if (this.destroyed) return;
    const editing = isEditable(document.activeElement);
    let action: NavigationAction | null = null;

    if (editing) {
      // Let the physical / Steam on-screen keyboard type; only map exits.
      if (e.key === 'Escape') action = 'BACK';
      else if (e.key === 'Enter') action = 'SELECT';
      else if (e.key === 'ArrowUp') action = 'UP';
      else if (e.key === 'ArrowDown') action = 'DOWN';
      else return;
    } else {
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': action = 'UP'; break;
        case 'ArrowDown': case 's': case 'S': action = 'DOWN'; break;
        case 'ArrowLeft': case 'a': case 'A': action = 'LEFT'; break;
        case 'ArrowRight': case 'd': case 'D': action = 'RIGHT'; break;
        case 'Enter': case ' ': action = 'SELECT'; break;
        case 'Escape': case 'Backspace': action = 'BACK'; break;
        case 'x': case 'X': action = 'ACTION_X'; break;
        case 'y': case 'Y': action = 'ACTION_Y'; break;
        case 'q': case 'Q': action = 'PREV_PLATFORM'; break;
        case 'e': case 'E': action = 'NEXT_PLATFORM'; break;
        case 'PageUp': action = 'PAGE_UP'; break;
        case 'PageDown': action = 'PAGE_DOWN'; break;
        case 'm': case 'M': case 'F1': action = 'MENU'; break;
        case 'Tab': case 'f': case 'F': action = 'FILTER'; break;
        case 'v': case 'V': action = 'VIEW_MODE_TOGGLE'; break;
        case 'F2': action = 'QUICK_ACCESS'; break;
        default: return;
      }
    }
    if (this.isEmulationActive && !this.isOverlayOpen) return; // keys belong to the game iframe
    e.preventDefault();
    this.lastSource = 'keyboard';
    this.dispatchAction(action, { source: 'keyboard', repeat: e.repeat });
  }
}

export const gamepadService = new GamepadService();
