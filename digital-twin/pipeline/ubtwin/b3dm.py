"""Minimal writer for Batched 3D Model (b3dm) tiles with quantized glTF 2.0 geometry.

Geometry is written without normals; the viewer computes flat normals per pixel, which keeps
each building to two vertex rings (bottom, top). Positions are int16 (KHR_mesh_quantization)
in a local East-North-Up frame, compressed with EXT_meshopt_compression; the glTF node
matrix places them on the globe.
"""
import json
import struct

import meshoptimizer
import numpy as np

# glTF is y-up; Cesium rotates y-up to z-up with (x, y, z) -> (x, -z, y).
# We store local ENU (e, n, u) as glTF (e, u, -n), so that rotation gives back (e, n, u).
_A = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
_A_INV = np.linalg.inv(_A)


def _pad(b: bytes, n: int, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((-len(b)) % n)


def _encode_primitive(pos_g, idx, bid, centre, scale):
    """Quantise, reorder for the GPU vertex cache, and meshopt-encode one primitive.

    Vertex layout (8 bytes): int16 x, y, z position + uint16 batch id.
    """
    q = np.round((pos_g - centre) / scale).astype(np.int16)
    vert = np.zeros(len(q), dtype=[("p", np.int16, 3), ("b", np.uint16)])
    vert["p"] = q
    vert["b"] = bid
    idx = np.ascontiguousarray(idx, dtype=np.uint32)
    opt = np.zeros_like(idx)
    meshoptimizer.optimize_vertex_cache(opt, idx, len(idx), len(vert))
    raw = vert.view(np.uint8).reshape(len(vert), 8)
    dst = np.zeros_like(raw)
    nv = meshoptimizer.optimize_vertex_fetch(dst, opt, raw, len(opt), len(vert), 8)
    # optimize_vertex_fetch rewrites opt in place to the new vertex order and drops unused vertices
    dst = np.ascontiguousarray(dst[:nv])
    vert2 = dst.view(vert.dtype).reshape(-1)
    venc = meshoptimizer.encode_vertex_buffer(dst, nv, 8)
    ienc = meshoptimizer.encode_index_buffer(opt, len(opt), nv)
    return vert2, opt, venc, ienc


def build_glb(primitives, origin, R, color=(0.86, 0.84, 0.80, 1.0)) -> bytes:
    """primitives: list of (positions_enu float64[N,3], indices uint32[M], batch_ids uint16[N]).

    Geometry is compressed with EXT_meshopt_compression (supported by CesiumJS); the
    uncompressed buffer is a declared fallback with no data, as the extension allows.
    """
    meshoptimizer.encode_vertex_version(0)
    meshoptimizer.encode_index_version(1)
    allp = np.concatenate([p[0] for p in primitives])
    g = np.stack([allp[:, 0], allp[:, 2], -allp[:, 1]], axis=1)  # ENU -> glTF y-up
    lo, hi = g.min(axis=0), g.max(axis=0)
    centre = (lo + hi) / 2.0
    scale = np.maximum((hi - lo) / 65534.0, 1e-6)

    chunks, views, accessors, prims = [], [], [], []
    comp_off = 0
    fall_off = 0

    def add_view(enc, count, stride, mode, fall_len, target):
        nonlocal comp_off, fall_off
        data = _pad(enc, 4)
        views.append({"buffer": 1, "byteOffset": fall_off, "byteLength": fall_len,
                      **({"byteStride": stride} if target == 34962 else {}), "target": target,
                      "extensions": {"EXT_meshopt_compression": {
                          "buffer": 0, "byteOffset": comp_off, "byteLength": len(enc),
                          "byteStride": stride, "count": count, "mode": mode}}})
        chunks.append(data)
        comp_off += len(data)
        fall_off += fall_len + ((-fall_len) % 4)
        return len(views) - 1

    for pos, idx, bid in primitives:
        gp = np.stack([pos[:, 0], pos[:, 2], -pos[:, 1]], axis=1)
        vert, ind, venc, ienc = _encode_primitive(gp, idx, bid, centre, scale)
        vv = add_view(venc, len(vert), 8, "ATTRIBUTES", len(vert) * 8, 34962)
        q = vert["p"]
        accessors.append({"bufferView": vv, "byteOffset": 0, "componentType": 5122, "count": len(vert),
                          "type": "VEC3", "min": q.min(axis=0).astype(int).tolist(),
                          "max": q.max(axis=0).astype(int).tolist()})
        pa = len(accessors) - 1
        accessors.append({"bufferView": vv, "byteOffset": 6, "componentType": 5123, "count": len(vert),
                          "type": "SCALAR"})
        ba = len(accessors) - 1
        iv = add_view(ienc, len(ind), 2, "TRIANGLES", len(ind) * 2, 34963)
        accessors.append({"bufferView": iv, "componentType": 5123, "count": len(ind), "type": "SCALAR"})
        prims.append({"attributes": {"POSITION": pa, "_BATCHID": ba}, "indices": len(accessors) - 1,
                      "material": 0, "mode": 4})

    m_enu = np.eye(4)
    m_enu[:3, :3] = R
    m_enu[:3, 3] = origin
    deq = np.eye(4)
    deq[:3, :3] = np.diag(scale)
    deq[:3, 3] = centre
    node = _A @ m_enu @ _A_INV @ deq
    binary = b"".join(chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "ubtwin b3dm writer"},
        "extensionsUsed": ["KHR_mesh_quantization", "EXT_meshopt_compression"],
        "extensionsRequired": ["KHR_mesh_quantization", "EXT_meshopt_compression"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "matrix": node.T.flatten().tolist()}],
        "meshes": [{"primitives": prims}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": list(color), "metallicFactor": 0.0,
                                                 "roughnessFactor": 0.92}, "doubleSided": True}],
        "buffers": [{"byteLength": len(binary)},
                    {"byteLength": fall_off, "extensions": {"EXT_meshopt_compression": {"fallback": True}}}],
        "bufferViews": views,
        "accessors": accessors,
    }
    js = _pad(json.dumps(gltf, separators=(",", ":")).encode(), 4, b" ")
    total = 12 + 8 + len(js) + 8 + len(binary)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(binary), b"BIN\x00") + binary)


def build_b3dm(glb: bytes, batch_table: dict, batch_length: int) -> bytes:
    ft = json.dumps({"BATCH_LENGTH": batch_length}, separators=(",", ":")).encode()
    # header is 28 bytes; pad so that each section ends on an 8-byte boundary
    ft = ft + b" " * ((-(28 + len(ft))) % 8)
    bt = json.dumps(batch_table, separators=(",", ":"), ensure_ascii=False).encode()
    bt = bt + b" " * ((-(28 + len(ft) + len(bt))) % 8)
    glb = _pad(glb, 8)
    total = 28 + len(ft) + len(bt) + len(glb)
    header = struct.pack("<4sIIIIII", b"b3dm", 1, total, len(ft), 0, len(bt), 0)
    return header + ft + bt + glb
