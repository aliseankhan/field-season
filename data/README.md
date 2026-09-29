# Game data

Small files the browser loads to build Lizard Island. Everything here is made by the
scripts in `../preprocess/` from the survey products, and `preprocess/build_all.py`
rebuilds the whole folder. The scripts use fixed seeds, so a rebuild gives the same bytes.
The folder is about 2.3 MB. The three binary grids make up 2.0 MB of that and gzip well.

## Frame

All positions are in metres, three.js style with y up:

    x = E - 573150          east is +x
    y = h + 24.90           the lake surface (h = -24.90 m) is y = 0
    z = -(N - 2840100)      north is -z

E, N and h are EPSG:6346 (NAD83(2011) / UTM 17N) with ellipsoidal heights. Positions are
rounded to 0.01 m. Every JSON file carries the same `frame` block.

The copies that `tools/package.py` packs for hosting leave out the `frame` block, the scan
positions' survey names and the keys written only for people reading the files: `notes`
everywhere, `sources` (palette), `review`, `survey_identity` and `stats` (placements),
`source` and `fields` (scanpos, stakes), and `layout`, `start.heading_convention`,
`stats.method` and `stats.causeway.note` (terrain). The game reads none of them.

Angles:

- `heading` and `ang` are in radians. 0 faces north (-z) and a positive angle turns
  towards west (-x), the same as three.js `rotation.y`. The forward direction is
  `(-sin a, 0, -cos a)`.
- `rot` is a turn about +y, again as `rotation.y`.

## terrain.json, terrain_height.u16, terrain_mask.u8, terrain_canopy.u8

A 0.25 m grid over the whole site: 680 columns by 740 rows, x -70 to 100, z -115 to 70.
That includes the far banks of the lake, so they can be drawn as scenery.

- **Layout:** `x0`, `z0` are the x, z of the centre of cell row 0, column 0. The column
  index grows with +x and the row index with +z, so row 0 is the north edge. Each binary
  file is row-major with no header.
- **Height:** `terrain_height.u16` is little-endian uint16, y = -3.0 + value * 0.001.
  Land is ground height. Water cells hold a stylised lake bed, from -0.06 at the shore to
  -1.20 in open water. Under the mangrove fringe and wherever canopy stands over the water
  the bed stays on the shallow shelf, no deeper than -0.36, easing back to the open-water
  bed over 2 m outside it.
- **Mask:** `terrain_mask.u8` holds bit flags: water 1, island 2, causeway 4, bank 8,
  thicket 16, walkable 32, fringe 64.
  - water, island, causeway and bank never overlap.
  - thicket, walkable and fringe sit on top of them.
  - thicket is dense low vegetation that the player cannot walk through. It is cleared
    0.35 m beyond each landmark trunk's collider, so trunks carry no wall of their own.
  - walkable is the connected ground the player can reach from the start.
  - fringe is the mangrove belt inside the island outline. It is mostly water, plus
    mud islets.
- **Canopy:** `terrain_canopy.u8` is vegetation height above the ground in 0.1 m units.
  It is 0 where there is none and is capped at 25.5 m. It is 0 on open water: the lidar's
  reflections of the trees in the lake, and any canopy speck under 3 m2 standing on water,
  are removed.
- **start:** the player start on the causeway, with `x`, `y`, `z` and `heading`, facing
  along the causeway into the island.
- **walk_bounds:** `[xmin, zmin, xmax, zmax]`, the box around the edges of the walkable
  cells.
- **stats:** areas, height ranges, the causeway geometry and a note on each method step.

The causeway runs roughly north from the south bank into the south-west of the island. It
is about 21 m long, from x -11.1, z 41.5 to x -13.5, z 20.75.

## water.json

The lake is a flat plane at `level_y` = 0. The rest of the file is plan geometry in x, z:

| key | contents |
| --- | --- |
| `land` | the island land polygon |
| `outline` | the island crop outline, which includes the mangrove canopy fringe |
| `shoreline` | shore polylines, including the shore under the canopy |
| `causeway` | the traced causeway |
| `banks` | far-bank land |
| `open_water` | water with no canopy over it |

- Every ring is a list of `[x, z]` points, simplified to about 0.1 m. Rings are open: the
  last point is not repeated.
- Outer rings run anticlockwise seen from above with north up. Holes run clockwise.
- `holes` has one true/false list per ring list, saying which rings are holes.

