"""Convert raw Overture data + terrain into streamable game chunks.

Output (all coordinates in metres East/North/Up from Sukhbaatar Square):
  manifest.json            origin, chunk index, statistics, attribution
  chunks/<x>_<y>.json      roads, buildings, water, land use, places, height grid
  nav/roadgraph.txt        routable graph for GPS (nodes = real intersections)
  landmarks.json           key Phase 1 landmarks located in the source data

Nothing is invented: every feature comes from the source datasets. Values the
sources do not carry (most building heights, most road widths) are filled from
documented defaults and flagged with *_src = "estimated_*".

Usage: python -m ub6pipeline.build_tiles <raw_dir> <out_dir>
"""
import json
import math
import os
import sys
from collections import defaultdict

import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import LineString, box
from shapely.ops import substring

from . import config
from .geo import LocalFrame, chunk_of
from .terrain import Terrain

S = config.CHUNK_SIZE_M
GRID_N = 17                      # height samples per chunk edge (16 m spacing)
FLOOR_HEIGHT_M = 3.0             # used only when a building has floors but no height
DEFAULT_HEIGHT_M = {             # used only when a building has neither; flagged
    "ger": 2.5, "house": 5.0, "garage": 3.0, "apartments": 15.0, None: 6.0,
}
# (lanes, drivable) per road class when the source has no width. Flagged estimated.
ROAD_DEFAULTS = {
    "motorway": (4, True), "trunk": (6, True), "primary": (4, True), "secondary": (4, True),
    "tertiary": (2, True), "residential": (2, True), "living_street": (1, True),
    "unclassified": (2, True), "service": (1, True), "track": (1, True), "unknown": (1, True),
    "footway": (0, False), "path": (0, False), "steps": (0, False),
    "pedestrian": (0, False), "cycleway": (0, False),
}
FOOT_WIDTH_M = 2.0
DEFAULT_SPEED_KMH = {"trunk": 60, "primary": 60, "secondary": 50, "tertiary": 40,
                     "residential": 20, "living_street": 20, "service": 20}
KEY_LANDMARKS = {
    "sukhbaatar_square": ["Сүхбаатарын талбай"],
    "government_palace": ["Засгийн газрын ордон"],
    "state_department_store": ["Улсын их дэлгүүр"],
    "blue_sky_tower": ["Блю скай товер"],
    "shangri_la": ["Shangri-La Hotel (Block C)"],
    "chinggis_khaan_museum": ["Чингис хаан Үндэсний музей"],
    "zaisan_hill": ["Зайсан толгой"],
    "zaisan_square": ["Зайсан талбай"],
}


def _names(n):
    if not n or not n.get("primary"):
        return None, None
    en = next((v for k, v in (n.get("common") or []) if k == "en"), None)
    return n["primary"], en


def _r(v, nd=2):
    return round(float(v), nd)


