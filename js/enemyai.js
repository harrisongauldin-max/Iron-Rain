// The enemy fleet's mind in a campaign battle, once a second. It reads the doctrine of the commander who leads it
// (morale.js): it picks the targets worth killing and puts its guns on them together, sends a fast wing round
// the flank while the line closes, keeps its capital ships behind a screen of escorts, and pulls its cripples back
// behind the line. A defending fleet holds near its world until the attackers come within reach.
import { S } from './state.js';
import { bodyOf } from './solar.js';
import { nukesOf, launchNuke, disabled, brace, threatSide, goCold, warmUp, bigHull } from './sim.js';
import { lockOf } from './data.js';
import * as AB from './abilities.js';
import { M, doc, DOC, rout } from './morale.js';
import { known } from './sensors.js';
import { TR } from './terrain.js';
import { OP, bombCan, bombStart } from './ops.js';

const hyp = Math.hypot;
const live = s => s && !s.dead && !s.offField && !s.surrendered && !s.derelict;
const warship = s => live(s) && !s.def.static && !s.def.fighter && !s.def.shell && s.weapons.length && s.type !== 'hauler';
const cen = L => L.length ? { x: L.reduce((a, s) => a + s.x, 0) / L.length, y: L.reduce((a, s) => a + s.y, 0) / L.length } : null;
let P = null;
export function reset(ctx) { P = { ctx, side: Math.random() < .5 ? 1 : -1, focus: [], ft: 0, wings: false, flanked: false, dark: false }; }
export const plan = () => P;

// what is worth killing: big, hurt, shields down, a commander aboard, and near
function pickFocus(foes, mc) {
  return foes.filter(f => !f.def.fighter && !f.def.shell && !f.broken).map(f => {
    const hp = f.hp / f.def.hp, v = (f.def.value || 50) * (1 + 1.5 * (1 - hp)) * (f.sh < (f.def.shield || 1) * .25 ? 1.4 : 1) * (f.cmdr ? (doc().hunt ? 2.2 : 1.6) : 1);
    return [f, v / (1 + hyp(f.x - mc.x, f.y - mc.y) / 5000)];
  }).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
}
const reach = s => s.weapons.reduce((a, w) => w.def.nuke || w.def.pd ? a : Math.max(a, w.def.eff || w.def.range), 400);
const nearestOf = (s, L) => { let t = null, td = 1e18; for (const f of L) { const d = hyp(f.x - s.x, f.y - s.y); if (d < td) { td = d; t = f; } } return [t, td]; };

