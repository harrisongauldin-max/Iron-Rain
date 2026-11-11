// Phase E of the campaign: story. Events and dilemmas drawn from the world of Iron Gold; situations that build
// week by week until they break; missions that grow out of the war as it stands; and the crises of the late
// war: the realm divided against a power grown too strong, the Ascomanni out of the dark, a Society torn by
// civil war, and a third rebellion of the Moon Lords.
import { C, note, hostile, relOf, setRel, BLOC_NAME, CAPITAL, fleetsAt, fleetStr, fleet, newShip, travel, moveFleet, defStr, declareWar, defsOf, human } from './camp.js';
import * as CM from './command.js';
import * as P from './politics.js';
import * as EC from './economy.js';
import * as TE from './tech.js';
import { bodyOf } from './solar.js';
import * as IN from './intel.js';
import * as RU from './rulers.js';
import * as CQ from './conquest.js';
import { chron } from './camp.js';

const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v, pickOne = a => a[Math.floor(rnd() * a.length)];
const nm = id => bodyOf(id).name;
const mine = f => Object.values(C.worlds).filter(w => w.owner === f);
const shock = (w, e, v) => { if (w && w.cl) { w.cl[e] = clamp(w.cl[e] + v, 0, 100); EC.syncLoy(w); } };
const shockAll = (f, e, v) => { for (const w of mine(f)) shock(w, e, v); };

// ---------------------------------------------------------------- events and dilemmas
// when(f) returns a target (a world id, a commander, true) or null; choices act on (f, target)
export const EVENTS = {
  famine: { title: 'Famine on Mars', kind: 'revolt', when: f => C.worlds.mars.owner === f && C.fac[f].res.food < 100 ? 'mars' : null, once: false, cd: 20,
    text: (f, t) => 'The dust storms have taken another harvest, and the mining clans of Mars are starving. The Reds are watching what their masters do.',
    choices: [
      { label: 'Ship grain from the stockpile', tip: 'Up to 400 food from the stockpile · Reds on Mars up to +15, less if the stores are low', fx: (f, t) => { const g = Math.min(400, Math.max(0, C.fac[f].res.food)); C.fac[f].res.food -= g; shock(C.worlds[t], 'red', Math.round(15 * g / 400)); } },
      { label: 'Ration and hold', tip: 'Reds on Mars −10', fx: (f, t) => shock(C.worlds[t], 'red', -10) },
      { label: 'Blame the old Golds', tip: 'Reds on Mars +6 · Golds everywhere −8', fx: (f, t) => { shock(C.worlds[t], 'red', 6); shockAll(f, 'gold', -8); } } ] },
  syndicate: { title: 'The Syndicate of Luna', kind: 'revolt', when: f => C.worlds.luna.owner === f ? 'luna' : null, once: true,
    text: () => 'Luna’s crime lords skim a fifth of what moves through the Atlas Docks. Their envoy offers a share of it, for a blind eye.',
    choices: [
      { label: 'Take their money', tip: '+400 He-3 and +25 influence · Silvers and Coppers on Luna −10', fx: (f, t) => { C.fac[f].res.he += 400; C.fac[f].res.inf += 25; shock(C.worlds[t], 'mid', -10); } },
      { cost: { he: 300 }, label: 'Send in the Grays', tip: '−300 He-3 · Silvers and Coppers on Luna +10 · Luna’s garrison −15%', fx: (f, t) => { C.fac[f].res.he -= 300; shock(C.worlds[t], 'mid', 10); C.worlds[t].garrison = Math.round(C.worlds[t].garrison * .85); } },
      { label: 'Leave it be', tip: 'Nothing changes', fx: () => {} } ] },
  strike: { title: 'Strike at the Docks', kind: 'revolt', when: f => { const ws = mine(f).filter(w => w.lv.yard >= 2 && w.cl && w.cl.orange < 55); return ws.length ? pickOne(ws).id : null; }, cd: 16,
    text: (f, t) => `The mechanics' union has walked out of the yards at ${nm(t)}. They want better pay, and a say in the war they build ships for.`,
    choices: [
      { cost: { he: 350 }, label: 'Meet their demands', tip: '−350 He-3 · Oranges +18, Reds +5 on the world', fx: (f, t) => { C.fac[f].res.he -= 350; shock(C.worlds[t], 'orange', 18); shock(C.worlds[t], 'red', 5); } },
      { label: 'Break the strike', tip: 'Oranges −15 on the world · its yard queue loses two weeks', fx: (f, t) => { shock(C.worlds[t], 'orange', -15); const w = C.worlds[t]; if (w.sq[0]) w.sq[0].left += 2; P.react(f, 'bombard', .5); } } ] },
  duel: { title: 'A Challenge', kind: 'war', when: f => { const L = C.cmdrs.filter(c => { if (c.owner !== f || c.state !== 'fleet' || !/Gold/.test(c.colour || '')) return false; const fl = C.fleets.find(x => x.id === c.fleet); return fl && fl.at && C.fleets.some(o => hostile(f, o.owner) && (o.at === fl.at || (o.transit && o.transit.to === fl.at && o.transit.left <= 1))); }); return L.length ? pickOne(L) : null; }, cd: 14,
    text: (f, c) => `${foeChamp(c) ? foeChamp(c).name + ', ' + (foeChamp(c).title || 'a Peerless Scarred') + ',' : 'A Peerless Scarred of the enemy'} has challenged ${c.name} to single combat before the fleets. To refuse is to be named a coward in every officers' mess in the system.`,
    choices: [
      { label: 'Accept the challenge', tip: 'Even odds: glory and a talent, or a wound. A blade of legend changes hands with the duel', fx: (f, c) => { const o = foeChamp(c); if (rnd() < (CM.hasT(c, 'peerless') ? .7 : .5)) { CM.gainXp(c, 120); if (f === C.player) note(`${c.name} wins the duel. Their legend grows.`, 'good'); shockAll(f, 'gold', 4); if (o) for (const h of CM.heirOf(o)) CM.giveHeir(h, c, `won in a duel from ${o.name}`); } else { CM.wound(c, C.fleets.find(x => x.id === c.fleet), 'a duel'); if (o) for (const h of CM.heirOf(c)) CM.giveHeir(h, o, `won in a duel from ${c.name}`); } } },
      { label: 'Refuse', tip: 'Golds everywhere −6', fx: f => shockAll(f, 'gold', -6) } ] },
  carvers: { title: 'An Offer from the Carvers', kind: 'tech', when: f => C.turn > 10 && C.fac[f].res.he > 800 ? true : null, cd: 30,
    text: () => 'A Violet Carver, whose art reshapes flesh, offers her services to your legions and your laboratories, for a price.',
    choices: [
      { cost: { he: 600 }, label: 'Fund her laboratories', tip: '−600 He-3 · +60 research', fx: f => { C.fac[f].res.he -= 600; TE.grant(f, 60); } },
      { cost: { he: 600 }, label: 'Carve new legions', tip: '−600 He-3 · +5,000 manpower', fx: f => { C.fac[f].res.he -= 600; C.fac[f].res.man += 5000; } },
      { label: 'Send her away', tip: 'Nothing', fx: () => {} } ] },
  obsidians: { title: 'The Obsidians', kind: 'revolt', when: f => f === 'rep' && C.turn > 6 ? true : null, cd: 26,
    text: () => 'The Obsidians who fought for the Rising were given the hardest lands of Mars and the Earth. Their warlords ask what their blood has bought them.',
    choices: [
      { cost: { inf: 40 }, label: 'Grant them land and honours', tip: '−40 influence · Grays and Obsidians +12 everywhere', fx: f => { C.fac[f].res.inf -= 40; shockAll(f, 'war', 12); } },
      { label: 'Promise more after the war', tip: 'Grays and Obsidians −8 everywhere', fx: f => shockAll(f, 'war', -8) } ] },
  harmony: { title: 'Harmony’s Broadcasts', kind: 'revolt', when: f => f === 'rep' && mine(f).some(w => w.cl && w.cl.red < 55) ? true : null, cd: 18,
    text: () => 'The Red Hand broadcasts across the Martian mines: the Republic has forgotten the Reds who bled for it. Harmony calls for a second rising.',
    choices: [
      { cost: { he: 500 }, label: 'Answer with relief and works', tip: '−500 He-3 · Reds +8 everywhere', fx: f => { C.fac[f].res.he -= 500; shockAll(f, 'red', 8); } },
      { label: 'Hunt the Red Hand', tip: 'Reds −5 everywhere · the next rising is less likely', fx: f => { shockAll(f, 'red', -5); C.sit = C.sit || {}; const s = C.sit[f + ':redhand']; if (s) s.prog = Math.max(0, s.prog - 30); } } ] },
  defector: { title: 'A Defector', kind: 'alliance', when: f => { const foes = ['rep', 'soc', 'rim'].filter(o => o !== f && hostile(f, o)); const L = C.cmdrs.filter(c => foes.includes(c.owner) && c.state === 'pool' && !c.lore); return L.length && rnd() < .5 ? pickOne(L) : null; }, cd: 24,
    text: (f, c) => `${c.name}, an officer of ${BLOC_NAME[c.owner]}, has sent word through a Sons of Ares courier: they will come over, for a price and a command.`,
    choices: [
      { cost: { inf: 30, he: 400 }, label: 'Pay and welcome them', tip: '−30 influence · −400 He-3 · the officer joins your corps', fx: (f, c) => { C.fac[f].res.inf -= 30; C.fac[f].res.he -= 400; const was = c.owner; c.owner = f; c.state = 'pool'; c.house = null; c.griev = [['Came over to us, and was paid', 10]]; c.loyalty = 65; note(`${c.name} comes over to ${BLOC_NAME[f]}.`, f === C.player ? 'good' : was === C.player ? 'bad' : ''); } },
      { label: 'Refuse', tip: 'Nothing', fx: () => {} } ] },
  market: { title: 'The Hanging Market', kind: 'alliance', when: f => C.worlds.ceres.owner === f ? 'ceres' : null, cd: 22,
    text: () => 'Traders of the Hanging Market on Ceres want protection for a convoy to the outer moons.',
    choices: [
      { label: 'Escort it', tip: 'Needs a fleet at Ceres: +500 He-3', fx: (f, t) => { if (fleetsAt(t, f).length) { C.fac[f].res.he += 500; note('The convoy reaches the Rim safely. The market pays well.', 'good', t); } else note('No fleet at Ceres to escort the convoy. The traders go elsewhere.', 'bad', t); } },
      { label: 'Tax it and let it go', tip: '+150 He-3 · Silvers and Coppers on Ceres −6', fx: (f, t) => { C.fac[f].res.he += 150; shock(C.worlds[t], 'mid', -6); } } ] },
  dust: { title: 'Dust Storm', kind: 'revolt', when: f => C.worlds.mars.owner === f ? 'mars' : null, cd: 30,
    text: () => 'A planet-wide dust storm shuts the Martian mines and grounds the shuttles for weeks.',
    choices: [
      { label: 'Keep the mines running', tip: 'Reds on Mars −12 · nothing lost', fx: (f, t) => shock(C.worlds[t], 'red', -12) },
      { cost: { ore: 300, he: 150 }, label: 'Close the mines until it passes', tip: '−300 ore · −150 He-3', fx: f => { C.fac[f].res.ore -= 300; C.fac[f].res.he -= 150; } } ] },
  council: { title: 'The Moon Lords Gather', kind: 'alliance', when: f => f === 'rim' && C.turn > 8 && !hostile('rim', 'rep') ? true : null, cd: 24,
    text: () => 'The Moon Lords gather at Sungrave. Helios au Lux speaks of the Republic’s fleets; the Lord of Triton speaks of peace.',
    choices: [
      { label: 'Side with Helios', tip: 'House Lux, Codovan and Callisto +10 · Raa, Norvo and Titan −6', fx: f => { for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (['lux', 'codovan', 'callisto'].includes(g.id) ? 10 : -6), 0, 100); } },
      { label: 'Side with the peace', tip: 'Raa, Norvo and Titan +10 · Lux, Codovan and Callisto −6', fx: f => { for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (['raa', 'norvo', 'titan'].includes(g.id) ? 10 : -6), 0, 100); } } ] },
  houses: { title: 'A Quarrel of Houses', kind: 'revolt', when: f => f === 'soc' && C.turn > 6 ? true : null, cd: 18,
    text: () => 'House Carthii and House Votum quarrel over the Mercury yards. Each demands that you take its side.',
    choices: [
      { label: 'Side with Carthii', tip: 'Carthii +12 · Votum −10', fx: f => { for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (g.id === 'carthii' ? 12 : g.id === 'votum' ? -10 : 0), 0, 100); } },
      { label: 'Side with Votum', tip: 'Votum +12 · Carthii −10', fx: f => { for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (g.id === 'votum' ? 12 : g.id === 'carthii' ? -10 : 0), 0, 100); } },
      { cost: { inf: 50 }, label: 'Buy them both off', tip: '−50 influence · both +4', fx: f => { C.fac[f].res.inf -= 50; for (const g of P.groupsOf(f)) if (g.id === 'votum' || g.id === 'carthii') g.sat = clamp(g.sat + 4, 0, 100); } } ] },
};
function eventTick() {
  C.evLast = C.evLast || {};
  for (const f of ['rep', 'soc', 'rim']) {
    if (!C.fac[f].alive || rnd() > .14) continue;
    const ok = Object.keys(EVENTS).filter(k => { const E = EVENTS[k], L = C.evLast[f + k]; return !(E.once && L) && !(L && C.turn - L < (E.cd || 20)); });
    for (const k of ok.sort(() => rnd() - .5)) {
      const t = EVENTS[k].when(f); if (t == null) continue;
      C.evLast[f + k] = C.turn;
      if (human(f)) (C.pendingEvents = C.pendingEvents || []).push({ k, f, t });
      else { const ok = EVENTS[k].choices.filter(c => affordable(f, c)); (ok.length ? pickOne(ok) : EVENTS[k].choices[EVENTS[k].choices.length - 1]).fx(f, t); }
      break;
    }
  }
}
export const affordable = (f, c) => !c.cost || Object.entries(c.cost).every(([k, v]) => (C.fac[f].res[k] || 0) >= v);
export function choose(ev, i) { const E = EVENTS[ev.k]; let c = E.choices[i]; if (!affordable(ev.f, c)) c = E.choices.find(x => affordable(ev.f, x)) || c; c.fx(ev.f, ev.t); }

