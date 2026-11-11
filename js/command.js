// Phase A of the campaign: the Golds (and, for the Republic, the officers of every Colour) who command the
// fleets. A fleet's size is limited by its commander's rank; supply, attrition and war weariness grind at
// fleets and peoples; pickets intercept, fleets can force a torch burn, and sieges have stances.
import { C, note, fleetsAt, hostile, relOf, BLOC_NAME, CAPITAL, defsOf, chron, human } from './camp.js';
import { bodyOf, AU } from './solar.js';
import { BODIES } from './data.js';
import * as TE from './tech.js';
import * as AG from './agents.js';
import * as IN from './intel.js';
import * as P from './politics.js';
import * as RU from './rulers.js';
import * as ST from './story.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v, pickOne = a => a[Math.floor(rnd() * a.length)];
export const RANK = ['Legate', 'Praetor', 'Imperator', 'ArchImperator'];
export const CAP = [8, 14, 22, 32];
export const PATROL = 4;                 // what a fleet without a commander can hold together
export const XP_NEXT = [100, 300, 700, Infinity];
// talents: the first six also act in real-time battle (the tactical game's commander traits)
export const TALENT = {
  helm: { name: 'Master Helmsman', desc: '+20% thrust and turn rate in battle', tac: true },
  gunnery: { name: 'Gunnery Chief', desc: '+20% reload speed in battle; +6% strength when auto-resolved', tac: true, ar: 1.06 },
  discipline: { name: 'Iron Discipline', desc: 'Crews do not break: loyalty never falls below 30% in battle', tac: true },
  breacher: { name: 'Breacher', desc: '+50% marines aboard the flagship; boarders fight 30% harder', tac: true },
  inspiring: { name: 'Inspiring', desc: 'Nearby ships regain loyalty and fire faster in battle', tac: true },
  peerless: { name: 'Peerless Scarred', desc: 'A Peerless Scarred: +10% helm, gunnery and loyalty; hard to kill', tac: true, ar: 1.04 },
  marshal: { name: 'Marshal', desc: 'Commands 50% more ships' },
  tactician: { name: 'Tactician', desc: '+12% fleet strength when auto-resolved', ar: 1.12 },
  shield: { name: 'Shieldwall', desc: 'Defending, the fleet loses a quarter less' },
  hunter: { name: 'Hunter', desc: 'Picket range doubled; a fleeing enemy loses more' },
  torch: { name: 'Torch Captain', desc: 'Journeys of three weeks or more are a week shorter' },
  quarter: { name: 'Quartermaster', desc: 'No attrition out of supply; double repairs at friendly worlds' },
  rain: { name: 'Rain Master', desc: 'Her Iron Rains land 30% more troops' },
  butcher: { name: 'Butcher', desc: 'Bombardment breaks platforms and garrisons faster; worlds he takes hate him' },
  beloved: { name: 'Beloved', desc: 'Every estate of a world she orbits +8 loyalty' },
};
// the heroes of the books: each has a line of three talents of their own, offered first when they are promoted.
// as: the common talents a hero's talent counts as (so its effects are the ones the rules already know)
export const HERO_LINE = {
  Darrow: [['reaper', 'The Reaper', 'The name alone breaks crews: +8% strength when auto-resolved; a fleeing enemy loses more', { ar: 1.08, as: ['hunter'] }], ['helldiver', 'Helldiver', 'The pilot of the Institute: journeys of three weeks or more a week shorter, +20% thrust and turn in battle', { as: ['torch', 'helm'] }], ['breaker', 'Breaker of Chains', 'Every estate of a world he orbits +8 loyalty; the worlds he takes start the more loyal', { as: ['beloved'] }]],
  Sevro: [['howler', 'The Howlers', 'His pack: +8% strength when auto-resolved', { ar: 1.08 }], ['goblin', 'Goblin', 'Hit and run: journeys of three weeks or more a week shorter', { as: ['torch'] }], ['ares', 'Son of Ares', 'Nearby ships regain loyalty and fire faster in battle; no attrition out of supply', { as: ['inspiring', 'quarter'] }]],
  Kavax: [['bear', 'The Bear of Mars', 'Defending, the fleet loses a quarter less, and fights 5% harder', { ar: 1.05, as: ['shield'] }], ['telemanus', 'House Telemanus', 'Commands 50% more ships', { as: ['marshal'] }], ['sophocles', 'Sophocles', 'Beloved by every Color: estates of a world he orbits +8 loyalty', { as: ['beloved'] }]],
  Orion: [['navarch', 'Navarch', 'The Republic’s finest ship-handler: +12% strength when auto-resolved', { as: ['tactician'] }], ['blueline', 'The Blue Line', 'Picket range doubled; a fleeing enemy loses more', { as: ['hunter'] }], ['morningstar', 'Morning Star', 'She knows the old Colossus: +6% strength when auto-resolved', { ar: 1.06 }]],
  Victra: [['julii', 'The Julii Fortune', 'No attrition out of supply; double repairs at friendly worlds; +5% strength', { ar: 1.05, as: ['quarter'] }], ['vengeance', 'Vengeance', 'A fleeing enemy loses more; picket range doubled', { as: ['hunter'] }], ['barcawife', 'House Barca', 'Nearby ships regain loyalty and fire faster in battle', { as: ['inspiring'] }]],
  Atalantia: [['ashspear', 'The Spear of the Ash Lord', '+8% strength when auto-resolved', { ar: 1.08 }], ['dictator', 'Dictator', 'Crews do not break: loyalty never below 30% in battle', { as: ['discipline'] }], ['ashfire', 'Ashfire', 'Bombardment breaks platforms and garrisons faster', { as: ['butcher'] }]],
  Kalindora: [['loveknight', 'The Love Knight', 'Defending, the fleet loses a quarter less; +4% strength', { ar: 1.04, as: ['shield'] }], ['olympic', 'Olympic Knight', 'Nearby ships regain loyalty and fire faster in battle', { as: ['inspiring'] }], ['oath', 'The Knight’s Oath', '+20% thrust and turn rate in battle', { as: ['helm'] }]],
  Ajax: [['stormknight', 'The Storm Knight', 'Boarders fight 30% harder; +6% strength', { ar: 1.06, as: ['breacher'] }], ['gorgon', 'Gorgon', 'A fleeing enemy loses more', { as: ['hunter'] }], ['grimmusson', 'Son of Grimmus', 'Commands 50% more ships', { as: ['marshal'] }]],
  Atlas: [['fearknight', 'The Fear Knight', '+6% strength; enemy crews break sooner', { ar: 1.06 }], ['zero', 'The Zero', 'Journeys of three weeks or more a week shorter', { as: ['torch'] }], ['stain', 'Stain', 'Bombardment breaks platforms and garrisons faster', { as: ['butcher'] }]],
  Diomedes: [['tempest', 'The Storm Knight of the Rim', '+8% strength when auto-resolved', { ar: 1.08 }], ['dustwalker', 'Dustwalker', 'No attrition out of supply; double repairs at friendly worlds', { as: ['quarter'] }], ['raahonour', 'The Honour of Raa', 'Crews do not break; nearby ships regain loyalty', { as: ['discipline', 'inspiring'] }]],
  Seraphina: [['dustlancer', 'Lancer of the Dust', 'Picket range doubled; a fleeing enemy loses more', { as: ['hunter'] }], ['raablood', 'Blood of Raa', 'Nearby ships regain loyalty and fire faster in battle', { as: ['inspiring'] }], ['ringwarden', 'Ring Warden', '+20% reload in battle; +6% strength', { as: ['gunnery'] }]],
  Dido: [['saudgold', 'Saud Gold', 'No attrition out of supply', { as: ['quarter'] }], ['queen', 'Queen of Io', 'Commands 50% more ships', { as: ['marshal'] }], ['venusborn', 'Venus-born', '+5% strength when auto-resolved', { ar: 1.05 }]],
};
for (const k in HERO_LINE) for (const [id, name, desc, x] of HERO_LINE[k]) TALENT[id] = { name, desc, hero: k, ...x, tac: (x.as || []).some(t => TALENT[t] && TALENT[t].tac) };
export const heroOf = c => c && c.lore ? Object.keys(HERO_LINE).find(k => (c.name || '').startsWith(k)) || null : null;
// every talent a commander has in effect: their own, what their hero talents count as, what an heirloom gives
export const effTalents = c => { if (!c) return []; const L = c.talents.slice(); for (const t of c.talents) for (const a of (TALENT[t] && TALENT[t].as) || []) if (!L.includes(a)) L.push(a); for (const h of heirOf(c)) for (const a of HEIR[h].as || []) if (!L.includes(a)) L.push(a); return L; };
export const hasT = (c, t) => effTalents(c).includes(t);
// ---------------------------------------------------------------- heirlooms
// things that change hands: won in a duel, or taken by killing or capturing their bearer
export const HEIR = {
  razorD: { name: 'Darrow’s razor', bearer: 'Darrow', desc: 'The Reaper’s slingBlade: its bearer’s fleet +5% strength; boarders fight harder', ar: 1.05, as: ['breacher'] },
  razorS: { name: 'Sevro’s razor', bearer: 'Sevro', desc: 'The Goblin’s blade: a fleeing enemy loses more', ar: 1.02, as: ['hunter'] },
  mstar: { name: 'The Morning Star’s command', bearer: 'Orion', desc: 'The command codes of the Morning Star: +4% strength, +10% with a moonBreaker in the fleet', ar: 1.04, mb: 1.06 },
  razorA: { name: 'Atalantia’s razor', bearer: 'Atalantia', desc: 'The blade of the Ash Lord’s daughter: +5% strength', ar: 1.05 },
  razorK: { name: 'Kalindora’s razor', bearer: 'Kalindora', desc: 'The Love Knight’s blade: crews do not break', ar: 1.02, as: ['discipline'] },
};
export const heirOf = c => !c || !C.heir ? [] : Object.keys(HEIR).filter(k => C.heir[k] === c.id);
export const heirMul = fl => { const c = cmdrOf(fl); let m = 1; for (const k of heirOf(c)) { const H = HEIR[k]; m *= H.ar || 1; if (H.mb && fl.ships.some(s => s.t === 'moonbreaker')) m *= H.mb; } return m; };
export function setupHeir() { C.heir = {}; for (const k in HEIR) { const c = C.cmdrs.find(x => x.lore && x.name.startsWith(HEIR[k].bearer)); if (c) C.heir[k] = c.id; } }
// a bearer killed or taken: the heirloom passes to the enemy's best commander at hand, or into the enemy's keeping
function heirFate(k, c, by) {
  if (!C.heir || !by || by === c.owner || !['rep', 'soc', 'rim', 'neu'].includes(by)) return;
  for (const h of heirOf(c)) {
    const fl0 = c.fleet && C.fleets.find(x => x.id === c.fleet), at = fl0 ? fl0.at : null;
    const L = C.cmdrs.filter(o => o.owner === by && o.state === 'fleet' && o !== c), here = L.filter(o => { const f = C.fleets.find(x => x.id === o.fleet); return f && at && f.at === at; });
    const to = (here.length ? here : L).sort((a, b) => b.rank - a.rank)[0];
    if (to) giveHeir(h, to, k === 'kill' ? `taken from the body of ${c.name}` : `taken with ${c.name}`); else { delete C.heir[h]; C.heirKept = C.heirKept || {}; C.heirKept[h] = by; }
  }
}
export function giveHeir(h, to, how) {
  C.heir[h] = to.id; const H = HEIR[h];
  note(`${H.name}, ${how}, passes to ${to.name} of ${BLOC_NAME[to.owner] || 'the raiders'}.`, to.owner === C.player ? 'good' : 'gold', null);
  chron('capture', `${H.name} passes to ${to.name}.`, null, to.owner);
}
// the war's commanders in 753 PCE. Ranks are game ranks; the Republic promotes officers of every Colour.
const LORE = {
  rep: [
    { name: 'Darrow au Andromedus', title: 'ArchImperator of the Republic, the Reaper', house: 'sov', rank: 3, talents: ['rain', 'breacher', 'inspiring', 'peerless'], fleet: 'White Fleet', age: 33, colour: 'Red-born Gold' },
    { name: 'Sevro au Barca', title: 'Imperator, leader of the Howlers', house: 'sov', rank: 2, talents: ['breacher', 'hunter'], fleet: 'Home Fleet', colour: 'Gold' },
    { name: 'Kavax au Telemanus', title: 'Defender of Mars', house: 'sov', rank: 1, talents: ['shield', 'discipline'], fleet: 'Fourth Fleet', colour: 'Gold' },
    { name: 'Orion xe Aquarii', title: 'Navarch of the Republic', house: 'mod', rank: 2, talents: ['helm', 'gunnery'], colour: 'Blue' },
    { name: 'Victra au Barca', title: 'Of House Julii', house: 'mod', rank: 1, talents: ['tactician', 'gunnery'], colour: 'Gold' },
    { name: 'Thraxa au Telemanus', title: 'Howler', house: 'sov', rank: 0, talents: ['breacher', 'rain'], colour: 'Gold' },
  ],
  soc: [
    { name: 'Atalantia au Grimmus', title: 'Daughter of the Ash Lord, heir of the Remnant', house: 'grimmus', rank: 3, talents: ['tactician', 'marshal', 'peerless'], fleet: 'Ash Armada', colour: 'Gold' },
    { name: 'Valeria au Carthii', title: 'Of the Carthii yards of Venus', house: 'carthii', rank: 1, talents: ['quarter', 'gunnery'], fleet: 'First Fleet', colour: 'Gold' },
    { name: 'Kalindora au San', title: 'The Love Knight, of the Society’s Olympic Knights', house: 'grimmus', rank: 1, talents: ['discipline', 'peerless'], fleet: 'Heliopolis Garrison', colour: 'Gold' },
    { name: 'Ajax au Grimmus', title: 'The Storm Knight of the Society', house: 'grimmus', rank: 1, talents: ['peerless', 'butcher'], colour: 'Gold' },
    { name: 'Atlas au Raa', title: 'The Fear Knight of the Society', house: 'grimmus', rank: 1, talents: ['hunter', 'breacher'], colour: 'Gold' },
    { name: 'Rhone ti Flavinius', title: 'Praetorian of the Ash Legions', house: 'grimmus', rank: 0, talents: ['discipline', 'rain'], colour: 'Gray' },
  ],
  rim: [
    { name: 'Diomedes au Raa', title: 'The Storm Knight of the Rim, heir of Io', house: 'raa', rank: 2, talents: ['peerless', 'hunter', 'helm'], fleet: 'Dust Armada', colour: 'Gold' },
    { name: 'Seraphina au Raa', title: 'Of the Dustwalkers', house: 'raa', rank: 0, talents: ['breacher', 'torch'], fleet: 'Saturn Watch', colour: 'Gold' },
    { name: 'Dido au Raa', title: 'Wife of the Sovereign, born of House Saud', house: 'raa', rank: 1, talents: ['tactician', 'beloved'], colour: 'Gold' },
  ],
};
const HOUSES = { rep: ['Telemanus', 'Barca', 'Julii', 'Arcos'], soc: ['Grimmus', 'Carthii', 'Votum', 'Saud', 'Bellona', 'Falthe', 'Valii-Rath', 'Cerana'], rim: ['Raa', 'Lux', 'Codovan', 'Norvo'] };
// the politics group an officer's family answers to: a House of the Remnant or the Rim, a bloc of the Senate.
// Lesser Houses are clients of a greater one
const HOUSE_GROUP = { Telemanus: 'sov', Barca: 'sov', Arcos: 'sov', Julii: 'mod', Grimmus: 'grimmus', Carthii: 'carthii', Votum: 'votum', Saud: 'saud', Bellona: 'grimmus', 'Valii-Rath': 'grimmus', Falthe: 'carthii', Cerana: 'saud', Raa: 'raa', Lux: 'lux', Codovan: 'codovan', Norvo: 'norvo' };
const COLOUR_GROUP = { Red: 'vox', Gray: 'mod', Blue: 'mod', Copper: 'mod', Silver: 'mod' };
const FIRST = ['Lucan', 'Tactus', 'Livia', 'Drusilla', 'Marius', 'Octavia', 'Severus', 'Quintus', 'Aurelia', 'Felix', 'Junia', 'Cato', 'Galen', 'Thalia', 'Nero', 'Vela', 'Corvus', 'Pallas', 'Lyra', 'Silenus', 'Mira', 'Titus'];
const REPCOL = [['ti', 'Gray', ['Trigg', 'Holtz', 'Mara', 'Kell', 'Brin']], ['xe', 'Blue', ['Cyra', 'Ion', 'Pell', 'Syl', 'Quill']], ['of', 'Red', ['Kieran', 'Deanna', 'Loran', 'Ria', 'Narol']]];
const MINES = ['Lykos', 'Thessaly', 'Gamma', 'Camp 121', 'Lagalos', 'Cimmeria'];
function genName(f) {
  if (f === 'rep' && rnd() < .5) { const [suf, col, names] = pickOne(REPCOL); const nm = pickOne(names); return { name: suf === 'of' ? `${nm} of ${pickOne(MINES)}` : `${nm} ${suf} ${pickOne(['Haas', 'Merren', 'Vash', 'Doro', 'Aquila', 'Pyrr'])}`, colour: col, house: COLOUR_GROUP[col] || 'vox' }; }
  const h = pickOne(HOUSES[f] || HOUSES.soc); return { name: `${pickOne(FIRST)} au ${h}`, colour: 'Gold', house: HOUSE_GROUP[h] || null };
}
export function makeCmdr(f, spec = {}) {
  const g = spec.name ? spec : genName(f), ts = spec.talents ? spec.talents.slice() : [];
  while (ts.length < 2) { const t = pickOne(Object.keys(TALENT)); if (!ts.includes(t)) ts.push(t); }
  const c = { id: C.nid++, owner: f, name: g.name, title: spec.title || (f === 'rep' ? 'Officer of the Republic' : f === 'rim' ? 'Moon Lord officer' : 'Officer of the Society'), colour: g.colour || 'Gold',
    rank: spec.rank != null ? spec.rank : Math.min(3, TE.mod(f, 'officerRank')), xp: 0, talents: ts, age: spec.age || (28 + Math.floor(rnd() * 22)), ageKnown: !!spec.age, loyalty: 70 + Math.floor(rnd() * 25), house: spec.house !== undefined ? spec.house : g.house !== undefined ? g.house : null, griev: [], wounded: 0, state: 'pool', fleet: null, lore: !!spec.name, battles: 0, wins: 0 };
  C.cmdrs.push(c); return c;
}
export function setupCommanders() {
  C.cmdrs = []; C.weary = { rep: 0, soc: 0, rim: 0 };
  for (const f of ['rep', 'soc', 'rim']) for (const L of LORE[f]) { const c = makeCmdr(f, L); c.lore = true; if (L.fleet) { const fl = C.fleets.find(x => x.owner === f && x.name === L.fleet); if (fl) assign(c, fl); } }
  for (const fl of C.fleets) if (!fl.cmdr && fl.ships.length > PATROL) { const c = makeCmdr(fl.owner, { rank: 0 }); assign(c, fl); }
}
export const cmdrOf = fl => fl && fl.cmdr ? C.cmdrs.find(c => c.id === fl.cmdr) : null;
export const has = (fl, t) => { const c = cmdrOf(fl); return !!(c && hasT(c, t)); };
export const capOf = fl => { const c = cmdrOf(fl); return c ? Math.round(CAP[c.rank] * (hasT(c, 'marshal') ? 1.5 : 1) * TE.mod(fl.owner, 'cap')) : PATROL; };
// beyond its commander's reach, a fleet's extra hulls fight at half strength
export const capFactor = fl => { const n = fl.ships.length, cap = capOf(fl); return n <= cap ? 1 : (cap + (n - cap) * .5) / n; };
export const arMul = fl => { const c = cmdrOf(fl); let m = capFactor(fl) * AG.fleetMul(fl) * heirMul(fl); if (c) for (const t of effTalents(c)) if (TALENT[t] && TALENT[t].ar) m *= TALENT[t].ar; return m * (1 + .03 * (c ? c.rank : 0)); };
export function assign(c, fl) {
  if (!c || !fl || c.owner !== fl.owner || c.wounded > 0 || c.state === 'captured' || c.state === 'dead') return 'cannot';
  const old = cmdrOf(fl); if (old) { old.fleet = null; old.state = 'pool'; if (C.turn > 1 && old !== c) grieve(old, 'Replaced in command', -8); }
  if (c.fleet) { const of = C.fleets.find(x => x.id === c.fleet); if (of) of.cmdr = null; }
  const fresh = c.state !== 'fleet';
  c.fleet = fl.id; c.state = 'fleet'; fl.cmdr = c.id;
  // a posting pleases the officer and their House; a senior officer left ashore while a junior gets the fleet does not forget
  if (C.turn > 1 && fresh) { grieve(c, 'Given a command', 6); houseNudge(c, 1); for (const o of C.cmdrs) if (o.owner === c.owner && o !== c && o.state === 'pool' && !o.wounded && o.rank > c.rank && !RU.isRoyal(o)) grieve(o, 'Passed over for command', -6); }
  return null;
}
export function relieve(fl, quiet) { const c = cmdrOf(fl); if (!c) return; c.fleet = null; c.state = 'pool'; fl.cmdr = null; if (!quiet && C.turn > 1) { grieve(c, 'Relieved of command', -12); houseNudge(c, -2); } }
// ---------------------------------------------------------------- loyalty: the officer, their House, and the throne
// a grievance or a favour: it fades by a twentieth a week. Like ones stack, to a limit
export function grieve(c, label, v) { if (!c) return; c.griev = c.griev || []; const g = c.griev.find(x => x[0] === label); if (g) g[1] = clamp(g[1] + v, -30, 30); else c.griev.push([label, v]); }
const houseNudge = (c, v) => { if (!c.house || !C.pol || !C.pol[c.owner]) return; const g = C.pol[c.owner].groups.find(x => x.id === c.house); if (g) g.sat = clamp(g.sat + v, 0, 100); };
export const houseName = c => { if (!c || !c.house || !C.pol || !C.pol[c.owner]) return null; const D = P.defOf(c.owner, c.house); return D ? D.name : null; };
export function loyParts(c) {
  const f = c.owner, out = [['Base', 56]]; if (f === 'neu' || !C.pol || !C.pol[f]) return out;
  const g = c.house && C.pol[f].groups.find(x => x.id === c.house);
  if (g) out.push([`${P.defOf(f, g.id).name} ${g.sat >= 50 ? 'content' : 'aggrieved'} (${Math.round(g.sat)}%)`, (g.sat - 50) * .5]);
  const rl = RU.actingOf(f); if (rl && !rl.council && rl !== c && rl.house && rl.house === c.house) out.push(['Their own House on the throne', 8]);
  if (rl && rl.council) out.push(['No crown to swear to', -5]);
  const L = RU.legitOf(f); if (L < 60) out.push(['A contested throne', -(60 - L) / 3]);
  if (RU.hasTrait(f, 'valiant')) out.push(['A knight on the throne', 5]);
  if (c.wins) out.push(['Victories won', Math.min(8, c.wins)]); if (c.battles - c.wins > 0) out.push(['Battles lost', -Math.min(12, 1.5 * (c.battles - c.wins))]);
  if ((C.weary[f] || 0) > 40) out.push(['A war-weary realm', -((C.weary[f] || 0) - 40) / 3]);
  for (const x of c.griev || []) out.push([x[0], x[1]]);
  if (c.state === 'captured') out.push(['Left in chains', -Math.min(20, (c.chainW || 0) * .8)]);
  if (c.turnTo) out.push([`Blackmailed by ${BLOC_NAME[c.turnTo]}`, -25]);
  return out.map(([a, b]) => [a, Math.round(b)]);
}
export const loyTarget = c => clamp(loyParts(c).reduce((a, p) => a + p[1], 0), 0, 100);
// a disloyal senior officer will not burn his crews for you
export const refusesBurn = fl => { const c = cmdrOf(fl); const no = c && !RU.isRoyal(c) && c.rank >= 2 && c.loyalty < 30 && rnd() < .6 ? c : null; if (no) { C.stats = C.stats || {}; C.stats.refuse = (C.stats.refuse || 0) + 1; } return no; };
// an officer goes over: to whoever turned them, else the strongest enemy of their power, else alone
export function defect(c, fl) {
  const f = c.owner, foes = ['rep', 'soc', 'rim'].filter(o => o !== f && C.fac[o].alive && hostile(f, o)).sort((a, b) => C.fleets.filter(x => x.owner === b).reduce((s, x) => s + x.ships.length, 0) - C.fleets.filter(x => x.owner === a).reduce((s, x) => s + x.ships.length, 0));
  const to = c.turnTo && C.fac[c.turnTo] && C.fac[c.turnTo].alive && c.turnTo !== f ? c.turnTo : foes[0] || 'neu';
  houseNudge(c, -6);
  if (fl) { for (const a of C.agents || []) if (a.fleet === fl.id) { a.state = 'idle'; a.fleet = null; } fl.owner = to; fl.garrison = false; fl.stance = null; fl.orders = null; fl.name = to === 'neu' ? `Renegades of ${c.name.split(' ')[0]}` : `${c.name.split(' ')[0]}’s Fleet`; }
  const was = BLOC_NAME[f]; c.owner = to; c.griev = []; c.loyalty = 70; c.turnTo = null; c.house = to === 'neu' ? null : c.house && P.defOf(to, c.house) ? c.house : null;
  if (!fl) { c.state = to === 'neu' ? 'dead' : 'pool'; c.fleet = null; }
  note(`${c.name} betrays ${was}${fl ? ` and takes ${fl.name.replace(/^Renegades of .*/, 'the fleet')} over to ${to === 'neu' ? 'no master but themself' : BLOC_NAME[to]}` : ` and goes over to ${BLOC_NAME[to]}`}.`, f === C.player ? 'bad' : to === C.player ? 'good' : 'gold', fl && fl.at, f === C.player || to === C.player ? { title: `${c.name} defects`, kind: 'revolt' } : null);
  chron('defect', `${c.name} defects from ${was}${fl ? ' with ' + fl.ships.length + ' ships' : ''}.`, fl && fl.at, f);
}
export const pool = f => C.cmdrs.filter(c => c.owner === f && c.state === 'pool' && !c.wounded);
// when fleets merge or split the commander goes with the larger part; a fleet that vanishes frees its commander
export function tidy() {
  for (const c of C.cmdrs) if (c.state === 'fleet' && !C.fleets.some(f => f.id === c.fleet && f.cmdr === c.id)) { c.state = 'pool'; c.fleet = null; }
  for (const f of C.fleets) if (f.cmdr && !C.cmdrs.some(c => c.id === f.cmdr && c.state === 'fleet')) f.cmdr = null;
  for (const a of C.agents || []) if (a.state === 'riding' && !C.fleets.some(x => x.id === a.fleet && x.owner === a.owner)) { a.state = 'idle'; a.fleet = null; }
}
export function onMerge(a, b) { const ca = cmdrOf(a), cb = cmdrOf(b); if (cb && (!ca || cb.rank > ca.rank)) { if (ca) { ca.state = 'pool'; ca.fleet = null; } a.cmdr = cb.id; cb.fleet = a.id; } else if (cb) { cb.state = 'pool'; cb.fleet = null; } }

