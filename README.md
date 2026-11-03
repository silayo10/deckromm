# DeckRomM

Controller-first client for a self-hosted [RomM](https://romm.app) server, built for the Steam Deck (1280x800) and SteamOS Game Mode.
Electron 44 + React 19 + TypeScript + Vite, packaged as a Linux AppImage.

- Sign in with username/password, an `rmm_` client API token, or an 8-digit pairing code. Credentials are stored AES-256-GCM encrypted.
- Works 100% with the controller: D-pad/stick navigation, an on-screen keyboard for every field, and auto-scrolling lists.
- Downloads ROMs into your EmuDeck folders and launches RetroArch or standalone emulators. Exit to Steam shuts down cleanly.

## Quick start

### Steam Deck / Linux (SteamOS Game Mode)

```bash
curl -fsSL https://bun.sh/install | bash && exec $SHELL -l   # once
bun install
bun run dev:electron        # development (Desktop Mode)
./build-appimage.sh         # -> release/DeckRomM-<version>-x86_64.AppImage
./installer.sh              # -> ~/Applications/DeckRomM + desktop entry
```

Then add `~/Applications/DeckRomM/launch_deckromm.sh` to Steam as a Non-Steam Game and pick the Gamepad controller template.

### Windows 10 / 11 (PC Standalone Portable EXE)

```cmd
git clone https://github.com/silayo10/deckromm.git
cd deckromm
npm install
npm run dev:electron        # run in dev mode with controller/keyboard
npm run dist:win:portable   # -> release/DeckRomM-<version>-Windows-Portable.exe
```

- **Portable EXE**: Runs anywhere without installation. Double-click to start.
- **EmuDeck for Windows**: Automatically detects `C:\Emulation` or secondary drives (`D:\Emulation`, etc.) and tools (`retroarch.exe`, `pcsx2-qt.exe`, `Dolphin.exe`, `rpcs3.exe`, `xemu.exe`, `Ryujinx.exe`).
- **In-Place Updates**: Upgrades in place using `git pull` and automatic relaunch, matching SteamOS feature-for-feature.

### Automated GitHub Releases (Both Platforms)

Tagging a release (`git tag v1.3.0 && git push origin v1.3.0`) triggers the GitHub Actions workflow to automatically compile and publish both:
1. `DeckRomM-1.3.0-x86_64.AppImage` (for Steam Deck / SteamOS)
2. `DeckRomM-1.3.0-Windows-Portable.exe` (for Windows 10 / 11 PC)

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design, button map, IPC surface and full build/deploy guide.
