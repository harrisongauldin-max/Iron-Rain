import { PI } from './util.js';

export const WORLD = 170000000; // half-width of the map: past the orbit of Mars
// sensors: a hot ship (burning or firing) is seen across the whole battlefield, as the books have it (Morning Star:
// the enemy's cruisers reported at ten thousand kilometres, minutes before the long guns bear). One coasting cold is
// seen at mid range, one running dark only close in. Every sight range below is multiplied by this
export const SENSOR_K = 6;
// Hangars: every carrier has bay space, and each craft takes some of it. What goes in is the player's choice (the fleet
// panel's Hangars), refitted at a world of one's own. Storks are the dropships: they land legions, never board ships.
export const CRAFT = ['ripwing', 'starshell', 'boarder', 'stork'];
export const CRAFT_NAME = { ripwing: 'ripWings', starshell: 'starShells', boarder: 'leechCraft', stork: 'Storks' };
export const BAY = { ripwing: 2, starshell: 1, boarder: 4, stork: 20 };
export const BAYS = { destroyer: 16, torch: 16, dread: 80, moonbreaker: 180 };
export const CRAFT_TROOPS = { starshell: 6, boarder: 50, stork: 600 };
export const bayUse = m => CRAFT.reduce((a, k) => a + (m[k] || 0) * BAY[k], 0);
// Sensors, after the books: what gives a ship away is what she puts out. Shields up, she burns on every scope like a
// torch; drives lit, she shows as far as her plume carries; cold (shields down, drives idle), she is nearly gone.
// Passive: the range at which a ship picks up a target putting out everything (emission 1): a contact, size and heading.
// Lock: the range at which her fire control holds a target well enough to shoot. Locks are shared across the fleet.
export const PASSIVE_R = { corvette: 100000, corsair: 100000, frigate: 130000, raider: 130000, torch: 130000, destroyer: 130000, dread: 160000, moonbreaker: 180000, scout: 220000, station: 180000, dockyard: 180000, gunplat: 180000, shieldplat: 180000, gov: 180000 };
export const LOCK_R = { corvette: 9000, corsair: 9000, frigate: 12000, raider: 12000, torch: 12000, destroyer: 14000, dread: 20000, moonbreaker: 24000, scout: 18000, station: 20000, dockyard: 20000, gunplat: 20000, shieldplat: 20000, gov: 20000, ripwing: 6000, hauler: 6000, tender: 6000, starshell: 3000, boarder: 3000 };
export const passiveOf = s => PASSIVE_R[s.type] || (s.def.static ? 180000 : 60000);
export const lockOf = s => LOCK_R[s.type] || (s.def.static ? 20000 : 6000);
export const EMIT = { shields: 1, coldSmall: .04, coldBig: .08, driveLo: .35, driveHi: .9, rimDrive: .8, lockFull: .35 };
export const WASH = { R: 8000, T: 15, blindK: .25, hideR: 3000, hideT: 12 }; // a nuclear blast washes out the sensors round it
// the counters, as the ship cards show them: what each hull is for, and what kills it
export const COUNTER = {
  corvette: ['Capital ships: torpedoes, from in under their guns · frigates', 'Destroyers and torchShips: their fire control holds a small hull'],
  corsair: ['Frigates, fighters, assault pods', 'Anything bigger'],
  frigate: ['Screening a capital ship: its flak kills missiles and ripWings · torpedoes at capitals', 'Anything in a straight gunfight'],
  raider: ['torchShips, destroyers and frigates: harpoon lance, torpedoes', 'Dreadnoughts and moonBreakers'],
  torch: ['Escorts and fighters: its fire control holds small hulls', 'Dreadnoughts and moonBreakers'],
  destroyer: ['Escorts, fighters and missiles: fire control and point defence', 'Dreadnoughts and moonBreakers'],
  dread: ['Destroyers, torchShips, Lancers: at long range', 'Corvettes and ripWings in close · anything on her stern'],
  moonbreaker: ['Every line ship, from the edge of the field', 'Corvettes and ripWings in close · anything on her stern'],
  ripwing: ['Capital ships: one miniature nuke each · other fighters', 'Flak, point defence, destroyers and torchShips'],
};
export const counterHTML = t => { const c = COUNTER[t]; return c ? `<div class="ctr"><span class="cs">Strong against</span> ${c[0]}</div><div class="ctr"><span class="cw">Weak against</span> ${c[1]}</div>` : ''; };
export const counterText = t => { const c = COUNTER[t]; return c ? `\nStrong against: ${c[0]}\nWeak against: ${c[1]}` : ''; };

