"""Turn the real Overture building footprints of all Ulaanbaatar into a Cesium 3D Tiles tileset.

* Footprints and positions are unchanged Overture geometry (OpenStreetMap, Microsoft ML
  Buildings, and the combined Google/Microsoft dataset Overture lists as
  doi:10.5281/zenodo.8174931).
* Height policy, never silent:
    - `source`  : the source gives a height in metres (OSM `height`).
    - `floors`  : the source gives a floor count only; height = floors x 3.0 m (ESTIMATE).
    - `unknown` : no height in any source. Drawn as a 3 m placeholder block and labelled
                  "unknown" in the viewer, which can also hide these.
* Building bases follow the AWS terrain tiles that the viewer streams (same zoom).

LOD layout: an adaptive quadtree over the city. Leaves hold every building whose centroid
falls inside; parents hold only the most prominent buildings of their subtree for far views
(refine REPLACE), so the whole city stays light enough for a phone.

Usage: python -m ubtwin.build_buildings <raw_dir> <out_dir> <terrain_cache>
"""
import json
import math
import os
import shutil
import sys
import time

import mapbox_earcut as earcut
import numpy as np
import pyarrow.parquet as pq
import shapely

from . import b3dm, geo
from .terrain import Terrain

LEAF_MAX = 2500           # buildings per leaf tile
PARENT_MAX = 2500         # prominent buildings kept in each parent tile
MAX_DEPTH = 12
PLACEHOLDER_H = 3.0
SINK_M = 3.0             # base sunk below the lowest ground sample (hidden walls, no floating gaps)
FLOOR_H = 3.0
HS_INDEX = {"source": 0, "floors": 1, "unknown": 2}
DATASETS = ["OpenStreetMap", "Microsoft ML Buildings", "doi:10.5281/zenodo.8174931", "unknown"]
DATASET_INDEX = {d: i for i, d in enumerate(DATASETS)}


def _name(names):
    if not names:
        return None
    return names.get("primary")


def load_buildings(raw_dir):
    t = pq.read_table(os.path.join(raw_dir, "building.parquet"),
                      columns=["id", "names", "sources", "height", "num_floors", "subtype", "class",
                               "is_underground", "roof_shape", "geometry"])
    cols = {c: t.column(c).to_pylist() for c in t.schema.names if c != "geometry"}
    geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    out = []
    for i, g in enumerate(geoms):
        if cols["is_underground"][i]:
            continue
        polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g] if g.geom_type == "Polygon" else []
        polys = [p for p in polys if not p.is_empty and len(p.exterior.coords) >= 4]
        if not polys:
            continue
        h, fl = cols["height"][i], cols["num_floors"][i]
        if h is not None and h > 0:
            hs, hv = "source", float(h)
        elif fl is not None and fl > 0:
            hs, hv = "floors", float(fl) * FLOOR_H
        else:
            hs, hv = "unknown", PLACEHOLDER_H
        src = cols["sources"][i] or []
        c = g.centroid
        area = sum(geo.polygon_area_m2(np.asarray(p.exterior.coords)[:-1, 0], np.asarray(p.exterior.coords)[:-1, 1])
                   for p in polys)
        out.append({
            "id": cols["id"][i], "name": _name(cols["names"][i]),
            "cls": cols["class"][i] or cols["subtype"][i],
            "h": hv, "hs": hs, "fl": fl, "src": src[0]["dataset"] if src else None,
            "lon": c.x, "lat": c.y, "polys": polys, "area": area,
            "roof": cols["roof_shape"][i],
        })
    return out


def attach_ground(buildings, terrain):
    lons, lats, owner = [], [], []
    for k, b in enumerate(buildings):
        for p in b["polys"]:
            xy = np.asarray(p.exterior.coords)[:-1]
            lons.append(xy[:, 0]); lats.append(xy[:, 1]); owner.append(np.full(len(xy), k))
    lons, lats, owner = np.concatenate(lons), np.concatenate(lats), np.concatenate(owner)
    terrain.ensure(lons, lats)
    hs = terrain.heights(lons, lats)
    gmin = np.full(len(buildings), np.inf)
    gmax = np.full(len(buildings), -np.inf)
    np.minimum.at(gmin, owner, hs)
    np.maximum.at(gmax, owner, hs)
    for k, b in enumerate(buildings):
        b["g0"] = float(gmin[k]) - SINK_M       # sink the base so no gap shows where the viewer terrain mesh is coarser
        b["top"] = float(gmax[k]) + b["h"]      # roof measured from the highest ground point


