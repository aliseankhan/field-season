// Tying a fresh dental-floss loop on the pole: trace once round the dotted loop
// with the pointer (press and drag), or hold [E] and let it wind round at a steady
// pace. The floss follows your trace; a neat trace scores better.

import { el, ensureStoryStyle } from './style.js';

const CX = 262, CY = 116, R = 80; // the loop in the SVG's own units (440 x 236)
const TOL = 26; // how far off the dotted line still counts
const HOLD_RATE = 1.15; // radians a second when holding [E]

export function flossMinigame() {
  return {
    name: 'floss',
    title: 'Tie a fresh floss loop',
    icon: 'loop_pole',
    instructions: 'Trace round the dotted loop: *press and drag*, or hold [E].',
    timeLimit: 30,
    mount(stage, api) {
      ensureStoryStyle();
      const root = el('div', 'st-floss');
      root.innerHTML = `
        <svg viewBox="0 0 440 236" class="st-floss-svg">
          <defs><radialGradient id="stFlossGlow"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient></defs>
          <circle cx="${CX}" cy="${CY}" r="${R + 34}" fill="url(#stFlossGlow)"/>
          <path d="M20 230 L${CX - R - 6} ${CY + 6}" stroke="#b08f4f" stroke-width="15" stroke-linecap="round"/>
          <path d="M20 230 L${CX - R - 6} ${CY + 6}" stroke="#d9b56c" stroke-width="10" stroke-linecap="round"/>
          <g stroke="#b08f4f" stroke-width="4">${[0.25, 0.5, 0.75].map((f) => {
            const x = 20 + (CX - R - 26) * f, y = 230 + (CY + 6 - 230) * f;
            return `<line x1="${x - 6}" y1="${y - 5}" x2="${x + 6}" y2="${y + 5}"/>`;
          }).join('')}</g>
          <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e5cf9f" stroke-width="${TOL * 1.6}" stroke-opacity="0.35"/>
          <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#c9a86a" stroke-width="3" stroke-dasharray="3 9" stroke-linecap="round"/>
          <path class="st-floss-line" d="" fill="none" stroke="#6fb7d6" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
          <path class="st-floss-line2" d="" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle class="st-floss-knot" cx="${CX - R}" cy="${CY}" r="9" fill="#ff8a5c" stroke="#fff" stroke-width="3"/>
          <circle class="st-floss-tip" cx="${CX - R}" cy="${CY}" r="7" fill="#fff" stroke="#3fb0ad" stroke-width="3"/>
          <text class="st-floss-pct" x="${CX}" y="${CY + 8}" text-anchor="middle">0%</text>
        </svg>`;
      stage.appendChild(root);
      const svg = root.querySelector('svg');
      const line = root.querySelector('.st-floss-line'), line2 = root.querySelector('.st-floss-line2');
      const tip = root.querySelector('.st-floss-tip'), pct = root.querySelector('.st-floss-pct');
      const start = Math.PI; // the knot, at the loop's left where the pole meets it
      let angle = 0; // radians traced (signed, whichever way round)
      let dir = 0;
      let errSum = 0, errN = 0;
      let dragging = false, over = false, space = false;
      const pts = [];
      const toSvg = (e) => {
        const r = svg.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (440 / r.width), y: (e.clientY - r.top) * (236 / r.height) };
      };
      const angleAt = (a) => {
        let d = a - (start + angle);
        d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        return d;
      };
      const draw = () => {
        let d = '';
        pts.forEach((p, i) => { d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); });
        line.setAttribute('d', d);
        line2.setAttribute('d', d);
        const a = start + angle;
        tip.setAttribute('cx', (CX + Math.cos(a) * R).toFixed(1));
        tip.setAttribute('cy', (CY + Math.sin(a) * R).toFixed(1));
        pct.textContent = Math.min(100, Math.round(Math.abs(angle) / (Math.PI * 2) * 100)) + '%';
      };
      const advance = (da, x, y, err) => {
        if (over) return;
        if (dir === 0 && Math.abs(da) > 0.02) dir = Math.sign(da);
        if (dir === 0 || Math.sign(da) !== dir) return;
        angle += da;
        pts.push([x, y]);
        if (pts.length > 600) pts.splice(1, 1);
        errSum += err; errN++;
        draw();
        if (Math.abs(angle) >= Math.PI * 2 - 0.05) {
          over = true;
          root.classList.add('is-done');
          const q = Math.max(0.35, 1 - (errSum / Math.max(1, errN)) / TOL);
          setTimeout(() => api.done({ success: true, quality: q, label: q > 0.8 ? 'Perfect loop!' : 'Tied!' }), 700);
        }
      };
      pts.push([CX - R, CY]);
      draw();
      const onMove = (e) => {
        if (!dragging || over) return;
        const p = toSvg(e);
        const dx = p.x - CX, dy = p.y - CY;
        const rr = Math.hypot(dx, dy);
        const err = Math.abs(rr - R);
        if (err > TOL * 1.6) { root.classList.add('is-off'); return; }
        root.classList.remove('is-off');
        const d = angleAt(Math.atan2(dy, dx));
        if (Math.abs(d) > 0.9) return; // too far ahead of the floss: follow the line
        advance(d, CX + Math.cos(start + angle + d) * (R + Math.sign(rr - R) * Math.min(err, 10)), CY + Math.sin(start + angle + d) * (R + Math.sign(rr - R) * Math.min(err, 10)), err);
      };
      const onDown = (e) => { e.preventDefault(); dragging = true; onMove(e); };
      const onUp = () => { dragging = false; };
      const onKey = (e) => { if (e.code === 'Space') { space = e.type === 'keydown'; e.preventDefault(); } };
      svg.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKey, true);
      let wob = 0;
      return {
        update(dt, t) {
          if (over) return;
          const auto = window.__game && window.__game.play && window.__game.play.auto;
          const hold = space || auto || (api.input && api.input.down('use'));
          if (hold && !dragging) {
            if (dir === 0) dir = 1;
            wob += dt;
            const da = dir * HOLD_RATE * (auto ? 3 : 1) * dt;
            const a = start + angle + da;
            const w = Math.sin(wob * 9) * 5;
            advance(da, CX + Math.cos(a) * (R + w), CY + Math.sin(a) * (R + w), 8 + Math.abs(w));
          }
        },
        timeout() {
          // out of time: a loop more than half traced still gets tied, a bit loose
          if (Math.abs(angle) > Math.PI) api.done({ success: true, quality: 0.3, label: 'A bit loose!' });
          else api.done({ success: false, quality: 0, timeout: true });
        },
        destroy() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('keyup', onKey, true);
        },
      };
    },
  };
}
