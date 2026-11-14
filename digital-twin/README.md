# ULAANBAATAR 3D: real-world 3D digital twin

A web explorer of the **current, real Ulaanbaatar**: all 9 districts, every building footprint
that open data has (485,884), roads, rivers, vegetation, bus stops and real terrain, on a 3D
globe. Built with Next.js, React, TypeScript, Tailwind CSS and CesiumJS.

This is a separate product from the ULAANBAATAR 6 game (`/mobile-prototype`, `/unreal`); it shares
no code with them and changes nothing there.

## Монгол товч

- Бүх Улаанбаатар (9 дүүрэг), 485,884 барилга, 84,408 зам, гол ус, ногоон бүс, 709 автобусны буудал.
- Бүх өгөгдөл бодит, нээлттэй эх сурвалжаас (Overture Maps = OpenStreetMap + Microsoft/Google ML барилга, AWS газрын гадарга). Юу ч зохиогоогүй.
- Ихэнх барилгын өндөр нээлттэй өгөгдөлд **байхгүй** (230 барилгад л бий, 3,956-д давхрын тоо бий). Тодорхойгүй өндөртэйг 3 м-ийн саарал блокоор харуулж, "тодорхойгүй" гэж тэмдэглэсэн, нууж болно.
- HY-World 2.0-ийг судалсан; GPU (16–24 ГБ) шаарддаг тул энэ cloud машин дээр ажиллуулаагүй. Дэлгэрэнгүй: `docs/HY-WORLD-2.md`.

## What works

| Feature | Status |
|---|---|
| Full-screen CesiumJS 3D globe, smooth camera, aerial exploration | yes |
| Real terrain (AWS Terrain Tiles, zoom 14, streamed live) | yes, toggle |
| Real administrative boundary + 9 districts (Overture divisions) | yes, toggle + labels |
| 3D buildings for the whole city as Cesium 3D Tiles (679 tiles, 71 MB, meshopt-compressed) | yes, toggle |
| Building info panel (height and its source, floors, footprint area, ground elevation, source dataset, Overture GERS id) | yes, tap a building |
| Roads and railways, draped on terrain, streamed by area | yes, toggle |
| Rivers, lakes, vegetation, parks, 9,631 mapped trees | yes, toggles |
| Bus stops (709 stops + 129 stop positions) with names | yes, toggle |
| Traffic lights (302 mapped positions); live phases not available as open data, so not shown | yes, toggle, tap for info |
| Live traffic congestion (TomTom Traffic Flow, refresh every 2 min) | yes, needs a TomTom API key (entered in the app or `NEXT_PUBLIC_TOMTOM_KEY`) |
| Search: districts, 15,629 named places/buildings/stops; Cyrillic or Latin typing ("zaisan") | yes |
| Satellite imagery mode (Esri World Imagery), Sentinel-2 10 m, OSM map, data-only | yes |
| Measurement: geodesic distance (Vincenty) and area | yes |
| Coordinate display (WGS84 + elevation) | yes |
| Street-level mode: walk at 1.7 m eye height, drag to look, on-screen pad or WASD | yes |
| 3D reconstruction mode: lists verified reconstructions from `data/reconstructions.json` | yes, currently **empty** (none verified) |
| Responsive desktop + phone layout, safe areas, lighter settings on phones | yes, not tested on a real iPhone yet |

## Layout

```
digital-twin/
  pipeline/            Python: download real data, build 3D Tiles and vector layers
    ubtwin/fetch.py          Overture Maps (S3) for the Ulaanbaatar region MN-1 bbox
    ubtwin/build_buildings.py footprints -> b3dm 3D Tiles quadtree (LOD0 parents, LOD1 leaves)
    ubtwin/build_layers.py   boundaries, roads (+cells), water, vegetation, trees, transit, search
    ubtwin/terrain.py        AWS terrarium sampler (bases buildings on the viewer's terrain)
    tests/                   pytest
  web/                 Next.js app (static export)
    components/Explorer.tsx  UI
    lib/twin.ts              Cesium scene, layers, picking, measuring, street mode
    lib/vector.ts            vector data painted into imagery tiles (cheap on phones)
    lib/terrain.ts           terrain provider over AWS terrarium tiles
    lib/geo.ts               geodesy, search, terrain decoding (unit-tested)
    public/data/             generated data (committed, about 151 MB)
  docs/                DATASETS.md, HY-WORLD-2.md, ROADMAP.md, DEPLOY.md
```

## Run locally

```bash
cd digital-twin/web
npm install          # also copies the Cesium runtime into public/cesium
npm run dev          # http://localhost:3000
npm run build        # static site in out/
npm test             # unit tests (node --test)
```

Headless check with screenshots (needs Playwright + Chromium):
`npx serve out -l 8099 & node scripts/shot.mjs http://localhost:8099 screenshots`

## Rebuild the data

```bash
cd digital-twin/pipeline
pip install -r requirements.txt
python -m ubtwin.fetch ../data/raw                      # ~110 MB from Overture S3, about 2 minutes
python -m ubtwin.build_buildings ../data/raw ../web/public/data/buildings /tmp/terrain
python -m ubtwin.build_layers ../data/raw ../web/public/data
python -m pytest tests
```

Behind a TLS-inspecting proxy set `AWS_CA_BUNDLE` to its CA file. The Overture release is
pinned in `ubtwin/s3.py` (`OVERTURE_RELEASE`); Overture retires old releases after some months,
so bump it when a fetch fails.

## Data honesty rules (enforced in code)

* Geometry and positions are passed through unchanged from the sources. Nothing is moved,
  invented or "beautified".
* Building height: `source` (OSM height tag) / `floors` (floors x 3 m, labelled estimate) /
  `unknown` (3 m placeholder, grey, labelled, can be hidden). Counts are in
  `public/data/buildings/tileset.json` `extras`.
* Road widths in the map are cartographic display widths, not measured widths.
* Tree dots use a fixed 3 m display radius; only the position is data.
* No AI-generated geometry is shown. The reconstruction mode only lists items that were checked
  against real imagery and georeferenced (none yet).

See `docs/DATASETS.md` for every source, licence, date, CRS and accuracy note, and
`docs/DEPLOY.md` for hosting.
