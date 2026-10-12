#!/usr/bin/env bash
# ==============================================================================
# DeckRomM installer for Steam Deck / SteamOS (no root, no read-only FS changes)
# Installs to ~/Applications/DeckRomM and adds a desktop entry.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/Applications/DeckRomM"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  SRC="$(ls -t "$SCRIPT_DIR"/release/DeckRomM-*.AppImage "$SCRIPT_DIR"/DeckRomM-*.AppImage "$SCRIPT_DIR"/DeckRomM.AppImage 2>/dev/null | head -n1 || true)"
fi
if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "No AppImage found. Build one with ./build-appimage.sh, or pass a path: ./installer.sh /path/to/DeckRomM.AppImage" >&2
  exit 1
fi

echo "Installing DeckRomM from: $SRC"
mkdir -p "$DEST" "$APPS_DIR" "$ICON_DIR" "$HOME/Emulation/roms"

install -m 755 "$SRC" "$DEST/DeckRomM.AppImage"
install -m 755 "$SCRIPT_DIR/launch_deckromm.sh" "$DEST/launch_deckromm.sh"
if [[ -f "$SCRIPT_DIR/dist/.build-info.json" ]]; then
  install -m 644 "$SCRIPT_DIR/dist/.build-info.json" "$DEST/.build-info.json"
elif [[ -f "$SCRIPT_DIR/.build-info.json" ]]; then
  install -m 644 "$SCRIPT_DIR/.build-info.json" "$DEST/.build-info.json"
fi
if [[ -f "$SCRIPT_DIR/build/icon.png" ]]; then
  install -m 644 "$SCRIPT_DIR/build/icon.png" "$ICON_DIR/deckromm.png"
fi

sed "s|@LAUNCHER@|$DEST/launch_deckromm.sh|g" "$SCRIPT_DIR/DeckRomM.desktop" > "$APPS_DIR/deckromm.desktop"
chmod 644 "$APPS_DIR/deckromm.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true

cat <<MSG

DeckRomM installed to $DEST

Add it to Game Mode (one time, from Desktop Mode):
  1. Open Steam -> Games -> "Add a Non-Steam Game to My Library..."
  2. Pick "DeckRomM" from the list (or Browse... to $DEST/launch_deckromm.sh)
  3. Leave Launch Options empty.
  4. In Game Mode: DeckRomM -> Controller settings -> choose the "Gamepad" template
     (not "Keyboard (WASD) and Mouse") so the app receives real XInput events.

Logs: ~/.local/state/deckromm/launcher.log
MSG
