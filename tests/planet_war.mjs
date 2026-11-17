// Planet wars, played headless (ground battles chat; claude/planet-maps.md).
// Plays whole wars for Mercury in week 1 of the Republic campaign (8,072 troops against a garrison of 5,720, Fortress 0,
// one gun, no shield, barracks 1), with the stand-in commanders on both sides, under several landing plans; checks the
// targets: the AI's own plan wins 55–80%, plans give different results, and a war lasts about 3–8 weeks.
//   node tests/planet_war.mjs [--seeds 400] [--troops 8072] [--garrison 5720] [--fort 0] [--gun 1] [--shield 0] [--def 1.15]
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const PW = await import(pathToFileURL(path.join(here, '../js/planetwar.js')).href);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; };
if (process.argv.includes('--def')) PW.TUNE.def = arg('def', PW.TUNE.def);
const seeds = arg('seeds', 400), T = arg('troops', 8072), G = arg('garrison', 5720);
const spec = { world: 'mercury', by: 'rep', def: 'soc', troops: T, garrison: G, fort: arg('fort', 0), gun: arg('gun', 1), shield: arg('shield', 0), barracks: arg('barracks', 1), loyalty: arg('loyalty', 50) };
const rng = s => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const PLANS = {
  'all on Heliopolis': [['heliopolis', 1]],
  'all on Tyche': [['tyche', 1]],
  'Ladon and the highlands': [['ladon', .5], ['highlands', .5]],
  'four zones': [['ladon', .25], ['highlands', .25], ['jungles', .25], ['keryx', .25]],
  'Heliopolis and Ladon': [['heliopolis', .6], ['ladon', .4]],
  'far side first': [['borw', .6], ['bore', .4]],
};
// the legate's plan: suggestPlan's best (decision 10: it must win 55–80%; it's the plan the computer's Rain and the
// player's "Legate's plan" button both use)
const LEG = PW.suggestPlan(spec); PLANS["the legate's plan (" + LEG.map(x => x.prov).join(' + ') + ')'] = LEG.map(x => [x.prov, x.troops / T]);
export const AI_PLAN = Object.keys(PLANS).at(-1);
const out = {};
for (const [name, shares] of Object.entries(PLANS)) {
  let won = 0, weeks = 0, n = 0, lost = 0, maxW = 0;
  for (let s = 1; s <= seeds; s++) {
    const rnd = rng(s * 7919 + 13), war = PW.newWar(spec);
    PW.land(war, shares.map(([prov, k]) => ({ prov, troops: Math.round(T * k) })), rnd);
    while (!war.over && war.week < 40) PW.weekTick(war, { ai: { att: PW.standIn, def: PW.standIn }, rnd });
    const o = war.over || { won: 'def', week: 40 };
    if (o.won === 'att') won++; weeks += o.week; n++; maxW = Math.max(maxW, o.week); lost += war.land0 - PW.menOf(war, 'att');
  }
  out[name] = { win: won / n, weeks: weeks / n, maxW, attLost: Math.round(lost / n) };
  console.log(`${name.padEnd(26)} attacker wins ${(won / n * 100).toFixed(0).padStart(3)}%  mean ${(weeks / n).toFixed(1)} weeks (max ${maxW})  troops lost ${Math.round(lost / n)}`);
}
// M2b: what the levies (decision 7) and a commander (decision 6) do to the AI's plan, and the fought-battle path
{ let lev = 0, wonC = 0; const C = { id: 'c', name: 'A Praetor', ar: 1.12, t: ['tactician'] };
  for (let s = 1; s <= seeds; s++) { const rnd = rng(s * 7919 + 13), war = PW.newWar(spec), sh = PLANS[AI_PLAN];
    PW.land(war, sh.map(([prov, k], i) => ({ prov, troops: Math.round(T * k), cmdrs: i === 0 ? [C] : [] })), rnd);
    while (!war.over && war.week < 40) PW.weekTick(war, { ai: { att: PW.standIn, def: PW.standIn }, rnd });
    if (war.over && war.over.won === 'att') wonC++; lev += war.levied; }
  console.log(`\nwith a commander (+12% strength) on the main landing: ${(wonC / seeds * 100).toFixed(0)}% (without: ${(out[AI_PLAN].win * 100).toFixed(0)}%); levies raised, mean ${Math.round(lev / seeds)} troops a war`);
  // the steps of a week, with one battle settled from a (made-up) fought result: the verdict must land on the map
  const war = PW.newWar(spec); PW.land(war, [{ prov: 'ladon', troops: 3000 }], rng(5), { defer: true });
  const p0 = war.pending.length, sp = PW.battleSpec(war, 'ladon');
  PW.settle(war, 'ladon', { won: true, att0: sp.att.total, attLeft: sp.att.total * .8, def0: sp.def.men, defLeft: sp.def.men * .1 });
  const fine = p0 === 1 && !war.pending.length && war.provs.ladon.own === 'att' && Math.abs(PW.menOf(war, 'att') - 2400) < 2 && sp.mode === 'drop' && sp.att.total === Math.round(3000 * 10 * war.attQ);
  console.log(`a deferred landing, settled from a fought result: ${fine ? 'ok' : 'WRONG'} (pending ${p0}, Ladon ${war.provs.ladon.own}, legions ${PW.menOf(war, 'att')})`);
  if (!fine) process.exitCode = 1; }
const ai = out[AI_PLAN].win, wins = Object.values(out).map(o => o.win), spread = Math.max(...wins) - Math.min(...wins), wk = out[AI_PLAN].weeks;
const ok = ai >= .55 && ai <= .8 && spread >= .15 && wk >= 3 && wk <= 8;
console.log(`\n${AI_PLAN}: ${(ai * 100).toFixed(0)}% in ${wk.toFixed(1)} weeks; plans range ${(spread * 100).toFixed(0)} points.  ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok && !process.exitCode ? 0 : 1);
