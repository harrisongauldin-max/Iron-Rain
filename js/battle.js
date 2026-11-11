// A campaign battle fought on the tactical map: the fleets that met at a world, the world's own platforms and
// orbital authority, and nothing else. When one side is broken (or withdraws, or time runs out), what is left
// of every ship is written back to the campaign and the strategic view takes over again.
import { S } from './state.js';
import * as K from './camp.js';
import { C } from './camp.js';
import * as CM from './command.js';
import * as TE from './tech.js';
import * as P from './politics.js';
import { newBattle, nukesOf, relocate, groupList, groupOrder, ZONE_R, ATT_R, FORMATIONS, STANCES, shipName, update as simUpdate, launchCraft } from './sim.js';
import { BODIES, FACTIONS, DEFS } from './data.js';
import { bodyOf, SPACE, EXIT } from './solar.js';
import * as IN from './intel.js';
import { buildUI, forceUI, toast } from './ui.js';
import { enterStrat, leaveStrat } from './stratview.js';
import { hyp } from './util.js';
import * as TC from './tactics.js';
import * as AB from './abilities.js';
import { setHelm, launchAt, toggleHangars, LAUNCH_R } from './commands.js';
import { setTargetMode, setNukeMode } from './input.js';
import { nukesOf as nukesOn } from './sim.js';
import { HELMS } from './sim.js';
import * as AG from './agents.js';
import * as EC from './economy.js';
import * as MO from './morale.js';
import * as EA from './enemyai.js';
import * as TRN from './terrain.js';
import * as OPS from './ops.js';
import * as SNS from './sensors.js';
import * as CQ from './conquest.js';
import * as QS from './quests.js';
import { music } from './audio.js';
const FF_X = 12;

const $ = id => document.getElementById(id);
const TIME_LIMIT = 1800; // thirty minutes of battle: then the attack breaks off
const DISENGAGE = 20;
const EXIT_D = 200000;      // in deep space: how far past the meeting point the intercepted fleet must get to be through
const AU = 4000000;     // seconds a withdrawing fleet must survive under fire before it is clear
let B = null; export const curBattle = () => B;
// the battle's clock runs from first contact: the approach does not count against it
const clockT = () => B && B.t0 != null ? S.time - B.t0 : 0;

export function fightBattle(cf) {
  return new Promise(resolve => {
    const me = C.player, foe = cf.att === me ? cf.def : cf.att, defTeam = cf.def === me ? 0 : 1, w = C.worlds[cf.world];
    // a coalition battle: our allies fight on our team under the battle AI; every power on the other side is team 1
    const mySide = K.sideOf(cf, me) || [me], foeSide = K.foeSide(cf, me), teamOf = o => mySide.includes(o) ? 0 : 1;
    // fleets one week out on their way here join the battle partway through, as reinforcements
    const inc = cf.space || cf.quest || cf.assault ? [] : C.fleets.filter(f => f.transit && !f.transit.retreat && f.transit.to === cf.world && f.transit.left === 1 && (mySide.includes(f.owner) || foeSide.includes(f.owner)));
    const fleetsOf = t => K.cfFleets(cf, t === 0 ? me : foe).concat(inc.filter(f => teamOf(f.owner) === t));
    // deep space: the point the fleets met at, the course the intercepted fleet was on, and the line it must cross
    let space = null, bw = cf.world;
    if (cf.space) { const p = IN.locPos(cf.space.loc), tg = K.cfFleets(cf, cf.def)[0], a = IN.posW(tg.transit.from), b = IN.posW(tg.transit.to), head = Math.atan2(b.y - a.y, b.x - a.x);
      Object.assign(SPACE, { x: p.x, y: p.y, vx: 0, vy: 0 }); Object.assign(EXIT, { x: p.x + Math.cos(head) * (EXIT_D + 6000), y: p.y + Math.sin(head) * (EXIT_D + 6000) });
      space = { x: p.x, y: p.y, head, kind: cf.space.kind, terrain: cf.space.terrain, side: Math.random() < .5 ? 1 : -1 }; bw = '@space'; }
    const fleetOf = new Map(), recs = t => fleetsOf(t).flatMap(f => f.ships.map(s => { fleetOf.set(s, f); return s; }));
    const pf = K.BLOCS[me], ef = foe === 'neu' ? (pf === 'core' ? 'rising' : 'core') : K.BLOCS[foe];
    leaveStrat(); document.body.dataset.fac = me;
    S.tcam = S.tcam || { x: 0, y: 0, z: .07 }; S.cam = S.tcam;
    const groups = fleetsOf(0).filter(f => f.owner === me).map(f => ({ name: f.name, recs: f.ships }));
    for (const t of [0, 1]) for (const f of fleetsOf(t)) if (f.owner !== (t === 0 ? me : foe) && f.owner !== 'neu') for (const r of f.ships) if (!r.name && (K.defsOf(f.owner)[r.t] || {}).cmd) r.name = shipName(K.BLOCS[f.owner]); /* an ally's capital ships take names of their own navy */
    const cmdrs = fleetsOf(0).concat(fleetsOf(1)).map(f => ({ c: CM.cmdrOf(f), talents: CM.effTalents(CM.cmdrOf(f)), recs: f.ships, ally: f.owner !== me && teamOf(f.owner) === 0 })).filter(x => x.c);
    for (const x of cmdrs) x.c.grantT = x.talents.filter(t => !x.c.talents.includes(t)); /* what hero talents and heirlooms count as, for the battle's own rules */
    const out = newBattle({ pf, ef, world: bw, space, ang: space ? (space.kind === 'ambush' ? space.head + space.side * Math.PI / 2 : space.head) : undefined, defTeam, withWorld: cf.withWorld, neutralFoe: foe === 'neu', wstate: { gun: w.gun, shield: w.shield, gov: w.gov }, sides: [recs(0), recs(1)], groups, cmdrs, defs: [K.defsOf(me), K.defsOf(foe)], fits: TE.FITS, clsSpec: (team, id) => { const c = TE.classById(team === 0 ? me : foe, id); return c ? { ...TE.specOf(c.s), name: c.name } : null; }, buff: [{ gun: TE.mod(me, 'gun') }, { gun: TE.mod(foe, 'gun') }] });
    // allied hulls: on our team, but neither selected nor ordered by the player
    for (const s of out.ships) { const f = fleetOf.get(s.campRef); if (f && f.owner !== me && s.team === 0) { s.ally = f.owner; s.allyName = K.BLOC_NAME[f.owner]; } }
    for (const t of out.tac || []) { const f = C.fleets.find(x => x.cmdr === t.camp.id); if (f && f.owner !== me && t.team === 0) t.ally = true; }
    // crews that have seen prisoners spaced break sooner against those who spaced them
    for (const s of out.ships) if (s.team < 2 && CQ.fears(s.team === 0 ? me : foe, s.team === 0 ? foe : me)) s.loy = Math.max(.2, (s.loy ?? .8) - .15);
    B = { cf, bw, space, me, foe, mySide, foeSide, teamOf, defTeam, attTeam: 1 - defTeam, out, fleetOf, resolve, t: 0, endT: null, result: null, thru: 0, startN: [0, 1].map(t => out.ships.filter(s => s.team === t).length), res: [], approach: null, timeline: [], tlT: 0 };
    setupDeploy(inc); AB.reset(); setupRain(); setupChamps();
    // the ground, and the orders the campaign gives this battle
    TRN.setup(bw, space ? space.head : B.axis, defTeam, space ? (K.wreckNear(cf.space.loc) ? 'wrecks' : ({ belt: 'belt', glare: 'glare', giant: 'giant', open: Math.hypot(space.x, space.y) / AU > 9 ? 'dark' : 'none' })[space.terrain]) : null); /* a wreck field from an earlier battle is the ground now */
    if (space) TRN.TR.exit = { x: space.x, y: space.y, head: space.head, d: EXIT_D };
    // no transit burns out here: with the enemy on top of them no captain lights the torches and turns his back; it is a running fight at cruise
    if (space) for (const s of S.ships) s.noTransit = true;
    const podsOf = t => S.ships.some(s => s.team === t && !s.dead && !s.def.static && ((s.h && s.h.boarder > 0) || (s.def.troops && !s.def.fighter)));
    OPS.setup({ world: bw, space: !!space, defTeam, ang: B.axis, orbit: !!(cf.withWorld && !cf.assault && !cf.quest && !space), pods: podsOf(1 - defTeam), lagrange: !!space, pt: space ? { x: space.x, y: space.y } : null, head: space ? space.head : 0, side: space ? space.side : 1, withWorld: cf.withWorld, besieged: w.owner === me && w.siege && w.siege.by === foe, attR: bodyOf(bw).r + ATT_R, gov: out.gov, quest: cf.quest ? QS.objOf(cf.quest) : null,
      assault: cf.assault ? K.assaultCtx(K.cfOwn(cf, me).find(f => f.at === cf.world) || K.cfOwn(cf, me)[0]) : null });
    B.rainZones = OPS.OP.zones; B.quest = cf.quest || null;
    if (B.base0) for (const c of OPS.OP.convoy) if (OPS.OP.kind === 'relief') B.base0.push([c, c.x, c.y, c.a]);
    // the battle opens paused, so the player can read the field and give orders before the first shot
    // an AI fleet that was intercepted makes for the far side of the line; an AI interceptor goes for it
    TC.setup(); MO.setup(bw); if (!space && defTeam === 1 && (MO.M.doc === 'patient' || MO.M.doc === 'cunning')) placePickets(mobile(1), 1); /* a careful commander throws out pickets */ EA.reset({ world: space && defTeam === 1 ? '@exit' : bw, defending: !space && defTeam === 1, allyAtt: defTeam === 1, diff: C.difficulty ?? 1 }); keysOnce();
    S.fireLong = [false, null]; /* we hold to effective range until told otherwise; the enemy's doctrine decides for it */
    S.stepCap = 16; S.mode = 'battle'; S.aiHook = battleAI; S.gameState = 'play'; S.paused = true; S.speed = 1; S.aiNukeT = 30; B.deploy = true;
    document.body.classList.add('battle', 'paused');
    buildUI(); buildBar();
  });
}

// the enemy's plan lives in enemyai.js; how crews hold or break, in morale.js
const battleAI = () => { if (B) { EA.tick(); EA.allyTick(); } };

const armedOnField = t => S.ships.some(s => s.team === t && !s.dead && !s.def.static && !s.surrendered && !s.derelict && s.type !== 'hauler' && !s.convoy && !s.def.dropship);
const armed = t => armedOnField(t) || (B && B.res.some(r => r.team === t && !r.done));
// what we know of the enemy's strength: ships in sight, platforms, and what we last saw of the rest
const knownStrength = () => { let v = 0; for (const s of S.ships) if (s.team === 1 && !s.dead && !s.surrendered && !s.derelict && (s.def.static || s.vis[0])) v += (s.def.value || 50) * s.hp / s.def.hp; for (const c of SNS.SN.contacts[0]) v += (c.s.def.value || 50) * .8; for (const [, g] of SNS.SN.ghosts[0]) if (!g.s.vis[0] && !SNS.SN.contacts[0].some(c => c.s === g.s)) v += (g.s.def.value || 50) * .8; return v; };
const countOf = t => S.ships.filter(s => s.team === t && !s.dead && !s.surrendered && !s.derelict && !s.def.static && !s.def.fighter && !s.def.shell).length;
const strength = t => S.ships.reduce((a, s) => a + (s.team === t && !s.dead && !s.surrendered && !s.derelict ? (s.def.value || 50) * s.hp / s.def.hp : 0), 0);
// called every frame while a campaign battle runs
export function battleTick(dt) {
  if (!B) return;
  if (B.deploy && !S.paused) { B.deploy = false; OPS.begin(); updBar(); }
  music(B.endT != null ? .2 : TC.T.contact ? 1 : .35);
  if (S.selection.length && S.selection.some(s => s.ally)) { const a = S.selection.find(s => s.ally); S.selection = S.selection.filter(s => !s.ally); if (!S.selection.length) S.inspect = a; } /* allied hulls take no orders from us */
  if ((B.cardT = (B.cardT || 0) - dt) <= 0) { B.cardT = .2; abilUI(); } /* the order card follows the selection, paused or not */
  TC.pipFrame(dt);
  if (S.paused) return; TC.tick(dt, false); B.t += dt * S.speed;
  if (B.t0 == null && TC.T.contact) { B.t0 = S.time; updBar(); }
  // skipping the approach: the sim runs many steps a frame until someone holds a lock within reach
  if (B.skip) { if (TC.T.contact || B.endT != null) { B.skip = false; S.stepCap = 16; if (S.speed > 12) S.speed = 1; const el = $('bSkip'); if (el) el.classList.add('hide'); } else { { const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 28) { simUpdate(1 / 12); if (++n % 6 === 0 && TC.closest() < 16000) break; } } /* big steps, as many as a frame allows: nobody is in reach yet */ const g = TC.T.gap || 0; if (B.skipG == null || g < B.skipG - 500) { B.skipG = g; B.skipT = S.time; } else if (S.time - B.skipT > 60) { B.skip = false; S.stepCap = 16; toast('Nobody is closing: give the fleet its orders (X advances), then skip', 'prompt', null, true); } } }
  if (S.time >= B.tlT) { B.tlT = S.time + 2; B.timeline.push([Math.round(S.time), Math.round(strength(0)), Math.round(strength(1)), countOf(0), countOf(1)]); } /* strength over time, for the after-action report */ resTick(); rainTick(); MO.tick(TC.T.engaged, [0, 1].map(t => B.res.some(r => r.team === t && !r.done))); TRN.tick();
  if (S.time >= (B.opT || 0)) { B.opT = S.time + 1; const r = OPS.tick(clockT()); if (r && B.endT == null && B.diseng == null) { B.result = r; B.endT = 2.5; const good = (r.attWin && B.attTeam === 0) || (!r.attWin && B.defTeam === 0); toast(r.msg || `${bodyOf(B.cf.world).name} holds: the assault breaks off`, good ? 'good' : 'bad', null, true); } }
  if (B.endT != null) { if (!B.aarShown) { B.aarShown = true; B.endT = Math.max(B.endT, 8); showAAR(B.result); } B.endT -= dt; if (B.endT <= 0) finish(B.result); return; }
  if ((B.ui = (B.ui || 0) - dt) <= 0) { B.ui = .25; updBar(); }
  if (B.diseng != null) {
    // breaking contact: the fleet burns away from the enemy; whatever survives the burn gets clear
    B.diseng -= dt * S.speed; steerAway();
    if (B.diseng <= 0 || !S.ships.some(s => s.team === 0 && !s.dead && !s.def.static)) { B.result = { attWin: B.attTeam !== 0, withdrew: true }; B.endT = .1; toast('The fleet is clear', 'bad', null, true); }
    return;
  }
  const { attTeam, defTeam, out } = B; let res = null;
  if (B.space) {
    const ux = Math.cos(B.space.head), uy = Math.sin(B.space.head);
    for (const s of S.ships.slice()) if (s.team === defTeam && !s.dead && !s.def.static && !s.offField && (s.x - B.space.x) * ux + (s.y - B.space.y) * uy > EXIT_D) { s.through = true; holdOff({ team: defTeam, ships: [s], kind: 'through', done: true }); B.thru++; if (s.team === 0) TC.note(`${s.title || 'The ' + s.def.name} is through the line`, 0x9be8a8); }
    const left = S.ships.filter(s => s.team === defTeam && !s.dead && !s.def.static && !s.offField && !s.def.fighter).length;
    if (B.n0 == null) B.n0 = left + B.res.filter(r => r.team === defTeam && !r.done).reduce((a, r) => a + r.ships.length, 0);
    if (B.thru && B.thru >= left && B.thru >= Math.ceil(B.n0 * .25)) { /* half the survivors, and at least a quarter of the fleet: one lucky frigate is not a break-through */ const ours = defTeam === 0; toast(ours ? 'Through: the fleet breaks past and holds its course' : 'They are through: the enemy breaks past us', ours ? 'good' : 'bad', null, true); B.result = { attWin: false, through: true }; B.endT = 2.5; return; }
  }
  if (!armed(attTeam)) res = { attWin: false };
  else if (out.gov && out.gov.team !== defTeam) res = { attWin: true, taken: true };
  else if (!armed(defTeam) && !B.quest && !B.rainZones) { /* a quest or an assault from orbit is won by its own objective */
    // the defenders' ships are gone; a world with no fleet of its own fights on with its platforms
    const platsUp = out.plats.some(p => !p.dead && p.team === defTeam);
    if (!B.cf.alone || !platsUp) res = { attWin: true };
  }
  if (!res && clockT() > TIME_LIMIT) res = { attWin: false, timeout: true, quest: B.quest ? (B.defTeam === 0 ? 'won' : 'lost') : undefined };
  if (res) {
    const won = (res.attWin && attTeam === 0) || (!res.attWin && defTeam === 0);
    const routed = MO.M.rout[res.attWin ? defTeam : attTeam] != null; if (routed) res.rout = true;
    toast(res.timeout ? (B.space ? (B.defTeam === 0 ? 'Clear: we lose them in the dark' : 'Lost them: the enemy slips away in the dark') : 'The attack breaks off') : won ? (routed ? 'Victory: the enemy is routed' : 'Victory: the field is ours') : 'Defeat: the line is broken', won ? 'good' : 'bad', null, true);
    B.result = res; B.endT = 2.5;
  }
}

