// The tactical layer of a campaign battle: pacing (the approach runs fast until the fleets close), readability
// (a tactical overlay of ranges, arcs and fire; a kill feed; hit marks and callouts) and the battle zone. The
// rules of the fight itself live in sim.js; this module only watches it, draws it and nudges the clock.
import { S } from './state.js';
import { logLine, speedTxt } from './ui.js';
import { projectTo } from './cam.js';
import { groupList, groupOrder, shMax } from './sim.js';
import { bodyOf } from './solar.js';
import * as MO from './morale.js';
import * as TRN from './terrain.js';
import * as SNS from './sensors.js';
import * as CO from './comms.js';

const hyp = Math.hypot, Q = { x: 0, y: 0, k: 0, ok: false }, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const CONTACT = 16000;           // km: inside this (just outside missile reach), the approach is over and the clock runs at the player's speed
const FF = 12;                  // the approach runs at twelve times speed
const armedShip = s => !s.dead && !s.def.static && !s.surrendered && !s.derelict && !s.def.fighter && !s.def.shell && s.weapons.length && !s.convoy;
export const T = { feed: [], callouts: [], hits: [], tac: false, ff: false, prev: 1, contact: false, rain: [] };

export function setup() {
  Object.assign(T, { dmg: [{}, {}], kills: [], rain: [], feed: [], callouts: [], hits: [], beams: [], ff: false, ffOff: false, stall: false, stallG: null, stallT: 0, prev: S.speed || 1, contact: false, lastCheck: 0, engaged: false, foe0: str(1), real: 0, slowUntil: 0, slowPrev: 1, lastSlow: -99 });
  S.hooks = { kill: onKill, shDown: onShDown, hit: onHit, absorb: onAbsorb, halfDown: onHalfDown, note: (t, c) => push(t, c), board: onBoard, beam: onBeam, wrecked: onWrecked, nuke: onNuke, voice, capture: onCapture, ripple: onRipple, bombFx }; T.rip = []; T.bombs = []; T.decks = new Map(); CO.reset(); T.hullTold = new Set(); T.nukes = [0, 0]; S.wash = [];
  S.battleOverlay = draw; SNS.setup(); S.decksFn = decks; S.boardAim0 = null; DIR.cur = null; DIR.heat = new Map(); DIR.lastCut = -99; S.pip = null;
}
// ---------------------------------------------------------------- comms: who speaks for what happened
// s: the ship that speaks, or null to let the flagship (or the nearest ship to o.x, o.y) speak
export function voice(kind, s, o = {}) {
  if (o.enemy) return CO.say(kind, s || CO.flagOf(1), o);
  const sp = s && s.team === 0 && !s.dead ? s : o.x != null ? CO.nearestOurs(o.x, o.y) : CO.flagOf(0) || CO.nearestOurs(0, 0);
  return CO.say(kind, sp, o);
}
// ---------------------------------------------------------------- the action camera: a director that cuts to the moment
// Every event that matters bids for the window in the corner: a capital ship dying, a lance shot, boarders on a deck,
// a duel, a ship taken, the Rain. The best bid wins, holds for a few seconds, and a better one cuts in.
const DIR = { cur: null, lastCut: -99, heat: new Map(), off: false };
export function cut(kind, o, score, hold, text) {
  if (!o || S.mode !== 'battle') return; const now = S.time, C0 = DIR.cur;
  if (C0 && now < C0.until && (score < C0.score * 1.25 || now - DIR.lastCut < 1.5)) return;
  const ship = o.def ? o : null;
  DIR.cur = { kind, ship, x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, score, until: now + hold, t0: now, text, az: (Math.random() - .5) * 1.6, R: o.R || null }; DIR.lastCut = now;
  if (typeof document !== 'undefined') { const c = document.querySelector('#pip .pcap'); if (c) { c.textContent = text; c.parentNode.classList.remove('cutin'); void c.parentNode.offsetWidth; c.parentNode.classList.add('cutin'); } }
}
const vrOf = s => s.def.vr0 && !s.def.static ? s.def.vr0 * (S.hullX || 30) / 30 : s.r;
export function pipFrame(dt) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('pip');
  if (!el) { el = document.createElement('div'); el.id = 'pip'; el.innerHTML = '<div class="ptag">Action</div><div class="pcap"></div><button class="px" title="Hide the action camera">×</button>'; document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target.closest('.px')) { DIR.off = !DIR.off; el.classList.toggle('off', DIR.off); return; } if (DIR.off) { DIR.off = false; el.classList.remove('off'); return; } const C0 = DIR.cur; if (C0) { S.cam.x = C0.x; S.cam.y = C0.y; S.cam.z = Math.max(S.cam.z, .05); S.follow = null; } }); }
  const now = S.time; let C0 = DIR.cur;
  // nothing on: the hottest capital ship in the fight
  if ((!C0 || now > C0.until) && T.contact) {
    let best = null, bv = 0; for (const [s, h] of DIR.heat) { if (s.dead || now - h.t > 6) { DIR.heat.delete(s); continue; } if (!s.def.cmd && !s.cmdr) continue; /* only a capital ship's fight is worth the window; else it stays dark */ const v = h.v * (s.cmdr ? 1.6 : 1); if (v > bv && h.v > 4) { bv = v; best = s; } }
    if (best) cut('heat', best, 12, 6, `${best.team === 0 ? '' : 'Enemy '}${best.title || best.def.name} under fire`); C0 = DIR.cur; }
  const live = C0 && now < C0.until + 1.5 && !DIR.off && !S.orrery;
  el.classList.toggle('show', !!live || DIR.off); 
  if (!live) { S.pip = null; return; }
  if (C0.ship && !C0.ship.dead) { C0.x = C0.ship.x; C0.y = C0.ship.y; C0.vx = C0.ship.vx; C0.vy = C0.ship.vy; } else { C0.x += C0.vx * dt * S.speed * (S.paused ? 0 : 1); C0.y += C0.vy * dt * S.speed * (S.paused ? 0 : 1); }
  const b = el.getBoundingClientRect(), r = { x: Math.round(b.left) + 1, y: Math.round(b.top) + 1, w: Math.round(b.width) - 2, h: Math.round(b.height) - 2 };
  const vr = C0.ship ? vrOf(C0.ship) : (C0.R || 900), zT = Math.max(.004, Math.min(14, r.w * (C0.ship ? .22 : .35) / vr));
  const P = S.pip || (S.pip = { on: true, cam: { x: C0.x, y: C0.y, z: zT }, elev: .62 }); P.on = true; P.rect = r;
  const k = Math.min(1, dt * 6), cam = P.cam; if (P.shot !== C0) { P.shot = C0; cam.x = C0.x; cam.y = C0.y; cam.z = zT; } else { cam.x += (C0.x - cam.x) * k; cam.y += (C0.y - cam.y) * k; cam.z += (zT - cam.z) * Math.min(1, dt * 2); }
  P.az = C0.az + (now - C0.t0) * .06;
}
function heat(s, v) { if (!s || s.def.fighter || s.def.shell || s.def.static) return; const h = DIR.heat.get(s) || { v: 0, t: S.time }; h.v = h.v * Math.max(0, 1 - (S.time - h.t) / 6) + v; h.t = S.time; DIR.heat.set(s, h); }
// a banner across the screen for the moments that turn a battle: a capital ship taken, a flagship lost
export function banner(kind, head, name, sub) {
  if (typeof document === 'undefined') return; const el = document.createElement('div'); el.className = 'capban ' + kind;
  el.innerHTML = `<i>${head}</i><b>${name}</b><span>${sub}</span>`; document.body.appendChild(el); setTimeout(() => el.remove(), 4800);
  while (document.querySelectorAll('.capban').length > 2) document.querySelector('.capban').remove();
}
// a shield taking a hit: a ripple of light round the side of the bubble that took it
function onRipple(s, x, y, big) { heat(s, big ? 3 : 1); if (T.rip.length > 120 || (s.vis && !s.vis[0] && s.team !== 0)) return; T.rip.push({ s, a: Math.atan2(y - s.y, x - s.x), t: S.time, big }); }
// the bombardment: fire walking across the city
function bombFx(b, O) { for (let i = 0; i < 3; i++) { const a = Math.atan2(O.y - b.y, O.x - b.x) + (Math.random() - .5) * .8, r = b.r * (.55 + Math.random() * .4); T.bombs.push({ x0: Math.cos(a) * r, y0: Math.sin(a) * r, b, t: S.time + Math.random() }); } }
// a nuclear blast: who fired it is remembered (every government answers for its warheads), and the sensors round it go white
function onNuke(x, y, team) {
  if (team < 2) T.nukes[team] = (T.nukes[team] || 0) + 1;
  voice(team === 0 ? 'nuke' : 'nukeHit', null, { x, y }); cut('nuke', { x, y, R: 2000 }, 88, 5, 'Nuclear detonation');
  push(`Nuclear detonation${team === 0 ? ' (ours)' : team === 1 ? ' (theirs)' : ''}: sensors within 8,000 km are washed out`, 0xffd27a, x, y);
}
function onWrecked(t, b) {
  const ours = b.team === 0; push(`${ours ? 'Our boarders wreck the engines of' : 'Enemy boarders wreck our engines on'} ${t.title || 'the ' + t.def.name}: she is dead in space`, ours ? 0x9be8a8 : 0xff8a7a, t.x, t.y);
  if (ours) voice('wrecked', b); MO.shock(t.team, t.def.cmd ? 5 : 2, `${t.title || 'The ' + t.def.name}: engines wrecked`); cut('wreck', t, 55, 5, `${t.title || t.def.name}: engines wrecked`);
}
function onCapture(t, team, old, how) {
  if (old < 2 && team < 2) cut('cap', t, t.def.cmd ? 90 : 45, 5, `${t.title || 'The ' + t.def.name} ${team === 0 ? 'is ours' : 'is taken'}`);
  if (old < 2 && team < 2 && !t.def.fighter && !t.def.shell && (t.def.cmd || team === 0 || old === 0)) banner(team === 0 ? 'ok' : 'bad', team === 0 ? 'Captured' : 'Lost to boarders', t.title || 'The ' + t.def.name, how === 'mutiny' ? 'Her crew rose and struck the colours' : how === 'whole' ? 'Taken whole, deck by deck: her crew and systems intact' : how === 'prize' ? 'A prize crew holds her' : team === 0 ? 'Our colours fly over her bridge' : 'The enemy holds her bridge');
  if (team === 0 && old === 1) voice('capture', t);
  if (old < 2 && team < 2 && !t.def.static && !t.def.fighter && !t.def.shell) { const big = (t.def.cmd ? 2 : 1) * (how === 'whole' ? 1.5 : 1); MO.shock(old, 6 * big, `${t.title || 'The ' + t.def.name} taken ${how === 'mutiny' ? 'by mutiny' : 'by boarders'}`); MO.shock(team, -3 * big); }
}
// ---------------------------------------------------------------- deck fights: boarding as a fight you can watch, with champions' duels
const champOf = (team, t, boarder) => S.champFor ? S.champFor(team, t, boarder) : null;
function onBoard(b, t, dt) {
  let D = T.decks.get(t.id);
  if (!D) { D = { t, start: S.time, team: b.team, duel: null, done: false }; T.decks.set(t.id, D); if (t.team === 0) voice('boardUs', t); else if (b.team === 0) voice('boardThem', b); if (t.team === 0 || b.team === 0) cut('board', t, t.def.cmd ? 65 : 40, 6, `Boarders on ${t.title || 'the ' + t.def.name}`); if (t.team === 0 || b.team === 0) push(`${b.team === 0 ? 'Our boarders are aboard' : 'Enemy boarders are aboard'} ${t.title || (t.team === 0 ? 'our ' : 'the ') + t.def.name}`, b.team === 0 ? 0x9be8a8 : 0xff8a7a); }
  D.last = S.time; D.boarder = b;
  if (D.duel || D.done || S.time - D.start < 8) return;
  const A = champOf(b.team, t, b), Df = champOf(t.team, t, null);
  if (!A && !Df) { D.done = true; return; }
  D.duel = { A, D: Df, t0: S.time, end: S.time + 6 };
  if (t.team === 0 || b.team === 0) { voice('duel', null, { x: t.x, y: t.y, T: (A || Df).name }); cut('duel', t, 80, 6, A && Df ? `${A.name} duels ${Df.name}` : `${(A || Df).name} on the decks`); }
  if (t.team === 0 || b.team === 0) push(A && Df ? `On the decks of ${t.title || 'the ' + t.def.name}: ${A.name} duels ${Df.name}` : `${(A || Df).name} leads the fight on the decks of ${t.title || 'the ' + t.def.name}`, 0xffd27a);
}
function duelTick() {
  for (const [id, D] of T.decks) {
    if (D.t.dead || D.t.team === D.team || S.time - (D.last || 0) > 3) { if (S.time - (D.last || 0) > 3 || D.t.dead) T.decks.delete(id); continue; }
    const U = D.duel; if (!U || U.res || S.time < U.end) continue;
    const a = U.A ? U.A.skill : 0, d = U.D ? U.D.skill : 0, attWins = Math.random() < (a + .01) / (a + d + .02);
    U.res = attWins ? 'att' : 'def';
    if (attWins) D.t.duelK = U.D ? 2.2 : 1.5; else D.t.duelD = U.A ? 2.2 : 1.5;
    const win = attWins ? U.A : U.D, lose = attWins ? U.D : U.A, ours = (attWins ? D.team : D.t.team) === 0;
    if (lose && lose.die) lose.die();
    MO.shock(attWins ? D.t.team : D.team, lose ? 8 : 4, `${lose ? lose.name : 'A champion'} cut down on the decks`); if (win && lose && (D.t.team === 0 || D.team === 0)) banner(ours ? 'gold' : 'bad', 'The duel on the decks', `${win.name} cuts down ${lose.name}`, `aboard ${D.t.title || 'the ' + D.t.def.name}: the ${attWins ? 'boarders surge' : 'defenders hold'}`); MO.shock(attWins ? D.team : D.t.team, -4);
    if (D.t.team === 0 || D.team === 0) push(win && lose ? `${win.name} cuts down ${lose.name}: the ${attWins ? 'boarders surge' : 'defenders hold the corridors'}` : `${win.name} carries the deck: the ${attWins ? 'boarders surge' : 'defenders rally'}`, ours ? 0x9be8a8 : 0xff8a7a);
  }
}
export const decks = () => [...T.decks.values()].filter(D => !D.t.dead && D.t.team !== D.team && (D.team === 0 || D.t.team === 0));
export function teardown() { S.stepCap = 10; S.pip = null; DIR.cur = null; { const el = typeof document !== 'undefined' && document.getElementById('pip'); if (el) el.classList.remove('show'); } S.hooks = null; S.battleOverlay = null; S.bzone = null; if (T.slowUntil) { S.speed = T.slowPrev; T.slowUntil = 0; } if (T.ff) { S.speed = T.prev; T.ff = false; } S.ffStep = null; speedLabel(); }

