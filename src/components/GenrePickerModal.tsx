import React, { useMemo, useRef, useState } from 'react';
import { X, Search, Filter, Check } from 'lucide-react';
import { soundService } from '../services/soundService';
import { useFocusScope } from '../hooks/useFocusScope';

interface GenreOption {
  name: string;
  count: number;
}

interface GenrePickerModalProps {
  selectedGenre: string;
  availableGenres: GenreOption[];
  totalGamesCount: number;
  platformName: string;
  onSelect: (genre: string) => void;
  onClose: () => void;
}

/** Icon mapper for standard gaming genres */
export function getGenreIcon(genreName: string): string {
  const g = genreName.toLowerCase();
  if (g.includes('rpg') || g.includes('role-playing')) return '⚔️';
  if (g.includes('platform')) return '🏃';
  if (g.includes('action-adventure')) return '🗺️';
  if (g.includes('metroidvania')) return '🏰';
  if (g.includes('action')) return '💥';
  if (g.includes('fighting') || g.includes('beat \'em')) return '🥊';
  if (g.includes('shoot') || g.includes('fps')) return '🎯';
  if (g.includes('race') || g.includes('kart')) return '🏎️';
  if (g.includes('stealth')) return '🥷';
  if (g.includes('puzzle')) return '🧩';
  if (g.includes('strategy') || g.includes('tact')) return '♟️';
  if (g.includes('sports')) return '⚽';
  if (g.includes('sim') || g.includes('social')) return '🏡';
  if (g.includes('horror')) return '👻';
  if (g.includes('sci-fi') || g.includes('cyber')) return '🚀';
  if (g.includes('fantasy')) return '✨';
  if (g.includes('monster')) return '🐾';
  return '🎮';
}

export const GenrePickerModal: React.FC<GenrePickerModalProps> = ({
  selectedGenre,
  availableGenres,
  totalGamesCount,
  platformName,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const filteredGenres = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableGenres;
    return availableGenres.filter((g) => g.name.toLowerCase().includes(q));
  }, [availableGenres, query]);

  useFocusScope(modalRef, {
    name: 'GenrePickerModal',
    onBack: onClose,
    initialFocus: '#genre-picker-all',
  });

  const handlePick = (name: string) => {
    soundService.playSelect();
    onSelect(name);
    onClose();
  };

  const isAllActive = !selectedGenre || selectedGenre === 'all' || selectedGenre.toLowerCase() === 'all genres';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filter library by genre"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-md deck-enter"
    >
      <div
        ref={modalRef}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-deck-panel border border-deck-line shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-deck-line bg-deck-panel-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-deck-accent/20 border border-deck-accent/40 flex items-center justify-center text-deck-accent text-xl">
              <Filter size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white">Filter by Genre</h2>
              <p className="text-xs text-deck-dim">
                Browsing {platformName} · Select a genre to narrow your library
              </p>
            </div>
          </div>
          <button
            data-focusable
            onClick={onClose}
            className="h-10 w-10 rounded-xl bg-deck-panel border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search filter if many genres */}
        {availableGenres.length > 8 && (
          <div className="shrink-0 px-6 pt-3 pb-1">
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-deck-dim" />
              <input
                data-focusable
                type="text"
                placeholder="Search genres (e.g. RPG, Platformer)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="deck-input w-full h-10 pl-10 pr-4 rounded-xl bg-deck-bg border border-deck-line text-sm text-deck-text placeholder:text-deck-dim/60 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-deck-dim hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Genre Grid */}
        <div data-scroll-primary className="deck-scroll flex-1 p-6 overflow-y-auto min-h-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* All Genres option */}
            <button
              id="genre-picker-all"
              data-focusable
              onClick={() => handlePick('all')}
              className={`deck-row flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                isAllActive
                  ? 'bg-deck-accent/25 border-deck-accent text-white shadow-sm'
                  : 'bg-deck-bg/70 border-deck-line text-deck-text hover:border-deck-dim/50'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xl">🌟</span>
                <div className="truncate">
                  <div className="font-bold text-sm">All Genres</div>
                  <div className="text-xs text-deck-dim">View all games</div>
                </div>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-deck-panel border border-deck-line text-deck-dim tabular-nums">
                {totalGamesCount}
              </span>
            </button>

            {/* List of genres */}
            {filteredGenres.map((g) => {
              const isActive = selectedGenre.toLowerCase() === g.name.toLowerCase();
              const icon = getGenreIcon(g.name);
              const isHighlight = g.name.toLowerCase() === 'rpg';

              return (
                <button
                  key={g.name}
                  data-focusable
                  onClick={() => handlePick(g.name)}
                  className={`deck-row flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                    isActive
                      ? 'bg-deck-accent/25 border-deck-accent text-white shadow-sm ring-1 ring-deck-accent'
                      : isHighlight
                      ? 'bg-purple-950/20 border-purple-800/40 text-white hover:border-purple-600/60'
                      : 'bg-deck-bg/70 border-deck-line text-deck-text hover:border-deck-dim/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl shrink-0">{icon}</span>
                    <div className="truncate">
                      <div className="font-bold text-sm truncate flex items-center gap-1.5">
                        {g.name}
                        {isHighlight && (
                          <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-purple-500/30 text-purple-300 border border-purple-400/30">
                            HOT
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-deck-dim">
                        {g.count === 1 ? '1 title' : `${g.count} titles`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {isActive ? (
                      <Check size={16} className="text-deck-accent" />
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-deck-panel border border-deck-line text-deck-dim tabular-nums">
                        {g.count}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {filteredGenres.length === 0 && (
            <div className="py-12 text-center text-deck-dim">
              <p className="text-base font-bold">No genres match &ldquo;{query}&rdquo;</p>
              <p className="text-xs mt-1">Try another search term</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-t border-deck-line bg-deck-panel-2 text-xs text-deck-dim">
          <div className="flex items-center gap-2">
            <span className="font-bold text-deck-text">Tip:</span> You can switch platforms while keeping your genre filter active.
          </div>
          <button
            data-focusable
            onClick={() => handlePick('all')}
            className="text-deck-accent hover:underline font-semibold"
          >
            Reset to All Genres
          </button>
        </div>
      </div>
    </div>
  );
};
