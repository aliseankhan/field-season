"""The survey's stake lattice for the Lizard Island game: grid flags and logger spots.

The lab marks the island with a lattice of stakes 5 m apart, lettered A to X from west to
east and numbered 01 to 13 from south to north (so "C07" is column C, row 07). The game
uses them on the set-up day: the player plants a grid flag on a dozen of them and ties a
temperature logger to five of those. This script turns the stake list into the game frame,
says which stakes stand on or beside ground the player can walk on, and picks the targets.

Reads (read only):
    LizardIsland_2025_walkthrough_cleaned/data/grid.json   [id, E, N, site] per stake
    data/terrain.json with terrain_height.u16, terrain_mask.u8, terrain_canopy.u8
    data/colliders.json, data/placements.json               trunks, bushes and shrubs

Writes:
    data/stakes.json

Game frame (metres, y up): x = E - 573150, z = -(N - 2840100), y = h + 24.90 read from the
terrain height grid at the stake (bilinear on the cell centres, as data.js samples it).

Target choice, all deterministic (no randomness at all):
  - a candidate stands on walkable ground, at least 0.5 m from any collider circle, 1 m
    from thicket, clear of bushes and shrubs, 2 m from water, with a free spot within
    1.2 m where the player can stand;
  - twelve flag targets by farthest-point sampling over the candidates, starting from the
    candidate nearest the top of the causeway, so they spread over the whole island;
  - five logger targets among those twelve, spanning the microclimate: the sunniest, the
    shadiest, the one nearest water, then the two that add the most spread;
  - both lists are ordered as a nearest-neighbour walk from the causeway top.

Run from the game folder:
    python3 preprocess/stakes.py
"""

import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent
DATA = GAME / "data"
GRID = OUT / "LizardIsland_2025_walkthrough_cleaned" / "data" / "grid.json"

E0, N0, H0 = 573150.0, 2840100.0, -24.90
FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.90,
         "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}

N_FLAGS = 12
N_LOGGERS = 5
CAUSEWAY_TOP = (-13.5, 20.75)  # where the causeway meets the island (data/README.md)

# candidate rules, metres
CLEAR_COLLIDER = 0.5  # stake to the edge of any collider circle
CLEAR_THICKET = 1.0
CLEAR_WATER = 2.0
STAND_REACH = 1.2  # a free standing spot within this of the stake
PLAYER_R = 0.28  # the player's body radius against bush circles (config.js)
BUSH_TYPES = {"ground_shrub", "bush", "understorey_tree"}


class Terrain:
    def __init__(self):
        t = json.loads((DATA / "terrain.json").read_text())
        self.t = t
        self.cell, self.cols, self.rows = t["cell"], t["cols"], t["rows"]
        self.x0, self.z0 = t["x0"], t["z0"]
        hv = np.fromfile(DATA / t["height"]["file"], dtype="<u2").reshape(self.rows, self.cols)
        self.height = t["height"]["offset"] + hv.astype(np.float64) * t["height"]["scale"]
        self.mask = np.fromfile(DATA / t["mask"]["file"], dtype=np.uint8).reshape(self.rows, self.cols)
        cv = np.fromfile(DATA / t["canopy"]["file"], dtype=np.uint8).reshape(self.rows, self.cols)
        self.canopy = cv.astype(np.float64) * t["canopy"]["scale"]
        self.bits = t["mask"]["bits"]
        b = self.bits
        self.walkable = (self.mask & b["walkable"]) != 0
        self.thicket = (self.mask & b["thicket"]) != 0
        self.water = (self.mask & b["water"]) != 0
        # metres from each cell to the nearest cell of a kind
        self.d_walk = ndimage.distance_transform_edt(~self.walkable) * self.cell
        self.d_thicket = ndimage.distance_transform_edt(~self.thicket) * self.cell
        self.d_water = ndimage.distance_transform_edt(~self.water) * self.cell

    def rc(self, x, z):
        c = int(math.floor((x - self.x0) / self.cell + 0.5))
        r = int(math.floor((z - self.z0) / self.cell + 0.5))
        return min(max(r, 0), self.rows - 1), min(max(c, 0), self.cols - 1)

    def height_at(self, x, z):
        """Bilinear on the cell-centre lattice, clamped, as data.js does."""
        fc = min(max((x - self.x0) / self.cell, 0), self.cols - 1)
        fr = min(max((z - self.z0) / self.cell, 0), self.rows - 1)
        c = min(int(math.floor(fc)), self.cols - 2)
        r = min(int(math.floor(fr)), self.rows - 2)
        tx, tz = fc - c, fr - r
        h = self.height
        a = h[r, c] + (h[r, c + 1] - h[r, c]) * tx
        bb = h[r + 1, c] + (h[r + 1, c + 1] - h[r + 1, c]) * tx
        return a + (bb - a) * tz

    def mean_canopy(self, x, z, radius=2.0):
        r, c = self.rc(x, z)
        k = int(math.ceil(radius / self.cell))
        rr, cc = np.mgrid[-k:k + 1, -k:k + 1]
        inside = (rr * rr + cc * cc) * self.cell ** 2 <= radius * radius
        r0, c0 = r - k, c - k
        win = self.canopy[max(r0, 0):r + k + 1, max(c0, 0):c + k + 1]
        m = inside[max(0, -r0):max(0, -r0) + win.shape[0], max(0, -c0):max(0, -c0) + win.shape[1]]
        return float(win[m].mean())


