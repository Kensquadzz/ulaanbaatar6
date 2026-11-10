# ULAANBAATAR 6 MOBILE

An original open-world game set in the real city of Ulaanbaatar, for iOS and Android, on
Unreal Engine 5. First milestone: a playable slice from Sukhbaatar Square to Zaisan with a
live clock and live weather.

| Folder | What it is | Status |
|---|---|---|
| `core/` | Engine-independent C++17: geodesy, sun position, live clock, weather simulation, chunk streaming, quality governor, GPS routing, mesh builders, car physics, horse gaits, touch controls | Compiled and unit tested (2,061 checks) |
| `pipeline/` | Python: downloads open map data and terrain for the slice and writes streamable chunks | Run and tested on real data |
| `server/` | Weather/time service that keeps provider keys off the phone | Tested, including against live Ulaanbaatar weather |
| `unreal/Ulaanbaatar6/` | UE 5.5 project: C++ game modules and mobile configs | Written, **not yet compiled** (no Unreal Engine in the cloud workspace) |
| `scripts/` | Test runner, data sync, Android and iOS build scripts | Test runner used; build scripts **not yet run** |
| `assets/` | Asset production tracker (Higgsfield references to game-ready assets) | Structure only |
| `docs/` | Status, local setup, testing, dependencies | |

Start with `docs/STATUS.md`, then `docs/LOCAL_SETUP.md`.

## iPhone web prototype

`mobile-prototype/` is a separate Three.js build of the same slice that runs in iPhone Safari. It does not replace the Unreal project. See `mobile-prototype/README.md`.
