"""Compare the game's ?view=top render with the drone orthomosaic.

    .venv/bin/python tools/topdown_compare.py /tmp/top.png
        [--out check/topdown_vs_ortho.png] [--scale 0.5]

Take the render first (14 px per metre over x -62..82, z -50..52):

    python3 tools/shot.py "http://127.0.0.1:8772/index.html?view=top" \
        /tmp/top.png --size 2016x1428 --wait 12

Writes three panels side by side: the orthomosaic read decimated over exactly
the same extent (E 573088-573232, N 2840050-2840152) and pixel size, the game
render, and the game at 50 % over the orthomosaic. The island land outline
from data/water.json is drawn thin on all three, with a north triangle and a
scale bar. Mean colours inside and outside the land outline are printed.
"""
import argparse
import json
import os

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFont
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
# the drone orthomosaic, beside the game folder in the survey's output folder
ORTHO = os.path.join(os.path.dirname(GAME), "LizardIsland_2025_drone", "products", "orthomosaics",
                     "LizardIsland_2025-10_drone_150ft_orthomosaic_EPSG6346_cog.tif")
E0, N0 = 573150, 2840100
XMIN, XMAX, ZMIN, ZMAX = -62.0, 82.0, -50.0, 52.0
PPM = 14  # pixels per metre
W, H = int((XMAX - XMIN) * PPM), int((ZMAX - ZMIN) * PPM)  # 2016 x 1428


def read_ortho(path):
    left, right = E0 + XMIN, E0 + XMAX
    top, bottom = N0 - ZMIN, N0 - ZMAX
    with rasterio.open(path) as src:
        win = from_bounds(left, bottom, right, top, src.transform)
        bands = [1, 2, 3, 4] if src.count >= 4 else [1, 2, 3]
        arr = src.read(bands, window=win, out_shape=(len(bands), H, W),
                       resampling=Resampling.average, boundless=True, fill_value=0)
    rgb = arr[:3].transpose(1, 2, 0).astype(np.float32)
    if len(bands) == 4:
        a = (arr[3] > 127)[..., None]
        rgb = np.where(a, rgb, 235.0)
    return rgb.astype(np.uint8)


def land_rings():
    with open(os.path.join(GAME, "data", "water.json")) as f:
        w = json.load(f)
    return w["land"]


def to_px(ring, s):
    return [((x - XMIN) * PPM * s, (z - ZMIN) * PPM * s) for x, z in ring] + \
           [((ring[0][0] - XMIN) * PPM * s, (ring[0][1] - ZMIN) * PPM * s)]


def land_mask(rings):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for r in rings:
        d.polygon(to_px(r, 1.0), fill=255)
    return np.asarray(m) > 0


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def decorate(panel, rings, s):
    d = ImageDraw.Draw(panel)
    lw = max(1, round(2 * s))
    for r in rings:
        d.line(to_px(r, s), fill=(255, 255, 255), width=lw, joint="curve")
    w, h = panel.size
    # North triangle, top right.
    cx, cy, a = w - 34 * s * 2, 30 * s * 2, 14 * s * 2
    d.polygon([(cx, cy - a), (cx - a * 0.62, cy + a * 0.7), (cx + a * 0.62, cy + a * 0.7)],
              fill=(20, 20, 20), outline=(255, 255, 255))
    f = font(max(10, int(22 * s)))
    d.text((cx, cy + a * 0.7 + 4 * s), "N", fill=(255, 255, 255), font=f, anchor="mt",
           stroke_width=max(1, int(2 * s)), stroke_fill=(20, 20, 20))
    # Scale bar, bottom left: 20 m in two 10 m blocks.
    x0, y0 = 30 * s * 2, h - 34 * s * 2
    m = PPM * s
    bh = max(4, 8 * s)
    d.rectangle([x0, y0, x0 + 10 * m, y0 + bh], fill=(20, 20, 20), outline=(255, 255, 255))
    d.rectangle([x0 + 10 * m, y0, x0 + 20 * m, y0 + bh], fill=(255, 255, 255), outline=(20, 20, 20))
    for v, xx in ((0, x0), (10, x0 + 10 * m), (20, x0 + 20 * m)):
        d.text((xx, y0 - 3 * s), f"{v} m" if v == 20 else f"{v}", fill=(255, 255, 255), font=f,
               anchor="mb", stroke_width=max(1, int(2 * s)), stroke_fill=(20, 20, 20))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game", help="?view=top screenshot, 2016x1428")
    ap.add_argument("--out", default=os.path.join(GAME, "check", "topdown_vs_ortho.png"))
    ap.add_argument("--scale", type=float, default=0.5, help="panel scale in the figure")
    a = ap.parse_args()

    game = Image.open(a.game).convert("RGB")
    if game.size != (W, H):
        print(f"note: render is {game.size[0]}x{game.size[1]}, resizing to {W}x{H}")
        game = game.resize((W, H), Image.BILINEAR)
    g = np.asarray(game).astype(np.float32)
    o = read_ortho(ORTHO).astype(np.float32)
    blend = (0.5 * g + 0.5 * o).astype(np.uint8)

    rings = land_rings()
    land = land_mask(rings)
    for name, img in (("ortho", o), ("game", g)):
        inside = img[land].mean(axis=0)
        outside = img[~land].mean(axis=0)
        print(f"{name:5s} mean RGB  land {inside.round(0)}  outside {outside.round(0)}")

    s = a.scale
    pw, ph = int(W * s), int(H * s)
    gap, top_pad = int(24 * s * 2), int(46 * s * 2)
    fig = Image.new("RGB", (3 * pw + 4 * gap, ph + top_pad + gap), (250, 249, 245))
    titles = ["Drone orthomosaic, October 2025", "Game, ?view=top",
              "Game at 50 % over the orthomosaic"]
    f = font(max(12, int(26 * s)))
    d = ImageDraw.Draw(fig)
    for k, (arr, title) in enumerate(zip([o.astype(np.uint8), g.astype(np.uint8), blend], titles)):
        panel = Image.fromarray(arr).resize((pw, ph), Image.LANCZOS)
        decorate(panel, rings, s)
        x = gap + k * (pw + gap)
        fig.paste(panel, (x, top_pad))
        d.text((x, top_pad - 10 * s), title, fill=(40, 40, 40), font=f, anchor="lb")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    fig.save(a.out, optimize=True)
    print("wrote", a.out, fig.size)


if __name__ == "__main__":
    main()
