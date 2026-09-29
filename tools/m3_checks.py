"""Check images of the anoles and the crocodile, all in one go: the anole gallery sheet,
the crocodile gallery sheet, the lizards on their perches in the game, a flee before and
after, the crocodile in the water, on the bank and snapping, and a labelled contact sheet
of them all (check/m3_sheet.png). Needs tools/serve.py on port 8772; writes into check/.

    python3 tools/m3_checks.py [name ...] [--skip] [--sheet]

Names pick single images (m3_gallery and m3_croc_gallery for the two sheets);
--skip rebuilds from the shots already taken; --sheet only redraws m3_sheet.png.
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHECK = os.path.join(ROOT, "check")
TMP = os.path.join(ROOT, "work", "shots", "m3_checks")
os.makedirs(TMP, exist_ok=True)
G = "http://127.0.0.1:8772/index.html?nohud=1&crocseed=3&"
CG = "http://127.0.0.1:8772/src/wildlife/croc_gallery.html"
LG = "http://127.0.0.1:8772/src/lizards/lizards_gallery.html?clean=1&"
# the flee pair: a flank view, the player 3.2 m from a crested anole on a palm trunk
FLEE = ("lizard=cristatellus&perch=bark&lizardcam=side&lizardfrom=3.2&nth=2"
        "&lizardback=-1.2&lizardaside=-4.3&lizardmid=0.45")

SHOTS = {
    "m3_crested_trunk": G + "lizard=cristatellus&perch=bark",
    "m3_brown_ground": G + "lizard=sagrei&perch=ground&nth=1",
    "m3_green_leaves": G + "lizard=carolinensis&perch=leaf&nth=2",
    "m3_bark_anole": G + "lizard=distichus&perch=bark",
    "m3_knight_canopy": G + "lizard=equestris&perch=branch&nth=3&lizardcam=2.2&lizardlift=-0.4",
    "m3_flee_before": G + FLEE,
    "m3_flee_after": G + FLEE + "&scare=1.5,walk&fleehold=0.3",
    "m3_croc_water": G + "croc=cruise&crocview=5",
    "m3_croc_bank": G + "croc=bask&crocview=4",
    "m3_croc_snap": G + "croc=snap&crocspot=0&crocfreeze=1&crocview=5.5&crocup=0.3",
}
CAPTIONS = {
    "m3_gallery": "the five anoles, male and female, and what they can do",
    "m3_croc_gallery": "the American crocodile's poses",
    "m3_crested_trunk": "crested anole low on a mangrove trunk",
    "m3_brown_ground": "brown anole on the ground by a log",
    "m3_green_leaves": "green anole on top of the leaves",
    "m3_bark_anole": "bark anoles, grey and lichen-mottled, on mangrove bark",
    "m3_knight_canopy": "knight anole out on a limb in the canopy",
    "m3_flee_before": "flee, before: the player 3 m from a crested anole on a palm",
    "m3_flee_after": "flee, after: the player walks in and it darts round the trunk",
    "m3_croc_water": "croc cruising: eyes, snout and scutes above the water",
    "m3_croc_bank": "croc basking on the bank, mouth open",
    "m3_croc_snap": "croc snap: the player walked too close",
}

# ---- the anole gallery sheet
SP = [("cristatellus", "crested anole", "common"), ("sagrei", "brown anole", "uncommon"),
      ("carolinensis", "green anole", "rare"), ("distichus", "bark anole", "very rare"),
      ("equestris", "knight anole", "very rare")]
DEW_T = {"cristatellus": 0.5, "sagrei": 0.3, "carolinensis": 0.5, "distichus": 0.3, "equestris": 0.8}
ACTS = [("idle", "idle", 1.0), ("head bob", "headbob", 0.16), ("push-up", "pushup", 0.4), ("dewlap", "dewlap", 0.5),
        ("run", "run", 1.02), ("flatten", "flatten", 1.2), ("gape", "gape", 1.0), ("tail curl", "curl", 0.65),
        ("stressed", "stressed", 1.2), ("backpack", "backpack", 1.0)]
# ---- the crocodile gallery sheet
POSES = [("swim", "Swimming", "eyes, nose, snout and back scutes above the water"),
         ("slide", "Belly slide", "legs tucked, back into the water"),
         ("bask", "Basking", "mouth open to cool off, chin on the ground"),
         ("hiss", "Hiss", "head up, a warning"),
         ("crawl", "Crawling out", "a belly crawl on land"),
         ("snap", "Snap", "a comic lunge")]

font = lambda s: ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", s)
INK, SOFT, PAPER = "#2d3a26", "#6b7560", "#f4f1e6"


def shoot(job):
    name, url, size, wait = job
    out = os.path.join(TMP, name + ".png")
    for _ in range(3):
        if os.path.exists(out):
            os.remove(out)
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "shot.py"), url, out, "--size", size,
                        "--wait", str(wait)], stdout=subprocess.DEVNULL)
        if os.path.exists(out) and Image.open(out).convert("RGB").getextrema()[0][0] < 250:
            break
    return name


def anole_jobs():
    jobs = []
    for sp, _, _ in SP:
        jobs.append((f"lg_m_{sp}", LG + f"sp={sp}&sex=m&act=dewlap&t={DEW_T[sp]}&view=hero", "640x520", 8))
        jobs.append((f"lg_f_{sp}", LG + f"sp={sp}&sex=f&act=idle&t=1&view=hero", "640x520", 8))
    for _, act, t in ACTS:
        sp = "carolinensis" if act == "stressed" else "cristatellus"
        jobs.append((f"lg_a_{act}", LG + f"sp={sp}&sex=m&act={act}&t={t}&view=hero", "640x520", 8))
    jobs.append(("lg_perch", LG + "scene=perch&t=1", "1280x800", 8))
    jobs.append(("lg_world", "http://127.0.0.1:8772/index.html?at=-28.5,-11.5,0.6&cam=-29.3,2.0,-13.0,-32.7,1.1,-17.4&nohud=1&nocroc=1",
                 "1600x1000", 16))
    return jobs


def croc_jobs():
    return [("cg_all", CG, "1600x1000", 10)] + [("cg_" + p, CG + "?pose=" + p, "1200x750", 10) for p, _, _ in POSES]


def anole_sheet():
    tile = lambda n: Image.open(os.path.join(TMP, n + ".png")).convert("RGB")
    W, TW, TH = 2000, 400, 325
    sheet = Image.new("RGB", (W, 60 + 2 * (TH + 34) + 40 + 2 * (TH + 34) + 40 + 560), PAPER)
    d = ImageDraw.Draw(sheet)
    d.text((24, 16), "Anoles: five species, male and female", fill=INK, font=font(28))

    def put(img, x, y, w, h, label, sub=None):
        img = img.resize((w, int(img.height * w / img.width)), Image.LANCZOS)
        top = max(0, (img.height - h) // 2)
        sheet.paste(img.crop((0, top, w, top + h)), (x, y))
        d.text((x + 8, y + h + 5), label, fill=INK, font=font(17))
        if sub:
            d.text((x + 8 + d.textlength(label, font=font(17)) + 8, y + h + 8), sub, fill=SOFT, font=font(13))

    y = 60
    for key, what in [("m", "male, dewlap out"), ("f", "female")]:
        for i, (sp, name, rarity) in enumerate(SP):
            put(tile(f"lg_{key}_{sp}"), i * TW, y, TW, TH, name, f"{what}, {rarity}")
        y += TH + 34
    y += 10
    d.text((24, y), "What they can do (crested anole; the green anole for stress)", fill=INK, font=font(22))
    y += 34
    for row in range(2):
        for i in range(5):
            label, act, _ = ACTS[row * 5 + i]
            put(tile(f"lg_a_{act}"), i * TW, y, TW, TH, label)
        y += TH + 34
    y += 6
    put(tile("lg_perch"), 0, y, 880, 520, "perches: trunk head down, pressed flat, limb, leaf, ground")
    put(tile("lg_world"), 900, y, 1100, 520, "in the world, 5 to 8 m away")
    sheet.save(os.path.join(CHECK, "m3_gallery.png"))
    print("wrote check/m3_gallery.png", sheet.size)


def croc_sheet():
    W, TW, TH = 1600, 533, 300
    sheet = Image.new("RGB", (W, 60 + 520 + 20 + 2 * (TH + 34) + 10), PAPER)
    d = ImageDraw.Draw(sheet)
    d.text((24, 16), "The crocodile: an American crocodile, chunky and friendly", fill=INK, font=font(28))
    top = Image.open(os.path.join(TMP, "cg_all.png")).convert("RGB")
    sheet.paste(top.crop((0, 270, 1600, 790)), (0, 60))
    y = 60 + 520 + 20
    for i, (p, label, sub) in enumerate(POSES):
        im = Image.open(os.path.join(TMP, "cg_" + p + ".png")).convert("RGB")
        im = im.crop((0, 0, im.width, im.height - 40))  # drop the help line
        im = im.resize((TW, int(im.height * TW / im.width)), Image.LANCZOS)
        t = max(0, (im.height - TH) // 2)
        x = (i % 3) * TW + (i % 3)
        yy = y + (i // 3) * (TH + 34)
        sheet.paste(im.crop((0, t, TW, t + TH)), (x, yy))
        d.text((x + 8, yy + TH + 5), label, fill=INK, font=font(17))
        d.text((x + 16 + d.textlength(label, font=font(17)), yy + TH + 8), sub, fill=SOFT, font=font(13))
    sheet.save(os.path.join(CHECK, "m3_croc_gallery.png"))
    print("wrote check/m3_croc_gallery.png", sheet.size)


def contact_sheet():
    """Every check image on one labelled page."""
    W, TW, TH, GAP = 2500, 496, 310, 5
    LAB = 44
    order = list(SHOTS)
    gal = Image.open(os.path.join(CHECK, "m3_gallery.png")).convert("RGB")
    cro = Image.open(os.path.join(CHECK, "m3_croc_gallery.png")).convert("RGB")
    GW = (W - 3 * 20) // 2
    gh = int(gal.height * GW / gal.width)
    ch = int(cro.height * GW / cro.width)
    H = 80 + 2 * (TH + LAB + 10) + 30 + max(gh, ch) + LAB + 20
    sheet = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(sheet)
    d.text((24, 22), "The anoles and the crocodile", fill=INK, font=font(34))
    y = 80
    for r in range(2):
        for c in range(5):
            name = order[r * 5 + c]
            x = 20 + c * (TW + GAP)
            im = Image.open(os.path.join(CHECK, name + ".png")).convert("RGB").resize((TW, TH), Image.LANCZOS)
            sheet.paste(im, (x, y))
            d.text((x + 4, y + TH + 5), name, fill=INK, font=font(17))
            d.text((x + 4, y + TH + 26), CAPTIONS[name], fill=SOFT, font=font(13))
        y += TH + LAB + 10
    y += 30
    for k, (name, im, h) in enumerate([("m3_gallery", gal, gh), ("m3_croc_gallery", cro, ch)]):
        x = 20 + k * (GW + 20)
        sheet.paste(im.resize((GW, h), Image.LANCZOS), (x, y))
        d.text((x + 4, y + h + 5), name, fill=INK, font=font(17))
        d.text((x + 4 + d.textlength(name, font=font(17)) + 10, y + h + 8), CAPTIONS[name], fill=SOFT, font=font(13))
    sheet.save(os.path.join(CHECK, "m3_sheet.png"))
    print("wrote check/m3_sheet.png", sheet.size)


if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    only_sheet = "--sheet" in sys.argv
    jobs = [] if only_sheet else [(n, u, "1600x1000", 14) for n, u in SHOTS.items() if not want or n in want]
    if not only_sheet and (not want or "m3_gallery" in want):
        jobs += anole_jobs()
    if not only_sheet and (not want or "m3_croc_gallery" in want):
        jobs += croc_jobs()
    if jobs and "--skip" not in sys.argv:
        with ThreadPoolExecutor(4) as ex:
            for n in ex.map(shoot, jobs):
                print("shot", n)
    if not only_sheet:
        for n in SHOTS:
            src = os.path.join(TMP, n + ".png")
            if (not want or n in want) and os.path.exists(src):
                Image.open(src).convert("RGB").save(os.path.join(CHECK, n + ".png"))
                print("wrote check/%s.png" % n)
        if not want or "m3_gallery" in want:
            anole_sheet()
        if not want or "m3_croc_gallery" in want:
            croc_sheet()
    contact_sheet()
