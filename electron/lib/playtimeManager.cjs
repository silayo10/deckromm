'use strict';
/**
 * Playtime Manager
 *
 * Tracks local game play duration (active non-paused seconds) on the Steam Deck,
 * persists records to `<userData>/playtime.json`, and synchronizes with the RomM server
 * via PUT /api/roms/{id}/props.
 */
const fs = require('fs');
const path = require('path');

class PlaytimeManager {
  /**
   * @param {{ userDataDir: string, log?: Function }} deps
   */
  constructor({ userDataDir, log = () => {} }) {
    this.userDataDir = userDataDir;
    this.file = path.join(userDataDir, 'playtime.json');
    this.log = log;
    this.records = null; // Map or object of romId -> PlaytimeRecord
  }

  load() {
    if (this.records) return this.records;
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        this.records = parsed.records || {};
      } else {
        this.records = {};
      }
    } catch (e) {
      this.log(`[playtime] failed to read ${this.file}: ${e.message}`);
      this.records = {};
    }
    return this.records;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const data = {
        version: 1,
        updatedAt: Date.now(),
        records: this.records || {},
      };
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log(`[playtime] failed to save playtime records: ${e.message}`);
    }
  }

  /**
   * Get playtime record for a single game.
   * @param {string | number} romId
   */
  getPlaytime(romId) {
    if (!romId) return { romId: '', totalSeconds: 0, sessionsCount: 0, lastPlayed: 0 };
    const all = this.load();
    const key = String(romId);
    const rec = all[key];
    if (rec) {
      return { ...rec };
    }
    return {
      romId: key,
      totalSeconds: 0,
      sessionsCount: 0,
      lastPlayed: 0,
      pendingSync: false,
    };
  }

  /**
   * Return all local playtime records keyed by romId.
   */
  getAllPlaytimes() {
    return { ...this.load() };
  }

  /**
   * Record a completed session of active (non-paused) playtime.
   * @param {string | number} romId
   * @param {number} activeSeconds
   */
  recordSession(romId, activeSeconds) {
    if (!romId) return null;
    const key = String(romId);
    const all = this.load();
    const prev = all[key] || {
      romId: key,
      totalSeconds: 0,
      sessionsCount: 0,
      lastPlayed: 0,
      lastSyncedAt: 0,
    };

    const added = Math.max(0, Math.round(Number(activeSeconds) || 0));
    const updated = {
      ...prev,
      romId: key,
      totalSeconds: (prev.totalSeconds || 0) + added,
      sessionsCount: (prev.sessionsCount || 0) + (added > 10 ? 1 : 0),
      lastPlayed: Date.now(),
      pendingSync: true,
    };

    all[key] = updated;
    this.save();
    this.log(`[playtime] recorded ${added}s for ROM ${key}. Total: ${updated.totalSeconds}s (${(updated.totalSeconds / 3600).toFixed(2)}h)`);
    return updated;
  }

  /**
   * Merge or reconcile server-reported playtime from RomM.
   * If RomM reports a higher playtime, take the maximum so no progress is lost.
   * @param {string | number} romId
   * @param {number} serverSeconds
   * @param {string | number} [serverLastPlayed]
   */
  reconcileWithRomm(romId, serverSeconds, serverLastPlayed) {
    if (!romId) return null;
    const key = String(romId);
    const all = this.load();
    const prev = all[key];
    const sSecs = Math.max(0, Math.round(Number(serverSeconds) || 0));
    let serverLastTs = 0;
    if (serverLastPlayed) {
      serverLastTs = typeof serverLastPlayed === 'number' ? serverLastPlayed : Date.parse(serverLastPlayed) || 0;
    }

    if (!prev) {
      if (sSecs > 0 || serverLastTs > 0) {
        const newRec = {
          romId: key,
          totalSeconds: sSecs,
          sessionsCount: sSecs > 0 ? 1 : 0,
          lastPlayed: serverLastTs || Date.now(),
          lastSyncedAt: Date.now(),
          pendingSync: false,
        };
        all[key] = newRec;
        this.save();
        return newRec;
      }
      return this.getPlaytime(key);
    }

    // If server has more playtime than local, advance local
    let changed = false;
    let nextTotal = prev.totalSeconds || 0;
    let nextLastPlayed = prev.lastPlayed || 0;

    if (sSecs > nextTotal) {
      nextTotal = sSecs;
      changed = true;
    }
    if (serverLastTs > nextLastPlayed) {
      nextLastPlayed = serverLastTs;
      changed = true;
    }

    if (changed) {
      const updated = {
        ...prev,
        totalSeconds: nextTotal,
        lastPlayed: nextLastPlayed,
        lastSyncedAt: Date.now(),
        pendingSync: false,
      };
      all[key] = updated;
      this.save();
      return updated;
    }

    return prev;
  }

  /**
   * Synchronize a game's playtime to the RomM server.
   * Compatible with RomM 3.x, 4.x, and 5.x by providing both top-level and data fields.
   * @param {string | number} romId
   * @param {import('./rommClient.cjs').RommClient} rommClient
   */
  async syncToRomm(romId, rommClient) {
    if (!romId || !rommClient) return { ok: false, message: 'Missing parameters' };
    const key = String(romId);
    const rec = this.getPlaytime(key);
    if (!rec || !rec.totalSeconds) {
      return { ok: true, synced: 0, message: 'No playtime recorded yet' };
    }

    if (!rommClient.getCreds()) {
      return { ok: false, message: 'RomM not authenticated' };
    }

    try {
      const put = (body) =>
        rommClient.authedFetch(`/api/roms/${encodeURIComponent(key)}/props`, {
          method: 'PUT',
          query: { update_last_played: 'true' },
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: 15000,
          silent: true,
        });

      // Send payload with both top-level playtime and inside data for RomM 3/4/5 cross-compatibility
      const payload = {
        playtime: rec.totalSeconds,
        data: {
          playtime: rec.totalSeconds,
        },
        update_last_played: true,
      };

      let res = await put(payload);
      if (res.status === 422 || res.status === 400) {
        // Fallback for older schemas
        res = await put({ data: { playtime: rec.totalSeconds } });
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log(`[playtime] failed to sync to RomM: HTTP ${res.status} ${text.slice(0, 120)}`);
        return { ok: false, status: res.status, message: `RomM error: HTTP ${res.status}` };
      }

      // Mark synced locally
      const all = this.load();
      if (all[key]) {
        all[key].pendingSync = false;
        all[key].lastSyncedAt = Date.now();
        this.save();
      }

      this.log(`[playtime] synced ${rec.totalSeconds}s (${(rec.totalSeconds / 3600).toFixed(2)}h) to RomM for ROM ${key}`);
      return {
        ok: true,
        romId: key,
        totalSeconds: rec.totalSeconds,
        lastSyncedAt: Date.now(),
      };
    } catch (e) {
      this.log(`[playtime] sync error for ${key}: ${e.message}`);
      return { ok: false, message: e.message };
    }
  }

  /**
   * Sync all pending games that have un-uploaded local playtime.
   * @param {import('./rommClient.cjs').RommClient} rommClient
   */
  async syncAllPending(rommClient) {
    if (!rommClient || !rommClient.getCreds()) return { ok: false, synced: 0 };
    const all = this.load();
    const pendingKeys = Object.keys(all).filter((k) => all[k].pendingSync && all[k].totalSeconds > 0);
    if (pendingKeys.length === 0) return { ok: true, synced: 0 };

    let syncedCount = 0;
    for (const key of pendingKeys) {
      const res = await this.syncToRomm(key, rommClient);
      if (res.ok) syncedCount++;
    }

    return { ok: true, synced: syncedCount, total: pendingKeys.length };
  }
}

module.exports = { PlaytimeManager };
