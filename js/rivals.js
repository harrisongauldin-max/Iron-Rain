// Rivals: enemy commanders the war makes personal. A commander who beats you, or whom you beat but who gets away,
// is named in your reports, earns a name from that fight ("the Wall of Phobos") and learns from it: a talent that
// fits what happened. The AI gives its rivals back their fleets and sends them at you. Killing or taking one is
// written in the Chronicle.
//
// Rules: Grand Campaign. The AI's use of rivals (who gets a fleet, where it is sent) is in command.js cmdrTick and
// camp.js targetVal, marked there.
import * as K from './camp.js';
import * as CM from './command.js';
import { bodyOf } from './solar.js';

const rnd = Math.random;
const C = () => K.C;
const MAX_LEARNED = 3; // talents a rival can learn from fighting us
// the record kept on each: { id, vs, wins, esc, log: [{ t, w, k }], epithet, t0, learned: [] }
export const rivalsOf = (me = C().player) => Object.values(C().rivals || {}).filter(R => R.vs === me);
export const rivalRec = (c, me = C().player) => c && C().rivals && C().rivals[c.id] && C().rivals[c.id].vs === me ? C().rivals[c.id] : null;
export const isRival = (c, me) => !!rivalRec(c, me);
export const rivalName = c => { const R = rivalRec(c); return R && R.epithet ? `${c.name}, ${R.epithet}` : c ? c.name : ''; };
// a line for a report or a card: "beat us twice, got away once"
const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times';
export function recordLine(R) {
  const p = []; if (R.wins) p.push(`beat us ${times(R.wins)}`); if (R.esc) p.push(`got away from us ${times(R.esc)}`);
  return p.join(', ');
}
// what a fight teaches: holding a world teaches the wall, a hunt in deep space the hunter's eye, a big win the
// gunnery, any other win the tactics; getting away teaches the torch and the helm. Later fights harden the crews
const LESSON = {
  wall: ['shield', 'the Wall of {w}'], hunt: ['hunter', 'the Hunter of {w}'], scourge: ['gunnery', 'the Scourge of {w}'], bane: ['tactician', 'the Bane of {w}'],
  ghost: ['torch', 'the Ghost of {w}'], slip: ['helm', 'the One Who Got Away at {w}'],
};
const LATER = ['inspiring', 'discipline', 'quarter', 'tactician', 'gunnery', 'helm'];
function lessonOf(c, kind, res) {
  if (kind === 'escape') return rnd() < .6 ? 'ghost' : 'slip';
  if (res.space) return 'hunt';
  if ((res.def === c.owner || (res.defs || []).includes(c.owner)) && C().worlds[res.world] && C().worlds[res.world].owner === c.owner) return 'wall';
  if ((res.margin || 1) >= 2.2 || res.grade === 'decisive' || res.grade === 'annihilation') return 'scourge';
  return 'bane';
}
function learn(c, R, first, lesson) {
  if (R.learned.length >= MAX_LEARNED) return null;
  const want = first ? [LESSON[lesson][0]].concat(LATER) : LATER.slice().sort(() => rnd() - .5);
  const t = want.find(x => CM.TALENT[x] && !CM.hasT(c, x)); if (!t) return null;
  c.talents.push(t); R.learned.push(t); return t;
}
// called by camp.js afterBattle, once the commanders' fates are settled: who of theirs beat us, and who got away
export function afterBattle(res) {
  const me = C().player, wins = res.wins || [], loses = res.loses || [];
  if (!wins.includes(me) && !loses.includes(me)) return;
  const key = (res.space ? res.space.near : res.world) + '|' + C().turn, weWon = wins.includes(me), out = [];
  for (const f of C().fleets) {
    const c = CM.cmdrOf(f); if (!c || c.owner === me || c.owner === 'neu' || !K.hostile(me, c.owner)) continue;
    const fought = (res.space && f.batE === res.space.id) || (f.at === res.world && !f.transit && !res.space) || (f.transit && f.transit.bat === key) || f.bat === key;
    if (!fought || !f.ships.length) continue;
    if (!weWon && wins.includes(f.owner)) out.push(mark(c, 'beat', res));
    else if (weWon && loses.includes(f.owner)) out.push(mark(c, 'escape', res));
  }
  res.rivals = out.filter(Boolean);
}
function mark(c, kind, res) {
  const me = C().player; C().rivals = C().rivals || {};
  let R = C().rivals[c.id]; const first = !R;
  if (!R) R = C().rivals[c.id] = { id: c.id, vs: me, wins: 0, esc: 0, log: [], epithet: null, t0: C().turn, learned: [] };
  const w = res.space ? res.space.near : res.world, nm = bodyOf(w).name;
  if (kind === 'beat') R.wins++; else R.esc++;
  R.log.push({ t: C().turn, w, k: kind }); if (R.log.length > 12) R.log.shift();
  const lesson = lessonOf(c, kind, res);
  if (!R.epithet) R.epithet = LESSON[lesson][1].replace('{w}', nm);
  // the first fight teaches, and every second one after
  const n = R.wins + R.esc, t = first || n % 2 === 1 ? learn(c, R, first, lesson) : null;
  const who = `${c.name}, ${R.epithet}`, taught = t ? ` From that fight: ${CM.TALENT[t].name}.` : '';
  if (first) K.note(kind === 'beat' ? `${c.name} beat us at ${nm}. Our captains already call this ${CM.RANK[c.rank]} of ${K.BLOC_NAME[c.owner].replace('The ', 'the ')} ${R.epithet}.${taught}` : `${c.name} got away from us at ${nm}. Our captains call this ${CM.RANK[c.rank]} ${R.epithet}, and expect to meet again.${taught}`, 'bad', w);
  else K.note(kind === 'beat' ? `${who} has beaten us again, at ${nm}: ${recordLine(R)}.${taught}` : `${who} slips away again at ${nm}: ${recordLine(R)}.${taught}`, 'bad', w);
  return { id: c.id, kind, first, learned: t, world: w };
}
// a rival killed or taken: the Chronicle remembers what they did to us
function fate(k, c, by) {
  const R = C().rivals && C().rivals[c.id]; if (!R || (k !== 'kill' && k !== 'capture')) return;
  const me = R.vs, who = `${c.name}, ${R.epithet}`, rec = recordLine(R);
  R.end = { k, t: C().turn, by };
  if (k === 'kill') {
    K.chron('rival', `${who}, who ${rec}, is dead${by === me ? ' at our hands' : ''}.`, null, c.owner);
    if (by === me) K.note(`${who} is dead. The captains who served against ${c.name} drink to it.`, 'good', null, c.lore ? null : { title: `${c.name} is dead`, kind: 'death' });
  } else if (by === me) {
    K.chron('rival', `${who}, who ${rec}, is our prisoner.`, null, c.owner);
    K.note(`${who} is taken: our prisoner now.`, 'good');
  }
}
// registered once every module has loaded: command.js and camp.js import each other, so it may not be ready yet
queueMicrotask(() => { if (!CM.FATE.includes(fate)) CM.FATE.push(fate); });
// the AI's side: when a rival is given a fleet again, our agents hear of it (command.js calls this)
export function onAssigned(c, fl) {
  const R = rivalRec(c); if (!R || R.back === C().turn) return;
  if (R.lastFleet !== fl.id) { R.back = C().turn; R.lastFleet = fl.id; K.note(`${rivalName(c)} has a fleet again: the ${fl.name}, ${fl.ships.length} ships at ${bodyOf(fl.at || (fl.transit && fl.transit.to)).name}.`, 'bad', fl.at); }
}
