// Battle comms: the captains on the open channel. Every voiced line comes from a person on a ship (a commander
// by name, or the ship's own captain, whose Color and name are fixed for that hull) and is written in the voice of
// that Color and that navy. Lines land in the battle log with a portrait chip and a burst of static. The enemy's
// channel is heard only when it is in the clear: those lines are marked as intercepts.
import { S } from './state.js';
import { sfx } from './audio.js';

// caste colours, close to the books' Colors
export const CASTE = {
  Gold: { col: '#e8b84a', sig: 'Au' }, Gray: { col: '#9aa3ab', sig: 'Gr' }, Red: { col: '#d9473a', sig: 'Rd' }, Blue: { col: '#4f9be0', sig: 'Bl' },
  Obsidian: { col: '#6b6f78', sig: 'Ob' }, Silver: { col: '#cfd4da', sig: 'Ag' }, Green: { col: '#46b37a', sig: 'Gn' }, Violet: { col: '#a06ad8', sig: 'Vi' },
};
// who captains a hull, navy by navy: the Republic gives ships to any Color that earns them; the Society to Golds,
// with Grays and Blues at the helm of the small ones; the Rim to Golds of its old houses and to Blues
const CREWING = {
  rising: { cap: ['Gold', 'Red', 'Gray', 'Obsidian'], line: ['Red', 'Gray', 'Blue', 'Obsidian', 'Gold'], small: ['Red', 'Gray', 'Blue'] },
  core: { cap: ['Gold'], line: ['Gold', 'Gold', 'Gray'], small: ['Gray', 'Blue'] },
  rim: { cap: ['Gold'], line: ['Gold', 'Blue'], small: ['Blue', 'Gray'] },
};
const NAMES = {
  Gold: { first: ['Cassian', 'Aulus', 'Tullia', 'Cyrene', 'Lucan', 'Marius', 'Octavian', 'Severa', 'Drusilla', 'Atticus', 'Vela', 'Corvinus', 'Livia', 'Hadrian'],
    house: { rising: ['Pallas', 'Corvane', 'Lysandrae', 'Teodor', 'Halcyne', 'Marrow'], core: ['Falthe', 'Saud', 'Votum', 'Rath', 'Coriolan', 'Sertorius', 'Valeria'], rim: ['Lyctos', 'Ixion', 'Pelion', 'Varro', 'Thesmos'] } },
  Gray: { first: ['Kade', 'Voss', 'Harmon', 'Rook', 'Tessaly', 'Brant', 'Ilse', 'Corrigan', 'Mara', 'Pike'], rank: ['Captain', 'Commander', 'Lieutenant'] },
  Red: { first: ['Cora', 'Brennick', 'Tallis', 'Ysolde', 'Marn', 'Ferro', 'Kalla', 'Dov', 'Hollis', 'Wren'], mine: ['Lykos', 'Thessaly', 'Camden', 'Ironhollow', 'Gamma Deep'] },
  Blue: { first: ['Selene', 'Tamsin', 'Ilyan', 'Corvo', 'Nereid', 'Halcyon', 'Pelagia', 'Eurus'], house: ['Pelagus', 'Lyra', 'Aquarii', 'Thalassa', 'Vega'] },
  Obsidian: { first: ['Valka', 'Ulfric', 'Thorvi', 'Hjalmar', 'Sigrun', 'Ragna', 'Eirik', 'Brynja'], clan: ['of the Valkyrie', 'Stoneborn', 'of the Ice', 'Wolfmother’s son', 'Ashbreaker'] },
};
const USED = new Set();
const seed = (id, k) => { const h = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453; return h - Math.floor(h); };
const pick = (L, id, k) => L[Math.floor(seed(id, k) * L.length) % L.length];
const facOf = team => (S.fac && S.fac[team]) || (team === 0 ? 'rising' : 'core');
// a ship's captain: her commander if one is aboard, else the captain her navy gave her
export function speakerOf(s) {
  if (!s) return null;
  if (s.cmdr) return { name: s.cmdr.name, caste: CASTE[s.cmdr.caste] ? s.cmdr.caste : 'Gold', ship: s.title || s.def.name, team: s.team, cmdr: true };
  if (s._capt) return s._capt;
  const f = facOf(s.team), cw = CREWING[f] || CREWING.rising, big = s.def.cmd || (s.def.hp || 0) >= 2000, small = (s.def.len || 0) < 700 && !big;
  const caste = pick(big ? cw.cap : small ? cw.small : cw.line, s.id, 1), N = NAMES[caste]; let name;
  for (let k = 0; k < 8; k++) { const q = k * 7; /* no two captains of a battle share a name */
    if (caste === 'Gold') name = `${pick(N.first, s.id, 2 + q)} au ${pick(N.house[f] || N.house.core, s.id, 3 + q)}`;
    else if (caste === 'Gray') name = `${pick(N.rank, s.id, 4)} ${pick(N.first, s.id, 2 + q)}`;
    else if (caste === 'Red') name = `${pick(N.first, s.id, 2 + q)} of ${pick(N.mine, s.id, 3 + q)}`;
    else if (caste === 'Blue') name = `${pick(N.first, s.id, 2 + q)} xe ${pick(N.house, s.id, 3 + q)}`;
    else name = `${pick(N.first, s.id, 2 + q)} ${pick(N.clan, s.id, 3 + q)}`;
    if (!USED.has(name)) break; }
  USED.add(name);
  return (s._capt = { name, caste, ship: s.title || s.def.name, team: s.team });
}

