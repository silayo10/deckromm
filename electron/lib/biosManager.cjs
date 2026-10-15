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
      path.join(root, 'bios', 'xbox'),
      path.join(root, 'bios', 'xemu'),
      path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu'),
      path.join(HOME, '.var/app/app.xemu.xemu/config/xemu'),
      path.join(HOME, '.local/share/xemu/xemu'),
      path.join(HOME, '.config/xemu'),
    ],
  };
}

/**
 * Generate a valid, sparse QCOW2 v3 image buffer for an 8GB Xbox virtual disk.
 * Complies with the official QEMU QCOW2 v3 format specification.
 */
function generateEmptyQcow2Buffer(sizeBytes = 8589934592) {
  const CLUSTER_SIZE = 65536;
  const totalSize = CLUSTER_SIZE * 4; // 256 KB sparse container
  const buf = Buffer.alloc(totalSize, 0);

  // QCOW2 v3 Header (104 bytes)
  buf.writeUInt32BE(0x514649fb, 0); // Magic: 'QFI\xfb'
  buf.writeUInt32BE(3, 4);          // Version 3
  buf.writeBigUInt64BE(0n, 8);      // Backing file offset: 0
  buf.writeUInt32BE(0, 16);         // Backing file size: 0
  buf.writeUInt32BE(16, 20);        // Cluster bits: 16 (64 KB)
  buf.writeBigUInt64BE(BigInt(sizeBytes), 24); // Size in bytes (8 GiB)
  buf.writeUInt32BE(0, 32);         // Crypt method: 0
  buf.writeUInt32BE(16, 36);        // L1 size: 16 entries
  buf.writeBigUInt64BE(BigInt(CLUSTER_SIZE), 40);     // L1 table offset: cluster 1
  buf.writeBigUInt64BE(BigInt(CLUSTER_SIZE * 2), 48); // Refcount table offset: cluster 2
  buf.writeUInt32BE(1, 56);         // Refcount table clusters: 1
  buf.writeUInt32BE(0, 60);         // Snapshots: 0
  buf.writeBigUInt64BE(0n, 64);     // Snapshots offset: 0
  buf.writeBigUInt64BE(0n, 72);     // Incompatible features: 0
  buf.writeBigUInt64BE(0n, 80);     // Compatible features: 0
  buf.writeBigUInt64BE(0n, 88);     // Autoclear features: 0
  buf.writeUInt32BE(4, 96);         // Refcount order: 4 (16 bits)
  buf.writeUInt32BE(104, 100);      // Header length: 104

  // Cluster 2: Refcount Table
  // Entry 0 points to Refcount Block at cluster 3
  buf.writeBigUInt64BE(BigInt(CLUSTER_SIZE * 3), CLUSTER_SIZE * 2);

  // Cluster 3: Refcount Block
  // Mark clusters 0, 1, 2, 3 as allocated (refcount = 1)
  const refcountBlockOffset = CLUSTER_SIZE * 3;
  buf.writeUInt16BE(1, refcountBlockOffset + 0); // Cluster 0
  buf.writeUInt16BE(1, refcountBlockOffset + 2); // Cluster 1
  buf.writeUInt16BE(1, refcountBlockOffset + 4); // Cluster 2
  buf.writeUInt16BE(1, refcountBlockOffset + 6); // Cluster 3

  return buf;
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
   * Comprehensive Xbox & xemu diagnostic. Checks Boot ROM, Flash ROM, HDD, EEPROM, and xemu.toml config.
   */
  async getXboxStatus() {
    const biosDir = this.getBiosDir();
    const searchDirs = [
      biosDir,
      path.join(biosDir, 'xbox'),
      path.join(biosDir, 'xemu'),
      path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu'),
      path.join(HOME, '.local/share/xemu/xemu'),
    ];

    const findFile = async (matchRegex) => {
      for (const d of searchDirs) {
        try {
          const entries = await fsp.readdir(d);
          for (const entry of entries) {
            if (matchRegex.test(entry)) {
              const full = path.join(d, entry);
              const st = await fsp.stat(full).catch(() => null);
              if (st && st.size > 0) {
                return { path: full, fileName: entry, sizeBytes: st.size };
              }
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
      return null;
    };

    const mcpx = await findFile(/^(mcpx(_1\.0)?|mcpx_1\.1)\.bin$/i);
    const flashrom = await findFile(/^(complex_4627|complex 4627|4627|cerbios|xbox.*bios|bios)\.bin$/i);
    const hdd = await findFile(/^xbox_hdd\.(qcow2|img)$/i);
    const eeprom = await findFile(/^eeprom\.bin$/i);

    // Check xemu.toml configuration
    const configCandidates = [
      path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu/xemu.toml'),
      path.join(HOME, '.var/app/app.xemu.xemu/config/xemu/xemu.toml'),
      path.join(biosDir, 'xemu', 'xemu.toml'),
    ];

    let foundConfig = null;
    let isConfigured = false;
    for (const cp of configCandidates) {
      try {
        const text = await fsp.readFile(cp, 'utf8');
        foundConfig = cp;
        if (text.includes('bootrom_path') && text.includes('hdd_path')) {
          isConfigured = true;
          break;
        }
      } catch {
        // ignore
      }
    }

    // Check if xemu is installed
    let xemuInstalled = false;
    try {
      const flatpakCheck = await new Promise((res) => {
        execFile('flatpak', ['info', 'app.xemu.xemu'], { timeout: 3000 }, (err) => res(!err));
      });
      xemuInstalled = flatpakCheck;
    } catch {
      // ignore
    }

    const missingItems = [];
    if (!mcpx) missingItems.push('Boot ROM (mcpx_1.0.bin)');
    if (!flashrom) missingItems.push('BIOS (Complex_4627.bin)');
    if (!hdd) missingItems.push('Virtual Hard Disk (xbox_hdd.qcow2)');
    if (!isConfigured) missingItems.push('xemu.toml configuration');

    return {
      ready: Boolean(mcpx && flashrom && hdd),
      xemuInstalled,
      bootrom: {
        found: Boolean(mcpx),
        path: mcpx ? mcpx.path : null,
        fileName: mcpx ? mcpx.fileName : 'mcpx_1.0.bin',
        sizeBytes: mcpx ? mcpx.sizeBytes : 0,
      },
      flashrom: {
        found: Boolean(flashrom),
        path: flashrom ? flashrom.path : null,
        fileName: flashrom ? flashrom.fileName : 'Complex_4627.bin',
        sizeBytes: flashrom ? flashrom.sizeBytes : 0,
      },
      hdd: {
        found: Boolean(hdd),
        path: hdd ? hdd.path : null,
        fileName: hdd ? hdd.fileName : 'xbox_hdd.qcow2',
        sizeBytes: hdd ? hdd.sizeBytes : 0,
      },
      eeprom: {
        found: Boolean(eeprom),
        path: eeprom ? eeprom.path : null,
        fileName: eeprom ? eeprom.fileName : 'eeprom.bin',
      },
      config: {
        configured: isConfigured,
        path: foundConfig,
      },
      missingItems,
    };
  }

  /**
   * Create or provision the 8GB virtual Xbox hard disk image (xbox_hdd.qcow2).
   */
  async createXboxHdd(customPath) {
    const biosDir = this.getBiosDir();
    const targetPath = customPath || path.join(biosDir, 'xbox_hdd.qcow2');
    await this.ensureDir(path.dirname(targetPath));

    let created = false;
    let method = 'unknown';

    // 1. Try flatpak app.xemu.xemu qemu-img
    try {
      const ok = await new Promise((res) => {
        execFile('flatpak', ['run', '--command=qemu-img', 'app.xemu.xemu', 'create', '-f', 'qcow2', targetPath, '8G'], { timeout: 8000 }, (err) => res(!err));
      });
      if (ok) {
        created = true;
        method = 'flatpak qemu-img';
      }
    } catch {
      // ignore
    }

    // 2. Try host qemu-img
    if (!created) {
      try {
        const ok = await new Promise((res) => {
          execFile('qemu-img', ['create', '-f', 'qcow2', targetPath, '8G'], { timeout: 5000 }, (err) => res(!err));
        });
        if (ok) {
          created = true;
          method = 'host qemu-img';
        }
      } catch {
        // ignore
      }
    }

    // 3. Pure Node.js valid 8GB QCOW2 v3 image generator fallback
    if (!created) {
      try {
        const buf = generateEmptyQcow2Buffer(8589934592);
        await fsp.writeFile(targetPath, buf);
        created = true;
        method = 'native sparse QCOW2 generator';
      } catch (e) {
        return { ok: false, message: `Could not create HDD image: ${e.message}` };
      }
    }

    // Copy or symlink to standard xemu and xbox paths
    const otherPaths = [
      path.join(biosDir, 'xbox', 'xbox_hdd.qcow2'),
      path.join(biosDir, 'xemu', 'xbox_hdd.qcow2'),
      path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu', 'xbox_hdd.qcow2'),
    ];

    for (const op of otherPaths) {
      try {
        await this.ensureDir(path.dirname(op));
        await fsp.copyFile(targetPath, op);
      } catch {
        // ignore
      }
    }

    // Update xemu.toml configuration
    await this.configureXemu().catch(() => {});

    return {
      ok: true,
      path: targetPath,
      method,
      message: `Created 8GB Xbox virtual hard disk (${targetPath}) via ${method}`,
    };
  }

  /**
   * Automatically generate and sync xemu.toml config with detected file paths.
   */
  async configureXemu() {
    const status = await this.getXboxStatus();
    const biosDir = this.getBiosDir();

    // Default paths if not already found on disk
    const bootrom = status.bootrom.path || path.join(biosDir, 'mcpx_1.0.bin');
    const flashrom = status.flashrom.path || path.join(biosDir, 'Complex_4627.bin');
    const hdd = status.hdd.path || path.join(biosDir, 'xbox_hdd.qcow2');
    const eeprom = status.eeprom.path || path.join(biosDir, 'eeprom.bin');

    const tomlContent = [
      '# Generated by DeckRomM for Steam Deck Game Mode',
      '[general]',
      'show_welcome = false',
      '',
      '[sys]',
      'mem_limit = "64"',
      '',
      '[sys.files]',
      `bootrom_path = "${bootrom}"`,
      `flashrom_path = "${flashrom}"`,
      `hdd_path = "${hdd}"`,
      `eeprom_path = "${eeprom}"`,
      '',
      '[display]',
      'scale = "scale_integer"',
      'ui = "hidden"',
      '',
    ].join('\n');

    const configTargets = [
      path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu/xemu.toml'),
      path.join(HOME, '.var/app/app.xemu.xemu/config/xemu/xemu.toml'),
      path.join(biosDir, 'xemu', 'xemu.toml'),
    ];

    let writtenAny = false;
    for (const target of configTargets) {
      try {
        await this.ensureDir(path.dirname(target));
        await fsp.writeFile(target, tomlContent, 'utf8');
        writtenAny = true;
      } catch (e) {
        this.log(`[xemu] could not write ${target}: ${e.message}`);
      }
    }

    // Copy/link discovered files into Flatpak data directory so sandbox access always works
    const flatpakDataDir = path.join(HOME, '.var/app/app.xemu.xemu/data/xemu/xemu');
    try {
      await this.ensureDir(flatpakDataDir);
      if (status.bootrom.path) {
        await fsp.copyFile(status.bootrom.path, path.join(flatpakDataDir, path.basename(status.bootrom.path))).catch(() => {});
      }
      if (status.flashrom.path) {
        await fsp.copyFile(status.flashrom.path, path.join(flatpakDataDir, path.basename(status.flashrom.path))).catch(() => {});
      }
      if (status.hdd.path) {
        await fsp.copyFile(status.hdd.path, path.join(flatpakDataDir, path.basename(status.hdd.path))).catch(() => {});
      }
    } catch {
      // ignore
    }

    return {
      ok: writtenAny,
      message: 'xemu.toml configured with detected BIOS and HDD paths',
      paths: { bootrom, flashrom, hdd, eeprom },
    };
  }

  /**
   * One-click automated setup for Xbox:
   * 1. Check & sync missing firmware from RomM server
   * 2. Auto-create 8GB HDD image if missing
   * 3. Write and link xemu.toml
   */
  async autoSetupXbox() {
    this.log('[xemu] Running autoSetupXbox...');

    // 1. Attempt to sync Xbox firmware from RomM server
    let synced = 0;
    try {
      const serverItems = await this.fetchServerFirmware();
      const xboxItems = serverItems.filter((i) => {
        const slug = String(i.platform_slug || i.platformSlug || '').toLowerCase();
        const name = String(i.file_name || i.fileName || '').toLowerCase();
        return slug === 'xbox' || /mcpx|complex|xbox.*bios|xbox.*hdd/i.test(name);
      });

      for (const item of xboxItems) {
        const res = await this.download({
          id: item.id,
          firmwareId: item.id,
          fileName: item.file_name || item.fileName,
          platformSlug: 'xbox',
          fileSizeBytes: item.file_size_bytes || item.fileSizeBytes || 0,
        });
        if (res.ok) synced++;
      }
    } catch (e) {
      this.log(`[xemu] server sync note: ${e.message}`);
    }

    // 2. Check if HDD image exists; create it if missing
    let status = await this.getXboxStatus();
    if (!status.hdd.found) {
      await this.createXboxHdd();
      status = await this.getXboxStatus();
    }

    // 3. Write xemu.toml
    await this.configureXemu();
    status = await this.getXboxStatus();

    return {
      ok: true,
      synced,
      status,
      message: status.ready
        ? 'Xbox (xemu) environment is fully configured and ready to play!'
        : `Xbox configured (HDD created). Missing: ${status.missingItems.join(', ')}`,
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
