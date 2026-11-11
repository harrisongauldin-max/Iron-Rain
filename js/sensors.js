// What each side knows of the other in a campaign battle. A ship in sight is seen (sim.js decides that). Past
// sight, sensors still pick up a hot ship — one burning hard or firing — as a contact: a blip with a rough size and
// a rough position, no more. A ship that drops out of sight leaves a ghost where it was last seen, for a minute.
// Sensor pickets hear further. A ship that opens fire from the dark, unseen, springs an ambush.
import { S } from './state.js';
import { BODIES, SENSOR_K, lockOf, WASH } from './data.js';
import { detectRange, inWash } from './sense.js';
import { segHit } from './util.js';
import { projectTo, onScr } from './cam.js';
import { inField } from './physics.js';

const hyp = Math.hypot, Q = { x: 0, y: 0, k: 0, ok: false }, Q2 = { x: 0, y: 0, k: 0, ok: false };
const PASSIVE = 2.4;     // sensors pick up a hot ship at this many times sight range
const GHOST = 75;        // seconds a last-known position is kept
export const SN = { ghosts: [new Map(), new Map()], contacts: [[], []], next: 0 };
const live = s => !s.dead && !s.offField;
const bodyClear = (ax, ay, bx, by) => { for (const b of BODIES) if (segHit(ax, ay, bx, by, b.x, b.y, b.r * .96) >= 0) return false; return true; };
// a contact's position is off by a steady amount for each ship, so blips do not jitter
const fuzz = s => { const h = Math.sin(s.id * 12.9898) * 43758.5453, a = (h - Math.floor(h)) * Math.PI * 2, d = 250 + ((h * 7) % 1 + 1) % 1 * 350; return [Math.cos(a) * d, Math.sin(a) * d]; };
const sizeOf = s => { const r = s.def.r0 ?? s.r; return r > 70 ? 'capital' : r > 30 ? 'large' : 'small'; };

export function setup() {
  SN.ghosts = [new Map(), new Map()]; SN.contacts = [[], []]; SN.next = 0; SN.amb = 0; SN.dT = null; S.decoys = [];
  // each side opens the battle knowing where the other was last reported
  for (const e of S.ships) if (e.team < 2 && live(e) && !e.def.static && !e.def.fighter && !e.def.shell) SN.ghosts[1 - e.team].set(e.id, { x: e.x, y: e.y, t: S.time, s: e, rep: true });
}

