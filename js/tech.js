// Phase C of the campaign: what a power learns, what it becomes, and how it fits out its ships.
// Technology comes as cards on three fields, Yards & Hulls, Weapons & Shields, Society & Legions: each field
// offers three projects drawn from what is within reach, and the Greens' research flows into the one chosen.
// Traditions are each power's own path, bought with influence. Refits change a hull's fit at a shipyard.
import { C, note, BLOC_NAME } from './camp.js';
import * as P from './politics.js';

const rnd = Math.random;
export const TRACKS = { hulls: 'Yards & Hulls', arms: 'Weapons & Shields', society: 'Society & Legions' };
export const TIER_COST = [0, 25, 55, 100, 170];
// effects: multiplicative unless the key is additive
const ADD = new Set(['loy', 'redLoy', 'goldLoy', 'admin', 'yardQ', 'mbAny', 'officerRank', 'trip']);
export const TECHS = {
  // ---------------------------------------------------------------- Yards & Hulls
  lattice:   { tr: 'hulls', tier: 1, name: 'Nanocarbon Lattice', desc: 'Every hull +10% structure', eff: { hull: 1.1 } },
  guilds:    { tr: 'hulls', tier: 1, name: 'Orange Yard Guilds', desc: 'Hulls are laid down 15% faster', eff: { build: .85 } },
  autodocs:  { tr: 'hulls', tier: 1, name: 'Autodoc Bays', desc: 'Repairs at your worlds +50%', eff: { repair: 1.5 } },
  tenders:   { tr: 'hulls', tier: 2, name: 'Tender Logistics', desc: 'Attrition out of supply halved', eff: { attrition: .5 } },
  keels:     { tr: 'hulls', tier: 2, name: 'Heavy Keels', desc: 'Destroyers and larger +15% structure', eff: { capHull: 1.15 } },
  torchdr:   { tr: 'hulls', tier: 2, name: 'Torch Drive Tuning', desc: 'Journeys of four weeks or more are a week shorter', eff: { trip: 1 } },
  arcology:  { tr: 'hulls', tier: 3, name: 'Foundry Arcologies', desc: '+25% alloys from every Foundry', eff: { alloy: 1.25 } },
  bays:      { tr: 'hulls', tier: 3, name: 'Starshell Bays', desc: 'Hangars hold 25% more; unlocks the Carrier refit', eff: { hangar: 1.25 } },
  slips:     { tr: 'hulls', tier: 3, name: 'Extra Slipways', desc: 'Two more hulls in each yard queue; naval capacity +15%', eff: { yardQ: 2, naval: 1.15 } },
  leviathan: { tr: 'hulls', tier: 4, name: 'Leviathan Keels', desc: 'Dreadnoughts and moonBreakers cost 20% less', eff: { dreadCost: .8 } },
  colossus:  { tr: 'hulls', tier: 4, name: 'The Colossus Plans', desc: 'Any level 3 shipyard can lay down a moonBreaker', eff: { mbAny: 1 } },
  quantum:   { tr: 'hulls', tier: 4, name: 'Quantum Fleet Command', desc: 'Every commander leads 25% more ships', eff: { cap: 1.25 } },
  // ---------------------------------------------------------------- Weapons & Shields
  magazines: { tr: 'arms', tier: 1, name: 'Railgun Magazines', desc: 'Guns +4% in battle', eff: { gun: 1.04 } },
  harmonics: { tr: 'arms', tier: 1, name: 'Pulse Shield Harmonics', desc: 'Shields +10%', eff: { shield: 1.1 } },
  presses:   { tr: 'arms', tier: 1, name: 'Ordnance Presses', desc: '+20% ordnance', eff: { ord: 1.2 } },
  lances:    { tr: 'arms', tier: 2, name: 'Lance Focusing', desc: 'Guns +4% in battle', eff: { gun: 1.04 } },
  layered:   { tr: 'arms', tier: 2, name: 'Layered Pulse Shields', desc: 'Shields +10%', eff: { shield: 1.1 } },
  platforms: { tr: 'arms', tier: 2, name: 'Orbital Gun Platforms', desc: 'World defences +25%', eff: { defense: 1.25 } },
  swarms:    { tr: 'arms', tier: 3, name: 'Missile Swarms', desc: 'Guns +6% in battle', eff: { gun: 1.06 } },
  arrays2:   { tr: 'arms', tier: 3, name: 'Shield Arrays Mark II', desc: 'Shield platforms count half again in a world’s defence', eff: { wshield: 1.5 } },
  siege:     { tr: 'arms', tier: 3, name: 'Siege Doctrine', desc: 'Bombardment breaks platforms and garrisons twice as fast', eff: { bombard: 2 } },
  kinetic:   { tr: 'arms', tier: 4, name: 'Kinetic Annihilators', desc: 'Guns +8% in battle', eff: { gun: 1.08 } },
  aegis:     { tr: 'arms', tier: 4, name: 'Aegis Shields', desc: 'Shields +15%', eff: { shield: 1.15 } },
  suppress:  { tr: 'arms', tier: 4, name: 'Drop Suppression', desc: 'Iron Rains land 20% more troops', eff: { rain: 1.2 } },
  // ---------------------------------------------------------------- Society & Legions
  gravboot:  { tr: 'society', tier: 1, name: 'GravBoot Drill', desc: 'Assault troops +15%', eff: { troops: 1.15 } },
  vaults:    { tr: 'society', tier: 1, name: 'Green Data Vaults', desc: '+20% research', eff: { sci: 1.2 } },
  carvers:   { tr: 'society', tier: 1, name: 'Carver Agronomy', desc: '+25% food', eff: { food: 1.25 } },
  academies: { tr: 'society', tier: 2, name: 'Legion Academies', desc: '+20% manpower', eff: { man: 1.2 } },
  holos:     { tr: 'society', tier: 2, name: 'Propaganda Holos', desc: 'Every estate +4 loyalty', eff: { loy: 4 } },
  coppers:   { tr: 'society', tier: 2, name: 'Copper Bureaucracy', desc: '+4 administration', eff: { admin: 4 } },
  doctrine:  { tr: 'society', tier: 3, name: 'Iron Rain Doctrine', desc: 'Iron Rains land 20% more troops', eff: { rain: 1.2 } },
  pacify:    { tr: 'society', tier: 3, name: 'Pacification Corps', desc: 'Risings on your worlds half as likely; strikes cost no deserters', eff: { uprise: .5 } },
  envoys:    { tr: 'society', tier: 3, name: 'Silver Envoys', desc: '+25% influence and trade', eff: { inf: 1.25, trade: 1.25 } },
  peerless:  { tr: 'society', tier: 4, name: 'Institute Reforms', desc: 'Commanders gain experience 50% faster', eff: { xp: 1.5 } },
  carved:    { tr: 'society', tier: 4, name: 'Carved Legions', desc: 'Garrison caps +30%', eff: { garrison: 1.3 } },
  golden:    { tr: 'society', tier: 4, name: 'A Golden Age', desc: 'Every yield +8%', eff: { all: 1.08 } },
};
// ---------------------------------------------------------------- traditions: each power's own path
export const TRAD = {
  rep: [
    { id: 'chains', line: 'The Rising', name: 'Break the Chains', desc: 'Reds +6 loyalty everywhere; the Sons of Ares rise twice as often on enemy worlds', eff: { redLoy: 6, enemyUprise: 2 } },
    { id: 'legions', line: 'The Rising', name: 'The Free Legions', desc: '+15% manpower; assault troops +10%', eff: { man: 1.15, troops: 1.1 } },
    { id: 'howlers', line: 'The Rising', name: 'The Howlers', desc: 'Every fleet +5% when auto-resolved; Iron Rains +10%', eff: { ar: 1.05, rain: 1.1 } },
    { id: 'reaper', line: 'The Rising', name: 'Hail Reaper', desc: 'Commanders gain experience 50% faster, and every estate +2', eff: { xp: 1.5, loy: 2 } },
    { id: 'charter', line: 'Vox Populi', name: 'The Senate Charter', desc: '+20% influence', eff: { inf: 1.2 } },
    { id: 'freetrade', line: 'Vox Populi', name: 'Free Trade', desc: '+25% trade', eff: { trade: 1.25 } },
    { id: 'quorum', line: 'Vox Populi', name: 'The Quorum', desc: '+4 administration', eff: { admin: 4 } },
    { id: 'endures', line: 'Vox Populi', name: 'The Republic Endures', desc: 'Every estate +4; war weariness grows 25% slower', eff: { loy: 4, weary: .75 } },
  ],
  soc: [
    { id: 'blood', line: 'The Peerage', name: 'Blood of the Conquerors', desc: 'Golds +6 loyalty everywhere', eff: { goldLoy: 6 } },
    { id: 'praetorians', line: 'The Peerage', name: 'The Praetorian Guard', desc: 'Garrison caps +25%', eff: { garrison: 1.25 } },
    { id: 'rainmasters', line: 'The Peerage', name: 'Masters of the Rain', desc: 'Iron Rains land 20% more troops', eff: { rain: 1.2 } },
    { id: 'scarred', line: 'The Peerage', name: 'Peerless Scarred', desc: 'New officers are raised as Praetors', eff: { officerRank: 1 } },
    { id: 'ash', line: 'The Ash Armada', name: 'Ash Doctrine', desc: 'Bombardment twice as effective', eff: { bombard: 2 } },
    { id: 'carthii', line: 'The Ash Armada', name: 'The Carthii Yards', desc: 'Hulls are laid down 15% faster', eff: { build: .85 } },
    { id: 'fear', line: 'The Ash Armada', name: 'Rule by Fear', desc: 'Risings on your worlds half as likely', eff: { uprise: .5 } },
    { id: 'dictator', line: 'The Ash Armada', name: 'The Dictator’s Will', desc: 'Guns +8% in battle', eff: { gun: 1.08 } },
  ],
  rim: [
    { id: 'oldways', line: 'The Moon Lords', name: 'The Old Ways', desc: 'Every estate +3 loyalty', eff: { loy: 3 } },
    { id: 'pantry', line: 'The Moon Lords', name: 'The Rim’s Pantry', desc: '+25% food and +10% He-3', eff: { food: 1.25, he: 1.1 } },
    { id: 'council', line: 'The Moon Lords', name: 'Council of Moon Lords', desc: '+6 administration', eff: { admin: 6 } },
    { id: 'dominion', line: 'The Moon Lords', name: 'The Dominion', desc: '+20% influence and trade', eff: { inf: 1.2, trade: 1.2 } },
    { id: 'deep', line: 'The Dust Armada', name: 'Deep-Space Crews', desc: 'Attrition out of supply halved; shields +10%', eff: { attrition: .5, shield: 1.1 } },
    { id: 'lancers', line: 'The Dust Armada', name: 'Lancer Wings', desc: 'Every fleet +5% when auto-resolved', eff: { ar: 1.05 } },
    { id: 'watch', line: 'The Dust Armada', name: 'The Distant Watch', desc: 'Pickets reach twice as far', eff: { pickR: 2 } },
    { id: 'raafleet', line: 'The Dust Armada', name: 'Raa Fleet Doctrine', desc: 'Every commander leads 25% more ships', eff: { cap: 1.25 } },
  ],
};
export const tradCost = f => Math.round((40 + 40 * ((C.trad && C.trad[f]) || []).length) * P.mod(f, 'trad'));

