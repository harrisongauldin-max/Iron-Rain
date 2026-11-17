// Iron Rain: the planet map on screen (ground battles chat; claude/planet-maps.md, M2).
// A world under invasion as a small Total War campaign map on its own globe: the planet's painted surface with the
// province overlay (render.js planetMapMaterial, P2), the settlements and armies as pieces (groundmodels.js, P1),
// a landing plan for the Rain, move orders, and one planet turn a week (planetwar.js). Its own renderer and scene over
// the whole window, like groundview.js. The rules live in planetwar.js; this module shows them and gives orders.
//   open(spec, opts) → Promise<{ won, over, war }>
//   spec: planetwar.js newWar's spec ({ world, by, def, troops, garrison, fort, gun, shield, barracks, loyalty })
//   opts: { human: 'att' | 'def', preview: true (a sandbox: nothing goes back to the campaign), title }
import * as THREE from 'three/webgpu';
import * as PW from './planetwar.js';
import { planetMapMaterial, surfaceOf, seatDir } from './render.js';
import { generate } from './planetgen.js';
import { mapPieceGeo, mapPieceMaterial } from './groundmodels.js';
import { FACTIONS } from './data.js';

const PI = Math.PI, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const FK = { rep: 'rising', soc: 'core', rim: 'rim' }; // the campaign's blocs to the factions' colours
const fac = f => FK[f] || (FACTIONS[f] ? f : null);
const colOf = f => { const k = fac(f); return k ? FACTIONS[k].col.main : '#9aa0a6'; };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => Math.round(v).toLocaleString();
const pct = v => Math.round(v * 100) + '%';
const KIND = { capital: 'Capital', city: 'Great city', port: 'Port', towns: 'Towns', forts: 'Hill forts' };
const TER = { alpine: 'alpine', temperate: 'temperate', desert: 'desert', highland: 'highland', jungle: 'jungle' };
// piece sizes on a globe of radius 1
const SZ = { capital: .062, city: .056, port: .048, towns: .042, forts: .046, army: .07, landing: .045, siege: .04, battle: .05 };

let V = null;
export const _view = () => V; // for the test harness
export const active = () => !!(V && V.on); // false while one of its battles is being fought in the ground view

