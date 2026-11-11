// The sensor picture. Space is big and dark: a power sees what its worlds, fleets and spies can see, and each
// side knows only its own picture of the war, the AI included. An enemy fleet is, to you:
//   2  tracked: position, size, commander and destination
//   1  a contact: a blip with a rough size and a heading, no destination, no names
//   0  unseen, though you may remember where it was last seen (a ghost) for a few weeks
// A fleet's signature is its drive: a burn shows across a system, a hard burn (forced march) further still; a fleet
// running dark coasts cold and shows only at close range. The Sun's glare blinds sensors near Mercury and Venus
// (how Atalantia ambushed the White Fleet over Mercury), and the Belt hides a fleet running dark.
// Medium fog: a power always tracks fleets burning within a region where it holds a world, and fleets in orbit with
// its own worlds or fleets. A spy network of 50% in a realm tracks every fleet at, or bound to or from, its worlds.
import * as TE from './tech.js';
import { C, hostile, relOf, fleetsAt, CAPITAL } from './camp.js';
import { bodyOf, AU, WORLDS } from './solar.js';
import { BODIES } from './data.js';
import * as CM from './command.js';
import * as AG from './agents.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const REGION = Object.fromEntries(WORLDS.map(w => [w.id, w.region]));
export const GHOST_WEEKS = 4;

// ---------------------------------------------------------------- where things are
// a place: a world id, or a point a fraction k of the way from one place to another
export function posW(id) { const b = bodyOf(id); if (b.kind === 'moon') { const p = BODIES[b.parent]; return { x: p.x + Math.cos(b.phase) * b.orbitR, y: p.y + Math.sin(b.phase) * b.orbitR }; } return { x: b.x, y: b.y }; }
export function locPos(loc, P = posW) {
  if (typeof loc === 'string') return P(loc);
  const a = locPos(loc.a, P), b = locPos(loc.b, P); return { x: a.x + (b.x - a.x) * loc.k, y: a.y + (b.y - a.y) * loc.k };
}
// a transit runs from p0 (or its world of departure) to p1 (or its destination)
export const transitK = tr => clamp((tr.total - tr.left) / Math.max(1, tr.total), 0, 1);
export function fleetLoc(fl) {
  if (fl.engage) { const e = (C.engage || []).find(x => x.id === fl.engage); if (e) return e.loc; }
  if (!fl.transit) return fl.at;
  const tr = fl.transit; return { a: tr.p0 || tr.from, b: tr.p1 || tr.to, k: transitK(tr) };
}
// the loc a transit will reach after w more weeks
export function aheadLoc(fl, w) { const tr = fl.transit; return { a: tr.p0 || tr.from, b: tr.p1 || tr.to, k: clamp((tr.total - tr.left + w) / Math.max(1, tr.total), 0, 1) }; }
export const auDist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) / AU;
export const helio = p => Math.hypot(p.x, p.y) / AU;
export const regionAt = loc => typeof loc === 'string' ? REGION[loc] : null;

// ---------------------------------------------------------------- sensors and signatures
const scouts = fl => fl.ships.filter(s => s.t === 'scout').length;
export function sensorR(fl) { return (.3 + .5 * Math.min(2, scouts(fl))) * (CM.has(fl, 'hunter') ? 1.4 : 1); }
export function worldR(w) { return (.5 + .2 * (w.lv.array || 0) + .1 * (w.lv.grid || 0) + (CAPITAL[w.owner] === w.id ? .3 : 0)) * (w.siege ? .5 : 1); }
const watchers = f => (C.agents || []).filter(a => a.owner === f && a.mission === 'watch' && a.state === 'busy' && !(a.left > 0));
const friends = f => o => o === f || relOf(o, f) === 'ally';
function sources(f) {
  const fr = friends(f), out = [];
  for (const id in C.worlds) { const w = C.worlds[id]; if (fr(w.owner)) out.push({ p: posW(id), R: worldR(w) }); }
  for (const fl of C.fleets) if (fr(fl.owner)) out.push({ p: locPos(fleetLoc(fl)), R: sensorR(fl) });
  for (const a of watchers(f)) out.push({ p: posW(a.target), R: .4 });
  return out;
}
export const mode = fl => fl.transit ? (fl.transit.mode || (fl.transit.forced ? 'hard' : 'burn')) : 'parked';
export function signature(fl, p = locPos(fleetLoc(fl))) {
  const m = mode(fl);
  let s = { parked: .8, burn: 1, hard: 1.7, dark: .3 }[m] || 1;
  s *= .7 + Math.min(.6, fl.ships.length / 20);
  { const n = fl.ships.length, q = n ? fl.ships.filter(x => x.cls && (TE.classSpec(fl.owner, x.cls) || {}).csig).length / n : 0; if (q) s *= 1 - .35 * q; } // cold-running drives
  const r = helio(p); if (r < .85) s *= .25 + .75 * (r / .85) ** 2;          // the Sun's glare
  if (m === 'dark' && r > 2.1 && r < 3.4) s *= .5;                             // the Belt
  return s;
}
// how well power f sees fleet fl: 2 tracked, 1 contact, 0 unseen
export function level(f, fl, src) {
  const fr = friends(f); if (fr(fl.owner) || globalThis.__FOG_OFF) return 2;
  const loc = fleetLoc(fl), p = locPos(loc), m = mode(fl), glare = helio(p) < .85;
  // in orbit with our own world or fleets
  if (fl.at && (fr(C.worlds[fl.at] && C.worlds[fl.at].owner) || fleetsAt(fl.at).some(o => fr(o.owner)))) return 2;
  // our spies watching the yards it left
  if (fl.transit && watchers(f).some(a => a.target === fl.transit.from)) return 2;
  // a network of 50% or more in the realm whose worlds it sits at, or comes from, or is bound for
  if (AG.netSees(f, fl)) return 2;
  // medium fog: anything burning in a region where we hold a world, away from the Sun's glare
  if (m !== 'dark' && !glare) { const rg = [fl.at, fl.transit && fl.transit.to, fl.transit && fl.transit.from].map(regionAt).filter(Boolean);
    if (rg.some(r => Object.values(C.worlds).some(w => fr(w.owner) && REGION[w.id] === r))) return 2; }
  const sig = signature(fl, p); let best = 0;
  for (const s of src || sources(f)) { const q = s.R * sig / Math.max(.02, auDist(s.p, p)); if (q > best) best = q; }
  const lv = best >= 1.7 ? 2 : best >= 1 ? 1 : 0;
  // a burn on an approach to one of our own worlds is never missed, even in the glare: at least a contact
  if (!lv && m !== 'dark' && fl.transit && C.worlds[fl.transit.to] && fr(C.worlds[fl.transit.to].owner)) return 1;
  return lv;
}

