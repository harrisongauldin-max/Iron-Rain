// Phase B of the campaign: worlds and their peoples. Every world is a society of Colours, grouped here into seven
// estates, each with its own work and its own loyalty. Ores become alloys in foundries; Golds yield influence and
// Greens research; Silvers and Coppers run trade, which pirates raid where it crosses the Belt. Regions held whole
// pay a bonus. Every world costs administration, and a realm past its capacity frays. Taxes buy He-3 with loyalty.
import { C, note, fleetsAt, hostile, relOf, BLOC_NAME, CAPITAL, navalUsed, navalCap } from './camp.js';
import * as CM from './command.js';
import { WORLDS, bodyOf, AU } from './solar.js';
import { BODIES } from './data.js';
import * as TE from './tech.js';
import * as P from './politics.js';
import * as PO from './politics.js';
import * as RU from './rulers.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const WD = id => WORLDS.find(x => x.id === id);

// ---------------------------------------------------------------- the estates
export const ESTATES = {
  gold:   { name: 'Golds',              col: '#e3b341', work: 'Command and politics: influence, and the loyalty of the whole world',    out: 'inf' },
  mid:    { name: 'Silvers & Coppers',  col: '#c3cad2', work: 'Commerce and bureaucracy: trade, and taxes collected',                  out: 'trade' },
  blue:   { name: 'Blues',              col: '#5d9fe0', work: 'Pilots and crews: new hulls leave the yards fully crewed',              out: 'crew' },
  green:  { name: 'Greens',             col: '#6cc070', work: 'Technicians and programmers: research',                               out: 'sci' },
  orange: { name: 'Oranges',            col: '#ea8a3b', work: 'Engineers: foundries, arsenals and shipyards',                         out: 'alloy' },
  war:    { name: 'Grays & Obsidians',  col: '#9a9aa6', work: 'Soldiers: manpower and the garrison',                                 out: 'man' },
  red:    { name: 'Reds & lowColors',   col: '#cf4532', work: 'Labour: mines, He-3, farms. Reds, Browns, Pinks and Yellows',        out: 'ore' },
};
export const EK = Object.keys(ESTATES);
// how each estate stops working: Golds do not strike, they withdraw
const STRIKE = { gold: 'withdraw from your governors’ courts', mid: 'freeze the ledgers and let the bureaucracy stall', blue: 'stand down from the helms', green: 'lock their servers', orange: 'down tools in the yards', war: 'refuse to muster', red: 'walk out of the mines' };
// how each power's order sits with each estate: the Republic freed the Reds and broke the Peerage; the Remnant is
// the Peerage; the Rim keeps the old hierarchy, but more gently than the Core ever did
const ATT = {
  rep: { gold: -14, mid: 0, blue: 4, green: 4, orange: 6, war: 4, red: 14 },
  soc: { gold: 16, mid: 6, blue: 0, green: 0, orange: -4, war: 6, red: -14 },
  rim: { gold: 12, mid: 6, blue: 2, green: 2, orange: 0, war: 6, red: -6 },
  neu: { gold: 0, mid: 0, blue: 0, green: 0, orange: 0, war: 0, red: 0 },
};
// who lives where. Defaults by kind of world; the worlds the books describe get their own mix
const MIX = {
  _world: { gold: .06, mid: .12, blue: .06, green: .07, orange: .1, war: .12, red: .47 },
  _gas:   { gold: .04, mid: .08, blue: .12, green: .08, orange: .2, war: .06, red: .42 },
  luna:   { gold: .1, mid: .24, blue: .08, green: .08, orange: .16, war: .1, red: .24 },     // Hyperion, Endymion, the Atlas Docks
  earth:  { gold: .05, mid: .12, blue: .04, green: .06, orange: .07, war: .16, red: .5 },
  mars:   { gold: .04, mid: .07, blue: .04, green: .05, orange: .1, war: .12, red: .58 },     // the mines; home of the Rising
  phobos: { gold: .04, mid: .14, blue: .3, green: .06, orange: .24, war: .06, red: .16 },     // the Hive and the shipping docks
  deimos: { gold: .06, mid: .06, blue: .1, green: .06, orange: .1, war: .4, red: .22 },       // the Battle Moon
  venus:  { gold: .16, mid: .2, blue: .07, green: .08, orange: .14, war: .12, red: .23 },     // Carthii yards, refugee Golds
  mercury:{ gold: .07, mid: .13, blue: .04, green: .06, orange: .08, war: .14, red: .48 },    // Heliopolis, the Eleusis mines
  ceres:  { gold: .04, mid: .26, blue: .1, green: .1, orange: .1, war: .08, red: .32 },       // the Hanging Market
  io:     { gold: .1, mid: .12, blue: .05, green: .08, orange: .07, war: .12, red: .46 },     // Sungrave, Demeter's Garter
  europa: { gold: .07, mid: .3, blue: .05, green: .09, orange: .07, war: .08, red: .34 },     // banking houses
  ganymede:{ gold: .12, mid: .14, blue: .08, green: .1, orange: .24, war: .1, red: .22 },     // the Ganymede Dockyards
  callisto:{ gold: .06, mid: .06, blue: .06, green: .06, orange: .08, war: .4, red: .28 },    // Grays and Obsidians
  titan:  { gold: .06, mid: .1, blue: .05, green: .07, orange: .17, war: .08, red: .47 },     // farms and Titan Arms
  triton: { gold: .04, mid: .08, blue: .05, green: .08, orange: .1, war: .07, red: .58 },     // Sons of Ares country
  pluto:  { gold: .16, mid: .08, blue: .06, green: .14, orange: .1, war: .1, red: .36 },      // the Shamed, at the terraforming posts
};
export const mixOf = id => { const b = bodyOf(id); return MIX[id] || (b.gas ? MIX._gas : MIX._world); };
export const popOf = id => Math.max(id === 'rhea' ? 0 : 5, WD(id).prod.man);   // millions, near enough: what the world can field

