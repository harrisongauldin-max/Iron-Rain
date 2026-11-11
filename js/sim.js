import { S } from './state.js';
import { WPN, DEFS, WORLD, DIFF, BODIES, REPLACE_COST, REPLACE_MAN, NUKE_COST, FACTIONS, NEUTRAL_C, COMMANDERS, factionDefs, SUBS, SENSOR_K, EMIT, lockOf } from './data.js';
import { lockRange, inWash, addWash } from './sense.js';
import { TAU, PI, rand, clamp, hyp, angDiff, dist, segHit } from './util.js';
import { updBodies, grav, losClear, buildGrid, query, bodyHit, makeField, inField, rocksNear, segRock } from './physics.js';
import { aiTick } from './ai.js';
import { setupBodies, bodyOf, bodyIdx, WORLDS, WORLD as WDEF, PROD_K, AU } from './solar.js';
import { toast, onScreen } from './ui.js';
import { sfx } from './audio.js';

// ================================================================ factions and definitions
export const defOf = (team, type) => (S.fdefs[team] && S.fdefs[team][type]) || DEFS[type];
export const facOf = team => team < 2 ? FACTIONS[S.fac[team]] : null;
export function setupFactions(pf, af) {
  S.fac = [pf, af]; S.fdefs = [factionDefs(pf), factionDefs(af), DEFS];
  S.teamc = [FACTIONS[pf].col, pf === af ? FACTIONS[af].alt : FACTIONS[af].col, NEUTRAL_C];
  S.roster = FACTIONS[pf].roster;
  S.cmdrs = [];
  for (let t = 0; t < 2; t++) {
    const list = COMMANDERS[S.fac[t]]; const mirror = t === 1 && pf === af;
    list.forEach((c, i) => S.cmdrs.push({ id: t * 10 + i, team: t, name: mirror ? c.name + ' the Younger' : c.name, caste: c.caste, title: c.title, traits: c.traits, state: 'ready', ship: null, renown: 0, rank: 0, timer: 0, kills: 0, heldBy: null }));
  }
}
const loyBase = team => team === 2 ? .5 : FACTIONS[S.fac[team]].loyalty;

// ================================================================ ships
function mount(e, d) {
  const m = Array.isArray(e) ? { w: e[0], x: e[1], y: e[2], dir: 0, guns: 1 } : e;
  const D = WPN[m.w]; const guns = m.guns || 1;
  let mag = D.mag * (D.battery ? guns : 1); if (D.nuke && d.nukeMag) mag = d.nukeMag;
  return { def: D, ox: m.x, oy: m.y, dir: (m.dir || 0) * PI / 180, guns, mag, ammo: mag, cd: Math.random() * D.reload * (D.pd ? 1 : TEMPO), scan: Math.random() * .3,
    target: null, ang: 0, salvo: 0, st: 0, stg: null, volley: 0, vt: 0, mx: 0, my: 0, nfill: 0 };
}
export function makeShip(type, team, x, y, a = 0) {
  const d = defOf(team, type);
  const s = { id: ++S.nid, type, def: d, team, x, y, vx: 0, vy: 0, a, av: 0, hp: d.hp, r: d.r, mass: d.mass,
    order: { type: 'idle', x, y }, weapons: d.weapons.map(e => mount(e, d)),
    crew: d.crew, marines: Math.round(d.crew * d.mar), troops: d.troops || 0, sh: d.shield, shHit: -99, shDown: -99, shFlash: 0, shA: 0,
    emp: 0, sig: 1, lastFire: -99, vis: [team === 0, team === 1, team === 2], supply: d.supply || 0, hf: 1, gf: 1,
    throttle: 0, rx: 0, ry: 0, cargo: 0, engage: null, aware: null, fstate: 'attack', ft: 0, thinkT: Math.random() * .5, dead: false, seen: team === 0,
    lastHit: -99, boardProg: 0, boardT: -99, boardTeam: 0, docked: null, flash: 0, atBase: false, depot: null, wTold: false, derelict: false,
    h: d.hangar ? { ripwing: d.hangar.ripwing || 0, starshell: d.hangar.starshell || 0, boarder: d.hangar.boarder || 0, stork: d.hangar.stork || 0 } : null, hmode: 'auto', hangT: Math.random() * .5, clearT: 0, hfill: 0, carrier: null, launchSide: 1,
    fuel: 1, loy: loyBase(team), xp: 0, rank: 0, sub: d.sub ? { eng: 1, bridge: 1, gunsP: 1, gunsS: 1, shld: 1 } : null, cmdr: null, aimSub: null, shP: d.shield / 2, shS: d.shield / 2, gP: 1, gS: 1, helm: null, pend: null,
    queue: d.producer ? [] : null, rally: null, surrendered: false, rescueT: 0, prizeT: 0, orbit: null, salvage: null, moraleT: Math.random(), fuelTold: false, inspired: false, shAura: false, breachMul: 1 };
  for (const w of s.weapons) w.ang = a + w.dir;
  S.ships.push(s); return s;
}
export const crewEff = s => s.def.crew > 2 ? clamp(s.crew / s.def.crew, 0, 1) : 1;
export const disabled = s => s.emp > 0 || s.derelict || s.surrendered;
export function mainAmmo(s) { let a = 0, m = 0; for (const w of s.weapons) { if (w.def.pd || w.def.manual) continue; a += w.ammo / w.mag; m++; } return m ? a / m : 1; }
export const nukesOf = s => s.weapons.filter(w => w.def.nuke);
export const shMax = s => s.def.shield * (s.sub ? (s.sub.shld <= .1 ? 0 : .5 + .5 * s.sub.shld) : 1); // a wrecked generator is out until damage control has it a tenth of the way back
// port and starboard: which side of a ship a point lies on (1 starboard, -1 port), and its shields in two halves.
// s.sh stays the total that everything else reads; the halves follow it when other code changes it.
export const sideOf = (s, x, y) => angDiff(s.a, Math.atan2(y - s.y, x - s.x)) >= 0 ? 1 : -1;
// going cold: shields drain away and the drives drop to a whisper; warming up, the guns are free at once but the shields
// need a few seconds to spin up before they recharge from empty (the Rim's ships switch in half the time)
export function goCold(s) { if (s.cold || s.def.static) return; s.cold = true; s.coldT = S.time; }
export function warmUp(s) { if (!s.cold) return; s.cold = false; s.warmT = S.time; s.spinT = S.time + (s.def.faction === 'rim' ? 3 : 6); }
export function shSync(s) {
  const t = s.shP + s.shS;
  if (Math.abs(t - s.sh) > .01) { if (t > 0) { const k = s.sh / t; s.shP *= k; s.shS *= k; } else { s.shP = s.shS = s.sh / 2; } }
}
export const halfCap = (s, side) => shMax(s) * (s.braceT > S.time ? (s.braceSide === side ? .75 : .25) : .5);
// brace: the shield generator throws its power to the threatened side for a few seconds
export function brace(s, side, T = 8) {
  if (!s.sub || !s.def.shield || disabled(s)) return false;
  shSync(s); s.braceT = S.time + T; s.braceSide = side;
  const k = side > 0 ? 'shS' : 'shP', o = side > 0 ? 'shP' : 'shS', move = Math.min(s[o] * .6, halfCap(s, side) - s[k]);
  if (move > 0) { s[o] -= move; s[k] += move; } s.sh = s.shP + s.shS; s.shFlash = .35; s.shA = s.a + side * PI / 2;
  return true;
}
// where the threat to a ship lies: the bow lance charging at it, else the nearest enemy warship
export function threatSide(s) {
  const by = s.lanceT > S.time && s.lanceBy && !s.lanceBy.dead ? s.lanceBy : nearestFoe(s, 3500);
  return by ? sideOf(s, by.x, by.y) : 1;
}
export const helmOf = s => (s.group && !s.detached ? s.group.helm : s.helm) || 'auto';
export const HELMS = [['auto', 'Auto', 'Turn whichever broadside is healthier, swing the bow on for a lance shot'], ['port', 'Port', 'Present the port broadside'], ['stbd', 'Starboard', 'Present the starboard broadside'], ['bow', 'Bow-on', 'Keep the bow on the enemy: lances bear, and the narrowest profile'], ['range', 'Keep range', 'Stand off at the longest reach of the main guns']];
export const RAKE = 1.25; // a hit down the length of a hull, in the bow band
// the stern: the engines are the one soft place on a warship (Morning Star, at Ilium). A round that comes in over the
// drive bells finds no armour plate and does double harm
export const STERN = 2;
// fire discipline, per side: hold to the effective range of each gun (false) or open fire at its full reach (true).
// Long fire is inaccurate, spends the magazines and lights up the ship that fires
export const longFire = t => !S.fireLong || S.fireLong[t] !== false;
export const effR = D => D.eff || D.range;
export const bonus = (s, t) => s.cmdr && s.cmdr.traits.includes(t) ? 1 + .25 * s.cmdr.rank : 0;
const resist = s => (FACTIONS[s.def.faction] ? FACTIONS[s.def.faction].resist : 1) * (bonus(s, 'discipline') ? .5 : 1);
const loyFloor = s => bonus(s, 'discipline') ? .3 : 0;
export function needsService(s, full = true) {
  const d = s.def;
  if (s.hp < d.hp * .95 || s.fuel < .95) return true;
  for (const w of s.weapons) if (w.ammo < w.mag && !w.def.nuke) return true;
  if (s.sub) for (const k in s.sub) if (s.sub[k] < .95) return true;
  if (d.supply && s.supply < d.supply * .95) return true;
  if (!full) return false;
  if (d.crew > 2 && s.crew < d.crew * .95) return true;
  if (d.troops && s.troops < d.troops) return true;
  if (s.h) for (const k in s.h) if (s.h[k] < d.hangar[k]) return true;
  return false;
}
export const isCapital = s => !!s.def.capture;
export const producersOf = team => S.ships.filter(s => s.team === team && s.def.producer && !s.dead);
export const countType = (team, type) => S.ships.filter(s => s.team === team && s.type === type && !s.dead).length + producersOf(team).reduce((a, p) => a + p.queue.filter(q => q.type === type).length, 0);
export function nearestDepot(s) {
  let best = null, bd = 1e18;
  for (const o of S.ships) { if (o.team !== s.team || !o.def.depot || o.dead || o === s || o.derelict) continue; const d = hyp(o.x - s.x, o.y - s.y); if (d < bd) { bd = d; best = o; } }
  return best;
}
// who counts as a target: neutrals only once you have picked a fight with them, never surrendered ships or dead hulks
export function hostileTo(s, o, ot) {
  if (o.team === s.team || o.dead || o.surrendered) return false;
  if (o.team === 2) { if (o === ot) return true; if (o.derelict) return false; return S.time - S.aggro[s.team] < 30; }
  if (s.team === 2) return true;
  return true;
}

// ================================================================ world setup
function makeNode(x, y, amt, kind = 'he') {
  const rocks = []; const n = 7 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), rr = rand(0, 110), sz = rand(16, 46); const pts = []; const k = 6 + Math.floor(rand(0, 4));
    for (let j = 0; j < k; j++) { const aa = j / k * TAU; pts.push(Math.cos(aa) * sz * rand(.65, 1.1), Math.sin(aa) * sz * rand(.65, 1.1)); }
    rocks.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, pts, vein: Math.random() < .7 });
  }
  return { x, y, amount: amt, max: amt, rocks, r: 150, kind };
}
export function nearestNode(s, avoidTeam, kind) {
  let best = null, bd = 1e18;
  for (const n of S.nodes) {
    if (n.amount <= 0 || (kind && n.kind !== kind)) continue; let d = hyp(n.x - s.x, n.y - s.y);
    const st = avoidTeam != null && S.stations[avoidTeam];
    if (st && !st.dead && hyp(n.x - st.x, n.y - st.y) < 3800) d += 6000;
    if (d < bd) { bd = d; best = n; }
  }
  return best || (kind ? nearestNode(s, avoidTeam) : null);
}
// which resource a fresh hauler should go after: whichever the team holds less of
export function neededKind(team) {
  const he = S.ships.filter(s => s.team === team && s.type === 'hauler' && s.order.node && s.order.node.kind === 'he').length;
  const ore = S.ships.filter(s => s.team === team && s.type === 'hauler' && s.order.node && s.order.node.kind === 'ore').length;
  if (S.ore[team] < S.res[team] * .6) return 'ore'; if (S.res[team] < S.ore[team] * .6) return 'he';
  return ore < he ? 'ore' : 'he';
}
function resetWorld() {
  S.ships = []; S.shots = []; S.missiles = []; S.parts = []; S.debris = []; S.rings = []; S.nodes = []; S.flashes = []; S.markers = []; S.fields = []; S.env = null; S.ripples = []; S.fxQ = [];
  S.stations = [null, null]; S.selection = []; S.groups = {}; S.incomeLog = []; S.time = 0; S.screenFlash = 0; S.aiNukeT = 0; S.inspect = null; S.builder = null;
  S.stats = { built: 0, lost: 0, kills: 0, captured: 0, crewLost: 0, mutinies: 0, recruited: 0, liberated: 0 }; S.prodLog = [{}, {}]; S.legion = [0, 0]; S.aggro = [-99, -99, -99]; S.bgroups = {};
  S.wrecks = []; S.hulks = []; S.bstat = { emp: [0, 0, 0], ord: [0, 0, 0], rounds: [0, 0, 0] }; S.follow = null;
  updBodies();
}
function derelict(type, x, y) {
  const s = makeShip(type, 2, x, y, rand(0, TAU));
  s.crew = s.def.crew * rand(.02, .06); s.marines = 0; s.hp = s.def.hp * rand(.3, .6); s.sh = 0; s.shDown = 1e9; s.fuel = rand(.1, .4); s.loy = 0;
  for (const w of s.weapons) w.ammo = Math.floor(w.mag * rand(.1, .4));
  if (s.sub) for (const k in s.sub) s.sub[k] = Math.random() < .4 ? 0 : rand(.2, .7);
  if (s.h) { s.h.ripwing = 0; s.h.starshell = 0; s.h.boarder = 0; }
  s.av = rand(-.03, .03); s.vx = rand(-4, 4); s.vy = rand(-4, 4); s.anchored = true;
  return s;
}
function structure(type, x, y, opts = {}) {
  const s = makeShip(type, 2, x, y, rand(0, TAU));
  if (opts.abandoned) { s.crew = 0; s.marines = 0; s.sh = 0; s.hp = s.def.hp * .55; s.shDown = 1e9; for (const w of s.weapons) w.ammo = 0; }
  if (opts.orbit) s.orbit = opts.orbit;
  return s;
}
// which half of the Core each team starts with: the Republic worlds (Earth, Luna, Mars) or the Society worlds (Venus, Mercury)
// which worlds each team starts with. The side nobody plays keeps its worlds as armed neutrals (team 2):
// they fire only on those who attack them, and can be boarded like any other world.
const SIDE_OF = { rising: 'rep', core: 'soc', rim: 'rim' };
function sides() {
  const a = SIDE_OF[S.fac[0]]; let b = SIDE_OF[S.fac[1]]; if (b === a) b = a === 'soc' ? 'rep' : 'soc';
  const m = { rep: 2, soc: 2, rim: 2, neu: 2 }; m[a] = 0; m[b] = 1; return m;
}
const near = (id, ang, R) => { const b = bodyOf(id); return { x: b.x + Math.cos(ang) * (b.r + R), y: b.y + Math.sin(ang) * (b.r + R) }; };
const orbitPeriod = R => Math.max(240, TAU * R / 25); // structures circle at no more than 25 km/s
function fleetAt(team, id, ang, R, ships, face) {
  const c = near(id, ang, R), out = []; let i = 0; const n = Object.values(ships).reduce((a, v) => a + v, 0), cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5)));
  for (const t in ships) for (let k = 0; k < ships[t]; k++, i++) {
    const x = c.x + (i % cols - cols / 2) * 230 + rand(-30, 30), y = c.y + Math.floor(i / cols) * 230 + rand(-30, 30);
    const s = makeShip(t, team, x, y, face ?? ang + PI); s.order = { type: 'idle', x, y }; out.push(s);
  }
  return out;
}
export function newGame() {
  setupFactions(S.choice.player, S.choice.ai);
  setupBodies(); resetWorld();
  S.res = [1200, 1200]; S.ore = [900, 900]; S.ord = [1500, 1500]; S.man = [25000, 25000]; S.food = [0, 0]; S.buff = [{ gun: 1 }, { gun: 1 }];
  Object.assign(S.AI, { t: 0, attacking: false, threshold: 6500 * DIFF[S.difficulty].thr, sentValue: 0, capT: 40, capTarget: null });
  const side = sides(); S.side = side; S.worlds = {}; S.halt = {}; S.reserveTaken = {};
  for (const w of WORLDS) {
    const b = bodyOf(w.id), bi = bodyIdx(w.id), team = side[w.side], moon = b.kind === 'moon';
    const gR = b.r + (w.gov === 'station' ? 520 : moon ? 200 : 320);
    const g = makeShip(w.gov, team, b.x + gR, b.y, 0); g.orbit = { b: bi, R: gR, period: orbitPeriod(gR), ph: rand(0, TAU) };
    g.gov = w.id; g.world = w.id; g.buildMul = w.build || 1; g.serviceMul = w.service || 1;
    if (w.gov !== 'station') g.marines = Math.round(g.marines * w.ground);
    if (w.ruin) { g.crew = 0; g.marines = 0; g.sh = 0; g.shDown = 1e9; g.hp = g.def.hp * .5; for (const wp of g.weapons) wp.ammo = 0; }
    if (w.gov === 'station' && team < 2) { S.stations[team] = g; g.rally = near(w.id, rand(0, TAU), 1400); }
    if (w.yard) { const yR = b.r + 900; const y = makeShip(w.yard, team, b.x + yR, b.y, 0); y.orbit = { b: bi, R: yR, period: orbitPeriod(yR), ph: g.orbit.ph + PI }; y.world = w.id; y.buildMul = w.yardBuild || 1; y.marines = Math.round(y.marines * w.ground); y.reserve = 3000; S.venusYard = y; }
    if (w.reserve) g.reserve = w.reserve;
    const n = w.plats.gun + w.plats.shield, pR = b.r + (moon ? 380 : 650); let i = 0;
    for (let k = 0; k < w.plats.gun; k++) { const p = makeShip('gunplat', team, 0, 0, 0); p.orbit = { b: bi, R: pR, period: orbitPeriod(pR), ph: i++ / n * TAU }; p.world = w.id; }
    for (let k = 0; k < w.plats.shield; k++) { const p = makeShip('shieldplat', team, 0, 0, 0); p.orbit = { b: bi, R: pR, period: orbitPeriod(pR), ph: i++ / n * TAU }; p.world = w.id; }
    S.worlds[w.id] = { id: w.id, gov: g, owner: team < 2 ? team : -2, home: team };
  }
  // He-3 and ore fields in high orbit around the worlds (none near the moons: they move)
  const fields = [['mars', .4, 2200, 'he', 4200], ['mars', 2.6, 2600, 'he', 4200], ['mars', 4.4, 1900, 'ore', 4000], ['earth', 1.1, 2400, 'he', 3600], ['earth', 3.9, 2100, 'ore', 4200],
    ['venus', .8, 2300, 'he', 4200], ['venus', 3.3, 2500, 'ore', 3200], ['mercury', 1.6, 1900, 'ore', 5000], ['mercury', 4.6, 2200, 'he', 3200],
    ['jupiter', .9, 9000, 'he', 6000], ['jupiter', 2.9, 9000, 'he', 6000], ['jupiter', 4.6, 9000, 'ore', 4000], ['saturn', 1.3, 8000, 'he', 6000], ['saturn', 4.0, 8000, 'ore', 4000],
    ['ceres', 1.0, 2400, 'ore', 6000], ['ceres', 3.6, 2600, 'ore', 6000], ['uranus', 2, 5000, 'he', 5000], ['neptune', 2, 5000, 'he', 5000],
    ['vesta', 2.2, 1800, 'ore', 5000], ['pallas', 1.5, 1800, 'ore', 4000], ['hygiea', 4.1, 1700, 'ore', 4000], ['hildas', .6, 1500, 'ore', 3000], ['eris', 2.5, 2600, 'he', 4000], ['haumea', 1, 2200, 'he', 3000]];
  for (const [id, a, R, k, amt] of fields) { const p = near(id, a, R); S.nodes.push(makeNode(p.x, p.y, amt, k)); }
  // the wreckage of the long siege drifts off Mercury; the Belt's rubble lies between Mars and Jupiter
  const wf = near('mercury', 5.6, 5200); S.fields = [makeField(wf.x, wf.y, 900, 22)];
  { const mb = bodyOf('marcher'); if (mb) { for (let i = 0; i < 3; i++) { const p = near('marcher', i * 2.1 + .3, 900 + i * 400); S.fields.push(makeField(p.x, p.y, 700, 16)); } const d = near('marcher', 1.2, 1300); derelict('destroyer', d.x, d.y); derelict('hauler', d.x + 260, d.y + 180); derelict('frigate', d.x - 220, d.y + 300); } } // the trash moon's scrap
  derelict('destroyer', wf.x + 200, wf.y - 150); derelict('frigate', wf.x - 300, wf.y + 220); derelict('torch', wf.x + 50, wf.y + 420);
  const ce = bodyOf('ceres');
  for (let i = 0; i < 3; i++) { const p = near('ceres', i * 2.1 + .5, 3600 + i * 900); S.fields.push(makeField(p.x, p.y, 800, 20)); }
  for (let i = 0; i < 26; i++) { const a = rand(0, TAU), R = rand(2.2, 3.3) * AU; S.fields.push(makeField(Math.cos(a) * R, Math.sin(a) * R, rand(600, 1000), 18)); }
  const pirates = near('ceres', 2.8, 4200); derelict('raider', pirates.x, pirates.y); derelict('corsair', pirates.x + 300, pirates.y - 200);
  // opening forces
  const light = t => FACTIONS[S.fac[t]].roster[1][0][0];
  let g1 = null;
  if (side.rep < 2) {
    const rep = side.rep;
    if (side.soc < 2) {
      const merc = bodyOf('mercury'), siegeAng = Math.atan2(bodyOf('venus').y - merc.y, bodyOf('venus').x - merc.x) + 2.2;
      const siege = fleetAt(rep, 'mercury', siegeAng, 7000, { moonbreaker: 1, torch: 2, destroyer: 3, frigate: 4, tender: 1 }, siegeAng + PI);
      for (const s of siege) if (s.type === 'moonbreaker') s.title = 'Morning Star'; // Orion's White Fleet holds Mercury's orbit
      if (rep === 0) g1 = siege;
    } else { const f = fleetAt(rep, 'luna', 2.6, 2600, { dread: 1, torch: 2, destroyer: 3, frigate: 4, tender: 1 }); if (rep === 0) g1 = f; }
    fleetAt(rep, 'luna', 1, 1500, { frigate: 2, [light(rep)]: 2, ripwing: 4, scout: 1 });
    fleetAt(rep, 'mars', 2, 1600, { frigate: 2, [light(rep)]: 2 });
  }
  if (side.soc < 2) {
    const soc = side.soc, merc = bodyOf('mercury'), a = Math.atan2(bodyOf('venus').y - merc.y, bodyOf('venus').x - merc.x) + 2.8;
    const f = fleetAt(soc, 'venus', 2.5, 1600, { dread: 1, torch: 2, destroyer: 3, frigate: 4, ripwing: 4, scout: 1 }); if (soc === 0) g1 = f;
    fleetAt(soc, 'mercury', a, 900, { destroyer: 2, frigate: 3, [light(soc)]: 2 });
  }
  if (side.rim < 2) {
    const rim = side.rim;
    const f = fleetAt(rim, 'io', 1.2, 1700, { dread: 1, torch: 2, raider: 3, frigate: 3, ripwing: 4, scout: 1 }); if (rim === 0) g1 = f;
    fleetAt(rim, 'titan', 3, 1500, { frigate: 2, [light(rim)]: 2 });
    fleetAt(rim, 'callisto', 5, 1500, { destroyer: 1, frigate: 2 });
  }
  const haul = { rep: [['earth', 3], ['mars', 2]], soc: [['venus', 3], ['mercury', 2]], rim: [['jupiter', 3], ['saturn', 2]] };
  for (const sd of ['rep', 'soc', 'rim']) { const t = side[sd]; if (t > 1) continue;
    for (const [id, n] of haul[sd]) for (let i = 0; i < n; i++) { const p = near(id, rand(0, TAU), 900); const h = makeShip('hauler', t, p.x, p.y, 0); h.order = { type: 'mine', node: nearestNode(h, null, i ? 'ore' : 'he'), phase: 'go', ox: rand(-50, 50), oy: rand(-50, 50) }; } }
  if (g1) makeGroup(1, g1);
  for (const s of S.ships) if (s.order.type === 'idle') { s.order.x = s.x; s.order.y = s.y; }
  const home = S.stations[0]; S.cam.x = home.x; S.cam.y = home.y; S.cam.z = .07;
  const mine = SIDE_OF[S.fac[0]];
  toast(mine === 'rep' && side.soc < 2 ? 'The Siege of Mercury: your fleet holds off Heliopolis. Venus will try to relieve it.' : mine === 'rep' ? 'The Republic holds the Core. The ' + FACTIONS[S.fac[1]].name + ' waits beyond the Belt.'
    : mine === 'soc' ? 'The Ash Lord holds Venus and Mercury. Break the siege, or take the fight to Luna.' : 'The Moon Lords hold Jupiter and Saturn. The Pax Ilium is a lie: the Core is yours to take.', '');
  worldTick();
}
// ================================================================ a campaign battle: one world, two fleets, no economy
// B = { pf, ef, world, defTeam, withWorld, neutralFoe, wstate: { gun, shield, gov }, sides: [[rec...], [rec...]] }
// rec = a campaign ship record { t, hp, crew, ammo, rank }. Returns the spawned ships, each tagged with its record.
export function newBattle(B) {
  setupFactions(B.pf, B.ef); if (B.neutralFoe) S.teamc[1] = NEUTRAL_C;
  if (B.defs) { S.fdefs[0] = B.defs[0]; S.fdefs[1] = B.defs[1]; }
  resetWorld(); S.worlds = null; S.halt = {}; S.reserveTaken = {}; S.side = { rep: 2, soc: 2, rim: 2, neu: 2 };
  S.res = [0, 0]; S.ore = [0, 0]; S.ord = [0, 0]; S.man = [0, 0]; S.food = [0, 0]; S.buff = B.buff || [{ gun: 1 }, { gun: 1 }];
  Object.assign(S.AI, { t: 1, attacking: false });
  const w = WDEF[B.world], b = bodyOf(B.world), bi = bodyIdx(B.world), moon = b.kind === 'moon', out = { ships: [], gov: null, plats: [] };
  // the attackers come in from out of the dark; at a moon, from the far side of its planet, never through it
  const par = b.parent != null ? BODIES[b.parent] : null, ang = B.ang != null ? B.ang : par ? Math.atan2(b.y - par.y, b.x - par.x) + rand(-.7, .7) : rand(0, TAU);
  S.bzone = { x: b.x, y: b.y, r: b.r + ZONE_R, world: B.world };
  if (B.withWorld) {
    const team = B.defTeam, gR = b.r + (w.gov === 'station' ? 520 : moon ? 200 : 320);
    const g = makeShip(w.gov, team, b.x + gR, b.y, 0); g.orbit = { b: bi, R: gR, period: orbitPeriod(gR), ph: ang + .4 };
    g.gov = w.id; g.world = w.id; g.hp = g.def.hp * clamp(B.wstate.gov, .15, 1); if (w.gov !== 'station') g.marines = Math.round(g.marines * w.ground);
    out.gov = g;
    const n = B.wstate.gun + B.wstate.shield, pR = b.r + (moon ? 380 : 650); let i = 0;
    for (let k = 0; k < B.wstate.gun; k++) { const p = makeShip('gunplat', team, 0, 0, 0); p.orbit = { b: bi, R: pR, period: orbitPeriod(pR), ph: ang + i++ / n * TAU }; p.world = w.id; out.plats.push(p); }
    for (let k = 0; k < B.wstate.shield; k++) { const p = makeShip('shieldplat', team, 0, 0, 0); p.orbit = { b: bi, R: pR, period: orbitPeriod(pR), ph: ang + i++ / n * TAU }; p.world = w.id; out.plats.push(p); }
  }
  // the defenders hold close orbit; the attackers come in from out of the sun-side dark
  const spawn = (team, recs, R, face, ax = ang) => {
    const c = near(B.world, ax, R), n = recs.length, cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5))), list = [], sp = Math.max(300, ...recs.map(r => (defOf(team, r.t).r || 20) * 3.2));
    const ux = Math.cos(ax), uy = Math.sin(ax), vx = -uy, vy = ux; // rows face the world
    recs.forEach((r, i) => {
      const cx = (i % cols - (cols - 1) / 2) * sp, cy = Math.floor(i / cols) * sp;
      const s = makeShip(r.t, team, c.x + vx * cx + ux * cy + rand(-30, 30), c.y + vy * cx + uy * cy + rand(-30, 30), face);
      if (r.fit && B.fits && B.fits[r.fit]) fitShip(s, B.fits[r.fit].mul);
      if (r.crewName) { s.crewName = r.crewName; s.loy = Math.min(1, (s.loy ?? .8) + .1); } // a named crew holds when others break
      if (r.cls && B.clsSpec) { const sp = B.clsSpec(team, r.cls); if (sp) { fitShip(s, sp.mul); s.vt = sp.tags; s.clsName = sp.name; } }
      const d = s.def; s.hp = d.hp * clamp(r.hp, .05, 1); s.crew = d.crew * clamp(r.crew, .1, 1); s.marines = Math.round(s.marines * clamp(r.crew, .1, 1));
      for (const wp of s.weapons) wp.ammo = Math.round(wp.mag * clamp(wp.def.nuke ? (r.nukes ?? 1) : r.ammo, 0, 1));
      if (r.load && s.h) { s.def = { ...s.def, hangar: { ripwing: 0, starshell: 0, boarder: 0, stork: 0, ...r.load } }; s.h = { ...s.def.hangar }; } /* the hangar mix the player chose */
      if (r.hangar && s.h) s.h = Object.assign({ ripwing: 0, starshell: 0, boarder: 0, stork: 0 }, r.hangar);
      if (r.sub && s.sub) { for (const k in s.sub) { const v = r.sub[k] ?? (k === 'gunsP' || k === 'gunsS' ? r.sub.guns : null); if (v != null) s.sub[k] = clamp(v, 0, 1); } s.sh = Math.min(s.sh, shMax(s)); s.shP = s.shS = s.sh / 2; } // damage that lasts: what the yards have not yet put right
      if (!r.name && s.def.cmd && team < 2) r.name = shipName(S.fac[team]); if (r.name) s.title = r.name; s.rank = r.rank || 0; s.xp = (d.value || 100) * [0, .4, 1.2, 2.5][s.rank]; s.campRef = r; s.order = { type: 'idle', x: s.x, y: s.y };
      list.push(s);
    });
    return list;
  };
  const defT = B.defTeam, attT = 1 - defT;
  // in deep space: the intercepted fleet in travel column on its course; the interceptors ahead of it, or close on its flank
  const sp = B.space;
  const dl = sp ? spawn(defT, B.sides[defT], 0, sp.head, sp.head + PI) : spawn(defT, B.sides[defT], B.defR || 2400, ang + PI), al = spawn(attT, B.sides[attT], sp ? (sp.kind === 'ambush' ? 50000 : 110000) : B.attR || ATT_R, ang + PI);
  if (sp && sp.kind === 'ambush') for (const s of dl) s.sh = (s.def.shield || 0) * .5; // caught on the march, shields half up
  out.ships = dl.concat(al);
  for (const s of out.ships) s.vis = [true, true, true];
  // the campaign's commanders come aboard their flagships
  S.cmdrs = []; out.tac = [];
  for (const K of (B.cmdrs || [])) {
    const L = out.ships.filter(s => K.recs.includes(s.campRef) && s.def.cmd).sort((a, b) => (b.def.value || 0) - (a.def.value || 0)); if (!L.length) continue;
    const t = { id: 100 + S.cmdrs.length, team: L[0].team, name: K.c.name, caste: K.c.colour, title: K.c.title, traits: (K.talents || K.c.talents).filter(x => ['helm', 'gunnery', 'discipline', 'breacher', 'inspiring', 'peerless'].includes(x)), state: 'aboard', ship: L[0], renown: 0, rank: Math.min(3, K.c.rank), timer: 0, kills: 0, heldBy: null, camp: K.c };
    S.cmdrs.push(t); L[0].cmdr = t; out.tac.push(t);
  }
  // one battle group per campaign fleet, under the fleet's own name
  let gn = 1; for (const G of (B.groups || [])) { const L = out.ships.filter(s => s.team === 0 && !s.def.fighter && G.recs.includes(s.campRef)); if (!L.length) continue; const g = makeGroup(gn, L); if (g) { g.name = G.name; g.stance = 'defensive'; } gn++; }
  // the world's platforms and authority start on their orbits, not at the origin, even while the battle opens paused
  for (const o of S.ships) if (o.orbit) { const ob = o.orbit, bb = BODIES[ob.b], w = TAU / ob.period, ph = ob.ph + S.time * w; o.x = bb.x + Math.cos(ph) * ob.R; o.y = bb.y + Math.sin(ph) * ob.R; }
  // frame the whole battle: both fleets and the world
  let x0 = b.x, x1 = b.x, y0 = b.y, y1 = b.y; for (const s of out.ships) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
  S.cam.x = (x0 + x1) / 2; S.cam.y = (y0 + y1) / 2; S.cam.z = clamp(Math.min(S.W / ((x1 - x0) * 1.35 + 2000), S.H / ((y1 - y0) * 1.6 + 2000)), .0035, .09);
  return out;
}
// the battlefield: a zone around the world; a fleet that runs past its edge has left the battle
export const ZONE_R = 160000, ATT_R = 100000; // the battlefield's edge, and how far off the world the attackers come in
// names for capital hulls that have none yet: they keep them for the rest of the war
const SHIPNAMES = {
  rising: ['Defiance', 'Lykos', 'Eo', 'Ares', 'Vindicator', 'Broken Chain', 'Free Legion', 'Persephone', 'Hyperion', 'Liberty', 'Red Dawn', 'Howler', 'Tinos', 'Hope of Mars', 'Valiant', 'Sentinel', 'Iron Will', 'Phobos Rising', 'Starlight', 'Gift of the Vale'],
  core: ['Imperator', 'Dominus', 'Aquila', 'Gorgon', 'Praetor', 'Lux Aeterna', 'Vigilant', 'Ash Crown', 'Golden Eagle', 'Dictator', 'Venus Triumphant', 'Scorpio', 'Lupus', 'Conqueror', 'Pax Aurea', 'Hesperus', 'Ultimatum', 'Sovereign Will', 'Tyche', 'Carthago'],
  rim: ['Dustwalker', 'Sungrave', 'Garter', 'Storm Herald', 'Ilium', 'Moonfire', 'Saturn’s Shield', 'Io Ascendant', 'Callisto Watch', 'Galatea', 'Tritonis', 'Lantern of Raa', 'Pale Rider', 'Europa Deep', 'Long Night', 'Silent Moon', 'Ring Warden', 'Icewind', 'Lux Eterna', 'Far Ink'] };
