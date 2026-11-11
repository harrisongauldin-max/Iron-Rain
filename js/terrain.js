// The ground a campaign battle is fought on. Every world has its own: the Belt's rock fields and Saturn's ring ice,
// the wreck fields the Rising left at the Martian moons, Jupiter's radiation, Mercury's solar flares, the
// minefields the Core worlds sowed on their approaches, the deep dark past Saturn. Everything here rides with its
// world, which at a moon means it moves with the moon round its planet.
import { S } from './state.js';
import { bodyOf } from './solar.js';
import { makeField } from './physics.js';
import { damage, burst } from './sim.js';
import { projectTo } from './cam.js';
import { toast } from './ui.js';

const hyp = Math.hypot, TAU = Math.PI * 2, Q = { x: 0, y: 0, k: 0, ok: false };
export const KINDS = {
  belt:      { name: 'The Belt', desc: 'Rock fields: cover that blocks fire and sensors. A ship inside one is half as easy to see, and a careless helm can hit a rock.' },
  rings:     { name: 'Ring ice', desc: 'Fields of ring ice ride with the moon: cover that blocks fire and sensors, and hides any ship inside it.' },
  wrecks:    { name: 'Wreck fields', desc: 'The hulks of the Rising’s battles still drift round the Martian moons: cover that blocks fire and sensors.' },
  radiation: { name: 'Jupiter’s radiation', desc: 'The magnetosphere blinds sensors (70% range) and wears down shields: they recharge at 60%.' },
  flares:    { name: 'Solar flares', desc: 'Every few minutes the Sun throws a flare. Ships in sunlight lose their shields and half their sensor range; Mercury’s shadow is the only shelter.' },
  mines:     { name: 'Minefields', desc: 'The defenders sowed mines on the approaches. You see a field only once a ship is within 2,200 km of it; the defenders always see theirs.' },
  dark:      { name: 'The deep dark', desc: 'Far from the Sun, light is thin: every ship is 25% harder to see.' },
  none:      { name: 'Open space', desc: 'No cover, no hazards: the guns decide it.' },
  glare:     { name: 'The Sun’s glare', desc: 'So near the Sun that sensors burn out at range: every ship sees at 60%, and the fight starts close.' },
  giant:     { name: 'A gas giant’s shadow', desc: 'In the lee of a gas giant its storms and moons break up the sensors: every ship sees at 70% and is a little harder to see.' },
};
const BY_WORLD = { ceres: 'belt', saturn: 'rings', titan: 'rings', rhea: 'rings', enceladus: 'rings', iapetus: 'rings', phobos: 'wrecks', deimos: 'wrecks',
  jupiter: 'radiation', io: 'radiation', europa: 'radiation', ganymede: 'radiation', callisto: 'radiation', thebe: 'radiation',
  mercury: 'flares', mars: 'mines', earth: 'mines', luna: 'mines', venus: 'mines', uranus: 'dark', neptune: 'dark', triton: 'dark', pluto: 'dark' };
// a wreck field the campaign has left at a world after a great battle (camp.js wrecks): it overrides the world's own ground
export const OVER = {};
export const kindOf = world => OVER[world] || BY_WORLD[world] || 'none';

export const TR = { kind: 'none', world: null, fields: [], mines: [], flare: null, next: 0 };
export const info = () => TR.recent ? { name: 'A wreck field', desc: 'The hulks of a recent battle still drift here: cover that blocks fire and sensors, and salvage for whoever holds the field.' } : KINDS[TR.kind];