// ---------------------------------------------------------------- the picture, and memory
// C.intel[f][fleetId] = what f last knew: { lvl, owner, n, str, loc, to, seen }
const estN = (fl, id) => Math.max(1, Math.round(fl.ships.length * (.75 + ((id * 7919) % 11) / 20)));
export function scan(f) {
  C.intel = C.intel || {}; const mem = C.intel[f] = C.intel[f] || {}, src = sources(f), now = {};
  for (const fl of C.fleets) {
    if (fl.owner === f) continue; const l = level(f, fl, src); now[fl.id] = l; if (!l) continue;
    const loc = fleetLoc(fl);
    mem[fl.id] = { lvl: l, owner: fl.owner, n: l === 2 ? fl.ships.length : estN(fl, fl.id), loc: JSON.parse(JSON.stringify(loc)), to: l === 2 && fl.transit ? fl.transit.to : null, from: fl.transit ? fl.transit.from : null, moving: !!fl.transit, seen: C.turn };
  }
  for (const id in mem) { if (now[id]) continue; mem[id].lvl = 0; if (C.turn - mem[id].seen > GHOST_WEEKS) delete mem[id]; }
  return now;
}
export function scanAll() { for (const f of ['rep', 'soc', 'rim']) if (C.fac[f] && C.fac[f].alive) scan(f); }
// the fleets power f knows of now, by level, plus ghosts
export function picture(f) {
  const now = scan(f), mem = C.intel[f];
  return Object.entries(mem).map(([id, m]) => ({ id: +id, fl: m.lvl ? C.fleets.find(x => x.id === +id) : null, ...m }));
}
export const levelOf = (f, fl) => { if (!fl) return 0; if (fl.owner === f || relOf(fl.owner, f) === 'ally') return 2; const m = C.intel && C.intel[f] && C.intel[f][fl.id]; return m && m.seen === C.turn ? m.lvl : level(f, fl); };
// what power f believes stands at a world: hostile fleets it sees there, and ghosts last seen there lately
export function knownStrAt(f, id, strOf) {
  let s = 0; for (const fl of fleetsAt(id)) if (hostile(f, fl.owner) && levelOf(f, fl)) s += strOf(fl);
  const mem = C.intel && C.intel[f]; if (mem) for (const k in mem) { const m = mem[k]; if (!m.lvl && m.loc === id && C.turn - m.seen <= 2 && hostile(f, m.owner)) { const fl = C.fleets.find(x => x.id === +k); if (fl && fl.at !== id) s += strOf(fl) * .7; } }
  return s;
}
// hostile fleets power f tracks bound for a world (it knows the destination only when it tracks them)
// (a contact on an approach to its own world counts: the vector gives it away)
export const knownBoundFor = (f, id) => C.fleets.filter(o => { if (!hostile(f, o.owner) || !o.transit || o.engage || o.transit.to !== id) return false; const l = levelOf(f, o); return l === 2 || (l === 1 && C.worlds[id] && C.worlds[id].owner === f); });
