// The drone survey's screens, all DOM (no draw calls), in the game's paper-and-leaf
// look: the flight HUD (the rings strip, a message line, the instruments with the
// flight plan, the controls, an arrow to the next ring, the osprey's speech bubble and
// the camera flash), the aerial photo card after a landing, and the notebook page.
//
//   const hud = buildDroneHud(game, plan)   plan: { rings: [{x, z}], pad: {x, z}, land: [[x, z]...],
//                                           photos (how many spots along the lanes), batteryGoal, lowAt }
//   hud.show(on); hud.rings(n, passed[]); hud.gauges({ battery, ft, kmh, wind, windYaw, camYaw });
//   hud.drone(x, z, yaw); hud.msg(text, tone, seconds); hud.arrow(on, x, y, angle);
//   hud.tag(on, x, y, text); hud.bubble(on, x, y); hud.flash(); hud.photos(n); hud.keys(on)
//   photoCard(stage, result, onDone) -> { setPhoto(canvas | url) }   the card's insides:
//                              the print (developing until it is made), the stars and the checks
//   notebookPage(el, info)     the Field kit tab's drone page

import { icon, escapeHtml } from '../ui/icons.js';

// a little camera, for the photos taken along the lanes
const CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 8.5h3l1.6-2.3h6.8L17 8.5h3v10H4z" fill="currentColor" fill-opacity=".15"/><circle cx="12" cy="13.3" r="3.2"/><path d="M17.6 11h.01"/></svg>';

export const DRONE_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="8.5" y="9.5" width="7" height="5" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M8.5 10.5 5 7.5M15.5 10.5 19 7.5M8.5 13.5 5 16.5M15.5 13.5 19 16.5"/>' +
  '<path d="M2.5 7.5h5M16.5 7.5h5M2.5 16.5h5M16.5 16.5h5"/></svg>';

