/**
 * Save-state sync between this Deck (IndexedDB) and the RomM server.
 *
 * - Quick slots 1-5 are stored on RomM as "<game> [deckromm-slot-N] [time].state".
 *   The newest copy of a slot wins, whether it was made here or on another device.
 * - States created in RomM's own web player (or other clients) are offered as
 *   extra, load-only entries so they can be resumed on the Deck too.
 * - Every save is kept locally first; if the upload fails it is flagged
 *   `pendingUpload` and retried the next time the game is opened.
 */
import type { Game, SaveState } from '../types';
import type { CloudState } from '../env/electron';
import { assetUrl, bridge, isNativeApp } from './bridge';
import { cacheStorage } from './cacheStorage';

/** EmulatorJS system alias -> the libretro core RomM's web player uses by default. */
const CORE_NAMES: Record<string, string> = {
  gba: 'mgba',
  gb: 'gambatte',
  gbc: 'gambatte',
  nes: 'fceumm',
  snes: 'snes9x',
  n64: 'mupen64plus_next',
  nds: 'melonds',
  segaMD: 'genesis_plus_gx',
  segaMS: 'genesis_plus_gx',
  segaGG: 'genesis_plus_gx',
  segaCD: 'genesis_plus_gx',
  psx: 'pcsx_rearmed',
  pce: 'mednafen_pce',
  ngp: 'mednafen_ngp',
  ws: 'mednafen_wswan',
  vb: 'beetle_vb',
  atari2600: 'stella2014',
  atari7800: 'prosystem',
  lynx: 'handy',
  jaguar: 'virtualjaguar',
  arcade: 'mame2003_plus',
};

export function coreNameFor(system: string): string {
  return CORE_NAMES[system] || system;
}

/** True when a state recorded with `emulator` can be restored by our core. */
function compatible(s: CloudState, system: string): boolean {
  if (!s.emulator) return true;
  const e = s.emulator.toLowerCase();
  return e === coreNameFor(system).toLowerCase() || e === system.toLowerCase();
}

export const cloudSyncAvailable = isNativeApp;

export interface MergedStates {
  slots: Record<number, SaveState>;
  extras: SaveState[];
  cloudOk: boolean;
  cloudMessage?: string;
}

function fromCloud(s: CloudState, local?: SaveState): SaveState {
  return {
    slot: s.slot ?? 0,
    gameId: local?.gameId,
    timestamp: s.updatedAt,
    screenshot: s.screenshotPath ? assetUrl(s.screenshotPath) : local?.screenshot || '',
    levelName: s.fileName,
    data: undefined,
    cloudId: s.id,
    downloadPath: s.downloadPath,
    source: 'cloud',
  };
}

export async function loadMergedStates(game: Game, system: string, slotCount: number): Promise<MergedStates> {
  const localList = await cacheStorage.getGameSaveStates(game.id);
  const local: Record<number, SaveState> = {};
  for (const st of localList) if (st && st.data) local[st.slot] = { ...st, source: 'local' };

  if (!cloudSyncAvailable || game.id === undefined) return { slots: local, extras: [], cloudOk: false };

  const res = await bridge.cloud.listStates(game.id).catch((e: any) => ({ ok: false as const, message: e?.message, states: [] as CloudState[] }));
  if (!res.ok || !res.states) return { slots: local, extras: [], cloudOk: false, cloudMessage: res.message };

  const usable = res.states.filter((s) => compatible(s, system));
  const slots: Record<number, SaveState> = { ...local };
  for (let slot = 1; slot <= slotCount; slot++) {
    const cloud = usable.filter((s) => s.slot === slot).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const mine = local[slot];
    if (!cloud) {
      // The slot was deleted on another device: keep ours only if it still has to be uploaded.
      if (mine && mine.cloudId && !mine.pendingUpload) {
        await cacheStorage.deleteGameState(game.id, slot);
        delete slots[slot];
      }
      continue;
    }
    if (mine && (mine.cloudId === cloud.id || mine.timestamp >= cloud.updatedAt - 1000)) {
      slots[slot] = { ...mine, cloudId: mine.cloudId === cloud.id ? cloud.id : mine.cloudId, downloadPath: cloud.downloadPath, source: mine.cloudId === cloud.id ? 'both' : 'local' };
    } else {
      slots[slot] = { ...fromCloud(cloud, mine), slot, gameId: game.id };
    }
  }
  const extras = usable
    .filter((s) => s.slot === null)
    .slice(0, 10)
    .map((s) => ({ ...fromCloud(s), gameId: game.id }));
  return { slots, extras, cloudOk: true };
}

