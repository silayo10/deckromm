/**
 * RomM API service (renderer side).
 *
 * All HTTP goes through the Electron main process (`bridge.romm.request`), so:
 *   - the React thread never blocks on network or large JSON parses,
 *   - bearer tokens / session cookies never live in renderer memory,
 *   - 401/403 responses surface as a single `auth-required` event that the App
 *     turns into the gamepad-friendly LoginOverlay.
 *
 * ROM lists are fetched page by page and mapped in small chunks that yield to
 * the event loop between chunks, keeping input handling at 60 fps even for
 * libraries with thousands of ROMs.
 */
import { Collection, Game, Platform, RommConfig, getActiveCoreForGame, RommFirmwareItem, normalizeGenre } from '../types';
import type { AuthResult, AuthStatus, RomFileRequest, RommRequest, ServerProbe, XboxEmulatorStatus, NativeStorage, Pcsx2MemcardStatus } from '../env/electron';
import { DEMO_GAMES, DEMO_PLATFORMS } from './rommData';
import { assetUrl, bridge, isNativeApp } from './bridge';
import { parseRomFileName } from '../utils/languageUtils';

export const DEMO_FIRMWARE: RommFirmwareItem[] = [
  {
    id: 101,
    fileName: 'scph39001.bin',
    fileSizeBytes: 4194304,
    platformId: 10,
    platformSlug: 'ps2',
    platformName: 'PlayStation 2',
    isVerified: true,
    md5Hash: 'd5ce2c7d1108ab2e2978ff72210fbcf6',
    description: 'PlayStation 2 NTSC-U BIOS (v01.60) - Required for PCSX2 standalone emulator',
    requiredForEmulators: ['pcsx2'],
  },
  {
    id: 102,
    fileName: 'scph70012.bin',
    fileSizeBytes: 4194304,
    platformId: 10,
    platformSlug: 'ps2',
    platformName: 'PlayStation 2',
    isVerified: true,
    description: 'PlayStation 2 Slim NTSC-U BIOS (v02.00) - High compatibility for PCSX2',
    requiredForEmulators: ['pcsx2'],
  },
  {
    id: 103,
    fileName: 'scph10000.bin',
    fileSizeBytes: 4194304,
    platformId: 10,
    platformSlug: 'ps2',
    platformName: 'PlayStation 2',
    isVerified: true,
    description: 'PlayStation 2 NTSC-J BIOS (v01.00) - For Japanese PS2 releases in PCSX2',
    requiredForEmulators: ['pcsx2'],
  },
  {
    id: 201,
    fileName: 'scph5501.bin',
    fileSizeBytes: 524288,
    platformId: 9,
    platformSlug: 'psx',
    platformName: 'PlayStation (PS1)',
    isVerified: true,
    md5Hash: '924e392ed05558ffdb115408c163d70e',
    description: 'PlayStation 1 NTSC-U BIOS (v3.0) - DuckStation & RetroArch',
    requiredForEmulators: ['duckstation', 'retroarch'],
  },
  {
    id: 202,
    fileName: 'scph5500.bin',
    fileSizeBytes: 524288,
    platformId: 9,
    platformSlug: 'psx',
    platformName: 'PlayStation (PS1)',
    isVerified: true,
    description: 'PlayStation 1 NTSC-J BIOS - DuckStation & RetroArch',
    requiredForEmulators: ['duckstation'],
  },
  {
    id: 301,
    fileName: 'dc_boot.bin',
    fileSizeBytes: 2097152,
    platformId: 13,
    platformSlug: 'dc',
    platformName: 'Sega Dreamcast',
    isVerified: true,
    description: 'Dreamcast Boot ROM - Required for Flycast emulator',
    requiredForEmulators: ['flycast'],
  },
  {
    id: 302,
    fileName: 'dc_flash.bin',
    fileSizeBytes: 131072,
    platformId: 13,
    platformSlug: 'dc',
    platformName: 'Sega Dreamcast',
    isVerified: true,
    description: 'Dreamcast NVRAM / Flash settings storage',
    requiredForEmulators: ['flycast'],
  },
  {
    id: 401,
    fileName: 'gba_bios.bin',
    fileSizeBytes: 16384,
    platformId: 3,
    platformSlug: 'gba',
    platformName: 'Game Boy Advance',
    isVerified: true,
    description: 'Official GBA Boot ROM for authentic boot animation & sound in mGBA',
    requiredForEmulators: ['retroarch'],
  },
  {
    id: 501,
    fileName: 'mcpx_1.0.bin',
    fileSizeBytes: 512,
    platformId: 10,
    platformSlug: 'xbox',
    platformName: 'Microsoft Xbox',
    isVerified: true,
    description: 'Xbox MCPX Boot ROM (512 B) - Required by xemu to initialize hardware',
    requiredForEmulators: ['xemu'],
  },
  {
    id: 502,
    fileName: 'Complex_4627.bin',
    fileSizeBytes: 1048576,
    platformId: 10,
    platformSlug: 'xbox',
    platformName: 'Microsoft Xbox',
    isVerified: true,
    description: 'Xbox Flash ROM / BIOS (1 MB) - Required by xemu to execute Xbox kernel',
    requiredForEmulators: ['xemu'],
  },
  {
    id: 503,
    fileName: 'xbox_hdd.qcow2',
    fileSizeBytes: 8589934592,
    platformId: 10,
    platformSlug: 'xbox',
    platformName: 'Microsoft Xbox',
    isVerified: true,
    description: 'Xbox Virtual Hard Disk (8 GB QCOW2) - Required by xemu for dashboard & cache partitions',
    requiredForEmulators: ['xemu'],
  },
];

const LEGACY_CONFIG_KEY = 'deckromm_config_v1';
const FAVORITES_KEY = 'deckromm_favorites_v2';
const LIBRARY_CACHE_KEY = 'deckromm_library_cache_v1';
const PLATFORMS_CACHE_KEY = 'deckromm_platforms_cache_v1';
const PAGE_SIZE = 250;
const MAP_CHUNK = 60;

export const STREAMABLE_PLATFORM_SLUGS = new Set([
  'snes', 'super-nintendo', 'sfam', 'gba', 'game-boy-advance', 'genesis', 'genesis-slash-megadrive', 'megadrive',
  'nes', 'famicom', 'gb', 'gbc', 'gameboy', 'n64', 'nintendo-64', 'nds', 'nintendo-ds', 'psx', 'ps1', 'playstation',
  'arcade', 'mame', 'mastersystem', 'sms', 'gamegear', 'gg',
  'saturn', 'sega-saturn', 'dc', 'dreamcast', 'pce', 'turbografx-16', 'ngp', 'ngpc', 'ws', 'wonderswan', 'vb', 'virtualboy',
  'atari2600', 'atari7800', 'lynx',
]);

export const DEFAULT_CONFIG: RommConfig = {
  serverUrl: '',
  isDemoMode: !isNativeApp,
  offlineOnlyMode: false,
  autoCacheBoxArt: true,
  emulationPath: '',
  audioFeedback: true,
  displayMode: 'deck',
  firstLaunchSetupCompleted: false,
  defaultPlatform: 'all',
  hideInfoFiles: true,
  viewMode: 'grid',
  sortBy: 'title',
  filterTag: 'all',
  genreFilter: 'all',
  languageFilter: 'all',
  hideJapanese: false,
  launcherMode: 'auto',
  customLaunchCommand: '',
  launcherOverrides: {},
  retroarchFullscreen: true,
};

