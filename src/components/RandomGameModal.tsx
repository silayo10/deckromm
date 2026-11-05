import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dices, Play, RefreshCw, Star, X, Gamepad2, Sparkles, Clock, CheckCircle2 } from 'lucide-react';
import { Game } from '../types';
import { FocusScope } from './FocusScope';
import { PlatformBadge } from './PlatformBadge';
import { ButtonGlyph } from './ControllerHUD';
import { formatBytes } from './GameCard';
import { soundService } from '../services/soundService';

interface RandomGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  games: Game[];
  onLaunch: (game: Game) => void;
  onOpenDetails: (game: Game) => void;
  currentScopeName?: string;
}

export const RandomGameModal: React.FC<RandomGameModalProps> = ({
  isOpen,
  onClose,
  games,
  onLaunch,
  onOpenDetails,
  currentScopeName = 'All Games',
}) => {
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinIndex, setSpinIndex] = useState(0);
  const [rollCount, setRollCount] = useState(0);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rollRandom = useCallback(() => {
    if (!games || games.length === 0) return;
    setIsSpinning(true);
    soundService.playTick();

    let step = 0;
    const totalSteps = Math.min(18, Math.max(10, Math.floor(games.length / 2)));
    let currentSpeed = 40;

    const tick = () => {
      step++;
      const randIdx = Math.floor(Math.random() * games.length);
      setSelectedGame(games[randIdx]);
      setSpinIndex(randIdx);
      soundService.playTick();

      if (step < totalSteps) {
        currentSpeed = Math.floor(currentSpeed * 1.12);
        spinTimerRef.current = setTimeout(tick, currentSpeed);
      } else {
        setIsSpinning(false);
        setRollCount((c) => c + 1);
        soundService.playSuccess();
      }
    };

    tick();
  }, [games]);

  useEffect(() => {
    if (isOpen) {
      rollRandom();
    }
    return () => {
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const game = selectedGame || (games.length > 0 ? games[0] : null);

  return (
    <div className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none deck-enter">
      <FocusScope
        name="random-game-modal"
        initialFocus="#random-play-btn"
        onBack={onClose}
        onAction={(a) => {
          if (a === 'ACTION_X' && !isSpinning) {
            rollRandom();
            return true;
          }
          if (a === 'ACTION_Y' && game) {
            onOpenDetails(game);
            onClose();
            return true;
          }
          return false;
        }}
      >
        <div className="relative w-full max-w-xl bg-deck-panel border-2 border-deck-line rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header banner */}
          <div className="px-6 py-4 border-b border-deck-line/80 flex items-center justify-between bg-gradient-to-r from-amber-500/10 via-deck-bg/60 to-deck-panel-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
                <Dices size={22} className={isSpinning ? 'animate-spin' : ''} />
              </div>
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <span>Surprise Me!</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Random Pick #{rollCount || 1}
                  </span>
                </h2>
                <p className="text-xs text-deck-dim">
                  Rolling from {games.length} games in <strong className="text-white">{currentScopeName}</strong>
                </p>
              </div>
            </div>

            <button
              data-focusable
              onClick={onClose}
              className="h-9 w-9 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
              aria-label="Close (B)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Game Showcase Card */}
          {game ? (
            <div className="p-6 flex flex-col gap-5">
              <div className="flex gap-5 items-start">
                {/* 3D Box Art Container */}
                <div className="w-[140px] aspect-[3/4] rounded-xl overflow-hidden bg-deck-panel-2 border-2 border-deck-line shrink-0 relative shadow-2xl flex items-center justify-center">
                  {game.coverUrl ? (
                    <img
                      src={game.coverUrl}
                      alt={game.title}
                      className={`w-full h-full object-cover transition-all duration-150 ${
                        isSpinning ? 'blur-[2px] scale-105' : 'scale-100'
                      }`}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-deck-dim/60 p-3 text-center gap-1.5">
                      <Gamepad2 size={36} />
                      <span className="text-[10px] font-mono leading-tight">{game.title}</span>
                    </div>
                  )}

                  {(game.isInstalled || game.isCached) && (
                    <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/80 flex items-center justify-center shadow" title="Offline ready">
                      <CheckCircle2 size={14} className="text-deck-ok" />
                    </span>
                  )}
                </div>

                {/* Metadata Column */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <PlatformBadge platformSlug={game.platformSlug} platformName={game.platformName} size="sm" />
                    {Boolean(game.releaseYear && game.releaseYear > 0) && (
                      <span className="text-xs text-white/90 font-mono font-bold bg-deck-panel-2 px-2 py-0.5 rounded border border-deck-line">
                        {game.releaseYear}
                      </span>
                    )}
                    {game.isFavorite && (
                      <span className="h-6 px-1.5 rounded bg-black/60 flex items-center gap-1 text-xs text-yellow-400 font-bold border border-yellow-500/30">
                        <Star size={12} className="fill-yellow-400" /> Favorite
                      </span>
                    )}
                  </div>

                  <h3 className={`text-xl sm:text-2xl font-black text-white leading-tight line-clamp-2 ${isSpinning ? 'opacity-70' : ''}`}>
                    {game.title}
                  </h3>

                  {game.genres && game.genres.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {game.genres.slice(0, 3).map((g) => (
                        <span key={g} className="text-[11px] font-semibold text-deck-accent bg-deck-accent/15 px-2 py-0.5 rounded border border-deck-accent/30">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-deck-dim line-clamp-3 leading-relaxed pt-1">
                    {game.summary || 'Jump right in and discover this retro classic!'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  id="random-play-btn"
                  data-focusable
                  disabled={isSpinning}
                  onClick={() => {
                    soundService.playSelect();
                    onLaunch(game);
                    onClose();
                  }}
                  className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 border border-emerald-400/40 shadow-xl ring-1 ring-emerald-400/30 transition-transform active:scale-95 disabled:opacity-50"
                >
                  <Play size={18} className="fill-white" />
                  <span>Play Game</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono font-bold">A</span>
                </button>

                <button
                  id="random-reroll-btn"
                  data-focusable
                  disabled={isSpinning}
                  onClick={rollRandom}
                  className="h-12 px-4 rounded-xl bg-deck-panel-2 hover:bg-white/10 text-white font-bold text-xs sm:text-sm flex items-center gap-2 border border-deck-line transition-all active:scale-95 disabled:opacity-50"
                  title="Roll another random game (X button shortcut)"
                >
                  <RefreshCw size={16} className={isSpinning ? 'animate-spin' : ''} />
                  <span>Reroll</span>
                  <span className="px-1.5 py-0.5 rounded bg-deck-bg text-[10px] font-mono font-bold text-deck-dim">X</span>
                </button>

                <button
                  id="random-details-btn"
                  data-focusable
                  disabled={isSpinning}
                  onClick={() => {
                    soundService.playSelect();
                    onOpenDetails(game);
                    onClose();
                  }}
                  className="h-12 px-4 rounded-xl bg-deck-panel-2 hover:bg-white/10 text-deck-dim hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 border border-deck-line transition-all active:scale-95"
                  title="View full details (Y button shortcut)"
                >
                  <span>Details</span>
                  <span className="px-1.5 py-0.5 rounded bg-deck-bg text-[10px] font-mono font-bold text-deck-dim">Y</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-deck-dim space-y-2">
              <p>No games available to roll in current selection.</p>
            </div>
          )}

          {/* Footer Controls */}
          <div className="px-6 py-3 border-t border-deck-line/80 bg-deck-bg/60 flex items-center justify-between text-xs text-deck-dim">
            <span className="flex items-center gap-1.5 font-bold">
              <ButtonGlyph button="A" /> Play Game
            </span>
            <span className="flex items-center gap-1.5 font-bold">
              <ButtonGlyph button="X" /> Reroll
            </span>
            <span className="flex items-center gap-1.5 font-bold">
              <ButtonGlyph button="Y" /> Details
            </span>
            <span className="flex items-center gap-1.5 font-bold">
              <ButtonGlyph button="B" /> Back
            </span>
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
