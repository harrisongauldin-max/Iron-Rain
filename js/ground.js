// The ground war: a battle fought on a world's surface after an Iron Rain, in the manner of a Total War field battle.
// The first wave (starShells and the leechCraft legions) falls from the spitTubes onto drop zones the attacker picks;
// the second (the Storks) lands only on a beachhead that still holds. The defenders hold the city's three key sites.
// Pure rules, no DOM and no campaign imports: the battle is built from a plain spec (groundSpec in camp.js) so it can
// be run headless. One unit is a cohort or a detachment; men are counted one by one, figures are only for the view.
//
// Lore (Red Rising wiki, Weapons and Armor; StarShell): scorchers pierce only basic armour; railRifles overload shields
// and pierce armour; pulseFists are the Golds' ranged weapon; razors cut anything; starShells are 12-foot, 3-tonne
// suits with pulseCannons and missiles that shrug off most weapons short of railguns and razors; the QR-13 rides a
// floating gravPod; a Sarissa launcher can bring down a shuttle with one missile.

const TAU = Math.PI * 2, PI = Math.PI, hyp = Math.hypot;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };

// ---------------------------------------------------------------- seeded noise
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const hashStr = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function noise2(seed) {
  const P = new Uint16Array(512), r = rng(seed); for (let i = 0; i < 256; i++) P[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const V = new Float32Array(256); for (let i = 0; i < 256; i++) V[i] = r();
  const f = t => t * t * (3 - 2 * t);
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]], c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]], u = f(xf), v = f(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v); };
}

// ---------------------------------------------------------------- the worlds as battlefields
// relief in metres, sea level (fraction of relief, or null for a dry world), what grows there, and gravity (Earth = 1):
// in low gravity the gravBoots bound farther, so every unit moves a little faster
export const BIOME = {
  mercury: { name: 'Helios', city: 'Heliopolis', sites: ['Mound of Votum', 'Water Plaza', 'Gravloop Station', 'Hippodrome', 'Via Triumphia'], relief: 120, sea: .3, veg: .25, g: .38, ground: ['#5b4a32', '#8a6a3e', '#b99560', '#d8c08a'], veg_c: '#55602f', sky: '#f4c98a', fog: '#e9b878', sun: '#fff0d0', water: '#2f6f86', lore: 'The sunward continent of Helios, its seas made by the terraformers; Heliopolis on the Bay of Sirens' },
  venus:   { name: 'the Isles', city: 'Ishtar City', sites: ['The Ash Lord’s Palace', 'Skyport', 'Shield Spire', 'Forum', 'Harbour Gate'], relief: 90, sea: .42, veg: .6, g: .9, ground: ['#3c4a2c', '#5a6a3a', '#80885a', '#b8b090'], veg_c: '#2f5a2a', sky: '#d8c8a0', fog: '#c8b890', sun: '#ffe8c0', water: '#2a5e72', lore: 'A terraformed sea world of island cities under a gold-hazed sky' },
  earth:   { name: 'the old lands', city: 'the capital', sites: ['Citadel', 'Spaceport', 'Shield Generator', 'Forum', 'Barracks'], relief: 140, sea: .28, veg: .7, g: 1, ground: ['#3d4a2a', '#5c6b38', '#7d8650', '#a9a585'], veg_c: '#2e4f24', sky: '#9cc4e8', fog: '#a8c4dc', sun: '#fff6e4', water: '#2c5878', lore: 'Old farmland and drowned coasts' },
  luna:    { name: 'the Sea of Serenity', city: 'Hyperion', sites: ['Citadel of Light', 'Atlas Docks', 'Shield Spire', 'Forum', 'Gravloop Terminus'], relief: 70, sea: .34, veg: .45, g: .165, ground: ['#4a4e42', '#6c7256', '#8f946c', '#b8b89a'], veg_c: '#3f5a30', sky: '#8fb4e4', fog: '#b4c6dc', sun: '#fff4e6', water: '#2a5a7c', lore: 'Terraformed since the Conquering: a breathable sky, seeded green, the old craters filled as seas; Hyperion on the shore, the Earth hanging overhead' },
  mars:    { name: 'the Cimmerian highlands', city: 'Agea', sites: ['Citadel', 'Spaceport', 'Shield Generator', 'Forum', 'Barracks'], relief: 180, sea: .18, veg: .3, g: .38, ground: ['#5a2e1e', '#83432a', '#a8633e', '#c99a74'], veg_c: '#4f5a2c', sky: '#d7a27c', fog: '#c98e68', sun: '#ffe6cc', water: '#2a5462', lore: 'Red highlands and terraformed valleys' },
  phobos:  { name: 'the Hive', city: 'the Dockworks', sites: ['Command Spire', 'Dry Docks', 'Grav Core', 'Hive Gate', 'Slum Stacks'], relief: 60, sea: null, veg: 0, g: .3, ground: ['#3c3530', '#574c44', '#74675c', '#93877c'], veg_c: '#3c3530', sky: '#0e1018', fog: '#2a2420', sun: '#fff0e0', water: '#1a1a20', lore: 'Dock-stacks cut into the moon’s rock' },
  deimos:  { name: 'the Battle Moon', city: 'the Bastion', sites: ['Bastion Keep', 'Gun Deck', 'Grav Core', 'North Battery', 'Barracks'], relief: 80, sea: null, veg: 0, g: .3, ground: ['#3a3430', '#55493f', '#726354', '#93836f'], veg_c: '#3a3430', sky: '#0e1018', fog: '#2a2420', sun: '#fff0e0', water: '#1a1a20', lore: 'Fortified far beyond its size' },
  _ice:    { name: 'the ice plains', city: 'the colony', sites: ['Governor’s Hall', 'Spaceport', 'Shield Generator', 'Dome Gate', 'Barracks'], relief: 90, sea: null, veg: .1, g: .15, ground: ['#4a5560', '#6c7a86', '#93a2ae', '#c8d4de'], veg_c: '#506070', sky: '#1a2434', fog: '#4a5a6c', sun: '#eaf2ff', water: '#203040', lore: 'An ice moon under a domed colony' },
};
export const biomeOf = id => BIOME[id] || BIOME._ice;

export const SITE_R = 200;      // a site's radius: room for a cohort of a thousand to stand on it
export const MAP = 8000;         // metres on a side: a city and its approaches, at legion scale
export const SC = MAP / 3200;    // how much larger than the first 3.2 km field: map-scale distances are written as 3.2 km figures times SC
export const NH = 320, CH = MAP / NH;   // height grid: 25 m cells
const NN = 160, CN = MAP / NN;   // nav grid: 50 m cells

// ---------------------------------------------------------------- units
// hp is per man; armour: 1 cloth, 2 duroArmor, 6 pulseArmor, 8 a starShell. A weapon's ap below the target's armour
// does a fraction (ap/armour)^2 of its damage, so scorchers barely scratch a starShell and razors cut anything.
// rof: shots per man per second; acc: chance to hit a man at half range in the open.
export const WPN = {
  scorcher: { name: 'Scorchers', range: 170, rof: .45, acc: .3, dmg: 1, ap: 2, fx: 'scorch' },
  pulseRifle: { name: 'PulseRifles', range: 220, rof: .5, acc: .32, dmg: 1.1, ap: 3, fx: 'pulse' },
  railRifle: { name: 'RailRifles', range: 420, rof: .16, acc: .4, dmg: 1.6, ap: 7, fx: 'rail', siege: .35 },
  pulseFist: { name: 'PulseFists', range: 130, rof: .5, acc: .45, dmg: 2.2, ap: 5, fx: 'pulse' },
  pulseCannon: { name: 'PulseCannons', range: 300, rof: .3, acc: .4, dmg: 3, ap: 5, splash: 1.6, fx: 'cannon', siege: 1 },
  missiles: { name: 'Missile pods', range: 800, rof: .05, acc: .5, dmg: 4, ap: 6, splash: 3, fx: 'missile', ammo: 6, siege: 1 },
  qr13: { name: 'QR-13 heavy guns', range: 620, rof: .9, acc: .2, dmg: 1.2, ap: 3.5, splash: 2, fx: 'heavy' },
  sarissa: { name: 'Sarissa launchers', range: 300, rof: .1, acc: .4, dmg: 4, ap: 6, splash: 1.5, fx: 'missile', aa: 2200 },
  plasma: { name: 'Plasma pistols', range: 70, rof: .4, acc: .35, dmg: 1.2, ap: 3, fx: 'plasma' },
};
// melee: attack and defence per man; charge: bonus on contact at the run; mass: how hard the unit hits a line
export const UT = {
  legion:   { name: 'Gray Legionnaires', short: 'Legion', role: 'Line infantry in duroArmor · scorchers · the bulk of every army', glyph: 'L', hp: 1, armor: 2, wpn: 'scorcher', ammo: 70, mel: 3, def: 4, charge: 3, mass: 1, walk: 2.8, run: 5.6, morale: 55, low: true, fig: 1, sp: 1.6, size: 1.7 },
  railmen:  { name: 'RailRifle Teams', short: 'Rail', role: 'Gray heavy-weapons teams · railRifles pierce pulseShields and starShells', glyph: 'R', hp: 1, armor: 2, wpn: 'railRifle', ammo: 40, mel: 2, def: 3, charge: 1, mass: .8, walk: 2.6, run: 5.2, morale: 50, low: true, fig: 1, sp: 2.2, size: 1.7 },
  obsidian: { name: 'Obsidian Shock', short: 'Obsidian', role: 'Giants with pulseAxes and ionPikes · terror in melee · plasma pistols', glyph: 'O', hp: 2, armor: 3, wpn: 'plasma', ammo: 30, mel: 9, def: 6, charge: 10, mass: 1.8, walk: 3, run: 6.6, morale: 70, resolve: .15, fear: 4, fig: 1, sp: 2, size: 2.4 },
  peerless: { name: 'Peerless Knights', short: 'Peerless', role: 'Golds in pulseArmor · razors and pulseFists · gravBoots: they fly', glyph: 'P', hp: 4, armor: 6, shield: 3, wpn: 'pulseFist', ammo: 999, mel: 15, def: 13, charge: 9, mass: 1.6, walk: 6, run: 16, morale: 90, resolve: .45, fear: 8, fly: true, aura: 10, fig: 1, sp: 2.2, size: 2.1 },
  starshell:{ name: 'StarShells', short: 'StarShell', role: '12-foot armoured suits · pulseCannons and missiles · only railRifles, razors and heavy guns hurt them', glyph: 'S', hp: 10, armor: 8, wpn: 'pulseCannon', wpn2: 'missiles', ammo: 80, mel: 8, def: 8, charge: 6, mass: 5, walk: 3, run: 4.8, morale: 80, resolve: .4, fear: 6, fig: 1, sp: 5, size: 3.7 },
  gravpod:  { name: 'QR-13 gravPods', short: 'gravPod', role: 'Floating gun platforms · long reach, cuts down infantry in the open', glyph: 'G', hp: 6, armor: 5, wpn: 'qr13', ammo: 200, mel: 1, def: 2, charge: 0, mass: 2, walk: 2.8, run: 2.8, morale: 45, fig: 1, sp: 7, size: 2.2, art: true, low: true },
  sarissa:  { name: 'Sarissa Batteries', short: 'Sarissa', role: 'Anti-air launchers · shoot the drop out of the sky · kill them before the Storks come', glyph: 'A', hp: 5, armor: 4, wpn: 'sarissa', ammo: 60, mel: 1, def: 2, charge: 0, mass: 2, walk: 1.6, run: 1.6, morale: 40, fig: 1, sp: 6, size: 2, aa: true, low: true },
};
const PEN = (ap, ar) => ap >= ar ? 1 : Math.max(.04, Math.pow(ap / ar, 1.5)); // massed scorcher fire still wears a pulseShield down

// ---------------------------------------------------------------- the state
export const G = { on: false };
let R = Math.random;

