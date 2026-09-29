"""The laser scanner's positions for the Lizard Island game: the TLS mission's scan spots.

In October 2025 the lab scanned the island with a RIEGL terrestrial laser scanner on a
tripod from 88 scan positions: a rough 10 m walk over the island, round its mangrove
fringe and from the far banks of the lake. The game's TLS mission sends the player to a
few of them to set the scanner down, level it and scan. This script turns the positions
into the game frame, keeps the ones on or next to ground the player can walk on (snapped
to a free spot where a tripod stands), and picks the mission's scan spots.

Reads (read only):
    LizardIsland_2025_walkthrough_cleaned/data/scanners.json   [id, E, N] per scan position (87)
    LizardIsland_2025_scanpos031/scanpos031_position.csv       ScanPos031, recovered later (the 88th)
    data/terrain.json with terrain_height.u16, terrain_mask.u8, terrain_canopy.u8
    data/colliders.json, data/placements.json                  trunks, bushes, landmark names

Writes:
    data/scanpos.json

Game frame (metres, y up): x = E - 573150, z = -(N - 2840100), y = h + 24.90 read from the
terrain height grid at the spot (bilinear on the cell centres, as data.js samples it).

Rules, all deterministic (no randomness at all):
  - a position is kept when it lies within KEEP_REACH of walkable ground and a free tripod
    spot (walkable, clear of every collider circle by TRIPOD_CLEAR) lies within KEEP_REACH;
    it is then drawn at that spot (`x`, `z`), with the surveyed spot's offset in `moved`;
    the far-bank positions and those deep in the mangrove water are left out;
  - a mission candidate also stands 2.5 m from water, 1 m from thicket and 1.2 m from any
    collider circle, off the causeway, with cover within 2.5 to 9 m (trunks and bushes a
    player can duck behind) and trees round about (the cloud has something to show);
  - MISSION spots by farthest-point sampling over the candidates, starting from the
    candidate nearest the causeway top, weighted towards those with more cover, then
    ordered as a nearest-neighbour walk from the causeway top;
  - each mission spot gets a friendly place name from the nearest named landmark within
    11 m that no earlier spot took ("by the rainbow eucalyptus"), else the part of the
    island it is in.

Run from the game folder:
    python3 preprocess/scanpos.py
"""

import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent
DATA = GAME / "data"
SCANNERS = OUT / "LizardIsland_2025_walkthrough_cleaned" / "data" / "scanners.json"
# ScanPos031's file turned up after the walk-through was made, so its position comes from
# the recovery work. It is kept as a position but never made a mission spot, so the
# mission's scan spots stay where they were.
SCANPOS031 = OUT / "LizardIsland_2025_scanpos031" / "scanpos031_position.csv"

E0, N0, H0 = 573150.0, 2840100.0, -24.90
FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.90,
         "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}

MISSION = 8
CAUSEWAY_TOP = (-13.5, 20.75)  # where the causeway meets the island (data/README.md)

KEEP_REACH = 2.5  # m: a kept position lies this near walkable ground and a free tripod spot
TRIPOD_CLEAR = 0.75  # m: tripod spot to the edge of any collider circle (legs 0.45 m out)
CAND_CLEAR = 1.2  # m: a mission spot to the edge of any collider circle
CAND_WATER = 2.5
CAND_THICKET = 1.0
COVER_NEAR, COVER_FAR = 2.5, 9.0  # m: the ring round a spot where cover counts
COVER_R = 0.25  # m: a circle this wide or wider is cover (a trunk or a bush core)
PLACE_REACH = 11.0  # m: a named landmark this near names the spot

# friendly names of the landmarks (placements.json `kind` first, then `name`)
KIND_NAMES = {"rainbow_eucalyptus": "the rainbow eucalyptus", "talipot": "the talipot palms",
              "osprey_pole": "the osprey pole"}
NAME_NAMES = {"Puerto Rico hat palm": "the hat palms", "pink poui": "the pink poui",
              "pitch apple": "the pitch apple", "sea hibiscus": "the sea hibiscus",
              "sea grape": "the sea grapes", "buttonwood": "the buttonwood",
              "Madagascar olive": "the Madagascar olive", "talipot palm": "the talipot palms",
              "rainbow eucalyptus": "the rainbow eucalyptus"}


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
        b = t["mask"]["bits"]
        self.bits = b
        self.walkable = (self.mask & b["walkable"]) != 0
        self.thicket = (self.mask & b["thicket"]) != 0
        self.water = (self.mask & b["water"]) != 0
        self.causeway = (self.mask & b["causeway"]) != 0
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

    def mean_canopy(self, x, z, radius):
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
        return "causeway" if m & b["causeway"] else "walkable"
    if m & b["thicket"]:
        return "thicket"
    if m & b["water"]:
        return "water"
    return "land"


