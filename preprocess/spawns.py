"""Lizard spawn table for the Lizard Island game.

Draws a sample of the lab's anole observations, stratified by perch within each species,
and turns each one into a game lizard sitting on something the game draws: a landmark
trunk, a survey plant, a vegetation clump, a log prop, or open ground. The observations are used only to place
game lizards. Nothing that identifies an observation is written: no ids, dates or times,
and no observation coordinates. Every sampled point is moved 0.3 to 1.0 m in a random
direction, its perch height is scaled by up to 10 %, and the finished lizard is checked
to sit at least 0.2 m from every original observation.

Reads (all read only):
    data/terrain.json with terrain_height.u16 and terrain_mask.u8   ground and walkable land
    data/placements.json, data/colliders.json                        hosts and trunk circles
    LizardIsland_2025_trees/LizardIsland_2025_trees.gpkg (tree_stems) landmark stem axes
    LizardIsland_2025_walkthrough_cleaned/data/lizards.json          the observations

Writes:
    data/spawns.json
    check/spawns_quicklook.png

Game frame (metres, y up): x = E - 573150, z = -(N - 2840100), y = h + 24.90, so the
lake surface is y = 0 and north is -z. Angles follow the terrain start heading: a
direction ang points along (-sin ang, 0, -cos ang), 0 is north, positive turns towards
west, the same as three.js rotation.y for an object whose front faces -z.

Run from the game folder:
    .venv/bin/python preprocess/spawns.py
"""

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap
from matplotlib.patches import Polygon as MplPolygon
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial import cKDTree

# ----------------------------------------------------------------------------------------------
# Paths and frame
# ----------------------------------------------------------------------------------------------

GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent
DATA = GAME / "data"
CHECK = GAME / "check"
LIZARDS = OUT / "LizardIsland_2025_walkthrough_cleaned" / "data" / "lizards.json"
TREES_GPKG = OUT / "LizardIsland_2025_trees" / "LizardIsland_2025_trees.gpkg"

E0, N0, H0 = 573150.0, 2840100.0, -24.90
FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.90,
         "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}

SEED = 2718        # fixed, so every run writes the same table

# ----------------------------------------------------------------------------------------------
# Species, sampling and jitter
# ----------------------------------------------------------------------------------------------

SPECIES = {  # name: (common name, target sample size or None for all, rarity)
    "cristatellus": ("crested anole", 600, "common"),
    "sagrei": ("brown anole", 160, "uncommon"),
    "carolinensis": ("green anole", 150, "rare"),
    "distichus": ("bark anole", None, "very rare"),
    "equestris": ("knight anole", None, "very rare"),
}
RARE = {"distichus", "equestris"}
# The most constrained species are placed first, so every rare record finds a free host before
# the common species fill the rest
PLACE_ORDER = ["equestris", "distichus", "carolinensis", "sagrei", "cristatellus"]
DRAWS_COMMON = 1          # jitter draws per observation for the common species (a failure is a drop)
DRAWS_RARE = 25           # the few rare observations get fresh draws until one places cleanly
RARE_PULL_M = 10.0        # a rare record out of the pole's reach is pulled in until it is in reach, if
                          # the nearest ground the player can stand on is at most this far
RARE_MAX_H = 3.5          # and a rare record perched higher than the loop pole reaches is brought down
                          # to this height, so every record of a rare species gives a lizard

SEX = {"male": "m", "female": "f"}          # anything else is "u"
PERCH_FIX = {             # field spellings to the eight perch classes; "nan" rows are left out
    "trunk": "trunk", "trunm": "trunk", "trunn": "trunk",
    "branch": "branch", "branxh": "branch",
    "ground": "ground", "grou nd": "ground",
    "palm.stem": "palm_stem", "palm": "palm_stem",
    "root": "root", "roor": "root",
    "leaf": "leaf", "leaves": "leaf",
    "palm.frond": "palm_frond",
    "log": "log",
}
PERCHES = ["trunk", "branch", "ground", "palm_stem", "root", "leaf", "palm_frond", "log"]

JITTER_M = (0.3, 1.0)     # horizontal jitter, uniform over the annulus
HJITTER = 0.10            # perch height scaled by a factor in [0.9, 1.1]
HSTEP = 0.05              # and rounded to this step
MIN_RECORD_M = 0.22       # no lizard nearer than this to any observation (0.2 m rule plus rounding room)
MIN_SPACING_M = 0.30      # lizards at least this far apart in 3D

# ----------------------------------------------------------------------------------------------
# Hosts
# ----------------------------------------------------------------------------------------------

REACH_M = 2.0             # loop pole reach: every lizard within this of a cell the player can stand on
MAX_ABOVE_GROUND_M = 4.0  # and no higher than this above that nearest standing ground
WATER_CLEAR_Y = 0.15      # a lizard over water sits at least this high above the lake surface
W_HEIGHT = 0.5            # ranking: 1 m of height misfit counts as 0.5 m of plan distance
MAX_CANDIDATES = 12       # hosts tried per draw, best first
VARIANTS = 16             # turns of a placement about its host (full circle in 1/8 turns) or slides
                          # along a log, to clear the 0.2 m rule and the spacing
MAX_MOVE_M = 4.0          # a lizard never ends further than this (in plan) from its jittered point
GROUND_SNAP_M = 1.0       # a ground lizard just off walkable land moves onto it if this close
SEARCH_M = {"trunk": 3.0, "palm_stem": 3.0, "root": 3.0, "leaf": 3.0,
            "branch": 4.5, "palm_frond": 4.5, "log": 3.0}
MAX_DH = 0.75             # a host must fit the recorded perch height to within this (m), so the
                          # height is never clamped far up or down to the host
FALLBACK_M = 3.0          # nearest host of any kind, when nothing matching is near
MODE_STEP_M = 2.0         # ranking: each step down a perch's fallback list counts as 2 m further
STUB_M = 0.2              # a branch lizard below its host's crown lies on a short stub branch this
                          # far out from the bark, not out in the air under the crown
BASE_M = 0.2              # a lizard at the foot of a stem sits this far from the bark
# Crowding: at most HOST_CAP lizards on one host, and at most DISC_CAP[sp] others of the same
# species within DISC_M, so a few much-watched trees do not carry swarms
HOST_CAP = 6
LOG_CAP = 3
DISC_M = 3.0
DISC_CAP = {"cristatellus": 8, "sagrei": 4, "carolinensis": 4, "distichus": 4, "equestris": 4}

# Which host kinds a perch attaches to first, and with which placement mode
PRIMARY = {
    "trunk": ("bark", {"broadleaf", "rainbow_eucalyptus", "tree", "mangrove"}),
    "palm_stem": ("bark", {"palm", "talipot"}),
    "root": ("root", {"broadleaf", "rainbow_eucalyptus", "mangrove", "mangrove_canopy", "big_tree"}),
    "branch": ("branch", {"broadleaf", "rainbow_eucalyptus", "tree", "mangrove", "shrub",
                          "ground_shrub", "bush", "understorey_tree", "canopy_puff", "mangrove_canopy"}),
    "leaf": ("leaf", {"shrub", "herb", "ground_shrub", "bush", "understorey_tree", "broadleaf",
                      "rainbow_eucalyptus", "tree", "mangrove", "canopy_puff", "mangrove_canopy"}),
    "palm_frond": ("frond", {"palm", "talipot"}),
    "log": ("log", {"log"}),
}
# Fallback: on any host, the first of these modes that the host supports and that has not
# already been tried on it. "base" puts the lizard on the ground at the foot of the host.
FALLBACK_MODES = {
    "trunk": ["bark", "branch", "leaf"],
    "palm_stem": ["bark", "frond", "branch", "leaf"],
    "root": ["root", "base"],
    "branch": ["branch", "leaf", "frond", "bark"],
    "leaf": ["leaf", "branch", "frond", "bark"],
    "palm_frond": ["frond", "leaf", "branch", "bark"],
    "log": ["base", "root"],
    "ground": ["base", "root"],
}
BIG_TREE_DBH = 0.25       # survey trees this thick or more count as large-tree bases for roots

# ----------------------------------------------------------------------------------------------
# Logs
# ----------------------------------------------------------------------------------------------