// ---------------------------------------------------------------- weapons
// mag is rounds per mount; for batteries it is volleys, multiplied by the gun count.
export const WPN = {
  cannon:  { name: 'Autocannon', unit: 'rds', mag: 480, supply: 20, kind: 'bullet', range: 560, reload: .11, speed: 1150, dmg: 6, arc: .25, gimbal: .1, spread: .03, life: .62, turn: 0, col: 0xffd38a },
  pulse:   { name: 'Pulse rifles', unit: 'chg', mag: 220, supply: 10, kind: 'bullet', range: 330, reload: .22, speed: 950, dmg: 5, arc: PI, spread: .05, life: .45, turn: 99, col: 0xffb0ff },
  lightrail:{ name: 'Light railguns', unit: 'slugs', mag: 60, supply: 35, track: 300, trackMin: .5, kind: 'slug', eff: 1800, range: 3600, reload: 1.3, speed: 3400, dmg: 32, arc: PI, spread: .003, life: 1.2, turn: 2.4, recoil: 40, col: 0xbfe6ff },
  rail:    { name: 'Railguns', unit: 'slugs', mag: 36, supply: 60, track: 700, trackMin: .35, kind: 'slug', eff: 3600, range: 8000, reload: 2.8, speed: 3800, dmg: 95, arc: PI, spread: .002, life: 2.4, turn: 1.4, recoil: 180, col: 0xbfe6ff },
  battery: { name: 'Rail batteries', unit: 'slugs', mag: 14, supply: 90, track: 1200, trackMin: .1, kind: 'slug', battery: true, eff: 4500, range: 10000, reload: 4.2, speed: 4000, dmg: 70, arc: .87, spread: .006, life: 2.8, turn: .9, recoil: 110, col: 0xcfe8ff },
  pd:      { name: 'Point defense', unit: 'rds', mag: 1400, supply: 25, kind: 'flak', range: 400, reload: .085, speed: 1300, dmg: 4, arc: PI, spread: .07, life: .42, turn: 7, pd: true, col: 0xffb36b },
  missile: { name: 'Missile racks', unit: 'msl', mag: 40, supply: 80, kind: 'missile', eff: 6000, range: 14000, reload: 9.5, salvo: 8, dmg: 75, arc: PI, turn: 99, fuel: 12, life: 16 },
  emp:     { name: 'EMP missiles', unit: 'msl', mag: 3, supply: 70, kind: 'missile', emp: true, eff: 4500, range: 9000, reload: 16, salvo: 1, dmg: 15, arc: PI, turn: 99, hp: 9, fuel: 10, life: 14 },
  nuke:    { name: 'Nuclear missiles', unit: 'nukes', mag: 2, supply: 0, kind: 'missile', nuke: true, manual: true, eff: 8000, range: 15000, reload: 4, salvo: 1, dmg: 0, arc: PI, turn: 99, hp: 20, fuel: 12, life: 22 },
  lance:   { name: 'Spinal lance', unit: 'shots', mag: 6, supply: 120, track: 2000, trackMin: .05, kind: 'slug', charge: 2, bow: true, eff: 5500, range: 9000, reload: 10, speed: 6200, dmg: 720, arc: .05, gimbal: .02, spread: 0, life: 1.7, turn: 0, recoil: 2600, col: 0xff6a3d, big: true },
  harpoon: { name: 'Harpoon lance', unit: 'shots', mag: 10, supply: 80, track: 900, trackMin: .3, kind: 'slug', charge: 1.5, bow: true, eff: 3500, range: 6000, reload: 6, speed: 5000, dmg: 260, arc: .06, gimbal: .03, spread: 0, life: 1.4, turn: 0, recoil: 700, col: 0x9fe8ff, big: true },
  siege:   { name: 'Siege lances', unit: 'shots', mag: 5, supply: 200, track: 3000, trackMin: .04, kind: 'slug', charge: 3, bow: true, eff: 7000, range: 12000, reload: 14, speed: 7200, dmg: 2300, arc: .045, gimbal: .02, spread: 0, life: 1.95, turn: 0, recoil: 9000, col: 0xff4a2a, big: true, huge: true },
  // escorts' answer to a capital ship: a short, heavy torpedo that goes through plate. Fired only at big hulls; point defence can kill it
  torp:    { name: 'Breaching torpedoes', unit: 'torp', mag: 4, supply: 120, kind: 'missile', breach: true, eff: 2600, range: 3600, reload: 10, salvo: 1, dmg: 420, arc: PI, turn: 99, hp: 7, fuel: 6, life: 8 },
  // the ripWing's sting, as at Ilium: one miniature nuke for a capital ship, then home to the carrier to rearm
  bomb:    { name: 'Miniature nuke', unit: 'nuke', mag: 1, supply: 100, kind: 'missile', breach: true, eff: 1000, range: 1300, reload: 4, salvo: 1, dmg: 700, arc: PI, turn: 99, hp: 5, fuel: 3, life: 5 },
  // a frigate's screen: point defence that reaches out far enough to cover the capital ship she guards
  flak:    { name: 'Flak screen', unit: 'rds', mag: 1600, supply: 30, kind: 'flak', range: 1100, reload: .09, speed: 1500, dmg: 4, arc: PI, spread: .06, life: .8, turn: 7, pd: true, col: 0xffc27a },
};

// Non-marine crew shares by Color. Gray marines are tracked separately; boarders are Obsidian.
export const COLORS = [['Gold', '#f2c14e', .02], ['Blue', '#5aa9ff', .1], ['Orange', '#ff9a3c', .26], ['Red/Brown', '#b5584a', .62]];

const side = (w, x, y, dir, guns) => ({ w, x, y, dir, guns });
function batteries(xs, y, guns) { const out = []; for (const x of xs) { out.push(side('battery', x, y, 90, guns)); out.push(side('battery', x, -y, -90, guns)); } return out; }
const pds = pts => pts.map(([x, y]) => ['pd', x, y]);
const STATIC = { mass: 1e9, thrust: 0, turn: .05, cruise: 0, rcs: 0, static: true };

