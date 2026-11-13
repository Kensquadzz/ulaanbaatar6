"""Download real Overture Maps data for the whole Ulaanbaatar administrative territory.

Step 1 reads the Ulaanbaatar region polygon (Overture divisions, region MN-1) and takes
its bounding box; every other theme is then read only inside that box. Nothing is
generated or guessed here: these are unmodified Overture rows.

Usage: python -m ubtwin.fetch <raw_dir> [theme ...]
"""
import json
import os
import sys
import time

import pyarrow.dataset as ds
import pyarrow.parquet as pq
import shapely

from . import s3

# Wide search box around Mongolia's capital region, only used to find the real boundary.
SEARCH_BBOX = (105.8, 47.0, 108.6, 48.4)

THEMES = {
    "building": ("buildings", "building"),
    "building_part": ("buildings", "building_part"),
    "segment": ("transportation", "segment"),
    "water": ("base", "water"),
    "land_use": ("base", "land_use"),
    "land": ("base", "land"),
    "infrastructure": ("base", "infrastructure"),
    "place": ("places", "place"),
}


def fetch_boundary(raw_dir: str) -> tuple:
    d = s3.dataset("divisions", "division_area")
    flt = s3.bbox_filter(SEARCH_BBOX) & (ds.field("country") == "MN")
    t = d.to_table(filter=flt)
    pq.write_table(t, os.path.join(raw_dir, "division_area.parquet"))
    rows = [r for r in t.select(["subtype", "region", "geometry"]).to_pylist()
            if r["subtype"] == "region" and r["region"] == "MN-1"]
    if not rows:
        raise SystemExit("Ulaanbaatar region (MN-1) not found in Overture divisions")
    geom = shapely.from_wkb(rows[0]["geometry"])
    bbox = tuple(round(v, 4) for v in geom.bounds)
    with open(os.path.join(raw_dir, "bbox.json"), "w") as fh:
        json.dump({"bbox_wgs84": bbox, "source": "Overture divisions region MN-1",
                   "release": s3.OVERTURE_RELEASE}, fh)
    print("Ulaanbaatar bbox", bbox, flush=True)
    return bbox


def fetch_theme(key: str, raw_dir: str, bbox) -> None:
    theme, typ = THEMES[key]
    t0 = time.time()
    table = s3.dataset(theme, typ).to_table(filter=s3.bbox_filter(bbox))
    out = os.path.join(raw_dir, f"{key}.parquet")
    pq.write_table(table, out, compression="zstd")
    print(f"{key}: {table.num_rows} rows in {time.time()-t0:.0f}s -> {out}", flush=True)


if __name__ == "__main__":
    raw = sys.argv[1]
    os.makedirs(raw, exist_ok=True)
    box = fetch_boundary(raw)
    for k in (sys.argv[2:] or list(THEMES)):
        fetch_theme(k, raw, box)
