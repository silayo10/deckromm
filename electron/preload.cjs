'use strict';
/**
 * Preload bridge (sandboxed, contextIsolation). Exposes a narrow, typed API as
 * `window.deckromm`; the shape is mirrored in src/types/electron.d.ts.
 * Credentials never cross this bridge - only auth status does.
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const EVENTS = new Set(['auth:required', 'rom:progress', 'emulator:state', 'app:shutting-down', 'window:focus']);

function on(channel, listener) {
  if (!EVENTS.has(channel)) throw new Error(`Unknown event channel ${channel}`);
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api = {
  isElectron: true,
  app: {
    info: invoke('app:info'),
    quit: invoke('app:quit'),
    toggleFullscreen: invoke('window:toggle-fullscreen'),
  },
  config: {
    get: invoke('config:get'),
    set: invoke('config:set'),
  },
  auth: {
    status: invoke('auth:status'),
    testServer: invoke('auth:test-server'),
    loginPassword: invoke('auth:login-password'),
    loginToken: invoke('auth:login-token'),
    pair: invoke('auth:pair'),
    logout: invoke('auth:logout'),
  },
  romm: {
    request: invoke('romm:request'),
  },
  cloud: {
    listStates: invoke('cloud:states-list'),
    downloadState: invoke('cloud:state-download'),
    uploadState: invoke('cloud:state-upload'),
    deleteStates: invoke('cloud:states-delete'),
    markPlayed: invoke('cloud:mark-played'),
    listSaves: invoke('cloud:saves-list'),
    downloadSave: invoke('cloud:save-download'),
    uploadSave: invoke('cloud:save-upload'),
  },
  roms: {
    download: invoke('rom:download'),
    cancel: invoke('rom:cancel'),
    localStatus: invoke('rom:local-status'),
    remove: invoke('rom:delete'),
    read: invoke('rom:read'),
  },
  emulator: {
    launch: invoke('emulator:launch'),
    kill: invoke('emulator:kill'),
    status: invoke('emulator:status'),
  },
  system: {
    storage: invoke('system:storage'),
    emulationPath: invoke('system:emulation-path'),
    selectDirectory: invoke('system:select-directory'),
  },
  on,
};

contextBridge.exposeInMainWorld('deckromm', api);

// v1.0 compatibility surface
contextBridge.exposeInMainWorld('deckrommNative', {
  isElectron: () => ipcRenderer.invoke('deckromm:is-electron'),
  getEmulationPath: () => ipcRenderer.invoke('deckromm:get-emulation-path'),
  selectDirectory: () => ipcRenderer.invoke('deckromm:select-directory'),
  saveRomFile: (payload) => ipcRenderer.invoke('deckromm:save-rom-file', payload),
  toggleFullscreen: () => ipcRenderer.invoke('deckromm:toggle-fullscreen'),
  quitApp: () => ipcRenderer.invoke('deckromm:quit'),
});