// a cunning or patient defender lays an ambush: part of the fleet goes quiet in the rock fields on the attackers' side
function layAmbush(mine, D, b) {
  P.lay = true; if (!(D.dark || D.patient) || !TR.fields.length) return;
  const cand = mine.filter(s => warship(s) && !s.def.cmd).slice(0, Math.ceil(mine.length * .4));
  for (const s of cand) { const f = TR.fields.slice().sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; if (!f || hyp(f.x - b.x, f.y - b.y) > b.r + 9000) continue;
    s.lying = { f, ox: (Math.random() - .5) * f.r * .6, oy: (Math.random() - .5) * f.r * .6 }; s.order = { type: 'move', x: f.x + s.lying.ox, y: f.y + s.lying.oy }; s.coldAt = true; }
}
// ================================================================ the battle brain
// Once a second the enemy commander reads the field as a whole: how strong each side is, how far each side's guns
// reach, where the world's guns are. From that it picks a posture for the fleet and holds it long enough to mean it:
//   hold      - a defender keeps station under the world's guns and shield, line toward the enemy, and fights from there
//   shelter   - out-ranged and out-gunned under the guns: drop behind the world, out of their sight, and wait
//   advance   - close as one line at the pace of the slowest ship
//   form      - nearly in reach and strung out: the leaders wait for the rest
//   standoff  - our guns out-reach theirs: hold them at the edge of our reach, backing off as they come on
//   rush      - their guns out-reach ours: the whole line burns in together, no stopping in their killing ground
//   engage    - an even fight at our ships' own fighting range
//   fallback  - losing, still in hand: pull back toward the world (or away down our own line), guns still firing
// Ships then take targets by allocation, not by nearest: what is worth killing and can be killed, cripples first, no
// five ships on a hulk that is dying anyway, and each doctrine with a taste of its own.
const live2 = s => live(s) && !s.broken;
const gunOf = w => !w.def.pd && !w.def.nuke && w.ammo > 0;
const dpsOf = s => s.weapons.reduce((a, w) => gunOf(w) ? a + (w.def.dmg || 0) * (w.def.salvo || 1) / Math.max(.1, w.def.reload || 1) : a, 0) * (s.hf ?? 1);
const effOf = s => s.weapons.reduce((a, w) => gunOf(w) ? Math.max(a, w.def.eff || w.def.range) : a, 0);
const ehp = f => f.hp != null ? f.hp + (f.sh || 0) : (f.def.hp || 500) + (f.def.shield || 0);
const valOf = f => (f.def.value || 50) * (f.hp != null ? Math.max(.2, f.hp / f.def.hp) : 1);
// the counters, as the guns see them: armour takes its toll of every slug and round (sim.js damage: the plate's rating
// off each hit, never below 15% of it), while lances, missiles and torpedoes go through it, and torpedoes are fired only
// at big hulls. A corvette's light railguns barely mark a dreadnought's plate; her torpedo is what she is for. From
// astern there is no plate at all, and the round does double harm.
const plateK = (D, f, stern) => D.kind === 'missile' || D.big || stern ? 1 : Math.max(.15, 1 - (f.def.armor || 0) / Math.max(1, D.dmg || 1));
const gunDps = w => (w.def.dmg || 0) * (w.def.salvo || 1) * (w.guns || 1) / Math.max(.1, w.def.reload || 1);
function dpsVs(s, f, stern) {
  let v = 0; for (const w of s.weapons) { if (!gunOf(w) || w.def.emp) continue; if (w.def.breach && !bigHull(f)) continue; v += gunDps(w) * plateK(w.def, f, stern) * (stern && w.def.kind !== 'missile' ? 2 : 1); }
  return v * (s.hf ?? 1);
}
const dpsAll = s => s.weapons.reduce((a, w) => gunOf(w) && !w.def.emp && !w.def.breach ? a + gunDps(w) : a, 0) * (s.hf ?? 1) || 1;
// a ship alone is a ship to kill: the fewer of her friends close enough to cover her, the better the target
const coverOf = (f, L) => { let n = 0; for (const o of L) if (o !== f && !o.def.fighter && !o.def.shell && hyp(o.x - f.x, o.y - f.y) < 3200) n++; return n; };
// the weaker half of a target's shield, when one is down or nearly: +1 starboard, -1 port, 0 if neither
const softSide = f => { if (!f.sub || !(f.def.shield > 0) || f.shP == null) return 0; const cap = f.def.shield * .5, p = f.shP / cap, q = f.shS / cap; if (Math.min(p, q) > .25 || Math.abs(p - q) < .3) return 0; return p < q ? -1 : 1; };
// stern runners: fast escorts that can get round a slow capital ship's broadsides while others hold her attention
const sternRunner = s => !s.def.cmd || s.type === 'raider' ? (s.def.cruise >= 330 && s.def.turn >= 1.4) : false;
const sternWorthy = f => (f.def.broadside || bigHull(f)) && f.def.turn < 1 && !f.def.static;
// where a side's firepower lands: the reach that half its damage comes from, or further
function reachOf(L) {
  const W = []; for (const s of L) if (s.weapons) for (const w of s.weapons) if (gunOf(w)) W.push([w.def.eff || w.def.range, (w.def.dmg || 0) * (w.def.salvo || 1) / Math.max(.1, w.def.reload || 1)]);
  if (!W.length) return 0; W.sort((a, b) => b[0] - a[0]); const tot = W.reduce((a, w) => a + w[1], 0); let acc = 0;
  for (const [r, d] of W) { acc += d; if (acc >= tot * .5) return r; } return W[W.length - 1][0];
}
const POST_HOLD = { hold: 4, shelter: 10, advance: 4, form: 3, standoff: 6, rush: 8, engage: 5, fallback: 12 };
function setPost(p, why) { if (P.post === p) return; if (P.post && S.time - P.postT < (POST_HOLD[P.post] || 4) && !why) return; P.post = p; P.postT = S.time; P.why = why || ''; }
const lastHitBy = s => S.time - Math.max(s.shHit ?? -99, s.lastHit ?? -99);
function readField(mine, mw, foes, seen, b, defending, D, diff) {
  const mc = cen(mw.length ? mw : mine), fw = seen.filter(f => !f.def.fighter && !f.def.shell), fc = cen(foes.filter(f => !f.def.fighter && !f.def.shell)) || cen(foes);
  let ux = fc.x - mc.x, uy = fc.y - mc.y; const gap = hyp(ux, uy) || 1; ux /= gap; uy /= gap;
  const plats = S.ships.filter(s => s.team === 1 && live(s) && s.def.static && s.weapons.length);
  const ours = mw.reduce((a, s) => a + valOf(s), 0) + (defending ? plats.reduce((a, s) => a + 260 * s.hp / s.def.hp, 0) : 0);
  const theirs = foes.filter(f => !f.def.fighter && !f.def.shell).reduce((a, f) => a + valOf(f), 0) || 1, ratio = ours / theirs;
  const R1 = reachOf(mw) || 3000, R0 = reachOf(fw) || 4500, adv = R1 - R0;
  // the closest the enemy is to any of our warships, and whether we are being hit from beyond our own reach
  let close = 1e18; for (const s of mw) for (const f of fw) { const d = hyp(f.x - s.x, f.y - s.y); if (d < close) close = d; }
  const hurt = mw.filter(s => lastHitBy(s) < 3).length, answering = mw.filter(s => S.time - (s.lastFire ?? -99) < 3).length;
  const outgunned = hurt >= Math.max(1, mw.length * .3) && answering < hurt * .5 && close > R1 * 1.05;
  const A = { mc, fc, ux, uy, gap, ratio, R1, R0, adv, close, outgunned, plats };
  const reckless = M.doc === 'reckless', sally = D.sally, orderly = D.pull > 0;
  // beaten but in hand: pull back to fight again under the guns, or down our own line, before the crews break
  // (once a battle: a fleet that has fallen back and been caught again fights it out, or breaks)
  if (orderly && diff > 0 && !P.fellBack && P.post !== 'fallback' && ratio < (D.patient ? .55 : .45) && close < R0 * 1.3 && mw.length >= 2) {
    setPost('fallback', 'losing'); P.fellBack = true; P.fb = defending ? null : { x: mc.x - ux * 12000, y: mc.y - uy * 12000 }; return A; }
  if (P.post === 'fallback') { if (ratio > .8 || close < R1 * .7 || S.time - P.postT > 45) {
      // an attacker that fell back and is still badly outmatched does not go in again to die: it breaks off the attack
      // and takes what is left home, and the enemy must run it down for the prizes
      if (!defending && diff > 0 && ratio < .5 && !M.rout[1]) { rout(1, `${M.lead ? M.lead.name : 'The enemy commander'} sees the day is lost and breaks off the attack. Run them down before they clear the field`); return A; }
      setPost(close < R1 * 1.2 ? 'engage' : defending ? 'hold' : 'advance', 'turned'); } else return A; }
  if (defending) {
    const nearW = fw.filter(f => hyp(f.x - b.x, f.y - b.y) < b.r + 16000).length;
    if (diff <= 0) { setPost(nearW ? 'engage' : 'hold'); return A; } // Easy: a garrison that comes out to meet you, as it always did
    if (outgunned && ratio < 1.1 && !sally && diff > 0) { setPost('shelter'); return A; }
    if (outgunned && (sally || ratio >= 1.1)) { setPost('rush', 'outgunned'); return A; }
    if (P.post === 'shelter') { if (close < R1 * 1.05) { setPost('engage', 'in reach'); return A; } if (!nearW && close > R0 * 1.4) { setPost('hold', 'clear'); return A; } if (S.time - P.postT < 40) return A; setPost(ratio > .6 ? 'rush' : 'hold', 'waited'); return A; }
    if (P.post === 'engage' && close < R1 * 1.3) return A; // in it now: fight it out
    // the attackers committed to the world: sally doctrines come out to meet them, the rest fight from station
    if (sally && nearW && ratio > .7) { setPost(adv < -1200 ? 'rush' : 'engage'); return A; }
    setPost('hold'); return A;
  }
  const engageD = Math.max(R1, R0) + 3500;
  // shelled from beyond our reach on the way in: walking the rest of the way at the slowest ship's pace only feeds them
  // ships, so the line burns in now (or, badly out-gunned, gives it up for a fight on better terms)
  if (outgunned && diff > 0 && !reckless && P.post !== 'rush') { setPost(ratio > .5 ? 'rush' : orderly && !P.fellBack ? 'fallback' : 'rush', 'outgunned'); if (P.post === 'fallback') { P.fellBack = true; P.fb = { x: mc.x - ux * 12000, y: mc.y - uy * 12000 }; } return A; }
  if (P.post === 'rush' && P.why === 'outgunned' && close > R1 * .9) return A; // committed: keep burning in
  if (gap > engageD + 4000 && close > engageD) {
    // strung out and nearly there: the leaders wait for the rest (not a reckless fleet, and not on Easy)
    const spread = Math.max(...mw.map(s => hyp(s.x - mc.x, s.y - mc.y)), 0);
    if (!reckless && diff > 0 && gap < engageD + 16000 && spread > 3500 + mw.length * 120 && !(P.formT && S.time - P.formT > 25)) { if (P.post !== 'form') P.formT = S.time; setPost('form', 'strung out'); return A; }
    setPost('advance', P.post === 'form' ? 'formed' : ''); return A;
  }
  if (diff <= 0 || reckless) { setPost('engage'); return A; }
  if (adv > 1200 && !D.hunt) { setPost('standoff'); return A; }
  if (adv < -1200 || outgunned) { setPost('rush'); return A; }
  setPost('engage'); return A;
}
// targets by allocation: each warship takes the best target in its reach that is not already getting enough fire
function allocate(mw, seen, D, diff, dn = M.doc, foeTeam = 0) {
  const T = seen.filter(f => live(f) && !f.def.fighter && !f.def.shell && !f.surrendered);
  if (!T.length) return new Map();
  const flag = T.find(f => f.cmdr && f.cmdr === (S.cmdrs || []).filter(c => c.team === foeTeam && c.state === 'aboard').sort((a, b) => (b.rank || 0) - (a.rank || 0))[0]);
  const smart2 = diff >= 1;
  const want = f => { let v = (f.def.value || 50) * (1 + 1.2 * (1 - f.hp / f.def.hp)) / (ehp(f) / 1000 + 1.5); // value for the effort
    if (smart2) { const c = coverOf(f, T); if (c === 0) v *= 1.35; else if (c === 1) v *= 1.12; } // stragglers and ships out on their own
    if (f.sh < (f.def.shield || 1) * .25) v *= 1.35; if (f.cmdr) v *= D.hunt ? 1.8 : 1.3; if (dn === 'onslaught' && f === flag) v *= 2.2;
    if ((dn === 'cunning') && (f.h || f.type === 'tender' || f.def.depot || f.type === 'hauler')) v *= 1.8; if (dn === 'patient' && f.hp / f.def.hp < .4) v *= 1.5;
    if (f.boardProg > 0 && f.boardTeam === 1 - foeTeam) v *= 1.6; return v; };
  const W = new Map(T.map(f => [f, want(f)])), load = new Map(), out = new Map();
  const order = mw.slice().sort((a, b) => dpsOf(b) - dpsOf(a));
  for (const s of order) {
    const R = (effOf(s) || 1500) * (diff >= 2 ? 1.25 : 1.15), all = dpsAll(s); let best = null, bs = 0, bd = 0;
    for (const f of T) { const d = hyp(f.x - s.x, f.y - s.y); if (d > R * 1.6) continue;
      const need = ehp(f) / 12, have = load.get(f) || 0; // ~12 seconds of fire is enough on one target; more is overkill
      const hurt = smart2 ? dpsVs(s, f) : dpsOf(s); // what this ship's guns would actually do to her, through her plate
      let v = W.get(f) * (d < R ? 1.6 : 1) / (1 + d / 9000) * (have > need ? .25 : 1); if (s.engage === f || (s.order && s.order.t === f)) v *= 1.25; // a little stickiness
      if (smart2) v *= .2 + .8 * Math.min(1, hurt / all); // each hull shoots what it can hurt: the rock, paper and scissors of the line
      if (v > bs) { bs = v; best = f; bd = hurt; } }
    if (best) { out.set(s, best); load.set(best, (load.get(best) || 0) + (smart2 ? bd : dpsOf(s))); }
  }
  return out;
}
// the line: each warship has a place on it, kept from the first time it is drawn, capital ships a little behind
function slotOf(s, mw) {
  if (!P.slots) P.slots = new Map();
  if (!P.slots.has(s)) { const L = mw.filter(o => !o.def.cmd || mw.length < 3), n = Math.max(1, L.length); const i = P.slots.size; P.slots.set(s, { lat: ((i % 2 ? 1 : -1) * Math.ceil(i / 2)) * (1100 + Math.min(1400, (s.def.len || 400) * .25)), back: s.def.cmd && D_screen() && mw.length > 3 ? 1600 : 0 }); }
  return P.slots.get(s);
}
const D_screen = () => !!doc().screen;
// the screen: each flak frigate is told off to the capital ship nearest her, two at most to a ship, the biggest ships
// first, once the enemy brings fighters, missiles or torpedo boats (as the COUNTER cards have it: flak kills missiles
// and ripWings). A guard whose ship is lost goes back to the line
function assignGuards(mw, seen) {
  P.guard = P.guard || new Map(); P.guardK = P.guardK || new Map();
  for (const [g, c] of P.guard) if (!live(g) || !live(c) || c.broken) { P.guard.delete(g); P.guardK.delete(g); }
  const threat = seen.some(f => f.def.fighter || f.type === 'corvette' || f.type === 'raider' || f.weapons.some(w => w.def.kind === 'missile' && !w.def.nuke));
  if (!threat) return;
  const caps = mw.filter(s => s.def.cmd && (s.def.value || 0) >= 500 && !s.def.fighter).sort((a, b) => (b.def.value || 0) - (a.def.value || 0)); if (!caps.length) return;
  const flak = mw.filter(s => s.weapons.some(w => w.def.kind === 'flak' && w.def.range >= 1000) && !s.def.cmd && !P.guard.has(s));
  for (const g of flak) { const n = c => [...P.guard.values()].filter(x => x === c).length;
    const c = caps.filter(c => n(c) < 2).sort((a, b) => hyp(a.x - g.x, a.y - g.y) - hyp(b.x - g.x, b.y - g.y))[0]; if (!c) break;
    const mate = [...P.guard].find(([, x]) => x === c); P.guardK.set(g, mate ? -(P.guardK.get(mate[0]) || 1) : (g.id % 2 ? 1 : -1)); P.guard.set(g, c); }
}
export function tick() {
  if (!P) return;
  const { world, defending, diff: d0 } = P.ctx, D = doc(), b = bodyOf(world), diff = d0 ?? 1, smart = diff > 0;
  // Easy thinks every third second; Normal and Hard every second
  P.n = (P.n || 0) + 1; if (diff <= 0 && P.n % 3) return;
  const foesAll = S.ships.filter(s => s.team === 0 && live(s) && !s.def.static);
  if (!foesAll.length) return;
  const seen = foesAll.filter(f => !f.vis || f.vis[1]);
  const foes = known(1);
  const mine = S.ships.filter(s => s.team === 1 && live(s) && !s.def.static && !s.broken && !s.def.dropship); /* the Storks fly their own course down */
  const mw = mine.filter(warship); if (!mine.length) return;
  if (!P.lay && defending) layAmbush(mine, D, b);
  if (S.fireLong && S.fireLong[1] == null) S.fireLong[1] = !(D.patient || D.dark);
  if (!foes.length) {
    // nothing known of the enemy: attackers make for the world in line, defenders keep station
    for (const s of mine) { if (s.def.fighter && s.carrier) continue; if (defending) { if (s.order.type !== 'idle' && !s.lying) s.order = { type: 'idle', x: s.x, y: s.y }; } else if (s.order.type !== 'amove' || Math.random() < .1) s.order = { type: 'amove', x: b.x, y: b.y, cruise: smart ? Math.min(...mw.map(o => o.def.cruise)) * .95 : undefined }; }
    orbitAI(mine, D, b, defending); smartAbilities(mine, [], D, diff); return;
  }
  const A = readField(mine, mw, foes, seen, b, defending, D, diff), { mc, fc, ux, uy, gap } = A;
  if (S.debugAI) S.debugAI.push({ t: S.time, post: P.post, why: P.why, ratio: +A.ratio.toFixed(2), R1: A.R1, R0: A.R0, gap: Math.round(gap), close: Math.round(A.close), outgunned: A.outgunned });
  if ((P.ft -= 1) <= 0) { P.ft = 3; P.focus = smart && D.focus ? pickFocus(seen, mc) : []; }
  // the flank wing: the fastest escorts, chosen once while the fleets are still far apart, sent round once the line is nearly in reach
  if (!P.wings && !defending && smart && gap > 14000 && mw.length >= 6) {
    P.wings = true; const fast = mw.filter(s => !s.def.cmd && s.def.cruise >= 330).sort((a, c) => c.def.cruise - a.def.cruise);
    fast.slice(0, Math.round(fast.length * D.flank)).forEach(s => { s.wing = 'flank'; });
  }
  if (gap < 6000) P.flanked = true;
  const flankGo = gap < A.R1 + 12000;
  if (D.dark && !P.dark && !defending && gap > 40000 && gap < 150000) { P.dark = true; for (const s of mine) if (warship(s)) goCold(s); }
  coldAI(mine, foes);
  const alloc = smart ? allocate(mw, seen, D, diff) : new Map();
  const aimedN = new Map(); for (const f of alloc.values()) aimedN.set(f, (aimedN.get(f) || 0) + 1);
  P.sternN = new Map(); for (const s of mw) if (s.order.stern && live(s.order.t)) P.sternN.set(s.order.t, (P.sternN.get(s.order.t) || 0) + 1);
  if (smart) assignGuards(mw, seen);
  const esc = mw.filter(s => !s.def.cmd), ec = cen(esc), slow = mw.length ? Math.min(...mw.map(s => s.def.cruise * Math.max(.15, s.hf || 1))) * .95 : 200;
  const px = -uy, py = ux; // across the line
  const post = P.post || 'engage';
  // the line's own point: it moves toward the enemy at the slowest ship's pace, whatever any one ship is doing, and
  // never runs more than a few thousand km ahead of the ships themselves
  if (post === 'advance' || post === 'form') {
    if (!P.lp || P.lpPost !== 'line') { P.lp = { x: mc.x, y: mc.y }; P.lpT = S.time; P.lpPost = 'line'; }
    const dtl = Math.min(3, S.time - P.lpT); P.lpT = S.time;
    if (post === 'advance') { P.lp.x += ux * slow * dtl; P.lp.y += uy * slow * dtl; }
    const lead = (P.lp.x - mc.x) * ux + (P.lp.y - mc.y) * uy; if (lead > 4500) { P.lp.x -= ux * (lead - 4500); P.lp.y -= uy * (lead - 4500); }
    const side = (P.lp.x - mc.x) * px + (P.lp.y - mc.y) * py; P.lp.x -= px * side * .2; P.lp.y -= py * side * .2; // drift back onto the fleet's axis
  } else P.lpPost = null;
  // the station: defenders hold between the world and the enemy, just off the world; shelter is the world's far side
  const wd = hyp(fc.x - b.x, fc.y - b.y) || 1, wx = (fc.x - b.x) / wd, wy = (fc.y - b.y) / wd; // from the world toward the enemy
  const st = defending ? { x: b.x + wx * (b.r + 2600), y: b.y + wy * (b.r + 2600) } : null, sh = defending ? { x: b.x - wx * (b.r + 1500), y: b.y - wy * (b.r + 1500) } : null;
  const leash = defending ? b.r + 10000 : 1e18;
  for (const s of mine) {
    if (s.def.fighter && s.carrier) continue;
    if (s.order.type === 'board' && live(s.order.t)) continue;
    const pool = foes;
    const [t] = nearestOf(s, pool); if (!t) continue;
    if (s.def.troops && !s.def.fighter) { const prize = pool.filter(f => f.def.capture && !f.surrendered && seen.includes(f)).sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; if (prize && (!defending || hyp(prize.x - b.x, prize.y - b.y) < leash)) { s.order = { type: 'board', t: prize }; continue; } }
    if (s.def.fighter || s.def.shell) { if (s.order.type !== 'amove' || Math.random() < .3) s.order = { type: 'amove', x: t.x, y: t.y }; continue; }
    if (!warship(s)) { if (defending) { if (s.order.type !== 'move') s.order = { type: 'move', x: sh.x, y: sh.y }; } else if (s.order.type !== 'move' || Math.random() < .1) s.order = { type: 'move', x: mc.x - ux * 3000, y: mc.y - uy * 3000 }; continue; } // tenders and haulers keep behind the line
    const hp = s.hp / s.def.hp, aim = alloc.get(s), sl = slotOf(s, mw);
    s.helm = 'auto';
    // a cripple falls back behind the line, and fights only if it is cornered; it stays back until patched or the fight comes to it
    if (smart && D.pull && hp < D.pull && mw.length > 2) {
      const [th, thd] = nearestOf(s, seen);
      if (th && thd < 2500) { s.order = { type: 'attack', t: th }; s.engage = th; }
      else { const bx = defending ? sh.x : mc.x - ux * 7000, by = defending ? sh.y : mc.y - uy * 7000; if (!s.order.back || hyp(s.order.x - bx, s.order.y - by) > 4000) s.order = { type: 'move', x: bx, y: by, back: true }; s.helm = 'range'; }
      continue;
    }
    if (s.lying && post === 'hold') { const L = s.lying; s.order = { type: 'move', x: L.f.x + L.ox, y: L.f.y + L.oy }; continue; }
    s.order.back = false;
    // a flak frigate keeps beside the capital ship she screens, killing what comes at it, her rails on the allotted target
    const gc = smart && P.guard && P.guard.get(s);
    if (gc && live(gc) && !gc.broken && post !== 'fallback' && post !== 'shelter' && post !== 'hold') {
      const k = P.guardK.get(s) || 1, gx = gc.x + ux * 420 + px * k * 380, gy = gc.y + uy * 420 + py * k * 380;
      if (hyp(s.x - gx, s.y - gy) > 250 || s.order.type !== 'move') s.order = { type: 'move', x: gx, y: gy, guard: true };
      s.engage = aim && hyp(aim.x - s.x, aim.y - s.y) < effOf(s) * 1.05 ? aim : null; continue;
    }
    const slotPt = (cx, cy) => ({ x: cx + px * sl.lat - ux * sl.back, y: cy + py * sl.lat - uy * sl.back });
    const fightAim = () => { if (aim) { if (!(s.order.type === 'attack' && s.order.t === aim && !s.order.side && !s.order.stern)) s.order = { type: 'attack', t: aim }; s.engage = aim; } else if (s.order.type !== 'amove' || Math.random() < .3) s.order = { type: 'amove', x: t.x, y: t.y }; };
    if (post === 'fallback') { const back = defending || !P.fb ? sh || mc : P.fb, p = slotPt(back.x, back.y); s.order = { type: 'move', x: p.x, y: p.y, face: Math.atan2(uy, ux) }; s.helm = 'range'; if (aim && hyp(aim.x - s.x, aim.y - s.y) < effOf(s)) s.engage = aim; continue; }
    if (post === 'shelter') { const p = slotPt(sh.x, sh.y); if (s.order.type !== 'move' || hyp(s.order.x - p.x, s.order.y - p.y) > 1500) s.order = { type: 'move', x: p.x, y: p.y }; continue; }
    if (post === 'hold') {
      // fight from station: anything in reach gets fire, nothing is chased past the leash
      if (aim && hyp(aim.x - b.x, aim.y - b.y) < leash && hyp(aim.x - s.x, aim.y - s.y) < effOf(s) * 1.1) { s.helm = 'range'; fightAim(); continue; }
      const p = slotPt(st.x, st.y); if (hyp(s.x - p.x, s.y - p.y) > 900) { if (s.order.type !== 'move' || hyp(s.order.x - p.x, s.order.y - p.y) > 600) s.order = { type: 'move', x: p.x, y: p.y, face: Math.atan2(fc.y - p.y, fc.x - p.x) }; }
      else if (s.order.type !== 'idle') s.order = { type: 'idle', x: p.x, y: p.y, face: s.def.broadside ? undefined : Math.atan2(fc.y - p.y, fc.x - p.x) };
      continue;
    }
    if (post === 'advance' || post === 'form') {
      // the flank wing swings out early; the line moves together at the slowest ship's pace, stragglers catching up
      if (s.wing === 'flank' && flankGo && !P.flanked) { const fx = fc.x - ux * 1500 - uy * P.side * 6000, fy = fc.y - uy * 1500 + ux * P.side * 6000; s.order = { type: 'amove', x: fx, y: fy, flank: true }; continue; }
      const ahead = post === 'form' ? 0 : 1500, p = slotPt(P.lp.x + ux * ahead, P.lp.y + uy * ahead), lag = (s.x - p.x) * -ux + (s.y - p.y) * -uy; // how far behind her place she is
      s.order = { type: 'move', x: p.x, y: p.y, cruise: lag > 2500 ? undefined : lag < -800 ? slow * .3 : slow };
      continue;
    }
    // the fight
    if (s.wing === 'flank' && !P.flanked) { const fx = fc.x - ux * 1500 - uy * P.side * 6000, fy = fc.y - uy * 1500 + ux * P.side * 6000; if (hyp(s.x - fx, s.y - fy) > 2500) { s.order = { type: 'amove', x: fx, y: fy, flank: true }; continue; } }
    if (s.wing === 'flank' && smart) { const cap = seen.filter(f => f.sub && f.def.cmd && !f.def.static).sort((a, c) => (c.def.value || 0) - (a.def.value || 0))[0]; if (cap && hyp(cap.x - s.x, cap.y - s.y) < 14000) { s.order = { type: 'attack', t: cap, stern: true }; s.engage = cap; continue; } }
    // capital ships never lead: one ahead of its escorts drops back behind them, guns still firing
    if (smart && D.screen && s.def.cmd && esc.length > 2 && ec && post !== 'rush') { const ahead = ((s.x - ec.x) * ux + (s.y - ec.y) * uy); if (ahead > 1200) { s.order = { type: 'move', x: ec.x - ux * 1500, y: ec.y - uy * 1500, screen: true }; if (aim) s.engage = aim; continue; } }
    if (post === 'standoff') s.helm = 'range';
    // the counters in the fight: a fast escort whose target is a slow capital ship already under other guns works round to
    // her stern, where there is no plate and the drive takes double harm; any ship whose target has lost a shield half
    // works round to that beam and keeps the wound open
    if (smart && post !== 'standoff') {
      const st = s.order.stern && live(s.order.t) ? s.order.t : null;
      if (st && hp > .35 && hyp(st.x - s.x, st.y - s.y) < 16000) { s.engage = st; continue; } // committed to the run
      if (aim && !s.cmdr && sternRunner(s) && sternWorthy(aim) && hp > .5 && (aimedN.get(aim) || 0) >= 2 && (P.sternN.get(aim) || 0) < (diff >= 2 ? 3 : 2)) {
        s.order = { type: 'attack', t: aim, stern: true }; s.engage = aim; P.sternN.set(aim, (P.sternN.get(aim) || 0) + 1); continue; }
      const sd = aim && !s.def.cmd && !s.cmdr && softSide(aim); // capital ships and flagships keep their place behind the screen
      if (sd && hyp(aim.x - s.x, aim.y - s.y) < effOf(s) * 1.8) { if (!(s.order.type === 'attack' && s.order.t === aim && s.order.side === sd)) s.order = { type: 'attack', t: aim, side: sd }; s.engage = aim; continue; }
    }
    if (post === 'rush') { s.helm = 'auto'; if (aim) { s.order = { type: 'attack', t: aim }; s.engage = aim; } else s.order = { type: 'amove', x: t.x, y: t.y }; continue; }
    fightAim();
    if (!aim && P.focus.length) { const R = reach(s) * 1.15, f = P.focus.filter(f => hyp(f.x - s.x, f.y - s.y) < R)[0]; if (f) s.engage = f; }
  }
  orbitAI(mine, D, b, defending);
  smartAbilities(mine, seen, D, diff);
  if (smart) salvos(mw, alloc, diff);
  for (const s of mine) if (s.lanceT > S.time && s.sub && s.sh > 0 && !(s.braceT > S.time) && Math.random() < [.25, .55, .8][diff]) brace(s, threatSide(s));
  // nuclear doctrine, after the books: a nuke is kept for the moment that matters. A wave of boarders in flight at one
  // of our capital ships (Roque at Ilium), or a knot of enemy capital ships with none of ours near. Two to a battle (three
  // on Hard), and never two inside twenty seconds
  P.nukes = P.nukes || 0; const cap = diff >= 2 ? 3 : 2;
  if (P.nukes < cap && S.time - (P.nukeT ?? -99) > 20) {
    const launchers = mine.filter(s => !disabled(s) && nukesOf(s).some(w => w.ammo >= 1 && w.cd <= 0));
    if (launchers.length) {
      const caps = mine.filter(s => s.def.cmd && !s.def.static), clear = p => !mine.some(o => hyp(o.x - p.x, o.y - p.y) < 900);
      const craft = S.ships.filter(o => o.team === 0 && !o.dead && (o.def.troops || o.type === 'starshell') && (!o.vis || o.vis[1]) && caps.some(c => hyp(c.x - o.x, c.y - o.y) < 6000));
      let tgt = null;
      for (const c of craft) { const n = craft.filter(o => hyp(o.x - c.x, o.y - c.y) < 450).length; if (n >= 4 && clear(c)) { tgt = c; break; } }
      if (!tgt) for (const c of seen.filter(o => o.def.cmd && !o.def.static)) { let v = 0; for (const o of seen) if (o.def.cmd && hyp(o.x - c.x, o.y - c.y) < 450) v += o.def.value || 0; if (v >= [2400, 1600, 1200][diff] && clear(c)) { tgt = c; break; } }
      if (tgt) for (const L of launchers) { const w = nukesOf(L).find(w => w.ammo >= 1 && w.cd <= 0); if (w && hyp(L.x - tgt.x, L.y - tgt.y) < w.def.range) { launchNuke(L, w, null, { x: tgt.x + tgt.vx * 3, y: tgt.y + tgt.vy * 3 }); P.nukes++; P.nukeT = S.time; break; } }
    }
  }
}
// time on target: the missile racks and torpedo tubes of ships allotted the same target hold their fire (six seconds
// at most) until three of them are ready (four on Hard), then all loose together, so her point defence meets twenty-odd
// missiles at once instead of eight at a time. The AI thinks once a second, so a held launcher is kept a little over a
// second from firing each time it thinks
function salvos(mw, alloc, diff) {
  const by = new Map();
  for (const s of mw) { const t = alloc.get(s); if (!t || !live(t) || s.cold) continue; const d = hyp(t.x - s.x, t.y - s.y);
    for (const w of s.weapons) { const D = w.def; if (D.kind !== 'missile' || D.nuke || D.manual || D.emp || w.ammo <= 0 || d > D.range * .95 || (D.breach && !bigHull(t))) continue;
      if (!by.has(t)) by.set(t, []); by.get(t).push(w); } }
  for (const w of P.held || []) if (![...by.values()].some(L => L.includes(w))) w.holdT = 0; // a launcher no longer on a shared target is let go
  P.held = [];
  for (const [t, L] of by) {
    if (L.length < 2) { for (const w of L) w.holdT = 0; continue; }
    const ready = L.filter(w => w.cd <= 1.2 && !(w.salvo > 0)), k = Math.min(L.length, diff >= 2 ? 4 : 3), first = Math.min(...L.map(w => w.holdT || Infinity));
    if (ready.length >= k || S.time - first > 6) { for (const w of L) if (w.holdT) { w.cd = 0; w.holdT = 0; } continue; } // loose
    for (const w of ready) { if (!w.holdT) w.holdT = S.time; w.cd = Math.max(w.cd, 1.15); P.held.push(w); }
  }
}
// abilities for a reason, not at random: each commander's group looks at what is happening around its flagship
function smartAbilities(mine, seen, D, diff) {
  if (diff <= 0) { AB.aiTick(D.ab * .6); return; } // Easy keeps the old habit, and slower
  const post = P.post;
  for (const c of S.cmdrs || []) {
    const G = AB.aiGroup(c); if (!G || c.ship.broken || !G.ships.length) continue;
    const can = k => { const L = AB.list(G).find(([x]) => x === k); return L && AB.state(G, k, L[1]).ok; };
    const F = c.ship, nearF = R => seen.filter(f => !f.def.fighter && !f.def.shell && hyp(f.x - F.x, f.y - F.y) < R);
    const inc = S.missiles.filter(m => !m.dead && m.team === 0 && m.t && G.ships.includes(m.t) && hyp(m.x - m.t.x, m.y - m.t.y) < 2600).length;
    const lance = G.ships.some(s => s.lanceT > S.time);
    if ((lance || inc >= 3) && can('brace')) { AB.use(G, 'brace'); continue; }
    if (post === 'rush' && nearF(16000).length && !nearF(2500).length && can('burn')) { AB.use(G, 'burn'); continue; }
    if (post === 'fallback' && nearF(6000).length && can('burn')) { AB.use(G, 'burn'); continue; }
    const engaged = nearF(Math.max(5000, effOf(F) * 1.1)).length;
    if (engaged && can('sig') && G.ships.length >= 2) { AB.use(G, 'sig'); continue; }
    if (engaged && can('bridge') && (D.hunt || M.doc === 'onslaught' || nearF(9000).some(f => f.def.cmd && f.sh < f.def.shield * .4))) { AB.use(G, 'bridge'); continue; }
    if ((post === 'standoff' || post === 'hold' || post === 'engage') && engaged && !nearF(2500).length && !lance && can('lock')) { AB.use(G, 'lock'); continue; }
  }
  for (const s of S.ships) if (s.aimT && S.time > s.aimT) { s.aimSub = null; s.aimT = 0; }
}
// going cold and coming out of it: an ambusher in the rocks goes cold once it is in place; any cold ship warms up when the
// enemy is about to find it anyway (inside its own lock range), or the moment it is hit
function coldAI(mine, foes) {
  for (const s of mine) {
    if (s.coldAt && s.lying && !s.cold && hyp(s.x - s.order.x, s.y - s.order.y) < 600) { goCold(s); s.coldAt = false; }
    if (!s.cold) continue;
    const near = foes.reduce((m, f) => Math.min(m, hyp(f.x - s.x, f.y - s.y)), 1e18);
    if (near < Math.max(6000, lockOf(s) * .9) || S.time - (s.shHit ?? -99) < 2 || S.time - (s.lastHit ?? -99) < 2) warmUp(s);
  }
}
// the fight over the drop corridor. Defending, the enemy keeps a picket of warships in it whenever we carry pods; attacking,
// once the world's guns are silent it pushes a wing into the corridor and brings its pod carriers down behind it, and a
// commander who fights hard (Atalantia's Onslaught, a Reckless fleet) burns the capital first. Boarders go for what the
// doctrine wants: a Patient fleet takes ships whole, a Cunning one blows their engines, an Onslaught cuts for the bridge.
const AIM_BY = { patient: 'whole', cunning: 'engines', onslaught: 'bridge' };
function orbitAI(mine, D, b, defending) {
  S.aiBoardAim = AIM_BY[M.doc] || null;
  // our Storks in the corridor: the defenders go for them first
  if (defending) { const st = S.ships.filter(s => s.team === 0 && !s.dead && s.def.dropship); if (st.length) { const war = mine.filter(s => warship(s) && !s.lying).sort((a, c) => hyp(a.x - st[0].x, a.y - st[0].y) - hyp(c.x - st[0].x, c.y - st[0].y)).slice(0, 3); for (const s of war) { const t = st.sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; s.order = { type: 'attack', t }; s.engage = t; } } }
  const O = OP.orb; if (!O || O.open && !defending && !mine.some(s => s.h && s.h.boarder > 0)) return;
  const war = mine.filter(s => warship(s) && !s.lying && !s.broken && !s.def.troops), d = s => hyp(s.x - O.x, s.y - O.y);
  const hold = (L, why) => { for (const s of L) { if (d(s) > O.R * .55) s.order = { type: 'amove', x: O.x, y: O.y, corr: why }; else if (s.order.type === 'move' || s.order.type === 'amove') s.order = { type: 'idle', x: s.x, y: s.y, corr: why }; } };
  if (defending) {
    if (!O.pods || O.open) return; // nothing to drop, or too late
    const want = Math.max(1, Math.min(3, Math.round(war.length * .25)));
    P.cg = (P.cg || []).filter(s => war.includes(s)); for (const s of war.slice().sort((a, c) => d(a) - d(c))) { if (P.cg.length >= want) break; if (!P.cg.includes(s) && !s.def.cmd) P.cg.push(s); }
    hold(P.cg, 'guard'); return;
  }
  const guns = S.ships.some(s => s.team === OP.defTeam && !s.dead && s.type === 'gunplat');
  const carriers = mine.filter(s => s.h && s.h.boarder > 0 && !s.broken);
  // the guns first: a wing peels off to silence the platforms, since nothing lands through live guns
  if (guns && carriers.length) { const plats = S.ships.filter(s => s.team === OP.defTeam && !s.dead && s.type === 'gunplat'), want = Math.max(2, Math.round(war.length * .35));
    P.gw = (P.gw || []).filter(s => war.includes(s)); for (const s of war.slice().sort((a, c) => (c.def.value || 0) - (a.def.value || 0))) { if (P.gw.length >= want) break; if (!P.gw.includes(s) && !s.def.cmd) P.gw.push(s); }
    for (const s of P.gw) { const t = plats.sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; if (t) { s.order = { type: 'attack', t }; s.engage = t; } } }
  if (!guns && carriers.length) {
    if (!O.open) { const want = Math.max(2, Math.round(war.length * .4)); P.cw = (P.cw || []).filter(s => war.includes(s)); for (const s of war.slice().sort((a, c) => d(a) - d(c))) { if (P.cw.length >= want) break; if (!P.cw.includes(s)) P.cw.push(s); } hold(P.cw, 'hold'); }
    hold(carriers, 'drop'); // the carriers come down behind the wing: once over the world their pods can fall
  }
  if (!guns && !O.bomb && !O.bombed && (M.doc === 'onslaught' || M.doc === 'reckless') && bombCan(1).ok && Math.random() < .2) bombStart(1);
}
// allied hulls on the player's team: the battle AI fights them as a steady ally would. They close on the nearest enemy
// the player's side can see, board what they can, pull their cripples back, and hold orbit beside a defending player
export function allyTick() {
  if (!P) return;
  const L = S.ships.filter(s => s.ally && s.team === 0 && live(s) && !s.def.static); if (!L.length) return;
  const foes = S.ships.filter(s => s.team === 1 && live(s) && !s.def.fighter && (!s.vis || s.vis[0]));
  const z = S.bzone || { x: 0, y: 0 }, mine = L.filter(warship), mc = cen(mine.length ? mine : L), alloc = allocate(mine, foes, DOC.steady, 1, 'steady', 1);
  for (const s of L) {
    if (s.def.fighter && s.carrier) continue;
    if (s.order.type === 'board' && live(s.order.t)) continue;
    if (!foes.length) { if (P.ctx.allyAtt && s.order.type === 'idle' && hyp(s.x - z.x, s.y - z.y) > 9000) s.order = { type: 'amove', x: z.x, y: z.y }; continue; }
    if (s.def.troops && !s.def.fighter) { const prize = foes.filter(f => f.def.capture && (f.sh < (f.def.shield || 1) * .3 || f.surrendered)).sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; if (prize) { s.order = { type: 'board', t: prize }; continue; } }
    const [t, td] = nearestOf(s, foes); if (!t) continue;
    if (s.hp / s.def.hp < .25 && mine.length > 2 && td > 1200) { if (!s.order.back) s.order = { type: 'move', x: mc.x + (mc.x - t.x) * .3, y: mc.y + (mc.y - t.y) * .3, back: true }; continue; }
    const aim = alloc.get(s); if (aim) { if (!(s.order.type === 'attack' && s.order.t === aim)) s.order = { type: 'attack', t: aim }; s.engage = aim; continue; }
    if (s.order.type === 'attack' && live(s.order.t) && hyp(s.order.t.x - s.x, s.order.t.y - s.y) < 2500) continue;
    if (s.order.type !== 'amove' || s.order.back || Math.random() < .25) s.order = { type: 'amove', x: t.x, y: t.y };
  }
}
