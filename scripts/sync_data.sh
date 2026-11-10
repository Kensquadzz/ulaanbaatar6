#!/usr/bin/env bash
# Copies pipeline output into the Unreal project so it is staged with the game.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/unreal/Ulaanbaatar6/Content/UB6Data/tiles"
[ -f "$ROOT/data/tiles/manifest.json" ] || { echo "Run the pipeline first (docs/LOCAL_SETUP.md)"; exit 1; }
rm -rf "$DEST" && mkdir -p "$DEST"
cp -R "$ROOT/data/tiles/." "$DEST/"
echo "Copied $(ls "$DEST/chunks" | wc -l) chunks to $DEST"
