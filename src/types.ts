export interface Platform {
  id: number | string;
  slug: string;
  name: string;
  shortName: string;
  manufacturer: string;
  generation?: string;
  icon?: string;
  color: string;
  gameCount: number;
  extensions: string[];
  emulatorCore: string;
  description?: string;
  year?: number;
  canStreamOnline?: boolean; // true if browser emulator core can run ROM directly without downloading
}

export interface Game {
  id: string | number;
  title: string;
  platformSlug: string;
  platformName: string;
  releaseYear: number;
  developer: string;
  publisher: string;
  genres: string[];
  rating: number; // 0-100 or 0-5
  summary: string;
  coverUrl: string;
  backdropUrl?: string;
  screenshots?: string[];
  fileName: string;
  fileSizeBytes: number;
  crc?: string;
  md5?: string;
  sha1?: string;
  region?: string;
  languages?: string[];
  players?: number | string;
  igdbId?: number;
  mobyId?: number;
  isFavorite?: boolean;
  isCached?: boolean;
  lastPlayed?: string;
  playCount?: number;
  downloadUrl?: string;
  playableOnline?: boolean; // true if can be streamed in-app without downloading
  platformId?: number | string;
  /** True when the ROM file exists in the local Emulation/roms folder. */
  isInstalled?: boolean;
  localPath?: string;
  isMultiFile?: boolean;
}

export type LibraryViewMode = 'grid' | 'hero' | 'table';
export type SortOption = 'recent' | 'rating' | 'title' | 'year' | 'size';
export type FilterTag = 'all' | 'streamable' | 'cached' | 'favorites' | 'multiplayer';
export type EmulatorAspectRatio = 'native' | '4:3' | '3:2' | '10:9' | '16:9' | '16:10' | '1:1';

export interface QamSettings {
  fpsLimit: 30 | 40 | 60 | 90;
  showFpsOverlay: boolean;
  crtIntensity: number; // 0 to 100
  volume: number; // 0 to 100
  sfxEnabled: boolean;
  performanceMode: 'balanced' | 'power_saver' | 'unlocked';
  offlineOnlyMode: boolean;
}

export interface RommConfig {
  /** RomM base URL, e.g. http://192.168.1.20:8080 (no trailing /api). */
  serverUrl: string;
  isDemoMode: boolean;
  autoCacheBoxArt: boolean;
  /** Emulation root (folder containing roms/). Empty = auto-detect EmuDeck / SD card. */
  emulationPath: string;
  audioFeedback: boolean;
  displayMode: 'deck' | 'tv' | 'compact';
  firstLaunchSetupCompleted?: boolean;
  defaultPlatform?: string;
  hideInfoFiles?: boolean;
  viewMode?: LibraryViewMode;
  sortBy?: SortOption;
  filterTag?: FilterTag;
  launcherMode?: 'auto' | 'retroarch' | 'custom';
  /** Template with {rom} {core} {platform} {romdir} placeholders. */
  customLaunchCommand?: string;
  launcherOverrides?: Record<string, string>;
  retroarchFullscreen?: boolean;
  /** @deprecated v1 plaintext secrets - now kept encrypted by the main process. Never persisted. */
  apiToken?: string;
  /** @deprecated see apiToken */
  username?: string;
  /** @deprecated see apiToken */
  password?: string;
  /** @deprecated all RomM traffic is proxied by the Electron main process now */
  useProxy?: boolean;
}

export interface Collection {
  id: number | string;
  name: string;
  description?: string;
  romCount: number;
  coverUrl?: string;
  isVirtual?: boolean;
}

export interface DownloadItem {
  id: string;
  gameId: string | number;
  title: string;
  platform: string;
  fileSizeBytes: number;
  bytesDownloaded: number;
  progress: number; // 0 - 100
  speedMbps: number;
  status: 'queued' | 'downloading' | 'completed' | 'paused' | 'error';
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
}

export interface StorageInfo {
  cachedGamesCount: number;
  cachedBytes: number;
  browserQuotaBytes: number;
  browserUsageBytes: number;
  browserFreeBytes: number;
  estimatedDeckFreeBytes: number;
  storageTarget: 'internal' | 'sdcard';
  internalTotalBytes?: number;
  internalFreeBytes?: number;
  internalUsedBytes?: number;
  sdCardMounted?: boolean;
  sdTotalBytes?: number;
  sdFreeBytes?: number;
  sdUsedBytes?: number;
  isRealDeckFs?: boolean;
}

export interface GamepadButtonState {
  a: boolean; // Button 0
  b: boolean; // Button 1
  x: boolean; // Button 2
  y: boolean; // Button 3
  lb: boolean; // Button 4
  rb: boolean; // Button 5
  lt: boolean; // Button 6
  rt: boolean; // Button 7
  select: boolean; // Button 8
  start: boolean; // Button 9
  dpadUp: boolean; // Button 12
  dpadDown: boolean; // Button 13
  dpadLeft: boolean; // Button 14
  dpadRight: boolean; // Button 15
  l3: boolean;
  r3: boolean;
  connected: boolean;
  id: string;
  axes?: number[];
}

export interface SaveState {
  slot: number;
  gameId?: string | number;
  timestamp: number;
  score?: number;
  lives?: number;
  levelName?: string;
  screenshot?: string;
  screenshotUrl?: string;
  dateFormatted?: string;
  data?: any;
  /** RomM state id when this slot exists on the server. */
  cloudId?: number;
  /** RomM download path for the state bytes (cloud-only entries have no `data`). */
  downloadPath?: string;
  /** Saved on this Deck but not uploaded yet (offline or server error). */
  pendingUpload?: boolean;
  /** Where the current copy lives. */
  source?: 'local' | 'cloud' | 'both';
}

export type OverlayButtonCombo = 'select_start' | 'l3_r3' | 'select_x' | 'l1_r1_start';

export type NavigationAction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'SELECT' // A
  | 'BACK' // B
  | 'ACTION_X' // X
  | 'ACTION_Y' // Y
  | 'PREV_PLATFORM' // LB
  | 'NEXT_PLATFORM' // RB
  | 'SCROLL_UP' // Right Stick Up / LT
  | 'SCROLL_DOWN' // Right Stick Down / RT
  | 'PAGE_UP' // Page Up
  | 'PAGE_DOWN' // Page Down
  | 'MENU' // Start (STEAM menu)
  | 'FILTER' // Select (Quick Search / Filter)
  | 'QUICK_ACCESS' // Q / SteamOS (...) Quick Access Menu
  | 'VIEW_MODE_TOGGLE' // Toggle Grid / Hero / Table view
  | 'TOGGLE_OVERLAY' // Button combo or Esc in emulator
  | 'HELP';