const CSS = `
.dr-hud { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.35s; }
.dr-hud.is-on { opacity: 1; }
body.ui-card-open .dr-hud { opacity: 0; }
/* while the drone is up its own instruments, plan and controls stand in for the Today card, the
   minimap and the tool badge (whose Q and X belong to the flight then) */
body.drone-flying .hud-jobs, body.drone-flying .hud-map, body.drone-flying .hud-tool { opacity: 0; pointer-events: none; }
.dr-top { position: absolute; left: 50%; top: 0.9em; transform: translateX(-50%); display: flex; align-items: center; gap: 0.7em;
  padding: 0.38em 0.95em 0.42em 0.6em; animation: ui-rise 0.4s ease-out; white-space: nowrap; }
.dr-title { display: flex; align-items: center; gap: 0.35em; font-weight: 800; color: var(--leaf-dark); }
.dr-title .ui-icon { color: var(--coral-deep); width: 1.45em; height: 1.45em; }
.dr-pips { display: flex; gap: 0.22em; }
.dr-pips i { width: 0.78em; height: 0.78em; border-radius: 50%; border: 0.14em solid #d9c69b; background: #fffdf4; transition: background 0.2s, transform 0.2s; }
.dr-pips i.is-next { border-color: var(--gold); box-shadow: 0 0 0 0.14em rgba(245, 197, 66, 0.35); }
.dr-pips i.is-on { background: var(--leaf); border-color: var(--leaf-deep); transform: scale(1.12); }
.dr-count { font-weight: 700; color: var(--ink-soft); font-size: 0.92em; }
.dr-count b { color: var(--ink); font-size: 1.15em; }
.dr-count.is-bump b { display: inline-block; animation: ui-pop 0.4s ease-out; }
.dr-snaps { display: flex; align-items: center; gap: 0.25em; padding-left: 0.65em; border-left: 0.1em dashed var(--paper-line, #e3d6b6); font-weight: 700; color: var(--ink-soft); font-size: 0.92em; }
.dr-snaps svg { width: 1.3em; height: 1.3em; color: #2f8f3a; }
.dr-snaps b { color: var(--ink); font-size: 1.15em; }
.dr-snaps.is-bump svg { animation: ui-pop 0.35s ease-out; }
.dr-msg { position: absolute; left: 50%; top: 4.3em; transform: translate(-50%, -0.3em); padding: 0.3em 0.95em 0.34em; border-radius: 999px;
  background: rgba(255, 250, 235, 0.94); border: 0.12em solid var(--paper-edge); font-weight: 700; font-size: 0.95em; white-space: nowrap;
  box-shadow: 0 0.15em 0 rgba(120, 90, 40, 0.15); opacity: 0; transition: opacity 0.25s, transform 0.25s; }
.dr-msg.is-on { opacity: 1; transform: translate(-50%, 0); }
.dr-msg.tone-gold { background: #fffbe6; border-color: var(--gold); color: #8a5a06; }
.dr-msg.tone-warn { background: #fff3ea; border-color: #ffb08f; color: var(--coral-deep); }
.dr-msg.tone-good { border-color: #9fd67d; color: var(--leaf-dark); }
.dr-inst { position: absolute; right: 1em; top: 1em; display: flex; gap: 0.7em; padding: 0.55em 0.7em; align-items: stretch; animation: ui-rise 0.4s ease-out; }
.dr-plan { width: 9.6em; height: 6.8em; border-radius: 0.8em; background: #9fd7d0; overflow: hidden; border: 0.1em solid #d8c396; }
.dr-plan svg { width: 100%; height: 100%; display: block; }
.dr-gauges { display: grid; grid-template-columns: auto auto; gap: 0.22em 0.65em; align-content: center; font-size: 0.92em; }
.dr-g-l { color: var(--ink-soft); font-weight: 800; font-size: 0.72em; letter-spacing: 0.08em; text-transform: uppercase; align-self: center; }
.dr-g-v { font-weight: 800; white-space: nowrap; }
.dr-g-v small { font-weight: 700; color: var(--ink-soft); margin-left: 0.15em; }
.dr-batt { display: flex; align-items: center; gap: 0.35em; }
.dr-batt-bar { position: relative; width: 4.6em; height: 0.95em; border-radius: 0.3em; border: 0.14em solid #8a7a5c; background: #fffdf4; overflow: hidden; }
.dr-batt-bar::after { content: ''; position: absolute; right: -0.34em; top: 0.18em; width: 0.2em; height: 0.36em; border-radius: 0 0.1em 0.1em 0; background: #8a7a5c; }
.dr-batt-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--leaf); transition: background 0.3s; }
/* the battery a star needs, as a little gold notch on the bar */
.dr-batt-bar u { position: absolute; top: -0.1em; bottom: -0.1em; width: 0.14em; margin-left: -0.07em; background: var(--gold); box-shadow: 0 0 0 0.05em #fff; z-index: 1; }
.dr-batt.is-mid .dr-batt-bar i { background: var(--gold); }
.dr-batt.is-low .dr-batt-bar i { background: var(--coral); animation: dr-blink 0.8s steps(2) infinite; }
@keyframes dr-blink { 50% { opacity: 0.35; } }
.dr-alt { display: flex; align-items: center; gap: 0.4em; }
.dr-tape { position: relative; width: 0.55em; height: 2.3em; border-radius: 0.3em; background: #efe4c8; overflow: hidden; }
.dr-tape b { position: absolute; left: 0; right: 0; background: rgba(108, 191, 79, 0.55); }
.dr-tape i { position: absolute; left: -0.1em; right: -0.1em; height: 0.2em; margin-top: -0.1em; background: var(--coral-deep); border-radius: 0.1em; }
.dr-alt.is-band .dr-g-v { color: var(--leaf-dark); }
.dr-wind svg { width: 1.2em; height: 1.2em; vertical-align: -0.25em; color: #3a7fb6; }
.dr-keys { position: absolute; left: 50%; bottom: 1.1em; transform: translateX(-50%); max-width: calc(100% - 2em); white-space: nowrap; text-align: center; line-height: 1.9; padding: 0.4em 0.9em 0.45em; border-radius: 999px;
  background: rgba(255, 250, 235, 0.94); border: 0.12em solid var(--paper-edge); font-weight: 650; font-size: 0.86em; border-radius: 1.4em;
  box-shadow: 0 0.15em 0 rgba(120, 90, 40, 0.15), 0 0.4em 1em rgba(40, 60, 50, 0.16); transition: opacity 0.35s, transform 0.35s; }
.dr-keys > i { white-space: nowrap; font-style: normal; }
.dr-keys span { color: var(--ink-soft); margin: 0 0.22em; }
/* coming down onto the pad the strip steps aside, so the pad under the drone shows */
.dr-keys.is-off { opacity: 0; transform: translate(-50%, 0.6em); }
.dr-arrow { position: absolute; left: 0; top: 0; width: 2.6em; height: 2.6em; margin: -1.3em 0 0 -1.3em; opacity: 0; transition: opacity 0.2s; }
.dr-arrow.is-on { opacity: 1; }
.dr-arrow svg { width: 100%; height: 100%; filter: drop-shadow(0 0.1em 0.12em rgba(80, 50, 10, 0.35)); }
.dr-tag { position: absolute; left: 0; top: 0; min-width: 1.9em; height: 1.9em; margin: -2.6em 0 0 -0.95em; border-radius: 999px; background: var(--gold);
  color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center; text-shadow: 0 0.06em 0 rgba(120, 70, 0, 0.4);
  box-shadow: 0 0.15em 0 #c98a12; opacity: 0; transition: opacity 0.2s; }
.dr-tag.is-on { opacity: 1; }
.dr-bubble { position: absolute; left: 0; top: 0; padding: 0.35em 0.75em 0.4em; margin: -3.4em 0 0 -3.2em; border-radius: 1em; background: #fff;
  border: 0.14em solid #d8544a; color: #b03a2e; font-weight: 900; white-space: nowrap; opacity: 0; transition: opacity 0.2s;
  box-shadow: 0 0.15em 0 rgba(120, 40, 20, 0.2); }
.dr-bubble::after { content: ''; position: absolute; left: 2.4em; bottom: -0.55em; width: 0.8em; height: 0.8em; background: #fff;
  border-right: 0.14em solid #d8544a; border-bottom: 0.14em solid #d8544a; transform: rotate(45deg); }
.dr-bubble.is-on { opacity: 1; animation: ui-wobble 0.35s ease-in-out 2; }
.dr-flash { position: absolute; inset: 0; background: #fffdf5; opacity: 0; }
.dr-flash.is-on { animation: dr-flash 0.7s ease-out; }
@keyframes dr-flash { 0% { opacity: 0; } 12% { opacity: 0.92; } 100% { opacity: 0; } }
body.reduce-motion .dr-bubble.is-on, body.reduce-motion .dr-count.is-bump b { animation: none; }

/* the aerial photo card */
.dr-card { display: flex; gap: 1.2em; align-items: center; padding: 0.4em 0.9em 0.4em 0.2em; } /* (clear of the stage's dashed edge) */
.dr-print { position: relative; background: #fffdf8; padding: 0.7em 0.7em 2.3em; border-radius: 0.2em; transform: rotate(-2.2deg);
  box-shadow: 0 0.25em 0.8em rgba(60, 40, 20, 0.28), 0 0.05em 0.1em rgba(60, 40, 20, 0.2); flex: none; }
.dr-print img, .dr-print canvas.dr-shot { display: block; width: 21em; height: auto; border-radius: 0.1em; filter: saturate(1.12) contrast(1.05); }
.dr-print.is-small img, .dr-print.is-small canvas.dr-shot { width: 100%; }
.dr-print .dr-tape-strip { position: absolute; left: 50%; top: -0.7em; width: 5.5em; height: 1.4em; margin-left: -2.75em; background: rgba(255, 236, 170, 0.75);
  transform: rotate(3deg); box-shadow: 0 0.05em 0.1em rgba(0, 0, 0, 0.08); }
.dr-print .dr-date { position: absolute; right: 1.2em; bottom: 2.75em; font: 800 0.95em/1 ui-monospace, Menlo, monospace; color: #ff9a3c;
  text-shadow: 0 0 0.3em rgba(255, 140, 40, 0.8); letter-spacing: 0.06em; }
.dr-print .dr-caption { position: absolute; left: 0; right: 0; bottom: 0.55em; text-align: center; font-weight: 700; color: #6b5a44; font-style: italic; }
.dr-empty { width: 21em; height: 14.9em; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 0.4em;
  background: repeating-linear-gradient(45deg, #f4ecd8, #f4ecd8 0.6em, #efe4cb 0.6em, #efe4cb 1.2em); color: var(--ink-soft); font-weight: 700; text-align: center; }
.dr-empty .ui-icon { width: 3em; height: 3em; color: #c9b58a; }
/* a print still developing: pale and soft, then the picture comes up like a real print */
.dr-print .dr-dev { display: block; width: 21em; aspect-ratio: 144 / 102; background: #e9e4d6; border-radius: 0.1em; position: relative; overflow: hidden; }
.dr-print .dr-dev::after { content: ''; position: absolute; inset: 0; background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.55) 50%, transparent 70%);
  background-size: 250% 100%; animation: dr-shine 1.2s linear infinite; }
@keyframes dr-shine { from { background-position: 120% 0; } to { background-position: -120% 0; } }
.dr-print.is-small .dr-dev { width: 100%; }
.dr-print .dr-shot.is-new { animation: dr-develop 1.6s ease-out; }
@keyframes dr-develop { 0% { filter: brightness(1.7) saturate(0.1) blur(1.5px); opacity: 0.55; } 100% { filter: saturate(1.12) contrast(1.05); opacity: 1; } }
body.reduce-motion .dr-print .dr-dev::after, body.reduce-motion .dr-print .dr-shot.is-new { animation: none; }
.dr-result { display: flex; flex-direction: column; gap: 0.55em; min-width: 12em; }
.dr-stars { display: flex; gap: 0.3em; }
.dr-stars .ui-icon { width: 2.3em; height: 2.3em; color: #e6dcc4; }
.dr-stars .ui-icon.is-on { color: var(--gold); filter: drop-shadow(0 0.1em 0 #c98a12); animation: ui-pop 0.45s ease-out backwards; }
.dr-stars .ui-icon.is-on:nth-child(2) { animation-delay: 0.25s; }
.dr-stars .ui-icon.is-on:nth-child(3) { animation-delay: 0.5s; }
.dr-check { display: flex; align-items: center; gap: 0.45em; font-weight: 700; }
.dr-check i { width: 1.3em; height: 1.3em; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #efe6d2; color: #fff; flex: none; }
.dr-check i .ui-icon { width: 0.95em; height: 0.95em; }
.dr-check.is-on i { background: var(--leaf); }
.dr-check small { color: var(--ink-soft); font-weight: 650; }
.dr-go { align-self: flex-start; margin-top: 0.3em; }
body.reduce-motion .dr-stars .ui-icon.is-on { animation: none; }

/* the notebook page, like the species pages: stat boxes and the print on the left-hand
   page, green headings with icons, the flight log and the notes on the right */
.dr-page { display: grid; grid-template-columns: 1fr 1fr; column-gap: 3.4em; align-items: start; }
.dr-page-left { display: flex; flex-direction: column; min-width: 0; }
.dr-page-left .nb-stats { margin-bottom: 1.1em; }
.dr-page-print { display: flex; justify-content: center; padding: 0.3em 0 0.4em; }
.dr-page .dr-print { transform: rotate(-1.5deg); }
.dr-page .dr-print img, .dr-page .dr-empty, .dr-page .dr-dev { width: 25em; max-width: 100%; }
.dr-page .dr-empty { height: 17.7em; }
.dr-page-side { display: flex; flex-direction: column; gap: 0.35em; min-width: 0; }
.dr-page-side h3 { display: flex; align-items: center; gap: 0.35em; margin: 0.25em 0 0.15em; }
.dr-page-side h3 .ui-icon { width: 1.05em; height: 1.05em; color: var(--leaf-deep); }
.dr-page-side h3:first-child { margin-top: 0; }
.dr-log { width: 100%; border-collapse: collapse; font-size: 0.95em; }
.dr-log td, .dr-log th { padding: 0.28em 0.4em; text-align: left; border-bottom: 0.08em dashed var(--paper-line); }
.dr-log th { color: var(--ink-soft); font-size: 0.72em; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
.dr-log td { font-weight: 650; }
.dr-log .ui-icon { width: 0.95em; height: 0.95em; color: var(--gold); }
.dr-log .is-soft { color: var(--leaf-dark); }
.dr-fact { font-size: 0.95em; color: var(--ink); line-height: 1.5; margin: 0.1em 0 0.3em; }
.dr-fact b { color: var(--leaf-dark); }
.dr-rules { display: flex; flex-direction: column; gap: 0.3em; margin: 0.1em 0 0; }
.dr-rules .dr-check { font-weight: 650; }
.dr-plan-row { display: flex; gap: 1em; align-items: center; margin-top: 0.7em; }
.dr-nb-plan { width: 11.5em; height: 8.1em; flex: none; border-radius: 0.8em; border: 0.1em solid #d8c396; }
`;

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'drone-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

