"""Bridge decks and railway lines for the mobile prototype (and later the UE project).

Inputs (all real data already in the repo):
  data/tiles/chunks/*.json  road segments with Overture's `is_bridge` flag, and the terrain grids
  data/raw/segment.parquet  Overture transportation segments with subtype `rail`

Outputs:
  data/tiles/bridges.json   each bridge as one continuous centreline (chunk splits and consecutive
                            bridge segments joined) with a deck height every ~4 m
  data/tiles/rail.json      railway centrelines in local East/North metres

HONEST LIMITS: Overture says WHERE a road is a bridge, not how high its deck is. The deck height is an
ESTIMATE: it starts and ends at the terrain height of the bridge ends and rises in between to a
clearance chosen from the bridge length (long bridges over railways/rivers ~7 m, short ones less).
It is labelled `deck_height_src: "estimated_from_length"` in the output.

Usage: python -m ub6pipeline.build_bridges <repo root>
"""
import glob
import json
import math
import os
import sys

TERRAIN_N = 17
CHUNK = 256.0
ORIGIN_GROUND_M = 1298.0
STEP_M = 4.0


def clearance_for(length, cls):
    if length >= 150:
        return 7.0
    if length >= 60:
        return 5.0
    if length >= 25:
        return 2.5 if cls not in ("footway", "path", "cycleway", "steps") else 2.0
    return 0.6


def tri_lerp(a, b, c, d, fx, fy):
    return a + (b - a) * fx + (d - b) * fy if fx >= fy else a + (c - a) * fy + (d - c) * fx


class Terrain:
    def __init__(self, chunks):
        self.grids = {k: [v / 10.0 - ORIGIN_GROUND_M for v in d["height_grid_dm"]] for k, d in chunks.items()}

    def height(self, e, n):
        cx, cy = math.floor(e / CHUNK), math.floor(n / CHUNK)
        g = self.grids.get((cx, cy))
        if g is None:
            return None
        u, v = (e - cx * CHUNK) / CHUNK, (n - cy * CHUNK) / CHUNK
        gx = max(0.0, min(TERRAIN_N - 1, u * (TERRAIN_N - 1)))
        gy = max(0.0, min(TERRAIN_N - 1, v * (TERRAIN_N - 1)))
        i, j = min(TERRAIN_N - 2, int(gx)), min(TERRAIN_N - 2, int(gy))
        at = lambda ii, jj: g[jj * TERRAIN_N + ii]
        return tri_lerp(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1), gx - i, gy - j)


def join(polys, tol=1.2):
    """Greedily joins polylines whose ends meet (within tol metres) and share class."""
    polys = [dict(p) for p in polys]
    changed = True
    while changed:
        changed = False
        for i in range(len(polys)):
            a = polys[i]
            if a is None:
                continue
            for j in range(len(polys)):
                b = polys[j]
                if i == j or b is None or a["cls"] != b["cls"] or a["name"] != b["name"]:
                    continue
                pa, pb = a["pts"], b["pts"]
                d = lambda p, q: math.hypot(p[0] - q[0], p[1] - q[1])
                if d(pa[-1], pb[0]) < tol:
                    merged = pa + pb[1:]
                elif d(pa[-1], pb[-1]) < tol:
                    merged = pa + pb[::-1][1:]
                elif d(pa[0], pb[-1]) < tol:
                    merged = pb + pa[1:]
                elif d(pa[0], pb[0]) < tol:
                    merged = pb[::-1] + pa[1:]
                else:
                    continue
                if not straight_join(merged, len(pa) if merged[:len(pa)] == pa else len(pb)):
                    continue
                a["pts"] = merged
                a["ids"] = sorted(set(a["ids"]) | set(b["ids"]))
                a["width"] = max(a["width"], b["width"])
                a["name"] = a["name"] or b["name"]
                a["name_en"] = a["name_en"] or b["name_en"]
                polys[j] = None
                changed = True
        polys = [p for p in polys if p is not None]
    return polys


def straight_join(pts, k, max_turn_deg=40):
    """True when the polyline keeps going roughly straight across the join at index k-1."""
    i = max(1, min(len(pts) - 2, k - 1))
    a, b, c = pts[max(0, i - 1)], pts[i], pts[min(len(pts) - 1, i + 1)]
    d1 = math.atan2(b[0] - a[0], b[1] - a[1]); d2 = math.atan2(c[0] - b[0], c[1] - b[1])
    turn = abs((d2 - d1 + math.pi) % (2 * math.pi) - math.pi)
    return math.degrees(turn) <= max_turn_deg


