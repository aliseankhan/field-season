"""Terrain and water for the Lizard Island game.

Turns the site rasters (0.5 m ground, water and vegetation height), the
island vegetation layers (0.25 m height bands and canopy height) and the
island outlines into the game's terrain grid and water geometry:

    data/terrain.json         grid description, start point, bounds, stats
    data/terrain_height.u16   ground or lake bed height, y = -3.0 + v * 0.001
    data/terrain_mask.u8      bit mask of cell classes (see MASK_BITS)
    data/terrain_canopy.u8    vegetation height above ground, 0.1 m units
    data/water.json           land, outline, shoreline, causeway, banks and
                              open water as rings in the game frame
    check/terrain_quicklook.png

Game frame (metres, y up): x = E - 573150, z = -(N - 2840100),
y = h + 24.90, so the lake surface is y = 0 and north is -z.

All sources are read only. Run from the game folder:
    python preprocess/terrain.py
"""

import json
import warnings
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from matplotlib.colors import LightSource
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage as ndi
from scipy import sparse
from scipy.sparse.linalg import spsolve
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient
from skimage.measure import find_contours

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent
SITE = OUT / "LizardIsland_2025_site_map" / "rasters"
VEG = OUT / "LizardIsland_2025_vegetation_layers_cleaned" / "gis"
CROP = OUT / "LizardIsland_2025_splat" / "opensplat" / "work" / "island_crop_outline.gpkg"
TREES_GPKG = OUT / "LizardIsland_2025_trees" / "LizardIsland_2025_trees.gpkg"  # landmark stems
SCANNERS = OUT / "scanner_positions.csv"  # tripod positions, used only as a walkability check

DATA = GAME / "data"
CHECK = GAME / "check"
for d in (DATA, CHECK):
    d.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Frame and grid
# ---------------------------------------------------------------------------
E0, N0, H0 = 573150.0, 2840100.0, -24.90  # game origin; H0 is the lake surface
FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.90,
         "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}

CELL = 0.25
E_W, E_E, N_S, N_N = 573080.0, 573250.0, 2840030.0, 2840215.0  # site frame
COLS = int(round((E_E - E_W) / CELL))  # 680
ROWS = int(round((N_N - N_S) / CELL))  # 740
GRID_T = from_origin(E_W, N_N, CELL, CELL)  # row 0 is the north edge

# centre of every game cell in E, N and in the game frame
COL_E = E_W + (np.arange(COLS) + 0.5) * CELL
ROW_N = N_N - (np.arange(ROWS) + 0.5) * CELL
X0 = round(COL_E[0] - E0, 3)          # game x of cell (0, 0) centre
Z0 = round(-(ROW_N[0] - N0), 3)       # game z of cell (0, 0) centre

MASK_BITS = {"water": 1, "island": 2, "causeway": 4, "bank": 8,
             "thicket": 16, "walkable": 32, "fringe": 64}

HEIGHT_SCALE, HEIGHT_OFFSET = 0.001, -3.0
CANOPY_SCALE = 0.1

# ---------------------------------------------------------------------------
# Tunable choices, all in metres unless stated
# ---------------------------------------------------------------------------
LAND_MIN_Y = 0.03          # ground on land stays at least this far above water
SPIKE_H = 0.5              # land cells this far above their local median are refilled
SPIKE_WIN = 10.5           # width of the window for that median
ISLET_MAX_Y = 0.30         # mud among the mangrove roots is kept low
BANK_MAX_Y = 2.5           # no bank ground in this frame stands higher above the lake
BANK_EDGE_Y, BANK_SLOPE = 0.4, 0.4  # bank ground at most 0.4 m + 0.4 m per metre from water
GROUND_SIGMA = 0.35        # gentle Gaussian smoothing of the 0.25 m ground
BED_DEEP_Y = -1.20         # stylised lake depth well away from the shore
BED_EDGE_Y = -0.06         # bed right at the shore
BED_SHELF_Y = -0.36        # bed at the end of the shallow shelf
BED_SHELF_W = 1.5          # width of the shallow shelf
BED_DROP = (1.0, 7.0)      # distance band over which the bed falls to BED_DEEP_Y
BED_EASE_M = 2.0           # under the fringe and canopy the bed stays on the shelf, easing
                           # back to the open-water bed over this distance outside it
SPECK_M2 = 25.0            # non-water pieces smaller than this are not far bank
NECK_MAX_W = 14.0          # a row of land narrower than this counts as causeway
LANDING_R = 3.0            # landing disc radius at the garden end of the causeway
LANDING_BACK = 2.0         # landing disc centre, this far south of the causeway end
START_IN = 2.5             # player start, this far along the causeway from its garden end
THICKET_OPEN_R = 2         # cells; opening removes anything narrower than about 1 m
THICKET_CLOSE_R = 1        # cells; closing fills slits too narrow to walk through
THICKET_MIN_M2 = 1.5       # smallest thicket blob kept
THICKET_HOLE_M2 = 1.0      # holes in thicket smaller than this are filled
TRUNK_CLEAR_M = 0.35       # thicket is cleared this far beyond a landmark stem's collider
                           # (radius dbh / 2 + 0.15, as in placements.py)
TRUNK_BLOB_M2 = 3.0        # a thicket blob smaller than this touching a landmark stem is the trunk
WALK_OPEN_R = 1            # cells; opening of the walkable area
CANOPY_SPECK_M2 = 3.0      # canopy blobs smaller than this standing in water are reflections
                           # (the same speck size placements.py drops)
RING_SIMPLIFY = 0.1        # vertex tolerance for all rings and lines
MIN_HOLE_M2 = 1.0          # holes smaller than this are left out of the rings


def disk(r):
    """Boolean disk structuring element of radius r cells."""
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r + 0.5


def drop_small(mask, min_cells, structure=None):
    """Remove connected pieces of mask smaller than min_cells."""
    lab, n = ndi.label(mask, structure=structure)
    if n == 0:
        return mask.copy()
    size = np.bincount(lab.ravel())
    keep = size >= min_cells
    keep[0] = False
    return keep[lab]


def fill_small_holes(mask, max_cells):
    """Fill holes in mask (pieces of ~mask not touching the edge) below max_cells."""
    holes = ~mask
    lab, n = ndi.label(holes)
    if n == 0:
        return mask.copy()
    size = np.bincount(lab.ravel())
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    small = size < max_cells
    small[0] = False
    small[edge] = False
    return mask | small[lab]


