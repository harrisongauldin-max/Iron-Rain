// Planet maps M2b: fit the planet war's auto-resolve to the fought province battles (claude/planet-maps.md).
//   node tests/planet_fit.mjs run [--seeds 3] [--from 1] [--part 0/2] [--mode field|drop] [--out /tmp/fit.jsonl] [--types ladon,tyche] [--ratios .7,1,1.4]
//       fights province battles headless with ground.js, each at a ratio of men (the side coming to take the
//       province against the holder), with both sides' quality at 1, and writes one JSON line per battle
//   node tests/planet_fit.mjs fit file.jsonl [...]
//       fits the logistic the auto-resolve uses: P(taker wins) = 1 / (1 + exp(-(ln(ratio) - ln(H_type)) / s)),
//       with one holder factor H for each kind of province and one slope s; and the losses (winner, loser)
//   node tests/planet_fit.mjs check file.jsonl [...]
//       compares the fought results with what planetwar.js's auto-resolve says now: pooled and by province
import { readFileSync, appendFileSync } from 'fs';
import * as PW from '../js/planetwar.js';

const argv = process.argv.slice(2), cmd = argv[0];
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : d; };
const TYPES = { // the province, and the Fortress level that sets its walls
  ladon: ['ladon', 0], jungles: ['jungles', 0], highlands: ['highlands', 0], keryx: ['keryx', 0], heliopolis: ['heliopolis', 0], tyche: ['tyche', 0], 'heliopolis-w1': ['heliopolis', 2] };
const HOLD = 1500; // the holder's troops (15,000 men on the field)

// taker 'att': the legions come to take a province the garrison holds (the usual case); 'def': the garrison comes to
// take back a province the legions hold (no starShells on its side)
function battle(type, ratio, mode, taker = 'att') {
  const [prov, fort] = TYPES[type];
  const war = PW.newWar({ world: 'mercury', by: 'rep', def: 'soc', troops: 0, garrison: 0, fort, gun: 0, shield: 0, barracks: 0, loyalty: 50 });
  war.attQ = 1; war.defQ = 1; // the field is fitted alone: the qualities it doesn't model are multiplied in on both paths
  const hold = taker === 'att' ? 'def' : 'att'; war.provs[prov].own = hold;
  war.armies = [{ id: 9001, side: hold, prov, men: HOLD, cmdrs: [] }, { id: 9002, side: taker, prov, men: Math.round(HOLD * ratio), cmdrs: [] }];
  war.pending = [{ prov, kind: mode === 'drop' ? 'landing' : 'field' }];
  return { war, prov };
}

