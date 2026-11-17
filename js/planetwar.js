// Iron Rain: the war for a planet (ground battles chat). See claude/planet-maps.md.
// A world under invasion gets a map of provinces, like a small Total War campaign: the Rain lands armies in chosen
// provinces, and then one planet turn runs with each campaign week (armies march, besiege, fight, run short of
// supply, recruit) until the attacker holds the capital and most of the people, or has no army left.
// Pure: no DOM and no campaign imports, so it runs headless (tests/planet_war.mjs). The campaign hands it plain
// numbers (troops, garrison, fort, guns, shields, barracks, loyalty) and reads the result back.

const D = Math.PI / 180;
const vec = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------------------------------------------------------------- the maps
// Seats are where each province's settlement stands, on the globe as planetgen paints it (lat, lon in degrees).
// kind: capital | city | port | towns | forts. terrain sets the field and how hard the ground is to take.
// pop: the share of the world's people (the prize); gar: the share of the garrison posted there at the start.
// Names: Tyche, Heliopolis and the Waste of Ladon are the books'; Keryx, Helios, Borealis are planetgen's; the rest
// are descriptive placeholders until named (claude/planet-maps.md).
export const MAPS = {
  mercury: {
    name: 'Mercury', capital: 'tyche',
    provs: [
      { id: 'tyche', name: 'Tyche', lat: 46, lon: -26, kind: 'capital', terrain: 'alpine', pop: .26, gar: .34, walls: 1, guns: .3, shield: 1, note: 'the capital' },
      { id: 'heliopolis', name: 'Heliopolis', lat: -4, lon: -24, kind: 'city', terrain: 'temperate', pop: .26, gar: .25, walls: 2, guns: .4, port: 1, field: 'mercury', note: 'the centre of commerce; spaceport' },
      { id: 'keryx', name: 'Keryx', lat: 8, lon: 40, kind: 'port', terrain: 'temperate', pop: .14, gar: .11, port: 1, note: 'port city' },
      { id: 'ladon', name: 'Waste of Ladon', lat: 6, lon: 2, kind: 'towns', terrain: 'desert', pop: .08, gar: .06, note: 'mining towns' },
      { id: 'highlands', name: 'Northern highlands', lat: 38, lon: 8, kind: 'forts', terrain: 'highland', pop: .06, gar: .16, guns: .3, note: 'hill forts guarding the road to Tyche, with half the capital\'s batteries' }, // decision 10
      { id: 'jungles', name: 'Southern jungles', lat: -30, lon: 5, kind: 'towns', terrain: 'jungle', pop: .08, gar: .04, note: 'scattered towns' },
      { id: 'borw', name: 'Borealis West', lat: 22, lon: 162, kind: 'port', terrain: 'temperate', pop: .07, gar: .03, port: 1, note: 'far side' },
      { id: 'bore', name: 'Borealis East', lat: -4, lon: 204, kind: 'towns', terrain: 'jungle', pop: .05, gar: .01, note: 'far side' },
    ],
    // neighbours by road; the gravLoop carries an army two provinces a week; the sea lanes take a week from port to port
    roads: [['tyche', 'heliopolis'], ['tyche', 'highlands'], ['highlands', 'keryx'], ['highlands', 'ladon'], ['heliopolis', 'ladon'], ['heliopolis', 'jungles'],
      ['ladon', 'keryx'], ['ladon', 'jungles'], ['keryx', 'jungles'], ['borw', 'bore']],
    loop: [['tyche', 'heliopolis'], ['heliopolis', 'keryx']],
    sea: [['keryx', 'borw'], ['heliopolis', 'borw'], ['keryx', 'bore']],
  },
};
export const hasMap = world => !!MAPS[world];
const M = war => MAPS[war.world];
const P = (war, id) => M(war).provs.find(p => p.id === id);
export function neighbours(world, id) { const m = MAPS[world], out = new Set();
  for (const [a, b] of [...m.roads, ...m.sea]) { if (a === id) out.add(b); if (b === id) out.add(a); } return [...out]; }
const byLoop = (world, a, b) => MAPS[world].loop.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const bySea = (world, a, b) => MAPS[world].sea.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
// where an army can get to in one week: a road neighbour, or two steps along the gravLoop while both ends are ours
export function reach(war, army) {
  const w = war.world, own = id => war.provs[id].own === army.side, out = new Set(neighbours(w, army.prov));
  for (const n of neighbours(w, army.prov)) if (byLoop(w, army.prov, n) && own(n)) for (const n2 of neighbours(w, n)) if (byLoop(w, n, n2) && n2 !== army.prov) out.add(n2);
  return [...out];
}

