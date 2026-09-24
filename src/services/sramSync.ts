/**
 * In-game save (SRAM, ".srm") sync between this Deck and the RomM server.
 *
 * Works like RomM's own EmulatorJS player, so both sides see the same file:
 *   - uploads go to POST /api/saves in the "autosave" slot, named "<rom>.srm",
 *     tagged with the libretro core (e.g. mgba for GBA);
 *   - on start, the newest compatible save on RomM is written into the
 *     emulator's save path and the core reloads it.
 *
 * Conflict rules (checked once when a game starts):
 *   - RomM has a newer save than the one this Deck last synced, and the Deck has
 *     no unsynced changes           -> use RomM's save.
 *   - The Deck has unsynced changes and RomM has nothing newer -> upload the Deck's.
 *   - Both changed                  -> the newest one wins; the other copy is kept
 *                                      locally as a backup (never silently lost).
 *   - RomM unreachable              -> keep playing on the Deck's copy, upload later.
 */
import type { Game } from '../types';
import type { CloudSave } from '../env/electron';
import { bridge, isNativeApp } from './bridge';
import { cacheStorage, type SramRecord } from './cacheStorage';
import { coreNameFor } from './cloudSaves';

export const sramSyncAvailable = isNativeApp;

export type SramSyncState = 'off' | 'checking' | 'none' | 'synced' | 'pending' | 'syncing' | 'offline';

export interface SramStatus {
  state: SramSyncState;
  /** When RomM last confirmed the save (ms). */
  at?: number;
  message?: string;
}

