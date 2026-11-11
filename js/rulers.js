// The rulers of the three powers and their heirs, as living characters. Each sits in C.cmdrs (state 'court' when
// not at sea), carries traits that shape the realm and the AI, and rules with a legitimacy that dips when the
// throne changes hands and recovers with time. Death and capture come through command.js's FATE hook.
// The Republic's Sovereign is succeeded by a Senate election; the Ash Lord by his daughter Atalantia, then Ajax or
// the Council of Houses; Romulus au Raa by Dido or Diomedes.
import { C, note, BLOC_NAME, CAPITAL, chron, human } from './camp.js';
import * as CM from './command.js';
import * as P from './politics.js';
import * as ST from './story.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const POW = ['rep', 'soc', 'rim'];

// ---------------------------------------------------------------- traits
// fx: multipliers read through politics.js effects() and tech.js mod(); loy is added to every estate's loyalty
export const TRAITS = {
  ruthless: { name: 'Ruthless', desc: 'Bombardment and executions cost nothing at court; fleets fight 4% harder. Rivals trust nothing she signs (−10 opinion).', fx: { ar: 1.04 }, opin: -10 },
  honour:   { name: 'Honour-bound', desc: 'Keeps every truce and treaty, and will not break one; rivals trust the word given (+10 opinion).', opin: 10 },
  lawgiver: { name: 'Lawgiver', desc: 'Laws cost half the influence to propose, and the realm can hold one more; +10% influence.', fx: { inf: 1.1 } },
  patient:  { name: 'Patient', desc: 'War weariness grows 15% slower. Waits for the walls to break before the Iron Rain.', fx: { weary: .85 } },
  reckless: { name: 'Reckless', desc: 'Fleets fight 6% harder, but war weariness grows 20% faster.', fx: { ar: 1.06, weary: 1.2 } },
  cunning:  { name: 'Cunning', desc: 'Spy networks grow 30% faster, and agents are likelier to succeed.', fx: { net: 1.3 } },
  ailing:   { name: 'Ailing', desc: 'Old and long sick: influence −10%. The court already looks to the heir.', fx: { inf: .9 } },
  beloved:  { name: 'Beloved', desc: 'Every estate +3 loyalty; legitimacy recovers twice as fast.', fx: { loy: 3 } },
  divided:  { name: 'Divided', desc: 'A council, not a ruler: influence −10%, but every House settles 4 points happier, each with its voice heard.', fx: { inf: .9 } },
  hawk:     { name: 'Hawk', desc: 'Wants the Republic checked: hulls are built 10% faster, and peace comes dearer.', fx: { build: .9 } },
  shrewd:   { name: 'Shrewd', desc: 'A dealer: trade +10%, and rivals ask 10% less in any peace.', fx: { trade: 1.1 } },
  populist: { name: 'Populist', desc: 'Beloved of the lowColors: Reds +6 loyalty, Golds −4; the Vox Populi stand behind him.' },
  valiant:  { name: 'Valiant', desc: 'A Peerless knight on the throne: Iron Rains land 10% more troops; the officer corps follows gladly (+5 loyalty).', fx: { rain: 1.1 } },
};