// ---------------------------------------------------------------- strategic resources
// Rare metals, from deep mines: the stuff of shield arrays, torch drives and capital keels
export const RARE = { mercury: 7, ceres: 5, europa: 4, thebe: 3, iapetus: 2, pluto: 2, deimos: 1, enceladus: 1, triton: 1, vesta: 2, pallas: 2, hygiea: 1, umbriel: 3, haumea: 2, eris: 2, makemake: 1, charon: 1, amalthea: 1 };
// what a hull costs beyond He-3, ore and crew
export const HULL = { destroyer: { alloy: 20 }, raider: { alloy: 10 }, torch: { alloy: 45, rare: 5 }, dread: { alloy: 120, rare: 25 }, moonbreaker: { alloy: 400, rare: 100 } };
export const BLD = { yard: { alloy: 60 }, grid: { alloy: 30 }, array: { alloy: 30, rare: 6 }, fort: { alloy: 40 }, foundry: {}, court: {}, lab: { alloy: 20 } };

// ---------------------------------------------------------------- regions
export const REGIONS = ['The Core', 'The Belt', 'Jupiter', 'Saturn', 'The Outer Giants', 'The Far Ink'];
export const regionOf = id => WD(id).region;
export const REGION_BONUS = {
  'The Core':         { name: 'Hegemon of the Core', desc: '+8 influence a week, and every Core estate +5 loyalty', loy: 5, inf: 8 },
  'The Belt':         { name: 'Lord of the Lanes',    desc: 'Pirates take half as much of your trade; +50% rare metals in the Belt', pirate: .5, rare: 1.5 },
  'Jupiter':          { name: 'Moon Lord of Jupiter', desc: '+25% He-3 and +15% manpower from the Jovian worlds', he: 1.25, man: 1.15 },
  'Saturn':           { name: 'Moon Lord of Saturn',  desc: '+25% food and ordnance from the Saturnian worlds', food: 1.25, ord: 1.25 },
  'The Outer Giants': { name: 'Warden of the Giants', desc: '+25% He-3 from Uranus, Neptune and Triton', he: 1.25 },
  'The Far Ink':      { name: 'Warden of the Far Ink',desc: '+3 research a week', sci: 3 },
};
export const regionWorlds = r => Object.keys(C.worlds).filter(id => regionOf(id) === r);
export const holdsRegion = (f, r) => { const ws = regionWorlds(r); return ws.length > 0 && ws.every(id => C.worlds[id].owner === f); };
const rb = (w, k) => { const r = regionOf(w.id), B = REGION_BONUS[r]; return B && B[k] && w.owner !== 'neu' && holdsRegion(w.owner, r) ? B[k] : 0; };

// ---------------------------------------------------------------- designations
export const DESIG = {
  none:    { name: 'No designation',   desc: 'The world works as it always has' },
  mine:    { name: 'Mining world',     desc: '+25% ore, He-3 and rare metals; Reds +4 loyalty',     mul: { ore: 1.25, he: 1.25, rare: 1.25 }, loy: { red: 4 } },
  forge:   { name: 'Forge world',      desc: '+30% ordnance and alloys; Oranges +4 loyalty',       mul: { ord: 1.3, alloy: 1.3 }, loy: { orange: 4 } },
  granary: { name: 'Granary',          desc: '+35% food; Reds +2 loyalty',                         mul: { food: 1.35 }, loy: { red: 2 } },
  legion:  { name: 'Legion world',     desc: '+25% manpower, +20% garrison cap; Grays and Obsidians +4', mul: { man: 1.25 }, loy: { war: 4 } },
  seat:    { name: 'Seat of a House',  desc: '+50% influence; Golds +6 loyalty',                    mul: { inf: 1.5 }, loy: { gold: 6 } },
  science: { name: 'Research world',   desc: '+50% research; Greens +6 loyalty',                    mul: { sci: 1.5 }, loy: { green: 6 } },
  port:    { name: 'Trade port',       desc: '+50% trade; Silvers and Coppers +6 loyalty',          mul: { trade: 1.5 }, loy: { mid: 6 } },
};
export const DESIG_COST = 20;   // influence
const dm = (w, k) => (DESIG[w.desig || 'none'].mul || {})[k] || 1;

