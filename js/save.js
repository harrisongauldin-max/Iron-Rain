// Saving and loading a campaign. The whole war lives in one object (camp.js's C) plus the seat of each power's
// government; both are written out as JSON. Slots live in this browser's storage: an autosave written at the start
// of every week, and three slots of the player's own. A campaign can also be written to a file and read back, which
// is the safe copy: browser storage can be cleared.
import { C, CAPITAL } from './camp.js';
import { placePlanets } from './solar.js';
import * as ST from './story.js';
import * as RU from './rulers.js';

export const VERSION = 1;
export const SLOTS = ['auto', '1', '2', '3'];
const KEY = s => 'ironrain.save.' + s, META = s => 'ironrain.meta.' + s;
const store = () => { try { return window.localStorage || null; } catch (e) { return null; } };

// the campaign as a string. The ship-design cache (C.defs) is rebuilt on demand, so it stays out
export function snapshot() {
  const body = {}; for (const k in C) if (k !== 'defs') body[k] = C[k];
  return JSON.stringify({ v: VERSION, t: Date.now(), cap: { ...CAPITAL }, C: body });
}
const metaOf = (txt, slot) => ({ slot, t: Date.now(), turn: C.turn, player: C.player, start: C.start || null, leader: (C.leaders && C.leaders[C.player]) || '', worlds: Object.values(C.worlds).filter(w => w.owner === C.player).length, size: txt.length });

// returns null when it worked, or what went wrong
export function saveSlot(slot) {
  const ls = store(); if (!ls) return 'This browser will not keep saves here. Export the campaign to a file instead.';
  if (!C.on || C.over) return 'There is no campaign under way to save.';
  let txt; try { txt = snapshot(); } catch (e) { console.error(e); return 'The campaign could not be written out.'; }
  try { ls.setItem(KEY(slot), txt); ls.setItem(META(slot), JSON.stringify(metaOf(txt, slot))); return null; }
  catch (e) {
    // out of room: the autosave goes first, then the oldest of the player's own slots, and one more try
    try { if (slot !== 'auto') { ls.removeItem(KEY('auto')); ls.removeItem(META('auto')); } ls.setItem(KEY(slot), txt); ls.setItem(META(slot), JSON.stringify(metaOf(txt, slot))); return null; }
    catch (e2) { return 'The browser has no room left for saves. Export the campaign to a file instead.'; }
  }
}
export function listSlots() {
  const ls = store(); if (!ls) return [];
  return SLOTS.map(s => { try { const m = JSON.parse(ls.getItem(META(s)) || 'null'); return m && ls.getItem(KEY(s)) ? m : null; } catch (e) { return null; } }).filter(Boolean);
}
export const latest = () => listSlots().sort((a, b) => b.t - a.t)[0] || null;
export function deleteSlot(slot) { const ls = store(); if (!ls) return; try { ls.removeItem(KEY(slot)); ls.removeItem(META(slot)); } catch (e) { /* nothing to do */ } }
// the saved campaign, parsed but not yet put in place
export function readSlot(slot) { const ls = store(); if (!ls) return null; try { return parse(ls.getItem(KEY(slot))); } catch (e) { return null; } }
export function parse(txt) {
  const d = JSON.parse(txt);
  if (!d || typeof d !== 'object' || !d.C || !d.C.worlds || !d.C.fleets || !d.C.fac) throw new Error('This is not an Iron Rain campaign.');
  if ((d.v || 0) > VERSION) throw new Error('This campaign was saved by a newer version of the game.');
  return d;
}
// put a saved campaign in place of the one in memory. The caller rebuilds the map afterwards
export function restore(d) {
  for (const k of Object.keys(C)) delete C[k];
  Object.assign(C, d.C); C.defs = {}; C.on = true;
  Object.assign(CAPITAL, d.cap || {});
  C.moving = true; placePlanets(C.turn); // the planets always move, saves from before that rule included
  ST.afterLoad(); RU.afterLoad();
  return C;
}

// a file the player keeps
export function exportFile() {
  const txt = snapshot(), a = document.createElement('a'), side = { rep: 'republic', soc: 'remnant', rim: 'rim' }[C.player] || C.player;
  a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = `iron-rain-${side}-week-${C.turn}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
// ask for a file and hand back the parsed campaign (or throw why not)
export function pickFile() {
  return new Promise((ok, no) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return no(new Error('No file chosen.')); const r = new FileReader(); r.onload = () => { try { ok(parse(r.result)); } catch (e) { no(e); } }; r.onerror = () => no(new Error('The file could not be read.')); r.readAsText(f); };
    inp.click();
  });
}
