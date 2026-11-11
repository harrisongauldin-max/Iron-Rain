// Phase D of the campaign: politics. Each power answers to someone: the Republic to its Senate of 140, the Remnant
// to its great Houses, the Rim to its council of Moon Lords. Each group has a satisfaction that drifts toward where
// the war leaves it and jumps with what you do; every number here can be explained, part by part. Each power passes
// laws through its own body. Between the powers: opinions that remember, war goals, and peace bought item by item
// with war score: worlds, prisoners, yards, alliances, tribute, a captured ruler.
import { C, note, hostile, relOf, setRel, BLOC_NAME, CAPITAL, fleetsAt, fleetStr, declareWar, travel, chron, human } from './camp.js';
import * as CM from './command.js';
import * as EC from './economy.js';
import * as RU from './rulers.js';
import * as SR from './starts.js';
import { bodyOf, WORLDS } from './solar.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const nm = id => bodyOf(id).name;
const POW = ['rep', 'soc', 'rim'];
export const atWarWith = f => POW.filter(o => o !== f && C.fac[o] && C.fac[o].alive && hostile(f, o));
const sum = P0 => P0.reduce((a, p) => a + p[1], 0);
const rounded = P0 => P0.map(([a, b]) => [a, Math.round(b * 10) / 10]);

// ---------------------------------------------------------------- who each power answers to
// react: how a group's satisfaction jumps when its power does something. like: where it settles, given the war
const GROUPS = {
  rep: { kind: 'senate', title: 'The Senate of the Republic', groups: [
    { id: 'sov', name: 'The Sovereign’s coalition', head: 'Sovereign Virginia au Augustus', w: 52, base: 14, war: 0, react: { nuke: -2, victory: 2, conquest: 3, defeat: -2, rain: 0, bombard: -3, peace: 2, defy: -4 }, likes: 'Order and victory; it stands with the Sovereign' },
    { id: 'mod', name: 'The Moderates', head: 'Publius cu Caraval', w: 40, base: 0, war: -4, react: { nuke: -4, victory: 2, conquest: 2, defeat: -4, rain: -3, bombard: -5, peace: 5, defy: -10 }, likes: 'Coppers and Silvers who want the war won cheaply, or ended' },
    { id: 'vox', name: 'Vox Populi', head: 'Dancer', w: 48, base: -4, war: -8, react: { nuke: -6, victory: 0, conquest: 0, defeat: -4, rain: -6, bombard: -10, peace: 10, defy: -16 }, likes: 'The lowColors’ party: it hates casualties and wants the money spent at home' },
  ] },
  soc: { kind: 'houses', title: 'The Houses of the Remnant', groups: [
    { id: 'grimmus', name: 'House Grimmus', head: 'Atalantia au Grimmus', seat: 'venus', w: 40, base: 10, war: 4, react: { nuke: 0, victory: 4, conquest: 4, defeat: -5, rain: 1, bombard: 1, peace: -8, lost: -6 }, likes: 'The Ash Lord’s house: war to the end', low: 'Fleets fight 5% weaker when auto-resolved', high: 'Fleets fight 5% harder' },
    { id: 'carthii', name: 'House Carthii', head: 'Asmodeus au Carthii', seat: 'venus', w: 25, base: 4, war: 0, react: { nuke: -1, victory: 2, conquest: 2, defeat: -3, peace: 2, lost: -8 }, likes: 'The shipwrights of Venus', low: 'Hulls take 30% longer to build', high: 'Hulls are built 10% faster' },
    { id: 'votum', name: 'House Votum', head: 'Scorpio au Votum', seat: 'mercury', w: 20, base: 4, war: 0, react: { nuke: -1, victory: 2, conquest: 3, defeat: -3, peace: 0, lost: -6 }, likes: 'The ruling house of Mercury and its Scorpion Legions', low: 'Garrison caps −20%', high: 'Garrison caps +10%' },
    { id: 'saud', name: 'House Saud', head: 'Primus of House Saud', seat: 'venus', w: 15, base: 0, war: -2, react: { nuke: 0, victory: 1, conquest: 1, defeat: -3, peace: 4, lost: -4 }, likes: 'An old Venusian house, Dido au Raa’s blood', low: 'Influence −30%', high: 'Influence +15%' },
  ] },
  rim: { kind: 'council', title: 'The Council of Moon Lords', groups: [
    { id: 'raa', name: 'House Raa', head: 'Romulus au Raa', seat: 'io', w: 30, base: 12, war: -3, react: { nuke: -3, victory: 3, conquest: 2, defeat: -4, peace: 3, lost: -10, war: -4 }, likes: 'The Sovereign’s house: honour, and the peace of Ilium' },
    { id: 'lux', name: 'House Lux', head: 'Helios au Lux', w: 20, base: 6, war: 2, react: { nuke: -3, victory: 3, conquest: 3, defeat: -3, peace: -2, war: 4 }, likes: 'Old Helios, ArchKnight of the Rim: the Republic must be checked' },
    { id: 'codovan', name: 'House Codovan', head: 'Lord of the Ganymede yards', seat: 'ganymede', w: 20, base: 4, war: 2, react: { nuke: -3, victory: 2, conquest: 2, defeat: -3, peace: -1, war: 3, lost: -10 }, likes: 'Shipwrights of Ganymede, who remember who burned their docks' },
    { id: 'norvo', name: 'House Norvo', head: 'Lord of Triton', seat: 'triton', w: 10, base: 2, war: -2, react: { nuke: -3, victory: 1, defeat: -3, peace: 3, war: -3, lost: -10 }, likes: 'The ruling house of Triton, far from any war' },
    { id: 'callisto', name: 'Lord of Callisto', head: 'Moon Lord of Callisto', seat: 'callisto', w: 10, base: 4, war: 3, react: { nuke: -3, victory: 3, conquest: 2, defeat: -2, peace: -2, war: 3, lost: -10 }, likes: 'The fortress moon: Grays, Obsidians and a garrison fleet' },
    { id: 'titan', name: 'Lord of Titan', head: 'Moon Lord of Titan', seat: 'titan', w: 10, base: 2, war: -1, react: { nuke: -3, victory: 2, defeat: -3, peace: 3, war: -2, lost: -10 }, likes: 'Saturn’s farmlands and Titan Arms' },
  ] },
};
export const groupsOf = f => (C.pol && C.pol[f] && C.pol[f].groups) || [];
export const kindOf = f => GROUPS[f] ? GROUPS[f].kind : null;
export const titleOf = f => GROUPS[f] ? GROUPS[f].title : '';
export const defOf = (f, id) => GROUPS[f] ? GROUPS[f].groups.find(g => g.id === id) : null;
export const bodyName = f => ({ senate: 'the Senate', houses: 'the Houses', council: 'the council' })[kindOf(f)] || 'the court';
export function setupPolitics() {
  C.pol = {}; C.truce = {}; C.tribute = []; C.motion = {}; C.laws = { rep: [], soc: [], rim: [] }; C.opinion = {}; C.goals = {}; C.lawT = {};
  for (const f of POW) C.pol[f] = { groups: GROUPS[f].groups.map(g => ({ id: g.id, sat: clamp(50 + g.base, 0, 100), low: 0, wed: [] })), defied: 0 };
  C.pol.rep.groups.find(g => g.id === 'vox').sat = 30; // the Vox already rage at the Mercury campaign
  C.goals['rep>soc'] = { k: 'take', w: 'mercury', t: 1 }; // Darrow's war: Mercury
}
export const supportOf = f => { const G = groupsOf(f), D = GROUPS[f].groups; const tw = D.reduce((a, g) => a + g.w, 0); return G.reduce((a, g) => a + g.sat * defOf(f, g.id).w, 0) / tw; };
export function react(f, kind, mag = 1) {
  if (!C.pol || !C.pol[f]) return;
  if (kind === 'bombard' && RU.hasTrait(f, 'ruthless')) return; // a ruthless court does not flinch
  for (const g of C.pol[f].groups) { const d = defOf(f, g.id).react[kind]; if (d) g.sat = clamp(g.sat + d * mag, 0, 100); }
}
// who speaks for a group now: its named head while they live, else its candidate or its House's heir
export function headOf(f, gid) {
  const D = defOf(f, gid); if (!D) return ''; const n = D.head.replace(/^Sovereign /, ''), c = C.cmdrs && C.cmdrs.find(x => x.name === n);
  if (!c || (c.state !== 'dead' && c.owner === f)) return D.head;
  const nu = C.cmdrs.find(x => x.owner === f && x.house === gid && x.state !== 'dead' && x.state !== 'captured' && (x.cand || x.royal || x.lore)); return nu ? nu.name : 'Its elders, leaderless';
}
export const nudge = (f, gid, v) => { const g = groupsOf(f).find(x => x.id === gid); if (g) g.sat = clamp(g.sat + v, 0, 100); };
// a world changes hands: its House, if it has one there, takes the loss
export function seatLost(f, w) { if (!C.pol || !C.pol[f]) return; for (const g of C.pol[f].groups) if (defOf(f, g.id).seat === w) g.sat = clamp(g.sat + (defOf(f, g.id).react.lost || -6), 0, 100); }
// where a group's satisfaction settles, part by part
export function targetParts(f, g) {
  const D = defOf(f, g.id), wars = atWarWith(f).length, P0 = [['Base', 50]];
  if (D.base) P0.push([`${D.name}’s leanings`, D.base]);
  if (wars && D.war) P0.push([wars > 1 ? `At war on ${wars} fronts` : 'At war', D.war * wars]);
  const wy = Math.max(0, (C.weary[f] || 0) - 30) / 4; if (wy) P0.push(['War weariness', -wy]);
  if (D.seat && C.worlds[D.seat] && C.worlds[D.seat].owner !== f) P0.push([`Their seat, ${nm(D.seat)}, is lost`, -15]);
  if (C.tax && C.tax[f] >= 2) P0.push([`${EC.TAX[C.tax[f]].name} taxes`, -6 * (C.tax[f] - 1)]);
  if (g.wed.length) P0.push(['Bound by marriage', 6]);
  const a = RU.actingOf(f);
  if (a && a.council) { P0.push(['Every voice heard in council', 4]); if (f === 'soc' && g.id === 'grimmus') P0.push(['The Council keeps Grimmus from the throne', -10]); }
  else if (a && a.house === g.id) P0.push(['Their own blood on the throne', 8]);
  if (a && (a.traits || []).includes('populist')) { if (g.id === 'vox') P0.push(['A Sovereign of the people', 8]); if (g.id === 'sov') P0.push(['A Sovereign of the people', -3]); }
  const L = RU.legitOf(f); if (L < 60) P0.push(['A contested throne', -(60 - L) / 4]);
  for (const id of lawsOf(f)) { const Lw = lawDef(f, id), v = Lw && Lw.stance[g.id]; if (v) P0.push([`Law: ${Lw.name}`, v]); }
  if (g.turnedBy && g.turnedT > C.turn - 20) P0.push([`Agents of ${BLOC_NAME[g.turnedBy]} at work`, -12]);
  return rounded(P0);
}
export const targetOf = (f, g) => clamp(sum(targetParts(f, g)), 0, 100);
// what the groups' moods, the ruler and the laws do to the realm, recomputed every week
export function effects(f) {
  const out = {}, k = kindOf(f); if (!C.pol || !C.pol[f]) return out;
  if (k === 'senate') { const s = supportOf(f); out.he = s > 60 ? 1.1 : s < 40 ? .85 : 1; out.inf = s > 60 ? 1.1 : s < 40 ? .7 : 1; out.naval = s < 40 ? .85 : 1; out.trad = s > 60 ? .75 : 1; } // a Senate that backs the government funds it; one that does not starves the fleet
  if (k === 'houses') for (const g of C.pol[f].groups) {
    const lo = g.sat < 30, hi = g.sat > 70;
    if (g.id === 'grimmus') out.ar = lo ? .95 : hi ? 1.05 : 1;
    if (g.id === 'carthii') out.build = lo ? 1.3 : hi ? .9 : 1;
    if (g.id === 'votum') out.garrison = lo ? .8 : hi ? 1.1 : 1;
    if (g.id === 'saud') out.inf = lo ? .7 : hi ? 1.15 : 1;
  }
  out.loy = sum(loyParts(f));
  const mul = X => { for (const key in X) { if (key === 'loy') continue; out[key] = (out[key] == null ? 1 : out[key]) * X[key]; } };
  mul(RU.fx(f)); { const X = SR.ruleFx(f); if (X) mul(X); } for (const id of lawsOf(f)) { const L = lawDef(f, id); if (L && L.fx) mul(L.fx); }
  return out;
}
// what the court adds to every estate's loyalty on every world
export function loyParts(f) {
  const P0 = []; if (!C.pol || !C.pol[f]) return P0;
  if (kindOf(f) === 'council') { const s = supportOf(f); if (s > 60) P0.push(['The council stands behind the Sovereign', 3]); else if (s < 35) P0.push(['The council is in uproar', -4]); }
  for (const t of RU.traitsOf(f)) { const X = (RU.TRAITS[t] || {}).fx; if (X && X.loy) P0.push([`The ruler is ${RU.TRAITS[t].name}`, X.loy]); }
  return P0;
}
export const mod = (f, key) => { const e = C.polFx && C.polFx[f]; return e && e[key] != null ? e[key] : (key === 'loy' ? 0 : 1); };