// ---------------------------------------------------------------- situations: pressures that build to a break
export const SITS = {
  famine:  { name: 'Famine', desc: 'The realm cannot feed itself. Each week of hunger takes the Reds closer to rising.', rate: f => C.fac[f].res.food < 0 ? 8 : -10, at100: f => { for (const w of mine(f)) shock(w, 'red', -25); note('The famine breaks into bread riots across the realm.', f === C.player ? 'bad' : '', null, f === C.player ? { title: 'Bread riots', kind: 'revolt' } : null); } },
  redhand: { name: 'The Red Hand insurgency', desc: 'Harmony’s Red Hand gathers strength wherever the Reds feel forgotten.', rate: f => f !== 'rep' ? -100 : (avg(f, 'red') < 55 ? (4 + (55 - avg(f, 'red')) / 5) * (P.hasLaw(f, 'amnesty') ? .4 : 1) : -6), at100: f => { const ws = mine(f).filter(w => w.lv.yard); const w = ws.length ? pickOne(ws) : null; if (w) { w.lv.yard = Math.max(0, w.lv.yard - 1); w.sq = []; w.garrison = Math.round(w.garrison * .6); } note(`The Red Hand strikes${w ? ' at the yards of ' + nm(w.id) : ''}: a bomb in the docks, and hundreds dead.`, f === C.player ? 'bad' : '', w && w.id, f === C.player ? { title: 'The Red Hand strikes', kind: 'revolt' } : null); } },
  weary:   { name: 'War weariness', desc: 'The people are tired of the war. If it goes on, they will make the government end it.', rate: f => (C.weary[f] || 0) > 60 ? 6 : -8, at100: f => { for (const w of mine(f)) EC.jolt(w, -8); for (const g of P.groupsOf(f)) g.sat = clamp(g.sat - 15, 0, 100); note('Mass protests against the war fill the streets of every world.', f === C.player ? 'bad' : '', null, f === C.player ? { title: 'The war at home', kind: 'revolt' } : null); } },
};
const avg = (f, e) => { const ws = mine(f).filter(w => w.cl); return ws.length ? ws.reduce((a, w) => a + w.cl[e] * EC.mixOf(w.id)[e], 0) / Math.max(.01, ws.reduce((a, w) => a + EC.mixOf(w.id)[e], 0)) : 50; };
function sitTick() {
  C.sit = C.sit || {};
  for (const f of ['rep', 'soc', 'rim']) for (const k in SITS) {
    if (!C.fac[f].alive) continue; const key = f + ':' + k, S = SITS[k];
    const s = C.sit[key] || (C.sit[key] = { prog: 0 }); s.prog = clamp(s.prog + S.rate(f), 0, 100);
    if (s.prog >= 100) { S.at100(f); s.prog = 40; }
  }
}
export const situationsOf = f => Object.keys(SITS).map(k => ({ k, ...SITS[k], prog: (C.sit && C.sit[f + ':' + k] || { prog: 0 }).prog })).filter(s => s.prog > 0);

