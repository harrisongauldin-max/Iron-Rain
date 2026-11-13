// The campaign: the Solar War as a turn-based strategy game. One turn is a week. Fleets travel for weeks
// between worlds; worlds are built up, taxed and garrisoned; when hostile fleets meet, a battle is fought,
// in real time on the tactical map or auto-resolved. Pure rules, no DOM: the strategic view drives it.
import { WORLDS, PROD_K, bodyOf, AU, placePlanets } from './solar.js';
import { BODIES, FACTIONS, DEFS, factionDefs, CRAFT, BAY, BAYS, bayUse, REPLACE_COST, REPLACE_MAN } from './data.js';
import * as CM from './command.js';
import * as EC from './economy.js';
import * as TE from './tech.js';
import * as P from './politics.js';
import * as AG from './agents.js';
import * as ST from './story.js';
import * as IN from './intel.js';
import * as RU from './rulers.js';
import * as CQ from './conquest.js';
import * as SR from './starts.js';
import * as QS from './quests.js';
import * as TRN from './terrain.js';
import * as RV from './rivals.js';
export const onCapture = (w, by, base) => EC.onCapture(w, by, base);
// a world has changed hands by force: its conqueror decides what to do with it (conquest.js)
export const worldTaken = (w, by, old, how) => CQ.onTaken(w, by, old, how);

// a power the player decides for: when the player's own power is left to the AI (autoplay, the balance runs), it decides as the AI does
export const human = f => f === C.player && !!C.fac[f] && !C.fac[f].ai;
export const BLOCS = { rep: 'rising', soc: 'core', rim: 'rim' }; // campaign power → faction design key
export const BLOC_NAME = { rep: 'The Solar Republic', soc: 'The Society Remnant', rim: 'The Rim Dominion', neu: 'Independent' };
export const CAPITAL = { rep: 'luna', soc: 'venus', rim: 'io' };
const CAPITAL0 = { ...CAPITAL };
// a siege's holdout: the weeks a world can hold before its defences are broken and the Rain can land in strength
export const holdOf = w => Math.max(1, 2 + (w.lv.fort || 0) + (w.id === 'mercury' && w.owner === 'soc' && SR.rule('heliopolis') ? 2 : 0) + (Object.values(CAPITAL).includes(w.id) ? 2 : 0) + ((WORLDS.find(x => x.id === w.id) || { prod: {} }).prod.food < 0 || (w.owner !== 'neu' && C.fac[w.owner] && C.fac[w.owner].res.food < 0) ? -1 : 1));
export const newSiege = (w, by, mode = 'blockade') => (w.siege = { by, turns: 0, mode, hold: holdOf(w), hold0: holdOf(w) });
const WK = 30 * PROD_K * 4;       // a week's yield, in multiples of the tactical game's per-second output (≈10×)
const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const BUILD = { // what a world can build: per level effect, cost and weeks
  mine:    { name: 'Deep Mines',      desc: '+45 ore a week, at a world of 100 million', work: true,                         ore: 60,  he: 30,  t: 2, max: 3 },
  skimmer: { name: 'He-3 Skimmers',   desc: '+35 helium-3 a week at a world of 100 million; a gas giant\u2019s own scoops +56 with no workforce, a moon\u2019s +56 at 100 million', work: true, ore: 80, he: 0, t: 2, max: 3 },
  arsenal: { name: 'Arsenal',         desc: '+90 ordnance a week, at a world of 100 million', work: true,                     ore: 100, he: 40,  t: 3, max: 3 },
  farms:   { name: 'Agricultural Domes', desc: '+140 food a week',                      ore: 50,  he: 10,  t: 2, max: 3 },
  barracks:{ name: 'Legion Barracks', desc: '+600 manpower a week from a people of 150 million, +1,000 garrison cap', work: true, ore: 80, he: 20, t: 2, max: 3 },
  yard:    { name: 'Shipyard',        desc: 'Lv1 light hulls · Lv2 destroyers and torchShips · Lv3 dreadnoughts', ore: 260, he: 160, t: 4, max: 3 },
  grid:    { name: 'Defence Grid',    desc: '+1 orbital gun platform',                 ore: 160, he: 60,  t: 3, max: 3 },
  array:   { name: 'Shield Array',    desc: '+1 shield platform',                      ore: 140, he: 90,  t: 3, max: 3 },
  fort:    { name: 'Fortress',        desc: '+2,500 garrison cap; every estate +4 loyalty', ore: 180, he: 40,  t: 3, max: 3 },
  foundry: { name: 'Foundry',         desc: 'Refines 40 ore into 30 alloys a week, at a world of 100 million. Needs Deep Mines or a Shipyard here', work: true, ore: 140, he: 40, t: 3, max: 3, needs: w => w.lv.mine || w.lv.yard ? null : 'needs Deep Mines or a Shipyard here' },
  court:   { name: 'Governor’s Court', desc: '+3 influence a week, +4 administrative capacity; Golds +4 loyalty', ore: 90, he: 60, t: 3, max: 2 },
  lab:     { name: 'Research Spire',  desc: '+3 research a week; a Green arcology of labs and data vaults', ore: 70, he: 50, t: 3, max: 3 },
};
const TIER = t => (t === 'dread' || t === 'moonbreaker') ? 3 : (t === 'destroyer' || t === 'torch') ? 2 : 1;
export const C = { on: false };

// ---------------------------------------------------------------- setup
export function defsOf(f) { return C.defs[f] || (C.defs[f] = TE.applyDefs(f, factionDefs(BLOCS[f] || 'core'))); }
export function newCampaign(player, difficulty = 1, start = null, opts = {}) {
  Object.assign(CAPITAL, CAPITAL0);
  Object.assign(C, { on: true, turn: 1, player, difficulty, capLost: {}, capit: {}, supremacy: 0, worlds: {}, fleets: [], nid: 1, log: [], defs: {}, report: [], over: null,
    fac: {}, rel: { 'rep|soc': 'war', 'rep|rim': 'peace', 'rim|soc': 'peace' }, events: {}, alarm: 0, lastRep: undefined, objDone: {}, withdrawn: {}, promos: [], pending: null, crisis: null, lastOffer: undefined, lastAsk: {}, pendingOffer: null, pendingVote: null, polFx: {}, newTech: false,
    leaders: { rep: 'Sovereign Virginia au Augustus', soc: 'Magnus au Grimmus, the Ash Lord', rim: 'Sovereign Romulus au Raa' }, chron: [], hist: [], battleN: {}, ops: {}, static: 0,
    // per-campaign bookkeeping that must not leak from an earlier campaign in the same session
    stats: {}, spyOps: {}, spyTry: {}, incidents: 0, opsLog: 0, opsMulti: 0, crisisT: {}, secrets: [], capStreak: {}, _own: null, _shipN: null, lawT: {}, warned: {}, bombards: {}, tribute: [], truce: {},
    threats: [], risings: [], takePend: [], crewPend: null, fear: {}, levyT: {}, start: null, ahist: false, wrecks: {}, moves0: {}, quests: {}, heir: {} });
  C.moving = true; placePlanets(1); /* the planets always move: the worlds go round their orbits, a week a turn */
  for (const f of ['rep', 'soc', 'rim']) C.fac[f] = { key: f, ai: f !== player, alive: true, res: { he: 900, ore: 700, ord: 1200, man: 20000, food: 0, alloy: 0, rare: 0, inf: 0, sci: 0 }, lastInc: {} };
  C.fac.neu = { key: 'neu', ai: true, alive: true, res: { he: 0, ore: 0, ord: 0, man: 0, food: 0 }, lastInc: {} };
  for (const w of WORLDS) {
    const b = bodyOf(w.id), slots = b.kind === 'planet' && !b.dwarf ? 6 : b.r > 700 ? 4 : 3, home = w.side;
    const lv = { mine: 0, skimmer: 0, arsenal: 0, farms: 0, barracks: 0, foundry: 0, court: 0, lab: 0, yard: w.gov === 'station' || w.yard ? (w.id === 'eris' || w.id === 'hildas' ? 1 : 3) : w.gov === 'dockyard' ? 2 : 0, grid: 0, array: 0, fort: w.gov === 'station' ? (w.id === 'eris' ? 2 : 1) : 0 }; // the Ascomanni's ice fortress and the old anchorage: a citadel, but no great yard
    C.worlds[w.id] = { id: w.id, owner: home, home, slots, lv, base: Object.values(lv).reduce((a, v) => a + v, 0), gun: w.plats.gun, shield: w.plats.shield, gov: 1, garrison: Math.round(2200 * (w.ground || 1) * (Object.values(CAPITAL).includes(w.id) ? 2.5 : 1)),
      loyalty: home === 'neu' ? 60 : 72, bq: [], sq: [], siege: null, unrest: 0 };
  }
  // opening forces, after the opening of Iron Gold: Orion's White Fleet holds Mercury's orbit with the Morning Star
  // while the Free Legions fight on the ground; the Fourth Fleet holds Mars; the Ash Armada and the Carthii fleet
  // are at Venus; the Rim's armada is at Io
  const wf = fleet('rep', 'mercury', { moonbreaker: 1, torch: 2, destroyer: 3, frigate: 4, tender: 1 }, 'White Fleet');
  wf.ships.find(s => s.t === 'moonbreaker').name = 'Morning Star';
  wf.ships.find(s => s.t === 'moonbreaker').load = { ...INVADE.moonbreaker }; // the White Fleet carries the legions for the Rain on Mercury
  fleet('rep', 'luna', { frigate: 2, corsair: 2, ripwing: 4 }, 'Home Fleet');
  fleet('rep', 'mars', { frigate: 2, corsair: 2 }, 'Fourth Fleet');
  fleet('soc', 'venus', { dread: 1, torch: 2, destroyer: 3, frigate: 4, ripwing: 4 }, 'Ash Armada');
  fleet('soc', 'venus', { dread: 1, destroyer: 2, frigate: 3, corvette: 2 }, 'First Fleet');
  { const hg = fleet('soc', 'mercury', { destroyer: 2, frigate: 3, corvette: 2 }, 'Heliopolis Garrison'); hg.garrison = true; hg.holdFast = 'mercury'; } // ordered to hold Mercury's orbit to the last
  fleet('rim', 'io', { dread: 1, torch: 2, raider: 3, frigate: 3, ripwing: 4 }, 'Dust Armada');
  fleet('rim', 'titan', { frigate: 2, corvette: 2 }, 'Saturn Watch');
  fleet('rim', 'callisto', { destroyer: 1, frigate: 2 }, 'Callisto Guard');
  newSiege(C.worlds.mercury, 'rep'); C.worlds.mercury.siege.turns = 2; C.worlds.mercury.siege.hold = 1; // Heliopolis has held for weeks already
  C.senateHold = { world: 'mercury' }; // Iron Gold: two days before the Rain, the Senate voted to hold the siege and not spend the legions
  EC.setupEconomy(); TE.setupTech(); P.setupPolitics(); AG.setupAgents(); ST.setupStory();
  C.fac.soc.res.he += 1600; // the Imperial reserve on Venus
  CM.setupCommanders(); CM.setupHeir(); RU.setupRulers(); C.engage = []; C.intel = {}; C.classes = {}; for (const f of ['rep', 'soc', 'rim']) TE.classesOf(f); SR.apply(player, start, opts || {}); IN.scanAll();
  snapshot(); C._own = Object.fromEntries(Object.values(C.worlds).map(w => [w.id, w.owner]));
  chron('start', 'Week 1, 753 PCE. The Republic besieges Mercury; the Ash Lord lies dying on Venus; the Rim keeps the peace of Ilium.', 'mercury', 'rep');
  note(SR.opening() || 'Week 1, 753 PCE, the tenth year of the war. The Republic’s legions fight for Mercury. On Venus the Ash Lord lies ailing, and Atalantia commands in his name. The Rim keeps its peace with the Republic, and watches from Io.', 'gold');
  return C;
}
export function fleet(owner, at, comp, name) {
  const ships = []; for (const t in comp) for (let k = 0; k < comp[t]; k++) ships.push(newShip(t));
  const f = { id: C.nid++, owner, name: name || autoName(owner), at, transit: null, ships, orders: null, moved: false };
  C.fleets.push(f); return f;
}
export const newShip = t => ({ id: C.nid++, t, hp: 1, crew: 1, ammo: 1, rank: 0 });
// fleets are numbered, as in the books (the Republic's Fourth Fleet, House Carthii's First and Third); the Rim names its armadas
const ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
function autoName(o) {
  const used = new Set(C.fleets.filter(f => f.owner === o).map(f => f.name));
  if (o === 'rim') { for (const n of ['Dragon Armada', 'Shadow Armada']) if (!used.has(n)) return n; for (const n of ORD) if (!used.has(n + ' Phalanx')) return n + ' Phalanx'; }
  if (o === 'neu') { for (let i = 1; ; i++) if (!used.has('Free Squadron ' + i)) return 'Free Squadron ' + i; }
  for (const n of ORD) if (!used.has(n + ' Fleet')) return n + ' Fleet';
  return 'Fleet ' + C.nid;
}
// ev marks a dispatch worth an event card: { title, kind }
// the chronicle: the named deeds of the war, for the Ledger and the war's end
export function chron(k, text, at = null, f = null) { if (!C.chron) C.chron = []; C.chron.push({ t: C.turn, k, text, at, f }); if (C.chron.length > 600) C.chron.shift(); }
// the ledger: every five weeks, how each power stands
export function snapshot() { C.hist = C.hist || []; C.hist.push({ t: C.turn, p: histPoint() }); }
export function histPoint() {
  const p = {};
  for (const f of ['rep', 'soc', 'rim']) { const r = C.fac[f].res; p[f] = { w: Object.values(C.worlds).filter(w => w.owner === f).length, str: Math.round(C.fleets.filter(x => x.owner === f).reduce((a, x) => a + fleetStr(x), 0)), ships: C.fleets.filter(x => x.owner === f).reduce((a, x) => a + x.ships.length, 0), he: Math.round(r.he), ore: Math.round(r.ore), alloy: Math.round(r.alloy || 0), man: Math.round(r.man), inf: Math.round(r.inf || 0), weary: Math.round((C.weary && C.weary[f]) || 0), sup: C.pol ? Math.round(P.supportOf(f)) : 50, legit: C.rulers ? Math.round(RU.legitOf(f)) : 0, alive: C.fac[f].alive }; }
  return p;
}
export function note(msg, cls = '', at = null, ev = null) { C.log.unshift({ turn: C.turn, msg, cls, at, ev }); if (C.log.length > 160) C.log.pop(); C.report.push({ msg, cls, at, ev }); }

// ---------------------------------------------------------------- geometry and travel
const AUof = id => { const b = bodyOf(id); const p = b.parent != null ? BODIES[b.parent] : b; return Math.hypot(p.x, p.y) / AU; };
const sysOf = id => { const b = bodyOf(id); return b.parent != null ? BODIES[b.parent].id || BODIES[b.parent].name : b.id; };
export function travel(a, b) {
  if (a === b) return 0; if (sysOf(a) === sysOf(b)) return 1;
  const pa = bodyOf(a), pb = bodyOf(b), A = pa.parent != null ? BODIES[pa.parent] : pa, B = pb.parent != null ? BODIES[pb.parent] : pb;
  const d = Math.hypot(A.x - B.x, A.y - B.y) / AU;
  if (C.moving) return clamp(Math.round(.7 + 1.35 * Math.pow(d, .72)), 1, 12); /* with the planets moving, the true distance tells more: launch windows */
  return clamp(Math.round(1 + 1.25 * Math.sqrt(d)), 1, 10);
}