// ---------------------------------------------------------------- strength and battles
// Troops are campaign troops (the field shows ten men for each). Both sides' troops count alike: the old Rain's
// "an attacker's troop is worth five of the garrison" was the share of the garrison that met the drop on one field;
// here the whole garrison is on the map, spread over the provinces.
// the garrison's edge on its own world (it knows the ground, holds the strongpoints and is fed): tuned with tests/planet_war.mjs
// so the stand-in attacker's plan takes Mercury in week 1 about two times in three; a test may change it
export const TUNE = { def: 2.3 }; // 16 Nov (M2b) 2, 17 Nov (decision 10, with the highlands garrisoned) 2.3: with the fitted field, a garrison troop puts about twice the men of a Rain troop in the line (the city's militia, police and levies under arms)
// What the field shows, fitted from ground.js province battles (tests/planet_fit.mjs, 2026-11-16: 234 battles on
// Mercury's provinces at 15,000 holders, both ways round; claude/planet-maps.md):
//   HOLD: the holder's edge on its own ground with no walls, by settlement and terrain. Small towns and hill forts are
//     hard to take; the great cities, spread over many streets, are easier than their size suggests.
//   WALL: each level of walls multiplies it, less as a siege opens them.
//   LEGION: the Rain's legions with their starShells against the same number of the garrison's men.
export const HOLD = { 'city:temperate': .92, 'port:temperate': .92, 'towns:desert': 1.4, 'towns:jungle': 1.62, 'forts:highland': 1.62, 'capital:alpine': .87 };
const HOLD_KIND = { capital: .9, city: .92, port: .92, towns: 1.5, forts: 1.62 }; // for ground not yet fitted (other worlds)
//   LANDING: a landing battle (the drop scattered over the province, coming down under fire) counts the legions' power
//     at 1 / LANDING of a formed army's: fitted from 48 landings fought in ground.js's drop mode.
export const WALL = 1.52, LEGION = 1.54, LANDING = 1.34;
const holdOf = p => HOLD[p.kind + ':' + p.terrain] ?? HOLD_KIND[p.kind] ?? 1.2;
const wallsK = (war, p) => { const pr = war.provs[p.id]; return pr.walls ? WALL ** (pr.walls * (1 - (pr.breach || 0))) : 1; };
// power = men × what the field shows (the holder's ground and walls: native) × what it doesn't (the side's quality and
// its commander: qual). A fought battle puts men × qual on the field and lets the field supply the rest.
export const native = (war, prov, side) => { const p = P(war, prov); return (war.provs[prov].own === side ? holdOf(p) * wallsK(war, p) : 1) * (side === 'att' ? LEGION : 1); };
export const qual = (war, side, prov, ck) => (side === 'att' ? war.attQ : war.defQ) * Math.max(ck || 1, stackK(war, side, prov));
export function power(war, side, prov, men, ck) { return men * native(war, prov, side) * qual(war, side, prov, ck); }
// ---------------------------------------------------------------- commanders (Harrison's decision 6)
// An army can carry campaign commanders: { id, name, ar, t }. ar is the auto-resolve strength factor of their talents
// (camp.js knows it); t lists the talents in effect (CM.effTalents). The one with the highest ar leads the army. Their
// strength counts on both paths (as men on the field), and these talents mean something on the planet map:
export const CMDR_T = {
  inspiring: '+4% strength',
  quarter: 'no losses out of supply',
  shield: 'holding its province, the army loses a quarter less',
  hunter: 'an enemy it beats loses a tenth more',
  discipline: 'beaten, the army loses a fifth less',
  rain: 'its landing loses 30% less in the sky',
  butcher: 'a siege it leads opens the walls faster',
  breacher: 'a siege it leads opens the walls faster',
  beloved: 'a captured city where it stands raises twice the levy',
};
export const leadOf = a => a && a.cmdrs && a.cmdrs.length ? a.cmdrs.reduce((b, c) => (c.ar || 1) > (b.ar || 1) ? c : b) : null;
const hasT = (a, t) => { const c = leadOf(a); return !!(c && c.t && c.t.includes(t)); };
const stackHas = (war, side, prov, t) => war.armies.some(a => a.side === side && a.prov === prov && a.men > 0 && hasT(a, t));
export const cmdrK = c => c ? (c.ar || 1) * (c.t && c.t.includes('inspiring') ? 1.04 : 1) : 1;
const stackK = (war, side, prov) => war.armies.reduce((k, a) => a.side === side && a.prov === prov && a.men > 0 ? Math.max(k, cmdrK(leadOf(a))) : k, 1);
// a commander changes armies within a province (or is given to one that has none)
export function assign(war, cmdrId, armyId) {
  const to = war.armies.find(a => a.id === armyId); if (!to) return false;
  const from = war.armies.find(a => (a.cmdrs || []).some(c => c.id === cmdrId)); if (!from || from === to || from.prov !== to.prov || from.side !== to.side) return false;
  const c = from.cmdrs.find(x => x.id === cmdrId); from.cmdrs = from.cmdrs.filter(x => x !== c); (to.cmdrs = to.cmdrs || []).push(c); return true;
}
export const cmdrsOf = (war, side) => war.armies.flatMap(a => a.side === side ? (a.cmdrs || []).map(c => ({ ...c, army: a.id, prov: a.prov })) : []);

