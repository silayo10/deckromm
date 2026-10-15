'use strict';
/**
 * DeckRomM - Electron main process.
 *
 * Responsibilities
 *   - Window lifecycle tuned for SteamOS Game Mode (gamescope) and Desktop Mode
 *   - `app://` protocol serving the Vite build (no localhost HTTP server)
 *   - `romm-asset://` protocol: authenticated, disk-cached cover art
 *   - `romm-rom://` protocol: streams ROMs from RomM into the in-app EmulatorJS
 *     player (nothing is written to disk)
 *   - Save-state, in-game save (SRAM) and last-played sync with RomM (lib/cloudSync.cjs)
 *   - RomM API client + encrypted credential store (see lib/)
 *   - ROM downloads to the EmuDeck folder layout and emulator process management
 *   - Clean shutdown: kill spawned process groups, stop gamepad polling, exit
 *     with no lingering Chromium helpers so Steam returns to the library.
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  session,
  safeStorage,
  powerSaveBlocker,
  screen,
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { SecureStore } = require('./lib/secureStore.cjs');
const { ConfigStore } = require('./lib/configStore.cjs');
const { RommClient, normalizeBaseUrl } = require('./lib/rommClient.cjs');
const { detectEmulationRoot, storageStats, DownloadManager, EmulatorManager, getFlatpakStatus, installFlatpak } = require('./lib/emulation.cjs');
const { CloudSync } = require('./lib/cloudSync.cjs');
const { BiosManager } = require('./lib/biosManager.cjs');
const { AppUpdater } = require('./lib/appUpdater.cjs');

// ---------------------------------------------------------------------------
// Environment / Chromium switches (must run before `app.ready`)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(1);
const IS_DEV = Boolean(process.env.VITE_DEV_SERVER_URL);
const GAME_MODE =
  argv.includes('--gamemode') ||
  process.env.SteamGamepadUI === '1' ||
  process.env.XDG_CURRENT_DESKTOP === 'gamescope' ||
  Boolean(process.env.GAMESCOPE_WAYLAND_DISPLAY);
const FORCE_FULLSCREEN = GAME_MODE || argv.includes('--fullscreen');

// AppImages cannot ship a setuid chrome-sandbox; SteamOS has unprivileged userns
// but the helper still aborts. electron-builder also passes --no-sandbox via
// executableArgs; this is a belt-and-braces fallback for `electron .` runs.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
// gamescope exposes an Xwayland DISPLAY; native Wayland windows are not composited.
if (GAME_MODE && !argv.some((a) => a.startsWith('--ozone-platform'))) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
app.commandLine.appendSwitch('enable-gpu-rasterization');
// Let the in-app EmulatorJS player start audio without a click (controller-only UX)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Keep gamepad polling + animations alive when gamescope reports the window occluded.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Prevent Chromium from invoking host/SteamOS virtual keyboard or IME protocols
app.commandLine.appendSwitch('disable-virtual-keyboard');
app.commandLine.appendSwitch('disable-ime');
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,HardwareMediaKeyHandling,VirtualKeyboard,TouchVirtualKeyboard'
);

app.setName('DeckRomM');
if (process.env.DECKROMM_USER_DATA) app.setPath('userData', process.env.DECKROMM_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'romm-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'romm-rom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const GOT_LOCK = app.requestSingleInstanceLock();
if (!GOT_LOCK) {
  // A second launch from Steam should just focus the running instance.
  app.exit(0);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(path.join(LOG_DIR, 'main.log'), { flags: 'a' });
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  logStream.write(`${line}\n`);
  if (IS_DEV) console.log(line);
}
log(`--- DeckRomM ${app.getVersion()} start gameMode=${GAME_MODE} electron=${process.versions.electron}`);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
/** @type {BrowserWindow | null} */
let mainWindow = null;
let shuttingDown = false;
let powerBlockerId = null;

const userDataDir = app.getPath('userData');
const secureStore = new SecureStore({ userDataDir, safeStorage });
const configStore = new ConfigStore({ userDataDir });
const getRommSession = () => session.fromPartition('persist:romm');

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const romm = new RommClient({
  secureStore,
  getSession: getRommSession,
  onAuthRequired: (info) => emit('auth:required', info),
  log,
});

