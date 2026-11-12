// Ground-battle AI bench: whole battles headless in Node (js/ground.js needs no browser), the AI on both sides.
//   node tests/ground_ai.mjs [--seeds 8] [--old path/to/ground.js] [--only name]
// Each scenario is fought four ways: old AI on both sides (OO), new on both (NN), new attacker against the old
// defender (NO) and old attacker against the new defender (ON). The old AI is the AI section of another ground.js
// (default: main's, from git), grafted onto this one, so the rules are the same and only the commanders differ.
// A stronger attacker AI wins more often in NO than in OO; a stronger defender AI wins more often in ON than in OO.
// NN against OO shows whether the balance the campaign was tuned for (GROUND_FIELD in camp.js) has moved.
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = +arg('seeds', 8), ONLY = arg('only', null), ONLYM = arg('modes', null), DK = +arg('defk', 1); // --modes OO,NN; --defk scales every garrison
const NEW = readFileSync(join(ROOT, 'js/ground.js'), 'utf8');
const OLD = arg('old', null) ? readFileSync(arg('old'), 'utf8') : execSync('git show main:js/ground.js', { cwd: ROOT, encoding: 'utf8' });

// the AI section of a ground.js: from its heading to the headless runner
const A0 = '// ---------------------------------------------------------------- the AI', A1 = '// ---------------------------------------------------------------- a whole battle, headless';
const section = src => { const i = src.indexOf(A0), j = src.indexOf(A1); if (i < 0 || j < 0) throw new Error('AI section not found'); return src.slice(i, j); };
// every name the old section defines at its top level gets a suffix, so it can sit beside the new one
function graft(src) {
  let s = section(src); const names = new Set();
  for (const m of s.matchAll(/^(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm)) names.add(m[1] || m[2]);
  for (const m of s.matchAll(/^const\s+([^;=]+?);/gm)) for (const n of m[1].split(',')) { const k = n.split('=')[0].trim(); if (/^\w+$/.test(k)) names.add(k); }
  for (const n of names) s = s.replace(new RegExp('(?<![.\'"\\w])' + n + '\\b(?!\\s*:)(?![\'"])', 'g'), n + '_O'); // not in strings, keys or properties
  return s;
}
let mod = NEW.replace(A1, graft(OLD) + '\nlet AIOLD = [false, false];\nexport function __old(a) { AIOLD = a; }\n' + A1);
// the dispatch: each side thinks with the old commander's head or the new one's
mod = mod.replace(/(\bif \(G\.human !== t\) )ai\(t\);/, '$1(AIOLD[t] ? ai_O(t) : ai(t));');
if (!mod.includes('ai_O(t) : ai(t)')) throw new Error('dispatch not patched');
const dir = mkdtempSync(join(tmpdir(), 'gai-')), file = join(dir, 'ground_bench.js'); writeFileSync(file, mod);
const GR = await import(pathToFileURL(file).href);

// campaign-sized battles at legion scale (camp.js groundSpec): an open city, a walled one, a fortress, a small world.
// The garrisons are sized so the old AI on both sides is close to an even fight (calibrated 2026-11-11)
const SC = [
  { name: 'open-even', world: 'mars', att: { f: 'rep', shells: 900, leech: 9000, storks: 12000 }, def: { f: 'soc', men: 44000, fort: 0, gun: 1, shield: 0, barracks: 1 } },
  { name: 'walled', world: 'venus', att: { f: 'rep', shells: 1500, leech: 12000, storks: 18000 }, def: { f: 'soc', men: 86000, fort: 1, gun: 2, shield: 1, barracks: 1 } },
  { name: 'fortress', world: 'luna', att: { f: 'rim', shells: 2400, leech: 16000, storks: 24000 }, def: { f: 'rep', men: 102000, fort: 2, gun: 3, shield: 1, barracks: 2 } },
  { name: 'mercury', world: 'mercury', att: { f: 'soc', shells: 600, leech: 7000, storks: 9000 }, def: { f: 'rep', men: 38000, fort: 0, gun: 1, shield: 0, barracks: 0 } },
];
const specOf = c => ({ world: c.world, storm: false, maxT: 1800, att: { ...c.att, cmdr: 'Legatus', total: c.att.shells * 6 + c.att.leech + c.att.storks }, def: { ...c.def, men: Math.round(c.def.men * DK), garrison: c.def.men, morale: 1, cmdr: 'The Legate' } });
const MODES = { OO: [true, true], NN: [false, false], NO: [false, true], ON: [true, false] };
const out = {};
for (const c of SC) {
  if (ONLY && c.name !== ONLY) continue;
  for (const [m, old] of Object.entries(MODES)) {
    if (ONLYM && !ONLYM.split(',').includes(m)) continue;
    let wins = 0, t = 0, aL = 0, dL = 0, n = 0;
    for (let sd = 1; sd <= SEEDS; sd++) {
      GR.__old(old); const r = GR.runHeadless(specOf(c), 1000 + sd * 7919);
      wins += r.won ? 1 : 0; t += r.t; aL += 1 - r.attLeft / Math.max(1, r.att0); dL += 1 - r.defLeft / Math.max(1, r.def0); n++;
    }
    out[c.name + ' ' + m] = { att: +(wins / n).toFixed(2), t: Math.round(t / n), attLost: +(aL / n).toFixed(2), defLost: +(dL / n).toFixed(2) };
    console.log(`${c.name.padEnd(10)} ${m}  attacker wins ${(wins / n * 100).toFixed(0).padStart(3)}%  t ${Math.round(t / n).toString().padStart(5)}s  attacker lost ${(aL / n * 100).toFixed(0).padStart(3)}%  defender lost ${(dL / n * 100).toFixed(0).padStart(3)}%`);
  }
}
if (arg('save', null)) writeFileSync(arg('save'), JSON.stringify(out, null, 1));