const usedNames = new Set();
export function shipName(fk) { const L = SHIPNAMES[fk] || SHIPNAMES.core; for (let i = 0; i < 40; i++) { const n = L[Math.floor(Math.random() * L.length)] + (i > 18 ? ' ' + ['II', 'III', 'IV'][i % 3] : ''); if (!usedNames.has(n)) { usedNames.add(n); return n; } } return L[0] + ' ' + Math.floor(Math.random() * 90 + 10); }
// move one side's whole fleet to a new place before the battle starts, keeping its formation
export function relocate(team, x, y, face, list) {
  const L = (list || S.ships).filter(s => s.team === team && !s.def.static && !s.dead); if (!L.length) return;
  const cx = L.reduce((a, s) => a + s.x, 0) / L.length, cy = L.reduce((a, s) => a + s.y, 0) / L.length;
  for (const s of L) { s.x = x + (s.x - cx); s.y = y + (s.y - cy); s.vx = s.vy = 0; s.a = face; for (const w of s.weapons) w.ang = face + w.dir; if (!s.group || s === s.group.flag) s.order = { type: 'idle', x: s.x, y: s.y }; }
  for (const g of groupList()) if (g.flag && g.flag.team === team) g.hdg = face;
}
// a campaign refit: the ship gets its own copy of its design
function fitShip(s, m) {
  const d = s.def = { ...s.def }; if (m.hp) d.hp = Math.round(d.hp * m.hp); if (m.shield) { d.shield = Math.round(d.shield * m.shield); s.sh = d.shield; }
  if (m.thrust) d.thrust *= m.thrust; if (m.turn) d.turn *= m.turn; if (m.gun) s.gunMul = m.gun; if (m.mar) s.marines = Math.round(s.marines * m.mar);
  if ((m.hangar || m.hmix) && s.h) { d.hangar = { ...d.hangar }; for (const k in s.h) { const x = (m.hangar || 1) * ((m.hmix && m.hmix[k]) || 1); s.h[k] = Math.round(s.h[k] * x); if (d.hangar[k] != null) d.hangar[k] = Math.round(d.hangar[k] * x); } }
  if (m.sig) d.sigMul = (d.sigMul || 1) * m.sig;
  for (const w of s.weapons) { // a class's main battery and point-defence fittings: how fast those mounts cycle, and how much they carry
    if (w.def.kind === 'missile' && !w.def.nuke) { if (m.missile) w.km = (w.km || 1) * m.missile; if (m.misMag) w.mag = Math.round(w.mag * m.misMag); }
    if (w.def.pd && m.pd) w.km = (w.km || 1) * m.pd;
  }
}
export function attract() {
  setupFactions('rising', 'core'); setupBodies(); resetWorld(); S.res = [0, 0]; S.ore = [0, 0]; S.ord = [0, 0]; S.man = [0, 0]; S.worlds = null;
  const m = bodyOf('mars');
  const fleet = (t, ox, oy, a) => {
    const sx = m.x + ox, sy = m.y + oy, tx = m.x - ox * .8, ty = m.y - oy * .8;
    for (let i = 0; i < 8; i++) makeShip('ripwing', t, sx + rand(-300, 300), sy + rand(-300, 300), a);
    for (let i = 0; i < 3; i++) makeShip(i ? 'frigate' : 'corvette', t, sx + rand(-300, 300), sy + rand(-300, 300), a);
    makeShip('destroyer', t, sx - 200, sy + 200, a); makeShip('torch', t, sx + 250, sy - 250, a);
    for (const s of S.ships) if (s.team === t) s.order = { type: 'amove', x: tx, y: ty };
  };
  fleet(0, -2300, 1600, 0); fleet(1, 2300, -1600, PI);
  for (const s of S.ships) s.vis = [true, true, true];
  // the title screen's key art: Mars and the fight over it, on the right of the screen beside the menu
  S.cam.z = .2; S.cam.x = m.x - (S.W || 1600) * .2 / S.cam.z; S.cam.y = m.y;
}

// ================================================================ worlds: who holds what, and what it pays
// what a world actually pays a team, per second of base output (the UI shows the same number)
export function worldMul(id, t) {
  let k = t === 1 ? DIFF[S.difficulty].inc : 1; const f = S.fac[t];
  if (id === 'luna') k *= .8;                                   // the Syndicate
  if (id === 'venus' && f !== 'core') k *= .5;                  // loyalist Golds
  if (id === 'earth' && f !== 'core') k *= .75;                 // New Sparta
  if (id === 'mercury' && S.time < 300) k *= .75;               // the long siege
  if (id === 'europa') k *= .9;                                 // storms and leviathans
  if (id === 'triton' && f !== 'rising') k *= .75;              // Sons of Ares cells
  if (id === 'pluto' || id === 'charon') k *= .7;               // the Shamed
  if (FREEHOLD.has(id)) k *= .8;                                // freeholders, clans and raider country: they pay any master grudgingly
  if (id === 'dione' && f !== 'rim') k *= .8;                   // Dione's old houses
  if (f === 'rim' && WDEF[id] && WDEF[id].side === 'rim') {      // the Rim's pantry and its heart
    if (worldOwner('io') !== t) k *= .75; if (worldOwner('ganymede') !== t) k *= .85;
  }
  if (S.halt && S.halt[id] > S.time) k = 0;                     // dust storms, the Red Hand, quakes
  return k;
}
export const worldUnderAttack = id => { const w = S.worlds && S.worlds[id]; if (!w) return false; const tm = w.owner >= 0 ? w.owner : 2; return S.ships.some(s => s.world === id && s.team === tm && !s.dead && S.time - s.lastHit < 6); };
export const worldOwner = id => S.worlds && S.worlds[id] ? S.worlds[id].owner : -1;
// owner: 0 or 1 for the teams, -2 for an armed neutral garrison, -1 when nobody holds it (its authority is a derelict)
function worldTick() {
  if (!S.worlds) return;
  const food = [0, 0], man = [0, 0], he = [0, 0], buff = [{ gun: 1 }, { gun: 1 }];
  for (const w of WORLDS) {
    const st = S.worlds[w.id], g = st.gov; let t = g.dead || g.derelict ? -1 : g.team > 1 ? -2 : g.team;
    if (t !== st.owner) {
      const prev = st.owner; st.owner = t; const nm = bodyOf(w.id).name;
      const bp = bodyOf(w.id); if (t === 0) { toast(nm + ' is ours', 'good', bp, true); sfx('built'); } else if (prev === 0) { toast(nm + (t < 0 ? ' has gone dark: no one holds it' : ' has fallen to the ' + FACTIONS[S.fac[t]].name), 'bad', bp, true); sfx('alarm'); }
      else if (t === 1) toast('The ' + FACTIONS[S.fac[1]].name + ' take ' + nm, 'bad', bodyOf(w.id));
      // a stockpile goes to whoever first takes it from its builders
      if (t >= 0 && g.reserve && !S.reserveTaken[w.id] && st.home !== t) { S.reserveTaken[w.id] = 1; S.res[t] += g.reserve; if (t === 0) toast('The ' + nm + ' He-3 stockpile is ours: +' + g.reserve.toLocaleString() + ' He-3', 'good', bp); }
    }
    if (t < 0) continue;
    const k = PROD_K * worldMul(w.id, t);
    if (!(w.id === 'titan' && S.halt.titanFood > S.time)) food[t] += w.prod.food;
    he[t] += w.prod.he * k; S.ore[t] += w.prod.ore * k; S.ord[t] += w.prod.ord * k; man[t] += w.prod.man * k;
    logProd(t, 'ore', w.prod.ore * k); logProd(t, 'ord', w.prod.ord * k);
    if (w.id === 'mercury') buff[t].gun *= 1.1;                     // Tyche Central Command
    if ((w.id === 'ceres' || w.id === 'enceladus') && !buff[t].inst) { buff[t].inst = 1; buff[t].gun *= 1.05; } // the Institute
    if (w.id === 'rhea' && S.fac[t] === 'rim') buff[t].gun *= 1.05; // A Memory of Ash
  }
  for (let t = 0; t < 2; t++) {
    const h = he[t] * (worldOwner('europa') === t ? 1.1 : 1); S.res[t] += h; logProd(t, 'he', h);              // Europa's banks
    const m = man[t] * (food[t] < 0 ? .6 : 1); S.man[t] += m; logProd(t, 'man', m);
  }
  if (S.food && S.food[0] >= 0 && food[0] < 0) toast('Famine: your worlds cannot feed themselves. Recruitment falls 40%', 'bad');
  S.food = food; S.buff = buff;
  // Jupiter's radiation, unless your side holds Io's pulse fields or your crews are Rim-born
  const jup = bodyOf('jupiter'), io = worldOwner('io');
  if (jup) for (const s of S.ships) if (s.team < 2 && !s.def.static && s.def.crew > 2 && io !== s.team && S.fac[s.team] !== 'rim' && hyp(s.x - jup.x, s.y - jup.y) < 1.3e6) { s.crew *= .998; if (s.team === 0 && S.time - (S.radT || -99) > 30) { S.radT = S.time; toast('Jupiter’s radiation is thinning your crews · take Io to shield them', 'bad', s); } }
  // new enemy sightings, gathered by the world they're nearest
  if (S.newContacts && S.newContacts.length) {
    const by = {}; for (const c of S.newContacts) { if (c.dead) continue; let nb = null, nd = 1e18; for (const b of BODIES) { const d = hyp(c.x - b.x, c.y - b.y); if (d < nd) { nd = d; nb = b; } } (by[nb.id] = by[nb.id] || { b: nb, ships: [] }).ships.push(c); }
    S.contactT = S.contactT || {};
    for (const k in by) { const { b, ships } = by[k]; if (S.time - (S.contactT[k] || -99) < 20) continue; S.contactT[k] = S.time; const cx = ships.reduce((a, c) => a + c.x, 0) / ships.length, cy = ships.reduce((a, c) => a + c.y, 0) / ships.length; toast('Contact: ' + ships.length + ' ' + FACTIONS[S.fac[1]].name + ' ship' + (ships.length > 1 ? 's' : '') + ' near ' + b.name, 'bad', { x: cx, y: cy }); }
    S.newContacts = [];
  }
  const venY = S.venusYard; if (venY && !S.reserveTaken.venus && !venY.dead && venY.team < 2 && venY.team !== S.side.soc) { S.reserveTaken.venus = 1; S.res[venY.team] += venY.reserve; if (venY.team === 0) toast('The Imperial He-3 reserve is ours: +3,000 He-3', 'good', venY); }
  // world events: Mars dust storms and the Red Hand, Titan's harvests, Triton's quakes
  const H = S.halt, ev = (id, p, fn) => { const o = worldOwner(id); if (o >= 0 && Math.random() < p) fn(o); };
  ev('mars', 1 / 240, o => { H.mars = Math.max(H.mars || 0, S.time + 40); if (o === 0) toast('Dust storms on Mars: no output for 40 seconds', 'bad', bodyOf('mars')); });
  ev('mars', 1 / 300, o => { const g = S.worlds.mars.gov; g.hp = Math.max(g.def.hp * .1, g.hp - g.def.hp * .08); H.mars = Math.max(H.mars || 0, S.time + 20); if (o === 0) toast('The Red Hand strikes the Mars dockyard', 'bad', g); });
  ev('titan', 1 / 420, o => { H.titanFood = S.time + 60; if (o === 0) toast('Titan’s harvest fails: no food from Titan for a minute', 'bad', bodyOf('titan')); });
  ev('triton', 1 / 480, o => { H.triton = S.time + 30; if (o === 0) toast('Quakes on Triton stop its output for 30 seconds', 'bad', bodyOf('triton')); });
}

