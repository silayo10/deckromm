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
function getEmulatorBiosDirs(emulationRoot) {
  const root = emulationRoot || path.join(HOME, 'Emulation');
  return {
    pcsx2: [
      path.join(root, 'bios'),
      path.join(root, 'bios', 'ps2'),
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/data/PCSX2/bios'),
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/bios'),
      path.join(HOME, '.config/PCSX2/bios'),
    ],
    duckstation: [
      path.join(root, 'bios'),
      path.join(HOME, '.var/app/org.duckstation.DuckStation/data/duckstation/bios'),
      path.join(HOME, '.config/duckstation/bios'),
    ],
    retroarch: [
      path.join(root, 'bios'),
      path.join(HOME, '.var/app/org.libretro.RetroArch/config/retroarch/system'),
      path.join(HOME, '.config/retroarch/system'),
    ],
    flycast: [
      path.join(root, 'bios'),
      path.join(root, 'bios', 'dc'),
      path.join(HOME, '.var/app/org.flycast.Flycast/data/flycast'),
      path.join(HOME, '.config/flycast'),
    ],
    ppsspp: [
      path.join(root, 'bios'),
      path.join(HOME, '.var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SYSTEM'),
    ],
    xemu: [
      path.join(root, 'bios'),
      path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu'),
      path.join(HOME, '.local/share/xemu/xemu'),
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

    // Also check PCSX2 directories directly
    for (const p of getEmulatorBiosDirs(this.getRoot()).pcsx2) {
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
      const emulatorDirs = getEmulatorBiosDirs(this.getRoot());

      // PS2 -> PCSX2
      if (
        ['ps2', 'playstation-2', 'playstation2', 'sony-playstation-2'].includes(platformSlug) ||
        /scph|ps2|erom|rom1|rom2/i.test(fileName)
      ) {
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

      // Xbox -> Xemu
      if (['xbox', 'og-xbox', 'original-xbox'].includes(platformSlug) || /mcpx|complex|xbox.*bios/i.test(fileName)) {
        for (const dir of emulatorDirs.xemu) {
          try {
            await this.ensureDir(dir);
            const emuPath = path.join(dir, fileName);
            await fsp.copyFile(targetPath, emuPath);
            copiedTo.push(emuPath);
            this.log(`[bios] Installed Xbox BIOS to Xemu: ${emuPath}`);
          } catch (e) {
            this.log(`[bios] notice: Xemu dir ${dir}: ${e.message}`);
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
   * Fetch firmware list from RomM API, normalizing array vs paginated format.
   */
  async fetchServerFirmware() {
    try {
      const res = await this.romm.authedFetch('/api/firmware');
      if (!res.ok) return [];
      const data = await res.json().catch(() => []);
      const items = Array.isArray(data) ? data : data?.items || data?.data || [];
      return items;
    } catch (e) {
      this.log(`[bios] failed to fetch firmware list: ${e.message}`);
      return [];
    }
  }

  /**
   * Automatically check and sync required BIOS files for a given platform.
   */
  async syncPlatformBios(platformSlug) {
    const slug = String(platformSlug || '').toLowerCase().trim();
    if (!slug) return { ok: true, synced: 0 };

    const isPs2 = ['ps2', 'playstation-2', 'playstation2', 'sony-playstation-2'].includes(slug);
    const isPs1 = ['psx', 'ps1', 'playstation'].includes(slug);
    const isDc = ['dc', 'dreamcast'].includes(slug);
    const isSaturn = ['saturn', 'sega-saturn'].includes(slug);
    const isSegaCd = ['segacd', 'sega-cd', 'mega-cd'].includes(slug);
    const isXbox = ['xbox', 'og-xbox', 'original-xbox'].includes(slug);

    if (!isPs2 && !isPs1 && !isDc && !isSaturn && !isSegaCd && !isXbox) {
      return { ok: true, synced: 0, message: 'Platform does not require external BIOS' };
    }

    const localFiles = await this.listLocalBios();
    const hasPs2 = localFiles.some((f) => /scph|ps2|erom|rom1/i.test(f.fileName) && f.sizeBytes > 100000);
    const hasPs1 = localFiles.some((f) => /scph[1-9]00|ps-?x/i.test(f.fileName));
    const hasDc = localFiles.some((f) => /dc_boot|boot\.bin/i.test(f.fileName));
    const hasSaturn = localFiles.some((f) => /saturn.*bin|sega_106/i.test(f.fileName));
    const hasXbox = localFiles.some((f) => /mcpx|complex|xbox.*bios/i.test(f.fileName));

    if (isPs2 && hasPs2) return { ok: true, synced: 0, message: 'PS2 BIOS already present locally' };
    if (isPs1 && hasPs1) return { ok: true, synced: 0, message: 'PS1 BIOS already present locally' };
    if (isDc && hasDc) return { ok: true, synced: 0, message: 'Dreamcast BIOS already present locally' };
    if (isSaturn && hasSaturn) return { ok: true, synced: 0, message: 'Saturn BIOS already present locally' };
    if (isXbox && hasXbox) return { ok: true, synced: 0, message: 'Xbox BIOS already present locally' };

    this.log(`[bios] Missing BIOS for ${slug}, checking RomM server...`);
    const serverItems = await this.fetchServerFirmware();
    if (!serverItems.length) {
      return { ok: false, synced: 0, message: 'No firmware found on RomM server' };
    }

    const matches = serverItems.filter((item) => {
      const itemSlug = String(item.platform_slug || item.platformSlug || '').toLowerCase();
      const name = String(item.file_name || item.fileName || '').toLowerCase();
      if (isPs2) {
        return (
          ['ps2', 'playstation-2', 'playstation2', 'sony-playstation-2'].includes(itemSlug) ||
          /scph|ps2|erom|rom1|rom2/i.test(name)
        );
      }
      if (isPs1) {
        return ['psx', 'ps1', 'playstation'].includes(itemSlug) || /scph[1-9]00/i.test(name);
      }
      if (isDc) {
        return ['dc', 'dreamcast'].includes(itemSlug) || /dc_|boot\.bin/i.test(name);
      }
      if (isSaturn) {
        return ['saturn', 'sega-saturn'].includes(itemSlug) || /saturn/i.test(name);
      }
      if (isXbox) {
        return ['xbox', 'og-xbox', 'original-xbox'].includes(itemSlug) || /mcpx|complex|xbox/i.test(name);
      }
      return false;
    });

    if (!matches.length) {
      this.log(`[bios] No matching BIOS files on RomM for platform ${slug}`);
      return { ok: false, synced: 0, message: `No matching BIOS found on server for ${slug}` };
    }

    let downloadedCount = 0;
    for (const item of matches) {
      const res = await this.download({
        id: item.id,
        firmwareId: item.id,
        fileName: item.file_name || item.fileName,
        platformSlug: slug,
        fileSizeBytes: item.file_size_bytes || item.fileSizeBytes || 0,
      });
      if (res.ok) downloadedCount++;
    }

    return {
      ok: downloadedCount > 0,
      synced: downloadedCount,
      message: `Downloaded ${downloadedCount} BIOS file(s) for ${slug}`,
    };
  }

  /**
   * Sync all missing BIOS files from RomM server to local directories.
   */
  async syncAllMissing() {
    const serverItems = await this.fetchServerFirmware();
    if (!serverItems.length) return { ok: false, synced: 0, message: 'No firmware found on server' };

    const local = await this.listLocalBios();
    const localSet = new Set(local.map((f) => f.fileName.toLowerCase()));

    const missing = serverItems.filter((item) => {
      const name = String(item.file_name || item.fileName || '').toLowerCase();
      return !localSet.has(name);
    });

    if (!missing.length) {
      return { ok: true, synced: 0, totalMissing: 0, message: 'All server firmware files are already installed locally' };
    }

    let downloadedCount = 0;
    for (const item of missing) {
      const res = await this.download({
        id: item.id,
        firmwareId: item.id,
        fileName: item.file_name || item.fileName,
        platformSlug: item.platform_slug || item.platformSlug || '',
        fileSizeBytes: item.file_size_bytes || item.fileSizeBytes || 0,
      });
      if (res.ok) downloadedCount++;
    }

    return {
      ok: downloadedCount > 0,
      synced: downloadedCount,
      totalMissing: missing.length,
      message: `Successfully synchronized ${downloadedCount} of ${missing.length} missing BIOS file(s)`,
    };
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