export class RommApiError extends Error {
  status: number;
  authRequired: boolean;
  constructor(message: string, status = 0, authRequired = false) {
    super(message);
    this.status = status;
    this.authRequired = authRequired;
  }
}

export interface LastError {
  status?: number;
  message: string;
  requiresAuth?: boolean;
}

export interface GameQuery {
  platform?: Platform | null;
  platforms?: Platform[] | null;
  collectionId?: string | number | null;
  search?: string;
  signal?: AbortSignal;
  /** Receives partial results after each page so the grid can render progressively. */
  onPage?: (gamesSoFar: Game[], total: number) => void;
}

/** Yield to the event loop so gamepad polling / React commits can run. */
const yieldToMain = (): Promise<void> => {
  const sched = (globalThis as any).scheduler;
  if (sched && typeof sched.yield === 'function') return sched.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
};

function toYear(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') {
    // RomM stores epoch milliseconds in metadatum, IGDB uses seconds.
    const ms = v > 1e11 ? v : v * 1000;
    const y = new Date(ms).getFullYear();
    return Number.isFinite(y) ? y : 0;
  }
  const y = new Date(v).getFullYear();
  return Number.isFinite(y) ? y : 0;
}

function normalizeSlug(s: any): string {
  return String(s || 'unknown').toLowerCase().replace(/\s+/g, '-');
}

function readFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

class RommApiService {
  private config: RommConfig = { ...DEFAULT_CONFIG };
  private auth: AuthStatus = { authenticated: false, baseUrl: null, method: null, username: null };
  private lastError: LastError | null = null;
  private authListeners = new Set<(info: { status: number; message: string }) => void>();
  private favorites = readFavorites();
  private initialized = false;

  constructor() {
    bridge.on('auth:required', (info) => {
      this.auth = { ...this.auth, authenticated: false };
      this.lastError = { status: info.status, message: info.message, requiresAuth: true };
      this.authListeners.forEach((l) => l(info));
    });
  }

  // ------------------------------------------------------------------ setup
  /** Load persisted config + auth status from the main process. Call once at boot. */
  async init(): Promise<RommConfig> {
    const stored = await bridge.config.get().catch(() => ({}));
    let merged: RommConfig = { ...DEFAULT_CONFIG, ...(stored as Partial<RommConfig>) };

    // One-time migration from the v1 localStorage config (drops plaintext secrets).
    try {
      const legacyRaw = localStorage.getItem(LEGACY_CONFIG_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        const { password: _p, apiToken: _t, username: _u, useProxy: _x, ipOrHostname: _i, port: _o, protocol: _r, ...rest } = legacy;
        merged = { ...merged, ...rest, serverUrl: merged.serverUrl || legacy.serverUrl || '' };
        localStorage.removeItem(LEGACY_CONFIG_KEY);
        await bridge.config.set(merged);
      }
    } catch {
      /* ignore */
    }

    this.auth = await bridge.auth.status().catch(() => this.auth);
    if (this.auth.baseUrl && !merged.serverUrl) merged.serverUrl = this.auth.baseUrl;
    if (!isNativeApp && !this.auth.authenticated && (stored as Partial<RommConfig>).isDemoMode === undefined) {
      merged.isDemoMode = true;
    }
    this.config = merged;
    this.initialized = true;
    return this.getConfig();
  }

  isInitialized() {
    return this.initialized;
  }

  isFirstLaunch(): boolean {
    return !this.config.firstLaunchSetupCompleted && !this.auth.authenticated && !this.config.isDemoMode;
  }

  setFirstLaunchCompleted(done: boolean) {
    this.saveConfig({ firstLaunchSetupCompleted: done });
  }

  getConfig(): RommConfig {
    return { ...this.config };
  }

  /** Synchronous in-memory update; persistence to disk happens asynchronously in main. */
  saveConfig(patch: Partial<RommConfig>): RommConfig {
    const { password: _p, apiToken: _t, ...safe } = patch;
    this.config = { ...this.config, ...safe };
    void bridge.config.set(safe).catch((e) => console.warn('config persist failed', e));
    return this.getConfig();
  }

  getLastError(): LastError | null {
    return this.lastError;
  }

  // ------------------------------------------------------------------ auth
  getAuthStatus(): AuthStatus {
    return { ...this.auth };
  }

  async refreshAuthStatus(): Promise<AuthStatus> {
    this.auth = await bridge.auth.status();
    return this.getAuthStatus();
  }

  onAuthRequired(cb: (info: { status: number; message: string }) => void): () => void {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  testServer(url: string): Promise<ServerProbe> {
    return bridge.auth.testServer(url);
  }

  private async afterLogin(res: AuthResult, baseUrl: string): Promise<AuthResult> {
    if (res.ok) {
      this.lastError = null;
      await this.refreshAuthStatus();
      this.saveConfig({ serverUrl: this.auth.baseUrl || baseUrl, isDemoMode: false, firstLaunchSetupCompleted: true });
    }
    return res;
  }

  async loginWithPassword(baseUrl: string, username: string, password: string, remember = true): Promise<AuthResult> {
    return this.afterLogin(await bridge.auth.loginPassword({ baseUrl, username, password, remember }), baseUrl);
  }

  async loginWithToken(baseUrl: string, token: string): Promise<AuthResult> {
    return this.afterLogin(await bridge.auth.loginToken({ baseUrl, token }), baseUrl);
  }

  async loginWithPairingCode(baseUrl: string, code: string): Promise<AuthResult> {
    return this.afterLogin(await bridge.auth.pair({ baseUrl, code }), baseUrl);
  }

  async logout(): Promise<void> {
    await bridge.auth.logout();
    await this.refreshAuthStatus();
  }

  /** @deprecated v1 API kept for older components. */
  async login(username: string, password: string, serverUrl: string) {
    const r = await this.loginWithPassword(serverUrl, username, password);
    return { success: r.ok, token: '', message: r.message };
  }

  /** @deprecated v1 API kept for older components. */
  async testConnection(url: string, token?: string) {
    if (token) {
      const r = await this.loginWithToken(url, token);
      return { success: r.ok, message: r.message };
    }
    const p = await this.testServer(url);
    return { success: p.ok, message: p.message, version: p.version };
  }

  // ------------------------------------------------------------------ transport
  private async request<T>(req: RommRequest): Promise<T> {
    const res = await bridge.romm.request<T>(req);
    if (!res.ok) {
      const authRequired = Boolean(res.authRequired || res.status === 401 || res.status === 403);
      this.lastError = { status: res.status, message: res.message || `HTTP ${res.status}`, requiresAuth: authRequired };
      throw new RommApiError(res.message || `HTTP ${res.status}`, res.status, authRequired);
    }
    this.lastError = null;
    return res.data as T;
  }

  // ------------------------------------------------------------------ catalog
  private savePlatformsCache(platforms: Platform[]) {
    try {
      localStorage.setItem(PLATFORMS_CACHE_KEY, JSON.stringify(platforms));
    } catch {
      /* ignore */
    }
  }

  getCachedOrLocalPlatforms(): Platform[] {
    try {
      const raw = localStorage.getItem(PLATFORMS_CACHE_KEY);
      if (raw) {
        const list: Platform[] = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) return list;
      }
    } catch {
      /* ignore */
    }
    return [...DEMO_PLATFORMS];
  }

