// Player collision: a spatial hash of the collider circles from colliders.json
// and tests against the terrain grid (only walkable cells may be stood on;
// water, thicket and the far banks are blocked). Movement is sub-stepped and
// resolved by pushing out of circles and blocked cells, which slides the
// player smoothly along edges. A few moving circles (addDynamic) can join in,
// such as a crocodile lying on the shore.

const HASH_CELL = 2.0;

export class Collision {
  // extra: more circles in the colliders.json shape ({circles, owners}), such as the
  // vegetation's solid bushes and the props; they follow the data circles in the arrays.
  // isTrunk(i) marks data circles that are trunks (r = dbh / 2 + 0.15); those shrink
  // by trunkShrink, so the player meets a trunk at a smaller radius than a bush and
  // the chest nearly touches the bark instead of stopping 30 cm short.
  constructor(data, { radius = 0.28, gridRadius = 0.18, maxStep = 0.1, extra = null, trunkShrink = 0, isTrunk = null } = {}) {
    this.terrain = data.terrain;
    this.radius = radius;
    this.gridRadius = gridRadius;
    this.maxStep = maxStep;
    const base = data.colliders;
    const circles = extra ? base.circles.concat(extra.circles) : base.circles;
    this.owners = extra ? base.owners.concat(extra.owners) : base.owners;
    this.dataCount = base.circles.length;
    this.n = circles.length;
    this.cx = new Float32Array(this.n);
    this.cz = new Float32Array(this.n);
    this.cr = new Float32Array(this.n);
    this.trunks = 0;
    circles.forEach(([x, z, r], i) => {
      this.cx[i] = x; this.cz[i] = z; this.cr[i] = r;
      if (trunkShrink > 0 && isTrunk && i < this.dataCount && isTrunk(i)) {
        this.cr[i] = Math.max(0.05, r - trunkShrink);
        this.trunks++;
      }
    });
    this._buildHash();
    this.logs = (data.spawns && data.spawns.logs) || [];
    this._p = { x: 0, z: 0 };
    // Moving circles (a crocodile resting on the shore): not in the hash, a short
    // list checked after it. Each is [x, z, r]; r = 0 switches one off.
    this.dynamic = [];
  }

  // Adds a moving solid circle and returns its handle for setDynamic / removeDynamic.
  addDynamic(x, z, r) {
    const d = [x, z, r];
    this.dynamic.push(d);
    return d;
  }

  setDynamic(handle, x, z, r = handle[2]) {
    handle[0] = x; handle[1] = z; handle[2] = r;
  }

  removeDynamic(handle) {
    const i = this.dynamic.indexOf(handle);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  // Pushes p out of the moving circles; true if it moved.
  _pushFromDynamic(p, radius) {
    let any = false;
    for (let k = 0; k < this.dynamic.length; k++) {
      const d = this.dynamic[k];
      if (!(d[2] > 0)) continue;
      const dx = p.x - d[0], dz = p.z - d[1], R = d[2] + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const l = Math.sqrt(d2);
      if (l < 1e-6) { p.x += R; any = true; continue; }
      p.x = d[0] + (dx / l) * R;
      p.z = d[1] + (dz / l) * R;
      any = true;
    }
    return any;
  }

  _buildHash() {
    const T = this.terrain;
    this.hx0 = T.xmin; this.hz0 = T.zmin;
    this.hw = Math.ceil((T.xmax - T.xmin) / HASH_CELL);
    this.hh = Math.ceil((T.zmax - T.zmin) / HASH_CELL);
    const lists = Array.from({ length: this.hw * this.hh }, () => []);
    for (let i = 0; i < this.n; i++) {
      const r = this.cr[i] + 1.0; // margin for the player's radius
      const a0 = this._hcol(this.cx[i] - r), a1 = this._hcol(this.cx[i] + r);
      const b0 = this._hrow(this.cz[i] - r), b1 = this._hrow(this.cz[i] + r);
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) lists[b * this.hw + a].push(i);
    }
    this.hStart = new Int32Array(lists.length + 1);
    let k = 0;
    lists.forEach((l, j) => { this.hStart[j] = k; k += l.length; });
    this.hStart[lists.length] = k;
    this.hItems = new Int32Array(k);
    lists.forEach((l, j) => this.hItems.set(l, this.hStart[j]));
  }

  _hcol(x) { return Math.min(this.hw - 1, Math.max(0, Math.floor((x - this.hx0) / HASH_CELL))); }
  _hrow(z) { return Math.min(this.hh - 1, Math.max(0, Math.floor((z - this.hz0) / HASH_CELL))); }

  // Calls fn(index) for every circle whose hash cell holds (x, z).
  forEachCircleNear(x, z, fn) {
    const j = this._hrow(z) * this.hw + this._hcol(x);
    for (let k = this.hStart[j]; k < this.hStart[j + 1]; k++) fn(this.hItems[k]);
  }

  blocked(x, z) {
    return !this.terrain.isWalkable(x, z);
  }

  // True where a disc of the player's size fits: centre on a walkable cell
  // and clear of every circle.
  isFree(x, z, radius = this.radius) {
    if (this.blocked(x, z)) return false;
    const j = this._hrow(z) * this.hw + this._hcol(x);
    for (let k = this.hStart[j]; k < this.hStart[j + 1]; k++) {
      const i = this.hItems[k];
      const dx = x - this.cx[i], dz = z - this.cz[i], R = this.cr[i] + radius;
      if (dx * dx + dz * dz < R * R) return false;
    }
    for (let k = 0; k < this.dynamic.length; k++) {
      const d = this.dynamic[k];
      if (!(d[2] > 0)) continue;
      const dx = x - d[0], dz = z - d[1], R = d[2] + radius;
      if (dx * dx + dz * dz < R * R) return false;
    }
    return true;
  }

