import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sliders,
  Sparkles,
  ExternalLink,
  Search,
  Gamepad2,
  Settings,
} from 'lucide-react';
import { FocusScope } from './FocusScope';
import { SUPPORTED_STANDALONE_EMULATORS, StandaloneEmulatorInfo } from '../types';
import { bridge, isNativeApp } from '../services/bridge';
import { rommApi } from '../services/rommApi';
import { soundService } from '../services/soundService';

interface StandaloneEmulatorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (text: string, tone?: 'ok' | 'error' | 'info') => void;
  initialSelectedId?: string;
}

export const StandaloneEmulatorsModal: React.FC<StandaloneEmulatorsModalProps> = ({
  isOpen,
  onClose,
  onToast,
  initialSelectedId,
}) => {
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});
  const [installingMap, setInstallingMap] = useState<Record<string, { progress?: number; message?: string }>>({});
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch flatpak installation status
  useEffect(() => {
    if (!isOpen) return;

    const flatpakIds = SUPPORTED_STANDALONE_EMULATORS.map((e) => e.flatpakId);
    bridge.system.flatpakStatus(flatpakIds).then((res) => {
      setInstalledMap(res.installed || {});
    }).catch(() => {});

    const offProgress = bridge.on('flatpak:progress', (ev) => {
      if (ev.status === 'installing') {
        setInstallingMap((prev) => ({
          ...prev,
          [ev.flatpakId]: { progress: ev.progress, message: ev.message },
        }));
      } else if (ev.status === 'completed') {
        setInstalledMap((prev) => ({ ...prev, [ev.flatpakId]: true }));
        setInstallingMap((prev) => {
          const next = { ...prev };
          delete next[ev.flatpakId];
          return next;
        });
        onToast(`Successfully installed ${ev.flatpakId}`, 'ok');
      } else if (ev.status === 'error') {
        setInstallingMap((prev) => {
          const next = { ...prev };
          delete next[ev.flatpakId];
          return next;
        });
        onToast(ev.message || `Failed to install ${ev.flatpakId}`, 'error');
      }
    });

    return () => {
      offProgress();
    };
  }, [isOpen, onToast]);

  if (!isOpen) return null;

  const handleLaunchEmulator = async (emu: StandaloneEmulatorInfo) => {
    soundService.playSelect();
    setLaunchingId(emu.id);
    try {
      const res = await rommApi.launchStandaloneEmulator(emu.flatpakId, emu.name);
      if (res.success) {
        soundService.playSuccess();
        onToast(res.message, 'ok');
        onClose();
      } else {
        soundService.playBack();
        onToast(res.message, 'error');
      }
    } catch (err: any) {
      soundService.playBack();
      onToast(err.message || 'Failed to launch emulator', 'error');
    } finally {
      setLaunchingId(null);
    }
  };

  const handleInstallEmulator = async (emu: StandaloneEmulatorInfo) => {
    soundService.playSelect();
    setInstallingMap((prev) => ({ ...prev, [emu.flatpakId]: { message: 'Starting...' } }));
    try {
      const res = await bridge.system.installFlatpak(emu.flatpakId);
      if (res.ok) {
        setInstalledMap((prev) => ({ ...prev, [emu.flatpakId]: true }));
        soundService.playSuccess();
        onToast(`Installed ${emu.name}`, 'ok');
      } else {
        soundService.playBack();
        onToast(res.message || `Failed to install ${emu.name}`, 'error');
      }
    } catch (err: any) {
      soundService.playBack();
      onToast(err.message || `Failed to install ${emu.name}`, 'error');
    } finally {
      setInstallingMap((prev) => {
        const next = { ...prev };
        delete next[emu.flatpakId];
        return next;
      });
    }
  };

  const filtered = SUPPORTED_STANDALONE_EMULATORS.filter((emu) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      emu.name.toLowerCase().includes(q) ||
      emu.flatpakId.toLowerCase().includes(q) ||
      emu.description.toLowerCase().includes(q) ||
      emu.platforms.some((p) => p.toLowerCase().includes(q))
    );
  });

  return (
    <div
      className="fixed inset-0 z-[250] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <FocusScope
        name="standalone-emulators-modal"
        onBack={onClose}
        initialFocus={initialSelectedId ? `#emu-btn-${initialSelectedId}` : '#emu-search-input'}
        className="w-full max-w-4xl max-h-[92vh] bg-gradient-to-b from-[#111827] to-[#0b0f19] border border-sky-400/40 rounded-2xl shadow-[0_0_50px_rgba(56,189,248,0.25)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/30">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-white">Standalone Emulators & Settings</h2>
                <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-xs font-mono font-bold">
                  Direct Launch
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Launch any emulator GUI without running a game to map controller buttons, configure graphics, or update settings.
              </p>
            </div>
          </div>
          <button
            data-focusable
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 border-b border-white/10 bg-black/20 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="emu-search-input"
              data-focusable
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter emulators by name, platform, or flatpak id (e.g. Dolphin, PS2, RetroArch)..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#090d16] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Emulator List */}
        <div className="flex-1 overflow-y-auto deck-scroll p-6 space-y-3.5">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400 font-mono text-sm">
              No emulators found matching "{searchQuery}"
            </div>
          ) : (
            filtered.map((emu) => {
              const isInstalled = Boolean(installedMap[emu.flatpakId]);
              const installing = installingMap[emu.flatpakId];
              const isLaunching = launchingId === emu.id;

              return (
                <div
                  key={emu.id}
                  className="p-4 rounded-xl bg-[#131b2c]/80 hover:bg-[#18233a] border border-white/10 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-extrabold text-white text-base">{emu.name}</span>
                      <span className="text-xs font-mono text-slate-400">({emu.flatpakId})</span>
                      {isInstalled ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Installed
                        </span>
                      ) : installing ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Installing {installing.progress ? `${installing.progress}%` : ''}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Not Installed
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed mb-2">{emu.description}</p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-slate-400 font-medium">Platforms:</span>
                      {emu.platforms.map((plat) => (
                        <span
                          key={plat}
                          className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-400/20 text-sky-300 font-mono text-[10px] font-bold"
                        >
                          {plat}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {isInstalled ? (
                      <button
                        id={`emu-btn-${emu.id}`}
                        data-focusable
                        disabled={isLaunching}
                        onClick={() => handleLaunchEmulator(emu)}
                        className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-extrabold flex items-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-50"
                        title={`Launch ${emu.name} without a game running`}
                      >
                        {isLaunching ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Launching...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 fill-white" />
                            <span>Launch Settings / GUI</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <>
                        <button
                          id={`emu-btn-${emu.id}`}
                          data-focusable
                          disabled={Boolean(installing)}
                          onClick={() => handleInstallEmulator(emu)}
                          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-50"
                        >
                          {installing ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Installing {installing.progress ? `${installing.progress}%` : ''}</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              <span>Install Flatpak</span>
                            </>
                          )}
                        </button>
                        <button
                          data-focusable
                          onClick={() => handleLaunchEmulator(emu)}
                          className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                          title="Attempt direct system launch"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Try Launch</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer / Legend */}
        <div className="px-6 py-3 border-t border-white/10 bg-black/50 flex items-center justify-between text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
            <span>Launches directly into the emulator's full configuration window (controller buttons, graphics, hotkeys)</span>
          </div>
          <div className="flex items-center gap-3">
            <span><b className="text-white">A</b> Select</span>
            <span><b className="text-white">B</b> Close</span>
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
