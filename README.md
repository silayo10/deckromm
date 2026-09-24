# DeckRomM

Controller-first client for a self-hosted [RomM](https://romm.app) server, built for the Steam Deck (1280x800) and SteamOS Game Mode.
Electron 44 + React 19 + TypeScript + Vite, packaged as a Linux AppImage.

- Sign in with username/password, an `rmm_` client API token, or an 8-digit pairing code. Credentials are stored AES-256-GCM encrypted.
- Works 100% with the controller: D-pad/stick navigation, an on-screen keyboard for every field, and auto-scrolling lists.
- Downloads ROMs into your EmuDeck folders and launches RetroArch or standalone emulators. Exit to Steam shuts down cleanly.

## Quick start

```bash
curl -fsSL https://bun.sh/install | bash && exec $SHELL -l   # once
bun install
bun run dev:electron        # development (Desktop Mode)
./build-appimage.sh         # -> release/DeckRomM-<version>-x86_64.AppImage
./installer.sh              # -> ~/Applications/DeckRomM + desktop entry
```

Then add `~/Applications/DeckRomM/launch_deckromm.sh` to Steam as a Non-Steam Game and pick the Gamepad controller template.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design, button map, IPC surface and full build/deploy guide.
