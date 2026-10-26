import React, { useEffect, useState } from 'react';
import { Play, Download, Trash2, Star, Globe, X, CheckCircle2, Loader2, Square, Cpu, HardDrive, ChevronDown, AlertTriangle, Tag, Disc, Wand2, Sliders, CloudOff, Gamepad2 } from 'lucide-react';
import { CoreOption, Game, NavigationAction, PLATFORM_AVAILABLE_CORES, RommConfig, getActiveCoreForGame, getStandaloneEmulatorForPlatform } from '../types';
import { FocusScope } from './FocusScope';
import { PlatformBadge } from './PlatformBadge';
import { formatBytes } from './GameCard';
import { rommApi } from '../services/rommApi';
import { CoreSelectorModal } from './CoreSelectorModal';
import { RomPatcherModal } from './RomPatcherModal';
import { Pcsx2MemcardManager } from './Pcsx2MemcardManager';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';

interface GameDetailModalProps {
  game: Game;
  isNative: boolean;
  progress?: number;
  emulatorRunning: boolean;
  config: RommConfig;
  onUpdateConfig?: (patch: Partial<RommConfig>) => void;
  offlineMode?: boolean;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onDownload: (game: Game) => void;
  onCancelDownload: (game: Game) => void;
  onDelete: (game: Game) => void;
  onPlayInBrowser: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onGameUpdated: (game: Game) => void;
  onSelectGenre?: (genre: string) => void;
  onOpenBiosModal?: (platformSlug?: string) => void;
  onToast?: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
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
  config,
  onUpdateConfig,
  offlineMode,
  onClose,
  onLaunch,
  onDownload,
  onCancelDownload,
  onDelete,
  onPlayInBrowser,
  onToggleFavorite,
  onGameUpdated,
  onSelectGenre,
  onOpenBiosModal,
  onToast,
}) => {
  const [game, setGame] = useState<Game>(initial);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [coreModalOpen, setCoreModalOpen] = useState(false);
  const [patcherOpen, setPatcherOpen] = useState(false);
  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    setGame((g) => ({ ...g, ...initial }));
    setCoverError(false);
  }, [initial]);

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

  const activeCoreId = getActiveCoreForGame(game, config);
  const platformOptions: CoreOption[] = PLATFORM_AVAILABLE_CORES[game.platformSlug] || [];
  const activeCoreObj = platformOptions.find((c) => c.id === activeCoreId);
  const activeCoreName = activeCoreObj ? activeCoreObj.name : activeCoreId.toUpperCase();

  const [flatpakInstalled, setFlatpakInstalled] = useState<boolean | null>(null);
  const [flatpakInstalling, setFlatpakInstalling] = useState(false);
  const [flatpakProgress, setFlatpakProgress] = useState<number | undefined>(undefined);
  const [flatpakError, setFlatpakError] = useState<string | null>(null);

  const flatpakId = activeCoreObj?.flatpakId;

  useEffect(() => {
    if (!isNativeApp || !flatpakId) {
      setFlatpakInstalled(null);
      return;
    }
    bridge.system.flatpakStatus([flatpakId]).then((res) => {
      if (res && res.installed) {
        setFlatpakInstalled(Boolean(res.installed[flatpakId]));
      }
    }).catch(() => {});

    const offProgress = bridge.on('flatpak:progress', (ev) => {
      if (ev.flatpakId === flatpakId) {
        if (ev.status === 'installing') {
          setFlatpakInstalling(true);
          setFlatpakProgress(ev.progress);
        } else if (ev.status === 'completed') {
          setFlatpakInstalling(false);
          setFlatpakInstalled(true);
        } else if (ev.status === 'error') {
          setFlatpakInstalling(false);
          setFlatpakError(ev.message || 'Installation failed');
        }
      }
    });

    return () => {
      offProgress();
    };
  }, [flatpakId, config]);

  const handleInstallFlatpak = async () => {
    if (!flatpakId || !isNativeApp) return;
    soundService.playTick();
    setFlatpakInstalling(true);
    setFlatpakError(null);

    const res = await bridge.system.installFlatpak(flatpakId);
    if (res.ok) {
      soundService.playSuccess();
      setFlatpakInstalled(true);
      setFlatpakInstalling(false);
    } else {
      soundService.playBack();
      setFlatpakError(res.message || 'Installation failed');
      setFlatpakInstalling(false);
    }
  };

  const standaloneEmu = getStandaloneEmulatorForPlatform(game.platformSlug);
  const [standaloneLaunchMessage, setStandaloneLaunchMessage] = useState<string | null>(null);
  const [settingUpXbox, setSettingUpXbox] = useState(false);
  const [xboxSetupMessage, setXboxSetupMessage] = useState<string | null>(null);

  const handleLaunchStandaloneConfig = async () => {
    if (!standaloneEmu) return;
    soundService.playSelect();
    try {
      const res = await rommApi.launchStandaloneEmulator(standaloneEmu.flatpakId, standaloneEmu.name);
      setStandaloneLaunchMessage(res.message);
      if (res.success) {
        soundService.playSuccess();
      } else {
        soundService.playBack();
      }
      setTimeout(() => setStandaloneLaunchMessage(null), 3500);
    } catch (e: any) {
      soundService.playBack();
      setStandaloneLaunchMessage(e.message || 'Launch error');
      setTimeout(() => setStandaloneLaunchMessage(null), 3500);
    }
  };

  const handleSelectCore = (coreId: string, applyToAll: boolean) => {
    if (applyToAll) {
      const nextPlatformCores = { ...(config.platformCores || {}), [game.platformSlug]: coreId };
      onUpdateConfig?.({ platformCores: nextPlatformCores });
    } else {
      const nextGameCores = { ...(config.gameCores || {}), [String(game.id)]: coreId };
      onUpdateConfig?.({ gameCores: nextGameCores });
    }
  };

  const [launching, setLaunching] = useState(false);

  const handlePrimaryPlay = async () => {
    soundService.playSelect();
    setLaunching(true);
    try {
      if (installed) {
        if (isNative) await onLaunch(game);
        else onPlayInBrowser(game);
        return;
      }

      if (streamable) {
        onPlayInBrowser(game);
      } else {
        if (isNative) await onLaunch(game);
        else onPlayInBrowser(game);
      }
    } finally {
      setTimeout(() => setLaunching(false), 2500);
    }
  };

  const onAction = (a: NavigationAction) => {
    if (a === 'ACTION_Y') {
      onToggleFavorite(game);
      return true;
    }
    if (a === 'ACTION_X') {
      if (downloading) onCancelDownload(game);
      else onDownload(game);
      return true;
    }
    // Swallow library-level shortcuts while the page is open.
    return a === 'PREV_PLATFORM' || a === 'NEXT_PLATFORM' || a === 'FILTER' || a === 'VIEW_MODE_TOGGLE';
  };

  const btn = 'h-11 px-3.5 sm:px-4 rounded-xl flex items-center gap-2 font-bold text-xs sm:text-sm border whitespace-nowrap shrink-0 transition-all cursor-pointer';
  const section = 'rounded-2xl p-5 bg-deck-panel/90 border border-deck-line shadow-sm';

  return (
    <div className="fixed inset-0 z-[100] bg-deck-bg deck-enter">
      {game.coverUrl && (
        <img src={game.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15 blur-2xl scale-110 pointer-events-none" />
      )}
      <FocusScope name="game-detail" onBack={onClose} onAction={onAction} initialFocus="#detail-primary" className="relative h-full flex gap-6 px-8 pt-6 pb-12">
        <div className="w-[280px] sm:w-[300px] shrink-0 flex flex-col gap-4">
          <div className="rounded-2xl overflow-hidden shadow-2xl aspect-[3/4] bg-deck-panel-2 relative flex items-center justify-center border border-deck-line/60">
            {game.coverUrl && !coverError ? (
              <img
                src={game.coverUrl}
                alt={game.title}
                onError={() => setCoverError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-2.5 select-none"
                style={{ background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)' }}
              >
                <Gamepad2 size={46} className="text-white/60" />
                <span className="font-extrabold text-base text-white/90 line-clamp-3 leading-snug">{game.title}</span>
                <span className="text-xs font-mono text-deck-accent uppercase tracking-wider">{game.platformName}</span>
                {(installed || offlineMode) && (
                  <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 rounded-full mt-1 flex items-center gap-1">
                    <CloudOff size={11} className="text-amber-400" /> Offline Ready
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-deck-dim flex-wrap">
            <PlatformBadge platformSlug={game.platformSlug} platformName={game.platformName} size="md" />
            {installed && (
              <span className="flex items-center gap-1 text-deck-ok font-bold text-xs bg-deck-ok/10 border border-deck-ok/30 px-2 py-0.5 rounded-md">
                <CheckCircle2 size={14} /> Installed
              </span>
            )}
            {offlineMode && (
              <span className="flex items-center gap-1 text-amber-300 font-bold text-xs bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-500/30">
                <CloudOff size={13} className="text-amber-400" /> Offline Play
              </span>
            )}
          </div>
        </div>

        <div data-scroll-primary className="deck-scroll flex-1 min-w-0 px-4 pt-1 pb-10">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight text-white tracking-tight">{game.title}</h1>
            <button data-focusable onClick={onClose} className="h-10 w-10 shrink-0 rounded-xl bg-deck-panel-2 hover:bg-white/10 border border-deck-line flex items-center justify-center text-deck-dim hover:text-white transition-colors" aria-label="Close (B)">
              <X size={20} />
            </button>
          </div>
          <div className="mt-2 flex items-center flex-wrap gap-2 text-deck-dim text-sm">
            {Boolean(game.releaseYear && game.releaseYear > 0) && (
              <span className="font-semibold text-white/90">{game.releaseYear}</span>
            )}
            {Boolean(game.releaseYear && game.releaseYear > 0 && game.developer) && (
              <span className="text-deck-dim/60">·</span>
            )}
            {game.developer && (
              <span className="text-deck-dim font-medium">{game.developer}</span>
            )}
            {game.publisher && game.publisher !== game.developer && (
              <span className="text-deck-dim/70 text-xs">({game.publisher})</span>
            )}
            {game.genres && game.genres.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 ml-1">
                {game.genres.map((g) => (
                  <button
                    key={g}
                    data-focusable
                    onClick={() => {
                      onSelectGenre?.(g);
                      onClose();
                    }}
                    className="deck-chip px-2.5 py-0.5 rounded-md bg-deck-panel-2 border border-deck-line text-xs font-semibold text-deck-text hover:border-deck-accent hover:text-white transition-colors"
                    title={`Filter library by ${g}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* BIOS requirement indicator for PS2, PS1, Dreamcast */}
          {(['ps2', 'playstation-2', 'playstation2', 'psx', 'ps1', 'playstation', 'dc', 'dreamcast'].includes(game.platformSlug?.toLowerCase() || '')) && (
            <div className="mt-4 flex items-center gap-3 px-3.5 py-2 rounded-xl bg-purple-950/40 border border-purple-500/30 text-xs max-w-xl">
              <Cpu size={16} className="text-purple-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-purple-200">
                  {['ps2', 'playstation-2', 'playstation2'].includes(game.platformSlug?.toLowerCase() || '') ? 'PS2 BIOS Required: ' : 'System BIOS: '}
                </span>
                <span className="text-purple-300/80">
                  {['ps2', 'playstation-2', 'playstation2'].includes(game.platformSlug?.toLowerCase() || '')
                    ? 'PCSX2 requires a PS2 BIOS file to boot.'
                    : 'Ensure system BIOS files are in ~/Emulation/bios.'}
                </span>
              </div>
              {onOpenBiosModal && (
                <button
                  data-focusable
                  onClick={() => onOpenBiosModal(game.platformSlug)}
                  className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] shrink-0 cursor-pointer shadow-sm transition-all"
                >
                  Manage BIOS
                </button>
              )}
            </div>
          )}

          {/* Xbox Environment requirement indicator */}
          {(['xbox', 'og-xbox', 'original-xbox'].includes(game.platformSlug?.toLowerCase() || '')) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 px-3.5 py-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs max-w-xl">
              <HardDrive size={16} className="text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-emerald-200">Xbox (xemu) Environment:</span>
                  <span className="text-emerald-300/80">
                    Requires 8GB Virtual Hard Disk (xbox_hdd.qcow2), MCPX Boot ROM, & BIOS.
                  </span>
                </div>
                {xboxSetupMessage && (
                  <div className="text-[11px] text-emerald-300 font-semibold mt-1">{xboxSetupMessage}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  data-focusable
                  disabled={settingUpXbox}
                  onClick={async () => {
                    setSettingUpXbox(true);
                    soundService.playTick();
                    try {
                      const res = await rommApi.autoSetupXbox();
                      if (res.ok) {
                        soundService.playSuccess();
                        setXboxSetupMessage('✓ 8GB HDD created & xemu.toml configured!');
                      } else {
                        soundService.playBack();
                        setXboxSetupMessage(`Setup note: ${res.message}`);
                      }
                    } catch (e: any) {
                      soundService.playBack();
                      setXboxSetupMessage(`Error: ${e.message}`);
                    } finally {
                      setSettingUpXbox(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shrink-0 cursor-pointer shadow-sm transition-all disabled:opacity-50"
                >
                  {settingUpXbox ? 'Configuring...' : '1-Click Setup Xbox'}
                </button>
                {onOpenBiosModal && (
                  <button
                    data-focusable
                    onClick={() => onOpenBiosModal('xbox')}
                    className="px-2.5 py-1 rounded-lg bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-white font-bold text-[11px] shrink-0 cursor-pointer shadow-sm transition-all"
                  >
                    Manage BIOS & HDD
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Rows: Primary Actions + Secondary Tools */}
          <div className="mt-5 space-y-3">
            {/* Primary Action Row */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Primary Action Button */}
              <button
                id="detail-primary"
                data-focusable
                disabled={emulatorRunning || launching}
                onClick={handlePrimaryPlay}
                className={`${btn} bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-xl ring-1 ring-emerald-400/30 font-extrabold disabled:opacity-70 transition-all`}
              >
                {launching ? (
                  <>
                    <Loader2 size={18} className="animate-spin text-white" />
                    <span>Starting {activeCoreName}...</span>
                  </>
                ) : downloading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Downloading ({Math.round(progress || 0)}%)...</span>
                  </>
                ) : installed ? (
                  <>
                    <Play size={18} className="fill-white" />
                    <span>{offlineMode ? 'Play Offline' : 'Play Game'}</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono font-bold text-white/90">A</span>
                  </>
                ) : streamable ? (
                  <>
                    <Globe size={18} />
                    <span>Play (Stream)</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono font-bold text-white/90">A</span>
                  </>
                ) : (
                  <>
                    <Play size={18} className="fill-white" />
                    <span>Download & Play</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono font-bold text-white/90">A</span>
                  </>
                )}
              </button>

              {/* Core Selector Button */}
              <button
                data-focusable
                id="detail-core-selector"
                onClick={() => setCoreModalOpen(true)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text hover:border-deck-accent hover:text-white flex items-center gap-2`}
                title="Select which core or emulator to use for this game"
              >
                <Cpu size={16} className="text-deck-accent shrink-0" />
                <span className="text-xs uppercase text-deck-dim font-bold">Core:</span>
                <span className="font-extrabold text-white text-xs">{activeCoreName}</span>
                <ChevronDown size={14} className="opacity-70 ml-0.5 shrink-0" />
              </button>

              {/* Favorite Button */}
              <button
                data-focusable
                id="detail-favorite"
                onClick={() => onToggleFavorite(game)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text hover:border-deck-dim flex items-center gap-2`}
                title="Toggle favorite (Y button shortcut)"
              >
                <Star size={16} className={game.isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-deck-dim'} />
                <span>{game.isFavorite ? 'Favorited' : 'Favorite'}</span>
                <span className="ml-0.5 px-1.5 py-0.5 rounded bg-deck-bg text-[10px] font-mono font-bold text-deck-dim">Y</span>
              </button>

              {/* Download / Status Button */}
              {downloading ? (
                <button
                  data-focusable
                  onClick={() => onCancelDownload(game)}
                  className={`${btn} bg-deck-panel-2 border-deck-line text-deck-danger hover:bg-deck-danger/20 flex items-center gap-2`}
                >
                  <Square size={16} />
                  <span>Cancel ({Math.round(progress!)}%)</span>
                </button>
              ) : offlineMode ? (
                <div
                  className={`${btn} bg-deck-panel-2/50 border-deck-line text-deck-dim opacity-75 cursor-default flex items-center gap-2`}
                  title="RomM server is offline; downloading requires an active network connection"
                >
                  <CloudOff size={16} className="text-amber-400" />
                  <span>Offline ({installed ? 'Installed' : 'Unavailable'})</span>
                </div>
              ) : (
                <button
                  data-focusable
                  id="detail-download"
                  onClick={() => onDownload(game)}
                  className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text hover:border-deck-dim flex items-center gap-2`}
                  title="Download ROM locally (X button shortcut)"
                >
                  <Download size={16} />
                  <span>{installed ? 'Re-download' : 'Download'}</span>
                  <span className="ml-0.5 px-1.5 py-0.5 rounded bg-deck-bg text-[10px] font-mono font-bold text-deck-dim">X</span>
                </button>
              )}
            </div>

            {/* Secondary Tools & Standalone Emulator Row */}
            <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
              {/* Configure Standalone Emulator Directly */}
              {standaloneEmu && (
                <button
                  data-focusable
                  id="detail-configure-emulator"
                  onClick={handleLaunchStandaloneConfig}
                  className={`${btn} bg-sky-950/40 border-sky-500/40 text-sky-200 hover:bg-sky-900/50 hover:border-sky-400 flex items-center gap-2`}
                  title={`Launch ${standaloneEmu.name} emulator directly to update settings, graphics, and controls`}
                >
                  <Sliders size={16} className="text-sky-400 shrink-0" />
                  <span>Configure {standaloneEmu.name}</span>
                </button>
              )}

              {/* Patch ROM / Hacks Button */}
              <button
                data-focusable
                id="detail-patch-rom"
                onClick={() => setPatcherOpen(true)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-accent hover:border-deck-accent/50 flex items-center gap-2`}
                title="Apply fan translations, color patches, or ROM hacks"
              >
                <Wand2 size={16} className="text-deck-accent shrink-0" />
                <span>Patch ROM</span>
              </button>

              {/* Offline Play Option if streamable and installed */}
              {streamable && isNative && installed && (
                <button
                  data-focusable
                  disabled={emulatorRunning}
                  onClick={() => onLaunch(game)}
                  className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text flex items-center gap-2`}
                >
                  <Play size={16} />
                  <span>Launch Native</span>
                </button>
              )}

              {/* Delete button */}
              {installed && (
                <button
                  data-focusable
                  id="detail-delete"
                  onClick={() => onDelete(game)}
                  className={`${btn} bg-deck-panel-2 border-deck-line text-red-400 hover:text-white hover:bg-red-950/40 hover:border-red-500/50 flex items-center gap-2`}
                  title="Delete local ROM copy to free storage"
                >
                  <Trash2 size={16} className="text-red-400 shrink-0" />
                  <span>Delete</span>
                </button>
              )}
            </div>
          </div>

          {standaloneLaunchMessage && (
            <div className="mt-3 p-3.5 rounded-xl bg-sky-950/70 border border-sky-400/50 text-sky-200 text-xs font-mono font-bold animate-in fade-in flex items-center gap-2.5">
              <Sliders size={16} className="text-sky-400 shrink-0" />
              <span>{standaloneLaunchMessage}</span>
            </div>
          )}

          {downloading && (
            <div className="mt-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-deck-dim">
                <span>Downloading ROM for seamless offline play...</span>
                <span className="font-mono font-bold text-white">{Math.round(progress || 0)}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-deck-panel-2 overflow-hidden border border-deck-line">
                <div className="h-full bg-deck-accent transition-[width] duration-200" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Missing Standalone Emulator Alert Banner */}
          {isNative && flatpakId && flatpakInstalled === false && (
            <div className="mt-4 p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
                    Standalone Emulator Required ({activeCoreName})
                  </h3>
                  <p className="text-xs text-amber-200/80">
                    {activeCoreName} ({flatpakId}) is not installed on this Steam Deck. Install it directly from DeckRomM.
                  </p>
                  {flatpakError && <p className="text-xs text-red-400 font-semibold mt-1">{flatpakError}</p>}
                </div>
              </div>

              <button
                data-focusable
                disabled={flatpakInstalling}
                onClick={handleInstallFlatpak}
                className="px-4 py-2.5 rounded-xl text-xs font-extrabold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 border border-blue-400/30 shadow-lg transition-all shrink-0 active:scale-95 disabled:opacity-50"
              >
                {flatpakInstalling ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Installing {flatpakProgress != null ? `${flatpakProgress}%` : ''}</span>
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    <span>Install {activeCoreName}</span>
                  </>
                )}
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-4">
            {/* PCSX2 Memory Card Sync (PlayStation 2) */}
            {game.platformSlug === 'ps2' && (
              <Pcsx2MemcardManager game={game} onToast={onToast || ((msg) => {})} />
            )}
            {/* Server Tags */}
            {game.tags && game.tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag size={14} className="text-deck-dim" />
                <span className="text-xs font-bold text-deck-dim uppercase tracking-wider">Tags:</span>
                {game.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold bg-deck-accent/15 border border-deck-accent/30 text-deck-accent"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <section data-focusable tabIndex={-1} className={section}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-deck-accent mb-2.5">About</h2>
              {loadingDetails && !game.summary ? (
                <div className="flex items-center gap-2 text-deck-dim">
                  <Loader2 size={16} className="animate-spin" /> Loading details
                </div>
              ) : (
                <p className="text-sm sm:text-base leading-relaxed whitespace-pre-line text-deck-text/90">{game.summary || 'No description available.'}</p>
              )}
            </section>

            {/* Multi-File / Disc Browser */}
            {game.files && game.files.length > 1 && (
              <section data-focusable tabIndex={-1} className={section}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-deck-accent flex items-center gap-2">
                    <Disc size={15} /> Associated Files & Discs ({game.files.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {game.files.map((file, idx) => (
                    <div
                      key={file.id || idx}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-deck-panel-2 border border-deck-line text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded font-mono font-bold bg-deck-bg text-deck-accent shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-mono text-white truncate" title={file.fileName}>
                          {file.fileName}
                        </span>
                      </div>
                      <span className="text-deck-dim font-mono shrink-0">{formatBytes(file.fileSizeBytes)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section data-focusable tabIndex={-1} className={`${section} grid grid-cols-2 gap-x-8 gap-y-2.5 text-sm`}>
              <h2 className="col-span-2 text-xs font-bold uppercase tracking-wider text-deck-accent mb-1.5">Details</h2>
              {[
                ['Emulator Core', `${activeCoreName} (${activeCoreObj?.type === 'standalone' ? 'Standalone' : 'RetroArch'})`],
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
                  <div key={k} className="flex gap-3 min-w-0 text-xs sm:text-sm">
                    <span className="w-28 shrink-0 text-deck-dim font-medium">{k}</span>
                    <span className="truncate font-mono text-deck-text font-medium" title={String(v)}>{v}</span>
                  </div>
                ))}
            </section>

            {game.screenshots && game.screenshots.length > 0 && (
              <section className={section}>
                <h2 className="text-xs font-bold uppercase tracking-wider text-deck-accent mb-3">Screenshots</h2>
                <div className="grid grid-cols-3 gap-3">
                  {game.screenshots.slice(0, 9).map((s) => (
                    <div key={s} data-focusable tabIndex={-1} className="rounded-xl overflow-hidden aspect-video bg-deck-panel-2 border border-deck-line">
                      <img src={s} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </FocusScope>

      {/* Core Selector Modal */}
      {coreModalOpen && (
        <CoreSelectorModal
          game={game}
          platformSlug={game.platformSlug}
          platformName={game.platformName}
          config={config}
          onSelectCore={handleSelectCore}
          onClose={() => setCoreModalOpen(false)}
        />
      )}

      {/* ROM Patcher Modal */}
      {patcherOpen && (
        <RomPatcherModal
          game={game}
          onClose={() => setPatcherOpen(false)}
          onSuccess={(patchedName) => {
            setGame((g) => ({ ...g, isInstalled: true }));
          }}
        />
      )}
    </div>
  );
};