// the island's outline for the little flight plan, one point every metre and a half or so
function outlinePath(land) {
  if (!Array.isArray(land)) return '';
  let d = '';
  for (const ring of land) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let lx = Infinity, lz = Infinity, n = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x, z] = ring[i];
      if (Math.hypot(x - lx, z - lz) < 1.6 && i < ring.length - 1) continue;
      d += (n === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + z.toFixed(1);
      lx = x; lz = z; n++;
    }
    if (n) d += 'Z';
  }
  return d;
}

export function buildDroneHud(game, plan) {
  ensureStyle();
  const el = h('div', 'dr-hud');
  const ringDots = plan.rings.map((r, i) => `<circle class="dr-ring-dot" data-i="${i}" cx="${r.x.toFixed(1)}" cy="${r.z.toFixed(1)}" r="2.6"/>`).join('');
  const lane = [plan.pad, ...plan.rings, plan.pad].map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.z.toFixed(1)).join('');
  const goal = plan.batteryGoal || 35;
  el.innerHTML =
    `<div class="dr-top ui-panel"><div class="dr-title">${DRONE_ICON}Drone survey</div>` +
    `<div class="dr-pips">${plan.rings.map(() => '<i></i>').join('')}</div>` +
    `<div class="dr-count"><b>0</b> / ${plan.rings.length} rings</div>` +
    (plan.photos ? `<div class="dr-snaps" title="Photos along the lanes">${CAMERA_ICON}<b>0</b> / ${plan.photos}</div>` : '') + '</div>' +
    '<div class="dr-msg"></div>' +
    '<div class="dr-inst ui-panel">' +
    `<div class="dr-plan"><svg viewBox="-62 -50 144 102" preserveAspectRatio="xMidYMid slice">` +
    `<path d="${outlinePath(plan.land)}" fill="#c4ea9f" stroke="#e3f6ee" stroke-width="1.4" fill-rule="evenodd"/>` +
    `<path d="${lane}" fill="none" stroke="#fff8e6" stroke-width="1.3" stroke-dasharray="2.2 2.2" stroke-linecap="round"/>` +
    `<g class="dr-ring-dots" stroke="#fff" stroke-width="0.9">${ringDots}</g>` +
    `<rect x="${(plan.pad.x - 2.2).toFixed(1)}" y="${(plan.pad.z - 2.2).toFixed(1)}" width="4.4" height="4.4" rx="1.2" fill="#3fb0ad" stroke="#fff" stroke-width="0.9"/>` +
    '<g class="dr-plan-drone"><path d="M0 -4.4 L3.4 3.2 L0 1.6 L-3.4 3.2 Z" fill="#ff6f4f" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></g>' +
    '</svg></div>' +
    '<div class="dr-gauges">' +
    `<span class="dr-g-l">Battery</span><span class="dr-g-v dr-batt" title="${goal}% left for a star"><span class="dr-batt-bar"><i></i><u style="left:${goal}%"></u></span><b>100%</b></span>` +
    '<span class="dr-g-l">Height</span><span class="dr-alt"><span class="dr-tape"><b></b><i></i></span><span class="dr-g-v"><b>0</b><small>ft</small></span></span>' +
    '<span class="dr-g-l">Speed</span><span class="dr-g-v dr-spd"><b>0</b><small>km/h</small></span>' +
    '<span class="dr-g-l">Wind</span><span class="dr-g-v dr-wind"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5M6.5 10.5 12 5l5.5 5.5"/></svg><small class="dr-wind-t">light</small></span>' +
    '</div></div>' +
    // (C, not Ctrl: on some systems Ctrl+W, the usual way in to land, closes the tab)
    '<div class="dr-keys"><i><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly</i><span>·</span><i><kbd>Q</kbd><kbd>E</kbd> turn</i><span>·</span>' +
    '<i><kbd>Space</kbd> climb</i><span>·</span><i><kbd>C</kbd> descend</i><span>·</span>' +
    '<i><kbd>Shift</kbd> faster</i><span>·</span><i><kbd>X</kbd> fly home</i></div>' +
    '<div class="dr-arrow"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#fff8e6" stroke="#f5c542" stroke-width="3"/>' +
    '<path d="M20 8 L29 24 L20 20 L11 24 Z" fill="#f5a623" stroke="#c98a12" stroke-width="1.5" stroke-linejoin="round"/></svg></div>' +
    '<div class="dr-tag">1</div>' +
    '<div class="dr-bubble">Kyew! Kyew!</div>' +
    '<div class="dr-flash"></div>';
  const root = document.getElementById('ui') || document.body;
  // under the kit's layers (dialogue, cards, toasts, stamps): straight after the game HUD
  const hudEl = root.querySelector(':scope > .hud');
  if (hudEl && hudEl.nextSibling) root.insertBefore(el, hudEl.nextSibling); else root.insertBefore(el, root.firstChild);

  const q = (s) => el.querySelector(s);
  const pips = [...el.querySelectorAll('.dr-pips i')];
  const count = q('.dr-count'), countB = q('.dr-count b');
  const msgEl = q('.dr-msg');
  const batt = q('.dr-batt'), battBar = q('.dr-batt-bar i'), battTxt = q('.dr-batt b');
  const alt = q('.dr-alt'), altTxt = q('.dr-alt .dr-g-v b'), tapeBand = q('.dr-tape b'), tapeMark = q('.dr-tape i');
  const spd = q('.dr-spd b');
  const windSvg = q('.dr-wind svg'), windTxt = q('.dr-wind-t');
  const planDrone = q('.dr-plan-drone');
  const ringDotEls = [...el.querySelectorAll('.dr-ring-dot')];
  const arrowEl = q('.dr-arrow'), arrowSvg = q('.dr-arrow svg');
  const tagEl = q('.dr-tag'), bubbleEl = q('.dr-bubble'), flashEl = q('.dr-flash');
  const snapsEl = q('.dr-snaps'), snapsB = q('.dr-snaps b'), keysEl = q('.dr-keys');
  const LOW = plan.lowAt || 20, MID = Math.max(LOW + 5, goal + 10);
  const TAPE_MAX = 225;
  tapeBand.style.bottom = (140 / TAPE_MAX * 100).toFixed(1) + '%';
  tapeBand.style.height = (20 / TAPE_MAX * 100).toFixed(1) + '%';

  // the panels a ring's label keeps off (their boxes, looked up now and then)
  const avoid = [q('.dr-top'), q('.dr-inst'), q('.dr-msg')].filter(Boolean);
  const boxes = avoid.map(() => ({ l: 0, t: 0, r: 0, b: 0 }));
  let boxT = 0;
  function blocked(x, y) {
    const now = performance.now();
    if (now - boxT > 1000) {
      boxT = now;
      for (let i = 0; i < avoid.length; i++) {
        const r = avoid[i].getBoundingClientRect(), b = boxes[i];
        b.l = r.left - 24; b.t = r.top - 30; b.r = r.right + 24; b.b = r.bottom + 30;
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x > b.l && x < b.r && y > b.t && y < b.b) return true;
    }
    return false;
  }
  const pos = { ax: -1e4, ay: -1e4, aa: -99, tx: -1e4, ty: -1e4, bx: -1e4, by: -1e4 }; // what the moving marks show now
  const shown = { on: false, n: -1, next: -1, batt: -1, ft: -9999, kmh: -1, wind: -9, windT: '', band: null, low: null, mid: null, dx: 1e9, dz: 1e9, dy: 1e9, arrow: null, tag: null, bubble: null, tagText: '', snaps: -1, keys: true };
  let msgT = 0;

  return {
    el,
    show(on) {
      if (shown.on === on) return;
      shown.on = on;
      el.classList.toggle('is-on', on);
      if (!on) { this.arrow(false); this.tag(false); this.bubble(false); this.keys(true); msgEl.classList.remove('is-on'); }
    },
    rings(n, passed, next) {
      if (n !== shown.n) {
        const more = n > shown.n && shown.n >= 0;
        shown.n = n;
        countB.textContent = String(n);
        if (more) { count.classList.remove('is-bump'); void count.offsetWidth; count.classList.add('is-bump'); }
        for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('is-on', !!passed[i]);
        for (let i = 0; i < ringDotEls.length; i++) ringDotEls[i].setAttribute('fill', passed[i] ? '#6cbf4f' : '#fff8e6');
      }
      if (next !== shown.next) {
        shown.next = next;
        for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('is-next', i === next);
        for (let i = 0; i < ringDotEls.length; i++) ringDotEls[i].setAttribute('stroke', i === next ? '#f5a623' : '#fff');
      }
    },
    gauges(o) {
      const b = Math.max(0, Math.round(o.battery));
      if (b !== shown.batt) {
        shown.batt = b;
        battTxt.textContent = b + '%';
        battBar.style.width = b + '%';
        const low = b <= LOW, mid = b > LOW && b <= MID;
        if (low !== shown.low) { shown.low = low; batt.classList.toggle('is-low', low); }
        if (mid !== shown.mid) { shown.mid = mid; batt.classList.toggle('is-mid', mid); }
      }
      const ft = Math.round(o.ft);
      if (ft !== shown.ft) {
        shown.ft = ft;
        altTxt.textContent = String(Math.max(0, ft));
        tapeMark.style.bottom = (Math.max(0, Math.min(1, ft / TAPE_MAX)) * 100).toFixed(1) + '%';
        const band = ft >= 138 && ft <= 162;
        if (band !== shown.band) { shown.band = band; alt.classList.toggle('is-band', band); }
      }
      const kmh = Math.round(o.kmh);
      if (kmh !== shown.kmh) { shown.kmh = kmh; spd.textContent = String(kmh); }
      // the wind arrow: where it blows to, turned for the camera's view
      const a = Math.round(((o.windYaw - o.camYaw) * 180 / Math.PI) / 5) * 5;
      if (a !== shown.wind) { shown.wind = a; windSvg.style.transform = `rotate(${-a}deg)`; }
      const wt = o.wind < 0.6 ? 'light' : o.wind < 1.2 ? 'breezy' : 'gusty';
      if (wt !== shown.windT) { shown.windT = wt; windTxt.textContent = wt; }
    },
    drone(x, z, yaw) {
      if (Math.abs(x - shown.dx) < 0.3 && Math.abs(z - shown.dz) < 0.3 && Math.abs(yaw - shown.dy) < 0.05) return;
      shown.dx = x; shown.dz = z; shown.dy = yaw;
      planDrone.setAttribute('transform', `translate(${x.toFixed(1)} ${z.toFixed(1)}) rotate(${(-yaw * 180 / Math.PI).toFixed(0)})`);
    },
    msg(text, tone = 'info', seconds = 2.6) {
      if (!text) { msgEl.classList.remove('is-on'); msgT = 0; return; }
      if (msgEl.dataset.text !== text || !msgEl.classList.contains('is-on')) {
        msgEl.dataset.text = text;
        msgEl.innerHTML = escapeHtml(text).replace(/\[([^\]]{1,10})\]/g, '<kbd>$1</kbd>');
        msgEl.className = 'dr-msg is-on tone-' + tone;
      }
      msgT = seconds;
    },
    tick(dt) {
      if (msgT > 0) { msgT -= dt; if (msgT <= 0) msgEl.classList.remove('is-on'); }
    },
    arrow(on, x = 0, y = 0, angle = 0) {
      if (on !== shown.arrow) { shown.arrow = on; arrowEl.classList.toggle('is-on', on); }
      if (!on) return;
      const X = Math.round(x), Y = Math.round(y), A = Math.round(angle * 180 / Math.PI);
      if (X !== pos.ax || Y !== pos.ay) { pos.ax = X; pos.ay = Y; arrowEl.style.transform = 'translate(' + X + 'px,' + Y + 'px)'; }
      if (A !== pos.aa) { pos.aa = A; arrowSvg.style.transform = 'rotate(' + A + 'deg)'; }
    },
    tag(on, x = 0, y = 0, text = '') {
      if (on && blocked(x, y)) on = false;
      if (on !== shown.tag) { shown.tag = on; tagEl.classList.toggle('is-on', on); }
      if (!on) return;
      const X = Math.round(x), Y = Math.round(y);
      if (X !== pos.tx || Y !== pos.ty) { pos.tx = X; pos.ty = Y; tagEl.style.transform = 'translate(' + X + 'px,' + Y + 'px)'; }
      if (text !== shown.tagText) { shown.tagText = text; tagEl.textContent = text; }
    },
    bubble(on, x = 0, y = 0) {
      if (on !== shown.bubble) { shown.bubble = on; bubbleEl.classList.toggle('is-on', on); }
      if (!on) return;
      const X = Math.round(x), Y = Math.round(y);
      if (X !== pos.bx || Y !== pos.by) { pos.bx = X; pos.by = Y; bubbleEl.style.transform = 'translate(' + X + 'px,' + Y + 'px)'; }
    },
    flash() {
      flashEl.classList.remove('is-on');
      void flashEl.offsetWidth;
      flashEl.classList.add('is-on');
    },
    // the photos taken along the lanes so far (a little pop on a new one)
    photos(n) {
      if (!snapsEl || n === shown.snaps) return;
      const more = n > shown.snaps && shown.snaps >= 0;
      shown.snaps = n;
      snapsB.textContent = String(n);
      if (more) { snapsEl.classList.remove('is-bump'); void snapsEl.offsetWidth; snapsEl.classList.add('is-bump'); }
    },
    // the key strip along the bottom (it steps aside while coming down onto the pad)
    keys(on) {
      if (on === shown.keys) return;
      shown.keys = on;
      keysEl.classList.toggle('is-off', !on);
    },
    dispose() { el.remove(); },
  };
}

