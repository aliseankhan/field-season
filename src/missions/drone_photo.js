// The drone's aerial photo: the island rendered once from straight above with the
// game's own top view (debug.js makeTopCamera, the fixed extent x -62..82, z -50..52),
// at the hour it was taken, without the sky dome, clouds, fog, grass tufts, particles
// or the drone's own kit; read back into a canvas (up to 8 pixels a metre) for the big
// map's aerial layer, and a small JPEG print for the notebook and the save.
//
// It is drawn into a corner of the game's own canvas (the frame's normal render then
// paints over it before anything is shown): every material keeps the program it
// already has, so the photo costs one extra render and no shader compiles (a render
// target, or switching the fog off, would compile a second set).
//
// Nothing waits on the GPU: the pixels are read into a pixel buffer behind a fence and
// fetched a frame or two later, graded a slice of rows a frame, and the JPEG is encoded
// off the main thread (canvas.toBlob), while the flash and the card animate in. The
// print gets a warm photo grade (exposure from the picture's own brightness, lifted
// shadows), so a morning or evening photo is as bright as a noon one. Parts of the
// island the survey never photographed (`missing`, world rectangles) are left as blank
// paper. The big map's copy also carries the paths and the landmark trees faintly
// (drawMapMarks), so the map's key still matches with the photo on.
//
//   const job = startAerialPhoto(game, { hide: [objects], missing: [{ x0, x1, z0, z1 }] })
//   job.step()   once a frame until job.done; job.print (the print's canvas, ready once
//                job.printReady), job.canvas (the map's copy, once job.mapReady),
//                job.jpeg (the print as a data URL, for the save), job.w, job.h,
//                job.extent, job.ms (main-thread time), job.parts, job.frames
//   drawMapMarks(canvas, extent, data)   the paths and landmark trees over a photo
//   PHOTO_EXTENT                         the photo's world extent

import * as THREE from 'three';
import { makeTopCamera } from '../debug.js';
import { CONFIG } from '../config.js';
import { vegUniforms } from '../world/wind.js';
import { pathLines } from '../world/ground_decor.js';

const PX = 8; // pixels a metre in the big picture, at most
const THUMB = 4; // and in the notebook's print
const ROW_PIXELS = 160000; // pixels graded a frame
const FETCH_SLICES = 3; // frames the pixels are fetched over
const v0 = CONFIG.topView;
export const PHOTO_EXTENT = { x0: v0.xmin, x1: v0.xmax, z0: v0.zmin, z1: v0.zmax };

const SIZE = new THREE.Vector2(), VIEW = new THREE.Vector4();