LOG_CLUSTER_M = 2.0       # complete linkage: every member of a cluster within this of the others
LOG_SNAP_M = 3.0          # a log centre off walkable land moves to the nearest walkable cell this close
LOG_LEN = (1.4, 3.0)
LOG_R = (0.10, 0.17)
LOG_CLEAR_START_M = 4.0   # keep the start point clear
LOG_SAMPLES = 9           # points along the log tested for ground and walkability
LOG_MIN_WALK = 7          # at least this many of them on ground the player can stand on
LOG_MAX_OFFSET_M = 0.08   # a level log: the ground along it within this of the ground at its middle

POSE_NOTE = ("pose 'bark': clinging to a stem, belly towards the stem axis, head up, back facing "
             "along ang (ang points from the axis to the lizard); pose 'flat': lying on a roughly "
             "level surface (ground, log, branch, leaf, frond), head towards ang")


# ----------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------

def to_game(E, N):
    return np.asarray(E, float) - E0, -(np.asarray(N, float) - N0)


def ang_of(ux, uz):
    """Angle of a plan direction in the frame convention: (ux, uz) = (-sin a, -cos a)."""
    return math.atan2(-ux, -uz)


def unit(dx, dz, rng):
    n = math.hypot(dx, dz)
    if n < 1e-6:
        a = rng.uniform(0, 2 * math.pi)
        return math.cos(a), math.sin(a), 0.0
    return dx / n, dz / n, n


def rotate(ux, uz, a):
    c, s = math.cos(a), math.sin(a)
    return c * ux - s * uz, s * ux + c * uz


def r2(v):
    return round(float(v), 2)


def annulus(rng, lo, hi):
    """A random offset whose length is uniform in area over the annulus lo..hi."""
    rad = math.sqrt(rng.uniform(lo * lo, hi * hi))
    a = rng.uniform(0, 2 * math.pi)
    return rad * math.cos(a), rad * math.sin(a)


def ray_to_ellipse(ax, az, ux, uz, cx, cz, rx, rz):
    """Largest t >= 0 with (ax + t ux, az + t uz) inside the ellipse; None if the ray misses it."""
    px, pz = (ax - cx) / rx, (az - cz) / rz
    qx, qz = ux / rx, uz / rz
    a = qx * qx + qz * qz
    b = 2 * (px * qx + pz * qz)
    c = px * px + pz * pz - 1
    disc = b * b - 4 * a * c
    if disc < 0 or a < 1e-12:
        return None
    t = (-b + math.sqrt(disc)) / (2 * a)
    return t if t >= 0 else None


def seg_dist(px, pz, cx, cz, dx, dz, half):
    """Plan distance from a point to a segment centred at (cx, cz) with unit direction (dx, dz)."""
    t = np.clip((px - cx) * dx + (pz - cz) * dz, -half, half)
    return np.hypot(px - (cx + t * dx), pz - (cz + t * dz))


# ----------------------------------------------------------------------------------------------
# 1. Terrain: ground height, classes and reach
# ----------------------------------------------------------------------------------------------

class Terrain:
    def __init__(self):
        t = json.loads((DATA / "terrain.json").read_text())
        self.meta = t
        self.cell, self.rows, self.cols = t["cell"], t["rows"], t["cols"]
        self.x0, self.z0 = t["x0"], t["z0"]
        hv = np.fromfile(DATA / t["height"]["file"], dtype="<u2").reshape(self.rows, self.cols)
        self.y = t["height"]["offset"] + hv.astype(float) * t["height"]["scale"]
        self.mask = np.fromfile(DATA / t["mask"]["file"], dtype=np.uint8).reshape(self.rows, self.cols)
        bits = t["mask"]["bits"]
        self.bits = bits
        self.walk = (self.mask & bits["walkable"]) > 0
        self.water = (self.mask & bits["water"]) > 0
        self.thicket = (self.mask & bits["thicket"]) > 0
        # The player stands on walkable cells outside every collider circle (trunks, and the
        # bushes and understorey trees on walkable ground). Loop pole reach and "on the ground" are
        # measured against these cells.
        C = json.loads((DATA / "colliders.json").read_text())
        self.circles = np.array(C["circles"], float)
        self.circle_tree = cKDTree(self.circles[:, :2])
        xs = self.x0 + np.arange(self.cols) * self.cell
        zs = self.z0 + np.arange(self.rows) * self.cell
        blocked = np.zeros_like(self.walk)
        for x, z, r in self.circles:
            c0, c1 = np.searchsorted(xs, [x - r, x + r])
            r0, r1 = np.searchsorted(zs, [z - r, z + r])
            gx, gz = np.meshgrid(xs[c0:c1], zs[r0:r1])
            blocked[r0:r1, c0:c1] |= (gx - x) ** 2 + (gz - z) ** 2 <= r * r
        self.stand = self.walk & ~blocked
        rr, cc = np.nonzero(self.stand)
        self.walk_xz = np.column_stack([self.x0 + cc * self.cell, self.z0 + rr * self.cell])
        self.walk_y = self.y[rr, cc]
        self.walk_tree = cKDTree(self.walk_xz)
        self.start = t["start"]

    def rc(self, x, z):
        c = int(math.floor((x - self.x0) / self.cell + 0.5))
        r = int(math.floor((z - self.z0) / self.cell + 0.5))
        return min(max(r, 0), self.rows - 1), min(max(c, 0), self.cols - 1)

    def height(self, x, z):
        """Bilinear ground (or lake bed) height between cell centres."""
        fc = min(max((x - self.x0) / self.cell, 0), self.cols - 1.001)
        fr = min(max((z - self.z0) / self.cell, 0), self.rows - 1.001)
        c0, r0 = int(fc), int(fr)
        tc, tr = fc - c0, fr - r0
        y = self.y
        return ((1 - tr) * ((1 - tc) * y[r0, c0] + tc * y[r0, c0 + 1])
                + tr * ((1 - tc) * y[r0 + 1, c0] + tc * y[r0 + 1, c0 + 1]))

    def in_collider(self, x, z, pad=0.0):
        for k in self.circle_tree.query_ball_point([x, z], 3.0):
            cx, cz, r = self.circles[k]
            if math.hypot(x - cx, z - cz) < r + pad:
                return True
        return False

    def is_walk(self, x, z):
        """On a walkable cell and outside every collider: somewhere the player can stand."""
        return bool(self.walk[self.rc(x, z)]) and not self.in_collider(x, z, 0.02)

    def over_water(self, x, z):
        r, c = self.rc(x, z)
        return bool(self.water[r, c]) or self.y[r, c] <= 0.0

    def reach(self, x, z):
        """Plan distance to the nearest cell the player can stand on, and that cell's ground y."""
        d, i = self.walk_tree.query([x, z])
        return float(d), float(self.walk_y[i])

    def pull_into_reach(self, x, z, limit):
        """A point out of reach moved straight towards the nearest standing ground until it is
        just in reach; None if that ground is further than limit."""
        d, i = self.walk_tree.query([x, z])
        if d > limit:
            return None
        if d <= REACH_M - 0.5:
            return x, z
        qx, qz = self.walk_xz[i]
        k = (REACH_M - 0.5) / d
        return qx + (x - qx) * k, qz + (z - qz) * k

    def nearest_walk(self, x, z, radius):
        d, i = self.walk_tree.query([x, z], distance_upper_bound=radius)
        return None if not np.isfinite(d) else self.walk_xz[i]


# ----------------------------------------------------------------------------------------------
# 2. Hosts: landmarks, plants and clumps from placements.json
# ----------------------------------------------------------------------------------------------