// ---------------------------------------------------------------- the photo, as a print

// photo: a data URL, or null; developing: the JPEG is still being made (a pale print
// that comes up once setPhoto() has it)
export function printHtml(photo, caption, stamp, small = false, developing = false) {
  ensureStyle();
  const pic = photo
    ? `<img src="${photo}" alt="Lizard Island from the drone">`
    : developing
      ? '<span class="dr-dev" aria-label="The photo is developing"></span>'
      : `<div class="dr-empty">${DRONE_ICON}<span>No aerial photo yet.<br>Fly the survey!</span></div>`;
  return `<div class="dr-print${small ? ' is-small' : ''}"><span class="dr-tape-strip"></span>${pic}` +
    ((photo || developing) && stamp ? `<span class="dr-date">${escapeHtml(stamp)}</span>` : '') +
    `<span class="dr-caption">${escapeHtml(caption || 'Lizard Island from 150 ft')}</span></div>`;
}

const STAR = icon('star');
function starsHtml(n) {
  let s = '<div class="dr-stars">';
  for (let i = 0; i < 3; i++) s += STAR.replace('class="ui-icon ', `class="ui-icon ${i < n ? 'is-on' : ''} `);
  return s + '</div>';
}
const CHECK = icon('check');
function checkHtml(on, text, sub) {
  return `<div class="dr-check${on ? ' is-on' : ''}"><i>${on ? CHECK : ''}</i><span>${escapeHtml(text)}${sub ? ` <small>${escapeHtml(sub)}</small>` : ''}</span></div>`;
}

