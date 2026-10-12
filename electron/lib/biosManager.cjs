'use strict';
/**
 * BIOS and firmware management for DeckRomM.
 *
 * Integrates with RomM's /api/firmware endpoints:
 *   - Lists firmware files on RomM and verifies them
 *   - Downloads BIOS files to ~/Emulation/bios (or configured root)
 *   - Automatically copies/links required BIOS files to standalone emulator
 *     directories (PCSX2 Flatpak, DuckStation Flatpak, RetroArch system, Flycast)
 *     so emulators boot games without manual file copying.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');

const HOME = process.env.HOME || '/home/deck';

// Specific paths where standalone emulators look for BIOS files
function getEmulatorBiosDirs() {
  return {
    pcsx2: [
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/data/PCSX2/bios'),
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/bios'),
      path.join(HOME, '.config/PCSX2/bios'),
    ],
    duckstation: [
      path.join(HOME, '.var/app/org.duckstation.DuckStation/data/duckstation/bios'),
      path.join(HOME, '.config/duckstation/bios'),
    ],
    retroarch: [
      path.join(HOME, '.var/app/org.libretro.RetroArch/config/retroarch/system'),
      path.join(HOME, '.config/retroarch/system'),
    ],
    flycast: [
      path.join(HOME, '.var/app/org.flycast.Flycast/data/flycast'),
      path.join(HOME, '.config/flycast'),
    ],
    ppsspp: [
      path.join(HOME, '.var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SYSTEM'),
    ],
  };
}

class BiosManager {
  /**
   * @param {{ romm: import('./rommClient.cjs').RommClient, getRoot: () => string, emit: (ch: string, payload: any) => void, log: Function }} deps
   */
  constructor({ romm, getRoot, emit, log }) {
    this.romm = romm;
    this.getRoot = getRoot;
    this.emit = emit;
    this.log = log || console.log;
    this.activeDownloads = new Map();
  }

  getBiosDir() {
    const root = this.getRoot();
    return path.join(root, 'bios');
  }

  async ensureDir(dir) {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  /**
   * List all local BIOS files in the emulation root and emulator directories.
   */
  async listLocalBios() {
    const biosDir = this.getBiosDir();
    const files = new Map();

    const scanDir = async (dir, prefix = '') => {
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
          } else if (entry.isFile() && !entry.name.startsWith('.')) {
            const stat = await fsp.stat(fullPath);
            const lowerName = entry.name.toLowerCase();
            files.set(lowerName, {
              fileName: entry.name,
              relativePath: prefix ? `${prefix}/${entry.name}` : entry.name,
              fullPath,
              sizeBytes: stat.size,
              mtime: stat.mtimeMs,
            });
          }
        }
      } catch {
        /* ignore missing dirs */
      }
    };

    await scanDir(biosDir);

    // Also check PCSX2 flatpak directory directly
    for (const p of getEmulatorBiosDirs().pcsx2) {
      await scanDir(p, 'pcsx2');
    }

    return Array.from(files.values());
  }

  /**
   * Check status of a list of RomM firmware entries against local disk.
   */
  async checkStatus(firmwareList) {
    const local = await this.listLocalBios();
    const localMap = new Map();
    for (const f of local) {
      localMap.set(f.fileName.toLowerCase(), f);
    }

    const result = {};
    for (const item of firmwareList || []) {
      const id = String(item.id);
      const name = String(item.file_name || item.fileName || '').toLowerCase();
      const match = localMap.get(name);
      if (match) {
        result[id] = {
          exists: true,
          path: match.fullPath,
          size: match.sizeBytes,
        };
      } else {
        result[id] = {
          exists: false,
          path: '',
          size: 0,
        };
      }
    }
    return result;
  }

  /**
   * Download a firmware/BIOS file from RomM and deploy it to emulator directories.
   */
  async download(req) {
    const firmwareId = req.firmwareId || req.id;
    const fileName = path.basename(String(req.fileName || req.file_name || 'bios.bin')).replace(/[\0/]/g, '_');
    const platformSlug = String(req.platformSlug || req.platform || '').toLowerCase().trim();

    if (!firmwareId) {
      return { ok: false, message: 'Missing firmware ID' };
    }

    const biosDir = this.getBiosDir();
    await this.ensureDir(biosDir);

    // Platform subfolder, e.g. ~/Emulation/bios/ps2 or ~/Emulation/bios/dc
    const platformBiosDir = platformSlug ? path.join(biosDir, platformSlug) : null;
    if (platformBiosDir) {
      await this.ensureDir(platformBiosDir);
    }

    const targetPath = path.join(biosDir, fileName);
    const partPath = `${targetPath}.part-${Date.now()}`;

    const controller = new AbortController();
    this.activeDownloads.set(String(firmwareId), controller);

    try {
      this.emit('bios:progress', {
        firmwareId,
        fileName,
        loaded: 0,
        total: req.fileSizeBytes || 0,
        percent: 0,
        status: 'downloading',
      });

      const endpoint = `/api/firmware/${firmwareId}/content/${encodeURIComponent(fileName)}`;
      this.log(`[bios] Downloading firmware #${firmwareId} (${fileName}) from ${endpoint}`);

      const res = await this.romm.authedFetch(endpoint, {
        signal: controller.signal,
        timeoutMs: 60000,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`RomM server returned HTTP ${res.status}: ${text.slice(0, 100)}`);
      }

      const total = Number(res.headers.get('content-length')) || Number(req.fileSizeBytes) || 0;
      const fileStream = fs.createWriteStream(partPath);

      let loaded = 0;
      let lastEmit = Date.now();

      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileStream.write(Buffer.from(value));
          loaded += value.length;
          const now = Date.now();
          if (now - lastEmit > 200) {
            lastEmit = now;
            const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 50;
            this.emit('bios:progress', {
              firmwareId,
              fileName,
              loaded,
              total,
              percent,
              status: 'downloading',
            });
          }
        }
      }

      await new Promise((resolve, reject) => {
        fileStream.end((err) => (err ? reject(err) : resolve()));
      });

      // Atomic rename
      await fsp.rename(partPath, targetPath);

      // Deploy copies/symlinks to specific emulator target locations
      const copiedTo = [targetPath];

      // 1. Copy into platform subfolder if specified
      if (platformBiosDir) {
        const subPath = path.join(platformBiosDir, fileName);
        try {
          await fsp.copyFile(targetPath, subPath);
          copiedTo.push(subPath);
        } catch (e) {
          this.log(`[bios] notice: could not copy to platform dir: ${e.message}`);
        }
      }

      // 2. Platform-specific standalone emulator synchronization
      const emulatorDirs = getEmulatorBiosDirs();

      // PS2 -> PCSX2
      if (['ps2', 'playstation-2', 'playstation2'].includes(platformSlug) || /scph|ps2/i.test(fileName)) {
        for (const dir of emulatorDirs.pcsx2) {
          try {
            await this.ensureDir(dir);
            const emuPath = path.join(dir, fileName);
            await fsp.copyFile(targetPath, emuPath);
            copiedTo.push(emuPath);
            this.log(`[bios] Installed PS2 BIOS to PCSX2: ${emuPath}`);
          } catch (e) {
            this.log(`[bios] notice: PCSX2 dir ${dir}: ${e.message}`);
          }
        }
      }

      // PS1 -> DuckStation & RetroArch
      if (['psx', 'ps1', 'playstation'].includes(platformSlug) || /scph[1-9]00/i.test(fileName)) {
        for (const dir of emulatorDirs.duckstation) {
          try {
            await this.ensureDir(dir);
            const emuPath = path.join(dir, fileName);
            await fsp.copyFile(targetPath, emuPath);
            copiedTo.push(emuPath);
          } catch {
            /* ignore */
          }
        }
      }

      // Dreamcast -> Flycast & RetroArch
      if (['dc', 'dreamcast'].includes(platformSlug) || /dc_|boot\.bin/i.test(fileName)) {
        for (const dir of emulatorDirs.flycast) {
          try {
            await this.ensureDir(dir);
            const emuPath = path.join(dir, fileName);
            await fsp.copyFile(targetPath, emuPath);
            copiedTo.push(emuPath);
          } catch {
            /* ignore */
          }
        }
      }

      // Also copy to RetroArch system directory for general libretro cores
      for (const dir of emulatorDirs.retroarch) {
        try {
          await this.ensureDir(dir);
          const raPath = path.join(dir, fileName);
          await fsp.copyFile(targetPath, raPath);
          copiedTo.push(raPath);
        } catch {
          /* ignore */
        }
      }

      this.emit('bios:progress', {
        firmwareId,
        fileName,
        loaded,
        total: loaded,
        percent: 100,
        status: 'completed',
        path: targetPath,
        copiedTo,
      });

      return {
        ok: true,
        path: targetPath,
        size: loaded,
        copiedTo,
        message: `Successfully installed ${fileName} (${copiedTo.length} locations updated)`,
      };
    } catch (e) {
      try {
        await fsp.unlink(partPath).catch(() => {});
      } catch {
        /* ignore */
      }
      this.emit('bios:progress', {
        firmwareId,
        fileName,
        loaded: 0,
        total: 0,
        percent: 0,
        status: 'error',
        error: e.message,
      });
      return { ok: false, message: e.message || String(e) };
    } finally {
      this.activeDownloads.delete(String(firmwareId));
    }
  }

  cancel(firmwareId) {
    const ctl = this.activeDownloads.get(String(firmwareId));
    if (ctl) {
      ctl.abort();
      this.activeDownloads.delete(String(firmwareId));
      return { ok: true };
    }
    return { ok: false };
  }

  /**
   * Open the local BIOS folder in desktop file manager.
   */
  async openFolder() {
    const biosDir = this.getBiosDir();
    await this.ensureDir(biosDir);
    return new Promise((resolve) => {
      execFile('xdg-open', [biosDir], (err) => {
        resolve({ ok: !err, path: biosDir });
      });
    });
  }
}

module.exports = { BiosManager };
