import React, { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, HardDrive, Info, LogIn, LogOut, Server, SlidersHorizontal, Gamepad2, Cpu, ChevronRight, Download, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Play, Sliders, ArrowUpCircle } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { PLATFORM_AVAILABLE_CORES, RommConfig, SUPPORTED_STANDALONE_EMULATORS } from '../types';
import { AppInfo, AuthStatus, NativeStorage } from '../env/electron';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';
import { rommApi } from '../services/rommApi';
import { formatBytes } from './GameCard';
import { CoreSelectorModal } from './CoreSelectorModal';

interface SettingsScreenProps {
  config: RommConfig;
  auth: AuthStatus;
  onChange: (patch: Partial<RommConfig>) => void;
  onClose: () => void;
  onSignIn: () => void;
  onLogout: () => void;
  onOpenEmulatorsModal?: () => void;
  onOpenBiosModal?: () => void;
  onOpenUpdateModal?: () => void;
}

const CONFIGURABLE_PLATFORMS = [
  { slug: 'psx', name: 'Sony PlayStation (PS1)', defaultCore: 'swanstation' },
  { slug: 'ps2', name: 'Sony PlayStation 2', defaultCore: 'pcsx2_standalone' },
  { slug: 'n64', name: 'Nintendo 64', defaultCore: 'mupen64plus_next' },
  { slug: 'snes', name: 'Super Nintendo (SNES)', defaultCore: 'snes9x' },
  { slug: 'gba', name: 'Game Boy Advance', defaultCore: 'mgba' },
  { slug: 'genesis', name: 'Sega Genesis / Mega Drive', defaultCore: 'genesis_plus_gx' },
  { slug: 'nds', name: 'Nintendo DS', defaultCore: 'melondsds' },
  { slug: 'nes', name: 'Nintendo Entertainment System', defaultCore: 'mesen' },
  { slug: 'gamecube', name: 'Nintendo GameCube / Wii', defaultCore: 'dolphin_standalone' },
  { slug: 'arcade', name: 'Arcade (MAME / Neo-Geo)', defaultCore: 'fbneo' },
];

const LAUNCHERS: Array<{ id: NonNullable<RommConfig['launcherMode']>; label: string; hint: string }> = [
  { id: 'auto', label: 'Automatic', hint: 'Standalone emulator flatpak if installed (EmuDeck), otherwise RetroArch' },
  { id: 'retroarch', label: 'RetroArch only', hint: 'Always launch RetroArch with the matching libretro core' },
  { id: 'custom', label: 'Custom command', hint: 'Use the template below; placeholders {rom} {core} {platform} {romdir}' },
];