// ---------------------------------------------------------------- patronage
export const HONOUR_COST = 25, MARRY_COST = 40, LOBBY_COST = 20;
export function honour(f, gid) {
  const r = C.fac[f].res, g = groupsOf(f).find(x => x.id === gid), c = kindOf(f) === 'senate' ? LOBBY_COST : HONOUR_COST;
  if (!g) return 'cannot'; if (r.inf < c) return `costs ${c} influence`;
  r.inf -= c; g.sat = clamp(g.sat + (kindOf(f) === 'senate' ? 9 : 12), 0, 100); return null;
}
export function marry(f, a, b) {
  const r = C.fac[f].res, A = groupsOf(f).find(x => x.id === a), B = groupsOf(f).find(x => x.id === b);
  if (!A || !B || a === b) return 'cannot'; if (A.wed.includes(b)) return 'already bound by marriage';
  if (r.inf < MARRY_COST) return `costs ${MARRY_COST} influence`;
  r.inf -= MARRY_COST; A.wed.push(b); B.wed.push(a); A.sat = clamp(A.sat + 15, 0, 100); B.sat = clamp(B.sat + 15, 0, 100);
  if (f === C.player) note(`A marriage binds ${defOf(f, a).name} and ${defOf(f, b).name}.`, 'gold'); return null;
}