// Auto-resolve: the odds follow the ratio of power (a fitted logistic; tests/planet_war.mjs), losses follow the fight.
// Fought battles use ground.js; the auto-resolve is fitted to it so neither is the better choice.
export const FIT = { s: .24, lossW: .2, lossL: .46 }; // fitted with HOLD (tests/planet_fit.mjs)
export function oddsOf(pa, pd) { const r = Math.log(Math.max(1e-6, pa) / Math.max(1e-6, pd)); return 1 / (1 + Math.exp(-r / FIT.s)); }
const landingAt = (war, prov) => (war.pending || []).some(b => b.prov === prov && b.kind === 'landing');
export const oddsAt = (war, prov) => oddsOf(power(war, 'att', prov, sideMen(war, 'att', prov)) / (landingAt(war, prov) ? LANDING : 1), power(war, 'def', prov, sideMen(war, 'def', prov)));
function fight(war, prov, rnd) {
  const ma = sideMen(war, 'att', prov), md = sideMen(war, 'def', prov); if (!ma || !md) return null;
  const pa = power(war, 'att', prov, ma) / (landingAt(war, prov) ? LANDING : 1), pd = power(war, 'def', prov, md);
  const p = oddsOf(pa, pd), won = rnd() < p ? 'att' : 'def', pw = won === 'att' ? pa : pd, pl = won === 'att' ? pd : pa;
  const lw = clamp(FIT.lossW * pl / pw * (.8 + rnd() * .4), .03, .6), ll = clamp(FIT.lossL * (.8 + rnd() * .4) + .1 * pl / pw, .3, .95);
  return outcome(war, prov, won, won === 'att' ? lw : ll, won === 'def' ? lw : ll, p, 'auto');
}
// a battle's verdict on the map, auto-resolved or fought: losses (with the commanders' talents), the beaten fall back to
// a province of their own next door or are lost, the winner holds the province
function outcome(war, prov, won, lostA, lostD, p, how) {
  const ma = sideMen(war, 'att', prov), md = sideMen(war, 'def', prov), lose = won === 'att' ? 'def' : 'att', holder = war.provs[prov].own;
  const loss = side => { let f = side === 'att' ? lostA : lostD;
    if (side === holder && stackHas(war, side, prov, 'shield')) f *= .75;
    if (side === lose && stackHas(war, side, prov, 'discipline')) f *= .8;
    if (side === lose && stackHas(war, won, prov, 'hunter')) f += .1;
    return clamp(f, 0, .97); };
  const fa = loss('att'), fd = loss('def');
  for (const a of war.armies) if (a.prov === prov && a.men > 0) a.men = Math.round(a.men * (1 - (a.side === 'att' ? fa : fd)));
  const res = { prov, won, att0: ma, def0: md, odds: p, lostA: fa, lostD: fd, week: war.week, how };
  for (const a of war.armies.filter(x => x.prov === prov && x.side === lose && x.men > 0)) { const back = neighbours(war.world, prov).filter(n => war.provs[n].own === a.side && !bySea(war.world, prov, n));
    if (back.length) a.prov = back.sort((x, y) => sideMen(war, a.side, y) - sideMen(war, a.side, x))[0]; else a.men = 0; }
  for (const a of war.armies) if (a.men <= 0 && a.cmdrs && a.cmdrs.length) { for (const c of a.cmdrs) { war.cmdrLost.push({ ...c, side: a.side, prov, week: war.week }); war.log.push(`${c.name} is lost with the army at ${P(war, prov).name}.`); } a.cmdrs = []; }
  if (won === 'att') take(war, prov, 'att'); else if (holder === 'att') take(war, prov, 'def');
  war.log.push(`${P(war, prov).name}: ${won === 'att' ? 'the legions win' : 'the garrison wins'}${how === 'fought' ? ' on the field' : ''} (${Math.round(p * 100)}% for the attacker; ${ma.toLocaleString()} against ${md.toLocaleString()}).`);
  war.battles.push(res); war.pending = (war.pending || []).filter(b => b.prov !== prov); war.armies = war.armies.filter(a => a.men > 0);
  return res;
}
const sideMen = (war, side, prov) => war.armies.reduce((s, a) => s + (a.side === side && a.prov === prov ? a.men : 0), 0);
function take(war, prov, side) { const pr = war.provs[prov]; if (pr.own === side) return; pr.own = side; pr.siege = 0; if (side === 'att') { pr.gun = 0; pr.shield = 0; } }