// the names crews give themselves after their second honour
const CREWS = ['the Iron Wolves', 'the Pale Hands', 'the Bloodydamned', 'the Ash Eaters', 'the Long Watch', 'the Gorgon’s Teeth', 'the Red Forks', 'the Void Saints', 'the Laughing Dead', 'the Last Light', 'the Black Hounds', 'the Lancers of Lykos'];
const crewName = () => CREWS[Math.floor(Math.random() * CREWS.length)];
// what the battle did to every ship goes back into the campaign
// who holds the field when it is over: they keep their own hulks and take the other side's as prizes
function holderOf(r) {
  if (!r) return null; const { attTeam, defTeam } = B;
  if (r.through || (B.space && r.timeout)) return attTeam;
  return r.attWin ? attTeam : defTeam;
}
function writeBack(r0) {
  const { out, fleetOf, me, foe, cf, defTeam, teamOf } = B, owner = t => t === 0 ? me : foe, w = C.worlds[cf.world]; let captured = 0; B.lostV = [0, 0]; B.lostN = 0;
  const hold = holderOf(r0); B.dprize = 0; B.drecov = 0; B.towed = { own: 0, prize: 0 }; B.startV = [0, 0];
  for (const s of out.ships) { const fl = fleetOf.get(s.campRef); if (s.campRef && fl && !s.def.fighter && !s.def.shell) B.startV[teamOf(fl.owner)] += s.def.value || s.def.cost || 50; }
  // an escort's hull often outlives her crew: whoever holds the field when it is over tows the wrecks home. Ours go
  // back to the yards (more often than not); theirs come in as prize hulls, more rarely. Capital ships go up with
  // their reactors and a nuke leaves nothing, so neither is towed. Only a battle fought on the map does this
  const towable = s => s.dead && !s.recovered && !s.rained && !s.def.fighter && !s.def.shell && !s.def.static && s.def.capture !== false && !(s.def.cmd && (s.def.len || 0) >= 1500) && s.killKind !== 'nuke' && s.killKind !== 'blast';
  for (const s of out.ships) {
    const r = s.campRef, fl = fleetOf.get(r); if (!r || !fl) continue;
    const origTeam = teamOf(fl.owner);
    if (s.rained) { fl.ships = fl.ships.filter(x => x !== r); continue; } // spent in the Iron Rain
    // a derelict or a ship that struck her colours, still on the field at the end, belongs to whoever holds it
    const hulk = !s.dead && (s.derelict || s.surrendered) && s.def.capture && hold != null && s.team === origTeam;
    if (hulk && hold === origTeam) { s.surrendered = false; s.derelict = false; s.crew = Math.max(s.crew, s.def.crew * .08); B.drecov++; } // our own hulk, taken back in tow
    else if (hulk) { // the enemy's: a prize hull, towed home with a skeleton crew; it needs a yard and a crew
      B.lostV[origTeam] += s.def.value || s.def.cost || 50; if (!s.def.fighter && !s.def.shell) B.lostN++; fl.ships = fl.ships.filter(x => x !== r); CM.weary(fl.owner, (s.def.value || 50) / 700); if (!fl.ships.length) CM.fleetLost(fl, owner(hold));
      const cap = owner(hold); let to = K.cfOwn(cf, cap).find(f => f.at === cf.world && !f.transit) || (cf.space ? K.cfOwn(cf, cap)[0] : null); if (!to) to = K.fleet(cap, cf.world, {}, hold === 0 ? 'Prize Squadron' : null);
      const d = s.def; r.hp = Math.max(.05, s.hp / d.hp); r.crew = .08; r.ammo = .2; r.prize = true; r.sub = subOf(s); to.ships.push(r); if (hold === 0) captured++; B.dprize++;
      if (s.surrendered) { const S0 = B.struck = B.struck || { n: 0, crew: 0, ids: [], by: cap, foe: fl.owner }; S0.n++; S0.crew += d.crew || 0; S0.ids.push(r.id); } /* a crew that struck its colours: what becomes of them is the captor's choice */
      continue;
    }
    if (hold != null && towable(s) && Math.random() < (hold === origTeam ? .6 : .3)) {
      const d = s.def; r.hp = .06; r.crew = hold === origTeam ? Math.max(.25, s.crew / (d.crew || 1)) : .08; r.ammo = .1; r.sub = subOf(s); r.towed = true;
      if (hold === origTeam) { B.towed.own++; continue; } // ours: back to the yards with what is left of her crew
      B.lostV[origTeam] += d.value || d.cost || 50; B.lostN++; fl.ships = fl.ships.filter(x => x !== r); CM.weary(fl.owner, (d.value || 50) / 700); if (!fl.ships.length) CM.fleetLost(fl, owner(hold));
      const cap = owner(hold); let to = K.cfOwn(cf, cap).find(f => f.at === cf.world && !f.transit) || (cf.space ? K.cfOwn(cf, cap)[0] : null); if (!to) to = K.fleet(cap, cf.world, {}, hold === 0 ? 'Prize Squadron' : null);
      r.prize = true; to.ships.push(r); B.towed.prize++; continue; // listed on its own line, not among the prizes taken
    }
    const lost = (s.dead && !s.recovered) || s.surrendered || s.derelict;
    if (lost) { B.lostV[origTeam] += s.def.value || s.def.cost || 50; if (!s.def.fighter && !s.def.shell) B.lostN++; fl.ships = fl.ships.filter(x => x !== r); CM.weary(fl.owner, (s.def.value || 50) / 700); if (!fl.ships.length) CM.fleetLost(fl, owner(1 - origTeam)); continue; }
    const d = s.def; r.hp = Math.max(.05, s.hp / d.hp); r.crew = d.crew > 2 ? Math.max(.1, s.crew / d.crew) : 1;
    const ws = s.weapons.filter(x => !x.def.nuke && !x.def.pd); r.ammo = ws.length ? ws.reduce((a, x) => a + x.ammo / x.mag, 0) / ws.length : 1; r.rank = Math.max(r.rank || 0, s.rank || 0); r.battles = (r.battles || 0) + 1; r.kills = (r.kills || 0) + (s.kills || 0); if (s.mvp) { r.honours = (r.honours || 0) + 1; r.rank = Math.min(3, (r.rank || 0) + 1); /* the ship of the battle: her crew comes out of it a rank better */ CM.gainXp(CM.cmdrOf(fl), 10); if (r.honours >= 2 && !r.crewName) { r.crewName = crewName(); if (fl.owner === me) K.note(`The crew of the ${r.name || d.name} name themselves ${r.crewName}.`, 'gold'); } }
    r.sub = subOf(s); // damage that lasts: subsystems stay knocked about until a yard puts them right
    const nk = nukesOf(s); if (nk.length) r.nukes = nk.reduce((a, x) => a + x.ammo / Math.max(1, x.mag), 0) / nk.length;
    if (s.h) { const h = Object.assign({}, s.h); for (const f of S.ships) if (f.carrier === s && !f.dead && f.def.fighter) h[f.type] = (h[f.type] || 0) + 1; r.hangar = h; }
    if (s.team !== origTeam && s.team < 2) { // taken by boarding: the prize changes hands
      fl.ships = fl.ships.filter(x => x !== r); const cap = owner(s.team);
      let to = K.cfOwn(cf, cap).find(f => f.at === cf.world && !f.transit) || (cf.space ? K.cfOwn(cf, cap)[0] : null); if (!to) to = K.fleet(cap, cf.world, {}, s.team === 0 ? 'Prize Squadron' : null); r.prize = true;
      r.crew = Math.min(r.crew, s.whole ? .7 : .35); to.ships.push(r); if (s.team === 0) captured++;
    }
  }
  // the commanders' fates: killed with their flagship, escaped in a pod (wounded), or held by the enemy
  for (const t of out.tac || []) { const c = t.camp; if (c.state !== 'fleet') continue; const cf0 = C.fleets.find(x => x.id === c.fleet) || null; if (t.state === 'dead') CM.kill(c, cf0, `${c.name} was killed at ${bodyOf(cf.world).name}.`, null, t.team === 0 ? foe : me); else if (t.state === 'pod') CM.wound(c, cf0, bodyOf(cf.world).name); else if (t.heldBy != null || t.state === 'captured') CM.capture(c, cf0, t.team === 0 ? foe : me, bodyOf(cf.world).name); }
  if (cf.withWorld) {
    const up = t => out.plats.filter(p => !p.dead && p.team === defTeam && p.type === t).length;
    w.gun = up('gunplat'); w.shield = up('shieldplat');
    if (out.gov) w.gov = Math.max(0, out.gov.hp / out.gov.def.hp);
  }
  // the bombardment: the garrison is broken, and the worlds remember who burned the cities
  if (OPS.OP.orb && OPS.OP.orb.bombed && cf.withWorld) { const by = owner(B.attTeam); w.garrison = Math.round(w.garrison * .6); w.loyalty = Math.max(0, w.loyalty - 12);
    C.bombards = C.bombards || {}; C.bombards[by] = (C.bombards[by] || 0) + 1; P.react(by, 'bombard', .6); if (w.owner !== by) P.addOpinion(w.owner, by, 'bomb', 'Bombarded our cities', -3, .5, 40);
    if (by === me) K.note(`${OPS.OP.orb.cap} was bombarded from orbit. The Senate and the Reds will not forget it.`, 'bad', cf.world); }
  // every warhead fired is answered for at home, and remembered by the side it was fired at
  for (const t of [0, 1]) { const n = (TC.T.nukes || [])[t] || 0; if (!n) continue; const by = owner(t), at = owner(1 - t); P.react(by, 'nuke', n); if (at && at !== by && at !== 'neu') P.addOpinion(at, by, 'nuke', 'Used nuclear weapons against us', -2 * n, .5, 40); if (by === me) K.note(`${n} nuclear warhead${n > 1 ? 's' : ''} fired at ${bodyOf(cf.world).name}. The government will answer for ${n > 1 ? 'them' : 'it'}.`, 'bad', cf.world); }
  if (B.defied || (cf.assault && OPS.OP.zones && OPS.OP.zones.some(z => z.landed > 0))) K.senateDefied(me, cf.world);
  for (const a of B.champDead || []) { a.state = 'dead'; if (a.owner === C.player) K.note(`The champion ${a.name} fell in a duel at ${bodyOf(cf.world).name}.`, 'bad'); }
  // the wrecks of the capital ships that died here: whoever holds the field strips them for ore
  if (hold != null) { const v = S.hulks.filter(h => !h.dead).reduce((a, h) => a + (h.def.value || 300), 0) + S.wrecks.reduce((a, h) => a + (h.def.value || 300), 0), ore = Math.round(v * .15), bloc = owner(hold);
    B.salvage = { ore, n: S.hulks.filter(h => !h.dead).length + S.wrecks.length, team: hold };
    if (ore > 0 && C.fac[bloc] && C.fac[bloc].res) { C.fac[bloc].res.ore = (C.fac[bloc].res.ore || 0) + ore; if (bloc === me) K.note(`Salvage crews strip the ${B.salvage.n} wreck${B.salvage.n > 1 ? 's' : ''} at ${bodyOf(cf.world).name}: +${ore} ore.`, 'good', cf.world); } }
  C.fleets = C.fleets.filter(f => f.ships.length);
  return captured;
}
const subOf = s => s.sub ? Object.fromEntries(Object.entries(s.sub).map(([k, v]) => [k, Math.round(v * 100) / 100])) : undefined;
function finish(r) {
  const { cf, attTeam } = B, w = C.worlds[cf.world];
  const aar = aarOf(r);
  B.struck = null; const captured = writeBack(r); aar.prizes = captured; if (B.struck) CQ.onStruck(B.struck); aar.derelictPrizes = B.dprize || 0; aar.recovered = B.drecov || 0; aar.salvage = B.salvage || null;
  K.leaveWrecks(cf, B.lostV[0] + B.lostV[1], (B.lostN || 0));
  { const wt = r.attWin ? attTeam : 1 - attTeam; r.margin = Math.max(.5, Math.min(4, (B.lostV[1 - wt] + 100) / (B.lostV[wt] + 100))); }
  const lossF = [attTeam, 1 - attTeam].map(t => B.lostV[t] / Math.max(1, B.startV[t])); aar.towed = B.towed;
  const res = { attWin: !!r.attWin, world: cf.world, space: cf.space, through: r.through, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, captured, margin: r.margin, withdrew: r.withdrew, timeout: r.timeout, rout: r.rout, held: r.held, escaped: MO.M.esc.slice(), tactical: true, lossF, aar };
  res.quest = r.quest || (cf.quest ? (((r.attWin && attTeam === 0) || (!r.attWin && B.defTeam === 0)) && !r.withdrew ? 'won' : 'lost') : undefined); res.assault = !!cf.assault; res.rain = !!r.rain;
  if (r.taken && cf.quest) r.taken = false; /* a quest battle never changes a world's owner */
  if (r.taken) { // the orbital authority was boarded: the world changes hands at once
    const old = w.owner, how = B.rainZones ? 'assault' : r.rain ? 'rain' : 'boarding'; if (how !== 'boarding') P.react(attTeam === 0 ? B.me : B.foe, 'rain'); w.owner = attTeam === 0 ? B.me : B.foe; w.siege = null; K.onCapture(w, w.owner, 30); w.scorched = 0; CM.weary(old, 6); P.react(w.owner, 'conquest'); P.seatLost(old, w.id); w.gov = .5; w.bq = []; w.sq = []; w.garrison = Math.min(K.garrisonCap(w), B.rainZones ? Math.max(1200, Math.round(OPS.OP.heldTroops || 0)) : 600); res.taken = true;
    K.note(how === 'rain' ? `The Iron Rain takes ${bodyOf(cf.world).name}: the legions hold the surface for ${K.BLOC_NAME[w.owner]}.` : how === 'assault' ? `The legions hold ${bodyOf(cf.world).name}: the assault from orbit has taken the world for ${K.BLOC_NAME[w.owner]}.` : `${bodyOf(cf.world).name}'s orbital authority is boarded and taken: the world falls to ${K.BLOC_NAME[w.owner]}.`, w.owner === C.player ? 'good' : 'bad', cf.world);
    K.worldLost(old, w); K.worldTaken(w, w.owner, old, how); /* a capital taken this way moves its government too */
  }
  opsPay(res);
  if (cf.assault && !r.taken) { const left = OPS.garrisonLeft(); K.assaultFailed(w, left != null ? left : w.garrison, B.me); }
  if (!cf.quest && !cf.assault) K.afterBattle(res);
  else { CM.battleFate(Object.assign({}, res, { wins: res.attWin ? cf.atts : cf.defs, loses: res.attWin ? cf.defs : cf.atts })); if (cf.assault && !r.taken && !w.siege && K.hostile(B.me, w.owner) && K.cfOwn(cf, B.me).some(f => f.ships.length)) K.newSiege(w, B.me); }
  const done = B.resolve; B = null; TC.teardown(); TRN.teardown(); OPS.teardown(); music(0); { const el = $('baar'); if (el) el.classList.add('hide'); } S.follow = null; if (S.camReset) S.camReset();
  S.aiHook = null; S.fireLong = null; S.mode = null; S.selection = []; S.paused = false; document.body.classList.remove('battle', 'paused');
  enterStrat(); done(res);
}
// the after-action report: who did the killing, who was lost, what became of the commanders
function aarOf(r) {
  const { out, fleetOf, me } = B, side = s => { const fl = fleetOf.get(s.campRef); return fl ? (fl.owner === me ? 0 : 1) : s.team; };
  const row = s => ({ name: s.title || s.def.name, cls: s.def.name, kills: s.kills || 0, dmg: Math.round(s.dmg || 0), killed: s.killed || [], lost: (s.dead && !s.recovered) || s.surrendered || side(s) !== s.team });
  const ours = out.ships.filter(s => s.campRef && side(s) === 0 && !s.def.fighter && !s.def.shell);
  const best = ours.filter(s => s.kills || s.dmg > 50).sort((a, b) => (b.killV || 0) - (a.killV || 0) || (b.dmg || 0) - (a.dmg || 0));
  if (best[0]) best[0].mvp = true;
  const fate = t => t.state === 'dead' ? 'killed' : t.state === 'pod' ? 'got clear in an escape pod, wounded' : (t.heldBy != null || t.state === 'captured') ? 'taken prisoner' : 'came through';
  const D = MO.doc();
  return { mvp: best[0] ? row(best[0]) : null, honours: best.slice(1, 4).map(row), t: Math.round(S.time), rout: MO.M.rout.map(x => x != null), esc: MO.M.esc.slice(), broke: MO.M.broke.slice(), surr: MO.M.prizes,
    cmdrs: (out.tac || []).map(t => ({ name: t.name, ours: t.team === 0, fate: fate(t) })), field: TRN.info().name, foe: MO.M.lead ? `${MO.M.lead.name} (${D.name})` : null,
    convoy: OPS.OP.kind ? { kind: OPS.OP.kind, got: OPS.OP.got, lost: OPS.OP.lost, of: OPS.OP.convoy.length } : null, held: !!r.held, champs: [...(B.champDead || [])].map(a => a.name), foeOwner: B.foe, ...whyOf() };
}
// why it went the way it did: strength over time, damage by weapon and side, time lost to EMP, ordnance spent,
// and the ten seconds that decided it. Team 0 is always the player.
function whyOf() {
  const tl = B.timeline.slice(); tl.push([Math.round(S.time), Math.round(strength(0)), Math.round(strength(1)), countOf(0), countOf(1)]);
  const dmg = [0, 1].map(t => Object.entries(TC.T.dmg[t] || {}).map(([k, e]) => ({ kind: k, name: TC.kindName(k), sh: Math.round(e.sh), hull: Math.round(e.hull) })).sort((a, b) => (b.sh + b.hull) - (a.sh + a.hull)));
  const st = S.bstat || { emp: [0, 0], ord: [0, 0], rounds: [0, 0] };
  return { timeline: tl, dmg, dmgTotal: dmg.map(L => L.reduce((a, e) => a + e.sh + e.hull, 0)), empSec: [Math.round(st.emp[0]), Math.round(st.emp[1])], ordSpent: [Math.round(st.ord[0]), Math.round(st.ord[1])], rounds: [st.rounds[0], st.rounds[1]], swing: swingOf(tl), kills: TC.T.kills.slice(-40) };
}
function swingOf(tl) {
  const share = e => (e[1] + e[2]) ? e[1] / (e[1] + e[2]) : .5; let best = null;
  for (let i = 0; i < tl.length; i++) for (let j = i + 1; j < tl.length && tl[j][0] - tl[i][0] <= 10; j++) { if (tl[j][0] - tl[i][0] < 8) continue; const d = share(tl[j]) - share(tl[i]); if (!best || Math.abs(d) > Math.abs(best.d)) best = { t0: tl[i][0], t1: tl[j][0], d }; }
  if (!best || Math.abs(best.d) < .02) return null;
  const k = TC.T.kills.filter(e => e.t >= best.t0 - 1 && e.t <= best.t1 + 1), ours = best.d > 0;
  const lost = k.filter(e => e.team === (ours ? 1 : 0)).sort((a, b) => b.v - a.v).map(e => e.name);
  return { t0: best.t0, t1: best.t1, delta: Math.round(best.d * 100), ours, kills: lost.slice(0, 4), text: `${Math.floor(best.t0 / 60)}:${String(best.t0 % 60).padStart(2, '0')}–${Math.floor(best.t1 / 60)}:${String(best.t1 % 60).padStart(2, '0')}: the balance swung ${Math.abs(Math.round(best.d * 100))} points ${ours ? 'our way' : 'theirs'}${lost.length ? ` as ${lost.slice(0, 3).join(', ')} ${lost.length > 1 ? 'were' : 'was'} lost` : ''}` };
}
// the compact report, over the field while the last shots are fired
function showAAR(r) {
  let el = $('baar'); if (!el) { el = document.createElement('div'); el.id = 'baar'; el.className = 'panel'; document.body.appendChild(el); el.addEventListener('click', e => { if (e.target.closest('[data-aar=go]') && B && B.endT != null) B.endT = 0; }); }
  const W = whyOf(), won = r && ((r.attWin && B.attTeam === 0) || (!r.attWin && B.defTeam === 0)), f = v => v >= 10000 ? (v / 1000).toFixed(0) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v), mm = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const tot = Math.max(1, W.dmgTotal[0], W.dmgTotal[1]), bars = t => W.dmg[t].slice(0, 4).map(e => `<div class="aw"><span>${e.name}</span><i style="width:${Math.round((e.sh + e.hull) / tot * 100)}%"></i><b>${f(e.sh + e.hull)}</b></div>`).join('') || '<div class="aw"><span>Nothing landed</span></div>';
  const tl = W.timeline, mx = Math.max(1, ...tl.map(e => Math.max(e[1], e[2]))), pts = t => tl.map((e, i) => `${(i / Math.max(1, tl.length - 1) * 200).toFixed(1)},${(40 - e[t] / mx * 38).toFixed(1)}`).join(' ');
  el.innerHTML = `<div class="ah ${won ? 'good' : 'bad'}">${won ? 'Victory' : 'Defeat'} · ${mm(S.time)}</div>
    <svg class="atl" viewBox="0 0 200 42" preserveAspectRatio="none"><polyline points="${pts(1)}" style="stroke:${S.teamc[0].main}"/><polyline points="${pts(2)}" style="stroke:${S.teamc[1].main}"/>${W.swing ? `<rect x="${(tl.findIndex(e => e[0] >= W.swing.t0) / Math.max(1, tl.length - 1) * 200).toFixed(1)}" y="0" width="${Math.max(2, 10 / Math.max(1, S.time) * 200).toFixed(1)}" height="42"/>` : ''}</svg>
    ${W.swing ? `<div class="asw">${W.swing.text}</div>` : ''}
    <div class="acols"><div><div class="ac">Our fire · ${f(W.dmgTotal[0])}</div>${bars(0)}</div><div><div class="ac">Theirs · ${f(W.dmgTotal[1])}</div>${bars(1)}</div></div>
    <div class="ast">EMP: ours lost ${W.empSec[0]} ship-seconds, theirs ${W.empSec[1]} · Ordnance spent ${f(W.ordSpent[0])} / ${f(W.ordSpent[1])}</div>
    <button class="btn go" data-aar="go">Continue ▸</button>`;
  el.classList.remove('hide');
}
// what the campaign gets for the convoys that got through
function opsPay(res) {
  const O = OPS.OP, w = C.worlds[B.cf.world], nm = bodyOf(B.cf.world).name, f = C.fac[B.me]; if (!O.got || !O.kind) return;
  if (O.kind === 'evac') { f.res.man += 2500 * O.got; f.res.ord += 150 * O.got; K.note(`${O.got} transport${O.got > 1 ? 's' : ''} got clear of ${nm}: +${(2500 * O.got).toLocaleString()} manpower and +${150 * O.got} ordnance reach safety.`, 'good', B.cf.world); }
  if (O.kind === 'relief') {
    w.garrison = Math.min(K.garrisonCap(w), w.garrison + 250 * O.got);
    if (O.got >= 2 && w.siege) w.siege.turns = 0;
    K.note(`The relief convoy reaches ${nm}: ${O.got} transport${O.got > 1 ? 's' : ''} through, +${250 * O.got} garrison${O.got >= 2 ? ', and the siege must begin again' : ''}.`, 'good', B.cf.world);
  }
  if (res) res.convoy = { kind: O.kind, got: O.got, lost: O.lost };
}
export function withdraw() {
  if (!B || B.endT != null || B.diseng != null) return;
  if (!B.confirmW) { B.confirmW = true; const b = document.querySelector('[data-ba=withdraw]'); if (b) { b.textContent = 'Confirm withdraw'; b.classList.add('warn'); } setTimeout(() => { if (B) { B.confirmW = false; buildBar(); } }, 3000); return; }
  B.diseng = DISENGAGE; S.paused = false; document.body.classList.remove('paused');
  toast(`All ships: disengage. The fleet must survive ${DISENGAGE} seconds under fire to get clear.`, 'bad', null, true); updBar();
}
function steerAway() {
  const foes = S.ships.filter(s => s.team === 1 && !s.dead), mine = S.ships.filter(s => s.team === 0 && !s.dead && !s.def.static); if (!mine.length) return;
  const fc = foes.length ? foes.reduce((a, s) => ({ x: a.x + s.x / foes.length, y: a.y + s.y / foes.length }), { x: 0, y: 0 }) : bodyOf(B.bw);
  for (const s of mine) { if (s.order && s.order.away) continue; const dx = s.x - fc.x, dy = s.y - fc.y, d = Math.hypot(dx, dy) || 1; s.order = { type: 'move', x: s.x + dx / d * 30000, y: s.y + dy / d * 30000, away: true }; }
}
export function autoRest() {
  if (!B || B.endT != null) return;
  // hand the rest of the fight to the dice: what has happened so far stands
  const { cf } = B; writeBack();
  opsPay(null); music(0); S.follow = null; if (S.camReset) S.camReset(); const done = B.resolve; B = null; TC.teardown(); TRN.teardown(); OPS.teardown(); S.aiHook = null; S.fireLong = null; S.mode = null; S.selection = []; S.paused = false; document.body.classList.remove('battle', 'paused');
  let res;
  if (!K.cfFleets(cf, cf.att).length) { res = { attWin: false, world: cf.world, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, space: cf.space }; K.afterBattle(res); }
  else if (!K.cfFleets(cf, cf.def).length && !cf.withWorld) { res = { attWin: true, world: cf.world, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, space: cf.space }; K.afterBattle(res); }
  else res = K.autoResolve(cf);
  enterStrat(); done(res);
}
export const inBattle = () => !!B;
function cmdClick(e) { const b = e.target.closest('[data-ba]'); if (!b || !B) return; const k = b.dataset.ba;
  if (k === 'hang') hangar(b.dataset.hg); else if (k === 'closing') closingToggle(); else if (k === 'finish') autoRest(); else if (k === 'commit') commitReserves(); else if (k === 'ab') { useAb(b.dataset.ab); } else if (k === 'helm') { helmSel(b.dataset.helm); } else if (k === 'adv') { TC.advance(); if (S.paused) { S.paused = false; document.body.classList.remove('paused'); } } else if (k === 'tac') { TC.T.tac = !TC.T.tac; updBar(); } else if (k === 'fire') fireToggle(); }