const cloud = new CloudSync({ romm, log });

// One-time migration of credentials from the v1 Express config (plaintext) into the secure store.
(function migrateLegacyCredentials() {
  const cfg = configStore.get();
  if (cfg._legacyToken && !romm.getCreds() && cfg.serverUrl) {
    try {
      romm.saveCreds({ baseUrl: normalizeBaseUrl(cfg.serverUrl), method: 'token', clientToken: cfg._legacyToken, username: cfg._legacyUsername || null });
      log('[migrate] imported legacy API token into secure store');
    } catch (e) {
      log('[migrate] failed', e.message);
    }
  }
  if (cfg._legacyToken || cfg._legacyUsername) configStore.set({ _legacyToken: undefined, _legacyUsername: undefined });
})();

const getEmulationRoot = () => detectEmulationRoot(configStore.get().emulationPath);

const downloads = new DownloadManager({
  romm,
  getRoot: getEmulationRoot,
  emit: (ch, payload) => {
    emit(ch, payload);
    updatePowerBlocker();
  },
  log,
});

const bios = new BiosManager({
  romm,
  getRoot: getEmulationRoot,
  emit,
  log,
});

const emulators = new EmulatorManager({
  getConfig: () => configStore.get(),
  emit,
  log,
  logDir: LOG_DIR,
  getBiosManager: () => bios,
  onGameStart: () => {
    if (!mainWindow) return;
    // Hand the screen to the emulator. In gamescope the most recently mapped
    // window of the app is shown; hiding ours guarantees the game is in front.
    if (GAME_MODE) mainWindow.hide();
    else mainWindow.minimize();
  },
  onGameEnd: () => restoreWindow(),
});

const updater = new AppUpdater({
  emit,
  log,
  configStore,
});

function updatePowerBlocker() {
  const busy = downloads.active.size > 0;
  if (busy && powerBlockerId === null) powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!busy && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

function restoreWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (FORCE_FULLSCREEN) mainWindow.setFullScreen(true);
  mainWindow.focus();
  mainWindow.webContents.focus();
}

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------
const DIST_DIR = path.join(__dirname, '..', 'dist');
const COVER_CACHE_DIR = path.join(userDataDir, 'cache', 'covers');

