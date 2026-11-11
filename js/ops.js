// Battle orders that come out of the campaign. A world under heavy attack can be held for ten minutes rather than
// to the death, and its people evacuated; a world of ours under blockade can be relieved by running a convoy
// through the blockading fleet. The campaign pays for what gets through.
import { S } from './state.js';
import { bodyOf } from './solar.js';
import { makeShip } from './sim.js';
import { bodyIdx } from './solar.js';
import { projectTo } from './cam.js';

const hyp = Math.hypot;
export const OP = { list: [], hold: null, convoy: [], kind: null, quest: null, zones: null, orb: null, lag: null };
const live = s => s && !s.dead && !s.surrendered && !s.derelict && !s.offField;
const pods = () => S.ships.filter(s => s.team === 0 && live(s) && s.def.troops && !s.def.fighter && !s.def.shell);
const armedShip = s => !s.dead && !s.offField && !s.def.static && !s.surrendered && !s.derelict && !s.def.fighter && !s.def.shell && s.weapons.length && s.type !== 'hauler' && s.type !== 'tender';
const value = t => S.ships.reduce((a, s) => a + (s.team === t && armedShip(s) ? (s.def.value || 50) * s.hp / s.def.hp : 0), 0);
const TNAMES = ['Long Road', 'Lantern', 'Hearthward', 'Ninth Mercy', 'Low Tide', 'Grey Harbour'];

