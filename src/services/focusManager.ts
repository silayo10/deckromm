/**
 * Spatial focus engine - makes every control reachable with a D-pad / stick.
 *
 * Model
 *   - A stack of *focus scopes* (screen, modal, overlay). Only the top scope is
 *     navigable, which gives modals a hard focus trap for free.
 *   - Focusable = `[data-focusable]`, buttons, links, inputs, selects,
 *     textareas and `[tabindex]` elements inside the top scope that are
 *     visible and not disabled / `[data-focus-skip]`.
 *   - D-pad moves geometrically to the nearest candidate in that direction
 *     (overlap-weighted distance). `data-nav-up|down|left|right="<css>"`
 *     overrides a direction explicitly.
 *   - Containers marked `data-focus-memory` remember their last focused child,
 *     so jumping from the grid to the platform bar and back lands where you left.
 *   - The focused element gets `data-focused="true"` (styled in index.css) and
 *     is scrolled into view in every scrollable ancestor via
 *     `scrollIntoView({block: 'nearest'})` + CSS `scroll-margin`. Rapid repeats
 *     use instant scrolling so the viewport never lags behind the highlight.
 *   - Right stick scrolls the nearest scrollable ancestor (long text, metadata),
 *     LT/RT jump roughly one viewport.
 *   - A on a text input asks the host (App) to open the on-screen keyboard.
 *
 * Styling reads the DOM attribute, so moving focus causes ZERO React
 * re-renders - important for 1000+ cover grids on the Deck APU.
 */
import { NavigationAction } from '../types';
import { ActionMeta, gamepadService } from './gamepadService';

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface ScopeOptions {
  /** Called on B when no text input is being edited. Return nothing to consume. */
  onBack?: () => void;
  /** Receives every non-directional action first. Return true to consume. */
  onAction?: (action: NavigationAction, meta: ActionMeta) => boolean | void;
  /** Called when D-pad hits the edge of the scope with no candidate. */
  onEdge?: (dir: Direction) => void;
  /** CSS selector of the element to focus when the scope opens. */
  initialFocus?: string;
  /** Restore focus to the element that was focused before this scope opened (default true). */
  restoreFocus?: boolean;
  /** false = only move the visual ring, never steal DOM focus (keeps a hidden text input typing-ready). */
  nativeFocus?: boolean;
  /** Base scope (the main screen) always stays at the bottom of the stack, even if it registers last. */
  base?: boolean;
  name?: string;
}

interface Scope extends ScopeOptions {
  id: number;
  el: HTMLElement;
  previous: HTMLElement | null;
  lastFocused: HTMLElement | null;
}

const FOCUSABLE_SELECTOR = [
  '[data-focusable]',
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"],[inert]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return ['text', 'password', 'search', 'url', 'email', 'number', 'tel', ''].includes((el as HTMLInputElement).type);
}

function isScrollable(el: HTMLElement, axis: 'y' | 'x' = 'y'): boolean {
  const style = getComputedStyle(el);
  const overflow = axis === 'y' ? style.overflowY : style.overflowX;
  if (!/(auto|scroll)/.test(overflow)) return false;
  return axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
}

export function scrollableAncestor(el: HTMLElement | null, axis: 'y' | 'x' = 'y'): HTMLElement | null {
  let node = el?.parentElement || null;
  while (node && node !== document.body) {
    if (isScrollable(node, axis)) return node;
    node = node.parentElement;
  }
  return null;
}

class FocusManager {
  private scopes: Scope[] = [];
  private seq = 0;
  private current: HTMLElement | null = null;
  private enabled = true;
  private lastMoveAt = 0;
  private initialized = false;
  /** Host hook: open the on-screen keyboard for a text input. */
  onEditRequest: ((input: HTMLInputElement | HTMLTextAreaElement) => void) | null = null;

  init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    gamepadService.addListener((action, meta) => this.handle(action, meta), -100);

    // Suppress native OS virtual keyboard (Steam OSK) across all inputs so that
    // SteamOS Game Mode / gamescope does not summon the Steam overlay keyboard.
    const suppressNativeOSK = () => {
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((el) => {
        if (isTextInput(el)) {
          if (el.getAttribute('inputmode') !== 'none') {
            el.setAttribute('inputmode', 'none');
          }
          (el as any).virtualKeyboardPolicy = 'manual';
        }
      });
    };
    suppressNativeOSK();

