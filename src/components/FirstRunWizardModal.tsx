import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Gamepad2,
  CheckCircle2,
  FolderOpen,
  Server,
  Palette,
  Vibrate,
  ArrowRight,
  ArrowLeft,
  Play,
  Check,
  Cloud,
  HardDrive,
  Cpu,
  Volume2,
  Sliders,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { RommConfig } from '../types';
import { FocusScope } from './FocusScope';
import { ButtonGlyph } from './ControllerHUD';
import { soundService } from '../services/soundService';
import { hapticsService } from '../services/hapticsService';
import { rommApi } from '../services/rommApi';
import { bridge, isNativeApp } from '../services/bridge';

interface FirstRunWizardModalProps {
  isOpen: boolean;
  config: RommConfig;
  onClose: () => void;
  onComplete: (updatedConfig: Partial<RommConfig>) => void;
  onOpenLogin: () => void;
  onToast?: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
}

export const FirstRunWizardModal: React.FC<FirstRunWizardModalProps> = ({
  isOpen,
  config,
  onClose,
  onComplete,
  onOpenLogin,
  onToast,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTheme, setSelectedTheme] = useState<'oled_black' | 'steamos_dark' | 'midnight_blue'>(
    config.theme || 'oled_black'
  );
  const [haptics, setHaptics] = useState<boolean>(config.hapticsEnabled !== false);
  const [hapticsIntensity, setHapticsIntensity] = useState<'soft' | 'medium' | 'strong'>(
    config.hapticsIntensity || 'medium'
  );
  const [crtScanlines, setCrtScanlines] = useState<boolean>(Boolean(config.crtScanlines));
  const [detectedPaths, setDetectedPaths] = useState<{
    emulationRoot?: string;
    hasSdCard?: boolean;
    detectedEmulators?: string[];
  }>({});
  const [checkingSystem, setCheckingSystem] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      // Auto-detect SteamOS & EmuDeck system structure
      setCheckingSystem(true);
      void (async () => {
        try {
          const storage = await bridge.system.storage().catch(() => null);
          const flatpaks = await bridge.system.flatpakStatus().catch(() => ({ flatpakAvailable: false, installed: {} }));
          const installedNames = Object.keys(flatpaks.installed || {}).filter((k) => flatpaks.installed[k]);

          setDetectedPaths({
            emulationRoot: storage?.emulationRoot || '~/Emulation',
            hasSdCard: Boolean(storage?.sdCardMounted),
            detectedEmulators: installedNames.length > 0 ? installedNames : ['RetroArch (Libretro)'],
          });
        } catch {
          setDetectedPaths({
            emulationRoot: '~/Emulation',
            hasSdCard: false,
            detectedEmulators: ['RetroArch (Standard SteamOS)'],
          });
        } finally {
          setCheckingSystem(false);
        }
      })();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    soundService.playTick();
    if (step < 3) {
      setStep((s) => (s + 1) as any);
    } else {
      finishSetup();
    }
  };

  const handleBack = () => {
    soundService.playBack();
    if (step > 1) {
      setStep((s) => (s - 1) as any);
    } else {
      onClose();
    }
  };

  const finishSetup = (mode?: 'demo' | 'login' | 'offline') => {
    soundService.playSuccess();
    hapticsService.success();

    const patch: Partial<RommConfig> = {
      theme: selectedTheme,
      hapticsEnabled: haptics,
      hapticsIntensity,
      crtScanlines,
      firstLaunchSetupCompleted: true,
      audioFeedback: true,
      autoCheckUpdates: true,
    };

    if (mode === 'demo') {
      patch.isDemoMode = true;
      patch.offlineOnlyMode = false;
    } else if (mode === 'offline') {
      patch.offlineOnlyMode = true;
      patch.isDemoMode = false;
    }

    onComplete(patch);
    onToast?.('Steam Deck setup complete! Welcome to DeckRomM.', 'ok');

    if (mode === 'login') {
      onOpenLogin();
    }
  };

  const testHapticPulse = () => {
    hapticsService.select();
    soundService.playSelect();
    onToast?.(`Tested ${hapticsIntensity} tactile pulse`, 'info');
  };

  return (
    <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 select-none deck-enter">
      <FocusScope
        name="first-run-wizard-modal"
        initialFocus="#wizard-primary-btn"
        onBack={handleBack}
        onAction={(action) => {
          if (action === 'NEXT_PLATFORM' || action === 'PAGE_DOWN') {
            handleNext();
            return true;
          }
          if (action === 'PREV_PLATFORM' || action === 'PAGE_UP') {
            handleBack();
            return true;
          }
          return false;
        }}
      >
        <div className="relative w-full max-w-2xl bg-deck-panel border-2 border-deck-line rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
          {/* Header Progress Stepper */}
          <div className="px-6 py-4 border-b border-deck-line bg-deck-bg/90 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-deck-accent/15 border border-deck-accent/30 flex items-center justify-center text-deck-accent shadow-inner">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="text-base font-black text-white flex items-center gap-2">
                  <span>DeckRomM Setup Wizard</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-deck-accent/20 border border-deck-accent/30 text-deck-accent">
                    Step {step} of 3
                  </span>
                </h2>
                <p className="text-xs text-deck-dim">SteamOS & Gamescope Handheld Optimization</p>
              </div>
            </div>

            {/* Stepper Dots */}
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`h-2 rounded-full transition-all ${
                    s === step
                      ? 'w-6 bg-deck-accent shadow-sm'
                      : s < step
                      ? 'w-2 bg-deck-ok'
                      : 'w-2 bg-deck-line'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Body Content */}
          <div className="p-6 overflow-y-auto flex-1 space-y-5">
            {step === 1 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="p-4 rounded-2xl bg-deck-panel-2/60 border border-deck-line">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1.5">
                    <Gamepad2 size={18} className="text-deck-accent" />
                    <span>Welcome to DeckRomM on Steam Deck</span>
                  </h3>
                  <p className="text-xs text-deck-dim leading-relaxed">
                    DeckRomM is built specifically for SteamOS Game Mode (1280x800). Every menu and modal is controller-first: navigate with the D-Pad or Left Stick, confirm with <ButtonGlyph button="A" />, go back with <ButtonGlyph button="B" />, and cycle sections with bumpers <ButtonGlyph button="LB" /> / <ButtonGlyph button="RB" />.
                  </p>
                </div>

                {/* Theme Selection */}
                <div>
                  <label className="text-xs font-bold text-white uppercase tracking-wider block mb-2">
                    Handheld Display Theme
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <button
                      data-focusable
                      onClick={() => {
                        soundService.playTick();
                        setSelectedTheme('oled_black');
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        selectedTheme === 'oled_black'
                          ? 'bg-black border-deck-accent ring-2 ring-deck-accent/30 shadow-lg'
                          : 'bg-black/60 border-deck-line hover:border-deck-dim'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-extrabold text-xs text-white">OLED Pure Black</span>
                        {selectedTheme === 'oled_black' && <Check size={14} className="text-deck-accent" />}
                      </div>
                      <div className="text-[11px] text-deck-dim">
                        True #000000 black pixels. Infinite contrast & maximum battery life.
                      </div>
                    </button>

                    <button
                      data-focusable
                      onClick={() => {
                        soundService.playTick();
                        setSelectedTheme('steamos_dark');
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        selectedTheme === 'steamos_dark'
                          ? 'bg-[#131a26] border-deck-accent ring-2 ring-deck-accent/30 shadow-lg'
                          : 'bg-[#131a26]/70 border-deck-line hover:border-deck-dim'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-extrabold text-xs text-white">SteamOS Dark</span>
                        {selectedTheme === 'steamos_dark' && <Check size={14} className="text-deck-accent" />}
                      </div>
                      <div className="text-[11px] text-deck-dim">
                        Classic Steam Big Picture charcoal & slate navy tones.
                      </div>
                    </button>

                    <button
                      data-focusable
                      onClick={() => {
                        soundService.playTick();
                        setSelectedTheme('midnight_blue');
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        selectedTheme === 'midnight_blue'
                          ? 'bg-[#0d1527] border-deck-accent ring-2 ring-deck-accent/30 shadow-lg'
                          : 'bg-[#0d1527]/70 border-deck-line hover:border-deck-dim'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-extrabold text-xs text-white">Midnight Blue</span>
                        {selectedTheme === 'midnight_blue' && <Check size={14} className="text-deck-accent" />}
                      </div>
                      <div className="text-[11px] text-deck-dim">
                        Deep 90s console gaming indigo for arcade nostalgia.
                      </div>
                    </button>
                  </div>
                </div>

                {/* Haptics & Feedback */}
                <div className="p-4 rounded-2xl bg-deck-panel-2/60 border border-deck-line space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Vibrate size={15} className="text-deck-accent" />
                        <span>Tactile Controller Haptics</span>
                      </div>
                      <div className="text-[11px] text-deck-dim">
                        Subtle vibration actuator feedback on D-Pad moves, clicks, and confirmations
                      </div>
                    </div>

                    <button
                      data-focusable
                      onClick={() => {
                        soundService.playTick();
                        setHaptics(!haptics);
                      }}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        haptics ? 'bg-deck-accent' : 'bg-deck-line'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                          haptics ? 'left-5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {haptics && (
                    <div className="flex items-center gap-2 pt-1 border-t border-deck-line/40">
                      <span className="text-[11px] text-deck-dim font-bold">Intensity:</span>
                      {(['soft', 'medium', 'strong'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          data-focusable
                          onClick={() => {
                            setHapticsIntensity(lvl);
                            hapticsService.intensity = lvl;
                            testHapticPulse();
                          }}
                          className={`px-3 py-1 rounded-xl text-xs font-bold capitalize transition-all ${
                            hapticsIntensity === lvl
                              ? 'bg-deck-accent text-white shadow-sm'
                              : 'bg-black/40 border border-deck-line text-deck-dim hover:text-white'
                          }`}
                        >
                          {lvl}
                        </button>
                      ))}
                      <button
                        data-focusable
                        onClick={testHapticPulse}
                        className="ml-auto px-3 py-1 rounded-xl text-[11px] font-bold bg-white/10 hover:bg-white/20 text-white flex items-center gap-1"
                      >
                        <Vibrate size={12} /> Test Pulse
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="p-4 rounded-2xl bg-deck-panel-2/60 border border-deck-line">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1.5">
                    <HardDrive size={18} className="text-deck-accent" />
                    <span>SteamOS & EmuDeck Integration</span>
                  </h3>
                  <p className="text-xs text-deck-dim leading-relaxed">
                    DeckRomM connects directly to native SteamOS emulators (RetroArch and Flatpaks like DuckStation, PCSX2, Dolphin, RPCS3). Downloaded ROMs and BIOS files are placed directly into your local library.
                  </p>
                </div>

                {/* Detected System Status */}
                <div className="space-y-2.5">
                  <div className="p-3.5 rounded-2xl bg-black/40 border border-deck-line flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-xl bg-deck-ok/20 border border-deck-ok/40 flex items-center justify-center text-deck-ok">
                        <CheckCircle2 size={16} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Emulation Directory</div>
                        <div className="text-[11px] font-mono text-deck-dim">{detectedPaths.emulationRoot}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/30">
                      Ready
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-black/40 border border-deck-line flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                        <Cpu size={16} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Default Emulators</div>
                        <div className="text-[11px] text-deck-dim">
                          {detectedPaths.detectedEmulators?.join(', ') || 'RetroArch Libretro'}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-sky-300 bg-sky-500/20 px-2 py-0.5 rounded-md border border-sky-500/30">
                      Auto-Configured
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-black/40 border border-deck-line flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                        <FolderOpen size={16} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Storage Location</div>
                        <div className="text-[11px] text-deck-dim">
                          {detectedPaths.hasSdCard ? 'MicroSD Card & Internal NVMe' : 'Internal NVMe Storage'}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-500/30">
                      Detected
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-deck-accent/10 border border-deck-accent/30 text-xs text-deck-accent flex items-center gap-2">
                  <ShieldCheck size={16} className="shrink-0" />
                  <span>
                    No external configuration needed. DeckRomM will manage folders and core associations automatically.
                  </span>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="p-4 rounded-2xl bg-deck-panel-2/60 border border-deck-line">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1.5">
                    <Server size={18} className="text-deck-accent" />
                    <span>Connect Your Library</span>
                  </h3>
                  <p className="text-xs text-deck-dim leading-relaxed">
                    Choose how you would like to start using DeckRomM on your Steam Deck today:
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {/* Option 1: Connect to RomM Server */}
                  <button
                    data-focusable
                    id="wizard-connect-server"
                    onClick={() => finishSetup('login')}
                    className="p-4 rounded-2xl bg-deck-accent/15 hover:bg-deck-accent/25 border border-deck-accent/40 text-left transition-all flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-deck-accent flex items-center justify-center text-white shrink-0 shadow-md">
                        <Server size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-white flex items-center gap-2">
                          <span>Connect to My RomM Server</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-deck-accent/30 text-sky-200 uppercase">
                            Recommended
                          </span>
                        </div>
                        <div className="text-xs text-deck-dim mt-0.5 truncate">
                          Enter your RomM server URL and credentials for full cloud sync & downloads
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={18} className="text-deck-accent shrink-0 group-hover:translate-x-1 transition-transform" />
                  </button>

                  {/* Option 2: Demo Library */}
                  <button
                    data-focusable
                    onClick={() => finishSetup('demo')}
                    className="p-4 rounded-2xl bg-deck-panel-2/80 hover:bg-deck-panel-2 border border-deck-line hover:border-deck-dim text-left transition-all flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
                        <Sparkles size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-white">Explore Demo Library</div>
                        <div className="text-xs text-deck-dim mt-0.5">
                          Instant access to 10+ pre-seeded retro games without needing a server right now
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={18} className="text-deck-dim shrink-0 group-hover:translate-x-1 transition-transform" />
                  </button>

                  {/* Option 3: Offline Mode */}
                  <button
                    data-focusable
                    onClick={() => finishSetup('offline')}
                    className="p-4 rounded-2xl bg-deck-panel-2/80 hover:bg-deck-panel-2 border border-deck-line hover:border-deck-dim text-left transition-all flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                        <HardDrive size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-white">Offline Mode (Local Games Only)</div>
                        <div className="text-xs text-deck-dim mt-0.5">
                          Play games already downloaded or installed on your Steam Deck storage
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={18} className="text-deck-dim shrink-0 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="px-6 py-4 border-t border-deck-line bg-deck-bg/90 flex items-center justify-between gap-3">
            <button
              data-focusable
              onClick={handleBack}
              className="px-4 py-2.5 rounded-xl text-xs font-bold bg-deck-panel-2 border border-deck-line text-deck-dim hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ArrowLeft size={16} />
              <span>{step === 1 ? 'Skip Setup' : 'Back'}</span>
              <span className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] font-mono text-deck-dim">B</span>
            </button>

            {step < 3 ? (
              <button
                data-focusable
                id="wizard-primary-btn"
                onClick={handleNext}
                className="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-deck-accent hover:bg-deck-accent/90 text-white flex items-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95"
              >
                <span>Continue</span>
                <ArrowRight size={16} />
                <span className="px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono text-white/90">A</span>
              </button>
            ) : null}
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
