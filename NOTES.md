# Stroud Lab: Field Season, developer notes

A small browser game on Lizard Island, Fairchild Tropical Botanic Garden, built from
the survey data in `data/`. Plain ES modules and three.js 0.160 from jsDelivr through
an import map; no build step, no installs, every model and texture procedural.

## Running

Serve the game folder over HTTP and open `index.html`. `tools/serve.py` is a plain
static server that tells the browser not to cache, so edited modules load on a reload:

    cd LizardIsland_2025_game
    python3 tools/serve.py 8772
    open http://127.0.0.1:8772/index.html

Controls: WASD or the arrow keys walk, hold Shift to run, hold Ctrl to creep, drag
with the mouse to orbit the camera, scroll to zoom. Right mouse or F aims (with the loop pole
out the loop locks on to the lizard in reach; Tab, the wheel or a quick sideways flick
of the mouse moves to the next one, and holding Tab to one out of reach), E or a click uses (talks, loops, plants, reads),
hold Q for the tool ring (let go on a tool), 1 to 6 pick a tool, X puts it away, N or
Tab opens the notebook, M the big map, Esc or P pauses. A gamepad works too (the d-pad
moves between targets while aiming). The field kit's missions add their own
controls while they run, shown on screen: flying the drone, WASD fly, Q and E turn, Space climb,
Ctrl or C descend, Shift faster, X flies it home; the normal ones come back when it lands.

## Module map

    index.html              import map, canvas root #app, UI root #ui, loading card, <pre id="diag">
    src/ui/style.css        page, HUD line, loading card, and the game UI's look
    src/ui/ui.js            the UI system (game.ui): kit layers, HUD, maps, notebook, title, summary, pause
    src/ui/kit.js           dialogue, toasts, hint, stamps, panels, mini-game cards (the one DOM layer a VR build replaces)
    src/ui/hud.js           clock, score, tool badge, the opening's "Getting set up" checklist (with a row of kit icons) or the survey day's Today card, the pause card and its settings column
    src/ui/settings.js      the settings block (sound, play, comfort, Reset save) for the pause card and the title's Settings card, applySettings()
    src/ui/minimap.js       minimap and big map (2D canvas, 10 Hz) from water.json, the grids and the paths; the loggers' warm and cool patches, flag labels, search circles
    src/ui/notebook.js      the Lizard-dex field notebook
    src/ui/title.js, summary.js  the title screen (Start, Continue, Start again with a question first, Skip, Settings, Sound on, the island board's card) and the end-of-day card (with the followed lizards and the board's button)
    src/ui/perch_day.js     the perch loggers' pages: the "day in temperature" card ('perchday'), the drawing, chart, sentence and tiny map, the notebook's "Followed lizards" spreads
    src/ui/scoreboard.js, scoreboard.css  the island board: one ping of the API, the title's card and panel, the end-of-day card's button, rank and top ten (Steady hands too)
    src/ui/daybook.js       another player's notebook for a posted day, read-only, from any board row that has one
    src/ui/drawings.js, icons.js  SVG anoles, the crocodile, James's portrait, the player's badge, icons
    src/main.js             boot, systems list, renderer.setAnimationLoop(tick)
    src/config.js           tunables and URL flags
    src/data.js             loadGameData(): JSON, the three grids and their samplers
    src/debug.js            error capture, ?diag, ?view=top camera, ?debug overlay
    src/core/input.js       abstract actions (move, look, zoom, creep, jog, aim, use, notebook, pause, tool, tool1..6, stow, map, next, prev)
    src/core/events.js      tiny event bus
    src/world/terrain.js    terrain mesh and its painted colours, the skirt beyond the grid, backdrop hedgerows
    src/world/ground_decor.js  desire-line paths (pathMask), wildflowers and clover
    src/world/grass.js      grass tufts round the camera and the ground's grass pattern (optional)
    src/world/water.js      lake surface (ripples filtered by pixel footprint, morning mist)
    src/world/sky.js        sky dome, sun, hemisphere light, fog, clouds, shadow tint and softness, the day's keyframes, setTimeOfDay()
    src/world/fx.js         particles and small effects (game.fx): leaves, dust, splashes, sparkles, fireflies, dragonflies, butterflies, mist wisps, heat shimmer
    src/world/props.js      signpost, field station (its table a mesh of its own that tips over: props.table.setTip), pond life (props; optional)
    src/world/models.js     procedural vegetation and prop geometry
    src/world/vegetation.js buildVegetation(): layout, instancing, hosts, colliders, cut-out
    src/world/veg_layout.js distance fields, clustering, thinning and puff packing for the vegetation
    src/world/wind.js       sway, toon ramps and the cut-out shader chunk
    src/player/avatar.js    the biologist: one skinned mesh, procedural idle, walk, jog, crouch
    src/player/player.js    kinematic controller
    src/player/collision.js circle hash and grid tests, sliding moves
    src/player/camera.js    third-person follow rig
    src/lizards/lizards.js  the lizards (build(game)): spawning near the player from spawns.json, slots, hooks
    src/lizards/brain.js    one lizard's life: idle, noticing, alert, flee, hiding, coming back
    src/lizards/species.js  the five species as behaviour numbers, the noticing and time-of-day rules
    src/lizards/perches.js  the drawn vegetation round the spawns as a triangle index, snapping, escape routes
    src/lizards/anole.js    the anole models: one instanced mesh per species, animated in the vertex shader
    src/lizards/lizards_gallery.html  every species and sex through every action, and a perch scene
    src/wildlife/croc.js    the crocodiles (build(game)): cruising, hauling out, basking, the warning and the snap
    src/wildlife/croc_model.js  the crocodile mesh, its outline and its vertex-shader animation
    src/wildlife/croc_fx.js the wake, splash rings and the "!" and "SNAP!" signs, one draw call
    src/wildlife/croc_sites.js  swim grid, A* routes and haul-out spots (plain JS, runs in node)
    src/wildlife/croc_gallery.html  the crocodile's poses
    src/wildlife/basilisk.js  the brown basilisks (build(game)): the day's few at their sites, the run across the water, the bolt on the loop, a backpacked one's GPS day
    src/wildlife/basilisk_model.js  the basilisk's skinned mesh, its outline, its poses and its GPS backpack
    src/game/rules.js       every number the field season plays by (RULES) and catchPoints()
    src/game/state.js       the state object, phases, the day's clock, score, save and load, URL flags (GAME_FLAGS)
    src/game/tasks.js       research tasks per species, the set-up jobs and field work, stamps
    src/game/daylog.js      the survey day's own notes (state.today.diary) and daySnapshot(), the notebook that goes up with a day
    src/story/script.js     everything James and Jon say (edit their lines here)
    src/story/james.js      James: model, idles, walk, wave, talk, the bag held up to the light (the rig Jon shares)
    src/story/jon.js        Jon from the lab: his model on James's rig, appearing and going out of view, his four jobs
    src/story/flow.js       the story system (game.story): title, intro, the opening, survey day, summary
    src/story/kit_hunt.js   the opening's kit hunt: the raided station's mess, the five scattered pieces, the pop-up card, the ibis with the pens
    src/story/practice.js   picks the practice anole by testing the real world (a clear straight creep from a path, in view from the creep camera)
    src/story/station.js    the field station's kit (sunshade, bags, scale, jars, notebook) as one mesh
    src/story/floss.js      the floss-loop mini-game
    src/story/story.css, opening.css, style.js  the ring's, fades', the floss card's and the kit hunt's styles
    src/tools/ring.js       the tool ring (game.tools): registry, the ring, quick keys, what [E] does
    src/tools/flags.js      stakes, the grid flags standing from the start (labels on the cloth), nearest-flag notes, the catch log
    src/tools/loggers.js    temperature loggers on every flag, the simulated microclimate, passive downloads and the warm and cool patches
    src/tools/perch_loggers.js  the perch loggers (game.tools.perch): the clip offer, the buttons on the bark (one instanced mesh), recording, walk-past downloads, the life stories
    src/tools/markers.js    pulsing job markers, one instanced mesh for all of them (each with an optional scale)
    src/tools/stakes.js     loads data/stakes.json (game.stakes)
    src/tools/backpacks.js, tape.js  the GPS backpacks case and the tape measure
    src/catch/catching.js   catching (game.catching): the loop pole on the ring, spotting, the catch flow, GPS fixes
    src/catch/loop_pole.js  the raised pole, lock-on (the loop finds the lizard in reach), Precise aiming (the loop on the pointer), reach, startles
    src/catch/breaks.js     floss loops that snap and loop poles that break (game.catching.breaks), the re-tie, the lab rule
    src/catch/snap_fx.js    a snapped loop's strands and burst at the pole tip
    src/catch/timing.js     snug the loop: the shrinking ring round the head
    src/catch/release.js    the catch-and-release cards: bag, ruler, paint pen, backpack, perch note
    src/catch/spotting.js   hold the aim on a lizard (or the crocodile) to spot it
    src/catch/tuning.js     the catch's own numbers (reach, startle, timing, sizes); its points come from RULES
    src/catch/drawings.js, catch.css  the cards' SVG anoles and styles
    preprocess/stakes.py    data/stakes.json from the stake lattice
    preprocess/basilisks.py data/basilisks.json from the spring survey's privacy-safe basilisk sites
    models.html             gallery of every procedural model (landmarks, plants, mounds, perches, props)
    tools/serve.py          no-cache static server
    tools/shot.py           headless Chrome screenshots and DOM dumps
    tools/topdown_compare.py  ?view=top against the orthomosaic, into check/
    tools/m3_checks.py      the anole and crocodile check images and their contact sheet, into check/
    tools/scoreboard_server.py  the island board's API (Python standard library only; see "Perch loggers and the island board")
    tools/package.py        builds dist/field-season/ (the hosted game), dist/server/ and dist/DEPLOY.md