// ---------------------------------------------------------------- strength
// damage that lasts (subsystems knocked about) costs a ship its edge until a yard puts it right
export const subMul = s => { if (!s.sub) return 1; const v = Object.values(s.sub); return v.length ? .4 + .6 * v.reduce((a, x) => a + x, 0) / v.length : 1; };
// cvK: what a hull is worth in a fight beyond its price, measured on the tactical map (a moonBreaker alone holds off a
// dreadnought squadron half again her worth, so auto-resolve and the forecast count her at 1.5)
export const shipVal = (f, s) => { const d = defsOf(f)[s.t] || DEFS[s.t]; return (d.value || d.cost || 50) * (d.cvK || 1) * s.hp * subMul(s) * (.45 + .55 * s.crew) * (.4 + .6 * s.ammo) * (1 + .1 * s.rank) * (s.fit && TE.FITS[s.fit] ? TE.FITS[s.fit].ar || 1 : 1) * (s.cls ? (TE.classSpec(f, s.cls) || { ar: 1 }).ar : 1) * (s.crewName ? 1.05 : 1); };
export const fleetStr = fl => fl.ships.reduce((a, s) => a + shipVal(fl.owner, s), 0);
export const defStr = w => ((w.gun * 260 + w.shield * 180 * TE.mod(w.owner, 'wshield')) * (1 + .15 * w.lv.grid) + w.gov * (isCap(w.id) ? 2200 : 500)) * TE.mod(w.owner, 'defense');
const isCap = id => Object.values(CAPITAL).includes(id);
// a carrier's hangars, for the campaign: its bay space, the yard's own mix, the mix chosen for it (load), and what is
// aboard now (cur). A ship record with no hangar record aboard carries a full load
export function hangarOf(f, s) {
  const d = defsOf(f)[s.t] || DEFS[s.t]; if (!d || !d.hangar) return null;
  const sp = s.cls && TE.classSpec(f, s.cls), fit = s.fit && TE.FITS[s.fit] && TE.FITS[s.fit].mul;
  const hm = (sp ? sp.mul.hangar || 1 : 1) * ((fit && fit.hangar) || 1), mixK = k => hm * ((sp && sp.mul.hmix && sp.mul.hmix[k]) || 1);
  const mix = {}; for (const k of CRAFT) mix[k] = Math.round((d.hangar[k] || 0) * mixK(k));
  const cap = Math.max(Math.round((BAYS[s.t] || bayUse(d.hangar)) * hm * (d.hangar.ripwing != null ? TE.mod(f, 'hangar') : 1)), bayUse(mix));
  const load = s.load ? { ...mix, ...s.load } : mix, cur = s.hangar ? { ripwing: 0, starshell: 0, boarder: 0, stork: 0, ...s.hangar } : { ...load };
  return { cap, mix, load, cur, d };
}
export const troopsPer = (f, k) => ((defsOf(f)[k] || DEFS[k] || {}).troops) || 0;
// the leechCraft aboard (kept by this name for the code that counts them)
export const podsIn = (f, s) => { const H = hangarOf(f, s); return H ? H.cur.boarder || 0 : 0; };
export const storksIn = (f, s) => { const H = hangarOf(f, s); return H ? H.cur.stork || 0 : 0; };
// what an Iron Rain from this fleet can put on the ground: the first wave (starShells and leechCraft, and the troop hulls)
// takes the beachhead; the second (the Storks) lands the legions, and only if there is a beachhead to land on
export function rainWaves(fl) {
  let w1 = 0, w2 = 0;
  for (const s of fl.ships) { const d = defsOf(fl.owner)[s.t] || DEFS[s.t], H = hangarOf(fl.owner, s), k = (s.fit && TE.FITS[s.fit] ? TE.FITS[s.fit].troops || 1 : 1) * (s.cls ? (TE.classSpec(fl.owner, s.cls) || { troops: 1 }).troops : 1);
    if (H) { w1 += (H.cur.starshell * troopsPer(fl.owner, 'starshell') + H.cur.boarder * troopsPer(fl.owner, 'boarder')) * s.crew; w2 += H.cur.stork * troopsPer(fl.owner, 'stork'); }
    w1 += ((d.troops || 0) * s.crew + (d.cmd ? (d.crew || 0) * .04 * s.crew : 0)) * k; }
  return { w1, w2: w1 >= 50 ? w2 : 0, storks: w2, total: w1 + (w1 >= 50 ? w2 : 0) };
}
export const troopsOf = fl => rainWaves(fl).total;
// refitting a carrier's hangars: only at a world of one's own, not under siege
export function hangarHome(fl) { const w = fl.at && C.worlds[fl.at]; return !!(w && w.owner === fl.owner && !w.siege && !fl.transit); }
// a carrier fitted to invade: enough ripWings to cover herself, the first wave, and the Storks behind it
export const INVADE = { dread: { ripwing: 6, starshell: 20, boarder: 2, stork: 2 }, moonbreaker: { ripwing: 12, starshell: 40, boarder: 4, stork: 5 } };
export function aiLoad(fl) { for (const s of fl.ships) if (INVADE[s.t] && !s.load) { const H = hangarOf(fl.owner, s); if (!H) continue; const k = H.cap / BAYS[s.t], L = {}; for (const c of CRAFT) L[c] = Math.floor(INVADE[s.t][c] * k); s.load = L; } }
export function setLoad(fl, s, load) {
  const H = hangarOf(fl.owner, s); if (!H) return 'This hull has no hangars'; if (!hangarHome(fl)) return 'Hangars are refitted at a world of your own';
  const L = {}; for (const k of CRAFT) L[k] = Math.max(0, Math.round(load[k] || 0)); if (bayUse(L) > H.cap) return `Only ${H.cap} bays`;
  s.load = L; if (s.hangar) for (const k of CRAFT) s.hangar[k] = Math.min(s.hangar[k] || 0, L[k]); return null;
}
export const fleetsAt = (id, owner) => C.fleets.filter(f => f.at === id && !f.transit && (owner == null || f.owner === owner));
// relations between the powers: 'war', 'peace' or 'ally'. In 753 PCE the Republic and the Remnant are at war;
// the Rim has kept a decade-long peace with the Republic, and holds aloof from the Remnant.
const RK = (a, b) => a < b ? a + '|' + b : b + '|' + a;
export const relOf = (a, b) => a === b ? 'self' : (a === 'neu' || b === 'neu') ? (a === b ? 'self' : 'war') : (C.rel && C.rel[RK(a, b)]) || 'war';
export const setRel = (a, b, v) => { C.rel[RK(a, b)] = v; };
export const hostile = (a, b) => a !== b && relOf(a, b) === 'war';
export function declareWar(a, b, breakTruce) {
  if (relOf(a, b) === 'war') return; const broke = P.truceLeft(a, b) > 0; if (broke && (!breakTruce || RU.hasTrait(a, 'honour'))) return 'truce'; setRel(a, b, 'war'); P.react(a, 'war');
  if (broke) { delete C.truce[a < b ? a + '|' + b : b + '|' + a]; P.react(a, 'defy', .5); }
  P.onWar(a, b, broke); chron('war', `${BLOC_NAME[a]} ${broke ? 'breaks its truce and ' : ''}declares war on ${BLOC_NAME[b]}.`, CAPITAL[b], a);
  note(`${BLOC_NAME[a]} ${broke ? 'breaks the truce and ' : ''}declares war on ${BLOC_NAME[b]}.`, a === C.player || b === C.player ? 'bad' : 'gold', CAPITAL[b], { title: broke ? 'A truce broken' : 'War', kind: 'war' });
  // breaking a long peace costs the aggressor some of its people's faith
  for (const w of Object.values(C.worlds)) if (w.owner === a) EC.jolt(w, -6);
}
// naval capacity: how many hulls the realm's yards, docks and crews can keep in service. Past it, upkeep climbs
export const hullSize = (f, t) => { const v = (defsOf(f)[t] || DEFS[t] || {}).value || 50; return v < 150 ? .5 : v < 300 ? 1 : v < 500 ? 2 : v < 900 ? 3 : v < 2000 ? 6 : 10; };
export const navalUsed = f => C.fleets.reduce((a, fl) => fl.owner === f ? a + fl.ships.reduce((b, s) => b + hullSize(f, s.t), 0) : a, 0) + Object.values(C.worlds).reduce((a, w) => w.owner === f ? a + w.sq.reduce((b, q) => b + hullSize(f, q.t), 0) : a, 0);
export const navalCap = f => { const ws = Object.values(C.worlds).filter(w => w.owner === f), yards = ws.map(w => w.lv.yard).sort((a, b) => b - a).slice(0, 4).reduce((a, v) => a + v, 0); // the four greatest yards
  return Math.round((20 + 8 * yards + 2 * ws.length + (ws.some(w => w.id === CAPITAL[f]) ? 15 : 0) + EC.CHARTER.cap * ((C.charters && C.charters[f]) || 0)) * TE.mod(f, 'naval')); };
export const navalMul = f => { const c = navalCap(f), u = navalUsed(f); return u > c ? 1 + 2 * (u - c) / c : 1; };
export const upkeep = fl => fl.ships.reduce((a, s) => a + (defsOf(fl.owner)[s.t]?.value || 50) * .006, 0) * (fl.ships.length > CM.capOf(fl) ? 1.5 : 1) * navalMul(fl.owner) * (fl.levy ? .3 : 1); /* a House pays most of its levy's keep */

// ---------------------------------------------------------------- economy
export function income(f) {
  const o = { he: 0, ore: 0, ord: 0, man: 0, food: 0, alloy: 0, rare: 0, inf: 0, sci: 0 };
  for (const id in C.worlds) { const w = C.worlds[id]; if (w.owner !== f) continue; const y = yieldOf(w); for (const k in o) o[k] += y[k]; }
  o.he += EC.tradeSummary(f).net;
  for (const r of EC.REGIONS) if (EC.holdsRegion(f, r)) { const B = EC.REGION_BONUS[r]; if (B.inf) o.inf += B.inf; if (B.sci) o.sci += B.sci; }
  o.inf -= EC.govsOf(f).length * 1.5; // governors keep households
  o.he -= EC.CHARTER.upkeep * ((C.charters && C.charters[f]) || 0);
  o.inf *= [.85, 1, 1.15, 1.25][C.tax ? C.tax[f] ?? 1 : 1]; // heavy taxes fill the coffers of influence too: the Silvers skim, and pay for it in favours
  o.inf -= EC.overSprawl(f); // an over-extended realm buys its administrators' loyalty
  // the realm eats: crews afloat and garrisons ashore; a world under blockade feeds only itself
  for (const fl of C.fleets) if (fl.owner === f) for (const s of fl.ships) o.food -= ((defsOf(f)[s.t] || {}).crew || 0) * s.crew / 400;
  for (const id in C.worlds) { const w = C.worlds[id]; if (w.owner !== f) continue; o.food -= w.garrison / 1000; if (w.siege) { const y = yieldOf(w); if (y.food > 0) o.food -= y.food; } }
  if (C.fac[f].res.food > 1000) o.man *= 1 + Math.min(.06, Math.floor((C.fac[f].res.food - 1000) / 500) * .01); // full granaries: more hands for the legions
  for (const fl of C.fleets) if (fl.owner === f) o.he -= upkeep(fl);
  o.man *= CM.wearyMan(f);
  return o;
}
export const yieldOf = w => EC.yieldOf(w, WK);
export const garrisonCap = w => Math.round(2200 * ((WORLDS.find(x => x.id === w.id).ground) || 1) * (isCap(w.id) ? 2.5 : 1) + 1000 * w.lv.barracks + 2500 * w.lv.fort) * (w.desig === 'legion' ? 1.2 : 1) * TE.mod(w.owner, 'garrison');
export const usedSlots = w => Object.keys(w.lv).filter(k => w.lv[k] > 0 || w.bq.some(q => q.k === k)).length - (w.baseN || 0); // a slot per building; upgrades are free of slots; what a world started with is free
export function canBuild(f, w, k) {
  const B = BUILD[k]; if (w.owner !== f || w.siege) return 'not while besieged';
  if (w.lv[k] + w.bq.filter(q => q.k === k).length >= B.max) return 'at its highest level';
  if (w.lv[k] === 0 && !w.bq.some(q => q.k === k) && usedSlots(w) >= w.slots) return 'no free building slots';
  if (B.needs && B.needs(w)) return B.needs(w);
  if ((k === 'mine' || k === 'farms') && bodyOf(w.id).gas) return 'a gas giant has no ground to dig or farm';
  if (k === 'arsenal' && w.lv.arsenal >= 1 && !w.lv.foundry) return 'level 2 needs a Foundry here';
  if (k === 'yard' && w.lv.yard >= 2 && !w.lv.foundry) return 'level 3 needs a Foundry here';
  if (k === 'yard' && w.demil > C.turn) return `demilitarized by treaty for ${w.demil - C.turn} more weeks`;
  if (k === 'grid' && w.lv.grid >= 1 && !w.lv.arsenal && !w.lv.foundry) return 'level 2 needs an Arsenal or Foundry here';
  const r = C.fac[f].res, X = EC.BLD[k] || {};
  if (r.ore < B.ore || r.he < B.he || (r.alloy || 0) < (X.alloy || 0) || (r.rare || 0) < (X.rare || 0)) return `need ${B.ore} ore, ${B.he} He-3${X.alloy ? ', ' + X.alloy + ' alloys' : ''}${X.rare ? ', ' + X.rare + ' rare metals' : ''}`;
  return null;
}
export function startBuild(f, w, k) { const e = canBuild(f, w, k); if (e) return e; const B = BUILD[k], r = C.fac[f].res, X = EC.BLD[k] || {}; r.ore -= B.ore; r.he -= B.he; r.alloy -= X.alloy || 0; r.rare -= X.rare || 0; w.bq.push({ k, left: B.t, paid: { ore: B.ore, he: B.he, alloy: X.alloy || 0, rare: X.rare || 0 } }); return null; }
// alloys and rare metals a hull needs, with Leviathan Keels taken off the capital keels
export const hullX = (f, t) => { const X = EC.HULL[t] || {}, k = (t === 'dread' || t === 'moonbreaker') ? TE.mod(f, 'dreadCost') : 1; return k === 1 ? X : Object.fromEntries(Object.entries(X).map(([a, v]) => [a, Math.round(v * k)])); };
export function hullOK(f, w, t, cls) {
  const d = defsOf(f)[t]; if (!d || d.static) return 'unknown hull';
  if (w.owner !== f) return 'not your world'; if (w.siege) return 'the yards are under siege';
  if (w.lv.yard < TIER(t)) return `needs a level ${TIER(t)} shipyard`;
  if (t === 'moonbreaker' && w.id !== 'venus' && w.id !== 'ganymede' && !TE.mod(f, 'mbAny')) return 'only the yards at Venus and Ganymede can lay down a moonBreaker';
  if (d.limit && (C.fleets.some(fl => fl.owner === f && fl.ships.some(s => s.t === t)) || Object.values(C.worlds).some(x => x.owner === f && x.sq.some(q => q.t === t)))) return 'one per side';
  const r = C.fac[f].res, p = hullCost(f, t, cls); if (r.he < p.he || r.ore < p.ore || r.man < p.man || (r.alloy || 0) < p.alloy || (r.rare || 0) < p.rare) return `need ${p.he} He-3 · ${p.ore} ore · ${Math.round(p.man).toLocaleString()} crew${p.alloy ? ' · ' + p.alloy + ' alloys' : ''}${p.rare ? ' · ' + p.rare + ' rare metals' : ''}`;
  if (w.sq.length >= 4 + TE.mod(f, 'yardQ')) return 'yard queue full';
  return null;
}
export const buildWeeks = (f, t, cls) => Math.max(1, Math.ceil(((defsOf(f)[t] || DEFS[t]).time || 10) / 12 * TE.mod(f, 'build') * (cls ? (TE.classSpec(f, cls) || { time: 1 }).time : 1)));
// what a hull of a class costs: the hull's price times what its fittings add
export function hullCost(f, t, cls) { const d = defsOf(f)[t], X = hullX(f, t), k = cls ? (TE.classSpec(f, cls) || { cost: 1 }).cost : 1; return { he: Math.round(d.cost * k), ore: Math.round(d.ore * k), man: d.man, alloy: Math.round((X.alloy || 0) * k), rare: Math.round((X.rare || 0) * k) }; }
export function orderShip(f, w, t, cls) { const c = TE.classById(f, cls); if (c && c.hull !== t) cls = null; const e = hullOK(f, w, t, cls); if (e) return e; const p = hullCost(f, t, cls), r = C.fac[f].res; for (const k in p) r[k] = (r[k] || 0) - p[k]; w.sq.push({ t, cls: cls || undefined, left: buildWeeks(f, t, cls), paid: p }); return null; }
// cancelling gives back everything paid, as Total War does: a building's last queued level, or a hull in the yards
const refund = (f, p) => { const r = C.fac[f].res; for (const [k, v] of Object.entries(p)) r[k] = (r[k] || 0) + v; };
export function cancelBuild(f, w, k) {
  if (w.owner !== f) return 'not your world'; let i = -1; for (let j = w.bq.length - 1; j >= 0; j--) if (w.bq[j].k === k) { i = j; break; } if (i < 0) return 'nothing queued';
  const q = w.bq[i], B = BUILD[q.k], X = EC.BLD[q.k] || {}; refund(f, q.paid || { ore: B.ore, he: B.he, alloy: X.alloy || 0, rare: X.rare || 0 }); w.bq.splice(i, 1); return null;
}
export function cancelShip(f, w, i) {
  if (w.owner !== f) return 'not your world'; const q = w.sq[i]; if (!q) return 'nothing in the yards';
  if (q.paid) refund(f, q.paid); else { const d = defsOf(f)[q.t], X = hullX(f, q.t); refund(f, { he: d.cost, ore: d.ore, man: d.man, alloy: X.alloy || 0, rare: X.rare || 0 }); }
  w.sq.splice(i, 1); return null;
}
export const roster = f => FACTIONS[BLOCS[f]].roster.flat().map(e => e[0]).filter(t => t !== 'starshell'); /* haulers salvage wreck fields */

const WANT = { he: 2500, ore: 2000, ord: 2500, man: 25000 };

// ---------------------------------------------------------------- orders
export function moveWeeks(fl, to, forced) {
  let n = travel(fl.at, to); if (n >= 3 && CM.has(fl, 'torch')) n--; if (n >= 4) n -= TE.mod(fl.owner, 'trip');
  if (fl.ships.length > CM.capOf(fl) * 1.25) n++; // an unwieldy armada moves slowly
  if (forced) n = Math.max(1, Math.ceil(n * .6));
  else if (fl.run === 'dark') n = Math.ceil(n * 1.5); // running dark: coasting with cold drives
  return n;
}
export const burnCost = (fl, to) => Math.round(fl.ships.length * 18 * travel(fl.at, to));
export function moveFleet(fl, to, forced) {
  if (fl.transit || fl.at === to) return 'already under way';
  if (forced) { const no = CM.refusesBurn(fl); if (no) { CM.grieve(no, 'Ordered to burn his crews', -4); return `${no.name} refuses: he will not burn his crews for this government`; } const r = C.fac[fl.owner].res, c = burnCost(fl, to); if (r.he < c) return `A forced burn needs ${c} He-3`; r.he -= c; for (const s of fl.ships) s.crew = Math.max(.3, s.crew - .05); }
  const n = moveWeeks(fl, to, forced); fl.transit = { from: fl.at, to, left: n, total: n, forced: !!forced, mode: forced ? 'hard' : fl.run === 'dark' ? 'dark' : 'burn' }; fl.at = null; fl.stance = null; return null;
}
// ---------------------------------------------------------------- interception
// weeks to a point in space from a world (the same rule as travel between worlds)
export function ptWeeks(fl, from, loc, sortie) { const d = IN.auDist(IN.posW(from), IN.locPos(loc)); let n = d < .04 ? 1 : sortie ? clamp(Math.round(.5 + Math.sqrt(d)), 1, 10) : clamp(Math.round(1 + 1.25 * Math.sqrt(d)), 1, 10); /* a sortie burns flat out for a point, with no orbit to make at the end */ if (fl.run === 'dark') n = Math.ceil(n * 1.5); return n; }
// can this fleet catch that one before it gets where it is going? the earliest week it can be at a point on their course
export function planIntercept(fl, tg) {
  if (fl.transit || fl.engage) return 'already under way'; if (!tg || !tg.transit || tg.engage) return 'they are not under way';
  if (!hostile(fl.owner, tg.owner)) return 'you are not at war with them';
  const lvl = IN.level(fl.owner, tg); if (!lvl) return 'you cannot see them';
  for (let w = 1; w < tg.transit.left; w++) {
    const loc = IN.aheadLoc(tg, w); if (ptWeeks(fl, fl.at, loc, true) > w) continue;
    const sc = fl.ships.filter(s => s.t === 'scout').length;
    const chance = clamp((lvl === 2 ? .9 : .55) * (1 - .08 * (w - 1)) * (IN.mode(tg) === 'dark' ? .6 : 1) + .05 * Math.min(2, sc) + (CM.has(fl, 'hunter') ? .08 : 0), .08, .95);
    return { w, loc, chance, lvl };
  }
  if (moveWeeks(fl, tg.transit.to) <= tg.transit.left && (C.worlds[tg.transit.to] || {}).owner !== tg.owner) return { meet: tg.transit.to, w: moveWeeks(fl, tg.transit.to) }; // too fast to catch on the way: be waiting where they are going
  return 'you cannot catch them on that heading';
}
export function orderIntercept(fl, tg) {
  const p = planIntercept(fl, tg); if (typeof p === 'string') return p;
  if (p.meet) { moveFleet(fl, p.meet); return null; }
  fl.transit = { from: fl.at, to: fl.at, p1: p.loc, left: p.w, total: p.w, mode: fl.run === 'dark' ? 'dark' : 'burn', sortie: { target: tg.id, chance: p.chance, to: tg.transit.to, w: p.w } };
  fl.at = null; fl.stance = null; return null;
}
const nearestWorld = loc => { const p = IN.locPos(loc); let best = null, bd = Infinity; for (const id in C.worlds) { const d = IN.auDist(p, IN.posW(id)); if (d < bd) { bd = d; best = id; } } return best; };
const terrainAt = loc => { const p = IN.locPos(loc), r = IN.helio(p); if (r < .85) return 'glare'; if (r > 2.1 && r < 3.4) return 'belt';
  for (const g of ['jupiter', 'saturn', 'uranus', 'neptune']) if (IN.auDist(p, IN.posW(g)) < .3) return 'giant'; return 'open'; };
