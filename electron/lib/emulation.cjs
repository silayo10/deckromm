'use strict';
/**
 * Emulation paths, ROM downloads to disk, and emulator process management.
 *
 * Process model:
 *   - Every emulator is spawned `detached: true`, which on Linux makes it the
 *     leader of a NEW process group. That lets us terminate the whole tree
 *     (flatpak -> bwrap -> retroarch) with a single `kill(-pgid)`.
 *   - Only one game runs at a time. While it runs the DeckRomM window is hidden
 *     so gamescope (Steam Game Mode) focuses the emulator window, and the
 *     renderer pauses Gamepad API polling so button presses meant for the game
 *     do not navigate the library underneath.
 *   - On exit (normal, crash, or app shutdown) the window is restored and the
 *     renderer is notified through `emulator:state`.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const HOME = os.homedir();

/** RomM platform slug -> EmuDeck / ES-DE roms folder name. */
const PLATFORM_FOLDERS = {
  nes: 'nes', famicom: 'famicom', fds: 'fds',
  snes: 'snes', sfam: 'sfc', 'super-nintendo': 'snes',
  n64: 'n64', 'nintendo-64': 'n64',
  gb: 'gb', gbc: 'gbc', gba: 'gba', 'game-boy-advance': 'gba',
  nds: 'nds', 'nintendo-ds': 'nds', '3ds': 'n3ds', n3ds: 'n3ds',
  ngc: 'gc', gc: 'gc', gamecube: 'gc', wii: 'wii', wiiu: 'wiiu', switch: 'switch',
  genesis: 'genesis', 'genesis-slash-megadrive': 'genesis', megadrive: 'megadrive',
  sms: 'mastersystem', mastersystem: 'mastersystem', gamegear: 'gamegear', gg: 'gamegear',
  segacd: 'segacd', sega32: 'sega32x', '32x': 'sega32x', saturn: 'saturn', dc: 'dreamcast', dreamcast: 'dreamcast',
  psx: 'psx', ps1: 'psx', playstation: 'psx', ps2: 'ps2', psp: 'psp', ps3: 'ps3',
  arcade: 'arcade', mame: 'mame', neogeo: 'neogeo', fbneo: 'fbneo',
  atari2600: 'atari2600', atari7800: 'atari7800', lynx: 'atarilynx', jaguar: 'atarijaguar',
  'turbografx-16-slash-pc-engine': 'pcengine', tg16: 'tg16', pce: 'pcengine',
  ngp: 'ngp', ngpc: 'ngpc', wonderswan: 'wonderswan', 'wonderswan-color': 'wonderswancolor',
  virtualboy: 'virtualboy', msx: 'msx', dos: 'dos', c64: 'c64', amiga: 'amiga',
  xbox: 'xbox', 'og-xbox': 'xbox', 'original-xbox': 'xbox',
  xbox360: 'xbox360', 'xbox-360': 'xbox360', x360: 'xbox360',
};

/** RomM platform slug -> libretro core basename. */
const LIBRETRO_CORES = {
  nes: 'mesen', famicom: 'mesen', fds: 'mesen',
  snes: 'snes9x', sfam: 'snes9x', 'super-nintendo': 'snes9x',
  n64: 'mupen64plus_next', 'nintendo-64': 'mupen64plus_next',
  gb: 'gambatte', gbc: 'gambatte', gba: 'mgba', 'game-boy-advance': 'mgba',
  nds: 'melondsds', 'nintendo-ds': 'melondsds',
  genesis: 'genesis_plus_gx', 'genesis-slash-megadrive': 'genesis_plus_gx', megadrive: 'genesis_plus_gx',
  sms: 'genesis_plus_gx', mastersystem: 'genesis_plus_gx', gamegear: 'genesis_plus_gx', gg: 'genesis_plus_gx',
  segacd: 'genesis_plus_gx', sega32: 'picodrive', '32x': 'picodrive', saturn: 'mednafen_saturn',
  dc: 'flycast', dreamcast: 'flycast',
  psx: 'swanstation', ps1: 'swanstation', playstation: 'swanstation', psp: 'ppsspp',
  arcade: 'fbneo', mame: 'mame', neogeo: 'fbneo', fbneo: 'fbneo',
  atari2600: 'stella', atari7800: 'prosystem', lynx: 'handy',
  'turbografx-16-slash-pc-engine': 'mednafen_pce_fast', tg16: 'mednafen_pce_fast', pce: 'mednafen_pce_fast',
  ngp: 'mednafen_ngp', ngpc: 'mednafen_ngp', wonderswan: 'mednafen_wswan', 'wonderswan-color': 'mednafen_wswan',
  virtualboy: 'mednafen_vb', dos: 'dosbox_pure', c64: 'vice_x64',
};

/** Standalone emulators preferred over RetroArch when installed (flatpak ids). */
const STANDALONE = {
  psx: { flatpak: 'org.duckstation.DuckStation', args: (rom) => ['-batch', '-fullscreen', rom] },
  ps1: { flatpak: 'org.duckstation.DuckStation', args: (rom) => ['-batch', '-fullscreen', rom] },
  playstation: { flatpak: 'org.duckstation.DuckStation', args: (rom) => ['-batch', '-fullscreen', rom] },
  ps2: { flatpak: 'net.pcsx2.PCSX2', args: (rom) => ['-fullscreen', '-batch', rom] },
  gc: { flatpak: 'org.DolphinEmu.dolphin-emu', args: (rom) => ['-b', '-e', rom] },
  ngc: { flatpak: 'org.DolphinEmu.dolphin-emu', args: (rom) => ['-b', '-e', rom] },
  gamecube: { flatpak: 'org.DolphinEmu.dolphin-emu', args: (rom) => ['-b', '-e', rom] },
  wii: { flatpak: 'org.DolphinEmu.dolphin-emu', args: (rom) => ['-b', '-e', rom] },
  psp: { flatpak: 'org.ppsspp.PPSSPP', args: (rom) => ['-f', rom] },
  ps3: { flatpak: 'net.rpcs3.RPCS3', args: (rom) => ['--no-gui', rom] },
  '3ds': { flatpak: 'io.github.lime3ds.Lime3DS', fallbackFlatpak: 'org.citra_emu.citra', args: (rom) => ['-f', rom] },
  n3ds: { flatpak: 'io.github.lime3ds.Lime3DS', fallbackFlatpak: 'org.citra_emu.citra', args: (rom) => ['-f', rom] },
  wiiu: { flatpak: 'info.cemu.Cemu', args: (rom) => ['-f', '-g', rom] },
  switch: { flatpak: 'org.ryujinx.Ryujinx', args: (rom) => ['--fullscreen', rom] },
  dc: { flatpak: 'org.flycast.Flycast', args: (rom) => [rom] },
  dreamcast: { flatpak: 'org.flycast.Flycast', args: (rom) => [rom] },
  saturn: { flatpak: 'org.yabasanshiro.YabaSanshiro', args: (rom) => [rom] },
  'sega-saturn': { flatpak: 'org.yabasanshiro.YabaSanshiro', args: (rom) => [rom] },
  xbox: { flatpak: 'app.xemu.xemu', args: (rom) => ['-full-screen', '-dvd_path', rom] },
  'og-xbox': { flatpak: 'app.xemu.xemu', args: (rom) => ['-full-screen', '-dvd_path', rom] },
  'original-xbox': { flatpak: 'app.xemu.xemu', args: (rom) => ['-full-screen', '-dvd_path', rom] },
  xbox360: { flatpak: 'jp.xenia.xenia', args: (rom) => [rom] },
  'xbox-360': { flatpak: 'jp.xenia.xenia', args: (rom) => [rom] },
  x360: { flatpak: 'jp.xenia.xenia', args: (rom) => [rom] },
};