// ---------------------------------------------------------------- laws and edicts
// Each power has its own: the Republic's pass the Senate, the Remnant's need the Houses' assent, the Rim's are
// compacts of the council. Each group and each estate has a stance on each law, which stays with it while the law
// stands. stance: a group's satisfaction · est: an estate's loyalty everywhere · fx: what it does to the realm
export const LAWS = {
  rep: [
    { id: 'pinks', name: 'Pink Emancipation', desc: 'Free the Pinks of the pleasure gardens, and give them the vote. The Vox cheer; the Silvers who owned the gardens and the old Golds do not.', stance: { sov: 4, mod: -6, vox: 12 }, est: { red: 4, gold: -5, mid: -3 }, fx: { inf: 1.05 } },
    { id: 'land', name: 'Obsidian Land Grants', desc: 'Land of their own on Mars and the Earth for the Obsidians who fought for the Rising: the legions’ thanks, at the Reds’ expense.', stance: { sov: 6, mod: -4, vox: -3 }, est: { war: 8, red: -2 }, fx: { man: 1.06 } },
    { id: 'amnesty', name: 'Red Hand Amnesty', desc: 'Amnesty for Harmony’s insurgents who lay down their arms. The Red Hand loses its recruits; the Senate fears it rewards terror.', stance: { sov: -6, mod: -8, vox: 10 }, est: { red: 6, gold: -3 }, fx: { uprise: .6 } },
    { id: 'conscript', name: 'lowColor Conscription', desc: 'Draft the lowColors into the legions: manpower for the war, hated in the mines.', stance: { sov: 6, mod: 2, vox: -16 }, est: { red: -8, war: 2 }, fx: { man: 1.3 } },
  ],
  soc: [
    { id: 'code', name: 'Enforce the Color Code', desc: 'Every Color in its place, as in the days of the Society: the Golds are pleased, the lowColors seethe.', stance: { grimmus: 8, carthii: 2, votum: 4, saud: -2 }, est: { gold: 8, mid: 2, red: -10, orange: -4 }, fx: { inf: 1.1 } },
    { id: 'levies', name: 'Ash Legion Levies', desc: 'Every House sends Grays and Obsidians to Atalantia’s Ash Legions.', stance: { grimmus: 8, carthii: -6, votum: -4, saud: -6 }, est: { war: -6 }, fx: { man: 1.25, garrison: 1.1 } },
    { id: 'yards', name: 'The Shipwrights’ Privilege', desc: 'The Carthii yards get first claim on alloys and crews.', stance: { carthii: 12, grimmus: -4, votum: -4 }, est: { orange: 6 }, fx: { build: .88 } },
  ],
  rim: [
    { id: 'ilium', name: 'The Compact of Ilium', desc: 'The council binds itself to the peace with the Republic: the Moon Lords’ alarm cools, trade flows, the hawks fume.', stance: { raa: 8, lux: -12, codovan: -8, norvo: 8, callisto: -6, titan: 6 }, est: { mid: 4 }, fx: { trade: 1.1 } },
    { id: 'muster', name: 'The Dustwalker Muster', desc: 'Each Moon Lord sends Grays and Obsidians to a common muster under the Sovereign.', stance: { raa: 2, lux: 6, codovan: 2, norvo: -8, callisto: 8, titan: -4 }, est: { war: -4 }, fx: { man: 1.2, garrison: 1.1 } },
    { id: 'tithe', name: 'The Moon Lords’ Tithe', desc: 'Every moon pays the Sovereign a tithe for the common fleet.', stance: { raa: 10, lux: -4, codovan: -6, norvo: -6, callisto: -4, titan: -6 }, est: { gold: -3 }, fx: { he: 1.08, inf: 1.1 } },
  ],
};
export const LAW_COST = 40;
export const lawsOf = f => (C.laws && C.laws[f]) || [];
export const lawDef = (f, id) => (LAWS[f] || []).find(L => L.id === id);
export const hasLaw = (f, id) => lawsOf(f).includes(id);
export const lawCost = f => Math.round(LAW_COST * (RU.hasTrait(f, 'lawgiver') ? .5 : 1) * (f === C.player && SR.rule('coalition') ? .75 : 1));
export function canPropose(f, id, repeal) {
  const L = lawDef(f, id); if (!L) return 'no such law'; if (C.motion[f]) return `${bodyName(f)} already has a motion before it`;
  if (repeal ? !hasLaw(f, id) : hasLaw(f, id)) return repeal ? 'not in force' : 'already law';
  if (!repeal && lawsOf(f).length >= RU.lawSlots(f)) return `every law slot is filled (${RU.lawSlots(f)}): repeal one first`;
  if ((C.fac[f].res.inf || 0) < lawCost(f)) return `costs ${lawCost(f)} influence`;
  return null;
}
export function proposeLaw(f, id, repeal) { const e = canPropose(f, id, repeal); if (e) return e; C.fac[f].res.inf -= lawCost(f); callVote(f, (repeal ? 'repeal:' : 'law:') + id, 2); return null; }