// burn: seconds of full main-drive burn in a full He-3 tank. cmd: can carry a commander. sub: has subsystems.
// Crew and gun counts lean toward the books where the wiki gives a figure
// (a five-kilometre dreadnought: crew up to 20,000, 80+ rail guns). Everything else is game balance.
export const DEFS = {
  hauler:   { name: 'cosmosHauler', role: 'He-3 mining barge · strips derelicts for salvage', cost: 50, time: 6, hp: 160, shield: 40, mass: 4, r: 15, thrust: 90, turn: 2.0, cruise: 230, rcs: .3, sight: 1600, cargo: 50, mineRate: 12, crew: 40, mar: 0, burn: 300, weapons: [] },
  ripwing:  { name: 'ripWing', role: 'Interceptor · one Blue pilot · fixed autocannons', cost: 60, time: 5, hp: 70, shield: 0, mass: 1, r: 9, thrust: 330, turn: 5.5, cruise: 540, rcs: .4, sight: 1800, fighter: true, crew: 1, mar: 0, burn: 90, weapons: [['cannon', .8, 0], ['bomb', .2, 0]] },
  starshell:{ name: 'starShell', role: 'Armoured void suit · elite boarding trooper · 6 troop-equivalents', cost: 160, squad: 6, time: 9, hp: 90, shield: 30, mass: .6, r: 6, thrust: 420, turn: 7, cruise: 430, rcs: .6, sight: 1200, boarder: true, shell: true, crew: 1, mar: 0, troops: 6, killRate: .6, frontage: 8, burn: 70, weapons: [['pulse', .5, 0]] },
  boarder:  { name: 'leechCraft', role: 'Boarding craft from a warship’s hangar bays · 50 Obsidians, Grays and Golds · a thermal drill and a shield to cut into an unshielded hull', cost: 120, time: 8, hp: 200, shield: 0, mass: 2, r: 11, thrust: 250, turn: 4, cruise: 470, rcs: .4, sight: 1400, boarder: true, crew: 2, mar: 0, troops: 50, killRate: .25, frontage: 25, burn: 80, weapons: [] },
  stork:    { name: 'Stork', role: 'Dropship from a warship’s hangar bays · lands a legion of 600 on a world through an open drop corridor · unarmed', cost: 260, time: 14, hp: 420, shield: 160, mass: 6, r: 16, thrust: 120, turn: 2.2, cruise: 300, rcs: .3, sight: 1400, crew: 6, mar: 0, troops: 600, dropship: true, weapons: [] },
  tender:   { name: 'Supply Tender', role: 'Rearms and refuels ships nearby · restocks at a depot', cost: 150, time: 10, hp: 420, shield: 160, mass: 8, r: 20, thrust: 75, turn: 1.3, cruise: 270, rcs: .25, sight: 1800, crew: 150, mar: .1, supply: 1600, burn: 260, weapons: [] },
  scout:    { name: 'Sensor Picket', role: 'Long-range sensors · runs quiet · point defense only', cost: 90, time: 7, hp: 180, shield: 80, mass: 3, r: 13, thrust: 150, turn: 3, cruise: 420, rcs: .35, sight: 4300, sigMul: .5, crew: 25, mar: .1, burn: 320, weapons: [['pd', -.3, 0]] },
  corvette: { fc: 1.6, name: 'Corvette', role: 'Fast escort · twin light railguns · point defense', cost: 110, time: 9, hp: 380, shield: 150, mass: 6, r: 17, thrust: 145, turn: 2.6, cruise: 380, rcs: .3, sight: 2000, capture: 1, crew: 120, mar: .15, pref: 1500, burn: 160, weapons: [['lightrail', .45, .2], ['lightrail', .45, -.2], ['torp', .1, 0], ['pd', -.45, 0]] },
  corsair:  { name: 'Corsair', role: 'Rising refit of a hauler hull · light rail · cheap and quick to build', cost: 85, time: 6, hp: 360, shield: 90, mass: 5, r: 17, thrust: 115, turn: 2.2, cruise: 330, rcs: .3, sight: 1800, capture: 1, crew: 60, mar: .2, pref: 1400, burn: 150, weapons: [['lightrail', .5, 0], ['pd', -.4, 0]] },
  frigate:  { fc: 1.6, name: 'Rail Frigate', role: 'Railgun line ship · point defense', cost: 200, time: 14, hp: 650, shield: 300, mass: 12, r: 24, thrust: 80, turn: 1.3, cruise: 270, rcs: .25, sight: 2200, capture: 1, sub: 1, crew: 450, mar: .15, pref: 2800, burn: 150, weapons: [['rail', .35, 0], ['torp', 0, 0], ['flak', -.45, .2], ['flak', -.45, -.2]] },
  raider:   { fc: 1.6, name: 'Rim Lancer', role: 'Rim raider · harpoon lance · fast and quiet', cost: 300, time: 16, hp: 900, shield: 420, mass: 14, r: 30, thrust: 120, turn: 1.5, cruise: 390, rcs: .3, sight: 2400, sigMul: .7, capture: 1, sub: 1, cmd: 1, crew: 700, mar: .12, pref: 2600, burn: 210, weapons: [['harpoon', 1.1, 0], ['rail', .3, .25], ['rail', .3, -.25], ['torp', .1, 0], ['pd', -.5, .2], ['pd', -.5, -.2]] },
  destroyer:{ fc: 4, name: 'Destroyer', role: 'Missile racks · EMP · rail · twin PD', cost: 340, time: 20, hp: 1150, shield: 550, mass: 22, r: 34, thrust: 62, turn: .85, cruise: 240, rcs: .2, sight: 2400, capture: 1, sub: 1, cmd: 1, crew: 1200, mar: .14, pref: 3800, burn: 150, weapons: [['rail', .55, 0], ['missile', -.35, .32], ['missile', -.35, -.32], ['emp', -.75, 0], ['pd', .15, .35], ['pd', .15, -.35]] },
  torch:    { fc: 4, name: 'torchShip', role: 'Heavy cruiser · broadside rail batteries · small hangar', cost: 540, time: 28, hp: 2300, shield: 1000, mass: 42, r: 48, thrust: 48, turn: .6, cruise: 220, rcs: .18, sight: 2600, capture: 1, sub: 1, cmd: 1, crew: 3500, mar: .13, pref: 3400, broadside: true, burn: 150, hangar: { ripwing: 4, stork: 0 },
    weapons: [['rail', .8, 0], ...batteries([.3, -.25], .3, 4), ['missile', -.55, .3], ['missile', -.55, -.3], ['emp', -.85, 0], ...pds([[.55, .25], [.55, -.25], [-.6, .42], [-.6, -.42]])] },
  dread:    { name: 'Dreadnought', role: '80 rail guns in broadside batteries · spinal lance · hangars · 2 nukes', cost: 950, time: 42, hp: 6200, shield: 2600, mass: 120, r: 86, thrust: 30, turn: .32, cruise: 170, rcs: .14, sight: 3000, capture: 1, sub: 1, cmd: 1, crew: 20000, mar: .1, pref: 4800, broadside: true, burn: 150, hangar: { ripwing: 12, starshell: 24, boarder: 8, stork: 0 },
    weapons: [['lance', 1.18, 0], ...batteries([.6, .2, -.2, -.6], .46, 10), ['missile', -.8, .35], ['missile', -.8, -.35], ['nuke', -.3, 0], ...pds([[.95, .1], [.95, -.1], [.4, .38], [.4, -.38], [-.4, .52], [-.4, -.52], [-.95, .3], [-.95, -.3]])] },
  moonbreaker:{ cvK: 1.5, name: 'moonBreaker', role: 'Super-capital · twin siege lances · 160 rail guns · full hangar · 4 nukes', cost: 2600, time: 90, limit: 1, hp: 17000, shield: 7000, mass: 420, r: 160, thrust: 15, turn: .15, cruise: 120, rcs: .12, sight: 3700, capture: 1, sub: 1, cmd: 1, crew: 60000, mar: .1, pref: 6000, broadside: true, burn: 160, nukeMag: 4, hangar: { ripwing: 24, starshell: 60, boarder: 16, stork: 0 },
    weapons: [['siege', 1.22, .12], ['siege', 1.22, -.12], ...batteries([.75, .5, .25, 0, -.25, -.5, -.75, -.95], .5, 10), ['missile', -.3, .3], ['missile', -.3, -.3], ['missile', .3, .3], ['missile', .3, -.3], ['missile', -.8, .2], ['missile', -.8, -.2], ['emp', .1, 0], ['emp', -.5, 0], ['nuke', -.65, 0],
      ...pds([[1, .14], [1, -.14], [.8, .26], [.8, -.26], [.55, .4], [.55, -.4], [.1, .5], [.1, -.5], [-.35, .58], [-.35, -.58], [-.7, .66], [-.7, -.66], [-1.05, .4], [-1.05, -.4], [-.1, 0], [.4, 0]])] },
  // ---- structures
  station:  { ...STATIC, name: 'Citadel Station', role: 'Command station · shipyard · arsenal · spitTubes', hp: 11000, shield: 5000, r: 120, sight: 3600, crew: 30000, mar: .08, producer: true, depot: true, service: 1000, fullService: true, prod: { he: 3, ord: 5, man: 'recruit' },
    weapons: [['rail', .55, 0], ['rail', -.55, 0], ['rail', 0, .55], ['rail', 0, -.55], ['missile', .35, .35], ['missile', -.35, -.35], ['nuke', 0, 0], ...pds([[.4, .4], [-.4, .4], [.4, -.4], [-.4, -.4], [.7, 0], [-.7, 0], [0, .7], [0, -.7]])] },
  dockyard: { ...STATIC, name: 'Dockyard', role: 'Orbital shipyard · builds ships · full service · capture it with boarders', hp: 7000, shield: 3200, r: 115, sight: 3000, capture: 1, crew: 3000, mar: .1, producer: true, depot: true, service: 950, fullService: true, prod: { he: 1, ord: 3, man: 18 },
    weapons: [['rail', .5, .3], ['rail', -.5, -.3], ['missile', 0, .5], ...pds([[.6, 0], [-.6, 0], [0, -.6], [.3, .6]])] },
  outpost:  { ...STATIC, name: 'Mining Station', role: 'He-3 refinery · forward depot · refuels, rearms and repairs', hp: 3200, shield: 1600, r: 70, sight: 2600, capture: 1, crew: 400, mar: .2, depot: true, service: 750, prod: { he: 2, ord: 1.5, man: 9 },
    weapons: [['rail', .5, 0], ...pds([[-.5, .3], [-.5, -.3], [0, .6]])] },
  gunplat:  { ...STATIC, name: 'Gun Platform', role: 'Orbital rail battery · capture it with boarders', hp: 2600, shield: 1400, r: 42, sight: 2600, capture: 1, crew: 300, mar: .2,
    weapons: [['rail', .4, .3], ['rail', .4, -.3], ['missile', -.4, 0], ...pds([[0, .5], [0, -.5], [-.5, .4], [-.5, -.4]])] },
  shieldplat:{ ...STATIC, name: 'Shield Station', role: 'Projects shields to friendly ships within 750 km', hp: 2000, shield: 4500, r: 42, sight: 2400, capture: 1, crew: 250, mar: .2, aura: 750,
    weapons: pds([[.5, 0], [-.3, .45], [-.3, -.45]]) },
};
// price split: He-3 (energy) and ore (hull metal), plus the crew the ship needs from the manpower pool.
// value keeps the old single number for AI fleet value, veterancy and salvage.
export function finalize(d) {
  if (d.static) { d.value = 0; return d; }
  const light = d.fighter || d.shell || d.boarder, b = d.cost;
  d.value = b; d.cost = Math.round(b * (light ? .7 : .6)); d.ore = Math.round(b * (light ? .4 : .6));
  d.man = Math.round((d.crew + (d.troops || 0)) * (d.squad || 1) + (d.hangar ? (d.hangar.ripwing || 0) + (d.hangar.starshell || 0) * 6 + (d.hangar.boarder || 0) * 50 + (d.hangar.stork || 0) * 600 : 0));
  return d;
}
// ---------------------------------------------------------------- true sizes (Drop 2)
// Book lengths in metres (Red Rising wiki and the saga): ripWing 13 m, starShell 3.7 m, corvettes 50 m to a few
// hundred, torchShips 500-800 m, destroyers about 1.5 km, cosmosHaulers about 1 km, dreadnoughts 4-6 km (the Pax 5 km),
// moonBreakers 6-8 km. The leechCraft, tender, sensor picket, Corsair, frigate and Rim Lancer have no book size:
// they are slotted between the sized classes by role (marked "set by role").
export const LEN_M = { hauler: 1000, ripwing: 13, starshell: 3.7, boarder: 40 /* set by role */, stork: 90 /* set by role: bigger than a leechCraft */, tender: 400 /* set by role */,
  scout: 70 /* set by role */, corvette: 150, corsair: 250 /* set by role */, frigate: 350 /* smaller than a torchShip */,
  raider: 700 /* set by role */, torch: 600, destroyer: 1500, dread: 5000, moonbreaker: 8000 };