/** Fallback core search order when a specific core is not specified or not installed */
const CORE_FALLBACKS = {
  dc: ['flycast', 'redream'],
  dreamcast: ['flycast', 'redream'],
  saturn: ['mednafen_saturn', 'yabasanshiro', 'kronos', 'beetle_saturn'],
  'sega-saturn': ['mednafen_saturn', 'yabasanshiro', 'kronos'],
  psx: ['duckstation', 'pcsx_rearmed', 'swanstation', 'mednafen_psx_hw', 'mednafen_psx', 'beetle_psx_hw', 'beetle_psx'],
  ps1: ['duckstation', 'pcsx_rearmed', 'swanstation', 'mednafen_psx_hw', 'mednafen_psx'],
  playstation: ['duckstation', 'pcsx_rearmed', 'swanstation', 'mednafen_psx_hw', 'mednafen_psx'],
  snes: ['snes9x', 'bsnes', 'snes9x2010', 'snes9x2005', 'mesen-s'],
  'super-nintendo': ['snes9x', 'bsnes', 'snes9x2010', 'mesen-s'],
  gba: ['mgba', 'vba_next', 'gpsp', 'vbam'],
  'game-boy-advance': ['mgba', 'vba_next', 'gpsp'],
  n64: ['mupen64plus_next', 'parallel_n64'],
  'nintendo-64': ['mupen64plus_next', 'parallel_n64'],
  nds: ['melondsds', 'melonds', 'desmume'],
  'nintendo-ds': ['melondsds', 'melonds', 'desmume'],
  genesis: ['genesis_plus_gx', 'picodrive'],
  'sega-genesis': ['genesis_plus_gx', 'picodrive'],
  megadrive: ['genesis_plus_gx', 'picodrive'],
  segacd: ['genesis_plus_gx', 'picodrive'],
  'sega-cd': ['genesis_plus_gx', 'picodrive'],
  tg16: ['mednafen_pce_fast', 'mednafen_pce'],
  pce: ['mednafen_pce_fast', 'mednafen_pce'],
  nes: ['mesen', 'fceumm', 'nestopia'],
  arcade: ['fbneo', 'mame', 'mame2003_plus'],
  gb: ['gambatte', 'sameboy', 'mgba'],
  gbc: ['gambatte', 'sameboy', 'mgba'],
  xbox: ['xemu'],
  xbox360: ['xenia'],
};

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(HOME, p.slice(1)) : p;
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function which(bin) {
  for (const dir of (process.env.PATH || '').split(':')) {
    const full = path.join(dir, bin);
    if (exists(full)) return full;
  }
  return null;
}

