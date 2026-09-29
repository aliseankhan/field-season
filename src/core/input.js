// Abstract input actions. Game code reads actions, never keys:
//   move     analogue {x, y}: x to the right, y forward, length at most 1
//   look     orbit delta this frame {x, y}, in pixel-like units
//   zoom     wheel delta this frame (positive zooms out)
//   creep, jog, aim, use, notebook, pause   buttons: down(name), pressed(name)
//   tool (hold for the tool ring), tool1..tool6 (quick select), stow, map
//   next, prev   the next or previous target while aiming (Tab; a gamepad's d-pad)
//   climb, descend  a mission's own up and down (the drone: Space climbs, Ctrl or C
//                descends; a gamepad's d-pad up and down), unused on foot
// Keyboard, mouse and gamepad are sources that write into the same frame
// state; a WebXR controller can be added with addSource(fn). A key can stand for
// more than one action (Tab is 'notebook' and 'next'); the game decides which counts.

const BUTTONS = ['creep', 'jog', 'aim', 'use', 'notebook', 'pause',
  'tool', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5', 'tool6', 'stow', 'map', 'next', 'prev', 'climb', 'descend'];

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'jog', ShiftRight: 'jog',
  ControlLeft: ['creep', 'descend'], ControlRight: ['creep', 'descend'],
  Space: 'climb', KeyC: 'descend',
  KeyF: 'aim',
  KeyE: 'use', Enter: 'use',
  KeyN: 'notebook', Tab: ['notebook', 'next'],
  Escape: 'pause', KeyP: 'pause',
  KeyQ: 'tool',
  Digit1: 'tool1', Digit2: 'tool2', Digit3: 'tool3', Digit4: 'tool4', Digit5: 'tool5', Digit6: 'tool6',
  Numpad1: 'tool1', Numpad2: 'tool2', Numpad3: 'tool3', Numpad4: 'tool4', Numpad5: 'tool5', Numpad6: 'tool6',
  KeyX: 'stow',
  KeyM: 'map',
};

const DEADZONE = 0.18;
// With Ctrl held (the creep key) the browser's own chords would fire: these cannot be
// stopped (new window, new tab, close, switch tab), so they are left alone, and the
// quick-select digits are ignored while Ctrl is down (Ctrl+1..6 switch tabs).
const RESERVED = new Set(['KeyW', 'KeyN', 'KeyT', 'Tab']);
const isDigit = (code) => /^(Digit|Numpad)[0-9]$/.test(code);

export class Input {
  constructor(element) {
    this.element = element;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.lastLookTime = -Infinity; // performance.now() of the last manual orbit
    this.enabled = true;

    this._keys = new Set();
    this._taps = new Set(); // keys pressed since the last frame, so a quick tap is never lost
    this._held = Object.fromEntries(BUTTONS.map((b) => [b, false]));
    this._prev = { ...this._held };
    this._pressed = { ...this._held };
    this._mouse = { down: false, button: -1, x: 0, y: 0, moved: 0, t: 0 };
    this._lookAcc = { x: 0, y: 0 };
    this._zoomAcc = 0;
    this._clickUse = false;
    this._mouseAim = false;
    this._sources = [];
    this._pads = 0;
    this._frame = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: { ...this._held } };