class Hosts:
    """Flat arrays over every host, with the geometry each placement mode needs.

    For each host: a main axis (x, z) and base y0 (the ground or water surface it stands on),
    a top height, a plan footprint ellipse (crown centre and semi-axes), a foliage zone lo..hi
    above y0, and, where it has one, a list of stems (x, z, bark radius, collider index).
    Height ranges per mode (bark, root, branch, leaf, frond) are NaN where a host lacks the mode.
    """

    def __init__(self):
        P = json.loads((DATA / "placements.json").read_text())
        C = json.loads((DATA / "colliders.json").read_text())
        self.P = P
        circ = np.array(C["circles"], float)
        owners = C["owners"]
        rec = []

        # Landmark stems: exact axes and diameters from the trees GeoPackage, matched to their
        # collider circles so a renderer can find the stem a lizard clings to.
        stems = gpd.read_file(TREES_GPKG, layer="tree_stems")
        by_owner = defaultdict(list)
        for k, o in enumerate(owners):
            by_owner[o].append(k)

        for i, lm in enumerate(P["landmarks"]):
            kind, h, cb = lm["kind"], lm["height"], lm["crown_base"]
            st = []
            for s in stems[stems.id == lm["id"]].itertuples():
                sx, sz = to_game(s.base_E, s.base_N)
                ks = by_owner[f"L{i}"]
                k = ks[int(np.argmin(np.hypot(circ[ks, 0] - sx, circ[ks, 1] - sz)))]
                st.append((float(sx), float(sz), float(s.dbh_m) / 2, k))
            if not st:
                st = [(lm["x"], lm["z"], lm["dbh"] / 2, by_owner[f"L{i}"][0])]
            r = dict(t="landmark", i=i, kind=kind, x=lm["x"], z=lm["z"], y0=lm["y"], top=h,
                     cx=lm["crown_x"], cz=lm["crown_z"], rx=lm["crown_w_ew"] / 2,
                     rz=lm["crown_w_ns"] / 2, stems=st, shape="ellipsoid")
            if kind in ("broadleaf", "rainbow_eucalyptus"):
                r.update(lo=cb, hi=h, bark=(0.05, 0.9 * h), root=(0.02, 0.6),
                         branch=(0.5 * cb, 0.95 * h), leaf=(cb, h), base=True)
            elif kind in ("palm", "talipot"):
                r.update(lo=cb, hi=h, bark=(0.05, 0.9 * max(cb, 0.3 * h)), root=(0.02, 0.6),
                         frond=(cb, h), base=True)
            else:  # the osprey nest pole: a bare pole below the nest platform
                r.update(lo=cb, hi=h, bark=(0.05, 0.9 * cb), root=(0.02, 0.6), base=True)
            rec.append(r)

        plant_circle = {int(o[1:]): k for k, o in enumerate(owners) if o[0] == "P"}
        for i, p in enumerate(P["plants"]):
            form, h, w = p["form"], p["height"], p["crown_w"]
            r = dict(t="plant", i=i, kind=form, x=p["x"], z=p["z"], y0=p["y"], top=h,
                     cx=p["x"], cz=p["z"], rx=w / 2, rz=w / 2, stems=[], shape="ellipsoid", base=True)
            if form in ("tree", "mangrove"):
                cb = (0.35 if form == "tree" else 0.25) * h
                r.update(stems=[(p["x"], p["z"], p["dbh"] / 2, plant_circle.get(i, -1))],
                         lo=cb, hi=h, bark=(0.05, 0.9 * h), branch=(0.5 * cb, 0.95 * h), leaf=(cb, h))
                if form == "mangrove" or p["dbh"] >= BIG_TREE_DBH:
                    r.update(root=(0.02, 0.6))
                if form == "tree" and p["dbh"] >= BIG_TREE_DBH:
                    r["kind2"] = "big_tree"
            elif form == "palm":
                flo = max(0.15, h - 0.6 * w)
                r.update(stems=[(p["x"], p["z"], p["dbh"] / 2, plant_circle.get(i, -1))],
                         lo=flo, hi=h, bark=(0.05, max(0.3, 0.9 * flo)), root=(0.02, 0.6),
                         frond=(flo, h))
            elif form == "shrub":
                r.update(shape="dome", lo=0.0, hi=h, branch=(0.1 * h, 0.9 * h), leaf=(0.0, h))
            else:  # herb
                r.update(shape="dome", lo=0.0, hi=h, leaf=(0.0, h))
            rec.append(r)

        types = P["clumps"]["types"]
        f = {k: j for j, k in enumerate(P["clumps"]["fields"])}
        for i, row in enumerate(P["clumps"]["rows"]):
            kind = types[row[f["type"]]]
            x, y, z, h, w = (row[f[k]] for k in ("x", "y", "z", "h", "w"))
            r = dict(t="clump", i=i, kind=kind, x=x, z=z, y0=y, top=h, cx=x, cz=z, rx=w / 2, rz=w / 2,
                     stems=[], shape="ellipsoid")
            if kind in ("ground_shrub", "bush"):
                r.update(shape="dome", lo=0.0, hi=h, branch=(0.1 * h, 0.9 * h), leaf=(0.0, h), base=True)
            elif kind in ("understorey_tree", "mangrove_canopy"):
                # These stand on the ground on a single short stem; the stem radius is nominal
                cb = (0.35 if kind == "understorey_tree" else 0.30) * h
                r.update(stems=[(x, z, 0.06 + 0.01 * h, -1)], lo=cb, hi=h, bark=(0.05, 0.9 * cb + 0.3),
                         branch=(0.5 * cb, 0.95 * h), leaf=(cb, h), base=True)
                if kind == "mangrove_canopy":
                    r.update(root=(0.02, 0.6))
            else:  # canopy_puff: a crown blob with no trunk under it, no deeper than w
                lo = max(h - 0.8 * w, 0.4 * h)
                r.update(lo=lo, hi=h, branch=(lo, 0.95 * h), leaf=(lo, h))
            rec.append(r)

        self.rec = rec
        self.n = len(rec)
        g = lambda k: np.array([r[k] for r in rec], float)
        self.cx, self.cz, self.rx, self.rz = g("cx"), g("cz"), g("rx"), g("rz")
        self.x, self.z, self.y0 = g("x"), g("z"), g("y0")
        self.kinds = [r["kind"] for r in rec]
        self.kind2 = [r.get("kind2") for r in rec]
        self.rng_of = {}
        for m in ["bark", "root", "branch", "leaf", "frond"]:
            a = np.full((self.n, 2), np.nan)
            for j, r in enumerate(rec):
                if m in r:
                    a[j] = r[m]
            self.rng_of[m] = a
        self.has_base = np.array([bool(r.get("base")) for r in rec])
        # stems flattened for distance queries
        sx, sz, sr, sh = [], [], [], []
        for j, r in enumerate(rec):
            for (a, b, rad, _) in r["stems"]:
                sx.append(a); sz.append(b); sr.append(rad); sh.append(j)
        self.sx, self.sz, self.sr, self.sh = map(np.array, (sx, sz, sr, sh))
        # every stem in one index, for plan distances and for keeping lizards out of trunks
        self.stem_tree = cKDTree(np.column_stack([self.sx, self.sz]))
        # host list and index to host number, for the per-host lizard count
        self.index = {(r["t"], r["i"]): j for j, r in enumerate(rec)}

    def supports(self, j, mode):
        if mode == "base":
            return bool(self.has_base[j])
        if mode in ("bark", "root") and not self.rec[j]["stems"]:
            return False
        return mode in self.rng_of and np.isfinite(self.rng_of[mode][j, 0])

    def matches(self, j, kinds):
        return self.kinds[j] in kinds or (self.kind2[j] is not None and self.kind2[j] in kinds)

    def plan_distance(self, px, pz, mode):
        """Per-host plan distance from a point to what a lizard in this mode clings to."""
        if mode in ("bark", "root"):
            d = np.full(self.n, np.inf)
            ds = np.hypot(self.sx - px, self.sz - pz) - self.sr
            np.minimum.at(d, self.sh, np.maximum(ds, 0.0))
            rho = np.zeros(self.n)
            return d, rho
        rho = np.hypot((px - self.cx) / self.rx, (pz - self.cz) / self.rz)
        d = np.maximum(rho - 1.0, 0.0) * np.minimum(self.rx, self.rz)
        return d, np.minimum(rho, 1.0)

    def height_misfit(self, mode, hj):
        a = self.rng_of.get(mode)
        if a is None:
            return np.zeros(self.n)
        return np.nan_to_num(np.maximum(np.maximum(a[:, 0] - hj, hj - a[:, 1]), 0.0), nan=np.inf)


# ----------------------------------------------------------------------------------------------
# 3. Observations
# ----------------------------------------------------------------------------------------------

def load_observations():
    """Keep species, sex, perch and position only; ids serve the sampling and are then dropped."""
    raw = json.loads(LIZARDS.read_text())
    obs, skipped = [], Counter()
    for r in raw:
        E, N, h, sp, sex, ind, _date, _time, perch, _extra = r
        if sp not in SPECIES:
            skipped["species missing"] += 1
            continue
        p = PERCH_FIX.get(str(perch).strip().lower())
        if p is None:
            skipped["perch missing"] += 1
            continue
        x, z = to_game(E, N)
        obs.append(dict(x=float(x), z=float(z), h=float(h), sp=sp, sex=SEX.get(sex, "u"), perch=p, ind=ind))
    all_xz = np.column_stack(to_game([r[0] for r in raw], [r[1] for r in raw]))
    counts = Counter(r[3] for r in raw)
    return obs, all_xz, counts, len(raw), skipped


