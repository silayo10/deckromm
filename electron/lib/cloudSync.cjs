'use strict';
/**
 * RomM "cloud" sync: save states and last-played timestamps.
 *
 * Save states live on the RomM server (POST /api/states), so they follow the
 * user to every device and show up in RomM's own web player. DeckRomM tags the
 * file names of its five quick slots with "[deckromm-slot-N]"; states created
 * elsewhere (RomM web, other clients) are listed as extra, load-only entries.
 *
 * Compatibility (checked against RomM source):
 *   - 3.x / 4.x / 5.x: POST /api/states?rom_id=&emulator=  multipart "stateFile" (+ "screenshotFile")
 *   - 5.x:             GET  /api/states?rom_id=            (older: rom.user_states on GET /api/roms/{id})
 *   - all:             POST /api/states/delete             {"states": [ids]}
 *   - last played:     PUT  /api/roms/{id}/props?update_last_played=true
 *                      body {"data": {}, "update_last_played": true}
 *                      (5.x reads the query flag, 3.x/4.x read the body; extra keys are ignored)
 *
 * In-game saves (SRAM, ".srm"), same shape as RomM's own EmulatorJS player:
 *   - list:     GET  /api/saves?rom_id=              (older: rom.user_saves)
 *   - upload:   POST /api/saves?rom_id=&emulator=&slot=autosave&autocleanup=true
 *               multipart "saveFile" named "<rom fs_name_no_ext>.srm" (+ "screenshotFile").
 *               Servers with save slots keep a capped history in the "autosave" slot;
 *               older servers ignore slot/autocleanup and overwrite the file by name.
 *   - download: the save's download_path (GET /api/saves/{id}/content)
 */
const crypto = require('node:crypto');

const SLOT_TAG = /\[deckromm-slot-(\d+)\]/i;

function mapState(s) {
  const m = SLOT_TAG.exec(s.file_name || '');
  const shot = s.screenshot && (s.screenshot.download_path || s.screenshot.full_path) ? s.screenshot.download_path || '' : '';
  return {
    id: s.id,
    romId: s.rom_id,
    fileName: s.file_name,
    emulator: s.emulator || null,
    slot: m ? Number(m[1]) : null,
    sizeBytes: Number(s.file_size_bytes || 0),
    updatedAt: Date.parse(s.updated_at || s.created_at || '') || 0,
    downloadPath: s.download_path || '',
    screenshotPath: shot,
    missing: Boolean(s.missing_from_fs),
  };
}

function multipart(parts) {
  const boundary = `----DeckRomM${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const p of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.fileName.replace(/"/g, '')}"\r\n` +
          `Content-Type: ${p.type || 'application/octet-stream'}\r\n\r\n`
      )
    );
    chunks.push(Buffer.from(p.data));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function errorText(res) {
  const t = await res.text().catch(() => '');
  try {
    const j = JSON.parse(t);
    return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail || j).slice(0, 200);
  } catch {
    return t.slice(0, 200);
  }
}

function mapSave(s) {
  return {
    id: s.id,
    romId: s.rom_id,
    fileName: s.file_name,
    emulator: s.emulator || null,
    slot: s.slot || null,
    sizeBytes: Number(s.file_size_bytes || 0),
    updatedAt: Date.parse(s.updated_at || s.created_at || '') || 0,
    downloadPath: s.download_path || (s.id != null ? `/api/saves/${s.id}/content` : ''),
    missing: Boolean(s.missing_from_fs),
  };
}

class CloudSync {
  constructor({ romm, log = () => {} }) {
    this.romm = romm;
    this.log = log;
  }

  envelope(fn) {
    return fn().catch((e) => {
      const status = e.status || 0;
      const message =
        status === 403
          ? 'RomM refused this for your account or token (missing "assets.write" / "roms.user.write" permission). Sign out and sign in again, or create a token with those scopes.'
          : e.message || String(e);
      return { ok: false, status, authRequired: Boolean(e.authRequired), message };
    });
  }

