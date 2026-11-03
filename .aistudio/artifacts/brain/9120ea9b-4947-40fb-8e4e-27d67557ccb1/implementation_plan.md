# DeckRomM Native Windows Portable EXE & Dual-Platform Architecture

Enable DeckRomM to run natively on Windows as a single standalone portable `.exe` while maintaining 100% feature parity with SteamOS Game Mode, keeping both platforms synchronized in a single GitHub repository.

## User Review & Critical Decisions Confirmed

> [!IMPORTANT]
> The following user preferences were confirmed during planning clarification:
> - **In-Place Updating Mechanism**: Git in-place pull and rebuild matching SteamOS (`git pull` + `npm install` + `npm run build` with automatic detached restart).
> - **Release Packaging Format**: Single portable standalone EXE without installation (`portable` target via `electron-builder`, producing `DeckRomM-<version>-portable.exe`).
> - **Emulation & ROM Directory Structure**: EmuDeck for Windows directory layout (`C:\Emulation` or custom drive like `D:\Emulation`, with standard subdirectories: `\roms\<platform>`, `\bios`, `\saves`, and `\tools`).
> - **Unified GitHub Repository**: Single shared codebase with platform-aware abstraction layers, packaged via a dual-platform GitHub Actions workflow releasing both Linux AppImage and Windows Portable EXE.

---

## 1. Architecture & Platform Abstraction

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DeckRomM Unified React Frontend                     │
│     (1280x800 Handheld / PC Controller & Keyboard First Navigation)    │
│                                                                        │
│  ┌───────────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Library / Game View   │  │ SettingsScreen   │  │ AppUpdateModal  │  │
│  │ (RomM Sync, Art, RA)  │  │ (Drive Selector) │  │ (In-place Git)  │  │
│  └───────────┬───────────┘  └────────┬─────────┘  └────────┬────────┘  │
└──────────────┼───────────────────────┼─────────────────────┼───────────┘
               │                       │                     │
               ▼                       ▼                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Platform-Agnostic Bridge & IPC Layer                  │