export const M_TO_UNITS = .0006;          // the battle map's planet systems run 0.6 units per real km
export const HULL_REF = 30;               // the hull size the hit circles are fitted to
// the books put destroyers (about 1.5 km) above torchShips (about 0.5 km): the two swap their weight of armour and guns.
{ const T = DEFS.torch, D = DEFS.destroyer;
  DEFS.destroyer = { ...T, name: 'Destroyer', role: 'Heavy escort, about 1.5 km · broadside rail batteries · missiles · EMP · small hangar · 2 assault pods', hangar: { ...(T.hangar || { ripwing: 0 }), boarder: 2 } };
  DEFS.torch = { ...D, name: 'torchShip', role: 'Fast gunship and troop transport, about 600 m · rail · missiles · EMP · 700 marines · 4 assault pods',
    crew: 600, mar: 1.2, thrust: D.thrust * 1.15, cruise: D.cruise * 1.15, hangar: { ...(D.hangar || {}), ripwing: (D.hangar && D.hangar.ripwing) || 0, boarder: 4 } }; }
// per-hit armour: a slug or round loses this much on the plate (never below 15% of it); lances, missiles, nukes, rams and boarders ignore it
export const ARMOR = { hauler: 5, ripwing: 0, starshell: 0, boarder: 0, stork: 4, tender: 5, scout: 2, corvette: 5, corsair: 5, frigate: 5, raider: 12, destroyer: 27, torch: 27, dread: 45, moonbreaker: 70,
  station: 45, dockyard: 40, outpost: 20, gunplat: 30, shieldplat: 25 };