The sound lives in `src/audio/` (game.audio, loaded after the UI, before the
effects, in `OPTIONAL_SYSTEMS`; `?noaudio=1` skips it), every sound synthesised live with
the Web Audio API:

    src/audio/index.js      the system: the context on the first gesture, settings (the `audio` API the settings UI uses), events to cues, the per-frame follows, ?audiolog=1
    src/audio/engine.js     buses (music with a duck and an echo, ambience, effects, the jingles, James's voice), glue compressor, drive, limiter, reverb, noise, voice caps, spatial helpers
    src/audio/synth.js      tone, noise hit, grain spray, bell, pluck (kalimba, marimba, flute), pad
    src/audio/sfx.js        every effect cue (sfx_opening.js: the kit found jingle and the table standing up; the ibis is sfx_rtk.js's)
    src/audio/ambience.js   breeze, leaves, lapping water, cicadas, crickets, birds, the garden beyond
    src/audio/music.js      the generative tune (moods: title, morning, midday, evening, summary) and its stings
    src/audio/voice.js      James's babble on the typewriter, the player's name sung, the radio
    src/audio/place.js      metres to the lake, canopy cover and the ground under foot

The field kit lives in `src/missions/` (the drone survey, the laser scanner and the RTK
plant survey, each an optional system, then their registry `game.missions`); its own section,
"The field kit: three missions", has the module list.

## Frame

Metres, y up: `x = E - 573150` (east is +x), `z = -(N - 2840100)` (north is -z),
`y = h + 24.90`, so the lake surface is y = 0. Headings follow three.js `rotation.y`:
0 faces -z, positive turns towards -x, forward is `(-sin h, 0, -cos h)`.
`data/README.md` is the authority on every file.

## The engine in brief

- **Look.** A cosy storybook island, not the survey map: the data is the skeleton
  (where the lawn, shore, causeway, landmark trees and shrub masses are), the colours
  are brighter and warmer than the orthomosaic. `palette.json` sets only the order
  of the ground colours (lawn lighter than shade, then litter, then mud).
- **Frame loop.** `main.js` runs an ordered list of systems, each `update(dt, t)`,
  inside `renderer.setAnimationLoop`. Headless Chrome delivers no animation frames, so
  there, and only there (`FLAGS.headless`: `?headless=1`, `?diag=1`, a HeadlessChrome
  user agent or `navigator.webdriver`), stalled frames are pumped from a timer. Normal
  play and XR run purely from `setAnimationLoop`.
- **Terrain.** One indexed mesh in one draw call. 1 m blocks are drawn at 0.25 m where
  the player can walk, 0.5 m over the rest of the island and fringe land, and 1 m
  elsewhere (and at 0.25 m under any painted path), with the edges of finer blocks
  snapped to coarser neighbours so there are no cracks. On walkable ground the mesh matches the bilinear height grid to within
  2 mm (checked at 400 random points). A skirt carries the grid edge out to 620 m,
  closes the lake and rises gently into the fog. Beyond the surveyed area only, three
  bands of rounded tree clumps and hedgerows (two instanced meshes; trunks in the
  nearest band only) grow paler towards the horizon.
- **Ground colours.** Painted into the terrain's vertex colours: a spring-green lawn
  (warm and cool greens blended at about 8 m), a darker green under canopy, soft
  leaf-litter patches round big trunks (dbh 0.25 m or more under 6 m of canopy),
  thicket ground, mud at the waterline and a pale wet-sand band 0.3 to 1.2 m from the
  water (0.6 times as wide on the causeway, so its edges do not read as a second path),
  mossy mangrove islets with patches of dark mud and a mud rim, a sandy lake bed fading
  to teal by 0.6 m depth, and a soft dark ring at every trunk and bush base (fake
  ambient occlusion).
- **Paths.** `ground_decor.js` runs A* over walkable cells with cost
  `1 + 6 / (1 + d^2)` (d: metres to blocked ground or a trunk), so the lines run down
  the middle of openings, from the garden gate up the causeway to a fork on the SW
  lawn, west past the rainbow eucalyptus, east between the shrub masses to the osprey
  pole, and a spur north up the lawn corridor. Chaikin-smoothed, 1.4 m wide (1.8 m on
  the causeway) with soft edges, painted warm sandy dirt with a few pebbles.
  `pathMask(x, z)` gives 0..1 (alias `pathAt`), `pathDistance(x, z)` metres to the
  nearest centreline and `pathLines()` the centrelines.
- **Flowers and clover.** Two instanced meshes on the terrain mesh: about 630 wildflowers
  in 40 drifts (white, yellow, pink, lilac) and about 250 clover trefoils in 12 patches,
  on open walkable lawn (canopy under 1.5 m), 1 m clear of the paths and thicket, off
  collider circles, ground lizards and the start landing, with a gentle sway.
- **Water.** A plane at y = 0 with a patched Phong shader: depth tint and shore
  distance from a small data texture (R depth, G distance to land, B canopy). Clear
  teal rather than the real tea-brown: pale aqua over the shallows, turquoise, deep
  teal; a light band in the first 0.8 m from shore, a bright white foam line with a
  faint pulsing ring outside it, slow ripples, white sparkles near the camera, a sky
  reflection that turns to leaf shade under the mangroves, and alpha 0.7 over the
  shallows so the sandy bed shows. The top view turns the water's specular off: with
  the sun at 80 degrees the whole lake would sit in the highlight and turn pale mint.
  Each ripple band (and the sparkles and the thin foam ring) fades once a wavelength
  covers fewer than about 6 pixels (`wKeep`, from the pixel's footprint on the water),
  so the far lake lies smooth at grazing angles instead of knitting a crosshatch. With
  the sun low the open sky keeps the surface bright, and `sky.state.mist` lays soft
  drifting veils on the water, thicker further off.
- **Grass.** `grass.js` draws chunky tufts in one draw call: 35,344 slots on a jittered
  0.34 m lattice over a 64 m square that follows the camera and wraps, each standing
  on the height grid in the vertex shader, with density, tallness and colour read
  from textures baked from the terrain's own fields and painter. Dense on open lawn,
  sparse and short on paths, none in thicket, water, mud or on the islets; tufts fade
  out 13 to 30 m from the camera and part round the player's feet. The terrain
  material also gets a painted grass pattern (patches, dabs and blade ticks that fade
  by pixel size). Hidden in the top view; `?nograss=1` turns both off.
- **Vegetation.** The survey is thinned and merged on the render side (data/ is
  untouched): bush and shrub clumps cluster into big soft mounds and hedges, thicket
  masses are packed with a few big round puffs, tiny filler is dropped, and every
  mound and bump over standable ground gets a collider. Landmarks are drawn by kind and
  `sci`: broadleaf crowns of 4 to 6 plump puffs over visible limbs, candy-striped
  rainbow eucalyptus, talipots with huge pleated fans, fan palms (Sabal and the unnamed
  palms) and one feather palm (T021), the osprey pole with its nest and bird. Mangroves
  keep every lizard host, one crown every 2.6 to 2.9 m along open water and paths, and
  the interior merged into wide crowns; each gets neat arched prop roots unless the
  roots would reach walkable ground. Perches (stubs, limbs, fronds, leaf clusters) put
  a surface under every lizard off the ground: a lizard recorded on wood whose host was
  merged into a mound gets a short bare twig out of the foliage (235 of them), and a leaf
  cluster over open water stands on a thin stalk from the lake.
- **Props.** `props.js`: the "Lizard Island" signpost, a field station on the landing
  (table, clipboard and jars, crate, bucket, flag), a picket gate in the landing hedge,
  lily pads, reeds, mushrooms and a wading ibis, in four draw calls. Props keep off the
  paths through `pathMask`.
- **Lighting.** One shadow-casting sun (4096 map, PCF soft, warm `#ffe8c2`) with its
  shadow camera fitted to the island box, a lavender-sky hemisphere fill, a pastel sky
  dome, 22 puffy clouds 55 to 110 m up, and linear fog (90 to 520 m) between a minty
  haze and the horizon. Shadows are blue-violet, never black: `sky.js` patches three's
  light chunk once so that in full shadow the sun keeps 36 % of its light tinted by
  `SHADOW_TINT` (`#8a90e6`, exported). Every lit material shares it. `setTimeOfDay(hours)`
  follows the sun for Miami in late October.
- **The day** (`DAY` in `sky.js`). Keyframes by sky hour, each with the sky's
  top and horizon, fog colour and range, sun colour and strength, hemisphere colours and
  strength, the clouds' glow and albedo under the sun (`cloudA`), the shadows' lift, cool
  and softness, and four atmosphere values (`mist`, `haze`, `glow`, `dusk`), blended with
  a smoothstep between neighbours so nothing ever jumps. The warm colour stays on the
  sun: at the ends of the day the fill is kept lavender (`hemiSky` #b8b2ec to #bebcf0)
  and green (`hemiGround` #8cae6c to #9ec27a), so sunlit patches read gold against cool
  shade rather than the whole frame going khaki. The clock's 07:30 (sky 8.4) is a soft
  golden morning (sun 1.05) with long shadows, lavender shade, mist on the water and the
  fog in to 40 m; late morning (11.2) is the familiar bright day; noon (13.1) is a deeper
  blue overhead with a bleached, hazy horizon, short crisp shadows and the heat shimmer;
  16.3 and 17.3 are warm gold (sun 1.0); 18:30 (17.9) is a pink-orange sunset glow round
  a softer sun (0.75), pink cloud undersides and dusk enough for fireflies (dusk 0.25 at
  17.3, so they start at about 17:45). Dawn, dusk and night keys serve `?t=`. The shadow
  lift (the share of sun kept in full shadow, 0.33 at noon to 0.42 in the morning), the
  cool (how far the sun's own colour in shadow is washed towards grey before the lavender
  `SHADOW_TINT`, 0 by day to 0.75 at sunset, so an orange sun still leaves lavender shade,
  never magenta-olive) and the PCF filter's width (1 to 1.1 texels by day) ride on
  `sun.shadow.radius`, packed by `packShadow(lift, soft, cool)`: soft in 1/20ths in the
  whole part, (round(lift x 255) x 32 + round(cool x 31)) / 8192 in the fraction, which
  the patched light and shadow chunks decode; a plain light (radius under 1.5, as in the
  galleries) keeps 0.36, no cool and 1. The dome adds the sunset glow along the horizon
  (strongest towards the sun) with a soft shoulder, weighted by the glow, that eases the
  light round a low sun towards white instead of clipping red (off at noon), a pale haze
  band at noon and a whisper of dither. The clouds' undersides take the sky's colour
  from below (never the hemisphere's green ground), so sunset clouds stay pink with some
  form. `setTimeOfDay(h)` always sets the hour but re-blends (flat `Float64Array`s, no
  garbage) and re-fits the shadow only once the sky hour has moved 0.001 h. `sky.state`
  carries `mist`, `haze`, `glow`, `dusk`, `fogColor` and `look` (the blended keyframe, a
  fixed-field object written in place) for the water and the effects.
- **Player.** A chunky little biologist (head over a third of the height, rosy cheeks,
  bucket hat with a daisy, vest, orange backpack with a teal mat, boots, a 2.5 m bamboo
  loop pole whose coral loop hangs from the tip on its own bone). One skinned mesh,
  a thin inverted-hull outline on the same skeleton and a soft contact shadow: three
  draw calls. Speeds creep 0.9, walk 2.0, jog 4.0 m/s. Only walkable cells can be stood
  on; thicket, water and the far banks are blocked and the collider circles are solid.
  Trunk circles (r = dbh / 2 + 0.15) are met at a body radius of 0.2 m, bush and prop
  circles at 0.28 m, so the chest stops about 0.17 m from bark. `teleport()` searches
  outwards for a free spot (6 m, then 80 m) the player can walk about from
  (`collision.roomy`: 1 m2 reachable in 0.1 m moves) and falls back to the start.
  Moves are sub-stepped at 0.1 m and resolved by pushing out of circles and blocked
  cells, which slides along edges. A push never adds speed. Logs from `spawns.json`
  can be stepped over. `player.noise` runs from 0 (standing or creeping) to 1 (jogging).
- **Camera.** Behind and above, smoothed, orbit by drag, fov 42, distance 8 m, pitch 0.5
  rad (0.22 to 1.1), zoom 2.4 to 18 m, and a gentle swing back behind the player while
  walking. The first view is lower (0.36 rad) up the causeway and eases to the default
  once the player walks, unless the player has tilted it. It is kept above the ground
  and the water. While the player creeps (or crouches) it eases in about 0.4 s to a
  creep framing: pitch at least 0.8 rad, distance at most 5 m, the target 0.5 m to the
  right (over the shoulder) and leaning 30 % of the way to `rig.hint`, which the lizards
  set to the nearest shown lizard within 6 m ahead. The ground hidden behind the hat
  shrinks from about 3 m ahead of the feet to about 1.6 m, and off centre.
  Aiming the loop pole (`rig.aim`) eases in over a shoulder, 4.4 m back with a 32 degree lens;
  each time aiming starts it takes the shoulder with the clearer view (`rig.clearance`,
  from the catch: colliders and low canopy along and beside the line to the lizard, and
  whether the lizard can be seen from there at all), and the vegetation cut-out runs from
  the camera towards the lizard, 2.2 m wide, stopping 1.4 m short so its perch stays
  whole. The snug (`rig.aimFov` 22) comes 1.2 m nearer and a little higher, and the
  player thins to a dithered ghost (`avatar.setFade`) so the hat never hides the lizard.

## Lizards and crocodiles

`main.js` loads `src/lizards/lizards.js` and `src/wildlife/croc.js` as optional systems
(`OPTIONAL_SYSTEMS`): each exports `build(game)`, the result is stored as `game.lizards`
and `game.croc`, its group joins the scene and its `update` runs after the vegetation.
`?nolizards=1` and `?nocroc=1` skip them. Neither is drawn in the top view.

- **Spawns.** Only `data/spawns.json` is read (sampled, jittered points with species,
  sex, perch and pose). No coordinates, ids or dates reach the player.
- **Perches.** `perches.js` indexes the drawn wood and the upper sides of leaves near the
  spawns (about 155 k triangles) and snaps every spawn onto them: bark lizards by
  horizontal rays at the stem, lizards lying on something by downward rays, ground
  lizards onto the terrain. A lizard recorded on a trunk, branch, palm stem or root looks
  for wood first (below, then within 0.5 m, then the side of its trunk) and only then
  lies on leaves: 18 of 968 still do (a knight that would end up on a low bush is left
  out). A branch lizard is moved onto the ridge of its limb, turned along the limb (found
  by probing the wood round it, not stem to perch), upright across it, and slid up to
  0.24 m along it to where its body lies on one straight stretch with the tail clear of
  the trunk; its tail lies on the limb as far as the limb goes and then droops over the
  end (or bends up where the limb rises), never more than 1 cm into wood. Bark lizards
  rest head down where head up would dip the tail in the lake or the soil. All
  off-ground spawns sit on drawn geometry and sway with their bark or leaf
  (`swayOffset` repeats `wind.js`).
- **Slots.** 36 lizards are active within 35 m of the player, re-picked every 0.4 s by
  distance over an encounter weight (rarer species reach a little further), from a 10 m
  grid of the spawns and without allocating. No more than 2 are active on one host (3 on
  a landmark trunk over 0.3 m thick), none within 0.6 m of another on the same host. A
  lizard on screen keeps its slot; one activated in plain view starts out of sight and
  walks out.
- **Behaviour** (`brain.js`, numbers in `species.js`). A flight distance from the
  player's noise (creeping counts 0.58 of walking), closing speed, facing, trunk cover,
  coming up behind a lizard on an open perch (25 % less), height, mood, wariness and
  habit. Alert (freeze, watch, sometimes a dewlap) comes before flight, and an alert
  lizard is 1.3 to 1.45 times jumpier, so a creeping player has to stop while it watches:
  it settles after 2 s under half its flight threshold, often with a head bob, and each
  time it settles it gets 20 % bolder (to 0.55 at most, back to normal over about 30 s
  or at once if it runs). Crested and bark anoles dart round the trunk and keep it
  between them and the player (bark anoles pressed flat), and while hiding peek round
  its side now and then, head turned to the player; brown anoles dash over the ground to
  cover and go round a stem to its far side before slipping out of sight; green and
  knight anoles climb into the crown or hop over leaves; a branch lizard with its trunk
  towards the player goes out along the branch or presses flat and holds; a cornered
  knight gapes first. An escape takes at least 0.7 s, and the lizard fades out over
  0.15 s. Hidden lizards come back after 4 to 15 s (by species) once the player is 2 m
  off and standing still, or 4 m off and moving. Idle life: head bobs, push-ups and
  dewlap flashes in each species' timing, two (males) or three (females) times as often
  for a player standing still within 6 m, shown side on to a nearby player (bark lizards
  turn head up or down across the line of sight, those on the ground, leaves and logs
  turn broadside); bug snaps, small turns and glances; the renderer adds blinks,
  breathing and tail flicks. Asleep at night the eyes close. A croc's snap sends every
  lizard within 10 m running.
- **Sun and shade** (`THERMAL` in `species.js`). Real anole thermal ecology,
  simplified so it reads. `warmth(hours, sunY)` (sky hours) is the day's curve
  (`THERMAL.warmth`: 0 to 9.6, 1 from 12.2 to 14.9, 0 again from 16.7) times a smoothstep
  of the sun's height (`THERMAL.sunHot`, the sine of its elevation from 0.55 to 0.78), so
  the heat spell sits round solar noon and the low afternoon sun reaching the trunks under
  the crowns never makes a late heat peak: 'too hot' runs from about 10:55 to 15:15 on the
  clock, and the warmth is above 0 from about 09:50 to 16:10. It is worked out only when
  the sky moves, with no garbage. A lizard's `exposure` (0..1,
  `sunExposure`) is the sun's height times the light left after the ray to the sun
  crosses what is drawn (`THERMAL.drawn`: the crowns, palm fans and bushes of `veg.hosts`
  as ellipsoids a little inside their outlines, and the trunks as cylinders, filed in a
  3 m grid; each metre inside one takes `loss` 2.5 of the light), and on a trunk whether
  the sun is on its side (the far side is in the trunk's own shade). So a basking lizard
  sits where the shadow map draws sun: read back against the shadow map itself for all
  968 perches, about nine in ten agree through the day, and the sunny share (15 to 24 %)
  matches the drawn one. The canopy grid alone (foliage filling each column from half its
  height, 0.4 of the light lost per metre) agrees less often and puts about half its sunny
  perches in drawn shade, so it is used only with `?noveg=1`. `setMood(hours, sunUp, exposure, warmth)` every 5 s: in the sun (over 0.3) while
  it is cool, a lizard basks (flatter, broadside to the sun on open perches, displays
  1.35 times as often, flight distance 1.05: showier and a touch warier); in full sun in
  the heat (warmth over 0.55, exposure over 0.3 times the species' `heat`: brown 1.25,
  green 0.85, bark 0.9) it is too hot (half the displays, flight 1.08) and moves (`thermalMove`, every
  5 to 12 s when calm, idle, unwary and not pinned): round its trunk to the shady side, or
  off along its own escape (planned away from the sun) into cover, where it waits out of
  sight (`shelter`) until warmth falls below 0.42 and then walks back out to bask (no
  wariness after). On a cool morning a lizard in the shade walks round its trunk into the
  sun. In the shade (`mood.shade`, 1 under 0.12 exposure) it is calmer (flight 0.88) and
  quieter (displays 0.8) and a smaller pick target (0.78 of the radius), so harder to
  spot. `brain.js` caps the mood's flight factor times the sight at 1, so a basking or hot
  lizard is never jumpier than a calm one watching the player come straight at it: the
  largest creeping flight distance anywhere is 2.24 m, inside the loop pole's 2.5 m. Displays run 1.3 times as often in the cool morning, 0.6 times in the heat; a
  flight hides 1.5 times as long at the height of the heat. The slot weights follow the
  sun too (`THERMAL.slot`: sunny homes picked sooner in the cool, shady ones in the heat,
  from each spawn's home exposure refreshed 24 spawns a frame while the sun moves), and a
  lizard activated out of view starts where the sun would have sent it. Asleep at night.
  The rule is taught as it happens: James's morning talk ends its first part with it
  (`SCRIPT.survey.sunBrief`, or `sun.midday` / `sun.afternoon` on a day started later),
  and the crested anole he points out for a new player's first catch is, when one fits,
  one sitting as the rule says (basking in the cool: `firstLizardSun`). The Today card
  carries a sun row ("Cool morning: look in the sun", "Midday heat: look in the shade",
  "Cooling off: look in the sun"; once a logger patch of the colour that matters is fresh on
  the map, at least half fresh, it says "Cool morning: orange patches" or "Midday heat: blue
  patches" instead, `freshPatchFor` in `hud.js`) from `game.story.sunPhase`: the lizards'
  `thermalPhase()` (which keeps 'midday' while hot and sheltering lizards outnumber
  basking ones, so the turns come at about 11:00 and 16:00 on the clock) once a change
  has held for 2 s, glowing once when it turns. As the
  phase turns to midday and back James says so in a toast (`SCRIPT.survey.heat.on` and
  `.off`, once each way a day, held back while a talk, a card or a catch is on). His chat
  adds a line about the sun by `thermalPhase()`
  (`SCRIPT.survey.sun`), two cheers mention it, and each species page in the notebook
  shows a "Best time" line (`SCRIPT.survey.bestTime`). `game.lizards.warmth()`, `thermalPhase()`, and
  `stats.thermal` (basking, hot, shaded, moving, sheltering) are there for the UI and checks.
- **Models** (`anole.js`). Chunky toon lizards at about twice real size (crested 0.38 m,
  brown 0.34, green 0.36, bark 0.26, knight 0.8), big eyes on the sides of a long wedge
  head (longest on the green anole; the knight has a bony casque and a triangle of
  ridges to the snout and a heavy jaw), sprawled legs with bent elbows and the belly
  low, a thin outline shell in the same draw call and a faint warm rim light (stronger
  on the yellow-lime green anole and knight, so they show against leaves). A gape
  hinges the jaw at the back of the head about 35 degrees and lifts the head, showing a
  dark rose mouth, pale palate and pink tongue; the dewlap stays folded unless it is
  set too. One instanced mesh per species with no holes (the last handle moves into a
  freed slot, handles are pooled); legs, spine, head, dewlap, crests, tail (curl, flick
  and droop), flatten, gape, stress tint, closed eyes and a backpack all move in the
  vertex shader from one interleaved per-instance buffer. A lizard inside the
  vegetation's camera cut-out dithers 70 % away, a faint ghost of 30 % left
  (`CUT_GLSL` from `wind.js`), and one slipping out of sight dithers out over 0.15 s. The handle conventions are in the file's header.
- **Crocodiles** (`croc.js`). Two American crocodiles in one instanced mesh. They cruise
  open water on A* routes over a 0.5 m swim grid, floating low and a little nose up so
  only the eyes, the nose, a thin line of snout between them and the scutes along the
  spine break the surface, and now and then haul out on one of 9 spots found from the
  mask (sunny ones in the morning and late afternoon, shady ones at midday), bask for
  70 to 140 s, gaping with the head tipped up and the chin on the ground, and slide back
  in. They keep to the player's side of the lake and pick spots near the player (best
  8 to 25 m ahead of them, never within 8 m ahead or 12 m behind), weighed by the swim
  route there and by rare lizards (knight, bark, a little green) within 6 m of the spot.
  Out of sight and over 20 m from the player they swim 3 times faster; one basking
  unseen and 30 m or more from the player for 45 s moves on. A croc afloat never swims
  up to the player: within 5.5 m it turns away. The swim grid keeps 17 m from the start
  and 5.5 m from the causeway, the spots 17.5 m from the start, so no part of a croc
  comes within 15 m of the start, and nothing warns a player on the causeway.
  The hazard: first a silent look (head up, eyes on the player) from 3 m beyond the
  warning; then within 4 m of its body, plus 1 m for each m/s of the player's speed
  (6 m walking, 8 m running), it hisses and shows "!" (`croc:warn`). The warning ends
  1.2 m beyond where it began, or after 12 s out of reach. Within 2 m for 0.9 s, or
  nearer than 1.3 m, it lunges if the player is within 100 degrees of its nose seen from
  its neck (its head swings round to them): "SNAP!" (`croc:snap`) where the jaws close,
  the player pushed back 2.4 m through `collision.move`, the camera shakes; then it
  settles or leaves (`croc:calm`). Come at it from behind instead and it slides off into
  the water, no penalty. It never leaves the water to chase. A croc lying on land is
  solid (moving circles), a croc that crawls or lunges onto a still player shoves them
  clear, and no spot can cut off walkable ground. A croc wedged against a bank drifts
  back to the middle of its swim cell and finds a new way; a spot it cannot reach is
  left alone for 5 minutes.
- **Brown basilisks** (`src/wildlife/basilisk.js`, `game.basilisks`, after the crocodiles in
  `OPTIONAL_SYSTEMS`; `?nobasilisks=1` skips them). The 11 sites of `data/basilisks.json`;
  on each survey day 4 of them have a basilisk (`BASILISK.roster`, drawn from `makeRng` seeded
  by `?basiliskseed=n` or the clock, and the day's number; `?basilisks=all` puts one at every
  site, in any phase). Survey day only otherwise. Each site keeps one individual all session:
  its sex from its own seed, its SVL from the provisional ranges (`CATCH.svl.basilisk`,
  `trueSvl`) and its drawn size from that (170 mm is the model's size). It rests on open
  walkable ground, 0.4 m clear of every trunk and bush, 2.4 to 4.5 m up from the water within
  7 m of its home (so there is room to come between it and the water). Sites 5 and 8 are well
  inland, with no such ground near their homes: those two rest on the nearest open ground
  and dash 16 and 21 m to the water, so on the loop they tire before they get there. Once
  caught, either settles by the water it ran for (`shore`: such ground within 8 m of where it
  runs in), so its GPS fixes, its perch logger and where it rests from then on agree; a new
  season (`state:reset`) puts it back. It runs
  for the nearest water (its entry, 0.4 m clear of land), round any trunk or bush in the way,
  and across it to the landing worked out at load: the far bank or a mud islet (land that is
  not the island's open ground) after at least 3 m of water, from a fan of headings round
  straight on, about 7 m of water if it can. Startled (a player walking at it inside
  `BASILISK.fid` 3.6 m, times the anoles' `noiseFactor`: about 2.1 m creeping, 7.9 m running,
  and 1.3 times further while it watches; jogging within 7 m), it runs on four legs for 0.3 s,
  rears up and sprints on two at 4 m/s, then runs across the water at 3.3 m/s, a splash
  (`fx.burst('splash')`, not with reduced motion) at each footfall and `basilisk:patter` every
  0.16 s for its sound; the ground and log anoles within 5 m of it bolt for cover
  (`lz.bolt`). It waits on the far side 35 to 70 s and goes home once it and its home are out
  of view and the player is 12 m off. Watched running on the water for 0.6 s (in view, within
  40 m) it emits `basilisk:waterrun` { basilisk, first } and a quiet `lizard:spotted`; the
  season's first brings James's radio line (`SCRIPT.survey.basiliskRun`, flow.js). It watches
  a moving player from 1.6 times its flight distance, settles after 2.2 s of a still one
  (each time a little bolder) and head bobs now and then (`lizard:display`).
  - *To the catch* each one is a lizard (`game.lizards.guests`: `pick`, `nearest` and
    `forEachVisible` take them in, and the loop pole's lock-on, Precise aiming and startles
    look through them too): species `'basilisk'`, perch and surface `'ground'`, `state`,
    `visible`, `display`, `tag`, `length` (0.6 times its scale: the body, not the tail),
    `headPosition(v)` from its pose, `freeze()`, `unfreeze()`, `capture()`, `release(x, y,
    z)` (it sprints off for the water) and `bolt()`.
  - *On the loop* (`sprint(opts)`, which `catching.js` awaits after a good snug and before the
    lift): it runs for the water at 1.6 m/s but shies from the player, so a player stood
    between it and the water turns it inland (Jon's hint); [A] and [D] (the move stick's x)
    push it across the view at 3.4 rad/s against its 1.7 rad/s turn for the water, and the
    player is pulled along behind on a 2.2 m tether (`player.tow`, a velocity Player.update
    uses while held). Heading away from the water tires it; 2.2 s of that (or 9 s in all) and
    the lift goes ahead. With the water within 1.8 m ahead (about 1.1 s at its pace) the tell
    shows ("Nearly at the water! Pull it round!"), and it can only reach the water once the
    tell has been up 0.6 s: then the loop slips, `lizard:escaped` { why: 'water' } and it runs
    off across the water. While the water is that near, [A] and [D] turn it about its own side
    (the way the push across the view first turned it) at 1.6 times the rate, so a firm pull
    can bring it right round, even where the shore bends; steering within about 0.4 s of the
    tell saves the catch from the land side. Once the water is no longer ahead the tell
    drains (from at most 0.6 s) at half the rate it built up.
    Scripted catches steer with `opts.steer` ('away' or 'none'; `auto` catches steer away).
    A missed snug is as for an anole (the snap and break odds, then it bolts).
  - *The work-up*: the bag, ruler (the knight's scale), paint pen, the GPS backpack, perch
    notes and the perch logger, as for an anole. The bag card's chip says the crest's word on
    its sex ("Tall crest: a male"). Points as the rarest anoles (`RULES.rarity.basilisk`, very
    rare).
  - *GPS backpacks.* Every adult takes one (`CATCH.svl.basilisk.pack` 90 mm), from the same
    case and through the same card ("Settle it on its back"), and Jon's word on the
    backpacks' spread counts basilisks as a species of their own (`SCRIPT.jon.steer.basilisk`,
    "Another basilisk? We've got two on the go already, and there are only eleven."). The
    pack (`setPack(colour)` in basilisk_model.js) is the anoles' shape at the basilisk's size,
    on the spine bone in the middle of the back, on two straps round its middle; it scales
    with the basilisk and is hidden until fitted. A tagged basilisk's fixes come from
    `trailAt(hours)` (catching.js asks it in place of the anoles' wander round the perch), a
    made-up day worked out once per basilisk (`trailOf`, on the fixes' 0.5 m grid): up and
    down a stretch of shore and lawn edge near its rest spot (open walkable ground 0.8 to 4 m
    from the water, one spot a metre along the shore, gaps of 2 m at most, within 9 m), the
    shadiest such spot within 8 m (up to 6 m from the water) from about 11:40 to 14:15, and a
    dash across the water to a far bank or islet and back in the morning and the afternoon
    (half an hour, the middle half on the far side: the nearest dry spot within 6 m of where
    its run lands that is off the island's open ground, out of the thicket and at least 3 m
    of water (`TRAIL.wet`) from the shore it leaves, so its line on the map crosses the water;
    else the same for a run from a fan of headings at most 12 m long; 6 of the 11 sites have
    one, 1, 2, 7, 8, 9 and 10, and the other 5 never dash). Never in the thicket; a site well
    inland (5 and 8) walks the shore by the water it runs for, where it settles once caught.
    The maps, the tracked page, the GPS case, the perch logger's story and the day notebook
    take it as an anole's trail.
  - *Perch loggers*: clipped beside its rest spot by the water (an inland one's too, by
    then; the home is ground, `SURF.GROUND`), with the lake behind it in the card's and the
    life story's drawing; its day is read by the rules (`derivedCode`, it has no brain), and
    while the player visits a ready logger it is calm as the anoles are (only a run bolts
    it).
  - *Model* (`basilisk_model.js`): one `SkinnedMesh` on 19 bones and its outline, the
    geometry made once per sex with `mergeParts` (james.js). Olive brown, two pale stripes a
    side painted on latitude rings (eye to hip, lip to shoulder), a banded whip tail, long
    hind legs and toes, big eyes; a male's tall swept head crest and low back and tail crests,
    a female's small head crest. `pose(P, t)` takes pitch, hip height, splay, gait (0 still, 1
    four legs, 2 two legs), phase and stride, head pitch and yaw, tail lift and sway. A
    bounding sphere covers every pose, so it is culled out of view.
  - *Random draws*: every mesh, bone texture and the group are made at load with
    `Math.random` pointed at a local source for the moment (three.js takes object ids from
    it), and every draw of theirs comes from `makeRng`, so the island draws the same numbers
    with them as without; the update reads the camera's matrices as last drawn and never
    updates them.

## Effects

`src/world/fx.js` (`game.fx`, an optional system after the audio; `?nofx=1` skips it,
nothing in `?view=top`). Two sprite draw calls (THREE.Points with a small shader that
draws each shape: puff, leaf, drop, sparkle, firefly glow, butterfly, dragonfly, a ring
flattened onto the water), each only while it has something in it, plus the mist (1,
mornings) and the heat shimmer (1, in the survey day's heat). All buffers are
preallocated and filled in place each frame; a sprite's eleven numbers go through a
scratch `Float64Array` (`SP`) and the timers live in another (`TM`), so once warm
`update()` leaves about 0.1 to 0.2 KB a frame.

- **From the player's feet:** a step every 0.4 to 0.85 m; running on a path
  (`pathMask` over 0.3) kicks up dust puffs; at the water's edge a plash throws drops
  and a spreading ring onto the water beside it, on the first step into the fringe (at
  most every 0.6 s) and then every 1.3 s while walking along it (`FX.splash`). Brushing
  past a bush (a mound from `veg.hosts.mounds` within 0.5 m of its edge) or through a
  fern (the `veg-fern` instances) at walking pace or faster flicks out leaves on first
  touch (at most every 0.4 s) and then every 1.3 s while still brushing, sooner at a run
  by the square root of the speed (`FX.brush`; creeping is quiet). So a walk along the
  causeway's edge makes about 40 plashes a minute and a walk along a hedge about 45
  swishes.
- **From events:** `lizard:hidden` with `away` within 22 m rustles a few leaves where it
  went; a new species (`lizard:spotted` that is the first of its kind in the notebook,
  or `lizard:caught` with `bonus.first`) bursts gold sparkles round it or round the
  player's head; `ui:stamp` sends ten little stars out from the stamp in the page (Web
  Animations, pooled, not with reduced motion).
- **Round the player:** up to 6 butterflies (0.24 m) by day, two of them (`FX.nearFlies`)
  kept 2 to 6 m from the player and in view, each homed on a flower from the drifts (the
  `decor-flowers` instances; open lawn when there is none near) and away and back once
  the player is 14 m off, the rest over the drifts round about; up to 4 dragonflies hover
  and dart over the water near a shore by day; up to 26 fireflies blink over the open lawn
  as `sky.state.dusk` rises (from about 17:45 on the clock, all out by 18:20, and the
  summary); a leaf falls from the canopy near the player every 1.4 to 3.6 s.
- **Mist:** 26 soft wisps over open water, billboards turned to the camera, fading in
  at their feet and out at the top, drifting; their strength is `sky.state.mist`. Each
  fades as the view looks down on it more steeply (1 - smoothstep(0.35, 0.7)), so a high
  camera sees no white streaks and the view along the path keeps its veils.
- **Heat shimmer:** a curtain 24 m ahead across the view, depth-tested, copies the
  frame drawn so far (`renderer.copyFramebufferToTexture`) and draws it again with a
  rising ripple of about 2 pixels, so the far lawn and tree line wobble at noon. Only in
  the survey day (or a plain check view with no story phase), while `sky.state.haze` is
  over 0.25 and its band is on screen and in front of the camera; the intro and the
  opening never pay for it.
- **Reduced motion** (`state.settings.reducedMotion`): no butterflies, dragonflies,
  fireflies, falling leaves, leaf, dust or splash puffs, mist, shimmer or page sparkles;
  only the new species' gold sparkle stays, and `fx:brush` and `fx:splash` still fire so
  their sounds play. `FX` holds the numbers; `burst(kind, x, y, z, n)` (leaves, dust,
  splash, sparkle) is there for checks and other modules; `stats` counts sprites,
  particles, animals and draw calls.
- **Heard as well as seen:** a puff from the player's own feet emits `fx:brush` (a bush or
  a fern) or `fx:splash` (a step at the water's edge) with `(x, z, k)`, and the sound system
  plays a leafy swish or a little plash there at the same moment (`sfx.brush`,
  `sfx.paddle`, peaks -22 to -29 dBFS, level with the footsteps). With `?nofx=1` those two
  sounds go too. Fireflies are placed mostly within about 60 degrees of where the camera
  looks, so the dusk picture has them in it.

## Sound

`src/audio/` (`game.audio`, an optional system after the UI; `?noaudio=1` skips it). No
sample files: every sound is built from oscillators, noise buffers made at start, filters
and envelopes, scheduled a little ahead on the audio clock.

- **The context** is made on the first pointer, key or touch (browsers want a gesture),
  suspended while the tab is hidden and resumed on return. Nothing plays before it. The
  title shows a small "Sound on" pill beside Settings until the context is running (it
  calls `audio.unlock()`; any click or key does the same); woken on the title, the title
  tune starts within 0.25 s, and Start carries it on into the morning set at the next bar
  line instead of resting.
- **The mix** (`engine.js`): music (ducked under talks, mini-games, the snug, panels and
  stings, and to 0.7 while the loop is locked on a lizard, the 'aim' duck, so its little
  cues come through; with a soft echo), ambience, effects, the jingles (every sting, on a
  bus of their own that follows the Effects slider, with its own reverb send) and James's
  voice (its own volume), each sending to one shared 2.1 s procedural reverb; then master
  volume, mute, a gentle glue compressor, a drive, a limiter and a trim. Voice caps per
  bus (effects 26, ambience 12, music 24, stings 8): a cue over the cap is dropped.
  Spatial cues are panned and faded by distance; one dead centre (|pan| 0.02 or less)
  skips the panner and plays 3 dB down, so it matches the same cue a step to the side.
- **Levels** (offline renders through the game's own chain, K-weighted momentary max):
  the croc's SNAP is the loudest moment of a day, -17.7 LUFS at 2 m side on and -17.2
  ahead (a double jaw clack, a woody knock and a body thrash, peak -5.1 dBFS), with its
  hiss about 4 dB under it (-21.1 at 4 m); a new species -19.3, a routine catch -20.8,
  the catch sting -21.5, a stamp -25.8, James -27.0; routine sounds sit low (a logger
  reading -28.6, a download -28.3, the backpack's beeps -29.7, the strap's ratchet
  held 2 s -36.8). Every cue stays under -3 dBFS (all sliders at full -3.9, the defaults
  -4.8). A simulated 12-minute day integrates at -29.7 LUFS with nothing dropped.
- **Ambience** follows the clock (clock hours) and the place (`place.js`: metres to the lake,
  canopy cover and the ground underfoot, from 1 m fields built once): breeze, leaves, lapping
  water near the shore, cicadas in the heat (from about 10:10 to 17:30, with the sky's haze
  and the heat shimmer; a sine gate, about 4 dB softer under the trees, each singing in
  waves of 20 to 40 s and resting 20 to 60 s at a low hum, 26 dB under the song), crickets
  towards dusk (pulsed by a rounded wave, not a square, so the chirps do not tick), birds
  by the hour, now and then the garden beyond. Calls are scheduled 0.5 s ahead. The leaves
  are two unrelated noise streams, one to each side, band-passed 1.1 to 4.2 kHz, whose
  level moves on a log scale with slow gusts (about 5 dB, 1 sd) and a flutter (about
  2.5 dB), so they swell and all but drop away rather than hiss on; they and the cicadas
  use a 7.3 s noise buffer of their own (`E.noise.bed`). Every noise buffer loops with an
  equal-power crossfade folded into its head, so its end runs straight on into its start
  with no step and no dip.
- **Music** (`music.js`): a generative tune in F major, sets of 2 to 4 eight-bar phrases
  with rests of 14 to 45 s, scheduled 1 s ahead; moods by the clock (morning to 11:15,
  midday to 15:15, evening; the intro follows the day's clock too, so it is a morning), the
  title and the summary; stings for a catch, a new species, a stamp, a request, a new
  survey day and the day's end.
- **Effects** (`sfx.js`) come from events (below) and a few things read each frame:
  footsteps on the avatar's own stride and the ground's surface, the loop gliding to a new
  lizard and settling, the snug ring's ticks and green band, the mini-games' taps, a croc
  sliding in or out. Spatial cues (croc, scurries, rustles, displays, brush, paddle) are
  panned and faded by distance from the player, heard along the camera's right hand.
  A far display, rustle or scurry is tested for being heard before it is throttled or
  logged, so it never uses up a near one's turn. The lizards' timing cues: a head bob or
  push-up by the lizard the loop is on is two short pips in key and its dewlap a louder
  shimmer (`display(..., target)`), so the moment to click can be heard. The notice
  squeak comes from the nearest alerting lizard in front of the view or the player within
  8 m (9 creeping), at most every 1.5 s (1 s creeping; the locked lizard every 0.6 s).
- **Toasts and stamps:** a toast's chime waits 60 ms (`TOAST_HOLD`), and a stamp, sting,
  release, flag, reading, download, tape or request that lands in that time silences it.
  The first stamp of a burst keeps its little sting and the rest only thunk softly; a
  stamp that lands on a catch's or a request's own sting thunks without one. Reward stings
  from one moment play one after the other, never on top (a catch that finishes a request:
  the catch's first, the request's bells about 1.3 s later), and the croc's SNAP silences
  its own toast's chime so it stands alone.
- **James's voice** (`voice.js`): babble on one always-on voice that follows the
  typewriter (`dialogue:type`), a pitch and vowel per letter, the player's name sung, the
  radio band-limited. A key that finishes a line early emits `dialogue:skip` (`kit.js`)
  and he hushes at once (with a fallback that allows for late typewriter ticks). The
  radio's hiss (pink noise, 2.2 to 6 kHz) is held open by his syllables and closes about
  0.3 s after the last one, like a radio's button; `dialogue:close` turns the radio off
  with its closing squelch, and `update()` turns it off whenever no dialogue is up, so no
  hiss is left running after a radio talk.
- **Events it listens to:** `phase:change`, `day:end`, `dialogue:open`, `dialogue:type`,
  `dialogue:skip`, `dialogue:close`, `minigame:start`, `minigame:end`, `panel:open`, `panel:close`,
  `notebook:page`, `ui:toast`, `ui:stamp`, `request:done`, `lizard:caught`,
  `practice:done`, `lizard:released`, `lizard:escaped`, `card:act`, `lizard:flee`,
  `lizard:hidden`, `lizard:display`, `lizard:alert`, `fx:brush`, `fx:splash`,
  `pole:aim`, `pole:whiff`, `pole:bop`, `pole:target`, `croc:warn`, `croc:snap`,
  `flag:placed`, `logger:placed`, `logger:read`, `gps:download`, `tape:measured`,
  `setup:floss`, `setup:station`, `tool:equip`, `ring:open`, `ring:close` and
  `settings:change`; clicks and hovers on the page's buttons and key ticks in the name box
  come from the DOM.
- **The API** the settings use: `import { audio } from './audio/index.js'`, with
  `controls`, `getVolume(key)`, `setVolume(key, v)`, `isMuted()`, `setMuted(on)`,
  `toggleMute()`, `reset()`, `preview(key)`, `cue(name, ...args)`, `unlock()` and
  `running`. The volumes (master 0.8, music 0.65, ambience 0.75, effects 0.85, voice 0.85
  by default; the gain is the slider squared) and mute live in `state.settings.audio` and
  are saved under `stroudlab.fieldseason.audio.v1` (with try/catch; not on runs with the
  debug flags); a damaged save is taken field by field (a number from 0 to 1, a true or
  false mute) and anything else keeps its default. It emits `audio:settings` when one
  changes. `preview('music')` plays three notes of the tune past the duck and
  `preview('voice')` a short babble.
- **Checks:** `?audiolog=1` makes the context at once and records every cue with its time
  into `modules.audio` of the `?diag=1` JSON (rewritten every 5 s) and into a hidden
  `<pre id="audio-log">`. Headless runs through `tools/shot.py` keep the context
  suspended (no autoplay), so only event cues are logged there; Chrome driven over a
  DevTools pipe with autoplay allowed runs the real graph. In the log, 'display' carries
  ' target' for the locked lizard, 'stamp' ' soft' (a burst's follower) or ' plain' (landed
  on a sting), 'skip' is James hushed, and 'toast' is logged only when it chimes.

## Settings

`src/ui/settings.js`: one block shown in the pause card's right-hand column (its Settings
button) and in the title's own Settings card (`?open=settings`, `?open=pause:settings`).

- **Sound:** All sound, Music, Island sounds, Effects (the jingles too) and James's voice
  sliders and Mute, straight to the `audio` API (a short preview on that bus when a slider
  is let go). Without the sound module the controls are disabled with a note.
- **Play:** Precise aiming, day length (8, 12 or 16 minutes; the clock's pace changes at
  once), text speed (slow 28, normal 55, fast 110 characters a second).
- **Comfort:** Camera shake (the croc's snap) and Reduced motion, "No particles, no
  wobbles" (the body's `reduce-motion` class stills the UI's bobs and wobbles, the title's
  lizard and the Today card's glow; the effects drop every particle, the small animals,
  the mist, the shimmer and the page sparkles, keeping only a new species' gold sparkle;
  the title camera drifts slower). It starts from the system's `prefers-reduced-motion`.
- **Reset save** asks first, then clears the save and goes back to a title with no
  Continue; the settings survive it.
- `setSetting(key, value)` (`state.js`) checks and saves under
  `stroudlab.fieldseason.settings.v1` and emits `settings:change`; `applySettings(game)`
  passes them to the kit, the body class and the croc.

## How the pieces fit: sound, light and effects

- **Settings drive the sound:** the sliders and Mute move the running graph's bus gains
  at once (the Effects slider the jingles too, the voice slider James; checked on a live
  audio context), and they are kept after a reload; a
  Reset save leaves them.
- **Seen and heard together:** stamps (thunk and sting, stars in the page), a new species
  (sting, gold sparkles), a croc's snap (placed hiss and SNAP, splash, camera shake if on),
  the player's feet (footsteps by surface; dust on the paths; a swish and leaves at a
  bush; a plash and drops at the water's edge).
- **Light and lizards agree:** the lizards' sunlight is tested against the drawn crowns,
  bushes and trunks (Sun and shade, above), the same things the shadow map draws, so a
  basking lizard sits in visible sun; the heat of the day is one story across the
  lizards' warmth (above 0 from about 09:50 to 16:10, too hot from about 10:55 to 15:15),
  James's toasts and the Today card's sun row (about 11:00 and 16:00), the sky's haze and
  shimmer (about 10:10 to 16:10), the cicadas and the music's sleepy midday.
- **The day's end** is the same wherever it is reached: `?phase=summary` sets the
  clock to 18:30 first (or `?clock=`), so its sky, fireflies and ambience match play.
- **Nothing extra in the top view:** the effects draw nothing there, the lizards and crocs
  are hidden, and the diag still reports 23 calls.
- **Checks:** the check images `check/m5_*.png` show the morning, noon, evening, dusk
  fireflies, basking, shade, juice, pause and title, and `check/m5_sounds.md` lists every
  cue and when it plays.

## The field kit: three missions

Three short, optional mini-games from the lab's own field work, which James offers as
requests on the survey day. Each is its own module in `src/missions/`, loaded by `main.js`
as an optional system after the effects (`game.missions_tls`, `game.missions_drone`,
`game.missions_rtk`, each skipped with `?nomissions_<id>=1`), then the registry
(`game.missions`, `src/missions/index.js`; `?nomissions=1` skips only the registry, and then
James offers nothing). None of them draws anything in the top view.

    src/missions/index.js      the registry: requests, scoring, records, James's offer list, busyOther()
    src/missions/drone.js      the drone survey (drone_model.js one-call kit mesh, osprey, rings,
                               flight plan; drone_hud.js the flight HUD, photo card and notebook
                               page; drone_photo.js the aerial photo)
    src/missions/tls.js        the laser scanner (tls_cast.js the analytic ray caster, tls_cloud.js
                               the one-Points cloud and the notebook's 3D view, tls_models.js the
                               scanner, carried head, fan and ibis, tls_level.js the bubble level,
                               tls_ui.js the scan card and the notebook page)
    src/missions/rtk.js        the RTK plant survey (rtk_plants.js names, families, leaf sketches
                               and hints; rtk.css its cards)
    src/audio/sfx.js           the drone's and the scanner's cues (appended); sfx_rtk.js the rover's
    preprocess/scanpos.py      data/scanpos.json, the scanner's spots (see data/README.md)

**data/scanpos.json** (`preprocess/scanpos.py`, documented in `data/README.md`): the lab's 88
October 2025 scan positions in the game frame, the 57 on or next to walkable ground kept and
snapped to a free tripod spot, and `mission`: the 8 spots the scanner uses, picked by
farthest-point sampling (off the causeway, clear of water, thicket and trunks, with cover round
about and trees to scan), in the order of a nearest-neighbour walk from the causeway top (about
205 m), each with a friendly `place` ("by the rainbow eucalyptus") for the scan log. The script
has no randomness. The survey's ids never reach the player; only `tls.js` reads the file.

**The mission interface.** `build(game)` returns `{ id, title, tool, available(), start(opts),
active, busy, update(dt, t), progress() -> { done, goal, label }, notebook() -> { title, blurb,
stamps, render(el) }, stats }`, and the module emits `mission:start { id }`, `mission:step { id,
step }`, `mission:done { id, stars (1 to 3), points?, why? }` and `mission:fail { id, why }`. The
steps: the drone's `pad`, `launch`, `ring` (with `n`), `home`, `handback` (flown home by the
battery, the controls back over the pad), `splash`, `land` and `photo`; the scanner's `walk`,
`level`, `scan`, `ghost`, `bird`, `scanned` and `packed`; the rover's `walk`, `fix`, `fixed` and
`logged`. The rover's `mission:done` carries `why` (`named`, `steady` or `done`: what earned the
second star), which picks James's line. The drone also has `hintPad(on)`, which shows its pad's
job marker before the mission starts (`flow.js` calls it while James offers the drone). `busy` is
true while the mission is in the middle of its job (the drone in the air or on its photo card, the
scanner set down, the rover's pole up or its log or end card open); `game.missions.busyOther(id)`
returns another busy mission, and the drone waits for one ("One job at a time: finish the laser
scan first!"). Everything else may run side by side: a plant survey and the scanner can both be
on, and the drone flies with either of them still waiting.

**James and the requests** (`flow.js`, lines in `SCRIPT.missions`). The morning talk mentions the
field kit. On the survey day, pressing E by James opens with "Fancy a job with the field kit?"
and a choice of the jobs still to do today ("Drone survey", "Laser scans", "Plant survey", each
with its icon; while the drone is on offer its pad's marker pulses by the station, since the
survey's first view has the pad just below the screen) plus "Just a chat" (the default a plain E takes, drawn
like the others with a green focus ring, `plainChoices` in `kit.dialogue`; a job is picked with its
number, the arrows or the pointer, and a key press is ignored for 0.6 s after the choices appear).
"Just a chat" lasts that one talk: the next time he asks again, "Still fancy a job with the field
kit?" (`offerAgain`), since E is a habit here and the offer is easy to wave off. A job picked hears its brief
and starts once the talk's camera lets go. With a job under way he asks how it is going (each
mission's own `active` line, `{n} of {goal}`); with every job done today he says so once
(`allDone`). Taking a mission's tool from the ring starts it too, with a toast from James
(`selfStart`). A mission taken on is one of today's requests (`state.today.requests`, `{ id:
'mission.<id>', mission, icon, label, goal, n, done }`), on the Today card with the mission's
icon (a click opens its notebook page), kept in step with `progress()` twice a second.

**Scoring** (the registry, on `mission:done`): the mission's `points` if it sends them, else
`RULES.points.mission` by stars (40, 80, 120), plus the request's 50. A finish gives one toast:
James's line by stars (`SCRIPT.missions.<id>.done`; one of them may be an object of lines by the
mission's `why`, as the plant survey's two stars are, `named` or `steady`) with "Request done +50"
folded in, shown once the mission's own card has closed (the plant survey's end card, the drone's
photo); the kit's task stamp stands for its task (no "Task done" toast for group `kit`) and lands
on the card's top-right corner. `state.today.kit[id]` keeps
the stars and `state.missions[id]` the record `{ runs, done, best, points, data }` (saved with
the notebook; `data` is each mission's own plain JSON, at most 600 KB, never a lizard's position
or a date). A mission never scores its own finish; small points along the way are its own (a
plant 10, plus 10 named right; a scan its stars times 10). `mission:fail` gives James's `fail`
line, one per reason where he has several (the drone's `water` and `battery`). The kit's stamps
(`tasks.js`, group `kit`, 100 each once): Aerial!, Scanned!, Botanist and Top kit (three stars on
any job). On the summary card James's own requests are counted apart ("James's requests: 2 of
3"), the kit jobs finished get a row of their own below it ("Field kit", then a chip for each job
with its icon and stars, its name on hover), and "every one of my requests" means his own few only. A first day of all three at best
scored 1,040 (400 of it the one-time stamps).

**The notebook's Field kit** (`notebook.js`, the briefcase tab): a spread per mission laid out as
two pages with the spine in a 3.4em gap: the mission's title, its best stars and its blurb on the
left page; tabs for the three jobs (short names, Drone, Scans and Plants, each with its stars and
its full name on hover) and the mission's stamps on the right page; below them the mission's own
`notebook().render(el)` body across both, each keeping to its own two pages (two columns 3.4em
apart: `.dr-page`, `.tls-nb`, `.rtk-nb`).

- **Drone survey** (`drone.js`). The lab flew a drone over the island at 150 ft in October 2025
  for an orthomosaic. The pad and windsock stand on the landing by the field station (the
  causeway is roofed by mangroves). From James the controller comes out and the drone waits
  for [E] at the pad; from the ring (or [E] at the pad) it lifts off at once, with James's
  "Oh, you've got the drone kit!" toast when it came from the ring. The lift-off camera
  starts high and back (pitch 0.72, 6.6 m) so the player's hat and James show, then eases to the
  chase view. Ten rings at 30 m (read as 150 ft, 5 ft a metre) mark five west to east lanes,
  counted in any order: the next ring glows gold, the two after it pale gold (fading when seen
  edge on), the rest hidden, with no fog on them; the dotted flight plan and the inset show the
  whole survey. Its own controls, on the input action layer and shown on one line along the
  bottom of the screen while it flies: WASD fly, Q and E turn (the `tool` and `use` actions, 110
  degrees a second, the camera following; `use` is then cleared so nothing else hears it; not
  while a card or a talk is open or during the lift-off), Space climb (`climb`, gamepad button
  12), Ctrl or C descend (`descend`, button 13), Shift faster, wheel to zoom, drag to look, X flies
  home (X while it is still lifting off brings it straight down and packs it away). While it is
  up the player stands held at the pad, the ring's keys, X and aim belong to the flight, the Today
  card, minimap and tool badge step aside for its own instruments, and the day's clock waits
  (`holdClock('drone')`: a 90 s flight would otherwise eat 1.4 game hours). At the edge of the
  flying area only the outward speed goes, so it slides along the edge, and the camera swings
  back towards the island. The battery drains 0.28 % a second hovering plus 0.16 per m/s (0.44 %
  a second at cruise), more climbing and 5 to 6 a knock; the bar has a gold notch at 35 % (the
  star), it warns at 20 % and flies itself home at 10 % (at 3 % once all ten rings are through).
  Flown home with 6 rings or more it stops 4 m over the pad and hands the controls back for the
  landing (`mission:step 'handback'`); it lands itself only when the battery is flat. Coming down
  near the pad (within 10 m, from the survey height down, with 6 rings or flying home) the camera
  tips to pitch 0.85 at 5 m and looks down past the drone, a dotted drop line runs from the
  skids to the ground (mint over the pad), a gold ring (an 11th instance of the ring mesh) circles
  the pad, the H tag stays up, the trees' cut-out reaches down to the pad and the key strip steps
  aside; the low hedge by the pad holds the skids up quietly. The rainbow eucalyptus, talipots
  and osprey pole are solid (a bump wobbles it); other crowns are a soft floor it rises over; the
  nesting osprey's mate chases it off ("Kyew! Kyew!", Shift to get away); the lake is a splash:
  it sits in the water for 0.7 s, skids under, in rings of splashes, then limps home
  (`mission:fail`, `why: 'water'`). Landing on the H with 6 rings or more finishes it; fewer is a
  pit stop (Space takes off, X packs it away). **Lane photos:** in the 150 ft band (within 2.6 m
  of it, the height tape's green band) the camera photographs each patch it passes over, one
  every 12 m along each lane, 35 in all, each with a soft tick (`droneSnap`, about -24 dBFS; the
  shutter is -11), its dots on the plan turning mint and a counter in the top panel; a patch never
  photographed is left as blank hatched paper on the print and the map layer, and the card's
  caption says so. Stars: all ten rings, 35 % battery left, a soft landing on the H (at least
  one). Then a flash and the aerial photo (`drone_photo.js`): the island rendered from straight
  above at that hour into a corner of the game's own canvas (no shader compiles), its pixels read
  into a buffer behind a GPU fence and fetched over 3 frames, graded and printed over the next
  frames (exposure from the picture's own brightness, lifted shadows and a warm grade, so a
  morning or evening print matches noon) and the JPEG encoded off the main thread; the card shows
  a developing print for a moment, then the print. The readback is warmed 4 s after load and the
  flight's shaders compile at load, so the first flight adds no programs. The print is stamped
  with the day and clock; it goes on the big map's "Aerial photo" layer (a switch in its key; the
  copy carries the paths and the big-tree and eucalyptus rings faintly, so the key still holds)
  and the notebook page: stat boxes (best rings, most photos, most battery, soft landings), the
  print, the flight log, why a drone, a three-stars checklist and a plan of the last flight's
  photo spots. The record keeps the photo as a JPEG of about 60 KB (written, and saved, once it is
  ready, a few frames after `mission:done`), `bestPhotos`, `bestBattery`, `softs` and `lastSpots`
  (35 characters of 0 and 1), and it comes back after a reload. Replays are allowed and score
  only an improvement in stars. `DRONE` in `drone.js` holds every number.
- **Laser scans** (`tls.js`). The lab scanned the island from 88 positions in October 2025 with a
  RIEGL scanner on a tripod, and cleaned the people and birds that walked through out of the
  clouds afterwards. James asks for three scans. Carry the scanner (a cream head in the hand, the
  yellow tripod on the pack) to a coral marker, one of 8 real scan positions from
  `data/scanpos.json`, and press E to set it down; level it (a bubble level card docked on the
  right, 2vw in, while the camera turns so the scanner stands beside the player left of the card,
  turning back as the countdown starts unless the player has orbited it; it cannot fail, Esc
  gives up and packs it); a 3 s countdown with a radar of where the fan starts and the cover round
  about; then the head turns once (17, 15, 13.5 s for the day's first, second and later scans)
  with a pink laser fan (bright beams a few pixels wide along its leading sheet, so it reads edge
  on), and the points pop in behind it (57,312 rays a scan, cast from the head by `tls_cast.js`
  against the height grid and `veg.hosts`, no Raycaster; beige ground, green by height). Keep out
  of its sight: behind a trunk or a bush, or round behind the head. The radar shows only cover
  that hides someone creeping low (1.16 m): each bush and trunk is tested at the first free place
  behind it that the player can walk to from the scanner (a flood fill) and 0.12 m either side,
  with the card's own test (seven rays across the ghost's sheet, foliage counting once a ray is
  0.35 m into it), worked out a spot at a time over frames while the mission is on (about 1 ms a
  frame). The card's title is "Scan n of 3"; its states: "In the open: find cover", "Hidden",
  "Hidden! Stay put...", "Scanning you..." while the fan is on you, "Behind the head: keep pace
  with it!" more than 140 degrees round from the fan, "Seen!" and "Safe" once the fan is past your
  whole body; no hint along the bottom during the countdown and the scan (E waits). Seen, the
  player lands in the cloud as a lilac sheet ghost with eyes (a sad trombone; under 15 % of the
  body seen is forgiven, and twice that when the fan reached you while you were hidden, so
  "Hidden!" is a promise), and the scan loses a star. An ibis flaps through about half the scans,
  no penalty. The scan lands with a chime and a wave of light, the camera rises over it in a
  dimmed view the navy of the notebook's page for 4.4 s (E skips), the cloud stays bright for 7 s
  and fades away (the world draws only the live scan, up to its point count; the notebook keeps
  every scan), and the scanner packs itself up. Each scan scores its stars times 10; the
  mission's stars are three only when none of the three scans had a ghost, else the rounded mean,
  at most two. The cloud is one `THREE.Points` (8 slots of 44,000 points), each scan saved as its
  spot, seed, the ghost's place, the forgiven hat hits (`hat`) and the ibis's flight (`bp`),
  everything rounded before the scan uses it and each scan with a random stream of its own, so a
  reload re-casts them exactly in the background (about 1.3 ms a frame). The notebook page is two
  pages: an orbitable 3D view of every scan and its key on the left, three stat boxes, the scan
  log (newest first) and a fact on the right; the view is a small renderer of its own, made once a
  session (about 150 to 190 ms at the first open, 6 to 14 ms after), its canvas moved into the
  page on each open, and it stops drawing when the page closes. The shaders are compiled, and the
  scanner, fan, ibis and dim quad drawn once, tiny and see-through, under the loading card. The
  day's clock waits while the scanner is set down (`holdClock('tls')`: the level card, the
  countdown, the scan, the reveal and packing up); the walks between the spots take time.
- **Plant survey** (`rtk.js`). The lab recorded 317 island plants in June 2026 with an RTK rover
  on a 2 m pole. James rings five named plants in gold (a soft gold ring on the ground round each
  foot with motes circling it and a few drifting up to head height, one mesh and one Points call
  for all; a job marker where to stand; a pulsing dot on the maps), picked from the 73 named
  survey plants with a spot to stand (worked out while the game loads): one patch of the island
  (within 30 m of the first, or 45 m where names are few, at least 5 m apart, a walk round them
  of about 120 m or less from where the job starts, the first leg counted half), of mixed growth
  forms, ones not yet recorded first. E stands the pole; the camera eases round (over about half
  a second, laid over the follow rig's camera after the rig has placed it, so the hand back is
  smooth) to show you and the plant side by side from your right, low enough to see up a palm to
  its crown or a tree to its lowest boughs, left of the cards, the vegetation's cut-out moved with
  it; an ibis walks up where that picture shows it. The phone card docks on the right and goes
  SINGLE, FLOAT, FIX (1.5 s, then 3.2 s held still) with the accuracy falling to 2 cm; a step puts
  it back to SINGLE (a wobble). A mosquito buzzes round the phone: when it lands the whine stops
  and a gold ring closes, and E, a click or Space in 0.95 s swats it (a bite flinches the fix
  back to SINGLE). Then the log card, docked on the right too: a leaf sketch, the growth form, the
  family in Latin and plain words and a hint (how it looks or what it is used for, never its
  name), and three names in rows, each with its leaf and family: the right one, a near miss
  sharing its family or its leaf, and one sharing neither, so only the right one matches both
  (`rtk_plants.js` adds four decoy-only names so sea grape, bamboo and the trumpet trees have a
  near miss too). A pick is answered "Spot on!", "Close! Same family, but..." or "Not quite!",
  with the plant's little fact (a wink the hint leaves out), and it is recorded either
  way. Stars: one, plus one for 4 of 5 named right, plus one for 2 wobbles and bites or fewer
  (`RULES.missions.rtk`); the end card names the wobbles and bites apart. The notebook page lists
  every plant recorded with its family and form, the share named right and a small map. Once a
  day. The fix, log and end cards hold the day's clock (`holdClock('rtk')`); the walks between
  plants take time.

**Flags and helpers.** `?mission=drone|tls|rtk` implies `?phase=survey` and starts that mission
near its start (the registry starts one still idle 3 s into the day); `&missionstep=` sets up a
moment for a check image: the drone's `pad|takeoff|hello|rings|lanes|high|osprey|land|splash|photo|map|notebook`,
the scanner's `walk|level|countdown|scan|ghost|reveal|done|notebook|auto` (with `&missionspot=1..8`;
the scan and the others default to spot 1, where the fan sweeps side on to the camera, the reveal to spot 5),
the rover's `walk|fix|log|logwrong|done|notebook` (with `&missiontarget=k`, `&missionback=m`);
`?dronelog=1` writes the flight's state into `<pre id="drone-log">`. `mission` and `missionstep`
are debug flags that leave the save alone. `window.__game.play.mission(id)` takes one on without
James's talk, `play.missions()` lists them; `play.drone` (`start`, `launch`, `auto(on)`, `home`,
`place`, `gotoPad`, `state`, `photos()` -> `{ taken, total, gaps, spots }`), `play.tls` (`spots`, `goTo`, `setUp`, `quick`, `autoHide`, `state`)
and `play.rtk` (`auto`, `state`, `targets`, `goto`, `plant`, `frame()` where the fix's camera puts you and
the plant, `pickTest()` the naming quiz's rows) drive them; `play.talk()` is a plain
chat, `play.talk({ kit: true })` lets James offer the kit.

**Checks.** A scripted kit day plays all three like a player: James's offer, each brief read
through, the drone walked to the pad and flown through all ten rings, three scans (one with a
ghost), five plants (one named wrong), the stamps, James's "all done", the three notebook pages,
a catch afterwards, the summary, then a reload and Continue with the records, photo and clouds
back. A second run tries the awkward moments: "Just a chat" and the offer again at the next talk,
the drone refused mid-scan, the drone flown and packed away with a plant survey and the scanner
on, X during the lift-off, James's progress line, the day ending with two missions on. Each
mission also has runs of its own: the drone's whole survey, a flight home on the battery and a
splash; the rover's whole survey, its clock and the one toast at the finish; the scanner's three
scans with the player hidden by script (`play.tls.autoHide`).

## Perch loggers and the island board

Button loggers clipped on a released lizard's perch, whose downloads tell that lizard's day in
temperature, and a shared scoreboard for when the game is hosted on the lab's campus VM.

**Perch loggers** (`src/tools/perch_loggers.js`, loaded from `ring.js`'s `TOOL_MODULES` as
`game.tools.perch`; `src/ui/perch_day.js` draws everything). What field biologists do to
measure the temperature a lizard actually lives in.
- *The clip.* On the survey day, after a catch's Field notes card, the release offers one
  "Perch logger" card (`perchLoggerCard` in `release.js`; the system makes the offer through
  `setPerchLogger(fn)`): the lizard on its perch in sun or shade (the drawing's tape shows the
  height), "Clip a button logger on *Pip*'s perch, right where it sat. It logs the temperature
  *Pip* lives in.", "A sunny perch" (or shady, or dappled: the lizard's own perch through
  `sunExposure`, over `THERMAL.sunny` or under `THERMAL.shady`) and how many are left
  (`RULES.inventory.perch`, 3 a day, refilled by `newDay`). While the Sun & shade task is open a
  dappled perch says "Dappled light, so not one for the Sun & shade stamp." E, a click or Enter
  clips it: the coin flies from its tray onto the perch with a
  click, a ring and "Clipped!" (+10, `RULES.points.perchClip`); Esc means not this time (the
  note still counts). No offer for the practice catch, a recapture, a lizard already carrying
  one, or a scripted catch (`c.auto`) unless `play.perch.auto` asks. The first time on a save
  (`state.perchIntro`, saved), James says what they are just before the card
  (`SCRIPT.perch.intro`: three boxes, face to face within 9 m or on the radio, ending
  "Three a day."). A lizard without a backpack gets a nickname from the far end of `NICKNAMES`.
- *On the bark.* A coloured coin (coral, violet or teal, `PERCH.colours`) on a steel rim with a
  paper tag, one `InstancedMesh` for all of them (one main-pass call while any is out, none
  otherwise; no shadow), on the lizard's own surface and clear of its body (`placeFor`): on its
  side of a trunk (so it reads the same sun), beside it on the ground or a leaf, along a branch
  or a log past its snout or tail. It sways with its perch (the vegetation's wind, worked out
  inline) and pulses softly once a download is due. Each has a dot on both maps
  (`maps.addMarker`), pulsing when ready; the big map's key lists "Perch loggers".
- *Recording*, on the day's clock: the perch's temperature every 10 game minutes
  (`PERCH.sampleT`): `baseCelsius` plus the lizards' own `sunExposure` at the button, the canopy
  and lake cooling of `RULES.climate`, a little warmth near sunny ground, a breeze high up, and a
  0.3 h lag for the bark. The lizard's own day every 5 minutes, one letter a spell (`CODES` in
  `perch_day.js`: basking, in the sun, too hot, in the shade, moved round to the shade, tucked
  away, hid from you): read from its behaviour while its slot is active near the player (the run
  home after a release is skipped), else worked out by the same basking, heat and shade rules its
  brain applies on waking (`derivedCode`; it agrees with the live lizard about nine times in
  ten; the main difference is that a live lizard that went round to the shady side
  stays there). With a GPS backpack, its fixes as offsets from the perch (never positions) and
  the metres between them.
- *Downloads.* Walking or creeping within 3 m (`DOWNLOAD_R`) of a logger at least 1 game hour
  after its clip (`PERCH.first`), then every 1.5 h (`PERCH.again`), downloads it by itself: never
  while aiming, mid-catch, in a card or talk, or mid-mission. A sparkle, the download sound,
  `perch:download`, +15 the first time and +5 later, and the day card (`'perchday'`): the chart
  from the clip to now (warmest and coolest marked, a tick at each download) with the lizard's
  day as a band under it, one sentence, chips (warmest, coolest, time in sun and shade, how far
  it wandered), the tiny map (its trail on a crop of the island map round the perch; a
  squared-paper sketch "by C07" for a story from an earlier session) and "Lovely! E" or "Its
  notebook page". A toast says when each logger is ready; the maps label each "Pip's logger".
  James's toasts follow the first download ever (`SCRIPT.perch.firstDownload`) and the day's
  first whole-day follow (`wholeDay`); a later whole day that day gets a short line by name
  (`wholeDayAgain`: "Tamarind too! Another whole lizard day in the notebook."). A perch download
  is not a `logger:read`, so the flags' logger tasks and requests are unchanged, but it counts in
  `state.today.loggersRead` (the end card's "Loggers downloaded").
- *A visit keeps its lizard put.* While the player is within 9 m of a ready logger
  (`PERCH.visitR`), and for 25 s after its download while they stay near (`visitT`), the followed
  lizard gets the brain's `calm` cap (`PERCH.calm` 0.9, as the opening's practice lizard): it
  watches, and only a run bolts it. A fright during the visit is not put down as "hid from you";
  the lizard settles as after a release. `visiting()` says whether a visit is on, and the
  "Too quick!" lesson (`catching.js`) keeps quiet meanwhile. The system only clears a calm it set.
- *The sentence* (`daySentence`, worked out afresh from the spells each time a card shows:
  `lineOf`, so older stories read the same way) keeps the lizard the subject of every clause:
  "Mango basked here till 08:45, then let the shade creep over its perch, tucked itself away out
  of the heat, and was back in the shade by 15:25." A list joins with commas and one "then"; a
  short first spell is a lead-in ("After a quick bask, Pip kept to the shade for the rest of the
  day, ..."); a first run that starts by walking into the sun says so ("Pip walked round into the
  sun and basked there till 09:30"), and its return is "went back round to its shady side". Flat
  days have several wordings with the perch's own temperatures ("Pip stayed cool in the shade all
  day, though its perch warmed from 23 to 28 °C."), and a day that dodged the sun says it slipped
  round to the shady side whenever the sun came round. Tried on all 968 spawns, no clause loses
  its subject and no sunny-clipped perch says shade from the clip. Places read "on sunny ground", "on a
  sunny tree trunk, 2.5 m up", "just off the ground" (`heightWords`, `perchPlace`: "on the ground"
  in the card's head, the Today list and the Perch fact), with a non-breaking space between a
  number and its unit.
- *The day's end* picks up the loggers still out, fills their stories (`end: true`) and saves
  again (the day's own save comes just before). A day left unfinished (back to the title, a
  reload) drops the loggers never downloaded, as the survey day restarts, and marks the stories
  already downloaded that day `cut: true` (in `dropUnfinished`, and on load through
  `cleanFollowed(list, state.days)` for any story of a day that never ended). They stay in the
  notebook, but the replayed day's end card lists only its own (`todaysStories()` in
  `perch_day.js`, which `summary.js` uses).
- *The notebook*: a "Followed lizards" bookmark and a link on the cover (its links sit in one
  row of five); an index spread (what they are, "2 of 3 button loggers left today", today's
  loggers and their status, the life stories as buttons, the three tasks with their stamps) and one life-story spread per lizard,
  newest first: nickname, species and sex, a drawing of it on its perch with its paint dot,
  backpack and logger; SVL, mark, perch type and rounded height, nearest flag, backpack, logger
  colour and clip time, a line of notes; the chart, band, sentence and tiny map. The pages are
  rebuilt each time the notebook opens (`'follow'`, then `'follow:<k>'`).
- *Tasks* (field group, thermometer stamps, +100 once each): `perch.sunshade` "Clip loggers on a
  sunny perch and a shady one" (Sun & shade), `perch.wholeday` "Follow one lizard all day: clip before
  10:00, download after 16:00" (All day!), `perch.species` "Clip loggers on the perches of
  three different species" (Perch trio).
- *The end-of-day card* has a "Followed lizards" row (`summary.js`): each of the day's stories
  as a chip with its logger's coin and the nickname, a gold star for a whole day.
- *State and save:* `state.followed` holds the life stories (`{ k, nick, sp, sex, svl, mark,
  perch, seen, h, taped, flag, pack, gps, day, col, cname, clip, kind, dl[], upto, end,
  temps[[h, °C, sun]], states[[h, code]], trail[[dx, dz]], dist, flights, line, whole, cut }`, about
  460 B each, 30 kept), saved only once downloaded or collected at the day's end, cleaned field
  by field on load (`cleanFollowed`); `state.perchIntro`; `state.today.perchClipped` and
  `perchDownloads`. The loggers out on their perches live in memory only.
- *Events:* `perch:clip` { entry, kind: 'sunny' | 'shady' | 'dappled', species, lizard },
  `perch:download` { entry, first, whole, hours }.
- *Scripted play:* `window.__game.play.perch`: `auto` (null; 'clip' lets a scripted catch clip
  one and the day card close by itself; 'show' offers the card and holds it), `list()`,
  `entries()`, `goto(i, m)`, `download(i)`, `place(lz)`, `codes()`, `demo()`, `live`. A
  scripted run that presses E through every card would clip loggers and meet day cards on its
  walks: give it `noperch=1` in the game query.

**The island board** (`src/ui/scoreboard.js` and `scoreboard.css`, `tools/scoreboard_server.py`).
- *How it is hosted.* nginx serves the game's static files and proxies only `field-season/api/`
  to the board server on 127.0.0.1. The game pings `api/ping` relative to the page once at load
  (`CONFIG.scoreboard`: `api`, `timeoutMs` 4000, `version`); with no API (plain static hosting,
  a `file://` page, `?noboard=1`) every board UI stays hidden and nothing errors. `tools/serve.py`
  answers any path ending in `/api/ping` with `{"ok":false,"board":false}`, so local play logs
  no 404 either, and `index.html` has an empty icon link, so the console stays clean.
- *The title*: an "Island board" paper card on the right with four tabs (Best day, Most species,
  Rarest catch and Steady hands: see "Steady hands and the day notebooks"), each with a one-line
  caption ("Each player's best day · dots: species caught"), medals for the top three, the
  species as coloured dots, and a steady footer ("14 field biologists on the board"; on a board
  that leaves names out, "12 of the 14 with a catch"). A shared number shows a shared rank ("=1",
  "Joint 1st" on hover). Only the name this player last posted under on this browser is picked
  out (`fieldseason.boardName` in localStorage, per player, and in memory). The tabs never take
  the focus, so E and the arrows still drive the title; left and right switch tabs only while the
  card is drawn. Under 1180 px wide an "Island board" pill beside Settings opens the same view as
  a panel (left and right work there too); the pill joins `.ui-title-pills` only once the API
  answers.
- *The end-of-day card* (see "Steady hands and the day notebooks" for its Share my day button):
  the button has a [B] key chip (opt-in, once a day; B presses it from anywhere on the card), and
  the name it goes up under is a small pencil button that opens a name box (Esc closes it). A
  player still on the story's fallback name "Sam" is asked for a name instead of posting into a
  shared "Sam" row. Once posted the Catches column turns into Catches | Island board tabs with
  the standing and the top ten. The standing is the name's best day: "7th of 15 on the island
  board! And joint 2nd for most species!" when today is that best; when an earlier day was
  better, "Your best day is still 7th of 15. Today's 600 would be 15th.", the name's best row
  picked out by rank and score, today's own row with a gold "today" tag in its place among the
  others (under a gap only when names come between it and the list), and "Posted as Robin. The
  board shows each name's best day." A name the board refuses brings up the name box; a rate
  limit or an outage shows the server's own words. A practice run (`GAME_FLAGS.nosave` or any of
  `phase`, `skipsetup`, `huntstep`, `catch`, `catchstep`, `open`, `clock`, `fast`, `tool`,
  `name`, `mission`, `missionstep`, `loggers`, `lizards`, `perchdemo`, `crocfast`) shows
  "Practice runs stay off the island board." instead; `?boardtest=1` lets a scripted check post
  to a scratch board anyway. The result is kept on `state.summary.board`; `dayNumbers()` builds
  the post from `state.summary` and `state.today.kit`. "Back to the title" stays the foot's first
  button in the markup.
- *The server* (standard library only: `ThreadingHTTPServer`, `sqlite3`, `json`; SQLite 3.25 or
  later; `--host 127.0.0.1 --port 8779 --db PATH --base /api/ [--static DIR]`):
  - `GET ping` -> `{ ok, app, v, board }` (`board: false` while the database is missing, locked,
    damaged or read-only). `GET scores?board=best|species|rarest|backpacks&limit=1..50` (digits
    only) -> `{ rows, total, names }`, each row with `rank` and `tie` (a shared number shares the
    rank). `POST scores` { name, score, species: { cristatellus, sagrei, carolinensis, distichus,
    equestris, basilisk }, backpacks, rarest, stars, version } -> 201 { ok, rank, tie, total (the name's
    standing, from its best day), best (is this day that best), day { rank, tie } (where this day
    alone would stand), ranks, ties, bests (per board), board (the top ten), you (the name's best
    row), today (this day's row) }.
  - Validation: JSON only, 64 KB at most with a length; a name of 1 to 14 safe characters with a
    letter, through a small word filter that folds accents and look-alike letters (ı as i, ł as
    l, ħ as h) and reads digits as letters only inside a word ("sh1t" and "N4Z1" refused, "Room
    455" kept); "shit" counts only as a word of its own and "cunt" only at a word's start, so
    Harshit, Nishita, Shital, Kshitij, Scunthorpe and Shiitake pass. Plain integers inside one
    day's caps (`DAY`: 60 catches at most, 10 knight, 12 bark, 25 green, 40 brown, 60 crested,
    11 basilisks; 5 backpacks, basilisks' included; 9 stars) and a score cap from the game's
    points (`score_cap(counts, backpacks)`: about 6,700 plus what those catches and backpacks
    can earn, a basilisk at 100 like the knight and bark; the constants at the top of the
    server must follow `RULES.points`); `rarest` must match the counts. The basilisk is the
    rarest (11 records against the knight's 27), so it heads Rarest catch: it ranks 0, below
    the knight's 1, so the ranks stored with older days stay right. A post may leave
    `basilisk` out (copies of the game from before it send five anoles): none, and those days
    validate, show and sort as before. The game itself sends `basilisk` only when it caught
    one, so a day without one still goes up to a board from before the basilisks. Most
    species goes up to 6, and the day notebook's catches, followed lizards, trails and stamps
    (`basilisk.catch`, `basilisk.water`) take the basilisk too.
  - Parameterised SQL; ranking done in SQL (window functions) with one index per board, each
    board cached and cut to the length asked for (at 20,000 rows a post takes about 55 to 78 ms
    and an uncached board read about 30 ms).
  - Rate limits in memory under a keyed hash of the address (one day per 20 s and 60 a day per
    client, reads and tries a minute, a cap for everyone together), checked and recorded in one
    locked step (`Limits.reserve` and `release`, the place given back if the database is down), so
    ten posts at once from one address give exactly one 201. X-Real-IP is trusted only from
    loopback. No addresses, times or ids stored or logged; one short stderr line per post or
    refusal, and errors as one line with no address.
  - A request still open after 20 s in total is cut off; an odd Origin gets a 403; a NUL in a
    static path a 404. A missing, locked, damaged or read-only database gives a 503 with
    Retry-After and recovers by itself ("database back" is logged once it really is); a -wal or
    -shm file left read-only is made writable again when safe.
  - Upkeep: `--show`, `--backup FILE` or `--backup DIR/ --keep N` (dated copies, the newest N
    kept), `--reset`, `--remove-name NAME`, `--check-name NAME`. The server has
    scripted tests of its own (validation, the word filter, limits, ranking, upkeep, the
    notebooks and the migration).
- *Packing* for the VM: `python3 tools/package.py` builds `dist/field-season/` (index.html, src/
  and data/ only: no work/, check/, preprocess/, tools/, models.html, galleries, .py or .md; the
  packed `data/*.json` leave out the survey frame, `scanpos.json` the scan positions' survey
  names and every file its notes and counts for people (`PROSE_KEYS`), none of which the game
  reads; the folder's own `data/` is untouched), `dist/server/` (the server, the systemd unit, a
  daily backup service and timer, the nginx location and `install.sh` for whoever has sudo, which
  does DEPLOY's steps 1 and 2 and checks and reloads nginx but never edits its files) and
  `dist/DEPLOY.md` (who needs sudo, copying the folder under the site root, the location nested
  inside the existing `/stroud/lizard-island/` block so it keeps its campus allow list, the
  hardened unit running as an unprivileged user with the database in /var/lib, checking, backing
  up, tidying and resetting, and a no-sudo alternative for the server). It checks that every
  import and page reference is in the pack and prints the sizes. It copies nothing off this
  machine.
- *Local testing:* `python3 tools/scoreboard_server.py --port 8779 --db /tmp/field-season-board/scores.db
  --static .` serves the game and the API at http://127.0.0.1:8779/ (the folder is made if
  needed); `--static dist/field-season` serves the pack instead.

**Checks.** A scripted play-through plays the whole game like a player over the DevTools pipe
and logs PASS or FAIL per check: the title (the board's card only when the API answers), the
opening on foot, six catches whose first three clip loggers after James's word, each logger
downloaded by walking past it (the first day card read, its life story opened from it), a flag's
logger, a GPS download, James, the notebook's "Followed lizards", the map's key, a whole-day
follow (clip before 10:00, download after 16:00, the clock sped up by the station), the croc's
snap, the day's end (every logger picked up and saved, no positions in the save), the end-of-day
card (with the board: the day posted, the rank and the top ten; without it, nothing of the
board), the title's board tabs and Continue. Against the board it wants a fresh database seeded
with made-up days, so the post's rank is known; the debug flags make a practice run, so a
scripted post adds `&boardtest=1`. A day card from another logger that comes due while the
camera is held for a picture is closed as a player would close it.

The check images `check/m8_*.png` (1600x1000) come from the same runs, and the button on the
bark, the day card and the life story from a staged day: a male crested anole, big enough for a
backpack so the card shows its trail, walked up to from 10 m to download as a player would (a
teleport to 5 m can startle a lizard before the visit's calm is set).

## Steady hands and the day notebooks (the island board, part two)

A hard-mode board for days played with Precise aiming, and each posted day's notebook for
others to read. Sharing stays low-key.

- *Steady hands.* A survey day counts when Precise aiming (`preciseAiming()` in `state.js`:
  the setting or `?precise=1`) was on as the day began (`newDay` sets `state.today.steady`,
  and `startSurvey` sets it again as the clock first runs, so a switch during James's morning
  talk counts) and stayed on: `setSetting('preciseAim', ...)` during the survey day marks
  `state.today.steadyOff`, clears `steady` for the rest of the day and emits `steady:off`;
  switching it on again does not bring it back. `blankToday()` starts it false, so a day
  whose start was not seen never counts. `flow.js` freezes it into
  `state.summary.steady` at the day's end and `dayNumbers()` posts `mode: 'precise'` or
  `'assist'`. With the board's API only (all hidden without it): a "Steady hands" badge
  beside the score on the HUD while the day still counts (`hud.js`), a line under the
  Precise aiming switch in the pause card and the title's Settings ("Days played start to
  finish with Precise aiming go on the Steady hands board.", `settings.js`), and when it is
  switched off mid-day the toast adds "Today is off the Steady hands board now." The end
  card has a "Steady hands day!" ribbon on the score; once shared, a teal line under the
  rank ("Steady hands: top of 5!") and Best day | Steady hands tabs over its list. The
  title's board tabs are Best day, Most species, Rarest catch and Steady hands ("Days played
  with Precise aiming", footer "5 of the 16 with a Steady hands day"); the server still
  answers `board=backpacks` for older copies of the game.
- *Sharing* is one "Share my day" button ([B]) and "As *Robin* (pencil). Your notebook goes
  up with it." Nothing else to read or agree to.
- *The day's notes* (`src/game/daylog.js`, attached in `ui.js`): on the survey day only,
  each catch (`lizard:caught`, filled in by `lizard:measured`, `lizard:tagged`, `perch:clip`
  and `lizard:released`: species, sex, SVL, perch seen and height, flag, time, nickname,
  backpack colour, display, where it sat), stamps (`task:done`), points by kind
  (`score:add` into catch, pack, logger, task, kit, spot, croc, other), laser scans and
  ghosts (`mission:step` 'scanned', which carries `ghosts`) and plants recorded ('logged').
  In `state.today.diary`, never saved.
- *The snapshot* (`daySnapshot()`, built when the player shares): `{ v: 1, day, looks, parts,
  work, catches[<=60], followed[<=3] (runs <=40, temps <=40 with the warmest and coolest
  kept), trails[<=5] (<=60 points, the backpacks' fixes), stamps[<=30], kit: { drone:
  { stars, photo }, tls: { stars, scans, ghosts }, rtk: { stars, plants, right } } }`. Only
  the game's lists (species, perches, nicknames, task ids, spell letters) and bounded
  numbers; positions to 0.5 m inside `CONFIG.topView`; never more catches of a species or
  backpacks than the day counted. The parts add up to the day's score (the croc's snaps as
  what they really took, points the notes missed as "other"), and the survey day's stamps
  are never worth more than `parts.task` (100 each; the set-up day's score nothing). The
  trails are the lizards backpacked on this very attempt at the day: a tracked entry
  carries the `dayKey()` it was tagged on (`dk`, in memory only) and `state.today.key` is
  the day's, so a day restarted after a reload or a return to the title leaves out the
  tags of the attempt it replaced; a trail needs two fixes. The drone's print from that day (its stamp says the day)
  goes as a JPEG of 400 px at quality 0.55 (smaller if needed, 36 KB at most; about 13 KB
  in practice). A scripted day with the photo, 7 catches, 3 followed lizards and 5 trails
  comes to about 20 KB. If the day would not fit in 63 KB the photo, then the notebook,
  is left off; a board that refuses the notebook (or an older board, or nginx's old 4 KB
  cap) gets the day again without it.
- *The viewer* (`src/ui/daybook.js`): a click on any board row with a notebook (a small
  book at the row's end, its place kept empty on other rows so the numbers line up; those
  say "No notebook for this day" on hover) opens it over the
  title, its narrow-screen panel or the end card, in the notebook's own look with a teal
  cover for a Steady hands day and a brown one otherwise, a "Read only" tab, four spreads
  (the cover with the player's badge and the rarest catch pinned in, and the summary: the
  score, a bar of where it came from, species with counts and biggest SVL, the stamps; the
  catches; the followed lizards with `perch_day.js`'s chart, key and sentence rebuilt from
  the spells; the map, drawn with `maps.drawIsland({ bare: true })` plus the dots, rings
  for backpacks, the trails to scale over them and a 10 m bar, then each backpack's trail
  up close on squared paper (1 m squares, where it was caught, its fixes and a 1 m bar,
  captioned with its nickname: an anole wanders a metre or two, too small to see on the
  island map), and the field kit with the aerial photo). The cover's pinned photo is "The
  rarest catch", or "The day's catch" when there was one species. It checks
  the snapshot again (`clean()`), escapes everything, and keeps the keys while it is up
  (arrows, A, D, Esc, N; a capture listener, so nothing under it moves); `ui.js` skips its
  pause handling meanwhile. `daybookOpen()`.
- *The server* (`tools/scoreboard_server.py`): `mode` ("assist" or "precise", missing is
  assist, anything else a 400 `mode`) in a new `mode` column; `notebook` checked by
  `check_notebook` (unknown keys and wrong types refused with the path in the message,
  numbers clamped and rounded to their step, lists over their cap refused, nothing more
  than the day's own counts, backpacks and stars) and the photo by `clean_jpeg` (a JPEG data
  URL only, SOI to EOI walked marker by marker, one frame of at most 480 by 480, 40 KB at
  most, comment and application segments taken out bar a plain JFIF header). Patterns are
  matched whole (`fullmatch`, so no final newline slips through a `$`); the parts may not
  add up to more than the day's score (the croc's part no more than what was earned), and
  the survey day's stamps may not be worth more than `parts.task`. Stored in a
  `notebooks` table under a random 16-character key; rows carry `nb` (the key or null), and
  `GET day/<key>` answers `{ name, score, steady, species, caught, kinds, notebook }` (404
  otherwise, 400 with a query). A precise post's answer has `steady: { rank, tie, total,
  best, day, board, you, today }`. POST bodies 64 KB at most. A notebook goes with its day:
  a trigger (`scores_take_notebook`, AFTER DELETE ON scores) deletes it whichever script
  deletes the day, `add` clears any notebook under a reused id before storing, and each
  process tidies away notebooks without a day once, on its first connection. Past
  `--max-notebooks` (4,000) the oldest go, except the top 50 of each shown board and the
  day just posted, so there are never more than about 4,200 (`Board.keep_top`). Upkeep
  adds `--drop-photo NAME` (the aerial photo out of that name's notebooks) and
  `--remove-notebook KEY` (`--show` prints the keys).
- *Migration.* A database without the `mode` column, the `notebooks` table or the
  `basilisk` column is brought up to date on the first connection that can write (so on
  start, and by any upkeep command but `--check-name`): under the database's write lock
  (`BEGIN IMMEDIATE`, so a second process opening it at the same moment waits and then finds
  it done), a dated copy `<db>-before-steady-YYYYMMDD-HHMMSS.db` (or `-before-basilisk-` when
  only the basilisk column is missing) beside it (mode 600, read through a second
  connection; reused if the update could not finish), then `ALTER TABLE ... ADD COLUMN mode
  ... DEFAULT 'assist'`, the table and its trigger, and `ADD COLUMN basilisk ... DEFAULT 0`,
  in that one transaction. Nothing happens
  while the file is read-only; one thread tries at a time, and for 5 s after a try that
  could not finish (the database locked by another process) requests are told the board is
  resting at once instead of queueing. The old server script still reads and writes an
  updated database. `dist/DEPLOY.md` has the steps for the live board (the server first,
  nginx's `client_max_body_size` from 4k to 64k, then the game).
- *The live board and the basilisks.* The board on the VM still runs the server from before
  the basilisks. It takes days without a basilisk catch from this game as before (that server
  knows no basilisk stamps, so a notebook holding "Water runner" is sent again without it,
  `postDay`, and keeps the rest), but refuses any day with a basilisk caught ("Unknown
  species: basilisk", which the end card shows) until this server is deployed there. Deploy
  the server first (on start it adds the `basilisk` column to the live database, after its
  dated `-before-basilisk-` copy, and keeps every entry), then the game.
- *Checks:* scripted tests of the server (mode values, every notebook field's types, unknown
  keys, caps, clamping, parts and stamps against the score, final newlines, script-like strings
  in every string field, the photo's form and size, `day/<key>`, the notebook cap, the migration
  of an old database, a read-only and a locked one, three commands at once, pings while it is
  write-locked, the old script's `--remove-name` and `--reset` with the trigger, notebooks left
  behind, upkeep, and that the server's lists follow `tasks.js`, `tuning.js`, `daylog.js` and
  `config.js`), and scripted days in the browser: a drone survey, catches round the flags,
  loggers, scans, the end card, sharing and the notebooks from the end card and the title (with
  Precise aiming and without); Precise aiming switched off mid-day in the pause card; the viewer
  from the title's card and the narrow panel; nothing of the board without the API; an older
  server; and, in one browser profile, Precise aiming switched on during the morning talk,
  Continue, a switch off and on mid-day, and a reload mid-day with the day played again, shared
  and its notebook's trails and parts read back through `api/day/<key>`. The check images:
  `check/steady_title.png`, `steady_endcard.png`, `steady_pause.png`,
  `board_notebook_cover.png`, `_catches.png`, `_map.png`.

## Hooks between systems

- `player.position`, `heading`, `speed`, `noise`, `mode` (idle, creep, walk, jog),
  `crouch`, `headPosition(v)`, `teleport(x, z, heading)`, `hold(key, on)` (holds the
  player still for a reason: 'ring', 'story', 'catch'; `held` is true while any hold is
  on, and steering, the ring and [E] check it), `frozen` (the menus' own hold, a plain
  boolean that `kit.js` saves and restores) and `pushed` (true during a croc's knockback;
  input waits).
- Events on `events` (`src/core/events.js`): `player:mode` (mode, previous) and
  `player:teleport`.
- Input actions (read them with `input.down(name)` and `input.pressed(name)`): right mouse
  button or F `aim`, E, Enter or a click `use`, N or Tab `notebook`, Escape or P `pause`,
  Q `tool`, 1 to 6 `tool1`..`tool6`, X `stow`, M `map`, and Tab `next` (a key may stand for
  more than one action: while the loop pole is up Tab counts as `next` and the notebook stays
  shut); a gamepad's d-pad gives `prev` and `next`. The drone adds `climb` (Space, gamepad
  button 12) and `descend` (Ctrl or C, button 13) for the drone; Ctrl is `creep` and `descend` at
  once, and each mode reads the one it wants. While the drone flies, `tool` (Q, gamepad X) and
  `use` (E, a click, gamepad A) turn it left and right, and the drone clears `use` for that frame. The wheel's `zoom` does not zoom the
  camera while aiming (`rig.aim`); the loop pole uses it to move between targets.
- `avatar.bones.pole` and `armR` are free for a loop pole aim and cast animation.
- `veg.hosts` (trunks, crowns, branches, palms, logs, mounds) is where lizards will sit.
  `mounds` are `{owner, x, y, z, r, h, kind}` (kind thicket, lawn, single or hedge);
  `branches` include the perch stubs, limbs and fronds (`frond: true`).
- `props` (from `src/world/props.js`, loaded with a dynamic import; the game carries on
  without it): `buildProps({ data, renderer })` returns `{ group, update(dt, t),
  colliders: [[x, z, r], ...] }`. `main.js` adds the group, runs `update` as a system
  and passes the circles to `Collision` after the vegetation's (owners `X<i>`, cyan in
  `?debug=colliders`). If the vegetation already built the props (`veg.props`), those
  are used instead.
- `pathMask`, `pathAt`, `pathDistance`, `pathLines` from `ground_decor.js` and
  `SHADOW_TINT` from `sky.js`, read-only, for anything that should keep off the paths or
  match the shadow colour.
- `game.lizards`: `all` (the active lizards, updated in place), `guests` (lizards another
  system draws and moves, the basilisks, refilled by it each frame), `nearest(pos, maxDist,
  filter)` (hidden ones too; filter `lz => lz.visible`), `pick(ray, maxDist = 30)` ->
  `{ lizard, point }` or null (a reused object; drawn wood in the last 12 m of the ray
  and every trunk from `veg.hosts.trunks` block it, leaves do not, so a pick from the
  camera works), `forEachVisible(camera, fn)`, `pin(i)` / `unpin()` (keep one spawn's
  lizard active, for a tutorial), `sunExposure(x, y, z, nx, ny, nz)`, `hours()` and
  `stats` (zero draw calls and triangles in the top view, where nothing is drawn).
- Each lizard: `species`, `sex`, `perch` (the recorded class), `state` (idle, alert,
  flee, hidden, return, frozen, captured, inactive), `display` (null, 'headbob',
  'pushup', 'dewlap'), `visible`, `surface`, `exposure`, `mood`, `tag` (free for the
  notebook), `headPosition(v)`, `freeze()` / `unfreeze()`, `capture()` (out of the
  world), `release(x, y, z)` (back on its perch, wary for 40 s; from a point it runs home
  first), `setBackpack(colour | null)` (drawn between the shoulders). A lizard object
  belongs to its spawn for the whole session, so `tag` and the backpack survive.
  `capture()` and `release()` return true when done (release is false when there was no
  slot to put it back in). `setBackpack` takes a number or a CSS string (converted once).
- `rig.hint` (camera.js): a point the creep framing leans towards, or null; `rig.creep`
  (0..1) says how far into the creep framing the camera is. Another system may set the
  hint itself (a lizard being aimed at) after the lizards' update.
- Events: `lizard:alert` (lizard), `lizard:flee` (lizard), `lizard:display` (lizard,
  kind), `lizard:hidden` (lizard, `{ x, y, z, away }`: where it went out of sight, a
  reused object, for a leaf puff or a bush wobble there), `croc:warn` `{ croc, x, y, z, distance, onLand }`,
  `croc:snap` `{ croc, penalty: { seconds, points }, x, y, z, position, radius }`,
  `croc:calm` `{ croc, x, y, z }`.
- `game.croc`: `crocs[]` (`state`, `position`, `h`, `alerted`, `watch`, `dist`,
  `visible`, `headPosition(v)`), `nearest(pos, maxDist)`, `enabled` (false switches the
  hazard off, calms any alerted croc and stops a lunge that has not snapped yet, for
  menus or a catch), `calmAll()` (the same, once), `rules` (distances, timings and the
  penalty, 20 s and 50 points), `sunExposure(x, z, y)`, `hours()`, `map`, and `stats`
  (zero draw calls and triangles in the top view).
- `collision.addDynamic(x, z, r)`, `setDynamic(handle, x, z, r)` (r 0 switches it off),
  `removeDynamic(handle)`: moving solid circles, tested by `isFree`, `resolve` and `move`.
- `sky.hours` and `sky.sunHeight` (the sine of the sun's elevation).
- The croc's knockback never touches `player.frozen`: for its 0.38 s it moves the player
  itself, zeroes their speed each frame and sets `player.pushed`, which `Player.update`
  treats like `frozen` (no steering, creeping or running) and the catch or a menu can read.
- `veg.colliders` (`{circles, owners}`, colliders.json shape) holds the vegetation's extra
  circles: mound puffs, bumps and hedges, trunks with no data circle, low limbs, fronds,
  leaf clusters and the bamboo clump, wherever they reach ground the player can stand
  on. `main.js` passes them to `Collision` as `extra`, after the data circles
  (`collision.dataCount`) and before the props'. A connectivity guard shrinks only the
  circles that would cut off a pocket of 1.5 m2 or more, and none covers a lizard on the
  ground. Logs are stepped over and ferns are soft decor you walk through.

## The field season: story, tools and state

The game loop. `main.js` loads `src/tools/ring.js` as `game.tools` and
`src/story/flow.js` as `game.story` (`?notools=1`, `?nostory=1` skip them).

- **Phases** (`state.phase`, `setPhase(p)` emits `phase:change`): title, intro, setup (the
  opening; the name is kept from the old set-up day so the ring, catching, UI and sound
  need no changes), survey, summary, then back to the title. The title's buttons call
  `game.story.start()`, `.continue()` and `.skip()` (Skip to survey day shows only when there
  is a save: a returning player's shortcut); the summary's button calls
  `game.story.toTitle()`. `game.story.cutscene` is true while the story holds the camera or
  the player (the ring and the catch wait for it); `game.story.step` is the opening's step
  (hunt, ibis, station, floss, practice, or null).
- **Intro.** The player stands on the landing facing the field station, which the ibises
  raided overnight: the table on its side (`props.table.setTip(1)`, a solid circle where
  its top lies; the table has a darker apron and underside and sturdier legs, so it reads
  as a table knocked over), muddy three-toed prints on the sandy path, a couple of
  feathers, spilled jars, a clipboard and papers (`kit_hunt.js`'s mess mesh). James walks
  up, waves and talks (`SCRIPT.intro`: the raid, then his short facts: ten years of
  catching every lizard, the lidar map, the 0.06 g backpacks, the microclimate sensors; on
  the raid line the camera swings over the mess), asks for a name (the kit's input box, 14
  characters), greets you and asks for a hat colour in one box, then a shirt colour
  (`RULES.looks`), shown on the avatar at once (`avatar.setLooks({ hat, shirt })`), and
  sends you off after the kit in two boxes ending "Onwards!", the player turned to face up
  the causeway towards the loop pole so the follow camera starts on the way to the kit.
  His own loop pole is not in his hand until the station is set right (it was on the
  table: `james.showPole(on)`). The camera is the story's own: over your shoulder onto
  James (`shotTalk`: 2.6 m back and 2 m aside; standing closer than 1.8 m to him, as at the
  table, it swings round to 4 m aside and 1.7 m back, so your hat never covers his face),
  then in front of you for the looks.
- **The opening** (the same morning as the survey, the clock held at 07:30,
  `RULES.day.setupHours`, the HUD reading "Getting ready"; the crocodile hazard off and
  the crocs kept afloat, so none hauls out by a piece of kit; the flags and loggers
  already standing), in order, each step saved (`state.setup = { kit: [ids], station,
  floss, practice, done, v: 2 }`) and each with a payoff:
  1. *The kit hunt* (`kit_hunt.js`). Four pieces lie in the open by the landmarks, each
     on a soft glowing patch, bobbing and sparkling: the loop pole on the open lawn at the
     top of the causeway (out from under the talipots' fans, seen straight up the causeway
     with the follow camera clear of them), the field notebook under rainbow eucalyptus
     T006, the bags by talipot T009, the ruler and scales under the osprey pole (`KIT`; each
     spot checked by a scripted test for free walkable ground, no bush, thicket or water
     within 4 m and a clear view from the nearest path). The maps show soft labelled search circles
     7.5 m in radius (15 m across), 2.8 m off the piece (`addMarker({ radius })`), not pins.
     Walking over a piece (or E within 2.4 m) picks it up: a jingle (`kitFound`), a
     sparkle burst and a pop-up card with what it is for in one line
     (`SCRIPT.hunt.items`); James on the radio after the first two finds other than the
     notebook, counting from what has been found (`{n}` found, `{left}` to go). Until the
     loop pole is found the hands are empty, the ring holds nothing and the tool badge says
     "Find your loop pole" (`setToolFilter`, `avatar.setStowed({ pole: false })`); finding
     it puts it in your hands and the ring. N before the notebook is found says "Your
     notebook is still out there somewhere"; finding it opens its cover with your name a
     second later.
  2. *The ibis* (the fifth piece). After the fourth find an ibis with the paint pens comes
     down on the way back to the station, 10 m off or more and best about 17 m, so it is
     seen and is a stop on the way home, never a detour away from the station
     (`hunt.ibisSpot`: `IBIS_SPOTS` nearer the station than the player; from the osprey pole
     that is the lawn 15 m back along the path). The camera watches it land while James
     says so on the radio: over your shoulder when that lens is clear, else from a few
     metres off its spot (`ibisLens`, `story.ibisLens`), and it flies in from behind that
     lens (or over your head), so the first sight of it is on screen. Walking within 4.3 m
     (6.5 m running) makes it hop and flutter a few metres away with a honk and a "flaps
     off" toast; after three flutters it gives up and drops them. Creeping (or standing
     still) within 2 m makes it drop the pens and stalk off, indignant, then fly away; as it
     lets go the camera looks from the side for 2.6 s (`dropShot`, it follows the bird), and
     the pens cannot be picked up until it has turned away. The ibis's toasts are plain
     narration, not James. This teaches creeping before the lizards. With all five found,
     James's "That's everything!" comes as a radio toast as you set off home (nothing to
     stop for).
  3. *The station.* A gold marker and a map dot lead back; one E stands the table up with
     a creak and a knock (`tableUp`), the kit pops back onto it (`station.js`'s mesh) and
     James has his pole again; he says one line and hands you the floss. His talk's camera
     takes the shoulder on the table's side (`shotTalk(snap, TABLE)`), so the righted table
     with its kit is in the picture beside his face.
  4. *The floss loop* (`floss.js`, trace the dotted loop or hold E; the loop is on the
     avatar's pole only from then, `avatar.setLoop`). While you tie it James sets off up the
     causeway (`jamesToPractice`, along `CAUSEWAY` at a brisk 1.7 m/s, `james.walkTo(x, z,
     speed)`) to watch the practice catch from beside it.
  5. *The practice catch* on a calm crested anole in the open, chosen at run time by
     `practice.js`, which tests the real world: a trunk 0.65 to 1.7 m up by a path,
     facing the approach, a straight creep of 5 to 7 m from a path with no collider,
     thicket or leaves on it, the lizard in plain view along it past leaves and wood from a
     creeping player's eyes and from the creep camera behind them (`CREEP_VIEW`: 5 m back
     at a pitch of 0.5 rad, 0.5 m over the right shoulder; no crown, fan or bush on that
     line anywhere along the creep, which turns down perches under low palm fans), a place
     to stand in reach, no bush hugging the trunk. It picks spawn 455, a male 0.75 m up
     talipot T019 just east of the causeway fork, with a 7 m creep from the path (about
     40 ms, once). James's line ("Perfect loop! Now let's try it on a real lizard. I'll meet
     you by a crested anole at the causeway fork. Follow the gold marker.") is
     face to face or on the radio; a gold marker stands at the start of the creep on the
     path (a gold dot on the maps at the lizard). There (within 2.4 m of it, or 8 m of the
     lizard any other way, or 11.5 m at a jog, before a runner makes it bolt) the camera
     shows it on its trunk from a few metres in front of its perch (`shotLizard(lz, { near:
     true })`, no look over your shoulder with your own pole across it) and James says
     "There it is! Hold Ctrl and creep in slowly, and don't run at it."; you are
     turned to face it, the marker moves in front of its perch, and while the practice runs
     the creep camera keeps the practice's low pitch (`rig.creepPitch`, camera.js), so the
     lizard stays in the upper part of the picture all the way in (its head stays on screen
     from 7 m in, with nothing on the camera's line). James watches from a few
     metres to the side of the perch (`watchSpot`: off the creep line, off your way in and
     out of his talk reach from where you loop it, so E stays the loop pole's). He talks you
     through the catch with short toasts, one at a time (a new one replaces the last, the
     snug ring says its own): creep, reach, raise the loop pole, loop, bag, ruler, paint. It
     stays calm (`lz.calm`: it may stop and watch a walking player but bolts only from a
     runner). The catch runs the bag ("Practice catch!"), ruler and paint cards, scores
     nothing and counts nothing (`game.catching.practice`: no "Gotcha" or "Spotted" toast,
     no spotted count, no held-Tab hint for the others out of reach).
  6. *The wrap-up.* James, face to face from where he watched (or on the radio with the
     camera beside the creep: `shotWrap`), says "Lovely catch, {name}! Survey day starts
     right now.", reads the day's requests and ends "The day ends at half past six.
     Onwards!" (three boxes: the Today card shows the sun rule, the day's first logger
     download says what the colours mean, and the first crocodile on screen gets its own
     word). The survey day starts there and then at 07:30 where you stand: no night fade,
     no separate set-up day; James walks home to the station. The practice anole keeps
     today's paint dot (`tag.caughtDay` set to the survey's `dayKey()`), so caught again
     that morning it is a recapture, a quick look for 5 points, as his paint line promised.
  Talking to James mid-opening gets a nudge for the step. The first crocodile on screen
  (in the camera's view, not just near) gets a word from him over the radio, in the opening
  or, straight on from it, on that survey day. Continue picks up at the step the save was
  at, at the station (with a nudge from James, except at the ibis, whose call follows at
  once, and at the practice catch, whose line says it all); an old save from the middle of
  the old set-up day starts the opening afresh with the name, looks and notebook kept and
  James saying the ibises raided the station again; an old finished save (or one with a
  missing or damaged setup but survey days or catches behind it) goes to the survey day.
  The loop pole's id is `loop_pole` (the tool, the kit piece, its icon, `?tool=` and
  `?huntstep=`); older saves and links used another id for it, which `currentId()` in
  `state.js` maps on load (the kit found and its task), in the title's summary and for
  `?tool=` and `?huntstep=`. That one entry is the only place the old id is kept.
  Each flow (the intro, the opening, the survey's start, the day's end) carries its own
  token, and a new one (back to the title, Start, Continue, Skip) ends any wait an older
  one is in at once (`story:abort`), so nothing carries on over the title. The whole
  opening is 19 dialogue boxes; a new player takes about 4 minutes reading every line at 20
  characters a second and running between pieces, 5 walking everywhere (see "Budgets").
- **Survey day.** `newDay()` refills the bag (5 backpacks), clears today's counts and
  score, and draws James's three requests for the day (`state.today.requests`, from
  `REQUESTS` in `tasks.js`: catch 2 brown anoles, download 4 loggers before noon, fit 2
  backpacks, a species near a flag, a lizard in a warm patch...; 50 points each), which he
  reads out in the morning (or in the opening's wrap-up) and recalls when you talk to him.
  On a day that does not follow the opening straight on, a new player (under three
  crested anoles caught) then has a crested anole pointed out near the start
  (`game.catching.pointOut`, pinned): a gold marker's ring on
  the ground in front of its perch with the diamond above, and a zoomed glance over the
  player's shoulder, during which the whole marker is drawn at 0.6 scale with the diamond
  0.24 m over the lizard's head, so the drawn-in lens shows the two together and the
  diamond is smaller than the anole (`markFirst` in `flow.js`; markers take an optional
  `scale`). The clock runs from 07:30 to 18:30 over `RULES.day.dayMinutes` (12) real
  minutes (`?fast=n` multiplies it) and stops while a dialogue, panel, the pause card or
  a catch's release cards are open.
  The sky follows the clock squeezed into `RULES.day.skyHours` (08:24 to 17:54 sky time),
  so the day opens and closes in golden light rather than at sunrise and sunset, and the
  lizards (which read `sky.hours`) never go to sleep in play. At 18:30 the player is taken
  back to the station, `state.summary` is filled (with `band` and `requests`) and the
  phase turns to summary. James's closing line is banded on the day's catches, species
  and requests (`RULES.summaryBands`), not on the score, which the one-time stamps swell
  on the first day. A croc snap in the survey takes its penalty's points and seconds off
  the day (`state.js`).
- **James** (`james.js`): one skinned mesh and its outline, two draw calls. He idles at the
  station beside the table (turns to face you within 6 m, looks at your face, waves when
  you come back from over 12 m away, talks with his free hand) and every 14 to 26 s holds
  the lizard bag up to the light. He is a moving solid circle (`collision.addDynamic`).
  Walk up and press E to talk: a tip for an open species task, a cheer, loggers due or
  backpacks left.
- **James's lines** all live in `src/story/script.js` (`SCRIPT`): `{name}` is the player's
  name, other `{words}` are listed beside each line, a list of one-line lists is a pool
  picked at random. Plain text only in his lines (a `[Key]` mark is shown as the bare key).
  Jon's are `SCRIPT.jon`, the same way.
- **Tuning** is all in `src/game/rules.js` (`RULES`): the day, the bag, the points
  (rarity common 10, uncommon 25, rare 50, very rare 100, times `repeat` [1, 1, 0.5, 0.5,
  0.25] by how many of that species were caught earlier the same day; creep 15, display
  30, first of a species 40, backpack 40, spot 5, task 100, logger reading 15, request 50,
  GPS download 15, perch taped 5, a perch logger clipped 10 and its first download 15 (5 for a
  later one), croc -50, a careless pole break -25 (`carelessBreak`), and the catch's extras: perfect snug 10, SVL
  spot on 5, perch noted right 5, crocodile spotted 25, same-day recapture 5; the field
  kit: a finished mission 40, 80 or 120 by stars, a plant 10 and 10 more named right, a
  scan 10 a star), the requests a day, the summary bands, the rarity from
  the record counts, backpack colours, the looks, the reach of jobs (a GPS download 6 m,
  the tape 3 m), how often a logger can be read (every 1.5 game hours), the loggers'
  microclimate, the odds of loops and poles giving (`RULES.breaks`) and how often Jon comes
  (`RULES.jon`).
  `catchPoints(species, { alerted, display, first, backpack, today })` adds up a catch.
- **State** (`state.js`): `state = { phase, playerName, looks, clock, score, best, days,
  inventory, species: { crested, brown, green, bark, knight, croc: { spotted, caught,
  tagged, biggestSvl } }, tasks, setup, flags, loggers, tracked, breaks, jon, today, summary }`
  (`breaks` is `{ loops, poles }`, the season's snaps and breaks, saved; `jon` is `{ met,
  hints }`, whether you have met Jon and the species he has given a hint for, saved). Lizards
  carry their scientific epithet (`cristatellus`...); `speciesKey()` gives the notebook's
  key. The counts come from events: `lizard:spotted`, `lizard:caught` { lizard, bonus },
  `lizard:measured` { lizard, svl }, `lizard:tagged` { lizard, colour } (adds a
  `state.tracked` entry and takes a backpack), `croc:spotted`, `logger:read`, `task:done`.
  `perchHeight(lizard)` is its height to the half metre.
- **Save** (`save()`, `load()`, localStorage key `stroudlab.fieldseason.v1`, every access
  wrapped): name, looks, best score, days, the notebook (species, tasks), the opening's
  progress (`setup`: kit ids, station, floss, practice, done, `v: 2`), flag and logger ids
  with the readings, tracked lizards as species, sex, colour, perch, height, SVL and day
  (never a position), and the followed lizards' life stories (a trail only as
  offsets from the perch) and `perchIntro`. Saved after the intro, each step of the opening,
  every stamp, every 60 s of the survey, at the end of the day (twice: again once the perch
  loggers still out are collected) and on leaving the page (only in the set-up and survey
  phases). `?nosave=1` turns it off, and so does any debug or
  screenshot flag (`phase`, `skipsetup`, `catch`, `catchstep`, `open`, `clock`, `fast`,
  `tool`, `name`) unless `?save=1` is given too, so a check image never touches the
  player's notebook. `load()` checks every field of an old or damaged save (colours must
  be `#rrggbb`, readings need finite hours and degrees, tracked lizards a known species;
  the name goes through the name box's `cleanName`) and falls back field by field.
- **Days.** `dayKey()` (`state.js`) is a number for "today", new for every survey day and
  the opening and never reused in a session; a lizard's `tag` remembers the day it was
  spotted, counted, caught, taped and forgiven a slip against it, so a new day or a new
  season starts clean without walking every lizard.
- **Tasks** (`tasks.js`, `TASKS`): the opening's four jobs, shown as the HUD's "Getting
  set up" checklist and stamped without a "Task done" toast or points (find the kit, 5
  unique ids on `kit:found`; set the station to rights; tie a fresh loop; the practice
  catch), 12 species tasks (crested: catch 5,
  catch one mid-dewlap, backpacks on 3; brown: 3 on the ground, a backpack; green: spot one
  on the leaves, catch one; bark: spot one, catch 3; knight: spot one in the canopy, 2.5 m
  up or more, a backpack; crocodile: spot it from a safe distance), five field tasks
  (download all 12 loggers in a day, a catch mid-display, 3 creep catches, 3 perch heights
  taped before the catch, a GPS track downloaded), the field kit's four and, last, the brown
  basilisk's two ("Basilisk!": catch one; "Water runner": watch one run across the water,
  `basilisk:waterrun`). Each done task stamps, toasts and scores `RULES.points.task`. The
  notebook keeps the basilisk's page, index entry, bookmark and stamp slots back until one
  has been spotted or caught (`revealed(u)`, `shownSpecies()`; its index then goes four
  across), and the day's summary shows its row from then on too.
- **The tool ring** (`ring.js`): hold Q, point (or steer with WASD) and let go; 1 to 6 pick
  at once (1 loop pole, 4 GPS backpacks, 5 tape measure, 6 empty hands; 2 and 3 are free since
  the flags and loggers stand from the start, and the field kit's tools follow them); X puts the tool away. The ring holds the player still while it is open.
  `registerTool({ id, name, icon, key, pose, onEquip, onStow, update, suggestFor })`;
  `suggestFor(ctx)` returns `{ score, prompt, run, why }` for a job nearby. The best job
  shows as the hint: its prompt when that tool is in hand (E runs it), else "[key] Take out
  the ...", and E takes the tool out. `registerInteraction({ id, check })` adds jobs that
  need no tool (talking to James, reading a logger, the station). A new tool is a file in
  `src/tools/` with `build(game)` that calls `registerTool`, plus one line in
  `TOOL_MODULES`; the avatar holds a tool it has no model for in an open hand
  (`pose: 'hold'`); `phrase` names it mid-sentence in the hint ("the GPS case").
  Every tool has a job: the loop pole catches (and, beyond its reach, the hint teaches
  creeping); the GPS case downloads a tagged lizard's logged fixes within 6 m (a read-style
  tap, then its trail appears on the maps: the backpacks log fixes on the pack, and only
  downloaded ones are drawn); the tape measure tapes the perch height of the lizard in
  front within 3 m (the one faced most squarely, not a nearer one to the side) before the
  catch (the perch card then shows the taped height to the half metre, not a guess by eye
  to the metre, and the catch earns 5).
- **Catching** (`src/catch/`). With the loop pole out, hold aim (right mouse or F): the pole
  rises and the camera eases in over the clearer shoulder. In lock-on, the default, the
  loop picks the lizard itself: shown, catchable today, inside the reach envelope
  (`CATCH.reach`: about 2.5 m out and 3.5 m up), not round the back of its trunk, in front
  of the player or on screen, scored by its angle off the middle of the view plus its
  distance from the player, and one the player can see if there is one. The loop glides
  over its head at 0.85 m/s at most and, in this mode, never startles a lizard (only the
  player's own movement and noise do); the player turns to face it. A soft ring marks the
  target with "Click to loop" (green once the loop has settled, gold with "Dewlap! Click
  now!" mid display), small dotted rings mark the others in reach, and a tap of Tab, the
  wheel or a quick sideways flick of the mouse (70 px, not an orbit drag) moves to the next
  one in reach across the screen and round to the first again (`loopPole.cycle`; the wheel
  up, a flick left or a gamepad's d-pad left go the other way). Holding Tab for 0.4 s
  (`CATCH.lock.hold`) moves instead to the next lizard in view out of reach, one more with
  each hold (`loopPole.cycleOut`), and a tap comes back to the ones in reach. A click
  before the loop has settled waits up to 1.6 s for it. With none in reach (or once a held
  Tab has moved out of reach) the ring and the hint point at a lizard in view: "Get closer" (hold
  Ctrl to creep; it becomes the target as soon as it is in reach), "Too high to catch:
  hold to spot it" (the spotter holds on it through `loopPole.spotRay()`), "Round the back",
  or in the opening "Hold to spot it" (only the practice anole can be caught there). A crocodile in view that has not been spotted
  today comes first when none is in reach: "Crocodile! Hold to spot it", or "Too close!
  Back away" inside the safe distance. **Precise aiming** (the pause card's switch, `state.settings.preciseAim`,
  off by default and saved by `saveSettings()` under a key of its own, so Start again keeps
  it; `?precise=1` for checks; always on for a VR `aimRay`) switches to pointer aiming: the
  loop follows the pointer, its depth from the lizard nearest the ray, and a fast loop
  near a lizard startles it. Then E or a click starts the snug (`timing.js`): the ring
  shrinks round the head and a press in the green band snugs the loop (per species
  windows in `CATCH.timing`; creeping and a display widen it; a very rare lizard forgives
  one miss a day), then the cards (bag, ruler, paint pen, backpack, perch notes) and the
  release. `CATCH.lock` holds the lock-on numbers (glide speed, scoring, the flick,
  wheel step and cooldown), all in `src/catch/tuning.js`; the points are in `RULES.points`.
  On the survey day a lizard that bolts from a walking or running player who was heading
  for it (within 5 m and about 30 degrees of their facing) gets the flee lesson, "Too quick!
  Hold [Ctrl] to creep up on them...", twice a day at most; one flushed beside the path on
  the way to a logger or a flag does not (`lizard:flee` in `catching.js`).
- **The avatar's tools** (`avatar.js`): every tool is in the one skinned mesh on a bone of
  its own, shown or hidden by scaling the bone: flags, a logger, the GPS case and the tape
  in the right hand, and on the pack the collapsed loop pole (slung across it while
  another tool is out), spare flags in the side pocket, a spare logger and the tape on the
  belt. `setTool(id, { pose, instant })` swaps with a quick reach back to the pack;
  `setStowed({ flags, loggers, pole })` (`pole: false` hides the loop pole on the pack until the opening's hunt finds it); `setLooks({ hat, shirt })` rewrites the hat's and the
  shirt's vertex colours. No extra draw calls.
- **Loops and poles that break** (`src/catch/breaks.js`, `game.catching.breaks`; survey day
  only, never in the opening; odds and timings in `RULES.breaks`; random draws from
  `makeRng` (`world/models.js`) seeded by `?breakseed=n`, else the clock, so they never
  touch `Math.random`'s sequence). Nothing goes without a tell: for `RULES.breaks.tell`
  (0.6 s) the loop frays or the pole creaks, the pole shakes in the hands
  (`avatar.aim.wobble`) and the loop swings, with a toast and a sound; only then does it go.
  - *Loop snaps.* A missed snug (too early or too late) snaps the floss loop one time in 5
    (`loop`), 3 in 10 on a knight anole, which bites floss (`loopKnight`); so may a bop in
    Precise aiming. It goes at once, while the loop is still over the lizard (before the
    miss plays out): the loop's two halves whip off the tip and fall as strands, with a
    small white burst (`src/catch/snap_fx.js`, built at the first snap; `breaks.fx`), the
    pole kicks back (`avatar.aim.recoil`), the floss snap sounds (the toast's chime held
    back, the music dipped) and the toast "Oh no, your loop has snapped!" comes; the tool
    badge says "Loop snapped" until it is re-tied. The loop leaves the pole
    (`avatar.setLoop(false)`); the pole stays in hand 0.8 s (`breaks.settling`), then stays
    down until it is re-tied: with the pole in hand the hint offers "[E] Re-tie the floss
    loop", which opens the opening's floss card (`floss.js`, one go a press); a catch cannot
    start meanwhile.
  - *Canopy breaks.* A miss on a lizard on branches or leaves 2 m up or more
    (`canopyHeight`) tangles and breaks the pole one time in 10 (`canopy`), before any loop
    roll. No penalty.
  - *Careless breaks.* With the loop pole raised (aiming, or more than half way up), a jog
    stopped dead by a trunk (the vegetation's `hosts.trunks`) or the field station's props
    (bushes and the water's edge do not count), or the loop swung along the ground at 2.6 m/s
    or more in Precise aiming (`ground`), is a stub. The day's first only says "Thwack! Mind
    the pole."; after that each stub breaks the pole 3 times in 10 (`careless`), for -25 on
    the day (`RULES.points.carelessBreak`, the HUD's "Broken pole"; the board's notebook
    files it with the croc's snaps under "Losses", its one part for them).
    Putting the pole away during the creak saves it.
  - *The lab rule.* The season's first break of either kind (`state.breaks.poles` 0) is
    free: no penalty, James over the radio ("First one's free. That's the rule.") and a new
    pole in your hands 1.2 s later. After that the loop pole leaves the ring
    (`setToolFilter`) and the pack, the tool badge says "Pole broken: James has a spare",
    the maps pulse "New pole" at James, and his talk prompt becomes "[E] Ask James for a new
    pole": his line goes by `breaks.kind` (`SCRIPT.breaks.replace.canopy` or `.careless`)
    and then he hands one over (`breaks.replace()`, from `chat()` in flow.js). Without a pole
    you still walk, spot and use the other tools. A new day or a new season starts whole.
  - *Records.* `state.today.loopSnaps`, `canopyBreaks` and `carelessBreaks` (counted in
    state.js from the events, with the penalty) show under "Today's catches" on the
    notebook's grid page and on the end-of-day card, a phrase per kind
    (`breakWords` in notebook.js); neither shows anything on a day without.
  - *Hooks for a helper* (Jon re-ties a snapped loop, once). `loop:snap` {
    first, count, lizard, species, why, claim } comes as the loop goes: `first` is true for
    the season's first snap (`state.breaks.loops` was 0), `why` is 'early', 'late' or 'bop'.
    A listener that will do the re-tie calls `e.claim()` there and then (synchronously): the
    "Re-tie it" toast (1.4 s after the snap otherwise) does not come and the player's [E]
    offer stays off. It then calls
    `game.catching.breaks.retie(by)` (`by`: who, e.g. 'jon') to put the loop back on with no
    card, which emits `loop:tied` { by }; or `breaks.handBack()` to give the job back to the
    player. A claim left alone for 6 s (counted only while no talk or card is up) goes back
    to the player by itself, with the "Re-tie it" toast. `breaks.snapped`, `breaks.noPole` and `breaks.onTheWay` (the free pole's
    moment) say where things stand;
    the other events are `loop:fray` { lizard } (the tell), `pole:stub` { warn },
    `pole:creak` { kind }, `pole:break` { kind, free, count } and `pole:new` { from:
    'radio' | 'james' | 'reset' }.
- **Jon** (`src/story/jon.js`, `game.story.jon`), from the lab, drawn as himself on James's
  rig (`buildJames(game, { geometry, name, bag: false, solid: false })`; `james.js` exports
  `partList`, `mergeParts` and its shape helpers for him): big fluffy wavy hair from
  overlapping rounded tufts, wider than the head and down to the shoulders, with the head
  torch's green band round it, thin dark rectangular glasses, a moustache and a short chin
  beard along the jaw, a toothy grin (dark inside; the flat face shapes are cut finer before
  they are wrapped onto the head, so the skin never shows through them), a fine blue gingham
  shirt (a `paint` per triangle on the rig's parts), a plain green lanyard and an orange GPS
  backpack. Portrait `jonPortrait()` (drawings.js); a dialogue
  whose speaker is Jon gets it. He just appears, on the survey day only.
  - *Coming.* A visit wants a spot `RULES.jon.near` (3 to 6 m) from the player, free and
    walkable, with a straight walk up to 2 m from them and a talk camera over their
    shoulder with no bush, trunk or crown in the way; and out of the camera's view, which is
    tested as spheres round his head, body, legs and boots (mid-stride too) and round his
    shadow (from the sun's direction, `sky.state.sunDir`). He is placed there and shown in the same frame, after the
    story's camera has moved for it (`jon.update` runs last in `flow.js`'s update); the next
    frame the story's camera (`shot`) cuts to the talk, so nobody sees him arrive. He walks
    up and says "Oh, hey." (the first time, who he is), then the visit's lines; the player
    turns to him. Never during a catch, a mission, a talk, a card, a cutscene or the ring,
    only after 0.8 s of none of them. At most `RULES.jon.most` (3) visits a day, all kinds
    counted (`jon.visits`), and `RULES.jon.gap` (3) game hours apart (an hour is about a
    minute of play); the re-tie may come sooner, but counts.
  - *Going.* After the talk he walks off behind the nearest tree or bush: one that hides
    him from the camera if there is one not much further than walking out of the side of the
    view, else one on his way out of the view; then across the nearer side of the view
    (the view's side plane). He is gone the first frame every sphere is outside the view or
    wholly inside it and behind a trunk or bush (as volumes a little inside what is drawn;
    crowns never count, and nothing near the vegetation cut-out's tunnel to the player does). If he cannot get out of
    the view that way (twice), he heads 7 to 12 m from the player (the follow camera keeps
    anything near them in frame however it turns), to a spot out of view if one can be
    walked to, and stands there looking off until the camera turns from him, looking again
    every 1.5 s.
  - *His jobs.* A snapped loop, until he has re-tied one (`state.jon.retied`, saved): he
    claims it (`loop:snap`; not once his visits for the day are used up), comes 1.7 s after
    the snap, so the snap is seen and heard first, and re-ties it on his second line
    (`breaks.retie('jon')`), "Just the once, mind"; after that they are the player's. A
    claim that lapses (he found no spot out of view in time) leaves it for the next snap.
    The player's own first lock-on to each species not caught yet (held 0.5 s; a lock
    forced by scripted play does not count): one short hint, saved in `state.jon.hints`, never
    repeated (the brown basilisk's: "Get between it and the water."). `RULES.jon.nudge` (2) game hours with no catch: a word on sun and shade for
    the time of day (`lizards.thermalPhase()`), once a day. All five GPS backpacks fitted:
    `RULES.jon.spares` (2) more, once that day.
  - *Notes.* When he cannot come (visits used up, too soon after the last, or for the
    backpack word nowhere to come from unseen), a hint comes as a toast with his portrait,
    "Jon: Knights gape before they bite. Ease off." (`SCRIPT.jon.notes`, `kit.toast(text, {
    portrait: 'jon' })`), at most one every `RULES.jon.noteGap` (2) game hours (one that
    cannot go yet waits for the next lock-on on that species); the spares come as a note
    too; the backpack word comes as a "Note from Jon" dialogue with the same choice; the
    word on sun and shade is dropped for the day. `jon.notes` counts today's by kind, and
    each emits `jon:note` { kind, species }.
  - *The backpacks' spread.* As a GPS backpack is about to go on (`jon.steer(lizard)`, the
    release's `beforePack` hook in catching.js, before the card): when today's fits already
    include `RULES.jon.sameSpecies` (2) of that species (the brown basilisk counts as one, with
    a line of its own), or the last `sameArea` (2) were all
    within `area` (15) m of this lizard, he comes (out of view, as ever; skipped when he
    cannot, in a mission or a cutscene) with one line naming the species and others that
    would tell us more, or the part of the island (by the compass from the middle of the
    walkable ground, or round the lawn) and the other side, then the choice: "Let it go"
    (the default: no card, the backpack stays in the case) or "Fit it anyway". No points
    either way; once per species and once per area a day. When he cannot come it is a note
    with the same choice.
  - *Model.* Built the first time he comes (or `jon.ensure()`): three.js draws on
    `Math.random` for every object's id, so a day he does not come draws exactly as before.
  - Events `jon:appear` { kind, x, z }, `jon:gone` { x, z, behind } ('tree', 'bush' or
    null when out of the view) and `jon:note` { kind, species }; `jon.frames` { appear, gone } holds the `game.frame` of each,
    and `jon.visit(kind, species)` asks for a visit whatever the odds and the gap.
- **James's nudge towards the field jobs** (flow.js, `RULES.kitNudge`): after 8 catches in
  the day (`catches`), or 6 since the last field job or nudge (`since`; a mission finished or
  a logger read is a field job), with one not done today (the laser scanner, the drone, the
  RTK plant survey, then the loggers, as `missions.offerable()` and `state.today.loggersRead`
  say), James says a line on the radio for it (`SCRIPT.survey.kitNudge`, the catching
  praised first) and the maps mark it as a job to do (at James for the kit, the nearest
  logger) until it is taken on or done. At most twice a day (`most`), 1.5 game hours apart
  (`gap`), a different job the second time if one is left; never in a catch, a mission, a
  talk, a cutscene or a visit from Jon, and only after 2.5 s of none of them.
- **Flags and loggers** (nothing to lay out, and each has a point). Stakes on dry land
  (177) are one instanced mesh; the 12 grid flags of
  `data/stakes.json` another (the cloth waves in the vertex shader and shows its stake's
  label from one atlas, readable from both sides), standing from the start of the game
  (`flags.js` puts them up quietly at build, on `state:reset` and in `restore()`, so an
  old save's few flags become all twelve); loggers a third (a white radiation shield with
  a blinking green light that blinks fast for 2.4 s after a download), one on every flag
  (the five logger stakes first; `ON_EVERY_FLAG`); the pulsing markers a fourth (their
  clock is kept in `flags.js`). `state.flags` and `state.loggers` hold `{ id, x, y, z }`.
  Neither is on the tool ring (keys 2 and 3 are free); `readMinigame` in `loggers.js` serves
  as the GPS case's download card.
  *Landmarks:* the minimap and big map draw every flag with its label (the minimap only
  where a label fits); every catch is noted by the flag nearest the lizard's perch: a
  "Where: by C07" line on the perch card (`setCatchPlace` in `release.js`, which
  `flags.js` fills), and the catch log (`flags.log`: species, sex, flag, clock time, day,
  display, perch and the backpack's id, never a position; saved under
  `stroudlab.fieldseason.catchlog.v1`, 80 at most, cleared on `state:reset`) that the
  notebook's grid page lists ("Today's catches", a gold count by each flag on its map, a
  season count on each flag's chip); tracked lizards carry `flag` too. James's request
  `req.flag` names a flag and a species with enough perches within 7 m of it ("Catch a
  brown anole near D05", `flags.requestPick`); the maps ring that flag in gold (8 m)
  while it is open. Requests may `make()` their label and extra fields each day and
  their `test(e, request)` sees the request.
  *Loggers:* on the survey day, walking within 3 m (`DOWNLOAD_R`) of a logger due a
  download (none yet today, or `RULES.loggerReadEvery` 1.5 game hours since the last in
  this session) downloads it by itself: `logger:read` { id, celsius, hours, kind, auto }
  (the event the tasks, requests, sound and counts listen for), 15 points the first time a
  day and 5 for a later pass, a sparkle, a toast (`SCRIPT.survey.loggers.toast`) and, with
  the day's first, James's line on what the colours mean by the sun's phase and that
  patch's colour (`SCRIPT.survey.loggers.first[phase][kind]`: a cool patch first thing
  gets "Blue means shade. They won't be basking here this early. Look for the orange
  bits!"). Each download colours a patch of radius 9 m round the logger (`PATCH_R`): a
  1 m grid of samples, each tested for sun at 1.0 and 2.2 m over the ground with the
  lizards' own `sunExposure` (the drawn crowns, fans, bushes and trunks, the sky's sun at
  that moment), softened over its neighbours within 2 m (`SMOOTH_R`, a tent kernel, so a
  trunk's or a frond's thin shadow does not speckle the patch) and classed warm (exposure
  over `THERMAL.sunny` 0.3), cool (under `THERMAL.shady` 0.12) or mild, drawn once into a
  soft blurred blob (orange `#ffa85c`, blue `#66b0e6`: `WARM_RGB`, `COOL_RGB`, softened to
  sit with the pastel map; a soft rim) that `minimap.js` draws under the marks on both maps
  at `PATCH_ALPHA` 0.8 times its freshness (1 for 1.5 game hours, fading to 0 by 4). The
  classes drawn are the ones `patchAt` answers with. *One word everywhere:* a patch's
  `kind` is the majority of its cells (warm or cool when that side has 1.3 times the
  other's cells and at least 30 % of its land, else 'mixed', "dappled"), and the toast,
  James, the notebook chip, the logger's dot on the maps and the reading all follow it.
  The reading (`patchCelsius`) is the patch's: a daily curve from 23.2 at 06:30 to 28.6 at
  14:30, plus up to 3.2 in full sun times the patch's mean sun times the sun's height to
  the 0.8, some of the stake's canopy and water cooling, a nudge by kind and a wobble,
  then held inside its kind's band round the hour's middle (warm over, cool under, mixed
  near it, a band-held reading set a little inside the edge so they differ), so at one
  moment a warm patch always reads warmer than a dappled one and that than a cool one
  (checked by a scripted walk: none out of order at one moment, and no warm reading under a
  cool one across 45 minutes). `p.own` (the stake's own spot) is kept
  for checks only. `loggers.patchAt(x, z, minFresh)` gives 'warm', 'cool', 'mild' or null
  from the freshest patch (the request "Catch a lizard in a warm patch on your map" uses
  it). *Where it shows:* the minimap's small warm and cool key while a patch is in view,
  ringing the colour you stand in; walking into a fresh patch of the colour that matters
  now (warm in the morning and late afternoon, cool at midday), at least 9 s after a
  download, a toast once a day for each phase (`SCRIPT.survey.loggers.enter`: "Warm patch!
  Lizards bask here in the morning and show off more. Watch for a display bonus.", not
  when James has just said it); the perch card's Where line and the grid page's catch rows
  ("by D05, basking in a warm patch", `flags.js` `PATCH_WORDS`, the catch log's `patch`);
  the Today card's sun row ("Cool morning: orange patches", above); the big map's key (only
  on the survey day: in the opening it lists just you, James and the station, the kit's
  search circles, where James wants you next, the flags, paths and big trees) and the
  notebook's logger page in one wording (`THERMAL_KEY` in
  `minimap.js`: "Warm: sunny, where lizards bask early and late", "Cool: shady, where they
  sit out the midday heat"); the logger page's chips (the patch's colour, °C, the time and
  sunny, shady or dappled; stale once the patch is half faded) and its chart (every line
  in one soft ink, each reading's dot in its patch's colour, each line's end labelled with
  its flag). The words say "sit out the heat" rather than "hide": the lizards that shelter
  out of sight at midday sit under low cover the 1.0 and 2.2 m sun test reads as sunny,
  while the lizards still out on their perches do sit in the cool patches (see
  "Budgets").
- **Events** from here: `phase:change`, `score:add` { points, reason, total }, `clock:tick`
  (each game minute), `task:progress`, `task:done` { id, task }, `request:progress`,
  `request:done` { id, request }, `tool:equip` { id, tool, previous }, `flag:placed` { id,
  x, y, z, quality } (scripted `flags.place(id)` only), `logger:read` { id, celsius, hours,
  kind, auto } (a download), `gps:download` { id, n }, `tape:measured` { lizard, height },
  the opening's `kit:found` { id, n, total, x, z }, `ibis:arrive`, `ibis:flutter` { n },
  `ibis:drop` { gaveUp }, `setup:station` (the table stood up), `setup:floss`,
  `setup:practice`, `practice:done` { lizard }, `story:abort` (a new story flow began: an
  older one's waits end), `tracked:add`, `day:new` (today's blank
  counts), `day:end` (the summary), `ring:open`, `ring:close`, `hud:tool` (the tool
  badge to read the loop again: breaks.js). For the
  sound: `dialogue:type` (speaker, full text, characters shown; kit.js), `dialogue:skip` (a
  key finished a line early; kit.js), `ui:toast` (tone,
  icon), `notebook:page` (index), `card:act` (card, value: 'ruler' quality, 'paint'
  inside, 'wriggle' tries, 'pack' tries, 'perch' right; release.js), `fx:brush` and
  `fx:splash` (x, z, k; fx.js), `settings:change` { key, settings } and `audio:settings`.
  The field kit adds `mission:start` { id }, `mission:step` { id, step }, `mission:done` { id,
  stars, points } and `mission:fail` { id, why } (src/missions). The perch loggers add `perch:clip` { entry,
  kind, species, lizard } and `perch:download` { entry, first, whole, hours }
  (src/tools/perch_loggers.js). Loops and poles add `loop:fray`, `loop:snap`, `loop:tied`,
  `pole:stub`, `pole:creak`, `pole:break` and `pole:new` (src/catch/breaks.js; below). The
  basilisks add `basilisk:patter` (x, z), `basilisk:waterrun` { basilisk, first } and
  `basilisk:landed` { basilisk, x, z } (src/wildlife/basilisk.js), and emit `lizard:alert`,
  `lizard:flee`, `lizard:display` and `lizard:escaped` { why: 'water' } as a lizard.
- **Flags:** `?phase=title|intro|hunt|practice|survey|summary` (`setup` is kept as `hunt`;
  hunt, practice and survey skip what comes before; survey skips James's morning lines),
  `?huntstep=loop_pole|notebook|bags|scales|ibis|station|floss|practice` (a fresh opening at
  that step with everything before it done, the player standing where it begins),
  `?name=Ali`, `?skipsetup=1` (skip the opening: after the intro, straight to the survey
  day with everything done), `?clock=13.45` (the survey day starts at 13:45; once the story
  runs, it sets the sky, and `?t=` only the title's), `?fast=n`,
  `?tool=loop_pole|backpacks|tape|none`, `?loggers=all`, `?nosave=1`, `?save=1` (let a run with
  the flags above write the save). `?open=minigame:gps` opens the download card and
  `?open=minigame:floss` the floss card (the UI reads `?open=`).
- **Scripted tests:** `window.__game.play`: `auto` (true: the story's mini-games play
  themselves), `state`, `story`, `press(action)`, `hold(action, s)`, `setClock(h)`,
  `equip(id)`, `goto(stakeId)`, `gotoJames()`, `gotoTable()`, the opening's
  `gotoKit(id, dist)`, `gotoIbis(dist)`, `kitLeft()`, `huntAll()`, `practicePick()`,
  `gotoPracticeStart()`, `completeSetup()` (the whole opening done at once), `talk()`,
  `endDay()`. A play-through driver loads the game in a frame and plays it like a player: a
  new player from the title to the survey day, timed (reading every line at 20 characters a
  second, walking or running, heading for the map's circles and looking at the map), the whole
  game (see below), a seeded old save through Continue, Skip to survey day, the practice creep
  alone with the lizard's place on screen at each stop, and the moments for the check images.
  Other scripted runs go back to the title mid-hunt and Continue, Skip mid-opening then Start
  again, press Esc for the title during the walk-up, and catch the practice anole again on the
  survey morning.
- **Input.** A key tapped and released between two frames still counts as pressed for one
  frame (`input.js` latches taps), so quick taps are never lost at a low frame rate.

## How the pieces fit: the game loop

- **Load order** (`OPTIONAL_SYSTEMS`): lizards, croc, tools (the ring and its field tools),
  catching (registers the loop pole as tool 1), story (state, tasks, James, the phases), ui.
  `game.james` is the story's James (the maps draw his cap where he stands).
- **One set of numbers.** Every point value is in `RULES.points` (`src/game/rules.js`),
  the catch's small extras too (`perfectSnug`, `spotOn`, `perchNotes`, `crocSpotted`,
  `recapture`); `tuning.js` keeps only how the catch feels.
- **Counting.** `state.js` counts spotted, caught, tagged and the biggest SVL from the
  `lizard:*` events that `catching.js` emits, applies the croc's snap (points and seconds)
  and holds the clock while a dialogue, panel or the pause card is open. The HUD only shows.
- **Trails.** Each tagged lizard's backpack logs a GPS fix every 6 s of the survey day
  into `state.tracked[i].trail` (`catching.js`); the minimap, the big map and the
  notebook's tracked page draw those fixes, dotted in the backpack's colour. Trails live in
  memory only; the save keeps each tracked lizard's species, sex, colour, perch, height,
  SVL, day and nickname, never a position. Continue in the same session keeps the link to
  the lizard (and its trail); a new season takes every dot and pack off.
- **Input.** Enter on a focused button presses only the button, never [E] as well. With
  Ctrl held (creeping), mapped keys are `preventDefault`ed (no Find, Save, Print or Select
  all), Ctrl+1..6 and Ctrl+N are not mapped (the browser takes them), and a key pressed
  with Cmd is never mapped (no keyup comes on macOS; Cmd lets go of every key). The right
  button's aim follows the buttons that every mouse event on the page reports, wherever it
  lands, so letting go over a card, a talk box or off the page lets go of the aim, and a left
  click with the right held (a chord, which comes as a pointermove) still clicks. When the
  game ends the aim itself while it is held (a catch's cards, a talk, a panel, a push, the
  pole put away), `input.drop('aim')` keeps it up until it is pressed again, so the pole
  never goes back up on its own (`LoopPole._end()`, the one place aiming ends).
- **Busy.** The ring stays shut and its quick keys do nothing during a talk, a card, a
  cutscene or a catch (`game.catching.busy`, the in-world snug included).
- **The UI kit** (`kit.js`). Toasts made in the same moment are shown plain first, then gold,
  then "Task done"; empty text shows nothing and the same text again wobbles the toast
  already up. Stamps from one moment queue together, a label equal to one showing or
  queued merges with it, each holds 1.1 s while others wait, and with a card open a smaller
  stamp lands on the card's top-right corner. A dialogue with choices ignores keys for
  600 ms and then only confirms a choice the player has moved to (arrows, the mouse or 1 to
  6), so mashing E never picks a hat. The HUD's card is the opening's checklist (from
  `tasks.js`, with a row of kit icons) in the opening and "Today" on the survey day (backpacks left, loggers due,
  James's requests and the research task nearest done; it tucks away while aiming, and
  fades out while a card sits in the middle: the pause card, the notebook, the map or a
  mini-game, `body.ui-card-open` from `kit.js`; in a window under 700 px tall the clock
  and the tool badge fade too), and the first N after its task changes opens that
  species' page. The title's "Start again"
  asks before it clears a save. The notebook's perch chart comes from
  `game.lizards.speciesSummary(sci)` ({ records, rarity, perchCounts }), so the UI never
  reads the spawns.
- **Framing.** The survey day starts a little up the causeway from the landing where James talks
  (`SPOT.surveyStart` in `flow.js`), so the follow camera sits clear of the garden gate's arch;
  at the day's end the player stands by James again and the summary shot puts him in the left
  third, clear of the card on the right.
- **Check views.** Without `?phase=`, the check-image flags (`?cam=`,
  `?lizard=`, `?croc=`, `?view=`, `?at=`) leave the game in its plain walking state: no
  title, no HUD, the player free, so `tools/m3_checks.py` draws the same views.
  `?phase=survey` and `?phase=summary` skip James's morning lines on the first day.
- **Leaving.** Back to the title from the pause card saves the notebook first. While
  creeping (Ctrl) in the opening or the survey day, leaving the page asks first, since Ctrl+W
  closes the tab on Windows and Linux.
- **Scripted play.** `window.__game.play` has the story's helpers (above), `ui` (open,
  close, page, toast, title) and `catch` (`catchNearest(species, quality)`, `goTo`,
  `aim`, `lock`, `fixNow()`: the tagged lizards' GPS fixes for the clock as it is, so a
  scripted day can move the clock on and log them), and `game.catching.loopPole.cycle(dir)` moves the lock-on to the next
  lizard. The scripted full play-through plays title to summary and back like a player: the
  intro with the name and looks, the opening on foot (the hunt, the ibis crept up on, the table,
  the floss, the practice catch), every survey catch by creeping up, holding F and pressing E
  with no pointer at all (Tab when the lock-on picked another lizard), the snug and the cards, a
  taped perch, each catch logged by its flag, a logger downloaded by walking up to it, a GPS
  download, James, the notebook, map and pause switch, the croc's snap, the summary and
  Continue; it logs PASS or FAIL per check. Another run checks Tab, the wheel and a flick with
  two lizards in reach.

## Debug flags

| flag | effect |
| --- | --- |
| `?diag=1` | after 60 frames, JSON in `<pre id="diag">`: ok, errors, loadMs, main-pass drawCalls and triangles, geometries, textures, programs, player, veg stats, plus frameDrawCalls and frameTriangles with the shadow pass; written again whenever a later error turns up |
| `?view=top` | orthographic top-down render of x -62..82, z -50..52 (E 573088-573232, N 2840050-2840152) filling the canvas, no UI, no fog, sun nearly overhead (80 degrees) so the figure shows layout rather than one hour's shadows, player hidden; shoot it at 2016x1428 for 14 px per metre |
| `?cam=x,y,z,tx,ty,tz` | fixed camera |
| `?t=hours` | time of day, default 10.5 (with the story on, only the title's sky; `?clock=` sets a day's) |
| `?at=x,z[,heading]` | start the player there |
| `?debug=1` | readout (fps, draw calls, position, mode, noise) and collider circles (data circles red, the vegetation's own orange) |
| `?debug=spawns` | a sphere at every lizard spawn, coloured by species, with a faint copy drawn through the foliage so hidden ones show |
| `?debug=hosts` | `veg.hosts` as lines: trunks orange, crowns green, branches and fronds yellow, palm crowns blue, logs violet |
| `?debug=all` | all of the above; words combine with commas, as in `?debug=spawns,colliders` |
| `?nocut=1` | no vegetation cut-out round the player, for checking what the player could walk into |
| `?noveg=1` | skip the vegetation, for engine work |
| `?noprops=1` | skip the props |
| `?nograss=1` | skip the grass tufts and the ground's grass pattern |
| `?vegsplit=1` | each kind of merged leaf in its own mesh, for checking their counts (debug only) |
| `?headless=1` | pump the loop from a timer when frames stall (on by itself with `?diag=1` and in headless Chrome) |
| `?nohud=1` | hide the controls line |
| `?phase=title\|intro\|hunt\|practice\|survey\|summary` | start the story at that phase (`setup` is kept as `hunt`); hunt, practice and survey skip what comes before, survey skips James's morning lines |
| `?huntstep=loop_pole\|notebook\|bags\|scales\|ibis\|station\|floss\|practice` | a fresh opening at that step, everything before it done, the player standing where it begins |
| `?skipsetup=1` | skip the opening: after the intro, straight to the survey day at 07:30 with the kit found, the table up and the loop tied |
| `?name=Ali`, `?clock=13.45`, `?fast=n`, `?tool=loop_pole\|backpacks\|tape\|none` | the player's name; the survey day's start time; the day's clock n times faster; the tool in hand |
| `?nosave=1`, `?save=1` | never write the save; let a run with the debug flags above write it (they leave it alone otherwise) |
| `?loggers=all` | download every logger as the survey day starts (the warm and cool map for check images) |
| `?precise=1` | Precise aiming for this run (the loop follows the pointer), whatever the saved setting; its survey days count for Steady hands |
| `?nolizards=1`, `?nocroc=1` | skip the lizards or the crocodiles |
| `?debug=lizards` | a state marker over each active lizard (idle green, alert yellow, flee red, hidden blue, out of sight grey, returning violet, frozen white) and a count readout |
| `?debug=sun` | the same markers coloured by sunlight instead: blue in the shade to yellow in the sun, orange when too hot, white while sheltering out of sight |
| `?lizard=<species>&lizardsun=1` | (or `=0`) the focus lizard is one in the sun (or the shade) at the sky's hour, for the basking and shade check images |
| `?nofx=1` | skip the particles and small effects (`src/world/fx.js`) |
| `?noaudio=1` | skip the sound system (`src/audio/`) |
| `?audiolog=1` | make the audio context at once and log every cue with its time into `modules.audio` of the diag JSON (with `?diag=1`, rewritten every 5 s) and a hidden `<pre id="audio-log">` |
| `?open=settings`, `?open=pause:settings` | the title's Settings card, or the pause card with its settings column open |
| `?lizards=many` | 120 active lizards within 60 m, for load checks |
| `?lizard=<species>` | stand the player about 2 m from the nearest one that can be seen and hold a close camera on it until the player moves. For check images: `&perch=bark\|branch\|leaf\|ground\|log`, `&nth=k` (skip k), `&lizardcam=m` (camera distance, or `side` for a view over the player's shoulder), `&lizardfrom=m` (player distance), `&lizardlift=m` (camera height over it), `&scare=s[,creep\|walk\|jog]` (from s seconds the player walks at it, camera held), `&fleehold=f` (its escape stops at fraction f), `&lizardi=i` (that spawn, whatever the distance); with `lizardcam=side`, `&lizardback=m` and `&lizardaside=m` put the camera behind and beside the player (2.6 and 1.3; a negative aside takes the other side) and `&lizardmid=f` aims it f of the way from the lizard to the player (a flank view: back -1.2, aside -4.3, mid 0.45, as in `tools/m3_checks.py`). The held close view turns the cut-out off, so the perch stays whole |
| `?croc=cruise\|haul\|bask\|warn\|snap\|warncalm\|walkin` | a crocodile scene near the player; with `&crocspot=k` (haul-out spot), `&crocat=x,z` (where the cruiser starts), `&crocbask=s`, `&crocfreeze=1` (hold the snap), `&crocview=m` (a camera m metres beside croc 0; `&crocside=-1`, `&crocup=k`), `&crocyaw=a` (turn the follow camera) |
| `?crocseed=n` | fix the crocodiles' random choices (the default follows the clock) |
| `?basilisks=all`, `?basiliskseed=n` | a basilisk at every one of the 11 sites (in any phase), and the day's draws fixed (src/wildlife/basilisk.js) |
| `?nobasilisks=1` | skip the brown basilisks |
| `?breakseed=n` | fix the loop snaps' and pole breaks' random draws (src/catch/breaks.js; the default follows the clock) |
| `?crocfast=k`, `?crocdiag=s` | run the crocodiles k times faster; after s seconds, their stats and event counts as JSON in `<pre id="croc-diag">` |
| `?debug=croc` | the swim map, the haul-out spots and the current routes |
| `?mission=drone\|tls\|rtk` | the survey day (implied) with that field-kit mission started near its start; `&missionstep=` holds one moment for a check image (the lists are under "The field kit: three missions"), with `&missionspot=1..8` (the scanner's spot) and `&missiontarget=k`, `&missionback=m` (the rover's plant and how far back to stand) |
| `?dronelog=1` | the drone's flight state as JSON in `<pre id="drone-log">`, once a second |
| `?nomissions=1`, `?nomissions_drone=1` (`_tls`, `_rtk`) | skip the missions' registry (James then offers nothing), or one mission |
| `?catchstep=perchlogger`, `?catchstep=perchintro` | hold a catch on the perch logger's clip card, or on James's word before it (the first on a save) |
| `?perchdemo=1` (or `=nopack`) | open a made-up "day in temperature" card (with or without a backpack's trail), for layout checks |
| `?noperch=1` | offer no perch loggers (for scripted runs that press E through every card) |
| `?open=minigame:perchlogger[:species]`, `?open=notebook:follow`, `?open=notebook:follow:<k>` | the clip card on its own with a stand-in lizard; the notebook's "Followed lizards" spread, or one life story |
| `?noboard=1` | no island board this run, even with its API there (the game never pings) |
| `?boardtest=1` | a practice run (the debug flags above, `?nosave`) may still post its day to the island board: for scripted checks against a scratch board only |

`window.__game` holds `data, scene, renderer, camera, player, veg, props, sky, terrain,
water, collision, input, rig, events, teleport(x, z, heading), setTimeOfDay(h), stats()`.
`?diag=1` also reports `warnings` (console warnings, which do not make `ok` false),
`props`, `collision` (circle counts), the `terrain.decor`, `terrain.backdrop` and
`terrain.grass` counts, and `modules` (the lizards' and the crocodiles' stats).

Screenshots and the orthomosaic comparison:

    python3 tools/shot.py "http://127.0.0.1:8772/index.html?view=top" /tmp/top.png --size 2016x1428 --wait 15
    ../../.venv/bin/python tools/topdown_compare.py /tmp/top.png   # writes check/topdown_vs_ortho.png

The anole and crocodile check images (the two gallery sheets, five species on their perches, a
flee before and after, the crocodile swimming, basking and snapping) and
`check/m3_sheet.png`, which labels them all on one page, take about two and a half
minutes; name images to redo only those, `--sheet` redraws just the contact sheet:

    python3 tools/m3_checks.py [m3_flee_after ...] [--skip] [--sheet]

## Scripted checks

The scripted play-throughs, the check-image runs, the offline sound-level pages and the
board server's tests live in the local `work/` folder, which is not part of the game and is
never packed. The browser runs use headless Chrome over the DevTools pipe and drive the game
through `window.__game`, key presses and the URL flags above. Runs that post to the island
board use a throwaway database and `?boardtest=1`.

## A WebXR mode later

The pieces are already separated for it:

1. Set `renderer.xr.enabled = true` and add a VR button. The loop is already
   `renderer.setAnimationLoop`, which the XR session drives.
2. Replace `FollowCamera` with a VR rig: a `Group` carrying the XR camera, placed at
   `player.position` (first person) or a small offset (a tabletop view). The rest of
   the game only reads `rig.yaw` as the forward direction for the move stick, which a
   VR rig takes from the headset.
3. Map the controllers onto the same actions with `input.addSource((frame, dt) => ...)`:
   thumbstick to `frame.move`, snap turn to `frame.look`, trigger to `use`, grip to
   `aim`, a face button to `notebook`.
4. Pass the XR camera position to `veg.update` so the canopy cut-out follows the head.

## Budgets

Measured headless in Chrome on a laptop with `?diag=1`, September 2026. Draw calls are the
main pass's, with the shadow pass's in brackets.

- **The start view** (1600x913, pixel ratio 1), the world alone: 29 calls and 1.15 M triangles
  (40 and 1.64 M): terrain 1, flowers and clover 2, grass 1, backdrop 2, water 1, sky dome 1,
  clouds 1, vegetation 13 (0.57 M triangles, 1,454 instances), props 4 and player 3. Only the
  vegetation, props and player cast shadows (not the grass, flowers, ferns, logs or prop
  roots). The pixel ratio is capped at 1.5.
- **Lizards and crocodiles.** The lizards add one call per species in view, 5 at most, and
  0.13 M triangles for 36 active lizards (3,050 to 4,714 triangles a model, about half of it
  the outline shell; the instance count is the live count). Each crocodile in view adds at most
  3 calls (body, outline, effects; none out of the frustum) and 18.9 k triangles.
  `?lizards=many` adds 5 calls and 0.45 M. Neither draws in the top view. A basilisk in view
  adds 2 calls (body and outline) and about 10.5 k triangles (5.2 k a mesh); none is drawn
  more than 45 m off or out of the frustum.
- **Each state** at 1600x1000: the title 45 (65); the intro 35 (55); the kit hunt 39 to 42 (58
  to 62); the ibis 43 (63); the station 38 (58); the floss and the practice 38 (59); the survey
  day 46 to 47 (68 to 69) at 08:00 and 12:30, and the same with every logger downloaded; a
  catch 35 to 39 (55 to 59); a day card 47 (69); the perch logger's clip card 36 (57); the
  summary 34 (55); the top view 24 (35). Triangles stay between 0.92 and 1.38 M. The UI is DOM
  plus one 2D canvas for the maps (redrawn at 10 Hz), the island board is DOM only, and the
  sound draws nothing. The packed game served by the board server gives the same counts.
- **The field kit.** The drone adds 1 call parked and 4 to 6 flying (kit mesh, rings, flight
  plan, shadow, the osprey; the landing's drop line 1 more), 34 to 49 calls over a whole
  flight; the scanner 3 carried and 4 to 7 set down or scanning, its cloud 1 however many
  scans; the rover 3 walking and 5 at the fix. The aerial photo's longest frame is about 3 to
  10 ms once warm (the readback over 3 frames, the JPEG off the main thread).
- **Other costs.** The effects add 0 to 4 calls and the opening at most 3 (the scattered kit,
  the mess, the ibis). James is 2 calls; stakes, flags, loggers, perch loggers and job markers
  are one instanced mesh each. The drawn-shade test behind `sunExposure` costs 1.5 to 2.6 µs a
  ray (24 rays a frame while the sun moves). A logger download (19 by 19 samples, two sun rays
  each) takes 3 to 5 ms once, and a minimap redraw with every patch showing about 0.4 ms. The
  practice lizard's pick takes about 40 ms once.
- **Garbage once warm** (Chrome's precise memory counter): the anole renderer about 15 B a
  frame, the lizards 0.2 to 1 KB (about 1.7 KB while the sky moves), the crocodiles about
  0.1 KB, the effects 0.1 to 0.2 KB, the sky's re-blend under 0.1 KB, the sound about 40 B a
  call, the drone's flight about 1.75 KB, the scanner about 48 B idle and nothing while
  casting, the rover about 95 B, the perch loggers about 29 B a call. The lock-on, the
  loggers' per-frame loops and the opening's cameras allocate nothing.

**Does the map point at the lizards?** With every logger downloaded and the clock stopped, the
player stands 3.5 m from each logger in turn and the lizards are counted by the patch they sit
in. At 08:35 the warm patches hold 74 basking lizards and 91 displays, the cool ones 5 and 32,
on about the same area; at 12:50 nothing basks and, cell for cell, the cool patches hold about
2.8 times the lizards out on their perches; at 16:50 the warm patches hold 74 basking and 116
displays, the cool ones 3 and 34. `check/loggers_thermal_counts.png` draws the counts.

**How long the opening takes**, in game seconds from Start to the survey day running: a player
who jogs and presses straight on about 140 s; a new player reading every line at 20 characters a
second (about 79 s of reading over 19 boxes), heading for the map's circles and running between
pieces about 232 s (3.9 minutes); the same player walking everywhere about 294 s (4.9 minutes).
The walking is about 280 m, most of it the osprey pole's leg out and home.

**The pack** (`python3 tools/package.py`): `dist/field-season` is about 110 files and 4.8 MB,
with every import and page reference inside it.
