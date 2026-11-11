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
- Streetlights are instanced (pole, head, additive light pool) plus a halo point cloud. There are no real light sources, so the cost does not grow with lamp count; distant chunks keep only the halos.
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
- Near chunk: three draw calls (terrain, roads with sidewalks, buildings). Far chunk: two (terrain
  with the carriageways painted into its texture, buildings without tiny footprints).
  three.js frustum culling per mesh.
- All streetlights in view: four draw calls in total (instanced poles, heads, light pools, one halo point cloud).
- Character: one rigidly skinned mesh, one draw call (plus one in the shadow pass).
- AUTO starts at MEDIUM. Below 27 fps it lowers resolution in steps to 70 %, then drops one
  profile. It tries the next profile up once if 55+ fps holds for 15 s. Browsers give no
  temperature reading, so frame rate is the only signal for a phone that is heating up.

| Profile | Full-detail radius | View distance | Resolution cap | Sun shadows | Materials | Ground texture near / far | Far buildings skipped below |
|---|---|---|---|---|---|---|---|
| LOW | 1 ring (about 380 m) | 2 rings (about 640 m) | 1.0x | off (blob under the character) | Lambert | 256 / 128 px | 90 m2 |
| MEDIUM | 1 ring | 3 rings (about 900 m) | 1.5x | 1024, PCF | Lambert | 512 / 256 px | 60 m2 |
| HIGH | 2 rings (about 640 m) | 5 rings (about 1.4 km) | 2.0x | 2048, soft PCF | PBR buildings and character | 512 / 256 px | 40 m2 |

### V1.1 performance audit (branch `feature/iphone-performance-v1-1`)

Why draw calls had grown from about 135 to 180-290 in Visual Upgrade V1:

1. The new character was about 50 separate meshes, drawn again in the shadow pass: about 100 calls.
2. Streetlights were instanced per chunk: 3 calls per near chunk plus one halo cloud per chunk, 18 to 60 calls.
3. Every far chunk cost three calls (terrain, roads, buildings).
4. Ground and roads used the PBR shader on MEDIUM and HIGH although both are fully matte.
5. Each ground texture kept its source canvas in memory beside the GPU copy.
6. The mini-map canvas was redrawn 8 times a second even when nothing moved.

Draw calls per frame, main plus shadow pass, same camera positions, everything streamed in
(headless Chromium 844x390, `window.__ub6.audit()`):

| View | Before | After |
|---|---|---|
| HIGH, Peace Avenue, day | 243 | 100 |
| HIGH, Sukhbaatar Square, day | 248 | 105 |
| HIGH, Peace Avenue, night | 226 | 96 |
| MEDIUM, Peace Avenue, day | 169 | 52 |
| MEDIUM, Peace Avenue, night | 133 | 49 |
| LOW, Peace Avenue, day | 91 | 31 |
| LOW, Peace Avenue, night | 104 | 33 |

Estimated GPU memory after the change (computed from buffer and texture sizes, WebGL reports
no real figure): LOW about 25 MB, MEDIUM about 53 MB, HIGH about 117 MB (geometry + textures +
shadow map). Loaded geometries on HIGH went from 204 to 98.

All frame rates measured so far come from a software renderer in the cloud (no GPU) and say
nothing about a phone. **No real iPhone measurement exists yet.**

## Not here yet

Vehicles, horse, NPCs and traffic, GPS route line, audio, real building and character art,
street furniture, on-device performance numbers.
