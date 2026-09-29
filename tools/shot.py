"""Headless Chrome helper for checking the game without a window.

    python tools/shot.py URL out.png [--size 1600x1000] [--wait 12]
    python tools/shot.py URL --dom out.html [--wait 12]

Chrome renders WebGL2 headless on this Mac but does not always exit after
--screenshot, so it is run with a hard time limit and killed afterwards.
Each call uses its own throwaway profile folder under work/chrome_profiles.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILES = os.path.join(os.path.dirname(HERE), "work", "chrome_profiles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("out", nargs="?", help="PNG path for a screenshot")
    ap.add_argument("--dom", help="write the DOM after the wait to this file instead")
    ap.add_argument("--size", default="1600x1000")
    ap.add_argument("--wait", type=float, default=12.0, help="virtual time budget, seconds")
    ap.add_argument("--limit", type=float, default=None, help="hard wall-clock limit, seconds")
    a = ap.parse_args()
    if not a.out and not a.dom:
        ap.error("give an output PNG or --dom")

    os.makedirs(PROFILES, exist_ok=True)
    prof = tempfile.mkdtemp(dir=PROFILES)
    w, h = a.size.lower().split("x")
    args = [CHROME, "--headless=new", f"--user-data-dir={prof}", "--no-first-run",
            "--hide-scrollbars", "--ignore-gpu-blocklist", "--enable-webgl",
            f"--window-size={w},{h}", f"--virtual-time-budget={int(a.wait * 1000)}"]
    target = a.dom or a.out
    target = os.path.abspath(target)
    if os.path.exists(target):
        os.remove(target)
    if a.dom:
        args += ["--dump-dom", a.url]
        fout = open(target, "w")
    else:
        args += [f"--screenshot={target}", a.url]
        fout = subprocess.DEVNULL
    limit = a.limit or (a.wait * 2 + 30)
    p = subprocess.Popen(args, stdout=fout, stderr=subprocess.DEVNULL)
    t0 = time.time()
    while time.time() - t0 < limit:
        if p.poll() is not None:
            break
        if not a.dom and os.path.exists(target) and os.path.getsize(target) > 0:
            time.sleep(1.0)  # let the file finish writing
            break
        if a.dom:
            fout.flush()
            with open(target, errors="ignore") as f:
                if "</html>" in f.read():
                    break
        time.sleep(0.5)
    if p.poll() is None:
        p.kill()
        p.wait()
    if a.dom:
        fout.close()
    shutil.rmtree(prof, ignore_errors=True)
    ok = os.path.exists(target) and os.path.getsize(target) > 0
    print(("wrote " if ok else "FAILED ") + target)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
