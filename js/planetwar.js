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
      { id: 'tyche', name: 'Tyche', lat: 46, lon: -26, kind: 'capital', terrain: 'alpine', pop: .26, gar: .38, walls: 1, guns: .6, shield: 1, note: 'the capital' },
      { id: 'heliopolis', name: 'Heliopolis', lat: -4, lon: -24, kind: 'city', terrain: 'temperate', pop: .26, gar: .26, walls: 2, guns: .4, port: 1, field: 'mercury', note: 'the centre of commerce; spaceport' },
      { id: 'keryx', name: 'Keryx', lat: 8, lon: 40, kind: 'port', terrain: 'temperate', pop: .14, gar: .12, port: 1, note: 'port city' },
      { id: 'ladon', name: 'Waste of Ladon', lat: 6, lon: 2, kind: 'towns', terrain: 'desert', pop: .08, gar: .07, note: 'mining towns' },
      { id: 'highlands', name: 'Northern highlands', lat: 38, lon: 8, kind: 'forts', terrain: 'highland', pop: .06, gar: .08, note: 'hill forts' },
      { id: 'jungles', name: 'Southern jungles', lat: -30, lon: 5, kind: 'towns', terrain: 'jungle', pop: .08, gar: .05, note: 'scattered towns' },
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
export const TUNE = { def: 1.15 };
const TERRAIN = { alpine: 1.12, highland: 1.18, jungle: 1.15, desert: 1, temperate: 1.02 }; // the defender's ground
const wallsK = (war, p) => { const pr = war.provs[p.id]; return pr.walls ? 1 + .22 * pr.walls * (1 - (pr.breach || 0)) : 1; };
export function power(war, side, prov, men) {
  const p = P(war, prov), pr = war.provs[prov], held = pr.own === side;
  let k = 1; if (held) k *= (TERRAIN[p.terrain] || 1) * wallsK(war, p);
  if (side === 'att') k *= war.attQ; else k *= war.defQ;
  return men * k;
}
// Auto-resolve: the odds follow the ratio of power (a fitted logistic; tests/planet_war.mjs), losses follow the fight.
// Fought battles use ground.js; the auto-resolve is fitted to it so neither is the better choice.
export const FIT = { s: .32, lossW: .32, lossL: .62 };
export function oddsOf(pa, pd) { const r = Math.log(Math.max(1e-6, pa) / Math.max(1e-6, pd)); return 1 / (1 + Math.exp(-r / FIT.s)); }
function fight(war, prov, rnd) {
  const A = war.armies.filter(a => a.prov === prov && a.side === 'att' && a.men > 0), Dd = war.armies.filter(a => a.prov === prov && a.side === 'def' && a.men > 0);
  if (!A.length || !Dd.length) return null;
  const ma = A.reduce((s, a) => s + a.men, 0), md = Dd.reduce((s, a) => s + a.men, 0), pa = power(war, 'att', prov, ma), pd = power(war, 'def', prov, md);
  const p = oddsOf(pa, pd), won = rnd() < p ? 'att' : 'def', W = won === 'att' ? A : Dd, L = won === 'att' ? Dd : A, pw = won === 'att' ? pa : pd, pl = won === 'att' ? pd : pa;
  const lw = clamp(FIT.lossW * pl / pw * (.8 + rnd() * .4), .03, .6), ll = clamp(FIT.lossL * (.8 + rnd() * .4) + .1 * pl / pw, .3, .95);
  for (const a of W) a.men = Math.round(a.men * (1 - lw)); for (const a of L) a.men = Math.round(a.men * (1 - ll));
  const res = { prov, won, att0: ma, def0: md, odds: p, lostA: won === 'att' ? lw : ll, lostD: won === 'def' ? lw : ll, week: war.week };
  // the beaten fall back to a province of their own next door, or are lost
  for (const a of L) { if (a.men <= 0) continue; const back = neighbours(war.world, prov).filter(n => war.provs[n].own === a.side && !bySea(war.world, prov, n));
    if (back.length) a.prov = back.sort((x, y) => sideMen(war, a.side, y) - sideMen(war, a.side, x))[0]; else a.men = 0; }
  if (won === 'att') take(war, prov, 'att');
  war.log.push(`${P(war, prov).name}: ${won === 'att' ? 'the legions win' : 'the garrison holds'} (${Math.round(p * 100)}% for the attacker; ${ma.toLocaleString()} against ${md.toLocaleString()}).`);
  war.battles.push(res); return res;
}
const sideMen = (war, side, prov) => war.armies.reduce((s, a) => s + (a.side === side && a.prov === prov ? a.men : 0), 0);
function take(war, prov, side) { const pr = war.provs[prov]; if (pr.own === side) return; pr.own = side; pr.siege = 0; if (side === 'att') { pr.gun = 0; pr.shield = 0; } }

