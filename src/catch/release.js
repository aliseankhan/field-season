// Catch and release, as the lab does it: into a clear bag held up to the light, the
// snout-vent length with a ruler slide, a dab of paint pen, a GPS backpack for an
// adult big enough to carry one (about five a day, settled between the shoulders with
// steady hands), a note of the perch (its type and rounded height, from the lizard
// itself), on the survey day a perch logger clipped where it sat if you like (one press;
// src/tools/perch_loggers.js makes the offer), and back onto its perch. Each step is a
// short card through the UI kit's minigame(); Esc on any card lets the lizard go
// straight away (on the perch logger's card: not this time).
//
// The cards are factories of kit mini-game specs, so they also open on their own
// (registerCards: ?open=minigame:bag and so on) with a stand-in lizard.

import { CATCH, SPECIES_NAMES, PERCH_WORDS } from './tuning.js';
import { anoleSide, anoleTop, bagScene, rulerStrip } from './drawings.js';

const OUT = '#3a2f2a';

// Where the lizard in hand was caught, for the perch card's "Where" line ("by C07"):
// src/tools/flags.js sets it (the grid flag nearest its perch). c.where wins if given.
let placeOf = null;
export function setCatchPlace(fn) { placeOf = typeof fn === 'function' ? fn : null; }
function whereText(c) {
  if (c.where) return c.where;
  try { return placeOf ? placeOf(c) : null; } catch (e) { return null; }
}
// The perch logger's offer for the lizard in hand (src/tools/perch_loggers.js sets it):
// offerFor(c) -> null, or { art (the drawing, with its .pl-coin, .pl-spot and .pl-burst),
// tray, spot (where the coin starts and lands, in the drawing's units), kindWord, kindTone,
// heightWord, leftWord, instructions, intro() (James's word, once; a Promise), clip()
// (puts it on the perch), onClipStart() (its click) }
let perchOffer = null;
export function setPerchLogger(fn) { perchOffer = typeof fn === 'function' ? fn : null; }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sexWord = (sex) => (sex === 'm' ? 'male' : sex === 'f' ? 'female' : '');
const DISPLAY_WORDS = { headbob: 'head bob', pushup: 'push-up', dewlap: 'dewlap' };

// A plain description of the lizard in hand, for the cards.
//   { sp, sex, perch (the recorded class), perchSeen (what it sat on, as a class),
//     height (m, to the half metre), taped (the height was taped before the catch),
//     svl (true, mm), display, chips: [[text, tone]], mark, packColour, packsLeft,
//     canPack, tracked, recapture, practice, quick (a bag card that moves on by itself),
//     auto, nickname }
export function standIn(sp = 'cristatellus') {
  const svl = CATCH.svl[sp] || CATCH.svl.cristatellus;
  return {
    sp, sex: 'm', perch: 'trunk', perchSeen: 'trunk', height: 1.5, taped: true, svl: Math.round((svl.m[0] + svl.m[1]) / 2), display: null,
    chips: [['Held up to the light', 'info']], mark: '#ff4fa3', packColour: '#3ec7ff', packsLeft: 5, canPack: true,
    tracked: null, recapture: false, practice: false, quick: false, auto: null, nickname: 'Pip',
  };
}

function svgPoint(svg, e) {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return p;
}

// ---------------------------------------------------------------- 1. the bag