  async getPlatforms(): Promise<Platform[]> {
    if (this.config.offlineOnlyMode) {
      return this.getCachedOrLocalPlatforms();
    }
    if (this.config.isDemoMode) return [...DEMO_PLATFORMS];
    try {
      const data = await this.request<any>({ path: '/api/platforms' });
      const list: any[] = Array.isArray(data) ? data : data?.items || [];
      const plats = list
        .map((p): Platform => {
          const slug = normalizeSlug(p.slug || p.fs_slug || p.name);
          return {
            id: p.id,
            slug,
            name: p.display_name || p.custom_name || p.name || p.slug,
            shortName: String(p.custom_name || p.slug || p.name || '').toUpperCase().slice(0, 8),
            manufacturer: p.family_name || p.manufacturer || '',
            generation: p.generation ? String(p.generation) : '',
            color: '#3b82f6',
            gameCount: Number(p.rom_count ?? p.roms_count ?? 0),
            extensions: p.extensions || [],
            emulatorCore: getEmulatorCore(slug),
            canStreamOnline: STREAMABLE_PLATFORM_SLUGS.has(slug),
          };
        })
        .filter((p) => p.gameCount > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (plats.length > 0) this.savePlatformsCache(plats);
      return plats;
    } catch (e) {
      console.warn('getPlatforms failed, falling back to cached platforms', e);
      return this.getCachedOrLocalPlatforms();
    }
  }

  async getCollections(): Promise<Collection[]> {
    if (this.config.isDemoMode) return [];
    try {
      const data = await this.request<any>({ path: '/api/collections' });
      const list: any[] = Array.isArray(data) ? data : data?.items || [];
      return list.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
        romCount: Number(c.rom_count ?? (Array.isArray(c.rom_ids) ? c.rom_ids.length : 0)),
        coverUrl: assetUrl(c.path_cover_large || c.path_cover_small || c.url_cover, this.config.serverUrl),
      }));
    } catch (e) {
      console.warn('getCollections failed', e);
      return [];
    }
  }

  private mapRom(r: any): Game {
    const base = this.config.serverUrl;
    const meta = r.metadatum || {};
    const slug = normalizeSlug(r.platform_slug || r.platform?.slug || r.platform_fs_slug);
    const cover = r.path_cover_large || r.path_cover_small || r.url_cover || '';
    const screenshots: string[] = (r.merged_screenshots || r.url_screenshots || [])
      .map((s: any) => (typeof s === 'string' ? s : s?.download_path || s?.url))
      .filter(Boolean)
      .map((s: string) => assetUrl(s, base));
    const companies: string[] = Array.isArray(meta.companies) ? meta.companies : Array.isArray(r.companies) ? r.companies : [];
    const rawGenres: string[] = (meta.genres || r.genres || []).map((g: any) => (typeof g === 'string' ? g : g?.name)).filter(Boolean);
    const genres: string[] = Array.from(new Set(rawGenres.map((g: string) => normalizeGenre(g)).filter(Boolean)));
    const ratingRaw = Number(meta.average_rating ?? r.average_rating ?? r.igdb_metadata?.total_rating ?? 0);
    const rating = ratingRaw > 0 && ratingRaw <= 10 ? Math.round(ratingRaw * 10) : Math.round(ratingRaw);
    const id = r.id;
    const tags: string[] = (r.tags || meta.tags || []).map((t: any) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
    const files = Array.isArray(r.files)
      ? r.files.map((f: any) => ({
          id: f.id,
          fileName: f.file_name || f.fs_name || f.name || 'file',
          fileSizeBytes: Number(f.file_size_bytes || f.fs_size_bytes || 0),
          path: f.path_file || f.path || '',
        }))
      : [];

    const serverFav = Boolean(r.rom_user?.is_favorite || r.is_favorite);
    if (serverFav) this.favorites.add(String(id));

    const fileName = r.fs_name || r.file_name || `${r.name || 'rom'}.bin`;
    const parsedFileMeta = parseRomFileName(fileName);
    const rawLanguages = r.languages || meta.languages || [];
    const normalizedLangs = Array.isArray(rawLanguages)
      ? rawLanguages.map((l: any) => (typeof l === 'string' ? l : l?.name || l?.code)).filter(Boolean)
      : [];
    const languages = normalizedLangs.length > 0 ? normalizedLangs : parsedFileMeta.languages;
    const region = (r.regions && r.regions[0]) || r.region || meta.region || parsedFileMeta.region || '';

    return {
      id,
      title: r.name || r.fs_name_no_ext || String(r.fs_name || 'Untitled').replace(/\.[^/.]+$/, ''),
      platformId: r.platform_id,
      platformSlug: slug,
      platformName: r.platform_display_name || r.platform_custom_name || r.platform_name || slug.toUpperCase(),
      releaseYear: toYear(meta.first_release_date ?? r.first_release_date ?? r.release_date),
      developer: companies[0] || '',
      publisher: companies[1] || companies[0] || '',
      genres,
      rating,
      summary: r.summary || '',
      coverUrl: assetUrl(cover, base),
      backdropUrl: screenshots[0] || assetUrl(cover, base),
      screenshots,
      fileName,
      fileSizeBytes: Number(r.fs_size_bytes || r.file_size_bytes || 0),
      crc: r.crc_hash || '',
      md5: r.md5_hash || '',
      sha1: r.sha1_hash || '',
      region,
      languages,
      players: meta.player_count || r.player_count || '',
      igdbId: r.igdb_id,
      mobyId: r.moby_id,
      isFavorite: this.favorites.has(String(id)),
      lastPlayed: r.rom_user?.last_played || undefined,
      playableOnline: STREAMABLE_PLATFORM_SLUGS.has(slug),
      isMultiFile: Boolean(r.multi || files.length > 1),
      tags,
      files,
    };
  }

  /** Map raw items in chunks, yielding between chunks. */
  private async mapChunked(items: any[], signal?: AbortSignal): Promise<Game[]> {
    const out: Game[] = [];
    for (let i = 0; i < items.length; i += MAP_CHUNK) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      for (const raw of items.slice(i, i + MAP_CHUNK)) {
        const g = this.mapRom(raw);
        if (this.config.hideInfoFiles === false || !isInfoOrJunkRom(g)) out.push(g);
      }
      await yieldToMain();
    }
    return out;
  }

  /** Mark which games already exist in the local Emulation/roms folder. */
  async annotateInstalled(games: Game[]): Promise<Game[]> {
    if (!isNativeApp || games.length === 0) return games;
    const status = await bridge.roms.localStatus(
      games.map((g) => ({ romId: g.id, platformSlug: g.platformSlug, fileName: g.fileName }))
    );
    return games.map((g) => {
      const s = status[String(g.id)];
      return s ? { ...g, isInstalled: s.exists, isCached: s.exists, localPath: s.path } : g;
    });
  }

  async getGamesPaged(q: GameQuery = {}): Promise<Game[]> {
    if (this.config.offlineOnlyMode) {
      return this.getOfflineGames(q);
    }

    if (this.config.isDemoMode) {
      let demo = [...DEMO_GAMES];
      if (q.platform && q.platform.slug !== 'all') {
        demo = demo.filter((g) => g.platformSlug === q.platform!.slug);
      } else if (q.platforms && q.platforms.length > 0) {
        const slugs = new Set(q.platforms.map((p) => p.slug));
        demo = demo.filter((g) => slugs.has(g.platformSlug));
      }
      if (q.search) demo = demo.filter((g) => g.title.toLowerCase().includes(q.search!.toLowerCase()));
      return demo.map((g) => ({ ...g, isFavorite: this.favorites.has(String(g.id)) }));
    }

    try {
      const query: RommRequest['query'] = { limit: PAGE_SIZE, order_by: 'name', order_dir: 'asc' };
      if (q.platform && q.platform.slug !== 'all' && q.platform.id != null) {
        // RomM 5.x uses platform_ids, 4.x uses platform_id - unknown params are ignored.
        query.platform_ids = [q.platform.id as number];
        query.platform_id = q.platform.id as number;
      } else if (q.platforms && q.platforms.length > 0) {
        query.platform_ids = q.platforms.map((p) => p.id as number);
      }
      if (q.collectionId != null) query.collection_id = q.collectionId as number;
      if (q.search && q.search.trim()) query.search_term = q.search.trim();

      const all: Game[] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        if (q.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const data = await this.request<any>({ path: '/api/roms', query: { ...query, offset }, timeoutMs: 45000 });
        const items: any[] = Array.isArray(data) ? data : data?.items || [];
        total = Array.isArray(data) ? items.length : Number(data?.total ?? items.length);
        let mapped = await this.annotateInstalled(await this.mapChunked(items, q.signal));
        if (q.platforms && q.platforms.length > 0) {
          const allowed = new Set(q.platforms.map((p) => p.slug));
          if (mapped.some((g) => !allowed.has(g.platformSlug))) {
            mapped = mapped.filter((g) => allowed.has(g.platformSlug));
          }
        }
        all.push(...mapped);
        q.onPage?.(all.slice(), total);
        if (items.length === 0 || Array.isArray(data)) break;
        offset += items.length;
      }
      this.saveLibraryCache(all);
      return all;
    } catch (e: any) {
      if (q.signal?.aborted || e?.name === 'AbortError') throw e;
      console.warn('getGamesPaged error, falling back to local offline games:', e);
      return this.getOfflineGames(q);
    }
  }

  /**
   * Recently played games for the signed-in user, newest first. Comes from RomM
   * (rom_user.last_played), so the list is the same on every device and in the
   * RomM web UI. Older servers that ignore the last_played filter fall back to
   * a full library scan.
   */
  async getRecentlyPlayed(limit = 30, signal?: AbortSignal): Promise<Game[]> {
    const ts = (g: Game) => (g.lastPlayed ? Date.parse(g.lastPlayed) || 0 : 0);
    const finish = (list: Game[]) => list.filter((g) => ts(g) > 0).sort((a, b) => ts(b) - ts(a)).slice(0, limit);
    if (this.config.offlineOnlyMode) {
      const offline = await this.getOfflineGames();
      return finish(offline);
    }
    if (this.config.isDemoMode) return finish(DEMO_GAMES.map((g) => ({ ...g, isFavorite: this.favorites.has(String(g.id)) })));
    try {
      const data = await this.request<any>({
        path: '/api/roms',
        query: { order_by: 'last_played', order_dir: 'desc', last_played: 'true', limit, with_char_index: 'false', with_filter_values: 'false' },
        timeoutMs: 30000,
      });
      const items: any[] = Array.isArray(data) ? data : data?.items || [];
      const mapped = await this.annotateInstalled(await this.mapChunked(items, signal));
      const filterIgnored = items.length >= limit && mapped.some((g) => !g.lastPlayed);
      if (!filterIgnored) return finish(mapped);
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      console.warn('getRecentlyPlayed failed, falling back to offline games:', e);
      const offline = await this.getOfflineGames();
      return finish(offline);
    }
    return finish(await this.getGamesPaged({ signal }));
  }

  /** @deprecated v1 signature: getGames(platformSlug?, search?) */
  async getGames(platformSlug?: string, searchQuery?: string): Promise<Game[]> {
    const platforms = platformSlug && platformSlug !== 'all' ? await this.getPlatforms() : [];
    const platform = platforms.find((p) => p.slug === platformSlug) || null;
    return this.getGamesPaged({ platform, search: searchQuery });
  }

  /** Full details (summary, screenshots, files) for the detail view. */
  async getGameDetails(game: Game): Promise<Game> {
    if (this.config.isDemoMode) return game;
    try {
      const raw = await this.request<any>({ path: `/api/roms/${encodeURIComponent(String(game.id))}` });
      const [mapped] = await this.annotateInstalled([this.mapRom(raw)]);
      return { ...game, ...mapped };
    } catch {
      return game;
    }
  }

  async getGameById(id: string | number): Promise<Game | null> {
    if (this.config.isDemoMode) return DEMO_GAMES.find((g) => String(g.id) === String(id)) || null;
    try {
      const raw = await this.request<any>({ path: `/api/roms/${encodeURIComponent(String(id))}` });
      return this.mapRom(raw);
    } catch {
      return null;
    }
  }

  toggleFavorite(gameId: string | number): boolean {
    const key = String(gameId);
    let isFav = false;
    if (this.favorites.has(key)) {
      this.favorites.delete(key);
      isFav = false;
    } else {
      this.favorites.add(key);
      isFav = true;
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...this.favorites]));

    // Asynchronously push favorite status to RomM server if authenticated
    if (!this.config.isDemoMode) {
      void this.request({
        path: `/api/roms/${encodeURIComponent(String(gameId))}/user`,
        method: 'PUT',
        body: JSON.stringify({ is_favorite: isFav }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {
        void this.request({
          path: `/api/roms/${encodeURIComponent(String(gameId))}/favorite`,
          method: 'POST',
          body: JSON.stringify({ favorite: isFav }),
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      });
    }

    return isFav;
  }

  /** Trigger a server-side library scan or metadata refresh on RomM. */
  async triggerServerScan(type: 'quick' | 'full' | 'unmatched' = 'quick'): Promise<{ success: boolean; message: string }> {
    if (this.config.isDemoMode) return { success: true, message: 'Simulated scan triggered in Demo Mode.' };
    try {
      const path = type === 'full' ? '/api/tasks/rescan' : '/api/tasks/scan';
      const res = await this.request<any>({
        path,
        method: 'POST',
        body: JSON.stringify({ mode: type, scan_type: type }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(async () => {
        return await this.request<any>({
          path: '/api/scan',
          method: 'POST',
          body: JSON.stringify({ mode: type }),
          headers: { 'Content-Type': 'application/json' },
        });
      });
      return { success: true, message: res?.message || `RomM server ${type} library scan started.` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Failed to trigger RomM server scan.' };
    }
  }

  /** Fetch available server tags. */
  async getTags(): Promise<string[]> {
    if (this.config.isDemoMode) return ['Must Play', 'Fan Translation', 'Favorites', 'Multidisc', 'Completed'];
    try {
      const data = await this.request<any>({ path: '/api/tags' });
      const list: any[] = Array.isArray(data) ? data : data?.items || [];
      return list.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------ firmware & bios
  /**
   * Fetch firmware and BIOS files from RomM or demo data, enriched with local status.
   */
  async getFirmware(platformId?: number): Promise<RommFirmwareItem[]> {
    let items: RommFirmwareItem[] = [];

    if (!this.config.isDemoMode) {
      try {
        const query: Record<string, any> = {};
        if (platformId) query.platform_id = platformId;
        const res = await this.request<any>({ path: '/api/firmware', query });
        const list: any[] = Array.isArray(res) ? res : res?.items || res?.data || [];
        if (list.length > 0) {
          const platforms = await this.getPlatforms().catch(() => []);
          const platformMap = new Map<number, Platform>();
          platforms.forEach((p) => {
            if (p.id) platformMap.set(Number(p.id), p);
          });

          items = list.map((f: any) => {
            const plat = platformMap.get(Number(f.platform_id));
            const rawSlug = plat?.slug || String(f.platform_slug || f.platform_name || '').toLowerCase();
            const slug = rawSlug.includes('playstation-2') || rawSlug.includes('ps2') ? 'ps2' : rawSlug;
            const emus: string[] = [];
            const fileName = String(f.file_name || f.fileName || '');
            if (['ps2', 'playstation-2', 'playstation2', 'sony-playstation-2'].includes(slug) || /scph|ps2|erom|rom1/i.test(fileName)) emus.push('pcsx2');
            if (['psx', 'ps1', 'playstation'].includes(slug) || /scph[1-9]00/i.test(fileName)) emus.push('duckstation', 'retroarch');
            if (['dc', 'dreamcast'].includes(slug) || /dc_|boot\.bin/i.test(fileName)) emus.push('flycast');
            if (['psp'].includes(slug)) emus.push('ppsspp');
            if (['saturn', 'sega-saturn'].includes(slug)) emus.push('retroarch');
            if (['xbox', 'og-xbox', 'original-xbox'].includes(slug)) emus.push('xemu');

            return {
              id: Number(f.id),
              fileName,
              filePath: f.file_path,
              fileSizeBytes: Number(f.file_size_bytes || 0),
              platformId: Number(f.platform_id),
              platformSlug: slug,
              platformName: plat?.name || f.platform_name || slug,
              isVerified: Boolean(f.is_verified),
              md5Hash: f.md5_hash,
              sha1Hash: f.sha1_hash,
              crcHash: f.crc_hash,
              missingFromFs: Boolean(f.missing_from_fs),
              requiredForEmulators: emus,
            };
          });
        }
      } catch (e: any) {
        // Fall back to demo list if /api/firmware is not available or empty
      }
    }

    if (items.length === 0) {
      items = [...DEMO_FIRMWARE];
      if (platformId) {
        items = items.filter((f) => f.platformId === platformId);
      }
    }

    // Check local status on Steam Deck filesystem
    try {
      const statusMap = await bridge.bios.status(items);
      items = items.map((f) => {
        const st = statusMap[String(f.id)];
        return {
          ...f,
          isInstalled: Boolean(st?.exists),
          localPath: st?.path,
          localSizeBytes: st?.size,
        };
      });
    } catch {
      /* ignore */
    }

    return items;
  }

  /**
   * Download a firmware/BIOS file from RomM to local Emulation/bios and standalone emulator paths.
   */
  async downloadFirmware(item: RommFirmwareItem): Promise<{ ok: boolean; path?: string; message?: string }> {
    if (this.config.isDemoMode) {
      await new Promise((r) => setTimeout(r, 600));
      return {
        ok: true,
        path: `/home/deck/Emulation/bios/${item.fileName}`,
        message: `[Demo] Successfully downloaded ${item.fileName} into ~/Emulation/bios and emulator folders.`,
      };
    }
    const r = await bridge.bios.download({
      firmwareId: item.id,
      fileName: item.fileName,
      platformSlug: item.platformSlug,
      fileSizeBytes: item.fileSizeBytes,
    });
    return r;
  }

  /**
   * Sync required BIOS files for a given platform from RomM if missing locally.
   */
  async syncPlatformBios(platformSlug: string): Promise<{ ok: boolean; synced: number; message?: string }> {
    if (!isNativeApp) return { ok: true, synced: 0, message: 'Web demo: simulated BIOS sync' };
    return bridge.bios.syncPlatform(platformSlug);
  }

  /**
   * Sync all missing BIOS files found on RomM server to local directories.
   */
  async syncAllBios(): Promise<{ ok: boolean; synced: number; totalMissing?: number; message?: string }> {
    if (!isNativeApp) return { ok: true, synced: 0, message: 'Web demo: simulated BIOS sync' };
    return bridge.bios.syncAll();
  }

  /**
   * Get Xbox emulator (xemu) environment diagnostic (Boot ROM, Flash ROM, Virtual HDD, xemu.toml config).
   */
  async getXboxStatus(): Promise<XboxEmulatorStatus> {
    return bridge.bios.xboxStatus();
  }

  /**
   * One-click automated setup for Xbox: syncs BIOS/Boot ROM from RomM server,
   * generates 8GB virtual hard disk (xbox_hdd.qcow2), and configures xemu.toml.
   */
  async autoSetupXbox(): Promise<{ ok: boolean; synced: number; status: XboxEmulatorStatus; message: string }> {
    return bridge.bios.xboxSetup();
  }

  /**
   * Create an 8GB virtual Xbox hard disk image (xbox_hdd.qcow2).
   */
  async createXboxHdd(customPath?: string): Promise<{ ok: boolean; path: string; method: string; message: string }> {
    return bridge.bios.xboxCreateHdd(customPath);
  }

  // ------------------------------------------------------------------ files & launching
  /**
   * URL the in-app EmulatorJS player loads the ROM from. The main process
   * streams it from RomM on request (romm-rom:// protocol), so nothing is
   * written to the roms folder.
   */
  streamUrl(game: Game): string {
    const q = new URLSearchParams({ platform: game.platformSlug || '', title: game.title || '', size: String(game.fileSizeBytes || 0) });
    return `romm-rom://rom/${encodeURIComponent(String(game.id))}/${encodeURIComponent(game.fileName || 'rom.bin')}?${q.toString()}`;
  }

  private fileReq(game: Game, force = false, core?: string): RomFileRequest {
    const chosenCore = core || getActiveCoreForGame(game, this.config);
    return {
      romId: game.id,
      platformSlug: game.platformSlug,
      fileName: game.fileName,
      sizeBytes: game.fileSizeBytes,
      title: game.title,
      force,
      emulatorCore: chosenCore && chosenCore !== 'auto' ? chosenCore : undefined,
      coverUrl: game.coverUrl,
      backdropUrl: game.backdropUrl,
      screenshots: game.screenshots,
      summary: game.summary,
      developer: game.developer,
      publisher: game.publisher,
      releaseYear: game.releaseYear,
      genres: game.genres,
      rating: game.rating,
    };
  }

  /** Download the ROM into Emulation/roms/<platform>/ (progress via bridge 'rom:progress'). */
  async downloadToDeck(game: Game, force = false) {
    if (isNativeApp && game.platformSlug) {
      if (['xbox', 'og-xbox', 'original-xbox'].includes(game.platformSlug)) {
        void this.autoSetupXbox().catch((e) => console.warn('Xbox auto-setup error:', e));
      } else {
        void this.syncPlatformBios(game.platformSlug).catch(() => {});
      }
    }
    return bridge.roms.download(this.fileReq(game, force));
  }

  cancelDownload(gameId: string | number) {
    return bridge.roms.cancel(gameId);
  }

  deleteLocal(game: Game) {
    return bridge.roms.remove(this.fileReq(game));
  }

  /**
   * Scan local ~/Emulation/roms/ directory and return full details of all downloaded games,
   * their sizes, total occupied space, and available storage on the Steam Deck.
   */
  async getDownloadedRomsReport(): Promise<{
    items: Array<{
      id: string | number;
      title: string;
      platformSlug: string;
      platformName: string;
      fileName: string;
      fullPath: string;
      sizeBytes: number;
      mtime: number;
      coverUrl?: string;
      coverPath?: string;
      hasLocalArtwork?: boolean;
      meta?: any;
      game?: Game;
    }>;
    totalSizeBytes: number;
    romsRoot: string;
    storage: NativeStorage;
  }> {
    let cached: Game[] = [];
    try {
      const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const allKnown = [...cached, ...DEMO_GAMES];

    const [downloaded, storage, platforms] = await Promise.all([
      bridge.roms.listDownloaded().catch(() => ({ items: [], totalSizeBytes: 0, romsRoot: '' })),
      bridge.system.storage().catch(() => ({
        emulationRoot: '',
        internalTotalBytes: 0,
        internalFreeBytes: 0,
        internalUsedBytes: 0,
        sdCardMounted: false,
        sdPath: null,
        sdTotalBytes: 0,
        sdFreeBytes: 0,
        sdUsedBytes: 0,
        storageTarget: 'internal' as const,
        isRealDeckFs: false,
      })),
      this.getPlatforms().catch(() => []),
    ]);

    const platMap = new Map<string, string>();
    for (const p of platforms) {
      platMap.set(p.slug.toLowerCase(), p.name);
    }

    const items = downloaded.items.map((file) => {
      const fnLower = file.fileName.toLowerCase();
      const match = allKnown.find(
        (g) => (g.fileName && g.fileName.toLowerCase() === fnLower) ||
               (g.platformSlug.toLowerCase() === file.platformSlug.toLowerCase() &&
                fnLower.includes(g.title.toLowerCase().replace(/[^a-z0-9]/g, '')))
      );

      const meta = file.meta || {};
      const title = meta.title || match?.title || file.fileName.replace(/\.[^/.]+$/, '').replace(/[_.]/g, ' ');
      const platformName = platMap.get(file.platformSlug.toLowerCase()) || meta.platformName || match?.platformName || file.platformSlug.toUpperCase();
      const coverUrl = file.coverUrl || meta.coverUrl || match?.coverUrl;

      const gameObj: Game | undefined = match
        ? {
            ...match,
            title,
            coverUrl: coverUrl || match.coverUrl,
            backdropUrl: meta.backdropUrl || match.backdropUrl || coverUrl,
            summary: meta.summary || match.summary || '',
            developer: meta.developer || match.developer || '',
            publisher: meta.publisher || match.publisher || '',
            releaseYear: meta.releaseYear || match.releaseYear || 0,
            genres: meta.genres || match.genres || [],
            rating: meta.rating || match.rating || 0,
            isInstalled: true,
            isCached: true,
            localPath: file.fullPath,
            fileSizeBytes: file.sizeBytes,
          }
        : undefined;

      return {
        id: meta.romId || match?.id || `${file.platformSlug}-${file.fileName}`,
        title,
        platformSlug: file.platformSlug,
        platformName,
        fileName: file.fileName,
        fullPath: file.fullPath,
        sizeBytes: file.sizeBytes,
        mtime: file.mtime,
        coverUrl,
        coverPath: file.coverPath,
        hasLocalArtwork: Boolean(file.hasLocalArtwork || file.coverPath),
        meta: file.meta,
        game: gameObj,
      };
    });

    return {
      items,
      totalSizeBytes: downloaded.totalSizeBytes,
      romsRoot: downloaded.romsRoot,
      storage,
    };
  }

  private saveLibraryCache(newGames: Game[]) {
    try {
      const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
      const existing: Game[] = raw ? JSON.parse(raw) : [];
      const map = new Map<string, Game>();
      for (const g of existing) {
        map.set(`${g.platformSlug}:${g.id}`, g);
      }
      for (const g of newGames) {
        map.set(`${g.platformSlug}:${g.id}`, g);
      }
      const slice = Array.from(map.values()).slice(0, 2000);
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(slice));
    } catch {
      /* ignore */
    }
  }

  /**
   * Scan all downloaded games and ensure their cover art is downloaded and cached locally.
   */
  async syncAllOfflineArtwork(): Promise<{ ok: boolean; total: number; downloaded: number; message: string }> {
    return bridge.roms.syncAllOfflineArtwork();
  }

  /**
   * Scan local downloaded games from disk (~/Emulation/roms) and match with metadata cache
   * to provide a rich, playable library strictly for offline local play.
   */
  async getOfflineGames(q: GameQuery = {}): Promise<Game[]> {
    const report = await this.getDownloadedRomsReport().catch(() => null);
    const diskItems = report?.items || [];

    // Load cached metadata
    let cached: Game[] = [];
    try {
      const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {
      /* ignore */
    }

    const gamesMap = new Map<string, Game>();
    const byFileName = new Map<string, Game>();
    const byPlatformTitle = new Map<string, Game>();

    // Index all known cached games & DEMO_GAMES
    for (const g of [...cached, ...DEMO_GAMES]) {
      if (g.fileName) byFileName.set(g.fileName.toLowerCase(), g);
      const cleanTitleKey = `${g.platformSlug.toLowerCase()}:${g.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      byPlatformTitle.set(cleanTitleKey, g);
      if (g.isInstalled || g.isCached) {
        gamesMap.set(String(g.id), { ...g, isInstalled: true, isCached: true });
      }
    }

    // Process all disk items discovered in ~/Emulation/roms/
    for (const item of diskItems) {
      const fnLower = item.fileName.toLowerCase();
      const ptKey = `${item.platformSlug.toLowerCase()}:${item.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const match = byFileName.get(fnLower) || byPlatformTitle.get(ptKey) || item.game;

      if (match) {
        const cover = item.coverUrl || match.coverUrl || '';
        gamesMap.set(String(match.id), {
          ...match,
          coverUrl: cover,
          backdropUrl: item.meta?.backdropUrl || match.backdropUrl || cover,
          isInstalled: true,
          isCached: true,
          localPath: item.fullPath,
          fileSizeBytes: item.sizeBytes || match.fileSizeBytes,
          fileName: item.fileName || match.fileName,
          isFavorite: this.favorites.has(String(match.id)),
        });
      } else {
        const meta = item.meta || {};
        const id = String(meta.romId || `offline-${item.platformSlug}-${item.fileName}`);
        const cover = item.coverUrl || meta.coverUrl || '';
        gamesMap.set(id, {
          id,
          title: meta.title || item.title,
          platformSlug: item.platformSlug,
          platformName: item.platformName || item.platformSlug.toUpperCase(),
          releaseYear: meta.releaseYear || 0,
          developer: meta.developer || '',
          publisher: meta.publisher || '',
          rating: meta.rating || 0,
          summary: meta.summary || '',
          coverUrl: cover,
          backdropUrl: meta.backdropUrl || cover,
          fileName: item.fileName,
          localPath: item.fullPath,
          fileSizeBytes: item.sizeBytes,
          isInstalled: true,
          isCached: true,
          genres: meta.genres || [],
          playableOnline: false,
          isFavorite: this.favorites.has(id),
        });
      }
    }

    let list = Array.from(gamesMap.values());

    // Strictly ensure only installed / cached games that can be played locally
    list = list.filter((g) => g.isInstalled || g.isCached);

    // Apply query filters if requested
    if (q.platform && q.platform.slug !== 'all') {
      list = list.filter((g) => g.platformSlug === q.platform!.slug);
    } else if (q.platforms && q.platforms.length > 0) {
      const allowed = new Set(q.platforms.map((p) => p.slug));
      list = list.filter((g) => allowed.has(g.platformSlug));
    }

    if (q.search && q.search.trim()) {
      const term = q.search.trim().toLowerCase();
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(term) ||
          g.fileName?.toLowerCase().includes(term) ||
          g.genres?.some((gen) => gen.toLowerCase().includes(term))
      );
    }

    q.onPage?.(list.slice(), list.length);
    return list;
  }

  /** Download if needed, then launch the matching emulator from the main process. */
  async launchNative(game: Game, core?: string): Promise<{ success: boolean; message: string; command?: string }> {
    if (!isNativeApp) return { success: false, message: 'Native launch requires the DeckRomM desktop app' };
    if (game.platformSlug) {
      if (['xbox', 'og-xbox', 'original-xbox'].includes(game.platformSlug)) {
        await this.autoSetupXbox().catch((e) => console.warn('Xbox auto-setup check error:', e));
      } else {
        await this.syncPlatformBios(game.platformSlug).catch((e) => console.warn('BIOS auto-sync check error:', e));
      }
    }
    const r = await bridge.emulator.launch(this.fileReq(game, false, core));
    return { success: r.ok, message: r.ok ? `Launching with ${r.command}` : r.message || 'Launch failed', command: r.command };
  }

  /**
   * Launch a standalone emulator directly without a game so the user can configure
   * controller buttons, graphics, audio, memory cards, or bios settings.
   */
  async launchStandaloneEmulator(flatpakId: string, name?: string): Promise<{ success: boolean; message: string }> {
    if (!isNativeApp) {
      if (this.config.isDemoMode) {
        return {
          success: true,
          message: `[Demo] Opened ${name || flatpakId} configuration GUI. On Steam Deck, this opens the emulator's settings window directly.`,
        };
      }
      return {
        success: false,
        message: `Standalone emulator launch requires the native Steam Deck app. In desktop mode: 'flatpak run ${flatpakId}'.`,
      };
    }
    const r = await bridge.emulator.launchStandalone({ flatpakId, name });
    return {
      success: r.ok,
      message: r.ok ? `Launching ${name || flatpakId} settings...` : r.message || 'Launch failed',
    };
  }

  /**
   * v1-compatible: returns the ROM as a Blob (used by the in-app EmulatorJS player).
   * In the desktop app the file is streamed to disk by main first, then read back.
   */
  async downloadRom(game: Game, onProgress?: (pct: number, loadedBytes: number, speedMbps: number) => void): Promise<Blob> {
    if (!isNativeApp) {
      if (this.config.isDemoMode) {
        if (onProgress) {
          onProgress(25, Math.round((game.fileSizeBytes || 1024) * 0.25), 15.0);
          await new Promise((r) => setTimeout(r, 100));
          onProgress(75, Math.round((game.fileSizeBytes || 1024) * 0.75), 20.0);
          await new Promise((r) => setTimeout(r, 100));
          onProgress(100, game.fileSizeBytes || 1024, 25.0);
        }
        const data = new Uint8Array(Math.min(game.fileSizeBytes || 32768, 65536));
        new TextEncoder().encodeInto(`DECKROMM_ROM_${game.platformSlug}_${game.id}`, data);
        return new Blob([data], { type: 'application/octet-stream' });
      }

      const auth = this.getAuthStatus();
      if (!auth.baseUrl) throw new RommApiError('Not connected to a RomM server', 401, true);
      const url = `${auth.baseUrl}/api/roms/${encodeURIComponent(String(game.id))}/content/${encodeURIComponent(game.fileName)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new RommApiError(`Failed to fetch ROM: HTTP ${res.status}`, res.status);
      return res.blob();
    }

    const off = bridge.on('rom:progress', (ev) => {
      if (String(ev.romId) !== String(game.id) || !onProgress) return;
      const total = ev.total || game.fileSizeBytes || 1;
      onProgress(ev.status === 'completed' ? 100 : Math.min(99, Math.round((ev.loaded / total) * 100)), ev.loaded, ev.speedMbps);
    });
    try {
      const res = await bridge.roms.download(this.fileReq(game));
      if (!res.ok) throw new RommApiError(res.message || 'Download failed', 0, Boolean(res.authRequired));
      const bytes = await bridge.roms.read(this.fileReq(game));
      return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    } finally {
      off();
    }
  }

  /**
   * PCSX2 Memory Card Sync:
   */
  async getPcsx2Memcards(): Promise<Pcsx2MemcardStatus> {
    return bridge.pcsx2.listMemcards();
  }

  async uploadPcsx2Memcard(game: Game, fileName?: string): Promise<{ ok: boolean; fileName?: string; sizeBytes?: number; message?: string }> {
    return bridge.pcsx2.uploadMemcard({
      romId: game.id,
      fileName,
      gameTitle: game.title,
    });
  }

  async downloadPcsx2Memcard(downloadPath: string, targetFileName?: string): Promise<{ ok: boolean; targetPath?: string; sizeBytes?: number; message?: string }> {
    return bridge.pcsx2.downloadMemcard({
      downloadPath,
      targetFileName,
    });
  }

  async setPcsx2AutoSync(enabled: boolean): Promise<{ ok: boolean; autoSync: boolean }> {
    return bridge.pcsx2.setAutoSync(enabled);
  }

  /**
   * Auto-detect RetroAchievements settings from the RomM server and local Steam Deck emulators.
   * If RomM has RETROACHIEVEMENTS_API_KEY set on the server, RomM handles all API calls
   * server-side, so the user doesn't need to manually type their API key into DeckRomM!
   */
  async detectRetroAchievements(): Promise<{
    ok: boolean;
    source: 'romm_server' | 'steam_deck_emulator' | 'none';
    username?: string;
    token?: string;
    hasServerKey: boolean;
    message: string;
  }> {
    let raUser: string | undefined = undefined;
    let hasServerKey = false;

    // 1. Check RomM server if connected
    if (!this.config.isDemoMode && (this.auth.authenticated || this.config.serverUrl)) {
      try {
        // Query /api/users/me
        const me = await this.request<any>({ path: '/api/users/me' }).catch(() => null);
        if (me) {
          raUser =
            me.retroachievements_username ||
            me.ra_username ||
            me.ra_user ||
            me.preferences?.retroachievements_username ||
            me.preferences?.ra_username ||
            me.settings?.retroachievements_username ||
            me.settings?.ra_username;
        }

        // Query /api/config or /api/settings or /api/app/config
        const serverConfig = await this.request<any>({ path: '/api/config' }).catch(() =>
          this.request<any>({ path: '/api/app/config' }).catch(() => null)
        );
        if (serverConfig) {
          if (
            serverConfig.RETROACHIEVEMENTS_ENABLED ||
            serverConfig.retroachievements ||
            serverConfig.has_retroachievements ||
            serverConfig.features?.retroachievements ||
            serverConfig.METADATA_PROVIDERS?.includes('retroachievements') ||
            serverConfig.metadata_providers?.retroachievements
          ) {
            hasServerKey = true;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (raUser || hasServerKey) {
      const updatedPatch: Partial<RommConfig> = {
        raSource: 'romm_server',
        raServerConnected: true,
      };
      if (raUser) updatedPatch.raUsername = raUser;
      this.saveConfig(updatedPatch);

      return {
        ok: true,
        source: 'romm_server',
        username: raUser,
        hasServerKey: true,
        message: raUser
          ? `Found linked RetroAchievements account "${raUser}" on your RomM server! Server-managed API active.`
          : 'RomM server has RetroAchievements integration active! Server-managed API key is ready.',
      };
    }

    // 2. Check local Steam Deck emulators (RetroArch / EmuDeck, DuckStation, PCSX2)
    if (isNativeApp && bridge.system.detectRetroAchievements) {
      try {
        const local = await bridge.system.detectRetroAchievements();
        if (local && local.found && local.username) {
          this.saveConfig({
            raUsername: local.username,
            raApiKey: local.token || this.config.raApiKey,
            raSource: 'steam_deck_emulator',
          });
          return {
            ok: true,
            source: 'steam_deck_emulator',
            username: local.username,
            token: local.token,
            hasServerKey: false,
            message: `Auto-detected RetroAchievements account "${local.username}" from ${local.source || 'Steam Deck emulator'}!`,
          };
        }
      } catch {
        /* ignore */
      }
    }

    // 3. Fallback: Check if RomM server is connected even if not explicitly reporting config
    if (!this.config.isDemoMode && this.auth.authenticated) {
      this.saveConfig({
        raSource: 'romm_server',
        raServerConnected: true,
      });
      return {
        ok: true,
        source: 'romm_server',
        username: this.auth.username || undefined,
        hasServerKey: true,
        message: 'Connected to RomM server. Achievements will be pulled via your RomM server proxy.',
      };
    }

    return {
      ok: false,
      source: 'none',
      hasServerKey: false,
      message: 'Could not automatically detect RetroAchievements on RomM server or local emulators. You can enter your username directly.',
    };
  }
}

/**
 * Filter out RomM metadata/scraper artifacts, _info files, and OS shadow files
 * that are mistakenly indexed or served as game ROMs.
 */
export function isInfoOrJunkRom(item: {
  title?: string;
  name?: string;
  fileName?: string;
  fs_name?: string;
  slug?: string;
}): boolean {
  if (!item) return false;
  const title = (item.title || item.name || '').trim().toLowerCase();
  const fileName = (item.fileName || item.fs_name || '').trim().toLowerCase();
  const slug = (item.slug || '').trim().toLowerCase();

  // Strip file extension to get base name (e.g. "_info.txt" -> "_info")
  const fileBase = fileName.replace(/\.[^/.]+$/, '').trim();
  const titleBase = title.replace(/\.[^/.]+$/, '').trim();

  // 1. Exact or prefix matches for _info or .info
  if (
    title === '_info' ||
    title.startsWith('_info') ||
    title.endsWith('_info') ||
    title.startsWith('.info') ||
    fileName === '_info' ||
    fileName.startsWith('_info') ||
    fileName.endsWith('_info') ||
    fileName.startsWith('.info') ||
    slug === '_info' ||
    slug.startsWith('_info') ||
    fileBase === '_info' ||
    fileBase.startsWith('_info') ||
    titleBase === '_info' ||
    titleBase.startsWith('_info')
  ) {
    return true;
  }

  // 2. Info keyword in titles like "System - _info", "Genesis _info", "[_info]"
  if (
    /(^|[_\s.-])info([_\s.-]|$)/i.test(title) &&
    (title.startsWith('_') || title.startsWith('.') || fileName.startsWith('_') || fileName.startsWith('.'))
  ) {
    return true;
  }

  // 3. AppleDouble / macOS metadata shadow files: "._*" (e.g. "._Super Mario.sfc")
  if (fileName.startsWith('._') || title.startsWith('._')) {
    return true;
  }

  // 4. Common system/OS junk files in ROM directories
  if (
    fileName === '.ds_store' ||
    fileName === 'desktop.ini' ||
    fileName === 'thumbs.db' ||
    fileName === 'folder.jpg' ||
    fileName === 'cover.jpg'
  ) {
    return true;
  }

  // 5. Scraper readme / bios info text files
  if (
    fileBase === 'readme' ||
    fileBase === '_readme' ||
    fileBase === 'bios' ||
    fileBase.startsWith('_bios')
  ) {
    return true;
  }

  return false;
}


// Map platform slug or file extension to EmulatorJS core
export function getEmulatorCore(platformSlug: string, fileName?: string): string {
  const slug = (platformSlug || '').toLowerCase();
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';

  // By extension first
  if (ext === 'gba') return 'gba';
  if (ext === 'nes') return 'nes';
  if (ext === 'sfc' || ext === 'smc') return 'snes';
  if (ext === 'gb') return 'gb';
  if (ext === 'gbc') return 'gbc';
  if (ext === 'z64' || ext === 'n64' || ext === 'v64') return 'n64';
  if (ext === 'nds') return 'nds';
  if (ext === 'md' || ext === 'gen' || ext === 'smd') return 'segaMD';
  if (ext === 'sms') return 'segaMS';
  if (ext === 'gg') return 'segaGG';
  if (ext === 'pce') return 'pce';
  if (ext === 'ngp' || ext === 'ngc') return 'ngp';
  if (ext === 'ws' || ext === 'wsc') return 'ws';
  if (ext === 'vb') return 'vb';
  if (ext === 'a26') return 'atari2600';
  if (ext === 'a78') return 'atari7800';
  if (ext === 'lynx') return 'lynx';

  // By platform slug
  if (slug.includes('gba') || slug.includes('game-boy-advance') || slug.includes('gameboy-advance')) return 'gba';
  if (slug.includes('gbc') || slug.includes('game-boy-color')) return 'gbc';
  if (slug.includes('gb') || slug.includes('game-boy')) return 'gb';
  if (slug.includes('snes') || slug.includes('super-nintendo') || slug.includes('super-famicom')) return 'snes';
  if (slug.includes('nes') || slug.includes('famicom')) return 'nes';
  if (slug.includes('n64') || slug.includes('nintendo-64') || slug.includes('nintendo64')) return 'n64';
  if (slug.includes('nds') || slug.includes('nintendo-ds') || slug.includes('ds')) return 'nds';
  if (slug.includes('genesis') || slug.includes('megadrive') || slug.includes('mega-drive') || slug.includes('sega-genesis')) return 'segaMD';
  if (slug.includes('master-system') || slug.includes('sms')) return 'segaMS';
  if (slug.includes('game-gear') || slug.includes('gamegear')) return 'segaGG';
  if (slug.includes('psx') || slug.includes('ps1') || slug.includes('playstation')) return 'psx';
  if (slug.includes('turbografx') || slug.includes('pc-engine') || slug.includes('pce')) return 'pce';
  if (slug.includes('atari-2600') || slug.includes('2600')) return 'atari2600';
  if (slug.includes('atari-7800') || slug.includes('7800')) return 'atari7800';
  if (slug.includes('lynx')) return 'lynx';
  if (slug.includes('wonderswan')) return 'ws';
  if (slug.includes('saturn')) return 'saturn';
  if (slug.includes('dreamcast') || slug === 'dc') return 'dreamcast';
  if (slug.includes('segacd') || slug.includes('sega-cd') || slug.includes('mega-cd')) return 'segaMD';
  if (slug.includes('neogeo') || slug.includes('arcade') || slug.includes('mame') || slug.includes('fbneo')) return 'arcade';

  return 'gba';
}

export const rommApi = new RommApiService();
