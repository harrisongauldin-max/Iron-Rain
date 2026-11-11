// What a conqueror does with a world it takes, and with the crews that strike their colours to it; and the deeds
// only one power can do: the Rim's raids, the Remnant's House levies, the Republic's Sons of Ares risings.
// Pure rules, no DOM. The strategic view asks the player; the AI decides by its ruler's doctrine (rulers.js AI_DOC).
import { C, note, chron, BLOC_NAME, CAPITAL, fleet, fleetsAt, hostile, relOf, garrisonCap, BUILD, travel, fleetStr, defStr, moveFleet, yieldOf, human } from './camp.js';
import { bodyOf } from './solar.js';
import * as P from './politics.js';
import * as EC from './economy.js';
import * as RU from './rulers.js';
import * as CM from './command.js';
import * as IN from './intel.js';
import * as SR from './starts.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const nm = id => bodyOf(id).name;
const POW = ['rep', 'soc', 'rim'];

// ---------------------------------------------------------------- a world taken
export const TAKE = {
  occupy:   { name: 'Occupy', desc: 'Hold it as it stands: its buildings and yields are yours, its people sullen for a while.' },
  sack:     { name: 'Sack', desc: 'Strip its finest building a level for ore, alloys and He-3. Its people will hate you: loyalty starts near 10. Its old masters, and every court that hears of it, think the worse of you.' },
  liberate: { f: 'rep', name: 'Liberate', desc: 'Free it as a client world of the Republic under its own council. It raises Free Legions (a garrison, and manpower each week) and the Reds everywhere rejoice, but it keeps most of its yields for itself (the Republic takes a third).' },
  fief:     { f: 'soc', name: 'Grant as a fief', desc: 'Give it to a great House of the Remnant to rule. The House is the happier for it, but a fief pays only six-tenths of its yields to Venus.' },
  hostage:  { f: 'rim', name: 'Take hostages', desc: 'Send the children of its Golds to Io as guests. It cannot revolt for sixteen weeks, but the Moon Lords of honour mislike it, and its old masters will not forget.' },
};
export const takeOpts = f => Object.keys(TAKE).filter(k => (!TAKE[k].f || TAKE[k].f === f) && !(k === 'sack' && f === C.player && SR.rule('storm'))); /* the Storm Knight does not sack */
const SACK_ORDER = ['yard', 'foundry', 'arsenal', 'grid', 'array', 'fort', 'court', 'lab', 'mine', 'skimmer', 'barracks', 'farms'];
export const sackTarget = w => SACK_ORDER.find(k => (w.lv[k] || 0) > 0) || null;
export function sackLoot(w) {
  const k = sackTarget(w), B = k ? BUILD[k] : { ore: 0, he: 0 }, X = k ? EC.BLD[k] || {} : {}, prod = (EC.popOf(w.id) || 5);
  return { k, ore: Math.round(220 + B.ore * 1.4 + prod * 6), alloy: Math.round(40 + (X.alloy || 0) * 1.6 + (k === 'foundry' || k === 'yard' ? 60 : 0)), he: Math.round(180 + B.he * 1.3 + prod * 5) };
}
// the House a fief goes to: the unhappiest one, unless the player chose
export const fiefHouse = () => { const G = P.groupsOf('soc').slice().sort((a, b) => a.sat - b.sat); return G[0] ? G[0].id : null; };
// what the AI does with what it takes: its ruler's doctrine, and its own customs
export function aiTake(f, w) {
  const D = RU.docOf(f), k = D.take || 'occupy';
  if (k === 'sack') return 'sack';
  if (f === 'rep' && (w.home === 'rep' || w.home === 'neu' || EC.mixOf(w.id).red > .3) && rnd() < .55) return 'liberate';
  if (f === 'soc' && P.groupsOf('soc').some(g => g.sat < 40) && rnd() < .6) return 'fief';
  if (f === 'rim' && w.home !== 'rim' && rnd() < (RU.hasTrait('rim', 'honour') ? .15 : .5)) return 'hostage';
  if (k === 'special') return { rep: 'liberate', soc: 'fief', rim: 'hostage' }[f] || 'occupy';
  return 'occupy';
}
// every capture by a power comes here: the player is asked, the AI decides
export function onTaken(w, by, old, how) {
  if (!C.fac[by] || by === 'neu' || w.owner !== by) return;
  if (human(by)) { (C.takePend = C.takePend || []).push({ w: w.id, old, how, t: C.turn }); return; }
  applyTake(w, by, aiTake(by, w), old);
}
export function applyTake(w, by, k, old, gid) {
  if (!w || w.owner !== by || !TAKE[k] || (TAKE[k].f && TAKE[k].f !== by)) return 'cannot';
  const n = nm(w.id), r = C.fac[by].res, me = by === C.player;
  w.took = { k, t: C.turn, by };
  if (k === 'sack') {
    const L = sackLoot(w); if (L.k) { w.lv[L.k]--; if (L.k === 'grid') w.gun = Math.max(0, w.gun - 1); if (L.k === 'array') w.shield = Math.max(0, w.shield - 1); }
    r.ore += L.ore; r.alloy = (r.alloy || 0) + L.alloy; r.he += L.he;
    if (w.cl) for (const e in w.cl) w.cl[e] = clamp(8 + rnd() * 5, 0, 100); EC.syncLoy(w); w.sacked = C.turn + 24;
    if (old && old !== 'neu' && P.addOpinion) P.addOpinion(old, by, 'sack', 'Sacked our worlds', -14, .15, 45);
    for (const o of POW) if (o !== by && o !== old && C.fac[o].alive) P.addOpinion(o, by, 'sackx', 'Sacks the worlds it takes', -4, .1, 20);
    P.react(by, 'bombard', .7);
    note(`${n} is sacked: ${L.k ? BUILD[L.k].name + ' torn down, ' : ''}+${L.ore} ore, +${L.alloy} alloys, +${L.he} He-3 carried off. Its people will not forgive it.`, me ? 'gold' : old === C.player ? 'bad' : '', w.id);
    chron('world', `${BLOC_NAME[by]} sacks ${n}.`, w.id, by);
  } else if (k === 'liberate') {
    w.client = true; w.fief = null; w.garrison = Math.round(Math.min(garrisonCap(w) * 1.3, w.garrison + 2500)); r.man += 3000;
    if (w.cl) { for (const e in w.cl) w.cl[e] = clamp(w.cl[e] + 15, 0, 100); w.cl.red = clamp(Math.max(w.cl.red, 85), 0, 100); EC.syncLoy(w); }
    P.nudge('rep', 'vox', 8); P.nudge('rep', 'mod', -2); for (const x of Object.values(C.worlds)) if (x.owner === 'rep' && x.cl && x !== w) { x.cl.red = clamp(x.cl.red + 3, 0, 100); EC.syncLoy(x); }
    note(`${n} is liberated: a free world under its own council, a client of the Republic. The Free Legions muster (+2,500 garrison, +3,000 manpower) and the Reds rejoice.`, me ? 'good' : old === C.player ? 'bad' : '', w.id);
    chron('world', `The Republic frees ${n} as a client world.`, w.id, by);
  } else if (k === 'fief') {
    const g = gid || fiefHouse(), D = P.defOf('soc', g); if (!D) return 'no House';
    w.fief = g; w.client = false; P.nudge('soc', g, 14); for (const x of P.groupsOf('soc')) if (x.id !== g) x.sat = clamp(x.sat - 1, 0, 100);
    if (w.cl) { w.cl.gold = clamp(w.cl.gold + 12, 0, 100); w.cl.war = clamp(w.cl.war + 6, 0, 100); EC.syncLoy(w); }
    note(`${n} is granted as a fief to ${D.name}. The House is pleased; the fief pays six-tenths of its yields to Venus.`, me ? 'good' : '', w.id);
    chron('world', `${n} is granted to ${D.name}.`, w.id, by);
  } else if (k === 'hostage') {
    w.hostage = C.turn + 16; if (w.cl) { w.cl.gold = clamp(w.cl.gold + 8, 0, 100); EC.syncLoy(w); }
    P.nudge('rim', 'raa', -4); P.nudge('rim', 'norvo', -2); P.nudge('rim', 'lux', 3); P.nudge('rim', 'callisto', 2);
    if (old && old !== 'neu') P.addOpinion(old, by, 'hostage', 'Holds our children hostage', -8, .1, 30);
    note(`Hostages from ${n} are sent to Io as guests of the Dominion: it will not rise against the Rim for sixteen weeks.`, me ? 'gold' : '', w.id);
  }
  return null;
}
// the taking's effect on yields: a client world keeps most of its own, a fief pays the House first
export const yieldShare = w => w.client ? { all: .33, man: 1 } : w.fief ? { all: .6, man: .8 } : null;

