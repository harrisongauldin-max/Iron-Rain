// session log (U7): an opt-in record of how a campaign is played, for playtests.
// Off by default. While it is off every call here returns at once and nothing is kept or written.
// Kept in localStorage ('ironrain.sessionlog') so a reload does not lose it; exported as a JSON file.
import { OPTS, saveOpts } from './ui.js';

const KEY = 'ironrain.sessionlog', MAX_EV = 4000;
// the campaign's screens and actions: whatever is still unused at export is listed under neverUsed
export const SCREENS = ['faction', 'diplo', 'tech', 'court', 'classes', 'ledger', 'rivals', 'feed', 'list', 'menu', 'legend', 'saves', 'gfx', 'snd'];
export const ACTIONS = ['recruit', 'refit', 'split', 'raid', 'picket', 'levy', 'raise', 'scrap', 'hangars', 'desig', 'rain', 'rising', 'assault', 'half', 'dark', 'vall', 'vhome', 'vinner', 'objmin', 'imin', 'crelieve', 'cpick', 'bmenu'];
const MODAL_SCREENS = new Set(['faction', 'diplo', 'tech', 'court', 'classes', 'ledger', 'rivals', 'menu', 'legend', 'saves']);
const KEY_SCREEN = { f: 'faction', p: 'diplo', t: 'tech', c: 'court', y: 'classes', h: 'ledger', v: 'rivals', l: 'list', r: 'feed' };

let L = null, saveT = null, cur = null, turnAt = null, hiddenMs = 0, hiddenAt = null, poll = null;
const now = () => Date.now();
function fresh() { return { v: 1, started: new Date().toISOString(), faction: null, screens: {}, actions: {}, tabs: {}, keys: {}, turns: [], battles: {}, parley: {}, events: [] }; }
function load() { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && j.v === 1 ? j : null; } catch (e) { return null; } }
function persist() { clearTimeout(saveT); saveT = setTimeout(() => { if (!L) return; try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) {} }, 800); }
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

export const isOn = () => !!OPTS.sessionLog;
function log() { if (!isOn()) return null; if (!L) L = load() || fresh(); return L; }

// one event: kind plus a little data, stamped with the time since the log started and the campaign week
export function ev(kind, data) {
  const l = log(); if (!l) return;
  const C = window.__CAMP && window.__CAMP.C;
  l.events.push(Object.assign({ t: Math.round((now() - Date.parse(l.started)) / 1000), k: kind }, C && C.on ? { wk: C.turn } : null, data || null));
  if (l.events.length > MAX_EV) l.events.splice(0, l.events.length - MAX_EV);
  persist();
}

// ---- screens: opens and seconds spent on each
function closeCur() { if (!cur || !L) { cur = null; return; } const s = L.screens[cur.n] || (L.screens[cur.n] = { opens: 0, secs: 0 }); s.secs += Math.round((now() - cur.t) / 100) / 10; cur = null; persist(); }
function modalUp() { const m = document.getElementById('smodal'); return !!m && !m.classList.contains('hide'); }
export function screen(n, how) {
  const l = log(); if (!l) return;
  closeCur();
  const s = l.screens[n] || (l.screens[n] = { opens: 0, secs: 0 }); s.opens++;
  if (MODAL_SCREENS.has(n)) { cur = { n, t: now() }; startPoll(); }
  ev('screen', { n, how: how || 'click' });
}
function startPoll() { if (poll) return; poll = setInterval(() => { if (!isOn()) { clearInterval(poll); poll = null; cur = null; return; } if (cur && !modalUp()) closeCur(); if (!cur) { clearInterval(poll); poll = null; } }, 400); }

// a click on the campaign screen: its data-* action, already parsed by the screen's own click handler
export function click(d) {
  const l = log(); if (!l || !d) return;
  if (d.a) { if (SCREENS.includes(d.a)) return screen(d.a); bump(l.actions, d.a); return ev('act', { a: d.a }); }
  for (const k of ['tab', 'ctab', 'ttab', 'dtab', 'ltab']) if (d[k] !== undefined) { bump(l.tabs, k + ':' + d[k]); return ev('tab', { k, v: d[k] }); }
}
export function key(k) {
  const l = log(); if (!l) return;
  bump(l.keys, k);
  if (KEY_SCREEN[k]) screen(KEY_SCREEN[k], 'key');
}

