"""Checks on the pipeline maths and on the real generated tiles (skipped if not built)."""
import glob
import json
import math
import os
import subprocess

import pytest

from ub6pipeline import config
from ub6pipeline.geo import LocalFrame, chunk_of

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TILES = os.path.join(ROOT, "data", "tiles")
TOOL = os.path.join(ROOT, "core", "build", "ub6tool")
needs_tiles = pytest.mark.skipif(not os.path.exists(os.path.join(TILES, "manifest.json")), reason="tiles not built")


def test_origin_and_round_trip():
    f = LocalFrame()
    e, n, u = f.to_enu(config.ORIGIN_LAT, config.ORIGIN_LON)
    assert abs(e) < 1e-6 and abs(n) < 1e-6 and abs(u) < 1e-6
    lat, lon, h = f.to_geo(*[float(v) for v in f.to_enu(47.6469, 106.8194, 1366.0)])
    assert abs(lat - 47.6469) < 1e-9 and abs(lon - 106.8194) < 1e-9 and abs(h - 1366.0) < 1e-3


def test_scale_is_metric():
    f = LocalFrame()
    # One arc-minute of latitude is ~1853 m at this latitude.
    _, n, _ = f.to_enu(config.ORIGIN_LAT + 1 / 60, config.ORIGIN_LON)
    assert abs(float(n) - 1853.2) < 1.0
    e, _, _ = f.to_enu(config.ORIGIN_LAT, config.ORIGIN_LON + 0.01)
    assert abs(float(e) - 111320 * 0.01 * math.cos(math.radians(config.ORIGIN_LAT))) < 2.5


def test_chunk_of_floor_semantics():
    assert chunk_of(0.1, 0.1) == (0, 0) and chunk_of(-0.1, -0.1) == (-1, -1) and chunk_of(256.0, 511.9) == (1, 1)


@needs_tiles
def test_manifest_and_chunks_consistent():
    m = json.load(open(os.path.join(TILES, "manifest.json"), encoding="utf-8"))
    assert m["chunk_size_m"] == config.CHUNK_SIZE_M and m["origin"]["lat"] == config.ORIGIN_LAT
    assert len(m["chunks"]) == len(glob.glob(os.path.join(TILES, "chunks", "*.json")))
    s = m["stats"]
    assert s["buildings"] == s["buildings_height_source"] + s["buildings_height_estimated_from_floors"] + s["buildings_height_estimated_default"]
    assert s["roads"] > 5000 and s["buildings"] > 10000 and m["attribution"]
    assert max(c["bytes"] for c in m["chunks"]) < 600_000        # each chunk stays phone-sized
    roads = buildings = 0
    S = config.CHUNK_SIZE_M
    for c in m["chunks"]:
        d = json.load(open(os.path.join(TILES, "chunks", f"{c['x']}_{c['y']}.json"), encoding="utf-8"))
        assert len(d["height_grid_dm"]) == d["grid_n"] ** 2
        assert all(12000 < h < 18500 for h in d["height_grid_dm"])   # measured 1279..1748 m: Tuul valley to Bogd Khan slopes
        x0, y0 = c["x"] * S, c["y"] * S
        for r in d["roads"]:
            assert r["width_src"] in ("source", "estimated_from_class") and r["width"] > 0
            for x, y, z in r["pts"]:
                assert x0 - 0.02 <= x <= x0 + S + 0.02 and y0 - 0.02 <= y <= y0 + S + 0.02
        for b in d["buildings"]:
            assert b["height_src"] in ("source", "estimated_from_floors", "estimated_default") and b["height"] > 0
            assert all(len(r) >= 3 for r in b["rings"])
        roads += len(d["roads"]); buildings += len(d["buildings"])
    assert buildings == s["buildings"] and roads >= s["roads"]


@needs_tiles
def test_adjacent_chunks_share_terrain_edges():
    """No cracks: the east edge of a chunk equals the west edge of its neighbour."""
    a = json.load(open(os.path.join(TILES, "chunks", "0_0.json")))
    b = json.load(open(os.path.join(TILES, "chunks", "1_0.json")))
    n = a["grid_n"]
    assert [a["height_grid_dm"][j * n + n - 1] for j in range(n)] == [b["height_grid_dm"][j * n] for j in range(n)]


@needs_tiles
def test_key_landmarks_present_and_plausible():
    lm = json.load(open(os.path.join(TILES, "landmarks.json"), encoding="utf-8"))
    assert lm["not_found_in_source"] == []
    f = lm["found"]
    sq, z = f["sukhbaatar_square"], f["zaisan_hill"]
    assert math.hypot(sq["east"], sq["north"]) < 30                 # the origin is the square
    assert -4200 < z["north"] < -3600 and abs(z["east"]) < 400      # Zaisan is ~3.9 km due south
    assert z["ground_m"] - sq["ground_m"] > 40                      # and it is a hill
    assert f["government_palace"]["north"] > sq["north"]            # palace on the north side
    assert f["state_department_store"]["east"] < -500               # department store to the west
    assert f["blue_sky_tower"]["north"] < sq["north"]               # Blue Sky just south of the square


@needs_tiles
@pytest.mark.skipif(not os.path.exists(TOOL), reason="core not built")
def test_cpp_core_routes_on_generated_graph():
    lm = json.load(open(os.path.join(TILES, "landmarks.json"), encoding="utf-8"))["found"]
    a, b = lm["sukhbaatar_square"], lm["zaisan_square"]
    out = subprocess.run([TOOL, "route", os.path.join(TILES, "nav", "roadgraph.txt"), str(a["east"]), str(a["north"]),
                          str(b["east"]), str(b["north"]), "car"], capture_output=True, text=True)
    assert out.returncode == 0 and "found=1" in out.stdout
