# Stroud Lab: Field Season

A small, cosy browser game about catching, measuring and releasing anoles on Lizard
Island, an island in a lake at Fairchild Tropical Botanic Garden in Miami. The island is
laid out from the lab's own survey data: the shoreline, lawn and paths from a lidar scan,
the trees and plants where they really stand, and lizards where lizards were really seen.

It runs in any modern desktop browser. There is nothing to install and no build step.

## Playing

You start at the field station, which the ibises raided overnight. Find the scattered
kit, tie a fresh floss loop on your pole and make a practice catch, then the survey day
begins at 07:30 and runs until 18:30.

- **Catch and release** crested, brown, green, bark and knight anoles with the loop pole:
  creep up, lock on, snug the loop at the right moment, then bag, measure, mark and
  release each one back on its perch.
- **Fit GPS backpacks** on the bigger lizards and follow their trails on the map.
- **Clip perch loggers** to see the temperature a lizard lives in through the day.
- **Download the temperature loggers** as you pass them to map warm and cool patches.
  Lizards bask in the sun in the morning and hide in the shade at midday.
- **Field kit missions:** fly the drone survey, run the laser scanner (and stay out of
  its sight), and record plants with the RTK pole.
- **Watch out for the crocodile.**
- **Brown basilisks** rest on the ground by the water. Startle one and it sprints off on its
  hind legs and runs right across the lake. Catch one and it bolts for the water on the
  loop: keep it away from the water, or better, get between it and the water first. A
  caught one can take a GPS backpack too, and its trail shows it up and down the shore with
  the odd dash across the water. Basilisks count on the island board, as the rarest catch.
- **Mind the pole.** A missed snug can snap the floss loop, which you re-tie, and the pole
  can break up in the canopy or when stubbed. The first break is free (a lab rule); after
  that James has the spare at the field station.
- **Jon from the lab** turns up now and then with a tip or a word on where the GPS
  backpacks would tell us most, and once re-ties a snapped loop for you. Nobody ever sees
  him arrive.
- **The field notebook** keeps every species, catch, task stamp and followed lizard.

### Controls

| Key | Action |
|---|---|
| W A S D or arrows | walk |
| Shift | run |
| Ctrl | creep |
| drag, wheel | look round, zoom |
| F or right mouse | raise the loop pole (locks on to the nearest lizard in reach) |
| Tab or wheel while aiming | switch target |
| E or click | catch, use, talk |
| Q, 1 to 6, X | tool ring, quick tools, put the tool away |
| N | field notebook |
| M | map |
| Esc | pause and settings |

A gamepad works too. "Precise aiming" in the settings swaps the lock-on for steering the
loop by hand; days played that way go on their own board.

## Running it locally

The game has to be served over http (opening `index.html` as a file will not work).
From this folder:

```bash
python3 tools/serve.py 8772
```

Then open <http://127.0.0.1:8772/>. three.js loads from jsDelivr, so the browser needs an
internet connection.

## Hosting

The game is a folder of static files, about 5 MB. To make a clean copy for a web server:

```bash
python3 tools/package.py
```

This writes `dist/field-season/` (the game) and `dist/server/` (the optional island
scoreboard). Copy `dist/field-season/` to any web server or static host and it works as
it is. The scoreboard needs a small Python service and one reverse-proxy rule;
`dist/DEPLOY.md` explains both. Without it, the board simply stays hidden.

## What is in this folder

| Path | What it is |
|---|---|
| `index.html`, `src/` | the game: plain JavaScript modules on three.js |
| `data/` | the island as small game files: terrain, water, plants, lizard spawns, palette |
| `preprocess/` | the Python that builds `data/` from the survey data (the survey files themselves are not included) |
| `tools/` | the local server, packaging, the scoreboard server and helpers |
| `NOTES.md` | developer notes: module map, debug flags, tuning |

## The science behind it

- **The island** comes from a terrestrial lidar survey (88 scan positions, October 2025),
  a drone orthomosaic from the same month and an RTK survey of 317 plants (June 2026).
  The look is stylised, but the lawn, shore, causeway and big trees are where they are
  on the real island.
- **The lizards** are placed from the lab's field records: 7,263 sightings of five anole
  species. Positions are sampled and nudged slightly, and no ids, dates or times are
  kept. The 11 brown basilisks come from the spring 2026 survey, each moved 0.2 to 0.6 m;
  their sizes are provisional.
- **The methods** follow real fieldwork: dental-floss loops, clear bags, snout-vent
  length, paint marks, tiny GPS backpacks and microclimate loggers.
- **Four of the five anoles are introduced.** Only the green anole is native to Florida,
  and since brown anoles arrived it perches higher, which is why you find it up on the
  leaves.

## Licence

The code is under the MIT licence (see `LICENSE`). The files in `data/` are derived from
Stroud Lab field surveys and are not covered by it: please ask the lab before reusing them.
