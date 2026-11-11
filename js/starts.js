// Legendary starts: for each power, two or three ways into the war of 753 PCE, each led by a commander from the
// books, with its own fleets and positions, objectives, briefing and one rule of its own. And the ahistorical
// option, where the war need not follow Iron Gold: the Ash Lord dies when he dies, Romulus may live, Lysander
// chooses his own side, and one House starts the war already bitter.
import { C, fleet, newShip, setRel, note, chron, BLOC_NAME, fleetsAt, fleetStr } from './camp.js';
import * as CM from './command.js';
import * as P from './politics.js';
import * as RU from './rulers.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const cm = n => C.cmdrs.find(c => (c.name || '').startsWith(n));
const fl = (o, n) => C.fleets.find(f => f.owner === o && f.name === n);
const add = (f, comp) => { for (const t in comp) for (let k = 0; k < comp[t]; k++) f.ships.push(newShip(t)); };
const owns = (f, id) => C.worlds[id] && C.worlds[id].owner === f;

export const STARTS = {
  rep: [
    { id: 'virginia', name: 'The Sovereign', cmdr: 'Virginia au Augustus', where: 'Luna', blurb: 'Rule the Republic from Luna while the Reaper fights for Mercury against the Senate’s vote.',
      rule: { key: 'coalition', name: 'The Mustang’s coalition', desc: 'The Sovereign’s coalition starts content (+10), and laws cost a quarter less influence to bring before the Senate.' },
      setup() { P.nudge('rep', 'sov', 10); } },
    { id: 'darrow', name: 'The Reaper', cmdr: 'Darrow au Andromedus', where: 'Mercury', open: 'Week 1, 753 PCE. The Reaper holds Mercury’s orbit with the White Fleet against the Senate’s vote; on Luna the Senate prepares to recall him. On Venus the Ash Lord lies ailing. The Rim watches from Io.', blurb: 'Command the White Fleet at Mercury, outlawed in all but name by a Senate that wants you home.',
      rule: { key: 'outlaw', name: 'Outlaw of the Senate', desc: 'The White Fleet is Darrow’s, half again as strong, and his Iron Rains land 20% more troops. But the Senate starts against you: the Moderates and the Vox Populi are bitter, and the recall vote comes in the third week.', fx: { rain: 1.2 } },
      brief: { who: 'Darrow au Andromedus, the Reaper, ArchImperator of the Republic', text: 'You took the White Fleet to Mercury against the Senate’s vote. The Free Legions fight for Heliopolis; Kalindora au San holds it for the Remnant. On Luna the Senate means to recall you, and the Ash Armada waits at Venus.',
        steps: ['Break the Heliopolis Garrison, hold the siege until its defences break, then drop the Iron Rain on Mercury.', 'Take Mercury before the twentieth week: a victory the Senate cannot vote down.', 'When the recall vote comes (week 3), defy it or go home: the White Fleet will follow you either way.'] },
      objectives: [{ id: 's_merc', text: 'Take Mercury before week 20, before the Senate breaks you', avail: () => C.turn <= 20, done: () => owns('rep', 'mercury'), reward: { he: 1200, inf: 60 } }, { id: 's_venus', text: 'Carry the war to Venus: take it', done: () => owns('rep', 'venus'), reward: { he: 2000, ore: 1000 } }],
      setup() { add(fl('rep', 'White Fleet'), { destroyer: 2, torch: 1, frigate: 2, boarder: 2 }); for (const g of P.groupsOf('rep')) { if (g.id === 'mod') g.sat = 26; if (g.id === 'vox') g.sat = 18; if (g.id === 'sov') g.sat = Math.max(40, g.sat - 6); } const h = fl('rep', 'Home Fleet'); if (h) h.ships = h.ships.slice(0, Math.max(3, h.ships.length - 2)); } },
    { id: 'sevro', name: 'The Howlers', cmdr: 'Sevro au Barca', where: 'Phobos', open: 'Week 1, 753 PCE. The Howlers sit at Phobos, and the Sons of Ares wait for word on every enemy world. The White Fleet besieges Mercury; the Ash Armada waits at Venus; the Rim keeps its peace.', blurb: 'Lead the Howlers out of Phobos: raids, risings and knives in the dark, answering to no Senate.',
      rule: { key: 'free', name: 'Free of the Senate', desc: 'Sevro answers to no one. The Senate’s motions cannot touch your fleets (no recall, no cap on the navy, no armistice); Sons of Ares risings cost half; and every Republic fleet can raid like the Rim.' },
      brief: { who: 'Sevro au Barca, the Goblin, Imperator of the Howlers', text: 'The war is a grind and the Senate argues. You do not. The Howlers sit at Phobos with fast ships and hangars full of leechCraft, and the Sons of Ares have cells on every enemy world.',
        steps: ['Raid the Remnant’s worlds for He-3 and ore: hit, strip, run.', 'Call the Sons of Ares to rise as your fleets arrive: a rising cuts a garrison by half.', 'Keep a fleet at Luna anyway: the Ash Armada will come for the capital.'] },
      objectives: [{ id: 's_rise', text: 'Raise the Sons of Ares on three enemy worlds', done: () => ((C.stats || {}).risings || 0) >= 3, reward: { inf: 80, man: 4000 } }, { id: 's_raid', text: 'Strip three enemy worlds by raids', done: () => ((C.stats || {}).raids || 0) >= 3, reward: { he: 900, ore: 700 } }],
      setup() { const h = fleet('rep', 'phobos', { corsair: 3, frigate: 2, boarder: 3, torch: 1, scout: 1 }, 'The Howlers'); const s = cm('Sevro'); if (s) CM.assign(s, h); const hf = fl('rep', 'Home Fleet'); if (hf && !hf.cmdr) CM.assign(CM.makeCmdr('rep', { rank: 1 }), hf); } },
  ],
  soc: [
    { id: 'atalantia', name: 'The Dictator’s Daughter', cmdr: 'Atalantia au Grimmus', where: 'Venus', blurb: 'Rule the Remnant in your dying father’s name, with the Ash Armada at Venus.',
      rule: { key: 'daughter', name: 'Daughter of the Ash Lord', desc: 'House Grimmus starts the happier (+10), and the Remnant’s fleets fight 5% harder in every battle the dice decide.', fx: { ar: 1.05 } },
      setup() { P.nudge('soc', 'grimmus', 10); } },
    { id: 'kalindora', name: 'The Love Knight', cmdr: 'Kalindora au San', where: 'Mercury', open: 'Week 1, 753 PCE. Heliopolis holds. Kalindora au San and the Scorpion Legions stand on Mercury against the Reaper and the Morning Star; the Ash Lord lies ailing on Venus.', blurb: 'Hold Heliopolis against the Reaper, with the garrison fleet and the Scorpion Legions of House Votum.',
      rule: { key: 'heliopolis', name: 'Hold Heliopolis', desc: 'Mercury’s garrison is doubled and its holdout two weeks longer while Kalindora holds it; every week it stands, House Votum is the happier. If Mercury falls, the Houses blame the throne.' },
      brief: { who: 'Kalindora au San, the Love Knight of the Society', text: 'The Reaper has come to Mercury with the Morning Star. You hold Heliopolis with a garrison fleet, the Scorpion Legions of House Votum, and the old walls. Venus is a week away; the Ash Armada may or may not come.',
        steps: ['Hold Mercury: every week Heliopolis stands, the Republic bleeds and House Votum takes heart.', 'Ask House Votum or House Carthii for a levy (fleet panel): the Houses fight for their own.', 'If the White Fleet breaks, strike at Luna while Darrow is far away.'] },
      objectives: [{ id: 's_helio', text: 'Hold Mercury until week 30', avail: () => C.turn <= 30, done: () => C.turn >= 30 && owns('soc', 'mercury'), reward: { he: 1500, man: 6000 } }, { id: 's_break', text: 'Drive the White Fleet from Mercury’s orbit', done: () => !fleetsAt('mercury', 'rep').length, reward: { he: 500, ore: 500 } }],
      setup() { const g = fl('soc', 'Heliopolis Garrison'); if (g) { add(g, { destroyer: 1, frigate: 2, corvette: 2 }); g.garrison = false; } const k = cm('Kalindora'); if (k && g) CM.assign(k, g); const w = C.worlds.mercury; w.garrison *= 2; w.gun += 1; if (w.siege) { w.siege.hold += 2; w.siege.hold0 = (w.siege.hold0 || 0) + 2; } P.nudge('soc', 'votum', 8); } },
  ],
  rim: [
    { id: 'romulus', name: 'The Sovereign of Io', cmdr: 'Romulus au Raa', where: 'Io', blurb: 'Keep the peace of Ilium, arm the Dominion, and choose your war when the Core has bled itself.',
      rule: { key: 'ilium', name: 'The peace of Ilium', desc: 'Trade +15%, and the Moon Lords’ alarm at the Republic rises a third slower: you choose when the Rim goes to war.', fx: { trade: 1.15 } },
      objectives: [{ id: 's_peace', text: 'Keep the peace to week 40 with 10,000 fleet strength', avail: () => C.turn <= 40, done: () => C.turn >= 40 && C.rel['rep|rim'] !== 'war' && C.fleets.filter(f => f.owner === 'rim').reduce((a, f) => a + fleetStr(f), 0) >= 10000, reward: { he: 1500, inf: 50 } }],
      setup() { } },
    { id: 'diomedes', name: 'The Storm Knight', cmdr: 'Diomedes au Raa', where: 'Io, bound for Ceres', open: 'Week 1, 753 PCE. The peace of Ilium is broken: the Dust Armada is under way for Ceres, and the Rim stands with the Remnant against the Republic. The Republic’s legions fight for Mercury, and the Ash Lord lies ailing on Venus.', blurb: 'Take the Dust Armada to war in the first week, allied with the Remnant, before the Republic grows too strong.',
      rule: { key: 'storm', name: 'The Storm Knight’s war', desc: 'The Rim is at war with the Republic from the first week, allied with the Remnant, and the Dust Armada is already under way for Ceres. Diomedes is honour-bound: no bombardment and no sacking, but his fleets fight 6% harder.', fx: { ar: 1.06 } },
      brief: { who: 'Diomedes au Raa, the Storm Knight, heir of Io', text: 'You have convinced your father: the Republic will not be allowed to grow until it swallows the Rim. The Dust Armada is three weeks out from Ceres, the gate to the Core; Atalantia has sworn alliance. Win honourably, or not at all.',
        steps: ['Take Ceres within twenty-five weeks: it is the gate to the Core.', 'Bring Storks behind the armada: the legions take worlds, not the guns.', 'Hold Io: the Republic will come for it once it understands.'] },
      objectives: [{ id: 's_ceres', text: 'Take Ceres within 25 weeks', avail: () => C.turn <= 25, done: () => owns('rim', 'ceres'), reward: { he: 1500, ore: 900 } }, { id: 's_mars', text: 'Take Mars', done: () => owns('rim', 'mars'), reward: { man: 8000, he: 1000 } }],
      setup() { setRel('rep', 'rim', 'war'); setRel('rim', 'soc', 'ally'); C.events.rimAlliance = true; P.onWar('rim', 'rep'); P.addOpinion('soc', 'rim', 'ally', 'Allies against the Republic', 15, .05); P.addOpinion('rim', 'soc', 'ally', 'Allies against the Republic', 15, .05);
        const d = fl('rim', 'Dust Armada'); if (d) { add(d, { boarder: 3, destroyer: 1 }); d.at = null; d.transit = { from: 'io', to: 'ceres', left: 3, total: 4, mode: 'burn' }; }
        chron('war', 'The Rim Dominion goes to war with the Republic, allied with the Remnant.', 'io', 'rim'); } },
  ],
};
export const startsOf = f => STARTS[f] || [];
export const startOf = (f, id) => startsOf(f).find(s => s.id === id) || startsOf(f)[0];
export const cur = () => C.start ? startOf(C.start.f, C.start.id) : null;
export const rule = k => !!(C.start && C.start.rule === k);
export const ruleFx = f => { const S = cur(); return S && C.start.f === f && S.rule.fx ? S.rule.fx : null; };
export const objectives = f => { const S = cur(); return S && C.start.f === f && S.objectives ? S.objectives : []; };
export const opening = () => { const S = cur(); return S && S.open ? S.open : null; };
export const brief = f => { const S = cur(); return S && C.start.f === f ? S.brief || null : null; };

