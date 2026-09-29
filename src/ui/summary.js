// The end-of-day card at the field station: today's catches by species, backpacks
// fitted, loggers downloaded, tasks stamped and spotted lizards, the day's score against
// the best, the lizards followed with a perch logger, and a line from James
// (src/story/script.js). Opens when the phase turns to 'summary'; its button hands over
// to onDone (back to the title). When the game is hosted with the island board's API, a
// second button puts the day on it (scoreboard.js).

import { state } from '../game/state.js';
import { SCRIPT, say } from '../story/script.js';
import { icon, escapeHtml } from './icons.js';
import { anoleSVG, crocSVG, jamesPortrait } from './drawings.js';
import { registerPanel, openPanel, closePanel, currentPanel } from './kit.js';
import { SPECIES_UI } from './notebook.js';
import { summaryBoard } from './scoreboard.js';
import { coinIcon, todaysStories } from './perch_day.js';

// Score bands for James's line.
const BANDS = [[1500, 'great'], [700, 'good'], [250, 'ok'], [0, 'quiet']];

export function buildSummary(game, { onDone }) {
  let open = false;

  function jamesLine(isBest) {
    const S = state.summary || {};
    if (S.line) return S.line;
    const lines = SCRIPT.summary || {};
    const band = BANDS.find(([min]) => state.score >= min)[1];
    let line = say(lines[band] || '', { name: state.playerName || 'friend', score: state.score });
    if (isBest && lines.best) line += ' ' + say(lines.best, { name: state.playerName });
    return line;
  }

  registerPanel('summary', {
    title: 'Survey day done!', icon: 'star', card: 'ui-summary', dismiss: false, closeButton: false, clear: true,
    render(card, arg, api) {
      const T = state.today || {};
      const caught = T.caught || {};
      const S = state.summary || {};
      const isBest = S.newBest ?? (state.score > 0 && state.score >= (state.best || 0));
      const rows = SPECIES_UI.map((u, i) => {
        const n = u.spotOnly ? null : caught[u.key] ?? caught[u.sci] ?? 0;
        const art = u.key === 'croc' ? crocSVG({ perch: false }) : anoleSVG(u.sci, { perch: false, dewlap: n > 0 });
        const seenCroc = T.crocSpotted || (state.species.croc && state.species.croc.spotted);
        const right = u.spotOnly ? `<small>${seenCroc ? 'Spotted' : 'Not seen'}</small>` : `<b>${n}</b>`;
        return `<div class="ui-catch${!u.spotOnly && !n ? ' is-zero' : ''}" style="animation-delay:${(0.1 + i * 0.07).toFixed(2)}s">${art}<span>${escapeHtml(u.common)}</span>${right}</div>`;
      }).join('');
      const tally = [
        [T.tagged || 0, 'Backpacks fitted'],
        [T.loggersRead || 0, 'Loggers downloaded'],
        [T.tasksDone || 0, 'Tasks stamped'],
        [T.spotted || 0, 'Lizards spotted'],
      ].map(([v, k], i) => `<div style="animation-delay:${(0.2 + i * 0.07).toFixed(2)}s"><b>${v}</b><small>${k}</small></div>`).join('');
      const extras = [];
      const all = Array.isArray(T.requests) ? T.requests.filter(Boolean) : [];
      const reqs = all.filter((r) => !r.mission);
      if (reqs.length) extras.push(`James's requests: ${reqs.filter((r) => r.done).length} of ${reqs.length}`);
      // the field kit's jobs finished today (src/missions): a row of their own, a small chip
      // each with its icon and stars (its name on hover and for a screen reader)
      const ORDER = ['drone', 'tls', 'rtk'];
      const kitDone = all.filter((r) => r.mission && r.done).sort((x, y) => ORDER.indexOf(x.mission) - ORDER.indexOf(y.mission));
      let kitRow = '';
      if (kitDone.length) {
        const names = { drone: 'Drone survey', tls: 'Laser scans', rtk: 'Plant survey' };
        const stars = (T.kit || {});
        kitRow = `<div class="ui-kit-row"><small>Field kit</small>` + kitDone.map((r) => {
          const n = Math.max(0, Math.min(3, stars[r.mission] || 0));
          const name = escapeHtml(names[r.mission] || r.mission);
          return `<span class="ui-kit-chip" title="${name}" aria-label="${name}${n ? ', ' + n + ' of 3 stars' : ''}">${icon(r.icon || r.mission)}` +
            (n ? `<b>${'\u2605'.repeat(n)}<i>${'\u2605'.repeat(3 - n)}</i></b>` : '') + '</span>';
        }).join('') + '</div>';
      }
      // the lizards followed today with a perch logger (src/tools/perch_loggers.js; their
      // stories were filled in as the day ended): a chip each, the logger's coin and the
      // lizard's nickname
      const followed = todaysStories();
      let followRow = '';
      if (followed.length) {
        followRow = '<div class="ui-kit-row ui-follow-row"><small>Followed lizards</small>' + followed.map((f) => {
          const name = escapeHtml(f.nick || 'Anole');
          const n = (f.dl && f.dl.length) || 0;
          const tip = `${name}: ${n ? `downloaded ${n === 1 ? 'once' : n + ' times'}` : 'collected at the day\'s end'}${f.whole ? ', a whole day' : ''}`;
          return `<span class="ui-kit-chip" title="${tip}">${coinIcon(f.col || '#ff7b54', 1.1)}${name}${f.whole ? `<b>${'★'}</b>` : ''}</span>`;
        }).join('') + '</div>';
      }
      if (T.displayCatches) extras.push(`${T.displayCatches} mid-display catch${T.displayCatches === 1 ? '' : 'es'}`);
      if (T.creepCatches) extras.push(`${T.creepCatches} caught unnoticed`);
      if (T.crocSnaps) extras.push(`${T.crocSnaps} croc snap${T.crocSnaps === 1 ? '' : 's'}!`);

      const body = document.createElement('div');
      body.innerHTML =
        `<div class="ui-card-sub">${escapeHtml(state.playerName ? state.playerName + '\'s field day on Lizard Island' : 'A field day on Lizard Island')}</div>` +
        '<div class="ui-summary-grid">' +
          `<div><h3>${icon('lizard')} Catches</h3><div class="ui-catches">${rows}</div></div>` +
          `<div><h3>${icon('check')} The day's work</h3><div class="ui-tally">${tally}</div>` +
            (extras.length ? `<div class="nb-records" style="margin-top:0.6em;text-align:center">${escapeHtml(extras.join(' · '))}</div>` : '') +
            kitRow + followRow +
            `<div class="ui-bigscore">${isBest ? '<div class="ui-ribbon">New best!</div>' : ''}<small>Score</small><b>${state.score.toLocaleString('en-GB')}</b>` +
            `<span>Best day: ${Math.max(state.best || 0, state.score).toLocaleString('en-GB')}</span></div>` +
          '</div>' +
        '</div>' +
        `<div class="ui-james"><div class="ui-dialogue-portrait">${jamesPortrait()}</div><p><b>James:</b> ${escapeHtml(jamesLine(isBest))}</p></div>` +
        `<div class="ui-summary-foot"><button type="button" class="ui-btn is-home">${icon('home')}Back to the title</button></div>`;
      card.appendChild(body);
      // the island board (scoreboard.js): an opt-in button, then the rank and the top ten;
      // nothing shows without the board's API
      summaryBoard(body);
      const btn = body.querySelector('.ui-summary-foot .ui-btn.is-home');
      btn.addEventListener('click', () => api.close('done'));
      setTimeout(() => btn.focus({ preventScroll: true }), 400);
      return () => {
        open = false;
        if (state.phase === 'summary') setTimeout(() => onDone && onDone(), 250);
      };
    },
  });

  function update() {
    if (state.phase === 'summary' && !open && currentPanel() !== 'summary') {
      open = true;
      openPanel('summary');
    } else if (state.phase !== 'summary' && currentPanel() === 'summary') {
      closePanel();
    }
  }

  return { update };
}
