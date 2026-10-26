'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const HOME = os.homedir();

function which(bin) {
  for (const dir of (process.env.PATH || '').split(':')) {
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function execFileP(cmd, args, timeout = 10000, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, ...opts }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/** Recursively scan folder to calculate total bytes, newest mtime, and sub-item count. */
async function inspectDirectory(dirPath) {
  let totalBytes = 0;
  let newestMtime = 0;
  let itemCount = 0;

  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    itemCount = entries.length;

    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      try {
        const st = await fsp.stat(full);
        if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs;
        if (ent.isFile()) {
          totalBytes += st.size;
        } else if (ent.isDirectory()) {
          const sub = await inspectDirectory(full);
          totalBytes += sub.totalBytes;
          if (sub.newestMtime > newestMtime) newestMtime = sub.newestMtime;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  return { totalBytes, newestMtime, itemCount };
}

class Pcsx2Manager {
  /**
   * @param {{ cloud: any, configStore: any, emit: Function, log: Function, getRoot?: Function }} deps
   */
  constructor({ cloud, configStore, emit, log, getRoot }) {
    this.cloud = cloud;
    this.configStore = configStore;
    this.emit = emit;
    this.log = log || console.log;
    this.getRoot = getRoot || (() => null);
  }

  /**
   * Discovers all possible PCSX2 memory card search paths, including custom paths
   * parsed from PCSX2.ini (both flatpak and standalone) and EmuDeck SD/internal locations.
   */
  getSearchDirs() {
    const dirs = [];
    const seen = new Set();

    const addDir = (d) => {
      if (!d) return;
      const normalized = path.normalize(d);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        dirs.push(normalized);
      }
    };

    // 1. Check PCSX2.ini for configured MemoryCards directory
    const iniLocations = [
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/inis/PCSX2.ini'),
      path.join(HOME, '.config/PCSX2/inis/PCSX2.ini'),
      path.join(HOME, 'Emulation/saves/pcsx2/inis/PCSX2.ini'),
    ];

    const emuRoot = this.getRoot ? this.getRoot() : null;
    if (emuRoot) {
      iniLocations.push(path.join(emuRoot, 'saves/pcsx2/inis/PCSX2.ini'));
      iniLocations.push(path.join(emuRoot, 'saves/pcsx2/PCSX2.ini'));
    }

    for (const iniPath of iniLocations) {
      try {
        if (fs.existsSync(iniPath)) {
          const content = fs.readFileSync(iniPath, 'utf8');
          // Parse MemoryCards = <path> under [Folders]
          const mFolder = content.match(/^\s*MemoryCards\s*=\s*(.+)$/m);
          if (mFolder && mFolder[1]) {
            let p = mFolder[1].trim().replace(/^["']|["']$/g, '');
            if (p.startsWith('~')) p = path.join(HOME, p.slice(1));
            else if (!path.isAbsolute(p)) p = path.resolve(path.dirname(iniPath), '..', p);
            addDir(p);
          }
          // Parse Folder = <path> or Memcards = <path>
          const mFolder2 = content.match(/^\s*(?:Memcards|Folder)\s*=\s*(.+)$/m);
          if (mFolder2 && mFolder2[1]) {
            let p = mFolder2[1].trim().replace(/^["']|["']$/g, '');
            if (p.startsWith('~')) p = path.join(HOME, p.slice(1));
            else if (!path.isAbsolute(p)) p = path.resolve(path.dirname(iniPath), '..', p);
            addDir(p);
          }
        }
      } catch {
        /* ignore ini read error */
      }
    }

    // 2. Configured or detected Emulation root paths (EmuDeck internal or SD card)
    if (emuRoot) {
      addDir(path.join(emuRoot, 'saves/pcsx2/saves'));
      addDir(path.join(emuRoot, 'saves/pcsx2/memcards'));
      addDir(path.join(emuRoot, 'saves/pcsx2'));
    }

    // 3. Standard SteamOS / EmuDeck paths under ~/Emulation
    addDir(path.join(HOME, 'Emulation/saves/pcsx2/saves'));
    addDir(path.join(HOME, 'Emulation/saves/pcsx2/memcards'));
    addDir(path.join(HOME, 'Emulation/saves/pcsx2'));

    // 4. Flatpak Net.pcsx2.PCSX2 directories
    addDir(path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/memcards'));
    addDir(path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/saves'));
    addDir(path.join(HOME, '.var/app/net.pcsx2.PCSX2/data/PCSX2/memcards'));

    // 5. Native / Standalone ~/.config and ~/.local paths
    addDir(path.join(HOME, '.config/PCSX2/memcards'));
    addDir(path.join(HOME, '.config/PCSX2/saves'));
    addDir(path.join(HOME, '.local/share/PCSX2/memcards'));
    addDir(path.join(HOME, '.local/share/PCSX2/saves'));

    return dirs;
  }

  getActiveMemcardsDir() {
    for (const dir of this.getSearchDirs()) {
      if (fs.existsSync(dir)) return dir;
    }
    // Default to Flatpak standard
    const emuRoot = this.getRoot ? this.getRoot() : null;
    const def = emuRoot
      ? path.join(emuRoot, 'saves/pcsx2/saves')
      : path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/memcards');

    try {
      fs.mkdirSync(def, { recursive: true });
    } catch {
      /* ignore */
    }
    return def;
  }

  async listMemcards() {
    const cards = [];
    const seen = new Set();
    const searchDirs = this.getSearchDirs();

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.name.startsWith('.')) continue;

          const lower = ent.name.toLowerCase();
          const fullPath = path.join(dir, ent.name);

          // 1. File-based memory card (.ps2, .bin, .card, or .mcd)
          if (ent.isFile()) {
            const isPs2File =
              lower.endsWith('.ps2') ||
              lower.endsWith('.bin') ||
              lower.endsWith('.card') ||
              lower.endsWith('.mcd') ||
              lower.startsWith('mcd00');

            if (!isPs2File) continue;
            if (seen.has(lower)) continue;
            seen.add(lower);

            const st = await fsp.stat(fullPath);
            cards.push({
              fileName: ent.name,
              fullPath,
              sizeBytes: st.size,
              mtime: st.mtimeMs,
              isSlot1: lower.includes('mcd001') || lower.includes('slot1') || lower.includes('card1'),
              isSlot2: lower.includes('mcd002') || lower.includes('slot2') || lower.includes('card2'),
              isDefault: lower === 'mcd001.ps2' || lower === 'mcd001',
              isFolder: false,
              saveCount: 1,
            });
          }
          // 2. Folder-based memory card (PCSX2 "Folder" memory card or folder-per-card mode)
          else if (ent.isDirectory()) {
            if (seen.has(lower)) continue;

            const isKnownCardFolder =
              lower.includes('mcd001') ||
              lower.includes('mcd002') ||
              lower.includes('card') ||
              lower.includes('slot') ||
              lower.endsWith('.ps2') ||
              lower === 'saves' ||
              lower === 'memcards';

            const inspection = await inspectDirectory(fullPath);

            // A folder is considered a memory card if:
            // a) It has a standard card name (e.g. Mcd001, Mcd001.ps2, Card1), OR
            // b) It contains PS2 save directories (like BASLUS-*, SLUS-*, etc. or icon.sys files)
            const hasSaves = inspection.itemCount > 0;
            if (!isKnownCardFolder && !hasSaves) continue;

            seen.add(lower);
            const st = await fsp.stat(fullPath);

            cards.push({
              fileName: ent.name,
              fullPath,
              sizeBytes: inspection.totalBytes || st.size,
              mtime: inspection.newestMtime || st.mtimeMs,
              isSlot1: lower.includes('mcd001') || lower.includes('slot1') || lower.includes('card1'),
              isSlot2: lower.includes('mcd002') || lower.includes('slot2') || lower.includes('card2'),
              isDefault: lower === 'mcd001.ps2' || lower === 'mcd001',
              isFolder: true,
              saveCount: inspection.itemCount,
            });
          }
        }
      } catch (e) {
        this.log(`[pcsx2] Error reading dir ${dir}: ${e.message}`);
      }
    }

    // Sort: default slot 1 first, then newest mtime
    cards.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return b.mtime - a.mtime;
    });

    const activeDir = this.getActiveMemcardsDir();
    const autoSync = this.configStore.get().autoSyncPcsx2Memcards !== false;

    return {
      available: true,
      memcardsDir: activeDir,
      cards,
      autoSync,
    };
  }

  async uploadMemcard({ romId, fileName, gameTitle, cardPath }) {
    let targetPath = cardPath;

    if (!targetPath) {
      const list = await this.listMemcards();
      if (fileName) {
        const found = list.cards.find((c) => c.fileName.toLowerCase() === fileName.toLowerCase());
        if (found) targetPath = found.fullPath;
      }
      if (!targetPath && list.cards.length > 0) {
        targetPath = list.cards[0].fullPath;
      }
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return { ok: false, message: `PCSX2 memory card not found on disk (${targetPath || fileName || 'Mcd001.ps2'})` };
    }

    try {
      this.log(`[pcsx2] Reading memory card for upload: ${targetPath}`);
      const st = await fsp.stat(targetPath);
      let buf;
      let actualFileName = path.basename(targetPath);

      if (st.isDirectory()) {
        // Zip directory for upload to RomM server
        actualFileName = actualFileName.endsWith('.zip') ? actualFileName : `${actualFileName}.zip`;
        const tmpZip = path.join(os.tmpdir(), `deckromm-pcsx2-${Date.now()}-${actualFileName}`);
        
        let zipped = false;
        if (which('zip')) {
          await execFileP('zip', ['-rq', tmpZip, '.'], 15000, { cwd: targetPath });
          zipped = fs.existsSync(tmpZip);
        }

        if (zipped) {
          buf = await fsp.readFile(tmpZip);
          await fsp.rm(tmpZip, { force: true }).catch(() => {});
        } else {
          // If zip isn't available, tar.gz fallback
          actualFileName = actualFileName.replace(/\.zip$/, '.tar.gz');
          const tmpTar = path.join(os.tmpdir(), `deckromm-pcsx2-${Date.now()}-${actualFileName}`);
          await execFileP('tar', ['-czf', tmpTar, '.'], 15000, { cwd: targetPath });
          if (fs.existsSync(tmpTar)) {
            buf = await fsp.readFile(tmpTar);
            await fsp.rm(tmpTar, { force: true }).catch(() => {});
          } else {
            throw new Error('Could not archive folder memory card for upload (zip/tar unavailable)');
          }
        }
      } else {
        buf = await fsp.readFile(targetPath);
      }

      const res = await this.cloud.uploadSave({
        romId,
        emulator: 'pcsx2',
        baseName: gameTitle || 'PS2',
        fileName: actualFileName,
        save: buf,
      });

      if (res.ok) {
        this.log(`[pcsx2] Successfully uploaded ${actualFileName} (${buf.length} bytes) to RomM for ROM ${romId}`);
        return {
          ok: true,
          fileName: actualFileName,
          sizeBytes: buf.length,
          updatedAt: Date.now(),
          save: res.save,
        };
      }
      return { ok: false, message: res.message || 'RomM upload failed' };
    } catch (e) {
      this.log(`[pcsx2] Error uploading memory card: ${e.message}`);
      return { ok: false, message: e.message };
    }
  }

  async downloadMemcard({ downloadPath, targetFileName }) {
    if (!downloadPath) return { ok: false, message: 'No download path provided' };
    try {
      const activeDir = this.getActiveMemcardsDir();
      fs.mkdirSync(activeDir, { recursive: true });

      const name = targetFileName || 'Mcd001.ps2';
      const destPath = path.join(activeDir, name);

      // Make safety backup of existing local memory card
      if (fs.existsSync(destPath)) {
        const backupPath = `${destPath}.backup-${Date.now()}`;
        if (fs.statSync(destPath).isDirectory()) {
          await execFileP('cp', ['-r', destPath, backupPath], 5000);
        } else {
          await fsp.copyFile(destPath, backupPath);
        }
        this.log(`[pcsx2] Backed up existing ${name} to ${backupPath}`);
      }

      const res = await this.cloud.downloadSave(downloadPath);
      if (!res.ok || !res.data) {
        return { ok: false, message: res.message || 'Failed to download save from RomM' };
      }

      const dataBuf = Buffer.from(res.data);
      const isZip = name.endsWith('.zip') || (dataBuf.length > 4 && dataBuf[0] === 0x50 && dataBuf[1] === 0x4b);

      if (isZip) {
        // Extract archive into activeDir folder
        const folderName = name.replace(/\.zip$/, '');
        const targetFolder = path.join(activeDir, folderName);
        await fsp.mkdir(targetFolder, { recursive: true });

        const tmpZip = path.join(os.tmpdir(), `deckromm-restore-${Date.now()}.zip`);
        await fsp.writeFile(tmpZip, dataBuf);
        if (which('unzip')) {
          await execFileP('unzip', ['-qo', tmpZip, '-d', targetFolder], 15000);
        }
        await fsp.rm(tmpZip, { force: true }).catch(() => {});
        this.log(`[pcsx2] Extracted folder memory card into ${targetFolder}`);
      } else {
        await fsp.writeFile(destPath, dataBuf);
        this.log(`[pcsx2] Successfully saved downloaded memory card to ${destPath} (${dataBuf.byteLength} bytes)`);
      }

      return {
        ok: true,
        targetPath: destPath,
        sizeBytes: dataBuf.byteLength,
        fileName: name,
      };
    } catch (e) {
      this.log(`[pcsx2] Error saving downloaded memory card: ${e.message}`);
      return { ok: false, message: e.message };
    }
  }

  async setAutoSync(enabled) {
    this.configStore.set({ autoSyncPcsx2Memcards: Boolean(enabled) });
    return { ok: true, autoSync: Boolean(enabled) };
  }

  async onPcsx2GameExited({ romId, title, startedAt }) {
    const autoSync = this.configStore.get().autoSyncPcsx2Memcards !== false;
    if (!autoSync || !romId) return;

    this.log(`[pcsx2] Checking for modified memory cards after playing ${title} (started ${new Date(startedAt || Date.now() - 60000).toISOString()})`);
    try {
      const list = await this.listMemcards();
      const threshold = (startedAt || Date.now() - 60000) - 10000;
      const modifiedCards = list.cards.filter((c) => c.mtime >= threshold);

      // If no card has recent mtime, still check if default card exists
      const cardToUpload = modifiedCards.length > 0 ? modifiedCards[0] : list.cards.find((c) => c.isDefault) || list.cards[0];

      if (!cardToUpload) {
        this.log(`[pcsx2] No memory cards found to upload for ${title}.`);
        return;
      }

      this.log(`[pcsx2] Auto-syncing memory card: ${cardToUpload.fileName} (${cardToUpload.sizeBytes} bytes, isFolder=${Boolean(cardToUpload.isFolder)})`);

      const r = await this.uploadMemcard({
        romId,
        fileName: cardToUpload.fileName,
        gameTitle: title,
        cardPath: cardToUpload.fullPath,
      });

      if (r.ok) {
        this.emit('pcsx2:memcard-uploaded', {
          romId,
          title,
          fileName: cardToUpload.fileName,
          sizeBytes: cardToUpload.sizeBytes,
          time: Date.now(),
        });
      }
    } catch (e) {
      this.log(`[pcsx2] Auto-sync failed: ${e.message}`);
    }
  }
}

module.exports = { Pcsx2Manager };