// The card after a landing. r: { photo, stamp, stars, rings, total, battery, soft,
// landing, batteryGoal, photos, photoTotal }. Returns { setPhoto(url) } for the print
// that is still developing.
export function photoCard(stage, r, onDone) {
  ensureStyle();
  const wrap = h('div', 'dr-card');
  const shots = r.photoTotal ? `${r.photos || 0} photos` : '';
  wrap.innerHTML = printHtml(r.photo, 'Lizard Island from 150 ft', r.stamp, false, !r.photo) +
    '<div class="dr-result">' + starsHtml(r.stars) +
    checkHtml(r.rings >= r.total, `${r.rings} of ${r.total} rings`, r.rings >= r.total ? (shots || 'the whole island') : (shots ? `${shots}, a few gaps` : 'a few gaps')) +
    checkHtml(r.battery >= r.batteryGoal, `${Math.round(r.battery)}% battery left`, r.battery >= r.batteryGoal ? 'plenty to spare' : `${r.batteryGoal}% for a star`) +
    checkHtml(r.soft, r.landing, r.soft ? 'right on the H' : 'land gently on the H') +
    '<button type="button" class="ui-btn dr-go">Pin it in the notebook</button></div>';
  stage.appendChild(wrap);
  const btn = wrap.querySelector('.dr-go');
  btn.addEventListener('click', (e) => { e.stopPropagation(); onDone(); });
  setTimeout(() => { try { btn.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ } }, 400);
  return {
    el: wrap,
    // the print: a canvas as soon as it is made, or a JPEG's data URL
    setPhoto(src) {
      const dev = wrap.querySelector('.dr-dev');
      if (!dev || !src) return;
      let el = src;
      if (typeof src === 'string') { el = document.createElement('img'); el.alt = 'Lizard Island from the drone'; el.src = src; }
      el.classList.add('dr-shot', 'is-new');
      dev.replaceWith(el);
    },
  };
}

