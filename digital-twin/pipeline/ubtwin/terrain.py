"""Terrain heights from AWS Terrain Tiles (terrarium PNG, open data, public S3).

The web viewer streams the same tiles at the same zoom, so building bases computed here
line up with the terrain the user sees. Heights are metres above mean sea level as the
tiles encode them (SRTM/GMTED sources); they are not survey-grade.
"""
import io
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 14


def lonlat_to_tile(lon, lat, z):
    n = 2.0 ** z
    x = (np.asarray(lon) + 180.0) / 360.0 * n
    y = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def decode(png_bytes):
    rgb = np.asarray(Image.open(io.BytesIO(png_bytes)).convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


class Terrain:
    """Sparse bilinear sampler over the terrarium tiles that cover the given points."""

    def __init__(self, cache_dir, zoom=ZOOM):
        self.z = zoom
        self.cache = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.tiles = {}

    def _path(self, tx, ty):
        return os.path.join(self.cache, f"{self.z}_{tx}_{ty}.png")

    def _fetch(self, key):
        tx, ty = key
        p = self._path(tx, ty)
        if not os.path.exists(p):
            url = TERRAIN_URL.format(z=self.z, x=tx, y=ty)
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(url, timeout=60) as r:
                        data = r.read()
                    break
                except Exception:
                    if attempt == 3:
                        raise
            with open(p, "wb") as fh:
                fh.write(data)
        with open(p, "rb") as fh:
            return key, decode(fh.read())

    def ensure(self, lons, lats):
        x, y = lonlat_to_tile(lons, lats, self.z)
        keys = set()
        for dx in (-0.01, 0.0, 0.01):
            keys |= set(zip(np.floor(x + dx).astype(int).tolist(), np.floor(y + dx).astype(int).tolist()))
        missing = [k for k in keys if k not in self.tiles]
        with ThreadPoolExecutor(16) as pool:
            for key, arr in pool.map(self._fetch, missing):
                self.tiles[key] = arr

    def ensure_tile(self, tx, ty):
        self.tiles[(tx, ty)] = self._fetch((tx, ty))[1]

    def _gather(self, gx, gy):
        """Heights at integer global pixel coordinates (vectorised, grouped by tile)."""
        tx, ty = gx // 256, gy // 256
        px, py = gx - tx * 256, gy - ty * 256
        out = np.empty(len(gx), dtype=np.float64)
        keys = tx * 1_000_000 + ty
        order = np.argsort(keys, kind="stable")
        uniq, starts = np.unique(keys[order], return_index=True)
        bounds = list(starts) + [len(order)]
        for n, k in enumerate(uniq):
            sel = order[bounds[n]:bounds[n + 1]]
            key = (int(k // 1_000_000), int(k % 1_000_000))
            if key not in self.tiles:
                self.ensure_tile(*key)
            out[sel] = self.tiles[key][py[sel], px[sel]]
        return out

    def heights(self, lons, lats):
        """Bilinear heights (m) at the given WGS84 points."""
        lons = np.atleast_1d(np.asarray(lons, dtype=np.float64))
        lats = np.atleast_1d(np.asarray(lats, dtype=np.float64))
        x, y = lonlat_to_tile(lons, lats, self.z)
        gx = x * 256.0 - 0.5
        gy = y * 256.0 - 0.5
        ix = np.floor(gx).astype(np.int64)
        iy = np.floor(gy).astype(np.int64)
        fx, fy = gx - ix, gy - iy
        h00 = self._gather(ix, iy)
        h10 = self._gather(ix + 1, iy)
        h01 = self._gather(ix, iy + 1)
        h11 = self._gather(ix + 1, iy + 1)
        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy
