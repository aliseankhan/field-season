"""Packs the game for hosting: only what a web server needs, plus the island board's
server kept apart from the web root, and short notes for the VM.

    python3 tools/package.py [--port 8779]

    dist/field-season/   index.html, src/ and data/: the folder the web server serves
    dist/server/         scoreboard_server.py, its systemd units (the server and a daily
                         backup), the nginx location and install.sh for an admin
    dist/DEPLOY.md       how to put it on the VM, check it, back up and reset the board

Left out: work/, check/, preprocess/, tools/, models.html, the galleries, the notes and
any Python, Markdown or editor leftovers. The packed data/*.json leave out what the game
never reads and need not be published: the survey frame (the UTM origin that would turn
the game's positions back into real coordinates), the scan positions' survey names, and
the notes, field descriptions, sources, review lists and build counts written for people
reading the files (PROSE_KEYS); data/ itself is untouched. Every relative import, style
sheet and module the packed pages load is checked to be in the pack. Nothing is copied
anywhere else: this only builds the dist/ folder here.
"""
import argparse
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
DIST = os.path.join(GAME, "dist")
WEB = os.path.join(DIST, "field-season")
SERVER = os.path.join(DIST, "server")

TOP = ["index.html", "src", "data"]
SKIP_NAMES = {".DS_Store", "Thumbs.db", "__pycache__", "desktop.ini"}
SKIP_SUFFIXES = (".py", ".pyc", ".md", ".map", ".orig", ".bak", ".swp", ".tmp", "~")
SKIP_PATTERNS = [re.compile(p) for p in (r"_gallery\.html$", r"^src/.*\.html$")]

# The web site's folder and the API's path on it (see DEPLOY.md). Generic defaults; a
# local tools/deploy_site.json (kept out of the repository) can set a real server's paths.
SITE = {
    "SITE_DIR": "/var/www/field-season",
    "URL_PATH": "/field-season/",
    "PARENT_PATH": "/",
    "NGINX_FILE": "/etc/nginx/sites-available/field-season",
}
_LOCAL_SITE = os.path.join(HERE, "deploy_site.json")
if os.path.exists(_LOCAL_SITE):
    with open(_LOCAL_SITE) as _f:
        SITE.update(json.load(_f))
SITE_DIR, URL_PATH, PARENT_PATH, NGINX_FILE = (SITE[k] for k in ("SITE_DIR", "URL_PATH", "PARENT_PATH", "NGINX_FILE"))
APP_DIR = "/opt/field-season-board"
STATE_DIR = "/var/lib/field-season-board"
USER = "fsboard"


def skipped(rel):
    name = os.path.basename(rel)
    if name in SKIP_NAMES or name.startswith("."):
        return True
    if rel.endswith(SKIP_SUFFIXES):
        return True
    return any(p.search(rel) for p in SKIP_PATTERNS)


# Keys for people reading the files, which the game never reads (each checked with a grep
# over src/): "*" for every file, dotted paths for keys inside another
PROSE_KEYS = {
    "*": ["notes"],
    "data/palette.json": ["sources"],
    "data/placements.json": ["review", "survey_identity", "stats"],
    "data/scanpos.json": ["source", "fields"],
    "data/stakes.json": ["source", "fields"],
    "data/terrain.json": ["layout", "start.heading_convention", "stats.method", "stats.causeway.note"],
}


def trim_data(rel, text):
    """The packed copy of a data/*.json file without the survey frame, the prose keys in
    PROSE_KEYS and, in scanpos.json, the scan positions' names. Returns (text, what was
    taken out)."""
    d = json.loads(text)
    out = []
    if isinstance(d, dict) and "frame" in d:
        del d["frame"]
        out.append("frame")
    if rel == "data/scanpos.json" and isinstance(d, dict):
        n = 0
        for p in d.get("positions") or []:
            if isinstance(p, dict) and "id" in p:
                del p["id"]
                n += 1
        if isinstance(d.get("fields"), dict):
            d["fields"].pop("id", None)
        if n:
            out.append(f"{n} scan position names")
    prose = []
    for key in PROSE_KEYS["*"] + PROSE_KEYS.get(rel, []):
        *parents, last = key.split(".")
        node = d
        for p in parents:
            node = node.get(p) if isinstance(node, dict) else None
        if isinstance(node, dict) and last in node:
            del node[last]
            prose.append(key)
    if prose:
        out.append("prose: " + ", ".join(prose))
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")), out


