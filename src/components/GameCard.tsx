import React, { memo, useState } from 'react';
import { CheckCircle2, Star, Gamepad2, Disc } from 'lucide-react';
import { Game, LibraryViewMode } from '../types';
import { PLATFORM_COLORS } from './PlatformBadge';

interface GameCardProps {
  game: Game;
  index: number;
  viewMode: LibraryViewMode;
  /** 0-100 while downloading */
  progress?: number;
  onOpen: (game: Game) => void;
}

export const formatBytes = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const Cover: React.FC<{ game: Game; className?: string }> = ({ game, className }) => {
  const [failed, setFailed] = useState(false);
  const accent = PLATFORM_COLORS[game.platformSlug]?.accent || '#1a9fff';
  if (!game.coverUrl || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 p-3 text-center relative overflow-hidden select-none ${className}`}
        style={{ background: `linear-gradient(160deg, ${accent}44 0%, #121826 75%)` }}
      >
        <Gamepad2 size={32} className="text-white/70" />
        <span className="text-xs font-bold text-white/90 line-clamp-3 leading-snug">{game.title}</span>
        <span className="text-[10px] font-mono text-deck-accent uppercase tracking-wider">{game.platformName || game.platformSlug}</span>
        {(game.isInstalled || game.isCached) && (
          <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded">
            Local
          </span>
        )}
      </div>
    );
  }
  return (
    <img
      src={game.coverUrl}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={`object-cover bg-deck-panel-2 ${className}`}
    />
  );
};

const Badges: React.FC<{ game: Game }> = ({ game }) => (
  <div className="absolute top-2 right-2 flex gap-1">
    {game.isFavorite && (
      <span className="h-7 w-7 rounded-full bg-black/75 flex items-center justify-center shadow">
        <Star size={15} className="text-yellow-400 fill-yellow-400" />
      </span>
    )}
    {game.isMultiFile && (
      <span className="h-7 w-7 rounded-full bg-black/75 flex items-center justify-center shadow" title="Multi-file / Multi-disc">
        <Disc size={15} className="text-deck-accent" />
      </span>
    )}
    {(game.isInstalled || game.isCached) && (
      <span className="h-7 w-7 rounded-full bg-black/75 flex items-center justify-center shadow" title="Installed on this Deck (Offline Ready)">
        <CheckCircle2 size={16} className="text-deck-ok" />
      </span>
    )}
  </div>
);

const ProgressBar: React.FC<{ value?: number }> = ({ value }) =>
  value == null ? null : (
    <div className="absolute left-0 right-0 bottom-0 h-1.5 bg-black/60">
      <div className="h-full bg-deck-accent transition-[width] duration-200" style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );

/**
 * A single library tile. Focus styling comes from `[data-focused]` in CSS, so a
 * D-pad move re-renders nothing. `content-visibility` lets Chromium skip
 * layout/paint for off-screen tiles (cheap virtualisation for big libraries).
 */
export const GameCard: React.FC<GameCardProps> = memo(({ game, index, viewMode, progress, onOpen }) => {
  const common = {
    'data-focusable': true,
    'data-game-id': String(game.id),
    'data-index': index,
    onClick: () => onOpen(game),
  } as const;

  if (viewMode === 'table') {
    return (
      <button
        {...common}
        className="deck-row relative w-full flex items-center gap-4 h-16 px-3 rounded-xl bg-deck-panel/70 text-left"
        style={{ contentVisibility: 'auto', containIntrinsicSize: '64px' } as React.CSSProperties}
      >
        <Cover game={game} className="h-12 w-9 rounded-md shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate">{game.title}</div>
          <div className="text-xs text-deck-dim truncate">
            {game.platformName}
            {game.genres?.length ? ` \u00b7 ${game.genres.slice(0, 2).join(', ')}` : ''}
          </div>
        </div>
        <span className="w-16 text-sm text-deck-dim tabular-nums">{game.releaseYear || ''}</span>
        <span className="w-20 text-sm text-deck-dim tabular-nums text-right">{formatBytes(game.fileSizeBytes)}</span>
        <span className="w-8 flex justify-center">
          {game.isFavorite && <Star size={16} className="text-yellow-400 fill-yellow-400" />}
        </span>
        <span className="w-8 flex justify-center">
          {(game.isInstalled || game.isCached) && <CheckCircle2 size={18} className="text-deck-ok" />}
        </span>
        <ProgressBar value={progress} />
      </button>
    );
  }

  const hero = viewMode === 'hero';
  return (
    <button
      {...common}
      className="deck-card group relative flex flex-col rounded-xl overflow-hidden bg-deck-panel text-left transition-transform"
      style={{ contentVisibility: 'auto', containIntrinsicSize: hero ? '300px 460px' : '190px 300px' } as React.CSSProperties}
    >
      <div className="relative w-full aspect-[3/4]">
        <Cover game={game} className="absolute inset-0 w-full h-full" />
        <Badges game={game} />
        <ProgressBar value={progress} />
      </div>
      <div className="deck-card-title px-2.5 py-2 transition-colors">
        <div className={`font-bold truncate ${hero ? 'text-base' : 'text-sm'}`}>{game.title}</div>
        <div className="text-xs text-deck-dim truncate">
          {game.platformName}
          {game.releaseYear ? ` \u00b7 ${game.releaseYear}` : ''}
          {game.genres && game.genres.length > 0 ? ` \u00b7 ${game.genres[0]}` : ''}
        </div>
      </div>
    </button>
  );
});
GameCard.displayName = 'GameCard';
