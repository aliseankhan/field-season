"""Placements and colliders for the Lizard Island game.

Turns the survey products into three things the browser can place:

  landmarks  the 37 lidar trees of the island interior, with their measured trunks and crowns
  plants     the June 2026 RTK plant survey points that pass the frame check
  clumps     instanced low-poly vegetation that fills the canopy and understorey the
             rasters show but no landmark or plant explains

and a list of collision circles: trunks, and the solid-looking clumps and shrubs that stand on
walkable ground. Everything is written in the game frame (metres, y up, see FRAME below). All
sources are read only.

What each landmark is comes from the plant survey wherever a survey point marks its stem (see
identify_landmarks), except that the lab's own identifications (BRIEF_KINDS: the talipots, the
rainbow eucalyptus and the osprey pole) stand. A landmark the survey turns into a palm keeps the
table's trunk and gets a palm crown read from the drone orthomosaic; the clumps fill the rest of
its lidar crown.

Reads data/terrain.json and data/terrain_mask.u8, so terrain.py runs first (build_all.py keeps
that order): the walkable and causeway cells decide which clumps are cleared off the causeway
walk and which clumps get a collider.

Run from the game folder:
    .venv/bin/python preprocess/placements.py

Writes data/placements.json, data/colliders.json, check/placements_quicklook.png and
check/palm_crowns_quicklook.png.
"""

import json
import math
import warnings
from collections import Counter
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
import rasterio.enums
import rasterio.windows
from matplotlib.collections import PatchCollection
from matplotlib.patches import Circle, Polygon as MplPolygon
from rasterio import features
from rasterio.transform import from_origin
from scipy import ndimage
from shapely import affinity
from shapely.geometry import Point

# ----------------------------------------------------------------------------------------------
# Paths and frame
# ----------------------------------------------------------------------------------------------

GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent
DATA = GAME / "data"
CHECK = GAME / "check"

SITE = OUT / "LizardIsland_2025_site_map" / "rasters"
VEG = OUT / "LizardIsland_2025_vegetation_layers_cleaned" / "gis"
TREES = OUT / "LizardIsland_2025_trees"
PLANTS = OUT / "LizardIsland_2026_plant_map"
OUTLINE = OUT / "LizardIsland_2025_splat" / "opensplat" / "work" / "island_crop_outline.gpkg"
ORTHO = (OUT / "LizardIsland_2025_drone" / "products" / "orthomosaics"
         / "LizardIsland_2025-10_drone_150ft_orthomosaic_EPSG6346_cog.tif")   # palm crown check only

# Game frame: x = E - E0, y = h - h0, z = -(N - N0). The lake surface (h = -24.90) is y = 0.
E0, N0, H0 = 573150.0, 2840100.0, -24.90
FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.90,
         "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}

# Master grid: the whole site frame at 0.25 m, the same cells as the terrain grid.
# Row 0 is the north edge; columns grow east.
W_E, N_TOP, CELL = 573080.0, 2840215.0, 0.25
NROWS, NCOLS = 740, 680
MASTER_TF = from_origin(W_E, N_TOP, CELL, CELL)

SEED = 20251020   # the first day of the October 2025 scan

# Ground plausibility, the same tests the terrain script applies, so that trunks and clumps stand
# on the ground the game draws. Under dense mangrove and at the far edge of the scans the site
# ground raster holds plateaus of vegetation read as ground, metres above the real surface.
SPIKE_H = 0.5              # land cells this far above the median of land within SPIKE_WIN are refilled
SPIKE_WIN = 10.5
BANK_MAX_Y = 2.5           # off the island, ground never stands higher than this above the lake,
BANK_EDGE_Y, BANK_SLOPE = 0.4, 0.4   # nor more than 0.4 m + 0.4 m per metre from the water
ISLET_MAX_Y = 0.30         # islets (land with lake all round) are mangrove mud: kept this low

# ----------------------------------------------------------------------------------------------
# Tunable parameters
# ----------------------------------------------------------------------------------------------

# Landmark identity. Wherever a plant survey point marks a landmark's stem, the survey decides
# what the landmark is, over the tree table's palm, fig_like and kind columns. The lab's own
# identifications below stand: a survey point that contradicts one is reported for review and the
# lab's kind is kept. A landmark with no survey point at its stem keeps the lab's kind, else the
# table's palm reading, else broadleaf. A kind taken from this list with no agreeing survey point
# keeps kind_from "brief", as does the pole's name_from.
BRIEF_KINDS = {"T007": "talipot", "T008": "talipot", "T009": "talipot", "T019": "talipot",
               "T006": "rainbow_eucalyptus", "T036": "osprey_pole"}
LANDMARK_KINDS = ("broadleaf", "palm", "talipot", "rainbow_eucalyptus", "osprey_pole")
# The osprey pole is not a plant, so no survey point can name it: its name is set here
KIND_NAMES = {"osprey_pole": "osprey nest pole"}
# Survey species that identify a landmark kind of their own; otherwise the growth form decides.
# A mangrove has no landmark kind: it is drawn as a broadleaf and reported. Shrubs and herbs
# cannot stand as a landmark's stem: one logged at a stem is a plant at its foot and stays a plant.
SPECIES_KIND = {"Eucalyptus deglupta": "rainbow_eucalyptus", "Corypha umbraculifera": "talipot"}
FORM_KIND = {"palm": "palm", "tree": "broadleaf", "mangrove": "broadleaf"}
FORM_FITS = {"palm", "tree"}
# Trunks with no survey point at the stem where the drone orthomosaic suggests another kind;
# they keep their kind and are listed for review
ORTHO_PALM_REVIEW = {"T011": "no survey point stands within 1.1 m of the stem (the nearest palm "
                             "point is a reject 2.2 m away); the drone orthomosaic shows a single "
                             "fan-palm crown centred on the trunk and dbh 0.56 m is in the palm "
                             "range, so it may be a palm; kept broadleaf until a survey point or "
                             "a person decides"}

# A survey point marks a landmark stem when it stands this close to the bark of one of its stems
# (each point goes to its nearest landmark stem only)
MATCH_BARK_M = 1.1
# A survey point at a stem that loses to a better point of another kind, this close to the bark,
# stands inside the trunk: it cannot be a second model, so it is dropped. Further out it is
# placed as a plant of its own (such as a juvenile palm at the foot of a broadleaf trunk)
CLASH_BARK_M = 0.5
FLAG_RANK = {"good": 0, "usable": 1, "check": 2}

# Landmarks the survey turns into palms keep the table's trunk (position, dbh, height), but their
# lidar crown segment can hold neighbouring broadleaf canopy. Their palm crown width is read from
# the drone orthomosaic around the stem (2 cm cells, rings every 0.5 m; the crops are drawn in
# check/palm_crowns_quicklook.png) as the width the fronds reach, and is never more than the
# table's widths. The palm crown is centred on the stem; the rest of the lidar crown is left to
# the clumps. Each entry: width (m), whether the crown shows from above, what the drone shows.
PALM_CROWN_ORTHO = {
    "T004": (6.0, True, "fronds reach 2.8 to 3.3 m from the stem to the south and south-west; the "
                        "crown meets T003's about 2 m to the north and grey-leaved canopy to the west"),
    "T016": (3.0, False, "no palm crown shows from above: a yellow-flowered broadleaf canopy "
                         "covers the stem (the survey photo shows a slender fan palm beside a "
                         "leaning broadleaf trunk); 3 m is a plausible crown for a slender fan palm"),
    "T020": (6.0, True, "one pale fan-palm crown centred on the stem, fronds 2.8 to 3.1 m long, "
                        "in the thicket"),
    "T021": (6.0, True, "one pinnate palm crown centred on the stem, fronds 2.6 to 3.4 m long, "
                        "inside darker broadleaf canopy"),
    "T031": (6.0, True, "one fan-palm crown centred on the stem, alone on open lawn: the table's "
                        "crown is this palm, and its fronds (2.6 to 2.8 m long) agree with it to "
                        "within a lidar cell"),
}
# Lidar crown cells within this distance outside such a palm's crown are taken as its own frond
# tips (the crown polygons are on 0.25 m cells and fronds droop outwards), so no clump is set
# there; clumps standing just outside overlap the band. Not applied to a palm hidden under
# broadleaf canopy, whose lidar crown edge is that canopy.
PALM_TIP_M = 0.5
# Where such a palm's table crown base is under LOW_CROWN_BASE_M it is the neighbouring
# understorey; the palm's fronds are taken to hang this share of its crown width below its top
# (the rule spawns.py uses for survey palms)
PALM_DEPTH_K = 0.6

# Plausible height range (m) and the height assumed when the raster shows only overstorey
FORM_RANGE = {"tree": (3.0, 16.0), "palm": (3.0, 14.0), "mangrove": (2.0, 8.0),
              "shrub": (0.8, 4.0), "herb": (0.3, 1.2)}
FORM_TYPICAL = {"tree": 7.0, "palm": 6.0, "mangrove": 4.0, "shrub": 2.0, "herb": 0.6}

# Species that need their own numbers: height range, typical height, crown width, dbh (m).
# Crown widths and trunk sizes are textbook values for mature plants of each palm.
SPECIES = {
    "Cocos nucifera":         dict(rng=(6, 14), typ=10, crown=7.0, dbh=0.30),
    "Roystonea regia":        dict(rng=(8, 14), typ=12, crown=6.0, dbh=0.50),
    "Sabal causiarum":        dict(rng=(5, 12), typ=8, crown=5.0, dbh=0.45),
    "Sabal sp.":              dict(rng=(5, 12), typ=8, crown=4.5, dbh=0.35),
    "Thrinax radiata":        dict(rng=(2.5, 6), typ=4, crown=2.5, dbh=0.12),
    "Leucothrinax morrisii":  dict(rng=(2.5, 6), typ=4, crown=2.5, dbh=0.12),
    "Nypa fruticans":         dict(rng=(3, 7), typ=5, crown=5.5, dbh=0.30),   # stemless: dbh is the leaf-base clump
    "Oncosperma tigillarium": dict(rng=(4, 12), typ=8, crown=4.0, dbh=0.15),
    "Attalea butyracea":      dict(rng=(5, 12), typ=8, crown=7.0, dbh=0.45),
    "Corypha umbraculifera":  dict(rng=(6, 14), typ=9, crown=10.0, dbh=0.85),
    "Bambusa dolichoclada":   dict(rng=(3, 10), typ=7, crown=4.0, dbh=0.10),  # a clumping bamboo filed as shrub
}
# Name hints typed in the field
SIZE_HINTS = {"tiny": dict(rng=(0.6, 2.0), typ=1.2, crown=1.5, dbh=0.08),
              "small": dict(rng=(1.5, 3.5), typ=2.5, crown=2.5, dbh=0.12)}
