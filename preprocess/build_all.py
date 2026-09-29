"""Rebuild every game data file from the survey sources, in order.

Runs each preprocessing script as its own process with this same interpreter, from the game
folder, and stops at the first one that fails:

    terrain.py        data/terrain.json, terrain_*.u16/.u8, water.json
    placements.py     data/placements.json, colliders.json      (reads the terrain mask)
    palette.py        data/palette.json      (reads the landmark kinds in placements.json)
    spawns.py         data/spawns.json      (reads terrain, placements and colliders)
    stakes.py         data/stakes.json      (the stake lattice; reads terrain, placements and colliders)
    scanpos.py        data/scanpos.json     (the laser scanner's positions; reads terrain, placements and colliders)
    check_figure.py   check/preprocess_check.png and preprocess_check_detail.png
                      (reads every file in data/)

Every script uses fixed seeds, so a rebuild from unchanged sources should give the same bytes.
To check that, the MD5 of every file in data/ is taken before and after the run and any file
whose bytes changed is listed. Finally the size of each data file and of the whole folder is
printed against the 4 MB budget.

Run from the game folder:
    python3 preprocess/build_all.py
"""

import hashlib
import subprocess
import sys
import time
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
PRE = GAME / "preprocess"
DATA = GAME / "data"

STEPS = ["terrain.py", "placements.py", "palette.py", "spawns.py", "stakes.py", "scanpos.py", "check_figure.py"]
BUDGET_BYTES = 4 * 1024 * 1024


def digests(folder):
    """MD5 of every file directly inside folder, by name."""
    if not folder.exists():
        return {}
    return {p.name: hashlib.md5(p.read_bytes()).hexdigest()
            for p in sorted(folder.iterdir()) if p.is_file()}


def run(step):
    """Run one script; -B keeps bytecode out of preprocess/. Output streams straight through."""
    print(f"\n=== {step} " + "=" * (70 - len(step)), flush=True)
    t0 = time.perf_counter()
    result = subprocess.run([sys.executable, "-B", str(PRE / step)], cwd=GAME)
    dt = time.perf_counter() - t0
    if result.returncode != 0:
        print(f"\n{step} failed (exit code {result.returncode}) after {dt:.1f} s; stopping.",
              flush=True)
        sys.exit(result.returncode)
    print(f"--- {step} finished in {dt:.1f} s", flush=True)
    return dt


def main():
    before = digests(DATA)
    times = {step: run(step) for step in STEPS}
    after = digests(DATA)

    print("\n=== summary " + "=" * 62)
    print("run times: " + ", ".join(f"{s} {t:.1f} s" for s, t in times.items())
          + f"; total {sum(times.values()):.1f} s")

    total = 0
    print("\ndata/ files:")
    for name in sorted(after):
        size = (DATA / name).stat().st_size
        total += size
        if name not in before:
            state = "new"
        elif before[name] == after[name]:
            state = "same bytes"
        else:
            state = "CHANGED"
        print(f"  {name:22s} {size / 1024:9.1f} KB   md5 {after[name][:12]}   {state}")
    print(f"  {'total':22s} {total / 1024:9.1f} KB   ({total / 1024 / 1024:.2f} MB of the "
          f"{BUDGET_BYTES / 1024 / 1024:.0f} MB budget)")

    changed = sorted(n for n in after if n in before and before[n] != after[n])
    gone = sorted(set(before) - set(after))
    if changed or gone:
        print(f"\nfiles whose bytes changed: {changed or 'none'}; files no longer written: "
              f"{gone or 'none'}")
    else:
        print("\nevery data file that existed before the run has the same bytes after it")
    if total > BUDGET_BYTES:
        print("WARNING: data/ is over the size budget")


if __name__ == "__main__":
    main()