// the lines: kind -> Color (or '*') -> variants. {T} is the other ship, {N} a number, {W} the world
const L = {
  contact: { '*': ['Contacts on the scope. {N} hulls and closing.', 'Eyes on them. All ships, battle stations.', 'Contact. They have seen us too.'],
    Blue: ['Drive plumes resolving: {N} hulls. Plotting their vectors now.', 'Sensors have them. {N} contacts, burning in.'],
    Gray: ['Contact. {N} hulls. Weapons free on my word.', 'Solid contact. Every gun, stand by.'],
    Red: ['There they are. Bloodydamn, there are a lot of them.', 'Contact! {N} of them. Let them come.'], Obsidian: ['I see them. Good. Let them come close.'] },
  shDown: { '*': ['Shields are gone! We are taking it on the armour!', 'Shields down. Rerouting everything we have.'],
    Gold: ['My shields are down. No matter. Hold the line.', 'Shields gone. I have been naked in a fight before.'], Gray: ['Shields down! Damage control to every deck!', 'We have lost the shields. Still in the fight.'],
    Red: ['Shields are gone, gorydamn it! Keep firing!', 'No shields! Hold together, girl, hold together.'], Blue: ['Shield generators offline. Recalculating the vector to take it on the bow.'], Obsidian: ['The shield is broken. We fight on the iron.'] },
  hull: { '*': ['Hull breaches on four decks. She cannot take much more.', 'We are venting. Request support!'],
    Gold: ['She is bleeding air, but she will hold. Cover me.'], Gray: ['Hull at a third and falling. Request permission to pull back.'], Red: ['She is breaking up! Somebody get these bastards off me!'], Obsidian: ['The ship is dying. Then we die well.'] },
  kill: { '*': ['Target destroyed.', 'She is breaking up. Kill confirmed.', 'Splash one. Next target.'],
    Gold: ['The {T} is finished. Who is next?', 'Down she goes. Mark it.'], Gray: ['Target destroyed. Moving to the next.', 'Kill confirmed on the {T}.'], Red: ['Got her! The {T} is gone!', 'Bloodydamn, look at her burn!'],
    Blue: ['The {T} has lost reactor containment. Confirmed kill.'], Obsidian: ['The {T} is dead. More.'] },
  lost: { '*': ['We have lost the {T}! Gods, there were hundreds aboard.', 'The {T} is gone. Close the gap in the line.'],
    Gold: ['The {T} is gone. Remember the name.'], Gray: ['The {T} is down. No pods. Close up.'], Red: ['They got the {T}! No, no, no...'], Obsidian: ['The {T} is gone to the Vale.'] },
  lance: { '*': ['Lance charge building on us! Brace!', 'They are spinning up a lance. Get us off this line!'],
    Blue: ['Energy spike on their bow: lance charging. Seven seconds, maybe less.'], Gray: ['Lance lock on us! Brace, brace, brace!'], Red: ['That is a lance! Move her, move her now!'] },
  boardUs: { '*': ['Boarders! They have cut through on the lower decks!', 'Breaching pods on the hull. Repel boarders!'],
    Gold: ['Boarders aboard. Every Gray with a weapon, to me.'], Gray: ['Hostiles on decks three through five. Marines, hold the corridors.'], Red: ['They are inside! Grab whatever cuts!'], Obsidian: ['They come aboard. Good. We meet them in the halls.'] },
  boardThem: { '*': ['We are aboard. Cutting toward the bridge.', 'Breach! Breach! We are inside her.'],
    Obsidian: ['We are in. The halls are red now.', 'Their Grays run. We follow.'], Gray: ['Aboard and advancing. Light resistance, deck by deck.'], Red: ['We are in, we are in! Push for the bridge!'] },
  capture: { '*': ['She is ours. They have struck their colours.', 'The bridge is ours. Prize crew taking the helm.'], Obsidian: ['The ship is ours. The rest have knelt.'], Red: ['She is ours! Get our colours up!'] },
  sig: { '*': ['Now. Everything we have, now.', 'All ships, on me. This is the moment.', 'Follow me in.'], Gold: ['Now we show them what a Peerless is.', 'On me. Break them.'], Red: ['Now! Hit them with everything!'], Obsidian: ['Now we go to war.'] },
  rout: { '*': ['They are breaking! Run them down!', 'Their line is gone. Give them no time to reform.'], Gold: ['Look at them run. Hunt them.'], Red: ['They are running! Hail Reaper!'] },
  waver: { '*': ['The flagship is gone. Orders? Somebody give me orders!', 'We have lost the flag. Holding, holding...'], Gray: ['No word from the flag. Holding position.'], Red: ['The flag is gone. What do we do now?'] },
  rain: { '*': ['Iron Rain! Pods away! The legions are falling.', 'The Rain falls. Gods keep them.'], Obsidian: ['We fall now. We fall like the storm.'] },
  reinf: { '*': ['This is {T}. We are with you. Where do you want us?', '{T} on the field. Show us the enemy.'] },
  ambush: { '*': ['Fire from the dark! Where did they come from?', 'Ambush! They were lying quiet in the rocks!'] },
  duel: { '*': ['{T} has met their champion on the decks. Gods help them.'] },
  flagLost: { '*': ['The flagship... the flagship is gone.', 'We have lost the flag. Hold. HOLD.'] },
  corridor: { '*': ['The corridor is open. Hold it for the Rain.', 'Drop corridor clear. Keep the guns off it.'] },
  picket: { '*': ['Picket reporting: {N} contacts on the far side of the world.', 'Picket here. I have them on passive. {N} hulls.'] },
  decoy: { '*': ['That contact was a drone. A decoy. They are elsewhere.', 'Decoy! The capital signature was a drone.'] },
  glare: { '*': ['I cannot see them in the glare. They are coming out of the Sun!'] },
  bomb: { '*': ['Ordnance away on the city. Gods forgive us.', 'Bombs away. The city burns.'] },
  nuke: { '*': ['Nuke away. Gods forgive us.', 'Warhead is away. Everyone look away from the flash.'] },
  nukeHit: { '*': ['Nuclear detonation! Sensors are white, I am blind out there!', 'That was a nuke. Everything past the flash is gone off the scope.'], Blue: ['Detonation on the plot. The wash has taken our sensors in that sector.'] },
  wrecked: { '*': ['Their engines are slag. She is dead in the water.', 'Engines wrecked. She is not going anywhere now.'] },
};
// the enemy's channel, heard in the clear
const ENEMY = {
  contact: { core: ['All ships, this is the flag. The Ash Lord’s will be done.', 'Close and destroy. No quarter for slaves in rebellion.'], rising: ['This is the Republic Navy. Stand down or be broken.', 'Hail Reaper. All ships, engage.'], rim: ['For the Moons. Hold your fire until they are close.', 'The Dominion does not bend. Engage.'] },
  rout: { core: ['Break off! Break off! Every ship, make for the edge of the field!'], rising: ['Pull back, pull back! Get the wounded out!'], rim: ['Withdraw. We will choose another day.'] },
  lost: { core: ['Our flag is down! Who commands? Who commands?'], rising: ['The flag is gone! Hold together!'], rim: ['The flag is lost. Hold the line by houses.'] },
};
const FAC_SIG = { rising: 'Hail Reaper!', core: 'For the Society!', rim: 'For the Moons!' };