class Builder:
    def __init__(self, raw_dir, out_dir):
        self.raw, self.out = raw_dir, out_dir
        self.frame = LocalFrame()
        self.terrain = Terrain(config.SLICE_BBOX, os.path.join(raw_dir, "terrain"))
        self.chunks = defaultdict(lambda: {"roads": [], "buildings": [], "water": [], "land_use": [], "places": []})
        self.stats = defaultdict(int)
        self.landmarks = {}
        w, s, e, n = config.SLICE_BBOX
        (e0, e1), (n0, n1), _ = self.frame.to_enu([s, n], [w, e])
        self.clip = box(float(e0), float(n0), float(e1), float(n1))

    # ---- helpers -------------------------------------------------------
    def project(self, geom):
        """Shapely lon/lat geometry -> ENU metres (2D)."""
        from shapely import transform
        def f(c):
            e, n, _ = self.frame.to_enu(c[:, 1], c[:, 0])
            import numpy as np
            return np.column_stack([e, n])
        return transform(geom, f)

    def ground(self, east, north):
        lat, lon, _ = self.frame.to_geo(east, north)
        return self.terrain.height(lat, lon)

    def chunk_box(self, cx, cy):
        return box(cx * S, cy * S, (cx + 1) * S, (cy + 1) * S)

    def chunks_touching(self, geom):
        x0, y0, x1, y1 = geom.bounds
        for cx in range(int(math.floor(x0 / S)), int(math.floor(x1 / S)) + 1):
            for cy in range(int(math.floor(y0 / S)), int(math.floor(y1 / S)) + 1):
                yield cx, cy

    def note_landmark(self, name, geom, kind):
        for key, wanted in KEY_LANDMARKS.items():
            if name in wanted and key not in self.landmarks:
                c = geom.centroid
                lat, lon, _ = self.frame.to_geo(c.x, c.y)
                self.landmarks[key] = {"name": name, "kind": kind, "lat": round(lat, 6), "lon": round(lon, 6),
                                       "east": _r(c.x), "north": _r(c.y), "ground_m": _r(self.ground(c.x, c.y), 1)}

    # ---- roads + navigation graph --------------------------------------
    def roads(self):
        rows = pq.read_table(os.path.join(self.raw, "segment.parquet")).to_pylist()
        nodes, edges = {}, []
        for r in rows:
            if r["subtype"] != "road":
                self.stats["skipped_non_road_segments"] += 1
                continue
            cls = r["class"] or "unknown"
            lanes, drivable = ROAD_DEFAULTS.get(cls, (1, True))
            line = self.project(wkb.loads(r["geometry"]))
            if line.geom_type != "LineString" or line.length < 0.5:
                continue
            width, width_src = None, None
            for wr in r["width_rules"] or []:
                if wr["between"] is None:
                    width, width_src = float(wr["value"]), "source"
            if width is None:
                width = lanes * config.LaneDefaults().lane_width_m if drivable else FOOT_WIDTH_M
                width_src = "estimated_from_class"
                self.stats["roads_width_estimated"] += 1
            oneway = 0
            for a in r["access_restrictions"] or []:
                heading = (a.get("when") or {}).get("heading")
                if a["access_type"] == "denied" and a["between"] is None and not (a.get("when") or {}).get("mode"):
                    if heading == "backward":
                        oneway = 1
                    elif heading == "forward":
                        oneway = -1
            speed, speed_src = None, None
            for sl in r["speed_limits"] or []:
                if sl.get("max_speed") and sl["between"] is None:
                    speed, speed_src = int(sl["max_speed"]["value"]), "source"
            if speed is None:
                speed, speed_src = DEFAULT_SPEED_KMH.get(cls, 20 if drivable else 5), "estimated_from_class"
            flags = sorted({v for f in (r["road_flags"] or []) for v in f["values"]})
            surface = next((s["value"] for s in (r["road_surface"] or []) if s["between"] is None), None)
            mn, en = _names(r["names"])
            base = {"id": r["id"], "class": cls, "name": mn, "name_en": en, "width": _r(width, 1),
                    "width_src": width_src, "oneway": oneway, "speed_kmh": speed, "speed_src": speed_src,
                    "drivable": drivable, "flags": flags, "surface": surface}
            self.stats["roads"] += 1
            self.stats["road_length_m"] += int(line.length)
            for cx, cy in self.chunks_touching(line):
                part = line.intersection(self.chunk_box(cx, cy))
                for piece in getattr(part, "geoms", [part]):
                    if piece.geom_type == "LineString" and piece.length > 0.05:
                        pts = [[_r(x), _r(y), _r(self.ground(x, y), 1)] for x, y in piece.coords]
                        self.chunks[(cx, cy)]["roads"].append({**base, "pts": pts})
            # Navigation graph: connectors are the real intersections.
            conns = sorted(r["connectors"] or [], key=lambda c: c["at"])
            for a, b in zip(conns, conns[1:]):
                if b["at"] - a["at"] <= 0:
                    continue
                piece = substring(line, a["at"], b["at"], normalized=True)
                if piece.geom_type != "LineString" or piece.length <= 0:
                    continue
                for c, pt in ((a, piece.coords[0]), (b, piece.coords[-1])):
                    nodes.setdefault(c["connector_id"], pt)
                edges.append((a["connector_id"], b["connector_id"], piece.length, cls, oneway, speed,
                              1 if drivable else 0, list(piece.coords)))
        ids = {cid: i for i, cid in enumerate(nodes)}
        os.makedirs(os.path.join(self.out, "nav"), exist_ok=True)
        with open(os.path.join(self.out, "nav", "roadgraph.txt"), "w") as f:
            f.write("# UB6 road graph v1. N <id> <east> <north> | "
                    "E <a> <b> <length_m> <class> <oneway> <speed_kmh> <drivable> <npts> <e n>...\n")
            for cid, (x, y) in nodes.items():
                f.write(f"N {ids[cid]} {x:.2f} {y:.2f}\n")
            for a, b, length, cls, ow, sp, dr, pts in edges:
                flat = " ".join(f"{x:.2f} {y:.2f}" for x, y in pts)
                f.write(f"E {ids[a]} {ids[b]} {length:.2f} {cls} {ow} {sp} {dr} {len(pts)} {flat}\n")
        self.stats["nav_nodes"], self.stats["nav_edges"] = len(nodes), len(edges)

    # ---- buildings ------------------------------------------------------
    def buildings(self):
        for r in pq.read_table(os.path.join(self.raw, "building.parquet")).to_pylist():
            geom = self.project(wkb.loads(r["geometry"]))
            polys = list(getattr(geom, "geoms", [geom]))
            c = geom.centroid
            if not self.clip.contains(c) or r["is_underground"]:
                continue
            if r["height"]:
                height, src = float(r["height"]), "source"
            elif r["num_floors"]:
                height, src = r["num_floors"] * FLOOR_HEIGHT_M, "estimated_from_floors"
            else:
                height, src = DEFAULT_HEIGHT_M.get(r["class"], DEFAULT_HEIGHT_M[None]), "estimated_default"
            self.stats["buildings"] += 1
            self.stats["buildings_height_" + src] += 1
            mn, en = _names(r["names"])
            if mn:
                self.note_landmark(mn, geom, "building")
            rings = [[[_r(x), _r(y)] for x, y in p.exterior.coords[:-1]] for p in polys if p.geom_type == "Polygon"]
            if not rings:
                continue
            base = min(self.ground(x, y) for ring in rings for x, y in ring)
            self.chunks[chunk_of(c.x, c.y)]["buildings"].append({
                "id": r["id"], "name": mn, "name_en": en, "subtype": r["subtype"], "class": r["class"],
                "height": _r(height, 1), "height_src": src, "floors": r["num_floors"],
                "min_height": r["min_height"], "roof_shape": r["roof_shape"],
                "facade_material": r["facade_material"], "facade_color": r["facade_color"],
                "base_z": _r(base, 1), "footprint_src": r["sources"][0]["dataset"], "rings": rings})

    # ---- water, land use, places ---------------------------------------
    def areas(self, fname, key):
        for r in pq.read_table(os.path.join(self.raw, fname)).to_pylist():
            geom = self.project(wkb.loads(r["geometry"])).intersection(self.clip)
            if geom.is_empty:
                continue
            mn, en = _names(r["names"])
            if mn:
                self.note_landmark(mn, geom, key)
            self.stats[key] += 1
            for cx, cy in self.chunks_touching(geom):
                part = geom.intersection(self.chunk_box(cx, cy))
                for g in getattr(part, "geoms", [part]):
                    item = {"id": r["id"], "name": mn, "name_en": en, "subtype": r["subtype"], "class": r["class"]}
                    if g.geom_type == "Polygon" and g.area > 1.0:
                        item["ring"] = [[_r(x), _r(y)] for x, y in g.exterior.coords[:-1]]
                    elif g.geom_type == "LineString" and g.length > 0.5:
                        item["line"] = [[_r(x), _r(y)] for x, y in g.coords]
                    else:
                        continue
                    self.chunks[(cx, cy)][key].append(item)

    def places(self, min_confidence=0.7):
        for r in pq.read_table(os.path.join(self.raw, "place.parquet")).to_pylist():
            if (r["confidence"] or 0) < min_confidence or not r["names"] or not r["names"]["primary"]:
                self.stats["places_skipped_low_confidence"] += 1
                continue
            p = self.project(wkb.loads(r["geometry"]))
            if not self.clip.contains(p):
                continue
            self.stats["places"] += 1
            self.chunks[chunk_of(p.x, p.y)]["places"].append({
                "id": r["id"], "name": r["names"]["primary"], "category": r["basic_category"],
                "confidence": _r(r["confidence"]), "pos": [_r(p.x), _r(p.y)]})

    # ---- output ---------------------------------------------------------
    def write(self):
        os.makedirs(os.path.join(self.out, "chunks"), exist_ok=True)
        x0, y0, x1, y1 = self.clip.bounds
        index = []
        for cx in range(int(math.floor(x0 / S)), int(math.floor(x1 / S)) + 1):
            for cy in range(int(math.floor(y0 / S)), int(math.floor(y1 / S)) + 1):
                c = self.chunks[(cx, cy)]
                step = S / (GRID_N - 1)
                # Heights in decimetres, row-major from the south-west corner.
                c["height_grid_dm"] = [int(round(self.ground(cx * S + i * step, cy * S + j * step) * 10))
                                       for j in range(GRID_N) for i in range(GRID_N)]
                c["chunk"] = [cx, cy]
                c["grid_n"] = GRID_N
                path = os.path.join(self.out, "chunks", f"{cx}_{cy}.json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(c, f, ensure_ascii=False, separators=(",", ":"))
                index.append({"x": cx, "y": cy, "roads": len(c["roads"]), "buildings": len(c["buildings"]),
                              "bytes": os.path.getsize(path)})
        manifest = {
            "format": "ub6-chunks-v1", "slice": "sukhbaatar_square_to_zaisan",
            "origin": {"lat": config.ORIGIN_LAT, "lon": config.ORIGIN_LON, "note": "centre of Sukhbaatar Square"},
            "bbox_wgs84": config.SLICE_BBOX, "chunk_size_m": S, "height_grid_n": GRID_N,
            "source_release": {"overture": config.OVERTURE_RELEASE, "terrain_zoom": config.TERRAIN_ZOOM},
            "attribution": config.ATTRIBUTION, "stats": dict(self.stats), "chunks": index,
            "accuracy_note": "Positions come from open data and are not survey-verified. "
                             "Fields ending in _src say whether a value is from the source or estimated.",
        }
        with open(os.path.join(self.out, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
        missing = sorted(set(KEY_LANDMARKS) - set(self.landmarks))
        with open(os.path.join(self.out, "landmarks.json"), "w", encoding="utf-8") as f:
            json.dump({"found": self.landmarks, "not_found_in_source": missing}, f, ensure_ascii=False, indent=1)
        return manifest


def main(raw_dir, out_dir):
    b = Builder(raw_dir, out_dir)
    b.roads()
    b.buildings()
    b.areas("water.parquet", "water")
    b.areas("land_use.parquet", "land_use")
    b.places()
    m = b.write()
    print(json.dumps(m["stats"], indent=1))
    print("chunks:", len(m["chunks"]), "landmarks:", sorted(b.landmarks))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