// The notebook's drone page. info: { photo, stamp, best, log: [{ rings, total, battery,
// soft, auto, stars, day, photos }], flown, batteryGoal, bestRings, bestBattery, softs, bestPhotos, photoTotal }
export function notebookPage(el, info) {
  ensureStyle();
  const log = info.log || [];
  const rows = log.slice(-6).reverse().map((f) =>
    `<tr><td>Day ${f.day || 1}</td><td>${f.rings}/${f.total || 10}</td><td>${Math.round(f.battery)}%</td>` +
    `<td class="${f.soft ? 'is-soft' : ''}">${f.soft ? 'soft' : f.auto ? 'by itself' : 'bumpy'}</td><td>${STAR.repeat(Math.max(1, Math.min(3, f.stars || 1)))}</td></tr>`).join('');
  const dash = (v) => (v == null ? '-' : v);
  const goal = info.batteryGoal || 35;
  el.innerHTML = '<div class="dr-page"><div class="dr-page-left">' +
    '<div class="nb-stats">' +
      `<div class="nb-stat"><b>${info.flown ? `${info.bestRings || 0}/10` : '-'}</b><small>Best rings</small></div>` +
      `<div class="nb-stat"><b>${info.flown && info.bestPhotos != null ? `${info.bestPhotos}` : '-'}</b><small>Most photos</small></div>` +
      `<div class="nb-stat"><b>${info.flown && info.bestBattery != null ? Math.round(info.bestBattery) + '%' : '-'}</b><small>Most battery</small></div>` +
      `<div class="nb-stat"><b>${info.flown ? dash(info.softs || 0) : '-'}</b><small>Soft landings</small></div>` +
    '</div>' +
    `<div class="dr-page-print">${printHtml(info.photo, 'Lizard Island from 150 ft', info.stamp, true)}</div>` +
    '</div><div class="dr-page-side">' +
    `<h3>${icon('book')} Flight log</h3>` +
    (log.length
      ? `<table class="dr-log"><tr><th>Day</th><th>Rings</th><th>Battery</th><th>Landing</th><th>Stars</th></tr>${rows}</table>`
      : '<p class="dr-fact">Take the drone controller from the tool ring at the pad by the field station, fly through the ten rings at 150 ft and land back on the H.</p>') +
    `<h3>${icon('help')} Why a drone?</h3>` +
    '<p class="dr-fact">Flown in straight lines like mowing a lawn, it takes a photo every few metres from the same height. ' +
    'The lab stitches them into one sharp map of the whole island, an <b>orthomosaic</b>, and this game\'s island was checked against it.</p>' +
    `<h3>${icon('star')} Three stars</h3>` +
    '<div class="dr-rules">' +
      checkHtml(!!info.flown && (info.bestRings || 0) >= 10, 'All ten rings', 'the whole island in the photo') +
      checkHtml(!!info.flown && (info.bestBattery || 0) >= goal, `${goal}% battery left`, 'a tidy flight') +
      checkHtml(!!info.flown && (info.softs || 0) > 0, 'A soft landing on the H', 'gently does it') +
    '</div>' +
    (info.plan && info.plan.taken ? planHtml(info.plan) : '') +
    '</div></div>';
}