for (const k in DEFS) DEFS[k].armor = ARMOR[k] ?? 0;
for (const k in DEFS) finalize(DEFS[k]);
export const CAPITAL_TYPES = Object.keys(DEFS).filter(k => DEFS[k].cmd);

export const SHAPES = {
  hauler: [[1, 0], [.55, .7], [-.8, .8], [-1, .45], [-1, -.45], [-.8, -.8], [.55, -.7]],
  ripwing: [[1.35, 0], [-.2, .3], [-.9, 1.05], [-.65, .2], [-1, 0], [-.65, -.2], [-.9, -1.05], [-.2, -.3]],
  starshell: [[1.1, 0], [.3, .55], [-.2, .75], [-.9, .45], [-.7, 0], [-.9, -.45], [-.2, -.75], [.3, -.55]],
  boarder: [[1.25, 0], [.3, .6], [-1, .55], [-.8, 0], [-1, -.55], [.3, -.6]],
  stork: [[1.1, 0], [.6, .5], [-.9, .6], [-1.1, .3], [-1.1, -.3], [-.9, -.6], [.6, -.5]],
  tender: [[1.1, 0], [.75, .45], [.2, .55], [-.2, .7], [-.95, .6], [-1.05, .3], [-1.05, -.3], [-.95, -.6], [-.2, -.7], [.2, -.55], [.75, -.45]],
  scout: [[1.45, 0], [.2, .22], [-.3, .85], [-.9, .3], [-1, 0], [-.9, -.3], [-.3, -.85], [.2, -.22]],
  corvette: [[1.3, 0], [.5, .3], [-.2, .35], [-.5, .72], [-1, .62], [-.88, 0], [-1, -.62], [-.5, -.72], [-.2, -.35], [.5, -.3]],
  corsair: [[1.2, 0], [.8, .35], [.2, .4], [-.3, .85], [-.9, .75], [-1, .35], [-1, -.35], [-.9, -.75], [-.3, -.85], [.2, -.4], [.8, -.35]],
  frigate: [[1.35, 0], [.6, .22], [.2, .45], [-.7, .45], [-1, .3], [-1, -.3], [-.7, -.45], [.2, -.45], [.6, -.22]],
  raider: [[1.5, 0], [.9, .1], [.4, .18], [-.1, .55], [-.6, .7], [-1, .42], [-.85, .15], [-1.1, 0], [-.85, -.15], [-1, -.42], [-.6, -.7], [-.1, -.55], [.4, -.18], [.9, -.1]],
  destroyer: [[1.4, 0], [.9, .18], [.3, .28], [.1, .5], [-.6, .5], [-.8, .36], [-1.05, .36], [-1.05, -.36], [-.8, -.36], [-.6, -.5], [.1, -.5], [.3, -.28], [.9, -.18]],
  torch: [[1.4, 0], [1, .15], [.6, .2], [.42, .46], [-.4, .5], [-.62, .38], [-1.05, .4], [-1.12, .2], [-1.12, -.2], [-1.05, -.4], [-.62, -.38], [-.4, -.5], [.42, -.46], [.6, -.2], [1, -.15]],
  dread: [[1.32, 0], [1.05, .11], [.7, .17], [.5, .37], [-.2, .42], [-.4, .6], [-.85, .6], [-1, .42], [-1.12, .42], [-1.12, -.42], [-1, -.42], [-.85, -.6], [-.4, -.6], [-.2, -.42], [.5, -.37], [.7, -.17], [1.05, -.11]],
  moonbreaker: [[1.28, .2], [1.28, .06], [1.02, .06], [1.02, -.06], [1.28, -.06], [1.28, -.2], [.92, -.26], [.55, -.5], [-.15, -.56], [-.45, -.74], [-.95, -.72], [-1.1, -.46], [-1.16, -.46], [-1.16, .46], [-1.1, .46], [-.95, .72], [-.45, .74], [-.15, .56], [.55, .5], [.92, .26]],
};
export const SPAN = {}; for (const k in SHAPES) { const xs = SHAPES[k].map(p => p[0]); SPAN[k] = Math.max(...xs) - Math.min(...xs); }
// hull scale for a class (the unit the hull outline is drawn in) at a hull size of hx times true size
export const visR = (type, hx = HULL_REF) => LEN_M[type] ? LEN_M[type] * M_TO_UNITS * hx / (SPAN[type] || 2.4) : (DEFS[type] ? DEFS[type].r : 20);
// hit circles follow the hull at the reference hull size; fighters, starShells and pods keep theirs, since they are flown as icons
for (const k in DEFS) {
  const d = DEFS[k]; d.r0 = d.r; // the old radius still sets a hull's detailing (deckhouse, bridge tower, engine count)
  if (d.static || !LEN_M[k]) continue;
  d.len = LEN_M[k]; d.vr0 = visR(k);
  if (!(d.fighter || d.shell || d.boarder)) d.r = Math.max(10, Math.round(d.vr0 * 1.25));
}
// Each navy builds its hulls its own way. The Society's yards (the Remnant) lay down long, sharp-prowed hulls. The Rim's
// Raa and Codovan yards build slim ships with a forked lancer's bow. The Republic sails refits: blunter bows and
// armour plate bolted on amidships. The same classes, recognisably three navies.
const SHAPE_CACHE = {};
export function fshape(type, fac) {
  const P = SHAPES[type]; if (!P || !fac || !['core', 'rim', 'rising'].includes(fac)) return P;
  const k = type + ':' + fac; if (SHAPE_CACHE[k]) return SHAPE_CACHE[k];
  let out;
  if (fac === 'core') out = P.map(([x, y]) => [x * 1.1, y * (x > .4 ? .8 : .95)]);
  else if (fac === 'rising') out = P.map(([x, y]) => [x > .7 ? .7 + (x - .7) * .72 : x, Math.abs(x) < .45 && Math.abs(y) > .2 ? y * 1.16 : y]);
  else {
    out = P.map(([x, y]) => [x * 1.06, y * .82]);
    let ti = 0; out.forEach((p, i) => { if (p[0] > out[ti][0]) ti = i; });
    const [tx, ty] = out[ti];
    if (Math.abs(ty) < .03 && type !== 'moonbreaker') { // fork the bow
      const prev = out[(ti - 1 + out.length) % out.length], s = prev[1] < 0 ? 1 : -1;
      out.splice(ti, 1, [tx, -.09 * s], [tx - .3, 0], [tx, .09 * s]);
    }
  }
  return SHAPE_CACHE[k] = out;
}
export const ICON_SCALE = { hauler: 4, ripwing: 3.5, starshell: 2.5, boarder: 4, stork: 4.5, tender: 5, scout: 4, corvette: 5, corsair: 5, frigate: 5.5, raider: 6, destroyer: 6.5, torch: 8.5, dread: 11, moonbreaker: 14 };

