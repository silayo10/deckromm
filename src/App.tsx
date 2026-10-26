import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Square, CloudOff } from 'lucide-react';
import { Collection, DownloadItem, FilterTag, Game, LibraryViewMode, NavigationAction, Platform, RommConfig, SortOption, matchGameGenre, normalizeGenre, getActiveCoreForGame, PLATFORM_AVAILABLE_CORES } from './types';
import { AuthStatus, EmulatorStateEvent, RomProgressEvent } from './env/electron';
import { rommApi } from './services/rommApi';
import { bridge, isNativeApp } from './services/bridge';
import { markPlayed } from './services/cloudSaves';
import { gamepadService } from './services/gamepadService';
import { focusManager, isTextInput } from './services/focusManager';
import { soundService } from './services/soundService';
import { useFocusScope } from './hooks/useFocusScope';
import { HeaderBar } from './components/HeaderBar';
import { LibrarySource, PlatformBar, sourceKey } from './components/PlatformBar';
import { groupPlatformsByFamily } from './utils/platformGrouping';
import { SearchFilterBar, VIEW_MODES } from './components/SearchFilterBar';
import { GameGrid } from './components/GameGrid';
import { GameDetailModal } from './components/GameDetailModal';
import { GenrePickerModal } from './components/GenrePickerModal';
import { LanguagePickerModal, LanguageCountOption } from './components/LanguagePickerModal';
import { isJapaneseGame, isEnglishGame, matchGameLanguage } from './utils/languageUtils';
import { LoginOverlay } from './components/LoginOverlay';
import { MainMenu } from './components/MainMenu';
import { SettingsScreen } from './components/SettingsScreen';
import { DownloadsPanel } from './components/DownloadsPanel';
import { KeyboardMode, VirtualKeyboardModal } from './components/VirtualKeyboardModal';
import { ControllerHUD, HudHint } from './components/ControllerHUD';
import { FocusScope } from './components/FocusScope';
import { WebEmulatorModal } from './components/WebEmulatorModal';
import { RomPatcherModal } from './components/RomPatcherModal';
import { StandaloneEmulatorsModal } from './components/StandaloneEmulatorsModal';
import { BiosManagerModal } from './components/BiosManagerModal';
import { StorageManagerModal } from './components/StorageManagerModal';
import { UpdateManagerModal } from './components/UpdateManagerModal';
import { LaunchingOverlay } from './components/LaunchingOverlay';
import { AppUpdateInfo } from './types';

interface KeyboardRequest {
  input: HTMLInputElement | HTMLTextAreaElement;
  title: string;
  mode: KeyboardMode;
  value: string;
  placeholder: string;
}

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'error';
}

/** Set an input's value so React's onChange fires (used by the on-screen keyboard). */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function playersOf(g: Game): number {
  const n = typeof g.players === 'number' ? g.players : parseInt(String(g.players || '').replace(/^.*-/, ''), 10);
  return Number.isFinite(n) ? n : 1;
}

