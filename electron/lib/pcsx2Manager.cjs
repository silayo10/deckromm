'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();

class Pcsx2Manager {
  /**
   * @param {{ cloud: any, configStore: any, emit: Function, log: Function }} deps
   */
  constructor({ cloud, configStore, emit, log }) {
    this.cloud = cloud;
    this.configStore = configStore;
    this.emit = emit;
    this.log = log || console.log;
  }

  getSearchDirs() {
    return [
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/memcards'),
      path.join(HOME, '.var/app/net.pcsx2.PCSX2/data/PCSX2/memcards'),
      path.join(HOME, 'Emulation/saves/pcsx2/saves'),
      path.join(HOME, '.config/PCSX2/memcards'),
      path.join(HOME, '.local/share/PCSX2/memcards'),
    ];
  }

  getActiveMemcardsDir() {
    for (const dir of this.getSearchDirs()) {
      if (fs.existsSync(dir)) return dir;
    }
    // Default to Flatpak standard
    const def = path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/memcards');
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
          if (!ent.isFile()) continue;
          if (!ent.name.toLowerCase().endsWith('.ps2')) continue;
          if (seen.has(ent.name.toLowerCase())) continue;
          seen.add(ent.name.toLowerCase());

          const fullPath = path.join(dir, ent.name);
          const st = await fsp.stat(fullPath);
          const lower = ent.name.toLowerCase();

          cards.push({
            fileName: ent.name,
            fullPath,
            sizeBytes: st.size,
            mtime: st.mtimeMs,
            isSlot1: lower.includes('mcd001') || lower.includes('slot1') || lower.includes('card1'),
            isSlot2: lower.includes('mcd002') || lower.includes('slot2') || lower.includes('card2'),
            isDefault: lower === 'mcd001.ps2',
          });
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
      return { ok: false, message: `PCSX2 memory card file not found on disk (${targetPath || fileName || 'Mcd001.ps2'})` };
    }

    try {
      this.log(`[pcsx2] Reading memory card for upload: ${targetPath}`);
      const buf = await fsp.readFile(targetPath);
      const actualFileName = path.basename(targetPath);

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
        await fsp.copyFile(destPath, backupPath);
        this.log(`[pcsx2] Backed up existing ${name} to ${backupPath}`);
      }

      const res = await this.cloud.downloadSave(downloadPath);
      if (!res.ok || !res.data) {
        return { ok: false, message: res.message || 'Failed to download save from RomM' };
      }

      await fsp.writeFile(destPath, Buffer.from(res.data));
      this.log(`[pcsx2] Successfully saved downloaded memory card to ${destPath} (${res.data.byteLength} bytes)`);

      return {
        ok: true,
        targetPath: destPath,
        sizeBytes: res.data.byteLength,
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

      this.log(`[pcsx2] Auto-syncing memory card: ${cardToUpload.fileName} (${cardToUpload.sizeBytes} bytes)`);

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
