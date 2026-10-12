import React, { useEffect, useState } from 'react';
import { Play, Download, Trash2, Star, Globe, X, CheckCircle2, Loader2, Square, Cpu, ChevronDown, AlertTriangle, Tag, Disc, Wand2, Sliders } from 'lucide-react';
import { CoreOption, Game, NavigationAction, PLATFORM_AVAILABLE_CORES, RommConfig, getActiveCoreForGame, getStandaloneEmulatorForPlatform } from '../types';
import { FocusScope } from './FocusScope';
import { PlatformBadge } from './PlatformBadge';
import { formatBytes } from './GameCard';
import { rommApi } from '../services/rommApi';
import { CoreSelectorModal } from './CoreSelectorModal';
import { RomPatcherModal } from './RomPatcherModal';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';

interface GameDetailModalProps {
  game: Game;
  isNative: boolean;
  progress?: number;
  emulatorRunning: boolean;
  config: RommConfig;
  onUpdateConfig?: (patch: Partial<RommConfig>) => void;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onDownload: (game: Game) => void;
  onCancelDownload: (game: Game) => void;
  onDelete: (game: Game) => void;
  onPlayInBrowser: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onGameUpdated: (game: Game) => void;
  onSelectGenre?: (genre: string) => void;
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
  onClose,
  onLaunch,
  onDownload,
  onCancelDownload,
  onDelete,
  onPlayInBrowser,
  onToggleFavorite,
  onGameUpdated,
  onSelectGenre,
}) => {
  const [game, setGame] = useState<Game>(initial);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [coreModalOpen, setCoreModalOpen] = useState(false);
  const [patcherOpen, setPatcherOpen] = useState(false);

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

  const handlePrimaryPlay = () => {
    if (installed) {
      if (isNative) onLaunch(game);
      else onPlayInBrowser(game);
      return;
    }

    if (streamable) {
      onPlayInBrowser(game);
    } else {
      // For non-streamable games, trigger seamless download & launch
      if (isNative) {
        onLaunch(game);
      } else {
        onPlayInBrowser(game);
      }
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
          <div className="mt-2 flex items-center flex-wrap gap-2 text-deck-dim text-sm">
            {game.releaseYear && <span className="font-semibold text-white/90">{game.releaseYear}</span>}
            {game.developer && <span>· {game.developer}</span>}
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

          {/* Action Row */}
          <div className="mt-6 flex flex-wrap gap-3">
            {/* Primary Action Button */}
            <button
              id="detail-primary"
              data-focusable
              disabled={emulatorRunning}
              onClick={handlePrimaryPlay}
              className={`${btn} bg-deck-ok border-deck-ok text-white shadow-lg disabled:opacity-50 transition-all`}
            >
              {downloading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span>Downloading ({Math.round(progress || 0)}%)...</span>
                </>
              ) : installed ? (
                <>
                  <Play size={20} className="fill-white" />
                  <span>Play Game</span>
                </>
              ) : streamable ? (
                <>
                  <Globe size={20} />
                  <span>Play (Stream)</span>
                </>
              ) : (
                <>
                  <Play size={20} className="fill-white" />
                  <span>Download & Play</span>
                </>
              )}
            </button>

            {/* Core Selector Button */}
            <button
              data-focusable
              id="detail-core-selector"
              onClick={() => setCoreModalOpen(true)}
              className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text hover:border-deck-accent flex items-center gap-2`}
              title="Select which core or emulator to use for this game"
            >
              <Cpu size={18} className="text-deck-accent" />
              <span className="text-xs uppercase text-deck-dim font-bold">Core:</span>
              <span className="font-extrabold text-sm text-white">{activeCoreName}</span>
              <ChevronDown size={14} className="opacity-70 ml-0.5" />
            </button>

            {/* Offline Play Option if streamable and installed */}
            {streamable && isNative && installed && (
              <button
                data-focusable
                disabled={emulatorRunning}
                onClick={() => onLaunch(game)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text`}
              >
                <Play size={18} /> Launch Native
              </button>
            )}

            {/* Download Button */}
            {downloading ? (
              <button
                data-focusable
                onClick={() => onCancelDownload(game)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-danger hover:bg-deck-danger/20`}
              >
                <Square size={18} /> Cancel ({Math.round(progress!)}%)
              </button>
            ) : (
              <button
                data-focusable
                onClick={() => onDownload(game)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-text hover:border-deck-dim`}
              >
                <Download size={20} /> {installed ? 'Re-download' : 'Download'}
              </button>
            )}

            {/* Patch ROM / Hacks Button */}
            <button
              data-focusable
              onClick={() => setPatcherOpen(true)}
              className={`${btn} bg-deck-panel-2 border-deck-line text-deck-accent hover:border-deck-accent/50`}
              title="Apply fan translations, color patches, or ROM hacks"
            >
              <Wand2 size={20} /> Patch ROM
            </button>

            {/* Configure Standalone Emulator Directly */}
            {standaloneEmu && (
              <button
                data-focusable
                onClick={handleLaunchStandaloneConfig}
                className={`${btn} bg-deck-panel-2 border-deck-line text-sky-300 hover:border-sky-400/60 flex items-center gap-2`}
                title={`Launch ${standaloneEmu.name} emulator directly to update settings and buttons`}
              >
                <Sliders size={18} className="text-sky-400" />
                <span>Configure {standaloneEmu.name}</span>
              </button>
            )}

            {/* Favorite Button */}
            <button
              data-focusable
              onClick={() => onToggleFavorite(game)}
              className={`${btn} bg-deck-panel-2 border-deck-line`}
            >
              <Star size={20} className={game.isFavorite ? 'text-yellow-400 fill-yellow-400' : ''} />
              {game.isFavorite ? 'Favorited' : 'Favorite'}
            </button>

            {/* Delete button */}
            {installed && (
              <button
                data-focusable
                onClick={() => onDelete(game)}
                className={`${btn} bg-deck-panel-2 border-deck-line text-deck-danger hover:bg-red-950/30`}
              >
                <Trash2 size={20} /> Delete
              </button>
            )}
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
              <h2 className="text-sm font-bold uppercase tracking-wide text-deck-dim mb-2">About</h2>
              {loadingDetails && !game.summary ? (
                <div className="flex items-center gap-2 text-deck-dim">
                  <Loader2 size={16} className="animate-spin" /> Loading details
                </div>
              ) : (
                <p className="text-base leading-relaxed whitespace-pre-line">{game.summary || 'No description available.'}</p>
              )}
            </section>

            {/* Multi-File / Disc Browser */}
            {game.files && game.files.length > 1 && (
              <section data-focusable tabIndex={-1} className={section}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-deck-dim flex items-center gap-2">
                    <Disc size={16} className="text-deck-accent" /> Associated Files & Discs ({game.files.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {game.files.map((file, idx) => (
                    <div
                      key={file.id || idx}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-deck-panel-2 border border-deck-line text-xs"
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

            <section data-focusable tabIndex={-1} className={`${section} grid grid-cols-2 gap-x-8 gap-y-2 text-sm`}>
              <h2 className="col-span-2 text-sm font-bold uppercase tracking-wide text-deck-dim mb-1">Details</h2>
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
                  <div key={k} className="flex gap-3 min-w-0">
                    <span className="w-28 shrink-0 text-deck-dim">{k}</span>
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