// ================================================================ flight control
const G = { ax: 0, ay: 0, face: null };
function finish(s, ax, ay) {
  const gv = grav(s.x, s.y); ax -= gv.x; ay -= gv.y; s.gcomp = hyp(gv.x, gv.y); // holding against gravity is orbit-keeping: free
  const T = s.def.thrust * Math.max(s.hf, .2) * (s.transit || 1);
  for (const b of BODIES) {
    const dx = s.x - b.x, dy = s.y - b.y, d = hyp(dx, dy); const m = b.r + s.r + 260;
    const vin = Math.max(0, -((s.vx - b.vx) * dx + (s.vy - b.vy) * dy) / (d || 1)), zone = Math.max(320, Math.min(b.r * .25, 1500), vin * vin / Math.max(8, T * .7)); // start braking early enough to stop
    if (d < m + zone) {
      const k = (m + zone - d) / zone; ax += dx / d * T * 1.6 * k; ay += dy / d * T * 1.6 * k;
      const vr = ((s.vx - b.vx) * dx + (s.vy - b.vy) * dy) / d; if (vr < 0) { ax -= dx / d * vr * 1.5; ay -= dy / d * vr * 1.5; }
    }
  }
  rocksNear(s.x, s.y, s.r + 200, k => {
    const dx = s.x - k.x, dy = s.y - k.y, d = hyp(dx, dy) || 1, m = k.r + s.r + 70;
    if (d < m + 110) { const f = (m + 110 - d) / 110; ax += dx / d * T * 1.3 * f; ay += dy / d * T * 1.3 * f; const vr = ((s.vx - (k.vx || 0)) * dx + (s.vy - (k.vy || 0)) * dy) / d; if (vr < 0) { ax -= dx / d * vr; ay -= dy / d * vr; } }
  });
  if (!s.def.fighter && !s.def.shell || s.order.type === 'idle' || s.order.type === 'move' || s.order.type === 'guard') {
    query(s.x, s.y, s.r + 60, o => {
      if (o === s || o.team !== s.team || o.docked) return;
      const dx = s.x - o.x, dy = s.y - o.y, d = hyp(dx, dy) || 1; const m = s.r + o.r + 26;
      if (d < m) { const k = (m - d) / m * T * .9; ax += dx / d * k; ay += dy / d * k; }
    });
  }
  // warships steer clear of enemy hulls on a collision course: a fleet passes through another, it does not plough into it
  if (!s.def.fighter && !s.def.shell && !s.def.boarder && s.order.type !== 'board') {
    query(s.x, s.y, s.r + 700, o => {
      if (o === s || o.team === s.team || o.docked || o.dead || o.def.fighter || o.def.shell || o.def.boarder) return;
      const px = s.x - o.x, py = s.y - o.y, vx = s.vx - o.vx, vy = s.vy - o.vy, v2 = vx * vx + vy * vy || 1e-6;
      const tc = clamp(-(px * vx + py * vy) / v2, 0, 2.6), mx = px + vx * tc, my = py + vy * tc, md = hyp(mx, my) || 1, m = s.r + o.r + 50;
      if (md < m) { const k = (1 - md / m) * T * 1.4; ax += mx / md * k; ay += my / md * k; }
    });
  }
  G.ax = ax; G.ay = ay;
}
// Transit burn: far from its destination and not fighting, a ship opens the throttle and crosses
// interplanetary space. Top speed and thrust scale with the length of the trip, so any crossing takes
// a minute or two. The burn holds until the ship is nearly there and has shed the speed.
export const TRANSIT = { dist: 15000, minSpeed: 16, rise: 12, fuel: 1.5 };
// trip time grows with the log of the distance: about 1½ minutes Earth to Mars, 3 to Jupiter, 4½ to Neptune
const tripTime = d => clamp(35 + 22 * Math.log2(Math.max(1, d / 150000)), 40, 320);
function arrive(s, tx, ty, tvx, tvy, cruise) {
  let dx = tx - s.x, dy = ty - s.y, d = hyp(dx, dy) || 1e-6;
  const rv = hyp(s.vx - tvx, s.vy - tvy), base = (cruise || s.def.cruise) * (s.burnT > S.time ? 1.8 : 1);
  if (s.engage || s.def.static || s.noTransit || S.mode === 'battle') s.tOn = false; /* a battle is fought on the drive: no transit burns across the field */
  else if (d > TRANSIT.dist && (!s.tOn || hyp(tx - s.tTx, ty - s.tTy) > 20000)) { // plan the burn for this trip
    s.tOn = true; s.tTx = tx; s.tTy = ty; s.tCap = Math.max(base * TRANSIT.minSpeed, d / tripTime(d)); s.tMul = Math.max(5, s.tCap / TRANSIT.rise / s.def.thrust);
  } else if (d < 2500 && rv < base * 1.3) s.tOn = false;
  s.transit = s.tOn || (!s.engage && rv > base * 1.3 && s.order.type !== 'attack') ? (s.tMul || 5) : 0;
  // a destination inside a world is moved out to a safe shell above its surface
  if (!s.def.static) for (const b of BODIES) { const ox = tx - b.x, oy = ty - b.y, od = hyp(ox, oy), safe = b.r + s.r + 260; if (od < safe) { const k = safe / (od || 1); tx = b.x + (od ? ox * k : safe); ty = b.y + (od ? oy * k : 0); dx = tx - s.x; dy = ty - s.y; d = hyp(dx, dy) || 1e-6; } }
  if (!s.def.static && d > 300) { // never fly through a planet: steer for a point beside it
    for (const b of BODIES) {
      const near = hyp(s.x - b.x, s.y - b.y) < b.r * 1.2 + 2500, atTarget = hyp(tx - b.x, ty - b.y) < b.r * 1.2 + 2500;
      if (!s.tOn && !near && !atTarget) continue;
      const clear = near || atTarget ? b.r * 1.04 + s.r + 120 : b.r * 1.25 + 900;
      if (hyp(tx - b.x, ty - b.y) < clear) continue; // the target itself is inside the margin: let the normal push-off handle it
      if (segHit(s.x, s.y, tx, ty, b.x, b.y, clear) >= 0) {
        if (near || atTarget) { const ax = s.x - b.x, ay = s.y - b.y, al = hyp(ax, ay) || 1, sg = (ax * (ty - b.y) - ay * (tx - b.x)) > 0 ? 1 : -1, R = Math.max(al, b.r * 1.1 + s.r + 500); const ang = Math.atan2(ay, ax) + sg * .5; tx = b.x + Math.cos(ang) * R; ty = b.y + Math.sin(ang) * R; dx = tx - s.x; dy = ty - s.y; d = hyp(dx, dy) || 1e-6; break; } const nx = -(b.y - s.y), ny = b.x - s.x, nl = hyp(nx, ny) || 1, sg = (nx * dx + ny * dy) >= 0 ? 1 : -1; tx = b.x + nx / nl * sg * (b.r * 1.5 + 2600); ty = b.y + ny / nl * sg * (b.r * 1.5 + 2600); dx = tx - s.x; dy = ty - s.y; d = hyp(dx, dy) || 1e-6; break; }
    }
  }
  const tm = s.transit || 1;
  const a = Math.max(4, s.def.thrust * s.hf * .7 * tm), tf = PI / Math.max(.05, s.def.turn * Math.max(s.hf, .2)) * .75;
  let v = a * (-tf + Math.sqrt(tf * tf + 2 * Math.max(0, d - 4) / a));
  v = Math.min(v, s.tOn ? s.tCap : base);
  G.face = null;
  finish(s, (tvx + dx / d * v - s.vx) * 1.6, (tvy + dy / d * v - s.vy) * 1.6);
}
function turnTo(s, h, dt) {
  const tr = s.def.turn * Math.max(s.hf, .15) * turnK(s); const err = angDiff(s.a, h); const acc = tr * 2.2;
  const want = Math.sign(err) * Math.min(tr, Math.sqrt(2 * acc * Math.abs(err)));
  s.av += clamp(want - s.av, -acc * dt, acc * dt);
}
// braced, a ship turns slowly; burning flat out, she can barely turn; locked on, she all but holds her heading
const turnK = s => (s.braceT > S.time ? .3 : 1) * (s.burnT > S.time ? .4 : 1) * (s.lockT > S.time ? .15 : 1);
function applyThrust(s, dt) {
  const d = s.def, tm = s.transit || 1, T = d.thrust * s.hf * tm * (s.lockT > S.time ? .35 : 1); let ax = G.ax, ay = G.ay; let mag = hyp(ax, ay);
  if (mag > T * 1.15) { ax *= T * 1.15 / mag; ay *= T * 1.15 / mag; mag = T * 1.15; }
  let h;
  if (G.face != null && (d.fighter || d.shell || mag < T * .35)) h = G.face;
  else if (mag > T * .06) h = Math.atan2(ay, ax);
  else h = G.face != null ? G.face : s.a;
  turnTo(s, h, dt);
  const cx = Math.cos(s.a), cy = Math.sin(s.a);
  const main = clamp(ax * cx + ay * cy, 0, T);
  let rx = ax - cx * main, ry = ay - cy * main; const rm = hyp(rx, ry), rmax = T * d.rcs;
  if (rm > rmax) { rx *= rmax / rm; ry *= rmax / rm; }
  s.vx += (cx * main + rx) * dt; s.vy += (cy * main + ry) * dt;
  s.throttle += (main / d.thrust - s.throttle) * Math.min(1, dt * 10);
  s.rx = rx; s.ry = ry;
  // He-3 burn: main drive at full uses the tank in d.burn seconds; thrusters cost half as much
  s.fuel = Math.max(0, s.fuel - (Math.max(0, main - (s.gcomp || 0)) + .5 * hyp(rx, ry)) / (d.thrust * tm) * (tm > 1 ? TRANSIT.fuel : 1) * (s.burnT > S.time ? 2.5 : 1) * dt / (d.burn || 150));
  if (s.team === 0 && !s.fuelTold && s.fuel < .15 && !d.fighter && !d.shell) { s.fuelTold = true; toast(d.name + ' is low on He-3 · press R to refuel', 'bad', s); }
  if (s.fuel > .5) s.fuelTold = false;
}
// how much a broadside has to give: its gun decks, the rounds in its batteries, and the shield half over it
function sideScore(s, side) {
  let a = 0, n = 0; for (const w of s.weapons) if (w.def.battery && Math.sign(w.oy) === side) { a += w.ammo / w.mag; n++; }
  const sh = s.def.shield ? (side > 0 ? s.shS : s.shP) / Math.max(1, shMax(s) / 2) : 1;
  return (side > 0 ? s.gS : s.gP) * (n ? .15 + .85 * a / n : 1) * (.6 + .4 * Math.min(1, sh));
}
function broadsideFace(s, t) {
  const toT = Math.atan2(t.y - s.y, t.x - s.x), helm = helmOf(s);
  if (helm === 'bow') return toT;
  if (helm === 'port') return toT + PI / 2;
  if (helm === 'stbd') return toT - PI / 2;
  // swing the bow on for a lance shot only when it is nearly on already (a slow capital ship that chases both ends
  // keeps turning and never brings either to bear); otherwise the nearer broadside, unless the other is much the healthier
  const off = Math.abs(angDiff(s.a, toT)), near = Math.max(.6, s.def.turn * 2);
  if (off < near && s.weapons.some(w => w.def.bow && w.ammo > 0 && (w.cd < 1.2 || w.chg))) return toT;
  // the auto helm decides only every few seconds, and swaps to the other broadside only when this one is badly hurt:
  // a captain told which side to show (port or starboard) does better than one left to it
  if (S.time > (s.scT || 0) || s.autoSide == null) { s.scT = S.time + 4; s.scP = sideScore(s, -1); s.scS = sideScore(s, 1);
    let side = angDiff(s.a, toT) > 0 ? 1 : -1; const mine = side > 0 ? s.scS : s.scP, other = side > 0 ? s.scP : s.scS;
    if (other > mine * 1.8 + .1) side = -side; s.autoSide = side; }
  return s.autoSide > 0 ? toT - PI / 2 : toT + PI / 2;
}
const mainReach = s => s.weapons.reduce((a, w) => w.def.nuke || w.def.pd ? a : Math.max(a, effR(w.def)), 0);
// how far a ship looks for a fight: a little past her guns' effective reach (fighters and boarders look close)
const acq = s => s.def.fighter ? 1400 : s.def.boarder ? 1600 : Math.max(1800, mainReach(s) * 1.15);

// ================================================================ behaviour
export function nearestEnemy(s, x, y, R, preferSmall) {
  let best = null, bs = 1e18; const ot = s.order.type === 'attack' ? s.order.t : null;
  query(x, y, R, o => {
    if (!hostileTo(s, o, ot) || o.docked || !o.vis[s.team]) return;
    const d2 = (o.x - x) ** 2 + (o.y - y) ** 2; if (d2 > R * R) return;
    let sc = d2; if (preferSmall && !(o.def.fighter || o.def.boarder)) sc *= 2.2; if (o.def.static) sc *= 1.6; if (o.derelict) sc *= 4;
    if (sc < bs) { bs = sc; best = o; }
  });
  return best;
}
export const bigHull = o => !!o && (o.def.static || (o.def.len || 0) >= 3000); /* dreadnoughts, moonBreakers and stations */
// a ripWing with its nuke still aboard goes for a capital ship; one that has spent it hunts the enemy's fighters
const bombLeft = s => s.weapons.some(w => w.def.breach && w.ammo > 0);
const fighterPick = (s, x, y, R) => { if (bombLeft(s)) { let best = null, bd = 1e18; query(x, y, R * 2.6, o => { if (!hostileTo(s, o, null) || o.docked || !o.vis[s.team] || !bigHull(o) || o.def.static) return; const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } }); if (best) return best; } return nearestEnemy(s, x, y, R, true); };
const orderTarget = s => s.order.type === 'attack' ? s.order.t : (s.engage && !s.engage.dead ? s.engage : null);
export function setIdle(s, x, y, face) { s.order = { type: 'idle', x: x ?? s.x, y: y ?? s.y, face }; s.engage = null; }
// an order is done: the next queued one, or hold station there (facing the way the player dragged, if he did)
function orderDone(s, o, x, y) { if (o.next) { s.order = o.next; s.engage = null; if (s.group && s.group.flag === s) s.group.hdg = Math.atan2(s.order.y - s.y, s.order.x - s.x) || s.group.hdg; } else setIdle(s, x, y, o.face); }
const carrierOk = s => s.carrier && !s.carrier.dead && s.carrier.team === s.team && !disabled(s.carrier);