def individual_first(records, rng):
    """A random order taken round the marked individuals: every individual's first record, then
    every second record, and so on. Only a tie-break inside a perch stratum (see below)."""
    perm = [records[k] for k in rng.permutation(len(records))]
    seen, keyed = Counter(), []
    for pos, o in enumerate(perm):
        keyed.append((seen[o["ind"]], pos, o))
        seen[o["ind"]] += 1
    keyed.sort(key=lambda t: (t[0], t[1]))
    return [o for _, _, o in keyed]


def stratified_order(pool, target, rng):
    """Sampling order for one species, stratified by perch.

    Each perch gets a quota in proportion to its share of the species' records (largest
    remainder), so the game's perch mix follows the field records whatever the individuals
    were: taking one record per individual first had filled the sample with animals seen only
    once, which perch higher and far more often on leaves. Inside a stratum the order goes
    round the individuals. The strata are merged into one sequence in which each fills at the
    same pace: record k of a stratum with quota q comes at (k + 0.5) / q."""
    by_perch = defaultdict(list)
    for o in pool:
        by_perch[o["perch"]].append(o)
    raw = {p_: target * len(v) / len(pool) for p_, v in by_perch.items()}
    quota = {p_: int(math.floor(x)) for p_, x in raw.items()}
    spare = target - sum(quota.values())
    for p_ in sorted(raw, key=lambda p_: (-(raw[p_] - quota[p_]), PERCHES.index(p_)))[:spare]:
        quota[p_] += 1
    merged = []
    for p_ in PERCHES:
        if p_ not in by_perch:
            continue
        q = max(quota[p_], 1)
        merged += [((k + 0.5) / q, PERCHES.index(p_), k, o)
                   for k, o in enumerate(individual_first(by_perch[p_], rng))]
    merged.sort(key=lambda t: t[:3])
    return [t[3] for t in merged], quota


# ----------------------------------------------------------------------------------------------
# 4. Log props
# ----------------------------------------------------------------------------------------------

def build_logs(obs, T, H, rec_tree, rng):
    """One log per cluster of log observations, near the jittered cluster centre on walkable land.

    Every jitter and every lie of the log is tried; a candidate must keep its ends out of the
    water, stay clear of every collider circle and of the other logs, have at least LOG_MIN_WALK
    of its LOG_SAMPLES points on ground the player can stand on, and lie on ground no more than
    LOG_MAX_OFFSET_M above or below the ground at its middle (the log is drawn level). The best
    is the most walkable, then the most level, then the nearest the cluster centre."""
    pts = np.array([[o["x"], o["z"]] for o in obs if o["perch"] == "log"])
    lab = fcluster(linkage(pts, method="complete"), LOG_CLUSTER_M, criterion="distance")
    clusters = [pts[lab == k] for k in np.unique(lab)]
    clusters.sort(key=lambda c: (round(float(c[:, 0].mean()), 3), round(float(c[:, 1].mean()), 3)))
    sx0, sz0 = T.start["x"], T.start["z"]
    logs, dropped = [], 0
    for c in clusters:
        m = c.mean(0)
        # Length and lie of the log from the spread of its observations, where there is one
        if len(c) >= 2:
            ev, evec = np.linalg.eigh(np.cov((c - m).T))
            ax = evec[:, -1]
            spread = np.ptp((c - m) @ ax)
            elongated = ev[-1] > 2.25 * max(ev[0], 1e-9) and spread > 0.5
            theta0 = math.atan2(-ax[1], ax[0]) if elongated else rng.uniform(0, math.pi)
        else:
            spread, theta0 = 0.0, rng.uniform(0, math.pi)
        length = float(np.clip(spread + 1.0 + rng.uniform(0, 0.6), *LOG_LEN))
        rad = float(rng.uniform(*LOG_R))
        best = None
        for kj in range(12):                                # jitters of the cluster centre
            jx, jz = annulus(rng, *JITTER_M)
            px, pz = m[0] + jx, m[1] + jz
            if not T.is_walk(px, pz):
                q = T.nearest_walk(px, pz, LOG_SNAP_M)
                if q is None:
                    continue
                px, pz = q[0] + rng.uniform(-0.1, 0.1), q[1] + rng.uniform(-0.1, 0.1)
            if rec_tree.query([px, pz])[0] < MIN_RECORD_M or math.hypot(px - sx0, pz - sz0) < LOG_CLEAR_START_M:
                continue
            y_mid = T.height(px, pz)
            for k in range(12):                             # lies of the log about that centre
                th = theta0 + (k + 1) // 2 * (math.pi / 12) * (1 if k % 2 else -1)
                dx, dz = math.cos(th), -math.sin(th)       # axis of a log turned by rotation.y = th
                ts = np.linspace(-length / 2, length / 2, LOG_SAMPLES)
                samples = [(px + t * dx, pz + t * dz) for t in ts]
                if any(T.over_water(*e) for e in (samples[0], samples[-1])):
                    continue
                sd = seg_dist(T.circles[:, 0], T.circles[:, 1], px, pz, dx, dz, length / 2)
                if np.any(sd < T.circles[:, 2] + rad + 0.05):
                    continue
                if any(seg_dist(px, pz, l["x"], l["z"], l["dx"], l["dz"], l["len"] / 2) < 1.2 + length / 2
                       for l in logs):
                    continue
                n_walk = sum(T.is_walk(*q) for q in samples)
                offset = max(abs(T.height(*q) - y_mid) for q in samples)
                if n_walk < LOG_MIN_WALK or offset > LOG_MAX_OFFSET_M:
                    continue
                key = (-n_walk, round(offset, 3), round(math.hypot(px - m[0], pz - m[1]), 3), kj, k)
                if best is None or key < best[0]:
                    best = (key, dict(x=px, z=pz, y=y_mid, len=length, r=rad, rot=th % (2 * math.pi),
                                      dx=dx, dz=dz, walk=n_walk, offset=offset))
        if best:
            logs.append(best[1])
        else:
            dropped += 1
    return logs, dict(log_observations=len(pts), clusters=len(clusters), logs=len(logs),
                      clusters_without_log=dropped,
                      cluster_sizes=dict(sorted(Counter(len(c) for c in clusters).items())),
                      min_walkable_points=min((l["walk"] for l in logs), default=None),
                      max_ground_offset_m=round(max((l["offset"] for l in logs), default=0.0), 3))


# ----------------------------------------------------------------------------------------------
# 5. Placing one lizard
# ----------------------------------------------------------------------------------------------

def snap_height(hj, lo, hi):
    """Recorded height clamped to the host, on the 0.05 m step where the clamp allows."""
    h = min(max(round(hj / HSTEP) * HSTEP, lo), hi)
    return round(h, 2)