// ---------------------------------------------------------------- terrain
function buildMap(spec) {
  const B = biomeOf(spec.world), seed = hashStr(spec.world + ':ground');
  const n1 = noise2(seed), n2 = noise2(seed + 7), n3 = noise2(seed + 13), r = rng(seed + 99);
  const H = new Float32Array((NH + 1) * (NH + 1)), cover = new Float32Array(NH * NH), urban = new Uint8Array(NH * NH), veg = new Uint8Array(NH * NH);
  const city = { x: MAP * (.5 + (r() - .5) * .15), y: MAP * .7, r: 520 * SC };
  // the city sits on a shoulder of high ground, the drop lands on the plains below it
  for (let j = 0; j <= NH; j++) for (let i = 0; i <= NH; i++) {
    const x = i * CH, y = j * CH, u = x / (900 * SC), v = y / (900 * SC);
    let h = 0, a = 1, f = 1; for (let o = 0; o < 5; o++) { h += (n1(u * f, v * f) - .5) * a; a *= .5; f *= 2.1; }
    const ridge = 1 - Math.abs(n2(u * .7 + 3, v * .7) * 2 - 1); h += ridge * ridge * .35 - .12;
    h += (y / MAP - .45) * .35;                                // the land rises toward the city
    const dc = hyp(x - city.x, y - city.y) / city.r;            // flatten the city's plateau
    if (dc < 1.6) { const k = clamp((dc - .9) / .7, 0, 1); h = lerp(.18 + (n3(u * 3, v * 3) - .5) * .02, h, k * k); }
    const edge = Math.min(x, y, MAP - x, MAP - y) / MAP; if (edge < .05) h += (.05 - edge) * 2; // the field's edges rise
    H[j * (NH + 1) + i] = h * B.relief * 2.9; // a bigger field, bigger hills
  }
  let lo = Infinity, hi = -Infinity; for (const h of H) { if (h < lo) lo = h; if (h > hi) hi = h; }
  for (let k = 0; k < H.length; k++) H[k] -= lo;
  const relief = hi - lo, seaH = B.sea != null ? relief * B.sea : -1;
  // the city: blocks of buildings on a street grid, a wall round its core if the world is fortified
  const blocks = [];
  for (let j = 0; j < NH; j++) for (let i = 0; i < NH; i++) {
    const x = (i + .5) * CH, y = (j + .5) * CH, d = hyp(x - city.x, y - city.y), k = j * NH + i, h = H[j * (NH + 1) + i];
    if (h < seaH) continue;
    const street = (i % 4 === 0) || (j % 4 === 0);
    if (d < city.r * (.85 + n3(x / (300 * SC), y / (300 * SC)) * .35) && !street) { urban[k] = 1; cover[k] = .55; if (r() < .85) blocks.push({ i, j, h: 8 + r() * 26 * (1 - d / city.r) + (d < city.r * .3 ? 30 * r() : 0) }); }
    else if (B.veg > 0 && n2(x / (260 * SC) + 9, y / (260 * SC)) < B.veg * .75 && d > city.r * 1.1) { veg[k] = 1; cover[k] = .3; }
  }
  // objectives: three sites in the city
  const sites = [];
  const RING = [[0, 0], [-PI / 2 - .55, .55], [-PI / 2 + .55, .55], [PI, .5], [0, .5]]; // the heart, the two gates on the plain, the flanks
  RING.forEach(([a, rr], q) => { const a1 = a + (r() - .5) * .25; sites.push({ id: q, name: B.sites[q] || ('Site ' + 'ABCDE'[q]), x: city.x + Math.cos(a1) * city.r * rr, y: city.y + Math.sin(a1) * city.r * rr * .85, r: SITE_R, v: -1, own: 1, hold: 0 }); });
  for (const s of sites) { // clear a square round each site
    for (let j = 0; j < NH; j++) for (let i = 0; i < NH; i++) { const x = (i + .5) * CH, y = (j + .5) * CH; if (hyp(x - s.x, y - s.y) < SITE_R * .75) { urban[j * NH + i] = 0; cover[j * NH + i] = .2; } }
  }
  const keep = blocks.filter(b => sites.every(s => hyp((b.i + .5) * CH - s.x, (b.j + .5) * CH - s.y) > SITE_R * .75));
  // the wall: a ring of segments with four gates, only where there is a fortress
  const walls = [];
  if (spec.def.fort > 0) {
    const N = 80, R0 = city.r * .78;
    for (let k = 0; k < N; k++) {
      const a0 = k / N * TAU, a1 = (k + 1) / N * TAU, gate = k % 10 === 0 || k % 10 === 1 || k % 10 === 5 || k % 10 === 6; // eight gates, each two segments wide
      if (gate) continue;
      walls.push({ id: walls.length, x0: city.x + Math.cos(a0) * R0, y0: city.y + Math.sin(a0) * R0, x1: city.x + Math.cos(a1) * R0, y1: city.y + Math.sin(a1) * R0, h: 14 + spec.def.fort * 4, hp: WALL_HP(spec.def.fort), hp0: WALL_HP(spec.def.fort), down: false });
    }
  }
  return { B, H, cover, urban, veg, blocks: keep, sites, city, walls, wl: walls.slice(), seaH, relief };
}
export function heightAt(x, y) {
  const M = G.map; if (!M) return 0;
  const fx = clamp(x / CH, 0, NH - .001), fy = clamp(y / CH, 0, NH - .001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, W = NH + 1;
  return lerp(lerp(M.H[j * W + i], M.H[j * W + i + 1], u), lerp(M.H[(j + 1) * W + i], M.H[(j + 1) * W + i + 1], u), v);
}
const cellOf = (x, y) => clamp(Math.floor(y / CH), 0, NH - 1) * NH + clamp(Math.floor(x / CH), 0, NH - 1);
export const coverAt = (x, y) => G.map.cover[cellOf(x, y)];
export const isUrban = (x, y) => !!G.map.urban[cellOf(x, y)];
export const isWater = (x, y) => G.map.seaH >= 0 && heightAt(x, y) < G.map.seaH;
export const isDeep = (x, y) => G.map.seaH >= 0 && heightAt(x, y) < G.map.seaH - 3; // the shallows at a cell's wet edge can be waded
const nearWall = (x, y, d) => G.map.wl.some(w => segDist(x, y, w) < d);
function segDist(px, py, w) { const dx = w.x1 - w.x0, dy = w.y1 - w.y0, l2 = dx * dx + dy * dy, t = clamp(((px - w.x0) * dx + (py - w.y0) * dy) / l2, 0, 1); return hyp(px - w.x0 - dx * t, py - w.y0 - dy * t); }
const segX = (ax, ay, bx, by, w) => { const d = (bx - ax) * (w.y1 - w.y0) - (by - ay) * (w.x1 - w.x0); if (Math.abs(d) < 1e-9) return false; const t = ((w.x0 - ax) * (w.y1 - w.y0) - (w.y0 - ay) * (w.x1 - w.x0)) / d, s = ((w.x0 - ax) * (by - ay) - (w.y0 - ay) * (bx - ax)) / d; return t > 0 && t < 1 && s > -1e-3 && s < 1 + 1e-3; }; // a step through the joint of two segments is caught by one of them
export const crossesWall = (ax, ay, bx, by) => G.map.wl.some(w => segX(ax, ay, bx, by, w));

// line of sight: hills and the city's buildings block it (a unit at a city's edge sees out of it)
export function los(ax, ay, bx, by) {
  const d = hyp(bx - ax, by - ay), n = Math.max(2, Math.ceil(d / 30)), h0 = heightAt(ax, ay) + 2.5, h1 = heightAt(bx, by) + 2.5;
  let deep = 0;
  for (let k = 1; k < n; k++) { const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (heightAt(x, y) > lerp(h0, h1, t) + 1) return false;
    if (isUrban(x, y)) { if (++deep > 4) return false; } else deep = 0; } // 100 m down a street
  return true;
}

// ---------------------------------------------------------------- navigation
let NAV = null;
function buildNav() {
  const cost = new Float32Array(NN * NN), wall = new Uint8Array(NN * NN);
  for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
    const x = (i + .5) * CN, y = (j + .5) * CN, k = j * NN + i;
    if (isWater(x, y)) { cost[k] = Infinity; continue; }
    const s = Math.abs(heightAt(x + 20, y) - heightAt(x - 20, y)) + Math.abs(heightAt(x, y + 20) - heightAt(x, y - 20));
    cost[k] = 1 + (isUrban(x, y) ? .5 : 0) + (G.map.veg[cellOf(x, y)] ? .25 : 0) + clamp(s / 40, 0, 3);
  }
  // walls block the moves between cells that cross them (8 directions per cell)
  const edge = new Uint8Array(NN * NN);
  NAV = { cost, wall, edge };
  if (G.map.wl.length) wallEdges(G.map.wl);
}
// the wall moves between cells near the given segments (8 directions per cell), from the walls now standing
function wallEdges(near) {
  for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
    const x = (i + .5) * CN, y = (j + .5) * CN; if (!near.some(w => segDist(x, y, w) < CN * 1.6)) continue;
    let m = 0; for (let d = 0; d < 8; d++) { const [di, dj] = DIRS[d]; if (crossesWall(x, y, x + di * CN, y + dj * CN)) m |= 1 << d; } NAV.edge[j * NN + i] = m;
  }
}
// ---------------------------------------------------------------- breaching the walls
// StarShells' pulseCannons and missile pods bring a stretch of wall down in about a minute; railRifles chip at it.
// A fallen stretch opens for good: the paths, the cover and the assault go through it
export const WALL_HP = fort => 3000 + 1500 * Math.max(1, fort || 1);
export const canBreach = u => u.team === 0 && !!(u.wpn.siege || (u.wpn2 && u.wpn2.siege)); // the attacker's: a garrison does not knock down its own wall
export function wallAt(x, y, r = 30) { let b = -1, bd = r; for (const w of G.map.wl) { const d = segDist(x, y, w); if (d < bd) { bd = d; b = w.id; } } return b; }
const wallMid = w => ({ x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 });
// where a unit stands to shoot at a stretch of wall: outside it, at three-quarters of its reach
function breachPost(u, w) { const m = wallMid(w), c = G.map.city, d = hyp(m.x - c.x, m.y - c.y) || 1, k = u.wpn.range * .7; return { x: m.x + (m.x - c.x) / d * k, y: m.y + (m.y - c.y) / d * k }; }
function breakWall(w) {
  if (w.down) return; w.down = true; w.hp = 0; G.map.wl = G.map.walls.filter(v => !v.down); w.downT = G.t;
  wallEdges([w]); // only the cells round the gap change
  const m = wallMid(w), s = G.map.sites.slice().sort((a, b) => hyp(a.x - m.x, a.y - m.y) - hyp(b.x - m.x, b.y - m.y))[0];
  log(`The wall is breached before ${s.name}!`, G.human === 0 ? 'good' : G.human === 1 ? 'bad' : 'gold');
  for (let q = 0; q < 5; q++) G.fx.push({ k: 'land', x: lerp(w.x0, w.x1, q / 4), y: lerp(w.y0, w.y1, q / 4), big: q === 2 });
  G.fx.push({ k: 'breach', w: w.id });
  for (const u of G.units) if (live(u) && !u.T.fly && u.order && u.order.type === 'move' && u.path && u.path.length && hyp(u.x - m.x, u.y - m.y) < 1500) u.path = findPath(u.x, u.y, u.order.x, u.order.y, false); // the new way in, for those near enough to take it
  if (G.army) G.army.path = null;
}
// a unit with a breach order shooting at its stretch of wall; false if it cannot (out of reach, wall already down)
function siegeFire(u, dt, mk) {
  const w = G.map.walls[u.order.w]; if (!w || w.down) return false;
  const d = segDist(u.x, u.y, w), W1 = u.wpn.siege && d <= u.wpn.range ? u.wpn : null, W2 = u.wpn2 && u.wpn2.siege && u.ammo2 > 0 && d <= u.wpn2.range ? u.wpn2 : null;
  if (!W1 && !W2) return false;
  const shooters = u.type === 'starshell' ? u.men : Math.min(u.men, u.width * 2);
  let dmg = W1 ? shooters * W1.rof * W1.dmg * W1.siege * dt * mk : 0;
  if (W2 && (u.cd2 -= dt) <= 0) { u.cd2 = 1 / W2.rof / Math.max(1, u.men / 4); u.ammo2--; dmg += u.men * W2.dmg * W2.splash * W2.siege * .5; }
  w.hp -= dmg * (u.eq > 1 ? 1 : .8); w.hitT = G.t; u.firing = true; u.sieging = true; if (W1) u.ammo -= dt * .5;
  const m = wallMid(w), f = clamp(((u.x - w.x0) * (w.x1 - w.x0) + (u.y - w.y0) * (w.y1 - w.y0)) / ((w.x1 - w.x0) ** 2 + (w.y1 - w.y0) ** 2), .1, .9);
  for (let q = 0; q < Math.min(4, Math.ceil(shooters / 8)); q++) { const g = clamp(f + (Math.random() - .5) * .5, 0, 1); G.fx.push({ k: 'shot', f: W1 ? W1.fx : 'missile', x0: u.x + (Math.random() - .5) * 10, y0: u.y + (Math.random() - .5) * 10, x1: lerp(w.x0, w.x1, g), y1: lerp(w.y0, w.y1, g), team: u.team, d: Math.random() * .5 }); }
  if (Math.random() < .12) G.fx.push({ k: 'land', x: m.x + (Math.random() - .5) * 40, y: m.y + (Math.random() - .5) * 40 });
  if (w.hp <= 0) breakWall(w);
  return true;
}
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const dirOf = (di, dj) => DIRS.findIndex(d => d[0] === di && d[1] === dj);
const navOK = (k, fly) => fly ? true : NAV.cost[k] < Infinity;
export function findPath(x0, y0, x1, y1, fly, raw) { // raw: cell by cell, no corners cut (the way round after a block)
  if (fly) return [{ x: x1, y: y1 }];
  const ci = (x, y) => clamp(Math.floor(y / CN), 0, NN - 1) * NN + clamp(Math.floor(x / CN), 0, NN - 1);
  // the start and goal cells must be ones the unit can walk to without crossing a wall: a unit beside the wall can
  // stand on the far side of its own cell's centre
  const side = (x, y, k) => { if (!G.map.wl.length) return k; const ok = q => navOK(q) && !crossesWall(x, y, (q % NN + .5) * CN, (((q / NN) | 0) + .5) * CN); if (ok(k)) return k; const i0 = k % NN, j0 = (k / NN) | 0;
    let best = k, bd = Infinity; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NN || j >= NN) continue; const q = j * NN + i; if (!ok(q)) continue; const d = hyp((i + .5) * CN - x, (j + .5) * CN - y); if (d < bd) { bd = d; best = q; } } return best; };
  let s = side(x0, y0, ci(x0, y0)), g = side(x1, y1, ci(x1, y1));
  if (!navOK(g, false)) { // the goal is in the sea or a wall: the nearest open cell
    let best = -1, bd = Infinity; const gi = g % NN, gj = (g / NN) | 0;
    for (let r = 1; r < 8 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = gi + di, j = gj + dj; if (i < 0 || j < 0 || i >= NN || j >= NN) continue; const k = j * NN + i; if (navOK(k) && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = k; } }
    if (best < 0) return [{ x: x1, y: y1 }]; g = best; x1 = (g % NN + .5) * CN; y1 = (((g / NN) | 0) + .5) * CN;
  }
  if (!navOK(s, false)) return [{ x: x1, y: y1 }]; // already off the grid's open ground: walk straight
  const N = NN * NN, gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const gx = g % NN, gy = (g / NN) | 0, hh = k => { const dx = Math.abs(k % NN - gx), dy = Math.abs(((k / NN) | 0) - gy); return (dx + dy + (1.414 - 2) * Math.min(dx, dy)); };
  gs[s] = 0; push(s, hh(s)); let n = 0;
  while (heap.length && n++ < 40000) {
    const [, k] = pop(); if (k === g) break; if (closed[k]) continue; closed[k] = 1;
    const i = k % NN, j = (k / NN) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NN || jj >= NN) continue; const q = jj * NN + ii; if (!navOK(q) || closed[q]) continue;
      if (NAV.edge[k] & (1 << dirOf(di, dj))) continue; // a wall between them
      if (di && dj && (!navOK(j * NN + ii) || !navOK(jj * NN + i))) continue;
      const c = gs[k] + (di && dj ? 1.414 : 1) * (NAV.cost[k] + NAV.cost[q]) * .5; if (c < gs[q]) { gs[q] = c; from[q] = k; push(q, c + hh(q)); } }
  }
  if (from[g] < 0 && g !== s) return [{ x: x1, y: y1 }];
  const cells = []; for (let k = g; k >= 0 && k !== s; k = from[k]) cells.push(k); cells.reverse();
  // string-pull: drop waypoints that a straight walk can skip
  const pts = cells.map(k => ({ x: (k % NN + .5) * CN, y: (((k / NN) | 0) + .5) * CN }));
  if (pts.length) pts[pts.length - 1] = { x: x1, y: y1 };
  const sc = { x: (s % NN + .5) * CN, y: (((s / NN) | 0) + .5) * CN };
  if (pts.length && G.map.wl.length && crossesWall(x0, y0, pts[0].x, pts[0].y) && !crossesWall(x0, y0, sc.x, sc.y)) pts.unshift(sc); // a wall between the unit and the next cell: round by the start cell's centre, on its side
  if (raw) return pts.length ? pts : [{ x: x1, y: y1 }];
  const out = []; let ax = x0, ay = y0, i = 0;
  while (i < pts.length) { let j = pts.length - 1; while (j > i && !straight(ax, ay, pts[j].x, pts[j].y)) j--; out.push(pts[j]); ax = pts[j].x; ay = pts[j].y; i = j + 1; }
  return out.length ? out : [{ x: x1, y: y1 }];
}
function straight(ax, ay, bx, by) { if (G.map.wl.length && crossesWall(ax, ay, bx, by)) return false; const d = hyp(bx - ax, by - ay), n = Math.ceil(d / 20); for (let q = 1; q <= n; q++) { const x = lerp(ax, bx, q / n), y = lerp(ay, by, q / n), k = clamp(Math.floor(y / CN), 0, NN - 1) * NN + clamp(Math.floor(x / CN), 0, NN - 1); if (!navOK(k) || NAV.cost[k] > 2.2) return false; } return true; }