// set up the start and the ahistorical war, after the opening forces are placed and the courts set up
export function apply(f, id, opts = {}) {
  const S = startOf(f, id); C.start = { f, id: S.id, rule: S.rule.key, cmdr: S.cmdr }; C.ahist = !!opts.ahist;
  S.setup();
  // the start's commander leads the main fleet, if they have one
  const c = cm(S.cmdr.split(' ')[0]); if (c) c.hero = true;
  if (C.ahist) ahistorical();
  if (S.id !== startsOf(f)[0].id) chron('start', `${S.cmdr}: ${S.name}. ${S.rule.name}.`, null, f);
}
// the war need not follow the book
function ahistorical() {
  const E = C.events; E.ashT = 35 + Math.floor(rnd() * 26); E.romLives = rnd() < .5;
  const ly = cm('Lysander'), r = rnd();
  if (ly) { const to = r < .45 ? 'rim' : r < .75 ? 'soc' : 'rep'; E.lysander = to; if (to !== 'rim') { ly.owner = to; ly.house = null; ly.title = to === 'soc' ? 'Grandson of Octavia au Lune, at the court of Venus' : 'Grandson of Octavia au Lune, a hostage of the Republic turned ally'; ly.loyalty = 55 + Math.floor(rnd() * 20); } }
  const G = ['rep', 'soc', 'rim'].flatMap(f => P.groupsOf(f).map(g => [f, g])), [bf, bg] = G[Math.floor(rnd() * G.length)];
  bg.sat = 14; E.bitter = bf + ':' + bg.id;
  note(`An ahistorical war: the Ash Lord’s death is not written; Lysander au Lune ${E.lysander === 'rim' ? 'stays at Io' : E.lysander === 'soc' ? 'has gone to Venus' : 'has come over to the Republic'}; ${P.defOf(bf, bg.id).name} of ${BLOC_NAME[bf]} begins the war bitter.`, 'gold');
}
// the starts' rules, once a week
export function tick() {
  if (rule('heliopolis') && C.start.f === 'soc') { if (owns('soc', 'mercury')) P.nudge('soc', 'votum', .6); else if (!C.events.helioFell) { C.events.helioFell = true; P.react('soc', 'defeat', 2); note('Heliopolis has fallen. The Houses ask why the throne did not save it.', 'bad', 'mercury'); } }
}
export const ashWeek = () => (C.events && C.events.ashT) || 45;