// ---------------------------------------------------------------- the clock
const speedLabel = () => { const b = typeof document !== 'undefined' && document.getElementById('bSpd'); if (b) b.textContent = T.ff ? `Closing · ${S.speed}×` : T.slowUntil ? 'Slow time' : 'Speed ' + speedTxt(S.speed); };
export function closest() { // the gap between the nearest armed ships of the two sides
  const a = S.ships.filter(s => s.team === 0 && armedShip(s)), b = S.ships.filter(s => s.team === 1 && armedShip(s));
  let d = 1e18; for (const x of a) for (const y of b) { const e = hyp(x.x - y.x, x.y - y.y); if (e < d) d = e; }
  // platforms count: a world's guns are contact too
  for (const x of a) for (const p of S.ships) if (p.team === 1 && p.def.static && !p.dead && p.weapons.length) { const e = hyp(x.x - p.x, x.y - p.y); if (e < d) d = e; }
  return d;
}
export function tick(dt, paused) {
  T.real += dt;
  // the moment a capital ship dies, the battle slows to watch it go
  if (T.slowUntil && T.real > T.slowUntil) { S.speed = T.slowPrev; T.slowUntil = 0; speedLabel(); }
  T.lastCheck -= dt; if (T.lastCheck > 0) return; T.lastCheck = .25;
  vent(); SNS.tick();
  const d = closest(), contact = d < CONTACT;
  if (!paused && !contact && !T.ff && !T.ffOff && !T.slowUntil && S.speed < FF) { T.prev = S.speed; T.ff = true; }
  if (T.ff) { const r = ffRate(d); if (S.speed !== r) { S.speed = r; speedLabel(); } S.ffStep = d > CONTACT + 1500 && !gunsTalking() ? (d > 60000 ? FF_STEP * 1.5 : FF_STEP) : null; } else S.ffStep = null;
  // nobody closing: the approach would run forever at any speed; say so once, and show it in the clock
  if (!contact && !paused) { if (T.stallG == null || d < T.stallG - 400) { T.stallG = d; T.stallT = S.time; T.stall = false; } else if (S.time - T.stallT > 20) T.stall = true; } else T.stall = false;
  if (T.ff && T.manual) { if (d < 8000 || gunsTalking()) { S.speed = T.prev; T.ff = false; T.manual = false; S.ffStep = null; speedLabel(); push('Closing speed off: the guns are talking', 0xffd27a); } }
  else if (contact && T.ff) { S.speed = T.prev; T.ff = false; S.ffStep = null; speedLabel(); push('Contact: the fleets are within range', 0xffd27a); }
  if (contact) T.ffOff = false;
  if (contact && !T.saidContact) { T.saidContact = S.time; voice('contact', null, { N: SNS.counts().seen + SNS.counts().contacts || 'several' }); }
  if (T.saidContact && !T.saidIcpt && S.time - T.saidContact > 5) { T.saidIcpt = true; voice('contact', null, { enemy: true }); }
  if (!T.saidPicket && SNS.SN.contacts[0].length) { const pk = S.ships.find(s => s.team === 0 && s.picket && !s.dead); if (pk) { T.saidPicket = true; voice('picket', pk, { N: SNS.SN.contacts[0].length }); } }
  if (S.env && S.env.sun && T.saidContact && !T.saidGlare && S.time - T.saidContact > 12) { T.saidGlare = true; voice('glare', null); }
  for (const s of S.ships) if (s.team === 0 && !s.dead && !s.def.static && !s.def.fighter && !s.def.shell && s.hp < s.def.hp * .33 && !T.hullTold.has(s.id) && s.def.hp >= 600) { T.hullTold.add(s.id); voice('hull', s); break; }
  T.contact = contact; T.gap = d; if (contact) T.engaged = true; duelTick();
  if (S.bzone) { const b = bodyOf(S.bzone.world); S.bzone.x = b.x; S.bzone.y = b.y; }
  const now = S.time; T.rip = T.rip.filter(r => now - r.t < .45 && !r.s.dead); T.bombs = T.bombs.filter(b => now - b.t < 1.6); T.feed = T.feed.filter(e => now - e.t < 14); T.callouts = T.callouts.filter(e => now - e.t < (e.long ? 4 : 2.2)); T.hits = T.hits.filter(e => now - e.t < .5); T.beams = T.beams.filter(e => now - e.t < .45);
}
// closing speed on demand: twelve times, while nobody is in reach; it drops back the moment the guns talk
const gunsTalking = () => S.ships.some(s => s.team < 2 && !s.dead && !s.def.static && !s.def.fighter && S.time - (s.lastFire ?? -99) < 1.5);
// the rate: twelve times inside 30,000 km, faster across the long gaps, so a 100,000 km approach takes seconds, not minutes
const FF_STEP = 1 / 15;         // beyond missile reach the sim takes big steps: nothing that needs a fine one is happening
const ffRate = d => d > 60000 ? 48 : d > 30000 ? 24 : FF;
export function closing() {
  if (T.ff) { ffStop(); if (!T.contact) T.ffOff = true; return null; }
  const d = closest();
  if (d < 8000) return 'Too close for closing speed: the enemy is inside 8,000 km';
  if (gunsTalking()) return 'Not while the guns are firing';
  T.prev = S.speed; T.ff = true; T.manual = !!T.contact; T.ffOff = false; S.speed = ffRate(d); speedLabel(); return null;
}
// the speed button or a key took the clock back: closing speed ends and stays off until contact
export function ffStop() { if (!T.ff) return false; S.speed = T.prev; T.ff = false; T.manual = false; S.ffStep = null; if (!T.contact) T.ffOff = true; speedLabel(); return true; }
// every group and loose warship of ours: attack-move on the enemy's centre
export function advance() {
  const foes = S.ships.filter(s => s.team === 1 && !s.dead && (armedShip(s) || (s.def.static && s.weapons.length)));
  if (!foes.length) return false;
  const mob = foes.filter(s => !s.def.static), use = mob.length ? mob : foes;
  const cx = use.reduce((a, s) => a + s.x, 0) / use.length, cy = use.reduce((a, s) => a + s.y, 0) / use.length;
  for (const g of groupList()) if (g.members.some(m => m.team === 0)) groupOrder(g, 'amove', cx, cy);
  for (const s of S.ships) if (s.team === 0 && !s.ally && armedShip(s) && (!s.group || s.detached)) s.order = { type: 'amove', x: cx, y: cy };
  push('All ships: advance to contact', 0x9be8a8); return true;
}

