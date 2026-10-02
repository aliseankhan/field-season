"""The brown basilisk sites for the Lizard Island game.

Reads (read only) the basilisk sites file made from the spring 2026 survey, which is already
privacy-safe: each spring 2026 record moved 0.2 to 0.6 m and kept 0.2 m clear of every
record, with the nearest ground it can run on (home) and the nearest water. Only four
things are copied per site: x, z, the home point and the water point. The home and water
points come as map pixels (1/8 m from the map origin X0 = -58, Z0 = -45) and are turned
into metres here.

Reads:
    basilisk_sites.json (the path as the first argument; by default the sibling folder
    where it was made)

Writes:
    data/basilisks.json

Run from the game folder:
    python3 preprocess/basilisks.py
"""

import json
import sys
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else GAME.parent / "LizardIsland_gbc" / "res" / "spawns" / "basilisk_sites.json"
OUT = GAME / "data" / "basilisks.json"
X0, Z0, PX = -58.0, -45.0, 8.0  # the map's origin and pixels a metre
FRAME = {"origin_E": 573150, "origin_N": 2840100, "origin_h": -24.9, "axes": "x = E - E0, y = h - h0, z = -(N - N0)"}


def metres(px, py):
    return [round(px / PX + X0, 3), round(py / PX + Z0, 3)]


def main():
    if not SRC.exists():
        print(f"{SRC} not found: {OUT.relative_to(GAME)} kept as it is")
        return
    src = json.loads(SRC.read_text())
    sites = []
    for s in src["sites"]:
        sites.append({"x": s["x"], "z": s["z"], "home": metres(s["home_px"], s["home_py"]),
                      "water": metres(s["water_px"], s["water_py"])})
    doc = {
        "frame": FRAME,
        "sites": sites,
        "notes": "Brown basilisk sites from the spring 2026 survey: each record moved 0.2 to 0.6 m and kept 0.2 m clear of every record. "
                 "x, z is the site; home is the nearest ground a basilisk can run on, where it rests; "
                 "water is the nearest water, where it runs for. Positions only, west to east.",
    }
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"{OUT.relative_to(GAME)}: {len(sites)} sites")


if __name__ == "__main__":
    main()