def r2(v):
    return round(float(v), 2)


def main():
    T = Terrain()
    scanners = json.loads(SCANNERS.read_text())
    late = set()
    if not any(s[0] == "ScanPos031" for s in scanners):
        head, row = SCANPOS031.read_text().strip().splitlines()[:2]
        rec = dict(zip(head.split(","), row.split(",")))
        scanners = sorted(scanners + [[rec["scan"], float(rec["E"]), float(rec["N"])]], key=lambda s: s[0])
        late.add(rec["scan"])
    circles = np.array(json.loads((DATA / "colliders.json").read_text())["circles"], float)
    plac = json.loads((DATA / "placements.json").read_text())
    landmarks = plac["landmarks"]

    def clear_of_circles(x, z):
        return float((np.hypot(circles[:, 0] - x, circles[:, 1] - z) - circles[:, 2]).min())

    def free_tripod(x, z):
        r, c = T.rc(x, z)
        return bool(T.walkable[r, c]) and clear_of_circles(x, z) >= TRIPOD_CLEAR

    def tripod_near(x, z):
        """The nearest free tripod spot within KEEP_REACH, searched on rings of 0.25 m."""
        if free_tripod(x, z):
            return (x, z)
        for rad in np.arange(0.25, KEEP_REACH + 1e-6, 0.25):
            n = max(8, int(2 * math.pi * rad / 0.2))
            for k in range(n):
                a = 2 * math.pi * k / n
                px, pz = x + rad * math.cos(a), z + rad * math.sin(a)
                if free_tripod(px, pz):
                    return (px, pz)
        return None

    kept, dropped = [], {"far": 0, "no_spot": 0}
    for sid, E, N in scanners:
        x, z = E - E0, -(N - N0)
        r, c = T.rc(x, z)
        if float(T.d_walk[r, c]) > KEEP_REACH:
            dropped["far"] += 1
            continue
        spot = tripod_near(x, z)
        if spot is None:
            dropped["no_spot"] += 1
            continue
        sx, sz = spot
        rs, cs = T.rc(sx, sz)
        cover = int(sum(1 for cx, cz, cr in circles
                        if cr >= COVER_R and COVER_NEAR <= math.hypot(cx - sx, cz - sz) - cr <= COVER_FAR))
        kept.append({
            "id": sid,
            "x": r2(sx), "y": r2(T.height_at(sx, sz)), "z": r2(sz),
            "on": where_on(T, x, z),  # where the surveyed spot itself lies
            "moved": r2(math.hypot(sx - x, sz - z)),
            "water": r2(min(float(T.d_water[rs, cs]), 99)),
            "thicket": r2(min(float(T.d_thicket[rs, cs]), 99)),
            "clear": r2(clear_of_circles(sx, sz)),
            "canopy": r2(T.mean_canopy(sx, sz, 10.0)),
            "cover": cover,
            "causeway": bool(T.causeway[rs, cs]),
            "late": sid in late,
        })

    cand = [i for i, k in enumerate(kept)
            if not k["causeway"] and not k["late"] and k["water"] >= CAND_WATER and k["thicket"] >= CAND_THICKET
            and k["clear"] >= CAND_CLEAR and k["cover"] >= 2 and k["canopy"] >= 1.0]
    if len(cand) < MISSION:
        raise SystemExit(f"only {len(cand)} candidate scan spots, need {MISSION}")

    P = np.array([[kept[i]["x"], kept[i]["z"]] for i in cand])
    cover = np.array([kept[i]["cover"] for i in cand], float)
    # farthest-point sampling from the candidate nearest the causeway top, each distance
    # weighted up to 25 % by cover, so of two equally spread spots the sheltered one wins
    wcov = 0.75 + 0.25 * np.minimum(cover, 8) / 8
    d0 = np.hypot(P[:, 0] - CAUSEWAY_TOP[0], P[:, 1] - CAUSEWAY_TOP[1])
    chosen = [int(np.argmin(d0))]
    dmin = np.hypot(P[:, 0] - P[chosen[0], 0], P[:, 1] - P[chosen[0], 1])
    while len(chosen) < MISSION:
        j = int(np.argmax(dmin * wcov))
        chosen.append(j)
        dmin = np.minimum(dmin, np.hypot(P[:, 0] - P[j, 0], P[:, 1] - P[j, 1]))
    picks = [cand[j] for j in chosen]

    # a nearest-neighbour walk from the causeway top orders them
    left = list(picks)
    px, pz = CAUSEWAY_TOP
    tour, walk_len = [], 0.0
    while left:
        i = min(left, key=lambda i: (math.hypot(kept[i]["x"] - px, kept[i]["z"] - pz), kept[i]["id"]))
        walk_len += math.hypot(kept[i]["x"] - px, kept[i]["z"] - pz)
        tour.append(i)
        px, pz = kept[i]["x"], kept[i]["z"]
        left.remove(i)

    used = set()

    def place_name(x, z):
        best, bd = None, PLACE_REACH
        for lm in landmarks:
            name = KIND_NAMES.get(lm["kind"]) or NAME_NAMES.get(lm.get("name") or "")
            if not name or name in used:  # each spot a name of its own
                continue
            d = math.hypot(lm["x"] - x, lm["z"] - z)
            if d < bd:
                best, bd = name, d
        if best:
            used.add(best)
            return "by " + best
        # the part of the island (it runs about x -45 to 63, z -33 to 27)
        ew = "west" if x < -15 else "east" if x > 25 else "middle"
        ns = "north" if z < -18 else "south" if z > 10 else ""
        if ew == "middle":
            return {"north": "on the north lawn", "south": "on the south lawn", "": "in the middle of the island"}[ns]
        return f"on the {ns + ' ' if ns else ''}{ew} side".replace("  ", " ")

    mission = []
    for n, i in enumerate(tour):
        k = kept[i]
        k["mission"] = n + 1
        mission.append({"n": n + 1, "x": k["x"], "y": k["y"], "z": k["z"],
                        "place": place_name(k["x"], k["z"]), "cover": k["cover"],
                        "canopy": k["canopy"], "water": k["water"]})

    counts = {
        "surveyed": len(scanners), "kept": len(kept), "dropped_far": dropped["far"],
        "dropped_no_spot": dropped["no_spot"], "candidates": len(cand), "mission": len(mission),
        "moved_over_0_5m": sum(k["moved"] > 0.5 for k in kept),
    }
    out = {
        "frame": FRAME,
        "source": ("the lab's October 2025 terrestrial laser scan of the island: 88 scan "
                   "positions of a RIEGL scanner on a tripod"),
        "fields": {
            "positions": "every scan position on or next to walkable ground, snapped to a free tripod spot",
            "id": "the scan position's name in the survey (not shown to the player)",
            "x, y, z": "the tripod spot in the game frame; y from the terrain height grid",
            "on": "where the surveyed spot itself lies: walkable, causeway, thicket, water or land",
            "moved": "metres from the surveyed spot to the tripod spot (0 when it stands there)",
            "water, thicket": "metres from the spot to the nearest water or thicket cell (99 at most)",
            "clear": "metres from the spot to the edge of the nearest collider circle",
            "canopy": "mean vegetation height over the ground within 10 m, metres",
            "cover": f"collider circles {COVER_R} m or wider {COVER_NEAR} to {COVER_FAR} m away (edge): places to duck behind",
            "causeway": "the spot is on the causeway",
            "late": "ScanPos031, whose file was recovered after the walk-through; kept, never a mission spot",
            "mission": "on a mission spot: its number in the walk (1 first)",
            "mission list": "the mission's scan spots in walking order, with a friendly place name",
        },
        "positions": kept,
        "mission": mission,
        "stats": {**counts, "mission_walk_m": r2(walk_len)},
        "notes": ("Mission spots are candidates away from water, thicket and trunks with cover to "
                  "hide behind and trees round about, picked by farthest-point sampling from the "
                  "causeway top (weighted a little by cover) and ordered as a nearest-neighbour walk."),
    }
    (DATA / "scanpos.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))

    print(f"scan positions: {counts}")
    for m in mission:
        print(f"  spot {m['n']}: ({m['x']:6.1f}, {m['z']:6.1f}) {m['place']}, cover {m['cover']}, "
              f"canopy {m['canopy']:.1f} m, water {m['water']:.1f} m")
    print(f"walk from the causeway top {walk_len:.0f} m")
    print(f"wrote {DATA / 'scanpos.json'} ({(DATA / 'scanpos.json').stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
