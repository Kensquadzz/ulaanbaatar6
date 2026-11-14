"""V2 reconstruction layer: documented classification and estimates on top of the raw data.

Nothing here moves or reshapes a source feature. It only ADDS fields, and every added field
carries a *_src that says how it was obtained:

  arch / arch_src            architectural category used to pick a facade
      source_class             the footprint's own class/subtype in the source
      inferred_from_place      an Overture place (confidence >= 0.7) lies inside the footprint
      inferred_from_land_use   the footprint lies inside a mapped land-use polygon
      estimated_from_neighbours  majority of nearby classified buildings of similar size
      estimated_from_shape     last resort, footprint size only
  vis_height / vis_height_src height used for drawing
      source                   surveyed/tagged height in the source          (verified)
      estimated_from_floors    floors in the source x 3.0 m                  (estimate)
      estimated_from_neighbours median storeys of nearby similar buildings    (estimate)
      estimated_from_class     category + footprint area table               (estimate)

"Soviet-era" versus "modern" housing is NOT recorded in any open dataset for Ulaanbaatar.
It is estimated from storey count and footprint shape (see `_housing_kind`) and is flagged.
"""
import math
from collections import Counter

import numpy as np
from shapely import STRtree
from shapely.geometry import Point

FLOOR_M = 3.0
ARCH = ("soviet_apartment", "residential", "glass_tower", "commercial", "mall", "government",
        "education", "industrial", "house", "ger", "medical", "religious", "hotel", "utility")
# Storey height by category, used only for estimates.
FLOOR_BY_ARCH = {"commercial": 3.6, "mall": 4.5, "glass_tower": 3.7, "government": 4.0, "education": 3.6,
                 "industrial": 5.0, "medical": 3.6, "religious": 4.0, "hotel": 3.3}

_HOUSE = {"house", "detached", "terrace", "semidetached_house", "bungalow", "cabin", "hut"}
_UTIL = {"garage", "garages", "shed", "roof", "shelter", "guardhouse", "toilets", "service", "carport",
         "kiosk", "parking", "transformer_tower"}
_HOME = {"apartments", "residential", "dormitory"}

PLACE_TO_ARCH = {
    "hotel": "hotel", "lodging": "hotel", "shopping_mall": "mall", "department_store": "mall",
    "government_office": "government", "embassy": "government", "courthouse": "government",
    "police_station": "government", "community_and_government": "government",
    "college_university": "education", "high_school": "education", "elementary_school": "education",
    "preschool": "education", "education": "education", "place_of_learning": "education",
    "campus_building": "education", "library": "education",
    "hospital": "medical", "health_care": "medical", "specialized_health_care": "medical",
    "buddhist_place_of_worship": "religious", "christian_place_of_worship": "religious",
    "religious_organization": "religious", "manufacturer": "industrial",
    "corporate_or_business_office": "commercial", "bank_or_credit_union": "commercial",
    "financial_service": "commercial", "restaurant": "commercial", "shopping": "commercial",
    "fashion_and_apparel_store": "commercial", "food_and_beverage_store": "commercial",
    "museum": "government", "theatre_venue": "government", "movie_theater": "commercial",
}
# A whole building is only re-labelled from a place when the place type normally owns the building.
_STRONG_PLACE = {"hotel", "mall", "government", "education", "medical", "religious", "industrial"}
LAND_TO_ARCH = {"school": "education", "kindergarten": "education", "university": "education",
                "college": "education", "hospital": "medical", "industrial": "industrial",
                "retail": "commercial", "commercial": "commercial", "religious": "religious",
                "garages": "utility", "base": "government"}


def _elongation(geom):
    r = geom.minimum_rotated_rectangle
    if r.geom_type != "Polygon":
        return 1.0
    xs, ys = r.exterior.coords.xy
    a = math.hypot(xs[1] - xs[0], ys[1] - ys[0])
    b = math.hypot(xs[2] - xs[1], ys[2] - ys[1])
    lo, hi = sorted((a, b))
    return hi / lo if lo > 0.5 else 1.0