function registerProtocols() {
  // app://deckromm/<path> -> dist/<path> (SPA fallback to index.html)
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    let file = path.normalize(path.join(DIST_DIR, rel));
    if (!file.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 });
    try {
      const st = await fsp.stat(file);
      if (st.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(DIST_DIR, 'index.html');
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  // romm-asset://img/?u=<path-or-url>  -> authenticated fetch + disk cache
  protocol.handle('romm-asset', async (request) => {
    const target = new URL(request.url).searchParams.get('u') || '';
    if (!target) return new Response('Missing u', { status: 400 });
    const hash = crypto.createHash('sha1').update(target).digest('hex');
    const cacheFile = path.join(COVER_CACHE_DIR, hash);
    try {
      const [buf, type] = await Promise.all([fsp.readFile(cacheFile), fsp.readFile(`${cacheFile}.type`, 'utf8').catch(() => 'image/jpeg')]);
      return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=31536000' } });
    } catch {
      /* cache miss */
    }

    try {
      let res;
      const creds = romm.getCreds();
      const isAbsolute = /^https?:\/\//i.test(target);
      if (isAbsolute && !(creds && target.startsWith(creds.baseUrl))) {
        res = await net.fetch(target); // third-party CDN (IGDB etc.) - no credentials
      } else {
        const rel = isAbsolute ? target.slice(creds.baseUrl.length) : target.startsWith('/') ? target : `/${target}`;
        if (!/^\/(assets|api\/raw|api\/roms|api\/screenshots)\//.test(rel)) return new Response('Forbidden path', { status: 403 });
        res = await romm.authedFetch(rel, { headers: { Accept: 'image/*' }, timeoutMs: 15000, silent: true });
      }
      if (!res.ok) return new Response(null, { status: res.status });
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || 'image/jpeg';
      fsp.mkdir(COVER_CACHE_DIR, { recursive: true })
        .then(() => Promise.all([fsp.writeFile(cacheFile, buf), fsp.writeFile(`${cacheFile}.type`, type)]))
        .catch(() => {});
      return new Response(buf, { headers: { 'Content-Type': type } });
    } catch (e) {
      return new Response(null, { status: e.status || 502 });
    }
  });

  // romm-rom://rom/<romId>/<fileName>?platform=<slug>&size=<bytes>&title=<t>
  // Streams the ROM from RomM straight into the in-app EmulatorJS player, so
  // "Play in app" never writes the game to disk. If the server is unreachable
  // and the game was downloaded earlier, the local copy is used instead.
  protocol.handle('romm-rom', async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const romId = decodeURIComponent(parts[0] || '');
    const fileName = decodeURIComponent(parts.slice(1).join('/') || '');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Type', 'Cache-Control': 'no-store' };
    if (!romId || !fileName) return new Response('Bad ROM URL', { status: 400, headers: cors });
    const req = {
      romId,
      fileName,
      platformSlug: url.searchParams.get('platform') || '',
      title: url.searchParams.get('title') || '',
      sizeBytes: Number(url.searchParams.get('size') || 0),
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': '*' } });
    if (request.method === 'HEAD') {
      const h = { ...cors, 'Content-Type': 'application/octet-stream' };
      if (req.sizeBytes) h['Content-Length'] = String(req.sizeBytes);
      return new Response(null, { status: 200, headers: h });
    }
    try {
      // Pass a signal so the 60 s request timeout does not cut off large ROMs mid-stream.
      const res = await downloads.openContent(req, new AbortController().signal);
      const headers = { ...cors, 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' };
      const len = res.headers.get('content-length');
      if (len) headers['Content-Length'] = len;
      log(`[stream] rom ${romId} ${fileName} ${len || '?'} bytes`);
      return new Response(res.body, { status: 200, headers });
    } catch (e) {
      try {
        const local = downloads.localPath(req);
        const st = await fsp.stat(local);
        if (st.size > 0) {
          log(`[stream] server failed (${e.message}); using local copy ${local}`);
          return new Response(await fsp.readFile(local), { status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': String(st.size), 'X-DeckRomM-Source': 'local' } });
        }
      } catch {
        /* no local copy */
      }
      log(`[stream] rom ${romId} failed: ${e.message}`);
      return new Response(e.message || 'Stream failed', { status: e.status === 401 || e.status === 403 ? e.status : 502, headers: { ...cors, 'Content-Type': 'text/plain' } });
    }
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const BASE_W = 1280;
const BASE_H = 800;

function applyZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  // 1.0 on the Deck panel; scales the whole 1280x800 layout up when docked to a TV.
  const factor = Math.max(0.75, Math.min(2.5, Math.min(w / BASE_W, h / BASE_H)));
  mainWindow.webContents.setZoomFactor(Math.round(factor * 100) / 100);
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const display = screen.getPrimaryDisplay();
  log(`[window] primary display ${display.size.width}x${display.size.height} scale=${display.scaleFactor}`);

  mainWindow = new BrowserWindow({
    width: BASE_W,
    height: BASE_H,
    minWidth: 960,
    minHeight: 600,
    useContentSize: true,
    fullscreen: FORCE_FULLSCREEN,
    show: false,
    backgroundColor: '#0a0e17',
    autoHideMenuBar: true,
    title: 'DeckRomM',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    applyZoom();

    // Auto-check for updates after initial render settles (non-blocking)
    setTimeout(async () => {
      try {
        const cfg = configStore.get();
        if (cfg.autoCheckUpdates !== false) {
          const info = await updater.checkForUpdates();
          if (info && info.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
            emit('app:update-available', info);
          }
        }
      } catch (e) {
        log('[updater] auto-check error', e && e.message);
      }
    }, 2500);
  });
  mainWindow.on('resize', applyZoom);
  mainWindow.on('enter-full-screen', applyZoom);
  mainWindow.on('focus', () => emit('window:focus', { focused: true }));
  mainWindow.on('blur', () => emit('window:focus', { focused: false }));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(IS_DEV && url.startsWith(process.env.VITE_DEV_SERVER_URL))) e.preventDefault();
  });
  wc.on('render-process-gone', (_e, details) => {
    log('[window] renderer gone', details);
    if (!shuttingDown && details.reason !== 'clean-exit') setTimeout(() => mainWindow && mainWindow.reload(), 500);
  });
  wc.on('unresponsive', () => log('[window] renderer unresponsive'));
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' && (IS_DEV || process.env.DECKROMM_DEVTOOLS === '1')) {
      wc.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  if (IS_DEV) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadURL('app://deckromm/index.html');
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function assertSender(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  if (url.startsWith('app://') || (IS_DEV && url.startsWith(process.env.VITE_DEV_SERVER_URL))) return;
  throw new Error(`Blocked IPC from untrusted frame ${url}`);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSender(event);
    try {
      return await fn(...args);
    } catch (e) {
      log(`[ipc] ${channel} failed`, e && e.message);
      return { ok: false, message: (e && e.message) || String(e) };
    }
  });
}

function registerIpc() {
  // app / window
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    gameMode: GAME_MODE,
    fullscreen: mainWindow ? mainWindow.isFullScreen() : FORCE_FULLSCREEN,
    platform: process.platform,
    secureStorage: secureStore.describe().backend,
    userData: userDataDir,
  }));
  handle('app:quit', () => {
    setImmediate(() => shutdown('renderer-request'));
    return { ok: true };
  });
  handle('window:toggle-fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });

  // config (non-secret)
  handle('config:get', () => configStore.get());
  handle('config:set', (patch) => configStore.set(patch));

  // auth
  handle('auth:status', () => romm.status());
  handle('auth:test-server', (url) => romm.testServer(url));
  handle('auth:login-password', (req) => romm.loginWithPassword(req));
  handle('auth:login-token', (req) => romm.loginWithToken(req));
  handle('auth:pair', (req) => romm.loginWithPairingCode(req));
  handle('auth:logout', () => romm.logout());

  // RomM API (only /api/* paths - renderer cannot use the credentials elsewhere)
  handle('romm:request', (req) => {
    if (!req || typeof req.path !== 'string' || !req.path.startsWith('/api/')) {
      return { ok: false, status: 400, message: 'Invalid RomM API path' };
    }
    return romm.request(req);
  });

  // RomM sync (save states + recently played)
  handle('cloud:states-list', (romId) => cloud.listStates(romId));
  handle('cloud:state-download', (downloadPath) => cloud.downloadState(downloadPath));
  handle('cloud:state-upload', (req) => cloud.uploadState(req || {}));
  handle('cloud:states-delete', (ids) => cloud.deleteStates(ids));
  handle('cloud:mark-played', (romId) => cloud.markPlayed(romId));
  handle('cloud:saves-list', (romId) => cloud.listSaves(romId));
  handle('cloud:save-download', (downloadPath) => cloud.downloadSave(downloadPath));
  handle('cloud:save-upload', (req) => cloud.uploadSave(req || {}));

  // ROM files
  handle('rom:download', (req) => downloads.download(req));
  handle('rom:cancel', (romId) => downloads.cancel(romId));
  handle('rom:local-status', (list) => downloads.localStatus(list));
  handle('rom:delete', (req) => downloads.deleteLocal(req));
  handle('rom:list-downloaded', () => downloads.listDownloaded());
  handle('rom:read', async (req) => {
    const p = downloads.localPath(req);
    const buf = await fsp.readFile(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // emulator
  handle('emulator:launch', async (req) => {
    let local = downloads.localStatus([req])[String(req.romId)];
    if (!local.exists) {
      const dl = await downloads.download(req);
      if (!dl.ok) return dl;
      local = { exists: true, path: dl.path };
    }
    return emulators.launch({ ...req, romPath: local.path });
  });
  handle('emulator:launch-standalone', (req) => emulators.launchStandalone(req || {}));
  handle('emulator:kill', () => emulators.kill());
  handle('emulator:status', () => emulators.running());

  // system
  handle('system:storage', () => storageStats(getEmulationRoot()));
  handle('system:emulation-path', () => getEmulationRoot());
  handle('system:select-directory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('system:flatpak-status', (flatpakIds) => getFlatpakStatus(flatpakIds));
  handle('system:install-flatpak', (flatpakId) => installFlatpak(flatpakId, (ev) => emit('flatpak:progress', ev)));

  // BIOS & Firmware
  handle('bios:list', () => bios.listLocalBios());
  handle('bios:status', (list) => bios.checkStatus(list));
  handle('bios:download', (req) => bios.download(req));
  handle('bios:sync-platform', (platformSlug) => bios.syncPlatformBios(platformSlug));
  handle('bios:sync-all', () => bios.syncAllMissing());
  handle('bios:cancel', (id) => bios.cancel(id));
  handle('bios:open-folder', () => bios.openFolder());
  handle('bios:xbox-status', () => bios.getXboxStatus());
  handle('bios:xbox-setup', () => bios.autoSetupXbox());
  handle('bios:xbox-create-hdd', (customPath) => bios.createXboxHdd(customPath));

  // App Updater & GitHub in-place upgrade
  handle('app:check-update', () => updater.checkForUpdates());
  handle('app:perform-update', (opts) => updater.performUpdate(opts));
  handle('app:relaunch', () => updater.relaunch());

  // ---- v1.0 compatibility channels -------------------------------------
  handle('deckromm:is-electron', () => true);
  handle('deckromm:get-emulation-path', () => path.join(getEmulationRoot(), 'roms'));
  handle('deckromm:select-directory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('deckromm:save-rom-file', async (payload) => {
    const dir = payload.targetDir || path.join(getEmulationRoot(), 'roms', payload.platformSlug || 'misc');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, path.basename(payload.fileName));
    await fsp.writeFile(file, Buffer.from(payload.data));
    return { success: true, path: file };
  });
  handle('deckromm:toggle-fullscreen', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow ? mainWindow.isFullScreen() : false;
  });
  handle('deckromm:quit', () => {
    setImmediate(() => shutdown('legacy-quit'));
    return true;
  });
}

// ---------------------------------------------------------------------------
// Shutdown - must never hang, or Steam shows a black screen / "app running"
// ---------------------------------------------------------------------------
async function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`[shutdown] ${reason}`);

  // Hard deadline: whatever happens, the process is gone in 4 s.
  setTimeout(() => {
    log('[shutdown] deadline reached, forcing exit');
    app.exit(code);
  }, 4000).unref();

  try {
    // 1) Tell the renderer to stop Gamepad API polling (releases the evdev handles
    //    Chromium holds for the Steam virtual controller) and flush state.
    emit('app:shutting-down', { reason });
    await new Promise((r) => setTimeout(r, 150));
    // 2) Stop transfers and terminate any emulator process group.
    downloads.cancelAll();
    await emulators.kill(2000);
    if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
    // 3) Flush cookies so the RomM session survives restart.
    await getRommSession().cookies.flushStore().catch(() => {});
  } catch (e) {
    log('[shutdown] cleanup error', e.message);
  }

  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.destroy();
    } catch {
      /* ignore */
    }
  }
  logStream.end();
  app.exit(code);
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => shutdown(sig, 0));
}
process.on('uncaughtException', (e) => log('[uncaught]', e && e.stack ? e.stack : String(e)));
process.on('unhandledRejection', (e) => log('[unhandledRejection]', e && e.stack ? e.stack : String(e)));

app.on('before-quit', (e) => {
  if (!shuttingDown) {
    e.preventDefault();
    shutdown('before-quit');
  }
});
app.on('window-all-closed', () => shutdown('window-all-closed'));
app.on('second-instance', () => restoreWindow());

app.whenReady().then(() => {
  if (!GOT_LOCK) return;
  // Default-deny permission requests except the ones the UI needs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['fullscreen', 'pointerLock', 'clipboard-sanitized-write'].includes(permission));
  });
  registerProtocols();
  registerIpc();
  createWindow();
});
