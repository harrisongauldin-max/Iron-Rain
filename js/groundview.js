// The ground battle on screen: its own renderer and scene over the whole window, a Total War camera (pan, orbit,
// zoom), box selection and right-click orders (drag to set a line's frontage and facing), the unit cards, the sites,
// and the drop zones before the Rain. The rules live in ground.js; this module only shows them and gives orders.
// Kept in one file with its own renderer (a WebGPURenderer since the WebGPU port; WebGL2 backend where there is no WebGPU).
import * as THREE from 'three/webgpu';
import * as GR from './ground.js';
import { G, MAP, NH, CH, UT, heightAt, footprint, radiusOf, fighting, live } from './ground.js';
import { FACTIONS, NEUTRAL_C } from './data.js';
import { S } from './state.js';
import { sfx, initAudio, music, setGroundWorld } from './audio.js';
import { figureGeo, figureMaterial, corpseGeo, storkGeo, lodGeo, KINDS, MUZZLE, cityGeo, staticMaterial, cityMaterial, CORPSE_KINDS, corpseOf } from './groundmodels.js';
import { animMesh, animFigure, animEnd, animReset, dyingAdd, drawDying, settle, shotEnds } from './groundanim.js'; // the figures' motion (animator chat)
import * as GFX from './groundfx.js'; // textures and effects: the terrain surface, water, sky dome
import * as PX from './groundpunch.js'; // the fighting: tracer ribbons, muzzle flashes, fireballs, smoke, shake
import { pass, renderOutput } from 'three/tsl'; // the post: the scene pass and tone mapping before SMAA
import { bloom } from '../vendor/three/tsl/BloomNode.js';
import { smaa } from '../vendor/three/tsl/SMAANode.js';
import { preset } from './gfx.js';

