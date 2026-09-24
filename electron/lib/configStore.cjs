'use strict';
/**
 * Non-secret configuration (server URL, UI preferences, launcher overrides).
 * Stored as plain JSON in `<userData>/config.json`. Secrets NEVER go here -
 * see secureStore.cjs.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SECRET_KEYS = ['password', 'apiToken', 'accessToken', 'refreshToken', 'clientToken'];

const DEFAULTS = {
  serverUrl: '',
  isDemoMode: false,
  autoCacheBoxArt: true,
  emulationPath: '',
  audioFeedback: true,
  displayMode: 'deck',
  firstLaunchSetupCompleted: false,
  defaultPlatform: 'all',
  hideInfoFiles: true,
  viewMode: 'grid',
  sortBy: 'title',
  filterTag: 'all',
  launcherMode: 'auto', // auto | retroarch | custom
  customLaunchCommand: '',
  launcherOverrides: {}, // { [platformSlug]: "command template" }
  retroarchFullscreen: true,
};

function stripSecrets(obj) {
  const out = { ...obj };
  for (const k of SECRET_KEYS) delete out[k];
  return out;
}

class ConfigStore {
  constructor({ userDataDir }) {
    this.file = path.join(userDataDir, 'config.json');
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      stored = this.migrateLegacy();
    }
    this.data = { ...DEFAULTS, ...stripSecrets(stored) };
    return this.data;
  }

  /** Import the config written by the old Express server (v1.0). */
  migrateLegacy() {
    const legacy = path.join(os.homedir(), '.local', 'share', 'deckromm', 'config.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      return {
        serverUrl: parsed.serverUrl || '',
        emulationPath: parsed.emulationPath || '',
        isDemoMode: Boolean(parsed.isDemoMode),
        firstLaunchSetupCompleted: Boolean(parsed.firstLaunchSetupCompleted),
        _legacyUsername: parsed.username || '',
        _legacyToken: parsed.apiToken || '',
      };
    } catch {
      return {};
    }
  }

  get() {
    return { ...this.load() };
  }

  set(patch) {
    this.data = { ...this.load(), ...stripSecrets(patch || {}) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    return this.get();
  }
}

module.exports = { ConfigStore, DEFAULTS };