// ---------------------------------------------------------------- motions: the Senate's, and every power's laws
export const MOTIONS = {
  recall:   { name: 'Recall the ArchImperator', desc: 'Darrow attacked Mercury against the Senate’s vote. The motion would relieve him of command for eight weeks and call him home to answer for it.', against: true },
  armistice:{ name: 'Accept the armistice', desc: 'Take the peace the Remnant offers: twelve weeks of truce with the Society.', against: true },
  budget:   { name: 'Cap the fleet', desc: 'Hold the navy to what the Republic can afford: naval capacity −20% for ten weeks.', against: true },
  legions:  { name: 'Fund new legions', desc: 'Raise and pay for new legions: +4,000 manpower.', against: false, call: true },
  powers:   { name: 'Grant emergency powers', desc: 'Give the Sovereign’s government a free hand: +60 influence.', against: false, call: true },
};
export const MOTION_COST = 25;
export function motionDef(f, k) {
  if (k.startsWith('law:') || k.startsWith('repeal:')) { const rep = k.startsWith('repeal:'), L = lawDef(f, k.split(':')[1]); if (!L) return null; return { name: (rep ? 'Repeal: ' : '') + L.name, desc: L.desc, against: false, law: L, repeal: rep }; }
  return MOTIONS[k];
}
export const totalVotes = f => GROUPS[f].groups.reduce((a, g) => a + g.w, 0);
// how each group leans: its mood, its stance on a law, the Vox's and Moderates' grudge against Darrow
export function leanOf(f, g, k) {
  const M = motionDef(f, k); if (!M) return 0;
  if (M.law) { const st = M.law.stance[g.id] || 0; return 50 + (M.repeal ? -st : st) * 3 + (g.sat - 50) * .4; }
  return (M.against ? (100 - g.sat) : g.sat) + (k === 'recall' ? ({ vox: 25, mod: 15 }[g.id] || 0) : 0);
}
const yesOf = (f, k) => { let yes = 0; for (const g of groupsOf(f)) if (leanOf(f, g, k) > 50) yes += defOf(f, g.id).w; return yes; };
export const projected = (f, mk) => yesOf(f, mk);
export function callVote(f, mk, weeks = 2) { C.motion[f] = { k: mk, due: C.turn + weeks }; const M = motionDef(f, mk); if (f === C.player && M) note(`${bodyName(f)[0].toUpperCase() + bodyName(f).slice(1)} will vote in ${weeks} week${weeks > 1 ? 's' : ''}: ${M.name}.`, 'gold'); }
// the player calls one of the Senate's own motions to a vote
export function proposeMotion(f, k) { const M = MOTIONS[k]; if (!M || !M.call || kindOf(f) !== 'senate') return 'cannot'; if (C.motion[f]) return 'the Senate already has a motion before it'; if ((C.fac[f].res.inf || 0) < MOTION_COST) return `costs ${MOTION_COST} influence`; C.fac[f].res.inf -= MOTION_COST; callVote(f, k, 2); return null; }
// the vote: returns { k, yes, passed } for the player to answer, or applies it at once for the AI
function resolveVote(f) {
  const M = C.motion[f]; if (!M || C.turn < M.due) return null; C.motion[f] = null;
  const D = motionDef(f, M.k); if (!D) return null;
  const yes = yesOf(f, M.k), tot = totalVotes(f), passed = yes > tot / 2; const out = { k: M.k, yes, passed };
  if (D.law) { if (passed) { if (D.repeal) C.laws[f] = lawsOf(f).filter(x => x !== D.law.id); else C.laws[f] = lawsOf(f).concat(D.law.id); chron('law', `${BLOC_NAME[f]}: ${D.name} ${D.repeal ? 'is struck from the laws' : 'becomes law'} (${yes}–${tot - yes}).`, CAPITAL[f], f); }
    if (f === C.player || passed) note(`${bodyName(f)[0].toUpperCase() + bodyName(f).slice(1)} vote${kindOf(f) === 'senate' ? 's' : ''} ${yes}–${tot - yes}: ${D.name} ${passed ? 'passes' : 'fails'}.`, f === C.player ? (passed ? 'good' : 'bad') : '', CAPITAL[f]);
    return out; }
  if (f === C.player && D.against && SR.rule('free')) { note(`The Senate votes ${yes}–${tot - yes} on “${D.name}”. Sevro does not answer to the Senate: nothing comes of it.`, 'gold'); return out; } /* Free of the Senate */
  if (human(f)) { if (passed && D.against) { C.pendingVote = out; return out; } applyMotion(f, M.k, passed, false); note(`The Senate votes ${yes}–${tot - yes}: ${D.name} ${passed ? 'passes' : 'fails'}.`, passed ? (D.against ? 'bad' : 'good') : '', null); return out; }
  applyMotion(f, M.k, passed, passed && D.against && rnd() < .5); return out;
}
export function applyMotion(f, mk, passed, defy) {
  if (!passed) return;
  if (defy) { C.pol[f].defied++; react(f, 'defy'); if (f === C.player) note(`The government defies the Senate on “${MOTIONS[mk].name}”. The Senate rages; the Vox Populi take to the streets.`, 'bad', null, { title: 'Defiance', kind: 'war' }); for (const w of Object.values(C.worlds)) if (w.owner === f) EC.jolt(w, -3); if (C.rulers && C.rulers[f]) C.rulers[f].legit = Math.max(0, C.rulers[f].legit - 6); return; }
  if (mk === 'recall') { const d = C.cmdrs.find(c => c.owner === f && c.name.startsWith('Darrow')); if (d && d.state === 'fleet') { const fl = C.fleets.find(x => x.id === d.fleet); if (fl) CM.relieve(fl); } if (d && d.state !== 'dead' && d.state !== 'captured') { d.state = 'recalled'; d.recall = 8; } if (f === C.player) note('Darrow is recalled to Luna to answer to the Senate. He will be out of command for eight weeks.', 'bad'); }
  if (mk === 'armistice') { const o = 'soc'; if (hostile(f, o)) makePeace(f, o, 12); }
  if (mk === 'budget') C.pol[f].budgetCut = C.turn + 10;
  if (mk === 'legions') C.fac[f].res.man += 4000;
  if (mk === 'powers') C.fac[f].res.inf += 60;
}
function senateTick(f) {
  const r = resolveVote(f);
  if (!C.motion[f] && C.turn % 9 === 4) {
    const s = supportOf(f), w = atWarWith(f).length;
    const k = s < 40 && w ? 'budget' : s > 62 ? (rnd() < .5 ? 'legions' : 'powers') : rnd() < .5 ? 'legions' : 'budget';
    callVote(f, k);
  }
  return r;
}
// the AI's lawmaking: what its groups would welcome most, and what its ruler's war needs
function aiLaws(f) {
  if (!C.fac[f].ai || C.motion[f] || C.turn < 6 || (C.lawT[f] || 0) > C.turn - 10 || rnd() > .3) return;
  const war = atWarWith(f).length > 0, r = C.fac[f].res;
  const score = L => GROUPS[f].groups.reduce((a, g) => a + (L.stance[g.id] || 0) * g.w, 0) / 100 + (war && L.fx && L.fx.man ? (r.man < 15000 ? 6 : 2) : 0) + (L.id === 'ilium' ? (war ? -20 : RU.docKey(f) === 'patient' ? 4 : -2) : 0);
  if (lawsOf(f).length >= RU.lawSlots(f)) { const worst = lawsOf(f).map(id => lawDef(f, id)).sort((a, b) => score(a) - score(b))[0]; if (worst && score(worst) < -2 && projected(f, 'repeal:' + worst.id) > totalVotes(f) / 2 && !proposeLaw(f, worst.id, true)) C.lawT[f] = C.turn; return; }
  const L = (LAWS[f] || []).filter(x => !hasLaw(f, x.id) && projected(f, 'law:' + x.id) > totalVotes(f) / 2).sort((a, b) => score(b) - score(a))[0];
  if (L && score(L) > 0 && !proposeLaw(f, L.id)) C.lawT[f] = C.turn;
}

// ---------------------------------------------------------------- Houses: betrayal (Remnant and Rim)
// the chance a week that a bitter House goes over, and takes its seat with it
export function riskParts(f, g) {
  const D = defOf(f, g.id), P0 = [];
  if (!D.seat || D.seat === CAPITAL[f] || !C.worlds[D.seat] || C.worlds[D.seat].owner !== f) return [['No seat of its own to carry over', 0]];
  P0.push([g.low >= 3 ? `Bitter (under 15%) for ${g.low} weeks` : `Weeks bitter: ${g.low} of 3`, g.low >= 3 ? 15 : 0]);
  if (g.turnedBy && g.turnedT > C.turn - 20 && g.sat < 25) P0.push([`Turned by agents of ${BLOC_NAME[g.turnedBy]}`, 10]);
  if (RU.legitOf(f) < 40) P0.push(['A contested throne', 4]);
  return P0;
}
export const riskOf = (f, g) => sum(riskParts(f, g)) / 100;
// who a betraying House goes over to: whoever turned it, or the strongest enemy of its power
const strOf = o => C.fleets.filter(x => x.owner === o).reduce((a, x) => a + fleetStr(x), 0);
export function betrayTo(f, g) {
  if (g.turnedBy && g.turnedBy !== f && C.fac[g.turnedBy] && C.fac[g.turnedBy].alive) return g.turnedBy;
  if (kindOf(f) === 'council') return 'neu';
  return atWarWith(f).sort((a, b) => strOf(b) - strOf(a))[0] || 'neu';
}
function courtTick(f) {
  const k = kindOf(f);
  resolveVote(f);
  for (const g of C.pol[f].groups) {
    const D = defOf(f, g.id);
    g.low = g.sat < 15 ? g.low + 1 : 0;
    const risk = riskOf(f, g);
    if (risk > 0 && rnd() < risk) {
      const w = C.worlds[D.seat], to = betrayTo(f, g);
      w.owner = to; w.siege = null; w.bq = []; w.sq = []; w.desig = 'none'; w.garrison = Math.max(1200, w.garrison * .7); if (w.cl) { for (const e in w.cl) w.cl[e] = 45; w._loy = w.loyalty = 45; }
      g.sat = 40; g.low = 0; g.turnedBy = null;
      // the House's officers go with it
      for (const c of C.cmdrs) if (c.owner === f && c.house === g.id && c.state === 'pool' && !RU.isRoyal(c) && to !== 'neu') { c.owner = to; c.house = null; }
      note(to === 'neu' ? `${D.name} breaks with ${k === 'council' ? 'the council' : BLOC_NAME[f]}: ${nm(D.seat)} declares itself free.` : `Betrayal! ${D.name} goes over to ${BLOC_NAME[to]}, and ${nm(D.seat)} with it.`, f === C.player ? 'bad' : to === C.player ? 'good' : 'gold', D.seat, f === C.player || to === C.player ? { title: `${D.name} ${to === 'neu' ? 'secedes' : 'betrays'}`, kind: 'revolt' } : null);
      chron('betray', `${D.name} breaks with ${BLOC_NAME[f]}${to === 'neu' ? '' : ' for ' + BLOC_NAME[to]}, taking ${nm(D.seat)}.`, D.seat, f);
    }
  }
}