// decoy drones: they burn like capital ships, so the other side's sensors always hear them, until a ship sees one
function decoyTick(env) {
  const D = S.decoys; if (!D || !D.length) return; const dt = S.time - (SN.dT ?? S.time); SN.dT = S.time;
  for (const d of D) { d.x += d.vx * dt; d.y += d.vy * dt;
    if (S.time > d.t1) { d.gone = true; continue; }
    const spot = S.ships.find(o => o.team === 1 - d.team && live(o) && !o.derelict && o.def.sight && hyp(o.x - d.x, o.y - d.y) < lockOf(o) * .6 * env);
    if (spot) { d.gone = true; if (S.hooks && S.hooks.note) S.hooks.note(d.team === 1 ? 'A decoy: the capital contact was a drone' : 'Our decoy is unmasked', d.team === 1 ? 0xffd27a : 0xc8b890); if (d.team === 1 && S.hooks && S.hooks.voice) S.hooks.voice('decoy', spot); } }
  S.decoys = D.filter(d => !d.gone);
}
const DECOY_DEF = { name: 'Capital contact', value: 500, r0: 90, cmd: true };
export function tick() {
  if (S.time < SN.next) return; SN.next = S.time + .5;
  const env = S.env ? S.env.sight : 1; decoyTick(env);
  for (const T of [0, 1]) {
    const obs = S.ships.filter(o => o.team === T && live(o) && !o.derelict && o.def.sight), G = SN.ghosts[T], C = [];
    for (const e of S.ships) {
      if (e.team !== 1 - T || !live(e) || e.def.fighter || e.def.shell || e.def.static) continue;
      if (e.vis[T]) { G.set(e.id, { x: e.x, y: e.y, vx: e.vx, vy: e.vy, t: S.time, s: e }); continue; }
      if (S.wash && S.wash.length && inWash(e)) continue; /* lost in the energy wash of a blast */
      let hit = false, dm = 1e18, ob = null, str = 0;
      for (const o of obs) { const R = detectRange(o, e), dx = e.x - o.x, dy = e.y - o.y; if (Math.abs(dx) < R && Math.abs(dy) < R && dx * dx + dy * dy < R * R && bodyClear(o.x, o.y, e.x, e.y)) { hit = true; const d = Math.hypot(dx, dy); if (d < dm) { dm = d; ob = o; } str = Math.max(str, 1 - d / R); } }
      // a contact is a rough position: the further off, the rougher
      if (hit) { const [fx, fy] = fuzz(e), k = Math.max(1, Math.min(8, dm / 15000)); C.push({ x: e.x + fx * k, y: e.y + fy * k, s: e, size: sizeOf(e), hdg: Math.atan2(e.vy, e.vx), spd: Math.hypot(e.vx, e.vy), dm, ob, str, err: 300 * k * (1.3 - str * .6) }); }
    }
    for (const d of S.decoys || []) if (d.team === 1 - T) C.push({ x: d.x, y: d.y, s: { id: d.id, def: DECOY_DEF, x: d.x, y: d.y, r: 90 }, size: 'capital', decoy: true });
    SN.contacts[T] = C;
    for (const [id, g] of G) if (S.time - g.t > GHOST || g.s.dead || g.s.offField || g.s.team !== 1 - T) G.delete(id);
  }
  // ambushes: a ship lying quiet (in a rock field, running dark, or holding still), unseen and unheard for fifteen
  // seconds, that opens fire
  const heard = [new Set(SN.contacts[0].map(c => c.s.id)), new Set(SN.contacts[1].map(c => c.s.id))];
  for (const s of S.ships) {
    if (!live(s) || s.team > 1 || s.def.static || s.def.fighter || s.def.shell) { s._v = null; continue; }
    const foe = 1 - s.team, prev = s._v;
    if (s.vis[foe] || heard[foe].has(s.id) || s.unseen == null) s.unseen = S.time;
    if (prev && !prev[foe] && !s.ambushed && S.time - s.lastFire < .6 && S.time - (prev.since ?? S.time) > 15 && prev.sig < .45 && prev.quiet) {
      s.ambushed = true; s.gunT = S.time + 8; s.gunK = Math.max(s.gunK && s.gunT > S.time ? s.gunK : 1, 1.25);
      for (const o of S.ships) if (o.team === foe && live(o) && !o.def.static && o.def.crew > 2 && hyp(o.x - s.x, o.y - s.y) < 2200) o.loy = Math.max(0, o.loy - .08);
      if (S.time - (SN.ambT || -99) > 6 && S.hooks && S.hooks.note) { SN.ambT = S.time; if (s.team === 1 && S.hooks.voice) S.hooks.voice('ambush', null, { x: s.x, y: s.y }); if (S.shock) S.shock(foe, 6, 'Ambushed from the dark'); S.hooks.note(s.team === 0 ? `Ambush! ${s.title || 'Our ' + s.def.name} opens fire from the dark` : `Ambush! Enemy ships open fire from the dark`, s.team === 0 ? 0x9be8a8 : 0xff8a7a); }
    }
    s._v = [s.vis[0], s.vis[1]]; s._v.since = s.unseen; s._v.sig = s.sig; s._v.quiet = !!inField(s.x, s.y) || s.darkT > S.time - 2 || s.cold || (s.warmT && S.time - s.warmT < 3) || !!s.lying || (s.order && s.order.type === 'idle' && (s.throttle || 0) < .15);
  }
}
// what team T knows of the enemy: every ship in sight, every contact and every ghost, as positions
export function known(T) {
  const out = [], seen = new Set();
  for (const s of S.ships) if (s.team === 1 - T && live(s) && !s.def.static && s.vis[T]) { out.push(s); seen.add(s.id); }
  for (const c of SN.contacts[T]) if (!seen.has(c.s.id)) { out.push({ x: c.x, y: c.y, def: c.s.def, contact: true }); seen.add(c.s.id); }
  for (const [id, g] of SN.ghosts[T]) if (!seen.has(id) && g.s.def) out.push({ x: g.x, y: g.y, def: g.s.def, ghost: true });
  return out;
}
export const counts = () => ({ seen: S.ships.filter(s => s.team === 1 && live(s) && !s.def.static && !s.def.fighter && !s.def.shell && s.vis[0]).length, contacts: SN.contacts[0].length, ghosts: [...SN.ghosts[0].values()].filter(g => !g.s.vis[0] && !SN.contacts[0].some(c => c.s.id === g.s.id)).length });

