#!/usr/bin/env bash
# ==============================================================================
# DeckRomM launcher for SteamOS Game Mode
#
# Add THIS script (or ~/Applications/DeckRomM/launch_deckromm.sh after running
# installer.sh) to Steam as a Non-Steam Game. Leave Launch Options empty.
#
# What it does:
#  - finds the AppImage next to it (or in ~/Applications)
#  - moves Steam's overlay LD_PRELOAD aside so Chromium does not crash; the
#    app restores it for emulators it launches so the Steam overlay still works
#  - falls back to extract-and-run when FUSE is unavailable
#  - forwards SIGTERM/SIGINT (Steam "Exit game") to the whole process group and
#    waits, so no orphan emulator or black screen is left behind
# ==============================================================================
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/deckromm"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/launcher.log"
: > "$LOG"
log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG"; }

# ---- locate the binary ------------------------------------------------------
find_app() {
  local c
  for c in \
    "${DECKROMM_APPIMAGE:-}" \
    "$DIR/DeckRomM.AppImage" \
    "$(ls -t "$DIR"/DeckRomM-*.AppImage 2>/dev/null | head -n1)" \
    "$(ls -t "$DIR"/release/DeckRomM-*.AppImage 2>/dev/null | head -n1)" \
    "$HOME/Applications/DeckRomM/DeckRomM.AppImage" \
    "$HOME/Applications/DeckRomM.AppImage" \
    "$DIR/release/linux-unpacked/deckromm"; do
    if [[ -n "$c" && -f "$c" ]]; then echo "$c"; return 0; fi
  done
  return 1
}

APP="$(find_app)" || {
  log "DeckRomM AppImage not found next to $DIR"
  echo "DeckRomM AppImage not found. Run ./build-appimage.sh or ./installer.sh first." >&2
  exit 1
}
chmod +x "$APP" 2>/dev/null || true
log "binary: $APP"

# ---- environment ------------------------------------------------------------
# Keep Steam's overlay preload for games we launch, but not for Electron.
if [[ -n "${LD_PRELOAD:-}" ]]; then
  export DECKROMM_ORIG_LD_PRELOAD="$LD_PRELOAD"
  unset LD_PRELOAD
fi
# Steam Runtime library paths break Chromium; the AppImage ships its own libs.
unset LD_LIBRARY_PATH

# AppImages need FUSE 2; SteamOS has it, but fall back gracefully if missing.
if [[ "$APP" == *.AppImage ]] && ! { [[ -e /dev/fuse ]] && command -v fusermount >/dev/null 2>&1; }; then
  export APPIMAGE_EXTRACT_AND_RUN=1
  log "FUSE unavailable - using extract-and-run"
fi

ARGS=(--no-sandbox)
if [[ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" || "${SteamGamepadUI:-}" == "1" || "${XDG_CURRENT_DESKTOP:-}" == "gamescope" ]]; then
  # gamescope exposes an Xwayland display; X11 ozone is the reliable path.
  ARGS+=(--gamemode --ozone-platform=x11)
  log "Game Mode detected"
fi
ARGS+=("$@")

# ---- run and supervise --------------------------------------------------------
CHILD=0
cleanup() {
  log "signal received - stopping DeckRomM"
  if (( CHILD > 0 )) && kill -0 "$CHILD" 2>/dev/null; then
    # The AppImage runtime does not forward signals, so signal Electron's main
    # process (its direct child) too; main.cjs then stops emulators and quits.
    kill -TERM "$CHILD" $(pgrep -P "$CHILD" 2>/dev/null) 2>/dev/null
    # main.cjs shuts down within 4 s; give it 6 before forcing.
    for _ in $(seq 1 30); do kill -0 "$CHILD" 2>/dev/null || break; sleep 0.2; done
    kill -KILL -- "-$CHILD" 2>/dev/null || kill -KILL "$CHILD" 2>/dev/null
  fi
  exit 0
}
trap cleanup TERM INT HUP

# setsid gives the app its own process group so cleanup can reach every child.
if command -v setsid >/dev/null 2>&1; then
  setsid "$APP" "${ARGS[@]}" >> "$LOG" 2>&1 &
else
  "$APP" "${ARGS[@]}" >> "$LOG" 2>&1 &
fi
CHILD=$!
log "started pid $CHILD"

wait "$CHILD"
STATUS=$?
log "exited with $STATUS"
# Always return 0 so Steam treats it as a clean exit and goes straight back
# to the library instead of showing an error.
exit 0