// ---------------------------------------------------------------- taxes and administration
export const TAX = [
  { name: 'Light',    mul: .8,  loy: 6,   desc: 'Worlds pay 20% less; every estate +6 loyalty' },
  { name: 'Standard', mul: 1,   loy: 0,   desc: 'The customary levy' },
  { name: 'Heavy',    mul: 1.2, loy: -8,  desc: 'Worlds pay 20% more He-3, ore and ordnance; every estate −8 loyalty, labour and commerce −12' },
  { name: 'Crushing', mul: 1.4, loy: -16, desc: 'Worlds pay 40% more; every estate −16, labour and commerce −24. Expect strikes' },
];
const ADMIN0 = { rep: 7, soc: 7, rim: 23, neu: 99 };   // the Rim's Moon Lords rule their own moons; raised with the smaller worlds so no one starts over-extended
const MINOR = new Set(['marcher', 'hildas', 'amalthea', 'kalyke', 'hyperion', 'nereid', 'arrokoth', 'mimas', 'miranda', 'charon', 'thebe', 'deimos', 'enceladus']); // a rock or an outpost is half a world to govern
export const adminCap = f => ADMIN0[f] + TE.mod(f, 'admin') + Object.values(C.worlds).reduce((a, w) => a + (w.owner === f ? 4 * (w.lv.court || 0) : 0), 0) + 2 * govsOf(f).length;
export const sprawlOf = w => w.id === 'rhea' ? .5 : (bodyOf(w.id).gas || MINOR.has(w.id) ? .5 : 1) + (w.owner !== w.home ? .5 : 0);
export const sprawl = f => Object.values(C.worlds).reduce((a, w) => a + (w.owner === f ? sprawlOf(w) + .03 * Object.values(w.lv).reduce((b, v) => b + v, 0) : 0), 0) + Math.max(0, C.fleets.filter(fl => fl.owner === f).length - 3) * .5; // worlds, what is built on them, and fleets past the third
export const overSprawl = f => Math.max(0, sprawl(f) - adminCap(f));
export const sprawlMul = f => clamp(1 - .03 * overSprawl(f), .6, 1);
export const govsOf = f => (C.cmdrs || []).filter(c => c.owner === f && c.state === 'gov');
export const govOf = (f, r) => govsOf(f).find(c => c.region === r);
export const GOV_COST = 40;     // influence
export function appointGov(f, cid, region) {
  const c = C.cmdrs.find(x => x.id === cid), r = C.fac[f].res;
  if (!c || c.owner !== f || c.state !== 'pool') return 'not available';
  if (!Object.values(C.worlds).some(w => w.owner === f && regionOf(w.id) === region)) return 'you hold nothing there';
  if (r.inf < GOV_COST) return `costs ${GOV_COST} influence`;
  const old = govOf(f, region); if (old) { old.state = 'pool'; old.region = null; }
  r.inf -= GOV_COST; c.state = 'gov'; c.region = region; return null;
}
// a governor of a region the realm no longer holds goes home
export function govTick() { for (const c of (C.cmdrs || [])) if (c.state === 'gov' && !Object.values(C.worlds).some(w => w.owner === c.owner && regionOf(w.id) === c.region)) { if (c.owner === C.player) note(`${c.name} comes home from ${c.region}: we hold no world there to govern.`, 'bad'); c.state = 'pool'; c.region = null; } }
export function recallGov(f, region) { const c = govOf(f, region); if (c) { c.state = 'pool'; c.region = null; } }
export function setDesig(f, w, k) {
  if (w.owner !== f || !DESIG[k] || (w.desig || 'none') === k) return 'cannot';
  const r = C.fac[f].res; if (k !== 'none' && r.inf < DESIG_COST) return `costs ${DESIG_COST} influence`;
  if (k !== 'none') r.inf -= DESIG_COST; w.desig = k; return null;
}

