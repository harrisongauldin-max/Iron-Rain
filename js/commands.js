import { S } from './state.js';
import { PI, rand, hyp, clamp } from './util.js';
import { nearestNode, nukesOf, disabled, launchNuke, launchShells, launchPods, recallFighters, launchFighters, isCapital, marker, assignCommander, recallCommander, groupOrder, formationSlots, makeGroup, disbandGroup, FORMATIONS, STANCES, HELMS, hulkAt, brace, threatSide } from './sim.js';
import { FACTIONS } from './data.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';

export function pickAt(wx, wy, filter) {
  let best = null, bd = 1e18;
  for (const s of S.ships) {
    if (s.dead || s.docked) continue;
    if (filter === 'hostile' ? s.team === 0 : (filter != null && s.team !== filter)) continue;
    if (s.team !== 0 && !s.seen) continue;
    const d = hyp(s.x - wx, s.y - wy); const R = Math.max(s.r + 6, 10 / S.cam.z); if (d < R && d < bd) { bd = d; best = s; }
  }
  return best;
}
function nodeAt(wx, wy) { for (const n of S.nodes) if (n.amount > 0 && hyp(n.x - wx, n.y - wy) < n.r + 30) return n; return null; }

// command friction: an order reaches a ship once the flagship's signal has crossed to her. How long depends on the
// navy (the Society's Gold command is quickest, the Republic's slowest), the flagship's bridge, how far she is from it,
// and EMP or a sky that jams the signal. Never less than a fifth of a second, never more than a second and a half.
export function delayOf(s) {
  const F = FACTIONS[S.fac[s.team]] || {}; let d = F.cmdDelay ?? .3;
  const g = s.group && !s.detached ? s.group : null, f = g && g.flag && !g.flag.dead ? g.flag : s;
  if (f.sub) d += (1 - f.sub.bridge) * .5;
  if (f !== s) d += Math.min(.4, hyp(f.x - s.x, f.y - s.y) / 10000);
  if (s.emp > 0) d += .5; if (f !== s && f.emp > 0) d += .3;
  if (S.env && S.env.sight < 1) d += (1 - S.env.sight) * .6;
  return clamp(d, .2, 1.5);
}
export function command(wx, wy, amove, opt = {}) {
  const was = new Map(); for (const s of S.selection) if (!s.def.static) { was.set(s, [s.order, s.engage]); if (s.group) for (const m of s.group.members) if (!was.has(m)) was.set(m, [m.order, m.engage]); }
  commandNow(wx, wy, amove, opt);
  // what changed goes out on the signal; until it lands, each ship carries on with what she was doing
  for (const [s, [o, e]] of was) if (s.order !== o && !s.dead && s.team === 0) { s.pend = { order: s.order, engage: s.engage, at: S.time + delayOf(s) }; s.order = o; s.engage = e; }
}
function commandNow(wx, wy, amove, opt) {
  const sel = S.selection.filter(s => !s.def.static);
  // a queued order (Shift) goes after the ones a ship already has; o.face is the facing on arrival (a right-drag)
  const put = (s, ord) => { const base = s.pend ? s.pend.order : s.order; if (opt.queue && base && ['move', 'amove', 'attack', 'line'].includes(base.type)) { let L = base; while (L.next) L = L.next; L.next = ord; if (!s.pend) return; s.order = s.pend.order; s.pend = null; return; } s.order = ord; };
  const prods = S.selection.filter(s => s.def.producer);
  if (prods.length && !sel.length) {
    const n = nodeAt(wx, wy); for (const p of prods) p.rally = { x: wx, y: wy, node: n }; marker(wx, wy, 0x7ff3ff);
    toast(n ? 'Rally set: new haulers mine this field' : 'Rally point set', ''); return;
  }
  if (!sel.length) return;
  // the whole of one battle group selected: it moves as a unit; anything less detaches the ships given orders
  const gs = new Set(sel.map(s => s.group)); const g = gs.size === 1 ? [...gs][0] : null;
  const whole = g && g.members.every(m => m.dead || sel.includes(m));
  // groups selected whole alongside other ships keep their formation; only partial groups detach
  const wholeGroups = [...gs].filter(G => G && G.flag && !G.flag.dead && G.members.every(m => m.dead || sel.includes(m)));
  for (const s of sel) s.detached = !!s.group && !wholeGroups.includes(s.group);
  const enemy = pickAt(wx, wy, 'hostile'), friend = pickAt(wx, wy, 0), node = nodeAt(wx, wy);
  const depot = friend && friend.def.depot ? friend : null;
  const hk = !enemy && sel.some(s => s.type === 'hauler') ? hulkAt(wx, wy) : null;
  if (hk) { for (const s of sel) if (s.type === 'hauler') s.order = { type: 'salvage', t: hk, phase: 'go' }; marker(hk.x, hk.y, 0x7ff3ff); toast('Haulers moving to strip the wreck of the ' + (hk.title || hk.def.name), ''); sfx('ack'); return; }
  if (enemy && !amove) {
    let shells = 0;
    const hulk = enemy.derelict || enemy.surrendered;
    for (const s of sel) {
      if (s.type === 'hauler') { if (hulk && !enemy.def.static) s.order = { type: 'salvage', t: enemy, phase: 'go' }; continue; }
      if (s.def.boarder && isCapital(enemy)) s.order = { type: 'board', t: enemy };
      else if (s.type === 'tender' || s.type === 'scout') continue;
      else put(s, { type: 'attack', t: enemy, stern: !!opt.stern && !enemy.def.static });
      s.engage = null; s.fstate = 'attack';
    }
    marker(enemy.x, enemy.y, 0xff4b3e); sfx('ack'); if (opt.stern && !enemy.def.static) toast('Attacking from astern: into the drive, where she has no plate', '');
    if (sel.some(s => s.type === 'hauler') && hulk && !enemy.def.static) toast('Haulers moving to strip the ' + enemy.def.name + ' for He-3', '');
    return;
  }
  if (depot && !amove) {
    for (const s of sel) { if (s.type === 'hauler') s.order = { type: 'mine', node: s.order.node || nearestNode(s, 1, s.cargoKind === 'ore' ? 'ore' : 'he'), phase: 'return', dep: depot, ox: rand(-60, 60), oy: rand(-60, 60) }; else s.order = { type: 'rearm', st: depot }; }
    marker(depot.x, depot.y, 0x7ff3ff); sfx('ack'); return;
  }
  if (friend && !friend.def.static && !amove && !sel.includes(friend)) {
    let i = 0;
    for (const s of sel) {
      if ((s.def.fighter || s.def.shell) && friend.h && friend.h[s.type] !== undefined) { s.order = { type: 'dock', t: friend }; s.carrier = friend; i++; continue; }
      const a = PI + (i % 2 ? 1 : -1) * (.6 + .35 * Math.floor(i / 2)); const R = friend.r + s.r + 60 + Math.floor(i / 6) * 60;
      s.order = { type: 'follow', t: friend, ox: Math.cos(a) * R, oy: Math.sin(a) * R }; s.engage = null; i++;
    }
    marker(friend.x, friend.y, 0x3ddc84); toast((sel.every(s => s.order.type === 'dock') ? 'Docking with ' : 'Escorting ') + friend.def.name, ''); sfx('ack'); return;
  }
  if (whole && !node && !(depot && !amove)) { groupOrder(g, amove ? 'amove' : 'move', wx, wy, opt); marker(wx, wy, amove ? 0xff4b3e : 0x3ddc84); sfx('ack'); return; }
  let rest = sel;
  if (wholeGroups.length && !node && !(depot && !amove)) { // each whole group moves as a unit, holding its place relative to the others
    const cx0 = sel.reduce((a, s) => a + s.x, 0) / sel.length, cy0 = sel.reduce((a, s) => a + s.y, 0) / sel.length;
    for (const G of wholeGroups) { const ox = clamp(G.flag.x - cx0, -900, 900), oy = clamp(G.flag.y - cy0, -900, 900); groupOrder(G, amove ? 'amove' : 'move', wx + ox, wy + oy, opt); }
    rest = sel.filter(s => !wholeGroups.includes(s.group));
    if (!rest.length) { marker(wx, wy, amove ? 0xff4b3e : 0x3ddc84); sfx('ack'); return; }
  }
  const haul = rest.filter(s => s.type === 'hauler');
  if (node && haul.length && !amove) { for (const h of haul) h.order = { type: 'mine', node, phase: 'go', ox: rand(-70, 70), oy: rand(-70, 70) }; rest = rest.filter(s => s.type !== 'hauler'); marker(node.x, node.y, 0x7ff3ff); }
  if (!rest.length) { sfx('ack'); return; }
  const cx = rest.reduce((a, s) => a + s.x, 0) / rest.length, cy = rest.reduce((a, s) => a + s.y, 0) / rest.length;
  const dir = opt.face ?? Math.atan2(wy - cy, wx - cx); const px = -Math.sin(dir), py = Math.cos(dir), fx = Math.cos(dir), fy = Math.sin(dir);
  // ad-hoc selections use the chosen formation around the largest ship, all at the slowest ship's pace
  const sorted = [...rest].sort((a, b) => b.r - a.r || a.id - b.id);
  const pace = Math.min(...sorted.filter(s => !s.def.fighter && !s.def.shell).map(s => s.def.cruise), 999) * .95;
  const lead = sorted[0];
  put(lead, { type: amove ? 'amove' : 'move', x: wx, y: wy, cruise: sorted.length > 1 ? pace : undefined, face: opt.face }); lead.engage = null;
  for (const [s, sl] of formationSlots(sorted.slice(1), S.formation || 'wedge', 1, lead.r)) {
    put(s, { type: amove ? 'amove' : 'move', x: wx + fx * sl.x - fy * sl.y, y: wy + fy * sl.x + fx * sl.y, cruise: pace, face: opt.face }); s.engage = null;
  }
  marker(wx, wy, amove ? 0xff4b3e : 0x3ddc84); sfx('ack');
}
export function nukeCommand(wx, wy) {
  const tgt = pickAt(wx, wy, 'hostile'); const pt = { x: wx, y: wy };
  let best = null, bw = null, bd = 1e18;
  for (const s of S.selection) { if (disabled(s)) continue; for (const w of nukesOf(s)) { if (w.ammo < 1 || w.cd > 0) continue; const d = hyp(s.x - wx, s.y - wy); if (d < w.def.range && d < bd) { bd = d; best = s; bw = w; } } }
  if (!best) { toast('No nuclear missile ready within range', 'bad'); sfx('deny'); return; }
  const own = S.ships.filter(o => o.team === 0 && !o.def.static && hyp(o.x - wx, o.y - wy) < 700).length;
  if (own) toast('Warning: ' + own + ' friendly ship' + (own > 1 ? 's' : '') + ' inside the blast radius', 'bad');
  launchNuke(best, bw, tgt, pt); marker(wx, wy, 0xffffff);
}
// the hangars and spitTubes, on order: starShells or leechCraft at an enemy capital ship. They hold station off her hull
// until her shields fall below 25%, then go in. Each carrier within 15,000 km sends enough for the marines she carries
export const LAUNCH_R = 15000;
export function launchAt(kind, wx, wy, ships) {
  const t = pickAt(wx, wy, 'hostile');
  if (!t || !isCapital(t) || t.team === 0) { toast(kind === 'pods' ? 'leechCraft need an enemy capital ship to drill into: click one' : 'starShells board capital ships: click an enemy capital ship', 'bad'); sfx('deny'); return false; }
  const key = kind === 'pods' ? 'boarder' : 'starshell', L = (ships || S.selection).filter(s => s.h && s.h[key] > 0 && !disabled(s));
  const near = L.filter(s => hyp(s.x - t.x, s.y - t.y) < LAUNCH_R);
  if (!near.length) { toast(L.length ? `Too far: carriers must be within ${LAUNCH_R.toLocaleString()} km of the ${t.def.name}` : kind === 'pods' ? 'No leechCraft aboard these ships' : 'No starShells aboard these ships', 'bad'); sfx('deny'); return false; }
  const need = kind === 'pods' ? Math.ceil((t.marines || 0) / 60) + 2 : Math.ceil((t.marines || 0) / 30) + 6; let n = 0;
  for (const s of near) { const k = Math.min(s.h[key], Math.max(kind === 'pods' ? 2 : 6, Math.ceil(need / near.length))); n += kind === 'pods' ? launchPods(s, t, k, true) : launchShells(s, t, k, true); }
  const open = t.sh <= t.def.shield * .25 || t.surrendered;
  toast(`${n} ${kind === 'pods' ? 'leechCraft' + (n > 1 ? 's' : '') : 'starShells'} away at the ${t.title || t.def.name}${open ? ': her shields are down, they go straight in' : ': they hold off her hull until her shields fall below 25%'}`, 'good', t, true);
  marker(t.x, t.y, 0xffb070); sfx('ack'); return true;
}
export function toggleHangars() {
  const cs = S.selection.filter(s => s.h);
  if (!cs.length) { toast('Select a ship with a hangar: Destroyer, torchShip, Dreadnought or moonBreaker', 'bad'); sfx('deny'); return; }
  const toHold = cs.some(c => c.hmode === 'auto');
  for (const c of cs) { c.hmode = toHold ? 'hold' : 'auto'; if (toHold) recallFighters(c); else launchFighters(c, 4); }
  toast(toHold ? 'Hangars on hold · ripWings recalled' : 'Hangars on auto · ripWings launch when enemies close', ''); sfx('ack');
}
export function setAim(k) {
  let n = 0; for (const s of S.selection) if (!s.def.static && s.weapons.length) { s.aimSub = k || null; n++; }
  if (n) { toast(k ? 'Gunners aiming for ' + { eng: 'engines', bridge: 'the bridge', guns: 'weapon mounts', shld: 'shield generators' }[k] : 'Gunners firing at will', ''); sfx('ack'); }
}
export function commanderAction(id, act) {
  const c = S.cmdrs.find(c => c.id === id); if (!c || c.team !== 0 || c.ally) return;
  if (act === 'assign') {
    const ship = S.selection.length === 1 ? S.selection[0] : null;
    if (!ship || !ship.def.cmd) { toast('Select one capital ship (Destroyer or larger) to take a commander', 'bad'); sfx('deny'); return; }
    if (!ship.depot) { toast('The ' + ship.def.name + ' must be at a friendly depot to take a commander aboard', 'bad'); sfx('deny'); return; }
    if (ship.cmdr) { toast('The ' + ship.def.name + ' already has a commander', 'bad'); return; }
    assignCommander(c, ship); sfx('built');
  } else if (act === 'recall') {
    if (!c.ship || !c.ship.depot) { toast('The ship must be at a friendly depot to land her commander', 'bad'); sfx('deny'); return; }
    recallCommander(c); toast(c.name + ' is ashore and ready for a new command', ''); sfx('ack');
  } else if (act === 'locate' && c.ship) { S.cam.x = c.ship.x; S.cam.y = c.ship.y; S.selection = [c.ship]; }
}