// ---------------------------------------------------------------- setup
const CSS = `
#pw{position:fixed;inset:0;z-index:70;background:#020308;color:var(--txt,#ddd);font:13px/1.45 system-ui,sans-serif;user-select:none}
#pw.hide{display:none}#pw canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#pw .pw-top{z-index:2;position:absolute;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:18px;padding:0 14px;background:linear-gradient(180deg,rgba(10,10,16,.94),rgba(10,10,16,.75));border-bottom:1px solid var(--line,#333)}
#pw .pw-title{display:flex;flex-direction:column;min-width:220px}
#pw .pw-title .k{font-family:Cinzel,Georgia,serif;font-weight:700;letter-spacing:.3em;color:var(--red,#d33);font-size:11px;text-transform:uppercase}
#pw .pw-title b{font-family:Cinzel,Georgia,serif;font-weight:600;color:var(--gold,#f2c14e);font-size:15px;letter-spacing:.06em}
#pw .pw-stats{flex:1;display:flex;gap:22px;justify-content:center;font-size:12px}
#pw .pw-stats i{display:block;font-style:normal;font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.6}
#pw .pw-stats b{font-family:ui-monospace,Consolas,monospace;font-size:14px}
#pw .pw-btns{display:flex;gap:8px}
#pw .pw-side{z-index:2;position:absolute;top:64px;right:12px;width:360px;max-height:calc(100% - 140px);overflow:auto;background:rgba(10,11,17,.9);border:1px solid var(--line,#333);padding:12px 14px}
#pw .pw-side h3,#pw .pw-end h2{margin:0 0 6px;font-family:Cinzel,Georgia,serif;font-weight:600;color:var(--gold,#f2c14e);letter-spacing:.05em}
#pw .pw-side h3{font-size:15px}#pw .pw-side p{margin:6px 0}
#pw .pw-info{z-index:2;position:absolute;top:64px;left:12px;width:260px;background:rgba(10,11,17,.86);border:1px solid var(--line,#333);padding:10px 12px;font-size:12px}
#pw .pw-info.hide{display:none}#pw .pw-info h4{margin:0 0 4px;font-family:Cinzel,Georgia,serif;font-size:14px;color:#fff}
#pw .pw-log{z-index:2;position:absolute;left:12px;bottom:36px;width:420px;max-height:30%;overflow:auto;background:rgba(10,11,17,.8);border:1px solid var(--line,#333);padding:8px 10px;font-size:12px}
#pw .pw-log h5{margin:6px 0 2px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.6}
#pw .pw-log div{margin:1px 0}
#pw .pw-help{z-index:2;position:absolute;left:0;right:0;bottom:0;padding:6px 14px;font-size:11px;opacity:.7;background:rgba(5,6,10,.7)}
#pw .pw-end{z-index:3;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:440px;background:rgba(12,12,18,.97);border:1px solid var(--gold,#f2c14e);padding:18px 20px;text-align:center}
#pw .pw-end.hide{display:none}
#pw .pw-rows{display:flex;flex-direction:column;gap:3px;margin:8px 0}
#pw .pw-row{display:grid;grid-template-columns:1fr 34px 50px 46px auto;gap:5px;align-items:center;padding:3px 5px;border:1px solid transparent;cursor:pointer}
#pw .pw-row:hover{border-color:var(--line,#444)}#pw .pw-row.on{border-color:var(--gold,#f2c14e);background:rgba(242,193,78,.08)}
#pw .pw-row .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#pw .pw-row .d{opacity:.65;font-size:11px;text-align:right}
#pw .pw-row .a{font-family:ui-monospace,Consolas,monospace;text-align:right}
#pw .pw-mini{display:flex;gap:3px}#pw .pw-mini .btn{padding:1px 6px;font-size:10px;letter-spacing:0}
#pw .pw-bb{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#pw .pw-dest{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;margin:3px 0}
#pw .pw-dest .btn{padding:2px 7px;font-size:10px}
#pw .good{color:#7fd88a}#pw .bad{color:#ff7a6a}#pw .dim{opacity:.65}#pw .gold{color:var(--gold,#f2c14e)}
#pw .pw-fc{margin-top:8px;padding:8px;border:1px solid var(--line,#333);background:rgba(255,255,255,.03)}
#pw .pw-fc b{font-size:18px}
#pw .pw-cm{margin:6px 0;font-size:12px}#pw .pw-cm select{background:#14151c;color:inherit;border:1px solid var(--line,#444);font-size:11px}
#pw .pw-lbls{z-index:1;position:absolute;inset:0;pointer-events:none;overflow:hidden}
#pw .pw-lb{position:absolute;transform:translate(-50%,0);white-space:nowrap;font-size:11px;text-shadow:0 1px 2px #000,0 0 4px #000}
#pw .pw-lb.name{font-family:Cinzel,Georgia,serif;letter-spacing:.06em;color:#f3ead8}
#pw .pw-lb.cap{color:var(--gold,#f2c14e);font-weight:600}
#pw .pw-lb.men{transform:translate(-50%,-100%);padding:0 5px;border-radius:2px;color:#fff;font-family:ui-monospace,Consolas,monospace;font-size:11px;border:1px solid rgba(255,255,255,.35)}
#pw .pw-lb.chip{transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;padding:1px 7px;background:rgba(10,10,16,.88);border:1px solid var(--gold,#f2c14e);color:var(--gold,#f2c14e);border-radius:9px}
#pw .pw-lb.chip:hover{background:rgba(242,193,78,.25)}
#pw .pw-lb.land{transform:translate(-50%,-100%);color:#fff;background:rgba(200,60,40,.85);padding:0 5px;border-radius:2px;font-family:ui-monospace,Consolas,monospace}
`;
function makeDOM() {
  if (!document.getElementById('pwCss')) { const st = document.createElement('style'); st.id = 'pwCss'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.id = 'pw'; root.className = 'hide';
  root.innerHTML = `<canvas id="pwc"></canvas><div class="pw-lbls" id="pwL"></div>
  <div class="pw-top"><div class="pw-title"><span class="k" id="pwK">The war for</span><b id="pwName"></b></div>
    <div class="pw-stats" id="pwStats"></div>
    <div class="pw-btns"><button class="btn go" data-p="week" id="pwWeek">End week ▸</button><button class="btn" data-p="close" id="pwClose">Close</button></div></div>
  <div class="pw-info hide" id="pwInfo"></div>
  <div class="pw-side" id="pwSide"></div>
  <div class="pw-log" id="pwLog"></div>
  <div class="pw-end hide" id="pwEnd"></div>
  <div class="pw-help">Left-drag turn the globe · wheel zoom · click a province or an army to select it · right-click a province (or click its chip) to march there · double-click to centre · Esc clear</div>`;
  document.body.appendChild(root);
  return root;
}
function init() {
  if (V) return V;
  const root = makeDOM(), cv = root.querySelector('#pwc');
  const R = new THREE.WebGPURenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  R.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1;
  V = { root, cv, R, on: false, ready: false, lbl: new Map(), cam: { lat: 10, lon: 0, dist: 2.7, tlat: 10, tlon: 0, tdist: 2.7 }, ray: new THREE.Raycaster(), ndc: new THREE.Vector2() };
  V.camera = new THREE.PerspectiveCamera(32, 1, .01, 200);
  R.init().then(() => { V.ready = true; }).catch(e => console.error('planet map renderer failed to start', e));
  bindInput(); addEventListener('resize', resize);
  return V;
}
function resize() { if (!V) return; V.R.setSize(innerWidth, innerHeight, false); V.camera.aspect = innerWidth / innerHeight; V.camera.updateProjectionMatrix(); }

// the planet's painted maps: the campaign's own when it has painted them, else painted here
function surface(world) {
  const s = surfaceOf(world);
  if (s && s.day && s.day.image && s.day.image.data) return { ...s, data: s.day.image.data };
  const g = generate(world, 1024), mk = (data, w, h, srgb, fmt = THREE.RGBAFormat) => { const t = new THREE.DataTexture(data, w, h, fmt, THREE.UnsignedByteType); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; };
  return { W: g.W, H: g.H, data: g.day, day: mk(g.day, g.W, g.H, true), night: g.night ? mk(g.night, g.W, g.H, true) : null, hgt: g.hgt ? mk(g.hgt, g.W, g.H, false, THREE.RedFormat) : null, own: true };
}

// ---------------------------------------------------------------- open and close
export function open(spec, opts = {}) {
  if (!PW.hasMap(spec.world)) return Promise.resolve(null);
  init();
  return new Promise(resolve => {
    const war = opts.war || PW.newWar(spec), M = PW.MAPS[spec.world]; // opts.war: the campaign's own war (M3-UI), shown as it stands; its weeks are the campaign's
    Object.assign(V, { resolve, spec, opts, war, M, human: opts.human || 'att', on: true, phase: opts.war ? 'war' : 'plan', plan: new Map(), reserve: 0, selP: -1, selA: null, hover: -1, logSeen: 0, fc: null, fcT: 0, moves: [], weekLog: [] });
    V.root.classList.remove('hide'); V.root.querySelector('#pwEnd').classList.add('hide');
    V.root.querySelector('#pwName').textContent = opts.title || M.name;
    V.root.querySelector('#pwK').textContent = opts.preview ? 'Planet map · preview' : 'The war for';
    V.root.querySelector('#pwClose').textContent = opts.preview ? 'Close preview' : 'Close';
    resize(); buildScene();
    const cap = M.provs.find(p => p.id === M.capital); look(8, 4, 3.4, true); // Helios, the main continent, in view
    V.planC = new Map(); V.withC = new Set();
    if (opts.war) { flushLog(war.week); battles(null); } // the week's battles still to fight, if any
    else if (V.human === 'def') { // the enemy's Rain comes down at once, where its legate would put it
      PW.land(war, PW.suggestPlan(spec).map(x => ({ ...x, cmdrs: [] })), Math.random, { defer: true }); flushLog(0); battles('landing'); }
    refresh(true);
    V.R.setAnimationLoop(frame);
  });
}
function close(result) {
  V.on = false; V.R.setAnimationLoop(null); V.root.classList.add('hide');
  for (const el of V.lbl.values()) el.remove(); V.lbl.clear();
  if (V.scene) V.scene.traverse(o => { if (o.isLine && o.geometry) o.geometry.dispose(); }); // pieces share cached geometry and materials; the lines are ours
  if (V.pm) V.pm.dispose(); if (V.surf && V.surf.own) for (const k of ['day', 'night', 'hgt']) if (V.surf[k]) V.surf[k].dispose();
  V.scene = null; V.pm = null;
  const r = V.resolve; V.resolve = null; if (r) r(result || { won: null, over: V.war.over, war: V.war });
}

// ---------------------------------------------------------------- the scene
const Y = new THREE.Vector3(0, 1, 0);
const seat = p => seatDir(p.lat, p.lon); // a unit vector
function frameAt(n) { const e = new THREE.Vector3().crossVectors(Y, n); if (e.lengthSq() < 1e-6) e.set(1, 0, 0); e.normalize(); return { n, e, nn: new THREE.Vector3().crossVectors(n, e) }; }
function arc(a, b, lift, segs = 48) { // a great-circle arc from a to b (unit vectors), raised by lift at its middle
  const pts = [], ang = a.angleTo(b), q = new THREE.Quaternion(), ax = new THREE.Vector3().crossVectors(a, b).normalize();
  for (let i = 0; i <= segs; i++) { const t = i / segs; q.setFromAxisAngle(ax, ang * t); pts.push(a.clone().applyQuaternion(q).multiplyScalar(1.004 + lift * Math.sin(PI * t))); }
  return new THREE.BufferGeometry().setFromPoints(pts);
}
function piece(kind, faction, size) {
  let geo = null; try { geo = mapPieceGeo(kind); } catch (e) { geo = null; }
  let mat = null; try { mat = mapPieceMaterial(kind, faction); } catch (e) { mat = null; }
  if (!geo) geo = kind === 'army' ? new THREE.ConeGeometry(.35, 1, 6).translate(0, .5, 0) : new THREE.BoxGeometry(.8, .6, .8).translate(0, .3, 0);
  if (!mat) mat = new THREE.MeshStandardMaterial({ color: faction ? FACTIONS[faction].col.main : '#9aa0a6', roughness: .6 });
  const m = new THREE.Mesh(geo, mat); m.scale.setScalar(size); m.userData = { kind, faction }; return m;
}
function place(m, n, off = null) { const p = n.clone(); if (off) p.add(off); p.normalize().multiplyScalar(1.001); m.position.copy(p); m.quaternion.setFromUnitVectors(Y, p.clone().normalize()); }
function buildScene() {
  const sc = new THREE.Scene(), M = V.M; V.scene = sc;
  // stars
  const sp = []; let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2200; i++) { const z = rnd() * 2 - 1, t = rnd() * PI * 2, r = Math.sqrt(1 - z * z); sp.push(new THREE.Vector3(r * Math.cos(t), z, r * Math.sin(t)).multiplyScalar(80)); }
  sc.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(sp), new THREE.PointsMaterial({ color: 0xaab4cc, size: 1, sizeAttenuation: false, transparent: true, opacity: .7 })));
  // the globe
  V.surf = surface(V.spec.world); const S = V.surf;
  V.pm = planetMapMaterial({ world: V.spec.world, day: S.day, night: S.night, hgt: S.hgt, nProv: M.provs.length, W: S.W, H: S.H });
  V.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), V.pm.material); sc.add(V.globe);
  // the province ids for picking, at up to 1024 wide, on the painted coast (the day map's alpha is the sea; rows bottom-up)
  const PWd = Math.min(S.W, 1024), PHd = PWd / 2, land = (lat, lon, i, j) => { const I = Math.floor(i * S.W / PWd), J = Math.floor(j * S.H / PHd); return S.data[((S.H - 1 - J) * S.W + I) * 4 + 3] < 128; };
  V.ids = PW.provMap(V.spec.world, PWd, PHd, land); V.idW = PWd; V.idH = PHd;
  // light for the pieces, set from the camera each frame (the map is lit from where we look, so no province is in the dark)
  V.sun = new THREE.DirectionalLight(0xfff4e6, 2.4); sc.add(V.sun); sc.add(new THREE.AmbientLight(0x8090a8, .55));
  // roads, the gravLoop and the sea lanes
  const P = id => M.provs.find(p => p.id === id), line = (geo, col, op) => new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false }));
  for (const [a, b] of M.roads) sc.add(line(arc(seat(P(a)), seat(P(b)), .004), 0xe0a850, .6)); // roads in amber, apart from the white borders
  for (const [a, b] of M.loop) sc.add(line(arc(seat(P(a)), seat(P(b)), .02), 0x7fd0ff, .8));
  for (const [a, b] of M.sea) sc.add(line(arc(seat(P(a)), seat(P(b)), .015, 96), 0x6aa8ff, .35));
  // the settlements
  V.towns = M.provs.map(p => { const m = piece(p.kind, null, SZ[p.kind] || .045); place(m, seat(p)); sc.add(m); return m; });
  V.armyM = new Map(); V.markM = new Map(); V.orderL = [];
}
// set owners, armies, markers and order lines from the war's state
function sync() {
  const war = V.war, M = V.M, side = { att: fac(V.spec.by), def: fac(V.spec.def) };
  M.provs.forEach((p, i) => { const own = war.provs[p.id].own, f = side[own];
    V.pm.setOwner(i, f ? FACTIONS[f].col.main : null);
    const t = V.towns[i]; if (t.userData.faction !== f) { const m = piece(p.kind, f, SZ[p.kind] || .045); m.position.copy(t.position); m.quaternion.copy(t.quaternion); V.scene.remove(t); V.scene.add(m); V.towns[i] = m; } });
  // army stacks: one per side per province
  const want = new Map();
  for (const a of war.armies) if (a.men > 0) { const k = a.side + ':' + a.prov; want.set(k, (want.get(k) || 0) + a.men); }
  for (const [k, m] of V.armyM) if (!want.has(k)) { V.scene.remove(m); V.armyM.delete(k); }
  for (const k of want.keys()) { const [sd, prov] = k.split(':'); let m = V.armyM.get(k); if (!m) { m = piece('army', side[sd], SZ.army); V.scene.add(m); V.armyM.set(k, m); const fr = V.moves.find(x => x.key === k); m.userData.from = fr ? fr.from : null; m.userData.t = fr ? 0 : 1; }
    m.userData.home = armyPos(sd, prov); if (m.userData.t >= 1) place(m, m.userData.home); }
  // markers: where the Rain will fall (planning), sieges, this week's battles
  const marks = new Map();
  if (V.phase === 'plan') for (const [id, n] of V.plan) if (n > 0) marks.set('landing:' + id, ['landing', id]);
  for (const p of M.provs) { const pr = war.provs[p.id]; if (pr.siege && pr.own === 'def' && war.armies.some(a => a.side === 'att' && a.prov === p.id)) marks.set('siege:' + p.id, ['siege', p.id]); }
  for (const b of [...(war.battles || []).filter(b => b.week === war.week), ...(war.pending || [])]) marks.set('battle:' + b.prov, ['battle', b.prov]);
  for (const [k, m] of V.markM) if (!marks.has(k)) { V.scene.remove(m); V.markM.delete(k); }
  for (const [k, [kind, id]] of marks) if (!V.markM.has(k)) { const p = M.provs.find(x => x.id === id), f = frameAt(seat(p)), m = piece(kind, kind === 'landing' ? side[V.human === 'att' ? 'att' : 'def'] : null, SZ[kind]);
    place(m, f.n, f.nn.clone().multiplyScalar(kind === 'battle' ? -.07 : .075)); V.scene.add(m); V.markM.set(k, m); }
  // order lines
  for (const l of V.orderL) { V.scene.remove(l); l.geometry.dispose(); } V.orderL = [];
  for (const a of war.armies) if (a.to && a.side === V.human) { const l = new THREE.Line(arc(seat(M.provs.find(p => p.id === a.prov)), seat(M.provs.find(p => p.id === a.to)), .06), new THREE.LineBasicMaterial({ color: colOf(a.side === 'att' ? V.spec.by : V.spec.def), transparent: true, opacity: .95, depthWrite: false }));
    V.scene.add(l); V.orderL.push(l); }
}
function armyPos(sd, prov) { const p = V.M.provs.find(x => x.id === prov), f = frameAt(seat(p)); return f.n.clone().add(f.e.clone().multiplyScalar(sd === 'att' ? .072 : -.072)).normalize(); }

// ---------------------------------------------------------------- the camera
function look(lat, lon, dist, now) { const c = V.cam; c.tlat = clamp(lat, -80, 80); c.tlon = lon; if (dist) c.tdist = dist; if (now) { c.lat = c.tlat; c.lon = c.tlon; c.dist = c.tdist; } }
function camUpdate(dt) {
  const c = V.cam, k = Math.min(1, dt * 7); let dl = c.tlon - c.lon; dl = ((dl + 540) % 360) - 180;
  c.lat += (c.tlat - c.lat) * k; c.lon += dl * k; c.dist += (c.tdist - c.dist) * k;
  V.camera.position.copy(seatDir(c.lat, c.lon)).multiplyScalar(c.dist); V.camera.up.copy(Y); V.camera.lookAt(0, 0, 0);
  // the sun over the viewer's left shoulder
  const fwd = V.camera.position.clone().normalize(), right = new THREE.Vector3().crossVectors(Y, fwd).normalize(), sunP = fwd.clone().multiplyScalar(1).add(right.multiplyScalar(-.55)).add(Y.clone().multiplyScalar(.45)).normalize().multiplyScalar(40);
  V.pm.setSun(sunP); V.sun.position.copy(sunP);
}

// ---------------------------------------------------------------- input
function provAt(x, y) {
  V.ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); V.ray.setFromCamera(V.ndc, V.camera);
  const h = V.ray.intersectObject(V.globe)[0]; if (!h) return -1;
  const i = Math.floor(h.uv.x * V.idW) % V.idW, j = clamp(Math.floor((1 - h.uv.y) * V.idH), 0, V.idH - 1), k = V.ids[j * V.idW + i];
  return k === 255 ? -1 : k;
}
function bindInput() {
  const cv = V.cv; let drag = null;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => { if (!V.on) return; if (e.button === 0) drag = { x: e.clientX, y: e.clientY, lat: V.cam.tlat, lon: V.cam.tlon, moved: false }; });
  addEventListener('pointermove', e => { if (!V || !V.on) return;
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { const k = .22 * (V.cam.dist - .8) / 1.9; look(drag.lat + dy * k, drag.lon - dx * k, null, true); } }
    if (e.target === cv) { const id = provAt(e.clientX, e.clientY); if (id !== V.hover) { V.hover = id; V.pm.setHover(id); info(); } } });
  addEventListener('pointerup', e => { if (!V || !V.on) return; const d = drag; drag = null;
    if (e.target !== cv) return;
    if (e.button === 0 && d && !d.moved) clickProv(provAt(e.clientX, e.clientY), e);
    if (e.button === 2) orderTo(provAt(e.clientX, e.clientY)); });
  cv.addEventListener('dblclick', e => { const id = provAt(e.clientX, e.clientY); if (id >= 0) { const p = V.M.provs[id]; look(p.lat, p.lon); } });
  cv.addEventListener('wheel', e => { if (!V.on) return; V.cam.tdist = clamp(V.cam.tdist * (e.deltaY > 0 ? 1.12 : .89), 1.32, 5.5); e.preventDefault(); }, { passive: false });
  addEventListener('keydown', e => { if (!V || !V.on) return; if (e.key === 'Escape') { V.selA = null; V.selP = -1; V.pm.setSelected(-1); refresh(); } else if (e.key === 'Enter' && V.phase === 'war') endWeek(); });
  V.root.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.p === 'cmdrat') { V.planC.set(t.dataset.a, t.value); forecastSoon(); } });
  V.root.addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b || b.disabled) return; const g = b.dataset.p, arg = b.dataset.a;
    if (g === 'close') close();
    else if (g === 'week') endWeek();
    else if (g === 'sel') clickProv(V.M.provs.findIndex(p => p.id === arg), {});
    else if (g === 'army') { V.selA = V.war.armies.find(a => a.id === +arg) || null; if (V.selA) { V.selP = V.M.provs.findIndex(p => p.id === V.selA.prov); V.pm.setSelected(V.selP); } refresh(); }
    else if (g === 'go') orderTo(V.M.provs.findIndex(p => p.id === arg), +b.dataset.m || 0);
    else if (g === 'stay') { const a = V.war.armies.find(x => x.id === +arg); if (a) { a.to = null; mergeBack(a); } refresh(); }
    else if (g === 'add' || g === 'sub' || g === 'rest' || g === 'zero') planEdit(arg, g);
    else if (g === 'legate') { V.plan = new Map(PW.suggestPlan(V.spec).map(x => [x.prov, x.troops])); refresh(true); }
    else if (g === 'clear') { V.plan.clear(); refresh(true); }
    else if (g === 'drop') drop();
    else if (g === 'fightb') fightBattle(arg);
    else if (g === 'autob') autoBattle(arg);
    else if (g === 'autoall') { for (const x of V.war.pending.slice()) PW.resolve(V.war, x.prov); afterBattle(); }
    else if (g === 'withc') { if (V.withC.has(arg)) V.withC.delete(arg); else V.withC.add(arg); }
    else if (g === 'reland') reland(arg);
    else if (g === 'again') { const s = V.spec, o = V.opts, r = V.resolve; V.resolve = null; close(); V.resolve = null; open(s, o).then(x => r && r(x)); }
  });
}
function clickProv(id, e) {
  if (id < 0) { V.selP = -1; V.selA = null; V.pm.setSelected(-1); refresh(); return; }
  const p = V.M.provs[id]; V.selP = id; V.pm.setSelected(id);
  if (V.phase === 'war') { const mine = V.war.armies.filter(a => a.side === V.human && a.prov === p.id && a.men > 0);
    V.selA = mine.find(a => !a.to) || mine[0] || null; }
  refresh();
}
// a split-off part that stays home rejoins its stack
function mergeBack(a) { const b = V.war.armies.find(x => x !== a && x.side === a.side && x.prov === a.prov && !x.to && x.men > 0); if (b) { b.men += a.men; a.men = 0; V.war.armies = V.war.armies.filter(x => x.men > 0); if (V.selA === a) V.selA = b; } }
function orderTo(id, men = 0) {
  if (V.phase !== 'war' || id < 0 || !V.selA || V.war.over) return;
  const a = V.selA, to = V.M.provs[id].id;
  if (to === a.prov) { a.to = null; mergeBack(a); refresh(); return; }
  if (a.to) { a.to = null; mergeBack(a); }
  const sent = V.selA, half = men && men < sent.men; if (!PW.order(V.war, sent.id, to, half ? men : 0, half ? [...V.withC] : [])) { toast(sent.side === 'def' && V.war.armies.some(x => x.side === 'att' && x.prov === sent.prov) ? 'The enemy is at the walls: this garrison is pinned.' : `${V.M.provs[id].name} is out of reach this week.`); return; }
  refresh();
}

// ---------------------------------------------------------------- the Rain
const step = () => Math.max(100, Math.round(V.spec.troops / 10 / 100) * 100);
const planned = () => [...V.plan.values()].reduce((s, v) => s + v, 0);
function planEdit(id, g) {
  const cur = V.plan.get(id) || 0, free = V.spec.troops - planned();
  const v = g === 'add' ? cur + Math.min(free, step()) : g === 'sub' ? Math.max(0, cur - step()) : g === 'rest' ? cur + free : 0;
  if (v > 0) V.plan.set(id, v); else V.plan.delete(id);
  refresh(true);
}
// the plan as planetwar.js takes it: each commander lands with the landing chosen for them (the biggest, if none)
function planList() {
  const plan = [...V.plan].filter(([, n]) => n > 0).map(([prov, troops]) => ({ prov, troops, cmdrs: [] })); if (!plan.length) return plan;
  const big = plan.reduce((b, x) => x.troops > b.troops ? x : b);
  for (const c of V.spec.cmdrs || []) (plan.find(x => x.prov === V.planC.get(c.id)) || big).cmdrs.push(c);
  return plan;
}
function drop() {
  const plan = planList(); if (!plan.length) return;
  V.reserve = V.spec.troops - planned();
  PW.land(V.war, plan, Math.random, { defer: true }); V.selA = null; V.selP = -1; V.pm.setSelected(-1);
  flushLog(0); battles('landing');
}
function reland(id) { // land the troops kept in orbit on a province (a second wave)
  if (!V.reserve || V.war.over) return; const n = V.reserve; V.reserve = 0;
  V.moves = []; PW.land(V.war, [{ prov: id, troops: n, cmdrs: [] }], Math.random, { defer: true }); flushLog(V.war.week); battles('landing');
}
// ---------------------------------------------------------------- the battles (war.pending): fought, or auto-resolved
// then: 'week' (the week's battles, after the marches; weekEnd follows) or 'landing' (a landing's battles)
function battles(then) { V.after = then; if (!V.war.pending.length) return battlesDone(); V.phase = 'battles'; refresh(true); }
function battlesDone() {
  const t = V.after; V.after = null; if (t === 'week') PW.weekEnd(V.war);
  flushLog(V.war.week); V.phase = V.war.over ? 'over' : 'war'; if (V.war.over) setTimeout(showEnd, 900);
  refresh(true);
}
function afterBattle() { flushLog(V.war.week); if (!V.war.pending.length) battlesDone(); else refresh(true); }
function autoBattle(prov) { PW.resolve(V.war, prov); afterBattle(); }
async function fightBattle(prov) {
  const spec = PW.battleSpec(V.war, prov), M = V.M, holder = spec.planet.holder, nm = side => side === 'att' ? (V.opts.attName || 'The legions') : (V.opts.defName || 'The garrison');
  const meta = { world: M.name, date: V.opts.date || `Week ${V.war.week} of the war`, attName: nm(spec.planet.foe), defName: nm(holder) };
  const go = V.opts.fight || (async (sp, m) => (await import('./groundview.js')).fight(sp, m)); // groundview is loaded only when a battle is fought
  V.on = false; V.R.setAnimationLoop(null); V.root.classList.add('hide');
  let r = null; try { r = await go(spec, meta); } catch (e) { console.error('the province battle failed', e); }
  V.on = true; V.root.classList.remove('hide'); last = 0; V.R.setAnimationLoop(frame);
  if (r && r.att0 != null) PW.settle(V.war, prov, r); else PW.resolve(V.war, prov);
  afterBattle();
}
// ---------------------------------------------------------------- the week
function endWeek() {
  if (V.phase !== 'war' || V.war.over || V.opts.war) return;
  const before = new Map(V.war.armies.map(a => [a.id, a.prov])), ai = {}; ai[V.human === 'att' ? 'def' : 'att'] = PW.standIn;
  PW.weekMoves(V.war, { ai });
  // the pieces glide from where their stacks stood
  V.moves = []; for (const a of V.war.armies) { const p0 = before.get(a.id); if (p0 && p0 !== a.prov) V.moves.push({ key: a.side + ':' + a.prov, from: armyPos(a.side, p0) }); }
  for (const [k, m] of V.armyM) { const mv = V.moves.find(x => x.key === k); if (mv) { m.userData.from = mv.from; m.userData.t = 0; } }
  V.selA = null; V.withC.clear(); flushLog(V.war.week);
  battles('week');
}
function flushLog(week) { const L = V.war.log; if (V.logSeen < L.length) { const g = V.weekLog[V.weekLog.length - 1], add = L.slice(V.logSeen); if (g && g.week === week) g.lines.push(...add); else V.weekLog.push({ week, lines: add }); V.logSeen = L.length; } }