def resample(pts, step):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, math.ceil(L / step))
        for t in range(1, k + 1):
            out.append((a[0] + (b[0] - a[0]) * t / k, a[1] + (b[1] - a[1]) * t / k))
    return out


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def bridge_pieces(root, chunks):
    """Only the bridged PART of each segment: Overture's flag carries a `between` range (fraction of the
    segment length); the tiles keep the flag for the whole segment, so the raw parquet is used here."""
    import pyarrow.parquet as pq
    from shapely import wkb
    from shapely.ops import substring
    from shapely.geometry import LineString
    sys.path.insert(0, os.path.join(root, "pipeline"))
    from ub6pipeline.geo import LocalFrame
    frame = LocalFrame()
    info = {}
    for d in chunks.values():
        for r in d["roads"]:
            info.setdefault(r["id"], r)
    pieces = []
    for r in pq.read_table(os.path.join(root, "data/raw/segment.parquet")).to_pylist():
        if r["subtype"] != "road" or r["id"] not in info:
            continue
        ranges = [f.get("between") for f in (r.get("road_flags") or []) if "is_bridge" in (f.get("values") or [])]
        if not ranges:
            continue
        g = wkb.loads(r["geometry"])
        e, n, _ = frame.to_enu([c[1] for c in g.coords], [c[0] for c in g.coords])
        line = LineString(list(zip(map(float, e), map(float, n))))
        t = info[r["id"]]
        for rg in ranges:
            part = line if rg is None else substring(line, rg[0], rg[1], normalized=True)
            if part.geom_type != "LineString" or part.length < 3:
                continue
            pieces.append({"ids": [r["id"]], "cls": t["class"], "name": t["name"], "name_en": t["name_en"],
                           "width": t["width"], "pts": list(part.coords)})
    return pieces


def build_bridges(pieces, terrain):
    out = []
    for b in join(pieces):
        pts = resample(b["pts"], STEP_M)
        s = [0.0]
        for a, c in zip(pts, pts[1:]):
            s.append(s[-1] + math.hypot(c[0] - a[0], c[1] - a[1]))
        L = s[-1]
        if L < 6:
            continue
        h0 = terrain.height(*pts[0])
        h1 = terrain.height(*pts[-1])
        if h0 is None or h1 is None:
            continue
        H = clearance_for(L, b["cls"])
        ramp = max(8.0, min(45.0, L * 0.3))
        deck = []
        for (e, n), si in zip(pts, s):
            base = h0 + (h1 - h0) * si / L
            y = base + H * smooth(si / ramp) * smooth((L - si) / ramp)
            ground = terrain.height(e, n)
            if ground is not None:
                y = max(y, ground + 0.15)
            deck.append([round(e, 2), round(n, 2), round(y, 2)])
        out.append({"ids": b["ids"], "name": b["name"], "name_en": b["name_en"], "class": b["cls"],
                    "width": round(b["width"], 2), "length_m": round(L, 1), "clearance_m": H,
                    "deck_height_src": "estimated_from_length", "pts": deck})
    out.sort(key=lambda b: -b["length_m"])
    return out


def build_rail(root):
    import pyarrow.parquet as pq
    from shapely import wkb
    sys.path.insert(0, os.path.join(root, "pipeline"))
    from ub6pipeline.geo import LocalFrame
    frame = LocalFrame()
    lines = []
    for r in pq.read_table(os.path.join(root, "data/raw/segment.parquet")).to_pylist():
        if r["subtype"] != "rail":
            continue
        g = wkb.loads(r["geometry"])
        coords = list(g.coords)
        e, n, _ = frame.to_enu([c[1] for c in coords], [c[0] for c in coords])
        flags = []
        for f in r.get("road_flags") or []:
            flags += f.get("values") or []
        lines.append({"id": r["id"][:12], "class": r["class"], "flags": sorted(set(flags)),
                      "pts": [[round(float(a), 2), round(float(b), 2)] for a, b in zip(e, n)]})
    return lines


def main(root):
    chunks = {}
    for f in glob.glob(os.path.join(root, "data/tiles/chunks/*.json")):
        d = json.load(open(f))
        chunks[tuple(d["chunk"])] = d
    terrain = Terrain(chunks)
    bridges = build_bridges(bridge_pieces(root, chunks), terrain)
    meta = {"format": "ub6-bridges-v1", "source": "Overture Maps transportation segments (is_bridge flag)",
            "note": "deck heights are estimates (clearance from bridge length), positions and widths are data"}
    json.dump({**meta, "bridges": bridges}, open(os.path.join(root, "data/tiles/bridges.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    rail = build_rail(root)
    json.dump({"format": "ub6-rail-v1", "source": "Overture Maps transportation segments (subtype rail)", "lines": rail},
              open(os.path.join(root, "data/tiles/rail.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    for b in bridges[:12]:
        print(f'{b["length_m"]:7.1f} m  clear {b["clearance_m"]}  {b["class"]:10s} {b["name"]}')
    print(len(bridges), "bridges,", len(rail), "rail lines")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