// ---------------------------------------------------------------- experience, promotion, wounds
export function gainXp(c, n) {
  if (!c) return; c.xp += Math.round(n * TE.mod(c.owner, 'xp'));
  while (c.rank < 3 && c.xp >= XP_NEXT[c.rank]) {
    c.rank++; grieve(c, 'Promoted', 8); houseNudge(c, 2);
    /* a hero of the books is offered the next talent of their own line first */
    const hk = heroOf(c), mineL = hk ? HERO_LINE[hk].map(x => x[0]).filter(t => !c.talents.includes(t)) : [];
    const offer = mineL.slice(0, 1).concat(Object.keys(TALENT).filter(t => !TALENT[t].hero && !effTalents(c).includes(t)).sort(() => rnd() - .5)).slice(0, 3);
    if (human(c.owner)) { C.promos = C.promos || []; C.promos.push({ id: c.id, offer }); note(`${c.name} is raised to ${RANK[c.rank]}.`, 'good'); }
    else c.talents.push(offer[0]);
  }
}
// what a battle does to the commanders on each side
export function battleFate(res) {
  const win = res.attWin ? res.att : res.def, lose = res.attWin ? res.def : res.att, nm = bodyOf(res.world).name, W = res.wins || [win], L = res.loses || [lose];
  for (const f of C.fleets) {
    const c = cmdrOf(f); if (!c) continue;
    if (W.includes(f.owner) && ((f.at === res.world && !f.transit) || (res.space && f.batE === res.space.id))) { c.battles++; c.wins++; gainXp(c, 30 + Math.round(10 * Math.min(4, res.margin || 1.5))); if (rnd() < .04) wound(c, f, nm); }
  }
  for (const f of C.fleets.slice()) {
    const key = res.world + '|' + C.turn, c = cmdrOf(f); if (!c || !L.includes(f.owner) || !((f.transit && f.transit.bat === key) || f.bat === key || (res.space && f.batE === res.space.id))) continue;
    c.battles++; gainXp(c, 12);
    if (res.withdrew || res.tactical) continue; // fought on the map: what happened to the commander there is what happened
    const r = rnd(), pd = hasT(c, 'peerless') ? .5 : 1;
    if (r < .04 * pd) { kill(c, f, `${c.name} fell at ${nm}.`, null, win); }
    else if (r < .12 * pd && win !== 'neu') { capture(c, f, win, nm); }
    else if (r < .32) wound(c, f, nm);
  }
  // a fleet destroyed outright loses its commander to the void or to the enemy
  tidy();
}
export function wound(c, f, nm) { if (c.state === 'dead') return; c.wounded = 3 + Math.floor(rnd() * 4); c.woundT = C.turn; c.state = 'pool'; c.fleet = null; if (f) f.cmdr = null; if (c.owner === C.player) note(`${c.name} was wounded at ${nm} and is out of the war for ${c.wounded} weeks.`, 'bad'); }
export const FATE = []; // story listens here: fn(kind, commander, by)
const fate = (k, c, by) => { try { heirFate(k, c, by); } catch (e) { console.error(e); } for (const h of FATE) try { h(k, c, by); } catch (e) { console.error(e); } };
export function capture(c, f, by, nm) { if (c.state === 'dead' || c.state === 'captured') return; houseNudge(c, -3); c.chainW = 0; const fl0 = f || (c.fleet && C.fleets.find(x => x.id === c.fleet)); c.state = 'captured'; c.captor = by; c.fleet = null; if (fl0) fl0.cmdr = null; fate('capture', c, by); if (c.lore || c.rank >= 2) chron('capture', `${c.name} is taken prisoner by ${BLOC_NAME[by] || 'raiders'}.`, null, c.owner); note(`${c.name} was taken prisoner by ${BLOC_NAME[by]} at ${nm}.`, c.owner === C.player ? 'bad' : by === C.player ? 'good' : '', res0(nm), c.owner === C.player || by === C.player ? { title: c.name + ' captured', kind: 'fall' } : null); }
export function kill(c, f, msg, ev, by) { if (c.state === 'dead') return; if (c.owner !== 'neu') houseNudge(c, -4); const fl0 = f || (c.fleet && C.fleets.find(x => x.id === c.fleet)); c.state = 'dead'; c.fleet = null; if (fl0) fl0.cmdr = null; note(msg, c.owner === C.player ? 'bad' : 'gold', null, ev || (c.lore && (c.owner === C.player || c.rank >= 2) ? { title: c.name + ' is dead', kind: 'death' } : null)); fate('kill', c, by); if (c.lore || c.rank >= 2 || RU.isRoyal(c)) chron('death', msg, null, c.owner); }
const res0 = () => null;
// a whole fleet lost in battle: the commander may get away in a pod
export function fleetLost(f, by) { const c = cmdrOf(f); if (!c) return; const r = rnd(); if (r < .45) wound(c, null, 'the battle'); else if (r < .75 && by !== 'neu') capture(c, null, by, 'the battle'); else kill(c, null, `${c.name} went down with the ${f.name}.`, null, by); }

