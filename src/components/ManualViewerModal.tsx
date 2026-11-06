import React, { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  FileText,
  Gamepad2,
  Key,
  Shield,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Game } from '../types';
import { FocusScope } from './FocusScope';
import { ButtonGlyph } from './ControllerHUD';
import { PlatformBadge } from './PlatformBadge';
import { soundService } from '../services/soundService';

interface ManualViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: Game;
  onToast?: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
}

interface ManualPage {
  title: string;
  category: 'controls' | 'story' | 'items' | 'cheats' | 'map';
  icon: React.ReactNode;
  content: React.ReactNode;
}

export const ManualViewerModal: React.FC<ManualViewerModalProps> = ({
  isOpen,
  onClose,
  game,
  onToast,
}) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoomLevel, setZoomLevel] = useState<1 | 1.25 | 1.5>(1);

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(0);
      setZoomLevel(1);
    }
  }, [isOpen, game.id]);

  // Curated multi-page manual & strategy guide content
  const pages: ManualPage[] = useMemo(() => {
    const list: ManualPage[] = [];

    // Page 1: Controller Layout & Controls
    list.push({
      title: 'Controls & Controller Mapping',
      category: 'controls',
      icon: <Gamepad2 size={16} className="text-deck-accent" />,
      content: (
        <div className="space-y-4">
          <p className="text-xs text-deck-dim leading-relaxed">
            Standard retro mapping for <strong className="text-white">{game.platformName || game.platformSlug.toUpperCase()}</strong> on the Steam Deck gamepad:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line flex items-center justify-between">
              <span className="text-xs text-deck-dim flex items-center gap-1.5">
                <ButtonGlyph button="A" /> Steam Deck
              </span>
              <span className="font-mono text-xs font-bold text-white">Action 1 / Jump / Confirm</span>
            </div>
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line flex items-center justify-between">
              <span className="text-xs text-deck-dim flex items-center gap-1.5">
                <ButtonGlyph button="B" /> Steam Deck
              </span>
              <span className="font-mono text-xs font-bold text-white">Action 2 / Run / Cancel</span>
            </div>
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line flex items-center justify-between">
              <span className="text-xs text-deck-dim flex items-center gap-1.5">
                <ButtonGlyph button="X" /> Steam Deck
              </span>
              <span className="font-mono text-xs font-bold text-white">Special Attack / Weapon</span>
            </div>
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line flex items-center justify-between">
              <span className="text-xs text-deck-dim flex items-center gap-1.5">
                <ButtonGlyph button="Y" /> Steam Deck
              </span>
              <span className="font-mono text-xs font-bold text-white">Sub-Weapon / Map / Item</span>
            </div>
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line flex items-center justify-between">
              <span className="text-xs text-deck-dim">L1 / R1 Bumpers</span>
              <span className="font-mono text-xs font-bold text-white">Shoulder Triggers / Cycle</span>
            </div>
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line flex items-center justify-between">
              <span className="text-xs text-deck-dim">Start / Select</span>
              <span className="font-mono text-xs font-bold text-white">Pause / Menu / Status</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-deck-accent/10 border border-deck-accent/30 text-xs text-deck-dim flex items-start gap-2">
            <Sparkles size={16} className="text-deck-accent shrink-0 mt-0.5" />
            <span>
              Tip: Press <strong className="text-white">Steam Button</strong> in-game to customize controller deadzones, back grip buttons (L4/R4), or enable gyro aiming.
            </span>
          </div>
        </div>
      ),
    });

    // Page 2: Story, Lore & Briefing
    list.push({
      title: 'Story & Mission Briefing',
      category: 'story',
      icon: <FileText size={16} className="text-sky-400" />,
      content: (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-black/30 border border-deck-line leading-relaxed text-xs sm:text-sm text-deck-text/95 whitespace-pre-line">
            {game.summary || 'Prepare yourself for an epic adventure. Consult your instincts and master every challenge.'}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line/60">
              <span className="text-[10px] text-deck-dim uppercase font-bold">Release</span>
              <div className="text-sm font-bold text-white mt-0.5 font-mono">
                {game.releaseYear || 'Classic Era'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-black/40 border border-deck-line/60">
              <span className="text-[10px] text-deck-dim uppercase font-bold">Developer</span>
              <div className="text-sm font-bold text-white mt-0.5 truncate">
                {game.developer || game.publisher || 'Unknown'}
              </div>
            </div>
          </div>
        </div>
      ),
    });

    // Page 3: Items & Strategy Notes
    list.push({
      title: 'Items & Gameplay Strategy',
      category: 'items',
      icon: <Shield size={16} className="text-emerald-400" />,
      content: (
        <div className="space-y-3.5 text-xs">
          <div className="p-3.5 rounded-xl bg-black/40 border border-deck-line/80 space-y-2">
            <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400" />
              <span>General Survival Rules</span>
            </h4>
            <ul className="space-y-1.5 text-deck-dim list-disc list-inside">
              <li>Conserve extra lives and continue credits for the later stages.</li>
              <li>Explore alternate pathways and break suspect walls or blocks for hidden power-ups.</li>
              <li>Learn enemy attack patterns; most retro bosses operate on precise rhythmic cycles.</li>
              <li>Use the Steam Deck quick-save vault (`Slot 1–5`) before taking high-risk jumps or boss doors.</li>
            </ul>
          </div>
          {game.genres && game.genres.length > 0 && (
            <div className="p-3.5 rounded-xl bg-deck-panel-2 border border-deck-line">
              <span className="text-[10px] font-bold uppercase tracking-wider text-deck-dim">Genres & Mechanics</span>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {game.genres.map((g) => (
                  <span key={g} className="px-2 py-0.5 rounded bg-deck-accent/15 border border-deck-accent/30 text-deck-accent text-xs font-semibold">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    });

    // Page 4: Secrets, Codes & Cheats
    list.push({
      title: 'Secret Codes & Passwords',
      category: 'cheats',
      icon: <Key size={16} className="text-amber-400" />,
      content: (
        <div className="space-y-3.5 text-xs">
          <div className="p-3.5 rounded-xl bg-black/40 border border-deck-line space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-amber-300">Stage Select & Passwords</span>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                PRO-TIP
              </span>
            </div>
            <p className="text-deck-dim leading-relaxed">
              Retro titles frequently feature stage-select combos on the title screen (e.g. holding Select + Start or directional codes).
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-deck-panel-2 border border-deck-line space-y-1.5">
            <div className="font-bold text-white">RomM Companion Vault</div>
            <p className="text-deck-dim">
              You can also store personal walkthrough notes or stage passwords in DeckRomM. They will sync with your RomM server automatically.
            </p>
          </div>
        </div>
      ),
    });

    return list;
  }, [game]);

  if (!isOpen) return null;

  const activePage = pages[currentPage] || pages[0];

  const handlePrev = () => {
    if (currentPage > 0) {
      soundService.playTick();
      setCurrentPage((p) => p - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < pages.length - 1) {
      soundService.playTick();
      setCurrentPage((p) => p + 1);
    }
  };

  const handleToggleZoom = () => {
    soundService.playTick();
    setZoomLevel((z) => (z === 1 ? 1.25 : z === 1.25 ? 1.5 : 1));
  };

  return (
    <div className="fixed inset-0 z-[240] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none deck-enter">
      <FocusScope
        name="manual-viewer-modal"
        initialFocus="#manual-page-next"
        onBack={onClose}
        onAction={(a) => {
          if (a === 'PREV_PLATFORM' || a === 'PAGE_UP') {
            handlePrev();
            return true;
          }
          if (a === 'NEXT_PLATFORM' || a === 'PAGE_DOWN') {
            handleNext();
            return true;
          }
          if (a === 'ACTION_X') {
            handleToggleZoom();
            return true;
          }
          return false;
        }}
      >
        <div className="relative w-full max-w-2xl bg-deck-panel border-2 border-deck-line rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-deck-line/80 flex items-center justify-between bg-deck-bg/80">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-black text-white truncate flex items-center gap-2">
                  <span>Game Manual & Guide</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-deck-panel-2 border border-deck-line text-deck-dim font-bold">
                    Page {currentPage + 1} of {pages.length}
                  </span>
                </h3>
                <div className="text-xs text-deck-dim truncate">
                  {game.title} • {game.platformName || game.platformSlug.toUpperCase()}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                data-focusable
                id="manual-zoom-btn"
                onClick={handleToggleZoom}
                className="h-8 px-2.5 rounded-lg bg-deck-panel-2 border border-deck-line text-xs font-mono font-bold text-deck-dim hover:text-white flex items-center gap-1"
                title="Toggle Zoom (X)"
              >
                <ZoomIn size={14} />
                <span>{Math.round(zoomLevel * 100)}%</span>
              </button>
              <button
                data-focusable
                onClick={onClose}
                className="h-8 w-8 rounded-lg bg-deck-panel-2 border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
                aria-label="Close (B)"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Page Tabs Bar */}
          <div className="px-5 py-2 bg-black/40 border-b border-deck-line/60 flex items-center gap-2 overflow-x-auto no-scrollbar">
            {pages.map((p, idx) => (
              <button
                key={p.title}
                data-focusable
                onClick={() => {
                  soundService.playTick();
                  setCurrentPage(idx);
                }}
                className={`h-7 px-2.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 border ${
                  currentPage === idx
                    ? 'bg-deck-accent/20 border-deck-accent text-white shadow-sm'
                    : 'bg-deck-panel/50 border-deck-line/50 text-deck-dim hover:text-deck-text'
                }`}
              >
                {p.icon}
                <span>{p.title.split('&')[0].trim()}</span>
              </button>
            ))}
          </div>

          {/* Page Content Body */}
          <div className="flex-1 overflow-y-auto deck-scroll p-6 min-h-[340px]">
            <div
              className="transition-transform duration-150 origin-top"
              style={{ transform: `scale(${zoomLevel})` }}
            >
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-deck-line/60">
                {activePage.icon}
                <h4 className="text-sm font-extrabold uppercase tracking-wider text-white">
                  {activePage.title}
                </h4>
              </div>
              {activePage.content}
            </div>
          </div>

          {/* Footer Controls */}
          <div className="px-5 py-3 border-t border-deck-line/80 bg-deck-bg/70 flex items-center justify-between text-xs text-deck-dim">
            <div className="flex items-center gap-2">
              <button
                data-focusable
                id="manual-page-prev"
                disabled={currentPage === 0}
                onClick={handlePrev}
                className="h-8 px-3 rounded-lg bg-deck-panel-2 border border-deck-line text-white font-bold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft size={16} />
                <span>Prev (L1)</span>
              </button>
              <button
                data-focusable
                id="manual-page-next"
                disabled={currentPage === pages.length - 1}
                onClick={handleNext}
                className="h-8 px-3 rounded-lg bg-deck-panel-2 border border-deck-line text-white font-bold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <span>Next (R1)</span>
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 font-bold">
                <ButtonGlyph button="X" /> Zoom
              </span>
              <span className="flex items-center gap-1 font-bold">
                <ButtonGlyph button="B" /> Close
              </span>
            </div>
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
