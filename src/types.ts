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
  tags?: string[];
  files?: Array<{ id: number | string; fileName: string; fileSizeBytes: number; path?: string }>;
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
  genreFilter?: string;
  languageFilter?: string;
  hideJapanese?: boolean;
  launcherMode?: 'auto' | 'retroarch' | 'custom';
  /** Template with {rom} {core} {platform} {romdir} placeholders. */
  customLaunchCommand?: string;
  launcherOverrides?: Record<string, string>;
  /** Selected default emulator core per platform slug (e.g. psx -> 'duckstation' or 'pcsx_rearmed') */
  platformCores?: Record<string, string>;
  /** Selected emulator core override per game ID */
  gameCores?: Record<string, string>;
  retroarchFullscreen?: boolean;
  // Updates & GitHub in-place upgrade
  githubRepo?: string;
  githubBranch?: string;
  autoCheckUpdates?: boolean;
  githubToken?: string;
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

/**
 * Normalizes genre strings across scraping sources (e.g. merging 'Role-Playing (RPG)' into 'RPG').
 * Eliminates duplicate/overlapping genre labels like "RPG" vs "Role Playing (RPG)".
 */
export function normalizeGenre(genreName?: string): string {
  if (!genreName) return '';
  const trimmed = genreName.trim();
  const lower = trimmed.toLowerCase();
  const cleaned = lower.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

  // Normalize all Role-Playing / RPG variants to "RPG"
  if (
    cleaned === 'rpg' ||
    cleaned === 'role playing' ||
    cleaned === 'roleplaying' ||
    cleaned === 'role playing game' ||
    cleaned === 'role playing games' ||
    cleaned === 'role playing rpg' ||
    cleaned === 'rpg role playing' ||
    /^role[\s-]playing[\s-]*(game|games)?[\s\/\(\[]*(rpg)?[\s\/\)\]]*$/i.test(trimmed) ||
    /^rpg[\s\/\(\[]*(role[\s-]playing)?[\s\/\)\]]*$/i.test(trimmed) ||
    lower === 'role-playing (rpg)' ||
    lower === 'role playing (rpg)' ||
    lower === 'role-playing' ||
    lower === 'role playing' ||
    lower === 'role-playing games' ||
    lower === 'role playing games' ||
    lower === 'role-playing / rpg' ||
    lower === 'role playing / rpg' ||
    lower === 'rpg (role-playing)' ||
    lower === 'rpg (role playing)'
  ) {
    return 'RPG';
  }

  // Normalize Action-Adventure variants
  if (
    cleaned === 'action adventure' ||
    lower === 'action-adventure' ||
    lower === 'action adventure' ||
    lower === 'action/adventure' ||
    lower === 'action / adventure'
  ) {
    return 'Action-Adventure';
  }

  // Normalize Shoot 'Em Up
  if (
    cleaned === "shoot em up" ||
    cleaned === "shmup" ||
    lower === "shoot 'em up" ||
    lower === "shoot 'em up (shmup)" ||
    lower === 'shmup' ||
    lower === "shoot'em up"
  ) {
    return "Shoot 'Em Up";
  }

  // Normalize Beat 'Em Up
  if (
    cleaned === "beat em up" ||
    lower === "beat 'em up" ||
    lower === 'beat-em-up' ||
    lower === "beat'em up"
  ) {
    return "Beat 'Em Up";
  }

  // Normalize Platformer
  if (
    cleaned === 'platform' ||
    cleaned === 'platforming' ||
    cleaned === 'platformer' ||
    cleaned === 'platform game' ||
    cleaned === 'platform games'
  ) {
    return 'Platformer';
  }

  // Normalize Fighting
  if (
    cleaned === 'fighting' ||
    cleaned === 'fighting game' ||
    cleaned === 'fighting games'
  ) {
    return 'Fighting';
  }

  // Normalize Racing
  if (
    cleaned === 'racing' ||
    cleaned === 'driving racing' ||
    cleaned === 'racing driving' ||
    lower === 'driving / racing' ||
    lower === 'racing / driving'
  ) {
    return 'Racing';
  }

  // Normalize First-Person Shooter
  if (
    cleaned === 'first person shooter' ||
    cleaned === 'fps' ||
    lower === 'first-person shooter'
  ) {
    return 'First-Person Shooter';
  }

  // Normalize Sci-Fi
  if (
    lower === 'sci-fi' ||
    lower === 'science fiction' ||
    cleaned === 'sci fi'
  ) {
    return 'Sci-Fi';
  }

  return trimmed;
}

