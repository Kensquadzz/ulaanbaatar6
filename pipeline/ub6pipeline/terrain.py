"""Terrain heights from AWS Terrain Tiles (terrarium PNG encoding)."""
import io
import math
import os
import urllib.request

import numpy as np
from PIL import Image

from . import config


def _tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


class Terrain:
    """Bilinear height sampler over a mosaic of terrarium tiles covering a bbox."""

    def __init__(self, bbox, cache_dir, zoom=config.TERRAIN_ZOOM, margin_deg=0.01):
        w, s, e, n = bbox
        w, s, e, n = w - margin_deg, s - margin_deg, e + margin_deg, n + margin_deg
        self.z = zoom
        x0, y0 = _tile_xy(n, w, zoom)
        x1, y1 = _tile_xy(s, e, zoom)
        self.tx0, self.ty0 = int(x0), int(y0)
        tx1, ty1 = int(x1), int(y1)
        os.makedirs(cache_dir, exist_ok=True)
        rows = []
        for ty in range(self.ty0, ty1 + 1):
            rows.append(np.hstack([self._load(tx, ty, cache_dir) for tx in range(self.tx0, tx1 + 1)]))
        self.h = np.vstack(rows)

    def _load(self, tx, ty, cache_dir):
        path = os.path.join(cache_dir, f"terrarium_{self.z}_{tx}_{ty}.png")
        if not os.path.exists(path):
            url = config.TERRAIN_URL.format(z=self.z, x=tx, y=ty)
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
        rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
        return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0

    def height(self, lat, lon):
        x, y = _tile_xy(lat, lon, self.z)
        px = (x - self.tx0) * 256.0 - 0.5
        py = (y - self.ty0) * 256.0 - 0.5
        px = min(max(px, 0.0), self.h.shape[1] - 1.001)
        py = min(max(py, 0.0), self.h.shape[0] - 1.001)
        ix, iy = int(px), int(py)
        fx, fy = px - ix, py - iy
        h = self.h
        return float((h[iy, ix] * (1 - fx) + h[iy, ix + 1] * fx) * (1 - fy)
                     + (h[iy + 1, ix] * (1 - fx) + h[iy + 1, ix + 1] * fx) * fy)
