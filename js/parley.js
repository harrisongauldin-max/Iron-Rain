// Talk before you shoot. When fleets meet, they hail each other before the guns speak: one side demands the other
// strike its colours, offers terms to part without a fight, or calls out a champion for single combat before the
// lines close, with every crew watching. Only battles with the player in them have a parley; the AI's own wars are
// fought without one.
//
// Two parts. RULES (Grand Campaign): who can parley, what each outcome does to the fleets, the commanders and the
// battle that follows. ENEMY ANSWERS (AI chat): how an AI commander hails, and whether it yields, takes terms or
// accepts a challenge. Every chance is shown to the player before they choose.
import * as K from './camp.js';
import * as CM from './command.js';
import * as AG from './agents.js';
import * as RU from './rulers.js';
import { doctrineOf } from './morale.js';
import { bodyOf } from './solar.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const C = () => K.C;

// ================================================================ RULES (Grand Campaign)

// a parley needs ships on both sides: platforms and garrisons do not talk
export function canParley(cf, me) {
  if (cf.quest || cf.assault) return false;
  if (cf.att !== me && cf.def !== me) return false;
  const foe = cf.att === me ? cf.def : cf.att;
  return K.cfFleets(cf, me).some(f => f.ships.length) && K.cfFleets(cf, foe).some(f => f.ships.length);
}
const nameOf = (o) => o === 'neu' ? 'the rebels' : K.BLOC_NAME[o];
// who leads a side: the senior commander of that power's own fleets in the battle
export function leadOf(cf, o) {
  const L = K.cfFleets(cf, o).filter(f => f.owner === o && f.ships.length).map(f => CM.cmdrOf(f)).filter(Boolean);
  return L.sort((a, b) => b.rank - a.rank || (b.xp || 0) - (a.xp || 0))[0] || null;
}
// how a commander fights, as the battle AI reads it (morale.js): the books' commanders by name, the rest by talent
export function docOfCmdr(c) {
  if (!c) return 'steady';
  const d = doctrineOf(c.name); if (d !== 'steady') return d;
  if (CM.hasT(c, 'butcher')) return 'onslaught';
  if (CM.hasT(c, 'shield') || CM.hasT(c, 'quarter')) return 'patient';
  if (CM.hasT(c, 'hunter') || CM.hasT(c, 'torch')) return 'cunning';
  return 'steady';
}
// a duellist's worth: rank, the Institute's scar, a name from the books, a boarder's training; age tells
export function duelRating(x) {
  if (!x) return 30;
  if (x.agent) return 66 + 6 * (x.agent.skill || 1);
  const c = x.cmdr; let r = 38 + 6 * c.rank;
  if (CM.hasT(c, 'peerless')) r += 22;
  if (CM.heroOf(c)) r += 14;
  if (CM.hasT(c, 'breacher')) r += 6;
  if (CM.hasT(c, 'helm')) r += 3;
  r -= Math.max(0, (c.age || 35) - 48) * .9;
  return Math.round(r);
}
// a side's champion: a Peerless champion riding with one of its fleets if there is one, else its best blade among
// the commanders. The ruler is never put forward
export function champOf(cf, o) {
  const fls = K.cfFleets(cf, o).filter(f => f.owner === o && f.ships.length), L = [];
  for (const f of fls) { const a = AG.championOf(f); if (a) L.push({ agent: a, name: a.name, fleet: f }); const c = CM.cmdrOf(f); if (c && !RU.isRoyal(c)) L.push({ cmdr: c, name: c.name, fleet: f }); }
  for (const x of L) x.rating = duelRating(x);
  return L.sort((a, b) => b.rating - a.rating)[0] || null;
}
export const duelOdds = (a, b) => 1 / (1 + Math.exp(-((a ? a.rating : 30) - (b ? b.rating : 30)) / 10));

