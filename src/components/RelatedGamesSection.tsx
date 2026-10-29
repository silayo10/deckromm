import React, { useMemo } from 'react';
import { Game } from '../types';
import { findSeriesGames, findSimilarGames } from '../utils/gameRecommendations';
import { PlatformBadge } from './PlatformBadge';
import { Layers, Sparkles, CheckCircle2, ChevronRight, Gamepad2 } from 'lucide-react';
import { soundService } from '../services/soundService';

interface RelatedGamesSectionProps {
  currentGame: Game;
  allGames: Game[];
  onSelectGame: (game: Game) => void;
}

export const RelatedGamesSection: React.FC<RelatedGamesSectionProps> = ({
  currentGame,
  allGames,
  onSelectGame,
}) => {
  // 1. Other games in the same series from the library
  const seriesResult = useMemo(() => {
    return findSeriesGames(currentGame, allGames);
  }, [currentGame, allGames]);

  // Set of IDs already in series so we don't duplicate them in "Similar Games"
  const seriesIds = useMemo(() => {
    const s = new Set<string | number>();
    seriesResult.games.forEach((g) => s.add(g.id));
    return s;
  }, [seriesResult.games]);

  // 2. Similar games based on genre, developer, publisher, and era
  const similarGames = useMemo(() => {
    return findSimilarGames(currentGame, allGames, seriesIds);
  }, [currentGame, allGames, seriesIds]);

  const hasSeries = seriesResult.games.length > 0;
  const hasSimilar = similarGames.length > 0;

  if (!hasSeries && !hasSimilar) {
    return null;
  }

  const handleCardClick = (game: Game) => {
    soundService.playSelect();
    onSelectGame(game);
  };

  return (
    <div className="flex flex-col gap-6 mt-2">
      {/* 1. Other Games in the Series */}
      {hasSeries && (
        <section
          data-focusable
          tabIndex={-1}
          className="p-5 rounded-2xl bg-gradient-to-r from-sky-950/40 via-deck-panel-2/60 to-deck-panel-2/40 border border-sky-500/30 shadow-lg"
        >
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-400/30">
                <Layers size={16} />
              </div>
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-sky-300 flex items-center gap-2">
                  Other Games in the Series
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-200 border border-sky-400/40 normal-case">
                    {seriesResult.seriesName} ({seriesResult.games.length} in library)
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  More titles from the {seriesResult.seriesName} franchise available in your collection
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-sky-400/70 hidden sm:inline">
              Press (A) to view
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {seriesResult.games.map((g) => {
              const installed = Boolean(g.isInstalled || g.isCached);
              return (
                <button
                  key={String(g.id)}
                  data-focusable
                  id={`series-game-${g.id}`}
                  onClick={() => handleCardClick(g)}
                  className="group relative flex flex-col p-2.5 rounded-xl bg-deck-bg/80 hover:bg-deck-panel border border-deck-line hover:border-sky-400/80 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/60 focus:bg-deck-panel text-left transition-all duration-150 active:scale-95"
                >
                  {/* Thumbnail Cover */}
                  <div className="relative aspect-[3/4] w-full rounded-lg overflow-hidden bg-black/50 border border-white/5 mb-2 shrink-0">
                    {g.coverUrl ? (
                      <img
                        src={g.coverUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 group-focus:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-deck-dim">
                        <Gamepad2 size={24} />
                      </div>
                    )}

                    {/* Installed badge */}
                    {installed && (
                      <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-emerald-950/90 border border-emerald-500/50 text-[10px] font-bold text-emerald-300 flex items-center gap-1 shadow">
                        <CheckCircle2 size={10} />
                        <span>Ready</span>
                      </div>
                    )}
                  </div>

                  {/* Title and metadata */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-xs font-bold text-white group-hover:text-sky-300 group-focus:text-sky-300 line-clamp-2 leading-tight">
                      {g.title}
                    </span>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <PlatformBadge slug={g.platformSlug} size="sm" />
                      {g.releaseYear ? (
                        <span className="text-[10px] font-mono text-slate-400">
                          {g.releaseYear}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. Similar Games We Have */}
      {hasSimilar && (
        <section
          data-focusable
          tabIndex={-1}
          className="p-5 rounded-2xl bg-deck-panel-2/50 border border-deck-line shadow-lg"
        >
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-400/30">
                <Sparkles size={16} />
              </div>
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-white flex items-center gap-2">
                  Similar Games in Your Library
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40 normal-case">
                    {similarGames.length} recommended
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Games you own with matching gameplay, developers, or themes
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-deck-dim hidden sm:inline">
              Press (A) to view
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {similarGames.map(({ game: g, reasons }) => {
              const installed = Boolean(g.isInstalled || g.isCached);
              return (
                <button
                  key={String(g.id)}
                  data-focusable
                  id={`similar-game-${g.id}`}
                  onClick={() => handleCardClick(g)}
                  className="group relative flex flex-col p-2.5 rounded-xl bg-deck-bg/80 hover:bg-deck-panel border border-deck-line hover:border-amber-400/80 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/60 focus:bg-deck-panel text-left transition-all duration-150 active:scale-95"
                >
                  {/* Thumbnail Cover */}
                  <div className="relative aspect-[3/4] w-full rounded-lg overflow-hidden bg-black/50 border border-white/5 mb-2 shrink-0">
                    {g.coverUrl ? (
                      <img
                        src={g.coverUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 group-focus:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-deck-dim">
                        <Gamepad2 size={24} />
                      </div>
                    )}

                    {/* Installed badge */}
                    {installed && (
                      <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-emerald-950/90 border border-emerald-500/50 text-[10px] font-bold text-emerald-300 flex items-center gap-1 shadow">
                        <CheckCircle2 size={10} />
                        <span>Ready</span>
                      </div>
                    )}
                  </div>

                  {/* Title and metadata */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-xs font-bold text-white group-hover:text-amber-300 group-focus:text-amber-300 line-clamp-2 leading-tight">
                      {g.title}
                    </span>

                    {/* Reason chip */}
                    {reasons[0] && (
                      <span className="mt-1 text-[10px] font-semibold text-amber-300/90 truncate">
                        {reasons[0]}
                      </span>
                    )}

                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <PlatformBadge slug={g.platformSlug} size="sm" />
                      {g.rating ? (
                        <span className="text-[10px] font-mono font-bold text-emerald-400">
                          {Math.round(g.rating)}%
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
