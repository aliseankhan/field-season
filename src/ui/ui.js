// The game's UI as one optional system (main.js OPTIONAL_SYSTEMS, stored as game.ui):
// the kit's layers, the HUD and minimap, the big map, the notebook, the pause card,
// the title screen and the end-of-day summary. Each frame it pumps the kit (dialogue
// and mini-games), turns the notebook, map and pause actions into panels, and keeps
// the HUD, the minimap and the title camera up to date.
//
// The title's buttons call game.story (or game.flow) .start(), .continue() or .skip()
// when flow.js provides them, and fall back to a plain phase change otherwise. ?open=notebook,
// notebook:<species>, map, pause, pause:settings, settings or minigame:<name> (one registered with
// kit.registerMinigame) opens that once the game is running. window.__game.play.ui
// has small helpers for scripted tests.

import * as kit from './kit.js';
import { state, GAME_FLAGS, setPhase, load, resetAll, clearSave } from '../game/state.js';
import { buildMaps } from './minimap.js';
import { buildHud, registerPause } from './hud.js';
import { buildNotebook } from './notebook.js';
import { buildTitle } from './title.js';
import { buildSummary } from './summary.js';
import { applySettings, registerSettingsPanel } from './settings.js';
import { attachBoard } from './scoreboard.js';
import { daybookOpen } from './daybook.js';
import { attachDayLog } from '../game/daylog.js';
import { SCRIPT } from '../story/script.js';

const optional = (path) => import(path).catch(() => null);