if (cmd === 'run') {
  const { runHeadless } = await import('../js/ground.js');
  const seeds = +arg('seeds', 3), [pi, pn] = arg('part', '0/1').split('/').map(Number), mode = arg('mode', 'field'), out = arg('out', '/tmp/planet_fit.jsonl');
  const types = arg('types', Object.keys(TYPES).join(',')).split(','), ratios = arg('ratios', '.7,1,1.4,2,2.8,4').split(',').map(Number);
  let k = 0;
  const from = +arg('from', 1); // a check on fresh seeds: --from 4
  for (const type of types) for (const ratio of ratios) for (let seed = from; seed < from + seeds; seed++) {
    if (k++ % pn !== pi) continue;
    const taker = arg('taker', 'att'), { war, prov } = battle(type, ratio, mode, taker), spec = PW.battleSpec(war, prov), t0 = Date.now();
    const r = runHeadless(spec, seed * 101 + Math.round(ratio * 10));
    const row = { type, ratio, seed, mode, taker, won: r.won, lf: 1 - r.attLeft / Math.max(1, r.att0), lh: 1 - r.defLeft / Math.max(1, r.def0), t: Math.round(r.t), why: r.why, ms: Date.now() - t0 };
    appendFileSync(out, JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
  }
} else {
  const rows = argv.slice(1).filter(f => !f.startsWith('--')).flatMap(f => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)));
  const types = [...new Set(rows.map(r => r.type))];
  if (cmd === 'fit') {
    // maximum likelihood on a grid: s, then each holder factor
    const ll = (s, H) => rows.reduce((a, r) => { const p = 1 / (1 + Math.exp(-(Math.log(r.ratio) - Math.log(H[r.type])) / s)), q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return a + (r.won ? Math.log(q) : Math.log(1 - q)); }, 0);
    let best = null;
    for (let s = .1; s <= .8; s += .02) { const H = {}; for (const t of types) { let bh = 1, bl = -Infinity; for (let h = .4; h <= 6; h *= 1.02) { const L = rows.filter(r => r.type === t).reduce((a, r) => { const p = 1 / (1 + Math.exp(-(Math.log(r.ratio) - Math.log(h)) / s)), q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return a + (r.won ? Math.log(q) : Math.log(1 - q)); }, 0); if (L > bl) { bl = L; bh = h; } } H[t] = bh; }
      const L = ll(s, H); if (!best || L > best.L) best = { s, H, L }; }
    console.log(`battles ${rows.length}; slope s = ${best.s.toFixed(2)}; log-likelihood ${best.L.toFixed(1)}`);
    for (const t of types) { const R = rows.filter(r => r.type === t); console.log(`  ${t.padEnd(14)} holder factor ${best.H[t].toFixed(2)}   (${R.length} battles; taker won ${R.filter(r => r.won).length})`); }
    // losses: winner and loser, against the power ratio (winner / loser), in the shape fight() uses
    const L = rows.map(r => { const pw = r.won ? r.ratio / best.H[r.type] : best.H[r.type] / r.ratio; return { k: 1 / pw, lw: r.won ? r.lf : r.lh, ll: r.won ? r.lh : r.lf }; });
    const lossW = L.reduce((a, x) => a + x.lw, 0) / L.reduce((a, x) => a + x.k, 0), lossL = L.reduce((a, x) => a + (x.ll - .1 * x.k), 0) / L.length;
    console.log(`  losses: winner ≈ ${lossW.toFixed(2)} × (loser's power / winner's), loser ≈ ${lossL.toFixed(2)} + .1 × that (means: winner ${(L.reduce((a, x) => a + x.lw, 0) / L.length).toFixed(2)}, loser ${(L.reduce((a, x) => a + x.ll, 0) / L.length).toFixed(2)})`);
  } else if (cmd === 'check') {
    // what the auto-resolve says for each battle now, against what the field did
    let sumP = 0, sumW = 0; const by = {};
    for (const r of rows) { const { war, prov } = battle(r.type, r.ratio, r.mode, r.taker), p = r.taker === 'def' ? 1 - PW.oddsAt(war, prov) : PW.oddsAt(war, prov); sumP += p; sumW += r.won ? 1 : 0; const b = by[r.type] = by[r.type] || { p: 0, w: 0, n: 0 }; b.p += p; b.w += r.won ? 1 : 0; b.n++; }
    const se = Math.sqrt(rows.reduce((a, r) => { const { war, prov } = battle(r.type, r.ratio, r.mode, r.taker), p = r.taker === 'def' ? 1 - PW.oddsAt(war, prov) : PW.oddsAt(war, prov); return a + p * (1 - p); }, 0)) / rows.length;
    console.log(`battles ${rows.length}: the field's takers won ${(100 * sumW / rows.length).toFixed(1)}%, the auto-resolve expects ${(100 * sumP / rows.length).toFixed(1)}% (±${(100 * se * 2).toFixed(1)} at 2 sd)`);
    for (const t in by) console.log(`  ${t.padEnd(14)} field ${(100 * by[t].w / by[t].n).toFixed(0).padStart(3)}%   auto ${(100 * by[t].p / by[t].n).toFixed(0).padStart(3)}%   (${by[t].n})`);
    const bins = [[0, .25], [.25, .5], [.5, .75], [.75, 1.01]];
    for (const [a, b] of bins) { const R = rows.filter(r => { const { war, prov } = battle(r.type, r.ratio, r.mode, r.taker), p = r.taker === 'def' ? 1 - PW.oddsAt(war, prov) : PW.oddsAt(war, prov); r.p = p; return p >= a && p < b; }); if (R.length) console.log(`  auto ${Math.round(a * 100)}–${Math.round(Math.min(1, b) * 100)}%: field ${(100 * R.filter(r => r.won).length / R.length).toFixed(0)}%, auto ${(100 * R.reduce((x, r) => x + r.p, 0) / R.length).toFixed(0)}% (${R.length})`); }
  }
}