function think(s, dt) {
  const o = s.order; s.thinkT -= dt;
  const friendlyOrder = o.type === 'follow' || o.type === 'guard' || o.type === 'dock';
  if ((o.type === 'attack' || o.type === 'board' || o.type === 'salvage' || friendlyOrder) && (!o.t || o.t.dead || (friendlyOrder ? o.t.team !== s.team : o.t.team === s.team))) { orderDone(s, o); return think(s, dt); }
  if (s.freezeT > S.time && s.team < 2 && o.type !== 'move') { G.face = null; arrive(s, s.x + s.vx * .5, s.y + s.vy * .5, 0, 0); return; } // the flagship is gone: Society captains wait for orders
  if (s.engage && (s.engage.dead || s.engage.team === s.team || s.engage.surrendered)) s.engage = null;
  if (o.type === 'rearm' && (s.def.fighter || s.def.shell) && carrierOk(s)) { s.order = { type: 'dock', t: s.carrier }; return think(s, dt); }
  switch (o.type) {
    case 'idle': {
      if (s.group && !s.detached && s.group.flag && s.group.flag !== s && !s.group.flag.dead) { s.order = { type: 'form', g: s.group }; return think(s, dt); }
      if (s.def.shell && carrierOk(s) && s.thinkT <= 0) { s.order = { type: 'dock', t: s.carrier }; return think(s, dt); }
      if (s.def.fighter) {
        if (s.thinkT <= 0) { s.thinkT = .5; if (!s.engage || hyp(s.engage.x - o.x, s.engage.y - o.y) > (bombLeft(s) ? 4500 : 1900) || (bombLeft(s) && !bigHull(s.engage))) s.engage = fighterPick(s, o.x, o.y, 1300); }
        if (s.engage) return fighterAttack(s, s.engage, dt);
      }
      arrive(s, o.x, o.y, 0, 0);
      if (o.face != null) { G.face = o.face; return; }
      if (s.def.broadside) { if (s.thinkT <= 0) { s.thinkT = .5; s.aware = nearestEnemy(s, s.x, s.y, acq(s), false); } if (s.aware && !s.aware.dead) G.face = broadsideFace(s, s.aware); }
      return;
    }
    case 'brake': {
      if (hyp(s.vx, s.vy) < 6) { setIdle(s); return arrive(s, s.x, s.y, 0, 0); }
      G.face = null; s.transit = hyp(s.vx, s.vy) > s.def.cruise * 1.3 ? Math.max(5, hyp(s.vx, s.vy) / TRANSIT.rise / s.def.thrust) : 0; return finish(s, -s.vx * 2, -s.vy * 2);
    }
    case 'move': {
      const d = hyp(o.x - s.x, o.y - s.y);
      if (d < 30 + s.r * .5 && hyp(s.vx, s.vy) < 25) orderDone(s, o, o.x, o.y);
      else if (o.next && d < 140 + s.r) orderDone(s, o, o.x, o.y); // a waypoint on the way: no need to stop at it
      arrive(s, o.x, o.y, 0, 0, o.cruise);
      if (o.face != null && d < 400 + s.r) G.face = o.face;
      return;
    }
    case 'form': return formThink(s, o.g, dt);
    case 'amove': {
      if (s.thinkT <= 0) { s.thinkT = .5; if (!s.engage || dist(s, s.engage) > acq(s) * 1.45) s.engage = (s.type === 'hauler' || s.type === 'tender' || s.type === 'scout') ? null : nearestEnemy(s, s.x, s.y, acq(s), s.def.fighter); }
      if (s.engage) return combat(s, s.engage, dt);
      const d = hyp(o.x - s.x, o.y - s.y);
      if (d < 60 + s.r && hyp(s.vx, s.vy) < 25) orderDone(s, o, o.x, o.y);
      else if (o.next && d < 140 + s.r) orderDone(s, o, o.x, o.y);
      arrive(s, o.x, o.y, 0, 0, o.cruise);
      if (o.face != null && d < 400 + s.r) G.face = o.face;
      return;
    }
    case 'attack': return combat(s, o.t, dt);
    case 'line': { // the line of battle: hold the place on the axis, broadside to the enemy
      arrive(s, o.x, o.y, 0, 0, s.group ? s.group.cruise : undefined);
      if (s.thinkT <= 0) { s.thinkT = .5; s.aware = nearestEnemy(s, s.x, s.y, acq(s) * 1.2, false); }
      if (s.aware && !s.aware.dead) G.face = s.def.broadside ? broadsideFace(s, s.aware) : Math.atan2(s.aware.y - s.y, s.aware.x - s.x);
      else G.face = Math.atan2(o.ey - s.y, o.ex - s.x);
      return;
    }
    case 'board': return boardRun(s, o.t, dt);
    case 'mine': return mineRun(s, o, dt);
    case 'salvage': return salvageRun(s, o, dt);
    case 'follow': { const t = o.t, ca = Math.cos(t.a), sa = Math.sin(t.a); return arrive(s, t.x + ca * o.ox - sa * o.oy, t.y + sa * o.ox + ca * o.oy, t.vx, t.vy); }
    case 'guard': {
      const t = o.t;
      if (s.thinkT <= 0) { s.thinkT = .5; if (!s.engage || dist(t, s.engage) > (bombLeft(s) ? 4500 : 2200)) s.engage = fighterPick(s, t.x, t.y, 1700); }
      if (s.engage) return fighterAttack(s, s.engage, dt);
      const ca = Math.cos(t.a), sa = Math.sin(t.a);
      return arrive(s, t.x + ca * o.ox - sa * o.oy, t.y + sa * o.ox + ca * o.oy, t.vx, t.vy);
    }
    case 'dock': {
      const t = o.t; arrive(s, t.x, t.y, t.vx, t.vy, s.def.cruise);
      if (dist(s, t) < t.r * .9 + s.r + 16) dockInto(s, t);
      return;
    }
    case 'rearm': {
      const st = (o.st && !o.st.dead && o.st.team === s.team) ? o.st : (o.st = nearestDepot(s));
      if (!st) { setIdle(s); return arrive(s, s.x, s.y, 0, 0); }
      const R = st.r + s.r + 140 + (s.id % 5) * 45; const a = o.a ?? (o.a = Math.atan2(s.y - st.y, s.x - st.x));
      const tx = st.x + Math.cos(a) * R, ty = st.y + Math.sin(a) * R;
      if (s.depot === st && !needsService(s, !!st.def.fullService)) { setIdle(s, tx, ty); if (s.team === 0 && !o.quiet) toast(s.def.name + ' rearmed and refuelled at the ' + st.def.name, 'good', s); }
      return arrive(s, tx, ty, st.vx, st.vy);
    }
  }
  return arrive(s, s.x, s.y, 0, 0);
}
function combat(s, t, dt) {
  if (s.def.fighter) return fighterAttack(s, t, dt);
  if (s.def.boarder) { if (isCapital(t)) return boardRun(s, t, dt); if (s.def.shell) return fighterAttack(s, t, dt); return arrive(s, t.x + (s.x - t.x) * .5, t.y + (s.y - t.y) * .5, t.vx, t.vy); }
  if (!s.weapons.length || (mainAmmo(s) <= 0 && !s.weapons.some(w => w.def.pd && w.ammo > 0))) return arrive(s, s.x, s.y, 0, 0);
  const R = Math.max(helmOf(s) === 'range' ? mainReach(s) * .88 : s.def.pref || 400, t.r + s.r + 60) * (s.group && s.group.stance === 'evasive' ? 1.4 : 1);
  // from astern: swing wide of her broadsides and sit on her stern, where the engines are, and stay there as she turns
  if (s.order.stern && s.order.t === t) {
    const bx = -Math.cos(t.a), by = -Math.sin(t.a), px = t.x + bx * R, py = t.y + by * R, rx = s.x - t.x, ry = s.y - t.y, ahead = rx * -bx + ry * -by;
    // still forward of her beam: go round, not through her broadside
    const side = (rx * -by + ry * bx) >= 0 ? 1 : -1, wide = Math.max(R * 1.6, t.r * 3 + 900);
    const wx = ahead > -R * .3 ? t.x + (-by * side) * wide + bx * R * .6 : px, wy = ahead > -R * .3 ? t.y + (bx * side) * wide + by * R * .6 : py;
    arrive(s, wx, wy, t.vx, t.vy); G.face = s.def.broadside ? broadsideFace(s, t) : Math.atan2(t.y - s.y, t.x - s.x); return;
  }
  const dx = s.x - t.x, dy = s.y - t.y, d = hyp(dx, dy) || 1;
  const sw = ((s.id % 2) ? 1 : -1) * .18;
  const ux = dx / d, uy = dy / d;
  arrive(s, t.x + (ux * Math.cos(sw) - uy * Math.sin(sw)) * R, t.y + (ux * Math.sin(sw) + uy * Math.cos(sw)) * R, t.vx * .9, t.vy * .9); // match most of her way, not all: two ships that each match the other run away together
  G.face = s.def.broadside ? broadsideFace(s, t) : Math.atan2(t.y - s.y, t.x - s.x);
}
function fighterAttack(s, t, dt) {
  const dx = t.x - s.x, dy = t.y - s.y, d = hyp(dx, dy) || 1;
  s.ft += dt;
  if ((s.weapons[0] && s.weapons[0].ammo <= 0) || s.fuel < .08) { s.order = { type: 'rearm' }; s.engage = null; return arrive(s, s.x, s.y, 0, 0); }
  if (s.fstate === 'extend') {
    if (s.ft > 1.5 || d > 950) { s.fstate = 'attack'; s.ft = 0; }
    const rvx = s.vx - t.vx, rvy = s.vy - t.vy, rs = hyp(rvx, rvy);
    let ux = -dx / d, uy = -dy / d; if (rs > 60) { ux = ux * .5 + rvx / rs; uy = uy * .5 + rvy / rs; const l = hyp(ux, uy); ux /= l; uy /= l; }
    G.face = null;
    return finish(s, (t.vx + ux * s.def.cruise - s.vx) * 2.2, (t.vy + uy * s.def.cruise - s.vy) * 2.2);
  }
  const sp = s.weapons[0] ? s.weapons[0].def.speed : 1000;
  const la = lead(s.x, s.y, s.vx, s.vy, t.x, t.y, t.vx, t.vy, sp);
  const close = Math.min(s.def.cruise, 170 + d * .6);
  finish(s, (t.vx + dx / d * close - s.vx) * 2.2, (t.vy + dy / d * close - s.vy) * 2.2);
  G.face = d < 1000 ? la : null;
  if (d < t.r + 80) { s.fstate = 'extend'; s.ft = 0; }
}
function boardRun(s, t, dt) {
  if (!isCapital(t)) { setIdle(s); return arrive(s, s.x, s.y, 0, 0); }
  const open = t.sh <= t.def.shield * .25 || t.surrendered;
  s.waiting = !open;
  if (!open) {
    const dx = s.x - t.x, dy = s.y - t.y, l = hyp(dx, dy) || 1, R = t.r * 1.3 + 70 + (s.id % 7) * 8;
    return arrive(s, t.x + dx / l * R, t.y + dy / l * R, t.vx, t.vy, s.def.cruise);
  }
  arrive(s, t.x, t.y, t.vx, t.vy, s.def.cruise);
  if (dist(s, t) < s.r + t.r * .9 + 10) {
    if (t.surrendered) { s.dead = true; flipShip(t, s.team, 'prize', s.troops); return; }
    const ca = Math.cos(-t.a), sa = Math.sin(-t.a), lx = s.x - t.x, ly = s.y - t.y;
    s.docked = { t, ox: (ca * lx - sa * ly) * .85, oy: (sa * lx + ca * ly) * .85 };
    burst(s.x, s.y, t.vx, t.vy, 12, 0xffb36b, 220, .5); sfx('clang', s.x, s.y);
    if (!t.breachTold || S.time - t.breachTold > 8) {
      t.breachTold = S.time;
      if (t.team === 0) { toast('Hull breach! Boarders on your ' + t.def.name, 'bad', t, true); if (S.alert) S.alert('board', t); }
      if (S.cue && t.def.cmd) S.cue('board', t.x, t.y, t.r);
      else if (s.team === 0) toast((s.def.shell ? 'starShells' : 'Obsidians') + ' are in the corridors of the ' + t.def.name + (facOf(0).speeches && t.def.crew > 2 ? ' · calling the lowColors to rise' : ''), 'good', t);
    }
  }
}
function depositRun(s, o) {
  const st = (o.dep && !o.dep.dead && o.dep.team === s.team) ? o.dep : (o.dep = nearestDepot(s));
  if (!st) { setIdle(s); arrive(s, s.x, s.y, 0, 0); return false; }
  const dx = s.x - st.x, dy = s.y - st.y, d = hyp(dx, dy) || 1; const R = st.r + s.r + 30;
  arrive(s, st.x + dx / d * R, st.y + dy / d * R, st.vx, st.vy);
  if (d < R + 40) {
    const amt = s.cargo * (s.team === 1 ? DIFF[S.difficulty].inc : 1);
    if (s.cargoKind === 'ore') { S.ore[s.team] += amt; logProd(s.team, 'ore', amt); }
    else if (s.cargoKind === 'salvage') { S.ore[s.team] += amt * .7; S.res[s.team] += amt * .3; logProd(s.team, 'ore', amt * .7); logProd(s.team, 'he', amt * .3); }
    else { S.res[s.team] += amt; logProd(s.team, 'he', amt); }
    s.cargo = 0; s.fuel = 1; return true;
  }
  return false;
}
function mineRun(s, o, dt) {
  let n = o.node;
  if (o.phase !== 'return' && (!n || n.amount <= 0)) { n = o.node = nearestNode(s, s.team ? 0 : 1, n ? n.kind : null); if (!n) { setIdle(s); return arrive(s, s.x, s.y, 0, 0); } o.phase = 'go'; }
  if (o.phase !== 'return' && s.cargo <= 0) s.cargoKind = n.kind;
  if (o.phase === 'go' || o.phase === 'mining') {
    const px = n.x + (o.ox || 0), py = n.y + (o.oy || 0);
    arrive(s, px, py, 0, 0);
    const d = hyp(px - s.x, py - s.y);
    if (o.phase === 'go' && d < 70) o.phase = 'mining';
    if (o.phase === 'mining') {
      if (d < 130) {
        const take = Math.min(s.def.mineRate * crewEff(s) * dt, n.amount, s.def.cargo - s.cargo); s.cargo += take; n.amount -= take;
        if (Math.random() < .25) S.parts.push({ x: px + rand(-40, 40), y: py + rand(-40, 40), vx: (s.x - px) * .8, vy: (s.y - py) * .8, life: .6, max: .6, size: 3, col: n.kind === 'ore' ? 0xe0995a : 0x7ff3ff });
      }
      if (s.cargo >= s.def.cargo - .01 || n.amount <= 0) { o.phase = 'return'; o.dep = null; }
    }
  }
  if (o.phase === 'return' && depositRun(s, o)) { o.phase = 'go'; if (!o.node || o.node.amount <= 0) o.node = nearestNode(s, s.team ? 0 : 1, o.node ? o.node.kind : null); }
}
function salvageRun(s, o, dt) {
  const t = o.t;
  if (o.phase === 'return') { if (depositRun(s, o)) { if (t && !t.dead) o.phase = 'go'; else setIdle(s); } return; }
  if (!t || t.dead || !(t.derelict || t.surrendered)) { if (s.cargo > 0) { o.phase = 'return'; o.dep = null; return; } setIdle(s); return arrive(s, s.x, s.y, 0, 0); }
  const dx = s.x - t.x, dy = s.y - t.y, d = hyp(dx, dy) || 1, R = t.r + s.r + 20;
  arrive(s, t.x + dx / d * R, t.y + dy / d * R, t.vx, t.vy);
  if (d < R + 40) {
    if (t.salvage == null) t.salvage = (t.def.value || 300) * .6;
    s.cargoKind = 'salvage';
    const take = Math.min(15 * dt, t.salvage, s.def.cargo - s.cargo); s.cargo += take; t.salvage -= take;
    if (Math.random() < .3) S.parts.push({ x: t.x + rand(-t.r, t.r) * .5, y: t.y + rand(-t.r, t.r) * .5, vx: (s.x - t.x) * .9, vy: (s.y - t.y) * .9, life: .5, max: .5, size: 3, col: 0xffcf8a });
    if (t.salvage <= 0) scrap(t, s.team);
    if (s.cargo >= s.def.cargo - .01 || t.dead) { o.phase = 'return'; o.dep = null; }
  }
}
const FREEHOLD = new Set(['pallas', 'hygiea', 'umbriel', 'oberon', 'haumea', 'makemake', 'eris']);
function scrap(t, team) {
  t.dead = true; t.scrapped = true; if (t.hulk) t.field.rocks.length = 0;
  for (let i = 0; i < Math.min(14, 3 + t.r / 6); i++) { const a = rand(0, TAU), sp = rand(10, 60); const sz = rand(t.r * .1, t.r * .25); const pts = []; for (let j = 0; j < 5; j++) { const aa = j / 5 * TAU; pts.push(Math.cos(aa) * sz * rand(.5, 1.1), Math.sin(aa) * sz * rand(.5, 1.1)); } S.debris.push({ x: t.x + rand(-t.r, t.r) * .4, y: t.y + rand(-t.r, t.r) * .4, vx: t.vx + Math.cos(a) * sp, vy: t.vy + Math.sin(a) * sp, a: rand(0, TAU), av: rand(-1, 1), pts, life: rand(8, 12), max: 12, cold: 1 }); }
  if (team === 0) toast(t.def.name + ' hulk stripped for salvage', 'good', t);
}

// ================================================================ hangars and spitTubes
function spitOut(c, type) {
  const side = c.launchSide = -c.launchSide;
  const ca = Math.cos(c.a), sa = Math.sin(c.a);
  const lx = rand(-.4, .4) * c.r, ly = side * c.r * .45;
  const x = c.x + ca * lx - sa * ly, y = c.y + sa * lx + ca * ly;
  const f = makeShip(type, c.team, x, y, c.a + side * PI / 2);
  const ev = 170 + rand(0, 40); f.vx = c.vx - sa * side * ev; f.vy = c.vy + ca * side * ev;
  f.carrier = c; f.vis = c.vis.slice(); f.seen = c.team === 0 || c.seen; f.breachMul = bonus(c, 'breacher') ? 1.3 : 1;
  burst(x, y, f.vx, f.vy, 5, 0xcfd8e0, 90, .3);
  c.h[type]--;
  return f;
}
export function launchFighters(c, n) {
  let k = 0;
  while (c.h && c.h.ripwing > 0 && k < n) {
    const f = spitOut(c, 'ripwing'); const i = c.id + k + S.ships.length;
    f.order = { type: 'guard', t: c, ox: rand(-1.2, 1.2) * c.r - c.r * .4, oy: (i % 2 ? 1 : -1) * (c.r + 60 + rand(0, 120)) }; k++;
  }
  if (k) sfx('missile', c.x, c.y);
  return k;
}
// a single craft of any kind out of the hangar bays (the Storks, for the Rain)
export function launchCraft(c, type) { if (!c.h || !(c.h[type] > 0)) return null; const f = spitOut(c, type); f.oneWay = true; return f; }
export function launchShells(c, t, n, quiet) {
  let k = 0;
  while (c.h && c.h.starshell > 0 && k < n) { const f = spitOut(c, 'starshell'); f.order = { type: 'board', t }; k++; }
  if (k) { sfx('missile', c.x, c.y); if (c.team === 0 && !quiet) toast(k + ' starShells away from spitTubes · target ' + t.def.name, ''); }
  return k;
}
// assault pods: fired from the spitTubes at an enemy hull, they burn in and drill through; they do not come back
export function launchPods(c, t, n, quiet) {
  let k = 0;
  while (c.h && c.h.boarder > 0 && k < n) { const f = spitOut(c, 'boarder'); f.order = { type: 'board', t }; f.oneWay = true; k++; }
  if (k) { sfx('missile', c.x, c.y); if (c.team === 0 && !quiet) toast(k + ' assault pod' + (k > 1 ? 's' : '') + ' fired · target ' + t.def.name, ''); }
  return k;
}
const podsFor = t => Math.max(1, Math.min(4, Math.ceil((t.marines || 0) / 60) + 1)); // enough Obsidian to beat the marines aboard, and one more
export function recallFighters(c) { for (const f of S.ships) if (f.carrier === c && f.type === 'ripwing' && f.order.type === 'guard') f.order = { type: 'dock', t: c }; }
function dockInto(f, c) {
  if (f.oneWay || !c.h || c.h[f.type] === undefined) { setIdle(f); return; }
  f.dead = true; f.recovered = true;
  c.h[f.type] = Math.min(c.def.hangar[f.type], c.h[f.type] + 1);
}
function carrierTick(c) {
  if (!c.h || disabled(c)) return;
  const enemy = nearestEnemy(c, c.x, c.y, 2700, false);
  if (c.hmode === 'auto') {
    if (enemy) { c.clearT = 0; launchFighters(c, 2); }
    else { c.clearT += .5; if (c.clearT > 10) recallFighters(c); }
  } else recallFighters(c);
  if (c.team === 1 && c.h.starshell > 0) {
    let best = null, bd = 2700;
    for (const o of S.ships) { if (o.team === c.team || !isCapital(o) || !o.vis[1] || (o.sh > o.def.shield * .3 && !o.surrendered) || (o.team === 2 && !o.derelict && S.time - S.aggro[1] > 30)) continue; const d = dist(o, c); if (d < bd) { bd = d; best = o; } }
    if (best && !S.ships.some(x => x.team === 1 && x.order.type === 'board' && x.order.t === best && x.def.shell)) launchShells(c, best, Math.min(c.h.starshell, Math.ceil(best.marines / 30) + 6));
  }
  if (c.team === 0 && c.h.boarder > 0 && c.hmode === 'auto' && c.order.type === 'attack' && c.order.t && !c.order.t.dead) { // ours fire at the ship they were ordered to attack, once its shields fail
    const t = c.order.t;
    if (isCapital(t) && (t.sh < t.def.shield * .25 || t.surrendered) && dist(t, c) < 2200 && !S.ships.some(x => x.team === 0 && x.order.type === 'board' && x.order.t === t && x.type === 'boarder' && !x.dead)) launchPods(c, t, Math.min(c.h.boarder, podsFor(t)));
  }
  if (c.team === 1 && c.h.boarder > 0) { // the enemy fires its pods at a capital ship whose shields are down, close enough that point defence has little time
    let best = null, bd = 2200;
    for (const o of S.ships) { if (o.team === c.team || !isCapital(o) || !o.vis[1] || (o.sh > o.def.shield * .25 && !o.surrendered) || (o.team === 2 && !o.derelict && S.time - S.aggro[1] > 30)) continue; const d = dist(o, c); if (d < bd) { bd = d; best = o; } }
    if (best && !S.ships.some(x => x.team === 1 && x.order.type === 'board' && x.order.t === best && x.type === 'boarder')) launchPods(c, best, Math.min(c.h.boarder, podsFor(best)));
  }
}

// ================================================================ weapons
export function lead(sx, sy, svx, svy, tx, ty, tvx, tvy, sp) {
  const px = tx - sx, py = ty - sy, vx = tvx - svx, vy = tvy - svy;
  const a = vx * vx + vy * vy - sp * sp, b = 2 * (px * vx + py * vy), c = px * px + py * py; let t = 0;
  if (Math.abs(a) < 1e-6) t = b ? -c / b : 0;
  else { const disc = b * b - 4 * a * c; if (disc >= 0) { const r = Math.sqrt(disc), t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a); const lo = Math.min(t1, t2), hi = Math.max(t1, t2); t = lo > 0 ? lo : hi; } }
  if (!(t > 0)) t = 0; t = Math.min(t, 4);
  return Math.atan2(py + vy * t, px + vx * t);
}
function pickTarget(s, w, mx, my) {
  const D = w.def, R = D.pd || (s.def.static && s.team < 2) || longFire(s.team) ? D.range : effR(D), base = s.a + w.dir; let best = null, bs = 1e18;
  if (D.pd) { for (const m of S.missiles) { if (m.team === s.team || m.dead) continue; const d2 = (m.x - mx) ** 2 + (m.y - my) ** 2; if (d2 < R * R && d2 < bs) { bs = d2; best = m; } } if (best) return best; }
  const ot = orderTarget(s);
  if (ot && !ot.dead && !D.pd && !D.emp && !(D.breach && !bigHull(ot)) && ot.vis[s.team] && !ot.surrendered) {
    const d = hyp(ot.x - mx, ot.y - my);
    if (d < R && losClear(mx, my, ot.x, ot.y) && (D.arc >= PI || Math.abs(angDiff(base, Math.atan2(ot.y - my, ot.x - mx))) < D.arc + .3)) return ot;
  }
  query(mx, my, R, o => {
    if (!hostileTo(s, o, ot) || (o.docked && D.kind !== 'flak') || !o.vis[s.team]) return;
    const dx = o.x - mx, dy = o.y - my, d2 = dx * dx + dy * dy; if (d2 > R * R) return;
    if (s.team === 2 && S.time - S.aggro[o.team] > 30 && d2 > 650 * 650) return; // neutrals only defend themselves
    if (D.arc < PI && Math.abs(angDiff(base, Math.atan2(dy, dx))) > D.arc + .3) return;
    if (!losClear(mx, my, o.x, o.y)) return;
    const small = o.def.fighter || o.def.boarder; let sc = d2;
    if (D.breach) { if (!bigHull(o) || o.derelict) return; sc = d2 / ((o.def.value || 100) * (o.sh > 0 ? 1 : 3)); }
    else if (D.emp) { if (o.emp > 1 || small || o.type === 'hauler' || o.derelict) return; sc = d2 / (o.mass * (o.sh > 0 ? 2 : 1)); }
    else if (D.pd) sc *= small ? .25 : (o.type === 'hauler' ? .5 : 1);
    else if (D.kind === 'missile') sc *= small ? 8 : (o.def.static ? 1.5 : 1);
    else if (D.kind === 'slug') sc *= small ? 5 : (o.type === 'hauler' ? 1.5 : 1);
    if (o.derelict) sc *= 6;
    if (sc < bs) { bs = sc; best = o; }
  });
  return best;
}
// battle tempo: main guns and missile racks cycle this many times slower than their listed reload (point defence keeps its rate)
export const TEMPO = 4.2;
function updWeapons(s, dt) {
  const ca = Math.cos(s.a), sa = Math.sin(s.a); const off = disabled(s); const st = s.def.static && s.team < 2;
  const gf0 = s.gf;
  for (const w of s.weapons) {
    const D = w.def, gf = gf0 * (w.oy > .01 ? s.gS : w.oy < -.01 ? s.gP : (s.gP + s.gS) * .5); w.cd -= dt * gf * (w.km || 1) / (D.pd ? 1 : TEMPO); w.scan -= dt;
    if (D.battery && s.burnT > S.time) { w.target = null; continue; } // burning flat out: the gun decks are secured
    if (s.cold || s.darkT > S.time) { w.target = null; continue; } // cold: every gun holds
    const mR = s.def.vr0 || s.r, mx = s.x + (ca * w.ox - sa * w.oy) * mR, my = s.y + (sa * w.ox + ca * w.oy) * mR; w.mx = mx; w.my = my;
    if (off) { w.salvo = 0; w.volley = 0; w.chg = 0; continue; }
    if (w.chg) { // a bow lance building its charge: when the capacitors are full it fires down the bore, wherever the bow now points
      if (S.time >= w.chg) { const tt = w.chgT && !w.chgT.dead ? w.chgT : null; let ang = s.a + w.dir; if (tt) ang += clamp(angDiff(ang, lead(mx, my, s.vx, s.vy, tt.x, tt.y, tt.vx, tt.vy, D.speed)), -D.gimbal, D.gimbal); w.chg = 0; fire(s, w, mx, my, ang, D, true); }
      continue;
    }
    if (w.salvo > 0) { w.st -= dt; if (w.st <= 0) { w.st = .16; w.salvo--; if (w.ammo > 0 || st) { if (!st) w.ammo--; launchMissile(s, w, mx, my, w.stg && !w.stg.dead ? w.stg : null, null); } } }
    if (w.volley > 0) {
      w.vt -= dt;
      if (w.vt <= 0) {
        w.vt = .05; w.volley--;
        if (w.ammo > 0 || st) { const k = w.guns > 1 ? (w.volley / (w.guns - 1) - .5) : 0; const off2 = k * (s.def.vr0 || s.r) * .28; fire(s, w, mx + ca * off2, my + sa * off2, w.ang, D, false); }
      }
    }
    if (D.manual) continue;
    if (s.group && s.group.stance === 'hold' && !D.pd) { w.target = null; continue; }
    if (w.ammo <= 0 && !st) { w.target = null; continue; }
    if (w.scan <= 0) { w.scan = .22 + Math.random() * .15; w.target = pickTarget(s, w, mx, my); }
    let t = w.target;
    if (t && (t.dead || t.team === s.team || t.surrendered)) { w.target = t = null; }
    let aim = null;
    if (t) {
      const dx = t.x - mx, dy = t.y - my, d = hyp(dx, dy);
      if (d > (D.pd || (s.def.static && s.team < 2) || longFire(s.team) ? D.range : effR(D)) * 1.08) w.target = t = null;
      else { w.td = d; aim = D.kind === 'missile' ? Math.atan2(dy, dx) : lead(mx, my, s.vx, s.vy, t.x, t.y, t.vx, t.vy, D.speed); }
    }
    const base = s.a + w.dir;
    if (D.turn === 0) w.ang = base;
    else if (D.turn >= 99) w.ang = aim ?? base;
    else {
      const want = aim ?? base; w.ang += clamp(angDiff(w.ang, want), -D.turn * dt * gf, D.turn * dt * gf);
      if (D.arc < PI) { const rel = angDiff(base, w.ang); if (Math.abs(rel) > D.arc) w.ang = base + Math.sign(rel) * D.arc; }
    }
    if (!t || aim == null || w.cd > 0 || w.volley > 0) continue;
    const rel = angDiff(base, aim);
    if (Math.abs(rel) > D.arc) continue;
    if (D.kind === 'missile') { w.cd = D.reload * (.9 + Math.random() * .2); w.salvo = Math.min(D.salvo, st ? D.salvo : w.ammo); w.st = 0; w.stg = t; continue; }
    if (D.turn === 0 && D.bow) { w.chg = S.time + (D.charge || 2); w.chg0 = S.time; w.chgT = t; t.lanceT = w.chg + .4; t.lanceBy = s; if (S.hooks && S.hooks.voice && t.team === 0) S.hooks.voice('lance', t); if (S.alert && t.team === 0 && t.def.cmd) S.alert('lance', t); }
    else if (D.turn === 0) fire(s, w, mx, my, base + clamp(rel, -D.gimbal, D.gimbal), D, true);
    else if (Math.abs(angDiff(w.ang, aim)) < (D.pd ? .08 : D.battery ? .05 : .025)) {
      if (D.battery) { w.volley = st ? w.guns : Math.min(w.guns, Math.floor(w.ammo)); w.vt = 0; w.cd = D.reload * (.9 + Math.random() * .2); }
      else fire(s, w, mx, my, w.ang, D, true);
    }
  }
  if (s.team === 0 && !s.wTold && !s.def.static && s.weapons.length && !s.def.fighter && mainAmmo(s) <= 0) { s.wTold = true; toast(s.def.name + ' is Winchester: magazines empty · press R to rearm', 'bad', s); }
  if (mainAmmo(s) > .3) s.wTold = false;
}
function fire(s, w, mx, my, ang, D, resetCd) {
  const lk = s.lockT > S.time ? .35 : 1, far = D.eff && w && w.td > D.eff ? .045 * Math.min(1, (w.td - D.eff) / Math.max(1, D.range - D.eff)) : 0;
  const spr = (D.spread * (bonus(s, 'gunnery') ? .6 : 1) * (1 - .15 * s.rank) + far) * lk;
  ang += rand(-spr, spr);
  const c = Math.cos(ang), sn = Math.sin(ang);
  S.shots.push({ x: mx, y: my, px: mx, py: my, vx: s.vx + c * D.speed, vy: s.vy + sn * D.speed, team: s.team, D, life: D.life, owner: s, d0: w ? w.td || 0 : 0 });
  if (D.recoil && !s.def.static) { s.vx -= c * D.recoil / s.mass; s.vy -= sn * D.recoil / s.mass; }
  if (resetCd) w.cd = D.reload * (.9 + Math.random() * .2);
  if (w) w.fT = S.time; // when the gun last fired: the renderer recoils its barrels and kicks the hull
  if (!(s.def.static && s.team < 2)) { w.ammo--; S.bstat.ord[s.team] += D.supply / Math.max(1, w.mag); S.bstat.rounds[s.team]++; } s.lastFire = S.time; s.glare = 0;
  if (D.kind === 'slug') {
    const n = D.huge ? 26 : D.big ? 14 : 4;
    for (let i = 0; i < n; i++) S.parts.push({ x: mx, y: my, vx: s.vx + c * rand(60, 300) + rand(-40, 40), vy: s.vy + sn * rand(60, 300) + rand(-40, 40), life: rand(.15, .4), max: .4, size: D.huge ? 10 : D.big ? 6 : 3, col: D.big ? 0xff8a5c : 0xcfefff });
    S.rings.push({ x: mx, y: my, vx: s.vx, vy: s.vy, r: 2, max: D.huge ? 260 : D.big ? 120 : 26, life: .25, maxl: .25, col: D.big ? 0xff6a3d : 0xbfe6ff });
    { const ns = D.huge ? 14 : D.big ? 8 : 3; for (let i = 0; i < ns; i++) { const a = ang + rand(-.35, .35), v = rand(300, D.big ? 1100 : 700); S.parts.push({ x: mx, y: my, vx: s.vx + Math.cos(a) * v, vy: s.vy + Math.sin(a) * v, life: rand(.12, .3), max: .3, size: 2, col: D.big ? 0xffb37a : 0xe8f6ff, spark: 1, drag: 4 }); } } /* the muzzle blast, thrown forward */
    if (S.flashes.length < 400) S.flashes.push({ x: mx, y: my, vx: s.vx, vy: s.vy, r: D.huge ? 120 : D.big ? 60 : 18, px: D.huge ? 34 : D.big ? 22 : D.battery ? 9 : 12, life: .13, max: .13, col: D.big ? 0xffb37a : 0xfff0d0 }); /* the muzzle flash: a broadside lights the ship's flank */
    sfx(D.big ? 'lance' : 'rail', mx, my); if (D.big && S.hooks && S.hooks.beam) S.hooks.beam(s, mx, my, ang, D);
  } else if (D.kind === 'bullet') sfx('cannon', mx, my);
  else if (D.kind === 'flak') sfx('pd', mx, my);
}
function launchMissile(s, w, mx, my, t, pt) {
  const D = w.def; const side = w.oy > 0 ? 1 : w.oy < 0 ? -1 : (Math.random() < .5 ? 1 : -1); const a = s.a + side * PI / 2 + rand(-.3, .3);
  if (!D.nuke) { S.bstat.ord[s.team] += D.supply / Math.max(1, w.mag); S.bstat.rounds[s.team]++; }
  S.missiles.push({ x: mx, y: my, vx: s.vx + Math.cos(a) * 90, vy: s.vy + Math.sin(a) * 90, a, team: s.team, src: s, t, tp: pt, fuel: D.fuel || 4.5, life: D.life || 9, hp: D.hp || 7, dmg: D.dmg, emp: !!D.emp, nuke: !!D.nuke, breach: !!D.breach, dead: false, arm: .35, trailT: 0 });
  s.lastFire = S.time; s.glare = 0; sfx('missile', mx, my);
}
export function launchNuke(s, w, t, pt) {
  w.ammo--; w.cd = w.def.reload; s.lastFire = S.time; s.glare = 0;
  launchMissile(s, w, w.mx, w.my, t, t ? null : pt);
  toast(s.team === 1 ? '☢ Nuclear launch detected' : '☢ Nuclear missile away', 'nuke', s); sfx('alarm');
  if (S.alert && s.team === 1) S.alert('nuke', s); if (S.cue) S.cue('nuke', s.x, s.y, 60);
}