// drawn on the battle overlay: contacts as amber diamonds, ghosts as dashed rings where a ship was last seen
export function draw(g, label, z, px) {
  g.ground();
  const contactIds = new Set(SN.contacts[0].map(c => c.s.id));
  for (const [id, gh] of SN.ghosts[0]) {
    if (contactIds.has(id) || gh.s.vis[0]) continue;
    const age = S.time - gh.t, a = Math.max(.12, .55 * (1 - age / GHOST)), r = Math.max(gh.s.r * 1.4, 10 * px);
    g.dashed(gh.x, gh.y, r, r * .5, r * .4); g.stroke({ width: 1.2 * px, color: 0xff8a7a, alpha: a });
    // where she may have gone: her last course, run on for as long as she has been out of sight, fading as it goes
    const sp = Math.hypot(gh.vx || 0, gh.vy || 0); if (sp > 15 && !gh.rep && age > 1.5) { const t = Math.min(age, 60), ex = gh.x + gh.vx * t, ey = gh.y + gh.vy * t, n = Math.min(14, Math.max(3, Math.round(t / 4)));
      for (let k = 1; k <= n; k++) { const f = k / n, qx = gh.x + (ex - gh.x) * f, qy = gh.y + (ey - gh.y) * f; g.circle(qx, qy, Math.max(1.4 * px, r * .08)).fill({ color: 0xff8a7a, alpha: a * (1 - f * .8) }); }
      const er = r * .6 + t * 24; g.dashed(ex, ey, er, er * .35, er * .3); g.stroke({ width: px, color: 0xff8a7a, alpha: a * .3 }); }
    if (gh.s.def.cmd && r * 1 > 4 * px) { projectTo(Q, gh.x, gh.y); if (Q.ok) label(`${gh.s.title || gh.s.def.name} · ${gh.rep ? 'last reported' : `seen ${Math.round(age)}s ago`}`, Q.x, Q.y + 14, 0xff9a8a, false, true); }
  }
  // the energy wash of a nuclear blast: a disc of static the sensors cannot see through, thinning as it clears
  for (const w of S.wash || []) { const age = S.time - w.t; if (age > WASH.hideT) continue; const k = 1 - age / WASH.hideT, R = WASH.hideR * (.8 + .2 * k); if (!onScr(w.x, w.y, R * z + 20)) continue;
    g.circle(w.x, w.y, R).fill({ color: 0xbfe6ff, alpha: .06 * k }); g.circle(w.x, w.y, R).stroke({ width: 1.5 * px, color: 0xbfe6ff, alpha: .25 * k });
    const n = Math.min(60, Math.round(R * z * .25)); for (let i = 0; i < n; i++) { const a = (i * 2.399 + S.time * 1.7) % 6.283, rr = R * ((Math.sin(i * 7.3 + S.time * 9) * .5 + .5) * .9 + .05); g.circle(w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr, Math.max(px * 1.2, R * .012)).fill({ color: 0xe8f6ff, alpha: .35 * k }); }
    projectTo(Q, w.x, w.y); if (Q.ok && R * z > 24) label('SENSOR WASH', Q.x, Q.y - R * z - 8, 0xbfe6ff, false, true); }
  // the error circle round each contact, on the ground, and a sweep pulse that runs out from it every few seconds
  for (const c of SN.contacts[0]) { if (c.decoy || !onScr(c.x, c.y, c.err * z + 30)) continue; const ph = ((S.time * .5 + c.s.id * .37) % 1);
    g.dashed(c.x, c.y, c.err, c.err * .25, c.err * .2); g.stroke({ width: px, color: 0xffc26a, alpha: .22 });
    g.circle(c.x, c.y, c.err * ph).stroke({ width: 1.2 * px, color: 0xffc26a, alpha: .35 * (1 - ph) }); }
  for (const d of S.decoys || []) if (d.team === 0) { projectTo(Q, d.x, d.y); if (!Q.ok) continue; g.screen(); g.poly([Q.x, Q.y - 7, Q.x + 7, Q.y, Q.x, Q.y + 7, Q.x - 7, Q.y]).stroke({ width: 1.2, color: 0x8fd3ff, alpha: .7 }); label('DECOY', Q.x, Q.y + 13, 0x8fd3ff, false, true); }
  g.screen();
  const strong = [...SN.contacts[0]].filter(c => !c.decoy && c.ob).sort((a, b) => b.str - a.str).slice(0, 6); // bearing lines only for the strongest, so the picture stays legible
  for (const c of strong) { projectTo(Q, c.x, c.y); projectTo(Q2, c.ob.x, c.ob.y); if (!Q.ok || !Q2.ok) continue; const L = Math.hypot(Q.x - Q2.x, Q.y - Q2.y); if (L < 40) continue; const ux = (Q.x - Q2.x) / L, uy = (Q.y - Q2.y) / L;
    for (let d = 14; d < L - 16; d += 14) g.circle(Q2.x + ux * d, Q2.y + uy * d, 1).fill({ color: 0xffc26a, alpha: .18 + .22 * c.str }); }
  // contacts close together on screen share one set of labels ("CONTACTS ×5 · ~97k km"), so a squadron reads as one
  const lab = new Map(), heads = []; const SIZE = { capital: 3, large: 2, small: 1 };
  for (const c of [...SN.contacts[0]].sort((a, b) => (SIZE[b.size] || 0) - (SIZE[a.size] || 0))) { projectTo(Q, c.x, c.y); if (!Q.ok) continue;
    const h = heads.find(o => Math.hypot(o.x - Q.x, o.y - Q.y) < 42); if (h) { h.n++; h.dm = Math.min(h.dm ?? 1e18, c.dm ?? 1e18); lab.set(c, null); } else { const o = { x: Q.x, y: Q.y, c, n: 1, dm: c.dm }; heads.push(o); lab.set(c, o); } }
  for (const c of SN.contacts[0]) {
    projectTo(Q, c.x, c.y); if (!Q.ok) continue; const k = c.size === 'capital' ? 9 : c.size === 'large' ? 7 : 5, hd = lab.get(c);
    g.poly([Q.x, Q.y - k, Q.x + k, Q.y, Q.x, Q.y + k, Q.x - k, Q.y]).stroke({ width: 1.4, color: 0xffc26a, alpha: .85 });
    if (c.spd > 20 && !c.decoy) { const qx = Q.x, qy = Q.y; projectTo(Q2, c.x + Math.cos(c.hdg) * 4000, c.y + Math.sin(c.hdg) * 4000); if (Q2.ok) { const L = Math.hypot(Q2.x - qx, Q2.y - qy) || 1, ux = (Q2.x - qx) / L, uy = (Q2.y - qy) / L; g.moveTo(qx + ux * k, qy + uy * k).lineTo(qx + ux * (k + 12), qy + uy * (k + 12)).stroke({ width: 1.4, color: 0xffc26a, alpha: .7 }); } projectTo(Q, c.x, c.y); }
    if (!c.decoy && c.str != null) { const bars = c.str > .66 ? 3 : c.str > .33 ? 2 : 1; for (let b = 0; b < 3; b++) g.rect(Q.x + k + 4 + b * 3, Q.y + 4 - b * 2.5, 2, 3 + b * 2.5).fill({ color: 0xffc26a, alpha: b < bars ? .85 : .2 }); } /* signal strength */
    if (!hd) continue; // one of a cluster: its head carries the labels
    if (c.size !== 'small' || hd.n > 1) label((hd.n > 1 ? 'CONTACTS ×' + hd.n : 'CONTACT') + (c.size === 'capital' ? ' · CAPITAL' : ''), Q.x, Q.y - k - 9, 0xffc26a, false, true);
    if (!c.decoy && hd.dm && hd.dm < 1e17 && z > .006) label(`~${(hd.dm / 1000).toFixed(0)}k km`, Q.x, Q.y + k + 10, 0xd9a85a, false, true);
  }
}
