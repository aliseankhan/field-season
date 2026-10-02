// Everything James (and Jon) says, in one place, so the lab can edit their lines without
// touching the game. {name} is the player's name; other {words} are filled in
// where the line is used (they are listed beside each one). A list of strings is
// said one after another; a list of lists is a pool, one picked at a time.
// Keep lines short, cheerful and in British spelling.

export const JAMES = { name: 'James', role: 'Lead scientist' };
// Jon, from the lab (src/story/jon.js): his lines are SCRIPT.jon.
export const JON = { name: 'Jon', role: 'Lab member' };

export const SCRIPT = {
  // The intro: James walks up to the field station, which the ibises raided overnight.
  intro: [
    'Oh, hello! Welcome to Lizard Island!',
    'Excuse the mess. The ibises raided the station overnight!',
    "I'm James, the lab's lead scientist. We've caught and released every lizard on this island for about ten years.",
    'We even have a lidar map that records every branch on the island in 3D.',
    'Some lizards wear tiny sensor backpacks. Each one weighs just 0.06 g, about two grains of rice!',
    'And our microclimate sensors log the temperature all over the island.',
  ],
  askName: 'First things first, what\'s your name?',
  namePlaceholder: 'Your name',
  nameFallback: 'Sam',
  greetName: 'Lovely to meet you, {name}!', // (in one box with askHat)
  askHat: 'Let\'s kit you out. Which hat colour do you fancy?',
  askShirt: 'Great choice! And your shirt?',
  looksDone: 'Looking the part, {name}!',

  // The opening, the same morning as the survey: find the kit the ibises
  // scattered (src/story/kit_hunt.js), put the station right, tie a fresh loop, then a
  // practice catch. Radio lines are said over James's radio, from wherever you are.
  opening: {
    hunt: [
      'Those ibises scattered our kit all over the island: the loop pole, the field notebook, the bags, the ruler and scales, and the paint pens.',
      'Look for the sparkles! Your map shows roughly where each one went. Onwards!',
    ],
    // an old save from the middle of the old set-up day, on Continue
    resume: [
      'Welcome back, {name}! The ibises raided the station again overnight.',
      'Can you find the kit? Your map shows roughly where it went.',
    ],
    // over the radio after the first two finds other than the notebook (toasts; {n} found
    // so far, {left} still to find)
    radio: [
      'Lovely! {left} more to find. Keep an eye out for the sparkles, {name}.',
      'That\'s {n} down, {left} to go. You\'re a natural!',
    ],
    // pressing N before the notebook is found
    noNotebook: 'Your notebook is still out there somewhere. Look for the sparkles!',
    // after the fourth find, over the radio, as the camera watches the ibis fly in and land
    ibis: [
      'Just the paint pens left... and an ibis has got them!',
      'Hold Ctrl and creep up on it slowly, or it\'ll flap off.',
    ],
    // (not James: what the ibis does, as toasts)
    ibisFlutter: 'The ibis flaps off. Too quick! Hold [Ctrl] and creep up on it.',
    ibisDropped: 'The ibis drops the pens and stalks off, very indignant.',
    ibisGaveUp: 'The ibis gives up, drops the pens and stalks off in a huff.',
    // all five found, over the radio (a toast, as you set off home)
    allFound: [
      'That\'s everything! Brilliant, {name}. Bring it all back to the station.',
    ],
    // at the station once the table is up and the kit is back on it
    station: [
      'That\'s more like it! Now your pole needs a fresh loop of dental floss. Trace round the loop, nice and steady.',
    ],
    flossRetry: 'Nearly! Have another go, nice and smooth.',
    // (said at the start of the practice line that follows)
    flossDone: 'Perfect loop!',
    // the practice catch, at the station or over the radio (he walks up the causeway while
    // you tie the loop): where it is (the gold marker leads the way)
    practice: [
      'Now let\'s try it on a real lizard. I\'ll meet you by a crested anole at the causeway fork. Follow the gold marker.',
    ],
    // as you get there, while the camera shows it on its trunk
    practiceHere: 'There it is! Hold Ctrl and creep in slowly, and don\'t run at it.',
    // his word at each step of the practice catch (toasts, one at a time; the snug ring
    // says its own)
    steps: {
      near: 'Nice and slow. If it looks at you, freeze till it relaxes.',
      reach: 'Close enough! Hold F or right mouse to raise the loop pole.',
      aim: 'The loop finds its head by itself. Press E or click to slip it on!',
      bag: 'Into the bag! Have a good look at it.',
      ruler: 'Snout to vent: that\'s how we measure them.',
      paint: 'A dab of paint, so we know it\'s been caught today.',
      fled: 'Whoa, too quick! It\'ll pop back out in a moment. Creep this time!',
    },
    practiceNone: 'The lizards are shy just now. You\'ll get your chance on the survey!',
    // the wrap-up: this line, the day's requests, then survey.morningEnd ("Onwards!")
    done: [
      'Lovely catch, {name}! Survey day starts right now.',
    ],
    // in the wrap-up, after his word on the sun: what the flags and loggers are for
    loggers: 'See the flags? Each one has a temperature logger. Walk past one to download it, and your map shows where it\'s warm and where it\'s cool.',
    // a word over the radio the first time a crocodile is on screen in the opening (or,
    // straight on from it, on that survey day)
    croc: 'That\'s our crocodile. Give it lots of room!',
    // said when you talk to James mid-opening
    nudge: {
      hunt: 'Look for the sparkles! Your map shows roughly where the kit went.',
      ibis: 'Creep up on that ibis, nice and slow.',
      station: 'Pop the table back up and we\'ll get going.',
      floss: 'Let\'s tie that fresh loop on your pole.',
      practice: 'Follow the gold marker to the crested anole, then creep in slowly.',
    },
  },

  // The kit hunt's words that are not James's: the prompt, the pop-up card for each piece
  // (what it is for, in one line) and the maps' labels.
  hunt: {
    pickPrompt: '[E] Pick up the *{item}*',
    tablePrompt: '[E] Set the *table* upright',
    foundTitle: 'Found {n} of {total}',
    ibisLabel: 'Ibis!',
    items: {
      loop_pole: { name: 'Loop pole', phrase: 'loop pole', line: 'A bamboo pole with a floss loop, for catching lizards. It\'s in your hands now.' },
      notebook: { name: 'Field notebook', phrase: 'field notebook', line: 'Every lizard you catch goes in here.' },
      bags: { name: 'Lizard bags', phrase: 'lizard bags', line: 'Clear bags, to hold a lizard up to the light for a proper look.' },
      scales: { name: 'Ruler and scales', phrase: 'ruler and scales', line: 'To measure each lizard from snout to vent.' },
      pens: { name: 'Paint pens', phrase: 'paint pens', line: 'A dab of paint shows a lizard has been caught today.' },
    },
  },

  // The survey day.
  survey: {
    morning: [
      'Morning, {name}! It\'s survey day.',
      'Catch, measure, mark and release. Fit backpacks on the big adults, and walk past the loggers on the flags to download them.',
      'Hold Ctrl to creep. If one looks at you, freeze till it relaxes.',
      'Keep an eye on the water. The crocodile doesn\'t like visitors!',
    ],
    // after the morning lines: {list} is the day's requests, joined up
    requests: 'I\'ve got a few requests for today: {list}.',
    // for a new player, as the camera glances at a crested anole near the start
    firstLizard: 'Look, a crested anole, just over there! I\'ve marked it in gold. Creep up and make it your first catch.',
    // the same, when the one he points out is basking in the sun
    firstLizardSun: 'Look, a crested anole basking in the sun, just over there! I\'ve marked it in gold. Creep up and make it your first catch.',
    morningEnd: 'The day ends at half past six. Onwards!',
    // when you talk to him: {label}, {n}, {goal}
    requestLeft: 'Still on my list: {label}. That\'s {n} of {goal} so far.',
    requestsAllDone: 'You\'ve done all my requests today. Legend!',
    // one pool picked at random when you talk to him
    cheers: [
      ['You\'re doing great, {name}!'],
      ['Creep up slowly and they won\'t even notice you.'],
      ['Catch one mid head bob and I\'ll be very impressed.'],
      ['Have you checked your notebook? Press N to have a look.'],
      ['Every lizard goes back to its own perch, just where we found it.'],
      ['Tape a perch height with the tape measure before you catch. Proper records!'],
      ['Tagged lizards log GPS fixes all day. Walk near one with the GPS case to download them.'],
      ['Two lizards in reach? Press Tab while you aim to swap which one the loop goes for.'],
      ['Anoles warm up in the sun. First thing, look for them basking where the light hits the trunks.'],
      ['In the heat of the day they hide in the shade. Shady lizards are calmer, but harder to spot!'],
      ['Warm patches on your map are where the lizards bask first thing. At midday, try the cool ones.'],
      ['Every flag has a temperature logger. Walk past one and it downloads by itself.'],
      ['Clip a perch logger as you let a lizard go, then walk past later. You get its whole day!'],
    ],
    // in the morning talk, after the requests: the day's sun rule (a day started in the
    // heat or late on uses sun.midday or sun.afternoon instead)
    sunBrief: 'It\'s cool first thing, so look for lizards basking in the sunny spots. When it gets hot around midday, they hide in the shade.',
    // a word from James as the heat of the day comes and goes (the lizards' warmth
    // passing one half), once each a day
    heat: {
      on: 'Phew, it\'s *warming up*! Try the *shady side* of the trunks.',
      off: 'It\'s *cooling off*. The lizards are coming back out to *bask*!',
    },
    // about the sun, by the time of day (species.js thermalPhase: morning, midday, afternoon)
    sun: {
      morning: 'It\'s still cool, so they\'re out basking in the sunny spots. They show off most in the morning, too!',
      midday: 'Phew, it\'s hot! The lizards slip into the shade at midday. Try the shady side of the trunks.',
      afternoon: 'The heat\'s easing off, so the lizards are coming back out to bask in the late sun.',
    },
    // the notebook's "Best time" line on each species page
    bestTime: {
      crested: 'Mornings and late afternoon, basking on sunny trunks.',
      brown: 'Mornings, low down in the sun. It copes with the heat best.',
      green: 'Mornings, out on sunny leaves. First into the shade as it warms up.',
      bark: 'Mornings, in the dappled light on the trunks.',
      knight: 'Mornings, basking high in the big trees.',
      croc: 'Basking on sunny banks, morning and late afternoon.',
      basilisk: 'All day, out in the sun on open ground by the water.',
    },
    // hints for a species task that is still open: {species}
    tips: {
      crested: 'Crested anoles are everywhere. Try the trunks round the lawn.',
      brown: 'Watch the ground round the trunks and creep in low. Catch three down there!',
      green: 'Green anoles sit on trunks and branches, and now and then out on the leaves. Look carefully!',
      bark: 'Bark anoles are very rare here. Check the trunks slowly and creep right in.',
      knight: 'Look up into the big trees and spot one high in the canopy first.',
      croc: 'The crocodile is out there somewhere. Spot it, but keep your distance!',
      basilisk: 'Brown basilisks rest on the ground by the water. Startle one and it runs right across the lake!',
    },
    // on the radio the first time you see a basilisk run across the water
    basiliskRun: 'That\'s why the anoles stay off the ground.',
    backpacksLeft: 'You\'ve got {n} backpacks left today. Save them for the big adults.',
    noBackpacks: 'That\'s all the backpacks for today. Nice tagging!',
    loggersDue: 'Some loggers are due a fresh download. Just walk past them, and your map shows where it\'s warm and cool.',
    // the temperature loggers (src/tools/loggers.js): each download colours its patch of
    // the map warm (sunny) or cool (shady) for the hour, and the patch fades as it goes stale
    loggers: {
      // the toast as one downloads: {id}, {celsius}, {words} (by the patch: warm, cool or mixed)
      toast: 'Logger *{id}*: {celsius} °C. {words}',
      kind: {
        warm: 'Warm and sunny round here.',
        cool: 'Cool and shady round here.',
        mixed: 'Dappled sun and shade round here.',
      },
      // from James with the day's first download, by the sun's phase and that patch's
      // colour (warm, cool or mixed); the map draws warm orange and cool blue
      first: {
        morning: {
          warm: 'Lovely, that\'s on your map! Orange means sun. On a cool morning that\'s where the lizards bask, and they show off more there.',
          cool: 'Lovely, that\'s on your map! Blue means shade. They won\'t be basking here this early. Look for the orange bits!',
          mixed: 'Lovely, that\'s on your map! Orange is sun and blue is shade. This early, the lizards bask in the orange bits.',
        },
        midday: {
          warm: 'Lovely, that\'s on your map! Orange means full sun, and that\'s too hot for them now. They sit in the blue, shady bits.',
          cool: 'Lovely, that\'s on your map! Blue means shade. In this heat, that\'s where the lizards sit it out.',
          mixed: 'Lovely, that\'s on your map! Orange is sun and blue is shade. In this heat the lizards sit in the blue bits.',
        },
        afternoon: {
          warm: 'Lovely, that\'s on your map! Orange means sun. As it cools off, the lizards come back out to bask there.',
          cool: 'Lovely, that\'s on your map! Blue means shade. As it cools off, they head for the orange bits to bask.',
          mixed: 'Lovely, that\'s on your map! Orange is sun and blue is shade. As it cools off, they bask in the orange bits.',
        },
      },
      // a word as you walk into a fresh patch of the colour that matters now (warm in the
      // cool hours, cool in the heat), once a day for each phase
      enter: {
        morning: 'Warm patch! Lizards bask here in the morning and show off more. Watch for a display bonus.',
        midday: 'Cool patch. In the midday heat, this is where the lizards sit it out.',
        afternoon: 'Warm patch! The lizards come back out to bask here. Watch for a display bonus.',
      },
      // the notebook's logger page
      page: 'In the morning and late afternoon, lizards bask in the warm patches and show off more there. At midday they sit out the heat in the cool ones. Readings go stale after a few hours, so pass by again later.',
    },
    lastHour: 'Nearly time to pack up, {name}!',
    // on the radio after a good run of catches, towards a field job not done yet today
    // (flow.js, RULES.kitNudge): one line per job, the catching first, never a telling-off
    kitNudge: {
      tls: 'Cracking haul, {name}! When you fancy a change, the laser scanner\'s set up and ready. Pop by the station. No rush.',
      drone: 'Loads of lizards today! The drone\'s charged if you want a go at the survey later. It\'s at the station.',
      rtk: 'Lovely catching, {name}! If you fancy a break from lizards, the RTK rover\'s at the station for the plant survey.',
      loggers: 'Brilliant run of lizards! When you\'re passing, walk by a flag and its temperature logger downloads by itself. Nearest one\'s on your map.',
    },
    crocSnap: [
      ['Yikes! Give that crocodile some room.'],
      ['Ooh, close one! Stay back from the water\'s edge.'],
    ],
  },

  // The end of the day at the field station, banded on the day's catches, species and
  // requests (RULES.summaryBands): {score}
  summary: {
    great: 'What a day, {name}! The lab will be talking about this one.',
    good: 'Brilliant work, {name}. The notebook is filling up nicely.',
    ok: 'A solid day in the field. Every record counts!',
    quiet: 'A quiet one, but that\'s field work. Tomorrow\'s another day!',
    best: 'A new best score, too!',
    requests: 'And every one of my requests. Thank you!',
    // the field kit's jobs done today: a day of nothing else, or on top of the band's line
    kitDay: 'A field kit day! The lab will love all that new data, {name}.',
    kit: 'Lovely work with the field kit as well.',
  },

  // The field kit's missions (src/missions): James offers them as requests on
  // the survey day. Each brief ends with his send-off. A mission's `done` lines go by
  // stars, one to three; one of them may be one line per reason ({ named, steady }, the
  // `why` the mission sends), said as a toast once its card has closed.
  missions: {
    // in the morning talk, after the requests
    morning: 'And if you fancy a change, ask me about the field kit: the drone, the laser scanner and the plant survey.',
    // when you talk to him with a job to hand out; the choices name the jobs (offerAgain
    // once you have said "Just a chat" to one today)
    offer: 'Fancy a job with the field kit?',
    offerAgain: 'Still fancy a job with the field kit?',
    choices: { drone: 'Drone survey', tls: 'Laser scans', rtk: 'Plant survey', chat: 'Just a chat' },
    // one under way when you talk to him (a mission's own \`active\` line comes first): {title}, {n}, {goal}
    active: 'How\'s the {title} going? {n} of {goal} so far.',
    allDone: 'All the field kit\'s had a run today. The lab will be thrilled!',
    // a mission's tool taken out without asking him first (said as a toast): {title}
    selfStart: 'Oh, you\'ve got the {title} kit!',
    drone: {
      brief: [
        'The drone! Last October we flew it over the whole island at 150 feet and stitched the photos into one big map.',
        'Here\'s the controller. Stand by the pad and up it goes! Fly it through the glowing rings, then bring it back for a soft landing.',
        'Keep an eye on the battery, and mind the tall trees. The osprey won\'t be amused!',
      ],
      // by stars, one to three (a toast from James when it lands)
      done: [
        'Home safe, and that\'s a map! Every photo helps.',
        'Lovely flying, {name}! That photo\'s going on the lab wall.',
        'Perfect survey, perfect landing. Top flying!',
      ],
      // by why it failed: the lake, or the battery ran down before the map was done
      // taken on but not up yet when you talk to him
      active: 'The drone\'s waiting on its pad by the station.',
      fail: {
        water: 'Oops! Never mind, we\'ll dry it off. Have another go.',
        battery: 'The battery gave out before the map was done. I\'ll pop in a fresh one: have another go!',
      },
    },
    tls: {
      brief: [
        'The laser scanner! Last October we scanned the island from 88 spots, millions of points in 3D.',
        'Carry it to a marked spot, set it down and get it level. Then keep out of its sight while it spins.',
        'Anyone it sees ends up in the scan, and we have to clean them out afterwards! Three scans, please.',
      ],
      done: [
        'Three scans in the bag! A few ghosts to clean up, but that\'s field work.',
        'Lovely scans, {name}! Only a ghost or two to tidy up.',
        'Not a ghost in sight. Perfect scanning!',
      ],
      active: 'How are the scans going? {n} of {goal} so far.',
      fail: 'Never mind, set it up and we\'ll scan again.',
    },
    rtk: {
      brief: [
        'The plant survey! In June we recorded 317 plants on this island with the RTK rover.',
        'It\'s a GPS antenna on a 2 m pole. Once it has a fix, it knows where it is to a couple of centimetres.',
        'I\'ve ringed five plants in gold, all in one patch. Stand the pole by each and hold still till the phone says FIX, then log what it is.',
        'Mind the mosquitoes!',
      ],
      // (two stars by what earned the second: the names, or a steady pole)
      done: [
        'Five plants on the map! Every record counts.',
        { named: 'Lovely survey, {name}. You know your plants!', steady: 'Rock-steady pole, {name}! The names will come.' },
        'A perfect plant survey! Proper botanist stuff.',
      ],
      active: 'How\'s the plant survey going? {n} of {goal} so far.',
      fail: 'No harm done. The plants aren\'t going anywhere!',
    },
  },

  // The perch loggers (src/tools/perch_loggers.js): button loggers clipped on a released
  // lizard's perch, three a day. `intro` is said once, the first time a lizard goes home on
  // a survey day, face to face or over the radio, just before the clip card; it ends with
  // his send-off. The others are toasts once the day card closes: the first download
  // ever, and a lizard followed from before 10:00 to after 16:00 (once a day, then the
  // short one by name).
  perch: {
    intro: [
      'Ooh, before it goes home! See the little button loggers in your kit?',
      'Each one\'s a tiny thermometer. Clip it on the perch, right where it sat, and it logs the temperature that lizard actually lives in.',
      'Walk past later and it downloads by itself, with the lizard\'s whole day on it. Three a day.',
    ],
    firstDownload: 'That\'s a lizard\'s-eye view of the day! Its life story is in your notebook, {name}.',
    wholeDay: 'A whole day of one lizard\'s life, morning to evening. That\'s proper science, {name}!',
    // a second or third whole day on the same survey day ({nick}: the lizard's nickname)
    wholeDayAgain: '{nick} too! Another whole lizard day in the notebook.',
    // the notebook's "Followed lizards" page (not said aloud)
    page: 'Clip a button logger on a lizard\'s perch as you let it go, three a day. Walk past later and it downloads by itself: the perch\'s temperature, and what the lizard did all day.',
  },

  // Loops that snap and poles that break (src/catch/breaks.js), on the survey day. The lab
  // rule: the first pole broken, of any kind, is free (he says so over the radio and a new
  // one is in your hands). After that you walk back to him for one, and what he says
  // depends on how it broke: up in the canopy mid-catch is fine, stubbing it is not.
  breaks: {
    free: 'First one\'s free. That\'s the rule.',
    replace: {
      canopy: 'In the canopy, mid-catch? That\'s the good way to break a pole.',
      careless: 'Stubbed it on the ground, didn\'t you? Time to start thinking about your own abilities.',
    },
    // what the talk prompt says while you have no pole
    askPrompt: '[E] Ask *James* for a new pole',
    // (not James: what happens, as toasts and the hint)
    fray: 'The floss is fraying!',
    snapped: 'Oh no, your loop has *snapped*!',
    // the tool badge until it is re-tied
    toolSnapped: 'Loop snapped',
    retieHow: 'Re-tie it before you loop again.',
    retiePrompt: '[E] Re-tie the *floss loop*',
    retied: 'Fresh loop on. Back to it!',
    tangle: 'The pole\'s tangled in the branches!',
    creak: 'Creak! Careful with that pole!',
    stub: 'Thwack! Mind the pole.',
    canopyBreak: 'Crack! The pole broke up in the branches.',
    carelessBreak: 'Crack! The pole broke in half.',
    newPole: 'A new pole is in your hands.',
    goToJames: 'No pole. Walk back to James at the field station for a new one.',
    toolLine: 'Pole broken: James has a spare',
  },

  // Jon, from the lab (src/story/jon.js), on the survey day. He just appears: nobody sees
  // him arrive, and he is gone when you look back. Friendly and low-key. Every visit opens
  // with hello (and the first one with meet as well), then the visit's own lines.
  jon: {
    hello: 'Oh, hey.',
    meet: 'Oh, hey. I\'m Jon, from the lab. Didn\'t mean to make you jump.',
    // the season's first snapped loop: he re-ties it, once (the loop goes back on with the
    // second line)
    retie: [
      'Snapped? Give it here.',
      'Over, under, through, snug. There you go.',
      'Just the once, mind. Next one\'s yours.',
    ],
    // the first lock-on to each species: one short hint
    hints: {
      knight: 'Knights gape before they bite. If it opens its mouth at you, give it a moment.',
      bark: 'Bark anoles go flat before they bolt. If it presses down on the bark, it\'s about to go.',
      green: 'Greens like the leaves. Look out along the leafy branches, not just the trunks.',
      brown: 'Browns stay low. Watch the ground and the bottom of the trunks.',
      crested: 'Crested go round the trunk. If it slips round the back, step round slowly with it.',
      basilisk: 'A basilisk! It\'ll make a dash for the lake. Get between it and the water.',
    },
    // the same hints, short, as a note with his portrait when he cannot come
    notes: {
      knight: 'Knights gape before they bite. Ease off.',
      bark: 'Bark anoles go flat before they bolt.',
      green: 'Greens like the leaves. Look along the leafy branches.',
      brown: 'Browns stay low. Watch the ground.',
      crested: 'Crested slip round the trunk. Step round slowly.',
      basilisk: 'A basilisk makes for the water. Get between it and the lake.',
    },
    // a long while with no catch (once a day): sun and shade by the time of day
    // (species.js thermalPhase: morning, midday, afternoon)
    nudge: {
      morning: 'Quiet one? They\'re still warming up. Try the trunks where the sun hits.',
      midday: 'Bit slow? It\'s too hot out in the open now. Try the shady side of the big trees.',
      afternoon: 'Slow going? It\'s cooling off, so they\'re back out in the late sun. Try the sunny trunks.',
    },
    // all five GPS backpacks fitted: two spares, once that day ({n}: how many, in words; the second line
    // goes with them)
    spares: [
      'All five backpacks on already? Nice work.',
      'Here, {n} spares. Same as mine. It\'s how I always know where you are.',
    ],
    // (not Jon: the toast as the spares go in your bag)
    sparesToast: '+{n} GPS backpacks from Jon',
    // the spares as a note, when he cannot come ({n} in words)
    sparesNote: 'All five on already? I\'ve left {n} spares in your case.',
    // as a GPS backpack is about to go on, when today's are piling up on one species or in
    // one part of the island (once per species and per area a day). species: {species} is
    // this one, {others} the ones that would tell us more (anyOther when every species has
    // one); area: {here} and {there} by the part of the island (mid is round the lawn).
    // Then the choice, letting it go the default.
    steer: {
      species: 'Another {species}? We\'ve got loads of those on the go. {others} would tell us more.',
      basilisk: 'Another basilisk? We\'ve got {n} on the go already, and there are only eleven. {others} would tell us more.',
      anyOther: 'A different species',
      area: 'These are all from {here}. {there} would give us a better spread.',
      here: { mid: 'round the lawn', north: 'the north end', south: 'the south end', east: 'the east side', west: 'the west side' },
      there: { mid: 'somewhere out by the shore', north: 'the south end', south: 'the north end', east: 'the west side', west: 'the east side' },
      letGo: 'Let it go',
      fit: 'Fit it anyway',
      // who the word is from when it comes as a note
      noteFrom: 'Note from Jon',
    },
  },

  // His catchphrase. Kept for the two big send-offs only (the start of the kit hunt and
  // the start of the survey day), so it stays a treat.
  onwards: 'Onwards!',

  // What the talk prompt says.
  talkPrompt: '[E] Talk to *James*',

  // The cards between the days, and the end-of-day note (not James's lines).
  cards: {
    surveyTitle: 'Survey day',
    surveySub: 'The next morning, 07:30',
    endTitle: 'End of the day',
    endSub: '18:30, back at the field station',
    endToast: 'That\'s the end of the day! Back to the field station.',
  },
};

// Fills {name} and any other {words} in a line.
export function say(line, vars = {}) {
  return String(line).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// One line from a pool (a list of lists), or the line itself.
export function pick(pool, rng = Math.random) {
  if (!Array.isArray(pool)) return pool;
  const item = pool[Math.floor(rng() * pool.length) % pool.length];
  return Array.isArray(item) ? item[0] : item;
}