def where_on(T, x, z):
    r, c = T.rc(x, z)
    m = int(T.mask[r, c])
    b = T.bits
    if m & b["walkable"]:
        return "walkable"
    if m & b["thicket"]:
        return "thicket"
    if m & b["water"]:
        return "water"
    return "land"


def r2(v):
    return round(float(v), 2)


def main():
    T = Terrain()
    grid = json.loads(GRID.read_text())
    circles = np.array(json.loads((DATA / "colliders.json").read_text())["circles"], float)
    plac = json.loads((DATA / "placements.json").read_text())
    ctypes = plac["clumps"]["types"]
    fields = plac["clumps"]["fields"]
    ix, iz, iw, it = (fields.index(k) for k in ("x", "z", "w", "type"))
    bushes = np.array([[row[ix], row[iz], row[iw] / 2] for row in plac["clumps"]["rows"]
                       if ctypes[row[it]] in BUSH_TYPES], float)
    shrubs = np.array([[p["x"], p["z"], (p.get("crown_w") or 0.6) / 2] for p in plac["plants"]
                       if p["form"] in ("shrub", "herb")], float)
    soft = np.vstack([bushes, shrubs]) if len(shrubs) else bushes

    def free_spot(x, z):
        """True when the player could stand here: walkable, off every circle."""
        r, c = T.rc(x, z)
        if not T.walkable[r, c]:
            return False
        d = np.hypot(circles[:, 0] - x, circles[:, 1] - z) - circles[:, 2]
        return bool(d.min() > PLAYER_R)

    def stand_near(x, z):
        """The nearest free standing spot within STAND_REACH, searched on rings."""
        if free_spot(x, z):
            return (x, z)
        for rad in np.arange(0.25, STAND_REACH + 1e-6, 0.25):
            n = max(8, int(2 * math.pi * rad / 0.2))
            best = None
            for k in range(n):
                a = 2 * math.pi * k / n
                px, pz = x + rad * math.cos(a), z + rad * math.sin(a)
                if free_spot(px, pz):
                    best = (px, pz)
                    break
            if best:
                return best
        return None

    stakes = []
    cand = []
    for sid, E, N, site in grid:
        x, z = E - E0, -(N - N0)
        on = where_on(T, x, z)
        r, c = T.rc(x, z)
        y = T.height_at(x, z)
        walk_d = float(T.d_walk[r, c])
        canopy = T.mean_canopy(x, z)
        water_d = float(T.d_water[r, c])
        d_col = float((np.hypot(circles[:, 0] - x, circles[:, 1] - z) - circles[:, 2]).min())
        d_soft = float((np.hypot(soft[:, 0] - x, soft[:, 1] - z) - soft[:, 2]).min()) if len(soft) else 99.0
        stand = stand_near(x, z) if walk_d <= STAND_REACH else None
        rec = {
            "id": sid, "x": r2(x), "y": r2(y), "z": r2(z), "site": bool(site), "on": on,
            "walk": r2(walk_d), "canopy": r2(canopy), "water": r2(min(water_d, 99)),
            "reach": stand is not None,
        }
        if stand is not None:
            rec["stand"] = [r2(stand[0]), r2(stand[1])]
        stakes.append(rec)
        ok = (on == "walkable" and stand is not None and d_col >= CLEAR_COLLIDER
              and float(T.d_thicket[r, c]) >= CLEAR_THICKET and d_soft >= 0.3 and water_d >= CLEAR_WATER)
        if ok:
            cand.append(len(stakes) - 1)

    if len(cand) < N_FLAGS:
        raise SystemExit(f"only {len(cand)} candidate stakes, need {N_FLAGS}")

    P = np.array([[stakes[i]["x"], stakes[i]["z"]] for i in cand])
    # farthest-point sampling from the candidate nearest the causeway top
    d0 = np.hypot(P[:, 0] - CAUSEWAY_TOP[0], P[:, 1] - CAUSEWAY_TOP[1])
    chosen = [int(np.argmin(d0))]
    dmin = np.hypot(P[:, 0] - P[chosen[0], 0], P[:, 1] - P[chosen[0], 1])
    while len(chosen) < N_FLAGS:
        j = int(np.argmax(dmin))
        chosen.append(j)
        dmin = np.minimum(dmin, np.hypot(P[:, 0] - P[j, 0], P[:, 1] - P[j, 1]))
    flag_idx = [cand[j] for j in chosen]

    # loggers: the sunniest, the shadiest, the nearest water, then the most spread
    fl = [stakes[i] for i in flag_idx]
    picks = []
    for key, rev in (("canopy", False), ("canopy", True), ("water", False)):
        order = sorted(range(len(fl)), key=lambda k: (fl[k][key], fl[k]["id"]), reverse=rev)
        for k in order:
            if k not in picks:
                picks.append(k)
                break
    while len(picks) < N_LOGGERS:
        best, best_d = None, -1
        for k in range(len(fl)):
            if k in picks:
                continue
            d = min(math.hypot(fl[k]["x"] - fl[p]["x"], fl[k]["z"] - fl[p]["z"]) for p in picks)
            if d > best_d:
                best, best_d = k, d
        picks.append(best)
    logger_ids = {fl[k]["id"] for k in picks}

    # a nearest-neighbour walk from the causeway top orders both lists
    left = list(range(len(fl)))
    px, pz = CAUSEWAY_TOP
    tour = []
    walk_len = 0.0
    while left:
        k = min(left, key=lambda k: (math.hypot(fl[k]["x"] - px, fl[k]["z"] - pz), fl[k]["id"]))
        walk_len += math.hypot(fl[k]["x"] - px, fl[k]["z"] - pz)
        tour.append(fl[k]["id"])
        px, pz = fl[k]["x"], fl[k]["z"]
        left.remove(k)
    loggers = [sid for sid in tour if sid in logger_ids]

    counts = {
        "stakes": len(stakes),
        "on_walkable": sum(s["on"] == "walkable" for s in stakes),
        "reachable": sum(s["reach"] for s in stakes),
        "in_water": sum(s["on"] == "water" for s in stakes),
        "in_thicket": sum(s["on"] == "thicket" for s in stakes),
        "candidates": len(cand),
        "site_stakes": sum(s["site"] for s in stakes),
    }
    out = {
        "frame": FRAME,
        "source": "the survey's 5 m stake lattice (220 stakes), lettered A to X west to east, numbered 01 to 13 south to north",
        "fields": {
            "id": "stake label, column letter and row number",
            "x, y, z": "the stake's foot in the game frame; y from the terrain height grid",
            "site": "the stake is marked as a site in the survey's stake list",
            "on": "walkable, thicket, water or land (land the player cannot reach, such as a far bank or an islet)",
            "walk": "metres to the nearest walkable cell (0 on walkable ground)",
            "canopy": "mean vegetation height over the ground within 2 m, metres",
            "water": "metres to the nearest water cell",
            "reach": "a free spot where the player can stand lies within 1.2 m",
            "stand": "that spot [x, z], when reach is true",
        },
        "stakes": stakes,
        "targets": {"flags": tour, "loggers": loggers},
        "stats": {**counts, "flag_walk_m": r2(walk_len)},
        "notes": ("Targets are candidates on walkable ground clear of trunks, bushes, thicket and "
                  "water, picked by farthest-point sampling from the causeway top; loggers span "
                  "sun, shade and water among them. Both lists follow a nearest-neighbour walk."),
    }
    (DATA / "stakes.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))

    print(f"stakes: {counts}")
    print(f"flag targets ({len(tour)}): {' '.join(tour)}; walk from the causeway {walk_len:.0f} m")
    for sid in loggers:
        s = next(s for s in stakes if s["id"] == sid)
        print(f"  logger {sid}: canopy {s['canopy']:.1f} m, water {s['water']:.1f} m")
    print(f"wrote {DATA / 'stakes.json'} ({(DATA / 'stakes.json').stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
