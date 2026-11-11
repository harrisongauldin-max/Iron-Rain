import { S } from './state.js';
import { FACTIONS } from './data.js';
import { rand, hyp, dist } from './util.js';
import { enqueue, nearestNode, neededKind, mainAmmo, crewEff, disabled, nukesOf, launchNuke, countType, defOf, inRoster, assignCommander, isCapital } from './sim.js';
import { toast } from './ui.js';

// Weighted build plan by game phase, filtered to the AI's faction roster.
function plan(t, fk) {
  const u = { rising: 'corsair', core: 'moonbreaker', rim: 'raider' }[fk];
  let p;
  if (t < 150) p = [['ripwing', .4], ['corvette', .3], ['corsair', .3], ['frigate', .25]];
  else if (t < 420) p = [['ripwing', .15], ['corvette', .12], ['corsair', .15], ['frigate', .22], ['raider', .25], ['destroyer', .25], ['starshell', .1]];
  else if (t < 900) p = [['corvette', .08], ['frigate', .12], ['raider', .2], ['destroyer', .18], ['torch', .25], ['dread', .15], ['starshell', .1]];
  else p = [['frigate', .1], ['raider', .2], ['destroyer', .15], ['torch', .25], ['dread', .3], ['starshell', .1], ['moonbreaker', .12]];
  return p.filter(([k]) => k !== 'moonbreaker' || u === 'moonbreaker').filter(([k]) => inRoster(1, k));
}
function pickWeighted(list) { let r = Math.random() * list.reduce((a, x) => a + x[1], 0); for (const [k, w] of list) { r -= w; if (r <= 0) return k; } return list[0][0]; }