// ---------------------------------------------------------------- AI doctrine: how a ruler makes war
// The temperament names follow morale.js's battle doctrines (steady, onslaught, reckless, patient, cunning), with
// 'turtle' for a council that cannot agree on anything but the walls.
//  sup: the superiority a strike needs · rain: the odds the AI wants before an Iron Rain · dark: how often it runs
//  dark · peace: shifts when it sues and accepts (higher is readier) · truce: willingness to break a truce (0 never) ·
//  build: the peacetime fleet it keeps, against its neighbours · def: weight on defences · ops: how eagerly it gathers
//  an offensive · revenge: how much a grudge pulls its targets · take: what it does with a world it takes · crews: with
//  crews that strike to it · agents: the mix it recruits and sends
export const AI_DOC = {
  steady:    { name: 'Steady', desc: 'Fights by the book: strikes with a clear edge, keeps its word, builds what its neighbours build.', sup: 1.35, rain: .65, dark: .3, peace: 0, truce: .3, build: 1, def: 1, ops: 1, revenge: .5, take: 'occupy', crews: 'press', agents: { spy: .45, assassin: .15, watch: .2, guard: .2 } },
  onslaught: { name: 'Onslaught', desc: 'Ruthless and aggressive: strikes with a thin edge, gathers great offensives, will not make peace while it can still fight.', sup: 1.2, rain: .55, dark: .3, peace: -20, truce: .6, build: 1.2, def: .8, ops: 1.4, revenge: 1, take: 'sack', crews: 'space', agents: { spy: .35, assassin: .4, watch: .15, guard: .1 } },
  reckless:  { name: 'Reckless', desc: 'Throws fleets at anything it might beat, drops the Rain at poor odds, never sues for peace.', sup: 1.05, rain: .42, dark: .1, peace: -30, truce: .8, build: 1.25, def: .6, ops: 1.6, revenge: 1.6, take: 'sack', crews: 'space', agents: { assassin: .6, spy: .3, watch: .05, guard: .05 } },
  patient:   { name: 'Patient', desc: 'Strikes only with a crushing edge, waits for the walls to break, keeps every truce, and makes peace when it can.', sup: 1.6, rain: .75, dark: .25, peace: 15, truce: 0, build: .85, def: 1.3, ops: .8, revenge: .3, take: 'occupy', crews: 'exchange', agents: { spy: .4, watch: .3, guard: .3, assassin: 0 } },
  turtle:    { name: 'Turtle', desc: 'A council that agrees only on its walls: fortifies, sues for peace early, rarely attacks.', sup: 1.9, rain: .8, dark: .1, peace: 25, truce: 0, build: .7, def: 1.8, ops: .5, revenge: .2, take: 'occupy', crews: 'ransom', agents: { guard: .5, spy: .3, watch: .2, assassin: 0 } },
  cunning:   { name: 'Cunning', desc: 'Runs dark, spies first, strikes where it is not expected, and settles grudges.', sup: 1.25, rain: .6, dark: .6, peace: 5, truce: .5, build: 1, def: 1, ops: 1.1, revenge: .9, take: 'special', crews: 'exchange', agents: { spy: .5, watch: .25, assassin: .25, guard: 0 } },
};
const DOC_BY = [['Virginia', 'steady'], ['Magnus', 'patient'], ['Atalantia', 'onslaught'], ['Ajax', 'reckless'], ['Romulus', 'patient'], ['Dido', 'cunning'], ['Diomedes', 'steady'], ['Lysander', 'cunning'], ['Daxo', 'steady'], ['Publius', 'patient'], ['Dancer', 'patient'], ['Darrow', 'cunning'], ['Sevro', 'reckless'], ['Victra', 'onslaught']];
const docByTraits = ts => ts.includes('reckless') ? 'reckless' : ts.includes('ruthless') ? 'onslaught' : ts.includes('patient') ? 'patient' : ts.includes('cunning') ? 'cunning' : ts.includes('divided') ? 'turtle' : 'steady';

// ---------------------------------------------------------------- the courts of 753 PCE
// Atalantia, Ajax, Diomedes and Dido are commanders already (command.js LORE); here they get their ruling traits.
const COURT = {
  rep: [
    { name: 'Virginia au Augustus', title: 'Sovereign of the Solar Republic, the Mustang', traits: ['lawgiver', 'shrewd'], house: 'sov', style: 'Sovereign', royal: 'ruler' },
    { name: 'Daxo au Telemanus', title: 'Senator, of the Sovereign’s coalition', traits: ['lawgiver', 'patient'], house: 'sov', cand: true },
    { name: 'Publius cu Caraval', title: 'Senator, leader of the Moderates', traits: ['shrewd', 'patient'], house: 'mod', colour: 'Copper', cand: true },
    { name: 'Dancer', title: 'Tribune of the Vox Populi, once of the Sons of Ares', traits: ['populist', 'patient'], house: 'vox', colour: 'Red', cand: true },
  ],
  soc: [
    { name: 'Magnus au Grimmus', title: 'The Ash Lord, Sovereign of the Society Remnant', traits: ['ruthless', 'ailing'], house: 'grimmus', style: 'the Ash Lord', royal: 'ruler' },
  ],
  rim: [
    { name: 'Romulus au Raa', title: 'Sovereign of the Rim Dominion, Lord of Io', traits: ['honour', 'patient'], house: 'raa', style: 'Sovereign', royal: 'ruler' },
    { name: 'Lysander au Lune', title: 'Grandson of Octavia au Lune, a guest of House Raa', traits: ['cunning', 'shrewd'], house: null },
  ],
};
const RULING_TRAITS = { Atalantia: ['ruthless', 'cunning'], Ajax: ['reckless', 'valiant'], Diomedes: ['honour', 'valiant'], Dido: ['hawk', 'cunning'], Darrow: ['beloved', 'reckless'], Sevro: ['reckless', 'beloved'], Victra: ['ruthless', 'shrewd'], Kavax: ['honour', 'beloved'], Seraphina: ['valiant', 'honour'], Valeria: ['shrewd', 'patient'], Kalindora: ['honour', 'patient'], Atlas: ['cunning', 'ruthless'] };
const byName = n => C.cmdrs.find(c => (c.name || '').startsWith(n));
export const cById = id => id == null ? null : C.cmdrs.find(c => c.id === id) || null;
const free = c => c && c.state !== 'dead' && c.state !== 'captured';