function sourceLabel(s: LibrarySource) {
  switch (s.kind) {
    case 'all': return 'All Games';
    case 'recent': return 'Recently Played';
    case 'favorites': return 'Favorites';
    case 'installed': return 'On this Deck';
    case 'platform': return s.platform.name;
    case 'platform_family': return `All ${s.name} Games`;
    case 'collection': return s.collection.name;
  }
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [config, setConfig] = useState<RommConfig>(rommApi.getConfig());
  const [auth, setAuth] = useState<AuthStatus>(rommApi.getAuthStatus());
  const [login, setLogin] = useState<{ open: boolean; reason?: string }>({ open: false });

  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [source, setSource] = useState<LibrarySource>({ kind: 'recent' });
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filter: FilterTag = config.filterTag || 'all';
  const sortBy: SortOption = config.sortBy || 'title';
  const viewMode: LibraryViewMode = config.viewMode || 'grid';
  const [selectedGenre, setSelectedGenre] = useState<string>(config.genreFilter || 'all');
  const [genrePickerOpen, setGenrePickerOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    config.languageFilter || (config.hideJapanese ? 'no-ja' : 'all')
  );
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [playingGame, setPlayingGame] = useState<Game | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [patcherModalOpen, setPatcherModalOpen] = useState(false);
  const [standaloneEmulatorsModalOpen, setStandaloneEmulatorsModalOpen] = useState(false);
  const [biosModalOpen, setBiosModalOpen] = useState(false);
  const [biosPlatformFilter, setBiosPlatformFilter] = useState<string | undefined>();
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const [keyboard, setKeyboard] = useState<KeyboardRequest | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadItem>>({});
  const [emulator, setEmulator] = useState<EmulatorStateEvent>({ running: false });
  const [launchingGame, setLaunchingGame] = useState<{ game: Game; emulatorName?: string } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Offline Mode: Only show downloaded games stored locally on this Steam Deck
  const [offlineMode, setOfflineMode] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
    const stored = localStorage.getItem('deckromm_offline_mode');
    if (stored !== null) return stored === 'true';
    return Boolean(rommApi.getConfig().offlineOnlyMode);
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const focusGridOnLoad = useRef(true);
  const gamesRef = useRef<Game[]>([]);
  gamesRef.current = games;

  const ready = booted && (auth.authenticated || config.isDemoMode || offlineMode);

  // ------------------------------------------------------------ toasts
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const toggleOfflineMode = useCallback((forced?: boolean) => {
    setOfflineMode((prev) => {
      const next = forced !== undefined ? forced : !prev;
      localStorage.setItem('deckromm_offline_mode', String(next));
      if (forced !== undefined) {
        localStorage.setItem('deckromm_offline_mode_manual', String(forced));
      } else {
        localStorage.setItem('deckromm_offline_mode_manual', String(next));
      }
      rommApi.saveConfig({ offlineOnlyMode: next });
      setConfig((c) => ({ ...c, offlineOnlyMode: next }));
      soundService.playTick();
      if (next) {
        toast('Offline Mode active • Showing downloaded games that can be played locally', 'info');
      } else {
        toast('Online Mode active • Connecting to RomM server', 'ok');
      }
      setReloadToken((t) => t + 1);
      return next;
    });
  }, [toast]);

  // Monitor system network connectivity to automatically switch to/from offline mode
  useEffect(() => {
    const handleOnline = () => {
      const userManual = localStorage.getItem('deckromm_offline_mode_manual') === 'true';
      if (!userManual) {
        setOfflineMode(false);
        rommApi.saveConfig({ offlineOnlyMode: false });
        setConfig((c) => ({ ...c, offlineOnlyMode: false }));
        toast('Network reconnected • Switched to Online Mode', 'ok');
        setReloadToken((t) => t + 1);
      }
    };
    const handleOffline = () => {
      setOfflineMode(true);
      rommApi.saveConfig({ offlineOnlyMode: true });
      setConfig((c) => ({ ...c, offlineOnlyMode: true }));
      toast('Network connection lost • Switched to Offline Mode (showing downloaded games)', 'info');
      setReloadToken((t) => t + 1);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

  // ------------------------------------------------------------ boot
  useEffect(() => {
    focusManager.init();
    let alive = true;
    rommApi
      .init()
      .then((cfg) => {
        if (!alive) return;
        const a = rommApi.getAuthStatus();
        soundService.enabled = cfg.audioFeedback !== false;
        setConfig(cfg);
        setAuth(a);
        if (cfg.languageFilter || cfg.hideJapanese) {
          setSelectedLanguage(cfg.languageFilter || (cfg.hideJapanese ? 'no-ja' : 'all'));
        }
        if (cfg.genreFilter) {
          setSelectedGenre(cfg.genreFilter);
        }
        if (!a.authenticated && !cfg.isDemoMode && !cfg.offlineOnlyMode && (typeof navigator === 'undefined' || navigator.onLine)) {
          setLogin({ open: true });
        }
      })
      .catch((e) => {
        console.error('init failed', e);
        setLogin({ open: true, reason: `Startup error: ${e?.message || e}` });
      })
      .finally(() => alive && setBooted(true));
    return () => {
      alive = false;
    };
  }, []);

  // 401/403 anywhere -> gamepad login overlay (library stays mounted underneath).
  useEffect(
    () =>
      rommApi.onAuthRequired((info) => {
        setAuth(rommApi.getAuthStatus());
        setLogin({ open: true, reason: info.message || `Your RomM session expired (HTTP ${info.status}). Please sign in again.` });
      }),
    []
  );

  // ------------------------------------------------------------ native events
  useEffect(() => {
    const offProgress = bridge.on('rom:progress', (ev: RomProgressEvent) => {
      setDownloads((d) => {
        const prev = d[ev.romId];
        const game = gamesRef.current.find((g) => String(g.id) === ev.romId);
        const total = ev.total || prev?.fileSizeBytes || game?.fileSizeBytes || 0;
        const item: DownloadItem = {
          id: ev.romId,
          gameId: ev.romId,
          title: prev?.title || game?.title || `ROM ${ev.romId}`,
          platform: prev?.platform || game?.platformName || '',
          fileSizeBytes: total,
          bytesDownloaded: ev.loaded,
          progress: ev.status === 'completed' ? 100 : total ? Math.min(99.9, (ev.loaded / total) * 100) : 0,
          speedMbps: ev.speedMbps,
          status: ev.status === 'cancelled' ? 'error' : ev.status,
          errorMessage: ev.status === 'cancelled' ? 'Cancelled' : ev.message,
          startedAt: prev?.startedAt || Date.now(),
          completedAt: ev.status === 'completed' ? Date.now() : undefined,
        };
        return { ...d, [ev.romId]: item };
      });
      if (ev.status === 'completed') {
        const patch = (g: Game) => (String(g.id) === ev.romId ? { ...g, isInstalled: true, localPath: ev.path || g.localPath } : g);
        startTransition(() => setGames((list) => list.map(patch)));
        setSelectedGame((g) => (g ? patch(g) : g));
      } else if (ev.status === 'error') {
        toast(`Download failed: ${ev.message || 'unknown error'}`, 'error');
      }
    });

    const offEmu = bridge.on('emulator:state', (ev) => {
      setEmulator(ev);
      gamepadService.setSuspended(ev.running);
      if (!ev.running) {
        setLaunchingGame(null);
      }
      if (!ev.running && ev.error) toast(`Emulator error: ${ev.error}`, 'error');
      else if (!ev.running && ev.title) toast(`Finished playing ${ev.title}`, 'info');
    });

    const offLaunching = bridge.on('emulator:launching', () => {
      // Confirmed emulator launching in main process
    });

    // Desktop mode: if the user alt-tabs back while a game runs, allow "Stop game".
    const offFocus = bridge.on('window:focus', ({ focused }) => {
      bridge.emulator.status().then((s) => gamepadService.setSuspended(s.running && !focused)).catch(() => {});
    });

    const offQuit = bridge.on('app:shutting-down', () => {
      setExiting(true);
      gamepadService.destroy(); // release every held button, stop the rAF poller
    });

    const offUpdate = bridge.on('app:update-available', (info: AppUpdateInfo) => {
      setAvailableUpdate(info);
      toast(`New version on GitHub (${info.latestCommit}): "${info.message}". Press Menu to upgrade in place.`, 'info');
    });

    const offPcsx2 = bridge.on('pcsx2:memcard-uploaded', (ev: any) => {
      soundService.playSuccess();
      toast(`PCSX2 Memory Card (${ev.fileName}) uploaded to RomM server!`, 'ok');
    });

    if (isNativeApp) bridge.emulator.status().then(setEmulator).catch(() => {});
    return () => {
      offProgress();
      offEmu();
      offLaunching();
      offFocus();
      offQuit();
      offUpdate();
      offPcsx2();
    };
  }, [toast]);

  // ------------------------------------------------------------ data loading (never blocks rendering)
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    Promise.all([
      rommApi.getPlatforms(),
      offlineMode ? Promise.resolve([]) : rommApi.getCollections(),
    ]).then(async ([p, c]) => {
      if (!alive) return;
      let finalPlatforms = p;
      if (offlineMode) {
        // In offline mode, only include platforms that have downloaded games
        const downloadedGames = await rommApi.getOfflineGames();
        const activeSlugs = new Set(downloadedGames.map((g) => g.platformSlug));
        finalPlatforms = p.filter((plat) => activeSlugs.has(plat.slug));
        for (const g of downloadedGames) {
          if (!finalPlatforms.some((plat) => plat.slug === g.platformSlug)) {
            finalPlatforms.push({
              id: g.platformSlug,
              slug: g.platformSlug,
              name: g.platformName || g.platformSlug.toUpperCase(),
              shortName: g.platformSlug.toUpperCase().slice(0, 8),
              manufacturer: '',
              generation: '',
              color: '#3b82f6',
              gameCount: downloadedGames.filter((x) => x.platformSlug === g.platformSlug).length,
              extensions: [],
              emulatorCore: 'auto',
              canStreamOnline: false,
            });
          }
        }
      }
      startTransition(() => {
        setPlatforms(finalPlatforms);
        setCollections(c);
      });
    });
    return () => {
      alive = false;
    };
  }, [ready, reloadToken, offlineMode]);

  const activeKey = sourceKey(source);
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(null);
    startTransition(() => setGames([]));
    const q =
      source.kind === 'platform'
        ? { platform: source.platform }
        : source.kind === 'platform_family'
        ? { platforms: source.platforms }
        : source.kind === 'collection'
        ? { collectionId: source.collection.id }
        : {};

    const loadPromise = offlineMode
      ? rommApi.getOfflineGames(q)
      : source.kind === 'recent'
      ? rommApi.getRecentlyPlayed(30, ctrl.signal)
      : rommApi.getGamesPaged({
          ...q,
          signal: ctrl.signal,
          onPage: (list) => {
            if (!ctrl.signal.aborted) startTransition(() => setGames(list));
          },
        });

    loadPromise
      .then((list) => {
        if (!ctrl.signal.aborted) startTransition(() => setGames(list));
      })
      .catch(async (e) => {
        if (ctrl.signal.aborted || e?.name === 'AbortError') return;
        const err = rommApi.getLastError();
        if (!err?.requiresAuth) {
          console.warn('Server connection failed, falling back to offline mode', e);
          const offlineList = await rommApi.getOfflineGames(q);
          if (!ctrl.signal.aborted) {
            startTransition(() => setGames(offlineList));
            if (!offlineMode) {
              setOfflineMode(true);
              toast('RomM server unreachable • Switched to Offline Mode (showing downloaded games)', 'info');
            }
          }
        }
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeKey, reloadToken, config.hideInfoFiles, offlineMode]);

  const availableGenres = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of games) {
      if (!g.genres || g.genres.length === 0) continue;
      const seenForGame = new Set<string>();
      for (const raw of g.genres) {
        const norm = normalizeGenre(raw);
        if (norm) {
          seenForGame.add(norm);
        }
      }
      for (const name of seenForGame) {
        counts[name] = (counts[name] || 0) + 1;
      }
    }

    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name.toLowerCase() === 'rpg') return -1;
        if (b.name.toLowerCase() === 'rpg') return 1;
        return b.count - a.count || a.name.localeCompare(b.name);
      });
  }, [games]);

  const { availableLanguages, japaneseCount } = useMemo(() => {
    let ja = 0;
    let en = 0;
    let fr = 0;
    let de = 0;
    let es = 0;
    let it = 0;

    for (const g of games) {
      if (isJapaneseGame(g)) ja++;
      if (isEnglishGame(g)) en++;
      if (matchGameLanguage(g, 'fr')) fr++;
      if (matchGameLanguage(g, 'de')) de++;
      if (matchGameLanguage(g, 'es')) es++;
      if (matchGameLanguage(g, 'it')) it++;
    }

    const options: LanguageCountOption[] = [
      { id: 'all', label: 'All Languages', shortLabel: 'All', flag: '🌐', count: games.length, description: 'Show all releases in this library' },
      { id: 'no-ja', label: 'Hide Japanese', shortLabel: 'No JP', flag: '🇯🇵', count: Math.max(0, games.length - ja), description: 'Exclude Japanese imports (keep English & translations)' },
      { id: 'en', label: 'English Only', shortLabel: 'EN', flag: '🇺🇸', count: en, description: 'Only North American, European, & English releases' },
      { id: 'ja', label: 'Japanese Only', shortLabel: 'JA', flag: '🇯🇵', count: ja, description: 'Only Japanese region & untranslated imports' },
    ];

    if (fr > 0) options.push({ id: 'fr', label: 'French Only', shortLabel: 'FR', flag: '🇫🇷', count: fr });
    if (de > 0) options.push({ id: 'de', label: 'German Only', shortLabel: 'DE', flag: '🇩🇪', count: de });
    if (es > 0) options.push({ id: 'es', label: 'Spanish Only', shortLabel: 'ES', flag: '🇪🇸', count: es });
    if (it > 0) options.push({ id: 'it', label: 'Italian Only', shortLabel: 'IT', flag: '🇮🇹', count: it });

    return { availableLanguages: options, japaneseCount: ja };
  }, [games]);

  const visibleGames = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    let list = games;
    // In Offline Mode, strictly only show downloaded games that can be played locally!
    if (offlineMode) {
      list = list.filter((g) => g.isInstalled || g.isCached);
    } else {
      if (source.kind === 'installed') list = list.filter((g) => g.isInstalled || g.isCached);
    }
    if (source.kind === 'favorites') list = list.filter((g) => g.isFavorite);
    if (term) {
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(term) ||
          g.fileName?.toLowerCase().includes(term) ||
          g.genres?.some((gen) => gen.toLowerCase().includes(term))
      );
    }
    switch (filter) {
      case 'cached': list = list.filter((g) => g.isInstalled || g.isCached); break;
      case 'favorites': list = list.filter((g) => g.isFavorite); break;
      case 'streamable': list = list.filter((g) => g.playableOnline !== false); break;
      case 'multiplayer': list = list.filter((g) => playersOf(g) > 1); break;
    }
    if (selectedGenre && selectedGenre !== 'all' && selectedGenre.toLowerCase() !== 'all genres') {
      list = list.filter((g) => matchGameGenre(g, selectedGenre));
    }
    if (selectedLanguage && selectedLanguage !== 'all') {
      list = list.filter((g) => matchGameLanguage(g, selectedLanguage));
    }
    const sorted = [...list];
    const lp = (g: Game) => (g.lastPlayed ? Date.parse(g.lastPlayed) || 0 : 0);
    // Recently Played keeps its own order (newest first) regardless of the sort setting.
    if (source.kind === 'recent') return sorted.sort((a, b) => lp(b) - lp(a));
    const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    switch (sortBy) {
      case 'recent': {
        // v1 subtracted ISO strings (NaN) - compare timestamps instead.
        const t = (g: Game) => (g.lastPlayed ? Date.parse(g.lastPlayed) || 0 : 0);
        sorted.sort((a, b) => t(b) - t(a) || byTitle(a, b));
        break;
      }
      case 'rating': sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b)); break;
      case 'year': sorted.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0) || byTitle(a, b)); break;
      case 'size': sorted.sort((a, b) => (b.fileSizeBytes || 0) - (a.fileSizeBytes || 0)); break;
      default: sorted.sort(byTitle);
    }
    return sorted;
  }, [games, deferredSearch, filter, selectedGenre, selectedLanguage, sortBy, source.kind, offlineMode]);

  // Land on the first cover after boot / platform switch.
  useEffect(() => {
    if (focusGridOnLoad.current && visibleGames.length > 0) {
      focusGridOnLoad.current = false;
      requestAnimationFrame(() => {
        const cur = focusManager.getCurrent();
        if (!cur || !cur.closest('[data-focus-memory="platforms"]')) focusManager.focusSelector('[data-game-id]');
      });
    }
  }, [visibleGames]);

  const platformFamilies = useMemo(() => groupPlatformsByFamily(platforms), [platforms]);

  const sources: LibrarySource[] = useMemo(() => {
    const list: LibrarySource[] = [
      { kind: 'recent' },
      { kind: 'all' },
      { kind: 'favorites' },
    ];
    if (isNativeApp && !offlineMode) list.push({ kind: 'installed' });

    for (const fam of platformFamilies) {
      if (fam.platforms.length > 1) {
        list.push({
          kind: 'platform_family',
          familyId: fam.id,
          name: fam.name,
          platforms: fam.platforms,
        });
      } else if (fam.platforms.length === 1) {
        list.push({
          kind: 'platform',
          platform: fam.platforms[0],
        });
      }
    }

    if (!offlineMode) {
      for (const c of collections) {
        list.push({ kind: 'collection', collection: c });
      }
    }

    return list;
  }, [platformFamilies, collections, offlineMode]);

  const selectSource = useCallback((s: LibrarySource) => {
    focusGridOnLoad.current = !document.activeElement?.closest('[data-focus-memory="platforms"]');
    setSource(s);
  }, []);

  const cycleSource = (delta: number) => {
    let currentIdx = sources.findIndex((s) => sourceKey(s) === activeKey);
    if (currentIdx === -1 && source.kind === 'platform') {
      const famId = platformFamilies.find((f) => f.platforms.some((p) => p.id === source.platform.id))?.id;
      if (famId) {
        currentIdx = sources.findIndex((s) => s.kind === 'platform_family' && s.familyId === famId);
      }
    }
    const idx = Math.max(0, currentIdx);
    const next = sources[(idx + delta + sources.length) % sources.length];
    focusGridOnLoad.current = true;
    setSource(next);
  };

  // ------------------------------------------------------------ config
  const updateConfig = useCallback((patch: Partial<RommConfig>) => {
    if (patch.audioFeedback !== undefined) soundService.enabled = patch.audioFeedback;
    setConfig(rommApi.saveConfig(patch));
  }, []);

  const handleGenreChange = useCallback((g: string) => {
    soundService.playTick();
    setSelectedGenre(g);
    updateConfig({ genreFilter: g });
  }, [updateConfig]);

  const handleLanguageChange = useCallback((lang: string) => {
    soundService.playTick();
    setSelectedLanguage(lang);
    updateConfig({ languageFilter: lang, hideJapanese: lang === 'no-ja' });
  }, [updateConfig]);

  const listKey = `${activeKey}|${filter}|${selectedGenre}|${selectedLanguage}|${sortBy}|${deferredSearch}`;

  const refresh = useCallback(() => {
    toast('Refreshing library');
    setReloadToken((n) => n + 1);
  }, [toast]);

  // ------------------------------------------------------------ on-screen keyboard
  useEffect(() => {
    focusManager.onEditRequest = (input) => {
      setKeyboard({
        input,
        title: input.getAttribute('data-keyboard-title') || input.getAttribute('placeholder') || 'Enter text',
        mode: (input.getAttribute('data-keyboard-mode') as KeyboardMode) || (input.type === 'password' ? 'password' : 'text'),
        value: input.value,
        placeholder: input.getAttribute('placeholder') || '',
      });
    };
    return () => {
      focusManager.onEditRequest = null;
    };
  }, []);

  const submitKeyboard = (text: string) => {
    if (!keyboard) return;
    const { input } = keyboard;
    setNativeValue(input, text);
    setKeyboard(null);
    if (input.id === 'header-search' && text.trim()) {
      focusGridOnLoad.current = false;
      setTimeout(() => focusManager.focusSelector('[data-game-id]'), 60);
    }
  };

  const openSearch = () => {
    const el = document.getElementById('header-search');
    if (el && isTextInput(el)) {
      focusManager.focus(el);
      focusManager.onEditRequest?.(el);
    }
  };

  // ------------------------------------------------------------ game actions
  const patchGame = (id: string | number, patch: Partial<Game>) => {
    const key = String(id);
    startTransition(() => setGames((list) => list.map((g) => (String(g.id) === key ? { ...g, ...patch } : g))));
    setSelectedGame((g) => (g && String(g.id) === key ? { ...g, ...patch } : g));
  };

  /** Update last-played locally; on the Recently Played tab, move the game to the front. */
  const handlePlayed = (game: Game, lastPlayed: string) => {
    patchGame(game.id, { lastPlayed });
    if (source.kind === 'recent') {
      startTransition(() =>
        setGames((list) => (list.some((g) => String(g.id) === String(game.id)) ? list : [{ ...game, lastPlayed }, ...list]))
      );
    }
  };

  const handleDownload = async (game: Game, force = true) => {
    if (!isNativeApp) return toast('Downloads to the Deck require the desktop app', 'error');
    setDownloads((d) => ({
      ...d,
      [String(game.id)]: {
        id: String(game.id), gameId: game.id, title: game.title, platform: game.platformName,
        fileSizeBytes: game.fileSizeBytes, bytesDownloaded: 0, progress: 0, speedMbps: 0, status: 'queued', startedAt: Date.now(),
      },
    }));
    toast(`Downloading ${game.title}`);
    const r = await rommApi.downloadToDeck(game, force && Boolean(game.isInstalled));
    if (r.ok) {
      patchGame(game.id, { isInstalled: true, localPath: r.path });
      if (!r.cached) toast(`${game.title} is ready to play`, 'ok');
    } else if (!r.cancelled && !r.authRequired) {
      toast(r.message || 'Download failed', 'error');
    }
  };

  const handleCancelDownload = (id: string | number) => {
    void rommApi.cancelDownload(id);
  };

  const handleLaunch = async (game: Game) => {
    if (emulator.running) return toast('A game is already running', 'error');
    if (!isNativeApp) {
      playInBrowser(game);
      return;
    }
    const coreId = getActiveCoreForGame(game, config);
    const coreObj = (PLATFORM_AVAILABLE_CORES[game.platformSlug] || []).find((c) => c.id === coreId);
    const coreName = coreObj ? coreObj.name : coreId.toUpperCase();

    soundService.playSelect();
    setLaunchingGame({ game, emulatorName: coreName });
    toast(game.isInstalled ? `Starting ${game.title} with ${coreName}` : `Downloading ${game.title} before launch`);

    try {
      const r = await rommApi.launchNative(game);
      if (r.success) {
        handlePlayed(game, new Date().toISOString());
        patchGame(game.id, { isInstalled: true });
        // Record the play on RomM so Recently Played matches on every device.
        markPlayed(game).then((ts) => ts && handlePlayed(game, ts));
      } else {
        setLaunchingGame(null);
        toast(r.message, 'error');
      }
    } catch (e: any) {
      setLaunchingGame(null);
      toast(e.message || 'Launch error', 'error');
    }
  };

  const handleDelete = async (game: Game) => {
    const r = await rommApi.deleteLocal(game);
    if (r.ok) {
      patchGame(game.id, { isInstalled: false, localPath: undefined });
      toast(`Removed ${game.title} from this Deck`, 'ok');
    } else toast('Could not delete the file', 'error');
  };

  const handleFavorite = (game: Game) => {
    const fav = rommApi.toggleFavorite(game.id);
    patchGame(game.id, { isFavorite: fav });
    soundService.playSuccess();
  };

  const openGame = useCallback((g: Game) => setSelectedGame(g), []);

  // The detail modal is closed while playing (it used to stay stacked above the
  // player) and re-opened on exit so the user lands back where they started.
  const resumeDetailRef = useRef<Game | null>(null);
  const playInBrowser = (g: Game) => {
    focusManager.setEnabled(false);
    resumeDetailRef.current = selectedGame;
    setSelectedGame(null);
    setPlayingGame(g);
  };
  const closeBrowserPlayer = () => {
    setPlayingGame(null);
    gamepadService.setEmulationMode(false);
    // Wait for the button that confirmed "Exit" to be released; otherwise the
    // same press is delivered to the re-opened detail modal and closes it.
    const resume = resumeDetailRef.current;
    resumeDetailRef.current = null;
    window.setTimeout(() => {
      if (resume) setSelectedGame(resume);
      focusManager.setEnabled(true);
      requestAnimationFrame(() => focusManager.ensureFocus());
    }, 300);
  };

  // ------------------------------------------------------------ auth actions
  const onLoggedIn = () => {
    setAuth(rommApi.getAuthStatus());
    setConfig(rommApi.getConfig());
    setLogin({ open: false });
    focusGridOnLoad.current = true;
    setReloadToken((n) => n + 1);
    toast(`Signed in to ${rommApi.getAuthStatus().baseUrl}`, 'ok');
  };

  const onDemo = () => {
    setConfig(rommApi.saveConfig({ isDemoMode: true, firstLaunchSetupCompleted: true }));
    setLogin({ open: false });
    focusGridOnLoad.current = true;
    setReloadToken((n) => n + 1);
  };

  const logout = async () => {
    setMenuOpen(false);
    setSettingsOpen(false);
    await rommApi.logout();
    setConfig(rommApi.saveConfig({ isDemoMode: false }));
    setAuth(rommApi.getAuthStatus());
    setGames([]);
    setPlatforms([]);
    setCollections([]);
    setSource({ kind: 'all' });
    setLogin({ open: true });
  };

  const exitToSteam = async () => {
    setExiting(true);
    soundService.playBack();
    gamepadService.destroy();
    await bridge.app.quit();
  };

  // ------------------------------------------------------------ root (library) controller bindings
  const rootAction = (a: NavigationAction): boolean => {
    switch (a) {
      case 'MENU': setMenuOpen(true); return true;
      case 'FILTER': setSettingsOpen(true); return true;
      case 'ACTION_X': refresh(); return true;
      case 'ACTION_Y': openSearch(); return true;
      case 'PREV_PLATFORM': cycleSource(-1); return true;
      case 'NEXT_PLATFORM': cycleSource(1); return true;
      case 'VIEW_MODE_TOGGLE':
        updateConfig({ viewMode: VIEW_MODES[(VIEW_MODES.indexOf(viewMode) + 1) % VIEW_MODES.length] });
        return true;
      case 'HELP':
        toast('A open  B back  X refresh  Y search  L1/R1 platform  Start menu  Select settings  R-stick scroll');
        return true;
      case 'BACK': {
        if (search) {
          setSearch('');
          return true;
        }
        if (selectedGenre && selectedGenre !== 'all') {
          handleGenreChange('all');
          toast('Cleared genre filter');
          return true;
        }
        const cur = focusManager.getCurrent();
        if (!cur?.hasAttribute('data-game-id')) focusManager.focusSelector('[data-game-id]');
        else focusManager.focusSelector('[data-focus-memory="platforms"] [data-focusable]');
        return true;
      }
      default:
        return false;
    }
  };
  useFocusScope(rootRef, { name: 'library', base: true, onAction: rootAction, initialFocus: '[data-game-id]', active: booted });

  // ------------------------------------------------------------ HUD hints
  const hints: HudHint[] = keyboard
    ? []
    : login.open
    ? [{ button: 'A', label: 'Select' }, { button: 'X', label: 'Test' }, { button: 'START', label: 'Sign in' }]
    : selectedGame
    ? [{ button: 'A', label: 'Select' }, { button: 'B', label: 'Back' }, { button: 'X', label: 'Download' }, { button: 'Y', label: 'Favorite' }, { button: 'R-STICK', label: 'Scroll' }]
    : menuOpen || settingsOpen || downloadsOpen
    ? [{ button: 'A', label: 'Select' }, { button: 'B', label: 'Back' }]
    : [
        { button: 'A', label: 'Open' },
        { button: 'X', label: 'Refresh' },
        { button: 'Y', label: 'Search' },
        { button: 'LB', label: 'Platform' },
        { button: 'SELECT', label: 'Settings' },
        { button: 'START', label: 'Menu' },
      ];

  const progressById = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of Object.values(downloads)) if (d.status === 'downloading' || d.status === 'queued') out[d.id] = d.progress;
    return out;
  }, [downloads]);
  const activeDownloads = Object.keys(progressById).length;
  const serverLabel = config.isDemoMode ? 'Demo library' : (auth.baseUrl || config.serverUrl || 'No server').replace(/^https?:\/\//, '');

  // ------------------------------------------------------------ render
  if (!booted) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-deck-bg">
        <div className="text-4xl font-extrabold tracking-tight">DeckRomM</div>
        <Loader2 className="animate-spin text-deck-accent" size={32} />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div ref={rootRef} className="flex-1 min-h-0 flex flex-col">
        <HeaderBar
          title={sourceLabel(source)}
          subtitle={
            offlineMode
              ? `Offline Mode • Showing Downloaded Games (${visibleGames.length})`
              : auth.username
              ? `Signed in as ${auth.username}`
              : config.isDemoMode
              ? 'Demo mode'
              : undefined
          }
          searchQuery={search}
          onSearchChange={setSearch}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenDownloads={() => setDownloadsOpen(true)}
          onOpenStorage={() => setStorageModalOpen(true)}
          offlineMode={offlineMode}
          onToggleOfflineMode={() => toggleOfflineMode()}
          activeDownloads={activeDownloads}
          connected={!offlineMode && (auth.authenticated || config.isDemoMode)}
          serverLabel={offlineMode ? 'Offline Mode' : serverLabel}
        />
        <PlatformBar
          sources={sources}
          active={source}
          onSelect={selectSource}
          platforms={platforms}
          collections={collections}
          offlineMode={offlineMode}
        />
        <SearchFilterBar
          filter={filter}
          onFilterChange={(f) => updateConfig({ filterTag: f })}
          selectedGenre={selectedGenre}
          onGenreChange={handleGenreChange}
          availableGenres={availableGenres}
          onOpenGenrePicker={() => setGenrePickerOpen(true)}
          selectedLanguage={selectedLanguage}
          onLanguageChange={handleLanguageChange}
          japaneseCount={japaneseCount}
          availableLanguages={availableLanguages}
          onOpenLanguagePicker={() => setLanguagePickerOpen(true)}
          sortBy={sortBy}
          onSortChange={(s) => updateConfig({ sortBy: s })}
          viewMode={viewMode}
          onViewModeChange={(v) => updateConfig({ viewMode: v })}
          resultCount={visibleGames.length}
          totalCount={games.length}
          currentPlatformName={sourceLabel(source)}
          loading={loading}
          onRefresh={refresh}
          onOpenStorage={() => setStorageModalOpen(true)}
          offlineMode={offlineMode}
        />
        <GameGrid
          games={visibleGames}
          viewMode={viewMode}
          loading={loading}
          progressById={progressById}
          onOpen={openGame}
          listKey={listKey}
          selectedGameId={selectedGame ? String(selectedGame.id) : null}
          emptyMessage={
            offlineMode ? (
              <div className="flex flex-col items-center gap-3 max-w-md text-center py-12">
                <div className="h-16 w-16 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <CloudOff size={32} />
                </div>
                <div className="text-xl font-bold text-white">No Downloaded Games Found</div>
                <p className="text-sm text-deck-dim">
                  Offline Mode only shows games downloaded to this Steam Deck that can be played locally without an internet connection.
                </p>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    data-focusable
                    onClick={() => toggleOfflineMode(false)}
                    className="px-4 py-2 rounded-xl bg-deck-accent hover:bg-deck-accent-hover text-white font-bold text-sm transition-transform active:scale-95"
                  >
                    Go Online
                  </button>
                  <button
                    data-focusable
                    onClick={() => selectSource({ kind: 'all' })}
                    className="px-4 py-2 rounded-xl bg-deck-panel-2 border border-deck-line text-white font-semibold text-sm hover:border-deck-dim transition-transform active:scale-95"
                  >
                    All Downloaded
                  </button>
                </div>
              </div>
            ) : loadError ? (
              `Could not load the library: ${loadError}. Press X to retry.`
            ) : search ? (
              `No games match "${search}"`
            ) : selectedLanguage === 'no-ja' && selectedGenre && selectedGenre !== 'all' ? (
              `No non-Japanese ${selectedGenre} games found. Try clearing filters.`
            ) : selectedLanguage === 'no-ja' ? (
              `No non-Japanese games found in ${sourceLabel(source)}.`
            ) : selectedGenre && selectedGenre !== 'all' ? (
              `No ${selectedGenre} games found in ${sourceLabel(source)}. Try selecting "All Genres".`
            ) : (
              'No games here yet'
            )
          }
        />
      </div>

      <ControllerHUD
        hints={hints}
        status={emulator.running ? `Playing ${emulator.title || ''}` : activeDownloads ? `${activeDownloads} download(s) in progress` : serverLabel}
      />

      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          isNative={isNativeApp}
          progress={progressById[String(selectedGame.id)]}
          emulatorRunning={emulator.running}
          config={config}
          onUpdateConfig={updateConfig}
          onClose={() => setSelectedGame(null)}
          onLaunch={handleLaunch}
          onDownload={(g) => handleDownload(g)}
          onCancelDownload={(g) => handleCancelDownload(g.id)}
          onDelete={handleDelete}
          onPlayInBrowser={playInBrowser}
          onToggleFavorite={handleFavorite}
          onGameUpdated={(g) => patchGame(g.id, { summary: g.summary, screenshots: g.screenshots, isInstalled: g.isInstalled, localPath: g.localPath })}
          onSelectGenre={handleGenreChange}
          offlineMode={offlineMode}
          onOpenBiosModal={(slug) => {
            setBiosPlatformFilter(slug);
            setBiosModalOpen(true);
          }}
          onToast={toast}
        />
      )}

      {genrePickerOpen && (
        <GenrePickerModal
          selectedGenre={selectedGenre}
          availableGenres={availableGenres}
          totalGamesCount={games.length}
          platformName={sourceLabel(source)}
          onSelect={handleGenreChange}
          onClose={() => setGenrePickerOpen(false)}
        />
      )}

      {languagePickerOpen && (
        <LanguagePickerModal
          selectedLanguage={selectedLanguage}
          availableLanguages={availableLanguages}
          totalGamesCount={games.length}
          platformName={sourceLabel(source)}
          onSelect={handleLanguageChange}
          onClose={() => setLanguagePickerOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsScreen
          config={config}
          auth={auth}
          onChange={updateConfig}
          onClose={() => setSettingsOpen(false)}
          onSignIn={() => setLogin({ open: true })}
          onLogout={logout}
          onToast={toast}
          onOpenEmulatorsModal={() => {
            setSettingsOpen(false);
            setStandaloneEmulatorsModalOpen(true);
          }}
          onOpenBiosModal={() => {
            setSettingsOpen(false);
            setBiosPlatformFilter(undefined);
            setBiosModalOpen(true);
          }}
          onOpenUpdateModal={() => {
            setSettingsOpen(false);
            setUpdateModalOpen(true);
          }}
          onOpenStorage={() => {
            setSettingsOpen(false);
            setStorageModalOpen(true);
          }}
        />
      )}

      {downloadsOpen && (
        <DownloadsPanel
          items={Object.values(downloads).sort((a, b) => b.startedAt - a.startedAt)}
          onCancel={(d) => handleCancelDownload(d.gameId)}
          onClearFinished={() => setDownloads((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v.status === 'downloading' || v.status === 'queued')))}
          onClose={() => setDownloadsOpen(false)}
        />
      )}

      {menuOpen && (
        <MainMenu
          username={auth.username}
          serverLabel={serverLabel}
          authenticated={auth.authenticated || config.isDemoMode}
          offlineMode={offlineMode}
          onToggleOfflineMode={() => toggleOfflineMode()}
          onClose={() => setMenuOpen(false)}
          onLibrary={() => setMenuOpen(false)}
          onSearch={() => {
            setMenuOpen(false);
            setTimeout(openSearch, 60);
          }}
          onRefresh={() => {
            setMenuOpen(false);
            refresh();
          }}
          onDownloads={() => {
            setMenuOpen(false);
            setDownloadsOpen(true);
          }}
          onStorage={() => {
            setMenuOpen(false);
            setStorageModalOpen(true);
          }}
          onSettings={() => {
            setMenuOpen(false);
            setSettingsOpen(true);
          }}
          onPatcher={() => {
            setMenuOpen(false);
            setPatcherModalOpen(true);
          }}
          onEmulators={() => {
            setMenuOpen(false);
            setStandaloneEmulatorsModalOpen(true);
          }}
          onBios={() => {
            setMenuOpen(false);
            setBiosPlatformFilter(undefined);
            setBiosModalOpen(true);
          }}
          onUpdate={() => {
            setMenuOpen(false);
            setUpdateModalOpen(true);
          }}
          onSignIn={() => {
            setMenuOpen(false);
            setLogin({ open: true });
          }}
          onLogout={logout}
          onToggleFullscreen={() => void bridge.app.toggleFullscreen()}
          onExit={exitToSteam}
        />
      )}

      {login.open && (
        <LoginOverlay
          initialUrl={auth.baseUrl || config.serverUrl || ''}
          initialUsername={auth.username || ''}
          reason={login.reason}
          canCancel={auth.authenticated || config.isDemoMode || offlineMode}
          onCancel={() => setLogin({ open: false })}
          onLoggedIn={onLoggedIn}
          onDemo={onDemo}
          onPlayOffline={() => {
            toggleOfflineMode(true);
            setLogin({ open: false });
          }}
        />
      )}

      {patcherModalOpen && (
        <RomPatcherModal
          game={
            selectedGame ||
            games[0] || {
              id: 'community-library',
              title: 'Community ROM Library',
              platformSlug: 'snes',
              platformName: 'Multi-System',
              fileName: 'game.bin',
              fileSizeBytes: 0,
              releaseYear: 0,
              developer: '',
              publisher: '',
              genres: [],
              rating: 0,
              summary: 'Browse and search community patches across retro platforms.',
              coverUrl: '',
            }
          }
          onClose={() => setPatcherModalOpen(false)}
          onSuccess={() => {
            refresh();
          }}
        />
      )}

      {standaloneEmulatorsModalOpen && (
        <StandaloneEmulatorsModal
          isOpen={standaloneEmulatorsModalOpen}
          onClose={() => setStandaloneEmulatorsModalOpen(false)}
          onToast={(text, tone) => toast(text, tone || 'info')}
          onOpenBiosModal={(slug) => {
            setStandaloneEmulatorsModalOpen(false);
            setBiosPlatformFilter(slug);
            setBiosModalOpen(true);
          }}
        />
      )}

      {biosModalOpen && (
        <BiosManagerModal
          isOpen={biosModalOpen}
          onClose={() => setBiosModalOpen(false)}
          onToast={toast}
          initialPlatformFilter={biosPlatformFilter}
        />
      )}

      {storageModalOpen && (
        <StorageManagerModal
          isOpen={storageModalOpen}
          onClose={() => setStorageModalOpen(false)}
          onToast={toast}
          onLaunchGame={handleLaunch}
          onGameDeleted={(_id) => {
            refresh();
          }}
        />
      )}

      {updateModalOpen && (
        <UpdateManagerModal
          isOpen={updateModalOpen}
          onClose={() => setUpdateModalOpen(false)}
          config={config}
          onChangeConfig={updateConfig}
          onToast={toast}
          initialUpdateInfo={availableUpdate}
        />
      )}

      {emulator.running && (
        <div className="fixed inset-0 z-[160] bg-black/90 flex items-center justify-center">
          <FocusScope name="emulator-running" initialFocus="#stop-game" className="flex flex-col items-center gap-5 text-center">
            <Loader2 className="animate-spin text-deck-accent" size={40} />
            <div className="text-2xl font-extrabold">Playing {emulator.title || 'game'}</div>
            <div className="text-deck-dim max-w-md">The emulator is running. Quit it normally to return here, or stop it if it stopped responding.</div>
            <button id="stop-game" data-focusable onClick={() => void bridge.emulator.kill()} className="h-12 px-6 rounded-xl bg-deck-danger text-white font-bold flex items-center gap-2">
              <Square size={18} /> Stop game
            </button>
          </FocusScope>
        </div>
      )}

      <VirtualKeyboardModal
        isOpen={Boolean(keyboard)}
        title={keyboard?.title}
        initialValue={keyboard?.value}
        placeholder={keyboard?.placeholder}
        mode={keyboard?.mode}
        onClose={() => setKeyboard(null)}
        onSubmit={submitKeyboard}
      />

      {playingGame && <WebEmulatorModal key={String(playingGame.id)} game={playingGame} onClose={closeBrowserPlayer} onLaunchNative={handleLaunch} onPlayed={handlePlayed} />}

      {launchingGame && (
        <LaunchingOverlay
          game={launchingGame.game}
          emulatorName={launchingGame.emulatorName}
          onCancel={() => setLaunchingGame(null)}
        />
      )}

      <div className="fixed top-20 right-5 z-[300] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`deck-enter max-w-[420px] px-4 py-3 rounded-xl shadow-xl border text-sm font-semibold ${
              t.tone === 'error' ? 'bg-[#3a1414] border-deck-danger text-red-100' : t.tone === 'ok' ? 'bg-[#15301a] border-deck-ok text-green-100' : 'bg-deck-panel-2 border-deck-line text-deck-text'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {exiting && (
        <div className="fixed inset-0 z-[400] bg-black flex items-center justify-center text-xl font-bold">Returning to Steam</div>
      )}
    </div>
  );
}
