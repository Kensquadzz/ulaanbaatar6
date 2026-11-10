"""Top-down preview of the generated tiles, to check the geography by eye.

This is a diagnostic picture of the DATA (real roads, footprints, water, GPS route). It is
not game graphics. Usage: python -m ub6pipeline.preview <tiles_dir> <out.png> [ub6tool]
"""
import glob
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

M_PER_PX = 2.5
ROAD = {"trunk": ("#f4a742", 5), "primary": ("#f7c873", 4), "secondary": ("#fff2b0", 3), "tertiary": ("#ffffff", 2),
        "residential": ("#d8dde3", 1), "living_street": ("#d8dde3", 1), "service": ("#b9c0c8", 1), "unclassified": ("#d8dde3", 1)}


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main(tiles, out, tool=None):
    m = json.load(open(os.path.join(tiles, "manifest.json"), encoding="utf-8"))
    S = m["chunk_size_m"]
    xs = [c["x"] for c in m["chunks"]]; ys = [c["y"] for c in m["chunks"]]
    x0, x1, y0, y1 = min(xs) * S, (max(xs) + 1) * S, min(ys) * S, (max(ys) + 1) * S
    W, H = int((x1 - x0) / M_PER_PX), int((y1 - y0) / M_PER_PX)
    img = Image.new("RGB", (W, H), "#20252b")
    d = ImageDraw.Draw(img)
    px = lambda e, n: ((e - x0) / M_PER_PX, (y1 - n) / M_PER_PX)
    chunks = [json.load(open(f, encoding="utf-8")) for f in glob.glob(os.path.join(tiles, "chunks", "*.json"))]
    # Terrain shading from the height grids.
    lo = min(min(c["height_grid_dm"]) for c in chunks); hi = max(max(c["height_grid_dm"]) for c in chunks)
    for c in chunks:
        n = c["grid_n"]; step = S / (n - 1); cx, cy = c["chunk"]
        for j in range(n - 1):
            for i in range(n - 1):
                t = (c["height_grid_dm"][j * n + i] - lo) / (hi - lo)
                g = int(34 + 70 * t)
                a = px(cx * S + i * step, cy * S + (j + 1) * step); b = px(cx * S + (i + 1) * step, cy * S + j * step)
                d.rectangle([a[0], a[1], b[0], b[1]], fill=(g, g + 6, g - 4))
    for c in chunks:
        for a in c["land_use"]:
            if "ring" in a and a["class"] in ("park", "grass", "garden", "pitch", "playground", "plaza", "pedestrian"):
                d.polygon([px(*p) for p in a["ring"]], fill="#3c4a3f" if a["class"] not in ("plaza", "pedestrian") else "#4a4d55")
    for c in chunks:
        for a in c["water"]:
            if "ring" in a:
                d.polygon([px(*p) for p in a["ring"]], fill="#2b6ea8")
            elif "line" in a:
                d.line([px(*p) for p in a["line"]], fill="#2b6ea8", width=2)
    for order in ("service", "residential", "living_street", "unclassified", "tertiary", "secondary", "primary", "trunk"):
        for c in chunks:
            for r in c["roads"]:
                if r["class"] == order:
                    col, w = ROAD[order]
                    d.line([px(p[0], p[1]) for p in r["pts"]], fill=col, width=w)
    for c in chunks:
        for b in c["buildings"]:
            # Brighter = taller. Orange outline = height comes from the source, not an estimate.
            v = int(min(255, 105 + b["height"] * 2.2))
            for ring in b["rings"]:
                d.polygon([px(*p) for p in ring], fill=(v, v, min(255, v + 8)),
                          outline="#ff7a1a" if b["height_src"] == "source" else None)
    lm = json.load(open(os.path.join(tiles, "landmarks.json"), encoding="utf-8"))["found"]
    if tool and os.path.exists(tool):
        a, b = lm["sukhbaatar_square"], lm["zaisan_square"]
        res = subprocess.run([tool, "routepts", os.path.join(tiles, "nav", "roadgraph.txt"), str(a["east"]), str(a["north"]),
                              str(b["east"]), str(b["north"]), "car"], capture_output=True, text=True)
        if res.returncode == 0:
            v = [float(t) for t in res.stdout.split()]
            d.line([px(v[i], v[i + 1]) for i in range(0, len(v), 2)], fill="#22b8ff", width=6)
    f = font(22)
    for k, v in lm.items():
        x, y = px(v["east"], v["north"])
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill="#ff3b30", outline="white", width=2)
        label = v["name"]
        tw = d.textlength(label, font=f)
        tx = min(max(x + 12, 4), W - tw - 8)
        d.rectangle([tx - 4, y - 14, tx + tw + 4, y + 14], fill="#101418")
        d.text((tx, y - 12), label, fill="white", font=f)
    d.rectangle([0, 0, W, 64], fill="#101418")
    d.text((16, 8), "ULAANBAATAR 6 - pipeline data preview (not game graphics)", fill="white", font=font(26))
    d.text((16, 40), f"{m['stats']['roads']} roads, {m['stats']['buildings']} buildings, {len(m['chunks'])} chunks of {int(S)} m. "
           "Blue line: GPS car route Sukhbaatar Square to Zaisan.", fill="#b9c0c8", font=font(16))
    d.rectangle([0, H - 30, W, H], fill="#101418")
    d.text((16, H - 26), "Data: Overture Maps Foundation, (c) OpenStreetMap contributors; terrain: AWS Terrain Tiles. North is up.",
           fill="#b9c0c8", font=font(15))
    img.save(out)
    print(out, img.size)


if __name__ == "__main__":
    main(*sys.argv[1:])