// ---------------------------------------------------------------- factions
const pal = (main, light, dark, h1, h2) => ({ main, light, dark, hull1: h1, hull2: h2 });
export const NEUTRAL_C = pal('#9aa0a6', '#d0d4d8', '#3a3c40', '#232427', '#33353a');
export const FACTIONS = {
  rising: { key: 'rising', name: 'Solar Republic', blurb: 'The Rising, ten years on: Reds, Obsidians and turncoat Golds under Sovereign Virginia and ArchImperator Darrow. Refitted hulls, cheap boarders and crews who believe. Their boarding parties can talk a lowColor crew into mutiny.',
    col: pal('#ff4b3e', '#ff8a6e', '#5a1410', '#2a2224', '#3d3032'), alt: pal('#c070ff', '#dcaaff', '#3e1460', '#25202c', '#352d40'),
    loyalty: .85, resist: .8, speeches: true, cmdDelay: .45, recruit: 38, liberate: 2, mods: { boarderCost: .8, troopMul: 1.25, dreadCost: 1.15 },
    roster: [[['hauler', 'Z'], ['ripwing', 'X'], ['starshell', 'C'], ['tender', 'B'], ['scout', 'N']], [['corsair', 'M'], ['frigate', 'Y'], ['destroyer', 'U'], ['torch', 'I'], ['dread', 'O'], ['corvette', 'J']]],
    perks: ['leechCraft, Storks and starShells cost 20% less and carry 25% more troops', 'Republic boarders incite mutiny. Captured stations double their recruits, and freed workers join you',  'Unique: Corsair refit gunship', 'One moonBreaker only: the Morning Star, the old Colossus. Dreadnoughts cost 15% more.', 'Orders pass by word of mouth and take a little longer to reach the ships, but no captain waits on a dead flagship'] },
  core: { key: 'core', name: 'Society Remnant', blurb: 'The Ash Lord’s Armada, ruled from Gorgon Isle on Venus. Heavy Gold-officered capital ships, deep marine garrisons and the Carthii yards that can lay down a moonBreaker.',
    col: pal('#f2c14e', '#ffe39a', '#5a4210', '#26241d', '#3b3727'), alt: pal('#e8e8e8', '#ffffff', '#4a4a4a', '#26262a', '#3a3a40'),
    loyalty: .8, resist: .6, cmdDelay: .2, freeze: 6, recruit: 55, liberate: 1, mods: { capitalHull: 1.15, thrust: .92, marMul: 1.3 },
    roster: [[['hauler', 'Z'], ['ripwing', 'X'], ['starshell', 'C'], ['tender', 'B'], ['scout', 'N']], [['corvette', 'M'], ['frigate', 'Y'], ['destroyer', 'U'], ['torch', 'I'], ['dread', 'O'], ['moonbreaker', 'J']]],
    perks: ['Capital ships have 15% more hull and shields', 'Deepest manpower reserves. 30% larger marine garrisons, and Gold-heavy crews resist morale loss', 'Unique: moonBreaker super-capital', 'Ships accelerate 8% slower', 'Gold command: orders reach the ships fastest, but when a flagship dies its captains hold station for six seconds'] },
  rim: { key: 'rim', name: 'Rim Dominion', blurb: 'The Moon Lords of Jupiter and Saturn. Fast, quiet raiders with long legs, built to strike and vanish.',
    col: pal('#5fc7d6', '#a6ecf5', '#123c44', '#1e2628', '#2c3a3d'), alt: pal('#8fe07a', '#c6f5b8', '#1c4414', '#202620', '#2e3a2c'),
    loyalty: .7, resist: 1, cmdDelay: .32, fade: true, recruit: 42, liberate: 1, mods: { crewMul: .85, thrust: 1.2, cruise: 1.15, hull: .92, sig: .85, burn: 1.3, fighterCost: .85 },
    roster: [[['hauler', 'Z'], ['ripwing', 'X'], ['starshell', 'C'], ['tender', 'B'], ['scout', 'N']], [['corvette', 'M'], ['frigate', 'Y'], ['destroyer', 'U'], ['torch', 'I'], ['dread', 'O'], ['raider', 'J']]],
    perks: ['Ships accelerate 20% harder and cruise 15% faster', 'Lean crews (15% smaller), 30% more fuel endurance, quieter signatures', 'ripWings cost 15% less. Unique: Rim Lancer raider', 'Hulls are 8% lighter. No moonBreaker.', 'The fade: a Rim hull on a quiet burn barely shows on enemy sensors'] },
};
export function factionDefs(fk) {
  const m = FACTIONS[fk].mods, out = {};
  for (const k in DEFS) {
    const b = { ...DEFS[k], cost: DEFS[k].value || DEFS[k].cost }; const d = { ...b, faction: fk }; if (b.hangar) d.hangar = { ...b.hangar };
    if (!b.static) {
      if (m.hull) d.hp = Math.round(b.hp * m.hull);
      if (m.capitalHull && b.cmd) { d.hp = Math.round(d.hp * m.capitalHull); d.shield = Math.round(b.shield * m.capitalHull); }
      if (m.thrust) d.thrust = b.thrust * m.thrust; if (m.cruise) d.cruise = b.cruise * m.cruise;
      if (m.sig) d.sigMul = (b.sigMul || 1) * m.sig; if (m.burn) d.burn = (b.burn || 150) * m.burn;
      if (m.boarderCost && b.boarder) d.cost = Math.round(b.cost * m.boarderCost);
      if (m.troopMul && b.troops) d.troops = Math.round(b.troops * m.troopMul);
      if (m.dreadCost && k === 'dread') d.cost = Math.round(b.cost * m.dreadCost);
      if (m.fighterCost && b.fighter) d.cost = Math.round(b.cost * m.fighterCost);
    }
    if (m.marMul) d.mar = b.mar * m.marMul;
    if (m.crewMul && !b.static && b.crew > 2) d.crew = Math.round(b.crew * m.crewMul);
    out[k] = finalize(d);
  }
  return out;
}

