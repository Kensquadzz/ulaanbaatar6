"""WGS84 helpers: geodetic <-> ECEF and local East-North-Up frames (numpy, float64)."""
import math

import numpy as np

A = 6378137.0
F = 1.0 / 298.257223563
E2 = F * (2.0 - F)


def to_ecef(lon_deg, lat_deg, h):
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    h = np.asarray(h, dtype=np.float64)
    sl, cl = np.sin(lat), np.cos(lat)
    n = A / np.sqrt(1.0 - E2 * sl * sl)
    x = (n + h) * cl * np.cos(lon)
    y = (n + h) * cl * np.sin(lon)
    z = (n * (1.0 - E2) + h) * sl
    return np.stack([x, y, z], axis=-1)


def enu_frame(lon_deg, lat_deg, h=0.0):
    """Return (origin_ecef[3], R[3x3]) where R's columns are the east, north, up unit vectors."""
    lon, lat = math.radians(lon_deg), math.radians(lat_deg)
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north = np.array([-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)])
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    return to_ecef(lon_deg, lat_deg, h), np.stack([east, north, up], axis=1)


def ecef_to_enu(points, origin, R):
    return (np.asarray(points) - origin) @ R


def polygon_area_m2(lons, lats):
    """Planar area of a small lon/lat ring using a local equirectangular projection."""
    lat0 = math.radians(float(np.mean(lats)))
    x = np.radians(lons) * A * math.cos(lat0)
    y = np.radians(lats) * A
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
