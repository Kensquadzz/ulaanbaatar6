"""District (duureg) outlines for the slice, from Overture Maps divisions (open data).

Reads the `division_area` rows that touch SLICE_BBOX, keeps the Ulaanbaatar districts (subtype
`county`), clips them to the slice plus a margin and writes them in the game's East/North metres.
Nothing is drawn by hand: the outlines are the source polygons, clipped and lightly simplified (2 m).

Usage: python -m ub6pipeline.build_districts <division_area.parquet> <out.json>
       (fetch the parquet with: fetch_overture.fetch('division_area', dir) after adding
        'division_area': 'theme=divisions/type=division_area' to config.OVERTURE_THEMES)
"""
import json
import sys

import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import box

from . import config
from .geo import LocalFrame

MARGIN_DEG = 0.004


def build(parquet_path: str, out_path: str) -> dict:
    frame = LocalFrame(config.ORIGIN_LAT, config.ORIGIN_LON)
    w, s, e, n = config.SLICE_BBOX
    clip = box(w - MARGIN_DEG, s - MARGIN_DEG, e + MARGIN_DEG, n + MARGIN_DEG)
    out = []
    for r in pq.read_table(parquet_path).to_pylist():
        if r["subtype"] != "county" or r["country"] != "MN":
            continue
        g = wkb.loads(r["geometry"]).intersection(clip)
        if g.is_empty:
            continue
        common = dict(r["names"].get("common") or {})
        name_mn = common.get("mn") or r["names"]["primary"]
        if "дүүрэг" not in name_mn:
            name_mn = name_mn.split(" ")[0] + " дүүрэг"
        rings = []
        for poly in (g.geoms if hasattr(g, "geoms") else [g]):
            if poly.geom_type != "Polygon":
                continue
            pts = [frame.to_enu(lat, lon)[:2] for lon, lat in poly.exterior.coords]
            from shapely.geometry import Polygon
            simp = Polygon(pts).simplify(2.0)
            rings.append([[round(x, 1), round(y, 1)] for x, y in simp.exterior.coords])
        out.append({"id": r["id"], "name": name_mn, "name_en": (common.get("en") or "") + " District", "rings": rings})
    doc = {
        "format": "ub6-districts-v1",
        "source": f"Overture Maps divisions {config.OVERTURE_RELEASE} (division_area, subtype county), clipped to the slice",
        "districts": sorted(out, key=lambda d: d["name"]),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    return doc


if __name__ == "__main__":
    d = build(sys.argv[1], sys.argv[2])
    for x in d["districts"]:
        print(x["name"], x["name_en"], [len(r) for r in x["rings"]])