// everything the parley card needs, worked out once
export function context(cf, me) {
  const foe = cf.att === me ? cf.def : cf.att, fc = K.forecastBattle(cf, 160), att = cf.att === me;
  const q = att ? fc.attWin : 1 - fc.attWin; // our chance to win the battle
  const ctx = { cf, me, foe, att, q, fc, myLead: leadOf(cf, me), foeLead: leadOf(cf, foe), myChamp: champOf(cf, me), foeChamp: champOf(cf, foe), tried: {} };
  ctx.duelP = duelOdds(ctx.myChamp, ctx.foeChamp);
  ctx.foeDoc = docOfCmdr(ctx.foeLead);
  ctx.hail = aiHail(ctx);
  ctx.pSurrender = surrenderChance(ctx); ctx.pTerms = termsChance(ctx); ctx.pChallenge = challengeAccept(ctx);
  return ctx;
}
const pidx = (cf, o) => (K.sideOf(cf, cf.att) || [cf.att]).includes(o) ? 0 : 1; // 0: the attacking side, 1: the defending side
// what the parley carries into the battle: a strength multiplier for auto-resolve and a lasting morale shift for a
// battle fought on the map, for each side ([attacker, defender])
function mod(cf, o, mul, mor, line) {
  const P = cf.parley = cf.parley || { mul: [1, 1], mor: [0, 0], lines: [] }, i = pidx(cf, o);
  P.mul[i] *= mul; P.mor[i] += mor; if (line) { P.why = P.why || [null, null]; P.why[i] = line; }
}
// a fleet strikes its colours: every ship of the side comes over as a prize hull with a skeleton crew, and the
// commanders are taken. The battle is over before it starts
export function surrender(cf, winO, loseO) {
  const nm = bodyOf(cf.world).name, losers = K.cfFleets(cf, loseO).filter(f => f.ships.length);
  let to = K.cfOwn(cf, winO).find(f => f.ships.length && (cf.space || (f.at === cf.world && !f.transit))) || K.cfOwn(cf, winO)[0];
  if (!to) to = K.fleet(winO, cf.world, {}, 'Prize Squadron');
  let n = 0;
  for (const f of losers) {
    const c = CM.cmdrOf(f); if (c) CM.capture(c, f, winO, nm);
    for (const s of f.ships) { s.prize = true; s.crew = Math.min(s.crew == null ? 1 : s.crew, .25); s.ammo = Math.min(s.ammo == null ? 1 : s.ammo, .5); to.ships.push(s); n++; } // the same hulls change hands
    f.ships = []; if (AG.championOf(f)) AG.recall(AG.championOf(f));
  }
  const winAtt = pidx(cf, winO) === 0;
  const res = { attWin: winAtt, world: cf.world, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, margin: 4, space: cf.space, lossF: winAtt ? [0, 1] : [1, 0], captured: n, surrendered: true, parley: true };
  C().stats = C().stats || {}; C().stats.surrenders = (C().stats.surrenders || 0) + 1;
  const lead = losers.map(f => f.name).slice(0, 2).join(' and ');
  K.chron('battle', `Off ${nm}, ${lead} ${losers.length > 1 ? 'strike their' : 'strikes its'} colours to ${K.BLOC_NAME[winO] || 'the rebels'} without a shot fired: ${n} hull${n === 1 ? '' : 's'} taken.`, cf.world, winO);
  K.afterBattle(res);
  return res;
}
// terms: one side leaves the field unharmed and the other holds it. No ship is lost, no weariness gained, and the
// side that leaves cannot slip away twice running from the same foe
export function terms(cf, leaverO) {
  const leaveAtt = pidx(cf, leaverO) === 0;
  const res = { attWin: !leaveAtt, world: cf.world, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, withdrew: true, terms: true, space: cf.space, parley: true };
  C().stats = C().stats || {}; C().stats.terms = (C().stats.terms || 0) + 1;
  K.afterBattle(res);
  return res;
}
// single combat before the lines close. The winner's crews go into the battle with their blood up; the loser's
// with their champion dead, beaten or yielded before their eyes
export const DUEL_MUL = 1.1, DUEL_MOR = 14, SHAME_MUL = .96, SHAME_MOR = 8;
export function duel(ctx) {
  const { cf, me, foe } = ctx, a = ctx.myChamp, b = ctx.foeChamp, nm = bodyOf(cf.world).name;
  const weWin = rnd() < ctx.duelP, W = weWin ? a : b, L = weWin ? b : a, wO = weWin ? me : foe, lO = weWin ? foe : me;
  mod(cf, wO, DUEL_MUL, DUEL_MOR, `${W.name} won the duel`); mod(cf, lO, 2 - DUEL_MUL, -DUEL_MOR, `${W.name} won the duel`);
  let fate = 'beaten';
  // the books' own people are hard to kill: they more often walk away wounded, or yield to fight another day
  if (L.cmdr) { const r = rnd(), dieP = L.cmdr.lore ? .2 : .45, woundP = L.cmdr.lore ? .7 : .8; if (r < dieP) { fate = 'killed'; CM.kill(L.cmdr, L.fleet, `${L.name} was cut down in single combat by ${W.name} before the battle off ${nm}.`, null, wO); } else if (r < woundP) { fate = 'wounded'; CM.wound(L.cmdr, L.fleet, nm); } else { fate = 'yielded'; CM.capture(L.cmdr, L.fleet, wO, nm); } }
  else if (L.agent) { if (rnd() < .7) { fate = 'killed'; L.agent.state = 'dead'; } }
  if (W.cmdr) CM.gainXp(W.cmdr, 25); else if (W.agent) W.agent.skill = Math.min(5, (W.agent.skill || 1) + 1);
  const big = (W.cmdr && (W.cmdr.lore || W.cmdr.rank >= 2)) || (L.cmdr && (L.cmdr.lore || L.cmdr.rank >= 2)) || W.agent || L.agent;
  const verb = fate === 'killed' ? 'kills' : fate === 'wounded' ? 'wounds' : fate === 'yielded' ? 'takes the surrender of' : 'beats';
  if (big) K.chron('duel', `Before the battle off ${nm}, ${W.name} ${verb} ${L.name} in single combat.`, cf.world, wO);
  C().stats = C().stats || {}; C().stats.duels = (C().stats.duels || 0) + 1;
  return { weWin, winner: W, loser: L, fate };
}
// a challenge refused: the side that would not send its champion fights shamed
export function refuse(cf, o) { mod(cf, o, SHAME_MUL, -SHAME_MOR, 'Refused a challenge'); }
// a demand refused: the defiance stiffens the side that gave it
export function defied(cf, o) { mod(cf, o, 1, 4, 'Defied a demand to yield'); }