// ---------------------------------------------------------------- making an army
let UID = 1;
function mkUnit(team, type, men, x, y, a, o = {}) {
  const T = UT[type];
  const u = { id: UID++, team, type, T, name: o.name || T.name, men, men0: men, x, y, a, vx: 0, vy: 0, wound: 0, sh: (T.shield || 0) * men, morale: (o.morale || T.morale), m0: o.morale || T.morale,
    ammo: T.ammo, ammo2: T.wpn2 ? WPN[T.wpn2].ammo : 0, state: 'idle', order: null, path: null, run: false, fire: true, target: null, cd: R(), cd2: R() * 4,
    melee: null, chargeT: -99, lossLog: [], routs: 0, rallyT: 0, leader: !!o.leader, cmdr: o.cmdr || null, exp: o.exp || 0, stam: 1, fall: o.fall || null, gone: false, kills: 0, eq: o.eq || 1, wave: o.wave || 0, hold: !!o.hold, home: o.home || null };
  u.wpn = WPN[T.wpn]; u.wpn2 = T.wpn2 ? WPN[T.wpn2] : null; u.width = defaultWidth(u);
  return u;
}
const defaultWidth = u => u.T.art || u.T.aa ? Math.min(u.men, 6) : u.type === 'peerless' ? Math.min(u.men, 12) : u.type === 'starshell' ? Math.min(u.men, 8) : clamp(Math.round(Math.sqrt(u.men * 3.2)), 4, 60);
// the ground a unit covers: frontage across, depth behind
export function footprint(u) { const files = Math.max(1, Math.min(u.men, u.width)), ranks = Math.max(1, Math.ceil(u.men / files)); return { files, ranks, w: files * u.T.sp, d: ranks * u.T.sp * 1.15 }; }
export const radiusOf = u => { const f = footprint(u); return Math.max(6, Math.max(f.w, f.d) * .5); };

// split men of one kind into units of a sensible size
function unitize(men, ideal, max) { if (men < 1) return []; const n = clamp(Math.round(men / ideal), 1, max), out = [], each = Math.floor(men / n); for (let k = 0; k < n; k++) out.push(k === n - 1 ? men - each * (n - 1) : each); return out.filter(m => m > 0); }

// the attacker's drop, wave by wave; the defender's garrison by its power's customs
const MIX = {
  rep: { legion: .55, railmen: .15, obsidian: .27, peerless: .03 },  // the Free Legions: Reds, Grays and Obsidians, few Golds
  soc: { legion: .63, railmen: .14, obsidian: .19, peerless: .04 },  // the Remnant: Gold-officered, deep Gray legions
  rim: { legion: .6, railmen: .17, obsidian: .16, peerless: .07 },   // the Moon Lords: Gold knights and their retainers
  neu: { legion: .8, railmen: .14, obsidian: .05, peerless: .01 },
};
export const mixOf = f => MIX[f] || MIX.neu;

export function setup(spec, opts = {}) {
  R = opts.seed != null ? rng(opts.seed) : Math.random; UID = 1;
  for (const k in G) delete G[k];
  Object.assign(G, { army: null, on: true, spec, t: 0, phase: 'deploy', units: [], fx: [], feed: [], pods: [], zones: [], over: null, speed: 1, paused: false, stats: [{ killed: 0, lost: 0 }, { killed: 0, lost: 0 }], storkT: 100, storksDone: false, holdT: 0, maxT: spec.maxT || 1800, leaderLost: [false, false], aaCover: [], human: opts.human == null ? 0 : opts.human, broke: [false, false] });
  cAcc = 0; aiAcc = [0, 0]; mAcc = 0; // each battle starts its clocks from zero
  G.map = buildMap(spec); buildNav();
  deployDefender(spec);
  return G;
}
// the attacker's units, built but not yet on the ground: they fall at the drop zones when the Rain begins
function buildDrop(spec) {
  const A = spec.att, M = mixOf(A.f), waves = [[], []];
  // first wave: starShells from the spitTubes, the leechCraft's mixed legions, the commander and his guard
  const shells = Math.round(A.shells || 0);
  for (const m of unitize(shells, 25, 16)) waves[0].push(['starshell', m, { eq: 6 }]);
  const leech = Math.round(A.leech || 0);
  for (const k of ['legion', 'railmen', 'obsidian', 'peerless']) for (const m of unitize(Math.round(leech * M[k]), k === 'peerless' ? 100 : k === 'legion' ? 1000 : 500, k === 'legion' ? 12 : 6)) waves[0].push([k, m, {}]);
  if (A.cmdr) waves[0].push(['peerless', A.guard || 120, { leader: true, cmdr: A.cmdr, name: A.cmdr + (A.guardName ? ' · ' + A.guardName : ''), morale: 100 }]);
  // second wave: the Storks' legions, mostly Grays
  const st = Math.round(A.storks || 0), S2 = { legion: .74, railmen: .16, obsidian: .08, peerless: .02 };
  for (const k in S2) for (const m of unitize(Math.round(st * S2[k]), k === 'legion' ? 1000 : k === 'peerless' ? 100 : 500, k === 'legion' ? 24 : 8)) waves[1].push([k, m, { wave: 1 }]);
  return waves;
}
function deployDefender(spec) {
  const D = spec.def, M = mixOf(D.f), city = G.map.city, sites = G.map.sites, mor = D.morale || 1;
  const men = Math.round(D.men);
  const list = [];
  for (const k of ['legion', 'railmen', 'obsidian', 'peerless']) for (const m of unitize(Math.round(men * M[k]), k === 'peerless' ? 100 : k === 'legion' ? 1000 : 500, k === 'legion' ? 20 : 8)) list.push([k, m]);
  const pods = 3 * (1 + Math.min(1, D.fort || 0) + Math.floor((D.barracks || 0) / 2)), /* a higher Fortress already fields more men (camp.js dmul): its guns are not counted twice */ aa = clamp(2 * (1 + (D.gun || 0)), 2, 10);
  for (let q = 0; q < Math.min(12, pods); q++) list.push(['gravpod', 6]);
  for (let q = 0; q < aa; q++) list.push(['sarissa', 4]);
  if (D.cmdr) list.push(['peerless', D.guard || 100, D.cmdr]);
  // posts: the three sites first, then the gates and the city's edge toward the plain, the reserve in the middle
  let si = 0;
  for (const [k, m, cmdr] of list) {
    let x, y, hold = true, a = PI * 1.5 + PI; // face the plain (south: -y)
    a = -PI / 2;
    if (k === 'sarissa') { const ang = R() * TAU, rr = city.r * (.25 + R() * .4); x = city.x + Math.cos(ang) * rr; y = city.y + Math.sin(ang) * rr; }
    else if (k === 'gravpod') { const s = sites[si++ % sites.length]; x = s.x + (R() - .5) * 160; y = s.y - 140 + (R() - .5) * 80; }
    else if (k === 'peerless' || k === 'obsidian') { x = city.x + (R() - .5) * 500; y = city.y + (R() - .5) * 300; hold = false; }
    else { const s = sites[si++ % sites.length]; const ang = R() * TAU; x = s.x + Math.cos(ang) * 150; y = s.y + Math.sin(ang) * 120 - 60; }
    const u = mkUnit(1, k, m, x, y, a, { morale: Math.round(UT[k].morale * mor), hold, leader: !!cmdr, cmdr: cmdr || null, name: cmdr ? cmdr + ' · the Garrison Guard' : null });
    u.post = { x, y }; G.units.push(u);
  }
  G.drop = buildDrop(spec);
  // the anti-air umbrella: the city's guns, and each Sarissa battery's own reach
  G.aaCity = (D.gun || 0) * .12 + (D.shield || 0) * .05;
}

// ---------------------------------------------------------------- drop zones and the Rain
export const MAXZ = 4;
export const ZONE_HOLD = 650; // a beachhead is held by what stands within this of it
export function zoneOK(x, y) {
  if (x < 300 || y < 300 || x > MAP - 300 || y > MAP - 300) return 'Too near the edge of the field';
  if (isWater(x, y)) return 'Open water: the starShells would sink';
  if (hyp(x - G.map.city.x, y - G.map.city.y) < G.map.city.r * .85) return 'Inside the city: the drop would land on the guns';
  return null;
}
// how much of a drop dies in the sky over this point: the world's guns everywhere, and each Sarissa battery near it
export function aaAt(x, y) {
  let k = G.aaCity * .5;
  for (const u of G.units) if (!u.gone && u.T.aa && u.men > 0 && u.state !== 'rout') { const d = hyp(u.x - x, u.y - y), R0 = u.wpn.aa; if (d < R0) k += .16 * (1 - d / R0 * .6) * (u.men / u.men0); }
  return clamp(k, 0, .75);
}
export function addZone(x, y) { const e = zoneOK(x, y); if (e) return e; if (G.zones.length >= MAXZ) G.zones.shift(); G.zones.push({ x, y, id: G.zones.length }); return null; }
export function aiZones() { // the attacker AI: drop wide of the guns, one zone on each flank and one on the axis
  const c = G.map.city; G.zones = [];
  for (const a of [-.9, -.3, .3, .9]) { let best = null, bs = -Infinity;
    for (let k = 0; k < 40; k++) { const ang = -PI / 2 + a + (R() - .5) * .4, d = c.r + 600 + R() * 800, x = c.x + Math.cos(ang) * d, y = c.y + Math.sin(ang) * d; if (zoneOK(x, y)) continue;
      const s = -aaAt(x, y) * 3000 - Math.abs(d - (c.r + 1000)) - (isUrban(x, y) ? 200 : 0); if (s > bs) { bs = s; best = { x, y }; } }
    if (best) G.zones.push({ x: best.x, y: best.y, id: G.zones.length }); }
}
// the Rain begins: the first wave falls, split between the zones, the heavy suits first
export function beginRain() {
  if (!G.zones.length) aiZones();
  if (!G.zones.length) { // nowhere the AI likes: the driest open ground on the plain below the city
    let best = null, bh = -Infinity; for (let k = 0; k < 200; k++) { const x = 400 + R() * (MAP - 800), y = 400 + R() * (G.map.city.y - G.map.city.r - 800); if (isWater(x, y) || isUrban(x, y)) continue; const h = heightAt(x, y); if (h > bh) { bh = h; best = { x, y }; } }
    G.zones.push(Object.assign(best || { x: MAP / 2, y: MAP * .2 }, { id: 0 })); }
  G.zones.forEach((z, i) => { z.id = i; });
  G.phase = 'battle'; G.t = 0;
  const W = G.drop[0].slice().sort((a, b) => (b[0] === 'starshell') - (a[0] === 'starshell'));
  W.forEach(([k, m, o], i) => { const z = G.zones[i % G.zones.length]; land(k, m, o, z, 4 + i * 1.6 + R() * 2, 0); });
  log(`The Iron Rain falls on ${G.map.B.city}: ${W.length} cohorts from the spitTubes.`, 'gold');
}
function land(k, m, o, z, t, wave) {
  const sc = wave ? 160 : 240; let x = z.x, y = z.y;
  for (let k = 0; k < 12; k++) { const a = R() * TAU, r = sc * R(), tx = clamp(z.x + Math.cos(a) * r, 60, MAP - 60), ty = clamp(z.y + Math.sin(a) * r, 60, MAP - 60); if (!isWater(tx, ty)) { x = tx; y = ty; break; } } // the scatter never puts a cohort in the sea
  const u = mkUnit(0, k, m, x, y, PI / 2, Object.assign({}, o, { fall: { t, z: z.id, wave } }));
  // facing: toward the city
  u.a = Math.atan2(G.map.city.y - y, G.map.city.x - x); u.state = 'fall'; u.zone = z.id;
  G.units.push(u); G.pods.push({ u, t0: G.t, t1: G.t + t, x, y, wave });
}
// a falling unit reaches the ground: what the sky took is gone
function touchDown(u) {
  const aa = aaAt(u.x, u.y), lost = u.type === 'starshell' ? aa * .5 : aa; // the heavy suits ride through more of it
  const dead = Math.round(u.men * clamp(lost * (.75 + R() * .5), 0, .9));
  u.men -= dead; u.men0 = Math.max(u.men, 1); u.sh = (u.T.shield || 0) * u.men; G.stats[0].lost += dead; G.skyLost = (G.skyLost || 0) + dead * u.eq;
  u.state = 'idle'; u.fall = null; u.width = defaultWidth(u);
  if (u.men <= 0) { u.gone = true; u.state = 'dead'; }
  G.fx.push({ k: 'land', x: u.x, y: u.y, big: u.type === 'starshell' });
}
// the Storks: they land only on a zone the attackers hold
export const zoneHeld = z => { let a = 0, d = 0; for (const u of G.units) { if (u.gone || u.state === 'rout' || u.state === 'fall') continue; const r = hyp(u.x - z.x, u.y - z.y); if (r < ZONE_HOLD) { if (u.team === 0) a += u.men * u.eq; else d += u.men * u.eq; } } return a > 30 && a > d * 1.2; };
function storks() {
  if (G.storksDone || G.t < G.storkT) return;
  const held = G.zones.filter(zoneHeld), W = G.drop[1];
  if (!W.length) { G.storksDone = true; return; }
  if (!held.length) { if (G.t > 420) { G.storksDone = true; log('The Storks turn back: there is no beachhead left to land on.', 'bad'); } else G.storkT = G.t + 30; return; }
  G.storksDone = true;
  W.forEach(([k, m, o], i) => land(k, m, Object.assign({}, o), held[i % held.length], 8 + i * 2 + R() * 3, 1));
  log(`The Storks come down on ${held.length} beachhead${held.length > 1 ? 's' : ''} with ${W.reduce((a, x) => a + x[1], 0).toLocaleString()} legionnaires.`, 'gold');
}

// ---------------------------------------------------------------- orders
export function order(u, o) {
  if (u.gone || u.state === 'rout' || u.state === 'fall') return;
  u.order = o; u.path = null; u.hold = false;
  if (o.type === 'move') { u.path = findPath(u.x, u.y, o.x, o.y, u.T.fly); if (o.width) u.width = clamp(Math.round(o.width / u.T.sp), 1, Math.max(1, u.men)); if (o.run != null) u.run = o.run; u.target = null; }
  if (o.type === 'attack') { u.target = o.t; if (o.run != null) u.run = o.run; u.path = null; }
  if (o.type === 'breach') { if (!canBreach(u)) { u.order = null; return; } u.target = null; if (o.run != null) u.run = o.run; u.path = null; }
  if (o.type === 'halt') { u.order = null; u.path = null; u.target = null; u.vx = u.vy = 0; u.hold = true; }
}
// a group move keeps its shape: each unit's offset from the group's centre is turned to the new facing
export function groupMove(us, x, y, face, run, width) {
  us = us.filter(u => !u.gone && u.state !== 'rout' && u.state !== 'fall'); if (!us.length) return;
  const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cy = us.reduce((a, u) => a + u.y, 0) / us.length;
  const a = face != null ? face : Math.atan2(y - cy, x - cx);
  if (width && us.length > 1) { // a dragged line: the units abreast along it
    const tot = us.reduce((s, u) => s + footprint(u).w + 8, 0), k = width / tot; let off = -width / 2;
    const px = Math.cos(a + PI / 2), py = Math.sin(a + PI / 2);
    const sorted = us.slice().sort((p, q) => ((p.x - cx) * px + (p.y - cy) * py) - ((q.x - cx) * px + (q.y - cy) * py));
    for (const u of sorted) { const w = (footprint(u).w + 8) * k; off += w / 2; order(u, { type: 'move', x: x + px * off, y: y + py * off, a, run, width: Math.max(u.T.sp, w - 8) }); off += w / 2; }
    return;
  }
  if (width && us.length === 1) { order(us[0], { type: 'move', x, y, a, run, width }); return; }
  const a0 = Math.atan2(y - cy, x - cx), rot = a - a0;
  for (const u of us) { const dx = u.x - cx, dy = u.y - cy, c = Math.cos(us.length > 1 ? rot : 0), s = Math.sin(us.length > 1 ? rot : 0); order(u, { type: 'move', x: x + dx * c - dy * s, y: y + dx * s + dy * c, a, run }); }
}

// ---------------------------------------------------------------- the step
export const MOVE_FIRE = { walk: .6, run: .35 }; // accuracy of infantry fire on the move
const STEP = .1, CSTEP = .5, FIRE_K = .45, MELEE_K = .38; // global lethality, tuned so an even firefight breaks a side in about a minute
let cAcc = 0, aiAcc = [0, 0], mAcc = 0;
export const live = u => !u.gone && u.men > 0 && u.state !== 'fall';
export const fighting = u => live(u) && u.state !== 'rout';
export function step(dt) {
  if (!G.on || G.over || G.phase !== 'battle') return;
  let acc = dt; while (acc > 1e-6) { const h = Math.min(STEP, acc); tick(h); acc -= h; if (G.over) return; }
  if (G.fx.length > 20000) G.fx.splice(0, G.fx.length - 20000); // headless, nobody draws them
}
function tick(dt) {
  G.t += dt;
  for (const p of G.pods) if (p.u.state === 'fall' && G.t >= p.t1) touchDown(p.u);
  G.pods = G.pods.filter(p => p.u.state === 'fall' || G.t < p.t1 + 3);
  storks();
  for (const u of G.units) if (live(u)) move(u, dt);
  separate(dt);
  cAcc += dt; if (cAcc >= CSTEP) { combat(cAcc); cAcc = 0; }
  mAcc += dt; if (mAcc >= .5) { morale(mAcc); objectives(mAcc); mAcc = 0; }
  for (const t of [0, 1]) { aiAcc[t] += dt; if (aiAcc[t] >= 2) { aiAcc[t] = 0; if (G.human !== t) ai(t); else autoUnits(t); } }
  checkEnd();
}

