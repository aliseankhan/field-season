#!/usr/bin/env python3
"""The island board for Stroud Lab: Field Season.

A small score server for the game on a campus web VM: nginx serves the game's static
files and proxies only its api/ folder to this process. Python's standard library only
(http.server, sqlite3, json; SQLite 3.25 or later); nothing to install. It is meant to sit
behind nginx on 127.0.0.1, never on an open port of its own.

    python3 scoreboard_server.py [--host 127.0.0.1] [--port 8779] [--db PATH]
                                 [--base /api/] [--static DIR]

    GET  <base>ping                          {"ok": true, "app": "field-season-board", "v": 1, "board": true}
    GET  <base>scores?board=best&limit=10    the board: best, species, rarest, steady (days played
                                             with Precise aiming) or backpacks (older copies of the game)
                                             {"rows": [...], "total": names on it, "names": names on any board}
    POST <base>scores                        a finished day (JSON, 64 KB at most):
         {"name": "Ali", "score": 1840,
          "species": {"cristatellus": 6, "sagrei": 2, "carolinensis": 1, "distichus": 0, "equestris": 1},
          "backpacks": 2, "rarest": "equestris", "stars": 3, "version": "1.0",
          "mode": "precise", "notebook": {...}}
         -> 201 {"ok": true, "rank": 3, "tie": false, "total": 12, "best": true,
                 "day": {"rank": 3, "tie": false}, "ranks": {...}, "ties": {...}, "bests": {...},
                 "board": [...], "you": {...}, "today": {...}, "steady": {...} or null}
    GET  <base>day/<key>                     one posted day's notebook, read-only
                                             {"ok": true, "name", "score", "steady", "notebook": {...}}; 404 if none

Each board lists every name once (names compared without case), at its best day for that
board. A row's rank is shared when its number is ("=2" in the game). After a post, "rank"
is where the name stands (its best day) and "best" says whether this day is that best;
"day" is where this day alone would stand among the others.

mode is "assist" (lock-on aiming, and what a day without one counts as, so older copies of
the game keep working) or "precise" (Precise aiming from the day's start to its end): a
precise day is on every board and on Steady hands too, and "steady" in the answer is its
standing there. notebook is a small snapshot of the day's notebook made by the game from
its own state (check_notebook: fixed lists, bounded numbers, capped lists and at most one
small JPEG); a row with one carries "nb", a random key for day/<key> (never the row's id).

Nothing about the player but the name, the day's numbers and its notebook is kept: no
addresses, times or ids go into the database, and the API never sends ids back. The rate
limit (one day every 20 s and 60 a day per client) is kept in memory under a keyed hash of
the address, and forgotten.

A database from before Steady hands (no mode column, no notebooks table) is brought up to
date in place when the server first opens it, after a dated copy is made beside it
(scores-before-steady-YYYYMMDD-HHMMSS.db); every row is kept, as an assist day with no
notebook.

Upkeep, run with the same --db:
    --show                 the boards' top five, then exit
    --backup FILE|DIR/     copy the database safely while the server runs, then exit; to a
                           folder, as scores-YYYYMMDD-HHMMSS.db, keeping the newest --keep
    --reset                back it up beside itself, then empty the board
    --remove-name NAME     take every day under that name off the board
    --drop-photo NAME      take the aerial photo out of that name's notebooks (the days stay)
    --remove-notebook KEY  take one day's notebook off (the day stays, with no notebook)
    --check-name NAME      say whether the board would take a name
Any of them but --check-name brings an older database up to date first, as the server does.
--max-notebooks N (default 4000): past it the oldest notebooks go, except the ones the game
can show at the top of its boards (the top 50 of Best day, Most species, Rarest catch and
Steady hands), so there are never more than N + 200. A notebook is 64 KB at the very most
and about 15 to 25 KB in practice: about 270 MB at the very most, nearer 100 MB.
A day's notebook goes with its day: a trigger in the database deletes it whenever the day is
deleted, whichever script does it, and the server tidies away any left behind on start.

--static DIR also serves the game itself, for local testing only (no directory listings,
no dotfiles, no database files). It binds 127.0.0.1 unless --host says otherwise.
"""

import argparse
import base64
import binascii
import codecs
import hashlib
import hmac
import http.server
import ipaddress
import json
import os
import re
import secrets
import signal
import socket
import sqlite3
import sys
import threading
import time
import unicodedata
import urllib.parse

APP = "field-season-board"
API_VERSION = 1

# ------------------------------------------------------------------ the game's numbers

# The five anoles by their epithets (src/game/state.js SPECIES_KEY), rarest first by the
# lab's record counts (RULES.rarity: knight 27, bark 39, green 233, brown 631, crested 6330).
SPECIES = ("cristatellus", "sagrei", "carolinensis", "distichus", "equestris")
RARITY_RANK = {"equestris": 1, "distichus": 2, "carolinensis": 3, "sagrei": 4, "cristatellus": 5}
NO_RAREST = 9

# What one survey day can hold. The day is 8, 12 or 16 real minutes (RULES.day.dayMinutes
# and the settings); a good day is 8 catches (RULES.summaryBands) and a full scripted run
# scores about 1,900 with 6. These caps leave a lot of room over the longest day while
# staying far below the island's own totals (data/spawns.json: 600, 152, 150, 39 and 27).
DAY = {
    "species": {"cristatellus": 60, "sagrei": 40, "carolinensis": 25, "distichus": 12, "equestris": 10},
    "caught": 60,
    "backpacks": 5,  # the bag holds 5 a day (RULES.inventory.backpacks)
    "stars": 9,  # three field-kit jobs of up to 3 stars each
}

# The score's cap follows the game's points (src/game/rules.js RULES.points):
#  - a catch: its rarity points (crested 10, brown 25, green 50, bark and knight 100), less
#    for the same species again that day (x 1, 1, 0.5, 0.5, then 0.25), plus at most 70 in
#    extras (crept up on 15, mid display 30, a perfect snug 10, the SVL spot on 5, the perch
#    noted 5, the height taped 5);
#  - 40 for the first of each species and 40 for each backpack fitted;
#  - and everything else a day can score, at most about 6,500: 24 one-time task stamps at
#    100 (2,400), James's three requests at 50 (150), the three field-kit jobs with their
#    requests, plants and scans (700), 12 loggers read and read again every 1.5 h (600),
#    GPS downloads (600), perch loggers (150), lizards spotted at 5 each (1,500 for 300),
#    crocodiles spotted (100) and recaptures (300).
RARITY_POINTS = {"cristatellus": 10, "sagrei": 25, "carolinensis": 50, "distichus": 100, "equestris": 100}
REPEAT = (1, 1, 0.5, 0.5, 0.25)
CATCH_EXTRAS = 70
FIRST_OF_SPECIES = 40
BACKPACK = 40
DAY_EXTRA = 6500
TASK_STAMP = 100  # a research task stamped (RULES.points.task), in a notebook's parts.task


def score_cap(counts, backpacks):
    """The most a day with these catches and backpacks could score."""
    cap = DAY_EXTRA + BACKPACK * backpacks
    for s, n in counts.items():
        if n > 0:
            cap += FIRST_OF_SPECIES + CATCH_EXTRAS * n
            cap += round(RARITY_POINTS[s] * sum(REPEAT[min(i, len(REPEAT) - 1)] for i in range(n)))
    return cap


# A day's numbers are a few hundred bytes; its notebook with the aerial photo's thumbnail
# (at most PHOTO_BYTES, a third more as base64) is what needs the room.
MAX_BODY = 65536
BOARDS = ("best", "species", "rarest", "steady", "backpacks")
FIELDS = {"name", "score", "species", "backpacks", "rarest", "stars", "version", "mode", "notebook"}
MODES = ("assist", "precise")

# ------------------------------------------------------------------ names

# Letters (plain and accented Latin), digits, spaces and - . ' _ , starting with a letter
# or digit, 1 to 14 characters, at least one letter.
_L = "A-Za-z0-9À-ÖØ-öø-ſ"
NAME_RE = re.compile("^[" + _L + "][" + _L + " '’._-]{0,13}$")
HAS_LETTER = re.compile("[A-Za-zÀ-ÖØ-öø-ſ]")

# A small word filter, kept in ROT13 so the file reads cleanly (codecs.decode(w, "rot13")).
#  STRONG: refused anywhere in a name, spaces and dots taken out ('f.u.c.k');
#  START: refused at the start of a word (so Scunthorpe stays fine);
#  WHOLE: refused only as a word of its own, or as the whole name with its spaces and dots
#  taken out, so Hancock, Cassie, Essex, Harshit, Nishita and Shital stay fine.
# A word is split at spaces and marks, and where a small letter meets a capital ('BigWord').
_STRONG = ['shpx', 'avtt', 'sntt', 'jnaxre', 'gjng', 'ovgpu', 'juber', 'encvfg', 'uvgyre', 'wvmm',
           'qvyqb', 'onfgneq', 'obyybpx', 'ergneq', 'xxx', 'nffubyr', 'nefrubyr', 'zbgures', 'pbpxfhpx',
           'cnrqb', 'crqbcuvy', 'oryyraq', 'xabournq', 'qvpxurnq', 'fuvgurnq', 'fuvgont', 'fuvgsnpr',
           'ohyyfuvg']
_START = ['phag']
_WHOLE = ['nff', 'nefr', 'pbpx', 'qvpx', 'gvgf', 'phz', 'snt', 'frk', 'frkl', 'nany', 'nahf', 'cvff',
          'cevpx', 'cnxv', 'fcvp', 'xvxr', 'puvax', 'tbbx', 'pbba', 'jbt', 'qlxr', 'abapr', 'fynt',
          'obbo', 'obbof', 'chffl', 'cbea', 'cbeab', 'cravf', 'anmv', 'fyhg', 'jnax', 'encr', 'xabo',
          'gbffre', 'abo', 'fpebghz', 'intvan', 'genaal', 'fcnm', 'fcnfgvp', 'cbbs', 'chor', 'chorf',
          'ahqr', 'ahqrf', 'ubeal', 'gubg', 'vapry', 'ubzb', 'fuvg', 'fuvgf', 'fuvgr', 'fuvggl', 'fuvggre']