// ---------------------------------------------------------------- a war
// spec: { world, by, def, troops (the drop, campaign troops), garrison, fort, gun, shield, barracks, loyalty (0..100) }
let nextId = 1;
export function newWar(spec) {
  const m = MAPS[spec.world]; if (!m) return null;
  const war = { world: spec.world, by: spec.by, def: spec.def, week: 0, provs: {}, armies: [], log: [], battles: [], over: null, orbit: true,
    attQ: 1, defQ: clamp((spec.loyalty ?? 50) + 30, 40, 130) / 80 * TUNE.def, // a loyal garrison fights harder, on its own ground
    barracks: spec.barracks || 0, recruit: spec.recruit ?? null, land0: 0 };
  const g = spec.garrison, guns = spec.gun || 0, fort = spec.fort || 0;
  for (const p of m.provs) war.provs[p.id] = { own: 'def', walls: p.walls ? Math.max(0, fort - (p.walls - 1)) + (p.kind === 'capital' ? 1 : 0) : 0, gun: Math.round(guns * (p.guns || 0) * 10) / 10, shield: p.shield ? spec.shield || 0 : 0, siege: 0, breach: 0 };
  for (const p of m.provs) war.armies.push({ id: nextId++, side: 'def', prov: p.id, men: Math.round(g * p.gar), post: p.id });
  return war;
}
// the guns and shield platforms of a province shoot down part of a landing on it
export const skyToll = (war, prov) => { const pr = war.provs[prov], p = P(war, prov); if (pr.own === 'att') return 0;
  return clamp(pr.gun * .12 + pr.shield * .05 + (p.kind === 'capital' ? .08 : 0) + pr.walls * .06, 0, .6); }; // a capital has its Sarissa batteries, and a drop onto walls comes down among the guns
