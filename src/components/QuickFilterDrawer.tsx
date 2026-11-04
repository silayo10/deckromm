import React from 'react';
import { CheckCircle2, Star, Clock, Trophy, Sparkles, Filter, X, Hash, HardDrive } from 'lucide-react';
import { FilterTag } from '../types';
import { FocusScope } from './FocusScope';
import { ButtonGlyph } from './ControllerHUD';
import { soundService } from '../services/soundService';

interface QuickFilterDrawerProps {
  open: boolean;
  mode: 'filters' | 'alphabet';
  onClose: () => void;
  currentFilterTag: FilterTag;
  onSelectFilterTag: (tag: FilterTag) => void;
  offlineMode: boolean;
  onToggleOfflineMode: () => void;
  selectedGenre: string;
  availableGenres: Array<{ name: string; count?: number }> | string[];
  onSelectGenre: (genre: string) => void;
  availableLetters: string[];
  onJumpToLetter: (letter: string) => void;
  gameCount: number;
}

export const QuickFilterDrawer: React.FC<QuickFilterDrawerProps> = ({
  open,
  mode,
  onClose,
  currentFilterTag,
  onSelectFilterTag,
  offlineMode,
  onToggleOfflineMode,
  selectedGenre,
  availableGenres,
  onSelectGenre,
  availableLetters,
  onJumpToLetter,
  gameCount,
}) => {
  if (!open) return null;

  const alphabet = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

  const filterPresets: Array<{ id: FilterTag; label: string; icon: React.ReactNode; desc: string }> = [
    { id: 'all', label: 'All Games', icon: <Sparkles size={16} className="text-sky-400" />, desc: 'Entire synchronized collection' },
    { id: 'cached', label: 'Installed (Offline)', icon: <CheckCircle2 size={16} className="text-emerald-400" />, desc: 'ROMs saved locally on this Deck' },
    { id: 'favorites', label: 'Favorites', icon: <Star size={16} className="text-yellow-400 fill-yellow-400" />, desc: 'Your starred titles' },
    { id: 'streamable', label: 'Play (Streamable)', icon: <Clock size={16} className="text-amber-400" />, desc: 'Direct browser emulation playable' },
    { id: 'multiplayer', label: 'Multiplayer Games', icon: <Trophy size={16} className="text-purple-400" />, desc: '2+ players local / party games' },
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-end bg-black/75 backdrop-blur-sm deck-enter">
      {/* Backdrop click to dismiss */}
      <div className="absolute inset-0" onClick={() => { soundService.playBack(); onClose(); }} />

      <FocusScope
        name="quick-filter-drawer"
        onBack={() => { soundService.playBack(); onClose(); }}
        initialFocus={mode === 'alphabet' ? '#letter-A' : '#filter-cached'}
        className="relative z-10 w-[420px] h-full bg-[#0d121c] border-l border-deck-line shadow-2xl flex flex-col p-6"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-4 border-b border-deck-line/80">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-deck-accent/15 border border-deck-accent/30 flex items-center justify-center text-deck-accent">
              {mode === 'alphabet' ? <Hash size={18} /> : <Filter size={18} />}
            </div>
            <div>
              <div className="text-base font-extrabold text-white flex items-center gap-2">
                <span>{mode === 'alphabet' ? 'Jump to Letter' : 'Quick Filters'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-deck-panel-2 border border-deck-line text-deck-dim font-mono font-bold">
                  {mode === 'alphabet' ? 'R2' : 'L2'}
                </span>
              </div>
              <div className="text-xs text-deck-dim">
                {mode === 'alphabet' ? 'Instantly navigate across the library' : `${gameCount} games in current view`}
              </div>
            </div>
          </div>
          <button
            data-focusable
            onClick={() => { soundService.playBack(); onClose(); }}
            className="h-9 w-9 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto deck-scroll py-4 space-y-6">
          {mode === 'filters' ? (
            <>
              {/* Presets */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-deck-dim uppercase tracking-wider px-1">Library Filters</div>
                {filterPresets.map((p) => {
                  const active = currentFilterTag === p.id && !offlineMode;
                  return (
                    <button
                      key={p.id}
                      id={`filter-${p.id}`}
                      data-focusable
                      onClick={() => {
                        soundService.playSelect();
                        onSelectFilterTag(p.id);
                        onClose();
                      }}
                      className={`deck-row w-full p-3 rounded-xl flex items-center gap-3 text-left border transition-all ${
                        active
                          ? 'bg-deck-accent/20 border-deck-accent text-white shadow-sm'
                          : 'bg-deck-panel/70 border-deck-line text-deck-text hover:bg-deck-panel-2'
                      }`}
                    >
                      <div className="h-8 w-8 rounded-lg bg-black/40 border border-deck-line/60 flex items-center justify-center shrink-0">
                        {p.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm leading-tight flex items-center justify-between">
                          <span>{p.label}</span>
                          {active && <span className="text-xs text-deck-accent font-semibold">Active</span>}
                        </div>
                        <div className="text-xs text-deck-dim truncate mt-0.5">{p.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Offline Hard Toggle */}
              <div className="space-y-2 pt-2 border-t border-deck-line/60">
                <div className="text-xs font-bold text-deck-dim uppercase tracking-wider px-1">Offline Deck Mode</div>
                <button
                  data-focusable
                  onClick={() => {
                    soundService.playSelect();
                    onToggleOfflineMode();
                    onClose();
                  }}
                  className={`deck-row w-full p-3 rounded-xl flex items-center gap-3 text-left border transition-all ${
                    offlineMode
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 shadow-sm'
                      : 'bg-deck-panel/70 border-deck-line text-deck-text hover:bg-deck-panel-2'
                  }`}
                >
                  <div className="h-8 w-8 rounded-lg bg-black/40 border border-deck-line/60 flex items-center justify-center shrink-0">
                    <HardDrive size={16} className={offlineMode ? 'text-amber-400' : 'text-deck-dim'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm leading-tight flex items-center justify-between">
                      <span>Strict Offline Play</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${offlineMode ? 'bg-amber-500/30 text-amber-300' : 'bg-deck-panel-2 text-deck-dim'}`}>
                        {offlineMode ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-xs text-deck-dim truncate mt-0.5">Hide all cloud-only ROMs</div>
                  </div>
                </button>
              </div>

              {/* Quick Genres (if available) */}
              {availableGenres.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-deck-line/60">
                  <div className="text-xs font-bold text-deck-dim uppercase tracking-wider px-1 flex items-center justify-between">
                    <span>Quick Genre</span>
                    {selectedGenre !== 'all' && (
                      <span className="text-[11px] text-deck-accent cursor-pointer" onClick={() => onSelectGenre('all')}>Reset</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {availableGenres.slice(0, 8).map((rawGenre) => {
                      const genre = typeof rawGenre === 'string' ? rawGenre : rawGenre.name;
                      const active = selectedGenre === genre;
                      return (
                        <button
                          key={genre}
                          data-focusable
                          onClick={() => {
                            soundService.playSelect();
                            onSelectGenre(active ? 'all' : genre);
                            onClose();
                          }}
                          className={`h-10 px-3 rounded-xl border text-xs font-bold truncate text-left transition-all ${
                            active
                              ? 'bg-deck-accent text-white border-deck-accent'
                              : 'bg-deck-panel/70 border-deck-line text-deck-dim hover:text-white'
                          }`}
                        >
                          {genre}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Alphabet Jump Scrubber */
            <div className="space-y-3">
              <div className="text-xs font-bold text-deck-dim uppercase tracking-wider px-1">
                Select Starting Letter
              </div>
              <div className="grid grid-cols-4 gap-2">
                {alphabet.map((letter) => {
                  const hasGames = availableLetters.includes(letter);
                  return (
                    <button
                      key={letter}
                      id={`letter-${letter}`}
                      data-focusable={hasGames}
                      disabled={!hasGames}
                      onClick={() => {
                        soundService.playSelect();
                        onJumpToLetter(letter);
                        onClose();
                      }}
                      className={`h-14 rounded-xl font-mono text-base font-extrabold flex flex-col items-center justify-center border transition-all ${
                        hasGames
                          ? 'bg-deck-panel-2 border-deck-line text-white hover:bg-deck-accent hover:border-deck-accent active:scale-95'
                          : 'opacity-25 bg-deck-panel/30 border-transparent text-deck-dim cursor-not-allowed'
                      }`}
                    >
                      <span>{letter}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer controls legend */}
        <div className="pt-4 border-t border-deck-line/80 flex items-center justify-between text-xs text-deck-dim">
          <span className="flex items-center gap-1.5 font-bold">
            <ButtonGlyph button="A" /> Select
          </span>
          <span className="flex items-center gap-1.5 font-bold">
            <ButtonGlyph button="B" /> Close
          </span>
        </div>
      </FocusScope>
    </div>
  );
};