// ---------------------------------------------------------------- setup and capture
export function setupWorld(w) {
  w.cl = {}; for (const e of EK) w.cl[e] = clamp(target(w, e), 5, 95);
  w.desig = 'none'; w._loy = w.loyalty = avgLoy(w);
}
export function setupEconomy() {
  C.tax = { rep: 1, soc: 1, rim: 1, neu: 1 };
  for (const f of ['rep', 'soc', 'rim']) Object.assign(C.fac[f].res, { alloy: { rep: 400, soc: 900, rim: 500 }[f], rare: { rep: 60, soc: 120, rim: 80 }[f], inf: 60, sci: 0 });
  Object.assign(C.fac.neu.res, { alloy: 0, rare: 0, inf: 0, sci: 0 });
  // the great foundries of 753: Endymion, the Carthii yards on Venus, the Ganymede ring, the Martian docks
  for (const id of ['luna', 'venus', 'ganymede', 'mars']) { const w = C.worlds[id]; w.lv.foundry = 1; w.base++; }
  for (const w of Object.values(C.worlds)) { for (const k of ['foundry', 'court', 'lab']) w.lv[k] = w.lv[k] || 0; setupWorld(w); }
  C.worlds.luna.lv.court = 1; C.worlds.luna.base++; C.worlds.venus.lv.court = 1; C.worlds.venus.base++; C.worlds.io.lv.court = 1; C.worlds.io.base++;
  // the designations the books imply
  Object.assign(C.worlds.mars, { desig: 'mine' }); Object.assign(C.worlds.io, { desig: 'granary' }); Object.assign(C.worlds.venus, { desig: 'forge' });
  Object.assign(C.worlds.callisto, { desig: 'legion' }); Object.assign(C.worlds.europa, { desig: 'port' }); Object.assign(C.worlds.luna, { desig: 'port' });
  for (const w of Object.values(C.worlds)) { w._loy = w.loyalty = avgLoy(w); w.baseN = Object.keys(w.lv).filter(k => w.lv[k] > 0).length; }
  C.trade = {};
}
// a world changes hands: its peoples judge the new masters by their order, the manner of the taking, and their past
export function onCapture(w, by, base = 30) {
  for (const e of EK) w.cl[e] = clamp(base + ATT[by][e] * .8 - (w.scorched || 0) * 4, 3, 70);
  if (by === 'rep' && w.home !== 'rep') w.cl.red = clamp(w.cl.red + 20, 0, 85);   // the Reds hail the Rising
  w.desig = 'none'; w._loy = w.loyalty = avgLoy(w);
}

// ---------------------------------------------------------------- loyalty, estate by estate
export const avgLoy = w => { if (!w.cl) return w.loyalty; const m = mixOf(w.id); return EK.reduce((a, e) => a + m[e] * w.cl[e], 0); };
const beloved = w => fleetsAt(w.id, w.owner).some(f => CM.has(f, 'beloved'));
// where an estate's loyalty settles if nothing changes; every week it moves an eighth of the way there
export function targetParts(w, e) {
  const f = w.owner, P = [];
  if (f === 'neu') { P.push(['Free and unruled', 55]); return P; }
  P.push(['Base', 56]);
  const a = ATT[f][e]; if (a) P.push([`${BLOC_NAME[f]}'s order`, a]);
  if (w.owner === w.home) P.push(['Their own people rule', 8]); else { P.push(['Conquered', -8]); if (e === 'gold' && C.fac[w.home] && C.fac[w.home].alive) P.push([`Old loyalty to ${BLOC_NAME[w.home]}`, -8]); }
  const t = TAX[C.tax ? C.tax[f] : 1]; if (t.loy) P.push([`${t.name} taxes`, (e === 'red' || e === 'mid') && t.loy < 0 ? t.loy * 1.5 : t.loy]);
  if (C.fac[f].res.food < 0) P.push(['Famine', e === 'red' ? -16 : e === 'war' ? -10 : -6]);
  const wl = C.weary && C.weary[f] > 40 ? -Math.min(24, (C.weary[f] - 40) / 2) : 0; if (wl) P.push(['War weariness', wl]);
  const os = overSprawl(f); if (os > 0) P.push(['Over-extended administration', -Math.min(24, os * 3)]);
  if (w.lv.fort) P.push(['Fortress', 4 * w.lv.fort]);
  if (w.lv.court && e === 'gold') P.push(['Governor’s Court', 4 * w.lv.court]);
  if (w.garrison > 2000 && (e === 'red' || e === 'mid')) P.push(['A strong garrison', 3]);
  if (w.siege) P.push(['Under siege', -12]);
  if (w.works > C.turn && (e === 'red' || e === 'mid')) P.push(['Public works', 8]);
  { const fd = C.fac[f].res.food; if (e === 'red' && fd > 1000) P.push(['Full granaries', Math.min(4, Math.floor((fd - 1000) / 500))]); }
  const d = (DESIG[w.desig || 'none'].loy || {})[e]; if (d) P.push([DESIG[w.desig].name, d]);
  const g = govOf(f, regionOf(w.id)); if (g) P.push([`Governor ${g.name}`, 6 + (e === 'gold' && g.colour === 'Gold' ? 4 : 0) + (e === 'red' && g.colour !== 'Gold' && f === 'rep' ? 4 : 0)]);
  const rl = rb(w, 'loy'); if (rl) P.push([REGION_BONUS[regionOf(w.id)].name, rl]);
  const tl = TE.mod(f, 'loy') - PO.mod(f, 'loy') + (e === 'red' ? TE.mod(f, 'redLoy') : 0) + (e === 'gold' ? TE.mod(f, 'goldLoy') : 0); if (tl) P.push(['Traditions and technology', tl]);
  for (const p of PO.loyParts(f)) P.push(p); // the court: a council behind its Sovereign, a beloved ruler
  for (const id of PO.lawsOf(f)) { const L = PO.lawDef(f, id), v = L && L.est && L.est[e]; if (v) P.push([`Law: ${L.name}`, v]); }
  { const a = RU.actingOf(f); if (a && (a.traits || []).includes('populist') && (e === 'red' || e === 'gold')) P.push([`${a.name}, a Sovereign of the people`, e === 'red' ? 6 : -4]); }
  if (beloved(w)) P.push(['A beloved commander in orbit', 8]);
  if (w.scorched) P.push(['Bombarded', -Math.min(20, w.scorched * 3)]);
  if (w.sacked > C.turn) P.push(['Sacked', -Math.round((w.sacked - C.turn) / 24 * 20)]);
  if (w.client) P.push(['A free world under its own council', e === 'red' || e === 'low' ? 14 : 6]);
  if (w.fief && e === 'gold') P.push([`A fief of ${PO.defOf('soc', w.fief) ? PO.defOf('soc', w.fief).name : 'a great House'}`, 8]);
  if (w.hostage > C.turn && e === 'gold') P.push(['Their children are guests at Io', 4]);
  return P;
}
export const target = (w, e) => clamp(targetParts(w, e).reduce((a, p) => a + p[1], 0), 0, 100);

