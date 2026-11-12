// Ground pathfinding check, headless in Node: does every unit get where it is sent?
//   node tests/ground_paths.mjs [--trips 40] [--battles 2] [--world venus]
// 1. Trips: on each world's field (with a fortress wall, and on the walled worlds without one) units of every kind are
//    sent between random points of open ground: outside to inside the walls, across the city, from the waterline. Each
//    trip runs on the real movement rules with no AI and no enemy. A trip fails if the unit is not within 30 m of the
//    goal after the walk should have taken three times as long, and every trip is checked for stepping through a
//    standing wall or into deep water it did not start in.
// 2. Battles: whole AI battles, watching for units that hold an order to go somewhere (move, attack, breach) yet make
//    no headway for 30 seconds while not fighting: stuck.
// Exit 1 on any wall or deep-water crossing, if more than 2% of trips fail, or if more than 1% of units in the battles
// stall for two minutes or more.
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TRIPS = +arg('trips', 40), BATTLES = +arg('battles', 2), ONLY = arg('world', null);
// the rules as they are, with two switches for the trips: no commanders, and no end to the battle
let src = readFileSync(join(ROOT, 'js/ground.js'), 'utf8');
const swap = (a, b) => { if (!src.includes(a)) throw new Error('hook not found: ' + a); src = src.replace(a, b); };
swap('if (G.human !== t) ai(t); else autoUnits(t);', 'if (G.__trip) {} else if (G.human !== t) ai(t); else autoUnits(t);');
swap('\n  checkEnd();\n}', '\n  if (!G.__trip) checkEnd();\n}');
const dir = mkdtempSync(join(tmpdir(), 'gpath-')), file = join(dir, 'ground_paths.js'); writeFileSync(file, src);
const GR = await import(pathToFileURL(file).href), { G } = GR;

const WORLDS = ['mercury', 'venus', 'earth', 'luna', 'mars', 'phobos', 'deimos', 'europa'].filter(w => !ONLY || w === ONLY);
const specOf = (world, fort) => ({ world, storm: false, maxT: 1800, att: { f: 'rep', shells: 0, leech: 0, storks: 0, total: 0 }, def: { f: 'soc', men: 0, garrison: 0, fort, gun: 0, shield: 0, barracks: 0, morale: 1 } });
const rand = GR.rng(12345);
const land = () => { for (let k = 0; k < 400; k++) { const x = 200 + rand() * (GR.MAP - 400), y = 200 + rand() * (GR.MAP - 400); if (!GR.isWater(x, y)) return { x, y }; } return null; };
// a dry point on the waterline (water within 25 m): a unit standing here may be on a sliver of a cell the grid counts as water
const shore = () => { for (let k = 0; k < 4000; k++) { const p = land(); if (!p) return null; if ([[25, 0], [-25, 0], [0, 25], [0, -25]].some(([dx, dy]) => GR.isWater(p.x + dx, p.y + dy))) return p; } return null; };
const KINDS = ['legion', 'railmen', 'obsidian', 'starshell', 'gravpod', 'peerless'];
let fails = 0, trips = 0, wallX = 0, deepX = 0; const bad = [];
for (const world of WORLDS) for (const fort of [2, 0]) {
  GR.setup(specOf(world, fort), { seed: 7, human: -1 }); G.units = []; G.phase = 'battle'; G.__trip = true; G.drop = [[], []]; G.storksDone = true;
  const city = G.map.city; let wf = 0, wn = 0, tsum = 0;
  for (let n = 0; n < TRIPS; n++) {
    // half the trips start outside the city and end inside it, the rest anywhere to anywhere
    let a = n % 4 === 1 && G.map.seaH >= 0 ? shore() || land() : land(), b = land(); if (!a || !b) continue; // every fourth trip starts on the waterline
    if (n % 2 === 0) { for (let k = 0; k < 60; k++) { const r = city.r * (.2 + rand() * .45), q = rand() * Math.PI * 2, p = { x: city.x + Math.cos(q) * r, y: city.y + Math.sin(q) * r }; if (!GR.isWater(p.x, p.y)) { b = p; break; } } }
    if (Math.hypot(a.x - b.x, a.y - b.y) < 400) continue;
    const kind = KINDS[n % KINDS.length], u = GR.spawn(0, kind, kind === 'legion' ? 600 : kind === 'peerless' ? 60 : 40, a.x, a.y, 0);
    u.state = 'idle'; GR.order(u, { type: 'move', x: b.x, y: b.y, run: n % 3 === 0 });
    const est = (u.path ? u.path.reduce((s, p, i, L) => s + Math.hypot(p.x - (i ? L[i - 1].x : a.x), p.y - (i ? L[i - 1].y : a.y)), 0) : Math.hypot(b.x - a.x, b.y - a.y)), T = Math.max(120, est / u.T.walk * 3);
    let t = 0, px = u.x, py = u.y, startDeep = GR.isDeep(u.x, u.y), forded = false;
    while (t < T && u.order) { GR.step(.5); t += .5;
      if (!u.T.fly && G.map.wl.length && GR.crossesWall(px, py, u.x, u.y)) { wallX++; bad.push(`${world} fort${fort} ${kind}: through the wall at ${Math.round(u.x)},${Math.round(u.y)}`); }
      if (u.ford > G.t) forded = true; // wading on purpose, after it found no way round, is allowed
      if (!u.T.fly && GR.isDeep(u.x, u.y) && !startDeep && !forded) { deepX++; bad.push(`${world} fort${fort} ${kind}: into deep water at ${Math.round(u.x)},${Math.round(u.y)}`); startDeep = true; }
      px = u.x; py = u.y; }
    const miss = Math.hypot(u.x - b.x, u.y - b.y); trips++; tsum += t;
    // the goal may be in a jam or a sliver of shallows: arriving means within 30 m of it, or stopped by the crowd rule close to it
    if (miss > 30 + GR.radiusOf(u) && !(u.order == null && miss < 120)) { fails++; wf++; bad.push(`${world} fort${fort} ${kind}: ${Math.round(miss)} m short after ${t}s (${Math.round(a.x)},${Math.round(a.y)} -> ${Math.round(b.x)},${Math.round(b.y)})`); }
    else wn++;
    G.units = [];
  }
  console.log(`${world.padEnd(8)} fort ${fort}  trips ${wn + wf}  failed ${wf}  mean ${Math.round(tsum / Math.max(1, wn + wf))}s`);
}
console.log(`\ntrips ${trips}, failed ${fails} (${(fails / Math.max(1, trips) * 100).toFixed(1)}%), wall crossings ${wallX}, deep-water entries ${deepX}`);
for (const b of bad.slice(0, 25)) console.log('  ' + b);

// whole battles: stuck units
let stuckN = 0, unitsN = 0, long2 = 0, tl = []; const stuckWhy = {};
const SC = [['mars', 0], ['venus', 1], ['luna', 2], ['mercury', 0]].filter(([w]) => !ONLY || w === ONLY);
for (const [world, fort] of SC) for (let sd = 1; sd <= BATTLES; sd++) {
  const spec = { world, storm: false, maxT: 1800, att: { f: 'rep', shells: 1500, leech: 12000, storks: 18000, cmdr: 'Legatus', total: 39000 }, def: { f: 'soc', men: 60000, garrison: 60000, fort, gun: 2, shield: 1, barracks: 1, morale: 1, cmdr: 'The Legate' } };
  GR.setup(spec, { seed: 900 + sd, human: -1 }); G.__trip = false; G.def0 = G.units.reduce((a, u) => a + u.men * u.eq, 0); GR.aiZones(); GR.beginRain();
  const seen = new Map(); const flagged = new Set(), long = new Map();
  while (!G.over && G.t < 1800) { GR.step(1);
    for (const u of G.units) { if (!GR.fighting(u) || !u.order || !['move', 'attack', 'breach'].includes(u.order.type) || u.melee || u.firing || u.sieging) { seen.delete(u); continue; }
      const s = seen.get(u); if (!s || Math.hypot(u.x - s.x, u.y - s.y) > 20) { seen.set(u, { x: u.x, y: u.y, t: G.t }); continue; }
      long.set(u, Math.max(long.get(u) || 0, G.t - s.t));
      if (G.t - s.t > 30 && !flagged.has(u)) { flagged.add(u); const k = `${u.order.type}${GR.isWater(u.x, u.y) ? ' in water' : ''}${G.map.wl.length && G.map.wl.some(w => Math.hypot((w.x0 + w.x1) / 2 - u.x, (w.y0 + w.y1) / 2 - u.y) < 120) ? ' at a wall' : ''}`; stuckWhy[k] = (stuckWhy[k] || 0) + 1;
        if (Object.values(stuckWhy).reduce((a, v) => a + v, 0) <= 12) console.log(`  stuck: ${world} s${sd} t${Math.round(G.t)} ${u.type} ${k} at ${Math.round(u.x)},${Math.round(u.y)} -> ${u.order.type === 'move' ? Math.round(u.order.x) + ',' + Math.round(u.order.y) : u.order.t ? u.order.t.type + ' ' + Math.round(u.order.t.x) + ',' + Math.round(u.order.t.y) : 'wall ' + u.order.w} path ${u.path ? u.path.length : 0}`); } }
  }
  unitsN += G.units.length; stuckN += flagged.size; const L = [...long.values()]; long2 += L.filter(v => v > 120).length; tl = [...tl, ...L.filter(v => v > 30)];
  console.log(`battle ${world} fort ${fort} s${sd}: ${G.over ? (G.over.win === 0 ? 'attacker' : 'defender') + ' wins' : 'no result'} at ${Math.round(G.t)}s, stuck units ${flagged.size} of ${G.units.length}`);
}
console.log(`\nbattles: ${stuckN} stuck 30 s or more of ${unitsN} units, ${long2} for 2 minutes or more; median stall ${tl.sort((a, b) => a - b)[tl.length >> 1] | 0}s`, stuckWhy);
process.exit(wallX || deepX || fails > trips * .02 || long2 > unitsN * .01 ? 1 : 0);