// ---------------------------------------------------------------- refits
export const FITS = {
  standard:    { name: 'Standard',     desc: 'The yard’s own fit', mul: {} },
  gunline:     { name: 'Gun Line',     desc: 'Guns +20%, shields −15%', mul: { gun: 1.2, shield: .85 }, ar: 1.07 },
  armoured:    { name: 'Armoured',     desc: 'Structure +20%, shields +10%, thrust −15%', mul: { hp: 1.2, shield: 1.1, thrust: .85 }, ar: 1.07 },
  assault:     { name: 'Assault',      desc: 'Marines +60%, guns −10%: built to board', mul: { mar: 1.6, gun: .9 }, ar: .98, troops: 1.6 },
  interceptor: { name: 'Interceptor',  desc: 'Thrust and turn +25%, structure −10%', mul: { thrust: 1.25, turn: 1.25, hp: .9 }, ar: 1.03 },
  carrier:     { name: 'Carrier',      desc: 'Hangars +50%, guns −15% (needs hangars and Starshell Bays)', mul: { hangar: 1.5, gun: .85 }, ar: 1.05, req: (f, d) => d.hangar && has(f, 'bays') },
};
// ---------------------------------------------------------------- ship classes: a hull and four fittings
// A class is a hull fitted out four ways: its main battery, its protection, its complement and its drive. Each
// choice is a trade, priced into the hull, shown on the model, and reduced to multipliers for battle and auto-resolve.
// The old whole-ship fits (above) still apply to hulls refitted before classes existed.
export const SLOTS = [
  { k: 'main', name: 'Main battery', opts: {
    rail:    { name: 'Rail batteries', desc: 'The yard’s standard broadside', mul: {} },
    heavy:   { name: 'Heavy rails', desc: 'Guns +18%, turn −10%', mul: { gun: 1.18, turn: .9 }, cost: .12, time: .1, ar: 1.06, tag: 'h' },
    missile: { name: 'Missile cells', desc: 'Missiles reload 80% faster with half again the magazine; other guns −15%', mul: { gun: .85, missile: 1.8 / .85, misMag: 1.5 }, cost: .08, ar: 1.04, tag: 'm', req: 'presses', ok: d => d.weapons.some(w => w[0] === 'missile') },
  } },
  { k: 'def', name: 'Protection', opts: {
    balanced: { name: 'Balanced', desc: 'The yard’s standard plating and shields', mul: {} },
    armour:   { name: 'Armour belts', desc: 'Structure +25%, shields −10%, thrust −8%', mul: { hp: 1.25, shield: .9, thrust: .92 }, cost: .1, time: .1, ar: 1.06, tag: 'a' },
    shields:  { name: 'Shield-heavy', desc: 'Shields +25%, structure −10%', mul: { shield: 1.25, hp: .9 }, cost: .08, ar: 1.04, tag: 's', req: 'harmonics' },
    screen:   { name: 'Point-defence screen', desc: 'Point defence fires 70% faster; other guns −8%', mul: { pd: 1.7 / .92, gun: .92 }, cost: .06, ar: 1.03, tag: 'p', req: 'layered', ok: d => d.weapons.some(w => w[0] === 'pd') },
  } },
  { k: 'bay', name: 'Complement', opts: {
    crew:     { name: 'Standard complement', desc: 'The yard’s own crew and hangar mix', mul: {} },
    marines:  { name: 'Marine barracks', desc: 'Marines +60%, guns −10%: built to board', mul: { mar: 1.6, gun: .9 }, troops: 1.6, ar: .98 },
    fighters: { name: 'Fighter decks', desc: 'ripWings +60%; starShells and assault pods −50%', mul: { hmix: { ripwing: 1.6, starshell: .5, boarder: .5 } }, ar: 1.03, tag: 'c', ok: d => d.hangar && d.hangar.ripwing },
    boarding: { name: 'Boarding decks', desc: 'starShells +50%, assault pods +75%, marines +30%; ripWings −50%', mul: { hmix: { ripwing: .5, starshell: 1.5, boarder: 1.75 }, mar: 1.3 }, troops: 1.3, ar: 1.02, tag: 'c', ok: d => d.hangar && (d.hangar.starshell || d.hangar.boarder) },
    carrier:  { name: 'Carrier', desc: 'Every hangar +50%, guns −15%', mul: { hangar: 1.5, gun: .85 }, cost: .1, ar: 1.05, tag: 'c', req: 'bays', ok: d => d.hangar },
  } },
  { k: 'drive', name: 'Drive', opts: {
    standard: { name: 'Standard drive', desc: 'The yard’s own engines', mul: {} },
    torch:    { name: 'Torch drive', desc: 'Thrust and turn +25%, structure −10%', mul: { thrust: 1.25, turn: 1.25, hp: .9 }, cost: .08, ar: 1.03, tag: 't' },
    cold:     { name: 'Cold-running drive', desc: 'Signature halved in battle and a fleet of them is harder to track; thrust −10%', mul: { sig: .55, thrust: .9 }, cost: .1, ar: 1.01, tag: 'q', csig: .65, req: 'torchdr' },
  } },
];
export const SLOT_STD = { main: 'rail', def: 'balanced', bay: 'crew', drive: 'standard' };
export const optOf = (k, o) => (SLOTS.find(x => x.k === k) || { opts: {} }).opts[o];
// can power f fit option o in slot k to hull def d? null if so, otherwise why not
export function optWhy(f, d, k, o) { const O = optOf(k, o); if (!O) return 'unknown'; if (O.ok && !O.ok(d)) return 'this hull cannot take it'; if (O.req && !has(f, O.req)) return 'needs ' + (TECHS[O.req] ? TECHS[O.req].name : O.req); return null; }
export const designable = d => d && !d.static && !d.fighter && !d.shell && (d.value || d.cost || 0) >= 150;
// everything a class of slots comes to: one set of multipliers, a price, a build time, a weight for auto-resolve, the model's tags
export function specOf(slots) {
  const mul = {}, out = { mul, cost: 1, time: 1, ar: 1, troops: 1, tags: '', csig: 0 };
  for (const S of SLOTS) { const O = S.opts[slots[S.k]] || S.opts[SLOT_STD[S.k]];
    for (const [k, v] of Object.entries(O.mul)) { if (k === 'hmix') { mul.hmix = mul.hmix || {}; for (const [h, x] of Object.entries(v)) mul.hmix[h] = (mul.hmix[h] || 1) * x; } else mul[k] = (mul[k] || 1) * v; }
    out.cost += O.cost || 0; out.time += O.time || 0; out.ar *= O.ar || 1; out.troops *= O.troops || 1; if (O.tag) out.tags += O.tag; if (O.csig) out.csig = O.csig; }
  return out;
}
// a power's saved classes; old campaigns get their presets on first use
export function classesOf(f) { C.classes = C.classes || {}; if (!C.classes[f]) C.classes[f] = presetClasses(f); return C.classes[f]; }
export const classById = (f, id) => id ? classesOf(f).find(c => c.id === id) || null : null;
export const classSpec = (f, id) => { const c = classById(f, id); return c ? specOf(c.s) : null; };
// each navy's doctrine, as the classes it starts with: the Society's gun lines, the Republic's boarders and carriers, the Rim's fast raiders
const PRESETS = {
  soc: [['dread', 'Pax', { main: 'heavy' }], ['destroyer', 'Lance', { main: 'heavy', def: 'armour' }], ['torch', 'Pike', { main: 'heavy', drive: 'torch' }], ['frigate', 'Spatha', { def: 'armour' }]],
  rep: [['dread', 'Ares', { bay: 'boarding' }], ['destroyer', 'Howler', { bay: 'boarding' }], ['torch', 'Pegasus', { bay: 'marines', drive: 'torch' }], ['frigate', 'Sevro', { drive: 'torch' }]],
  rim: [['dread', 'Dustwalker', { drive: 'torch' }], ['destroyer', 'Raa', { drive: 'torch' }], ['torch', 'Ganymede', { drive: 'torch', bay: 'marines' }], ['raider', 'Lancer', { main: 'heavy', drive: 'torch' }], ['frigate', 'Io', { drive: 'torch' }]],
  neu: [],
};
function presetClasses(f) { return (PRESETS[f] || []).map(([hull, name, s], i) => ({ id: f + ':p' + i, name, hull, s: { ...SLOT_STD, ...s }, preset: true })); }
export function saveClass(f, c) { const L = classesOf(f); if (!c.id) { c.id = f + ':' + Date.now().toString(36) + Math.floor(Math.random() * 99); L.push(c); } else { const i = L.findIndex(x => x.id === c.id); if (i >= 0) L[i] = c; else L.push(c); } return c; }
export function deleteClass(f, id) { C.classes[f] = classesOf(f).filter(c => c.id !== id); for (const fl of C.fleets) if (fl.owner === f) for (const s of fl.ships) if (s.cls === id) s.cls = undefined; }
export const fitCost = d => ({ alloy: Math.round((d.value || 100) * .08), he: Math.round((d.value || 100) * .12) });
export const fitOK = (f, d, k) => !d.static && !d.fighter && !d.shell && (d.value || 0) >= 150 && (!FITS[k].req || FITS[k].req(f, d));

