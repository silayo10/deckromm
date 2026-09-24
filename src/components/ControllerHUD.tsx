import React from 'react';
import { useGamepadState } from '../hooks/useGamepadAction';

export type HudButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'START' | 'SELECT' | 'R-STICK';
export interface HudHint {
  button: HudButton;
  label: string;
}

const GLYPH_STYLE: Record<HudButton, string> = {
  A: 'bg-[#3fae49] text-white rounded-full w-7',
  B: 'bg-[#e0443e] text-white rounded-full w-7',
  X: 'bg-[#1a9fff] text-white rounded-full w-7',
  Y: 'bg-[#e5a50a] text-black rounded-full w-7',
  LB: 'bg-deck-panel-2 border border-deck-line rounded-md px-2',
  RB: 'bg-deck-panel-2 border border-deck-line rounded-md px-2',
  LT: 'bg-deck-panel-2 border border-deck-line rounded-md px-2',
  RT: 'bg-deck-panel-2 border border-deck-line rounded-md px-2',
  START: 'bg-deck-panel-2 border border-deck-line rounded-md px-2',
  SELECT: 'bg-deck-panel-2 border border-deck-line rounded-md px-2',
  'R-STICK': 'bg-deck-panel-2 border border-deck-line rounded-full px-2',
};
const GLYPH_TEXT: Record<HudButton, string> = {
  A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', START: '\u2261', SELECT: '\u29C9', 'R-STICK': 'R',
};

const KEYBOARD_TEXT: Record<HudButton, string> = {
  A: 'Enter', B: 'Esc', X: 'X', Y: 'Y', LB: 'Q', RB: 'E', LT: 'PgUp', RT: 'PgDn', START: 'M', SELECT: 'Tab', 'R-STICK': 'Wheel',
};

export const ButtonGlyph: React.FC<{ button: HudButton; keyboard?: boolean }> = ({ button, keyboard }) =>
  keyboard ? (
    <span className="inline-flex items-center justify-center h-7 px-2 rounded-md bg-deck-panel-2 border border-deck-line text-xs font-bold">
      {KEYBOARD_TEXT[button]}
    </span>
  ) : (
    <span className={`inline-flex items-center justify-center h-7 text-sm font-extrabold ${GLYPH_STYLE[button]}`}>{GLYPH_TEXT[button]}</span>
  );

/** Bottom hint bar (Steam footer style). Purely informational - never focusable. */
export const ControllerHUD: React.FC<{ hints: HudHint[]; status?: React.ReactNode }> = ({ hints, status }) => {
  const pad = useGamepadState();
  const keyboard = !pad.connected;
  return (
    <footer className="h-12 shrink-0 flex items-center justify-between px-6 bg-[#0a0d14]/95 border-t border-deck-line text-sm text-deck-dim">
      <div className="truncate">{status}</div>
      <div className="flex items-center gap-5">
        {hints.map((h) => (
          <span key={h.button + h.label} className="flex items-center gap-2 text-deck-text font-semibold whitespace-nowrap">
            <ButtonGlyph button={h.button} keyboard={keyboard} />
            {h.label}
          </span>
        ))}
      </div>
    </footer>
  );
};