const PI = Math.PI, TAU = PI * 2, hyp = Math.hypot, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const FK = { rep: 'rising', soc: 'core', rim: 'rim' };
export const colOf = f => (FACTIONS[FK[f]] || {}).col || NEUTRAL_C;
const WHITE = new THREE.Color(1, 1, 1);
const VS = 2.2;                  // figures drawn larger than life, so a cohort of a thousand reads across an 8 km field
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = t => { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

let V = null;
export const _view = () => V; // for the test harness
export const active = () => !!(V && V.on);
// point the camera (the unit cards use it; so can a test)
export function look(x, z, dist, pitch, yaw) { if (!V) return; Object.assign(V.cam, { tx: x, tz: z }); if (dist) V.cam.dist = dist; if (pitch) V.cam.pitch = pitch; if (yaw != null) V.cam.yaw = yaw; }

// ---------------------------------------------------------------- setup and teardown
function makeDOM() {
  const root = document.createElement('div'); root.id = 'gb'; root.className = 'hide';
  root.innerHTML = `<canvas id="gbc"></canvas><canvas id="gbo"></canvas>
  <div class="gb-top"><div class="gb-title"><span class="k">Iron Rain</span><b id="gbName"></b></div>
    <div class="gb-mid"><div class="gb-clock" id="gbClock">0:00</div><div class="gb-sites" id="gbSites"></div><div class="gb-stork" id="gbStork"></div></div>
    <div class="gb-btns"><button class="btn" data-g="pause" id="gbPause">Pause</button><button class="btn" data-g="spd" id="gbSpd">Speed 1×</button><button class="btn" data-g="quit">Abandon</button></div></div>
  <div class="gb-str" id="gbStr"></div>
  <div class="gb-sel hide" id="gbSel"></div>
  <div class="gb-cards" id="gbCards"></div>
  <div class="gb-feed" id="gbFeed"></div>
  <div class="gb-brief hide" id="gbBrief"></div>
  <div class="gb-end hide" id="gbEnd"></div>
  <div class="gb-help">Left-drag select · Right-click move or attack · Right-click a wall: breach it (StarShells, RailRifles) · Right-drag to set a line · Double right-click: run · W A S D pan · Q E turn · wheel zoom · middle-drag orbit · Space pause · R run · F hold fire · H halt · C follow</div>`;
  document.body.appendChild(root);
  return root;
}
function init() {
  if (V) return V;
  const root = makeDOM(), cv = root.querySelector('#gbc'), ov = root.querySelector('#gbo');
  const R = new THREE.WebGPURenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' }); // WebGPU, or its WebGL2 backend
  R.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  V = { root, cv, ov, ctx: ov.getContext('2d'), R, on: false, sel: [], keys: {}, cam: { tx: MAP / 2, tz: MAP / 3, yaw: PI, pitch: .62, dist: 2200 }, mouse: { x: 0, y: 0 }, drag: null, rdrag: null, hudT: 0, speedI: 0, corpN: 0 };
  V.camera = new THREE.PerspectiveCamera(50, 1, 3, 40000);
  V.ready = false; R.init().then(() => { V.ready = true; }).catch(e => console.error('ground renderer failed to start', e));
  bindInput();
  addEventListener('resize', resize);
  return V;
}
// the same post as the space battles: an HDR pass with MSAA, bloom with a soft knee, tone mapping, SMAA on Ultra.
// Bloom follows the player's bloom setting; the Standard preset with bloom off draws straight to the screen
function buildPost() {
  if (V.post) { try { V.post.dispose(); } catch (e) { /* already gone */ } V.post = null; }
  const P = preset(), k = (S.gx && S.gx.bloomK) ?? 1, on = S.bloom !== false && k > 0; V.R.setPixelRatio(Math.min(devicePixelRatio || 1, P.dpr || 2));
  if (!on && !P.post) return;
  try {
    const sp = pass(V.scene, V.camera, { samples: P.msaa ? 4 : 0 }), col = sp.getTextureNode('output');
    let out = col; if (on) { const bl = bloom(col, .7 * k, .62, .78); bl.smoothWidth.value = .4; bl.bloomTintColors[3].set(1, .96, .9); bl.bloomTintColors[4].set(1, .92, .84); out = col.add(bl); }
    const pipe = new THREE.RenderPipeline(V.R); pipe.outputColorTransform = !P.smaa; pipe.outputNode = P.smaa ? smaa(renderOutput(out)) : out; V.post = pipe;
  } catch (e) { console.warn('ground post-processing unavailable', e); V.post = null; }
}
function resize() { if (!V) return; const w = innerWidth, h = innerHeight; V.R.setSize(w, h, false); V.cv.style.width = w + 'px'; V.cv.style.height = h + 'px'; V.ov.width = w * (devicePixelRatio || 1); V.ov.height = h * (devicePixelRatio || 1); V.ov.style.width = w + 'px'; V.ov.style.height = h + 'px'; V.camera.aspect = w / h; V.camera.updateProjectionMatrix(); }

// spec: built by camp.js groundSpec; meta: names for the screen
export function fight(spec, meta = {}) {
  init();
  return new Promise(resolve => {
    GR.setup(spec, { human: 0 });
    V.resolve = resolve; V.meta = meta; V.spec = spec; V.sel = []; V.on = true; V.lastFig = new Map(); V.tr = []; V.fl = []; V.speedI = 0; G.speed = 1; G.paused = false; V.ended = false;
    V.colA = colOf(spec.att.f); V.colD = colOf(spec.def.f);
    V.root.classList.remove('hide'); document.body.classList.add('ground'); S.gameState = 'ground';
    resize(); buildScene();
    // the camera opens over the plain, looking up at the city
    const c = G.map.city; Object.assign(V.cam, { tx: c.x, tz: c.y - 2600, yaw: PI, pitch: .55, dist: 4200 });
    V.root.querySelector('#gbName').textContent = `${G.map.B.city}, ${meta.world || ''}`;
    showBrief(); hud(true);
    try { initAudio(); music(.6); setGroundWorld(meta.world); S.groundEar = earAt; } catch (e) { /* no audio */ }
  });
}
function teardown() {
  V.on = false; V.root.classList.add('hide'); document.body.classList.remove('ground');
  if (V.scene) V.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
  V.scene = null;  G.on = false;
  try { music(0); S.groundEar = null; } catch (e) { /* no audio */ }
}

// ---------------------------------------------------------------- the scene
const hexC = h => new THREE.Color(h);
function rampColor(B, f, out) { // the biome's ground colours by height
  const r = B.ground, k = clamp(f, 0, .999) * (r.length - 1), i = Math.floor(k), t = k - i;
  out.copy(hexC(r[i])).lerp(hexC(r[Math.min(r.length - 1, i + 1)]), t); return out;
}
// The land beyond the field (view only: nothing moves out there). One grid round the field: its lines inside are the
// field's own 25 m lines, so the seam shares every vertex and height with the terrain; outside they open out
// (25 m at the edge, ×1.13 a step) to 20 km. Heights and scrub come from ground.js's far(), the same noise carried on;
// colours and masks follow groundfx's terrainArrays recipe so the shader paints it the same. Returns the lowest height.
const FAR = 20000;
function farLand(sc, M, B, ter) {
  const lines = []; for (let i = 0; i <= NH; i++) lines.push(i * CH);
  let st = CH, o = 0; const out = []; while (o < FAR) { o += st; st *= 1.13; out.push(Math.min(o, FAR)); }
  const X = out.slice().reverse().map(v => -v).concat(lines, out.map(v => MAP + v)), n = X.length, i0 = out.length, i1 = i0 + NH; // field columns i0..i1
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), mask = new Float32Array(n * n * 4), H = new Float32Array(n * n);
  const ramp = B.ground.map(h => new THREE.Color(h)), c = new THREE.Color(), W = NH + 1;
  let lo = Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = X[i], z = X[j], inside = i >= i0 && i <= i1 && j >= i0 && j <= i1;
    const f = inside ? { h: M.H[(j - i0) * W + (i - i0)], vegK: -1 } : M.far(x, z);
    H[k] = f.h; pos[k * 3] = x; pos[k * 3 + 1] = inside && i > i0 && i < i1 && j > i0 && j < i1 ? f.h - 40 : f.h; pos[k * 3 + 2] = z; // the field's interior points sit under the terrain, unused
    if (!inside || i === i0 || i === i1 || j === i0 || j === i1) lo = Math.min(lo, f.h);
    // scrub and wet sand soften with the cell size, so the wide outer cells give soft patches, not stretched blocks
    const cs = Math.max(X[Math.min(n - 1, i + 1)] - X[i], X[Math.min(n - 1, j + 1)] - X[j], CH) / CH;
    mask[k * 4] = inside ? 0 : Math.min(1, Math.max(0, f.vegK / (.015 * cs) + .5)) * Math.min(1, 6 / cs);
    mask[k * 4 + 2] = M.seaH >= 0 && cs < 4 ? Math.max(0, 1 - Math.abs(f.h - (M.seaH + 1)) / 7) : 0;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { // the colour: height ramp, darker on slopes, a little grain
    const k = j * n + i, h = H[k], q = Math.min(1, Math.max(0, h / (M.relief || 1))) * .999 * (ramp.length - 1), a = Math.floor(q);
    c.copy(ramp[a]).lerp(ramp[Math.min(ramp.length - 1, a + 1)], q - a);
    const dx = i < n - 1 ? Math.abs(H[k + 1] - h) / (X[i + 1] - X[i]) : 0, dz = j < n - 1 ? Math.abs(H[k + n] - h) / (X[j + 1] - X[j]) : 0;
    c.multiplyScalar(Math.min(1.1, Math.max(.6, 1.06 - (dx + dz) * CH / 60)) * (.95 + ((i * 73856093 ^ j * 19349663) >>> 0) % 1000 / 10000));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  // the edge row of the field takes the field's own colours and masks, so the seam does not show
  const fa = GFX.terrainArrays(M, B);
  for (let t = 0; t <= NH; t++) for (const [fi, fj] of [[t, 0], [t, NH], [0, t], [NH, t]]) { const k = (fj + i0) * n + (fi + i0), kf = fj * W + fi; for (let e = 0; e < 3; e++) col[k * 3 + e] = fa.col[kf * 3 + e]; for (let e = 0; e < 4; e++) mask[k * 4 + e] = fa.mask[kf * 4 + e]; }
  const idx = []; for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { if (i >= i0 && i < i1 && j >= i0 && j < i1) continue; const a = j * n + i, b = a + 1, d = a + n, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('mask', new THREE.BufferAttribute(mask, 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); g.computeVertexNormals();
  // each mesh only sees its own side of the seam, so the edge normals are averaged across it and given to both
  const nO = g.attributes.normal, nF = ter.geometry.attributes.normal, v = new THREE.Vector3();
  for (let t = 0; t <= NH; t++) for (const [fi, fj] of [[t, 0], [t, NH], [0, t], [NH, t]]) { const k = (fj + i0) * n + (fi + i0), kf = fj * W + fi;
    v.set(nO.getX(k) + nF.getX(kf), nO.getY(k) + nF.getY(kf), nO.getZ(k) + nF.getZ(kf)).normalize(); nO.setXYZ(k, v.x, v.y, v.z); nF.setXYZ(kf, v.x, v.y, v.z); }
  nF.needsUpdate = true;
  const m = new THREE.Mesh(g, ter.material); m.receiveShadow = true; m.frustumCulled = false; sc.add(m);
  return lo;
}
function buildScene() {
  const M = G.map, B = M.B, sc = new THREE.Scene(); V.scene = sc; GFX.dispose(); PX.dispose();
  sc.background = hexC(B.sky); sc.fog = new THREE.Fog(hexC(B.fog), 5000, 19000); // replaced by the sky dome below
  sc.add(new THREE.HemisphereLight(hexC(B.sky), hexC(B.ground[1]), .85));
  const sun = new THREE.DirectionalLight(hexC(B.sun), 2.4); sun.position.set(MAP * .2, 1800, -MAP * .15); sun.target.position.set(M.city.x, 0, M.city.y); sc.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); const sh = sun.shadow.camera; sh.left = -3200; sh.right = 3200; sh.top = 3200; sh.bottom = -3200; sh.near = 100; sh.far = 12000; sun.shadow.bias = -.0005; sun.position.set(M.city.x - 2200, 4800, M.city.y - 3200);
  sc.add(sun); V.sun = sun;
  GFX.skyDome(sc, B, V.spec ? V.spec.world : null, sun); // the sky dome, the Sun's glare, clouds or stars, the parent world overhead; sets the fog
  // the ground: one mesh from the height grid; its colours and masks (growth, pavement, shore) come from groundfx,
  // whose material paints the grain, stones, rock and pavement on top of them
  const W = NH + 1, pos = new Float32Array(W * W * 3), { col, mask } = GFX.terrainArrays(M, B);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const k = j * W + i; pos[k * 3] = i * CH; pos[k * 3 + 1] = M.H[k]; pos[k * 3 + 2] = j * CH; }
  const idx = new Uint32Array(NH * NH * 6); let q = 0;
  for (let j = 0; j < NH; j++) for (let i = 0; i < NH; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('mask', new THREE.BufferAttribute(mask, 4)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const ter = new THREE.Mesh(g, GFX.terrainMaterial(M, B)); ter.receiveShadow = true; sc.add(ter);
  // the land beyond the field, out to the horizon, in the same material; the skirt stays underneath as the floor past it
  const farMin = farLand(sc, M, B, ter);
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(MAP * 6, MAP * 6), GFX.skirtMaterial(B)); skirt.rotation.x = -PI / 2; skirt.position.set(MAP / 2, Math.min(-8, farMin) - 200, MAP / 2); // well below everything: 8 m under the lake beds it flickered through them at long range sc.add(skirt);
  if (M.seaH >= 0) { const wm = new THREE.Mesh(new THREE.PlaneGeometry(MAP * 6, MAP * 6, 1, 1), GFX.waterMaterial(M, B)); wm.rotation.x = -PI / 2; wm.position.set(MAP / 2, M.seaH, MAP / 2); wm.renderOrder = 2; sc.add(wm); skirt.position.y = M.seaH - 30; }
  // the city: a kit of towers, domes, hab stacks and blocks placed per block and merged into one static mesh (groundmodels.cityGeo)
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  if (M.blocks.length) { const cityM = new THREE.Mesh(cityGeo(M.blocks, CH, heightAt, hexC(B.ground[3]).lerp(new THREE.Color(.85, .84, .8), .5), V.spec ? V.spec.world : null), cityMaterial(V.spec ? V.spec.world : null)); cityM.castShadow = cityM.receiveShadow = true; sc.add(cityM); }
  // the wall and its towers
  if (M.walls.length) { const wmh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), new THREE.MeshStandardMaterial({ color: hexC(B.ground[2]).lerp(new THREE.Color(.5, .5, .5), .5), roughness: .9 }), M.walls.length * 2), qy = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    M.walls.forEach((w, i) => { const L = hyp(w.x1 - w.x0, w.y1 - w.y0), a = Math.atan2(w.y1 - w.y0, w.x1 - w.x0), cx = (w.x0 + w.x1) / 2, cz = (w.y0 + w.y1) / 2; qy.setFromAxisAngle(up, -a); pv.set(cx, heightAt(cx, cz) - 3, cz); sv.set(L + 2, w.h, 7); m4.compose(pv, qy, sv); wmh.setMatrixAt(i * 2, m4); pv.set(w.x0, heightAt(w.x0, w.y0) - 3, w.y0); sv.set(12, w.h + 8, 12); m4.compose(pv, qy, sv); wmh.setMatrixAt(i * 2 + 1, m4); });
    wmh.castShadow = wmh.receiveShadow = true; sc.add(wmh); V.wmh = wmh; }
  // the sites: a ring on the ground and a standard
  V.sites = M.sites.map(s => { const h = heightAt(s.x, s.y); const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 5, s.r, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -PI / 2; ring.position.set(s.x, h + 1.2, s.y); sc.add(ring);
    const pole = new THREE.Mesh(figureGeo('standard'), staticMaterial({ metalness: .55, roughness: .4 })); pole.position.set(s.x, h, s.y); pole.castShadow = true; sc.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(36, 20).translate(18, 0, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, emissive: 0x000000 })); flag.position.set(s.x, h + 80, s.y); sc.add(flag); return { ring, flag, s }; });
  // units: one instanced mesh per kind of figure; the figures themselves are built in groundmodels.js
  const geo = {}, cap = {}; for (const k of KINDS) { geo[k] = figureGeo(k); cap[k] = 0; }
  cap.lead = 6;                  // one figure per commander's unit carries the standard
  const all = G.units.map(u => [u.type, u.men]).concat(G.drop[0].map(x => [x[0], x[1]]), G.drop[1].map(x => [x[0], x[1]]));
  for (const [t, m] of all) cap[kindOf(t)] += figsFor(t, m) + 2;
  // two meshes per kind: the full model near the camera (casting shadows), a three-box stand-in beyond LOD_D;
  // setColorAt seeds the instanceColor the figure material reads
  const mkI = (g, k, n, shadow) => { const im = new THREE.InstancedMesh(g, figureMaterial(k), n); im.count = 0; im.castShadow = shadow; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, WHITE); sc.add(im); return im; };
  V.inst = {}; V.lo = {}; animReset(); for (const k in geo) { V.inst[k] = mkI(geo[k], k, Math.max(1, cap[k] + 16), true); animMesh(V.inst[k], k); V.lo[k] = mkI(lodGeo(k), k, Math.max(1, cap[k] + 16), false); } // near figures are posed on the GPU (groundanim.js)
  // the fallen: one mesh pair per kind of body (model builder's: CORPSE_KINDS / corpseOf in groundmodels.js); Grays share the first
  V.corpses = {}; for (const ck of CORPSE_KINDS) V.corpses[ck] = [mkI(figureGeo(ck), 'corpse', ck === 'corpse' ? CORPSES : CORPSES >> 2, false), mkI(lodGeo(ck), 'corpse', ck === 'corpse' ? CORPSES : CORPSES >> 2, false)];
  V.corpL = new Float32Array(CORPSES * 6); V.corpN = 0; V.corpDirty = true; V.corpCam = null; V.corpT = 0;
  // shots, flashes, fire and smoke, drop-pod trails: groundpunch's batches; then the bloom over the whole frame
  PX.init(sc); buildPost();
  V.stork = new THREE.InstancedMesh(storkGeo(), figureMaterial('stork'), 96); V.stork.count = 0; V.stork.setColorAt(0, WHITE); V.stork.frustumCulled = false; V.stork.castShadow = true; sc.add(V.stork);
  // the aircraft: ripWings (a Gold's gilt one leading each squadron) and thunderWings, at twice life; the wrecks falling
  V.air = {}; for (const k of ['rip', 'riplead', 'thunder']) { const im = new THREE.InstancedMesh(figureGeo(k), figureMaterial(k), k === 'riplead' ? 64 : 320); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, WHITE); sc.add(im); V.air[k] = im; }
  V.wrecks = []; V.airG = new Map(); V.airY = new Map();
  V.drop = new THREE.InstancedMesh(figureGeo('drop'), figureMaterial('drop'), 400); V.drop.count = 0; V.drop.frustumCulled = false; V.drop.setColorAt(0, WHITE); sc.add(V.drop); // the first wave's ablative cocoons
}
const kindOf = t => t === 'railmen' ? 'rail' : t === 'obsidian' ? 'obs' : t === 'peerless' ? 'gold' : t === 'starshell' ? 'shell' : t === 'gravpod' ? 'pod' : t === 'sarissa' ? 'aa' : 'inf';
// how many men one figure stands for: a cohort of Grays is drawn at up to sixty figures; every knight and suit is drawn
const perFig = (t, men0) => t === 'legion' || t === 'railmen' ? Math.max(1, Math.ceil(men0 / 60)) : t === 'obsidian' ? Math.max(1, Math.ceil(men0 / 50)) : 1;
const figsFor = (t, men) => Math.ceil(men / perFig(t, men));

