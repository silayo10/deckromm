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
import { Collection, Game, Platform, RommConfig, getActiveCoreForGame, RommFirmwareItem } from '../types';
import type { AuthResult, AuthStatus, RomFileRequest, RommRequest, ServerProbe } from '../env/electron';
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
];

const LEGACY_CONFIG_KEY = 'deckromm_config_v1';
const FAVORITES_KEY = 'deckromm_favorites_v2';
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
  async getPlatforms(): Promise<Platform[]> {
    if (this.config.isDemoMode) return [...DEMO_PLATFORMS];
    try {
      const data = await this.request<any>({ path: '/api/platforms' });
      const list: any[] = Array.isArray(data) ? data : data?.items || [];
      return list
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
    } catch (e) {
      console.warn('getPlatforms failed', e);
      return [];
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
    const genres: string[] = (meta.genres || r.genres || []).map((g: any) => (typeof g === 'string' ? g : g?.name)).filter(Boolean);
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
    if (this.config.isDemoMode) {
      let demo = [...DEMO_GAMES];
      if (q.platform && q.platform.slug !== 'all') demo = demo.filter((g) => g.platformSlug === q.platform!.slug);
      if (q.search) demo = demo.filter((g) => g.title.toLowerCase().includes(q.search!.toLowerCase()));
      return demo.map((g) => ({ ...g, isFavorite: this.favorites.has(String(g.id)) }));
    }

    const query: RommRequest['query'] = { limit: PAGE_SIZE, order_by: 'name', order_dir: 'asc' };
    if (q.platform && q.platform.slug !== 'all' && q.platform.id != null) {
      // RomM 5.x uses platform_ids, 4.x uses platform_id - unknown params are ignored.
      query.platform_ids = [q.platform.id as number];
      query.platform_id = q.platform.id as number;
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
      const mapped = await this.annotateInstalled(await this.mapChunked(items, q.signal));
      all.push(...mapped);
      q.onPage?.(all.slice(), total);
      if (items.length === 0 || Array.isArray(data)) break;
      offset += items.length;
    }
    return all;
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
        const res = await this.request<any[]>({ path: '/api/firmware', query });
        if (Array.isArray(res) && res.length > 0) {
          const platforms = await this.getPlatforms().catch(() => []);
          const platformMap = new Map<number, Platform>();
          platforms.forEach((p) => {
            if (p.id) platformMap.set(Number(p.id), p);
          });

          items = res.map((f: any) => {
            const plat = platformMap.get(Number(f.platform_id));
            const slug = plat?.slug || String(f.platform_slug || '').toLowerCase();
            const emus: string[] = [];
            if (['ps2', 'playstation-2', 'playstation2'].includes(slug)) emus.push('pcsx2');
            if (['psx', 'ps1', 'playstation'].includes(slug)) emus.push('duckstation', 'retroarch');
            if (['dc', 'dreamcast'].includes(slug)) emus.push('flycast');
            if (['psp'].includes(slug)) emus.push('ppsspp');

            return {
              id: Number(f.id),
              fileName: f.file_name || f.fileName,
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
    };
  }

  /** Download the ROM into Emulation/roms/<platform>/ (progress via bridge 'rom:progress'). */
  downloadToDeck(game: Game, force = false) {
    return bridge.roms.download(this.fileReq(game, force));
  }

  cancelDownload(gameId: string | number) {
    return bridge.roms.cancel(gameId);
  }

  deleteLocal(game: Game) {
    return bridge.roms.remove(this.fileReq(game));
  }

  /** Download if needed, then launch the matching emulator from the main process. */
  async launchNative(game: Game, core?: string): Promise<{ success: boolean; message: string; command?: string }> {
    if (!isNativeApp) return { success: false, message: 'Native launch requires the DeckRomM desktop app' };
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
  if (slug.includes('virtual-boy')) return 'vb';
  if (slug.includes('neogeo') || slug.includes('arcade') || slug.includes('mame') || slug.includes('fbneo')) return 'arcade';

  return 'gba';
}

export const rommApi = new RommApiService();