export function startAerialPhoto(game, { hide = [], missing = [], sync: now = false } = {}) {
  let t = performance.now();
  const job = {
    done: false, mapReady: false, canvas: null, jpeg: null, w: 0, h: 0, extent: { ...PHOTO_EXTENT },
    ms: 0, frames: 0, parts: { render: 0, read: 0, grade: 0, paint: 0, print: 0, encode: 0, waitFrames: 0 },
    step: () => job.done,
  };
  const { renderer, scene, sky, water } = game;
  const v = CONFIG.topView;
  const aspect = (v.xmax - v.xmin) / (v.zmax - v.zmin);
  const buffer = renderer.getDrawingBufferSize(SIZE);
  let w = Math.min(Math.round((v.xmax - v.xmin) * PX), buffer.x);
  let h = Math.round(w / aspect);
  if (h > buffer.y) { h = buffer.y; w = Math.round(h * aspect); }
  job.w = w; job.h = h;
  const cam = makeTopCamera();

  // what the photo leaves out, put back afterwards exactly as it was
  const saved = [];
  const off = (o) => { if (o && o.visible) { saved.push(o); o.visible = false; } };
  if (sky) { off(sky.dome); off(sky.clouds); }
  off(game.grass && game.grass.group);
  off(game.fx && game.fx.group);
  off(game.lizards && game.lizards.group);
  for (const o of hide) off(o);
  // the fog pushed out of sight rather than switched off (that would recompile)
  const fog = scene.fog;
  const fogNear = fog && fog.near, fogFar = fog && fog.far;
  if (fog && fog.isFog) { fog.near = 1e6; fog.far = 2e6; }
  const cut = vegUniforms.uVegCut.value;
  vegUniforms.uVegCut.value = 0;
  // from straight above the whole lake would sit in the sun's highlight (main.js's top view)
  const spec = water && water.mesh && water.mesh.material && water.mesh.material.specular ? water.mesh.material.specular.clone() : null;
  if (spec) water.mesh.material.specular.setScalar(0);
  const ripple = water && water.uniforms && water.uniforms.uRipple ? water.uniforms.uRipple.value : null;
  if (ripple != null) water.uniforms.uRipple.value = 0.3;
  // the morning mist is drawn thicker with distance: from 400 m up it would fog the lake
  const mist = water && water.uniforms && water.uniforms.uMist ? water.uniforms.uMist.value : null;
  if (mist != null) water.uniforms.uMist.value = 0;

  const buf = new Uint8Array(w * h * 4);
  const viewport = renderer.getViewport(VIEW).clone();
  const pr = renderer.getPixelRatio();
  const prevTarget = renderer.getRenderTarget();
  const gl = renderer.getContext();
  let pbo = null, sync = null;
  try {
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, w / pr, h / pr);
    renderer.clear();
    renderer.render(scene, cam);
    const t1 = performance.now();
    job.parts.render = t1 - t;
    // WebGL2: read into a pixel buffer behind a fence, so this frame does not wait for
    // the GPU to finish drawing the island; the pixels are fetched once it has
    if (!now && typeof gl.fenceSync === 'function' && gl.PIXEL_PACK_BUFFER) {
      try {
        pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, buf.byteLength, gl.STREAM_READ);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
      } catch (e) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        if (pbo) gl.deleteBuffer(pbo);
        pbo = null; sync = null;
      }
    }
    if (!sync) gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    job.parts.read = performance.now() - t1;
  } finally {
    renderer.setViewport(viewport);
    renderer.setRenderTarget(prevTarget);
    if (fog && fog.isFog) { fog.near = fogNear; fog.far = fogFar; }
    vegUniforms.uVegCut.value = cut;
    if (spec) water.mesh.material.specular.copy(spec);
    if (ripple != null) water.uniforms.uRipple.value = ripple;
    if (mist != null) water.uniforms.uMist.value = mist;
    for (const o of saved) o.visible = true;
  }
  job.ms += performance.now() - t;

  // the stages after this frame, each a few milliseconds at most
  let stage = sync ? 'wait' : 'grade';
  let row = 0, img = null, lut = null, big = null, fetched = 0, printed = false, small = null, sImg = null, warmLut = null, sRow = 0, sxOff = null, sxOff2 = null;
  const tw = Math.round((PHOTO_EXTENT.x1 - PHOTO_EXTENT.x0) * THUMB), th = Math.round((PHOTO_EXTENT.z1 - PHOTO_EXTENT.z0) * THUMB);
  const rowBytes = w * 4;
  const rowsPer = Math.max(16, Math.floor(ROW_PIXELS / w));
  job.step = () => {
    if (job.done) return true;
    t = performance.now();
    job.frames++;
    if (stage === 'wait') {
      // the fence: fetch the pixels once the GPU is through (it takes two or three frames;
      // after six, fetch anyway, which waits for it as the old one-frame photo did)
      const st = gl.clientWaitSync(sync, 0, 0);
      job.parts.waitFrames++;
      if (st === gl.TIMEOUT_EXPIRED && job.parts.waitFrames < 6) { job.ms += performance.now() - t; return false; }
      gl.deleteSync(sync);
      sync = null;
      stage = 'fetch';
    }
    if (stage === 'fetch') {
      // out of the pixel buffer in a few slices, one a frame
      const bytes = buf.byteLength, chunk = Math.ceil(h / FETCH_SLICES) * rowBytes;
      const n = Math.min(chunk, bytes - fetched);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, fetched, buf, fetched, n);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      fetched += n;
      job.parts.read += performance.now() - t;
      if (fetched >= bytes) { gl.deleteBuffer(pbo); pbo = null; stage = 'grade'; }
    } else if (stage === 'grade') {
      // flipped (the GL rows run bottom up) and graded, two rows at a time, a slice a
      // frame; each pair also makes one row of the half-size print (a 2 by 2 average,
      // warmed and vignetted), so the print never needs the canvas read back
      const g0 = performance.now();
      if (!img) {
        big = document.createElement('canvas');
        big.width = w; big.height = h;
        img = big.getContext('2d').createImageData(w, h);
        small = document.createElement('canvas');
        small.width = tw; small.height = th;
        sImg = small.getContext('2d', { willReadFrequently: true }).createImageData(tw, th);
        lut = gradeLut(buf);
        warmLut = printLut();
        // each print column's two source columns (a 2 by 2 average at the usual size)
        sxOff = new Int32Array(tw); sxOff2 = new Int32Array(tw);
        for (let sx = 0; sx < tw; sx++) { const x0 = Math.min(w - 1, (sx * w / tw) | 0); sxOff[sx] = x0 * 4; sxOff2[sx] = Math.min(w - 1, x0 + 1) * 4; }
      }
      const out = img.data, so = sImg.data;
      const end = Math.min(h, row + rowsPer);
      const cx = tw / 2, cy = th / 2, r0 = Math.min(tw, th) * 0.35, r1 = Math.hypot(tw, th) * 0.56;
      for (let y = row; y < end; y++) {
        let s = (h - 1 - y) * rowBytes, d = y * rowBytes;
        for (let x = 0; x < w; x++, s += 4, d += 4) {
          out[d] = lut[buf[s]];
          out[d + 1] = lut[256 + buf[s + 1]];
          out[d + 2] = lut[512 + buf[s + 2]];
          out[d + 3] = 255;
        }
        // the print's rows whose two source rows are graded now
        while (sRow < th && Math.min(h - 1, ((sRow * h / th) | 0) + 1) <= y) {
          const y0 = (sRow * h / th) | 0;
          const a0 = y0 * rowBytes, a1 = Math.min(h - 1, y0 + 1) * rowBytes;
          const dy = sRow + 0.5 - cy;
          let q = sRow * tw * 4;
          for (let sx = 0; sx < tw; sx++, q += 4) {
            const i = sxOff[sx], i2 = sxOff2[sx];
            const dx = sx + 0.5 - cx;
            const dd = Math.sqrt(dx * dx + dy * dy);
            const v = dd <= r0 ? 0 : dd >= r1 ? 0.2 : 0.2 * (dd - r0) / (r1 - r0);
            for (let c = 0; c < 3; c++) {
              const avg = (out[a0 + i + c] + out[a0 + i2 + c] + out[a1 + i + c] + out[a1 + i2 + c] + 2) >> 2;
              const p = warmLut[c * 256 + avg];
              so[q + c] = p + (VIG[c] - p) * v;
            }
            so[q + 3] = 255;
          }
          sRow++;
        }
      }
      row = end;
      job.parts.grade += performance.now() - g0;
      if (row >= h) stage = 'paint';
    } else if (stage === 'paint') {
      const p0 = performance.now();
      const g = big.getContext('2d');
      g.putImageData(img, 0, 0);
      img = null;
      const sg = small.getContext('2d', { willReadFrequently: true });
      sg.putImageData(sImg, 0, 0);
      sImg = null;
      // the gaps in the survey: blank paper, on the map's copy and the print
      const s = w / (PHOTO_EXTENT.x1 - PHOTO_EXTENT.x0), s2 = tw / (PHOTO_EXTENT.x1 - PHOTO_EXTENT.x0);
      for (const m of missing) {
        paper(g, (m.x0 - PHOTO_EXTENT.x0) * s, (m.z0 - PHOTO_EXTENT.z0) * s, (m.x1 - m.x0) * s, (m.z1 - m.z0) * s, s);
        paper(sg, (m.x0 - PHOTO_EXTENT.x0) * s2, (m.z0 - PHOTO_EXTENT.z0) * s2, (m.x1 - m.x0) * s2, (m.z1 - m.z0) * s2, s2);
      }
      // the print is ready to show (its JPEG for the save comes a little later)
      job.print = small;
      job.printReady = true;
      job.parts.paint += performance.now() - p0;
      stage = 'print';
    } else if (stage === 'print') {
      // the print's JPEG, encoded off the main thread
      const e0 = performance.now();
      encode(small, now, (url) => {
        job.jpeg = url;
        job.parts.encode = performance.now() - e0;
        printed = true;
        if (job.mapReady) job.done = true;
      });
      job.parts.print += performance.now() - e0;
      stage = 'map';
    } else if (stage === 'map') {
      // the big map's copy: the paths and landmark trees faintly over the photo
      const p0 = performance.now();
      try { drawMapMarks(big, PHOTO_EXTENT, game.data); } catch (e) { /* the marks are a nicety */ }
      job.canvas = big;
      job.mapReady = true;
      job.parts.paint += performance.now() - p0;
      stage = 'encoding';
    }
    if (printed && job.mapReady) job.done = true;
    job.ms += performance.now() - t;
    return job.done;
  };
  return job;
}

