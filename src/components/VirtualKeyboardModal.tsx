import React, { useEffect, useState } from 'react';
import { ArrowBigUp, CornerDownLeft, Delete, Eye, EyeOff, Space, X } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { soundService } from '../services/soundService';
import { NavigationAction } from '../types';
import { ActionMeta } from '../services/gamepadService';

export type KeyboardMode = 'text' | 'ip_address' | 'search' | 'password' | 'code';

interface VirtualKeyboardModalProps {
  isOpen: boolean;
  title?: string;
  initialValue?: string;
  placeholder?: string;
  mode?: KeyboardMode;
  onClose: () => void;
  onSubmit: (text: string) => void;
}

const LETTER_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '-'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '/', '_'],
];
const SYMBOL_ROWS = [
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['~', '`', '+', '=', '{', '}', '[', ']', '|', '\\'],
  [':', ';', '"', "'", '<', '>', ',', '?', '-', '_'],
  ['http://', 'https://', ':8080', ':443', '.local', '.com', '/', '.', '@', '_'],
];
const CODE_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['-', '0', '.'],
];

/**
 * Gamepad on-screen keyboard.
 *  A = press key   B = cancel   X = backspace   Y = space
 *  LB = shift      RB = symbols Start = done    L/R stick & D-pad = move
 * A hidden native <input> keeps DOM focus so a physical keyboard or the Steam
 * on-screen keyboard (STEAM + X) can type at the same time.
 */
