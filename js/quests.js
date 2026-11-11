// Quest battles: one for each great hero, offered as a mission and fought on the tactical map with an objective
// of its own (ops.js). Darrow's raid on the Ash Lord's citadel by the Minotaur's way in; Sevro's Howlers on an enemy
// yard; Atalantia's spear at the Republic's flagship; Kalindora's last watch over Heliopolis; the Storm Knight's
// challenge to a Republic Imperator. Pure rules, no DOM: the strategic view asks and fights them.
import { C, note, chron, BLOC_NAME, CAPITAL, fleet, fleetsAt, hostile, travel, fleetStr, shipVal, newShip, human } from './camp.js';
import { bodyOf } from './solar.js';
import * as CM from './command.js';
import * as P from './politics.js';
import * as ST from './story.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const nm = id => bodyOf(id).name;
const hero = n => C.cmdrs.find(c => c.lore && (c.name || '').startsWith(n));
const heroFleet = n => { const c = hero(n); return c && c.state === 'fleet' ? C.fleets.find(f => f.id === c.fleet) : null; };
const enemyYard = f => Object.values(C.worlds).filter(w => hostile(f, w.owner) && w.owner !== 'neu' && w.lv.yard >= 2).sort((a, b) => b.lv.yard - a.lv.yard)[0];
const enemyFront = f => { const fl = heroFleet({ rep: 'Darrow', soc: 'Atalantia', rim: 'Diomedes' }[f]); const L = Object.values(C.worlds).filter(w => hostile(f, w.owner) && w.owner !== 'neu'); if (!L.length) return null; const at = fl && (fl.at || (fl.transit && fl.transit.to)) || CAPITAL[f]; return L.sort((a, b) => travel(at, a.id) - travel(at, b.id))[0]; };