function execFileP(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

let flatpakCache = null;
function clearFlatpakCache() {
  flatpakCache = null;
}

async function installedFlatpaks() {
  if (flatpakCache) return flatpakCache;
  const out = which('flatpak') ? await execFileP('flatpak', ['list', '--app', '--columns=application']) : null;
  flatpakCache = new Set((out || '').split('\n').map((s) => s.trim()).filter(Boolean));
  return flatpakCache;
}

async function getFlatpakStatus(flatpakIds = []) {
  const hasFlatpakBin = Boolean(which('flatpak'));
  if (!hasFlatpakBin) {
    return { flatpakAvailable: false, installed: {} };
  }
  const installedSet = await installedFlatpaks();
  const installedMap = {};
  for (const id of flatpakIds) {
    installedMap[id] = installedSet.has(id);
  }
  return { flatpakAvailable: true, installed: installedMap };
}

async function installFlatpak(flatpakId, emitProgress) {
  if (!which('flatpak')) {
    return { ok: false, message: 'Flatpak package manager is not installed on this system.' };
  }
  if (!flatpakId || typeof flatpakId !== 'string') {
    return { ok: false, message: 'Invalid Flatpak application ID.' };
  }

  clearFlatpakCache();

  return new Promise((resolve) => {
    emitProgress?.({ flatpakId, status: 'installing', progress: 0, message: `Starting installation of ${flatpakId}...` });

    const child = spawn('flatpak', ['install', '-y', '--noninteractive', 'flathub', flatpakId], {
      env: childEnv(),
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout?.on('data', (data) => {
      const str = data.toString();
      stdoutData += str;
      const match = str.match(/(\d+)%/);
      const pct = match ? parseInt(match[1], 10) : undefined;
      emitProgress?.({ flatpakId, status: 'installing', progress: pct, message: str.trim().split('\n').pop() || 'Installing...' });
    });

    child.stderr?.on('data', (data) => {
      const str = data.toString();
      stderrData += str;
    });

    child.on('error', (err) => {
      clearFlatpakCache();
      emitProgress?.({ flatpakId, status: 'error', message: err.message });
      resolve({ ok: false, message: err.message });
    });

    child.on('close', (code) => {
      clearFlatpakCache();
      if (code === 0) {
        emitProgress?.({ flatpakId, status: 'completed', progress: 100, message: `Successfully installed ${flatpakId}` });
        resolve({ ok: true, message: `Successfully installed ${flatpakId}` });
      } else {
        // Fallback run without 'flathub' remote explicitly specified
        const fallbackChild = spawn('flatpak', ['install', '-y', '--noninteractive', flatpakId], {
          env: childEnv(),
        });
        let fbStderr = '';
        fallbackChild.stderr?.on('data', (d) => { fbStderr += d.toString(); });
        fallbackChild.stdout?.on('data', (d) => {
          const str = d.toString();
          const match = str.match(/(\d+)%/);
          const pct = match ? parseInt(match[1], 10) : undefined;
          emitProgress?.({ flatpakId, status: 'installing', progress: pct, message: str.trim().split('\n').pop() || 'Installing...' });
        });
        fallbackChild.on('close', (fbCode) => {
          clearFlatpakCache();
          if (fbCode === 0) {
            emitProgress?.({ flatpakId, status: 'completed', progress: 100, message: `Successfully installed ${flatpakId}` });
            resolve({ ok: true, message: `Successfully installed ${flatpakId}` });
          } else {
            const err = (fbStderr || stderrData || stdoutData || `Process exited with code ${code}`).trim();
            emitProgress?.({ flatpakId, status: 'error', message: err });
            resolve({ ok: false, message: `Failed to install ${flatpakId}: ${err}` });
          }
        });
      }
    });
  });
}

/** Read EmuDeck's settings.sh for the configured emulation root. */
function emudeckEmulationPath() {
  const candidates = [
    path.join(HOME, '.config', 'EmuDeck', 'settings.sh'),
    path.join(HOME, 'emudeck', 'settings.sh'),
  ];
  for (const file of candidates) {
    try {
      const txt = fs.readFileSync(file, 'utf8');
      const m = txt.match(/^\s*emulationPath\s*=\s*["']?([^"'\n]+)["']?/m);
      if (m && exists(m[1])) return m[1].replace(/\/+$/, '');
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Returns the Emulation root directory (the folder that contains `roms/`). */
function detectEmulationRoot(configured) {
  const fromConfig = expandHome(configured || '');
  if (fromConfig) {
    // Accept either ".../Emulation" or ".../Emulation/roms"
    const cleaned = fromConfig.replace(/\/+$/, '');
    return cleaned.endsWith('/roms') ? path.dirname(cleaned) : cleaned;
  }
  const emudeck = emudeckEmulationPath();
  if (emudeck) return emudeck;

  const mediaRoots = ['/run/media/deck', '/run/media'];
  for (const root of mediaRoots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        const candidate = path.join(root, entry, 'Emulation');
        if (exists(path.join(candidate, 'roms'))) return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  const home = path.join(HOME, 'Emulation');
  if (exists(path.join(home, 'roms'))) return home;
  return home; // default - created on first download
}

function romTargetPath(root, platformSlug, fileName) {
  const folder = PLATFORM_FOLDERS[platformSlug] || platformSlug || 'misc';
  const safeName = path.basename(String(fileName || 'rom.bin')).replace(/[\0/]/g, '_');
  return path.join(root, 'roms', folder, safeName);
}

async function storageStats(root) {
  const stat = async (p) => {
    try {
      const s = await fsp.statfs(p);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return { total, free, used: total - free };
    } catch {
      return null;
    }
  };
  const internal = await stat(HOME);
  let sd = null;
  let sdPath = null;
  for (const root2 of ['/run/media/deck', '/run/media']) {
    try {
      for (const entry of fs.readdirSync(root2)) {
        const p = path.join(root2, entry);
        if (fs.statSync(p).isDirectory() && entry !== 'deck') {
          sd = await stat(p);
          sdPath = p;
          if (sd) break;
        }
      }
    } catch {
      /* ignore */
    }
    if (sd) break;
  }
  return {
    emulationRoot: root,
    internalTotalBytes: internal ? internal.total : 0,
    internalFreeBytes: internal ? internal.free : 0,
    internalUsedBytes: internal ? internal.used : 0,
    sdCardMounted: Boolean(sd),
    sdPath,
    sdTotalBytes: sd ? sd.total : 0,
    sdFreeBytes: sd ? sd.free : 0,
    sdUsedBytes: sd ? sd.used : 0,
    storageTarget: sdPath && root.startsWith(sdPath) ? 'sdcard' : 'internal',
    isRealDeckFs: true,
  };
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
class DownloadManager {
  /**
   * @param {{ romm: import('./rommClient.cjs').RommClient, getRoot: () => string, emit: (ch: string, payload: any) => void, log: Function, userDataDir?: string }} deps
   */
  constructor({ romm, getRoot, emit, log, userDataDir }) {
    this.romm = romm;
    this.getRoot = getRoot;
    this.emit = emit;
    this.log = log;
    this.userDataDir = userDataDir;
    this.active = new Map(); // romId -> AbortController
  }

  localPath(req) {
    return romTargetPath(this.getRoot(), req.platformSlug, req.fileName);
  }

  localStatus(list) {
    const out = {};
    for (const item of list || []) {
      const p = this.localPath(item);
      try {
        const st = fs.statSync(p);
        out[String(item.romId)] = { exists: true, path: p, size: st.size };
      } catch {
        out[String(item.romId)] = { exists: false, path: p, size: 0 };
      }
    }
    return out;
  }

  cancel(romId) {
    const ctl = this.active.get(String(romId));
    if (ctl) ctl.abort();
    return { ok: Boolean(ctl) };
  }

  cancelAll() {
    for (const ctl of this.active.values()) ctl.abort();
  }

  /**
   * Download cover and backdrop artwork alongside the ROM on disk, and populate
   * the Electron disk cache so artwork renders instantaneously offline.
   */
  async downloadArtwork(req, targetRomPath) {
    const romPath = targetRomPath || this.localPath(req);
    const baseWithoutExt = romPath.replace(/\.[^/.]+$/, '');
    const dir = path.dirname(romPath);
    await fsp.mkdir(dir, { recursive: true });

    let localCoverPath = null;
    let coverUrl = req.coverUrl;

    // If coverUrl is not provided directly, try looking it up from RomM
    if (!coverUrl && req.romId && this.romm) {
      try {
        const enc = encodeURIComponent(String(req.romId));
        const res = await this.romm.authedFetch(`/api/roms/${enc}`, { timeoutMs: 12000, silent: true });
        if (res && res.ok) {
          const romData = await res.json();
          coverUrl = romData.path_cover_large || romData.path_cover_small || romData.url_cover;
          if (!req.title) req.title = romData.name || romData.fs_name;
          if (!req.summary) req.summary = romData.summary;
          if (!req.developer && romData.metadatum?.companies) req.developer = romData.metadatum.companies[0];
          if (!req.releaseYear && (romData.metadatum?.first_release_date || romData.first_release_date)) {
            const rawD = romData.metadatum?.first_release_date ?? romData.first_release_date;
            const ms = rawD > 1e11 ? rawD : rawD * 1000;
            req.releaseYear = new Date(ms).getFullYear();
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (coverUrl) {
      try {
        let res = null;
        const creds = this.romm ? this.romm.getCreds() : null;
        const isAbsolute = /^https?:\/\//i.test(coverUrl);
        if (isAbsolute && !(creds && coverUrl.startsWith(creds.baseUrl))) {
          res = await fetch(coverUrl);
        } else {
          const rel = isAbsolute ? coverUrl.slice(creds.baseUrl.length) : coverUrl.startsWith('/') ? coverUrl : `/${coverUrl}`;
          res = await this.romm.authedFetch(rel, { headers: { Accept: 'image/*' }, timeoutMs: 20000, silent: true });
        }

        if (res && res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ctype = res.headers.get('content-type') || 'image/jpeg';
          const ext = ctype.includes('png') ? '.png' : ctype.includes('webp') ? '.webp' : '.jpg';

          localCoverPath = `${baseWithoutExt}.cover${ext}`;
          const thumbPath = `${baseWithoutExt}-thumb${ext}`;

          await Promise.all([
            fsp.writeFile(localCoverPath, buf),
            fsp.writeFile(thumbPath, buf),
          ]);

          // Also populate the global Electron cover cache
          if (this.userDataDir) {
            const cacheDir = path.join(this.userDataDir, 'cache', 'covers');
            await fsp.mkdir(cacheDir, { recursive: true });
            const hash = crypto.createHash('sha1').update(coverUrl).digest('hex');
            const cacheFile = path.join(cacheDir, hash);
            await Promise.all([
              fsp.writeFile(cacheFile, buf),
              fsp.writeFile(`${cacheFile}.type`, ctype),
            ]).catch(() => {});
          }

          this.log(`[artwork] saved offline cover for ${req.title || req.fileName} -> ${localCoverPath}`);
        }
      } catch (err) {
        this.log(`[artwork] error downloading cover: ${err.message}`);
      }
    }

    // Save companion metadata JSON alongside ROM
    try {
      const meta = {
        romId: req.romId,
        title: req.title || path.basename(romPath).replace(/\.[^/.]+$/, ''),
        platformSlug: req.platformSlug,
        fileName: req.fileName || path.basename(romPath),
        sizeBytes: req.sizeBytes,
        releaseYear: req.releaseYear || 0,
        developer: req.developer || '',
        publisher: req.publisher || '',
        genres: req.genres || [],
        rating: req.rating || 0,
        summary: req.summary || '',
        coverUrl: coverUrl || '',
        coverPath: localCoverPath || undefined,
        backdropUrl: req.backdropUrl || '',
        savedAt: Date.now(),
      };
      await fsp.writeFile(`${baseWithoutExt}.romm.json`, JSON.stringify(meta, null, 2), 'utf8');
    } catch {
      /* ignore */
    }

    return { ok: Boolean(localCoverPath), coverPath: localCoverPath };
  }

  /**
   * Scan all downloaded games on disk, identify any missing offline covers,
   * and download/cache them so the entire offline library has artwork.
   */
  async syncAllOfflineArtwork() {
    const listRes = await this.listDownloaded();
    const items = listRes.items || [];
    let synced = 0;
    for (const item of items) {
      if (!item.hasLocalArtwork) {
        try {
          const req = {
            romId: item.meta?.romId || item.fileName,
            platformSlug: item.platformSlug,
            fileName: item.fileName,
            title: item.meta?.title || item.fileName.replace(/\.[^/.]+$/, ''),
            coverUrl: item.meta?.coverUrl,
          };
          const r = await this.downloadArtwork(req, item.fullPath);
          if (r && r.ok) synced++;
        } catch {
          /* ignore */
        }
      }
    }
    return {
      ok: true,
      total: items.length,
      downloaded: synced,
      message: synced > 0 ? `Downloaded offline artwork for ${synced} games` : 'All downloaded games already have offline covers',
    };
  }

  /**
   * Stream `/api/roms/{id}/content/{fileName}` to disk with progress events.
   * Writes to `<file>.part` and renames on success, so a half-finished download
   * is never mistaken for a complete ROM.
   * Automatically downloads companion artwork and metadata for offline mode.
   */
  async download(req) {
    const romId = String(req.romId);
    const target = this.localPath(req);
    if (this.active.has(romId)) return { ok: false, message: 'Download already in progress' };

    try {
      const st = await fsp.stat(target);
      // Multi-file ROMs arrive as a zip whose size differs from fs_size_bytes, so any
      // non-empty completed file (no .part suffix) counts as present unless forced.
      if (!req.force && st.size > 0) {
        // Ensure companion artwork is downloaded if missing
        void this.downloadArtwork(req, target).catch(() => {});
        this.emit('rom:progress', { romId, status: 'completed', loaded: st.size, total: st.size, speedMbps: 0, path: target });
        return { ok: true, path: target, cached: true };
      }
    } catch {
      /* not present */
    }

    const ctl = new AbortController();
    this.active.set(romId, ctl);
    const part = `${target}.part`;
    let handle = null;
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const res = await this.openContent(req, ctl.signal);

      const total = Number(res.headers.get('content-length')) || Number(req.sizeBytes) || 0;
      handle = await fsp.open(part, 'w');
      const reader = res.body.getReader();
      let loaded = 0;
      let lastEmit = 0;
      const started = Date.now();
      this.emit('rom:progress', { romId, status: 'downloading', loaded: 0, total, speedMbps: 0 });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await handle.write(value);
        loaded += value.byteLength;
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          const secs = Math.max(0.001, (now - started) / 1000);
          this.emit('rom:progress', { romId, status: 'downloading', loaded, total, speedMbps: (loaded * 8) / 1e6 / secs });
        }
      }
      await handle.close();
      handle = null;
      await fsp.rename(part, target);

      // Download cover and metadata alongside the ROM for complete offline self-containment
      try {
        await this.downloadArtwork(req, target);
      } catch (err) {
        this.log(`[artwork] warning: could not download cover for ${req.fileName}: ${err.message}`);
      }

      this.emit('rom:progress', { romId, status: 'completed', loaded, total: total || loaded, speedMbps: 0, path: target });
      return { ok: true, path: target };
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      await fsp.rm(part, { force: true }).catch(() => {});
      const cancelled = ctl.signal.aborted;
      this.emit('rom:progress', { romId, status: cancelled ? 'cancelled' : 'error', loaded: 0, total: 0, speedMbps: 0, message: e.message });
      return { ok: false, cancelled, authRequired: Boolean(e.authRequired), message: cancelled ? 'Cancelled' : e.message };
    } finally {
      this.active.delete(romId);
    }
  }

  /**
   * Open the ROM content stream. The primary URL is `/api/roms/{id}/content/{fs_name}`.
   * When RomM answers 404 (seen for some NES / N64 entries: stale fs_name, folder-based
   * multi-file ROMs, or extra non-game files attached to the ROM) we look the ROM up and
   * retry with its real file list before giving up with an actionable message.
   */
  async openContent(req, signal) {
    const romId = String(req.romId);
    const get = (p, query) =>
      this.romm.authedFetch(p, { headers: { Accept: 'application/octet-stream' }, signal, query, timeoutMs: 60000 });
    const enc = encodeURIComponent;
    const detailOf = async (res) => {
      const txt = await res.text().catch(() => '');
      try {
        return JSON.parse(txt).detail || txt;
      } catch {
        return txt;
      }
    };

    const first = await get(`/api/roms/${enc(romId)}/content/${enc(req.fileName)}`);
    if (first.ok && first.body) return first;
    let lastStatus = first.status;
    let lastDetail = await detailOf(first);
    if (first.status !== 404) throw new Error(`Download failed: HTTP ${first.status}${lastDetail ? ` (${String(lastDetail).slice(0, 160)})` : ''}`);

    // Look the ROM up to find its actual files
    let rom = null;
    try {
      const r = await this.romm.authedFetch(`/api/roms/${enc(romId)}`, { signal });
      if (r.ok) rom = await r.json();
    } catch (e) {
      if (e && e.authRequired) throw e;
    }
    if (rom) {
      if (rom.missing_from_fs || rom.has_file_on_disk === false) {
        throw new Error(`RomM reports the file for "${rom.name || req.title || romId}" is missing on the server. Rescan this platform in RomM, then try again.`);
      }
      const files = Array.isArray(rom.files) ? rom.files : [];
      const gameFiles = files.filter((f) => !f.category || f.category === 'game');
      const candidates = [];
      if (gameFiles.length === 1) {
        const f = gameFiles[0];
        candidates.push([`/api/roms/${enc(romId)}/content/${enc(f.file_name)}`, { file_ids: String(f.id) }]);
        candidates.push([`/api/roms/${enc(f.id)}/files/content/${enc(f.file_name)}`, undefined]);
      } else if (gameFiles.length > 1) {
        candidates.push([`/api/roms/${enc(romId)}/content/${enc(rom.fs_name || req.fileName)}`, { file_ids: gameFiles.map((f) => f.id).join(',') }]);
      }
      if (rom.fs_name && rom.fs_name !== req.fileName) candidates.push([`/api/roms/${enc(romId)}/content/${enc(rom.fs_name)}`, undefined]);
      for (const [p, q] of candidates) {
        const res = await get(p, q);
        if (res.ok && res.body) return res;
        lastStatus = res.status;
        lastDetail = (await detailOf(res)) || lastDetail;
      }
    }
    throw new Error(
      `Download failed: RomM returned HTTP ${lastStatus}${lastDetail ? ` (${String(lastDetail).slice(0, 160)})` : ''}. ` +
        'The file may have been moved or renamed on the server - rescan this platform in RomM.'
    );
  }

  async deleteLocal(req) {
    const p = this.localPath(req);
    await fsp.rm(p, { force: true });
    // Also remove companion artwork and metadata
    const base = p.replace(/\.[^/.]+$/, '');
    const cleanups = [
      `${base}.cover.jpg`, `${base}.cover.png`, `${base}.cover.webp`,
      `${base}-thumb.jpg`, `${base}-thumb.png`, `${base}-thumb.webp`,
      `${base}.backdrop.jpg`, `${base}.backdrop.png`,
      `${base}.romm.json`,
    ];
    for (const f of cleanups) {
      await fsp.rm(f, { force: true }).catch(() => {});
    }
    return { ok: true };
  }

  /**
   * Scan ~/Emulation/roms/ (or configured root) for all downloaded ROM files.
   * Returns each ROM file with platform slug, file name, path, sizeBytes, mtime,
   * companion coverPath, coverUrl, hasLocalArtwork, and companion metadata.
   */
  async listDownloaded() {
    const romsRoot = path.join(this.getRoot(), 'roms');
    const items = [];
    let totalSizeBytes = 0;

    try {
      const platformDirs = await fsp.readdir(romsRoot, { withFileTypes: true });
      for (const pDir of platformDirs) {
        if (!pDir.isDirectory() || pDir.name.startsWith('.')) continue;
        const platformSlug = pDir.name;
        const subPath = path.join(romsRoot, platformSlug);
        try {
          const files = await fsp.readdir(subPath, { withFileTypes: true });
          for (const file of files) {
            if (!file.isFile() || file.name.startsWith('.')) continue;
            // Skip companion artwork, metadata, and incomplete downloads
            if (
              file.name.endsWith('.part') ||
              file.name.endsWith('.romm.json') ||
              file.name.includes('.cover.') ||
              file.name.includes('-thumb.') ||
              file.name.includes('.backdrop.')
            ) continue;

            const fullPath = path.join(subPath, file.name);
            const st = await fsp.stat(fullPath).catch(() => null);
            if (st && st.size > 0) {
              totalSizeBytes += st.size;
              const baseWithoutExt = fullPath.replace(/\.[^/.]+$/, '');

              // Check for companion cover
              let coverPath = null;
              for (const ext of ['.cover.jpg', '.cover.png', '.cover.webp', '-thumb.jpg', '-thumb.png', '.jpg', '.png']) {
                const candidate = `${baseWithoutExt}${ext}`;
                if (fs.existsSync(candidate)) {
                  coverPath = candidate;
                  break;
                }
              }

              // Check for companion metadata JSON
              let meta = null;
              const jsonPath = `${baseWithoutExt}.romm.json`;
              if (fs.existsSync(jsonPath)) {
                try {
                  meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                } catch {
                  /* ignore */
                }
              }

              const coverUrl = coverPath
                ? `romm-asset://local-file/?p=${encodeURIComponent(coverPath)}`
                : (meta?.coverUrl || undefined);

              items.push({
                platformSlug,
                fileName: file.name,
                fullPath,
                sizeBytes: st.size,
                mtime: st.mtimeMs,
                coverPath: coverPath || undefined,
                coverUrl,
                hasLocalArtwork: Boolean(coverPath),
                meta: meta || undefined,
              });
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    } catch {
      // ignore root read error
    }

    return { items, totalSizeBytes, romsRoot };
  }
}

// ---------------------------------------------------------------------------
// Emulator launching
// ---------------------------------------------------------------------------
function fillTemplate(tpl, vars) {
  // Tokenize respecting simple double quotes, then substitute placeholders per token
  const tokens = tpl.match(/"[^"]*"|\S+/g) || [];
  return tokens.map((t) => t.replace(/^"|"$/g, '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : '')));
}

async function findRetroArch() {
  const flatpaks = await installedFlatpaks();
  if (flatpaks.has('org.libretro.RetroArch')) {
    return {
      cmd: 'flatpak',
      pre: ['run', 'org.libretro.RetroArch'],
      coreDirs: [
        path.join(HOME, '.var/app/org.libretro.RetroArch/config/retroarch/cores'),
        '/var/lib/flatpak/app/org.libretro.RetroArch/current/active/files/lib/retroarch/cores',
      ],
      flatpakId: 'org.libretro.RetroArch',
    };
  }
  const bin = which('retroarch');
  if (bin) {
    return {
      cmd: bin,
      pre: [],
      coreDirs: [path.join(HOME, '.config/retroarch/cores'), '/usr/lib/libretro', '/usr/lib/x86_64-linux-gnu/libretro'],
    };
  }
  // Steam build of RetroArch
  const steamRa = path.join(HOME, '.local/share/Steam/steamapps/common/RetroArch/retroarch');
  if (exists(steamRa)) {
    return { cmd: steamRa, pre: [], coreDirs: [path.join(path.dirname(steamRa), 'cores')] };
  }
  return null;
}

function findCore(coreDirs, coreName) {
  if (!coreName) return null;
  for (const dir of coreDirs) {
    const p = path.join(dir, `${coreName}_libretro.so`);
    if (exists(p)) return p;
  }
  return null;
}

/** Build the child environment: strip AppImage/Electron leakage, restore Steam overlay preload. */
function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.CHROME_DESKTOP;
  delete env.GDK_BACKEND;
  const appdir = env.APPDIR;
  if (appdir && env.LD_LIBRARY_PATH) {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH.split(':').filter((p) => p && !p.startsWith(appdir)).join(':');
    if (!env.LD_LIBRARY_PATH) delete env.LD_LIBRARY_PATH;
  }
  // launch_deckromm.sh stashes Steam's LD_PRELOAD (gameoverlayrenderer.so) because it
  // can crash Chromium; the emulator gets it back so the Steam overlay works in-game.
  if (env.DECKROMM_ORIG_LD_PRELOAD) env.LD_PRELOAD = env.DECKROMM_ORIG_LD_PRELOAD;
  return env;
}

/** Check if a flatpak app is actively running via `flatpak ps`. */
async function isFlatpakRunning(flatpakId) {
  if (!flatpakId || !which('flatpak')) return false;
  try {
    const out = await execFileP('flatpak', ['ps', '--columns=application'], 2000);
    if (!out) return false;
    return out.split('\n').some((line) => line.trim() === flatpakId);
  } catch {
    return false;
  }
}

/**
 * Ensures the newly mapped emulator window gets focus and is brought to the top.
 * Uses xdotool and/or wmctrl if present on SteamOS or Linux desktop.
 */
function activateEmulatorWindow(flatpakId, label) {
  const searchTerms = [];
  if (flatpakId) {
    searchTerms.push(flatpakId);
    const shortName = flatpakId.split('.').pop();
    if (shortName && !searchTerms.includes(shortName)) searchTerms.push(shortName);
  }
  if (label && typeof label === 'string') {
    const cleanLabel = label.split(' ')[0].replace(/[^a-zA-Z0-9_-]/g, '');
    if (cleanLabel && !searchTerms.includes(cleanLabel)) {
      searchTerms.push(cleanLabel);
    }
  }

  const hasWmctrl = Boolean(which('wmctrl'));
  const hasXdotool = Boolean(which('xdotool'));
  if (!hasWmctrl && !hasXdotool) return;

  const tryActivate = () => {
    for (const term of searchTerms) {
      if (hasWmctrl) {
        execFileP('wmctrl', ['-x', '-a', term], 800).catch(() => {});
        execFileP('wmctrl', ['-a', term], 800).catch(() => {});
      }
      if (hasXdotool) {
        execFileP('xdotool', ['search', '--onlyvisible', '--class', term, 'windowactivate'], 800).catch(() => {});
        execFileP('xdotool', ['search', '--onlyvisible', '--name', term, 'windowactivate'], 800).catch(() => {});
      }
    }
  };

  setTimeout(tryActivate, 600);
  setTimeout(tryActivate, 1400);
  setTimeout(tryActivate, 2600);
}

class EmulatorManager {
  /**
   * @param {{ getConfig: () => any, emit: Function, onGameStart: Function, onGameEnd: Function, log: Function, logDir: string }} deps
   */
  constructor({ getConfig, emit, onGameStart, onGameEnd, log, logDir }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.onGameStart = onGameStart;
    this.onGameEnd = onGameEnd;
    this.log = log;
    this.logDir = logDir;
    this.current = null; // { child, pgid, romId, title, startedAt, flatpakId }
  }

  running() {
    if (!this.current) return { running: false };
    const { romId, title, startedAt, command } = this.current;
    return { running: true, romId, title, startedAt, command };
  }

  async resolveCommand({ romPath, platformSlug, romId, emulatorCore }) {
    const cfg = this.getConfig();
    const slug = (platformSlug || '').toLowerCase();
    const explicitCore = emulatorCore || cfg.gameCores?.[String(romId)] || cfg.platformCores?.[slug] || '';
    const core = explicitCore || LIBRETRO_CORES[slug] || '';
    const vars = { rom: romPath, platform: slug, core, romdir: path.dirname(romPath) };

    const override = (cfg.launcherOverrides || {})[slug];
    if (override && override.trim()) {
      const [cmd, ...args] = fillTemplate(override, vars);
      return { cmd, args, label: 'custom override' };
    }
    if (cfg.launcherMode === 'custom' && cfg.customLaunchCommand) {
      const [cmd, ...args] = fillTemplate(cfg.customLaunchCommand, vars);
      return { cmd, args, label: 'custom command' };
    }

    const isStandaloneExplicit = explicitCore.endsWith('_standalone') || explicitCore === 'duckstation' && (slug === 'psx' || slug === 'ps1' || slug === 'playstation');

    // 1. Standalone emulator check if explicitly requested or auto-launcher mode without retroarch-only forced
    if (isStandaloneExplicit || (cfg.launcherMode !== 'retroarch' && !explicitCore)) {
      const sa = STANDALONE[slug];
      if (sa) {
        const flatpaks = await installedFlatpaks();
        if (flatpaks.has(sa.flatpak)) {
          return { cmd: 'flatpak', args: ['run', sa.flatpak, ...sa.args(romPath)], label: sa.flatpak, flatpakId: sa.flatpak };
        }
        if (sa.fallbackFlatpak && flatpaks.has(sa.fallbackFlatpak)) {
          return { cmd: 'flatpak', args: ['run', sa.fallbackFlatpak, ...sa.args(romPath)], label: sa.fallbackFlatpak, flatpakId: sa.fallbackFlatpak };
        }
      }
    }

    // 2. RetroArch check with selected core or smart fallback search
    const ra = await findRetroArch();
    if (ra) {
      const targetCore = core.replace('_standalone', '');
      let corePath = findCore(ra.coreDirs, targetCore);
      let activeCoreName = targetCore;

      // If requested core is not found on disk, look through fallback cores
      if (!corePath) {
        const fallbacks = CORE_FALLBACKS[slug] || [];
        for (const fb of fallbacks) {
          const fbPath = findCore(ra.coreDirs, fb);
          if (fbPath) {
            corePath = fbPath;
            activeCoreName = fb;
            this.log(`[launch] Core ${targetCore || '(none)'} not found; falling back to ${fb}`);
            break;
          }
        }
      }

      if (corePath) {
        const args = [...ra.pre, '-L', corePath];
        if (cfg.retroarchFullscreen !== false) args.push('-f');
        args.push(romPath);
        return { cmd: ra.cmd, args, label: `RetroArch (${activeCoreName})`, flatpakId: ra.flatpakId };
      }
      this.log(`[launch] RetroArch found but no compatible core found for ${slug}`);
    }

    // 3. Fall back to standalone emulator if RetroArch had no matching core
    const sa = STANDALONE[slug];
    if (sa) {
      const flatpaks = await installedFlatpaks();
      if (flatpaks.has(sa.flatpak)) {
        return { cmd: 'flatpak', args: ['run', sa.flatpak, ...sa.args(romPath)], label: sa.flatpak, flatpakId: sa.flatpak };
      }
      if (sa.fallbackFlatpak && flatpaks.has(sa.fallbackFlatpak)) {
        return { cmd: 'flatpak', args: ['run', sa.fallbackFlatpak, ...sa.args(romPath)], label: sa.fallbackFlatpak, flatpakId: sa.fallbackFlatpak };
      }
    }

    // Last resort: desktop association (works in Desktop Mode, often not in Game Mode)
    if (which('xdg-open')) return { cmd: 'xdg-open', args: [romPath], label: 'xdg-open (desktop association)' };
    return null;
  }

  async launch(req) {
    if (this.current) return { ok: false, message: `${this.current.title} is already running` };
    if (!req.romPath || !exists(req.romPath)) return { ok: false, message: 'ROM file not found on disk. Download it first.' };

    const resolved = await this.resolveCommand(req);
    if (!resolved) {
      return {
        ok: false,
        message: 'No emulator found. Install RetroArch (flatpak org.libretro.RetroArch) or EmuDeck, or set a custom launch command in Settings.',
      };
    }

    fs.mkdirSync(this.logDir, { recursive: true });
    const logFile = path.join(this.logDir, 'emulator.log');
    const out = fs.openSync(logFile, 'a');
    fs.writeSync(out, `\n=== ${new Date().toISOString()} ${resolved.cmd} ${resolved.args.join(' ')}\n`);

    let child;
    try {
      child = spawn(resolved.cmd, resolved.args, {
        cwd: path.dirname(req.romPath),
        env: childEnv(),
        detached: true, // new process group -> kill(-pid) terminates the whole tree
        stdio: ['ignore', out, out],
      });
    } catch (e) {
      fs.closeSync(out);
      return { ok: false, message: `Failed to start emulator: ${e.message}` };
    }

    const startedAt = Date.now();
    this.current = {
      child,
      pgid: child.pid,
      romId: req.romId,
      title: req.title || path.basename(req.romPath),
      platformSlug: req.platformSlug || '',
      startedAt,
      command: resolved.label,
      flatpakId: resolved.flatpakId,
      monitorInterval: null,
    };

    const finish = (code, signal, error) => {
      if (!this.current || this.current.child !== child) return;
      if (this.current.monitorInterval) {
        clearInterval(this.current.monitorInterval);
        this.current.monitorInterval = null;
      }
      try {
        fs.closeSync(out);
      } catch {
        /* ignore */
      }
      const info = {
        running: false,
        romId: req.romId,
        title: this.current.title,
        platformSlug: this.current.platformSlug,
        flatpakId: this.current.flatpakId,
        startedAt,
        code,
        signal,
        error: error ? error.message : null,
        playedMs: Date.now() - startedAt,
      };
      this.current = null;
      this.log(`[launch] emulator exited code=${code} signal=${signal}`);
      this.emit('emulator:state', info);
      this.onGameEnd(info);
    };

    const handleExit = async (code, signal) => {
      if (!this.current || this.current.child !== child) return;
      const elapsed = Date.now() - startedAt;
      const flatpakId = resolved.flatpakId;

      // If flatpak run exited cleanly in < 3500ms (e.g. flatpak daemon or sub-process handoff),
      // verify if the flatpak application is actually still active in the background before
      // prematurely popping DeckRomM back to the foreground.
      if (code === 0 && elapsed < 3500 && flatpakId) {
        const stillRunning = await isFlatpakRunning(flatpakId);
        if (stillRunning) {
          this.log(`[launch] initial runner exited in ${elapsed}ms, but flatpak ${flatpakId} is running. Monitoring background instance...`);
          const interval = setInterval(async () => {
            if (!this.current || this.current.child !== child) {
              clearInterval(interval);
              return;
            }
            const active = await isFlatpakRunning(flatpakId);
            if (!active) {
              clearInterval(interval);
              this.log(`[launch] background flatpak ${flatpakId} finished.`);
              finish(code, signal, null);
            }
          }, 1000);
          if (this.current) this.current.monitorInterval = interval;
          return;
        }
      }

      finish(code, signal, null);
    };

    child.once('exit', (code, signal) => handleExit(code, signal));
    child.once('error', (err) => finish(null, null, err));

    // xdg-open returns immediately; do not hide the UI for it.
    const tracksGame = resolved.cmd !== 'xdg-open';
    this.emit('emulator:state', { running: tracksGame, romId: req.romId, title: this.current.title, command: resolved.label });
    if (tracksGame) {
      this.onGameStart(this.current);
      activateEmulatorWindow(resolved.flatpakId, resolved.label);
    }
    return { ok: true, command: resolved.label, pid: child.pid };
  }

  /**
   * Launch a standalone emulator directly (no game ROM) so users can update
   * controller button bindings, audio, graphics, BIOS, or general settings.
   */
  async launchStandalone({ flatpakId, name }) {
    if (this.current) return { ok: false, message: `${this.current.title} is already running` };
    if (!flatpakId) return { ok: false, message: 'No emulator specified' };

    let cmd = 'flatpak';
    let args = ['run', flatpakId];
    let label = name || flatpakId;

    if (flatpakId === 'org.libretro.RetroArch') {
      const ra = await findRetroArch();
      if (ra) {
        cmd = ra.cmd;
        args = [...ra.pre];
        label = 'RetroArch';
      }
    } else {
      const flatpaks = await installedFlatpaks();
      if (!flatpaks.has(flatpakId)) {
        const binaryName = flatpakId.split('.').pop()?.toLowerCase();
        const sysBin = binaryName ? which(binaryName) : null;
        if (sysBin) {
          cmd = sysBin;
          args = [];
        } else {
          return { ok: false, message: `${label} (${flatpakId}) is not installed on this Steam Deck. Install it first from Settings.` };
        }
      }
    }

    fs.mkdirSync(this.logDir, { recursive: true });
    const logFile = path.join(this.logDir, 'emulator.log');
    const out = fs.openSync(logFile, 'a');
    fs.writeSync(out, `\n=== ${new Date().toISOString()} Standalone GUI: ${cmd} ${args.join(' ')}\n`);

    let child;
    try {
      child = spawn(cmd, args, {
        cwd: HOME,
        env: childEnv(),
        detached: true,
        stdio: ['ignore', out, out],
      });
    } catch (e) {
      fs.closeSync(out);
      return { ok: false, message: `Failed to start ${label}: ${e.message}` };
    }

    const startedAt = Date.now();
    this.current = {
      child,
      pgid: child.pid,
      romId: null,
      title: `${label} (Settings)`,
      startedAt,
      command: label,
      flatpakId,
      monitorInterval: null,
    };

    const finish = (code, signal, error) => {
      if (!this.current || this.current.child !== child) return;
      if (this.current.monitorInterval) {
        clearInterval(this.current.monitorInterval);
        this.current.monitorInterval = null;
      }
      try {
        fs.closeSync(out);
      } catch {}
      const info = { running: false, romId: null, code, signal, error: error ? error.message : null, playedMs: Date.now() - startedAt };
      this.current = null;
      this.log(`[launch] standalone emulator GUI exited code=${code} signal=${signal}`);
      this.emit('emulator:state', info);
      this.onGameEnd(info);
    };

    const handleExit = async (code, signal) => {
      if (!this.current || this.current.child !== child) return;
      const elapsed = Date.now() - startedAt;

      if (code === 0 && elapsed < 3500 && flatpakId) {
        const stillRunning = await isFlatpakRunning(flatpakId);
        if (stillRunning) {
          this.log(`[launch] standalone initial runner exited in ${elapsed}ms, but flatpak ${flatpakId} is running. Monitoring background instance...`);
          const interval = setInterval(async () => {
            if (!this.current || this.current.child !== child) {
              clearInterval(interval);
              return;
            }
            const active = await isFlatpakRunning(flatpakId);
            if (!active) {
              clearInterval(interval);
              this.log(`[launch] standalone flatpak ${flatpakId} finished.`);
              finish(code, signal, null);
            }
          }, 1000);
          if (this.current) this.current.monitorInterval = interval;
          return;
        }
      }

      finish(code, signal, null);
    };

    child.once('exit', (code, signal) => handleExit(code, signal));
    child.once('error', (err) => finish(null, null, err));

    this.emit('emulator:state', { running: true, romId: null, title: this.current.title, command: label });
    this.onGameStart(this.current);
    activateEmulatorWindow(flatpakId, label);
    return { ok: true, command: label, pid: child.pid };
  }

  /** SIGTERM the process group, escalate to SIGKILL after `graceMs`. */
  async kill(graceMs = 3000) {
    const cur = this.current;
    if (!cur) return { ok: true };
    const { pgid, child, flatpakId } = cur;
    if (cur.monitorInterval) {
      clearInterval(cur.monitorInterval);
      cur.monitorInterval = null;
    }
    const signalGroup = (sig) => {
      try {
        process.kill(-pgid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* ignore */
        }
      }
    };
    signalGroup('SIGTERM');
    const exited = await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
      const t = setTimeout(() => resolve(false), graceMs);
      child.once('exit', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
    if (!exited) signalGroup('SIGKILL');
    if (flatpakId && which('flatpak')) {
      // bwrap children can outlive the group - ask flatpak to kill the instance.
      await execFileP('flatpak', ['kill', flatpakId], 3000);
    }
    return { ok: true, forced: !exited };
  }
}

module.exports = {
  PLATFORM_FOLDERS,
  LIBRETRO_CORES,
  detectEmulationRoot,
  romTargetPath,
  storageStats,
  DownloadManager,
  EmulatorManager,
  expandHome,
  clearFlatpakCache,
  getFlatpakStatus,
  installFlatpak,
};