// ---------------------------------------------------------------- opinions between the powers
// C.opinion[a][b]: what a thinks of b, a list of modifiers that fade. Each is { k, label, v, decay, t }
const OBASE = { 'rep>soc': ['The Society that enslaved the Colors', -45], 'soc>rep': ['Slaves who murdered their masters', -45], 'rep>rim': ['The peace of Ilium', 15], 'rim>rep': ['The peace of Ilium', 10], 'rim>soc': ['The Core burned Rhea', -15], 'soc>rim': ['The Rim keeps its own counsel', 0] };
export function addOpinion(a, b, key, label, v, decay = .3, cap = 60) {
  if (!C.opinion || a === b || !POW.includes(a) || !POW.includes(b)) return;
  const A = C.opinion[a] = C.opinion[a] || {}, L = A[b] = A[b] || [], m = L.find(x => x.k === key);
  if (m) { m.v = clamp(m.v + v, -cap, cap); m.label = label; m.t = C.turn; } else L.push({ k: key, label, v: clamp(v, -cap, cap), decay, t: C.turn });
}
export function opinionParts(a, b) {
  const P0 = [], base = OBASE[a + '>' + b]; if (base && base[1]) P0.push(base);
  const rel = relOf(a, b); if (rel === 'war') P0.push(['At war', -10]); else if (rel === 'ally') P0.push(['Allies', 25]);
  const rb = RU.actingOf(b); if (rb) for (const t of rb.traits || []) { const o = (RU.TRAITS[t] || {}).opin; if (o) P0.push([`${rb.name.split(' ')[0]} is ${RU.TRAITS[t].name}`, o]); }
  for (const m of ((C.opinion && C.opinion[a] && C.opinion[a][b]) || [])) P0.push([m.label, m.v]);
  return rounded(P0);
}
export const opinionOf = (a, b) => POW.includes(a) && POW.includes(b) ? clamp(sum(opinionParts(a, b)), -100, 100) : 0;
function opinionTick() { for (const a in C.opinion || {}) for (const b in C.opinion[a]) { const L = C.opinion[a][b]; for (const m of L) if (m.t !== C.turn) m.v = m.v > 0 ? Math.max(0, m.v - m.decay) : Math.min(0, m.v + m.decay); C.opinion[a][b] = L.filter(m => Math.abs(m.v) >= .5); } }
// war: the victim remembers, and so do the others if a truce was broken
export function onWar(a, b, broke) {
  addOpinion(b, a, 'war', 'Declared war on us', -20, .25);
  if (broke) { addOpinion(b, a, 'truce', 'Broke a truce', -40, .25); for (const o of POW) if (o !== a && o !== b) addOpinion(o, a, 'oath', 'An oath-breaker', -15, .2); if (C.rulers && C.rulers[a]) C.rulers[a].legit = Math.max(0, C.rulers[a].legit - 8); }
  for (const o of POW) if (o !== a && o !== b && relOf(o, b) === 'ally') addOpinion(o, a, 'war', 'Attacked our ally', -12, .25);
  setGoal(a, b); if (!C.goals[b + '>' + a]) setGoal(b, a);
}

// ---------------------------------------------------------------- war goals
// Each power at war wants something: a world taken, a yard broken, a House humbled (its seat taken). Holding it
// counts for 20 war score.
const nearOf = (f, id) => Math.min(...Object.values(C.worlds).filter(x => x.owner === f).map(x => travel(x.id, id)).concat([12]));
const prodOf = id => (WORLDS.find(x => x.id === id) || { prod: {} }).prod;
export function worldValue(w, from) {
  const p = prodOf(w.id); let v = 6 + 4 * (w.lv.yard || 0) + 2 * ((w.lv.fort || 0) + (w.lv.court || 0)) + ((p.he || 0) + (p.ore || 0) + (p.ord || 0)) / 6 + (p.man || 0) / 60 + (EC.RARE[w.id] ? 3 : 0);
  if (from && w.home === from) v += 6; return Math.round(v);
}
export function pickGoal(f, o) {
  const ws = Object.values(C.worlds).filter(w => w.owner === o); if (!ws.length) return null;
  const sc = w => worldValue(w) / (1 + nearOf(f, w.id) * .5) * (w.id === CAPITAL[o] ? .6 : 1) * (w.home === f ? 1.6 : 1);
  const yards = ws.filter(w => w.lv.yard >= 2 && w.id !== CAPITAL[o]), houses = groupsOf(o).filter(g => { const D = defOf(o, g.id); return D.seat && D.seat !== CAPITAL[o] && C.worlds[D.seat].owner === o && kindOf(o) !== 'senate'; });
  const x = rnd();
  if (yards.length && x < .3) { const w = yards.sort((a, b) => sc(b) - sc(a))[0]; return { k: 'yard', w: w.id, t: C.turn }; }
  if (houses.length && x < .55) { const g = houses.sort((a, b) => sc(C.worlds[defOf(o, b.id).seat]) - sc(C.worlds[defOf(o, a.id).seat]))[0]; return { k: 'humble', g: g.id, w: defOf(o, g.id).seat, t: C.turn }; }
  return { k: 'take', w: ws.sort((a, b) => sc(b) - sc(a))[0].id, t: C.turn };
}
export const goalOf = (f, o) => (C.goals || {})[f + '>' + o] || null;
export function setGoal(f, o) { if (!C.goals || !POW.includes(f) || !POW.includes(o)) return; const g = pickGoal(f, o); if (g) C.goals[f + '>' + o] = g; }
export function goalText(f, o, g = goalOf(f, o)) { if (!g) return ''; return g.k === 'take' ? `Take ${nm(g.w)}` : g.k === 'yard' ? `Break the yards of ${nm(g.w)}` : `Humble ${defOf(o, g.g) ? defOf(o, g.g).name : 'a House'}: take ${nm(g.w)}`; }
export function goalHeld(f, o, g = goalOf(f, o)) { if (!g) return false; const w = C.worlds[g.w]; if (!w) return false; return g.k === 'yard' ? w.owner === f || (w.owner === o && !w.lv.yard) : w.owner === f; }
function goalTick() {
  for (const f of POW) for (const o of POW) { if (f === o) continue; const k = f + '>' + o;
    if (!C.fac[f].alive || !C.fac[o].alive || !hostile(f, o)) { delete C.goals[k]; continue; }
    const g = C.goals[k]; if (!g) { setGoal(f, o); continue; }
    if (!goalHeld(f, o, g) && C.worlds[g.w].owner !== o) setGoal(f, o); }
}

// ---------------------------------------------------------------- war score
const capLostOf = x => ((C.capLost && C.capLost[x]) || 0);
export function warScoreParts(f, o) {
  const P0 = [], held = (a, b) => Object.values(C.worlds).filter(w => w.owner === a && w.home === b).length;
  const str = x => C.fleets.filter(fl => fl.owner === x).reduce((a, fl) => a + fleetStr(fl), 0) || 1;
  const h1 = held(f, o), h2 = held(o, f); if (h1) P0.push([`Their worlds we hold (${h1})`, h1 * 12]); if (h2) P0.push([`Our worlds they hold (${h2})`, -h2 * 12]);
  const dw = ((C.weary[o] || 0) - (C.weary[f] || 0)) / 2; if (Math.abs(dw) >= .5) P0.push(['Their war weariness against ours', dw]);
  P0.push(['The balance of fleets', clamp(25 * Math.log(str(f) / str(o)), -50, 50)]); /* a beaten fleet weighs, but cannot decide a war on its own */
  if (capLostOf(o)) P0.push(['Capitals they have lost', 15 * capLostOf(o)]); if (capLostOf(f)) P0.push(['Capitals we have lost', -15 * capLostOf(f)]);
  if (goalHeld(f, o)) P0.push([`Our war goal held: ${goalText(f, o)}`, 20]); if (goalHeld(o, f)) P0.push([`Their war goal held: ${goalText(o, f)}`, -20]);
  const pr = (a, b) => C.cmdrs.filter(c => c.state === 'captured' && c.captor === a && c.owner === b);
  const roy1 = pr(f, o).filter(RU.isRoyal).length, roy2 = pr(o, f).filter(RU.isRoyal).length, n1 = pr(f, o).length - roy1, n2 = pr(o, f).length - roy2;
  if (roy1) P0.push([roy1 > 1 ? 'Their rulers in our chains' : 'Their ruler or heir in our chains', 25 * roy1]); if (roy2) P0.push([roy2 > 1 ? 'Our rulers in their chains' : 'Our ruler or heir in their chains', -25 * roy2]);
  if (n1) P0.push([`Their officers we hold (${n1})`, Math.min(10, 2 * n1)]); if (n2) P0.push([`Our officers they hold (${n2})`, -Math.min(10, 2 * n2)]);
  return rounded(P0);
}
export function warScore(f, o) { return clamp(sum(warScoreParts(f, o)), -100, 100); }
const RK = (a, b) => a < b ? a + '|' + b : b + '|' + a;
export const truceLeft = (a, b) => Math.max(0, ((C.truce && C.truce[RK(a, b)]) || 0) - C.turn);
export function makePeace(a, b, weeks = 20) {
  setRel(a, b, 'peace'); C.truce[RK(a, b)] = C.turn + weeks; react(a, 'peace'); react(b, 'peace');
  for (const w of Object.values(C.worlds)) if (w.siege && ((w.siege.by === a && w.owner === b) || (w.siege.by === b && w.owner === a))) w.siege = null;
  addOpinion(a, b, 'peace', 'Made peace with us', 10, .3); addOpinion(b, a, 'peace', 'Made peace with us', 10, .3);
  delete C.goals[a + '>' + b]; delete C.goals[b + '>' + a];
  note(`Peace between ${BLOC_NAME[a]} and ${BLOC_NAME[b]}.`, 'gold'); chron('peace', `Peace between ${BLOC_NAME[a]} and ${BLOC_NAME[b]}.`, null, a);
}

