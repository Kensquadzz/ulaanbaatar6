# ULAANBAATAR 6: iPhone playable web prototype

A separate 3D prototype that runs in iPhone Safari (Three.js, TypeScript, Vite, WebGL).
It does **not** replace the Unreal Engine project in `../unreal`; it exists so the game can be
played and judged on a phone while nobody can compile the Unreal project.

It uses the same real geographic tiles as the Unreal project (`../data/tiles`, built by
`../pipeline` from Overture Maps and AWS Terrain Tiles). `npm run build` copies them into the
site; nothing geographic is invented here.

## Run

```
npm install
npm run dev        # development server
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
npm test           # 23 unit tests (solar, geo, weather, meshing of all 520 real chunks, collision)
npm run perf       # end-to-end touch test + frame statistics (needs Playwright + Chromium, and `npm run preview` running)
```

`dist/` is a static site (about 15 MB including the map tiles, loaded progressively).

## What is real and what is a placeholder

| Real data | Temporary / procedural |
|---|---|
| Terrain heights, road network, building footprints and positions, water, land use, landmark and street names | Building facades (one procedural window pattern, tint by class) and flat roofs |
| Clock (Asia/Ulaanbaatar, UTC+8), sun position, sunrise and sunset (NOAA algorithm, same as `core/`) | The character (primitives assembled in code, procedural animation) |
| Weather when the badge says LIVE (Open-Meteo, or the project server) | Road centre dashes, ground colours, sky colour ramps, cloud and star shapes |
| | Building heights where the source has none (11,747 of 13,604 use a class default, flagged in the data) |

Known data artefact: the terrain source includes some building bulk, so the ground bulges
slightly under a few large buildings (visible north of Sukhbaatar Square).

## Live weather and keys

The browser never holds a key. Order of sources:
1. `VITE_UB6_SERVER_URL` (the existing `../server` weather service, `GET /v1/world`) when set at
   build time; provider keys stay on that server. In `npm run dev` the `/v1` path is proxied to `localhost:8080`.
2. Open-Meteo directly, which needs no key.

If nothing answers, the last observation is shown as STALE after 20 minutes; with no observation
at all the HUD says so and the world stays neutral. FREE time and MANUAL weather are clearly badged.

## Performance design

- Chunks of 256 m stream around the player: near rings in full detail with collision, far rings
  simplified, the rest released (geometry and textures disposed). A 64 m backdrop shows distant hills.
- One draw call each for terrain, roads and buildings per chunk; three.js frustum culling per mesh.
- Presets LOW / MEDIUM / HIGH (view distance, resolution cap, shadows, PBR). AUTO starts at
  MEDIUM and lowers resolution first, then the preset, when the frame rate drops below 27 fps.
- Measured in headless Chromium (software WebGL, no GPU): 61 / 112 / 159 draw calls and
  48k / 70k / 102k triangles on LOW / MEDIUM / HIGH. **No real iPhone measurement exists yet.**

## Not here yet

Vehicles, horse, NPCs and traffic, GPS route line, audio, real building and character art,
street furniture, on-device performance numbers.