// ang: the direction the attackers come from; defTeam: who sowed the mines
export function setup(world, ang, defTeam, over) {
  const b = bodyOf(world), kind = over || kindOf(world);
  Object.assign(TR, { kind, world, fields: [], mines: [], flare: null, next: 0, defTeam, warned: false, recent: kind === 'wrecks' && (over === 'wrecks' || (OVER[world] === 'wrecks' && BY_WORLD[world] !== 'wrecks')) }); last = S.time;
  S.env = { sig: 1, sight: 1, shReg: 1 };
  if (kind === 'belt' || kind === 'rings' || kind === 'wrecks') {
    // fields scattered over the ground between the fleets and round the world's flanks
    const n = kind === 'belt' ? 6 : 5;
    for (let i = 0; i < n; i++) {
      let a = ang + (i - (n - 1) / 2) * .55 + (Math.random() - .5) * .35, d = b.r + 2200 + Math.random() * 6500; const R = 650 + Math.random() * 450;
      let fx = b.x + Math.cos(a) * d, fy = b.y + Math.sin(a) * d;
      // in deep space the rocks lie either side of the course, not on it: lanes to run, flanks to hide on
      if (world === '@space') { const al = -12000 + Math.random() * 80000, pp = (i % 2 ? 1 : -1) * (12000 + R + Math.random() * 20000); fx = b.x + Math.cos(ang) * al - Math.sin(ang) * pp; fy = b.y + Math.sin(ang) * al + Math.cos(ang) * pp; }
      const f = makeField(fx, fy, R, Math.round(R / 40));
      f.ox = f.x - b.x; f.oy = f.y - b.y; for (const k of f.rocks) { k.ox = k.x - f.x; k.oy = k.y - f.y; }
      f.kind = kind; S.fields.push(f); TR.fields.push(f);
    }
    S.fields = S.fields.slice(); // a new list: the renderer rebuilds its rocks
  }
  if (kind === 'radiation') { S.env.sight = .7; S.env.shReg = .6; }
  if (kind === 'glare') S.env.sight = .6;
  if (kind === 'giant') { S.env.sight = .7; S.env.sig = .85; }
  if (kind === 'dark') S.env.sig = .75;
  if (kind === 'mines') {
    for (let i = 0; i < 7; i++) {
      const a = ang + (i - 3) * .32 + (Math.random() - .5) * .2, d = b.r + 1600 + Math.random() * 2600;
      TR.mines.push({ ox: Math.cos(a) * d, oy: Math.sin(a) * d, x: 0, y: 0, r: 480, n: 14, seen: false, t: 0 });
    }
  }
  if (kind === 'flares') TR.next = 120 + Math.random() * 60;
  // so close to the Sun, a ship that comes at you out of it is lost in the glare
  if (kind === 'flares' || kind === 'glare' || world === 'mercury') S.env.sun = true;
  follow(b);
}
function follow(b) {
  for (const f of TR.fields) { f.x = b.x + f.ox; f.y = b.y + f.oy; for (const k of f.rocks) { k.x = f.x + k.ox; k.y = f.y + k.oy; k.vx = b.vx; k.vy = b.vy; } f.vx = b.vx; f.vy = b.vy; }
  for (const m of TR.mines) { m.x = b.x + m.ox; m.y = b.y + m.oy; }
}
// in Mercury's shadow: behind the world from the Sun, within its width
export function inShadow(x, y) {
  const b = bodyOf(TR.world), d = hyp(b.x, b.y) || 1, ux = b.x / d, uy = b.y / d, px = x - b.x, py = y - b.y;
  return px * ux + py * uy > 0 && Math.abs(px * uy - py * ux) < b.r * 1.05;
}
const note = (t, c) => S.hooks && S.hooks.note && S.hooks.note(t, c);
const mob = s => !s.dead && !s.offField && !s.def.static;

let last = 0;
export function tick() {
  if (!TR.world) return;
  const b = bodyOf(TR.world); follow(b);
  if (S.time < last) last = S.time;
  if (S.time - last < .5) return; const step = S.time - last; last = S.time;
  if (TR.kind === 'mines') {
    for (const m of TR.mines) {
      if (m.n <= 0) continue;
      if (!m.seen) m.seen = S.ships.some(s => s.team === 0 && mob(s) && hyp(s.x - m.x, s.y - m.y) < 2200);
      if (TR.defTeam === 0) m.seen = true;
      for (const s of S.ships) {
        if (s.team === TR.defTeam || s.team > 1 || !mob(s) || s.def.shell) continue;
        if (hyp(s.x - m.x, s.y - m.y) > m.r + s.r || Math.random() > .55 || m.n <= 0) continue;
        m.n--; damage(s, s.def.fighter ? 400 : 260, TR.defTeam, s.x, s.y, 'blast'); burst(s.x, s.y, s.vx, s.vy, 18, 0xffb36b, 220, .7);
        if (!m.seen && s.team === 0) m.seen = true;
        if (s.team === 0 && S.time - (TR.mineNote || -99) > 8) { TR.mineNote = S.time; note('Mines! Our ships are in a minefield', 0xff8a7a); }
      }
    }
  }
  if (TR.kind === 'flares') {
    const F = TR.flare;
    if (!F && S.time >= TR.next - 15 && !TR.warned) { TR.warned = true; const t = 'Flare warning: the Sun throws a flare in 15 seconds. Get into Mercury’s shadow'; note(t, 0xffd27a); toast(t, 'bad', null, true); }
    if (!F && S.time >= TR.next) { TR.flare = { end: S.time + 10 }; S.env.sight = .5; S.screenFlash = Math.max(S.screenFlash || 0, .35); note('The flare hits: shields in sunlight are burning off', 0xffd27a); }
    if (TR.flare) {
      for (const s of S.ships) { if (s.dead || s.offField || !s.def.shield || s.team > 1) continue; if (!inShadow(s.x, s.y)) { s.sh = Math.max(0, s.sh - s.def.shield * .1 * step); s.shHit = S.time; } }
      if (S.time >= TR.flare.end) { TR.flare = null; TR.warned = false; S.env.sight = 1; TR.next = S.time + 150 + Math.random() * 90; }
    }
  }
}
export function teardown() { TR.world = null; TR.fields = []; TR.mines = []; TR.exit = null; S.env = null; }

