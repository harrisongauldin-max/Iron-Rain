// Phase D, agents: spies who sabotage yards, stir up the Colours and steal research; assassins sent after
// commanders; Peerless champions who ride with a fleet. Each power names its own: the Republic runs Sons of Ares
// cells, the Remnant its Gray operatives, the Rim the Krypteia of House Raa.
import { C, note, hostile, BLOC_NAME, CAPITAL, fleetsAt, travel } from './camp.js';
import * as CM from './command.js';
import * as TE from './tech.js';
import * as EC from './economy.js';
import { bodyOf } from './solar.js';
import * as P from './politics.js';
import * as RU from './rulers.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v, pickOne = a => a[Math.floor(rnd() * a.length)];
const nm = id => bodyOf(id).name;
export const TYPES = {
  spy:      { name: { rep: 'Sons of Ares cell', soc: 'Gray operative', rim: 'Krypteia agent' }, cost: { inf: 40, he: 300 }, max: 3, desc: 'Sabotages yards and buildings, stirs up a world’s Colours, steals research, or guards a world against enemy agents' },
  assassin: { name: { rep: 'Howler assassin', soc: 'Gray assassin', rim: 'Krypteia blade' }, cost: { inf: 60, he: 500 }, max: 2, desc: 'Sent after an enemy commander at a world: wounds or kills' },
  champion: { name: { rep: 'Peerless champion', soc: 'Peerless champion', rim: 'Storm Knight’s champion' }, cost: { inf: 50, he: 400 }, max: 2, desc: 'Rides with a fleet: +8% strength when auto-resolved and +15% to its Iron Rains. May fall when the fleet loses' },
};
export const MISSIONS = {
  sabotage: { type: 'spy', name: 'Sabotage', desc: 'Set the yards back three weeks, or wreck a building', target: 'enemy' },
  incite:   { type: 'spy', name: 'Incite', desc: 'Stir up the lowColors (or, for the Remnant, the Golds and Coppers) against their masters', target: 'enemy' },
  steal:    { type: 'spy', name: 'Steal research', desc: 'Copy the Greens’ data vaults: research for your own fields', target: 'enemy' },
  watch:    { type: 'spy', name: 'Watch the yards', desc: 'Sit in an enemy world’s docks and report its fleets: every fleet there, and where each one that leaves is bound. Each week there is a risk of being caught', target: 'enemy' },
  guard:    { type: 'spy', name: 'Counter-intelligence', desc: 'Watch a world of your own: enemy agents there are likelier to fail and be caught', target: 'own' },
  kill:     { type: 'assassin', name: 'Assassinate', desc: 'Strike at the commander of an enemy fleet in orbit', target: 'cmdr' },
  network:  { type: 'spy', name: 'Build a network', desc: 'Settle into a rival realm’s courts and docks, at war or at peace, and build a network there week by week. At 50% you read their court and see their fleets near their worlds; at 80% your spies can turn a House, blackmail an officer, kidnap an heir or rescue a prisoner. Each week there is a risk of exposure', target: 'realm' },
  turn:     { type: 'spy', name: 'Turn a House', desc: 'Needs an 80% network. Push one of their Houses or blocs toward betrayal: its satisfaction −25, and if it breaks it comes over to you', target: 'net', need: 80 },
  blackmail:{ type: 'spy', name: 'Blackmail an officer', desc: 'Needs an 80% network. Find what an officer of theirs would hide: their loyalty falls, and if they defect, they come to you. The secret may come out', target: 'net', need: 80 },
  kidnap:   { type: 'spy', name: 'Kidnap an heir', desc: 'Needs an 80% network. Take their heir from court: a prisoner worth a ruler’s ransom, and war score while you hold them', target: 'net', need: 80 },
  rescue:   { type: 'spy', name: 'Rescue a prisoner', desc: 'Needs an 80% network. Bring one of your officers, or your ruler, out of their cells', target: 'net', need: 80 },
};
// ---------------------------------------------------------------- networks
// C.net[f][o]: how deep power f's network runs in realm o, 0 to 100
export const NET_READ = 50, NET_ACT = 80;
export const netOf = (f, o) => (C.net && C.net[f] && C.net[f][o]) || 0;
const addNet = (f, o, v) => { if (!C.net || f === o || !C.net[f] || !(o in C.net[f])) return; C.net[f][o] = clamp(C.net[f][o] + v, 0, 100); };
// how fast a network grows this week, part by part
export function netParts(f, o) {
  const P0 = [], here = (C.agents || []).filter(a => a.owner === f && a.state === 'busy' && a.realm === o && !(a.left > 0));
  for (const a of here) if (a.mission === 'network') P0.push([`${a.name} (skill ${a.skill})`, 1.5 + 1.5 * a.skill]); else if (a.mission === 'watch') P0.push([`${a.name}, watching the docks`, 1]);
  if (!here.length) P0.push(['No agent in place: the network withers', -1]);
  if (here.length && RU.hasTrait(f, 'cunning')) P0.push(['A cunning ruler', Math.round(P0.reduce((x, p) => x + Math.max(0, p[1]), 0) * .3)]);
  const g = (C.agents || []).filter(a => a.owner === o && a.mission === 'guard' && a.state === 'busy').length; if (g && here.length) P0.push([`Their counter-intelligence (${g})`, -2 * g]);
  return P0;
}
// what a network at 50% shows: does f see fleet fl because of it?
export const netSees = (f, fl) => { if (!C.net || !C.net[f]) return false; const ws = [fl.at, fl.transit && fl.transit.to, fl.transit && fl.transit.from].filter(Boolean); return ws.some(id => C.worlds[id] && C.worlds[id].owner !== f && netOf(f, C.worlds[id].owner) >= NET_READ); };
// exposure: a diplomatic incident
function exposed(a, o, what) {
  addNet(a.owner, o, -15); P.addOpinion(o, a.owner, 'spy', `Their spies caught ${what}`, -20, .4);
  if (o === C.player) note(`Our people catch an agent of ${BLOC_NAME[a.owner]} ${what}. The court demands an answer.`, 'good', CAPITAL[o]);
  else if (a.owner === C.player) note(`${TYPES[a.type].name[a.owner]} ${a.name} is exposed ${what}: a diplomatic incident with ${BLOC_NAME[o]}.`, 'bad', CAPITAL[o], { title: 'A spy exposed', kind: 'war' });
  C.incidents = (C.incidents || 0) + 1;
}
const FIRST = ['Ari', 'Kell', 'Tam', 'Vel', 'Oro', 'Jun', 'Mira', 'Dace', 'Lyn', 'Sol', 'Ren', 'Hask', 'Ivo', 'Nyx'];
export function setupAgents() { C.agents = []; C.net = {}; for (const f of ['rep', 'soc', 'rim']) C.net[f] = Object.fromEntries(['rep', 'soc', 'rim'].filter(o => o !== f).map(o => [o, 0])); }
export const agentsOf = f => (C.agents || []).filter(a => a.owner === f && a.state !== 'dead');
export function recruit(f, type) {
  const T = TYPES[type], r = C.fac[f].res; if (!T) return 'cannot';
  if (agentsOf(f).filter(a => a.type === type).length >= T.max) return `at most ${T.max}`;
  if (r.inf < T.cost.inf || r.he < T.cost.he) return `costs ${T.cost.inf} influence and ${T.cost.he} He-3`;
  r.inf -= T.cost.inf; r.he -= T.cost.he;
  const a = { id: C.nid++, owner: f, type, name: `${pickOne(FIRST)}${type === 'champion' ? ' au ' + pickOne(['Lux', 'Grimmus', 'Telemanus', 'Raa', 'Votum', 'Arcos']) : ''}`, skill: 1, state: 'idle', at: CAPITAL[f], mission: null, left: 0, target: null, fleet: null };
  C.agents.push(a); if (f === C.player) note(`A new ${T.name[f]} is ready: ${a.name}.`, 'good'); return a;
}
export function send(a, mission, target) {
  if (!a || a.state === 'dead' || a.state === 'busy') return 'cannot';
  const M = MISSIONS[mission]; if (!M || M.type !== a.type) return 'cannot';
  const home = C.worlds[CAPITAL[a.owner]] && C.worlds[CAPITAL[a.owner]].owner === a.owner ? CAPITAL[a.owner] : (Object.keys(C.worlds).find(id => C.worlds[id].owner === a.owner) || target);
  const wid = target && (target.w || target), w = C.worlds[wid]; if (!w) return 'no target';
  if (M.target === 'realm' && (w.owner === a.owner || w.owner === 'neu')) return 'a rival power’s world';
  if (M.need && netOf(a.owner, w.owner) < M.need) return `needs a ${M.need}% network in ${BLOC_NAME[w.owner]}`;
  a.state = 'busy'; a.mission = mission; a.target = target; a.realm = w.owner; a.left = mission === 'guard' ? 0 : Math.max(1, Math.ceil(travel(home, wid) / 2)) + 1; a.fleet = null;
  return null;
}
export function attach(a, fl) { if (!a || !fl || a.type !== 'champion' || a.state === 'dead' || fl.owner !== a.owner) return 'cannot'; for (const x of C.agents) if (x.fleet === fl.id && x !== a) { x.fleet = null; x.state = 'idle'; } a.fleet = fl.id; a.state = 'riding'; return null; }
export function recall(a) { a.state = 'idle'; a.mission = null; a.target = null; a.fleet = null; }
export const championOf = fl => (C.agents || []).find(a => a.fleet === fl.id && a.state === 'riding');
export const fleetMul = fl => championOf(fl) ? 1.08 : 1;
export const rainMul = fl => championOf(fl) ? 1.15 : 1;
// how hard a world is to work in: guards, fortresses, a capital's security
const defence = (wid, foe) => { const w = C.worlds[wid]; return .08 * C.agents.filter(a => a.owner === w.owner && a.mission === 'guard' && a.target === wid && a.state === 'busy').length + .05 * (w.lv.fort || 0) + (wid === CAPITAL[w.owner] ? .12 : 0) - (RU.hasTrait(foe, 'cunning') ? .08 : 0); };
// the work an 80% network makes possible
function resolveHigh(a) {
  const f = a.owner, o = a.realm, wid = a.target.w, x = a.target.x, mine = f === C.player, T = TYPES.spy.name[f];
  const p = clamp(.4 + .1 * a.skill + (netOf(f, o) - NET_ACT) / 100 - defence(wid, f), .1, .85), ok = rnd() < p; addNet(f, o, -30); C.spyTry = C.spyTry || {}; C.spyTry[a.mission0] = (C.spyTry[a.mission0] || 0) + 1;
  a.state = 'idle'; a.mission = null; a.target = null;
  if (!ok) { if (rnd() < .5) { a.state = 'dead'; exposed(a, o, { turn: 'trying to turn a House', blackmail: 'with a blackmailer’s files', kidnap: 'in a kidnapping gone wrong', rescue: 'at the prison gates' }[a.mission0] || 'at work'); } else if (mine) note(`${T} ${a.name} could not get it done in ${BLOC_NAME[o]}, and slips away.`, 'bad'); return; }
  a.skill = Math.min(3, a.skill + 1); C.spyOps = C.spyOps || {}; C.spyOps[a.mission0] = (C.spyOps[a.mission0] || 0) + 1;
  if (a.mission0 === 'turn') { const g = P.groupsOf(o).find(y => y.id === x); if (g) { g.sat = clamp(g.sat - 25, 0, 100); g.turnedBy = f; g.turnedT = C.turn; } if (mine || o === C.player) note(mine ? `${T} ${a.name} has turned ${P.defOf(o, x).name}: it leans toward betrayal, and toward us.` : `${P.defOf(o, x).name} grows cold to us: someone is at work in our court.`, mine ? 'good' : 'bad', CAPITAL[o]); }
  if (a.mission0 === 'blackmail') { const c = RU.cById(x); if (c && c.owner === o && c.state !== 'dead') { c.turnTo = f; c.loyalty = Math.max(0, c.loyalty - 15); C.secrets = C.secrets || []; C.secrets.push({ k: 'blackmail', f: o, by: f, cid: c.id, at: C.turn + 10 + Math.floor(rnd() * 10) }); if (mine) note(`${T} ${a.name} has a hold over ${c.name}. If they ever go over, they will come to us.`, 'good'); } }
  if (a.mission0 === 'kidnap') { const c = RU.cById(x); if (c && c.owner === o && ['court', 'pool', 'gov'].includes(c.state)) { if (c.state === 'gov') { c.region = null; } CM.capture(c, null, f, nm(wid)); P.addOpinion(o, f, 'kidnap', `Kidnapped ${c.name}`, -40, .3); } }
  if (a.mission0 === 'rescue') { const c = RU.cById(x); if (c && c.owner === f && c.state === 'captured' && c.captor === o) { if (RU.isRoyal(c)) RU.freed(c); else { c.state = 'pool'; c.captor = null; } note(`${T} ${a.name} brings ${c.name} out of the cells of ${BLOC_NAME[o]}.`, mine ? 'good' : o === C.player ? 'bad' : '', CAPITAL[f]); P.addOpinion(o, f, 'rescue', 'Broke our prisoners out', -15, .3); } }
}
function resolve(a) {
  const f = a.owner, mine = f === C.player, wid = a.target.w || a.target, w = C.worlds[wid];
  const p = clamp(.5 + .12 * (a.skill - 1) - defence(wid, f), .1, .9), ok = rnd() < p, T = TYPES[a.type].name[f];
  const victim = w.owner;
  if (!ok) {
    const caught = rnd() < .5;
    if (caught) { a.state = 'dead'; P.addOpinion(victim, f, 'spy', 'Their spies caught at work', -10, .4); if (mine) note(`${T} ${a.name} was caught on ${nm(wid)} and executed.`, 'bad', wid); else if (victim === C.player) note(`Our people on ${nm(wid)} caught an enemy agent of ${BLOC_NAME[f]}.`, 'good', wid); }
    else { a.state = 'idle'; if (mine) note(`${T} ${a.name} failed on ${nm(wid)} and slipped away.`, 'bad', wid); }
    return;
  }
  a.skill = Math.min(3, a.skill + (rnd() < .4 ? 1 : 0)); a.state = 'idle'; if (victim !== 'neu') addNet(f, victim, 3);
  if (a.mission === 'sabotage') {
    if (w.sq.length) { w.sq[0].left += 3; if (mine || victim === C.player) note(`Sabotage on ${nm(wid)}: the yards are set back three weeks.`, mine ? 'good' : 'bad', wid); }
    else { const ks = Object.keys(w.lv).filter(k => w.lv[k] > 0 && k !== 'yard'); if (ks.length) { const k = pickOne(ks); w.lv[k]--; if (k === 'grid') w.gun = Math.max(0, w.gun - 1); if (k === 'array') w.shield = Math.max(0, w.shield - 1); } if (mine || victim === C.player) note(`Sabotage on ${nm(wid)}: a building is wrecked.`, mine ? 'good' : 'bad', wid); }
  } else if (a.mission === 'incite') {
    if (w.cl) { const es = f === 'soc' ? ['gold', 'mid'] : ['red', 'war']; for (const e of es) w.cl[e] = clamp(w.cl[e] - 18, 0, 100); EC.syncLoy(w); }
    if (mine || victim === C.player) note(`Agitators stir up ${nm(wid)}: its ${f === 'soc' ? 'Golds and Coppers' : 'lowColors and soldiers'} turn against ${BLOC_NAME[victim]}.`, mine ? 'good' : 'bad', wid);
  } else if (a.mission === 'steal') {
    const g = 25 + 15 * a.skill; TE.grant(f, g); if (mine) note(`${T} ${a.name} copies the data vaults of ${nm(wid)}: +${g} research.`, 'good', wid);
  } else if (a.mission === 'kill') {
    const fl = fleetsAt(wid).find(x => hostile(f, x.owner) && CM.cmdrOf(x)); const c = fl && CM.cmdrOf(fl);
    if (!c) { if (mine) note(`${T} ${a.name} found no enemy commander at ${nm(wid)}.`, '', wid); return; }
    if (rnd() < (c.talents.includes('peerless') ? .25 : .45)) CM.kill(c, fl, `${c.name} is assassinated at ${nm(wid)}.`); else CM.wound(c, fl, nm(wid));
    if (mine) note(`${T} ${a.name} strikes at ${c.name} at ${nm(wid)}.`, 'good', wid);
  }
  a.mission = null; a.target = null;
}
export function tick() {
  if (!C.agents) return;
  for (const a of C.agents) {
    if (!C.fac[a.owner] || !C.fac[a.owner].alive) { a.state = 'dead'; continue; }
    if (a.state === 'riding' && !C.fleets.some(x => x.id === a.fleet && x.owner === a.owner)) recall(a);
    if (a.state === 'busy' && a.mission === 'guard' && C.worlds[a.target] && C.worlds[a.target].owner !== a.owner) { recall(a); continue; }
    if (a.state !== 'busy' || a.mission === 'guard') continue;
    // a network agent travels to the realm, then works there until exposed or called home
    if (a.mission === 'network') { const w = C.worlds[a.target]; if (!w || w.owner !== a.realm) { recall(a); continue; }
      if (a.left > 0) { a.left--; continue; }
      if (rnd() < clamp(.006 + defence(a.target, a.owner) * .15 - .003 * (a.skill - 1), .004, .12)) { a.state = 'dead'; exposed(a, a.realm, 'running a network'); }
      else if (rnd() < .05) a.skill = Math.min(3, a.skill + 1);
      continue; }
    if (MISSIONS[a.mission] && MISSIONS[a.mission].need) { const w = C.worlds[a.target.w]; if (!w || w.owner !== a.realm) { recall(a); continue; } if (--a.left <= 0) { a.mission0 = a.mission; resolveHigh(a); } continue; }
    // a watcher travels to the world, then stays in its docks until caught or called home
    if (a.mission === 'watch') { const w = C.worlds[a.target]; if (!w || !hostile(a.owner, w.owner)) { recall(a); continue; }
      if (a.left > 0) { a.left--; continue; }
      if (rnd() < clamp(.03 + defence(a.target, a.owner) * .5 - .01 * (a.skill - 1), .01, .2)) { a.state = 'dead'; if (a.owner === C.player) note(`${TYPES.spy.name[a.owner]} ${a.name} is caught watching the docks of ${nm(a.target)}.`, 'bad', a.target); else if (w.owner === C.player) note(`Our people on ${nm(a.target)} caught an enemy agent watching the docks.`, 'good', a.target); }
      continue; }
    const wid = a.target.w || a.target; if (!C.worlds[wid] || (a.mission === 'kill' ? !fleetsAt(wid).some(x => hostile(a.owner, x.owner) && CM.cmdrOf(x)) : a.mission !== 'guard' && !hostile(a.owner, C.worlds[wid].owner))) { recall(a); continue; }
    if (--a.left <= 0) resolve(a);
  }
  C.agents = C.agents.filter(a => a.state !== 'dead');
  // networks grow where agents work, and wither where none do
  for (const f in C.net || {}) for (const o in C.net[f]) { if (!C.fac[f].alive || !C.fac[o].alive) { C.net[f][o] = 0; continue; } addNet(f, o, netParts(f, o).reduce((x, p) => x + p[1], 0)); }
}
// a lost battle may take the champion riding with the fleet
export function battleLost(fl) { const a = championOf(fl); if (a && rnd() < .25) { a.state = 'dead'; if (a.owner === C.player) note(`The champion ${a.name} fell with ${fl.name}.`, 'bad'); } }
// the AI's shadows, as its ruler would run them: networks in the realm it fears most, watchers on enemy yards,
// guards at home when enemy agents are about, assassins for the reckless and the ruthless, and the work of an 80% network
export function aiAgents(f) {
  const r = C.fac[f].res, D = RU.docOf(f), mix = D.agents, POW = ['rep', 'soc', 'rim'];
  const rivals = POW.filter(o => o !== f && C.fac[o].alive); if (!rivals.length) return;
  const foes = rivals.filter(o => hostile(f, o)), str = o => C.fleets.filter(x => x.owner === o).reduce((a, x) => a + x.ships.length, 0);
  const main = (foes.length ? foes : rivals).slice().sort((a, b) => (str(b) - P.opinionOf(f, b) * 2) - (str(a) - P.opinionOf(f, a) * 2))[0];
  const rich = r.inf >= 75, nSpy = agentsOf(f).filter(a => a.type === 'spy').length, nAs = agentsOf(f).filter(a => a.type === 'assassin').length;
  if (rich && rnd() < .25 && nSpy < (mix.spy + mix.watch + mix.guard >= .9 ? 3 : 2)) recruit(f, 'spy');
  if (rich && foes.length && mix.assassin > 0 && rnd() < .1 + .2 * mix.assassin && nAs < (mix.assassin >= .4 ? 2 : 1)) recruit(f, 'assassin');
  if (rich && foes.length && rnd() < .1 && agentsOf(f).filter(a => a.type === 'champion').length < 1) { const a = recruit(f, 'champion'); const fl = C.fleets.filter(x => x.owner === f).sort((x, y) => y.ships.length - x.ships.length)[0]; if (a && a.id && fl) attach(a, fl); }
  const hostileHere = (C.agents || []).filter(a => a.owner !== f && a.state === 'busy' && a.realm === f).length;
  const capOf = o => C.worlds[CAPITAL[o]] && C.worlds[CAPITAL[o]].owner === o ? CAPITAL[o] : (Object.keys(C.worlds).find(id => C.worlds[id].owner === o));
  for (const a of agentsOf(f)) {
    if (a.state !== 'idle') continue;
    if (a.type === 'assassin') {
      const L = C.fleets.filter(x => x.at && foes.includes(x.owner) && CM.cmdrOf(x) && travel(CAPITAL[f], x.at) <= 7).sort((x, y) => CM.cmdrOf(y).rank - CM.cmdrOf(x).rank);
      if (L[0]) send(a, 'kill', L[0].at); continue;
    }
    if (a.type !== 'spy') continue;
    // the work of a deep network first
    const deep = rivals.filter(o => netOf(f, o) >= NET_ACT).sort((x, y) => (y === main) - (x === main))[0];
    if (deep && rnd() < .6) { const w = capOf(deep), opts = [];
      const pr = C.cmdrs.find(c => c.owner === f && c.state === 'captured' && c.captor === deep && (RU.isRoyal(c) || c.rank >= 2)); if (pr) opts.push(['rescue', pr.id, 3]);
      const h = RU.heirOf(deep); if (h && ['court', 'pool'].includes(h.state) && foes.includes(deep)) opts.push(['kidnap', h.id, 2]);
      const g = P.groupsOf(deep).slice().sort((x, y) => (P.defOf(deep, y.id).seat && P.defOf(deep, y.id).seat !== CAPITAL[deep] ? 30 : 0) - (P.defOf(deep, x.id).seat && P.defOf(deep, x.id).seat !== CAPITAL[deep] ? 30 : 0) + x.sat - y.sat)[0]; if (g) opts.push(['turn', g.id, foes.includes(deep) ? 1.5 : .8]);
      const o = C.cmdrs.filter(c => c.owner === deep && c.state === 'fleet' && !RU.isRoyal(c) && c.rank >= 1 && !c.turnTo).sort((x, y) => x.loyalty - y.loyalty)[0]; if (o && o.loyalty < 65) opts.push(['blackmail', o.id, 1.2]);
      let pick = null, tw = opts.reduce((x0, o0) => x0 + o0[2], 0) * rnd(); for (const o0 of opts) if ((tw -= o0[2]) <= 0) { pick = o0; break; } if (w && pick && !send(a, pick[0], { w, x: pick[1] })) continue; }
    const W = [['network', netOf(f, main) < NET_ACT + 10 ? mix.spy + .2 : .05], ['watch', foes.length ? mix.watch : 0], ['guard', mix.guard + (hostileHere ? .4 : 0)], ['work', foes.length ? .3 : 0]];
    let x = rnd() * W.reduce((s0, w0) => s0 + w0[1], 0), k = W[0][0]; for (const [kk, v] of W) { if ((x -= v) <= 0) { k = kk; break; } }
    if (k === 'network') { const ws = Object.values(C.worlds).filter(w => w.owner === main && w.id !== CAPITAL[main] && !w.lv.fort), w = ws.length ? pickOne(ws).id : capOf(main); if (w && !send(a, 'network', w)) continue; }
    if (k === 'watch') { const ws = Object.values(C.worlds).filter(w => foes.includes(w.owner) && w.lv.yard).sort((x0, y0) => travel(CAPITAL[f], x0.id) - travel(CAPITAL[f], y0.id)); if (ws[0] && !send(a, 'watch', ws[0].id)) continue; }
    if (k === 'guard') { const ws = Object.values(C.worlds).filter(w => w.owner === f).sort((x0, y0) => (y0.id === CAPITAL[f]) - (x0.id === CAPITAL[f]) || y0.lv.yard - x0.lv.yard); if (ws[0] && !send(a, 'guard', ws[0].id)) continue; }
    const ws = Object.values(C.worlds).filter(w => foes.includes(w.owner)); if (!ws.length) continue;
    const w = pickOne(ws.sort((x0, y0) => travel(CAPITAL[f], x0.id) - travel(CAPITAL[f], y0.id)).slice(0, 4));
    send(a, w.sq.length || w.lv.yard ? 'sabotage' : rnd() < .5 ? 'incite' : 'steal', w.id);
  }
  // a guard with nothing to guard against goes back to work, now and then
  for (const a of agentsOf(f)) if (a.mission === 'guard' && a.state === 'busy' && !hostileHere && mix.guard < .3 && rnd() < .05) recall(a);
}