## placements.json

- **landmarks:** the 37 lidar trees.
  - Fields: `id`, `kind`, `x`, `y`, `z`, `height`, `dbh`, `crown_w_ew`, `crown_w_ns`,
    `crown_base`, `crown_x`, `crown_z`, `stems`, `multi_stem`, `name` and `sci`.
  - `kind` is broadleaf, palm, talipot, rainbow_eucalyptus or osprey_pole.
  - x, y, z is the trunk base on the ground.
  - `height` and `crown_base` are measured from the trunk base.
  - `crown_x`, `crown_z` is the crown centre.
  - **Identity.** The plant survey decides what a landmark is wherever a survey point
    (not reject, not non-plant) stands within 1.1 m of the bark of one of its stems and that
    stem is the point's nearest landmark stem. Of several such points the best flag (good,
    usable, check), then the nearest, decides. Palms become palm (the talipot palm,
    *Corypha umbraculifera*, becomes talipot), *Eucalyptus deglupta* rainbow_eucalyptus and
    other trees broadleaf. Shrubs and herbs at a stem stay plants. The lab's own
    identifications (talipots T007, T008, T009, T019; rainbow eucalyptus T006; osprey pole
    T036) stand against the survey; `stats.landmark_kinds_from.brief` counts those no survey
    point confirmed. A landmark with no survey point keeps the lab's kind, the tree table's
    palm reading or broadleaf.
  - `name` is the deciding point's survey name (common name, else scientific; "palm" or
    "tree" where the species was not recorded), or null. T036's name is set by the script,
    since no survey point names a pole.
  - `sci` is the deciding point's scientific name, or null (no survey point, or no species
    recorded).
  - **Palms the survey made.** T004, T016, T020, T021 and T031 were drawn as broadleaf until
    the survey decided. They keep the tree table's trunk (x, y, z, dbh, height). Their crown
    width is read from the drone orthomosaic and centred on the stem, since the lidar crown
    held neighbouring canopy. Where the lidar crown base was in the understorey it is raised
    to where the fronds end. The clumps fill the rest of the old lidar crown.
    `survey_identity.palm_crowns` gives each palm's crown before and after.
- **plants:** 206 plants from the plant survey.
  - Fields: `form`, `name`, `sci`, `x`, `y`, `z`, `height`, `crown_w`, `dbh` and `rot`.
  - `form` is tree, palm, mangrove, shrub or herb.
- **clumps:** instanced filler vegetation. `rows` are `[x, y, z, h, w, type, rot]`.
  - x, y, z is the ground under the clump centre.
  - `h` is the height of the top above that ground, and `w` is the width in plan.
  - `type` is an index into `types`: ground_shrub, bush, understorey_tree, canopy_puff or
    mangrove_canopy.
  - canopy_puff clumps are crown blobs whose top is at y + h. They do not reach the ground.
- **Things in the fringe water:** these have y at the water surface, about 0. The lake bed
  there is 0.06 to 0.36 m lower (up to 0.7 m where a clump stands at the edge of open
  water), so trunks may need extending down to it.
- **stats, notes:** counts and conventions.
- **survey_identity:** `kind_changes` lists the landmarks whose kind the survey changed
  (T001 and T005 to rainbow_eucalyptus; T004, T016, T020, T021 and T031 to palm), with the
  deciding point's name, flag and distance from the bark. `palm_crowns` gives, for each
  landmark the survey made a palm, `[table, now]` for `crown_w_ew`, `crown_w_ns` and
  `crown_base`, whether the crown shows from above, what the orthomosaic shows, and how much
  of the old lidar crown the clumps now cover.
- **review:** what is left for a person to decide, each with a `reason`, the landmark's
  `kind` in this file and the survey point concerned (`survey_name`, `survey_sci`,
  `survey_form`, `survey_flag`, `bark_distance_m`):
  - T011: no survey point at the stem, but the orthomosaic shows a fan-palm crown on the
    trunk. It stays broadleaf.
  - T021: made a palm by a check-quality point (*Attalea butyracea*, 0.70 m) on a 0.12 m
    stem, far thinner than that palm's trunk.
  - T017, T022, T029 and T032: two survey points at one stem disagree, and the better one
    decided.
  - Any survey point that contradicts the lab's identifications, or a mangrove at a stem
    (drawn broadleaf), would be listed here too. There are none.