// the output of an estate: 60% at zero loyalty, full at a hundred; on strike, half that
export const strike = (w, e) => w.cl && w.cl[e] < 25;
const ef = (w, e) => w.cl ? (.6 + w.cl[e] / 250) * (strike(w, e) ? .5 : 1) : (.6 + w.loyalty / 250);

// ---------------------------------------------------------------- yields
// the Foundries share what ore the realm has in its depots: short of ore, every one of them runs slower
export function foundryShare(f) { if (f === 'neu') return 1; const need = Object.values(C.worlds).reduce((a, w) => a + (w.owner === f ? 40 * (w.lv.foundry || 0) * (w.siege ? .25 : 1) : 0), 0); return need > 0 ? clamp(Math.max(0, C.fac[f].res.ore) / need, 0, 1) : 1; }
// keep a world's loyalty equal to its estates after an outside change to them
// a jolt to the whole world after its weekly tick: it falls on every estate at once
export function jolt(w, d) { if (!w) return; if (!w.cl) { w.loyalty = clamp(w.loyalty + d, 0, 100); return; } for (const e of EK) w.cl[e] = clamp(w.cl[e] + d, 0, 100); syncLoy(w); }
export function syncLoy(w) { if (w && w.cl) w._loy = w.loyalty = avgLoy(w); }
export function yieldOf(w, WK) {
  const W = WD(w.id), b = bodyOf(w.id), gas = b.gas || (b.parent != null && BODIES[b.parent].gas), f = w.owner;
  const sieged = w.siege ? .25 : 1, tax = f !== 'neu' ? TAX[C.tax[f]].mul : 1, m = mixOf(w.id), pop = popOf(w.id);
  const R = ef(w, 'red'), O = ef(w, 'orange'), X = ef(w, 'war');
  const y = { he: 0, ore: 0, ord: 0, man: 0, food: 0, alloy: 0, rare: 0, inf: 0, sci: 0 };
  y.he = (W.prod.he * WK + 35 * w.lv.skimmer * (gas ? 1.6 : 1)) * R * sieged * tax * dm(w, 'he') * (rb(w, 'he') || 1);
  y.ore = (W.prod.ore * WK + 45 * w.lv.mine) * R * sieged * tax * dm(w, 'ore');
  y.ord = (W.prod.ord * WK + 90 * w.lv.arsenal) * O * sieged * tax * dm(w, 'ord') * (rb(w, 'ord') || 1);
  y.man = (W.prod.man * WK * .45 + 600 * w.lv.barracks) * X * sieged * dm(w, 'man') * (rb(w, 'man') || 1);
  y.food = W.prod.food * WK * (W.prod.food > 0 ? (strike(w, 'red') ? .5 : 1) * dm(w, 'food') * (rb(w, 'food') || 1) : 1) + 70 * w.lv.farms * R * 2 * dm(w, 'food');
  if (w.owner !== w.home && w.home !== 'neu') y.man *= .5; // conquered peoples fill fewer ranks
  // foundries: forty ore become thirty alloy, level by level, while the realm has ore to feed them
  if (w.lv.foundry) { const k = foundryShare(f); y.ore -= 40 * w.lv.foundry * sieged * k; y.alloy = 30 * w.lv.foundry * O * sieged * dm(w, 'alloy') * k; }
  y.rare = (RARE[w.id] || 0) * (1 + .35 * w.lv.mine) * R * sieged * dm(w, 'rare') * (rb(w, 'rare') || 1);
  y.inf = (m.gold * pop / 25 + 3 * w.lv.court + (CAPITAL[f] === w.id ? 5 : 0)) * ef(w, 'gold') * sieged * dm(w, 'inf');
  y.sci = (m.green * pop / 10 + 3 * w.lv.lab + (CAPITAL[f] === w.id ? 3 : 0)) * ef(w, 'green') * sieged * dm(w, 'sci');
  if (f !== 'neu') { const k = sprawlMul(f); for (const r in y) if (y[r] > 0) y[r] *= k * TE.yMul(f, r); }
  // a client world keeps most of its yields; a fief pays its House first (conquest.js)
  const sh = w.client ? { all: .33, man: 1 } : w.fief ? { all: .6, man: .8 } : null; if (sh) for (const r in y) if (y[r] > 0) y[r] *= sh[r] ?? sh.all;
  return y;
}
// trade: Silvers and Coppers move goods between a world and its capital. Lanes that cross the Belt run past the
// Ascomanni and the free pirates; a fleet at Ceres, or holding the Belt, keeps them off
export const BELT_IN = 2.1, BELT_OUT = 3.4;
const auOf = id => { const b = bodyOf(id), p = b.parent != null ? BODIES[b.parent] : b; return Math.hypot(p.x, p.y) / AU; };
export const crossesBelt = (a, b) => (auOf(a) < BELT_IN) !== (auOf(b) < BELT_IN) || (auOf(a) > BELT_OUT) !== (auOf(b) > BELT_OUT);
export function tradeOf(w) {
  const f = w.owner; if (f === 'neu' || w.siege) return 0;
  const m = mixOf(w.id), pacts = ['rep', 'soc', 'rim'].filter(o => o !== f && C.fac[o].alive).reduce((a, o) => a + ({ peace: .1, ally: .25 }[relOf(f, o)] || 0), 0);
  return m.mid * popOf(w.id) * .8 * ef(w, 'mid') * (strike(w, 'mid') ? 0 : 1) * dm(w, 'trade') * (1 + pacts) * sprawlMul(f) * TE.yMul(f, 'trade');
}
export function piracy(f) {
  let p = .35; if (fleetsAt('ceres', f).length) p *= .35; else if (C.worlds.ceres.owner === f) p *= .7;
  if (holdsRegion(f, 'The Belt')) p *= REGION_BONUS['The Belt'].pirate;
  if (C.crisis && C.crisis.ascomanni && C.crisis.ascomanni !== true) p = Math.min(.8, p * 2);
  return p;
}
export function tradeSummary(f) {
  const cap = CAPITAL[f] && C.worlds[CAPITAL[f]] && C.worlds[CAPITAL[f]].owner === f ? CAPITAL[f] : Object.keys(C.worlds).find(id => C.worlds[id].owner === f);
  let gross = 0, lost = 0; const p = piracy(f), rows = [];
  for (const w of Object.values(C.worlds)) if (w.owner === f) { const v = tradeOf(w); if (v < .5) continue; const x = cap && crossesBelt(w.id, cap) ? v * p : 0; gross += v; lost += x; rows.push([w.id, v, x]); }
  return { gross, lost, net: gross - lost, piracy: p, rows: rows.sort((a, b) => b[1] - a[1]) };
}