// the interceptor reaches the point: it finds them, or it does not
function resolveSortie(fl) {
  const so = fl.transit.sortie, tg = C.fleets.find(x => x.id === so.target), home = fl.transit.from, mine = fl.owner === C.player;
  const back = msg => { fl.transit = { from: home, to: home, p0: fl.transit.p1, left: so.w, total: so.w, mode: fl.transit.mode, ret: true }; if (mine && msg) note(msg, 'warnc'); };
  if (!tg || !tg.transit || tg.engage || tg.transit.to !== so.to) { back(`${fl.name} reaches the intercept point, but the enemy has changed course. It turns for home.`); return; }
  const lvl = IN.level(fl.owner, tg), ch = so.chance * (lvl === 2 ? 1 : lvl === 1 ? .8 : .4);
  if (rnd() > ch) { back(`${fl.name} reaches the intercept point but cannot find the enemy in the dark. It turns for home.`); if (tg.owner === C.player) note(`${tg.name} slips past an enemy fleet sent to intercept it.`, 'good'); return; }
  const loc = JSON.parse(JSON.stringify(IN.fleetLoc(tg))), ambush = fl.transit.mode === 'dark' && IN.level(tg.owner, fl) === 0;
  const e = { id: C.nid++, loc, att: fl.owner, def: tg.owner, kind: ambush ? 'ambush' : 'meet', near: nearestWorld(loc), terrain: terrainAt(loc), turn: C.turn };
  // fleets of the same power keeping company with the target are caught with it
  const group = C.fleets.filter(o => friend(o.owner, tg.owner) && hostile(o.owner, fl.owner) && o.transit && !o.engage && o.transit.from === tg.transit.from && o.transit.to === tg.transit.to && o.transit.left === tg.transit.left);
  for (const o of group) o.engage = e.id; fl.engage = e.id;
  fl.transit = { from: home, to: home, p0: loc, left: so.w, total: so.w, mode: fl.transit.mode, ret: true }; // its way home, once this is settled
  C.engage = C.engage || []; C.engage.push(e);
  const where = `in deep space off ${bodyOf(e.near).name}`;
  if (mine) note(`${fl.name} intercepts ${tg.name} ${where}${ambush ? ', unseen until the guns open' : ''}.`, 'good', e.near);
  else if (tg.owner === C.player) note(`${tg.name} is intercepted ${where} by ${fl.name}${ambush ? ', an ambush out of the dark' : ''}!`, 'bad', e.near);
}
// the fleets fighting a conflict: in orbit at a world, or held together at a point in deep space
export const cfOwn = (cf, o) => cf.fleets ? C.fleets.filter(f => cf.fleets.includes(f.id) && (o == null || f.owner === o)) : cf.space ? C.fleets.filter(f => f.engage === cf.space.id && (o == null || f.owner === o)) : fleetsAt(cf.world, o);
// a coalition battle: each side is a list of powers; asking for one power's fleets gives its whole side
export const sideOf = (cf, o) => !cf || !cf.atts ? null : cf.atts.includes(o) ? cf.atts : cf.defs.includes(o) ? cf.defs : null;
export const foeSide = (cf, o) => { const L = sideOf(cf, o); return !L ? [o === cf.att ? cf.def : cf.att] : L === cf.atts ? cf.defs : cf.atts; };
export const cfFleets = (cf, o) => { if (o == null) return cfOwn(cf); const L = sideOf(cf, o) || [o]; return cfOwn(cf).filter(f => L.includes(f.owner)); };
const friend = (a, b) => a === b || relOf(a, b) === 'ally';
// who stands with whom: allies of a lead join it, and so does any power at war with the other lead and not with this one
function coalition(owners, attL, defL) {
  const atts = [attL], defs = [defL];
  for (const o of owners) {
    if (o === attL || o === defL || o === 'neu' || attL === 'neu' && defL === 'neu') continue;
    if ((friend(o, attL) && !friend(o, defL)) || (hostile(o, defL) && !hostile(o, attL) && !friend(o, defL))) { if (attL !== 'neu' && atts.every(x => !hostile(o, x))) atts.push(o); }
    else if ((friend(o, defL) && !friend(o, attL)) || (hostile(o, attL) && !hostile(o, defL))) { if (defL !== 'neu' && defs.every(x => !hostile(o, x))) defs.push(o); }
  }
  return { atts, defs };
}
// the player leads whichever side it fights on
const leadOf = (L, fallback) => L.includes(C.player) ? C.player : fallback;
// refits: at a shipyard of your own, change the fit of some hulls of a fleet
export function refitClassCost(fl, ids, id) { const o = { alloy: 0, he: 0 }, c = TE.classById(fl.owner, id); if (!id) { for (const s of fl.ships) if (ids.includes(s.id) && (s.cls || s.fit)) { const x = TE.fitCost(defsOf(fl.owner)[s.t]); o.alloy += x.alloy; o.he += x.he; } return o; } if (!c) return o; for (const s of fl.ships) if (ids.includes(s.id) && s.t === c.hull && s.cls !== id) { const x = TE.fitCost(defsOf(fl.owner)[s.t]); o.alloy += x.alloy; o.he += x.he; } return o; }
export function refitClass(fl, ids, id) {
  const e = canRefit(fl); if (e) return e;
  if (!id) { const k = refitClassCost(fl, ids, ''), r = C.fac[fl.owner].res; if (r.alloy < k.alloy || r.he < k.he) return `needs ${k.alloy} alloys and ${k.he} He-3`; let n = 0; for (const s of fl.ships) if (ids.includes(s.id) && (s.cls || s.fit)) { s.cls = undefined; s.fit = undefined; n++; } r.alloy -= k.alloy; r.he -= k.he; return n ? null : 'every hull here already has the standard fit'; }
  const c = TE.classById(fl.owner, id); if (!c) return 'no such class'; const k = refitClassCost(fl, ids, id), r = C.fac[fl.owner].res;
  if (r.alloy < k.alloy || r.he < k.he) return `needs ${k.alloy} alloys and ${k.he} He-3`;
  let n = 0; for (const s of fl.ships) if (ids.includes(s.id) && s.t === c.hull && s.cls !== id) { s.cls = id; s.fit = undefined; n++; }
  r.alloy -= k.alloy; r.he -= k.he; return n ? null : 'no ' + (defsOf(fl.owner)[c.hull] || {}).name + ' here to refit';
}
export function refitCost(fl, ids, k) { const o = { alloy: 0, he: 0 }; for (const s of fl.ships) if (ids.includes(s.id) && (s.fit || 'standard') !== k && TE.fitOK(fl.owner, defsOf(fl.owner)[s.t], k)) { const c = TE.fitCost(defsOf(fl.owner)[s.t]); o.alloy += k === 'standard' ? 0 : c.alloy; o.he += c.he; } return o; }
export function canRefit(fl) { const w = fl.at && C.worlds[fl.at]; if (fl.transit || !w || w.owner !== fl.owner) return 'only at a world of your own'; if (!w.lv.yard) return 'needs a shipyard'; if (w.siege) return 'not while besieged'; return null; }
export function refit(fl, ids, k) {
  const e = canRefit(fl); if (e) return e; const c = refitCost(fl, ids, k), r = C.fac[fl.owner].res;
  if (r.alloy < c.alloy || r.he < c.he) return `needs ${c.alloy} alloys and ${c.he} He-3`;
  let n = 0; for (const s of fl.ships) if (ids.includes(s.id) && (s.fit || 'standard') !== k && TE.fitOK(fl.owner, defsOf(fl.owner)[s.t], k)) { s.fit = k === 'standard' ? undefined : k; n++; }
  r.alloy -= c.alloy; r.he -= c.he; return n ? null : 'no hull here takes that fit';
}
// prize hulls broken up in a friendly yard or orbit: their plate and keels go back into the depots
export const scrapValue = (f, s) => { const d = defsOf(f)[s.t] || DEFS[s.t] || {}; return { ore: Math.round((d.ore || 60) * .55 * (.4 + .6 * s.hp)), alloy: Math.round(((EC.HULL[s.t] || {}).alloy || 0) * .5 * (.4 + .6 * s.hp)) }; };
export function scrapPrizes(fl, ids) {
  const w = fl.at && C.worlds[fl.at]; if (fl.transit || !w || w.owner !== fl.owner) return 'only in orbit at a world of your own';
  const L = fl.ships.filter(s => s.prize && (!ids || !ids.length || ids.includes(s.id))); if (!L.length) return 'no prize hulls to scrap';
  const r = C.fac[fl.owner].res, o = { ore: 0, alloy: 0, n: L.length }; for (const s of L) { const v = scrapValue(fl.owner, s); o.ore += v.ore; o.alloy += v.alloy; }
  r.ore += o.ore; r.alloy = (r.alloy || 0) + o.alloy; fl.ships = fl.ships.filter(s => !L.includes(s)); if (!fl.ships.length) { CM.relieve(fl, true); C.fleets = C.fleets.filter(f => f !== fl); }
  return o;
}
export function splitFleet(fl, ids) { const ships = fl.ships.filter(s => ids.includes(s.id)); if (!ships.length || ships.length === fl.ships.length) return null; fl.ships = fl.ships.filter(s => !ids.includes(s.id)); const nf = { id: C.nid++, owner: fl.owner, name: autoName(fl.owner), at: fl.at, transit: null, ships, orders: null }; C.fleets.push(nf); return nf; }
export function mergeFleets(a, b) { if (a.at !== b.at || a.transit || b.transit || a.owner !== b.owner || a === b) return; CM.onMerge(a, b); for (const g of C.agents || []) if (g.fleet === b.id) { if (AG.championOf(a)) { g.state = 'idle'; g.fleet = null; } else g.fleet = a.id; } a.ships.push(...b.ships); C.fleets.splice(C.fleets.indexOf(b), 1); }

// ---------------------------------------------------------------- turn resolution
// endTurn() advances everything, then returns the battles that must be fought; the caller resolves each
// (tactically or by autoResolve) and then calls finishTurn().
export function endTurn() {
  C.report = []; C.moves0 = Object.fromEntries(C.fleets.map(f => [f.id, JSON.parse(JSON.stringify(IN.fleetLoc(f) ?? null))])); /* where every fleet was, for the replay of the week's moves */
  CQ.levyOrders();
  const contested = contestedOrbits(); // where hostile fleets share an orbit as the week begins
  for (const f of ['rep', 'soc', 'rim']) if (C.fac[f].ai && C.fac[f].alive) aiTurn(f);
  pinInOrbit(contested); // and no one leaves those orbits without a fight
  // movement
  const sorties = [];
  for (const fl of C.fleets) if (fl.transit && !fl.engage) { fl.transit.left--; if (fl.transit.left === fl.transit.total - 1 && !fl.transit.sortie && !fl.transit.p0) CM.beltRaids(fl); if (fl.transit.left <= 0) { if (fl.transit.sortie) { sorties.push(fl); continue; } fl.at = fl.transit.to; fl.transit = null; arrive(fl); } }
  for (const fl of sorties) resolveSortie(fl);
  C.fleets = C.fleets.filter(f => f.ships.length);
  CM.intercepts();
  // merge same-owner fleets that sit together only for the AI (the player keeps his formations)
  for (const f of ['rep', 'soc', 'rim', 'neu']) if (C.fac[f].ai) for (const id in C.worlds) { const here = fleetsAt(id, f).filter(x => !x.garrison && !x.levy && !x.raid).sort((a, b) => CM.capOf(b) - CM.capOf(a)); for (let i = 1; i < here.length; i++) if (here[0].ships.length + here[i].ships.length <= CM.capOf(here[0])) mergeFleets(here[0], here[i]); }
  CM.tidy(); EC.govTick();
  const out = conflicts(); IN.scanAll(); return out;
}
// A fleet that shares an orbit with an enemy fleet cannot simply sail away from it: the week's battle is fought there
// first. Its orders stand, and it goes once the enemy is gone; to break away it must take the battle's Withdraw.
// A fleet running dark slips out (that is what running dark is for), and raiders keep their hit-and-run.
function contestedOrbits() {
  const out = new Map(), leaving = fl => fl.transit && !fl.engage && fl.transit.left === fl.transit.total; // ordered out this week, not yet gone
  for (const id in C.worlds) { const here = C.fleets.filter(fl => fl.ships.length && (fl.at === id && !fl.transit || leaving(fl) && fl.transit.from === id)); if (here.length < 2) continue;
    for (const fl of here) if (here.some(o => o.owner !== fl.owner && hostile(o.owner, fl.owner))) out.set(fl.id, id); }
  return out;
}
function pinInOrbit(contested) {
  for (const fl of C.fleets) { const id = contested.get(fl.id); const t = fl.transit;
    if (!id || !t || t.from !== id || t.left !== t.total || t.retreat || fl.engage || fl.run === 'dark' || fl.raid === id) continue; // a beaten fleet falling back has already fought its way out
    if (![...contested].some(([oid, w]) => w === id && (o => o && o.owner !== fl.owner && hostile(o.owner, fl.owner) && o.ships.length && !(o.run === 'dark' && o.transit))(C.fleets.find(x => x.id === oid)))) continue; // only a dark-running enemy has slipped away
    fl.held = t; fl.at = id; fl.transit = null;
    if (fl.owner === C.player) note(`${fl.name} is held in orbit at ${bodyOf(id).name} by the enemy: it must fight its way out first. Its orders stand.`, 'bad', id);
    else if (fleetsAt(id, C.player).length) note(`${fl.name} tried to slip away from ${bodyOf(id).name}, and is held in orbit by our ships.`, 'gold', id);
  }
}
// after the week's battles: a fleet that was held goes on its way, if it still can
function releaseHeld() {
  for (const fl of C.fleets) { if (!fl.held) continue; const t = fl.held; fl.held = null;
    if (fl.transit || fl.at !== t.from || !fl.ships.length) continue; // it withdrew, retreated or died
    if (fleetsAt(fl.at).some(o => o.owner !== fl.owner && hostile(o.owner, fl.owner) && o.ships.length)) continue; // still pinned: it fights again next week
    moveFleet(fl, t.to, t.forced); }
}
function arrive(fl) { const w = C.worlds[fl.at]; CQ.onArrive(fl); if (fl.owner === C.player) note(`${fl.name} arrives at ${bodyOf(fl.at).name}.`, '', fl.at); if (w && hostile(fl.owner, w.owner) && fl.owner !== C.player && w.owner === C.player) note(`Enemy fleet ${fl.name} (${BLOC_NAME[fl.owner]}) has reached ${bodyOf(fl.at).name}!`, 'bad', fl.at); }
export function conflicts() { // worlds where hostile fleets share orbit, or a fleet sits over a hostile world
  const out = [];
  for (const id in C.worlds) {
    const here = fleetsAt(id); if (!here.length) continue; const owners = [...new Set(here.map(f => f.owner))];
    const w = C.worlds[id];
    // the world's holder defends if it has ships here; otherwise whoever holds the orbit
    const defO = owners.includes(w.owner) ? w.owner : owners.find(o => w.owner !== 'neu' && relOf(o, w.owner) === 'ally') || owners.slice().sort((a, b) => sumStr(id, b) - sumStr(id, a))[0];
    const foes = owners.filter(o => hostile(o, defO)).sort((a, b) => sumStr(id, b) - sumStr(id, a));
    if (foes.length) { const { atts, defs } = coalition(owners, foes[0], defO), ww = defs.includes(w.owner) || (w.owner !== 'neu' && defs.some(o => relOf(o, w.owner) === 'ally') && hostile(foes[0], w.owner));
      out.push({ world: id, att: leadOf(atts, foes[0]), def: leadOf(defs, defO), atts, defs, withWorld: ww }); continue; }
    // no fleet battle: a power over a hostile world fights its platforms and orbital authority, or simply lays siege
    const raidOnly = o => here.filter(f => f.owner === o).every(f => f.raid === id); /* raiders strike and run: no siege, no fight with the platforms */
    const att = owners.find(o => hostile(o, w.owner) && !(w.siege && w.siege.by === o) && !raidOnly(o)); if (!att || owners.includes(w.owner)) continue;
    const atts = [att].concat(owners.filter(o => o !== att && o !== 'neu' && hostile(o, w.owner) && !hostile(o, att)));
    if (w.gun + w.shield > 0 || w.gov > .3) out.push({ world: id, att: leadOf(atts, att), def: w.owner, atts, defs: [w.owner], withWorld: true, alone: true });
    else { newSiege(w, att); if (w.owner === C.player) note(`${bodyOf(id).name} is under siege!`, 'bad', id); else if (att === C.player) note(`${bodyOf(id).name} lies open. Hold orbit a week, then drop the Iron Rain.`, 'gold', id); }
  }
  // battles in deep space, where a fleet was intercepted
  for (const e of (C.engage || []).slice()) {
    const os = [...new Set(C.fleets.filter(f => f.engage === e.id).map(f => f.owner))], atts = [e.att].concat(os.filter(o => o !== e.att && o !== e.def && friend(o, e.att))), defs = [e.def].concat(os.filter(o => o !== e.att && o !== e.def && !atts.includes(o) && friend(o, e.def)));
    const cf = { world: e.near, space: e, att: leadOf(atts, e.att), def: leadOf(defs, e.def), atts, defs, withWorld: false };
    if (cfFleets(cf, e.att).length && cfFleets(cf, e.def).length && hostile(e.att, e.def)) out.push(cf); else endEngagement(e);
  }
  C._shipN = shipCount();
  return out;
}
const shipCount = () => { const n = {}; for (const f of C.fleets) n[f.owner] = (n[f.owner] || 0) + f.ships.length; return n; };
// the n-th battle at a world: "the Second Battle of ...", in words to the twentieth and "22nd", "23rd" after
const nth = n => n <= ORD.length ? ORD[n - 1] : n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
// a battle enters the chronicle: its name, who led, who won, what it cost
function chronBattle(res, winner, loser, leads) {
  const now = shipCount(), was = C._shipN || now, lw = Math.max(0, (was[winner] || 0) - (now[winner] || 0)), ll = Math.max(0, (was[loser] || 0) - (now[loser] || 0)); C._shipN = now;
  const big = lw + ll >= 3 || ((winner === C.player || loser === C.player || leads.some(Boolean)) && lw + ll > 0); if (!big) return;
  C.battleN = C.battleN || {}; const key = (res.space ? 'off:' : '') + res.world, n = C.battleN[key] = (C.battleN[key] || 0) + 1;
  const name = `${n > 1 ? 'the ' + nth(n) + ' ' : ''}${res.space ? 'Battle off ' : 'Battle of '}${bodyOf(res.world).name}`, cap = name[0].toUpperCase() + name.slice(1);
  const who = (o, c) => `${BLOC_NAME[o] || 'Independents'}${c ? ' under ' + c : ''}`;
  chron('battle', `${cap}: ${who(winner, leads[0])} ${res.withdrew ? 'drives off' : 'defeats'} ${who(loser, leads[1])}, losing ${lw} ship${lw === 1 ? '' : 's'} to their ${ll}.`, res.world, winner);
}
export function endEngagement(e) { for (const f of C.fleets) if (f.engage === e.id) f.engage = null; C.engage = (C.engage || []).filter(x => x !== e); }
const sumStr = (id, o) => fleetsAt(id, o).reduce((a, f) => a + fleetStr(f), 0);
// auto-resolve: strength with a random swing; the loser takes heavy losses and retreats, the winner light ones
// ---------------------------------------------------------------- wreck fields
// a battle that kills many hulls leaves a field of wrecks for some weeks: cover for the next battle there, and
// salvage for haulers in orbit
export function leaveWrecks(res, lostV, n) {
  if (n < 4 && lostV < 1600) return null; C.wrecks = C.wrecks || {};
  const key = res.space ? 'sp' + res.space.id : res.world, old = C.wrecks[key];
  const W = C.wrecks[key] = { key, loc: res.space ? JSON.parse(JSON.stringify(res.space.loc)) : res.world, at: res.space ? null : res.world, near: res.world, ore: Math.round((old ? old.ore : 0) + lostV * .22), alloy: Math.round((old ? old.alloy : 0) + lostV * .05), n: (old ? old.n : 0) + n, until: C.turn + 10 + Math.min(10, Math.round(n / 2)), t: C.turn };
  syncWrecks(); return W;
}
export const wreckAt = id => (C.wrecks || {})[id] || null;
export function wreckNear(loc) { if (!C.wrecks) return null; const p = IN.locPos(loc); for (const k in C.wrecks) { const W = C.wrecks[k]; if (W.at) continue; if (IN.auDist(IN.locPos(W.loc), p) < .12) return W; } return null; }
function syncWrecks() { for (const k in TRN.OVER) delete TRN.OVER[k]; for (const k in C.wrecks || {}) { const W = C.wrecks[k]; if (W.at) TRN.OVER[W.at] = 'wrecks'; } }
function wreckTick() {
  for (const k in C.wrecks || {}) {
    const W = C.wrecks[k];
    if (W.at) {
      // haulers in orbit strip the hulks; a yard's dock crews take a little on their own
      const fls = fleetsAt(W.at), w = C.worlds[W.at], take = {};
      for (const fl of fls) { const h = fl.ships.filter(s => s.t === 'hauler').length + fl.ships.filter(s => s.t === 'tender').length * .5; if (h) take[fl.owner] = (take[fl.owner] || 0) + h; }
      if (w && w.owner !== 'neu' && w.lv.yard && !w.siege) take[w.owner] = (take[w.owner] || 0) + .4;
      for (const o in take) { if (!C.fac[o] || o === 'neu') continue; const ore = Math.min(W.ore, Math.round(70 * take[o])), alloy = Math.min(W.alloy, Math.round(14 * take[o])); if (ore + alloy <= 0) continue; W.ore -= ore; W.alloy -= alloy; C.fac[o].res.ore += ore; C.fac[o].res.alloy = (C.fac[o].res.alloy || 0) + alloy;
        if (o === C.player && !W.told) { W.told = true; note(`Haulers strip the wreck field at ${bodyOf(W.at).name}: +${ore} ore, +${alloy} alloys this week.`, 'good', W.at); } }
    }
    if (C.turn >= W.until || W.ore + W.alloy <= 0) delete C.wrecks[k];
  }
  syncWrecks();
}
// ---------------------------------------------------------------- auto-resolve
// Each side's fighting strength (fleets, plus the world's platforms and authority for the holder) is rolled with a
// little luck. The loser of the roll loses most; the winner's losses shrink fast as its margin grows, so a bigger
// fleet bleeds less, not more. Damage is shared out across hulls by size: escorts die first, capital ships soak
// hits, and a capital ship can only be destroyed by an enemy at least 60% of its own worth.
const sval = (o, s) => { const d = defsOf(o)[s.t] || DEFS[s.t]; return d.value || d.cost || 50; };
function resolveCore(sides, world, rng) {
  // sides: [{ o, ships, extra }] where extra = the world's defensive strength (holder only)
  const ow = (sd, s) => (sd.own && sd.own.get(s)) || sd.o;
  const str = sides.map(sd => sd.ships.reduce((a, s) => a + shipVal(ow(sd, s), s), 0) * (sd.mul || 1) + (sd.extra || 0));
  const roll = str.map(v => v * (.85 + rng() * .3));
  const win = roll[0] > roll[1] ? 0 : 1, lose = 1 - win, r = Math.max(1, roll[win] / Math.max(1, roll[lose]));
  const frac = [0, 0]; frac[lose] = clamp(.4 + .22 * (r - 1), .4, .9); frac[win] = clamp(.32 / Math.pow(r, 1.4), .015, .32);
  for (const i of [0, 1]) if (sides[i].shield) frac[i] *= .75;
  const dead = [[], []];
  for (const i of [0, 1]) {
    const sd = sides[i], foe = str[1 - i]; let pool = frac[i] * str[i];
    // the world's platforms absorb a share of what is aimed at the holder
    if (sd.extra) pool *= str[i] > 0 ? (str[i] - sd.extra) / str[i] : 0;
    const L = sd.ships.filter(s => s.hp > 0); if (!L.length || pool <= 0) continue;
    const wgt = L.map(s => Math.pow(sval(ow(sd, s), s), .6)), tw = wgt.reduce((a, v) => a + v, 0);
    const chunks = Math.ceil(L.length * .55) + 1, per = pool / chunks; // fire is concentrated: a few hulls take most of it
    for (let k = 0; k < chunks; k++) {
      let x = rng() * tw, j = 0; while (j < L.length - 1 && (x -= wgt[j]) > 0) j++;
      const s = L[j]; if (s.hp <= 0) continue; const v = sval(ow(sd, s), s);
      const dmg = per * (.4 + rng() * 1.2); s.hp -= dmg / v; s.crew = clamp(s.crew - dmg / v * .35, .15, 1);
      if (s.hp <= 0 || (s.hp < .25 && rng() < .55)) { if (foe < v * .6) s.hp = .06; else { s.hp = 0; dead[i].push(s); } }
    }
    for (const s of L) if (s.hp > 0) { s.hp = clamp(s.hp, .05, 1); s.ammo = clamp(s.ammo - (i === win ? .12 : .25) - rng() * .2, 0, 1); if (sides[1 - i].ships.length && i === win && rng() < .1) s.rank = Math.min(3, (s.rank || 0) + 1); } // veterans are made in hard fights: a tenth of a winning fleet's hulls // no veterancy from shooting at platforms alone
  }
  return { win, r, dead };
}
// each side of a battle: every hull of every power on it (each keeps its own owner), the world's defences for the holder,
// and fleets a week out that arrive while the battle is joined
const sidesOf = (cf, clone) => { const w = C.worlds[cf.world], amb = cf.space && cf.space.kind === 'ambush';
  return [cf.att, cf.def].map((o, i) => { const fls = cfFleets(cf, o), side = sideOf(cf, o) || [o], tot = fls.reduce((a, f) => a + fleetStr(f), 0) || 1, own = new Map(), ships = [];
    for (const f of fls) for (const s0 of f.ships) { const s = clone ? Object.assign({}, s0) : s0; own.set(s, f.owner); ships.push(s); }
    const inc = cf.space ? [] : C.fleets.filter(f => side.includes(f.owner) && f.transit && !f.transit.retreat && f.transit.to === cf.world && f.transit.left === 1 && !f.engage); /* a week out: they arrive while the battle is joined */
    return { o, os: side, own, ships, extra: (i === 1 && cf.withWorld ? defStr(w) : 0) + inc.reduce((a, f) => a + fleetStr(f) * .7, 0), reinf: inc.length, mul: fls.reduce((a, f) => a + fleetStr(f) * CM.arMul(f) * TE.arMul(f.owner), 0) / tot * (amb && i === 0 ? 1.25 : 1) * (CQ.fears(o, i === 0 ? cf.def : cf.att) ? .93 : 1) * ((cf.parley && cf.parley.mul[i]) || 1) /* what the parley left: a champion's win, a refused challenge */, shield: i === 1 && fls.some(f => CM.has(f, 'shield')) }; }); };