    this._bind();
  }

  down(name) { return this._held[name] === true; }
  pressed(name) { return this._pressed[name] === true; }

  // fn(frame, dt) may add to frame.move / frame.look and set frame.held[name] = true.
  addSource(fn) {
    this._sources.push(fn);
    return () => { this._sources = this._sources.filter((s) => s !== fn); };
  }

  // Call once at the start of each frame.
  update(dt) {
    const f = this._frame;
    f.move.x = 0; f.move.y = 0;
    f.look.x = this._lookAcc.x; f.look.y = this._lookAcc.y;
    for (const b of BUTTONS) f.held[b] = false;

    if (this.enabled) {
      const k = this._keys;
      f.move.x += (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
      f.move.y += (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0);
      for (const b of BUTTONS) if (k.has(b) || this._taps.has(b)) f.held[b] = true;
      if (this._mouseAim) f.held.aim = true;
      if (this._clickUse) f.held.use = true;
      this._pollGamepad(f, dt);
      for (const s of this._sources) s(f, dt);
    }

    const len = Math.hypot(f.move.x, f.move.y);
    const s = len > 1 ? 1 / len : 1;
    this.move.x = f.move.x * s;
    this.move.y = f.move.y * s;
    this.look.x = f.look.x;
    this.look.y = f.look.y;
    if (f.look.x !== 0 || f.look.y !== 0) this.lastLookTime = performance.now();
    this.zoom = this._zoomAcc;

    for (const b of BUTTONS) {
      this._held[b] = f.held[b];
      this._pressed[b] = f.held[b] && !this._prev[b];
      this._prev[b] = f.held[b];
    }
  }

  // Call once at the end of each frame: clears the per-frame deltas.
  endFrame() {
    this._lookAcc.x = 0;
    this._lookAcc.y = 0;
    this._zoomAcc = 0;
    this._clickUse = false;
    this._taps.clear();
  }

  _pollGamepad(f, dt) {
    if (this._pads === 0 || !navigator.getGamepads) return; // getGamepads allocates, so skip it until one connects
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (!p || !p.connected || p.axes.length < 2) continue;
      const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
      f.move.x += dz(p.axes[0]);
      f.move.y -= dz(p.axes[1]);
      if (p.axes.length >= 4) {
        f.look.x += dz(p.axes[2]) * 700 * dt;
        f.look.y += dz(p.axes[3]) * 500 * dt;
      }
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      if (b(0)) f.held.use = true;
      if (b(4)) f.held.creep = true;
      if (b(5)) f.held.jog = true;
      if (b(6) || b(7)) f.held.aim = true;
      if (b(3)) f.held.notebook = true;
      if (b(9)) f.held.pause = true;
      if (b(2)) f.held.tool = true;
      if (b(1)) f.held.stow = true;
      if (b(8)) f.held.map = true;
      if (b(14)) f.held.prev = true;
      if (b(15)) f.held.next = true;
      if (b(12)) f.held.climb = true;
      if (b(13)) f.held.descend = true;
    }
  }

  _bind() {
    const el = this.element;
    const typing = (e) => e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    // Enter on a focused button presses the button, not [E] as well (a card's "Back to
    // the field" would otherwise also talk to James on the next frame)
    const onControl = (e) => e.target && e.target.closest && !!e.target.closest('button, a, [role=button]');

    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      // a chord with Cmd gets no keyup on some systems: never map it, and let go of what is held
      if (e.metaKey) { if (e.code.startsWith('Meta')) this._keys.clear(); return; }
      const a = KEYMAP[e.code];
      if (!a) return;
      if ((e.code === 'Enter' || e.code === 'Space') && onControl(e)) return;
      // (W still walks: creeping forward is Ctrl+W, which the story's leave guard covers)
      if (e.ctrlKey && (isDigit(e.code) || (RESERVED.has(e.code) && e.code !== 'KeyW'))) return;
      if (typeof a === 'string') { this._keys.add(a); this._taps.add(a); }
      else for (const x of a) { this._keys.add(x); this._taps.add(x); }
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
      // creeping (Ctrl) with a game key: no Find, Save, Print or Select all
      else if (e.ctrlKey && !RESERVED.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code.startsWith('Meta')) { this._keys.clear(); return; }
      const a = KEYMAP[e.code];
      if (typeof a === 'string') this._keys.delete(a);
      else if (a) for (const x of a) this._keys.delete(x);
    });
    window.addEventListener('gamepadconnected', () => { this._pads++; });
    window.addEventListener('gamepaddisconnected', () => { this._pads = Math.max(0, this._pads - 1); });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._mouse.down = false;
      this._mouseAim = false;
    });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.focus?.();
      if (e.button === 2) { this._mouseAim = true; return; }
      const m = this._mouse;
      m.down = true; m.button = e.button; m.x = e.clientX; m.y = e.clientY; m.moved = 0; m.t = performance.now();
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const m = this._mouse;
      if (!m.down) return;
      const dx = e.clientX - m.x, dy = e.clientY - m.y;
      m.x = e.clientX; m.y = e.clientY;
      m.moved += Math.abs(dx) + Math.abs(dy);
      this._lookAcc.x += dx;
      this._lookAcc.y += dy;
    });
    const up = (e) => {
      if (e.button === 2) { this._mouseAim = false; return; }
      const m = this._mouse;
      if (!m.down) return;
      m.down = false;
      if (m.moved < 6 && performance.now() - m.t < 350) this._clickUse = true;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this._zoomAcc += e.deltaY * scale;
    }, { passive: false });
  }
}