// movement: along the path, at the walk or the run, slowed by streets, woods and slopes; low gravity is quick
function speedOf(u) {
  const T = u.T, gK = 1 + (1 - G.map.B.g) * .35, rout = u.state === 'rout';
  let v = (rout || u.run || (u.order && u.order.type === 'attack' && u.melee == null && dist2(u, u.target) < 160 * 160) ? T.run : T.walk) * gK;
  if (!T.fly) { if (isUrban(u.x, u.y)) v *= .7; else if (G.map.veg[cellOf(u.x, u.y)]) v *= .82; const s = Math.abs(heightAt(u.x + Math.cos(u.a) * 15, u.y + Math.sin(u.a) * 15) - heightAt(u.x, u.y)) / 15; v *= clamp(1 - s * 1.5, .45, 1); }
  if (u.stam < .3) v *= .75;
  if (!T.fly && isDeep(u.x, u.y)) v *= .4; // fording
  return v;
}
const dist2 = (a, b) => b ? (a.x - b.x) ** 2 + (a.y - b.y) ** 2 : Infinity;
function move(u, dt) {
  let tx = null, ty = null, face = null;
  if (u.state === 'rout') { if (!u.path || !u.path.length) { const e = escapeOf(u); u.path = findPath(u.x, u.y, e.x, clamp(e.y, 10, MAP - 10), u.T.fly); u.path.push(e); } }
  else if (u.melee) { u.vx = u.vy = 0; face = Math.atan2(u.melee.y - u.y, u.melee.x - u.x); }
  else if (u.order && u.order.type === 'attack' && u.target) {
    const t = u.target; if (!fighting(t)) { u.order = null; u.target = null; u.path = null; }
    else { const d = Math.sqrt(dist2(u, t)), rng0 = u.wpn.range * .85, melee = u.T.mel >= 6 || u.ammo <= 0;
      if (melee || d > rng0 || !los(u.x, u.y, t.x, t.y)) { if (!u.path || (u.repath || 0) < G.t) { u.path = findPath(u.x, u.y, t.x, t.y, u.T.fly); u.repath = G.t + 2.5; } }
      else { u.path = null; face = Math.atan2(t.y - u.y, t.x - u.x); } }
  } else if (u.order && u.order.type === 'breach') { // to a post within reach of the wall, then stand and shoot
    const w = G.map.walls[u.order.w];
    if (!w || w.down) { u.order = null; u.path = null; }
    else { const d = segDist(u.x, u.y, w), m = wallMid(w);
      if (d > u.wpn.range * .85) { if ((u.repath || 0) < G.t) { const p = breachPost(u, w); u.path = findPath(u.x, u.y, p.x, p.y, u.T.fly); u.repath = G.t + 4; } }
      else { u.path = null; face = Math.atan2(m.y - u.y, m.x - u.x); } }
  } else if (u.aim && fighting(u.aim) && !u.path) face = Math.atan2(u.aim.y - u.y, u.aim.x - u.x);
  // arriving in a crowd: a unit that has made no headway for six seconds close to the end of its move has arrived
  if (u.path && u.path.length && u.order && u.order.type === 'move') { const e = u.path[u.path.length - 1]; if (!u.prog || hyp(u.x - u.prog.x, u.y - u.prog.y) > 4) u.prog = { x: u.x, y: u.y, t: G.t };
    else if (G.t - u.prog.t > 6 && hyp(e.x - u.x, e.y - u.y) < 70 + radiusOf(u)) { u.path = null; u.faceTo = u.order.a; u.order = null; u.prog = null; }
    else if (G.t - u.prog.t > 8) { // no headway, far from the end: sidestep out of the jam, and after a few tries ford whatever water is in the way
      const side = (u.side = -(u.side || 1)), p0 = u.path[0], a = Math.atan2(p0.y - u.y, p0.x - u.x) + side * PI / 2; u.path.unshift({ x: clamp(u.x + Math.cos(a) * 60, 10, MAP - 10), y: clamp(u.y + Math.sin(a) * 60, 10, MAP - 10) });
      u.unstick = (u.unstick || 0) + 1; if (u.unstick > 1) u.ford = G.t + 12; u.prog = { x: u.x, y: u.y, t: G.t }; } }
  if (u.path && u.path.length) { const p = u.path[0]; tx = p.x; ty = p.y; if (hyp(tx - u.x, ty - u.y) < 8) { u.path.shift(); if (!u.path.length) { u.path = null; tx = null; if (u.order && u.order.type === 'move') { if (u.order.a != null) face = u.order.a; u.faceTo = u.order.a; u.order = null; } } } }
  if (tx != null) {
    const dx = tx - u.x, dy = ty - u.y, v = speedOf(u), want = Math.atan2(dy, dx), turn = (u.T.fly ? 4 : 1.6) * dt;
    u.a += clamp(angDiff(u.a, want), -turn, turn);
    const k = Math.max(.15, Math.cos(angDiff(u.a, want))); u.vx = Math.cos(want) * v * k; u.vy = Math.sin(want) * v * k;
    let nx = u.x + u.vx * dt, ny = u.y + u.vy * dt;
    if (!u.T.fly && ((isDeep(nx, ny) && !isDeep(u.x, u.y) && !(u.ford > G.t)) || crossesWall(u.x, u.y, nx, ny))) { // blocked: find a way round (a unit already in the water may wade out)
      nx = u.x; ny = u.y; u.vx = u.vy = 0; const last = u.path[u.path.length - 1];
      if ((u.blockT || 0) < G.t) { u.path = findPath(u.x, u.y, last.x, last.y, false, true); u.blockT = G.t + 1.5; u.stuck = (u.stuck || 0) + 1; if (u.stuck > 4 && u.state === 'rout') { u.path = null; u.stuck = 0; } } }
    else u.stuck = 0;
    u.x = clamp(nx, 5, MAP - 5); u.y = clamp(ny, 5, MAP - 5);
    if (u.run || u.state === 'rout') u.stam = Math.max(0, u.stam - dt * .006); else u.stam = Math.min(1, u.stam + dt * .004);
  } else { u.vx = u.vy = 0; u.stam = Math.min(1, u.stam + dt * .01); if (face == null && u.faceTo != null) face = u.faceTo; }
  if (face != null) { const turn = 1.4 * dt, da = angDiff(u.a, face); u.a += clamp(da, -turn, turn); if (Math.abs(da) < .02 && face === u.faceTo) u.faceTo = null; }
  if (u.state !== 'rout') u.state = u.melee ? 'melee' : (hyp(u.vx, u.vy) > .3 ? 'move' : u.firing ? 'fire' : 'idle');
}
// where a routing unit runs: attackers to the nearest drop zone and then off the south edge, defenders off the north
function escapeOf(u) { if (u.team === 1) return { x: u.x, y: MAP + 50 }; return { x: u.x, y: -50 }; }
// units of the same side do not stand in each other; enemies who touch are in melee
function separate(dt) {
  const L = G.units.filter(live);
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j], dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy) || .01, ra = radiusOf(a), rb = radiusOf(b), R0 = (ra + rb) * .75;
    if (d >= R0) continue;
    if (a.team === b.team) { if (a.T.fly || b.T.fly) continue; const push = (R0 - d) * .5 * Math.min(1, dt * 3); let ux = dx / d, uy = dy / d;
      const va = hyp(a.vx, a.vy) > .3, vb = hyp(b.vx, b.vy) > .3, ma = va ? .35 : 1, mb = vb ? .35 : 1, s = ma + mb; // a halted unit gives way to one on the march
      if (va && vb && a.vx * b.vx + a.vy * b.vy < 0) { ux += -uy * .8; uy += ux * .8; const n = hyp(ux, uy) || 1; ux /= n; uy /= n; } // head-on: slide past each other
      const ax = a.x - ux * push * ma / s * 2, ay = a.y - uy * push * ma / s * 2, bx = b.x + ux * push * mb / s * 2, by = b.y + uy * push * mb / s * 2;
      if (!crossesWall(a.x, a.y, ax, ay) && (!isDeep(ax, ay) || isDeep(a.x, a.y))) { a.x = ax; a.y = ay; }
      if (!crossesWall(b.x, b.y, bx, by) && (!isDeep(bx, by) || isDeep(b.x, b.y))) { b.x = bx; b.y = by; } }
  }
}

// ---------------------------------------------------------------- fire and steel
function enemiesOf(t) { return G.units.filter(u => u.team !== t && fighting(u)); }
function pickTarget(u, foes) {
  if (u.target && fighting(u.target) && u.order && u.order.type === 'attack') return u.target;
  let best = null, bs = Infinity; const R0 = u.wpn.range;
  for (const e of foes) { const d = Math.sqrt(dist2(u, e)); if (d > R0) continue; const ang = Math.abs(angDiff(u.a, Math.atan2(e.y - u.y, e.x - u.x)));
    const pref = (u.wpn.ap >= 6 && e.T.armor >= 6 ? .5 : 1) * (e.melee ? 1.4 : 1) * (ang > 1.3 ? 1.5 : 1); const s = d * pref; if (s < bs && los(u.x, u.y, e.x, e.y)) { bs = s; best = e; } }
  return best;
}
function hitsOn(u, w, t, shooters, dt, d) {
  const fall = clamp(1.25 - d / w.range * .7, .35, 1.1), cov = 1 - (t.T.fly ? 0 : coverAt(t.x, t.y)) * (t.team === 1 && nearWall(t.x, t.y, 30) ? 1.4 : 1),
    size = t.T.size / 1.7, mv = hyp(t.vx, t.vy) > 1 ? .8 : 1, wav = u.morale < 30 ? .7 : 1, vet = 1 + u.exp * .08;
  return shooters * w.rof * FIRE_K * dt * w.acc * fall * clamp(cov, .2, 1) * clamp(size, .6, 2) * mv * wav * vet;
}
function harm(t, dmg, ap, by, kind) {
  if (G.debug && by) { const key = by.type + '>' + t.type; (G.dmgLog = G.dmgLog || {})[key] = (G.dmgLog[key] || 0) + dmg * PEN(ap, t.T.armor); }
  if (dmg <= 0 || !live(t)) return 0;
  let d = dmg * PEN(ap, t.T.armor);
  if (t.sh > 0) { const s = Math.min(t.sh, d * .9); t.sh -= s; d -= s; t.shHit = G.t; }
  t.wound += d; const per = t.T.hp; let k = Math.floor(t.wound / per);
  if (k > 0) { k = Math.min(k, t.men); t.men -= k; t.wound -= k * per; t.lossLog.push([G.t, k]); t.lostNow = (t.lostNow || 0) + k; G.stats[t.team].lost += k * t.eq; G.stats[1 - t.team].killed += k * t.eq; if (by) by.kills += k;
    if (t.men <= 0) { t.gone = true; t.state = 'dead'; t.melee = null; log(`${t.name} ${t.team === G.human ? 'are' : 'is'} destroyed.`, t.team === G.human ? 'bad' : 'good'); if (t.leader) leaderDown(t); } }
  return k;
}
function combat(dt) {
  const foesOf = [enemiesOf(0), enemiesOf(1)];
  for (const u of G.units) {
    if (!fighting(u)) { u.firing = false; continue; }
    u.firing = false; u.sieging = false;
    // shields cool and recharge when not hit for a while
    if (u.T.shield && G.t - (u.shHit || -99) > 4) u.sh = Math.min(u.T.shield * u.men, u.sh + u.men * .25 * dt);
    if (u.melee) continue;
    const foes = foesOf[u.team];
    // a unit at the run, or on the march, does not stop to shoot; starShells, knights and gravPods fire on the move
    // the Society's arms are smart-sighted: infantry fires on the move, less surely walking and much less at the run;
    // starShells, knights and gravPods fire on the move at no cost
    const moving = hyp(u.vx, u.vy) > .5, mobileFire = u.T.fly || u.type === 'starshell' || u.T.art;
    if (!u.fire || u.ammo <= 0) continue;
    const mk = !moving || mobileFire ? 1 : (u.run || u.state === 'rout' ? MOVE_FIRE.run : MOVE_FIRE.walk);
    const t = pickTarget(u, foes); u.aim = t;
    if (u.order && u.order.type === 'breach' && (!t || dist2(u, t) > 200 * 200) && siegeFire(u, dt, mk)) continue; // the wall first, unless the enemy is close
    if (!t) continue;
    const d = Math.sqrt(dist2(u, t)); if (d > u.wpn.range) continue;
    if (!u.T.fly && !u.T.art && !u.T.aa && Math.abs(angDiff(u.a, Math.atan2(t.y - u.y, t.x - u.x))) > (moving ? 1.6 : 1.1)) continue; // still wheeling to face it (on the march, men fire over the shoulder)
    const front = Math.min(u.men, u.width * 2); // the first two ranks shoot
    const hits = hitsOn(u, u.wpn, t, u.T.art || u.T.aa ? u.men : front, dt, d) * mk, dens = clamp(t.men / Math.max(40, footprint(t).w * footprint(t).d) * 6, .4, 3);
    harm(t, hits * u.wpn.dmg * (u.wpn.splash ? u.wpn.splash * dens : 1), u.wpn.ap, u, u.wpn.fx);
    u.ammo -= dt * .5; u.firing = true; t.underFire = G.t; if (u.T.fear) t.feared = Math.max(t.feared || 0, u.T.fear);
    fxShot(u, t, u.wpn.fx, Math.min(6, Math.ceil(front / 40)));
    if (u.wpn2 && u.ammo2 > 0 && (u.cd2 -= dt) <= 0 && d < u.wpn2.range) { u.cd2 = 1 / u.wpn2.rof / Math.max(1, u.men / 4); u.ammo2--; harm(t, u.men * u.wpn2.dmg * u.wpn2.acc * u.wpn2.splash * dens * .25, u.wpn2.ap, u); fxShot(u, t, 'missile', 2); }
  }
  // melee: enemies who touch fight; whoever ran in hits harder for the first seconds; a blow on the flank or rear hurts more
  const L = G.units.filter(fighting);
  for (const u of L) u.melee = null;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j]; if (a.team === b.team) continue;
    const d = Math.sqrt(dist2(a, b)), R0 = (radiusOf(a) + radiusOf(b)) * .8 + 4; if (d > R0) continue;
    if (!a.melee) a.melee = b; if (!b.melee) b.melee = a;
    if (!a.engT || G.t - a.engT > CSTEP * 2.5) { if (hyp(a.vx, a.vy) > a.T.walk * 1.15) a.chargeT = G.t; } if (!b.engT || G.t - b.engT > CSTEP * 2.5) { if (hyp(b.vx, b.vy) > b.T.walk * 1.15) b.chargeT = G.t; }
    a.engT = b.engT = G.t;
    blow(a, b, dt); blow(b, a, dt);
  }
}
function blow(a, b, dt) {
  const ang = Math.abs(angDiff(b.a, Math.atan2(a.y - b.y, a.x - b.x))), flank = ang > 2.2 ? 2.2 : ang > 1.2 ? 1.5 : 1;
  const charging = G.t - a.chargeT < 6 ? a.T.charge : 0, fighters = Math.min(a.men, Math.max(4, footprint(a).files * 2)), wav = a.morale < 30 ? .6 : 1, tired = a.stam < .3 ? .8 : 1;
  const att = (a.T.mel + charging) * (1 + a.exp * .08), def = b.T.def / flank;
  const p = clamp(.5 + (att - def) * .04, .08, .92);
  const dmg = fighters * dt * .25 * MELEE_K * p * wav * tired * (a.T.mass > 3 ? 1.6 : 1);
  const ap = a.type === 'peerless' ? 9 : a.type === 'obsidian' ? 4 : a.type === 'starshell' ? 8 : 2; // razors cut anything; pulseAxes and ionPikes go through duroArmor, not a starShell
  harm(b, dmg * (a.T.mel >= 8 ? 2.2 : 1), ap, a, 'melee');
  if (flank > 1) b.flanked = G.t; if (charging && G.t - a.chargeT < CSTEP * 1.5) { b.morale -= a.T.charge * .45 * (b.T.low ? 1.3 : 1) * (1 - (b.T.resolve || 0)); G.fx.push({ k: 'charge', x: b.x, y: b.y }); }
  if (Math.random() < .5) G.fx.push({ k: 'melee', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: a.team });
}
function fxShot(u, t, kind, n) {
  for (let q = 0; q < n; q++) { const f = footprint(u), ft = footprint(t), ox = (Math.random() - .5) * f.w, oy = (Math.random() - .5) * f.d, tx = (Math.random() - .5) * ft.w, ty = (Math.random() - .5) * ft.d;
    const c = Math.cos(u.a + PI / 2), s = Math.sin(u.a + PI / 2), c2 = Math.cos(t.a + PI / 2), s2 = Math.sin(t.a + PI / 2);
    G.fx.push({ k: 'shot', f: kind, x0: u.x + c * ox, y0: u.y + s * ox, x1: t.x + c2 * tx, y1: t.y + s2 * tx, team: u.team, d: Math.random() * .5 }); }
}

