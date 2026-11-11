// Morale in a campaign battle, for both sides. When a flagship dies, the ships around it waver. A crew that is
// beaten and frightened breaks: the ship stops taking orders and runs for the edge of the field, firing wild, and
// may strike its colours if it is run down. When an enemy fleet has lost enough, its commander sounds the retreat
// and the whole line breaks; how much it takes depends on who commands it. A ship that gets clear of the fight has
// left the field: it lives, and goes home with its fleet.
import { S } from './state.js';
import { bodyOf } from './solar.js';
import { surrender } from './sim.js';
import { toast } from './ui.js';
import { FACTIONS } from './data.js';

const hyp = Math.hypot;
// how each of the war's commanders fights: the enemy's battle AI reads this too
export const DOC = {
  steady:    { name: 'Steady', desc: 'Fights by the book: closes as one line, concentrates fire, screens the capital ships, pulls cripples back.', pull: .3, rout: .45, flank: 0, focus: true, screen: true, ab: .35, form: true },
  onslaught: { name: 'Onslaught', desc: 'Comes at you hard and from two sides at once, and goes for the flagships. Fights on long after another fleet would break.', pull: .15, rout: .3, flank: .25, focus: true, screen: false, ab: .55, sally: true, hunt: true },
  reckless:  { name: 'Reckless', desc: 'Charges straight in and boards whatever it can reach. Never falls back; if its commander falls, the whole fleet breaks.', pull: 0, rout: .25, flank: 0, focus: false, screen: false, ab: .7, sally: true, headRout: true },
  patient:   { name: 'Patient', desc: 'Advances as one line at the pace of the slowest ship, saves its damaged ships, and when beaten withdraws in good order, still firing.', pull: .45, rout: .52, flank: 0, focus: true, screen: true, ab: .35, patient: true, orderly: true },
  cunning:   { name: 'Cunning', desc: 'Runs dark on the approach, sends a wing round your flank, and kills your capital ships first.', pull: .35, rout: .42, flank: .3, focus: true, screen: true, ab: .45, dark: true, hunt: true, form: true },
};
const BY_NAME = [['Atalantia', 'onslaught'], ['Victra', 'onslaught'], ['Ajax', 'reckless'], ['Sevro', 'reckless'], ['Thraxa', 'reckless'], ['Diomedes', 'patient'], ['Kavax', 'patient'], ['Romulus', 'patient'], ['Dido', 'patient'], ['Magnus', 'patient'], ['Darrow', 'cunning'], ['Atlas', 'cunning'], ['Lysander', 'cunning'], ['Orion', 'cunning']];
export const doctrineOf = name => (BY_NAME.find(([k]) => (name || '').startsWith(k)) || [0, 'steady'])[1];

export const M = { mor: [100, 100], shockV: [0, 0], ev: [], doc: 'steady', lead: null, peak: [0, 0], rout: [null, null], warned: false, esc: [0, 0], broke: [0, 0], next: 0, batch: [[], []], prizes: 0 };
const live = s => s && !s.dead && !s.offField && !s.surrendered && !s.derelict;
const crewed = s => live(s) && !s.def.static && !s.def.fighter && !s.def.shell && !s.def.dropship && s.def.crew > 2 && s.team < 2 && !s.convoy;
const armed = s => live(s) && !s.def.static && !s.def.fighter && !s.def.shell && s.weapons.length && s.type !== 'hauler';
const str = t => S.ships.reduce((a, s) => a + (s.team === t && armed(s) ? (s.def.value || 50) * s.hp / s.def.hp : 0), 0);
const note = (t, c) => S.hooks && S.hooks.note && S.hooks.note(t, c);
const nm = s => s.title || s.def.name;