// ---------------------------------------------------------------- missions that grow out of the war
let mid = 1;
// what a mission checks, by kind. A mission keeps only its kind and its numbers, so a saved campaign can carry
// it; the checks are bound back on when it is made and when a campaign is loaded
const fleetSum = o => C.fleets.filter(x => x.owner === o).reduce((a, x) => a + fleetStr(x), 0);
const MK = {
  conquer: { done: (m, f) => C.worlds[m.w].owner === f },
  siege: { done: (m, f) => !C.worlds[m.w].siege && C.worlds[m.w].owner === f },
  foundry: { done: (m, f) => C.worlds[m.w].owner === f && C.worlds[m.w].lv.foundry > 0 },
  calm: { done: (m, f) => !C.worlds[m.w].unrest && C.worlds[m.w].owner === f },
  fleet: { done: (m, f) => fleetSum(f) >= m.goal },
  spare: { done: () => false, broken: (m, f) => ((C.bombards && C.bombards[f]) || 0) > m.bomb0 },
  hold: { done: () => false, broken: (m, f) => C.turn > m.m0t + 1 && !fleetsAt(m.w, f).length },
  home: { done: (m, f) => { const c = C.cmdrs.find(x => x.id === m.cid); return !c || c.state !== 'captured' || Object.values(C.worlds).some(w => m.own0.includes(w.id) && w.owner === f); },
    onDone: m => { const c = C.cmdrs.find(x => x.id === m.cid); if (c && c.state === 'captured') { c.state = 'pool'; c.captor = null; note(`${c.name} is free: the raiders bring them home.`, 'good'); } } },
  minotaur: { done: () => { const d = cmdr('Darrow'), fl = d && C.fleets.find(x => x.id === d.fleet); return !!(fl && fl.at === 'venus'); }, onDone: () => ashLordFalls('raid'),
    onFail: () => { const d = cmdr('Darrow'); if (d && d.state === 'fleet' && rnd() < .3) CM.capture(d, C.fleets.find(x => x.id === d.fleet), 'soc', 'Venus'); } },
};
export const regMission = (k, spec) => { MK[k] = spec; };
export function bindMission(m) {
  const K = MK[m.k]; if (!K) return m; const f = m.f;
  m.done = () => K.done(m, f); if (K.broken) m.broken = () => K.broken(m, f); if (K.onDone) m.onDone = () => K.onDone(m, f); if (K.onFail) m.onFail = () => K.onFail(m, f);
  return m;
}
// after a load: every mission gets its checks back, the id counter runs on from the highest, and the hooks are set
export function afterLoad() {
  if (!fateOn) { CM.FATE.push(onFate); fateOn = true; }
  let hi = 0; for (const f in C.missions || {}) for (const m of C.missions[f]) { bindMission(m); hi = Math.max(hi, +String(m.id).slice(1) || 0); }
  if (C.questPend && C.questPend.m) bindMission(C.questPend.m);
  mid = Math.max(mid, hi + 1);
}
function newMission(f) {
  const foes = ['rep', 'soc', 'rim'].filter(o => o !== f && C.fac[o].alive && hostile(f, o)), out = [];
  const fr = Object.values(C.worlds).filter(w => foes.includes(w.owner) || (w.owner === 'neu' && w.home !== 'neu'));
  if (fr.length) { const w = fr.sort((a, b) => Math.min(...mine(f).map(m => travel(m.id, a.id))) - Math.min(...mine(f).map(m => travel(m.id, b.id))))[0]; const wk = 12;
    out.push({ g: 'conquer', k: 'conquer', w: w.id, text: `Take ${nm(w.id)} within ${wk} weeks`, reward: { he: 800, inf: 30 }, left: wk }); }
  const sieged = mine(f).filter(w => w.siege); if (sieged.length) { const w = sieged[0]; out.push({ g: 'siege', k: 'siege', w: w.id, text: `Break the siege of ${nm(w.id)} within 6 weeks`, reward: { man: 4000, inf: 20 }, left: 6 }); }
  const noF = mine(f).filter(w => !w.lv.foundry && (w.lv.mine || w.lv.yard) && !w.siege); if (noF.length) { const w = noF[0]; out.push({ g: 'foundry', k: 'foundry', w: w.id, text: `Build a Foundry at ${nm(w.id)} within 10 weeks`, reward: { alloy: 300 }, left: 10 }); }
  const rs = mine(f).filter(w => w.unrest); if (rs.length) { const w = rs[0]; out.push({ g: 'calm', k: 'calm', w: w.id, text: `Calm ${nm(w.id)}: no estate under 30% within 10 weeks`, reward: { inf: 40 }, left: 10 }); }
  const sum = (o) => C.fleets.filter(x => x.owner === o).reduce((a, x) => a + fleetStr(x), 0), goal = Math.max(1000, Math.round(sum(f) * 1.3 / 500) * 500);
  if (rnd() < .4 || out.length < 2) out.push({ g: 'fleet', k: 'fleet', goal, text: `Grow the fleet to ${goal.toLocaleString()} strength within 14 weeks`, reward: { ord: 800, he: 400 }, left: 14 });
  // keeping missions: kept for the whole term, broken the moment the condition fails
  if (foes.length) { const sc0 = mine(f).reduce((a, w) => a + 0, 0), bomb0 = (C.bombards && C.bombards[f]) || 0; out.push({ g: 'spare', k: 'spare', bomb0, hold: true, text: 'Spare the cities: no bombardment for 8 weeks', reward: { inf: 35 }, left: 8 }); }
  { const ws = mine(f).filter(w => w.lv.yard >= 2); if (ws.length) { const w = pickOne(ws); out.push({ g: 'hold', k: 'hold', w: w.id, hold: true, text: `Keep a fleet at ${nm(w.id)} for 6 weeks`, reward: { he: 600, inf: 15 }, left: 6 }); } }
  const m = pickOne(out); m.m0t = C.turn; m.f = f; bindMission(m); m.giver = (GIVERS[f] || {})[m.g] || null; if (m.giver && !P.groupsOf(f).some(x => x.id === m.giver)) m.giver = null; m.id = 'm' + (mid++); m.mission = true; return m;
}
function missionTick() {
  C.missions = C.missions || {}; const f = C.player, L = C.missions[f] = C.missions[f] || [];
  for (const m of L.slice()) {
    const win = () => { const r = C.fac[f].res; for (const k in m.reward) r[k] = (r[k] || 0) + m.reward[k]; if (m.giver) groupSat(f, [m.giver], 8); if (m.onDone) m.onDone(); note(`Mission complete: ${m.text}.${m.giver ? ' ' + giverName(f, m.giver) + ' are pleased.' : ''}`, 'gold'); L.splice(L.indexOf(m), 1); };
    const lose = () => { if (m.giver) groupSat(f, [m.giver], -6); C.fac[f].res.inf = Math.max(0, C.fac[f].res.inf - 10); if (m.onFail) m.onFail(); note(`Mission failed: ${m.text}.${m.giver ? ' ' + giverName(f, m.giver) + ' will remember it.' : ''} (−10 influence)`, 'bad'); L.splice(L.indexOf(m), 1); };
    if (m.hold) { if (m.broken && m.broken()) { lose(); continue; } if (--m.left <= 0) win(); continue; }
    if (m.done()) { if (m.quest) { C.questPend = { k: m.quest, w: m.qw, m }; L.splice(L.indexOf(m), 1); continue; } win(); continue; } /* a quest is won on the battlefield, not by arriving */
    if (--m.left <= 0) lose();
  }
  if (L.length < 2 && C.turn % 6 === 2) { const m = newMission(f); if (m && !L.some(x => x.text === m.text)) { L.push(m); note(`New mission: ${m.giver ? giverName(f, m.giver) + ' ask: ' : ''}${m.text}.`, 'gold'); } }
}
export const missionsOf = f => (C.missions && C.missions[f]) || [];

