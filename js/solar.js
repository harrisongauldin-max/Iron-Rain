// The whole Solar System at the opening of Iron Gold (753 PCE), as one continuous battlefield.
//
// Two scales, both honest:
//  - Orbits around the Sun are to one true scale: 1 AU = AU units. Mercury, Venus, Earth and Mars sit at
//    their real relative distances, and the Sun is its true size on that scale.
//  - Each planet with its moons is drawn on a magnified local scale (LOCAL units per km). Inside a planet
//    system, body sizes and moon distances are true to each other. (On the solar scale Earth would be
//    smaller than a dreadnought.) Phobos and Deimos are the one exception: at 22 km and 12 km across they
//    are drawn at a playable minimum size.
// Owners, industries, benefits and downsides follow the Red Rising wiki. Numbers are game balance.
import { BODIES } from './data.js';
import { S } from './state.js';

export const AU = 4000000;
export const LOCAL = 0.6;
export const KM_PER_AU = 1.496e8;
const SUN_R_KM = 696000;

const P = {
  sun: { c: ['#fffbe8', '#ffd76a', '#ff9a2a'], dark: 'rgba(255,140,40,.35)', light: 'rgba(255,255,230,.5)', atmo: [255, 200, 110], star: 1 },
  mercury: { c: ['#b8a89a', '#8a7a70', '#4a403a'], dark: 'rgba(60,50,46,.4)', light: 'rgba(200,170,230,.25)', lights: 1, atmo: [170, 200, 240], crater: 1 },
  venus: { c: ['#f3dca0', '#d9b36a', '#8a6a30'], dark: 'rgba(150,110,50,.3)', light: 'rgba(255,245,210,.3)', lights: 1, atmo: [255, 220, 150], bands: 1 },
  earth: { c: ['#3d7fc4', '#2a5f9e', '#123058'], dark: 'rgba(40,90,40,.55)', light: 'rgba(230,240,255,.25)', lights: 1, cap: 1, atmo: [120, 180, 255], land: 1 },
  luna: { c: ['#a8a8a8', '#7c7c80', '#45454a'], dark: 'rgba(40,40,44,.4)', light: 'rgba(220,220,230,.18)', lights: 2, atmo: [176, 186, 206], crater: 1 },
  mars: { c: ['#d66d3c', '#a8452a', '#6e2b1c'], dark: 'rgba(70,25,15,.35)', light: 'rgba(240,150,90,.22)', lights: 1, cap: 1, atmo: [255, 130, 90], canal: 1 },
  rock: { c: ['#8a8078', '#6d6660', '#3a3632'], dark: 'rgba(40,36,34,.4)', light: 'rgba(160,150,140,.2)', crater: 1 },
  ceres: { c: ['#8e8880', '#6a645e', '#35322f'], dark: 'rgba(40,36,34,.4)', light: 'rgba(230,220,200,.22)', lights: 1, crater: 1 },
  jupiter: { c: ['#e0c29a', '#b98a5c', '#6a4a30'], dark: 'rgba(140,80,40,.35)', light: 'rgba(255,240,220,.3)', atmo: [255, 210, 170], bands: 2, spot: 1 },
  io: { c: ['#e8d060', '#c9a33a', '#6e5418'], dark: 'rgba(60,120,40,.5)', light: 'rgba(255,240,160,.25)', lights: 1, atmo: [190, 255, 160], land: 1 },
  europa: { c: ['#4a90b8', '#2c6a90', '#123850'], dark: 'rgba(230,240,255,.35)', light: 'rgba(200,230,255,.3)', lights: 1, atmo: [150, 210, 255], storm: 1 },
  ganymede: { c: ['#a09080', '#7a6a5c', '#3e342c'], dark: 'rgba(60,90,60,.35)', light: 'rgba(230,220,200,.2)', lights: 2, atmo: [190, 220, 210] },
  callisto: { c: ['#6a6058', '#4c443e', '#25211e'], dark: 'rgba(20,18,16,.45)', light: 'rgba(180,170,150,.2)', lights: 1, crater: 1, atmo: [170, 190, 200] },
  saturn: { c: ['#ecd8a8', '#cdb078', '#7a6440'], dark: 'rgba(150,120,60,.25)', light: 'rgba(255,250,230,.3)', atmo: [255, 230, 180], bands: 2, ring: 1 },
  titan: { c: ['#d9963a', '#a8692a', '#5a3614'], dark: 'rgba(60,110,40,.5)', light: 'rgba(255,200,120,.25)', lights: 1, atmo: [255, 170, 90], land: 1 },
  rhea: { c: ['#3a3a44', '#22222a', '#0c0c10'], dark: 'rgba(0,0,0,.5)', light: 'rgba(140,200,255,.18)', crater: 1, glass: 1 },
  ice: { c: ['#e8eef4', '#bcc8d4', '#6a7684'], dark: 'rgba(120,140,170,.3)', light: 'rgba(255,255,255,.3)', crater: 1, atmo: [220, 235, 255] },
  uranus: { c: ['#a6e0e8', '#7cc4d0', '#3a7480'], dark: 'rgba(60,140,150,.2)', light: 'rgba(230,255,255,.25)', atmo: [170, 240, 250], bands: 1 },
  neptune: { c: ['#5a7ae0', '#3a54b8', '#1a2866'], dark: 'rgba(20,40,120,.35)', light: 'rgba(200,220,255,.25)', atmo: [120, 150, 255], bands: 1, spot: 1 },
  triton: { c: ['#e0c0c0', '#b89898', '#5e4848'], dark: 'rgba(90,60,60,.35)', light: 'rgba(255,240,240,.3)', lights: 1, atmo: [255, 210, 220] },
  pluto: { c: ['#d4b896', '#a88c6c', '#54402c'], dark: 'rgba(80,60,40,.4)', light: 'rgba(255,240,220,.3)', crater: 1 },
  belt: { c: ['#8a8278', '#5e5850', '#2e2a26'], dark: 'rgba(30,28,26,.4)', light: 'rgba(230,220,210,.2)', crater: 1 },
  kbo: { c: ['#b88a6a', '#8a5e44', '#4a2e22'], dark: 'rgba(60,30,20,.4)', light: 'rgba(255,225,205,.25)', crater: 1 },
  darkice: { c: ['#9a8c86', '#6a5e5a', '#3a3230'], dark: 'rgba(50,40,40,.4)', light: 'rgba(240,230,230,.2)', crater: 1, atmo: [200, 190, 200] },
  tethys: { c: ['#e4e8ee', '#b4bcc8', '#6a7482'], dark: 'rgba(110,120,140,.3)', light: 'rgba(255,255,255,.3)', crater: 1, lights: 1, atmo: [210, 225, 250] },
  oberon: { c: ['#8a6a5e', '#5e4640', '#2e2220'], dark: 'rgba(40,25,20,.4)', light: 'rgba(240,220,210,.2)', crater: 1, lights: 1, atmo: [220, 200, 200] },
  charon: { c: ['#a8a0a0', '#7a7272', '#3e3838'], dark: 'rgba(60,40,40,.4)', light: 'rgba(240,230,230,.2)', crater: 1, lights: 1 },
  eris: { c: ['#d8dce4', '#9aa0ac', '#4a4e58'], dark: 'rgba(60,60,80,.4)', light: 'rgba(255,255,255,.3)', crater: 1, lights: 1 },
};