// A readback the same size as the photo's, once, a little after the game has loaded:
// the first large readback of a session sets up the browser's transfer buffers (about
// 40 ms), which would otherwise land on the frame the drone touches down.
export function warmAerialPhoto(game) {
  const { renderer } = game;
  const gl = renderer.getContext();
  if (typeof gl.fenceSync !== 'function' || !gl.PIXEL_PACK_BUFFER) return;
  const v = CONFIG.topView;
  const buffer = renderer.getDrawingBufferSize(SIZE);
  let w = Math.min(Math.round((v.xmax - v.xmin) * PX), buffer.x);
  let h = Math.round(w / ((v.xmax - v.xmin) / (v.zmax - v.zmin)));
  if (h > buffer.y) { h = buffer.y; w = Math.round(h * ((v.xmax - v.xmin) / (v.zmax - v.zmin))); }
  if (!(w > 0 && h > 0)) return;
  const buf = new Uint8Array(w * h * 4);
  let pbo = null, sync = null;
  try {
    pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, buf.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  } catch (e) { if (pbo) gl.deleteBuffer(pbo); return; }
  let n = 0, fetched = 0;
  const slice = Math.ceil(h / FETCH_SLICES) * w * 4;
  const poll = () => {
    n++;
    if (sync && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && n < 60) { setTimeout(poll, 50); return; }
    try {
      if (sync) { gl.deleteSync(sync); sync = null; }
      // in slices, like the photo itself, so no one moment carries it all
      const k = Math.min(slice, buf.byteLength - fetched);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, fetched, buf, fetched, k);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      fetched += k;
      if (fetched < buf.byteLength) { setTimeout(poll, 50); return; }
      gl.deleteBuffer(pbo);
      // and the canvas work once, at the photo's size (its first time is the slow one)
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), w, h), 0, 0);
    } catch (e) { /* only a head start */ }
  };
  setTimeout(poll, 50);
}

