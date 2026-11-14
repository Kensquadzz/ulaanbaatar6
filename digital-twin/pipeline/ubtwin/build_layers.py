"""Build the vector layers of the ULAANBAATAR 3D viewer from real Overture rows.

Outputs (GeoJSON, WGS84 lon/lat, coordinates rounded to 1e-6 deg, about 0.1 m):
  boundary.geojson        Ulaanbaatar region outline + the 9 districts (Overture divisions)
  roads/main.geojson      motorway, trunk, primary, secondary, tertiary roads and railways
  roads/cells/*.geojson   every other road and path, cut into grid cells for streaming
  roads/index.json        cell list with bounding boxes
  water.geojson           rivers, streams, canals (lines) and lakes, ponds, reservoirs (areas)
  vegetation.geojson      forest, scrub, grass, wetland, parks, gardens, cemeteries (areas)
  trees.geojson           individually mapped trees (points)
  transit.geojson         bus stops and stop positions (points)
  signals.geojson         mapped traffic lights and signalised crossings (points, positions only)
  search.json             districts, named places, named buildings, bus stops for search
  manifest.json           counts, sources, licences, dates, CRS, accuracy notes

Nothing is invented: rows without geometry are dropped, everything else is passed through.
Usage: python -m ubtwin.build_layers <raw_dir> <out_dir>
"""
import json
import math
import os
import shutil
import sys
from collections import defaultdict

import pyarrow.parquet as pq
import shapely
from shapely.geometry import mapping

DISTRICTS_EN = {
    "Багануур": "Baganuur", "Багахангай": "Bagakhangai", "Баянгол": "Bayangol", "Баянзүрх": "Bayanzurkh",
    "Налайх": "Nalaikh", "Сонгинохайрхан": "Songinokhairkhan", "Сүхбаатар": "Sukhbaatar",
    "Хан-Уул": "Khan-Uul", "Чингэлтэй": "Chingeltei",
}
MAIN_ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary"}
CELL_LON, CELL_LAT = 0.03, 0.02
VEG_LAND = {"forest", "shrub", "grass", "wetland"}
VEG_LANDUSE = {("park", "park"), ("managed", "grass"), ("horticulture", "garden"), ("agriculture", "meadow"),
               ("cemetery", "cemetery"), ("recreation", "recreation_ground"), ("horticulture", "flowerbed")}


def _round(obj):
    if isinstance(obj, float):
        return round(obj, 6)
    if isinstance(obj, (list, tuple)):
        return [_round(v) for v in obj]
    return obj


def feature(geom, props):
    g = mapping(geom)
    return {"type": "Feature", "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])},
            "properties": {k: v for k, v in props.items() if v not in (None, "")}}


def write_fc(path, feats):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"), ensure_ascii=False)
    return len(feats)


def name_of(names):
    if not names:
        return None, None
    common = dict(names.get("common") or [])
    return names.get("primary"), common.get("en")


def rows(raw_dir, name, cols):
    t = pq.read_table(os.path.join(raw_dir, f"{name}.parquet"), columns=cols + ["geometry"])
    geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    data = {c: t.column(c).to_pylist() for c in cols}
    for i, g in enumerate(geoms):
        yield g, {c: data[c][i] for c in cols}


def build_boundary(raw, out, search):
    feats = []
    for g, r in rows(raw, "division_area", ["subtype", "region", "names", "id", "class"]):
        if r["region"] != "MN-1" or r["class"] != "land":
            continue
        if r["subtype"] == "region":
            mn, en = name_of(r["names"])
            feats.append(feature(g.simplify(0.00002, preserve_topology=True),
                                 {"kind": "city", "name": mn, "name_en": "Ulaanbaatar", "id": r["id"]}))
        elif r["subtype"] == "county":
            mn = (name_of(r["names"])[0] or "").split(" ")[0]
            en = DISTRICTS_EN.get(mn)
            if not en:
                continue
            simple = g.simplify(0.00002, preserve_topology=True)
            feats.append(feature(simple, {"kind": "district", "name": f"{mn} дүүрэг", "name_en": f"{en} District",
                                          "id": r["id"], "area_km2": round(_area_km2(g), 1)}))
            c = g.representative_point()
            search.append({"n": f"{mn} дүүрэг", "e": f"{en} District", "t": "district",
                           "x": round(c.x, 6), "y": round(c.y, 6), "b": [round(v, 5) for v in g.bounds]})
    write_fc(os.path.join(out, "boundary.geojson"), feats)
    return {"districts": sum(1 for f in feats if f["properties"]["kind"] == "district")}