## colliders.json

- `circles` are `[x, z, r]`:
  - trunks, one per stem where the stems are known, r = dbh / 2 + 0.15;
  - bushes, understorey trees and mangrove clumps, and survey shrubs 1 m or taller, whose
    centre stands on walkable ground, r = 0.35 x their width: a solid core the player
    walks round.
- `owners` is a parallel list: `L<i>` for landmark i, `P<i>` for plant i or `C<i>` for
  clump row i.
- Thicket is not in this file. It is the thicket bit in `terrain_mask.u8`.

## palette.json

Colours sampled from the October 2025 drone orthomosaic and given a gentle toon lift.

- `swatches` maps a name to `"#rrggbb"`, or to a list of variants ordered dark to light.
- `landmark_tints` gives one crown colour per landmark id. A palm the survey made is sampled
  over its palm crown, not over its old lidar crown. T016's palm crown is hidden under
  broadleaf canopy, so it takes the median of the palms seen from above.
- Landmark kinds come from `placements.json`, so `palette.py` runs after `placements.py`.
  The rainbow bark bands (`rainbow_trunk`) are for every rainbow_eucalyptus landmark (T001,
  T005, T006).
- `variant_weights` is the observed share of each variant.
- `raw` holds the colours before the toon adjustment.
- `sources` and `notes` explain how each colour was chosen.
- Trunks, the rainbow bark bands, the osprey pole, the nest, the sky and the fog were
  chosen by hand.

## spawns.json

- **species:** one entry per anole species, with fields `common`, `obs`, `share`, `rarity`
  and `spawns`.
- **spawns:** 968 lizards: 600 crested, 152 brown (8 short of the 160 target: every brown
  anole record was tried), 150 green, and every bark (39) and knight (27) anole record.
  Fields:

  | field | meaning |
  | --- | --- |
  | `sp` | species |
  | `sex` | m, f or u |
  | `perch` | trunk, branch, ground, palm_stem, root, leaf, palm_frond or log |
  | `x`, `y`, `z` | the body where it touches the perch |
  | `host` | what the lizard sits on (see below) |
  | `ang` | direction |
  | `hag` | height above the host's base |
  | `pose` | bark or flat |

  - `host.t` is landmark, plant, clump, log or ground. `host.i` indexes that list; it is
    -1 for the ground.
  - `host.c`, when present, indexes the collider circle of the stem the lizard clings to,
    or of the stem its stub branch grows from.
  - Bark lizards cling to a stem, and `ang` points from the stem axis to the lizard.
  - Flat lizards lie on a surface with the head towards `ang`. A flat lizard with `host.c`
    lies on a short stub branch 0.2 m out from that stem, below the crown: draw the stub.
  - Lizards on the ground (host ground, or at the foot of a host) have `hag` 0, y on the
    terrain, and stand on walkable ground outside every collider.
- **Sampling:** each species is stratified by perch in proportion to its field records, so
  the perch mix follows the field. Every lizard is within 2 m of ground the player can
  stand on and at most 4 m above it, its height is within 0.75 m of its record, a host
  carries at most 6 lizards, and each species has a cap on same-species neighbours within
  3 m (`stats.caps`).
- **Hosts by kind:** trunk records go first to broadleaf and rainbow_eucalyptus landmarks,
  palm_stem and palm_frond records to palm and talipot landmarks, so the kinds in
  `placements.json` decide which lizards a landmark can carry. A palm offers only its bark and
  its fronds (from `crown_base` up), with no branches or stubs.
- **logs:** fallen-log props with fields `x`, `y`, `z`, `len`, `r` and `rot`.
  - x, y, z is the ground under the middle of the log.
  - The log lies level with its axis at y + r, along `(cos rot, 0, -sin rot)`: a cylinder
    built along +x and turned by `rotation.y = rot`.
  - Logs lie on nearly level walkable ground: the ground along each is within 0.08 m of
    the ground at its middle, and at least 7 of 9 points along it are walkable.
- **Privacy:** lizard positions are jittered samples of field records, and each sits at
  least 0.2 m from every record. The file holds no ids, dates, times or record coordinates.

## stakes.json