// ---------------------------------------------------------------- fought battles (ground.js)
// A battle in war.pending can be fought on the province's own 8 km field. battleSpec builds the ground battle: the side
// that holds the province stands at its posts in the settlement, the other comes to take it (formed on the plain, or
// falling from the sky for a landing). Each side brings men × FIELD_SCALE × its quality and commander (qual), the things
// the field doesn't model; the field supplies the rest (the ground, the walls). settle writes the verdict back.
export const FIELD_SCALE = 10; // ten men on the field for each campaign troop (camp.js GROUND_SCALE)
const SHELLS = .055; // the share of the Rain's strength in starShells (a suit counts as six men), as in Mercury's opening Rain
const other = side => side === 'att' ? 'def' : 'att';
export function battleSpec(war, prov) {
  const p = P(war, prov), pr = war.provs[prov], holder = pr.own, foe = other(holder);
  const b = (war.pending || []).find(x => x.prov === prov), landing = !!(b && b.kind === 'landing');
  const men = side => Math.round(sideMen(war, side, prov) * FIELD_SCALE * qual(war, side, prov));
  const cm = side => { const c = war.armies.filter(a => a.side === side && a.prov === prov).map(leadOf).filter(Boolean).sort((x, y) => (y.ar || 1) - (x.ar || 1))[0]; return c ? c.name : null; };
  const f = side => side === 'att' ? war.by : war.def, am = men(foe), shells = foe === 'att' ? Math.round(am * SHELLS) : 0; // the Rain's legions bring their starShells, as in a Rain
  return { world: war.world, mode: landing ? 'drop' : 'field', noSky: true, maxT: 1800, fleet: null,
    site: { id: p.id, name: p.name, kind: p.kind, terrain: p.terrain, field: p.field === war.world },
    att: { f: f(foe), leech: am - shells, total: am, shells: Math.round(shells / 6), storks: 0, cmdr: cm(foe), air: null },
    def: { f: f(holder), men: men(holder), garrison: sideMen(war, holder, prov), fort: pr.walls || 0, breach: pr.breach || 0, gun: holder === 'def' ? pr.gun : 0, shield: holder === 'def' ? pr.shield : 0, barracks: 0, morale: 1, cmdr: cm(holder), air: null },
    planet: { prov, holder, foe, odds: oddsAt(war, prov) } };
}
// r: ground.js result() for that battle: won (the side that came to take the province won), att0 / attLeft and
// def0 / defLeft (strength at the start and at the end). The share each side lost comes off its armies on the map.
export function settle(war, prov, r) {
  if (!(war.pending || []).some(b => b.prov === prov)) return null;
  const holder = war.provs[prov].own, foe = other(holder), p = oddsAt(war, prov);
  const lf = clamp(1 - r.attLeft / Math.max(1, r.att0), 0, 1), lh = clamp(1 - r.defLeft / Math.max(1, r.def0), 0, 1);
  return outcome(war, prov, r.won ? foe : holder, foe === 'att' ? lf : lh, foe === 'att' ? lh : lf, p, 'fought');
}

// ---------------------------------------------------------------- a war
// spec: { world, by, def, troops (the drop, campaign troops), garrison, fort, gun, shield, barracks, loyalty (0..100) }
let nextId = 1;
export function newWar(spec) {
  const m = MAPS[spec.world]; if (!m) return null;
  const war = { world: spec.world, by: spec.by, def: spec.def, week: 0, provs: {}, armies: [], log: [], battles: [], over: null, orbit: true,
    attQ: 1, defQ: clamp((spec.loyalty ?? 50) + 30, 40, 130) / 80 * TUNE.def, // a loyal garrison fights harder, on its own ground
    barracks: spec.barracks || 0, recruit: spec.recruit ?? null, land0: 0, loyalty: spec.loyalty ?? 50, pending: [], cmdrLost: [], levied: 0 };
  const g = spec.garrison, guns = spec.gun || 0, fort = spec.fort || 0;
  for (const p of m.provs) war.provs[p.id] = { own: 'def', walls: p.walls ? Math.max(0, fort - (p.walls - 1)) + (p.kind === 'capital' ? 1 : 0) : 0, gun: Math.round(guns * (p.guns || 0) * 10) / 10, shield: p.shield ? spec.shield || 0 : 0, siege: 0, breach: 0 };
  for (const p of m.provs) war.armies.push({ id: nextId++, side: 'def', prov: p.id, men: Math.round(g * p.gar), post: p.id, cmdrs: p.id === m.capital ? (spec.defCmdrs || []).slice() : [] }); // the garrison's commanders hold the capital
  return war;
}
// the guns and shield platforms of a province shoot down part of a landing on it
export const skyToll = (war, prov) => { const pr = war.provs[prov], p = P(war, prov); if (pr.own === 'att') return 0;
  return clamp(pr.gun * .12 + pr.shield * .05 + (p.kind === 'capital' ? .08 : 0) + pr.walls * .06, 0, .6); }; // a capital has its Sarissa batteries, and a drop onto walls comes down among the guns