// the forecast the pre-battle screen shows: a few hundred dry runs of the same battle
export const canWithdraw = (world, o) => !(C.withdrawn && C.withdrawn[world + '|' + o] === C.turn - 1);
export function forecastBattle(cf, n = 300) {
  const ids = sidesOf(cf, false).map(sd => sd.ships.map(s => s.id)); let attWins = 0; const died = {}, lost = [0, 0], hp = {};
  for (let k = 0; k < n; k++) {
    const sides = sidesOf(cf, true), res = resolveCore(sides, cf.world, rnd);
    if (res.win === 0) attWins++;
    for (const i of [0, 1]) { lost[i] += res.dead[i].length; for (const s of sides[i].ships) { if (s.hp <= 0) died[s.id] = (died[s.id] || 0) + 1; hp[s.id] = (hp[s.id] || 0) + Math.max(0, s.hp); } }
  }
  const dieP = {}, hpE = {}; for (const L of ids) for (const id of L) { dieP[id] = (died[id] || 0) / n; hpE[id] = hp[id] / n; }
  return { attWin: attWins / n, lost: lost.map(v => v / n), dieP, hpE };
}
export const trivial = cf => { if (!cf.alone || cf.space) return false; const w = C.worlds[cf.world], a = cfFleets(cf, cf.att).reduce((x, f) => x + fleetStr(f), 0); return defStr(w) < a * .15; };
export function autoResolve(cf) {
  const w = C.worlds[cf.world], sides = sidesOf(cf, false), res = resolveCore(sides, cf.world, rnd), attWin = res.win === 0;
  let lostV = 0; for (const i of [0, 1]) for (const s of res.dead[i]) { const o = sides[i].own.get(s) || sides[i].o; CM.weary(o, sval(o, s) / 700); lostV += sval(o, s); }
  leaveWrecks(cf, lostV, res.dead[0].length + res.dead[1].length);
  for (const f of cfFleets(cf)) if (f.ships.length && f.ships.every(s => s.hp <= 0)) CM.fleetLost(f, (sideOf(cf, cf.att) || [cf.att]).includes(f.owner) ? cf.def : cf.att);
  for (const f of C.fleets) f.ships = f.ships.filter(s => s.hp > 0);
  if (cf.withWorld) {
    // the attacker's guns fall on the platforms too; a beaten attacker still knocks some out
    const n = w.gun + w.shield, k = attWin ? clamp(.25 + .2 * (res.r - 1), .25, .9) : clamp(.12 / res.r, .03, .15);
    let kill = Math.round(n * k * (.8 + rnd() * .4)); while (kill-- > 0 && w.gun + w.shield > 0) { if (w.gun && (rnd() < .6 || !w.shield)) w.gun--; else w.shield--; }
    if (attWin) w.gov = Math.max(.1, w.gov - .2 - .1 * Math.min(3, res.r - 1));
  }
  const lossF = [0, 1].map(i => { const tot = sides[i].ships.reduce((a, s) => a + sval(sides[i].own.get(s) || sides[i].o, s), 0) || 1; return res.dead[i].reduce((a, s) => a + sval(sides[i].own.get(s) || sides[i].o, s), 0) / tot; });
  const out = { attWin, world: cf.world, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, margin: res.r, space: cf.space, lossF };
  afterBattle(out); return out;
}
// how big the victory was: the share of each side's strength lost (lossF, [attacker, defender]), the rout and the
// prizes. A victory that cost more than it won is Pyrrhic; a fleet broken and taken is an Annihilation. Auto-resolve
// never rises above Victory: the big grades are won by fighting the battle
export const GRADES = {
  pyrrhic: { name: 'Pyrrhic victory', react: .5, defeat: .7, weary: 0, inf: 0, xp: 0, text: 'Won, at a price the court will count' },
  victory: { name: 'Victory', react: 1, defeat: 1, weary: 1, inf: 4, xp: 0, text: 'The field is ours' },
  decisive: { name: 'Decisive victory', react: 1.6, defeat: 1.4, weary: 3, inf: 10, xp: 20, text: 'Their line broken, ours whole' },
  annihilation: { name: 'Annihilation', react: 2.2, defeat: 1.8, weary: 6, inf: 20, xp: 40, text: 'Their fleet is gone from the board' },
};
export function gradeOf(res) {
  if (res.withdrew || !res.lossF) return null;
  const wi = res.attWin ? 0 : 1, won = res.lossF[wi], lost = res.lossF[1 - wi], prizes = res.captured || 0;
  let g = 'victory';
  if (won >= .45 || (won > .15 && won > lost)) g = 'pyrrhic';
  else if ((lost >= .85 || (prizes >= 2 && lost >= .6)) && won <= .2) g = 'annihilation';
  else if (lost >= .5 && won <= .25 && lost >= won * 2.5) g = 'decisive';
  if (!res.tactical && (g === 'decisive' || g === 'annihilation')) g = 'victory';
  return g;
}
// whoever lost the field falls back to their nearest world; the winner holds orbit (and lays siege if the world is hostile)
export function afterBattle(res) {
  res.grade = gradeOf(res); const GR = GRADES[res.grade] || GRADES.victory;
  const loser = res.attWin ? res.def : res.att, winner = res.attWin ? res.att : res.def, w = C.worlds[res.world];
  const A = res.atts || [res.att], D = res.defs || [res.def], wins = res.attWin ? A : D, loses = res.attWin ? D : A; res.wins = wins; res.loses = loses;
  const here = o => { const L = o === winner ? wins : o === loser ? loses : [o]; return res.space ? C.fleets.filter(f => f.engage === res.space.id && L.includes(f.owner)) : C.fleets.filter(f => f.at === res.world && !f.transit && L.includes(f.owner)); };
  const leadOf = o => { const fl = here(o).filter(f => f.ships.length && CM.cmdrOf(f)).sort((a, b) => b.ships.length - a.ships.length)[0]; return fl ? CM.cmdrOf(fl).name : null; }, leads = [leadOf(winner), leadOf(loser)];
  // the cost of falling back: a fleet that breaks contact under fire loses its cripples; one that slips away
  // before the battle still takes hits on the way out, and cannot do it twice running against the same foe
  for (const f of here(loser)) {
    if (res.terms) continue; // terms agreed at the parley: they leave unharmed
    if (res.withdrew) { for (const s of f.ships) s.hp = clamp(s.hp - .08 - rnd() * .1, .05, 1); }
    else if (!res.tactical) { const m = clamp((res.margin || 1.5) - .6, .2, 1.2) * (here(winner).some(o => CM.has(o, 'hunter')) ? 1.35 : 1); for (const s of f.ships) { if (s.hp < .35 && rnd() < .45 * m) s.hp = 0; else s.hp = clamp(s.hp - rnd() * .1 * m, .05, 1); } f.ships = f.ships.filter(s => s.hp > 0); }
  }
  if (res.space) { afterSpace(res, winner, loser); chronBattle(res, winner, loser, leads); return; }
  if (res.withdrew && !res.terms) { C.withdrawn = C.withdrawn || {}; for (const o of loses) C.withdrawn[res.world + '|' + o] = C.turn; }
  /* every losing power falls back to a world of its own */
  for (const f of here(loser)) { if (!f.ships.length) continue; const home = nearestOwned(f.owner, res.world); if (home) { f.at = null; const n = travel(res.world, home); f.transit = { from: res.world, to: home, left: n, total: n, retreat: true, bat: res.world + '|' + C.turn }; } else if (w.owner !== f.owner) f.ships = []; else { f.bat = res.world + '|' + C.turn; if (!bottled(f) && (f.owner === C.player || wins.includes(C.player))) note(`${f.name} is bottled up over ${bodyOf(res.world).name}: beaten, with nowhere to run, it cannot hold the orbit against the siege.`, f.owner === C.player ? 'bad' : 'gold', res.world); f.bottled = res.world; } }
  // nowhere to run: besieged in port. A fleet beaten over its last world is bottled up there: it fights on each week, but
  // it no longer holds the orbit, so the siege goes on and the Iron Rain can fall. Winning a battle frees it.
  for (const f of here(winner)) delete f.bottled;
  C.fleets = C.fleets.filter(f => f.ships.length);
  const nm = bodyOf(res.world).name, me = C.player;
  const allies = L => L.length > 1 ? ` and ${L.length === 2 ? 'its ally' : 'its allies'}` : '';
  if (winner === me) note(`Victory at ${nm}: ${BLOC_NAME[loser]}${allies(loses)} ${loses.length > 1 ? 'fall' : 'falls'} back.`, 'good', res.world);
  else if (loser === me) note(`Defeat at ${nm}: our ships${loses.length > 1 ? ' and our allies\u2019' : ''} withdraw.`, 'bad', res.world);
  else if (wins.includes(me)) note(`Victory at ${nm}: our ships fight beside ${BLOC_NAME[winner]}, and ${BLOC_NAME[loser]} falls back.`, 'good', res.world);
  else if (loses.includes(me)) note(`Defeat at ${nm}: ${BLOC_NAME[loser]} is beaten, and our ships fall back with it.`, 'bad', res.world);
  else if (winner !== 'neu' && loser !== 'neu') note(`${BLOC_NAME[winner]} defeats ${BLOC_NAME[loser]} at ${nm}.`, '', res.world);
  CM.battleFate(Object.assign({}, res, { margin: res.margin })); RV.afterBattle(res); if (!res.withdrew) { for (const o of wins) P.react(o, 'victory', (o === winner ? 1 : .5) * GR.react); for (const o of loses) P.react(o, 'defeat', (o === loser ? 1 : .5) * GR.defeat); for (const f of C.fleets) if (loses.includes(f.owner) && f.transit && f.transit.bat === res.world + '|' + C.turn) AG.battleLost(f); gradeSpoils(res, GR, winner, loser, here(winner)); }
  chronBattle(res, winner, loser, leads); aiTally(res, w);
  // the winner lays siege; a siege left by a power whose ships are no longer here passes to the winner
  if (hostile(winner, w.owner) && (!w.siege || (w.siege.by !== winner && !fleetsAt(res.world, w.siege.by).length))) { newSiege(w, winner); if (w.owner === me) note(`${nm} is under siege!`, 'bad', res.world); else if (winner === me) note(`${nm} is under siege. Bring troops for an Iron Rain.`, 'gold', res.world); }
}
// after a battle in deep space: the intercepted fleet goes on (it won, or slipped past) or turns for home; the
// interceptor goes home either way
function afterSpace(res, winner, loser) {
  const e = res.space, nmS = `in deep space off ${bodyOf(e.near).name}`, me = C.player;
  for (const f of C.fleets) if (f.engage === e.id) f.batE = e.id; // who fought, for the commanders' reckoning
  for (const f of C.fleets.filter(x => x.engage === e.id)) {
    f.engage = null; f.ships = f.ships.filter(s => s.hp > 0); if (!f.ships.length) continue;
    if ((res.defs || [e.def]).includes(f.owner) && res.attWin && !res.withdrew && !res.through && !res.timeout) {
      const home = nearestOwned(f.owner, e.near); if (!home) { f.ships = []; continue; }
      const n = ptWeeks(f, home, e.loc); f.transit = { from: f.transit.from, to: home, p0: e.loc, left: n, total: n, mode: 'burn', retreat: true, bat: e.near + '|' + C.turn };
    } else if ((res.defs || [e.def]).includes(f.owner) && (res.withdrew || res.through || res.timeout) && f.owner === me) note(`${f.name} breaks through and holds its course for ${bodyOf(f.transit.to).name}.`, 'gold');
  }
  C.fleets = C.fleets.filter(f => f.ships.length); C.engage = (C.engage || []).filter(x => x !== e);
  if (res.through || res.timeout) { if (loser === me) note(res.through ? `The enemy breaks through our line ${nmS} and holds its course.` : `We lose them in the dark ${nmS}: the enemy slips away.`, 'bad', e.near); }
  else if (winner === me) note(`Victory ${nmS}: ${BLOC_NAME[loser]} ${res.withdrew ? 'breaks off' : 'is beaten'}.`, 'good', e.near);
  else if (loser === me) note(`Defeat ${nmS}.`, 'bad', e.near);
  CM.battleFate(Object.assign({}, res, { margin: res.margin })); RV.afterBattle(res); if (!res.withdrew) { const GR = GRADES[res.grade] || GRADES.victory; for (const o of res.wins || [winner]) P.react(o, 'victory', (o === winner ? 1 : .5) * GR.react); for (const o of res.loses || [loser]) P.react(o, 'defeat', (o === loser ? 1 : .5) * GR.defeat); gradeSpoils(res, GR, winner, loser, C.fleets.filter(f => f.batE === e.id && (res.wins || [winner]).includes(f.owner))); }
}
// what the grade of a victory is worth beyond the court's mood: the loser's war-weariness, the winner's influence,
// and the winning commanders' standing
function gradeSpoils(res, GR, winner, loser, fls) {
  if (winner !== 'neu' && C.fac[winner] && C.fac[winner].res) C.fac[winner].res.inf = (C.fac[winner].res.inf || 0) + GR.inf;
  if (GR.weary) CM.weary(loser, GR.weary);
  if (GR.xp) for (const f of fls) { const c = CM.cmdrOf(f); if (c) CM.gainXp(c, GR.xp); }
  res.spoils = { inf: winner === 'neu' ? 0 : GR.inf, weary: loser === 'neu' ? 0 : GR.weary, xp: GR.xp };
}
export const bottled = fl => !!fl.bottled && fl.bottled === fl.at && !fl.transit;
const nearestOwned = (f, from) => { let best = null, bd = 99; for (const id in C.worlds) if (C.worlds[id].owner === f && id !== from) { const d = travel(from, id); if (d < bd) { bd = d; best = id; } } return best; };