// ---------------------------------------------------------------- supply and attrition
const sys = id => { const b = bodyOf(id); return b.parent != null ? BODIES[b.parent].id : b.id; };
export function inSupply(fl) {
  if (fl.transit) return fl.transit.mode !== 'dark'; // a fleet running dark gets no supply runs
  const w = C.worlds[fl.at]; if (!w) return false;
  if (w.owner === fl.owner || relOf(w.owner, fl.owner) === 'ally') return true;
  return Object.values(C.worlds).some(o => o.owner === fl.owner && !o.siege && sys(o.id) === sys(fl.at));
}
export function attrition() {
  for (const fl of C.fleets) {
    if (fl.engage || (fl.transit && fl.transit.mode !== 'dark') || inSupply(fl) || has(fl, 'quarter')) continue;
    const k = (fl.ships.some(s => s.t === 'tender') ? .5 : 1) * TE.mod(fl.owner, 'attrition');
    for (const s of fl.ships) { s.hp = Math.max(.1, s.hp - .015 * k); s.crew = Math.max(.25, s.crew - .02 * k); s.ammo = Math.max(0, s.ammo - .04 * k); }
  }
}
// ---------------------------------------------------------------- war weariness
export function weary(f, amt) { if (!C.weary || f === 'neu' || !(f in C.weary)) return; if (amt > 0) amt *= TE.mod(f, 'weary'); C.weary[f] = clamp(C.weary[f] + amt, 0, 100); }
export function wearyTick() {
  for (const f of ['rep', 'soc', 'rim']) {
    const wars = ['rep', 'soc', 'rim'].filter(o => o !== f && C.fac[o].alive && hostile(f, o)).length;
    const sieged = Object.values(C.worlds).filter(w => w.owner === f && w.siege).length;
    weary(f, wars ? .2 * wars + sieged * .6 - .5 : -2.5);
  }
}
export const wearyLoyalty = f => C.weary && C.weary[f] > 40 ? -(C.weary[f] - 40) / 20 : 0;      // loyalty a week, every world
export const wearyMan = f => C.weary ? 1 - (C.weary[f] || 0) / 200 : 1;                        // manpower income

