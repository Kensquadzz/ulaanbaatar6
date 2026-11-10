# Status (2026-11-10)

This file separates what has been **tested**, what is **written but untested**, and what
**does not exist yet**. Nothing below is claimed to work unless it says how it was verified.

## Tested in the cloud workspace

| Area | Evidence |
|---|---|
| Real geography for the slice | 7,626 road segments (876 km), 13,604 building footprints, 89 water features, 1,257 land-use areas, 2,934 places, terrain 1,279-1,748 m, from Overture Maps 2026-10-21 and AWS Terrain Tiles. See `docs/slice_preview.png`. |
| Landmarks found in the data | Sukhbaatar Square, Government Palace, State Department Store, Blue Sky Tower, Shangri-La, Chinggis Khaan National Museum, Zaisan Hill, Zaisan Square (`data/tiles/landmarks.json`) |
| Streamable world | 520 chunks of 256 m, average 25 KB, largest 118 KB; adjacent terrain edges match; pipeline tests: 7 pass |
| Coordinates | WGS84 to local metres through ECEF; C++ and Python agree; sub-millimetre round trip 40 km from the origin |
| Live clock | UTC+8 conversion incl. year rollover and leap day; LIVE vs FREE PLAY separation |
| Sun | Sunrise 07:50 and sunset 17:21 for 2026-11-10 match Open-Meteo's figures for the same point; solstice noon elevation checked |
| Live weather | Server fetched real conditions (5.6 C, clear, wind 1.1 m/s at 16:15 local on 2026-11-10) from Open-Meteo; fallback order, retry, 5-minute cache, stale flag, restart persistence and "unavailable" state covered by 10 tests |
| Weather to gameplay | Snow cover, wetness, ice, fog, grip, breath, wipers; gradual transitions; missing data never changes the world |
| GPS | A* on the real graph: Sukhbaatar Square to Zaisan by car is 5,365 m / 338 s, obeying one-way streets; foot and horse routes found |
| Streaming logic | LOD rings, look-ahead preloading, hysteresis, per-update load limit, memory cap over a full drive across the slice |
| Quality governor | Resolution first, then preset; steps down on heat and memory pressure; no oscillation; never above the player's choice |
| Meshing | Every one of the 13,604 real footprints triangulates with exact area; road ribbons and terrain patches checked for area and facing |
| Car model | 0-100 km/h in 8-13 s, drag-limited top speed, 100-0 braking about 40 m dry and much longer on snow and ice, friction-circle cornering |
| Horse model | Walk, trot, gallop, stamina drain and recovery, feeding, slower on ice |
| Touch controls | Multi-finger stick, look and buttons; layouts for 5 screen shapes stay inside safe areas without overlap; customisation limits |

Run everything with `scripts/test_all.sh`.

## iPhone web prototype (`mobile-prototype/`, added 2026-11-10)

A separate Three.js prototype for iPhone Safari; the Unreal project is unchanged. It streams the
same real tiles and has a third-person character, touch controls, collision, mini-map, live clock,
sun and weather. Verified in the cloud: production build, 23 unit tests, and a 10-check end-to-end
run in headless Chromium driving the touch controls. **Not verified: any real iPhone**; frame rate
on a device is unknown. Buildings and the character are labelled placeholders. See `mobile-prototype/README.md`.

### Visual upgrade V1 (branch `feature/visual-upgrade-v1`, 2026-11-10)

Facade styles and estimated heights for default-only buildings, sidewalks, curbs, crossings, instanced
streetlights, new night sky, a jointed procedural character, camera and HUD polish, real district names
(`data/tiles/districts.json`, built by `pipeline/ub6pipeline/build_districts.py`). Existing tile files are
unchanged. Tested headless only (build, unit tests, end-to-end touch checks); not yet run on a real iPhone
and not deployed. The real/procedural split is in `mobile-prototype/README.md`.

## Written, not yet compiled or run

- The whole Unreal project in `unreal/Ulaanbaatar6/` (about 2,200 lines of C++ plus configs).
  It was written without an engine to compile against, so expect compile errors on first
  build. It wraps the tested core rather than re-implementing it.
- `scripts/build_android.*` and `scripts/build_ios.sh`.
- Google Weather adapter: follows the public documentation, tested only against a sample
  payload, never against the real service (needs a key).
- Device profiles: tiers exist, device lists are deliberately empty until measured.

## Known gaps in the data (flagged inside the tiles)

- **Building heights**: only 31 buildings carry a real height, 1,826 are estimated from
  floor counts, 11,747 use a class default. Every building has `height_src`.
- **Road widths**: 16 from the source, 7,610 estimated from road class (`width_src`).
- Footprint courtyards (interior rings) are ignored.
- Positions are open data, not survey-verified.
- No traffic lights, signs, street lamps or lane markings yet.

## Not built yet

Photoreal buildings and materials, character/vehicle/horse art and animation, NPCs and
traffic, missions, economy, smartphone UI, audio, weather particle effects, Google
Photorealistic 3D Tiles / Street View research tooling, Higgsfield generations, any
on-device test. The in-game look today is grey-box geometry from real footprints.

## Design decisions worth knowing

- **Car physics** uses a custom bicycle model instead of Chaos Vehicles for now: Chaos
  needs a rigged vehicle mesh that does not exist yet, and the light model also suits
  phone CPUs and AI traffic. Chaos can replace the player car once the Prius-class asset exists.
- **Vehicle names**: real makes and models are trademarks. Ship original look-alike
  designs with invented names unless licences are obtained.
- **No map assets**: the game mode spawns sky, player, car and horse into the engine's
  empty map from pipeline data, so the project needs no hand-built level to run.