const rainBonus = (fl, w) => TE.mod(fl.owner, 'rain') * AG.rainMul(fl) * (CM.has(fl, 'rain') ? 1.3 : 1) * (1 + .1 * ((w.siege && w.siege.staged) || 0));
// the Iron Rain fought as a battle (battle.js, ops.js): the garrison's strength on the ground, as ironRain0 reckons it,
// and what each landed trooper is worth; storming the walls before they are broken lands half
export function assaultCtx(fl) {
  const w = C.worlds[fl.at], storm = w.siege && w.siege.by === fl.owner && (w.siege.hold || 0) > 0, dmul = (1.25 + .2 * w.lv.fort) * (((w.cl ? w.cl.war : w.loyalty) + 8) / 70);
  return { def: w.garrison * dmul, g: w.garrison, dmul, mul: rainBonus(fl, w) * (storm ? .5 : 1), storm };
}
// a failed assault: what is left of the garrison holds, and the siege goes on
export function assaultFailed(w, left, by) { w.garrison = Math.round(Math.max(200, left)); note(`The assault on ${bodyOf(w.id).name} fails: the garrison holds the ground.`, by === C.player ? 'bad' : w.owner === C.player ? 'good' : '', w.id); chron('battle', `The assault from orbit on ${bodyOf(w.id).name} fails.`, w.id, w.owner); }
// the odds of an Iron Rain from this fleet now, and how many more troops would make it an even fight
export function rainOdds(fl) {
  const w = fl.at && C.worlds[fl.at]; if (!w || !hostile(fl.owner, w.owner)) return { err: 'No hostile world here' };
  const troops = troopsOf(fl); if (troops < 50) return { err: 'No troops aboard: starShells and leechCraft take the beachhead, Storks land the legions' };
  if (fleetsAt(fl.at).some(o => o.owner === w.owner && !bottled(o))) return { err: 'Win the orbit first', troops };
  const storm = w.siege && w.siege.by === fl.owner && (w.siege.hold || 0) > 0, shot = clamp(w.gun * .12 + w.shield * .05, 0, .6), mul = 5 * (1 - shot) * rainBonus(fl, w) * (storm ? .5 : 1);
  const def = w.garrison * (1.25 + .2 * w.lv.fort) * (((w.cl ? w.cl.war : w.loyalty) + 8) / 70), att = troops * mul;
  const chance = clamp((1.25 - def / att) / .5, 0, 1), need = Math.max(0, Math.ceil(def / mul - troops));
  if (!w.siege || w.siege.by !== fl.owner || w.siege.turns < 1) return { err: 'Hold the siege a week first', troops, chance, need, shot, def };
  return { troops, shot, chance, need, def, storm, hold: storm ? Math.ceil(w.siege.hold) : 0 };
}
// Iron Rain: troops dropped from orbit against the garrison. Platforms still up shoot drop-ships down on the way in.
// the Republic's Senate voted to hold the siege of Mercury: a Rain dropped there defies it
export function senateDefied(f, wid) {
  if (f !== 'rep' || !C.senateHold || C.senateHold.world !== wid) return false;
  C.senateHold = null; C.events = C.events || {}; C.events.rainDefied = C.turn; P.react('rep', 'defy', 1.2);
  if (f === C.player) note(`The Rain falls on ${bodyOf(wid).name} against the Senate's vote. The Vox Populi and the Moderates turn on the government; Dancer will move to recall the ArchImperator.`, 'bad', wid);
  return true;
}
export function ironRain(fl) { const out = ironRain0(fl); C.fleets = C.fleets.filter(f => f.ships.length); CM.tidy(); EC.govTick(); return out; }
function ironRain0(fl) {
  const w = C.worlds[fl.at]; if (!w || !hostile(fl.owner, w.owner)) return { err: 'nothing to invade here' };
  if (fleetsAt(fl.at).some(o => o.owner === w.owner && !bottled(o))) return { err: 'win the orbit first' };
  if (!w.siege || w.siege.by !== fl.owner || w.siege.turns < 1) return { err: 'lay siege for a week first: the bombardment softens the defences' };
  let troops = troopsOf(fl); if (troops < 50) return { err: 'this fleet carries no troops: load starShells and Storks' };
  senateDefied(fl.owner, w.id);
  const shotDown = clamp(w.gun * .12 + w.shield * .05, 0, .6), storm = (w.siege.hold || 0) > 0; troops *= (1 - shotDown) * (storm ? .5 : 1); // storming the walls before they are broken costs half the drop
  const def = w.garrison * (1.25 + .2 * w.lv.fort) * (((w.cl ? w.cl.war : w.loyalty) + 8) / 70), att = troops * 5 * rainBonus(fl, w) * (.75 + rnd() * .5);
  spendDrop(fl);
  const nm = bodyOf(w.id).name;
  if (att > def) {
    const old = rainTaken(fl, w, () => Math.round(Math.max(1200, Math.min(garrisonCap(w), troops * .4 * (1 - def / att) + 600))));
    note(`IRON RAIN on ${nm}! ${shotDown > 0 ? Math.round(shotDown * 100) + '% of the drop was shot down, but the' : 'The'} legions took the surface. ${nm} falls to ${BLOC_NAME[fl.owner]}.`, fl.owner === C.player ? 'good' : old === C.player ? 'bad' : 'gold', w.id, fl.owner === C.player || old === C.player ? { title: fl.owner === C.player ? nm + ' is ours' : nm + ' has fallen', kind: 'rain' } : null);
    checkEnd(); return { won: true };
  }
  w.garrison = Math.round(Math.max(200, w.garrison - att / 1.25 / 5 * .8));
  note(`The Iron Rain on ${nm} ${storm ? 'stormed the walls too soon and' : ''} failed: ${shotDown > 0 ? Math.round(shotDown * 100) + '% of the drop died in the sky and the' : 'the'} garrison held.`, fl.owner === C.player ? 'bad' : 'good', w.id);
  return { won: false };
}

// the drop itself: the first wave falls from the spitTubes and the hangars, the Storks follow it down, and all are spent;
// capital ships lend some of their marines
function spendDrop(fl) {
  const W = rainWaves(fl); // reckoned once, before any hangar is emptied: every Stork counted in the drop goes down with it
  for (const s of fl.ships) { const d = defsOf(fl.owner)[s.t], H = hangarOf(fl.owner, s); if (H) s.hangar = { ...H.cur, starshell: 0, boarder: 0, stork: W.w2 ? 0 : H.cur.stork }; if (d.troops) s.hp = 0; else if (d.cmd) s.crew = Math.max(.4, s.crew - .04); }
  fl.ships = fl.ships.filter(s => s.hp > 0); C.fleets = C.fleets.filter(f => f.ships.length);
}
// a world taken by an Iron Rain, however it was fought: gar(w) is the garrison the surviving legions make, reckoned
// after the world has changed hands
function rainTaken(fl, w, gar) {
  const old = w.owner; CM.weary(old, 6); CM.gainXp(CM.cmdrOf(fl), 40); P.react(fl.owner, 'rain'); P.react(fl.owner, 'conquest'); P.seatLost(old, w.id); w.owner = fl.owner; w.garrison = gar(w); w.siege = null; EC.onCapture(w, fl.owner, CM.has(fl, 'butcher') ? 20 : CM.cmdrOf(fl) && CM.cmdrOf(fl).talents.includes('breaker') ? 45 : 30); w.scorched = 0; w.gov = .8; worldLost(old, w); w.bq = []; w.sq = []; /* the surviving legions hold the ground */ worldTaken(w, fl.owner, old, 'rain');
  return old;
}

// ---------------------------------------------------------------- the Iron Rain fought on the ground (ground.js)
// The share of a garrison's ground strength (garrison × the fortress and loyalty multiplier rainOdds uses) that meets
// the drop on the field: the siege and the bombardment pin the rest in their bunkers and districts. Tuned headless (the
// panel's bench, 12 seeds a cell, at legion scale on the 8 km field) so the battle AI, attacking, takes a walled city about
// two times in three at odds rainOdds calls even, and an open one nearly always; a commander who fights it well does better.
export const GROUND_FIELD = .143;
// legion scale: the ground battle shows ten men for every campaign troop (a Stork's 600 troops land 6,000 legionnaires;
// Mercury's garrison of 8,900 puts some 18,500 on the field). What is left is divided back down for the campaign.
export const GROUND_SCALE = 10;
// what the drop puts on the ground and what stands against it. Nothing is spent until groundDrop.
export function groundSpec(fl) {
  const o = rainOdds(fl); if (o.err) return { err: o.err };
  const w = C.worlds[fl.at], ctx = assaultCtx(fl), k = ctx.mul; // the Rain bonus, halved when the walls still stand
  let shells = 0, leech = 0, storks = 0, rip = 0, thunder = 0;
  for (const s of fl.ships) { const d = defsOf(fl.owner)[s.t] || DEFS[s.t], H = hangarOf(fl.owner, s), m = (s.fit && TE.FITS[s.fit] ? TE.FITS[s.fit].troops || 1 : 1) * (s.cls ? (TE.classSpec(fl.owner, s.cls) || { troops: 1 }).troops : 1);
    // the air over the field (ground battles chat; placeholder numbers for the campaign chat): every ripWing in the fleet and
    // in its hangars; a flight of thunderWing bombers from each dreadnought or moonBreaker, until the campaign builds them
    if (s.t === 'ripwing') rip++; if (s.t === 'dread' || s.t === 'moonbreaker') thunder += 4;
    if (H) { rip += H.cur.ripwing * s.crew; shells += H.cur.starshell * s.crew; leech += H.cur.boarder * troopsPer(fl.owner, 'boarder') * s.crew; storks += H.cur.stork * troopsPer(fl.owner, 'stork'); }
    leech += ((d.troops || 0) * s.crew + (d.cmd ? (d.crew || 0) * .04 * s.crew : 0)) * m; }
  const c = CM.cmdrOf(fl), weeks = w.siege ? w.siege.turns || 0 : 0;
  return { world: w.id, storm: ctx.storm, maxT: 1800, fleet: fl.id,
    att: { f: fl.owner, shells: Math.round(shells * k * GROUND_SCALE), leech: Math.round(leech * k * GROUND_SCALE), storks: Math.round(storks * k * GROUND_SCALE), cmdr: c ? c.name : null, total: Math.round(o.troops * GROUND_SCALE), air: { rip: Math.round(rip * 2), thunder } }, // at legion scale a campaign ripWing stands for a pair
    def: { f: w.owner, men: Math.round(w.garrison * ctx.dmul * GROUND_FIELD * GROUND_SCALE), garrison: w.garrison, fort: w.lv.fort || 0, gun: w.gun || 0, shield: w.shield || 0, barracks: w.lv.barracks || 0, morale: clamp(1 - weeks * .02, .8, 1), cmdr: 'The Legate',
      air: { rip: 12 * Math.min(2, w.gun || 0), thunder: (w.lv.fort || 0) >= 2 ? 4 : 0 } } }; // the garrison's own squadrons (placeholder: the campaign keeps no planetary air yet)
}
// the drop is made: the Senate's vote is defied if it stood, the pods and Storks are spent
export function groundDrop(fl) { const w = C.worlds[fl.at]; senateDefied(fl.owner, w.id); spendDrop(fl); C.fleets = C.fleets.filter(f => f.ships.length); }
// the battle's verdict, written back: the city taken and held by what is left of the legions, or the garrison holding
// with what is left of it (its losses on the field are its losses everywhere, in proportion)
// the ripWings shot down over a ground battle come off the fleet (ground battles chat): at legion scale two on the field
// are one in the campaign (groundSpec doubles them). Taken from the hangars and the fighter hulls alike, the fullest first
function airLosses(fl, r, nm) {
  if (!r.rip0 || !r.rip0[0]) return;
  let lost = Math.round((r.rip0[0] - r.rip[0]) / 2); if (lost <= 0) return; const n0 = lost;
  const src = []; for (const s of fl.ships) { if (s.t === 'ripwing' && s.hp > 0) src.push({ s, ship: true, n: 1 }); else { const H = hangarOf(fl.owner, s); if (H && H.cur.ripwing > 0) { if (!s.hangar) s.hangar = { ...H.cur }; src.push({ s, n: H.cur.ripwing }); } } }
  while (lost > 0) { const x = src.reduce((b, v) => v.n > 0 && (!b || v.n > b.n) ? v : b, null); if (!x) break; x.n--; lost--; if (x.ship) x.s.hp = 0; else x.s.hangar.ripwing = x.n; }
  fl.ships = fl.ships.filter(s => s.hp > 0);
  if (fl.owner === C.player) note(`${n0 - lost} ripWing${n0 - lost === 1 ? '' : 's'} lost over ${nm}.`, 'bad', fl.at);
}
export function groundSettle(fl, wid, r, def0) {
  const w = C.worlds[wid], nm = bodyOf(wid).name, c = CM.cmdrOf(fl);
  if (r.won) {
    const old = rainTaken(fl, w, () => Math.round(Math.max(1200, Math.min(garrisonCap(w), r.attLeft / GROUND_SCALE))));
    note(`IRON RAIN on ${nm}! The legions fought their way into ${r.city} and hold it. ${nm} falls to ${BLOC_NAME[fl.owner]}.`, fl.owner === C.player ? 'good' : old === C.player ? 'bad' : 'gold', w.id, fl.owner === C.player || old === C.player ? { title: fl.owner === C.player ? nm + ' is ours' : nm + ' has fallen', kind: 'rain' } : null);
    chron('battle', `The Iron Rain on ${nm}: the legions take ${r.city} for ${BLOC_NAME[fl.owner]}.`, w.id, fl.owner);
    checkEnd();
  } else {
    const k = def0 > 0 ? clamp(r.defLeft / def0, 0, 1) : 1; w.garrison = Math.round(Math.max(200, w.garrison * k));
    note(`The Iron Rain on ${nm} is thrown back: ${r.why}`, fl.owner === C.player ? 'bad' : 'good', w.id);
    chron('battle', `The Iron Rain on ${nm} fails before ${r.city}.`, w.id, w.owner);
  }
  airLosses(fl, r, nm);
  if (c && r.leaderLost && r.leaderLost[0]) CM.wound(c, fl, nm); // after the capture, which his talents and his experience count toward
  C.fleets = C.fleets.filter(f => f.ships.length); CM.tidy(); EC.govTick();
  return { won: r.won };
}