export function setup(world) {
  const lead = (S.cmdrs || []).filter(c => c.team === 1 && c.state === 'aboard').sort((a, b) => (b.rank || 0) - (a.rank || 0))[0] || null;
  Object.assign(M, { mor: [100, 100], shockV: [0, 0], ev: [], world, lead, doc: lead ? doctrineOf(lead.name) : 'steady', peak: [str(0), str(1)], rout: [null, null], warned: false, esc: [0, 0], broke: [0, 0], next: 0, batch: [[], []], prizes: 0 });
}
export const doc = () => DOC[M.doc] || DOC.steady;
// fleet morale, 0 to 100, for each side: what is left of the fleet, how the fight stands, and the shocks of the
// battle (a flagship lost, a ship taken, a champion cut down), which fade over a minute or two. Below its breaking
// point a fleet breaks: for the enemy, the point is its commander's; ours breaks at 30.
export const breakAt = t => t === 1 ? Math.round(doc().rout * 100) : 30;
S.shock = (t, v, w) => shock(t, v, w);
export function shock(team, v, why) {
  if (team > 1 || !M.peak) return; M.shockV[team] = Math.max(-15, Math.min(45, M.shockV[team] + v));
  if (why) { M.ev.unshift({ t: S.time, team, v, why }); M.ev.length = Math.min(M.ev.length, 8); }
}
function moraleOf(t) {
  const a = str(t), e = str(1 - t), pk = M.peak[t] || 1, adv = Math.max(-1, Math.min(1, (a - e) / (Math.max(a, e) || 1)));
  return Math.max(0, Math.min(100, 100 * a / pk + 12 * adv - M.shockV[t]));
}

// a commander with Iron Discipline holds the crews around her
const disciplined = s => s.loyT > S.time || (S.cmdrs || []).some(c => c.team === s.team && c.state === 'aboard' && live(c.ship) && c.traits.includes('discipline') && hyp(c.ship.x - s.x, c.ship.y - s.y) < 2500);
const hunterNear = s => (S.cmdrs || []).some(c => c.team === s.team && c.state === 'aboard' && live(c.ship) && ((c.camp && (c.camp.talents.includes('hunter') || (c.camp.grantT || []).includes('hunter'))) || c.traits.includes('hunter')) && (s.group && s.group.flag === c.ship || hyp(c.ship.x - s.x, c.ship.y - s.y) < 3000));

// a flagship dies: every ship of its group, and every ship near it, wavers
export function onKill(s) {
  if (!s.def || s.def.fighter || s.def.shell || s.def.static || s.team > 1) return;
  const flag = s.cmdr || (s.group && s.group.flag === s && s.group.members.length > 1);
  if (!flag) return;
  let n = 0;
  for (const o of S.ships) {
    if (o === s || o.team !== s.team || !crewed(o)) continue;
    if (!(s.group && o.group === s.group) && hyp(o.x - s.x, o.y - s.y) > 3000) continue;
    o.waver = Math.max(o.waver || 0, S.time + 20); if (!disciplined(o)) o.loy = Math.max(0, o.loy - .1); n++;
  }
  if (n) note(`${s.team === 0 ? 'Our' : 'The enemy'} ${nm(s)} is lost: ${s.team === 0 ? 'our' : 'their'} line wavers`, s.team === 0 ? 0xff8a7a : 0x9be8a8);
  shock(s.team, s.cmdr ? 18 : 10, `Flagship ${nm(s)} lost`); shock(1 - s.team, -5, `Their ${nm(s)} destroyed`);
  // the Society's captains are drilled to wait on the flagship's word: with it gone, the group holds where it is a few seconds
  if (FACTIONS[S.fac[s.team]] && FACTIONS[S.fac[s.team]].freeze) { let k = 0; for (const o of S.ships) if (o !== s && o.team === s.team && crewed(o) && ((s.group && o.group === s.group) || hyp(o.x - s.x, o.y - s.y) < 2500)) { o.freezeT = S.time + FACTIONS[S.fac[s.team]].freeze; k++; }
    if (k) note(`${s.team === 0 ? 'Our' : 'Their'} captains wait for orders that will not come: ${k} ship${k > 1 ? 's' : ''} hold${k > 1 ? '' : 's'} station`, s.team === 0 ? 0xff8a7a : 0x9be8a8); }
  // a reckless fleet is held together by its commander alone
  if (s.cmdr && s.cmdr === M.lead && doc().headRout && s.team === 1 && !M.rout[1]) rout(1, `${M.lead.name}’s flagship is gone, and the fleet that followed him breaks`);
}

