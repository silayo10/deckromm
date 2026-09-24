import { Game, SaveState, StorageInfo } from '../types';

/** Local copy + sync bookkeeping of a game's in-game save (SRAM). */
export interface SramRecord {
  gameId: string;
  /** Last SRAM bytes seen on this Deck. */
  data?: Uint8Array;
  /** When this Deck last saw the SRAM change (ms). */
  updatedAt: number;
  /** The RomM save these bytes came from or were uploaded as. */
  cloudId?: number;
  /** RomM's updated_at of that save (ms). */
  cloudUpdatedAt?: number;
  /** Bytes changed on this Deck that RomM does not have yet. */
  pendingUpload?: boolean;
}

const DB_NAME = 'DeckRomM_Cache_v1';
const ROMS_STORE = 'cached_roms';
const METADATA_STORE = 'cached_metadata';
const SAVESTATES_STORE = 'cached_savestates';
const SRAM_STORE = 'cached_sram';

class CacheStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(ROMS_STORE)) {
            db.createObjectStore(ROMS_STORE, { keyPath: 'gameId' });
          }
          if (!db.objectStoreNames.contains(METADATA_STORE)) {
            db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(SAVESTATES_STORE)) {
            db.createObjectStore(SAVESTATES_STORE, { keyPath: ['gameId', 'slot'] });
          }
          if (!db.objectStoreNames.contains(SRAM_STORE)) {
            db.createObjectStore(SRAM_STORE, { keyPath: 'gameId' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  // Cache ROM binary blob + metadata
  async saveRomToCache(game: Game, data: Blob | ArrayBuffer): Promise<void> {
    const db = await this.getDB();
    const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;

    return new Promise((resolve, reject) => {
      const tx = db.transaction([ROMS_STORE, METADATA_STORE], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      const romStore = tx.objectStore(ROMS_STORE);
      romStore.put({
        gameId: String(game.id),
        fileName: game.fileName,
        platformSlug: game.platformSlug,
        cachedAt: Date.now(),
        size: arrayBuffer.byteLength,
        data: arrayBuffer,
      });

      const metaStore = tx.objectStore(METADATA_STORE);
      metaStore.put({
        ...game,
        isCached: true,
        cachedAt: Date.now(),
      });
    });
  }

  // Check if game is cached
  async isGameCached(gameId: string | number): Promise<boolean> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(ROMS_STORE, 'readonly');
        const req = tx.objectStore(ROMS_STORE).getKey(String(gameId));
        req.onsuccess = () => resolve(req.result !== undefined);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  // Retrieve cached ROM binary
  async getCachedRom(gameId: string | number): Promise<{ fileName: string; data: ArrayBuffer } | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(ROMS_STORE, 'readonly');
        const req = tx.objectStore(ROMS_STORE).get(String(gameId));
        req.onsuccess = () => {
          if (req.result) {
            resolve({
              fileName: req.result.fileName,
              data: req.result.data,
            });
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  // Get all cached games metadata
  async getAllCachedGames(): Promise<Game[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(METADATA_STORE, 'readonly');
        const req = tx.objectStore(METADATA_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  // Save State with visual thumbnail
  async saveGameState(save: SaveState): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SAVESTATES_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore(SAVESTATES_STORE);
        store.put({
          gameId: String(save.gameId),
          slot: save.slot,
          timestamp: save.timestamp,
          score: save.score,
          lives: save.lives,
          levelName: save.levelName || `Slot ${save.slot} Save`,
          screenshot: save.screenshot || '',
          data: save.data,
          cloudId: save.cloudId,
          downloadPath: save.downloadPath,
          pendingUpload: Boolean(save.pendingUpload),
        });
      });
    } catch (e) {
      console.error('Error saving state:', e);
    }
  }

  // Get all save states for a game
  async getGameSaveStates(gameId: string | number): Promise<SaveState[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SAVESTATES_STORE, 'readonly');
        const store = tx.objectStore(SAVESTATES_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const all: any[] = req.result || [];
          const forGame = all
            .filter((item) => String(item.gameId) === String(gameId))
            .sort((a, b) => a.slot - b.slot);
          resolve(forGame);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /** Sync bookkeeping for a game's in-game save (SRAM). */
  async getSramRecord(gameId: string | number): Promise<SramRecord | null> {
    try {
      const db = await this.getDB();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(SRAM_STORE, 'readonly').objectStore(SRAM_STORE).get(String(gameId));
        req.onsuccess = () => resolve((req.result as SramRecord) || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async putSramRecord(rec: SramRecord): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SRAM_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(SRAM_STORE).put({ ...rec, gameId: String(rec.gameId) });
      });
    } catch (e) {
      console.error('Error saving SRAM record:', e);
    }
  }

  // Delete a specific save state slot
  async deleteGameState(gameId: string | number, slot: number): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SAVESTATES_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore(SAVESTATES_STORE);
        store.delete([String(gameId), slot]);
      });
    } catch (e) {
      console.error('Error deleting save state:', e);
    }
  }

  // Delete cached game
  async deleteFromCache(gameId: string | number): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ROMS_STORE, METADATA_STORE], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(ROMS_STORE).delete(String(gameId));
      tx.objectStore(METADATA_STORE).delete(String(gameId));
    });
  }

  // Clear all cache
  async clearAllCache(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ROMS_STORE, METADATA_STORE], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(ROMS_STORE).clear();
      tx.objectStore(METADATA_STORE).clear();
    });
  }

  // Calculate accurate storage usage across IndexedDB and Steam Deck filesystem
  async getStorageStats(): Promise<StorageInfo> {
    let cachedBytes = 0;
    let cachedGamesCount = 0;
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(ROMS_STORE, 'readonly');
        const req = tx.objectStore(ROMS_STORE).openCursor();
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest).result;
          if (cursor) {
            cachedGamesCount++;
            cachedBytes += cursor.value.size || 0;
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      });
    } catch {}

    // Accurate browser origin quota from navigator.storage
    let browserQuotaBytes = 64 * 1024 * 1024 * 1024;
    let browserUsageBytes = cachedBytes;

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota && estimate.quota > 0) browserQuotaBytes = estimate.quota;
        if (estimate.usage !== undefined) browserUsageBytes = estimate.usage;
      } catch {}
    }

    const browserFreeBytes = Math.max(0, browserQuotaBytes - browserUsageBytes);

    // Query real Steam Deck filesystem storage if backend server is available
    let internalTotalBytes = browserQuotaBytes;
    let internalFreeBytes = browserFreeBytes;
    let internalUsedBytes = browserUsageBytes;
    let sdCardMounted = false;
    let sdTotalBytes = 0;
    let sdFreeBytes = 0;
    let sdUsedBytes = 0;
    let isRealDeckFs = false;

    try {
      const res = await fetch('/api/steamdeck/storage');
      if (res.ok) {
        const data = await res.json();
        if (data.internal && data.internal.totalBytes > 0) {
          isRealDeckFs = true;
          internalTotalBytes = data.internal.totalBytes;
          internalFreeBytes = data.internal.freeBytes;
          internalUsedBytes = data.internal.usedBytes;
        }
        if (data.sdcard && data.sdcard.mounted && data.sdcard.totalBytes > 0) {
          sdCardMounted = true;
          sdTotalBytes = data.sdcard.totalBytes;
          sdFreeBytes = data.sdcard.freeBytes;
          sdUsedBytes = data.sdcard.usedBytes;
        }
      }
    } catch {}

    const estimatedDeckFreeBytes = isRealDeckFs ? internalFreeBytes : browserFreeBytes;

    return {
      cachedGamesCount,
      cachedBytes,
      browserQuotaBytes,
      browserUsageBytes,
      browserFreeBytes,
      estimatedDeckFreeBytes,
      storageTarget: sdCardMounted ? 'sdcard' : 'internal',
      internalTotalBytes,
      internalFreeBytes,
      internalUsedBytes,
      sdCardMounted,
      sdTotalBytes,
      sdFreeBytes,
      sdUsedBytes,
      isRealDeckFs,
    };
  }
}

export const cacheStorage = new CacheStorageService();