// ---------------------------------------------------------------- panels
function refresh(full) {
  if (!V.scene) return; sync(); side(); info(); stats(); if (full) logPanel();
  V.root.querySelector('#pwWeek').style.display = V.phase === 'war' && !V.opts.war ? '' : 'none'; // in the campaign, End turn ends the week
  if (V.phase === 'plan') forecastSoon();
}
function stats() {
  const w = V.war, att = PW.menOf(w, 'att'), def = PW.menOf(w, 'def'), pop = PW.popOf(w, 'att');
  const A = V.spec.by, D = V.spec.def;
  V.root.querySelector('#pwStats').innerHTML = `<div><i>Week</i><b>${w.week}</b></div>
    <div><i style="color:${colOf(A)}">Legions</i><b>${n0(att)}</b>${V.reserve ? ` <span class="dim">+${n0(V.reserve)} in orbit</span>` : ''}</div>
    <div><i style="color:${colOf(D)}">Garrison</i><b>${n0(def)}</b></div>
    <div><i>People held by the Rain</i><b>${pct(pop)}</b></div>`;
}
function provLine(p) { const pr = V.war.provs[p.id], bits = [KIND[p.kind] || p.kind, TER[p.terrain] || p.terrain];
  if (pr.walls) bits.push(`walls ${pr.walls}${pr.breach ? ` (breached ${pct(pr.breach)})` : ''}`); if (pr.gun) bits.push(`guns ${pr.gun}`); if (pr.shield) bits.push('shield'); return bits.join(' · '); }
