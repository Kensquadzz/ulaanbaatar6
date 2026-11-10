"""WGS84 <-> local East/North/Up. Mirrors core/src/Geo.cpp exactly (tested against it)."""
import math

import numpy as np

from . import config

_A = 6378137.0
_F = 1.0 / 298.257223563
_E2 = _F * (2.0 - _F)


def _ecef(lat_deg, lon_deg, h=0.0):
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    s, c = np.sin(lat), np.cos(lat)
    n = _A / np.sqrt(1.0 - _E2 * s * s)
    return (n + h) * c * np.cos(lon), (n + h) * c * np.sin(lon), (n * (1.0 - _E2) + h) * s


class LocalFrame:
    def __init__(self, lat0=config.ORIGIN_LAT, lon0=config.ORIGIN_LON):
        self.lat0, self.lon0 = lat0, lon0
        self.o = _ecef(lat0, lon0)
        la, lo = math.radians(lat0), math.radians(lon0)
        sl, cl, so, co = math.sin(la), math.cos(la), math.sin(lo), math.cos(lo)
        self.r = np.array([[-so, co, 0.0], [-sl * co, -sl * so, cl], [cl * co, cl * so, sl]])

    def to_enu(self, lat_deg, lon_deg, h=0.0):
        """Vectorised. Returns (east, north, up) in metres."""
        x, y, z = _ecef(np.asarray(lat_deg, float), np.asarray(lon_deg, float), h)
        d = np.stack([x - self.o[0], y - self.o[1], z - self.o[2]])
        e, n, u = np.tensordot(self.r, d, axes=1)
        return e, n, u

    def to_geo(self, east, north, up=0.0):
        x, y, z = self.r.T @ np.array([east, north, up]) + np.array(self.o)
        lon = math.atan2(y, x)
        p = math.hypot(x, y)
        lat = math.atan2(z, p * (1 - _E2))
        h = 0.0
        for _ in range(6):
            s = math.sin(lat)
            n = _A / math.sqrt(1 - _E2 * s * s)
            h = p / math.cos(lat) - n
            lat = math.atan2(z, p * (1 - _E2 * n / (n + h)))
        return math.degrees(lat), math.degrees(lon), h


def chunk_of(east, north, size=config.CHUNK_SIZE_M):
    return int(math.floor(east / size)), int(math.floor(north / size))
