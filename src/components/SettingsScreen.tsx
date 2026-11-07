import React, { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, HardDrive, Info, LogIn, LogOut, Server, SlidersHorizontal, Gamepad2, Cpu, ChevronRight, Download, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Play, Sliders, ArrowUpCircle, Sparkles, Trophy, Key, Vibrate, Palette } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { PLATFORM_AVAILABLE_CORES, RommConfig, SUPPORTED_STANDALONE_EMULATORS } from '../types';
import { AppInfo, AuthStatus, NativeStorage } from '../env/electron';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';
import { hapticsService } from '../services/hapticsService';
import { rommApi } from '../services/rommApi';
import { retroAchievementsService } from '../services/retroAchievementsService';
import { formatBytes } from './GameCard';
import { CoreSelectorModal } from './CoreSelectorModal';
import { Pcsx2MemcardManager } from './Pcsx2MemcardManager';

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
  onOpenStorage?: () => void;
  onOpenWizard?: () => void;
  onToast?: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
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
  { slug: 'xbox', name: 'Microsoft Xbox (Original)', defaultCore: 'xemu' },
  { slug: 'xbox360', name: 'Microsoft Xbox 360', defaultCore: 'xenia' },
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
  onOpenStorage,
  onOpenWizard,
  onToast,
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
  const [syncingArt, setSyncingArt] = useState(false);
  const [artSyncMsg, setArtSyncMsg] = useState<string | null>(null);

  const [testingRa, setTestingRa] = useState(false);
  const [detectingRa, setDetectingRa] = useState(false);
  const [raStatusMsg, setRaStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleAutoDetectRa = async () => {
    soundService.playTick();
    setDetectingRa(true);
    setRaStatusMsg(null);
    try {
      const res = await rommApi.detectRetroAchievements();
      if (res.ok) {
        soundService.playSuccess();
        setRaStatusMsg({ text: res.message, ok: true });
        onToast?.(res.message, 'ok');
        onChange({
          raUsername: res.username || config.raUsername,
          raApiKey: res.token || config.raApiKey,
          raSource: res.source,
          raServerConnected: res.hasServerKey,
        });
      } else {
        soundService.playBack();
        setRaStatusMsg({ text: res.message, ok: false });
        onToast?.(res.message, 'info');
      }
    } catch (e: any) {
      soundService.playBack();
      setRaStatusMsg({ text: `Auto-detect error: ${e.message}`, ok: false });
      onToast?.(`Auto-detect error: ${e.message}`, 'error');
    } finally {
      setDetectingRa(false);
    }
  };

  const handleTestRa = async () => {
    soundService.playTick();
    setTestingRa(true);
    setRaStatusMsg(null);
    const res = await retroAchievementsService.testCredentials(config.raUsername || '', config.raApiKey || '');
    if (res.ok) {
      soundService.playSuccess();
      setRaStatusMsg({ text: res.message, ok: true });
      onToast?.(res.message, 'ok');
    } else {
      soundService.playBack();
      setRaStatusMsg({ text: res.message, ok: false });
      onToast?.(res.message, 'error');
    }
    setTestingRa(false);
  };

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
    if (flatpakId === 'xenia' || flatpakId === 'jp.xenia.xenia') {
      onToast('Xenia (Xbox 360) is not on Flathub. Install via EmuDeck (Proton wrapper) or place xenia.AppImage in ~/Applications.', 'info');
      return;
    }
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
          <div className="max-w-[900px] mx-auto flex flex-col gap-6">
            {/* 1. RomM Server & Connection */}
            <Section icon={<Server size={16} />} title="RomM Server & Connection">
              <div className="rounded-xl bg-deck-panel/70 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono truncate">{auth.baseUrl || config.serverUrl || 'Not configured'}</div>
                  <div className="text-sm text-deck-dim">
                    {config.isDemoMode
                      ? 'Demo library mode (offline test games)'
                      : auth.authenticated
                      ? `Signed in as ${auth.username || 'unknown'} via ${auth.method} • secrets stored with ${auth.storage || 'encrypted file'}`
                      : 'Not signed in'}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button data-focusable onClick={onSignIn} className="h-11 px-4 rounded-xl bg-deck-accent text-white font-bold flex items-center gap-2 cursor-pointer shadow-sm">
                    <LogIn size={18} /> {auth.authenticated ? 'Change server' : 'Sign in'}
                  </button>
                  {auth.authenticated && (
                    <button data-focusable onClick={onLogout} className="h-11 px-4 rounded-xl bg-deck-panel-2 border border-deck-line font-semibold flex items-center gap-2 cursor-pointer">
                      <LogOut size={18} /> Sign out
                    </button>
                  )}
                </div>
              </div>

              {/* Offline Mode Toggle (Single canonical location) */}
              <Toggle
                label="Offline Mode (Downloaded Games Only)"
                hint="Only display games downloaded to this Steam Deck that can be played locally without an internet connection"
                value={Boolean(config.offlineOnlyMode)}
                onChange={(v) => onChange({ offlineOnlyMode: v })}
              />

              {/* Demo Mode Toggle */}
              <Toggle
                label="Demo Library Mode"
                hint="Explore DeckRomM with built-in retro sample titles without connecting to a RomM server"
                value={Boolean(config.isDemoMode)}
                onChange={(v) => onChange({ isDemoMode: v })}
              />

              {auth.authenticated && !config.isDemoMode && (
                <div className="p-4 rounded-xl bg-deck-panel/50 border border-deck-line flex flex-col gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-white">RomM Server Tasks & Scans</h4>
                    <p className="text-xs text-deck-dim">Trigger background library scans directly on your remote RomM instance</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      data-focusable
                      disabled={scanningServer}
                      onClick={() => handleTriggerScan('quick')}
                      className="px-3.5 py-2 rounded-lg bg-deck-panel-2 hover:bg-deck-panel border border-deck-line text-xs font-bold text-white flex items-center gap-2 transition-all shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw size={14} className={scanningServer ? 'animate-spin' : ''} />
                      Quick Scan (New Files)
                    </button>
                    <button
                      data-focusable
                      disabled={scanningServer}
                      onClick={() => handleTriggerScan('full')}
                      className="px-3.5 py-2 rounded-lg bg-deck-panel-2 hover:bg-deck-panel border border-deck-line text-xs font-bold text-deck-accent flex items-center gap-2 transition-all shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
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

            {/* 2. Steam Deck Display & Physical Feedback */}
            <Section icon={<Palette size={16} />} title="Steam Deck Display & Physical Feedback">
              {/* Theme Picker */}
              <div className="p-4 rounded-xl bg-deck-panel/70 flex flex-col gap-3">
                <div>
                  <div className="font-semibold text-sm text-white">Interface Theme</div>
                  <div className="text-xs text-deck-dim">Color palette optimized for the Steam Deck 7-inch LCD / OLED display</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: 'oled_black', label: '🖤 OLED Pure Black', desc: 'True #000000 pixels (Max battery & contrast)' },
                    { id: 'steamos_dark', label: '🕹️ SteamOS Dark', desc: 'Default dark slate (#0b0f17)' },
                    { id: 'midnight_blue', label: '🎮 Midnight Blue', desc: 'Classic 90s console gaming aesthetic' },
                  ].map((t) => {
                    const isSelected = (config.theme || 'steamos_dark') === t.id;
                    return (
                      <button
                        key={t.id}
                        data-focusable
                        onClick={() => {
                          soundService.playSelect();
                          onChange({ theme: t.id as any });
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-deck-accent/20 border-deck-accent text-white shadow-sm'
                            : 'bg-deck-panel-2/60 border-deck-line text-deck-dim hover:text-white hover:border-deck-dim'
                        }`}
                      >
                        <div className="text-xs font-bold text-white">{t.label}</div>
                        <div className="text-[10px] text-deck-dim mt-0.5">{t.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CRT Scanline Toggle */}
              <Toggle
                label="CRT Retro Scanlines Filter"
                hint="Overlay authentic arcade/phosphor scanlines on box art and screenshot previews"
                value={Boolean(config.crtScanlines)}
                onChange={(v) => onChange({ crtScanlines: v })}
              />

              {/* Navigation Sounds (Grouped with Physical Feedback) */}
              <Toggle
                label="Navigation Sounds & Audio Cues"
                hint="Play subtle Steam-style audio clicks on D-pad movements and button selections"
                value={config.audioFeedback !== false}
                onChange={(v) => {
                  soundService.enabled = v;
                  onChange({ audioFeedback: v });
                  if (v) soundService.playTick();
                }}
              />

              {/* Haptics Toggle */}
              <Toggle
                label="Steam Deck Tactile Haptics (Vibration Actuators)"
                hint="Physical tactile feedback for D-pad navigation, button confirmation, and roulette rolls"
                value={config.hapticsEnabled !== false}
                onChange={(v) => {
                  hapticsService.enabled = v;
                  onChange({ hapticsEnabled: v });
                  if (v) hapticsService.select();
                }}
              />

              {/* Haptics Intensity */}
              {config.hapticsEnabled !== false && (
                <div className="p-4 rounded-xl bg-deck-panel/70 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-sm text-white flex items-center gap-2">
                      <Vibrate size={16} className="text-deck-accent" />
                      <span>Haptic Intensity</span>
                    </div>
                    <div className="text-xs text-deck-dim">Strength of actuator clicks during navigation</div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {(['soft', 'medium', 'strong'] as const).map((lvl) => {
                      const isCurrent = (config.hapticsIntensity || 'medium') === lvl;
                      return (
                        <button
                          key={lvl}
                          data-focusable
                          onClick={() => {
                            hapticsService.intensity = lvl;
                            hapticsService.select();
                            onChange({ hapticsIntensity: lvl });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold capitalize border transition-all cursor-pointer ${
                            isCurrent
                              ? 'bg-deck-accent text-white border-deck-accent shadow-sm'
                              : 'bg-deck-panel-2 border-deck-line text-deck-dim hover:text-white'
                          }`}
                        >
                          {lvl}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Section>

            {/* 3. Emulation & EmuDeck */}
            <Section icon={<Gamepad2 size={16} />} title="Emulation & EmuDeck">
              {isNativeApp && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-3">
                    <input
                      data-focusable
                      data-keyboard-title="Emulation folder (contains roms/)"
                      value={emuPath}
                      placeholder={
                        storage?.emulationRoot
                          ? `Auto: ${storage.emulationRoot}`
                          : 'Auto-detect (EmuDeck / SD card)'
                      }
                      onChange={(e) => {
                        setEmuPath(e.target.value);
                        onChange({ emulationPath: e.target.value.trim() });
                      }}
                      className={input}
                    />
                    <button data-focusable onClick={browse} className="h-12 px-4 rounded-xl bg-deck-panel-2 border border-deck-line font-semibold flex items-center gap-2 cursor-pointer">
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
                </div>
              )}

              {/* EmuDeck Quick Tools Card */}
              <div className="p-4 rounded-xl bg-deck-panel/70 border border-deck-line flex flex-col gap-3">
                <div>
                  <h4 className="font-bold text-sm text-white flex items-center gap-2">
                    <Sliders size={16} className="text-deck-accent" />
                    <span>EmuDeck & Emulator Management</span>
                  </h4>
                  <p className="text-xs text-deck-dim mt-0.5">Quick access to standalone Flatpak emulators, system BIOS managers, and memory card sync</p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {onOpenEmulatorsModal && (
                    <button
                      data-focusable
                      onClick={onOpenEmulatorsModal}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-sky-600/30 hover:bg-sky-600/50 border border-sky-400/40 text-sky-200 flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                    >
                      <Sliders size={14} className="text-sky-300" />
                      <span>Manage Standalone Emulators</span>
                    </button>
                  )}
                  {onOpenBiosModal && (
                    <button
                      data-focusable
                      onClick={onOpenBiosModal}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-deck-accent hover:bg-deck-accent-hover text-white flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                    >
                      <Cpu size={14} />
                      <span>BIOS & Firmware Manager</span>
                    </button>
                  )}
                  {isNativeApp && (
                    <button
                      data-focusable
                      onClick={() => bridge.bios.openFolder()}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-deck-panel-2 hover:bg-deck-panel border border-deck-line text-white flex items-center gap-2 transition-all cursor-pointer"
                    >
                      <FolderOpen size={14} />
                      <span>Open BIOS Folder</span>
                    </button>
                  )}
                </div>
              </div>

              {/* PCSX2 Memory Card Sync */}
              <div className="rounded-xl bg-deck-panel/70 p-4 border border-deck-line space-y-3">
                <div className="flex items-center gap-2">
                  <HardDrive size={16} className="text-amber-400" />
                  <span className="font-bold text-sm text-white">PlayStation 2 (PCSX2) Memory Cards</span>
                </div>
                <Pcsx2MemcardManager onToast={onToast || ((msg) => {})} />
              </div>

              {/* Platform Core Associations */}
              <div className="rounded-xl bg-deck-panel/70 p-4 border border-deck-line space-y-3">
                <div>
                  <h4 className="font-bold text-sm text-white flex items-center gap-2">
                    <Cpu size={16} className="text-deck-accent" />
                    <span>Platform Default Cores & Overrides</span>
                  </h4>
                  <p className="text-xs text-deck-dim mt-0.5">Select preferred emulator core or standalone runner per retro console</p>
                </div>
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
                        className="deck-row w-full min-h-12 px-4 py-2 rounded-xl flex items-center justify-between gap-4 text-left bg-deck-panel-2/60 border border-deck-line hover:border-deck-dim/50 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold block text-white text-sm">{p.name}</span>
                          <span className="text-[11px] text-deck-dim">Default: {p.defaultCore}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-deck-accent">{coreName}</span>
                          <ChevronRight size={16} className="text-deck-dim" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            {/* 4. Storage & Library Rules */}
            <Section icon={<SlidersHorizontal size={16} />} title="Storage & Offline Library">
              {storage && (
                <div data-focusable tabIndex={-1} className="rounded-xl bg-deck-panel/70 p-4 grid grid-cols-2 gap-3 text-sm border border-deck-line">
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
              )}

              {onOpenStorage && (
                <div>
                  <button
                    data-focusable
                    onClick={onOpenStorage}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                  >
                    <HardDrive size={15} />
                    <span>Manage Downloaded Games & Storage Space</span>
                  </button>
                </div>
              )}

              <Toggle label="Hide BIOS / info files" hint="Skip .txt, .nfo, .jpg and similar non-game files in library lists" value={config.hideInfoFiles !== false} onChange={(v) => onChange({ hideInfoFiles: v })} />

              {/* Pre-cache All Box Art */}
              <div className="p-4 rounded-xl bg-deck-panel/70 border border-deck-line flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-white text-sm">Download All Offline Covers</div>
                  <div className="text-xs text-deck-dim">Pre-cache box art for all downloaded games on disk so everything is visible while offline</div>
                  {artSyncMsg && <div className="text-xs font-bold text-emerald-400 mt-1 animate-in fade-in">{artSyncMsg}</div>}
                </div>
                <button
                  data-focusable
                  onClick={async () => {
                    soundService.playTick();
                    setSyncingArt(true);
                    try {
                      const res = await rommApi.syncAllOfflineArtwork();
                      soundService.playSuccess();
                      setArtSyncMsg(res.message);
                      setTimeout(() => setArtSyncMsg(null), 5000);
                    } catch (e: any) {
                      soundService.playBack();
                      setArtSyncMsg(`Failed: ${e.message}`);
                      setTimeout(() => setArtSyncMsg(null), 5000);
                    } finally {
                      setSyncingArt(false);
                    }
                  }}
                  disabled={syncingArt}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  <Sparkles size={14} className={syncingArt ? 'animate-spin' : ''} />
                  <span>{syncingArt ? 'Downloading...' : 'Sync Offline Art'}</span>
                </button>
              </div>
            </Section>

            {/* 5. RetroAchievements */}
            <Section icon={<Trophy size={16} />} title="RetroAchievements">
              <div className="p-4 rounded-xl bg-deck-panel/70 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-400/30">
                      <Trophy size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm">RetroAchievements Profile</div>
                      <div className="text-xs text-deck-dim">Link your account to track trophies, badges, and hardcore points</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {config.raSource === 'romm_server' || config.raServerConnected ? (
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-sky-950/80 border border-sky-400/40 text-sky-300 flex items-center gap-1.5 shadow">
                        <Server size={13} /> RomM Server API
                      </span>
                    ) : null}
                    {config.raUsername && (
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 size={13} /> {config.raUsername}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 text-xs text-sky-200/90 leading-relaxed flex items-start gap-2.5">
                  <Sparkles size={16} className="text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-sky-300 block mb-0.5">No API Key Input Needed on Steam Deck:</strong>
                    If you already configured RetroAchievements on your RomM server (via <code className="px-1 py-0.5 rounded bg-black/40 text-sky-200 font-mono text-[11px]">RETROACHIEVEMENTS_API_KEY</code>), DeckRomM automatically routes all achievement queries through your server. You do not need to manually copy-paste an API key!
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-deck-dim mb-1 text-xs font-semibold">RA Username:</label>
                    <input
                      id="settings-ra-username"
                      data-focusable
                      type="text"
                      value={config.raUsername || ''}
                      onChange={(e) => onChange({ raUsername: e.target.value.trim() || undefined })}
                      placeholder="e.g. RetroDeckPlayer"
                      data-keyboard-title="RetroAchievements Username"
                      data-keyboard-mode="text"
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-deck-line text-white font-mono text-xs focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-deck-dim mb-1 text-xs font-semibold">
                      Web API Key <span className="text-deck-dim/70 font-normal">(Optional - RomM Server provides this)</span>:
                    </label>
                    <input
                      id="settings-ra-key"
                      data-focusable
                      type="password"
                      value={config.raApiKey || ''}
                      onChange={(e) => onChange({ raApiKey: e.target.value.trim() || undefined })}
                      placeholder="Leave blank to use RomM server's key..."
                      data-keyboard-title="RetroAchievements Web API Key (Optional)"
                      data-keyboard-mode="text"
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-deck-line text-white font-mono text-xs focus:border-amber-400"
                    />
                  </div>
                </div>

                <Toggle
                  label="Hardcore Mode Only"
                  hint="Enforce official hardcore rules: disables in-game save states, rewind, and cheats"
                  value={config.raHardcoreOnly !== false}
                  onChange={(v) => onChange({ raHardcoreOnly: v })}
                />

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      data-focusable
                      id="settings-detect-ra"
                      onClick={handleAutoDetectRa}
                      disabled={detectingRa}
                      className="px-4 py-2 rounded-xl text-xs font-extrabold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 shadow transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                      title="Pull RetroAchievements username and integration status from RomM server"
                    >
                      {detectingRa ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      <span>{detectingRa ? 'Detecting...' : 'Auto-Detect from RomM Server'}</span>
                    </button>

                    <button
                      data-focusable
                      id="settings-test-ra"
                      onClick={handleTestRa}
                      disabled={testingRa || detectingRa}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {testingRa ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
                      <span>{testingRa ? 'Verifying...' : 'Test Connection'}</span>
                    </button>
                  </div>

                  {raStatusMsg && (
                    <span
                      className={`text-xs font-semibold flex items-center gap-1.5 ${
                        raStatusMsg.ok ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {raStatusMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {raStatusMsg.text}
                    </span>
                  )}
                </div>
              </div>
            </Section>

            {/* 6. System, Setup & Updates */}
            <Section icon={<Info size={16} />} title="System, Setup & Updates">
              <div className="rounded-xl bg-deck-panel/70 p-4 border border-deck-line space-y-4">
                {/* Onboarding Wizard Launcher */}
                {onOpenWizard && (
                  <div className="p-3.5 rounded-xl bg-sky-950/40 border border-sky-400/30 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-white text-sm flex items-center gap-2">
                        <Sparkles size={16} className="text-sky-400" />
                        <span>First-Run Setup Wizard</span>
                      </div>
                      <div className="text-xs text-deck-dim mt-0.5">Re-run the initial handheld guided onboarding to auto-detect EmuDeck, test haptics, or switch libraries</div>
                    </div>
                    <button
                      data-focusable
                      onClick={onOpenWizard}
                      className="px-4 py-2 rounded-xl text-xs font-extrabold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-2 shadow-sm transition-all active:scale-95 shrink-0 cursor-pointer"
                    >
                      <Sparkles size={14} />
                      <span>Launch Wizard</span>
                    </button>
                  </div>
                )}

                {/* GitHub In-Place Updates */}
                <div>
                  <div className="text-sm font-semibold text-white mb-2">DeckRomM In-Place Updates</div>
                  <Toggle
                    label="Check for updates on launch"
                    hint="Automatically check GitHub for new releases when DeckRomM starts"
                    value={config.autoCheckUpdates !== false}
                    onChange={(v) => onChange({ autoCheckUpdates: v })}
                  />
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="block text-deck-dim mb-1 text-xs font-semibold">Repository (owner/repo):</label>
                      <input
                        id="settings-github-repo"
                        data-focusable
                        type="text"
                        value={config.githubRepo || ''}
                        onChange={(e) => onChange({ githubRepo: e.target.value.trim() || undefined })}
                        placeholder="e.g. username/deckromm"
                        data-keyboard-title="GitHub Repository (owner/repo)"
                        data-keyboard-mode="text"
                        className="w-full px-3 py-2 rounded-lg bg-black/40 border border-deck-line text-white font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-deck-dim mb-1 text-xs font-semibold">Branch:</label>
                      <input
                        id="settings-github-branch"
                        data-focusable
                        type="text"
                        value={config.githubBranch || ''}
                        onChange={(e) => onChange({ githubBranch: e.target.value.trim() || undefined })}
                        placeholder="main"
                        data-keyboard-title="GitHub Branch"
                        data-keyboard-mode="text"
                        className="w-full px-3 py-2 rounded-lg bg-black/40 border border-deck-line text-white font-mono text-xs"
                      />
                    </div>
                  </div>
                  {onOpenUpdateModal && (
                    <div className="pt-3">
                      <button
                        data-focusable
                        onClick={onOpenUpdateModal}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                      >
                        <ArrowUpCircle size={15} />
                        <span>Check for Updates & Upgrade in Place</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* About Specs Card (Cleaned of duplicate session row) */}
                {info && (
                  <div className="pt-2 border-t border-white/10">
                    <div className="text-xs font-bold text-deck-dim uppercase tracking-wide mb-2">System Diagnostics</div>
                    <div data-focusable tabIndex={-1} className="rounded-xl bg-black/30 p-3.5 text-xs grid grid-cols-2 gap-2 border border-deck-line/60">
                      <span className="text-deck-dim">DeckRomM Version</span><span className="font-mono text-white">{info.version}</span>
                      <span className="text-deck-dim">Platform Environment</span><span className="text-white">{info.gameMode ? 'SteamOS Game Mode (Gamescope)' : 'Linux Desktop'}</span>
                      <span className="text-deck-dim">Electron Runtime</span><span className="font-mono text-white">{info.electron}</span>
                      <span className="text-deck-dim">Secret Storage</span><span className="text-white">{info.secureStorage}</span>
                      <span className="text-deck-dim">User Data Folder</span><span className="font-mono truncate text-white">{info.userData}</span>
                    </div>
                  </div>
                )}
              </div>
            </Section>
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