// ---------------------------------------------------------------- morale
function leaderDown(u) {
  const side = u.team; G.leaderLost[side] = true;
  log(`${u.cmdr || u.name} has fallen! The ${side === 0 ? 'legions' : 'garrison'} waver.`, side === G.human ? 'bad' : 'good');
  for (const v of G.units) if (v.team === side && fighting(v)) { v.morale -= 15 * (1 - (v.T.resolve || 0)); v.m0 = Math.max(20, v.m0 - 8); }
}
function morale(dt) {
  const L = G.units.filter(live);
  for (const u of L) {
    // recent losses: the share of the unit lost in the last ten seconds
    // losses shake a unit as they happen; a unit that keeps bleeding cannot steady itself
    u.lossLog = u.lossLog.filter(e => G.t - e[0] < 10); const recent = u.lossLog.reduce((a, e) => a + e[1], 0) / Math.max(1, u.men + 1), fresh = (u.lostNow || 0) / Math.max(1, u.men + (u.lostNow || 0)); u.lostNow = 0;
    let cap = u.m0 * (.45 + .55 * u.men / u.men0), drift = 0;
    drift -= fresh * 75; if (recent > .18) drift -= 1 * dt;
    if (u.flanked && G.t - u.flanked < 2) drift -= 4 * dt;
    let near = 0, auraK = 0, outn = 0, fear = 0;
    for (const v of L) { const d = Math.sqrt(dist2(u, v)); if (d > 520) continue;
      if (v.team === u.team) { if (v.state === 'rout' && v !== u && d < 350 && G.t - (v.routT || 0) < 20) near++; if (v.T.aura && v.state !== 'rout') auraK = Math.max(auraK, v.T.aura * (v.leader ? 1.6 : 1)); }
      else if (fighting(v)) { if (d < 350) outn += v.men * v.eq; if (v.T.fear && d < 220) fear = Math.max(fear, v.T.fear * Math.min(1, v.men / 60)); } }
    // the terror of Obsidians, knights and starShells close at hand: lowColors feel it most, a Gold nearby steadies them
    if (fear) drift -= fear * (u.T.low ? .15 : .06) * (auraK ? .5 : 1) * dt;
    drift -= Math.min(2, near) * .6 * dt; cap += auraK;
    if (G.debug) G.debug.push({ t: G.t, id: u.id, team: u.team, type: u.type, m: u.morale, fresh, fear, near, drift, cap, melee: !!u.melee, st: u.state });
    if (u.melee) { const mine = L.filter(v => v.team === u.team && fighting(v) && Math.sqrt(dist2(u, v)) < 350).reduce((a, v) => a + v.men * v.eq, 0); if (outn > mine * 2) drift -= 3 * dt; }
    if (!u.melee && G.t - (u.underFire || -99) > 6 && u.state !== 'rout') drift += 4 * dt;
    if (u.state === 'rout') {
      const safe = !G.units.some(v => v.team !== u.team && fighting(v) && dist2(u, v) < 480 * 480);
      if (safe) u.morale += 2.5 * dt; else u.morale = Math.max(0, u.morale - 1 * dt);
      if (safe) u.safeT = (u.safeT || 0) + dt; else u.safeT = 0;
      if (safe && u.morale > 38 && u.routs < 2 && G.t > u.rallyT) { u.state = 'idle'; u.order = null; u.path = null; u.morale = 40; log(`${u.name} rally.`, u.team === G.human ? 'good' : ''); }
      if ((u.routs >= 2 || u.T.walk < 2.5) && u.safeT > 20) { u.gone = true; u.state = 'fled'; (G.escaped = G.escaped || [0, 0])[u.team] += u.men * u.eq; log(`${u.name} scatter and are gone.`, u.team === G.human ? 'bad' : 'good'); continue; } // broken twice (or a gun crew that has left its guns) and out of reach: they will not come back
      if (u.y < 20 || u.y > MAP - 20) { u.gone = true; u.state = 'fled'; (G.escaped = G.escaped || [0, 0])[u.team] += u.men * u.eq; log(`${u.name} flee the field.`, u.team === G.human ? 'bad' : 'good'); }
      continue;
    }
    if (drift < 0) drift *= 1 - (u.T.resolve || 0); // the Peerless and the suits do not scare easily
    let m = u.morale + drift; if (drift > 0) m = Math.min(m, Math.max(cap, u.morale));
    u.morale = clamp(m, 0, 100); if (u.morale > cap) u.morale = Math.max(cap, u.morale - 2 * dt);
    if (u.morale < 12 || (u.men < u.men0 * .12 && u.men0 > 10)) { u.state = 'rout'; u.routT = G.t; u.routs++; u.melee = null; u.order = null; u.path = null; u.aim = null; u.faceTo = null; u.target = null; u.rallyT = G.t + 15; u.morale = Math.min(u.morale, 8);
      log(`${u.name} ${u.routs > 1 ? 'break again' : 'break and run'}!`, u.team === G.human ? 'bad' : 'good');
      for (const v of L) if (v.team === u.team && v !== u && fighting(v) && dist2(u, v) < 400 * 400) v.morale -= 5; }
  }
}

// ---------------------------------------------------------------- the sites
function objectives(dt) {
  const L = G.units.filter(fighting);
  for (const s of G.map.sites) {
    let a = 0, d = 0; for (const u of L) if (hyp(u.x - s.x, u.y - s.y) < s.r + radiusOf(u) * .5) { if (u.team === 0) a += u.men * u.eq; else d += u.men * u.eq; }
    s.a = a; s.d = d;
    // a site goes to whoever stands on it two to one: a garrison that keeps feeding men in cannot hold it contested for ever
    if (a > 0 && a >= d * 2) s.v = Math.min(1, s.v + dt / clamp(60 - (a - d) / 200, 20, 60) * (d ? .6 : 1));
    else if (d > 0 && d >= a * 2) s.v = Math.max(-1, s.v - dt / 40 * (a ? .6 : 1));
    const own = s.v >= 1 ? 0 : s.v <= -1 ? 1 : s.own;
    if (own !== s.own) { s.own = own; log(own === 0 ? `The legions take ${s.name}.` : `The garrison retakes ${s.name}.`, (own === G.human) ? 'good' : 'bad'); }
  }
  const held = G.map.sites.filter(s => s.own === 0).length;
  if (held >= NEED()) { G.holdT += dt; } else G.holdT = 0;
}
export const HOLD_WIN = 120;
export const NEED = () => Math.floor(G.map.sites.length / 2) + 1; // a majority of the sites

// ---------------------------------------------------------------- the end
function strengthOf(t, fall = false) { return G.units.reduce((a, u) => a + (u.team === t && !u.gone && u.men > 0 && (fall || u.state !== 'fall') && u.state !== 'rout' ? u.men * u.eq : 0), 0); }
function checkEnd() {
  if (G.over) return;
  const a = strengthOf(0, true) + (G.storksDone ? 0 : G.drop[1].reduce((s, x) => s + x[1], 0)), d = strengthOf(1);
  if (G.holdT >= HOLD_WIN) return finish(0, `The legions hold ${G.map.sites.filter(s => s.own === 0).map(s => s.name).join(' and ')}.`);
  if (d <= 0 || (d < G.def0 * .1 && !G.units.some(u => u.team === 1 && fighting(u) && u.T.aa))) return finish(0, 'The garrison is broken.');
  if (G.t > 30 && a <= 0) return finish(1, 'The drop is broken: no legion stands on the field.');
  if (G.t >= G.maxT) return finish(1, 'Time runs out: the garrison holds the city.');
}
export function finish(win, why) {
  G.over = { win, why, t: G.t }; G.phase = 'over';
  log(why, win === G.human ? 'good' : 'bad');
}
export function result() {
  const left = t => G.units.reduce((a, u) => a + (u.team === t && !u.gone && u.men > 0 ? u.men * u.eq : 0), 0) + ((G.escaped || [0, 0])[t]) * (t === 1 ? .5 : 0);
  const won = G.over ? G.over.win === 0 : false;
  return { won, why: G.over ? G.over.why : '', t: G.t, att0: G.att0, def0: G.def0, attLeft: Math.round(left(0)), defLeft: Math.round(left(1)), sky: Math.round(G.skyLost || 0), killed: [Math.round(G.stats[0].killed), Math.round(G.stats[1].killed)],
    storks: G.storksDone && G.units.some(u => u.wave === 1), leaderLost: G.leaderLost.slice(), city: G.map.B.city, sites: G.map.sites.map(s => ({ name: s.name, own: s.own })) };
}
export function log(msg, cls) { G.feed.unshift({ t: G.t, msg, cls: cls || '' }); if (G.feed.length > 40) G.feed.pop(); }

// ---------------------------------------------------------------- the AI
// One commander per side, thinking every two seconds. Each unit has a role that persists between thoughts, and a
// target it keeps unless a clearly better one appears, so charges are driven home instead of re-planned.
//  Defender: garrisons at the three sites, a reserve of knights and Obsidians round the Legate, the guns and the
//  Sarissas at their posts. The reserve sallies at a weak beachhead before the Storks can land on it, reinforces the
//  site under the heaviest threat, and retakes a site that is lost; garrisons send help only from a quiet site.
//  Attacker: gathers at its zones until the Storks are down, then advances in ranked lines at the pace of the
//  slowest; leaves a holding force on every site it takes, and once it holds two, turns to keep them.
const keepOrSwitch = (u, tg) => { const cur = u.target && fighting(u.target) && u.order && u.order.type === 'attack' ? u.target : null;
  if (!cur) return tg; if (!tg || tg === cur) return cur; return dist2(u, tg) < dist2(u, cur) * .45 ? tg : cur; };