const Toggle: React.FC<{ label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, hint, value, onChange }) => (
  <button data-focusable onClick={() => onChange(!value)} className="deck-row w-full min-h-14 px-4 py-2 rounded-xl flex items-center justify-between gap-4 text-left bg-deck-panel/70">
    <span>
      <span className="block font-semibold">{label}</span>
      {hint && <span className="block text-sm text-deck-dim">{hint}</span>}
    </span>
    <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${value ? 'bg-deck-accent' : 'bg-deck-line'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${value ? 'left-6' : 'left-1'}`} />
    </span>
  </button>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="flex flex-col gap-2">
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-deck-dim mt-4 mb-1">
      {icon}
      {title}
    </h2>
    {children}
  </section>
);

/** Server / emulation / library settings. Opened with Select (View) or from the main menu. */
export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  config,
  auth,
  onChange,
  onClose,
  onSignIn,
  onLogout,
  onOpenEmulatorsModal,
  onOpenBiosModal,
  onOpenUpdateModal,
}) => {
  const [storage, setStorage] = useState<NativeStorage | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [emuPath, setEmuPath] = useState(config.emulationPath || '');
  const [customCmd, setCustomCmd] = useState(config.customLaunchCommand || '');
  const [editingPlatformSlug, setEditingPlatformSlug] = useState<string | null>(null);

  const [installedFlatpaks, setInstalledFlatpaks] = useState<Record<string, boolean>>({});
  const [installingFlatpaks, setInstallingFlatpaks] = useState<Record<string, { message?: string; progress?: number }>>({});
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});

  const [scanningServer, setScanningServer] = useState(false);
  const [scanStatusMsg, setScanStatusMsg] = useState('');

  const handleTriggerScan = async (type: 'quick' | 'full' = 'quick') => {
    setScanningServer(true);
    setScanStatusMsg('Sending scan request to RomM server...');
    soundService.playTick();
    const res = await rommApi.triggerServerScan(type);
    if (res.success) {
      soundService.playSuccess();
      setScanStatusMsg(res.message || 'Scan started on server.');
    } else {
      soundService.playBack();
      setScanStatusMsg(`Scan failed: ${res.message}`);
    }
    setScanningServer(false);
  };

  useEffect(() => {
    if (!isNativeApp) return;
    bridge.system.storage().then(setStorage).catch(() => {});
    bridge.app.info().then(setInfo).catch(() => {});

    const flatpakIds = SUPPORTED_STANDALONE_EMULATORS.map((e) => e.flatpakId);
    bridge.system.flatpakStatus(flatpakIds).then((res) => {
      if (res && res.installed) {
        setInstalledFlatpaks(res.installed);
      }
    }).catch(() => {});

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
        setInstallErrors((prev) => ({ ...prev, [ev.flatpakId]: ev.message || 'Installation failed' }));
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
  }, [config.emulationPath]);

  const handleInstallEmulator = async (flatpakId: string) => {
    if (!isNativeApp) return;
    soundService.playTick();
    setInstallingFlatpaks((prev) => ({ ...prev, [flatpakId]: { message: 'Starting...' } }));
    setInstallErrors((prev) => ({ ...prev, [flatpakId]: '' }));

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
      setInstallErrors((prev) => ({ ...prev, [flatpakId]: res.message || 'Installation failed' }));
      setInstallingFlatpaks((prev) => {
        const next = { ...prev };
        delete next[flatpakId];
        return next;
      });
    }
  };

  const [launchMessage, setLaunchMessage] = useState<string | null>(null);

  const handleLaunchStandalone = async (flatpakId: string, name?: string) => {
    soundService.playSelect();
    try {
      const res = await rommApi.launchStandaloneEmulator(flatpakId, name);
      soundService.playSuccess();
      setLaunchMessage(res.message);
      setTimeout(() => setLaunchMessage(null), 4000);
    } catch (e: any) {
      soundService.playBack();
      setLaunchMessage(e.message || 'Launch error');
      setTimeout(() => setLaunchMessage(null), 4000);
    }
  };

  const browse = async () => {
    const dir = await bridge.system.selectDirectory();
    if (dir) {
      setEmuPath(dir);
      onChange({ emulationPath: dir });
    }
  };

  const launcher = LAUNCHERS.find((l) => l.id === (config.launcherMode || 'auto')) || LAUNCHERS[0];
  const cycleLauncher = () => onChange({ launcherMode: LAUNCHERS[(LAUNCHERS.indexOf(launcher) + 1) % LAUNCHERS.length].id });
  const input = 'deck-input flex-1 h-12 rounded-xl bg-[#0a0e15] border-2 border-deck-line px-4 font-mono text-deck-text placeholder:text-deck-dim/70';

  return (
    <div className="fixed inset-0 z-[110] bg-deck-bg deck-enter flex flex-col">
      <FocusScope
        name="settings"
        onBack={onClose}
        onAction={(a) => {
          if (a === 'FILTER') {
            onClose();
            return true;
          }
          return false;
        }}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div className="h-16 shrink-0 flex items-center gap-4 px-8 border-b border-deck-line">
          <button data-focusable onClick={onClose} className="h-11 w-11 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-center" aria-label="Back">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-2xl font-extrabold">Settings</h1>
        </div>

        <div data-scroll-primary className="deck-scroll flex-1 min-h-0 px-8 pb-16">
          <div className="max-w-[900px] mx-auto">
            <Section icon={<Server size={16} />} title="RomM server">
              <div className="rounded-xl bg-deck-panel/70 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono truncate">{auth.baseUrl || config.serverUrl || 'Not configured'}</div>
                  <div className="text-sm text-deck-dim">
                    {config.isDemoMode
                      ? 'Demo library (offline)'
                      : auth.authenticated
                      ? `Signed in as ${auth.username || 'unknown'} via ${auth.method}  -  secrets stored with ${auth.storage || 'encrypted file'}`
                      : 'Not signed in'}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button data-focusable onClick={onSignIn} className="h-11 px-4 rounded-xl bg-deck-accent text-white font-bold flex items-center gap-2">
                    <LogIn size={18} /> {auth.authenticated ? 'Change server' : 'Sign in'}
                  </button>
                  {auth.authenticated && (
                    <button data-focusable onClick={onLogout} className="h-11 px-4 rounded-xl bg-deck-panel-2 border border-deck-line font-semibold flex items-center gap-2">
                      <LogOut size={18} /> Sign out
                    </button>
                  )}
                </div>
              </div>

              {auth.authenticated && !config.isDemoMode && (
                <div className="mt-3 p-4 rounded-xl bg-deck-panel/50 border border-deck-line flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-white">RomM Server Tasks & Scans</h4>
                      <p className="text-xs text-deck-dim">Trigger background scans directly on your remote RomM server</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      data-focusable
                      disabled={scanningServer}
                      onClick={() => handleTriggerScan('quick')}
                      className="px-3.5 py-2 rounded-lg bg-deck-panel-2 hover:bg-deck-panel border border-deck-line text-xs font-bold text-white flex items-center gap-2 transition-all shrink-0 active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={scanningServer ? 'animate-spin' : ''} />
                      Quick Scan (New Files)
                    </button>
                    <button
                      data-focusable
                      disabled={scanningServer}
                      onClick={() => handleTriggerScan('full')}
                      className="px-3.5 py-2 rounded-lg bg-deck-panel-2 hover:bg-deck-panel border border-deck-line text-xs font-bold text-deck-accent flex items-center gap-2 transition-all shrink-0 active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={scanningServer ? 'animate-spin' : ''} />
                      Full Rescan & Metadata Refresh
                    </button>
                  </div>
                  {scanStatusMsg && (
                    <div className="text-xs font-semibold text-emerald-400 bg-emerald-950/30 border border-emerald-500/30 px-3 py-1.5 rounded-lg">
                      {scanStatusMsg}
                    </div>
                  )}
                </div>
              )}
            </Section>

            {isNativeApp && (
              <Section icon={<Gamepad2 size={16} />} title="Emulation">
                <div className="flex gap-3">
                  <input
                    data-focusable
                    data-keyboard-title="Emulation folder (contains roms/)"
                    value={emuPath}
                    placeholder={storage?.emulationRoot ? `Auto: ${storage.emulationRoot}` : 'Auto-detect (EmuDeck / SD card)'}
                    onChange={(e) => {
                      setEmuPath(e.target.value);
                      onChange({ emulationPath: e.target.value.trim() });
                    }}
                    className={input}
                  />
                  <button data-focusable onClick={browse} className="h-12 px-4 rounded-xl bg-deck-panel-2 border border-deck-line font-semibold flex items-center gap-2">
                    <FolderOpen size={18} /> Browse
                  </button>
                </div>
                <button data-focusable onClick={cycleLauncher} className="deck-row w-full min-h-14 px-4 py-2 rounded-xl flex items-center justify-between gap-4 text-left bg-deck-panel/70">
                  <span>
                    <span className="block font-semibold">Launcher</span>
                    <span className="block text-sm text-deck-dim">{launcher.hint}</span>
                  </span>
                  <span className="font-bold text-deck-accent-2">{'\u25C0'} {launcher.label} {'\u25B6'}</span>
                </button>
                {config.launcherMode === 'custom' && (
                  <input
                    data-focusable
                    data-keyboard-title="Custom launch command"
                    value={customCmd}
                    placeholder='flatpak run org.libretro.RetroArch -L {core} "{rom}"'
                    onChange={(e) => {
                      setCustomCmd(e.target.value);
                      onChange({ customLaunchCommand: e.target.value });
                    }}
                    className={input}
                  />
                )}
                <Toggle label="RetroArch fullscreen" hint="Pass -f so games open fullscreen in Game Mode" value={config.retroarchFullscreen !== false} onChange={(v) => onChange({ retroarchFullscreen: v })} />
              </Section>
            )}

            <Section icon={<Cpu size={16} />} title="Emulator Cores (Native Defaults & Overrides)">
              <div className="flex flex-col gap-2">
                {CONFIGURABLE_PLATFORMS.map((p) => {
                  const activeCore = config.platformCores?.[p.slug] || p.defaultCore;
                  const coreObj = PLATFORM_AVAILABLE_CORES[p.slug]?.find((c) => c.id === activeCore);
                  const coreName = coreObj ? coreObj.name : activeCore;

                  return (
                    <button
                      key={p.slug}
                      data-focusable
                      onClick={() => setEditingPlatformSlug(p.slug)}
                      className="deck-row w-full min-h-14 px-4 py-2.5 rounded-xl flex items-center justify-between gap-4 text-left bg-deck-panel/70 border border-deck-line hover:border-deck-dim/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold block text-white">{p.name}</span>
                        <span className="text-xs text-deck-dim">Default: {p.defaultCore}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-deck-accent">{coreName}</span>
                        <ChevronRight size={16} className="text-deck-dim" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            {isNativeApp && (
              <Section
                icon={<Download size={16} />}
                title="Standalone Emulators (Flatpaks)"
              >
                {launchMessage && (
                  <div className="mb-2 p-3 rounded-xl bg-sky-950/60 border border-sky-400/40 text-sky-200 text-xs font-mono font-bold animate-in fade-in flex items-center justify-between">
                    <span>{launchMessage}</span>
                  </div>
                )}
                {onOpenEmulatorsModal && (
                  <div className="mb-3 flex justify-end">
                    <button
                      data-focusable
                      onClick={onOpenEmulatorsModal}
                      className="px-4 py-2 rounded-xl text-xs font-extrabold bg-sky-600/30 hover:bg-sky-600/50 border border-sky-400/40 text-sky-200 flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                    >
                      <Sliders size={14} className="text-sky-300" />
                      <span>Open Standalone Emulators Manager</span>
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {SUPPORTED_STANDALONE_EMULATORS.map((emu) => {
                    const isInstalled = Boolean(installedFlatpaks[emu.flatpakId]);
                    const isInstalling = Boolean(installingFlatpaks[emu.flatpakId]);
                    const progress = installingFlatpaks[emu.flatpakId]?.progress;
                    const errMsg = installErrors[emu.flatpakId];

                    return (
                      <div
                        key={emu.id}
                        className="rounded-xl bg-deck-panel/70 border border-deck-line p-4 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-white text-base">{emu.name}</span>
                            <span className="text-xs font-mono text-deck-dim">({emu.flatpakId})</span>
                            {isInstalled ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <CheckCircle2 size={11} /> Installed
                              </span>
                            ) : isInstalling ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                                <Loader2 size={11} className="animate-spin" /> Installing {progress != null ? `${progress}%` : ''}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                <AlertTriangle size={11} /> Not Installed
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-deck-dim mt-0.5">{emu.description}</p>
                          <p className="text-[11px] text-deck-accent font-medium mt-0.5">Platforms: {emu.platforms.join(', ')}</p>
                          {errMsg && <p className="text-xs text-red-400 font-semibold mt-1">{errMsg}</p>}
                        </div>

                        {isInstalled ? (
                          <button
                            data-focusable
                            onClick={() => handleLaunchStandalone(emu.flatpakId, emu.name)}
                            className="px-4 py-2 rounded-xl text-xs font-extrabold bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white flex items-center gap-2 border border-sky-400/40 shadow-md transition-all shrink-0 active:scale-95 cursor-pointer"
                            title={`Launch ${emu.name} without a game running to update settings`}
                          >
                            <Play size={13} className="fill-white" />
                            <span>Launch Settings / GUI</span>
                          </button>
                        ) : (
                          <button
                            data-focusable
                            disabled={isInstalling}
                            onClick={() => handleInstallEmulator(emu.flatpakId)}
                            className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 border border-blue-400/30 shadow-md transition-all shrink-0 disabled:opacity-50"
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>Installing...</span>
                              </>
                            ) : (
                              <>
                                <Download size={14} />
                                <span>Install Flatpak</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            <Section icon={<Cpu size={16} />} title="BIOS & Firmware">
              <div className="rounded-xl bg-deck-panel/70 p-4 border border-deck-line space-y-3">
                <div className="text-sm text-deck-dim leading-relaxed">
                  Standalone emulators like <strong className="text-white">PCSX2 (PlayStation 2)</strong>, <strong className="text-white">DuckStation (PS1)</strong>, and <strong className="text-white">Flycast (Dreamcast)</strong> require system BIOS files to boot games. DeckRomM pulls them down directly from your RomM server into <code className="text-deck-accent font-mono">~/Emulation/bios</code> and auto-syncs them to Flatpak emulator directories.
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {onOpenBiosModal && (
                    <button
                      data-focusable
                      onClick={onOpenBiosModal}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-deck-accent hover:bg-deck-accent-hover text-white flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                    >
                      <Cpu size={15} />
                      <span>Open BIOS & Firmware Manager</span>
                    </button>
                  )}
                  {isNativeApp && (
                    <button
                      data-focusable
                      onClick={() => bridge.bios.openFolder()}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-white flex items-center gap-2 transition-all cursor-pointer"
                    >
                      <FolderOpen size={15} />
                      <span>Open BIOS Directory</span>
                    </button>
                  )}
                </div>
              </div>
            </Section>

            <Section icon={<ArrowUpCircle size={16} />} title="App Updates & GitHub">
              <div className="rounded-xl bg-deck-panel/70 p-4 border border-deck-line space-y-3">
                <div className="text-sm text-deck-dim">
                  DeckRomM can check GitHub on launch for newer commits and upgrade the application in place.
                </div>
                <Toggle
                  label="Check for updates on launch"
                  hint="Automatically check GitHub for new commits when DeckRomM starts"
                  value={config.autoCheckUpdates !== false}
                  onChange={(v) => onChange({ autoCheckUpdates: v })}
                />
                <div className="flex items-center justify-between p-3 rounded-lg bg-black/30 border border-white/5 text-xs">
                  <span className="text-deck-dim">Target GitHub Repo:</span>
                  <span className="font-mono text-white font-bold">{config.githubRepo || 'Auto-detected'} ({config.githubBranch || 'main'})</span>
                </div>
                <div className="pt-1">
                  {onOpenUpdateModal && (
                    <button
                      data-focusable
                      onClick={onOpenUpdateModal}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                    >
                      <ArrowUpCircle size={15} />
                      <span>Check for Updates & Upgrade in Place</span>
                    </button>
                  )}
                </div>
              </div>
            </Section>

            <Section icon={<SlidersHorizontal size={16} />} title="Library">
              <Toggle
                label="Hide Japanese ROMs by default"
                hint="Exclude untranslated Japanese releases from library lists"
                value={Boolean(config.hideJapanese || config.languageFilter === 'no-ja')}
                onChange={(v) => onChange({ hideJapanese: v, languageFilter: v ? 'no-ja' : 'all' })}
              />
              <Toggle label="Hide BIOS / info files" hint="Skip .txt, .nfo, .jpg and similar entries" value={config.hideInfoFiles !== false} onChange={(v) => onChange({ hideInfoFiles: v })} />
              <Toggle label="Navigation sounds" value={config.audioFeedback !== false} onChange={(v) => onChange({ audioFeedback: v })} />
            </Section>

            {storage && (
              <Section icon={<HardDrive size={16} />} title="Storage">
                <div data-focusable tabIndex={-1} className="rounded-xl bg-deck-panel/70 p-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-deck-dim">ROM folder</div>
                    <div className="font-mono truncate">{storage.emulationRoot}/roms</div>
                  </div>
                  <div>
                    <div className="text-deck-dim">Target</div>
                    <div>{storage.storageTarget === 'sdcard' ? 'microSD card' : 'Internal SSD'}</div>
                  </div>
                  <div>
                    <div className="text-deck-dim">Internal free</div>
                    <div>{formatBytes(storage.internalFreeBytes)} of {formatBytes(storage.internalTotalBytes)}</div>
                  </div>
                  <div>
                    <div className="text-deck-dim">microSD free</div>
                    <div>{storage.sdCardMounted ? `${formatBytes(storage.sdFreeBytes)} of ${formatBytes(storage.sdTotalBytes)}` : 'Not inserted'}</div>
                  </div>
                </div>
              </Section>
            )}

            {info && (
              <Section icon={<Info size={16} />} title="About">
                <div data-focusable tabIndex={-1} className="rounded-xl bg-deck-panel/70 p-4 text-sm grid grid-cols-2 gap-2">
                  <span className="text-deck-dim">DeckRomM</span><span>{info.version}</span>
                  <span className="text-deck-dim">Electron</span><span>{info.electron}</span>
                  <span className="text-deck-dim">Session</span><span>{info.gameMode ? 'SteamOS Game Mode' : 'Desktop'}</span>
                  <span className="text-deck-dim">Secret storage</span><span>{info.secureStorage}</span>
                  <span className="text-deck-dim">Data folder</span><span className="font-mono truncate">{info.userData}</span>
                </div>
              </Section>
            )}
          </div>
        </div>
      </FocusScope>

      {editingPlatformSlug && (
        <CoreSelectorModal
          platformSlug={editingPlatformSlug}
          config={config}
          onSelectCore={(coreId) => {
            const nextPlatformCores = { ...(config.platformCores || {}), [editingPlatformSlug]: coreId };
            onChange({ platformCores: nextPlatformCores });
          }}
          onClose={() => setEditingPlatformSlug(null)}
        />
      )}
    </div>
  );
};
