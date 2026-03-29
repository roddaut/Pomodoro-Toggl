#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
rm -rf Sources/PomodoroToggl/Resources/dist
mkdir -p Sources/PomodoroToggl/Resources
if [[ ! -f dist/index.html ]]; then
  echo "dist/index.html not found. Run: npm run build" >&2
  exit 1
fi
cp -R dist Sources/PomodoroToggl/Resources/dist
echo "Copied web bundle to Sources/PomodoroToggl/Resources/dist"
