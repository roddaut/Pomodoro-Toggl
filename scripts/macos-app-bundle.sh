#!/usr/bin/env bash
# Build the web UI, compile the Swift host, and assemble PomodoroToggl.app for /Applications.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run macos:bundle
swift build -c release

BIN_DIR="$(swift build -c release --show-bin-path)"
EXE="$BIN_DIR/PomodoroToggl"
BUNDLE="$BIN_DIR/PomodoroToggl_PomodoroToggl.bundle"

if [[ ! -x "$EXE" ]]; then
  echo "Missing executable: $EXE" >&2
  exit 1
fi
if [[ ! -d "$BUNDLE" ]]; then
  echo "Missing resource bundle: $BUNDLE" >&2
  exit 1
fi

OUT_DIR="$ROOT/build/macos"
APP="$OUT_DIR/PomodoroToggl.app"
MACOS_DIR="$APP/Contents/MacOS"

rm -rf "$APP"
mkdir -p "$MACOS_DIR"

cp "$EXE" "$MACOS_DIR/"
cp -R "$BUNDLE" "$MACOS_DIR/"
cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"

echo ""
echo "Built: $APP"
echo "Install: drag PomodoroToggl.app into Applications, or run:"
echo "  open \"$APP\""
echo ""