// ---------------------------------------------------------------- the weekly tick for a world
export function tickWorld(w) {
  if (!w.cl) setupWorld(w);
  const nm = bodyOf(w.id).name, f = w.owner;
  // a jolt to the world's loyalty from outside (bombardment, conquest, a siege) falls on every estate
  const shock = w.loyalty - (w._loy == null ? w.loyalty : w._loy);
  for (const e of EK) { const t = target(w, e); w.cl[e] = clamp(w.cl[e] + shock + (t - w.cl[e]) * .125, 0, 100); }
  w._loy = w.loyalty = avgLoy(w);
  w.unrest = EK.filter(e => w.cl[e] < 30 && mixOf(w.id)[e] > .03).length;
  if (f === 'neu') return;
  const mine = f === C.player;
  // the Reds rise: under the Republic, Harmony's Red Hand; under anyone else, the Sons of Ares
  if (w.cl.red < 22 && mixOf(w.id).red > .15 && rnd() < .12 * TE.mod(f, 'uprise') * (f !== 'rep' && C.fac.rep.alive && hostile('rep', f) ? TE.mod('rep', 'enemyUprise') : 1)) {
    if (f === 'rep') { w.garrison = Math.round(w.garrison * .85); const ks = Object.keys(w.lv).filter(k => w.lv[k] > 0 && k !== 'yard'); if (ks.length && rnd() < .35) { const k = ks[Math.floor(rnd() * ks.length)]; w.lv[k]--; if (k === 'grid') w.gun = Math.max(0, w.gun - 1); if (k === 'array') w.shield = Math.max(0, w.shield - 1); }
      if (mine) note(`The Red Hand strikes on ${nm}: bombs in the habs and the docks. Harmony's insurgents say the Republic has betrayed the Reds.`, 'bad', w.id, { title: 'The Red Hand on ' + nm, kind: 'revolt' }); }
    else {
      w.garrison = Math.round(w.garrison * .72);
      const rep = C.fac.rep.alive && hostile('rep', f);
      if (w.garrison < 900) { const old = f; w.owner = rep ? 'rep' : 'neu'; w.siege = null; P.seatLost(old, w.id); w.garrison = 1200; w.bq = []; w.sq = []; onCapture(w, w.owner, 45); if (w.owner === 'rep') { w.cl.red = 80; syncLoy(w); }
        note(`The Sons of Ares rise on ${nm}! The garrison of ${BLOC_NAME[old]} is overwhelmed and the world ${rep ? 'declares for the Republic' : 'declares itself free'}.`, old === C.player ? 'bad' : w.owner === C.player ? 'good' : 'gold', w.id, old === C.player || w.owner === C.player ? { title: 'The Sons of Ares rise', kind: 'revolt' } : null); return; }
      if (mine) note(`Sons of Ares cells strike the garrison of ${nm}. The Reds are on the edge of rising.`, 'bad', w.id);
    }
  }
  if (strike(w, 'war') && !TE.has(f, 'pacify')) { w.garrison = Math.round(w.garrison * .93); if (mine && rnd() < .3) note(`Legionnaires desert their posts on ${nm}.`, 'bad', w.id); }
  if (w.cl.gold < 20 && mixOf(w.id).gold > .04 && rnd() < .08) { C.fac[f].res.inf = Math.max(0, C.fac[f].res.inf - 15); jolt(w, -4); if (mine) note(`Golds of ${nm} plot against your governors. Influence is spent to buy them off.`, 'bad', w.id); }
  if (mine) for (const e of EK) if (w.cl[e] < 25 && (w._str || {})[e] !== true && mixOf(w.id)[e] > .03) note(`${ESTATES[e].name} of ${nm} ${STRIKE[e] || 'are on strike'}.`, 'bad', w.id);
  w._str = Object.fromEntries(EK.map(e => [e, w.cl[e] < 25]));
}
// storage: depots hold only so much; past it, a share of the excess spoils, leaks or is skimmed every week
export const STORE = { he: 15000, ore: 10000, ord: 12000, alloy: 6000, rare: 1500, inf: 1000, sci: 1e9, man: 250000, food: 3000 };
export function spoil(f) { const r = C.fac[f].res; let lost = 0; for (const k in STORE) if (r[k] > STORE[k]) { const x = (r[k] - STORE[k]) * .06; r[k] -= x; if (['he', 'ore', 'ord', 'alloy'].includes(k)) lost += x; }
  C.graft = C.graft || {}; C.graft[f] = lost; if (lost > 0) r.inf = Math.max(0, r.inf - lost / 500); } // hoards rot, and the skimming makes enemies at court