/**
 * Checks if a game matches the selected genre filter.
 * Supports smart matching for 'RPG' to also match 'JRPG', 'Action RPG', 'Turn-Based RPG', etc.
 */
export function matchGameGenre(game: Game, selectedGenre?: string): boolean {
  if (!selectedGenre || selectedGenre === 'all' || selectedGenre.toLowerCase() === 'all genres') return true;
  if (!game.genres || game.genres.length === 0) return false;
  const target = normalizeGenre(selectedGenre).toLowerCase();

  if (target === 'rpg') {
    return game.genres.some((g) => {
      const gl = normalizeGenre(g).toLowerCase();
      return (
        gl === 'rpg' ||
        gl === 'jrpg' ||
        gl.includes('rpg') ||
        gl.includes('role-playing') ||
        gl.includes('role playing')
      );
    });
  }

  return game.genres.some((g) => {
    const gl = normalizeGenre(g).toLowerCase();
    return gl === target || gl.includes(target);
  });
}

export interface CoreOption {
  id: string; // e.g. 'duckstation', 'pcsx_rearmed', 'swanstation'
  name: string; // display name e.g. 'DuckStation'
  type: 'libretro' | 'standalone' | 'both' | 'web';
  recommended?: boolean;
  description?: string;
  flatpakId?: string;
}

export interface StandaloneEmulatorInfo {
  id: string;
  flatpakId: string;
  name: string;
  platforms: string[];
  description: string;
}

export interface ControllerConfig {
  layoutPreset: 'nintendo' | 'standard' | 'arcade';
  swapAB: boolean;
  swapXY: boolean;
  leftStickAsDpad: boolean;
  deadzone: number;
  turboTrigger: 'none' | 'rt' | 'lt' | 'rb';
  customMap?: Record<string, string>;
}