// ---------------------------------------------------------------- the frame
export function groundFrame(dt) {
  if (!V || !V.on) return;
  if (!G.over && G.phase === 'battle' && !G.paused) GR.step(dt * G.speed);
  camUpdate(dt); GFX.tick(dt, V.camera);
  drawUnits(dt); drawAir(dt); drawFx(dt); drawSites(); PX.frame(dt, G.paused ? 0 : dt * G.speed, V.camera, innerHeight);
  if (V.ready) { PX.shake(V.camera); try { if (V.post) V.post.render(); else V.R.render(V.scene, V.camera); } finally { PX.restore(V.camera); } } // the renderer starts asynchronously; the first frame or two wait for it
  overlay();
  V.hudT -= dt; if (V.hudT <= 0) { V.hudT = .2; hud(); }
  if (G.over && !V.ended) { V.ended = true; setTimeout(showEnd, 1400); }
}
const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color(), DIR = new THREE.Vector3(), NZ = new THREE.Vector3(0, 0, -1);
function camUpdate(dt) {
  const c = V.cam, k = V.keys, sp = c.dist * 1.1 * dt, fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = -fz, rz = fx;
  if (c.follow && (k.w || k.s || k.a || k.d || k.arrowup || k.arrowdown || k.arrowleft || k.arrowright)) c.follow = null; // a pan lets go
  const f = c.follow; if (f && (f.gone || f.away || f.men <= 0 || f.state === 'fall')) { c.follow = null; } const kf = Math.min(1, dt * 3);
  if (c.follow) { c.tx += (f.x + (f.vx || 0) * .6 - c.tx) * kf; c.tz += (f.y + (f.vy || 0) * .6 - c.tz) * kf; }
  c.lift = (c.lift || 0) + ((c.follow && f.T.air ? airY(f) - heightAt(clamp(c.tx, 0, MAP), clamp(c.tz, 0, MAP)) : 0) - (c.lift || 0)) * kf; // aim at the squadron's height, not the ground under it
  if (!V.modal) { if (k.w || k.arrowup) { c.tx += fx * sp; c.tz += fz * sp; } if (k.s || k.arrowdown) { c.tx -= fx * sp; c.tz -= fz * sp; } if (k.a || k.arrowleft) { c.tx -= rx * sp; c.tz -= rz * sp; } if (k.d || k.arrowright) { c.tx += rx * sp; c.tz += rz * sp; } if (k.q) c.yaw += 1.4 * dt; if (k.e) c.yaw -= 1.4 * dt; }
  const B = c.follow ? 2600 : 400; c.tx = clamp(c.tx, -B, MAP + B); c.tz = clamp(c.tz, -B, MAP + B);
  const ty = heightAt(clamp(c.tx, 0, MAP), clamp(c.tz, 0, MAP)) + c.lift, cp = Math.cos(c.pitch);
  let x = c.tx + Math.sin(c.yaw) * cp * c.dist, y = ty + Math.sin(c.pitch) * c.dist, z = c.tz + Math.cos(c.yaw) * cp * c.dist;
  const gy = heightAt(clamp(x, 0, MAP), clamp(z, 0, MAP)) + 6; if (y < gy) y = gy;
  V.camera.position.set(x, y, z); V.camera.lookAt(c.tx, ty, c.tz);
  V.camera.updateMatrixWorld();
}
// figures in their ranks: the cohort's frontage and depth, the figures spread to fill it, jostling in melee and
// scattering when the unit runs
const LOD_D = 350, CORPSES = 12000; // metres from the camera beyond which a figure is drawn as its stand-in; the fallen kept on the field
function drawUnits(dt) {
  const cnt = {}, cntL = {}; for (const k of KINDS) { cnt[k] = 0; cntL[k] = 0; } const t = G.t, cp = V.camera.position, dtg = G.paused ? 0 : dt * (G.speed || 1);
  for (const u of G.units) {
    if (u.T.air || u.state === 'fall' || u.men <= 0 && !V.lastFig.has(u.id)) continue; // the aircraft are drawAir's
    const kd = kindOf(u.type), pf = perFig(u.type, u.men0), nf = u.gone ? 0 : Math.ceil(u.men / pf), fp = footprint(u);
    const files = clamp(Math.round(fp.w / (u.T.sp * Math.sqrt(pf))), 1, Math.max(1, nf)), ranks = Math.max(1, Math.ceil(nf / files)), dx = fp.w / files, dz = Math.max(u.T.sp * 1.1, fp.d / ranks);
    const ca = Math.cos(u.a), sa = Math.sin(u.a), px = -sa, py = ca, mv = hyp(u.vx, u.vy), rout = u.state === 'rout', mel = !!u.melee;
    const col = u.team === 0 ? V.colA : V.colD, base = tmpC.set(col.main);   // the figure's own paint is in the model; this tints only its team-mask areas (crests, pauldrons, capes)
    if (rout) base.lerp(new THREE.Color('#ffffff'), .25 + .2 * Math.sin(t * 8));
    const last = V.lastFig.get(u.id) || [];
    const figs = [], dU = hyp(u.x - cp.x, u.y - cp.z, heightAt(u.x, u.y) - cp.y), rU = radiusOf(u), allFar = dU > LOD_D * 1.2 + rU, allNear = dU < LOD_D * .86 - rU; // (each figure has its own switch distance: groundanim)
    for (let n = 0; n < nf; n++) {
      const kk = n === 0 && u.leader && kd === 'gold' ? 'lead' : kd;   // the commander's figure carries the standard
      const fi = n % files, ri = Math.floor(n / files), h1 = ((u.id * 928371 + n * 2654435761) >>> 0) / 4294967296, h2 = ((u.id * 1234567 + n * 7654321) >>> 0) / 4294967296;
      let ox = (fi - (files - 1) / 2) * dx + (h1 - .5) * dx * .35, oz = -((ri - (ranks - 1) / 2) * dz) + (h2 - .5) * dz * .35;
      if (rout) { const rt = t - (u.routT || t), sc = 1 + Math.min(4, rt * .4); ox *= sc; oz *= sc; ox += (h2 - .5) * 30 * Math.min(1, rt * .5); } // the scatter grows, it doesn't jump
      if (mel) { ox += Math.sin(t * 6 + n) * .5; oz += Math.cos(t * 5 + n * 1.7) * .5 + (ri === 0 ? 1.5 : 0); }
      const lift = u.type === 'gravpod' ? 2.2 + Math.sin(t * 2 + n) * .3 : u.type === 'peerless' && mv > 8 ? 3 + Math.sin(t * 3 + n) * 1.5 : 0;
      const tyaw = PI / 2 - (rout ? u.a + PI * 0 : u.a) + (mel ? Math.sin(t * 1.7 + n) * .18 : 0); // in melee each turns a little to his own foe
      const P = settle(last[n], u.x + px * ox + ca * oz, u.y + py * ox + sa * oz, tyaw, lift, dtg), wx = P[0], wz = P[1], yaw = P[2], lf = P[3], fv = P[4]; // each walks to his place (groundanim.js)
      const wy = heightAt(wx, wz) + lf;
      const far = allFar || !allNear && hyp(wx - cp.x, wz - cp.z, wy - cp.y) > LOD_D * (.86 + .34 * h1), C0 = far ? cntL : cnt, imk = (far ? V.lo : V.inst)[kk]; // a cohort thins into stand-ins man by man, not all at once
      if (C0[kk] >= imk.instanceMatrix.count) { figs.push([wx, wy, wz, yaw, lf]); continue; } // (full: not drawn this frame, but he keeps his place)
      const bob = mv > .5 && kd !== 'pod' ? Math.abs(Math.sin(t * (u.run ? 11 : 7) + h1 * 10)) * .12 : 0;
      tmpV.set(wx, wy + bob, wz); tmpQ.setFromAxisAngle(UP, yaw); tmpS.set(VS, VS, VS); tmpM.compose(tmpV, tmpQ, tmpS);
      imk.setMatrixAt(C0[kk], tmpM); imk.setColorAt(C0[kk], base); if (!far) animFigure(imk, C0[kk], wx, wy, wz, yaw, u, kk, n, h1, VS, t, P); C0[kk]++; figs.push([wx, wy, wz, yaw, lf]);
    }
    // the fallen stay where they fell
    if (last.length > figs.length) for (let n = figs.length; n < last.length; n++) { const f = last[n]; if (hyp(f[0] - cp.x, f[2] - cp.z, f[1] - cp.y) > LOD_D || !dyingAdd(f, u.team, kd, base.clone(), VS, t)) addCorpse(f, u.team, false, kd); } // near, they fall first
    if (u.gone && !figs.length) V.lastFig.delete(u.id); else V.lastFig.set(u.id, figs);
  }
  drawDying(V.inst, cnt, t, (f, team, kind) => addCorpse(f, team, true, kind)); animEnd(V.inst);
  for (const [M0, C1] of [[V.inst, cnt], [V.lo, cntL]]) for (const k in M0) { M0[k].count = C1[k]; M0[k].instanceMatrix.needsUpdate = true; if (M0[k].instanceColor) M0[k].instanceColor.needsUpdate = true; }
  drawCorpses(dt);
}
// ---------------------------------------------------------------- the air
// Each squadron in vics of three, one behind another, its Gold's gilt ripWing at the head; a thunderWing flight in a
// line abreast. Heights are above the ground, which is smoothed under each squadron so it does not follow every bump.
// Banked into its turns, nose up or down as it climbs or dives; an engine glow and a short exhaust streak behind each
const AIR_VS = 2, qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
const airKind = u => u.type === 'thunderwing' ? 'thunder' : 'rip';
function slot(u, i) { // [right, back] in metres from the leader
  if (u.type === 'thunderwing') return [(i - (u.men0 - 1) / 2) * 70, (i % 2) * 30];
  const v = Math.floor(i / 3), k = i % 3; return [(k === 0 ? 0 : k === 1 ? -44 : 44) + (v % 2 ? 26 : -26) * (v > 0), (k ? 34 : 0) + v * 110];
}
export const airY = u => V && V.airY.has(u.id) ? V.airY.get(u.id) : heightAt(clamp(u.x, 0, MAP), clamp(u.y, 0, MAP)) + (u.alt || 0); // the height the squadron is drawn at
function drawAir(dt) {
  const n = { rip: 0, riplead: 0, thunder: 0 }, t = G.t, step = G.paused ? 0 : dt * (G.speed || 1), cp = V.camera.position;
  const H = Math.max(240, V.cv.clientHeight || 720), tanH = Math.tan(V.camera.fov * PI / 360); let sc = AIR_VS;
  const put = (k, x, y, z, yaw, pitch, roll, col, s0 = sc) => { const im = V.air[k]; if (n[k] >= im.instanceMatrix.count) return;
    tmpQ.setFromAxisAngle(UP, yaw); qA.setFromAxisAngle(XA, -pitch); qB.setFromAxisAngle(ZA, roll); tmpQ.multiply(qA).multiply(qB);
    tmpV.set(x, y, z); tmpS.set(s0, s0, s0); tmpM.compose(tmpV, tmpQ, tmpS); im.setMatrixAt(n[k], tmpM); im.setColorAt(n[k], col); n[k]++; };
  for (const u of G.units) {
    if (!u.T.air) continue;
    if (u.gone || u.away || u.men <= 0) continue; // its last height is kept for the wrecks
    const k0 = airKind(u), gh = heightAt(clamp(u.x, 0, MAP), clamp(u.y, 0, MAP)); let g = V.airG.has(u.id) ? V.airG.get(u.id) : gh;
    g += (gh - g) * Math.min(1, step * .6); V.airG.set(u.id, g); const y0 = Math.max(g + u.alt, gh + 30); V.airY.set(u.id, y0);
    const ca = Math.cos(u.a), sa = Math.sin(u.a), yaw = PI / 2 - u.a, pitch = clamp(u.pitch || 0, -.45, .45), roll = (u.bank || 0) * (k0 === 'thunder' ? .45 : 1.05);
    const D = hyp(u.x - cp.x, y0 - cp.y, u.y - cp.z), col = tmpC.set((u.team === 0 ? V.colA : V.colD).main), far = D > 6000;
    sc = clamp(D * 2 * tanH * 12 / ((k0 === 'thunder' ? 14 : 10.5) * H), AIR_VS, 7); // far off, an aircraft is drawn up to 3.5× bigger so it stays some 12 px long
    const sp = Math.max(1, sc / AIR_VS * .8), L = (k0 === 'thunder' ? 3.5 : 2.5) * sc; // the vics open out as the aircraft grow, so they don't overlap
    for (let i = 0; i < u.men; i++) {
      const [r0, b0] = slot(u, i), r = r0 * sp, b = b0 * sp, h = ((u.id * 7919 + i * 104729) % 1000) / 1000, wob = Math.sin(t * .9 + h * 9) * 4;
      const wx = u.x + (-sa) * r - ca * b + Math.sin(t * .6 + h * 7) * 3, wz = u.y + ca * r - sa * b + Math.cos(t * .5 + h * 5) * 3, wy = y0 + wob - Math.sin(pitch) * b - roll * r * .25; // the formation tilts with the bank
      put(i === 0 && k0 === 'rip' ? 'riplead' : k0, wx, wy, wz, yaw, pitch, roll + Math.sin(t * 1.3 + h * 11) * .04, col);
      if (far) continue;
      const ex = wx - ca * L, ez = wz - sa * L, ey = wy - Math.sin(pitch) * L; // the engines: a glow and a streak behind
      PX.glow(ex, ey, ez, (k0 === 'thunder' ? 1.75 : 1.1) * sc, .6, 1.1, 1.5, 2.6);
      PX.ribbon(ex, ey, ez, ex - ca * 11 * sc, ey - Math.sin(pitch) * 11 * sc, ez - sa * 11 * sc, (k0 === 'thunder' ? .9 : .6) * sc, .35, .8, 1.1, 2, .2);
    }
  }
  // the wrecks: thrown on along their heading, falling, burning, trailing smoke; a fireball where they come down
  const keep = [];
  for (const w of V.wrecks) {
    w.vy -= 9.8 * G.map.B.g * step; w.vx *= 1 - .25 * step; w.vz *= 1 - .25 * step; w.x += w.vx * step; w.y += w.vy * step; w.z += w.vz * step; w.roll += w.spin * step; w.pitch = Math.max(-1.2, w.pitch - .35 * step);
    const gh = heightAt(clamp(w.x, 0, MAP), clamp(w.z, 0, MAP));
    if (w.y <= gh + 2) { PX.blast(w.x, gh, w.z, w.kind === 'thunder'); GFX.scorch(w.x, w.z, w.kind === 'thunder' ? 26 : 14); sfx(w.kind === 'thunder' ? 'bigboom' : 'boom', w.x, w.z, 22); continue; }
    put(w.kind, w.x, w.y, w.z, w.yaw, w.pitch, w.roll, tmpC.setRGB(.25, .22, .2), clamp(hyp(w.x - cp.x, w.y - cp.y, w.z - cp.z) * 2 * tanH * 12 / (12 * H), AIR_VS, 7));
    PX.trail(w.x, w.y, w.z); PX.glow(w.x, w.y, w.z, 10, .9, 2.6, 1.4, .5); keep.push(w);
  }
  V.wrecks = keep;
  // the bombs, falling in their stick
  for (const b of G.bombs || []) { const e = G.t - b.t0, T = Math.max(.1, b.t1 - b.t0), k = clamp(e / T, 0, 1), x = b.x0 + b.vx * e, z = b.y0 + b.vy * e, gh = heightAt(clamp(x, 0, MAP), clamp(z, 0, MAP)), y = gh + b.z0 * (1 - k * k), vy = 2 * b.z0 * k / T;
    const s = .05; PX.ribbon(x - b.vx * s, y + vy * s, z - b.vy * s, x, y, z, 1.6, 1, .08, .08, .09, 0); }
  for (const k in V.air) { const im = V.air[k]; im.count = n[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
}
// an aircraft lost: the wreck falls from where it was hit
function crash(f) {
  const y0 = V.airY.has(f.id) ? V.airY.get(f.id) : heightAt(clamp(f.x, 0, MAP), clamp(f.y, 0, MAP)) + f.z;
  for (let i = 0; i < Math.min(f.n, 4); i++) { const kind = f.type === 'thunderwing' ? 'thunder' : 'rip', sp = (f.v || 100) * (.5 + Math.random() * .3), a = f.a + (Math.random() - .5) * .6;
    V.wrecks.push({ kind, x: f.x + (Math.random() - .5) * 40, y: y0 + (Math.random() - .5) * 20, z: f.y + (Math.random() - .5) * 40, vx: Math.cos(a) * sp, vy: -5 - Math.random() * 15, vz: Math.sin(a) * sp, yaw: PI / 2 - a, pitch: -.1, roll: 0, spin: (Math.random() < .5 ? -1 : 1) * (1.5 + Math.random() * 3) });
    PX.blast(f.x, y0, f.y, false); }
  sfx('boom', f.x, f.y, 14);
}
// the fallen: kept as a list, sorted into the near and far meshes again when the camera has moved or more have fallen
function drawCorpses(dt) {
  const cp = V.camera.position, moved = !V.corpCam || hyp(cp.x - V.corpCam.x, cp.y - V.corpCam.y, cp.z - V.corpCam.z) > 40;
  if ((V.corpT -= dt) > 0 && !moved) return; if (!V.corpDirty && !moved) return;
  V.corpT = .5; V.corpDirty = false; V.corpCam = cp.clone();
  const L = V.corpL, n = Math.min(CORPSES, V.corpN), cnt = {}; for (const ck in V.corpses) cnt[ck] = [0, 0];
  for (let i = 0; i < n; i++) { const o = i * 6, x = L[o], y = L[o + 1], z = L[o + 2], ck = CORPSE_KINDS[L[o + 5]] || 'corpse', far = hyp(x - cp.x, y - cp.y, z - cp.z) > LOD_D ? 1 : 0, im = V.corpses[ck][far];
    if (cnt[ck][far] >= im.instanceMatrix.count) continue; const j = cnt[ck][far]++;
    tmpV.set(x, y, z); tmpQ.setFromAxisAngle(UP, L[o + 3]); tmpS.set(VS, VS, VS); tmpM.compose(tmpV, tmpQ, tmpS); im.setMatrixAt(j, tmpM);
    tmpC.set((L[o + 4] ? V.colD : V.colA).main).multiplyScalar(.7); im.setColorAt(j, tmpC); }
  for (const ck in V.corpses) V.corpses[ck].forEach((im, far) => { im.count = cnt[ck][far]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
}
function addCorpse(f, team, exact = false, kind = 'inf') { // exact: where the fall animation laid the figure down; kind: whose body it is
  const o = (V.corpN % CORPSES) * 6, j = exact ? 0 : 1; V.corpN++; V.corpDirty = true;
  V.corpL[o] = f[0] + (Math.random() - .5) * j; V.corpL[o + 1] = f[1] + .15; V.corpL[o + 2] = f[2] + (Math.random() - .5) * j; V.corpL[o + 3] = f[3] + (Math.random() - .5) * 2 * j; V.corpL[o + 4] = team; V.corpL[o + 5] = Math.max(0, CORPSE_KINDS.indexOf(corpseOf(kind)));
}

// what each weapon looks like in flight: colour, speed (m/s), streak length (m)
const WK = { scorch: 'inf', rail: 'rail', plasma: 'obs', pulse: 'gold', cannon: 'shell', missile: 'shell', heavy: 'pod', sarissa: 'aa' }; // which figure fires each weapon, for the muzzle height
const SHOT = { scorch: ['#ffd28a', 900, 14], pulse: ['#ff5a3c', 600, 10], rail: ['#8fd3ff', 4000, 120], cannon: ['#ffaa40', 500, 16], missile: ['#f4f4f4', 220, 30], heavy: ['#ffe066', 800, 18], plasma: ['#6dff8a', 380, 8] };
function drawFx(dt) {
  // new events from the rules
  for (const f of G.fx) {
    if (f.k === 'shot') { const S0 = SHOT[f.f] || SHOT.scorch, gh = (x, y) => heightAt(clamp(x, 0, MAP), clamp(y, 0, MAP)), E = shotEnds(f), o = E && E[0], e = E && E[1]; // from the posed barrel to a posed man (groundanim.js)
      const X0 = o ? o[0] : f.x0, Z0 = o ? o[2] : f.y0, X1 = e ? e[0] : f.x1, Z1 = e ? e[2] : f.y1, h0 = o ? o[1] : f.z0 != null ? gh(f.x0, f.y0) + f.z0 : gh(f.x0, f.y0) + (MUZZLE[WK[f.f]] || MUZZLE.inf)[1] * VS, h1 = e ? e[1] : f.z1 != null ? gh(f.x1, f.y1) + f.z1 : gh(f.x1, f.y1) + 1.2 * VS, L = hyp(X1 - X0, Z1 - Z0, h1 - h0);
      if (V.tr.length < 2500) V.tr.push({ x0: X0, y0: h0, z0: Z0, x1: X1, y1: h1, z1: Z1, L, t: -(f.d || 0) * .5, spd: S0[1], len: S0[2], arc: f.f === 'missile' ? Math.min(120, L * .25) : f.f === 'heavy' ? Math.min(40, L * .08) : 0, kind: f.f, mz: false }); }
    else if (f.k === 'breach') rubble(f.w);
    else if (f.k === 'crash') crash(f);
    else if (f.k === 'land') { PX.blast(f.x, heightAt(f.x, f.y), f.y, !!f.big); sfx(f.big ? 'bigboom' : 'boom', f.x, f.y, 18); }
    else if (f.k === 'melee') { if (Math.random() < .18) PX.sparks(f.x + (Math.random() - .5) * 8, heightAt(f.x, f.y) + 2.2, f.y + (Math.random() - .5) * 8, 3, 9, f.t === 0 ? [2.4, 1.7, .8] : [2.4, 2, 1.2], .3); near(f.x, f.y) && Math.random() < .35 && sfx('melee', f.x, f.y); }
    else if (f.k === 'charge') { sfx('hit', f.x, f.y, 1.5); }
  }
  G.fx.length = 0;
  // shots in flight: a lit ribbon from tail to head; the heavy rounds carry a glowing head, missiles a smoke trail
  const cp = V.camera.position, step = G.paused ? 0 : dt * G.speed, keep = [];
  for (const s of V.tr) {
    s.t += step; if (s.t < 0) { keep.push(s); continue; }
    const Lk = PX.LOOK[s.kind] || PX.LOOK.scorch, head = s.t * s.spd, k1 = Math.min(1, head / s.L), k0 = Math.max(0, (head - (Lk.len || s.len)) / s.L);
    if (!s.mz) { s.mz = true; if (hyp(s.x0 - cp.x, s.z0 - cp.z) < 3200) PX.muzzle(s.x0, s.y0, s.z0, s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0, s.kind);
      sfx(SND[s.kind] || 'scorch', s.x0, s.z0); }
    if (k0 >= 1) { // it lands
      PX.impact(s.x1, s.y1, s.z1, s.kind);
      const big = s.kind === 'missile' || s.kind === 'cannon' || s.kind === 'heavy'; if (big) sfx(s.kind === 'missile' ? 'boom' : 'hit', s.x1, s.z1, s.kind === 'missile' ? 8 : 1.5);
      continue; }
    const px = k => s.x0 + (s.x1 - s.x0) * k, py = k => s.y0 + (s.y1 - s.y0) * k + s.arc * 4 * k * (1 - k), pz = k => s.z0 + (s.z1 - s.z0) * k, c = Lk.c;
    PX.ribbon(px(k0), py(k0), pz(k0), px(k1), py(k1), pz(k1), Lk.w, 1, c[0], c[1], c[2], s.kind === 'rail' ? .06 : .3);
    if (Lk.sheath) PX.ribbon(px(Math.max(0, k0 - .2)), py(Math.max(0, k0 - .2)), pz(Math.max(0, k0 - .2)), px(k1), py(k1), pz(k1), Lk.sheath, .22, c[0] * .5, c[1] * .5, c[2] * .6, 0); // the rail's ionised wake
    if (Lk.head && k1 < 1) PX.glow(px(k1), py(k1), pz(k1), Lk.head, 1, c[0], c[1], c[2]);
    if (Lk.smoke && k1 < 1) PX.trail(px(k1), py(k1), pz(k1));
    keep.push(s);
  }
  V.tr = keep;
  // the drop: pods streak down out of the sky, burning; the Storks come down slow on their thrusters, hover, and lift away
  let ns = 0, nd = 0;
  for (const p of G.pods) {
    const k = clamp((G.t - p.t0) / Math.max(.1, p.t1 - p.t0), 0, 1), gh = heightAt(p.x, p.y);
    if (p.wave === 1) { if (ns >= 96) continue; const up = G.t > p.t1 ? (G.t - p.t1) ** 2 * 40 : 0, alt = gh + 45 + 2200 * (1 - k) ** 2 + up; tmpV.set(p.x - 600 * (1 - k), alt, p.y - 380 * (1 - k)); tmpQ.setFromAxisAngle(UP, .55); tmpS.set(1, 1, 1); tmpM.compose(tmpV, tmpQ, tmpS); V.stork.setMatrixAt(ns, tmpM); V.stork.setColorAt(ns, tmpC.set(V.colA.main)); ns++;
      const fl = .8 + Math.random() * .4; PX.ribbon(tmpV.x, tmpV.y - 3, tmpV.z, tmpV.x, tmpV.y - 30 - Math.random() * 12, tmpV.z, 5, .8 * fl, .9, 1.3, 2.4, 0); PX.glow(tmpV.x, tmpV.y - 4, tmpV.z, 14, .7 * fl, 1, 1.4, 2.4);
      continue; }
    if (p.u.state !== 'fall') continue;
    const alt = gh + 5000 * Math.pow(1 - k, 1.5), x = p.x - 1800 * (1 - k), z = p.y - 1000 * (1 - k);
    if (nd < 400) { DIR.set(1800, -7500 * Math.sqrt(Math.max(0, 1 - k)) - 200, 1000).normalize(); tmpQ.setFromUnitVectors(NZ, DIR); tmpV.set(x, alt, z); tmpS.set(3, 3, 3); tmpM.compose(tmpV, tmpQ, tmpS); V.drop.setMatrixAt(nd, tmpM); V.drop.setColorAt(nd, tmpC.set(V.colA.main)); nd++; }
    const tl = 1.1 - k; PX.ribbon(x - 180 * tl, alt + 320 * tl * 1.2, z - 100 * tl, x, alt, z, 7, .9, 2.6, 1.5, .5, .25); PX.glow(x, alt, z, 22, 1, 2.6, 1.8, .9); // the burn of re-entry
  }
  V.stork.count = ns; V.stork.instanceMatrix.needsUpdate = true; if (V.stork.instanceColor) V.stork.instanceColor.needsUpdate = true;
  V.drop.count = nd; V.drop.instanceMatrix.needsUpdate = true; if (V.drop.instanceColor) V.drop.instanceColor.needsUpdate = true;
}
const near = (x, z) => hyp(x - V.cam.tx, z - V.cam.tz) < V.cam.dist * 1.1 + 200;
// for audio.js: where a sound at (x, z) is, as [pan -1..1 from the camera's right, distance in metres]
const earV = new THREE.Vector3(), earR = new THREE.Vector3();
function earAt(x, z) { if (!V || !V.camera) return [0, 0]; const cp = V.camera.position; earR.setFromMatrixColumn(V.camera.matrixWorld, 0); earV.set(x - cp.x, heightAt(clamp(x, 0, MAP), clamp(z, 0, MAP)) - cp.y, z - cp.z); const d = earV.length() || 1; return [clamp(earV.dot(earR) / d, -1, 1), d]; }
// which sound each weapon makes
const SND = { scorch: 'scorch', pulse: 'pulse', rail: 'rail', cannon: 'cannon', missile: 'missile', heavy: 'heavy', plasma: 'plasma', sarissa: 'sarissa' };
// a breached stretch of wall: a low spill of rubble across the gap (the towers at its ends still stand)
function rubble(id) {
  const w = G.map.walls[id]; if (!w || !V.wmh) return;
  const L = hyp(w.x1 - w.x0, w.y1 - w.y0), a = Math.atan2(w.y1 - w.y0, w.x1 - w.x0), cx = (w.x0 + w.x1) / 2, cz = (w.y0 + w.y1) / 2;
  tmpQ.setFromAxisAngle(UP, -a); tmpV.set(cx, heightAt(cx, cz) - 2, cz); tmpS.set(L - 10, 4, 16); tmpM.compose(tmpV, tmpQ, tmpS);
  V.wmh.setMatrixAt(id * 2, tmpM); V.wmh.instanceMatrix.needsUpdate = true;
}
function drawSites() {
  for (const o of V.sites) { const s = o.s, col = s.own === 0 ? V.colA.main : V.colD.main, contested = s.a > 0 && s.d > 0;
    o.ring.material.color.set(contested ? '#ffffff' : col); o.ring.material.opacity = contested ? .5 + .4 * Math.sin(G.t * 6) : .7; o.flag.material.color.set(col); o.flag.material.emissive.set(col).multiplyScalar(.25); o.flag.rotation.y = Math.sin(G.t * .7 + s.id) * .4; }
}

// ---------------------------------------------------------------- screen space: plates, rings, orders, zones
function toScreen(x, y, z) { tmpV.set(x, y, z).project(V.camera); if (tmpV.z > 1 || tmpV.z < -1) return null; return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight }; }
const gpt = (x, z, up = 0) => toScreen(x, heightAt(clamp(x, 0, MAP), clamp(z, 0, MAP)) + up, z);
const ppt = (u, up = 0) => u.T.air ? toScreen(u.x, airY(u) + up * .4, u.y) : gpt(u.x, u.y, up); // a unit's point on screen: aircraft where they fly
function ringPath(c, x, z, r, n = 40) { let first = true; for (let k = 0; k <= n; k++) { const a = k / n * TAU, p = gpt(x + Math.cos(a) * r, z + Math.sin(a) * r, 1); if (!p) { first = true; continue; } if (first) { c.moveTo(p.x, p.y); first = false; } else c.lineTo(p.x, p.y); } }
function rectPath(c, u, cx, cy, a, w, d) { const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca, pts = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]].map(([o, f]) => gpt(cx + px * o + ca * f, cy + py * o + sa * f, .8)); if (pts.some(p => !p)) return false; c.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) c.lineTo(p.x, p.y); c.closePath(); return true; }
const airLoad = u => clamp(u.T.bombs ? u.bombs / Math.max(1, u.T.bombs * u.men) : Math.max(u.ammo / u.T.ammo, u.ammo2 / Math.max(1, (u.wpn2 ? u.wpn2.ammo : 1) * u.men)), 0, 1);
function overlay() {
  const c = V.ctx, dpr = devicePixelRatio || 1; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, innerWidth, innerHeight);
  c.font = '600 10px "Segoe UI", system-ui, sans-serif'; c.textBaseline = 'middle';
  // the drop zones and the guns' umbrella, before the Rain and while it falls
  if (G.phase === 'deploy' || G.t < 30) {
    for (const u of G.units) if (u.T.aa && !u.gone) { c.beginPath(); ringPath(c, u.x, u.y, u.wpn.aa, 64); c.setLineDash([6, 6]); c.strokeStyle = 'rgba(255,80,60,.55)'; c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); }
    for (const z of G.zones) { c.beginPath(); ringPath(c, z.x, z.y, 240); c.strokeStyle = '#f2c14e'; c.lineWidth = 2; c.stroke(); const p = gpt(z.x, z.y, 4); if (p) { c.fillStyle = '#f2c14e'; c.textAlign = 'center'; c.fillText(`ZONE ${'ABCD'[z.id] || ''} · ${Math.round(GR.aaAt(z.x, z.y) * 100)}% lost in the sky`, p.x, p.y - 12); } }
    if (G.phase === 'deploy' && V.hoverG) { const e = GR.zoneOK(V.hoverG.x, V.hoverG.z); c.beginPath(); ringPath(c, V.hoverG.x, V.hoverG.z, 240); c.strokeStyle = e ? 'rgba(255,90,70,.8)' : 'rgba(242,193,78,.6)'; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]); const p = gpt(V.hoverG.x, V.hoverG.z, 4); if (p) { c.textAlign = 'center'; c.fillStyle = e ? '#ff8a6e' : '#e9e3d4'; c.fillText(e || `${Math.round(GR.aaAt(V.hoverG.x, V.hoverG.z) * 100)}% of the drop lost here`, p.x, p.y + 16); } }
  }
  // the sites' names and how they stand
  for (const s of G.map.sites) { const p = gpt(s.x, s.y, 90); if (!p) continue; const w = 130, v = (s.v + 1) / 2; c.textAlign = 'center'; c.fillStyle = 'rgba(8,9,14,.75)'; c.fillRect(p.x - w / 2, p.y - 11, w, 24); c.fillStyle = '#e9e3d4'; c.fillText(s.name.toUpperCase(), p.x, p.y - 3);
    c.fillStyle = V.colD.main; c.fillRect(p.x - w / 2 + 6, p.y + 7, (w - 12), 3); c.fillStyle = V.colA.main; c.fillRect(p.x - w / 2 + 6, p.y + 7, (w - 12) * v, 3); }
  // with StarShells or RailRifles selected the wall is traced, and the stretch under the cursor lit, so it can be found among the buildings
  if (G.phase === 'battle' && G.map.wl.length && V.sel.some(GR.canBreach)) { const hw = V.hoverG ? GR.wallAt(V.hoverG.x, V.hoverG.z, 40) : -1;
    for (const w of G.map.wl) { const a = gpt(w.x0, w.y0, w.h), b = gpt(w.x1, w.y1, w.h); if (!a || !b) continue; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = w.id === hw ? 'rgba(255,170,60,.95)' : 'rgba(255,170,60,.35)'; c.lineWidth = w.id === hw ? 4 : 2; c.stroke(); } }
  // a stretch of wall under fire: how much of it is left
  for (const w of G.map.wl) { if (!w.hitT || G.t - w.hitT > 4) continue; const p = gpt((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, w.h + 12); if (!p) continue; const bw = 60, k = clamp(w.hp / w.hp0, 0, 1);
    c.fillStyle = 'rgba(8,9,14,.8)'; c.fillRect(p.x - bw / 2 - 2, p.y - 4, bw + 4, 8); c.fillStyle = k > .5 ? '#d8d0bc' : k > .25 ? '#f2c14e' : '#ff5a3c'; c.fillRect(p.x - bw / 2, p.y - 2, bw * k, 4); }
  // orders of the selected units
  for (const u of V.sel) { if (!live(u)) continue;
    if (u.path && u.path.length) { c.beginPath(); let p0 = gpt(u.x, u.y, 1); if (p0) c.moveTo(p0.x, p0.y); for (const q of u.path) { const p = gpt(q.x, q.y, 1); if (p) c.lineTo(p.x, p.y); } c.strokeStyle = u.run ? 'rgba(255,190,90,.8)' : 'rgba(180,230,140,.75)'; c.setLineDash([5, 5]); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
      const e = u.path[u.path.length - 1], fp = footprint(u); if (u.order && u.order.type === 'move') { c.beginPath(); if (rectPath(c, u, e.x, e.y, u.order.a != null ? u.order.a : u.a, fp.w, fp.d)) { c.strokeStyle = 'rgba(180,230,140,.6)'; c.stroke(); } } }
    if (u.order && u.order.type === 'breach') { const w = G.map.walls[u.order.w], a = gpt(u.x, u.y, 2), b = w && gpt((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, w.h * .6); if (a && b) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = 'rgba(255,170,60,.85)'; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.stroke(); c.setLineDash([]); } }
    if (u.T.air && u.order && (u.order.type === 'move' || u.order.type === 'bomb')) { const o = u.order, a = ppt(u, 2), b = gpt(o.x, o.y, 1); if (a && b) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = o.type === 'bomb' ? 'rgba(255,170,60,.85)' : 'rgba(140,200,255,.7)'; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.stroke(); c.setLineDash([]); }
      c.beginPath(); ringPath(c, o.x, o.y, o.type === 'bomb' ? 45 : 650, 48); c.strokeStyle = o.type === 'bomb' ? 'rgba(255,170,60,.8)' : 'rgba(140,200,255,.45)'; c.lineWidth = 1.5; c.stroke(); } // a patrol circles the point; a bomb run's aim
    if (u.target && fighting(u.target)) { const a = ppt(u, 2), b = ppt(u.target, 2); if (a && b) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = 'rgba(255,90,70,.8)'; c.lineWidth = 1.5; c.stroke(); } } }
  // footprints of the selected and the hovered
  for (const u of G.units) { if (!live(u) || u.T.air || u.state === 'rout' && !V.sel.includes(u)) continue; const sel = V.sel.includes(u), hov = V.hover === u; if (!sel && !hov) continue; const fp = footprint(u); c.beginPath(); if (rectPath(c, u, u.x, u.y, u.a, fp.w + 4, fp.d + 4)) { c.strokeStyle = sel ? '#f2c14e' : u.team === 0 ? 'rgba(242,193,78,.6)' : 'rgba(255,90,70,.8)'; c.lineWidth = sel ? 2 : 1.5; c.stroke(); } }
  // the plates over each unit
  const plates = [];
  for (const u of G.units) { if (!live(u) || u.away) continue; const p = u.T.air ? ppt(u, 70) : gpt(u.x, u.y, (u.T.size + 6) * VS + (u.type === 'peerless' && hyp(u.vx, u.vy) > 8 ? 5 : 0)); if (!p || p.x < -40 || p.y < -20 || p.x > innerWidth + 40 || p.y > innerHeight + 20) continue; plates.push([u, p]); }
  const far = V.cam.dist > 3800; // from high up, a marker per cohort instead of a plate
  for (const [u, p] of plates) {
    if (far) { const col = u.team === 0 ? V.colA : V.colD, sel = V.sel.includes(u), r = u.leader ? 5 : 3.5; c.fillStyle = u.state === 'rout' ? '#ffffff' : col.main; c.fillRect(p.x - r, p.y - r, r * 2, r * 2); if (sel) { c.strokeStyle = '#f2c14e'; c.lineWidth = 1.5; c.strokeRect(p.x - r - 2, p.y - r - 2, r * 2 + 4, r * 2 + 4); } u._plate = { x: p.x - 8, y: p.y - 8, w: 16, h: 16 }; continue; }
    const col = u.team === 0 ? V.colA : V.colD, w = 46, h = 15, x = p.x - w / 2, y = p.y - h, sel = V.sel.includes(u), rout = u.state === 'rout';
    c.fillStyle = rout ? (Math.sin(G.t * 10) > 0 ? 'rgba(160,30,20,.9)' : 'rgba(30,8,8,.9)') : 'rgba(8,9,14,.82)'; c.fillRect(x, y, w, h);
    c.fillStyle = col.main; c.fillRect(x, y, 14, h); c.fillStyle = '#0a0c12'; c.textAlign = 'center'; c.fillText(u.leader ? '★' : u.T.glyph, x + 7, y + h / 2 + .5);
    c.fillStyle = rout ? '#ffd0c0' : '#e9e3d4'; c.textAlign = 'left'; c.fillText(rout ? 'ROUT' : u.men >= 1000 ? (u.men / 1000).toFixed(1) + 'k' : String(u.men), x + 17, y + h / 2 + .5);
    const m = u.T.air ? airLoad(u) : clamp(u.morale / 100, 0, 1); c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x, y + h, w, 3); c.fillStyle = u.T.air ? (u.rtb ? '#8fb6d8' : '#cfe8ff') : m > .5 ? '#7fdc6e' : m > .28 ? '#f2c14e' : '#ff5a3c'; c.fillRect(x, y + h, w * m, 3); // an aircraft's bar: what it has left to fire or drop
    if (sel) { c.strokeStyle = '#f2c14e'; c.lineWidth = 1.5; c.strokeRect(x - 1, y - 1, w + 2, h + 5); }
    u._plate = { x, y, w, h: h + 3 };
  }
  // box select, and the line being dragged
  if (V.drag && V.drag.box) { const d = V.drag; c.strokeStyle = '#f2c14e'; c.lineWidth = 1; c.setLineDash([3, 3]); c.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); c.setLineDash([]); }
  if (V.rdrag && V.rdrag.line) { const d = V.rdrag, a = gpt(d.g0.x, d.g0.z, 1), b = gpt(d.g1.x, d.g1.z, 1); if (a && b) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = '#b4e68c'; c.lineWidth = 3; c.stroke(); const m = lineFace(d), mx = (d.g0.x + d.g1.x) / 2, mz = (d.g0.z + d.g1.z) / 2, p = gpt(mx, mz, 1), q = gpt(mx + Math.cos(m) * 40, mz + Math.sin(m) * 40, 1); if (p && q) { c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.lineWidth = 2; c.stroke(); } } }
}