export async function build(game) {
  kit.attach(game);
  applySettings(game); // the saved text speed, reduced motion and volumes
  document.body.classList.add('ui-on');
  if (/[?&]nohud(=(1|true|yes))?(&|$)/.test(location.search)) document.body.classList.add('ui-nohud');
  const root = document.getElementById('ui');

  const [ring, tasks, props, stakes] = await Promise.all([
    optional('../tools/ring.js'), optional('../game/tasks.js'), optional('../world/props.js'), optional('../tools/stakes.js'),
  ]);

  const maps = buildMaps(game, state, { props });
  // the survey day's own notes, and what the island board's notebook viewer draws with
  attachDayLog(game);
  attachBoard(game, { tasks });
  const notebook = buildNotebook(game, { tasksModule: tasks, maps, loadStakes: stakes && stakes.loadStakes });
  const hud = buildHud(game, { ring, maps, notebook, tasks });

  const flow = () => game.flow || game.story || null;
  const goTitle = () => {
    const f = flow();
    if (f && typeof f.toTitle === 'function') f.toTitle();
    else setPhase('title');
  };
  // "Reset save" in the settings (after its question): a blank notebook and the title
  let title = null;
  const resetSave = () => {
    clearSave();
    resetAll();
    const f = flow();
    if (state.phase !== 'title') {
      if (f && typeof f.toTitle === 'function') f.toTitle({ save: false });
      else setPhase('title');
    }
    if (f && typeof f.clearWorld === 'function') f.clearWorld();
    if (title) title.refresh();
    kit.toast('Save cleared. A fresh notebook is waiting.', { icon: 'reset', tone: 'info' });
  };
  kit.registerPanel('pause', registerPause(game, { onTitle: goTitle, onReset: resetSave }));
  registerSettingsPanel(game, { onReset: resetSave });

  title = buildTitle(game, {
    onSettings: () => kit.openPanel('settings'),
    onChoice(choice) {
      const f = flow();
      if (f && typeof f[choice] === 'function') { f[choice](); return; }
      if (choice === 'start') { resetAll(); setPhase('intro'); }
      else if (choice === 'continue') { load(); setPhase('survey'); }
      else setPhase('survey');
    },
  });
  const summary = buildSummary(game, { onDone: goTitle });

  // layers, bottom to top: HUD, title, hint, dialogue, panels and mini-games, toasts, stamps
  root.appendChild(hud.el);
  root.appendChild(title.el);
  kit.initLayers();

  // scripted tests: window.__game.play.ui.open('notebook', 'green'), .close(), .panel(), .toast(text)
  game.play = Object.assign(game.play || {}, {
    ui: {
      open: (id, arg) => kit.openPanel(id, arg),
      close: () => kit.closePanel(),
      panel: () => kit.currentPanel(),
      modal: () => kit.modalKind(),
      page: (p) => notebook.show(p),
      toast: (text, o) => kit.toast(text, o),
      title: (c) => title.choose(c),
    },
  });

  // ?open=...
  let openAt = GAME_FLAGS.open ? 1.2 : -1;
  let openTries = 0;
  function openFlag() {
    const o = String(GAME_FLAGS.open);
    if (o === 'notebook' || o.startsWith('notebook:')) kit.openPanel('notebook', o.slice(9) || undefined); // notebook:green, notebook:kit:rtk
    else if (o === 'map' || o === 'pause' || o === 'settings') kit.openPanel(o);
    else if (o === 'pause:settings') kit.openPanel('pause', 'settings');
    else if (o.startsWith('minigame:')) {
      const name = o.slice(9);
      if (kit.hasMinigame(name)) kit.openMinigame(name);
      else if (++openTries < 40) return false; // not registered yet
    }
    return true;
  }

  let t0 = 0, lastTodayPage = null;
  // while the loop pole is up, Tab moves to the next lizard instead of opening the notebook
  const poleUp = () => !!(game.catching && game.catching.loopPole && game.catching.loopPole.aiming);
  const playing = () => state.phase === 'setup' || state.phase === 'survey';
  function update(dt, t) {
    t0 += dt;
    kit.vars.name = state.playerName;
    kit.vars.looks = state.looks;
    // without flow.js nothing leaves 'boot': show the title (or ?phase=)
    if (state.phase === 'boot' && !flow() && t0 > 2) setPhase(GAME_FLAGS.phase || 'title');

    kit.pump(dt, t);
    const inp = game.input;
    const ringOpen = (game.tools && game.tools.open) || (game.ring && game.ring.open);
    const busyNotPanel = kit.modalKind() === 'dialogue' || kit.modalKind() === 'minigame';
    // (another player's notebook from the island board keeps its own keys: a gamepad's
    // pause never reaches the card under it)
    if (!ringOpen && !daybookOpen()) {
      if (inp.pressed('pause')) {
        if (!kit.escape() && !busyNotPanel && (playing() || state.phase === 'intro')) kit.openPanel('pause');
      } else if (inp.pressed('notebook') && !busyNotPanel && playing() && !(inp.pressed('next') && poleUp())) {
        const story = game.story;
        if (kit.currentPanel() === 'notebook') kit.closePanel();
        // in the opening the notebook is out on the island until it is found
        else if (story && story.notebookFound === false) kit.toast(SCRIPT.opening.noNotebook, { icon: 'book', tone: 'info' });
        else {
          // the first N after the Today card's task changes opens that task's species page
          const want = hud.todayPage();
          if (want && want !== lastTodayPage) { lastTodayPage = want; kit.openPanel('notebook', want); } else kit.openPanel('notebook');
        }
      } else if (inp.pressed('map') && !busyNotPanel && playing()) {
        if (kit.currentPanel() === 'map') kit.closePanel(); else kit.openPanel('map');
      }
    }

    hud.update(dt);
    maps.update(dt);
    title.update(dt, t);
    summary.update(dt);
    if (openAt >= 0 && t0 > openAt && state.phase !== 'boot') {
      if (openFlag()) openAt = -1; else openAt = t0 + 0.25;
    }
  }

  return {
    update, kit, hud, maps, notebook, title, summary,
    // DOM and a 2D canvas only: nothing in the three.js scene
    get stats() { return { drawCalls: 0, panel: kit.currentPanel(), modal: kit.modalKind(), trails: maps.trails.size }; },
  };
}