def _housing_kind(floors, area, elong):
    """Soviet-era slab versus later tower. An ESTIMATE: construction year is not in the data.

    Ulaanbaatar's socialist-period housing is 4-5 storey brick/panel walk-ups and 9 and 12 storey
    panel slabs, all long and narrow. Later housing is mostly 12+ storey point towers.
    """
    if floors is None:
        return "soviet_apartment" if elong >= 2.2 else "residential"
    if floors <= 5:
        return "soviet_apartment"
    if floors <= 12 and elong >= 2.0:
        return "soviet_apartment"
    return "residential"


def classify(b):
    """Category from the footprint's own source tags. Returns (arch, src) or (None, None)."""
    cls, sub, fl, h = b["class"], b["subtype"], b["floors"], b["height"]
    tall = (fl or 0) >= 10 or (h or 0) >= 35
    if cls == "ger":
        return "ger", "source_class"
    if cls in _HOUSE:
        return "house", "source_class"
    if cls in _UTIL or sub in ("outbuilding", "service"):
        return "utility", "source_class"
    if sub == "education" or cls in ("school", "university", "college", "kindergarten", "library"):
        return "education", "source_class"
    if sub == "medical" or cls == "hospital":
        return "medical", "source_class"
    if sub == "religious" or cls in ("temple", "church", "monastery"):
        return "religious", "source_class"
    if sub in ("industrial", "transportation") or cls in ("warehouse", "manufacture", "industrial"):
        return "industrial", "source_class"
    if sub in ("civic", "military") or cls in ("public", "government", "post_office"):
        return "government", "source_class"
    if cls == "hotel":
        return "hotel", "source_class"
    if cls in ("retail", "supermarket"):
        return ("mall" if b["area"] >= 3000 else "commercial"), "source_class"
    if cls in ("office", "commercial") or sub == "commercial":
        return ("glass_tower" if tall else "commercial"), "source_class"
    if cls in _HOME or sub == "residential":
        return _housing_kind(fl, b["area"], b["elong"]), "source_class"
    if cls in ("stadium", "sports_centre") or sub == "entertainment":
        return "government", "source_class"
    return None, None


