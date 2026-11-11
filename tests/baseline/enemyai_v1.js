// The enemy fleet's mind in a campaign battle, once a second. It reads the doctrine of the commander who leads it
// (morale.js): it picks the targets worth killing and puts its guns on them together, sends a fast wing round
// the flank while the line closes, keeps its capital ships behind a screen of escorts, and pulls its cripples back
// behind the line. A defending fleet holds near its world until the attackers come within reach.
import { S } from './state.js';
import { bodyOf } from './solar.js';
import { nukesOf, launchNuke, disabled, brace, threatSide, goCold, warmUp } from './sim.js';
import { lockOf } from './data.js';
import * as AB from './abilities.js';
import { M, doc } from './morale.js';
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
export function tick() {
  if (!P) return;
  const { world, defending, diff } = P.ctx, D = doc(), b = bodyOf(world), smart = (diff ?? 1) > 0;
  const foesAll = S.ships.filter(s => s.team === 0 && live(s) && !s.def.static);
  if (!foesAll.length) return;
  // the fleet knows what it sees, what its sensors pick up, and where it last saw the rest
  const seen = foesAll.filter(f => !f.vis || f.vis[1]);
  const foes = known(1);
  const mine = S.ships.filter(s => s.team === 1 && live(s) && !s.def.static && !s.broken && !s.def.dropship); /* the Storks fly their own course down */
  const mw = mine.filter(warship); if (!mine.length) return;
  if (!P.lay && defending) layAmbush(mine, D, b);
  // fire discipline: a patient or cunning commander holds fire to the effective range (and stays unseen); the rest
  // open up at long range
  if (S.fireLong && S.fireLong[1] == null) S.fireLong[1] = !(D.patient || D.dark);
  if (!foes.length) {
    // nothing known of the enemy: attackers make for the world, defenders keep station
    for (const s of mine) { if (s.def.fighter && s.carrier) continue; if (defending) { if (s.order.type !== 'idle' && !s.lying) s.order = { type: 'idle', x: s.x, y: s.y }; } else if (s.order.type !== 'amove' || Math.random() < .1) s.order = { type: 'amove', x: b.x, y: b.y }; }
    orbitAI(mine, D, b, defending); AB.aiTick(D.ab); return;
  }
  const fc = cen(foes.filter(f => !f.def.fighter)) || cen(foes), mc = cen(mw.length ? mw : mine);
  let ux = fc.x - mc.x, uy = fc.y - mc.y; const gap = hyp(ux, uy) || 1; ux /= gap; uy /= gap;
  const near = foes.filter(f => hyp(f.x - b.x, f.y - b.y) < b.r + 15000);
  const hold = defending && !near.length && !D.sally;
  if ((P.ft -= 1) <= 0) { P.ft = 3; P.focus = smart && D.focus ? pickFocus(seen, mc) : []; }
  // the flank wing: the fastest escorts, chosen once while the fleets are still far apart
  if (!P.wings && !defending && smart && gap > 14000 && mw.length >= 6) {
    P.wings = true; const fast = mw.filter(s => !s.def.cmd && s.def.cruise >= 330).sort((a, c) => c.def.cruise - a.def.cruise);
    fast.slice(0, Math.round(fast.length * D.flank)).forEach(s => { s.wing = 'flank'; });
  }
  if (gap < 6000) P.flanked = true;
  // a cunning commander runs dark on the approach
  if (D.dark && !P.dark && !defending && gap > 40000 && gap < 150000) { P.dark = true; for (const s of mine) if (warship(s)) goCold(s); }
  coldAI(mine, foes);
  const esc = mw.filter(s => !s.def.cmd), ec = cen(esc), slow = Math.min(...mw.map(s => s.def.cruise * Math.max(.15, s.hf || 1))) * .95;
  for (const s of mine) {
    if (s.def.fighter && s.carrier) continue;
    if (s.order.type === 'board' && live(s.order.t)) continue;
    if (hold) { if (s.lying) { const L = s.lying; s.order = { type: 'move', x: L.f.x + L.ox, y: L.f.y + L.oy }; } else if (s.order.type !== 'idle') s.order = { type: 'idle', x: s.x, y: s.y }; continue; }
    const pool = defending && !D.sally ? near : foes;
    const [t] = nearestOf(s, pool); if (!t) continue;
    // assault ships go for the prizes
    if (s.def.troops && !s.def.fighter) { const prize = pool.filter(f => f.def.capture && !f.surrendered && seen.includes(f)).sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; if (prize) { s.order = { type: 'board', t: prize }; continue; } }
    const hp = s.hp / s.def.hp;
    // a cripple falls back behind the line, and fights only if it is cornered
    if (smart && D.pull && hp < D.pull && mw.length > 2 && !s.def.fighter) {
      const [th, thd] = nearestOf(s, seen);
      if (th && thd < 2500) { s.order = { type: 'attack', t: th }; s.engage = th; }
      else if (!s.order.back) s.order = { type: 'move', x: mc.x - ux * 7000, y: mc.y - uy * 7000, back: true };
      continue;
    }
    s.order.back = false;
    // a patient commander closes as one line, at the pace of the slowest ship
    // on Hard a steady or cunning one closes as one line too, until the guns are nearly in reach (a patient one always does)
    if ((D.patient || (D.form && (diff ?? 1) >= 2)) && !defending && s.wing !== 'flank' && gap > (D.patient ? 12000 : 8000)) { s.order = { type: 'amove', x: s.x + ux * 3000, y: s.y + uy * 3000, cruise: slow }; continue; }
    // the flank wing swings wide, then comes in on the enemy's side
    if (s.wing === 'flank' && !P.flanked) {
      const fx = fc.x - ux * 1500 - uy * P.side * 6000, fy = fc.y - uy * 1500 + ux * P.side * 6000;
      if (hyp(s.x - fx, s.y - fy) > 2500) { s.order = { type: 'amove', x: fx, y: fy, flank: true }; continue; }
    }
    // keep fighting what it is on, if it is still worth it
    if (s.order.type === 'attack' && live(s.order.t) && (P.focus.includes(s.order.t) || hyp(s.order.t.x - s.x, s.order.t.y - s.y) < 4500)) continue;
    // capital ships never lead: one ahead of its escorts drops back behind them, guns still firing
    if (smart && D.screen && s.def.cmd && esc.length > 2 && ec) {
      const ahead = ((s.x - ec.x) * ux + (s.y - ec.y) * uy);
      if (ahead > 1200) { s.order = { type: 'move', x: ec.x - ux * 1500, y: ec.y - uy * 1500, screen: true }; continue; }
    }
    // a flanker that has come round goes for what the enemy keeps behind its line: carriers, flagships, tenders
    if (s.wing === 'flank' && !s.def.fighter && smart) { const cap = seen.filter(f => f.sub && f.def.cmd && !f.def.static).sort((a, c) => (c.def.value || 0) - (a.def.value || 0))[0];
      if (cap && hyp(cap.x - s.x, cap.y - s.y) < 14000) { s.order = { type: 'attack', t: cap, stern: true }; s.engage = cap; continue; } }
    if (s.wing === 'flank' && !s.def.fighter) { const soft = seen.filter(f => !f.def.fighter && !f.def.shell && (f.h || f.cmdr || f.def.depot || f.type === 'hauler')).sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0];
      if (soft && hyp(soft.x - s.x, soft.y - s.y) < 9000) { s.order = { type: 'attack', t: soft }; s.engage = soft; continue; } }
    // every gun on the targets worth killing
    // every gun on the targets worth killing, among those it can reach; nothing is worth sailing through the enemy for
    if (s.order.type !== 'amove' || Math.random() < .3) s.order = { type: 'amove', x: t.x, y: t.y };
    if (P.focus.length && !s.def.fighter) { const R = reach(s) * 1.15, f = P.focus.filter(f => hyp(f.x - s.x, f.y - s.y) < R).sort((a, c) => P.focus.indexOf(a) - P.focus.indexOf(c))[0]; if (f) s.engage = f; }
  }
  orbitAI(mine, D, b, defending);
  AB.aiTick(D.ab);
  // a ship with a lance charging at her braces, if her captain is quick enough to see it
  for (const s of mine) if (s.lanceT > S.time && s.sub && s.sh > 0 && !(s.braceT > S.time) && Math.random() < [.25, .55, .8][diff ?? 1]) brace(s, threatSide(s));
  // nuclear doctrine, after the books: a nuke is kept for the moment that matters. A wave of boarders in flight at one
  // of our capital ships (Roque at Ilium), or a knot of enemy capital ships with none of ours near. Two to a battle (three
  // on Hard), and never two inside twenty seconds
  P.nukes = P.nukes || 0; const cap = (diff ?? 1) >= 2 ? 3 : 2;
  if (P.nukes < cap && S.time - (P.nukeT ?? -99) > 20) {
    const launchers = mine.filter(s => !disabled(s) && nukesOf(s).some(w => w.ammo >= 1 && w.cd <= 0));
    if (launchers.length) {
      const caps = mine.filter(s => s.def.cmd && !s.def.static), clear = p => !mine.some(o => hyp(o.x - p.x, o.y - p.y) < 900);
      const craft = S.ships.filter(o => o.team === 0 && !o.dead && (o.def.troops || o.type === 'starshell') && (!o.vis || o.vis[1]) && caps.some(c => hyp(c.x - o.x, c.y - o.y) < 6000));
      let tgt = null;
      for (const c of craft) { const n = craft.filter(o => hyp(o.x - c.x, o.y - c.y) < 450).length; if (n >= 4 && clear(c)) { tgt = c; break; } }
      if (!tgt) for (const c of seen.filter(o => o.def.cmd && !o.def.static)) { let v = 0; for (const o of seen) if (o.def.cmd && hyp(o.x - c.x, o.y - c.y) < 450) v += o.def.value || 0; if (v >= [2400, 1600, 1200][diff ?? 1] && clear(c)) { tgt = c; break; } }
      if (tgt) for (const L of launchers) { const w = nukesOf(L).find(w => w.ammo >= 1 && w.cd <= 0); if (w && hyp(L.x - tgt.x, L.y - tgt.y) < w.def.range) { launchNuke(L, w, null, { x: tgt.x + tgt.vx * 3, y: tgt.y + tgt.vy * 3 }); P.nukes++; P.nukeT = S.time; break; } }
    }
  }
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
  const z = S.bzone || { x: 0, y: 0 }, mine = L.filter(warship), mc = cen(mine.length ? mine : L);
  for (const s of L) {
    if (s.def.fighter && s.carrier) continue;
    if (s.order.type === 'board' && live(s.order.t)) continue;
    if (!foes.length) { if (P.ctx.allyAtt && s.order.type === 'idle' && hyp(s.x - z.x, s.y - z.y) > 9000) s.order = { type: 'amove', x: z.x, y: z.y }; continue; }
    if (s.def.troops && !s.def.fighter) { const prize = foes.filter(f => f.def.capture && (f.sh < (f.def.shield || 1) * .3 || f.surrendered)).sort((a, c) => hyp(a.x - s.x, a.y - s.y) - hyp(c.x - s.x, c.y - s.y))[0]; if (prize) { s.order = { type: 'board', t: prize }; continue; } }
    const [t, td] = nearestOf(s, foes); if (!t) continue;
    if (s.hp / s.def.hp < .25 && mine.length > 2 && td > 1200) { if (!s.order.back) s.order = { type: 'move', x: mc.x + (mc.x - t.x) * .3, y: mc.y + (mc.y - t.y) * .3, back: true }; continue; }
    if (s.order.type === 'attack' && live(s.order.t) && hyp(s.order.t.x - s.x, s.order.t.y - s.y) < 2500) continue;
    if (s.order.type !== 'amove' || s.order.back || Math.random() < .25) s.order = { type: 'amove', x: t.x, y: t.y };
  }
}