STRONG = tuple(codecs.decode(w, "rot13") for w in _STRONG)
START = tuple(codecs.decode(w, "rot13") for w in _START)
WHOLE = frozenset(codecs.decode(w, "rot13") for w in _WHOLE)
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b"})
# The letters of the allowed set that do not come apart into a plain a-z letter and an
# accent: read as the letter they look like ('shıt' is 'shit').
FOLD = str.maketrans({"æ": "ae", "ð": "d", "ø": "o", "þ": "th", "đ": "d", "ħ": "h", "ı": "i", "ĸ": "k",
                      "ł": "l", "ŋ": "n", "œ": "oe", "ŧ": "t", "·": "", "ʼ": ""})


def _fold(s):
    """Lower case, accents off, every allowed letter as a-z: 'Ãßh0le' -> 'assh0le'."""
    s = unicodedata.normalize("NFKD", s.casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.translate(FOLD)


def _squeeze(w):
    return re.sub(r"(.)\1+", r"\1", w)  # 'fuuuck' -> 'fuck'


def _words(name):
    """The name's words, folded, with digits in a word read as letters ('sh1t', 'N4Z1');
    a number on its own stays a number ('Room 455')."""
    split = "".join(c + " " if c.islower() and n.isupper() else c for c, n in zip(name, name[1:] + " "))
    out = []
    for w in re.findall("[a-z0-9]+", _fold(split)):
        if re.search("[a-z]", w):
            out.append(re.sub("[^a-z]", "", w.translate(LEET)))
    return out


def rude(name):
    squash = re.sub("[^a-z]", "", _fold(name).translate(LEET))  # 'f.u.c.k', 's h 1 t'
    words = _words(name)
    for w in (squash, _squeeze(squash)):
        if any(s in w for s in STRONG):
            return True
        if w in WHOLE or any(w.startswith(s) for s in START):
            return True
    for w in words:
        for v in (w, _squeeze(w)):
            if v in WHOLE or any(v.startswith(s) for s in START):
                return True
    return False


def clean_name(raw):
    """(name, None) or (None, why). Spaces are trimmed and runs of them made one; anything
    else outside the safe set is refused rather than quietly changed."""
    if not isinstance(raw, str):
        return None, "The name should be text."
    if re.search(r"[^\S ]", raw):  # tabs, newlines and other odd spaces
        return None, "Names can use letters, numbers, spaces and - . ' _"
    name = re.sub(" +", " ", unicodedata.normalize("NFC", raw)).strip()
    if not 1 <= len(name) <= 14:
        return None, "Names are 1 to 14 characters."
    if not NAME_RE.fullmatch(name) or not HAS_LETTER.search(name):
        return None, "Names can use letters, numbers, spaces and - . ' _"
    if rude(name):
        return None, "The board can't take that name. Try another?"
    return name, None


def name_key(name):
    return re.sub(" +", " ", unicodedata.normalize("NFC", name).casefold()).strip()


# ------------------------------------------------------------------ checking a day

class Bad(Exception):
    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


def _int(v, field, lo, hi):
    # JSON true and false are ints to Python: not numbers here. 3.0 is not taken either.
    if isinstance(v, bool) or not isinstance(v, int):
        raise Bad(field, f"{field} should be a whole number.")
    if not lo <= v <= hi:
        raise Bad(field, f"{field} should be between {lo} and {hi}.")
    return v


def check_day(body):
    """A cleaned row from a posted day, or Bad."""
    if not isinstance(body, dict):
        raise Bad("body", "Send one JSON object.")
    extra = set(body) - FIELDS
    if extra:
        raise Bad("body", "Unknown fields: " + ", ".join(sorted(str(k)[:20] for k in extra)))
    for k in ("name", "score", "species"):
        if k not in body:
            raise Bad(k, f"{k} is missing.")
    name, why = clean_name(body["name"])
    if not name:
        raise Bad("name", why)
    sp = body["species"]
    if not isinstance(sp, dict):
        raise Bad("species", "species should be an object of counts.")
    unknown = set(sp) - set(SPECIES)
    if unknown:
        raise Bad("species", "Unknown species: " + ", ".join(sorted(str(k)[:20] for k in unknown)))
    counts = {s: _int(sp.get(s, 0), s, 0, DAY["species"][s]) for s in SPECIES}
    caught = sum(counts.values())
    if caught > DAY["caught"]:
        raise Bad("species", f"More than {DAY['caught']} catches is more than a day holds.")
    kinds = [s for s in SPECIES if counts[s] > 0]
    rarest = min(kinds, key=RARITY_RANK.get) if kinds else None
    if "rarest" in body and body["rarest"] != rarest:
        raise Bad("rarest", "rarest should be the rarest species caught (or null with none).")
    backpacks = _int(body.get("backpacks", 0), "backpacks", 0, DAY["backpacks"])
    if backpacks > caught + 1:
        raise Bad("backpacks", "More backpacks than lizards caught.")
    stars = _int(body.get("stars", 0), "stars", 0, DAY["stars"])
    score = _int(body["score"], "score", 0, score_cap(counts, backpacks))
    version = body.get("version", "")
    # (fullmatch: a pattern's $ would also let a final newline through)
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9._-]{0,24}", version):
        raise Bad("version", "version should be a short word.")
    # (a copy of the game from before Steady hands sends no mode: an assist day)
    mode = body.get("mode", "assist")
    if not isinstance(mode, str) or mode not in MODES:
        raise Bad("mode", "mode is assist or precise.")
    notebook = None
    if "notebook" in body:
        notebook = check_notebook(body["notebook"], counts, backpacks, stars, score)
    return {
        "name": name, "name_key": name_key(name), "score": score, "caught": caught, "species_n": len(kinds),
        **counts, "backpacks": backpacks, "rarest": rarest,
        "rarest_rank": RARITY_RANK[rarest] if rarest else NO_RAREST,
        "rarest_n": counts[rarest] if rarest else 0, "stars": stars, "version": version or "-", "mode": mode,
        "notebook": notebook,
    }


# ------------------------------------------------------------------ a day's notebook

# The snapshot the game sends with a day (src/game/daylog.js builds it; src/ui/daybook.js
# draws it). Everything in it comes from the game's own lists or is a bounded number: no
# text the player typed (their name is the row's, checked above). Unknown keys and wrong
# types are refused; numbers are clamped into range and rounded to their step; lists over
# their cap are refused. Positions are the game's metres (x east, z south of the lake),
# rounded to 0.5 m and kept inside the island's box.
NB_VERSION = 1
NB_SPECIES = {"crested": "cristatellus", "brown": "sagrei", "green": "carolinensis", "bark": "distichus", "knight": "equestris"}
NB_PERCH = ("trunk", "branch", "ground", "leaf", "palm_stem", "palm_frond", "log", "root")
NB_SEX = ("m", "f")
NB_DISPLAY = ("headbob", "pushup", "dewlap")
NB_KIND = ("sunny", "shady", "dappled")
NB_CODES = tuple("busmhdxf")  # a followed lizard's spells (src/ui/perch_day.js CODES)
# the game's nicknames (src/catch/tuning.js NICKNAMES)
NB_NICKS = ("Pip", "Mango", "Biscuit", "Clover", "Nutmeg", "Sprout", "Pickle", "Button", "Fern", "Toffee",
            "Moss", "Pebble", "Kiwi", "Bramble", "Hazel", "Juniper", "Pepper", "Sorrel", "Tamarind", "Wren")
# the stamps a day can earn (src/game/tasks.js TASKS ids)
NB_STAMPS = ("setup.kit", "setup.station", "setup.floss", "setup.practice",
             "crested.catch", "crested.dewlap", "crested.tag", "brown.ground", "brown.tag", "green.leaves", "green.catch",
             "bark.spot", "bark.catch", "knight.canopy", "knight.tag", "croc.spot",
             "field.loggers", "field.display", "field.creep", "field.tape", "field.gps",
             "perch.sunshade", "perch.wholeday", "perch.species",
             "kit.drone", "kit.tls", "kit.rtk", "kit.stars")
NB_PARTS = ("catch", "pack", "logger", "task", "kit", "spot", "other", "croc")
NB_WORK = ("spotted", "loggers", "gps", "clipped", "taped")
ISLAND = (-62.0, 82.0, -50.0, 52.0)  # x0, x1, z0, z1 (src/config.js topView)
NB_CAPS = {"catches": 60, "followed": 3, "runs": 40, "temps": 40, "trails": 5, "pts": 60, "stamps": 30}
COLOUR_RE = re.compile(r"^#[0-9a-f]{6}$")
FLAG_RE = re.compile(r"^[A-Z][0-9]{2}$")
# the aerial photo's thumbnail: a small JPEG as a data URL, nothing else
PHOTO_PREFIX = "data:image/jpeg;base64,"
PHOTO_BYTES = 40000
PHOTO_MAX_W = 480
PHOTO_MAX_H = 480


