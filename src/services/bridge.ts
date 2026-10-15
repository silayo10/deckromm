/**
 * Access to the Electron main-process bridge.
 *
 * In the packaged AppImage `window.deckromm` is provided by preload.cjs.
 * When the UI is opened in a plain browser (`bun run dev:web`) a limited
 * fallback is used: requests go straight to RomM with fetch (the RomM server
 * must allow CORS), credentials live in sessionStorage, and native features
 * (downloads to disk, emulator launch, quit) are unavailable.
 */
import type {
  AuthResult,
  AuthStatus,
  DeckRommBridge,
  EmulatorStateEvent,
  RomFileRequest,
  RommRequest,
  RommResponse,
} from '../env/electron';

type Listener = (payload: any) => void;

const CONFIG_KEY = 'deckromm_web_config_v2';
const CRED_KEY = 'deckromm_web_creds_v2';

function createBrowserFallback(): DeckRommBridge {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (ch: string, payload: any) => listeners.get(ch)?.forEach((l) => l(payload));

  const readCreds = (): any => {
    try {
      return JSON.parse(sessionStorage.getItem(CRED_KEY) || 'null');
    } catch {
      return null;
    }
  };
  const writeCreds = (c: any) => (c ? sessionStorage.setItem(CRED_KEY, JSON.stringify(c)) : sessionStorage.removeItem(CRED_KEY));
  const norm = (u: string) => {
    let raw = (u || '').trim();
    if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
    return raw.replace(/\/+$/, '').replace(/\/api$/, '');
  };
  const authHeader = (c: any): Record<string, string> =>
    c?.token ? { Authorization: `Bearer ${c.token}` } : {};

  const unsupported = async () => ({ ok: false, message: 'Only available in the DeckRomM desktop app' });

  const request = async <T,>(req: RommRequest): Promise<RommResponse<T>> => {
    const c = readCreds();
    if (!c) {
      emit('auth:required', { status: 401, message: 'Not signed in' });
      return { ok: false, status: 401, authRequired: true, message: 'Not signed in' };
    }
    const url = new URL(`${c.baseUrl}${req.path}`);
    Object.entries(req.query || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) v.forEach((i) => url.searchParams.append(k, String(i)));
      else url.searchParams.set(k, String(v));
    });
    try {
      const res = await fetch(url, {
        method: req.method || 'GET',
        headers: { Accept: 'application/json', ...(req.headers || {}), ...authHeader(c) },
        body: req.body,
        credentials: 'include',
        signal: AbortSignal.timeout(req.timeoutMs || 20000),
      });
      if (res.status === 401 || res.status === 403) {
        emit('auth:required', { status: res.status, message: 'Session expired' });
        return { ok: false, status: res.status, authRequired: true, message: `HTTP ${res.status}` };
      }
      if (!res.ok) return { ok: false, status: res.status, message: `HTTP ${res.status}` };
      const data = req.responseType === 'text' ? await res.text() : req.responseType === 'none' ? null : await res.json();
      return { ok: true, status: res.status, data: data as T };
    } catch (e: any) {
      return { ok: false, status: 0, message: e?.message || String(e) };
    }
  };

  return {
    isElectron: true as const,
    app: {
      info: async () => ({ version: 'web', electron: '', gameMode: false, fullscreen: false, platform: 'web', secureStorage: 'sessionStorage', userData: '' }),
      quit: async () => {
        window.close();
        return { ok: true };
      },
      toggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        return Boolean(document.fullscreenElement);
      },
    },
    config: {
      get: async () => JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'),
      set: async (patch) => {
        const next = { ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'), ...patch };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        return next;
      },
    },
    auth: {
      status: async (): Promise<AuthStatus> => {
        const c = readCreds();
        return { authenticated: Boolean(c), baseUrl: c?.baseUrl || null, method: c ? 'token' : null, username: c?.username || null, storage: 'sessionStorage' };
      },
      testServer: async (url) => {
        const baseUrl = norm(url);
        try {
          const res = await fetch(`${baseUrl}/api/heartbeat`, { signal: AbortSignal.timeout(8000) });
          const data = await res.json().catch(() => ({}));
          return res.ok ? { ok: true, baseUrl, version: data?.SYSTEM?.VERSION, message: 'Reachable' } : { ok: false, baseUrl, message: `HTTP ${res.status}` };
        } catch (e: any) {
          return { ok: false, baseUrl, message: e?.message || 'Unreachable' };
        }
      },
      loginToken: async ({ baseUrl, token }): Promise<AuthResult> => {
        writeCreds({ baseUrl: norm(baseUrl), token });
        const r = await request<any>({ path: '/api/users/me' });
        if (!r.ok) writeCreds(null);
        return r.ok ? { ok: true, username: r.data?.username, message: 'Signed in' } : { ok: false, status: r.status, message: r.message || 'Failed' };
      },
      loginPassword: async ({ baseUrl, username, password }): Promise<AuthResult> => {
        const base = norm(baseUrl);
        try {
          const res = await fetch(`${base}/api/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'password', username, password, scope: 'me.read roms.read platforms.read assets.read collections.read roms.user.read' }),
          });
          if (!res.ok) return { ok: false, status: res.status, message: 'Invalid username or password' };
          const data = await res.json();
          writeCreds({ baseUrl: base, token: data.access_token, username });
          return { ok: true, username, message: 'Signed in' };
        } catch (e: any) {
          return { ok: false, message: e?.message || 'Login failed' };
        }
      },
      pair: unsupported as any,
      logout: async () => {
        writeCreds(null);
        return { ok: true };
      },
    },
    romm: { request },
    cloud: {
      listStates: async () => ({ ok: false, states: [], message: 'Only available in the DeckRomM desktop app' }),
      downloadState: unsupported as any,
      uploadState: unsupported as any,
      deleteStates: unsupported as any,
      markPlayed: unsupported as any,
      listSaves: async () => ({ ok: false, saves: [], message: 'Only available in the DeckRomM desktop app' }),
      downloadSave: unsupported as any,
      uploadSave: unsupported as any,
    },
    roms: {
      download: unsupported as any,
      cancel: async () => ({ ok: false }),
      localStatus: async (list: RomFileRequest[]) => Object.fromEntries(list.map((i) => [String(i.romId), { exists: false, path: '', size: 0 }])),
      remove: async () => ({ ok: true }),
      listDownloaded: async () => ({
        items: [
          { platformSlug: 'xbox', fileName: 'Halo - Combat Evolved (USA).iso', fullPath: '/home/deck/Emulation/roms/xbox/Halo - Combat Evolved (USA).iso', sizeBytes: 2450000000, mtime: Date.now() - 3600000 },
          { platformSlug: 'xbox', fileName: 'Star Wars - Knights of the Old Republic (USA).iso', fullPath: '/home/deck/Emulation/roms/xbox/Star Wars - Knights of the Old Republic (USA).iso', sizeBytes: 3850000000, mtime: Date.now() - 7200000 },
          { platformSlug: 'ps2', fileName: 'Shadow of the Colossus (USA).iso', fullPath: '/home/deck/Emulation/roms/ps2/Shadow of the Colossus (USA).iso', sizeBytes: 2845679616, mtime: Date.now() - 14400000 },
          { platformSlug: 'ps2', fileName: 'Metal Gear Solid 3 - Snake Eater (USA).chd', fullPath: '/home/deck/Emulation/roms/ps2/Metal Gear Solid 3 - Snake Eater (USA).chd', sizeBytes: 4294967296, mtime: Date.now() - 28800000 },
          { platformSlug: 'gamecube', fileName: 'Super Smash Bros. Melee (USA) (v1.02).iso', fullPath: '/home/deck/Emulation/roms/gc/Super Smash Bros. Melee (USA) (v1.02).iso', sizeBytes: 1459978240, mtime: Date.now() - 86400000 },
        ],
        totalSizeBytes: 14900625152,
        romsRoot: '/home/deck/Emulation/roms',
      }),
      read: async () => {
        throw new Error('Not available in browser mode');
      },
    },
    emulator: {
      launch: unsupported as any,
      launchStandalone: async (req: { flatpakId: string; name?: string }) => {
        return { ok: true, message: `Simulated launch for ${req.name || req.flatpakId} (GUI / Settings mode)` };
      },
      kill: async () => ({ ok: true }),
      status: async (): Promise<EmulatorStateEvent> => ({ running: false }),
    },
    system: {
      storage: async () => ({
        emulationRoot: '/home/deck/Emulation',
        internalTotalBytes: 512000000000,
        internalFreeBytes: 248600000000,
        internalUsedBytes: 263400000000,
        sdCardMounted: true,
        sdPath: '/run/media/deck/microSD',
        sdTotalBytes: 256000000000,
        sdFreeBytes: 132400000000,
        sdUsedBytes: 123600000000,
        storageTarget: 'internal',
        isRealDeckFs: false,
      }),
      emulationPath: async () => '/home/deck/Emulation',
      selectDirectory: async () => '/home/deck/Emulation',
      flatpakStatus: async () => ({ flatpakAvailable: true, installed: { 'app.xemu.xemu': true, 'net.pcsx2.PCSX2': true } }),
      installFlatpak: async () => ({ ok: true, message: 'Simulated install' }),
    },
    bios: {
      list: async () => [],
      status: async (list: any[]) => Object.fromEntries(list.map((i) => [String(i.id), { exists: false, path: '', size: 0 }])),
      download: async (req: any) => ({ ok: true, message: `Simulated BIOS download for ${req.fileName}` }),
      syncPlatform: async (slug: string) => ({ ok: true, synced: 0, message: `Simulated BIOS sync for ${slug}` }),
      syncAll: async () => ({ ok: true, synced: 0, totalMissing: 0, message: 'Simulated BIOS sync for all platforms' }),
      cancel: async () => ({ ok: true }),
      openFolder: async () => ({ ok: false, message: 'Only available in desktop app' }),
      xboxStatus: async () => ({
        ready: false,
        xemuInstalled: false,
        bootrom: { found: false, path: null, fileName: 'mcpx_1.0.bin', sizeBytes: 0 },
        flashrom: { found: false, path: null, fileName: 'Complex_4627.bin', sizeBytes: 0 },
        hdd: { found: false, path: null, fileName: 'xbox_hdd.qcow2', sizeBytes: 0 },
        eeprom: { found: false, path: null, fileName: 'eeprom.bin' },
        config: { configured: false, path: null },
        missingItems: ['Boot ROM (mcpx_1.0.bin)', 'BIOS (Complex_4627.bin)', 'Virtual Hard Disk (xbox_hdd.qcow2)', 'xemu.toml configuration'],
      }),
      xboxSetup: async () => ({
        ok: true,
        synced: 2,
        status: {
          ready: true,
          xemuInstalled: true,
          bootrom: { found: true, path: '/home/deck/Emulation/bios/mcpx_1.0.bin', fileName: 'mcpx_1.0.bin', sizeBytes: 512 },
          flashrom: { found: true, path: '/home/deck/Emulation/bios/Complex_4627.bin', fileName: 'Complex_4627.bin', sizeBytes: 1048576 },
          hdd: { found: true, path: '/home/deck/Emulation/bios/xbox_hdd.qcow2', fileName: 'xbox_hdd.qcow2', sizeBytes: 8589934592 },
          eeprom: { found: true, path: '/home/deck/Emulation/bios/eeprom.bin', fileName: 'eeprom.bin' },
          config: { configured: true, path: '/home/deck/.var/app/app.xemu.xemu/data/xemu/xemu/xemu.toml' },
          missingItems: [],
        },
        message: 'Xbox configured: 8GB HDD created and xemu.toml configured.',
      }),
      xboxCreateHdd: async (customPath?: string) => ({
        ok: true,
        path: customPath || '/home/deck/Emulation/bios/xbox_hdd.qcow2',
        method: 'simulated sparse qcow2',
        message: 'Created 8GB Xbox virtual hard disk (xbox_hdd.qcow2)',
      }),
    },
    updater: {
      check: async () => ({
        hasUpdate: false,
        currentCommit: 'a1b2c3d',
        latestCommit: 'a1b2c3d',
        message: 'Running latest version',
        author: 'DeckRomM',
        date: new Date().toISOString(),
        repo: 'deckromm/deckromm',
        branch: 'main',
      }),
      perform: async () => ({ ok: true, message: 'Simulated upgrade complete' }),
      relaunch: async () => {},
    },
    on: ((channel: string, cb: Listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb);
      return () => listeners.get(channel)?.delete(cb);
    }) as DeckRommBridge['on'],
  };
}

export const isNativeApp = typeof window !== 'undefined' && Boolean(window.deckromm);
export const bridge: DeckRommBridge = (typeof window !== 'undefined' && window.deckromm) || createBrowserFallback();

/** Build an <img> src for a RomM asset path or absolute URL. */
export function assetUrl(pathOrUrl: string | undefined | null, baseUrl?: string | null): string {
  if (!pathOrUrl) return '';
  if (/^(data|blob|romm-asset):/.test(pathOrUrl)) return pathOrUrl;
  if (isNativeApp) return `romm-asset://img/?u=${encodeURIComponent(pathOrUrl)}`;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${(baseUrl || '').replace(/\/+$/, '')}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
