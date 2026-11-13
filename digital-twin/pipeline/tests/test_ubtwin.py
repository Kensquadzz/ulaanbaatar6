"""Engine-independent checks of the ULAANBAATAR 3D pipeline (run: python -m pytest tests)."""
import json
import os
import struct

import meshoptimizer
import numpy as np
import shapely

from ubtwin import b3dm, geo
from ubtwin.build_buildings import building_mesh

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "web", "public", "data")


def test_enu_frame_is_orthonormal_and_up_points_away():
    origin, R = geo.enu_frame(106.9176, 47.9189, 0.0)
    assert np.allclose(R.T @ R, np.eye(3), atol=1e-12)
    up = R[:, 2]
    assert np.dot(up, origin / np.linalg.norm(origin)) > 0.99


def test_ecef_known_point():
    # Equator / prime meridian at sea level is (a, 0, 0)
    assert np.allclose(geo.to_ecef(0.0, 0.0, 0.0), [6378137.0, 0, 0])


def _square_building(h=10.0):
    poly = shapely.Polygon([(106.9, 47.9), (106.9001, 47.9), (106.9001, 47.9001), (106.9, 47.9001)])
    return {"polys": [poly], "g0": 1300.0, "top": 1300.0 + h, "lat": 47.90005, "lon": 106.90005}


def test_building_mesh_has_walls_and_roof():
    origin, R = geo.enu_frame(106.90005, 47.90005, 0.0)
    pos, idx = building_mesh(_square_building(), origin, R)
    assert pos.shape == (8, 3)              # 4 bottom + 4 top vertices
    assert len(idx) == 4 * 6 + 2 * 3        # 4 wall quads + 2 roof triangles
    heights = sorted(set(np.round(pos[:, 2], 1)))
    assert abs(heights[-1] - heights[0] - 10.0) < 0.05


def test_b3dm_layout_and_meshopt_roundtrip():
    origin, R = geo.enu_frame(106.90005, 47.90005, 0.0)
    pos, idx = building_mesh(_square_building(), origin, R)
    glb = b3dm.build_glb([(pos, idx, np.zeros(len(pos), dtype=np.uint16))], origin, R)
    data = b3dm.build_b3dm(glb, {"hs": [2], "height": [3.0]}, 1)
    magic, version, length, ftj, ftb, btj, btb = struct.unpack("<4sIIIIII", data[:28])
    assert magic == b"b3dm" and version == 1 and length == len(data)
    assert (28 + ftj) % 8 == 0 and (28 + ftj + btj) % 8 == 0
    assert json.loads(data[28:28 + ftj]) == {"BATCH_LENGTH": 1}
    g = data[28 + ftj + btj:]
    assert g[:4] == b"glTF"
    jlen = struct.unpack("<I", g[12:16])[0]
    gltf = json.loads(g[20:20 + jlen])
    binary = g[20 + jlen + 8:]
    assert "EXT_meshopt_compression" in gltf["extensionsRequired"]
    vview = gltf["bufferViews"][gltf["accessors"][0]["bufferView"]]["extensions"]["EXT_meshopt_compression"]
    raw = binary[vview["byteOffset"]:vview["byteOffset"] + vview["byteLength"]]
    verts = meshoptimizer.decode_vertex_buffer(vview["count"], 8, raw)
    assert verts.size * verts.itemsize == vview["count"] * 8
    # node matrix maps the quantised box back onto the globe near the building
    m = np.array(gltf["nodes"][0]["matrix"]).reshape(4, 4).T
    acc = gltf["accessors"][0]
    centre_q = (np.array(acc["min"]) + np.array(acc["max"])) / 2
    p_gltf = m @ np.append(centre_q, 1.0)
    p_ecef = np.array([p_gltf[0], -p_gltf[2], p_gltf[1]])  # glTF y-up -> Cesium z-up
    expected = geo.to_ecef(106.90005, 47.90005, 1305.0)
    assert np.linalg.norm(p_ecef - expected) < 2.0


def test_generated_data_is_consistent():
    if not os.path.exists(os.path.join(DATA, "buildings", "tileset.json")):
        return
    ts = json.load(open(os.path.join(DATA, "buildings", "tileset.json")))
    ex = ts["extras"]
    assert sum(ex["heightSource"].values()) == ex["buildings"]
    boundary = json.load(open(os.path.join(DATA, "boundary.geojson")))
    districts = [f for f in boundary["features"] if f["properties"]["kind"] == "district"]
    assert len(districts) == 9
    names = {f["properties"]["name_en"] for f in districts}
    assert {"Nalaikh District", "Baganuur District", "Bagakhangai District"} <= names