def _area_km2(g):
    lat0 = math.radians(g.centroid.y)
    k = 111.32 * math.cos(lat0)
    return shapely.affinity.scale(g, xfact=k, yfact=110.57, origin=(0, 0)).area


def build_roads(raw, out):
    main, cells = [], defaultdict(list)
    shutil.rmtree(os.path.join(out, "roads"), ignore_errors=True)
    for g, r in rows(raw, "segment", ["id", "subtype", "class", "names", "road_flags", "road_surface"]):
        if g.geom_type not in ("LineString", "MultiLineString"):
            continue
        mn, en = name_of(r["names"])
        flags = {f for rf in (r["road_flags"] or []) for f in (rf.get("values") or [])}
        surface = None
        if r["road_surface"]:
            surface = r["road_surface"][0].get("value")
        props = {"c": r["class"], "k": r["subtype"], "n": mn, "e": en, "id": r["id"],
                 "br": 1 if "is_bridge" in flags else None, "tn": 1 if "is_tunnel" in flags else None,
                 "s": surface}
        f = feature(g, props)
        if r["subtype"] == "rail" or r["class"] in MAIN_ROADS:
            main.append(f)
        else:
            c = g.centroid
            cells[(math.floor(c.x / CELL_LON), math.floor(c.y / CELL_LAT))].append(f)
    write_fc(os.path.join(out, "roads", "main.geojson"), main)
    index = []
    for (cx, cy), feats in sorted(cells.items()):
        write_fc(os.path.join(out, "roads", "cells", f"{cx}_{cy}.geojson"), feats)
        index.append({"f": f"{cx}_{cy}", "b": [round(cx * CELL_LON, 4), round(cy * CELL_LAT, 4),
                                               round((cx + 1) * CELL_LON, 4), round((cy + 1) * CELL_LAT, 4)],
                      "n": len(feats)})
    with open(os.path.join(out, "roads", "index.json"), "w") as fh:
        json.dump({"cellDeg": [CELL_LON, CELL_LAT], "cells": index}, fh, separators=(",", ":"))
    return {"main_roads_and_rail": len(main), "detail_roads": sum(len(v) for v in cells.values()),
            "road_cells": len(index)}


def build_water(raw, out):
    feats = []
    for g, r in rows(raw, "water", ["id", "subtype", "class", "names", "is_intermittent"]):
        if g.geom_type in ("Point", "MultiPoint"):
            continue
        mn, en = name_of(r["names"])
        if g.geom_type in ("Polygon", "MultiPolygon"):
            g = g.simplify(0.00001, preserve_topology=True)
        feats.append(feature(g, {"k": r["subtype"], "c": r["class"], "n": mn, "e": en, "id": r["id"],
                                 "i": 1 if r["is_intermittent"] else None}))
    return {"water": write_fc(os.path.join(out, "water.geojson"), feats)}


def build_vegetation(raw, out):
    feats, trees = [], []
    for g, r in rows(raw, "land", ["id", "subtype", "class", "names"]):
        if r["subtype"] == "tree" and g.geom_type == "Point":
            trees.append(feature(g, {"id": r["id"]}))
        elif r["subtype"] in VEG_LAND and g.geom_type in ("Polygon", "MultiPolygon"):
            feats.append(feature(g.simplify(0.00002, preserve_topology=True),
                                 {"k": r["subtype"], "c": r["class"], "n": name_of(r["names"])[0], "id": r["id"]}))
    for g, r in rows(raw, "land_use", ["id", "subtype", "class", "names"]):
        if (r["subtype"], r["class"]) in VEG_LANDUSE and g.geom_type in ("Polygon", "MultiPolygon"):
            feats.append(feature(g.simplify(0.00001, preserve_topology=True),
                                 {"k": r["subtype"], "c": r["class"], "n": name_of(r["names"])[0], "id": r["id"]}))
    write_fc(os.path.join(out, "vegetation.geojson"), feats)
    write_fc(os.path.join(out, "trees.geojson"), trees)
    return {"vegetation_areas": len(feats), "mapped_trees": len(trees)}


def build_transit(raw, out, search):
    feats = []
    for g, r in rows(raw, "infrastructure", ["id", "subtype", "class", "names"]):
        if r["subtype"] == "transit" and r["class"] in ("bus_stop", "stop_position") and g.geom_type == "Point":
            mn, en = name_of(r["names"])
            feats.append(feature(g, {"c": r["class"], "n": mn, "e": en, "id": r["id"]}))
            if mn and r["class"] == "bus_stop":
                search.append({"n": mn, "e": en, "t": "bus_stop", "x": round(g.x, 6), "y": round(g.y, 6)})
    return {"transit_stops": write_fc(os.path.join(out, "transit.geojson"), feats)}


