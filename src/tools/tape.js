// The tape measure: [E] on a lizard within RULES.reach.tape before you catch it
// tapes its perch height (to the half metre, as the notebook records it). The perch
// card then shows the taped height, the catch earns RULES.points.tapeHeight, and three
// taped catches stamp a field task; without the tape the card has only a guess by eye.
// With no lizard near, it says how far the nearest grid flag is.

import * as THREE from 'three';
import { state, RULES, dayKey, perchHeight } from '../game/state.js';
import { events } from '../core/events.js';
import * as kit from '../ui/kit.js';
import { registerTool } from './ring.js';

const PERCH = { trunk: 'a trunk', branch: 'a branch', ground: 'the ground', palm_stem: 'a palm stem', root: 'a root', leaf: 'a leaf', palm_frond: 'a palm frond', log: 'a log' };

export async function build(game) {
  const { player } = game;
  const fwd = new THREE.Vector3(), to = new THREE.Vector3();

  // the shown lizard in front within reach, the one faced most squarely first (a
  // lizard off to one side counts up to 1.5 times as far), so the tape takes the lizard
  // the player has walked up to rather than a nearer one beside it
  function lizardAhead() {
    fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
    let best = null, bs = Infinity;
    const L = game.lizards;
    if (!L || !L.all) return null;
    for (const lz of L.all) {
      if (!lz.visible || !lz.pos) continue;
      to.set(lz.pos.x - player.position.x, 0, lz.pos.z - player.position.z);
      const d = to.length();
      if (d > RULES.reach.tape || d < 0.01) continue;
      const c = to.dot(fwd) / d;
      if (c < 0.2) continue;
      const s = d * (1.6 - 0.6 * c);
      if (s < bs) { bs = s; best = lz; }
    }
    return best;
  }

  function tape(lz) {
    if (!lz.tag || typeof lz.tag !== 'object') lz.tag = {};
    const h = perchHeight(lz);
    const where = PERCH[lz.perch] || 'its perch';
    const again = lz.tag.tapeDay === dayKey();
    lz.tag.tapeDay = dayKey();
    lz.tag.tapeHeight = h;
    kit.toast(h < 0.25 ? `Taped: on ${where}, right at ground level` : `Taped: on ${where}, ${h.toFixed(1).replace(/\.0$/, '')} m up. Now catch it!`, { icon: 'tape', tone: 'info' });
    if (!again && state.phase === 'survey') events.emit('tape:measured', { lizard: lz, height: h });
  }

  function measureFlag() {
    let flag = null, fd = Infinity;
    for (const f of state.flags) {
      if (f.x == null) continue;
      const d = Math.hypot(f.x - player.position.x, f.z - player.position.z);
      if (d < fd) { fd = d; flag = f; }
    }
    if (flag) kit.toast(`Flag *${flag.id}* is ${Math.max(1, Math.round(fd))} m away`, { icon: 'tape', tone: 'info' });
    else kit.toast('Nothing to measure here', { icon: 'tape', tone: 'info' });
  }

  const offer = { score: 0.2, prompt: '[E] Measure', run: measureFlag, lizard: null };
  const tapeOffered = () => { if (offer.lizard) tape(offer.lizard); };
  registerTool({
    id: 'tape', name: 'Tape measure', icon: 'tape', key: 5, pose: 'hold', order: 5,
    suggestFor(ctx) {
      if (ctx.tool !== 'tape') return null;
      const lz = lizardAhead();
      if (lz && lz.tag && lz.tag.tapeDay === dayKey()) {
        offer.score = 0.6;
        offer.prompt = 'Perch taped. Take out the loop pole [1] and catch it!';
        offer.run = null;
        offer.lizard = null;
      } else if (lz) {
        offer.score = 0.6;
        offer.prompt = '[E] Tape its perch height';
        offer.run = tapeOffered;
        offer.lizard = lz;
      } else {
        offer.score = 0.2;
        offer.prompt = '[E] Measure how far the nearest flag is';
        offer.run = measureFlag;
        offer.lizard = null;
      }
      return offer;
    },
  });
  return { update() {} };
}