// after battles: sieges grind, queues advance, the economy pays out, loyalty moves
export function finishTurn() {
  releaseHeld();
  for (const id in C.worlds) {
    const w = C.worlds[id], nm = bodyOf(id).name;
    if (w.siege) {
      const bes = fleetsAt(id, w.siege.by);
      if (!bes.length || fleetsAt(id, w.owner).some(o => !bottled(o))) { w.siege = null; for (const o of fleetsAt(id, w.owner)) delete o.bottled; if (w.owner === C.player) note(`The siege of ${nm} is lifted.`, 'good', id); }
      else {
        // the siege stance: blockade starves the world, bombardment breaks its defences and its people, staging readies the Rain
        w.siege.turns++; const str = bes.reduce((a, f) => a + fleetStr(f), 0), mode = w.siege.mode || 'blockade', butcher = bes.some(f => CM.has(f, 'butcher'));
        const starving = WORLDS.find(x => x.id === id).prod.food < 0 || (w.owner !== 'neu' && C.fac[w.owner].res.food < 0);
        if (mode === 'bombard') { C.bombards = C.bombards || {}; C.bombards[w.siege.by] = (C.bombards[w.siege.by] || 0) + 1; const bk = TE.mod(w.siege.by, 'bombard'); P.react(w.siege.by, 'bombard', .3); P.addOpinion(w.owner, w.siege.by, 'bomb', 'Bombarded our worlds', -2, .5, 40); for (let i = 0; i < bk; i++) if (str > 800 && rnd() < (butcher ? 1 : .9)) { if (w.gun) w.gun--; else if (w.shield) w.shield--; } w.gov = Math.max(0, w.gov - .2); w.loyalty = Math.max(0, w.loyalty - 5); w.garrison = Math.round(w.garrison * Math.pow(butcher ? .92 : .95, bk)); w.scorched = (w.scorched || 0) + 1; }
        else if (mode === 'stage') { w.siege.staged = Math.min(3, (w.siege.staged || 0) + 1); w.gov = Math.max(0, w.gov - .05); w.garrison = Math.round(w.garrison * .97); }
        else { if (str > 1200 && rnd() < .5) { if (w.gun) w.gun--; else if (w.shield) w.shield--; } w.gov = Math.max(0, w.gov - .1); w.loyalty = Math.max(0, w.loyalty - 3); w.garrison = Math.round(w.garrison * (starving ? .92 : .96)); }
        if (w.siege.hold == null) { w.siege.hold = holdOf(w); w.siege.hold0 = w.siege.hold; }
        w.siege.hold = Math.max(0, w.siege.hold - (mode === 'bombard' ? 1 : mode === 'stage' ? .34 : starving ? 1 : .5));
        if (w.siege.hold === 0 && !w.siege.broken) { w.siege.broken = true; if (w.siege.by === C.player) note(`${nm}: the defences are broken. The Iron Rain can land in full strength.`, 'good', id); else if (w.owner === C.player) note(`${nm}: the walls are breached. The enemy can drop in strength now.`, 'bad', id); }
        if (w.gun > 0) { const D = 60 * w.gun * (1 + .15 * (w.lv.grid || 0)), hp = bes.reduce((a, f) => a + f.ships.reduce((b, s) => b + ((defsOf(f.owner)[s.t] || {}).hp || 100) * s.hp, 0), 0) || 1; // tower fire: every gun platform still up hits the besiegers each week
          for (const f of bes) for (const s of f.ships) s.hp = Math.max(.08, s.hp - D / hp * (.6 + rnd() * .8)); }
        for (const f of bes) CM.gainXp(CM.cmdrOf(f), 4);
      }
    }
    if (w.owner !== 'neu') {
      // building and shipbuilding
      if (w.bq.length && !w.siege) { const q = w.bq[0]; if (--q.left <= 0) { w.bq.shift(); w.lv[q.k]++; if (q.k === 'grid') w.gun++; if (q.k === 'array') w.shield++; if (w.owner === C.player) note(`${nm}: ${BUILD[q.k].name} ${w.lv[q.k] > 1 ? 'raised to level ' + w.lv[q.k] : 'completed'}.`, '', id); } }
      if (w.sq.length && !w.siege && !EC.yardsStalled(w)) { const q = w.sq[0]; if (--q.left <= 0) { w.sq.shift(); let fl = fleetsAt(id, w.owner).find(f => !f.orders && !f.garrison && f.ships.length < CM.capOf(f)); if (!fl) fl = fleet(w.owner, id, {}, null); const ns = newShip(q.t); if (q.cls && TE.classById(w.owner, q.cls)) ns.cls = q.cls; ns.crew = EC.crewOnLaunch(w); fl.ships.push(ns); if (w.owner === C.player) note(`${nm}: a new ${q.cls && TE.classById(w.owner, q.cls) ? TE.classById(w.owner, q.cls).name + '-class ' : ''}${defsOf(w.owner)[q.t].name} joins ${fl.name}.`, 'good', id); } }
    }
    { const grow = Math.max(0, Math.min(garrisonCap(w) - w.garrison, 150 + 100 * w.lv.barracks + (!w.siege && w.owner !== 'neu' && fleetsAt(id, w.owner).length ? 300 : 0))), r = w.owner !== 'neu' && C.fac[w.owner].res, keep = r && C.fac[w.owner].ai && !frontier(w) && w.id !== CAPITAL[w.owner] && !w.siege ? 10000 : 0, g = r ? Math.min(grow, Math.max(0, r.man - keep)) : grow; w.garrison += g; if (r) r.man -= g; } // garrisons are raised from the realm's manpower; an AI keeps a reserve for its ships rather than fill quiet worlds' barracks
    w.gov = Math.min(1, w.gov + (w.siege ? 0 : .15));
    EC.tickWorld(w); // every estate moves toward where its loyalty settles; strikes, plots and risings
    if (w.owner !== 'neu' && w.loyalty < 12 && !(w.hostage > C.turn) && rnd() < .25) { const old = w.owner; w.owner = 'neu'; w.garrison = 1500; w.bq = []; w.sq = []; w.siege = null; P.seatLost(old, w.id); EC.onCapture(w, 'neu', 40); worldLost(old, w); note(`Revolt! ${nm} throws off ${BLOC_NAME[old]} and declares itself free.`, old === C.player ? 'bad' : 'gold', id, old === C.player ? { title: 'Revolt on ' + nm, kind: 'revolt' } : null); }
  }
  // supply: ships at friendly worlds repair, re-crew and rearm; ships far from supply lose a little each week
  for (const fl of C.fleets) {
    const w = fl.at && C.worlds[fl.at], home = w && w.owner === fl.owner && !w.siege, r = C.fac[fl.owner].res;
    for (const s of fl.ships) {
      if (home) { s.hp = Math.min(1, s.hp + (CM.has(fl, 'quarter') ? .6 : .3) * TE.mod(fl.owner, 'repair'));
        if (s.sub) { const k = (CM.has(fl, 'quarter') ? .6 : .3) * TE.mod(fl.owner, 'repair') * (w.lv.yard ? 1 : .5); for (const q in s.sub) if (w.lv.yard || (q !== 'shld' && q !== 'bridge')) s.sub[q] = Math.min(1, s.sub[q] + k); if (Object.values(s.sub).every(v => v >= 1)) delete s.sub; } /* shields and bridges need a yard; the rest the crews can mend */ const need = (1 - s.crew) * ((defsOf(fl.owner)[s.t]?.crew) || 10); if (r.man > need) { r.man -= need; s.crew = 1; } const ord = (1 - s.ammo) * 60 + (s.nukes != null ? (1 - s.nukes) * 120 : 0); if (r.ord > ord) { r.ord -= ord; s.ammo = 1; s.nukes = null; } const H = s.hangar && hangarOf(fl.owner, s); if (H) { let he = 0, man = 0; for (const k of CRAFT) { const n = Math.max(0, (H.load[k] || 0) - (H.cur[k] || 0)); he += n * (REPLACE_COST[k] || 0); man += n * (REPLACE_MAN[k] || 0); } if (r.he >= he && r.man >= man) { r.he -= he; r.man -= man; s.hangar = null; } } else if (s.hangar === undefined) s.hangar = null; }
      else if (!fl.transit) s.crew = Math.max(.3, s.crew - .01);
    }
  }
  EC.govTick(); EC.treasuryTick(); CM.attrition(); CM.wearyTick(); CM.cmdrTick(); RU.tick(); P.tick(); AG.tick(); ST.tick(); CQ.tick(); SR.tick(); QS.tick(); wreckTick();
  for (const f of ['rep', 'soc', 'rim']) {
    const inc = income(f), r = C.fac[f].res; C.fac[f].lastInc = inc;
    for (const k in inc) r[k] += inc[k];
    for (const k of ['inf', 'ore', 'alloy', 'rare', 'ord']) if (r[k] < 0) r[k] = 0;
    if (r.he < 0) { r.he = 0; if (f === C.player) note('Helium-3 reserves are empty: the fleet cannot be fuelled. Ships lose crew to desertion.', 'bad'); for (const fl of C.fleets) if (fl.owner === f) for (const s of fl.ships) s.crew = Math.max(.3, s.crew - .05); }
    r.food = Math.max(-2000, Math.min(3000, r.food)); EC.spoil(f); TE.tick(f);
  }
  history();
  ownerDiff();
  if (C.turn % 5 === 0) snapshot();
  checkObjectives();
  { const me = C.player, all = Object.values(C.worlds), mine = all.filter(w => w.owner === me).length, caps = ['rep', 'soc', 'rim'].filter(f => f !== me && relOf(me, f) !== 'ally').map(f => CAPITAL0[f]);
    const was = C.supremacy || 0; C.supremacy = mine >= all.length * .6 && caps.every(id => C.worlds[id].owner === me) ? was + 1 : 0;
    if (C.supremacy === 1) note(`We hold three worlds in five, and every rival's first capital. Hold them eight weeks and the system is ours.`, 'gold'); else if (was && !C.supremacy) note(`Our hold on the system slips: the eight weeks to supremacy start again.`, 'bad'); }
  checkEnd();
  C.fleets = C.fleets.filter(f => f.ships.length); CM.tidy(); EC.govTick();
  C.turn++;
  if (C.moving) placePlanets(C.turn);
}
// the history of 753 PCE, as long as the war still follows it: the Ash Lord dies on Gorgon Isle in November, and
// Atalantia, now Dictator, brings the Rim into the war against the Republic
export const EVENTS = { ashLord: 45, rimAlliance: 46 };
// worlds that changed hands this week enter the chronicle; the loser remembers who took them
function ownerDiff() {
  const was = C._own || {}; let moved = 0;
  for (const w of Object.values(C.worlds)) { const o = was[w.id]; if (o && o !== w.owner) { moved++;
    chron('world', `${bodyOf(w.id).name} passes from ${BLOC_NAME[o]} to ${BLOC_NAME[w.owner]}.`, w.id, w.owner);
    if (o !== 'neu' && w.owner !== 'neu') P.addOpinion(o, w.owner, 'took', 'Took our worlds', -6, .1, 36); } }
  C._own = Object.fromEntries(Object.values(C.worlds).map(w => [w.id, w.owner]));
  C.static = moved ? 0 : (C.static || 0) + 1;
}
// the Rim watches the Republic: what moves the Moon Lords' alarm this week, part by part
export function alarmParts() {
  const rw = Object.values(C.worlds).filter(w => w.owner === 'rep').length, grew = Math.max(0, rw - (C.lastRep ?? rw)), P0 = [['The Republic’s power grows, week by week', .9]];
  if (grew) P0.push([`The Republic took ${grew} world${grew > 1 ? 's' : ''} this week`, grew * 9]);
  if (C.worlds.venus.owner === 'rep') P0.push(['Venus in Republic hands', 2]);
  if (!C.fac.soc.alive) P0.push(['The Remnant has fallen', 3]);
  if (P.hasLaw('rim', 'ilium')) P0.push(['The Compact of Ilium', -1.5]);
  const op = P.opinionOf('rim', 'rep'); if (Math.abs(op) >= 10) P0.push(['The Rim’s opinion of the Republic', -op / 40]);
  if (RU.docKey('rim') === 'patient') P0.push(['A patient Sovereign', -.4]); else if (RU.hasTrait('rim', 'hawk')) P0.push(['A hawk on the throne of Io', .8]);
  return P0.map(([a, b]) => [a, Math.round(b * 10) / 10]);
}
// the history of 753 PCE, as long as the war still follows it: the Ash Lord dies on Gorgon Isle in November, and
// Atalantia, now Dictator, brings the Rim into the war against the Republic
const lorePerson = n => C.cmdrs.find(c => c.name.startsWith(n));
function history() {
  const E = C.events, t = C.turn;
  if (!E.ashLord && t >= SR.ashWeek() && C.fac.soc.alive && C.worlds.venus.owner === 'soc') {
    E.ashLord = true; const m = lorePerson('Magnus');
    if (m && m.state !== 'dead') CM.kill(m, null, 'November 753 PCE. Magnus au Grimmus, the Ash Lord, old and long sick, is dead on Venus.');
    note(`${C.leaders.soc} rules the Remnant.`, 'gold', 'venus', { title: 'The Ash Lord is dead', kind: 'death' });
  }
  const rw = Object.values(C.worlds).filter(w => w.owner === 'rep').length;
  { const da = alarmParts().reduce((a, p) => a + p[1], 0); C.alarm = clamp((C.alarm || 0) + (da > 0 && SR.rule('ilium') ? da * .67 : da), 0, 100); } C.lastRep = rw; /* the peace of Ilium: the council takes longer to frighten */
  if (!E.rimAlliance && C.fac.rim.alive && C.fac.rep.alive && relOf('rep', 'rim') === 'peace' && ((E.ashLord && t >= SR.ashWeek() + 1 && C.fac.soc.alive) || C.alarm >= 100)) {
    E.rimAlliance = true;
    if (human('rim')) { C.pending = { kind: 'rimOffer', alone: !C.fac.soc.alive }; return; } // the player decides
    acceptRimAlliance();
  }
}
export function acceptRimAlliance() {
  // Romulus dies at the end of Iron Gold; if the Rim moves before then, he leads it to war himself
  const rom = RU.rulerOf('rim'), late = C.turn >= SR.ashWeek() + 1 && !(C.ahist && C.events.romLives) && rom && !rom.council && /Romulus/.test(rom.name) && rom.state !== 'dead';
  if (late) { C.events.rimHeir = 'Dido'; CM.kill(rom, null, 'Romulus au Raa, Sovereign of the Rim, is dead.'); }
  const now = RU.actingOf('rim'), lead = late ? `Romulus au Raa is dead, and ${now ? now.name : 'the council'} leads the Rim. ` : `${now ? now.name : 'The Sovereign'} has heard enough from the council. `;
  if (!C.fac.soc.alive) { setRel('rep', 'rim', 'war'); P.onWar('rim', 'rep'); chron('war', 'The Rim Dominion declares war on the Republic.', 'io', 'rim'); note(lead + 'With the Remnant gone, the Moon Lords will not wait for the Republic to come for Io: the Rim Dominion declares war.', C.player === 'rep' ? 'bad' : 'gold', 'io', { title: 'The Rim goes to war', kind: 'war' }); return; }
  setRel('rim', 'soc', 'ally'); if (relOf('rep', 'rim') !== 'war') { setRel('rep', 'rim', 'war'); P.onWar('rim', 'rep'); } P.react('rim', 'war', 2);
  P.addOpinion('soc', 'rim', 'ally', 'Allies against the Republic', 15, .05); P.addOpinion('rim', 'soc', 'ally', 'Allies against the Republic', 15, .05);
  const ly = lorePerson('Lysander'); chron('alliance', `${ly && ly.state !== 'dead' && ly.owner === 'rim' ? 'Lysander au Lune brokers' : 'Envoys broker'} an alliance: the Rim joins the Remnant against the Republic.`, 'io', 'rim');
  note(lead + `${ly && ly.state !== 'dead' && ly.owner === 'rim' ? 'Lysander au Lune has brokered an alliance' : 'The envoys of Venus have their alliance'}: the Rim Dominion joins the Remnant against the Republic.`, C.player === 'rep' ? 'bad' : 'gold', 'io', { title: C.player === 'rep' ? 'The Rim goes to war' : 'An alliance with the Rim', kind: 'alliance' });
}
// ---------------------------------------------------------------- objectives: the war's next steps, with rewards
const owns = (f, id) => C.worlds[id].owner === f, noFoeAt = (f, id) => !fleetsAt(id).some(o => hostile(f, o.owner));
export const OBJECTIVES = {
  rep: [
    { id: 'helio', text: 'Break the Heliopolis Garrison over Mercury', done: () => noFoeAt('rep', 'mercury'), reward: { he: 300, ord: 200 } },
    { id: 'mercury', text: 'Drop the Iron Rain and take Mercury', done: () => owns('rep', 'mercury'), reward: { ore: 400, man: 3000 } },
    { id: 'venus', get text() { return C.ahist ? 'Take Venus before the Ash Lord dies' : `Take Venus before the Ash Lord dies (week ${SR.ashWeek()})`; }, avail: () => C.turn <= SR.ashWeek(), done: () => owns('rep', 'venus'), reward: { he: 1500, ore: 800 } },
    { id: 'ready', text: 'Hold Ceres and Mars with fleets in orbit when the Rim comes', avail: () => relOf('rep', 'rim') === 'war', done: () => fleetsAt('ceres', 'rep').length > 0 && fleetsAt('mars', 'rep').length > 0, reward: { ord: 600 } },
    { id: 'io', text: 'Take Io, seat of the Rim Dominion', avail: () => relOf('rep', 'rim') === 'war', done: () => owns('rep', 'io'), reward: { he: 2000 } },
  ],
  soc: [
    { id: 'relieve', text: 'Relieve Mercury: drive the White Fleet from its orbit', done: () => !fleetsAt('mercury', 'rep').length, reward: { he: 300, man: 2000 } },
    { id: 'hold', text: 'Hold Mercury and Venus until the Ash Lord’s last days (week 40)', avail: () => C.turn <= 40, done: () => C.turn >= 40 && owns('soc', 'mercury') && owns('soc', 'venus'), reward: { he: 1000, ore: 600 } },
    { id: 'earth', text: 'Take Earth from the Republic', done: () => owns('soc', 'earth'), reward: { he: 1500, man: 6000 } },
    { id: 'luna', text: 'Take Luna, seat of the Republic', done: () => owns('soc', 'luna'), reward: { he: 2000 } },
  ],
  rim: [
    { id: 'build', text: 'Arm the Dominion: field 8,000 fleet strength', done: () => C.fleets.filter(f => f.owner === 'rim').reduce((a, f) => a + fleetStr(f), 0) >= 8000, reward: { he: 600 } },
    { id: 'ceres', text: 'Take Ceres, the gate to the Core', avail: () => relOf('rim', 'rep') === 'war', done: () => owns('rim', 'ceres'), reward: { he: 1200, ore: 800 } },
    { id: 'earth', text: 'Take Earth', avail: () => relOf('rim', 'rep') === 'war', done: () => owns('rim', 'earth'), reward: { man: 8000, ore: 800 } },
    { id: 'luna', text: 'Take Luna, seat of the Republic', avail: () => relOf('rim', 'rep') === 'war', done: () => owns('rim', 'luna'), reward: { he: 2000 } },
  ],
};
const RNAME = { he: 'He-3', ore: 'ore', ord: 'ordnance', man: 'manpower', food: 'food', alloy: 'alloys', rare: 'rare metals', inf: 'influence', sci: 'research' };
export const rewardText = r => Object.entries(r).map(([k, v]) => `+${v.toLocaleString()} ${RNAME[k]}`).join(' · ');
const objList = f => threatObjs(f).concat(SR.objectives(f), OBJECTIVES[f] || []);
export function activeObjectives(f = C.player) { C.objDone = C.objDone || {}; return objList(f).filter(o => !C.objDone[o.id] && (!o.avail || o.avail())).concat(ST.missionsOf(f)); }
export function checkObjectives() {
  const f = C.player; C.objDone = C.objDone || {};
  for (const o of objList(f)) if (!C.objDone[o.id] && (!o.avail || o.avail()) && o.done()) {
    C.objDone[o.id] = C.turn; const r = C.fac[f].res; for (const k in o.reward) r[k] += o.reward[k];
    note(`Objective complete: ${o.text}. ${rewardText(o.reward)}.`, 'gold');
  }
  // the threats the player was warned of: held, or lost
  if (C.threats) C.threats = C.threats.filter(th => { if (C.objDone[th.id]) return false; if (!owns(f, th.tgt)) { note(`${bodyOf(th.tgt).name} has fallen to the ${BLOC_NAME[th.f].replace('The ', '')} offensive.`, 'bad', th.tgt); return false; } return C.turn <= th.until + 8; });
}
// a power that loses its capital moves its government to the best world it still holds, at a price: every world
// shaken, the war wearier, and its rivals' war score up. With nowhere to go, it falls.
export function worldLost(old, w) {
  if (!old || old === 'neu' || CAPITAL[old] !== w.id || !C.fac[old] || !C.fac[old].alive) return;
  const L = Object.values(C.worlds).filter(x => x.owner === old && x.id !== w.id); if (!L.length) return;
  const sc = x => x.lv.yard * 3 + (x.lv.court || 0) * 2 + (x.lv.fort || 0) + x.garrison / 3000, nu = L.sort((a, b) => sc(b) - sc(a))[0];
  CAPITAL[old] = nu.id; C.capLost = C.capLost || {}; C.capLost[old] = (C.capLost[old] || 0) + 1; RU.capitalFalls(old, w.owner);
  chron('capital', `${bodyOf(w.id).name} falls: the government of ${BLOC_NAME[old]} flees to ${bodyOf(nu.id).name}.`, w.id, old);
  for (const x of L) { x.loyalty = Math.max(0, x.loyalty - 20); if (x.cl) for (const e in x.cl) x.cl[e] = Math.max(0, x.cl[e] - 12); }
  CM.weary(old, 25); nu.garrison = Math.round(Math.min(garrisonCap(nu) * 1.2, nu.garrison + 2500)); // the government's guard comes with it
  const a = bodyOf(w.id).name, b = bodyOf(nu.id).name;
  note(old === C.player ? `${a} has fallen. The government flees to ${b}: every world is shaken and the people tire of the war.` : `${BLOC_NAME[old]} has lost ${a}. Its government flees to ${b}.`, old === C.player ? 'bad' : 'good', nu.id,
    old === C.player ? { title: 'The capital has fallen', kind: 'rain' } : null);
}
function checkEnd() {
  for (const f of ['rep', 'soc', 'rim']) { const any = Object.values(C.worlds).some(w => w.owner === f); if (C.fac[f].alive && !any) { C.fac[f].alive = false; for (const a of C.agents || []) if (a.owner === f) a.state = 'dead'; for (const c of C.cmdrs) if (c.owner === f && c.state === 'gov') { c.state = 'pool'; c.region = null; } note(`${BLOC_NAME[f]} has fallen.`, f === C.player ? 'bad' : 'gold', CAPITAL[f], { title: BLOC_NAME[f] + ' has fallen', kind: 'fall' }); chron('fall', `${BLOC_NAME[f]} has fallen.`, CAPITAL[f], f); C.fleets = C.fleets.filter(fl => fl.owner !== f); } }
  const me = C.player;
  // victory: every rival that is not your ally has fallen or capitulated to you, or you rule the system:
  // 60% of its worlds, your rivals' first capitals among them, held for eight weeks
  const rivals = ['rep', 'soc', 'rim'].filter(f => f !== me && relOf(me, f) !== 'ally');
  if (rivals.every(f => !C.fac[f].alive || (C.capit && C.capit[f] && C.capit[f].to === me && relOf(me, f) !== 'war'))) C.over = { win: true, how: 'capitulation' };
  if (C.supremacy >= 8) C.over = { win: true, how: 'supremacy' };
  if (!C.fac[me].alive || (C.worlds[CAPITAL[me]].owner !== me && !Object.values(C.worlds).some(w => w.owner === me && w.lv.yard > 0))) C.over = { win: false };
}