// ctx: { world, defTeam, ang, withWorld, besieged (our world under blockade by this foe), res (pending reserves) }
export function setup(ctx) {
  const b = bodyOf(ctx.world), name = b.name; OP.list = []; OP.hold = null; OP.convoy = []; OP.kind = null; OP.world = ctx.world; OP.ang = ctx.ang; OP.got = 0; OP.lost = 0; OP.quest = null; OP.zones = null; OP.defTeam = ctx.defTeam; OP.orb = null; OP.lag = null; OP.attTeam = 1 - ctx.defTeam;
  S.opsDraw = draw;
  if (ctx.space) { if (ctx.lagrange) setupLagrange(ctx); return OP; } // deep space: nobody to evacuate, but there may be ground worth holding
  if (ctx.quest) { setupQuest(ctx, b); return OP; }
  if (ctx.assault) { setupAssault(ctx, b); return OP; }
  if (ctx.orbit) setupOrbit(ctx, b);
  const mine = value(0), theirs = value(1);
  // outnumbered at home: hold for ten minutes, and get the people out
  if (ctx.defTeam === 0 && theirs > mine * 1.5) {
    OP.hold = { until: 600, R: b.r + 8000 };
    OP.list.push({ k: 'hold', text: `Hold ${name}’s orbit for 10 minutes: keep a warship within 8,000 km of the world, and the assault breaks off` });
    if (ctx.withWorld) {
      OP.kind = 'evac';
      spawnConvoy(b, ctx.ang + Math.PI, b.r + 900, 3);
      OP.list.push({ k: 'evac', text: `Evacuate: get the transports 18,000 km clear of ${name}. Each one out brings its people and stores home` });
    }
  }
  // our world under blockade: run a relief convoy through to it
  if (ctx.defTeam === 1 && ctx.besieged) {
    OP.kind = 'relief';
    spawnConvoy(b, ctx.ang, (ctx.attR || 17000) + 600, 3);
    OP.list.push({ k: 'relief', text: `Run the blockade: get the relief convoy to ${name} (within 1,000 km of its surface). Two through lifts the siege` });
  }
  return OP;
}
function spawnConvoy(b, a, R, n) {
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 260, s = makeShip('tender', 0, b.x + ux * R + vx * off, b.y + uy * R + vy * off, a + Math.PI);
    // laden transports: sturdier than a tender, slower, and never on a transit burn inside the battle
    s.def = { ...s.def, name: OP.kind === 'evac' ? 'Evacuation Transport' : 'Relief Transport', role: 'Laden transport · point defense only', cruise: 170, hp: 900, shield: 300 }; s.hp = 900; s.sh = 300; s.noTransit = true;
    s.vx = b.vx; s.vy = b.vy; s.supply = 0; s.convoy = OP.kind; s.title = 'Transport ' + TNAMES[i % TNAMES.length]; s.vis = [true, true, true];
    s.order = { type: 'idle', x: s.x, y: s.y }; OP.convoy.push(s); // makeShip has put it on the field
  }
}
// ---------------------------------------------------------------- quest battles: an objective of the hero's own
function setupQuest(ctx, b) {
  const Q = OP.quest = { ...ctx.quest, t: 0, done: false, targets: [] };
  const heroShip = () => { const c = (S.cmdrs || []).find(c => c.team === 0 && c.camp && (c.camp.name || '').startsWith(Q.hero) && c.state === 'aboard' && live(c.ship)); return c ? c.ship : null; };
  Q.heroShip = heroShip; Q.at = ctx.gov || { x: b.x, y: b.y };
  if (Q.kind === 'kill') { const bi = bodyIdx(OP.world), R = b.r + 1800; for (let i = 0; i < (Q.n || 3); i++) { const p = makeShip('gunplat', ctx.defTeam === 0 ? 1 : ctx.defTeam, b.x + R, b.y, 0); p.orbit = { b: bi, R, period: Math.max(240, Math.PI * 2 * R / 25), ph: (ctx.ang || 0) + (i - 1) * .55 }; p.def = { ...p.def, name: 'Slipway', role: 'A shipyard slipway in high orbit · a hull half-built in its cradle' }; p.title = ['Slipway One', 'Slipway Two', 'Slipway Three'][i] || 'Slipway'; p.slipway = true; p.vis = [true, true, true]; Q.targets.push(p); } }
  if (Q.kind === 'flag') { const L = S.ships.filter(s => s.team === 1 && live(s) && s.def.cmd).sort((a, c) => (c.cmdr ? 1e5 : 0) + (c.def.value || 0) - (a.cmdr ? 1e5 : 0) - (a.def.value || 0)); if (L[0]) { Q.targets.push(L[0]); L[0].questFlag = true; } }
  if (Q.kind === 'hold') OP.hold = { until: Q.T || 360, R: b.r + (Q.R || 8000) };
  OP.list.push({ k: 'quest', text: Q.text });
}
function questTick(t) {
  const Q = OP.quest; if (!Q || Q.done) return null; const b = bodyOf(OP.world);
  if (Q.kind === 'reach') { const h = Q.heroShip(); if (!h) { Q.done = true; note(`${Q.hero} is out of the fight: the raid cannot go in`, 0xff8a7a); return { attWin: false, quest: 'lost', msg: `${Q.hero} is out of the fight` }; }
    const g = Q.at && !Q.at.dead ? Q.at : b; if (hyp(h.x - g.x, h.y - g.y) < Q.R) { Q.t += 1; if (Q.t >= Q.T) { Q.done = true; note('The raid goes in: the Minotaur leads Darrow’s Howlers into the citadel', 0x9be8a8); return { attWin: true, quest: 'won', msg: 'The raid goes in' }; } } else Q.t = Math.max(0, Q.t - .5); }
  if (Q.kind === 'kill' || Q.kind === 'flag') { if (Q.targets.length && Q.targets.every(s => s.dead || s.surrendered || s.derelict || s.team === 0)) { Q.done = true; note(Q.kind === 'kill' ? 'The last slipway burns' : 'The enemy flagship is out of the fight', 0x9be8a8); return { attWin: true, quest: 'won', msg: Q.kind === 'kill' ? 'The yards burn' : 'The flagship is done' }; } }
  if (Q.kind === 'hold' && OP.hold && t >= OP.hold.until) { const held = S.ships.some(s => s.team === 0 && armedShip(s) && hyp(s.x - b.x, s.y - b.y) < OP.hold.R); OP.hold = null; Q.done = true; if (held) return { attWin: false, held: true, quest: 'won', msg: `${b.name} holds: the assault breaks off` }; return { attWin: true, quest: 'lost', msg: 'The orbit is lost' }; }
  return null;
}
// ---------------------------------------------------------------- the Iron Rain as a battle: three landing zones on the world's disk
// Each zone holds a third of the garrison. A leechCraft that comes within 1,600 km of a zone lands its troops (the
// platforms near the zone shoot down a share of them); warships within 5,000 km give fire support. The legions and the
// garrison grind each other down; holding two zones of three takes the world.
export const LAND_R = 1600, FS_R = 5000;
function setupAssault(ctx, b) {
  const A = ctx.assault, ang = ctx.ang || 0, names = ['Zone Alpha', 'Zone Bravo', 'Zone Charlie'];
  // on the disk of a great world; over the limb of a small one, far enough apart that each is its own fight
  const R = b.r >= 3000 ? b.r * .62 : b.r + 1200, step = Math.max(.7, 2 * Math.asin(Math.min(1, 2300 / R)));
  OP.zones = [-1, 0, 1].map((k, i) => { const a = ang + k * step; return { i, name: names[i], a, x: b.x + Math.cos(a) * R, y: b.y + Math.sin(a) * R, D: A.def / 3, D0: A.def / 3, g0: A.g / 3, A: 0, T: 0, fs: 0, held: false, lost: 0, landed: 0 }; });
  OP.amul = A.mul; OP.dmul = A.dmul; OP.list.push({ k: 'zones', text: `Take 2 of the 3 landing zones on ${b.name}: leechCraft within ${LAND_R.toLocaleString()} km of a zone land their legions; warships within ${FS_R.toLocaleString()} km give fire support` });
}
function assaultTick() {
  const Z = OP.zones; if (!Z) return null; const b = bodyOf(OP.world);
  const plats = S.ships.filter(s => s.team === OP.defTeam && live(s) && (s.type === 'gunplat' || s.type === 'shieldplat'));
  for (const z of Z) {
    // the drop: pods that reach the zone are spent, and land what the platforms do not shoot down
    for (const s of pods()) { if (hyp(s.x - z.x, s.y - z.y) > LAND_R) continue; const near = plats.filter(p => hyp(p.x - z.x, p.y - z.y) < 14000), shot = Math.min(.6, near.filter(p => p.type === 'gunplat').length * .12 + near.filter(p => p.type === 'shieldplat').length * .05);
      const tr = (s.troops || s.def.troops || 0) * (1 - shot); z.A += tr * 5 * OP.amul; z.T += tr; z.landed += tr; s.dead = true; s.rained = true; s.offField = true; if (S.selection) S.selection = S.selection.filter(o => o !== s);
      note(`${s.title || 'A leechCraft'} lands at ${z.name}${shot ? ': ' + Math.round(shot * 100) + '% shot down on the way in' : ''}`, 0xe8c87e); }
    // fire support from low orbit
    z.fs = S.ships.reduce((a, s) => a + (s.team === 0 && armedShip(s) && !s.def.troops && hyp(s.x - z.x, s.y - z.y) < FS_R ? (s.def.value || 50) * s.hp / s.def.hp : 0), 0);
    if (z.held) { z.A += 0; continue; }
    const f = Math.min(1, z.fs / 3000), kA = .003, kD = .0025, A0 = z.A, D0 = z.D; /* a zone tips over in two to four minutes */
    if (A0 > 0 && D0 > 0) { z.D = Math.max(0, D0 - A0 * kA * (1 + f)); const dA = Math.min(A0, D0 * kD); z.A = A0 - dA; z.T = z.A / (5 * OP.amul); z.lost += dA / (5 * OP.amul); }
    else if (D0 > 0 && z.fs > 0) z.D = Math.max(0, D0 - z.fs * .0012); /* fire support alone wears a garrison down, slowly */
    if (z.D <= 0 && z.A > 0 && !z.held) { z.held = true; note(`${z.name} is ours: the legions hold the ground`, 0x9be8a8); }
    if (z.D <= 0 && z.A <= 0) z.D = 1;
  }
  const held = Z.filter(z => z.held).length;
  if (held >= 2) { OP.heldTroops = Z.reduce((a, z) => a + (z.held ? z.T : 0), 0); return { attWin: true, taken: true, msg: `Two zones of three: ${b.name} falls` }; }
  // the drop is spent: no pods left, and nobody fighting on the ground
  if (!pods().length && Z.every(z => z.held || z.A <= 0) && (Z.some(z => z.landed > 0) || S.time > 20)) return { attWin: false, rainFailed: true, msg: `The legions are spent: ${b.name} holds` };
  return null;
}
export const garrisonLeft = () => OP.zones ? Math.round(OP.zones.reduce((a, z) => a + (z.held ? 0 : z.D), 0) / (OP.dmul || 1)) : null;
// ---------------------------------------------------------------- an assault from orbit: the guns, the drop corridor, the cities
// The pods cannot go down through live guns or a contested sky. The attacker must silence the world's gun platforms,
// then hold a drop corridor over the near limb, alone, for 45 seconds; then the Iron Rain can fall. A defender that keeps
// a warship in the corridor stops the clock. An attacker with a capital ship in low orbit may bomb the capital first:
// the garrison breaks, and every world that hears of it remembers.
export const CORR_R = 3600, CORR_T = 45, BOMB_T = 20;
const CAPITALS = { mercury: 'Tyche', venus: 'Gorgon Isle', earth: 'the cities of Earth', luna: 'Hyperion', mars: 'Agea', phobos: 'the Phobos docks', io: 'the Io refineries', ganymede: 'Ganymede’s cities', europa: 'the Europan sea-towns', callisto: 'Callisto’s cities', titan: 'Titan’s domes', rhea: 'Rhea’s cities' };
export const capitalOf = w => CAPITALS[w] || `the cities of ${bodyOf(w).name}`;
function setupOrbit(ctx, b) {
  const a = ctx.ang || 0, d = b.r + CORR_R + 700; /* clear of the surface: its inner edge 700 km up */
  OP.orb = { ox: Math.cos(a) * d, oy: Math.sin(a) * d, x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, R: CORR_R, prog: 0, open: false, guns0: guns().length, pods: !!ctx.pods, bomb: null, bombed: false, cap: capitalOf(ctx.world), state: 'shut' };
}
const guns = () => S.ships.filter(s => s.team === OP.defTeam && live(s) && s.type === 'gunplat');
const inZone = (t, z, R) => S.ships.some(s => s.team === t && armedShip(s) && !s.broken && hyp(s.x - z.x, s.y - z.y) < R);
function orbTick() {
  const O = OP.orb, b = bodyOf(OP.world); O.x = b.x + O.ox; O.y = b.y + O.oy;
  const g = guns().length, att = inZone(OP.attTeam, O, O.R), def = inZone(OP.defTeam, O, O.R);
  O.state = O.open ? 'open' : g ? 'guns' : att && !def ? 'holding' : def && att ? 'contested' : def ? 'held' : 'empty';
  if (!O.open && !g) { if (att && !def) O.prog = Math.min(CORR_T, O.prog + 1); else if (def && !att) O.prog = Math.max(0, O.prog - 2); }
  if (!O.open && O.prog >= CORR_T) { O.open = true; note(OP.attTeam === 0 ? `The drop corridor over ${b.name} is open: the Iron Rain can fall` : `The enemy holds the drop corridor over ${b.name}: their pods can fall`, OP.attTeam === 0 ? 0x9be8a8 : 0xff8a7a); if (OP.attTeam === 0 && S.hooks && S.hooks.voice) S.hooks.voice('corridor', null, { x: O.x, y: O.y }); }
  // the bombardment: a capital ship in low orbit, the guns silent
  const B = O.bomb; if (B && !B.done) { const ship = B.by; if (!live(ship) || hyp(ship.x - b.x, ship.y - b.y) > b.r + 6000) { O.bomb = null; note('The bombardment is broken off: the ship has left low orbit', 0xff8a7a); }
    else { B.left -= 1; if (S.hooks && S.hooks.bombFx) S.hooks.bombFx(b, O); if (B.left <= 0) { B.done = true; O.bombed = true; note(`${O.cap} burns. The garrison is broken, and every world will hear of it`, 0xffb070); if (S.shock) S.shock(OP.defTeam, S.ships.some(s => s.team === OP.attTeam && live(s) && ((s.h && s.h.boarder > 0) || (s.def.troops && !s.def.fighter))) ? 14 : 5, `${O.cap} bombarded`); if (S.hooks && S.hooks.voice && OP.attTeam === 0) S.hooks.voice('bomb', ship); } } }
  return null;
}
// a capital ship of the attacker's within 6,000 km of the world's surface, the guns silent
export function bombCan(team) {
  const O = OP.orb; if (!O || team !== OP.attTeam) return { ok: false, why: 'Only the attacker can bombard' };
  if (O.bombed || (O.bomb && !O.bomb.done)) return { ok: false, why: O.bombed ? `${O.cap} is already burning` : 'The bombardment is under way' };
  if (guns().length) return { ok: false, why: `Silence the guns first: ${guns().length} gun platform${guns().length > 1 ? 's' : ''} still firing` };
  const b = bodyOf(OP.world), by = S.ships.find(s => s.team === team && armedShip(s) && s.def.cmd && hyp(s.x - b.x, s.y - b.y) < b.r + 6000);
  return by ? { ok: true, by } : { ok: false, why: 'Bring a capital ship within 6,000 km of the surface' };
}
export function bombStart(team) { const c = bombCan(team); if (!c.ok) return c; OP.orb.bomb = { by: c.by, left: BOMB_T, done: false }; note(`${c.by.title || 'The ' + c.by.def.name} opens her bomb bays over ${OP.orb.cap}`, 0xffb070); return c; }
// ---------------------------------------------------------------- deep space: a Lagrange point worth holding
// Where the courses cross there is a stable point (a picket station's anchorage, a fuel cache). The side that holds it
// alone for two minutes, all told, holds the field.
export const LAG_R = 4200, LAG_T = 120, LAG_NEAR = 60000;
function setupLagrange(ctx) {
  const h = ctx.head || 0, side = ctx.side || 1, x = ctx.pt.x + Math.cos(h) * 45000 - Math.sin(h) * 22000 * side, y = ctx.pt.y + Math.sin(h) * 45000 + Math.cos(h) * 22000 * side;
  OP.lag = { x, y, R: LAG_R, vp: [0, 0], need: LAG_T, state: 'empty' };
  OP.list.push({ k: 'lag', text: `Hold the Lagrange point alone for ${LAG_T / 60} minutes, all told, while the enemy is still within ${LAG_NEAR.toLocaleString()} km of it, and the field is yours` });
}
function lagTick() {
  const Lg = OP.lag, a = inZone(0, Lg, Lg.R), e = inZone(1, Lg, Lg.R), nearA = inZone(0, Lg, LAG_NEAR), nearE = inZone(1, Lg, LAG_NEAR);
  // the point counts only while the other side is still in the fight around it: a fleet that runs for the line has not lost it
  Lg.state = a && e ? 'contested' : a ? (nearE ? 'ours' : 'quiet') : e ? (nearA ? 'theirs' : 'quiet') : 'empty';
  if (a && !e && nearE) Lg.vp[0]++; else if (e && !a && nearA) Lg.vp[1]++;
  for (const t of [0, 1]) if (Lg.vp[t] >= Lg.need) { const attWin = t === OP.attTeam; Lg.done = true; return { attWin, held: !attWin, lagrange: true, msg: t === 0 ? 'The Lagrange point is ours: the field is ours' : 'They hold the Lagrange point: the field is theirs' }; }
  return null;
}
// when the battle begins, the convoy sets off on its own: the player can redirect it
export function begin() {
  const b = bodyOf(OP.world);
  for (const s of OP.convoy) {
    if (s.dead) continue;
    if (OP.kind === 'evac') { const a = OP.ang + Math.PI; s.order = { type: 'move', x: b.x + Math.cos(a) * (b.r + 20000), y: b.y + Math.sin(a) * (b.r + 20000) }; }
    else s.order = { type: 'move', x: b.x + (s.x - b.x) / hyp(s.x - b.x, s.y - b.y) * (b.r + 500), y: b.y + (s.y - b.y) / hyp(s.x - b.x, s.y - b.y) * (b.r + 500) };
  }
}
const note = (t, c) => S.hooks && S.hooks.note && S.hooks.note(t, c);
// once a second; returns a result for the battle when an order decides it
export function tick(t) {
  const b = bodyOf(OP.world);
  if (OP.quest) return questTick(t);
  if (OP.zones) return assaultTick();
  if (OP.lag && !OP.lag.done) { const r = lagTick(); if (r) return r; }
  if (OP.orb) orbTick();
  for (const s of OP.convoy) {
    if (s.done) continue;
    if (s.dead || s.surrendered || s.team !== 0) { s.done = true; OP.lost++; note(`${s.title} is lost`, 0xff8a7a); continue; }
    const d = hyp(s.x - b.x, s.y - b.y);
    if ((OP.kind === 'evac' && d > b.r + 18000) || (OP.kind === 'relief' && d < b.r + 1000)) {
      s.done = true; OP.got++; s.offField = true; S.ships = S.ships.filter(o => o !== s); if (S.selection) S.selection = S.selection.filter(o => o !== s);
      note(OP.kind === 'evac' ? `${s.title} is clear of ${b.name} with its people aboard` : `${s.title} is through to ${b.name}`, 0x9be8a8);
    }
  }
  if (OP.hold && t >= OP.hold.until) {
    const held = S.ships.some(s => s.team === 0 && armedShip(s) && hyp(s.x - b.x, s.y - b.y) < OP.hold.R);
    OP.hold = null;
    if (held) return { attWin: false, held: true };
    note('Ten minutes, and no warship of ours holds the orbit: the assault goes on', 0xff8a7a);
  }
  return null;
}
export function statusOf(k, t) {
  if (k === 'hold') { if (!OP.hold) return ''; const r = Math.max(0, OP.hold.until - t); return ` · ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')} left`; }
  if (k === 'evac' || k === 'relief') return ` · ${OP.got} of ${OP.convoy.length} through${OP.lost ? `, ${OP.lost} lost` : ''}`;
  if (k === 'quest' && OP.quest) { const Q = OP.quest; if (Q.kind === 'reach') return ` · ${Math.floor(Q.t)} of ${Q.T} s`; if (Q.kind === 'kill' || Q.kind === 'flag') return ` · ${Q.targets.filter(s => s.dead || s.surrendered || s.derelict || s.team === 0).length} of ${Q.targets.length}`; if (Q.kind === 'hold' && OP.hold) { const r = Math.max(0, OP.hold.until - t); return ` · ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')} left`; } }
  if (k === 'zones' && OP.zones) return ' · ' + OP.zones.map(z => `${z.name.split(' ')[1][0]} ${z.held ? 'held' : z.A > 0 ? Math.round(100 * z.A / (z.A + z.D)) + '%' : '—'}`).join(' · ');
  return '';
}
// the objectives on the field: the landing zones with how the fight on the ground stands; the quest's targets
const Q2 = { x: 0, y: 0, k: 0, ok: false };
function draw(g, label, z, px) {
  if (OP.zones) { g.ground();
    for (const Z of OP.zones) { const r = LAND_R, tot = Z.A + Z.D || 1, k = Z.held ? 1 : Z.A / tot, col = Z.held ? 0x9be8a8 : Z.A > 0 ? 0xe8c87e : 0xff8a7a;
      g.circle(Z.x, Z.y, r).fill({ color: col, alpha: .05 }); g.dashed(Z.x, Z.y, r, r * .12, r * .08); g.stroke({ width: 1.6 * px, color: col, alpha: .7 });
      if (k > 0) { g.moveTo(Z.x + Math.cos(-Math.PI / 2) * r * 1.12, Z.y + Math.sin(-Math.PI / 2) * r * 1.12); g.arc(Z.x, Z.y, r * 1.12, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke({ width: 3.2 * px, color: 0x9be8a8, alpha: .9 }); }
      g.circle(Z.x, Z.y, FS_R).stroke({ width: px, color: 0xe8c87e, alpha: .12 });
      projectTo(Q2, Z.x, Z.y); if (Q2.ok) label(`${Z.name.toUpperCase()} · ${Z.held ? 'HELD' : Z.A > 0 ? Math.round(Z.T).toLocaleString() + ' vs ' + Math.round(Z.D / (OP.dmul || 1)).toLocaleString() : Math.round(Z.D / (OP.dmul || 1)).toLocaleString() + ' defenders'}${Z.fs > 0 && !Z.held ? ' · fire support' : ''}`, Q2.x, Q2.y - 18, col, false, true); } }
  if (OP.quest) { const Q = OP.quest; g.ground();
    for (const s of Q.targets) if (!s.dead) { g.circle(s.x, s.y, Math.max(s.r * 2, 600)).stroke({ width: 1.8 * px, color: 0xffd27a, alpha: .8 }); projectTo(Q2, s.x, s.y); if (Q2.ok) label('◆ ' + (s.title || s.def.name).toUpperCase(), Q2.x, Q2.y - 22, 0xffd27a, false, true); }
    if (Q.kind === 'reach') { const p = Q.at && !Q.at.dead ? Q.at : bodyOf(OP.world); g.circle(p.x, p.y, Q.R).fill({ color: 0xffd27a, alpha: .04 }); g.dashed(p.x, p.y, Q.R, Q.R * .08, Q.R * .06); g.stroke({ width: 1.6 * px, color: 0xffd27a, alpha: .6 }); projectTo(Q2, p.x, p.y); if (Q2.ok) label(`THE CITADEL · ${Math.floor(Q.t)}/${Q.T} s`, Q2.x, Q2.y + 26, 0xffd27a, false, true); } }
  const ring = (Z, k, col, txt) => { const r = Z.R; g.ground(); g.circle(Z.x, Z.y, r).fill({ color: col, alpha: .045 }); g.dashed(Z.x, Z.y, r, r * .07, r * .05); g.stroke({ width: 1.6 * px, color: col, alpha: .75 });
    if (k > 0) { g.moveTo(Z.x, Z.y - r * 1.08); g.arc(Z.x, Z.y, r * 1.08, -Math.PI / 2, -Math.PI / 2 + Math.min(1, k) * Math.PI * 2); g.stroke({ width: 3.4 * px, color: col, alpha: .95 }); }
    projectTo(Q2, Z.x, Z.y - r); if (Q2.ok) label(txt, Q2.x, Q2.y - 12, col, true); };
  if (OP.orb) { const O = OP.orb, st = O.state, col = O.open ? 0x9be8a8 : st === 'holding' ? 0xe8c87e : st === 'guns' ? 0x8a8478 : 0xff8a7a;
    ring(O, O.prog / CORR_T, col, `DROP CORRIDOR · ${O.open ? 'OPEN' : st === 'guns' ? 'GUNS STILL FIRING' : st === 'contested' ? 'CONTESTED' : st === 'held' ? 'HELD BY THE DEFENDERS' : Math.floor(O.prog) + ' / ' + CORR_T + ' s'}`); }
  if (OP.lag) { const Lg = OP.lag, col = Lg.state === 'ours' ? 0x9be8a8 : Lg.state === 'theirs' ? 0xff8a7a : Lg.state === 'contested' ? 0xe8c87e : 0xb8b0a0;
    ring(Lg, Math.max(Lg.vp[0], Lg.vp[1]) / Lg.need, col, `LAGRANGE POINT · ${Math.floor(Lg.vp[0])} – ${Math.floor(Lg.vp[1])} of ${Lg.need}`); }
}
export function teardown() { OP.list = []; OP.convoy = []; OP.hold = null; OP.kind = null; OP.quest = null; OP.zones = null; OP.orb = null; OP.lag = null; S.opsDraw = null; }
if (typeof window !== 'undefined') window.__OPS = OP;