// For tools and checks: the whole photo in one go (one long frame), as it used to be.
export function takeAerialPhoto(game, opts = {}) {
  const job = startAerialPhoto(game, { ...opts, sync: true });
  for (let i = 0; i < 400 && !job.done; i++) job.step();
  return { canvas: job.canvas, jpeg: job.jpeg, w: job.w, h: job.h, extent: job.extent, ms: Math.round(job.ms), parts: job.parts };
}

// The JPEG off the main thread where the browser can (toBlob), as a data URL for the
// save; toDataURL where it cannot.
function encode(canvas, now, done) {
  const sync = () => { try { done(canvas.toDataURL('image/jpeg', 0.84)); } catch (e) { done(null); } };
  if (now || typeof canvas.toBlob !== 'function' || typeof FileReader === 'undefined') { sync(); return; }
  try {
    canvas.toBlob((blob) => {
      if (!blob) { sync(); return; }
      const r = new FileReader();
      r.onload = () => done(typeof r.result === 'string' ? r.result : null);
      r.onerror = sync;
      r.readAsDataURL(blob);
    }, 'image/jpeg', 0.84);
  } catch (e) { sync(); }
}

// A warm photo grade, as one lookup table a channel (r, g, b at 0, 256, 512): the
// exposure from the picture's own brightness (a dim morning or evening island is
// brought up towards noon's), a soft shoulder so nothing clips, the shadows lifted a
// little, and a touch of warmth.
function gradeLut(buf) {
  let sum = 0, n = 0;
  for (let i = 0; i < buf.length; i += 4 * 97) { sum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++; }
  const mean = n ? sum / n / 255 : 0.4;
  const gain = Math.max(1, Math.min(1.6, 0.46 / Math.max(0.05, mean)));
  const warm = [1.035, 1.0, 0.95];
  const lut = new Uint8Array(768);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 256; i++) {
      let x = (i / 255) * gain * warm[c];
      x = (x * 1.22) / (1 + 0.22 * x); // shoulder: 1 stays 1
      x += 0.06 * (1 - x) * (1 - x) * (1 - x); // lift the shadows
      lut[c * 256 + i] = Math.max(0, Math.min(255, Math.round(x * 255)));
    }
  }
  return lut;
}

