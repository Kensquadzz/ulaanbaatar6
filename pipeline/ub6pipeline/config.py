"""Shared configuration for the Phase 1 slice: Sukhbaatar Square -> Peace Avenue -> Zaisan."""
from dataclasses import dataclass

# World origin: centre of Sukhbaatar Square (WGS84). All game coordinates are
# metres East/North/Up from this point, so floats stay small and precise.
ORIGIN_LAT = 47.918873
ORIGIN_LON = 106.917580

# Phase 1 bounding box (west, south, east, north) in WGS84 degrees.
SLICE_BBOX = (106.885, 47.872, 106.950, 47.930)

OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_RELEASE = "2026-10-21.0"
OVERTURE_THEMES = {
    "segment": "theme=transportation/type=segment",
    "building": "theme=buildings/type=building",
    "water": "theme=base/type=water",
    "place": "theme=places/type=place",
    "land_use": "theme=base/type=land_use",
}

# Streaming chunk edge in metres. 256 m keeps a 3x3 neighbourhood under ~0.6 km2,
# small enough for entry-level phones.
CHUNK_SIZE_M = 256.0

TERRAIN_ZOOM = 13  # AWS Terrain Tiles (terrarium), ~14 m/pixel at 48N
TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

ATTRIBUTION = [
    "Roads, buildings, water, places: Overture Maps Foundation (overturemaps.org), "
    "includes (c) OpenStreetMap contributors, ODbL / CDLA-Permissive-2.0",
    "Terrain: AWS Terrain Tiles (Mapzen/Tilezen; SRTM, public-domain and open sources)",
]


@dataclass(frozen=True)
class LaneDefaults:
    """Road widths used ONLY when the source has no width. Flagged estimated."""
    lane_width_m: float = 3.3
