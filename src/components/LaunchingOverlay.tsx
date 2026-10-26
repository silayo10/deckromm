import React from 'react';
import { Gamepad2, Loader2, Play, Sparkles, X } from 'lucide-react';
import { Game } from '../types';

interface LaunchingOverlayProps {
  game: Game;
  emulatorName?: string;
  onCancel?: () => void;
}

export const LaunchingOverlay: React.FC<LaunchingOverlayProps> = ({
  game,
  emulatorName,
  onCancel,
}) => {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`Starting ${game.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/85 backdrop-blur-md deck-enter"
    >
      {/* Subtle blurred cover background glow */}
      {game.coverUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-15 blur-2xl pointer-events-none scale-110"
          style={{ backgroundImage: `url(${game.coverUrl})` }}
        />
      )}

      <div className="relative w-full max-w-lg p-6 sm:p-8 rounded-2xl bg-gradient-to-b from-[#141b2d]/95 to-[#0b0f19]/98 border border-sky-400/40 shadow-2xl flex flex-col items-center text-center gap-5">
        {/* Cover Art with Animated Pulse Glow */}
        <div className="relative">
          <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-sky-500/40 via-indigo-500/40 to-blue-500/40 blur-xl animate-pulse" />
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt={game.title}
              className="relative w-28 h-36 sm:w-32 sm:h-44 object-cover rounded-xl shadow-2xl border border-white/20"
            />
          ) : (
            <div className="relative w-28 h-36 sm:w-32 sm:h-44 rounded-xl bg-deck-panel-2 border border-white/20 flex items-center justify-center text-deck-dim">
              <Gamepad2 size={40} className="text-sky-400" />
            </div>
          )}

          <div className="absolute -bottom-2 -right-2 p-2 rounded-full bg-blue-600 border-2 border-white text-white shadow-lg animate-bounce">
            <Play size={16} className="fill-white" />
          </div>
        </div>

        {/* Title and Platform Info */}
        <div className="flex flex-col items-center gap-1.5 max-w-full">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-400/30">
            {game.platformName || game.platformSlug.toUpperCase()}
          </span>

          <h2 className="text-xl sm:text-2xl font-black text-white leading-tight truncate max-w-full px-2" title={game.title}>
            {game.title}
          </h2>

          <div className="flex items-center gap-2 mt-1 text-sm font-semibold text-sky-200/90 font-mono">
            <Loader2 size={16} className="animate-spin text-sky-400 shrink-0" />
            <span>Starting {emulatorName || 'emulator'}...</span>
          </div>
        </div>

        {/* Animated Progress Bar */}
        <div className="w-full flex flex-col gap-2">
          <div className="h-2 rounded-full bg-slate-800/80 overflow-hidden border border-white/10 relative">
            <div className="h-full bg-gradient-to-r from-sky-400 via-indigo-500 to-blue-500 animate-[pulse_1.2s_ease-in-out_infinite] w-full" />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono px-1">
            <span className="flex items-center gap-1">
              <Sparkles size={12} className="text-sky-400" />
              <span>Initializing Gamescope surface</span>
            </span>
            <span>Please wait...</span>
          </div>
        </div>

        {onCancel && (
          <button
            data-focusable
            onClick={onCancel}
            className="mt-1 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <X size={14} />
            <span>Cancel</span>
          </button>
        )}
      </div>
    </div>
  );
};
