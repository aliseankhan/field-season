// Level the scanner: a round bubble level on the tribrach. The bubble drifts and wobbles
// (the ground is soft and the tripod settles); steer it into the middle ring with the
// mouse (it floats towards the pointer) or the move keys, and hold it there until the
// ring fills. No way to fail: it only takes longer, and after a while the tripod settles
// and the wobble eases. A kit mini-game card (ui/kit.js).
//
//   levelMinigame({ difficulty 0..1, hold: true (never finishes, for screenshots) })
//     -> spec for kit.minigame(); resolves { success, quality, seconds }

import { audio } from '../audio/index.js';
import { ensureTlsStyle } from './tls_ui.js';

const RING = 0.22; // the middle ring's radius, in vial radii
const HOLD = 1.1; // seconds in the ring
const EDGE = 0.8; // how far the bubble can go

export function levelMinigame(opts = {}) {
  const diff = Math.max(0, Math.min(1, opts.difficulty ?? 0.3));
  return {
    name: 'tls-level',
    title: 'Level the scanner',
    icon: 'tls',
    card: 'tls-level-card',
    width: '21em',
    instructions: 'Steer the bubble into the *middle ring* with the mouse or [W] [A] [S] [D], and hold it there.',
    mount(stage, api) {
      ensureTlsStyle();
      const root = document.createElement('div');
      root.className = 'tls-level';
      root.innerHTML = `
        <svg class="tls-level-svg" viewBox="-142 -142 284 284" aria-hidden="true">
          <defs>
            <radialGradient id="tlsBrass" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#ffe7a3"/><stop offset="0.7" stop-color="#e8b14e"/><stop offset="1" stop-color="#c98a22"/></radialGradient>
            <radialGradient id="tlsLiquid" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#f4fbe4"/><stop offset="0.75" stop-color="#cdeeb4"/><stop offset="1" stop-color="#a9dc98"/></radialGradient>
            <radialGradient id="tlsBub" cx="0.38" cy="0.32" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#f3fff4" stop-opacity="0.95"/><stop offset="1" stop-color="#d3f0ff" stop-opacity="0.85"/></radialGradient>
          </defs>
          <circle r="118" fill="url(#tlsBrass)" stroke="#a8741f" stroke-width="3"/>
          <g class="tls-level-knobs"></g>
          <circle r="100" fill="url(#tlsLiquid)" stroke="#7f6a3a" stroke-width="2.5"/>
          <circle r="66" fill="none" stroke="#7fb07a" stroke-width="1.5" stroke-dasharray="3 5" opacity="0.7"/>
          <path d="M-96 0H96M0 -96V96" stroke="#7fb07a" stroke-width="1" opacity="0.45"/>
          <circle class="tls-level-hold" r="${(RING * 100 + 9).toFixed(1)}" fill="none" stroke="#3fae6a" stroke-width="7" stroke-linecap="round" transform="rotate(-90)"/>
          <circle class="tls-level-ring" r="${(RING * 100).toFixed(1)}" fill="none" stroke="#ff7a6b" stroke-width="4"/>
          <g class="tls-level-bubble">
            <ellipse rx="19" ry="17" fill="url(#tlsBub)" stroke="#8ab4c4" stroke-width="2"/>
            <ellipse cx="-6" cy="-6" rx="6" ry="4" fill="#ffffff" opacity="0.95"/>
          </g>
          <ellipse cx="-38" cy="-52" rx="30" ry="12" fill="#ffffff" opacity="0.22" transform="rotate(-30)"/>
        </svg>
        <div class="tls-level-note"></div>`;
      stage.appendChild(root);
      const svg = root.querySelector('svg');
      const bubble = root.querySelector('.tls-level-bubble');
      const ringEl = root.querySelector('.tls-level-ring');
      const holdEl = root.querySelector('.tls-level-hold');
      const note = root.querySelector('.tls-level-note');
      const knobs = root.querySelector('.tls-level-knobs');
      const circ = 2 * Math.PI * (RING * 100 + 9);
      holdEl.setAttribute('stroke-dasharray', `0 ${circ.toFixed(1)}`);
      // three levelling knobs round the rim that turn as you steer
      const knobEls = [];
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k / 3) * Math.PI * 2;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${(Math.cos(a) * 124).toFixed(1)} ${(Math.sin(a) * 124).toFixed(1)})`);
        g.innerHTML = '<circle r="14" fill="#ffcf3f" stroke="#a8741f" stroke-width="2.5"/><g class="spin"><path d="M-9 0H9M0 -9V9" stroke="#a8741f" stroke-width="3" stroke-linecap="round"/></g>';
        knobs.appendChild(g);
        knobEls.push({ el: g.querySelector('.spin'), a, turn: 0 });
      }

      // the bubble, in vial radii (x right, y down on screen)
      const b = { x: 0.55, y: -0.35, vx: 0, vy: 0 };
      const ph = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
      let t = 0, hold = 0, inRing = false, over = false, pointer = null, pointerT = -9;
      const onMove = (e) => {
        const r = svg.getBoundingClientRect();
        if (!r.width) return;
        pointer = { x: ((e.clientX - r.left) / r.width * 260 - 130) / 100, y: ((e.clientY - r.top) / r.height * 260 - 130) / 100 };
        pointerT = t;
      };
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerdown', onMove);
      const finish = () => {
        over = true;
        root.classList.add('is-done');
        audio.cue('tlsLevelled');
        const q = Math.max(0.35, Math.min(1, 1.15 - t / 14));
        setTimeout(() => api.done({ success: true, quality: q, seconds: t, label: q >= 0.85 ? 'Level!' : 'Level enough!' }), 520);
      };

      return {
        update(dt) {
          if (over) return;
          t += dt;
          const auto = window.__game && window.__game.play && window.__game.play.auto;
          // the tripod settling: a slow drift round the vial and a wobble, both easing
          // off after 18 s so nobody is stuck
          const calm = t > 18 ? Math.max(0.25, 1 - (t - 18) / 10) : 1;
          const dk = (0.42 + 0.35 * diff) * calm, wk = (0.3 + 0.35 * diff) * calm;
          let fx = dk * Math.cos(t * 0.47 + ph[0]) + wk * (Math.sin(t * 2.3 + ph[1]) + 0.6 * Math.sin(t * 3.7 + ph[2]));
          let fy = dk * Math.sin(t * 0.39 + ph[0] * 1.3) + wk * (Math.cos(t * 2.1 + ph[2]) + 0.6 * Math.cos(t * 4.1 + ph[1]));
          // the player: keys push, the pointer pulls
          let cx = 0, cy = 0;
          const inp = api.input;
          if (inp) { cx += inp.move.x * 2.3; cy -= inp.move.y * 2.3; }
          if (pointer && t - pointerT < 1.5) {
            const dx = pointer.x - b.x, dy = pointer.y - b.y, d = Math.hypot(dx, dy);
            if (d > 1e-3) { const k = 2.6 * Math.min(1, d / 0.35); cx += (dx / d) * k; cy += (dy / d) * k; }
          }
          if (auto || opts.hold) {
            // scripted runs steer it home (a screenshot keeps it hovering near the ring)
            const tx = opts.hold ? 0.3 * Math.cos(t * 0.8) : 0, ty = opts.hold ? 0.3 * Math.sin(t * 0.8) : 0;
            const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
            if (d > 1e-3) { const k = 3 * Math.min(1, d / 0.25); cx += (dx / d) * k; cy += (dy / d) * k; }
          }
          fx += cx; fy += cy;
          b.vx = (b.vx + fx * dt) * Math.exp(-2.8 * dt);
          b.vy = (b.vy + fy * dt) * Math.exp(-2.8 * dt);
          b.x += b.vx * dt; b.y += b.vy * dt;
          const r = Math.hypot(b.x, b.y);
          if (r > EDGE) { b.x *= EDGE / r; b.y *= EDGE / r; const vn = (b.vx * b.x + b.vy * b.y) / EDGE; if (vn > 0) { b.vx -= 1.6 * vn * b.x / EDGE; b.vy -= 1.6 * vn * b.y / EDGE; } }
          const was = inRing;
          inRing = Math.hypot(b.x, b.y) < RING;
          if (inRing && !was) audio.cue('tlsBubble', true);
          hold = inRing ? hold + dt : Math.max(0, hold - dt * 1.6);
          if (opts.hold) hold = Math.min(hold, HOLD * 0.62);
          // drawn: the bubble squashes along its speed, the ring glows when it is in
          const sp = Math.hypot(b.vx, b.vy), ang = Math.atan2(b.vy, b.vx) * 180 / Math.PI;
          const sq = Math.min(0.28, sp * 0.35);
          bubble.setAttribute('transform', `translate(${(b.x * 100).toFixed(1)} ${(b.y * 100).toFixed(1)}) rotate(${ang.toFixed(0)}) scale(${(1 + sq).toFixed(3)} ${(1 - sq * 0.6).toFixed(3)}) rotate(${(-ang).toFixed(0)})`);
          ringEl.classList.toggle('is-in', inRing);
          holdEl.setAttribute('stroke-dasharray', `${(circ * Math.min(1, hold / HOLD)).toFixed(1)} ${circ.toFixed(1)}`);
          holdEl.style.opacity = hold > 0.02 ? 1 : 0;
          for (const k of knobEls) {
            k.turn += (cx * Math.cos(k.a) + cy * Math.sin(k.a)) * dt * 90;
            k.el.setAttribute('transform', `rotate(${k.turn.toFixed(0)})`);
          }
          note.textContent = inRing ? (hold > HOLD * 0.5 ? 'Nearly... hold it!' : 'In the ring! Hold it there') : t > 18 ? 'The tripod is settling. Easy does it' : 'The bubble floats towards the pointer';
          if (hold >= HOLD && !opts.hold) finish();
        },
        destroy() {
          root.removeEventListener('pointermove', onMove);
          root.removeEventListener('pointerdown', onMove);
        },
      };
    },
  };
}