// ---------------------------------------------------------------- crises of the late war
// Each crisis has a meter, built from parts the player can read. The triggers are relative: a power that has grown
// far past what it began with, a Remnant whose throne is weak or whose worlds are lost, a Rim whose council has
// turned. A director watches the war: after the first year, if no crisis is abroad and the map has not moved for
// twelve weeks, it pushes the nearest one over the edge.
export const CRISES = {
  divide: { name: 'Realm Divide', desc: 'One power has grown far past what it began the war with. Every other power turns on it.' },
  ascomanni: { name: 'The Ascomanni', desc: 'Obsidian raiders out of the far dark beyond the Rim, under the warlord Volsung Fá. They hold a base on Pluto; kill the warlord or take the base to end them.' },
  civilwar: { name: 'The Society at War with Itself', desc: 'A great House of the Remnant raises its banner against a weak throne.' },
  moonlords: { name: 'The Third Moon Lord Rebellion', desc: 'Moon Lords break with the Dominion and rule their moons alone.' },
  lysander: { name: 'Lysander’s Concord', desc: 'Lysander au Lune gathers the bitter Houses of the Core and the Rim behind the old name of Lune.' },
};
const inhabited = () => Object.values(C.worlds).filter(w => w.id !== 'rhea');
const startN = f => (C.startN || {})[f] || 0;
export const divideThr = f => Math.max(startN(f) + Math.max(4, Math.ceil(startN(f) * .3)), Math.ceil(inhabited().length * .35));
const POW = ['rep', 'soc', 'rim'];
const strAll = o => C.fleets.filter(x => x.owner === o).reduce((a, x) => a + fleetStr(x), 0);
const bitter = (fs, lim = 25) => fs.flatMap(f => C.fac[f].alive ? P.groupsOf(f).filter(g => g.sat < lim).map(g => [f, g]) : []).filter(([f, g]) => { const D = P.defOf(f, g.id); return D.seat && D.seat !== CAPITAL[f] && C.worlds[D.seat] && C.worlds[D.seat].owner === f; });
// each crisis's meter: { prog (0..100), parts: [label, points] }
export function crisisParts(k) {
  const P0 = [], t = C.turn, pct = v => Math.round(v);
  if (k === 'divide') { let best = null; for (const f of POW) { if (!C.fac[f].alive) continue; const n = mine(f).length, thr = divideThr(f), pr = 100 * (n - startN(f)) / Math.max(1, thr - startN(f)); if (!best || pr > best.pr) best = { f, n, thr, pr }; }
    if (!best) return { prog: 0, parts: [] }; P0.push([`${BLOC_NAME[best.f]} has grown from ${startN(best.f)} worlds to ${best.n}; the others turn on it at ${best.thr}`, pct(Math.max(0, best.pr))]); if (t <= 30) P0.push(['Not before the thirtieth week', -100]); return { prog: clamp(P0.reduce((a, p) => a + p[1], 0), 0, 100), parts: P0, who: best.f }; }
  if (k === 'civilwar') { if (!C.fac.soc.alive) return { prog: 0, parts: [] }; const L = RU.legitOf('soc'), lost = Math.max(0, startN('soc') - mine('soc').length), b = bitter(['soc']).filter(([, g]) => g.id !== 'grimmus').length;
    if (L < 70) P0.push([`A weak throne: legitimacy ${Math.round(L)}%`, pct((70 - L) * 1.6)]); if (lost) P0.push([`Worlds lost since 753 (${lost} of ${startN('soc')})`, pct(lost / Math.max(1, startN('soc')) * 70)]); if (b) P0.push([`Bitter Houses with seats of their own (${b})`, 20 * b]);
    const a = RU.rulerOf('soc'); if (a && !a.council && /Magnus/.test(a.name)) P0.push(['The Ash Lord still lives', -40]); return { prog: clamp(P0.reduce((x, p) => x + p[1], 0), 0, 100), parts: P0 }; }
  if (k === 'moonlords') { if (!C.fac.rim.alive) return { prog: 0, parts: [] }; const sup = P.supportOf('rim'), L = RU.legitOf('rim'), lost = Math.max(0, startN('rim') - mine('rim').length);
    if (sup < 50) P0.push([`The council turns on the Sovereign: support ${Math.round(sup)}%`, pct((50 - sup) * 3)]); if (C.worlds.io.owner !== 'rim') P0.push(['Io is lost', 100]); if (L < 65) P0.push([`A weak throne: legitimacy ${Math.round(L)}%`, pct((65 - L) * 1.5)]); if (lost) P0.push([`Moons lost (${lost})`, 12 * lost]); if (t <= 20) P0.push(['Not before the twentieth week', -100]);
    return { prog: clamp(P0.reduce((x, p) => x + p[1], 0), 0, 100), parts: P0 }; }
  if (k === 'lysander') { const ly = cmdr('Lysander'); if (!ly || ly.owner !== 'rim' || !free(ly)) return { prog: 0, parts: [['Lysander au Lune is not at the court of Io', 0]] }; const b = bitter(['soc', 'rim']);
    P0.push([`Bitter Houses and Moon Lords (${b.length})`, 45 * b.length]); if (hostile('rim', 'rep')) P0.push(['The Rim at war', 10]); if (RU.legitOf('rim') < 50) P0.push(['A weak throne at Io', 15]); if (t <= 40) P0.push(['Not before the fortieth week', -100]);
    return { prog: clamp(P0.reduce((x, p) => x + p[1], 0), 0, 100), parts: P0 }; }
  if (k === 'ascomanni') { P0.push(['The second year of the war', pct(clamp((t - 30) * 5, 0, 100))]); const top = Math.max(...POW.map(strAll)); if (top > 30000) P0.push(['Great fleets draw the raiders’ eyes', 10]); return { prog: clamp(P0.reduce((x, p) => x + p[1], 0), 0, 100), parts: P0 }; }
  return { prog: 0, parts: [] };
}
// the meters for the UI: crises not yet come, and how close each is
export const crisisMeters = () => Object.keys(CRISES).filter(k => !(C.crisis && C.crisis[k])).map(k => ({ k, ...CRISES[k], ...crisisParts(k) })).filter(x => x.prog >= 25).sort((a, b) => b.prog - a.prog);
// a raiders' band, built up to a strength
function band(at, str, name) { const fl = fleet('neu', at, {}, name), mix = ['frigate', 'corsair', 'destroyer', 'frigate', 'corsair', 'torch', 'destroyer']; let i = 0; while (fleetStr(fl) < str && fl.ships.length < 36) fl.ships.push(newShip(mix[i++ % mix.length])); fl.raider = true; return fl; }
const seize = (w, tag) => { const old = w.owner; w.owner = 'neu'; w.siege = null; w.desig = 'none'; w.bq = []; w.sq = []; w.garrison = Math.max(2000, w.garrison); if (old !== 'neu') P.seatLost(old, w.id); EC.onCapture(w, 'neu', 40); if (tag) w.rebel = tag; return old; };
const FIRE = {
  divide: () => { const { who: f } = crisisParts('divide'); if (!f) return false; const X = C.crisis; X.divide = f; const rest = POW.filter(o => o !== f && C.fac[o].alive);
    for (const o of rest) { if (relOf(f, o) !== 'war') { setRel(f, o, 'war'); P.onWar(o, f); } for (const p of rest) if (p !== o) { setRel(o, p, 'ally'); for (const w of Object.values(C.worlds)) if (w.siege && ((w.siege.by === o && w.owner === p) || (w.siege.by === p && w.owner === o))) w.siege = null; } }
    note(`Realm Divide: ${BLOC_NAME[f]} has grown too great, and every other power now stands against it.`, f === C.player ? 'bad' : 'gold', CAPITAL[f], { title: 'Realm Divide', kind: 'war' }); return true; },
  ascomanni: () => { const top = Math.max(...POW.map(strAll)), AB = C.worlds.eris ? 'eris' : 'pluto', w = C.worlds[AB], X = C.crisis; // their seat: Eris, the Kuiper fortress, where the map has it
    X.ascomanni = { t: C.turn, waves: 0, target: top * .5, base: AB }; seize(w, 'asco'); w.asco = true; w.garrison = Math.max(7000, w.garrison); w.gun = Math.max(w.gun, 3); w.shield = Math.max(w.shield, 2);
    const host = band(AB, top * .2, 'Host of Volsung Fá'); host.host = true; const v = CM.makeCmdr('neu', { name: 'Volsung Fá', title: 'Warlord of the Ascomanni', rank: 3, talents: ['peerless', 'butcher', 'marshal'], colour: 'Obsidian', house: null }); CM.assign(v, host); X.ascomanni.warlord = v.id;
    note(`The Ascomanni have come out of the far dark beyond the Rim: Obsidian raiders under the warlord Volsung Fá. They have made ${AB === 'eris' ? 'Eris' : 'Pluto'} their seat, and their war bands fall on the trade lanes and the weak worlds. Kill the warlord, or take ${AB === 'eris' ? 'Eris' : 'Pluto'}, to end them.`, 'bad', AB, { title: 'The Ascomanni', kind: 'war' }); return true; },
  civilwar: () => { if (!C.fac.soc.alive) return false; const X = C.crisis; let G = P.groupsOf('soc').filter(g => g.id !== 'grimmus' && P.defOf('soc', g.id).seat).sort((a, b) => a.sat - b.sat); if (!G.length) return false;
    const g = G[0], D = P.defOf('soc', g.id), ws = mine('soc').filter(w => w.id !== CAPITAL.soc); X.civilwar = g.id;
    const take = ws.filter(w => w.id === D.seat).concat(ws.filter(w => w.id !== D.seat).slice(0, 1)); for (const w of take) seize(w, 'civil');
    const fls = C.fleets.filter(f => f.owner === 'soc').sort((a, b) => b.ships.length - a.ships.length); const big = fls[1] || fls[0];
    if (big && (take[0] || fls.length > 1)) { for (const a of C.agents || []) if (a.fleet === big.id) { a.state = 'idle'; a.fleet = null; } big.owner = 'neu'; big.name = `Loyalists of ${D.name}`; if (take[0]) { big.at = take[0].id; big.transit = null; } CM.relieve(big, true); }
    for (const c of C.cmdrs) if (c.owner === 'soc' && c.house === g.id && c.state === 'pool' && !RU.isRoyal(c)) c.state = 'dead';
    CQ.levyRebels(g.id); /* the House's levy goes over with it */
    g.sat = 40; note(`Civil war in the Society: ${D.name} raises its banner against ${RU.actingOf('soc') ? RU.actingOf('soc').name || 'the throne' : 'the throne'}${take.length ? ', and holds ' + take.map(w => nm(w.id)).join(' and ') : ''}.`, C.player === 'soc' ? 'bad' : 'gold', (take[0] && take[0].id) || 'venus', { title: 'The Society at war with itself', kind: 'war' }); return true; },
  moonlords: () => { if (!C.fac.rim.alive) return false; const X = C.crisis; const G = P.groupsOf('rim').filter(g => P.defOf('rim', g.id).seat && P.defOf('rim', g.id).seat !== CAPITAL.rim && C.worlds[P.defOf('rim', g.id).seat].owner === 'rim').sort((a, b) => a.sat - b.sat).slice(0, 2); if (!G.length) return false;
    X.moonlords = 'on'; for (const g of G) { seize(C.worlds[P.defOf('rim', g.id).seat], 'moon'); g.sat = 40; }
    note(`The third Moon Lord Rebellion: ${G.map(g => P.defOf('rim', g.id).name).join(' and ')} break with the Dominion and rule ${G.map(g => nm(P.defOf('rim', g.id).seat)).join(' and ')} alone.`, C.player === 'rim' ? 'bad' : 'gold', P.defOf('rim', G[0].id).seat, { title: 'The Moon Lords rebel', kind: 'revolt' }); return true; },
  lysander: () => { const ly = cmdr('Lysander'); if (!ly || ly.owner !== 'rim' || !free(ly)) return false; let G = bitter(['soc', 'rim']).slice(0, 3);
    if (!G.length) G = POW.filter(f => f !== 'rep' && C.fac[f].alive).flatMap(f => P.groupsOf(f).map(g => [f, g])).filter(([f, g]) => { const D = P.defOf(f, g.id); return D.seat && D.seat !== CAPITAL[f] && C.worlds[D.seat].owner === f; }).sort((a, b) => a[1].sat - b[1].sat).slice(0, 2);
    if (!G.length) return false; const X = C.crisis; X.lysander = { t: C.turn, worlds: [] };
    for (const [f, g] of G) { const w = C.worlds[P.defOf(f, g.id).seat]; seize(w, 'lysander'); X.lysander.worlds.push(w.id); g.sat = 40; }
    ly.owner = 'neu'; ly.house = null; ly.royal = null; ly.state = 'pool'; const avg = POW.filter(o => C.fac[o].alive).reduce((a, o) => a + strAll(o), 0) / 3; const host = band(X.lysander.worlds[0], avg * .3, 'The Concord of Lune'); host.raider = false; CM.assign(ly, host); X.lysander.cid = ly.id;
    note(`Lysander au Lune slips away from Io. ${G.map(([f, g]) => P.defOf(f, g.id).name).join(', ')} rise for him under the old banner of House Lune, and hold ${X.lysander.worlds.map(nm).join(', ')}.`, 'bad', X.lysander.worlds[0], { title: 'Lysander’s Concord', kind: 'revolt' }); return true; },
};
const CH = { divide: .5, civilwar: .2, moonlords: .15, lysander: .12, ascomanni: .04 };
function fire(k, why) { if (FIRE[k] && FIRE[k]()) { C.crisisT = C.crisisT || {}; C.crisisT[k] = C.turn; chron('crisis', `${CRISES[k].name}${why ? ' (' + why + ')' : ''}.`, null, null); return true; } return false; }
function crisisTick() {
  C.crisis = C.crisis || {}; const X = C.crisis;
  for (const k of Object.keys(CRISES)) if (!X[k] && crisisParts(k).prog >= 100 && rnd() < CH[k]) fire(k);
  // the crises of a realm run their course in thirty weeks; their wars and their losses stay
  for (const k of ['divide', 'civilwar', 'moonlords']) if (X[k] && X[k] !== true && C.turn - ((C.crisisT || {})[k] || 0) > 30) { X[k] = true; chron('crisis', `${CRISES[k].name} has run its course.`, null, null); }
  // the director: a frozen war gets a push
  if (C.turn > 50 && !activeCrises().length && (C.static || 0) >= 12 && !(X.directT > C.turn - 20)) {
    const L = Object.keys(CRISES).filter(k => !X[k]).map(k => [k, crisisParts(k).prog]).sort((a, b) => b[1] - a[1]);
    for (const [k] of L) if (fire(k, 'the war had stalled')) { X.directT = C.turn; X.directed = (X.directed || 0) + 1; C.static = 0; break; }
  }
  // the Ascomanni: waves scaled to the strongest power, a base to take, a warlord to kill
  if (X.ascomanni && X.ascomanni !== true) {
    const A = X.ascomanni, v = A.warlord && RU.cById(A.warlord), vDown = !v || v.state === 'dead' || v.state === 'captured', baseLost = C.worlds[A.base].owner !== 'neu';
    if (baseLost && !A.baseLost) { A.baseLost = true; const by = C.worlds[A.base].owner; if (C.fac[by]) { Object.assign(C.fac[by].res, { he: C.fac[by].res.he + 3000, rare: (C.fac[by].res.rare || 0) + 200 }); } C.worlds[A.base].asco = false; note(`${A.base === 'eris' ? 'Eris' : 'Pluto'} is taken: the Ascomanni seat falls to ${BLOC_NAME[by]}, with its hoard (+3,000 He-3, +200 rare metals).`, by === C.player ? 'good' : 'gold', A.base, { title: 'The Ascomanni base falls', kind: 'rain' }); chron('crisis', `${BLOC_NAME[by]} takes the Ascomanni base on Pluto.`, 'pluto', by); }
    if (vDown && !A.vDown) { A.vDown = true; note(`Volsung Fá is ${v && v.state === 'captured' ? 'in chains' : 'dead'}. Without the warlord, the Ascomanni war bands break apart.`, 'gold', A.base || 'pluto', { title: 'The warlord falls', kind: 'death' }); for (const f of C.fleets) if (f.raider && !f.host) f.ships = f.ships.slice(0, Math.ceil(f.ships.length / 3)); }
    if (!A.vDown && !A.baseLost && A.waves < 6 && (C.turn - A.t) % 8 === 4) { A.waves++; const at = pickOne(['ceres', 'jupiter', 'saturn', 'mars', 'uranus']); band(at, A.target / 3, `Ascomanni Raiders ${['I', 'II', 'III', 'IV', 'V', 'VI'][A.waves - 1]}`); note(`An Ascomanni war band falls on ${nm(at)}.`, 'bad', at); }
    if ((A.vDown && A.baseLost) || C.turn - A.t > 60 || (A.vDown && C.turn - A.t > 30)) { X.ascomanni = true; for (const f of C.fleets) if (f.raider) f.ships = []; C.fleets = C.fleets.filter(f => f.ships.length); note('The Ascomanni have gone back into the dark.', 'gold'); chron('crisis', 'The Ascomanni go back into the dark.', null, null); }
  }
  // raiders hunt the weakest worlds within reach; the warlord's host guards its base until the bands are out
  for (const fl of C.fleets) if (fl.raider && !fl.transit && fl.owner === 'neu') {
    const here = C.worlds[fl.at]; if (here && here.owner !== 'neu' && (fleetsAt(fl.at).some(o => o.owner !== 'neu') || here.siege)) continue;
    if (fl.host) { const A = X.ascomanni; if (!A || A === true) continue; const AB = A.base || 'pluto'; if (C.worlds[AB].siege || A.waves < 2) { if (fl.at !== AB && C.worlds[AB].owner === 'neu') moveFleet(fl, AB); continue; } }
    const str = fleetStr(fl); let best = null, bs = 0;
    for (const w of Object.values(C.worlds)) { if (w.owner === 'neu') continue; const d = defStr(w) + fleetsAt(w.id).filter(o => o.owner === w.owner).reduce((a, o) => a + fleetStr(o), 0), t = travel(fl.at, w.id); if (d > str * .8 || t > (fl.host ? 10 : 6)) continue; const sc = (EC.tradeOf(w) + 20) / (t + 1); if (sc > bs) { bs = sc; best = w.id; } }
    if (best && best !== fl.at) moveFleet(fl, best);
  }
  // Lysander's Concord ends with Lysander, or with his worlds
  if (X.lysander && X.lysander !== true) { const L = X.lysander, c = RU.cById(L.cid); if (!c || !free(c) || L.worlds.every(id => C.worlds[id].owner !== 'neu')) { X.lysander = true; note(`Lysander’s Concord is broken${c && c.state === 'captured' ? ': Lysander au Lune is a prisoner' : c && c.state === 'dead' ? ': Lysander au Lune is dead' : ''}.`, 'gold', null, { title: 'The Concord breaks', kind: 'death' }); chron('crisis', 'Lysander’s Concord is broken.', null, null); } }
}
export const activeCrises = () => Object.keys(CRISES).filter(k => C.crisis && C.crisis[k] && C.crisis[k] !== true);