const last = { all: -1e9, kind: {}, ship: {} };
export function reset() { USED.clear(); for (const s of S.ships || []) s._capt = null; last.all = -1e9; last.kind = {}; last.ship = {}; }
const GAP = { nuke: 6, nukeHit: 6, contact: 999, shDown: 14, hull: 20, kill: 7, lost: 6, lance: 9, boardUs: 12, boardThem: 12, capture: 3, rout: 30, waver: 20, rain: 5, reinf: 5, ambush: 12, duel: 8, flagLost: 4, corridor: 30, picket: 40, decoy: 10, glare: 60, bomb: 10, wrecked: 6 };
const URGENT = new Set(['nuke', 'nukeHit', 'lost', 'lance', 'boardUs', 'capture', 'rout', 'rain', 'reinf', 'flagLost', 'duel', 'wrecked', 'bomb']);
const fill = (t, o) => t.replace(/\{T\}/g, o.T || 'her').replace(/\{N\}/g, o.N ?? 'several').replace(/\{W\}/g, o.W || 'the world');
// one voiced line. s: the ship that speaks (or {name, caste, ship, team} for someone not on a hull). Returns true if heard
export function say(kind, s, o = {}) {
  if (S.mode !== 'battle' || !S.hooks || !s) return false;
  const now = S.time, sp = s.def ? speakerOf(s) : s;
  if (!sp || (sp.team !== 0 && !o.enemy)) return false;
  const kk = kind + (o.enemy ? '!' : ''); if (now - (last.kind[kk] ?? -1e9) < (GAP[kind] || 8)) return false;
  if (!URGENT.has(kind) && now - last.all < 3) return false;
  const sid = s.id ?? sp.name; if (!URGENT.has(kind) && now - (last.ship[sid] ?? -1e9) < 12) return false;
  let pool;
  if (o.enemy) { const E = ENEMY[kind]; pool = E && (E[facOf(1)] || E.core); }
  else { const T = L[kind]; if (!T) return false; pool = (T[sp.caste] && Math.random() < .7 ? T[sp.caste] : null) || T['*']; }
  if (!pool || !pool.length) return false;
  let line = fill(pool[Math.floor(Math.random() * pool.length)], o);
  if (!o.enemy && (kind === 'rout' || kind === 'capture' || kind === 'sig') && Math.random() < .5) line += ' ' + FAC_SIG[facOf(0)];
  last.kind[kk] = now; last.all = now; last.ship[sid] = now;
  const at = s.def ? s : o.at || null;
  if (S.voice) S.voice({ line, sp, kind, enemy: !!o.enemy, at, col: (CASTE[sp.caste] || CASTE.Gold).col, sig: (CASTE[sp.caste] || CASTE.Gold).sig });
  sfx('radio');
  return true;
}
// the nearest ship of ours to a point, to speak for something that happened there
export function nearestOurs(x, y, not) {
  let b = null, bd = 1e18; for (const s of S.ships) { if (s.team !== 0 || s.dead || s.offField || s.def.static || s.def.fighter || s.def.shell || s === not || s.ally) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; b = s; } }
  return b;
}
export const flagOf = team => { const c = (S.cmdrs || []).filter(c => c.team === team && c.state === 'aboard' && c.ship && !c.ship.dead).sort((a, b) => (b.rank || 0) - (a.rank || 0))[0]; return c ? c.ship : S.ships.find(s => s.team === team && !s.dead && s.def.cmd && !s.def.static) || null; };