The survey's stake lattice, 220 stakes 5 m apart, from
`LizardIsland_2025_walkthrough_cleaned/data/grid.json` (`[id, E, N, site]`), made by
`preprocess/stakes.py`. Columns are lettered A to X from west to east and rows numbered 01
to 13 from south to north, so an id such as "C07" is column C, row 07. The game draws every
stake on dry land, a grid flag on each flag target and a temperature logger on every flag
(the logger targets first).

- **stakes:** one object per stake:

  | field | meaning |
  | --- | --- |
  | `id` | the stake's label |
  | `x`, `y`, `z` | the stake's foot; y from the terrain height grid (bilinear, as `data.js` samples it) |
  | `site` | the stake is marked as a site in the stake list |
  | `on` | walkable, thicket, water or land (ground the player cannot reach: an islet, a far bank) |
  | `walk` | metres to the nearest walkable cell (0 on walkable ground) |
  | `canopy` | mean vegetation height over the ground within 2 m, metres |
  | `water` | metres to the nearest water cell |
  | `reach` | a free standing spot (walkable, off every collider circle) lies within 1.2 m |
  | `stand` | that spot `[x, z]`, when `reach` is true |

- **targets:** `flags`, 12 stake ids, and `loggers`, 5 of those, both ordered as a
  nearest-neighbour walk from the top of the causeway.
  - A candidate stands on walkable ground at least 0.5 m from any collider circle, 1 m
    from thicket, clear of bushes and shrubs, 2 m from water, with a standing spot within
    1.2 m.
  - The flag targets are picked by farthest-point sampling from the candidate nearest the
    causeway top, so they spread over the whole island (a walk of about 216 m).
  - The logger targets span the microclimate: the sunniest, the shadiest and the nearest
    water, then the two that add the most spread.
- **stats:** counts (stakes, on walkable ground, reachable, in water, in thicket,
  candidates, site stakes) and `flag_walk_m`.
- The script has no randomness, so a rebuild gives the same bytes.

## scanpos.json

The laser scanner's positions for the TLS mission, from `preprocess/scanpos.py`.
In October 2025 the lab scanned the island with a RIEGL terrestrial laser scanner on a tripod
from 88 scan positions (87 in `LizardIsland_2025_walkthrough_cleaned/data/scanners.json`, `[id, E, N]`, plus ScanPos031 from `LizardIsland_2025_scanpos031/scanpos031_position.csv`, recovered later and never a mission spot):
a rough 10 m walk over the island, round its mangrove fringe and from the far banks.

- **positions:** every scan position on or next to walkable ground (57 of the 88: the far
  banks and the ones deep in the mangrove water are left out), snapped to the nearest free
  tripod spot (walkable, 0.75 m clear of every collider circle) within 2.5 m:

  | field | meaning |
  | --- | --- |
  | `id` | the scan position's name in the survey (never shown to the player) |
  | `x`, `y`, `z` | the tripod spot; y from the terrain height grid (bilinear, as `data.js` samples it) |
  | `on` | where the surveyed spot itself lies: walkable, causeway, thicket, water or land |
  | `moved` | metres from the surveyed spot to the tripod spot (0 when it stands there) |
  | `water`, `thicket` | metres to the nearest water or thicket cell (99 at most) |
  | `clear` | metres to the edge of the nearest collider circle |
  | `canopy` | mean vegetation height over the ground within 10 m, metres |
  | `cover` | collider circles 0.25 m or wider 2.5 to 9 m away (edge): places to duck behind |
  | `causeway` | the spot is on the causeway |
  | `mission` | on a mission spot, its number in the walk |

- **mission:** the mission's 8 spots, `{ n, x, y, z, place, cover, canopy, water }`, in the
  order of a nearest-neighbour walk from the causeway top (about 205 m). A candidate is off
  the causeway, 2.5 m from water, 1 m from thicket and 1.2 m from any collider circle, with
  at least 2 cover circles and trees round about (mean canopy 1 m or more within 10 m). They
  are picked by farthest-point sampling from the candidate nearest the causeway top, each
  distance weighted up to 25 % by cover. `place` is a friendly name for the page and the
  maps: the nearest named landmark within 11 m that no earlier spot took ("by the rainbow
  eucalyptus"), else the part of the island.
- **stats:** counts (surveyed, kept, dropped far, dropped with no spot, candidates, mission,
  moved over 0.5 m) and `mission_walk_m`.
- The script has no randomness, so a rebuild gives the same bytes.