export function bytesEqual(a?: Uint8Array | null, b?: Uint8Array | null): boolean {
  if (!a || !b) return !a && !b;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compatible(s: CloudSave, system: string): boolean {
  if (!s.emulator) return true;
  const e = s.emulator.toLowerCase();
  return e === coreNameFor(system).toLowerCase() || e === system.toLowerCase();
}

/** RomM names SRAM after the ROM file, like its own player (fs_name_no_ext + ".srm"). */
function baseName(game: Game): string {
  const f = game.fileName || '';
  return f ? f.replace(/\.[^.]+$/, '') : game.title;
}

export type StartupPlan =
  | { action: 'inject'; bytes: Uint8Array; from: 'cloud' | 'local'; status: SramStatus }
  | { action: 'upload'; bytes: Uint8Array; status: SramStatus }
  | { action: 'none'; status: SramStatus };

/**
 * Decide what to do with the SRAM when a game starts.
 * `emuBytes` is what the emulator currently holds (its own local copy, or null).
 */
export async function planStartup(game: Game, system: string, emuBytes: Uint8Array | null): Promise<StartupPlan> {
  const rec = await cacheStorage.getSramRecord(game.id);
  const local = emuBytes && emuBytes.byteLength ? emuBytes : null;
  const localKnown = local || (rec?.data && rec.data.byteLength ? rec.data : null);

  // Did the Deck change the save since it last matched RomM?
  const dirty = Boolean(rec?.pendingUpload) || Boolean(local && rec?.data && !bytesEqual(local, rec.data) && rec.cloudId !== undefined);

  const offlinePlan = (message?: string): StartupPlan => {
    const status: SramStatus = { state: sramSyncAvailable ? 'offline' : 'off', message };
    if (!local && rec?.data?.byteLength) return { action: 'inject', bytes: rec.data, from: 'local', status };
    return { action: 'none', status };
  };

  if (!sramSyncAvailable || game.id === undefined || String(game.id).startsWith('demo')) return offlinePlan();

  const res = await bridge.cloud.listSaves(game.id).catch((e: any) => ({ ok: false as const, message: e?.message, saves: [] as CloudSave[] }));
  if (!res.ok || !res.saves) return offlinePlan(res.message);

  const newest = res.saves.filter((s) => compatible(s, system)).sort((a, b) => b.updatedAt - a.updatedAt)[0];

  if (!newest) {
    if (localKnown) return { action: 'upload', bytes: localKnown, status: { state: 'pending' } };
    return { action: 'none', status: { state: 'none' } };
  }

  // Every DeckRomM / RomM-web upload creates a new version (new id); older servers
  // overwrite in place, which moves updated_at instead.
  const cloudIsNew = !rec?.cloudId || newest.id !== rec.cloudId || newest.updatedAt > (rec.cloudUpdatedAt || 0) + 1000;

  const useCloud = async (): Promise<StartupPlan> => {
    const dl = await bridge.cloud.downloadSave(newest.downloadPath).catch((e: any) => ({ ok: false as const, message: e?.message, data: undefined }));
    if (!dl.ok || !dl.data || !dl.data.byteLength) return offlinePlan(dl.message || 'Could not download the save from RomM');
    const bytes = new Uint8Array(dl.data);
    if (localKnown && !bytesEqual(localKnown, bytes)) await keepBackup(game, localKnown);
    await cacheStorage.putSramRecord({
      gameId: String(game.id),
      data: bytes,
      updatedAt: Date.now(),
      cloudId: newest.id,
      cloudUpdatedAt: newest.updatedAt,
      pendingUpload: false,
    });
    if (local && bytesEqual(local, bytes)) return { action: 'none', status: { state: 'synced', at: newest.updatedAt } };
    return { action: 'inject', bytes, from: 'cloud', status: { state: 'synced', at: newest.updatedAt } };
  };

  if (cloudIsNew && !dirty) return useCloud();
  if (cloudIsNew && dirty) {
    // Both sides changed: newest wins.
    if ((rec?.updatedAt || 0) > newest.updatedAt && localKnown) return { action: 'upload', bytes: localKnown, status: { state: 'pending' } };
    return useCloud();
  }
  if (dirty && localKnown) return { action: 'upload', bytes: localKnown, status: { state: 'pending' } };
  if (!local && rec?.data?.byteLength) return { action: 'inject', bytes: rec.data, from: 'local', status: { state: 'synced', at: rec.cloudUpdatedAt } };
  return { action: 'none', status: { state: 'synced', at: rec?.cloudUpdatedAt || newest.updatedAt } };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The copy that lost a conflict is kept on the Deck (one per game). */
async function keepBackup(game: Game, bytes: Uint8Array) {
  try {
    localStorage.setItem(
      `deckromm_sram_backup_${game.id}`,
      JSON.stringify({ at: Date.now(), size: bytes.byteLength, b64: toBase64(bytes.subarray(0, 512 * 1024)) })
    );
  } catch {
    /* quota: best effort */
  }
}

/** Remember that the Deck's SRAM changed (before trying to upload it). */
export async function recordLocalChange(game: Game, bytes: Uint8Array) {
  const rec = await cacheStorage.getSramRecord(game.id);
  const next: SramRecord = {
    gameId: String(game.id),
    ...(rec || {}),
    data: new Uint8Array(bytes),
    updatedAt: Date.now(),
    pendingUpload: true,
  };
  await cacheStorage.putSramRecord(next);
}

function dataUrlToBytes(dataUrl?: string): { bytes?: Uint8Array; type?: string } {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return {};
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, type: m[1] };
}

/** Upload the SRAM to RomM. The local record is updated either way. */
export async function uploadSram(game: Game, system: string, bytes: Uint8Array, screenshot?: string): Promise<{ ok: boolean; status: SramStatus }> {
  await recordLocalChange(game, bytes);
  if (!sramSyncAvailable) return { ok: false, status: { state: 'off' } };
  const shot = dataUrlToBytes(screenshot);
  const res = await bridge.cloud
    .uploadSave({
      romId: game.id,
      emulator: coreNameFor(system),
      baseName: baseName(game),
      save: new Uint8Array(bytes),
      screenshot: shot.bytes,
      screenshotType: shot.type,
    })
    .catch((e: any) => ({ ok: false as const, message: e?.message || String(e), save: undefined }));
  if (!res.ok || !res.save) return { ok: false, status: { state: 'pending', message: res.message } };
  await cacheStorage.putSramRecord({
    gameId: String(game.id),
    data: new Uint8Array(bytes),
    updatedAt: Date.now(),
    cloudId: res.save.id,
    cloudUpdatedAt: res.save.updatedAt || Date.now(),
    pendingUpload: false,
  });
  return { ok: true, status: { state: 'synced', at: Date.now() } };
}
