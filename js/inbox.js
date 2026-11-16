// the dispatch inbox (U6): every dispatch sorted into three tiers.
//   now    — decide now: this week's threats and openings at a world where we have a stake (ours, or a fleet of ours
//            there or bound there), still unhandled. Ticking one off (✓) moves it to 'week'.
//   week   — this week: the rest of this week's news that concerns us, good or bad
//   record — for the record: routine reports (arrivals, other powers' battles and votes) and everything from earlier weeks
// Pure: reads the campaign state, changes nothing but the 'done' mark on an entry. stratview.js draws it.
import { C } from './camp.js';
import { bodyOf } from './solar.js';

// what a dispatch says when it wants an answer from us this week (camp.js, conquest.js, ops.js, sensors.js wordings)
const ACT = /has reached|is under siege|under siege\.|walls are breached|is bound for|lies open|defences are broken|can land in full|Bring troops|is intercepted|intercepts|is held in orbit|tried to slip away|bottled up|close to revolt|on strike|restless|Revolt!|sets out|blow will fall/i;

export const recent = l => l.turn >= C.turn - 1;
// a stake at a world: we hold it, or a fleet of ours is there or on its way there
export function stake(id, me = C.player) {
  const w = id && C.worlds[id]; if (!w) return false;
  return w.owner === me || C.fleets.some(f => f.owner === me && (f.at === id || (f.transit && f.transit.to === id)));
}
// the names of the worlds we have a stake in: an enemy massing elsewhere names its target in the text
export function stakeNames(me = C.player) { return Object.keys(C.worlds).filter(id => stake(id, me)).map(id => (bodyOf(id) || {}).name).filter(Boolean); }
export function tierOf(l, me = C.player, names = null) {
  if (!recent(l)) return 'record';
  if (!l.done && l.cls && l.cls !== 'warnc' && ACT.test(l.msg)) {
    if (l.at && stake(l.at, me)) return 'now';
    if (l.cls === 'bad' && (names || stakeNames(me)).some(n => l.msg.includes(n))) return 'now';
    if (!l.at && l.cls === 'bad') return 'now';
  }
  if (!l.cls && !l.ev) return 'record';
  return 'week';
}
// the inbox: { now, week, record } lists of log entries, newest first; record is capped
export function sort(max = 60) {
  const out = { now: [], week: [], record: [] }, names = stakeNames();
  for (const l of C.log) { const t = tierOf(l, C.player, names); if (t !== 'record' || out.record.length < max) out[t].push(l); }
  return out;
}
export function counts() { const s = { now: 0, week: 0, record: 0 }, names = stakeNames(); for (const l of C.log) s[tierOf(l, C.player, names)]++; return s; }
// ✓: handled, so it drops to this week's news (kept in the save with the log)
export function done(l) { if (l) l.done = true; }
