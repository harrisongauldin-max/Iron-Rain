// Commander abilities in a campaign battle: moments to play for, on cooldowns, unlocked by the commander who leads
// a battle group. Every commander can order a flank burn, run dark or put all guns on the bridge; carriers can spit
// their starShells; an attacker with assault pods can drop the Iron Rain once the world's guns are silent; and the
// commanders of the books each have a signature move.
import { S } from './state.js';
import { groupList, launchShells, disabled, brace, threatSide, goCold, warmUp } from './sim.js';

const hyp = Math.hypot;
const alive = s => s && !s.dead && !s.offField && !s.surrendered && !s.derelict;
// the signature moves of the war's commanders, by name
const SIGS = [
  ['Darrow', { name: 'Reaper’s Gambit', desc: 'Every ship within 6,000 km of the flagship fights 25% harder, and no crew breaks, for 25 seconds', cd: 150, run: G => near(G, 6000).forEach(s => { s.gunT = S.time + 25; s.gunK = 1.25; s.loyT = S.time + 25; }) }],
  ['Sevro', { name: 'The Howl', desc: 'Every boarder of ours fights 60% harder for 30 seconds, and the group’s guns 10% harder', cd: 120, run: G => { for (const s of S.ships) if (s.team === G.team && s.def.troops) s.howlT = S.time + 30; G.ships.forEach(s => { s.gunT = S.time + 30; s.gunK = 1.1; }); } }],
  ['Orion', { name: 'Orion’s Helm', desc: 'Every ship of ours turns and burns 40% harder for 30 seconds', cd: 120, run: G => { for (const s of S.ships) if (s.team === G.team && !s.def.static) s.helmT = S.time + 30; } }],
  ['Kavax', { name: 'Telemanus Shieldwall', desc: 'The group’s shields take half damage for 25 seconds', cd: 120, run: G => G.ships.forEach(s => { s.shT = S.time + 25; }) }],
  ['Atalantia', { name: 'Grimmus Onslaught', desc: 'The group burns hard and fights 20% harder for 25 seconds', cd: 140, run: G => G.ships.forEach(s => { s.gunT = S.time + 25; s.gunK = 1.2; s.burnT = S.time + 12; }) }],
  ['Diomedes', { name: 'The Storm Knight’s Charge', desc: 'The group charges on a flank burn and fights 15% harder for 20 seconds', cd: 140, run: G => G.ships.forEach(s => { s.burnT = S.time + 14; s.gunT = S.time + 20; s.gunK = 1.15; }) }],
  ['Victra', { name: 'Julii Wrath', desc: 'The group fights 20% harder for 25 seconds', cd: 120, run: G => G.ships.forEach(s => { s.gunT = S.time + 25; s.gunK = 1.2; }) }],
];
const near = (G, R) => S.ships.filter(s => s.team === G.team && !s.dead && !s.def.static && hyp(s.x - G.flag.x, s.y - G.flag.y) < R);
const enemyCaps = (G, R, f) => S.ships.filter(s => s.team !== G.team && s.team < 2 && alive(s) && s.def.capture && !s.def.static && (!s.vis || s.vis[G.team]) && hyp(s.x - G.flag.x, s.y - G.flag.y) < R && (!f || f(s)));
const talents = G => (G.camp && (G.camp.grantT ? G.camp.talents.concat(G.camp.grantT) : G.camp.talents)) || (G.cmdr && G.cmdr.traits) || [];
export const ABIL = {
  brace: { name: 'Brace', desc: 'Every ship in the group throws its shield power to the side the threat is on (a lance charging at her, or the nearest enemy): that half holds 150% for 8 seconds, the other half 50%. The price: while braced her guns fire at half rate and she turns at a third', cd: 25,
    why: G => G.ships.some(s => s.sub && s.def.shield && s.sh > 0) ? null : 'No shields up in this group to brace', run: G => G.ships.forEach(s => brace(s, threatSide(s))) },
  burn: { name: 'Flank burn', desc: 'The group burns at 180% for 12 seconds, to get round a flank or under a capital ship’s guns. The price: fuel goes two and a half times as fast, the broadside batteries are secured and silent, and she can barely turn', cd: 60, fast: ['torch', 'helm'], run: G => G.ships.forEach(s => { s.burnT = S.time + 12; }) },
  lock: { name: 'Lock on', desc: 'Fire control takes the helm for 20 seconds: the guns cycle 20% faster, rounds go a third as wide so long-range fire lands, and even small quick hulls are held in the sights. The price: every ship all but holds her heading and crawls at a third of her thrust, a sitting target for anything that gets onto her quarter', cd: 50, fast: ['gunnery'],
    run: G => G.ships.forEach(s => { if (!s.def.fighter && !s.def.shell) s.lockT = S.time + 20; }) },
  dark: { name: 'Go cold', desc: 'Shields down, drives to a whisper, guns holding: the ships drop off the enemy’s sensors beyond a few thousand km, as Darrow’s fleet did at Kalyke. Order it again to warm up: the guns are free at once, but the shields need 6 seconds to spin up and recharge from empty', cd: 30, fast: ['hunter', 'tactician'],
    run: G => { const warm = G.ships.some(s => !s.cold && !s.def.static); for (const s of G.ships) warm ? goCold(s) : warmUp(s); } },
  bridge: { name: 'All guns on the bridge', desc: 'The group concentrates on the nearest enemy capital ship, aiming for its bridge, for 30 seconds', cd: 75, fast: ['gunnery'],
    why: G => enemyCaps(G, 9000).length ? null : 'No enemy capital ship within 9,000 km',
    run: G => { const t = enemyCaps(G, 9000).sort((a, b) => hyp(a.x - G.flag.x, a.y - G.flag.y) - hyp(b.x - G.flag.x, b.y - G.flag.y))[0]; if (!t) return; for (const s of G.ships) { s.aimSub = 'bridge'; s.aimT = S.time + 30; if (!s.def.troops) { s.order = { type: 'attack', t }; s.engage = t; } } } },
  shells: { name: 'Spit the starShells', desc: 'Every carrier in the group launches all its starShells at a capital ship whose shields are down', cd: 90, fast: ['breacher'],
    why: G => !G.ships.some(s => s.h && s.h.starshell > 0) ? 'No starShells aboard this group' : !enemyCaps(G, 4000, s => s.sh < s.def.shield * .25).length ? 'No enemy capital ship with its shields down within 4,000 km' : null,
    run: G => { const t = enemyCaps(G, 4000, s => s.sh < s.def.shield * .25)[0]; if (!t) return; for (const c of G.ships) if (c.h && c.h.starshell > 0 && !disabled(c)) launchShells(c, t, c.h.starshell); } },
  rain: { name: 'Iron Rain', desc: 'Drop every assault pod near the world onto its surface. It needs the world’s guns silenced. The legions land in 15 seconds, and if they beat the garrison the world falls at once', cd: 1e9, once: true,
    why: G => S.rainCtx ? S.rainCtx.why(G) : 'Not possible in this battle', run: G => S.rainCtx && S.rainCtx.run(G) },
};
const SPENT = '. The price: when it ends the crews are spent, and fight at 75% for 25 seconds';
export function sigOf(G) { const n = (G.camp && G.camp.name) || (G.cmdr && G.cmdr.name) || ''; const e = SIGS.find(([k]) => n.startsWith(k)); if (e) return { ...e[1], desc: e[1].desc + SPENT };
  if (talents(G).includes('peerless')) return { name: 'Peerless Example', desc: 'A Peerless Scarred leads from the front: no crew in the group breaks for 30 seconds', cd: 120, run: G2 => G2.ships.forEach(s => { s.loyT = S.time + 30; }) };
  return null; }

// a group as the abilities see it
export function groupFor(g) {
  const ships = g.members.filter(alive), flag = alive(g.flag) ? g.flag : ships[0]; if (!flag) return null;
  const cmdr = ships.map(s => s.cmdr).find(Boolean) || null;
  return { key: 'g' + g.n, team: flag.team, ships, flag, cmdr, camp: cmdr && cmdr.camp, name: g.name };
}
const CD = {};
export const reset = () => { for (const k in CD) delete CD[k]; S.rainCtx = null; S.decoys = []; };
export function list(G) {
  if (!G) return [];
  const out = [];
  for (const k of ['brace', 'lock', 'burn', 'dark', 'bridge', 'rain']) /* starShells, pods, ripWings and nukes are on the hangar row */ { const A = ABIL[k]; if (k === 'rain' && (!S.rainCtx || !S.ships.some(s => s.team === G.team && !s.dead && ((s.h && s.h.boarder > 0) || (s.def.troops && !s.def.fighter))))) continue; if (k === 'shells' && !G.ships.some(s => s.def.hangar && s.def.hangar.starshell)) continue; out.push([k, A]); }
  if (!G.cmdr) return out.filter(([k]) => k === 'rain' || k === 'brace' || k === 'lock'); // without a commander, only the Rain, a brace or a lock-on can be ordered
  const sg = sigOf(G); if (sg) out.unshift(['sig', sg]);
  return out;
}
const cdOf = (G, k, A) => A.cd * (A.fast && talents(G).some(t => A.fast.includes(t)) ? .5 : 1);
// orders every ship carries out for herself: each ship keeps her own cooldown, so an order given to part of the
// fleet leaves the rest ready. A commander's signature move is his, and the Iron Rain is given once
export const SHIPK = ['brace', 'lock', 'burn', 'dark', 'bridge', 'shells'];
const readyOf = (G, k) => G.ships.filter(s => !(s.abCD && s.abCD[k] > S.time));
const keyOf = (G, k) => k === 'sig' && G.cmdr ? 'c' + G.cmdr.id + ':sig' : k === 'rain' ? 'rain' : G.key + ':' + k;
export function state(G, k, A) {
  if (SHIPK.includes(k)) {
    const R = readyOf(G, k);
    if (!R.length) { const t = Math.min(...G.ships.map(s => s.abCD[k])); return { ok: false, why: `Ready in ${Math.ceil(t - S.time)}s`, cd: Math.ceil(t - S.time), tot: cdOf(G, k, A) }; }
    const w = A.why && A.why({ ...G, ships: R }); return w ? { ok: false, why: w } : { ok: true, n: R.length, of: G.ships.length };
  }
  const key = keyOf(G, k), rdy = CD[key] || 0;
  if (A.once && rdy) return { ok: false, why: 'Already ordered' };
  if (S.time < rdy) return { ok: false, why: `Ready in ${Math.ceil(rdy - S.time)}s`, cd: Math.ceil(rdy - S.time), tot: cdOf(G, k, A) };
  const w = A.why && A.why(G); return w ? { ok: false, why: w } : { ok: true };
}
export function use(G, k) {
  const A = k === 'sig' ? sigOf(G) : ABIL[k]; if (!A || !G) return false;
  const st = state(G, k, A); if (!st.ok) return false;
  if (SHIPK.includes(k)) { const R = readyOf(G, k), until = S.time + cdOf(G, k, A); A.run({ ...G, ships: R }); for (const s of R) (s.abCD || (s.abCD = {}))[k] = until; }
  else { A.run(G); CD[keyOf(G, k)] = A.once ? 1 : S.time + cdOf(G, k, A); }
  // a commander's great moment costs the crews who carry it: when it ends, they fight at 75% for 25 seconds
  if (k === 'sig') for (const s of S.ships) if (s.team === G.team && !s.dead && !s.def.static && (s.gunT > S.time || s.helmT > S.time || s.shT > S.time || s.howlT > S.time || s.burnT > S.time)) {
    const end = Math.max(s.gunT || 0, s.helmT || 0, s.shT || 0, s.howlT || 0, s.burnT || 0); s.tiredA = end; s.tiredT = end + 25; }
  if (S.hooks && S.hooks.voice && G.team === 0) S.hooks.voice('sig', G.cmdr && G.cmdr.ship || G.ships[0]);
  if (G.team === 0 || k !== 'sig') return true; /* our own orders show on the order card, and the enemy's small ones on the field: comms carries what is said */
  if (S.hooks && S.hooks.note) S.hooks.note(`${G.team === 0 ? '' : 'Enemy: '}${G.cmdr ? G.cmdr.name + ' · ' : ''}${A.name}`, G.team === 0 ? 0xe8c87e : 0xff8a7a);
  return true;
}
// the enemy's commanders use theirs when the fight is on
// an enemy commander's group, as the abilities see it: the ships within 2,500 km of the flagship
export function aiGroup(c) {
  if (!c || c.team !== 1 || c.state !== 'aboard' || !alive(c.ship)) return null;
  const ships = S.ships.filter(s => s.team === 1 && alive(s) && !s.def.static && !s.broken && hyp(s.x - c.ship.x, s.y - c.ship.y) < 2500);
  return { key: 'ai' + c.id, team: 1, ships, flag: c.ship, cmdr: c, camp: c.camp, name: c.name };
}
export function aiTick(p = .35) {
  for (const c of S.cmdrs || []) {
    const G = aiGroup(c); if (!G || c.ship.broken) continue;
    const foe = S.ships.some(s => s.team === 0 && alive(s) && !s.def.static && hyp(s.x - c.ship.x, s.y - c.ship.y) < 9000);
    if (!foe) continue;
    const close = S.ships.some(s => s.team === 0 && alive(s) && !s.def.static && hyp(s.x - c.ship.x, s.y - c.ship.y) < 6000); /* lock on only with the enemy in reach */
    const opts = list(G).filter(([k, A]) => k !== 'dark' && k !== 'rain' && k !== 'decoy' && (k !== 'lock' || close) && state(G, k, A).ok);
    if (opts.length && Math.random() < p) use(G, opts[Math.floor(Math.random() * opts.length)][0]);
  }
  for (const s of S.ships) if (s.aimT && S.time > s.aimT) { s.aimSub = null; s.aimT = 0; }
}
// the order card acts on what is selected: those ships, led by the senior commander among them or leading their
// group. With nothing selected it acts on the whole fleet, led by its senior commander
export function forSel() {
  let ships = (S.selection || []).filter(s => s.team === 0 && alive(s) && !s.def.static && !s.ally && !s.broken);
  const all = !ships.length; if (all) ships = S.ships.filter(s => s.team === 0 && alive(s) && !s.def.static && !s.ally && !s.def.fighter && !s.broken);
  if (!ships.length) return null;
  const lead = s => s.cmdr || (s.group && !s.detached && alive(s.group.flag) && s.group.flag.cmdr ? s.group.flag.cmdr : null);
  let cmdr = null; for (const s of ships) { const c = lead(s); if (c && (!cmdr || (c.rank || 0) > (cmdr.rank || 0))) cmdr = c; }
  if (!cmdr && all) cmdr = (S.cmdrs || []).filter(c => c.team === 0 && c.state === 'aboard' && alive(c.ship)).sort((a, b) => (b.rank || 0) - (a.rank || 0))[0] || null;
  const flag = cmdr && alive(cmdr.ship) ? cmdr.ship : ships[0];
  return { key: 'sel', team: 0, ships, flag, cmdr, camp: cmdr && cmdr.camp, all, name: all ? 'The whole fleet' : ships.length === 1 ? (ships[0].title || ships[0].def.name) : ships.length + ' ships' };
}
export const current = () => { const sel = S.selection.find(s => s.group && s.team === 0); const g = sel ? sel.group : groupList().find(x => x.flag && x.flag.team === 0 && !x.flag.offField && x.members.some(m => m.cmdr)) || groupList().find(x => x.flag && x.flag.team === 0 && !x.flag.offField); return g ? groupFor(g) : null; };