class _Nb:
    """Walks one snapshot, keeping the path for the message when something is wrong."""

    def __init__(self):
        self.path = []

    def bad(self, what):
        where = "notebook" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in self.path)
        raise Bad("notebook", f"{where} {what}"[:160])

    def at(self, p):
        return _At(self, p)

    def obj(self, v, keys, required=()):
        if not isinstance(v, dict):
            self.bad("should be an object.")
        extra = set(v) - set(keys)
        if extra:
            self.bad("has unknown keys: " + ", ".join(sorted(str(k)[:16] for k in extra)[:4]))
        for k in required:
            if k not in v:
                self.bad(f"is missing {k}.")
        return v

    def arr(self, v, cap):
        if not isinstance(v, list):
            self.bad("should be a list.")
        if len(v) > cap:
            self.bad(f"holds at most {cap}.")
        return v

    def num(self, v, lo, hi, step=None, null=False):
        if v is None and null:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            self.bad("should be a number.")
        if isinstance(v, int) and not lo <= v <= hi:
            v = hi if v > hi else lo  # (an int too big for a float is clamped first)
        v = min(hi, max(lo, float(v)))
        if step:
            v = round(round(v / step) * step, 6)
            v = min(hi, max(lo, v))
        return int(v) if step and float(step).is_integer() else v

    def one_of(self, v, options, null=False):
        if v is None and null:
            return None
        if not isinstance(v, str) or v not in options:
            self.bad("is not one the game knows.")
        return v

    def match(self, v, pattern, null=False):
        if v is None and null:
            return None
        # (fullmatch: with match, the pattern's $ would take a final newline too)
        if not isinstance(v, str) or not pattern.fullmatch(v):
            self.bad("is not in the game's form.")
        return v

    def flag(self, v):
        if not isinstance(v, bool):
            self.bad("should be true or false.")
        return v


class _At:
    def __init__(self, nb, p):
        self.nb, self.p = nb, p

    def __enter__(self):
        self.nb.path.append(self.p)
        return self.nb

    def __exit__(self, *exc):
        self.nb.path.pop()
        return False


def clean_jpeg(raw):
    """(the JPEG with its comment and application segments taken out, bar a plain JFIF
    header; (width, height)) or (None, why). Walks every marker from SOI to EOI, so
    nothing rides along after the picture."""
    n = len(raw)
    if n < 64 or raw[:2] != b"\xff\xd8" or raw[-2:] != b"\xff\xd9":
        return None, "is not a JPEG."
    sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    out = bytearray(b"\xff\xd8")
    i, size, scans = 2, None, 0
    while True:
        if i >= n or raw[i] != 0xFF:
            return None, "is not a well-formed JPEG."
        while i < n and raw[i] == 0xFF:
            i += 1
        if i >= n:
            return None, "is not a well-formed JPEG."
        m = raw[i]
        i += 1
        if m == 0xD9:
            if i != n:
                return None, "has something after the picture."
            break
        if m in (0x00, 0x01) or 0xD0 <= m <= 0xD8:
            return None, "is not a well-formed JPEG."
        if i + 2 > n:
            return None, "is cut short."
        length = (raw[i] << 8) | raw[i + 1]
        if length < 2 or i + length > n:
            return None, "is cut short."
        seg = raw[i:i + length]
        if m in sof:
            if length < 8 or size is not None:
                return None, "is not a plain JPEG."
            size = ((seg[5] << 8) | seg[6], (seg[3] << 8) | seg[4])
        keep = True
        if 0xE0 <= m <= 0xEF or m == 0xFE:
            keep = m == 0xE0 and length == 16 and seg[2:7] == b"JFIF\x00" and seg[14] == 0 and seg[15] == 0
        if keep:
            out += bytes((0xFF, m)) + seg
        i += length
        if m == 0xDA:
            if size is None:
                return None, "is not a well-formed JPEG."
            scans += 1
            # the picture's data runs to the next marker (FF 00 is a stuffed byte, FF D0 to
            # FF D7 a restart, FF FF a fill byte before a marker)
            j = i
            while j < n - 1:
                if raw[j] == 0xFF:
                    nxt = raw[j + 1]
                    if nxt == 0x00 or 0xD0 <= nxt <= 0xD7:
                        j += 2
                        continue
                    if nxt != 0xFF:
                        break
                j += 1
            out += raw[i:j]
            i = j
    if size is None or not scans:
        return None, "is not a well-formed JPEG."
    w, h = size
    if not (1 <= w <= PHOTO_MAX_W and 1 <= h <= PHOTO_MAX_H):
        return None, f"should be at most {PHOTO_MAX_W} by {PHOTO_MAX_H} pixels."
    out += b"\xff\xd9"
    return bytes(out), size


def check_photo(nb, v):
    if v is None:
        return None
    if not isinstance(v, str) or not v.startswith(PHOTO_PREFIX):
        nb.bad("should be a JPEG data URL.")
    data = v[len(PHOTO_PREFIX):]
    if len(data) > (PHOTO_BYTES + 2) // 3 * 4 or len(data) % 4 or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", data):
        nb.bad(f"should be a JPEG of {PHOTO_BYTES // 1000} KB at most, as base64.")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        nb.bad("is not base64.")
    if len(raw) > PHOTO_BYTES:
        nb.bad(f"should be a JPEG of {PHOTO_BYTES // 1000} KB at most.")
    jpeg, why = clean_jpeg(raw)
    if jpeg is None:
        nb.bad(why)
    return PHOTO_PREFIX + base64.b64encode(jpeg).decode("ascii")