// ---------------------------------------------------------------- the treasury: where surplus goes, and what it buys at home
// Patronage buys influence, dearer each time; public works buy a world's Reds and commerce; charters buy naval capacity;
// a levy buys a garrison in a hurry; siege works break a holdout faster.
export const patronCost = f => Math.round(250 * ((C.patron && C.patron[f]) || 1));
export function patronage(f) {
  const r = C.fac[f].res, c = patronCost(f); if (r.he < c) return `needs ${c} He-3`;
  r.he -= c; r.inf += 15; C.patron = C.patron || {}; C.patron[f] = ((C.patron[f]) || 1) * 1.15;
  const G = C.pol && C.pol[f] ? C.pol[f].groups : []; for (const g of G) { if (['mod', 'saud', 'codovan', 'moderates'].includes(g.id)) g.sat = Math.min(100, g.sat + 1.5); if (g.id === 'vox') g.sat = Math.max(0, g.sat - .7); }
  return null;
}
export const WORKS = { he: 800, alloy: 150, weeks: 12 };
export function publicWorks(f, w) {
  const r = C.fac[f].res; if (w.owner !== f) return 'not your world'; if (w.works > C.turn) return 'works already under way here'; if (w.siege) return 'not while besieged';
  if (r.he < WORKS.he || (r.alloy || 0) < WORKS.alloy) return `needs ${WORKS.he} He-3 and ${WORKS.alloy} alloys`;
  r.he -= WORKS.he; r.alloy -= WORKS.alloy; w.works = C.turn + WORKS.weeks; return null;
}
export const CHARTER = { alloy: 400, rare: 40, inf: 10, upkeep: 20, cap: 6 };
export const chartersOf = f => (C.charters && C.charters[f]) || 0;
export const charterCost = f => { const k = 1 + .5 * chartersOf(f); return { alloy: Math.round(CHARTER.alloy * k), rare: Math.round(CHARTER.rare * k), inf: Math.round(CHARTER.inf * k) }; };
export function charter(f) {
  if (chartersOf(f) >= 6) return 'the yards can take no more charters'; const r = C.fac[f].res, c = charterCost(f);
  if ((r.alloy || 0) < c.alloy || (r.rare || 0) < c.rare || r.inf < c.inf) return `needs ${c.alloy} alloys, ${c.rare} rare metals and ${c.inf} influence`;
  r.alloy -= c.alloy; r.rare -= c.rare; r.inf -= c.inf; C.charters = C.charters || {}; C.charters[f] = chartersOf(f) + 1; return null;
}
export function treasuryTick() { for (const f in (C.patron || {})) C.patron[f] = Math.max(1, C.patron[f] * .95); } // patronage grows cheaper again as the favours are forgotten
export const LEVY = { he: 300, man: 3000, garrison: 1500, cd: 6 };
export function levy(f, w) {
  const r = C.fac[f].res; if (w.owner !== f) return 'not your world'; if ((w.levyT || -99) > C.turn) return `levied already: again in ${w.levyT - C.turn} weeks`;
  if (r.he < LEVY.he || r.man < LEVY.man) return `needs ${LEVY.he} He-3 and ${LEVY.man.toLocaleString()} manpower`;
  r.he -= LEVY.he; r.man -= LEVY.man; w.garrison += LEVY.garrison; w.levyT = C.turn + LEVY.cd; return null;
}
export const WORKS_SIEGE = 400;
export function siegeWorks(f, w) {
  const r = C.fac[f].res; if (!w.siege || w.siege.by !== f) return 'no siege of ours here'; if (!(w.siege.hold > 0)) return 'the defences are already broken'; if (w.siege.worksT === C.turn) return 'once a week';
  if (r.he < WORKS_SIEGE) return `needs ${WORKS_SIEGE} He-3`; r.he -= WORKS_SIEGE; w.siege.hold = Math.max(0, w.siege.hold - 1); w.siege.worksT = C.turn; return null;
}
export const yardsStalled = w => strike(w, 'orange');
export const crewOnLaunch = w => strike(w, 'blue') ? .6 : 1;

