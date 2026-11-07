# DeckRomM Handheld UX & Settings Streamlining (v1.3.0)

## Overview & User Request Alignment
Implemented three core ergonomic and organizational enhancements tailored specifically for SteamOS Gamescope Game Mode on the 1280x800 Steam Deck display:
1. **Details Modal Tab Reorganization**: Reorganized `GameDetailModal.tsx` into 4 handheld-optimized controller tabs (`Overview & Play`, `Saves & Vault`, `Manual & Tools`, `Media & Specs`) navigated with physical bumper shortcuts (`LB`/`RB`).
2. **First Run & Handheld Onboarding Wizard**: Guided 3-step setup modal (`FirstRunWizardModal.tsx`) auto-detecting SteamOS storage & EmuDeck flatpaks, configuring display theme and tactile haptics, and offering one-click RomM server connection, demo library exploration, or local offline mode.
3. **Settings Menu Reorganization & Redundancy Cleanup**: Reordered `SettingsScreen.tsx` into 6 logical categories, eliminated duplicate toggles, grouped physical feedback (audio cues + tactile vibration), and integrated quick launchers for the onboarding wizard and EmuDeck standalone tools.

---

## 1. Details Modal Tab Reorganization (`src/components/GameDetailModal.tsx`)

### Tab Architecture
- Replaced the previous single vertical scrolling container with 4 dedicated, focused views navigated instantly via controller bumpers (`LB` / `RB`, `PAGE_UP` / `PAGE_DOWN`, or `PREV_PLATFORM` / `NEXT_PLATFORM`):
  1. **`Overview & Play`**:
     - Primary play action (`#detail-play-btn`) with active emulator/core indicator.
     - Emulator core selector dropdown card.
     - Favorite toggle and Download / Local status cards.
     - Standalone launcher config (EmuDeck Flatpak launch shortcut).
     - Missing BIOS warnings and system dependency alerts.
     - DeckPowerCard (TDP/GPU clock recommendation and estimated battery runtime).
     - Playtime tracker (sessions, total hours, last played date).
     - Multi-disc carousel (for PS1, PS2, Saturn, Dreamcast multi-disc sets).
     - Story synopsis and developer metadata.
  2. **`Saves & Vault`**:
     - Cloud Save Vault sync status (RomM server save sync).
     - Save state visual timeline with screenshot thumbnails and timestamps.
     - PlayStation 2 PCSX2 memory card slot selector and status.
     - Local ROM storage paths and target drive (SSD / microSD).
     - Local ROM deletion action for freed storage space.
  3. **`Manual & Tools`**:
     - Retro Game Manual & Strategy Guide launch card with direct button shortcut.
     - ROM Hacks & Community Patches launcher card.
     - RetroAchievements badges, points, and unlock timeline panel.
  4. **`Media & Specs`**:
     - High-resolution screenshot gallery preview.
     - Complete technical specifications table (SHA-1 checksum, CRC32, file format, exact file size, release region, language count).
     - Related Games in Series recommendations.

### Controller & Handheld Ergonomics
- Visual tab bar at top of modal displaying current tab index and explicit `LB` / `RB` gamepad hints.
- Sound and tactile haptic feedback on tab changes (`soundService.playTick()`).

---

## 2. First Run & Handheld Onboarding Wizard (`src/components/FirstRunWizardModal.tsx`)

### 3-Step Guided Handheld Flow
- Automatically displayed on initial launch (`rommApi.isFirstLaunch() === true`) and accessible anytime on-demand from the Main Menu (`Item id="menu-wizard"`) and Settings screen.
- **Step 1: Handheld Welcome & Tactile Display**:
  - Theme selection: OLED Pure Black (`#000000`), SteamOS Dark Slate, or Midnight Blue.
  - Tactile Haptics toggle with live "Test Haptic Pulse" button to test Deck actuators immediately.
  - CRT Scanline toggle.
- **Step 2: SteamOS & EmuDeck Auto-Discovery**:
  - Auto-scans `bridge.system.storage()` to locate internal SSD and microSD card paths.
  - Scans for EmuDeck directory (`~/Emulation/roms` or `/run/media/mmcblk0p1/Emulation/roms`).
  - Scans Flathub emulator Flatpaks via `bridge.system.flatpakStatus()` (RetroArch, PCSX2, DuckStation, Dolphin, PPSSPP, Ryujinx, RPCS3, Lime3DS).
- **Step 3: Library Connection Options**:
  - **Option A: Connect RomM Server** (opens gamepad login modal with server URL / username / password or API token).
  - **Option B: Explore Demo Library** (immediately loads offline curated retro sample library).
  - **Option C: Offline Local Mode** (browses local downloaded games already present in EmuDeck folders).

---

## 3. Settings Menu Reorganization & Redundancy Cleanup (`src/components/SettingsScreen.tsx`)

### Streamlined 6-Category Structure
1. **`RomM Server & Connection`**:
   - Server endpoint display and sign-in/sign-out buttons.
   - **Single canonical Offline Mode toggle** (eliminated duplicate toggle previously in Library section).
   - Demo Library Mode toggle.
   - RomM server tasks & scans (Quick scan for new files, Full rescan & metadata refresh).
2. **`Steam Deck Display & Physical Feedback`**:
   - OLED Pure Black, SteamOS Dark, and Midnight Blue theme cards.
   - CRT Retro Scanlines filter switch.
   - **Navigation Sounds & Audio Cues toggle** (moved from Library to Display & Physical Feedback).
   - **Tactile Haptics toggle & intensity selector** (`soft`, `medium`, `strong`).
3. **`Emulation & EmuDeck`**:
   - Emulation root path and directory browser.
   - Launcher mode selector (`auto`, `retroarch`, `custom`) and fullscreen flag.
   - **EmuDeck & Emulator Management Card**: One-click launchers for Standalone Emulators modal, BIOS & Firmware manager modal, and Open BIOS folder in Dolphin file manager.
   - PCSX2 Memory Card Manager embedded card.
   - Platform Default Cores & Overrides list.
4. **`Storage & Offline Library`**:
   - Internal SSD vs microSD storage breakdown and free space telemetry.
   - Downloaded games manager button.
   - Hide BIOS / info files toggle.
   - Download All Offline Covers pre-caching action.
5. **`RetroAchievements`**:
   - Server integration callout banner (explains zero client API key requirement when RomM server is configured).
   - Username and optional Web API key inputs.
   - Hardcore Mode toggle.
   - Auto-Detect from RomM Server and Test Connection actions with status alerts.
6. **`System, Setup & Updates`**:
   - **First-Run Setup Wizard Launcher card** (convenient re-trigger for onboarding).
   - GitHub in-place updates configuration and check button.
   - System Diagnostics card (**cleaned of duplicate Session row** duplicating Platform).

---

## Verification & Build Results
- `compile_applet`: Clean build passed.
- `lint_applet`: `tsc --noEmit` passed with 0 errors.
- Version: Strictly locked to `1.3.0`.
- Handheld Viewport: 1280x800 Gamescope 16:10 aspect ratio.
- Navigation: 100% controller-first with `data-focusable` and D-Pad / Thumbstick / A/B/X/Y/LB/RB bindings.