│       (Normalized IPC Contracts: `window.deckromm.*`, `platform`)      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌──────────────────────────────────┐        ┌──────────────────────────────────┐
│   SteamOS / Linux Subsystem      │        │    Windows Native Subsystem      │
│   (process.platform === 'linux') │        │    (process.platform === 'win32')│
├──────────────────────────────────┤        ├──────────────────────────────────┤
│ • Root: ~/Emulation or SD card   │        │ • Root: C:\Emulation or D:\Emu.. │
│ • Emulators: Flatpak & AppImage  │        │ • Emulators: .exe & .bat binaries│
│   (net.pcsx2.PCSX2, RetroArch)   │        │   (tools\pcsx2\pcsx2-qt.exe)     │
│ • Process: kill(-pgid) POSIX grp │        │ • Process: taskkill /T /F tree   │
│ • Update: git + npm + bash/exec  │        │ • Update: git.exe + npm.cmd      │
│ • Packaging: AppImage x86_64     │        │ • Packaging: Single Portable EXE │
└──────────────────────────────────┘        └──────────────────────────────────┘
```

---

## 2. Proposed Changes & Implementation Strategy

### A. Windows Emulation & Path Resolution (`electron/lib/emulation.cjs`)
1. **Windows EmuDeck Path Resolver**:
   - Detect platform via `process.platform === 'win32'`.
   - Default Windows root: `C:\Emulation` (or scan candidate drive letters `C:`, `D:`, `E:`, `F:`, `G:` for `\Emulation`).
   - Standard Windows subdirectories:
     - ROMs: `<root>\roms\<platform>` (e.g. `C:\Emulation\roms\ps2`)
     - BIOS: `<root>\bios` (e.g. `C:\Emulation\bios`)
     - Saves/States: `<root>\saves` (e.g. `C:\Emulation\saves`)
     - Tools: `<root>\tools` (e.g. `C:\Emulation\tools`)
2. **Windows Standalone Emulator & RetroArch Discovery**:
   - Query both EmuDeck Windows launchers and standard install paths:
     - **RetroArch**: `<root>\tools\launchers\retroarch.bat`, `<root>\tools\retroarch\retroarch.exe`, or `%APPDATA%\RetroArch\retroarch.exe`.
     - **PCSX2**: `<root>\tools\pcsx2\pcsx2-qt.exe`, `<root>\tools\launchers\pcsx2.bat`, or `%LOCALAPPDATA%\Programs\PCSX2\pcsx2-qt.exe`.
     - **DuckStation**: `<root>\tools\duckstation\duckstation-qt-x64-ReleaseLTCG.exe`.
     - **Dolphin**: `<root>\tools\dolphin\Dolphin.exe` or `<root>\tools\launchers\dolphin.bat`.
     - **RPCS3**: `<root>\tools\rpcs3\rpcs3.exe`.
     - **Xemu**: `<root>\tools\xemu\xemu.exe`.
     - **Cemu**: `<root>\tools\cemu\Cemu.exe`.
     - **Xenia**: `<root>\tools\xenia\xenia_canary.exe` or `xenia.exe`.
     - **Ryujinx**: `<root>\tools\ryujinx\Ryujinx.exe`.
3. **Cross-Platform Process Lifecycle**:
   - On Linux/SteamOS: Spawn with `detached: true` and terminate via `process.kill(-pgid, 'SIGTERM')`.
   - On Windows: Windows does not support POSIX process group signals. Spawn with `detached: false` (or job object) and terminate cleanly using `taskkill /pid <PID> /T /F` to terminate the entire process hierarchy.
   - Window Focus & Visibility: When a game launches on Windows, minimize or hide DeckRomM; upon game exit (or emulator exit code), restore and focus DeckRomM window.

### B. In-Place App Updating on Windows (`electron/lib/appUpdater.cjs`)
1. **Tooling & Environment Detection**:
   - Locate `git.exe` and `npm.cmd` via Windows `PATH`, `%ProgramFiles%\Git\bin\git.exe`, `%LOCALAPPDATA%\Programs\Git\bin\git.exe`, and `%APPDATA%\npm\npm.cmd`.
2. **Git In-Place Upgrade Flow on Windows**:
   - Fetch remote updates: `git fetch origin main`.
   - Reset working tree: `git reset --hard origin/main`.
   - Re-install dependencies: `npm.cmd install --no-audit --prefer-offline`.
   - Re-build UI: `npm.cmd run build`.
3. **Detached Relaunch on Windows**:
   - On Linux, DeckRomM respawns using `nohup` or `app.relaunch()`.
   - On Windows, execute `cmd.exe /c start "" "<exePath>"` or `powershell.exe Start-Process` detached before `app.quit()` to avoid file locking on the running executable.

### C. Storage & Settings Screen (`src/components/SettingsScreen.tsx`)
1. **Drive & Emulation Directory Picker**:
   - When running on Windows, show detected drive letters (`C:`, `D:`, `E:`, etc.) with quick buttons to select the EmuDeck root (`C:\Emulation`, `D:\Emulation`).
   - Display active platform indicator (`Windows 11 / 10 Native` or `SteamOS Game Mode`).
2. **Directory & Path Normalization**:
   - Ensure all paths handle Windows backslashes (`\`) or forward slashes (`/`) transparently without double-escaping bugs.

### D. Packaging & GitHub Actions CI/CD (`package.json`, `electron-builder.json`, `.github/workflows/build.yml`)
1. **Build Configuration**:
   - Configure `electron-builder.json` with a dedicated `win` target:
     ```json
     "win": {
       "target": [
         {
           "target": "portable",
           "arch": ["x64"]
         }
       ],
       "executableName": "DeckRomM",
       "artifactName": "DeckRomM-${version}-Windows-Portable.${ext}"
     }
     ```
   - Add npm scripts to `package.json`:
     - `"dist:win:portable": "npm run build && electron-builder --config electron-builder.json --win portable"`
     - `"dist:all": "npm run build && electron-builder --config electron-builder.json --linux AppImage --win portable"`
2. **Automated Dual-Platform GitHub Actions Workflow** (`.github/workflows/build.yml`):
   - Triggers on GitHub Releases, tags (`v*`), or manual workflow dispatch.
   - Matrix builds:
     - **ubuntu-latest**: Generates Linux AppImage (`DeckRomM-1.3.0-x86_64.AppImage`) for Steam Deck.
     - **windows-latest**: Generates Windows Portable EXE (`DeckRomM-1.3.0-Windows-Portable.exe`).
   - Automatically attaches both artifacts to the GitHub Release.

---

## 3. Verification Plan

### Automated Verification
1. `npm run typecheck` (`tsc --noEmit`): Verify all TypeScript typings compile without errors.
2. `npm run check:main`: Verify all Electron main process scripts (`main.cjs`, `appUpdater.cjs`, `emulation.cjs`, `configStore.cjs`) pass syntax checks with `node --check`.
3. `npm run build`: Verify Vite production compilation passes cleanly.

### Manual & Runtime Verification
1. Verify platform detection in `SettingsScreen` (displays Windows drive paths when `platform === 'win32'`).
2. Verify process termination logic simulates `taskkill /T /F` on Windows and `process.kill(-pgid)` on Linux.
3. Verify emulator path resolution properly locates both EmuDeck Windows layouts and RetroArch.
4. Verify `.github/workflows/build.yml` syntax and actions matrix for multi-platform build success.
