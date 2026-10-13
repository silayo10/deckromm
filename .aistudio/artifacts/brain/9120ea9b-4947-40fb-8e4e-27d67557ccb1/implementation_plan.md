# DeckRomM Platform Expansion, PS2 BIOS Auto-Sync & Search Bar Cleanup

Enhance DeckRomM by supporting all major retro and modern emulation platforms, automating BIOS firmware retrieval from RomM for the PS2 emulator (PCSX2) and other systems, and streamlining the search/filter toolbar by removing the redundant "Hide JP" button.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following user preferences were confirmed during clarification:
> - **Platform Expansion Scope**: Include all major emulation platforms supported by EmuDeck and RetroArch / standalone flatpaks (Sega Dreamcast, Sega Saturn, Sony PSP, Sony PS3, Nintendo Wii, Nintendo 3DS, Nintendo Switch, Arcade / Neo-Geo / MAME, Sega CD, Game Boy / Color, and TurboGrafx-16).
> - **BIOS Pulling Strategy**: Implement dual-mode syncing: automatically detect and pull missing BIOS files from RomM when a game is downloaded or launched, while also providing a dedicated one-click "Sync All Server BIOS" button in the BIOS Manager modal.
> - **Search Filter Bar Refinement**: Remove the redundant standalone `🇯🇵 Hide JP` chip from the quick filter row in `SearchFilterBar.tsx`, relying exclusively on the multi-option `LanguagePickerModal` (`Globe` button) which already includes the `no-ja` ("Hide Japanese ROMs") filter option.

---

## 1. Overview & Core Concept

- **What It Delivers**:
  1. **Comprehensive Platform Catalog**: Full coverage across classic and modern consoles with proper libretro core associations, standalone flatpak fallback mappings, file extensions, and UI theme accents.
  2. **Automated & Manual BIOS Provisioning**: Robust RomM firmware endpoint ingestion (supporting both direct JSON arrays and `{ items: [...] }` paginated responses) that deploys BIOS files directly to both `~/Emulation/bios` (EmuDeck standard) and standalone emulator configuration directories (PCSX2 flatpak config & data directories).
  3. **Clean Handheld Filter Bar**: Streamlined filter bar layout without redundant Japanese filter toggles, maximizing screen space for quick genre chips on the Steam Deck's 1280x800 display.
- **Target Audience / Persona**: Steam Deck users running DeckRomM in Game Mode wanting seamless out-of-the-box emulation without manually navigating Linux desktop folders to copy BIOS or configure unrecognized platforms.
- **Key Value**: PS2 games (and other BIOS-dependent platforms) work on the first click because DeckRomM guarantees the correct BIOS is synchronized to PCSX2 before launch.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **PS2 / BIOS-Dependent Game Launch & Download**:
   - User navigates to a PlayStation 2 (or Dreamcast / PS1 / Saturn / Xbox) game card and presses **A** (Play / Download).
   - Before spawning PCSX2 or starting the ROM download, DeckRomM inspects local BIOS directories (`~/Emulation/bios` and `~/.var/app/net.pcsx2.PCSX2/data/PCSX2/bios`).
   - If missing, DeckRomM queries RomM's `/api/firmware` endpoint, matches available firmware entries by platform (`ps2`, `sony-playstation-2`, etc.) and filename patterns (`scph*.bin`), downloads them in the background, copies them to the emulator's BIOS folder, and issues a subtle notification (`"Synchronized PS2 BIOS to PCSX2"`).
   - The game launches smoothly without PCSX2 throwing a missing BIOS error screen.

2. **One-Click Manual BIOS Sync in BIOS Manager**:
   - User opens the **BIOS & Firmware Manager** from Settings or Quick Menu.
   - A prominent **"Sync All Server BIOS"** action button allows downloading all missing firmware files from RomM with a single press, showing progress indicators per file.

3. **Streamlined Filter Bar**:
   - The secondary filter row displays `Lang: [Current]` (opens `LanguagePickerModal`), followed by `Genre: [Current]`, `All Genres`, and quick genre chips (`RPG`, `Action`, etc.).
   - The extra `🇯🇵 Hide JP` chip is cleanly removed, preventing visual clutter and redundant state.

### Visual Identity & Theme
- Handheld-optimized Steam Deck UI tokens: `#1a1f2c` deep slate backgrounds, `#0ea5e9` sky accent highlights, `border-deck-line` dividers.
- High-contrast focused states with zero layout shifting.
- Clean typography and metadata presentation without pills or clipped text.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Dual-Mode BIOS Retrieval (Auto-Check on Launch + Manual Sync)
- **Chosen Approach**: When launching or downloading a game for any platform requiring BIOS (PS2, PS1, Dreamcast, Saturn, Sega CD, Xbox), trigger an asynchronous pre-flight check. If the required local BIOS files are absent, fetch them from RomM's firmware catalog and deploy to emulator folders before booting. Additionally, expose a manual "Sync All" action in `BiosManagerModal`.
- **Why**: Eliminates the most common failure mode in handheld emulation (launching a PS2 game only for PCSX2 to fail with "No BIOS found"). Users don't need to manually know which SCPH file PCSX2 requires.
- **Alternatives Considered**: Only relying on manual downloading in the modal was confusing because users expected RomM to automatically supply firmware when available.