export function aiTick() {
  const T = 1, st = S.stations[T]; if (!st || st.dead) return;
  const fk = S.fac[T];
  const my = S.ships.filter(s => s.team === T && !s.def.static);
  const haulers = my.filter(s => s.type === 'hauler');
  const combatS = my.filter(s => !['hauler', 'boarder', 'starshell', 'tender', 'scout'].includes(s.type) && !(s.carrier && s.order.type === 'guard') && !s.surrendered);
  const boarders = my.filter(s => s.type === 'boarder' || (s.type === 'starshell' && !s.carrier));
  const q = st.queue; const queued = t => q.filter(x => x.type === t).length;
  const wantH = Math.min(12, 4 + Math.floor(S.time / 80));
  if (haulers.length + queued('hauler') < wantH && q.length < 3) enqueue(T, 'hauler');
  for (const h of haulers) if (h.order.type === 'idle') h.order = { type: 'mine', node: nearestNode(h, 0, neededKind(T)), phase: 'go', ox: rand(-60, 60), oy: rand(-60, 60) };
  // rebalance one hauler a tick toward the scarcer resource
  const need = neededKind(T), wrong = haulers.find(h => h.order.type === 'mine' && h.order.node && h.order.node.kind !== need && h.cargo === 0);
  if (wrong && Math.random() < .15) wrong.order = { type: 'mine', node: nearestNode(wrong, 0, need), phase: 'go', ox: rand(-60, 60), oy: rand(-60, 60) };
  if (S.time > 120 && countType(T, 'scout') < 1) enqueue(T, 'scout');
  if (S.time > 360 && countType(T, 'tender') < 1) enqueue(T, 'tender');
  if (S.time > 60 && countType(T, 'starshell') < 2 && Math.random() < .3) enqueue(T, 'starshell');
  if (q.length < (S.res[T] > 1500 && S.ore[T] > 1500 ? 4 : 2)) {
    const p = plan(S.time, fk); let pick = p.length ? pickWeighted(p) : 'frigate';
    const d = defOf(T, pick);
    if (d.limit && countType(T, pick) >= d.limit) pick = 'dread';
    const afford = k => { const e = defOf(T, k); return S.res[T] >= e.cost && S.ore[T] >= e.ore && S.man[T] >= e.man; };
    if (!afford(pick)) { if (defOf(T, pick).value > 500 && Math.random() < .7) pick = null; else pick = ['destroyer', 'frigate', 'corvette', 'ripwing'].find(k => inRoster(T, k) && afford(k)) || null; }
    if (pick) enqueue(T, pick);
  }
  // commanders take the biggest uncommanded capital ships
  for (const c of S.cmdrs) {
    if (c.team !== T || c.state !== 'ready') continue;
    const ship = my.filter(s => s.def.cmd && !s.cmdr && !s.surrendered).sort((a, b) => b.def.value - a.def.value)[0];
    if (ship) assignCommander(c, ship);
  }
  const ps0 = S.stations[0];
  for (const s of my) if (s.type === 'scout' && s.order.type === 'idle' && !s.posted && ps0) { s.posted = true; s.order = { type: 'move', x: st.x + (ps0.x - st.x) * .4 + rand(-4000, 4000), y: st.y + (ps0.y - st.y) * .4 + rand(-4000, 4000) }; }
  // threats: player warships closing on the citadel or on any world the AI holds
  const posts = S.ships.filter(s => s.team === T && s.def.static && !s.dead);
  const threats = S.ships.filter(s => s.team === 0 && !s.def.static && s.type !== 'hauler' && s.vis[1] && posts.some(p => hyp(s.x - p.x, s.y - p.y) < (p === st ? 3400 : 5000)));
  for (const s of combatS) { if (s.order.type === 'rearm') continue; if ((mainAmmo(s) < .15 || crewEff(s) < .35 || s.fuel < .2) && !disabled(s) && !threats.length) s.order = { type: 'rearm', quiet: true }; }
  const ready = combatS.filter(s => s.order.type !== 'rearm' && !s.derelict);
  const value = a => a.reduce((v, s) => v + (s.def.value || 0), 0);
  const AI = S.AI;
  if (threats.length) {
    const cx = threats.reduce((a, s) => a + s.x, 0) / threats.length, cy = threats.reduce((a, s) => a + s.y, 0) / threats.length;
    for (const s of ready) if (!s.engage && s.order.type !== 'attack' && (!AI.attacking || hyp(s.x - cx, s.y - cy) < 30000)) s.order = { type: 'amove', x: cx, y: cy };
  } else if (!AI.attacking) {
    const v = value(ready);
    if (v >= AI.threshold && ready.length >= 4) {
      AI.attacking = true; AI.sentValue = v; AI.threshold = Math.min(12000, AI.threshold * 1.3 + 300);
      const tgt = pickTarget(); for (const s of ready) s.order = { type: 'amove', x: tgt.x + rand(-250, 250), y: tgt.y + rand(-250, 250) };
      toast(FACTIONS[fk].name + ' fleet movement detected', 'bad');
    } else {
      // between offensives, take neutral ground: stations, platforms, derelicts
      AI.capT -= 1;
      const ct = AI.capTarget;
      if (ct && (ct.dead || ct.team !== 2)) AI.capTarget = null;
      if (!AI.capTarget && AI.capT <= 0) {
        AI.capT = 45;
        const cands = S.ships.filter(s => s.team === 2 && isCapital(s)).map(s => ({ s, sc: hyp(s.x - st.x, s.y - st.y) * (s.marines < 5 ? .4 : 1) * (s.def.static ? .8 : 1.2) })).sort((a, b) => a.sc - b.sc);
        if (cands.length && (cands[0].s.marines < 5 || v > AI.threshold * .5)) AI.capTarget = cands[0].s;
      }
      const tgt = AI.capTarget;
      if (tgt) {
        const grp = ready.slice(0, Math.max(2, Math.ceil(ready.length * .6)));
        for (const s of grp) if (s.order.type !== 'attack' || s.order.t !== tgt) { if (tgt.marines >= 5 || tgt.sh > tgt.def.shield * .25) s.order = { type: 'attack', t: tgt }; else if (s.order.type === 'idle') s.order = { type: 'move', x: tgt.x + rand(-400, 400), y: tgt.y + rand(-400, 400) }; }
      } else for (const s of ready) if (s.order.type === 'idle' && hyp(s.x - st.rally.x, s.y - st.rally.y) > 800) s.order = { type: 'move', x: st.rally.x + rand(-350, 350), y: st.rally.y + rand(-350, 350) };
    }
  } else {
    const v = value(ready.filter(s => s.order.type === 'amove' || s.order.type === 'attack'));
    if (v < AI.sentValue * .3) { AI.attacking = false; for (const s of combatS) s.order = { type: 'rearm', quiet: true }; }
    else { const tgt = pickTarget(); for (const s of ready) if (s.order.type === 'idle') s.order = { type: 'amove', x: tgt.x, y: tgt.y }; }
  }
  // boarding parties: capitals with shields down and thin garrisons, neutrals included
  for (const p of boarders) {
    if (p.order.type === 'board' || p.docked) continue;
    if (p.troops < p.def.troops * .5) { if (p.order.type !== 'rearm') p.order = { type: 'rearm', quiet: true }; continue; }
    let best = null, bd = 1e18;
    for (const s of S.ships) {
      if (s.team === T || !s.def.capture || !s.vis[1] || s.dead) continue;
      if (s.team === 2 && s !== AI.capTarget && s.marines >= 5) continue;
      let d = dist(s, p); d *= (s.sh < s.def.shield * .25 || s.surrendered ? .4 : 1) * (.5 + s.marines / (s.def.crew * s.def.mar + 1)); if (s.team === 2 && s.marines < 5) d *= .5;
      if (d < bd) { bd = d; best = s; }
    }
    if (best && (bd < 3500 || AI.attacking || best === AI.capTarget)) p.order = { type: 'board', t: best };
    else if (p.order.type === 'idle' && hyp(p.x - st.rally.x, p.y - st.rally.y) > 500) p.order = { type: 'move', x: st.rally.x, y: st.rally.y };
  }
  // nuclear doctrine: hit dense clusters of enemy ships, never with friendly ships nearby
  S.aiNukeT -= 1;
  if (S.aiNukeT <= 0 && S.difficulty > 0) {
    const launchers = S.ships.filter(s => s.team === T && !disabled(s) && nukesOf(s).some(w => w.ammo >= 1 && w.cd <= 0));
    const foes = S.ships.filter(s => s.team === 0 && s.vis[1] && !s.def.static);
    let bestP = null, bestV = 0;
    for (let i = 0; i < Math.min(30, foes.length); i++) {
      const c = foes[Math.floor(Math.random() * foes.length)]; let v = 0;
      for (const o of foes) if (hyp(o.x - c.x, o.y - c.y) < 450) v += o.def.value || 0;
      if (v > bestV && !S.ships.some(o => o.team === T && !o.def.static && hyp(o.x - c.x, o.y - c.y) < 900)) { bestV = v; bestP = c; }
    }
    if (bestP && bestV >= (S.difficulty === 2 ? 700 : 1000)) {
      for (const L of launchers) {
        const w = nukesOf(L).find(w => w.ammo >= 1 && w.cd <= 0);
        if (w && hyp(L.x - bestP.x, L.y - bestP.y) < w.def.range) { launchNuke(L, w, null, { x: bestP.x + bestP.vx * 3, y: bestP.y + bestP.vy * 3 }); S.aiNukeT = 45; break; }
      }
    }
  }
}
function pickTarget() {
  const ps = S.stations[0]; if (!ps || ps.dead) return { x: 0, y: 0 };
  const owned = S.ships.filter(s => s.team === 0 && s.def.static && s !== ps);
  // on the solar map, go for the nearest world the player holds most of the time
  const govs = owned.filter(s => s.gov); const st = S.stations[1];
  if (govs.length && st && Math.random() < .6) { const g = govs.sort((a, b) => hyp(a.x - st.x, a.y - st.y) - hyp(b.x - st.x, b.y - st.y))[0]; return { x: g.x, y: g.y }; }
  if (owned.length && Math.random() < .35) { const o = owned[Math.floor(Math.random() * owned.length)]; return { x: o.x, y: o.y }; }
  if (S.time < 300 && Math.random() < .5) { const hs = S.ships.filter(s => s.team === 0 && s.type === 'hauler'); if (hs.length) { const h = hs[Math.floor(Math.random() * hs.length)]; return { x: h.x, y: h.y }; } }
  return { x: ps.x, y: ps.y };
}