export function afterLoad() { if (!fateOn) { CM.FATE.unshift(onFate); fateOn = true; } } /* a loaded campaign hears the fates too */
export function setupRulers() {
  if (!fateOn) { CM.FATE.unshift(onFate); fateOn = true; }
  C.rulers = {};
  for (const f of POW) for (const S of COURT[f]) { const c = CM.makeCmdr(f, { ...S, rank: S.rank ?? 1 }); c.state = 'court'; c.courtier = true; c.traits = S.traits.slice(); c.house = S.house; if (S.style) c.style = S.style; if (S.cand) c.cand = true; if (S.royal) c.royal = S.royal; }
  for (const c of C.cmdrs) { const k = Object.keys(RULING_TRAITS).find(n => c.name.startsWith(n)); if (k && !c.traits) c.traits = RULING_TRAITS[k].slice(); }
  const id = n => (byName(n) || {}).id;
  C.rulers.rep = { id: id('Virginia'), heir: null, legit: 85, since: 1 };
  C.rulers.soc = { id: id('Magnus'), heir: id('Atalantia'), legit: 70, since: 1 };
  C.rulers.rim = { id: id('Romulus'), heir: id('Diomedes'), legit: 90, since: 1 };
  for (const f of POW) { const h = cById(C.rulers[f].heir); if (h) h.royal = 'heir'; }
  sync();
}

// ---------------------------------------------------------------- who rules
export const R = f => (C.rulers && C.rulers[f]) || null;
export const rulerOf = f => { const r = R(f); if (!r) return null; return r.council ? { name: r.council, traits: ['divided'], council: true, style: '' } : cById(r.id); };
// the regent rules while the true ruler is a prisoner
export const actingOf = f => { const r = R(f); if (!r) return null; if (r.regent != null) return cById(r.regent) || rulerOf(f); return rulerOf(f); };
export const heirOf = f => { const r = R(f); return r ? cById(r.heir) : null; };
export const traitsOf = f => { const a = actingOf(f); return (a && a.traits) || []; };
export const hasTrait = (f, t) => traitsOf(f).includes(t);
export const legitOf = f => (R(f) || { legit: 60 }).legit;
export const isRoyal = c => !!(c && (c.royal || (C.rulers && POW.some(f => C.rulers[f].id === c.id || C.rulers[f].heir === c.id))));
export const docKey = f => { const a = actingOf(f); if (!a) return 'steady'; if (a.council) return 'turtle'; const m = DOC_BY.find(([k]) => a.name.startsWith(k)); return m ? m[1] : docByTraits(a.traits || []); };
export const docOf = f => AI_DOC[docKey(f)] || AI_DOC.steady;
export const lawSlots = f => 2 + (hasTrait(f, 'lawgiver') ? 1 : 0);

// what the ruler's traits and legitimacy do to the realm: merged into politics.js effects()
export function fx(f) {
  const out = {};
  for (const t of traitsOf(f)) { const X = (TRAITS[t] || {}).fx; if (!X) continue; for (const k in X) out[k] = k === 'loy' ? (out[k] || 0) + X[k] : (out[k] || 1) * X[k]; }
  const L = legitOf(f); if (L < 50) out.inf = (out.inf || 1) * (1 - (50 - L) / 200); // a contested throne buys its loyalty
  return out;
}