// ---------------------------------------------------------------- crews that struck their colours
export const CREWS = {
  press: { name: 'Press them into service', desc: 'Put the struck crews to work at the guns of their own ships, under guard: the prize hulls are crewed to a third.' },
  exchange: { name: 'Exchange them', desc: 'Trade them back for our own crews in enemy hands: manpower comes home.' },
  ransom: { name: 'Ransom them', desc: 'Let their Houses and families buy them back: influence.' },
  space: { name: 'Space them', desc: 'Out of the airlocks, in sight of their fleet. Their crews will break sooner against us for twelve weeks; every court thinks the worse of us.' },
};
export const crewValue = p => ({ man: Math.round(p.crew * .45), inf: Math.round(6 + p.n * 5) });
// p: { n, crew, foe, ids: [prize ship ids], by }
export function onStruck(p) {
  if (!p || !p.n) return;
  if (human(p.by)) { C.crewPend = p; return; }
  const D = RU.docOf(p.by); applyCrews(p, D.crews || 'press');
}
export function applyCrews(p, k) {
  const r = C.fac[p.by] && C.fac[p.by].res, v = crewValue(p), me = p.by === C.player; if (!r || !CREWS[k]) return;
  const ships = C.fleets.flatMap(f => f.owner === p.by ? f.ships : []).filter(s => (p.ids || []).includes(s.id));
  if (k === 'press') for (const s of ships) s.crew = Math.max(s.crew, .33);
  else if (k === 'exchange') r.man += v.man;
  else if (k === 'ransom') r.inf += v.inf;
  else if (k === 'space') {
    C.fear = C.fear || {}; C.fear[p.foe + '>' + p.by] = C.turn + 12;
    if (p.foe !== 'neu') P.addOpinion(p.foe, p.by, 'spaced', 'Spaced our crews', -16, .15, 50);
    for (const o of POW) if (o !== p.by && o !== p.foe && C.fac[o].alive) P.addOpinion(o, p.by, 'spacedx', 'Spaces prisoners', -5, .1, 20);
    P.react(p.by, 'bombard', .8);
  }
  const what = { press: `pressed into service aboard the prizes`, exchange: `exchanged: +${v.man.toLocaleString()} manpower comes home`, ransom: `ransomed to their Houses: +${v.inf} influence`, space: `spaced, in sight of their fleet. ${BLOC_NAME[p.foe]}'s crews will remember it` }[k];
  note(`The crews of ${p.n} struck ship${p.n > 1 ? 's' : ''} are ${what}.`, me ? (k === 'space' ? 'bad' : 'gold') : p.foe === C.player ? (k === 'space' ? 'bad' : '') : '', null);
}
// a side's crews are afraid of a foe who spaces prisoners: their loyalty in battle is shaken
export const fears = (o, of) => !!(C.fear && C.fear[o + '>' + of] > C.turn);