// ---------------------------------------------------------------- state and modifiers
export function setupTech() {
  C.tech = {}; C.trad = {};
  for (const f of ['rep', 'soc', 'rim', 'neu']) {
    C.tech[f] = { done: [], cur: { hulls: null, arms: null, society: null }, prog: { hulls: 0, arms: 0, society: 0 }, offers: { hulls: [], arms: [], society: [] }, focus: null };
    C.trad[f] = [];
    for (const t in TRACKS) drawOffers(f, t);
  }
}
export const has = (f, id) => !!(C.tech && C.tech[f] && C.tech[f].done.includes(id)) || !!(C.trad && C.trad[f] && C.trad[f].includes(id));
const effsOf = f => { const out = []; if (!C.tech || !C.tech[f]) return out; for (const id of C.tech[f].done) out.push(TECHS[id].eff); for (const id of (C.trad[f] || [])) { const t = (TRAD[f] || []).find(x => x.id === id); if (t) out.push(t.eff); } return out; };
export function mod(f, key) {
  let v = ADD.has(key) ? 0 : 1;
  for (const e of effsOf(f)) if (e[key] != null) v = ADD.has(key) ? v + e[key] : v * e[key];
  const pm = P.mod(f, key); v = ADD.has(key) ? v + (key === 'loy' ? pm : 0) : v * pm;
  return v;
}
// what a yield is multiplied by: its own key and 'all'
export const yMul = (f, k) => f === 'neu' ? 1 : mod(f, k) * mod(f, 'all');
// auto-resolve strength: guns, shields and hulls all tell
export const arMul = f => mod(f, 'gun') * (1 + .5 * (mod(f, 'shield') - 1)) * (1 + .4 * (mod(f, 'hull') - 1)) * mod(f, 'ar');
// the campaign's ship designs, with technology applied
export function applyDefs(f, defs) {
  const hull = mod(f, 'hull'), cap = mod(f, 'capHull'), sh = mod(f, 'shield'), tr = mod(f, 'troops'), hg = mod(f, 'hangar'), dc = mod(f, 'dreadCost');
  for (const k in defs) {
    const d = defs[k]; if (d.static) continue;
    d.hp = Math.round(d.hp * hull * (d.cmd ? cap : 1)); if (d.shield) d.shield = Math.round(d.shield * sh);
    if (d.troops) d.troops = Math.round(d.troops * tr);
    if (d.hangar && hg !== 1) { d.hangar = { ...d.hangar }; for (const h in d.hangar) d.hangar[h] = Math.round(d.hangar[h] * hg); }
    if ((k === 'dread' || k === 'moonbreaker') && dc !== 1) { d.cost = Math.round(d.cost * dc); d.ore = Math.round(d.ore * dc); }
  }
  return defs;
}