// ---------------------------------------------------------------- legitimacy
export function legitParts(f) {
  const r = R(f), P0 = []; if (!r) return P0;
  const sup = P.supportOf(f), cap = clamp(55 + sup * .45, 0, 100);
  P0.push(['Settles toward: 55 + 45% of court support', Math.round(cap)]);
  if (r.regent != null) P0.push(['The true ruler is a prisoner', -20]);
  if (r.council) P0.push(['A council, not a crown', -10]);
  if (hasTrait(f, 'beloved')) P0.push(['Beloved: recovers twice as fast', 0]);
  const since = C.turn - (r.since || 1); if (since < 20) P0.push([`On the throne ${since} week${since === 1 ? '' : 's'}`, 0]);
  return P0;
}
const legitCap = f => legitParts(f).reduce((a, p, i) => i === 0 ? p[1] : a + p[1], 0);
function legitTick(f) {
  const r = R(f); if (!r) return; const cap = clamp(legitCap(f), 0, 100), k = hasTrait(f, 'beloved') ? 2 : 1;
  r.legit = clamp(r.legit + (r.legit < cap ? Math.min(1.2 * k, cap - r.legit) : -Math.min(.6, r.legit - cap)), 0, 100);
}

// ---------------------------------------------------------------- the display string the old UI shows
export function sync() {
  if (!C.rulers) return; C.leaders = C.leaders || {};
  for (const f of POW) {
    const r = R(f), a = rulerOf(f); if (!r) continue;
    if (r.council) { C.leaders[f] = r.council + (r.regent != null ? '' : ''); continue; }
    if (!a) { C.leaders[f] = `${BLOC_NAME[f]}, leaderless`; continue; }
    const st = a.style || (f === 'rep' ? 'Sovereign' : f === 'soc' ? 'Dictator' : 'Sovereign');
    let s = st.startsWith('the ') ? `${a.name}, ${st}` : `${st} ${a.name}`;
    if (r.regent != null) { const g = cById(r.regent); s = g ? `Regent ${g.name} (${a.name.split(' ')[0]} in chains)` : `${a.name}, in chains`; }
    C.leaders[f] = s;
  }
}