def building_mesh(b, origin, R):
    """Return (positions_enu[N,3], triangle indices[M]) for one building: walls + flat roof."""
    pos_all, idx_all, base = [], [], 0
    for p in b["polys"]:
        rings = [np.asarray(p.exterior.coords)[:-1, :2]] + [np.asarray(r.coords)[:-1, :2] for r in p.interiors]
        rings = [r for r in rings if len(r) >= 3]
        flat = np.concatenate(rings)
        n = len(flat)
        bottom = geo.to_ecef(flat[:, 0], flat[:, 1], np.full(n, b["g0"]))
        top = geo.to_ecef(flat[:, 0], flat[:, 1], np.full(n, b["top"]))
        pos = geo.ecef_to_enu(np.concatenate([bottom, top]), origin, R)
        tris = []
        start = 0
        for r in rings:
            m = len(r)
            i = np.arange(m) + start
            j = np.roll(i, -1)
            tris.append(np.stack([i, j, j + n, i, j + n, i + n], axis=1).reshape(-1))
            start += m
        # roof triangulation in a local metric plane
        lat0 = math.radians(b["lat"])
        xy = np.stack([np.radians(flat[:, 0]) * geo.A * math.cos(lat0), np.radians(flat[:, 1]) * geo.A], axis=1)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        roof = earcut.triangulate_float64(xy, ends).astype(np.int64)
        tris.append(roof + n)
        idx = np.concatenate(tris) + base
        pos_all.append(pos)
        idx_all.append(idx)
        base += 2 * n
    return np.concatenate(pos_all), np.concatenate(idx_all)


def write_tile(blds, path):
    lon0 = float(np.mean([b["lon"] for b in blds]))
    lat0 = float(np.mean([b["lat"] for b in blds]))
    origin, R = geo.enu_frame(lon0, lat0, 0.0)
    prims, cur_p, cur_i, cur_b, nverts = [], [], [], [], 0
    for k, b in enumerate(blds):
        p, i = building_mesh(b, origin, R)
        if nverts + len(p) > 65000 and cur_p:
            prims.append((np.concatenate(cur_p), np.concatenate(cur_i), np.concatenate(cur_b)))
            cur_p, cur_i, cur_b, nverts = [], [], [], 0
        cur_p.append(p); cur_i.append(i + nverts); cur_b.append(np.full(len(p), k, dtype=np.uint16))
        nverts += len(p)
    if cur_p:
        prims.append((np.concatenate(cur_p), np.concatenate(cur_i), np.concatenate(cur_b)))
    glb = b3dm.build_glb(prims, origin, R)
    # Only the fields the viewer styles by live in the tile; the rest is in a JSON sidecar
    # that the viewer fetches when a building is picked.
    bt = {"hs": [HS_INDEX[b["hs"]] for b in blds], "height": [round(b["h"], 1) for b in blds]}
    side = {
        "id": [b["id"] for b in blds],
        "name": [b["name"] or "" for b in blds],
        "cls": [b["cls"] or "" for b in blds],
        "floors": [b["fl"] or 0 for b in blds],
        "dataset": [DATASET_INDEX.get(b["src"], 3) for b in blds],
        "area": [round(b["area"]) for b in blds],
        "ground": [round(b["g0"] + SINK_M, 1) for b in blds],
        "roof": [b["roof"] or "" for b in blds],
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path[:-5] + ".json", "w") as fh:
        json.dump(side, fh, separators=(",", ":"), ensure_ascii=False)
    data = b3dm.build_b3dm(glb, bt, len(blds))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return len(data)


def prominence(b):
    w = 4.0 if b["hs"] != "unknown" else 1.0
    return b["area"] * max(b["h"], PLACEHOLDER_H) * w


class Node:
    def __init__(self, bbox, level, x, y):
        self.bbox, self.level, self.x, self.y = bbox, level, x, y
        self.children, self.items, self.content = [], [], None