export const QUESTS = {
  minotaur: { hero: 'Darrow', f: 'rep', title: 'The Minotaur’s way in', where: () => 'venus', foe: () => 'soc', when: 0,
    text: 'The Minotaur knows a way into the Ash Lord’s citadel from orbit. The Citadel Guard holds the sky over Venus; Darrow must bring his flagship over the citadel and hold there while the Minotaur leads the raid in.',
    guard: { dread: 1, destroyer: 2, frigate: 3, corvette: 2 }, guardName: 'The Citadel Guard', withWorld: true,
    obj: { kind: 'reach', R: 3200, T: 45, text: 'Bring Darrow’s flagship within 3,200 km of the Ash Lord’s citadel and hold there for 45 seconds: the Minotaur leads the raid in' },
    win: () => ST.ashLordFalls('raid'), lose: () => { const d = hero('Darrow'); if (d && d.state === 'fleet' && rnd() < .3) CM.capture(d, heroFleet('Darrow'), 'soc', 'Venus'); }, reward: { inf: 40 } },
  howlers: { hero: 'Sevro', f: 'rep', title: 'The Howlers strike the yards', where: () => { const w = enemyYard('rep'); return w ? w.id : null; }, foe: id => C.worlds[id].owner, when: 6,
    text: 'The Howlers mean to burn an enemy shipyard where it lies: three slipways in high orbit, a garrison squadron, and the world’s guns.',
    guard: { destroyer: 1, frigate: 2, corvette: 2 }, guardName: 'Yard Guard', withWorld: true,
    obj: { kind: 'kill', n: 3, text: 'Destroy the three slipways in orbit of the yard' },
    win: id => { const w = C.worlds[id]; if (w) { w.lv.yard = Math.max(0, w.lv.yard - 1); w.sq = []; } }, reward: { he: 800, inf: 25 } },
  spear: { hero: 'Atalantia', f: 'soc', title: 'Atalantia’s spear', where: () => { const w = enemyFront('soc'); return w ? w.id : null; }, foe: id => C.worlds[id].owner, when: 8,
    text: 'Atalantia means to put her spear through the heart of the enemy line: their flagship, an Imperator of the Republic aboard, waiting over its world.',
    guard: { torch: 1, destroyer: 2, frigate: 3, corsair: 2 }, guardName: 'The Imperator’s Squadron', guardCmdr: 2, withWorld: false,
    obj: { kind: 'flag', text: 'Destroy or take the enemy flagship' },
    win: (id, foe) => { CM.weary(foe, 8); P.react('soc', 'victory', 1.5); }, reward: { he: 1200, inf: 20 } },
  lastwatch: { hero: 'Kalindora', f: 'soc', title: 'The last watch of Heliopolis', where: () => C.worlds.mercury.owner === 'soc' ? 'mercury' : null, foe: () => 'rep', when: 4, defend: true,
    text: 'A Republic assault column is coming for Heliopolis. Kalindora must hold Mercury’s orbit for six minutes, under the old walls’ guns, until the column breaks off.',
    guard: { torch: 1, destroyer: 3, frigate: 4, boarder: 2 }, guardName: 'Republic Assault Column', withWorld: true,
    obj: { kind: 'hold', T: 360, R: 9000, text: 'Hold Mercury’s orbit for 6 minutes: keep a warship within 9,000 km of the world' },
    win: () => { const w = C.worlds.mercury; w.garrison += 3000; if (w.siege) w.siege.hold = (w.siege.hold || 0) + 2; P.nudge('soc', 'votum', 10); }, reward: { man: 6000, he: 600 } },
  storm: { hero: 'Diomedes', f: 'rim', title: 'The Storm Knight’s challenge', where: () => { const w = enemyFront('rim'); return w ? w.id : null; }, foe: id => C.worlds[id].owner, when: 6,
    text: 'Diomedes has challenged a Republic Imperator to meet him over a world of the Republic, fleet against fleet. The honour of House Raa rides on it.',
    guard: { dread: 1, destroyer: 2, frigate: 3 }, guardName: 'The Imperator’s Squadron', guardCmdr: 2, withWorld: false,
    obj: { kind: 'flag', text: 'Destroy or take the Imperator’s flagship' },
    win: () => { P.nudge('rim', 'lux', 8); P.nudge('rim', 'raa', 6); }, reward: { he: 1000, inf: 30 } },
};
const QOF = { Darrow: 'minotaur', Sevro: 'howlers', Atalantia: 'spear', Kalindora: 'lastwatch', Diomedes: 'storm' };