def read_site(name):
    with rasterio.open(SITE / name) as src:
        assert src.shape == (ROWS // 2, COLS // 2)
        assert abs(src.transform.a - 0.5) < 1e-9 and abs(src.transform.c - E_W) < 1e-6
        assert abs(src.transform.f - N_N) < 1e-6
        return src.read(1)


def place_veg(name, fill):
    """Paste a 0.25 m vegetation raster into the game grid by exact integer offset."""
    with rasterio.open(VEG / name) as src:
        t = src.transform
        assert abs(t.a - CELL) < 1e-9 and abs(-t.e - CELL) < 1e-9
        c0 = (t.c - E_W) / CELL
        r0 = (N_N - t.f) / CELL
        assert abs(c0 - round(c0)) < 1e-6 and abs(r0 - round(r0)) < 1e-6
        c0, r0 = int(round(c0)), int(round(r0))
        a = src.read(1)
    out = np.full((ROWS, COLS), fill, dtype=a.dtype)
    out[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    cover = np.zeros((ROWS, COLS), bool)
    cover[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = True
    return out, cover


def up2(a):
    """0.5 m to 0.25 m by bilinear interpolation at the finer cell centres."""
    r = (np.arange(ROWS) + 0.5) / 2.0 - 0.5
    c = (np.arange(COLS) + 0.5) / 2.0 - 0.5
    rr, cc = np.meshgrid(r, c, indexing="ij")
    return ndi.map_coordinates(a.astype(np.float64), [rr, cc], order=1, mode="nearest")


def rasterise(geoms):
    return rasterize([(g, 1) for g in geoms], out_shape=(ROWS, COLS),
                     transform=GRID_T, fill=0, dtype="uint8").astype(bool)


def laplace_fill(values, unknown):
    """Harmonic fill of the unknown cells from their known 4-neighbours.

    Solves the discrete Laplace equation on the unknown cells with the known
    cells as fixed boundary values; the frame edge is a no-flux boundary.
    """
    idx = -np.ones(values.shape, np.int64)
    ur, uc = np.nonzero(unknown)
    idx[ur, uc] = np.arange(ur.size)
    rows, cols, vals = [], [], []
    rhs = np.zeros(ur.size)
    deg = np.zeros(ur.size)
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = ur + dr, uc + dc
        ok = (nr >= 0) & (nr < values.shape[0]) & (nc >= 0) & (nc < values.shape[1])
        i = np.nonzero(ok)[0]
        nr, nc = nr[ok], nc[ok]
        deg[i] += 1
        j = idx[nr, nc]
        nb_unknown = j >= 0
        rows.append(i[nb_unknown]); cols.append(j[nb_unknown])
        vals.append(-np.ones(nb_unknown.sum()))
        np.add.at(rhs, i[~nb_unknown], values[nr[~nb_unknown], nc[~nb_unknown]])
    rows.append(np.arange(ur.size)); cols.append(np.arange(ur.size)); vals.append(deg)
    A = sparse.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
                          shape=(ur.size, ur.size))
    out = values.copy()
    out[ur, uc] = spsolve(A, rhs)
    return out


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# Geometry helpers for water.json
# ---------------------------------------------------------------------------
def to_game(coords):
    """(E, N) sequence to [[x, z], ...] rounded to 0.01 m."""
    a = np.asarray(coords, float)
    x = np.round(a[:, 0] - E0, 2)
    z = np.round(-(a[:, 1] - N0), 2)
    return [[float(u), float(v)] for u, v in zip(x, z)]


def ring_out(ring):
    """Open ring (closing vertex dropped) in the game frame."""
    c = list(ring.coords)
    if len(c) > 1 and c[0] == c[-1]:
        c = c[:-1]
    return to_game(c)


def polygon_rings(poly):
    """Oriented rings of a polygon: exterior counter-clockwise, holes clockwise.

    Orientation is judged in E, N (seen from above with north up); shapely's
    orient(sign=1) gives exactly that. Returns [(ring, is_hole), ...].
    """
    poly = orient(poly, sign=1.0)
    out = [(ring_out(poly.exterior), False)]
    out += [(ring_out(r), True) for r in poly.interiors if Polygon(r).area >= MIN_HOLE_M2]
    return out


def mask_polygons(mask, min_area, sigma=0.8):
    """Polygons (with holes) tracing a boolean game-grid mask.

    The mask is softened with a small Gaussian and traced at the half level by
    marching squares, so edges follow the cells without a staircase. Rings are
    nested by containment and simplified to RING_SIMPLIFY.
    """
    f = ndi.gaussian_filter(mask.astype(float), sigma) if sigma else mask.astype(float)
    f = np.pad(f, 1)
    polys = []
    for c in find_contours(f, 0.5):
        r, k = c[:, 0] - 1.0, c[:, 1] - 1.0
        e = E_W + (k + 0.5) * CELL
        n = N_N - (r + 0.5) * CELL
        p = Polygon(np.c_[e, n])
        if not p.is_valid:
            p = p.buffer(0)
            if p.geom_type != "Polygon":
                continue
        if p.area >= 0.25 * min_area:
            polys.append(Polygon(p.exterior))
    polys.sort(key=lambda p: -p.area)
    depth = [sum(1 for q in polys[:i] if q.contains(p.representative_point()))
             for i, p in enumerate(polys)]
    shells = []
    for p, d in zip(polys, depth):
        if d % 2 == 0:
            shells.append([p, []])
        else:
            # the innermost even-depth ring containing this hole
            for s in reversed(shells):
                if s[0].contains(p.representative_point()):
                    s[1].append(p)
                    break
    out = []
    for shell, holes in shells:
        poly = Polygon(shell.exterior, [h.exterior for h in holes])
        poly = poly.simplify(RING_SIMPLIFY, preserve_topology=True)
        if poly.area >= min_area:
            out.append(poly)
    return out


def chaikin(poly, iterations=2):
    """Corner-cut a polygon's rings (Chaikin), rounding the 0.5 m stair steps
    of a raster-traced outline while staying within a quarter of a step of it."""
    def cut(ring):
        a = np.asarray(ring.coords)[:-1]
        for _ in range(iterations):
            b = np.roll(a, -1, axis=0)
            a = np.stack([0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b], axis=1).reshape(-1, 2)
        return a
    return Polygon(cut(poly.exterior), [cut(r) for r in poly.interiors])


def rings_block(polys):
    rings, holes = [], []
    for p in polys:
        for ring, is_hole in polygon_rings(p):
            rings.append(ring)
            holes.append(is_hole)
    return rings, holes


# ===========================================================================
# 1. Site rasters at 0.5 m, and the island outlines
# ===========================================================================
g05 = read_site("LizardIsland_2025_site_ground_height.tif").astype(np.float64)
water05 = read_site("LizardIsland_2025_site_water_mask.tif") == 1
open05 = read_site("LizardIsland_2025_site_open_water_mask.tif") == 1
veg05 = read_site("LizardIsland_2025_site_vegetation_height.tif").astype(np.float64)
unseen05 = ~np.isfinite(g05)

land_gdf = gpd.read_file(VEG / "LizardIsland_2025_vegetation_island_land.shp")
crop_gdf = gpd.read_file(CROP)
shore_gdf = gpd.read_file(VEG / "LizardIsland_2025_vegetation_shoreline.shp")
land_poly = land_gdf.geometry.union_all()
crop_poly = crop_gdf.geometry.union_all()
island05 = rasterize([(land_poly, 1)], out_shape=g05.shape, transform=from_origin(E_W, N_N, 0.5, 0.5),
                     fill=0, dtype="uint8").astype(bool)

# Unseen cells (no returns) are either lake the beam never came back from or
# bank beyond the scanners' reach. Each unseen piece takes the side it borders
# most: water if its rim touches at least as much water as land.
lab, n = ndi.label(unseen05)
water_ext05 = water05.copy()
unseen_lake05 = np.zeros_like(water05)
for i in range(1, n + 1):
    piece = lab == i
    rim = ndi.binary_dilation(piece) & ~piece
    if (rim & water05).sum() >= (rim & ~water05 & ~unseen05).sum():
        water_ext05 |= piece
        unseen_lake05 |= piece

# ===========================================================================
# 2. Ground field at 0.5 m: water cells anchor the shore at the lake level;
#    unseen land, land below the lake surface, spikes and implausible bank
#    readings are refilled by a harmonic (smooth) interpolation from the
#    measured ground around them.
# ===========================================================================
land05 = ~water_ext05 & np.isfinite(g05)
below_lake05 = land05 & (g05 < H0)
# Spikes: a few land cells, mostly at the frame edge far from the scanners
# and among the mangroves, stand metres above the ground around them (canopy
# or plateaus of filled values read as ground). A cell more than SPIKE_H above
# the median of the land cells in a SPIKE_WIN window around it is refilled.
land_g05 = np.where(land05, g05, np.nan)
with warnings.catch_warnings():
    warnings.simplefilter("ignore", RuntimeWarning)
    med05 = ndi.generic_filter(land_g05, np.nanmedian, size=int(SPIKE_WIN / 0.5) | 1,
                               mode="constant", cval=np.nan)
spike05 = np.nan_to_num(land_g05 - med05, nan=0.0) > SPIKE_H
# Off the island, dense mangrove clumps and the far edge of the scans leave
# plateaus of vegetation read as ground. Bank ground cannot stand more than
# BANK_EDGE_Y + BANK_SLOPE * (distance to water) above the lake, nor above
# BANK_MAX_Y anywhere in this frame; readings above that are refilled.
dwater05 = ndi.distance_transform_edt(~water_ext05, sampling=0.5)
yv05 = g05 - H0
implausible05 = land05 & ~island05 & ((yv05 > BANK_MAX_Y) | (yv05 > BANK_EDGE_Y + BANK_SLOPE * dwater05))
unknown05 = ~water_ext05 & (unseen05 | below_lake05 | spike05 | implausible05)
anchor05 = np.where(water_ext05, H0, np.nan_to_num(g05, nan=H0))
ground05 = laplace_fill(anchor05, unknown05)

# ===========================================================================
# 3. Water, land polygons and the causeway at 0.25 m
# ===========================================================================
land_m = rasterise([land_poly])
crop_m = rasterise([crop_poly])

# water edge at 0.25 m: bilinear from 0.5 m, softened a little, halved
water25 = ndi.gaussian_filter(up2(water_ext05.astype(float)), 0.7) >= 0.5
unseen_lake25 = ndi.gaussian_filter(up2(unseen_lake05.astype(float)), 0.7) >= 0.5
nonwater25 = ~water25 | land_m

# The causeway is found as the neck of land joining the island to the south
# bank: starting near E 573136 N 2840068, every row of cells is scanned for
# the run of land through the neck; the causeway is the run of consecutive
# rows around the narrowest one where the land is narrower than NECK_MAX_W.
seed_E, seed_N = 573136.0, 2840068.0
max_half = int(30.0 / CELL)


def land_run(r, c):
    """Columns [a, b] of the land run in row r through (or next to) column c."""
    row = nonwater25[r]
    if not row[c]:
        near = [cc for cc in range(c - 12, c + 13) if 0 <= cc < COLS and row[cc]]
        if not near:
            return None
        c = min(near, key=lambda cc: abs(cc - c))
    a = c
    while a > 0 and row[a - 1] and c - a < max_half:
        a -= 1
    b = c
    while b < COLS - 1 and row[b + 1] and b - c < max_half:
        b += 1
    return a, b


r_seed = int((N_N - seed_N) / CELL)
c_seed = int((seed_E - E_W) / CELL)
runs = {}
for direction in (-1, 1):  # north then south of the seed row
    c = c_seed
    r = r_seed
    while abs(r - r_seed) <= int(25.0 / CELL):
        run = land_run(r, c)
        if run is None:
            break
        runs[r] = run
        a, b = run
        if (b - a + 1) * CELL < 20.0:
            c = (a + b) // 2  # follow the centre of the strip
        r += direction
width = {r: (b - a + 1) * CELL for r, (a, b) in runs.items()}
r_narrow = min(width, key=width.get)
neck_rows = [r_narrow]
for direction in (-1, 1):
    r = r_narrow + direction
    while r in width and width[r] <= NECK_MAX_W:
        neck_rows.append(r)
        r += direction
neck_rows.sort()
causeway = np.zeros((ROWS, COLS), bool)
for r in neck_rows:
    a, b = runs[r]
    causeway[r, a:b + 1] = True
causeway &= nonwater25

cw_rows = np.array(neck_rows)
cw_mid_E = np.array([E_W + (runs[r][0] + runs[r][1] + 1) * CELL / 2 for r in neck_rows])  # run centres
cw_mid_N = ROW_N[cw_rows]
cw_width = np.array([width[r] for r in neck_rows])
# Straight line fitted through the centre of the strip: E as a function of N
fit = np.polyfit(cw_mid_N, cw_mid_E, 1)
N_garden, N_island = cw_mid_N.min() - CELL / 2, cw_mid_N.max() + CELL / 2
E_garden, E_island = np.polyval(fit, N_garden), np.polyval(fit, N_island)
cw_len = float(np.hypot(E_island - E_garden, N_island - N_garden))

# ===========================================================================
# 4. Cell classes
# ===========================================================================
island = land_m & ~causeway
# Ground outside the island: a piece reaching the frame edge is far bank (the
# garden); a piece lying mostly inside the island outline is an islet of mud
# among the mangrove roots; any other piece is bank if it is big enough and
# otherwise a speck in the lake (a stump or floating debris), drawn as water.
other_land = nonwater25 & ~land_m & ~causeway
lab, n = ndi.label(other_land)
ids = np.arange(n + 1)
size = np.bincount(lab.ravel(), minlength=n + 1)
in_crop = np.bincount(lab.ravel(), weights=crop_m.ravel().astype(float), minlength=n + 1)
edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
touches_edge = np.isin(ids, edge_labels)
mostly_inside = in_crop >= 0.5 * np.maximum(size, 1)
is_bank = touches_edge | (~mostly_inside & (size * CELL * CELL >= SPECK_M2))
is_islet = ~is_bank & mostly_inside
is_bank[0] = is_islet[0] = False
bank = is_bank[lab]
islet = is_islet[lab]                           # ground among the mangroves
speck = other_land & ~bank & ~islet             # lake specks, drawn as water
fringe = crop_m & ~island & ~causeway & ~bank   # mangrove canopy standing in water
water = (water25 & ~land_m & ~causeway & ~bank & ~islet) | speck

# landing: a small disc of bank at the garden end of the causeway
land_cE = E_garden
land_cN = N_garden - LANDING_BACK
EE, NN = np.meshgrid(COL_E, ROW_N)
landing = bank & ((EE - land_cE) ** 2 + (NN - land_cN) ** 2 <= LANDING_R ** 2)

# Open water: water with no canopy over it (the site open-water mask), plus the unseen lake.
# Pieces and holes under 2 m2 are dropped or filled; the same area is traced for water.json.
a_cell = CELL * CELL
open25 = up2(open05.astype(float)) >= 0.5
open_water = (open25 | unseen_lake25) & water
open_water = drop_small(open_water, int(2.0 / a_cell))
open_water = fill_small_holes(open_water, int(2.0 / a_cell))
# Shallow water: the mangrove fringe and any water with canopy standing over it. The survey
# poles set down among the mangroves and nipa palms met the bed at y -0.35 to +0.02.
shallow = water & (fringe | ~open_water)

# ===========================================================================
# 5. Thicket from the 0-1 m and 1-2 m vegetation bands
# ===========================================================================
b01, vcover = place_veg("LizardIsland_2025_vegetation_0-1m_mask.tif", 255)
b12, _ = place_veg("LizardIsland_2025_vegetation_1-2m_mask.tif", 255)
ball, _ = place_veg("LizardIsland_2025_vegetation_all_heights_mask.tif", 255)
b01, b12, ball = b01 == 1, b12 == 1, ball == 1  # nodata (255) reads as no vegetation

# A cell is dense where vegetation fills both the 0-1 m and the 1-2 m band.
raw = b01 & b12 & ball
# Opening with a disk of 0.5 m radius drops trunks, single stems and speckle; a light
# closing fuses what is left into blobs without shutting walkable gaps; blobs
# under THICKET_MIN_M2 go and pinholes inside blobs are filled.
th = ndi.binary_opening(raw, structure=disk(THICKET_OPEN_R))
th = ndi.binary_closing(th, structure=disk(THICKET_CLOSE_R))
# Landmark trunks fill both bands themselves, and the opening does not remove a trunk as
# thick as a talipot's. Thicket is cleared a little beyond each landmark stem's collider,
# and a small blob touching a stem (the trunk and its skirt) goes altogether, so no trunk
# carries an invisible wall outside the one the game draws.
stems_gdf = gpd.read_file(TREES_GPKG, layer="tree_stems")
trunk_clear = np.zeros((ROWS, COLS), bool)
for s in stems_gdf.itertuples():
    trunk_clear |= (EE - s.base_E) ** 2 + (NN - s.base_N) ** 2 <= (s.dbh_m / 2 + 0.15 + TRUNK_CLEAR_M) ** 2
th &= ~trunk_clear
lab, n = ndi.label(th)
blob_m2 = np.bincount(lab.ravel(), minlength=n + 1) * CELL * CELL
at_trunk = np.zeros(n + 1, bool)
at_trunk[np.unique(lab[ndi.binary_dilation(trunk_clear, structure=disk(1))])] = True
at_trunk[0] = False
trunk_blobs = at_trunk & (blob_m2 < TRUNK_BLOB_M2)
th &= ~trunk_blobs[lab]
th = drop_small(th, int(THICKET_MIN_M2 / CELL ** 2))
th = fill_small_holes(th, int(THICKET_HOLE_M2 / CELL ** 2))
th &= ~trunk_clear        # a pinhole fill must not put the trunk discs back
th &= ~(~ball & vcover)   # never on cells the layers call bare (open lawn)
thicket = th & (island | causeway | landing | islet)

# ===========================================================================
# 6. Walkable area and start
# ===========================================================================
cand = (island | causeway | landing) & ~thicket

start_N = N_garden + START_IN
start_E = float(np.polyval(fit, start_N))
sr, sc = int((N_N - start_N) / CELL), int((start_E - E_W) / CELL)
if not cand[sr, sc]:
    # nearest candidate cell on the causeway
    cr, cc = np.nonzero(cand & causeway)
    k = np.argmin((cr - sr) ** 2 + (cc - sc) ** 2)
    sr, sc = int(cr[k]), int(cc[k])
    start_E, start_N = float(COL_E[sc]), float(ROW_N[sr])
# a light opening drops slits and spurs narrower than about 0.75 m, which a
# person could not pass; then only the 4-connected area holding the start is
# kept (4-connected, so there is no squeezing through diagonal gaps)
cand_open = ndi.binary_opening(cand, structure=disk(WALK_OPEN_R))
lab, n = ndi.label(cand_open)
assert lab[sr, sc] > 0, "start is not on walkable ground"
walkable = lab == lab[sr, sc]

# heading along the causeway into the island. Convention: heading 0 faces -z
# (north); positive heading turns towards -x (anticlockwise seen from above),
# as three.js rotation.y, so forward = (-sin h, 0, -cos h).
dx = float(E_island - E_garden)
dz = float(-(N_island - N_garden))
heading = float(np.arctan2(-dx, -dz))

# ===========================================================================
# 7. Heights at 0.25 m
# ===========================================================================
land_any = island | causeway | bank | islet
g25 = up2(ground05) - H0                         # game y
g25 = ndi.gaussian_filter(g25, GROUND_SIGMA / CELL)
g25 = np.where(land_any, np.maximum(g25, LAND_MIN_Y), g25)
# Ground read among the mangrove roots is mostly roots and filled plateaus,
# so islets are drawn as low mud.
g25 = np.where(islet, np.minimum(g25, ISLET_MAX_Y), g25)

# Lake bed: shelves down with distance from the nearest land cell.
dist = ndi.distance_transform_edt(water, sampling=CELL)
bed = (BED_EDGE_Y
       + (BED_SHELF_Y - BED_EDGE_Y) * smoothstep(0.0, BED_SHELF_W, dist)
       + (BED_DEEP_Y - BED_SHELF_Y) * smoothstep(BED_DROP[0], BED_DROP[1], dist))
bed = ndi.gaussian_filter(bed, 2.0)  # 0.5 m, softens the ridges of the distance field
bed = np.minimum(bed, BED_EDGE_Y)
# Under the fringe and under canopy the bed stays on the shelf (no deeper than BED_SHELF_Y),
# so mangroves, nipa palms and canopy clumps standing in the water are not left floating over
# a deep hole; outside that zone it eases back to the open-water bed over BED_EASE_M.
d_shallow = ndi.distance_transform_edt(~shallow, sampling=CELL)
w_shallow = 1.0 - smoothstep(0.0, BED_EASE_M, d_shallow)
bed = w_shallow * np.maximum(bed, BED_SHELF_Y) + (1.0 - w_shallow) * bed
height = np.where(water, bed, g25)
assert not np.any(~water & ~land_any), "every cell must be water or classed land"

# ===========================================================================
# 8. Canopy: 0.25 m canopy height where it covers, else the 0.5 m vegetation
# ===========================================================================
can25, _ = place_veg("LizardIsland_2025_vegetation_canopy_height.tif", -9999.0)
# Where the ground was refilled, the site vegetation height was measured from
# the discarded reading; re-measure it from the refilled ground so the tops of
# the plants stay where they were.
refilled05 = unknown05 & np.isfinite(g05)
veg_fix05 = np.where(refilled05 & (np.nan_to_num(veg05) > 0), veg05 + (g05 - ground05), veg05)
veg_up = np.repeat(np.repeat(np.nan_to_num(veg_fix05, nan=0.0), 2, axis=0), 2, axis=1)
veg_up = np.where(veg_up >= 0.5, veg_up, 0.0)  # the site raster calls < 0.5 m bare
canopy = np.where(can25 > -9000, np.maximum(can25, 0.0), veg_up)
canopy = np.clip(canopy, 0.0, 25.5)
canopy_from_fine = can25 > -9000
# Nothing grows on open water. The lidar sees reflections of the trees in the still lake as
# small "vegetation" specks, metres tall, out on the water: canopy is zeroed on open water
# (the area the open-water rings trace), and any canopy blob under CANOPY_SPECK_M2 that stands
# mostly on water is dropped too, as placements.py drops such specks.
canopy_open_cells = int(((canopy > 0) & open_water).sum())
canopy[open_water] = 0.0
lab, n = ndi.label(canopy > 0, structure=np.ones((3, 3)))
blob_cells = np.bincount(lab.ravel(), minlength=n + 1)
blob_water = np.bincount(lab.ravel(), weights=water.ravel().astype(float), minlength=n + 1)
ghost = (blob_cells * a_cell < CANOPY_SPECK_M2) & (blob_water >= 0.5 * blob_cells)
ghost[0] = False
canopy_ghost_cells = int(ghost[lab].sum())
canopy[ghost[lab]] = 0.0

# ===========================================================================
# 9. Encode and write the grids
# ===========================================================================
hv = np.round((height - HEIGHT_OFFSET) / HEIGHT_SCALE)
assert hv.min() >= 0 and hv.max() <= 65535
h_u16 = hv.astype("<u2")
mask = (water * MASK_BITS["water"] + island * MASK_BITS["island"]
        + causeway * MASK_BITS["causeway"] + bank * MASK_BITS["bank"]
        + thicket * MASK_BITS["thicket"] + walkable * MASK_BITS["walkable"]
        + fringe * MASK_BITS["fringe"]).astype(np.uint8)
c_u8 = np.round(canopy / CANOPY_SCALE).astype(np.uint8)

files = {"height": DATA / "terrain_height.u16", "mask": DATA / "terrain_mask.u8",
         "canopy": DATA / "terrain_canopy.u8"}
h_u16.tofile(files["height"])
mask.tofile(files["mask"])
c_u8.tofile(files["canopy"])

# decoded height, exactly as the game will see it
y = HEIGHT_OFFSET + h_u16.astype(np.float64) * HEIGHT_SCALE


def span(sel):
    v = y[sel]
    return {"min": round(float(v.min()), 3), "median": round(float(np.median(v)), 3),
            "max": round(float(v.max()), 3)}


# walk bounds from cell edges of the walkable area
wr, wc = np.nonzero(walkable)
xs = COL_E[wc] - E0
zs = -(ROW_N[wr] - N0)
walk_bounds = [round(float(xs.min() - CELL / 2), 2), round(float(zs.min() - CELL / 2), 2),
               round(float(xs.max() + CELL / 2), 2), round(float(zs.max() + CELL / 2), 2)]

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
island_m2 = island.sum() * a_cell
walk_island = (walkable & island).sum() * a_cell
walk_share = walk_island / island_m2
cand_lost = ((cand & ~walkable) & island).sum() * a_cell
thicket_share = (thicket & island).sum() * a_cell / island_m2
# shore band: island land within 1.5 m of water or fringe
near_water = ndi.distance_transform_edt(~(water | fringe), sampling=CELL) <= 1.5
shore_band = island & near_water
shore_thicket = (thicket & shore_band).sum() / max(shore_band.sum(), 1)
fringe_blocked = ((water | thicket) & fringe).sum() / max(fringe.sum(), 1)

# tripod positions on the island were all reached on foot, so they should be
# walkable or right next to walkable ground
scan = pd.read_csv(SCANNERS)
sr_ = ((N_N - scan.N) / CELL).astype(int).to_numpy()
sc_ = ((scan.E - E_W) / CELL).astype(int).to_numpy()
inside = (sr_ >= 0) & (sr_ < ROWS) & (sc_ >= 0) & (sc_ < COLS)
on_island = np.zeros(len(scan), bool)
on_island[inside] = island[sr_[inside], sc_[inside]]
walk_dist = ndi.distance_transform_edt(~walkable, sampling=CELL)
scan_d = walk_dist[sr_[on_island], sc_[on_island]]

start_y = float(y[sr, sc])
cw_x = [round(float(COL_E[np.nonzero(causeway)[1]].min() - E0 - CELL / 2), 2),
        round(float(COL_E[np.nonzero(causeway)[1]].max() - E0 + CELL / 2), 2)]
cw_z = [round(float(-(N_island - N0)), 2), round(float(-(N_garden - N0)), 2)]

stats = {
    "grid_cells": int(ROWS * COLS),
    "file_bytes": {k: int(p.stat().st_size) for k, p in files.items()},
    "island_land_m2": round(float(island_m2), 1),
    "island_polygon_m2": round(float(land_poly.area), 1),
    "causeway_m2": round(float(causeway.sum() * a_cell), 1),
    "landing_m2": round(float(landing.sum() * a_cell), 1),
    "bank_m2": round(float(bank.sum() * a_cell), 1),
    "fringe_m2": round(float(fringe.sum() * a_cell), 1),
    "water_m2": round(float(water.sum() * a_cell), 1),
    "walkable_m2": round(float(walkable.sum() * a_cell), 1),
    "walkable_share_of_island": round(float(walk_share), 4),
    "island_thicket_share": round(float(thicket_share), 4),
    "open_island_cut_off_m2": round(float(cand_lost), 1),
    "shore_band_thicket_share": round(float(shore_thicket), 4),
    "fringe_water_or_thicket_share": round(float(fringe_blocked), 4),
    "height_y": {"island": span(island), "causeway": span(causeway), "bank": span(bank), "islet": span(islet),
                 "walkable": span(walkable), "lake_bed": span(water),
                 "lake_bed_shallow": span(shallow)},
    "causeway": {
        "garden_end": {"x": round(float(E_garden - E0), 2), "z": round(float(-(N_garden - N0)), 2)},
        "island_end": {"x": round(float(E_island - E0), 2), "z": round(float(-(N_island - N0)), 2)},
        "x_range": cw_x, "z_range": cw_z,
        "length_m": round(cw_len, 1),
        "width_m": {"min": float(cw_width.min()), "median": float(np.median(cw_width)),
                    "max": float(cw_width.max())},
        "bearing_deg": round(float(np.degrees(np.arctan2(dx, -dz))) % 360, 1),
        "note": "neck of land between water on both sides, south-west of the island, running roughly north to the island from the south bank",
    },
    "canopy_from_0.25m_share": round(float(canopy_from_fine.mean()), 4),
    "canopy_cells_zeroed_on_open_water": canopy_open_cells,
    "canopy_cells_dropped_as_water_specks": canopy_ghost_cells,
    "shallow_water_m2": round(float(shallow.sum() * a_cell), 1),
    "thicket_trunk_blobs_dropped": int(trunk_blobs.sum()),
    "unseen_cells_filled_as_lake": int(unseen_lake05.sum() * 4),
    "unseen_cells_filled_as_bank": int((unseen05 & ~unseen_lake05).sum() * 4),
    "land_cells_below_lake_refilled": int(below_lake05.sum() * 4),
    "land_spike_cells_refilled": int(spike05.sum() * 4),
    "bank_implausible_cells_refilled": int((implausible05 & ~spike05).sum() * 4),
    "islet_m2": round(float(islet.sum() * a_cell), 1),
    "island_scan_positions": int(on_island.sum()),
    "island_scan_positions_walkable": int((scan_d == 0).sum()),
    "island_scan_positions_within_1m_of_walkable": int((scan_d <= 1.0).sum()),
    "method": {
        "ground": "site ground 0.5 m; unseen land, land below the lake, spikes over %.1f m above a %.1f m median and bank readings above min(%.1f, %.1f + %.1f x distance to water) m refilled by a harmonic fill; bilinear to 0.25 m; Gaussian sigma %.2f m; land floored at y = %.2f; mangrove islets capped at y = %.2f" % (SPIKE_H, SPIKE_WIN, BANK_MAX_Y, BANK_EDGE_Y, BANK_SLOPE, GROUND_SIGMA, LAND_MIN_Y, ISLET_MAX_Y),
        "bed": "water cells: y from %.2f at the shore, %.2f at %.1f m, easing to %.2f by %.0f m from land; under the fringe and under canopy the bed is held no deeper than %.2f, easing back over %.1f m outside" % (BED_EDGE_Y, BED_SHELF_Y, BED_SHELF_W, BED_DEEP_Y, BED_DROP[1], BED_SHELF_Y, BED_EASE_M),
        "thicket": "0-1 m and 1-2 m bands both present; opened with a %.2f m radius disk, closed %.2f m, cleared %.2f m beyond each landmark stem collider, blobs under %.1f m2 touching a stem dropped, blobs under %.1f m2 dropped, holes under %.1f m2 filled, never on bare cells" % (THICKET_OPEN_R * CELL, THICKET_CLOSE_R * CELL, TRUNK_CLEAR_M, TRUNK_BLOB_M2, THICKET_MIN_M2, THICKET_HOLE_M2),
        "walkable": "island, causeway and a %.0f m radius landing on the bank, minus thicket, opened by %.2f m, 4-connected component holding the start" % (LANDING_R, WALK_OPEN_R * CELL),
        "canopy": "0.25 m canopy height where mapped, else 0.5 m site vegetation height (below 0.5 m read as none); 0 on open water, and blobs under %.1f m2 standing mostly on water (reflections) dropped" % CANOPY_SPECK_M2,
        "classes": "island = land polygon minus causeway; fringe = crop outline minus island, causeway and bank; water = water beneath (open or under canopy) plus unseen lake; mask bits are exclusive except thicket, walkable and fringe",
    },
}

terrain = {
    "frame": FRAME,
    "cell": CELL,
    "cols": COLS,
    "rows": ROWS,
    "x0": X0,
    "z0": Z0,
    "layout": "row-major, row 0 is the north edge (smallest z), column index grows with +x, row index with +z",
    "height": {"file": files["height"].name, "scale": HEIGHT_SCALE, "offset": HEIGHT_OFFSET,
               "dtype": "uint16 little-endian"},
    "mask": {"file": files["mask"].name, "bits": MASK_BITS},
    "canopy": {"file": files["canopy"].name, "scale": CANOPY_SCALE, "dtype": "uint8"},
    "start": {"x": round(start_E - E0, 2), "z": round(-(start_N - N0), 2), "y": round(start_y, 2),
              "heading": round(heading, 4),
              "heading_convention": "radians; 0 faces -z (north); positive turns towards -x (anticlockwise seen from above, as three.js rotation.y); forward = (-sin h, 0, -cos h)"},
    "walk_bounds": walk_bounds,
    "stats": stats,
}
(DATA / "terrain.json").write_text(json.dumps(terrain, indent=1))

# ===========================================================================
# 10. water.json
# ===========================================================================
land_smooth = chaikin(land_poly.segmentize(0.5)).simplify(RING_SIMPLIFY, preserve_topology=True)
land_shift = land_smooth.exterior.hausdorff_distance(land_poly.exterior)
land_rings, land_holes = rings_block([land_smooth])
outline_rings, outline_holes = rings_block([crop_poly.simplify(RING_SIMPLIFY, preserve_topology=True)])
shore_lines = []
for geom in shore_gdf.geometry:
    line = LineString(geom.coords).simplify(RING_SIMPLIFY, preserve_topology=False)
    shore_lines.append(to_game(line.coords))

cw_polys = mask_polygons(causeway, 1.0, sigma=0.6)
cw_polys.sort(key=lambda p: -p.area)
causeway_ring = [ring_out(orient(cw_polys[0], 1.0).exterior)]

bank_polys = mask_polygons(bank, 2.0)
bank_rings, bank_holes = rings_block(bank_polys)

ow_polys = mask_polygons(open_water, 2.0)   # open water as worked out in step 4
ow_rings, ow_holes = rings_block(ow_polys)

water_json = {
    "frame": FRAME,
    "level_y": 0.0,
    "notes": "rings are [[x, z], ...] in the game frame, open (last vertex not repeated), simplified to about 0.1 m; outer rings anticlockwise and holes clockwise seen from above with north up (anticlockwise in E, N, so the shoelace sum over x, z is negative for an outer ring); 'holes' flags each ring of a list, parallel to it. land is the island land polygon with its 0.5 m stair steps corner-cut (within %.2f m of the source; it includes most of the causeway); causeway is the traced neck; banks are the far-bank land of the garden; open_water is water with no canopy over it; shoreline is the shore beneath the canopy." % land_shift,
    "land": land_rings,
    "outline": outline_rings,
    "shoreline": shore_lines,
    "causeway": causeway_ring,
    "banks": bank_rings,
    "open_water": ow_rings,
    "holes": {"land": land_holes, "outline": outline_holes, "banks": bank_holes,
              "open_water": ow_holes},
}
wpath = DATA / "water.json"
wpath.write_text(json.dumps(water_json, separators=(",", ":")))

# ===========================================================================
# 11. Quick look figure
# ===========================================================================
ls = LightSource(azdeg=315, altdeg=40)
shade = ls.hillshade(y, vert_exag=6.0, dx=CELL, dy=CELL)
rgb = np.zeros((ROWS, COLS, 3))
col = {
    "water": (0.55, 0.74, 0.86), "bank": (0.80, 0.80, 0.66), "island": (0.72, 0.63, 0.47),
    "walk": (0.78, 0.90, 0.60), "thicket": (0.20, 0.42, 0.20), "causeway": (0.93, 0.78, 0.50),
    "landing": (0.98, 0.88, 0.62), "fringe_land": (0.38, 0.58, 0.48),
}
rgb[:] = col["bank"]
rgb[water] = col["water"]
depth_t = np.clip(-y / 1.2, 0, 1)[..., None]
rgb = np.where(water[..., None], rgb * (1.0 - 0.45 * depth_t), rgb)
rgb[island] = col["island"]
rgb[islet] = col["fringe_land"]
rgb[causeway] = col["causeway"]
rgb[walkable & island] = col["walk"]
rgb[walkable & causeway] = col["causeway"]
rgb[landing] = col["landing"]
rgb[thicket] = col["thicket"]
fr = fringe & water
rgb[fr] = rgb[fr] * 0.75 + np.array([0.20, 0.50, 0.42]) * 0.25
img = np.clip(rgb * (0.55 + 0.45 * shade[..., None]), 0, 1)

extent = [-70, 100, 70, -115]  # x left to right, z top (north, -z) to bottom
fig, axes = plt.subplots(1, 2, figsize=(17, 9.6), gridspec_kw={"width_ratios": [1.0, 1.25]})
for ax, (xl, zl) in zip(axes, [((-70, 100), (70, -115)), ((-54, 72), (46, -44))]):
    ax.imshow(img, extent=extent, interpolation="nearest")
    ax.set_xlim(*xl)
    ax.set_ylim(*zl)
    ax.set_xlabel("x (m, east)")
    ax.set_ylabel("z (m, south)")
    ax.set_aspect("equal")
    ax.plot(start_E - E0, -(start_N - N0), "o", ms=7, mfc="#d02020", mec="white", mew=1.2, zorder=5)
    fx, fz = -np.sin(heading), -np.cos(heading)
    ax.plot([start_E - E0, start_E - E0 + 4 * fx], [-(start_N - N0), -(start_N - N0) + 4 * fz],
            "-", color="#d02020", lw=2, zorder=5)
    # north: small filled triangle with N
    x_span = xl[1] - xl[0]
    nx = xl[0] + 0.06 * x_span
    nz = zl[1] + 0.10 * (zl[0] - zl[1])
    s = 0.018 * x_span
    ax.fill([nx - s * 0.6, nx + s * 0.6, nx], [nz + s, nz + s, nz - s], color="black", zorder=6)
    ax.text(nx, nz + s * 2.4, "N", ha="center", va="center", fontsize=11, weight="bold", zorder=6)
    # scale bar
    L = 20 if x_span > 150 else 10
    bx = xl[0] + 0.05 * x_span
    bz = zl[0] - 0.05 * (zl[0] - zl[1])
    ax.plot([bx, bx + L], [bz, bz], "k-", lw=3, solid_capstyle="butt", zorder=6)
    ax.text(bx + L / 2, bz - 0.012 * (zl[0] - zl[1]), f"{L} m", ha="center", va="bottom", fontsize=9, zorder=6)

labels_all = [(10, -95, "North bank"), (40, -50, "Center Lake"), (-5, 5, "Island"),
              (40, 60, "South bank")]
for x_, z_, t in labels_all:
    axes[0].text(x_, z_, t, ha="center", va="center", fontsize=10, color="#222222")
# The causeway label sits on the strip itself, turned along it (garden end to island end, so it
# reads upwards); both panels draw north up with equal axes, so the angle on screen is the
# bearing in E, N.
cmx, cmz = 0.5 * (E_garden + E_island) - E0, -(0.5 * (N_garden + N_island) - N0)
cw_ang = float(np.degrees(np.arctan2(N_island - N_garden, E_island - E_garden)))
HALO = [pe.withStroke(linewidth=2.2, foreground="white")]
axes[1].text(cmx, cmz, "Causeway", rotation=cw_ang, rotation_mode="anchor", ha="center", va="center",
             fontsize=9, color="#222222", path_effects=HALO, zorder=6)
axes[1].text(-28, 8, "open ground", ha="center", va="center", fontsize=9, color="#333333")
axes[1].text(start_E - E0 + 1.2, -(start_N - N0) + 1.0, "start", ha="left", va="top", fontsize=9, color="#a01010")
axes[1].text(-48, 36, "lagoon", ha="center", va="center", fontsize=9, color="#1f3b57")

from matplotlib.patches import Patch
handles = [Patch(color=col["walk"], label="walkable island"), Patch(color=col["thicket"], label="thicket"),
           Patch(color=col["island"], label="island, cut off"), Patch(color=col["causeway"], label="causeway"),
           Patch(color=col["landing"], label="landing"), Patch(color=col["bank"], label="far bank"),
           Patch(color=col["fringe_land"], label="ground in the fringe"),
           Patch(color=col["water"], label="water (darker = deeper bed)")]
axes[1].legend(handles=handles, loc="lower right", fontsize=8, framealpha=0.9)
axes[0].set_title("Terrain grid, whole frame")
axes[1].set_title("Island: walkable %.0f%% of %.0f m2 of land" % (100 * walk_share, island_m2))
fig.tight_layout()
fig.savefig(CHECK / "terrain_quicklook.png", dpi=110)
plt.close(fig)

# A second look, at water.json exactly as written: every ring and line.
fig, ax = plt.subplots(figsize=(9.5, 10))
ax.imshow(np.where(water, 0.93, 1.0), extent=extent, cmap="gray", vmin=0, vmax=1, interpolation="nearest")
styles = {"banks": ("#8a8a5c", 1.0), "open_water": ("#2c6fa8", 0.8), "outline": ("#8b3fa0", 1.0),
          "land": ("#b5651d", 1.4), "causeway": ("#d4a017", 1.6)}
for key, (c_, lw_) in styles.items():
    for ring in water_json[key]:
        a = np.array(ring + ring[:1])
        ax.plot(a[:, 0], a[:, 1], "-", color=c_, lw=lw_)
for line in water_json["shoreline"]:
    a = np.array(line)
    ax.plot(a[:, 0], a[:, 1], "-", color="#1b3a5c", lw=0.5)
ax.set_xlim(-70, 100)
ax.set_ylim(70, -115)
ax.set_aspect("equal")
ax.set_xlabel("x (m, east)")
ax.set_ylabel("z (m, south)")
ax.fill([-64, -60, -62], [-104, -104, -108], color="black")
ax.text(-62, -100, "N", ha="center", va="center", fontsize=11, weight="bold")
ax.plot([-60, -40], [62, 62], "k-", lw=3, solid_capstyle="butt")
ax.text(-50, 60.5, "20 m", ha="center", va="bottom", fontsize=9)
for x_, z_, t in [(10, -95, "banks"), (40, -50, "open water"), (-5, 5, "land")]:
    ax.text(x_, z_, t, ha="center", va="center", fontsize=10)
ax.text(cmx, cmz, "causeway", rotation=cw_ang, rotation_mode="anchor", ha="center", va="center",
        fontsize=8, path_effects=HALO)
ax.set_title("water.json: land, outline, causeway, banks, open water, shoreline")
fig.tight_layout()
fig.savefig(CHECK / "water_rings.png", dpi=100)
plt.close(fig)

# ===========================================================================
# 12. Report
# ===========================================================================
print(f"grid {COLS} x {ROWS} cells of {CELL} m, x0 {X0} z0 {Z0}")
for k, p in files.items():
    print(f"  {p.name:22s} {p.stat().st_size / 1024:8.1f} KB")
print(f"  {'terrain.json':22s} {(DATA / 'terrain.json').stat().st_size / 1024:8.1f} KB")
print(f"  {'water.json':22s} {wpath.stat().st_size / 1024:8.1f} KB")
for k, v in stats["height_y"].items():
    print(f"height y {k:9s} min {v['min']:7.3f}  median {v['median']:7.3f}  max {v['max']:7.3f}")
print(f"island land {island_m2:.0f} m2 (polygon {land_poly.area:.0f} m2), thicket {100 * thicket_share:.1f} %, "
      f"walkable {100 * walk_share:.1f} % ({walk_island:.0f} m2), open island ground cut off {cand_lost:.0f} m2")
print(f"shore band (island within 1.5 m of water or fringe): thicket {100 * shore_thicket:.0f} %; "
      f"fringe water or thicket {100 * fringe_blocked:.1f} %")
print(f"thicket: {int(trunk_blobs.sum())} small blobs at landmark trunks dropped; canopy: {canopy_open_cells} "
      f"cells zeroed on open water, {canopy_ghost_cells} cells of water specks dropped")
print(f"shallow water under the fringe and canopy {shallow.sum() * a_cell:.0f} m2, bed there "
      f"{stats['height_y']['lake_bed_shallow']}")
print(f"causeway: garden end E {E_garden:.1f} N {N_garden:.1f} (x {E_garden - E0:.1f}, z {-(N_garden - N0):.1f}), "
      f"island end E {E_island:.1f} N {N_island:.1f} (x {E_island - E0:.1f}, z {-(N_island - N0):.1f}), "
      f"length {cw_len:.1f} m, width {cw_width.min():.2f} to {cw_width.max():.2f} m (median {np.median(cw_width):.2f})")
print(f"start x {start_E - E0:.2f} z {-(start_N - N0):.2f} y {start_y:.2f} heading {heading:.4f} rad "
      f"({np.degrees(heading):.1f} deg)")
print(f"walk bounds {walk_bounds}")
print(f"island scan positions {on_island.sum()}: walkable {(scan_d == 0).sum()}, within 1 m {(scan_d <= 1.0).sum()}")
print(f"water.json rings: land {len(land_rings)}, outline {len(outline_rings)}, shoreline {len(shore_lines)}, "
      f"banks {len(bank_rings)}, open water {len(ow_rings)}")
