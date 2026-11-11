import { S } from './state.js';
import { BODIES } from './data.js';
import { TAU, hyp, segHit, rand } from './util.js';

export function updBodies() {
  for (const b of BODIES) {
    if (b.kind !== 'moon') continue;
    const w = TAU / b.period, ph = b.phase + S.time * w, p = b.parent != null ? BODIES[b.parent] : { x: 0, y: 0, vx: 0, vy: 0 };
    b.x = p.x + Math.cos(ph) * b.orbitR; b.y = p.y + Math.sin(ph) * b.orbitR;
    b.vx = p.vx - Math.sin(ph) * b.orbitR * w; b.vy = p.vy + Math.cos(ph) * b.orbitR * w;
  }
}
export const g = { x: 0, y: 0 };
export function grav(x, y) {
  g.x = 0; g.y = 0;
  for (const b of BODIES) {
    const dx = b.x - x, dy = b.y - y;
    const r = Math.max(Math.sqrt(dx * dx + dy * dy), b.r);
    const f = b.GM / (r * r * r); g.x += dx * f; g.y += dy * f;
  }
  return g;
}

// ---------------------------------------------------------------- asteroid fields: hard cover and sensor clutter
export function makeField(x, y, R, n) {
  const rocks = [];
  let tries = 0;
  while (rocks.length < n && tries++ < n * 20) {
    const a = rand(0, TAU), d = Math.sqrt(Math.random()) * R, r = rand(28, 120) * (Math.random() < .15 ? 1.6 : 1);
    const rx = x + Math.cos(a) * d, ry = y + Math.sin(a) * d;
    if (rocks.some(o => hyp(o.x - rx, o.y - ry) < o.r + r + 70)) continue;
    const pts = []; const k = 7 + Math.floor(rand(0, 4));
    for (let j = 0; j < k; j++) { const aa = j / k * TAU; const m = rand(.72, 1.12); pts.push(Math.cos(aa) * r * m, Math.sin(aa) * r * m); }
    rocks.push({ x: rx, y: ry, r, pts, rot: rand(0, TAU) });
  }
  return { x, y, r: R + 130, rocks };
}
export function inField(x, y) { for (const f of S.fields) if (hyp(x - f.x, y - f.y) < f.r) return f; return null; }
export function rocksNear(x, y, r, fn) {
  for (const f of S.fields) {
    if (hyp(x - f.x, y - f.y) > f.r + r) continue;
    for (const k of f.rocks) if (Math.abs(k.x - x) < k.r + r && Math.abs(k.y - y) < k.r + r) if (fn(k) === true) return true;
  }
  return false;
}
export function segRock(x0, y0, x1, y1, pad = 0) {
  for (const f of S.fields) {
    if (segHit(x0, y0, x1, y1, f.x, f.y, f.r) < 0) continue;
    for (const k of f.rocks) { const t = segHit(x0, y0, x1, y1, k.x, k.y, k.r * .9 + pad); if (t >= 0) return { k, t }; }
  }
  return null;
}
export function losClear(ax, ay, bx, by) {
  for (const b of BODIES) if (segHit(ax, ay, bx, by, b.x, b.y, b.r * .96) >= 0) return false;
  return !segRock(ax, ay, bx, by);
}

// ---------------------------------------------------------------- spatial hash
const CELL = 256, MARGIN = 200; const grid = new Map();
const gk = (cx, cy) => (cx + 1048576) * 2097152 + (cy + 1048576); // cells of 256 km out past the orbit of Pluto
export function buildGrid() {
  grid.clear();
  for (const s of S.ships) {
    if (s.dead) continue;
    const k = gk(Math.floor(s.x / CELL), Math.floor(s.y / CELL));
    let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(s);
  }
}
export function query(x, y, r, fn) {
  const m = r + MARGIN;
  const x0 = Math.floor((x - m) / CELL), x1 = Math.floor((x + m) / CELL), y0 = Math.floor((y - m) / CELL), y1 = Math.floor((y + m) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const a = grid.get(gk(cx, cy)); if (!a) continue;
    for (let i = 0; i < a.length; i++) if (fn(a[i]) === true) return;
  }
}
export function bodyHit(x, y, pad) { for (const b of BODIES) if (hyp(x - b.x, y - b.y) < b.r + (pad || 0)) return b; return null; }
