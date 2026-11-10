#!/usr/bin/env bash
# Runs every automated test that does not need Unreal Engine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cmake -S "$ROOT/core" -B "$ROOT/core/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$ROOT/core/build" -j >/dev/null
"$ROOT/core/build/ub6tests"
(cd "$ROOT/pipeline" && python3 -m pytest -q)
(cd "$ROOT/server" && python3 -m pytest -q)