// ---------------------------------------------------------------- succession
const heirStyle = f => f === 'rep' ? 'Sovereign' : f === 'soc' ? 'Dictator' : 'Sovereign';
function crown(f, c, how, legit) {
  const r = R(f), old = rulerOf(f);
  r.id = c ? c.id : null; r.council = c ? null : (f === 'soc' ? 'The Council of Houses' : f === 'rim' ? 'The Council of Moon Lords' : 'The Senate of the Republic'); r.regent = null; r.since = C.turn;
  r.legit = clamp(Math.min(r.legit, legit), 0, 100);
  if (c) { c.royal = 'ruler'; c.style = c.style && c.style !== 'Peerless' ? c.style : heirStyle(f); if (!c.traits) c.traits = ['patient']; if (c.state === 'pool') c.state = 'court'; }
  if (old && old !== c && old.royal === 'ruler') old.royal = 'former';
  r.heir = null; pickHeir(f); sync();
  const nmR = c ? c.name : r.council;
  if (how !== 'elected by the Senate') note(`${nmR} ${c ? 'now rules' : 'rules'} ${BLOC_NAME[f]}${how ? ': ' + how : ''}.`, f === C.player ? 'gold' : '', CAPITAL[f], f === C.player ? { title: 'A new ruler', kind: 'alliance' } : null);
  chron('succession', `${nmR} ${c ? 'takes the throne of' : 'rules'} ${BLOC_NAME[f]}${how ? ' (' + how + ')' : ''}.`, CAPITAL[f], f);
  C.events.doc = C.events.doc || {}; C.events.doc[f] = docKey(f);
}
// the next in line, by the realm's custom
export function pickHeir(f) {
  const r = R(f); if (!r) return; if (r.heir != null && free(cById(r.heir)) && cById(r.heir).owner === f) return;
  const old = cById(r.heir); if (old && old.royal === 'heir') old.royal = null;
  let h = null;
  if (f === 'soc') { const a = byName('Atalantia'), x = byName('Ajax'); h = [a, x].find(c => c && free(c) && c.owner === 'soc' && c.id !== r.id) || null; }
  if (f === 'rim') { const L = ['Diomedes', 'Dido', 'Seraphina'].map(byName); h = L.find(c => c && free(c) && c.owner === 'rim' && c.id !== r.id) || null; }
  r.heir = h ? h.id : null; if (h) h.royal = 'heir';
}
// the Republic: the Senate elects among its candidates, each bloc for its own, weighted by its seats and its mood
export function electionParts() {
  const out = []; for (const c of C.cmdrs) if (c.owner === 'rep' && c.cand && free(c)) { const g = P.groupsOf('rep').find(x => x.id === c.house), D = g && P.defOf('rep', g.id); out.push([c, D ? D.w * Math.pow((g.sat + 10) / 100, 1.5) : 5]); }
  return out.sort((a, b) => b[1] - a[1]);
}
function election(why) {
  const L = electionParts(); if (!L.length) { crown('rep', null, why, 50); return; }
  const tot = L.reduce((a, x) => a + x[1], 0); let x = rnd() * tot, pick = L[0][0]; for (const [c, v] of L) { if ((x -= v) <= 0) { pick = c; break; } }
  pick.cand = false; crown('rep', pick, 'elected by the Senate', 45 + P.supportOf('rep') * .3);
  note(`The Senate of the Republic elects ${pick.name} Sovereign${why ? ', ' + why : ''}.`, C.player === 'rep' ? 'gold' : '', 'luna', { title: 'A new Sovereign', kind: 'alliance' });
}
// call when the ruler dies (or is gone for good): how the throne passes
export function succession(f, why, prefer) {
  if (!C.fac[f] || !C.fac[f].alive) { const r = R(f); if (r) { r.id = null; sync(); } return; }
  const r = R(f), old = rulerOf(f), oldN = old ? old.name : '';
  if (f === 'rep') return election(why);
  if (f === 'soc') {
    if (old && /Magnus/.test(oldN)) { const a = byName('Atalantia'); if (free(a) && a.owner === 'soc') { a.style = 'Dictator'; crown('soc', a, why || 'the Ash Lord’s daughter', 62); return; } }
    if (prefer === 'council') { crown('soc', null, 'the Houses choose', 40); return; }
    const x = byName('Ajax'); if (prefer === 'Ajax' && free(x) && x.owner === 'soc') { x.style = 'Dictator'; crown('soc', x, 'the Storm Knight claims his sister’s place', 48); return; }
    // the choice is the Remnant's to make: a card for its player, the AI's pick otherwise
    r.id = null; r.regent = null; r.council = 'The Remnant, leaderless'; sync(); C.events.succession = C.turn;
    ST.queueEvent('succession', 'soc');
    return;
  }
  if (f === 'rim') {
    if (!prefer && C.events.rimHeir) { prefer = C.events.rimHeir; C.events.rimHeir = null; }
    const pick = prefer ? byName(prefer) : null, L = [pick, byName('Dido'), byName('Diomedes'), byName('Seraphina')].filter(c => c && free(c) && c.owner === 'rim');
    if (!prefer && L.length > 1 && !human(f)) { /* the council's choice */ const lux = (P.groupsOf('rim').find(g => g.id === 'lux') || { sat: 50 }).sat; const c = lux > 55 ? byName('Dido') : byName('Diomedes'); if (free(c) && c.owner === 'rim') return crownRim(c, why); }
    if (!prefer && L.length > 1 && human(f)) { r.id = null; r.council = 'The council, in mourning'; sync(); ST.queueEvent('rimSuccession', 'rim'); return; }
    if (L[0]) return crownRim(L[0], why);
    crown('rim', null, why, 40);
  }
}
const crownRim = (c, why) => { c.style = 'Sovereign'; crown('rim', c, why || (c.name.startsWith('Dido') ? 'Dido au Raa takes her husband’s throne' : 'the heir of Io'), c.name.startsWith('Diomedes') ? 60 : 52); };
export const crownBy = (f, name, why, legit) => { const c = byName(name); if (free(c) && c.owner === f) { c.style = heirStyle(f); crown(f, c, why, legit); return true; } return false; };
export const crownCouncil = (f, why, legit = 40) => crown(f, null, why, legit);