const strike = (u, tg, run) => { const k = keepOrSwitch(u, tg); if (k && (k !== u.target || !u.order || u.order.type !== 'attack')) order(u, { type: 'attack', t: k, run }); return k; };
const goTo = (u, x, y, o = {}) => { if (u.order && u.order.type === 'move' && hyp(u.order.x - x, u.order.y - y) < 80) return; if (!u.order && hyp(u.x - x, u.y - y) < 40) return; order(u, Object.assign({ type: 'move', x, y }, o)); };
// the pin and the flank, as in any field battle since the Iron Age: a shock unit whose target is already locked in a
// fight (in melee, or shooting at someone else) does not walk into its face, it swings wide and comes in on its flank or
// rear, where a blow lands at one and a half to twice the weight and the charge shakes the line (blow, morale)
function flankPt(u, tg) {
  const a = Math.atan2(u.y - tg.y, u.x - tg.x), off = angDiff(tg.a, a); if (Math.abs(off) > 1.3) return null; // already on her side or behind her
  const side = off >= 0 ? 1 : -1, ang = tg.a + side * 2.0, r = radiusOf(tg) + radiusOf(u) + 90, x = tg.x + Math.cos(ang) * r, y = tg.y + Math.sin(ang) * r;
  if (x < 60 || y < 60 || x > MAP - 60 || y > MAP - 60 || isDeep(x, y) || (G.map.wl.length && crossesWall(u.x, u.y, x, y))) return null;
  return { x, y };
}
const pinned = (u, tg) => !!(tg.melee && tg.melee !== u) || !!(tg.aim && tg.aim !== u && tg.firing);
const charge = (u, tg) => {
  if (u.flankOf && fighting(u.flankOf) && dist2(u, u.flankOf) < 1800 * 1800 && pinned(u, u.flankOf)) tg = u.flankOf; else u.flankOf = null;
  if (!tg) return null;
  const d = Math.sqrt(dist2(u, tg));
  if (u.T.mel >= 8 && !u.melee && d > radiusOf(tg) + radiusOf(u) + 40 && d < 1800 && pinned(u, tg)) {
    const fp = flankPt(u, tg);
    if (fp && hyp(u.x - fp.x, u.y - fp.y) > 60) { if (u.flankOf !== tg) G.aist('flank'); u.flankOf = tg; goTo(u, fp.x, fp.y, { run: u.stam > .35 || u.T.fly }); return tg; }
  }
  u.flankOf = null; return strike(u, tg, true);
};
// a unit about to break steps back out of the fight to steady itself (morale recovers once nothing has hit it for six
// seconds), and goes back in once it has; a leader's guard and the guns never do
const steady = (u, bx, by) => {
  if (u.leader || u.T.art || u.T.aa) return false;
  if (u.backT && G.t < u.backT && u.morale < 46) { goTo(u, u.back.x, u.back.y, { run: true }); return true; }
  u.backT = 0;
  if (u.morale < 24 && u.men > u.men0 * .3 && (u.melee || G.t - (u.underFire || -99) < 3)) {
    const d = hyp(bx - u.x, by - u.y) || 1, k = Math.min(380, d); u.back = { x: u.x + (bx - u.x) / d * k, y: u.y + (by - u.y) / d * k }; u.backT = G.t + 14; u.melee = null; G.aist('steady');
    goTo(u, u.back.x, u.back.y, { run: true }); return true; }
  return false;
};
const strOf = L => L.reduce((a, u) => a + u.men * u.eq * (u.T.mel + u.wpn.dmg * u.wpn.rof * 10) / 10, 0); // fighting worth, not just heads
const within = (L, x, y, r) => L.filter(u => hyp(u.x - x, u.y - y) < r);
function ai(t) {
  const mine = G.units.filter(u => u.team === t && fighting(u)), foes = G.units.filter(u => u.team !== t && fighting(u));
  if (!mine.length) return;
  G.aistat = G.aistat || {}; const st = k => { G.aistat[k] = (G.aistat[k] || 0) + 1; }; G.aist = st;
  return t === 1 ? defend(mine, foes) : attack(mine, foes);
}
function defend(mine, foes) {
  const sites = G.map.sites, city = G.map.city;
  // roles, once: each line unit to the site it was posted at, the fast troops to the reserve
  for (const u of mine) if (!u.role) { if (u.T.aa || u.T.art) u.role = 'post'; else if (u.type === 'peerless' || u.type === 'obsidian') u.role = 'reserve';
    else { const s = sites.slice().sort((a, b) => hyp(a.x - u.post.x, a.y - u.post.y) - hyp(b.x - u.post.x, b.y - u.post.y))[0]; u.role = 'site'; u.site = s.id; u.post.site0 = s.id; } }
  const reserve = mine.filter(u => u.role === 'reserve');
  // the picture: enemy worth near each site, our worth there, and the beachheads
  const P = sites.map(s => { const en = within(foes, s.x, s.y, 1300), ours = mine.filter(u => u.role === 'site' && u.site === s.id); return { s, threat: strOf(en), en, ours, held: strOf(ours) }; });
  const urgent = P.filter(p => p.s.own === 0 || p.threat > p.held * 1.1).sort((a, b) => (b.s.own === 0) - (a.s.own === 0) || b.threat - a.threat)[0];
  // before the Storks: is there a beachhead the reserve can crush?
  let sally = null;
  if (!G.storksDone && reserve.length) { const rs = strOf(reserve);
    for (const z of G.zones) { const en = within(foes, z.x, z.y, ZONE_HOLD), d = hyp(z.x - city.x, z.y - city.y); if (en.length && strOf(en) < rs * .7 && d < city.r + 2200) { if (!sally || strOf(en) < sally.str) sally = { z, en, str: strOf(en) }; } } }
  if (sally) G.aist('sally'); if (urgent) G.aist(urgent.s.own === 0 ? 'retake' : 'reinforce');
  // the reserve
  for (const u of reserve) {
    if (steady(u, city.x, city.y)) continue;
    if (u.melee) continue;
    // the Legate keeps behind his reserve: his fall would shake the whole garrison (leaderDown)
    if (u.leader) { const e = nearest(u, foes), de = e ? Math.sqrt(dist2(u, e)) : Infinity; if (e && de < 200) strike(u, e, false); else { const s = urgent ? urgent.s : null, px = s ? s.x + (city.x - s.x) * .35 : u.post.x, py = s ? s.y + (city.y - s.y) * .35 : u.post.y; goTo(u, px, py); } continue; }
    let tg = null;
    if (sally) tg = bestStrike(u, sally.en, 3600); // the beachhead may be far out on the plain
    else if (urgent) tg = bestStrike(u, urgent.en.length ? urgent.en : within(foes, urgent.s.x, urgent.s.y, 1300), 2800);
    if (!tg) { const pool = foes.filter(f => hyp(f.x - city.x, f.y - city.y) < city.r + 700); tg = pool.length ? bestStrike(u, pool, 2200) : null; }
    if (tg) charge(u, tg);
    else goTo(u, u.post.x, u.post.y);
  }
  // the garrisons: hold the site; shoot what is in sight; help a site in trouble only if their own is quiet
  for (const u of mine.filter(v => v.role === 'site')) {
    if (steady(u, city.x, city.y)) continue;
    if (u.melee) continue;
    const near = nearest(u, foes), dn = near ? Math.sqrt(dist2(u, near)) : Infinity, home = P[u.site], s = home.s;
    if (near && dn < u.wpn.range * 1.02 && los(u.x, u.y, near.x, near.y)) { if (u.order && u.order.type === 'move') order(u, { type: 'halt' }); continue; }
    if (s.own === 0 || home.en.some(e => hyp(e.x - s.x, e.y - s.y) < s.r + 20)) { const e = nearest(u, home.en.length ? home.en : foes); if (e) { strike(u, e, false); continue; } } // the enemy stands on our site: throw them off it
    if (near && dn < u.wpn.range * 1.3 && hyp(near.x - s.x, near.y - s.y) < 600) { strike(u, near, false); continue; } // close but hidden: go and find them
    if (urgent && urgent !== home && home.threat === 0 && !u.helped && mine.filter(v => v.helped === urgent.s.id).length < 3) { u.helped = urgent.s.id; u.site = urgent.s.id; } // a quiet site sends up to three cohorts, read from 1.3 km out: the help is there before the blow lands
    const ps = u.site === u.post.site0 ? u.post : { x: sites[u.site].x + (u.id % 3 - 1) * 110, y: sites[u.site].y - 100 };
    goTo(u, ps.x, ps.y, { run: hyp(u.x - ps.x, u.y - ps.y) > 700 });
  }
  // the breach: a stretch of wall under the suits' fire is manned from inside, by the railRifle teams (the one weapon
  // a starShell fears) of the quietest sites near it and a cohort to hold the gap when it falls. Back to their sites
  // once the wall has been quiet for half a minute
  for (const u of mine) if (u.role === 'wall' && (!G.map.walls[u.bw] || G.t - (G.map.walls[u.bw].hitT ?? -99) > 30)) { u.role = 'site'; u.bw = null; }
  for (const w of G.map.walls) { if (w.down || G.t - (w.hitT ?? -99) > 8) continue;
    const m = wallMid(w), n = mine.filter(u => u.role === 'wall' && u.bw === w.id).length; if (n >= 3) continue;
    const cand = mine.filter(u => u.role === 'site' && !u.melee && (u.type === 'railmen' || u.type === 'legion') && P[u.site] && P[u.site].threat < P[u.site].held * .8 && hyp(u.x - m.x, u.y - m.y) < 1800)
      .sort((a, b) => (b.type === 'railmen') - (a.type === 'railmen') || hyp(a.x - m.x, a.y - m.y) - hyp(b.x - m.x, b.y - m.y));
    for (const u of cand.slice(0, 3 - n)) { u.role = 'wall'; u.bw = w.id; G.aist('manWall'); } }
  for (const u of mine.filter(v => v.role === 'wall')) {
    if (steady(u, city.x, city.y)) continue;
    if (u.melee) continue;
    const w = G.map.walls[u.bw], m = wallMid(w), d = hyp(m.x - city.x, m.y - city.y) || 1, ix = (city.x - m.x) / d, iy = (city.y - m.y) / d, lat = (u.id % 3 - 1) * 45;
    const near = nearest(u, foes), dn = near ? Math.sqrt(dist2(u, near)) : Infinity;
    if (w.down && near && dn < 320) { strike(u, near, false); continue; } // the gap is open: hold it
    if (near && dn < u.wpn.range * .98 && los(u.x, u.y, near.x, near.y) && hyp(u.x - m.x, u.y - m.y) < 160) { if (u.order && u.order.type === 'move') order(u, { type: 'halt' }); continue; }
    goTo(u, m.x + ix * (w.down ? 30 : 70) - iy * lat, m.y + iy * (w.down ? 30 : 70) + ix * lat, { run: hyp(u.x - m.x, u.y - m.y) > 500 });
  }
  // the guns and the Sarissas: stay out of reach of melee, otherwise at the post
  for (const u of mine.filter(v => v.role === 'post')) { if (u.melee) continue; const near = nearest(u, foes), dn = near ? Math.sqrt(dist2(u, near)) : Infinity;
    if (near && dn < 220) goTo(u, u.post.x + (u.post.x - near.x) / dn * 260, u.post.y + (u.post.y - near.y) / dn * 260); else if (dn > 600) goTo(u, u.post.x, u.post.y); }
}
function attack(mine, foes) {
  const sites = G.map.sites, A = G.army = G.army || {};
  const landed = mine.filter(u => u.state !== 'fall');
  const gather = G.t < 45 || (!G.storksDone && G.t < G.storkT + 25);
  if (!landed.length) return;
  // sites we hold keep a holding force: the two nearest line cohorts each
  for (const s of sites) { const h = landed.filter(u => u.keep === s.id); if (s.own === 0 && h.length < 2) { const c = landed.filter(u => u.keep == null && (u.type === 'legion' || u.type === 'railmen') && !u.melee).sort((a, b) => hyp(a.x - s.x, a.y - s.y) - hyp(b.x - s.x, b.y - s.y)); for (const u of c.slice(0, 2 - h.length)) { u.keep = s.id; G.aist('holdForce'); } }
    if (s.own === 1) for (const u of h) u.keep = null; }
  const army = landed.filter(u => u.keep == null);
  const c0 = cen(army.length ? army : landed);
  if (!A.x || gather) { A.x = c0.x; A.y = c0.y; A.path = null; }
  else if (A.assaultT) { A.x += (c0.x - A.x) * .3; A.y += (c0.y - A.y) * .3; A.path = null; } // storming: the command follows the columns
  const held = sites.filter(s => s.own === 0);
  // the objective: the nearest site still theirs; once two are ours, stand between them and keep them
  // the objective: the site still theirs that is cheapest to take, its distance and the garrison standing on it both
  // counted (a lightly held site a little farther off before a strong one close by), held to for a minute once chosen
  const costOf = s => hyp(s.x - A.x, s.y - A.y) + strOf(within(foes, s.x, s.y, 700)) * .55;
  const open = sites.filter(s => s.own === 1 || s.v < 1);
  let tgt = open.sort((p, q) => costOf(p) - costOf(q))[0] || sites[0];
  const was = open.find(s => s.id === A.tgt);
  if (was && was !== tgt && (A.assaultT || G.t - (A.tgtT || 0) < 60) && costOf(was) < costOf(tgt) * 1.6) tgt = was;
  if (A.tgt !== tgt.id) A.tgtT = G.t;
  if (held.length >= NEED()) { const thr = held.map(s => ({ s, t: strOf(within(foes, s.x, s.y, 900)) })).sort((a, b) => b.t - a.t)[0]; tgt = thr.s; }
  if (!A.path || A.tgt !== tgt.id) { A.path = findPath(A.x, A.y, tgt.x, tgt.y, false); A.tgt = tgt.id; }
  // the line faces the objective, and wheels slowly: a kilometre-wide line that turned with every bend in the road would never form
  const want = Math.atan2(tgt.y - A.y, tgt.x - A.x); A.face = A.face == null || gather ? want : A.face + clamp(angDiff(A.face, want), -.06, .06);
  const face = A.face, fx = Math.cos(face), fy = Math.sin(face), px = -fy, py = fx;
  // ranked lines: the suits and legions in front, at most 600 m of frontage a rank; railRifles behind; Obsidians on the wings
  const front0 = army.filter(u => u.type === 'legion' || u.type === 'starshell'), back = army.filter(u => u.type === 'railmen'), wing = army.filter(u => u.type === 'obsidian');
  const slots = new Map();
  const rank = (L, depth0, step) => { const W = 1300; let rows = [[]], w = 0; for (const u of L.slice().sort((p, q) => ((p.x - A.x) * px + (p.y - A.y) * py) - ((q.x - A.x) * px + (q.y - A.y) * py))) { const f = footprint(u).w + 14; if (w + f > W && rows[rows.length - 1].length) { rows.push([]); w = 0; } rows[rows.length - 1].push(u); w += f; }
    rows.forEach((R0, k) => { const tot = R0.reduce((a, u) => a + footprint(u).w + 14, 0); let off = -tot / 2; for (const u of R0) { const f = footprint(u).w + 14; off += f / 2; slots.set(u, { x: A.x + px * off + fx * (depth0 - k * step), y: A.y + py * off + fy * (depth0 - k * step) }); off += f / 2; } });
    return rows.length; };
  const nr = rank(front0, 0, 90); rank(back, -90 * nr - 30, 80);
  const half = Math.min(1300, front0.reduce((a, v) => a + footprint(v).w + 14, 0)) / 2;
  wing.forEach((u, i) => { const side = i % 2 ? 1 : -1, w0 = half + 120 + Math.floor(i / 2) * 110; slots.set(u, { x: A.x + px * side * w0, y: A.y + py * side * w0 }); });
  // contact, and the march: the anchor walks unless the line is in a fight it can see, or strung out from its slots
  const fightingNow = army.some(u => (u.firing && !u.sieging) || u.melee); // the suits shooting at the wall are not a firefight
  let front = foes.filter(f => hyp(f.x - A.x, f.y - A.y) < 600 && los(A.x, A.y, f.x, f.y));
  if (front.length && !fightingNow) { A.stall = (A.stall || 0) + 2; if (A.stall > 20) front = []; } else A.stall = 0;
  // a firefight that decides nothing does not hold the army for ever: before the walls, after a minute it goes in;
  // on open ground, after three
  const city = G.map.city, wallR = G.map.walls.length ? city.r * .78 : city.r * .9, nearCity = hyp(A.x - city.x, A.y - city.y) < wallR + 800;
  if (front.length && fightingNow && !gather) { A.fight = (A.fight || 0) + 2; if (A.fight > (nearCity ? 60 : 180)) { A.pushT = G.t + 45; A.fight = 0; G.aist('push'); } } else if (!front.length) A.fight = 0;
  if (A.pushT > G.t) front = [];
  if (!gather) { const dT = hyp(tgt.x - A.x, tgt.y - A.y), walkers = army.filter(u => !u.T.fly && slots.has(u) && !(u.order && u.order.type === 'breach')); // the suits at the wall are not in the line
    const lag = walkers.filter(u => !u.melee && hyp(u.x - slots.get(u).x, u.y - slots.get(u).y) > 220).length;
    A.lagT = lag > walkers.length * .35 ? (A.lagT || 0) + 2 : 0;
    const pace = walkers.length ? Math.min(...walkers.map(u => u.T.walk)) * (1 + (1 - G.map.B.g) * .35) * .85 : 2.4; // the pace of the slowest, a little under it so the line can keep up
    if (!front.length && dT > 60 && (lag <= walkers.length * .35 || A.lagT > 24) && A.path.length) { let st = pace * 2; while (st > 0 && A.path.length) { const p = A.path[0], d = hyp(p.x - A.x, p.y - A.y); if (d <= st) { A.x = p.x; A.y = p.y; st -= d; A.path.shift(); } else { A.x += (p.x - A.x) / d * st; A.y += (p.y - A.y) / d * st; st = 0; } } } }
  const aa = foes.filter(f => f.T.aa);
  // at the walls the line breaks into storming columns: no kilometre-wide line goes through a gate or down a street
  const assault = !gather && hyp(A.x - city.x, A.y - city.y) < wallR + (A.assaultT ? 900 : 350); // latched: the command follows the columns back from the wall, and must not fall out of the storm doing it
  if (assault && !A.assaultT) { A.assaultT = G.t; log('The legions storm the city.', 'gold'); } else if (!assault) A.assaultT = 0;
  // the walls: on the approach the starShells open a breach on the face toward the objective (two stretches wide),
  // unless one is open there already; the rest of the army goes on by the gates
  A.breach = null;
  if (G.map.wl.length && !gather && held.length < NEED() && hyp(A.x - city.x, A.y - city.y) < wallR + 700) {
    const dx = A.x - city.x, dy = A.y - city.y, dd = hyp(dx, dy) || 1, P = { x: city.x + dx / dd * wallR, y: city.y + dy / dd * wallR };
    const open = G.map.walls.some(w => w.down && hyp(wallMid(w).x - P.x, wallMid(w).y - P.y) < 450);
    const keep = A.bk && A.bk.every(i => !G.map.walls[i].down) && hyp(wallMid(G.map.walls[A.bk[0]]).x - P.x, wallMid(G.map.walls[A.bk[0]]).y - P.y) < 900; // the stretch already under fire, while the army is still before it
    if (keep) A.breach = A.bk;
    else if (!open) { const near = G.map.wl.slice().sort((a, b) => hyp(wallMid(a).x - P.x, wallMid(a).y - P.y) - hyp(wallMid(b).x - P.x, wallMid(b).y - P.y));
      if (near.length && hyp(wallMid(near[0]).x - P.x, wallMid(near[0]).y - P.y) < 500) { const w0 = near[0], w1 = G.map.wl.find(w => Math.abs(w.id - w0.id) === 1); A.breach = w1 ? [w0.id, w1.id] : [w0.id]; G.aist('breach'); } } }
  A.bk = A.breach;
  A.tg2 = assault && held.length < NEED() ? sites.filter(s => s !== tgt && (s.own === 1 || s.v < 1)).sort((p, q) => hyp(p.x - A.x, p.y - A.y) - hyp(q.x - A.x, q.y - A.y))[0] || null : null; // a second column for the next site along
  for (const u of landed) {
    if (!gather && u.keep == null && steady(u, A.x - fx * 300, A.y - fy * 300)) continue;
    if (u.melee) continue;
    const near = nearest(u, foes), dn = near ? Math.sqrt(dist2(u, near)) : Infinity, sees = near && los(u.x, u.y, near.x, near.y);
    if (u.keep != null) { const s = sites[u.keep]; // the holding force: on the site, shooting what comes
      if (near && dn < u.wpn.range * .95 && sees) { if (u.order && u.order.type === 'move') order(u, { type: 'halt' }); continue; }
      if (near && hyp(near.x - s.x, near.y - s.y) < s.r + 30) { strike(u, near, false); continue; }
      goTo(u, s.x + (u.id % 3 - 1) * 80, s.y + (u.id % 2 ? 60 : -60)); continue; }
    if (gather) { const z = G.zones[u.zone] || G.zones[0];
      if (u.type === 'peerless' && !u.leader && aa.length) { const a = nearest(u, aa); if (a && Math.sqrt(dist2(u, a)) < 2400) { strike(u, a, true); continue; } } // the knights go for the guns that will shoot the Storks down
      if (near && dn < u.wpn.range && sees) { if (u.order && u.order.type === 'move') order(u, { type: 'halt' }); continue; }
      if (near && dn < 320 && u.T.mel >= 8) { strike(u, near, true); continue; }
      if (z && hyp(u.x - z.x, u.y - z.y) > 450) goTo(u, z.x + (u.id % 5 - 2) * 100, z.y + (u.id % 3 - 1) * 100); continue; }
    if (u.type === 'peerless') {
      if (u.leader) { const p = { x: A.x - fx * 260, y: A.y - fy * 260 }; if (near && dn < 160) strike(u, near, false); else goTo(u, p.x, p.y, { a: face }); continue; }
      const pool = foes.filter(f => hyp(f.x - A.x, f.y - A.y) < 900 || (f.T.aa || f.leader) && hyp(f.x - A.x, f.y - A.y) < 1800); const tg = pool.length ? bestStrike(u, pool, 2000) : null;
      if (tg) charge(u, tg); else goTo(u, A.x - fx * 150 + (u.id % 3 - 1) * 90, A.y - fy * 150, { a: face }); continue; }
    if (u.type === 'starshell' && A.breach && !(near && dn < 220)) { const wid = A.breach[u.id % A.breach.length]; if (!u.order || u.order.type !== 'breach' || u.order.w !== wid) order(u, { type: 'breach', w: wid }); continue; }
    if (u.type === 'obsidian' || u.type === 'starshell') { const pool = front.length ? front : foes.filter(f => pinned(u, f) && hyp(f.x - A.x, f.y - A.y) < 900), tg = pool.length ? (u.type === 'obsidian' ? bestStrike(u, pool, 700) : nearest(u, pool)) : null; if (tg && Math.sqrt(dist2(u, tg)) < 700) { if (u.type === 'obsidian') charge(u, tg); else strike(u, tg, false); continue; } }
    if (near && dn < u.wpn.range * .95 && sees) { if (u.order && u.order.type === 'move') order(u, { type: 'halt' }); continue; } // in reach and in sight: the line stands and shoots
    if (near && dn < u.wpn.range * 1.3 && !sees && (A.stall || 0) > 20) { strike(u, near, false); continue; } // dig them out of the buildings
    if (assault && u.keep == null && !u.leader) { // storming: each cohort makes for the objective by its own road, and fights whatever it meets
      if (near && dn < 260) { strike(u, near, false); continue; }
      const T2 = A.tg2 && u.id % 2 ? A.tg2 : tgt, o = (u.id * 37 % 7 - 3) * 70; goTo(u, T2.x + px * o, T2.y + py * o, { run: hyp(u.x - T2.x, u.y - T2.y) > 900 && u.stam > .5 }); continue; }
    const p = slots.get(u) || { x: A.x - fx * 120, y: A.y - fy * 120 };
    goTo(u, p.x, p.y, { a: face, run: hyp(u.x - p.x, u.y - p.y) > 400 });
  }
}
// the player's own units still look after themselves a little: a halted unit turns to face what shoots it,
// and melee units the player left idle go for an enemy that walks up to them
function autoUnits(t) {
  for (const u of G.units) { if (u.team !== t || !fighting(u) || u.melee || u.order) continue;
    const near = nearest(u, enemiesOf(t)); if (!near) continue; const d = Math.sqrt(dist2(u, near));
    if (d < u.wpn.range && !u.firing && u.fire) { u.a += clamp(angDiff(u.a, Math.atan2(near.y - u.y, near.x - u.x)), -.6, .6); }
    if (u.T.mel >= 8 && d < 120 && !u.hold) order(u, { type: 'attack', t: near, run: true }); }
}
function nearest(u, L) { let b = null, bd = Infinity; for (const v of L) { const d = dist2(u, v); if (d < bd) { bd = d; b = v; } } return b; }
function cen(L) { if (!L.length) return { x: MAP / 2, y: MAP / 4 }; return { x: L.reduce((a, u) => a + u.x, 0) / L.length, y: L.reduce((a, u) => a + u.y, 0) / L.length }; }
function bestStrike(u, foes, reach = 900) { // weak, isolated, or busy fighting someone else; ranged and artillery first
  let best = null, bs = -Infinity;
  for (const f of foes) { const d = Math.sqrt(dist2(u, f)); if (d > reach) continue;
    const s = -d * .6 + (f.T.art || f.T.aa ? 400 : 0) + (f.melee ? 200 : 0) + (f.T.wpn === 'railRifle' && u.type !== 'peerless' ? -150 : 0) - f.men * f.eq * .3 + (f.T.low ? 120 : 0) - (f.type === 'starshell' && u.type === 'obsidian' ? 500 : 0)
      + (f.leader ? (u.type === 'peerless' ? 650 : 150) : 0) + (pinned(u, f) && u.T.mel >= 8 ? 180 : 0); /* the enemy commander; a line already locked in a fight */ if (s > bs) { bs = s; best = f; } }
  return best;
}

// ---------------------------------------------------------------- a whole battle, headless (tests and auto-resolve)
export function runHeadless(spec, seed, maxT) {
  setup(spec, { seed, human: -1 }); G.def0 = strengthOf(1); aiZones(); beginRain(); G.att0 = spec.att.total || 0;
  const T = maxT || G.maxT; while (!G.over && G.t < T + 1) step(1);
  if (!G.over) finish(1, 'Time runs out');
  return result();
}
export function spawn(team, type, men, x, y, a, o) { const u = mkUnit(team, type, men, x, y, a, o || {}); u.post = { x, y }; G.units.push(u); return u; }
export function start(human) { G.human = human; G.def0 = strengthOf(1); G.att0 = G.spec.att.total || 0; }