    // Touch / mouse keep the focus ring in sync so switching input methods is seamless.
    window.addEventListener(
      'pointerdown',
      (e) => {
        const target = (e.target as HTMLElement)?.closest?.(FOCUSABLE_SELECTOR) as HTMLElement | null;
        const scope = this.top();
        if (target && scope && scope.el.contains(target)) {
          this.focus(target, { scroll: false });
          if (isTextInput(target)) {
            // Prevent browser default editable focus which summons the Steam OSK;
            // route into our built-in virtual keyboard instead.
            suppressNativeOSK();
            e.preventDefault();
            this.activate(target);
          }
        }
      },
      true
    );

    // Prevent any rogue native focus on editable text inputs from triggering the Steam OSK
    window.addEventListener(
      'focusin',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (isTextInput(target)) {
          if (target.getAttribute('inputmode') !== 'none') {
            target.setAttribute('inputmode', 'none');
          }
          (target as any).virtualKeyboardPolicy = 'manual';
          if (!target.hasAttribute('data-virtual-keyboard-input')) {
            target.blur();
            if (this.onEditRequest) {
              this.onEditRequest(target);
            }
          }
        }
      },
      true
    );

    // DOM changes (list reloads, conditional sections) can remove the focused element.
    const mo = new MutationObserver(() => {
      suppressNativeOSK();
      if (this.current && !this.current.isConnected) {
        this.current = null;
        requestAnimationFrame(() => this.ensureFocus());
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  getCurrent(): HTMLElement | null {
    return this.current;
  }

  private top(): Scope | undefined {
    return this.scopes[this.scopes.length - 1];
  }

  // ------------------------------------------------------------ scopes
  pushScope(el: HTMLElement, opts: ScopeOptions = {}): () => void {
    const scope: Scope = { ...opts, id: ++this.seq, el, previous: this.current, lastFocused: null };
    if (opts.base) {
      // React runs child effects before parent effects, so a modal child may
      // register before the screen that hosts it - keep the base underneath.
      this.scopes.unshift(scope);
      if (this.scopes.length > 1) return () => this.popScope(scope.id);
    } else {
      const prevTop = this.top();
      if (prevTop) prevTop.lastFocused = this.current;
      this.scopes.push(scope);
    }
    // Wait a frame so conditional children have rendered.
    requestAnimationFrame(() => {
      if (this.top() !== scope) return;
      const initial = (opts.initialFocus && (el.querySelector(opts.initialFocus) as HTMLElement | null)) || null;
      this.focus(initial && isVisible(initial) ? initial : this.candidates(scope)[0] || null, { scroll: true, instant: true });
    });
    return () => this.popScope(scope.id);
  }

  updateScope(el: HTMLElement, opts: ScopeOptions) {
    const scope = this.scopes.find((s) => s.el === el);
    if (scope) Object.assign(scope, opts);
  }

  private popScope(id: number) {
    const idx = this.scopes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const [scope] = this.scopes.splice(idx, 1);
    if (idx !== this.scopes.length) return; // not the top one - nothing to restore
    const next = this.top();
    const restore = scope.restoreFocus !== false ? scope.previous : null;
    requestAnimationFrame(() => {
      if (!next) return;
      let target: HTMLElement | null = null;
      if (restore && restore.isConnected && next.el.contains(restore)) {
        target = restore;
      } else if (restore) {
        const gameId = restore.getAttribute?.('data-game-id');
        if (gameId) {
          target = next.el.querySelector<HTMLElement>(`[data-game-id="${gameId}"]`);
        } else if (restore.id) {
          target = next.el.querySelector<HTMLElement>(`#${restore.id}`);
        }
      }
      if (!target && next.lastFocused && next.lastFocused.isConnected && next.el.contains(next.lastFocused)) {
        target = next.lastFocused;
      }
      if (!target) {
        target = this.candidates(next)[0] || null;
      }
      this.focus(target, { scroll: true, instant: true });
    });
  }

  // ------------------------------------------------------------ candidates
  candidates(scope = this.top()): HTMLElement[] {
    if (!scope) return [];
    const nodes = Array.from(scope.el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    return nodes.filter((n) => {
      if ((n as HTMLButtonElement).disabled || n.hasAttribute('data-focus-skip')) return false;
      if (n.closest('[data-focus-skip-children]') && !n.hasAttribute('data-focusable')) return false;
      // Belongs to a nested scope that is not the top? (scopes are stacked, nested = newer)
      return isVisible(n);
    });
  }

  ensureFocus() {
    const scope = this.top();
    if (!scope) return;
    if (this.current && this.current.isConnected && scope.el.contains(this.current)) return;
    const remembered = scope.lastFocused && scope.lastFocused.isConnected ? scope.lastFocused : null;
    this.focus(remembered || this.candidates(scope)[0] || null, { scroll: true, instant: true });
  }

  // ------------------------------------------------------------ focus
  focus(el: HTMLElement | null, { scroll = true, instant = false }: { scroll?: boolean; instant?: boolean } = {}) {
    if (this.current && this.current !== el) this.current.removeAttribute('data-focused');
    this.current = el;
    if (!el) return;
    el.setAttribute('data-focused', 'true');
    const scope = this.top();
    if (scope) scope.lastFocused = el;
    const memory = el.closest<HTMLElement>('[data-focus-memory]');
    if (memory) (memory as any).__deckLastFocused = el;

    // Native focus for accessibility & :focus-visible, but never put text inputs
    // into edit mode just by navigating over them.
    if (scope?.nativeFocus === false) {
      // leave DOM focus where the scope put it (e.g. the on-screen keyboard's input)
    } else if (!isTextInput(el)) {
      el.focus({ preventScroll: true });
    } else if (document.activeElement && document.activeElement !== document.body && isTextInput(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    if (scroll) this.scrollIntoView(el, instant);
    window.dispatchEvent(new CustomEvent('deckfocus', { detail: el }));
  }

  /** Bring the element into view inside every scrollable ancestor. */
  scrollIntoView(el: HTMLElement, instant = false) {
    const block = (el.getAttribute('data-scroll-block') as ScrollLogicalPosition) || 'nearest';
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block, inline: 'nearest', behavior: instant || reduce ? 'auto' : 'smooth' });
  }

  focusSelector(selector: string) {
    const scope = this.top();
    const el = scope?.el.querySelector<HTMLElement>(selector);
    if (el) this.focus(el);
    return Boolean(el);
  }

  // ------------------------------------------------------------ navigation
  move(dir: Direction, fast = false): boolean {
    const scope = this.top();
    if (!scope) return false;
    const cur = this.current && scope.el.contains(this.current) ? this.current : null;
    if (!cur) {
      this.ensureFocus();
      return true;
    }

    const explicit = cur.getAttribute(`data-nav-${dir.toLowerCase()}`);
    if (explicit) {
      if (explicit === 'none') return false;
      const target = scope.el.querySelector<HTMLElement>(explicit);
      if (target && isVisible(target)) {
        this.focus(target, { instant: fast });
        return true;
      }
    }

    const from = cur.getBoundingClientRect();
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const cand of this.candidates(scope)) {
      if (cand === cur || cand.contains(cur) || cur.contains(cand)) continue;
      const r = cand.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let primary: number;
      let secondary: number;
      let overlap: number;
      switch (dir) {
        case 'UP':
          if (r.bottom > from.top + 2 && cy >= fy) continue;
          primary = Math.max(0, from.top - r.bottom);
          secondary = Math.abs(cx - fx);
          overlap = Math.min(r.right, from.right) - Math.max(r.left, from.left);
          break;
        case 'DOWN':
          if (r.top < from.bottom - 2 && cy <= fy) continue;
          primary = Math.max(0, r.top - from.bottom);
          secondary = Math.abs(cx - fx);
          overlap = Math.min(r.right, from.right) - Math.max(r.left, from.left);
          break;
        case 'LEFT':
          if (r.right > from.left + 2 && cx >= fx) continue;
          primary = Math.max(0, from.left - r.right);
          secondary = Math.abs(cy - fy);
          overlap = Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top);
          break;
        case 'RIGHT':
        default:
          if (r.left < from.right - 2 && cx <= fx) continue;
          primary = Math.max(0, r.left - from.right);
          secondary = Math.abs(cy - fy);
          overlap = Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top);
          break;
      }
      // Strongly prefer candidates in the same row/column (overlap > 0).
      const score = primary + secondary * (overlap > 0 ? 0.3 : 2.5) + (overlap > 0 ? 0 : 400);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    if (!best) {
      scope.onEdge?.(dir);
      return false;
    }

    // Entering a remembered container from outside -> restore its last child.
    const memory = best.closest<HTMLElement>('[data-focus-memory]');
    if (memory && !memory.contains(cur)) {
      const remembered: HTMLElement | undefined = (memory as any).__deckLastFocused;
      if (remembered && remembered.isConnected && isVisible(remembered) && scope.el.contains(remembered)) best = remembered;
    }
    this.focus(best, { instant: fast });
    return true;
  }

  /** LT/RT: jump about one viewport in the focused element's scroll container. */
  page(dir: 'UP' | 'DOWN') {
    const cur = this.current;
    if (!cur) return;
    const container = scrollableAncestor(cur) || document.scrollingElement;
    const height = (container as HTMLElement)?.clientHeight || window.innerHeight;
    const from = cur.getBoundingClientRect();
    const targetY = from.top + from.height / 2 + (dir === 'DOWN' ? 1 : -1) * height * 0.85;
    const fx = from.left + from.width / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const cand of this.candidates()) {
      if (container && container instanceof HTMLElement && !container.contains(cand)) continue;
      const r = cand.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      if (dir === 'DOWN' ? cy <= from.bottom : cy >= from.top) continue;
      const score = Math.abs(cy - targetY) + Math.abs(r.left + r.width / 2 - fx) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best) this.focus(best, { instant: true });
  }

  /** Right stick: analog scroll of the nearest scrollable region. */
  scrollBy(dir: 'UP' | 'DOWN', magnitude = 1) {
    const scope = this.top();
    const start = this.current && scope?.el.contains(this.current) ? this.current : scope?.el.querySelector<HTMLElement>('[data-scroll-primary]') || null;
    const target =
      (start && (start.hasAttribute('data-scroll-primary') && isScrollable(start) ? start : scrollableAncestor(start))) ||
      scope?.el.querySelector<HTMLElement>('[data-scroll-primary]') ||
      null;
    if (!target) return;
    const speed = 6 + magnitude * magnitude * 34; // px per frame
    target.scrollBy({ top: dir === 'DOWN' ? speed : -speed, behavior: 'auto' });
  }

  private activate(el: HTMLElement) {
    if (isTextInput(el)) {
      if (this.onEditRequest) this.onEditRequest(el);
      else el.focus();
      return;
    }
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      el.click();
      return;
    }
    el.click();
  }

  // ------------------------------------------------------------ action routing
  private handle(action: NavigationAction, meta: ActionMeta): boolean {
    if (!this.enabled) return false;
    const scope = this.top();
    if (!scope) return false;

    const active = document.activeElement;
    const editing = isTextInput(active);

    // While a physical/Steam keyboard is typing into an input, B leaves the field.
    if (editing && action === 'BACK' && scope.nativeFocus !== false) {
      (active as HTMLElement).blur();
      if (this.current) this.current.setAttribute('data-focused', 'true');
      return true;
    }

    if (scope.onAction && !['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(action)) {
      if (scope.onAction(action, meta) === true) return true;
    }

    const fast = meta.repeat && performance.now() - this.lastMoveAt < 140;
    switch (action) {
      case 'UP':
      case 'DOWN':
      case 'LEFT':
      case 'RIGHT':
        this.lastMoveAt = performance.now();
        this.move(action, fast);
        return true;
      case 'SELECT':
        if (this.current && scope.el.contains(this.current)) this.activate(this.current);
        else this.ensureFocus();
        return true;
      case 'BACK':
        if (scope.onBack) {
          scope.onBack();
          return true;
        }
        return false;
      case 'SCROLL_UP':
      case 'SCROLL_DOWN':
        this.scrollBy(action === 'SCROLL_UP' ? 'UP' : 'DOWN', meta.magnitude ?? 0.6);
        return true;
      case 'PAGE_UP':
      case 'PAGE_DOWN':
        this.page(action === 'PAGE_UP' ? 'UP' : 'DOWN');
        return true;
      default:
        return false;
    }
  }
}

export const focusManager = new FocusManager();