// ---- turns: the seconds between control coming back to the player and End Turn, less time with the tab hidden
export function turnStart(wk) {
  const l = log(); if (!l) return;
  turnAt = { wk, t: now() }; hiddenMs = 0; hiddenAt = document.hidden ? now() : null;
  const C = window.__CAMP && window.__CAMP.C; if (C && C.player) l.faction = C.player;
}
export function turnEnd(wk) {
  const l = log(); if (!l) return;
  closeCur();
  if (turnAt && turnAt.wk === wk) { const hid = hiddenMs + (hiddenAt ? now() - hiddenAt : 0); l.turns.push({ wk, secs: Math.round((now() - turnAt.t - hid) / 100) / 10, away: Math.round(hid / 1000) }); ev('turn', { wk }); }
  turnAt = null;
}
addEventListener('visibilitychange', () => { if (!turnAt) return; if (document.hidden) hiddenAt = now(); else if (hiddenAt) { hiddenMs += now() - hiddenAt; hiddenAt = null; } });

// ---- battles involving the player: how each was settled
// how: fought | auto (chose auto-resolve) | sure (auto-skipped: the forecast called it certain) | trivial | platforms (no ships of ours: the defences fight it)
//      | withdraw | surrender | terms | parley | assault | quest
export function battle(how, cf, res) {
  const l = log(); if (!l) return;
  bump(l.battles, how);
  const C = window.__CAMP && window.__CAMP.C, me = C && C.player;
  ev('battle', { how, world: cf && cf.world, space: !!(cf && cf.space), att: cf ? cf.att === me : undefined, won: res ? (res.attWin === (cf && cf.att === me)) : undefined });
}
export function parley(pick) { const l = log(); if (!l) return; bump(l.parley, pick); ev('parley', { pick }); }

// ---- the export
function stats(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), sum = s.reduce((x, y) => x + y, 0); return { n: s.length, mean: Math.round(sum / s.length * 10) / 10, median: s[s.length >> 1], max: s[s.length - 1], total: Math.round(sum) }; }
export function summary() {
  const l = L || load(); if (!l) return null;
  const used = new Set([...Object.keys(l.screens), ...Object.keys(l.actions)]);
  const b = l.battles, mine = Object.values(b).reduce((x, y) => x + y, 0);
  return {
    turns: stats(l.turns.map(t => t.secs)),
    screens: l.screens, actions: l.actions, tabs: l.tabs, keys: l.keys,
    battles: Object.assign({ total: mine, fought: b.fought || 0, autoResolved: (b.auto || 0) + (b.sure || 0) + (b.trivial || 0) + (b.platforms || 0) }, b),
    parley: l.parley,
    neverUsed: { screens: SCREENS.filter(s => !used.has(s)), actions: ACTIONS.filter(a => !used.has(a)) },
  };
}
export function counts() { const l = L || load(); return l ? { events: l.events.length, turns: l.turns.length, battles: Object.values(l.battles).reduce((x, y) => x + y, 0), screens: Object.values(l.screens).reduce((x, y) => x + y.opens, 0), started: l.started } : null; }
export function exportJSON() {
  closeCur();
  const l = L || load(); if (!l) return null;
  return { game: 'Iron Rain', kind: 'session-log', exported: new Date().toISOString(), started: l.started, faction: l.faction, summary: summary(), turns: l.turns, events: l.events };
}
export function exportFile() {
  const j = exportJSON(); if (!j) return false;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `ironrain-session-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}
export function setOn(on) {
  if (!on && isOn()) { closeCur(); ev('log', { on: false }); }
  OPTS.sessionLog = !!on; saveOpts();
  if (on) { log(); ev('log', { on: true }); const C = window.__CAMP && window.__CAMP.C; if (C && C.on && !C.over) turnStart(C.turn); }
  else { turnAt = null; clearTimeout(saveT); if (L) try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) {} }
}
export function clear() { L = isOn() ? fresh() : null; cur = null; turnAt = null; try { localStorage.removeItem(KEY); } catch (e) {} if (isOn()) { const C = window.__CAMP && window.__CAMP.C; if (C && C.on && !C.over) turnStart(C.turn); persist(); } }