// ---------------------------------------------------------------- research
const avail = (f, t) => { const T = C.tech[f], done = T.done.filter(id => TECHS[id].tr === t); const tierOK = n => n === 1 || done.filter(id => TECHS[id].tier === n - 1).length >= 2;
  return Object.keys(TECHS).filter(id => TECHS[id].tr === t && !T.done.includes(id) && T.cur[t] !== id && tierOK(TECHS[id].tier)); };
export function drawOffers(f, t) {
  const pool = avail(f, t).sort(() => rnd() - .5).sort((a, b) => TECHS[a].tier - TECHS[b].tier);
  // mostly the lowest tiers within reach, with a chance of a deeper card
  const out = pool.slice(0, 2); const deep = pool.slice(2).sort(() => rnd() - .5)[0]; if (deep) out.push(deep);
  C.tech[f].offers[t] = out;
}
export const costOf = (id, f = C.player) => Math.round(TIER_COST[TECHS[id].tier] * (1 + .08 * (C.tech && C.tech[f] ? C.tech[f].done.filter(x => TECHS[x].tr === TECHS[id].tr).length : 0)));
// the Greens' raw output becomes research: the first labs count for most, a vast realm's for less
export const effSci = raw => raw > 0 ? 4 + 5 * Math.sqrt(raw) : 0;
export function pick(f, t, id) {
  const T = C.tech[f]; if (!T.offers[t].includes(id) || T.cur[t]) return 'cannot';
  T.cur[t] = id; T.offers[t] = []; return null;
}
export const shares = f => { const T = C.tech[f], live = Object.keys(TRACKS); const fc = T.focus;
  return Object.fromEntries(live.map(t => [t, fc ? (t === fc ? .5 : .25) : 1 / 3])); };