class Placer:
    def __init__(self, T, H, logs, rec_tree):
        self.T, self.H, self.logs, self.rec_tree = T, H, logs, rec_tree
        self.placed_xyz = []
        self.sp_xz = defaultdict(list)          # placed positions per species, for DISC_CAP,
        self.sp_nb = defaultdict(list)          # and how many same-species neighbours each has
        self.load = np.zeros(H.n, int)           # lizards per host, for HOST_CAP
        self.log_load = Counter()
        # hosts that match each perch and support its mode, worked out once
        self.ok = {perch: np.array([H.matches(j, kinds) and H.supports(j, mode) for j in range(H.n)])
                   for perch, (mode, kinds) in PRIMARY.items() if perch != "log"}

    # --- checks shared by every mode -------------------------------------------------------
    # (reach and spacing keep 1 cm in hand so they still hold once positions are rounded)
    def check(self, x, y, z, ground, sp):
        if self.rec_tree.query([x, z])[0] < MIN_RECORD_M:
            return "record_clash"
        if ground:
            if not self.T.is_walk(x, z):
                return "not_walkable"
        else:
            d, gy = self.T.reach(x, z)
            if d > REACH_M - 0.01:
                return "out_of_reach"
            if y - gy > MAX_ABOVE_GROUND_M:
                return "too_high"
        if self.T.over_water(x, z) and y < WATER_CLEAR_Y:
            return "water"
        if self.placed_xyz:
            d = np.min(np.linalg.norm(np.array(self.placed_xyz) - [x, y, z], axis=1))
            if d < MIN_SPACING_M + 0.01:
                return "crowded"
        # neither the new lizard nor any same-species lizard near it may end up with more than
        # DISC_CAP same-species neighbours within DISC_M
        same = self.sp_xz[sp]
        if same:
            a = np.array(same)
            near = np.hypot(a[:, 0] - x, a[:, 1] - z) < DISC_M
            if near.sum() >= DISC_CAP[sp] or np.any(np.array(self.sp_nb[sp])[near] >= DISC_CAP[sp]):
                return "species_crowded"
        return None

    def inside_stem(self, x, z, pad):
        H = self.H
        for k in H.stem_tree.query_ball_point([x, z], 1.2):
            if math.hypot(x - H.sx[k], z - H.sz[k]) < H.sr[k] + pad:
                return True
        return False

    def clear_of_trunks_and_logs(self, x, z):
        if self.inside_stem(x, z, 0.05):
            return False
        for l in self.logs:
            if seg_dist(x, z, l["x"], l["z"], l["dx"], l["dz"], l["len"] / 2) < l["r"] + 0.08:
                return False
        return True

    # --- geometry of each mode --------------------------------------------------------------
    @staticmethod
    def nearest_stem(r, px, pz):
        ds = [math.hypot(px - a, pz - b) - rad for (a, b, rad, _) in r["stems"]]
        return r["stems"][int(np.argmin(ds))]

    def geom(self, j, mode, px, pz, hj, turn, rng):
        """Lizard position for host j in a mode, with the placement turned by `turn` radians.
        Returns (x, y, z, hag, ang, pose, collider) or None."""
        H, T = self.H, self.T
        r = H.rec[j]
        y0 = r["y0"]
        if mode in ("bark", "root"):
            a, b, rad, cidx = self.nearest_stem(r, px, pz)
            ux, uz, _ = unit(px - a, pz - b, rng)
            ux, uz = rotate(ux, uz, turn)
            lo, hi = r[mode]
            lo = max(lo, WATER_CLEAR_Y - y0) if T.over_water(a + ux * rad, b + uz * rad) else lo
            if lo > hi:
                return None
            hag = snap_height(hj, lo, hi)
            x, z = a + (rad + 0.01) * ux, b + (rad + 0.01) * uz
            return x, y0 + hag, z, hag, ang_of(ux, uz), "bark", cidx
        if mode == "branch":
            lo, hi = r["branch"]
            hag = snap_height(hj, lo, hi)
            if r["stems"] and hag < r["lo"]:
                # Below the crown there is nothing drawn out under it: the lizard lies on a short
                # stub branch STUB_M out from the bark of the nearest stem, facing out along it
                a, b, rad, cidx = self.nearest_stem(r, px, pz)
                ux, uz, _ = unit(px - a, pz - b, rng)
                ux, uz = rotate(ux, uz, turn)
                x, z = a + (rad + STUB_M) * ux, b + (rad + STUB_M) * uz
                if self.inside_stem(x, z, 0.03):
                    return None
                return x, y0 + hag, z, hag, ang_of(ux, uz), "flat", cidx
            if r["stems"]:
                ax_, az_ = r["x"], r["z"]
                dmin = max(rad for (_, _, rad, _) in r["stems"]) + 0.25
            else:
                ax_, az_, dmin = r["cx"], r["cz"], 0.0
            ux, uz, d0 = unit(px - ax_, pz - az_, rng)
            ux, uz = rotate(ux, uz, turn)
            k = 0.9 * self.profile(r, hag)
            tmax = ray_to_ellipse(ax_, az_, ux, uz, r["cx"], r["cz"], k * r["rx"], k * r["rz"])
            tmax = dmin if tmax is None else max(tmax, dmin)
            if not r["stems"]:
                # a bush or crown blob with no stem drawn: keep the lizard in its outer part,
                # where a player can see it, rather than deep inside the foliage
                dmin = 0.6 * tmax
            d = min(max(d0, dmin), tmax)
            x, z = ax_ + d * ux, az_ + d * uz
            if self.inside_stem(x, z, 0.03):
                return None
            return x, y0 + hag, z, hag, ang_of(ux, uz), "flat", None
        if mode == "leaf":
            lo, hi = r["leaf"]
            pad = 0.1 * (hi - lo)
            hag = snap_height(hj, lo + pad, hi - pad)
            ux, uz, _ = unit(px - r["cx"], pz - r["cz"], rng)
            ux, uz = rotate(ux, uz, turn)
            k = 0.95 * self.profile(r, hag)
            t = ray_to_ellipse(r["cx"], r["cz"], ux, uz, r["cx"], r["cz"], k * r["rx"], k * r["rz"]) or 0.0
            x, z = r["cx"] + t * ux, r["cz"] + t * uz
            if self.inside_stem(x, z, 0.03):
                return None
            return x, y0 + hag, z, hag, ang_of(ux, uz), "flat", None
        if mode == "frond":
            lo, hi = r["frond"]
            hag = snap_height(hj, lo, hi)
            ux, uz, d0 = unit(px - r["x"], pz - r["z"], rng)
            ux, uz = rotate(ux, uz, turn)
            R = 0.5 * (r["rx"] + r["rz"])
            d = min(max(d0, 0.5), max(0.85 * R, 0.5))
            x, z = r["x"] + d * ux, r["z"] + d * uz
            if self.inside_stem(x, z, 0.03):
                return None
            return x, y0 + hag, z, hag, ang_of(ux, uz), "flat", None
        if mode == "base":
            # On the ground at the foot of the host: beside its stem, or at the edge of its crown.
            # The check that follows requires ground the player can stand on (never thicket or
            # water), and y is that ground, kept just above the lake surface.
            if r["stems"]:
                a, b, rad, _ = self.nearest_stem(r, px, pz)
                ux, uz, _ = unit(px - a, pz - b, rng)
                ux, uz = rotate(ux, uz, turn)
                x, z = a + (rad + BASE_M) * ux, b + (rad + BASE_M) * uz
            else:
                ux, uz, _ = unit(px - r["cx"], pz - r["cz"], rng)
                ux, uz = rotate(ux, uz, turn)
                t = ray_to_ellipse(r["cx"], r["cz"], ux, uz, r["cx"], r["cz"], 0.85 * r["rx"], 0.85 * r["rz"]) or 0.0
                x, z = r["cx"] + t * ux, r["cz"] + t * uz
            if T.over_water(x, z) or not self.clear_of_trunks_and_logs(x, z):
                return None
            return x, max(T.height(x, z), 0.02), z, 0.0, ang_of(ux, uz), "flat", None
        return None

    @staticmethod
    def profile(r, hag):
        """Relative plan radius of the host's foliage at a height above its base."""
        if r["shape"] == "dome":
            return math.sqrt(max(1 - (hag / max(r["hi"], 1e-6)) ** 2, 0.09))
        mid, half = 0.5 * (r["lo"] + r["hi"]), max(0.5 * (r["hi"] - r["lo"]), 1e-6)
        return math.sqrt(max(1 - ((hag - mid) / half) ** 2, 0.09))

    def log_geom(self, li, px, pz, slide, rng):
        l = self.logs[li]
        half = max(l["len"] / 2 - 0.25, 0.0)
        t = float(np.clip((px - l["x"]) * l["dx"] + (pz - l["z"]) * l["dz"], -half, half))
        t = float(np.clip(t + slide, -half, half))
        x, z = l["x"] + t * l["dx"], l["z"] + t * l["dz"]
        hag = round(2 * l["r"], 2)
        ang = (l["rot"] - math.pi / 2) if rng.uniform() < 0.5 else (l["rot"] + math.pi / 2)
        return x, l["y"] + hag, z, hag, ang, "flat", None

    # --- one attempt at one observation -----------------------------------------------------
    def attempt(self, o, px, pz, hj, rng):
        """Try to place a lizard for a jittered point. Returns (spawn, info) or (None, reason)."""
        perch, sp = o["perch"], o["sp"]
        reasons = []

        def accept(g, host, mode, fallback, rank):
            x, y, z, hag, ang, pose, cidx = g
            ang = (ang + math.pi) % (2 * math.pi) - math.pi
            s = dict(sp=sp, sex=o["sex"], perch=perch, x=r2(x), y=r2(y), z=r2(z),
                     host=host, ang=r2(ang), hag=r2(hag), pose=pose)
            if cidx is not None and cidx >= 0:
                s["host"]["c"] = int(cidx)
            return s, dict(mode=mode, fallback=fallback, rank=rank)

        def try_variants(make, ground=False):
            last = None
            for v in range(VARIANTS):
                g = make(v)
                if g is None:
                    last = last or "no_fit"
                    continue
                if math.hypot(g[0] - px, g[2] - pz) > MAX_MOVE_M:
                    return None, "no_fit"
                why = self.check(r2(g[0]), r2(g[1]), r2(g[2]), ground, sp)   # as it will be written
                if why is None:
                    return g, None
                last = why
                if why in ("out_of_reach", "not_walkable", "water", "too_high") and v >= 2:
                    break
            return None, last

        def turn_of(v):
            return ((v + 1) // 2) * (math.pi / 8) * (1 if v % 2 else -1)

        # Ground: on walkable land at the point, or snapped onto it from just off it
        if perch == "ground":
            spots = []
            if self.T.is_walk(px, pz):
                spots.append((px, pz))
            else:
                q = self.T.nearest_walk(px, pz, GROUND_SNAP_M)
                if q is not None:
                    spots.append((q[0], q[1]))
            for (gx, gz) in spots:
                def make(v, gx=gx, gz=gz):
                    if v == 0:
                        x, z = gx, gz
                    else:
                        ox, oz = annulus(rng, 0.1, 0.35)
                        x, z = gx + ox, gz + oz
                    if not self.clear_of_trunks_and_logs(x, z):
                        return None
                    return x, self.T.height(x, z), z, 0.0, rng.uniform(-math.pi, math.pi), "flat", None
                g, why = try_variants(make, ground=True)
                if g is not None:
                    return accept(g, {"t": "ground", "i": -1}, "ground", False, 0)
                reasons.append(why)
            if not spots:
                reasons.append("not_walkable")

        # Logs
        if perch == "log" and self.logs:
            d = np.array([seg_dist(px, pz, l["x"], l["z"], l["dx"], l["dz"], l["len"] / 2) - l["r"]
                          for l in self.logs])
            for rank, li in enumerate(np.argsort(d)[:3]):
                if d[li] > SEARCH_M["log"]:
                    break
                if self.log_load[int(li)] >= LOG_CAP:
                    reasons.append("host_full")
                    continue
                g, why = try_variants(lambda v: self.log_geom(li, px, pz, turn_of(v), rng))
                if g is not None:
                    return accept(g, {"t": "log", "i": int(li)}, "log", False, rank)
                reasons.append(why)

        # Matching hosts, best first: in search range, not full, and fitting the recorded height
        H = self.H
        free = self.load < HOST_CAP
        tried = set()
        if perch in PRIMARY and perch != "log":
            mode, kinds = PRIMARY[perch]
            d, rho = H.plan_distance(px, pz, mode)
            dh = H.height_misfit(mode, hj)
            near = self.ok[perch] & (d <= SEARCH_M[perch])
            if np.any(near & ~free):
                reasons.append("host_full")
            if np.any(near & free & (dh > MAX_DH)):
                reasons.append("height_misfit")
            score = np.where(near & free & (dh <= MAX_DH), d + W_HEIGHT * dh + 0.15 * rho, np.inf)
            order = np.argsort(score)[:MAX_CANDIDATES]
            for rank, j in enumerate(order):
                if not np.isfinite(score[j]):
                    break
                tried.add((int(j), mode))
                g, why = try_variants(lambda v: self.geom(j, mode, px, pz, hj, turn_of(v), rng))
                if g is not None:
                    r = H.rec[j]
                    return accept(g, {"t": r["t"], "i": r["i"]}, mode, False, rank)
                reasons.append(why)

        # Fallback: the nearest free host of any kind that can carry the lizard near its recorded
        # height, placed in the first mode that host supports and that has not been tried on it
        # already (so a trunk lizard whose bark is all taken can still sit on a low branch of the
        # same tree)
        d_any = np.minimum(H.plan_distance(px, pz, "bark")[0], H.plan_distance(px, pz, "leaf")[0])
        cands = []
        for j in np.flatnonzero(d_any <= FALLBACK_M):
            if not free[j]:
                reasons.append("host_full")
                continue
            mode = next((m for m in FALLBACK_MODES[perch]
                         if H.supports(j, m) and (int(j), m) not in tried), None)
            if mode is None:
                continue
            dh = hj if mode == "base" else float(H.height_misfit(mode, hj)[j])
            if dh > MAX_DH:
                reasons.append("height_misfit")
                continue
            step = FALLBACK_MODES[perch].index(mode)
            cands.append((float(d_any[j]) + W_HEIGHT * dh + MODE_STEP_M * step, int(j), mode))
        for rank, (_, j, mode) in enumerate(sorted(cands)[:MAX_CANDIDATES]):
            g, why = try_variants(lambda v: self.geom(j, mode, px, pz, hj, turn_of(v), rng),
                                  ground=(mode == "base"))
            if g is not None:
                r = H.rec[j]
                return accept(g, {"t": r["t"], "i": r["i"]}, mode, True, rank)
            reasons.append(why)

        if not reasons:
            return None, "no_host_near"
        # The reason for the drop is the most telling one met: reach, then water, then the rest
        for key in ("out_of_reach", "not_walkable", "too_high", "water", "record_clash", "host_full",
                    "species_crowded", "crowded", "height_misfit", "no_fit"):
            if key in reasons:
                return None, key
        return None, reasons[0]

    def commit(self, s):
        self.placed_xyz.append([s["x"], s["y"], s["z"]])
        same, nb = self.sp_xz[s["sp"]], self.sp_nb[s["sp"]]
        near = [k for k, (a, b) in enumerate(same) if math.hypot(a - s["x"], b - s["z"]) < DISC_M]
        for k in near:
            nb[k] += 1
        same.append((s["x"], s["z"]))
        nb.append(len(near))
        t, i = s["host"]["t"], s["host"]["i"]
        if t == "log":
            self.log_load[i] += 1
        elif t != "ground":
            self.load[self.H.index[(t, i)]] += 1


# ----------------------------------------------------------------------------------------------
# 6. Sampling loop
# ----------------------------------------------------------------------------------------------

def build_spawns(obs, T, H, logs, rec_tree, rng):
    """Place each species in PLACE_ORDER. A first pass takes the stratified order and fills each
    perch up to its quota; if a perch runs out of records that can be placed, a second pass tops
    the species up from the records the first pass skipped, in the same order."""
    placer = Placer(T, H, logs, rec_tree)
    spawns, info = [], {}
    for sp in PLACE_ORDER:
        target = SPECIES[sp][1]
        pool = [o for o in obs if o["sp"] == sp]
        want = len(pool) if target is None else target
        order, quota = stratified_order(pool, want, rng)
        draws = DRAWS_RARE if sp in RARE else DRAWS_COMMON
        st = dict(drops=Counter(), modes=Counter(), by_perch=Counter(), fallback=0, farther=0,
                  used=0, redraws=0, pulled=0, lowered=0, n=0)

        def place_one(o):
            st["used"] += 1
            last = None
            lowered = sp in RARE and o["h"] > RARE_MAX_H
            for dnum in range(draws):
                jx, jz = annulus(rng, *JITTER_M)
                hj = round(o["h"] * (1 + rng.uniform(-HJITTER, HJITTER)) / HSTEP) * HSTEP
                if lowered:
                    hj = RARE_MAX_H
                px, pz = o["x"] + jx, o["z"] + jz
                s, meta = placer.attempt(o, px, pz, hj, rng)
                pulled = False
                if s is None and sp in RARE and meta == "out_of_reach":
                    # a rare record deep in the thicket: pulled in towards the nearest ground the
                    # player can stand on, so every record of a rare species can be caught
                    q = T.pull_into_reach(px, pz, RARE_PULL_M)
                    if q is not None and (q[0], q[1]) != (px, pz):
                        s, meta = placer.attempt(o, q[0], q[1], hj, rng)
                        pulled = s is not None
                if s is not None:
                    placer.commit(s)
                    spawns.append(s)
                    st["n"] += 1
                    st["by_perch"][o["perch"]] += 1
                    st["modes"][meta["mode"]] += 1
                    st["fallback"] += meta["fallback"]
                    st["farther"] += meta["rank"] > 0
                    st["redraws"] += dnum
                    st["pulled"] += pulled
                    st["lowered"] += lowered
                    return
                last = meta
            st["drops"][last] += 1

        skipped = []
        for o in order:                                   # pass 1: each perch up to its quota
            if st["n"] >= want:
                break
            if st["by_perch"][o["perch"]] >= quota[o["perch"]]:
                skipped.append(o)
                continue
            place_one(o)
        n_first = st["n"]
        for o in skipped:                                 # pass 2: top up from what pass 1 skipped
            if st["n"] >= want:
                break
            place_one(o)
        info[sp] = dict(pool=len(pool), target=want, observations_used=st["used"], placed=st["n"],
                        perch_quota={p_: quota[p_] for p_ in PERCHES if p_ in quota},
                        perch_placed={p_: st["by_perch"][p_] for p_ in PERCHES if p_ in quota},
                        topped_up=st["n"] - n_first, dropped=dict(st["drops"]),
                        fallback_host=st["fallback"], next_best_host=st["farther"],
                        extra_draws=st["redraws"], pulled_into_reach=st["pulled"],
                        lowered_to_reach=st["lowered"], modes=dict(st["modes"]))
    return spawns, {sp: info[sp] for sp in SPECIES}


# ----------------------------------------------------------------------------------------------
# 7. Output
# ----------------------------------------------------------------------------------------------

def write_json(spawns, logs, info, loginfo, counts, n_rows, skipped, min_rec, rng):
    order = rng.permutation(len(spawns))
    spawns = [spawns[k] for k in order]
    species = {}
    for sp, (common, _, rarity) in SPECIES.items():
        species[sp] = {"common": common, "obs": int(counts[sp]), "share": round(counts[sp] / n_rows, 4),
                       "rarity": rarity, "spawns": sum(1 for s in spawns if s["sp"] == sp)}
    perch_counts = {sp: {p: sum(1 for s in spawns if s["sp"] == sp and s["perch"] == p) for p in PERCHES}
                    for sp in SPECIES}
    host_counts = {sp: dict(Counter(s["host"]["t"] for s in spawns if s["sp"] == sp)) for sp in SPECIES}
    qs = [0.05, 0.25, 0.5, 0.75, 0.95]
    hq = {}
    for sp in SPECIES:
        h = np.array([s["hag"] for s in spawns if s["sp"] == sp])
        hq[sp] = {f"p{int(q * 100):02d}": r2(np.quantile(h, q)) for q in qs} | {"max": r2(h.max())}
    stats = {
        "spawns": len(spawns),
        "by_species": {sp: species[sp]["spawns"] for sp in SPECIES},
        "perch_counts": perch_counts,
        "host_counts": host_counts,
        "hag_quantiles_m": hq,
        "sampling": info,
        "observations_left_out": dict(skipped),
        "logs": loginfo,
        "min_distance_to_any_observation_m": round(float(min_rec), 3),
        "reach_m": REACH_M,
        "max_above_standing_ground_m": MAX_ABOVE_GROUND_M,
        "max_height_misfit_m": MAX_DH,
        "caps": {"per_host": HOST_CAP, "per_log": LOG_CAP, "same_species_within_m": DISC_M,
                 "same_species_neighbours": DISC_CAP},
        "jitter": {"horizontal_m": list(JITTER_M), "height_frac": HJITTER, "height_step_m": HSTEP},
    }
    notes = ("Spawn x, y, z is the lizard body where it touches its perch, in the game frame. "
             "host.t names the list in placements.json (landmarks, plants, clumps rows), the logs list "
             "here, or the ground (i = -1); host.c, where given, indexes colliders.json circles: the "
             "stem the lizard clings to, or the stem its stub branch grows from. hag is the height above "
             "the host's base (the host's own y, the ground or water surface it stands on). Lizards at "
             "ground level (host ground, or on the ground at the foot of a host) have hag 0 and y on the "
             "terrain, which can differ from the host's y by a few centimetres; they always stand on "
             "walkable ground outside every collider. ang follows the terrain start heading: direction "
             "(-sin ang, 0, -cos ang), 0 = north (-z), positive towards west (-x), as three.js "
             "rotation.y. " + POSE_NOTE + ". "
             "Clinging lizards sit on a stem of radius dbh / 2 without taper. A flat lizard with host.c "
             "set lies on a short stub branch %.1f m out from that stem's bark, below the host's crown: "
             "draw the stub from the stem out to the lizard. Leaf lizards sit just inside the host's "
             "foliage surface, modelled as an ellipsoid over the crown zone (landmarks: crown_base to "
             "height over crown_w_ew by crown_w_ns about crown_x, crown_z; plants and clumps: a disc of "
             "their width), or a dome from the ground for bushes, ground shrubs, shrubs and herbs. Branch "
             "lizards within the crown sit on a branch running out from the host axis along ang; in a "
             "host with no stem (bush, shrub, canopy puff) they sit in the outer part of the foliage. "
             "Understorey and mangrove clumps are taken to stand on one short stem at their x, z. "
             "perch is the perch class the lizard was recorded on; where no host of the matching kind "
             "was near, free, in the loop pole's reach and clear of the records (no lizard sits within 0.2 m of "
             "any record), the lizard sits on the nearest host that fits its recorded height, so a "
             "trunk lizard may lie flat on a low branch or in a bush: pose and host say how to draw it. "
             "Sampling: each species is stratified by perch in proportion to its records, going round "
             "the marked individuals inside each perch; the rare species (bark and knight anoles) "
             "use every record, a record out of reach being pulled in towards the nearest walkable "
             "ground and one perched above %.1f m brought down to that height. Every lizard is within "
             "%.1f m (plan) of ground the player can stand on and at most %.1f m above it, its height "
             "is within %.2f m of the record's, a host carries at most %d lizards, and no lizard has "
             "more than its species' cap of same-species neighbours within %.0f m (stats.caps). "
             "species.spawns counts this table. Logs: x, y, z is the ground under the middle of the "
             "log; the log is horizontal with its axis at y + r, along (cos rot, 0, -sin rot), that is "
             "a cylinder built along +x and turned by rotation.y = rot; logs lie on nearly level "
             "walkable ground (within %.2f m along their length). Perch names: " % (
                 STUB_M, RARE_MAX_H, REACH_M, MAX_ABOVE_GROUND_M, MAX_DH, HOST_CAP, DISC_M, LOG_MAX_OFFSET_M)
             + ", ".join(PERCHES) + ". Sex: m, f, or u where the record has none. Rarity follows each "
             "species' share of the observations.")
    out = {"frame": FRAME, "species": species, "spawns": spawns,
           "logs": [{"x": r2(l["x"]), "y": r2(l["y"]), "z": r2(l["z"]), "len": r2(l["len"]),
                     "r": r2(l["r"]), "rot": r2(l["rot"])} for l in logs],
           "stats": stats, "notes": notes}
    with open(DATA / "spawns.json", "w") as f:
        json.dump(out, f, separators=(",", ":"), allow_nan=False)
    return out


# ----------------------------------------------------------------------------------------------
# 8. Quicklook
# ----------------------------------------------------------------------------------------------

SP_COL = {"cristatellus": "#c0612b", "sagrei": "#7a5230", "carolinensis": "#3f9b3a",
          "distichus": "#6e6e9e", "equestris": "#d4b21f"}
HOST_MARK = {"landmark": "o", "plant": "s", "clump": "D", "log": "P", "ground": "v"}


def draw_north_and_scale(ax, x, y, bar=20, k=1.0):
    ax.add_patch(MplPolygon([[x, y + 5 * k], [x - 1.6 * k, y + 0.8 * k], [x + 1.6 * k, y + 0.8 * k]],
                            closed=True, color="#222222", zorder=20))
    ax.text(x, y - 1.0 * k, "N", ha="center", va="top", fontsize=10, weight="bold", zorder=20)
    sx, sy = x - bar - 5 * k, y
    ax.plot([sx, sx + bar], [sy, sy], color="#222222", lw=3, solid_capstyle="butt", zorder=20)
    ax.text(sx + bar / 2, sy + 1.5, f"{bar} m", ha="center", va="bottom", fontsize=9, zorder=20)


def quicklook(out, T, H):
    CHECK.mkdir(exist_ok=True)
    fig = plt.figure(figsize=(22, 10.5))
    gs = fig.add_gridspec(2, 2, width_ratios=[2.2, 1], hspace=0.55, wspace=0.14)
    ax = fig.add_subplot(gs[:, 0])
    # Background classes: lake, other land, thicket, walkable
    cls = np.full(T.y.shape, 1, np.uint8)
    cls[T.water] = 0
    cls[T.thicket] = 2
    cls[T.walk] = 3
    cmap = ListedColormap(["#bcd6ea", "#e4dfcc", "#9dbb86", "#eef3dc"])
    c = T.cell
    ext = [T.x0 - c / 2, T.x0 + (T.cols - 0.5) * c, -(T.z0 + (T.rows - 0.5) * c), -(T.z0 - c / 2)]
    ax.imshow(cls, extent=ext, cmap=cmap, vmin=0, vmax=3, interpolation="nearest", zorder=0)
    for lm in H.P["landmarks"]:
        ax.plot(lm["x"], -lm["z"], marker="^", color="#333333", ms=4, zorder=3)
    for l in out["logs"]:
        dx, dz = math.cos(l["rot"]), -math.sin(l["rot"])
        ax.plot([l["x"] - dx * l["len"] / 2, l["x"] + dx * l["len"] / 2],
                [-(l["z"] - dz * l["len"] / 2), -(l["z"] + dz * l["len"] / 2)],
                color="#6b4a2b", lw=3.2, solid_capstyle="round", zorder=4)
    for sp in SPECIES:
        for t, mk in HOST_MARK.items():
            ss = [s for s in out["spawns"] if s["sp"] == sp and s["host"]["t"] == t]
            if ss:
                big = sp in RARE
                ax.scatter([s["x"] for s in ss], [-s["z"] for s in ss], marker=mk, s=26 if big else 11,
                           color=SP_COL[sp], edgecolor="k" if big else "none", linewidth=0.5,
                           alpha=0.9, zorder=6 if big else 5)
    st = T.start
    ax.plot(st["x"], -st["z"], marker="*", color="#b03a2e", ms=13, zorder=7)
    ax.text(st["x"] + 1.5, -st["z"] - 0.5, "Start", fontsize=9, zorder=8)
    # the causeway label on the strip, turned along it (garden end to island end)
    cw = T.meta["stats"]["causeway"]
    g_, i_ = cw["garden_end"], cw["island_end"]
    ax.text(0.5 * (g_["x"] + i_["x"]), -0.5 * (g_["z"] + i_["z"]), "Causeway", fontsize=9,
            rotation=math.degrees(math.atan2(-(i_["z"] - g_["z"]), i_["x"] - g_["x"])),
            rotation_mode="anchor", ha="center", va="center", zorder=8)
    ax.text(45, 5, "Lawn", fontsize=11, ha="center", zorder=8)
    ax.text(42, -30, "Mangrove fringe", fontsize=10, ha="center", zorder=8)
    ax.text(-48, 38, "Lake", fontsize=11, color="#1f4e79", zorder=8)
    draw_north_and_scale(ax, 67, -41, k=0.75)
    ax.set_xlim(-55, 72); ax.set_ylim(-45, 45); ax.set_aspect("equal")
    ax.set_xlabel("x = E - 573150 (m)"); ax.set_ylabel("north = -z (m)")
    handles = [plt.Line2D([], [], marker="o", ls="", color=SP_COL[sp], ms=7,
                          label=f"{SPECIES[sp][0]} ({out['species'][sp]['spawns']})") for sp in SPECIES]
    handles += [plt.Line2D([], [], marker=mk, ls="", color="#555555", ms=6, label=f"on {t}")
                for t, mk in HOST_MARK.items()]
    handles += [plt.Line2D([], [], color="#6b4a2b", lw=3, label=f"log prop ({len(out['logs'])})"),
                plt.Line2D([], [], marker="s", ls="", color="#eef3dc", mec="#999999", ms=9, label="walkable"),
                plt.Line2D([], [], marker="s", ls="", color="#9dbb86", ms=9, label="thicket"),
                plt.Line2D([], [], marker="^", ls="", color="#333333", ms=6, label="landmark trunk")]
    ax.legend(handles=handles, loc="lower left", fontsize=8.5, framealpha=0.92)
    ax.set_title(f"{len(out['spawns'])} lizard spawns by species and host (no observation positions shown)")

    # Perch mix per species
    a1 = fig.add_subplot(gs[0, 1])
    pc = out["stats"]["perch_counts"]
    sps = list(SPECIES)
    left = np.zeros(len(sps))
    pcol = plt.get_cmap("tab10")
    for k, p in enumerate(PERCHES):
        v = np.array([pc[sp][p] / max(1, out["species"][sp]["spawns"]) for sp in sps])
        a1.barh(range(len(sps)), v, left=left, color=pcol(k), label=p.replace("_", " "))
        left += v
    a1.set_yticks(range(len(sps)))
    a1.set_yticklabels([f"{SPECIES[s][0]} ({out['species'][s]['spawns']})" for s in sps], fontsize=9)
    a1.invert_yaxis(); a1.set_xlim(0, 1); a1.set_xlabel("share of spawns")
    a1.legend(fontsize=7.5, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.2), frameon=False)
    a1.set_title("Perch mix per species")

    # Heights per species
    a2 = fig.add_subplot(gs[1, 1])
    data = [[s["hag"] for s in out["spawns"] if s["sp"] == sp] for sp in sps]
    bp = a2.boxplot(data, orientation="horizontal", widths=0.6, patch_artist=True, showfliers=True,
                    flierprops=dict(marker=".", ms=3, alpha=0.5))
    for patch, sp in zip(bp["boxes"], sps):
        patch.set_facecolor(SP_COL[sp]); patch.set_alpha(0.7)
    a2.set_yticks(range(1, len(sps) + 1)); a2.set_yticklabels([SPECIES[s][0] for s in sps], fontsize=9)
    a2.invert_yaxis(); a2.set_xlabel("height above ground at the host (m)")
    a2.set_title("Perch heights per species")
    fig.savefig(CHECK / "spawns_quicklook.png", dpi=110, bbox_inches="tight")
    plt.close(fig)