// The print's warmth: a soft-light wash of pale apricot (255, 214, 160) at 20 %, as a
// table a channel; and the vignette's colour, the corners darkened towards it by 20 %
const VIG = [60, 40, 20];
function printLut() {
  const wash = [255 / 255, 214 / 255, 160 / 255];
  const lut = new Uint8Array(768);
  for (let c = 0; c < 3; c++) {
    const b = wash[c];
    for (let i = 0; i < 256; i++) {
      const a = i / 255;
      const D = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
      const sl = b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (D - a);
      lut[c * 256 + i] = Math.max(0, Math.min(255, Math.round((a + (sl - a) * 0.2) * 255)));
    }
  }
  return lut;
}

// A patch the survey missed: plain paper with a faint pencil hatch (lined up across
// neighbouring patches, so a missed lane reads as one blank stripe).
function paper(g, x, y, w, h, s) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#f6eedb';
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(206, 186, 146, 0.5)';
  g.lineWidth = Math.max(1, s * 0.22);
  const step = s * 1.8;
  g.beginPath();
  for (let c = Math.floor((x + y) / step) * step; c <= x + w + y + h; c += step) {
    g.moveTo(c - (y + h), y + h);
    g.lineTo(c - y, y);
  }
  g.stroke();
  g.restore();
}

// The big map's own marks over a photo (canvas at any scale over `extent`): the paths
// as faint sandy lines and the landmark trees as rings like the map's, a little
// stronger so they read over the leaves.
export function drawMapMarks(canvas, extent, data) {
  const g = canvas.getContext('2d');
  const s = canvas.width / (extent.x1 - extent.x0);
  const X = (x) => (x - extent.x0) * s, Y = (z) => (z - extent.z0) * s;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  let paths = [];
  try { paths = pathLines() || []; } catch (e) { paths = []; }
  for (const [colour, width] of [['rgba(255, 250, 232, 0.35)', 1.6], ['rgba(240, 220, 174, 0.55)', 0.9]]) {
    g.strokeStyle = colour;
    g.lineWidth = width * s;
    for (const line of paths) {
      if (!line || line.length < 2) continue;
      g.beginPath();
      for (let k = 0; k < line.length; k++) {
        const p = line[k];
        if (k === 0) g.moveTo(X(p[0]), Y(p[1])); else g.lineTo(X(p[0]), Y(p[1]));
      }
      g.stroke();
    }
  }
  const lms = [...((data && data.placements && data.placements.landmarks) || [])].sort((a, b) => b.height - a.height);
  const RAINBOW = ['#3fb0ad', '#ff9d4d', '#9b7be0'];
  for (const l of lms) {
    if (l.kind === 'osprey_pole') continue;
    const cx = X(l.crown_x ?? l.x), cz = Y(l.crown_z ?? l.z);
    const r = Math.max(1.0, 0.3 * Math.max(l.crown_w_ew || 3, l.crown_w_ns || 3)) * s;
    g.lineWidth = 0.55 * s;
    g.strokeStyle = 'rgba(255, 253, 240, 0.55)';
    g.beginPath(); g.arc(cx, cz, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 0.25 * s;
    g.strokeStyle = 'rgba(47, 118, 60, 0.85)';
    g.fillStyle = 'rgba(84, 166, 98, 0.16)';
    g.beginPath(); g.arc(cx, cz, r, 0, Math.PI * 2); g.fill(); g.stroke();
    if (l.kind === 'rainbow_eucalyptus') {
      const rr = Math.max(1.3 * s, r * 0.5);
      g.lineWidth = 0.4 * s;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        g.strokeStyle = RAINBOW[k % 3];
        g.beginPath(); g.arc(X(l.x), Y(l.z), rr, a, a + 0.62); g.stroke();
      }
    }
    g.fillStyle = '#8a5a3c';
    g.beginPath(); g.arc(X(l.x), Y(l.z), Math.max(0.35, (l.dbh || 0.3) * 0.8) * s, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