def copy_game():
    files, trimmed = [], []
    for top in TOP:
        src = os.path.join(GAME, top)
        if os.path.isfile(src):
            files.append(top)
            continue
        for root, dirs, names in os.walk(src):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES and not d.startswith("."))
            for n in sorted(names):
                rel = os.path.relpath(os.path.join(root, n), GAME).replace(os.sep, "/")
                if not skipped(rel):
                    files.append(rel)
    for rel in files:
        dest = os.path.join(WEB, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if rel.startswith("data/") and rel.endswith(".json"):
            with open(os.path.join(GAME, rel), encoding="utf-8") as f:
                text, what = trim_data(rel, f.read())
            with open(dest, "w", encoding="utf-8") as f:
                f.write(text)
            if what:
                trimmed.append((rel, what))
        else:
            shutil.copy2(os.path.join(GAME, rel), dest)
    return files, trimmed


# import x from './a.js', import './a.js', import('./a.js'), export ... from './a.js',
# new URL('./a.css', import.meta.url); and in HTML, src= and href=
JS_REFS = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|new\s+URL\(\s*)['"](\.{1,2}/[^'"]+)['"]""")
# and any other './x.js' or '../x.css' string (the optional systems main.js and ui.js load)
JS_PATHS = re.compile(r"""['"](\.{1,2}/[^'"\s]+\.(?:js|mjs|css))['"]""")
HTML_REFS = re.compile(r"""\b(?:src|href)\s*=\s*["']([^"'#?:]+)["']""")


def check_refs(files):
    have = set(files)
    missing = []
    checked = 0
    for rel in files:
        path = os.path.join(WEB, rel)
        if rel.endswith(".js"):
            text = open(path, encoding="utf-8").read()
            refs = set(JS_REFS.findall(text)) | set(JS_PATHS.findall(text))
        elif rel.endswith(".html"):
            refs = HTML_REFS.findall(open(path, encoding="utf-8").read())
        else:
            continue
        base = os.path.dirname(rel)
        for ref in refs:
            target = os.path.normpath(os.path.join(base, ref)).replace(os.sep, "/")
            checked += 1
            if target not in have:
                missing.append(f"{rel} -> {ref}")
    return missing, checked


def size_of(folder):
    n = total = 0
    for root, _, names in os.walk(folder):
        for name in names:
            n += 1
            total += os.path.getsize(os.path.join(root, name))
    return n, total


def mb(b):
    return f"{b / 1e6:.1f} MB" if b >= 1e5 else f"{b / 1e3:.0f} KB"


# systemd's sandbox for both units: the board needs its own folder in /var/lib and
# 127.0.0.1, nothing else
HARDENING = """UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallFilter=@system-service
SystemCallArchitectures=native
CapabilityBoundingSet="""


def unit(port):
    return f"""[Unit]
Description=Field Season island board (the game's score API)
After=network.target

[Service]
User={USER}
Group={USER}
ExecStart=/usr/bin/python3 {APP_DIR}/scoreboard_server.py --host 127.0.0.1 --port {port} --db {STATE_DIR}/scores.db
Restart=on-failure
RestartSec=5
StateDirectory=field-season-board
StateDirectoryMode=0700
# only 127.0.0.1: a mistaken --host still cannot reach off the machine
RestrictAddressFamilies=AF_INET AF_UNIX
IPAddressDeny=any
IPAddressAllow=localhost
{HARDENING}

[Install]
WantedBy=multi-user.target
"""


def backup_unit():
    return f"""[Unit]
Description=Field Season island board: a dated copy of the database

[Service]
Type=oneshot
User={USER}
Group={USER}
ExecStart=/usr/bin/python3 {APP_DIR}/scoreboard_server.py --db {STATE_DIR}/scores.db --backup {STATE_DIR}/backups/ --keep 14
StateDirectory=field-season-board
StateDirectoryMode=0700
PrivateNetwork=yes
RestrictAddressFamilies=AF_UNIX
{HARDENING}
"""


def backup_timer():
    return """[Unit]
Description=Daily copy of the Field Season island board

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
"""


def nginx(port):
    return f"""# The island board's API. This goes INSIDE the existing `location ^~ {PARENT_PATH} {{ ... }}`
# block in {NGINX_FILE}, below its allow and deny lines. A location
# nested there with no allow or deny of its own keeps that block's own access
# list, so nothing is copied. Only field-season/api/ goes to the board server; the game's
# own files are served by the outer block as before.
location ^~ {URL_PATH}api/ {{
    limit_except GET POST {{ deny all; }}
    client_max_body_size 64k;  # a day and its notebook (the server's own cap is 64 KB)
    access_log off;  # the board keeps no addresses; delete this line to keep the site's usual log
    proxy_pass http://127.0.0.1:{port}/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_connect_timeout 3s;
    proxy_send_timeout 10s;
    proxy_read_timeout 10s;
}}
"""


def install_sh(port):
    return f"""#!/bin/sh
# Puts Field Season and its island board on this VM, for someone with sudo, from the
# staged dist folder (the one holding field-season/ and server/):
#
#     sudo sh server/install.sh <host>     (<host>: the site's name, for the nginx check)
#
#  1. the game into {SITE_DIR}/
#  2. the board server: its user, {APP_DIR}/, the systemd unit and a daily backup timer
#  3. the nginx location: checked, not edited (DEPLOY.md, step 3), then reloaded
# Run it again after an update; it replaces the game and the server script.
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
SITE={SITE_DIR}
APP={APP_DIR}
CONF={NGINX_FILE}
PORT={port}
HOST=${{1:-$(hostname -f)}}

[ "$(id -u)" = 0 ] || {{ echo "Run it with sudo."; exit 1; }}
[ -f "$HERE/field-season/index.html" ] && [ -f "$HERE/server/scoreboard_server.py" ] || {{ echo "Run it from the staged dist folder (field-season/ and server/)."; exit 1; }}

echo "1. the game -> $SITE/"
install -d -m 755 "$SITE"
rsync -a --delete --chown=root:root --chmod=D755,F644 "$HERE/field-season/" "$SITE/"

echo "2. the board server"
id {USER} >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin {USER}
install -d -m 755 "$APP"
install -m 644 "$HERE/server/scoreboard_server.py" "$APP/"
for u in field-season-board.service field-season-board-backup.service field-season-board-backup.timer; do
  install -m 644 "$HERE/server/$u" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now field-season-board-backup.timer
systemctl enable field-season-board
systemctl restart field-season-board
sleep 1
curl -fsS "http://127.0.0.1:$PORT/api/ping" && echo || echo "The board did not answer: journalctl -u field-season-board -n 20"
systemd-analyze security field-season-board | tail -n 1 || true

echo "3. nginx"
if grep -q "field-season/api/ping" "$CONF" 2>/dev/null; then
  echo "Take out the 'no board' api/ping line from $CONF: it would hide the board's own ping."
fi
if grep -q "client_max_body_size 4k" "$CONF" 2>/dev/null; then
  echo "In the field-season/api/ location of $CONF, change client_max_body_size 4k to 64k (a day's notebook"
  echo "goes up with it now), then run this again. Until then days still post, without their notebooks."
fi
if grep -q "field-season/api/ *{{" "$CONF" 2>/dev/null; then
  nginx -t && systemctl reload nginx
  curl -sSk --resolve "$HOST:443:127.0.0.1" "https://$HOST{URL_PATH}api/ping"; echo
else
  echo "Not yet: put server/nginx-field-season-api.conf inside the location ^~ {PARENT_PATH} block of"
  echo "$CONF (DEPLOY.md, step 3), then run this again."
fi
"""


def deploy(port, web_n, web_size, trimmed):
    trim_line = ("The packed `data/*.json` leave out the survey frame (the UTM origin that would turn the\n"
                 "  game's positions back into real coordinates), the scan positions' survey names and the\n"
                 "  notes and counts written for people reading the files. The game never reads any of them;\n"
                 "  the game folder's own `data/` is untouched.") if trimmed else ""
    return f"""# Field Season on the VM

Local packaging notes. Nothing here has been copied to a server.

## What is in dist/

- `field-season/`: the game, {web_n} files, {mb(web_size)} (`index.html`, `src/`, `data/`). Plain
  static files: no build step, three.js comes from jsDelivr through the import map.
  {trim_line}
- `server/`: `scoreboard_server.py` (the island board's API, Python 3 standard library only,
  SQLite 3.25 or later), `field-season-board.service` (systemd), a daily backup
  (`field-season-board-backup.service` and `.timer`), `nginx-field-season-api.conf` (the
  location) and `install.sh`, which does steps 1 and 2 and checks step 3 for an admin.

The game works without the board. On load it asks `api/ping` beside its page; with no answer
every board button and panel stays hidden. So the game can go up first and the board later.

## Who needs sudo

Steps 1, 2 and 3 need an admin with sudo: the site folder, systemd and nginx are root's.
Stage `dist/` in your home folder (no sudo), then whoever has sudo runs one script from it:

    rsync -a --delete dist/ <vm>:~/staging/field-season-dist/
    ssh <vm>
    cd ~/staging/field-season-dist && sudo sh server/install.sh <host>

It copies the game in, sets up the board server and its daily backup, and checks and
reloads nginx once the location from step 3 is in place (it does not edit nginx's files).
Steps 1 to 3 below say what it does, for doing them by hand. Step 4 onwards needs no sudo
except where shown. If only the board server can be yours, see "Without sudo" at the end.

## 1. The game (sudo)

The existing `{PARENT_PATH}` location already serves any folder under it, so the game
needs no nginx change:

    sudo install -d -m 755 {SITE_DIR}
    sudo rsync -a --delete --chown=root:root --chmod=D755,F644 ~/staging/field-season-dist/field-season/ {SITE_DIR}/

It is then at `https://<host>{URL_PATH}` (with the trailing slash). Before the board is
up, its ping gets the site's 404 (harmless: the board stays hidden). To keep that out of
the browser's console, this optional line inside the `{PARENT_PATH}` block answers "no
board" instead; take it out again when the board's location goes in, since an exact match
wins over the board's own location:

    location = {URL_PATH}api/ping {{ default_type application/json; return 200 '{{"ok":false,"board":false}}'; }}

## 2. The board server (sudo)

Runs as its own unprivileged user, listens on 127.0.0.1:{port} only, and keeps its SQLite
file in `{STATE_DIR}/`, outside the web root (systemd makes that folder, mode 700).

    sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin {USER}
    sudo install -d -m 755 {APP_DIR}
    sudo install -m 644 ~/staging/field-season-dist/server/scoreboard_server.py {APP_DIR}/
    sudo install -m 644 ~/staging/field-season-dist/server/field-season-board*.service ~/staging/field-season-dist/server/field-season-board-backup.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now field-season-board field-season-board-backup.timer
    systemd-analyze security field-season-board    # a low exposure score

The server must only ever sit behind nginx on 127.0.0.1. nginx reads each request whole
before passing it on; the server's own limits (20 s a request, 48 at once) are a backstop,
not a front door. The unit (also in `server/field-season-board.service`) keeps it to
127.0.0.1 even if `--host` were changed by mistake:

```ini
{unit(port).strip()}
```

## 3. The nginx location (sudo)

In `{NGINX_FILE}`, put the location below inside the existing
`location ^~ {PARENT_PATH} {{ ... }}` block, after its allow and deny lines. Nested there
with no allow or deny of its own, it keeps that block's own access list, so
nothing is copied and nothing can drift. It proxies only `field-season/api/`. The rate
limit counts each visitor by the `X-Real-IP` nginx sets, which the server trusts only from
127.0.0.1.

```nginx
{nginx(port).strip()}
```

    sudo nginx -t && sudo systemctl reload nginx

The board's own log and database never hold an address. The location turns nginx's access
log off for `api/` too (delete `access_log off;` to keep the site's usual log); nginx's
error log can still name an address when a request fails.

## 4. Check it

    systemctl status field-season-board          # active (running)
    journalctl -u field-season-board -n 20       # "island board on http://127.0.0.1:{port}/api/ ... board ready"
    curl -s http://127.0.0.1:{port}/api/ping      # {{"ok":true,"app":"field-season-board","v":1,"board":true}}
    curl -sk --resolve <host>:443:127.0.0.1 https://<host>{URL_PATH}api/ping
                                                 # the same through nginx, from the VM (a 403 means
                                                 # if 127.0.0.1 is not allowed there, try from an allowed machine)
    curl -s "https://<host>{URL_PATH}api/scores?board=best&limit=3"    # from a machine the site allows

Then open the game in a wide window: the title shows the Island board card on the right
(a narrow window has an "Island board" pill beside Settings), its tabs Best day, Most
species, Rarest catch and Steady hands (days played with Precise aiming from start to
end). After a survey day the end-of-day card has "Share my day" ([B]); the day's notebook
goes up with it, and a click on any board row with a notebook opens it, read-only.
Practice runs (the debug flags in the address) never offer it.

The server logs one short line per post and per refused request to the journal, and says
when the database is unavailable and why (for example a read-only file or folder).

## 5. Back up, tidy and reset

The timer makes a dated copy each day in `{STATE_DIR}/backups/` and keeps the last 14
(`systemctl list-timers field-season-board-backup` shows the next one). By hand, run the
upkeep commands as the board's user, so its files keep their owner:

    board() {{ (cd / && sudo -u {USER} python3 {APP_DIR}/scoreboard_server.py --db {STATE_DIR}/scores.db "$@"); }}

    board --show                                   # the boards' top five (with each notebook's key)
    board --backup {STATE_DIR}/backup.db           # a copy now (safe while the server runs)
    sudo install -o "$USER" -g "$(id -gn)" -m 600 {STATE_DIR}/backup.db ~/field-season-board-backup.db
                                                   # that copy in your home, yours to read
    board --remove-name "Some Name"                # one player's days off the board
    board --drop-photo "Some Name"                 # the aerial photo out of that name's notebooks (the days stay)
    board --remove-notebook KEY                    # one day's notebook off, by the key --show prints (the day stays)
    board --reset                                  # a copy beside the database, then an empty board

The board refuses days that one survey day could not hold: more than 60 catches (at most
10 knight, 12 bark, 25 green, 40 brown and 60 crested anoles), more than 5 backpacks, or a
score over what those catches and a full day's stamps, loggers and field-kit jobs could
earn (about 6,500 plus the catches). A day's notebook is checked field by field (only the
game's own lists and bounded numbers, and one small JPEG of at most 40 KB and 480 px);
one it cannot take is refused and the game sends the day again without it. Anything that
still looks wrong, or a name the word filter missed, comes off with `--remove-name` (its
notebooks too); `--check-name "Name"` says whether the board would take a name. The aerial
photo is the one part of a notebook the board can only check for its form and size: if
one should not be there, `--drop-photo` takes it out of that name's notebooks, and
`--remove-notebook` takes one day's notebook off, leaving the days on the board.

The notebooks are most of the database: about 5 to 25 KB a day, 64 KB at the very most.
The server keeps about 4,000 (`--max-notebooks`); past that the oldest go, except the ones
the game can show at the top of its boards (the top 50 of each), so never more than 4,200:
about 270 MB at the very most, nearer 100 MB in practice.

To take the board down and keep the game: `sudo systemctl disable --now field-season-board`.
The game notices on its next load and hides the board.

## Updating a board that is already live (Steady hands and the notebooks)

This version adds the Steady hands board (days played with Precise aiming) and a notebook
with each posted day. The server brings the live database up to date in place the first
time it opens it: it makes a dated copy beside it first
(`{STATE_DIR}/scores-before-steady-YYYYMMDD-HHMMSS.db`), then adds a `mode` column (every
day already there is an assist day) and a `notebooks` table. Every row is kept; those days
simply have no notebook. It does this once (a second start finds it done), and not at all
while the database is read-only. Update the server and nginx before the game:

    sudo install -m 644 ~/staging/field-season-dist/server/scoreboard_server.py {APP_DIR}/
    sudo systemctl restart field-season-board
    journalctl -u field-season-board -n 5        # "brought the database up to date ... the copy from before is ..."
    board --show                                 # the same days as before, and Steady hands (0 names)

then in the location of step 3 change `client_max_body_size 4k;` to `64k;`, run `sudo nginx
-t && sudo systemctl reload nginx`, and copy the game in (step 1). Or run `install.sh`
again, which does all of it but the nginx line. Until nginx takes 64 KB the game still
posts, just without the notebook. Older copies of the game (a cached page) keep working:
a day without a mode is an assist day. To go back, the old `scoreboard_server.py` still
reads and writes the updated database (a trigger in the database takes a day's notebook
with it whenever the day is deleted, so the old script's `--remove-name` and `--reset`
leave none behind, and the new server tidies away any it finds on start), or restore the
dated copy with the server stopped.

## Without sudo

Only the board server can run without sudo; the game's folder (step 1) and the nginx
location (step 3) still need an admin. From your own account, with the database in your
home:

    mkdir -p ~/field-season-board && cp ~/staging/field-season-dist/server/scoreboard_server.py ~/field-season-board/
    nohup python3 ~/field-season-board/scoreboard_server.py --port {port} --db ~/field-season-board/scores.db >> ~/field-season-board/board.log 2>&1 &

and to start it after a reboot, and copy the board each night, `crontab -e`:

    @reboot python3 $HOME/field-season-board/scoreboard_server.py --port {port} --db $HOME/field-season-board/scores.db >> $HOME/field-season-board/board.log 2>&1
    30 3 * * * python3 $HOME/field-season-board/scoreboard_server.py --db $HOME/field-season-board/scores.db --backup $HOME/field-season-board/backups/ --keep 14

## Trying the pack on this Mac

From the game folder, the packed game and its board together (a throwaway database outside it):

    python3 dist/server/scoreboard_server.py --port {port} --db /tmp/field-season-board/scores.db --static dist/field-season
    open http://127.0.0.1:{port}/
"""


def main():
    ap = argparse.ArgumentParser(description="Pack the game for hosting into dist/.")
    ap.add_argument("--port", type=int, default=8779, help="the board server's port in the notes (default 8779)")
    a = ap.parse_args()

    # only ever clears its own output folders
    for folder in (WEB, SERVER):
        if os.path.commonpath([folder, DIST]) != DIST:
            sys.exit("refusing to clear " + folder)
        if os.path.isdir(folder):
            shutil.rmtree(folder)
    os.makedirs(WEB)
    os.makedirs(SERVER)

    files, trimmed = copy_game()
    missing, checked = check_refs(files)
    shutil.copy2(os.path.join(HERE, "scoreboard_server.py"), os.path.join(SERVER, "scoreboard_server.py"))
    for name, text in (("field-season-board.service", unit(a.port)),
                       ("field-season-board-backup.service", backup_unit()),
                       ("field-season-board-backup.timer", backup_timer()),
                       ("nginx-field-season-api.conf", nginx(a.port)),
                       ("install.sh", install_sh(a.port))):
        with open(os.path.join(SERVER, name), "w") as f:
            f.write(text)
    os.chmod(os.path.join(SERVER, "install.sh"), 0o755)

    web_n, web_size = size_of(WEB)
    srv_n, srv_size = size_of(SERVER)
    with open(os.path.join(DIST, "DEPLOY.md"), "w") as f:
        f.write(deploy(a.port, web_n, web_size, trimmed))

    biggest = sorted(files, key=lambda r: -os.path.getsize(os.path.join(WEB, r)))[:5]
    print(f"dist/field-season: {web_n} files, {mb(web_size)}")
    for rel in biggest:
        print(f"    {mb(os.path.getsize(os.path.join(WEB, rel))):>8}  {rel}")
    print("data: left out of the packed copies: " + "; ".join(f"{rel[5:]} ({', '.join(w)})" for rel, w in trimmed))
    print(f"dist/server: {srv_n} files, {mb(srv_size)}")
    print("dist/DEPLOY.md")
    if missing:
        print("MISSING from the pack:")
        for m in missing:
            print("    " + m)
        return 1
    print(f"all {checked} imports, style sheets and page references are in the pack")
    return 0


if __name__ == "__main__":
    sys.exit(main())