// ---------------------------------------------------------------- the Iron Rain, seen: each pod a burning streak down to the world
export function rainFx(pods, world) {
  const b = bodyOf(world); if (pods[0]) cut('rain', { x: pods[0].x, y: pods[0].y, R: 2600 }, 95, 9, 'The Iron Rain');
  for (const s of pods) { const a = Math.atan2(s.y - b.y, s.x - b.x) + (Math.random() - .5) * .5;
    T.rain.push({ world, x0: s.x - b.x, y0: s.y - b.y, a, t0: S.time + Math.random() * 1.2, dur: 7 + Math.random() * 5, done: false }); }
}
function drawRain(g, px) {
  if (!T.rain.length) return;
  g.ground();
  for (const r of T.rain) {
    const b = bodyOf(r.world), k = (S.time - r.t0) / r.dur; if (k < 0) continue;
    const ex = Math.cos(r.a) * b.r * .985, ey = Math.sin(r.a) * b.r * .985, e = Math.min(1, k) ** 1.4;
    const x = b.x + r.x0 + (ex - r.x0) * e, y = b.y + r.y0 + (ey - r.y0) * e, back = Math.max(0, e - .08);
    const tx = b.x + r.x0 + (ex - r.x0) * Math.max(0, e - .12), ty = b.y + r.y0 + (ey - r.y0) * back, hot = Math.min(1, e * 1.4);
    if (k < 1) {
      g.moveTo(tx, ty).lineTo(x, y).stroke({ width: (3.5 + 5 * hot) * px, color: 0xff6a2a, alpha: .4 + .35 * hot });
      g.moveTo(tx + (x - tx) * .6, ty + (y - ty) * .6).lineTo(x, y).stroke({ width: (1.2 + 2 * hot) * px, color: 0xfff0d0, alpha: .9 });
      g.circle(x, y, (9 + 14 * hot) * px).fill({ color: 0xffb070, alpha: .3 + .25 * hot });
    } else if (!r.done) { r.done = true; r.land = S.time; }
    if (r.done && S.time - r.land < 1.5) { const q = (S.time - r.land) / 1.5; g.circle(b.x + ex, b.y + ey, (10 + 60 * q) * px).stroke({ width: 2 * px, color: 0xffd2a0, alpha: 1 - q }); }
  }
  T.rain = T.rain.filter(r => !r.done || S.time - r.land < 1.5);
}
// ---------------------------------------------------------------- the feed
const nameOf = s => s ? (s.title ? s.title : (s.team === 0 ? '' : 'enemy ') + s.def.name) : 'the battle';
export const note = (text, col) => push(text, col);
// every battle event goes to the one log, the Dispatches; the colour says whose news it is
const clsOf = col => col === 0x9be8a8 ? 'good' : (col === 0xff8a7a || col === 0xff6a5a) ? 'bad' : col === 0xffd27a || col === 0xffc26a ? 'gold' : '';
function push(text, col, x, y) { T.feed.unshift({ t: S.time, text, col, x, y }); if (T.feed.length > 7) T.feed.pop(); logLine(text, clsOf(col), x != null ? { x, y } : null); }
// who gets the credit: a fighter's kills are its carrier's
const credit = src => src && src.def ? (src.def.fighter && src.carrier ? src.carrier : src) : null;
function onKill(s, byTeam, src) {
  if (s.def.static && !s.weapons.length) return;
  if (!s.def.fighter && !s.def.shell) T.kills.push({ t: S.time, team: s.team, name: s.title || s.def.name, cls: s.def.name, v: s.def.value || 50, cap: !!s.def.cmd });
  MO.onKill(s);
  const c = credit(src); if (c && c.team !== s.team && c.team < 2) { c.kills = (c.kills || 0) + 1; c.killV = (c.killV || 0) + (s.def.value || 50); c.killed = (c.killed || []).concat(s.title || s.def.name).slice(-6); }
  if (s.def.fighter || s.def.shell) return;
  // a capital ship dies: a moment of slow time, and its name over the wreck
  if (s.def.cmd && s.def.hp >= 2000 && s.team < 2) {
    T.callouts.push({ t: S.time, x: s.x, y: s.y, text: `${(s.title || s.def.name).toUpperCase()} IS GONE`, col: s.team === 0 ? 0xff8a7a : 0xffd27a, long: true });
    if (!T.ff && !T.slowUntil && T.real - T.lastSlow > 8 && S.speed >= 1) { T.slowPrev = S.speed; S.speed = .3; T.slowUntil = T.real + 1.6; T.lastSlow = T.real; speedLabel(); }
  }
  const ours = s.team === 0, who = src && src.def ? nameOf(src) : byTeam === 0 ? 'our fire' : byTeam === 1 ? 'enemy fire' : 'a collision';
  const flag = !!(s.cmdr || (s.group && s.group.flag === s && s.group.members.length > 1));
  if (s.team < 2) cut('kill', s.def.cmd || !c ? s : c, s.def.cmd && s.def.hp >= 2000 ? 100 : s.def.cmd ? 60 : 25, s.def.cmd ? 7 : 4, s.def.cmd || !c ? `${s.title || (ours ? 'Our ' : 'Enemy ') + s.def.name} destroyed` : `${c.title || c.def.name} kills ${s.title || (ours ? 'our ' : 'the enemy ') + s.def.name}`);
  if (s.cmdr && s.team < 2) banner(ours ? 'bad' : 'gold', ours ? 'Flagship lost' : 'Their flagship is down', s.title || 'The ' + s.def.name, `${s.cmdr.name}’s flagship · ${ours ? 'our' : 'their'} line is shaken`);
  if (ours) voice(flag ? 'flagLost' : 'lost', CO.nearestOurs(s.x, s.y, s), { T: s.title || s.def.name });
  else if (s.team === 1) { if (c && c.team === 0 && (s.def.cmd || Math.random() < .45)) voice('kill', c, { T: s.title || s.def.name }); if (flag) voice('lost', null, { enemy: true }); }
  push(`${who.charAt(0).toUpperCase() + who.slice(1)} destroyed ${s.title ? s.title : (ours ? 'our ' : 'the enemy ') + s.def.name}`, ours ? 0xff8a7a : 0x9be8a8, s.x, s.y);
}
function onShDown(s, team, src) {
  if (s.def.fighter || s.def.shell || (s.vis && !s.vis[0] && s.team !== 0)) return;
  const near = T.callouts.find(c => c.kind === 'sh' && c.team === s.team && S.time - c.t < 1.6 && Math.hypot((c.s || c).x - s.x, (c.s || c).y - s.y) < 900);
  if (near) { near.n = (near.n || 1) + 1; near.text = `SHIELDS DOWN ×${near.n}`; near.t = S.time; return; }
  T.callouts.push({ t: S.time, x: s.x, y: s.y, s, kind: 'sh', team: s.team, text: 'SHIELDS DOWN', col: s.team === 0 ? 0xff8a7a : 0x8fd3ff });
  if (s.def.cmd) cut('sh', s, 40, 4, `${s.title || s.def.name}: shields down`);
  if (s.team === 0 && (s.def.hp || 0) >= 600) voice('shDown', s);
}
function onBeam(s, x, y, a, D) { if (s.team !== 0 && s.vis && !s.vis[0]) return; cut('lance', s, D.huge ? 70 : 45, 4, `${s.title || s.def.name} fires her ${D.huge ? 'great lance' : 'lance'}`); T.beams.push({ t: S.time, x, y, a, L: D.range, w: D.huge ? 7 : 4, col: D.col || 0xff6a3d }); }
// a hurt ship vents: atmosphere, fire and coolant, more of it the worse she is hit
function vent() {
  for (const s of S.ships) {
    if (s.dead || s.def.static || s.def.fighter || s.def.shell || s.offField || s.hp > s.def.hp * .45 || (s.vis && !s.vis[0] && s.team !== 0)) continue;
    const k = 1 - s.hp / (s.def.hp * .45), n = Math.ceil(k * 3 * Math.min(3, s.r / 30));
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * s.r * .7, fire = Math.random() < .35 + .3 * k;
      S.parts.push({ x: s.x + Math.cos(a) * rr, y: s.y + Math.sin(a) * rr, vx: s.vx + Math.cos(a) * (20 + Math.random() * 60), vy: s.vy + Math.sin(a) * (20 + Math.random() * 60), life: .6 + Math.random() * .8, max: 1.4, size: 2 + Math.random() * (s.r / 18), col: fire ? 0xff9a4a : 0x9aa4b0, drag: 1.2 }); }
  }
}
// the after-action report's ledger: what each side's fire did, by the kind of weapon, to shields and to hulls
const KIND = { slug: 'Rail and battery', lance: 'Lances', bullet: 'Autocannon', flak: 'Point defence', missile: 'Missiles', nuke: 'Nuclear', blast: 'Blast and mines', ram: 'Collisions' };
export const kindName = k => KIND[k] || k;
function ledger(team, kind, amt, hull) { if (team !== 0 && team !== 1 || !(amt > 0)) return; const L = T.dmg[team], e = L[kind] || (L[kind] = { sh: 0, hull: 0 }); if (hull) e.hull += amt; else e.sh += amt; }
function onAbsorb(s, amt, team, src, kind) { if (s.team !== team) ledger(team, kind || 'slug', amt, false); }
function onHalfDown(s, side, team, src) {
  if (s.def.fighter || s.def.shell || (s.vis && !s.vis[0] && s.team !== 0) || !s.def.cmd) return;
  T.callouts.push({ t: S.time, x: s.x, y: s.y, s, kind: 'half', team: s.team, text: (side > 0 ? 'STARBOARD' : 'PORT') + ' SHIELD DOWN', col: s.team === 0 ? 0xff9a7a : 0x8fd3ff });
}
function onHit(s, amt, team, src, kind) {
  heat(s, Math.min(8, amt / 60));
  if (s.team !== team) ledger(team, kind || 'slug', Math.min(amt, Math.max(0, s.hp + amt)), true);
  const c = credit(src); if (c && c.team !== s.team) c.dmg = (c.dmg || 0) + Math.max(0, Math.min(amt, s.hp + amt)); // what the hull actually took
  if (!src || src.team !== 0 || s.team === 0 || s.def.fighter || s.def.shell) return;
  if (s.lastMark && S.time - s.lastMark < .18) return; s.lastMark = S.time;
  T.hits.push({ t: S.time, x: s.x + (Math.random() - .5) * s.r, y: s.y + (Math.random() - .5) * s.r, big: amt > 200 });
}