// what the AI remembers of its attacks on a world: how many battles it has fought there since the world last changed
// hands, and when it last lost one. Three battles without taking the world, and it brings troops or goes elsewhere.
function aiTally(res, w) {
  C.aiTries = C.aiTries || {}; C.aiLost = C.aiLost || {};
  for (const a of res.atts || [res.att]) {
    if (!a || a === 'neu' || !hostile(a, w.owner)) continue; const k = a + '>' + w.id, T = C.aiTries[k];
    C.aiTries[k] = T && T.owner === w.owner && C.turn - T.t <= 15 ? { n: T.n + 1, t: C.turn, owner: w.owner } : { n: 1, t: C.turn, owner: w.owner };
    if (!res.attWin) C.aiLost[k] = C.turn;
  }
}
const aiStalled = (f, id) => { const T = (C.aiTries || {})[f + '>' + id]; return !!T && T.n >= 3 && T.owner === C.worlds[id].owner && C.turn - T.t <= 15; };
// the troops an Iron Rain on a world wants for fair odds, as rainOdds reckons them (walls not yet broken)
const rainNeed = (f, w) => { const shot = clamp(w.gun * .12 + w.shield * .05, 0, .6), def = w.garrison * (1.25 + .2 * (w.lv.fort || 0)) * (((w.cl ? w.cl.war : w.loyalty) + 8) / 70); return def / .95 / (5 * (1 - shot) * TE.mod(f, 'rain')); };
const enoughTroops = (f, w, troops) => troops >= 60 && troops >= rainNeed(f, w) * 1.05;
const aiLostAt = (f, id) => C.turn - ((C.aiLost || {})[f + '>' + id] ?? -99) <= 6;
// a power on its last worlds: two or fewer, or a quarter of what it started with
export const nearDead = f => { if (!C.fac[f] || !C.fac[f].alive || f === 'neu') return false; const n = Object.values(C.worlds).filter(w => w.owner === f).length; return n > 0 && n <= Math.max(2, Math.floor(((C.startN || {})[f] || 4) * .25)); };
const stat = (k, v = 1) => { C.aiStats = C.aiStats || {}; C.aiStats[k] = (C.aiStats[k] || 0) + v; };
// ---------------------------------------------------------------- the AI empires
// Each power makes war the way its ruler would (rulers.js AI_DOC): how much of an edge it wants, when it drops the
// Rain, how often it runs dark, what it builds in peace. It gathers its fleets into offensives: a strike force
// musters at a world near the target, and launches together when it is strong enough.
const aiStr = o => C.fleets.filter(x => x.owner === o).reduce((a, x) => a + fleetStr(x), 0);
function targetVal(f, fl, id, D, agg) {
  const w = C.worlds[id], g = P.goalOf(f, w.owner), op = w.owner !== 'neu' ? P.opinionOf(f, w.owner) : 0;
  return 1 + (fl && w.siege && w.siege.by === f && troopsOf(fl) > 60 ? 4 : 0) + (id === CAPITAL[w.owner] ? 1.5 : 0) + (w.owner === C.player ? (C.turn < [8, 4, 2][C.difficulty] ? -.6 : .35 * agg) : 0) + (WORLDS.find(x => x.id === id).prod.he > 10 ? .4 : 0)
    + (g && g.w === id ? 2.5 : 0) + D.revenge * Math.max(0, -op - 30) / 40 + (w.lv.yard >= 2 ? .3 * D.ops : 0)
    + (nearDead(w.owner) ? (id === CAPITAL[w.owner] ? 3.5 : 1.5) : 0) + (w.owner === 'neu' && w.home === f ? 1.5 : 0) /* the finishing blow; our own worlds in revolt */
    + (w.owner !== 'neu' ? farFrom(f, w.owner, id) * (D.dark >= .5 ? 1.1 : .7) : 0) + (runaway(w.owner) && w.owner !== f ? .6 : 0) /* where their fleets are not; the power that is winning */
    + (fl && w.owner === C.player && RV.isRival(CM.cmdrOf(fl)) ? 1 : 0); /* a rival of the player's goes looking for the rematch */
}
// the fog of war: what a power's agents make of a world's defenders is never quite right. Each power reads each world
// with its own error, which holds for a month at a time and is smaller for a ruler who spies first (rulers.js agents):
// an offensive gathered to half again what it thinks it needs may find a fair fight, or wait for strength it did not need
const misread = (f, id) => { if (C.difficulty < 1 || f === C.player) return 1; const D = RU.docOf(f), amp = clamp(.32 - ((D.agents || {}).spy || .3) * .4, .1, .25), h = ((f + id + Math.floor(C.turn / 4)).split('').reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0) / 4294967296; return 1 + (h * 2 - 1) * amp; };
// what the agents remember: a world nobody of ours is watching is not taken to be empty. The most it has been seen to
// hold fades 15% a week and is forgotten after eight; a world watched now (a fleet of ours there, or one of our worlds
// within a week) is taken as it is seen. No more raids sent blind into fleets that were there all along
function estAt(f, id) {
  const now = IN.knownStrAt(f, id, fleetStr); if (f === C.player) return now;
  const M = (C.aiMem = C.aiMem || {})[f] = (C.aiMem[f] || {}), near = nearestOwned(f, id), watched = fleetsAt(id, f).length > 0 || (C.worlds[id] && C.worlds[id].owner === f) || (near && travel(near, id) <= 1);
  const m = M[id], old = m ? m.s * Math.pow(.85, C.turn - m.t) * (C.turn - m.t <= 8 ? 1 : 0) : 0;
  if (watched || now >= old) { if (now > 0 || watched) M[id] = { s: Math.round(now), t: C.turn }; return now; }
  return old;
}
// the odds as the war council would give them: the battle as the auto-resolver fights it (sidesOf: every hull with its
// owner's commanders and arms, the world's defences, fleets a week out), with the enemy fleets this power can see, and
// the roll worked out exactly instead of thrown. fleetStr alone leaves out commanders, tech and the world's guns, which
// is how small raids kept being sent at worlds that were sure to beat them
function aiOdds(f, fls, id) {
  const w = C.worlds[id]; if (!w) return 0; const seen = fleetsAt(id).filter(o => hostile(f, o.owner) && IN.levelOf(f, o));
  const cf = { world: id, att: f, def: w.owner === 'neu' || hostile(f, w.owner) ? w.owner : (seen[0] || {}).owner || w.owner, fleets: fls.map(x => x.id).concat(seen.map(x => x.id)), withWorld: hostile(f, w.owner) };
  const sd = sidesOf(cf, false), S = sd.map(x => x.ships.reduce((a, sh) => a + shipVal((x.own && x.own.get(sh)) || x.o, sh), 0) * (x.mul || 1) + (x.extra || 0));
  const hid = Math.max(0, estAt(f, id) - IN.knownStrAt(f, id, fleetStr)); S[1] += hid; // what the agents remember there and cannot see now
  if (S[1] <= 0) return 1; let p = 0; for (let k = 0; k < 24; k++) { const u0 = .85 + (k + .5) / 24 * .3; p += clamp((S[0] * u0 / S[1] - .85) / .3, 0, 1); } return p / 24;
}
// the odds a ruler wants before a fleet goes in: its appetite for risk, from the superiority it asks for (rulers.js sup):
// a Reckless ruler goes at two in five, an Onslaught at one in two, a Steady one at three in five, a Patient one at five
// in six. These are the fights the player gets to play: a Reckless ruler's are coin tosses
const wantOdds = D => clamp(.35 + (D.sup - 1) * .8, .38, .9);
// how long the owner's known battle fleets would take to come to a world's aid, as power f sees them: a world four weeks
// from any fleet that could save it is worth more than one under the guns of the enemy's main fleet (0 to 1)
function farFrom(f, o, id) {
  let best = 99; for (const x of C.fleets) { if (x.owner !== o || x.levy || fleetStr(x) < 900 || !IN.levelOf(f, x)) continue; const at = x.transit ? x.transit.to : x.at; if (!at) continue; best = Math.min(best, travel(at, id) + (x.transit ? x.transit.left || 0 : 0)); }
  return best >= 99 ? .6 : clamp((best - 1.5) / 4, 0, 1);
}
// the power that is running away with the war: half again the worlds of the next power, and fourteen or more. The others
// see it too, and the common enemy draws them together (politics.js aiWar / aiDiplo)
export const runaway = o => { if (!o || o === 'neu' || !C.fac[o] || !C.fac[o].alive) return false; const n = x => Object.values(C.worlds).filter(w => w.owner === x).length, me = n(o); return me >= 14 && ['rep', 'soc', 'rim'].every(x => x === o || !C.fac[x].alive || me >= n(x) * 1.5); };
// a world to fall back on: one of ours within three weeks, not besieged, with the most of our strength already there
function regroupAt(f, from) {
  let best = null, bs = 0; for (const id in C.worlds) { const w = C.worlds[id]; if (w.owner !== f || id === from || w.siege) continue; const t = travel(from, id); if (t > 3) continue;
    const v = (fleetsAt(id, f).reduce((a, x) => a + fleetStr(x), 0) + defStr(w)) * (id === CAPITAL[f] ? 1.4 : 1) / (1 + t * .3); if (v > bs) { bs = v; best = id; } }
  return best;
}
// the offensive: pick a target worth the whole strike force, a muster world near it, and the fleets to send
function aiOps(f, D, agg, avail) {
  C.ops = C.ops || {}; let op = C.ops[f];
  if (op && (!C.worlds[op.tgt] || !hostile(f, C.worlds[op.tgt].owner) || C.turn - op.t > 16 || C.worlds[op.muster].owner !== f || C.worlds[op.muster].siege)) op = C.ops[f] = null;
  if (!op) {
    const kill = Object.values(C.worlds).some(w => hostile(f, w.owner) && nearDead(w.owner));
    if (!avail.length || (!kill && rnd() > .6 * D.ops)) return null;
    const pool = avail.reduce((a, fl) => a + fleetStr(fl), 0), mine = Object.values(C.worlds).filter(w => w.owner === f && !w.siege); if (!mine.length) return null;
    const lift = avail.reduce((a, fl) => a + troopsOf(fl), 0);
    let best = null, bs = 0; const cands = [];
    for (const id in C.worlds) {
      const w = C.worlds[id]; if (!hostile(f, w.owner) || (w.owner === 'neu' && w.home === 'neu' && !w.asco)) continue;
      if (w.owner === C.player && C.turn < [8, 4, 2][C.difficulty]) continue;
      const enemy = (estAt(f, id) + defStr(w)) * misread(f, id), need = Math.max(800, enemy * D.sup);
      if (pool * agg < need) continue;
      if (aiStalled(f, id) && !enoughTroops(f, w, lift)) continue; // fought there before and the world still holds: not again without the troops to take it
      if (aiLostAt(f, id) && pool * agg < need * 1.5) continue;
      const mu = mine.slice().sort((a, b) => travel(a.id, id) - travel(b.id, id) + (b.lv.yard - a.lv.yard) * .3)[0], t = travel(mu.id, id);
      const sc = targetVal(f, null, id, D, agg) / (t + 1) / (1 + enemy / pool); cands.push({ id, sc, need, mu: mu.id }); if (sc > bs) { bs = sc; best = { tgt: id, muster: mu.id, need, t: C.turn }; }
    }
    if (!best) return null;
    // the feint, after Darrow's way of war: the muster is in plain sight and the agents read the blow from it, but a ruler
    // who runs dark sends the strike force at another world within the same reach of the muster
    const alt = cands.filter(c => c.id !== best.tgt && c.sc >= bs * .45 && travel(best.muster, c.id) <= travel(best.muster, best.tgt) + 1 && c.need <= best.need * 1.25).sort((a, b) => b.sc - a.sc)[0];
    if (alt && rnd() < (D.dark >= .5 ? .55 : D.ops >= 1.4 ? .25 : .12) * (C.difficulty >= 1 ? 1 : .4)) best.feint = alt.id;
    // gather a fifth again what the target needs, and everything close to the muster up to half again: the need already
    // carries the ruler's margin (D.sup), and an offensive that waits for twice its need wins sure fights nobody wants to
    // play. A world with a garrison needs troops with the strike force.
    let got = 0, lifted = 0; best.ids = []; const gk = D.sup >= 1.6 ? 1.5 : 1.2, gn = D.sup >= 1.6 ? 2.2 : 1.5; // Patient and Turtle rulers still gather a crushing edge
    for (const fl of avail.slice().sort((a, b) => travel(a.at, best.muster) - travel(b.at, best.muster))) {
      if (got >= best.need * gk && (got >= best.need * gn || travel(fl.at, best.muster) > 2)) continue;
      best.ids.push(fl.id); got += fleetStr(fl); lifted += troopsOf(fl);
    }
    const tw = C.worlds[best.tgt], want = tw.garrison > 0 ? rainNeed(f, tw) * 1.25 : 0;
    for (const tf of avail.filter(fl => !best.ids.includes(fl.id) && troopsOf(fl) >= 50).sort((a, b) => travel(a.at, best.muster) - travel(b.at, best.muster))) { if (lifted >= want) break; best.ids.push(tf.id); lifted += troopsOf(tf); }
    op = C.ops[f] = best;
  }
  const fls = op.ids.map(id => C.fleets.find(x => x.id === id && x.owner === f)).filter(Boolean); op.ids = fls.map(x => x.id); if (!fls.length) { C.ops[f] = null; return null; }
  opIntel(f, op, fls);
  const at = fls.filter(x => !x.transit && x.at === op.muster), str = at.reduce((a, x) => a + fleetStr(x), 0);
  const enemy = (estAt(f, op.tgt) + defStr(C.worlds[op.tgt])) * misread(f, op.tgt); op.need = Math.max(800, enemy * D.sup);
  const odds = at.length && C.difficulty >= 1 ? aiOdds(f, at, op.tgt) : 1, ok = odds >= wantOdds(D) * (aiLostAt(f, op.tgt) ? 1.15 : 1); // the gathered strike force, put to the odds
  if (ok && (str * agg >= op.need * (aiLostAt(f, op.tgt) ? 1.5 : 1) || (C.turn - op.t >= 8 && str * agg >= op.need * .8 && at.length && !aiLostAt(f, op.tgt)) || (at.length && odds >= Math.max(.75, wantOdds(D)) && str * agg >= op.need * .7))) {
    // the feint is sprung: the blow falls on the other world, if it is still worth the strike force
    if (op.feint && C.worlds[op.feint] && hostile(f, C.worlds[op.feint].owner) && str * agg >= (IN.knownStrAt(f, op.feint, fleetStr) + defStr(C.worlds[op.feint])) * D.sup) {
      const decoy = op.tgt; op.tgt = op.feint; stat('feint');
      for (const th of C.threats || []) if (th.f === f && th.tgt === decoy && !th.launched) { th.launched = C.turn; th.until = C.turn + 2; }
      if (C.worlds[op.tgt].owner === C.player && at.some(x => IN.levelOf(C.player, x) >= 1)) note(`A feint! The offensive massed at ${bodyOf(op.muster).name} has turned away from ${bodyOf(decoy).name}: it is bound for ${bodyOf(op.tgt).name}.`, 'bad', op.tgt, { title: 'The blow falls elsewhere', kind: 'war' });
    }
    // launch: every fleet at the muster sets out together, at the pace of the slowest
    const n = Math.max(...at.map(x => moveWeeks(x, op.tgt))); for (const x of at) { x.opT = C.turn; x.run = !globalThis.__FOG_OFF && n >= 3 && rnd() < D.dark ? 'dark' : null; if (!moveFleet(x, op.tgt)) { x.transit.left = x.transit.total = Math.max(x.transit.total, n); } }
    if (at[0] && at[0].transit) CQ.aiRising(f, at[0], op.tgt);
    for (const th of C.threats || []) if (th.f === f && th.tgt === op.tgt && !th.launched) { th.launched = C.turn; th.until = C.turn + n + 4; if (C.worlds[op.tgt].owner === C.player && at.some(x => IN.levelOf(C.player, x) >= 1)) note(`The offensive massed at ${bodyOf(op.muster).name} sets out: ${at.length} fleet${at.length > 1 ? 's' : ''} under way, ${n} week${n > 1 ? 's' : ''} from ${bodyOf(op.tgt).name}.`, 'bad', op.muster); }
    C.opsLog = (C.opsLog || 0) + 1; if (at.length > 1) C.opsMulti = (C.opsMulti || 0) + 1; stat('ops'); stat('fleets', at.length); if (at.length > 1) stat('multi');
    C.ops[f] = null; return new Set(at.map(x => x.id).concat(op.ids));
  }
  for (const x of fls) if (!x.transit && x.at !== op.muster) moveFleet(x, op.muster);
  return new Set(op.ids);
}
// a muster the player can see: an intel dispatch, and an objective to hold the world it threatens
function opIntel(f, op, fls) {
  if (op.seen || f === C.player || !C.fac[C.player] || !C.fac[C.player].alive) return;
  const at = fls.filter(x => !x.transit && x.at === op.muster), seen = at.filter(x => IN.levelOf(C.player, x) >= 1); if (!seen.length) return;
  op.seen = C.turn; const big = seen.slice().sort((a, b) => fleetStr(b) - fleetStr(a))[0], named = IN.levelOf(C.player, big) === 2, mine = C.worlds[op.tgt].owner === C.player, mn = bodyOf(op.muster).name;
  note(`${named ? big.name + ' is' : BLOC_NAME[f] + '’s fleets are'} massing at ${mn}${seen.length > 1 ? `: ${seen.length} fleets so far` : ''}.${mine ? ` Our agents believe the blow will fall on ${bodyOf(op.tgt).name}.` : ''}`, mine ? 'bad' : 'gold', op.muster, mine ? { title: `${named ? big.name : 'An offensive'} massing at ${mn}`, kind: 'war' } : null);
  if (mine) { C.threats = (C.threats || []).filter(x => x.f !== f); C.threats.push({ id: 'th' + (C.nid++), f, tgt: op.tgt, muster: op.muster, t: C.turn, until: C.turn + 12 }); }
}
const threatObjs = f => f !== C.player ? [] : (C.threats || []).map(th => ({ id: th.id, threat: th, text: `Hold ${bodyOf(th.tgt).name} against the ${BLOC_NAME[th.f].replace('The ', '')} offensive${th.launched ? '' : ' massing at ' + bodyOf(th.muster).name}`, avail: () => owns(f, th.tgt), done: () => C.turn >= th.until && owns(f, th.tgt), reward: { inf: 30, man: 3000, ord: 400 } }));
function aiTurn(f) {
  const r = C.fac[f].res, mine = Object.values(C.worlds).filter(w => w.owner === f), agg = [.75, 1, 1.25][C.difficulty] || 1, D = RU.docOf(f), rally = {}; // rally: strength already sent to meet a threat, by world
  const targetValOwn = (f, w) => (w.id === CAPITAL[f] ? 3 : 1) + (w.gun + w.shield) * .1 + (bodyOf(w.id).pop || 0) / 400;
  EC.aiEconomy(f); TE.aiTech(f); AG.aiAgents(f); aiCourt(f);
  // build up: fill slots with what the economy lacks; yards and defences on the front, more of them under a cautious ruler
  for (const w of mine) {
    if (w.bq.length || w.siege) continue;
    const fr = frontier(w), rich = r.he > 8000 && r.ore > 2500, dk = D.def * (rich ? 1.6 : 1); // a full treasury buys walls
    const need = [['skimmer', r.he < 600 ? 3 : 1], ['mine', r.ore < 500 ? 3 : 1], ['arsenal', r.ord < 800 ? 2 : .5], ['farms', r.food < 0 ? 3 : .2], ['barracks', r.man < 6000 ? 4 : r.man < 15000 ? 2.5 : .5], ['yard', r.he > 8000 ? 1.4 : w.id === CAPITAL[f] ? 1.2 : .25], ['grid', (fr ? 2 : rich ? .8 : .3) * dk], ['array', (fr ? 1.5 : rich ? .6 : .2) * dk], ['fort', (fr ? 1 : rich ? .6 : .2) * dk], ['foundry', r.alloy < 300 ? 3.2 : r.alloy < 900 ? 1.2 : .2], ['court', EC.overSprawl(f) > 0 ? 4 : EC.adminCap(f) - EC.sprawl(f) < 3 ? 1.6 : .1], ['lab', rich ? 1.2 : .2]]
      .map(([k, v]) => [k, BUILD[k].work ? v * (k === 'barracks' ? Math.min(1.2, EC.levyOf(w.id) * 1.5) : k === 'skimmer' ? EC.skimMul(w.id) * 1.1 : EC.workOf(w.id) * 1.1) : v]) // works go where the hands are
      .filter(([k]) => !canBuild(f, w, k)).sort((a, b) => b[1] - a[1] + (rnd() - .5));
    if (need.length && rnd() < .7) startBuild(f, w, need[0][0]);
  }
  // shipbuilding: keep yards busy while the treasury allows. A power at peace with everyone only keeps a
  // fleet to match its neighbours (more of one under a hawk, less under a council); it does not arm for a war it is not fighting
  const atWar = ['rep', 'soc', 'rim'].some(o => o !== f && C.fac[o].alive && hostile(f, o));
  const hoard = clamp((r.he - 6000) / 10000, 0, 1.5); // He-3 sitting in the vaults is a fleet not built: a rich power arms
  const peaceCap = atWar || r.he > 15000 ? Infinity : Math.max(...['rep', 'soc', 'rim'].filter(o => o !== f).map(aiStr)) * .9 * D.build * (1 + hoard);
  if (aiStr(f) < peaceCap) for (const w of mine) {
    if (w.lv.yard < 1 || w.sq.length >= (r.he > 3000 ? 4 : 2) || w.siege) continue;
    const opts = roster(f).filter(t => !hullOK(f, w, t)); if (!opts.length) continue;
    const pods = C.fleets.filter(fl => fl.owner === f).reduce((a, fl) => a + fl.ships.filter(s => defsOf(f)[s.t].troops).length, 0);
    const sieges = Object.values(C.worlds).filter(x => x.siege && x.siege.by === f).length;
    const stalled = Object.keys(C.aiTries || {}).filter(k => k.startsWith(f + '>') && aiStalled(f, k.slice(f.length + 1))).length;
    const pick = pods < 4 + (sieges + stalled) * 4 && opts.includes('boarder') && rnd() < .7 ? 'boarder' : opts.sort((a, b) => (defsOf(f)[b].value || 0) - (defsOf(f)[a].value || 0))[Math.floor(rnd() * Math.min(3, opts.length))];
    const cl = TE.classesOf(f).filter(c => c.hull === pick && TE.SLOTS.every(S => !TE.optWhy(f, defsOf(f)[pick], S.k, c.s[S.k]))), cls = cl.length && rnd() < .8 ? cl[Math.floor(rnd() * cl.length)].id : null;
    if (r.he > hullCost(f, pick, cls).he * 1.1 && navalUsed(f) + hullSize(f, pick) <= navalCap(f)) orderShip(f, w, pick, cls);
  }
  if (r.alloy > 1500 && rnd() < .25) for (const fl of C.fleets) if (fl.owner === f && !canRefit(fl)) { for (const c of TE.classesOf(f)) { if (!TE.SLOTS.every(S => !TE.optWhy(f, defsOf(f)[c.hull], S.k, c.s[S.k]))) continue; const ids = fl.ships.filter(s => !s.fit && !s.cls && s.t === c.hull).map(s => s.id); if (ids.length) refitClass(fl, ids, c.id); } }
  // war: fleets at home look for the best target they can beat; besiegers with troops drop the Iron Rain
  const fls = C.fleets.filter(fl => fl.owner === f && !fl.transit && !fl.levy && !fl.raid); /* levies follow their Houses; raiders are out */
  if (atWar) for (const fl of fls) if (!fl.garrison && hangarHome(fl)) aiLoad(fl); /* at war, the carriers of the field fleets refit to invade */
  if (atWar) { const rd = CQ.aiRaid(f, fls); if (rd) fls.splice(fls.indexOf(rd), 1); } CQ.aiLevy(f);
  // fleets free for an offensive: not holding a siege or a conquest, not the capital's last guard, not under siege at home
  const avail = atWar ? fls.filter(fl => { const h = C.worlds[fl.at]; if (fl.garrison || fleetStr(fl) < 300) return false; if (h && h.siege && (h.siege.by === f || hostile(f, h.siege.by))) return false; if (h && h.id === CAPITAL[f] && fleetsAt(h.id, f).length === 1 && IN.knownBoundFor(f, h.id).length) return false; return true; }) : [];
  // a power down to its last worlds stands on them: no offensives, and its fleets strike only with a crushing edge close to home
  const lastStand = atWar && mine.length <= Math.max(1, Math.floor(((C.startN || {})[f] || 3) * .4));
  const inOp = atWar && !lastStand ? (aiOps(f, D, agg, avail) || new Set()) : new Set();
  for (const fl of fls) {
    if (inOp.has(fl.id)) continue;
    const here = C.worlds[fl.at];
    if (here && here.siege && here.siege.by === f && troopsOf(fl) > 60 && here.siege.turns >= 1) { const o = rainOdds(fl); if (!o.err && (o.storm ? o.chance >= Math.min(.95, D.rain + .2) : o.chance >= D.rain || (o.chance >= D.rain - .25 && here.siege.turns >= 5))) { ironRain(fl); continue; } } // the AI waits for the walls to break, unless it has the troops to storm them
    if (here && here.siege && here.siege.by === f) here.siege.mode = here.gun + here.shield > 0 ? 'bombard' : troopsOf(fl) > 60 ? 'stage' : 'blockade';
    if (fl.garrison && !fl.holdFast && !(here && here.owner === f && here.home !== f)) { fl.garrison = false; fl.stance = null; } // a detachment whose conquest is lost, or that fell back home, rejoins the war
    if (fl.garrison && fl.holdFast && !(here && here.owner === f && here.id === fl.holdFast)) { fl.garrison = false; fl.holdFast = null; fl.stance = null; } // a home garrison driven off its world, or whose world has fallen, joins the field fleets
    if (fl.garrison && here && here.owner === f) { fl.stance = 'picket'; continue; } // a detachment left to hold a conquest
    // a fleet over its own besieged world stands and fights, unless the odds are hopeless
    if (here && here.owner === f && here.siege && hostile(f, here.siege.by)) { const foe = IN.knownStrAt(f, here.id, fleetStr); if (fleetStr(fl) + defStr(here) > foe * .45) continue; }
    if (here && here.owner === f && here.home !== f && here.loyalty < 50 && fl.ships.length >= 5 && !fleetsAt(here.id, f).some(o => o.garrison) && frontier(here)) {
      const keep = fl.ships.filter(s => !defsOf(f)[s.t].troops).sort((a, b) => shipVal(f, a) - shipVal(f, b)).slice(0, Math.max(2, Math.floor(fl.ships.length * .25))).map(s => s.id);
      const det = splitFleet(fl, keep); if (det) { det.garrison = true; det.name = bodyOf(here.id).name + ' Garrison'; }
    }
    // a beaten remnant does not sit under the enemy's guns to be finished week after week: where the known enemy is
    // more than twice what it has (with the world's own defences, if the world is ours), it goes to the nearest world of
    // ours to join the others and refit
    if (here && C.difficulty >= 1 && !(here.owner === f && here.id === CAPITAL[f])) { const foe = IN.knownStrAt(f, here.id, fleetStr) + (hostile(f, here.owner) ? defStr(here) : 0), ours = fleetsAt(here.id, f).reduce((a, x) => a + fleetStr(x), 0) + (here.owner === f ? defStr(here) : 0);
      if (foe > ours * 2) { const h = nearestOwned(f, here.id); if (h && !moveFleet(fl, h)) { stat('withdraw'); continue; } } } // moveFleet answers null when the fleet sets out
    const str = fleetStr(fl); if (str < 900 && troopsOf(fl) < 60) continue;
    // relieve our own worlds under siege before anything else
    { let rel = null, rs = 0; for (const w of mine) if (w.siege && hostile(f, w.siege.by)) { const foe = IN.knownStrAt(f, w.id, fleetStr), t = travel(fl.at, w.id), sc = (w.id === CAPITAL[f] ? 3 : 1.5) / (t + 1) * (t <= Math.ceil(w.siege.hold || 0) + 1 ? 2 : 1);
        if (str * agg + (w.id === CAPITAL[f] ? defStr(w) * .6 : 0) >= foe * (w.id === CAPITAL[f] ? .8 : 1) && sc > rs) { rs = sc; rel = w.id; } }
      if (rel && rel !== fl.at) { moveFleet(fl, rel); continue; } if (rel === fl.at) continue; }
    // hold a siege while troops come up, unless it has gone on hopelessly long
    if (here && hostile(f, here.owner) && here.siege && here.siege.by === f && (aiStalled(f, here.id) ? enoughTroops(f, here, troopsOf(fl)) : troopsOf(fl) > 60 || here.siege.turns < 6)) { const o = rainOdds(fl); if (!(here.siege.turns > 12 && (o.err || o.chance < .25))) continue; }
    // a strike force that has just won the orbit of an enemy world stays for the siege to form, if it came to take it
    if (here && hostile(f, here.owner) && !(here.siege && here.siege.by === f) && !fleetsAt(here.id).some(o => hostile(f, o.owner) && !bottled(o)) && (aiStalled(f, here.id) ? enoughTroops(f, here, troopsOf(fl)) : troopsOf(fl) > 60 || nearDead(here.owner))) continue;
    // interior lines: a fleet that can reach a threatened world of ours before the enemy does goes to meet him there,
    // if that turns a lost world into a fight (everything there and on the way, with this fleet, at least 80% of what is
    // coming), and until what is there is about a match for it (95%). The battle that follows is the close one
    if (!fl.garrison && !fl.holdFast && C.difficulty >= 1 && !(C.ops && C.ops[f] && C.ops[f].ids.includes(fl.id))) { let go = null, gs = 0;
      for (const w of mine) { if (w.id === fl.at || w.siege) continue; const inc = IN.knownBoundFor(f, w.id); if (!inc.length) continue;
        const foe = inc.reduce((a, o) => a + fleetStr(o), 0), eta = Math.min(...inc.map(o => o.transit ? o.transit.left || 0 : 0)), t = travel(fl.at, w.id); if (t > eta) continue;
        const there = fleetsAt(w.id, f).reduce((a, x) => a + fleetStr(x), 0) + defStr(w) + (rally[w.id] || 0) + C.fleets.filter(x => x.owner === f && x.transit && x.transit.to === w.id && (x.transit.left || 0) <= eta).reduce((a, x) => a + fleetStr(x), 0);
        if (there * agg >= foe * .95 || (there + str) * agg < foe * .8) continue; // to a fair fight, not a crushing one: the enemy committed on what he could see
        const sc = targetValOwn(f, w) / (t + 1); if (sc > gs) { gs = sc; go = w.id; } }
      if (go) { rally[go] = (rally[go] || 0) + str; moveFleet(fl, go); stat('rally'); continue; } }
    // a fleet does not wait at a lesser world to be crushed: before a known force far stronger than everything of ours
    // there, it falls back on the strength nearest it, to strike back together (the capital's guard and a world's own
    // garrison stand; a Reckless ruler never gives ground)
    if (here && here.owner === f && !here.siege && here.id !== CAPITAL[f] && !fl.holdFast && D.sup > 1.1 && C.difficulty >= 1) {
      const incL = IN.knownBoundFor(f, here.id), inc = incL.reduce((a, o) => a + fleetStr(o), 0), eta = incL.length ? Math.min(...incL.map(o => o.transit ? o.transit.left || 0 : 0)) : 0;
      const ours = fleetsAt(here.id, f).reduce((a, x) => a + fleetStr(x), 0) + defStr(here) + (rally[here.id] || 0) + C.fleets.filter(x => x.owner === f && x.transit && x.transit.to === here.id && (x.transit.left || 0) <= eta).reduce((a, x) => a + fleetStr(x), 0); // help on the way counts
      if (inc > ours * 1.45) { const to = regroupAt(f, here.id); if (to && (fleetsAt(to, f).reduce((a, x) => a + fleetStr(x), 0) + defStr(C.worlds[to]) + str) * agg > inc * .9) { moveFleet(fl, to); stat('evade'); continue; } }
    }
    const homeThreat = here && here.owner === f && IN.knownBoundFor(f, fl.at).length > 0;
    // intercept a tracked enemy bound for one of our worlds, when we can catch it and beat it
    if (here && here.owner === f && !fl.garrison && !globalThis.__FOG_OFF) { let pick = null;
      for (const o of C.fleets) { if (!hostile(f, o.owner) || !o.transit || o.engage || o.owner === 'neu' || !C.worlds[o.transit.to] || IN.levelOf(f, o) < 1) continue;
        if (C.worlds[o.transit.to].owner !== f && !(troopsOf(o) >= 60 && C.difficulty >= 1 && travel(fl.at, o.transit.to) <= 3)) continue; // bound for us, or a troop convoy on its way to a Rain: the legions die easiest in their ships
        const p = planIntercept(fl, o); if (typeof p === 'string' || p.chance < .45) continue; if (fleetStr(fl) * agg < fleetStr(o) * D.sup * .95) continue; if (!pick || p.w < pick.p.w) pick = { o, p }; }
      if (pick && rnd() < .75) { orderIntercept(fl, pick.o); continue; } }
    if (homeThreat && here.id === CAPITAL[f]) continue;
    // a home guard stays at the capital while enemies are within four weeks of it
    if (here && here.id === CAPITAL[f] && fleetsAt(here.id, f).length === 1 && C.fleets.some(o => hostile(o.owner, f) && o.owner !== 'neu' && IN.levelOf(f, o) && ((o.at && travel(o.at, here.id) <= 4) || (o.transit && (IN.levelOf(f, o) === 2 || o.transit.to === here.id) && travel(o.transit.to, here.id) <= 3)))) { if (fl.ships.length > 6) { const keep = fl.ships.slice().sort((a, b) => shipVal(f, b) - shipVal(f, a)).filter((_, i) => i % 2).map(s => s.id); const nf = splitFleet(fl, keep); if (nf && f !== 'rim') nf.name = 'Home Fleet'; } else continue; }
    // an offensive is gathering: a free fleet near its muster joins it rather than striking out alone
    { const op = C.ops && C.ops[f]; if (op && !lastStand && avail.includes(fl) && !op.ids.includes(fl.id) && travel(fl.at, op.muster) <= 5) {
        const got = op.ids.reduce((a, id) => { const x = C.fleets.find(y => y.id === id); return a + (x ? fleetStr(x) : 0); }, 0);
        if (got < op.need * (D.sup >= 1.6 ? 2 : 1.4)) { op.ids.push(fl.id); if (fl.at !== op.muster) moveFleet(fl, op.muster); stat('joined'); continue; } } }
    let best = null, bs = 0; const cand = [];
    for (const id in C.worlds) {
      const w = C.worlds[id]; if (!hostile(f, w.owner)) continue;
      if (w.owner === C.player && C.turn < [8, 4, 2][C.difficulty]) continue; // the player gets a few weeks before the counterattack
      if (C.ops && C.ops[f] && C.ops[f].tgt === id) continue; // the offensive will take it
      const enemy = (estAt(f, id) + defStr(w)) * misread(f, id);
      const t = travel(fl.at, id), val = targetVal(f, fl, id, D, agg);
      if (aiStalled(f, id) && !enoughTroops(f, w, troopsOf(fl))) continue; // three battles there and the world still holds: not without the troops to take it
      if (aiLostAt(f, id) && str * agg < enemy * D.sup * 1.5) continue; // beaten there lately: no feeding fleets in one by one
      if (str * agg < enemy * D.sup * (lastStand ? 1.6 : 1) && !(w.siege && w.siege.by === f && !fleetsAt(id).some(o => o.owner === w.owner))) continue;
      if (lastStand && t > 3) continue;
      const sc = val / (t + 1) / (1 + enemy / str); cand.push([sc, id]); if (sc > bs) { bs = sc; best = id; }
    }
    // the best two by value, put to the odds: the first the ruler would risk is the one
    if (best && C.difficulty >= 1) { best = null; for (const [, id] of cand.sort((a, b) => b[0] - a[0]).slice(0, 2)) if (aiOdds(f, [fl], id) >= wantOdds(D) * (lastStand ? 1.1 : 1)) { best = id; break; } if (!best) stat('declined'); }
    if (best) { fl.run = !globalThis.__FOG_OFF && travel(fl.at, best) >= 3 && rnd() < D.dark ? 'dark' : null; moveFleet(fl, best); } // some raids go in dark
    else if (here && hostile(f, here.owner) && aiStalled(f, here.id) && !enoughTroops(f, here, troopsOf(fl))) { const home = nearestOwned(f, here.id); if (home) { moveFleet(fl, home); stat('cut'); } } // a siege that cannot end: home for troops
  }
}
// the AI keeps its court in hand: honours for the unhappiest group when it can spare the influence
function aiCourt(f) { const r = C.fac[f].res, G = P.groupsOf(f); if (!G.length || r.inf < 80) return; const g = G.slice().sort((a, b) => a.sat - b.sat)[0]; if (g.sat < 35) P.honour(f, g.id); }
const frontier = w => Object.values(C.worlds).some(o => hostile(o.owner, w.owner) && o.owner !== 'neu' && travel(o.id, w.id) <= 3);