// The Rain: plan = [{ prov, troops, cmdrs? }]. Each landing loses its toll in the sky, then fights whatever stands
// there. With { defer: true } the landing battles wait in war.pending, to be fought (settle) or auto-resolved (resolve).
export function land(war, plan, rnd = Math.random, { defer = false } = {}) {
  const out = [];
  for (const { prov, troops, cmdrs } of plan) { if (!troops) continue; const rain = (cmdrs || []).some(c => c.t && c.t.includes('rain')), lost = Math.round(troops * skyToll(war, prov) * (rain ? .7 : 1));
    const a = { id: nextId++, side: 'att', prov, men: troops - lost, landed: war.week, cmdrs: (cmdrs || []).slice() }; war.armies.push(a); war.land0 += troops; out.push({ prov, troops, lost });
    war.log.push(`The Rain falls on ${P(war, prov).name}: ${troops.toLocaleString()} troops, ${lost.toLocaleString()} lost in the sky.`); }
  for (const prov of new Set(plan.map(x => x.prov))) { merge(war, prov);
    if (sideMen(war, 'att', prov) > 0 && sideMen(war, 'def', prov) > 0) { war.pending.push({ prov, kind: 'landing' }); if (!defer) resolve(war, prov, rnd); }
    else if (sideMen(war, 'att', prov) > 0) take(war, prov, 'att'); }
  merge(war); return out;
}
function merge(war, only) { // armies of one side in one province march as one, with all their commanders
  const seen = new Map();
  for (const a of war.armies) { if (a.men <= 0 || (only && a.prov !== only)) continue; const k = a.side + ':' + a.prov, b = seen.get(k);
    if (b) { b.men += a.men; a.men = 0; if (a.cmdrs && a.cmdrs.length) { b.cmdrs = [...(b.cmdrs || []), ...a.cmdrs]; a.cmdrs = []; } b.hungry = Math.max(b.hungry || 0, a.hungry || 0); } else seen.set(k, a); }
  war.armies = war.armies.filter(a => a.men > 0);
}
// orders: (id, to, men?, cmdrIds?). men: split off that many and send them, the rest stay; cmdrIds: the commanders who
// go with the part sent (by default they stay with the rest). Sending the whole army takes all its commanders.
export function order(war, id, to, men, cmdrIds) {
  const a = war.armies.find(x => x.id === id); if (!a || !reach(war, a).includes(to)) return false;
  if (a.side === 'def' && sideMen(war, 'att', a.prov) > 0) return false; // a garrison with the enemy at its walls is pinned there
  if (men && men < a.men) { const go = (a.cmdrs || []).filter(c => (cmdrIds || []).includes(c.id)), b = { id: nextId++, side: a.side, prov: a.prov, men, post: a.post, cmdrs: go, hungry: a.hungry || 0 };
    a.cmdrs = (a.cmdrs || []).filter(c => !go.includes(c)); a.men -= men; war.armies.push(b); b.to = to; } else a.to = to;
  return true;
}
// supply: an army is fed while it can trace a path through its own provinces to a source: for the attacker, a province
// it holds with a port or city while the fleet holds the orbit, or where it landed; for the defender, any city it holds
function supplied(war, side) {
  const src = Object.keys(war.provs).filter(id => { const p = P(war, id), pr = war.provs[id]; if (pr.own !== side) return false;
    return side === 'def' ? (p.kind === 'capital' || p.kind === 'city' || p.kind === 'port') : war.orbit; });
  const ok = new Set(src), q = [...src];
  while (q.length) { const id = q.shift(); for (const n of neighbours(war.world, id)) if (!ok.has(n) && war.provs[n].own === side) { ok.add(n); q.push(n); } }
  return ok;
}
// One planet turn (a campaign week) runs in three steps, so that a battle can be fought on the field in between:
//   weekMoves(war, { ai, orbit }) → the week's battles (war.pending: [{ prov, kind: 'field' | 'landing' }])
//   then for each battle either resolve(war, prov, rnd) (auto) or settle(war, prov, groundResult) (fought: ground.js)
//   weekEnd(war) → supply, recruitment, levies, and whether the war is over (war.over).
// weekTick does all three with every battle auto-resolved (the tests, forecast, and the campaign until M3).
// ai: (war, side) => [[id, to, men?, cmdrIds?], ...] for each side the computer plays.
export function weekTick(war, { ai = {}, rnd = Math.random, orbit = true } = {}) {
  if (war.over) return war.over; weekMoves(war, { ai, orbit });
  for (const b of war.pending.slice()) resolve(war, b.prov, rnd);
  return weekEnd(war);
}
export function resolve(war, prov, rnd = Math.random) { const r = fight(war, prov, rnd); war.pending = war.pending.filter(b => b.prov !== prov); return r; }
export function weekMoves(war, { ai = {}, orbit = true } = {}) {
  if (war.over) return []; war.week++; war.orbit = orbit; war.battles = []; war.pending = [];
  for (const side of ['att', 'def']) if (ai[side]) for (const o of ai[side](war, side)) order(war, ...o);
  // movement: everyone moves at once; armies that pass each other on a road meet in the province they were bound for
  // two armies marching opposite ways down the same road meet on it: the one heading into the other's province stops there
  for (const a of war.armies) if (a.to) for (const b of war.armies) if (b.to && b.side !== a.side && b.prov === a.to && b.to === a.prov) { b.to = null; break; }
  for (const a of war.armies) if (a.to) { a.prov = a.to; a.to = null; }
  merge(war);
  // battles wherever both sides stand; an unopposed army takes the province (a walled one by siege, below)
  for (const id of Object.keys(war.provs)) { const fa = sideMen(war, 'att', id), fd = sideMen(war, 'def', id);
    if (fa && fd) { const pr = war.provs[id]; if (pr.own === 'def' && pr.walls && fa < fd * 2.2 && (pr.siege || 0) < 2) { pr.siege = (pr.siege || 0) + 1; // a walled city: invest it, break the walls, then storm
        pr.breach = Math.min(.8, (pr.breach || 0) + .3 + (stackHas(war, 'att', id, 'butcher') || stackHas(war, 'att', id, 'breacher') ? .15 : 0)); war.log.push(`${P(war, id).name} is besieged (week ${pr.siege}).`); continue; }
      war.pending.push({ prov: id, kind: 'field' }); }
    else if (fa && war.provs[id].own === 'def') { take(war, id, 'att'); war.log.push(`${P(war, id).name} is taken unopposed.`); }
    else if (fd && war.provs[id].own === 'att') { take(war, id, 'def'); war.log.push(`The garrison retakes ${P(war, id).name}.`); } }
  merge(war);
  return war.pending;
}
export function weekEnd(war) {
  if (war.over) return war.over;
  for (const b of war.pending.slice()) resolve(war, b.prov); // a battle left neither fought nor resolved is auto-resolved
  merge(war);
  // supply: hungry armies lose men (not with a Quartermaster); a cut-off garrison too, more slowly
  for (const side of ['att', 'def']) { const ok = supplied(war, side); for (const a of war.armies) if (a.side === side && !ok.has(a.prov)) { const k = hasT(a, 'quarter') ? 0 : side === 'att' ? .1 : .05; a.men = Math.round(a.men * (1 - k)); a.hungry = (a.hungry || 0) + 1; } else if (a.side === side) a.hungry = 0; }
  // recruitment: the defender raises men in the cities it still holds, the capital most
  const rec = war.recruit ?? (150 + 100 * war.barracks);
  const held = M(war).provs.filter(p => war.provs[p.id].own === 'def' && (p.kind === 'capital' || p.kind === 'city' || p.kind === 'port'));
  const popHeld = held.reduce((s, p) => s + p.pop, 0);
  for (const p of held) { const n = Math.round(rec * p.pop / Math.max(.01, popHeld) * Math.min(1, popHeld / .5)); if (n > 0) { const g = war.armies.find(a => a.side === 'def' && a.prov === p.id); if (g) g.men += n; else war.armies.push({ id: nextId++, side: 'def', prov: p.id, men: n, post: p.id }); } }
  // levies (Harrison's decision 7): each city the attacker holds raises a few local troops a week, more where its people
  // cared little for their old masters, twice as many where a Beloved commander stands. Most troops still come from orbit.
  const lev0 = war.levied;
  for (const p of M(war).provs) { if (war.provs[p.id].own !== 'att' || !(p.kind === 'capital' || p.kind === 'city' || p.kind === 'port')) continue;
    const n = Math.round(LEVY.k * p.pop * clamp(1.3 - war.loyalty / 100, .3, 1.3) * (stackHas(war, 'att', p.id, 'beloved') ? 2 : 1)); if (n <= 0) continue;
    const g = war.armies.find(a => a.side === 'att' && a.prov === p.id); if (g) g.men += n; else war.armies.push({ id: nextId++, side: 'att', prov: p.id, men: n, cmdrs: [] }); war.levied += n; }
  if (war.levied > lev0) war.log.push(`The captured cities raise ${(war.levied - lev0).toLocaleString()} levies.`);
  merge(war);
  return check(war);
}
export const LEVY = { k: 500 }; // a week's levy: k × the city's share of the people × (1.3 − loyalty/100); Heliopolis at loyalty 50: about 100
export const menOf = (war, side) => war.armies.reduce((s, a) => s + (a.side === side ? a.men : 0), 0);
export const popOf = (war, side) => M(war).provs.reduce((s, p) => s + (war.provs[p.id].own === side ? p.pop : 0), 0);
function check(war) {
  const cap = M(war).capital, am = menOf(war, 'att'), dm = menOf(war, 'def');
  war.hopeless = am < dm * .2 && popOf(war, 'att') < .5 ? (war.hopeless || 0) + 1 : 0; // a remnant with no hope of the planet
  const owners = Object.keys(war.provs).map(id => war.provs[id].own).join(); // a war where nothing changes hands for eight weeks has bogged down
  war.still = owners === war.owners && !(war.battles || []).some(b => b.won === 'att') ? (war.still || 0) + 1 : 0; war.owners = owners;
  if (am <= 0) war.over = { won: 'def', why: 'The legions on the planet are destroyed.', week: war.week };
  else if (war.hopeless >= 3) war.over = { won: 'def', why: 'What is left of the legions lays down its arms.', week: war.week };
  else if (war.still >= 8 && war.provs[cap].own !== 'att') war.over = { won: 'def', why: 'The war bogs down: the legions are taken off the planet.', week: war.week, withdrawn: am }; // the campaign returns them to the fleet
  else if (war.provs[cap].own === 'att' && popOf(war, 'att') >= .6) war.over = { won: 'att', why: `${P(war, cap).name} has fallen, and most of ${M(war).name} with it.`, week: war.week };
  else if (dm <= 0 && popOf(war, 'att') >= .4) war.over = { won: 'att', why: 'The garrison is gone.', week: war.week };
  if (war.over) war.log.push(war.over.why);
  return war.over;
}