// angle: where the planet sits on its orbit (degrees) in week 1 of 753 PCE. yr: its true year. With the campaign's
// moving-planets option on, each planet goes round its orbit at its true rate, a week a turn (placePlanets).
// Moon periods keep their true ratios to each other (Phobos 0.32 d, Io 1.77 d, Luna 27.3 d, Iapetus 79 d …).
const PLANETS = [
  { id: 'mercury', name: 'Mercury', au: .387, km: 2440, angle: 85, yr: .2408, pal: P.mercury },
  { id: 'venus', name: 'Venus', au: .723, km: 6052, angle: 105, yr: .6152, pal: P.venus },
  { id: 'earth', name: 'Earth', au: 1, km: 6371, angle: 125, yr: 1, pal: P.earth },
  { id: 'mars', name: 'Mars', au: 1.524, km: 3390, angle: 140, yr: 1.881, pal: P.mars },
  { id: 'ceres', name: 'Ceres', au: 2.77, km: 473, angle: 152, yr: 4.6, pal: P.ceres, dwarf: 1 },
  { id: 'jupiter', name: 'Jupiter', au: 5.204, km: 69911, angle: 100, yr: 11.86, pal: P.jupiter, gas: 1 },
  { id: 'saturn', name: 'Saturn', au: 9.583, km: 58232, angle: 140, yr: 29.46, pal: P.saturn, gas: 1 },
  { id: 'uranus', name: 'Uranus', au: 19.19, km: 25362, angle: 82, yr: 84.01, pal: P.uranus, gas: 1 },
  { id: 'neptune', name: 'Neptune', au: 30.07, km: 24622, angle: 116, yr: 164.8, pal: P.neptune, gas: 1 },
  { id: 'pluto', name: 'Pluto', au: 39.48, km: 1188, angle: 135, yr: 248, pal: P.pluto, dwarf: 1 },
  // the Belt beyond Ceres: Vesta, Pallas and Hygiea, and Hildas Station out in Jupiter's 3:2 resonance (Golden Son)
  { id: 'vesta', name: 'Vesta', au: 2.36, km: 262, angle: 48, yr: 3.63, pal: P.belt, dwarf: 1 },
  { id: 'pallas', name: 'Pallas', au: 2.77, km: 256, angle: 250, yr: 4.62, pal: P.belt, dwarf: 1 },
  { id: 'hygiea', name: 'Hygiea', au: 3.14, km: 217, angle: 318, yr: 5.57, pal: P.belt, dwarf: 1 },
  { id: 'hildas', name: 'Hildas', au: 3.97, km: 85, minR: 150, angle: 162, yr: 7.9, pal: P.belt, dwarf: 1 },
  // a trash moon of the Core (Light Bringer): a hollowed rock in a Mercury-crossing orbit, heaped with the Core's scrap
  { id: 'marcher', name: 'Marcher-1682', au: .46, km: 17, minR: 100, angle: 212, yr: .312, pal: P.rock, dwarf: 1 },
  // the Kuiper Belt: the Far Ink's dwarf worlds, where the Ascomanni breed and the Shamed keep watch
  { id: 'haumea', name: 'Haumea', au: 43.3, km: 780, angle: 70, yr: 284, pal: P.eris, dwarf: 1 },
  { id: 'makemake', name: 'Makemake', au: 45.8, km: 715, angle: 190, yr: 306, pal: P.kbo, dwarf: 1 },
  { id: 'arrokoth', name: 'Ultima Thule', au: 44.6, km: 18, minR: 90, angle: 290, yr: 298, pal: P.rock, dwarf: 1 },
  { id: 'eris', name: 'Eris', au: 42, km: 1163, angle: 10, yr: 558, pal: P.eris, dwarf: 1 },
];
const MOONS = [
  { id: 'luna', name: 'Luna', parent: 'earth', km: 1737, orbitKm: 384400, days: 27.32, phase: 2.2, pal: P.luna },
  { id: 'phobos', name: 'Phobos', parent: 'mars', km: 11.1, minR: 130, orbitKm: 9376, days: .319, phase: 1.2, pal: P.rock },
  { id: 'deimos', name: 'Deimos', parent: 'mars', km: 6.2, minR: 90, orbitKm: 23460, days: 1.263, phase: 4.1, pal: P.rock },
  { id: 'thebe', name: 'Thebe', parent: 'jupiter', km: 49, minR: 130, orbitKm: 221900, days: .675, phase: 3.3, pal: P.rock },
  { id: 'io', name: 'Io', parent: 'jupiter', km: 1821, orbitKm: 421700, days: 1.769, phase: 5.2, pal: P.io },
  { id: 'europa', name: 'Europa', parent: 'jupiter', km: 1561, orbitKm: 671034, days: 3.551, phase: .7, pal: P.europa },
  { id: 'ganymede', name: 'Ganymede', parent: 'jupiter', km: 2634, orbitKm: 1070412, days: 7.155, phase: 2.4, pal: P.ganymede },
  { id: 'callisto', name: 'Callisto', parent: 'jupiter', km: 2410, orbitKm: 1882709, days: 16.69, phase: 4.0, pal: P.callisto },
  { id: 'enceladus', name: 'Enceladus', parent: 'saturn', km: 252, orbitKm: 237948, days: 1.37, phase: 1.0, pal: P.ice },
  { id: 'rhea', name: 'Rhea', parent: 'saturn', km: 764, orbitKm: 527108, days: 4.518, phase: 3.0, pal: P.rhea },
  { id: 'titan', name: 'Titan', parent: 'saturn', km: 2575, orbitKm: 1221870, days: 15.95, phase: 5.0, pal: P.titan },
  { id: 'iapetus', name: 'Iapetus', parent: 'saturn', km: 735, orbitKm: 3560820, days: 79.32, phase: .4, pal: P.rock },
  { id: 'triton', name: 'Triton', parent: 'neptune', km: 1353, orbitKm: 354759, days: -5.877, phase: 2.0, pal: P.triton },
  // the rest of the Rim's named moons: the books and the fandom name them, the wiki says little, so the rest is plausible fill
  { id: 'amalthea', name: 'Amalthea', parent: 'jupiter', km: 84, minR: 120, orbitKm: 181400, days: .498, phase: 1.9, pal: P.rock },
  { id: 'kalyke', name: 'Kalyke', parent: 'jupiter', km: 4.5, minR: 90, orbitKm: 2600000 /* true 23.6M km, drawn in to stay inside Jupiter's local frame */, days: -743, phase: 2.6, pal: P.rock },
  { id: 'mimas', name: 'Mimas', parent: 'saturn', km: 198, orbitKm: 185540, days: .942, phase: 4.4, pal: P.ice },
  { id: 'tethys', name: 'Tethys', parent: 'saturn', km: 531, orbitKm: 294660, days: 1.888, phase: 2.3, pal: P.tethys },
  { id: 'dione', name: 'Dione', parent: 'saturn', km: 561, orbitKm: 377400, days: 2.737, phase: 5.6, pal: P.tethys },
  { id: 'hyperion', name: 'Hyperion', parent: 'saturn', km: 135, minR: 150, orbitKm: 1481000, days: 21.28, phase: 1.6, pal: P.rock },
  { id: 'miranda', name: 'Miranda', parent: 'uranus', km: 236, orbitKm: 129900, days: 1.413, phase: .9, pal: P.ice },
  { id: 'ariel', name: 'Ariel', parent: 'uranus', km: 579, orbitKm: 190900, days: 2.52, phase: 2.8, pal: P.tethys },
  { id: 'umbriel', name: 'Umbriel', parent: 'uranus', km: 585, orbitKm: 266000, days: 4.144, phase: 4.6, pal: P.darkice },
  { id: 'titania', name: 'Titania', parent: 'uranus', km: 789, orbitKm: 435900, days: 8.706, phase: .3, pal: P.oberon },
  { id: 'oberon', name: 'Oberon', parent: 'uranus', km: 761, orbitKm: 583500, days: 13.46, phase: 3.7, pal: P.oberon },
  { id: 'nereid', name: 'Nereid', parent: 'neptune', km: 178, minR: 150, orbitKm: 1500000 /* true 5.5M km, drawn in */, days: 360.1, phase: 5.1, pal: P.ice },
  { id: 'charon', name: 'Charon', parent: 'pluto', km: 606, orbitKm: 19591, days: 6.387, phase: 3.9, pal: P.charon },
];
// Moons keep their true period ratios, slowed so even Io crawls (about 60 km/s on this map) and a
// fleet parked beside a moon isn't left behind. Phobos takes about eighty minutes to go round.
const SEC_PER_DAY = 15000;