export function getStandaloneEmulatorForPlatform(platformSlug?: string): StandaloneEmulatorInfo | null {
  if (!platformSlug) return null;
  const slug = platformSlug.toLowerCase().trim();
  if (['psx', 'ps1', 'playstation'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'duckstation') || null;
  if (['ps2', 'playstation-2', 'playstation2'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'pcsx2') || null;
  if (['gc', 'ngc', 'gamecube', 'wii'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'dolphin') || null;
  if (['psp', 'playstation-portable'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'ppsspp') || null;
  if (['ps3', 'playstation-3'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'rpcs3') || null;
  if (['3ds', 'n3ds', 'nintendo-3ds'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'lime3ds') || null;
  if (['wiiu', 'wii-u'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'cemu') || null;
  if (['switch', 'nintendo-switch'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'ryujinx') || null;
  if (['dc', 'dreamcast', 'naomi', 'atomiswave'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'flycast') || null;
  if (['xbox', 'og-xbox', 'original-xbox', 'ms-xbox'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'xemu') || null;
  if (['xbox360', 'xbox-360', 'x360'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'xenia') || null;
  if (['saturn', 'sega-saturn'].includes(slug)) return SUPPORTED_STANDALONE_EMULATORS.find((e) => e.id === 'yabasanshiro') || null;
  return null;
}

export const SUPPORTED_STANDALONE_EMULATORS: StandaloneEmulatorInfo[] = [
  { id: 'duckstation', flatpakId: 'org.duckstation.DuckStation', name: 'DuckStation', platforms: ['PlayStation (PS1)'], description: 'High performance PS1 emulator with hardware resolution scaling & rendering fixes' },
  { id: 'pcsx2', flatpakId: 'net.pcsx2.PCSX2', name: 'PCSX2', platforms: ['PlayStation 2'], description: 'Full-speed PlayStation 2 emulator with widescreen & HD patches' },
  { id: 'dolphin', flatpakId: 'org.DolphinEmu.dolphin-emu', name: 'Dolphin', platforms: ['GameCube', 'Wii'], description: 'Industry standard GameCube & Wii emulator with full controller support' },
  { id: 'flycast', flatpakId: 'org.flycast.Flycast', name: 'Flycast', platforms: ['Dreamcast', 'NAOMI', 'Atomiswave'], description: 'High performance Dreamcast & arcade emulator' },
  { id: 'yabasanshiro', flatpakId: 'org.yabasanshiro.YabaSanshiro', name: 'YabaSanshiro', platforms: ['Sega Saturn'], description: 'High performance Sega Saturn emulator with HD upscaling' },
  { id: 'ppsspp', flatpakId: 'org.ppsspp.PPSSPP', name: 'PPSSPP', platforms: ['PSP (PlayStation Portable)'], description: 'Fast, feature-rich PSP emulator with upscaling and HD textures' },
  { id: 'rpcs3', flatpakId: 'net.rpcs3.RPCS3', name: 'RPCS3', platforms: ['PlayStation 3'], description: 'PlayStation 3 open-source emulator' },
  { id: 'lime3ds', flatpakId: 'io.github.lime3ds.Lime3DS', name: 'Lime3DS', platforms: ['Nintendo 3DS'], description: 'Nintendo 3DS emulator fork of Citra' },
  { id: 'cemu', flatpakId: 'info.cemu.Cemu', name: 'Cemu', platforms: ['Wii U'], description: 'Nintendo Wii U emulator' },
  { id: 'ryujinx', flatpakId: 'org.ryujinx.Ryujinx', name: 'Ryujinx', platforms: ['Nintendo Switch'], description: 'Nintendo Switch emulator' },
  { id: 'xemu', flatpakId: 'app.xemu.xemu', name: 'Xemu', platforms: ['Microsoft Xbox (Original)'], description: 'Open-source Original Xbox emulator with HD upscaling & system link' },
  { id: 'xenia', flatpakId: 'jp.xenia.xenia', name: 'Xenia', platforms: ['Microsoft Xbox 360'], description: 'Xbox 360 emulator for Linux / Steam Deck' },
  { id: 'retroarch', flatpakId: 'org.libretro.RetroArch', name: 'RetroArch', platforms: ['Multi-System (NES, SNES, N64, GBA, Genesis, Arcade, etc.)'], description: 'All-in-one emulation frontend and libretro core runner' },
];

export const PLATFORM_AVAILABLE_CORES: Record<string, CoreOption[]> = {
  psx: [
    { id: 'duckstation', name: 'DuckStation', type: 'both', flatpakId: 'org.duckstation.DuckStation', recommended: true, description: 'Standalone & Libretro - Highest performance & resolution enhancement' },
    { id: 'pcsx_rearmed', name: 'PCSX ReARMed', type: 'libretro', recommended: true, description: 'Fast standard RetroArch core (Steam Deck standard)' },
    { id: 'swanstation', name: 'SwanStation', type: 'libretro', description: 'Accurate Libretro port of DuckStation' },
    { id: 'beetle_psx_hw', name: 'Beetle PSX HW', type: 'libretro', description: 'Vulkan/OpenGL hardware renderer' },
    { id: 'mednafen_psx', name: 'Beetle / Mednafen PSX', type: 'libretro', description: 'High-accuracy software rendering' },
  ],
  snes: [
    { id: 'snes9x', name: 'Snes9x', type: 'libretro', recommended: true, description: 'Default standard core with highest compatibility' },
    { id: 'bsnes', name: 'bsnes', type: 'libretro', description: 'Cycle-accurate Super Nintendo emulator' },
    { id: 'snes9x2010', name: 'Snes9x 2010', type: 'libretro', description: 'Optimized high performance core' },
    { id: 'mesen-s', name: 'Mesen-S', type: 'libretro', description: 'High-accuracy cycle-based SNES core' },
  ],
  gba: [
    { id: 'mgba', name: 'mGBA', type: 'libretro', recommended: true, description: 'Fast, accurate modern GBA core' },
    { id: 'vba_next', name: 'VBA Next', type: 'libretro', description: 'Optimized VisualBoyAdvance core' },
    { id: 'gpsp', name: 'gpSP', type: 'libretro', description: 'Lightweight dynarec GBA core' },
  ],
  n64: [
    { id: 'mupen64plus_next', name: 'Mupen64Plus-Next', type: 'libretro', recommended: true, description: 'Modern GLideN64 hardware acceleration' },
    { id: 'parallel_n64', name: 'ParaLLEl N64', type: 'libretro', description: 'Vulkan low-level RDP/RSP emulation' },
  ],
  nds: [
    { id: 'melondsds', name: 'melonDS DS', type: 'libretro', recommended: true, description: 'High accuracy DS core with DSi support' },
    { id: 'melonds', name: 'melonDS', type: 'libretro', description: 'Accurate standalone/Libretro DS core' },
    { id: 'desmume', name: 'DeSmuME', type: 'libretro', description: 'Classic Nintendo DS emulator' },
  ],
  genesis: [
    { id: 'genesis_plus_gx', name: 'Genesis Plus GX', type: 'libretro', recommended: true, description: 'Accurate Genesis, Mega CD & Master System' },
    { id: 'picodrive', name: 'PicoDrive', type: 'libretro', description: 'Optimized core with Sega 32X support' },
  ],
  nes: [
    { id: 'mesen', name: 'Mesen', type: 'libretro', recommended: true, description: 'Cycle-accurate NES/Famicom core' },
    { id: 'fceumm', name: 'FCEUmm', type: 'libretro', description: 'Broad compatibility with mapper hacks' },
    { id: 'nestopia', name: 'Nestopia UE', type: 'libretro', description: 'Highly accurate sound and cycle timing' },
  ],
  gamecube: [
    { id: 'dolphin_standalone', name: 'Dolphin (Standalone)', type: 'standalone', flatpakId: 'org.DolphinEmu.dolphin-emu', recommended: true, description: 'Full-speed GameCube & Wii emulator' },
    { id: 'dolphin', name: 'Dolphin (Libretro)', type: 'libretro', description: 'RetroArch Dolphin core' },
  ],
  wii: [
    { id: 'dolphin_standalone', name: 'Dolphin (Standalone)', type: 'standalone', flatpakId: 'org.DolphinEmu.dolphin-emu', recommended: true, description: 'Full-speed GameCube & Wii emulator' },
    { id: 'dolphin', name: 'Dolphin (Libretro)', type: 'libretro', description: 'RetroArch Dolphin core' },
  ],
  ps2: [
    { id: 'pcsx2_standalone', name: 'PCSX2 (Standalone)', type: 'standalone', flatpakId: 'net.pcsx2.PCSX2', recommended: true, description: 'Full-speed PlayStation 2 emulator' },
    { id: 'play', name: 'Play!', type: 'libretro', description: 'Experimental Libretro PS2 core' },
  ],
  psp: [
    { id: 'ppsspp', name: 'PPSSPP (Standalone)', type: 'standalone', flatpakId: 'org.ppsspp.PPSSPP', recommended: true, description: 'Full-speed PlayStation Portable emulator' },
    { id: 'ppsspp_libretro', name: 'PPSSPP (Libretro)', type: 'libretro', description: 'RetroArch PPSSPP core' },
  ],
  ps3: [
    { id: 'rpcs3', name: 'RPCS3 (Standalone)', type: 'standalone', flatpakId: 'net.rpcs3.RPCS3', recommended: true, description: 'Full-speed PlayStation 3 emulator' },
  ],
  '3ds': [
    { id: 'lime3ds', name: 'Lime3DS (Standalone)', type: 'standalone', flatpakId: 'io.github.lime3ds.Lime3DS', recommended: true, description: 'Nintendo 3DS emulator' },
  ],
  wiiu: [
    { id: 'cemu', name: 'Cemu (Standalone)', type: 'standalone', flatpakId: 'info.cemu.Cemu', recommended: true, description: 'Nintendo Wii U emulator' },
  ],
  switch: [
    { id: 'ryujinx', name: 'Ryujinx (Standalone)', type: 'standalone', flatpakId: 'org.ryujinx.Ryujinx', recommended: true, description: 'Nintendo Switch emulator' },
  ],
  arcade: [
    { id: 'fbneo', name: 'FinalBurn Neo', type: 'libretro', recommended: true, description: 'Arcade and Neo-Geo champion core' },
    { id: 'mame', name: 'MAME (Current)', type: 'libretro', description: 'Comprehensive multi-arcade core' },
    { id: 'mame2003_plus', name: 'MAME 2003-Plus', type: 'libretro', description: 'High speed for classic arcade titles' },
  ],
  dreamcast: [
    { id: 'flycast_standalone', name: 'Flycast (Standalone Flatpak)', type: 'standalone', flatpakId: 'org.flycast.Flycast', recommended: true, description: 'Standalone high performance Dreamcast, NAOMI & Atomiswave emulator' },
    { id: 'flycast', name: 'Flycast (Libretro)', type: 'libretro', recommended: false, description: 'RetroArch Flycast core with shader and RetroAchievements support' },
  ],
  xbox: [
    { id: 'xemu', name: 'Xemu (Standalone)', type: 'standalone', flatpakId: 'app.xemu.xemu', recommended: true, description: 'Open-source Original Xbox emulator for Linux / Steam Deck' },
  ],
  xbox360: [
    { id: 'xenia', name: 'Xenia (Standalone)', type: 'standalone', flatpakId: 'jp.xenia.xenia', recommended: true, description: 'Xbox 360 emulator for Linux / Steam Deck' },
  ],
  saturn: [
    { id: 'mednafen_saturn', name: 'Beetle Saturn', type: 'libretro', recommended: true, description: 'Accurate Sega Saturn core' },
    { id: 'yabasanshiro', name: 'YabaSanshiro', type: 'libretro', description: 'Fast Sega Saturn core with hardware upscaling' },
  ],
  gb: [
    { id: 'gambatte', name: 'Gambatte', type: 'libretro', recommended: true, description: 'Accurate Game Boy core' },
    { id: 'sameboy', name: 'SameBoy', type: 'libretro', description: 'High-accuracy cycle-accurate Game Boy core' },
    { id: 'mgba', name: 'mGBA', type: 'libretro', description: 'Modern GB/GBC core' },
  ],
  gbc: [
    { id: 'gambatte', name: 'Gambatte', type: 'libretro', recommended: true, description: 'Accurate Game Boy Color core' },
    { id: 'sameboy', name: 'SameBoy', type: 'libretro', description: 'High-accuracy Game Boy Color core' },
  ],
  segacd: [
    { id: 'genesis_plus_gx', name: 'Genesis Plus GX', type: 'libretro', recommended: true, description: 'Full Sega CD / Mega CD cycle emulation' },
    { id: 'picodrive', name: 'PicoDrive', type: 'libretro', description: 'Fast Sega CD & 32X core' },
  ],
  gamegear: [
    { id: 'genesis_plus_gx', name: 'Genesis Plus GX', type: 'libretro', recommended: true, description: 'Accurate Sega Game Gear & Master System core' },
  ],
  tg16: [
    { id: 'mednafen_pce_fast', name: 'Beetle PCE Fast', type: 'libretro', recommended: true, description: 'TurboGrafx-16 & PC Engine fast core' },
    { id: 'mednafen_pce', name: 'Beetle PCE Accurate', type: 'libretro', description: 'High-accuracy TurboGrafx-16 core' },
  ],
};

// Aliases for slug variations
PLATFORM_AVAILABLE_CORES['dc'] = PLATFORM_AVAILABLE_CORES['dreamcast'];
PLATFORM_AVAILABLE_CORES['ps1'] = PLATFORM_AVAILABLE_CORES['psx'];
PLATFORM_AVAILABLE_CORES['playstation'] = PLATFORM_AVAILABLE_CORES['psx'];
PLATFORM_AVAILABLE_CORES['super-nintendo'] = PLATFORM_AVAILABLE_CORES['snes'];
PLATFORM_AVAILABLE_CORES['game-boy-advance'] = PLATFORM_AVAILABLE_CORES['gba'];
PLATFORM_AVAILABLE_CORES['nintendo-64'] = PLATFORM_AVAILABLE_CORES['n64'];
PLATFORM_AVAILABLE_CORES['nintendo-ds'] = PLATFORM_AVAILABLE_CORES['nds'];
PLATFORM_AVAILABLE_CORES['n3ds'] = PLATFORM_AVAILABLE_CORES['3ds'];
PLATFORM_AVAILABLE_CORES['gc'] = PLATFORM_AVAILABLE_CORES['gamecube'];
PLATFORM_AVAILABLE_CORES['og-xbox'] = PLATFORM_AVAILABLE_CORES['xbox'];
PLATFORM_AVAILABLE_CORES['original-xbox'] = PLATFORM_AVAILABLE_CORES['xbox'];
PLATFORM_AVAILABLE_CORES['xbox-360'] = PLATFORM_AVAILABLE_CORES['xbox360'];
PLATFORM_AVAILABLE_CORES['x360'] = PLATFORM_AVAILABLE_CORES['xbox360'];
PLATFORM_AVAILABLE_CORES['sega-saturn'] = PLATFORM_AVAILABLE_CORES['saturn'];
PLATFORM_AVAILABLE_CORES['game-boy'] = PLATFORM_AVAILABLE_CORES['gb'];
PLATFORM_AVAILABLE_CORES['game-boy-color'] = PLATFORM_AVAILABLE_CORES['gbc'];
PLATFORM_AVAILABLE_CORES['sega-cd'] = PLATFORM_AVAILABLE_CORES['segacd'];
PLATFORM_AVAILABLE_CORES['mega-cd'] = PLATFORM_AVAILABLE_CORES['segacd'];
PLATFORM_AVAILABLE_CORES['gg'] = PLATFORM_AVAILABLE_CORES['gamegear'];
PLATFORM_AVAILABLE_CORES['sms'] = PLATFORM_AVAILABLE_CORES['gamegear'];
PLATFORM_AVAILABLE_CORES['mastersystem'] = PLATFORM_AVAILABLE_CORES['gamegear'];
PLATFORM_AVAILABLE_CORES['pce'] = PLATFORM_AVAILABLE_CORES['tg16'];
PLATFORM_AVAILABLE_CORES['pc-engine'] = PLATFORM_AVAILABLE_CORES['tg16'];
PLATFORM_AVAILABLE_CORES['turbografx-16'] = PLATFORM_AVAILABLE_CORES['tg16'];
PLATFORM_AVAILABLE_CORES['neogeo'] = PLATFORM_AVAILABLE_CORES['arcade'];
PLATFORM_AVAILABLE_CORES['mame'] = PLATFORM_AVAILABLE_CORES['arcade'];

export function getActiveCoreForGame(game: Game, config: RommConfig): string {
  if (config.gameCores?.[String(game.id)]) return config.gameCores[String(game.id)];
  if (config.platformCores?.[game.platformSlug]) return config.platformCores[game.platformSlug];
  const options = PLATFORM_AVAILABLE_CORES[game.platformSlug];
  if (options && options.length > 0) {
    const rec = options.find((o) => o.recommended);
    return rec ? rec.id : options[0].id;
  }
  return 'auto';
}

// ---------------------------------------------------------------------------
// BIOS and Firmware types
// ---------------------------------------------------------------------------
export interface RommFirmwareItem {
  id: number;
  fileName: string;
  filePath?: string;
  fileSizeBytes: number;
  platformId: number;
  platformSlug: string;
  platformName?: string;
  isVerified?: boolean;
  md5Hash?: string;
  sha1Hash?: string;
  crcHash?: string;
  missingFromFs?: boolean;
  isInstalled?: boolean;
  localPath?: string;
  localSizeBytes?: number;
  description?: string;
  requiredForEmulators?: string[];
}

export interface BiosProgressEvent {
  firmwareId: number | string;
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
  status: 'downloading' | 'completed' | 'error';
  path?: string;
  copiedTo?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// In-place App Update types
// ---------------------------------------------------------------------------
export interface AppUpdateInfo {
  hasUpdate: boolean;
  currentCommit: string;
  latestCommit: string;
  fullSha?: string;
  message: string;
  fullMessage?: string;
  author: string;
  date: string;
  repo: string;
  branch: string;
  isGit?: boolean;
  isAppImage?: boolean;
  releaseUrl?: string;
  error?: string;
}

export interface AppUpdateProgressEvent {
  stage: string;
  percent: number;
  message: string;
  log?: string;
}