// ---------------------------------------------------------------- a stand-in commander for both sides
// (The AI chat owns the real one, aiPlanet(war, side); this one keeps tests and early builds playable.)
// Attacker: march on the capital by the shortest road, then on the richest provinces still the enemy's; take a step only
// when it can be won (or nobody holds it), else wait for the next wave. Defender: the capital's garrison holds it; the
// other posts gather where an enemy stack is too strong for one of them, and strike together where they can beat it.
const distFrom = (war, from) => { const d = { [from]: 0 }, q = [from]; while (q.length) { const id = q.shift(); for (const n of neighbours(war.world, id)) if (d[n] == null) { d[n] = d[id] + 1; q.push(n); } } return d; };
export function standIn(war, side) {
  const out = [], cap = M(war).capital, mine = war.armies.filter(a => a.side === side && a.men > 0 && !a.to);
  const foe = side === 'att' ? 'def' : 'att', foeAt = id => sideMen(war, foe, id);
  if (side === 'att') {
    const goal = war.provs[cap].own !== 'att' ? cap : M(war).provs.filter(p => war.provs[p.id].own !== 'att').sort((x, y) => y.pop - x.pop)[0]?.id;
    if (!goal) return out; const dg = distFrom(war, goal);
    for (const a of mine) {
      const here = power(war, 'att', a.prov, a.men), opts = reach(war, a);
      const beat = n => { const fd = foeAt(n); return !fd || here > power(war, 'def', n, fd) * (war.provs[n].walls && fd ? .9 : 1.1); };
      const step = opts.filter(n => dg[n] < dg[a.prov] && beat(n)).sort((x, y) => dg[x] - dg[y] || foeAt(x) - foeAt(y))[0];
      if (step) { out.push([a.id, step]); continue; }
      // blocked on the road: take an undefended province next door, keeping the stack together
      const free = opts.filter(n => war.provs[n].own === 'def' && !foeAt(n) && !bySea(war.world, a.prov, n)).sort((x, y) => P(war, y).pop - P(war, x).pop)[0];
      if (free && here > 0 && !foeAt(a.prov)) out.push([a.id, free]);
    }
  } else {
    const sent = new Set();
    // strike together: every enemy stack that the posts next to it can beat, the weakest first
    const stacks = Object.keys(war.provs).filter(id => foeAt(id)).sort((x, y) => foeAt(x) - foeAt(y));
    for (const e of stacks) {
      const pe = power(war, 'att', e, foeAt(e)), near = mine.filter(a => !sent.has(a) && reach(war, a).includes(e) && !bySea(war.world, a.prov, e));
      // the capital's garrison sallies with all it can spare: enough stays to hold the walls against the other stacks next
      // door (and never less than two in five)
      const part = a => { if (a.prov !== cap) return a.men; const other = neighbours(war.world, cap).filter(n => n !== e).reduce((m, n) => Math.max(m, power(war, 'att', n, foeAt(n))), 0);
        return Math.round(Math.max(0, Math.min(a.men * .6, a.men - other / Math.max(.01, native(war, cap, 'def') * war.defQ) * 1.1))); };
      const pw = near.reduce((s, a) => s + part(a) * war.defQ, 0); if (pw > pe * 1.25) for (const a of near) { out.push(a.prov === cap ? [a.id, e, part(a)] : [a.id, e]); sent.add(a); }
    }
    // the rest: a post that can't hold against a stack next door falls back toward the capital and joins what is there
    const dc = distFrom(war, cap);
    for (const a of mine) { if (sent.has(a) || a.prov === cap) continue;
      const enemyNext = neighbours(war.world, a.prov).reduce((s, n) => Math.max(s, power(war, 'att', n, foeAt(n))), 0);
      if (enemyNext > power(war, 'def', a.prov, a.men) * 1.1) { const back = reach(war, a).filter(n => war.provs[n].own === 'def' && !foeAt(n) && !bySea(war.world, a.prov, n)).sort((x, y) => dc[x] - dc[y])[0]; if (back && dc[back] < dc[a.prov]) out.push([a.id, back]); } }
  }
  return out;
}