def build_tree(items, bbox, level=0, x=0, y=0):
    node = Node(bbox, level, x, y)
    if len(items) <= LEAF_MAX or level >= MAX_DEPTH:
        node.items = items
        return node
    w, s, e, n = bbox
    cx, cy = (w + e) / 2, (s + n) / 2
    quads = [((w, s, cx, cy), 0, 0), ((cx, s, e, cy), 1, 0), ((w, cy, cx, n), 0, 1), ((cx, cy, e, n), 1, 1)]
    for qb, dx, dy in quads:
        sub = [b for b in items if qb[0] <= b["lon"] < qb[2] and qb[1] <= b["lat"] < qb[3]]
        if sub:
            node.children.append(build_tree(sub, qb, level + 1, 2 * x + dx, 2 * y + dy))
    node.items = sorted(items, key=prominence, reverse=True)[:PARENT_MAX]
    node.items = [b for b in node.items if b["area"] >= 150.0]
    return node


def tile_json(node, out_dir, stats):
    w, s, e, n = node.bbox
    sub = node.items if not node.children else node.items
    width_m = (e - w) * math.cos(math.radians((s + n) / 2)) * 111320.0
    leaf = not node.children
    rel = f"tiles/{node.level}/{node.x}_{node.y}.b3dm"
    hmin, hmax = math.inf, -math.inf
    if sub:
        size = write_tile(sub, os.path.join(out_dir, rel))
        stats["bytes"] += size
        stats["tiles"] += 1
        hmin = min(b["g0"] for b in sub)
        hmax = max(b["top"] for b in sub)
    children = [tile_json(c, out_dir, stats) for c in node.children]
    for c in children:
        hmin = min(hmin, c["boundingVolume"]["region"][4])
        hmax = max(hmax, c["boundingVolume"]["region"][5])
    t = {
        "boundingVolume": {"region": [math.radians(w), math.radians(s), math.radians(e), math.radians(n),
                                      round(hmin, 1), round(hmax, 1)]},
        "geometricError": 0.0 if leaf else round(width_m / 30.0, 1),
        "refine": "REPLACE",
    }
    if sub:
        t["content"] = {"uri": rel}
    if children:
        t["children"] = children
    return t


def main(raw_dir, out_dir, terrain_cache):
    t0 = time.time()
    blds = load_buildings(raw_dir)
    print(f"{len(blds)} buildings loaded ({time.time()-t0:.0f}s)", flush=True)
    attach_ground(blds, Terrain(terrain_cache))
    print(f"ground heights sampled ({time.time()-t0:.0f}s)", flush=True)
    with open(os.path.join(raw_dir, "bbox.json")) as fh:
        bbox = tuple(json.load(fh)["bbox_wgs84"])
    root = build_tree(blds, bbox)
    if os.path.isdir(os.path.join(out_dir, "tiles")):
        shutil.rmtree(os.path.join(out_dir, "tiles"))
    stats = {"bytes": 0, "tiles": 0}
    root_json = tile_json(root, out_dir, stats)
    counts = {"source": 0, "floors": 0, "unknown": 0}
    datasets = {}
    for b in blds:
        counts[b["hs"]] += 1
        datasets[b["src"] or "unknown"] = datasets.get(b["src"] or "unknown", 0) + 1
    tileset = {
        "asset": {"version": "1.0", "tilesetVersion": "ub3d-buildings-1"},
        "properties": {"height": {"minimum": 0, "maximum": max(b["h"] for b in blds)}},
        "geometricError": round(root_json["geometricError"] * 2 + 1, 1),
        "root": root_json,
        "extras": {
            "buildings": len(blds), "heightSource": counts, "datasets": datasets,
            "heightPolicy": "source = metres given by the source; floors = floors x 3 m (estimate); "
                            "unknown = no height in any source, drawn as a 3 m placeholder",
            "release": "Overture Maps 2026-10-21.0",
            "codes": {"hs": ["source", "floors", "unknown"], "dataset": DATASETS},
            "sidecar": "each tiles/L/X_Y.b3dm has tiles/L/X_Y.json with id, name, cls, floors, dataset, "
                       "area (m2), ground (m), roof, indexed by batch id",
        },
    }
    with open(os.path.join(out_dir, "tileset.json"), "w") as fh:
        json.dump(tileset, fh, separators=(",", ":"))
    print(json.dumps({"tiles": stats["tiles"], "MB": round(stats["bytes"] / 1e6, 1), "heights": counts,
                      "datasets": datasets, "seconds": round(time.time() - t0)}), flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:4])
