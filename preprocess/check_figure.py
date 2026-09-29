"""Check figure for the preprocessed game data.

Draws the drone orthomosaic beside the game data so the two can be compared by eye:
crowns over crowns, shore over shore, the causeway where the path is.

    check/preprocess_check.png         two panels, same extent and scale, side by side
                                       left:  the orthomosaic (decimated) with the island
                                              land outline and the crop outline (sources)
                                       right: the game data, drawn from data/ only, in the
                                              game colours of data/palette.json
    check/preprocess_check_detail.png  the right panel again at a larger scale, cropped to
                                       the island and the causeway

The right panel reads nothing but data/: terrain.json with its three grids, water.json,
placements.json, colliders.json, palette.json and spawns.json. Game x, z are turned back
into E, N (EPSG:6346) so both panels share axes in metres.

The orthomosaic is read through its internal overviews at about 7 cm cells; the full
1.6 cm image is never read. It is only shown here, never shipped.

Run from the game folder:
    python3 preprocess/check_figure.py
"""

import json
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from matplotlib.collections import PatchCollection  # noqa: E402
from matplotlib.colors import LightSource, to_rgb  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Circle, Ellipse, Patch, Polygon as MplPolygon, Rectangle  # noqa: E402
from matplotlib.ticker import MultipleLocator, ScalarFormatter  # noqa: E402
from rasterio.enums import Resampling  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402
from scipy import ndimage as ndi  # noqa: E402

# ----------------------------------------------------------------------------------------------
# Paths and frame
# ----------------------------------------------------------------------------------------------

GAME = Path(__file__).resolve().parents[1]
OUT = GAME.parent  # .../scan_alignment/out, read only
DATA = GAME / "data"
CHECK = GAME / "check"

ORTHO = (OUT / "LizardIsland_2025_drone" / "products" / "orthomosaics"
         / "LizardIsland_2025-10_drone_150ft_orthomosaic_EPSG6346_cog.tif")
LAND_SHP = (OUT / "LizardIsland_2025_vegetation_layers_cleaned" / "gis"
            / "LizardIsland_2025_vegetation_island_land.shp")
CROP_GPKG = OUT / "LizardIsland_2025_splat" / "opensplat" / "work" / "island_crop_outline.gpkg"

E0, N0 = 573150.0, 2840100.0     # game x = E - E0, z = -(N - N0)

DPI = 150
FIG_W_IN = 3200 / DPI            # about 3200 px wide
ORTHO_CELL = 0.07                # m, the decimated ortho read (between overviews 4 and 8)
PAD_M = 12.0                     # margin around the island, causeway and start (main figure)
PAD_DETAIL_M = 3.0               # margin for the detail figure

# Dots for the lizards: five hues checked for colour-blind separation as a set (all pairs),
# with a marker shape per species as the second cue.
SPECIES_STYLE = {  # sp: (label, colour, marker)
    "cristatellus": ("crested anole", "#eb6834", "o"),
    "sagrei": ("brown anole", "#1f6fd1", "s"),
    "carolinensis": ("green anole", "#f5d63d", "^"),
    "distichus": ("bark anole", "#ffffff", "D"),
    "equestris": ("knight anole", "#1c1c6e", "p"),
}
# Survey plants: marker shape by growth form, filled with the form's game colour.
FORM_STYLE = {  # form: (label, swatch, variant, marker, size factor)
    "tree": ("survey tree", "crown_broadleaf", 2, "o", 1.0),
    "palm": ("survey palm", "crown_palm", 1, "*", 2.2),
    "mangrove": ("survey mangrove", "crown_mangrove", 1, "v", 1.2),
    "shrub": ("survey shrub", "shrub", 1, "s", 0.9),
    "herb": ("survey herb", "shrub", 2, "d", 1.0),
}
# Clump types to their game swatch (and variant).
CLUMP_STYLE = {
    "ground_shrub": ("shrub", 2),
    "bush": ("shrub", 1),
    "understorey_tree": ("understorey", 1),
    "canopy_puff": ("canopy_puff", 1),
    "mangrove_canopy": ("crown_mangrove", 1),
}
# Landmark trunk dots: filled by kind (swatch and variant), ink for the rest.
TRUNK_FACE = {"rainbow_eucalyptus": ("rainbow_trunk", 4), "palm": ("trunk_palm", None),
              "talipot": ("trunk_palm", None)}