function info() {
  const el = V.root.querySelector('#pwInfo'), id = V.hover >= 0 ? V.hover : V.selP; if (id < 0) { el.classList.add('hide'); return; }
  const p = V.M.provs[id], w = V.war, pr = w.provs[p.id], men = sd => w.armies.reduce((s, a) => s + (a.side === sd && a.prov === p.id ? a.men : 0), 0);
  const own = pr.own === 'att' ? 'the Rain' : 'the garrison', toll = PW.skyToll(w, p.id);
  el.classList.remove('hide');
  el.innerHTML = `<h4>${esc(p.name)}</h4><div class="dim">${esc(p.note || '')}</div><div>${esc(provLine(p))}</div>
    <div>Held by <b style="color:${colOf(pr.own === 'att' ? V.spec.by : V.spec.def)}">${own}</b> · ${pct(p.pop)} of the people</div>
    <div>Legions <b>${n0(men('att'))}</b> · garrison <b>${n0(men('def'))}</b></div>
    ${pr.siege && men('att') ? `<div class="gold">Besieged, week ${pr.siege}</div>` : ''}
    ${toll ? `<div class="dim">A landing here loses about ${pct(toll)} in the sky.</div>` : ''}`;
}
function side() {
  const el = V.root.querySelector('#pwSide'), w = V.war;
  if (V.phase === 'plan') {
    const free = V.spec.troops - planned(), rows = V.M.provs.map((p, i) => { const n = V.plan.get(p.id) || 0, g = w.armies.reduce((s, a) => s + (a.side === 'def' && a.prov === p.id ? a.men : 0), 0);
      return `<div class="pw-row${V.selP === i ? ' on' : ''}" data-p="sel" data-a="${p.id}"><span class="n">${esc(p.name)}</span><span class="d" title="lost in the sky">${pct(PW.skyToll(w, p.id))}</span><span class="d" title="garrison">${n0(g)}</span>
        <b class="a">${n ? n0(n) : ''}</b><span class="pw-mini"><button class="btn" data-p="sub" data-a="${p.id}" ${n ? '' : 'disabled'}>−</button><button class="btn" data-p="add" data-a="${p.id}" ${free ? '' : 'disabled'}>+</button><button class="btn" data-p="rest" data-a="${p.id}" ${free ? '' : 'disabled'}>all</button></span></div>`; }).join('');
    const fc = V.fc;
    el.innerHTML = `<h3>The Rain on ${esc(V.M.name)}</h3>
      <p><b>${n0(V.spec.troops)}</b> troops are in the drop. Choose where they fall: <b>+</b> adds ${n0(step())}, <b>all</b> sends the rest. Troops you don't assign stay in orbit, to land later.</p>
      <div class="dim" style="display:grid;grid-template-columns:1fr 34px 50px 46px auto;gap:5px;padding:0 5px;font-size:10px;letter-spacing:.1em;text-transform:uppercase"><span>Province</span><span style="text-align:right">Sky</span><span style="text-align:right">Foes</span><span style="text-align:right">Drop</span><span></span></div>
      <div class="pw-rows">${rows}</div>
      <div>Unassigned: <b>${n0(free)}</b>${free && planned() ? ' <span class="dim">(stays in orbit)</span>' : ''}</div>
      ${cmdrPlan()}
      <div class="pw-fc">${!planned() ? '<span class="dim">Assign troops to see the legate\'s reckoning.</span>' : fc && fc.key === planKey() ? `The legate's reckoning: <b class="${fc.win >= .55 ? 'good' : fc.win < .4 ? 'bad' : 'gold'}">${pct(fc.win)}</b> to take ${esc(V.M.name)}, in about ${fc.weeks.toFixed(1)} weeks, losing about ${n0(fc.lost)} troops.` : '<span class="dim">Reckoning…</span>'}</div>
      <div class="pw-bb"><button class="btn" data-p="legate">Legate's plan</button><button class="btn" data-p="clear" ${planned() ? '' : 'disabled'}>Clear</button><button class="btn go" data-p="drop" ${planned() ? '' : 'disabled'}>Drop the Rain ▸</button></div>`;
    return;
  }
  if (V.phase === 'over') { el.innerHTML = `<h3>${w.over && w.over.won === V.human ? 'Victory' : 'Defeat'}</h3><p>${esc(w.over ? w.over.why : '')}</p>`; return; }
  if (V.phase === 'battles') { el.innerHTML = battlePanel(); return; }
  // the war: the selected army's orders, else the list of armies
  const mine = w.armies.filter(a => a.side === V.human && a.men > 0), M = V.M, nm = id => M.provs.find(p => p.id === id).name;
  let h = '';
  const a = V.selA && V.selA.men > 0 ? V.selA : null;
  if (a) {
    const pinned = a.side === 'def' && w.armies.some(x => x.side === 'att' && x.prov === a.prov);
    h += `<h3>${V.human === 'att' ? 'Legion' : 'Garrison'} in ${esc(nm(a.prov))}</h3><p><b>${n0(a.men)}</b> men${a.hungry ? ` · <span class="bad">out of supply ${a.hungry} week${a.hungry > 1 ? 's' : ''}</span>` : ''}</p>`;
    if (a.cmdrs && a.cmdrs.length) h += `<div class="pw-cm">${a.cmdrs.map(c => `<div><b class="gold">${esc(c.name)}</b>${cmdrNote(c)}${a.to ? '' : ` <label class="dim"><input type="checkbox" data-p="withc" data-a="${esc(c.id)}" ${V.withC.has(c.id) ? 'checked' : ''}> goes with a half</label>`}</div>`).join('')}</div>`;
    if (a.to) h += `<p>Marching on <b>${esc(nm(a.to))}</b>${(a.cmdrs || []).length ? ` with ${a.cmdrs.map(c => esc(c.name)).join(', ')}` : ''}. <button class="btn" data-p="stay" data-a="${a.id}">Stay</button></p>`;
    if (pinned) h += '<p class="bad">The enemy is at the walls: this garrison is pinned.</p>';
    else { h += '<p class="dim">March to (all, or half):</p>';
      for (const to of PW.reach(w, a)) { const pv = PW.preview(w, a, to), half = Math.floor(a.men / 2);
        h += `<div class="pw-dest"><span>${esc(nm(to))} <span class="dim">${previewText(pv)}</span></span><button class="btn" data-p="go" data-a="${to}">All</button><button class="btn" data-p="go" data-a="${to}" data-m="${half}" ${half >= 100 ? '' : 'disabled'}>Half</button></div>`; } }
  } else {
    h += `<h3>Week ${w.week + 1}</h3><p class="dim">Click one of your armies, then right-click where it should march. Battles are fought out at the end of the week.</p>`;
  }
  h += '<p style="margin-top:10px" class="dim">Your armies:</p>';
  for (const x of mine) h += `<div class="pw-dest"><span><b>${n0(x.men)}</b> in ${esc(nm(x.prov))}${x.to ? ` → ${esc(nm(x.to))}` : ''}${x.hungry ? ' <span class="bad">hungry</span>' : ''}</span><span></span><button class="btn" data-p="army" data-a="${x.id}">Select</button></div>`;
  if (V.reserve && V.human === 'att' && V.selP >= 0) { const p = M.provs[V.selP]; h += `<p style="margin-top:10px"><b>${n0(V.reserve)}</b> troops wait in orbit. <button class="btn" data-p="reland" data-a="${p.id}">Land them on ${esc(p.name)}</button> <span class="dim">(${pct(PW.skyToll(w, p.id))} lost in the sky)</span></p>`; }
  else if (V.reserve && V.human === 'att') h += `<p style="margin-top:10px"><b>${n0(V.reserve)}</b> troops wait in orbit: select a province to land them.</p>`;
  el.innerHTML = h;
}
// a commander's line: what their talents do on the planet map
function cmdrNote(c) { const k = PW.cmdrK(c), t = (c.t || []).filter(x => PW.CMDR_T[x]);
  return ` <span class="dim">${k > 1.001 ? `+${Math.round((k - 1) * 100)}% strength` : ''}${t.length ? (k > 1.001 ? '; ' : '') + t.map(x => PW.CMDR_T[x]).join('; ') : ''}</span>`; }