### Decision 2: RomM API Firmware Normalization
- **Chosen Approach**: Enhance RomM firmware retrieval in both `rommApi.ts` and `biosManager.cjs` to handle all RomM API versions: direct JSON array responses `[...]`, paginated `{ items: [...], total: ... }` responses, and nested `{ data: [...] }` envelopes. Match platform identifiers flexibly using slug variations (`ps2`, `playstation-2`, `sony-playstation-2`) and common filename patterns (`/scph|ps2/i`).
- **Why**: RomM versions 3.x, 4.x, and 5.x have minor schema variations. Normalizing ensures compatibility across all server setups.

### Decision 3: Expanded Platform Core & Folder Mappings
- **Chosen Approach**: Add full configurations in `emulation.cjs`, `rommData.ts`, and `types.ts` for:
  - **Sega Dreamcast** (`flycast` / `Flycast` flatpak)
  - **Sega Saturn** (`mednafen_saturn` / `yabasanshiro`)
  - **Sony PSP** (`ppsspp` / `PPSSPP` flatpak)
  - **Sony PS3** (`rpcs3` / `RPCS3` flatpak)
  - **Nintendo Wii** (`dolphin` / `Dolphin` flatpak)
  - **Nintendo 3DS** (`lime3ds` / `Lime3DS` flatpak)
  - **Nintendo Switch** (`ryujinx` / `Ryujinx` flatpak)
  - **Arcade / Neo Geo / MAME** (`fbneo`, `mame`, `mame2003_plus`)
  - **Sega CD & 32X** (`genesis_plus_gx`, `picodrive`)
  - **Game Boy & Game Boy Color** (`gambatte`, `sameboy`)
  - **TurboGrafx-16 / PC Engine** (`mednafen_pce_fast`)
- **Why**: Users with varied RomM collections have ROMs that currently appear without dedicated icons, proper EmuDeck folder mapping, or automatic emulator resolution.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                          DeckRomM Client UI                            │
│                                                                        │
│  ┌──────────────────────┐  ┌─────────────────┐  ┌───────────────────┐  │
│  │ SearchFilterBar      │  │ GameDetailModal │  │ BiosManagerModal  │  │
│  │ (Language & Genres)  │  │ (Play/Download) │  │ ("Sync All BIOS") │  │
│  └──────────┬───────────┘  └────────┬────────┘  └─────────┬─────────┘  │
└─────────────┼───────────────────────┼─────────────────────┼────────────┘
              │                       │                     │
              ▼                       ▼                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Services & Bridge Layer                         │
│                                                                        │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ rommApi.ts           │  │ bridge.ts                              │  │
│  │ - Normalized Firmware│  │ - bios.status() / bios.download()      │  │
│  │ - Paged Firmwares    │  │ - bios.syncForPlatform()               │  │
│  └──────────┬───────────┘  └────────────────────┬───────────────────┘  │
└─────────────┼───────────────────────────────────┼──────────────────────┘
              │                                   │
              ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                            │
│                                                                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ BiosManager (biosManager.cjs)                                     │  │
│  │ - checkStatus() & listLocalBios()                                 │  │
│  │ - download() -> atomic stream -> deploys to:                      │  │
│  │     • ~/Emulation/bios/                                           │  │
│  │     • ~/.var/app/net.pcsx2.PCSX2/data/PCSX2/bios/ (PCSX2)         │  │
│  │     • ~/.config/PCSX2/bios/ (PCSX2 native)                        │  │
│  │     • ~/.var/app/org.libretro.RetroArch/config/retroarch/system/ │  │
│  │ - syncPlatformBios(platformSlug) auto-check helper                │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
│                                    │                                    │
│  ┌─────────────────────────────────┴─────────────────────────────────┐  │
│  │ EmulatorManager (emulation.cjs)                                   │  │
│  │ - Pre-launch BIOS check hook before spawning emulator             │  │
│  │ - Expanded PLATFORM_FOLDERS, LIBRETRO_CORES & STANDALONE emulators │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Component & State Modifications
1. **`SearchFilterBar.tsx`**:
   - Remove the `🇯🇵 Hide JP` button and associated props (`japaneseCount`).
   - Clean up spacing so `LanguagePickerModal` trigger and genre quick chips align neatly.
2. **`BiosManager.cjs` & `main.cjs`**:
   - Add `bios:sync-platform` IPC handler to check if local BIOS exists for a given platform slug (e.g. `ps2`), and if missing, fetch matching firmware items from RomM.
   - Ensure target copy logic writes to all known PCSX2 directories (`.var/app/net.pcsx2.PCSX2/data/PCSX2/bios`, `.var/app/net.pcsx2.PCSX2/config/PCSX2/bios`, `.config/PCSX2/bios`, and `~/Emulation/bios/ps2`).
3. **`rommApi.ts`**:
   - Fix `getFirmware` to accept arrays or `{ items: [...] }` from `/api/firmware`.
   - Add `syncBiosForPlatform(platformSlug)` called before game launch or download.
4. **`BiosManagerModal.tsx`**:
   - Add a "Sync All from RomM" button that downloads all uninstalled firmware items in one go.
5. **Platform catalog expansion (`rommData.ts`, `types.ts`, `emulation.cjs`)**:
   - Add full metadata, cores, extensions, and folder paths for Dreamcast, Saturn, PSP, PS3, Wii, 3DS, Switch, Sega CD, Game Boy, TG-16, and Arcade.