// ---------------------------------------------------------------- helpers for the map screen (planetwarview.js)
// What a march would meet: 'join' (our own stack), 'take' (nobody there), 'siege' (walls the stack can't storm this
// week), or 'fight' with the auto-resolve odds for the attacker. men: the part of the army sent (all of it by default).
export function preview(war, a, to, men = a.men) {
  const foe = a.side === 'att' ? 'def' : 'att', fm = sideMen(war, foe, to), own = war.provs[to].own === a.side;
  if (!fm) return { kind: own ? 'join' : 'take', odds: 1 };
  const mine = men + sideMen(war, a.side, to), pr = war.provs[to];
  if (a.side === 'att' && pr.own === 'def' && pr.walls && mine < fm * 2.2 && (pr.siege || 0) < 2) return { kind: 'siege', odds: null, weeks: 2 - (pr.siege || 0) };
  const pa = power(war, 'att', to, a.side === 'att' ? mine : fm), pd = power(war, 'def', to, a.side === 'att' ? fm : mine), p = oddsOf(pa, pd);
  return { kind: 'fight', odds: a.side === 'att' ? p : 1 - p, foe: fm };
}
// The legate's landing plan: the best of a few simple plans (everything on one province, or split over two provinces
// joined by a road), judged by playing each out with the stand-in commanders. Far-side provinces count too.
export function suggestPlan(spec, n = 30) {
  const m = MAPS[spec.world]; if (!m) return []; const T = spec.troops, cand = [];
  for (const p of m.provs) cand.push([{ prov: p.id, troops: T }]);
  for (const [a, b] of m.roads) for (const k of [.6, .4]) cand.push([{ prov: a, troops: Math.round(T * k) }, { prov: b, troops: T - Math.round(T * k) }]);
  let best = null;
  for (const plan of cand) { const f = forecast(spec, plan, n), sc = f.win - f.weeks * .004; if (!best || sc > best.sc) best = { plan, sc, f }; }
  return best.plan;
}

