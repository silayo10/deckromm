/** Shape of `window.deckromm`, exposed by electron/preload.cjs. */

export interface RommRequest {
  path: string; // must start with /api/
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | Array<string | number> | undefined | null>;
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'json' | 'text' | 'none';
  timeoutMs?: number;
}

export interface RommResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  message?: string;
  authRequired?: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  baseUrl: string | null;
  method: 'token' | 'oauth' | 'session' | null;
  username: string | null;
  rememberPassword?: boolean;
  storage?: string;
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  method?: string;
  username?: string | null;
  message: string;
}

export interface ServerProbe {
  ok: boolean;
  baseUrl?: string;
  version?: string;
  message: string;
}

export interface RomFileRequest {
  romId: string | number;
  platformSlug: string;
  fileName: string;
  sizeBytes?: number;
  title?: string;
  force?: boolean;
}

export interface RomProgressEvent {
  romId: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
  loaded: number;
  total: number;
  speedMbps: number;
  path?: string;
  message?: string;
}

export interface EmulatorStateEvent {
  running: boolean;
  romId?: string | number;
  title?: string;
  command?: string;
  code?: number | null;
  signal?: string | null;
  error?: string | null;
  playedMs?: number;
}

export interface NativeStorage {
  emulationRoot: string;
  internalTotalBytes: number;
  internalFreeBytes: number;
  internalUsedBytes: number;
  sdCardMounted: boolean;
  sdPath: string | null;
  sdTotalBytes: number;
  sdFreeBytes: number;
  sdUsedBytes: number;
  storageTarget: 'internal' | 'sdcard';
  isRealDeckFs: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  gameMode: boolean;
  fullscreen: boolean;
  platform: string;
  secureStorage: string;
  userData: string;
}

type Unsubscribe = () => void;

/** A save state stored on the RomM server (see electron/lib/cloudSync.cjs). */
export interface CloudState {
  id: number;
  romId: number;
  fileName: string;
  emulator: string | null;
  /** DeckRomM quick slot (1-5) or null for states made in RomM web / other clients. */
  slot: number | null;
  sizeBytes: number;
  updatedAt: number;
  downloadPath: string;
  screenshotPath: string;
}

/** An in-game save file (SRAM) stored on the RomM server. */
export interface CloudSave {
  id: number;
  romId: number;
  fileName: string;
  emulator: string | null;
  /** RomM save slot ("autosave" for RomM's web player and DeckRomM), null on older servers. */
  slot: string | null;
  sizeBytes: number;
  updatedAt: number;
  downloadPath: string;
}

export interface DeckRommBridge {
  isElectron: true;
  app: {
    info(): Promise<AppInfo>;
    quit(): Promise<{ ok: boolean }>;
    toggleFullscreen(): Promise<boolean>;
  };
  config: {
    get(): Promise<Record<string, any>>;
    set(patch: Record<string, any>): Promise<Record<string, any>>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    testServer(url: string): Promise<ServerProbe>;
    loginPassword(req: { baseUrl: string; username: string; password: string; remember?: boolean }): Promise<AuthResult>;
    loginToken(req: { baseUrl: string; token: string }): Promise<AuthResult>;
    pair(req: { baseUrl: string; code: string }): Promise<AuthResult>;
    logout(): Promise<{ ok: boolean }>;
  };
  romm: {
    request<T = any>(req: RommRequest): Promise<RommResponse<T>>;
  };
  cloud: {
    listStates(romId: string | number): Promise<{ ok: boolean; states?: CloudState[]; status?: number; authRequired?: boolean; message?: string }>;
    downloadState(downloadPath: string): Promise<{ ok: boolean; data?: Uint8Array; status?: number; message?: string }>;
    uploadState(req: {
      romId: string | number;
      slot: number;
      emulator?: string;
      baseName?: string;
      state: Uint8Array;
      screenshot?: Uint8Array;
      screenshotType?: string;
    }): Promise<{ ok: boolean; state?: CloudState; status?: number; message?: string }>;
    deleteStates(ids: number[]): Promise<{ ok: boolean; status?: number; message?: string }>;
    markPlayed(romId: string | number): Promise<{ ok: boolean; lastPlayed?: string; status?: number; message?: string }>;
    listSaves(romId: string | number): Promise<{ ok: boolean; saves?: CloudSave[]; status?: number; authRequired?: boolean; message?: string }>;
    downloadSave(downloadPath: string): Promise<{ ok: boolean; data?: Uint8Array; status?: number; message?: string }>;
    uploadSave(req: {
      romId: string | number;
      emulator?: string;
      baseName?: string;
      save: Uint8Array;
      screenshot?: Uint8Array;
      screenshotType?: string;
    }): Promise<{ ok: boolean; save?: CloudSave; status?: number; message?: string }>;
  };
  roms: {
    download(req: RomFileRequest): Promise<{ ok: boolean; path?: string; cached?: boolean; cancelled?: boolean; authRequired?: boolean; message?: string }>;
    cancel(romId: string | number): Promise<{ ok: boolean }>;
    localStatus(list: RomFileRequest[]): Promise<Record<string, { exists: boolean; path: string; size: number }>>;
    remove(req: RomFileRequest): Promise<{ ok: boolean }>;
    read(req: RomFileRequest): Promise<Uint8Array>;
  };
  emulator: {
    launch(req: RomFileRequest): Promise<{ ok: boolean; command?: string; pid?: number; message?: string; authRequired?: boolean }>;
    kill(): Promise<{ ok: boolean; forced?: boolean }>;
    status(): Promise<EmulatorStateEvent>;
  };
  system: {
    storage(): Promise<NativeStorage>;
    emulationPath(): Promise<string>;
    selectDirectory(): Promise<string | null>;
  };
  on(channel: 'auth:required', cb: (info: { status: number; message: string }) => void): Unsubscribe;
  on(channel: 'rom:progress', cb: (ev: RomProgressEvent) => void): Unsubscribe;
  on(channel: 'emulator:state', cb: (ev: EmulatorStateEvent) => void): Unsubscribe;
  on(channel: 'app:shutting-down', cb: (ev: { reason: string }) => void): Unsubscribe;
  on(channel: 'window:focus', cb: (ev: { focused: boolean }) => void): Unsubscribe;
}

declare global {
  interface Window {
    deckromm?: DeckRommBridge;
    deckrommNative?: {
      isElectron(): Promise<boolean>;
      getEmulationPath(): Promise<string>;
      selectDirectory(): Promise<string | null>;
      saveRomFile(payload: { fileName: string; platformSlug?: string; targetDir?: string; data: ArrayBuffer }): Promise<{ success: boolean; path: string }>;
      toggleFullscreen(): Promise<boolean>;
      quitApp(): Promise<boolean>;
    };
  }
}
