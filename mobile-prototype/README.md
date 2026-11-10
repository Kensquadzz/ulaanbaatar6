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

| Real data | Procedural / estimated (styling only, never written to the data) |
|---|---|
| Terrain heights (16 m grid), road network and classes, building footprints and positions, water, land use, landmark and street names | Facades: seven procedural styles (prefab housing, glass, civic stone, brick, retail, plain, shopfront) chosen from building class, size and a per-building hash |
| District (дүүрэг) outlines: Overture divisions, `data/tiles/districts.json` | Heights of the 11,747 buildings whose source height is only a 6 m class default: estimated from footprint area and class (`buildingLook`), not surveyed |
| Building heights where the source has one (31) or a floor count (1,826) | Government Palace height (about 22 m): the source says one floor, which is wrong; the value used is an approximation and its facade is generic civic stone, not the real building |
| Clock (Asia/Ulaanbaatar, UTC+8), sun position, sunrise and sunset (NOAA algorithm, same as `core/`) | Roof shapes (gable on small houses, cone on gers), rooftop boxes, ground-floor shopfronts, sign bands (blank, no brands) |
| Weather when the badge says LIVE (Open-Meteo, or the project server) | Sidewalks, curbs, lane markings and every streetlight position (the source has none). Zebra crossings are placed where a mapped footway crosses a road, but their size is generic |
| | Sky colour ramps, clouds, stars, city glow, night fill light. No moon is modelled |
| | The character: an original jointed figure built in code with procedural walk, run, jump and idle. An improved stand-in, not a finished realistic model |

### Visual upgrade V1 (branch `feature/visual-upgrade-v1`)

- Buildings: one draw call per chunk for all styles through a texture array (WebGL2), per-wall bay fitting so windows are never cut, warm lit windows at night, baked contact shadow on the ground around footprints.
- Streets: `src/world/street.ts` builds sidewalks with curbs, crossings and lamps from the real centre lines; a wider road atlas adds lane lines, edge lines and worn asphalt.
- Streetlights are instanced (pole, head, additive light pool) plus one halo point cloud per chunk. There are no real light sources, so the cost does not grow with lamp count; distant chunks keep only the halos.
- Night sky: sparse faint stars, warm city glow at the horizon, fog matched to it.
- Camera: eased rotation, three-ray wall and ground avoidance, slight shoulder offset, wider view when sprinting. Movement: faster stop and start, forgiving jump timing.
- HUD: district name, cleaner mini-map with view cone, destination and GPS card, restyled joystick and buttons.
- Terrain detail is unchanged: the only real elevation is the 16 m grid, and nothing finer was invented.
- Texture compression (KTX2/Basis) is not used because every texture is generated in code at small sizes; it becomes relevant once photographic or authored textures are added.

Known data artefact: the terrain source includes some building bulk, so the ground bulges
under large buildings (up to about 10 m at Government Palace, north of Sukhbaatar Square).
A building placed at its lowest corner was buried in that bulge, so the prototype stands each
building on the highest terrain under its footprint and runs the walls down to the lowest
(`groundRange` in `src/world/meshing.ts`). The data files are unchanged; the stated height is
simply always visible above ground. The bulge itself is still walkable terrain outside footprints.
Night lighting is a stylised cool fill plus a dim shadowless key light, not a modelled moon.

This branch has a `vercel.json` that switches off Vercel deployments for `feature/visual-upgrade-v1`, so pushing it does not publish anything. Remove that entry when a deployment is approved.

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
