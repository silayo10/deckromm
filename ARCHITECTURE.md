# DeckRomM 1.3.0 - Architecture and Refactor Notes

Controller-first RomM client for Steam Deck (1280x800, SteamOS Game Mode).
Stack: Electron 44 (main process, CommonJS) + React 19 / TypeScript / Vite 6 / Tailwind 4 (renderer), packaged as an x86_64 AppImage with electron-builder 26.

```
+--------------------------- Electron main (electron/main.cjs) ---------------------------+
|  app://deckromm/  -> serves dist/ (no localhost server, no file:// quirks)               |
|  romm-asset://img/?u=/assets/...  -> authenticated, disk-cached cover art                |
|  lib/secureStore.cjs  AES-256-GCM secrets (tokens, cookies, password)                     |
|  lib/configStore.cjs  non-secret config.json                                              |
|  lib/rommClient.cjs   all RomM HTTP (auth, refresh, cookies, 401/403 -> auth-required)   |
|  lib/emulation.cjs    DownloadManager (.part + progress) / EmulatorManager (process grp) |
|  shutdown(): kill games -> cancel downloads -> flush stores -> app.exit(0)  (<= 4 s)     |
+-----------------------------------^---------------------------------------------------- +
                                    | contextBridge (preload.cjs), sender-validated IPC
+-----------------------------------v---------- Renderer (src/) --------------------------+
|  services/bridge.ts      typed window.deckromm, browser/demo fallback                     |
|  services/rommApi.ts     paged, abortable, chunked mapping (never blocks rendering)       |
|  services/gamepadService.ts   XInput polling -> NavigationAction events                   |
|  services/focusManager.ts     scope stack + geometric D-pad nav + scrollIntoView          |
|  hooks/useFocusScope, useScrollIntoView, useGamepadAction                                 |
|  App.tsx + components (LoginOverlay, MainMenu, SettingsScreen, GameGrid, ...)             |
+------------------------------------------------------------------------------------------+
```

## 1. Authentication and session persistence

All network traffic to RomM goes through the main process (`electron/lib/rommClient.cjs`), so no credentials ever live in `localStorage` and the renderer keeps `webSecurity` and `contextIsolation` enabled.

| Method | How it works | Stored secret |
| --- | --- | --- |
| Username / password | OAuth2 password grant on `POST /api/token` (scopes for read + assets), refresh via `grant_type=refresh_token`. Falls back to the cookie session `POST /api/auth/login` (and legacy `/api/login`) for older servers. | access + refresh token, session cookie, optionally the password for silent re-login |
| Client API token | `rmm_...` sent as `Authorization: Bearer`. | the token |
| Pairing code | 8-digit code from RomM web UI, exchanged on `POST /api/client-tokens/exchange` for a client token (no typing a 68-char token on a gamepad). | the resulting token |