function cmdrPlan() {
  const L = V.spec.cmdrs || []; if (!L.length) return '';
  const landings = [...V.plan].filter(([, n]) => n > 0), big = landings.length ? landings.reduce((b, x) => x[1] > b[1] ? x : b)[0] : null;
  return `<div class="pw-cm"><p class="dim" style="margin:8px 0 2px">Commanders land with:</p>${L.map(c => { const at = landings.some(([id]) => id === V.planC.get(c.id)) ? V.planC.get(c.id) : big;
    return `<div><b class="gold">${esc(c.name)}</b> <select data-p="cmdrat" data-a="${esc(c.id)}" ${landings.length ? '' : 'disabled'}>${landings.length ? landings.map(([id]) => `<option value="${id}" ${id === at ? 'selected' : ''}>${esc(V.M.provs.find(p => p.id === id).name)}</option>`).join('') : '<option>(no landing yet)</option>'}</select>${cmdrNote(c)}</div>`; }).join('')}</div>`;
}
// the battles waiting: fight each on its own field, or let it be auto-resolved
function battlePanel() {
  const w = V.war, M = V.M, men = (side, prov) => w.armies.reduce((s, a) => s + (a.side === side && a.prov === prov ? a.men : 0), 0);
  const cm = (side, prov) => w.armies.filter(a => a.side === side && a.prov === prov).flatMap(a => a.cmdrs || []).map(c => esc(c.name)).join(', ');
  let h = `<h3>${V.after === 'landing' ? 'The landings' : `Battles, week ${w.week}`}</h3><p class="dim">Fight a battle on its own field, or let it be auto-resolved. The odds are the same either way.</p>`;
  for (const b of w.pending) { const p = M.provs.find(x => x.id === b.prov), pa = PW.oddsAt(w, b.prov), mine = V.human === 'att' ? pa : 1 - pa, ca = cm('att', b.prov), cd = cm('def', b.prov);
    h += `<div class="pw-fc" style="margin-top:6px"><div><b>${esc(p.name)}</b> <span class="dim">${b.kind === 'landing' ? 'landing' : w.provs[b.prov].own === 'att' ? 'the garrison attacks' : 'the legions attack'}</span></div>
      <div>Legions <b>${n0(men('att', b.prov))}</b>${ca ? ` (${ca})` : ''} · garrison <b>${n0(men('def', b.prov))}</b>${cd ? ` (${cd})` : ''}</div>
      <div>Your chance: <b class="${mine >= .55 ? 'good' : mine < .4 ? 'bad' : 'gold'}">${pct(mine)}</b></div>
      <div class="pw-bb" style="margin-top:6px"><button class="btn go" data-p="fightb" data-a="${b.prov}">Fight it ▸</button><button class="btn" data-p="autob" data-a="${b.prov}">Auto-resolve</button></div></div>`; }
  if (w.pending.length > 1) h += `<div class="pw-bb"><button class="btn" data-p="autoall">Auto-resolve all</button></div>`;
  return h;
}
function previewText(pv) {
  if (pv.kind === 'join') return '· join';
  if (pv.kind === 'take') return '· unopposed';
  if (pv.kind === 'siege') return `· besiege (${pv.weeks} wk to storm)`;
  return `· battle, ${pct(pv.odds)}`;
}
function logPanel() {
  const el = V.root.querySelector('#pwLog');
  el.innerHTML = V.weekLog.length ? V.weekLog.map(g => `<h5>${g.week ? 'Week ' + g.week : 'The Rain'}</h5>${g.lines.map(l => `<div>${esc(l)}</div>`).join('')}`).join('') : '<span class="dim">The war log fills as the weeks pass.</span>';
  el.scrollTop = el.scrollHeight;
}
function showEnd() {
  if (!V.on) return; const w = V.war, el = V.root.querySelector('#pwEnd'), won = w.over && w.over.won === V.human;
  el.classList.remove('hide');
  el.innerHTML = `<div class="dim">${w.week} week${w.week === 1 ? '' : 's'} on ${esc(V.M.name)}</div><h2 class="${won ? 'good' : 'bad'}">${won ? 'Victory' : 'Defeat'}</h2><p>${esc(w.over ? w.over.why : '')}</p>
    <p>The legions have <b>${n0(PW.menOf(w, 'att'))}</b> men on the planet${V.reserve ? ` and ${n0(V.reserve)} in orbit` : ''}; the garrison <b>${n0(PW.menOf(w, 'def'))}</b>.</p>
    ${V.opts.preview ? '<p class="dim">A preview: nothing here goes back to the campaign.</p>' : ''}
    <div class="pw-bb" style="justify-content:center">${V.opts.preview ? '<button class="btn" data-p="again">Play again</button>' : ''}<button class="btn go" data-p="close">${V.opts.preview ? 'Close preview' : 'Return'}</button></div>`;
}
function toast(msg) { const el = document.createElement('div'); el.className = 'gb-toast'; el.style.cssText = 'position:absolute;left:50%;top:70px;transform:translateX(-50%);background:rgba(10,10,16,.92);border:1px solid var(--gold,#f2c14e);padding:6px 12px;z-index:3'; el.textContent = msg; V.root.appendChild(el); setTimeout(() => el.remove(), 2000); }
// the forecast plays a few hundred wars, so it waits until the plan stops changing
const planKey = () => planList().map(x => x.prov + x.troops + x.cmdrs.map(c => c.id).join('+')).sort().join('|');
function forecastSoon() { V.fcT = .35; }
function forecastNow() {
  const key = planKey(); if (!key || (V.fc && V.fc.key === key)) return;
  V.fc = { key, ...PW.forecast(V.spec, planList(), 160) }; side();
}

