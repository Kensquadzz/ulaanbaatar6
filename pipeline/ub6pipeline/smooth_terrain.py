"""Removes DEM noise from the chunk height grids (data/tiles/chunks/*.json, height_grid_dm).

WHY: the terrain source (AWS Terrain Tiles, zoom 13, ~15 m cells) is a mix of SRTM and other
surface models. In the city it carries bumps of several metres from buildings and resampling, so
flat places like Sukhbaatar Square showed up as hills and dips in the game (owner's iPhone test,
2026-11-13).

WHAT IT DOES (documented, reproducible, nothing invented):
  1. Gaussian filter (sigma 24 m) over the whole slice, but each sample may move at most 4 m, so
     real hills and the river valley keep their shape while small artefacts go.
  2. Every mapped pedestrian square / plaza (Overture land_use subtype "pedestrian", > 1500 m2) is
     replaced by the least-squares PLANE through its own samples: it stays at its real height and
     keeps its real overall slope, just without the bumps. Edges blend over one cell.
  3. Real hillsides (Zaisan, Bogd Khan foothills) keep their raw DEM: where the 64 m-scale slope is
     over ~10 %, the filter fades out, so the filter no longer shaves hilltops (owner, 2026-11-13).
  4. Monument sites get a level pad at the median raw ground height around them (the DEM summit at
     Zaisan carries the memorial structure itself, ~7 m): SITES below, pad radius then blend.
The unfiltered grid is kept per chunk as `height_grid_raw_dm`, and the manifest records the filter.

Usage: python -m ub6pipeline.smooth_terrain <repo root>
"""
import glob
import json
import math
import os
import sys

import numpy as np

N = 17
CELL = 16.0
CHUNK = 256.0
SIGMA_M = 24.0
MAX_CHANGE_M = 4.0
# (name, centre east, centre north, pad radius m, blend radius m, ring for the ground sample m)
# centres: Zaisan = OSM footway ring round the memorial; Buddha = OSM footway ring round the statue
SITES = [
    ("Zaisan memorial", -156.0, -3879.0, 16.0, 34.0, (18.0, 30.0)),
    ("Buddha statue park", -409.5, -3587.0, 16.0, 30.0, (0.0, 30.0)),
]


def point_in_ring(ring, e, n):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        ei, ni = ring[i]; ej, nj = ring[j]
        if (ni > n) != (nj > n) and e < (ej - ei) * (n - ni) / (nj - ni) + ei:
            inside = not inside
        j = i
    return inside