def enrich_buildings(blds, places, land_use):
    """blds: dicts with geom (ENU polygon), class, subtype, floors, height, height_src, footprint_src.

    places: [(Point, category)], land_use: [(polygon, class)]. Adds arch/vis_height fields in place.
    """
    for b in blds:
        b["area"] = b["geom"].area
        b["elong"] = _elongation(b["geom"])
        b["arch"], b["arch_src"] = classify(b)

    tree = STRtree([b["geom"] for b in blds])
    # 1) places inside a footprint
    votes = {}
    for pt, cat in places:
        a = PLACE_TO_ARCH.get(cat)
        if not a:
            continue
        for i in tree.query(pt, predicate="within"):
            votes.setdefault(int(i), Counter())[a] += 1
    for i, c in votes.items():
        b = blds[i]
        if b["arch"] is None:
            strong = [a for a, _ in c.most_common() if a in _STRONG_PLACE]
            a = strong[0] if strong else c.most_common(1)[0][0]
            if a == "commercial" and ((b["floors"] or 0) >= 10 or (b["height"] or 0) >= 35):
                a = "glass_tower"
            b["arch"], b["arch_src"] = a, "inferred_from_place"
    # 2) land-use polygon around the footprint
    lu = [(g, LAND_TO_ARCH.get(c), c) for g, c in land_use if g.geom_type in ("Polygon", "MultiPolygon")]
    lu_tree = STRtree([g for g, _, _ in lu])
    for b in blds:
        if b["arch"] is not None:
            continue
        c = b["geom"].representative_point()
        hits = sorted((lu[int(i)] for i in lu_tree.query(c, predicate="within")), key=lambda t: t[0].area)
        for g, a, cls in hits:
            if a:
                # sheds and booths on a campus or factory site are not the main building type
                b["arch"], b["arch_src"] = ("utility" if b["area"] < 40 else a), "inferred_from_land_use"
                break
            if cls == "residential":
                small = b["area"] < 160
                b["arch"] = "house" if small else _housing_kind(b["floors"], b["area"], b["elong"])
                b["arch_src"] = "inferred_from_land_use"
                break
    # 3) neighbours: majority category of classified buildings within 150 m and similar footprint
    cent = np.array([[b["geom"].centroid.x, b["geom"].centroid.y] for b in blds])
    known = [i for i, b in enumerate(blds) if b["arch"] is not None and b["arch"] not in ("utility",)]
    ktree = STRtree([Point(*cent[i]) for i in known])
    for i, b in enumerate(blds):
        if b["arch"] is not None:
            continue
        near = ktree.query(Point(*cent[i]).buffer(150))
        c = Counter()
        for j in near:
            o = blds[known[int(j)]]
            if 0.4 <= o["area"] / max(b["area"], 1) <= 2.5:
                d = math.hypot(*(cent[known[int(j)]] - cent[i]))
                c[o["arch"]] += 1.0 / (20.0 + d)
        if c:
            a = c.most_common(1)[0][0]
            if a == "ger" and (b["area"] > 60 or b["elong"] > 1.5):
                a = "house"                      # a ger is round and small; anything else is a house
            if a in ("glass_tower", "mall", "hotel") and b["area"] < 300:
                a = "commercial"
            b["arch"], b["arch_src"] = a, "estimated_from_neighbours"
        else:
            a = "utility" if b["area"] < 25 else "house" if b["area"] < 160 else "commercial" if b["area"] > 2500 else \
                _housing_kind(b["floors"], b["area"], b["elong"])
            b["arch"], b["arch_src"] = a, "estimated_from_shape"

    # ---- drawing height ---------------------------------------------------------------------
    have = [i for i, b in enumerate(blds) if b["height_src"] in ("source", "estimated_from_floors")]
    htree = STRtree([Point(*cent[i]) for i in have])
    for i, b in enumerate(blds):
        if b["height_src"] in ("source", "estimated_from_floors"):
            b["vis_height"], b["vis_height_src"] = b["height"], b["height_src"]
            continue
        a = b["arch"]
        if a == "ger":
            b["vis_height"], b["vis_height_src"] = 2.4, "estimated_from_class"
            continue
        if a == "utility":
            b["vis_height"], b["vis_height_src"] = (3.0 if b["area"] < 80 else 4.5), "estimated_from_class"
            continue
        if a == "house":
            b["vis_height"], b["vis_height_src"] = (3.2 if b["area"] < 70 else 5.5), "estimated_from_class"
            continue
        fh = FLOOR_BY_ARCH.get(a, FLOOR_M)
        storeys = []
        for j in htree.query(Point(*cent[i]).buffer(200)):
            o = blds[have[int(j)]]
            same = o["arch"] == a or {o["arch"], a} <= {"soviet_apartment", "residential"}
            if same and 0.4 <= o["area"] / max(b["area"], 1) <= 2.5:
                d = math.hypot(*(cent[have[int(j)]] - cent[i]))
                storeys.append((d, o["floors"] or max(1, round(o["height"] / FLOOR_M))))
        storeys.sort()
        if len(storeys) >= 2:
            fl = int(round(float(np.median([s for _, s in storeys[:5]]))))
            b["vis_height"], b["vis_height_src"] = round(fl * fh, 1), "estimated_from_neighbours"
            continue
        ar = b["area"]
        table = {
            "soviet_apartment": 5, "residential": 3 if ar < 250 else 5 if ar < 500 else 9,
            "glass_tower": 10, "commercial": 1 if ar < 120 else 2 if ar < 600 else 3, "mall": 4,
            "government": 3, "education": 2 if ar < 900 else 3, "industrial": 1 if ar < 1500 else 2,
            "medical": 3, "religious": 2, "hotel": 5,
        }
        b["vis_height"], b["vis_height_src"] = round(table.get(a, 2) * fh, 1), "estimated_from_class"
    for b in blds:
        del b["area"], b["elong"]
    return blds
