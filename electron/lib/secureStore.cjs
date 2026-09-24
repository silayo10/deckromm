'use strict';
/**
 * DeckRomM secure credential store.
 *
 * Secrets (OAuth access/refresh tokens, Client API tokens, optional remembered
 * password) are written to `<userData>/secure-store.json` encrypted at rest.
 *
 * Two backends:
 *   1. `aes-gcm` (default) - AES-256-GCM with a random 256-bit master key kept in
 *      `<userData>/keys/master.key` (mode 0600) and bound to /etc/machine-id via
 *      HKDF. This works identically in SteamOS Game Mode (gamescope, where no
 *      KWallet/libsecret daemon is running) and Desktop Mode, so the user is not
 *      logged out when switching modes.
 *   2. `safeStorage` - Electron's OS keyring integration (KWallet / libsecret).
 *      Opt-in with DECKROMM_USE_KEYRING=1 because the keyring is usually not
 *      reachable from Game Mode and the credential would become unreadable there.
 *
 * Every entry records which backend encrypted it, so switching backends never
 * silently corrupts data: an unreadable entry simply reads as `null`, which the
 * renderer treats as "authentication required".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 2;

function readMachineId() {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = fs.readFileSync(p, 'utf8').trim();
      if (id) return id;
    } catch {
      /* ignore */
    }
  }
  return 'deckromm-no-machine-id';
}

function atomicWrite(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

class SecureStore {
  /**
   * @param {{ userDataDir: string, safeStorage?: Electron.SafeStorage }} opts
   */
  constructor({ userDataDir, safeStorage }) {
    this.file = path.join(userDataDir, 'secure-store.json');
    this.keyDir = path.join(userDataDir, 'keys');
    this.safeStorage = safeStorage;
    this.preferKeyring = process.env.DECKROMM_USE_KEYRING === '1';
    this.cache = null;
    this.key = null;
  }

  /** Lazily create / load the machine-bound AES key. */
  getKey() {
    if (this.key) return this.key;
    fs.mkdirSync(this.keyDir, { recursive: true, mode: 0o700 });
    const keyFile = path.join(this.keyDir, 'master.key');
    let raw;
    try {
      raw = fs.readFileSync(keyFile);
      if (raw.length !== 32) throw new Error('bad key length');
    } catch {
      raw = crypto.randomBytes(32);
      atomicWrite(keyFile, raw, 0o600);
    }
    this.key = Buffer.from(
      crypto.hkdfSync('sha256', raw, Buffer.from(readMachineId()), Buffer.from('deckromm-secure-store-v2'), 32)
    );
    return this.key;
  }

  keyringUsable() {
    try {
      if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) return false;
      if (typeof this.safeStorage.getSelectedStorageBackend === 'function') {
        const backend = this.safeStorage.getSelectedStorageBackend();
        // basic_text is a hard-coded obfuscation key - not better than aes-gcm.
        if (backend === 'basic_text' || backend === 'unknown') return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  load() {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.cache = parsed && parsed.entries ? parsed : { version: STORE_VERSION, entries: {} };
    } catch {
      this.cache = { version: STORE_VERSION, entries: {} };
    }
    return this.cache;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomicWrite(this.file, JSON.stringify(this.cache, null, 2));
  }

  encrypt(plain) {
    if (this.preferKeyring && this.keyringUsable()) {
      return { b: 'safeStorage', d: this.safeStorage.encryptString(plain).toString('base64') };
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { b: 'aes-gcm', d: Buffer.concat([iv, tag, enc]).toString('base64') };
  }

  decrypt(entry) {
    if (!entry || !entry.d) return null;
    try {
      const buf = Buffer.from(entry.d, 'base64');
      if (entry.b === 'safeStorage') {
        if (!this.keyringUsable()) return null;
        return this.safeStorage.decryptString(buf);
      }
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.getKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** @returns {any|null} */
  get(key) {
    const entry = this.load().entries[key];
    const plain = this.decrypt(entry);
    if (plain == null) return null;
    try {
      return JSON.parse(plain);
    } catch {
      return null;
    }
  }

  set(key, value) {
    this.load().entries[key] = { ...this.encrypt(JSON.stringify(value)), t: Date.now() };
    this.persist();
  }

  delete(key) {
    const store = this.load();
    if (key in store.entries) {
      delete store.entries[key];
      this.persist();
    }
  }

  clear() {
    this.cache = { version: STORE_VERSION, entries: {} };
    this.persist();
  }

  describe() {
    return {
      backend: this.preferKeyring && this.keyringUsable() ? 'safeStorage' : 'aes-gcm',
      file: this.file,
    };
  }
}

module.exports = { SecureStore };
