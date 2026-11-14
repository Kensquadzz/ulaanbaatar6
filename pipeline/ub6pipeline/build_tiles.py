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

from . import config, enrich
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
        self.chunks = defaultdict(lambda: {"roads": [], "buildings": [], "water": [], "land_use": [], "places": [], "props": {}, "junctions": [], "stops": [], "crossings": []})
        self.stats = defaultdict(int)
        self.landmarks = {}
        self.drive_lines, self.drive_meta, self.conn = [], [], {}
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
            if drivable:
                self.drive_lines.append(line)
                self.drive_meta.append((cls, width, oneway))
                for c in r["connectors"] or []:
                    inner = 0.0 < c["at"] < 1.0
                    j = self.conn.setdefault(c["connector_id"], {"arms": 0, "w": 0.0, "segs": [], "major": 0})
                    j["arms"] += 2 if inner else 1
                    j["w"] = max(j["w"], width)
                    j["major"] += cls in ("trunk", "primary", "secondary", "tertiary")
                    j["segs"].append((len(self.drive_lines) - 1, c["at"]))
            base = {"id": r["id"], "class": cls, "subclass": r["subclass"], "name": mn, "name_en": en, "width": _r(width, 1),
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
        blds = []
        for r in pq.read_table(os.path.join(self.raw, "building.parquet")).to_pylist():
            geom = self.project(wkb.loads(r["geometry"]))
            c = geom.centroid
            if not self.clip.contains(c) or r["is_underground"]:
                continue
            if r["height"]:
                height, src = float(r["height"]), "source"
            elif r["num_floors"]:
                height, src = r["num_floors"] * FLOOR_HEIGHT_M, "estimated_from_floors"
            else:
                height, src = DEFAULT_HEIGHT_M.get(r["class"], DEFAULT_HEIGHT_M[None]), "estimated_default"
            blds.append({"r": r, "geom": geom, "class": r["class"], "subtype": r["subtype"], "floors": r["num_floors"],
                         "height": height, "height_src": src})
        places = []
        for r in pq.read_table(os.path.join(self.raw, "place.parquet")).to_pylist():
            if (r["confidence"] or 0) >= 0.7 and r["basic_category"]:
                places.append((self.project(wkb.loads(r["geometry"])), r["basic_category"]))
        land = [(self.project(wkb.loads(r["geometry"])), r["class"])
                for r in pq.read_table(os.path.join(self.raw, "land_use.parquet")).to_pylist()]
        enrich.enrich_buildings(blds, places, land)
        for b in blds:
            r, geom, height, src = b["r"], b["geom"], b["height"], b["height_src"]
            polys = list(getattr(geom, "geoms", [geom]))
            c = geom.centroid
            self.stats["buildings"] += 1
            self.stats["buildings_height_" + src] += 1
            self.stats["arch_" + b["arch"]] += 1
            self.stats["arch_src_" + b["arch_src"]] += 1
            self.stats["vis_height_" + b["vis_height_src"]] += 1
            mn, en = _names(r["names"])
            if mn:
                self.note_landmark(mn, geom, "building")
            rings = [[[_r(x), _r(y)] for x, y in p.exterior.coords[:-1]] for p in polys if p.geom_type == "Polygon"]
            if not rings:
                continue
            # courtyards: interior rings of a single-polygon footprint (18 buildings in this slice)
            holes = [[[_r(x), _r(y)] for x, y in i.coords[:-1]] for i in polys[0].interiors] if len(polys) == 1 else []
            self.stats["buildings_with_courtyards"] += bool(holes)
            base = min(self.ground(x, y) for ring in rings for x, y in ring)
            self.chunks[chunk_of(c.x, c.y)]["buildings"].append({
                "id": r["id"], "name": mn, "name_en": en, "subtype": r["subtype"], "class": r["class"],
                "height": _r(height, 1), "height_src": src, "floors": r["num_floors"],
                "min_height": r["min_height"], "roof_shape": r["roof_shape"],
                "facade_material": r["facade_material"], "facade_color": r["facade_color"],
                "base_z": _r(base, 1), "footprint_src": r["sources"][0]["dataset"],
                "arch": b["arch"], "arch_src": b["arch_src"],
                "vis_height": _r(b["vis_height"], 1), "vis_height_src": b["vis_height_src"], "rings": rings,
                **({"holes": holes} if holes else {})})

    # ---- verified street objects (Overture base/infrastructure and base/land) --------------
    def props(self):
        """Points and lines that exist in the source. Nothing is added that the source lacks.

        Point props carry a unit vector toward the nearest drivable road (within 30 m) so that
        lamps, signals and shelters face the street; [0, 0] when no road is that close.
        """
        from shapely import STRtree
        from shapely.ops import nearest_points
        rtree = STRtree(self.drive_lines)

        def toward(p, reach=30.0):
            i = rtree.nearest(p)
            if i is None:
                return [0, 0], None
            q = nearest_points(p, self.drive_lines[int(i)])[1]
            d = math.hypot(q.x - p.x, q.y - p.y)
            if d > reach or d < 0.05:
                return [0, 0], int(i)
            return [_r((q.x - p.x) / d, 3), _r((q.y - p.y) / d, 3)], int(i)

        def put(key, geom, item):
            c = geom if geom.geom_type == "Point" else geom.representative_point()
            if not self.clip.contains(c):
                return
            self.chunks[chunk_of(c.x, c.y)]["props"].setdefault(key, []).append(item)
            self.stats["prop_" + key] += 1

        POINTS = {"street_lamp": "lamps", "traffic_signals": "signals", "bus_stop": "bus_stops", "bench": "benches",
                  "power_tower": "towers", "power_pole": "poles", "waste_basket": "bins", "bollard": "bollards"}
        LINES = {"fence": 1.6, "wall": 2.0, "retaining_wall": 1.2, "hedge": 1.2, "barrier": 0.9}
        self.signals, self.cross_pts = [], []
        for r in pq.read_table(os.path.join(self.raw, "infrastructure.parquet")).to_pylist():
            g = self.project(wkb.loads(r["geometry"]))
            cls, tags = r["class"], dict(r["source_tags"] or [])
            if g.geom_type == "Point" and cls in POINTS:
                d, _ = toward(g)
                item = [_r(g.x), _r(g.y), d[0], d[1]]
                if cls == "bus_stop":
                    item.append({"yes": 1, "no": 0}.get(tags.get("shelter"), 2))      # 2 = not stated
                    item.append((r["names"] or {}).get("primary"))
                if cls == "traffic_signals":
                    self.signals.append(g)
                put(POINTS[cls], g, item)
            elif g.geom_type == "Point" and cls == "crossing":
                kind = tags.get("crossing"), tags.get("crossing:markings")
                marked = 0 if (kind[0] == "unmarked" or kind[1] == "no") else 1 if (kind[0] or kind[1]) else 2
                self.cross_pts.append((g, marked, kind[0] == "traffic_signals" or tags.get("crossing:signals") == "yes"))
            elif cls in LINES and g.geom_type in ("LineString", "Polygon"):
                line = g.exterior if g.geom_type == "Polygon" else g
                h = float(r["height"]) if r["height"] else LINES[cls]
                for cx, cy in self.chunks_touching(line):
                    part = line.intersection(self.chunk_box(cx, cy))
                    for piece in getattr(part, "geoms", [part]):
                        if piece.geom_type == "LineString" and piece.length > 0.5:
                            self.chunks[(cx, cy)]["props"].setdefault("barriers", []).append(
                                {"k": cls, "h": _r(h, 1), "h_src": "source" if r["height"] else "estimated_from_class",
                                 "pts": [[_r(x), _r(y)] for x, y in piece.coords]})
                self.stats["prop_barriers"] += 1
            elif cls in ("parking", "fountain") and g.geom_type == "Polygon":
                g2 = g.intersection(self.clip)
                for cx, cy in self.chunks_touching(g2) if not g2.is_empty else []:
                    part = g2.intersection(self.chunk_box(cx, cy))
                    for piece in getattr(part, "geoms", [part]):
                        if piece.geom_type == "Polygon" and piece.area > 4:
                            self.chunks[(cx, cy)]["props"].setdefault(cls, []).append(
                                [[_r(x), _r(y)] for x, y in piece.exterior.coords[:-1]])
                self.stats["prop_" + cls] += 1
        for r in pq.read_table(os.path.join(self.raw, "land.parquet")).to_pylist():
            g = self.project(wkb.loads(r["geometry"]))
            tags = dict(r["source_tags"] or [])
            conifer = 1 if tags.get("leaf_type") == "needleleaved" else 0
            if r["class"] == "tree" and g.geom_type == "Point":
                put("trees", g, [_r(g.x), _r(g.y), 0, conifer])                 # 0 = mapped individual tree
            elif r["class"] == "tree_row" and g.geom_type == "LineString":
                n = max(2, int(g.length // 7) + 1)                             # the row is mapped, the spacing is not
                for k in range(n):
                    p = g.interpolate(k / (n - 1), normalized=True)
                    put("trees", p, [_r(p.x), _r(p.y), 1, conifer])            # 1 = placed along a mapped tree row
                self.stats["tree_rows"] += 1
            elif r["class"] in ("wood", "forest") and g.geom_type == "Polygon":
                g2 = g.intersection(self.clip)
                for cx, cy in self.chunks_touching(g2) if not g2.is_empty else []:
                    part = g2.intersection(self.chunk_box(cx, cy))
                    for piece in getattr(part, "geoms", [part]):
                        if piece.geom_type == "Polygon" and piece.area > 20:
                            self.chunks[(cx, cy)]["props"].setdefault("woods", []).append(
                                [[_r(x), _r(y)] for x, y in piece.exterior.coords[:-1]])
                self.stats["prop_woods"] += 1

    # ---- junctions, stop lines, crossings ---------------------------------------------------
    def junctions(self):
        """Real intersections = Overture connectors joined by three or more drivable arms."""
        from shapely import STRtree
        from shapely.geometry import Point
        from shapely.ops import nearest_points
        sig = STRtree(self.signals) if self.signals else None
        for cid, j in self.conn.items():
            if j["arms"] < 3:
                continue
            i0, at0 = j["segs"][0]
            p = self.drive_lines[i0].interpolate(at0, normalized=True)
            if not self.clip.contains(p):
                continue
            signal = bool(sig is not None and len(sig.query(p.buffer(30))))
            rad = min(14.0, max(2.0, j["w"] * 0.5))
            self.chunks[chunk_of(p.x, p.y)]["junctions"].append([_r(p.x), _r(p.y), _r(rad, 1), j["arms"], int(signal)])
            self.stats["junctions"] += 1
            self.stats["junctions_signalised"] += signal
            if not signal:
                continue
            # stop lines: one per approach on classified streets, set back behind the crossing
            for i, at in j["segs"]:
                cls, width, oneway = self.drive_meta[i]
                if cls not in ("trunk", "primary", "secondary", "tertiary"):
                    continue
                line = self.drive_lines[i]
                L = line.length
                for sgn in (-1, 1):                       # the arm before (-1) and after (+1) the connector
                    d0 = at * L + sgn * (rad + 5.0)
                    if d0 < 1 or d0 > L - 1:
                        continue
                    a, b = line.interpolate(d0), line.interpolate(d0 + sgn * 1.0)
                    de, dn = (a.x - b.x), (a.y - b.y)       # direction of travel toward the junction
                    n = math.hypot(de, dn) or 1
                    de, dn = de / n, dn / n
                    # traffic toward the junction on this arm runs with the line when sgn = -1
                    if oneway == 1 and sgn == 1 or oneway == -1 and sgn == -1:
                        continue                          # one-way street leaving the junction
                    half = oneway == 0
                    self.chunks[chunk_of(a.x, a.y)]["stops"].append(
                        [_r(a.x), _r(a.y), _r(de, 3), _r(dn, 3), _r(width, 1), int(half)])
                    self.stats["stop_lines"] += 1
        rtree = STRtree(self.drive_lines)
        for g, marked, signalised in self.cross_pts:
            if not self.clip.contains(g):
                continue
            i = rtree.nearest(g)
            line = self.drive_lines[int(i)]
            q = nearest_points(g, line)[1]
            if g.distance(q) > 12:
                self.stats["crossings_not_on_a_road"] += 1
                continue
            d = line.project(q)
            a, b = line.interpolate(max(0, d - 1)), line.interpolate(min(line.length, d + 1))
            n = math.hypot(b.x - a.x, b.y - a.y) or 1
            cls, width, _ = self.drive_meta[int(i)]
            self.chunks[chunk_of(q.x, q.y)]["crossings"].append(
                [_r(q.x), _r(q.y), _r((b.x - a.x) / n, 3), _r((b.y - a.y) / n, 3), _r(width, 1), marked, int(signalised)])
            self.stats["crossings"] += 1
            self.stats[("crossings_unmarked", "crossings_marked", "crossings_marking_not_stated")[marked]] += 1

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
            "format": "ub6-chunks-v2", "slice": "sukhbaatar_square_to_zaisan",
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
    b.props()
    b.junctions()
    b.areas("water.parquet", "water")
    b.areas("land_use.parquet", "land_use")
    b.places()
    m = b.write()
    print(json.dumps(m["stats"], indent=1))
    print("chunks:", len(m["chunks"]), "landmarks:", sorted(b.landmarks))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
