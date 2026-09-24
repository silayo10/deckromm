import React, { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, HardDrive, Info, LogIn, LogOut, Server, SlidersHorizontal, Gamepad2 } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { RommConfig } from '../types';
import { AppInfo, AuthStatus, NativeStorage } from '../env/electron';
import { bridge, isNativeApp } from '../services/bridge';
import { formatBytes } from './GameCard';

interface SettingsScreenProps {
  config: RommConfig;
  auth: AuthStatus;
  onChange: (patch: Partial<RommConfig>) => void;
  onClose: () => void;
  onSignIn: () => void;
  onLogout: () => void;
}

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
export const SettingsScreen: React.FC<SettingsScreenProps> = ({ config, auth, onChange, onClose, onSignIn, onLogout }) => {
  const [storage, setStorage] = useState<NativeStorage | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [emuPath, setEmuPath] = useState(config.emulationPath || '');
  const [customCmd, setCustomCmd] = useState(config.customLaunchCommand || '');

  useEffect(() => {
    if (!isNativeApp) return;
    bridge.system.storage().then(setStorage).catch(() => {});
    bridge.app.info().then(setInfo).catch(() => {});
  }, [config.emulationPath]);

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

            <Section icon={<SlidersHorizontal size={16} />} title="Library">
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
    </div>
  );
};