// ---------------------------------------------------------------- commanders (original characters)
export const TRAITS = {
  helm: { name: 'Master Helmsman', desc: '+20% thrust and turn rate' },
  gunnery: { name: 'Gunnery Chief', desc: '+20% reload speed and tighter spread' },
  discipline: { name: 'Iron Discipline', desc: 'Crew loyalty never drops below 30%. Morale losses are halved.' },
  breacher: { name: 'Breacher', desc: '+50% marines aboard. Boarders she launches fight 30% harder.' },
  inspiring: { name: 'Inspiring', desc: 'Ships within 1,200 km regain loyalty and fire 8% faster' },
  peerless: { name: 'Peerless Scarred', desc: '+10% helm and gunnery, +10% loyalty' },
};
export const COMMANDERS = {
  rising: [
    { name: 'Kaela of Vastitas', caste: 'Red', title: 'Helldiver turned admiral', traits: ['inspiring', 'breacher'] },
    { name: 'Joss ti Merren', caste: 'Gray', title: 'Legion centurion', traits: ['discipline', 'gunnery'] },
    { name: 'Varo the Unbroken', caste: 'Obsidian', title: 'War-chief of the ice clans', traits: ['breacher', 'discipline'] },
    { name: 'Lysa au Crane', caste: 'Gold', title: 'Peerless Scarred defector', traits: ['peerless', 'helm'] },
  ],
  core: [
    { name: 'Cassian au Severus', caste: 'Gold', title: 'Peerless Scarred praetor', traits: ['peerless', 'gunnery'] },
    { name: 'Drusa au Valerian', caste: 'Gold', title: 'Imperator of the Armada', traits: ['discipline', 'inspiring'] },
    { name: 'Marcus au Coronis', caste: 'Gold', title: 'Legate of the Second Fleet', traits: ['helm', 'gunnery'] },
    { name: 'Livia au Tarquin', caste: 'Gold', title: 'Praetorian knight', traits: ['breacher', 'discipline'] },
  ],
  rim: [
    { name: 'Theron au Callisto', caste: 'Gold', title: 'Moon Lord of Callisto', traits: ['helm', 'inspiring'] },
    { name: 'Ysolde au Pallas', caste: 'Gold', title: 'Dust-raider captain', traits: ['gunnery', 'helm'] },
    { name: 'Dax au Thebe', caste: 'Gold', title: 'Lancer of the Rim', traits: ['breacher', 'helm'] },
    { name: 'Ione au Sinope', caste: 'Gold', title: 'Peerless Scarred of the Rim', traits: ['peerless', 'discipline'] },
  ],
};
export const RANKS = ['Green', 'Blooded', 'Veteran', 'Scarred'];
export const CMD_RANKS = ['Commander', 'Captain', 'Legate', 'Imperator'];