// ---------------------------------------------------------------- the AI's stewardship
export function aiEconomy(f) {
  const r = C.fac[f].res, ws = Object.values(C.worlds).filter(w => w.owner === f);
  const avg = ws.reduce((a, w) => a + w.loyalty, 0) / Math.max(1, ws.length);
  C.tax[f] = avg < 42 ? 0 : r.he < 600 && avg > 55 ? 2 : 1;
  for (const w of ws) if ((!w.desig || w.desig === 'none') && r.inf >= DESIG_COST + 10) {
    const W = WD(w.id), p = W.prod; let k = 'none';
    if (w.lv.yard >= 2 || w.lv.foundry) k = 'forge'; else if (p.food > 15) k = 'granary'; else if (p.he + p.ore > 18 || RARE[w.id]) k = 'mine'; else if (p.man > 150) k = 'legion'; else if (mixOf(w.id).mid > .2) k = 'port';
    if (k !== 'none') setDesig(f, w, k);
  }
  // surplus goes to work: patronage for influence, public works for unrest, charters for a capped navy
  if (r.he > STORE.he * .8 && r.inf < 300 && patronCost(f) < r.he * .05) patronage(f);
  if (r.he > 4000 && (r.alloy || 0) > 600) { const low = ws.filter(w => !(w.works > C.turn) && !w.siege).sort((a, b) => a.loyalty - b.loyalty)[0]; if (low && low.loyalty < 55) publicWorks(f, low); }
  if ((r.alloy || 0) > 1500 && (r.rare || 0) > 120 && r.inf > 60 && navalUsed(f) >= navalCap(f) - 2) charter(f);
  for (const w of ws) if (w.siege && hostile(f, w.siege.by) && r.he > 2000 && r.man > 20000) levy(f, w);
  for (const w of Object.values(C.worlds)) if (w.siege && w.siege.by === f && w.siege.hold > 0 && r.he > 6000) siegeWorks(f, w);
  // governors where the realm is over-extended or a region is restless
  const free = CM.pool(f);
  if (free.length > 1 && r.inf >= GOV_COST + 10) {
    const regs = REGIONS.filter(rg => !govOf(f, rg)).map(rg => [rg, ws.filter(w => regionOf(w.id) === rg)]).filter(x => x[1].length).sort((a, b) => b[1].length - a[1].length);
    if (regs.length && (overSprawl(f) > 0 || regs[0][1].some(w => w.loyalty < 45))) { const c = free.sort((a, b) => a.rank - b.rank)[0]; appointGov(f, c.id, regs[0][0]); }
  }
}