// ================================================================ veterancy and commanders
function addXp(s, v) {
  if (s.dead || s.def.static) return; s.xp += v; const c = s.def.value || 100;
  const nr = s.xp >= c * 2.5 ? 3 : s.xp >= c * 1.2 ? 2 : s.xp >= c * .4 ? 1 : 0;
  if (nr > s.rank) { s.rank = nr; if (s.team === 0 && !s.def.fighter && !s.def.shell) toast(s.def.name + ' crew now ' + ['', 'Blooded', 'Veteran', 'Scarred'][nr], 'good', s); }
}
function addRenown(c, v) {
  c.renown += v; const nr = c.renown >= 1000 ? 3 : c.renown >= 400 ? 2 : c.renown >= 120 ? 1 : 0;
  if (nr > c.rank) { c.rank = nr; if (c.team === 0) toast(c.name + ' is promoted to ' + ['Commander', 'Captain', 'Legate', 'Imperator'][nr], 'good'); }
}
export function assignCommander(c, ship) {
  if (!ship || !ship.def.cmd || ship.cmdr || c.state !== 'ready' || ship.team !== c.team) return false;
  ship.cmdr = c; c.ship = ship; c.state = 'aboard'; ship.loy = Math.min(1, ship.loy + .1);
  if (c.team === 0) toast(c.name + ' takes command of the ' + ship.def.name, 'good', ship);
  return true;
}
export function recallCommander(c) { if (c.state !== 'aboard' || !c.ship) return; c.ship.cmdr = null; c.ship = null; c.state = 'ready'; }
function shock(team, x, y, R, amt) { for (const o of S.ships) if (o.team === team && !o.dead && o.def.crew > 2 && !o.def.static && hyp(o.x - x, o.y - y) < R) o.loy = Math.max(loyFloor(o), o.loy - amt * resist(o)); }
function commanderLost(c, ship, cause) {
  ship.cmdr = null; c.ship = null;
  if (cause === 'ship' && Math.random() < .4) { c.state = 'pod'; c.timer = 90; if (c.team === 0) toast(c.name + "'s escape pod got clear · back in service in 90 s", ''); else toast('Enemy commander ' + c.name + ' escaped in a pod', ''); }
  else { c.state = 'dead'; toast((c.team === 0 ? '' : 'Enemy commander ') + c.name + ' has fallen', c.team === 0 ? 'bad' : 'good'); }
  shock(c.team, ship.x, ship.y, 2000, .12);
  if (!ship.dead) ship.loy = Math.max(0, ship.loy - .3 * resist(ship));
}
function commanderCaptured(c, byTeam, ship) {
  ship.cmdr = null; c.ship = null; c.state = 'captured'; c.heldBy = byTeam;
  if (byTeam < 2) S.res[byTeam] += 250;
  shock(c.team, ship.x, ship.y, 2000, .15);
  toast(c.team === 0 ? c.name + ' has been taken prisoner' : 'Enemy commander ' + c.name + ' taken prisoner · +250 He-3 ransom', c.team === 0 ? 'bad' : 'good');
}

// ================================================================ damage
export function damage(s, amt, team, x, y, kind, src) {
  if (s.dead || amt <= 0) return;
  if (s.team === 2 && team >= 0 && team < 2) S.aggro[team] = S.time;
  if (src && src.team === 2 && s.team < 2) S.aggro[s.team] = Math.max(S.aggro[s.team], S.time - 15);
  s.lastHit = S.time;
  const kin = kind === 'slug' || kind === 'bullet' || kind === 'flak';
  let stern = false;
  if ((kin || kind === 'lance') && s.sub && x != null) { const rel = Math.abs(angDiff(s.a, Math.atan2(y - s.y, x - s.x))); if (rel > 2.3) { amt *= STERN; stern = true; } else if (rel < .55) amt *= RAKE; } /* raked down her length; in the stern, into the drive */
  if (kin && s.def.armor && !stern) amt = Math.max(amt * .15, amt - s.def.armor); /* armour plate: per hit */
  if (s.sh > 0 && kind !== 'internal') {
    const sk = s.shT > S.time ? .5 : 1, mul = kind === 'nuke' ? .5 : 1; let absorb;
    if (s.sub) { // the struck half takes it; with that half down the shot goes through to the hull
      shSync(s); const side = sideOf(s, x, y), k = side > 0 ? 'shS' : 'shP';
      absorb = Math.min(s[k], amt * mul * sk); s[k] -= absorb; if (side > 0) s.hitS = S.time; else s.hitP = S.time;
      if (absorb > 0 && s[k] <= .5) { s[k] = 0; if (side > 0) s.downS = S.time; else s.downP = S.time; if (s.shP + s.shS > .5 && S.hooks && S.hooks.halfDown) S.hooks.halfDown(s, side, team, src); }
      s.sh = s.shP + s.shS;
    } else { absorb = Math.min(s.sh, amt * mul * sk); s.sh -= absorb; }
    amt -= absorb / sk;
    if (absorb > 0) { if (S.hooks && S.hooks.absorb) S.hooks.absorb(s, absorb, team, src, kind); s.shHit = S.time; s.shFlash = .35; s.shA = Math.atan2(y - s.y, x - s.x); }
    if (absorb > 0 && s.sh <= .5) { s.sh = 0; s.shP = s.shS = 0; s.shDown = S.time; if (S.alert && s.team === 0 && (s.cmdr || (s.group && s.group.flag === s))) S.alert('flagSh', s); if (S.hooks && S.hooks.shDown) S.hooks.shDown(s, team, src); burst(s.x, s.y, s.vx, s.vy, 24, 0x8fd3ff, s.r * 6 + 80, .6); S.rings.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, r: s.r, max: s.r * 2.4, life: .5, maxl: .5, col: 0x8fd3ff }); sfx('shdown', s.x, s.y); }
    if (amt <= 0) return;
  }
  const before = s.hp; s.hp -= amt; s.flash = .12; s.hitSum = (s.hitSum || 0) + amt; if (x != null) { s.hitX = x; s.hitY = y; } /* for the renderer: where she was struck and how hard */ if (S.hooks && S.hooks.hit) S.hooks.hit(s, amt, team, src, kind);
  if (src && src.team !== s.team && !src.dead) { const dealt = Math.min(amt, before); addXp(src, dealt * .02); if (src.cmdr) addRenown(src.cmdr, dealt * .005); }
  if (s.sub && kind !== 'internal' && s.hp > 0) hitSubsystem(s, amt, x, y, src);
  if (s.def.crew > 2) {
    const cb = s.crew; s.crewBefore = cb; const k = amt / s.def.hp * s.def.crew * rand(.7, 1.3); s.crew = Math.max(0, s.crew - k);
    if (cb > 0) s.marines = Math.max(0, Math.min(s.marines, s.crew) - k * (s.marines / cb));
    if (s.team === 0) S.stats.crewLost += cb - s.crew;
    if (s.team < 2 && !s.def.static) s.loy = Math.max(loyFloor(s), s.loy - amt / s.def.hp * .35 * resist(s));
  }
  if (s.team === 0 && team !== s.team) alertAttack(s);
  if (s.hp <= 0) { s.killKind = kind; destroy(s, team, src); } // how she died: a nuke leaves nothing to tow home
}
function hitSubsystem(s, amt, x, y, src) {
  let k;
  const rl = angDiff(s.a, Math.atan2(y - s.y, x - s.x)), rel = Math.abs(rl), gs = rl >= 0 ? 'gunsS' : 'gunsP'; // the guns of the broadside that was struck
  if (src && src.aimSub && Math.random() < .6) k = src.aimSub === 'guns' ? gs : src.aimSub;
  else k = rel > 2.3 ? 'eng' : rel < .55 ? 'bridge' : (Math.random() < .6 ? gs : 'shld');
  const b = s.sub[k]; if (b == null) return; s.sub[k] = Math.max(0, b - amt / (s.def.hp * .22));
  if (b > 0 && s.sub[k] <= 0) {
    const nm = SUBS.find(e => e[0] === k)[1];
    if (s.team === 0 && S.time - (s.subT || -99) > 10) { s.subT = S.time; toast(s.def.name + ': ' + nm + ' knocked out', 'bad', s); } else if (src && src.team === 0 && s.def.cmd && S.time - (s.subT || -99) > 20) { s.subT = S.time; toast('Enemy ' + s.def.name + ': ' + nm + ' knocked out', 'good', s); }
    burst(s.x, s.y, s.vx, s.vy, 20, 0xffcf8a, s.r * 3, .7);
    if (k === 'shld') { s.sh = 0; s.shDown = S.time; }
    if (k === 'bridge') { s.loy = Math.max(loyFloor(s), s.loy - .2 * resist(s)); if (s.cmdr && Math.random() < .25) commanderLost(s.cmdr, s, 'bridge'); }
  }
}
let lastAlert = -99, lastStationAlert = -99;
function alertAttack(s) {
  if (s === S.stations[0]) { if (S.time - lastStationAlert > 12) { lastStationAlert = S.time; toast('Citadel under fire!', 'bad', s, true); sfx('alarm'); } }
  else if (S.time - lastAlert > 15 && !onScreen(s.x, s.y, 0)) { lastAlert = S.time; toast(s.def.name + ' under fire', 'bad', s); }
}
export let onGameOver = null; export function setGameOverHandler(fn) { onGameOver = fn; }
function destroy(s, byTeam, src) {
  if (s.dead) return;
  if (s.gov && s.type !== 'station') { s.hp = Math.max(1, s.def.hp * .04); s.sh = 0; s.shDown = S.time; return; } // a world's orbital authority is taken, never destroyed
  s.dead = true; if (S.hooks && S.hooks.kill) S.hooks.kill(s, byTeam, src);
  if (S.cue && s.def.cmd && !s.def.static && s.team < 2) S.cue('kill', s.x, s.y, s.r);
  // a capital hull (a destroyer and up) takes seconds to die: venting, listing, then the reactor goes
  if (!s.def.static && s.def.cmd && (s.def.len || 0) >= 1500) startThroes(s, byTeam);
  else blowUp(s, s.x, s.y, s.vx, s.vy, s.r, byTeam, 9);
  if (src && src.team !== s.team && !src.dead) { addXp(src, (s.def.value || 50) * .3); if (src.cmdr) { addRenown(src.cmdr, (s.def.value || 50) * .2); src.cmdr.kills++; } }
  // lifeboats: a share of a lost ship's crew makes it home to the manpower pool
  let boats = 0; if (s.team < 2 && !s.def.static && s.def.crew > 2) { boats = (s.crewBefore ?? s.crew) * .12; S.man[s.team] += boats; }
  // losses and kills reach the Dispatches: every hull you lose, every enemy warship you kill, a banner for capital ships
  if (!s.def.fighter && !s.def.shell && !s.def.static) {
    const big = (s.def.r0 ?? s.r) >= 30, who = s.cmdr ? ' (' + s.cmdr.name + ')' : '';
    if (s.team === 0 && !(S.hooks && S.hooks.kill)) toast('Lost: ' + s.def.name + who + (boats > 50 ? ' · ' + Math.round(boats).toLocaleString() + ' crew reached the lifeboats' : ''), 'bad', { x: s.x, y: s.y }, big);
    else if (byTeam === 0 && s.def.capture && !(S.hooks && S.hooks.kill)) toast('Destroyed: enemy ' + s.def.name + who, 'good', { x: s.x, y: s.y }, big);
    const g = s.group; if (s.team === 0 && g && g.members.every(m => m.dead || m === s)) toast('Battle group ' + g.name + ' destroyed', 'bad', { x: s.x, y: s.y }, true);
  }
  if (s.cmdr) commanderLost(s.cmdr, s, 'ship');
  if (s.team === 0 && !s.def.static) { S.stats.lost++; S.stats.crewLost += s.crew; }
  if (s.team !== 0 && byTeam === 0) S.stats.kills++;
  for (const o of S.ships) if (o.docked && o.docked.t === s) { o.docked = null; setIdle(o); }
  if (S.builder === s) S.builder = null;
  if (s === S.stations[0] || s === S.stations[1]) { explosion(s.x, s.y, 0, 0, size * 1.6); const win = s === S.stations[1]; setTimeout(() => onGameOver && onGameOver(win), 2200); }
}
function blowUp(s, x, y, vx, vy, size, byTeam, nmax) {
  explosion(x, y, vx, vy, size);
  const nd = Math.min(22, 3 + Math.floor(size / 5));
  for (let i = 0; i < nd; i++) {
    const a = rand(0, TAU), sp = rand(20, size * 2.5 + 40); const pts = []; const k = 4 + Math.floor(rand(0, 3)); const sz = rand(size * .1, size * .28);
    for (let j = 0; j < k; j++) { const aa = j / k * TAU; pts.push(Math.cos(aa) * sz * rand(.5, 1.1), Math.sin(aa) * sz * rand(.5, 1.1)); }
    S.debris.push({ x: x + rand(-size * .4, size * .4), y: y + rand(-size * .4, size * .4), vx: vx + Math.cos(a) * sp, vy: vy + Math.sin(a) * sp, a: rand(0, TAU), av: rand(-3, 3), pts, life: rand(7, 12), max: 12 });
  }
  if (size >= nmax) {
    const R = size * 6 + 80;
    query(x, y, R, o => {
      if (o === s || o.dead || o.def.static || o.docked) return;
      const dx = o.x - x, dy = o.y - y, d = Math.max(hyp(dx, dy), 40); if (d > R) return;
      const dv = size * 360 / (o.mass * d); o.vx += dx / d * dv; o.vy += dy / d * dv; o.av += rand(-1, 1) * dv * .01;
      if (size > 30) damage(o, size * 2.2 * (1 - d / R), byTeam, x, y, 'blast');
    });
  }
}
// ================================================================ death throes and hulks
// A dying capital ship drifts on, venting, burning and listing over to one side, for four to eight seconds by her size;
// then her reactor goes. What is left is a drifting hulk: it blocks fire like a rock, and haulers can strip it.
const MAX_HULKS = 14;
function startThroes(s, byTeam) {
  const k = clamp(((s.def.len || 1500) - 1500) / 6500, 0, 1);
  S.wrecks.push({ id: s.id, type: s.type, team: s.team, def: s.def, x: s.x, y: s.y, vx: s.vx, vy: s.vy, a: s.a, av: s.av + rand(-.04, .04), roll: 0, rollV: (Math.random() < .5 ? -1 : 1) * rand(.06, .14),
    t0: S.time, T: 4 + 4 * k + rand(0, .6), r: s.r, vt: s.vt, cmdr: s.cmdr ? { name: s.cmdr.name } : null, title: s.title, byTeam, vent: 0, pop: rand(.6, 1.2) });
  burst(s.x, s.y, s.vx, s.vy, 30, 0xffcf8a, s.r * 4, .8); sfx('boom', s.x, s.y, s.r * .3);
}
function wreckTick(dt) {
  for (const w of S.wrecks) {
    const gv = grav(w.x, w.y); w.vx += gv.x * dt; w.vy += gv.y * dt; w.x += w.vx * dt; w.y += w.vy * dt; w.a += w.av * dt; w.roll += w.rollV * dt; w.rollV *= 1 + dt * .25;
    const k = (S.time - w.t0) / w.T, ca = Math.cos(w.a), sa = Math.sin(w.a);
    if ((w.vent -= dt) <= 0) { // atmosphere, fire and coolant out of the breaches, more of it as the end comes
      w.vent = .05;
      for (let i = 0; i < 1 + k * 3; i++) { const lx = rand(-.9, .9) * w.r, ly = rand(-.3, .3) * w.r, px = w.x + ca * lx - sa * ly, py = w.y + sa * lx + ca * ly, fire = Math.random() < .3 + .5 * k, a = rand(0, TAU), v = rand(20, 90);
        S.parts.push({ x: px, y: py, vx: w.vx + Math.cos(a) * v, vy: w.vy + Math.sin(a) * v, life: rand(.5, 1.4), max: 1.4, size: fire ? rand(2, 3 + w.r * .06) : w.r * .12 + 4, col: fire ? (Math.random() < .5 ? 0xff9a4a : 0xffd27a) : 0x6a625a, smoke: fire ? 0 : 1, drag: 1 }); }
    }
    if ((w.pop -= dt) <= 0) { w.pop = rand(.4, 1.1) * (1 - k * .6); const lx = rand(-.8, .8) * w.r, px = w.x + ca * lx, py = w.y + sa * lx; // secondary blasts down the hull
      S.flashes.push({ x: px, y: py, vx: w.vx, vy: w.vy, r: w.r * rand(.6, 1.2), life: .22, max: .22 }); burst(px, py, w.vx, w.vy, 14, 0xffb36b, w.r * 2.5, .5); sfx('boom', px, py, w.r * .15); }
    if (k >= 1) { // the reactor: the blast a big ship always made, and the hulk it leaves
      w.done = true; S.flashes.push({ x: w.x, y: w.y, vx: w.vx, vy: w.vy, r: w.r * 7, life: .5, max: .5 });
      blowUp(null, w.x, w.y, w.vx, w.vy, w.r, w.byTeam, 9);
      if (S.cue) S.cue('reactor', w.x, w.y, w.r);
      makeHulk(w);
    }
  }
  if (S.wrecks.length) S.wrecks = S.wrecks.filter(w => !w.done);
  for (const h of S.hulks) {
    if (h.dead) continue;
    const gv = grav(h.x, h.y); h.vx += gv.x * dt; h.vy += gv.y * dt; const dr = Math.max(0, 1 - .05 * dt); h.vx *= dr; h.vy *= dr;
    h.x += h.vx * dt; h.y += h.vy * dt; h.a += h.av * dt; h.roll += h.rollV * dt; h.rollV *= Math.max(0, 1 - .3 * dt);
    const f = h.field, k = f.rocks[0]; f.x = k.x = h.x; f.y = k.y = h.y; k.vx = h.vx; k.vy = h.vy;
    if (bodyHit(h.x, h.y, h.r * .3)) { h.dead = true; burst(h.x, h.y, 0, 0, 20, 0xff9a6a, 160, .8); }
    if (Math.random() < .02) S.parts.push({ x: h.x + rand(-h.r, h.r) * .6, y: h.y + rand(-h.r, h.r) * .3, vx: h.vx, vy: h.vy, life: rand(1.5, 3), max: 3, size: h.r * .2 + 4, col: 0x3a3430, smoke: 1, drag: .5 });
  }
  if (S.hulks.some(h => h.dead)) { const gone = new Set(S.hulks.filter(h => h.dead).map(h => h.field)); S.hulks = S.hulks.filter(h => !h.dead); S.fields.splice(0, S.fields.length, ...S.fields.filter(f => !gone.has(f))); }
}
function makeHulk(w) {
  const h = { id: w.id, hulk: true, type: w.type, team: 2, origTeam: w.team, def: w.def, x: w.x, y: w.y, vx: w.vx * .6, vy: w.vy * .6, a: w.a, av: w.av * .3, roll: w.roll, rollV: w.rollV * .4, r: w.r * .9, vt: w.vt, cmdr: w.cmdr, title: w.title, dead: false, derelict: true, hp: 1, sh: 0, salvage: (w.def.value || 300) * .6, t0: S.time };
  const k = { x: h.x, y: h.y, r: h.r * .85, pts: [], vx: h.vx, vy: h.vy, hulk: h };
  h.field = { x: h.x, y: h.y, r: h.r + 10, rocks: [k], hulk: h };
  S.hulks.push(h); S.fields.push(h.field); // the same list, so the renderer does not rebuild its rocks
  if (S.hulks.length > MAX_HULKS) { const old = S.hulks.find(o => !o.dead); if (old) { old.dead = true; scrap(old, -1); } }
}
export const hulkAt = (x, y) => S.hulks.find(h => !h.dead && hyp(h.x - x, h.y - y) < Math.max(h.r + 6, 10 / S.cam.z));
export function explosion(x, y, vx, vy, size, secondary = false) {
  const K = S.fxK || 1;
  S.rings.push({ x, y, vx, vy, r: size * .5, max: size * 5, life: .6, maxl: .6, col: 0xffd9a0 });
  if (size > 12) S.rings.push({ x, y, vx, vy, r: size * .3, max: size * 2.5, life: .4, maxl: .4, col: 0xffffff, soft: 1 });
  S.flashes.push({ x, y, vx, vy, r: size * 4, life: .3, max: .3 });
  S.flashes.push({ x, y, vx, vy, r: size * 2.6, life: secondary ? .5 : .8, max: secondary ? .5 : .8, fire: 1 }); // the fireball
  const nf = Math.min(40, 4 + size * .5) * K; // the fire tongues that roll out of it
  for (let i = 0; i < nf; i++) { const a = rand(0, TAU), sp = rand(10, size * 3 + 30); S.parts.push({ x: x + rand(-size * .3, size * .3), y: y + rand(-size * .3, size * .3), vx: vx + Math.cos(a) * sp, vy: vy + Math.sin(a) * sp, life: rand(.4, 1.2), max: 1.2, size: rand(size * .4, size * 1.1) + 4, fire: 1, drag: 1.6 }); }
  if (!secondary && size >= 14) { const n2 = Math.min(6, 1 + Math.floor(size / 12)); for (let i = 0; i < n2; i++) S.fxQ.push({ t: S.time + rand(.25, 1.6), x, y, vx, vy, size: size * rand(.25, .5), sp: size * .9 }); } // secondaries as magazines and fuel go
  const n = Math.min(110, 10 + size * 2.2) * K;
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), sp = rand(20, size * 9 + 60); S.parts.push({ x, y, vx: vx + Math.cos(a) * sp, vy: vy + Math.sin(a) * sp, life: rand(.3, 1.1), max: 1.1, size: rand(2, 4 + size * .08), col: Math.random() < .5 ? 0xffcc66 : 0xff7a3c, drag: 1.2 }); }
  for (let i = 0; i < n / 3; i++) { const a = rand(0, TAU), sp = rand(5, size * 2 + 20); S.parts.push({ x, y, vx: vx + Math.cos(a) * sp, vy: vy + Math.sin(a) * sp, life: rand(1.5, 3.5), max: 3.5, size: rand(size * .2, size * .6) + 4, col: 0x4a4038, smoke: 1, drag: .4 }); }
  sfx(size > 40 ? 'bigboom' : 'boom', x, y, size);
}
export function burst(x, y, vx, vy, n, col, sp, life) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), v = rand(10, sp); S.parts.push({ x, y, vx: vx + Math.cos(a) * v, vy: vy + Math.sin(a) * v, life: rand(.1, life), max: life, size: rand(1.5, 3), col, drag: 2 }); } }
function empBlast(x, y, vx, vy) {
  const R = 280;
  for (const o of S.ships) {
    if (o.dead) continue; const d = hyp(o.x - x, o.y - y); if (d > R + o.r) continue;
    o.emp = Math.max(o.emp, 7 * clamp(Math.sqrt(12 / o.mass), .4, 1.2) * (o.def.static ? .5 : 1)); o.sh *= o.def.shield > 1500 ? .5 : 0; o.shDown = S.time; o.flash = .3; // a capital's shields are too deep to drop in one pulse
  }
  for (const m of S.missiles) if (!m.dead && !m.nuke && hyp(m.x - x, m.y - y) < R) killMissile(m, true);
  S.rings.push({ x, y, vx, vy, r: 20, max: R, life: .8, maxl: .8, col: 0x8fd3ff }, { x, y, vx, vy, r: 10, max: R * .7, life: .5, maxl: .5, col: 0xffffff });
  S.flashes.push({ x, y, vx, vy, r: R * .8, life: .25, max: .25, blue: 1 });
  for (let i = 0; i < 60; i++) { const a = rand(0, TAU), v = rand(100, 700); S.parts.push({ x, y, vx: vx + Math.cos(a) * v, vy: vy + Math.sin(a) * v, life: rand(.2, .7), max: .7, size: rand(1.5, 3), col: Math.random() < .5 ? 0x8fd3ff : 0xe8f6ff, drag: 3 }); }
  sfx('emp', x, y);
}
export function nukeBlast(x, y, vx, vy, team) {
  const R = 650; addWash(x, y); if (S.hooks && S.hooks.nuke) S.hooks.nuke(x, y, team);
  S.flashes.push({ x, y, vx: 0, vy: 0, r: R * 1.4, life: .7, max: .7, col: 0xffe2b8 });
  S.flashes.push({ x, y, vx: 0, vy: 0, r: R * .9, life: 2.6, max: 2.6, fire: 1 }); // the fireball hangs for seconds
  for (let i = 0; i < 24; i++) S.fxQ.push({ t: S.time + rand(.05, .9), x, y, vx: 0, vy: 0, size: rand(30, 70), sp: R * .35 });
  { const d = hyp(x - S.cam.x, y - S.cam.y) * S.cam.z; S.screenFlash = Math.max(S.screenFlash || 0, clamp(.9 - d / 1400, 0, .9)); } // the glare, if it is on or near the screen
  S.rings.push({ x, y, vx: 0, vy: 0, r: 30, max: R * 1.3, life: 1.4, maxl: 1.4, col: 0xfff2d0 }, { x, y, vx: 0, vy: 0, r: 20, max: R * .9, life: 1, maxl: 1, col: 0xff8a4c }, { x, y, vx: 0, vy: 0, r: 10, max: R * .5, life: .6, maxl: .6, col: 0xffffff });
  for (let i = 0; i < 240; i++) { const a = rand(0, TAU), v = rand(60, 1400); S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(.5, 2), max: 2, size: rand(3, 9), col: Math.random() < .4 ? 0xffffff : Math.random() < .5 ? 0xffcc66 : 0xff6a3c, drag: 1.4 }); }
  for (let i = 0; i < 60; i++) { const a = rand(0, TAU), v = rand(20, 250); S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(3, 6), max: 6, size: rand(30, 90), col: 0x4a3a32, smoke: 1, drag: .3 }); }
  for (const o of S.ships) {
    if (o.dead) continue; const d = hyp(o.x - x, o.y - y); if (d > R + o.r) continue; const f = clamp(1 - (d - o.r) / R, 0, 1);
    damage(o, 2400 * f * f, team, x, y, 'nuke'); if (o.dead) continue;
    if (!o.def.static && !o.docked) { const dd = Math.max(d, 90); const dv = 60000 * f / (o.mass * dd); o.vx += (o.x - x) / dd * dv; o.vy += (o.y - y) / dd * dv; o.av += rand(-1, 1) * dv * .004; }
    o.emp = Math.max(o.emp, 4 * f);
  }
  for (const m of S.missiles) if (!m.dead && hyp(m.x - x, m.y - y) < R) killMissile(m, true);
  for (const d of S.debris) { const dd = Math.max(hyp(d.x - x, d.y - y), 60); if (dd < R * 1.5) { d.vx += (d.x - x) / dd * 30000 / dd; d.vy += (d.y - y) / dd * 30000 / dd; } }
  if (onScreen(x, y, R * S.cam.z)) S.screenFlash = Math.max(S.screenFlash, .85);
  sfx('nuke', x, y);
}