export const VirtualKeyboardModal: React.FC<VirtualKeyboardModalProps> = ({
  isOpen,
  title = 'Enter text',
  initialValue = '',
  placeholder = '',
  mode = 'text',
  onClose,
  onSubmit,
}) => {
  const [text, setText] = useState(initialValue);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setText(initialValue || '');
      setShift(false);
      setSymbols(false);
      setReveal(false);
    }
  }, [isOpen, initialValue]);

  const type = (s: string) => {
    soundService.playTick();
    setText((t) => t + (shift && s.length === 1 ? s.toUpperCase() : s));
    if (shift) setShift(false);
  };
  const backspace = () => {
    soundService.playTick();
    setText((t) => t.slice(0, -1));
  };
  const submit = () => {
    soundService.playSuccess();
    onSubmit(mode === 'ip_address' ? text.trim() : text);
  };

  // Support typing from physical keyboards (SteamLink, USB/Bluetooth keyboard)
  // without focusing a native text input that summons Steam's native virtual keyboard.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if modifying with Alt or Meta
      if (e.metaKey || e.altKey) return;

      // Handle Ctrl+V paste
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        navigator.clipboard?.readText?.().then((clip) => {
          if (clip) {
            soundService.playTick();
            setText((t) => t + clip);
          }
        }).catch(() => {});
        return;
      }
      if (e.ctrlKey) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        backspace();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        submit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // Normal printable character
      if (e.key.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        soundService.playTick();
        setText((t) => t + e.key);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, text, mode, shift]);

  if (!isOpen) return null;

  const rows = mode === 'code' ? CODE_ROWS : symbols ? SYMBOL_ROWS : LETTER_ROWS;
  const presets =
    mode === 'ip_address' ? ['http://', 'https://', '192.168.1.', '192.168.0.', '10.0.0.', ':8080', ':3000', '.local'] : [];

  const onAction = (action: NavigationAction, meta: ActionMeta) => {
    switch (action) {
      case 'SELECT':
        // Physical Enter submits; controller A presses the focused key.
        if (meta.source === 'keyboard') {
          submit();
          return true;
        }
        return false;
      case 'ACTION_X':
        if (meta.source === 'keyboard') return false;
        backspace();
        return true;
      case 'ACTION_Y':
        if (meta.source === 'keyboard') return false;
        type(' ');
        return true;
      case 'PREV_PLATFORM':
        setShift((s) => !s);
        return true;
      case 'NEXT_PLATFORM':
        if (mode !== 'code') setSymbols((s) => !s);
        return true;
      case 'MENU':
        submit();
        return true;
      default:
        return false;
    }
  };

  const masked = mode === 'password' && !reveal;
  const keyCls =
    'deck-key flex items-center justify-center rounded-lg bg-deck-panel-2 border border-deck-line text-lg font-semibold text-deck-text h-12 transition-transform';

  return (
    <div className="fixed inset-0 z-[600] flex items-end justify-center bg-black/70 backdrop-blur-sm deck-enter">
      <FocusScope
        name="keyboard"
        onBack={onClose}
        onAction={onAction}
        nativeFocus={false}
        initialFocus="[data-key-initial]"
        className="w-full max-w-[1100px] mb-4 rounded-2xl bg-deck-panel border border-deck-line shadow-2xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-deck-text">{title}</h2>
          <div className="flex gap-4 text-sm text-deck-dim">
            <span><b className="text-deck-text">X</b> Delete</span>
            <span><b className="text-deck-text">Y</b> Space</span>
            <span><b className="text-deck-text">LB</b> Shift</span>
            {mode !== 'code' && <span><b className="text-deck-text">RB</b> Symbols</span>}
            <span><b className="text-deck-text">Start</b> Done</span>
            <span><b className="text-deck-text">B</b> Cancel</span>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <input
            data-focus-skip
            data-virtual-keyboard-input="true"
            readOnly
            tabIndex={-1}
            inputMode="none"
            // @ts-expect-error Chromium virtualKeyboardPolicy attribute
            virtualKeyboardPolicy="manual"
            value={masked ? '•'.repeat(text.length) : text}
            placeholder={placeholder}
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 h-14 rounded-xl bg-[#0a0e15] border-2 border-deck-accent px-4 text-2xl font-mono text-white placeholder:text-deck-dim/60 select-none cursor-default"
          />
          {mode === 'password' && (
            <button data-focusable onClick={() => setReveal((r) => !r)} className={`${keyCls} w-14`} aria-label={reveal ? 'Hide' : 'Show'}>
              {reveal ? <EyeOff size={22} /> : <Eye size={22} />}
            </button>
          )}
        </div>

        {presets.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {presets.map((p) => (
              <button key={p} data-focusable onClick={() => type(p)} className="deck-chip px-3 h-10 rounded-full bg-deck-panel-2 border border-deck-line text-sm font-mono text-deck-accent-2">
                {p}
              </button>
            ))}
          </div>
        )}

        <div className={`grid gap-2 ${mode === 'code' ? 'grid-cols-3 max-w-md mx-auto' : 'grid-cols-10'}`}>
          {rows.flatMap((row, r) =>
            row.map((k, c) => (
              <button
                key={`${r}-${c}-${k}`}
                data-focusable
                {...(r === (mode === 'code' ? 0 : 1) && c === 0 ? { 'data-key-initial': '' } : {})}
                onClick={() => type(k)}
                className={`${keyCls} ${k.length > 2 ? 'text-sm' : ''}`}
              >
                {shift && k.length === 1 ? k.toUpperCase() : k}
              </button>
            ))
          )}
        </div>

        <div className="grid grid-cols-12 gap-2 mt-2">
          <button data-focusable onClick={() => setShift((s) => !s)} className={`${keyCls} col-span-2 ${shift ? '!bg-deck-accent/40' : ''}`}>
            <ArrowBigUp size={22} /> <span className="ml-1 text-sm">Shift</span>
          </button>
          {mode !== 'code' ? (
            <button data-focusable onClick={() => setSymbols((s) => !s)} className={`${keyCls} col-span-2 text-sm`}>
              {symbols ? 'ABC' : '#+='}
            </button>
          ) : (
            <div className="col-span-2" />
          )}
          <button data-focusable onClick={() => type(' ')} className={`${keyCls} col-span-3`}>
            <Space size={22} />
          </button>
          <button data-focusable onClick={backspace} className={`${keyCls} col-span-2`}>
            <Delete size={22} />
          </button>
          <button data-focusable onClick={onClose} className={`${keyCls} col-span-1`} aria-label="Cancel">
            <X size={22} />
          </button>
          <button data-focusable onClick={submit} className={`${keyCls} col-span-2 !bg-deck-accent !text-white`}>
            <CornerDownLeft size={20} /> <span className="ml-1 text-sm">Done</span>
          </button>
        </div>
      </FocusScope>
    </div>
  );
};