def check_notebook(raw, counts, backpacks, stars, score):
    """The day's notebook as it will be kept (a new dict of checked values), or Bad. counts,
    backpacks, stars and score are the day's own (already checked): the notebook can't hold
    more catches of a species, more backpacks or more stars than the day, its points can't
    add up to more than the day's score, and its stamps can't be more than its points for
    them."""
    nb = _Nb()
    top = nb.obj(raw, ("v", "day", "looks", "parts", "work", "catches", "followed", "trails", "stamps", "kit"), ("v", "day"))
    with nb.at("v"):
        if isinstance(top["v"], bool) or top["v"] != NB_VERSION:
            nb.bad(f"should be {NB_VERSION}.")
    out = {"v": NB_VERSION}
    with nb.at("day"):
        out["day"] = nb.num(top["day"], 1, 9999, 1)
    X0, X1, Z0, Z1 = ISLAND
    if "looks" in top:
        with nb.at("looks"):
            lk = nb.obj(top["looks"], ("hat", "shirt"))
            out["looks"] = {}
            for k in ("hat", "shirt"):
                if k in lk:
                    with nb.at(k):
                        out["looks"][k] = nb.match(lk[k], COLOUR_RE)
    if "parts" in top:
        with nb.at("parts"):
            p = nb.obj(top["parts"], NB_PARTS)
            out["parts"] = {}
            for k in NB_PARTS:
                if k in p:
                    with nb.at(k):
                        out["parts"][k] = nb.num(p[k], 0, 5000 if k == "croc" else 20000, 1)
            # where the day's score came from: the croc's snaps take points away (never more
            # than were earned: the score stops at nothing), and what is left is the score
            # at most, so the summary page never contradicts the day
            P = out["parts"]
            earned = sum(v for k, v in P.items() if k != "croc")
            if "croc" in P:
                P["croc"] = min(P["croc"], earned)
            if earned - P.get("croc", 0) > score:
                nb.bad("adds up to more than the day's score.")
    if "work" in top:
        with nb.at("work"):
            w = nb.obj(top["work"], NB_WORK)
            out["work"] = {}
            for k in NB_WORK:
                if k in w:
                    with nb.at(k):
                        out["work"][k] = nb.num(w[k], 0, 999, 1)
    out["catches"] = []
    per = {k: 0 for k in NB_SPECIES}
    packs = 0
    with nb.at("catches"):
        for i, c in enumerate(nb.arr(top.get("catches", []), NB_CAPS["catches"])):
            with nb.at(i):
                nb.obj(c, ("sp", "sex", "svl", "perch", "h", "flag", "t", "nick", "pack", "disp", "x", "z"), ("sp", "t", "x", "z"))
                e = {}
                with nb.at("sp"):
                    e["sp"] = nb.one_of(c["sp"], NB_SPECIES)
                with nb.at("sex"):
                    e["sex"] = nb.one_of(c.get("sex"), NB_SEX, null=True)
                with nb.at("svl"):
                    e["svl"] = nb.num(c.get("svl"), 10, 250, 1, null=True)
                with nb.at("perch"):
                    e["perch"] = nb.one_of(c.get("perch"), NB_PERCH, null=True)
                with nb.at("h"):
                    e["h"] = nb.num(c.get("h", 0), 0, 30, 0.5)
                with nb.at("flag"):
                    e["flag"] = nb.match(c.get("flag"), FLAG_RE, null=True)
                with nb.at("t"):
                    e["t"] = nb.num(c["t"], 0, 24, 0.01)
                with nb.at("nick"):
                    e["nick"] = nb.one_of(c.get("nick"), NB_NICKS, null=True)
                with nb.at("pack"):
                    e["pack"] = nb.match(c.get("pack"), COLOUR_RE, null=True)
                with nb.at("disp"):
                    e["disp"] = nb.one_of(c.get("disp"), NB_DISPLAY, null=True)
                with nb.at("x"):
                    e["x"] = nb.num(c["x"], X0, X1, 0.5)
                with nb.at("z"):
                    e["z"] = nb.num(c["z"], Z0, Z1, 0.5)
                per[e["sp"]] += 1
                if per[e["sp"]] > counts[NB_SPECIES[e["sp"]]]:
                    nb.bad(f"is one more {e['sp']} anole than the day caught.")
                if e["pack"]:
                    packs += 1
                    if packs > backpacks:
                        nb.bad("has more backpacks than the day fitted.")
                out["catches"].append(e)
    out["followed"] = []
    with nb.at("followed"):
        for i, f in enumerate(nb.arr(top.get("followed", []), NB_CAPS["followed"])):
            with nb.at(i):
                nb.obj(f, ("nick", "sp", "sex", "col", "kind", "perch", "h", "clip", "upto", "whole", "runs", "temps"), ("sp", "clip", "upto"))
                e = {}
                with nb.at("nick"):
                    e["nick"] = nb.one_of(f.get("nick"), NB_NICKS, null=True)
                with nb.at("sp"):
                    e["sp"] = nb.one_of(f["sp"], NB_SPECIES)
                with nb.at("sex"):
                    e["sex"] = nb.one_of(f.get("sex"), NB_SEX, null=True)
                with nb.at("col"):
                    e["col"] = nb.match(f.get("col", "#ff7b54"), COLOUR_RE)
                with nb.at("kind"):
                    e["kind"] = nb.one_of(f.get("kind", "dappled"), NB_KIND)
                with nb.at("perch"):
                    e["perch"] = nb.one_of(f.get("perch"), NB_PERCH, null=True)
                with nb.at("h"):
                    e["h"] = nb.num(f.get("h", 0), 0, 30, 0.5)
                with nb.at("clip"):
                    e["clip"] = nb.num(f["clip"], 0, 24, 0.01)
                with nb.at("upto"):
                    e["upto"] = nb.num(f["upto"], e["clip"], 24, 0.01)
                with nb.at("whole"):
                    e["whole"] = nb.flag(f.get("whole", False))
                e["runs"] = []
                with nb.at("runs"):
                    for k, r in enumerate(nb.arr(f.get("runs", []), NB_CAPS["runs"])):
                        with nb.at(k):
                            if not isinstance(r, list) or len(r) != 2:
                                nb.bad("should be [hour, spell].")
                            with nb.at(0):
                                h = nb.num(r[0], 0, 24, 0.01)
                            with nb.at(1):
                                code = nb.one_of(r[1], NB_CODES)
                            e["runs"].append([h, code])
                e["temps"] = []
                with nb.at("temps"):
                    for k, r in enumerate(nb.arr(f.get("temps", []), NB_CAPS["temps"])):
                        with nb.at(k):
                            if not isinstance(r, list) or len(r) != 2:
                                nb.bad("should be [hour, degrees].")
                            with nb.at(0):
                                h = nb.num(r[0], 0, 24, 0.01)
                            with nb.at(1):
                                c = nb.num(r[1], -10, 60, 0.1)
                            e["temps"].append([h, c])
                out["followed"].append(e)
    out["trails"] = []
    with nb.at("trails"):
        for i, t in enumerate(nb.arr(top.get("trails", []), NB_CAPS["trails"])):
            with nb.at(i):
                nb.obj(t, ("nick", "sp", "pack", "pts"), ("sp", "pack", "pts"))
                if i + 1 > backpacks:
                    nb.bad("is one more trail than the day's backpacks.")
                e = {}
                with nb.at("nick"):
                    e["nick"] = nb.one_of(t.get("nick"), NB_NICKS, null=True)
                with nb.at("sp"):
                    e["sp"] = nb.one_of(t["sp"], NB_SPECIES)
                with nb.at("pack"):
                    e["pack"] = nb.match(t["pack"], COLOUR_RE)
                e["pts"] = []
                with nb.at("pts"):
                    for k, p in enumerate(nb.arr(t["pts"], NB_CAPS["pts"])):
                        with nb.at(k):
                            if not isinstance(p, list) or len(p) != 2:
                                nb.bad("should be [x, z].")
                            with nb.at(0):
                                x = nb.num(p[0], X0, X1, 0.5)
                            with nb.at(1):
                                z = nb.num(p[1], Z0, Z1, 0.5)
                            e["pts"].append([x, z])
                out["trails"].append(e)
    out["stamps"] = []
    with nb.at("stamps"):
        for i, s in enumerate(nb.arr(top.get("stamps", []), NB_CAPS["stamps"])):
            with nb.at(i):
                nb.one_of(s, NB_STAMPS)
                if s in out["stamps"]:
                    nb.bad("is there twice.")
                out["stamps"].append(s)
        # each stamp of the survey day scores TASK_STAMP (the set-up day's score nothing)
        earned = sum(1 for s in out["stamps"] if not s.startswith("setup."))
        if earned * TASK_STAMP > out.get("parts", {}).get("task", 0):
            nb.bad("holds more stamps than the day's points for them.")
    if "kit" in top:
        with nb.at("kit"):
            k = nb.obj(top["kit"], ("drone", "tls", "rtk"))
            out["kit"] = {}
            total = 0
            if "drone" in k:
                with nb.at("drone"):
                    d = nb.obj(k["drone"], ("stars", "photo"), ("stars",))
                    with nb.at("stars"):
                        st = nb.num(d["stars"], 0, 3, 1)
                    with nb.at("photo"):
                        photo = check_photo(nb, d.get("photo"))
                    out["kit"]["drone"] = {"stars": st, "photo": photo}
                    total += st
            if "tls" in k:
                with nb.at("tls"):
                    d = nb.obj(k["tls"], ("stars", "scans", "ghosts"))
                    e = {}
                    for key, hi in (("stars", 3), ("scans", 20), ("ghosts", 60)):
                        with nb.at(key):
                            e[key] = nb.num(d.get(key, 0), 0, hi, 1)
                    out["kit"]["tls"] = e
                    total += e["stars"]
            if "rtk" in k:
                with nb.at("rtk"):
                    d = nb.obj(k["rtk"], ("stars", "plants", "right"))
                    e = {}
                    for key, hi in (("stars", 3), ("plants", 30), ("right", 30)):
                        with nb.at(key):
                            e[key] = nb.num(d.get(key, 0), 0, hi, 1)
                    e["right"] = min(e["right"], e["plants"])
                    out["kit"]["rtk"] = e
                    total += e["stars"]
            if total > stars:
                nb.bad("has more stars than the day.")
    return out