// ================================================================ morale
function nearestFoe(s, R) {
  let best = null, bd = R * R;
  query(s.x, s.y, R, o => { if (o.team === s.team || o.team === 2 || o.dead || o.surrendered || o.def.fighter || o.def.shell) return; const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2; if (d2 < bd) { bd = d2; best = o; } });
  return best;
}
function auraPass() {
  for (const s of S.ships) { s.inspired = false; s.shAura = false; }
  for (const c of S.ships) {
    if (c.dead || disabled(c)) continue;
    if (bonus(c, 'inspiring')) query(c.x, c.y, 1200, o => { if (o.team === c.team && hyp(o.x - c.x, o.y - c.y) < 1200) o.inspired = true; });
    if (c.def.aura) query(c.x, c.y, c.def.aura, o => { if (o.team === c.team && hyp(o.x - c.x, o.y - c.y) < c.def.aura) o.shAura = true; });
  }
}
function moraleTick(s) {
  if (s.def.static || s.def.crew <= 2 || s.team === 2) return;
  const base = Math.min(1, loyBase(s.team) + .05 * s.rank + (bonus(s, 'peerless') ? .1 : 0));
  if (s.depot) s.loy = Math.min(base, s.loy + .03);
  else if (S.time - s.lastHit > 10 && s.hp > s.def.hp * .6 && s.loy < base) s.loy = Math.min(base, s.loy + .004);
  if (s.inspired) s.loy = Math.min(1, s.loy + .01);
  if (s.loyT > S.time) s.loy = Math.max(s.loy, .9);
  s.loy = clamp(s.loy, loyFloor(s), 1);
  if (!s.surrendered) {
    if (s.loy < .2 && s.hp < s.def.hp * .5) { const foe = nearestFoe(s, 1600); if (foe && Math.random() < .15) surrender(s, foe.team); }
  } else {
    const foe = nearestFoe(s, 1500);
    let friend = false; query(s.x, s.y, 900, o => { if (o.team === s.team && o !== s && !o.dead && !o.surrendered && !o.def.fighter) friend = true; });
    if (!foe && friend) { if (++s.rescueT >= 10) { s.surrendered = false; s.loy = .35; s.marines = s.crew * s.def.mar * .4; s.rescueT = 0; if (s.team === 0) toast('The ' + s.def.name + ' is back in the fight', 'good', s); } }
    else s.rescueT = 0;
    if (foe && hyp(foe.x - s.x, foe.y - s.y) < foe.r + s.r + 260 && !foe.def.boarder) { if (++s.prizeT >= 4) flipShip(s, foe.team, 'prize', 0); }
    else s.prizeT = 0;
  }
}
export function surrender(s, byTeam) {
  if (facOf(byTeam) && facOf(byTeam).speeches && Math.random() < .5) { flipShip(s, byTeam, 'mutiny', 0); return; }
  s.surrendered = true; s.sh = 0; s.shDown = S.time; s.marines = 0; s.engage = null;
  if (s.team === 0) toast('Your ' + s.def.name + ' has struck its colors', 'bad', s, true);
  else if (byTeam === 0) toast('Enemy ' + s.def.name + ' surrenders · bring a warship alongside or board her to take her', 'good', s, true);
}