BIG_HINTS = ("big", "giant")
# The matching step read the photograph of this point: a juvenile fan palm on the ground at the
# foot of a broadleaf trunk (LizardIsland_2026_plant_map/matching/MATCHING.md, row 130)
JUVENILE_POINTS = {128}

# Understorey under a landmark crown is capped at this share of the landmark's height
UNDER_CAP = {"palm": 0.85, "default": 0.70}

# Clumps: type thresholds (m) and Poisson-disc spacing s(h) = a + b * h, clamped; w = k * s
CLUMP_TYPES = ["ground_shrub", "bush", "understorey_tree", "canopy_puff", "mangrove_canopy"]
SPACING = {"ground_shrub": (0.95, 0.0, 0.95, 0.95), "bush": (0.7, 0.2, 0.95, 1.4),
           "understorey_tree": (0.85, 0.22, 1.5, 2.2), "canopy_puff": (1.05, 0.15, 1.9, 3.3),
           "mangrove_canopy": (0.95, 0.18, 1.4, 2.8)}
WIDTH_K = {"ground_shrub": 1.3, "bush": 1.35, "understorey_tree": 1.35, "canopy_puff": 1.4,
           "mangrove_canopy": 1.4}
MIN_VEG_M = 0.3            # canopy under this is open lawn: no clump
LOW_CROWN_BASE_M = 2.0     # under a landmark crown whose base is at least this high, understorey is not the tree
BANK_SPACING = (7.0, 0.30, 9.5, 14.0)
BANK_MIN_H = 4.0
BANK_MIN_PATCH_M2 = 25.0   # bank canopy patches smaller than this are specks, not trees
BANK_OVERHANG_M = 4.0      # bank trees over the lake must stand within this of the bank
MIN_PATCH_M2 = 3.0         # island canopy patches smaller than this are specks (water-mirror ghosts)
BANK_CLEAR_OF_ISLAND_M = 3.0
# The causeway walk (the walkable causeway and landing cells of the terrain mask) is kept clear
# of clumps that stand on the ground: a ground-standing clump centred on it is dropped, or kept
# overhead as a canopy puff when it is tall enough to leave head room.
CAUSEWAY_BANK_CLEAR_M = 3.0  # bank trees keep this far (plus half their width) from the walk
CAUSEWAY_PUFF_MIN_H = 5.0  # canopy over the walk is kept as a puff only this high or higher (head room)
# Colliders for solid-looking vegetation on walkable ground: a bush, understorey tree or
# mangrove clump, or a survey shrub at least SHRUB_COLLIDE_MIN_H tall, whose centre stands on
# a walkable cell gets a circle of radius COLLIDE_K x its width (its trunk-and-foliage core;
# the outer foliage can be brushed through).
COLLIDE_TYPES = ("bush", "understorey_tree", "mangrove_canopy")
COLLIDE_K = 0.35
SHRUB_COLLIDE_MIN_H = 1.0


# ----------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------

def to_game(E, N, h=None):
    """UTM easting, northing (and ellipsoidal height) to game x, z (and y)."""
    x = np.asarray(E, float) - E0
    z = -(np.asarray(N, float) - N0)
    if h is None:
        return x, z
    return x, np.asarray(h, float) - H0, z


def r2(v):
    return None if v is None or not np.isfinite(v) else round(float(v), 2)


def fill_holes(a):
    """Fill NaN cells from their valid neighbours, one ring at a time (normalised 3x3 mean)."""
    a = a.astype(float).copy()
    valid = np.isfinite(a)
    while not valid.all():
        s = ndimage.uniform_filter(np.where(valid, a, 0.0), 3, mode="nearest")
        n = ndimage.uniform_filter(valid.astype(float), 3, mode="nearest")
        grow = ~valid & (n > 1e-9)
        a[grow] = s[grow] / n[grow]
        valid |= grow
    return a


def read_band(path):
    with rasterio.open(path) as r:
        return r.read(1), r.transform, r.nodata