// ---------------------------------------------------------------- the heroes' fates, and Iron Gold's turns of story
// The named heroes matter: their deaths and captures turn into cards with choices that reach into politics, loyalty
// and the war. The book's great beats are choices too, not only dates.
const lore = (c, n) => c && new RegExp(n).test(c.name || '');
const foeChamp = c => { const fl = C.fleets.find(x => x.id === c.fleet); if (!fl || !fl.at) return null; const L = C.cmdrs.filter(o => o.state === 'fleet' && hostile(o.owner, c.owner) && (o.talents || []).includes('peerless') && C.fleets.some(x => x.id === o.fleet && (x.at === fl.at || (x.transit && x.transit.to === fl.at)))); return L[0] || null; };
const groupSat = (f, ids, v) => { for (const g of P.groupsOf(f)) if (ids === '*' || ids.includes(g.id)) g.sat = clamp(g.sat + v, 0, 100); };
const cmdr = n => C.cmdrs.find(c => lore(c, n));
export function queueEvent(k, f, t) {
  if (!C.fac[f] || !C.fac[f].alive) return; const E = EVENTS[k];
  if (human(f)) (C.pendingEvents = C.pendingEvents || []).push({ k, f, t });
  else { const ai = typeof E.ai === 'function' ? E.ai(f, t) : E.ai, ok = E.choices.filter(c => affordable(f, c)); (ai != null && affordable(f, E.choices[ai]) ? E.choices[ai] : ok.length ? ok[0] : E.choices[E.choices.length - 1]).fx(f, t); }
}
const free = c => c && c.state !== 'dead' && c.state !== 'captured';
Object.assign(EVENTS, {
  reaper: { title: 'The Reaper is dead', kind: 'death', when: () => null, ai: 0,
    text: () => 'Darrow of Lykos, the Reaper, ArchImperator of the Republic, is dead. The fleets know. The worlds do not, yet. What the Republic is told will shape what it becomes.',
    choices: [
      { label: 'Make him a martyr', tip: 'Reds everywhere +15 · war weariness −15 · Vox Populi +10 · Golds −5', fx: f => { shockAll(f, 'red', 15); shockAll(f, 'gold', -5); C.weary[f] = Math.max(0, (C.weary[f] || 0) - 15); groupSat(f, ['vox'], 10); } },
      { label: 'Keep it secret', tip: 'Nothing now. In six weeks the truth may come out: the Senate −15, war weariness +10', fx: f => { C.secrets = C.secrets || []; C.secrets.push({ f, k: 'reaper', at: C.turn + 6 }); } } ] },
  goblin: { title: 'The Goblin falls', kind: 'death', when: () => null, ai: 0,
    text: () => 'Sevro au Barca is dead. The Howlers have painted their faces black, and they are asking for blood.',
    choices: [
      { label: 'Give the Howlers their vengeance', tip: 'Every Republic commander +40 experience · Reds +5 · war weariness −5', fx: f => { for (const c of C.cmdrs) if (c.owner === f && c.state === 'fleet') CM.gainXp(c, 40); shockAll(f, 'red', 5); C.weary[f] = Math.max(0, (C.weary[f] || 0) - 5); } },
      { label: 'Bury him on Mars', tip: 'Every estate on Mars +12 · the Vox Populi +5', fx: f => { const w = C.worlds.mars; if (w && w.owner === f && w.cl) for (const e in w.cl) shock(w, e, 12); groupSat(f, ['vox'], 5); } } ] },
  chains: { title: 'A Prisoner of War', kind: 'war', when: () => null, ai: 1,
    text: (f, c) => `${c.name}, ${c.title || 'one of our commanders'}, is a prisoner of ${BLOC_NAME[c.captor]}. The officers are watching what we do.`,
    choices: [
      { label: 'Bring them home', tip: 'A mission: take a world from their captor, or win back their freedom, within 16 weeks', fx: (f, c) => { const own0 = new Set(Object.values(C.worlds).filter(w => w.owner === c.captor).map(w => w.id)); addMission(f, { k: 'home', cid: c.id, own0: [...own0], text: `Bring ${c.name} home within 16 weeks`, giver: null, left: 16, reward: { inf: 30 } }); } },
      { cost: { he: 1500 }, label: 'Pay what they ask', tip: '−1,500 He-3 · they come home now · Golds −4 (we pay our enemies)', fx: (f, c) => { C.fac[f].res.he -= 1500; c.state = 'pool'; c.captor = null; shockAll(f, 'gold', -4); } },
      { label: 'Leave them', tip: 'Nothing changes. The officer corps remembers', fx: f => { for (const c of C.cmdrs) if (c.owner === f && c.state !== 'dead' && !RU.isRoyal(c)) CM.grieve(c, 'A comrade left in chains', -5); } } ] },
  succession: { title: 'The throne of the Remnant is empty', kind: 'death', when: () => null, ai: f => free(cmdr('Ajax')) && cmdr('Ajax').owner === f && (P.groupsOf(f).find(g => g.id === 'grimmus') || { sat: 50 }).sat >= 35 ? 0 : 1,
    text: () => `${free(cmdr('Ajax')) ? 'The Dictator is lost to the Remnant. Her brother Ajax, the Storm Knight, claims her place; the' : 'The Dictator is lost to the Remnant, and no Grimmus is free to claim her place. The'} great Houses of Venus would sooner choose for themselves.`,
    choices: [
      { label: 'Ajax takes his sister’s place', tip: 'Ajax rules: Reckless and Valiant; the Remnant will make war his way · House Grimmus +10, Carthii and Saud −10 · war weariness −10', fx: f => { if (!RU.crownBy(f, 'Ajax', 'the Storm Knight claims his sister’s place', 48)) RU.crownCouncil(f, 'no Grimmus is free to rule', 40); groupSat(f, ['grimmus'], 10); groupSat(f, ['carthii', 'saud'], -10); C.weary[f] = Math.max(0, (C.weary[f] || 0) - 10); C.events.ashLord = C.events.ashLord || 'succession'; } },
      { label: 'The Houses choose', tip: 'The Council of Houses rules: Divided, it fortifies and sues for peace early · House Carthii +15, Grimmus −20 · Golds everywhere −6 · a civil war comes closer', fx: f => { RU.crownCouncil(f, 'the Houses choose', 40); groupSat(f, ['carthii'], 15); groupSat(f, ['grimmus'], -20); shockAll(f, 'gold', -6); C.events.ashLord = true; } } ] },
  trial: { title: 'A ruler in chains', kind: 'war', when: () => null, ai: 0,
    text: (f, c) => `${c.name}, ${c.title || 'of ' + BLOC_NAME[c.owner]}, is in a cell beneath ${nm(CAPITAL[f])}. ${P.bodyName(f)[0].toUpperCase() + P.bodyName(f).slice(1)}, the people and the throne each want something different of the prisoner. While we hold them, the war score leans our way.`,
    choices: [
      { label: 'Hold a trial', tip: 'Every group at court +8 · +40 influence · the prisoner stays ours: a great ransom, or a price in any peace', fx: f => { groupSat(f, '*', 8); C.fac[f].res.inf += 40; } },
      { label: 'Execute the prisoner', tip: 'Reds +8 · our cautious groups −10 · their realm swears vengeance (their opinion of us −50), but their throne passes', fx: (f, c) => { if (c.state === 'captured' && c.captor === f) { P.execute(f, c.id); shockAll(f, 'red', 8); groupSat(f, ['mod', 'saud', 'norvo'], -10); shockAll(c.owner, 'gold', 10); note(`${c.name} is executed on ${nm(CAPITAL[f])}.`, 'gold', null, { title: `${c.name} is dead`, kind: 'death' }); } } },
      { label: 'Ransom them back', tip: '+3,000 He-3 · they return to rule · their opinion of us +15 · Reds −10', fx: (f, c) => { if (c.state === 'captured' && c.captor === f) { RU.freed(c); C.fac[f].res.he += 3000; if (C.fac[c.owner]) C.fac[c.owner].res.he = Math.max(0, C.fac[c.owner].res.he - 3000); P.addOpinion(c.owner, f, 'prisoners', 'Returned our ruler', 15, .2); shockAll(f, 'red', -10); } } } ] },
  rimSuccession: { title: 'The Sovereign of the Rim is dead', kind: 'death', when: () => null, ai: f => (P.groupsOf(f).find(g => g.id === 'lux') || { sat: 50 }).sat > 55 ? 0 : 1,
    text: () => 'Romulus au Raa is dead. His widow Dido au Raa, born of House Saud, means to take his throne and check the Republic; his son Diomedes, the Storm Knight of the Rim, would keep his father’s honour and his peace. The council will follow whoever you name.',
    choices: [
      { label: 'Dido au Raa rules', tip: 'Dido: Hawk and Cunning; the Rim will run dark and settle grudges · House Lux and Callisto +8 · Norvo −6', fx: f => { if (!RU.crownBy(f, 'Dido', 'Dido au Raa takes her husband’s throne', 52)) RU.crownBy(f, 'Diomedes', 'the heir of Io', 60) || RU.crownCouncil(f, 'the council rules', 40); groupSat(f, ['lux', 'callisto'], 8); groupSat(f, ['norvo'], -6); } },
      { label: 'Diomedes au Raa rules', tip: 'Diomedes: Honour-bound and Valiant; he keeps his word and his truces · House Raa +8, Norvo +4 · Lux −4', fx: f => { if (!RU.crownBy(f, 'Diomedes', 'the heir of Io', 60)) RU.crownBy(f, 'Dido', 'Dido au Raa takes her husband’s throne', 52) || RU.crownCouncil(f, 'the council rules', 40); groupSat(f, ['raa'], 8); groupSat(f, ['norvo'], 4); groupSat(f, ['lux'], -4); } } ] },
  demand: { title: 'An officer demands a fleet', kind: 'war', when: () => null, ai: 0,
    text: (f, c) => `${c.name}, ${CM.RANK[c.rank]}${CM.houseName(c) ? ', of ' + CM.houseName(c) : ''}, has waited ashore long enough. Their loyalty is ${Math.round(c.loyalty)}%: they demand a command worthy of their rank, and their House is listening.`,
    choices: [
      { label: 'Give them the largest fleet', tip: 'They take command of your largest fleet without a commander, or one led by a lower rank · their loyalty rises', fx: (f, c) => { const fl = C.fleets.filter(x => x.owner === f && !x.transit && !x.engage && x.ships.length > 3 && (!CM.cmdrOf(x) || CM.cmdrOf(x).rank < c.rank)).sort((a, b) => b.ships.length - a.ships.length)[0]; if (fl && !CM.assign(c, fl)) { CM.grieve(c, 'Given the command demanded', 8); note(`${c.name} takes command of ${fl.name}.`, 'good', fl.at); } else { CM.grieve(c, 'Promised a fleet that never came', -8); note(`There is no fleet for ${c.name} to command.`, 'bad'); } } },
      { label: 'Refuse', tip: 'Their loyalty −12 · their House −4 · a disloyal officer may defect', fx: (f, c) => { CM.grieve(c, 'Refused a command', -12); if (c.house) P.nudge(f, c.house, -4); } } ] },
  minotaur: { title: 'The Minotaur’s Offer', kind: 'war', ai: 1, cd: 99, once: true,
    when: f => f === 'rep' && C.turn >= 8 && C.turn <= 40 && !C.events.ashLord && C.fac.soc.alive && C.worlds.venus.owner === 'soc' && cmdr('Darrow') && ['fleet', 'pool'].includes(cmdr('Darrow').state) ? true : null,
    text: () => 'Apollonius au Valii-Rath, the Minotaur, rots in a cell on Luna. He sends word: he knows a way into the Ash Lord’s citadel on Venus, and he wants out. With him, Darrow could end Magnus au Grimmus himself.',
    choices: [
      { label: 'Take the Minotaur’s way in', tip: 'A mission: Darrow’s fleet in orbit of Venus within 12 weeks. Success: the Ash Lord dies now, the Remnant reels. Failure: Darrow may be taken', fx: f => { addMission(f, { k: 'minotaur', text: 'Burn the Ash Lord: Darrow’s fleet in orbit of Venus within 12 weeks', left: 12, reward: { inf: 40 }, quest: f === C.player ? 'minotaur' : null, qw: 'venus' }); } },
      { label: 'Leave him to rot', tip: 'The Vox Populi +5 · nothing else', fx: f => groupSat(f, ['vox'], 5) } ] },
  romulus: { title: 'The Trial of Romulus', kind: 'alliance', ai: 0, cd: 99, once: true,
    when: f => f === 'rim' && C.turn > 15 && !C.events.romulus && P.supportOf('rim') < 40 && free(cmdr('Romulus')) && RU.rulerOf('rim') === cmdr('Romulus') ? true : null,
    text: () => 'The Moon Lords have turned on their Sovereign. Helios au Lux charges Romulus au Raa with treason before the council for the peace he kept with the Republic. Romulus will not run.',
    choices: [
      { label: 'Romulus stands his trial', tip: 'Romulus dies by his own hand: Dido au Raa rules · every Moon Lord +12 · the Rim’s alarm at the Republic +25', fx: f => { C.events.romulus = 'dead'; const r = cmdr('Romulus'); if (free(r)) { C.events.rimHeir = 'Dido'; CM.kill(r, null, 'Romulus au Raa is dead by his own hand.', { title: 'The Sovereign is dead', kind: 'death' }); } groupSat(f, '*', 12); C.alarm = clamp((C.alarm || 0) + 25, 0, 100); } },
      { label: 'Dissolve the council', tip: 'House Raa +10 · every other Moon Lord −20 · legitimacy −15 · a rebellion comes closer', fx: f => { C.events.romulus = 'defied'; for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (g.id === 'raa' ? 10 : -20), 0, 100); if (C.rulers) C.rulers[f].legit = Math.max(0, C.rulers[f].legit - 15); } } ] },
  envoy: { title: 'A Republic Envoy at Io', kind: 'alliance', cd: 30, once: true,
    when: f => f === 'rim' && C.turn >= 3 && C.turn <= 25 && relOf('rim', 'rep') === 'peace' ? true : null,
    text: () => 'An envoy of the Sovereign has come to Io under a flag of peace. She brings the Republic’s word that it wants no war with the Rim, and the Moon Lords watch to see how she is received.',
    choices: [
      { label: 'Receive her with honour', tip: 'The Rim’s alarm −12 · House Raa and Norvo +6 · House Lux −6', fx: f => { C.alarm = clamp((C.alarm || 0) - 12, 0, 100); for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (['raa', 'norvo'].includes(g.id) ? 6 : g.id === 'lux' ? -6 : 0), 0, 100); P.addOpinion('rep', 'rim', 'envoy', 'Received our envoy with honour', 10, .2); } },
      { label: 'Send her home', tip: 'The Rim’s alarm +10 · House Lux and Callisto +6 · House Norvo −4', fx: f => { C.alarm = clamp((C.alarm || 0) + 10, 0, 100); for (const g of P.groupsOf(f)) g.sat = clamp(g.sat + (['lux', 'callisto'].includes(g.id) ? 6 : g.id === 'norvo' ? -4 : 0), 0, 100); P.addOpinion('rep', 'rim', 'envoy', 'Sent our envoy home', -10, .2); } } ] },
  pickets: { title: 'Pickets in the Belt', kind: 'war', cd: 30, once: true,
    when: f => f === 'rim' && C.turn >= 8 && C.turn <= 40 && relOf('rim', 'rep') === 'peace' ? true : null,
    text: () => 'A Republic picket fleet has stopped a Rim freighter in the Belt and searched it. The Moon Lords demand an answer.',
    choices: [
      { label: 'Protest in the strongest terms', tip: '+15 influence · the Rim’s alarm +8', fx: f => { C.fac[f].res.inf += 15; C.alarm = clamp((C.alarm || 0) + 8, 0, 100); P.addOpinion('rim', 'rep', 'search', 'Searched our freighters', -8, .2); } },
      { label: 'Let it pass', tip: 'House Lux −8 · House Norvo +4', fx: f => groupSat(f, ['lux'], -8) },
      { label: 'Escort our freighters', tip: 'The Rim’s alarm +15 · House Lux and Codovan +8 · −300 He-3', cost: { he: 300 }, fx: f => { C.fac[f].res.he -= 300; C.alarm = clamp((C.alarm || 0) + 15, 0, 100); groupSat(f, ['lux', 'codovan'], 8); } } ] },
});
// the Ash Lord's end: slain in Darrow's raid, taken when Venus falls, or dead of his long sickness (camp.js, week 45)
export function ashLordFalls(how) {
  if (C.events.ashLord) return; C.events.ashLord = how;
  const m = cmdr('Magnus'), ev = { title: how === 'raid' ? 'The Ash Lord burns' : 'The Ash Lord is dead', kind: 'death' };
  const msg = how === 'raid' ? 'Darrow, Sevro and the Minotaur burn the Ash Lord in his citadel on Venus.' : 'Venus has fallen, and the Ash Lord with it: Magnus au Grimmus dies as the Republic takes his citadel.';
  if (m && m.state !== 'dead') CM.kill(m, null, msg, ev); else note(msg, 'gold', 'venus', ev);
  shockAll('soc', 'gold', -10); groupSat('soc', ['grimmus'], 12); C.alarm = clamp((C.alarm || 0) + 15, 0, 100);
  if (how === 'raid') shockAll('rep', 'red', 5);
}
// the heroes' fates (registered once, at the first campaign: see command.js)
let fateOn = false;
function onFate(k, c, by) {
  if (lore(c, 'Darrow') && k === 'kill') queueEvent('reaper', c.owner);
  if (lore(c, 'Sevro') && k === 'kill') queueEvent('goblin', c.owner);
  if (k === 'capture' && RU.isRoyal(c) && ['rep', 'soc', 'rim'].includes(by)) queueEvent('trial', by, c);
  if (k === 'capture' && c.owner === C.player && c.lore && !RU.isRoyal(c)) queueEvent('chains', c.owner, c);
}
// secrets that come out; the Ash Lord when Venus falls; the enemy fleet bound for our capital
function storyTick() {
  // secrets that come out: a hidden death, a blackmailed officer
  for (const s of (C.secrets || []).filter(x => x.at <= C.turn)) { C.secrets = C.secrets.filter(x => x !== s);
    if (s.k === 'reaper' && rnd() < .6) { groupSat(s.f, '*', -15); C.weary[s.f] = (C.weary[s.f] || 0) + 10; note('The truth is out: the Reaper is dead, and the government hid it. The Senate is in uproar.', s.f === C.player ? 'bad' : '', null, s.f === C.player ? { title: 'The lie is out', kind: 'revolt' } : null); }
    if (s.k === 'blackmail') { const c = RU.cById(s.cid); if (c && c.owner === s.f && c.turnTo === s.by && rnd() < .45) { c.turnTo = null; CM.grieve(c, 'The throne stood by them when the blackmail came out', 10); P.addOpinion(s.f, s.by, 'spy', 'Blackmailed our officers', -25, .3); note(`Blackmail exposed: agents of ${BLOC_NAME[s.by]} had a hold over ${c.name}. The throne stands by them.`, s.f === C.player ? 'gold' : s.by === C.player ? 'bad' : '', null); } } }
  if (!C.events.ashLord && C.turn > 2 && C.fac.soc.alive && C.worlds.venus.owner !== 'soc') ashLordFalls('fall');
  const me = C.player; C.warned = C.warned || {};
  for (const fl of C.fleets) { if (!fl.transit || fl.transit.retreat || !hostile(me, fl.owner)) continue; const to = fl.transit.to, w = C.worlds[to]; if (!w || w.owner !== me || !(to === CAPITAL[me] || w.lv.yard >= 2)) continue;
    const key = fl.id + ':' + to + ':' + fl.transit.total; if (C.warned[key] || IN.levelOf(me, fl) < 1) continue; C.warned[key] = true;
    const tracked = IN.levelOf(me, fl) === 2, n = fl.transit.left;
    note(`${tracked ? fl.name + ' (' + BLOC_NAME[fl.owner] + ')' : 'An enemy fleet'} is bound for ${nm(to)}: it arrives in about ${n} week${n === 1 ? '' : 's'}.${to === CAPITAL[me] ? ' The capital is the target.' : ''}`, 'bad', to, to === CAPITAL[me] ? { title: 'The enemy is coming', kind: 'war' } : null); }
}
// missions given by someone: a Senate bloc, a House, a Moon Lord. They pay in favour as well as goods, and failing them costs
const GIVERS = { rep: { conquer: 'sov', siege: 'mod', foundry: 'mod', calm: 'vox', fleet: 'sov', spare: 'vox', hold: 'mod' }, soc: { conquer: 'grimmus', siege: 'votum', foundry: 'carthii', calm: 'saud', fleet: 'grimmus', spare: 'saud', hold: 'carthii' }, rim: { conquer: 'lux', siege: 'codovan', foundry: 'codovan', calm: 'norvo', fleet: 'lux', spare: 'norvo', hold: 'raa' } };
export function addMission(f, m) { C.missions = C.missions || {}; const L = C.missions[f] = C.missions[f] || []; m.id = 'm' + (mid++); m.mission = true; m.f = f; bindMission(m); L.push(m); note(`New mission: ${m.giver ? giverName(f, m.giver) + ' ask: ' : ''}${m.text}.`, 'gold'); }
const giverName = (f, id) => { const g = P.groupsOf(f).find(x => x.id === id); return g ? (P.defOf(f, id).name || id) : ''; };
export function setupStory() { if (!fateOn) { CM.FATE.push(onFate); fateOn = true; } C.sit = {}; C.missions = {}; C.crisis = {}; C.pendingEvents = []; C.evLast = {}; C.startN = Object.fromEntries(['rep', 'soc', 'rim'].map(f => [f, mine(f).length])); }
export function tick() { eventTick(); sitTick(); missionTick(); crisisTick(); storyTick(); }