export const DIFF = [{ inc: .7, thr: 1.4, name: 'Easy' }, { inc: 1, thr: 1, name: 'Normal' }, { inc: 1.35, thr: .75, name: 'Hard' }];
export const BODIES = [
  { name: 'Mars', x: 0, y: 0, vx: 0, vy: 0, r: 700, GM: 3.0e7, kind: 'planet' },
  { name: 'Phobos', x: 0, y: 0, vx: 0, vy: 0, r: 130, GM: 2.4e6, kind: 'moon', orbitR: 2700, period: 280, phase: 1.2 },
];
export const REPLACE_COST = { ripwing: 40, starshell: 22, boarder: 30, stork: 120 }; // He-3 per craft
export const REPLACE_MAN = { ripwing: 1, starshell: 6, boarder: 50, stork: 600 };
export const NUKE_COST = { ord: 200, he: 100 };
export const SUBS = [['eng', 'Engines'], ['bridge', 'Bridge'], ['gunsP', 'Port guns'], ['gunsS', 'Starboard guns'], ['shld', 'Shield gen']];

// the powers' sigils, from the books. The Society's: a golden pyramid with three bars on its faces, a circle round
// all (the Remnant flies it still). The Rising's: the spiked war helm of Ares. The Rim's: House Raa's white dragon,
// four-headed. Each sits in its own frame: the Republic a soldier's shield, the Remnant a roundel, the Rim a lozenge.
export const SIGIL = {
  rep: '<path d="M7.4 16.2 V12.4 C7.4 9.6 9.4 8 12 8 C14.6 8 16.6 9.6 16.6 12.4 V16.2 H14.4 V13.2 C13.6 12.8 10.4 12.8 9.6 13.2 V16.2 Z" fill="currentColor" fill-opacity=".9"/><path d="M12 8 V4.6 M9.6 8.6 L8.3 5.6 M14.4 8.6 L15.7 5.6 M7.9 10.1 L5.6 8.2 M16.1 10.1 L18.4 8.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  soc: '<circle cx="12" cy="12.6" r="7.6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M12 7.2 L16.6 15.4 H7.4 Z" fill="currentColor" fill-opacity=".9"/><path d="M8.6 10.6 L10.2 7.8 M15.4 10.6 L13.8 7.8 M9.6 17 H14.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  rim: '<path d="M12 17.4 C11.2 14.6 9 13.4 6.6 12.6 M12 17.4 C11.6 13.8 10.6 11 9 8.6 M12 17.4 C12.4 13.8 13.4 11 15 8.6 M12 17.4 C12.8 14.6 15 13.4 17.4 12.6" stroke="#f4f1ea" stroke-width="1.25" fill="none" stroke-linecap="round"/><path d="M6.6 12.6 L5.2 11.6 L6.9 11.5 Z M9 8.6 L8.3 7 L9.7 7.9 Z M15 8.6 L15.7 7 L14.3 7.9 Z M17.4 12.6 L18.8 11.6 L17.1 11.5 Z" fill="#f4f1ea"/><path d="M10.2 17.6 Q12 19.4 13.8 17.6" stroke="#f4f1ea" stroke-width="1.1" fill="none"/>',
  neu: '<path d="M8 12 H16" stroke="currentColor" stroke-width="1.5"/>' };
export const FRAME = {
  rep: 'M12 2 L21 5 V11 C21 17 17 20.5 12 22 C7 20.5 3 17 3 11 V5 Z',
  soc: 'M12 1.8 A10.2 10.2 0 1 1 11.99 1.8 Z',
  rim: 'M12 1.6 L21.4 12 L12 22.4 L2.6 12 Z',
  neu: 'M12 2 L21 5 V11 C21 17 17 20.5 12 22 C7 20.5 3 17 3 11 V5 Z' };
export const sigilSVG = (f, col, sz = 22) => `<svg class="shield sig-${f}" width="${sz}" height="${sz}" viewBox="0 0 24 24" style="color:${col}"><path d="${FRAME[f] || FRAME.neu}" fill="${col}" fill-opacity=".2" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/>${f === 'soc' ? `<circle cx="12" cy="12" r="8.6" fill="none" stroke="${col}" stroke-width=".6" stroke-opacity=".7"/>` : ''}${SIGIL[f] || SIGIL.neu}</svg>`;
export const BLOC_OF = { rising: 'rep', core: 'soc', rim: 'rim' };