// ================================================================ step
export function update(dt) {
  S.time += dt; updBodies(); buildGrid();
  const auraNow = Math.floor(S.time) !== Math.floor(S.time - dt); if (auraNow) auraPass();
  const depots = [[], []]; for (const o of S.ships) if (o.def.depot && o.team < 2 && !o.dead && !o.derelict) depots[o.team].push(o);
  for (const s of S.ships) {
    if (s.dead) continue;
    const d = s.def;
    if (s.flash > 0) s.flash -= dt; if (s.shFlash > 0) s.shFlash -= dt; if (s.emp > 0) { s.emp -= dt; if (s.team < 2 && !d.static) S.bstat.emp[s.team] += dt; }
    const ce = crewEff(s);
    s.derelict = d.crew >= 12 && ce < .12;
    const crewHelm = d.crew > 2 ? .45 + .55 * Math.sqrt(ce) : 1;
    const eng = s.sub ? (s.sub.eng <= 0 ? (s.engWreck ? .03 : .15) : .55 + .45 * s.sub.eng) : 1;
    const br = s.sub ? (s.sub.bridge <= 0 ? .6 : .85 + .15 * s.sub.bridge) : 1;
    s.hf = disabled(s) ? 0 : crewHelm * eng * br * (1 + .2 * bonus(s, 'helm') + .1 * bonus(s, 'peerless')) * (s.fuel > 0 ? 1 : .03) * (s.burnT > S.time ? 1.8 : 1) * (s.helmT > S.time ? 1.4 : 1) * (s.cold ? .15 : 1); /* cold: the drives at a whisper */
    const gq = v => v <= 0 ? .35 : .6 + .4 * v; s.gP = s.sub ? gq(s.sub.gunsP) : 1; s.gS = s.sub ? gq(s.sub.gunsS) : 1; // each broadside by its own gun decks
    s.gf = d.static ? (s.team < 2 ? 1 : .8) : (.3 + .7 * ce) * br * (.7 + .3 * s.loy) * (1 + .2 * bonus(s, 'gunnery') + .1 * bonus(s, 'peerless')) * (1 + .07 * s.rank) * (s.inspired ? 1.08 : 1) * (S.buff && s.team < 2 ? S.buff[s.team].gun : 1) * (s.gunMul || 1) * (s.gunT > S.time ? s.gunK || 1 : 1) * (s.waver > S.time ? .7 : 1) * (s.braceT > S.time ? .5 : 1) * (s.lockT > S.time ? 1.2 : 1) * (s.tiredT > S.time && S.time > (s.tiredA || 0) ? .75 : 1);
    const mx = shMax(s);
    if (s.cold) { const r = mx * (d.faction === 'rim' ? 1 : .5) * dt; if (s.sub) { shSync(s); s.shP = Math.max(0, s.shP - r / 2); s.shS = Math.max(0, s.shS - r / 2); s.sh = s.shP + s.shS; } else s.sh = Math.max(0, s.sh - r); }
    else if (s.sub && !(s.spinT > S.time)) shTick(s, dt, mx, ce); else if (s.sh > mx) s.sh = mx;
    if (!s.sub && !s.cold && !(s.spinT > S.time) && d.shield && mx > 0 && !disabled(s) && S.time - s.shHit > (s.shAura ? 4 : 12) && S.time - s.shDown > (s.shAura ? 5 : 15) && s.sh < mx) s.sh = Math.min(mx, s.sh + d.shield * .03 * (s.shAura ? 3 : 1) * dt * (.3 + .7 * ce) * (S.env ? S.env.shReg : 1));
    // what she puts out. Shields up, a torch on every scope; drives lit, as bright as she burns; cold, shields down and
    // drives idle, almost nothing (a big hull shows a little). Firing, or taking hits on her shields, gives her away
    s.disabledK = disabled(s) ? .5 : 1;
    const shUp = d.shield > 0 && s.sh > d.shield * .05 && !s.cold, big = (d.len || 0) >= 3000 || s.r > 40;
    const drive = s.cold ? (big ? EMIT.coldBig : EMIT.coldSmall) : (EMIT.driveLo + (EMIT.driveHi - EMIT.driveLo) * clamp(s.throttle || 0, 0, 1)) * (d.faction === 'rim' ? EMIT.rimDrive : 1);
    const tsig = d.static ? 1 : (S.time - s.lastFire < 3.2 * TEMPO || S.time - s.shHit < 3 ? 1 : shUp ? EMIT.shields : disabled(s) ? .3 : drive) * (d.sigMul || 1) * (inField(s.x, s.y) ? .5 : 1) * (S.env ? S.env.sig : 1);
    s.sig += (tsig - s.sig) * Math.min(1, dt * 2);
    s.atBase = false; s.depot = null;
    if (s.team < 2 && !d.static && !s.docked) for (const st of depots[s.team]) if (hyp(s.x - st.x, s.y - st.y) < st.def.service) { s.depot = st; break; }
    if (s.depot && !disabled(s)) { s.atBase = true; serviceShip(s, dt, (s.depot.def.fullService ? 1 : .5) * (s.depot.serviceMul || 1), !!s.depot.def.fullService); }
    if (!d.static && d.crew > 2 && !disabled(s) && S.time - s.lastHit > 8) {
      if (s.hp < d.hp * .7) s.hp += d.hp * .006 * ce * dt;
      if (s.sub) for (const k in s.sub) if (s.sub[k] < .5) s.sub[k] = Math.min(.5, s.sub[k] + .008 * ce * dt);
    }
    if (d.static && s.team < 2 && !s.derelict && S.time - s.lastHit > 10 && s.hp < d.hp) s.hp = Math.min(d.hp, s.hp + d.hp * .003 * dt);
    s.moraleT -= dt; if (s.moraleT <= 0) { s.moraleT = 1; moraleTick(s); }
    // (the smoke from a wrecked engine room, bridge or gun deck is drawn by the renderer, where that compartment sits on the hull)
    if (s.h) { s.hangT -= dt; if (s.hangT <= 0) { s.hangT = .5; carrierTick(s); } }
    if (s.docked) {
      const t = s.docked.t; if (t.dead || t.team === s.team) { s.docked = null; setIdle(s); continue; }
      const ca = Math.cos(t.a), sa = Math.sin(t.a); s.x = t.x + ca * s.docked.ox - sa * s.docked.oy; s.y = t.y + sa * s.docked.ox + ca * s.docked.oy; s.vx = t.vx; s.vy = t.vy; s.a = Math.atan2(t.y - s.y, t.x - s.x); s.throttle = 0;
      boardingFight(s, t, dt); continue;
    }
    if (d.static) {
      if (s.orbit) { const o = s.orbit, b = BODIES[o.b], w = TAU / o.period, ph = o.ph + S.time * w; s.x = b.x + Math.cos(ph) * o.R; s.y = b.y + Math.sin(ph) * o.R; s.vx = b.vx - Math.sin(ph) * o.R * w; s.vy = b.vy + Math.cos(ph) * o.R * w; s.a = ph + PI / 2; }
      else { s.a += (s.type === 'station' ? .03 : .01) * dt; s.vx = s.vy = 0; }
      continue;
    }
    if (disabled(s)) { s.throttle *= Math.max(0, 1 - dt * 4); s.rx = s.ry = 0; }
    else if (s.team < 2) { if (s.pend && S.time >= s.pend.at && !(s.freezeT > S.time)) { s.order = s.pend.order; s.engage = s.pend.engage || null; s.pend = null; } s.transit = 0; think(s, dt); applyThrust(s, dt); }
    if (!s.anchored) { const gv = grav(s.x, s.y); s.vx += gv.x * dt; s.vy += gv.y * dt; }
  }
  for (const s of S.ships) {
    if (s.dead) continue;
    if (s.boardProg > 0 && S.time - s.boardT > .2) s.boardProg = Math.max(0, s.boardProg - dt * .3);
    if (s.def.static || s.docked) continue;
    if (s.anchored && s.team !== 2) s.anchored = false;
    s.x += s.vx * dt; s.y += s.vy * dt; s.a += s.av * dt;
    if (Math.abs(s.x) > WORLD) s.vx -= Math.sign(s.x) * 60 * dt; if (Math.abs(s.y) > WORLD) s.vy -= Math.sign(s.y) * 60 * dt;
    const b = bodyHit(s.x, s.y, s.r * .5); if (b) {
      // the surface is hard: a ship that touches down is pushed back out; it burns up only if it hit fast
      const nx = s.x - b.x, ny = s.y - b.y, nd = hyp(nx, ny) || 1, ux = nx / nd, uy = ny / nd, vin = -((s.vx - b.vx) * ux + (s.vy - b.vy) * uy);
      s.x = b.x + ux * (b.r + s.r * .5 + 2); s.y = b.y + uy * (b.r + s.r * .5 + 2); if (vin > 0) { s.vx += ux * vin * 1.2; s.vy += uy * vin * 1.2; }
      const harm = s.def.hp * clamp((vin - 140) / 420, 0, 2);
      if (harm >= s.hp) { if (s.team === 0) toast(s.def.name + ' burned up on ' + b.name, 'bad', { x: s.x, y: s.y }, true); damage(s, 1e9, -1, s.x, s.y, 'internal'); continue; }
      if (harm > 0) { damage(s, harm, -1, s.x, s.y, 'internal'); if (s.team === 0 && S.time - (s.skimT || -99) > 8) { s.skimT = S.time; toast(s.def.name + ' scraped ' + b.name + "'s atmosphere", 'bad', s); } }
    }
    rocksNear(s.x, s.y, s.r, k => {
      const dx = s.x - k.x, dy = s.y - k.y, dd = hyp(dx, dy) || 1, m = k.r * .9 + s.r * .8; if (dd >= m) return;
      const nx = dx / dd, ny = dy / dd; s.x += nx * (m - dd); s.y += ny * (m - dd);
      const vn = (s.vx - (k.vx || 0)) * nx + (s.vy - (k.vy || 0)) * ny; // a field that rides with a moon moves with it
      if (vn < 0) { s.vx -= 1.5 * vn * nx; s.vy -= 1.5 * vn * ny; if (-vn > 30) { const E = Math.min(.5 * s.mass * vn * vn * .0018, 4000); damage(s, E, -1, k.x, k.y, 'ram'); burst(s.x - nx * s.r, s.y - ny * s.r, 0, 0, 10, 0xcfc0a8, 120, .5); } }
    });
  }
  for (const t of S.ships) {
    if (t.dead || t.type !== 'tender' || disabled(t) || t.supply <= 0) continue;
    t.resupplying = false;
    query(t.x, t.y, 520, o => {
      if (o === t || o.team !== t.team || o.dead || o.def.static || o.docked || o.atBase) return; if (hyp(o.x - t.x, o.y - t.y) > 520) return;
      for (const w of o.weapons) { if (w.def.nuke || w.ammo >= w.mag) continue; const amt = Math.min(w.mag * .06 * dt, w.mag - w.ammo); const cost = amt / w.mag * w.def.supply; if (t.supply < cost) break; w.ammo += amt; t.supply -= cost; t.resupplying = true; }
      if (o.fuel < 1 && t.supply > 1) { const f = Math.min(.05 * dt, 1 - o.fuel); o.fuel += f; t.supply -= f * 40; t.resupplying = true; }
      if (o.def.crew > 2 && o.crew < o.def.crew && t.supply > 1) { const c = Math.min(o.def.crew * .01 * dt, o.def.crew - o.crew); o.crew += c; t.supply -= c / o.def.crew * 40; t.resupplying = true; }
    });
    if (t.resupplying && Math.random() < .1) burst(t.x, t.y, t.vx, t.vy, 2, 0x7ff3ff, 60, .4);
  }
  buildGrid();
  for (const a of S.ships) { if (a.dead || a.docked) continue; query(a.x, a.y, a.r + 70, b => { if (b.id <= a.id || b.dead || b.docked) return; collide(a, b); }); }
  for (const s of S.ships) if (!s.dead && !s.docked) updWeapons(s, dt);
  for (const p of S.ships) {
    if (!p.def.producer || p.dead || p.team > 1 || !p.queue.length) continue;
    const q = p.queue[0]; q.t += dt * (p.buildMul || 1); if (q.t >= defOf(p.team, q.type).time) spawnUnit(p.team, p.queue.shift().type, p);
  }
  for (const s of S.ships) {
    if (s.dead || s.team > 1 || !s.def.static || s.derelict) continue;
    const p = s.def.prod; if (!p || (s.world && s.type !== 'station')) continue;
    const k = dt * (s.team === 1 ? DIFF[S.difficulty].inc : 1) * crewEff(s);
    const man = (p.man === 'recruit' ? facOf(s.team).recruit : p.man * facOf(s.team).liberate) * k * (S.food && S.food[s.team] < 0 ? .6 : 1);
    S.res[s.team] += p.he * k; S.ord[s.team] += p.ord * k; S.man[s.team] += man;
    logProd(s.team, 'he', p.he * k); logProd(s.team, 'ord', p.ord * k); logProd(s.team, 'man', man); S.stats.recruited += s.team === 0 ? man : 0;
  }
  if (auraNow) worldTick();
  if (auraNow) for (const c of S.cmdrs) if (c.state === 'pod' && --c.timer <= 0) { c.state = 'ready'; if (c.team === 0) toast(c.name + ' is back at the citadel and ready for a command', 'good'); }
  updShots(dt); updMissiles(dt); updFx(dt); if (S.wrecks.length || S.hulks.length) wreckTick(dt);
  S.fogT -= dt; if (S.fogT <= 0) { S.fogT = .25; updFog(); }
  S.grpT = (S.grpT || 0) - dt; if (S.grpT <= 0) { S.grpT = .5; groupTick(); }
  S.AI.t -= dt; if (S.AI.t <= 0) { S.AI.t = 1; if (S.gameState === 'play') (S.aiHook || aiTick)(); }
  S.ships = S.ships.filter(s => !s.dead);
  if (S.selection.length) S.selection = S.selection.filter(s => !s.dead && s.team === 0);
}
function shTick(s, dt, mx, ce) {
  shSync(s); const d = s.def;
  for (const side of [-1, 1]) { // after a brace the thrown power bleeds back to the other half
    const k = side > 0 ? 'shS' : 'shP', o = side > 0 ? 'shP' : 'shS', cap = halfCap(s, side);
    if (s[k] > cap) { const m = Math.min(s[k] - cap, mx * .25 * dt); s[k] -= m; s[o] = Math.min(halfCap(s, -side), s[o] + m); }
  }
  if (d.shield && mx > 0 && !disabled(s) && S.time - s.shDown > (s.shAura ? 5 : 15)) for (const side of [-1, 1]) {
    const k = side > 0 ? 'shS' : 'shP', h = side > 0 ? s.hitS : s.hitP, dn = side > 0 ? s.downS : s.downP, cap = halfCap(s, side);
    if (s[k] < cap && S.time - (h ?? -99) > (s.shAura ? 4 : 12) && S.time - (dn ?? -99) > (s.shAura ? 5 : 15)) s[k] = Math.min(cap, s[k] + d.shield * .015 * (s.shAura ? 3 : 1) * dt * (.3 + .7 * ce) * (S.env ? S.env.shReg : 1));
  }
  s.sh = s.shP + s.shS;
}
function serviceShip(s, dt, rate, full) {
  const d = s.def;
  const T = s.team; s.short = null;
  if (s.hp < d.hp) { const add = Math.min(d.hp - s.hp, d.hp * .02 * dt * rate), cost = add / d.hp * (d.ore || 50) * .5; if (S.ore[T] >= cost) { s.hp += add; S.ore[T] -= cost; } else s.short = 'ore'; }
  if (full) {
    if (d.crew > 2 && s.crew < d.crew) { const add = Math.min(d.crew - s.crew, d.crew * .03 * dt, S.man[T]); if (add > 0) { s.crew += add; S.man[T] -= add; } else s.short = 'man'; }
    const maxM = Math.round(d.crew * d.mar); if (s.marines < maxM) s.marines = Math.min(maxM, s.crew, s.marines + Math.max(1, maxM) * .04 * dt);
    if (d.troops && s.troops < d.troops) { const add = Math.min(d.troops - s.troops, d.troops * .1 * dt, S.man[T]); s.troops += add; S.man[T] -= add; }
  }
  if (d.supply && s.supply < d.supply) { const add = Math.min(d.supply - s.supply, d.supply * .08 * dt, S.ord[T]); s.supply += add; S.ord[T] -= add; }
  if (s.fuel < 1) { const add = Math.min(1 - s.fuel, .12 * dt * rate), cost = add * (d.value || 100) * .05; if (S.res[s.team] >= cost) { s.fuel += add; S.res[s.team] -= cost; } }
  if (s.sub) for (const k in s.sub) if (s.sub[k] < 1) s.sub[k] = Math.min(1, s.sub[k] + .06 * dt * rate);
  for (const w of s.weapons) {
    if (w.ammo >= w.mag) continue;
    if (w.def.nuke) { if (!full) continue; w.nfill += dt / 12; if (w.nfill >= 1 && S.ord[T] >= NUKE_COST.ord && S.res[T] >= NUKE_COST.he) { S.ord[T] -= NUKE_COST.ord; S.res[T] -= NUKE_COST.he; w.ammo++; w.nfill = 0; if (T === 0) toast(`Nuclear missile restocked (−${NUKE_COST.ord} ordnance, −${NUKE_COST.he} He-3)`, ''); } else if (w.nfill > 1) w.nfill = 1; }
    else { const add = Math.min(w.mag - w.ammo, w.mag * .1 * dt * rate), cost = add / w.mag * w.def.supply; if (S.ord[T] >= cost) { w.ammo += add; S.ord[T] -= cost; } else s.short = 'ord'; }
  }
  if (s.h && full) {
    s.hfill += dt;
    if (s.hfill >= 1.2) { s.hfill = 0; for (const k in s.h) if (s.h[k] < d.hangar[k] && S.res[T] >= REPLACE_COST[k] && S.man[T] >= REPLACE_MAN[k]) { S.res[T] -= REPLACE_COST[k]; S.man[T] -= REPLACE_MAN[k]; s.h[k]++; } }
  }
}
function boardingFight(s, t, dt) {
  const D = s.def; if (S.time - (t.boardT ?? -99) > 2) t.boardT0 = S.time; t.boardT = S.time; t.boardTeam = s.team;
  const leg = s.team < 2 ? 1 + .1 * Math.min(5, S.legion[s.team]) : 1;
  // what the boarders are going for: by default they storm her wherever they get in. Ordered, they cut for the bridge (quickest,
  // and the bridge is wrecked in the fighting), blow the engines (she is dead in space whatever happens after), or take her
  // whole, deck by deck (slow, but she comes over intact). The order rides with the boarders; ours can change it aboard
  const aim = (s.team === 0 && (t.boardAim || S.boardAim0)) || s.boardAim || (s.team === 1 && t.def.cmd && S.aiBoardAim) || 'storm', aimK = aim === 'whole' ? .6 : aim === 'engines' ? 1.15 : aim === 'bridge' ? 1.25 : 1;
  const kill = s.troops * D.killRate * leg * s.breachMul * (s.howlT > S.time ? 1.6 : 1) * (t.duelK || 1) * aimK * dt;
  t.marines = Math.max(0, t.marines - kill);
  t.crew = Math.max(t.marines, t.crew - kill * 1.15);
  // Rising boarders call on the lowColors to rise. Gold-heavy crews are harder to sway.
  if (s.team < 2 && facOf(s.team).speeches && t.def.crew > 2) {
    let atk = 0; for (const o of S.ships) if (o.docked && o.docked.t === t && !o.dead) atk += o.troops;
    const sway = Math.min(1, atk / (t.marines * .5 + 1)); // a big garrison drowns out the speeches
    const low = Math.max(0, t.crew - t.marines); const incite = (1 - t.loy) * low * .003 * sway * dt;
    t.marines = Math.max(0, t.marines - incite * .5); t.loy = Math.max(0, t.loy - .035 * sway * dt * resist(t));
    t.speechT = (t.speechT || 0) - dt;
    if (t.speechT <= 0) { t.speechT = 1; if (Math.random() < (1 - t.loy) * .12 * sway * resist(t) / .8) { flipShip(t, s.team, 'mutiny', 0); return; } }
    if (t.loy < .25) { flipShip(t, s.team, 'mutiny', 0); return; }
  }
  s.troops -= Math.min(t.marines, D.frontage) * .05 * (bonus(t, 'breacher') ? 1.5 : 1) * (t.duelD || 1) * dt;
  if (S.hooks && S.hooks.board) S.hooks.board(s, t, dt);
  let atk = 0; for (const o of S.ships) if (o.docked && o.docked.t === t && !o.dead) atk += o.troops;
  t.boardProg = clamp(atk / (atk + t.marines + .01), 0, 1);
  if (aim === 'engines' && !t.engWreck && t.sub && S.time - (t.boardT0 ?? S.time) > (t.boardProg > .4 ? 10 : 18)) { t.engWreck = true; t.sub.eng = 0; t.boardAim = null; s.boardAim = null; burst(t.x, t.y, t.vx, t.vy, 30, 0xff9a4a, t.r * 2, .8); if (S.hooks && S.hooks.wrecked) S.hooks.wrecked(t, s); }
  if (Math.random() < .1) burst(s.x, s.y, s.vx, s.vy, 2, 0xffb36b, 90, .3);
  if (s.troops <= 0) { s.troops = 0; s.dead = true; burst(s.x, s.y, s.vx, s.vy, 8, 0x888888, 80, .6); return; }
  if (t.marines <= .5) flipShip(t, s.team, aim === 'whole' ? 'whole' : aim === 'bridge' ? 'bridge' : 'board', 0);
}
function collide(a, b) {
  const fast = s => s.tOn && hyp(s.vx, s.vy) > s.def.cruise * 3; if (fast(a) || fast(b) || (a.team === b.team && (a.tOn || b.tOn))) return; // a ship on a transit burn passes above or below the traffic
  const dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy) || 1e-3; const m = a.r * .8 + b.r * .8; if (d >= m) return;
  const nx = dx / d, ny = dy / d; const ia = a.def.static ? 0 : 1 / a.mass, ib = b.def.static ? 0 : 1 / b.mass; if (ia + ib === 0) return;
  const corr = (m - d) / (ia + ib); a.x -= nx * corr * ia; a.y -= ny * corr * ia; b.x += nx * corr * ib; b.y += ny * corr * ib;
  const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rvn < 0) {
    const j = -1.3 * rvn / (ia + ib); a.vx -= j * nx * ia; a.vy -= j * ny * ia; b.vx += j * nx * ib; b.vy += j * ny * ib;
    if (-rvn > 35) {
      const mu = 1 / (ia + ib); const E = Math.min(.5 * mu * rvn * rvn * .0018, 6000);
      const fe = a.team === b.team ? .3 : 1; damage(a, E * fe, b.team, b.x, b.y, 'ram', b); damage(b, E * fe, a.team, a.x, a.y, 'ram', a);
      burst(a.x + nx * a.r, a.y + ny * a.r, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2, Math.min(30, 4 + E / 10), 0xffd38a, 200, .5); if (E > 40) sfx('clang', a.x, a.y);
    }
  }
}
// change of ownership: boarding, mutiny, or a prize crew taking a surrendered ship
export function flipShip(t, team, how, extra) {
  const old = t.team; let surv = extra || 0;
  for (const o of S.ships) if (o.docked && o.docked.t === t) { surv += o.troops; o.dead = true; }
  if (t.cmdr) commanderCaptured(t.cmdr, team, t);
  t.team = team; t.surrendered = false; t.boardProg = 0; t.rescueT = t.prizeT = 0; t.anchored = false; setIdle(t); t.engage = null; t.hmode = 'auto';
  for (const w of t.weapons) { w.target = null; w.salvo = 0; w.volley = 0; }
  const maxM = Math.round(t.def.crew * t.def.mar); t.vis = [true, true, true];
  if (how === 'mutiny') { t.crew = Math.max(t.crew * .85, t.def.crew * .15); t.marines = Math.min(maxM, t.crew * t.def.mar * .6 + surv); t.loy = .65; }
  else if (how === 'prize') { t.crew = Math.max(t.crew * .8, t.def.crew * .15); t.marines = Math.min(maxM, maxM * .2 + surv); t.loy = .4; }
  else if (how === 'whole') { t.marines = Math.min(surv, maxM); t.crew = Math.max(t.crew * .95, t.def.crew * .25, t.marines); t.loy = .6; t.whole = true; }
  else { t.marines = Math.min(surv, maxM); t.crew = Math.max(t.crew * .8, t.def.crew * .15, t.marines); t.loy = .45; if (how === 'bridge' && t.sub) t.sub.bridge = Math.min(t.sub.bridge, .3); /* the bridge was where they fought */ }
  if (t.def.static && team < 2) { const freed = Math.max(0, t.crew - t.marines) * .5 * facOf(team).liberate; S.man[team] += freed; if (team === 0) S.stats.liberated += freed; if (team === 0 && freed > 20) toast(Math.round(freed).toLocaleString() + ' workers join your manpower pool', 'good'); }
  if (t.def.static && t.crew < t.def.crew * .15) t.crew = t.def.crew * .15;
  if (t.queue) t.queue = []; t.rally = null; if (S.builder === t) S.builder = null;
  if ((how === 'board' || how === 'whole' || how === 'bridge') && old < 2 && team < 2) S.legion[team]++;
  if (how === 'board' && old === 2 && team < 2) S.legion[team] += .5;
  if (team === 0) { S.stats.captured++; if (how === 'mutiny') S.stats.mutinies++; }
  S.rings.push({ x: t.x, y: t.y, vx: t.vx, vy: t.vy, r: t.r, max: t.r * 4, life: 1, maxl: 1, col: parseInt(S.teamc[team].main.slice(1), 16) });
  const nm = t.def.name;
  if (team === 0) toast(how === 'mutiny' ? `The lowColors of the ${nm} rise up and join you!` : how === 'prize' ? `Prize crew takes the ${nm}` : old === 2 ? `${nm} claimed` : `${nm} taken! ${Math.round(surv)} boarders hold her decks`, 'good', t, true);
  else if (old === 0) toast(how === 'mutiny' ? `Mutiny! The crew of your ${nm} has gone over to the enemy` : `Your ${nm} was taken by enemy ${how === 'prize' ? 'prize crew' : 'boarders'}`, 'bad', t, true);
  else if (old === 2 && team === 1) toast('The enemy has claimed a ' + nm, 'bad', t);
  if (old === 0) { S.selection = S.selection.filter(s => s !== t); leaveGroup(t); }
  if (S.hooks && S.hooks.capture) S.hooks.capture(t, team, old, how);
  sfx('capture', t.x, t.y);
}
function updShots(dt) {
  for (const p of S.shots) {
    p.px = p.x; p.py = p.y;
    if (p.D.kind === 'slug') { const gv = grav(p.x, p.y); p.vx += gv.x * dt; p.vy += gv.y * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.life <= 0) { p.dead = true; continue; }
    if (p.D.kind !== 'slug') {
      for (const m of S.missiles) { if (m.dead || m.team === p.team) continue; if (segHit(p.px, p.py, p.x, p.y, m.x, m.y, 11) >= 0) { m.hp -= p.D.dmg; p.dead = true; if (m.hp <= 0) killMissile(m, true); break; } }
      if (p.dead) continue;
    }
    const mx = (p.x + p.px) / 2, my = (p.y + p.py) / 2, half = hyp(p.x - p.px, p.y - p.py) / 2;
    let hit = null, ht = 2; const fuse = p.D.kind === 'slug' && p.owner && (p.owner.def.fc || 1) >= 4; /* a line ship's rounds are fused to burst beside a small hull */
    query(mx, my, half + 20 + (fuse ? 90 : 0), o => { if (o.team === p.team || o.dead || o === p.skip || (o.team === 2 && o.derelict && p.owner && p.owner.order.t !== o)) return; const R = (o.sh > 0 ? o.r * 1.25 : o.r * .85) * (fuse && (o.def.len || 0) < 700 ? 4 : 1); const t = segHit(p.px, p.py, p.x, p.y, o.x, o.y, R); if (t >= 0 && t < ht) { ht = t; hit = o; } });
    const rk = segRock(p.px, p.py, p.x, p.y);
    if (rk && (!hit || rk.t < ht)) { p.dead = true; const hx = p.px + (p.x - p.px) * rk.t, hy = p.py + (p.y - p.py) * rk.t; burst(hx, hy, 0, 0, p.D.kind === 'slug' ? 10 : 2, 0xcfc0a8, 150, .4); continue; }
    // a heavy gun laid for capital ships tracks a small, quick hull badly: the round may pass by her and fly on
    if (hit && p.D.track && hit.def.len && !disabled(hit)) { const o = p.owner, fc = (o && o.def.fc) || 1, under = hit.def.len < 700 && p.d0 && p.d0 < 2500 && o && (o.def.len || 0) >= 5000 ? .5 : 1; /* under the guns */
      if (Math.random() > clamp(hit.def.len * fc / p.D.track, o && o.lockT > S.time ? Math.max(.75, p.D.trackMin || .25) : (p.D.trackMin || .25), 1) * under) { p.skip = hit; hit = null; } }
    if (hit) {
      const rvx = p.vx - hit.vx, rvy = p.vy - hit.vy, rs = hyp(rvx, rvy) || 1;
      const k = clamp((rs / p.D.speed) ** 2, .35, 1.3);
      const hx = p.px + (p.x - p.px) * ht, hy = p.py + (p.y - p.py) * ht, hx0 = hx, hy0 = hy;
      const shielded = hit.sh > 0;
      if (p.D.kind === 'slug' && !hit.def.static) { const J = p.D.dmg * 1.5 * k * (shielded ? .4 : 1); hit.vx += rvx / rs * J / hit.mass; hit.vy += rvy / rs * J / hit.mass; }
      damage(hit, p.D.dmg * k, p.team, hx, hy, p.D.bow ? 'lance' : p.D.kind, p.owner);
      // the hit is judged on the hit circle, but it is SEEN where the round's line meets the hull as drawn (S.skinAt, from
      // the renderer): a long thin hull struck on the beam no longer sparks in empty space beside her. Shield hits stay on
      // the bubble, and a fused round bursting beside a small hull stays where it burst. Nothing here changes the battle.
      const vis = !shielded && !(fuse && (hit.def.len || 0) < 700) && S.skinAt ? S.skinAt(hit, hx, hy, rvx, rvy) : null;
      if (vis) { hit.hitX = vis[0]; hit.hitY = vis[1]; }
      { const hx = vis ? vis[0] : hx0, hy = vis ? vis[1] : hy0;
      const c = shielded ? 0x8fd3ff : (p.D.kind === 'slug' ? 0xdff4ff : 0xffcf8a);
      burst(hx, hy, hit.vx, hit.vy, p.D.kind === 'slug' ? (p.D.huge ? 60 : p.D.big ? 40 : 12) : 3, c, p.D.kind === 'slug' ? (p.D.big ? 500 : 260) : 120, p.D.kind === 'slug' ? .6 : .25);
      if (shielded) { if (S.hooks && S.hooks.ripple) S.hooks.ripple(hit, hx, hy, p.D.big || p.D.huge); if (S.ripples && S.ripples.length < 160) S.ripples.push({ s: hit, a: Math.atan2(hy - hit.y, hx - hit.x), t: S.time, big: p.D.big || p.D.huge }); }
      else if (p.D.kind === 'slug') { const n = p.D.huge ? 40 : p.D.big ? 24 : 7, ha = Math.atan2(p.vy, p.vx); /* sparks off the armour, thrown back along the shot */
        for (let i = 0; i < n * (S.fxK || 1); i++) { const a = ha + PI + rand(-1.1, 1.1), v = rand(120, p.D.big ? 700 : 420); S.parts.push({ x: hx, y: hy, vx: hit.vx + Math.cos(a) * v, vy: hit.vy + Math.sin(a) * v, life: rand(.25, .7), max: .7, size: 2, col: Math.random() < .6 ? 0xffd080 : 0xfff4e0, spark: 1, drag: 1.2 }); }
        if (p.D.big || p.D.huge) S.flashes.push({ x: hx, y: hy, vx: hit.vx, vy: hit.vy, r: p.D.huge ? 30 : 16, life: .35, max: .35, fire: 1, col: 0xffc080 }); }
      if (p.D.kind === 'slug') { S.rings.push({ x: hx, y: hy, vx: hit.vx, vy: hit.vy, r: 3, max: p.D.huge ? 180 : p.D.big ? 90 : 26, life: .3, maxl: .3, col: shielded ? 0x8fd3ff : 0xffe0b0, soft: !p.D.big && !p.D.huge }); sfx('hit', hx, hy); } }
      p.dead = true; continue;
    }
    const b = bodyHit(p.x, p.y, 0); if (b) { p.dead = true; if (p.D.kind === 'slug') burst(p.x, p.y, b.vx, b.vy, 8, 0xff9a6a, 120, .6); }
  }
  S.shots = S.shots.filter(p => !p.dead);
}
export function killMissile(m, intercepted) {
  if (m.dead) return; m.dead = true;
  if (m.nuke && !intercepted) { nukeBlast(m.x, m.y, m.vx, m.vy, m.team); return; }
  if (m.emp && !intercepted) { empBlast(m.x, m.y, m.vx * .3, m.vy * .3); return; }
  burst(m.x, m.y, m.vx * .3, m.vy * .3, intercepted ? 10 : 16, m.nuke ? 0xffffff : 0xffb36b, intercepted ? 140 : 220, .4);
  S.flashes.push({ x: m.x, y: m.y, vx: m.vx * .3, vy: m.vy * .3, r: intercepted ? (m.nuke ? 60 : 26) : 45, life: .15, max: .15 });
  if (m.nuke && intercepted && m.team === 1) toast('Nuke intercepted by point defense', 'good');
}
function updMissiles(dt) {
  for (const m of S.missiles) {
    if (m.dead) continue;
    m.life -= dt; m.arm -= dt;
    let t = m.t; if (t && (t.dead || t.team === m.team)) t = m.t = null;
    if (!t && !m.tp && m.fuel > 0 && !m.nuke) { let best = null, bd = 1500 * 1500; query(m.x, m.y, 1500, o => { if (o.team === m.team || o.dead || o.team === 2 || o.surrendered) return; const d2 = (o.x - m.x) ** 2 + (o.y - m.y) ** 2; if (d2 < bd) { bd = d2; best = o; } }); m.t = t = best; }
    let thrusting = false; const tgt = t || m.tp;
    if (tgt && m.fuel > 0 && m.arm < .2) {
      const tvx = t ? t.vx : 0, tvy = t ? t.vy : 0;
      const rx = tgt.x - m.x, ry = tgt.y - m.y, d = hyp(rx, ry) || 1;
      const cl = m.tp ? Math.min(1150, 40 + d * 1.2) : 1150;
      const ax = ((rx / d * cl) - (m.vx - tvx)) * 2.5, ay = ((ry / d * cl) - (m.vy - tvy)) * 2.5;
      m.a += clamp(angDiff(m.a, Math.atan2(ay, ax)), -5 * dt, 5 * dt);
      const acc = m.nuke ? 520 : 640; m.vx += Math.cos(m.a) * acc * dt; m.vy += Math.sin(m.a) * acc * dt; m.fuel -= dt; thrusting = true;
    }
    const gv = grav(m.x, m.y); m.vx += gv.x * dt; m.vy += gv.y * dt;
    m.x += m.vx * dt; m.y += m.vy * dt; m.thrusting = thrusting;
    m.trailT -= dt;
    if (m.trailT <= 0) { m.trailT = .03; S.parts.push({ x: m.x - Math.cos(m.a) * 6, y: m.y - Math.sin(m.a) * 6, vx: m.vx * .1, vy: m.vy * .1, life: thrusting ? .6 : .3, max: .6, size: thrusting ? (m.nuke ? 6 : 3.5) : 2, col: thrusting ? (m.emp ? 0x8fd3ff : m.nuke ? 0xffffff : 0xffb070) : 0x777777, smoke: thrusting ? 0 : 1 }); }
    if (m.life <= 0) { killMissile(m, false); continue; }
    if (m.tp && hyp(m.tp.x - m.x, m.tp.y - m.y) < 60) { killMissile(m, false); continue; }
    if (rocksNear(m.x, m.y, 4, k => hyp(m.x - k.x, m.y - k.y) < k.r * .9)) { killMissile(m, false); continue; }
    if (m.arm <= 0) {
      let hit = null; const fuse = m.nuke ? 60 : (m.emp ? 40 : 10);
      query(m.x, m.y, 30 + fuse, o => { if (o.team === m.team || o.dead || (o.team === 2 && o !== m.t)) return; if (hyp(o.x - m.x, o.y - m.y) < (o.sh > 0 ? o.r * 1.25 : o.r * .85) + fuse) { hit = o; return true; } });
      if (hit) {
        if (m.nuke || m.emp) { if (m.emp) damage(hit, m.dmg, m.team, m.x, m.y, 'missile', m.src); killMissile(m, false); continue; }
        { const vis = !(hit.sh > 0) && S.skinAt ? S.skinAt(hit, m.x, m.y, m.vx - hit.vx, m.vy - hit.vy) : null, mx0 = m.x, my0 = m.y; // it bursts on her skin as drawn, not on the hit circle
          if (vis) { m.x = vis[0]; m.y = vis[1]; } killMissile(m, false); m.x = mx0; m.y = my0;
          damage(hit, m.breach && !bigHull(hit) ? m.dmg * .25 : m.dmg, m.team, m.x, m.y, 'missile', m.src); if (vis) { hit.hitX = vis[0]; hit.hitY = vis[1]; } }
        query(m.x, m.y, 60, o => { if (o !== hit && o.team !== m.team && !o.dead && hyp(o.x - m.x, o.y - m.y) < o.r + 50) damage(o, m.dmg * .3, m.team, m.x, m.y, 'missile', m.src); });
        S.rings.push({ x: m.x, y: m.y, vx: hit.vx, vy: hit.vy, r: 4, max: 60, life: .35, maxl: .35, col: 0xffcf8a }); sfx('boom', m.x, m.y, 6); continue;
      }
    }
    if (bodyHit(m.x, m.y, 0)) killMissile(m, false);
  }
  S.missiles = S.missiles.filter(m => !m.dead);
}
function updFx(dt) {
  for (const p of S.parts) { p.life -= dt; const dr = p.drag ? Math.max(0, 1 - p.drag * dt) : 1; p.vx *= dr; p.vy *= dr; p.x += p.vx * dt; p.y += p.vy * dt; }
  S.parts = S.parts.filter(p => p.life > 0); if (S.parts.length > 4500) S.parts.splice(0, S.parts.length - 4500);
  for (const d of S.debris) {
    const gv = grav(d.x, d.y); d.vx += gv.x * dt; d.vy += gv.y * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.av * dt; d.life -= dt;
    if (bodyHit(d.x, d.y, 0)) { d.life = 0; burst(d.x, d.y, 0, 0, 6, 0xff9a6a, 80, .5); }
  }
  S.debris = S.debris.filter(d => d.life > 0);
  for (const r of S.rings) { r.life -= dt; r.x += r.vx * dt; r.y += r.vy * dt; r.r += (r.max - r.r) * Math.min(1, dt * 8); }
  S.rings = S.rings.filter(r => r.life > 0);
  for (const f of S.flashes) { f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; }
  S.flashes = S.flashes.filter(f => f.life > 0);
  if (S.ripples && S.ripples.length) S.ripples = S.ripples.filter(q => S.time - q.t < .4 && !q.s.dead);
  if (S.fxQ && S.fxQ.length) { const due = S.fxQ.filter(q => q.t <= S.time); if (due.length) { S.fxQ = S.fxQ.filter(q => q.t > S.time); for (const q of due) explosion(q.x + rand(-q.sp, q.sp), q.y + rand(-q.sp, q.sp), q.vx, q.vy, q.size, true); } }
  if (S.screenFlash > 0) S.screenFlash = Math.max(0, S.screenFlash - dt * .9);
  for (const m of S.markers) m.life -= dt; S.markers = S.markers.filter(m => m.life > 0);
}
// fire control: a ship is in sight (locked, and every gun of the fleet may fire on her) when any ship of the side holds a
// lock on her. Locks reach as far as the observer's fire control, shortened by the glare and the ground and by how little
// she is putting out (sense.js). A ship already being fought stays locked out to the full lock range. A fresh nuclear
// blast hides everything inside it.
function updFog() {
  const rub = S.worlds ? bodyOf('luna') : null;
  for (let T = 0; T < 3; T++) {
    const obs = S.ships.filter(s => s.team === T && !s.dead && !s.derelict);
    for (const s of S.ships) {
      if (s.team === T || s.def.static || s.team === 2) { s.vis[T] = true; continue; }
      let v = false;
      if (T < 2 && rub && worldOwner('luna') === T && hyp(s.x - rub.x, s.y - rub.y) < 300000) { s.vis[T] = true; continue; }
      if (S.wash && S.wash.length && inWash(s)) { s.vis[T] = false; continue; }
      for (const o of obs) {
        const dx = o.x - s.x, dy = o.y - s.y, R = lockRange(o, s);
        if (Math.abs(dx) < R && Math.abs(dy) < R && dx * dx + dy * dy < R * R && losClear(o.x, o.y, s.x, s.y)) { v = true; break; }
        if (s.vis[T] && (o.engage === s || o.order.t === s)) { const R2 = lockOf(o) * (S.env ? S.env.sight : 1); if (dx * dx + dy * dy < R2 * R2 && losClear(o.x, o.y, s.x, s.y)) { v = true; break; } } // fire control holds a lock on what it is fighting
      }
      if (T === 0 && v && !s.vis[0] && s.team === 1 && !s.def.fighter && !s.def.shell && s.type !== 'hauler') (S.newContacts = S.newContacts || []).push(s);
      s.vis[T] = v;
    }
  }
  for (const s of S.ships) s.seen = s.vis[0];
}
export function defaultRally(p) { const a = Math.atan2(-p.y, -p.x); return { x: p.x + Math.cos(a) * (p.r + 600), y: p.y + Math.sin(a) * (p.r + 600) }; }
export function spawnUnit(team, type, prod) {
  prod = prod || S.stations[team]; const rp = prod.rally || defaultRally(prod); const d = defOf(team, type);
  const n = d.squad || 1; let first = null;
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(rp.y - prod.y, rp.x - prod.x) + rand(-.5, .5);
    const s = makeShip(type, team, prod.x + Math.cos(a) * (prod.r + d.r + 24), prod.y + Math.sin(a) * (prod.r + d.r + 24), a);
    s.vx = prod.vx + Math.cos(a) * 40; s.vy = prod.vy + Math.sin(a) * 40;
    if (type === 'hauler') s.order = { type: 'mine', node: rp.node && rp.node.amount > 0 ? rp.node : nearestNode(s, team ? 0 : 1, neededKind(team)), phase: 'go', ox: rand(-60, 60), oy: rand(-60, 60) };
    else s.order = { type: 'move', x: rp.x + rand(-140, 140), y: rp.y + rand(-140, 140) };
    if (worldOwner('phobos') === team && !d.static) { s.rank = Math.max(s.rank, 1); s.xp = Math.max(s.xp, (d.value || 100) * .4); }
    first = first || s;
  }
  if (team === 0) { S.stats.built++; sfx('built'); }
  return first;
}
export const inRoster = (team, type) => FACTIONS[S.fac[team]].roster.some(row => row.some(e => e[0] === type));
export function enqueue(team, type, prod) {
  prod = prod || S.stations[team]; const d = defOf(team, type);
  if (!prod || prod.dead || prod.team !== team || !inRoster(team, type)) return false;
  if (type === 'moonbreaker' && S.worlds && prod.world !== 'venus' && prod.world !== 'ganymede') { if (team === 0) { toast('Only the yards at Venus and Ganymede can lay down a moonBreaker', 'bad'); sfx('deny'); } return false; }
  if (d.limit && countType(team, type) >= d.limit) { if (team === 0) { toast('Only one ' + d.name + ' can fly under your banner', 'bad'); sfx('deny'); } return false; }
  const f0 = v => Math.floor(v).toLocaleString(), lack = S.res[team] < d.cost ? 'need ' + f0(d.cost) + ' He-3 (have ' + f0(S.res[team]) + ')' : S.ore[team] < d.ore ? 'need ' + f0(d.ore) + ' ore (have ' + f0(S.ore[team]) + ')' : S.man[team] < d.man ? 'need ' + f0(d.man) + ' crew (have ' + f0(S.man[team]) + ')' : null;
  if (lack) { if (team === 0) { toast(d.name + ': ' + lack, 'bad'); sfx('deny'); } return false; }
  if (prod.queue.length >= 8) { if (team === 0) toast('Shipyard queue full', 'bad'); return false; }
  S.res[team] -= d.cost; S.ore[team] -= d.ore; S.man[team] -= d.man; prod.queue.push({ type, t: 0 }); if (team === 0) sfx('click'); return true;
}
export function cancelBuild(team, prod, type) {
  const q = prod.queue; for (let i = q.length - 1; i >= 0; i--) if (q[i].type === type) { const d = defOf(team, type); S.res[team] += d.cost; S.ore[team] += d.ore; S.man[team] += d.man; q.splice(i, 1); return true; }
  return false;
}
// rolling one-minute production log for the HUD rates
export function logProd(team, k, v) { if (team !== 0 || !v) return; const L = S.prodLog[0]; (L[k] || (L[k] = [])).push([S.time, v]); }
export function rate(k) { const L = S.prodLog[0][k]; if (!L) return 0; while (L.length && L[0][0] < S.time - 60) L.shift(); const span = Math.min(60, Math.max(1, S.time)); return L.reduce((a, e) => a + e[1], 0) * 60 / span;
}
export function marker(x, y, col) { S.markers.push({ x, y, col, life: .7 }); }