// the missions: each hero's quest is offered once, when the hero has a fleet and a target exists
export function tick() {
  const f = C.player; C.quests = C.quests || {}; if (!human(f) || !C.fac[f].alive || C.turn < 3) return;
  for (const k in QUESTS) {
    const Q = QUESTS[k]; if (Q.f !== f || C.quests[k] || k === 'minotaur' || C.turn < Q.when) continue;
    const fl = heroFleet(Q.hero), id = fl && Q.where(); if (!fl || !id || !C.worlds[id]) continue;
    if (!Q.defend && !hostile(f, C.worlds[id].owner)) continue;
    C.quests[k] = 'offered';
    ST.addMission(f, { k: 'quest', text: `${Q.title}: ${Q.hero}’s fleet in orbit of ${nm(id)} within 12 weeks`, left: 12, quest: k, qw: id, reward: Q.reward });
  }
}
// a quest mission is done when the hero's fleet is in orbit of the place, and the place is still worth the fight
ST.regMission('quest', { done: (m, f) => { const Q = QUESTS[m.quest], id = m.qw, h = Q && heroFleet(Q.hero); return !!(h && h.at === id && !h.transit && (Q.defend ? C.worlds[id].owner === f : hostile(f, C.worlds[id].owner))); } });
// the minotaur mission (story.js) is a quest battle too
export const isQuest = k => !!QUESTS[k];
// the conflict a quest battle is fought as: the hero's fleet against a force raised for it
export function conflictOf(qp) {
  const Q = QUESTS[qp.k], me = C.player, fl = heroFleet(Q.hero), id = qp.w || (fl && fl.at); if (!Q || !fl || !id || fl.at !== id) return null;
  const foe = Q.foe(id) || 'neu', g = fleet(foe, id, Q.guard, Q.guardName); g.questTemp = true;
  if (Q.guardCmdr != null) { const c = CM.makeCmdr(foe, { rank: Q.guardCmdr }); c.title = 'Imperator of ' + (BLOC_NAME[foe] || 'the enemy'); CM.assign(c, g); }
  const w = C.worlds[id], ww = Q.withWorld && (Q.defend ? w.owner === me : w.owner === foe);
  return Q.defend ? { world: id, att: foe, def: me, atts: [foe], defs: [me], withWorld: ww, fleets: [fl.id, g.id], quest: qp.k }
    : { world: id, att: me, def: foe, atts: [me], defs: [foe], withWorld: ww, fleets: [fl.id, g.id], quest: qp.k };
}
export const objOf = k => QUESTS[k] ? { ...QUESTS[k].obj, hero: QUESTS[k].hero } : null;
// whatever happened, the force raised for the quest goes: its survivors back to wherever they came from
export function cleanup() { for (const f of C.fleets) if (f.questTemp) { CM.relieve(f, true); f.ships = []; } C.fleets = C.fleets.filter(f => f.ships.length); CM.tidy(); }
export function outcome(qp, won) {
  const Q = QUESTS[qp.k], f = C.player, r = C.fac[f].res, id = qp.w; cleanup();
  C.quests[qp.k] = won ? 'won' : 'lost';
  if (won) { for (const k in Q.reward) r[k] = (r[k] || 0) + Q.reward[k]; Q.win(id, Q.foe && id ? Q.foe(id) : null); CM.gainXp(hero(Q.hero), 60);
    note(`${Q.title}: done. ${Object.entries(Q.reward).map(([k, v]) => '+' + v.toLocaleString() + ' ' + k).join(' · ')}.`, 'good', id, { title: Q.title, kind: 'war' }); chron('battle', `${Q.title}: ${Q.hero} succeeds.`, id, f); }
  else { if (Q.lose) Q.lose(id); if (qp.m && qp.m.giver) P.nudge(f, qp.m.giver, -6); note(`${Q.title}: it fails.`, 'bad', id); chron('battle', `${Q.title}: ${Q.hero} fails.`, id, f); }
}
// the dice instead of the battle: the hero's fleet against what was raised to stop it
export function autoQuest(qp) {
  const Q = QUESTS[qp.k], fl = heroFleet(Q.hero); if (!fl) return outcome(qp, false);
  const g = fleet(Q.foe(qp.w) || 'neu', qp.w, Q.guard, Q.guardName); g.questTemp = true; const a = fleetStr(fl) * CM.arMul(fl), b = fleetStr(g) * (Q.defend ? .8 : 1.15);
  const p = clamp(.5 + (a - b) / (a + b) * 1.2, .08, .92), won = rnd() < p;
  for (const s of fl.ships) { s.hp = clamp(s.hp - rnd() * (won ? .18 : .4), .05, 1); s.ammo = clamp(s.ammo - .25, 0, 1); }
  outcome(qp, won); return { won, p };
}
export const chanceOf = qp => { const Q = QUESTS[qp.k], fl = heroFleet(Q.hero); if (!fl) return 0; let b = 0; const foe = Q.foe(qp.w) || 'neu'; for (const t in Q.guard) b += Q.guard[t] * shipVal(foe, newShip(t)); const a = fleetStr(fl) * CM.arMul(fl); return clamp(.5 + (a - b * (Q.defend ? .8 : 1.15)) / (a + b) * 1.2, .08, .92); };
export const heroFleetOf = k => QUESTS[k] ? heroFleet(QUESTS[k].hero) : null;
export const questFor = name => QOF[Object.keys(QOF).find(n => (name || '').startsWith(n))] || null;
