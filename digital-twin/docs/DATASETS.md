# Datasets

All coordinates are WGS84 (EPSG:4326). Heights are metres above mean sea level as encoded by the
terrain tiles (EGM96-style orthometric), used consistently for terrain and building bases.
Extent: Ulaanbaatar region MN-1 from Overture divisions, bbox 106.3626, 47.3020, 108.5008, 48.2719.

## In use

| Layer | Source | Licence | Date / version | Accuracy and caveats |
|---|---|---|---|---|
| City + 9 district boundaries | Overture Maps divisions (`division_area`, region MN-1, subtype county), derived from OpenStreetMap | ODbL 1.0 | release 2026-10-21.0 | OSM admin boundaries, not the official cadastral line; simplified to 2 m tolerance for display |
| Buildings (485,884) | Overture buildings: OpenStreetMap 342,500; Microsoft ML Building Footprints 113,868; dataset listed by Overture as `doi:10.5281/zenodo.8174931` (Google-Microsoft combined open buildings) 29,516 | ODbL 1.0 (OSM), CDLA-Permissive-2.0 (Microsoft), CC BY 4.0 / ODbL (combined set) | 2026-10-21.0 | OSM footprints in the centre are usually within a few metres. ML footprints (mostly ger districts and outskirts) can be offset, merged or missing. Underground buildings skipped |
| Building heights | same rows: `height` on 230 buildings, `num_floors` on 3,956 | as above | as above | 481,698 buildings have **no height in any source**: shown as 3 m placeholders and labelled unknown |
| Roads (84,408 segments) and railways | Overture transportation `segment` (OpenStreetMap) | ODbL 1.0 | 2026-10-21.0 | OSM geometry; widths not used (display widths only) |
| Water (5,942) | Overture base `water` (OSM) | ODbL 1.0 | 2026-10-21.0 | Rivers as centre lines; polygons simplified to 1 m |
| Vegetation (6,454 areas) | Overture base `land` (forest, scrub, grass, wetland) and `land_use` (parks, managed grass, gardens, cemeteries...) | ODbL 1.0 | 2026-10-21.0 | Mapping is incomplete outside the centre; no land-cover raster used yet |
| Trees (9,631 points) | Overture base `land` subtype tree (OSM `natural=tree`) | ODbL 1.0 | 2026-10-21.0 | Positions only; crown size is a display constant |
| Public transport (709 bus stops, 129 stop positions) | Overture base `infrastructure` subtype transit (OSM `highway=bus_stop`, `public_transport=stop_position`) | ODbL 1.0 | 2026-10-21.0 | Routes are not imported yet |
| Search (15,629) | districts, Overture places with confidence >= 0.5, named buildings, named bus stops | CDLA-Permissive-2.0 / ODbL | 2026-10-21.0 | Place points come from Meta/Microsoft business data and can be stale |
| Terrain | AWS Terrain Tiles (Tilezen terrarium), zoom 14 | public; attribution to SRTM, GMTED2010 and Tilezen | static (2017 build) | About 30 m source resolution (SRTM), vertical error several metres, partly a surface model |
| Satellite imagery (streamed, not copied) | Esri World Imagery | Esri terms of use; attribution required; production needs an ArcGIS key | live service | Sub-metre in the city; capture date varies by area |
| Satellite imagery (streamed) | Sentinel-2 cloudless 2024 by EOX | CC BY-NC-SA 4.0 (non-commercial) | 2024 mosaic | 10 m |
| Map tiles (streamed) | OpenStreetMap standard tiles | ODbL data, tile usage policy | live | for orientation only |

## Required by the brief but not available yet

| Data | Status | Pipeline / next step |
|---|---|---|
| Mongolia NSDI (nsdi.gov.mn) official layers | The build machine cannot reach nsdi.gov.mn (network policy). Layers and licence unverified | Download manually or allowlist the host, then add an importer that reads GeoJSON/Shapefile into the same layer format; keep official boundaries as a separate layer for comparison |
| Cadastral parcels (ALAGaC / NSDI) | Not openly available for redistribution as far as we know; unverified | Import only with a written licence; never mix into the open layers |
| Geofabrik `mongolia-latest.osm.pbf` | Host blocked from the build machine | Would add building:levels, bus routes and more POIs; same importer pattern (osmium -> GeoJSON) |
| Orthophotos | No openly licensed sub-metre orthophoto found | Stream from a licensed provider; never bake third-party imagery into the repo |
| Street-level imagery (Mapillary / KartaView) | Not integrated | Needed as the photo source for HY-World 2.0 reconstructions |
| Building heights for the remaining 99 % | No open source reached from here | Candidates: GHSL Built-H (JRC, 100 m grid, CC BY 4.0; host blocked here), Google Open Buildings 2.5D (Earth Engine), LiDAR or photogrammetry. Any derived height must stay labelled "estimate" |
| Higher-resolution DEM (ALOS 30 m, Copernicus GLO-30) | Not fetched | Copernicus DEM GLO-30 on AWS S3 is a drop-in improvement; would also need a quantized-mesh build |