export function bagCard(c) {
  const name = SPECIES_NAMES[c.sp].common;
  const sw = sexWord(c.sex);
  const title = c.practice ? 'Practice catch!' : c.recapture ? 'A recapture!' : 'Into the bag!';
  const instructions = c.practice ? `A *${name}*! Up to the light for a proper look.`
    : `A ${sw ? sw + ' ' : ''}*${name}*! Up to the light for a proper look.`;
  return {
    name: 'bag', title, icon: 'bag', card: 'catch-card',
    instructions,
    width: '30em', height: '17.5em',
    foot: '[E] next · [Esc] let it go now',
    mount(stage, api) {
      stage.classList.add('catch-stage');
      const chips = c.chips.map(([t, tone]) => `<span class="catch-chip tone-${tone || 'info'}">${esc(t)}</span>`).join('');
      const label = c.recapture ? 'Let it go' : 'Measure it';
      stage.innerHTML = `<div class="catch-bag-wrap">${bagScene(c.sp, { sex: c.sex, mark: c.recapture ? c.mark : null, pack: c.tracked ? c.packColour : null, dewlap: c.display === 'dewlap' ? 1 : 0 })}</div>
        <div class="catch-chips">${chips}</div>
        <button type="button" class="ui-btn catch-next">${label} <kbd>E</kbd></button>`;
      let t = 0;
      const next = () => { if (t > 0.4) api.done({ success: true, quality: 1, quiet: true }); };
      stage.querySelector('.catch-next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
      return {
        // a repeat of the day's species moves on by itself after a moment
        update(dt) { t += dt; if ((c.auto && t > (c.auto === 'fast' ? 0.6 : 1.4)) || (c.quick && t > 1.2)) next(); },
        onUse: next,
      };
    },
  };
}

// ---------------------------------------------------------------- 2. the ruler

export function rulerCard(c) {
  const big = c.sp === 'equestris';
  const pxmm = big ? 2.0 : 4.3;
  const max = big ? 200 : 90;
  const A = big ? CATCH.ruler.driftKnight : CATCH.ruler.drift; // mm the ruler drifts either side
  const period = CATCH.ruler.period;
  const snoutX = 60, bodyY = 92, rulerY = 146;
  const svl = c.svl;
  const ventX = snoutX + svl * pxmm;
  return {
    name: 'ruler', title: 'Snout-vent length', icon: 'ruler', card: 'catch-card',
    instructions: 'The ruler slides under it. Press [E] or click when the red *0* meets the tip of the snout.',
    width: '32em', height: '14em',
    foot: '[E] or click to read · [Esc] let it go now',
    mount(stage, api) {
      stage.classList.add('catch-stage');
      stage.innerHTML = `<svg class="catch-svg" viewBox="0 0 520 210" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="520" height="210" fill="#eaf6e2"/>
        <path d="M0 178 Q 130 168 260 176 T 520 172 L520 210 L0 210 Z" fill="#cfe8b8"/>
        <g class="catch-ruler-move">${rulerStrip(max, pxmm)}</g>
        ${anoleSide(c.sp, { x: snoutX, y: bodyY, len: svl * pxmm, facing: -1, sex: c.sex })}
        <g class="catch-vent"><line x1="${ventX.toFixed(1)}" y1="${bodyY + 8}" x2="${ventX.toFixed(1)}" y2="${rulerY}" stroke="${OUT}" stroke-width="1.6" stroke-dasharray="3 3"/>
          <circle cx="${ventX.toFixed(1)}" cy="${bodyY + 8}" r="4" fill="#fff" stroke="${OUT}" stroke-width="1.8"/>
          <text x="${(ventX + 8).toFixed(1)}" y="${rulerY - 6}" class="catch-small">vent</text></g>
        <g class="catch-snout"><line x1="${snoutX}" y1="${bodyY - 34}" x2="${snoutX}" y2="${rulerY + 30}" stroke="#e8504a" stroke-width="1.8" stroke-dasharray="4 4" opacity="0.6"/>
          <text x="${snoutX - 6}" y="${bodyY - 38}" text-anchor="start" class="catch-small">snout</text></g>
        <g class="catch-reading" opacity="0"><rect x="${(ventX - 40).toFixed(1)}" y="${bodyY - 70}" width="80" height="28" rx="14" fill="${OUT}"/>
          <text x="${ventX.toFixed(1)}" y="${bodyY - 51}" text-anchor="middle" fill="#fff" class="catch-reading-text">0 mm</text></g>
      </svg>`;
      const svg = stage.querySelector('svg');
      const move = svg.querySelector('.catch-ruler-move');
      const reading = svg.querySelector('.catch-reading');
      const readingText = svg.querySelector('.catch-reading-text');
      let t = 0, e = A, stopped = false, lastE = null, prevE = null;
      const place = () => {
        if (lastE !== null && Math.abs(e - lastE) < 0.02) return;
        lastE = e;
        move.setAttribute('transform', `translate(${(snoutX + e * pxmm).toFixed(1)} ${rulerY})`);
      };
      place();
      const read = () => {
        if (stopped || t < 0.3) return;
        stopped = true;
        const measured = Math.round(svl - e);
        const off = Math.abs(e);
        readingText.textContent = measured + ' mm';
        reading.setAttribute('opacity', '1');
        const quality = Math.max(0, 1 - off / 8);
        if (api.game) api.game.events.emit('card:act', 'ruler', quality); // the ruler's click (src/audio)
        const label = off <= CATCH.ruler.spotOn ? 'Spot on!' : off <= 5 ? 'Close enough!' : 'A bit wonky!';
        const fast = c.auto === 'fast';
        setTimeout(() => api.done({ success: true, quality, svl: measured, off, label, hold: fast ? 350 : 1100 }), fast ? 150 : 650);
      };
      stage.addEventListener('pointerdown', read);
      return {
        update(dt) {
          if (stopped) return;
          t += dt;
          e = A * Math.cos((t / period) * Math.PI * 2);
          place();
          if (c.auto && t > period * 0.2) {
            // press as the zero passes the snout (frames can step over a narrow window)
            if (Math.abs(e) <= 0.6 || (prevE !== null && Math.sign(e) !== Math.sign(prevE))) { e = 0.3; read(); }
          }
          prevE = e;
        },
        onUse: read,
      };
    },
  };
}

// ---------------------------------------------------------------- 3. the paint pen

export function paintCard(c) {
  const len = c.sp === 'equestris' ? 150 : 190;
  const s = len / 100;
  const cx = 300, cy = 112; // the vent, in the stage's units
  const tgt = { x: cx - 30 * s, y: cy }; // the mid back (anoleTop's y -30), turned to lie left
  const R = CATCH.paint.target;
  return {
    name: 'paint', title: 'A dab of paint', icon: 'paint', card: 'catch-card',
    instructions: 'Dab today\'s colour in the circle on its back. It wriggles! Press [E] or click when the pen is over the circle.',
    width: '32em', height: '14.5em',
    foot: '[E] or click to dab · [Esc] let it go now',
    mount(stage, api) {
      stage.classList.add('catch-stage');
      stage.innerHTML = `<svg class="catch-svg" viewBox="0 0 520 220" xmlns="http://www.w3.org/2000/svg">
        <rect width="520" height="220" fill="#fdf3dc"/>
        <rect x="40" y="26" width="440" height="170" rx="24" fill="#f1e2bf" stroke="#e5cf9f" stroke-width="3"/>
        <g class="catch-body"><g transform="translate(${cx} ${cy}) rotate(-90)">${anoleTop(c.sp, { x: 0, y: -100 * s, len, sex: c.sex })}</g>
          <circle class="catch-target" cx="${tgt.x}" cy="${tgt.y}" r="${R}"/><g class="catch-dabs"></g></g>
        <g class="catch-pen"><path d="M0 0 L10 -14 L64 -54 L74 -44 L20 4 Z" fill="${c.mark}" stroke="${OUT}" stroke-width="2.4" stroke-linejoin="round"/>
          <path d="M44 -39 L64 -54 L74 -44 L54 -29 Z" fill="#fff8e6" stroke="${OUT}" stroke-width="2"/><circle r="4.4" fill="${c.mark}" stroke="${OUT}" stroke-width="1.6"/></g>
      </svg>`;
      const svg = stage.querySelector('svg');
      const body = svg.querySelector('.catch-body');
      const pen = svg.querySelector('.catch-pen');
      const dabs = svg.querySelector('.catch-dabs');
      const cur = { x: 420, y: 60 };
      let usePointer = false, t = 0, done = false, sway = 0, ang = 0, dy = 0;
      stage.addEventListener('pointermove', (e) => {
        const p = svgPoint(svg, e);
        if (p) { cur.x = p.x; cur.y = p.y; usePointer = true; }
      });
      const dab = () => {
        if (done || t < 0.3) return;
        done = true;
        // the pen tip in the body's frame (undo the wriggle)
        const a = -ang * Math.PI / 180;
        const px = cur.x - cx, py = cur.y - dy - cy;
        const lx = cx + px * Math.cos(a) - py * Math.sin(a), ly = cy + px * Math.sin(a) + py * Math.cos(a);
        const d = Math.hypot(lx - tgt.x, ly - tgt.y);
        dabs.innerHTML = `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="6" fill="${c.mark}" stroke="#fff" stroke-width="1.6" class="catch-dab"/>`;
        const inside = d <= R;
        if (api.game) api.game.events.emit('card:act', 'paint', inside); // the dab (src/audio)
        const quality = inside ? Math.max(0.5, 1 - d / (R * 2)) : Math.max(0, 0.45 - (d - R) / 60);
        const label = inside ? (d < R * 0.45 ? 'Perfect dot!' : 'Neat!') : d < R * 2.5 ? 'A bit wonky. It\'ll do!' : 'Oops, a splodge!';
        const fast = c.auto === 'fast';
        setTimeout(() => api.done({ success: true, quality, inside, label, hold: fast ? 300 : 950 }), fast ? 100 : 380);
      };
      stage.addEventListener('pointerdown', (e) => { const p = svgPoint(svg, e); if (p) { cur.x = p.x; cur.y = p.y; } dab(); });
      return {
        update(dt) {
          t += dt;
          if (!done) {
            sway += dt;
            ang = Math.sin(sway * 1.9) * CATCH.paint.wriggle * 0.6 + Math.sin(sway * 4.7) * 1.4;
            dy = Math.sin(sway * 2.6) * 4;
            body.setAttribute('transform', `translate(0 ${dy.toFixed(1)}) rotate(${ang.toFixed(2)} ${cx} ${cy})`);
            if (!usePointer) {
              // no pointer on the card: the pen sweeps back and forth by itself
              cur.x = tgt.x + 88 * Math.sin(t * 1.5);
              cur.y = tgt.y - 4 + 6 * Math.sin(t * 2.3);
            }
            if (c.auto) {
              const a = -ang * Math.PI / 180, px = cur.x - cx, py = cur.y - dy - cy;
              const lx = cx + px * Math.cos(a) - py * Math.sin(a), ly = cy + px * Math.sin(a) + py * Math.cos(a);
              if (t > 0.3 && Math.hypot(lx - tgt.x, ly - tgt.y) < R * 0.5) dab();
            }
          }
          pen.setAttribute('transform', `translate(${cur.x.toFixed(1)} ${cur.y.toFixed(1)})`);
        },
        onUse: dab,
      };
    },
  };
}

// ---------------------------------------------------------------- 4. the GPS backpack

export function packCard(c) {
  const len = c.sp === 'equestris' ? 140 : 180;
  const s = len / 100;
  const cx = 270, cy = 118;
  const tgt = { x: cx - 58 * s, y: cy }; // between the shoulders (anoleTop's y -58)
  const tray = { x: 462, y: 176 };
  const P = CATCH.pack;
  return {
    name: 'backpack', title: 'GPS backpack', icon: 'backpack', card: 'catch-card',
    instructions: 'Big enough for a backpack! Just 0.06 g. Settle it between the shoulders and hold it steady.',
    width: '32em', height: '15em',
    foot: 'Move with the mouse or arrow keys · [Esc] skip',
    mount(stage, api) {
      stage.classList.add('catch-stage');
      stage.innerHTML = `<svg class="catch-svg" viewBox="0 0 520 230" xmlns="http://www.w3.org/2000/svg">
        <rect width="520" height="230" fill="#fdf3dc"/>
        <rect x="30" y="30" width="360" height="170" rx="24" fill="#f1e2bf" stroke="#e5cf9f" stroke-width="3"/>
        <ellipse cx="${tray.x}" cy="${tray.y + 16}" rx="52" ry="16" fill="#e8d3a8" stroke="${OUT}" stroke-width="2.4"/>
        <g class="catch-body"><g transform="translate(${cx} ${cy}) rotate(-90)">${anoleTop(c.sp, { x: 0, y: -100 * s, len, sex: c.sex, mark: c.mark })}</g>
          <rect class="catch-target" x="${(tgt.x - 13).toFixed(1)}" y="${(tgt.y - 11).toFixed(1)}" width="26" height="22" rx="7"/></g>
        <circle class="catch-settle" cx="${tgt.x.toFixed(1)}" cy="${tgt.y.toFixed(1)}" r="24" stroke-dasharray="150.8" stroke-dashoffset="150.8" transform="rotate(-90 ${tgt.x.toFixed(1)} ${tgt.y.toFixed(1)})"/>
        <g class="catch-pack"><path d="M4 0 Q 18 24 44 20" stroke="${OUT}" stroke-width="1.6" fill="none"/>
          <rect x="-12" y="-10" width="24" height="20" rx="6" fill="${c.packColour}" stroke="${OUT}" stroke-width="2.4"/>
          <rect x="-7" y="-6" width="7" height="5" rx="1.6" fill="#fff" opacity="0.85"/></g>
        <g class="catch-steady"><text x="438" y="52" text-anchor="middle" class="catch-small">steady hands</text>
          <rect x="398" y="60" width="80" height="12" rx="6" fill="#fff" stroke="${OUT}" stroke-width="2"/>
          <rect class="catch-steady-bar" x="400" y="62" width="76" height="8" rx="4"/></g>
        <g class="catch-tries"></g>
      </svg>`;
      const svg = stage.querySelector('svg');
      const packEl = svg.querySelector('.catch-pack');
      const body = svg.querySelector('.catch-body');
      const settle = svg.querySelector('.catch-settle');
      const bar = svg.querySelector('.catch-steady-bar');
      const triesEl = svg.querySelector('.catch-tries');
      const cur = { x: tray.x, y: tray.y }, prev = { x: tray.x, y: tray.y };
      let speed = 0, shake = 0, prog = 0, tries = 0, t = 0, done = false, wriggleT = 0, pointer = false;
      const inp = api.input;
      stage.addEventListener('pointermove', (e) => {
        const p = svgPoint(svg, e);
        if (p && wriggleT <= 0) { cur.x = Math.max(10, Math.min(510, p.x)); cur.y = Math.max(10, Math.min(220, p.y)); pointer = true; }
      });
      const drawTries = () => {
        let h = '';
        for (let k = 0; k < P.tries; k++) h += `<circle cx="${40 + k * 18}" cy="214" r="5.5" class="${k < tries ? 'is-used' : ''}"/>`;
        triesEl.innerHTML = h;
      };
      drawTries();
      const finish = (res) => { if (done) return; done = true; if (c.auto === 'fast') res.hold = 300; setTimeout(() => api.done(res), c.auto === 'fast' ? 100 : 420); };
      return {
        update(dt) {
          if (done) return;
          t += dt;
          if (wriggleT > 0) {
            wriggleT -= dt;
            body.setAttribute('transform', `rotate(${(Math.sin(t * 40) * 5 * Math.min(1, wriggleT * 3)).toFixed(2)} ${cx} ${cy})`);
            // the pack flies back to the tray
            cur.x += (tray.x - cur.x) * Math.min(1, dt * 10);
            cur.y += (tray.y - cur.y) * Math.min(1, dt * 10);
            if (wriggleT <= 0) body.removeAttribute('transform');
          } else if (c.auto) {
            // glide over and hold still
            const k = Math.min(1, dt * (c.auto === 'fast' ? 9 : 3.2));
            cur.x += (tgt.x - cur.x) * k; cur.y += (tgt.y - cur.y) * k;
          } else if (!pointer && inp) {
            cur.x = Math.max(10, Math.min(510, cur.x + inp.move.x * 150 * dt));
            cur.y = Math.max(10, Math.min(220, cur.y - inp.move.y * 150 * dt));
          }
          const v = dt > 0 ? Math.hypot(cur.x - prev.x, cur.y - prev.y) / dt : 0;
          prev.x = cur.x; prev.y = cur.y;
          speed += (v - speed) * Math.min(1, dt * 14);
          const over = Math.hypot(cur.x - tgt.x, cur.y - tgt.y) < 13;
          shake += ((over ? speed : speed * 0.25) - shake) * Math.min(1, dt * 8);
          if (over && wriggleT <= 0) {
            if (speed > P.shake && prog > 0.15) {
              // too rough: it wriggles and the pack pops off
              tries++;
              if (api.game) api.game.events.emit('card:act', 'wriggle', tries); // claws scrabbling (src/audio)
              drawTries();
              wriggleT = 0.6;
              prog = 0;
              api.setInstructions(tries >= P.tries ? 'Nearly! One last go, gently now.' : 'Wriggle! Steady hands, have another go.');
              if (tries > P.tries) finish({ success: true, quality: 0.2, label: 'Phew, on at last!', tries });
            } else if (speed < 30) {
              prog = Math.min(1, prog + dt / P.hold);
            } else {
              prog = Math.max(0, prog - dt * (speed / 120));
            }
          } else {
            prog = Math.max(0, prog - dt * 2.5);
          }
          settle.setAttribute('stroke-dashoffset', (150.8 * (1 - prog)).toFixed(1));
          const steady = Math.max(0, 1 - shake / P.shake);
          bar.setAttribute('width', (76 * steady).toFixed(1));
          bar.setAttribute('class', 'catch-steady-bar' + (steady < 0.35 ? ' is-low' : steady < 0.7 ? ' is-mid' : ''));
          packEl.setAttribute('transform', `translate(${cur.x.toFixed(1)} ${cur.y.toFixed(1)})`);
          if (prog >= 1) {
            packEl.classList.add('is-on');
            if (api.game) api.game.events.emit('card:act', 'pack', tries); // the backpack's click (src/audio)
            finish({ success: true, quality: Math.max(0.3, 1 - tries * 0.25), label: 'Fitted!', tries });
          }
        },
        onUse() {},
      };
    },
  };
}

// ---------------------------------------------------------------- 5. the perch note

const PERCH_ICON = {
  trunk: '<path d="M9 22V5M15 22V5M9 12l-3-3M15 9l3-3" />',
  branch: '<path d="M3 16h18M8 16l-3-5M15 16l3-4M11 16v-3" />',
  ground: '<path d="M2 17c4-2 7-2 10 0s7 2 10 0M5 13l1-3M11 13l1-4M17 13l1-3" />',
  leaf: '<path d="M5 19C4 11 9 5 19.5 4.5 20 14 14 19.5 5 19z" /><path d="M5 19c3-4 6.5-7.5 11-10" />',
  palm_stem: '<path d="M12 22V9M12 9C9 5 5 5 3 7M12 9c3-4 7-4 9-2M12 9c-1-4-3-6-5-6" />',
  palm_frond: '<path d="M3 20C8 12 14 7 21 4M8 14l-3-1M11 11l-3-2M14 9l-2-3M11 11l2 2M14 9l3 1" />',
  log: '<rect x="3" y="10" width="16" height="7" rx="3.5"/><ellipse cx="19" cy="13.5" rx="2" ry="3.5"/>',
  root: '<path d="M12 3v9M12 12c-3 2-6 3-9 8M12 12c3 2 6 3 9 8M12 12v9" />',
};

export function perchCard(c) {
  const seen = c.perchSeen || c.perch;
  const options = perchOptions(c.perch, seen, c.rng || Math.random);
  const name = SPECIES_NAMES[c.sp].common;
  const heightText = heightWords(c.height, c.taped);
  const where = whereText(c);
  return {
    name: 'perch', title: 'Field notes', icon: 'book', card: 'catch-card',
    instructions: 'Where was it perched? Pick one, then it goes home.',
    width: '33em', height: where ? '15.4em' : '14em',
    foot: '[1] [2] [3] or click · [Esc] let it go now',
    mount(stage, api) {
      stage.classList.add('catch-stage', 'catch-notes');
      const svlText = c.measured ? `${c.measured} mm` : 'not measured';
      const pack = c.tracked ? `${esc(c.tracked)}${c.nickname ? ' (' + esc(c.nickname) + ')' : ''}` : 'none';
      stage.innerHTML = `<div class="catch-page">
        <div class="catch-line"><b>Species</b><span>${esc(name)}, ${esc(sexWord(c.sex) || 'unsexed')}</span></div>
        <div class="catch-line"><b>SVL</b><span>${svlText}</span></div>
        <div class="catch-line"><b>Mark</b><span><i class="catch-dot" style="background:${c.mark}"></i>today's dot</span></div>
        <div class="catch-line"><b>Backpack</b><span>${pack}</span></div>
        <div class="catch-line"><b>Perch</b><span class="catch-perch">${options.map((p, i) => `<button type="button" class="catch-perch-btn" data-p="${p}"><i>${i + 1}</i><svg viewBox="0 0 24 24" aria-hidden="true">${PERCH_ICON[p] || ''}</svg>${esc(PERCH_WORDS[p] || p)}</button>`).join('')}</span></div>
        <div class="catch-line"><b>Height</b><span>${heightText}</span></div>
        ${where ? `<div class="catch-line"><b>Where</b><span class="catch-where">${esc(where)}</span></div>` : ''}
      </div>`;
      const btns = [...stage.querySelectorAll('.catch-perch-btn')];
      let focus = 0, done = false, t = 0;
      const setFocus = (i) => { focus = (i + btns.length) % btns.length; btns.forEach((b, k) => b.classList.toggle('is-focus', k === focus)); };
      setFocus(0);
      const choose = (i) => {
        if (done || t < 0.3) return;
        done = true;
        const p = options[i];
        // what it sat on and the recorded class both count (a 'trunk' record on a limb)
        const ok = (q) => q === c.perch || q === seen;
        const right = ok(p);
        if (api.game) api.game.events.emit('card:act', 'perch', right); // the pencil (src/audio)
        btns.forEach((b, k) => { b.classList.toggle('is-right', ok(options[k])); b.classList.toggle('is-wrong', k === i && !right); b.disabled = true; });
        const label = right ? 'Noted!' : `It was on ${PERCH_A[seen] || 'a ' + (PERCH_WORDS[seen] || seen)}. Noted!`;
        const fast = c.auto === 'fast';
        setTimeout(() => api.done({ success: true, quality: right ? 1 : 0.5, right, label, hold: fast ? 300 : right ? 800 : 1400 }), fast ? 100 : 500);
      };
      btns.forEach((b, i) => b.addEventListener('click', (e) => { e.stopPropagation(); choose(i); }));
      const onKey = (e) => {
        if (done) return;
        if (/^Digit[1-3]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); choose(Number(e.code.slice(5)) - 1); }
        else if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { e.preventDefault(); setFocus(focus + 1); }
        else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { e.preventDefault(); setFocus(focus - 1); }
      };
      window.addEventListener('keydown', onKey, true);
      return {
        update(dt) { t += dt; if (c.auto && t > (c.auto === 'fast' ? 0.4 : 1.0)) choose(options.indexOf(seen)); },
        onUse() { choose(focus); },
        destroy() { window.removeEventListener('keydown', onKey, true); },
      };
    },
  };
}