export function setupBodies() {
  BODIES.length = 0;
  BODIES.push({ id: 'sun', name: 'The Sun', x: 0, y: 0, vx: 0, vy: 0, r: Math.round(SUN_R_KM / KM_PER_AU * AU), GM: 3e9, kind: 'star', pal: P.sun });
  for (const p of PLANETS) {
    const a = p.angle * Math.PI / 180, r = Math.max(p.minR || 0, Math.round(p.km * LOCAL));
    BODIES.push({ id: p.id, name: p.name, x: Math.cos(a) * p.au * AU, y: -Math.sin(a) * p.au * AU, vx: 0, vy: 0, r, GM: 30 * r * r, kind: 'planet', pal: p.pal, au: p.au, gas: p.gas, dwarf: p.dwarf, ang0: a, yr: p.yr });
  }
  for (const m of MOONS) {
    const pi = BODIES.findIndex(b => b.id === m.parent), r = Math.max(m.minR || 0, Math.round(m.km * LOCAL));
    BODIES.push({ id: m.id, name: m.name, x: 0, y: 0, vx: 0, vy: 0, r, GM: (m.minR ? 140 : 30) * r * r, kind: 'moon', pal: m.pal, parent: pi, orbitR: Math.round(m.orbitKm * LOCAL), period: m.days * SEC_PER_DAY, phase: m.phase });
  }
  S.bodyVer = (S.bodyVer || 0) + 1;
}
export const bodyIdx = id => BODIES.findIndex(b => b.id === id);
// the planets where they are in a given week of the war: each goes round at its true rate (Mercury in thirteen weeks,
// Earth in fifty-two, Jupiter in twelve years). Moons ride with their planets. turn 1 is the opening layout.
export const WEEKS_PER_YEAR = 52.18;
export function placePlanets(turn) {
  for (const b of BODIES) { if (b.kind !== 'planet' || b.ang0 == null) continue; const a = b.ang0 + (turn - 1) * Math.PI * 2 / (b.yr * WEEKS_PER_YEAR); b.x = Math.cos(a) * b.au * AU; b.y = -Math.sin(a) * b.au * AU; }
  S.planetT = turn;
}
// a battle in deep space is laid out round a point, not a world: '@space' is where the fleets met, '@exit' the far side
// of the break-through line. Code that centres on "the world" centres on these.
export const SPACE = { id: '@space', name: 'deep space', x: 0, y: 0, r: 1, vx: 0, vy: 0, kind: 'point' }, EXIT = { id: '@exit', name: 'the far side', x: 0, y: 0, r: 1, vx: 0, vy: 0, kind: 'point' };
export const bodyOf = id => id === '@space' ? SPACE : id === '@exit' ? EXIT : BODIES[bodyIdx(id)];