// the way out: away from the enemy, around the world if it is in the way
function fleeOrder(s) {
  const foes = S.ships.filter(o => o.team !== s.team && o.team < 2 && armed(o));
  let dx, dy;
  if (foes.length) { const cx = foes.reduce((a, o) => a + o.x, 0) / foes.length, cy = foes.reduce((a, o) => a + o.y, 0) / foes.length; dx = s.x - cx; dy = s.y - cy; }
  else { const b = bodyOf(M.world); dx = s.x - b.x; dy = s.y - b.y; }
  let d = hyp(dx, dy) || 1; dx /= d; dy /= d;
  const b = bodyOf(M.world), bx = b.x - s.x, by = b.y - s.y, along = bx * dx + by * dy, lat = Math.abs(bx * dy - by * dx);
  if (along > 0 && lat < b.r + 600) { const side = (bx * dy - by * dx) > 0 ? 1 : -1; [dx, dy] = [dx * .3 + dy * side, dy * .3 - dx * side]; d = hyp(dx, dy); dx /= d; dy /= d; }
  s.order = { type: 'move', x: s.x + dx * 24000, y: s.y + dy * 24000, flee: true }; /* short of a transit burn: a broken ship runs on its drive, and can be caught */ s.engage = null; s.detached = true; s.pend = null;
}
function breakShip(s, orderly, quiet) {
  if (s.broken) return; s.broken = true; s.orderly = !!orderly; s.brokeT = S.time; s.brokeTeam = s.team; M.broke[s.team]++;
  if (!orderly) { s.waver = 1e9; s.loy = Math.min(s.loy, .32); }
  fleeOrder(s); if (!quiet) M.batch[s.team].push(s);
  if (s.team === 0 && s.group && S.alert) S.alert('rout', s);
  if (s.team === 0 && S.selection) S.selection = S.selection.filter(x => x !== s);
}
function rally(s) {
  s.broken = false; s.orderly = false; s.waver = S.time + 6; s.detached = false; s.order = { type: 'idle', x: s.x, y: s.y };
  note(`${s.team === 0 ? 'The' : 'The enemy'} ${nm(s)} rallies and turns back to the fight`, s.team === 0 ? 0x9be8a8 : 0xff8a7a);
}
function escape(s) {
  s.offField = true; s.escaped = true; M.esc[s.team]++;
  const gone = new Set([s]); for (const f of S.ships) if (f.carrier === s && f.def.fighter && !f.dead) { f.offField = true; gone.add(f); }
  S.ships = S.ships.filter(o => !gone.has(o)); if (S.selection) S.selection = S.selection.filter(o => !gone.has(o));
  if (s.def.cmd || s.team === 0) note(`${s.team === 0 ? 'Our' : 'The enemy'} ${nm(s)} gets clear of the field`, s.team === 0 ? 0xc8b890 : 0xff8a7a);
}
// the whole side breaks
export function rout(team, why) {
  if (M.rout[team]) return; M.rout[team] = S.time;
  const orderly = team === 1 && doc().orderly;
  for (const s of S.ships) if (s.team === team && live(s) && !s.def.static && !s.convoy && !(s.def.fighter && s.carrier)) breakShip(s, orderly, true);
  // fighters go home with their carriers, or with whatever is still running
  const text = team === 1 ? (why || (orderly ? `${M.lead ? M.lead.name : 'The enemy'} breaks off and withdraws in good order. Run them down before they clear the field` : `The enemy line breaks! ${M.lead ? M.lead.name + ' sounds the retreat. ' : ''}Run them down before they clear the field`)) : why;
  note(text, team === 1 ? 0xffd27a : 0xff8a7a); toast(text, team === 1 ? 'good' : 'bad', null, true);
  if (S.hooks && S.hooks.voice) { if (team === 1) { S.hooks.voice('rout', null); S.hooks.voice('rout', null, { enemy: true }); } }
}

