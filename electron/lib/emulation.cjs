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
  psp: { flatpak: 'org.ppsspp.PPSSPP', args: (rom) => [rom] },
  ps3: { flatpak: 'net.rpcs3.RPCS3', args: (rom) => ['--no-gui', rom] },
  '3ds': { flatpak: 'io.github.lime3ds.Lime3DS', args: (rom) => [rom] },
  n3ds: { flatpak: 'io.github.lime3ds.Lime3DS', args: (rom) => [rom] },
  wiiu: { flatpak: 'info.cemu.Cemu', args: (rom) => ['-f', '-g', rom] },
  switch: { flatpak: 'org.ryujinx.Ryujinx', args: (rom) => ['--fullscreen', rom] },
  dc: { flatpak: 'org.flycast.Flycast', args: (rom) => [rom] },
  dreamcast: { flatpak: 'org.flycast.Flycast', args: (rom) => [rom] },
};

/** Fallback core search order when a specific core is not specified or not installed */
const CORE_FALLBACKS = {
  dc: ['flycast', 'redream'],
  dreamcast: ['flycast', 'redream'],
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
  nes: ['mesen', 'fceumm', 'nestopia'],
  arcade: ['fbneo', 'mame', 'mame2003_plus'],
  gb: ['gambatte', 'sameboy', 'mgba'],
  gbc: ['gambatte', 'sameboy', 'mgba'],
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
   * @param {{ romm: import('./rommClient.cjs').RommClient, getRoot: () => string, emit: (ch: string, payload: any) => void, log: Function }} deps
   */
  constructor({ romm, getRoot, emit, log }) {
    this.romm = romm;
    this.getRoot = getRoot;
    this.emit = emit;
    this.log = log;
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
   * Stream `/api/roms/{id}/content/{fileName}` to disk with progress events.
   * Writes to `<file>.part` and renames on success, so a half-finished download
   * is never mistaken for a complete ROM.
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
    return { ok: true };
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
    this.current = { child, pgid: child.pid, romId: req.romId, title: req.title || path.basename(req.romPath), startedAt, command: resolved.label, flatpakId: resolved.flatpakId };

    const finish = (code, signal, error) => {
      if (!this.current || this.current.child !== child) return;
      try {
        fs.closeSync(out);
      } catch {
        /* ignore */
      }
      const info = { running: false, romId: req.romId, code, signal, error: error ? error.message : null, playedMs: Date.now() - startedAt };
      this.current = null;
      this.log(`[launch] emulator exited code=${code} signal=${signal}`);
      this.emit('emulator:state', info);
      this.onGameEnd(info);
    };
    child.once('exit', (code, signal) => finish(code, signal, null));
    child.once('error', (err) => finish(null, null, err));

    // xdg-open returns immediately; do not hide the UI for it.
    const tracksGame = resolved.cmd !== 'xdg-open';
    this.emit('emulator:state', { running: tracksGame, romId: req.romId, title: this.current.title, command: resolved.label });
    if (tracksGame) this.onGameStart(this.current);
    return { ok: true, command: resolved.label, pid: child.pid };
  }

  /** SIGTERM the process group, escalate to SIGKILL after `graceMs`. */
  async kill(graceMs = 3000) {
    const cur = this.current;
    if (!cur) return { ok: true };
    const { pgid, child, flatpakId } = cur;
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