// ---------------------------------------------------------------- the Rim: raids
export const RAID_REACH = 5;
export const canRaid = f => f === 'rim' || (f === 'rep' && f === C.player && SR.rule('free')); /* the Howlers raid too */
export function raidWhy(fl, wid) {
  if (!canRaid(fl.owner)) return 'only the Rim raids'; if (fl.levy) return 'a levy follows its House';
  const w = C.worlds[wid]; if (!w || !hostile(fl.owner, w.owner) || w.owner === 'neu') return 'not a world we are at war with';
  if (w.raidT > C.turn) return `${nm(wid)} was raided ${C.turn - (w.raidT - 8)} weeks ago: nothing left worth taking yet`;
  if (fl.transit) return 'already under way';
  if (travel(fl.at, wid) > RAID_REACH) return `too far: raiders strike within ${RAID_REACH} weeks`;
  return null;
}
export function raidLoot(w) { const y = yieldOf(w), o = C.fac[w.owner] ? C.fac[w.owner].res : { he: 0, ore: 0 }; return { he: Math.round(Math.min(o.he * .15 + 100, Math.max(0, y.he) * 3 + 160)), ore: Math.round(Math.min(o.ore * .15 + 100, Math.max(0, y.ore) * 3 + 140)), inf: 8 }; }
export function orderRaid(fl, wid) { const e = raidWhy(fl, wid); if (e) return e; const m = moveFleet(fl, wid); if (m) return m; fl.raid = wid; return null; }
// after the battles: a raider over its target, with no enemy fleet left there, takes what it can carry and runs
function raidTick() {
  for (const fl of C.fleets) {
    if (!fl.raid || fl.transit) continue;
    if (fl.at !== fl.raid) { fl.raid = null; continue; }
    const w = C.worlds[fl.at]; if (!w || !hostile(fl.owner, w.owner) || fleetsAt(fl.at).some(o => hostile(o.owner, fl.owner) && o.ships.length)) { if (!fleetsAt(fl.at).some(o => hostile(o.owner, fl.owner))) fl.raid = null; continue; }
    const L = raidLoot(w), r = C.fac[fl.owner].res, o = C.fac[w.owner] && C.fac[w.owner].res;
    r.he += L.he; r.ore += L.ore; r.inf += L.inf; if (o) { o.he = Math.max(0, o.he - L.he); o.ore = Math.max(0, o.ore - L.ore); }
    // the platforms fire on the raiders as they make their runs
    for (const s of fl.ships) s.hp = Math.max(.06, s.hp - w.gun * (.025 + rnd() * .03));
    if (w.cl) { for (const e in w.cl) w.cl[e] = clamp(w.cl[e] - 5, 0, 100); w.cl.gold = clamp(w.cl.gold - 6, 0, 100); EC.syncLoy(w); }
    w.raidT = C.turn + 8; C.stats = C.stats || {}; C.stats.raids = (C.stats.raids || 0) + 1;
    if (w.owner === 'rep' && fl.owner === 'rim') C.alarm = clamp((C.alarm || 0) + 4, 0, 100);
    if (fl.owner === 'rim') { P.nudge('rim', 'lux', 2); P.nudge('rim', 'codovan', 2); P.nudge('rim', 'raa', -1); } P.addOpinion(w.owner, fl.owner, 'raid', 'Raids our worlds', -6, .2, 30);
    note(`${fl.name} raids ${nm(w.id)}: +${L.he} He-3, +${L.ore} ore and hostages worth +${L.inf} influence, then runs for home.`, fl.owner === C.player ? 'good' : w.owner === C.player ? 'bad' : '', w.id);
    fl.raid = null; const home = nearestOwn(fl.owner, fl.at); if (home) moveFleet(fl, home);
  }
}
const nearestOwn = (f, from) => { let best = null, bd = 99; for (const id in C.worlds) if (C.worlds[id].owner === f && id !== from) { const d = travel(from, id); if (d < bd) { bd = d; best = id; } } return best; };
// the AI's raids: a light fleet looks for a world it can strip without a fight
export function aiRaid(f, fls) {
  if (f !== 'rim' || rnd() > .35) return null;
  const cand = fls.filter(fl => !fl.transit && !fl.garrison && !fl.levy && !fl.raid && fleetStr(fl) > 250 && fleetStr(fl) < 2200 && C.worlds[fl.at] && C.worlds[fl.at].owner === f);
  for (const fl of cand) {
    let best = null, bs = 0;
    for (const id in C.worlds) { if (raidWhy(fl, id)) continue; const w = C.worlds[id], foe = IN.knownStrAt(f, id, fleetStr); if (foe > 0 || w.gun > 3) continue; const L = raidLoot(w), sc = (L.he + L.ore) / (travel(fl.at, id) + 1) / (1 + w.gun); if (sc > bs) { bs = sc; best = id; } }
    if (best && !orderRaid(fl, best)) return fl;
  }
  return null;
}