def ring_area(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2


def main(root):
    files = glob.glob(os.path.join(root, "data/tiles/chunks/*.json"))
    chunks = {}
    for f in files:
        d = json.load(open(f))
        chunks[tuple(d["chunk"])] = (f, d)
    xs = [k[0] for k in chunks]; ys = [k[1] for k in chunks]
    x0, y0 = min(xs), min(ys)
    W = (max(xs) - x0 + 1) * (N - 1) + 1
    H = (max(ys) - y0 + 1) * (N - 1) + 1
    grid = np.full((H, W), np.nan)
    for (cx, cy), (_, d) in chunks.items():
        src = d.get("height_grid_raw_dm") or d["height_grid_dm"]
        g = np.array(src, float).reshape(N, N) / 10.0
        gy, gx = (cy - y0) * (N - 1), (cx - x0) * (N - 1)
        grid[gy:gy + N, gx:gx + N] = g
    raw = grid.copy()
    mask = ~np.isnan(grid)
    filled = np.where(mask, grid, np.nanmean(grid))

    # 1) separable gaussian, normalised by the valid mask
    s = SIGMA_M / CELL
    r = int(math.ceil(3 * s))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2); k /= k.sum()
    def blur(a):
        a = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), k, mode="valid"), 1, a)
        return np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), k, mode="valid"), 0, a)
    sm = blur(filled * mask) / np.maximum(blur(mask.astype(float)), 1e-6)
    out = raw + np.clip(sm - raw, -MAX_CHANGE_M, MAX_CHANGE_M)
    # 3) keep real hillsides: fade the filter out where the broad slope is steep
    big = blur(blur(filled * mask)) / np.maximum(blur(blur(mask.astype(float))), 1e-6)
    gy_, gx_ = np.gradient(big, CELL)
    w = np.clip((np.hypot(gx_, gy_) - 0.07) / 0.05, 0.0, 1.0)
    out = np.where(mask, out * (1 - w) + raw * w, out)

    # 2) plazas -> fitted planes (pieces of one plaza in several chunks share one plane)
    plazas = {}
    for (_, d) in chunks.values():
        for a in d["land_use"]:
            if a.get("subtype") == "pedestrian" and a.get("ring") and len(a["ring"]) >= 3:
                plazas.setdefault(a["id"], {"name": a.get("name"), "rings": []})["rings"].append(a["ring"])
    done = []
    for pid, p in plazas.items():
        area = sum(ring_area(rg) for rg in p["rings"])
        if area < 1500:
            continue
        es = [q[0] for rg in p["rings"] for q in rg]; ns = [q[1] for rg in p["rings"] for q in rg]
        i0 = max(0, int((min(es) - x0 * CHUNK) // CELL) - 1); i1 = min(W - 1, int((max(es) - x0 * CHUNK) // CELL) + 2)
        j0 = max(0, int((min(ns) - y0 * CHUNK) // CELL) - 1); j1 = min(H - 1, int((max(ns) - y0 * CHUNK) // CELL) + 2)
        inside, edge = [], []
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                if not mask[j, i]:
                    continue
                e = x0 * CHUNK + i * CELL; n = y0 * CHUNK + j * CELL
                if any(point_in_ring(rg, e, n) for rg in p["rings"]):
                    inside.append((j, i, e, n))
                elif any(point_in_ring(rg, e + de, n + dn) for rg in p["rings"] for de, dn in ((CELL, 0), (-CELL, 0), (0, CELL), (0, -CELL))):
                    edge.append((j, i, e, n))
        if len(inside) < 3:
            continue
        A = np.array([[e, n, 1.0] for (_, _, e, n) in inside]); b = np.array([out[j, i] for (j, i, _, _) in inside])
        coef, *_ = np.linalg.lstsq(A, b, rcond=None)
        for (j, i, e, n) in inside:
            out[j, i] = coef[0] * e + coef[1] * n + coef[2]
        for (j, i, e, n) in edge:
            out[j, i] = 0.5 * out[j, i] + 0.5 * (coef[0] * e + coef[1] * n + coef[2])
        done.append((p["name"], round(area), len(inside), round(float(np.std(b)), 2)))

    # 4) level pads for monument sites
    pads = []
    for name, ce, cn, pad, blend, (r0, r1) in SITES:
        cells = []
        for j in range(H):
            for i in range(W):
                if not mask[j, i]:
                    continue
                e = x0 * CHUNK + i * CELL; n = y0 * CHUNK + j * CELL
                dist = math.hypot(e - ce, n - cn)
                if dist <= blend:
                    cells.append((j, i, dist))
        ring = [raw[j, i] for (j, i, dd) in cells if r0 <= dd <= r1]
        if not ring:
            continue
        h = float(np.median(ring))
        for (j, i, dd) in cells:
            t = 0.0 if dd <= pad else min(1.0, (dd - pad) / (blend - pad))
            t = t * t * (3 - 2 * t)
            out[j, i] = h * (1 - t) + out[j, i] * t
        pads.append((name, round(h, 1)))

    for (cx, cy), (f, d) in chunks.items():
        gy, gx = (cy - y0) * (N - 1), (cx - x0) * (N - 1)
        if "height_grid_raw_dm" not in d:
            d["height_grid_raw_dm"] = d["height_grid_dm"]
        d["height_grid_dm"] = [int(round(v * 10)) for v in out[gy:gy + N, gx:gx + N].reshape(-1)]
        json.dump(d, open(f, "w"), ensure_ascii=False, separators=(",", ":"))
    mf = os.path.join(root, "data/tiles/manifest.json")
    m = json.load(open(mf))
    m["terrain_filter"] = {"method": "gaussian sigma 24 m, change capped at 4 m, faded out on hillsides (broad slope > 7-12 %); pedestrian plazas > 1500 m2 set to their least-squares plane; level pads at monument sites (median raw ground around them)",
                           "pads": pads,
                           "script": "pipeline/ub6pipeline/smooth_terrain.py", "raw_kept_as": "height_grid_raw_dm"}
    json.dump(m, open(mf, "w"), ensure_ascii=False, separators=(",", ":"))
    diff = np.abs(out - raw)[mask]
    print("pads", pads)
    print(f"changed: mean {diff.mean():.2f} m, max {diff.max():.2f} m; plazas flattened: {len(done)}")
    for x in sorted(done, key=lambda t: -t[1])[:8]:
        print("  ", x)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