# Landmark kinds that get a text label on the map, whatever decided the kind.
LABEL_KINDS = {"talipot": "talipot", "rainbow_eucalyptus": "rainbow eucalyptus",
               "osprey_pole": "osprey pole"}
INK = "#1d1d1b"                  # outlines and text
WALK = "#6fe3ff"                 # walkable edge (light cyan on a dark edge)
HALO = [pe.withStroke(linewidth=2.6, foreground="white")]


# ----------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------

def to_en(x, z):
    """Game x, z to E, N (metres, EPSG:6346)."""
    return np.asarray(x, float) + E0, N0 - np.asarray(z, float)


def ring_en(ring):
    a = np.asarray(ring, float)
    E, N = to_en(a[:, 0], a[:, 1])
    return np.column_stack([E, N])


def darker(hex_colour, k=0.55):
    return tuple(k * c for c in to_rgb(hex_colour))


def load_json(name):
    return json.loads((DATA / name).read_text())


class Palette:
    """Swatch lookup: a swatch is one hex string or a list of variants (dark to light)."""

    def __init__(self, pal):
        self.sw = pal["swatches"]
        self.tints = pal["landmark_tints"]

    def __call__(self, name, variant=None):
        v = self.sw[name]
        if isinstance(v, list):
            return v[len(v) // 2 if variant is None else min(variant, len(v) - 1)]
        return v

    def rgb(self, name, variant=None):
        return np.array(to_rgb(self(name, variant)))


# ----------------------------------------------------------------------------------------------
# Load the game data (data/ only)
# ----------------------------------------------------------------------------------------------

def load_game():
    t = load_json("terrain.json")
    rows, cols = t["rows"], t["cols"]
    hv = np.fromfile(DATA / t["height"]["file"], dtype="<u2").reshape(rows, cols)
    height = t["height"]["offset"] + hv.astype(np.float64) * t["height"]["scale"]
    mask = np.fromfile(DATA / t["mask"]["file"], dtype=np.uint8).reshape(rows, cols)
    cv = np.fromfile(DATA / t["canopy"]["file"], dtype=np.uint8).reshape(rows, cols)
    canopy = cv * t["canopy"]["scale"]
    return {
        "terrain": t, "height": height, "mask": mask, "canopy": canopy,
        "water": load_json("water.json"), "placements": load_json("placements.json"),
        "colliders": load_json("colliders.json"), "spawns": load_json("spawns.json"),
        "pal": Palette(load_json("palette.json")),
    }


def grid_edges(t):
    """E, N of the outer edges of the terrain grid (cell centres are half a cell in)."""
    c = t["cell"]
    E_w = t["x0"] - c / 2 + E0
    N_n = N0 - (t["z0"] - c / 2)
    return E_w, N_n, c


def extent_from_data(G, pad):
    """Island land, causeway and start, padded and rounded outwards to whole metres."""
    w = G["water"]
    pts = [ring_en(r) for r in w["land"] + w["causeway"]]
    s = G["terrain"]["start"]
    pts.append(np.column_stack(to_en([s["x"]], [s["z"]])))
    P = np.vstack(pts)
    return (np.floor(P[:, 0].min() - pad), np.ceil(P[:, 0].max() + pad),
            np.floor(P[:, 1].min() - pad), np.ceil(P[:, 1].max() + pad))


# ----------------------------------------------------------------------------------------------
# Terrain image: hillshade tinted in game colours
# ----------------------------------------------------------------------------------------------

def terrain_image(G, ext):
    """RGB image of the terrain cropped to ext, and the E, N of its cell centres."""
    t, pal = G["terrain"], G["pal"]
    bits = t["mask"]["bits"]
    E_w, N_n, c = grid_edges(t)
    c0 = int(np.floor((ext[0] - E_w) / c)) - 1
    c1 = int(np.ceil((ext[1] - E_w) / c)) + 1
    r0 = int(np.floor((N_n - ext[3]) / c)) - 1
    r1 = int(np.ceil((N_n - ext[2]) / c)) + 1
    c0, r0 = max(c0, 0), max(r0, 0)
    c1, r1 = min(c1, t["cols"]), min(r1, t["rows"])
    sl = (slice(r0, r1), slice(c0, c1))
    H, M, C = G["height"][sl], G["mask"][sl], G["canopy"][sl]

    water = (M & bits["water"]) > 0
    land = ~water
    bank = (M & bits["bank"]) > 0
    fringe = (M & bits["fringe"]) > 0
    island_like = (M & (bits["island"] | bits["causeway"])) > 0
    thicket = (M & bits["thicket"]) > 0

    img = np.zeros(H.shape + (3,))
    # Land: lawn on the island and causeway, grass on the far banks, mud on the islets
    # among the mangroves and along the shore, litter under canopy of 2 m or more.
    img[land] = pal.rgb("lawn_sun")
    img[land & bank] = pal.rgb("bank_grass")
    img[land & (C >= 2.0)] = pal.rgb("litter")
    shore = land & (ndi.distance_transform_edt(land) * c <= 1.0)
    img[shore | (land & fringe & ~island_like & ~bank)] = pal.rgb("mud")
    # Thicket cells take a little of the darkest shrub colour (hatching is drawn on top).
    img[land & thicket] = 0.6 * img[land & thicket] + 0.4 * pal.rgb("shrub", 0)
    # Gentle hillshade on land only; relief is under a metre, so it is exaggerated x4.
    hs = LightSource(azdeg=315, altdeg=45).hillshade(H, vert_exag=4.0, dx=c, dy=c)
    shade = np.clip(1.0 + 0.9 * (hs - np.sin(np.radians(45))), 0.7, 1.25)
    img[land] *= shade[land, None]
    # Water: shallow (tea) at the shore to deep (slate) by 1.2 m of depth.
    tw = np.clip((-H - 0.06) / 1.14, 0, 1) ** 0.7
    wcol = (1 - tw)[..., None] * pal.rgb("water_shallow") + tw[..., None] * pal.rgb("water_deep")
    img[water] = wcol[water]
    img = np.clip(img, 0, 1)

    Ec = E_w + (np.arange(c0, c1) + 0.5) * c
    Nc = N_n - (np.arange(r0, r1) + 0.5) * c
    edges = (E_w + c0 * c, E_w + c1 * c, N_n - r1 * c, N_n - r0 * c)
    layers = {"thicket": thicket, "walkable": (M & bits["walkable"]) > 0}
    return img, edges, Ec, Nc, layers


# ----------------------------------------------------------------------------------------------
# Map furniture: north triangle, scale bar, axes
# ----------------------------------------------------------------------------------------------

def north_triangle(ax, xy=(0.965, 0.90), size=0.022):
    """A small filled triangle pointing north with N under it (axes fractions)."""
    x, y = xy
    ax_w, ax_h = ax.get_position().width, ax.get_position().height
    fig_w, fig_h = ax.figure.get_size_inches()
    k = (ax_w * fig_w) / (ax_h * fig_h)   # keep the triangle's shape on a non-square axes
    tri = MplPolygon([[x - size / 2, y], [x + size / 2, y], [x, y + size * 1.5 * k]],
                     closed=True, transform=ax.transAxes, facecolor=INK, edgecolor="white",
                     linewidth=0.8, zorder=30)
    ax.add_patch(tri)
    ax.text(x, y - 0.006, "N", transform=ax.transAxes, ha="center", va="top", fontsize=10,
            fontweight="bold", color=INK, path_effects=HALO, zorder=30)


def scale_bar(ax, ext, length=20.0, fontsize=8):
    """Alternating 10 m bar near the lower left corner, in data units."""
    x = ext[0] + 0.035 * (ext[1] - ext[0])
    y = ext[2] + 0.04 * (ext[3] - ext[2])
    h = 0.008 * (ext[3] - ext[2])
    step = length / 2
    for i in range(2):
        ax.add_patch(Rectangle((x + i * step, y), step, h, facecolor=INK if i == 0 else "white",
                               edgecolor=INK, linewidth=0.8, zorder=30))
    for i, lab in enumerate(["0", f"{step:g}", f"{length:g} m"]):
        ax.text(x + i * step, y + 1.8 * h, lab, ha="center", va="bottom", fontsize=fontsize,
                color=INK, path_effects=HALO, zorder=30)


def set_map_axes(ax, ext, ylabels=True):
    ax.set_xlim(ext[0], ext[1])
    ax.set_ylim(ext[2], ext[3])
    ax.set_aspect("equal")
    for axis in (ax.xaxis, ax.yaxis):
        fmt = ScalarFormatter(useOffset=False)
        fmt.set_scientific(False)
        axis.set_major_formatter(fmt)
        axis.set_major_locator(MultipleLocator(20))
    ax.tick_params(labelsize=8, length=3, color="#77736a", labelcolor="#52514e")
    for s in ax.spines.values():
        s.set_edgecolor("#9a968c")
        s.set_linewidth(0.6)
    ax.set_xlabel("Easting (m, EPSG:6346)", fontsize=8.5, color="#52514e")
    if ylabels:
        ax.set_ylabel("Northing (m)", fontsize=8.5, color="#52514e")
    else:
        ax.tick_params(labelleft=False)


# ----------------------------------------------------------------------------------------------
# Left panel: the orthomosaic
# ----------------------------------------------------------------------------------------------

def read_ortho(ext):
    with rasterio.open(ORTHO) as src:
        win = from_bounds(ext[0], ext[2], ext[1], ext[3], transform=src.transform)
        shape = (4, int(round((ext[3] - ext[2]) / ORTHO_CELL)), int(round((ext[1] - ext[0]) / ORTHO_CELL)))
        rgba = src.read(out_shape=shape, window=win, boundless=True, fill_value=0,
                        resampling=Resampling.average)
    img = np.moveaxis(rgba, 0, -1).astype(np.float32) / 255.0
    img[..., 3] = (rgba[3] > 0).astype(np.float32)  # alpha: 0 where the drone saw nothing
    return img


def draw_ortho_panel(ax, ext):
    ax.set_facecolor("#e9e7e1")
    ax.imshow(read_ortho(ext), extent=(ext[0], ext[1], ext[2], ext[3]), origin="upper",
              interpolation="bilinear", zorder=1)
    land = gpd.read_file(LAND_SHP)
    crop = gpd.read_file(CROP_GPKG)
    crop.boundary.plot(ax=ax, color="#fff4c2", linewidth=0.7, linestyle=(0, (4, 2)), zorder=5)
    land.boundary.plot(ax=ax, color="white", linewidth=0.8, zorder=6)
    return float(land.area.sum()), float(crop.area.sum())


# ----------------------------------------------------------------------------------------------
# Right panel: the game data
# ----------------------------------------------------------------------------------------------

def place_labels(ax, labels, fontsize, lift):
    """Plain text labels just above each feature. Where two labels would overlap, the western
    one moves to the left of its feature and the eastern one to the right."""
    texts = [ax.text(E, N + lift, t, fontsize=fontsize, ha="center", va="bottom", color=INK,
                     path_effects=HALO, zorder=24, clip_on=True) for E, N, t in labels]
    renderer = ax.figure.canvas.get_renderer()
    boxes = [t.get_window_extent(renderer) for t in texts]
    for a in range(len(texts)):
        for b in range(a + 1, len(texts)):
            if boxes[a].overlaps(boxes[b]):
                w, e = (a, b) if labels[a][0] <= labels[b][0] else (b, a)
                for j, ha, side in ((w, "right", -1), (e, "left", 1)):
                    texts[j].set_position((labels[j][0] + side * lift, labels[j][1]))
                    texts[j].set_ha(ha)
                    texts[j].set_va("center")
    return texts


def crown_layer(G):
    """Every crown seen from above as one list of patches, lowest top first, so taller crowns
    cover lower ones as they would from the drone: landmark ellipses in their tints, survey
    plant crowns and clumps as discs in their game colours."""
    P, pal = G["placements"], G["pal"]
    items = []  # (top y, patch, face rgba, edge rgb, linestyle, linewidth)
    for L in P["landmarks"]:
        E, N = to_en(L["crown_x"], L["crown_z"])
        tint = pal.tints.get(L["id"], pal("crown_broadleaf"))
        items.append((L["y"] + L["height"], Ellipse((E, N), L["crown_w_ew"], L["crown_w_ns"]),
                      (*to_rgb(tint), 0.92), darker(tint, 0.45), "solid", 0.9))
    for p in P["plants"]:
        _, sw, var, _, _ = FORM_STYLE[p["form"]]
        E, N = to_en(p["x"], p["z"])
        col = pal(sw, var)
        items.append((p["y"] + p["height"], Circle((E, N), p["crown_w"] / 2),
                      (*to_rgb(col), 0.78), darker(col, 0.6), "solid", 0.5))
    fi = {f: i for i, f in enumerate(P["clumps"]["fields"])}
    types = P["clumps"]["types"]
    for row in P["clumps"]["rows"]:
        typ = types[int(row[fi["type"]])]
        sw, var = CLUMP_STYLE[typ]
        col = pal(sw, var)
        E, N = to_en(row[fi["x"]], row[fi["z"]])
        ls = (0, (2.5, 1.5)) if typ == "canopy_puff" else "solid"
        items.append((row[fi["y"]] + row[fi["h"]], Circle((E, N), row[fi["w"]] / 2),
                      (*to_rgb(col), 0.72), darker(col, 0.6), ls, 0.45))
    items.sort(key=lambda it: it[0])
    pc = PatchCollection([it[1] for it in items], match_original=False, zorder=8)
    pc.set_facecolor([it[2] for it in items])
    pc.set_edgecolor([it[3] for it in items])
    pc.set_linestyle([it[4] for it in items])
    pc.set_linewidth([it[5] for it in items])
    return pc, len(items)


def draw_game_panel(ax, G, ext, k=1.0):
    """Everything from data/ on one axes; k scales marker sizes (larger on the detail map)."""
    pal, P, W = G["pal"], G["placements"], G["water"]
    img, edges, Ec, Nc, layers = terrain_image(G, ext)
    ax.set_facecolor(pal("water_deep"))
    ax.imshow(img, extent=edges, origin="upper", interpolation="nearest", zorder=1)
    EE, NN = np.meshgrid(Ec, Nc)

    # Thicket: hatched (the game's no-walk vegetation, a bit in terrain_mask.u8).
    with plt.rc_context({"hatch.color": darker(pal("shrub", 0), 0.6), "hatch.linewidth": 0.6}):
        ax.contourf(EE, NN, layers["thicket"].astype(float), levels=[0.5, 1.5], colors="none",
                    hatches=["////"], zorder=3)
    # Crowns, lowest first.
    crowns, n_crowns = crown_layer(G)
    ax.add_collection(crowns)
    # Walkable edge on top of the crowns: it is the gameplay boundary.
    ax.contour(EE, NN, layers["walkable"].astype(float), levels=[0.5], colors=WALK,
               linewidths=0.9 * k ** 0.3, linestyles=[(0, (3, 1.5))], zorder=12)
    for coll in ax.collections[-1:]:
        coll.set_path_effects([pe.withStroke(linewidth=1.9 * k ** 0.3, foreground=INK)])

    # Colliders at true size.
    circ = [Circle(tuple(to_en(cx, cz)), r) for cx, cz, r in G["colliders"]["circles"]]
    ax.add_collection(PatchCollection(circ, facecolor="none", edgecolor="#b3261e",
                                      linewidth=0.7 * k ** 0.3, zorder=13))
    # Survey plants at their trunks, shape by growth form.
    for form, (label, sw, var, marker, sk) in FORM_STYLE.items():
        pts = [(p["x"], p["z"]) for p in P["plants"] if p["form"] == form]
        if pts:
            E, N = to_en(*np.array(pts).T)
            ax.scatter(E, N, s=14 * sk * k, marker=marker, facecolor=pal(sw, var),
                       edgecolor=INK, linewidth=0.5, zorder=14)
    # Landmark trunks.
    for L in P["landmarks"]:
        E, N = to_en(L["x"], L["z"])
        if L["kind"] == "osprey_pole":
            ax.scatter(E, N, s=26 * k, marker="s", facecolor=pal("osprey_pole"), edgecolor=INK,
                       linewidth=0.7, zorder=15)
        else:
            face = TRUNK_FACE.get(L["kind"], INK)
            face = pal(*face) if isinstance(face, tuple) else face
            ax.scatter(E, N, s=14 * k, marker="o", facecolor=face, edgecolor="white",
                       linewidth=0.6, zorder=15)
    # Logs: level cylinders drawn in plan as rectangles, axis along (cos rot, 0, -sin rot).
    logs = G["spawns"]["logs"]
    for lg in logs:
        E, N = to_en(lg["x"], lg["z"])
        u = np.array([np.cos(lg["rot"]), np.sin(lg["rot"])])   # E, N of the log axis
        v = np.array([-u[1], u[0]])
        a, b = u * lg["len"] / 2, v * lg["r"]
        c = np.array([E, N])
        ax.add_patch(MplPolygon([c - a - b, c + a - b, c + a + b, c - a + b], closed=True,
                                facecolor=pal("trunk_bark"), edgecolor=INK, linewidth=0.6, zorder=16))
    # Lizard spawns.
    for sp, (label, col, marker) in SPECIES_STYLE.items():
        pts = [(s["x"], s["z"]) for s in G["spawns"]["spawns"] if s["sp"] == sp]
        if pts:
            E, N = to_en(*np.array(pts).T)
            ax.scatter(E, N, s=9 * k, marker=marker, facecolor=col, edgecolor=INK,
                       linewidth=0.35, zorder=17)
    # Player start.
    s = G["terrain"]["start"]
    E, N = to_en(s["x"], s["z"])
    ax.scatter(E, N, s=150 * k, marker="*", facecolor="white", edgecolor=INK, linewidth=0.9, zorder=20)
    ax.text(E + 1.6, N, "start", fontsize=8.5 * k ** 0.3, ha="left", va="center", color=INK,
            path_effects=HALO, zorder=25)

    # Island outline on top: the land polygon, the crop outline and the traced causeway.
    for ring in W["outline"]:
        ax.add_patch(MplPolygon(ring_en(ring), closed=True, fill=False, edgecolor="#fff4c2",
                                linewidth=0.8, linestyle=(0, (4, 2)), zorder=22))
    for ring in W["causeway"]:
        ax.add_patch(MplPolygon(ring_en(ring), closed=True, fill=False, edgecolor=pal("path"),
                                linewidth=1.0, linestyle=(0, (1, 1.5)), zorder=22))
    for ring in W["land"]:
        ax.add_patch(MplPolygon(ring_en(ring), closed=True, fill=False, edgecolor="white",
                                linewidth=1.0, zorder=23))

    # Plain text labels on the features: every talipot, rainbow eucalyptus and the osprey pole.
    fs = 8.5 * k ** 0.3
    labels = [(*to_en(L["x"], L["z"]), LABEL_KINDS[L["kind"]]) for L in P["landmarks"]
              if L["kind"] in LABEL_KINDS]
    place_labels(ax, labels, fs, lift=0.9 + 0.3 * k)
    cz = ring_en(W["causeway"][0])
    st = G["terrain"]["stats"]["causeway"]
    g = np.array(to_en(st["garden_end"]["x"], st["garden_end"]["z"]))
    i = np.array(to_en(st["island_end"]["x"], st["island_end"]["z"]))
    mid = 0.5 * (g + i)
    ang = np.degrees(np.arctan2(i[1] - g[1], i[0] - g[0]))
    ax.text(mid[0] + 2.4, mid[1] - 1.5, "causeway", rotation=ang, rotation_mode="anchor",
            fontsize=fs, ha="center", va="center", color=INK, path_effects=HALO, zorder=24)

    counts = {"crowns": n_crowns, "colliders": len(circ), "logs": len(logs),
              "spawns": len(G["spawns"]["spawns"]), "plants": len(P["plants"]),
              "landmarks": len(P["landmarks"]), "clumps": len(P["clumps"]["rows"]),
              "causeway_ring_vertices": len(cz)}
    return counts


# ----------------------------------------------------------------------------------------------
# Legend
# ----------------------------------------------------------------------------------------------

def legend_groups(G, k=1.0):
    pal = G["pal"]
    sq = dict(edgecolor="#6c6a64", linewidth=0.5)
    terrain = [
        Patch(facecolor=pal("lawn_sun"), label="lawn", **sq),
        Patch(facecolor=pal("litter"), label="litter under canopy", **sq),
        Patch(facecolor=pal("mud"), label="mud, shore and islets", **sq),
        Patch(facecolor=pal("bank_grass"), label="far bank", **sq),
        Patch(facecolor=pal("water_shallow"), label="water, shallow", **sq),
        Patch(facecolor=pal("water_deep"), label="water, deep", **sq),
    ]
    with plt.rc_context({"hatch.color": darker(pal("shrub", 0), 0.6)}):
        thicket = Patch(facecolor=pal("lawn_sun"), hatch="////", label="thicket (no walking)", **sq)
    lines = [
        thicket,
        Line2D([], [], color=WALK, linewidth=0.9, linestyle=(0, (3, 1.5)), label="walkable edge",
               path_effects=[pe.withStroke(linewidth=1.9, foreground=INK)]),
        Line2D([], [], color="white", linewidth=1.2, label="island land outline",
               path_effects=[pe.withStroke(linewidth=2.2, foreground="#8a877f")]),
        Line2D([], [], color="#fff4c2", linewidth=1.0, linestyle=(0, (4, 2)), label="crop outline",
               path_effects=[pe.withStroke(linewidth=2.0, foreground="#8a877f")]),
        Line2D([], [], color=pal("path"), linewidth=1.2, linestyle=(0, (1, 1.5)), label="causeway (traced)",
               path_effects=[pe.withStroke(linewidth=2.2, foreground="#8a877f")]),
        Line2D([], [], marker="*", linestyle="none", markersize=11, markerfacecolor="white",
               markeredgecolor=INK, label="player start"),
    ]
    veg = [
        Patch(facecolor=pal.tints["T001"], edgecolor=darker(pal.tints["T001"], 0.45),
              label="landmark crown, own tint"),
        Line2D([], [], marker="o", linestyle="none", markersize=4.5, markerfacecolor=INK,
               markeredgecolor="white", label="landmark trunk, broadleaf"),
        Line2D([], [], marker="o", linestyle="none", markersize=4.5, markerfacecolor=pal("trunk_palm"),
               markeredgecolor="#77736a", label="landmark trunk, palm or talipot"),
        Line2D([], [], marker="o", linestyle="none", markersize=4.5,
               markerfacecolor=pal("rainbow_trunk", 4), markeredgecolor="#77736a",
               label="landmark trunk, rainbow eucalyptus"),
        Line2D([], [], marker="s", linestyle="none", markersize=5, markerfacecolor=pal("osprey_pole"),
               markeredgecolor=INK, label="osprey pole"),
        Line2D([], [], marker="o", linestyle="none", markersize=6, markerfacecolor="none",
               markeredgecolor="#b3261e", label="collider (trunk, bush)"),
        Patch(facecolor=pal("trunk_bark"), edgecolor=INK, label="log"),
    ]
    clumps = [Patch(facecolor=pal(*CLUMP_STYLE[t]), edgecolor=darker(pal(*CLUMP_STYLE[t]), 0.6),
                    linestyle="--" if t == "canopy_puff" else "-",
                    label=t.replace("_", " ") + (" (floating)" if t == "canopy_puff" else ""))
              for t in CLUMP_STYLE]
    plants = [Line2D([], [], marker=m, linestyle="none", markersize=5 * np.sqrt(sk),
                     markerfacecolor=pal(sw, var), markeredgecolor=INK, markeredgewidth=0.6, label=lab)
              for lab, sw, var, m, sk in FORM_STYLE.values()]
    lizards = [Line2D([], [], marker=m, linestyle="none", markersize=5, markerfacecolor=col,
                      markeredgecolor=INK, markeredgewidth=0.5, label=lab)
               for lab, col, m in SPECIES_STYLE.values()]
    return [("Ground and water", terrain), ("Lines and points", lines),
            ("Landmarks and props", veg), ("Clumps (discs at true width)", clumps),
            ("Survey plants (crown disc + trunk)", plants), ("Lizard spawns", lizards)]


def draw_legend(ax, G, xs, fontsize=8):
    ax.axis("off")
    for (title, handles), x in zip(legend_groups(G), xs):
        leg = ax.legend(handles=handles, title=title, loc="upper left", bbox_to_anchor=(x, 1.0),
                        frameon=False, fontsize=fontsize, title_fontsize=fontsize + 0.5,
                        handlelength=1.8, handleheight=1.0, borderaxespad=0.0, labelspacing=0.35,
                        alignment="left")
        leg.get_title().set_color("#2b2a27")
        ax.add_artist(leg)


# ----------------------------------------------------------------------------------------------
# Figures
# ----------------------------------------------------------------------------------------------

def main_figure(G, ext):
    ew, nh = ext[1] - ext[0], ext[3] - ext[2]
    left, gap, right = 0.9, 0.28, 0.2           # inches
    top, bottom_ticks, legend_h = 0.45, 0.55, 1.4
    map_w = (FIG_W_IN - left - gap - right) / 2
    map_h = map_w * nh / ew
    fig_h = top + map_h + bottom_ticks + legend_h
    fig = plt.figure(figsize=(FIG_W_IN, fig_h), dpi=DPI, facecolor="white")
    fy = (legend_h + bottom_ticks) / fig_h
    axL = fig.add_axes([left / FIG_W_IN, fy, map_w / FIG_W_IN, map_h / fig_h])
    axR = fig.add_axes([(left + map_w + gap) / FIG_W_IN, fy, map_w / FIG_W_IN, map_h / fig_h],
                       sharex=axL, sharey=axL)

    land_m2, crop_m2 = draw_ortho_panel(axL, ext)
    set_map_axes(axL, ext)
    axL.set_title("Drone orthomosaic, October 2025, with the island land outline (white) and "
                  "crop outline (dashed)", fontsize=9.5, loc="left", color="#2b2a27")
    set_map_axes(axR, ext, ylabels=False)   # limits first: label placement measures the text
    counts = draw_game_panel(axR, G, ext)
    axR.set_title("Game data from data/, in palette.json colours", fontsize=9.5, loc="left",
                  color="#2b2a27")
    for ax in (axL, axR):
        north_triangle(ax)
        scale_bar(ax, ext)

    axLeg = fig.add_axes([left / FIG_W_IN, 0.05 / fig_h, 1 - (left + right) / FIG_W_IN,
                          (legend_h - 0.15) / fig_h])
    draw_legend(axLeg, G, xs=[0.0, 0.14, 0.31, 0.47, 0.64, 0.82])
    out = CHECK / "preprocess_check.png"
    fig.savefig(out, dpi=DPI, facecolor="white")
    plt.close(fig)
    return out, counts, (land_m2, crop_m2), fig_h


def detail_figure(G, ext):
    ew, nh = ext[1] - ext[0], ext[3] - ext[2]
    left, right, top, bottom_ticks, legend_h = 0.9, 0.2, 0.45, 0.55, 1.4
    map_w = FIG_W_IN - left - right
    map_h = map_w * nh / ew
    fig_h = top + map_h + bottom_ticks + legend_h
    fig = plt.figure(figsize=(FIG_W_IN, fig_h), dpi=DPI, facecolor="white")
    ax = fig.add_axes([left / FIG_W_IN, (legend_h + bottom_ticks) / fig_h, map_w / FIG_W_IN, map_h / fig_h])
    set_map_axes(ax, ext)                   # limits first: label placement measures the text
    draw_game_panel(ax, G, ext, k=2.2)
    ax.xaxis.set_major_locator(MultipleLocator(10))
    ax.yaxis.set_major_locator(MultipleLocator(10))
    ax.set_title("Game data from data/, island and causeway at a larger scale", fontsize=10,
                 loc="left", color="#2b2a27")
    north_triangle(ax, xy=(0.975, 0.93), size=0.012)
    scale_bar(ax, ext, length=10.0, fontsize=9)
    axLeg = fig.add_axes([left / FIG_W_IN, 0.05 / fig_h, 1 - (left + right) / FIG_W_IN,
                          (legend_h - 0.15) / fig_h])
    draw_legend(axLeg, G, xs=[0.0, 0.14, 0.31, 0.47, 0.64, 0.82], fontsize=8.5)
    out = CHECK / "preprocess_check_detail.png"
    fig.savefig(out, dpi=DPI, facecolor="white")
    plt.close(fig)
    return out, fig_h


def main():
    CHECK.mkdir(exist_ok=True)
    G = load_game()
    ext = extent_from_data(G, PAD_M)
    out, counts, (land_m2, crop_m2), fig_h = main_figure(G, ext)
    ext_d = extent_from_data(G, PAD_DETAIL_M)
    out_d, fig_h_d = detail_figure(G, ext_d)

    print(f"extent E {ext[0]:.0f}-{ext[1]:.0f}, N {ext[2]:.0f}-{ext[3]:.0f} "
          f"({ext[1] - ext[0]:.0f} x {ext[3] - ext[2]:.0f} m)")
    print(f"detail extent E {ext_d[0]:.0f}-{ext_d[1]:.0f}, N {ext_d[2]:.0f}-{ext_d[3]:.0f}")
    print("drawn: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    print(f"source outlines: island land {land_m2:,.0f} m2, crop outline {crop_m2:,.0f} m2")
    print(f"wrote {out.relative_to(GAME)} ({int(FIG_W_IN * DPI)} x {int(round(fig_h * DPI))} px) and "
          f"{out_d.relative_to(GAME)} ({int(FIG_W_IN * DPI)} x {int(round(fig_h_d * DPI))} px)")


if __name__ == "__main__":
    main()
