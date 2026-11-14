# Roadmap to full-city coverage

## Done (Phase 1 and most of Phase 2)

* Whole administrative area, 9 districts, real boundaries.
* LOD0: city terrain, boundaries, main roads, rivers, building distribution (parent tiles hold
  the most prominent buildings of each area).
* LOD1: every open building footprint as a 3D volume, accurate road geometry, streaming by area.
* Explorer with search, layers, measurement, coordinates, building info, street-level walk.

## Next

1. **Heights** (biggest visual gap). Add an importer for a real height source (LiDAR,
   photogrammetry, GHSL Built-H 100 m as a labelled estimate, or survey data from the city).
   Keep the `heightSource` field honest.
2. **Official data**: NSDI Mongolia boundaries and layers once the host is reachable or files
   are provided; show official vs OSM boundary differences instead of silently replacing.
3. **Geofabrik OSM extract**: building:levels, roof shapes, bus routes, addresses.
4. **LOD2**: roof shapes where OSM tags them, building parts, facade colours from OSM tags,
   street furniture from Overture infrastructure (lamps, benches, signals already in the raw
   data: 377 street lamps, 332 benches, 119 traffic signals).
5. **Terrain**: Copernicus GLO-30 as quantized-mesh tiles; this also allows Cesium's
   ground-clamping to match exactly.
6. **Phase 3 (AI reconstruction)**: first verified HY-World 2.0 site (see HY-WORLD-2.md),
   needs a GPU rental and our own photos.
7. **Phase 4 (twin services)**: PostGIS + FastAPI for search, building attributes and edits;
   nightly Overture refresh with a diff report; data hosted on Cloudflare R2 behind a CDN
   instead of the repository.
8. **Performance on phones**: measure on a real iPhone, then tune tile screen-space error,
   imagery resolution and memory.

## Scaling notes

* 3D Tiles are an adaptive quadtree (max 2,500 buildings per leaf, depth 12), so adding data
  only touches the affected leaves.
* Road cells are 0.03 x 0.02 degree files (about 2.2 x 2.2 km), loaded only when the camera is
  close; the main network is one file.
* All generated data is static, so any CDN can host it; nothing needs a server today.
