import React, { useEffect, useState } from 'react';
import { Play, Download, Trash2, Star, Globe, X, CheckCircle2, Loader2, Square } from 'lucide-react';
import { Game } from '../types';
import { FocusScope } from './FocusScope';
import { PlatformBadge } from './PlatformBadge';
import { formatBytes } from './GameCard';
import { rommApi } from '../services/rommApi';
import { NavigationAction } from '../types';

interface GameDetailModalProps {
  game: Game;
  isNative: boolean;
  progress?: number;
  emulatorRunning: boolean;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onDownload: (game: Game) => void;
  onCancelDownload: (game: Game) => void;
  onDelete: (game: Game) => void;
  onPlayInBrowser: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onGameUpdated: (game: Game) => void;
}

/**
 * Full-screen game page. Action buttons sit at the top (A on "Play" launches
 * immediately); metadata sections below are focusable blocks so D-pad down
 * walks through them and the container auto-scrolls. Right stick scrolls freely.
 */
export const GameDetailModal: React.FC<GameDetailModalProps> = ({
  game: initial,
  isNative,
  progress,
  emulatorRunning,
  onClose,
  onLaunch,
  onDownload,
  onCancelDownload,
  onDelete,
  onPlayInBrowser,
  onToggleFavorite,
  onGameUpdated,
}) => {
  const [game, setGame] = useState<Game>(initial);
  const [loadingDetails, setLoadingDetails] = useState(true);

  useEffect(() => setGame((g) => ({ ...g, ...initial })), [initial]);

  useEffect(() => {
    let alive = true;
    setLoadingDetails(true);
    rommApi.getGameDetails(initial).then((full) => {
      if (!alive) return;
      setGame((g) => ({ ...g, ...full, isFavorite: g.isFavorite }));
      onGameUpdated(full);
      setLoadingDetails(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  const installed = Boolean(game.isInstalled);
  const downloading = progress != null;
  const streamable = game.playableOnline !== false;

  const onAction = (a: NavigationAction) => {
    if (a === 'ACTION_Y') {
      onToggleFavorite(game);
      return true;
    }
    if (a === 'ACTION_X') {
      if (downloading) onCancelDownload(game);
      else if (isNative) onDownload(game);
      return true;
    }
    // Swallow library-level shortcuts while the page is open.
    return a === 'PREV_PLATFORM' || a === 'NEXT_PLATFORM' || a === 'FILTER' || a === 'VIEW_MODE_TOGGLE';
  };

  const btn = 'h-12 px-5 rounded-xl flex items-center gap-2 font-bold text-base border';
  const section = 'rounded-xl p-4 bg-deck-panel/80 border border-deck-line';

  return (
    <div className="fixed inset-0 z-[100] bg-deck-bg deck-enter">
      {game.coverUrl && (
        <img src={game.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15 blur-2xl scale-110 pointer-events-none" />
      )}
      <FocusScope name="game-detail" onBack={onClose} onAction={onAction} initialFocus="#detail-primary" className="relative h-full flex gap-8 px-10 pt-8 pb-14">
        <div className="w-[300px] shrink-0 flex flex-col gap-4">
          <div className="rounded-2xl overflow-hidden shadow-2xl aspect-[3/4] bg-deck-panel-2">
            {game.coverUrl ? <img src={game.coverUrl} alt="" className="w-full h-full object-cover" /> : null}
          </div>
          <div className="flex items-center gap-2 text-sm text-deck-dim">
            <PlatformBadge platformSlug={game.platformSlug} platformName={game.platformName} size="md" />
            {installed && (
              <span className="flex items-center gap-1 text-deck-ok font-semibold">
                <CheckCircle2 size={16} /> Installed
              </span>
            )}
          </div>
        </div>

        <div data-scroll-primary className="deck-scroll flex-1 min-w-0 pr-3 pb-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-4xl font-extrabold leading-tight">{game.title}</h1>
            <button data-focusable onClick={onClose} className="h-11 w-11 shrink-0 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-center" aria-label="Close">
              <X size={22} />
            </button>
          </div>
          <div className="mt-1 text-deck-dim">
            {[game.releaseYear || null, game.developer || null, game.genres?.slice(0, 3).join(', ') || null].filter(Boolean).join('  \u00b7  ')}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {streamable && (
              <button
                id="detail-primary"
                data-focusable
                onClick={() => onPlayInBrowser(game)}
                className={`${btn} bg-deck-ok border-deck-ok text-white`}
              >
                <Globe size={20} /> Play from RomM
              </button>
            )}
            {isNative && (
              <button
                id={streamable ? 'detail-native' : 'detail-primary'}
                data-focusable
                disabled={emulatorRunning}
                onClick={() => onLaunch(game)}
                className={`${btn} ${streamable ? 'bg-deck-panel-2 border-deck-line' : 'bg-deck-ok border-deck-ok text-white'} disabled:opacity-50`}
              >
                <Play size={20} className={streamable ? '' : 'fill-white'} /> {installed ? 'Play offline (native)' : 'Download & Play (native)'}
              </button>
            )}
            {isNative &&
              (downloading ? (
                <button data-focusable onClick={() => onCancelDownload(game)} className={`${btn} bg-deck-panel-2 border-deck-line`}>
                  <Square size={18} /> Cancel {Math.round(progress!)}%
                </button>
              ) : (
                <button data-focusable onClick={() => onDownload(game)} className={`${btn} bg-deck-panel-2 border-deck-line`}>
                  <Download size={20} /> {installed ? 'Re-download' : 'Download'}
                </button>
              ))}
            <button data-focusable onClick={() => onToggleFavorite(game)} className={`${btn} bg-deck-panel-2 border-deck-line`}>
              <Star size={20} className={game.isFavorite ? 'text-yellow-400 fill-yellow-400' : ''} /> {game.isFavorite ? 'Favorited' : 'Favorite'}
            </button>
            {isNative && installed && (
              <button data-focusable onClick={() => onDelete(game)} className={`${btn} bg-deck-panel-2 border-deck-line text-deck-danger`}>
                <Trash2 size={20} /> Delete
              </button>
            )}
          </div>

          {downloading && (
            <div className="mt-4 h-2 rounded-full bg-deck-panel-2 overflow-hidden">
              <div className="h-full bg-deck-accent transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-4">
            <section data-focusable tabIndex={-1} className={section}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-deck-dim mb-2">About</h2>
              {loadingDetails && !game.summary ? (
                <div className="flex items-center gap-2 text-deck-dim">
                  <Loader2 size={16} className="animate-spin" /> Loading details
                </div>
              ) : (
                <p className="text-base leading-relaxed whitespace-pre-line">{game.summary || 'No description available.'}</p>
              )}
            </section>

            <section data-focusable tabIndex={-1} className={`${section} grid grid-cols-2 gap-x-8 gap-y-2 text-sm`}>
              <h2 className="col-span-2 text-sm font-bold uppercase tracking-wide text-deck-dim mb-1">Details</h2>
              {[
                ['File', game.fileName],
                ['Size', formatBytes(game.fileSizeBytes)],
                ['Publisher', game.publisher],
                ['Developer', game.developer],
                ['Region', game.region],
                ['Players', game.players ? String(game.players) : ''],
                ['Rating', game.rating ? String(Math.round(game.rating)) : ''],
                ['Local path', game.localPath],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex gap-3 min-w-0">
                    <span className="w-24 shrink-0 text-deck-dim">{k}</span>
                    <span className="truncate font-mono text-deck-text" title={String(v)}>{v}</span>
                  </div>
                ))}
            </section>

            {game.screenshots && game.screenshots.length > 0 && (
              <section className={section}>
                <h2 className="text-sm font-bold uppercase tracking-wide text-deck-dim mb-2">Screenshots</h2>
                <div className="grid grid-cols-3 gap-3">
                  {game.screenshots.slice(0, 9).map((s) => (
                    <div key={s} data-focusable tabIndex={-1} className="rounded-lg overflow-hidden aspect-video bg-deck-panel-2">
                      <img src={s} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