// ---------------------------------------------------------------- drawing (called from render.drawOverlay)
const mainRange = s => s.weapons.reduce((a, w) => w.def.nuke || w.def.pd ? a : Math.max(a, w.def.eff || w.def.range), 0); /* the effective range: where the guns land */
const longRange = s => s.weapons.reduce((a, w) => w.def.nuke || w.def.pd ? a : Math.max(a, w.def.range), 0); /* their full reach, wild */
const batteryRange = s => s.weapons.reduce((a, w) => w.def.battery ? Math.max(a, w.def.eff || w.def.range) : a, 0);
function draw(g, label, z, px) {
  // the battle zone: past it, a fleet has left the field
  const Z = S.bzone;
  if (Z) { const b = bodyOf(Z.world); g.ground(); g.dashed(b.x, b.y, Z.r, 900, 700); g.stroke({ width: 1.4 * px, color: 0xc8b890, alpha: .22 }); }
  TRN.draw(g, label, z, px); SNS.draw(g, label, z, px); drawRain(g, px); if (S.opsDraw) S.opsDraw(g, label, z, px);
  if (T.rip.length) { g.ground(); for (const r of T.rip) { const k = 1 - (S.time - r.t) / .45, s = r.s, R = Math.max(s.def.vr0 && !s.def.static ? s.def.vr0 * (S.hullX || 30) / 30 * 1.12 : s.r * 1.1, 9 * px) * (1 + (1 - k) * .12), w = r.big ? .95 : .6;
    g.moveTo(s.x + Math.cos(r.a - w) * R, s.y + Math.sin(r.a - w) * R); g.arc(s.x, s.y, R, r.a - w, r.a + w); g.stroke({ width: (r.big ? 3 : 1.8) * px, color: 0x9fdcff, alpha: .85 * k });
    g.moveTo(s.x + Math.cos(r.a - w * .6) * R * 1.07, s.y + Math.sin(r.a - w * .6) * R * 1.07); g.arc(s.x, s.y, R * 1.07, r.a - w * .6, r.a + w * .6); g.stroke({ width: 1.2 * px, color: 0xe8f6ff, alpha: .45 * k }); } }
  if (T.bombs.length) { g.ground(); for (const f of T.bombs) { const q = (S.time - f.t) / 1.6; if (q < 0) continue; const x = f.b.x + f.x0, y = f.b.y + f.y0; g.circle(x, y, (6 + 30 * q) * px).fill({ color: 0xffa050, alpha: .5 * (1 - q) }); g.circle(x, y, (3 + 8 * q) * px).fill({ color: 0xfff0c0, alpha: .8 * (1 - q) }); } }
  if (T.tac) drawTac(g, label, z, px);
  // the ship you have selected, as Battlefleet Gothic shows her: her shield halves as arcs (bright when strong,
  // red when down) and, off the tactical overlay, her broadside arcs out to effective range
  { const L = S.selection.filter(o => o.team === 0 && !o.dead && !o.def.static && !o.def.fighter);
    for (const o of L.length <= 3 ? L : []) {
      g.ground();
      if (o.def.shield && o.sub) { const mx = shMax(o) / 2 || 1, Rr = Math.max(o.r * 2.3, 34 * px);
        for (const [side, v] of [[1, o.shS || 0], [-1, o.shP || 0]]) { const f = Math.max(0, Math.min(1, v / mx)), a0 = o.a + side * .18, a1 = o.a + side * (Math.PI - .18), lo = Math.min(a0, a1), hi = Math.max(a0, a1);
          g.moveTo(o.x + Math.cos(lo) * Rr, o.y + Math.sin(lo) * Rr); g.arc(o.x, o.y, Rr, lo, hi); g.stroke({ width: 3 * px, color: f <= .02 ? 0xff4b3e : f < .35 ? 0xff9a3c : 0x5ab8ff, alpha: f <= .02 ? .75 : .35 + .5 * f }); } }
      if (!T.tac && o.def.broadside && L.length === 1) { const BR = batteryRange(o) || mainRange(o), bw = o.weapons.find(w => w.def.battery), half = bw ? bw.def.arc : .87;
        for (const side of [1, -1]) { const a0 = o.a + side * Math.PI / 2 - half, a1 = o.a + side * Math.PI / 2 + half;
          g.moveTo(o.x, o.y); g.arc(o.x, o.y, BR, a0, a1); g.lineTo(o.x, o.y); g.fill({ color: 0x3ddc84, alpha: .035 }); g.moveTo(o.x + Math.cos(a0) * BR, o.y + Math.sin(a0) * BR); g.arc(o.x, o.y, BR, a0, a1); g.stroke({ width: 1.1 * px, color: 0x3ddc84, alpha: .3 }); } }
    } }
  // Alt held over an enemy warship: her stern arc, where the engines are and the plate is not
  { const h = S.altDown && S.hover; if (h && !h.dead && h.team !== 0 && h.sub && !h.def.static) { const R = Math.max(h.r * 6, 2600), a0 = h.a + Math.PI - .84, a1 = h.a + Math.PI + .84; g.ground();
    const P = [h.x, h.y]; for (let i = 0; i <= 16; i++) { const a = a0 + (a1 - a0) * i / 16; P.push(h.x + Math.cos(a) * R, h.y + Math.sin(a) * R); } g.poly(P).fill({ color: 0x3ddc84, alpha: .1 }).stroke({ width: 1.2 * px, color: 0x3ddc84, alpha: .5 });
    projectTo(Q, h.x + Math.cos(h.a + Math.PI) * R * .7, h.y + Math.sin(h.a + Math.PI) * R * .7); if (Q.ok) label('Stern: no plate, double harm', Q.x, Q.y, 0x9be8a8, false, true); } }
  // lance and siege fire: a bright line down the bore, gone in half a second
  g.ground();
  for (const e of T.beams) { const k = 1 - (S.time - e.t) / .45; if (k <= 0) continue; const ex = e.x + Math.cos(e.a) * e.L, ey = e.y + Math.sin(e.a) * e.L;
    g.moveTo(e.x, e.y).lineTo(ex, ey).stroke({ width: e.w * 2.4 * px, color: e.col, alpha: .18 * k }); g.moveTo(e.x, e.y).lineTo(ex, ey).stroke({ width: e.w * .6 * px, color: 0xfff2dc, alpha: .85 * k }); }
  // hit marks: a small cross where our fire lands
  g.screen();
  for (const h of T.hits) { projectTo(Q, h.x, h.y); if (!Q.ok) continue; const k = 1 - (S.time - h.t) / .5, r = (h.big ? 6 : 4) * (1 + (1 - k) * .6);
    g.moveTo(Q.x - r, Q.y - r).lineTo(Q.x + r, Q.y + r).moveTo(Q.x + r, Q.y - r).lineTo(Q.x - r, Q.y + r).stroke({ width: h.big ? 2 : 1.4, color: 0xffe0a0, alpha: k }); }
  // callouts float up over the ship they belong to
  for (const c of T.callouts) { const s = c.s && !c.s.dead ? c.s : c; projectTo(Q, s.x, s.y); if (!Q.ok) continue; const k = (S.time - c.t) / 2.2; label(c.text, Q.x, Q.y - 26 - k * 22, c.col, false, true); }
}
function drawTac(g, label, z, px) {
  const sel = S.selection.filter(s => !s.dead && !s.def.static), flags = groupList().map(g => g.flag).filter(f => f && !f.dead && !f.offField && f.team === 0);
  const mine = sel.length ? sel.slice(0, 12) : flags.length ? flags : S.ships.filter(s => s.team === 0 && armedShip(s) && s.def.cmd).slice(0, 6);
  g.ground();
  // a group draws one envelope (the reach of every gun in it) and its flagship's arcs; a lone ship its own ring and arcs
  const byG = new Map(); for (const s of mine) { const k = s.group && !s.detached ? s.group : s; if (!byG.has(k)) byG.set(k, []); byG.get(k).push(s); }
  const arcs = [];
  for (const [k, L] of byG) {
    if (L.length === 1) { const s = L[0], R = mainRange(s), LR = longRange(s); if (R) g.circle(s.x, s.y, R).stroke({ width: 1.1 * px, color: 0x3ddc84, alpha: .22 }); if (LR > R * 1.1) { g.dashed(s.x, s.y, LR, 260, 220); g.stroke({ width: 1 * px, color: 0x3ddc84, alpha: .12 }); } arcs.push(s); continue; }
    const cx = L.reduce((a, s) => a + s.x, 0) / L.length, cy = L.reduce((a, s) => a + s.y, 0) / L.length;
    const R = Math.max(...L.map(s => Math.hypot(s.x - cx, s.y - cy) + mainRange(s)));
    g.circle(cx, cy, R).fill({ color: 0x3ddc84, alpha: .03 }); g.dashed(cx, cy, R, R * .06, R * .04); g.stroke({ width: 1.4 * px, color: 0x3ddc84, alpha: .4 });
    const f = k.flag && !k.flag.dead && L.includes(k.flag) ? k.flag : L.slice().sort((a, b) => (b.def.value || 0) - (a.def.value || 0))[0]; arcs.push(f);
  }
  for (const s of arcs) {
    if (s.def.broadside) { const BR = batteryRange(s) || mainRange(s), bw = s.weapons.find(w => w.def.battery), half = bw ? bw.def.arc : .87; /* the batteries' true firing arc off each beam */ for (const side of [1, -1]) { const a0 = s.a + side * Math.PI / 2 - half, a1 = s.a + side * Math.PI / 2 + half;
      g.moveTo(s.x, s.y); g.arc(s.x, s.y, BR, a0, a1); g.lineTo(s.x, s.y); g.fill({ color: 0x3ddc84, alpha: .06 }); g.moveTo(s.x + Math.cos(a0) * BR, s.y + Math.sin(a0) * BR); g.arc(s.x, s.y, BR, a0, a1); g.stroke({ width: 1.4 * px, color: 0x3ddc84, alpha: .45 }); } }
  }
  // enemy reach, for the capital ships we can see
  for (const s of S.ships) if (s.team === 1 && armedShip(s) && (s.def.cmd || s.def.static) && (!s.vis || s.vis[0])) { const R = mainRange(s); if (R) g.circle(s.x, s.y, R).stroke({ width: 1 * px, color: 0xff6a5a, alpha: .16 }); }
  // who is shooting whom: each firing ship to its main gun's target
  for (const s of S.ships) {
    if (s.dead || s.def.fighter || s.def.shell || S.time - (s.lastFire ?? -99) > 2.5 || (s.team !== 0 && s.vis && !s.vis[0])) continue;
    const w = s.weapons.find(x => x.target && !x.def.pd && x.target.def); if (!w) continue; const t = w.target;
    g.moveTo(s.x, s.y).lineTo(t.x, t.y).stroke({ width: (s.def.cmd ? 1.4 : .8) * px, color: s.team === 0 ? 0x7ff3a0 : 0xff6a5a, alpha: s.def.cmd ? .5 : .25 });
  }
  // each of our groups: a line to what its flagship is set on
  for (const gr of groupList()) { const f = gr.flag; if (!f || f.dead || f.offField || f.team !== 0) continue; const o = f.order; const t = o && (o.t || (o.x != null ? o : null)); if (!t) continue;
    g.moveTo(f.x, f.y).lineTo(t.x, t.y).stroke({ width: 2 * px, color: 0xe8c87e, alpha: .35 }); }
}
// the feed panel, a DOM list under the group panel
export function feedHTML() {
  return T.feed.map(e => { const a = clamp(1 - (S.time - e.t - 9) / 5, 0, 1); return `<div class="kf" style="opacity:${a.toFixed(2)};color:#${e.col.toString(16).padStart(6, '0')}">${e.text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`; }).join('');
}
// is the battle won bar the dice? the enemy's armed strength under a quarter of ours
const str = t => S.ships.reduce((a, s) => a + (s.team === t && armedShip(s) ? (s.def.value || 50) * s.hp / s.def.hp : 0), 0);
export function broken() {
  if (!T.engaged) return false;
  const a = str(0), b = str(1); return a > 0 && b < a * .25 && b < (T.foe0 || 1) * .6;
}