def build_signals(raw, out):
    """Mapped traffic lights: OSM highway=traffic_signals, plus pedestrian crossings tagged
    crossing=traffic_signals. Positions only: no open feed of live signal phases exists for
    Ulaanbaatar, so the viewer never animates or guesses phases."""
    feats = []
    for g, r in rows(raw, "infrastructure", ["id", "subtype", "class", "source_tags"]):
        if g.geom_type != "Point" or r["subtype"] != "transportation":
            continue
        tags = dict(r["source_tags"] or [])
        if r["class"] == "traffic_signals":
            feats.append(feature(g, {"c": "road", "id": r["id"]}))
        elif r["class"] == "crossing" and tags.get("crossing") == "traffic_signals":
            feats.append(feature(g, {"c": "crossing", "id": r["id"]}))
    n = write_fc(os.path.join(out, "signals.geojson"), feats)
    return {"traffic_signals": sum(1 for f in feats if f["properties"]["c"] == "road"),
            "signal_crossings": n - sum(1 for f in feats if f["properties"]["c"] == "road")}


def build_places(raw, search):
    n = 0
    for g, r in rows(raw, "place", ["names", "basic_category", "confidence"]):
        mn, en = name_of(r["names"])
        if not mn or g.geom_type != "Point" or (r["confidence"] or 0) < 0.5:
            continue
        search.append({"n": mn, "e": en, "t": r["basic_category"] or "place", "x": round(g.x, 6), "y": round(g.y, 6)})
        n += 1
    for g, r in rows(raw, "building", ["names", "class"]):
        mn, en = name_of(r["names"])
        if not mn:
            continue
        c = g.representative_point()
        search.append({"n": mn, "e": en, "t": "building", "x": round(c.x, 6), "y": round(c.y, 6)})
        n += 1
    return {"search_places": n}


def main(raw, out):
    os.makedirs(out, exist_ok=True)
    search, stats = [], {}
    stats.update(build_boundary(raw, out, search))
    stats.update(build_roads(raw, out))
    stats.update(build_water(raw, out))
    stats.update(build_vegetation(raw, out))
    stats.update(build_transit(raw, out, search))
    stats.update(build_signals(raw, out))
    stats.update(build_places(raw, search))
    for s in search:
        if not s.get("e"):
            s.pop("e", None)
    with open(os.path.join(out, "search.json"), "w") as fh:
        json.dump(search, fh, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(raw, "bbox.json")) as fh:
        bbox = json.load(fh)["bbox_wgs84"]
    manifest = {
        "name": "ULAANBAATAR 3D data", "bbox_wgs84": bbox, "crs": "EPSG:4326 (WGS84 lon/lat)",
        "stats": stats,
        "sources": [
            {"layer": "boundary, districts, roads, rail, water, vegetation, trees, transit, places, buildings",
             "source": "Overture Maps Foundation", "release": "2026-10-21.0",
             "includes": "OpenStreetMap contributors; Microsoft ML Building Footprints; Google/Microsoft combined "
                         "buildings (doi:10.5281/zenodo.8174931); Overture places (Meta, Microsoft)",
             "licence": "ODbL 1.0 (OSM-derived), CDLA-Permissive-2.0, CC BY 4.0 depending on theme",
             "accuracy": "Volunteer and machine-learned mapping, not survey-verified. OSM in central "
                         "Ulaanbaatar is usually within a few metres; ML footprints can be offset or merged."},
            {"layer": "terrain", "source": "AWS Terrain Tiles (Tilezen), terrarium encoding, zoom 14",
             "includes": "SRTM 30 m, GMTED2010", "licence": "Public domain / open (see Tilezen attribution)",
             "accuracy": "About 30 m ground resolution, vertical error several metres; a surface model in parts "
                         "(roofs and trees can be included)."},
        ],
        "unknown": [
            "Building heights: missing for most buildings in every open source (see buildings tileset extras).",
            "Cadastral parcels (NSDI Mongolia / ALAGaC): not reachable from the build machine, import pipeline only.",
            "Orthophotos at sub-metre resolution: not openly licensed for redistribution; viewer streams imagery "
            "providers live instead of copying them.",
        ],
    }
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
    print(json.dumps(stats))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