// The Rain: plan = [{ prov, troops }]. Each landing loses its toll in the sky, then fights whatever stands there.
export function land(war, plan, rnd = Math.random) {
  const out = [];
  for (const { prov, troops } of plan) { if (!troops) continue; const lost = Math.round(troops * skyToll(war, prov));
    const a = { id: nextId++, side: 'att', prov, men: troops - lost, landed: war.week }; war.armies.push(a); war.land0 += troops; out.push({ prov, troops, lost });
    war.log.push(`The Rain falls on ${P(war, prov).name}: ${troops.toLocaleString()} troops, ${lost.toLocaleString()} lost in the sky.`); }
  for (const prov of new Set(plan.map(x => x.prov))) { merge(war, prov); if (!fight(war, prov, rnd) && sideMen(war, 'att', prov) > 0) take(war, prov, 'att'); }
  merge(war); return out;
}
function merge(war, only) { // armies of one side in one province march as one
  const seen = new Map();
  for (const a of war.armies) { if (a.men <= 0 || (only && a.prov !== only)) continue; const k = a.side + ':' + a.prov, b = seen.get(k); if (b) { b.men += a.men; a.men = 0; } else seen.set(k, a); }
  war.armies = war.armies.filter(a => a.men > 0);
}
// orders: a list of { id, to, men? } (men: split off that many and send them; the rest stay)
export function order(war, id, to, men) {
  const a = war.armies.find(x => x.id === id); if (!a || !reach(war, a).includes(to)) return false;
  if (a.side === 'def' && sideMen(war, 'att', a.prov) > 0) return false; // a garrison with the enemy at its walls is pinned there
  if (men && men < a.men) { const b = { id: nextId++, side: a.side, prov: a.prov, men, post: a.post }; a.men -= men; war.armies.push(b); b.to = to; } else a.to = to;
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
// One planet turn (a campaign week). ai: (war, side) => [[id, to, men?], ...] for each side the computer plays.
export function weekTick(war, { ai = {}, rnd = Math.random, orbit = true } = {}) {
  if (war.over) return war.over; war.week++; war.orbit = orbit; war.battles = [];
  for (const side of ['att', 'def']) if (ai[side]) for (const o of ai[side](war, side)) order(war, ...o);
  // movement: everyone moves at once; armies that pass each other on a road meet in the province they were bound for
  // two armies marching opposite ways down the same road meet on it: the one heading into the other's province stops there
  for (const a of war.armies) if (a.to) for (const b of war.armies) if (b.to && b.side !== a.side && b.prov === a.to && b.to === a.prov) { b.to = null; break; }
  for (const a of war.armies) if (a.to) { a.prov = a.to; a.to = null; }
  merge(war);
  // battles wherever both sides stand; an unopposed army takes the province (a walled one by siege, below)
  for (const id of Object.keys(war.provs)) { const fa = sideMen(war, 'att', id), fd = sideMen(war, 'def', id);
    if (fa && fd) { if (war.provs[id].own === 'def' && war.provs[id].walls && fa < fd * 2.2 && (war.provs[id].siege || 0) < 2) { war.provs[id].siege = (war.provs[id].siege || 0) + 1; war.provs[id].breach = Math.min(.8, war.provs[id].siege * .3); war.log.push(`${P(war, id).name} is besieged (week ${war.provs[id].siege}).`); continue; } // a walled city: invest it, break the walls, then storm
      fight(war, id, rnd); }
    else if (fa && war.provs[id].own === 'def') { take(war, id, 'att'); war.log.push(`${P(war, id).name} is taken unopposed.`); }
    else if (fd && war.provs[id].own === 'att') { take(war, id, 'def'); war.log.push(`The garrison retakes ${P(war, id).name}.`); } }
  merge(war);
  // supply: hungry armies lose men; a cut-off garrison too, more slowly
  for (const side of ['att', 'def']) { const ok = supplied(war, side); for (const a of war.armies) if (a.side === side && !ok.has(a.prov)) { const k = side === 'att' ? .1 : .05; a.men = Math.round(a.men * (1 - k)); a.hungry = (a.hungry || 0) + 1; } else if (a.side === side) a.hungry = 0; }
  // recruitment: the defender raises men in the cities it still holds, the capital most
  const rec = war.recruit ?? (150 + 100 * war.barracks);
  const held = M(war).provs.filter(p => war.provs[p.id].own === 'def' && (p.kind === 'capital' || p.kind === 'city' || p.kind === 'port'));
  const popHeld = held.reduce((s, p) => s + p.pop, 0);
  for (const p of held) { const n = Math.round(rec * p.pop / Math.max(.01, popHeld) * Math.min(1, popHeld / .5)); if (n > 0) { const g = war.armies.find(a => a.side === 'def' && a.prov === p.id); if (g) g.men += n; else war.armies.push({ id: nextId++, side: 'def', prov: p.id, men: n, post: p.id }); } }
  merge(war);
  return check(war);
}
export const menOf = (war, side) => war.armies.reduce((s, a) => s + (a.side === side ? a.men : 0), 0);
export const popOf = (war, side) => M(war).provs.reduce((s, p) => s + (war.provs[p.id].own === side ? p.pop : 0), 0);
function check(war) {
  const cap = M(war).capital, am = menOf(war, 'att'), dm = menOf(war, 'def');
  war.hopeless = am < dm * .2 && popOf(war, 'att') < .5 ? (war.hopeless || 0) + 1 : 0; // a remnant with no hope of the planet
  if (am <= 0) war.over = { won: 'def', why: 'The legions on the planet are destroyed.', week: war.week };
  else if (war.hopeless >= 3) war.over = { won: 'def', why: 'What is left of the legions lays down its arms.', week: war.week };
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
      const part = a => a.prov === cap ? Math.round(a.men * .6) : a.men; // the capital's garrison sallies with three in five, the rest keep the walls
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
