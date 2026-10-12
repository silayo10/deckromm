#!/usr/bin/env bash
# ==============================================================================
# DeckRomM - build the Linux x86_64 AppImage for SteamOS / Steam Deck
#   ./build-appimage.sh            -> release/DeckRomM-<version>-x86_64.AppImage
#   ./build-appimage.sh --dir      -> release/linux-unpacked/ (fast, for testing)
# Uses bun when available, falls back to npm.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="AppImage"
[[ "${1:-}" == "--dir" ]] && TARGET="dir"

# Ensure user tool paths are in PATH (bun, node, npm on Steam Deck / SteamOS)
for p in "$HOME/.bun/bin" "$HOME/.nvm/versions/node/"*/bin "$HOME/.local/bin" "/usr/local/bin"; do
  if [[ -d "$p" ]]; then
    export PATH="$p:$PATH"
  fi
done

if command -v bun >/dev/null 2>&1; then
  PM="bun"; RUN="bun run"; X="bunx"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
  PM="bun"; RUN="bun run"; X="bunx"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"; RUN="npm run"; X="npx"
else
  echo "error: neither bun nor npm found. Install bun: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
echo "==> Using $PM"

echo "==> [1/4] Installing dependencies"
if [[ "$PM" == "bun" ]]; then bun install; else npm install --no-audit --no-fund; fi

echo "==> [2/4] Syntax-checking main-process sources"
if command -v node >/dev/null 2>&1; then
  for f in electron/main.cjs electron/preload.cjs electron/lib/*.cjs; do node --check "$f"; done
else
  for f in electron/main.cjs electron/preload.cjs electron/lib/*.cjs; do bun build --no-bundle "$f" >/dev/null; done
fi

echo "==> [3/4] Type-checking and building the UI (dist/)"
$RUN build

# Record build metadata so packaged AppImage knows its commit hash
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo '')"
REPO="$(git config --get remote.origin.url 2>/dev/null || echo '')"
mkdir -p dist
echo "{\"commit\": \"$COMMIT\", \"repo\": \"$REPO\", \"builtAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > dist/.build-info.json
cp dist/.build-info.json .build-info.json 2>/dev/null || true

echo "==> [4/4] Packaging with electron-builder ($TARGET)"
$X electron-builder --config electron-builder.json --linux "$TARGET" --x64 --publish never

if [[ "$TARGET" == "dir" ]]; then
  echo ""
  echo "Unpacked build: $SCRIPT_DIR/release/linux-unpacked/deckromm"
  exit 0
fi

APPIMAGE="$(ls -t release/*.AppImage 2>/dev/null | head -n 1 || true)"
if [[ -z "$APPIMAGE" ]]; then
  echo "error: no AppImage produced in release/" >&2
  exit 1
fi
chmod +x "$APPIMAGE"
cp "$APPIMAGE" release/DeckRomM.AppImage

cat <<MSG

==========================================================
 AppImage ready:
   $SCRIPT_DIR/$APPIMAGE
   $SCRIPT_DIR/release/DeckRomM.AppImage   (stable name)

 Install it for Game Mode:
   ./installer.sh

 Or test it now from Desktop Mode:
   ./launch_deckromm.sh
==========================================================
MSG