// ---------------------------------------------------------------- the Remnant: House levies
// a great House raises a fleet of its own for the Remnant. It follows the House's own ends, not your orders; its
// commander is the House's man, as loyal as the House is content. A House at war with the throne takes its levy with it.
export const LEVY = {
  grimmus: { comp: { dread: 1, destroyer: 2, frigate: 2 }, goal: 'war', home: 'venus', desc: 'War to the end: it seeks out the enemy wherever it can win.' },
  carthii: { comp: { torch: 1, destroyer: 2, frigate: 2 }, goal: 'guard', home: 'venus', desc: 'The shipwrights guard the yards of Venus, and go to its aid first.' },
  votum:   { comp: { frigate: 3, corvette: 2, boarder: 2 }, goal: 'guard', home: 'mercury', desc: 'The Scorpion Legions hold Mercury, or go to win it back.' },
  saud:    { comp: { destroyer: 1, frigate: 3, corvette: 2 }, goal: 'relieve', home: 'venus', desc: 'The old Venusian house relieves besieged worlds near home.' },
};
export const LEVY_COST = { inf: 30, he: 200 };
export function levyWhy(f, gid, at) {
  if (f !== 'soc') return 'only the Houses of the Remnant raise levies'; const g = P.groupsOf('soc').find(x => x.id === gid), D = P.defOf('soc', gid); if (!g || !LEVY[gid]) return 'no such House';
  const w = C.worlds[at]; if (!w || w.owner !== 'soc' || w.siege) return 'the levy musters at a world of ours, not under siege';
  if (C.fleets.some(x => x.levy === gid && x.owner === 'soc')) return `${D.name} already has a levy in the field`;
  if (C.levyT && C.levyT[gid] > C.turn) return `${D.name} raised a levy ${12 - (C.levyT[gid] - C.turn)} weeks ago: it will not again for ${C.levyT[gid] - C.turn}`;
  if (g.sat < 30) return `${D.name} is too bitter (${Math.round(g.sat)}%) to raise ships for the throne`;
  const r = C.fac.soc.res; if (r.inf < LEVY_COST.inf || r.he < LEVY_COST.he) return `needs ${LEVY_COST.inf} influence and ${LEVY_COST.he} He-3`;
  return null;
}
export function requestLevy(f, gid, at) {
  const e = levyWhy(f, gid, at); if (e) return e; const r = C.fac.soc.res, D = P.defOf('soc', gid), L = LEVY[gid];
  r.inf -= LEVY_COST.inf; r.he -= LEVY_COST.he; P.nudge('soc', gid, -4); C.levyT = C.levyT || {}; C.levyT[gid] = C.turn + 12;
  const fl = fleet('soc', at, L.comp, `${D.name} Levy`); fl.levy = gid;
  const g = P.groupsOf('soc').find(x => x.id === gid), surname = D.name.replace('House ', '');
  const c = CM.makeCmdr('soc', { name: `${['Tactus', 'Cassia', 'Lucan', 'Drusilla', 'Felix', 'Junia'][Math.floor(rnd() * 6)]} au ${surname}`, title: `Captain of ${D.name}`, rank: 1, colour: 'Gold', house: gid }); c.loyalty = g.sat; c.lore = false; CM.assign(c, fl);
  note(`${D.name} raises its levy at ${nm(at)}: ${fl.ships.length} ships under ${c.name}. ${L.desc}`, f === C.player ? 'good' : '', at);
  return null;
}
// a levy steers itself by its House's ends
function levyTurn(fl) {
  const L = LEVY[fl.levy], here = C.worlds[fl.at]; if (!L || fl.transit || fl.engage) return;
  const mine = Object.values(C.worlds).filter(w => w.owner === fl.owner), str = fleetStr(fl);
  const ok = id => { const foe = IN.knownStrAt(fl.owner, id, fleetStr) + (hostile(fl.owner, C.worlds[id].owner) ? defStr(C.worlds[id]) : 0); return str * 1.15 >= foe; };
  // first, any world of ours near home that is besieged and that this levy can relieve
  const sieged = mine.filter(w => w.siege && hostile(fl.owner, w.siege.by) && travel(fl.at, w.id) <= (L.goal === 'relieve' ? 4 : 2) && ok(w.id)).sort((a, b) => travel(fl.at, a.id) - travel(fl.at, b.id))[0];
  if (sieged) { if (sieged.id !== fl.at) moveFleet(fl, sieged.id); return; }
  if (here && here.siege && here.siege.by === fl.owner) return; // holding a siege
  if (L.goal === 'war') {
    let best = null, bs = 0; for (const id in C.worlds) { const w = C.worlds[id]; if (!hostile(fl.owner, w.owner) || w.owner === 'neu') continue; const t = travel(fl.at, id); if (t > 5 || !ok(id)) continue; const sc = (id === CAPITAL[w.owner] ? 2 : 1) / (t + 1); if (sc > bs) { bs = sc; best = id; } }
    if (best && best !== fl.at) { moveFleet(fl, best); return; }
  }
  const home = C.worlds[L.home] && C.worlds[L.home].owner === fl.owner ? L.home : L.goal === 'guard' && C.worlds[L.home] && hostile(fl.owner, C.worlds[L.home].owner) && ok(L.home) ? L.home : CAPITAL[fl.owner];
  if (home && fl.at !== home && C.worlds[home]) moveFleet(fl, home);
}
function levyTick() {
  for (const fl of C.fleets.slice()) {
    if (!fl.levy || fl.owner !== 'soc') continue;
    const g = P.groupsOf('soc').find(x => x.id === fl.levy), D = P.defOf('soc', fl.levy), c = CM.cmdrOf(fl);
    if (!g) continue;
    if (c && isFinite(g.sat)) { const l0 = isFinite(c.loyalty) ? c.loyalty : g.sat; c.loyalty = clamp(l0 + (g.sat - l0) * .3, 0, 100); }
    // a bitter House calls its ships home
    if (g.sat < 15 && !fl.transit) { note(`${D.name} recalls its levy: ${fl.ships.length} ships leave the Remnant's service.`, C.player === 'soc' ? 'bad' : '', fl.at); fl.ships = []; }
  }
  C.fleets = C.fleets.filter(f => f.ships.length);
}
// at the start of the AI's turn (for the player too: a levy obeys its House, not you)
export function levyOrders() { for (const fl of C.fleets) if (fl.levy && fl.owner === 'soc') levyTurn(fl); }
// the civil war: the rebel House's levy goes over with it
export function levyRebels(gid) { for (const fl of C.fleets) if (fl.levy === gid && fl.owner === 'soc') { fl.owner = 'neu'; fl.levy = null; fl.name = `${P.defOf('soc', gid).name} Rebels`; fl.raider = false; } }
export function aiLevy(f) {
  if (f !== 'soc' || rnd() > .2) return; const r = C.fac.soc.res; if (r.inf < 90) return;
  const at = CAPITAL.soc; const G = P.groupsOf('soc').filter(g => !levyWhy('soc', g.id, at)).sort((a, b) => b.sat - a.sat); if (G[0]) requestLevy('soc', G[0].id, at);
}