def _no_dupes(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError("duplicate key")
        out[k] = v
    return out


def _no_constant(c):
    raise ValueError("not JSON: " + c)


def parse_json(raw):
    return json.loads(raw, object_pairs_hook=_no_dupes, parse_constant=_no_constant)


# ------------------------------------------------------------------ the database

NB_TRIGGER = """
CREATE TRIGGER IF NOT EXISTS scores_take_notebook AFTER DELETE ON scores
BEGIN DELETE FROM notebooks WHERE id = OLD.id; END;
"""
SCHEMA = """
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  score INTEGER NOT NULL,
  caught INTEGER NOT NULL,
  species_n INTEGER NOT NULL,
  cristatellus INTEGER NOT NULL,
  sagrei INTEGER NOT NULL,
  carolinensis INTEGER NOT NULL,
  distichus INTEGER NOT NULL,
  equestris INTEGER NOT NULL,
  backpacks INTEGER NOT NULL,
  rarest TEXT,
  rarest_rank INTEGER NOT NULL,
  rarest_n INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  version TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'assist'
);
CREATE TABLE IF NOT EXISTS notebooks (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_score ON scores (score DESC);
CREATE INDEX IF NOT EXISTS scores_name ON scores (name_key);
CREATE INDEX IF NOT EXISTS scores_by_best ON scores (name_key, score DESC, id);
CREATE INDEX IF NOT EXISTS scores_by_species ON scores (name_key, species_n DESC, caught DESC, score DESC, id);
CREATE INDEX IF NOT EXISTS scores_by_rarest ON scores (name_key, rarest_rank, rarest_n DESC, score DESC, id);
CREATE INDEX IF NOT EXISTS scores_by_backpacks ON scores (name_key, backpacks DESC, score DESC, id);
CREATE INDEX IF NOT EXISTS scores_by_steady ON scores (name_key, score DESC, id) WHERE mode = 'precise';
""" + NB_TRIGGER
# (each board's index walks a name's days in that board's order, so the best day of every
# name is found without sorting the whole table; a notebook's id is its day's id, and the
# trigger deletes it with its day, whichever script deletes the day)
ORDER_COLUMNS = "name_key, score, caught, species_n, rarest_rank, rarest_n, backpacks"
COLUMNS = ("name", "name_key", "score", "caught", "species_n") + SPECIES + (
    "backpacks", "rarest", "rarest_rank", "rarest_n", "stars", "version", "mode")

# Each board: which days count, the number it is ranked by (higher is better; days with the
# same number share a rank), and the full order (every name once, at its first row there).
BOARD_SQL = {
    "best": ("score > 0", "score", "score DESC, id ASC"),
    "species": ("species_n > 0", "species_n", "species_n DESC, caught DESC, score DESC, id ASC"),
    "rarest": ("rarest IS NOT NULL", "rarest_n - 1000 * rarest_rank", "rarest_rank ASC, rarest_n DESC, score DESC, id ASC"),
    "steady": ("score > 0 AND mode = 'precise'", "score", "score DESC, id ASC"),
    "backpacks": ("backpacks > 0", "backpacks", "backpacks DESC, score DESC, id ASC"),
}
# the boards the game shows: a name's best day on any of them keeps its notebook when the
# oldest are let go (Board.max_notebooks)
SHOWN = ("best", "species", "rarest", "steady")
CACHE_ROWS = 50  # each board is kept this long, and shorter lists are cut from it
NB_KEY_RE = re.compile(r"[A-Za-z0-9_-]{16}")  # (always fullmatch)


class BoardDown(Exception):
    """The database can't be used just now (missing folder, locked, read-only, damaged)."""


class Board:
    def __init__(self, path, max_rows=20000, max_notebooks=4000):
        self.path = os.path.abspath(path)
        self.max_rows = max_rows
        self.max_notebooks = max_notebooks
        self.keep_top = CACHE_ROWS  # each shown board's top rows keep their notebooks
        self.write_lock = threading.Lock()  # one writer at a time in this process
        self.migrate_lock = threading.Lock()
        self.version = 0  # bumped on every change, for the cache
        self.cache = {}
        self.cache_lock = threading.Lock()
        self.note_lock = threading.Lock()
        self.last_error = None
        self.migrated = None  # the backup made when this process brought an old database up to date
        self._copy = None  # (path, when) of a backup whose migration has not finished yet
        self._retry_at = 0.0  # no new try at the update before this (monotonic): one just failed
        self._tidied = False  # notebooks left without their day are tidied away once a process

    def _needs_migration(self, con):
        """What an older database lacks: (no mode column, no notebooks table), or None
        for a new or up-to-date one."""
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "scores" not in tables:
            return None
        cols = {r[1] for r in con.execute("PRAGMA table_info(scores)")}
        need = ("mode" not in cols, "notebooks" not in tables)
        return need if any(need) else None

    def _migrate(self, con):
        """Brings a database from before Steady hands up to date in place: a dated copy
        beside it first, then the mode column (every old day an assist day), the notebooks
        table and its trigger, in one transaction. Every row is kept. The database's write
        lock is held from before the copy to the end, so another process opening it at the
        same moment (the server starting while the daily backup runs, say) waits, then finds
        it done and makes no copy of its own. One thread here tries at a time; the others,
        and every try for a few seconds after one that could not finish (the database
        locked), are told the board is resting straight away. Nothing once it is done."""
        if not self._needs_migration(con):
            return
        if time.monotonic() < self._retry_at or not self.migrate_lock.acquire(blocking=False):
            raise BoardDown("the database is being brought up to date")
        try:
            con.execute("BEGIN IMMEDIATE")  # (waits the busy timeout for another writer)
            try:
                need = self._needs_migration(con)
                if not need:  # (done meanwhile by another process)
                    con.execute("COMMIT")
                    return
                # (a copy made for an attempt that could not finish is used again: nothing
                # can be added to an old database meanwhile)
                if self._copy and time.monotonic() - self._copy[1] < 600 and os.path.exists(self._copy[0]):
                    dest = self._copy[0]
                else:
                    dest = self._copy_before(con)
                if need[0]:
                    con.execute("ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'assist'")
                if need[1]:
                    con.execute("CREATE TABLE IF NOT EXISTS notebooks (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, body TEXT NOT NULL)")
                con.execute(NB_TRIGGER.strip())
                n = con.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                raise
        except (sqlite3.Error, OSError):
            self._retry_at = time.monotonic() + 5
            raise
        finally:
            self.migrate_lock.release()
        self.migrated = dest
        self._copy = None
        self.version += 1
        log(f"brought the database up to date for Steady hands and notebooks ({n} days kept, "
            f"each an assist day with no notebook); the copy from before is {dest}")

    def _copy_before(self, con):
        """The dated copy made before an update, beside the database (mode 600). con holds
        the write lock, so the copy is read through a second connection (readers may read
        while a writer waits to write)."""
        stem = os.path.splitext(self.path)[0]
        dest = stem + time.strftime("-before-steady-%Y%m%d-%H%M%S.db")
        k = 1
        while os.path.exists(dest):
            k += 1
            dest = stem + time.strftime("-before-steady-%Y%m%d-%H%M%S") + f"-{k}.db"
        src = sqlite3.connect(self.path, timeout=3.0)
        try:
            out = sqlite3.connect(dest)
            try:
                src.backup(out)
            finally:
                out.close()
        finally:
            src.close()
        os.chmod(dest, 0o600)
        self._copy = (dest, time.monotonic())
        return dest

    def _connect(self):
        folder = os.path.dirname(self.path)
        try:
            if not os.path.isdir(folder):
                os.makedirs(folder, mode=0o700, exist_ok=True)
            con = sqlite3.connect(self.path, timeout=3.0, isolation_level=None, check_same_thread=False)
        except (OSError, sqlite3.Error) as e:
            raise BoardDown(self._note(e))
        con.row_factory = sqlite3.Row
        try:
            con.execute("PRAGMA busy_timeout = 3000")
            try:
                con.execute("PRAGMA journal_mode = WAL")  # readers never wait on a writer
            except sqlite3.OperationalError:
                pass  # (locked or read-only just now: the next connection sets it)
            # an older database is brought up to date first (never while it can't be
            # written: it would only make copies)
            if self._needs_migration(con) and not self.read_only():
                self._migrate(con)
            try:
                con.executescript(SCHEMA)
            except sqlite3.OperationalError as e:
                # a read-only database still reads (an index it lacks is made on the next
                # connection that can write)
                if "readonly" not in str(e).replace(" ", "").replace("-", ""):
                    raise
            if not self._tidied:
                self._tidy(con)
        except BoardDown:
            con.close()
            raise
        except sqlite3.Error as e:
            con.close()
            raise BoardDown(self._note(e))
        except OSError as e:  # (the copy before an update could not be written)
            con.close()
            raise BoardDown(self._note(f"could not copy the database before updating it ({e.strerror or type(e).__name__})"))
        return con

    def _tidy(self, con):
        """Once a process: the notebooks whose day is gone go too (days deleted by a script
        from before the notebooks, on a database without the trigger yet). A quick read
        first; the delete, when there is one to do, is left for a later connection while
        the database can't be written or another thread is at it."""
        if time.monotonic() < self._retry_at:
            return
        try:
            if not con.execute("SELECT 1 FROM notebooks WHERE id NOT IN (SELECT id FROM scores) LIMIT 1").fetchone():
                self._tidied = True
                return
        except sqlite3.OperationalError:
            return
        if self.read_only() or not self.migrate_lock.acquire(blocking=False):
            return
        try:
            n = con.execute("DELETE FROM notebooks WHERE id NOT IN (SELECT id FROM scores)").rowcount
        except sqlite3.OperationalError:
            self._retry_at = time.monotonic() + 5
            return
        finally:
            self.migrate_lock.release()
        self._tidied = True
        self.version += 1
        log(f"let {n} notebook{'s' if n != 1 else ''} go whose day{'s were' if n != 1 else ' was'} gone")

    def _note(self, e):
        """Log why the database is unavailable, once for each new reason."""
        why = e if isinstance(e, str) else f"{type(e).__name__}: {e}"
        if isinstance(e, sqlite3.Error) and "readonly" in str(e).replace("-", "").replace(" ", ""):
            why = self.read_only() or why
        with self.note_lock:
            if why != self.last_error:
                log("database unavailable (" + why + ")")
                self.last_error = why
        return why

    def _fine(self):
        with self.note_lock:
            if self.last_error:
                log("database back: " + self.path)
                self.last_error = None

    def read_only(self):
        """None when the board can be written, else why not. A -wal or -shm file left
        read-only (SQLite makes them with the database file's mode, so a spell with a
        read-only database leaves them so) is made writable again when the database file
        itself is writable and the file is this user's own."""
        folder = os.path.dirname(self.path)
        if not os.access(folder, os.W_OK | os.X_OK):
            return f"the folder {folder} is read-only for this user"
        if os.path.exists(self.path) and not os.access(self.path, os.W_OK):
            return f"{self.path} is read-only for this user"
        for suffix in ("-wal", "-shm", "-journal"):
            p = self.path + suffix
            try:
                if not os.path.exists(p) or os.access(p, os.W_OK):
                    continue
                if os.stat(p).st_uid == os.getuid():
                    os.chmod(p, 0o600)
                    log(f"made {os.path.basename(p)} writable again (it was left read-only)")
                    continue
            except OSError:
                pass
            return f"{p} is read-only: stop the server, delete that file and start it again"
        return None

    def ok(self):
        """True when the board can be read and written."""
        if os.path.isdir(os.path.dirname(self.path)):
            why = self.read_only()  # (first, so a -wal or -shm left read-only is put right)
            if why:
                self._note(why)
                return False
        try:
            con = self._connect()
            try:
                con.execute("SELECT 1 FROM scores LIMIT 1").fetchall()
            finally:
                con.close()
        except (BoardDown, sqlite3.Error) as e:
            if isinstance(e, sqlite3.Error):
                self._note(e)
            return False
        why = self.read_only()
        if why:
            self._note(why)
            return False
        self._fine()
        return True

    @staticmethod
    def _row_out(r, rank, tie=False, nb=None):
        kinds = [s for s in SPECIES if r[s] > 0]
        return {"rank": rank, "tie": bool(tie), "name": r["name"], "score": r["score"], "species": r["species_n"],
                "caught": r["caught"], "kinds": kinds, "rarest": r["rarest"], "rarestN": r["rarest_n"],
                "backpacks": r["backpacks"], "stars": r["stars"], "nb": nb}

    @staticmethod
    def _nb_keys(con, ids):
        """The notebook keys of these days (those that have one)."""
        ids = [i for i in ids if i is not None]
        if not ids:
            return {}
        marks = ", ".join("?" for _ in ids)
        return {r[0]: r[1] for r in con.execute(f"SELECT id, key FROM notebooks WHERE id IN ({marks})", ids)}

    @staticmethod
    def _board_rows(con, board, limit):
        """The best row of each name on a board, in order, with shared ranks (one more row
        is read so the last one's tie is known)."""
        where, key, order = BOARD_SQL[board]
        cols = ", ".join(COLUMNS)
        rows = con.execute(
            f"SELECT id, {cols}, ({key}) AS k FROM scores WHERE id IN (SELECT id FROM (SELECT id, {ORDER_COLUMNS}, "
            f"ROW_NUMBER() OVER (PARTITION BY name_key ORDER BY {order}) AS n FROM scores WHERE {where}) "
            f"WHERE n = 1 ORDER BY {order} LIMIT ?) ORDER BY {order}", (limit + 1,)).fetchall()
        keys = Board._nb_keys(con, [r["id"] for r in rows[:limit]])
        out, rank = [], 0
        for i, r in enumerate(rows[:limit]):
            if i == 0 or r["k"] != rows[i - 1]["k"]:
                rank = i + 1
            tie = (i > 0 and rows[i - 1]["k"] == r["k"]) or (i + 1 < len(rows) and rows[i + 1]["k"] == r["k"])
            out.append(Board._row_out(r, rank, tie, keys.get(r["id"])))
        return out

    def top(self, board, limit):
        with self.cache_lock:
            hit = self.cache.get(board)
            if hit and hit[0] == self.version and time.monotonic() - hit[1] < 10:
                data = hit[2]
                return {"rows": data["rows"][:limit], "total": data["total"], "names": data["names"]}
        version = self.version
        try:
            con = self._connect()
            try:
                rows = self._board_rows(con, board, CACHE_ROWS)
                total = con.execute(f"SELECT COUNT(DISTINCT name_key) FROM scores WHERE {BOARD_SQL[board][0]}").fetchone()[0]
                names = con.execute("SELECT COUNT(DISTINCT name_key) FROM scores").fetchone()[0]
            finally:
                con.close()
        except sqlite3.Error as e:
            raise BoardDown(self._note(e))
        data = {"rows": rows, "total": total, "names": names}
        with self.cache_lock:
            if version == self.version:
                self.cache[board] = (version, time.monotonic(), data)
        return {"rows": rows[:limit], "total": total, "names": names}

    @staticmethod
    def _standing(con, board, nk, new_id):
        """Where a name stands on a board after a day was added (its best day there), whether
        that day is its best, and where the day alone would stand among the others."""
        where, key, _ = BOARD_SQL[board]
        mine = con.execute(f"SELECT MAX({key}) FROM scores WHERE ({where}) AND name_key = ?", (nk,)).fetchone()[0]
        day = con.execute(f"SELECT ({key}) FROM scores WHERE ({where}) AND id = ?", (new_id,)).fetchone()
        day_k = day[0] if day else None
        others, gt, eq, dgt, deq = con.execute(
            f"SELECT COUNT(*), SUM(m > ?), SUM(m = ?), SUM(m > ?), SUM(m = ?) FROM "
            f"(SELECT MAX({key}) AS m FROM scores WHERE ({where}) AND name_key != ? GROUP BY name_key)",
            (mine, mine, day_k, day_k, nk)).fetchone()
        if mine is None:
            return {"rank": None, "tie": False, "total": others, "best": False, "day": None}
        return {"rank": 1 + (gt or 0), "tie": bool(eq), "total": others + 1, "best": day_k is not None and day_k >= mine,
                "day": None if day_k is None else {"rank": 1 + (dgt or 0), "tie": bool(deq)}}

    def _prune(self, con, new_id):
        """Past max_notebooks the oldest notebooks go, except the day just posted and the
        ones the game can show: the top CACHE_ROWS of each board it shows (so never more
        than max_notebooks + 4 * CACHE_ROWS)."""
        n = con.execute("SELECT COUNT(*) FROM notebooks").fetchone()[0]
        if n <= self.max_notebooks:
            return 0
        keep = " UNION ".join(
            f"SELECT id FROM (SELECT id FROM (SELECT id, {ORDER_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY name_key "
            f"ORDER BY {BOARD_SQL[b][2]}) AS n FROM scores WHERE {BOARD_SQL[b][0]}) WHERE n = 1 "
            f"ORDER BY {BOARD_SQL[b][2]} LIMIT {int(self.keep_top)})" for b in SHOWN)
        return con.execute(
            f"DELETE FROM notebooks WHERE id IN (SELECT id FROM notebooks WHERE id != ? AND id NOT IN ({keep}) "
            f"ORDER BY id LIMIT ?)", (new_id, n - self.max_notebooks)).rowcount

    def add(self, row, limit=10):
        """Insert a day (and its notebook); where its name now stands on each board, and the
        top of the best-day board (and of Steady hands, for a precise day)."""
        nk = row["name_key"]
        steady = row.get("mode") == "precise"
        body = None
        if row.get("notebook") is not None:
            body = json.dumps(row["notebook"], ensure_ascii=True, separators=(",", ":"))
        with self.write_lock:
            try:
                con = self._connect()
                try:
                    con.execute("BEGIN IMMEDIATE")
                    n = con.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
                    if n >= self.max_rows:
                        con.execute("ROLLBACK")
                        raise BoardDown("full")
                    marks = ", ".join("?" for _ in COLUMNS)
                    cur = con.execute(f"INSERT INTO scores ({', '.join(COLUMNS)}) VALUES ({marks})",
                                      [row.get(c, "assist") if c == "mode" else row[c] for c in COLUMNS])
                    new_id = cur.lastrowid
                    # (SQLite hands out the highest id again once it is deleted: a notebook
                    # left under it, by an older script, is never this day's)
                    con.execute("DELETE FROM notebooks WHERE id = ?", (new_id,))
                    if body is not None:
                        # a random key (never the row's id) names the notebook for day/<key>
                        for _ in range(5):
                            key = secrets.token_urlsafe(12)
                            if not con.execute("SELECT 1 FROM notebooks WHERE key = ?", (key,)).fetchone():
                                break
                        con.execute("INSERT INTO notebooks (id, key, body) VALUES (?, ?, ?)", (new_id, key, body))
                        self._prune(con, new_id)
                    stand = {board: self._standing(con, board, nk, new_id) for board in BOARDS}
                    cols = ", ".join(COLUMNS)
                    best_row = con.execute(
                        f"SELECT id, {cols} FROM scores WHERE score > 0 AND name_key = ? ORDER BY {BOARD_SQL['best'][2]} LIMIT 1",
                        (nk,)).fetchone()
                    steady_row = con.execute(
                        f"SELECT id, {cols} FROM scores WHERE {BOARD_SQL['steady'][0]} AND name_key = ? ORDER BY {BOARD_SQL['steady'][2]} LIMIT 1",
                        (nk,)).fetchone() if steady else None
                    day_row = con.execute(f"SELECT id, {cols} FROM scores WHERE id = ?", (new_id,)).fetchone()
                    keys = self._nb_keys(con, [r["id"] for r in (best_row, steady_row, day_row) if r is not None])
                    con.execute("COMMIT")
                except BaseException:
                    if con.in_transaction:
                        con.execute("ROLLBACK")
                    raise
                finally:
                    con.close()
            except sqlite3.Error as e:
                raise BoardDown(self._note(e))
            self.version += 1
        self._fine()

        def out_row(r, place):
            return self._row_out(r, place["rank"], place["tie"], keys.get(r["id"])) if r is not None else None

        b = stand["best"]
        you = out_row(best_row, b) if best_row is not None and b["rank"] else None
        today = out_row(day_row, b["day"]) if b["day"] else None
        top = self.top("best", limit)
        # the standing on each board; Steady hands only for a precise day (an assist day is
        # never on it, whatever the name did on other days)
        if not steady:
            stand["steady"] = {"rank": None, "tie": False, "best": False}
        answer = {
            "rank": b["rank"], "tie": b["tie"], "total": b["total"], "best": b["best"] or b["rank"] is None,
            "day": b["day"], "ranks": {k: v["rank"] for k, v in stand.items()},
            "ties": {k: v["tie"] for k, v in stand.items()}, "bests": {k: v["best"] for k, v in stand.items()},
            "board": top["rows"], "you": you, "today": today, "steady": None, "notebook": body is not None,
        }
        if steady:
            s = stand["steady"]
            answer["steady"] = {
                "rank": s["rank"], "tie": s["tie"], "total": s["total"], "best": s["best"] or s["rank"] is None, "day": s["day"],
                "board": self.top("steady", limit)["rows"],
                "you": out_row(steady_row, s) if steady_row is not None and s["rank"] else None,
                "today": out_row(day_row, s["day"]) if s["day"] else None,
            }
        return answer

    def notebook(self, key):
        """One day's notebook by its key: { name, score, steady, ..., notebook } or None."""
        if not isinstance(key, str) or not NB_KEY_RE.fullmatch(key):
            return None
        try:
            con = self._connect()
            try:
                r = con.execute(
                    "SELECT s.name, s.score, s.species_n, s.caught, s.mode, s.cristatellus, s.sagrei, s.carolinensis, "
                    "s.distichus, s.equestris, n.body FROM notebooks AS n JOIN scores AS s ON s.id = n.id WHERE n.key = ?",
                    (key,)).fetchone()
            finally:
                con.close()
        except sqlite3.Error as e:
            raise BoardDown(self._note(e))
        if r is None:
            return None
        try:
            body = json.loads(r["body"])
        except ValueError:
            return None
        return {"name": r["name"], "score": r["score"], "steady": r["mode"] == "precise", "species": r["species_n"],
                "caught": r["caught"], "kinds": [s for s in SPECIES if r[s] > 0], "notebook": body}

    # upkeep
    def remove_name(self, name):
        key = name_key(name)
        with self.write_lock:
            con = self._connect()
            try:
                con.execute("BEGIN IMMEDIATE")
                con.execute("DELETE FROM notebooks WHERE id IN (SELECT id FROM scores WHERE name_key = ?)", (key,))
                n = con.execute("DELETE FROM scores WHERE name_key = ?", (key,)).rowcount
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                raise
            finally:
                con.close()
            self.version += 1
        return n

    def drop_photo(self, name):
        """Takes the aerial photo out of every notebook under a name (the days and the rest
        of their notebooks stay). Returns how many notebooks had one."""
        key = name_key(name)
        n = 0
        with self.write_lock:
            con = self._connect()
            try:
                con.execute("BEGIN IMMEDIATE")
                rows = con.execute("SELECT n.id, n.body FROM notebooks AS n JOIN scores AS s ON s.id = n.id "
                                   "WHERE s.name_key = ?", (key,)).fetchall()
                for r in rows:
                    try:
                        body = json.loads(r["body"])
                    except ValueError:
                        continue
                    kit = body.get("kit") if isinstance(body, dict) else None
                    drone = kit.get("drone") if isinstance(kit, dict) else None
                    if isinstance(drone, dict) and drone.get("photo"):
                        drone["photo"] = None
                        con.execute("UPDATE notebooks SET body = ? WHERE id = ?",
                                    (json.dumps(body, ensure_ascii=True, separators=(",", ":")), r["id"]))
                        n += 1
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                raise
            finally:
                con.close()
            self.version += 1
        return n

    def remove_notebook(self, key):
        """Takes one day's notebook off by its key (the day stays, with no notebook).
        Returns 1, or 0 when there is none by that key."""
        if not isinstance(key, str) or not NB_KEY_RE.fullmatch(key):
            return 0
        with self.write_lock:
            con = self._connect()
            try:
                n = con.execute("DELETE FROM notebooks WHERE key = ?", (key,)).rowcount
            finally:
                con.close()
            self.version += 1
        return n

    def backup(self, dest, keep=7):
        """Copy the database to dest; to a folder (an existing one, or a path ending in /)
        as scores-YYYYMMDD-HHMMSS.db, keeping the newest `keep` of those. Returns the file."""
        folder = dest.endswith(("/", os.sep)) or os.path.isdir(dest)
        if folder:
            os.makedirs(dest, mode=0o700, exist_ok=True)
            dest = os.path.join(dest, time.strftime("scores-%Y%m%d-%H%M%S.db"))
        con = self._connect()
        try:
            out = sqlite3.connect(dest)
            try:
                con.backup(out)
            finally:
                out.close()
        finally:
            con.close()
        if folder and keep > 0:
            where = os.path.dirname(dest)
            old = sorted(f for f in os.listdir(where) if re.fullmatch(r"scores-\d{8}-\d{6}\.db", f))
            for f in old[:-keep]:
                os.remove(os.path.join(where, f))
        return dest

    def clear(self):
        with self.write_lock:
            con = self._connect()
            try:
                con.execute("DELETE FROM notebooks")
                n = con.execute("DELETE FROM scores").rowcount
                con.execute("VACUUM")
            finally:
                con.close()
            self.version += 1
        return n


# ------------------------------------------------------------------ rate limits

class Limits:
    """In memory only, keyed by a hash of the client's address with a secret made at
    start-up, so nothing that names a client outlives the process."""

    def __init__(self, gap=20.0, per_day=60, attempts_per_min=12, reads_per_min=240, all_per_min=120):
        self.gap, self.per_day = gap, per_day
        self.attempts_per_min, self.reads_per_min, self.all_per_min = attempts_per_min, reads_per_min, all_per_min
        self.secret = secrets.token_bytes(32)
        self.lock = threading.Lock()
        self.posts = {}  # key -> [last accepted, window start, count in window]
        self.tries = {}  # key -> [minute start, count]  (every POST, good or bad)
        self.reads = {}  # key -> [minute start, count]
        self.all = [0.0, 0]  # accepted posts from everyone, per minute

    def key(self, addr):
        return hmac.new(self.secret, addr.encode("utf-8", "replace"), hashlib.sha256).hexdigest()[:20]

    def _tidy(self, now):
        # never let the tables grow without bound
        for table, age in ((self.posts, 86400), (self.tries, 60), (self.reads, 60)):
            if len(table) > 20000:
                for k in [k for k, v in table.items() if now - v[0] > age][:10000]:
                    del table[k]
                if len(table) > 20000:
                    table.clear()

    @staticmethod
    def _count(table, key, now, cap):
        rec = table.get(key)
        if not rec or now - rec[0] >= 60:
            rec = table[key] = [now, 0]
        if rec[1] >= cap:
            return max(1, int(60 - (now - rec[0])) + 1)
        rec[1] += 1
        return 0

    def read(self, key, now):
        with self.lock:
            self._tidy(now)
            return self._count(self.reads, key, now, self.reads_per_min)

    def attempt(self, key, now):
        with self.lock:
            self._tidy(now)
            return self._count(self.tries, key, now, self.attempts_per_min)

    def reserve(self, key, now):
        """Check and take a post's place in one step: (0, undo) when a day may be posted
        (hand undo to release() if it could not be kept), else (seconds to wait, None)."""
        with self.lock:
            rec = self.posts.get(key)
            if rec:
                if now - rec[0] < self.gap:
                    return max(1, int(self.gap - (now - rec[0])) + 1), None
                if now - rec[1] < 86400 and rec[2] >= self.per_day:
                    return max(1, int(86400 - (now - rec[1])) + 1), None
            if now - self.all[0] < 60 and self.all[1] >= self.all_per_min:
                return max(1, int(60 - (now - self.all[0])) + 1), None
            undo = list(rec) if rec else None
            if not rec or now - rec[1] >= 86400:
                rec = self.posts[key] = [now, now, 0]
            rec[0] = now
            rec[2] += 1
            if now - self.all[0] >= 60:
                self.all = [now, 0]
            self.all[1] += 1
            return 0, undo

    def release(self, key, undo):
        """Give back a reserved place (the day could not be stored)."""
        with self.lock:
            if undo is None:
                self.posts.pop(key, None)
            else:
                self.posts[key] = undo
            self.all[1] = max(0, self.all[1] - 1)


# ------------------------------------------------------------------ the server

def log(msg):
    sys.stderr.write(time.strftime("%Y-%m-%d %H:%M:%S ") + "board: " + msg + "\n")
    sys.stderr.flush()


BLOCKED_STATIC = re.compile(r"(^|/)\.|\.(db|sqlite|sqlite3|db-wal|db-shm|db-journal|wal|shm)$", re.I)


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "IslandBoard/1"
    sys_version = ""
    protocol_version = "HTTP/1.0"
    timeout = 15  # each read; the server drops any request still open after 20 s in all
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
        ".css": "text/css", ".wasm": "application/wasm", ".md": "text/plain; charset=utf-8",
    }

    # set by make_handler
    board = None
    limits = None
    base = "/api/"
    static = None
    trust_proxy = True

    def __init__(self, *args, **kwargs):
        # (with no --static the folder is never read: other paths answer 404)
        super().__init__(*args, directory=self.static or os.path.dirname(os.path.abspath(__file__)), **kwargs)

    # ---- plumbing
    def version_string(self):
        return self.server_version

    def log_message(self, fmt, *args):
        pass  # no addresses in the logs; api calls log a line of their own

    def log_error(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if not self._api:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    _api = False

    def client(self):
        addr = self.client_address[0]
        if self.trust_proxy:
            try:
                loop = ipaddress.ip_address(addr).is_loopback
            except ValueError:
                loop = False
            if loop:
                real = (self.headers.get("X-Real-IP") or "").strip()
                if not real:
                    fwd = [p.strip() for p in (self.headers.get("X-Forwarded-For") or "").split(",") if p.strip()]
                    real = fwd[-1] if fwd else ""
                if real and len(real) <= 64:
                    addr = real
        return addr

    _say = ""

    def send_json(self, status, obj, headers=None, head=False):
        if self.command == "POST" or status >= 400:
            what = urllib.parse.urlsplit(self.path).path[len(self.base):] if self._api else "-"
            why = obj.get("error") if status >= 400 else None
            log(f"{self.command} {what[:24] or '/'} {status}" + (f" ({why})" if why else "") + self._say)
        data = json.dumps(obj, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head:
            try:
                self.wfile.write(data)
            except OSError:
                pass

    def fail(self, status, error, message, headers=None, head=False):
        self.send_json(status, {"ok": False, "error": error, "message": message}, headers, head)

    def route(self):
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith(self.base):
            self._api = True
            return path[len(self.base):]
        if path + "/" == self.base:
            self._api = True
            return ""
        return None

    # ---- methods
    def do_GET(self):
        self._get(head=False)

    def do_HEAD(self):
        self._get(head=True)

    def _get(self, head):
        sub = self.route()
        if sub is None:
            return self.static_file(head)
        key = self.limits.key(self.client())
        wait = self.limits.read(key, time.time())
        if wait:
            return self.fail(429, "slow-down", "Too many requests. Try again in a moment.", {"Retry-After": str(wait)}, head)
        if sub == "ping":
            return self.send_json(200, {"ok": True, "app": APP, "v": API_VERSION, "board": self.board.ok()}, head=head)
        if sub == "scores":
            try:
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query, max_num_fields=8)
            except ValueError:
                return self.fail(400, "query", "Too many parameters.", head=head)
            board = (q.get("board") or ["best"])[0]
            if board not in BOARDS:
                return self.fail(400, "board", "board is one of: " + ", ".join(BOARDS), head=head)
            raw_limit = (q.get("limit") or ["10"])[0]
            if not re.fullmatch("[0-9]{1,2}", raw_limit) or not 1 <= int(raw_limit) <= CACHE_ROWS:
                return self.fail(400, "limit", f"limit is a number from 1 to {CACHE_ROWS}.", head=head)
            try:
                top = self.board.top(board, int(raw_limit))
            except BoardDown:
                return self.fail(503, "resting", "The island board is resting. Try again soon.", {"Retry-After": "30"}, head)
            return self.send_json(200, {"ok": True, "board": board, "rows": top["rows"], "total": top["total"],
                                        "names": top["names"]}, head=head)
        if sub.startswith("day/"):
            if urllib.parse.urlsplit(self.path).query:
                return self.fail(400, "query", "day/<key> takes no parameters.", head=head)
            try:
                day = self.board.notebook(sub[4:])
            except BoardDown:
                return self.fail(503, "resting", "The island board is resting. Try again soon.", {"Retry-After": "30"}, head)
            if day is None:
                return self.fail(404, "not-found", "No notebook for this day.", head=head)
            return self.send_json(200, {"ok": True, **day}, head=head)
        return self.fail(404, "not-found", "Nothing here.", head=head)

    def do_POST(self):
        sub = self.route()
        if sub is None:
            return self.fail(405, "method", "Not allowed here.", {"Allow": "GET, HEAD"})
        if sub != "scores":
            return self.fail(405 if sub == "ping" else 404, "method" if sub == "ping" else "not-found", "Not allowed here.",
                             {"Allow": "GET, HEAD"} if sub == "ping" else None)
        t0 = time.monotonic()
        now = time.time()
        key = self.limits.key(self.client())
        self.close_connection = True
        wait = self.limits.attempt(key, now)
        if wait:
            return self.fail(429, "slow-down", "Too many tries. Try again in a minute.", {"Retry-After": str(wait)})
        origin = self.headers.get("Origin")
        if origin and origin != "null":
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
            try:
                o = (urllib.parse.urlsplit(origin).hostname or "").lower()
            except ValueError:  # 'http://[::1', 'http://[foo]': not a page of ours
                o = None
            if not host or o != host:
                return self.fail(403, "origin", "Posts come from the game's own page.")
        if self.headers.get("Transfer-Encoding"):
            return self.fail(411, "length", "Send a Content-Length.")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return self.fail(415, "type", "Send JSON (Content-Type: application/json).")
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return self.fail(411, "length", "Send a Content-Length.")
        try:
            n = int(raw_len)
        except ValueError:
            return self.fail(400, "length", "Content-Length is a number.")
        if n < 0:
            return self.fail(400, "length", "Content-Length is a number.")
        if n > MAX_BODY:
            return self.fail(413, "too-big", f"Bodies are {MAX_BODY} bytes at most.")
        try:
            raw = self.rfile.read(n)
        except OSError:
            return
        if len(raw) != n:
            return self.fail(400, "short", "The body was cut short.")
        try:
            body = parse_json(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            return self.fail(400, "json", "The body is not valid JSON.")
        try:
            row = check_day(body)
        except Bad as b:
            return self.fail(400, b.field, b.message)
        # the check and the record are one step, so posts sent at the same moment cannot
        # all slip through
        wait, undo = self.limits.reserve(key, now)
        if wait:
            return self.fail(429, "slow-down", "One day at a time: try again in a little while.", {"Retry-After": str(wait)})
        try:
            out = self.board.add(row)
        except BoardDown as e:
            self.limits.release(key, undo)
            full = str(e) == "full"
            return self.fail(503, "full" if full else "resting",
                             "The island board is full." if full else "The island board is resting. Try again soon.",
                             {"Retry-After": "30"})
        except BaseException:
            self.limits.release(key, undo)
            raise
        steady = out.get("steady")
        self._say = (f" rank {out['rank']} of {out['total']}{'' if out['best'] else ' (an earlier day is better)'}"
                     + (f", steady hands {steady['rank']} of {steady['total']}" if steady else "")
                     + (", with a notebook" if out.get("notebook") else "")
                     + f" ({(time.monotonic() - t0) * 1000:.0f} ms)")
        self.send_json(201, {"ok": True, **out})

    def _not_allowed(self):
        sub = self.route()
        if sub is None and not self.static:
            return self.fail(404, "not-found", "Nothing here.")
        self.fail(405, "method", "Not allowed here.", {"Allow": "GET, HEAD, POST" if sub == "scores" else "GET, HEAD"})

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_TRACE = do_CONNECT = _not_allowed

    # ---- the game's files (--static, for local testing)
    def static_file(self, head):
        if not self.static:
            return self.fail(404, "not-found", "Nothing here.", head=head)
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if "\x00" in path or BLOCKED_STATIC.search(path):
            self.send_error(404)
            return
        try:
            full = self.translate_path(self.path)
            if os.path.isdir(full) and not os.path.isfile(os.path.join(full, "index.html")):
                self.send_error(404)
                return
        except (OSError, ValueError):
            self.send_error(404)
            return
        if head:
            return super().do_HEAD()
        return super().do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None


class BoardServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64
    deadline = 20.0  # seconds a request may take in all, however slowly it trickles in

    def __init__(self, addr, handler, max_threads=48):
        super().__init__(addr, handler)
        self.slots = threading.BoundedSemaphore(max_threads)
        self.live = {}  # the open requests' sockets -> when they came in
        self.live_lock = threading.Lock()
        self.watching = True
        threading.Thread(target=self._watch, name="board-deadline", daemon=True).start()

    def _watch(self):
        # a request still open after the deadline is cut off, so a client sending a byte now
        # and then cannot hold a thread for long
        while self.watching:
            time.sleep(1.0)
            now = time.monotonic()
            with self.live_lock:
                old = [s for s, t in self.live.items() if now - t > self.deadline]
                for s in old:
                    del self.live[s]
            for s in old:
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            if old:
                log(f"cut off {len(old)} request{'s' if len(old) > 1 else ''} still open after {self.deadline:.0f} s")

    def server_close(self):
        self.watching = False
        super().server_close()

    def handle_error(self, request, client_address):
        # one short line, never the client's address or a traceback
        e = sys.exc_info()[1]
        if isinstance(e, OSError):
            return  # (the client went away, or its request was cut off)
        log(f"a request failed ({type(e).__name__})")

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        with self.live_lock:
            self.live[request] = time.monotonic()
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self.live_lock:
                self.live.pop(request, None)
            self.slots.release()


def make_handler(board, limits, base, static, trust_proxy):
    return type("BoardHandler", (Handler,), {
        "board": board, "limits": limits, "base": base, "static": static, "trust_proxy": trust_proxy,
    })


def default_db():
    return os.path.join(os.path.expanduser("~"), "field-season-board", "scores.db")


def main(argv=None):
    ap = argparse.ArgumentParser(description="The island board for Stroud Lab: Field Season.")
    ap.add_argument("--host", default="127.0.0.1", help="address to bind (default 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8779, help="port (default 8779)")
    ap.add_argument("--db", default=default_db(), help="the SQLite file, outside the web root (default ~/field-season-board/scores.db)")
    ap.add_argument("--base", default="/api/", help="the API's path (default /api/)")
    ap.add_argument("--static", default=None, help="also serve the game from this folder (local testing)")
    ap.add_argument("--max-rows", type=int, default=20000, help="refuse new days past this many (default 20000)")
    ap.add_argument("--max-notebooks", type=int, default=4000,
                    help="keep about this many day notebooks: past it the oldest go, but never the top 50 of a board "
                         "the game shows, so at most this many plus 200 (default 4000)")
    ap.add_argument("--no-proxy", action="store_true", help="ignore X-Real-IP even from 127.0.0.1")
    ap.add_argument("--show", action="store_true", help="print the boards and exit")
    ap.add_argument("--backup", metavar="FILE", help="copy the database to FILE (or into a folder, dated) and exit")
    ap.add_argument("--keep", type=int, default=7, help="with --backup to a folder: dated copies to keep (default 7)")
    ap.add_argument("--reset", action="store_true", help="back the database up beside itself, empty the board and exit")
    ap.add_argument("--remove-name", metavar="NAME", help="take every day under NAME off the board and exit")
    ap.add_argument("--drop-photo", metavar="NAME", help="take the aerial photo out of NAME's notebooks (the days stay) and exit")
    ap.add_argument("--remove-notebook", metavar="KEY", help="take one day's notebook off (its key is the row's nb, "
                                                             "as --show prints it; the day stays) and exit")
    ap.add_argument("--check-name", metavar="NAME", help="say whether the board would take NAME and exit")
    a = ap.parse_args(argv)

    os.umask(0o077)  # the database and its journal are the server user's alone
    base = "/" + a.base.strip("/") + "/" if a.base.strip("/") else "/"
    board = Board(a.db, a.max_rows, a.max_notebooks)

    if a.check_name is not None:
        name, why = clean_name(a.check_name)
        print(f"ok: {name!r}" if name else f"refused: {why}")
        return 0 if name else 1
    if sqlite3.sqlite_version_info < (3, 25, 0):
        print(f"the board needs SQLite 3.25 or later; this Python has {sqlite3.sqlite_version}", file=sys.stderr)
        return 2
    try:
        if a.show:
            for b in BOARDS:
                top = board.top(b, 5)
                print(f"{b} ({top['total']} names)")
                for r in top["rows"]:
                    rank = ("=" if r["tie"] else "") + str(r["rank"])
                    print(f"  {rank:>3}. {r['name']:<14} score {r['score']:>6}  species {r['species']}  "
                          f"caught {r['caught']}  rarest {r['rarest'] or '-'} x{r['rarestN']}  backpacks {r['backpacks']}  stars {r['stars']}"
                          + (f"  notebook {r['nb']}" if r.get("nb") else ""))
            return 0
        if a.backup:
            print("backed up to " + os.path.abspath(board.backup(a.backup, a.keep)))
            return 0
        if a.reset:
            dest = os.path.splitext(board.path)[0] + time.strftime("-before-reset-%Y%m%d-%H%M%S.db")
            board.backup(dest)
            n = board.clear()
            print(f"backed up to {dest}; {n} days taken off the board")
            return 0
        if a.remove_name is not None:
            n = board.remove_name(a.remove_name)
            print(f"{n} days under {a.remove_name!r} taken off the board")
            return 0
        if a.drop_photo is not None:
            n = board.drop_photo(a.drop_photo)
            print(f"the aerial photo taken out of {n} notebook{'s' if n != 1 else ''} under {a.drop_photo!r}")
            return 0
        if a.remove_notebook is not None:
            n = board.remove_notebook(a.remove_notebook)
            print(f"the notebook {a.remove_notebook!r} taken off" if n else f"no notebook {a.remove_notebook!r} on the board")
            return 0 if n else 1
    except (BoardDown, sqlite3.Error, OSError) as e:
        print(f"could not use the database: {e}", file=sys.stderr)
        return 2

    static = os.path.abspath(a.static) if a.static else None
    if static and not os.path.isdir(static):
        ap.error(f"--static {static} is not a folder")
    if static and os.path.commonpath([static, board.path]) == static:
        log("note: the database is inside the --static folder; it is never served, but keep it outside the web root on a server")
    if a.host not in ("127.0.0.1", "::1", "localhost"):
        log(f"note: binding {a.host}; the board is meant to sit behind nginx on 127.0.0.1")

    handler = make_handler(board, Limits(), base, static, not a.no_proxy)
    try:
        httpd = BoardServer((a.host, a.port), handler)
    except OSError as e:
        log(f"could not listen on {a.host}:{a.port} ({e})")
        return 1

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    log(f"island board on http://{a.host}:{a.port}{base} (database {board.path}"
        + (", board ready" if board.ok() else ", database not ready yet") + ")"
        + (f"; serving the game from {static}" if static else ""))
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