// ---------------------------------------------------------------- the frame
const tmp = new THREE.Vector3();
let last = 0;
function frame(t) {
  if (!V || !V.on) return; const dt = Math.min(.1, last ? (t - last) / 1000 : .016); last = t;
  camUpdate(dt);
  if (V.fcT > 0) { V.fcT -= dt; if (V.fcT <= 0) forecastNow(); }
  for (const m of V.armyM.values()) { const u = m.userData; if (u.t < 1 && u.from) { u.t = Math.min(1, u.t + dt / .9); const s = u.t * u.t * (3 - 2 * u.t); place(m, u.from.clone().lerp(u.home, s)); } }
  const pulse = 1 + .12 * Math.sin(t / 220); for (const m of V.markM.values()) m.scale.setScalar(SZ[m.userData.kind] * pulse);
  if (V.ready) V.R.render(V.scene, V.camera);
  labels();
}
// labels over the globe: province names, army strengths, the landing plan, and the march chips of the selected army
function labels() {
  const used = new Set(), cam = V.camera, cp = cam.position.clone().normalize(), w = V.war, M = V.M;
  const put = (key, cls, html, n, lift = 0, off = null) => {
    const p = n.clone(); if (off) p.add(off); p.normalize();
    if (p.dot(cp) < .2) return; // round the back of the globe
    tmp.copy(p).multiplyScalar(1 + lift).project(cam); if (tmp.z > 1 || (1 - tmp.y) / 2 * innerHeight < 60) return; // nor under the top bar
    let el = V.lbl.get(key); if (!el) { el = document.createElement('div'); V.lbl.set(key, el); V.root.querySelector('#pwL').appendChild(el); }
    if (el._c !== cls) { el.className = 'pw-lb ' + cls; el._c = cls; } if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.style.left = ((tmp.x + 1) / 2 * innerWidth).toFixed(1) + 'px'; el.style.top = ((1 - tmp.y) / 2 * innerHeight).toFixed(1) + 'px'; el.style.display = ''; used.add(key);
  };
  const near = V.cam.dist < 4;
  M.provs.forEach(p => { const f = frameAt(seat(p)); if (near || p.kind === 'capital' || p.kind === 'city') put('n:' + p.id, 'name' + (p.kind === 'capital' ? ' cap' : ''), esc(p.name), f.n, 0, f.nn.clone().multiplyScalar(-.03)); });
  for (const [k, m] of V.armyM) { const [sd, prov] = k.split(':'), men = w.armies.reduce((s, a) => s + (a.side === sd && a.prov === prov ? a.men : 0), 0);
    put('a:' + k, 'men', n0(men), m.position, .075); const el = V.lbl.get('a:' + k); if (el) el.style.background = colOf(sd === 'att' ? V.spec.by : V.spec.def) + 'cc'; }
  if (V.phase === 'plan') for (const [id, n] of V.plan) if (n > 0) { const p = M.provs.find(x => x.id === id), f = frameAt(seat(p)); put('l:' + id, 'land', '▼ ' + n0(n), f.n, .07, f.nn.clone().multiplyScalar(.075)); }
  if (V.phase === 'war' && V.selA && V.selA.men > 0 && !(V.selA.side === 'def' && w.armies.some(x => x.side === 'att' && x.prov === V.selA.prov)))
    for (const to of PW.reach(w, V.selA)) { const p = M.provs.find(x => x.id === to), f = frameAt(seat(p)); put('c:' + to, 'chip', `<span data-p="go" data-a="${to}">${esc(p.name)} ${previewText(PW.preview(w, V.selA, to))}</span>`, f.n, .02, f.nn.clone().multiplyScalar(-.075)); }
  for (const [k, el] of V.lbl) if (!used.has(k)) el.style.display = 'none';
}