// ================================================================ ENEMY ANSWERS (AI chat)
// How an AI commander meets a hail. q is the player's chance to win, so 1 - q is the enemy's.

const DOC_YIELD = { reckless: .08, onslaught: .3, steady: .75, patient: 1, cunning: .8 };
// strike their colours: only when the battle is hopeless, and never for the proudest. A commander whose crews
// don't trust them, a junior officer, or a people tired of the war yield sooner; a legend of the books almost never
export function surrenderChance(ctx) {
  const foeQ = 1 - ctx.q; if (foeQ > .12) return 0;
  const c = ctx.foeLead, foe = ctx.foe; let k = DOC_YIELD[ctx.foeDoc] ?? .7;
  if (c) {
    if (CM.hasT(c, 'discipline') || CM.hasT(c, 'peerless')) k *= .5;
    if (CM.heroOf(c) || RU.isRoyal(c)) k *= .2;
    if ((c.loyalty ?? 70) < 40) k *= 1.5;
    k *= [1.3, 1.1, .85, .6][c.rank] || 1;
  } else k *= 1.1; // a patrol's crews, no Gold to forbid it
  if (foe === 'neu') k *= 1.2;
  if ((C().weary[foe] || 0) > 50) k *= 1.4;
  if (foe === 'soc' && ctx.me === 'rep') k *= .7; // a Society Gold does not kneel to the Rising lightly
  if (foe === 'rim') k *= 1.1; // the Rim counts its ships and its honour, and will not throw away either
  return clamp((.12 - foeQ) / .12 * k, 0, .9);
}
// terms: if we are the stronger, we let them go and they take the offer when the battle looks lost and their
// commander is not one to fight to the last; if we are the weaker, we ask leave to go, and they grant it when the
// field is theirs anyway and their commander would rather keep the ships than have the kill
export function termsChance(ctx) {
  const foeQ = 1 - ctx.q, foe = ctx.foe, w = C().worlds[ctx.cf.world], hate = (C().weary[foe] || 0) > 40 ? 1.3 : 1;
  const D = { reckless: [.15, .1], onslaught: [.5, .3], steady: [.9, .8], patient: [1.1, .9], cunning: [1, .5] }[ctx.foeDoc] || [.9, .7];
  if (ctx.q >= .5) {
    let p = clamp((.5 - foeQ) / .35, 0, 1) * D[0] * hate;
    // giving up the orbit of their own world is harder, of their capital hardest
    if (!ctx.cf.space && w.owner === foe) p *= ctx.cf.world === K.CAPITAL[foe] ? .2 : .55;
    return clamp(p, 0, .9);
  }
  let p = clamp((foeQ - .5) / .4, 0, 1) * D[1];
  if (!ctx.cf.space && w.owner === ctx.me && !ctx.att) p *= 1.3; // we offer them the orbit of our world: a prize without a fight
  if (ctx.foeLead && CM.hasT(ctx.foeLead, 'hunter')) p *= .6;
  return clamp(p, 0, .9);
}
// a challenge: a Gold of honour answers it; a careful commander outmatched keeps their champion home and takes the
// shame. Rebels and raiders have no use for single combat
export function challengeAccept(ctx) {
  if (!ctx.foeChamp) return 0;
  if (ctx.foe === 'neu') return .2;
  const gap = (ctx.myChamp ? ctx.myChamp.rating : 30) - ctx.foeChamp.rating, d = ctx.foeDoc;
  if (d === 'reckless' || d === 'onslaught') return .97;
  if (gap <= 0) return .95;
  return clamp(.92 - gap / (d === 'patient' || d === 'cunning' ? 30 : 60), .25, .92);
}
// what the enemy says first. A demand when the battle is theirs and their commander is the kind to make it; a
// request for terms when it is lost and they would keep their ships; a challenge from a famous blade; else defiance
export function aiHail(ctx) {
  const foeQ = 1 - ctx.q, d = ctx.foeDoc, ch = ctx.foeChamp;
  if (foeQ > .9 && d !== 'patient') return 'demand';
  if (foeQ < .2 && (d === 'patient' || d === 'steady' || d === 'cunning') && ctx.foe !== 'neu') return 'terms';
  if (ch && ch.rating >= 74 && foeQ > .2 && foeQ < .85 && ctx.foe !== 'neu') return 'challenge';
  if (ch && ch.rating >= 66 && (d === 'reckless' || d === 'onslaught') && ctx.foe !== 'neu') return 'challenge';
  return 'defy';
}
// the words: short, in each power's voice. {n} is the enemy commander, {w} the world
export const VOICE = {
  soc: {
    demand: ['Strike your colours, and the Society may yet find a use for your crews.', 'You are outmatched and you know it. Kneel, and live.'],
    terms: ['Let us withdraw, and the orbit is yours today. There will be other days.', 'We will leave the field. Do not mistake it for fear.'],
    challenge: ['{n} offers single combat, blade against blade, before the guns speak.', '{n} calls for your best. Let Gold settle it before the hulls burn.'],
    defy: ['The Society does not parley with rebels. Come and take it.', 'Hail Gold. The rest is noise.'],
    no: ['We are Gold. We do not kneel.', 'Your terms are refused. Bring your ships.'],
  },
  rep: {
    demand: ['Lay down your arms. Nobody else need die for the old masters today.', 'You cannot win this. Strike your colours and your crews go free.'],
    terms: ['Let us pull back and no one dies here. The orbit is yours.', 'We will go. Our crews have bled enough this week.'],
    challenge: ['{n} will meet your champion, if you have one worth the name.', '{n} challenges you. Settle it between us, before the ships.'],
    defy: ['Break the chains. We are not going anywhere.', 'The Rising does not bargain with its masters.'],
    no: ['No. We have knelt before, and we are done with it.', 'Come and get us.'],
  },
  rim: {
    demand: ['You are far from home and outnumbered. Yield your ships and the Rim will send your crews back.', 'Strike your colours. There is no shame in counting ships.'],
    terms: ['The Rim will withdraw with its honour. The orbit is yours.', 'We will not spend our ships for this. We go.'],
    challenge: ['{n} offers a duel by the old law of the Moon Lords.', '{n} will face your best. Let the dust decide.'],
    defy: ['The Rim keeps its own counsel. Turn back.', 'You should not have come so far out.'],
    no: ['The Rim does not yield to the Core.', 'We will see whose ships are better.'],
  },
  neu: {
    demand: ['Turn back and nobody gets hurt.'],
    terms: ['Let us go and we never saw each other.'],
    challenge: ['Our captain will fight yours.'],
    defy: ['We are not yours. Not any more.'],
    no: ['Not a chance.'],
  },
};
export function say(o, kind, c, world) {
  const L = (VOICE[o] || VOICE.neu)[kind] || VOICE.neu[kind] || [''];
  return L[Math.floor(rnd() * L.length)].replace('{n}', c ? c.name : 'Their champion').replace('{w}', world ? bodyOf(world).name : '');
}