// ---------------------------------------------------------------- the HUD
const STATE = { idle: 'Holding', move: 'Moving', fire: 'Firing', melee: 'In melee', rout: 'ROUTING', fall: 'Falling', dead: 'Destroyed', fled: 'Fled' };
function hud(force) {
  const R0 = V.root, me = 0, A = G.units.filter(u => u.team === 0), D = G.units.filter(u => u.team === 1), str = L => L.reduce((a, u) => a + (live(u) && !u.T.air ? u.men * u.eq : 0), 0);
  R0.querySelector('#gbClock').textContent = G.phase === 'deploy' ? 'Before the Rain' : `${mmss(G.t)} / ${mmss(G.maxT)}`;
  R0.querySelector('#gbSites').innerHTML = G.map.sites.map(s => `<span class="gb-site ${s.own === 0 ? 'own' : 'foe'} ${s.a && s.d ? 'cont' : ''}" style="--c:${s.own === 0 ? V.colA.main : V.colD.main}" title="${esc(s.name)}">${'ABCDE'[s.id]}<i style="width:${Math.round((s.v + 1) / 2 * 100)}%"></i></span>`).join('') + (G.holdT > 0 ? `<span class="gb-hold">Holding ${GR.NEED()} sites · ${Math.ceil(GR.HOLD_WIN - G.holdT)}s</span>` : '');
  const sk = R0.querySelector('#gbStork');
  sk.textContent = G.phase === 'deploy' ? `Storks follow ${G.storkT}s after the first wave` : !G.drop[1].length ? 'No Storks in this drop' : G.storksDone ? (G.units.some(u => u.wave === 1) ? 'The Storks are down' : 'The Storks turned back') : `Storks in ${mmss(G.storkT - G.t)} · they land only on a zone you hold`;
  const a = str(A), d = str(D), tot = Math.max(1, a + d);
  R0.querySelector('#gbStr').innerHTML = `<div class="gb-bar"><i style="width:${a / tot * 100}%;background:${V.colA.main}"></i><i style="width:${d / tot * 100}%;background:${V.colD.main}"></i></div><div class="gb-bl"><span>${esc(V.meta.attName || 'Your legions')} · ${a.toLocaleString()}</span><span>${esc(V.meta.defName || 'The garrison')} · ${d.toLocaleString()}</span></div>`;
  R0.querySelector('#gbPause').classList.toggle('on', !!G.paused); R0.querySelector('#gbSpd').textContent = 'Speed ' + [1, 2, 4][V.speedI] + '×';
  // unit cards: the player's cohorts in the order they landed
  const cards = A.filter(u => !u.gone || V.sel.includes(u)).sort((a, b) => !!a.T.air - !!b.T.air); // the aircraft after the legions
  const sig = cards.map(u => u.id + ':' + u.men + ':' + Math.round(u.morale / 5) + ':' + u.state + ':' + (u.away ? 1 : 0) + ':' + (V.sel.includes(u) ? 1 : 0)).join('|');
  if (force || sig !== V.cardSig) { V.cardSig = sig;
    R0.querySelector('#gbCards').innerHTML = cards.map(u => { const m = clamp(u.morale / 100, 0, 1); return `<div class="gb-card ${V.sel.includes(u) ? 'on' : ''} ${u.state === 'rout' ? 'rout' : ''} ${u.state === 'fall' ? 'fall' : ''}" data-u="${u.id}" title="${esc(u.name)} · ${esc(u.T.role)}">
      <div class="gl" style="background:${V.colA.main}">${u.leader ? '★' : u.T.glyph}</div><div class="nm">${esc(u.leader ? u.cmdr : u.T.short)}</div><div class="mn">${u.state === 'fall' ? 'falling' : u.away ? (isFinite(u.awayT) ? 'rearming' : 'withdrawn') : u.men.toLocaleString()}</div><div class="mb"><i style="width:${m * 100}%;background:${m > .5 ? '#7fdc6e' : m > .28 ? '#f2c14e' : '#ff5a3c'}"></i></div></div>`; }).join(''); }
  // the selected unit (or the first of a group)
  const sel = V.sel.filter(u => !u.gone), el = R0.querySelector('#gbSel');
  if (!sel.length) el.classList.add('hide');
  else if (sel[0].T.air) { el.classList.remove('hide'); const u = sel[0], T = u.T, more = sel.length > 1 ? `<div class="dim">+ ${sel.length - 1} more selected</div>` : '';
    const st = u.away ? (isFinite(u.awayT) ? `Rearming · back in ${Math.max(0, Math.ceil(u.awayT - G.t))} s` : 'Withdrawn: too few left') : u.rtb ? 'Going home to rearm' : u.order ? (u.order.type === 'attack' ? (u.order.t.T.air ? 'Engaging' : T.bombs ? 'Bomb run' : 'Strafing') + ' · your orders' : u.order.type === 'bomb' ? 'Bomb run · your orders' : 'Patrolling · your orders') : u.auto ? (u.auto.type === 'attack' ? (u.auto.t.T.air ? 'Engaging' : 'Strafing') : u.auto.type === 'bomb' ? 'Bomb run' : 'Holding the sky') + ' · on its own' : 'Circling over the army';
    el.innerHTML = `<h3>${esc(u.name)}</h3><div class="role">${esc(T.role)}</div>
      <div class="row"><span>Aircraft</span><b>${u.men} / ${u.men0}</b></div><div class="row"><span>State</span><b>${st}</b></div>
      <div class="row"><span>Altitude</span><b>${Math.round(u.alt)} m · ${Math.round(u.spd * 3.6)} km/h</b></div>
      <div class="row"><span>${esc(u.wpn.name)}</span><b>${u.wpn.airOnly ? 'aircraft only' : u.wpn.range + ' m'} · ${Math.round(clamp(u.ammo / T.ammo, 0, 1) * 100)}%</b></div>
      ${u.wpn2 ? `<div class="row"><span>${esc(u.wpn2.name)}</span><b>${u.ammo2} left</b></div>` : ''}${T.bombs ? `<div class="row"><span>Bombs</span><b>${u.bombs} left</b></div>` : ''}
      <div class="row"><span>Kills</span><b>${u.kills}</b></div>${more}
      <div class="dim">${T.bombs ? 'Right-click an enemy unit or a stretch of wall to bomb it.' : 'Right-click an enemy, in the air or on the ground, to attack it.'} Right-click the ground to patrol over it; H to let it fight on its own; C (or double-click its card) to follow it with the camera. Out of ${T.bombs ? 'bombs' : 'ammunition'}, or half the ${T.bombs ? 'flight' : 'squadron'} lost, it goes home to rearm.</div>`; }
  else { el.classList.remove('hide'); const u = sel[0], w = u.wpn, T = u.T, more = sel.length > 1 ? `<div class="dim">+ ${sel.length - 1} more selected</div>` : '';
    el.innerHTML = `<h3>${esc(u.name)}</h3><div class="role">${esc(T.role)}</div>
      <div class="row"><span>Men</span><b>${u.men.toLocaleString()} / ${u.men0.toLocaleString()}</b></div>
      <div class="row"><span>Morale</span><b class="${u.morale > 50 ? 'good' : u.morale > 28 ? 'gold' : 'bad'}">${Math.round(u.morale)}</b></div>
      <div class="row"><span>State</span><b>${STATE[u.state] || u.state}${u.state === 'move' && u.firing ? ' · firing' : ''}${u.run ? ' · at the run' : ''}${!u.fire ? ' · holding fire' : ''}</b></div>
      <div class="row"><span>${esc(w.name)}</span><b>${w.range} m · AP ${w.ap}</b></div><div class="row"><span>Fire on the move</span><b>${T.fly || u.type === 'starshell' || T.art ? 'full' : Math.round(GR.MOVE_FIRE.walk * 100) + '% walking · ' + Math.round(GR.MOVE_FIRE.run * 100) + '% running'}</b></div>${u.wpn2 ? `<div class="row"><span>${esc(u.wpn2.name)}</span><b>${u.wpn2.range} m · ${u.ammo2} left</b></div>` : ''}
      <div class="row"><span>Armour</span><b>${['', 'cloth', 'duroArmor', 'duroArmor', 'duroArmor', 'plate', 'pulseArmor', 'pulseArmor', 'starShell'][T.armor] || T.armor}${T.shield ? ' · pulseShield ' + Math.round(u.sh / Math.max(1, u.men * T.shield) * 100) + '%' : ''}</b></div>
      <div class="row"><span>Ammunition</span><b>${T.ammo >= 999 ? '—' : Math.round(clamp(u.ammo / T.ammo, 0, 1) * 100) + '%'}</b></div>
      <div class="row"><span>Stamina</span><b>${Math.round(u.stam * 100)}%</b></div>${G.map.walls.length ? `<div class="row"><span>Walls</span><b>${u.wpn.siege || (u.wpn2 && u.wpn2.siege) ? (u.order && u.order.type === 'breach' ? 'breaching' : 'can breach: right-click one') : 'cannot breach'}</b></div>` : ''}
      <div class="row"><span>Kills</span><b>${u.kills}</b></div>${more}
      <div class="gb-ord"><button class="btn ${sel.every(x => x.run) ? 'on' : ''}" data-g="run">Run · R</button><button class="btn ${sel.every(x => !x.fire) ? 'on' : ''}" data-g="fire">Hold fire · F</button><button class="btn" data-g="halt">Halt · H</button></div>`; }
  // the feed
  R0.querySelector('#gbFeed').innerHTML = G.feed.slice(0, 7).map(f => `<div class="${f.cls}"><span>${mmss(f.t)}</span>${esc(f.msg)}</div>`).join('');
}
function airBrief() { // the air, as the battle opens: who has what, and when it comes
  const q = G.airQ || [], c = (t, ty) => q.filter(x => x.team === t && x.type === ty).reduce((a, x) => a + x.men, 0), r0 = c(0, 'ripwing'), b0 = c(0, 'thunderwing'), r1 = c(1, 'ripwing'), b1 = c(1, 'thunderwing');
  if (!r0 && !b0 && !r1 && !b1) return '';
  const w = (r, b) => [r && `<b>${r}</b> ripWings`, b && `<b>${b}</b> thunderWing bombers`].filter(Boolean).join(' and ');
  return `<p>In the air: ${r0 || b0 ? `the fleet sends ${w(r0, b0)} down behind the first wave` : 'the fleet has no aircraft to send'}; ${r1 || b1 ? `the garrison scrambles ${w(r1, b1)} as the Rain begins` : 'the garrison has none'}. They fight for the sky on their own, then strafe and bomb; select them to give them a target.</p>`;
}
function showBrief() {
  const el = V.root.querySelector('#gbBrief'), sp = V.spec, men = G.drop[0].reduce((a, x) => a + x[1], 0), st = G.drop[1].reduce((a, x) => a + x[1], 0), gar = G.units.reduce((a, u) => a + u.men, 0);
  el.classList.remove('hide'); V.modal = false;
  el.innerHTML = `<div class="kicker">${esc(V.meta.date || '')} · ${esc(G.map.B.lore)}</div><h2>The Iron Rain on ${esc(G.map.B.city)}</h2>
    <p>Choose up to <b>${GR.MAXZ} drop zones</b> on the plain: click the ground. The battle is fought at legion scale: ten men for every troop in the campaign. The first wave, <b>${men.toLocaleString()}</b> in starShells and leechCraft, falls on them${sp.att.cmdr ? ` with <b>${esc(sp.att.cmdr)}</b>` : ''}. The <b>${st.toLocaleString()}</b> legionnaires in the Storks follow ${G.storkT} seconds later, and land only on a zone your men still hold.</p>
    <p>The red rings are the <b>Sarissa batteries</b>: the nearer the guns you drop, the more of the Rain dies in the sky. Kill them, and the Storks come down safe.</p>
    <p><b>${gar.toLocaleString()}</b> of the garrison stand to arms in ${esc(G.map.B.city)}${V.meta.garrison ? ` (of ${V.meta.garrison.toLocaleString()}; the rest are pinned by the siege)` : ''}. Hold ${GR.NEED()} of its ${G.map.sites.length} sites for ${GR.HOLD_WIN} seconds, or break the garrison, before ${mmss(G.maxT)} runs out.</p>
    ${airBrief()}
    ${sp.storm ? '<p class="bad">The walls are not yet broken: only half the drop reaches the ground in fighting order.</p>' : ''}
    ${G.map.walls.length ? '<p>A <b>wall</b> rings the heart of the city, with eight gates. Your <b>StarShells</b> can bring a stretch of it down in a minute or two of fire, the <b>RailRifles</b> more slowly: select them, and the wall is traced in orange; right-click it.</p>' : ''}
    <div class="gb-bb"><button class="btn" data-g="autoz">Pick zones for me</button><button class="btn go" data-g="rain" id="gbRain">Drop the Rain ▸</button></div>`;
}
function showEnd() {
  const r = GR.result(), el = V.root.querySelector('#gbEnd'), won = r.won;
  el.classList.remove('hide'); V.modal = true;
  el.innerHTML = `<div class="kicker">${mmss(r.t)} on the ground</div><h2 class="${won ? 'good' : 'bad'}">${won ? esc(G.map.B.city) + ' is taken' : 'The Rain is thrown back'}</h2><p>${esc(r.why)}</p>
    <div class="gb-stats"><div><i>Lost in the sky</i><b>${r.sky.toLocaleString()}</b></div><div><i>Your legions left</i><b>${r.attLeft.toLocaleString()}</b></div><div><i>Garrison killed</i><b>${r.killed[0].toLocaleString()}</b></div><div><i>Garrison left</i><b>${r.defLeft.toLocaleString()}</b></div></div>
    <p class="dim">${r.sites.map(s => `${esc(s.name)}: ${s.own === 0 ? 'yours' : 'theirs'}`).join(' · ')}</p>
    ${r.air0 && (r.air0[0] || r.air0[1]) ? `<p class="dim">In the air: you lost ${r.air0[0] - r.air[0]} of ${r.air0[0]} aircraft; the garrison lost ${r.air0[1] - r.air[1]} of ${r.air0[1]}.</p>` : ''}
    <div class="gb-bb"><button class="btn go" data-g="done">Return to the campaign ▸</button></div>`;
}