// ---------------------------------------------------------------- the Republic: a Sons of Ares rising
// cells on an enemy world are told the day: when the Republic's fleet comes over the horizon they rise, the garrison
// is cut down in its barracks and the orbital authority is sabotaged
export const RISING_COST = { inf: 35 };
export const risingCost = () => SR.rule('free') && C.player === 'rep' ? 18 : RISING_COST.inf; /* Free of the Senate: Sevro's cells come cheaper */
export function risingWhy(fl, wid) {
  if (fl.owner !== 'rep') return 'only the Republic can call on the Sons of Ares'; const w = C.worlds[wid];
  if (!w || !hostile('rep', w.owner) || w.owner === 'neu') return 'not an enemy world';
  if (EC.mixOf(wid).red < .06) return `${nm(wid)} has too few Reds for the Sons of Ares to rise`;
  if ((C.risings || []).some(r => r.w === wid)) return 'a rising is already planned there';
  if (C.fac.rep.res.inf < risingCost()) return `needs ${risingCost()} influence`;
  if (fl.transit && fl.transit.to !== wid) return 'the fleet is bound elsewhere';
  if (!fl.transit && travel(fl.at, wid) > 8) return 'too far';
  return null;
}
export function planRising(fl, wid) {
  const e = risingWhy(fl, wid); if (e) return e;
  if (!fl.transit) { const m = moveFleet(fl, wid); if (m) return m; }
  C.fac.rep.res.inf -= risingCost(); C.risings = C.risings || [];
  C.risings.push({ w: wid, fl: fl.id, t: C.turn, until: C.turn + fl.transit.left + 3 });
  if (fl.owner === C.player) note(`The Sons of Ares on ${nm(wid)} are given the day: they rise when ${fl.name} arrives, in ${fl.transit.left} week${fl.transit.left > 1 ? 's' : ''}.`, 'gold', wid);
  return null;
}
// a fleet arrives: if a rising waits for it, it goes off
export function onArrive(fl) {
  const L = C.risings || []; const i = L.findIndex(r => r.fl === fl.id && r.w === fl.at); if (i < 0) return;
  const R = L.splice(i, 1)[0], w = C.worlds[R.w]; if (!w || !hostile(fl.owner, w.owner)) return;
  const g0 = w.garrison, cap = CAPITAL[w.owner] === w.id; w.garrison = Math.round(w.garrison * (cap ? .7 : .5)); w.gov = Math.max(.1, w.gov - (cap ? .2 : .35)); /* a capital's guard is harder to cut down in its barracks */ if (w.gun > 0 && rnd() < .7) w.gun--;
  if (w.cl) { for (const e in w.cl) w.cl[e] = clamp(w.cl[e] - 18, 0, 100); w.cl.red = clamp(w.cl.red - 30, 0, 100); EC.syncLoy(w); }
  if (w.siege) w.siege.hold = Math.max(0, (w.siege.hold || 0) - 2);
  C.stats = C.stats || {}; C.stats.risings = (C.stats.risings || 0) + 1;
  note(`The Sons of Ares rise on ${nm(w.id)} as ${fl.name} comes over the horizon: ${(g0 - w.garrison).toLocaleString()} of the garrison are cut down, the orbital authority is sabotaged.`, fl.owner === C.player ? 'good' : w.owner === C.player ? 'bad' : 'gold', w.id, fl.owner === C.player || w.owner === C.player ? { title: 'The Sons of Ares rise', kind: 'revolt' } : null);
  chron('world', `The Sons of Ares rise on ${nm(w.id)}.`, w.id, fl.owner);
}
function risingTick() { C.risings = (C.risings || []).filter(r => { const fl = C.fleets.find(f => f.id === r.fl); if (C.turn <= r.until && fl && ((fl.transit && fl.transit.to === r.w && !fl.transit.retreat) || fl.at === r.w)) return true; /* the fleet must still be coming */ const w = C.worlds[r.w]; if (w && r.fl && C.fac.rep) { if (w.owner === C.player || C.player === 'rep') note(`The rising on ${nm(r.w)} comes to nothing: the fleet never came, and the cells are betrayed.`, C.player === 'rep' ? 'bad' : 'good', r.w); if (w.cl) { w.cl.red = clamp(w.cl.red - 6, 0, 100); EC.syncLoy(w); } } return false; }); }
// the AI: an offensive bound for a world with Reds on it calls the Sons of Ares
export function aiRising(f, fl, wid) { if (f !== 'rep' || C.fac.rep.res.inf < 70 || rnd() > .6) return; planRising(fl, wid); }

// ---------------------------------------------------------------- the weekly tick
export function tick() {
  raidTick(); levyTick(); risingTick();
  for (const w of Object.values(C.worlds)) {
    if (w.client && w.owner !== 'rep') w.client = false;
    if (w.fief && w.owner !== 'soc') w.fief = null;
    if (w.hostage && w.hostage <= C.turn) w.hostage = 0;
    // a client world raises Free Legions of its own
    if (w.client && !w.siege) w.garrison = Math.min(Math.round(garrisonCap(w) * 1.3), w.garrison + 150);
  }
}
