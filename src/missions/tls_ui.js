// The laser scan's own UI: its styles (added once), the scan card at the top of the
// screen while the head turns (a little radar of the fan, the part already swept, the
// cover round about that hides you, and you; how far the scan has gone, its stars and a
// word on whether the scanner can see you), the result when a scan lands, and the
// mission's notebook page, laid out on the notebook's two pages: the combined cloud in a
// small 3D view on the left (the view itself is the cloud's), the scans kept on the right.
// DOM only.
//
//   ensureTlsStyle()
//   makeHud() -> { show(on), count(n), scan(s), result(r), radar(r), cover(c), el }
//   renderNotebook(el, info) -> { wrap, view (the box the 3D view goes in) }

import { richText, escapeHtml, icon } from '../ui/icons.js';

let styled = false;
export function ensureTlsStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'tls-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const CSS = `
.tls-hud {
  position: absolute; left: 50%; top: 0.9em; transform: translate(-50%, -0.4em);
  display: flex; align-items: center; gap: 0.8em; padding: 0.55em 1.1em 0.55em 0.6em;
  background: rgba(255, 250, 235, 0.95); border: 0.14em solid var(--paper-edge, #e5cf9f);
  border-radius: 1.3em; box-shadow: var(--shadow); opacity: 0; transition: opacity 0.3s, transform 0.3s;
  pointer-events: none; min-width: 19em;
}
.tls-hud.is-on { opacity: 1; transform: translate(-50%, 0); }
body.ui-card-open .tls-hud { opacity: 0 !important; }
.tls-radar { width: 7.4em; height: 7.4em; border-radius: 50%; flex: none; display: block; }
.tls-hud-main { display: flex; flex-direction: column; gap: 0.28em; min-width: 11em; }
.tls-hud-title { font-family: var(--font-display); font-weight: 800; font-size: 1.02em; color: var(--ink, #4a3e2c); display: flex; align-items: center; gap: 0.4em; }
.tls-hud-title .ui-icon { width: 1.2em; height: 1.2em; color: #e25f55; background: none; }
.tls-stars { display: inline-flex; gap: 0.12em; margin-left: auto; font-size: 1.1em; letter-spacing: 0; }
.tls-stars i { font-style: normal; color: #f5c542; text-shadow: 0 0.08em 0 #c98a22; transition: color 0.3s, transform 0.3s; }
.tls-stars i.is-lost { color: #d9ccb0; text-shadow: none; transform: scale(0.85); }
.tls-stars i.is-pop { animation: tls-pop 0.5s cubic-bezier(.3,1.8,.5,1) both; }
@keyframes tls-pop { 0% { transform: scale(0) rotate(-40deg); } 100% { transform: scale(1) rotate(0); } }
.tls-bar { height: 0.55em; border-radius: 1em; background: #efe2c4; overflow: hidden; }
.tls-bar i { display: block; height: 100%; width: 0; border-radius: 1em; background: linear-gradient(90deg, #8fd6a0, #3fae6a); }
.tls-status { font-weight: 750; font-size: 0.92em; color: #3f8f4c; min-height: 1.3em; }
.tls-status.is-warn { color: #d8752a; }
.tls-status.is-bad { color: #d8544a; animation: tls-shake 0.4s; }
.tls-status.is-calm { color: #6a7fa8; }
@keyframes tls-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-0.25em); } 75% { transform: translateX(0.25em); } }
.tls-help { font-size: 0.74em; color: var(--ink-soft, #85735a); line-height: 1.25; }
.tls-count { font-family: var(--font-display); font-weight: 900; font-size: 2.3em; color: #e25f55; line-height: 1; min-width: 1.2em; text-align: center; }
.tls-hud.is-danger { border-color: #ff9b8a; box-shadow: 0 0 0 0.25em rgba(255, 122, 107, 0.35), var(--shadow); }
.tls-hud.is-result .tls-radar { display: none; }
.tls-hud.is-result .tls-stars { font-size: 1.9em; margin: 0 auto; }
.tls-hud.is-result .tls-hud-main { align-items: center; text-align: center; }

.tls-level-card .ui-minigame-stage { display: flex; justify-content: center; }
/* docked on the right, like the rover's phone, so the scanner on its tripod stays in view
   (the camera slides the scanner left of it meanwhile, tls.js) */
.ui-minigame.tls-level-card { justify-self: end; align-self: center; margin-right: max(1em, 2vw); min-width: 0; width: 22em; padding: 1.6em 1.3em 1.1em; }
.ui-minigame.tls-level-card .ui-card-sub { font-size: 0.92em; margin: 0.45em 0 0.6em; }
.tls-level { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.4em; padding: 0.3em 0 0.2em; }
.tls-level-svg { width: 16.5em; height: 16.5em; overflow: visible; cursor: crosshair; touch-action: none; }
.tls-level-ring { transition: stroke 0.2s; }
.tls-level-ring.is-in { stroke: #3fae6a; }
.tls-level-note { font-weight: 700; color: var(--ink-soft, #85735a); font-size: 0.92em; min-height: 1.3em; }
.tls-level.is-done .tls-level-bubble ellipse:first-child { stroke: #3fae6a; stroke-width: 3; }
.tls-level.is-done .tls-level-svg { animation: tls-pop 0.45s both; }

/* two pages: the view on the left, the scans on the right, the gap over the fold (the
   page's own padding is 1.7em a side, so the body's middle is the spine) */
.tls-nb { display: grid; grid-template-columns: 1fr 1fr; column-gap: 3.4em; flex: 1; min-height: 0; }
.tls-nb-page { display: flex; flex-direction: column; gap: 0.55em; min-height: 0; min-width: 0; }
.tls-nb-view { position: relative; flex: 1 1 auto; min-height: 13em; border-radius: 0.9em; overflow: hidden;
  background: radial-gradient(ellipse at 50% 35%, #34405a 0%, #202838 70%, #1a2030 100%);
  box-shadow: inset 0 0 0 0.14em #151a26, 0 0.15em 0 rgba(120, 90, 40, 0.18); }
.tls-nb-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; pointer-events: auto; }
.tls-nb-view canvas:active { cursor: grabbing; }
.tls-nb-help { position: absolute; right: 0.7em; bottom: 0.5em; font-size: 0.72em; color: rgba(230, 240, 255, 0.8); pointer-events: none; padding: 0.15em 0.5em; border-radius: 0.6em; background: rgba(26, 32, 48, 0.7); }
.tls-nb-tag { position: absolute; left: 0.7em; top: 0.55em; font-size: 0.72em; font-weight: 800; color: #9dffba; letter-spacing: 0.06em; pointer-events: none; font-family: ui-monospace, Menlo, monospace; padding: 0.15em 0.5em; border-radius: 0.6em; background: rgba(26, 32, 48, 0.7); }
.tls-nb-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 2em; color: rgba(230, 240, 255, 0.8); font-weight: 700; }
.tls-nb-legend { display: flex; flex-wrap: wrap; gap: 0.4em 1em; font-size: 0.78em; color: var(--ink-soft, #85735a); align-items: center; }
.tls-nb-legend span { display: inline-flex; align-items: center; gap: 0.35em; }
.tls-nb-legend i { display: inline-block; width: 1.1em; height: 0.7em; border-radius: 0.35em; }
.tls-nb-legend .g { background: #decca4; }
.tls-nb-legend .h { width: 4.5em; background: linear-gradient(90deg, #d4e280, #82c652, #30905a, #1a5c52); }
.tls-nb-legend .x { background: #eee6ff; box-shadow: inset 0 0 0 0.12em #b6a6e0; }
.tls-nb-legend .s { background: #ff7a6b; border-radius: 50%; width: 0.7em; }
.tls-nb-page h3 { display: flex; align-items: baseline; gap: 0.5em; margin: 0.1em 0 0; }
.tls-nb-page h3 small { font: 700 0.62em/1 var(--font); color: var(--ink-soft, #85735a); margin-left: auto; }
.tls-nb .nb-stats { margin: 0; }
.tls-nb-list { list-style: none; margin: 0; padding: 0 0.3em 0 0; display: flex; flex-direction: column; gap: 0.1em; overflow: auto; flex: 1 1 0; min-height: 5em; }
.tls-nb-list li { display: grid; grid-template-columns: 1fr auto; align-items: baseline; column-gap: 0.6em; font-size: 0.9em; padding: 0.25em 0.2em; border-bottom: 0.08em dashed var(--paper-edge, #e5cf9f); }
.tls-nb-list li > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tls-nb-list b { font-family: var(--font-display); color: var(--ink, #4a3e2c); }
.tls-nb-list small { grid-column: 1 / -1; color: var(--ink-soft, #85735a); font-size: 0.86em; }
.tls-nb-list .tls-stars { font-size: 0.95em; margin-left: 0; }
.tls-nb-none { color: var(--ink-soft, #85735a); font-weight: 700; margin: 0.4em 0; }
.tls-nb-fact { font-size: 0.8em; color: var(--ink-soft, #85735a); margin: 0; line-height: 1.35; }
`;

// ---------------------------------------------------------------- the scan card

const STAR = '★';
function starsHtml(n, of = 3, pop = false) {
  let s = '';
  for (let i = 0; i < of; i++) s += `<i class="${i < n ? (pop ? 'is-pop' : '') : 'is-lost'}" style="animation-delay:${(i * 0.14).toFixed(2)}s">${STAR}</i>`;
  return s;
}

export function makeHud() {
  ensureTlsStyle();
  const el = document.createElement('div');
  el.className = 'tls-hud';
  el.innerHTML = `
    <canvas class="tls-radar" width="148" height="148"></canvas>
    <div class="tls-count" hidden></div>
    <div class="tls-hud-main">
      <div class="tls-hud-title">${icon('tls')}<span class="tls-hud-name">Laser scan</span><span class="tls-stars"></span></div>
      <div class="tls-bar"><i></i></div>
      <div class="tls-status"></div>
      <div class="tls-help"></div>
    </div>`;
  (document.getElementById('ui') || document.body).appendChild(el);
  const $ = (s) => el.querySelector(s);
  const radarEl = $('.tls-radar'), ctx = radarEl.getContext('2d');
  const name = $('.tls-hud-name'), stars = $('.tls-stars'), bar = $('.tls-bar i'), status = $('.tls-status'), help = $('.tls-help'), countEl = $('.tls-count');
  let lastStars = -1, lastStatus = '', lastTone = '', lastHelp = '', lastName = '', lastPct = -1;
  const setText = (node, text, key) => { if (text !== key) node.innerHTML = richText(text); return text; };

  function setStars(n, pop = false) {
    if (n === lastStars && !pop) return;
    lastStars = n;
    stars.innerHTML = starsHtml(n, 3, pop);
  }
  function setStatus(text, tone = '') {
    if (text !== lastStatus) { status.innerHTML = richText(text); lastStatus = text; }
    if (tone !== lastTone) {
      status.className = 'tls-status' + (tone ? ' is-' + tone : '');
      if (tone === 'bad') { void status.offsetWidth; }
      lastTone = tone;
    }
  }

  // the radar's helpers, made once (the card redraws it a dozen times a second)
  let rr = null;
  const baseEl = document.createElement('canvas');
  baseEl.width = baseEl.height = 148;
  const baseCtx = baseEl.getContext('2d');
  const YAW = new Float64Array(2), P = new Float64Array(2);
  // screen angle of a world azimuth (heading convention): up is the camera's forward
  const scr = (a) => -Math.PI / 2 - (a - rr.yaw);
  // rotated so the camera's forward (-sin yaw, -cos yaw) points up the screen
  function toScr(x, z, out) {
    const dx = x - rr.sx, dz = z - rr.sz, c = 74, scale = 68 / 12;
    out[0] = c + (dx * YAW[0] - dz * YAW[1]) * scale;
    out[1] = c + (dx * YAW[1] + dz * YAW[0]) * scale;
    return out;
  }

  return {
    el,
    show(on) { el.classList.toggle('is-on', !!on); if (!on) el.classList.remove('is-danger'); },
    // the countdown: n seconds left
    count(n, title, helpText) {
      el.classList.remove('is-result');
      countEl.hidden = false;
      radarEl.style.display = '';
      countEl.textContent = n > 0 ? String(n) : 'Go!';
      lastName = setText(name, title, lastName);
      bar.style.width = '0%'; lastPct = 0;
      setStatus('Get ready to hide!', 'warn');
      lastHelp = setText(help, helpText, lastHelp);
    },
    // s: { title, pct, stars, status, tone, help, danger }
    scan(s) {
      el.classList.remove('is-result');
      countEl.hidden = true;
      radarEl.style.display = '';
      lastName = setText(name, s.title, lastName);
      const pct = Math.round(s.pct * 100);
      if (pct !== lastPct) { bar.style.width = pct + '%'; lastPct = pct; }
      setStars(s.stars);
      setStatus(s.status, s.tone);
      lastHelp = setText(help, s.help || '', lastHelp);
      el.classList.toggle('is-danger', !!s.danger);
    },
    // r: { title, stars, line }
    result(r) {
      el.classList.add('is-result');
      el.classList.remove('is-danger');
      countEl.hidden = true;
      lastName = setText(name, r.title, lastName);
      bar.style.width = '100%'; lastPct = 100;
      lastStars = -1;
      setStars(r.stars, true);
      setStatus(r.line, r.stars >= 3 ? '' : 'calm');
      lastHelp = setText(help, r.help || '', lastHelp);
    },
    // The cover round a scan (trunks and bushes: cover [x, z, r, kind]*n round the
    // scanner at sx, sz) drawn once, north up, into a canvas of its own; each redraw
    // turns it to the camera and adds the sweep, the fan and you, a dozen canvas calls.
    cover(r) {
      const W = 148, c = W / 2, R = 68, scale = R / 12;
      baseCtx.clearRect(0, 0, W, W);
      baseCtx.fillStyle = 'rgba(38, 51, 74, 0.92)';
      baseCtx.beginPath(); baseCtx.arc(c, c, R + 4, 0, Math.PI * 2); baseCtx.fill();
      baseCtx.strokeStyle = 'rgba(200, 220, 255, 0.22)'; baseCtx.lineWidth = 1;
      for (const m of [4, 8, 12]) { baseCtx.beginPath(); baseCtx.arc(c, c, m * scale, 0, Math.PI * 2); baseCtx.stroke(); }
      baseCtx.save();
      baseCtx.beginPath(); baseCtx.arc(c, c, R, 0, Math.PI * 2); baseCtx.clip();
      // (only cover that hides you: drawn big and bright, with a pale rim)
      for (let i = 0; i < r.n; i++) {
        const o = i * 4;
        const x = c + (r.cover[o] - r.sx) * scale, y = c + (r.cover[o + 1] - r.sz) * scale;
        const bush = r.cover[o + 3] > 0.5;
        const rr2 = Math.max(bush ? 3.6 : 3.2, r.cover[o + 2] * scale * 1.15);
        baseCtx.fillStyle = bush ? 'rgba(126, 214, 110, 0.95)' : 'rgba(214, 160, 104, 1)';
        baseCtx.strokeStyle = 'rgba(255, 248, 225, 0.85)'; baseCtx.lineWidth = 1.4;
        baseCtx.beginPath(); baseCtx.arc(x, y, rr2, 0, Math.PI * 2); baseCtx.fill(); baseCtx.stroke();
      }
      baseCtx.restore();
    },
    // r: { yaw (camera), sx, sz (scanner), theta0, dir, sweep 0..1, az, px, pz, state:
    //      'open' | 'hidden' | 'safe' | 'behind' | 'scanning' | 'seen', t }
    radar(r) {
      rr = r;
      const W = 148, c = W / 2, R = 68;
      ctx.clearRect(0, 0, W, W);
      // the ground and its cover, turned so the camera's forward points up
      ctx.save();
      ctx.translate(c, c); ctx.rotate(r.yaw); ctx.translate(-c, -c);
      ctx.drawImage(baseEl, 0, 0);
      ctx.restore();
      // the swept part
      if (r.sweep > 0) {
        const a0 = scr(r.theta0), a1 = scr(r.theta0 + r.dir * r.sweep * Math.PI * 2);
        ctx.fillStyle = 'rgba(143, 214, 160, 0.38)';
        ctx.beginPath(); ctx.moveTo(c, c);
        ctx.arc(c, c, R, a0, a1, r.dir > 0);
        ctx.closePath(); ctx.fill();
      }
      // the fan
      if (r.sweep >= 0) {
        const a = scr(r.az);
        ctx.fillStyle = 'rgba(255, 90, 110, 0.18)';
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, a, a + (r.dir > 0 ? 0.28 : -0.28), r.dir < 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 90, 110, 0.95)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R); ctx.stroke();
      }
      // the scanner
      ctx.fillStyle = '#ff7a6b'; ctx.strokeStyle = '#fff4e0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c, c, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // you
      YAW[0] = Math.cos(r.yaw); YAW[1] = Math.sin(r.yaw);
      toScr(r.px, r.pz, P);
      let px = P[0], py = P[1];
      const d = Math.sqrt((px - c) * (px - c) + (py - c) * (py - c));
      if (d > R) { px = c + (px - c) * R / d; py = c + (py - c) * R / d; }
      const col = r.state === 'seen' ? '#ff4d5e' : r.state === 'open' || r.state === 'scanning' ? '#ffb347' : r.state === 'safe' || r.state === 'behind' ? '#8fd6a0' : '#bfe6ff';
      if (r.state === 'open' || r.state === 'seen' || r.state === 'scanning') {
        ctx.fillStyle = r.state === 'open' ? 'rgba(255, 179, 71, 0.3)' : 'rgba(255, 77, 94, 0.35)';
        ctx.beginPath(); ctx.arc(px, py, 9 + 2 * Math.sin(r.t * 10), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = col; ctx.strokeStyle = '#26334a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // the rim
      ctx.strokeStyle = 'rgba(255, 244, 224, 0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(c, c, R + 3, 0, Math.PI * 2); ctx.stroke();
    },
  };
}

// ---------------------------------------------------------------- the notebook page

// info: { scans: [{ n, place, stars, ghosts, bird }] (the last 8 kept), total, clean,
//         ghosts, birds (every scan made), surveyed (the lab's positions), points, hasPoints }
// The left page: the 3D view (the cloud's canvas goes in `view`) and its key. The right
// page: three stat boxes, the scans kept (newest first) and a word on the real survey.
export function renderNotebook(el, info) {
  ensureTlsStyle();
  const wrap = document.createElement('div');
  wrap.className = 'tls-nb';
  const scans = info.scans.slice(-8);
  const first = (info.total || scans.length) - scans.length;
  const rows = scans.map((s, i) => {
    const bits = [];
    if (s.ghosts) bits.push(s.ghosts === 1 ? 'a ghost to clean out' : `${s.ghosts} ghosts to clean out`);
    if (s.bird) bits.push('a bird flew through');
    if (!bits.length) bits.push('a clean scan');
    const place = s.place ? ` ${escapeHtml(s.place)}` : '';
    return `<li><span><b>Scan ${first + i + 1}</b>${place}</span><span class="tls-stars">${starsHtml(s.stars)}</span><small>${escapeHtml(bits.join(', '))}</small></li>`;
  }).reverse().join('');
  const stat = (v, label) => `<div class="nb-stat"><b>${v}</b><small>${label}</small></div>`;
  wrap.innerHTML = `
    <div class="tls-nb-page is-left">
      <div class="tls-nb-view">
        <div class="tls-nb-tag">${info.hasPoints ? `${info.points.toLocaleString('en-GB')} POINTS` : ''}</div>
        ${info.hasPoints ? '<div class="tls-nb-help">Drag to turn, scroll to zoom</div>' : '<div class="tls-nb-empty">No scans yet. Set the scanner down at a coral marker, level it and keep out of its sight!</div>'}
      </div>
      <div class="tls-nb-legend">
        <span><i class="g"></i>ground</span>
        <span><i class="h"></i>height above the ground, 0 to 20 m</span>
        <span><i class="x"></i>ghosts</span>
        <span><i class="s"></i>scan spots</span>
      </div>
    </div>
    <div class="tls-nb-page is-right">
      <div class="nb-stats" style="grid-template-columns:repeat(3,1fr)">${stat(info.total || 0, 'Scans made')}${stat(info.clean || 0, 'Clean scans')}${stat(info.ghosts || 0, 'Ghosts')}</div>
      <h3>Scan log${scans.length && info.total > scans.length ? `<small>the last ${scans.length}</small>` : ''}</h3>
      ${rows ? `<ul class="tls-nb-list">${rows}</ul>` : '<p class="tls-nb-none">Nothing scanned yet.</p>'}
      <p class="tls-nb-fact">Last October the lab scanned the whole island from ${info.surveyed} spots with a laser scanner on a tripod. Each scan is millions of points; people and birds that wandered through had to be cleaned out by hand afterwards.</p>
    </div>`;
  el.appendChild(wrap);
  return { wrap, view: wrap.querySelector('.tls-nb-view') };
}