// The last flight's plan: the island, the five lanes and the photo spots, the ones it
// photographed in mint. plan: { land, spots: [[x, z]], taken: '0101...', rings, pad }
function planHtml(plan) {
  const n = plan.taken.split('').filter((c) => c === '1').length;
  const lane = [plan.pad, ...plan.rings, plan.pad].map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.z.toFixed(1)).join('');
  const dots = plan.spots.map(([x, z], k) => `<circle cx="${x}" cy="${z}" r="2.1" fill="${plan.taken[k] === '1' ? '#4fbf6a' : '#fffdf4'}" stroke="${plan.taken[k] === '1' ? '#2f8f3a' : '#d9c69b'}" stroke-width="0.8"/>`).join('');
  return `<div class="dr-plan-row"><svg class="dr-nb-plan" viewBox="-62 -50 144 102" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<rect x="-62" y="-50" width="144" height="102" fill="#9fd7d0"/>` +
    `<path d="${outlinePath(plan.land)}" fill="#c4ea9f" stroke="#e3f6ee" stroke-width="1.4" fill-rule="evenodd"/>` +
    `<path d="${lane}" fill="none" stroke="#fff8e6" stroke-width="1.1" stroke-dasharray="2 2" stroke-linecap="round"/>${dots}` +
    `<rect x="${(plan.pad.x - 2.2).toFixed(1)}" y="${(plan.pad.z - 2.2).toFixed(1)}" width="4.4" height="4.4" rx="1.2" fill="#3fb0ad" stroke="#fff" stroke-width="0.9"/></svg>` +
    `<p class="dr-fact"><b>Last flight: ${n} of ${plan.spots.length} photos.</b> Along each lane the camera takes a photo every 12 m at 150 ft; the mint spots are the ones it took.</p></div>`;
}