// Three perch words: what it sat on, the recorded class when that differs, and others
// to make three, shuffled.
function perchOptions(right, seen, rng) {
  const pool = ['trunk', 'branch', 'ground', 'leaf', 'palm_stem', 'palm_frond', 'log', 'root'].filter((p) => p !== right && p !== seen);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = seen && seen !== right ? [seen, right, pool[0]] : [right, pool[0], pool[1]];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const PERCH_A = { trunk: 'a tree trunk', branch: 'a branch', ground: 'the ground', palm_stem: 'a palm trunk', root: 'the roots', leaf: 'the leaves', palm_frond: 'a palm frond', log: 'a log' };

// The height line: taped (to the half metre) or by eye (to the metre).
export function heightWords(h, taped) {
  if (taped) return h <= 0.1 ? 'on the ground (taped)' : `${h.toFixed(1).replace(/\.0$/, '')} m up, taped`;
  if (h <= 0.25) return 'on the ground';
  if (h < 0.75) return 'about knee high, by eye';
  return `about ${Math.round(h)} m up, by eye`;
}

// ---------------------------------------------------------------- the whole sequence

// Runs the cards in turn. kit: { minigame, toast, stamp }; hooks: { measured(svl),
// marked(q), tagged(q) -> { id, nickname } | null, noted(right), score(points, reason) }.
// Returns { measured, marked, tagged, released: true, skipped }.
export async function runRelease(c, kit, hooks) {
  const out = { measured: null, marked: false, tagged: false, skipped: false };
  const step = async (spec) => {
    const r = await kit.minigame(spec);
    if (r && r.cancelled) { out.skipped = true; return null; }
    return r;
  };
  const bag = await step(bagCard(c));
  if (!bag || c.recapture) return out;
  // the opening's practice catch goes through the bag, the ruler and the paint pen only,
  // and counts for nothing in the notebook

  const ruler = await step(rulerCard(c));
  if (!ruler) return out;
  out.measured = ruler.svl;
  c.measured = ruler.svl;
  if (!c.practice) hooks.measured(ruler.svl, ruler);

  const paint = await step(paintCard(c));
  if (!paint) return out;
  out.marked = true;
  if (c.practice) return out;
  hooks.marked(paint.quality, paint);

  if (c.canPack && !c.tracked) {
    const pack = await step(packCard(c));
    if (!pack) { out.skipped = false; } // skipping the backpack still notes the perch
    else {
      out.tagged = true;
      const t = hooks.tagged(pack.quality, pack);
      if (t) { c.tracked = t.id; c.nickname = t.nickname; }
    }
  }

  const note = await step(perchCard(c));
  if (note) hooks.noted(!!note.right, note);

  // a perch logger, if one is on offer (the survey day, three a day): James's word the
  // first time, then one press clips it where the lizard sat. Esc here only says no.
  let offer = null;
  if (note && perchOffer) { try { offer = perchOffer(c); } catch (e) { console.error(e); offer = null; } }
  if (offer) {
    if (offer.intro) { try { await offer.intro(); } catch (e) { console.error(e); } }
    const r = await kit.minigame(perchLoggerCard(c, offer));
    if (r && r.clipped) { out.logger = true; try { offer.clip(r); } catch (e) { console.error(e); } }
  }
  return out;
}

// ---------------------------------------------------------------- 6. the perch logger

// One quick, satisfying press: the button logger flies from its tray onto the perch
// with a click and a ring. The drawing and the words come with the offer.
export function perchLoggerCard(c, offer) {
  return {
    name: 'perchlogger', title: 'Perch logger', icon: 'thermometer', card: 'catch-card pl-clip-card',
    instructions: offer.instructions || 'Clip a button logger on its perch, right where it sat.',
    width: '32em', height: '15.2em',
    foot: '[E] or click to clip it on · [Esc] not this time',
    mount(stage, api) {
      stage.classList.add('catch-stage', 'pl-clip-stage');
      stage.innerHTML = `<div class="pl-clip-art">${offer.art}</div>
        <div class="pl-clip-row"><span class="catch-chip tone-${esc(offer.kindTone || 'info')}">${esc(offer.kindWord || '')}</span>` +
        (offer.heightWord ? `<span class="catch-chip">${esc(offer.heightWord)}</span>` : '') + // (the drawing's tape shows the height)
        (offer.leftWord ? `<span class="catch-chip">${esc(offer.leftWord)}</span>` : '') +
        '<button type="button" class="ui-btn pl-clip-btn">Clip it on! <kbd>E</kbd></button></div>';
      const svg = stage.querySelector('svg');
      const coin = svg && svg.querySelector('.pl-coin');
      const burst = svg && svg.querySelector('.pl-burst');
      const from = offer.tray || { x: 468, y: 118 }, to = offer.spot || { x: 250, y: 110 };
      let t = 0, k = -1, done = false;
      const clip = () => {
        if (k >= 0 || t < 0.3) return;
        k = 0;
        stage.classList.add('is-clipped');
        try { if (offer.onClipStart) offer.onClipStart(); } catch (e) { /* no sound */ }
      };
      stage.querySelector('.pl-clip-btn').addEventListener('click', (e) => { e.stopPropagation(); clip(); });
      if (svg) svg.addEventListener('pointerdown', clip);
      return {
        update(dt) {
          t += dt;
          if (k < 0) {
            if (c.auto && !offer.hold && t > (c.auto === 'fast' ? 0.35 : 0.9)) clip();
            return;
          }
          if (done) return;
          k = Math.min(1.6, k + dt / 0.38);
          const a = Math.min(1, k), ease = a * a * (3 - 2 * a);
          const x = from.x + (to.x - from.x) * ease, y = from.y + (to.y - from.y) * ease - Math.sin(Math.PI * a) * 46;
          const s = a < 1 ? 1 - 0.12 * Math.sin(Math.PI * a) : 1 + 0.18 * Math.max(0, 1 - (k - 1) / 0.25) * Math.sin((k - 1) * 24);
          if (coin) coin.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})`);
          if (burst && k >= 1) {
            const b = Math.min(1, (k - 1) / 0.5);
            burst.setAttribute('r', (16 + 22 * b).toFixed(1));
            burst.setAttribute('opacity', (0.9 * (1 - b)).toFixed(2));
          }
          if (k >= 1.5) {
            done = true;
            const fast = c.auto === 'fast';
            api.done({ success: true, quality: 1, clipped: true, label: 'Clipped!', hold: fast ? 300 : 700 });
          }
        },
        onUse: clip,
      };
    },
  };
}