// ---------------------------------------------------------------- battle groups
const selGroup = () => { const gs = new Set(S.selection.map(s => s.group)); const g = gs.size === 1 ? [...gs][0] : null; return g && g.members.every(m => m.dead || S.selection.includes(m)) ? g : null; };
export { selGroup };
export function formGroup(n, add) {
  const ships = S.selection.filter(s => !s.def.static && s.team === 0);
  if (!ships.length) { if (!add) { disbandGroup(n); toast('Battle group ' + n + ' disbanded', ''); } return; }
  const g = makeGroup(n, ships, add); if (!g) return;
  toast(`${g.name} (${n}) · ${g.members.length} ship${g.members.length > 1 ? 's' : ''} · flagship ${g.flag.def.name}${g.flag.cmdr ? ' under ' + g.flag.cmdr.name : ''}`, 'good'); sfx('built');
}
export function nextFreeGroup() { for (let n = 1; n <= 9; n++) if (!S.bgroups[n]) return n; return null; }
export function setFormation(k, g) {
  g = g || selGroup();
  if (g) { g.formation = k; } else S.formation = k;
  toast((g ? g.name + ': ' : 'Selection formation: ') + FORMATIONS.find(f => f[0] === k)[1], ''); sfx('ack');
}
export function setStance(k, g) {
  g = g || selGroup(); if (!g) { toast('Stances apply to battle groups · press Ctrl+1–9 to form one', 'bad'); sfx('deny'); return; }
  g.stance = k; const st = STANCES.find(x => x[0] === k);
  toast(g.name + ': ' + st[1] + ' · ' + st[2], ''); sfx('ack');
}
export function setHelm(k, g) {
  g = g || selGroup(); const h = HELMS.find(x => x[0] === k); if (!h) return;
  if (g) g.helm = k; else for (const s of S.selection) if (!s.def.static && s.team === 0) s.helm = k;
  toast((g ? g.name + ' helm: ' : 'Helm: ') + h[1] + ' · ' + h[2], ''); sfx('ack');
}
// brace: each selected ship throws her shield power to the side the threat is on
export function braceSel() {
  let n = 0; for (const s of S.selection) if (s.team === 0 && !s.def.static && brace(s, threatSide(s))) n++;
  if (n) { toast(`Brace: ${n} ship${n > 1 ? 's' : ''} throw shield power to the threatened side for 8 seconds`, ''); sfx('ack'); } else { toast('Nothing selected can brace: frigates and larger, with a shield generator', 'bad'); sfx('deny'); }
}
export function cycle(list, cur) { const i = list.findIndex(x => x[0] === cur); return list[(i + 1) % list.length][0]; }