def place_on_master(a, tf, fill, factor):
    """Put a raster that shares the master origin grid into the master grid.
    factor = 2 repeats each 0.5 m cell into 2 x 2 master cells."""
    if factor > 1:
        a = np.repeat(np.repeat(a, factor, 0), factor, 1)
    out = np.full((NROWS, NCOLS), fill, dtype=a.dtype)
    r0 = int(round((N_TOP - tf.f) / CELL))
    c0 = int(round((tf.c - W_E) / CELL))
    out[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    return out


def rc_of(E, N):
    """Master grid row, column of the cell holding E, N."""
    return (np.floor((N_TOP - np.asarray(N)) / CELL).astype(int),
            np.floor((np.asarray(E) - W_E) / CELL).astype(int))


def disc(E, N, radius):
    """Row and column indices of master cells whose centres lie within radius of E, N."""
    rad = int(math.ceil(radius / CELL)) + 1
    r, c = rc_of(E, N)
    rr, cc = np.mgrid[r - rad:r + rad + 1, c - rad:c + rad + 1]
    ok = (rr >= 0) & (rr < NROWS) & (cc >= 0) & (cc < NCOLS)
    rr, cc = rr[ok], cc[ok]
    ce = W_E + (cc + 0.5) * CELL
    cn = N_TOP - (rr + 0.5) * CELL
    keep = (ce - E) ** 2 + (cn - N) ** 2 <= radius ** 2
    return rr[keep], cc[keep]


def drop_specks(mask, min_area_m2):
    """Remove connected patches (8-neighbour) smaller than min_area_m2."""
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return mask
    area = ndimage.sum(mask, lab, np.arange(1, n + 1)) * CELL * CELL
    keep = np.concatenate([[False], area >= min_area_m2])
    return keep[lab]


def rasterise(geoms, values=None, fill=0, dtype="int16"):
    shapes = [(g, 1 if values is None else v) for g, v in
              zip(geoms, values if values is not None else [1] * len(geoms))]
    return features.rasterize(shapes, out_shape=(NROWS, NCOLS), transform=MASTER_TF,
                              fill=fill, dtype=dtype)


def load_terrain_mask():
    """Walkable, causeway and bank cells of the terrain grid written by terrain.py. The terrain
    grid is the master grid (same origin, cell and size), so cells line up one to one."""
    t = json.loads((DATA / "terrain.json").read_text())
    assert (t["cols"], t["rows"], t["cell"]) == (NCOLS, NROWS, CELL)
    assert abs(t["x0"] - (W_E + CELL / 2 - E0)) < 1e-6 and abs(t["z0"] - (-(N_TOP - CELL / 2 - N0))) < 1e-6
    m = np.fromfile(DATA / t["mask"]["file"], dtype=np.uint8).reshape(NROWS, NCOLS)
    bits = t["mask"]["bits"]
    return {k: (m & bits[k]) > 0 for k in ("walkable", "causeway", "bank", "water")}


# ----------------------------------------------------------------------------------------------
# 1. Rasters on the master grid
# ----------------------------------------------------------------------------------------------

def plausible_ground(g, water, tf05):
    """The site ground with holes, spikes and implausible bank readings refilled from the
    neighbouring ground. Returns the refilled grid and the mask of cells that were replaced."""
    island = gpd.read_file(VEG / "LizardIsland_2025_vegetation_island_land.shp").geometry.iloc[0]
    island05 = features.rasterize([(island, 1)], out_shape=g.shape, transform=tf05, fill=0) > 0
    land = ~water & np.isfinite(g)
    land_g = np.where(land, g, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # all-NaN windows over open water
        med = ndimage.generic_filter(land_g, np.nanmedian, size=int(SPIKE_WIN / 0.5) | 1,
                                     mode="constant", cval=np.nan)
    spike = np.nan_to_num(land_g - med, nan=0.0) > SPIKE_H
    dwater = ndimage.distance_transform_edt(~water) * 0.5
    y = g - H0
    implausible = land & ~island05 & ((y > BANK_MAX_Y) | (y > BANK_EDGE_Y + BANK_SLOPE * dwater))
    bad = spike | implausible
    filled = fill_holes(np.where(bad, np.nan, g))
    # Islets: pieces of land that touch neither the frame edge (the banks) nor the island
    lab, n = ndimage.label(~water, structure=np.ones((3, 3)))
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    on_island = np.unique(lab[island05])
    islet = (lab > 0) & ~np.isin(lab, edge) & ~np.isin(lab, on_island)
    capped = islet & (filled - H0 > ISLET_MAX_Y)
    filled[capped] = H0 + ISLET_MAX_Y
    return filled, bad | capped


def load_rasters():
    g, tf05, _ = read_band(SITE / "LizardIsland_2025_site_ground_height.tif")
    veg05, _, _ = read_band(SITE / "LizardIsland_2025_site_vegetation_height.tif")
    water05, _, _ = read_band(SITE / "LizardIsland_2025_site_water_mask.tif")
    open05, _, _ = read_band(SITE / "LizardIsland_2025_site_open_water_mask.tif")
    ground05, refilled = plausible_ground(g, water05 == 1, tf05)
    # Where the ground was refilled the vegetation height was measured from the discarded
    # reading: carry it over to the refilled ground so the canopy top keeps its height
    veg05 = np.where(refilled & (np.nan_to_num(veg05) > 0), veg05 + (g - ground05), veg05)

    ch25, tf25, nd = read_band(VEG / "LizardIsland_2025_vegetation_canopy_height.tif")
    mapped25 = ch25 != nd
    bands = []
    for b in ["0-1m", "1-2m", "2-3m", "3-4m", "4-5m"]:
        a, _, _ = read_band(VEG / f"LizardIsland_2025_vegetation_{b}_mask.tif")
        bands.append(place_on_master(np.where(a == 1, 1.0, 0.0), tf25, 0.0, 1))

    R = {}
    R["ground05"] = ground05                      # ellipsoidal ground, refilled, 0.5 m
    R["ground_refilled_cells"] = int(refilled.sum())
    R["water"] = place_on_master(water05 == 1, tf05, False, 2)
    R["open"] = place_on_master(open05 == 1, tf05, False, 2)
    R["mapped"] = place_on_master(mapped25, tf25, False, 1)
    veg = place_on_master(np.nan_to_num(veg05, nan=0.0), tf05, 0.0, 2)
    ch = place_on_master(np.where(mapped25, ch25, np.nan), tf25, np.nan, 1)
    # Canopy height: the 0.25 m cleaned layer where it exists, else the 0.5 m site layer
    R["ch"] = np.where(np.isfinite(ch), ch, veg).astype(float)
    R["ch"][R["open"]] = 0.0
    # Band occupancy, smoothed over about 1.75 m so single trunks and specks do not count
    valid = R["mapped"].astype(float)
    nv = ndimage.uniform_filter(valid, 7, mode="constant")
    R["band_occ"] = np.stack([np.where(nv > 0.2, ndimage.uniform_filter(b * valid, 7, mode="constant")
                                       / np.maximum(nv, 1e-9), 0.0) for b in bands])
    R["band_occ_fine"] = np.stack([np.where(nv > 0.2, ndimage.uniform_filter(b * valid, 3, mode="constant")
                                            / np.maximum(ndimage.uniform_filter(valid, 3, mode="constant"), 1e-9), 0.0)
                                   for b in bands])
    # Distance from each cell to the nearest cell that is not open water (m)
    R["dist_to_not_open"] = ndimage.distance_transform_edt(R["open"]) * CELL
    return R


def ground_h(R, E, N):
    """Bilinear ellipsoidal ground height from the 0.5 m site raster (holes and spikes refilled)."""
    c = (np.asarray(E, float) - W_E) / 0.5 - 0.5
    r = (N_TOP - np.asarray(N, float)) / 0.5 - 0.5
    return ndimage.map_coordinates(R["ground05"], [np.atleast_1d(r), np.atleast_1d(c)],
                                   order=1, mode="nearest")


def column_top(R, E, N, fine=False):
    """Height (m) to which vegetation stands continuously from the ground at E, N, from the
    height-band masks: the number of 1 m bands, counted up from the ground, that are occupied.
    5 means the column reaches at least 5 m. None outside the mapped area."""
    r, c = rc_of(E, N)
    if not (0 <= r < NROWS and 0 <= c < NCOLS) or not R["mapped"][r, c]:
        return None
    occ = (R["band_occ_fine"] if fine else R["band_occ"])[:, r, c]
    n = 0
    while n < 5 and occ[n] >= 0.5:
        n += 1
    return n


# ----------------------------------------------------------------------------------------------
# 2. Landmarks
# ----------------------------------------------------------------------------------------------

def load_landmarks(R):
    t = pd.read_csv(TREES / "LizardIsland_2025_trees.csv")
    crowns = gpd.read_file(TREES / "LizardIsland_2025_trees.gpkg", layer="tree_crowns").set_index("id")
    stems = gpd.read_file(TREES / "LizardIsland_2025_trees.gpkg", layer="tree_stems")
    assert len(t) == 37 and set(t.id) == set(crowns.index)

    L = []
    for _, row in t.iterrows():
        # The kind before the survey: the lab's, else the table's palm reading, else broadleaf
        if row.id in BRIEF_KINDS:
            kind, kind_from = BRIEF_KINDS[row.id], "brief"
        elif row.palm == "yes":
            kind, kind_from = "palm", "table"
        else:
            kind, kind_from = "broadleaf", "default"
        gz = float(ground_h(R, row.E, row.N)[0])
        top = row.base_z_m + row.height_m                   # absolute treetop
        c = crowns.loc[row.id].geometry
        cen = c.centroid
        crown_base = row.crown_base_m
        if not np.isfinite(crown_base):
            # T036: the survey resolved only the nest platform, 9.0 to 9.5 m (trees README, item 6)
            crown_base = row.height_m - 0.5
        st = stems[stems.id == row.id]
        L.append(dict(id=row.id, kind=kind, kind_before=kind, kind_from=kind_from,
                      E=row.E, N=row.N, gz=gz, top=top,
                      height=top - gz, dbh=row.dbh_m, crown_w_ew=row.crown_width_EW_m,
                      crown_w_ns=row.crown_width_NS_m, crown_base=crown_base,
                      cE=cen.x, cN=cen.y, geom=c, geom_table=c, stems=int(row.stems),
                      multi_stem=(row.multi_stem == "yes"),
                      stem_list=[(s.base_E, s.base_N, s.dbh_m, int(s.stem_id)) for s in st.itertuples()],
                      table_base_dz=row.base_z_m - gz, name=None, sci=None))
    return L


def survey_kind(form, sci):
    """The landmark kind a survey point stands for, and whether the point fits that kind (a
    mangrove is drawn as a broadleaf but does not fit it)."""
    if sci in SPECIES_KIND:
        return SPECIES_KIND[sci], True
    return FORM_KIND[form], form in FORM_FITS


def identify_landmarks(p, L):
    """Match survey points to landmark stems one to one and let the survey decide each matched
    landmark's kind, name and scientific name.

    Each point goes to its nearest landmark stem (every stem of a multi-stem tree counts) and
    marks it when it stands within MATCH_BARK_M of the bark. Shrubs and herbs at a stem stay
    plants. Of the tree, palm and mangrove points at one landmark the best decides (flag good,
    usable, check, then the nearer); a point that disagrees with it is reported. Returns the role
    of every point that marks a stem (decides, agrees, conflict, clash or plant; the first three
    are absorbed by the landmark, clash is dropped, plant is placed as a plant of its own), the
    nearest stem of every point, and lists for the report."""
    S = [(i, sE, sN, d) for i, lm in enumerate(L) for (sE, sN, d, _) in lm["stem_list"]]
    sL = np.array([s[0] for s in S])
    sE = np.array([s[1] for s in S]); sN = np.array([s[2] for s in S]); sD = np.array([s[3] for s in S])

    nearest, cands, understorey = {}, {i: [] for i in range(len(L))}, []
    for _, row in p.iterrows():
        bark = np.hypot(row.easting - sE, row.northing - sN) - sD / 2
        k = int(np.argmin(bark))
        li, bd = int(sL[k]), float(bark[k])
        nearest[int(row.point_index)] = (li, bd, (sE[k], sN[k], sD[k]))
        if bd > MATCH_BARK_M:
            continue
        name, generic = display_name(row)
        sci = row.scientific_name if isinstance(row.scientific_name, str) else None
        pt = dict(point=int(row.point_index), name=name, generic=generic, sci=sci, form=row.form,
                  flag=row.flag, bark=bd, bark_m=round(bd, 2))
        if row.form not in FORM_KIND:
            understorey.append(dict(landmark=L[li]["id"], **pt))
            continue
        pt["kind"], pt["fits"] = survey_kind(row.form, sci)
        cands[li].append(pt)

    roles = {}
    changes, conflicts, misfits, disagreements = [], [], [], []
    for li, lm in enumerate(L):
        c = sorted(cands[li], key=lambda a: (FLAG_RANK[a["flag"]], a["bark"], a["point"]))
        if not c:
            continue
        best = c[0]
        brief = BRIEF_KINDS.get(lm["id"])
        if brief is not None and best["kind"] != brief:
            # The survey contradicts the lab's identification: keep the lab's kind, report, and
            # give no survey name unless another point at the stem agrees with it
            conflicts.append(dict(landmark=lm["id"], kind_survey=best["kind"],
                                  **{**best, "kind": brief}))
            roles[best["point"]] = "conflict"
            named = next((a for a in c if a["kind"] == brief), None)
        else:
            if best["kind"] != lm["kind"]:
                changes.append(dict(landmark=lm["id"], kind_from=lm["kind"], kind_to=best["kind"],
                                    table_dbh=float(lm["dbh"]), **best))
            lm["kind"], lm["kind_from"] = best["kind"], "survey"
            if not best["fits"]:
                misfits.append({**best, "landmark": lm["id"]})
            roles[best["point"]] = "decides"
            named = best
        if named is not None:
            lm["name"], lm["sci"], lm["name_from"] = named["name"], named["sci"], "survey"
        for o in c[1:]:
            if o["kind"] == lm["kind"]:
                fate = "agrees"
            elif o["bark"] <= CLASH_BARK_M:
                fate = "clash"
            else:
                fate = "plant"
            roles.setdefault(o["point"], fate)
            if (o["kind"], o["name"]) != (best["kind"], best["name"]):
                disagreements.append(dict(landmark=lm["id"], kind=lm["kind"], chosen=best, other=o,
                                          fate=fate))
    for lm in L:
        # A landmark no survey point can name (the osprey pole) takes its name from KIND_NAMES
        if lm["name"] is None and lm["kind"] in KIND_NAMES:
            lm["name"], lm["name_from"] = KIND_NAMES[lm["kind"]], "brief"
        assert lm["kind"] in LANDMARK_KINDS
    return roles, nearest, dict(changes=changes, conflicts=conflicts, misfits=misfits,
                                disagreements=disagreements, understorey=understorey)


def apply_palm_crowns(L):
    """Give every landmark the survey turned into a palm a palm crown: the width read from the
    drone orthomosaic (PALM_CROWN_ORTHO), capped at the table's widths, centred on the stem.
    The trunk (position, dbh, height) stays as the table has it. A crown base under
    LOW_CROWN_BASE_M belongs to the neighbouring understorey and is raised to where the palm's
    fronds end. geom becomes the palm crown, so the clumps fill the rest of the lidar crown."""
    out = []
    for i, lm in enumerate(L):
        if lm["kind"] != "palm" or lm["kind_before"] in ("palm", "talipot"):
            continue
        if lm["id"] in PALM_CROWN_ORTHO:
            w, seen, how = PALM_CROWN_ORTHO[lm["id"]]
        else:
            w = SPECIES.get(lm["sci"] or "", {}).get("crown") or crown_width(
                "palm", lm["height"], dict(crown=None))
            seen, how = None, "no orthomosaic reading: the species' typical crown or the palm allometry"
        ew, ns = min(w, lm["crown_w_ew"]), min(w, lm["crown_w_ns"])
        cb = lm["crown_base"]
        if cb < LOW_CROWN_BASE_M:
            cb = max(cb, lm["height"] - PALM_DEPTH_K * 0.5 * (ew + ns))
        rec = dict(i=i, landmark=lm["id"], table_w_ew=lm["crown_w_ew"], table_w_ns=lm["crown_w_ns"],
                   table_crown_base=lm["crown_base"], table_cE=lm["cE"], table_cN=lm["cN"],
                   crown_w_ew=ew, crown_w_ns=ns, crown_base=cb, seen_from_above=seen, how=how)
        crown = affinity.scale(Point(lm["E"], lm["N"]).buffer(1.0, 64), ew / 2, ns / 2)
        # What the landmark explains (no clump there): the palm crown, and where the crown shows
        # from above, the band of its frond tips that the table's crown also holds
        geom = crown
        if seen:
            geom = crown.union(crown.buffer(PALM_TIP_M, 64).intersection(lm["geom_table"]))
        lm.update(crown_w_ew=ew, crown_w_ns=ns, crown_base=cb, cE=lm["E"], cN=lm["N"],
                  geom=geom, crown_geom=crown)
        out.append(rec)
    return out


# ----------------------------------------------------------------------------------------------
# 3. Survey plants
# ----------------------------------------------------------------------------------------------

def load_survey():
    p = pd.read_csv(PLANTS / "names" / "points_named.csv")
    f = pd.read_csv(PLANTS / "frame_check" / "frame_check_points.csv")
    # Verify the join: one row per point, same order, same name, same position
    assert len(p) == len(f) == 317
    assert (f.row.values == p.point_index.values + 2).all(), "row order differs"
    assert (f.name.values == p.raw_name.values).all(), "names differ"
    assert np.allclose(f.E.values, p.easting.values, atol=1e-6) and \
        np.allclose(f.N.values, p.northing.values, atol=1e-6), "positions differ"
    p["flag"] = f.quality_flag.values
    return p


def display_name(row):
    """Common name, else scientific; generic field labels tidied into plain words."""
    cn = row.common_name if isinstance(row.common_name, str) else None
    sci = row.scientific_name if isinstance(row.scientific_name, str) else None
    if cn:
        if cn.endswith(", species not recorded"):
            return cn.split(",")[0], True
        if cn.startswith("not identified (field description: "):
            return "unidentified shrub (" + cn.split(": ", 1)[1].rstrip(")") + ")", True
        if cn == "plant, not identified":
            return "unidentified shrub", True
        return cn, False
    if sci:
        return sci, False
    return row.raw_name, True


def plant_spec(row, form):
    """Height range, typical height, fixed crown width and dbh (None = from allometry)."""
    lo, hi = FORM_RANGE[form]
    spec = dict(rng=(lo, hi), typ=FORM_TYPICAL[form], crown=None, dbh=None)
    sci = row.scientific_name if isinstance(row.scientific_name, str) else ""
    if sci in SPECIES:
        spec.update(SPECIES[sci])
    raw = str(row.raw_name).lower()
    for key, s in SIZE_HINTS.items():
        if key in raw.split():
            spec.update(s)
    if row.point_index in JUVENILE_POINTS:
        spec.update(SIZE_HINTS["tiny"])
    if any(k in raw for k in BIG_HINTS):
        lo, hi = spec["rng"]
        spec["rng"] = (max(lo, 0.6 * hi), hi)
        spec["typ"] = max(spec["typ"], 0.8 * hi)
    return spec


def crown_width(form, h, spec):
    if spec["crown"] is not None:
        return spec["crown"]
    if form == "tree":
        return float(np.clip(0.55 * h + 0.8, 2.0, 9.0))
    if form == "palm":
        return float(np.clip(0.4 * h + 1.5, 2.5, 7.0))
    if form == "mangrove":
        return float(np.clip(0.7 * h + 1.0, 2.0, 7.0))
    if form == "shrub":
        return float(np.clip(0.8 * h + 0.4, 0.8, 4.0))
    return float(np.clip(1.0 * h + 0.3, 0.6, 1.6))


def dbh_guess(form, h, spec):
    if spec["dbh"] is not None:
        return spec["dbh"]
    if form == "tree":
        return float(np.clip(0.025 * h, 0.08, 0.45))
    if form == "palm":
        return 0.30
    if form == "mangrove":
        return float(np.clip(0.02 * h, 0.06, 0.20))
    if form == "shrub":
        return 0.05
    return 0.02


def build_plants(R, L, rng):
    p = load_survey()
    n_all = len(p)
    p = p[p.flag != "reject"].copy()
    n_reject = n_all - len(p)
    # Non-plant points (the osprey pole and a brush pile) are skipped before any matching, so
    # they neither name a landmark nor become a model
    n_nonplant = int((p.growth_form == "non-plant").sum())
    p = p[p.growth_form != "non-plant"].copy()
    p["form"] = p.growth_form.replace({"unknown": "shrub"})

    # The other lidar stems (fringe and unreviewed), used only to give a plant a measured dbh
    r3 = pd.read_csv(TREES / "work" / "arrays" / "stems_r3.csv")
    lm_stem_ids = {sid for lm in L for (_, _, _, sid) in lm["stem_list"]}
    r3 = r3[~r3.stem_id.isin(lm_stem_ids)]
    oE, oN, oD = r3.base_E.values, r3.base_N.values, r3.dbh.values

    dropped_open, merged = [], []
    keep_rows = []

    # 3a. merge near-duplicates: the same taxon logged twice within 0.5 m
    p = p.sort_values(["point_index"]).reset_index(drop=True)
    p["_rank"] = p.flag.map(FLAG_RANK)
    taken = np.zeros(len(p), bool)
    xy = p[["easting", "northing"]].values
    for i in range(len(p)):
        if taken[i]:
            continue
        for j in range(i + 1, len(p)):
            if taken[j]:
                continue
            same = (p.at[i, "scientific_name"] == p.at[j, "scientific_name"]) if isinstance(
                p.at[i, "scientific_name"], str) else (p.at[i, "common_name"] == p.at[j, "common_name"])
            if same and np.hypot(*(xy[i] - xy[j])) < 0.5:
                worse = j if p.at[j, "_rank"] >= p.at[i, "_rank"] else i
                taken[worse] = True
                merged.append((int(p.at[i, "point_index"]), int(p.at[j, "point_index"])))
    p = p[~taken].reset_index(drop=True)

    # 3b. landmark identities from the points at their stems, then palm crowns for the landmarks
    # that became palms (before any plant is placed: the plants' height caps read the crowns)
    roles, nearest, ident = identify_landmarks(p, L)
    palm_crowns = apply_palm_crowns(L)
    absorbed = [pi for pi, r in roles.items() if r in ("decides", "agrees", "conflict")]
    clashes = [pi for pi, r in roles.items() if r == "clash"]
    for _, row in p.iterrows():
        pi = int(row.point_index)
        if roles.get(pi) in ("decides", "agrees", "conflict", "clash"):
            continue
        keep_rows.append((row, *nearest[pi]))

    # 3c. place the rest
    plants = []
    for row, li, bd, (stE, stN, stD) in keep_rows:
        form = row.form
        E, N = float(row.easting), float(row.northing)
        r, c = rc_of(E, N)
        # Open water: mangroves may stand at the waterline, other forms may not
        d_open = R["dist_to_not_open"][r, c]
        if (form == "mangrove" and d_open > 2.0) or (form != "mangrove" and d_open > 0.75):
            dropped_open.append(dict(point=int(row.point_index), form=form, dist_m=round(float(d_open), 2)))
            continue
        # Small plants standing against a landmark stem are nudged out to stand beside it
        if bd < 0.3 and form in ("shrub", "herb"):
            v = np.array([E - stE, N - stN])
            nv = np.linalg.norm(v)
            v = v / nv if nv > 1e-6 else np.array([1.0, 0.0])
            E, N = stE + v[0] * (stD / 2 + 0.3), stN + v[1] * (stD / 2 + 0.3)

        spec = plant_spec(row, form)
        lo, hi = spec["rng"]
        # Local canopy top: 90th percentile within 1.25 m
        rr, cc = disc(E, N, 1.25)
        hr = float(np.nanpercentile(R["ch"][rr, cc], 90)) if len(rr) else 0.0
        # Is the point under a landmark crown?
        under = None
        pt = Point(E, N)
        for i, lm in enumerate(L):
            if lm["kind"] != "osprey_pole" and lm["geom"].contains(pt):
                under = i
                break
        cap = hi
        if under is not None:
            share = UNDER_CAP["palm"] if form == "palm" else UNDER_CAP["default"]
            cap = min(hi, max(lo, share * L[under]["height"]))
        # Away from landmark crowns the raster may run a little over the range and still be this
        # plant; under a landmark crown anything above the cap is the landmark
        if hr <= cap + (0.0 if under is not None else 1.0):
            h, how = float(np.clip(hr, lo, cap)), "raster"
        else:
            # The raster shows overstorey above this plant: read its own column from the bands
            n = column_top(R, E, N, fine=True)
            est = spec["typ"] if (n is None or n >= 5) else max(float(n), lo)
            h, how = float(np.clip(est, lo, cap)), "bands" if (n is not None and n < 5) else "typical"
        w = crown_width(form, h, spec)
        dbh = dbh_guess(form, h, spec)
        if form in ("tree", "mangrove", "palm") and spec["dbh"] is None and len(oE):
            ob = np.hypot(E - oE, N - oN) - oD / 2
            j = int(np.argmin(ob))
            if ob[j] <= 0.5:
                dbh = float(np.clip(oD[j], 0.06, 0.8))
                how += "+stem"
        name, _ = display_name(row)
        sci = row.scientific_name if isinstance(row.scientific_name, str) else None
        plants.append(dict(form=form, name=name, sci=sci, E=E, N=N,
                           gz=float(ground_h(R, E, N)[0]), height=h, crown_w=w, dbh=dbh,
                           rot=float(rng.uniform(0, 2 * math.pi)), under=under, how=how,
                           point=int(row.point_index), flag=row.flag))

    info = dict(n_survey=n_all, n_reject=n_reject, n_nonplant=n_nonplant, merged=merged,
                absorbed=absorbed, roles=roles, clashes=clashes, dropped_open=dropped_open,
                palm_crowns=palm_crowns, **ident)
    return plants, info


# ----------------------------------------------------------------------------------------------
# 4. Clumps
# ----------------------------------------------------------------------------------------------

def spacing(kind, h, table=None):
    a, b, lo, hi = (table or SPACING)[kind]
    return float(np.clip(a + b * h, lo, hi))


def clump_type(h, over_water):
    if over_water:
        return "mangrove_canopy"
    if h < 1.0:
        return "ground_shrub"
    if h < 3.0:
        return "bush"
    if h < 6.0:
        return "understorey_tree"
    return "canopy_puff"


class DiscIndex:
    """Spatial hash of accepted discs for variable-radius Poisson-disc sampling."""

    def __init__(self, size=4.0):
        self.size, self.cells, self.max_s = size, {}, 0.0

    def _key(self, E, N):
        return int(E // self.size), int(N // self.size)

    def clear(self, E, N, s):
        ki, kj = self._key(E, N)
        rng = int(math.ceil(0.5 * (s + self.max_s) / self.size))
        for i in range(ki - rng, ki + rng + 1):
            for j in range(kj - rng, kj + rng + 1):
                for (e, n, t) in self.cells.get((i, j), ()):
                    if (e - E) ** 2 + (n - N) ** 2 < (0.5 * (s + t)) ** 2:
                        return False
        return True

    def add(self, E, N, s):
        self.max_s = max(self.max_s, s)
        self.cells.setdefault(self._key(E, N), []).append((E, N, s))


def candidate_points(mask, rng, step=2):
    """Candidate positions: every step-th master cell of the mask, jittered within its block."""
    sub = np.zeros_like(mask)
    sub[::step, ::step] = True
    r, c = np.nonzero(mask & sub)
    E = W_E + (c + rng.uniform(0, step, len(c))) * CELL
    N = N_TOP - (r + rng.uniform(0, step, len(r))) * CELL
    # The jitter may carry a point off the mask: keep only those that still stand on it
    rr, cc = rc_of(E, N)
    ok = (rr >= 0) & (rr < NROWS) & (cc >= 0) & (cc < NCOLS)
    ok[ok] = mask[rr[ok], cc[ok]]
    return E[ok], N[ok]


def dart_throw(E, N, kind_of, heights, index, rng, extra_ok=None, table=None):
    """Variable-radius Poisson-disc sampling by dart throwing. Candidates are taken tallest first
    (heights rounded to 0.1 m with a little jitter, ties in random order), so large clumps settle on
    the local tops and smaller ones fill between them. A candidate is accepted when its centre is
    at least (s_i + s_j) / 2 from every accepted centre, s being the spacing for its height."""
    base = heights
    order = np.lexsort((rng.uniform(0, 1, len(E)), -np.round(base + rng.uniform(0, 0.8, len(E)), 1)))
    out = []
    for k in order:
        e, n = E[k], N[k]
        h = base[k]
        kind = kind_of(e, n, h)
        if kind is None:
            continue
        s = spacing(kind, h, table)
        if extra_ok is not None and not extra_ok(e, n, s, kind):
            continue
        if not index.clear(e, n, s):
            continue
        index.add(e, n, s)
        out.append((e, n, h, s, kind))
    return out


def build_clumps(R, L, plants, TM, rng):
    ch = R["ch"]
    mapped, water, opn = R["mapped"], R["water"], R["open"]

    # Landmark crowns explain the upper canopy; below a high crown base the understorey is separate
    lm_id = rasterise([lm["geom"] for lm in L], values=list(range(1, len(L) + 1)), fill=0)
    lm_cb = np.zeros((NROWS, NCOLS))
    for i, lm in enumerate(L):
        lm_cb[lm_id == i + 1] = lm["crown_base"]
    up_expl = lm_id > 0
    low_expl = (lm_id > 0) & (lm_cb < LOW_CROWN_BASE_M)
    # Trunk bases stay visible: no low clumps within 0.6 m of a landmark stem
    for lm in L:
        for (sE, sN, d, _) in lm["stem_list"]:
            rr, cc = disc(sE, sN, d / 2 + 0.6)
            low_expl[rr, cc] = True

    # Plant crowns explain what stands within them up to the plant's own height
    for p in plants:
        rr, cc = disc(p["E"], p["N"], p["crown_w"] / 2)
        ok = ch[rr, cc] <= p["height"] + 1.5
        up_expl[rr[ok], cc[ok]] = True
        # A palm with a raised crown leaves the ground beneath it open, except at its own stem;
        # everything else (and the stemless nipa palm) fills its crown down to the ground
        if p["form"] == "palm" and p["height"] >= 4 and p["sci"] != "Nypa fruticans":
            rr, cc = disc(p["E"], p["N"], 0.6)
        low_expl[rr, cc] = True

    # Smoothed canopy for choosing the tallest candidates first
    ch_s = ndimage.maximum_filter(ch, 3)

    def local_h(E, N, s, mask=None):
        rr, cc = disc(E, N, max(0.4, 0.5 * s))
        v = ch[rr, cc]
        if mask is not None:
            m = mask[rr, cc]
            if m.any():
                v = v[m]
        return float(np.percentile(v, 80)) if len(v) else 0.0

    # ---- 4a. upper layer: the top of every unexplained canopy cell in the mapped area
    veg_ok = drop_specks(mapped & ~opn & (ch >= MIN_VEG_M), MIN_PATCH_M2)
    up_cand = veg_ok & ~up_expl
    E, N = candidate_points(up_cand, rng)
    r, c = rc_of(E, N)
    h0 = ch_s[r, c]

    def kind_up(e, n, h):
        rr, cc = rc_of(e, n)
        return clump_type(h, bool(water[rr, cc]))

    idx_up = DiscIndex()
    ups = dart_throw(E, N, kind_up, h0, idx_up, rng)

    # The causeway walk (walkable causeway and landing cells): canopy over it stays, as puffs
    # overhead; nothing else stands on it
    cw_walk = TM["walkable"] & (TM["causeway"] | TM["bank"])
    d_cw = ndimage.distance_transform_edt(~cw_walk) * CELL

    def on_walk(e, n):
        rr, cc = rc_of(e, n)
        return bool(cw_walk[rr, cc])

    n_cw_puff = n_cw_drop = 0
    clumps = []
    for (e, n, h, s, kind) in ups:
        hh = local_h(e, n, s, up_cand)
        kind2 = clump_type(hh, kind == "mangrove_canopy")
        if hh < MIN_VEG_M:
            continue
        w = WIDTH_K[kind2] * spacing(kind2, hh)
        if on_walk(e, n) and (kind2 != "canopy_puff" or hh < CAUSEWAY_PUFF_MIN_H):
            if hh >= CAUSEWAY_PUFF_MIN_H:
                kind2, n_cw_puff = "canopy_puff", n_cw_puff + 1
            else:
                n_cw_drop += 1
                continue
        clumps.append(dict(E=e, N=n, h=hh, w=w, type=kind2, layer="upper"))

    # Clumps that reach the ground explain the understorey beneath them
    for cl in clumps:
        if cl["type"] != "canopy_puff":
            rr, cc = disc(cl["E"], cl["N"], cl["w"] / 2)
            low_expl[rr, cc] = True

    # ---- 4b. lower layer: understorey under high crowns, palms and canopy puffs, on land only
    occ0 = R["band_occ"][0]
    low_cand = veg_ok & ~water & ~low_expl & (occ0 >= 0.5)
    E, N = candidate_points(low_cand, rng)

    def low_h(E_, N_):
        out = np.zeros(len(E_))
        for k in range(len(E_)):
            n = column_top(R, E_[k], N_[k])
            n = 0 if n is None else n
            top = {0: 0.0, 1: 0.8, 2: 1.8}.get(n, 2.6)
            rr, cc = rc_of(E_[k], N_[k])
            if lm_id[rr, cc] > 0:
                top = min(top, lm_cb[rr, cc] - 0.5)
            out[k] = min(top, ch[rr, cc])
        return out

    hl = low_h(E, N)

    def kind_low(e, n, h):
        if h < 0.5:
            return None
        return "ground_shrub" if h < 1.0 else "bush"

    # Low clumps keep clear of every upper clump that reaches the ground, and of plant stems
    idx_low = DiscIndex()
    for cl in clumps:
        if cl["type"] != "canopy_puff":
            idx_low.add(cl["E"], cl["N"], spacing(cl["type"], cl["h"]))
    for p in plants:
        if p["form"] in ("tree", "palm", "mangrove"):
            idx_low.add(p["E"], p["N"], 0.8)

    def low_ok(e, n, s, kind):
        return not on_walk(e, n)

    lows = dart_throw(E, N, kind_low, hl, idx_low, rng, extra_ok=low_ok)
    for (e, n, h, s, kind) in lows:
        clumps.append(dict(E=e, N=n, h=h, w=WIDTH_K[kind] * s, type=kind, layer="lower"))

    # ---- 4c. far banks: a sparse ring of bank trees as scenery
    island = gpd.read_file(VEG / "LizardIsland_2025_vegetation_island_land.shp").geometry.iloc[0]
    near_island = rasterise([island.buffer(BANK_CLEAR_OF_ISLAND_M)], fill=0) > 0
    dist_to_land = ndimage.distance_transform_edt(water) * CELL
    bank_cand = drop_specks(~mapped & ~opn & (ch >= BANK_MIN_H), BANK_MIN_PATCH_M2)
    bank_cand &= ~near_island & (~water | (dist_to_land <= BANK_OVERHANG_M))
    E, N = candidate_points(bank_cand, rng, step=4)
    r, c = rc_of(E, N)
    hb = ch_s[r, c]

    def kind_bank(e, n, h):
        return "understorey_tree" if h < 6.0 else "canopy_puff"

    def bank_ok(e, n, s, kind):
        rr, cc = rc_of(e, n)
        return d_cw[rr, cc] >= CAUSEWAY_BANK_CLEAR_M + 0.5 * WIDTH_K[kind] * s

    bank_table = {"understorey_tree": BANK_SPACING, "canopy_puff": BANK_SPACING}
    idx_bank = DiscIndex(size=8.0)
    for cl in clumps:
        idx_bank.add(cl["E"], cl["N"], spacing(cl["type"], cl["h"]))
    banks = dart_throw(E, N, kind_bank, hb, idx_bank, rng, extra_ok=bank_ok, table=bank_table)
    for (e, n, h, s, kind) in banks:
        hh = local_h(e, n, s, bank_cand)
        kind2 = kind_bank(e, n, hh)
        clumps.append(dict(E=e, N=n, h=hh, w=WIDTH_K[kind2] * s, type=kind2, layer="bank"))

    for cl in clumps:
        cl["gz"] = float(ground_h(R, cl["E"], cl["N"])[0])
        cl["rot"] = float(rng.uniform(0, 2 * math.pi))
    return clumps, dict(lm_id=lm_id, up_expl=up_expl, low_expl=low_expl, causeway=cw_walk,
                        causeway_puffs=n_cw_puff, causeway_dropped=n_cw_drop, veg_ok=veg_ok)


def palm_crown_cover(L, palm_crowns, plants, clumps, veg_ok):
    """For each landmark that became a palm: the vegetated area of its lidar crown outside the
    palm crown, and the share of it that the clumps, the survey plant crowns and the other
    landmark crowns cover (so no hole opens in the canopy)."""
    covered = np.zeros((NROWS, NCOLS), bool)
    for cl in clumps:
        if cl["layer"] != "bank":
            rr, cc = disc(cl["E"], cl["N"], cl["w"] / 2)
            covered[rr, cc] = True
    for p in plants:
        rr, cc = disc(p["E"], p["N"], p["crown_w"] / 2)
        covered[rr, cc] = True
    for pc in palm_crowns:
        i = pc["i"]
        others = rasterise([lm["geom"] for j, lm in enumerate(L) if j != i]) > 0
        old = rasterise([L[i]["geom_table"]]) > 0
        new = rasterise([L[i]["geom"]]) > 0
        rest = old & ~new & veg_ok
        n = int(rest.sum())
        pc["rest_m2"] = n * CELL * CELL
        pc["rest_covered"] = float((rest & (covered | others)).sum() / n) if n else 1.0
        pc["rest_by_clumps"] = float((rest & covered).sum() / n) if n else 1.0


# ----------------------------------------------------------------------------------------------
# 5. Write
# ----------------------------------------------------------------------------------------------

def write_outputs(L, plants, clumps, info, TM):
    DATA.mkdir(exist_ok=True)
    landmarks = []
    for lm in L:
        x, y, z = to_game(lm["E"], lm["N"], lm["gz"])
        cx, cz = to_game(lm["cE"], lm["cN"])
        landmarks.append({"id": lm["id"], "kind": lm["kind"], "x": r2(x), "y": r2(y), "z": r2(z),
                          "height": r2(lm["height"]), "dbh": round(float(lm["dbh"]), 3),
                          "crown_w_ew": r2(lm["crown_w_ew"]), "crown_w_ns": r2(lm["crown_w_ns"]),
                          "crown_base": r2(lm["crown_base"]), "crown_x": r2(cx), "crown_z": r2(cz),
                          "stems": lm["stems"], "multi_stem": bool(lm["multi_stem"]), "name": lm["name"],
                          "sci": lm["sci"]})
    plant_out = []
    for p in plants:
        x, y, z = to_game(p["E"], p["N"], p["gz"])
        plant_out.append({"form": p["form"], "name": p["name"], "sci": p["sci"],
                          "x": r2(x), "y": r2(y), "z": r2(z), "height": r2(p["height"]),
                          "crown_w": r2(p["crown_w"]), "dbh": round(float(p["dbh"]), 3),
                          "rot": r2(p["rot"])})
    rows = []
    for cl in clumps:
        x, y, z = to_game(cl["E"], cl["N"], cl["gz"])
        rows.append([r2(x), r2(y), r2(z), r2(cl["h"]), r2(cl["w"]),
                     CLUMP_TYPES.index(cl["type"]), r2(cl["rot"])])

    type_counts = {t: sum(1 for cl in clumps if cl["type"] == t) for t in CLUMP_TYPES}
    layer_counts = {k: sum(1 for cl in clumps if cl["layer"] == k) for k in ("upper", "lower", "bank")}
    stats = {
        "landmarks": len(landmarks),
        "landmark_kinds": {k: sum(1 for lm in L if lm["kind"] == k) for k in LANDMARK_KINDS},
        "landmark_kinds_from": {k: sum(1 for lm in L if lm["kind_from"] == k)
                                for k in ("survey", "brief", "table", "default")},
        "landmark_kinds_changed_by_survey": len(info["changes"]),
        "landmarks_named_from_survey": sum(1 for lm in L if lm.get("name_from") == "survey"),
        "landmarks_named_from_brief": sum(1 for lm in L if lm.get("name_from") == "brief"),
        "survey_points": info["n_survey"], "survey_rejected": info["n_reject"],
        "survey_non_plant_skipped": info["n_nonplant"], "survey_duplicates_merged": len(info["merged"]),
        "survey_points_absorbed_by_landmarks": len(info["absorbed"]),
        "survey_points_absorbed_without_naming": sum(1 for r in info["roles"].values()
                                                     if r in ("agrees", "conflict")),
        "survey_points_clashing_with_landmark_trunks": len(info["clashes"]),
        "survey_points_at_stems_placed_as_plants": sum(1 for r in info["roles"].values() if r == "plant")
                                                   + len(info["understorey"]),
        "survey_points_dropped_in_open_water": len(info["dropped_open"]),
        "plants": len(plant_out),
        "plant_forms": {f: sum(1 for p in plants if p["form"] == f) for f in FORM_RANGE},
        "clumps": len(rows), "clump_types": type_counts, "clump_layers": layer_counts,
        "causeway_clumps_turned_to_puffs": info["causeway_puffs"],
        "causeway_clumps_dropped": info["causeway_dropped"],
    }
    # Identity questions for review. The survey decides every landmark it marks, so what is left
    # is: survey points that contradict the lab's identifications, survey plants with no landmark
    # kind of their own (drawn broadleaf), kinds changed on a check-quality point or against a stem
    # far thinner than the species' trunk, disagreeing points at one stem, and trunks with no survey
    # point where the orthomosaic suggests another kind
    def entry(landmark, kind, a, reason):
        return {"landmark": landmark, "kind": kind,
                "survey_name": a["name"] if a else None, "survey_sci": a["sci"] if a else None,
                "survey_form": a["form"] if a else None, "survey_flag": a["flag"] if a else None,
                "bark_distance_m": a["bark_m"] if a else None, "reason": reason}

    def desc(a):
        return f"{a['name']} ({a['form']}, {a['flag']}, {a['bark_m']:.2f} m)"

    fate_text = {"agrees": "absorbed by the landmark, as the same kind",
                 "clash": "dropped, as it stands inside the trunk",
                 "plant": "placed as a plant of its own"}
    review = [entry(c["landmark"], c["kind"], c,
                    f"survey point {desc(c)} makes this a {c['kind_survey'].replace('_', ' ')}, but "
                    f"the lab identifies it as {c['kind'].replace('_', ' ')}: the lab's kind is kept")
              for c in info["conflicts"]]
    review += [entry(c["landmark"], c["kind"], c,
                     f"survey point {desc(c)} has no landmark kind of its own; drawn as a broadleaf")
               for c in info["misfits"]]
    for c in info["changes"]:
        why = []
        if c["flag"] == "check":
            why.append("the survey point is check quality, the weakest flag kept")
        typ = SPECIES.get(c["sci"] or "", {}).get("dbh")
        if typ and c["table_dbh"] < 0.5 * typ:
            why.append(f"the lidar stem (dbh {c['table_dbh']:.2f} m) is far thinner than a typical "
                       f"{c['sci']} trunk ({typ:.2f} m), so the plant may stand beside this stem")
        if why:
            review.append(entry(c["landmark"], c["kind_to"], c,
                                f"kind changed from {c['kind_from']} to {c['kind_to']} by the survey; "
                                + "; ".join(why)))
    for d in info["disagreements"]:
        review.append(entry(d["landmark"], d["kind"], d["chosen"],
                            f"two survey points at this stem disagree; the better (flag, then "
                            f"distance) decides: {desc(d['chosen'])} over {desc(d['other'])}, which is "
                            f"{fate_text[d['fate']]}"))
    review += [entry(t, next(lm["kind"] for lm in L if lm["id"] == t), None, why)
               for t, why in ORTHO_PALM_REVIEW.items()
               if next(lm["kind_from"] for lm in L if lm["id"] == t) != "survey"]
    review.sort(key=lambda r: r["landmark"])
    # What the survey changed, and the palm crowns of the landmarks it turned into palms
    survey_identity = {
        "kind_changes": [{"landmark": c["landmark"], "from": c["kind_from"], "to": c["kind_to"],
                          "survey_name": c["name"], "survey_sci": c["sci"], "survey_flag": c["flag"],
                          "bark_distance_m": c["bark_m"]} for c in info["changes"]],
        "palm_crowns": [{"landmark": pc["landmark"],
                         "crown_w_ew": [r2(pc["table_w_ew"]), r2(pc["crown_w_ew"])],
                         "crown_w_ns": [r2(pc["table_w_ns"]), r2(pc["crown_w_ns"])],
                         "crown_base": [r2(pc["table_crown_base"]), r2(pc["crown_base"])],
                         "seen_from_above": pc["seen_from_above"], "orthomosaic": pc["how"],
                         "rest_of_lidar_crown_m2": r2(pc["rest_m2"]),
                         "rest_covered_share": r2(pc["rest_covered"])} for pc in info["palm_crowns"]],
        "notes": ("kind_changes: landmarks whose kind the plant survey changed. "
                  "palm_crowns: [table, now] for each landmark the survey turned into "
                  "a palm. The trunk (x, y, z, dbh, height) is the table's; the crown width is read from "
                  "the drone orthomosaic and centred on the stem (crown_x, crown_z = x, z); a crown base "
                  "the lidar put in the neighbouring understorey is raised to height - %.1f x width. "
                  "Lidar crown cells within %.1f m outside a palm crown that shows from above are "
                  "taken as its frond tips. rest_of_lidar_crown_m2 is the vegetated part of the table's "
                  "crown beyond that; rest_covered_share is the share of it under clumps, survey plant "
                  "crowns or other landmark crowns." % (PALM_DEPTH_K, PALM_TIP_M)),
    }
    notes = ("Positions in metres in the game frame, y up. Landmark and plant x, y, z is the trunk "
             "base on the ground; height is the top above that base. Clump rows are "
             "[x, y, z, h, w, type, rot]: x, y, z is the ground under the clump centre, h the height "
             "of its top above that ground, w its diameter in plan, rot a turn about +y in radians. "
             "canopy_puff clumps are crown blobs whose top is at y + h: they stand over gaps in the "
             "upper canopy and need not reach the ground; over the causeway walk every puff has "
             "h >= 5 m, so a blob no deeper than w leaves head room. The other types stand on the ground. "
             "mangrove_canopy stands over the lake fringe. Anything standing in the fringe water "
             "(mangrove_canopy, and the survey mangroves, buttonwoods and nipa palms there) has y at "
             "the water surface, about 0; under the fringe and under canopy the terrain lake bed is "
             "held on the shelf, 0.06 to 0.36 m below the surface, so trunks there need extending "
             "down by at most about 0.4 m (0.7 m where a clump stands at the edge of open water). "
             "Ground heights come from the 0.5 m site raster with the terrain script's refills "
             "(spikes, implausible bank, islets capped at y = 0.3), so on land they agree with "
             "terrain_height.u16 to a few centimetres. "
             "Landmark identity: where a plant survey point (not reject, not non-plant) stands within "
             "%.1f m of the bark of a landmark stem, and that stem is the nearest landmark stem to it, "
             "the survey decides the landmark's kind, name (common name, else scientific) and sci; "
             "of several such points the best flag (good, usable, check), then the nearest, decides. "
             "Palms are palm (Corypha umbraculifera talipot), Eucalyptus deglupta rainbow_eucalyptus, "
             "other trees broadleaf. The lab's own identifications, the talipots (T007, T008, T009, "
             "T019), the rainbow eucalyptus (T006) and the osprey pole (T036), stand against the survey "
             "(counted as \"brief\" in stats where no survey point confirms them). A landmark with no "
             "survey point keeps the lab's kind, the tree "
             "table's palm reading or broadleaf; T036's name is set by the script, as no survey point "
             "can name a pole. survey_identity lists the kinds the survey changed and the palm crowns "
             "it led to. The review list holds what is left for a person: points that contradict the "
             "lab's identifications, kinds changed on weak evidence, disagreeing "
             "points at one stem, and trunks with no survey point that the orthomosaic shows as palms."
             % MATCH_BARK_M)
    placements = {"frame": FRAME, "landmarks": landmarks, "plants": plant_out,
                  "clumps": {"fields": ["x", "y", "z", "h", "w", "type", "rot"],
                             "types": CLUMP_TYPES, "rows": rows},
                  "stats": stats, "review": review, "survey_identity": survey_identity,
                  "notes": notes}

    # Colliders: one circle per landmark stem and per trunked plant; and, where they stand on
    # walkable ground, the solid-looking clumps (bush, understorey tree, mangrove) and survey shrubs
    def on_walkable(E, N):
        rr, cc = rc_of(E, N)
        return bool(TM["walkable"][rr, cc])

    circles, owners = [], []
    for i, lm in enumerate(L):
        for (sE, sN, d, sid) in lm["stem_list"]:
            x, z = to_game(sE, sN)
            circles.append([r2(x), r2(z), r2(d / 2 + 0.15)])
            owners.append(f"L{i}")
    n_shrub = 0
    for i, p in enumerate(plants):
        x, z = to_game(p["E"], p["N"])
        if p["form"] in ("tree", "palm", "mangrove"):
            circles.append([r2(x), r2(z), r2(p["dbh"] / 2 + 0.15)])
            owners.append(f"P{i}")
        elif p["form"] == "shrub" and p["height"] >= SHRUB_COLLIDE_MIN_H and on_walkable(p["E"], p["N"]):
            circles.append([r2(x), r2(z), r2(COLLIDE_K * p["crown_w"])])
            owners.append(f"P{i}")
            n_shrub += 1
    n_clump = Counter()
    for i, cl in enumerate(clumps):
        if cl["type"] in COLLIDE_TYPES and on_walkable(cl["E"], cl["N"]):
            x, z = to_game(cl["E"], cl["N"])
            circles.append([r2(x), r2(z), r2(COLLIDE_K * cl["w"])])
            owners.append(f"C{i}")
            n_clump[cl["type"]] += 1
    colliders = {"frame": FRAME, "circles": circles, "owners": owners,
                 "stats": {"circles": len(circles),
                           "landmark_stems": sum(1 for o in owners if o[0] == "L"),
                           "plant_trunks": sum(1 for o in owners if o[0] == "P") - n_shrub,
                           "survey_shrubs_on_walkable": n_shrub,
                           "clumps_on_walkable": dict(n_clump)},
                 "notes": ("circles are [x, z, r] in metres; owners gives L<landmark index>, P<plant index> "
                           "or C<clump row index>. Trunks: r = dbh / 2 + 0.15. Bushes, understorey trees "
                           "and mangrove clumps, and survey shrubs %.1f m or taller, whose centre stands on "
                           "walkable ground: r = %.2f x their width, a solid core the player walks round. "
                           "Thicket is not here: it is the thicket bit in terrain_mask.u8."
                           % (SHRUB_COLLIDE_MIN_H, COLLIDE_K))}

    with open(DATA / "placements.json", "w") as f:
        json.dump(placements, f, separators=(",", ":"), allow_nan=False)
    with open(DATA / "colliders.json", "w") as f:
        json.dump(colliders, f, separators=(",", ":"), allow_nan=False)
    return placements, colliders


# ----------------------------------------------------------------------------------------------
# 6. Quicklook
# ----------------------------------------------------------------------------------------------

KIND_COL = {"broadleaf": "#3c7a3a", "palm": "#a0a82f", "talipot": "#d08a1e",
            "rainbow_eucalyptus": "#7a4fb0", "osprey_pole": "#6b4a2b"}
FORM_COL = {"tree": "#2e6b2e", "palm": "#c2b02a", "mangrove": "#2b7f8f", "shrub": "#8f5a9c", "herb": "#d05a7a"}
TYPE_COL = {"ground_shrub": "#b9d98a", "bush": "#7fbf6a", "understorey_tree": "#4f9a58",
            "canopy_puff": "#2f6e45", "mangrove_canopy": "#4aa3a0"}


def ring_xy(geom):
    """Exterior rings of a (multi)polygon as arrays of game x, north (= -z) for plotting."""
    polys = getattr(geom, "geoms", [geom])
    out = []
    for g in polys:
        e, n = np.asarray(g.exterior.coords.xy)
        out.append(np.column_stack([e - E0, n - N0]))
    return out


def draw_north_and_scale(ax, x, y, bar=20, k=1.0):
    ax.add_patch(MplPolygon([[x, y + 5 * k], [x - 1.6 * k, y + 0.8 * k], [x + 1.6 * k, y + 0.8 * k]],
                            closed=True, color="#222222", zorder=20))
    ax.text(x, y - 1.0 * k, "N", ha="center", va="top", fontsize=10, weight="bold", zorder=20)
    sx, sy = x - bar - 5 * k, y
    ax.plot([sx, sx + bar], [sy, sy], color="#222222", lw=3, solid_capstyle="butt", zorder=20)
    ax.text(sx + bar / 2, sy + 1.5, f"{bar} m", ha="center", va="bottom", fontsize=9, zorder=20)


def quicklook(L, plants, clumps, R, placements, cw_walk):
    CHECK.mkdir(exist_ok=True)
    land = gpd.read_file(VEG / "LizardIsland_2025_vegetation_island_land.shp").geometry.iloc[0]
    outline = gpd.read_file(OUTLINE).geometry.iloc[0]
    fig, axes = plt.subplots(1, 2, figsize=(25, 11), gridspec_kw={"width_ratios": [1, 1.35]})
    ext = [W_E - E0, W_E + NCOLS * CELL - E0, N_TOP - NROWS * CELL - N0, N_TOP - N0]
    base = np.where(R["open"], 0.0, np.clip(R["ch"], 0, 20))
    for ax, (xlim, ylim, zoom) in zip(axes, [((-70, 100), (-70, 115), False),
                                             ((-55, 72), (-45, 45), True)]):
        ax.imshow(np.ma.masked_where(R["open"], base), extent=ext, cmap="Greys", vmin=-4, vmax=30,
                  interpolation="nearest", zorder=0)
        ax.imshow(np.ma.masked_where(~R["open"], np.ones_like(base)), extent=ext, cmap="Blues",
                  vmin=0, vmax=4, interpolation="nearest", zorder=0)
        for rg in ring_xy(outline):
            ax.plot(rg[:, 0], rg[:, 1], color="#8a56a8", lw=0.9, ls="--", zorder=2)
        for rg in ring_xy(land):
            ax.plot(rg[:, 0], rg[:, 1], color="#b03a2e", lw=1.2, zorder=2)
        # Clumps as discs by type
        for t in CLUMP_TYPES:
            cs = [cl for cl in clumps if cl["type"] == t]
            pc = PatchCollection([Circle((cl["E"] - E0, cl["N"] - N0), cl["w"] / 2) for cl in cs],
                                 facecolor=TYPE_COL[t], edgecolor="none", alpha=0.45, zorder=3)
            ax.add_collection(pc)
        # Landmark crowns and trunks
        for lm in L:
            for rg in ring_xy(lm.get("crown_geom", lm["geom"])):
                ax.add_patch(MplPolygon(rg, closed=True, facecolor=KIND_COL[lm["kind"]], alpha=0.35,
                                        edgecolor=KIND_COL[lm["kind"]], lw=1.0, zorder=4))
            ax.plot(lm["E"] - E0, lm["N"] - N0, marker="^", color="k", ms=5 if zoom else 3, zorder=6)
            if zoom:
                ax.text(lm["E"] - E0 + 0.6, lm["N"] - N0 + 0.6, lm["id"], fontsize=6.5, zorder=7)
        # Plants: crown circle and a dot by form
        for f in FORM_RANGE:
            ps = [p for p in plants if p["form"] == f]
            ax.add_collection(PatchCollection([Circle((p["E"] - E0, p["N"] - N0), p["crown_w"] / 2)
                                               for p in ps], facecolor="none",
                                              edgecolor=FORM_COL[f], lw=0.7, zorder=5))
            ax.scatter([p["E"] - E0 for p in ps], [p["N"] - N0 for p in ps], s=9 if zoom else 5,
                       color=FORM_COL[f], zorder=6, label=f"plant: {f} ({len(ps)})")
        ax.contour(W_E + (np.arange(NCOLS) + 0.5) * CELL - E0, N_TOP - (np.arange(NROWS) + 0.5) * CELL - N0,
                   cw_walk.astype(float), levels=[0.5], colors="#c0392b", linewidths=1.0,
                   linestyles=":", zorder=8)
        ax.set_xlim(*xlim); ax.set_ylim(*ylim); ax.set_aspect("equal")
        ax.set_xlabel("x = E - 573150 (m)"); ax.set_ylabel("north = -z (m)")
    # Plain labels on features
    a0 = axes[0]
    a0.text(20, 55, "North bank", fontsize=11, ha="center", zorder=9)
    a0.text(0, -62, "South bank", fontsize=11, ha="center", zorder=9)
    a0.text(-45, 42, "Lake", fontsize=11, color="#1f4e79", zorder=9)
    # The causeway label lies on the walkable strip, turned along it (it runs almost due north)
    rr, cc = np.nonzero(cw_walk)
    cwx = W_E + (cc + 0.5) * CELL - E0
    cwn = N_TOP - (rr + 0.5) * CELL - N0
    top, bot = cwn >= np.percentile(cwn, 75), cwn <= np.percentile(cwn, 25)
    cw_ang = math.degrees(math.atan2(cwn[top].mean() - cwn[bot].mean(), cwx[top].mean() - cwx[bot].mean()))
    for ax, fs in ((axes[0], 8), (axes[1], 9)):
        ax.text(float(np.median(cwx)), float(np.median(cwn)), "Causeway", fontsize=fs, rotation=cw_ang,
                rotation_mode="anchor", ha="center", va="center", zorder=9)
    a1 = axes[1]
    a1.text(30, 5, "Lawn", fontsize=11, ha="center", zorder=9)
    a1.text(40, -28, "Mangrove fringe", fontsize=10, ha="center", zorder=9)
    draw_north_and_scale(a0, 92, -64, k=1.0)
    draw_north_and_scale(a1, 67, -41, k=0.75)
    # Legend
    handles = [plt.Line2D([], [], color=KIND_COL[k], lw=6, alpha=0.5, label=f"crown: {k}") for k in KIND_COL]
    handles += [plt.Line2D([], [], marker="o", ls="", color=TYPE_COL[t], ms=9, alpha=0.6,
                           label=f"clump: {t} ({placements['stats']['clump_types'][t]})") for t in CLUMP_TYPES]
    handles += a1.get_legend_handles_labels()[0]
    handles += [plt.Line2D([], [], color="#c0392b", lw=1.0, ls=":", label="causeway walk (terrain mask)"),
                plt.Line2D([], [], color="#b03a2e", lw=1.2, label="island land"),
                plt.Line2D([], [], color="#8a56a8", lw=0.9, ls="--", label="island crop outline")]
    a1.legend(handles=handles, loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8, framealpha=0.9)
    s = placements["stats"]
    axes[0].set_title(f"Whole frame: {s['landmarks']} landmarks, {s['plants']} plants, {s['clumps']} clumps")
    axes[1].set_title("Island: crowns, plants by form, clumps by type over the land outline")
    plt.tight_layout()
    plt.savefig(CHECK / "placements_quicklook.png", dpi=110)
    plt.close(fig)


def palm_quicklook(L, info, plants, clumps, half=8.0, cell=0.04):
    """check/palm_crowns_quicklook.png: for each landmark the survey turned into a palm, the drone
    orthomosaic around the stem (read through its overviews at 4 cm) with the table's crown, the
    palm crown and the clumps and plants that now fill the rest."""
    pcs = info["palm_crowns"]
    if not pcs:
        return
    by_id = {c["landmark"]: c for c in info["changes"]}
    fig, axes = plt.subplots(1, len(pcs), figsize=(5.2 * len(pcs), 5.9), squeeze=False)
    n = int(round(2 * half / cell))
    with rasterio.open(ORTHO) as src:
        for ax, pc in zip(axes[0], pcs):
            lm = L[pc["i"]]
            E, N = lm["E"], lm["N"]
            win = rasterio.windows.from_bounds(E - half, N - half, E + half, N + half, src.transform)
            img = src.read([1, 2, 3], window=win, out_shape=(3, n, n), boundless=True,
                           resampling=rasterio.enums.Resampling.average)
            ax.imshow(np.moveaxis(img, 0, -1), extent=(-half, half, -half, half), interpolation="nearest")
            for cl in clumps:
                if abs(cl["E"] - E) < half + cl["w"] and abs(cl["N"] - N) < half + cl["w"]:
                    ax.add_patch(Circle((cl["E"] - E, cl["N"] - N), cl["w"] / 2, fill=False,
                                        edgecolor=TYPE_COL[cl["type"]], lw=0.7,
                                        ls="--" if cl["type"] == "canopy_puff" else "-"))
            for p in plants:
                if abs(p["E"] - E) < half + p["crown_w"] and abs(p["N"] - N) < half + p["crown_w"]:
                    ax.add_patch(Circle((p["E"] - E, p["N"] - N), p["crown_w"] / 2, fill=False,
                                        edgecolor=FORM_COL[p["form"]], lw=1.0))
            for g in getattr(lm["geom_table"], "geoms", [lm["geom_table"]]):
                e, nn = np.asarray(g.exterior.coords.xy)
                ax.plot(e - E, nn - N, color="white", lw=1.1, ls=(0, (3, 2)))
            e, nn = np.asarray(lm["crown_geom"].exterior.coords.xy)
            ax.plot(e - E, nn - N, color="#ffd21f", lw=1.8)
            if not lm["geom"].equals(lm["crown_geom"]):
                for g in getattr(lm["geom"], "geoms", [lm["geom"]]):
                    e, nn = np.asarray(g.exterior.coords.xy)
                    ax.plot(e - E, nn - N, color="#ffd21f", lw=0.9, ls=":")
            for (sE, sN, d, _) in lm["stem_list"]:
                ax.add_patch(Circle((sE - E, sN - N), max(d / 2, 0.12), color="#e0301e", zorder=5))
            ax.set_xlim(-half, half); ax.set_ylim(-half, half); ax.set_aspect("equal")
            ax.tick_params(labelsize=7)
            c = by_id.get(lm["id"])
            src_txt = f"'{c['name']}' ({c['flag']}, {c['bark_m']:.2f} m)" if c else ""
            ax.set_title(f"{lm['id']} palm, survey {src_txt}\ncrown {pc['table_w_ew']:.2f} x "
                         f"{pc['table_w_ns']:.2f} -> {pc['crown_w_ew']:.2f} x {pc['crown_w_ns']:.2f} m; "
                         f"rest {pc['rest_m2']:.0f} m2, {pc['rest_covered']:.0%} filled"
                         + ("" if pc["seen_from_above"] is not False else "\n(palm crown hidden under "
                            "broadleaf canopy)"), fontsize=8.5)
    handles = [plt.Line2D([], [], color="white", lw=1.1, ls=(0, (3, 2)), label="table crown (lidar)"),
               plt.Line2D([], [], color="#ffd21f", lw=1.8, label="palm crown (game)"),
               plt.Line2D([], [], color="#ffd21f", lw=0.9, ls=":", label="with its frond-tip band"),
               plt.Line2D([], [], marker="o", ls="", color="#e0301e", label="stem")]
    handles += [plt.Line2D([], [], color=TYPE_COL[t], lw=1.0, ls="--" if t == "canopy_puff" else "-",
                           label=f"clump: {t}") for t in CLUMP_TYPES]
    handles += [plt.Line2D([], [], color=FORM_COL[f], lw=1.0, label=f"plant: {f}") for f in FORM_COL]
    fig.legend(handles=handles, loc="lower center", ncol=7, fontsize=8, frameon=False)
    fig.suptitle("Landmarks the plant survey turned into palms: drone orthomosaic (October 2025) around "
                 "the stem, 16 m across, north up", fontsize=10)
    plt.tight_layout(rect=(0, 0.08, 1, 0.95))
    plt.savefig(CHECK / "palm_crowns_quicklook.png", dpi=110)
    plt.close(fig)


# ----------------------------------------------------------------------------------------------

def main():
    rng = np.random.default_rng(SEED)
    R = load_rasters()
    TM = load_terrain_mask()
    L = load_landmarks(R)
    plants, info = build_plants(R, L, rng)
    clumps, cinfo = build_clumps(R, L, plants, TM, rng)
    info.update(causeway_puffs=cinfo["causeway_puffs"], causeway_dropped=cinfo["causeway_dropped"])
    palm_crown_cover(L, info["palm_crowns"], plants, clumps, cinfo["veg_ok"])
    placements, colliders = write_outputs(L, plants, clumps, info, TM)
    quicklook(L, plants, clumps, R, placements, cinfo["causeway"])
    palm_quicklook(L, info, plants, clumps)

    s = placements["stats"]
    print(f"landmarks {s['landmarks']}: {s['landmark_kinds']}; named from survey {s['landmarks_named_from_survey']}, "
          f"from the lab's list {s['landmarks_named_from_brief']}")
    print(f"  kind decided by: {s['landmark_kinds_from']}")
    for c in info["changes"]:
        print(f"  survey changed {c['landmark']}: {c['kind_from']} -> {c['kind_to']} "
              f"('{c['name']}', {c['sci']}, {c['form']}, {c['flag']}, {c['bark_m']:.2f} m from the bark)")
    for c in info["conflicts"]:
        print(f"  lab's kind kept at {c['landmark']} ({c['kind']}) against '{c['name']}' ({c['flag']}, "
              f"{c['bark_m']:.2f} m)")
    for c in info["misfits"]:
        print(f"  {c['landmark']}: '{c['name']}' ({c['form']}) has no landmark kind; drawn broadleaf")
    for d in info["disagreements"]:
        a, b = d["chosen"], d["other"]
        print(f"  {d['landmark']}: '{a['name']}' ({a['flag']}, {a['bark_m']:.2f} m) decides over "
              f"'{b['name']}' ({b['flag']}, {b['bark_m']:.2f} m; {d['fate']})")
    for u in info["understorey"]:
        print(f"  {u['landmark']}: {u['form']} '{u['name']}' ({u['flag']}, {u['bark_m']:.2f} m) at the stem "
              f"is understorey, kept as a plant")
    for pc in info["palm_crowns"]:
        print(f"  palm crown {pc['landmark']}: {pc['table_w_ew']:.2f} x {pc['table_w_ns']:.2f} m -> "
              f"{pc['crown_w_ew']:.2f} x {pc['crown_w_ns']:.2f} m, crown base {pc['table_crown_base']:.2f} -> "
              f"{pc['crown_base']:.2f} m; rest of the lidar crown {pc['rest_m2']:.1f} m2, "
              f"{pc['rest_covered']:.0%} covered ({pc['rest_by_clumps']:.0%} by clumps and plants)")
    dz = np.array([lm["table_base_dz"] for lm in L])
    print(f"  ground: {R['ground_refilled_cells']} cells of 0.5 m refilled (spikes, implausible bank, islets capped)")
    print(f"  table base minus raster ground: median {np.median(dz):+.3f} m, range {dz.min():+.3f} to {dz.max():+.3f}")
    print(f"survey {s['survey_points']} points: {s['survey_rejected']} rejected, {s['survey_non_plant_skipped']} "
          f"non-plant skipped, {s['survey_duplicates_merged']} duplicates merged, "
          f"{s['survey_points_absorbed_by_landmarks']} absorbed by landmarks "
          f"({s['survey_points_absorbed_without_naming']} without naming), "
          f"{s['survey_points_clashing_with_landmark_trunks']} clashing, "
          f"{s['survey_points_dropped_in_open_water']} dropped in open water; {s['plants']} placed")
    print(f"plants {s['plants']}: {s['plant_forms']}")
    how = pd.Series([p["how"].split("+")[0] for p in plants]).value_counts().to_dict()
    print(f"  plant heights from: {how}; {sum(p['under'] is not None for p in plants)} under a landmark crown, "
          f"{sum('+stem' in p['how'] for p in plants)} with dbh from a lidar stem")
    for f in FORM_RANGE:
        hs = [p["height"] for p in plants if p["form"] == f]
        print(f"  {f:8s} n {len(hs):3d}  height median {np.median(hs):5.2f}  range {min(hs):5.2f} to {max(hs):5.2f}")
    for r in placements["review"]:
        print(f"  review: {r['landmark']} ({r['kind']}): {r['reason']}")
    print(f"clumps {s['clumps']}: {s['clump_types']} by layer {s['clump_layers']}")
    print(f"  causeway walk: {s['causeway_clumps_turned_to_puffs']} clumps kept overhead as puffs, "
          f"{s['causeway_clumps_dropped']} dropped")
    print(f"colliders {colliders['stats']}")
    for f in ("placements.json", "colliders.json"):
        print(f"  {f}: {(DATA / f).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