export function tick(f) {
  const T = C.tech[f], r = C.fac[f].res; if (!T) return;
  const pts = effSci(r.sci); r.sci = 0; const sh = shares(f);
  for (const t in TRACKS) {
    T.prog[t] += pts * sh[t];
    const id = T.cur[t]; if (!id) continue;
    if (T.prog[t] >= costOf(id, f)) {
      T.prog[t] -= costOf(id, f); T.done.push(id); T.cur[t] = null; delete C.defs[f]; drawOffers(f, t);
      if (f === C.player) { note(`Research complete: ${TECHS[id].name}. ${TECHS[id].desc}.`, 'good'); C.newTech = true; }
    }
  }
  // the AI picks at once; the player is asked
  if (C.fac[f].ai) for (const t in TRACKS) if (!T.cur[t] && T.offers[t].length) pick(f, t, T.offers[t][Math.floor(rnd() * T.offers[t].length)]);
}
// a one-off grant of research, outside the week's flow (events, stolen data)
export function grant(f, pts) { const T = C.tech && C.tech[f]; if (!T) return; const sh = shares(f); for (const t in TRACKS) T.prog[t] += pts * sh[t]; }
export function takeTrad(f, id) {
  const L = TRAD[f] || [], t = L.find(x => x.id === id), mine = C.trad[f], r = C.fac[f].res;
  if (!t || mine.includes(id)) return 'cannot';
  const prev = L.filter(x => x.line === t.line), i = prev.indexOf(t); if (i > 0 && !mine.includes(prev[i - 1].id)) return 'take the one before it first';
  const c = tradCost(f); if (r.inf < c) return `costs ${c} influence`;
  r.inf -= c; mine.push(id); delete C.defs[f];
  if (f === C.player) note(`Tradition adopted: ${t.name}. ${t.desc}.`, 'gold');
  return null;
}
export function aiTech(f) {
  const r = C.fac[f].res, c = tradCost(f);
  if (r.inf > c + 50 && rnd() < .35) { const L = (TRAD[f] || []).filter(t => !C.trad[f].includes(t.id)); const ok = L.filter(t => { const p = L.concat().filter(x => x.line === t.line); return (TRAD[f].filter(x => x.line === t.line).indexOf(t) === 0) || C.trad[f].includes(TRAD[f].filter(x => x.line === t.line)[TRAD[f].filter(x => x.line === t.line).indexOf(t) - 1].id); });
    if (ok.length) takeTrad(f, ok[Math.floor(rnd() * ok.length)].id); }
}
export const pendingChoice = f => C.tech && C.tech[f] ? Object.keys(TRACKS).filter(t => !C.tech[f].cur[t] && C.tech[f].offers[t].length) : [];