// the hangar row: what the ships selected (or the whole fleet) carry, and how to send it
function hangInfo(G) {
  const L = G ? G.ships : [], sum = k => L.reduce((a, s) => a + (s.h && s.h[k] > 0 ? s.h[k] : 0), 0), has = k => L.some(s => s.def.hangar && s.def.hangar[k]);
  const out = S.ships.filter(f => f.type === 'ripwing' && !f.dead && L.includes(f.carrier)).length, nk = L.reduce((a, s) => a + nukesOn(s).reduce((b, w) => b + Math.floor(w.ammo), 0), 0);
  const held = L.some(s => s.h && s.hmode === 'hold');
  return { shells: sum('starshell'), pods: sum('boarder'), wings: sum('ripwing'), storks: sum('stork'), out, nk, held, any: { shells: has('starshell'), pods: has('boarder'), wings: has('ripwing'), storks: sum('stork') > 0, nk: L.some(s => nukesOn(s).length) } };
}
function hangar(k) {
  const G = AB.forSel(); if (!G) return; const L = G.ships;
  if (k === 'shells' || k === 'pods') { const I = hangInfo(G); if (!(k === 'pods' ? I.pods : I.shells)) { toast(k === 'pods' ? 'No leechCraft aboard' : 'No starShells aboard', 'bad', null, true); return; } setTargetMode(k, L); toast(`Click an enemy capital ship within ${LAUNCH_R.toLocaleString()} km of the carriers · right-click or Esc to cancel`, 'prompt'); }
  else if (k === 'nuke') { if (!L.some(s => nukesOn(s).some(w => w.ammo >= 1))) { toast('No nuclear missiles ready in these ships', 'bad', null, true); return; } setNukeMode(L); }
  else if (k === 'wings') { const was = S.selection; S.selection = L.filter(s => s.h); if (S.selection.length) toggleHangars(); else toast('No hangars among these ships', 'bad', null, true); S.selection = was; }
  B.abSig = null;
}
// closing speed: the approach's twelve-times clock, on demand, whenever nobody is in reach
function closingToggle() { const r = TC.closing(); if (r) toast(r, 'prompt', null, true); updBar(); }
function fireToggle() { if (!S.fireLong) return; S.fireLong[0] = !S.fireLong[0]; toast(S.fireLong[0] ? 'Open fire: every gun at its full reach. Long shots go wide and spend the magazines' : 'Hold fire to effective range: the guns wait, the magazines last, and we stay harder to see', '', null, true); updBar(); }
// battle keys, ahead of the sandbox's: V the tactical overlay, X advance to contact
let keysOn = false;
function keysOnce() {
  if (keysOn) return; keysOn = true;
  addEventListener('keydown', e => {
    if (!B || S.mode !== 'battle' || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) return;
    const k = e.key.toLowerCase();
    if (k === 'v' && !e.ctrlKey && !e.metaKey) { TC.T.tac = !TC.T.tac; updBar(); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (k === 'x' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { TC.advance(); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (k === 'o' && !e.ctrlKey && !e.metaKey) { fireToggle(); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (k === 'x' && e.shiftKey && !e.ctrlKey && !e.metaKey) { closingToggle(); e.stopImmediatePropagation(); e.preventDefault(); }
    else if ((k === 'y' || k === 'g' || k === 'l') && !e.ctrlKey && !e.metaKey && !B.deploy) { hangar(k === 'y' ? (e.shiftKey ? 'pods' : 'shells') : k === 'g' ? 'nuke' : 'wings'); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !B.deploy) { const ab = Object.keys(AB_KEYS).find(x => AB_KEYS[x].toLowerCase() === k); if (ab) { useAb(ab); e.stopImmediatePropagation(); e.preventDefault(); } }
  }, true);
}

const barClick = e => { const b = e.target.closest('[data-ba]'); if (!b) return; if (b.dataset.ba === 'closing') closingToggle(); else if (b.dataset.ba === 'skip') { if (B && !B.deploy && !TC.T.contact) { B.skip = true; B.skipG = null; if (S.paused) { S.paused = false; document.body.classList.remove('paused'); } } } else if (b.dataset.ba === 'withdraw') withdraw(); else if (b.dataset.ba === 'auto' || b.dataset.ba === 'finish') autoRest(); else if (b.dataset.ba === 'adv') { TC.advance(); if (S.paused) { S.paused = false; document.body.classList.remove('paused'); } } else if (b.dataset.ba === 'tac') { TC.T.tac = !TC.T.tac; updBar(); } else if (b.dataset.ba === 'begin') { S.paused = false; document.body.classList.remove('paused'); } };
// the battle bar: where, how long, how it stands, and the way out; beneath it, how to win
function buildBar() {
  let el = $('bbar'); if (!el) { el = document.createElement('div'); el.id = 'bbar'; el.className = 'panel'; document.body.appendChild(el);
    el.addEventListener('click', barClick); }
  let fd = $('bfeed'); if (!fd) { fd = document.createElement('div'); fd.id = 'bfeed'; document.body.appendChild(fd); }
  let bc = $('bcmd'); if (!bc) { bc = document.createElement('div'); bc.id = 'bcmd'; bc.className = 'panel'; document.body.appendChild(bc); bc.addEventListener('click', cmdClick); }
  bc.innerHTML = `<div class="bcrow"><span id="babil"></span></div><div class="bcrow"><span id="bhang"></span></div><div class="bcrow"><span id="bhelm"></span><button class="btn hide" data-ba="commit" id="bCom" title="Order the reserves in: they arrive in 20 seconds where they were held">Commit reserves</button><button class="btn" data-ba="adv" title="Every ship of yours: attack-move on the enemy">Advance <kbd>X</kbd></button><button class="btn" data-ba="tac" id="bTac" title="Tactical overlay: weapon ranges, broadside arcs and who is firing on whom">Tactical <kbd>V</kbd></button><button class="btn" data-ba="fire" id="bFire" title="Fire discipline. Holding, every gun waits for its effective range: the magazines last and a ship that is not firing is harder to see. Open fire, and the guns reach out to their full range, but long shots go wide, spend the magazines and light up every ship that fires">Hold fire <kbd>O</kbd></button><button class="btn go hide" data-ba="finish" id="bFin" title="The enemy is broken: let the dice finish what you started, from where the battle stands">Finish it</button></div>`;
  let ob = $('bobj'); if (!ob) { ob = document.createElement('div'); ob.id = 'bobj'; ob.className = 'panel'; document.body.appendChild(ob); ob.addEventListener('click', e => { if (deployClick(e)) return; if (e.target.closest('[data-ba=bomb]')) { const r = OPS.bombStart(0); if (!r.ok) toast(r.why, 'bad', null, true); updBar(); return; } if (e.target.closest('[data-ba=rain]')) { useAb('rain'); return; } if (e.target.closest('[data-ba=begin]')) { S.paused = false; document.body.classList.remove('paused'); } }); }
  const nm = bodyOf(B.cf.world).name, att = B.attTeam === 0, w = C.worlds[B.cf.world];
  const fname = t => (FACTIONS[S.fac[t]] || {}).name || (t ? 'The enemy' : 'Our fleet'), lead0 = (S.cmdrs || []).filter(c => c.team === 0 && c.state === 'aboard').sort((a, b) => (b.rank || 0) - (a.rank || 0))[0], lead1 = MO.M.lead;
  const side = (t, ld) => `<div class="ws ${t ? 'them' : 'us'}" style="--tc:${S.teamc[t].main}"><div class="wn"><b>${fname(t)}</b><span title="${ld ? ld.name : ''}">${ld ? ld.name.split(' ')[0] : t ? 'No commander' : ''}</span><em id="${t ? 'bmD' : 'bmA'}"></em></div>
      <div class="wb str" title="Fleet strength: what is left of each fleet, against the larger of the two at its peak"><i id="${t ? 'bmR' : 'bmL'}"></i></div>
      <div class="wb mor" id="${t ? 'moB' : 'moA'}"><i id="${t ? 'moR' : 'moL'}"></i><s id="${t ? 'moRb' : 'moLb'}"></s></div></div>`;
  { const old = document.querySelector('#top .bbtns'); if (old) old.remove(); }
  let wb = $('bban'); if (!wb) { wb = document.createElement('div'); wb.id = 'bban'; document.body.appendChild(wb);
    wb.addEventListener('click', e => { const c = e.target.closest('[data-ba]'); if (!c || !B) return; const k = c.dataset.ba;
      if (k === 'bomb') { const r = OPS.bombStart(0); if (!r.ok) toast(r.why, 'bad', null, true); updBar(); }
      else if (k === 'rain') useAb('rain');
      else if (k === 'deck') { const t = S.ships.find(s => s.id === +c.dataset.sid); if (t) { S.selection = t.team === 0 ? [t] : []; if (t.team !== 0) S.inspect = t; S.cam.x = t.x; S.cam.y = t.y; S.follow = null; } } });
    wb.addEventListener('mouseover', e => { const o = $('bobj'); if (o) o.classList.toggle('peek', !!e.target.closest('.ochips')); });
    wb.addEventListener('mouseleave', () => { const o = $('bobj'); if (o) o.classList.remove('peek'); }); }
  wb.innerHTML = `<div class="wban">${side(0, lead0)}<div class="wmid"><b id="bclk"></b><span>Strength<br>Morale</span><i class="wpau">Paused</i></div>${side(1, lead1)}</div>${B.deploy ? '' : '<div class="ochips" id="bochips"></div>'}`;
  el.innerHTML = `<div class="bt">${B.space ? 'Deep space off ' + nm : 'Battle of ' + nm}<small id="btime"></small></div>
    <div class="bbtns"><button class="btn" data-ba="auto" title="Let the dice decide the rest of the battle">Auto-resolve</button><button class="btn hide" data-ba="closing" id="bClose" title="Closing speed (Shift+X): the clock runs at 12× to 48× while nobody is in reach, fastest across the long gaps. Before contact it is on by default; click to watch the approach at your own speed. It drops back to normal speed at the first shot, or once the fleets are inside the longest weapon reach on the field">Closing speed ▸▸</button><button class="btn" data-ba="skip" id="bSkip" title="Run the approach fast until the fleets are within reach of each other">Skip to contact ▸▸</button><button class="btn" data-ba="withdraw" title="Disengage: every ship burns away from the enemy and must survive ${DISENGAGE} seconds under fire">Withdraw</button></div>`;
  const win = att ? [B.cf.withWorld ? `Board ${nm}'s orbital authority: the world falls at once` : null, `Destroy or rout every armed enemy ship${B.cf.alone ? ' and platform' : ''}`] : [`Destroy or rout every attacking warship`, `Hold for ${TIME_LIMIT / 60} minutes: the attack breaks off`];
  const lose = att ? [`Lose every armed ship`, `Fail to win within ${TIME_LIMIT / 60} minutes: the attack breaks off`] : [B.cf.withWorld ? `The enemy boards ${nm}'s orbital authority` : null, `Lose every armed ship`];
  if (B.space) { win.length = 0; lose.length = 0;
    if (att) { win.push('Destroy or rout the intercepted fleet'); lose.push('Half their surviving ships cross the break-through line', `They hold out ${TIME_LIMIT / 60} minutes: they slip away in the dark`, 'Lose every armed ship'); }
    else { win.push('Break through: get half your surviving ships across the break-through line', `Hold out ${TIME_LIMIT / 60} minutes: you lose them in the dark`, 'Destroy or rout the interceptors'); lose.push('Lose every armed ship'); } }
  if (S.rainCtx) win.push(`Silence ${nm}'s guns, hold the drop corridor alone for ${OPS.CORR_T} seconds, then drop the Iron Rain: if the legions beat the garrison, the world falls. Optional: bombard ${OPS.OP.orb ? OPS.OP.orb.cap : 'the capital'} first`);
  if (!att && OPS.OP.orb && OPS.OP.orb.pods) win.push(`Keep a warship in the drop corridor over ${nm}: while it is contested, their pods cannot fall`);
  if (B.rainZones) { win.length = 0; lose.length = 0; win.push(`Board ${nm}'s orbital authority: the world falls at once`); lose.push('Every leechCraft spent, and no legion left fighting on the ground', `Fail to take two zones within ${TIME_LIMIT / 60} minutes`); }
  if (B.quest) { win.length = 0; lose.length = 0; lose.push(B.defTeam === 0 ? 'Lose the orbit, or every armed ship' : 'Lose every armed ship', `Fail within ${TIME_LIMIT / 60} minutes`); }
  ob.innerHTML = `<div class="ofull"><div class="oh">${B.deploy ? 'Deployment · the battle is paused' : 'Objectives'}</div>${win.filter(Boolean).map(t => `<div class="ow">✔ ${t}</div>`).join('')}${OPS.OP.list.map(o => `<div class="ow op">◆ ${o.text}<span data-op="${o.k}">${OPS.statusOf(o.k, S.time)}</span></div>`).join('')}${lose.filter(Boolean).map(t => `<div class="ol">✕ ${t}</div>`).join('')}${B.deploy ? deployHTML() + `<div class="od">Choose how you come in, set your groups, then begin. P pauses and resumes at any time.</div><button class="btn go" data-ba="begin">Begin the battle ▸</button>` : ''}</div>`;
  ob.classList.toggle('deploy', !!B.deploy);
  updBar();
}
// the objectives strip: each thing the battle can be won or lost by, with how it stands
function objChips(clock) {
  const el = $('bochips'); if (!el) return; const O = OPS.OP, nm = bodyOf(B.cf.world).name, C2 = [];
  const chip = (st, txt, tip, act) => C2.push(`<span class="oc ${st}" title="${tip || txt}" ${act ? `data-ba="${act}"` : ''}><i></i>${txt}</span>`);
  const mm = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  if (O.orb) { const g = S.ships.filter(s => s.team === B.defTeam && !s.dead && s.type === 'gunplat').length, g0 = O.orb.guns0, att = B.attTeam === 0;
    if (g0) chip(g ? (att ? 'on' : 'ok') : (att ? 'done' : 'bad'), `${att ? 'Silence' : 'Keep'} the guns · ${g0 - g}/${g0} down`, `${nm}'s gun platforms: ${g} of ${g0} still firing. Nothing lands through live guns.`);
    const podsAny = !B.rain && (podsAboard(B.attTeam) || B.res.some(r => r.team === B.attTeam && !r.done && r.ships.some(x => x.def.troops || (x.h && x.h.boarder > 0))));
    if (podsAny) { const st = O.orb.state; chip(O.orb.open ? (att ? 'done' : 'bad') : st === 'holding' ? (att ? 'on' : 'warn') : st === 'contested' ? 'warn' : att ? 'on' : 'ok', `${att ? 'Hold' : 'Contest'} the drop corridor · ${O.orb.open ? 'open' : Math.floor(O.orb.prog) + '/' + OPS.CORR_T + 's'}`, `The corridor over the near limb: held alone by the attacker for ${OPS.CORR_T} seconds, with the guns silent, it lets the Rain fall. A defending warship in it stops the clock.`); }
    if (att && S.rainCtx && podsAny) { const why = S.rainCtx.why(); chip(B.rain ? 'done' : why ? 'dim' : 'go', B.rain ? 'The Rain is falling' : 'Drop the Iron Rain · I', why || 'The pods are over the world and the corridor is open: drop them', why ? null : 'rain'); }
    if (att) { const c = OPS.bombCan(0); chip(O.orb.bombed ? 'done opt' : O.orb.bomb ? 'on opt' : c.ok ? 'go opt' : 'dim opt', O.orb.bombed ? `${O.orb.cap} burns` : O.orb.bomb ? `Bombarding ${O.orb.cap} · ${O.orb.bomb.left}s` : `Optional: bombard ${O.orb.cap}`, `${c.ok ? 'Click to order it. ' : c.why ? c.why + '. ' : ''}A capital ship in low orbit bombs the capital for ${OPS.BOMB_T} seconds: the garrison is cut by 40% and the defenders' morale breaks, but the Senate, the Reds and every world remember it.`, c.ok && !O.orb.bomb && !O.orb.bombed ? 'bomb' : null); } }
  if (O.lag) { const L = O.lag; chip(L.state === 'ours' ? 'on' : L.state === 'theirs' ? 'warn' : 'dim', `Lagrange point · ${Math.floor(L.vp[0])} – ${Math.floor(L.vp[1])} / ${L.need}${L.state === 'quiet' ? ' · enemy out of reach' : ''}`, 'Hold the point alone while the enemy is still in the fight around it: the first side to two minutes, all told, holds the field'); }
  for (const o of O.list) if (o.k !== 'lag') chip('on', o.text.split(':')[0] + OPS.statusOf(o.k, clockT()), o.text);
  for (const r of B.res) if (r.kind === 'reinf' && !r.done) chip(r.team === 0 ? 'ok' : 'warn', `${r.team === 0 ? 'Relief' : 'Enemy relief'}: ${r.name} ${B.t0 == null ? mm(r.eta) + ' after contact' : 'in ' + mm(Math.max(0, r.eta - clockT()))}`, r.team === 0 ? 'Hold until they arrive' : 'Break them before their relief arrives');
  for (const D of TC.decks()) { const t = D.t, ours = D.team === 0; C2.push(`<span class="oc ${ours ? 'on' : 'warn'}" data-ba="deck" data-sid="${t.id}" title="${ours ? 'Our boarders are aboard' : 'Enemy boarders are aboard'}: click to go there${ours && t.def.cmd ? '. Select her to choose what they go for' : ''}"><i></i>${ours ? 'Boarding' : 'Boarders on'} ${t.title || t.def.name} · ${Math.round((t.boardProg || 0) * 100)}%${t.engWreck ? ' · engines out' : ''}</span>`); }
  if (B.rain && B.rain.stage === 2 && !B.rain.done) { const G = B.rain, ours = G.team === 0, fly = G.storks.filter(s => !s.landedT && !s.lostT && !s.descT).length, desc = G.storks.filter(s => !s.landedT && !s.lostT && s.descT).length;
    chip(ours ? (G.A > G.D ? 'on' : 'warn') : (G.A > G.D ? 'bad' : 'warn'), `Ground · ${ours ? 'our legions' : 'their legions'} ${Math.round(G.A / 5 / G.mul).toLocaleString()} vs ${Math.round(G.D / 5).toLocaleString()}`, 'The fight on the surface: the world falls when the garrison is gone; the Rain fails when the legions are');
    if (G.storks.length) chip(ours ? (G.lost ? 'warn' : 'on') : 'warn', `Storks · ${G.landed} landed${desc ? ' · ' + desc + ' in the atmosphere' : ''}${fly ? ' · ' + fly + ' flying' : ''}${G.lost ? ' · ' + G.lost + ' lost' : ''}`, ours ? 'Keep the corridor clear: anything in it can shoot them down' : 'Their dropships: shoot them down before they land'); }
  if (MO.M.rout[1] != null) chip('done', 'The enemy is broken', 'Run them down, or finish it');
  const h = C2.join(''); if (el._h !== h) { el._h = h; el.innerHTML = h; }
  const ck = $('bclk'); if (ck) { ck.textContent = clock; ck.title = B.space ? 'Time left before the intercepted fleet slips away' : B.defTeam === 0 ? 'Time the defence must hold' : 'Time before the attack breaks off'; }
}
function updBar() {
  if (!B) return; const a = strength(0), d = knownStrength(), t = a + d || 1;
  if (B.deployShown !== B.deploy) { B.deployShown = B.deploy; buildBar(); return; }
  { const pk = Math.max(MO.M.peak[0] || 1, MO.M.peak[1] || 1); $('bmL').style.width = Math.min(100, a / pk * 100) + '%'; $('bmR').style.width = Math.min(100, d / pk * 100) + '%';
    // their morale as we can read it: from what we can see of their fleet, not from what they really have left
    // every enemy ship we have seen, at the state we last saw her in: what is gone from that is what we know they have lost
    const SV = B.seenV || (B.seenV = new Map()); for (const e of S.ships) if (e.team === 1 && !e.def.static && !e.def.fighter && !e.def.shell && e.vis && e.vis[0] && !e.dead) SV.set(e.id, { s: e, v: e.def.value || 50, hp: e.hp / e.def.hp });
    let sv = 0, sl = 0; for (const [, x] of SV) { if (x.s.dead || x.s.surrendered || x.s.derelict || x.s.team !== 1 || x.s.broken) x.hp = 0; sv += x.v; sl += x.v * x.hp; }
    const adv1 = Math.max(-1, Math.min(1, (d - a) / (Math.max(a, d) || 1))), est1 = MO.M.rout[1] != null ? Math.min(MO.M.mor[1], MO.breakAt(1) - 1) : Math.max(0, Math.min(100, (sv ? 100 * sl / sv : 100) + 12 * adv1 - MO.M.shockV[1]));
    for (const [t, id] of [[0, 'A'], [1, 'B']]) { const m = t ? est1 : MO.M.mor[t], br = MO.breakAt(t), box = $('mo' + id), bar = $(t ? 'moR' : 'moL'), mk = $(t ? 'moRb' : 'moLb'); if (!box) continue;
      bar.style.width = m + '%'; mk.style[t ? 'right' : 'left'] = br + '%'; box.classList.toggle('near', m < br + 10 && m >= br); box.classList.toggle('broke', MO.M.rout[t] != null || (t === 0 && m < br));
      bar.style.background = m >= br + 25 ? '#8fd39a' : m >= br + 10 ? '#e8c87e' : '#ff7a6a';
      const ev = MO.M.ev.filter(e => e.team === t).slice(0, 4).map(e => `${e.v > 0 ? '−' : '+'}${Math.abs(Math.round(e.v))} ${e.why}`).join('\n');
      box.title = `${t ? 'Their morale, as far as we can read it' : 'Our morale'}: ${Math.round(m)} of 100. ${t ? 'They break' : 'Our crews start running'} below ${br}${t ? ` (${MO.doc().name} doctrine)` : ''}.${ev ? '\n' + ev : ''}`; } }
  $('bmA').textContent = S.ships.filter(s => s.team === 0 && !s.def.static && !s.dead && !s.def.fighter && !s.def.shell && !s.offField).length + ' ships'; { const k = SNS.counts(), el = $('bmD'); { const u = k.contacts + k.ghosts; el.textContent = (k.seen || !u ? k.seen : '') + (u ? (k.seen ? ' +' : '') + u + '?' : '') + ' ships'; } el.title = `${k.seen} enemy ships in sight · ${k.contacts} sensor contacts · ${k.ghosts} lost from sight`; }
  const left = Math.max(0, TIME_LIMIT - clockT()), clock = Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
  abilUI(); deckUI(); const fin = $('bFin'); if (fin) fin.classList.toggle('hide', !(TC.broken() || MO.M.rout[1] != null) || B.deploy); const com = $('bCom'); if (com) { const n = B.res.filter(r => r.team === 0 && r.kind === 'reserve' && !r.done && r.eta == null).length; com.classList.toggle('hide', !n || B.deploy); com.textContent = `Commit reserves (${n})`; } const tb = $('bTac'); if (tb) tb.classList.toggle('on', TC.T.tac); const bf = $('bFire'); if (bf && S.fireLong) { bf.classList.toggle('on', !!S.fireLong[0]); bf.innerHTML = (S.fireLong[0] ? 'Open fire' : 'Hold fire') + ' <kbd>O</kbd>'; }
  document.querySelectorAll('#bobj [data-op]').forEach(e => { e.textContent = OPS.statusOf(e.dataset.op, clockT()); });
  { const sk = $('bSkip'); if (sk) sk.classList.toggle('hide', !!(B.deploy || TC.T.contact || B.t0 != null || B.skip)); }
  { const cl = $('bClose'), avail = !B.deploy && B.diseng == null && !B.skip; if (cl) { cl.classList.toggle('hide', !avail); cl.classList.toggle('on', !!TC.T.ff); cl.textContent = TC.T.ff ? `Closing ${S.speed}× · on` : 'Closing speed ▸▸'; } }
  if (TC.T.stall && !B.stallSaid && !B.deploy) { B.stallSaid = true; toast('Nobody is closing: the fleets are holding apart. Give your ships orders, or press X to advance on the enemy', 'prompt', null, true); }
  objChips(B.t0 == null ? '--:--' : clock); $('btime').textContent = B.skip ? `Skipping the approach · ${Math.round((TC.T.gap || 0) / 1000)}k km` : B.t0 == null && !TC.T.ff && B.diseng == null ? 'The clock starts at contact' : TC.T.stall && !TC.T.contact && B.diseng == null ? `Holding · ${Math.round((TC.T.gap || 0) / 1000)}k km apart · X to advance` : TC.T.ff && B.diseng == null ? `Closing · ${Math.round((TC.T.gap || 0) / 1000)}k km · ${S.speed}× speed` : B.diseng != null ? `Disengaging · clear in ${Math.ceil(B.diseng)}s` : (B.space ? (B.defTeam === 0 ? 'Lose them in ' : 'They slip away in ') : B.defTeam === 0 ? 'Hold for ' : 'Attack breaks off in ') + clock;
}

// ---------------------------------------------------------------- deployment: approach, reserves, reinforcements
const centroid = L => ({ x: L.reduce((a, s) => a + s.x, 0) / L.length, y: L.reduce((a, s) => a + s.y, 0) / L.length });
const mobile = t => S.ships.filter(s => s.team === t && !s.def.static && !s.dead);
function setupDeploy(inc) {
  const b = bodyOf(B.bw);
  // where each side stands at the start, before any choice
  for (const t of [0, 1]) { const L = mobile(t); if (L.length) B['base' + t] = L.map(s => [s, s.x, s.y, s.a]); }
  const a = mobile(B.attTeam), d = mobile(B.defTeam);
  B.axis = a.length ? Math.atan2(centroid(a).y - b.y, centroid(a).x - b.x) : 0; // from the world toward the attackers
  // reinforcements: pulled off the field, to arrive from the way they were coming
  for (const f of inc) {
    const t = B.teamOf(f.owner), ships = S.ships.filter(s => f.ships.includes(s.campRef)); if (!ships.length) continue;
    const fb = bodyOf(f.transit.from), dir = Math.atan2(fb.y - b.y, fb.x - b.x);
    holdOff({ team: t, ships, kind: 'reinf', name: f.name, fleet: f, eta: S.time + 100 + Math.random() * 80, entry: { x: b.x + Math.cos(dir) * (b.r + ZONE_R * .7), y: b.y + Math.sin(dir) * (b.r + ZONE_R * .7), dir } });
  }
  // the AI, attacking, may come out of the Sun
  if (B.attTeam === 1 && !B.space && Math.random() < .35) applyApproach(1, 'sun');
  frameField();
}
// the opening view: our line and what we came for (the world, or the enemy out in open space) in one frame, top down.
// The battle camera is kept between battles, so without this the field could open on empty space where the last one was
function frameField() {
  const own = mobile(0); if (!own.length) return; const c = centroid(own), foes = mobile(1), b = bodyOf(B.bw);
  const t = B.space || !b || !b.r ? (foes.length ? centroid(foes) : c) : b, r = t === b ? b.r : 0;
  S.cam.x = (c.x + t.x) / 2; S.cam.y = (c.y + t.y) / 2; S.follow = null;
  const d = Math.hypot(c.x - t.x, c.y - t.y) + r * 2 + 3000; S.cam.z = Math.max(.0035, Math.min(.09, Math.min(S.W, S.H) / (d * 1.3)));
}
function holdOff(r) { for (const x of r.ships) x.offField = true; const set = new Set(r.ships); S.ships = S.ships.filter(s => !set.has(s)); S.selection = S.selection.filter(s => !set.has(s)); B.res.push(r); }
function arrive(r) {
  r.done = true; const e = r.entry, c = centroid(r.ships);
  for (const s of r.ships) { s.offField = false; s.x = e.x + (s.x - c.x); s.y = e.y + (s.y - c.y); s.vx = s.vy = 0; s.a = e.dir + Math.PI; for (const w of s.weapons) w.ang = s.a + w.dir; S.ships.push(s); }
  const foes = S.ships.filter(s => s.team !== r.team && s.team < 2 && !s.dead && !s.def.static), fc = foes.length ? centroid(foes) : bodyOf(B.bw);
  const gs = new Set(r.ships.map(s => s.group).filter(Boolean));
  for (const g of gs) groupOrder(g, 'amove', fc.x, fc.y);
  for (const s of r.ships) if (!s.group) s.order = { type: 'amove', x: fc.x, y: fc.y };
  if (r.fleet) { r.fleet.at = B.cf.world; r.fleet.transit = null; } // in the campaign, the fleet has arrived
  if (r.team === 0 && TC.voice) TC.voice('reinf', r.ships[0], { T: r.name });
  TC.note(r.kind === 'reinf' ? `Reinforcements: ${r.name} arrives${r.team === 0 ? '' : ' for the enemy'}` : `Reserves committed: ${r.name} enters the battle`, r.team === 0 ? 0x9be8a8 : 0xff8a7a);
}
function resTick() {
  // reinforcements are timed from first contact (the approach does not count); reserves from when they are ordered in
  const now = r => r.kind === 'reinf' ? (B.t0 != null ? clockT() : -1) : S.time;
  for (const r of B.res) if (!r.done && r.eta != null && now(r) >= 0 && now(r) >= r.eta) arrive(r);
  // a side with nothing left on the field throws in its reserves at once
  for (const t of [0, 1]) if (!armedOnField(t)) for (const r of B.res) if (r.team === t && !r.done && (r.eta == null || r.eta > Math.max(0, now(r)) + 5)) { if (r.kind === 'reinf' && B.t0 == null) B.t0 = S.time; r.eta = Math.max(0, now(r)) + 5; }
}
function commitReserves() { let n = 0; for (const r of B.res) if (r.team === 0 && r.kind === 'reserve' && !r.done && r.eta == null) { r.eta = S.time + 20; n++; } if (n) TC.note('Reserves ordered in: they arrive in 20 seconds', 0xe8c87e); updBar(); }
function toggleReserve(gn) {
  const g = S.bgroups[gn]; if (!g) return;
  const held = B.res.find(r => r.kind === 'reserve' && r.gn === +gn && !r.done);
  if (held) { for (const s of held.ships) { s.offField = false; S.ships.push(s); } B.res.splice(B.res.indexOf(held), 1); return; }
  const ships = g.members.filter(s => !s.dead); if (!ships.length || ships.length === mobile(0).length) { toast('Keep at least one group on the field', 'bad'); return; }
  const c = centroid(ships); holdOff({ team: 0, ships, kind: 'reserve', name: g.name, gn: +gn, eta: null, entry: { x: c.x, y: c.y, dir: Math.atan2(c.y - bodyOf(B.bw).y, c.x - bodyOf(B.bw).x) } });
}
// ways in: for the attacker, out of the dark (the default), out of the Sun, from behind a nearby body, straight down the line;
// for the defender, holding orbit (the default), pushing forward, or waiting in the world's own shadow
function shadowBody() {
  if (B.space) return null;
  const b = bodyOf(B.bw); let best = null, bd = 1e18;
  for (const o of BODIES) { if (o === b || o.kind === 'star' || !o.r) continue; const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < ZONE_R * .85 && d > b.r + o.r + 2000 && d < bd) { bd = d; best = o; } }
  return best;
}
export function approaches() {
  const att = B.attTeam === 0, sb = shadowBody();
  if (B.space) return att ? [['dark', B.space.kind === 'ambush' ? 'From the dark, on their flank' : 'Across their course', B.space.kind === 'ambush' ? 'Close on their flank, where you lay in wait. They are on the march, shields half up.' : 'Ahead of them, across the line they are holding.', true], ['line', 'Straight at them', 'Start closer, in plain sight. Bold crews: +10% loyalty.', true]]
    : [['course', 'Hold your course', 'In travel column on your heading: run for the break-through line.', true], ['face', 'Turn to fight', 'Swing the line round to face them and give battle where you stand.', true]];
  return att ? [['dark', 'Out of the dark', 'The line you were coming on. No tricks.', true], ['sun', 'Out of the Sun', 'Come in sunward: enemy sensors looking into the Sun see you at a third of the range until you open fire.', true],
    ['shadow', sb ? `Behind ${sb.name}` : 'Behind a moon', sb ? `Start in ${sb.name}'s shadow: nothing sees through a world.` : 'No moon or planet close enough to hide behind.', !!sb], ['line', 'Straight down the line', 'Start closer, in plain sight. Bold crews: +10% loyalty.', true]]
    : [['orbit', 'Hold orbit', 'Under the world\'s guns and shields.', true], ['forward', 'Push forward', 'Meet them halfway, away from the platforms.', true], ['wshadow', 'In the world\'s shadow', 'Wait behind the world, out of their sight, and strike as they come round.', true]];
}
export function applyApproach(team, k) {
  const b = bodyOf(B.bw), base = B['base' + team]; if (!base) return;
  for (const [s, x, y, a] of base) { s.x = x; s.y = y; s.a = a; s.glare = 0; s.loy = Math.min(1, s.loy); }
  const L = base.map(e => e[0]).filter(s => S.ships.includes(s)), ax = B.axis;
  const put = (d, ang) => relocate(team, b.x + Math.cos(ang) * (b.r + d), b.y + Math.sin(ang) * (b.r + d), ang + Math.PI, L);
  if (k === 'line' && B.space) { const foes = mobile(1 - team); if (foes.length) { const c = centroid(foes), m = centroid(L), d = Math.hypot(c.x - m.x, c.y - m.y) || 1, k2 = Math.max(0, d - 35000) / d; relocate(team, m.x + (c.x - m.x) * k2, m.y + (c.y - m.y) * k2, Math.atan2(c.y - m.y, c.x - m.x), L); for (const s of L) s.loy = Math.min(1, s.loy + .1); } if (team === 0) B.approach = k; return; }
  if (k === 'sun') { const sa = Math.atan2(-b.y, -b.x); put(ATT_R, sa); for (const s of L) s.glare = 1e9; } /* lost in the glare until she opens fire */
  else if (k === 'shadow') { const o = shadowBody(); if (o) { const dir = Math.atan2(o.y - b.y, o.x - b.x), d = Math.hypot(o.x - b.x, o.y - b.y) + o.r + 1600; relocate(team, b.x + Math.cos(dir) * d, b.y + Math.sin(dir) * d, dir + Math.PI, L); } }
  else if (k === 'line') { put(47500, ax); for (const s of L) s.loy = Math.min(1, s.loy + .1); }
  else if (k === 'forward') put(35000, ax);
  else if (k === 'wshadow') put(1300, ax + Math.PI);
  else if (k === 'face') { const foes = mobile(1 - team); if (foes.length) { const c = centroid(foes); for (const s of L) { s.a = Math.atan2(c.y - s.y, c.x - s.x); for (const w of s.weapons) w.ang = s.a + w.dir; } } }
  else if (k === 'course' && B.space) for (const s of L) { s.order = { type: 'move', x: s.x + Math.cos(B.space.head) * 70000, y: s.y + Math.sin(B.space.head) * 70000 }; }
  if (team === 0) { for (const s of L) s.picket = false; if (B.pickets) placePickets(L); }
  if (team === 0) { B.approach = k; const c = centroid(L); S.cam.x = (c.x + b.x) / 2; S.cam.y = (c.y + b.y) / 2; const d = Math.hypot(c.x - b.x, c.y - b.y) + b.r * 2 + 3000; S.cam.z = Math.max(.0035, Math.min(.09, Math.min(S.W, S.H) / (d * 1.3))); }
}
// pickets: two small, quick hulls thrown out ahead, sensors wide open. They hear further and see further than the
// line, and they are the first thing the enemy meets
const PICKET_T = ['scout', 'corvette', 'corsair', 'raider', 'frigate'];
const picketsOf = L => L.filter(s => PICKET_T.includes(s.type) && !s.def.troops).sort((a, b) => PICKET_T.indexOf(a.type) - PICKET_T.indexOf(b.type)).slice(0, 2);
function placePickets(L, team = 0) {
  const P = picketsOf(L); if (!P.length) return; const m = centroid(L), foes = mobile(1 - team), b = bodyOf(B.bw), tg = foes.length ? centroid(foes) : b;
  let ux = tg.x - m.x, uy = tg.y - m.y; const d = Math.hypot(ux, uy) || 1; ux /= d; uy /= d; const go = Math.min(30000, d * .45);
  P.forEach((s, i) => { const side = i ? -1 : 1; s.x = m.x + ux * go - uy * 6000 * side; s.y = m.y + uy * go + ux * 6000 * side; s.a = Math.atan2(uy, ux); for (const w of s.weapons) w.ang = s.a + w.dir; s.picket = true; if (s.group) s.detached = true; s.order = { type: 'idle', x: s.x, y: s.y }; });
}
// what each approach does in this battle, measured: try it, see where the fleet ends up, put everything back
function approachFacts() {
  const ap = approaches(), cur = B.approach || ap[0][0], mine = S.ships.filter(s => s.team === 0 && !s.dead);
  const snap = mine.map(s => [s, s.x, s.y, s.a, s.glare, s.loy, s.order, s.picket, s.detached, s.weapons.map(w => w.ang), s.vx, s.vy]), cam = { x: S.cam.x, y: S.cam.y, z: S.cam.z }, hdg = groupList().map(g => [g, g.hdg]);
  const foes = mobile(1), b = bodyOf(B.bw), plats = S.ships.filter(s => s.team === 1 && s.def.static && !s.dead && s.weapons.length), out = {};
  for (const [k, , , ok] of ap) { if (!ok) continue; applyApproach(0, k); const L = mobile(0); if (!L.length) continue; const c = centroid(L), f = foes.length ? centroid(foes) : b;
    out[k] = { gap: Math.hypot(c.x - f.x, c.y - f.y), world: Math.hypot(c.x - b.x, c.y - b.y) - (b.r || 0), plat: plats.length ? Math.min(...plats.map(p => Math.hypot(c.x - p.x, c.y - p.y))) : null }; }
  for (const [s, x, y, a, gl, loy, ord, pk, det, wa, vx, vy] of snap) { s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.a = a; s.glare = gl; s.loy = loy; s.order = ord; s.picket = pk; s.detached = det; s.weapons.forEach((w, i) => { w.ang = wa[i]; }); }
  for (const [g, h] of hdg) g.hdg = h; B.approach = cur; Object.assign(S.cam, cam);
  return out;
}
const kmT = d => d >= 10000 ? `${Math.round(d / 1000)},000 km` : `${Math.round(d / 100) * 100} km`;
function approachLine(k, F, all) {
  const f = F[k]; if (!f) return '';
  const w = !B.space && C.worlds[B.cf.world], wn = bodyOf(B.bw).name, dark = all.dark, flare = (TRN.info().name || '').toLowerCase().includes('flare');
  const gun = w ? w.gun : 0, shd = w ? w.shield : 0, far = f.plat != null && f.plat > 12000;
  switch (k) {
    case 'dark': return `Starts ${kmT(f.gap)} from them. They see you coming the whole way in.`;
    case 'sun': return `Starts ${kmT(f.gap)} from them. Their scopes find you at a third of the usual range, so the first shots should be yours.${flare ? ' In the open, the flares hit your shields too.' : ''}`;
    case 'shadow': return `Starts ${kmT(f.gap)} from them, out of sight behind the world until you clear it.`;
    case 'line': return `Starts ${kmT(f.gap)} from them${dark && dark.gap > f.gap + 5000 ? `, ${kmT(dark.gap - f.gap)} closer than the dark approach` : ''}.`;
    case 'orbit': return gun + shd ? `${gun} gun platform${gun === 1 ? '' : 's'} and ${shd} shield platform${shd === 1 ? '' : 's'} fight beside you. They start ${kmT(f.gap)} out.` : `No platforms here to help. They start ${kmT(f.gap)} out.`;
    case 'forward': return `You meet them ${kmT(f.world)} out from ${wn}.${gun && far ? ` Out there the ${gun} gun platform${gun === 1 ? '' : 's'} cannot reach the fight.` : ''}`;
    case 'wshadow': return `Hidden behind ${wn}, ${kmT(f.gap)} from them. They find you only as they come round${gun ? `, under the guns of ${gun} platform${gun === 1 ? '' : 's'}` : ''}.`;
    case 'course': return `Holds your heading for the break-through line. They start ${kmT(f.gap)} off.`;
    case 'face': return `Turns the line to face them where you stand, ${kmT(f.gap)} apart.`;
  }
  return '';
}
function deployHTML() {
  const ap = approaches(), cur = B.approach || ap[0][0], F = approachFacts();
  let h = `<div class="dsec">${B.attTeam === 0 ? 'Approach' : 'Deployment'}</div><div class="daps dcards">${ap.map(([k, t, d, ok]) => `<button class="btn dap ${cur === k ? 'on' : ''}" data-ap="${k}" ${ok ? '' : 'disabled'}><b>${t}</b><span>${d}</span>${ok && F[k] ? `<em>${approachLine(k, F, F)}</em>` : ''}</button>`).join('')}</div>`;
  const gs = groupList().filter(g => g.flag && g.flag.team === 0).concat(B.res.filter(r => r.kind === 'reserve' && !r.done).map(r => S.bgroups[r.gn]).filter(Boolean));
  const seen = new Set();
  h += `<div class="dsec">Battle groups</div><div class="dgrps">` + gs.filter(g => !seen.has(g.n) && seen.add(g.n)).map(g => { const inRes = B.res.some(r => r.kind === 'reserve' && r.gn === g.n && !r.done);
    return `<div class="dgr ${inRes ? 'res' : ''}"><b>${g.name}</b><span>${g.members.filter(m => !m.dead).length} ships</span><button class="btn sm" data-dform="${g.n}" title="Formation">${(FORMATIONS.find(f => f[0] === g.formation) || FORMATIONS[0])[1]}</button><button class="btn sm" data-dstance="${g.n}" title="${(STANCES.find(x => x[0] === g.stance) || STANCES[0])[2]}">${(STANCES.find(x => x[0] === g.stance) || STANCES[0])[1]}</button><button class="btn sm ${inRes ? 'on' : ''}" data-dres="${g.n}" title="Hold the group back off the field; commit it when you choose, and it arrives 20 seconds later">${inRes ? 'In reserve' : 'Reserve'}</button></div>`; }).join('') + `</div>`;
  { const P = picketsOf(mobile(0)); h += `<div class="dsec">Pickets</div><div class="daps"><button class="btn sm ${B.pickets ? 'on' : ''}" data-pk="1" ${P.length ? '' : 'disabled'} title="Throw two small hulls out ahead, sensors wide open: they hear contacts a third further off and see further than the line. They are the first thing the enemy meets.">${B.pickets ? '✓ Pickets out' : 'Throw out pickets'}${P.length ? ' · ' + P.map(s => s.def.name).join(', ') : ' · no small hulls'}</button></div>`; }
  const TI = TRN.info(); h += `<div class="dsec">The battlefield</div><div class="dfield"><b>${TI.name}</b><p>${TI.desc}</p></div>`;
  h += `<div class="dsens">◎ Sensors: a ship with her shields up burns on every scope; you see where the enemy is from the start, as contacts. To shoot, a ship needs a lock (a corvette at 9,000 km, a destroyer at 14,000, a dreadnought at 20,000), and any lock is shared across the fleet. Go cold (U) to drop off their scopes: shields down, drives at a whisper; warming up, the shields take 6 seconds to spin up. Near the Sun, anything sunward of you is half lost in the glare. A nuclear blast washes out the sensors round it. A ship lying quiet that opens fire unseen springs an ambush.</div>`;
  const L = MO.M.lead, D = MO.doc();
  h += `<div class="dsec">The enemy</div><div class="denemy"><b>${L ? L.name : 'No commander of note'}</b><span class="ddoc">${D.name}</span><p>${D.desc}</p></div>`;
  const rf = B.res.filter(r => r.kind === 'reinf' && !r.done);
  if (rf.length) h += `<div class="dsec">Reinforcements</div>` + rf.map(r => `<div class="drf ${r.team === 0 ? 'ok' : 'bad'}">${r.team === 0 ? '▲' : '▼'} ${r.name} · ${r.ships.length} ships · arrives about ${Math.max(0, Math.round((r.eta - S.time) / 60 * 10) / 10)} min in</div>`).join('');
  return h;
}
function deployClick(e) {
  const b = e.target.closest('[data-ap],[data-dform],[data-dstance],[data-dres],[data-pk]'); if (!b || !B || !B.deploy || b.disabled) return false;
  const d = b.dataset;
  if (d.pk) { B.pickets = !B.pickets; applyApproach(0, B.approach || approaches()[0][0]); }
  else if (d.ap) applyApproach(0, d.ap);
  else if (d.dform) { const g = S.bgroups[d.dform]; if (g) { const i = FORMATIONS.findIndex(f => f[0] === g.formation); g.formation = FORMATIONS[(i + 1) % FORMATIONS.length][0]; } }
  else if (d.dstance) { const g = S.bgroups[d.dstance]; if (g) { const i = STANCES.findIndex(f => f[0] === g.stance); g.stance = STANCES[(i + 1) % STANCES.length][0]; } }
  else if (d.dres) toggleReserve(d.dres);
  B.deployShown = null; buildBar(); return true;
}
if (typeof window !== 'undefined') window.__BAT = () => B;

// ---------------------------------------------------------------- the Iron Rain, mid-battle
// ---------------------------------------------------------------- the Iron Rain, in two waves
// The first wave falls from the spitTubes and the hangars of ships within 6,000 km of the surface: starShells and
// leechCraft (and any troop craft already over the world). If it takes a beachhead, the Storks follow it down through
// the drop corridor, a legion to each; anything that gets into the corridor can shoot them down. On the ground the
// legions and the garrison grind each other down: the world falls when the garrison is gone, the Rain fails when the
// legions are.
const W1 = ['starshell', 'boarder'];
const trOf = (t, k) => ((S.fdefs && S.fdefs[t] && S.fdefs[t][k]) || DEFS[k] || {}).troops || 0;
function rainPods(team) {
  const b = bodyOf(B.cf.world), near = s => Math.hypot(s.x - b.x, s.y - b.y) < b.r + 6000;
  const fly = S.ships.filter(s => s.team === team && !s.dead && !s.offField && s.def.troops && !s.def.fighter && !s.def.dropship && near(s));
  const tubes = S.ships.filter(s => s.team === team && !s.dead && !s.offField && s.h && W1.some(k => s.h[k] > 0) && near(s));
  const n = fly.length + tubes.reduce((a, s) => a + W1.reduce((q, k) => q + (s.h[k] || 0), 0), 0);
  const troops = fly.reduce((a, s) => a + (s.troops || 0), 0) + tubes.reduce((a, s) => a + W1.reduce((q, k) => q + (s.h[k] || 0) * trOf(team, k), 0), 0);
  return { fly, tubes, n, troops };
}
function spendPods(R) { for (const s of R.fly) { s.dead = true; s.rained = true; } for (const s of R.tubes) for (const k of W1) s.h[k] = 0; }
const streaks = R => R.fly.concat(R.tubes.flatMap(s => Array.from({ length: Math.min(14, Math.ceil(W1.reduce((q, k) => q + (s.h[k] || 0), 0) / 3)) }, () => ({ x: s.x + (Math.random() - .5) * 600, y: s.y + (Math.random() - .5) * 600 }))));
export const podsAboard = t => S.ships.some(s => s.team === t && !s.dead && !s.offField && ((s.h && (W1.some(k => s.h[k] > 0) || s.h.stork > 0)) || (s.def.troops && !s.def.fighter)));
const storkCarriers = t => S.ships.filter(s => s.team === t && !s.dead && !s.offField && s.h && s.h.stork > 0);
const garrisonPow = (w, bombed) => w.garrison * (bombed ? .6 : 1) * (1.25 + .2 * w.lv.fort) * (((w.cl ? w.cl.war : w.loyalty) + 8) / 70);
// the first wave: who drops it, and with what multiplier on the ground
function dropRain(team, mul) {
  const R = rainPods(team); if (!R.n) return false; const b = bodyOf(B.cf.world), w = C.worlds[B.cf.world], O = OPS.OP.orb;
  const shot = Math.min(.6, S.ships.filter(s => s.team !== team && s.team < 2 && !s.dead && s.type === 'shieldplat').length * .05);
  const carrier = R.tubes[0] || R.fly[0]; TC.rainFx(streaks(R), B.cf.world); if (team === 0) TC.voice('rain', carrier); spendPods(R);
  const D = team === B.attTeam ? garrisonPow(w, O && O.bombed) : 0;
  B.rain = { team, stage: 1, t: S.time + 15, mul, A: R.troops * 5 * mul * (1 - shot) * (.85 + Math.random() * .3), D, D0: D, landed: 0, lost: 0, storks: [], pts: { x: 0, y: 0 } };
  const st = storkCarriers(team).reduce((a, s) => a + s.h.stork, 0);
  toast(team === 0 ? `IRON RAIN! ${R.n} starShells and leechCraft fall on ${b.name}: the first wave lands in 15 seconds${st ? `, then ${st} Stork${st > 1 ? 's' : ''} follow it down` : ''}` : `THE ENEMY'S RAIN: ${R.n} starShells and leechCraft fall on ${b.name}${st ? `, and ${st} Stork${st > 1 ? 's' : ''} behind them` : ''}. The garrison must hold`, 'nuke', null, true);
  return true;
}
function setupRain() {
  S.rainCtx = null; if (B.attTeam !== 0 || !B.cf.withWorld || !B.out.gov || B.cf.assault || B.cf.quest) return;
  B.senate = B.me === 'rep' && !!C.senateHold && C.senateHold.world === B.cf.world;
  const pods = () => rainPods(0).n;
  const guns = () => S.ships.filter(s => s.team === B.defTeam && !s.dead && s.type === 'gunplat').length;
  S.rainCtx = {
    why: () => B.rain ? 'The Rain is falling' : !B.out.gov || B.out.gov.dead || B.out.gov.team !== B.defTeam ? 'The orbital authority is already ours' : guns() ? `Silence the world's guns first: ${guns()} gun platform${guns() > 1 ? 's' : ''} still firing` : OPS.OP.orb && !OPS.OP.orb.open ? `Hold the drop corridor first: ${Math.floor(OPS.OP.orb.prog)} of ${OPS.CORR_T} seconds` : !pods() ? (podsAboard(0) ? 'Bring the ships carrying starShells and leechCraft within 6,000 km of the surface: the first wave takes the beachhead' : 'No starShells or leechCraft in this fleet') : null,
    run: G => { const mul = TE.mod(B.me, 'rain') * (G.camp && CM.hasT(G.camp, 'rain') ? 1.3 : 1); if (dropRain(0, mul) && B.senate) B.defied = true; } };
}
// the enemy's Rain: with the corridor theirs and its first wave over the world, it drops
function aiRain() {
  const O = OPS.OP.orb; if (!O || !O.open || B.attTeam !== 1 || B.rain || !B.cf.withWorld || B.endT != null) return;
  dropRain(1, TE.mod(B.foe, 'rain'));
}
// once a second while the Rain is down: the landing, the Storks, and the fight on the ground
function rainTick() {
  aiRain();
  const G = B.rain; if (!G || G.done || S.time < G.t) return;
  const w = C.worlds[B.cf.world], b = bodyOf(B.cf.world), nm = b.name, ours = G.team === 0, O = OPS.OP.orb;
  if (G.stage === 2 && S.time < (G.nt || 0)) return; G.nt = S.time + 1; /* the ground is fought a second at a time */
  if (G.stage === 1) { // the first wave is down
    G.stage = 2; G.t2 = S.time;
    if (G.A >= G.D * 2.5) return rainEnd(G, true, `The first wave alone overwhelms ${nm}`); /* a beachhead, not a conquest, unless the garrison is a shell */
    if (G.A < G.D * .12) return rainEnd(G, false, `The first wave is thrown back: no beachhead on ${nm}`);
    const a = O ? Math.atan2(O.y - b.y, O.x - b.x) : Math.atan2(storkCarriers(G.team)[0] ? storkCarriers(G.team)[0].y - b.y : 0, storkCarriers(G.team)[0] ? storkCarriers(G.team)[0].x - b.x : 1);
    G.pts = { x: b.x + Math.cos(a) * b.r * .97, y: b.y + Math.sin(a) * b.r * .97, a };
    for (const c of storkCarriers(G.team)) { if (Math.hypot(c.x - b.x, c.y - b.y) > b.r + 20000) continue; while (c.h.stork > 0) { const st = spitStork(c); if (!st) break; st.order = { type: 'move', x: G.pts.x, y: G.pts.y }; st.noTransit = true; st.dropFor = G; G.storks.push(st); } }
    TC.note(G.storks.length ? `${ours ? 'Beachhead' : 'The enemy holds a beachhead'} on ${nm}: ${G.storks.length} Stork${G.storks.length > 1 ? 's' : ''} ${ours ? 'go' : 'come'} down through the corridor` : `${ours ? 'Beachhead' : 'The enemy holds a beachhead'} on ${nm}, but no Storks to bring the legions down`, ours ? 0x9be8a8 : 0xff8a7a);
    if (ours && G.storks.length) TC.voice('corridor', G.storks[0]);
    return;
  }
  // Storks land, or are lost on the way
  for (const st of G.storks) { if (st.landedT || st.lostT) continue;
    if (st.dead || st.team !== G.team) { st.lostT = S.time; G.lost++; continue; }
    if (!st.descT && Math.hypot(st.x - b.x, st.y - b.y) < b.r + 400) { st.descT = S.time + 12; st.order = { type: 'idle', x: st.x, y: st.y }; st.vx *= .2; st.vy *= .2; TC.note(`${st.title || 'A Stork'} is in the atmosphere: 12 seconds to the ground${ours ? '. Keep the corridor clear' : '. Shoot it down'}`, ours ? 0x9be8a8 : 0xffc070); continue; } /* entry: slow, low, and still in the guns */
    if (st.descT && S.time >= st.descT) { st.landedT = S.time; st.dead = true; st.rained = true; st.offField = true; G.A += (st.troops || st.def.troops || 0) * 5 * G.mul; G.landed++; TC.note(`${st.title || 'A Stork'} lands ${Math.round(st.def.troops || 0)} legionnaires on ${nm}${G.team === 0 ? '' : ' for the enemy'}`, ours ? 0x9be8a8 : 0xff8a7a); }
  }
  // the ground: a few minutes either way
  const A0 = G.A, D0 = G.D; G.D = Math.max(0, D0 - A0 * .006); G.A = Math.max(0, A0 - D0 * .005);
  const flying = G.storks.some(st => !st.landedT && !st.lostT);
  if (G.D <= 0) return rainEnd(G, true, `The legions hold ${nm}`);
  if (G.A <= 0 && !flying) return rainEnd(G, false, `The beachhead on ${nm} is overrun`);
}
function rainEnd(G, ok, why) {
  G.done = true; const w = C.worlds[B.cf.world], nm = bodyOf(B.cf.world).name, ours = G.team === 0;
  if (ok && B.endT == null) { TC.note(`${why}: ${ours ? 'the Iron Rain has taken the world' : 'the world is lost'}`, ours ? 0x9be8a8 : 0xff8a7a); toast(ours ? `The Iron Rain takes ${nm}` : `${nm} falls to the enemy's Rain`, ours ? 'good' : 'bad', null, true); B.result = { attWin: true, taken: true, rain: true }; B.endT = 2.5; return; }
  // a failed Rain: the garrison is worn down by what it cost to hold
  w.garrison = Math.round(Math.max(200, w.garrison * Math.max(.3, G.D0 ? G.D / G.D0 : 1)));
  TC.note(`${why}: the garrison holds`, ours ? 0xff8a7a : 0x9be8a8); toast(ours ? `The Iron Rain on ${nm} failed` : `The enemy's Rain on ${nm} fails`, ours ? 'bad' : 'good', null, true);
  MO.shock(G.team, 12, 'The Rain failed');
}
// a Stork out of the hangar bays
const spitStork = c => launchCraft(c, 'stork');
// ---------------------------------------------------------------- champions on the decks
function setupChamps() {
  const champs = new Map(); // campaign fleet -> champion agent
  for (const fl of new Set(B.fleetOf.values())) { const a = AG.championOf(fl); if (a) champs.set(fl, a); }
  B.champDead = new Set();
  S.champFor = (team, t, boarder) => {
    // a Peerless commander within reach crosses over; else the fleet's own champion; the defender's own commander, if Peerless
    const pick = [];
    if (boarder) { const fl = B.fleetOf.get(boarder.campRef), a = fl && champs.get(fl); if (a && !B.champDead.has(a)) pick.push({ name: a.name, skill: 1.2 + .1 * a.skill, die: () => { B.champDead.add(a); } }); }
    else { const fl = B.fleetOf.get(t.campRef), a = fl && champs.get(fl); if (a && !B.champDead.has(a)) pick.push({ name: a.name, skill: 1.2 + .1 * a.skill, die: () => { B.champDead.add(a); } }); }
    for (const c of S.cmdrs || []) { if (c.team !== team || c.state !== 'aboard' || !c.ship || c.ship.dead) continue; const pe = c.camp && CM.hasT(c.camp, 'peerless'); if (!pe) continue;
      if (boarder ? Math.hypot(c.ship.x - t.x, c.ship.y - t.y) < 2500 && c.ship !== t : c.ship === t) pick.push({ name: c.name, skill: 1.4 + .1 * c.rank, die: () => { c.state = 'dead'; if (c.ship) c.ship.cmdr = null; } }); }
    return pick.sort((a, b) => b.skill - a.skill)[0] || null;
  };
}

// ---------------------------------------------------------------- the ability buttons and the deck fights
// the order card: what the selected ships can do, each with its key. With nothing selected it speaks for the whole fleet
export const AB_KEYS = { sig: 'C', brace: 'B', lock: 'N', burn: 'J', dark: 'U', bridge: 'M', rain: 'I' };
const AB_SHORT = { brace: 'Brace', lock: 'Lock on', burn: 'Burn', dark: 'Dark', decoy: 'Decoys', bridge: 'Bridge', shells: 'Shells', rain: 'Rain', sig: null };
const abShort = (k, G) => k === 'dark' && G && G.ships.length && G.ships.every(s => s.cold) ? 'Warm up' : k === 'dark' ? 'Go cold' : k === 'rain' && B && B.senate && !B.defied ? (B.senateArm && S.time - B.senateArm < 8 ? 'Defy the Senate' : 'Rain · against the Senate') : AB_SHORT[k];
// an icon for each order, drawn on a 16-unit grid
const AB_ICON = { shells: 'M8 2l2 3h3l-2 3 1 4-4-2-4 2 1-4-2-3h3z', nuke: 'M8 6.6a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8zM8 1.5a6.5 6.5 0 0 1 5.6 3.2L9.3 7.2M8 1.5a6.5 6.5 0 0 0-5.6 3.2l4.3 2.5M2.4 11.3A6.5 6.5 0 0 0 13.6 11.3L9.3 8.8 6.7 8.8z', decoy: 'M3 8l2.5-2.5L8 8l-2.5 2.5zM8 4l2-2 2 2-2 2zM8 12l2-2 2 2-2 2z', sig: 'M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.2l-4 2.3 1-4.4-3.4-3 4.5-.5z', brace: 'M8 1.5l5.5 2v4.2c0 3.2-2.4 5.6-5.5 6.8-3.1-1.2-5.5-3.6-5.5-6.8V3.5z',
  lock: 'M8 2v3M8 11v3M2 8h3M11 8h3M8 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z', burn: 'M2 4l4 4-4 4M7 4l4 4-4 4M12 4l2 4-2 4', dark: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM2 14L14 2',
  bridge: 'M2 10l6-6 6 6-2 2H4zM8 7.2a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8z', shells: 'M3 3l4 2-1 1zM9 3l4 2-1 1zM6 9l4 2-1 1zM2 13l3-1M8 14l3-1', rain: 'M4 2v7M2 7l2 3 2-3M8 4v7M6 9l2 3 2-3M12 2v7M10 7l2 3 2-3M2 14.5h12' };
const abIcon = (k, st) => `<span class="aic" style="--cd:${st.cd && st.tot ? Math.min(1, st.cd / st.tot) : 0}"><svg viewBox="0 0 16 16"><path d="${AB_ICON[k] || AB_ICON.sig}"/></svg>${st.cd ? `<b>${st.cd}</b>` : ''}</span>`;
function useAb(k) {
  const G = AB.forSel(); if (!G) return;
  if (k === 'rain' && B.senate && !B.defied && S.rainCtx && !S.rainCtx.why() && !(B.senateArm && S.time - B.senateArm < 8)) { B.senateArm = S.time; toast('The Senate voted to hold the siege. Order the Rain again (I) to defy it and let the legions fall', 'prompt', null, true); B.abSig = null; return; }
  const A = k === 'sig' ? AB.sigOf(G) : AB.ABIL[k]; if (!A) { toast(k === 'sig' ? 'No commander among the ships selected' : 'Not possible here', 'bad', null, true); return; }
  const st = AB.state(G, k, A); if (!st.ok) { toast(`${A.name}: ${st.why}`, 'bad', null, true); return; }
  AB.use(G, k); B.abSig = null; updBar();
}
// the helm, for the ships selected (or the whole fleet): which side to show the enemy, or to keep at range
function helmSel(k) {
  const was = S.selection; if (!S.selection.some(s => s.team === 0 && !s.def.static)) S.selection = S.ships.filter(s => s.team === 0 && !s.dead && !s.def.static && !s.def.fighter && !s.ally);
  const gs = new Set(S.selection.map(s => s.group).filter(Boolean)); if (gs.size) for (const g of gs) setHelm(k, g); else setHelm(k);
  S.selection = was; B.abSig = null; updBar();
}
function abilUI() {
  const el = $('babil'); if (!el) return; const G = B.deploy ? null : AB.forSel();
  const L = G ? AB.list(G).map(([k, A]) => [k, A, AB.state(G, k, A)]) : [];
  const helmNow = G ? (() => { const hs = new Set(G.ships.map(s => (s.group && !s.detached ? s.group.helm : s.helm) || 'auto')); return hs.size === 1 ? [...hs][0] : null; })() : null;
  const sig = (G ? JSON.stringify(hangInfo(G)) : '') + (S.tmode ? S.tmode.kind : '') + (S.nmode ? 'n' : '') + (B.senateArm && S.time - B.senateArm < 8 ? 'arm' : '') + (G && G.ships.every(s => s.cold) ? 'cold' : '') + (G ? G.key + G.ships.length + G.ships[0].id + (G.cmdr ? G.cmdr.id : '') + helmNow : '') + L.map(([k, , st]) => k + (st.ok ? 1 : 0) + (st.cd || '') + (st.n || '')).join('|');
  if (sig === B.abSig) return; B.abSig = sig;
  const who = G ? `<span class="abh" title="Orders go to the ships selected; with nothing selected, to the whole fleet">${G.cmdr ? `<b>${G.cmdr.name.split(' ')[0]}</b> · ` : ''}${G.name}</span>` : '';
  const btn = ([k, A, st]) => { const key = AB_KEYS[k], part = st.ok && st.n && st.n < st.of ? ` <em>${st.n}/${st.of}</em>` : '';
    return `<button class="btn ab ${k === 'sig' ? 'sig' : ''} ${k === 'rain' ? 'rain' : ''}" data-ba="ab" data-ab="${k}" ${st.ok ? '' : 'disabled'} title="${A.name} (${key}): ${A.desc}${st.ok ? '' : ' · ' + st.why}">${abIcon(k, st)}<span class="abn">${abShort(k, G) || A.name}${part}</span><kbd>${key}</kbd></button>`; };
  el.innerHTML = G ? who + L.map(btn).join('') : '';
  { const hg = $('bhang'); if (hg) { const I = G ? hangInfo(G) : null, row = [];
    const hb = (k, ic, name, n, key, tip, on, dis) => `<button class="btn ab hg ${on ? 'on' : ''}" data-ba="hang" data-hg="${k}" ${dis ? 'disabled' : ''} title="${tip}"><span class="aic"><svg viewBox="0 0 16 16"><path d="${ic}"/></svg>${n != null ? `<b class="cnt">${n}</b>` : ''}</span><span class="abn">${name}</span><kbd>${key}</kbd></button>`;
    if (I && I.any.shells) row.push(hb('shells', AB_ICON.shells, 'starShells', I.shells, 'Y', `Launch starShells (Y): click an enemy capital ship within ${LAUNCH_R.toLocaleString()} km. They hold station off her hull until her shields fall below 25%, then board. ${I.shells} aboard`, S.tmode && S.tmode.kind === 'shells', !I.shells));
    if (I && I.any.pods) row.push(hb('pods', AB_ICON.rain, 'leechCraft', I.pods, '⇧Y', `Fire leechCraft (Shift+Y) at an enemy capital ship within ${LAUNCH_R.toLocaleString()} km: they drill in once her shields are below 25%. Over a world with its guns silent, the same pods are the Iron Rain (I). ${I.pods} aboard`, S.tmode && S.tmode.kind === 'pods', !I.pods));
    if (I && I.any.storks) row.push(hb('storks', AB_ICON.rain, 'Storks', I.storks, 'I', `Storks: dropships, a legion of ${trOf(0, 'stork')} to each. They go down with the Iron Rain (I), once the first wave holds a beachhead, through the drop corridor. They never board ships. ${I.storks} aboard`, false, true));
    if (I && I.any.wings) row.push(hb('wings', AB_ICON.burn, I.held ? 'ripWings · held' : 'ripWings · auto', I.wings + I.out, 'L', `ripWings (L): on auto they launch when an enemy comes within 2,700 km of the carrier and come home when it is clear; held, they stay aboard. ${I.wings} aboard, ${I.out} out`, !I.held, false));
    if (I && I.any.nk) row.push(hb('nuke', AB_ICON.nuke, 'Nuke', I.nk, 'G', `Nuclear missile (G): click a point within 15,000 km. 650 km blast; it washes out sensors for 8,000 km. Every warhead fired costs you at home. ${I.nk} ready`, S.nmode, !I.nk));
    hg.innerHTML = row.length ? `<span class="abh">Hangars</span>` + row.join('') : ''; hg.classList.toggle('hide', !row.length); } }
  const hl = $('bhelm'); if (hl) hl.innerHTML = G ? `<span class="abh">Helm</span>` + HELMS.map(([k, n, d]) => `<button class="btn hm ${helmNow === k ? 'on' : ''}" data-ba="helm" data-helm="${k}" title="${n}: ${d}">${n}</button>`).join('') : '';
}
// what the boarders go for on a capital ship
const BAIM = { bridge: ['Take the bridge', 'Boarders: cut through to the bridge and take her. The quickest capture; the bridge is wrecked in the fighting'], engines: ['Wreck the engines', 'Boarders: blow her engines. Quick, and she is dead in space whatever happens after; then they push on for the bridge'], whole: ['Capture her whole', 'Boarders: take her deck by deck. Slow and costly, but she comes over intact, crew and all, and it shakes her fleet more'] };
function deckUI() {
  let el = $('bdeck'); if (!el) { el = document.createElement('div'); el.id = 'bdeck'; el.className = 'panel'; document.body.appendChild(el); el.addEventListener('click', e => { const b = e.target.closest('[data-baim]'); if (!b) return; const t = S.ships.find(s => s.id === +b.dataset.sid); if (t) { t.boardAim = b.dataset.baim; toast(BAIM[b.dataset.baim][1], 'good'); deckUI(); } }); }
  const L = TC.decks().slice(0, 3); el.classList.toggle('hide', !L.length);
  const h = L.length ? `<div class="oh">On the decks</div>` + L.map(D => { const t = D.t, ours = D.team === 0, atk = S.ships.filter(o => o.docked && o.docked.t === t && !o.dead).reduce((a, o) => a + o.troops, 0), U = D.duel;
    return `<div class="deck ${ours ? 'ok' : 'bad'}"><b>${ours ? 'Boarding' : 'Repelling boarders on'} ${t.title || 'the ' + t.def.name}</b><div class="dbar"><i style="width:${Math.round((t.boardProg || 0) * 100)}%"></i></div><span>${Math.round(atk)} boarders · ${Math.round(t.marines)} marines${t.engWreck ? ' · engines wrecked' : ''}</span>${ours && t.def.cmd ? `<div class="baim">${Object.entries(BAIM).filter(([k]) => k !== 'engines' || !t.engWreck).map(([k, [n, d]]) => `<button class="btn sm ${t.boardAim === k ? 'on' : ''}" data-baim="${k}" data-sid="${t.id}" title="${d}">${n}</button>`).join('')}</div>` : ''}${U ? `<em>${U.res ? (U.res === 'att' ? (U.A ? U.A.name : 'The boarders') + ' won the duel' : (U.D ? U.D.name : 'The defenders') + ' won the duel') : (U.A && U.D ? `${U.A.name} duels ${U.D.name}…` : `${(U.A || U.D).name} leads the fight…`)}</em>` : ''}</div>`; }).join('') : '';
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