// ---------------------------------------------------------------- pickets and the Belt
const posOf = id => { const b = bodyOf(id), p = b.parent != null ? BODIES[b.parent] : b; return { x: p.x, y: p.y }; };
function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1, t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1); return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y); }
// a fleet set to picket stops hostile fleets whose course passes close by its world
export function intercepts() {
  const out = [];
  for (const fl of C.fleets) {
    if (!fl.transit || fl.transit.retreat || fl.engage || fl.transit.sortie || fl.transit.p0 || fl.transit.p1) continue;
    const a = posOf(fl.transit.from), b = posOf(fl.transit.to), k0 = (fl.transit.total - fl.transit.left - 1) / fl.transit.total, k1 = (fl.transit.total - fl.transit.left) / fl.transit.total;
    const p0 = { x: a.x + (b.x - a.x) * Math.max(0, k0), y: a.y + (b.y - a.y) * Math.max(0, k0) }, p1 = { x: a.x + (b.x - a.x) * k1, y: a.y + (b.y - a.y) * k1 };
    for (const pk of C.fleets) {
      if (pk.stance !== 'picket' || pk.transit || !hostile(pk.owner, fl.owner) || pk.at === fl.transit.to || sys(pk.at) === sys(fl.transit.from)) continue;
      const R = AU * .35 * (has(pk, 'hunter') ? 2 : 1) * TE.mod(pk.owner, 'pickR');
      // a picket stops what it sees: tracked fleets most of the time, contacts less often, and dark ones slip by unseen
      if (segDist(posOf(pk.at), p0, p1) < R) { const l = IN.level(pk.owner, fl); if (l && rnd() < (l === 2 ? .85 : .5) + (has(pk, 'hunter') ? .1 : 0)) { out.push({ fl, pk }); break; } }
    }
  }
  for (const { fl, pk } of out) {
    if (!fl.transit) continue; const nm = bodyOf(pk.at).name;
    fl.at = pk.at; fl.transit = null;
    note(`${fl.name} (${BLOC_NAME[fl.owner]}) is intercepted off ${nm} by ${pk.name}.`, fl.owner === C.player ? 'bad' : pk.owner === C.player ? 'good' : '', pk.at);
  }
}
// small fleets crossing the Belt risk the Ascomanni, the Obsidian raiders of the asteroid fields
export function beltRaids(fl) {
  const A = Math.hypot(posOf(fl.transit.from).x, posOf(fl.transit.from).y) / AU, B = Math.hypot(posOf(fl.transit.to).x, posOf(fl.transit.to).y) / AU;
  if ((A < 2.1) === (B < 2.1) && (A > 3.4) === (B > 3.4)) return;
  const str = fl.ships.reduce((a, s) => a + (defsOf(fl.owner)[s.t]?.value || 50) * s.hp, 0); if (str > 1500 || rnd() > .2) return;
  const s = pickOne(fl.ships); s.hp -= .45; if (s.hp <= 0) fl.ships = fl.ships.filter(x => x !== s);
  if (fl.owner === C.player) note(`Ascomanni raiders strike ${fl.name} in the Belt: ${s.hp <= 0 ? 'a ' + (defsOf(fl.owner)[s.t]?.name || s.t) + ' is lost' : 'a ship is badly damaged'}.`, 'bad');
}
// ---------------------------------------------------------------- the commanders' week
export function cmdrTick() {
  for (const c of C.cmdrs) {
    if (c.wounded > 0 && c.woundT !== C.turn && --c.wounded === 0 && c.owner === C.player) note(`${c.name} has recovered and is fit for command.`, 'good');
    if (C.turn % 52 === 0 && c.state !== 'dead') { c.age++; if (c.age > 62 && rnd() < (c.age - 60) * .04) { kill(c, null, `${c.name} has died, aged ${c.age}.`); } }
    if (c.state === 'dead' || c.owner === 'neu') continue;
    // loyalty settles toward what their House, the throne and their own record say; grievances fade
    if (c.state === 'captured') c.chainW = (c.chainW || 0) + 1;
    for (const g of c.griev || []) g[1] *= .95; c.griev = (c.griev || []).filter(g => Math.abs(g[1]) >= 1);
    c.loyalty = clamp(c.loyalty + (loyTarget(c) - c.loyalty) * .12, 0, 100);
    if (RU.isRoyal(c) || c.wounded) continue;
    // a disloyal commander may go over with the fleet; a senior one left ashore demands a fleet
    if (c.state === 'fleet' && c.rank >= 1 && c.loyalty < 25 && rnd() < .05) { const fl = C.fleets.find(x => x.id === c.fleet); if (fl && !fl.engage && fl.ships.length) { C.stats = C.stats || {}; C.stats.defect = (C.stats.defect || 0) + 1; defect(c, fl); continue; } }
    if (c.state === 'pool' && c.rank >= 2 && c.loyalty < 40 && rnd() < .08 && !(c.demandT > C.turn - 12)) { c.demandT = C.turn; C.stats = C.stats || {}; C.stats.demand = (C.stats.demand || 0) + 1; demand(c); }
  }
  // the officer corps refills slowly
  for (const f of ['rep', 'soc', 'rim']) if (C.fac[f].alive && C.turn % 8 === 0 && pool(f).length < 3) { const c = makeCmdr(f); if (f === C.player) note(`${c.name} joins the officer corps as a ${RANK[c.rank]}.`, ''); }
  // the AI gives its commanders to its largest fleets
  for (const f of ['rep', 'soc', 'rim']) if (C.fac[f].ai) {
    const fl = C.fleets.filter(x => x.owner === f && !x.cmdr && !x.transit && x.ships.length > 3).sort((a, b) => b.ships.length - a.ships.length);
    for (const x of fl) { const c = pool(f).sort((a, b) => b.rank - a.rank)[0]; if (!c) break; assign(c, x); }
  }
  tidy();
}
// a senior officer demands a fleet: the AI gives it, the player decides (story.js)
function demand(c) {
  const f = c.owner;
  if (human(f)) { ST.queueEvent('demand', f, c); return; }
  const fl = C.fleets.filter(x => x.owner === f && !x.transit && !x.engage && x.ships.length > 3 && (!cmdrOf(x) || cmdrOf(x).rank < c.rank)).sort((a, b) => b.ships.length - a.ships.length)[0];
  if (fl) { assign(c, fl); grieve(c, 'Given the command demanded', 8); } else grieve(c, 'Refused a command', -10);
}
export function raiseOfficer(f) {
  const r = C.fac[f].res; if (r.he < 600 || r.man < 3000 || (r.inf || 0) < 25) return 'Raising an officer costs 600 He-3, 3,000 manpower and 25 influence';
  r.he -= 600; r.man -= 3000; r.inf -= 25; const c = makeCmdr(f); note(`${c.name} is raised to command as a ${RANK[c.rank]}.`, 'good'); return c;
}