// death and capture, from command.js (registered once, at the first campaign: no module touches another's
// bindings while the import cycle is still loading)
let fateOn = false;
function onFate(k, c, by) {
  if (!C.rulers) return;
  for (const f of POW) {
    const r = R(f); if (!r) continue;
    if (r.id === c.id) {
      if (k === 'kill') { const how = c.captor ? 'in chains' : ''; if (r.regent != null) { const g = cById(r.regent); r.regent = null; if (g && free(g)) { g.style = heirStyle(f); crown(f, g, 'the regent takes the crown', Math.max(40, r.legit - 10)); } else succession(f, how); } else { r.legit = Math.max(0, r.legit - 25); succession(f, how); } }
      else if (k === 'capture') { const h = heirOf(f); r.legit = Math.max(0, r.legit - 20); if (h && free(h)) { r.regent = h.id; r.heir = null; h.royal = 'regent'; pickHeir(f); note(`${c.name} is a prisoner of ${BLOC_NAME[by]}. ${h.name} rules ${BLOC_NAME[f]} as regent.`, f === C.player ? 'bad' : by === C.player ? 'good' : 'gold', CAPITAL[f], f === C.player || by === C.player ? { title: 'A ruler in chains', kind: 'fall' } : null); sync(); } else { r.regent = null; succession(f, 'the ruler taken'); } }
    } else if (r.regent === c.id) { r.regent = null; if (k === 'kill' || k === 'capture') { const h = heirOf(f); if (h && free(h)) { r.regent = h.id; r.heir = null; pickHeir(f); } } sync(); }
    else if (r.heir === c.id) { r.heir = null; c.royal = k === 'capture' ? 'heir' : null; pickHeir(f); sync(); }
  }
}
// a ruler set free (ransom, rescue, a peace) comes home and takes the throne back from the regent
export function freed(c) {
  if (c.state === 'captured' || c.state === 'court' || c.state === 'pool') { c.state = c.courtier ? 'court' : 'pool'; c.captor = null; }
  for (const f of POW) { const r = R(f); if (!r || r.id !== c.id) continue; if (r.regent != null) { const g = cById(r.regent); if (g) { g.royal = 'heir'; r.heir = g.id; } r.regent = null; }
    r.legit = clamp(r.legit + 10, 0, 100); sync(); note(`${c.name} is free, and rules ${BLOC_NAME[f]} again.`, f === C.player ? 'good' : 'gold', CAPITAL[f]); chron('freed', `${c.name} returns to ${BLOC_NAME[f]}.`, CAPITAL[f], f); }
}

// ---------------------------------------------------------------- the weekly tick
export function tick() {
  if (!C.rulers) return;
  for (const f of POW) {
    if (!C.fac[f].alive) continue; const r = R(f);
    legitTick(f);
    pickHeir(f);
    if (r.regent != null && !free(cById(r.regent))) { r.regent = null; }
    const a = rulerOf(f); if (a && !a.council && a.state === 'captured' && r.regent == null) { const h = heirOf(f); if (h && free(h)) { r.regent = h.id; r.heir = null; pickHeir(f); } }
    // the doctrine follows whoever rules: say so when it changes
    C.events.doc = C.events.doc || {}; const dk = docKey(f); if (C.events.doc[f] && C.events.doc[f] !== dk && f !== C.player) note(`${BLOC_NAME[f]} changes its way of war under ${actingOf(f) ? actingOf(f).name : 'its new masters'}: ${AI_DOC[dk].name}.`, '', CAPITAL[f]); C.events.doc[f] = dk;
  }
  sync();
}
// a capital falls: the court there may be taken
export function capitalFalls(f, by) {
  if (!C.rulers || !R(f) || !by || by === 'neu') return;
  for (const c of [rulerOf(f), heirOf(f)]) if (c && !c.council && c.state === 'court' && c.owner === f && rnd() < .35) CM.capture(c, null, by, 'the fall of the capital');
}