// ---------------------------------------------------------------- peace, item by item
// An item is { k, from, to, w?, cid?, x? }: what 'from' gives 'to'. Its price is in war score: a power gives as
// much as the war has cost it, and a little more if it is tired, likes you, or its ruler wants peace.
export const TRIBUTE = 120, TRIBUTE_WEEKS = 15;
const royalsHeld = (holder, of) => C.cmdrs.filter(c => c.state === 'captured' && c.captor === holder && c.owner === of && RU.isRoyal(c));
const officersHeld = (holder, of) => C.cmdrs.filter(c => c.state === 'captured' && c.captor === holder && c.owner === of && !RU.isRoyal(c));
export const ITEMS = {
  cede:      { name: it => `Cede ${nm(it.w)}`, price: it => 10 + worldValue(C.worlds[it.w], it.from), ok: it => C.worlds[it.w] && C.worlds[it.w].owner === it.from && it.w !== CAPITAL[it.from] },
  tribute:   { name: () => `Tribute: ${TRIBUTE} He-3 a week for ${TRIBUTE_WEEKS} weeks`, price: () => 15, ok: () => true },
  prisoners: { name: it => `Return every officer held (${officersHeld(it.from, it.to).length})`, price: it => 3 * officersHeld(it.from, it.to).length, ok: it => officersHeld(it.from, it.to).length > 0 },
  ruler:     { name: it => { const c = RU.cById(it.cid); return `Hand over ${c ? c.name : 'the prisoner'}`; }, price: () => 25, ok: it => { const c = RU.cById(it.cid); return !!(c && c.state === 'captured' && c.captor === it.from && c.owner === it.to); } },
  demil:     { name: it => `Demilitarize ${nm(it.w)}: its yards torn down`, price: it => 6 + 5 * (C.worlds[it.w].lv.yard || 0), ok: it => C.worlds[it.w] && C.worlds[it.w].owner === it.from && C.worlds[it.w].lv.yard > 0 },
  breakAlly: { name: it => `Break the alliance with ${BLOC_NAME[it.x]}`, price: () => 15, ok: it => relOf(it.from, it.x) === 'ally' },
};
export const itemName = it => ITEMS[it.k] ? ITEMS[it.k].name(it) : '?';
export const itemOK = it => !!(ITEMS[it.k] && ITEMS[it.k].ok(it));
export const priceOf = it => { if (!ITEMS[it.k]) return 0; const p = ITEMS[it.k].price(it); return Math.round(p * (RU.hasTrait(it.to, 'shrewd') ? .9 : 1)); };
// everything one power could give another
export function itemsFor(from, to) {
  const out = [];
  for (const w of Object.values(C.worlds)) if (w.owner === from && w.id !== CAPITAL[from]) out.push({ k: 'cede', from, to, w: w.id });
  out.push({ k: 'tribute', from, to });
  if (officersHeld(from, to).length) out.push({ k: 'prisoners', from, to });
  for (const c of royalsHeld(from, to)) out.push({ k: 'ruler', from, to, cid: c.id });
  for (const w of Object.values(C.worlds)) if (w.owner === from && w.lv.yard > 0) out.push({ k: 'demil', from, to, w: w.id });
  for (const x of POW) if (x !== from && x !== to && relOf(from, x) === 'ally') out.push({ k: 'breakAlly', from, to, x });
  return out;
}
// what a deal costs power o, in war score: what it gives, less what it gets
export const dealCost = (o, items) => items.reduce((a, it) => a + (it.from === o ? priceOf(it) : -priceOf(it)), 0);
const termsToItems = (me, o, terms) => Array.isArray(terms) ? terms : terms === 'theyPay' ? [{ k: 'tribute', from: o, to: me }] : terms === 'wePay' ? [{ k: 'tribute', from: me, to: o }] : [];
// the AI's view of a deal, part by part: positive is willing
export function acceptParts(me, o, terms) {
  const items = termsToItems(me, o, terms), s = warScore(o, me), wo = C.weary[o] || 0, D = RU.docOf(o), op = opinionOf(o, me), P0 = [];
  P0.push(['The war, as they see it', -s]);
  if (Math.abs(wo - 40) >= 1) P0.push(['Their war weariness', (wo - 40) / 2]);
  if (op) P0.push(['Their opinion of us', op / 5]);
  if (D.peace) P0.push([`${RU.actingOf(o) ? RU.actingOf(o).name.split(',')[0] : 'Their ruler'} is ${D.name.toLowerCase()}`, D.peace / 2]);
  if (RU.hasTrait(o, 'hawk')) P0.push(['A hawk on their throne', -8]);
  if (o === 'soc' && C.fac.soc.alive && (groupsOf('soc').find(g => g.id === 'grimmus') || {}).sat > 75 && dealCost(o, items) >= 0) P0.push(['House Grimmus will not hear of it', -60]);
  P0.push(['Peace itself', 6]);
  const cost = dealCost(o, items); if (cost) P0.push([cost > 0 ? 'What we ask of them' : 'What we give them', -cost]);
  return rounded(P0);
}
export const acceptChance = (me, o, terms) => clamp(.5 + sum(acceptParts(me, o, terms)) / 50, .02, .95);
export function applyItem(it) {
  const { from, to } = it;
  if (it.k === 'cede') { const w = C.worlds[it.w]; w.owner = to; w.siege = null; w.bq = []; w.sq = []; seatLost(from, w.id); EC.onCapture(w, to, 35); for (const fl of fleetsAt(w.id, from)) fl.at = CAPITAL[from]; }
  if (it.k === 'tribute') C.tribute.push({ from, to, he: TRIBUTE, left: TRIBUTE_WEEKS });
  if (it.k === 'prisoners') { for (const c of officersHeld(from, to)) { c.state = 'pool'; c.captor = null; } addOpinion(to, from, 'prisoners', 'Returned our prisoners', 15, .3); }
  if (it.k === 'ruler') { const c = RU.cById(it.cid); if (c) RU.freed(c); addOpinion(to, from, 'prisoners', 'Returned our prisoners', 15, .3); }
  if (it.k === 'demil') { const w = C.worlds[it.w]; w.lv.yard = 0; w.sq = []; w.bq = w.bq.filter(q => q.k !== 'yard'); w.demil = C.turn + 40; }
  if (it.k === 'breakAlly') setRel(from, it.x, 'peace');
}
export function applyDeal(a, b, items, weeks = 20) {
  makePeace(a, b, weeks); for (const it of items) if (itemOK(it)) applyItem(it);
  if (items.length) chron('treaty', `The treaty between ${BLOC_NAME[a]} and ${BLOC_NAME[b]}: ${items.map(itemName).join('; ')}.`, null, a);
}
export function proposePeace(me, o, terms) {
  if (!hostile(me, o)) return 'not at war';
  const items = termsToItems(me, o, terms).filter(itemOK), p = acceptChance(me, o, items), ok = rnd() < p;
  C.lastAsk = C.lastAsk || {}; C.lastAsk[o] = C.turn;
  if (!ok) { note(`${BLOC_NAME[o]} rejects our terms.`, 'bad'); return 'rejected'; }
  applyDeal(me, o, items); return null;
}
// what a power will give for peace, up to a price: what it took from the other first, then tribute, then the
// worlds nearest the other's fleets; never its capital
export function aiOfferItems(from, to, budget) {
  const out = []; let left = budget;
  const all = itemsFor(from, to).filter(itemOK), cede = all.filter(i => i.k === 'cede').sort((a, b) => ((C.worlds[a.w].home === to ? -8 : 0) + nearOf(to, a.w) + priceOf(a) / 10) - ((C.worlds[b.w].home === to ? -8 : 0) + nearOf(to, b.w) + priceOf(b) / 10));
  for (const k of ['prisoners', 'tribute']) { const it = all.find(i => i.k === k); if (it && priceOf(it) <= left) { out.push(it); left -= priceOf(it); } }
  for (const it of cede) { if (out.filter(i => i.k === 'cede').length >= 3) break; if (priceOf(it) <= left) { out.push(it); left -= priceOf(it); } }
  return out;
}
export function proposeAlliance(me, o) {
  if (relOf(me, o) !== 'peace') return 'only from peace';
  C.lastAsk = C.lastAsk || {}; if (C.lastAsk[o] === C.turn) return 'rejected'; C.lastAsk[o] = C.turn;
  const common = atWarWith(me).filter(x => hostile(o, x));
  if (!common.length) { note(`${BLOC_NAME[o]} sees no common enemy to ally against.`, 'bad'); return 'rejected'; }
  if (rnd() > allianceChance(me, o)) { note(`${BLOC_NAME[o]} declines an alliance, for now.`, 'bad'); return 'rejected'; }
  setRel(me, o, 'ally'); addOpinion(o, me, 'ally', 'Allies in war', 10, .1);
  for (const x of common) addOpinion(x, o, 'ally', `Allied with ${BLOC_NAME[me]} against us`, -10, .2);
  note(`${BLOC_NAME[me]} and ${BLOC_NAME[o]} are allies against ${common.map(x => BLOC_NAME[x]).join(' and ')}.`, 'gold'); chron('alliance', `${BLOC_NAME[me]} and ${BLOC_NAME[o]} ally against ${common.map(x => BLOC_NAME[x]).join(' and ')}.`, null, me); return null;
}
export const allianceParts = (me, o) => rounded([['Base', 45], ['Their opinion of us', opinionOf(o, me) / 2], ...(atWarWith(me).some(x => hostile(o, x)) ? [] : [['No common enemy', -100]])]);
export const allianceChance = (me, o) => clamp(sum(allianceParts(me, o)) / 100, 0, .95);
function tributeTick() {
  for (const t of C.tribute) { const a = C.fac[t.from].res; const amt = Math.min(t.he, Math.max(0, a.he)); a.he -= amt; C.fac[t.to].res.he += amt; t.left--; }
  C.tribute = C.tribute.filter(t => t.left > 0 && C.fac[t.from].alive && C.fac[t.to].alive);
}
// ---------------------------------------------------------------- prisoners and ransom
export const ransomOf = c => RU.isRoyal(c) ? { he: 2500 + 500 * c.rank, inf: 60 } : ({ he: 300 + 350 * c.rank, inf: 10 + 15 * c.rank });
export const prisoners = (holder) => C.cmdrs.filter(c => c.state === 'captured' && c.captor === holder);
export const ransomParts = (me, c) => rounded([['Base', hostile(me, c.captor) ? 75 : 95], ['Their opinion of us', opinionOf(c.captor, me) / 2], ...(RU.isRoyal(c) ? [['A ruler is worth more in chains', -35]] : [])]);
export function ransomBack(me, cid) { // pay to get our commander back
  const c = C.cmdrs.find(x => x.id === cid); if (!c || c.owner !== me || c.state !== 'captured') return 'cannot';
  const R = ransomOf(c), r = C.fac[me].res; if (r.he < R.he || r.inf < R.inf) return `ransom: ${R.he} He-3 and ${R.inf} influence`;
  if (rnd() * 100 > sum(ransomParts(me, c))) { r.inf -= 5; note(`${BLOC_NAME[c.captor]} refuses to ransom ${c.name}.`, 'bad'); return 'refused'; }
  r.he -= R.he; r.inf -= R.inf; C.fac[c.captor].res.he += R.he; const by = c.captor; c.state = 'pool'; c.captor = null; if (RU.isRoyal(c)) { c.state = 'captured'; RU.freed(c); } addOpinion(me, by, 'ransom', 'Took our ransom honestly', 5, .2); note(`${c.name} is ransomed home.`, 'good'); return null;
}
export function releaseFor(me, cid) { // free a prisoner of ours for their ransom
  const c = C.cmdrs.find(x => x.id === cid); if (!c || c.captor !== me) return 'cannot';
  const R = ransomOf(c), o = C.fac[c.owner].res; const amt = Math.min(R.he, Math.max(0, o.he)); o.he -= amt; C.fac[me].res.he += amt;
  if (RU.isRoyal(c)) RU.freed(c); else { c.state = 'pool'; c.captor = null; } addOpinion(c.owner, me, 'prisoners', 'Returned our prisoners', 8, .3); note(`${c.name} is released to ${BLOC_NAME[c.owner]} for ${amt} He-3.`, 'gold'); return null;
}
export function execute(me, cid) {
  const c = C.cmdrs.find(x => x.id === cid); if (!c || c.captor !== me) return 'cannot';
  const royal = RU.isRoyal(c), victim = c.owner;
  CM.kill(c, null, `${c.name}, prisoner of ${BLOC_NAME[me]}, is executed.`); CM.weary(victim, royal ? 8 : 3);
  addOpinion(victim, me, 'exec', royal ? `Executed ${c.name}` : 'Executed our officers', royal ? -50 : -30, .5);
  for (const o of POW) if (o !== me && o !== victim) addOpinion(o, me, 'execO', 'Executes prisoners', -5, .3);
  if (!RU.hasTrait(me, 'ruthless')) { react(me, 'bombard', .5); for (const w of Object.values(C.worlds)) if (w.owner === me && w.cl) w.cl.gold = clamp(w.cl.gold - 3, 0, 100); }
  chron('death', `${c.name} is executed by ${BLOC_NAME[me]}.`, null, victim); return null;
}

