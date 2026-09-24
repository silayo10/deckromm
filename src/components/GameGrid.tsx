import React, { useEffect, useRef, useState } from 'react';
import { Game, LibraryViewMode } from '../types';
import { GameCard } from './GameCard';

interface GameGridProps {
  games: Game[];
  viewMode: LibraryViewMode;
  loading: boolean;
  progressById: Record<string, number>;
  onOpen: (game: Game) => void;
  emptyMessage?: React.ReactNode;
}

const COLUMNS: Record<LibraryViewMode, number> = { grid: 6, hero: 4, table: 1 };
const BATCH = 96;

/**
 * Cover grid sized for 1280x800: 6 columns (~190px covers) in grid view,
 * 4 large columns in hero view, single-column rows in table view.
 * Rendering grows in batches as focus (or touch scrolling) approaches the end,
 * so a 5,000-ROM library opens instantly.
 */
export const GameGrid: React.FC<GameGridProps> = ({ games, viewMode, loading, progressById, onOpen, emptyMessage }) => {
  const cols = COLUMNS[viewMode];
  const [limit, setLimit] = useState(BATCH);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Reset window when the list identity changes (new platform / filter).
  useEffect(() => {
    setLimit(BATCH);
    scroller.current?.scrollTo({ top: 0 });
  }, [games]);

  // Grow when focus nears the rendered end.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const el = (e as CustomEvent<HTMLElement>).detail;
      const idx = Number(el?.getAttribute?.('data-index'));
      if (Number.isFinite(idx) && idx >= limit - cols * 3) setLimit((l) => Math.min(games.length, l + BATCH));
    };
    window.addEventListener('deckfocus', onFocus);
    return () => window.removeEventListener('deckfocus', onFocus);
  }, [limit, cols, games.length]);

  // Grow on touch / wheel scrolling too.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((en) => en.isIntersecting) && setLimit((l) => Math.min(games.length, l + BATCH)),
      { root: scroller.current, rootMargin: '600px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [games.length]);

  const visible = games.slice(0, limit);

  return (
    <div ref={scroller} data-scroll-primary data-focus-memory="grid" className="deck-scroll flex-1 min-h-0 px-6 pt-5 pb-8">
      {games.length === 0 && !loading ? (
        <div className="h-full flex items-center justify-center text-deck-dim text-lg text-center px-10">{emptyMessage || 'No games found'}</div>
      ) : (
        <div
          className={viewMode === 'table' ? 'flex flex-col gap-1.5' : 'grid gap-4'}
          style={viewMode === 'table' ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {visible.map((g, i) => (
            <GameCard key={`${g.platformSlug}-${g.id}`} game={g} index={i} viewMode={viewMode} progress={progressById[String(g.id)]} onOpen={onOpen} />
          ))}
          {loading &&
            Array.from({ length: games.length === 0 ? cols * 2 : cols }).map((_, i) => (
              <div key={`sk-${i}`} className={`deck-skeleton rounded-xl ${viewMode === 'table' ? 'h-16' : 'aspect-[3/4]'}`} />
            ))}
        </div>
      )}
      <div ref={sentinel} className="h-1" />
    </div>
  );
};