# ----------------------------------------------------------------------------------------------

def main():
    rng = np.random.default_rng(SEED)
    T = Terrain()
    H = Hosts()
    obs, all_xz, counts, n_rows, skipped = load_observations()
    rec_tree = cKDTree(all_xz)
    logs, loginfo = build_logs(obs, T, H, rec_tree, rng)
    spawns, info = build_spawns(obs, T, H, logs, rec_tree, rng)

    # The 0.2 m rule, checked again on the rounded output (spawns and log centres)
    sxz = np.array([[s["x"], s["z"]] for s in spawns])
    min_rec = float(rec_tree.query(sxz)[0].min())
    lxz = np.array([[round(l["x"], 2), round(l["z"], 2)] for l in logs])
    min_log = float(rec_tree.query(lxz)[0].min()) if len(lxz) else float("nan")
    assert min_rec >= 0.2 and (not len(lxz) or min_log >= 0.2)
    # Lizards on the ground (ground hosts, and the foot of a host) where the player can stand,
    # the rest in reach and not too high, none in the water, no host over its cap
    for s in spawns:
        if s["host"]["t"] == "ground" or (s["hag"] == 0.0 and s["host"]["t"] != "log"):
            assert T.is_walk(s["x"], s["z"]) and s["y"] >= 0.02
        d, gy = T.reach(s["x"], s["z"])
        assert d <= REACH_M + 0.01 and s["y"] - gy <= MAX_ABOVE_GROUND_M + 0.01
        assert not (T.over_water(s["x"], s["z"]) and s["y"] < WATER_CLEAR_Y - 0.01)
    per_host = Counter((s["host"]["t"], s["host"]["i"]) for s in spawns if s["host"]["t"] != "ground")
    assert max(per_host.values()) <= HOST_CAP

    out = write_json(spawns, logs, info, loginfo, counts, n_rows, skipped, min_rec, rng)
    quicklook(out, T, H)

    print(f"observations {n_rows}; left out {dict(skipped)}")
    print(f"logs: {loginfo['log_observations']} log observations in {loginfo['clusters']} clusters, "
          f"{loginfo['logs']} logs placed, {loginfo['clusters_without_log']} clusters without one; "
          f"sizes {loginfo['cluster_sizes']}")
    for sp, v in info.items():
        print(f"{sp:13s} pool {v['pool']:5d} target {v['target']:4d} used {v['observations_used']:5d} "
              f"placed {v['placed']:4d} (topped up {v['topped_up']}, pulled into reach "
              f"{v['pulled_into_reach']}) dropped {v['dropped']} fallback {v['fallback_host']} "
              f"next best {v['next_best_host']} extra draws {v['extra_draws']}")
    s = out["stats"]
    print(f"spawns {s['spawns']}: {s['by_species']}")
    for sp in SPECIES:
        print(f"  {sp:13s} perches {s['perch_counts'][sp]}")
        print(f"  {'':13s} hosts {s['host_counts'][sp]}  hag {s['hag_quantiles_m'][sp]}")
    print(f"min distance to any observation: spawns {min_rec:.3f} m, log centres {min_log:.3f} m")
    print(f"spawns.json {(DATA / 'spawns.json').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