// ================================================================ battle groups: formations and stances
export const FORMATIONS = [['wedge', 'Wedge'], ['line', 'Line abreast'], ['column', 'Column'], ['wall', 'Wall'], ['screen', 'Screen']];
export const STANCES = [['aggressive', 'Aggressive', 'Members break formation to engage anything a little past the reach of their guns'], ['defensive', 'Defensive', 'Hold formation; engage only enemies that close well inside the guns’ reach of the flagship'], ['hold', 'Hold fire', 'Main guns stay silent so the group runs quiet; point defense still fires'], ['evasive', 'Evasive', 'Wider spacing, never chase, fight from 40% farther out'], ['line', 'Line of battle', 'Form a line across the axis to the enemy at the flagship’s range and turn the broadsides on them; nobody breaks to chase. A plain move order still moves the group']];
const GNAMES = ['First Squadron', 'Second Squadron', 'Third Squadron', 'Fourth Squadron', 'Fifth Squadron', 'Sixth Squadron', 'Seventh Squadron', 'Eighth Squadron', 'Ninth Squadron'];
const valueOf = s => (s.def.value || 0) + (s.cmdr ? 5000 : 0) + (s.def.fighter || s.def.shell ? -1e4 : 0);
// local offsets (x forward, y to starboard) for every member after the flagship
export function formationSlots(list, type, mul = 1, flagR = 0) {
  const maxR = Math.max(20, ...list.map(s => s.r));
  const D = (maxR * 2.2 + 60) * mul, out = [], E = flagR * 1.15; // E keeps the first ring clear of the flagship's hull
  const off = i => E + i * D;
  const small = list.filter(s => (s.def.r0 ?? s.r) < 30), big = list.filter(s => (s.def.r0 ?? s.r) >= 30);
  const sideIdx = k => [(k % 2 ? 1 : -1), Math.ceil(k / 2)];
  const place = (arr, fn) => arr.forEach((s, i) => out.push([s, fn(i + 1, arr.length)]));
  if (type === 'column') place(list, k => ({ x: -off(k), y: 0 }));
  else if (type === 'line') place(list, k => { const [sd, i] = sideIdx(k); return { x: 0, y: sd * off(i) }; });
  else if (type === 'wedge') place(list, k => { const [sd, i] = sideIdx(k); return { x: -off(i) * .75, y: sd * off(i) * .8 }; });
  else if (type === 'wall') place(list, k => { const row = Math.floor((k - 1) / 6), j = (k - 1) % 6 + 1; const [sd, i] = sideIdx(j); return { x: -row * (D + E * .6), y: sd * off(i) }; });
  else { // screen: capitals tight in the middle, escorts on a ring biased forward
    place(big, k => { const [sd, i] = sideIdx(k); return { x: -off(i) * .3, y: sd * off(i) * .9 }; });
    const R = (big.length ? off(Math.ceil(big.length / 2)) + D * .9 : E + D) + maxR;
    place(small, (k, n) => { const a = n === 1 ? 0 : -2.1 + 4.2 * (k - 1) / (n - 1); return { x: Math.cos(a) * R, y: Math.sin(a) * R }; });
  }
  return out;
}
export function groupList() { return Object.keys(S.bgroups).map(Number).sort((a, b) => a - b).map(n => S.bgroups[n]); }
export function leaveGroup(s) { if (s.group) { s.group.members = s.group.members.filter(m => m !== s); s.group = null; } s.detached = false; }
export function makeGroup(n, ships, add) {
  ships = ships.filter(s => s.team === 0 && !s.def.static && !s.dead);
  let g = S.bgroups[n];
  if (!g) g = S.bgroups[n] = { n, name: GNAMES[n - 1] || 'Group ' + n, members: [], formation: 'wedge', stance: 'aggressive', helm: 'auto', hdg: 0, flag: null, cruise: 999 };
  if (!add) for (const m of g.members.slice()) if (!ships.includes(m)) leaveGroup(m);
  for (const s of ships) { if (s.group && s.group !== g) leaveGroup(s); if (!g.members.includes(s)) g.members.push(s); s.group = g; s.detached = false; }
  if (!g.members.length) { delete S.bgroups[n]; return null; }
  if (!add || !g.flag) { const c = g.members.reduce((a, m) => ({ x: a.x + m.x, y: a.y + m.y }), { x: 0, y: 0 }); g.hdg = Math.atan2(-c.y, -c.x); }
  refreshGroup(g);
  for (const m of g.members) if (m !== g.flag && ['idle', 'move', 'amove', 'brake'].includes(m.order.type)) m.order = { type: 'form', g };
  return g;
}
export function disbandGroup(n) { const g = S.bgroups[n]; if (!g) return; for (const m of g.members.slice()) { leaveGroup(m); if (m.order.type === 'form') setIdle(m); } delete S.bgroups[n]; }
function refreshGroup(g) {
  g.members = g.members.filter(m => !m.dead && m.team === 0 && m.group === g);
  if (!g.members.length) { delete S.bgroups[g.n]; return; }
  const old = g.flag; g.flag = g.members.slice().sort((a, b) => valueOf(b) - valueOf(a) || a.id - b.id)[0];
  if (old && old !== g.flag && !old.dead && old.order.type !== 'form') { /* former flagship keeps its orders */ }
  if (g.flag.order.type === 'form') setIdle(g.flag);
  const mul = g.stance === 'evasive' ? 1.6 : 1;
  const rest = g.members.filter(m => m !== g.flag).sort((a, b) => b.r - a.r || a.id - b.id);
  for (const [m, sl] of formationSlots(rest, g.lineOn ? 'line' : g.formation, mul, g.flag.r)) m.slot = sl;
  g.flag.slot = { x: 0, y: 0 };
  const slow = g.members.filter(m => !m.def.fighter && !m.def.shell && !m.detached).map(m => m.def.cruise * Math.max(.15, m.hf || 1));
  g.cruise = slow.length ? Math.min(...slow) * .95 : 999;
}
function groupTick() {
  for (const g of groupList()) {
    refreshGroup(g); if (!S.bgroups[g.n]) continue;
    const f = g.flag, sp = hyp(f.vx, f.vy);
    if (g.stance === 'line') lineTick(g); else if (g.lineOn) { g.lineOn = false; if (f.order.type === 'line') setIdle(f); }
    if (g.lineOn) continue;
    if (f.order.type === 'idle' && f.order.face != null) g.hdg += angDiff(g.hdg, f.order.face) * .35; // the facing the player dragged out
    else if (sp > 30 && f.order.type !== 'idle') g.hdg += angDiff(g.hdg, Math.atan2(f.vy, f.vx)) * .35;
    if (f.order.type === 'move' || f.order.type === 'amove') f.order.cruise = g.cruise;
  }
}
// the line of battle: the group holds an axis toward the enemy's centre, at the flagship's range from it, as one line
function lineTick(g) {
  const f = g.flag, ok = f.order.type === 'idle' || f.order.type === 'amove' || f.order.type === 'line';
  let cx = 0, cy = 0, W = 0;
  if (ok) for (const o of S.ships) {
    if (o.team === f.team || o.team > 1 || o.dead || !o.vis[f.team] || o.def.fighter || o.def.shell || o.surrendered || o.derelict || o.offField) continue;
    const d = hyp(o.x - f.x, o.y - f.y); if (d > 22000) continue; const w = (o.def.value || 50) * (o.def.static ? .5 : 1); cx += o.x * w; cy += o.y * w; W += w;
  }
  if (!W) { if (g.lineOn) { g.lineOn = false; if (f.order.type === 'line') { if (g.lineFrom) f.order = g.lineFrom; else setIdle(f); } g.lineFrom = null; refreshGroup(g); } return; } // contact lost: back to the order it had
  cx /= W; cy /= W; const ux = cx - f.x, uy = cy - f.y, d = hyp(ux, uy) || 1, R = Math.max(f.def.pref || 1200, (helmOf(f) === 'range' ? mainReach(f) * .88 : 0), 700);
  const was = g.lineOn; g.lineOn = true; g.hdg = Math.atan2(uy, ux); if (!was) { g.lineFrom = f.order.type === 'amove' ? f.order : null; refreshGroup(g); }
  const nx = cx - ux / d * R, ny = cy - uy / d * R, o = f.order;
  if (o.type === 'line' && hyp(o.x - nx, o.y - ny) < 120) { o.ex = cx; o.ey = cy; return; } // close enough: do not chase every drift of the enemy
  f.order = { type: 'line', x: nx, y: ny, ex: cx, ey: cy, next: o.type === 'line' ? o.next : null }; f.engage = null;
}
// a whole group was given an order: the flagship leads at the slowest member's pace, the rest keep station.
// opt.face: the facing on arrival; opt.queue: append it as a waypoint after the orders it already has
export function groupOrder(g, type, x, y, opt = {}) {
  refreshGroup(g); if (!S.bgroups[g.n]) return;
  const f = g.flag;
  const t = type === 'amove' && g.stance !== 'aggressive' && g.stance !== 'line' ? 'move' : type;
  const ord = { type: t, x, y, cruise: g.cruise, face: opt.face };
  if (opt.queue && ['move', 'amove', 'line'].includes(f.order.type)) { let L = f.order; while (L.next) L = L.next; L.next = ord; return; }
  g.hdg = Math.atan2(y - f.y, x - f.x); g.lineOn = false; g.lineFrom = null;
  f.order = ord; f.engage = null; f.detached = false;
  for (const m of g.members) if (m !== f) { m.detached = false; m.engage = null; m.order = { type: 'form', g }; }
}
function formThink(s, g, dt) {
  if (!g || !S.bgroups[g.n] || s.group !== g || !g.flag || g.flag.dead) { setIdle(s); return arrive(s, s.x, s.y, 0, 0); }
  const f = g.flag; if (f === s) { setIdle(s); return arrive(s, s.x, s.y, 0, 0); }
  if (s.thinkT <= 0) {
    s.thinkT = .5;
    if (g.stance === 'line') s.engage = null;
    else if (g.stance === 'aggressive') { s.engage = s.engage && !s.engage.dead && dist(s.engage, f) < acq(s) * 1.45 ? s.engage : nearestEnemy(s, s.x, s.y, s.def.fighter ? 1500 : acq(s), s.def.fighter); }
    else if (g.stance === 'defensive') { s.engage = s.engage && !s.engage.dead && dist(s.engage, f) < acq(s) * .8 ? s.engage : nearestEnemy(s, f.x, f.y, acq(s) * .6, s.def.fighter); }
    else s.engage = null;
    if (s.def.broadside || g.lineOn) s.aware = g.stance === 'hold' ? null : nearestEnemy(s, s.x, s.y, acq(s) * (g.lineOn ? 1.2 : 1), false);
  }
  if (s.engage && !s.engage.dead && s.engage.team !== s.team && s.weapons.length && mainAmmo(s) > 0) return combat(s, s.engage, dt);
  const sl = s.slot || { x: -200, y: 0 }, ca = Math.cos(g.hdg), sa = Math.sin(g.hdg);
  const tx = f.x + ca * sl.x - sa * sl.y, ty = f.y + sa * sl.x + ca * sl.y;
  arrive(s, tx, ty, f.vx, f.vy, s.def.cruise);
  const near = hyp(tx - s.x, ty - s.y) < 60 + s.r;
  if (s.def.broadside && s.aware && !s.aware.dead) G.face = broadsideFace(s, s.aware);
  else if (g.lineOn && s.aware && !s.aware.dead) G.face = Math.atan2(s.aware.y - s.y, s.aware.x - s.x);
  else if (near) G.face = g.hdg;
}