function dataUrlToBytes(dataUrl?: string): { bytes?: Uint8Array; type?: string } {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return {};
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, type: m[1] };
}

function baseName(game: Game): string {
  const f = game.fileName || '';
  return f ? f.replace(/\.[^.]+$/, '') : game.title;
}

/** Upload one local slot. Returns the updated state (cloudId set, pendingUpload cleared). */
export async function uploadSlot(game: Game, system: string, st: SaveState): Promise<{ ok: boolean; state: SaveState; message?: string }> {
  if (!cloudSyncAvailable) return { ok: false, state: st, message: 'Cloud sync needs the desktop app' };
  const src: Uint8Array = st.data instanceof Uint8Array ? st.data : new Uint8Array(st.data || []);
  const shot = dataUrlToBytes(st.screenshot);
  const res = await bridge.cloud
    .uploadState({
      romId: game.id,
      slot: st.slot,
      emulator: coreNameFor(system),
      baseName: baseName(game),
      state: new Uint8Array(src),
      screenshot: shot.bytes,
      screenshotType: shot.type,
    })
    .catch((e: any) => ({ ok: false as const, message: e?.message || String(e), state: undefined }));
  if (!res.ok || !res.state) {
    const pending: SaveState = { ...st, pendingUpload: true };
    await cacheStorage.saveGameState(pending);
    return { ok: false, state: pending, message: res.message };
  }
  const synced: SaveState = {
    ...st,
    cloudId: res.state.id,
    downloadPath: res.state.downloadPath,
    // Align the local timestamp with the server so the two copies compare equal.
    timestamp: Math.max(st.timestamp, res.state.updatedAt || 0),
    pendingUpload: false,
    source: 'both',
  };
  await cacheStorage.saveGameState(synced);
  return { ok: true, state: synced };
}

/** Make sure a state's bytes are available locally (downloads cloud-only states). */
export async function ensureStateData(game: Game, st: SaveState, cacheAsSlot: boolean): Promise<SaveState> {
  if (st.data && (st.data as Uint8Array).byteLength) return st;
  if (!st.downloadPath) throw new Error('This save has no data');
  const res = await bridge.cloud.downloadState(st.downloadPath);
  if (!res.ok || !res.data || !res.data.byteLength) throw new Error(res.message || 'Could not download the save from RomM');
  const full: SaveState = { ...st, gameId: game.id, data: res.data, source: 'both' };
  if (cacheAsSlot && st.slot >= 1) await cacheStorage.saveGameState(full);
  return full;
}

export async function deleteSlot(game: Game, st: SaveState | undefined, slot: number): Promise<{ ok: boolean; message?: string }> {
  await cacheStorage.deleteGameState(game.id, slot);
  if (!cloudSyncAvailable || !st?.cloudId) return { ok: true };
  // Remove every cloud copy of this slot, not only the one we know about.
  const ids = new Set<number>([st.cloudId]);
  const list = await bridge.cloud.listStates(game.id).catch(() => null);
  if (list?.ok && list.states) list.states.filter((s) => s.slot === slot).forEach((s) => ids.add(s.id));
  const res = await bridge.cloud.deleteStates([...ids]).catch((e: any) => ({ ok: false, message: e?.message }));
  return { ok: res.ok, message: res.message };
}

/** Tell RomM this game was just played (drives "Recently Played" on every device). */
export async function markPlayed(game: Game): Promise<string | null> {
  if (!cloudSyncAvailable || game.id === undefined || String(game.id).startsWith('demo')) return null;
  const res = await bridge.cloud.markPlayed(game.id).catch(() => null);
  return res?.ok ? res.lastPlayed || new Date().toISOString() : null;
}