// Holdable worlds. side: who holds it in 753 PCE (rep = the Republic side, soc = the Society side).
// prod is per day; the game pays it out per second at PROD_K. food is a balance, not a stockpile.
// fx keys are implemented in sim.js; every pro and con names the effect it carries.
export const PROD_K = .08;
export const WORLDS = [
  { id: 'luna', region: 'The Core', side: 'rep', gov: 'station', plats: { gun: 2, shield: 1 }, ground: 1.8, build: 1.5, service: 2,
    prod: { he: 8, ore: 2, ord: 26, man: 190, food: -30 },
    lore: 'Capital of the Solar Republic. The Atlas Docks move a billion travellers a year; Endymion is its manufacturing and shipping heart.',
    pros: [['Seat of government', 'The Republic citadel: lose it and you lose the war'], ['Endymion yards', 'The citadel here builds 50% faster'], ['Atlas Docks', 'Ships repair and rearm twice as fast at Luna'], ['Rubicon Beacons', 'Early warning: the holder sees every enemy ship near Earth and Luna'], ['Arsenal city', 'Strong ordnance output']],
    cons: [['Food imports', 'Cannot feed itself: a large food deficit'], ['The Syndicate', 'Luna’s crime lords skim 20% of its output']] },
  { id: 'earth', region: 'The Core', side: 'rep', gov: 'outpost', plats: { gun: 2, shield: 1 }, ground: 1.4,
    prod: { he: 4, ore: 14, ord: 10, man: 520, food: 55 },
    lore: 'The origin of mankind, conquered long ago by its own colony on Luna. The Republic drove Grimmus forces from the Americas by 748.',
    pros: [['Cradle of mankind', 'The largest population in the system: the biggest manpower output'], ['Old farmland', 'A food surplus that feeds Luna']],
    cons: [['New Sparta', 'Ancestral seat of House Grimmus: output falls 25% under anyone but the Society']] },
  { id: 'mars', region: 'The Core', side: 'rep', gov: 'dockyard', plats: { gun: 3, shield: 1 }, ground: 1.6,
    prod: { he: 36, ore: 13, ord: 8, man: 360, food: -18 },
    lore: 'The energy capital of the old Society: a thousand cities over a hundred mining colonies, Cimmeria the richest. Home of the Rising, ravaged now by famine.',
    pros: [['He-3 energy capital', 'The largest He-3 output in the system'], ['Obsidian recruits', 'Strong manpower'], ['Orbital shells', 'Battle-station shells and minefields: the heaviest planetary defenses in the Core'], ['Dockyards', 'A shipyard in Mars orbit']],
    cons: [['Famine', 'A food deficit, and dust storms that stop all output for 40 seconds'], ['The Red Hand', 'Insurgents strike the Mars dockyard: hull damage and a 20-second stoppage']] },
  { id: 'phobos', region: 'The Core', side: 'rep', gov: 'dockyard', plats: { gun: 1, shield: 0 }, ground: 1.2,
    prod: { he: 2, ore: 4, ord: 10, man: 55, food: -4 },
    lore: 'A shipping hub of docks above Mars. Blues train for the fleet in the Hive.',
    pros: [['The Hive', 'Blue pilot academy: every ship the holder builds, anywhere, starts Blooded'], ['Shipping docks', 'A shipyard']],
    cons: [['Slum stacks', 'Crowded lowColor docks: a small food deficit']] },
  { id: 'deimos', region: 'The Core', side: 'rep', gov: 'outpost', plats: { gun: 3, shield: 1 }, ground: 1.5,
    prod: { he: 1, ore: 2, ord: 8, man: 10, food: -1 },
    lore: 'The smaller, outer moon of Mars, called the Battle Moon. It has changed hands between the Republic and the Remnant.',
    pros: [['The Battle Moon', 'Fortified far beyond its size']],
    cons: [['Little else', 'The wiki lists no industry here']] },
  { id: 'venus', region: 'The Core', side: 'soc', gov: 'station', yard: 'dockyard', plats: { gun: 3, shield: 2 }, ground: 3, build: 1.2, yardBuild: 2,
    prod: { he: 29, ore: 8, ord: 30, man: 260, food: 14 },
    lore: 'Seat of the Society Remnant. House Carthii’s Venus Dockyards are one of the two most important shipyards in the system, and the planet holds half of the old Imperial He-3 reserves.',
    pros: [['Venus Dockyards', 'The House Carthii yards build twice as fast; with Ganymede, the only yards that can lay down a moonBreaker'], ['Imperial He-3 reserve', 'Half the Society’s reserves: 3,000 He-3 to whoever first takes the Venus Dockyards'], ['4th Garrison Fleet HQ', 'Home of Classis Venetum: heavy orbital defenses and a citadel']],
    cons: [['Gorgon Isle', 'The Ash Lord’s fortress: the Dockyards keep a triple marine garrison'], ['Loyalist Golds', 'Refugee Golds: output halves under anyone but the Society']] },
  { id: 'mercury', region: 'The Core', side: 'soc', gov: 'dockyard', plats: { gun: 1, shield: 0 }, ground: 2.6,
    prod: { he: 17, ore: 16, ord: 6, man: 105, food: 2 },
    lore: 'Innermost world and the first planet of the Core. Its capital is Tyche; Heliopolis is its richest city. Under Republic siege.',
    pros: [['Heliopolis', 'Mercury’s richest city: strong He-3'], ['Eleusis mines', 'Deep mining: strong ore'], ['Tyche Central Command', 'The holder’s guns fire 10% harder everywhere in the Core']],
    cons: [['The Waste of Ladon', '“Eater of Armies”: the dockyard keeps a 2.6× marine garrison'], ['Long siege', 'Orbital defenses broken, and output down 25% for the first five minutes']] },

  // ---------------------------------------------------------------- the Belt
  { id: 'ceres', region: 'The Belt', side: 'rep', gov: 'outpost', plats: { gun: 2, shield: 0 }, ground: 1, reserve: 1500,
    prod: { he: 5, ore: 11, ord: 4, man: 50, food: 18 },
    lore: 'A dwarf planet in the Belt, home of the Hanging Market. One of the Society’s three great He-3 stockpiles was kept here. It joined the Republic after the Rising.',
    pros: [['Hanging Market', 'Trade brings food: a food surplus'], ['War Reserve', 'One of the three great He-3 stockpiles: 1,500 He-3 to whoever first takes it'], ['Institute campus', 'Shared with Enceladus: the holder’s guns fire 5% harder']],
    cons: [['Obsidian pirates', 'Pirates roam the Belt: its asteroid fields hide ambushes and block fire']] },
  // ---------------------------------------------------------------- Jupiter
  { id: 'jupiter', region: 'Jupiter', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 15, ore: 0, ord: 0, man: 5, food: -1 },
    lore: 'The first gas giant past the Belt, ruled by the Moon Lords. Its moons led both Moon Lord Rebellions.',
    pros: [['Gas skimmers', 'He-3 skimmed from the upper atmosphere']],
    cons: [['Radiation', 'Jupiter pours out radiation: within 1.3 million km of it, ships lose crew every second unless their side holds Io or they are Rim crews']] },
  { id: 'io', region: 'Jupiter', side: 'rim', gov: 'station', plats: { gun: 3, shield: 2 }, ground: 1.8, build: 1,
    prod: { he: 5, ore: 4, ord: 8, man: 150, food: 34 },
    lore: 'Seat of House Raa and the Rim capital, Sungrave. Demeter’s Garter makes it the breadbasket of the Rim. Pulse fields and a thickened atmosphere hold off Jupiter’s radiation.',
    pros: [['Seat of House Raa', 'The Rim citadel: lose it and you lose the war'], ['Demeter’s Garter', 'The Rim’s breadbasket: the largest food surplus in the system'], ['Pulse fields', 'The holder’s crews are shielded from Jupiter’s radiation']],
    cons: [['The Rim’s pantry', 'If the Rim loses Io, every Rim world pays 25% less']] },
  { id: 'europa', region: 'Jupiter', side: 'rim', gov: 'outpost', plats: { gun: 2, shield: 1 }, ground: 1.6,
    prod: { he: 8, ore: 14, ord: 4, man: 105, food: 4 },
    lore: 'An ocean moon of over a hundred million, rich in banking and deep-sea mining.',
    pros: [['Banking houses', '+10% He-3 from every world the holder owns'], ['Deep-sea mining', 'Strong ore']],
    cons: [['Storms and leviathans', 'Hurricanes, ten-metre waves and Carver-made sea monsters: the orbital authority keeps a 1.6× marine garrison, but anyone holding it pays 10% less']] },
  { id: 'ganymede', region: 'Jupiter', side: 'rim', gov: 'dockyard', plats: { gun: 3, shield: 1 }, ground: 1.6, build: .6,
    prod: { he: 4, ore: 12, ord: 24, man: 130, food: -6 },
    lore: 'Political and cultural core of the Rim. Its 200 km ring of dockyards was the Rim’s main shipyard until it was wrecked at the Battle of Ilium.',
    pros: [['Ganymede Dockyards', 'Where the Colossus, now the Morning Star, was built: with Venus, the only yards that can lay down a moonBreaker. Still working at 60% after Ilium'], ['Military tech', 'Strong ordnance']],
    cons: [['Heart of the Rim', 'If the Rim loses Ganymede, every Rim world pays 15% less'], ['Wrecked at Ilium', 'Builds at 60% speed']] },
  { id: 'callisto', region: 'Jupiter', side: 'rim', gov: 'outpost', plats: { gun: 4, shield: 2 }, ground: 2.2, service: 2,
    prod: { he: 2, ore: 5, ord: 12, man: 250, food: -4 },
    lore: 'The most militarized of the Jovian moons. A garrison fleet docks here, and it breeds Grays and Obsidians.',
    pros: [['Garrison dock', 'Ships repair, rearm and refuel twice as fast here'], ['Grays and Obsidians', 'The Rim’s best manpower'], ['Fortress moon', 'A 2.2× marine garrison and heavy defenses']],
    cons: [['A barracks, not a market', 'Little He-3 and a small food deficit']] },
  { id: 'thebe', region: 'Jupiter', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 0, ore: 6, ord: 2, man: 5, food: 0 },
    lore: 'A former mining moon turned military base, heavily bombed during the Second Moon Lord Rebellion.',
    pros: [['Old mines', 'A little ore']],
    cons: [['Bombed out', 'One gun platform, never rebuilt'], ['Deep in the radiation', 'It sits close in to Jupiter']] },
  // ---------------------------------------------------------------- Saturn
  { id: 'saturn', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 12, ore: 0, ord: 0, man: 5, food: -1 },
    lore: 'Never terraformed: its people live on its moons and orbital stations.',
    pros: [['Gas skimmers', 'He-3 skimmed from the atmosphere']],
    cons: [['Far from the Core', 'Nine and a half AU from the Sun']] },
  { id: 'titan', region: 'Saturn', side: 'rim', gov: 'dockyard', plats: { gun: 2, shield: 1 }, ground: 1.5,
    prod: { he: 3, ore: 5, ord: 26, man: 95, food: 20 },
    lore: 'Saturn’s largest moon: terraformed farmland second only to Io, and home of Titan Arms.',
    pros: [['Rim farmland', 'A large food surplus'], ['Titan Arms', 'Strong ordnance, and a shipyard']],
    cons: [['Harvest failure', 'Fragile farms: a crop failure can stop Titan’s food for a minute at a time']] },
  { id: 'rhea', region: 'Saturn', side: 'rim', gov: 'outpost', ruin: 1, plats: { gun: 0, shield: 0 }, ground: 1,
    prod: { he: 0, ore: 1, ord: 0, man: 0, food: 0 },
    lore: 'Once the Rim’s seat of government. The Ash Lord burned it with nuclear fire to end the First Moon Lord Rebellion. Sixty million died; its glassy corpse still orbits Saturn. Its station stands empty.',
    pros: [['A Memory of Ash', 'If a Rim side holds Rhea, its guns fire 5% harder']],
    cons: [['Glass corpse', 'Nothing lives here and nothing is produced; its station must be re-crewed by boarders']] },
  { id: 'enceladus', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 1, ord: 0, man: 30, food: 0 },
    lore: 'Runs a joint Institute campus with Ceres.',
    pros: [['Institute campus', 'Gold officers: the holder’s guns fire 5% harder (not cumulative with Ceres)']],
    cons: [['Small', 'Little industry']] },
  { id: 'iapetus', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 4, ord: 0, man: 10, food: 0 },
    lore: 'Saturn’s third-largest moon, far out on its orbit. The wiki says little more.',
    pros: [['Ore', 'A little ore']],
    cons: [['Remote', 'Two million km out from Saturn']] },
  // ---------------------------------------------------------------- the outer giants and the Far Ink
  { id: 'uranus', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 10, ore: 1, ord: 0, man: 10, food: 0 },
    lore: 'A Rim world the wiki names but barely describes.',
    pros: [['Gas skimmers', 'He-3 skimmed from the atmosphere']],
    cons: [['Far from everything', 'Nineteen AU from the Sun']] },
  { id: 'neptune', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 9, ore: 0, ord: 0, man: 5, food: 0 },
    lore: 'Outermost of the gas giants.',
    pros: [['Gas skimmers', 'He-3 skimmed from the atmosphere']],
    cons: [['Far from everything', 'Thirty AU from the Sun']] },
  { id: 'triton', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1.2,
    prod: { he: 3, ore: 4, ord: 2, man: 50, food: 4 },
    lore: 'Neptune’s largest moon, terraformed by Lovelock engines at its poles. The Sons of Ares built bases here.',
    pros: [['Lovelock engines', 'A terraformed moon that feeds itself']],
    cons: [['Sons of Ares cells', 'Pays 25% less to anyone but the Rising'], ['Geysers and quakes', 'A geyser once spilled a Lovelock engine into the sea: quakes can stop its output for half a minute']] },
  { id: 'pluto', region: 'The Far Ink', side: 'rim', gov: 'outpost', plats: { gun: 0, shield: 0 }, ground: 1,
    prod: { he: 2, ore: 4, ord: 0, man: 10, food: -1 },
    lore: 'The Far Ink. Mediocre Institute graduates, the Shamed, are posted to the distant dwarf planets to oversee the first years of terraforming.',
    pros: [['Terraforming outposts', 'A little ore and He-3']],
    cons: [['The Shamed', 'Bitter exiled officers: it pays 30% less'], ['The edge of the system', 'Almost forty AU from the Sun']] },

  // ---------------------------------------------------------------- the worlds the books name in passing, and the fandom's fills
  // (Hildas Station, Kalyke and Marcher-1682 are in the books; Charon and the Kuiper dwarfs are on the wiki; the rest are
  // the Rim's "sixty-seven inhabited moons" and the Belt's freeholds, filled in as the fandom imagines them)
  { id: 'marcher', region: 'The Core', side: 'soc', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: .8,
    prod: { he: 0, ore: 7, ord: 3, man: 8, food: -1 },
    lore: 'A trash moon in a Mercury-crossing orbit: a hollowed rock heaped with the Core’s scrap, hulks and spent reactor cores, worked by Red salvage crews. Darrow’s legions hid here after Mercury fell.',
    pros: [['Scrapyards', 'Ore from the breaking of old hulls']],
    cons: [['Nothing grows', 'A small food deficit'], ['A trash moon', 'One battery; nothing worth more']] },
  { id: 'vesta', region: 'The Belt', side: 'rep', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 2, ore: 12, ord: 3, man: 30, food: 0 },
    lore: 'The Belt’s great iron world, mined for a century for the keels of the Society’s fleets. Its Red crews came over to the Rising early; the ore still flows, now to Luna.',
    pros: [['Iron mines', 'Strong ore'], ['Rising sympathies', 'The Republic’s hold on it is firm']],
    cons: [['Company town', 'Hydroponics feed it and no more'], ['Pirate lanes', 'The Belt’s raiders hunt its ore convoys']] },
  { id: 'pallas', region: 'The Belt', side: 'neu', gov: 'outpost', plats: { gun: 2, shield: 0 }, ground: 1.2,
    prod: { he: 3, ore: 8, ord: 2, man: 25, food: 2 },
    lore: 'A freehold of the Belt, high above the plane of the planets. Pallas took no side in the Rising and takes none now; its Obsidian and Gray freeholders sell to whoever pays and shoot at whoever does not.',
    pros: [['Freeport', 'Trade from both sides: a little of everything'], ['High orbit', 'Hard to reach and hard to surprise']],
    cons: [['Freeholders', 'Pays less to any master'], ['Pirate haven', 'Belt pirates berth here between raids']] },
  { id: 'hygiea', region: 'The Belt', side: 'neu', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: .8,
    prod: { he: 1, ore: 9, ord: 0, man: 15, food: 0 },
    lore: 'The dark outer Belt: carbon and water ice under a crust of soot, mined by Red clans who answer to no House since the Society’s garrison left in the Rising.',
    pros: [['Ice and carbon', 'Ore, and water for the lanes']],
    cons: [['Far out', 'Three AU and more from the Sun'], ['Clan country', 'Pays less to any master']] },
  { id: 'hildas', region: 'The Belt', side: 'soc', gov: 'station', plats: { gun: 2, shield: 1 }, ground: 1.2, service: 1.5,
    prod: { he: 4, ore: 5, ord: 6, man: 20, food: -2 },
    lore: 'Hildas Station: the Society’s old fleet anchorage in the Hilda asteroids at Jupiter’s inner resonance, where Pliny had Mustang’s captured fleet towed in the Golden Son years. The Remnant still holds it, a lonely berth between the Belt and the Rim.',
    pros: [['Fleet anchorage', 'Ships service 50% faster here'], ['The gate to Jupiter', 'The last berth before the Rim']],
    cons: [['Hollow rocks', 'Little industry and a food deficit'], ['Cut off', 'Far from Venus, and the Belt pirates know it']] },
  { id: 'amalthea', region: 'Jupiter', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 3, ord: 1, man: 5, food: 0 },
    lore: 'A red, potato-shaped rock inside Io’s orbit, mined for sulphur and iron under the worst of Jupiter’s radiation. Its crews rotate out every month.',
    pros: [['Sulphur mines', 'A little ore']],
    cons: [['Deep in the radiation', 'Close in to Jupiter: crews sicken'], ['Rotation crews', 'Little manpower']] },
  { id: 'kalyke', region: 'Jupiter', side: 'rim', gov: 'outpost', plats: { gun: 0, shield: 0 }, ground: .6,
    prod: { he: 0, ore: 1, ord: 0, man: 1, food: 0 },
    lore: 'A dark irregular moon far out on a retrograde orbit, a listening post and rendezvous for the Rim’s fleets. It was at Kalyke that the Dustmaker was boarded in the Light Bringer years.',
    pros: [['Listening post', 'A far picket over the approaches to Jupiter']],
    cons: [['A rock', 'Almost nothing here'], ['Far out', 'Twenty-three million km from Jupiter']] },
  { id: 'mimas', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 2, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 2, ord: 2, man: 9, food: 0 },
    lore: 'The innermost of Saturn’s great moons, one great crater across a third of its face. The Rim built a battery into the crater wall to cover the ring lanes.',
    pros: [['Herschel battery', 'Guns over the ring lanes']],
    cons: [['Small', 'Little industry']] },
  { id: 'tethys', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 1 }, ground: 1.2,
    prod: { he: 1, ore: 2, ord: 1, man: 24, food: 4 },
    lore: 'An ice moon thawed to a shallow sea along the great chasm of Ithaca, farmed under domes. One of the Rim’s quieter breadbaskets.',
    pros: [['Ithaca farms', 'A food surplus']],
    cons: [['Thin domes', 'Fragile: a bombardment costs it dearly']] },
  { id: 'dione', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 2, shield: 1 }, ground: 1.4,
    prod: { he: 2, ore: 3, ord: 4, man: 36, food: 1 },
    lore: 'Saturn’s most populous moon after Titan: ice cliffs and wispy fractures, with cities cut into the canyon walls. Its Golds are old Rim families, fierce in the Moon Council.',
    pros: [['Canyon cities', 'Good manpower'], ['Old families', 'A Rim side holding it keeps the Moon Council content']],
    cons: [['Proud houses', 'Pays 20% less to any Core master']] },
  { id: 'hyperion', region: 'Saturn', side: 'rim', gov: 'outpost', plats: { gun: 0, shield: 0 }, ground: .8,
    prod: { he: 0, ore: 2, ord: 0, man: 2, food: 0 },
    lore: 'A tumbling sponge of a moon, too porous to settle, its pits used as a fleet depot and a prison for the Rim’s dissidents.',
    pros: [['The pits', 'A hidden depot: ships resupply here']],
    cons: [['Tumbling', 'It cannot be fortified'], ['A prison', 'Nothing grows and no one volunteers']] },
  { id: 'miranda', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 2, ord: 1, man: 6, food: 0 },
    lore: 'The broken moon: cliffs twenty kilometres high and a surface of mismatched provinces, as if shattered and reassembled. The Rim quarries it for ice and keeps a small watch.',
    pros: [['Verona Rupes', 'Ice quarries: a little of everything']],
    cons: [['Far from everything', 'Nineteen AU out']] },
  { id: 'ariel', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 1 }, ground: 1.2,
    prod: { he: 2, ore: 2, ord: 1, man: 21, food: 3 },
    lore: 'The brightest of the Uranian moons, warmed to a thin spring in its canyons. Farms line the rifts; the Rim’s far colonists call it the Garden of the Outer Dark.',
    pros: [['Rift farms', 'A food surplus for the outer worlds']],
    cons: [['Far from everything', 'Nineteen AU out']] },
  { id: 'umbriel', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 3, ord: 1, man: 7, food: 0 },
    lore: 'The dark one: soot-black ice with a single bright crater floor, mined for rare metals by Obsidian clans who went out with the first Rim expeditions and never came back.',
    pros: [['Deep mines', 'Rare metals']],
    cons: [['Obsidian clans', 'Pays less to any master'], ['Far from everything', 'Nineteen AU out']] },
  { id: 'titania', region: 'The Outer Giants', side: 'rim', gov: 'station', plats: { gun: 2, shield: 1 }, ground: 1.4, service: 1.5,
    prod: { he: 2, ore: 4, ord: 4, man: 42, food: 1 },
    lore: 'The largest moon of Uranus and the seat of the Rim’s outer march: a station over its great canyon, a garrison, and the only yards past Saturn that can refit a capital ship.',
    pros: [['Seat of the outer march', 'A citadel and a fleet berth: ships service 50% faster'], ['Messina yards', 'Refits past Saturn']],
    cons: [['Far from everything', 'Nineteen AU out'], ['Thin soil', 'Little food']] },
  { id: 'oberon', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1.2,
    prod: { he: 2, ore: 3, ord: 1, man: 24, food: 1 },
    lore: 'The outermost great moon of Uranus, red with old dust, its craters floored with dark ice. A world of Obsidian herders and Red miners, sworn to the Moon Lords and resentful of them.',
    pros: [['Hardy folk', 'Good manpower for its size']],
    cons: [['Restless', 'Pays less to any master'], ['Far from everything', 'Nineteen AU out']] },
  { id: 'nereid', region: 'The Outer Giants', side: 'rim', gov: 'outpost', plats: { gun: 0, shield: 0 }, ground: .6,
    prod: { he: 1, ore: 1, ord: 0, man: 2, food: 0 },
    lore: 'A small moon on a wildly eccentric orbit round Neptune, swinging from a million to nine million km out. The Rim keeps a beacon and a fuel cache on it for the long haul to the Far Ink.',
    pros: [['Fuel cache', 'A depot on the road to the Far Ink']],
    cons: [['A rock', 'Almost nothing here']] },
  { id: 'charon', region: 'The Far Ink', side: 'rim', gov: 'outpost', plats: { gun: 0, shield: 0 }, ground: 1,
    prod: { he: 1, ore: 2, ord: 0, man: 5, food: -1 },
    lore: 'Pluto’s twin, so close the two keep one face to each other for ever. The Shamed who draw Charon count it the worse posting: the terraformers’ engines failed here, and only the mines are kept.',
    pros: [['Tholin mines', 'A little ore']],
    cons: [['The Shamed', 'Bitter exiled officers: it pays 30% less'], ['The edge of the system', 'Almost forty AU from the Sun']] },
  { id: 'haumea', region: 'The Far Ink', side: 'neu', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 2, ore: 4, ord: 0, man: 6, food: 0 },
    lore: 'An egg of ice spinning end over end every four hours, ringed by its own debris. Ascomanni clans hollowed it; the Shamed never held it long.',
    pros: [['Ice ring', 'Water and He-3 for a raider fleet']],
    cons: [['Ascomanni', 'Raider country: pays less to any master'], ['The edge of the system', 'Forty-three AU from the Sun']] },
  { id: 'makemake', region: 'The Far Ink', side: 'neu', gov: 'outpost', plats: { gun: 1, shield: 0 }, ground: 1,
    prod: { he: 2, ore: 3, ord: 1, man: 8, food: 0 },
    lore: 'Red with tholins and bitterly cold. The Society planted a terraforming outpost here and lost it to the Ascomanni within a generation; its domes are their long halls now.',
    pros: [['Old domes', 'A little of everything']],
    cons: [['Ascomanni', 'Raider country: pays less to any master'], ['The edge of the system', 'Forty-six AU from the Sun']] },
  { id: 'arrokoth', region: 'The Far Ink', side: 'neu', gov: 'outpost', plats: { gun: 0, shield: 0 }, ground: .5,
    prod: { he: 0, ore: 1, ord: 0, man: 1, food: 0 },
    lore: 'Ultima Thule: two lobes of red ice stuck together, the last charted rock before the long dark. A beacon, a cache, and the graves of the Shamed who drew it.',
    pros: [['The last beacon', 'A waypoint for the deep dark']],
    cons: [['Nothing', 'Almost nothing here'], ['The edge of the system', 'Forty-five AU from the Sun']] },
  { id: 'eris', region: 'The Far Ink', side: 'neu', gov: 'station', plats: { gun: 2, shield: 1 }, ground: 1.6,
    prod: { he: 3, ore: 5, ord: 4, man: 30, food: 0 },
    lore: 'The largest of the Kuiper dwarfs, bright with methane frost: the seat of the Ascomanni. Obsidian war-chiefs hold its ice fortresses, and their longships come in from the dark to raid the Rim’s lanes.',
    pros: [['Ascomanni fortress', 'A citadel of the far dark'], ['Raider halls', 'Obsidian manpower for whoever can hold them']],
    cons: [['Ascomanni', 'Raider country: pays less to any master, and the clans rise against it'], ['The edge of the system', 'Forty-two AU from the Sun']] },
];
export const WORLD = Object.fromEntries(WORLDS.map(w => [w.id, w]));