  /** All of the signed-in user's states for one ROM, newest first. */
  listStates(romId) {
    return this.envelope(async () => {
      let list = null;
      const res = await this.romm.authedFetch('/api/states', { query: { rom_id: String(romId) }, timeoutMs: 15000, silent: true });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.items)) list = data.items;
      }
      if (!list) {
        // Older servers: states are embedded in the ROM detail.
        const r = await this.romm.authedFetch(`/api/roms/${encodeURIComponent(romId)}`, { timeoutMs: 15000, silent: true });
        if (!r.ok) return { ok: false, status: r.status, message: `RomM returned HTTP ${r.status}: ${await errorText(r)}` };
        const rom = await r.json();
        list = Array.isArray(rom.user_states) ? rom.user_states : [];
      }
      const states = list
        .filter((s) => String(s.rom_id ?? romId) === String(romId))
        .map(mapState)
        .filter((s) => !s.missing)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, states };
    });
  }

  /** Raw bytes of a state (download_path from the list). */
  downloadState(downloadPath) {
    return this.envelope(async () => {
      const p = String(downloadPath || '');
      if (!p.startsWith('/api/')) return { ok: false, status: 400, message: 'Invalid state path' };
      const res = await this.romm.authedFetch(p, { headers: { Accept: 'application/octet-stream' }, timeoutMs: 60000, silent: true });
      if (!res.ok) return { ok: false, status: res.status, message: `RomM returned HTTP ${res.status}: ${await errorText(res)}` };
      return { ok: true, data: new Uint8Array(await res.arrayBuffer()) };
    });
  }

  /**
   * Upload a quick-slot state. Older copies of the same slot are removed after the
   * new one is stored, so the server keeps exactly one state per slot.
   */
  uploadState({ romId, slot, emulator, baseName, state, screenshot, screenshotType }) {
    return this.envelope(async () => {
      const bytes = state instanceof Uint8Array ? state : new Uint8Array(state || []);
      if (!bytes.byteLength) return { ok: false, status: 400, message: 'Refusing to upload an empty state' };
      const safeBase = String(baseName || `rom-${romId}`).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120) || `rom-${romId}`;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', ' ').replace('Z', '');
      const name = `${safeBase} [deckromm-slot-${Number(slot)}] [${stamp}]`;
      const parts = [{ name: 'stateFile', fileName: `${name}.state`, data: bytes }];
      if (screenshot && screenshot.byteLength) {
        const ext = /png/.test(screenshotType || '') ? 'png' : 'jpg';
        parts.push({ name: 'screenshotFile', fileName: `${name}.${ext}`, data: screenshot, type: screenshotType || 'image/jpeg' });
      }
      const { body, contentType } = multipart(parts);
      const query = { rom_id: String(romId) };
      if (emulator) query.emulator = emulator;
      const res = await this.romm.authedFetch('/api/states', { method: 'POST', query, headers: { 'Content-Type': contentType }, body, timeoutMs: 60000, silent: true });
      if (!res.ok) return { ok: false, status: res.status, message: `RomM returned HTTP ${res.status}: ${await errorText(res)}` };
      const created = mapState(await res.json());

      // Drop older copies of this slot (best effort).
      const listed = await this.listStates(romId);
      if (listed.ok) {
        const stale = listed.states.filter((s) => s.slot === Number(slot) && s.id !== created.id).map((s) => s.id);
        if (stale.length) await this.deleteStates(stale);
      }
      return { ok: true, state: created };
    });
  }

  /** The signed-in user's in-game saves (SRAM) for one ROM, newest first. */
  listSaves(romId) {
    return this.envelope(async () => {
      let list = null;
      const res = await this.romm.authedFetch('/api/saves', { query: { rom_id: String(romId) }, timeoutMs: 15000, silent: true });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.items)) list = data.items;
      }
      if (!list) {
        const r = await this.romm.authedFetch(`/api/roms/${encodeURIComponent(romId)}`, { timeoutMs: 15000, silent: true });
        if (!r.ok) return { ok: false, status: r.status, message: `RomM returned HTTP ${r.status}: ${await errorText(r)}` };
        const rom = await r.json();
        list = Array.isArray(rom.user_saves) ? rom.user_saves : [];
      }
      const saves = list
        .filter((s) => String(s.rom_id ?? romId) === String(romId))
        .map(mapSave)
        .filter((s) => !s.missing && s.downloadPath)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, saves };
    });
  }

  /** Raw bytes of an in-game save (download_path from the list). */
  downloadSave(downloadPath) {
    return this.downloadState(downloadPath);
  }

  /** Upload the current SRAM or memory card, the way RomM's own web player does (autosave slot). */
  uploadSave({ romId, emulator, baseName, fileName, save, screenshot, screenshotType }) {
    return this.envelope(async () => {
      const bytes = save instanceof Uint8Array ? save : new Uint8Array(save || []);
      if (!bytes.byteLength) return { ok: false, status: 400, message: 'Refusing to upload an empty save' };
      const safeBase = String(baseName || `rom-${romId}`).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 150) || `rom-${romId}`;
      const actualFileName = fileName || `${safeBase}.srm`;
      const parts = [{ name: 'saveFile', fileName: actualFileName, data: bytes }];
      if (screenshot && screenshot.byteLength) {
        const ext = /png/.test(screenshotType || '') ? 'png' : 'jpg';
        parts.push({ name: 'screenshotFile', fileName: `${safeBase}.${ext}`, data: screenshot, type: screenshotType || 'image/jpeg' });
      }
      const { body, contentType } = multipart(parts);
      // overwrite=true: always store a new version (DeckRomM only uploads changed bytes),
      // so the save returned is the newest one in the slot.
      const query = { rom_id: String(romId), slot: 'autosave', autocleanup: 'true', autocleanup_limit: '10', overwrite: 'true' };
      if (emulator) query.emulator = emulator;
      const res = await this.romm.authedFetch('/api/saves', { method: 'POST', query, headers: { 'Content-Type': contentType }, body, timeoutMs: 60000, silent: true });
      if (!res.ok) return { ok: false, status: res.status, message: `RomM returned HTTP ${res.status}: ${await errorText(res)}` };
      return { ok: true, save: mapSave(await res.json()) };
    });
  }

  deleteStates(ids) {
    return this.envelope(async () => {
      const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => Number.isFinite(n));
      if (!list.length) return { ok: true, deleted: [] };
      const res = await this.romm.authedFetch('/api/states/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ states: list }),
        timeoutMs: 20000,
        silent: true,
      });
      if (!res.ok) return { ok: false, status: res.status, message: `RomM returned HTTP ${res.status}: ${await errorText(res)}` };
      return { ok: true, deleted: list };
    });
  }

  /** Record "played now" on the server so Recently Played follows the user. */
  markPlayed(romId) {
    return this.envelope(async () => {
      const put = (body) =>
        this.romm.authedFetch(`/api/roms/${encodeURIComponent(romId)}/props`, {
          method: 'PUT',
          query: { update_last_played: 'true' },
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: 15000,
          silent: true,
        });
      let res = await put({ data: {}, update_last_played: true });
      if (res.status === 422 || res.status === 400) res = await put({});
      if (!res.ok) return { ok: false, status: res.status, message: `RomM returned HTTP ${res.status}: ${await errorText(res)}` };
      const data = await res.json().catch(() => ({}));
      return { ok: true, lastPlayed: data.last_played || new Date().toISOString() };
    });
  }
}

module.exports = { CloudSync, SLOT_TAG, mapState, mapSave };