// ---------------------------------------------------------------- for the globe (graphics chat)
// An equirectangular province-id map: for each texel, the province whose seat is nearest on the sphere; 255 = sea.
// land(lat, lon) says whether a texel is land (planetgen's sea alpha, passed in by the caller so this stays pure).
export function provMap(world, W, H, land) {
  const m = MAPS[world], seats = m.provs.map(p => vec(p.lat, p.lon)), out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) { const lat = 90 - (j + .5) / H * 180;
    for (let i = 0; i < W; i++) { const lon = (i + .5) / W * 360 - 180;
      if (land && !land(lat, lon, i, j)) { out[j * W + i] = 255; continue; }
      const v = vec(lat, lon); let b = 0, bd = -2; seats.forEach((s, k) => { const d = s[0] * v[0] + s[1] * v[1] + s[2] * v[2]; if (d > bd) { bd = d; b = k; } }); out[j * W + i] = b; } }
  return out; // rows top-down (row 0 = north); index = position in MAPS[world].provs
}

// ---------------------------------------------------------------- the odds of a Rain, by playing it out
// A war runs in well under a millisecond, so the campaign can show a Rain's chance by playing it out (both sides
// with the stand-in commander, seeded so the same plan shows the same odds): { win, weeks, lost } for the attacker.
export function forecast(spec, plan, n = 200) {
  let won = 0, weeks = 0, lost = 0;
  for (let k = 1; k <= n; k++) { let s = k * 7919 + 13; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const war = newWar(spec); land(war, plan, rnd);
    while (!war.over && war.week < 40) weekTick(war, { ai: { att: standIn, def: standIn }, rnd });
    if (war.over && war.over.won === 'att') won++; weeks += war.over ? war.over.week : 40; lost += war.land0 - menOf(war, 'att'); }
  return { win: won / n, weeks: weeks / n, lost: Math.round(lost / n) };
}