References: [RomM API authentication](https://docs.romm.app/latest/developers/api-authentication/), [RomM client API tokens](https://docs.romm.app/latest/developers/client-api-tokens/).

- `secureStore.cjs` encrypts a JSON blob with AES-256-GCM. The 32-byte key lives in `~/.config/DeckRomM/keys/master.key` (mode 0600) and is mixed with `/etc/machine-id`, so a copied config folder does not decrypt on another machine. The GNOME/KDE keyring (`safeStorage`) is opt-in with `DECKROMM_USE_KEYRING=1` because SteamOS Game Mode has no unlocked keyring and `safeStorage` otherwise silently falls back to a hard-coded key.
- `authedFetch()` handles 401/403: first refresh the OAuth token (or re-login with the remembered password), retry once, and only then emit `auth:required`. The renderer answers that event by opening `LoginOverlay`, which is fully gamepad-driven (A edits a field with the on-screen keyboard, L1/R1 switches method, X tests the server, Start signs in, and "Exit to Steam" is always reachable).
- Verified end-to-end against a mock RomM server: sign in -> relaunch (no prompt, `storage: aes-gcm`) -> token revoked -> refresh fails -> login overlay appears with focus on the username field. No plaintext password or token appears anywhere under the profile directory.

## 2. Gamepad input - `src/services/gamepadService.ts`

- One `requestAnimationFrame` poll loop merges every connected pad (Steam Virtual Gamepad, a USB pad, and so on). It pauses while the window is hidden and resets held state on blur, so no buttons stay "stuck".
- Edge-triggered buttons: A/B/X/Y/Start/Select fire **once per press** (holding A can no longer double-launch a game). Only D-pad / left stick / LT / RT auto-repeat (320 ms initial delay, then 85 ms).
- Left stick uses hysteresis (engage at 0.55, release at 0.35) to stop diagonal jitter. The right stick Y-axis sends analog `SCROLL_UP/DOWN` with a magnitude for smooth scrolling of long text.
- `addListener(cb, priority)` - listeners run from high to low priority and a listener returning `true` consumes the action. This removes the old "every component reacts to every button" conflicts.
- While a native emulator is running, input is suspended (the game owns the controller). Only the in-app web emulator listens for the overlay combo / Guide button.
- Keyboard fallback for Desktop Mode and development: arrows or WASD, Enter/Space = A, Esc/Backspace = B, X / Y keys, Tab or F = Select, M or F1 = Start, Q/E = L1/R1, PageUp/PageDown = L2/R2, V = view toggle. While a text field is focused only Esc, Enter and Up/Down are captured.

| Button | Action |
| --- | --- |
| A | Select / confirm / edit field / launch |
| B | Back / cancel / close modal / leave text field / clear search |
| X | Refresh library (in lists), delete (keyboard), test server (login) |
| Y | Search (opens on-screen keyboard) |
| L1 / R1 | Previous / next platform or tab |
| L2 / R2 | Page up / page down |
| Select (View) | Settings |
| Start (Menu) | Main menu (Exit to Steam lives here) |
| L3 | Toggle grid / list view |
| Right stick | Smooth scroll of the focused scroll container |

## 3. Focus management and container scrolling

`src/services/focusManager.ts` is a single, framework-agnostic spatial navigation engine:

- **Scope stack** - every screen or modal registers a scope (`useFocusScope` / `<FocusScope>`). Only the top scope is navigable, so a modal can never leak focus to the grid behind it. Popping a scope restores the element that was focused before it opened. The main library is a `base` scope that always stays at the bottom, even though React mounts child modals first.
- **Geometric navigation** - picks the nearest `[data-focusable]` in the pressed direction, weighting overlap on the perpendicular axis. Overrides are available: `data-nav-up|down|left|right="<css selector>"`. `data-focus-memory` containers (the grid, the platform bar) remember their last child, so moving up to the header and back down returns you to the same card.
- **Auto scrolling** - every focus change calls `scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })` on the element (`scroll-margin` in CSS keeps the glow and neighbours visible). Held D-pad repeat switches to instant scrolling to avoid smooth-scroll lag. `page()` (L2/R2) jumps a viewport, and `scrollBy()` (right stick) scrolls the nearest `[data-scroll-primary]` container. This covers the game grid, the filter/platform bars, the metadata panel, settings and downloads.
- **Text inputs** - inputs are ordinary focusables. Pressing A on one opens `VirtualKeyboardModal` (text / URL / password / search / pairing-code layouts), and the result is written back through the native value setter so React `onChange` fires. B while typing blurs the field.
- A `MutationObserver` re-homes focus if the focused node is removed (list reload, modal close). Touch and mouse still work: pointerdown syncs the focus ring.
- `useScrollIntoView(ref, active)` and `useGamepadAction(handler, deps, priority)` are the React-side helpers.

## 4. UI at 1280x800

- The window is created at 1280x800 with `zoomFactor = min(width/1280, height/800)` (clamped to 0.75-2.5), so the layout is pixel-exact on the Deck and scales on external displays.
- The grid uses a fixed 6 columns on the Deck (4 columns in "large" mode, 1 in list mode) instead of guessing from `window.innerWidth`, which made D-pad movement skip columns. It renders in batches of 96 with `content-visibility: auto`, and more batches load as you approach the end.
- SteamOS styling (`src/index.css`): dark `#0b0f17` base, `#1a9fff` accent, system font stack (Google Fonts removed so it works offline), 44-48 px touch/focus targets. The focus indicator is a 3 px white outline plus a blue glow; cards also scale by 4.5 % and get a filled blue title bar. Contrast is at least 4.5:1.
- The bottom `ControllerHUD` always shows context-sensitive glyphs (A Open, X Refresh, and so on), switching to key names when the keyboard is used.

## 5. RomM data pipeline (non-blocking)

- `rommApi.ts` loads ROMs with `limit`/`offset` pagination (250 per page) using `platform_id`, `collection_id`, `order_by`, `order_dir` ([RomM API endpoints](https://deepwiki.com/rommapp/romm/4.1-api-endpoints)). The old code sent an unsupported `platform_slug` parameter and stopped at 250 ROMs.
- Each page is mapped in chunks of 60, yielding to the event loop between chunks. State updates are wrapped in `startTransition`, and every load has an `AbortController`, so switching platforms cancels the previous request. The UI stays responsive with libraries of 10k+ ROMs.
- Cover art uses `romm-asset://img/?u=...`: the main process fetches it with the user's credentials, caches it to disk, and streams it back, so thumbnails also work with token-only auth and offline.

## 6. Downloads and game launching

- `DownloadManager` streams `GET /api/roms/{id}/content/{file}` ([RomM downloads](https://docs.romm.app/latest/using/downloads/)) to `<Emulation>/roms/<platform>/<file>.part`, renames it on completion, and emits `rom:progress` (throttled). Downloads can be cancelled. The Emulation root is auto-detected from EmuDeck (internal storage or SD card) or set in Settings.
- `EmulatorManager` resolves the launcher in this order: per-platform override, then custom command, then standalone Flatpak (Dolphin, PCSX2, PPSSPP, Cemu, RPCS3, Ryujinx, Lime3DS), then RetroArch (Flatpak or native) with the matching libretro core. It spawns the emulator **detached in its own process group** with a clean environment (Steam's overlay `LD_PRELOAD` is restored so the Steam overlay works in-game). The Electron window is hidden in Game Mode (minimized on the desktop) and input is suspended while a game runs; the window refocuses when the game exits.
- Stopping a game (overlay button, or app exit) sends SIGTERM to the process group, then SIGKILL after 3 s, plus `flatpak kill <id>` for Flatpak emulators.
- Verified: authenticated download -> launch -> `app.quit()` leaves zero emulator or Electron processes behind.

## 7. Exit to Steam and Game Mode lifecycle

- **Main menu -> Exit to Steam** (red, last item, also on the login overlay) -> `window.deckromm.app.quit()` -> IPC `app:quit` -> `shutdown()`.
- `shutdown()` (idempotent, 4 s hard deadline): notify the renderer (`app:shutting-down` stops the gamepad poll loop and releases the controller), kill running games, abort downloads, flush the config and secure store, destroy windows, then `app.exit(0)`. SIGTERM, SIGINT and SIGHUP route through the same path.
- `launch_deckromm.sh` runs the AppImage in its own session (`setsid`), moves `LD_PRELOAD` aside, unsets `LD_LIBRARY_PATH`, falls back to `APPIMAGE_EXTRACT_AND_RUN=1` when FUSE is missing, adds `--gamemode --ozone-platform=x11` under gamescope, and forwards Steam's SIGTERM to the AppImage runtime **and** the Electron main process (the AppImage runtime does not forward signals). It always exits 0, so Steam returns straight to the library.
- A single-instance lock prevents a second copy from starting behind gamescope, which used to cause the black screen on relaunch.
- Verified in a virtual display: SIGTERM -> all processes gone in about 0.2 s. `app.quit()` -> launcher exits 0 with no leftovers.

## 8. IPC surface (`electron/preload.cjs` -> `window.deckromm`)

`app:info`, `app:quit`, `window:toggle-fullscreen`, `config:get|set`, `auth:status|test-server|login-password|login-token|pair|logout`, `romm:request`, `rom:download|cancel|local-status|delete|read`, `emulator:launch|kill|status`, `system:storage|emulation-path|select-directory`. Events: `auth:required`, `rom:progress`, `emulator:state`, `window:focus`, `app:shutting-down`. Every handler checks that the sender is the app's own frame (`app://deckromm`). The legacy `window.deckrommNative` API is still provided for the web emulator.

## 9. Bugs fixed from the original project

1. `launch_deckromm.sh` / `installer.sh` opened a Chrome kiosk pointed at a hard-coded AI Studio preview URL instead of the app.
2. The Electron build called `/api/steamdeck/*` endpoints of an Express server that was not packaged, so native downloads and launches always failed.
3. The password and API token were stored in plaintext `localStorage`, and `webSecurity: false` was set.
4. The server IP `192.168.12.135` was hard-coded.
5. The ROM query used a non-existent `platform_slug` filter and had a 250-ROM cap.
6. Games were launched with untracked `xdg-open` child processes, so they were never killed and left a black screen on exit.
7. `WebEmulatorModal` called hooks conditionally (a React crash when opening or closing).
8. Text inputs, sort and filter controls could not be reached with the D-pad, and the grid column count was guessed from the window width.
9. Holding A repeated SELECT (double launch). The Select+Start combo conflicted with the separate Select and Start bindings.
10. The "recent" sort subtracted date strings (NaN), so the order was random.
11. Google Fonts blocked first paint offline. Build tools were listed in `dependencies`, and `@google/genai`, `express` and `motion` were unused.

## 10. Build and deploy

On a Linux x86_64 PC or on the Deck in Desktop Mode (Konsole):

```bash
# one-time: install bun (user-local, survives SteamOS updates)
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l

cd ~/deckromm
bun install
bun run typecheck             # tsc --noEmit
bun run check:main            # node --check on electron/*.cjs
bun run dev:electron          # Vite dev server + Electron with hot reload (Desktop Mode)

# package
bun run dist:appimage         # = vite build + electron-builder --linux AppImage
#   or: ./build-appimage.sh   (bun, falls back to npm; adds --dir for an unpacked test build)
ls release/                   # DeckRomM-1.1.1-x86_64.AppImage, DeckRomM.AppImage

# smoke test from Desktop Mode
./release/DeckRomM.AppImage --no-sandbox
./release/DeckRomM.AppImage --no-sandbox --gamemode   # simulate Game Mode (fullscreen)

# install for Game Mode
./installer.sh                # -> ~/Applications/DeckRomM/{DeckRomM.AppImage,launch_deckromm.sh}
```

Then add it to Steam once:

1. Steam (Desktop Mode) -> Games -> Add a Non-Steam Game -> pick DeckRomM (or browse to `~/Applications/DeckRomM/launch_deckromm.sh`). Leave Launch Options empty.
2. Return to Game Mode -> DeckRomM -> Controller settings -> choose the **Gamepad** template (not "Keyboard (WASD) and Mouse"), so the app receives real XInput events.
3. Launch it, sign in (pairing code is the fastest with a controller), and use Start -> Exit to Steam to quit.

Logs are written to `~/.local/state/deckromm/launcher.log`, and main-process logs to `~/.config/DeckRomM/logs/`.
Environment switches: `DECKROMM_USE_KEYRING=1` (use the OS keyring), `DECKROMM_APPIMAGE=/path` (launcher override), `VITE_DEV_SERVER_URL` (development).

## 11. 1.1.1 - in-app player fixes

- **Game hidden behind a popup**: the game detail modal (`z-[100]`) stayed open above the player (`z-50`). Starting "Play in app" now closes the detail modal, the player sits at `z-[300]`, and the detail modal reopens 300 ms after you exit (so the button press that confirmed Exit is not delivered to it). `WebEmulatorModal` no longer calls hooks after an early return.
- **Save/load states were placeholders** (only a timestamp was stored). A command bridge inside the EmulatorJS iframe now calls `EJS_emulator.gameManager.getState()` / `loadState()` ([EmulatorJS save states](https://deepwiki.com/EmulatorJS/EmulatorJS/4.1-save-state-management)). Each slot's state bytes and a thumbnail (from the core's own screenshot, taken just before the menu pauses the game) are stored in IndexedDB (`cached_savestates`, key `[gameId, slot]`). The same bridge handles restart, pause while the overlay is open, volume/mute and fast-forward. Autoplay is allowed so games start with sound without a click.
- **HTTP 404 on some NES / N64 downloads**: RomM returns 404 when a ROM's `fs_name` is stale, its file is missing on disk, or extra non-game files are attached ([RomM ROM endpoints](https://deepwiki.com/rommapp/romm/4.1-api-endpoints)). `DownloadManager.openContent()` now looks the ROM up (`GET /api/roms/{id}`), stops with a clear "rescan this platform" message when RomM flags the file as missing, and otherwise retries with the real file name and `file_ids` (game files only), then the per-file endpoint.
- **Menu shortcut hint** is centered on screen, cannot capture input, and hides after 5 seconds.
- **In-game overlay** is one column per tab. Up/Down (Left/Right do the same) moves through every row, A activates, B resumes, X/Y save/load, LB/RB change tabs. Save slots are rows in the Save States tab, and the Quick Menu has an "Active Save Slot" row.

## 12. 1.2.0 - streaming from RomM and cloud sync

### Play from RomM (no local copy)

EmulatorJS always runs on the device (it is a WebAssembly emulator, the same one RomM's web player uses). The difference is where the ROM comes from. In 1.1.x, "Play in app" downloaded the ROM into the Emulation roms folder and IndexedDB first. In 1.2.0:

- The green primary button is **Play from RomM**. The native RetroArch path is now labelled "Download & Play (native)" or "Play offline (native)", and the plain "Download" button is still there for offline play.
- `EJS_gameUrl` is `romm-rom://rom/<id>/<file>?platform=&size=`. The main process handles that privileged scheme (`protocol.handle('romm-rom')` in `electron/main.cjs`). It opens `GET /api/roms/{id}/content/{file}` with the stored credentials, using the same 404 / `file_ids` fallback as downloads (`DownloadManager.openContent`), and pipes the response body into the emulator. The ROM only exists in memory. Nothing is written to the roms folder or IndexedDB. EmulatorJS shows its own progress bar while it fetches the ROM.
- Offline fallback: if RomM cannot be reached and the game was downloaded earlier, the handler serves the local file.

### Save states on the RomM server

`electron/lib/cloudSync.cjs` (main process) and `src/services/cloudSaves.ts` (renderer) talk to RomM's state API ([states endpoint](https://raw.githubusercontent.com/rommapp/romm/master/backend/endpoints/states.py), [frontend client](https://raw.githubusercontent.com/rommapp/romm/master/frontend/src/services/api/state.ts)):

| Action | Request |
| --- | --- |
| List | `GET /api/states?rom_id=` (fallback: `user_states` in `GET /api/roms/{id}`) |
| Upload | `POST /api/states?rom_id=&emulator=`, multipart `stateFile` plus `screenshotFile` |
| Download | the state's `download_path` |
| Delete | `POST /api/states/delete` with `{"states": [ids]}` |

- The five quick slots are saved as `<rom file name> [deckromm-slot-N] [timestamp].state`. After an upload succeeds, older copies of the same slot are deleted, so RomM keeps one state per slot. The newest copy of each slot wins, whether it was made on this Deck or on another device.
- `emulator` is set to the libretro core RomM's own player uses for that platform (gba -> `mgba`, nes -> `fceumm`, snes -> `snes9x`, ...; see `getSupportedEJSCores` in RomM's frontend utils, used by its [EmulatorJS player](https://raw.githubusercontent.com/rommapp/romm/master/frontend/src/views/Player/EmulatorJS/Player.vue)). This lets RomM's web player list and load DeckRomM states, and DeckRomM hides states made with other cores.
- States created in the RomM web player (without a slot tag) appear under the five slots as **From RomM** rows that can only be loaded.
- Every save is written to IndexedDB first. If the upload fails (offline, server error, missing permission), the toast says so, the slot shows "Deck only", and the upload is retried the next time the game is opened. States saved with 1.1.x are uploaded on first open as well.
- Loading a slot that only exists on RomM downloads it, caches it, and restores it. Deleting a slot removes it on the Deck and on RomM.
- The overlay header shows the sync status: "RomM sync on", "Checking RomM...", or "RomM offline: saving on Deck".

### Recently Played

- Starting a game (in-app, when the core starts, or native) calls `PUT /api/roms/{id}/props?update_last_played=true` with body `{"data": {}, "update_last_played": true}`. RomM 5.x reads the query flag and 3.x/4.x read the body ([ROM endpoints](https://raw.githubusercontent.com/rommapp/romm/master/backend/endpoints/roms/__init__.py)). Uploading a state also updates last played on the server.
- A new **Recently Played** tab (after All Games; use L1/R1) lists `GET /api/roms?order_by=last_played&order_dir=desc&last_played=true&limit=30`, the same query RomM's home page uses. The list is per RomM user, so it matches the web UI and every device. Servers that ignore that filter fall back to a full library scan sorted by `rom_user.last_played`.

### Permissions

Password sign-in now requests `assets.write` (uploading states) in addition to `roms.user.write` (last played). If you signed in with an API token or a pairing code, that token needs both scopes. Otherwise saves stay on the Deck and the toast explains why. Signing out and in again after upgrading requests the new scope.

In-game battery saves are synced from 1.3.0 (section 13).

## 13. 1.3.0 - in-game save (SRAM) sync

Games that save by themselves (battery saves, `.srm`) now sync through RomM's save API, the same way RomM's own EmulatorJS player does ([saves endpoint](https://raw.githubusercontent.com/rommapp/romm/master/backend/endpoints/saves.py), [player](https://raw.githubusercontent.com/rommapp/romm/master/frontend/src/views/Player/EmulatorJS/Player.vue)). Save files made on the Deck are visible and usable in RomM's web player, and the reverse.

| Action | Request |
| --- | --- |
| List | `GET /api/saves?rom_id=` (fallback: `user_saves` in `GET /api/roms/{id}`) |
| Upload | `POST /api/saves?rom_id=&emulator=<core>&slot=autosave&autocleanup=true&autocleanup_limit=10&overwrite=true`, multipart `saveFile` named `<rom file name>.srm` plus `screenshotFile` |
| Download | the save's `download_path` |

- Servers with save slots keep the last 10 versions in the `autosave` slot, which is the slot RomM's web player uses. Older servers ignore the slot parameters and overwrite the file by name.
- **Reading and writing SRAM**: an iframe bridge calls `gameManager.getSaveFile(true)` to read it and writes it with `FS.writeFile(getSaveFilePath())` plus `loadSaveFiles()`. These are the same EmulatorJS calls RomM uses. After a save from RomM is written in, the core is reset once, so games that only read their save while booting see it.
- **When a game starts**: the newest compatible save on RomM (same core, e.g. `mgba` for GBA) is compared with what this Deck last synced (IndexedDB store `cached_sram`, DB version 3):
  - RomM newer and the Deck unchanged: RomM's save is loaded ("Loaded your game save from RomM").
  - Deck changed and RomM unchanged: the Deck's save is uploaded.
  - Both changed: the newer one wins. The losing copy is kept on the Deck as a backup (`localStorage` key `deckromm_sram_backup_<romId>`).
  - RomM unreachable: play continues on the Deck's copy.
- **While playing**: the SRAM is checked every 4 seconds. A change that has stayed the same for two checks is stored locally and uploaded, so a half-written save is never sent. Failed uploads retry after 30 seconds and at the next launch.
- **Exit to Library** uploads any save not yet sent, waiting at most 6 seconds. If the app is killed instead, the next launch detects the difference and uploads it.
- **After loading a save state**, the SRAM inside the state becomes the baseline, so restoring a state does not by itself upload an in-game save.
- **Quick Menu row "In-Game Save"**: shows Synced / Deck only / No save yet, and A syncs now.
- **Permission**: uploads need `assets.write`, the same as save states.
- **Test results** (mock RomM, NES test ROM with a battery flag): all of the following passed.
  - A RomM web save was loaded on start.
  - An in-game save was uploaded with the correct query and a screenshot.
  - During a server outage the save was kept as "Deck only" and uploaded on the next launch.
  - A newer save from another device replaced the Deck's copy.
  - A save made just before exiting was uploaded on exit.

## 14. Working on the code in Google AI Studio

- **Project layout**: the project keeps the files AI Studio expects: `metadata.json` and `.env.example` at the root, and `npm run dev` serving on port 3000 with `DISABLE_HMR` respected.
- **What the preview can do**: AI Studio's preview only runs the React renderer in a browser. The Electron main process doesn't run there, so RomM sign-in storage, `romm-rom://` streaming, save and state sync, downloads and RetroArch launching all fall back to their browser stubs. Use the preview for UI work only.
- **Where the app is built**: build and test the AppImage from the repository with `./build-appimage.sh` or `bun run dist:appimage`, not inside AI Studio.
- **Keep the Electron files**: if AI Studio's agent rewrites `package.json`, `vite.config.ts` or `electron/`, check the diff before pushing. Those files are what the Deck build depends on.
