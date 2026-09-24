import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Cpu, Sparkles, X, Info, Layers, RefreshCw, Download, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { CoreOption, Game, PLATFORM_AVAILABLE_CORES, RommConfig, getActiveCoreForGame } from '../types';
import { FocusScope } from './FocusScope';
import { PlatformBadge } from './PlatformBadge';
import { soundService } from '../services/soundService';
import { bridge, isNativeApp } from '../services/bridge';

interface CoreSelectorModalProps {
  game?: Game | null;
  platformSlug: string;
  platformName?: string;
  config: RommConfig;
  onSelectCore: (coreId: string, applyToAllPlatform: boolean) => void;
  onClose: () => void;
}

export const CoreSelectorModal: React.FC<CoreSelectorModalProps> = ({
  game,
  platformSlug,
  platformName,
  config,
  onSelectCore,
  onClose,
}) => {
  const availableCores = PLATFORM_AVAILABLE_CORES[platformSlug] || [
    { id: 'auto', name: 'Automatic (Default)', type: 'both', recommended: true, description: 'Default emulator selected by system' },
  ];

  const currentCoreId = game
    ? getActiveCoreForGame(game, config)
    : config.platformCores?.[platformSlug] || availableCores[0]?.id || 'auto';

  const [selectedCore, setSelectedCore] = useState<string>(currentCoreId);
  const [applyToAll, setApplyToAll] = useState<boolean>(!game);
  const [installedFlatpaks, setInstalledFlatpaks] = useState<Record<string, boolean>>({});
  const [installingFlatpaks, setInstallingFlatpaks] = useState<Record<string, { message?: string; progress?: number }>>({});
  const [installError, setInstallError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isNativeApp) return;
    const flatpakIds = availableCores.map((c) => c.flatpakId).filter(Boolean) as string[];
    if (flatpakIds.length > 0) {
      bridge.system.flatpakStatus(flatpakIds).then((res) => {
        if (res && res.installed) {
          setInstalledFlatpaks(res.installed);
        }
      }).catch(() => {});
    }

    const offProgress = bridge.on('flatpak:progress', (ev) => {
      if (ev.status === 'installing') {
        setInstallingFlatpaks((prev) => ({ ...prev, [ev.flatpakId]: { message: ev.message, progress: ev.progress } }));
      } else if (ev.status === 'completed') {
        setInstalledFlatpaks((prev) => ({ ...prev, [ev.flatpakId]: true }));
        setInstallingFlatpaks((prev) => {
          const next = { ...prev };
          delete next[ev.flatpakId];
          return next;
        });
      } else if (ev.status === 'error') {
        setInstallError((prev) => ({ ...prev, [ev.flatpakId]: ev.message || 'Installation failed' }));
        setInstallingFlatpaks((prev) => {
          const next = { ...prev };
          delete next[ev.flatpakId];
          return next;
        });
      }
    });

    return () => {
      offProgress();
    };
  }, [platformSlug]);

  const handleInstallFlatpak = async (flatpakId: string) => {
    if (!isNativeApp) return;
    soundService.playTick();
    setInstallingFlatpaks((prev) => ({ ...prev, [flatpakId]: { message: 'Starting...' } }));
    setInstallError((prev) => ({ ...prev, [flatpakId]: '' }));

    const res = await bridge.system.installFlatpak(flatpakId);
    if (res.ok) {
      soundService.playSuccess();
      setInstalledFlatpaks((prev) => ({ ...prev, [flatpakId]: true }));
      setInstallingFlatpaks((prev) => {
        const next = { ...prev };
        delete next[flatpakId];
        return next;
      });
    } else {
      soundService.playBack();
      setInstallError((prev) => ({ ...prev, [flatpakId]: res.message || 'Installation failed' }));
      setInstallingFlatpaks((prev) => {
        const next = { ...prev };
        delete next[flatpakId];
        return next;
      });
    }
  };

  const handleApply = (coreId = selectedCore) => {
    soundService.playSuccess();
    onSelectCore(coreId, applyToAll);
    onClose();
  };

  const displayName = platformName || (game ? game.platformName : platformSlug.toUpperCase());

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md deck-enter flex items-center justify-center p-6">
      <FocusScope
        name="core-selector"
        onBack={onClose}
        initialFocus={`#core-option-${selectedCore}`}
        className="w-full max-w-2xl bg-deck-bg border border-deck-line rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-deck-line bg-deck-panel">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-deck-accent/20 border border-deck-accent/40 flex items-center justify-center text-deck-accent">
              <Cpu size={22} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                Select Emulator Core
              </h2>
              <p className="text-xs text-deck-dim">
                {game ? `Configuring core for "${game.title}"` : `Default core for ${displayName}`}
              </p>
            </div>
          </div>
          <button
            data-focusable
            onClick={onClose}
            className="h-10 w-10 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Core List */}
        <div data-scroll-primary className="deck-scroll flex-1 min-h-0 p-6 flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-deck-dim">
              Available Cores for {displayName}
            </span>
            <PlatformBadge platformSlug={platformSlug} platformName={displayName} size="sm" />
          </div>

          {availableCores.map((core: CoreOption) => {
            const isSelected = selectedCore === core.id;
            const isPlatformDefault = config.platformCores?.[platformSlug] === core.id;
            const hasFlatpak = Boolean(core.flatpakId);
            const isInstalled = hasFlatpak && installedFlatpaks[core.flatpakId!];
            const isInstalling = hasFlatpak && Boolean(installingFlatpaks[core.flatpakId!]);
            const errMessage = hasFlatpak && installError[core.flatpakId!];

            return (
              <button
                key={core.id}
                data-focusable
                id={`core-option-${core.id}`}
                onClick={() => {
                  setSelectedCore(core.id);
                  handleApply(core.id);
                }}
                className={`deck-row p-4 rounded-xl border text-left flex items-start gap-4 transition-all ${
                  isSelected
                    ? 'bg-deck-accent/20 border-deck-accent shadow-md'
                    : 'bg-deck-panel/70 border-deck-line hover:border-deck-dim/50'
                }`}
              >
                <div
                  className={`mt-1 h-6 w-6 rounded-full border flex items-center justify-center shrink-0 ${
                    isSelected
                      ? 'border-deck-accent bg-deck-accent text-white'
                      : 'border-deck-line bg-deck-panel-2 text-transparent'
                  }`}
                >
                  <Check size={14} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-base text-white">{core.name}</span>

                    {core.recommended && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                        <Sparkles size={11} /> Recommended
                      </span>
                    )}

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        core.type === 'standalone'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : core.type === 'web'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      }`}
                    >
                      {core.type === 'standalone' ? 'Standalone Flatpak' : core.type === 'web' ? 'Web Emulator' : 'RetroArch Libretro'}
                    </span>

                    {hasFlatpak && isNativeApp && (
                      isInstalled ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 size={11} /> Installed on Deck
                        </span>
                      ) : isInstalling ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                          <Loader2 size={11} className="animate-spin" />
                          Installing {installingFlatpaks[core.flatpakId!]?.progress != null ? `${installingFlatpaks[core.flatpakId!]?.progress}%` : ''}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                          <AlertTriangle size={11} /> Not Installed
                        </span>
                      )
                    )}

                    {isPlatformDefault && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-deck-panel-2 text-deck-dim border border-deck-line">
                        Platform Default
                      </span>
                    )}
                  </div>

                  {core.description && (
                    <p className="mt-1 text-sm text-deck-dim leading-snug">{core.description}</p>
                  )}

                  {errMessage && (
                    <p className="mt-1 text-xs text-red-400 font-semibold">{errMessage}</p>
                  )}
                </div>

                {hasFlatpak && isNativeApp && !isInstalled && !isInstalling && (
                  <button
                    data-focusable
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInstallFlatpak(core.flatpakId!);
                    }}
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-extrabold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 border border-blue-400/30 shadow-md transition-all shrink-0 active:scale-95"
                    title={`Install ${core.name} flatpak directly onto your Steam Deck`}
                  >
                    <Download size={13} />
                    Install from DeckRomM
                  </button>
                )}
              </button>
            );
          })}

          {/* Scope Selector (Only shown if modal opened for a specific game) */}
          {game && (
            <div className="mt-3 p-4 rounded-xl bg-deck-panel/50 border border-deck-line flex items-center justify-between gap-4">
              <div>
                <span className="block font-semibold text-sm text-white">Save Scope</span>
                <span className="block text-xs text-deck-dim">
                  {applyToAll
                    ? `Set "${availableCores.find((c) => c.id === selectedCore)?.name || selectedCore}" as default for all ${displayName} games`
                    : `Use only for "${game.title}"`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  data-focusable
                  onClick={() => setApplyToAll(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    !applyToAll
                      ? 'bg-deck-accent text-white border-deck-accent'
                      : 'bg-deck-panel-2 text-deck-dim border-deck-line hover:text-white'
                  }`}
                >
                  This Game Only
                </button>
                <button
                  data-focusable
                  onClick={() => setApplyToAll(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    applyToAll
                      ? 'bg-deck-accent text-white border-deck-accent'
                      : 'bg-deck-panel-2 text-deck-dim border-deck-line hover:text-white'
                  }`}
                >
                  All {displayName} Games
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="h-16 shrink-0 flex items-center justify-between px-6 border-t border-deck-line bg-deck-panel">
          <div className="text-xs text-deck-dim flex items-center gap-2">
            <Info size={14} className="text-deck-accent" />
            <span>Settings are stored locally on your Steam Deck and persist across launches</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              data-focusable
              onClick={onClose}
              className="h-10 px-4 rounded-xl bg-deck-panel-2 border border-deck-line text-sm font-semibold hover:border-deck-dim"
            >
              Cancel
            </button>
            <button
              data-focusable
              onClick={() => handleApply()}
              className="h-10 px-5 rounded-xl bg-deck-accent text-white text-sm font-bold shadow-md hover:bg-deck-accent-2"
            >
              Save Core Selection
            </button>
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
