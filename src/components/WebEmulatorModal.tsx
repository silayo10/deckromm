import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Game, SaveState, OverlayButtonCombo, EmulatorAspectRatio, ControllerConfig } from '../types';
import {
  X,
  Play,
  RotateCcw,
  Save,
  Volume2,
  VolumeX,
  Tv,
  Maximize2,
  Minimize2,
  Sparkles,
  Sliders,
  FolderOpen,
  Gamepad2,
  Download,
  AlertCircle,
  Rocket,
  RefreshCw,
  Layers,
  CheckCircle2,
  Monitor,
} from 'lucide-react';
import { gamepadService } from '../services/gamepadService';
import { soundService } from '../services/soundService';
import { focusManager } from '../services/focusManager';
import { InGameOverlayMenu } from './InGameOverlayMenu';
import { cacheStorage } from '../services/cacheStorage';
import { rommApi, getEmulatorCore } from '../services/rommApi';
import { isNativeApp } from '../services/bridge';
import { loadMergedStates, uploadSlot, ensureStateData, deleteSlot, markPlayed, cloudSyncAvailable } from '../services/cloudSaves';
import { planStartup, uploadSram, recordLocalChange, bytesEqual, sramSyncAvailable, type SramStatus } from '../services/sramSync';

export interface ConsoleAspectConfig {
  ratio: string;
  cssAspect: string;
  label: string;
  resolution: string;
  pillarboxWidth: string;
}

export function getConsoleAspectConfig(platformSlug: string): ConsoleAspectConfig {
  const slug = (platformSlug || '').toLowerCase();
  if (slug.includes('gba') || slug === 'gameboyadvance') {
    return {
      ratio: '3:2',
      cssAspect: 'aspect-[3/2]',
      label: 'Game Boy Advance (3:2)',
      resolution: '240 × 160 Native',
      pillarboxWidth: 'w-auto max-w-[150vh] max-h-screen',
    };
  }
  if (
    slug === 'gb' ||
    slug === 'gbc' ||
    slug.includes('gameboy') ||
    slug === 'gg' ||
    slug === 'gamegear'
  ) {
    return {
      ratio: '10:9',
      cssAspect: 'aspect-[10/9]',
      label: 'Game Boy (10:9)',
      resolution: '160 × 144 Native',
      pillarboxWidth: 'w-auto max-w-[111vh] max-h-screen',
    };
  }
  if (slug === 'psp') {
    return {
      ratio: '16:9',
      cssAspect: 'aspect-[16/9]',
      label: 'PlayStation Portable (16:9)',
      resolution: '480 × 272 Native',
      pillarboxWidth: 'w-auto max-w-[177vh] max-h-screen',
    };
  }
  if (slug === 'nds' || slug === 'ds') {
    return {
      ratio: '4:3',
      cssAspect: 'aspect-[4/3]',
      label: 'Nintendo DS (4:3)',
      resolution: '256 × 384 Native',
      pillarboxWidth: 'w-auto max-w-[133.3vh] max-h-screen',
    };
  }
  // Default for NES, SNES, Genesis, Master System, PS1, N64, Saturn, TG16, Arcade, NeoGeo, Atari: 4:3
  return {
    ratio: '4:3',
    cssAspect: 'aspect-[4/3]',
    label: 'Native 4:3 CRT',
    resolution: 'Native 4:3 Pillarbox',
    pillarboxWidth: 'w-auto max-w-[133.3vh] max-h-screen',
  };
}

interface WebEmulatorModalProps {
  game: Game | null;
  onClose: () => void;
  onLaunchNative?: (game: Game) => void;
  /** Called with the server's last_played timestamp once the game starts. */
  onPlayed?: (game: Game, lastPlayed: string) => void;
}

export const WebEmulatorModal: React.FC<WebEmulatorModalProps> = ({ game, ...rest }) =>
  game ? <WebEmulatorPlayer game={game} {...rest} /> : null;

/** Messages the parent can send into the EmulatorJS iframe (see bridge script in the srcdoc). */
type EmuCommand = 'SAVE_STATE' | 'LOAD_STATE' | 'RESTART' | 'PAUSE' | 'RESUME' | 'SET_VOLUME' | 'SET_SPEED' | 'STATUS' | 'GET_SRAM' | 'PUT_SRAM';