  // Push p ({x, z}) out of circles and blocked cells. Returns true if moved.
  resolve(p, radius = this.radius, gridRadius = this.gridRadius) {
    let moved = false;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      const j = this._hrow(p.z) * this.hw + this._hcol(p.x);
      for (let k = this.hStart[j]; k < this.hStart[j + 1]; k++) {
        const i = this.hItems[k];
        const dx = p.x - this.cx[i], dz = p.z - this.cz[i], R = this.cr[i] + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) { p.x += R; continue; }
        p.x = this.cx[i] + (dx / d) * R;
        p.z = this.cz[i] + (dz / d) * R;
        any = true;
      }
      if (this.dynamic.length && this._pushFromDynamic(p, radius)) any = true;
      if (this._pushFromCells(p, gridRadius)) any = true;
      if (!any) break;
      moved = true;
    }
    return moved;
  }

  _pushFromCells(p, g) {
    const T = this.terrain;
    const cell = T.cell, h = cell / 2;
    const c0 = T.colOf(p.x - g), c1 = T.colOf(p.x + g);
    const r0 = T.rowOf(p.z - g), r1 = T.rowOf(p.z + g);
    let px = 0, pz = 0, any = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const inside = c >= 0 && r >= 0 && c < T.cols && r < T.rows;
        if (inside && (T.mask[r * T.cols + c] & T.bits.walkable)) continue;
        const x = T.xOf(c), z = T.zOf(r);
        const qx = Math.min(x + h, Math.max(x - h, p.x));
        const qz = Math.min(z + h, Math.max(z - h, p.z));
        const dx = p.x - qx, dz = p.z - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= g * g) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) continue; // centre inside a blocked cell: left to the caller
        const push = g - d;
        px += (dx / d) * push;
        pz += (dz / d) * push;
        any = true;
      }
    }
    if (any) {
      // Cap the combined push so opposing cells in a corner do not overshoot.
      const l = Math.hypot(px, pz);
      const s = l > g ? g / l : 1;
      p.x += px * s;
      p.z += pz * s;
    }
    return any;
  }

  // Move pos ({x, z}) by (dx, dz) with sliding. Writes the result into pos.
  move(pos, dx, dz) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / this.maxStep));
    const sx = dx / steps, sz = dz / steps;
    const p = this._p;
    for (let s = 0; s < steps; s++) {
      p.x = pos.x + sx; p.z = pos.z + sz;
      this.resolve(p);
      if (this.isFree(p.x, p.z, this.radius - 0.02)) { pos.x = p.x; pos.z = p.z; continue; }
      // Try each axis alone, so a head-on wall still lets the player slide.
      p.x = pos.x + sx; p.z = pos.z;
      this.resolve(p);
      if (this.isFree(p.x, p.z, this.radius - 0.02)) { pos.x = p.x; pos.z = p.z; continue; }
      p.x = pos.x; p.z = pos.z + sz;
      this.resolve(p);
      if (this.isFree(p.x, p.z, this.radius - 0.02)) { pos.x = p.x; pos.z = p.z; continue; }
      break;
    }
    return pos;
  }

  // Ground height under (x, z), including stepping over fallen logs.
  supportHeight(x, z) {
    let y = this.terrain.heightAt(x, z);
    for (const L of this.logs) {
      const ax = Math.cos(L.rot), az = -Math.sin(L.rot);
      const rx = x - L.x, rz = z - L.z;
      const along = Math.max(-L.len / 2, Math.min(L.len / 2, rx * ax + rz * az));
      const ox = rx - along * ax, oz = rz - along * az;
      const d = Math.hypot(ox, oz);
      if (d < L.r) y = Math.max(y, L.y + L.r + Math.sqrt(L.r * L.r - d * d));
    }
    return y;
  }

  // Nearest free spot to (x, z), searching outwards; used by teleport. A spot only
  // counts if the player could walk about from it (see roomy).
  nearestFree(x, z, maxR = 6) {
    if (this.isFree(x, z) && this.roomy(x, z)) return { x, z };
    for (let r = 0.25; r <= maxR; r += 0.25) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.25));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.isFree(px, pz) && this.roomy(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  // True when the player could walk about from (x, z) over at least about area m2:
  // a flood fill of 0.1 m steps taken with move() itself, so a free point wedged
  // between circles and blocked cells, where every step is refused, fails.
  roomy(x, z, area = 1) {
    const need = Math.round(area / 0.01);
    const key = (px, pz) => Math.round(px * 10) * 65536 + Math.round(pz * 10);
    const seen = new Set([key(x, z)]);
    const queue = [x, z];
    const p = { x: 0, z: 0 };
    for (let q = 0; q < queue.length; q += 2) {
      if (seen.size >= need) return true;
      for (let k = 0; k < 4; k++) {
        p.x = queue[q]; p.z = queue[q + 1];
        this.move(p, k === 0 ? 0.1 : k === 1 ? -0.1 : 0, k === 2 ? 0.1 : k === 3 ? -0.1 : 0);
        const kk = key(p.x, p.z);
        if (seen.has(kk)) continue;
        seen.add(kk);
        queue.push(p.x, p.z);
      }
    }
    return seen.size >= need;
  }
}