// ---------------------------------------------------------------- the weekly tick
export function tick() {
  if (!C.pol) return;
  C.polFx = {}; C.opinion = C.opinion || {}; C.goals = C.goals || {}; C.laws = C.laws || { rep: [], soc: [], rim: [] }; C.lawT = C.lawT || {};
  for (const c of C.cmdrs) if (c.state === 'recalled' && --c.recall <= 0) { c.state = 'pool'; if (c.owner === C.player) note(`${c.name} returns from Luna, free to command again.`, 'good'); }
  for (const f of POW) {
    if (!C.fac[f].alive) continue;
    for (const g of C.pol[f].groups) g.sat = clamp(g.sat + (targetOf(f, g) - g.sat) * .08, 0, 100);
    if (C.tax && C.tax[f] >= 2) react(f, 'bombard', .1 * (C.tax[f] - 1));
    const k = kindOf(f);
    if (k === 'senate') senateTick(f); else courtTick(f);
    aiLaws(f);
    C.polFx[f] = effects(f);
    if (C.pol[f].budgetCut > C.turn) C.polFx[f].naval = (C.polFx[f].naval || 1) * .8;
  }
  tributeTick(); opinionTick(); goalTick();
  // the history of Iron Gold: the Ash Lord's emissaries offer an armistice; the Senate moves to recall Darrow
  if (!C.events.armistice && C.turn === 2 && C.fac.soc.alive && hostile('rep', 'soc')) { C.events.armistice = true; if (C.player === 'rep') C.pendingOffer = { from: 'soc', kind: 'armistice' }; }
  if (!C.events.recallVote && C.events.rainDefied != null && C.turn >= C.events.rainDefied + 1 && C.fac.rep.alive) { C.events.recallVote = true; callVote('rep', 'recall', 1); }
  // ransom offers from the AI for its captured commanders, now and then
  if (C.turn % 5 === 0) for (const c of prisoners(C.player)) if (c.owner !== 'neu' && C.fac[c.owner].alive && C.fac[c.owner].res.he > ransomOf(c).he && rnd() < .35 && !C.pendingOffer) { C.pendingOffer = { from: c.owner, kind: 'ransom', cid: c.id }; break; }
  aiDiplo();
}
// capitulation: the beaten power gives what the war score buys (never its seat of government), pays a half-year's
// tribute and signs a long peace. Every capitulation counts toward the conqueror's victory.
export function capitulate(f, o, s) {
  const items = aiOfferItems(f, o, clamp(-s, 40, 100) * .8).filter(i => i.k !== 'tribute');
  if (!items.some(i => i.k === 'cede')) { const w = Object.values(C.worlds).filter(x => x.owner === f && x.id !== CAPITAL[f]).sort((a, b) => nearOf(o, a.id) - nearOf(o, b.id))[0]; if (w) items.push({ k: 'cede', from: f, to: o, w: w.id }); }
  const give = items.filter(i => i.k === 'cede').map(i => i.w);
  makePeace(f, o, 40); for (const it of items) if (itemOK(it)) applyItem(it); C.tribute.push({ from: f, to: o, he: TRIBUTE * 1.5, left: 26 });
  C.capit = C.capit || {}; C.capit[f] = { to: o, turn: C.turn };
  const names = give.map(id => bodyOf(id).name).join(', ') || 'nothing (it has no world to spare but its capital)', rest = items.filter(i => i.k !== 'cede').map(itemName);
  note(o === C.player ? `${BLOC_NAME[f]} capitulates! It cedes ${names}${rest.length ? ', and agrees: ' + rest.join('; ') : ''}, pays tribute for half a year and signs a forty-week peace.` : f === C.player ? `We have capitulated to ${BLOC_NAME[o]}: ${names} ceded.` : `${BLOC_NAME[f]} capitulates to ${BLOC_NAME[o]}, ceding ${names}.`,
    o === C.player ? 'good' : f === C.player ? 'bad' : 'gold', give[0] || null, o === C.player || f === C.player ? { title: `${BLOC_NAME[f]} capitulates`, kind: 'rain' } : null);
  chron('capit', `${BLOC_NAME[f]} capitulates to ${BLOC_NAME[o]}, ceding ${names}.`, give[0] || null, f);
}
// the AI at war: it sues when the war has gone against it (sooner under a patient ruler, never under a reckless one),
// offers the player what the war score buys, makes demands when it is winning, and keeps or breaks its truces as
// its ruler would
// a power capitulates only when its realm is broken, not just its fleet: its capital lost, or half its worlds
const broken = f => capLostOf(f) > 0 || Object.values(C.worlds).filter(w => w.owner === f).length <= Math.max(1, Math.floor(((C.startN || {})[f] || 3) * .5));
function aiDiplo() {
  for (const f of POW) {
    if (!C.fac[f].alive || human(f)) continue;
    const D = RU.docOf(f);
    for (const o of atWarWith(f)) {
      const s = warScore(f, o), wf = C.weary[f] || 0, ck = f + '>' + o, op = opinionOf(f, o);
      // a power whose realm is broken, losing badly for six weeks running, capitulates: it cedes worlds, pays tribute and makes peace
      C.capStreak = C.capStreak || {}; C.capStreak[ck] = s <= -60 && C.turn >= 20 && broken(f) ? (C.capStreak[ck] || 0) + 1 : 0;
      if (C.capStreak[ck] >= 6) { capitulate(f, o, s); C.capStreak[ck] = 0; continue; }
      const sue = s < -35 + D.peace * .6 || wf > 75 - D.peace * .3;
      if (human(o)) {
        const cool = !C.pendingOffer && !(C.lastOffer && C.turn - C.lastOffer < 10);
        if (sue && rnd() < .15 && cool) { const items = aiOfferItems(f, o, Math.max(0, -s - 8 + (wf - 40) / 3)); C.pendingOffer = { from: f, kind: 'deal', items }; C.lastOffer = C.turn; }
        else if (s > 45 - D.peace * .3 && rnd() < .06 && cool) { const items = aiOfferItems(o, f, s * .6); if (items.length) { C.pendingOffer = { from: f, kind: 'demand', items }; C.lastOffer = C.turn; } }
      }
      else if ((s < -40 + D.peace * .6 + op / 10 || wf > 80) && rnd() < .08 && !(f === 'soc' && o === 'rep' && supportOf('soc') > 60)) { const items = aiOfferItems(f, o, Math.max(0, -s * .6)); applyDeal(f, o, items); }
    }
    // the Republic and the Remnant are enemies to the death: a truce between them holds only as long as it must
    for (const o of ['rep', 'soc']) if (o !== f && (f === 'rep' || f === 'soc') && C.fac[o].alive && relOf(f, o) === 'peace' && truceLeft(f, o) === 0 && rnd() < .15 * (D.truce > 0 ? 1 : .4)) declareWar(f, o);
    // a ruler who holds nothing sacred may break a truce with a power it hates
    for (const o of POW) if (o !== f && C.fac[o].alive && relOf(f, o) === 'peace' && truceLeft(f, o) > 0 && D.truce > 0 && opinionOf(f, o) < -50 && !(o === 'rim' || f === 'rim') && rnd() < .02 * D.truce) declareWar(f, o, true);
    // the AI captors free each other's officers now and then, as their opinion allows; rulers stay in chains
    for (const c of prisoners(f)) if (c.owner !== C.player && c.owner !== 'neu' && C.fac[c.owner].alive && !RU.isRoyal(c) && rnd() < .05 * (1 + opinionOf(f, c.owner) / 100)) { c.state = 'pool'; c.captor = null; addOpinion(c.owner, f, 'prisoners', 'Returned our prisoners', 6, .3); }
  }
}
// the player answers an offer from an AI power
export function answerOffer(o, yes) {
  if (!o) return; const me = C.player;
  if (o.kind === 'armistice') { if (yes) { makePeace(me, o.from, 12); react(me, 'peace', 1.5); } else { react(me, 'defy', .5); note('The Ash Lord’s emissaries are sent away. The war goes on.', 'bad'); } }
  else if (o.kind === 'peace') { if (yes) makePeace(me, o.from); }
  else if (o.kind === 'tribute') { if (yes) { makePeace(me, o.from); C.tribute.push({ from: o.from, to: me, he: TRIBUTE, left: TRIBUTE_WEEKS }); } }
  else if (o.kind === 'deal' || o.kind === 'demand') { if (yes && hostile(me, o.from)) applyDeal(o.from, me, o.items || []); else if (!yes && o.kind === 'demand') addOpinion(o.from, me, 'defied', 'Refused our terms', -5, .3); }
  else if (o.kind === 'ransom') { if (yes) releaseFor(me, o.cid); }
}