// once a second
export function tick(engaged, pend = [false, false]) {
  if (S.time < M.next) return; M.next = S.time + 1;
  M.peak[0] = Math.max(M.peak[0], str(0)); M.peak[1] = Math.max(M.peak[1], str(1));
  for (const t of [0, 1]) { M.shockV[t] *= .985; M.mor[t] = moraleOf(t); }
  const b = bodyOf(M.world), zr = S.bzone ? S.bzone.r : b.r + 42000;
  for (const s of S.ships.slice()) {
    if (!crewed(s) && !(s.broken && live(s))) continue;
    if (!s.broken) {
      if (!engaged || disciplined(s) || s.inspired) continue;
      const hp = s.hp / s.def.hp;
      if (s.loy < (M.mor[s.team] < breakAt(s.team) + 10 ? .36 : .28) && (hp < .45 || s.waver > S.time) && Math.random() < .2) breakShip(s);
      continue;
    }
    // taken: a prize crew or a mutiny has the ship now, and it fights for its new side
    if (s.team !== s.brokeTeam) { s.broken = false; s.orderly = false; s.waver = 0; continue; }
    // a broken ship: it bleeds courage, it can be run down, and it can rally to a commander
    const foeNear = S.ships.find(o => o.team !== s.team && o.team < 2 && armed(o) && !o.broken && hyp(o.x - s.x, o.y - s.y) < 3000);
    if (!s.orderly) s.loy = Math.max(0, s.loy - (foeNear ? .025 : .006));
    if (foeNear && !s.orderly && s.loy < .2 && Math.random() < .25) { surrender(s, foeNear.team); if (foeNear.team === 0) M.prizes++; s.broken = false; s.orderly = false; s.waver = 0; continue; }
    if (!M.rout[s.team] && (s.inspired || disciplined(s)) && s.loy > .45) { rally(s); continue; }
    if (!s.order || !s.order.flee || hyp(s.order.x - s.x, s.order.y - s.y) < 10000) fleeOrder(s);
    // clear of the fight: no enemy warship within 6,000 km, and away from the world; or past the edge of the field
    const db = hyp(s.x - b.x, s.y - b.y);
    const chased = S.ships.some(o => o.team !== s.team && o.team < 2 && armed(o) && !o.broken && hyp(o.x - s.x, o.y - s.y) < 12000);
    if (db > zr || (!chased && db > b.r + 8000 && S.time - s.brokeT > 4)) escape(s);
  }
  // pursuit: ships near a Hunter run fleeing ships down faster
  for (const s of S.ships) { if (!armed(s) || s.broken) continue; const t = s.order && s.order.t || s.engage; if (t && t.broken && hunterNear(s)) s.helmT = S.time + 1.5; }
  // the feed: breaks come in batches
  for (const t of [0, 1]) { const L = M.batch[t]; if (!L.length) continue; M.batch[t] = [];
    note(L.length === 1 ? `${t === 0 ? 'Our' : 'The enemy'} ${nm(L[0])} breaks and runs` : `${L.length} ${t === 0 ? 'of our ships break' : 'enemy ships break'} and run`, t === 0 ? 0xff8a7a : 0x9be8a8); }
  if (!engaged) return;
  // the enemy's line breaks when its morale falls past its commander's breaking point
  const a = str(0), e = str(1);
  if (!M.rout[1] && !pend[1] && M.peak[1] > 0 && M.mor[1] < breakAt(1)) rout(1);
  // past our breaking point our line breaks too: not all at once, but crew by crew, the shakiest first, unless a commander
  // with Iron Discipline holds them or someone rallies them
  if (M.mor[0] < breakAt(0) && M.peak[0] > 0) for (const s of S.ships) if (s.team === 0 && crewed(s) && !s.broken && !s.ally && !disciplined(s) && !s.inspired && s.loy < .55 && Math.random() < .06 * (1 + (breakAt(0) - M.mor[0]) / 15)) breakShip(s);
  // the crews know when the battle is lost
  if (!M.warned && M.peak[0] > 0 && M.mor[0] < breakAt(0) && e > a) {
    M.warned = true; for (const s of S.ships) if (s.team === 0 && crewed(s) && !disciplined(s)) s.loy = Math.max(0, s.loy - .1);
    const text = 'Our line is breaking: crews are running for the edge of the field. Withdraw, or rally them around a commander'; note(text, 0xff8a7a); toast(text, 'bad', null, true);
  }
}
export function teardown() { M.lead = null; }
if (typeof window !== 'undefined') window.__MO = { M, rout, DOC };