const WebEmulatorPlayer: React.FC<WebEmulatorModalProps & { game: Game }> = ({
  game,
  onClose,
  onLaunchNative,
  onPlayed,
}) => {

  // Emulation & Loading State
  const [loadStatus, setLoadStatus] = useState<'checking' | 'downloading' | 'ready' | 'error'>(
    'checking'
  );
  const [downloadPct, setDownloadPct] = useState<number>(0);
  const [downloadSpeed, setDownloadSpeed] = useState<number>(0);
  const [downloadLoaded, setDownloadLoaded] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [romBlobUrl, setRomBlobUrl] = useState<string | null>(null);
  const [isCachedLocally, setIsCachedLocally] = useState<boolean>(false);
  const [nativeStatus, setNativeStatus] = useState<string | null>(null);

  // In-Game Overlay & Player Settings
  const [isOverlayOpen, setIsOverlayOpen] = useState<boolean>(false);
  const [crtFilterMode, setCrtFilterMode] = useState<'off' | 'subtle' | 'arcade' | 'phosphor'>(
    'off'
  );
  // Default to native platform aspect ratio (with side pillarbox bars)
  const [aspectRatio, setAspectRatio] = useState<EmulatorAspectRatio>('native');
  const [turboSpeed, setTurboSpeed] = useState<number>(1);
  const [volume, setVolume] = useState<number>(85);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showFps, setShowFps] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(60);
  const [selectedSlot, setSelectedSlot] = useState<number>(1);
  const [buttonCombo, setButtonCombo] = useState<OverlayButtonCombo>('select_start');
  const [showComboToast, setShowComboToast] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // In-Game Controller & Button Remapping Configuration
  const [controllerConfig, setControllerConfig] = useState<ControllerConfig>(() => {
    try {
      const saved = localStorage.getItem('deckromm_controls');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      layoutPreset: 'nintendo',
      swapAB: false,
      swapXY: false,
      leftStickAsDpad: true,
      deadzone: 0.25,
      turboTrigger: 'rt',
    };
  });

  const handleUpdateControllerConfig = useCallback((cfg: ControllerConfig) => {
    setControllerConfig(cfg);
    try {
      localStorage.setItem('deckromm_controls', JSON.stringify(cfg));
    } catch {}
    setToastMessage('Controls updated');
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  // Auto-hiding Floating HUD
  const [isHudVisible, setIsHudVisible] = useState<boolean>(true);
  const hudTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Target core for this game
  const emulatorCore = getEmulatorCore(game.platformSlug, game.fileName);
  const consoleConfig = getConsoleAspectConfig(game.platformSlug);

  // Save states: real emulator memory snapshots persisted per game+slot in IndexedDB
  const [saveStates, setSaveStates] = useState<Record<number, SaveState>>({});
  const [stateBusy, setStateBusy] = useState(false);
  const stateBusyRef = useRef(false);
  stateBusyRef.current = stateBusy;
  const [emuStarted, setEmuStarted] = useState(false);

  const [cloudExtras, setCloudExtras] = useState<SaveState[]>([]);
  const [cloudStatus, setCloudStatus] = useState<'off' | 'checking' | 'ok' | 'offline'>(cloudSyncAvailable ? 'checking' : 'off');

  const refreshStates = useCallback(async () => {
    const merged = await loadMergedStates(game, emulatorCore, 5);
    setSaveStates(merged.slots);
    setCloudExtras(merged.extras);
    if (cloudSyncAvailable) setCloudStatus(merged.cloudOk ? 'ok' : 'offline');
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, emulatorCore]);

  useEffect(() => {
    let alive = true;
    // Metadata-only entries written by v1.1.0 cannot be restored; drop them.
    try {
      localStorage.removeItem(`deckromm_saves_${game.id}`);
    } catch {}
    (async () => {
      const merged = await refreshStates();
      if (!alive || !merged.cloudOk) return;
      // Upload anything saved offline (or before 1.2.0) that RomM does not have yet.
      const todo = Object.values(merged.slots).filter((st) => st.data && (st.pendingUpload || !st.cloudId) && st.source !== 'cloud');
      let uploaded = 0;
      for (const st of todo) {
        const r = await uploadSlot(game, emulatorCore, st);
        if (r.ok) uploaded++;
      }
      if (alive && uploaded) {
        await refreshStates();
        triggerToast(`Synced ${uploaded} save${uploaded > 1 ? 's' : ''} to RomM`);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, refreshStates]);

  // Request/response channel into the EmulatorJS iframe
  const pendingRef = useRef(new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>());
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
      if (d.type === 'DECK_EMU_STARTED') {
        setEmuStarted(true);
        markPlayed(game).then((ts) => ts && onPlayed?.(game, ts));
        return;
      }
      if (d.type !== 'DECK_EMU_REPLY' || !d.reqId) return;
      const p = pendingRef.current.get(d.reqId);
      if (!p) return;
      pendingRef.current.delete(d.reqId);
      window.clearTimeout(p.timer);
      if (d.ok) p.resolve(d);
      else p.reject(new Error(d.message || 'Emulator did not respond'));
    };
    window.addEventListener('message', onMsg);
    const pending = pendingRef.current;
    return () => {
      window.removeEventListener('message', onMsg);
      for (const p of pending.values()) window.clearTimeout(p.timer);
      pending.clear();
    };
  }, []);

  const callEmu = useCallback((cmd: EmuCommand, payload: Record<string, unknown> = {}, timeoutMs = 6000, transfer?: Transferable[]) => {
    return new Promise<any>((resolve, reject) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return reject(new Error('Emulator is not running'));
      const reqId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(reqId);
        reject(new Error('Emulator did not respond in time'));
      }, timeoutMs);
      pendingRef.current.set(reqId, { resolve, reject, timer });
      win.postMessage({ type: 'DECK_EMU_CMD', cmd, reqId, ...payload }, '*', transfer || []);
    });
  }, []);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2800);
  };

  // Reset HUD visibility timer (auto-hides after 4 seconds of idle gameplay)
  const resetHudTimer = useCallback(() => {
    setIsHudVisible(true);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => {
      setIsHudVisible(false);
    }, 4000);
  }, []);

  useEffect(() => {
    resetHudTimer();
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [resetHudTimer]);

  // Auto-hide the "Press Select+Start" notification after 5 seconds
  useEffect(() => {
    if (loadStatus === 'ready') {
      setShowComboToast(true);
      const timer = setTimeout(() => {
        setShowComboToast(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [loadStatus]);

  // 1. Point EmulatorJS at the ROM. In the desktop app the ROM is streamed from
  //    RomM through the romm-rom:// protocol straight into the emulator's memory:
  //    no copy lands in the roms folder or IndexedDB. EmulatorJS shows its own
  //    download progress while it fetches the file.
  const prepareRom = useCallback(async () => {
    setLoadStatus('checking');
    setErrorMessage(null);
    setDownloadPct(0);

    if (isNativeApp) {
      setRomBlobUrl(rommApi.streamUrl(game));
      setIsCachedLocally(false);
      setLoadStatus('ready');
      soundService.playSuccess();
      return;
    }

    // Browser preview / demo mode: fetch into memory (no main process available).
    try {
      setLoadStatus('downloading');
      const blob = await rommApi.downloadRom(game, (pct, loadedBytes, speedMbps) => {
        setDownloadPct(pct);
        setDownloadLoaded(loadedBytes);
        setDownloadSpeed(speedMbps);
      });

      const url = URL.createObjectURL(blob);
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      activeBlobUrlRef.current = url;
      setRomBlobUrl(url);
      setLoadStatus('ready');
      soundService.playSuccess();
    } catch (err: any) {
      console.error('ROM preparation error:', err);
      setErrorMessage(
        err.message ||
          'Failed to load the ROM from the RomM server. Please verify your connection or API token.'
      );
      setLoadStatus('error');
      soundService.playBack();
    }
  }, [game]);

  useEffect(() => {
    prepareRom();
    return () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, [prepareRom]);

  // Focus manager for the emulator iframe and canvas
  const focusIframe = useCallback(() => {
    if (iframeRef.current) {
      try {
        iframeRef.current.focus();
        iframeRef.current.contentWindow?.focus();
      } catch (err) {}
    }
  }, []);

  // Aggressively guarantee controller focus on the game during boot and when resuming from overlay
  useEffect(() => {
    if (loadStatus === 'ready' && !isOverlayOpen) {
      focusIframe();
      const t1 = setTimeout(focusIframe, 150);
      const t2 = setTimeout(focusIframe, 400);
      const t3 = setTimeout(focusIframe, 900);
      const t4 = setTimeout(focusIframe, 1800);
      const t5 = setTimeout(focusIframe, 3000);
      
      const interval = setInterval(() => {
        if (!isOverlayOpen && document.activeElement !== iframeRef.current) {
          focusIframe();
        }
      }, 1500);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
        clearTimeout(t5);
        clearInterval(interval);
      };
    }
  }, [loadStatus, isOverlayOpen, focusIframe]);

  // Sync with Gamepad Service Emulation Mode & Focus Management
  useEffect(() => {
    gamepadService.setEmulationMode(true, isOverlayOpen);
    gamepadService.setOverlayCombo(buttonCombo);
    // When playing in browser and overlay is closed, disable library focusManager
    // so no DOM elements take focus rings or borders during streaming
    if (loadStatus === 'ready' && !isOverlayOpen) {
      focusManager.setEnabled(false);
    } else {
      focusManager.setEnabled(true);
    }
    return () => {
      gamepadService.setEmulationMode(false, false);
      focusManager.setEnabled(true);
    };
  }, [loadStatus, isOverlayOpen, buttonCombo]);

  // Listen for Overlay Toggle Action & sync controller state to the iframe at 60Hz
  useEffect(() => {
    const handleNav = (action: string) => {
      if (action === 'TOGGLE_OVERLAY') {
        setIsOverlayOpen((prev) => {
          const next = !prev;
          if (!next) {
            // Re-focus game on close
            setTimeout(focusIframe, 100);
          }
          return next;
        });
      }
    };
    const unsubscribe = gamepadService.addListener(handleNav as any);

    const sendSync = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'SYNC_GAMEPAD',
            state: gamepadService.currentState,
            controls: controllerConfig,
          },
          '*'
        );
      }
    };

    // Immediate dispatch on state change
    const unsubState = gamepadService.addStateListener(() => {
      sendSync();
    });

    // 60Hz heartbeat to ensure the emulator poller continuously receives fresh gamepad timestamps & stick positions
    const syncInterval = window.setInterval(sendSync, 16);

    return () => {
      unsubscribe();
      unsubState();
      window.clearInterval(syncInterval);
    };
  }, [focusIframe, controllerConfig]);


  // ---- In-game save (SRAM) sync with RomM ----------------------------------
  // Polls the core's battery save every few seconds; a change that is stable for
  // two polls (so a half-written save is never sent) is stored on the Deck and
  // uploaded to RomM. On start the newest RomM save is loaded into the core.
  const [sramStatus, setSramStatus] = useState<SramStatus>({ state: sramSyncAvailable ? 'checking' : 'off' });
  const sramRef = useRef({
    ready: false,
    lastSynced: null as Uint8Array | null,
    prevTick: null as Uint8Array | null,
    uploading: false,
    retryAt: 0,
  });

  const readSram = useCallback(
    async (flush = true, withShot = false): Promise<{ bytes: Uint8Array | null; screenshot?: string }> => {
      const r = await callEmu('GET_SRAM', { flush, withShot }, 6000);
      const bytes = r.sram ? (r.sram instanceof Uint8Array ? r.sram : new Uint8Array(r.sram)) : null;
      return { bytes: bytes && bytes.byteLength ? bytes : null, screenshot: r.screenshot };
    },
    [callEmu]
  );

  const pushSram = useCallback(
    async (bytes: Uint8Array, why: 'tick' | 'exit' | 'manual' | 'startup') => {
      const S = sramRef.current;
      if (S.uploading) return false;
      S.uploading = true;
      setSramStatus((p) => ({ ...p, state: 'syncing' }));
      try {
        let shot: string | undefined;
        if (why !== 'exit') {
          try {
            shot = (await readSram(false, true)).screenshot;
          } catch {}
        }
        const r = await uploadSram(game, emulatorCore, bytes, shot);
        setSramStatus(r.status);
        if (r.ok) {
          S.lastSynced = bytes;
          S.retryAt = 0;
          if (why !== 'exit') triggerToast('Game save synced to RomM');
        } else {
          S.retryAt = Date.now() + 30000;
          if (why === 'manual' || why === 'tick') triggerToast(`Game saved on this Deck. RomM sync failed, will retry: ${r.status.message || 'server unreachable'}`);
        }
        return r.ok;
      } finally {
        S.uploading = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, emulatorCore, readSram]
  );

  // Startup: reconcile the core's save with RomM once the game is running.
  useEffect(() => {
    if (!emuStarted) return;
    let alive = true;
    (async () => {
      let emuBytes: Uint8Array | null = null;
      let reachable = false;
      for (let i = 0; i < 25 && alive; i++) {
        try {
          emuBytes = (await readSram(true)).bytes;
          reachable = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      if (!alive || !reachable) return;
      const plan = await planStartup(game, emulatorCore, emuBytes);
      if (!alive) return;
      const S = sramRef.current;
      if (plan.action === 'inject') {
        try {
          const copy = new Uint8Array(plan.bytes);
          await callEmu('PUT_SRAM', { sram: copy, restart: true }, 8000, [copy.buffer]);
          S.lastSynced = plan.bytes;
          S.prevTick = plan.bytes;
          if (plan.from === 'cloud') triggerToast('Loaded your game save from RomM');
        } catch (err: any) {
          triggerToast(`Could not load the RomM game save: ${err?.message || err}`);
        }
        setSramStatus(plan.status);
      } else if (plan.action === 'upload') {
        S.prevTick = plan.bytes;
        await pushSram(plan.bytes, 'startup');
      } else {
        S.lastSynced = emuBytes;
        S.prevTick = emuBytes;
        setSramStatus(plan.status);
      }
      S.ready = true;
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emuStarted, game.id]);

  // Periodic check for new in-game saves.
  useEffect(() => {
    if (!emuStarted) return;
    const timer = window.setInterval(async () => {
      const S = sramRef.current;
      if (!S.ready || S.uploading || stateBusyRef.current) return;
      let bytes: Uint8Array | null = null;
      try {
        bytes = (await readSram(true)).bytes;
      } catch {
        return;
      }
      if (!bytes) return;
      const stable = bytesEqual(bytes, S.prevTick);
      S.prevTick = bytes;
      if (!stable || bytesEqual(bytes, S.lastSynced)) return;
      if (!sramSyncAvailable) {
        await recordLocalChange(game, bytes);
        S.lastSynced = bytes;
        return;
      }
      if (S.retryAt && Date.now() < S.retryAt) {
        await recordLocalChange(game, bytes);
        setSramStatus({ state: 'pending' });
        return;
      }
      await pushSram(bytes, 'tick');
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emuStarted, game.id, readSram, pushSram]);

  /** Sync now (overlay "In-Game Save" row). */
  const handleSyncSram = useCallback(async () => {
    try {
      const { bytes } = await readSram(true);
      if (!bytes) {
        triggerToast('This game has not written an in-game save yet');
        return;
      }
      if (bytesEqual(bytes, sramRef.current.lastSynced) && sramStatus.state === 'synced') {
        triggerToast('Game save is already on RomM');
        return;
      }
      sramRef.current.retryAt = 0;
      await pushSram(bytes, 'manual');
    } catch (err: any) {
      triggerToast(`Game save sync failed: ${err?.message || err}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readSram, pushSram, sramStatus.state]);

  // Leaving the game: upload a save the poll has not sent yet (bounded wait).
  const [exiting, setExiting] = useState(false);
  const handleExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    try {
      const S = sramRef.current;
      if (S.ready && emuStarted) {
        const flush = (async () => {
          const { bytes } = await readSram(true);
          if (!bytes || bytesEqual(bytes, S.lastSynced)) return;
          await recordLocalChange(game, bytes);
          if (sramSyncAvailable) {
            triggerToast('Syncing game save to RomM...');
            await pushSram(bytes, 'exit');
          }
        })().catch(() => {});
        await Promise.race([flush, new Promise((r) => setTimeout(r, 6000))]);
      }
    } finally {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting, emuStarted, readSram, pushSram, game, onClose]);

  // Save State: capture real emulator memory, keep it on the Deck, then sync to RomM
  const handleSaveState = useCallback(
    async (slot: number) => {
      if (stateBusy) return;
      setStateBusy(true);
      try {
        const res = await callEmu('SAVE_STATE');
        const bytes: Uint8Array = res.state instanceof Uint8Array ? res.state : new Uint8Array(res.state);
        if (!bytes || bytes.byteLength === 0) throw new Error('Emulator returned an empty state');
        const prev = saveStates[slot];
        const stateObj: SaveState = {
          slot,
          gameId: game.id,
          timestamp: Date.now(),
          screenshot: typeof res.screenshot === 'string' && res.screenshot.length > 64 ? res.screenshot : game.coverUrl || '',
          data: bytes,
          cloudId: prev?.cloudId,
          pendingUpload: cloudSyncAvailable,
          source: 'local',
        };
        await cacheStorage.saveGameState(stateObj);
        setSaveStates((p) => ({ ...p, [slot]: stateObj }));
        soundService.playSuccess();
        if (!cloudSyncAvailable) {
          triggerToast(`Saved to slot ${slot}`);
          return;
        }
        triggerToast(`Saved to slot ${slot}. Syncing to RomM...`);
        const up = await uploadSlot(game, emulatorCore, stateObj);
        setSaveStates((p) => ({ ...p, [slot]: up.state }));
        if (up.ok) {
          setCloudStatus('ok');
          triggerToast(`Saved to slot ${slot} and synced to RomM`);
        } else {
          setCloudStatus('offline');
          triggerToast(`Saved on this Deck. RomM sync failed, will retry: ${up.message || 'server unreachable'}`);
        }
      } catch (err: any) {
        soundService.playBack();
        triggerToast(`Save failed: ${err?.message || err}`);
      } finally {
        setStateBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, callEmu, stateBusy, saveStates, emulatorCore]
  );

  const restoreState = useCallback(
    async (st: SaveState | undefined, label: string, cacheAsSlot: boolean) => {
      if (!st) {
        soundService.playBack();
        triggerToast(`${label} is empty`);
        return;
      }
      if (stateBusy) return;
      setStateBusy(true);
      try {
        let full = st;
        if (!st.data) {
          triggerToast(`Downloading ${label.toLowerCase()} from RomM...`);
          full = await ensureStateData(game, st, cacheAsSlot);
          if (cacheAsSlot) setSaveStates((p) => ({ ...p, [st.slot]: full }));
        }
        const src: Uint8Array = full.data instanceof Uint8Array ? full.data : new Uint8Array(full.data);
        const copy = new Uint8Array(src); // transfer a copy so the cached bytes stay usable
        await callEmu('LOAD_STATE', { state: copy }, 8000, [copy.buffer]);
        // A state carries its own SRAM; treat it as the new baseline instead of a fresh in-game save.
        window.setTimeout(async () => {
          try {
            const { bytes } = await readSram(true);
            sramRef.current.prevTick = bytes;
            if (bytes && !sramRef.current.lastSynced) sramRef.current.lastSynced = bytes;
          } catch {}
        }, 600);
        soundService.playSelect();
        triggerToast(`Loaded ${label.toLowerCase()}`);
        setIsOverlayOpen(false);
        setTimeout(focusIframe, 100);
      } catch (err: any) {
        soundService.playBack();
        triggerToast(`Load failed: ${err?.message || err}`);
      } finally {
        setStateBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, callEmu, stateBusy, focusIframe, readSram]
  );

  // Load State: push the stored memory snapshot back into the core (downloads it from RomM if needed)
  const handleLoadState = useCallback((slot: number) => restoreState(saveStates[slot], `Slot ${slot}`, true), [restoreState, saveStates]);

  // States made in RomM's web player or on other clients
  const handleLoadExtra = useCallback((index: number) => restoreState(cloudExtras[index], 'RomM save', false), [restoreState, cloudExtras]);

  // Delete State Action (this Deck and RomM)
  const handleDeleteState = useCallback(
    async (slot: number) => {
      const st = saveStates[slot];
      setSaveStates((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      soundService.playTick();
      const r = await deleteSlot(game, st, slot);
      triggerToast(r.ok ? `Slot ${slot} deleted` : `Slot ${slot} deleted here; RomM copy not removed: ${r.message || 'error'}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, saveStates]
  );

  // Restart the core in place (falls back to reloading the player)
  const handleResetGame = useCallback(async () => {
    try {
      await callEmu('RESTART', {}, 3000);
    } catch {
      if (iframeRef.current) {
        const currentSrc = iframeRef.current.srcdoc;
        iframeRef.current.srcdoc = '';
        setTimeout(() => {
          if (iframeRef.current) iframeRef.current.srcdoc = currentSrc;
        }, 50);
      }
    }
    soundService.playBack();
    triggerToast('Game restarted');
    setIsOverlayOpen(false);
    setTimeout(focusIframe, 100);
  }, [callEmu, focusIframe]);

  // Pause the core while the overlay is open; resume on close
  useEffect(() => {
    if (loadStatus !== 'ready' || !emuStarted) return;
    callEmu(isOverlayOpen ? 'PAUSE' : 'RESUME', {}, 2000).catch(() => {});
  }, [isOverlayOpen, loadStatus, emuStarted, callEmu]);

  // Volume / mute and fast-forward speed
  useEffect(() => {
    if (loadStatus !== 'ready' || !emuStarted) return;
    callEmu('SET_VOLUME', { volume: isMuted ? 0 : volume / 100 }, 2000).catch(() => {});
  }, [volume, isMuted, loadStatus, emuStarted, callEmu]);
  useEffect(() => {
    if (loadStatus !== 'ready' || !emuStarted) return;
    callEmu('SET_SPEED', { speed: turboSpeed }, 2000).catch(() => {});
  }, [turboSpeed, loadStatus, emuStarted, callEmu]);

  // Native SteamOS Launch Handler
  const handleLaunchNative = async () => {
    soundService.playSelect();
    setNativeStatus('Preparing native launch...');
    try {
      if (onLaunchNative) {
        onLaunchNative(game);
        setNativeStatus('Triggered native launch!');
        return;
      }

      const res = await rommApi.launchNative(game);
      if (res.success) {
        soundService.playSuccess();
        triggerToast(res.message);
        setNativeStatus(res.message);
      } else {
        triggerToast(res.message || 'Launch error');
        setNativeStatus(res.message);
      }
    } catch (err: any) {
      triggerToast(err.message);
      setNativeStatus(err.message);
    }
  };

  // Determine aspect ratio class
  const activeAspectClass =
    aspectRatio === 'native'
      ? consoleConfig.cssAspect
      : aspectRatio === '16:10'
      ? 'w-full h-full'
      : aspectRatio === '1:1'
      ? 'aspect-square h-full'
      : 'aspect-[4/3] h-full';

  // Construct EmulatorJS HTML source with Steam Deck Gamepad Controller Bridge
  const emulatorSrcDoc = romBlobUrl
    ? `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${game.title.replace(/[<>&"]/g, '')}</title>
  <style>
    *, *:focus, *:focus-visible, *:active {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      outline: none !important;
      outline-width: 0 !important;
      outline-color: transparent !important;
      -webkit-focus-ring-color: transparent !important;
      -webkit-tap-highlight-color: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }
    html, body {
      width: 100%;
      height: 100%;
      background: #000000;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      outline: none !important;
      border: none !important;
      box-shadow: none !important;
    }
    #game, #box, canvas, div, iframe {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none !important;
      outline-width: 0 !important;
      outline-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    canvas {
      outline: none !important;
      outline-width: 0 !important;
      outline-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    /* Hide EmulatorJS on-screen touch virtual controllers and keyboard prompts */
    .ejs_virtual_gamepad, .ejs_touch_controller, .ejs_controls_btn, .ejs_settings_controls {
      display: none !important;
    }
  </style>
  <script>
    let injectedGamepadState = null;
    let injectedControlsConfig = null;
    let prevMappedState = {};
    let gamepadConnectedDispatched = false;

    // Steam Deck Controller Button Keycodes for RetroArch WebAssembly
    const KEY_MAPPINGS = {
      dpadUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      dpadDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      dpadLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      dpadRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      a: { key: 'x', code: 'KeyX', keyCode: 88 },
      b: { key: 'z', code: 'KeyZ', keyCode: 90 },
      x: { key: 's', code: 'KeyS', keyCode: 83 },
      y: { key: 'a', code: 'KeyA', keyCode: 65 },
      lb: { key: 'q', code: 'KeyQ', keyCode: 81 },
      rb: { key: 'w', code: 'KeyW', keyCode: 87 },
      lt: { key: 'e', code: 'KeyE', keyCode: 69 },
      rt: { key: 'r', code: 'KeyR', keyCode: 82 },
      select: { key: 'Shift', code: 'ShiftRight', keyCode: 16 },
      start: { key: 'Enter', code: 'Enter', keyCode: 13 }
    };

    function sendKeyEvent(type, mapping) {
      try {
        const evt = new KeyboardEvent(type, {
          key: mapping.key,
          code: mapping.code,
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        });
        Object.defineProperty(evt, 'keyCode', { get: () => mapping.keyCode, configurable: true });
        Object.defineProperty(evt, 'which', { get: () => mapping.keyCode, configurable: true });
        Object.defineProperty(evt, 'charCode', { get: () => (type === 'keypress' ? mapping.keyCode : 0), configurable: true });

        const canvas = document.querySelector('canvas') || document.getElementById('canvas');
        if (canvas) {
          canvas.dispatchEvent(evt);
        }
        window.dispatchEvent(evt);
        document.dispatchEvent(evt);
      } catch (err) {}
    }

    function createSyntheticGamepad(s, cfg) {
      if (!s) return null;
      const ctrl = cfg || {};
      const deadzone = typeof ctrl.deadzone === 'number' ? ctrl.deadzone : 0.25;

      const btn = (pressed) => ({
        pressed: Boolean(pressed),
        touched: Boolean(pressed),
        value: pressed ? 1.0 : 0.0
      });

      const stickLeft = Boolean(s.axes && s.axes[0] < -deadzone);
      const stickRight = Boolean(s.axes && s.axes[0] > deadzone);
      const stickUp = Boolean(s.axes && s.axes[1] < -deadzone);
      const stickDown = Boolean(s.axes && s.axes[1] > deadzone);

      const mapStick = ctrl.leftStickAsDpad !== false;

      // Handle face button layout remappings
      let mappedA = s.a;
      let mappedB = s.b;
      let mappedX = s.x;
      let mappedY = s.y;

      if (ctrl.swapAB) {
        const tmp = mappedA; mappedA = mappedB; mappedB = tmp;
      }
      if (ctrl.swapXY) {
        const tmp = mappedX; mappedX = mappedY; mappedY = tmp;
      }
      if (ctrl.layoutPreset === 'standard') {
        // Standard Xbox / Steam Deck layout: South button is primary action
        const tmp = mappedA; mappedA = mappedB; mappedB = tmp;
      } else if (ctrl.layoutPreset === 'arcade') {
        const t1 = mappedA; mappedA = mappedX; mappedX = t1;
        const t2 = mappedB; mappedB = mappedY; mappedY = t2;
      }

      return {
        id: 'Steam Deck Controller (STANDARD GAMEPAD)',
        index: 0,
        connected: true,
        timestamp: performance.now(),
        mapping: 'standard',
        axes: [
          s.axes && s.axes[0] !== undefined ? s.axes[0] : 0,
          s.axes && s.axes[1] !== undefined ? s.axes[1] : 0,
          s.axes && s.axes[2] !== undefined ? s.axes[2] : 0,
          s.axes && s.axes[3] !== undefined ? s.axes[3] : 0,
        ],
        buttons: [
          btn(mappedA),                                         // 0: A
          btn(mappedB),                                         // 1: B
          btn(mappedX),                                         // 2: X
          btn(mappedY),                                         // 3: Y
          btn(s.lb),                                            // 4: L1
          btn(s.rb),                                            // 5: R1
          btn(s.lt),                                            // 6: L2
          btn(s.rt),                                            // 7: R2
          btn(s.select),                                        // 8: Select
          btn(s.start),                                         // 9: Start
          btn(s.l3),                                            // 10: L3
          btn(s.r3),                                            // 11: R3
          btn(s.dpadUp || (mapStick && stickUp)),               // 12: D-Pad Up
          btn(s.dpadDown || (mapStick && stickDown)),           // 13: D-Pad Down
          btn(s.dpadLeft || (mapStick && stickLeft)),           // 14: D-Pad Left
          btn(s.dpadRight || (mapStick && stickRight)),         // 15: D-Pad Right
          btn(false)                                            // 16: Guide
        ]
      };
    }

    function dispatchGamepadConnected(gp) {
      try {
        window.dispatchEvent(new GamepadEvent('gamepadconnected', { gamepad: gp }));
      } catch (err) {
        try {
          const evt = new Event('gamepadconnected');
          evt.gamepad = gp;
          window.dispatchEvent(evt);
        } catch(e) {}
      }
    }

    // Override navigator.getGamepads for browsers where iframe loses controller focus
    const origGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
    navigator.getGamepads = function() {
      if (injectedGamepadState) {
        return [createSyntheticGamepad(injectedGamepadState, injectedControlsConfig), null, null, null];
      }
      const real = origGetGamepads();
      if (real && real[0]) {
        return real;
      }
      return [null, null, null, null];
    };

    window.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'SYNC_GAMEPAD') return;
      const s = e.data.state;
      const ctrl = e.data.controls || injectedControlsConfig || {};
      injectedGamepadState = s;
      injectedControlsConfig = ctrl;

      if (!s) return;

      if (!gamepadConnectedDispatched) {
        gamepadConnectedDispatched = true;
        dispatchGamepadConnected(createSyntheticGamepad(s, ctrl));
      }

      const deadzone = typeof ctrl.deadzone === 'number' ? ctrl.deadzone : 0.25;
      const stickLeft = Boolean(s.axes && s.axes[0] < -deadzone);
      const stickRight = Boolean(s.axes && s.axes[0] > deadzone);
      const stickUp = Boolean(s.axes && s.axes[1] < -deadzone);
      const stickDown = Boolean(s.axes && s.axes[1] > deadzone);
      const mapStick = ctrl.leftStickAsDpad !== false;

      let keyA = s.a;
      let keyB = s.b;
      let keyX = s.x;
      let keyY = s.y;

      if (ctrl.swapAB) {
        const tmp = keyA; keyA = keyB; keyB = tmp;
      }
      if (ctrl.swapXY) {
        const tmp = keyX; keyX = keyY; keyY = tmp;
      }
      if (ctrl.layoutPreset === 'standard') {
        const tmp = keyA; keyA = keyB; keyB = tmp;
      } else if (ctrl.layoutPreset === 'arcade') {
        const t1 = keyA; keyA = keyX; keyX = t1;
        const t2 = keyB; keyB = keyY; keyY = t2;
      }

      // Handle Turbo button if configured
      if (ctrl.turboTrigger && ctrl.turboTrigger !== 'none') {
        const turboPressed = Boolean(
          (ctrl.turboTrigger === 'rt' && s.rt) ||
          (ctrl.turboTrigger === 'rb' && s.rb) ||
          (ctrl.turboTrigger === 'lt' && s.lt)
        );
        try {
          const E = window.EJS_emulator;
          const m = E && E.gameManager;
          if (m && m.setFastForwardRatio) {
            if (turboPressed) {
              m.setFastForwardRatio(2.5);
              if (m.toggleFastForward) m.toggleFastForward(1);
            } else if (prevMappedState._turboActive) {
              if (m.toggleFastForward) m.toggleFastForward(0);
            }
          }
        } catch(e) {}
        prevMappedState._turboActive = turboPressed;
      }

      const currentMapped = {
        dpadUp: Boolean(s.dpadUp || (mapStick && stickUp)),
        dpadDown: Boolean(s.dpadDown || (mapStick && stickDown)),
        dpadLeft: Boolean(s.dpadLeft || (mapStick && stickLeft)),
        dpadRight: Boolean(s.dpadRight || (mapStick && stickRight)),
        a: Boolean(keyA),
        b: Boolean(keyB),
        x: Boolean(keyX),
        y: Boolean(keyY),
        lb: Boolean(s.lb),
        rb: Boolean(s.rb),
        lt: Boolean(s.lt),
        rt: Boolean(s.rt),
        select: Boolean(s.select),
        start: Boolean(s.start)
      };

      for (const action in KEY_MAPPINGS) {
        const isDown = currentMapped[action];
        const wasDown = prevMappedState[action];
        if (isDown && !wasDown) {
          sendKeyEvent('keydown', KEY_MAPPINGS[action]);
        } else if (!isDown && wasDown) {
          sendKeyEvent('keyup', KEY_MAPPINGS[action]);
        }
      }

      prevMappedState = currentMapped;
    });

    // Aggressive Canvas Focus Watcher - ensures the RetroArch game has primary controller focus
    function ensureGameFocus() {
      try {
        window.focus();
        const canvas = document.querySelector('canvas') || document.getElementById('canvas');
        if (canvas) {
          if (canvas.tabIndex < 0) canvas.tabIndex = 0;
          canvas.focus();
        }
      } catch(e) {}
    }

    const observer = new MutationObserver(() => {
      ensureGameFocus();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('DOMContentLoaded', ensureGameFocus);
    window.addEventListener('load', ensureGameFocus);
    window.addEventListener('click', ensureGameFocus);
    window.addEventListener('pointerdown', ensureGameFocus);
    setInterval(ensureGameFocus, 1000);

    // ---- DeckRomM command bridge: save/load state, restart, pause, volume, speed ----
    (function () {
      function emu() { return window.EJS_emulator; }
      function gm() { var e = emu(); return e && e.gameManager; }
      function reply(req, extra, transfer) {
        var msg = Object.assign({ type: 'DECK_EMU_REPLY', reqId: req.reqId }, extra);
        try { parent.postMessage(msg, '*', transfer || []); } catch (err) { parent.postMessage(msg, '*'); }
      }
      function toThumb(src, sw, sh) {
        var w = 256, h = Math.max(1, Math.round(256 * (sh / Math.max(1, sw))));
        var t = document.createElement('canvas'); t.width = w; t.height = h;
        t.getContext('2d').drawImage(src, 0, 0, w, h);
        return t.toDataURL('image/jpeg', 0.7);
      }
      // WebGL clears its buffer after each frame, so reading the canvas directly
      // gives a black image. Ask the core for a PNG screenshot first.
      var lastShot = '';
      async function grabScreenshot() {
        try {
          var m = gm();
          if (m && typeof m.screenshot === 'function') {
            var png = m.screenshot();
            if (png && typeof png.then === 'function') png = await Promise.race([png, new Promise(function (r) { setTimeout(function () { r(null); }, 700); })]);
            if (png && png.byteLength) {
              var bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
              return toThumb(bmp, bmp.width, bmp.height);
            }
          }
        } catch (err) {}
        try {
          var c = document.querySelector('#game canvas') || document.querySelector('canvas');
          if (!c) return '';
          return await new Promise(function (res) {
            requestAnimationFrame(function () { try { res(toThumb(c, c.width, c.height)); } catch (e2) { res(''); } });
          });
        } catch (err) { return ''; }
      }
      window.addEventListener('message', async function (e) {
        var d = e.data;
        if (!d || d.type !== 'DECK_EMU_CMD') return;
        try {
          var m = gm(), E = emu();
          if (!m || !E) throw new Error('The game is still starting');
          switch (d.cmd) {
            case 'SAVE_STATE': {
              if (typeof E.getCore === 'function' && typeof m.supportsStates === 'function' && !m.supportsStates()) throw new Error('This core does not support save states');
              var st = m.getState();
              if (st && typeof st.then === 'function') st = await st;
              if (!st || !st.byteLength) throw new Error('Core returned an empty state');
              var bytes = new Uint8Array(st);
              var shot = lastShot || await grabScreenshot();
              reply(d, { ok: true, state: bytes, screenshot: shot }, [bytes.buffer]);
              break;
            }
            case 'LOAD_STATE': {
              var data = d.state instanceof Uint8Array ? d.state : new Uint8Array(d.state);
              var r = m.loadState(data);
              if (r && typeof r.then === 'function') await r;
              if (E.paused && typeof E.play === 'function') E.play(true);
              reply(d, { ok: true });
              break;
            }
            case 'GET_SRAM': {
              // Same calls RomM's player uses: getSaveFile(true) flushes the core's
              // battery RAM to its save path and returns the bytes.
              var sram = null;
              if (typeof m.getSaveFile === 'function') sram = m.getSaveFile(d.flush !== false);
              else if (m.FS && typeof m.getSaveFilePath === 'function') {
                if (d.flush !== false && typeof m.saveSaveFiles === 'function') m.saveSaveFiles();
                var sp = m.getSaveFilePath();
                sram = m.FS.analyzePath(sp).exists ? m.FS.readFile(sp) : null;
              }
              var out = sram && sram.byteLength ? new Uint8Array(sram) : null;
              var extra = { ok: true, sram: out };
              if (d.withShot) extra.screenshot = lastShot || await grabScreenshot();
              reply(d, extra, out ? [out.buffer] : []);
              break;
            }
            case 'PUT_SRAM': {
              if (!m.FS || typeof m.getSaveFilePath !== 'function') throw new Error('This core has no save file support');
              var bytesIn = d.sram instanceof Uint8Array ? d.sram : new Uint8Array(d.sram);
              var FS = m.FS, path = m.getSaveFilePath(), parts = path.split('/'), cp = '';
              for (var pi = 0; pi < parts.length - 1; pi++) {
                if (parts[pi] === '') continue;
                cp += '/' + parts[pi];
                if (!FS.analyzePath(cp).exists) FS.mkdir(cp);
              }
              if (FS.analyzePath(path).exists) FS.unlink(path);
              FS.writeFile(path, bytesIn);
              m.loadSaveFiles();
              // Reset once so games that only read their save while booting see it.
              if (d.restart && typeof m.restart === 'function') m.restart();
              reply(d, { ok: true });
              break;
            }
            case 'RESTART':
              m.restart();
              reply(d, { ok: true });
              break;
            case 'PAUSE':
              // The core only writes screenshots while running, so grab one for
              // the save-slot thumbnail before pausing.
              lastShot = await grabScreenshot();
              if (typeof E.pause === 'function') E.pause(true); else if (m.toggleMainLoop) m.toggleMainLoop(0);
              reply(d, { ok: true });
              break;
            case 'RESUME':
              lastShot = '';
              if (typeof E.play === 'function') E.play(true); else if (m.toggleMainLoop) m.toggleMainLoop(1);
              reply(d, { ok: true });
              break;
            case 'SET_VOLUME':
              if (typeof E.setVolume === 'function') E.setVolume(d.volume);
              reply(d, { ok: true });
              break;
            case 'SET_SPEED':
              if (d.speed > 1) {
                if (m.setFastForwardRatio) m.setFastForwardRatio(d.speed);
                if (m.toggleFastForward) m.toggleFastForward(1);
              } else if (m.toggleFastForward) m.toggleFastForward(0);
              reply(d, { ok: true });
              break;
            default:
              reply(d, { ok: true, started: true });
          }
        } catch (err) {
          reply(d, { ok: false, message: String((err && err.message) || err) });
        }
      });
      window.EJS_onGameStart = function () {
        try { parent.postMessage({ type: 'DECK_EMU_STARTED' }, '*'); } catch (err) {}
        ensureGameFocus();
      };
    })();
  </script>
</head>
<body>
  <div id="game"></div>
  <script>
    window.EJS_player = '#game';
    window.EJS_core = ${JSON.stringify(emulatorCore)};
    window.EJS_gameUrl = ${JSON.stringify(romBlobUrl)};
    window.EJS_gameName = ${JSON.stringify(game.title)};
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#38bdf8';
    window.EJS_fullscreenOnLoad = false;
    window.EJS_volume = ${isMuted ? 0 : volume / 100};
    window.EJS_gamepad = true;
    window.EJS_mouse = false;
    window.EJS_VirtualGamepadSettings = { enabled: false };
  </script>
  <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`
    : '';

  return (
    <div
      id="deck-web-emulator-modal"
      className="fixed inset-0 z-[300] w-screen h-screen bg-black flex items-center justify-center overflow-hidden select-none animate-in fade-in duration-200"
      onMouseMove={resetHudTimer}
      onTouchStart={resetHudTimer}
      onClick={() => {
        resetHudTimer();
        if (iframeRef.current) {
          try {
            iframeRef.current.focus();
          } catch (e) {}
        }
      }}
    >
      {/* Transient Toast Pill */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-[#0e1726]/95 border border-sky-400/50 shadow-2xl text-sky-200 text-xs font-mono font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Floating Auto-Hiding Top HUD Ribbon */}
      <div
        className={`fixed top-0 inset-x-0 z-40 px-4 py-2.5 bg-gradient-to-b from-black/90 via-black/70 to-transparent transition-all duration-300 pointer-events-auto ${
          isHudVisible && !isOverlayOpen && loadStatus === 'ready'
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-1 rounded bg-sky-500/20 text-sky-400">
              <Gamepad2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white truncate max-w-[200px] sm:max-w-[340px]">
                  {game.title}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-[10px] uppercase font-bold">
                  {game.platformSlug || 'ROM'}
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[10px] font-mono">
                  <Monitor className="w-2.5 h-2.5 text-sky-400" />
                  {consoleConfig.resolution}
                </span>
              </div>
            </div>
          </div>

          {/* Quick HUD Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              id="btn-emulator-open-overlay"
              onClick={() => setIsOverlayOpen(true)}
              className="px-3 py-1 rounded-lg text-xs flex items-center gap-1.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 transition-colors font-medium cursor-pointer"
              title="Open Overlay Menu"
            >
              <Sliders className="w-3.5 h-3.5 text-sky-300" />
              <span>Menu</span>
              <span className="px-1.5 py-0.5 rounded bg-black/40 text-sky-300 font-mono text-[10px]">
                {(buttonCombo || 'select_start').replace('_', ' + ').toUpperCase()}
              </span>
            </button>

            <button
              id="btn-exit-emulator"
              onClick={handleExit}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 text-rose-300 text-xs font-bold transition-colors cursor-pointer"
              title="Exit game"
            >
              <span>Exit</span>
              <span className="px-1.5 py-0.2 rounded bg-black/40 text-rose-300 font-mono text-[10px]">
                B
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Fullscreen Viewport Container with Native Side Pillarbox Bars */}
      <div
        id="emulator-canvas-viewport"
        onClick={focusIframe}
        onPointerDown={focusIframe}
        style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
        className={`relative h-full max-h-screen max-w-full flex items-center justify-center bg-black overflow-hidden shadow-2xl transition-all duration-200 outline-none ring-0 border-0 ${activeAspectClass}`}
      >
        {/* State A: Loading / Downloading ROM */}
        {(loadStatus === 'checking' || loadStatus === 'downloading') && (
          <div className="absolute inset-0 bg-[#070b14] flex flex-col items-center justify-center p-6 text-center z-20">
            {game.coverUrl && (
              <div className="relative mb-4 w-28 h-28 sm:w-36 sm:h-36 rounded-2xl overflow-hidden border border-white/20 shadow-[0_0_30px_rgba(56,189,248,0.2)]">
                <img
                  src={game.coverUrl}
                  alt={game.title}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}

            <h3 className="text-lg sm:text-xl font-bold text-white mb-1">{game.title}</h3>
            <p className="text-xs text-sky-400 font-mono mb-4">
              {loadStatus === 'checking'
                ? 'Checking local Steam Deck cache...'
                : `Streaming ROM from RomM server (${emulatorCore.toUpperCase()})...`}
            </p>

            {/* Real Progress Bar */}
            <div className="w-full max-w-md bg-white/10 rounded-full h-3.5 overflow-hidden p-0.5 border border-white/15 mb-3">
              <div
                className="bg-gradient-to-r from-sky-500 to-indigo-500 h-full rounded-full transition-all duration-200"
                style={{ width: `${Math.max(8, downloadPct)}%` }}
              ></div>
            </div>

            <div className="flex items-center justify-between w-full max-w-md text-xs font-mono text-slate-400 mb-6">
              <span>{downloadPct}% downloaded</span>
              {downloadSpeed > 0 && <span>{downloadSpeed} MB/s</span>}
              <span>
                {downloadLoaded > 0
                  ? `${(downloadLoaded / (1024 * 1024)).toFixed(1)} MB`
                  : 'Preparing...'}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleLaunchNative}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg transition-colors cursor-pointer"
              >
                <Rocket className="w-4 h-4" />
                <span>Launch in Native SteamOS Directly</span>
              </button>
              <button
                onClick={handleExit}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* State B: Error Screen */}
        {loadStatus === 'error' && (
          <div className="absolute inset-0 bg-[#070b14] flex flex-col items-center justify-center p-6 text-center z-20">
            <div className="p-3 rounded-2xl bg-rose-500/20 text-rose-400 mb-3 border border-rose-500/30">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Could Not Load ROM</h3>
            <p className="text-xs text-rose-300/90 font-mono max-w-md mb-6 leading-relaxed">
              {errorMessage}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={prepareRom}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Download</span>
              </button>
              <button
                onClick={handleLaunchNative}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Rocket className="w-4 h-4" />
                <span>Launch via Native SteamOS</span>
              </button>
              <button
                onClick={handleExit}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* State C: Ready - Real EmulatorJS Iframe */}
        {loadStatus === 'ready' && romBlobUrl && (
          <iframe
            ref={iframeRef}
            srcDoc={emulatorSrcDoc}
            title={game.title}
            tabIndex={-1}
            autoFocus
            onLoad={focusIframe}
            allow="gamepad; autoplay; fullscreen"
            style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
            className="w-full h-full border-0 bg-black block outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none"
          />
        )}

        {/* CRT Filter Overlays */}
        {crtFilterMode === 'subtle' && (
          <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(transparent,transparent_2px,rgba(0,0,0,0.18)_3px,rgba(0,0,0,0.18)_4px)] z-10" />
        )}
        {crtFilterMode === 'arcade' && (
          <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(transparent,transparent_2px,rgba(0,0,0,0.32)_3px,rgba(0,0,0,0.32)_4px)] shadow-[inset_0_0_100px_rgba(0,0,0,0.85)] z-10" />
        )}
        {crtFilterMode === 'phosphor' && (
          <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(rgba(16,185,129,0.06),rgba(16,185,129,0.06)_1px,transparent_2px,transparent_3px)] shadow-[inset_0_0_80px_rgba(0,40,20,0.7)] z-10" />
        )}

        {/* IN-GAME OVERLAY MENU COMPONENT */}
        <InGameOverlayMenu
          isOpen={isOverlayOpen}
          onClose={() => setIsOverlayOpen(false)}
          game={game}
          selectedSlot={selectedSlot}
          onSelectSlot={setSelectedSlot}
          saveStates={saveStates}
          onSaveState={handleSaveState}
          onLoadState={handleLoadState}
          onDeleteState={handleDeleteState}
          cloudExtras={cloudExtras}
          onLoadExtra={handleLoadExtra}
          cloudStatus={cloudStatus}
          onResetGame={handleResetGame}
          onExitGame={handleExit}
          sramStatus={sramStatus}
          onSyncSram={handleSyncSram}
          crtFilterMode={crtFilterMode}
          onChangeCrtFilter={setCrtFilterMode}
          aspectRatio={aspectRatio}
          onChangeAspectRatio={setAspectRatio}
          turboSpeed={turboSpeed}
          onChangeTurboSpeed={setTurboSpeed}
          volume={volume}
          onChangeVolume={setVolume}
          isMuted={isMuted}
          onToggleMute={() => setIsMuted(!isMuted)}
          buttonCombo={buttonCombo}
          onChangeButtonCombo={setButtonCombo}
          controllerConfig={controllerConfig}
          onChangeControllerConfig={handleUpdateControllerConfig}
          onLaunchStandaloneSettings={(flatpakId, name) => {
            soundService.playSelect();
            callEmu('PAUSE').catch(() => {});
            rommApi.launchStandaloneEmulator(flatpakId, name).then((res) => {
              triggerToast(res.message);
              if (res.success) {
                setIsOverlayOpen(false);
              }
            });
          }}
          fps={fps}
          showFps={showFps}
          onToggleShowFps={() => setShowFps(!showFps)}
          busy={stateBusy}
        />
      </div>

      {/* Transient First-Launch Hotkey Notification Banner - Automatically disappears after 5 seconds */}
      {showComboToast && !isOverlayOpen && loadStatus === 'ready' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="px-6 py-3.5 rounded-2xl bg-black/85 border border-sky-400/50 shadow-[0_0_30px_rgba(56,189,248,0.35)] backdrop-blur-md flex items-center gap-3 text-sm text-white animate-in fade-in zoom-in-95">
            <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Press</span>
            <span className="px-2 py-0.5 rounded-md bg-sky-500/25 border border-sky-400/40 text-sky-300 font-mono font-bold">
              {(buttonCombo || 'select_start').replace(/_/g, ' + ').toUpperCase()}
            </span>
            <span>for the In-Game Menu</span>
          </div>
        </div>
      )}

      {/* Bottom Auto-Hiding Steam Deck Controller Legend */}
      <div
        className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-30 transition-all duration-300 pointer-events-none ${
          isHudVisible && !isOverlayOpen && loadStatus === 'ready'
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="px-3.5 py-1.5 rounded-full bg-black/80 border border-white/10 backdrop-blur-md flex items-center gap-2.5 text-[11px] font-mono text-slate-300 shadow-2xl">
          <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold border border-sky-400/30">
            {(buttonCombo || 'select_start').replace('_', ' + ').toUpperCase()}
          </span>
          <span className="text-slate-400">In-Game Menu</span>
        </div>
      </div>
    </div>
  );
};
