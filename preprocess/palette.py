"""Colour palette for the game, sampled from the October 2025 drone orthomosaic.

What this does
--------------
1. Reads the orthomosaic decimated to 0.125 m pixels over the site frame (GDAL picks an
   internal overview, so the full 1.6 cm image is never read).
2. Puts the lidar rasters on the same 0.125 m grid (the 0.5 m site rasters and the 0.25 m
   vegetation rasters are exact multiples of it, so this is pure replication, no
   interpolation) and uses them to label ortho pixels: lawn, shaded lawn, litter, mud, path,
   bank grass, open water, the mangrove fringe, shrubs, understorey, canopy and the crowns
   of the 37 lidar trees.
3. Summarises each class in CIELAB: a robust median, or a small seeded k-means where the
   game wants several variants.
4. Applies a gentle "toon" adjustment (shadows lifted by a power curve on L*, chroma up by
   18 %, CIELAB hue angle untouched) and writes data/palette.json.
5. Draws check/palette_swatches.png (every swatch beside the ortho pixels it came from, and
   every landmark tint beside its crown) and check/palette_map.png (the site as seen by the
   drone beside the site painted in the palette).

The orthomosaic is art reference only; nothing from it is shipped as a texture.

Landmark kinds, and the palm crowns of the landmarks the plant survey turned into palms, are read
from data/placements.json, so placements.py runs first (build_all.py keeps that order).

Run from the game folder:
    python3 preprocess/palette.py
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import rasterio  # noqa: E402
from matplotlib.patches import Polygon as MplPolygon  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402
from rasterio.enums import Resampling  # noqa: E402
from rasterio.features import rasterize  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402
from scipy import ndimage as ndi  # noqa: E402
from scipy.cluster.vq import kmeans2  # noqa: E402
from shapely import affinity  # noqa: E402
from shapely.geometry import Point  # noqa: E402
from skimage.filters import threshold_otsu  # noqa: E402

# ----------------------------------------------------------------------------------------
# Paths and constants
# ----------------------------------------------------------------------------------------
GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent  # .../scan_alignment/out, read only
SITE = OUT / "LizardIsland_2025_site_map" / "rasters"
VEG = OUT / "LizardIsland_2025_vegetation_layers_cleaned" / "gis"
TREES = OUT / "LizardIsland_2025_trees"
PLANTS = OUT / "LizardIsland_2026_plant_map"
ORTHO = (OUT / "LizardIsland_2025_drone" / "products" / "orthomosaics"
         / "LizardIsland_2025-10_drone_150ft_orthomosaic_EPSG6346_cog.tif")
OUTLINE = OUT / "LizardIsland_2025_splat" / "opensplat" / "work" / "island_crop_outline.gpkg"

DATA_DIR = GAME / "data"
CHECK_DIR = GAME / "check"

# Site frame edges, west, east, south and north (EPSG:6346; files labelled 26917 or 32617
# carry the same numbers). The names match terrain.py; E0, N0 in the other scripts are the
# game origin (573150, 2840100), which this script uses only in the literal frame block.
E_W, E_E, N_S, N_N =573080.0, 573250.0, 2840030.0, 2840215.0
CELL = 0.125                       # analysis grid, metres; divides 0.25 and 0.5 exactly
NCOL = int(round((E_E - E_W) / CELL))
NROW = int(round((N_N - N_S) / CELL))
GRID_T = from_origin(E_W, N_N, CELL, CELL)

FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.90,
         "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}

# Plain text labels for the map figure, (metres east of E 573150, metres north of N 2840100).
LABELS = [(12, 2, "Lizard Island"), (-10, 54, "Center Lake"), (-35, 76, "north bank"),
          (-35, -48, "south bank")]

SEED = 20251012                    # one seed for every random draw in this script

# Toon adjustment.
LIFT_GAMMA = 0.80                  # L' = 100 (L/100)^0.8: L 20 -> 28, 50 -> 57, 80 -> 84
CHROMA_GAIN = 1.18                 # a little more saturation, hue angle unchanged

# Class thresholds (metres, CIELAB units).
LOW_VEG = 0.30                     # "open" ground: vegetation under 0.3 m
TALL_VEG = 2.0                     # canopy that casts shade on the lawn
SHADE_REACH = 4.0                  # shaded lawn and litter lie within this of tall canopy
LITTER_REACH = 3.0
REG_MARGIN = 0.5                   # keep lawn samples this far from any vegetation edge
SUN_TRIM = 10                      # drop the darkest 10 % of a crown or clump (gaps, holes)
BLOCK = 12                         # 12 cells = 1.5 m blocks for clump variants
BLOCK_MIN = 36                     # a block needs at least 36 kept cells (0.56 m2)

# Landmark identities: what each landmark is (the plant survey where a point marks its stem, else
# the lab's own identification or the tree table) is decided once, in placements.py, and read
# here from data/placements.json, so palette.py runs after placements.py. The same file gives the
# palm crowns of the landmarks the survey turned into palms: their tint is sampled from the palm
# crown, not from the lidar crown polygon, which can hold neighbouring broadleaf canopy.
PLACEMENTS = DATA_DIR / "placements.json"


def load_identities() -> tuple[dict, dict]:
    """Kind of every landmark id, and the palm crowns placements.py set from the orthomosaic
    ({id: (E, N, width EW, width NS, seen from above)})."""
    pl = json.loads(PLACEMENTS.read_text())
    kinds = {lm["id"]: lm["kind"] for lm in pl["landmarks"]}
    palm_crowns = {}
    for pc in pl.get("survey_identity", {}).get("palm_crowns", []):
        lm = next(l for l in pl["landmarks"] if l["id"] == pc["landmark"])
        palm_crowns[lm["id"]] = (lm["crown_x"] + FRAME["origin_E"], FRAME["origin_N"] - lm["crown_z"],
                                 lm["crown_w_ew"], lm["crown_w_ns"], pc["seen_from_above"])
    return kinds, palm_crowns


KINDS, PALM_CROWNS = load_identities()


def landmark_kind(tid: str) -> str:
    return KINDS[tid]


def of_kind(kind: str) -> list[str]:
    return sorted(t for t, k in KINDS.items() if k == kind)


# ----------------------------------------------------------------------------------------
# Colour arithmetic (sRGB, D65, CIELAB), written out so the gamut test is exact
# ----------------------------------------------------------------------------------------
_M_RGB2XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]])
_M_XYZ2RGB = np.linalg.inv(_M_RGB2XYZ)
_WHITE = np.array([0.95047, 1.0, 1.08883])
_EPS = (6.0 / 29.0) ** 3


def srgb8_to_lab(rgb8: np.ndarray) -> np.ndarray:
    """uint8 sRGB (..., 3) to CIELAB (..., 3), float32."""
    c = rgb8.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    t = (lin @ _M_RGB2XYZ.T) / _WHITE
    f = np.where(t > _EPS, np.cbrt(t), t / (3 * (6 / 29) ** 2) + 4 / 29)
    lab = np.stack([116 * f[..., 1] - 16,
                    500 * (f[..., 0] - f[..., 1]),
                    200 * (f[..., 1] - f[..., 2])], axis=-1)
    return lab.astype(np.float32)


def lab_to_linear(lab: np.ndarray) -> np.ndarray:
    """CIELAB to linear sRGB, not clipped (values outside 0..1 are out of gamut)."""
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], axis=-1)
    t = np.where(f > 6 / 29, f ** 3, 3 * (6 / 29) ** 2 * (f - 4 / 29)) * _WHITE
    return t @ _M_XYZ2RGB.T


def lab_to_srgb8(lab: np.ndarray) -> np.ndarray:
    lin = np.clip(lab_to_linear(lab), 0, 1)
    c = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)
    return np.clip(np.round(c * 255), 0, 255).astype(np.uint8)


def hex_of(rgb8) -> str:
    return "#{:02x}{:02x}{:02x}".format(*[int(v) for v in rgb8])


def lab_of_hex(h: str) -> np.ndarray:
    rgb = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.uint8)
    return srgb8_to_lab(rgb).astype(np.float64)


def toon(lab) -> np.ndarray:
    """Lift shadows, add a little chroma, keep the CIELAB hue angle, stay in gamut."""
    L, a, b = (float(v) for v in lab)
    L2 = 100.0 * (max(L, 0.0) / 100.0) ** LIFT_GAMMA
    C = math.hypot(a, b) * CHROMA_GAIN
    h = math.atan2(b, a)
    for s in np.linspace(1.0, 0.0, 201):   # shrink chroma until the colour fits in sRGB
        out = np.array([L2, C * s * math.cos(h), C * s * math.sin(h)])
        lin = lab_to_linear(out)
        if lin.min() >= -1e-9 and lin.max() <= 1 + 1e-9:
            return out
    return np.array([L2, 0.0, 0.0])


def toon_hex(lab) -> str:
    return hex_of(lab_to_srgb8(toon(lab)))


def raw_hex(lab) -> str:
    return hex_of(lab_to_srgb8(np.asarray(lab, dtype=np.float64)))


def delta_e(l1, l2) -> float:
    return float(np.linalg.norm(np.asarray(l1, float) - np.asarray(l2, float)))


# ----------------------------------------------------------------------------------------
# Loading everything onto the 0.125 m grid
# ----------------------------------------------------------------------------------------
def read_ortho() -> tuple[np.ndarray, np.ndarray]:
    """Orthomosaic averaged to 0.125 m cells aligned to the site frame.

    Returns rgb (NROW, NCOL, 3) uint8 and a validity mask (alpha fully opaque). Cells the
    drone did not cover (the north strip beyond N 2840186.9, the far east edge) are invalid.
    """
    rgb = np.zeros((NROW, NCOL, 3), np.uint8)
    valid = np.zeros((NROW, NCOL), bool)
    with rasterio.open(ORTHO) as src:
        ob = src.bounds
        r_top = math.ceil((N_N - min(N_N, ob.top)) / CELL - 1e-9)
        r_bot = math.floor((N_N - max(N_S, ob.bottom)) / CELL + 1e-9)
        c_lft = math.ceil((max(E_W, ob.left) - E_W) / CELL - 1e-9)
        c_rgt = math.floor((min(E_E, ob.right) - E_W) / CELL + 1e-9)
        win = from_bounds(E_W + c_lft * CELL, N_N - r_bot * CELL,
                          E_W + c_rgt * CELL, N_N - r_top * CELL, src.transform)
        arr = src.read(window=win, out_shape=(4, r_bot - r_top, c_rgt - c_lft),
                       resampling=Resampling.average)
    rgb[r_top:r_bot, c_lft:c_rgt] = np.moveaxis(arr[:3], 0, -1)
    valid[r_top:r_bot, c_lft:c_rgt] = arr[3] == 255
    return rgb, valid


def raster_on_grid(path: Path) -> np.ndarray:
    """A 0.25 m or 0.5 m raster replicated onto the 0.125 m grid; nodata becomes NaN."""
    with rasterio.open(path) as src:
        band = src.read(1).astype(np.float64)
        nd = src.nodata
        b = src.bounds
        res = src.res[0]
    if nd is not None and not np.isnan(nd):
        band[band == nd] = np.nan
    k = int(round(res / CELL))
    band = np.repeat(np.repeat(band, k, axis=0), k, axis=1)
    out = np.full((NROW, NCOL), np.nan)
    r0 = int(round((N_N - b.top) / CELL))
    c0 = int(round((b.left - E_W) / CELL))
    out[r0:r0 + band.shape[0], c0:c0 + band.shape[1]] = band
    return out


def burn(geoms) -> np.ndarray:
    return rasterize(list(geoms), out_shape=(NROW, NCOL), transform=GRID_T).astype(bool)


def load_grid() -> dict:
    rgb, valid = read_ortho()
    g = {"rgb": rgb, "valid": valid, "lab": srgb8_to_lab(rgb)}

    water = raster_on_grid(SITE / "LizardIsland_2025_site_water_mask.tif")
    openw = raster_on_grid(SITE / "LizardIsland_2025_site_open_water_mask.tif")
    ground = raster_on_grid(SITE / "LizardIsland_2025_site_ground_height.tif")
    vh_site = raster_on_grid(SITE / "LizardIsland_2025_site_vegetation_height.tif")
    vh_fine = raster_on_grid(VEG / "LizardIsland_2025_vegetation_canopy_height.tif")
    g["water"] = water == 1
    g["open_water"] = openw == 1
    # Top of vegetation above ground: the cleaned 0.25 m canopy raster over the island,
    # the 0.5 m site raster elsewhere (far banks).
    g["veg"] = np.where(np.isfinite(vh_fine), vh_fine, vh_site)
    g["known"] = np.isfinite(g["veg"]) & np.isfinite(ground)

    land = gpd.read_file(VEG / "LizardIsland_2025_vegetation_island_land.shp")
    outline = gpd.read_file(OUTLINE)
    g["island"] = burn(land.geometry)
    g["outline"] = burn(outline.geometry)
    g["land"] = g["known"] & ~g["water"]
    g["bank"] = g["land"] & ~g["outline"]

    # Distances in metres.
    tall = g["known"] & (g["veg"] > TALL_VEG)
    anyveg = g["known"] & (g["veg"] >= LOW_VEG)
    g["d_tall"] = ndi.distance_transform_edt(~tall) * CELL
    g["d_veg"] = ndi.distance_transform_edt(~anyveg) * CELL
    g["d_water"] = ndi.distance_transform_edt(~g["water"]) * CELL
    g["d_not_open"] = ndi.distance_transform_edt(g["open_water"]) * CELL
    return g


# ----------------------------------------------------------------------------------------
# Statistics helpers
# ----------------------------------------------------------------------------------------
def trim_dark(mask: np.ndarray, L: np.ndarray, lo: float = SUN_TRIM,
              hi: float = 99.5) -> np.ndarray:
    """Trims a class: drops its darkest lo % (gaps in the canopy, holes to the lake floor)
    and the brightest 0.5 % (glints). Most self shadow is kept on purpose: a low-poly crown
    has no leaf-scale shadow of its own, so its base colour has to carry it."""
    if mask.sum() < 10:
        return mask
    a, b = np.percentile(L[mask], [lo, hi])
    return mask & (L >= a) & (L <= b)


def lab_median(lab: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return np.median(lab[mask].astype(np.float64), axis=0)


def kmeans_lab(X: np.ndarray, k: int, restarts: int = 12) -> tuple[np.ndarray, np.ndarray]:
    """Seeded k-means in CIELAB with restarts; clusters returned in order of lightness."""
    X = np.asarray(X, dtype=np.float64)
    rng = np.random.default_rng(SEED)
    best = None
    for _ in range(restarts):
        cen, lab_ = kmeans2(X, k, iter=50, minit="++", rng=rng)
        if len(np.unique(lab_)) < k:
            continue
        inertia = ((X - cen[lab_]) ** 2).sum()
        if best is None or inertia < best[0]:
            best = (inertia, cen, lab_)
    _, cen, lab_ = best
    order = np.argsort(cen[:, 0])
    remap = np.empty(k, int)
    remap[order] = np.arange(k)
    return cen[order], remap[lab_]


def block_medians(lab: np.ndarray, mask: np.ndarray):
    """CIELAB medians of the masked cells in each 1.5 m block holding enough of them.

    Returns (medians (n, 3), block row index, block col index).
    """
    hb, wb = NROW // BLOCK, NCOL // BLOCK
    m = mask[:hb * BLOCK, :wb * BLOCK]
    x = lab[:hb * BLOCK, :wb * BLOCK].astype(np.float64).copy()
    x[~m] = np.nan
    x = x.reshape(hb, BLOCK, wb, BLOCK, 3).transpose(0, 2, 1, 3, 4).reshape(hb, wb, -1, 3)
    cnt = m.reshape(hb, BLOCK, wb, BLOCK).sum(axis=(1, 3))
    rr, cc = np.nonzero(cnt >= BLOCK_MIN)
    med = np.nanmedian(x[rr, cc], axis=1)
    return med, rr, cc


def block_label_image(rr, cc, labels) -> np.ndarray:
    """Per-cell cluster label (-1 where the block took no part) for the figure strips."""
    hb, wb = NROW // BLOCK, NCOL // BLOCK
    img = np.full((hb, wb), -1, int)
    img[rr, cc] = labels
    full = np.full((NROW, NCOL), -1, int)
    full[:hb * BLOCK, :wb * BLOCK] = np.repeat(np.repeat(img, BLOCK, 0), BLOCK, 1)
    return full


# ----------------------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------------------
def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    CHECK_DIR.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)

    g = load_grid()
    lab = g["lab"]
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    hue = np.degrees(np.arctan2(B, A))            # CIELAB hue angle: 90 yellow, 180 green
    chroma = np.hypot(A, B)
    ok = g["valid"]
    veg = np.where(g["known"], g["veg"], np.nan)
    with np.errstate(invalid="ignore"):
        low = g["land"] & (veg < LOW_VEG)
        path_like = (chroma < 12) & (L > 60)      # pale, nearly grey: paving and gravel
        brownish = (hue > 40) & (hue < 100) & (chroma > 8)
    print(f"grid {NCOL} x {NROW} cells of {CELL} m; ortho covers {ok.mean():.1%} of the frame")

    # Every swatch collects: raw CIELAB, the cell mask it came from, and a short source note.
    sw: dict[str, dict] = {}

    def put(name, raw, cells, source, n=None):
        sw.setdefault(name, {"raw": [], "cells": [], "source": source, "n": [], "share": []})
        sw[name]["raw"].append(np.asarray(raw, dtype=np.float64))
        sw[name]["cells"].append(cells)
        sw[name]["n"].append(int(cells.sum()) if n is None else int(n))

    # ---- Ground: lawn, shade, litter, mud, path, bank grass -----------------------------
    isl_low = low & g["outline"] & ok
    split = float(threshold_otsu(L[isl_low]))     # sunlit and shaded lawn separate cleanly
    print(f"lawn light/shade split at L* = {split:.1f} (Otsu on {isl_low.sum()} island cells)")

    lawn_sun = isl_low & (g["d_veg"] >= REG_MARGIN) & (L > split) & ~path_like & (hue >= 95)
    put("lawn_sun", lab_median(lab, lawn_sun), lawn_sun,
        "island lawn under 0.3 m vegetation, 0.5 m clear of plants, sunlit (above the Otsu split)")

    lawn_shade = isl_low & (g["d_tall"] <= SHADE_REACH) & (L <= split) & (L > 8)
    put("lawn_shade", lab_median(lab, lawn_shade), lawn_shade,
        "island lawn within 4 m of canopy over 2 m, in shadow (below the Otsu split)")

    litter = (g["land"] & g["outline"] & ok & (veg < 0.5) & (g["d_tall"] <= LITTER_REACH)
              & brownish & (L > 28) & (L < 70) & ~path_like)
    put("litter", lab_median(lab, litter), litter,
        "island ground within 3 m of canopy that is brown, not green, and not the pale "
        "sun-bleached fallen wood (L* 70 and over)")

    with np.errstate(invalid="ignore"):
        shore = ok & (g["d_water"] <= 2.0) & ~(g["water"] & g["open_water"]) & (veg < 0.5)
    mud = shore & brownish & (L < 60)
    put("mud", lab_median(lab, mud), mud,
        "brown, bare cells within 2 m of the water line (shore mud)")

    path = low & g["bank"] & ok & path_like & (g["d_veg"] >= 0.25)
    put("path", lab_median(lab, path), path, "pale grey cells on the far banks (garden paths)")

    bank_low = low & g["bank"] & ok
    bank = bank_low & (g["d_veg"] >= REG_MARGIN) & (L > split) & ~path_like & (hue >= 85)
    put("bank_grass", lab_median(lab, bank), bank,
        "far-bank lawn under 0.3 m vegetation, sunlit, not path")

    # ---- Water ---------------------------------------------------------------------------
    # Open water at least 1 m from anything that is not open water (shore, overhanging
    # canopy, the small holes in the mask), clustered in three: dark deep water, the
    # tea-coloured shelf where the bed shows, and a bright sandy margin.
    water_cells = g["open_water"] & (g["d_not_open"] >= 1.0) & ok
    Xw = lab[water_cells].astype(np.float64)
    sub = rng.choice(len(Xw), size=min(60000, len(Xw)), replace=False)
    cen_w, _ = kmeans_lab(Xw[sub], 3)
    lab_w = np.argmin(((Xw[:, None, :] - cen_w[None]) ** 2).sum(-1), axis=1)
    wlab = np.full((NROW, NCOL), -1, int)
    wlab[water_cells] = lab_w
    shares_w = np.bincount(lab_w, minlength=3) / len(lab_w)
    deep, shelf = wlab == 0, wlab == 1
    put("water_deep", lab_median(lab, deep), deep,
        f"darkest of 3 k-means clusters of open water ({shares_w[0]:.0%} of it)")
    put("water_shallow", lab_median(lab, shelf), shelf,
        f"middle cluster: tea-coloured water over the visible bed ({shares_w[1]:.0%})")
    print("water clusters (L*, a*, b*, share):",
          [(tuple(np.round(c, 1)), round(float(s), 3)) for c, s in zip(cen_w, shares_w)])

    # ---- Landmark crowns -----------------------------------------------------------------
    trees = pd.read_csv(TREES / "LizardIsland_2025_trees.csv")
    crowns = gpd.read_file(TREES / "LizardIsland_2025_trees.gpkg", layer="tree_crowns")
    masses = gpd.read_file(TREES / "LizardIsland_2025_trees.gpkg", layer="masses")
    crowns = crowns.set_index("id").loc[trees["id"]]
    hag = trees.set_index("id")["height_above_ground_m"]
    ids = list(trees["id"])
    assert set(ids) == set(KINDS), "placements.json and the tree table list different landmarks"
    # A landmark the survey turned into a palm is sampled over its palm crown (an ellipse on the
    # stem, as placements.py wrote it), not over the lidar polygon
    for t, (e, n, wew, wns, _) in PALM_CROWNS.items():
        crowns.loc[t, "geometry"] = affinity.scale(Point(e, n).buffer(1.0, 64), wew / 2, wns / 2)
    print(f"landmarks {len(ids)}; crown polygons {len(crowns)} ({len(PALM_CROWNS)} replaced by palm "
          f"crowns); masses {len(masses)}; kinds {dict(Counter(KINDS.values()))}")

    cmask = {t: burn([crowns.loc[t].geometry]) for t in ids}
    # Tallest and second tallest claimant of every cell, to judge what is on top.
    cover = np.zeros((NROW, NCOL), int)
    top1 = np.zeros((NROW, NCOL))
    top2 = np.zeros((NROW, NCOL))
    who1 = np.full((NROW, NCOL), "", dtype=object)
    for t in ids:
        m = cmask[t]
        cover += m
        h = float(hag[t])
        new_top = m & (h > top1)
        top2 = np.where(new_top, top1, np.where(m & (h > top2), h, top2))
        top1 = np.where(new_top, h, top1)
        who1 = np.where(new_top, t, who1)
    # The part of each crown that the drone could see: cells no other crown claims, or
    # cells where the canopy stands higher than every other claimant could reach.
    visible = {}
    for t in ids:
        m = cmask[t]
        others = np.where(who1 == t, top2, top1)
        with np.errstate(invalid="ignore"):
            v = m & ((cover == 1) | (veg > others + 0.5))
        if v.sum() < 40:
            v = m
        visible[t] = v
    any_crown = np.zeros((NROW, NCOL), bool)
    for t in ids:
        any_crown |= visible[t]

    tint_raw, tint_cells = {}, {}
    for t in ids:
        with np.errstate(invalid="ignore"):
            m = visible[t] & ok & (veg > 1.0)
        m = trim_dark(m, L)
        tint_raw[t] = lab_median(lab, m)
        tint_cells[t] = m
    # A palm whose crown is hidden under broadleaf canopy shows only that canopy from above: it
    # takes the median of the palm landmarks the drone could see
    hidden = sorted(t for t, v in PALM_CROWNS.items() if v[4] is False)
    seen_palms = [t for t in of_kind("palm") if t not in hidden]
    for t in hidden:
        tint_raw[t] = np.median(np.array([tint_raw[s] for s in seen_palms]), axis=0)
        tint_cells[t] = np.zeros((NROW, NCOL), bool)

    # Broadleaf crowns: one median per crown, then five k-means groups of crowns, so the
    # variants are tree-to-tree differences rather than light and shade within a crown.
    broad = [t for t in ids if landmark_kind(t) == "broadleaf"]
    Xb = np.array([tint_raw[t] for t in broad])
    _, lab_b = kmeans_lab(Xb, 5)
    for k in range(5):
        members = [t for t, l in zip(broad, lab_b) if l == k]
        cells = np.zeros((NROW, NCOL), bool)
        for t in members:
            cells |= tint_cells[t]
        put("crown_broadleaf", np.median(Xb[lab_b == k], axis=0), cells,
            f"5 k-means groups of the median colours of the {len(broad)} broadleaf landmark crowns",
            n=len(members))
    print(f"broadleaf crowns {len(broad)}; group sizes {np.bincount(lab_b).tolist()}")

    tal = np.zeros((NROW, NCOL), bool)
    for t in of_kind("talipot"):
        tal |= tint_cells[t]
    put("crown_talipot", lab_median(lab, tal), tal,
        f"visible cells of the {len(of_kind('talipot'))} talipot crowns ({', '.join(of_kind('talipot'))})")

    # ---- Palms: the palm landmarks and the surveyed palms that stand clear of other crowns --
    pts = pd.read_csv(PLANTS / "names" / "points_named.csv")
    chk = pd.read_csv(PLANTS / "frame_check" / "frame_check_points.csv")
    join_ok = (len(pts) == len(chk)
               and np.array_equal(chk["row"].to_numpy() - 2, pts["point_index"].to_numpy())
               and (chk["name"].to_numpy() == pts["raw_name"].to_numpy()).all()
               and np.abs(chk["E"].to_numpy() - pts["easting"].to_numpy()).max() < 1e-6
               and np.abs(chk["N"].to_numpy() - pts["northing"].to_numpy()).max() < 1e-6)
    if not join_ok:
        raise SystemExit("plant survey and frame check do not join row for row")
    pts["quality_flag"] = chk["quality_flag"].to_numpy()
    print(f"plant survey joined to frame check by order, name and E/N: {len(pts)} rows")

    not_palm = [t for t in ids if landmark_kind(t) not in ("palm", "talipot")]
    other_canopy = gpd.GeoSeries(list(crowns.loc[not_palm].geometry) + list(masses.geometry),
                                 crs=crowns.crs).union_all()
    palm_pts = pts[(pts["growth_form"] == "palm") & (pts["quality_flag"] != "reject")
                   & (pts["common_name"] != "talipot palm")]
    palm_meds, palm_cells, palm_src = [], [], []
    yy, xx = np.mgrid[-12:13, -12:13]
    disc = (yy ** 2 + xx ** 2) * CELL ** 2 <= 1.5 ** 2   # 1.5 m radius
    for _, p in palm_pts.iterrows():
        if other_canopy.contains(Point(p["easting"], p["northing"])):
            continue
        r = int((N_N - p["northing"]) / CELL)
        c = int((p["easting"] - E_W) / CELL)
        m = np.zeros((NROW, NCOL), bool)
        m[r - 12:r + 13, c - 12:c + 13] = disc
        with np.errstate(invalid="ignore"):
            m &= ok & (veg > 1.0) & ~any_crown
        if m.sum() < 60:
            continue
        m = trim_dark(m, L)
        palm_meds.append(lab_median(lab, m))
        palm_cells.append(m)
        palm_src.append("survey")
    for t in seen_palms:
        palm_meds.append(tint_raw[t])
        palm_cells.append(tint_cells[t])
        palm_src.append(t)
    Xp = np.array(palm_meds)
    _, lab_p = kmeans_lab(Xp, 3)
    for k in range(3):
        cells = np.zeros((NROW, NCOL), bool)
        for m, l in zip(palm_cells, lab_p):
            if l == k:
                cells |= m
        put("crown_palm", np.median(Xp[lab_p == k], axis=0), cells,
            f"3 k-means groups of per-palm median colours (the palm landmarks seen from above, "
            f"{', '.join(seen_palms)}, and surveyed palms clear of other crowns and masses)",
            n=int((lab_p == k).sum()))
    print(f"palm instances {len(Xp)} ({palm_src.count('survey')} surveyed of "
          f"{len(palm_pts)} usable palm points, plus {', '.join(seen_palms)}); groups "
          f"{np.bincount(lab_p).tolist()}")

    # ---- Clumps by top height, and the mangrove fringe -----------------------------------
    def clump_class(name, mask, k, source):
        m = trim_dark(mask & ok, L)
        med, rr, cc = block_medians(lab, m)
        cen, lbl = kmeans_lab(med, k)
        img = block_label_image(rr, cc, lbl)
        for j in range(k):
            put(name, np.median(med[lbl == j], axis=0), m & (img == j), source,
                n=int((lbl == j).sum()))
        print(f"{name}: {m.sum()} cells in {len(med)} blocks of 1.5 m; "
              f"groups {np.bincount(lbl).tolist()}")
        return cen, img

    with np.errstate(invalid="ignore"):
        on_isl = g["land"] & g["outline"] & ~any_crown
        fringe = g["water"] & ~g["open_water"] & g["outline"] & (veg >= 1.0) & ~any_crown
        shrub_m = on_isl & (veg >= LOW_VEG) & (veg < 1.5)
        under_m = on_isl & (veg >= 1.5) & (veg < 4.0)
        puff_m = on_isl & (veg >= 4.0)
    clump_class("crown_mangrove", fringe, 3,
                "canopy over water inside the island outline (the fringe), 1.5 m blocks, k = 3")
    clump_class("shrub", shrub_m, 3,
                "island vegetation topping out at 0.3 to 1.5 m, 1.5 m blocks, k = 3")
    clump_class("understorey", under_m, 3,
                "island vegetation topping out at 1.5 to 4 m, 1.5 m blocks, k = 3")
    clump_class("canopy_puff", puff_m, 4,
                "island canopy over 4 m outside the landmark crowns (masses and unassigned "
                "canopy), 1.5 m blocks, k = 4")

    for name, d in sw.items():
        tot = sum(d["n"])
        d["share"] = [n / tot for n in d["n"]]

    # ---- Toon adjustment of every sampled swatch ------------------------------------------
    sampled = {name: [toon(r) for r in d["raw"]] for name, d in sw.items()}

    # ---- Chosen colours (nothing in a view from above can give these) ---------------------
    chosen = {
        "water_foam": None,  # derived below from the shelf water
        "trunk_bark": "#76634f",
        "trunk_palm": "#a09482",
        "trunk_mangrove": "#6d4c3d",
        "rainbow_trunk": ["#a5d15a", "#3ea7a0", "#4f7fc2", "#7c5ba8", "#e38b3b", "#7b2f3a"],
        "osprey_pole": "#9a9083",
        "nest": "#8f6f47",
        "sky_top": "#5ea9e2",
        "sky_horizon": "#cfe7f1",
        "fog": "#d5e6e3",
    }
    # Foam: the shelf water's hue, very light and nearly neutral.
    shelf_lab = sampled["water_shallow"][0]
    h_shelf = math.atan2(shelf_lab[2], shelf_lab[1])
    chosen["water_foam"] = hex_of(lab_to_srgb8([95.0, 6 * math.cos(h_shelf),
                                                6 * math.sin(h_shelf)]))

    # ---- Landmark tints --------------------------------------------------------------------
    landmark_tints = {t: toon_hex(tint_raw[t]) for t in ids}

    # ---- Assemble palette.json -------------------------------------------------------------
    order = ["lawn_sun", "lawn_shade", "litter", "mud", "path", "bank_grass",
             "water_shallow", "water_deep", "water_foam",
             "crown_broadleaf", "crown_palm", "crown_talipot", "crown_mangrove",
             "shrub", "canopy_puff", "understorey",
             "trunk_bark", "trunk_palm", "trunk_mangrove", "rainbow_trunk",
             "osprey_pole", "nest", "sky_top", "sky_horizon", "fog"]
    swatches, raw_out, weights, sources = {}, {}, {}, {}
    for name in order:
        if name in sw:
            hx = [hex_of(lab_to_srgb8(x)) for x in sampled[name]]
            rw = [raw_hex(x) for x in sw[name]["raw"]]
            swatches[name] = hx if len(hx) > 1 else hx[0]
            raw_out[name] = rw if len(rw) > 1 else rw[0]
            if len(hx) > 1:
                weights[name] = [round(s, 3) for s in sw[name]["share"]]
            sources[name] = sw[name]["source"]
        else:
            swatches[name] = chosen[name]
            sources[name] = ("chosen: derived from the shelf water hue" if name == "water_foam"
                             else "chosen: not visible from above")

    notes = [
        "Sampled from the October 2025 drone orthomosaic, averaged to 0.125 m cells over "
        "the site frame; art reference only, never shipped as a texture.",
        "Pixels were labelled with the lidar rasters on the same grid: water and open water "
        "masks, ground and vegetation height (top of vegetation above ground), the island "
        "land polygon, the island crop outline and the landmark crown polygons.",
        "Colours were summarised in CIELAB: per-channel medians; crowns and clumps drop "
        "their darkest 10 % of cells first (canopy gaps); the rest of the self shadow is "
        "kept, because a low-poly crown has no leaf-scale shadow of its own.",
        "Variants: crown_broadleaf and crown_palm are k-means groups of per-plant medians "
        "(tree-to-tree differences); shrub, understorey, canopy_puff and crown_mangrove are "
        "k-means groups of 1.5 m block medians; water is a k = 3 k-means of open water "
        "(deep, tea-coloured shelf, sandy margin). Variants are ordered dark to light and "
        "variant_weights gives the share of each.",
        "Shrub, understorey and canopy_puff split island vegetation by its top height: "
        "0.3 to 1.5 m, 1.5 to 4 m, over 4 m, outside the landmark crowns.",
        "Toon adjustment: L' = 100 (L/100)^0.8 lifts shadows (L 20 to 28, 50 to 57, 80 to "
        "84); chroma x 1.18; CIELAB hue angle unchanged; chroma trimmed only where needed "
        "to stay inside sRGB.",
        "From above, the lake is dark and tea-coloured: deep water is a dark, almost neutral "
        "slate and the shelf where the bed shows is tea brown. These hues are honest; any "
        "sky reflection is for the water shader to add.",
        "landmark_tints: toon-adjusted median of the cells of each crown polygon that the "
        "drone could see (cells no other crown claims, or where the canopy is taller than "
        "any other claimant), vegetation over 1 m, darkest 10 % dropped. T036 is the "
        "osprey pole: its tint is the empty nest platform seen from above.",
        "Landmark kinds come from data/placements.json (the plant survey where a point marks "
        "the stem, else the lab's own identification or the tree table). A landmark the survey "
        "turned into a palm is sampled over its palm crown from placements.json, not over the "
        "lidar crown polygon, which can hold neighbouring broadleaf canopy; a palm whose crown is "
        "hidden under broadleaf canopy (" + (", ".join(hidden) or "none") + ") takes the median of the palm "
        "landmarks seen from above.",
        "Chosen, not sampled: water_foam, trunks, rainbow eucalyptus bands (lime green, teal, "
        "blue, purple, orange, maroon) for every rainbow_eucalyptus landmark ("
        + ", ".join(of_kind("rainbow_eucalyptus")) + "), osprey_pole, nest and the sky colours.",
    ]
    palette = {
        "frame": FRAME,
        "swatches": swatches,
        "landmark_tints": landmark_tints,
        "variant_weights": weights,
        "raw": raw_out,
        "sources": sources,
        "notes": notes,
    }
    (DATA_DIR / "palette.json").write_text(json.dumps(palette, indent=1) + "\n")
    size = (DATA_DIR / "palette.json").stat().st_size
    n_hex = sum(len(v) if isinstance(v, list) else 1 for v in swatches.values())
    print(f"wrote data/palette.json: {len(swatches)} swatch names, {n_hex} colours, "
          f"{len(landmark_tints)} landmark tints, {size} bytes")

    # Distinctness: the closest pair among the sampled swatches' adjusted colours.
    flat = [(f"{n}[{i}]" if len(sampled[n]) > 1 else n, x)
            for n in sampled for i, x in enumerate(sampled[n])]
    dmin = min((delta_e(a[1], b[1]), a[0], b[0])
               for i, a in enumerate(flat) for b in flat[i + 1:])
    print(f"closest pair of sampled swatches: {dmin[1]} and {dmin[2]}, delta E {dmin[0]:.1f}")

    # ---- Figures ---------------------------------------------------------------------------
    draw_swatch_sheet(g, sw, sampled, swatches, chosen, sources, ids, crowns, tint_raw,
                      tint_cells, landmark_tints, rng)
    draw_palette_map(g, sw, sampled, cen_w, wlab, visible, landmark_tints, ids, split,
                     litter, path, fringe, shrub_m, under_m, puff_m)


# ----------------------------------------------------------------------------------------
# Figures
# ----------------------------------------------------------------------------------------
def sample_strip(rgb: np.ndarray, cells: np.ndarray, lab: np.ndarray, rng, rows=6, cols=48):
    """A strip of up to rows*cols ortho pixels drawn from the class, dark to light."""
    idx = np.flatnonzero(cells)
    n = rows * cols
    if len(idx) == 0:
        return np.full((rows, cols, 3), 255, np.uint8)
    pick = rng.choice(idx, size=n, replace=len(idx) < n)
    Lv = lab.reshape(-1, 3)[pick, 0]
    pick = pick[np.argsort(Lv)]
    px = rgb.reshape(-1, 3)[pick]
    return px.reshape(cols, rows, 3).transpose(1, 0, 2)


def north_arrow(ax, x, y, size, up=1.0, color="#222222"):
    """Small filled triangle with N beneath it (no arrow shaft).

    up = +1 on axes whose y grows upwards (maps), -1 on the sheet's image-style axes.
    """
    tri = MplPolygon([[x, y + up * size], [x - size * 0.45, y - up * size * 0.35],
                      [x + size * 0.45, y - up * size * 0.35]], closed=True, color=color,
                     lw=0)
    ax.add_patch(tri)
    # Text alignment is in screen space, so "top" puts N under the triangle either way.
    ax.text(x, y - up * size * 0.55, "N", ha="center", va="top", fontsize=9, color=color,
            fontweight="bold")


def scale_bar(ax, x, y, length, label, height, up=1.0, color="#222222"):
    """Two-part bar from (x, y), label above it."""
    y0 = y if up > 0 else y - height
    ax.add_patch(Rectangle((x, y0), length / 2, height, color=color, lw=0))
    ax.add_patch(Rectangle((x + length / 2, y0), length / 2, height, facecolor="white",
                           edgecolor=color, lw=0.8))
    ax.text(x + length / 2, y + up * height * 1.5, label, ha="center", va="bottom",
            fontsize=8, color=color)


def draw_swatch_sheet(g, sw, sampled, swatches, chosen, sources, ids, crowns, tint_raw,
                      tint_cells, landmark_tints, rng) -> None:
    rgb, lab = g["rgb"], g["lab"]
    rows = []  # (label, sample strip or None, raw hex or None, adjusted hex, detail)
    for name in swatches:
        if name in sw:
            d = sw[name]
            k = len(d["raw"])
            for i in range(k):
                strip = sample_strip(rgb, d["cells"][i], lab, rng)
                lab_name = name if k == 1 else f"{name} {i + 1}/{k}"
                unit = "cells" if name not in ("crown_broadleaf", "crown_palm") else "plants"
                if name in ("shrub", "understorey", "canopy_puff", "crown_mangrove"):
                    unit = "blocks"
                detail = f"{d['n'][i]:,} {unit}" + (f", {d['share'][i]:.0%}" if k > 1 else "")
                rows.append((lab_name, strip, raw_hex(d["raw"][i]),
                             hex_of(lab_to_srgb8(sampled[name][i])), detail))
        else:
            v = chosen[name]
            vs = v if isinstance(v, list) else [v]
            for i, hx in enumerate(vs):
                lab_name = name if len(vs) == 1 else f"{name} {i + 1}/{len(vs)}"
                rows.append((lab_name, None, None, hx, sources[name].split(":")[0]))

    ncol_blocks = 2
    per_col = math.ceil(len(rows) / ncol_blocks)
    row_h = 1.0
    col_w = 16.0
    n_lm = len(ids)
    lm_cols = 8
    lm_rows = math.ceil(n_lm / lm_cols)
    tile = col_w * ncol_blocks / lm_cols
    top_h = per_col * row_h + 2.2
    lm_h = lm_rows * (tile + 0.9) + 2.4
    total_h = top_h + lm_h
    fig_w = 17.0
    fig = plt.figure(figsize=(fig_w, fig_w * total_h / (col_w * ncol_blocks + 0.6)), dpi=110)
    ax = fig.add_axes([0.01, 0.005, 0.98, 0.99])
    ax.set_xlim(-0.3, col_w * ncol_blocks + 0.3)
    ax.set_ylim(total_h, 0)
    ax.axis("off")

    ax.text(0, 0.7, "Palette swatches and the ortho pixels they came from",
            fontsize=15, fontweight="bold", va="center")
    ax.text(0, 1.5, "Each row: ortho sample pixels (dark to light), raw median, toon swatch "
            "(lifted shadows, chroma x 1.18, same hue), name and hex. Chosen colours have no "
            "ortho sample.", fontsize=9, va="center", color="#444444")
    y0 = 2.2
    for i, (name, strip, rhex, ahex, detail) in enumerate(rows):
        cb, rr = divmod(i, per_col)
        x = cb * col_w
        y = y0 + rr * row_h
        if strip is not None:
            ax.imshow(strip, extent=(x, x + 5.6, y + 0.85, y + 0.1), interpolation="nearest")
        else:
            ax.text(x + 2.8, y + 0.48, "chosen (not seen from above)", ha="center",
                    va="center", fontsize=8, color="#777777", style="italic")
        if rhex:
            ax.add_patch(Rectangle((x + 5.8, y + 0.1), 1.2, 0.75, color=rhex, lw=0))
        ax.add_patch(Rectangle((x + 7.2, y + 0.1), 1.6, 0.75, color=ahex, lw=0))
        ax.text(x + 9.0, y + 0.36, name, fontsize=9.5, va="center", fontweight="bold")
        ax.text(x + 9.0, y + 0.72, f"{ahex}   raw {rhex}   {detail}" if rhex else
                f"{ahex}   {detail}", fontsize=7.8, va="center", color="#444444")
    ax.text(5.9, y0 - 0.12, "raw", fontsize=7.5, color="#666666")
    ax.text(7.3, y0 - 0.12, "swatch", fontsize=7.5, color="#666666")
    ax.text(col_w + 5.9, y0 - 0.12, "raw", fontsize=7.5, color="#666666")
    ax.text(col_w + 7.3, y0 - 0.12, "swatch", fontsize=7.5, color="#666666")

    # Landmark tints: a 20 m ortho crop around each crown, north up, with the crown outline.
    ly = top_h
    ax.text(0, ly + 0.6, "Landmark tints: each crown as the drone saw it, with its toon tint",
            fontsize=13, fontweight="bold", va="center")
    ax.text(0, ly + 1.3, "Tiles are 20 m across, north up; outline = crown polygon from the "
            "trees GeoPackage, or the palm crown where the survey made the landmark a palm. "
            "Tint = toon-adjusted median of the visible crown (darkest 10 % dropped).",
            fontsize=9, va="center", color="#444444")
    north_arrow(ax, col_w * 2 - 0.6, ly + 0.8, 0.45, up=-1)
    half = int(round(10.0 / CELL))
    gap = 0.25
    tw = tile - gap
    scale_bar(ax, col_w * 2 - 3.2, ly + 1.35, tw * 5.0 / 20.0, "5 m", 0.16, up=-1)
    for i, t in enumerate(ids):
        rr, cb = divmod(i, lm_cols)
        x = cb * tile
        y = ly + 2.0 + rr * (tile + 0.9)
        geom = crowns.loc[t].geometry
        cx, cy = geom.centroid.x, geom.centroid.y
        r0 = int(round((N_N - cy) / CELL)) - half
        c0 = int(round((cx - E_W) / CELL)) - half
        crop = np.full((2 * half, 2 * half, 3), 255, np.uint8)
        rs, re_ = max(r0, 0), min(r0 + 2 * half, NROW)
        cs, ce = max(c0, 0), min(c0 + 2 * half, NCOL)
        crop[rs - r0:re_ - r0, cs - c0:ce - c0] = g["rgb"][rs:re_, cs:ce]
        ax.imshow(crop, extent=(x, x + tw, y + tw, y), interpolation="bilinear")
        polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
        for p in polys:
            xy = np.array(p.exterior.coords)
            px = x + (xy[:, 0] - (cx - 10.0)) / 20.0 * tw
            py = y + ((cy + 10.0) - xy[:, 1]) / 20.0 * tw
            ax.plot(px, py, color="white", lw=0.9)
        ax.add_patch(Rectangle((x, y + tw + 0.05), tw * 0.42, 0.55, color=landmark_tints[t],
                               lw=0))
        ax.text(x + tw * 0.46, y + tw + 0.2, t, fontsize=8.5, fontweight="bold", va="center")
        ax.text(x + tw * 0.46, y + tw + 0.5, f"{landmark_kind(t).replace('_', ' ')}",
                fontsize=6.8, va="center", color="#444444")
        ax.text(x + tw * 0.46, y + tw + 0.78, landmark_tints[t], fontsize=6.8, va="center",
                color="#444444")
    out = CHECK_DIR / "palette_swatches.png"
    fig.savefig(out, facecolor="white")
    plt.close(fig)
    print(f"wrote {out.relative_to(GAME)}")


def draw_palette_map(g, sw, sampled, cen_w, wlab, visible, landmark_tints, ids, split,
                     litter, path, fringe, shrub_m, under_m, puff_m) -> None:
    """The site as the drone saw it beside the site painted with the palette."""
    lab, ok = g["lab"], g["valid"]
    L = lab[..., 0]
    paint = np.full((NROW, NCOL, 3), 238, np.uint8)

    def fill(mask, name, i=0):
        paint[mask & ok] = lab_to_srgb8(sampled[name][i])

    def fill_nearest(mask, name):
        """Each cell takes the variant whose raw colour is nearest its own."""
        m = mask & ok
        raws = np.array(sw[name]["raw"])
        d = ((lab[m][:, None, :] - raws[None]) ** 2).sum(-1).argmin(1)
        cols = np.array([lab_to_srgb8(x) for x in sampled[name]])
        paint[m] = cols[d]

    veg = np.where(g["known"], g["veg"], np.nan)
    with np.errstate(invalid="ignore"):
        low = g["land"] & (veg < LOW_VEG)
        path_like = (np.hypot(lab[..., 1], lab[..., 2]) < 12) & (L > 60)
        # Ground.
        fill(low & g["bank"], "bank_grass")
        fill(low & g["outline"], "lawn_sun")
        fill(low & (L <= split), "lawn_shade")
        fill(litter, "litter")
        fill(low & g["bank"] & path_like, "path")
        # Water.
        wat = g["water"] & g["open_water"]           # painted whether or not lidar saw it
        near = np.argmin(((lab[..., None, :] - cen_w[None, None]) ** 2).sum(-1), axis=-1)
        fill(wat & (near == 0), "water_deep")
        fill(wat & (near >= 1), "water_shallow")
        # Vegetation, lowest first so taller layers win.
        bank_veg = g["bank"] & (veg >= LOW_VEG)
        fill_nearest(bank_veg | (g["water"] & ~g["open_water"] & ~g["outline"]), "canopy_puff")
        fill_nearest(shrub_m, "shrub")
        fill_nearest(under_m, "understorey")
        fill_nearest(puff_m, "canopy_puff")
        fill_nearest(fringe, "crown_mangrove")
    for t in ids:
        paint[visible[t] & ok & (veg > 1.0)] = [int(landmark_tints[t][i:i + 2], 16)
                                                for i in (1, 3, 5)]

    fig, axes = plt.subplots(1, 2, figsize=(16, 9.4), dpi=110)
    ext = (E_W - 573150, E_E - 573150, N_S - 2840100, N_N - 2840100)
    for ax, img, title in [(axes[0], np.where(ok[..., None], g["rgb"], 238).astype(np.uint8),
                            "Drone orthomosaic, October 2025 (0.125 m)"),
                           (axes[1], paint, "Painted with the game palette")]:
        ax.imshow(img, extent=ext, interpolation="nearest")
        ax.set_title(title, fontsize=12)
        ax.set_xlabel("metres east of E 573150")
        ax.set_ylabel("metres north of N 2840100")
        ax.tick_params(labelsize=8)
        north_arrow(ax, 88, 100, 4.5)
        scale_bar(ax, -62, 100, 20, "20 m", 1.6)
        for (x, y, s) in LABELS:
            ax.text(x, y, s, ha="center", va="center", fontsize=10, color="#1b1b1b",
                    fontweight="bold",
                    path_effects=[pe.withStroke(linewidth=2.5, foreground="white")])
    fig.tight_layout()
    out = CHECK_DIR / "palette_map.png"
    fig.savefig(out, facecolor="white")
    plt.close(fig)
    print(f"wrote {out.relative_to(GAME)}")


if __name__ == "__main__":
    main()