// drawn on the battle overlay
export function draw(g, label, z, px) {
  if (!TR.world) return;
  const b = bodyOf(TR.world);
  if (S.env && S.env.sun && b && b.x != null) { // the sunward side: looking that way, sensors see at 55%
    const sa = Math.atan2(-b.y, -b.x), R0 = b.r + 3000, R1 = b.r + 34000, w = .5; g.ground();
    g.moveTo(b.x + Math.cos(sa - w) * R0, b.y + Math.sin(sa - w) * R0).lineTo(b.x + Math.cos(sa - w) * R1, b.y + Math.sin(sa - w) * R1).stroke({ width: 1 * px, color: 0xffd08a, alpha: .12 });
    g.moveTo(b.x + Math.cos(sa + w) * R0, b.y + Math.sin(sa + w) * R0).lineTo(b.x + Math.cos(sa + w) * R1, b.y + Math.sin(sa + w) * R1).stroke({ width: 1 * px, color: 0xffd08a, alpha: .12 });
    projectTo(Q, b.x + Math.cos(sa) * (b.r + 16000), b.y + Math.sin(sa) * (b.r + 16000)); if (Q.ok) label('☀ SUNWARD · SENSORS LOOKING THIS WAY SEE AT 55%', Q.x, Q.y, 0xffd08a, false, true);
  }
  if (TR.exit) { // the break-through line across the intercepted fleet's course
    const E = TR.exit, ux = Math.cos(E.head), uy = Math.sin(E.head), vx = -uy, vy = ux, cx = E.x + ux * E.d, cy = E.y + uy * E.d, L = 30000;
    g.ground(); g.moveTo(cx - vx * L, cy - vy * L).lineTo(cx + vx * L, cy + vy * L).stroke({ width: 1.6 * px, color: 0xf2c14e, alpha: .5 });
    projectTo(Q, cx + ux * 900, cy + uy * 900); if (Q.ok) label('BREAK-THROUGH LINE', Q.x, Q.y, 0xf2c14e, false, true);
  }
  if (TR.kind === 'flares') {
    // the shadow: a band behind the world, away from the Sun
    const d = hyp(b.x, b.y) || 1, ux = b.x / d, uy = b.y / d, L = 24000, w = b.r * 1.05;
    const ax = b.x - uy * w, ay = b.y + ux * w, cx = b.x + uy * w, cy = b.y - ux * w;
    g.ground(); g.poly([ax, ay, ax + ux * L, ay + uy * L, cx + ux * L, cy + uy * L, cx, cy]);
    g.fill({ color: 0x050a20, alpha: TR.flare ? .4 : .16 }); // dark, not lit: it is the absence of sunlight
    g.moveTo(ax, ay).lineTo(ax + ux * L, ay + uy * L).moveTo(cx, cy).lineTo(cx + ux * L, cy + uy * L).stroke({ width: 1.2 * px, color: 0x8fb0ff, alpha: TR.flare ? .55 : .25 });
    if (TR.flare || (TR.warned && S.time < TR.next)) { projectTo(Q, b.x + ux * (b.r + 2500), b.y + uy * (b.r + 2500)); if (Q.ok) label(TR.flare ? 'IN SHADOW · SAFE' : `FLARE IN ${Math.max(0, Math.ceil(TR.next - S.time))}s · SHELTER HERE`, Q.x, Q.y, 0xffd27a, false, true); }
  }
  if (TR.kind === 'mines') {
    g.ground();
    for (const m of TR.mines) { if (!m.seen || m.n <= 0) continue; g.dashed(m.x, m.y, m.r, 70, 60); g.stroke({ width: 1.3 * px, color: TR.defTeam === 0 ? 0x8fd3ff : 0xff6a5a, alpha: .55 });
      if (m.r * z > 14) { projectTo(Q, m.x, m.y); if (Q.ok) label(`MINES · ${m.n}`, Q.x, Q.y, TR.defTeam === 0 ? 0x8fd3ff : 0xff8a7a, false, true); } }
  }
  if (TR.kind === 'radiation') { g.ground(); g.circle(b.x, b.y, b.r + 30000).stroke({ width: 1 * px, color: 0x9be8a8, alpha: .08 }); }
}
if (typeof window !== 'undefined') window.__TRN = TR;