// ---------------------------------------------------------------- input
function groundAt(mx, my) { // march the ray to the ground
  const v = new THREE.Vector3((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1, .5).unproject(V.camera), o = V.camera.position, d = v.sub(o).normalize();
  let lo = 0, hi = null; for (let t = 5; t < 9000; t += 12) { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; if (y <= heightAt(clamp(x, 0, MAP), clamp(z, 0, MAP))) { hi = t; break; } lo = t; }
  if (hi == null) return null; for (let k = 0; k < 12; k++) { const t = (lo + hi) / 2, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; if (y <= heightAt(clamp(x, 0, MAP), clamp(z, 0, MAP))) hi = t; else lo = t; }
  const t = hi; return { x: o.x + d.x * t, z: o.z + d.z * t };
}
function unitAt(mx, my, team) {
  let best = null, bd = Infinity;
  for (const u of G.units) { if (!live(u) || u.away || (team != null && u.team !== team)) continue;
    const pl = u._plate; if (pl && mx >= pl.x && mx <= pl.x + pl.w && my >= pl.y && my <= pl.y + pl.h) return u;
    const air = u.T.air, p = ppt(u, 1), q = air ? toScreen(u.x + 120, airY(u), u.y) : gpt(u.x + radiusOf(u), u.y, 1); if (!p) continue; const r = Math.max(air ? 18 : 12, q ? hyp(q.x - p.x, q.y - p.y) : 12), d = hyp(p.x - mx, p.y - my); if (d < r && d < bd) { bd = d; best = u; } }
  return best;
}
const mine = () => G.units.filter(u => u.team === 0 && live(u) && !u.away && u.state !== 'rout');
function lineFace(d) { // a dragged line faces away from where the units stand now
  const a = Math.atan2(d.g1.z - d.g0.z, d.g1.x - d.g0.x), f1 = a - PI / 2, f2 = a + PI / 2, sel = V.sel.filter(u => live(u)), cx = sel.length ? sel.reduce((s, u) => s + u.x, 0) / sel.length : d.g0.x, cz = sel.length ? sel.reduce((s, u) => s + u.y, 0) / sel.length : d.g0.z - 100;
  const mx = (d.g0.x + d.g1.x) / 2, mz = (d.g0.z + d.g1.z) / 2, vx = mx - cx, vz = mz - cz; return Math.cos(f1) * vx + Math.sin(f1) * vz > 0 ? f1 : f2;
}
function bindInput() {
  const ov = V.ov;
  ov.addEventListener('contextmenu', e => e.preventDefault());
  ov.addEventListener('mousedown', e => {
    if (!V.on || V.modal) return; const mx = e.clientX, my = e.clientY;
    if (e.button === 0) V.drag = { x0: mx, y0: my, x1: mx, y1: my, box: false, shift: e.shiftKey };
    else if (e.button === 2) { const g = groundAt(mx, my); if (g) V.rdrag = { x0: mx, y0: my, g0: g, g1: g, line: false }; }
    else if (e.button === 1) { e.preventDefault(); V.orbit = { x: mx, y: my, yaw: V.cam.yaw, pitch: V.cam.pitch }; }
  });
  addEventListener('mousemove', e => {
    if (!V.on) return; const mx = e.clientX, my = e.clientY; V.mouse.x = mx; V.mouse.y = my;
    if (V.drag) { V.drag.x1 = mx; V.drag.y1 = my; if (hyp(mx - V.drag.x0, my - V.drag.y0) > 6) V.drag.box = true; }
    if (V.rdrag) { const g = groundAt(mx, my); if (g) { V.rdrag.g1 = g; if (hyp(g.x - V.rdrag.g0.x, g.z - V.rdrag.g0.z) > 14) V.rdrag.line = true; } }
    if (V.orbit) { V.cam.yaw = V.orbit.yaw - (mx - V.orbit.x) * .006; V.cam.pitch = clamp(V.orbit.pitch + (my - V.orbit.y) * .004, .12, 1.45); }
    if (e.target === V.ov) { V.hover = unitAt(mx, my); V.hoverG = G.phase === 'deploy' || (G.map.wl.length && V.sel.some(GR.canBreach)) ? groundAt(mx, my) : null; }
  });
  addEventListener('mouseup', e => {
    if (!V.on) return; const mx = e.clientX, my = e.clientY;
    if (e.button === 1) V.orbit = null;
    if (e.button === 0 && V.drag) { const d = V.drag; V.drag = null; if (V.modal) return;
      if (G.phase === 'deploy') { if (!d.box) { const g = groundAt(mx, my); if (g) { const er = GR.addZone(g.x, g.z); if (er) toast(er); else sfx('click'); } } return; }
      if (d.box) { const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1); const got = mine().filter(u => { const p = ppt(u, 2); return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }); V.sel = d.shift ? [...new Set(V.sel.concat(got))] : got; if (got.length) sfx('sel'); }
      else { const u = unitAt(mx, my, 0); if (u) { if (d.shift) V.sel = V.sel.includes(u) ? V.sel.filter(x => x !== u) : V.sel.concat(u); else V.sel = [u]; sfx('sel'); } else if (!d.shift) V.sel = []; }
      hud(true); }
    if (e.button === 2 && V.rdrag) { const d = V.rdrag; V.rdrag = null; if (V.modal || G.phase !== 'battle') return; const sel = V.sel.filter(u => live(u) && u.state !== 'rout'); if (!sel.length) return;
      const now = performance.now(), dbl = now - (V.lastR || 0) < 320; V.lastR = now;
      const foe = !d.line && unitAt(mx, my, 1), wid = !d.line && G.map.wl.length ? GR.wallAt(d.g0.x, d.g0.z, 40) : -1;
      // the aircraft: fighters attack what was clicked, in the air or on the ground; bombers bomb what was clicked, a stretch of
      // wall included; on open ground both patrol over the point (a fighter cannot hover, a bomber needs a target)
      const air = sel.filter(u => u.T.air); if (air.length) { sel.splice(0, sel.length, ...sel.filter(u => !u.T.air));
        for (const u of air) { if (foe && !(u.T.bombs && foe.T.air)) GR.order(u, { type: 'attack', t: foe }); else if (u.T.bombs && wid >= 0) { const w = G.map.walls[wid]; GR.order(u, { type: 'bomb', x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 }); } else GR.order(u, { type: 'move', x: d.line ? (d.g0.x + d.g1.x) / 2 : d.g0.x, y: d.line ? (d.g0.z + d.g1.z) / 2 : d.g0.z }); }
        if (!sel.length) { sfx('ack'); hud(true); return; } }
      if (foe && foe.T.air) { toast('Men on the ground cannot chase aircraft: those with the guns for it fire as it passes'); return; }
      if (foe) { for (const u of sel) GR.order(u, { type: 'attack', t: foe, run: dbl || u.run }); sfx('ack'); hud(true); return; }
      const siege = wid >= 0 ? sel.filter(GR.canBreach) : [];
      if (siege.length) { for (const u of siege) GR.order(u, { type: 'breach', w: wid, run: dbl || undefined }); const rest = sel.filter(u => !siege.includes(u)); if (rest.length) GR.groupMove(rest, d.g0.x, d.g0.z, null, dbl ? true : undefined);
        toast(siege.length === 1 ? `${siege[0].name}: on the wall` : `${siege.length} units open fire on the wall`); sfx('ack'); hud(true); return; }
      if (d.line) { const w = hyp(d.g1.x - d.g0.x, d.g1.z - d.g0.z); GR.groupMove(sel, (d.g0.x + d.g1.x) / 2, (d.g0.z + d.g1.z) / 2, lineFace(d), dbl || undefined, w); }
      else GR.groupMove(sel, d.g0.x, d.g0.z, null, dbl ? true : undefined);
      sfx('ack'); hud(true); }
  });
  ov.addEventListener('wheel', e => { if (!V.on) return; e.preventDefault(); V.cam.dist = clamp(V.cam.dist * Math.pow(1.0015, e.deltaY), 35, 9000); }, { passive: false });
  addEventListener('keydown', e => {
    if (!V.on || S.gameState !== 'ground') return; const k = e.key.toLowerCase();
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    V.keys[k] = true;
    if (V.modal) return;
    if (k === ' ') { e.preventDefault(); if (G.phase === 'battle') G.paused = !G.paused; hud(true); }
    else if (k === 'r') { const on = !V.sel.every(u => u.run); for (const u of V.sel) u.run = on; hud(true); }
    else if (k === 'f') { const on = !V.sel.every(u => !u.fire); for (const u of V.sel) u.fire = !on; hud(true); }
    else if (k === 'h') { for (const u of V.sel) GR.order(u, { type: 'halt' }); hud(true); }
    else if (k === 'c') { const u = V.sel[0]; if (V.cam.follow || !u) V.cam.follow = null; else follow(u); hud(true); }
    else if (k === 'escape') { V.sel = []; hud(true); }
    else if (k === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); V.sel = mine(); hud(true); }
  });
  addEventListener('keyup', e => { if (V) V.keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { if (V) V.keys = {}; });
  V.root.addEventListener('click', e => {
    const b = e.target.closest('[data-g],[data-u]'); if (!b) return;
    if (b.dataset.u) { const u = G.units.find(x => x.id === +b.dataset.u); if (!u) return; if (e.shiftKey) V.sel = V.sel.includes(u) ? V.sel.filter(x => x !== u) : V.sel.concat(u); else V.sel = [u]; if (e.detail > 1 && u.state !== 'fall') { if (u.T.air) follow(u); else { V.cam.tx = u.x; V.cam.tz = u.y; } V.cam.dist = Math.min(V.cam.dist, u.T.air ? 900 : 700); } hud(true); return; }
    const g = b.dataset.g;
    if (g === 'autoz') { GR.aiZones(); sfx('click'); }
    else if (g === 'rain') { if (!G.zones.length) GR.aiZones(); V.root.querySelector('#gbBrief').classList.add('hide'); GR.beginRain(); GR.start(0); sfx('alarm'); const z = G.zones[0]; if (z) Object.assign(V.cam, { tx: z.x, tz: z.y, dist: 2000, pitch: .5 }); hud(true); }
    else if (g === 'pause') { if (G.phase === 'battle') G.paused = !G.paused; hud(true); }
    else if (g === 'spd') { V.speedI = (V.speedI + 1) % 3; G.speed = [1, 2, 4][V.speedI]; hud(true); }
    else if (g === 'run') { const on = !V.sel.every(u => u.run); for (const u of V.sel) u.run = on; hud(true); }
    else if (g === 'fire') { const on = !V.sel.every(u => !u.fire); for (const u of V.sel) u.fire = !on; hud(true); }
    else if (g === 'halt') { for (const u of V.sel) GR.order(u, { type: 'halt' }); hud(true); }
    else if (g === 'quit') { if (G.over || G.phase !== 'battle') return; // a second click within three seconds confirms (an artifact's frame may block confirm())
      if (V.quitT && performance.now() - V.quitT < 3000) { V.quitT = 0; b.textContent = 'Abandon'; GR.finish(1, 'The assault is abandoned: the legions on the ground are left to the garrison.'); }
      else { V.quitT = performance.now(); b.textContent = 'Click again to abandon'; setTimeout(() => { if (V.quitT && performance.now() - V.quitT >= 2900) { V.quitT = 0; b.textContent = 'Abandon'; } }, 3000); } }
    else if (g === 'done') { const r = GR.result(); teardown(); const res = V.resolve; V.resolve = null; res && res(r); }
  });
}
function follow(u) { if (u.away) return; V.cam.follow = u; toast(`Following ${u.name}: W A S D or C to let go`); }
function toast(msg) { const el = document.createElement('div'); el.className = 'gb-toast'; el.textContent = msg; V.root.appendChild(el); setTimeout(() => el.remove(), 1800); }
