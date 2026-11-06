# DeckRomM 🎮

[![SteamOS](https://img.shields.io/badge/SteamOS-3.x%20%7C%20Arch%20Linux-1a9fff?logo=steam&logoColor=white)](https://store.steampowered.com/steamos)
[![Target Display](https://img.shields.io/badge/Target%20Display-1280x800%20(16%3A10)-00d26a)](https://www.steamdeck.com)
[![RomM](https://img.shields.io/badge/RomM%20Server-v3%20%7C%20v4%20%7C%20v5-blue)](https://romm.app)
[![Version](https://img.shields.io/badge/Version-1.3.0-orange)](https://github.com)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)

**DeckRomM** is a native, controller-first client for your self-hosted [RomM](https://romm.app) retro gaming library, built specifically for the **Steam Deck (1280×800 Gamescope compositor in Game Mode)** and **SteamOS**.

Packaged as a lightweight, zero-dependency Linux **AppImage** with an atomic in-place updater, DeckRomM turns your Steam Deck into the ultimate handheld retro portal.

---

## ✨ Features at a Glance

### 🕹️ 100% Controller-First Navigation
- **Zero Mouse/Keyboard Required**: Designed exclusively for handheld controller navigation (D-Pad, Left Stick, Face Buttons).
- **Geometric Spatial Focus Engine**: Every screen, menu, and modal has an active, clearly highlighted focus state upon opening. No hidden focus, no mouse hover requirements.
- **Integrated On-Screen Virtual Keyboard**: Full-featured gamepad keyboard for searching, server URLs, passwords, and pairing codes with rapid D-pad traversal and cursor actions.
- **Context-Sensitive Controller HUD**: Displays dynamic glyph hints on every screen (`(A) Play`, `(B) Back`, `(X) Refresh / Reroll`, `(Y) Search / Details`, `(L1/R1) Switch Systems`, `(L2) Quick Filters`, `(R2) Jump to Letter`).

### 🛡️ Cloud & Local Save Manager • RPG Backup Vault
- **Live Save Comparison**: Compares your Steam Deck local battery saves (`.srm`, `.sav`) against RomM server saves with timestamp and file-size diffing.
- **Visual Sync Status**:
  - 🟢 `Cloud & Local in Sync` (within 5 seconds)
  - 🟡 `Local Save is Newer` (ready to push to server)
  - 🔵 `RomM Cloud is Newer` (save available from another device or web player)
  - 🟠 `Saved Locally Only` / `Cloud Save Available`
- **1-Click Sync**: Upload local saves to RomM or pull down the newest cloud save with a single button press.
- **5-Slot Rotating RPG Backup Vault**:
  - Automatically or manually captures timestamped snapshots before major battles or sync events (*"Before Final Boss"*, *"Chapter 4 Start"*).
  - **1-Click Rollback**: Restores an earlier save if emulator state corruption or bad saving occurs, keeping a safety snapshot of the overwritten save so no progress is ever lost.

### ⚡ Steam Deck Battery & TDP Profile Optimizer
- **Tailored Per-Platform Power Capping**:
  - 🟢 **Ultra-Low Power (3W–5W TDP)** (*NES, SNES, GBA, Genesis, GB, GBC*):
    - **~7.5–9.0 hrs (LCD Deck) / ~9.0–11.5 hrs (OLED Deck)**
    - Target: 60 FPS @ 60Hz, 400 MHz GPU.
  - 🔵 **Balanced Efficiency (6W–8W TDP)** (*PS1, N64, NDS, Saturn*):
    - **~5.0–6.5 hrs (LCD) / ~6.5–8.0 hrs (OLED)**
    - Target: 60 FPS @ 60Hz, 600–800 MHz GPU, supports 2x/3x resolution scaling.
  - 🟡 **Performance Mode (9W–11W TDP)** (*PS2, GameCube, Dreamcast, PSP*):
    - **~3.5–4.5 hrs (LCD) / ~4.5–5.5 hrs (OLED)**
    - Target: 60 FPS @ 60Hz (or 40 FPS @ 40Hz).
  - 🟣 **High Power (12W–15W Full APU)** (*PS3, Xbox, Switch*).
- **Interactive Quick Access Guide**: In-game step-by-step Gamescope Quick Access Menu (`...` button) instructions showing how to lock TDP and save per-game profiles in seconds.

### 🎲 "Surprise Me!" Random Game Picker
- Cures library paralysis on collections with 1,000+ games.
- Retro slot-machine roulette animation with mechanical audio ticks (`soundService.playTick()` → `soundService.playSuccess()`).
- Shows 3D cover art, release year, platform badge, summary, and offline status.
- Gamepad shortcuts: **(A)** Launch immediately, **(X)** Reroll / spin again, **(Y)** View details, **(B)** Dismiss.
- Accessible from the Top Filter Bar (`#filter-random-game`), Quick Filter Drawer (`L2`), and Main Menu (`START`).

### ⏱️ Pause-Immune Playtime Tracker
- Records total active playtime locally on the Steam Deck.
- **Strictly excludes paused and suspended time** when you leave a game paused or sleep the Steam Deck.
- Displays hours and minutes in Game Details and syncs playtime records to your RomM server.

### 📦 Seamless Multi-Disc & File Carousel
- Automatically detects multi-disc releases (PS1, Dreamcast, Saturn, Sega CD e.g. *Final Fantasy VII/VIII/IX*, *Metal Gear Solid*, *Shenmue*).
- 1-click active boot target selection (`Disc 1`, `Disc 2`, `Disc 3`) without manually renaming files or editing playlists.

### 💾 Storage & Offline Deck Mode
- Toggle **Offline Deck Mode** (`L2` or Main Menu) to instantly filter the library to only downloaded, local ROMs playable on airplanes, trains, or off-grid.
- **Storage Manager**: Visual breakdown of Internal SSD vs. MicroSD card free space with batch deletion and ROM management.

### 🛠️ Built-in ROM Hacks & Patcher
- Integrated IPS, BPS, and UPS patcher to apply fan translations, color hacks, and randomizers directly on your Steam Deck without needing a desktop PC.

### 🚀 Standalone Emulators & EmuDeck Integration
- Native compatibility with EmuDeck folder structures (`~/Emulation/roms/` and `~/Emulation/saves/`).
- Supports RetroArch libretro cores and standalone Flatpaks (PCSX2, DuckStation, Dolphin, PPSSPP, xemu).
- 1-click installer and launcher for missing standalone emulators.

### 🔄 Atomic In-Place Upgrades in SteamOS Game Mode
- Self-updating AppImage: Checks for new GitHub releases from inside the UI (`Settings` -> `Check for Updates`).
- Uses atomic file replacement (`install -m 755 "$SRC" "$DEST.new" && mv -f "$DEST.new" "$DEST"`) to avoid Linux `ETXTBSY (Text file busy)` errors while running.
- Canonical shortcut preservation: Maintains `DeckRomM-1.3.0-x86_64.AppImage` and `DeckRomM.AppImage` symlinks so your Steam Non-Steam Game shortcut never breaks after an update!

---

## 📥 Installation on Steam Deck

### Method 1: Automated 1-Line Install (Recommended)

1. Switch your Steam Deck to **Desktop Mode** (*Power -> Switch to Desktop*).
2. Open **Konsole** (terminal) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/tonydancestudiom/deckromm/main/installer.sh | bash
```

The installer will:
- Download the latest `DeckRomM-1.3.0-x86_64.AppImage` into `~/Applications/DeckRomM/`.
- Create the launcher wrapper (`launch_deckromm.sh`) configured for Gamescope.
- Create desktop shortcuts and set up executable permissions.

3. Open the **Steam** desktop client:
   - Click **Games** -> **Add a Non-Steam Game to My Library...**
   - Click **Browse...** and select:
     ```
     /home/deck/Applications/DeckRomM/launch_deckromm.sh
     ```
   - (Or select `DeckRomM` if it appears in the list).
   - In Steam, right-click the shortcut -> **Properties**:
     - Change the title to **DeckRomM**.
     - Set the icon from `/home/deck/Applications/DeckRomM/icon.png`.
4. Switch back to **Game Mode** (*Return to Gaming Mode*).
5. In Game Mode, open **DeckRomM** -> Controller Settings:
   - Select the **Gamepad** controller layout (default template).

---

### Method 2: Manual AppImage Download

1. Download `DeckRomM-1.3.0-x86_64.AppImage` from the [Releases](https://github.com/tonydancestudiom/deckromm/releases) page.
2. Place it in `~/Applications/DeckRomM/DeckRomM.AppImage`.
3. Make it executable:
   ```bash
   chmod +x ~/Applications/DeckRomM/DeckRomM.AppImage
   ```
4. Add it to Steam as a Non-Steam Game.

---

## 🎮 Controller Layout & Button Mapping

| Button | Primary Action in Library | Action in Modals & Screens |
| :--- | :--- | :--- |
| **A** | Confirm / Select / Open Game | Play Game / Launch / Submit |
| **B** | Back / Clear Search / Close | Close Modal / Cancel / Dismiss |
| **X** | Refresh Library / Retry | Reroll Roulette / Delete in Keyboard / Test Auth |
| **Y** | Search (Opens On-Screen Keyboard) | Game Details / View Metadata |
| **D-Pad / Left Stick** | 4-way Spatial Grid Navigation | Navigate Focusable Buttons & Tabs |
| **Right Stick (Y-axis)** | Smooth Scroll Active View | Scroll Long Text & Summaries |
| **L1 / R1** | Previous / Next Platform Tab | Switch Sub-Tabs (e.g. Auth methods) |
| **L2** | Open **Quick Filter Drawer** | Page Up / Jump letters |
| **R2** | Open **Letter Jump Navigation** | Page Down |
| **SELECT (View)** | Open **Settings Screen** | Storage & Configuration |
| **START (Menu)** | Open **Main Menu** (Exit to Steam) | Dismiss Menu |

---

## 🌐 Connecting to Your RomM Server

DeckRomM supports all three standard RomM authentication methods:

1. **Client API Token (`rmm_...`)** *(Recommended)*:
   - In your RomM web UI, go to *Settings -> Client API Tokens -> Generate Token*.
   - Copy or enter your `rmm_...` token into DeckRomM.
2. **8-Digit Quick Pairing Code**:
   - In RomM web UI, click *Pair Client* to generate a short 8-digit code.
   - Enter the code in DeckRomM for instant pairing without typing long tokens on a gamepad.
3. **Username & Password**:
   - Standard RomM account credentials. DeckRomM securely negotiates OAuth2 access/refresh tokens.
   - Encrypted with AES-256-GCM locally via `~/.config/DeckRomM/keys/master.key`.

---

## 🔋 Recommended Steam Deck TDP Settings

When launching games from DeckRomM, press the **(...) Quick Access Button** on the right side of your Steam Deck and navigate to the **Battery tab**:

| Console Platform | Recommended TDP | Target Refresh / FPS | Estimated Battery Runtime |
| :--- | :---: | :---: | :---: |
| **GB / GBC / GBA / NES / SNES / Genesis** | **4W** | 60Hz / 60 FPS | **~8 – 11.5 hours** |
| **PlayStation 1 / N64 / NDS / Saturn** | **7W** | 60Hz / 60 FPS | **~5.5 – 8 hours** |
| **PlayStation 2 / GameCube / Dreamcast / PSP** | **10W** | 60Hz / 60 FPS | **~3.5 – 5.5 hours** |
| **PlayStation 3 / Xbox (xemu) / Switch** | **14W – 15W** | 40Hz or 60Hz | **~2 – 3 hours** |

*Tip: Toggle "Use per-game profile" ON in the Steam Deck Quick Access Menu so Gamescope remembers these power limits every time you play.*

---

## 🛠️ Building from Source

### Prerequisites
- Node.js 20+ or [Bun](https://bun.sh)
- Linux environment (SteamOS or Ubuntu/Debian)

### Build Steps

```bash
# Clone the repository
git clone https://github.com/tonydancestudiom/deckromm.git
cd deckromm

# Install dependencies
npm install  # or bun install

# Run checks
npm run check:main
npm run typecheck

# Build AppImage for Steam Deck
./build-appimage.sh
```

The compiled binary will be placed at:
```
release/DeckRomM-1.3.0-x86_64.AppImage
```

---

## 📜 License

MIT License. Built with ❤️ for the retro gaming and Steam Deck community.
RomM is a project by the [RomM Team](https://romm.app).
