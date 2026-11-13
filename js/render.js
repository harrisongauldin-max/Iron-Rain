// Three.js renderer. The game runs on a 2D plane; this draws it in 3D under a fixed-tilt perspective camera.
// World (x, y, height) → render (x − O.x, height, y − O.y), with a floating origin O at the camera target so
// 32-bit GPU coordinates stay exact anywhere on a 160-million-unit map.
// A 2D canvas laid over the 3D view carries the UI marks: rings, bars, labels, orders and tokens.
// WebGPU: Three's WebGPURenderer, falling back by itself to its WebGL2 backend where the browser has no WebGPU.
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from '../vendor/three/tsl/BloomNode.js';
import { smaa } from '../vendor/three/tsl/SMAANode.js';
import { loadGfx, preset, meterTick, gpuTimer } from './gfx.js';
import { HAS_3D, buildHull, hullTextures, paintOf, buildStation, missileGeoOf, missileMaterial, MISSILE_M , planetGeo } from './hulls.js';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { buildSlip, ganymedeDocks, venusDocks, phobosTraffic } from './yards.js';
import { S } from './state.js';
import { SHAPES, BODIES, ICON_SCALE, DEFS, fshape, HULL_REF, M_TO_UNITS, FACTIONS, NEUTRAL_C } from './data.js';
import { C as CAMP, BLOCS } from './camp.js';
import { TAU, PI, rand, clamp, hyp, hex, angDiff } from './util.js';
import { grav } from './physics.js';
import { disabled, mainAmmo, needsService, groupList, defaultRally, worldUnderAttack, nukesOf } from './sim.js';
import { generate, HI } from './planetgen.js';
import { AU } from './solar.js';
import { FOV, SE, CE, ELEV, AZ, setView, camDist, camOffset, screenAng, toWorld, projectTo, onScr, footprint } from './cam.js';
export { toWorld, project } from './cam.js';

let renderer, scene, camera, composer, bloomPass, ov, ctx, DPR = 1, ODPR = 1; // composer: the post-processing RenderPipeline; bloomPass: its bloom node
let bgMesh, bodiesG, orbitL = [], rocksG, debrisM, shipsG, turretM = {}, missileM = {}, B = {}, dustM = [];
// the dust sheets fade in as the view pulls out to the system: the Belt below z .003, the Kuiper belt below 4e-4
function beltDust(sunP, z, on) { const ks = [clamp((.003 - z) / .0015, 0, 1), clamp((4e-4 - z) / 2e-4, 0, 1)];
  dustM.forEach((m, i) => { const k = on ? ks[i] : 0; m.visible = k > 0; if (!m.visible) return; m.position.copy(sunP); m.material.uniforms.k.value = k; }); }
let nodesRef = null, fieldsRef = null, bodyVerSeen = -1, bodyVis = [], rockGroups = [];
const O = { x: 0, y: 0 };
const shipVis = new Map(), structVis = new Map();
const TEX = {}, GEO = {}, MAT = {};
const Q = { x: 0, y: 0, k: 0, ok: false };

// ---------------------------------------------------------------- colour helpers
const lin = (() => { const cache = new Map(); return h => { let v = cache.get(h); if (!v) { const c = new THREE.Color(h); v = [c.r, c.g, c.b]; cache.set(h, v); } return v; }; })();
const css = (() => { const cache = new Map(); return h => { let v = cache.get(h); if (!v) { v = '#' + (h >>> 0).toString(16).padStart(6, '0'); cache.set(h, v); } return v; }; })();

// ---------------------------------------------------------------- canvas factories
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function tex(c, o = {}) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = o.aniso || 4; if (o.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (o.wrapS) t.wrapS = THREE.RepeatWrapping; return t; }
function radial(size, stops) { const [c, g] = canvas(size, size), h = size / 2; const gr = g.createRadialGradient(h, h, 0, h, h, h); for (const [k, a] of stops) gr.addColorStop(k, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(0, 0, size, size); return c; }
function streakC() { const [c, g] = canvas(128, 16); const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.75, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 8); g.lineTo(120, 3); g.lineTo(128, 8); g.lineTo(120, 13); g.closePath(); g.fill(); return c; }
function plumeC() { // a torch drive: a white-hot throat with shock diamonds, into a long narrow tail that tapers and fades; the batch tints the tail per team
  const [c, g] = canvas(512, 64); const gr = g.createLinearGradient(512, 0, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.06, 'rgba(255,245,235,.9)'); gr.addColorStop(.18, 'rgba(255,230,210,.5)'); gr.addColorStop(.4, 'rgba(255,210,190,.2)'); gr.addColorStop(.7, 'rgba(255,195,175,.07)'); gr.addColorStop(1, 'rgba(255,180,160,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(512, 18); g.quadraticCurveTo(440, 12, 360, 16); g.quadraticCurveTo(200, 22, 0, 29); g.lineTo(0, 35); g.quadraticCurveTo(200, 42, 360, 48); g.quadraticCurveTo(440, 52, 512, 46); g.closePath(); g.fill(); // flares just past the bell, then a pencil by the end
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) { const x = 478 - i * 36, w = 14 - i * 1.6, a = .6 - i * .09; const d = g.createRadialGradient(x, 32, 0, x, 32, w); d.addColorStop(0, `rgba(255,255,255,${a})`); d.addColorStop(.5, `rgba(255,255,255,${a * .35})`); d.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = d; g.fillRect(x - w * 1.6, 32 - w, w * 3.2, w * 2); } // shock diamonds
  const core = g.createLinearGradient(512, 0, 120, 0); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(.3, 'rgba(255,255,255,.7)'); core.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = core; g.beginPath(); g.moveTo(512, 27); g.quadraticCurveTo(300, 29, 120, 32); g.quadraticCurveTo(300, 35, 512, 37); g.fill(); // the hot filament down the middle
  return c;
}
// a fireball: a noisy, soft-edged blob; drawn additive, white-hot shrinking to orange as it fades
function fireC() { const [c, g] = canvas(256, 256), R = seeded(17); g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) { const d = R() * 70, a = R() * Math.PI * 2, r = 16 + R() * 44 * (1 - d / 110), x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, k = .3 + R() * .4; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${k})`); gr.addColorStop(.4, `rgba(255,255,255,${k * .4})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 14; i++) { const a = R() * Math.PI * 2, L = 60 + R() * 60, w = 6 + R() * 10; g.save(); g.translate(128, 128); g.rotate(a); const gr = g.createLinearGradient(0, 0, L, 0); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(.6, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(10, -w); g.quadraticCurveTo(L * .6, -w * .4, L, 0); g.quadraticCurveTo(L * .6, w * .4, 10, w); g.closePath(); g.fill(); g.restore(); } // tongues rolling outward
  const core = g.createRadialGradient(128, 128, 0, 128, 128, 70); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(.35, 'rgba(255,255,255,.6)'); core.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = core; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 18; i++) { const a = R() * Math.PI * 2, d = 30 + R() * 60, r = 8 + R() * 18, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); } // dark gaps between the tongues
  return c; }
// smoke: a puffy cluster, soft-edged, that turns as it drifts
function smokeC() { const [c, g] = canvas(128, 128), R = seeded(23);
  for (let i = 0; i < 22; i++) { const d = R() * 34, a = R() * Math.PI * 2, r = 14 + R() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, k = .25 + R() * .3; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${k})`); gr.addColorStop(.5, `rgba(255,255,255,${k * .45})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const fade = g.createRadialGradient(64, 64, 0, 64, 64, 64); fade.addColorStop(0, 'rgba(255,255,255,1)'); fade.addColorStop(.7, 'rgba(255,255,255,.8)'); fade.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = 'destination-in'; g.fillStyle = fade; g.fillRect(0, 0, 128, 128);
  return c; }
// a thin shock ring with a soft outer skirt
function shockC() { const [c, g] = canvas(256, 256); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.86, 'rgba(255,255,255,0)'); gr.addColorStop(.92, 'rgba(255,255,255,.9)'); gr.addColorStop(.96, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return c; }
// a shield cell: a hexagonal tile with bright edges, flashed where a shot lands
function hexC() { const [c, g] = canvas(128, 128), r = 14, h = r * Math.sqrt(3) / 2; const fade = g.createRadialGradient(64, 64, 0, 64, 64, 64); fade.addColorStop(0, 'rgba(255,255,255,1)'); fade.addColorStop(.55, 'rgba(255,255,255,.5)'); fade.addColorStop(1, 'rgba(255,255,255,0)');
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6;
  for (let row = -5; row <= 5; row++) for (let col = -5; col <= 5; col++) { const x = 64 + col * r * 3 + (row % 2 ? r * 1.5 : 0), y = 64 + row * h; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; k ? g.lineTo(x + Math.cos(a) * r * .92, y + Math.sin(a) * r * .92) : g.moveTo(x + Math.cos(a) * r * .92, y + Math.sin(a) * r * .92); } g.closePath(); g.stroke(); g.fillStyle = 'rgba(255,255,255,.12)'; g.fill(); }
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = fade; g.fillRect(0, 0, 128, 128); return c; }
// a spark: a short hot streak, bright at the head
function sparkC() { const [c, g] = canvas(64, 8); const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.6, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 4); g.lineTo(58, 1); g.lineTo(64, 4); g.lineTo(58, 7); g.closePath(); g.fill(); return c; }
// the sun's glare: a soft disc with a brighter core and faint rays
function flareC() { const [c, g] = canvas(256, 256); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.08, 'rgba(255,255,255,.75)'); gr.addColorStop(.25, 'rgba(255,255,255,.22)'); gr.addColorStop(.6, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI + .2, L = 80 + (i % 3) * 40; g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(128 - Math.cos(a) * L, 128 - Math.sin(a) * L); g.lineTo(128 + Math.cos(a) * L, 128 + Math.sin(a) * L); g.stroke(); } return c; }
// a missile: the body is a shaded cylinder with a nose cone and a nozzle (tinted a pale grey); the fins and the band round
// the waist are a second sprite the batch tints in the team's colour
function missileC() { const [c, g] = canvas(64, 16);
  const body = g.createLinearGradient(0, 3, 0, 13); body.addColorStop(0, 'rgba(120,124,130,1)'); body.addColorStop(.35, 'rgba(255,255,255,1)'); body.addColorStop(.6, 'rgba(225,228,232,1)'); body.addColorStop(1, 'rgba(90,94,100,1)');
  g.fillStyle = body; g.beginPath(); g.moveTo(64, 8); g.lineTo(50, 3.5); g.lineTo(8, 3.5); g.lineTo(6, 5); g.lineTo(6, 11); g.lineTo(8, 12.5); g.lineTo(50, 12.5); g.closePath(); g.fill(); // cone, body, boat-tail
  g.fillStyle = 'rgba(40,42,46,1)'; g.fillRect(2, 5.5, 5, 5); g.fillStyle = 'rgba(255,200,150,1)'; g.fillRect(2, 6.5, 2, 3); // the nozzle, hot inside
  g.fillStyle = 'rgba(60,62,66,.9)'; g.fillRect(44, 3.5, 1.5, 9); g.fillRect(14, 3.5, 1.5, 9); // panel lines
  return c; }
function finsC() { const [c, g] = canvas(64, 16); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(16, 3.5); g.lineTo(6, 0); g.lineTo(6, 3.5); g.closePath(); g.fill(); g.beginPath(); g.moveTo(16, 12.5); g.lineTo(6, 16); g.lineTo(6, 12.5); g.closePath(); g.fill(); // tail fins
  g.beginPath(); g.moveTo(40, 3.5); g.lineTo(36, 1.5); g.lineTo(36, 3.5); g.closePath(); g.fill(); g.beginPath(); g.moveTo(40, 12.5); g.lineTo(36, 14.5); g.lineTo(36, 12.5); g.closePath(); g.fill(); // canards
  g.fillRect(24, 3.5, 5, 9); g.fillRect(50, 4.5, 3, 7); return c; } // the band, and the seeker ring behind the cone
function hullPath(g, pts, k) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)); g.closePath(); }
export const WINGS = []; let WF = 0; // wing icons drawn this frame, in screen pixels, for picking
const MISSILE_X = 150; // missiles drawn this many times their real size
const HAND0 = 3.5, HAND1 = 14; // icon to hull hand-off, in pixels of hull half-length
const vrOf = s => s.def.vr0 && !s.def.static ? s.def.vr0 * (S.hullX || HULL_REF) / HULL_REF : s.r;
const R0 = type => DEFS[type].r0 ?? DEFS[type].r; // a hull's detailing follows its class, not its hit circle
const hullK = type => { const K = clamp(R0(type) * 2.4, 30, 400); return [K, Math.ceil(K * 2.9) + 8]; };
// the deck plating: the old top-down art, now laid over the top face of an extruded hull. A second canvas holds
// what glows: windows, trim and the team stripe.
function hullTex(type, col, fac) {
  const d = DEFS[type], [K, size] = hullK(type);
  const [c, g] = canvas(size, size), [ce, e] = canvas(size, size); g.translate(size / 2, size / 2); e.translate(size / 2, size / 2);
  e.fillStyle = '#000'; e.fillRect(-size, -size, size * 2, size * 2);
  const pts = fshape(type, fac); const rnd = seeded(type.length * 977 + col.main.charCodeAt(2) * 31 + 7);
  g.fillStyle = col.hull1; g.fillRect(-size, -size, size * 2, size * 2);
  hullPath(g, pts, K); const hg = g.createLinearGradient(0, -K, 0, K); hg.addColorStop(0, col.hull2); hg.addColorStop(.5, col.hull1); hg.addColorStop(1, '#1a171a'); g.fillStyle = hg; g.fill();
  g.save(); hullPath(g, pts, K); g.clip();
  const panels = Math.round(14 + R0(type) * 1.6);
  for (let i = 0; i < panels * 2; i++) { const w = (.08 + rnd() * .22) * K, h = (.04 + rnd() * .12) * K; const x = (rnd() * 2.4 - 1.2) * K, y = (rnd() * 2 - 1) * K; g.fillStyle = rnd() < .5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.2)'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x, y, w, 1); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h); } // bevelled plates
  for (let i = 0; i < panels; i++) { const x = (rnd() * 2 - 1) * K, y = (rnd() * 1.6 - .8) * K, k = rnd(); // hatches, vents and conduits
    if (k < .4) { g.fillStyle = '#404044'; g.fillRect(x, y, K * .03, K * .03); } else if (k < .7) { for (let j = 0; j < 3; j++) { g.fillStyle = j % 2 ? '#2a2a2e' : '#6a6a70'; g.fillRect(x, y + j * 1.5, K * .05, 1); } } else { g.fillStyle = '#5a5a60'; g.fillRect(x, y, K * (.1 + rnd() * .3), 1.5); } }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = Math.max(1, K * .008); for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(i * K * .2, -K); g.lineTo(i * K * .2, K); g.stroke(); }
  for (const cx of [g, e]) { cx.strokeStyle = col.main; cx.globalAlpha = cx === e ? .9 : .55; cx.lineWidth = Math.max(1.2, K * .03); cx.beginPath(); cx.moveTo(-K * .9, 0); cx.lineTo(K * 1.15, 0); cx.stroke(); if (R0(type) > 30) for (const yy of [.28, -.28]) { cx.beginPath(); cx.moveTo(-K * .7, yy * K); cx.lineTo(K * .45, yy * K); cx.stroke(); } cx.globalAlpha = 1; }
  if (R0(type) > 14) { const n = Math.round(R0(type) * 1.1); for (let i = 0; i < n; i++) { const x = (rnd() * 1.8 - .9) * K, y = (rnd() * 1.2 - .6) * K, a = .3 + rnd() * .6, w = Math.max(1.5, K * .018); for (const cx of [g, e]) { cx.fillStyle = col.light; cx.globalAlpha = a; cx.fillRect(x, y, w, w); } } g.globalAlpha = e.globalAlpha = 1; }
  if (d.hangar) { g.fillStyle = '#050506'; g.strokeStyle = col.main; g.lineWidth = Math.max(1, K * .012); for (const yy of [.3, -.3]) { g.fillRect(-K * .3, yy * K - K * .04, K * .55, K * .08); g.strokeRect(-K * .3, yy * K - K * .04, K * .55, K * .08); e.strokeStyle = col.main; e.lineWidth = Math.max(1, K * .012); e.strokeRect(-K * .3, yy * K - K * .04, K * .55, K * .08); } }
  if (type === 'hauler') { g.strokeStyle = col.main; g.lineWidth = Math.max(1, K * .04); g.strokeRect(-K * .6, -K * .45, K, K * .9); }
  if (type === 'tender') { g.fillStyle = 'rgba(242,193,78,.45)'; g.fillRect(-K * .75, -K * .45, K * .4, K * .9); g.fillRect(-K * .25, -K * .45, K * .4, K * .9); }
  if (type === 'scout') { for (const cx of [g, e]) { cx.strokeStyle = '#7ff3ff'; cx.globalAlpha = .8; cx.lineWidth = Math.max(1, K * .04); cx.beginPath(); cx.arc(K * .2, 0, K * .18, 0, TAU); cx.stroke(); cx.globalAlpha = 1; } }
  if (type === 'moonbreaker' || type === 'dread') { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(K * .7, -K * .05, K * .6, K * .1); }
  g.restore();
  for (const cx of [g, e]) { hullPath(cx, pts, K); cx.strokeStyle = col.main; cx.lineWidth = Math.max(1.5, K * .035); cx.globalAlpha = cx === e ? .75 : 1; cx.stroke(); cx.globalAlpha = 1; }
  return [tex(c), tex(ce)];
}
function ringTexC() { // Saturn // Saturn's rings across the radius: the translucent C ring, the bright B ring full of fine ringlets, the Cassini Division, the A ring with the Encke gap, the thin F ring beyond
  const N = 2048, [c, g] = canvas(N, 8), rnd = seeded(91), A = new Float32Array(N), K = new Float32Array(N);
  for (let x = 0; x < N; x++) { const f = x / N; let a, k = 1;
    if (f < .2) { a = .1 + .12 * f / .2 + .05 * Math.sin(f * 140); k = .82; } // C ring: dim, grey-tan
    else if (f < .6) { a = .78 + .14 * Math.sin((f - .2) * 60) * Math.sin(f * 230); k = 1 + .05 * Math.sin(f * 75); } // B ring
    else if (f < .67) { a = .05 + .06 * Math.sin((f - .6) / .07 * Math.PI) ** 4; k = .8; } // Cassini Division, a faint ringlet inside it
    else if (f < .93) { a = .5 + .12 * (f - .67) / .26 + .06 * Math.sin(f * 180); k = .96; if (Math.abs(f - .89) < .004) a *= .08; if (Math.abs(f - .925) < .002) a *= .3; } // A ring, the Encke and Keeler gaps
    else { a = .015; k = .7; if (Math.abs(f - .965) < .0025) a = .3; } // the F ring
    A[x] = a; K[x] = k; }
  for (let i = 0; i < 260; i++) { const x0 = rnd() * N | 0, w = 1 + rnd() * (rnd() < .15 ? 30 : 7) | 0, d = (rnd() - .5) * .3; for (let x = x0; x < Math.min(N, x0 + w); x++) A[x] *= 1 + d; } // ringlets of random width and density
  const S = new Float32Array(N); for (let x = 0; x < N; x++) { let t = 0, n = 0; for (let j = -2; j <= 2; j++) { const y = x + j; if (y >= 0 && y < N) { t += A[y]; n++; } } S[x] = t / n; } // a touch of blur against moiré at a distance
  for (let x = 0; x < N; x++) { const a = clamp(S[x], 0, .95), k = K[x] * (.92 + .08 * Math.sin(x / N * 31)); g.fillStyle = `rgba(${232 * k | 0},${212 * k | 0},${168 * k | 0},${a})`; g.fillRect(x, 0, 1, 8); }
  return c;
}
// the other giants' rings are faint and dark, and seen mostly by the dust in them. Each painter maps r0..r1 planet radii across the width;
// the height is azimuth (0..1 round the ring) so a ring can vary round its circuit, as Neptune's Adams ring does
const ringProfile = (N, H, col, f) => { const [c, g] = canvas(N, H); for (let y = 0; y < H; y++) for (let x = 0; x < N; x++) { const [a, k = 1] = f(x / N, y / H); if (a <= 0) continue; g.fillStyle = `rgba(${col[0] * k | 0},${col[1] * k | 0},${col[2] * k | 0},${clamp(a, 0, .95)})`; g.fillRect(x, y, 1, 1); } return c; };
const gauss = (f, c, w) => Math.exp(-(((f - c) / w) ** 2));
function jupiterRingC() { // 1.25..2.6 R: the halo climbing to the main ring, the main ring with its bright outer edge at 1.81, the gossamer rings fading beyond
  return ringProfile(1024, 4, [205, 178, 160], f => { const r = 1.25 + f * 1.35; let a = 0;
    if (r > 1.29 && r < 1.72) a = .012 + .05 * ((r - 1.29) / .43) ** 2.2;
    if (r >= 1.72 && r < 1.812) a = .1 + .07 * (r - 1.72) / .09 + .1 * gauss(r, 1.806, .006);
    if (r >= 1.812 && r < 2.55) a = .03 * (1 - (r - 1.812) / .74) ** 1.3 + .01 * (r < 2.1 ? 1 : 0);
    return [a, .95 + .05 * Math.sin(f * 90)]; }); }
function uranusRingC() { // 1.4..2.1 R: thirteen narrow charcoal rings (6, 5, 4, α, β, η, γ, δ, λ, ε) over the broad faint ζ sheet; ε the widest and brightest, at 2.0
  const R = [[1.637, .007, .2], [1.652, .007, .22], [1.666, .007, .2], [1.75, .009, .32], [1.787, .009, .34], [1.846, .006, .16], [1.863, .007, .3], [1.89, .008, .3], [1.957, .005, .14], [2.001, .014, .6]];
  return ringProfile(1024, 4, [150, 150, 160], f => { const r = 1.4 + f * .7; let a = .012 * gauss(r, 1.52, .09); for (const [c, w, k] of R) a += k * gauss(r, c, w); return [a, 1]; }); }
function neptuneRingC() { // 1.6..2.7 R: Galle broad and faint, Le Verrier narrow, the Lassell sheet out to Arago, and the Adams ring with its three bright arcs (Liberté, Égalité, Fraternité, and the knot Courage)
  const arcs = [[.5, .022, 1], [.545, .016, .9], [.585, .02, .95], [.61, .006, .5]]; // azimuth, half-width, strength
  return ringProfile(1024, 512, [200, 172, 160], (f, az) => { const r = 1.6 + f * 1.1; let a = .035 * gauss(r, 1.692, .045) + .19 * gauss(r, 2.148, .005) + .025 * (r > 2.15 && r < 2.31 ? 1 : 0) + .06 * gauss(r, 2.31, .005);
    let adams = .12; for (const [c, w, k] of arcs) adams += .36 * k * Math.max(0, 1 - Math.abs(az - c) / w); a += adams * gauss(r, 2.541, .005); return [a, 1]; }); }
// which worlds carry rings, their radii in planet radii, the painter, and whether the ring is seen by its dust (brightens when backlit) or its ice
const RINGS = { saturn: { r0: 1.35, r1: 2.3, tex: ringTexC, dust: 0, shadow: 1 }, jupiter: { r0: 1.25, r1: 2.6, tex: jupiterRingC, dust: 1, shadow: .3 }, uranus: { r0: 1.4, r1: 2.1, tex: uranusRingC, dust: .5, shadow: .5 }, neptune: { r0: 1.6, r1: 2.7, tex: neptuneRingC, dust: 1, shadow: .3 } };
// lens dirt: faint specks, a few smears and a soft vignette-shaped haze, for the bloom to light up
function dirtC() { const [c, g] = canvas(512, 512); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) { const x = Math.random() * 512, y = Math.random() * 512, r = .6 + Math.random() * 2.4, a = .25 + Math.random() * .5, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  for (let i = 0; i < 18; i++) { const x = Math.random() * 512, y = Math.random() * 512, r = 6 + Math.random() * 20, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.14)'); gr.addColorStop(.6, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  for (let i = 0; i < 9; i++) { g.save(); g.translate(Math.random() * 512, Math.random() * 512); g.rotate(Math.random() * PI); const L = 20 + Math.random() * 50, gr = g.createLinearGradient(-L, 0, L, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-L, -1.2, L * 2, 2.4); g.restore(); }
  return c; }
// the Sun's corona for the map: a soft wide glow with faint radial streamers, drawn additive behind the disc
function coronaC() { const [c, g] = canvas(512, 512), R = seeded(5); const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256); gr.addColorStop(0, 'rgba(255,245,225,.9)'); gr.addColorStop(.1, 'rgba(255,225,170,.55)'); gr.addColorStop(.3, 'rgba(255,200,130,.16)'); gr.addColorStop(.6, 'rgba(255,180,110,.04)'); gr.addColorStop(1, 'rgba(255,170,100,0)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = 'lighter'; g.translate(256, 256);
  for (let i = 0; i < 90; i++) { const a = R() * Math.PI * 2, L = 90 + R() * 150, w = .4 + R() * 1.6, al = .025 + R() * .05; const sg = g.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L); sg.addColorStop(0, `rgba(255,230,190,${al})`); sg.addColorStop(.5, `rgba(255,215,160,${al * .5})`); sg.addColorStop(1, 'rgba(255,200,140,0)'); g.strokeStyle = sg; g.lineWidth = w; g.beginPath(); g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.stroke(); }
  return c; }
function nebulaC() { // the deep sky: near black, the Milky Way as one soft band with a dark dust lane through it, faint colour in the star clouds
  const [c, n] = canvas(1024, 1024), R = seeded(4242); n.fillStyle = '#020207'; n.fillRect(0, 0, 1024, 1024);
  // a radial blob drawn at every wrap offset, its gradient centred on each copy, so the tile repeats without a seam
  const blob = (x, y, r, stops, wrapY = false) => { for (const ox of [-1024, 0, 1024]) for (const oy of wrapY ? [-1024, 0, 1024] : [0]) { const cx = x + ox, cy = y + oy; if (cx + r < 0 || cx - r > 1024 || cy + r < 0 || cy - r > 1024) continue; const gr = n.createRadialGradient(cx, cy, 0, cx, cy, r); for (const [k, col] of stops) gr.addColorStop(k, col); n.fillStyle = gr; n.fillRect(cx - r, cy - r, r * 2, r * 2); } };
  // the galactic band runs across the tile (the tile repeats, so it is one band, wide and soft, never a stripe pattern)
  const band = (w, col, a0) => { const gr = n.createLinearGradient(0, 512 - w, 0, 512 + w); gr.addColorStop(0, col + '0)'); gr.addColorStop(.3, col + (a0 * .45) + ')'); gr.addColorStop(.5, col + a0 + ')'); gr.addColorStop(.7, col + (a0 * .45) + ')'); gr.addColorStop(1, col + '0)'); n.fillStyle = gr; n.fillRect(0, 512 - w, 1024, w * 2); };
  n.globalCompositeOperation = 'lighter'; band(340, 'rgba(30,28,42,', .6); band(170, 'rgba(44,40,54,', .55); band(70, 'rgba(62,56,64,', .5);
  // star clouds: bright knots along the band, warm toward the core, cooler further out
  for (let i = 0; i < 110; i++) { const x = R() * 1024, y = 512 + (R() - .5) * 340 * (R() < .5 ? 1 : .5), r = 18 + R() * 100, a = .06 + R() * .09, warm = R() < .6;
    const cc = warm ? '88,74,70' : '64,66,86'; blob(x, y, r, [[0, `rgba(${cc},${a * .6})`], [.5, `rgba(${cc},${a * .22})`], [1, `rgba(${cc},0)`]]); }
  // a brighter central bulge, once per tile
  blob(300, 512, 420, [[0, 'rgba(96,80,70,.16)'], [.5, 'rgba(70,60,62,.06)'], [1, 'rgba(60,50,60,0)']]);
  n.globalCompositeOperation = 'multiply'; // the dust lane, ragged, darkest through the middle of the band
  for (let i = 0; i < 70; i++) { const x = R() * 1024, y = 500 + (R() - .5) * 80 + Math.sin(x / 150) * 30 + Math.sin(x / 47) * 8, r = 24 + R() * 80, k = 70 + R() * 50; blob(x, y, r, [[0, `rgba(${k},${k - 6},${k + 2},1)`], [.55, `rgba(${k + 60},${k + 56},${k + 60},1)`], [1, 'rgba(255,255,255,1)']]); }
  for (let i = 0; i < 24; i++) { const x = R() * 1024, y = 512 + (R() - .5) * 420, r = 40 + R() * 120; blob(x, y, r, [[0, 'rgba(150,146,150,1)'], [1, 'rgba(255,255,255,1)']]); } // thinner dust off the lane
  n.globalCompositeOperation = 'lighter';
  // the faintest wash of nebula colour, far from the band as well: rust, violet, ochre, deep blue
  const blobs = [['rgba(70,26,22,', .07], ['rgba(34,22,60,', .065], ['rgba(58,42,22,', .05], ['rgba(16,30,56,', .065], ['rgba(40,18,40,', .05]];
  for (let i = 0; i < 11; i++) { const [cc, a] = blobs[i % blobs.length]; const x = R() * 1024, y = R() * 1024, r = 160 + R() * 320; blob(x, y, r, [[0, cc + a + ')'], [.45, cc + (a * .4) + ')'], [1, cc + '0)']], true); }
  // a dense sprinkle of the faintest stars baked into the sky itself: the depth behind the parallax layers
  for (let i = 0; i < 5000; i++) { const x = R() * 1024, y = R() * 1024, inBand = Math.abs(y - 512) < 260; if (!inBand && R() < .45) continue; const a = (.08 + R() * .22) * (inBand ? 1 : .7); n.fillStyle = `rgba(${235 + R() * 20 | 0},${228 + R() * 22 | 0},${225 + R() * 30 | 0},${a})`; n.fillRect(x, y, 1, 1); }
  return c;
}
// a star layer: colours by spectral class, a few bright ones with a soft halo and, on the nearest layer, a faint diffraction cross
function starC(count, maxSize, alpha, spikes = false) {
  const [c, g] = canvas(1024, 1024), R = seeded(count * 31 + maxSize * 7 + 1);
  const COLS = [[255, 244, 232], [255, 236, 210], [255, 220, 180], [228, 234, 255], [196, 212, 255], [255, 255, 250], [255, 196, 150], [255, 170, 120]]; // G, K, M, A, B, F, orange and red giants
  for (let i = 0; i < count; i++) { const b = R(), col = COLS[R() < .5 ? 0 : (R() * COLS.length) | 0], x = R() * 1024 | 0, y = R() * 1024 | 0, bright = R() < .035, mid = !bright && R() < .1;
    const a = alpha * (bright ? 1 : mid ? .55 + b * .45 : .2 + b * .5), rgb = `${col[0]},${col[1]},${col[2]}`;
    if (bright) { const s = maxSize, hr = spikes ? 3.5 + R() * 2.5 : 2.2 + R(); const gr = g.createRadialGradient(x + .5, y + .5, 0, x + .5, y + .5, hr); gr.addColorStop(0, `rgba(${rgb},${a * .6})`); gr.addColorStop(.35, `rgba(${rgb},${a * .14})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(x - hr, y - hr, hr * 2 + 2, hr * 2 + 2);
      g.fillStyle = `rgba(${rgb},${a})`; g.fillRect(x, y, s, s);
      if (spikes && R() < .45) { const L = 4 + R() * 5; g.strokeStyle = `rgba(${rgb},${a * .25})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x - L, y + .5); g.lineTo(x + s + L, y + .5); g.moveTo(x + .5, y - L); g.lineTo(x + .5, y + s + L); g.stroke(); } }
    else if (mid) { g.fillStyle = `rgba(${rgb},${a})`; g.fillRect(x, y, 1, 1); g.fillStyle = `rgba(${rgb},${a * .28})`; g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); g.fillRect(x, y - 1, 1, 1); g.fillRect(x, y + 1, 1, 1); }
    else { g.fillStyle = `rgba(${rgb},${a})`; g.fillRect(x, y, 1, 1); } }
  return c;
}

// ---------------------------------------------------------------- shaders (TSL node materials: one source, compiled to WGSL on WebGPU and GLSL on the WebGL2 fallback)
// Each material carries a `uniforms` map shaped like the old ShaderMaterial's ({ name: { value } }), so the rest of
// the renderer sets them exactly as before. Texture slots hold a 1×1 placeholder until a map arrives.
// the shader block keeps its TSL names (clamp, mix, length …) to itself
const { planetMat, cloudMat, sunMat, atmoMat, ringMat, bgMat, batchMat, orbitMat, dustMat, SH } = (() => {
const PH = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; })();
// a texture uniform that may be sampled at several places in one shader: setting .value updates every sample
function texU(init = null) {
  const nodes = [];
  return { _v: init, get value() { return this._v; }, set value(t) { this._v = t; for (const n of nodes) n.value = t || PH; },
    at(uvn) { const n = TSL.texture(this._v || PH, uvn); nodes.push(n); return n; } };
}
const { Fn, float, vec2, vec3, vec4, uniform, uv, varying, attribute, positionGeometry, normalGeometry, positionWorld, cameraPosition,
  modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, fwidth, smoothstep, mix, dot, cross, normalize, length, fract, floor,
  max, min, clamp, pow, abs, select, sin, cos, step, exp, hash } = TSL;
const one = float(1);
// shared per-frame uniforms: the view's size in pixels (for anything drawn a fixed number of pixels wide) and the clock
const SH = { res: uniform(new THREE.Vector2(1, 1)), time: uniform(0) };
// the worlds' noise: a value-noise lattice hashed in place, looked up twice on rotated lattices so no square cells show
const h3 = Fn(([p0]) => { const p = fract(vec3(p0).mul(.3183099).add(.1)).mul(17).toVar(); return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z))); })
  .setLayout({ name: 'ir_h3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });
const n3b = Fn(([x0]) => {
  const x = vec3(x0).toVar(), i = floor(x).toVar(), f0 = fract(x), f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  const H = (a, b, c) => h3(i.add(vec3(a, b, c)));
  return mix(mix(mix(H(0, 0, 0), H(1, 0, 0), f.x), mix(H(0, 1, 0), H(1, 1, 0), f.x), f.y),
             mix(mix(H(0, 0, 1), H(1, 0, 1), f.x), mix(H(0, 1, 1), H(1, 1, 1), f.x), f.y), f.z).mul(2).sub(1);
}).setLayout({ name: 'ir_n3b', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });
const n3 = Fn(([x0]) => {
  const x = vec3(x0).toVar(); // R * x, with R = mat3(.788, -.372, .489, .576, .668, -.471, -.152, .644, .750) (column-major)
  const rx = vec3(dot(x, vec3(.788, .576, -.152)), dot(x, vec3(-.372, .668, .644)), dot(x, vec3(.489, -.471, .750)));
  return n3b(x).add(n3b(rx.mul(1.13).add(11.7))).mul(.7);
}).setLayout({ name: 'ir_n3', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });
const lum = c => dot(c, vec3(.3, .55, .15));
const worldN = () => varying(normalize(modelWorldMatrix.mul(vec4(normalGeometry, 0)).xyz)); // mat3(modelMatrix) * normal, as before
const mkMat = (frag, o = {}) => { const m = new THREE.NodeMaterial(); Object.assign(m, o); m.fragmentNode = frag; m.lights = false; m.fog = false; return m; };

// the worlds: the generated surface map (alpha marks water, for the sun's glint), city light on the night side,
// relief lit from the map itself, cloud shadows cast on the ground, a fresnel rim of atmosphere reddening at the
// terminator, and procedural fine ground detail that fades in as the camera closes (so a close pass never goes soft).
// Gas giants are limb-darkened with a deep, soft terminator and pale polar hoods; a ringed world wears its ring's shadow.
// weather in the lookup: zonal jets slide the bands past each other, and each named storm turns on its own centre.
// Storms are [u, v, ru, rv, spin] in texture space (u from lon, v from lat), spin in rad/s of the render clock.
const storms = (uvw, list, jets) => {
  if (jets) uvw.x.addAssign(sin(uvw.y.mul(PI * 9).add(1.3)).mul(.0022).add(sin(uvw.y.mul(PI * 23).add(.4)).mul(.0009)).mul(SH.time).mul(jets)); // differential rotation: each latitude its own speed
  for (const [cu, cv, ru, rv, sp] of list || []) {
    const d = vec2(uvw.x.sub(cu).div(ru), uvw.y.sub(cv).div(rv)).toVar(), rr = length(d), f = smoothstep(1.35, .75, rr).toVar();
    const a = SH.time.mul(sp).add(sin(SH.time.mul(.31).add(rr.mul(3))).mul(.25)), ca = cos(a), sa = sin(a);
    const rd = vec2(d.x.mul(ca).sub(d.y.mul(sa)), d.x.mul(sa).add(d.y.mul(ca))); // the storm turns as a whole; its collar is dragged part of the way
    uvw.addAssign(vec2(rd.x.sub(d.x).mul(ru), rd.y.sub(d.y).mul(rv)).mul(f)); }
  return uvw;
};
// night-side lightning in a cloud deck: a cell flashes for one frame in sixty or so, brighter at its centre
const lightning = (uvw, cells, rate) => { const c = floor(uvw.mul(cells)), hv = hash(c.x.mul(7.13).add(c.y.mul(113.7)).add(floor(SH.time.mul(9)).mul(.731)));
  const on = step(one.sub(rate), hv), f = fract(uvw.mul(cells)).sub(.5), cen = smoothstep(.5, .05, length(f)); return on.mul(cen); };
const planetMat = (atmo, o = {}) => {
  const GAS = !!o.gas, AIR = o.air ? 1 : 0, BUMP = o.bump ?? 1, RING = !!o.ring, AUR = o.aurora, MOONS = !!o.moons;
  const U = { map: texU(), night: texU(), m0: uniform(new THREE.Vector4(0, 0, 0, 1e-6)), m1: uniform(new THREE.Vector4(0, 0, 0, 1e-6)), m2: uniform(new THREE.Vector4(0, 0, 0, 1e-6)), m3: uniform(new THREE.Vector4(0, 0, 0, 1e-6)),
    aurCol: uniform(new THREE.Color(...(AUR || [0, 0, 0]))), hasNight: uniform(0), hmap: texU(), hasH: uniform(0), clouds: texU(), hasClouds: uniform(0), cloudOff: uniform(0),
    texel: uniform(new THREE.Vector2(1 / 512, 1 / 256)), bumpK: uniform(BUMP), gas: uniform(GAS ? 1 : 0), hasAtmo: uniform(AIR),
    sunPos: uniform(new THREE.Vector3()), atmo: uniform(new THREE.Color().setRGB(...atmo.map(v => v / 255), THREE.SRGBColorSpace)), ecl: uniform(0), eclCol: uniform(new THREE.Color(.22, .22, .25)),
    C: uniform(new THREE.Vector3()), pr: uniform(1), ringN: uniform(new THREE.Vector3(0, 1, 0)), ringR: uniform(new THREE.Vector2(1.35, 2.3)), ringK: uniform(1), ringMap: texU() };
  const vN = worldN();
  const vT = varying(Fn(() => { const n = normalGeometry, t = vec3(n.z, 0, n.x.mul(-1)); return normalize(modelWorldMatrix.mul(vec4(select(length(t).greaterThan(1e-4), t, vec3(0, 0, 1)), 0)).xyz); })());
  const frag = Fn(() => {
    const N0 = normalize(vN).toVar(), T = normalize(vT.sub(N0.mul(dot(vT, N0)))).toVar(), B = cross(N0, T).toVar();
    const L = normalize(U.sunPos.sub(positionWorld)).toVar(), V = normalize(cameraPosition.sub(positionWorld)).toVar();
    const vP = positionGeometry.toVar(), tx = U.texel;
    // below a texel, warp the lookup with fine noise: coasts and band edges go ragged instead of stair-stepping
    const fw = length(fwidth(vP)).toVar(), wz = one.sub(smoothstep(.3, 1, fw.mul(1400))), w2 = float(.5).mul(one.sub(smoothstep(.25, .5, fw.mul(2800))));
    const uvw = uv().add(tx.mul(1.6).mul(wz).mul(vec2(n3(vP.mul(1400)).add(w2.mul(n3(vP.mul(2800).add(2)))), n3(vP.mul(1400).add(5)).add(w2.mul(n3(vP.mul(2800).add(7))))))).toVar();
    if (GAS) storms(uvw, o.storms, 1); // the giants' weather: bands sliding, storms turning
    const t = U.map.at(uvw).toVar(), base = t.rgb.toVar(), land = one.sub(t.a).toVar();
    // relief: from the painted elevation map when there is one, else from the colour map's own brightness
    const useH = U.hasH.greaterThan(.5);
    const h0 = select(useH, U.hmap.at(uvw.sub(tx.mul(.5))).r, lum(t.rgb));
    const hu = select(useH, U.hmap.at(uvw.add(vec2(tx.x.mul(1.5), tx.y.mul(-.5)))).r, lum(U.map.at(uvw.add(vec2(tx.x, 0))).rgb));
    const hv = select(useH, U.hmap.at(uvw.add(vec2(tx.x.mul(-.5), tx.y.mul(1.5)))).r, lum(U.map.at(uvw.add(vec2(0, tx.y))).rgb));
    const rk = select(useH, float(.024).div(tx.x.mul(6.2832)), land.mul(2.2));
    const N = normalize(N0.sub(rk.mul(BUMP * 1.5).mul(T.mul(hu.sub(h0)).add(B.mul(hv.sub(h0)))))).toVar();
    // fine detail below the map's own resolution: fades in only where a texel covers more than a few pixels
    let det = float(0);
    for (let k = 0; k < 4; k++) { const f = 96 * Math.pow(4, k), a = one.sub(smoothstep(.07, .25, fw.mul(f)));
      const q = GAS ? vP.mul(vec3(f, f * 5, f)) : vP.mul(f); det = det.add(n3(q.add(k * 7.31)).mul(a).mul(.5 / (1 + k * .6))); }
    det = det.toVar();
    base.mulAssign(one.add(det.mul(GAS ? .08 : .62).mul(land.mul(.75).add(.25))));
    base.assign(mix(base, vec3(dot(base, vec3(.3, .59, .11))), clamp(det, 0, 1).mul(.25).mul(land))); // the fine ground is rougher and greyer
    if (!GAS && BUMP) {
      const dn = n3(vP.mul(900)), dd = one.sub(smoothstep(.06, .22, fw.mul(900))), dn2 = n3(vP.mul(3200).add(1.7)), dd2 = one.sub(smoothstep(.06, .22, fw.mul(3200)));
      N.assign(normalize(N.add(land.mul(BUMP).mul(dd.mul(.34).mul(T.mul(n3(vP.mul(900).add(3.1))).add(B.mul(dn))).add(dd2.mul(.22).mul(T.mul(n3(vP.mul(3200).add(5.3))).add(B.mul(dn2))))))));
    }
    const nl = dot(N, L), nl0 = dot(N0, L).toVar(), day = smoothstep(-.12, .22, nl0), mu = max(dot(N0, V), 0).toVar();
    // cloud shadows, cast a little away from the sun
    const off = vec2(dot(L, T), dot(L, B)).mul(-.0035);
    const sh = one.sub(U.hasClouds.mul(.45).mul(U.clouds.at(uv().add(vec2(U.cloudOff, 0)).add(off)).a).mul(smoothstep(0, .2, nl0))).toVar();
    // the ring's shadow: where the ray to the Sun crosses the ring plane inside the ring, the ring's own density darkens the ground
    if (RING) {
      const dn = dot(L, U.ringN), tt = dot(U.C.sub(positionWorld), U.ringN).div(select(abs(dn).lessThan(1e-4), float(1e-4), dn)).toVar();
      const Hp = positionWorld.add(L.mul(tt)), rr = length(Hp.sub(U.C)).div(U.pr).toVar();
      const inR = step(0, tt).mul(step(U.ringR.x, rr)).mul(step(rr, U.ringR.y)), ra = U.ringMap.at(vec2(rr.sub(U.ringR.x).div(U.ringR.y.sub(U.ringR.x)), .5)).a;
      sh.mulAssign(one.sub(inR.mul(ra).mul(.82).mul(U.ringK)));
    }
    // a moon between this world and the Sun throws its shadow on the disc: a dark spot with a soft penumbra (slots are filled each frame)
    if (MOONS) for (const M of [U.m0, U.m1, U.m2, U.m3]) {
      const dm = M.xyz.sub(positionWorld), tm = dot(dm, L), perp = length(dm.sub(L.mul(tm)));
      sh.mulAssign(one.sub(smoothstep(M.w.mul(1.7), M.w.mul(.75), perp).mul(step(0, tm)).mul(.9)));
    }
    const fr = pow(one.sub(mu), 2.6).toVar();
    const diff = GAS ? max(nl.add(.12), 0).div(1.12).mul(.95) : max(nl, 0).mul(.97); // a gas giant's thick air wraps the light a little round the terminator
    const col = base.mul(diff.mul(sh).add(.03).add(float(AIR * .03).mul(lum(U.atmo)))).toVar();
    if (GAS) {
      col.mulAssign(float(.48).add(pow(mu, .55).mul(.52))); // limb darkening: the light leaves through more haze at the edge
      const lat = abs(normalGeometry.y), hood = smoothstep(.72, .96, lat).mul(.45); // pale polar hoods
      col.assign(mix(col, mix(col, vec3(lum(col)), .5).mul(1.08), hood));
      col.addAssign(U.atmo.mul(fr).mul(fr).mul(.42).mul(smoothstep(-.35, .4, nl0))); // the high haze at the limb, in the world's own tint
      col.addAssign(vec3(1, .55, .3).mul(fr).mul(smoothstep(-.1, .02, nl0)).mul(one.sub(smoothstep(.02, .22, nl0))).mul(.18)); // a thin sunset arc
    } else {
      // air: the blue of the sky seen from above, strongest at the limb; the shell itself (atmoMat) carries the glow outside the disc
      const rim = mix(U.atmo, vec3(1, .5, .22), one.sub(smoothstep(-.05, .3, nl0)).mul(.75)); // the rim reddens toward the terminator
      col.assign(mix(col, rim.mul(smoothstep(-.2, .5, nl0).mul(.75).add(.25)), fr.mul(AIR * .6).mul(smoothstep(-.3, .3, nl0))).add(rim.mul(fr).mul(fr).mul(.3).mul(smoothstep(-.25, .5, nl0))));
      if (AIR) { col.assign(mix(col, U.atmo.mul(day).mul(.9), pow(one.sub(mu), 1.6).mul(.1))); // aerial haze across the disc
        col.addAssign(vec3(1, .42, .16).mul(base).mul(smoothstep(-.08, .02, nl0)).mul(one.sub(smoothstep(.02, .2, nl0))).mul(.4)); } // sunset band along the terminator
    }
    const H = normalize(L.add(V));
    col.addAssign(vec3(1, .93, .8).mul(pow(max(dot(N, H), 0), 420)).mul(t.a).mul(smoothstep(0, .15, nl0)).mul(.7).mul(sh));
    col.addAssign(vec3(1, .9, .75).mul(pow(max(dot(N0, H), 0), 60)).mul(t.a).mul(smoothstep(0, .15, nl0)).mul(.035).mul(sh));
    col.addAssign(vec3(1, .95, .85).mul(pow(max(dot(N0, H), 0), 14)).mul(t.a).mul(fr).mul(smoothstep(0, .2, nl0)).mul(.25).mul(sh)); // the sea's broad fresnel sheen toward the limb
    const nt = U.night.at(uvw).rgb.toVar();
    // the lights come on as the terminator sweeps over them, each district at its own moment, sodium-orange at dusk and whiter in deep night
    const dh = hash(floor(uvw.mul(260)).x.mul(3.1).add(floor(uvw.mul(260)).y.mul(91.7))).mul(.12), lit = smoothstep(float(.1).add(dh), float(-.06).add(dh), nl0).toVar();
    const dusk = smoothstep(-.12, .08, nl0); nt.assign(mix(nt, nt.mul(vec3(1.15, .78, .5)), dusk.mul(.8)));
    col.addAssign(nt.mul(lit).mul(1.9).mul(one.sub(one.sub(sh).mul(.6))).mul(U.hasNight));
    col.addAssign(nt.mul(.5).mul(lit).mul(pow(one.sub(mu), 1.5)).mul(U.hasNight)); // a little of the city light scatters in the air at the limb
    if (o.lightning) col.addAssign(vec3(.8, .85, 1).mul(lightning(uvw, 90, .0012)).mul(one.sub(day)).mul(1.4)); // storms flashing in the dark
    if (AUR) { // the auroral oval round each pole, on the night side: curtains that drift and ripple, in the world's own colour
      const q = positionGeometry, alat = abs(q.y).toVar(), band = (GAS ? smoothstep(.74, .83, alat).mul(one.sub(smoothstep(.87, .95, alat))) : smoothstep(.86, .905, alat).mul(one.sub(smoothstep(.925, .965, alat)))).toVar(); // Earth's oval: a thin ring at 60–75°; the giants' wider
      const cur = n3(vec3(q.x.mul(9), SH.time.mul(.11), q.z.mul(9))).mul(.6).add(n3(vec3(q.x.mul(27).add(SH.time.mul(.17)), q.y.mul(6), q.z.mul(27))).mul(.4)).toVar();
      const au = band.mul(pow(clamp(cur.add(.35), 0, 1.4), 2.2)).mul(one.sub(day)).toVar();
      col.addAssign(U.aurCol.mul(au.mul(GAS ? .22 : .42).add(band.mul(GAS ? .02 : .05))).mul(one.sub(day)));
    }
    col.assign(mix(col, col.mul(U.eclCol), U.ecl)); // in its parent's shadow: dark, or copper-red through a parent's air
    return vec4(col, 1);
  })();
  const m = mkMat(frag); m.uniforms = U; return m;
};
const cloudMat = (o = {}) => { // the cloud deck, its edges broken into wisps and billows as the camera closes; lit tops, blue-grey undersides at the terminator
  const U = { map: texU(), sunPos: uniform(new THREE.Vector3()) }, vN = worldN();
  const frag = Fn(() => {
    const uvw = uv().toVar(); if (o.storms) storms(uvw, o.storms, .35); // fronts spiralling round their lows, a little shear between latitudes
    const N = normalize(vN), L = normalize(U.sunPos.sub(positionWorld)), V = normalize(cameraPosition.sub(positionWorld)), nl = dot(N, L).toVar(), c = U.map.at(uvw).toVar();
    const vP = positionGeometry.toVar(), fw = length(fwidth(vP)).toVar();
    let d = float(0), s = float(0);
    for (let k = 0; k < 4; k++) { const f = 60 * Math.pow(3, k), a = one.sub(smoothstep(.06, .22, fw.mul(f))).div(1 + k).toVar();
      d = d.add(n3(vP.mul(vec3(f, f * 1.6, f)).add(k * 3.7)).mul(a)); s = s.add(a); }
    const dd = d.div(max(s, 1)).toVar(); // where s is 0 so is d: the deck keeps its painted edge
    const al = clamp(c.a.add(dd.mul(.5).mul(one.sub(abs(c.a.mul(2).sub(1))))).add(dd.mul(.06)), 0, 1).toVar();
    const shade = dd.mul(.22).add(.8);
    const mu = max(dot(N, V), 0), fr = pow(one.sub(mu), 3);
    // thicker cloud is brighter on top and bluer-grey where it is thin and lit from behind; a warm edge at the terminator
    const lit = max(nl, 0).mul(1.1).add(.03).add(smoothstep(-.12, .12, nl).mul(.1)).toVar();
    const col = c.rgb.mul(shade).mul(lit).toVar();
    col.assign(mix(col, vec3(.62, .68, .8).mul(lit), one.sub(al).mul(.35)));
    col.addAssign(vec3(1, .55, .3).mul(smoothstep(-.1, .02, nl)).mul(one.sub(smoothstep(.02, .2, nl))).mul(.25).mul(al));
    col.addAssign(vec3(1, .97, .9).mul(pow(max(dot(N, normalize(L.add(V))), 0), 8)).mul(.08).mul(al)); // the silver lining
    if (o.lightning) col.addAssign(vec3(.85, .9, 1).mul(lightning(uvw, 70, .0015)).mul(one.sub(smoothstep(-.15, .05, nl))).mul(al).mul(2)); // lightning in the night clouds
    return vec4(col, al.mul(.84).mul(one.sub(fr.mul(.25))));
  })();
  const m = mkMat(frag, { transparent: true, depthWrite: false }); m.uniforms = U; return m;
};
// the Sun: its painted photosphere, limb-darkened, with slow-boiling granulation and a thin red chromosphere at the edge
const sunMat = () => {
  const U = { map: texU() }, vN = worldN();
  const frag = Fn(() => { const V = normalize(cameraPosition.sub(positionWorld)), mu = max(dot(normalize(vN), V), 0).toVar(), p = positionGeometry.toVar(), t = SH.time;
    const g1 = n3(p.mul(16).add(vec3(t.mul(.03), t.mul(.011), 0))), g2 = n3(p.mul(52).add(vec3(0, t.mul(.07), t.mul(.02)))), g3 = n3(p.mul(140).add(vec3(t.mul(.1), 0, 0)));
    const gran = one.add(g1.mul(.16)).add(g2.mul(.09)).add(g3.mul(.05)), limb = pow(mu, .5).mul(.72).add(.38);
    const base = U.map.at(uv()).rgb;
    const col = mix(base.mul(vec3(1, .66, .38)), base.mul(vec3(1.06, 1.01, .92)), pow(mu, .6)).mul(gran).mul(limb).mul(2.3).toVar();
    col.addAssign(vec3(1, .5, .25).mul(pow(one.sub(mu), 10)).mul(.7));
    return vec4(col, 1); })();
  const m = mkMat(frag); m.uniforms = U; return m;
};
// atmosphere: a back-facing shell, bright where the view ray grazes the planet's limb, brighter on the day side,
// reddening where the Sun sets along the terminator
const atmoMat = (rgb, k) => {
  const U = { C: uniform(new THREE.Vector3()), r: uniform(1), R: uniform(1), sunPos: uniform(new THREE.Vector3()), col: uniform(new THREE.Color().setRGB(...rgb.map(v => v / 255), THREE.SRGBColorSpace)), k: uniform(k) };
  const frag = Fn(() => {
    const D = normalize(positionWorld.sub(cameraPosition)), oc = U.C.sub(cameraPosition), cp = cameraPosition.add(D.mul(dot(oc, D))).toVar(), b = length(cp.sub(U.C)).toVar();
    const g = clamp(U.R.sub(b).div(U.R.sub(U.r)), 0, 1).toVar();
    const lim = pow(g, 5).mul(.6).mul(select(b.lessThan(U.r), float(.35), float(1))).add(pow(g, 18).mul(.95)); // a soft skirt and a bright thin line at the limb
    const sd = dot(normalize(cp.sub(U.C)), normalize(U.sunPos.sub(U.C))).toVar(), s = smoothstep(-.4, .55, sd).mul(.92).add(.08);
    const c2 = mix(U.col, vec3(1), pow(g, 8).mul(.3).add(.3)).toVar();
    c2.assign(mix(c2, vec3(1, .45, .2), smoothstep(.35, -.05, sd).mul(smoothstep(-.45, -.1, sd)).mul(.6))); // sunset along the terminator
    return vec4(c2.mul(lim).mul(s).mul(U.k).mul(.82), 1);
  })();
  const m = mkMat(frag, { side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); m.uniforms = U; return m;
};
// the rings: the world's shadow falls across them with a soft edge (the Sun has size), the unlit face is dim, and
// looking toward the Sun the thin ringlets glow with forward-scattered light
const ringMat = map => {
  const U = { map: texU(map), sunPos: uniform(new THREE.Vector3()), C: uniform(new THREE.Vector3()), r0: uniform(1.35), r1: uniform(2.3), pr: uniform(1), N: uniform(new THREE.Vector3(0, 1, 0)), dust: uniform(0) };
  const frag = Fn(() => {
    const rr = length(positionGeometry.xy), az = TSL.atan(positionGeometry.y, positionGeometry.x).div(TAU).add(.5), t = U.map.at(vec2(rr.sub(U.r0).div(U.r1.sub(U.r0)), az)).toVar();
    const L = normalize(U.sunPos.sub(U.C)), p = positionWorld.sub(U.C).toVar(), along = dot(p, L).toVar(), perp = length(p.sub(L.mul(along)));
    const V = normalize(cameraPosition.sub(positionWorld)).toVar();
    const shadow = select(along.lessThan(0), smoothstep(U.pr.mul(.9), U.pr.mul(1.08), perp), float(1)).mul(.9).add(.1).toVar();
    const lit = smoothstep(-.08, .08, dot(U.N, L).mul(dot(U.N, V))).mul(.45).add(.55); // the face the Sun lights, or the one it does not
    const fs = pow(max(dot(V.negate(), L), 0), 5).mul(mix(one.sub(t.a), min(t.a.mul(5), one), U.dust)).mul(.7).mul(shadow); // forward scattering: through the thin parts of an ice ring, by the grains of a dust ring
    const col = t.rgb.mul(shadow.mul(1.0).add(.2)).mul(lit).add(vec3(1, .95, .85).mul(fs));
    return vec4(col, min(one, t.a.mul(.96).add(fs.mul(.4))));
  })();
  const m = mkMat(frag, { side: THREE.DoubleSide, transparent: true, depthWrite: false }); m.uniforms = U; return m;
};
// the Belt and the Kuiper belt as dust: a faint granular sheen along the annulus, seen only at system zoom. Coordinates are
// scaled by the outer radius so the noise stays in a sane range; the fine grain fades where it would fall below a pixel
const dustMat = (r0, r1, col) => {
  const U = { k: uniform(0), col: uniform(new THREE.Color(col)) }, rn = r0 / r1;
  const frag = Fn(() => {
    const q = positionGeometry.xy.div(r1).toVar(), rr = length(q), fw = length(fwidth(q)).toVar();
    const prof = smoothstep(rn, rn + (1 - rn) * .18, rr).mul(one.sub(smoothstep(1 - (1 - rn) * .3, 1, rr))).toVar();
    const clump = n3(vec3(q.mul(7), 1.3)).mul(.5).add(.5).toVar(), lane = n3(vec3(rr.mul(60), q.x.mul(.5), 4)).mul(.5).add(.5);
    const g1 = smoothstep(.5, 1.1, n3(vec3(q.mul(90), 2))).mul(one.sub(smoothstep(.004, .012, fw))).mul(smoothstep(.0012, .002, fw)), g2 = smoothstep(.6, 1.2, n3(vec3(q.mul(420), 5))).mul(one.sub(smoothstep(.0008, .0025, fw))).mul(smoothstep(.00025, .0004, fw)); // grains live between a pixel and six across; closer in they would read as boulders
    const a = clamp(prof.mul(float(.1).add(clump.mul(.12)).add(lane.mul(clump).mul(.1)).add(g1.mul(.22).mul(clump.add(.3))).add(g2.mul(.3))).mul(U.k), 0, 1);
    return vec4(U.col.mul(a), a);
  })();
  const m = mkMat(frag, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); m.uniforms = U; return m;
};
const bgMat = () => {
  const U = { neb: texU(), nk: uniform(1), nz: uniform(1), s0: texU(), s1: texU(), s2: texU(), res: uniform(new THREE.Vector2(1, 1)), o01: uniform(new THREE.Vector4()), o2n: uniform(new THREE.Vector4()) };
  const frag = Fn(() => {
    const p = vec2(uv().x, one.sub(uv().y)).mul(U.res).toVar();
    const c = U.neb.at(p.sub(U.res.mul(.5)).div(U.nz).add(U.res.mul(.5)).sub(U.o2n.zw).div(1.4 * 1024)).rgb.mul(U.nk).toVar(); // nk: the Milky Way's strength, from the graphics menu; nz: it swells a little as the view closes in
    const a0 = U.s0.at(p.sub(U.o01.xy).div(1024)), a1 = U.s1.at(p.sub(U.o01.zw).div(1024)), a2 = U.s2.at(p.sub(U.o2n.xy).div(1024));
    // the nearest stars scintillate a little: a slow noise per 5-px cell, so each star has its own rhythm
    const st = p.sub(U.o2n.xy), tw = float(.88).add(n3(vec3(floor(st.div(5)), SH.time.mul(1.3))).mul(.14)), tw1 = float(.95).add(n3(vec3(floor(p.sub(U.o01.zw).div(4)).add(7), SH.time.mul(.9))).mul(.06));
    return vec4(c.add(a0.rgb.mul(a0.a)).add(a1.rgb.mul(a1.a).mul(tw1)).add(a2.rgb.mul(a2.a).mul(tw)), 1);
  })();
  const m = mkMat(frag, { depthTest: false, depthWrite: false }); m.vertexNode = vec4(positionGeometry.xy, .99999, 1); m.uniforms = U; return m;
};
// the sprite batches' material: per-instance position (iP), size and turn (iS) and tint (iC)
const batchMat = (map, { add, ground, ax }) => {
  const U = { map: texU(map), ax: uniform(ax) }, iP = attribute('iP', 'vec3'), iS = attribute('iS', 'vec3'), iC = attribute('iC', 'vec4');
  const vtx = Fn(() => {
    const q = vec2(positionGeometry.x.add(U.ax), positionGeometry.y).mul(iS.xy).toVar(), c = cos(iS.z), s = sin(iS.z);
    const r = vec2(c.mul(q.x).sub(s.mul(q.y)), s.mul(q.x).add(c.mul(q.y))).toVar();
    if (ground) return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(iP.add(vec3(r.x, 0, r.y)), 1)));
    const mv = cameraViewMatrix.mul(vec4(iP, 1)).toVar(); return cameraProjectionMatrix.mul(vec4(mv.xy.add(r), mv.z, mv.w));
  })();
  const frag = Fn(() => { const t = U.map.at(uv()), vC = varying(iC); return vec4(t.rgb.mul(vC.rgb), t.a.mul(vC.a)); })();
  const m = mkMat(frag, { transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide /* ground quads wind clockwise from above: never cull them */ });
  m.vertexNode = vtx; m.uniforms = U; return m;
};
// orbit lines as screen-space ribbons: each segment is a quad pushed sideways in the vertex shader by a fixed number
// of pixels (oq: the segment's other end; os: which side; ot: across the ribbon for the profile), so the lines stay
// a crisp anti-aliased core with a soft halo at every zoom, where GPU lines are one aliased pixel
const ORBIT_HW = 4.5; // half-width in pixels, halo included
const orbitMat = (col, op) => {
  const U = { col: uniform(new THREE.Color(col)), op: uniform(op) }, oq = attribute('oq', 'vec3'), os = attribute('os', 'float'), ot = attribute('ot', 'float'), oa = attribute('oa', 'float');
  const vT = varying(ot), vA = varying(oa);
  const vtx = Fn(() => {
    const cp = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(positionGeometry, 1))).toVar(), cq = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(oq, 1))).toVar();
    const sp = cp.xy.div(cp.w).mul(SH.res), sq = cq.xy.div(cq.w).mul(SH.res), d = normalize(sq.sub(sp)).toVar(), n = vec2(d.y.negate(), d.x);
    const px = float(ORBIT_HW * 2).div(SH.res); // the half-width in clip units, per pixel
    return vec4(cp.xy.add(n.mul(px).mul(os).mul(cp.w)), cp.z, cp.w);
  })();
  const frag = Fn(() => { const t = abs(vT), core = one.sub(smoothstep(.1, .3, t)), halo = pow(one.sub(t), 2).mul(.1); return vec4(U.col.mul(U.op).mul(vA).mul(core.add(halo)), 1); })();
  const m = mkMat(frag, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); m.vertexNode = vtx; m.uniforms = U; return m;
};
return { planetMat, cloudMat, sunMat, atmoMat, ringMat, bgMat, batchMat, orbitMat, dustMat, SH };
})();

// ---------------------------------------------------------------- sprite batches: one draw call each
// ground: quads lie on the plane, turned by angle (shots, plumes, missiles); otherwise they face the camera
class Batch {
  constructor(map, { add = true, ground = false, ax = 0, cap = 6000, order = 10 } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.p = new Float32Array(cap * 3); this.s = new Float32Array(cap * 3); this.c = new Float32Array(cap * 4); this.cap = cap; this.n = 0;
    for (const [k, a, sz] of [['iP', this.p, 3], ['iS', this.s, 3], ['iC', this.c, 4]]) { const at = new THREE.InstancedBufferAttribute(a, sz); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, at); }
    g.instanceCount = 0; this.g = g;
    const m = batchMat(map, { add, ground, ax });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  // x, y: world; h: height; w, l: size in world units; a: angle; col: hex; al: alpha; k: brightness
  add(x, y, h, w, l, a, col, al, k = 1) {
    if (this.n >= this.cap) return; const i = this.n++, c = lin(col);
    this.p[i * 3] = x - O.x; this.p[i * 3 + 1] = h; this.p[i * 3 + 2] = y - O.y;
    this.s[i * 3] = w; this.s[i * 3 + 1] = l; this.s[i * 3 + 2] = a;
    this.c[i * 4] = c[0] * k; this.c[i * 4 + 1] = c[1] * k; this.c[i * 4 + 2] = c[2] * k; this.c[i * 4 + 3] = al;
  }
  end() { const g = this.g; g.instanceCount = this.n; for (const k of ['iP', 'iS', 'iC']) { const a = g.attributes[k]; a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; } this.n = 0; }
}
// instanced meshes turned about the vertical axis; matrices written by hand
class Inst {
  constructor(geo, mat, cap, colors) {
    this.m = new THREE.InstancedMesh(geo, mat, cap); this.m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.m.frustumCulled = false; this.m.count = 0; this.n = 0; this.cap = cap;
    if (colors) { this.m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); this.m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
  }
  add(x, y, h, th, sx, sy, sz, col, tilt = 0) {
    if (this.n >= this.cap) return; const i = this.n++, e = this.m.instanceMatrix.array, o = i * 16, c = Math.cos(th), s = Math.sin(th);
    if (!tilt) { e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -s * sx; e[o + 3] = 0; e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0; e[o + 8] = s * sz; e[o + 9] = 0; e[o + 10] = c * sz; e[o + 11] = 0; }
    else { const ct = Math.cos(tilt), st = Math.sin(tilt); // turn about y, then tumble about the local x axis
      e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -s * sx; e[o + 3] = 0;
      e[o + 4] = s * st * sy; e[o + 5] = ct * sy; e[o + 6] = c * st * sy; e[o + 7] = 0;
      e[o + 8] = s * ct * sz; e[o + 9] = -st * sz; e[o + 10] = c * ct * sz; e[o + 11] = 0; }
    e[o + 12] = x - O.x; e[o + 13] = h; e[o + 14] = y - O.y; e[o + 15] = 1;
    if (col != null && this.m.instanceColor) { const v = lin(col), a = this.m.instanceColor.array; a[i * 3] = v[0]; a[i * 3 + 1] = v[1]; a[i * 3 + 2] = v[2]; }
  }
  addM(f, x, y, h, col) { // f: a THREE.Matrix4 holding the whole basis (rotation × scale); x, y world, h height
    if (this.n >= this.cap) return; const i = this.n++, e = this.m.instanceMatrix.array, o = i * 16, q = f.elements;
    for (let k = 0; k < 12; k++) e[o + k] = q[k]; e[o + 12] = x - O.x; e[o + 13] = h; e[o + 14] = y - O.y; e[o + 15] = 1;
    if (col != null && this.m.instanceColor) { const v = lin(col), a = this.m.instanceColor.array; a[i * 3] = v[0]; a[i * 3 + 1] = v[1]; a[i * 3 + 2] = v[2]; }
  }
  end() { this.m.count = this.n; this.m.instanceMatrix.needsUpdate = true; if (this.m.instanceColor) this.m.instanceColor.needsUpdate = true; this.n = 0; }
}

// ---------------------------------------------------------------- geometry
function jitterGeo(g, amt, seed, flatY = 1) { // displace by a hash of position so shared corners move together
  const p = g.attributes.position, h = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (h(Math.round(x * 1e3), Math.round(y * 1e3), Math.round(z * 1e3)) - .5) * amt; p.setXYZ(i, x * k, y * k * flatY, z * k); }
  g.computeVertexNormals(); return g;
}
const THICK = type => DEFS[type].fighter ? .2 : R0(type) > 60 ? .26 : .3;
function hullGeo(type, fac) {
  const gk = type + ':' + (fac || ''); if (GEO[gk]) return GEO[gk];
  const d = DEFS[type], pts = fshape(type, fac), [K, size] = hullK(type), q = K / size, T = THICK(type);
  const uv = { generateTopUV: (g, v, a, b, c) => [a, b, c].map(i => new THREE.Vector2(.5 + v[i * 3] * q, .5 + v[i * 3 + 1] * q)),
    generateSideWallUV: () => [new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0)] };
  const mk = (P, depth, y0) => { const sh = new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(x, -y))); const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, UVGenerator: uv }); g.rotateX(-PI / 2); g.translate(0, y0, 0); return g; };
  const hull = mk(pts, T, -T / 2);
  let sup = null;
  if (!d.fighter && R0(type) > 12) { // a raised deckhouse aft of centre, and a bridge tower on the capital ships
    const xs = pts.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), cx = x0 + (x1 - x0) * .38;
    const P2 = pts.map(([x, y]) => [cx + (x - cx) * .48, y * .5]); sup = [mk(P2, T * .45, T / 2)];
    if (R0(type) > 40) { const P3 = pts.map(([x, y]) => [cx - .1 + (x - cx) * .2, y * .28]); sup.push(mk(P3, T * .5, T / 2 + T * .45)); }
  }
  const nb = R0(type) > 60 ? 4 : R0(type) > 25 ? 2 : 1, xmin = Math.min(...pts.map(p => p[0])), bells = [];
  for (let i = 0; i < nb; i++) bells.push((nb === 1 ? 0 : (i / (nb - 1) - .5) * .5));
  return GEO[gk] = { hull, sup, bells, xmin, T };
}
function bellGeo() { if (GEO.bell) return GEO.bell; const g = new THREE.CylinderGeometry(.095, .06, .16, 10, 1, true); g.rotateZ(PI / 2); return GEO.bell = g; }
const facKey = team => team < 2 && S.fac ? S.fac[team] : null;
function shipMats(type, team) {
  const k = type + ':' + team + ':' + facKey(team); if (MAT[k]) return MAT[k];
  const col = S.teamc[team], [map, emi] = hullTex(type, col, facKey(team));
  const base = { metalness: .45, roughness: .55 };
  const cap = new THREE.MeshStandardMaterial({ ...base, map, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: .9, bumpMap: map, bumpScale: .004 });
  const side = new THREE.MeshStandardMaterial({ ...base, color: new THREE.Color(col.hull2).multiplyScalar(1.3), roughness: .7 });
  const flash = new THREE.MeshStandardMaterial({ ...base, map, emissive: 0xff9070, emissiveIntensity: .7 });
  const dark = new THREE.MeshStandardMaterial({ ...base, map, color: 0x6a6a6a });
  const darkSide = new THREE.MeshStandardMaterial({ ...base, color: 0x2a2a2c });
  const bell = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: .7, roughness: .4, side: THREE.DoubleSide, emissive: 0xff7a3c, emissiveIntensity: 0 });
  return MAT[k] = { n: [cap, side], f: [flash, flash], d: [dark, darkSide], bell };
}

// ---------------------------------------------------------------- init
export async function initRender() {
  // #webgl on the address forces the WebGL2 backend (for comparing, or a browser whose WebGPU misbehaves)
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance', trackTimestamp: true, forceWebGL: /webgl/i.test(location.hash + location.search) });
  await renderer.init(); // WebGPU where the browser has it, else the WebGL2 backend
  await loadGfx(renderer); // quality preset (Ultra on a strong GPU) and hull size, remembered per browser
  ODPR = Math.min(2, window.devicePixelRatio || 1); DPR = Math.min(preset().dpr, window.devicePixelRatio || 1);
  renderer.setPixelRatio(DPR); renderer.setSize(S.W, S.H);
  // tone mapping keeps base colours where they were and rolls bright flashes off instead of clipping them
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 1);
  const cv = renderer.domElement; cv.id = 'c'; document.body.prepend(cv);
  ov = document.createElement('canvas'); ov.id = 'ov'; cv.after(ov); ctx = ov.getContext('2d'); sizeOverlay();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, S.W / S.H, 1, 1e6);
  TEX.glow = tex(radial(64, [[0, 1], [.2, .62], [.5, .2], [1, 0]])); /* a glow, not a disc */ TEX.dot = tex(radial(32, [[0, 1], [.25, .7], [.6, .2], [1, 0]])); /* a soft mote, so a trail puff close up is a glow and not a ball */ TEX.smoke = tex(smokeC());
  TEX.streak = tex(streakC()); TEX.plume = tex(plumeC()); TEX.missile = tex(missileC()); TEX.fins = tex(finsC()); TEX.rings = {}; for (const id in RINGS) TEX.rings[id] = tex(RINGS[id].tex(), { wrap: true }); TEX.ring = TEX.rings.saturn;
  TEX.anam = tex(radial(128, [[0, 1], [.2, .5], [.5, .12], [1, 0]])); // stretched sideways: the anamorphic streak of a big flash
  FLARE_C = flareC(); TEX.fire = tex(fireC()); TEX.shock = tex(shockC()); TEX.hex = tex(hexC()); TEX.spark = tex(sparkC()); TEX.flare = tex(flareC()); TEX.corona = tex(coronaC());
  TEX.glint = tex(radial(64, [[0, 1], [.08, .9], [.25, .32], [.6, .06], [1, 0]])); // a far world as a point of light
  TEX.sunglow = tex(radial(128, [[0, 1], [.12, .8], [.3, .3], [.6, .07], [1, 0]]));
  // sky
  const bm = bgMat(); bm.uniforms.neb.value = tex(nebulaC(), { wrap: 1 });
  [[2600, 1, .5, false], [700, 2, .75, false], [200, 2, 1, true]].forEach(([n, m, a, sp], i) => { const t = tex(starC(n, m, a, sp), { wrap: 1 }); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; bm.uniforms['s' + i].value = t; });
  bm.toneMapped = false; // the sky keeps its painted look; tone mapping is for lit things and flashes
  bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bm); bgMesh.frustumCulled = false; bgMesh.renderOrder = -100; scene.add(bgMesh); bm.uniforms.nk.value = S.gx ? S.gx.sky : 1;
  // the Belt (2.1–3.45 AU) and the Kuiper belt (30–50 AU) as dust sheets
  for (const [r0, r1, col] of [[2.1 * AU, 3.45 * AU, 0xc8b49a], [30 * AU, 50 * AU, 0x9ab0d0]]) { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 256, 1), dustMat(r0, r1, col)); m.rotation.x = -PI / 2; m.renderOrder = -50; m.frustumCulled = false; m.visible = false; scene.add(m); dustM.push(m); }
  // light: the Sun lights the worlds in their own shaders; hulls get a key light from above, the Sun from the side and a cool fill
  scene.add(new THREE.AmbientLight(0x7a84a0, .42));
  scene.userData.hemi = new THREE.HemisphereLight(0xfff0dc, 0x000000, 0); scene.add(scene.userData.hemi); // the nearest world's light on the hulls, set each frame
  const key = new THREE.DirectionalLight(0xfff2e0, 2.5); key.position.set(-.35, 1, -.45); scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x5a7cc0, .4); fill.position.set(.5, .4, .8); scene.add(fill); scene.add(fill.target);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.5); rim.position.set(.6, -.25, -.9); scene.add(rim); scene.add(rim.target); // a cold edge light from below and behind: hulls separate from the dark
  scene.userData.sun = new THREE.PointLight(0xffe2b0, 2.4, 0, 0); scene.add(scene.userData.sun);
  bodiesG = new THREE.Group(); scene.add(bodiesG); buildBodies(); initGen();
  // orbit lines: ribbons of quads (see orbitMat), 4 vertices and 6 indices a segment; planets, moons, the Belt
  for (const [col, op] of [[0xf2c14e, .34], [0xd8d8d8, .24], [0xb09a80, .17]]) { const SEG = 14000, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 12), 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('oq', new THREE.BufferAttribute(new Float32Array(SEG * 12), 3).setUsage(THREE.DynamicDrawUsage));
    const os = new Float32Array(SEG * 4), ot = new Float32Array(SEG * 4), ix = new Uint32Array(SEG * 6);
    for (let i = 0; i < SEG; i++) { os.set([-1, 1, 1, -1], i * 4); ot.set([-1, 1, -1, 1], i * 4); const v = i * 4; ix.set([v, v + 1, v + 3, v, v + 3, v + 2], i * 6); }
    g.setAttribute('os', new THREE.BufferAttribute(os, 1)); g.setAttribute('ot', new THREE.BufferAttribute(ot, 1)); g.setAttribute('oa', new THREE.BufferAttribute(new Float32Array(SEG * 4), 1).setUsage(THREE.DynamicDrawUsage)); g.setIndex(new THREE.BufferAttribute(ix, 1)); g.setDrawRange(0, 0);
    const l = new THREE.Mesh(g, orbitMat(col, op)); l.frustumCulled = false; l.renderOrder = 1; scene.add(l); orbitL.push({ l, a: g.attributes.position.array, q: g.attributes.oq.array, al: g.attributes.oa.array, n: 0 }); }
  rocksG = new THREE.Group(); scene.add(rocksG);
  GEO.rock = jitterGeo(new THREE.IcosahedronGeometry(1, 1), .55, 3.1, .62); GEO.shard = jitterGeo(new THREE.IcosahedronGeometry(1, 0), .8, 7.7, .35);
  MAT.rock = new THREE.MeshStandardMaterial({ color: 0x4a423c, roughness: .95, metalness: .05, flatShading: true });
  MAT.veinOre = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: .85, metalness: .2, flatShading: true, emissive: 0xe0995a, emissiveIntensity: .32 });
  MAT.veinHe = new THREE.MeshStandardMaterial({ color: 0x2e2f36, roughness: .7, metalness: .3, flatShading: true, emissive: 0x7ff3ff, emissiveIntensity: .3 });
  debrisM = new Inst(GEO.shard, new THREE.MeshStandardMaterial({ color: 0x3a3436, roughness: .8, metalness: .4, flatShading: true }), 4000, false); scene.add(debrisM.m);
  shipsG = new THREE.Group(); scene.add(shipsG);
  // turrets: one instanced mesh per part across every hull
  // a turret: an eight-sided barbette with a chamfered top, and round barrels with a muzzle collar
  const tb = mergeGeometries([new THREE.CylinderGeometry(.82, 1.1, .5, 8).translate(0, .25, 0), new THREE.CylinderGeometry(.55, .82, .14, 8).translate(0, .57, 0)]); tb.computeVertexNormals();
  const tbr = mergeGeometries([new THREE.CylinderGeometry(.5, .5, 1, 8).rotateZ(PI / 2).translate(.5, .5, 0), new THREE.CylinderGeometry(.68, .68, .1, 8).rotateZ(PI / 2).translate(.95, .5, 0)]); tbr.computeVertexNormals();
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, .5, 0);
  turretM.base = new Inst(tb, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .6, roughness: .45 }), 8000, true);
  turretM.barrel = new Inst(tbr, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .5, roughness: .4 }), 16000, true);
  turretM.box = new Inst(box, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .5, roughness: .5 }), 8000, true);
  // missiles: 3-D bodies, one instanced mesh per kind, the fins and bands tinted per instance (hulls.js)
  missileM.std = new Inst(missileGeoOf('std'), missileMaterial(), 2000, true); missileM.emp = new Inst(missileGeoOf('emp'), missileMaterial(), 600, true); missileM.nuke = new Inst(missileGeoOf('nuke'), missileMaterial(), 300, true);
  for (const m of Object.values(missileM)) { m.m.castShadow = false; scene.add(m.m); }
  for (const t of Object.values(turretM)) scene.add(t.m);
  B.smoke = new Batch(TEX.smoke, { add: false, order: 8 }); B.soot = new Batch(TEX.smoke, { add: false, ground: true, order: 12, cap: 3000 }); /* scorch marks on hulls */ B.dot = new Batch(TEX.dot, { order: 12 }); B.glow = new Batch(TEX.glow, { order: 13, cap: 3000 });
  B.streak = new Batch(TEX.streak, { ground: true, ax: -.5, order: 11 }); B.plume = new Batch(TEX.plume, { ground: true, ax: -.5, order: 10, cap: 3000 }); B.missile = new Batch(TEX.missile, { add: false, ground: true, order: 11, cap: 2000 }); B.fins = new Batch(TEX.fins, { add: false, ground: true, order: 11, cap: 2000 }); B.anam = new Batch(TEX.anam, { order: 13, cap: 300 }); B.sglow = new Batch(TEX.sunglow, { order: 13, cap: 1500 }); // the soft wide glow of a flash or a fireball
  B.fire = new Batch(TEX.fire, { order: 14, cap: 2000 }); B.shock = new Batch(TEX.shock, { ground: true, order: 9, cap: 600 }); B.hex = new Batch(TEX.hex, { order: 13, cap: 600 }); B.spark = new Batch(TEX.spark, { ground: true, ax: -.5, order: 11, cap: 4000 });
  for (const b of Object.values(B)) scene.add(b.mesh);
  buildPost();
  setBloom(S.bloom);
  window.__BODIES = BODIES; window.__CAM = { projectTo, toWorld, footprint }; window.__R = { scene, B, orbitL, PUNCH, cometPos, COMETS, get bodyVis() { return bodyVis; }, rocksG, shipsG, bodiesG, turretM, debrisM, bgMesh, get renderer() { return renderer; }, get bloom() { return bloomPass; }, get gen() { return GEN; }, get shipVis() { return shipVis; }, mountClear, clearAt };
  return renderer;
}
function sizeOverlay() { ov.width = Math.round(S.W * ODPR); ov.height = Math.round(S.H * ODPR); ov.style.width = S.W + 'px'; ov.style.height = S.H + 'px'; }
// post-processing: an HDR target with MSAA, bloom, tone mapping, then SMAA on Ultra
function buildPost() {
  if (composer) composer.dispose();
  composer = null; bloomPass = null;
  const P = preset();
  try {
    const samples = P.msaa ? 4 : 0; // WebGPU multisamples at 1 or 4
    const scenePass = TSL.pass(scene, camera, { samples }), col = scenePass.getTextureNode('output');
    bloomPass = bloom(col, .7 * ((S.gx && S.gx.bloomK) ?? 1), .62, .78); // bright light blooms: flashes, plumes, glints, the Sun; a soft knee so it rolls on rather than snapping
    bloomPass.smoothWidth.value = .4; bloomPass.bloomTintColors[3].set(1, .96, .9); bloomPass.bloomTintColors[4].set(1, .92, .84); // the widest halos run a little warm
    composer = new THREE.RenderPipeline(renderer);
    // tone mapping and sRGB at the end (renderOutput), then SMAA on Ultra over the display image
    const finish = n => P.smaa ? smaa(TSL.renderOutput(n)) : n;
    composer.outputColorTransform = !P.smaa;
    // lens dirt: a faint field of specks and smears that only shows where the bloom is bright
    const dirt = TSL.texture(TEX.dirt || (TEX.dirt = tex(dirtC()))), dirtK = TSL.smoothstep(.05, .6, TSL.luminance ? TSL.luminance(bloomPass.rgb) : bloomPass.r.add(bloomPass.g).add(bloomPass.b).div(3));
    composer.dirtU = TSL.uniform(.9); // graphics menu: dirt off = 0, cinematic = 1.6
    composer.outs = { on: finish(col.add(bloomPass).add(bloomPass.mul(dirt.r).mul(dirtK).mul(composer.dirtU))), off: finish(col) };
    composer.outputNode = composer.outs.off;
  } catch (e) { console.warn('post-processing unavailable', e); composer = null; bloomPass = null; }
  setBloom(S.bloom);
}
export function applyQuality() { // after the preset changes
  if (!renderer) return;
  DPR = Math.min(preset().dpr, window.devicePixelRatio || 1); renderer.setPixelRatio(DPR); renderer.setSize(S.W, S.H); buildPost();
  if (GEN.workers.length || GEN.fallback) upgradePlanets();
}
export function setBloomK(k) { if (bloomPass) bloomPass.strength.value = .85 * k; }
export function setSky(k) { if (bgMesh) bgMesh.material.uniforms.nk.value = k; }
export function setBloom(on) { S.bloom = on && !!composer; if (composer) { const o = S.bloom ? composer.outs.on : composer.outs.off; if (composer.outputNode !== o) { composer.outputNode = o; composer.needsUpdate = true; } } }
// the main menu draws its attract battle at half resolution: the menu covers most of it, and a laptop GPU (or a
// software renderer) keeps the menu responsive
let LOWRES = false;
export function setLowRes(on) { if (!renderer || LOWRES === !!on) return; LOWRES = !!on; const k = on ? .5 : 1; renderer.setPixelRatio(DPR * k); renderer.setSize(S.W, S.H); } // the pipeline follows the renderer's size
export function resizeRender() { if (!renderer) return; renderer.setSize(S.W, S.H); sizeOverlay(); }

// ---------------------------------------------------------------- world surfaces, painted off the main thread
// Every world gets a quick 512-wide map first, then the ones you will fly close to get a sharper one. Nearest first.
const GEN = { q: [], workers: [], idle: [], fallback: false, have: {}, busyMain: false };
function dataTex(data, W, H, srgb = true) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = Math.min(preset().aniso, renderer ? renderer.getMaxAnisotropy() : 4); t.needsUpdate = true; return t;
}
function heightTex(data, W, H) { const t = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType); t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; }
function initGen() {
  const n = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  if (/noworker/.test(location.search)) GEN.fallback = true;
  else try { for (let i = 0; i < n; i++) { const w = new Worker(new URL('./planetgen.js', import.meta.url), { type: 'module' });
      w.onmessage = e => { w.job = null; GEN.idle.push(w); genDone(e.data); pump(); };
      w.onerror = err => { console.warn('planet worker failed; painting on the main thread', err.message || err); GEN.fallback = true; if (w.job) GEN.q.push(w.job); w.job = null; pump(); };
      GEN.workers.push(w); GEN.idle.push(w); } }
  catch (e) { console.warn('no workers; painting on the main thread', e); GEN.fallback = true; }
  queueBodies();
}
function queueBodies() {
  for (const b of BODIES) { if (!b.id || GEN.req?.has(b.id)) continue; (GEN.req ||= new Set()).add(b.id);
    GEN.q.push({ id: b.id, W: b.r < 300 ? 256 : 512 }); if (HI[b.id] && HI[b.id] > 512) GEN.q.push({ id: b.id, W: HI[b.id], hi: 1 }); }
  upgradePlanets();
}
// the sharpest maps the preset allows, painted last, nearest world first (Ultra: 4096 wide for the great worlds)
function upgradePlanets() {
  const P = preset().planet || {}; GEN.up ||= {};
  for (const b of BODIES) { if (!b.id || !HI[b.id]) continue; const W = HI[b.id] >= 1536 ? P.big : P.small;
    if (W && W > HI[b.id] && (GEN.up[b.id] || 0) < W) { GEN.up[b.id] = W; GEN.q.push({ id: b.id, W, hi: 2 }); } }
  pump();
}
function pump() {
  if (!GEN.q.length) return;
  const cx = S.cam.x, cy = S.cam.y, dist = j => { const b = BODIES.find(o => o.id === j.id); return (j.hi || 0) * 1e12 + (b ? Math.max(0, hyp(b.x - cx, b.y - cy) - b.r) : 1e15); };
  GEN.q.sort((a, b) => dist(a) - dist(b));
  if (GEN.fallback) { if (GEN.busyMain) return; GEN.busyMain = true; setTimeout(() => { const j = GEN.q.shift(); if (j) genDone({ id: j.id, ...generate(j.id, j.W) }); GEN.busyMain = false; pump(); }, 30); return; }
  while (GEN.idle.length && GEN.q.length) { const w = GEN.idle.pop(), j = GEN.q.shift(); w.job = j; w.postMessage(j); }
}
function genDone(r) {
  const prev = GEN.have[r.id]; if (prev && prev.W >= r.W) return;
  const t = { W: r.W, H: r.H, map: dataTex(r.day, r.W, r.H), night: r.night ? dataTex(r.night, r.W, r.H) : null, clouds: r.clouds ? dataTex(r.clouds, r.cW, r.cH) : null, hgt: r.hgt ? heightTex(r.hgt, r.W, r.H) : null, hgtArr: r.hgt || null };
  GEN.have[r.id] = t;
  if (prev) { for (const k of ['map', 'night', 'clouds', 'hgt']) if (prev[k]) prev[k].dispose(); if (prev.geo) prev.geo.dispose(); }
  for (const v of bodyVis) if (v.b.id === r.id) applySurface(v);
  if (!PORT[r.id]) setTimeout(() => portrait(r.id), 0);
}
// a world's portrait for the battle prompt: its own painted surface on a lit sphere, rendered once off screen
const PORT = {};
// WebGPU reads pixels back asynchronously: the first ask starts the render and answers null; the picture is ready
// a frame or two later (genDone also warms each world's portrait as soon as its surface is painted)
const PORT_BUSY = new Set();
export function portrait(id, size = 168) {
  if (PORT[id]) return PORT[id];
  const t = GEN.have[id]; if (!t || !renderer || PORT_BUSY.has(id)) return null;
  PORT_BUSY.add(id); paintPortrait(id, t, size).catch(e => console.warn('portrait', id, e)).finally(() => PORT_BUSY.delete(id));
  return null;
}
async function paintPortrait(id, t, size) {
  const RS = 192; // a 256-byte-aligned row (192 × 4), which WebGPU's copy to a buffer needs; scaled to size after
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, .1, 10); cam.position.set(0, 0, 4.15);
  const geo = new THREE.SphereGeometry(1, 64, 48), rot = new THREE.Euler(.3, -.9 - (id.length % 5) * .5, 0), mats = [];
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t.map, roughness: .92, metalness: 0 })); m.rotation.copy(rot); sc.add(m); mats.push(m.material);
  if (t.clouds) { const c = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t.clouds, transparent: true, depthWrite: false, roughness: 1 })); c.scale.setScalar(1.012); c.rotation.copy(rot); sc.add(c); mats.push(c.material); }
  const L = new THREE.DirectionalLight(0xfff4e6, 3); L.position.set(-2.2, 1.1, 2.4); sc.add(L); sc.add(new THREE.AmbientLight(0x5a6478, .25));
  const rt = new THREE.RenderTarget(RS, RS); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevT = renderer.getRenderTarget(), prevC = new THREE.Color(), prevA = renderer.getClearAlpha(); renderer.getClearColor(prevC);
  let px;
  try {
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
  } finally { renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA); }
  try { px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, RS, RS); }
  finally { rt.dispose(); geo.dispose(); for (const mm of mats) mm.dispose(); }
  const stride = px.length / RS, flip = !!renderer.backend.isWebGLBackend; // WebGL reads bottom row first; WebGPU top first
  const [c0, g0] = canvas(RS, RS), img = g0.createImageData(RS, RS);
  for (let y = 0; y < RS; y++) { const sy = flip ? RS - 1 - y : y; img.data.set(px.subarray(sy * stride, sy * stride + RS * 4), y * RS * 4); }
  g0.putImageData(img, 0, 0);
  const [c, g] = canvas(size, size); g.imageSmoothingQuality = 'high'; g.drawImage(c0, 0, 0, size, size);
  PORT[id] = c.toDataURL();
}
function applySurface(v) {
  const t = GEN.have[v.b.id]; if (!t) return;
  const U = v.mesh.material.uniforms; U.map.value = t.map; if (U.night) { U.night.value = t.night; U.hasNight.value = t.night ? 1 : 0; }
  if (U.texel) U.texel.value.set(1 / t.W, 2 / t.W); if (U.hmap) { U.hmap.value = t.hgt; U.hasH.value = t.hgt ? 1 : 0; } if (U.clouds) { U.clouds.value = t.clouds; U.hasClouds.value = t.clouds ? 1 : 0; }
  if (t.clouds) { if (!v.clouds) { v.clouds = new THREE.Mesh(GEO.sphere, cloudMat({ storms: v.b.id === 'earth' ? STORMS.earthClouds : null, lightning: v.b.id === 'earth' || v.b.id === 'venus' })); v.clouds.scale.setScalar(1.012); v.clouds.renderOrder = 2; v.g.add(v.clouds); } v.clouds.material.uniforms.map.value = t.clouds; }
  // the ground itself (model builder's hook): the mesh raised by the height field, small bodies lumpy; gas giants and the Sun stay round
  if (!v.b.gas && v.b.kind !== 'star' && (t.hgtArr || (v.b.km || 1e4) < 300)) { if (!t.geo) t.geo = planetGeo(t.hgtArr, t.W, t.H, { km: v.b.km || 1e4, amp: t.clouds ? .009 : .013, seg: t.W >= 1536 ? 256 : t.W >= 1024 ? 192 : 128, seed: [...v.b.id].reduce((a, c) => a + c.charCodeAt(0), 0) }); if (v.mesh.geometry !== t.geo) v.mesh.geometry = t.geo; }
  v.mesh.visible = true;
}
// the outline of a world as the camera really sees it: the sphere's horizon circle (a sphere under perspective is
// wider than r·k at its centre and sits off its projected centre) sampled and projected to the screen, so an overlay
// ring drawn through these points hugs the disc at every zoom. n points; out[i] = {x, y}; also returns {cx, cy} of the ring
export function silhouette(x, y, r, n = 48, out = []) {
  const d0 = camDist(), [ox, oy, oz] = camOffset(d0), cx = S.cam.x + ox, ch = oy, cy = S.cam.y + oz; // the camera, in world x / height / world y
  let ux = x - cx, uh = -ch, uy = y - cy; const dd = hyp(ux, uh, uy); if (dd <= r * 1.001) return null; ux /= dd; uh /= dd; uy /= dd;
  const t = dd - r * r / dd, rho = r * Math.sqrt(dd * dd - r * r) / dd, hx = cx + ux * t, hh = ch + uh * t, hy = cy + uy * t; // the horizon circle: centre and radius
  let e1x = uy, e1h = 0, e1y = -ux; const l1 = hyp(e1x, e1y) || 1; e1x /= l1; e1y /= l1; // e1 = u × up (up = height axis), e2 = u × e1
  const e2x = uh * e1y - uy * e1h, e2h = uy * e1x - ux * e1y, e2y = ux * e1h - uh * e1x;
  let sx = 0, sy = 0; const o = { x: 0, y: 0, k: 0, ok: false };
  for (let i = 0; i < n; i++) { const a = i / n * TAU, c = Math.cos(a) * rho, s2 = Math.sin(a) * rho;
    projectTo(o, hx + e1x * c + e2x * s2, hy + e1y * c + e2y * s2, hh + e1h * c + e2h * s2); if (!o.ok) return null;
    const p = out[i] || (out[i] = { x: 0, y: 0 }); p.x = o.x; p.y = o.y; sx += o.x; sy += o.y; }
  out.length = n; out.cx = sx / n; out.cy = sy / n; return out;
}
// a far world's point of light: on while its disc is under a few pixels, fading out as the disc grows
const GL_Q = new THREE.Quaternion(), GL_N = new THREE.Vector3();
function glintFor(v, x, y, rpx, z, on) {
  if (!v.glint) return; const k = clamp((6 - rpx) / 4, 0, 1); v.glint.visible = on && k > 0; if (!v.glint.visible) return;
  v.glint.position.set(x, 0, y); const gs = (14 + 6 * clamp(rpx, 0, 2)) / z; v.glint.scale.set(gs, gs, 1); v.glint.material.opacity = k * .85;
}
// the ring and its world share the ring's plane and the Sun: for the ring's lit face and the shadow it casts on the ground
function ringUniforms(v, x, y, pr, sunP) {
  const R = v.ring.material.uniforms; R.sunPos.value.copy(sunP); R.C.value.set(x, 0, y); R.pr.value = pr;
  v.g.updateMatrixWorld(); v.g.getWorldQuaternion(GL_Q); GL_N.set(0, 1, 0).applyQuaternion(GL_Q); R.N.value.copy(GL_N);
  const U = v.mesh.material.uniforms; if (U.ringN) { U.ringN.value.copy(GL_N); const RS = v.ringSpec || RINGS.saturn; U.ringR.value.set(RS.r0, RS.r1); }
}
const UV = (lat, lon) => [(lon + 180) / 360, (lat + 90) / 180];
const STORMS = { // the giants' named storms, on their painted positions (planetgen: JUP_GRS, JUP_OVALS, NEP_GDS); Saturn's a polar vortex and a white spot
  jupiter: [[...UV(-22, 40), 16 / 360, 9 / 180, .05], [...UV(-33, 60), 4 / 360, 3 / 180, -.12], [...UV(-33, 90), 4 / 360, 3 / 180, -.1], [...UV(-33, 120), 4 / 360, 3 / 180, -.13], [...UV(40, -60), 4 / 360, 3 / 180, .11]],
  neptune: [[...UV(-22, 30), 11 / 360, 8 / 180, -.07]],
  saturn: [[...UV(-38, 110), 7 / 360, 4 / 180, .09]],
  earthClouds: [[...UV(38, -45), 14 / 360, 11 / 180, .06], [...UV(-42, 95), 13 / 360, 10 / 180, -.055], [...UV(18, 140), 8 / 360, 7 / 180, -.09], [...UV(50, 160), 12 / 360, 9 / 180, .05]], // extratropical cyclones and a typhoon
};
// the colour a world throws back onto hulls near it (its albedo, roughly), for the hemisphere light
const WORLD_LIGHT = { mercury: 0x8a8278, venus: 0xe8c890, earth: 0x6a9ad8, luna: 0x8fa890, mars: 0xc8784a, phobos: 0x6a5a50, deimos: 0x6a5a50, jupiter: 0xd8b890, io: 0xd8c060, europa: 0xb8c8d8, ganymede: 0x9a9890, callisto: 0x7a7470, saturn: 0xe8d8a8, titan: 0xd8a860, rhea: 0xb8b8c0, uranus: 0x9ad8e0, neptune: 0x5a80e0, triton: 0xc8c0c0, pluto: 0xb8a898 };
function worldLight(cx, cy) { // the nearest world weighted by how large it looms: light from below the hulls in its colour
  const H = scene.userData.hemi; if (!H) return; let best = null, bk = 0; for (const b of BODIES) { if (b.kind === 'star') continue; const d = hyp(b.x - cx, b.y - cy); const k = clamp(b.r * 3 / Math.max(d, b.r), 0, 1); if (k > bk) { bk = k; best = b; } }
  if (!best || bk < .02) { H.intensity = 0; return; } H.groundColor.set(WORLD_LIGHT[best.id] || 0x8a8a90); H.intensity = bk * 1.1; H.position.set(0, 1, 0); }
// rotation periods in days (negative = retrograde); moons are tidally locked and keep one face to their parent
const ROT_DAYS = { mercury: 58.6, venus: -243, earth: 1, mars: 1.03, jupiter: .41, saturn: .44, uranus: -.72, neptune: .67, pluto: -6.4, ceres: .38, vesta: .22, pallas: .32 };
// the campaign's clock read off Earth's place in its orbit (one lap a year, 52 turns), plus the wall clock turning the
// worlds slowly between turns: a world's face in the map is where that many days of spin would leave it
function spinPhase(b, L, i) { const E = L && L.pos.earth, sp = L && L.pos.sun; const weeks = E ? ((Math.atan2(E.y - sp.y, E.x - sp.x) + TAU) % TAU) / TAU * 52 : 0;
  const P = ROT_DAYS[b.id] || (b.gas ? .45 : 1.2 + (i % 5) * .6), days = weeks * 7, wall = performance.now() / 1000 / clamp(Math.abs(P) * 160, 70, 300); // a wall-clock day of spin every 160 s times the period, but every world turns visibly: a lap in 70–300 s
  return (days / P + wall * Math.sign(P)) * TAU; }
// a moon keeps one face to its parent, but in the map its parent does not move round the Sun between turns, so it turns slowly on the wall clock too (a lap in four minutes) so as not to look painted on
const moonSpin = () => performance.now() / 1000 / 240 * TAU;
// a moon in its parent's shadow: how deep (0..1), by how close it sits to the Sun-parent line on the far side
function eclipseK(mx, my, px, py, pr, sunP) { let lx = px - sunP.x, ly = py - sunP.z; const l = hyp(lx, ly) || 1; lx /= l; ly /= l; const dx = mx - px, dy = my - py, t = dx * lx + dy * ly; if (t <= 0) return 0;
  const perp = Math.abs(dx * ly - dy * lx), um = pr * (1 - t / (l * 1.1)); return clamp((pr * 1.15 - perp) / (pr * 1.15 - Math.max(um, pr * .5) + 1e-6), 0, 1) * (perp < pr * 1.15 ? 1 : 0); }
// auroral ovals: Earth's green, the giants' violet-blue (seen by Hubble in ultraviolet; here given a little visible colour)
const AURORA = { earth: [.3, 1, .55], jupiter: [.55, .45, 1], saturn: [.5, .6, 1] };
// fill a world's moon-shadow slots: moons on the sunward side, close enough to the Sun's line to fall on the disc
const MS_L = new THREE.Vector3(), MS_D = new THREE.Vector3();
function moonShadows(v, x, y, pr, sunP, posOf) {
  const U = v.mesh.material.uniforms; if (!U.m0) return; const slots = [U.m0, U.m1, U.m2, U.m3]; let n = 0;
  MS_L.set(sunP.x - x, 0, sunP.z - y).normalize();
  for (const j of v.moons) { if (n >= 4) break; const m = BODIES[j], P = posOf(m); if (!P) continue; const mx = P.x - O.x, my = P.y - O.y;
    MS_D.set(mx - x, 0, my - y); const t = MS_D.dot(MS_L); if (t <= 0) continue; MS_D.addScaledVector(MS_L, -t); if (MS_D.length() > pr * 1.05 + m.r * 2) continue;
    slots[n++].value.set(mx, 0, my, m.r); }
  for (; n < 4; n++) slots[n].value.w = 1e-6;
}
// the worlds' axes lean back from the camera so their equators, where the lore puts so much, face you;
// Uranus rolls on its side
const TILT = { uranus: -1.55, saturn: -.5, io: -.75, europa: -.7, ganymede: -.7, luna: -.95 };
// and each starts turned so its signature ground faces you: Helios, Tharsis and Agea, Hyperion, Sungrave, the Great Red Spot …
const FACE = { mercury: 0, venus: 110, earth: -45, mars: -95, luna: 18, io: 0, europa: 0, ganymede: 40, callisto: -56, titan: 80, jupiter: 40, triton: 0, ceres: 20, pluto: 175, iapetus: 0, rhea: 0, phobos: 0 };
function buildBodies() {
  bodyVerSeen = S.bodyVer || 0; for (const ch of bodiesG.children.slice()) bodiesG.remove(ch); bodyVis = [];
  const sph = GEO.sphere || (GEO.sphere = new THREE.SphereGeometry(1, 256, 128)); // smooth limbs up close
  BODIES.forEach((b, i) => {
    const pal = b.pal || { c: ['#888888', '#777777', '#444444'] };
    const v = { b, g: new THREE.Group(), spin: (b.gas ? .01 : .003) * (i % 2 ? 1 : -.8), tilt: TILT[b.id] ?? -.6, face: -PI / 2 - (FACE[b.id] ?? (i * 47) % 360) * PI / 180, cspin: b.id === 'venus' ? .03 : (i % 3 - 1) * .002 + .004 }; // Venus's deck super-rotates: round in four days
    if (b.kind === 'star') {
      v.mesh = new THREE.Mesh(sph, sunMat());
      const gm = new THREE.SpriteMaterial({ map: TEX.sunglow, color: 0xffc870, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: .8 });
      v.glow = new THREE.Sprite(gm); v.glow.renderOrder = 2; bodiesG.add(v.glow);
      const cm = new THREE.SpriteMaterial({ map: TEX.corona, color: 0xffd9a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: .55 });
      v.corona = new THREE.Sprite(cm); v.corona.renderOrder = -1; bodiesG.add(v.corona); // the corona, behind everything but the sky
    } else {
      v.moons = []; BODIES.forEach((m, j) => { if (m.kind === 'moon' && m.parent === i) v.moons.push(j); });
      v.mesh = new THREE.Mesh(sph, planetMat(pal.atmo || [180, 180, 190], { gas: b.gas, air: !!pal.atmo && !b.gas, ring: !!(RINGS[b.id] || pal.ring), aurora: AURORA[b.id], moons: v.moons.length > 0, storms: STORMS[b.id], lightning: b.id === 'jupiter' || b.id === 'saturn', bump: b.gas ? 0 : b.id === 'earth' || b.id === 'venus' || b.id === 'titan' ? .55 : 1 }));
      if (pal.atmo && !b.dwarf && b.r > 250) { v.atmo = new THREE.Mesh(sph, atmoMat(pal.atmo, b.gas ? .75 : b.kind === 'moon' ? .55 : 1)); v.atmoK = b.gas ? 1.07 : 1.12; v.atmo.renderOrder = 3; bodiesG.add(v.atmo); }
      const RS = RINGS[b.id] || (pal.ring ? RINGS.saturn : null); // the four giants carry rings; a palette's ring flag means Saturn's
      if (RS) { const rg = new THREE.RingGeometry(RS.r0, RS.r1, 192, 1), rt = TEX.rings[b.id] || TEX.ring; v.ring = new THREE.Mesh(rg, ringMat(rt)); v.ringSpec = RS; const RU = v.ring.material.uniforms; RU.r0.value = RS.r0; RU.r1.value = RS.r1; RU.dust.value = RS.dust;
        v.ring.rotation.x = -PI / 2; v.ring.renderOrder = 4; v.g.add(v.ring); const MU = v.mesh.material.uniforms; MU.ringMap.value = rt; MU.ringR.value.set(RS.r0, RS.r1); MU.ringK.value = RS.shadow; }
      // seen from far enough that its disc is a pixel or two, a world is a point of light in its own colour
      const gc = new THREE.Color(pal.c[1] || pal.c[0] || '#cccccc').lerp(new THREE.Color(1, 1, 1), .35);
      v.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glint, color: gc, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })); v.glint.renderOrder = 5; v.glint.visible = false; bodiesG.add(v.glint);
      if (b.id === 'phobos') { v.extra = phobosDocks(); v.traffic = phobosTraffic(1.38); v.extra.add(v.traffic.g); }
    }
    v.mesh.visible = false; v.g.add(v.mesh); if (v.extra) v.g.add(v.extra);
    bodiesG.add(v.g); bodyVis.push(v); applySurface(v);
  });
  if (GEN.workers.length || GEN.fallback) queueBodies();
}
// Phobos: two great docks girdling the moon at right angles, red lights for incoming ships, and the Needles,
// starscrapers of the Hive reaching up toward them
// Ganymede's 200 km of docks, centred on the Ganymede dockyard as it orbits, in its owner's colours
let GD = null;
function ganymedeYard(O, z) {
  const b = BODIES.find(o => o.id === 'ganymede'); if (!b) return;
  const D = S.ships.find(s => s.type === 'dockyard' && s.world === 'ganymede' && !s.dead), team = D ? D.team : GD ? GD.team : 2;
  if (!GD || GD.team !== team || GD.b !== b) { if (GD) bodiesG.remove(GD.g);
    const Y = ganymedeDocks(b.r + 200, b.r, structMats(team, false), shipMats3('dread', team).n, facKey(team) || 'rim'); GD = { ...Y, team, b, ang: 0 }; bodiesG.add(GD.g); }
  if (D) GD.ang = Math.atan2(D.y - b.y, D.x - b.x);
  const on = onScr(b.x, b.y, (b.r + 900) * z * 2) && b.r * z > .25; GD.g.visible = on; if (!on) return;
  GD.g.position.set(b.x - O.x, 0, b.y - O.y); GD.g.rotation.y = -GD.ang; GD.update(S.time);
}
// the Dockyards of Venus (model builder's hook, like Ganymede's): the Carthii's crown of columns, centred on the Venus dockyard
let VD = null;
function venusYard(O, z) {
  const b = BODIES.find(o => o.id === 'venus'); if (!b) return;
  const D = S.ships.find(s => s.type === 'dockyard' && s.world === 'venus' && !s.dead), team = D ? D.team : VD ? VD.team : 1;
  if (!VD || VD.team !== team || VD.b !== b) { if (VD) bodiesG.remove(VD.g);
    const M = structMats(team, false), gold = new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: .85, roughness: .3, emissive: 0x3a2a08, emissiveIntensity: .4 });
    const Y = venusDocks(b.r + 600, b.r, M, shipMats3('dread', team).n, facKey(team) || 'soc', gold); VD = { ...Y, team, b, ang: 0 }; bodiesG.add(VD.g); }
  if (D) VD.ang = Math.atan2(D.y - b.y, D.x - b.x);
  const on = onScr(b.x, b.y, (b.r + 1000) * z * 2) && b.r * z > .25; VD.g.visible = on; if (!on) return;
  VD.g.position.set(b.x - O.x, 0, b.y - O.y); VD.g.rotation.y = -VD.ang; VD.update(S.time);
}
// the same two dockyards on the campaign map, in their campaign owner's colours (the battle has no owners there, the
// campaign has no S.ships): rebuilt when the world changes hands, hidden in battle, turning slowly as the lights work
const YD = {}, goldMat = () => MAT.ydgold || (MAT.ydgold = new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: .85, roughness: .3, emissive: 0x3a2a08, emissiveIntensity: .4 }));
function ownerStyle(id) { const w = CAMP.on && CAMP.worlds && CAMP.worlds[id]; if (!w) return null; const o = w.owner, F = o !== 'neu' && FACTIONS[BLOCS[o]]; return { key: o, fac: F ? BLOCS[o] : 'none', col: F ? F.col : NEUTRAL_C }; }
function orreryYard(id, L, z) {
  const P = L.pos[id], st = ownerStyle(id); let Y = YD[id]; if (!P || !st) { if (Y) Y.g.visible = false; return; }
  if (Y && (Y.key !== st.key || Y.r !== P.r || Y.ver !== bodyVerSeen)) { bodiesG.remove(Y.g); Y = YD[id] = null; }
  if (!Y) { const M = structMatsC('yd:' + st.key, st.col, false), H = mats3('dread', st.fac, st.col, 'Y:' + st.fac + ':' + st.col.main).n;
    const G = id === 'venus' ? venusDocks(P.r + 600, P.r, M, H, st.fac === 'none' ? 'core' : st.fac, goldMat()) : ganymedeDocks(P.r + 200, P.r, M, H, st.fac === 'none' ? 'rim' : st.fac);
    Y = YD[id] = { ...G, key: st.key, r: P.r, ver: bodyVerSeen }; bodiesG.add(Y.g); }
  const on = onScr(P.x, P.y, (P.r + 1000) * z * 2) && P.r * z > .25; Y.g.visible = on; if (!on) return;
  const t = performance.now() / 1000; Y.g.position.set(P.x - O.x, 0, P.y - O.y); Y.g.rotation.y = t * .012; Y.update(t);
}
const yardsHide = () => { for (const Y of Object.values(YD)) if (Y) Y.g.visible = false; };
function phobosDocks() {
  const g = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0x2c2d33, metalness: .7, roughness: .4 }), lit = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2a1a, emissiveIntensity: 2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0xd8d8d0, emissiveIntensity: .35 });
  for (const rot of [[PI / 2, 0, 0], [0, 0, 0]]) {
    const r = new THREE.Group(); r.rotation.set(...rot);
    r.add(new THREE.Mesh(new THREE.TorusGeometry(1.38, .05, 8, 96), metal));
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(.018, 6, 4), lit, 40), o = new THREE.Object3D();
    for (let i = 0; i < 40; i++) { const a = i / 40 * TAU; o.position.set(Math.cos(a) * 1.38, Math.sin(a) * 1.38, .055); o.updateMatrix(); lights.setMatrixAt(i, o.matrix); }
    r.add(lights);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + .3, sp = new THREE.Mesh(new THREE.BoxGeometry(.03, .38, .03), metal); sp.position.set(Math.cos(a) * 1.19, Math.sin(a) * 1.19, 0); sp.rotation.z = a - PI / 2; r.add(sp); } // pylons down to the surface
    g.add(r);
  }
  const rnd = seeded(77), cone = new THREE.ConeGeometry(.011, 1, 4); cone.translate(0, .5, 0);
  const nd = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: 0x5a5c66, metalness: .8, roughness: .3, emissive: 0xffd8a8, emissiveIntensity: .08 }), 70), o = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 70; i++) { const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(); o.position.copy(d).multiplyScalar(.97); o.quaternion.setFromUnitVectors(up, d); const h = .05 + rnd() * rnd() * .2; o.scale.set(1 + rnd(), h, 1 + rnd()); o.updateMatrix(); nd.setMatrixAt(i, o.matrix); }
  g.add(nd);
  return g;
}
function buildRocks() {
  nodesRef = S.nodes; fieldsRef = S.fields; for (const g of rockGroups) { rocksG.remove(g.grp); g.list.forEach(m => m.dispose()); } rockGroups = [];
  const mk = (x, y, rocks, R, node) => {
    const grp = new THREE.Group(), plain = rocks.filter(r => !r.vein), vein = rocks.filter(r => r.vein), list = [];
    for (const [set, mat] of [[plain, MAT.rock], [vein, node && node.kind === 'ore' ? MAT.veinOre : MAT.veinHe]]) {
      if (!set.length) continue; const m = new THREE.InstancedMesh(GEO.rock, mat, set.length); m.frustumCulled = false; const o = new THREE.Object3D();
      set.forEach((r, i) => { const rnd = seeded(i * 131 + set.length * 7 + (r.pts.length * 1000 | 0)); let rr = r.r; if (!rr) { rr = 0; for (let j = 0; j < r.pts.length; j += 2) rr += hyp(r.pts[j], r.pts[j + 1]); rr /= r.pts.length / 2; }
        const rx = node ? r.x : r.x - x, ry = node ? r.y : r.y - y; o.position.set(rx, (rnd() - .5) * rr * .5, ry); o.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU); o.scale.set(rr * (.8 + rnd() * .4), rr * (.6 + rnd() * .4), rr * (.8 + rnd() * .4)); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
      grp.add(m); list.push(m);
    }
    rocksG.add(grp); rockGroups.push({ grp, x, y, R, list, f: node ? null : cur });
  };
  let cur = null; for (const f of S.fields) { if (f.hulk) continue; cur = f; mk(f.x, f.y, f.rocks, f.r, null); } cur = null; // hulks are drawn as their hulls
  for (const n of S.nodes) mk(n.x, n.y, n.rocks, n.r + 60, n);
}

// ---------------------------------------------------------------- 2D overlay (UI marks over the 3D view)
// Mimics the old Graphics API. ground(): world points on the plane, projected. flat(x, y): world offsets around an
// anchor, laid flat on the screen (bars, flags). screen(): pixels.
const T2 = [0, 0];
class G2 {
  constructor() { this.mode = 0; this.fresh = true; this.ax = this.ay = this.sx = this.sy = 0; this.k = 1; this.z = 1; }
  ground() { this.mode = 0; return this; }
  screen() { this.mode = 1; return this; }
  flat(x, y, h = 0) { projectTo(Q, x, y, h); this.mode = 2; this.ax = x; this.ay = y; this.sx = Q.x; this.sy = Q.y; this.k = Q.k; return Q.ok; }
  p(x, y) { if (this.mode === 1) { T2[0] = x; T2[1] = y; } else if (this.mode === 2) { T2[0] = this.sx + (x - this.ax) * this.k; T2[1] = this.sy + (y - this.ay) * this.k; } else { projectTo(Q, x, y); T2[0] = Q.x; T2[1] = Q.y; } return T2; }
  st() { if (this.fresh) { ctx.beginPath(); this.fresh = false; } }
  moveTo(x, y) { this.st(); const p = this.p(x, y); ctx.moveTo(p[0], p[1]); return this; }
  lineTo(x, y) { this.st(); const p = this.p(x, y); ctx.lineTo(p[0], p[1]); return this; }
  arc(x, y, r, a0, a1) {
    this.st();
    if (this.mode) { const p = this.p(x, y), R = this.mode === 2 ? r * this.k : r; ctx.arc(p[0], p[1], Math.max(0, R), a0, a1); return this; }
    const n = clamp(Math.ceil(r * this.z * Math.abs(a1 - a0) * .25), 3, 96);
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, p = this.p(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(p[0], p[1]); }
    return this;
  }
  circle(x, y, r) {
    this.st();
    if (this.mode) { const p = this.p(x, y), R = Math.max(0, this.mode === 2 ? r * this.k : r); ctx.moveTo(p[0] + R, p[1]); ctx.arc(p[0], p[1], R, 0, TAU); return this; }
    const n = clamp(Math.ceil(r * this.z * .6), 10, 120);
    for (let i = 0; i < n; i++) { const a = i / n * TAU, p = this.p(x + Math.cos(a) * r, y + Math.sin(a) * r); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    ctx.closePath(); return this;
  }
  dashed(x, y, r, seg, gap) {
    const C = TAU * r; let n = Math.max(8, Math.floor(C / (seg + gap))); if (n > 160) n = 160;
    const step = TAU / n, sw = step * seg / (seg + gap);
    for (let i = 0; i < n; i++) { const a = i * step; this.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); this.arc(x, y, r, a, a + sw); }
    return this;
  }
  rect(x, y, w, h) { this.st(); let p = this.p(x, y); ctx.moveTo(p[0], p[1]); p = this.p(x + w, y); ctx.lineTo(p[0], p[1]); p = this.p(x + w, y + h); ctx.lineTo(p[0], p[1]); p = this.p(x, y + h); ctx.lineTo(p[0], p[1]); ctx.closePath(); return this; }
  poly(a) { this.st(); for (let i = 0; i < a.length; i += 2) { const p = this.p(a[i], a[i + 1]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.closePath(); return this; }
  fill({ color = 0xffffff, alpha = 1 } = {}) { ctx.globalAlpha = clamp(alpha, 0, 1); ctx.fillStyle = css(color); ctx.fill(); this.fresh = true; return this; }
  stroke({ width = 1, color = 0xffffff, alpha = 1 } = {}) { ctx.globalAlpha = clamp(alpha, 0, 1); ctx.strokeStyle = css(color); ctx.lineWidth = Math.max(.6, this.mode === 1 ? width : width * this.z); ctx.stroke(); this.fresh = true; return this; }
}
const G = new G2();
const MONO = 'ui-monospace,Consolas,monospace', SERIF = 'Cinzel, Georgia, serif', SANS = '"Segoe UI", system-ui, -apple-system, sans-serif';
let rects = [], labels = [];
// a label in screen pixels; avoid 'skip' drops it if it would overlap, avoid true steps it down until it clears
function label(text, sx, sy, color, serif, avoid) {
  if (labels.length >= 60 && !serif) return false;
  const w = text.length * (serif ? 8.5 : 6.8), h = 13;
  if (avoid === 'skip' && rects.some(r => Math.abs(r.x - sx) < (r.w + w) / 2 && Math.abs(r.y - sy) < h)) return false;
  if (avoid === true) for (let k = 0; k < 4; k++) { if (!rects.some(r => Math.abs(r.x - sx) < (r.w + w) / 2 && Math.abs(r.y - sy) < h)) break; sy += 15; }
  rects.push({ x: sx, y: sy, w }); labels.push([text, sx, sy, color, serif]); return true;
}
function flushLabels() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.globalAlpha = 1;
  for (const [t, x, y, col, serif] of labels) {
    ctx.font = serif ? '600 12px ' + SERIF : '600 11px ' + SANS; ctx.letterSpacing = serif ? '1.5px' : '.4px';
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillText(t, x + 1, y + 1); ctx.fillStyle = css(col); ctx.fillText(t, x, y);
  }
  ctx.letterSpacing = '0px'; labels = [];
}
const fp = (x, y) => { const p = G.p(x, y); return [p[0], p[1]]; };

// ---------------------------------------------------------------- frame
export function render() {
  if (!renderer) return;
  if (S.orrery) return renderOrrery(S.orrery);
  { const n = performance.now(), d = RLAST ? Math.min(.1, (n - RLAST) / 1000) : 1 / 60; RLAST = n; GDT = S.paused ? 0 : d * (S.speed || 1); RCLK += GDT; }
  const cx0 = S.cam.x, cy0 = S.cam.y; // the shake moves the view, never the camera the player steers
  if (PUNCH.shake > 0) { const a = Math.random() * TAU, m = PUNCH.shake * (.6 + .4 * Math.random()) / S.cam.z; PUNCH.shx = Math.cos(a) * m; PUNCH.shy = Math.sin(a) * m; S.cam.x += PUNCH.shx; S.cam.y += PUNCH.shy; } else PUNCH.shx = PUNCH.shy = 0;
  try {
  const { z, px, icons } = sceneFrame();
  renderer.info.reset();
  if (composer && (S.bloom || preset().post)) composer.render(); else renderer.render(scene, camera);
  gpuTimer(renderer); // resolve every frame so the query pool never fills; the meter reads the result
  const P = S.pip && S.pip.on && S.mode === 'battle' ? S.pip : null;
  // overlay
  ctx.setTransform(ODPR, 0, 0, ODPR, 0, 0); ctx.clearRect(0, 0, S.W, S.H); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  G.z = z; G.fresh = true; rects = []; labels = [];
  drawFxOverlay(z, px);
  drawOverlay(z, px, icons);
  flushLabels();
  drawScreen();
  if (S.meter) drawMeter();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  if (P) pipPass(P);
  } finally { S.cam.x = cx0; S.cam.y = cy0; }
}
// the action camera: the same scene again, from a low cinematic angle, into a window in the corner
function pipPass(P) {
  const r = P.rect; if (!r || !P.cam) return;
  const W0 = S.W, H0 = S.H, C0 = S.cam, e0 = ELEV, a0 = AZ; inPip = true;
  try {
    S.W = r.w; S.H = r.h; S.cam = P.cam; setView(P.elev || .6, P.az || 0);
    sceneFrame();
    renderer.setScissorTest(true); renderer.setViewport(r.x, r.y, r.w, r.h); renderer.setScissor(r.x, r.y, r.w, r.h); // WebGPURenderer counts from the top left, on either backend
    // a clear in WebGPU wipes the whole canvas whatever the scissor: keep the main frame, clear only depth, and let
    // the sky quad (drawn first, depth test off) paint the window's background
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); renderer.autoClear = ac;
  } finally {
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W0, H0); S.W = W0; S.H = H0; S.cam = C0; setView(e0, a0); inPip = false;
    ctx.clearRect(r.x, r.y, r.w, r.h); /* nothing of the main overlay over the window */
  }
}
let inPip = false, FLARE_C = null;
// the render clock: game time as the screen sees it (real frame time × game speed, still while paused). Smoothing and
// effects spawned from the renderer run on it, so they look the same at 60 Hz, 144 Hz or 240 Hz
let GDT = 0, RCLK = 0, RLAST = 0;
// renderer-side battle punch: shield shatters, hull-flip pulses and the camera shake, all driven from state the sim
// already keeps (downP/downS/shDown, team changes, big fire flashes) — the sim is never touched for them
const PUNCH = { shards: [], pulses: [], seen: new Map(), shake: 0, shx: 0, shy: 0, puffs: [], glows: [], seenW: new Set() };
// a slug passing close over a hull: a sonic-boom ring, once per slug per ship (renderer side; the sim knows nothing of it)
function slugBooms(p) { if (p._boomed === undefined) p._boomed = new Set(); for (const o of S.ships) { if (o.dead || o.def.static || p._boomed.has(o.id)) continue; const d = hyp(o.x - p.x, o.y - p.y); if (d > o.r + 30 || d < o.r * .3) continue; p._boomed.add(o.id);
  PUNCH.pulses.push({ x: p.x, y: p.y, vx: p.vx * .3, vy: p.vy * .3, r: Math.max(8, o.r * .25), life: .32, max: .32, col: 0xdfe8f0, kind: 'ring' }); } }
// flak bursts leave grey puffs that hang for a few seconds, so a point-defence screen reads as a wall
function flakPuff(x, y, vx, vy) { if (!GXF().dust) return; const life = 3.5 + Math.random() * 2; PUNCH.puffs.push({ x, y, vx: vx * .05 + rand(-6, 6), vy: vy * .05 + rand(-6, 6), life, max: life, sz: 10 + Math.random() * 8, a: Math.random() * TAU, spin: rand(-.4, .4) }); if (PUNCH.puffs.length > 600) PUNCH.puffs.shift(); }
// a ship's death leaves a cooling cloud: embers scattered through the wreck's volume and a smear of frozen vapour, both fading over twelve seconds
function wreckGlow(w) { const R = Math.max(w.def.r || 20, 20), n = Math.min(40, 8 + R * .4), em = []; for (let i = 0; i < n; i++) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R * 1.3; em.push({ ox: Math.cos(a) * d, oy: Math.sin(a) * d, vx: Math.cos(a) * rand(4, 18), vy: Math.sin(a) * rand(4, 18), f: rand(3, 9), p: Math.random() * TAU, s: .5 + Math.random() * 1.1 }); }
  PUNCH.glows.push({ x: w.x, y: w.y, vx: w.vx, vy: w.vy, R, life: 12, max: 12, em, a: Math.random() * TAU }); }
function shatter(s, side, R) { // a shield half (or the whole bubble, side 0) breaks into hex cells that fly outward, spin and fade
  const a0 = side ? s.a + side * PI / 2 : s.a, span = side ? 1.3 : PI, n = side ? 22 : 40, vx = s.vx || 0, vy = s.vy || 0;
  for (let i = 0; i < n; i++) { const a = a0 + (i / (n - 1) - .5) * 2 * span + rand(-.05, .05), sp = rand(90, 240) * Math.max(.5, R / 40), x = s.x + Math.cos(a) * R, y = s.y + Math.sin(a) * R;
    PUNCH.shards.push({ x, y, vx: vx + Math.cos(a) * sp, vy: vy + Math.sin(a) * sp, a: rand(0, TAU), av: rand(-6, 6), sz: R * rand(.14, .24), life: rand(.9, 1.5), max: 1.5, col: 0x9fdcff }); }
  PUNCH.pulses.push({ x: s.x, y: s.y, vx, vy, r: R, a0, span, life: .45, max: .45, col: 0xcfefff, kind: 'arc' });
  if (!side) PUNCH.pulses.push({ x: s.x, y: s.y, vx, vy, r: R, life: .7, max: .7, col: 0x8fd3ff, kind: 'ring' });
}
function punchKick(x, y, amp) { // the camera shakes for a hard blow near the screen centre, less the further off it is
  if (S.gx && S.gx.shake === false) return; const d = hyp(x - S.cam.x, y - S.cam.y) * S.cam.z; PUNCH.shake = Math.min(14, PUNCH.shake + amp * clamp(1 - d / (S.W * .8), 0, 1));
}
function punchTick(z, px) {
  // shields: a half (or the bubble) that fell this frame shatters once
  for (const s of S.ships) {
    if (s.dead || (!s.seen && s.team !== 0) || !s.def.shield || s.def.static) continue;
    const R = Math.max(s.r * 1.25, vrOf(s) * 1.5);
    for (const [side, t] of [[-1, s.downP], [1, s.downS], [0, s.shDown]]) {
      if (t == null || t < 0 || S.time - t > .25 || t > 1e8) continue; const key = s.id + ':' + side + ':' + t.toFixed(2); if (PUNCH.seen.has(key)) continue; PUNCH.seen.set(key, S.time);
      if (side === 0 && [s.downP, s.downS].some(u => u != null && Math.abs(u - t) < .05)) continue; // the bubble went with its last half: that half's shatter is the event
      if (onScr(s.x, s.y, R * z + 80)) { shatter(s, side, R); punchKick(s.x, s.y, side ? 2.5 : 4); }
    }
  }
  if (PUNCH.seen.size > 400) for (const [k, t] of PUNCH.seen) if (S.time - t > 5) PUNCH.seen.delete(k);
  // big fire flashes just born: kills and heavy hits rock the camera
  for (const f of S.flashes) if (f.fire && f.r >= 50 && !f._kick) { f._kick = 1; punchKick(f.x, f.y, Math.min(10, f.r / 25)); }
  // shards and pulses live on the render clock, so they pause with the game
  const dt = GDT; if (dt > 0) {
    for (const d of PUNCH.shards) { d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.av * dt; d.life -= dt; d.vx *= 1 - dt * .9; d.vy *= 1 - dt * .9; }
    for (const p of PUNCH.pulses) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    for (const q of PUNCH.puffs) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; q.a += q.spin * dt; }
    for (const g of PUNCH.glows) { g.x += g.vx * dt; g.y += g.vy * dt; g.life -= dt; for (const e of g.em) { e.ox += e.vx * dt; e.oy += e.vy * dt; } }
    PUNCH.shards = PUNCH.shards.filter(d => d.life > 0); PUNCH.pulses = PUNCH.pulses.filter(p => p.life > 0); PUNCH.puffs = PUNCH.puffs.filter(q => q.life > 0); PUNCH.glows = PUNCH.glows.filter(g => g.life > 0);
    for (const L of [S.wrecks, S.hulks]) for (const w of L || []) if (!PUNCH.seenW.has(w.id)) { PUNCH.seenW.add(w.id); if (S.time - (w.t0 ?? w.born ?? S.time) < 1) wreckGlow(w); } // a new wreck: light its afterglow
    if (PUNCH.seenW.size > 4000) PUNCH.seenW.clear();
    PUNCH.shake *= Math.exp(-dt * 7); if (PUNCH.shake < .05) PUNCH.shake = 0;
  }
  for (const q of PUNCH.puffs) { if (!onScr(q.x, q.y, 40)) continue; const k = q.life / q.max, sz = Math.max(q.sz * (1.6 - k * .6), px * 6); B.smoke.add(q.x, q.y, 3, sz, sz, q.a, 0x6a6a70, Math.min(1, k * 3) * .38 * Math.min(1, (1 - k) * 8 + .3), 1); }
  for (const g of PUNCH.glows) { if (!onScr(g.x, g.y, g.R * z * 3 + 60)) continue; const k = g.life / g.max, gk = 1 - k, vs = g.R * (2 + gk * 3);
    B.sglow.add(g.x, g.y, 2.5, vs, vs * .7, g.a, 0x9fb4cc, k * k * .16, 1.2); B.smoke.add(g.x, g.y, 2.4, vs * .8, vs * .8, g.a + gk, 0x3a3634, k * .35, 1); // the vapour, spreading and thinning
    for (const e of g.em) { const fl = .55 + .45 * Math.sin(RCLK * e.f + e.p), heat = k * k, col = heat > .5 ? 0xffc070 : heat > .2 ? 0xff6a2a : 0x7a2010, sz = Math.max(e.s * (1 + fl * .3), px * 2);
      B.glow.add(g.x + e.ox, g.y + e.oy, 2.6, sz * 1.8, sz * 1.8, 0, col, (.3 + .7 * heat) * fl * Math.min(1, k * 4), 1.5); } } // embers cooling from white to dull red
  for (const d of PUNCH.shards) { if (!onScr(d.x, d.y, 40)) continue; const k = d.life / d.max, sz = Math.max(d.sz, px * 3); B.hex.add(d.x, d.y, 3.2, sz, sz, d.a, d.col, k * k * .9, 1.6); if (k > .6) B.glow.add(d.x, d.y, 3.2, sz * .9, sz * .9, 0, 0xcfefff, (k - .6) * 1.2, 1.5); }
  for (const p of PUNCH.pulses) { if (!onScr(p.x, p.y, p.r * z * 2 + 60)) continue; const k = p.life / p.max, g = 1 - k;
    if (p.kind === 'arc') { const n = 6; for (let i = 0; i < n; i++) { const a = p.a0 + (i / (n - 1) - .5) * 2 * p.span * .9, rr = p.r * (1 + g * .3), sz = p.r * (.9 + g * .5); B.sglow.add(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 3.1, sz, sz, 0, p.col, k * k * .3, 2); } }
    else { const dd = p.r * 2 * (1 + g * 1.6); B.shock.add(p.x, p.y, 2, dd, dd, 0, p.col, k * k * .6, 1.6); } }
}
// a hull that just changed hands (capture, mutiny, a turncoat) pulses in its new colour
function flipPulse(s) { const R = Math.max(s.r * 1.3, vrOf(s) * 1.6), c = parseInt((S.teamc[s.team] || { light: '#ffffff' }).light.slice(1), 16); PUNCH.pulses.push({ x: s.x, y: s.y, vx: s.vx || 0, vy: s.vy || 0, r: R, life: 1.1, max: 1.1, col: c, kind: 'ring' }); PUNCH.pulses.push({ x: s.x, y: s.y, vx: s.vx || 0, vy: s.vy || 0, r: R * .6, life: .5, max: .5, col: 0xffffff, kind: 'ring' }); }
// the graphics menu's switches for the effects (entries belong to the campaign chat's menu; the flags are read here)
const GXF = () => { const g = S.gx || {}; return { weather: g.weather !== false, dust: g.dust !== false, dirt: g.dirt !== false, cine: !!g.cine, shake: g.shake !== false }; };
function sceneFrame() {
  shipsG.visible = true; rocksG.visible = true;
  if (composer && composer.dirtU) { const f = GXF(); composer.dirtU.value = !f.dirt ? 0 : f.cine ? 1.6 : .9; }
  const c = S.cam, z = c.z, px = 1 / z, d = camDist();
  O.x = c.x; O.y = c.y; worldLight(c.x, c.y);
  camera.aspect = S.W / S.H; camera.near = d * .04; camera.far = d * 30; camera.position.set(...camOffset(d));
  camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  // sky parallax, as before
  const u = bgMesh.material.uniforms; u.res.value.set(S.W, S.H); SH.res.value.set(S.W, S.H); SH.time.value = performance.now() / 1000;
  const sp = [.02, .05, .1].map(k => k * Math.min(1, z * 2));
  u.o01.value.set((-c.x * sp[0]) % 1024, (-c.y * sp[0]) % 1024, (-c.x * sp[1]) % 1024, (-c.y * sp[1]) % 1024);
  u.o2n.value.set((-c.x * sp[2]) % 1024, (-c.y * sp[2]) % 1024, (-c.x * .04 * z) % 4096, (-c.y * .04 * z) % 4096);

  // worlds
  if ((S.bodyVer || 0) !== bodyVerSeen) buildBodies();
  const sun = BODIES[0], sunP = new THREE.Vector3(sun.x - O.x, 0, sun.y - O.y);
  scene.userData.sun.position.copy(sunP);
  ganymedeYard(O, z); venusYard(O, z); yardsHide();
  for (const v of bodyVis) {
    const b = v.b, x = b.x - O.x, y = b.y - O.y, vis = onScr(b.x, b.y, Math.max(b.r * z * 2.6, 40)) && b.r * z > .6;
    v.g.visible = vis; if (v.atmo) v.atmo.visible = vis; if (v.ring) v.ring.visible = vis;
    if (v.glow) { v.glow.position.set(x, 0, y); const gs = Math.max(b.r * 7, 70 / z); v.glow.scale.set(gs, gs, 1); }
    if (v.corona) { v.corona.position.set(x, 0, y); const cs = Math.max(b.r * 14, 300 / z); v.corona.scale.set(cs, cs, 1); v.corona.material.opacity = .4; }
    glintFor(v, x, y, b.r * z, z, onScr(b.x, b.y, 40));
    if (!vis) continue;
    v.g.position.set(x, 0, y); v.g.scale.setScalar(b.r); v.g.rotation.set(v.tilt, 0, 0); v.mesh.rotation.y = v.face + S.time * v.spin;
    const EU = v.mesh.material.uniforms; if (EU.ecl) { const pb = b.kind === 'moon' ? BODIES[b.parent] : null; if (pb) { EU.ecl.value = eclipseK(b.x, b.y, pb.x, pb.y, pb.r, { x: sunP.x + O.x, z: sunP.z + O.y }); if (EU.ecl.value > 0) EU.eclCol.value.setRGB(...(pb.pal && pb.pal.atmo && !pb.gas ? [.45, .14, .08] : [.2, .2, .24])); } else EU.ecl.value = 0; }
    if (v.clouds) { v.clouds.rotation.y = v.face + 1.3 + S.time * (v.spin + v.cspin); v.clouds.material.uniforms.sunPos.value.copy(sunP); v.mesh.material.uniforms.cloudOff.value = -(1.3 + S.time * v.cspin) / TAU; }
    if (v.extra) v.extra.rotation.y = v.face + S.time * v.spin;
    if (v.traffic) v.traffic.update(S.time);
    const U = v.mesh.material.uniforms; if (U.sunPos) U.sunPos.value.copy(sunP); if (U.C) { U.C.value.set(x, 0, y); U.pr.value = b.r; }
    if (v.atmo) { const R = b.r * v.atmoK; v.atmo.position.set(x, 0, y); v.atmo.scale.setScalar(R); const A = v.atmo.material.uniforms; A.C.value.set(x, 0, y); A.r.value = b.r; A.R.value = R; A.sunPos.value.copy(sunP); }
    if (v.ring) ringUniforms(v, x, y, b.r, sunP);
    if (v.moons && v.moons.length) moonShadows(v, x, y, b.r, sunP, m => m);
  }
  beltDust(sunP, z, false);
  // orbits and the Belt, only the arcs near the screen
  const fpz = footprint(); let reach = 0; for (const [wx, wy] of fpz) reach = Math.max(reach, hyp(wx - c.x, wy - c.y)); reach *= 1.15;
  for (const L of orbitL) L.n = 0;
  if (z < .002) for (let i = 0; i <= 6; i++) ring(orbitL[2], 0, 0, (2.15 + i * .2) * 4e6, reach);
  for (const b of BODIES) {
    if (b.kind === 'planet') ring(orbitL[0], 0, 0, hyp(b.x, b.y), reach);
    else if (b.orbitR) { const p = BODIES[b.parent] || { x: 0, y: 0 }; ring(orbitL[1], p.x, p.y, b.orbitR, reach); }
  }
  for (const L of orbitL) flushOrbit(L);

  // rocks
  if (nodesRef !== S.nodes || fieldsRef !== S.fields) buildRocks();
  for (const g of rockGroups) { if (g.f) { g.x = g.f.x; g.y = g.f.y; } g.grp.visible = onScr(g.x, g.y, g.R * z + 60) && z > 2e-4; if (g.grp.visible) g.grp.position.set(g.x - O.x, 0, g.y - O.y); }
  // debris: tumbling shards; hot ones glow
  for (const dd of S.debris) {
    if (!onScr(dd.x, dd.y, 60)) continue; const f = dd.life / dd.max; let r = 0; for (let i = 0; i < dd.pts.length; i += 2) r = Math.max(r, Math.abs(dd.pts[i]), Math.abs(dd.pts[i + 1]));
    debrisM.add(dd.x, dd.y, 0, -dd.a, r, r * .7, r * .8, null, dd.a * .8);
    if (f > .7 && !dd.cold) B.glow.add(dd.x, dd.y, 2, r * 3, r * 3, 0, 0xff8c3c, (f - .7) * 2.2);
  }
  debrisM.end();

  // the strategic map: fleets in orbit, their hulls circling the world (stratview fills S.parade)
  paradeDraw(null);
  // ships
  const seen = new Set(), icons = [];
  for (const s of S.ships) {
    if (s.dead) continue;
    if (s.def.static) { seen.add(s.id); structure(s, z); continue; }
    if (!s.seen && s.team !== 0) continue;
    seen.add(s.id);
    let v = shipVis.get(s.id);
    if (v && v.team !== s.team && !inPip) flipPulse(s);
    if (!v || v.team !== s.team || (v.is3d && v.vt !== variantOf(s))) { if (v) shipsG.remove(v.g); v = makeShip(s); shipVis.set(s.id, v); }
    // the hull is drawn at its book length times the Hull size setting; below a few pixels its icon takes over,
    // and through a short hand-off band both show, the icon fading as the hull grows
    const vr = vrOf(s), vz = vr * z, on = onScr(s.x, s.y, Math.max(s.r, vr * 1.5) * z * 3 + 80), iconMode = vz < HAND0;
    v.g.visible = on && !iconMode;
    if (!on) continue;
    const dark = disabled(s);
    s._ia = vz < HAND0 ? 1 : vz < HAND1 ? 1 - (vz - HAND0) / (HAND1 - HAND0) : 0;
    if (s._ia > 0) icons.push(s);
    if (iconMode) continue;
    // banking, attitude and side thrusters, recoil, hits and damage: shipFx, once a frame (the action window shares the hull)
    if (v.hits === undefined) fxInit(v); if (!inPip) { shipFx(s, v, vr, vz, dark); thrusters(s, v, vr, vz, dark); }
    v.g.position.set(s.x - O.x, 0, s.y - O.y); v.g.rotation.order = 'YXZ'; v.g.rotation.set(v.bank + v.kr, -s.a + v.ky, v.pitch + v.kp); v.g.scale.setScalar(vr);
    shipFxDraw(s, v, vr, z); shipShadow(s, vr, sunP);
    const st = RCLK < v.hvT ? 'f' : dark || s.cold || RCLK < v.ltT ? 'd' : 'n'; /* the hull flashes only on a heavy blow; running cold, or with her power failing, she shows no lights */ if (v.st !== st) { v.st = st; v.hull.material = v.mats[st]; for (const m of v.sup) m.material = v.mats[st]; }
    const thr = clamp(s.throttle, 0, 1), burn = s.throttle > 1 ? 1 + .5 * Math.log1p(s.throttle - 1) : 1; // a transit burn runs the drive past its battle rating
    v.mats.bell.emissiveIntensity = dark ? 0 : thr * 1.6;
    if (thr > .04 && !dark && !(S.gx && S.gx.plumes === false)) {
      // a fusion torch: a long narrow tail whose length follows the throttle (and a transit burn), a white-hot throat, glare on the stern
      const L = vr * (1.1 + 3.2 * thr) * burn * v.sput * (1 + .028 * Math.sin(RCLK * 71 + s.id * 1.9) + .012 * Math.sin(RCLK * 157 + s.id * .7)) /* a steady shimmer, not per-frame noise */, W = vr * (s.def.fighter ? .3 : .38), ca = Math.cos(s.a), sa = Math.sin(s.a), bx = s.x - ca * vr * (-v.xmin + .05), by = s.y - sa * vr * (-v.xmin + .05);
      const pc = s.team === 0 ? 0xffb080 : 0xffd0a0, al = Math.min(1, .5 + thr * .5), fl = .93 + .07 * Math.sin(S.time * 41 + s.id) + .03 * Math.sin(S.time * 97 + s.id * 3), nb = Math.max(1, v.bells.length);
      for (const yy of v.bells) { const ox = -sa * yy * vr, oy = ca * yy * vr, pl = L / Math.max(1, nb * .55), pw = W / Math.max(1, nb * .6);
        B.plume.add(bx + ox, by + oy, 0, pl * fl, pw, s.a, pc, al * .9, 1.4); /* the tail */
        B.plume.add(bx + ox, by + oy, 1, pl * .42 * fl, pw * .55, s.a, 0xffffff, al, 2.2); /* the white throat */
        if (vz > 20) B.glow.add(bx + ox - ca * pw * .3, by + oy - sa * pw * .3, 1, pw * 1.2, pw * 1.2, 0, pc, thr * .35, 1.4); } /* and its glare on the stern */
      if (vz > 24) B.sglow.add(bx + ca * vr * .22, by + sa * vr * .22, 1.2, vr * .9, vr * .55, s.a, pc, thr * .16 * fl, 1.2); /* the torch lighting her aft quarter, a warm wash on the hull */
    }
    turrets(s, z, v.T * vr / 2, vr, v);
  }
  drawWrecks(z, seen);
  for (const s of S.ships) if (!s.dead && s.def.bow !== false) for (const w of s.weapons) if (w.chg && w.def.bow && onScr(w.mx, w.my, 120)) { // the muzzle of a charging lance glows
    const k = clamp((S.time - (w.chg0 ?? S.time)) / Math.max(.1, w.chg - (w.chg0 ?? S.time)), 0, 1), gs = Math.max(14 + 40 * k, (6 + 10 * k) * px) * (w.def.huge ? 2 : 1); B.glow.add(w.mx, w.my, 4, gs, gs, 0, w.def.col || 0xff6a3d, .3 + .5 * k, 1.8); }
  for (const [id, v] of shipVis) if (!seen.has(id)) { shipsG.remove(v.g); shipVis.delete(id); }
  for (const [id, v] of structVis) if (!seen.has(id)) { shipsG.remove(v.g); structVis.delete(id); }
  for (const t of Object.values(turretM)) t.end();

  // fx
  for (const p of S.parts) {
    if (!onScr(p.x, p.y, 40)) continue; const f = p.life / p.max;
    if (p._rot == null) { p._rot = (p.x * 7.13 + p.y * 3.71) % TAU; p._spin = ((p.x * 1.7 + p.y * 2.3) % 2 - 1) * 1.6; } // a stable turn per puff, from where it was born
    if (p.smoke) { const g = 1 - f, sz = p.size * (1 + g * 1.9) * 2; B.smoke.add(p.x, p.y, 4, sz, sz, p._rot + g * p._spin * .6, p.col, f * f * .42); }
    else if (p.fire) { // a fire tongue: white-hot, then yellow, orange, and a dull ember as it swells (fast at first) and thins
      const g = 1 - f, e = 1 - (1 - g) * (1 - g), sz = p.size * (.5 + e * 1.8), col = f > .75 ? 0xfff6e8 : f > .5 ? 0xffd070 : f > .25 ? 0xff8a38 : 0xc83a18, k = f > .75 ? 2.6 : f > .5 ? 1.9 : 1.3;
      B.fire.add(p.x, p.y, 5, sz, sz, p._rot + g * p._spin, col, Math.min(1, f * 1.7) * .9, k);
      if (f < .4 && p.size > 6) B.smoke.add(p.x, p.y, 4, sz * 1.4, sz * 1.4, p._rot - g * p._spin * .4, 0x2a2420, (0.4 - f) * 1.1); }
    else if (p.spark) { const sv = hyp(p.vx, p.vy), L = Math.max(sv * .035, px * 6) * (.4 + f), th = Math.max(1.2, px * 1.4) * (.5 + f); B.spark.add(p.x, p.y, 4, L, th, Math.atan2(p.vy, p.vx), p.col, Math.min(1, f * 1.8), 2); }
    else { const sz = Math.max(p.size * f, px * 1.6) * 1.6; B.dot.add(p.x, p.y, 4, sz, sz, 0, p.col, Math.min(1, f * 1.5), 1); }
  }
  // shockwaves: rings in the scene itself, so the action window sees them too
  if (!inPip) punchTick(z, px);
  for (const r of S.rings) { if (!onScr(r.x, r.y, r.r * z + 40)) continue; const k = r.life / r.maxl, d = r.r * 2; if (!r.soft && k > .55 && r.max < 300) { const gs = Math.max(r.max * .45, px * 10); B.sglow.add(r.x, r.y, 2.5, gs, gs, 0, r.col, (k - .55) / .45 * .85, 2.2); } /* the strike itself: a hot flash before the ring spreads */ B.shock.add(r.x, r.y, 2, d, d, 0, r.col, k * k * (r.soft ? .2 : .5), 1.3); }
  // shield cells lighting up where a shot landed
  if (!(S.gx && S.gx.ripples === false)) for (const q of S.ripples || []) { const s = q.s; if (s.dead || !onScr(s.x, s.y, s.r * z * 3)) continue; const k = 1 - (S.time - q.t) / .4; if (k <= 0) continue;
    const g = 1 - k, R = Math.max(s.r * 1.25, s.def.static ? 0 : vrOf(s) * 1.5), x = s.x + Math.cos(q.a) * R, y = s.y + Math.sin(q.a) * R, sz = R * (q.big ? .36 : .22) * (.55 + g * 1.1); // the cells light where the shot landed, and the light spreads out across the bubble as it fades
    B.hex.add(x, y, 3, sz, sz, q.a, q.col || 0x9fdcff, k * .55, 1.4); B.hex.add(x, y, 3.01, sz * .5, sz * .5, q.a + 1, 0xe8f8ff, k * k * .5, 1.8);
    const rd = R * (q.big ? .6 : .36) * (.15 + g); B.shock.add(x, y, 2.9, rd, rd, 0, q.col || 0x9fdcff, k * k * .45, 1.5); // the ripple ring running out from the hit
    B.glow.add(x, y, 3, sz * .35, sz * .35, 0, 0xcfefff, k * k * k * .7, 1.5); }
  for (const p of S.shots) {
    if (!onScr(p.x, p.y, 80)) continue; const D = p.D, ang = Math.atan2(p.vy, p.vx), sv = hyp(p.vx, p.vy);
    if (D.kind === 'slug') { // a rail slug: a hot tracer you can follow across the field, with a fading trail behind it
      const L = Math.max(sv * (D.huge ? .07 : D.big ? .05 : .03), (D.huge ? 46 : D.big ? 32 : 20) * px), th = Math.max(D.huge ? 9 : D.big ? 5 : 2.2, (D.huge ? 5 : D.big ? 3.2 : 2) * px), ca = Math.cos(ang), sa = Math.sin(ang);
      B.streak.add(p.x - ca * L * 1.1, p.y - sa * L * 1.1, 3, L * 2.2, th * .55, ang, D.col, .22, 2.2); B.streak.add(p.x, p.y, 3, L, th, ang, D.col, 1, 2.2); B.glow.add(p.x + ca * L * .45, p.y + sa * L * .45, 3, th * 3.2, th * 3.2, 0, D.big ? 0xffb080 : 0xd8f2ff, .55, 1.6);
      slugBooms(p); if (sv > 900) { const wl = L * (1.2 + Math.sin(S.time * 37 + p.x * .01) * .15); B.streak.add(p.x - ca * L * .9, p.y - sa * L * .9, 2.98, wl * 2.2, th * 2.2, ang, 0xffd0a0, .07, 1); } // the heat wake, wide and faint behind the slug
      if (D.big) { // a lance round: a white-hot core inside a wide coloured sheath, a bow wave of light ahead of it, and the muzzle still shimmering with heat behind it
        B.streak.add(p.x, p.y, 2.99, L * 1.2, th * 2.6, ang, D.col, .32, 1.5); B.streak.add(p.x + ca * L * .08, p.y + sa * L * .08, 3.01, L * .85, th * .45, ang, 0xffffff, 1, 2.8);
        B.sglow.add(p.x + ca * L * .55, p.y + sa * L * .55, 3, th * 9, th * 9, 0, D.col, .3, 1.8);
        const age = D.life - p.life; if (age < .2 && age >= 0) { const f = 1 - age / .2, mx = p.x - p.vx * age, my = p.y - p.vy * age, wob = .85 + .15 * Math.sin(S.time * 71 + p.x);
          B.plume.add(mx, my, 3.1, Math.max(th * 9, 30 * px) * f * wob, th * (2.5 + 2 * f), ang + PI, D.col, f * .65, 1.8); B.sglow.add(mx, my, 3.1, th * (3 + 5 * f) * wob, th * (3 + 5 * f) * wob, 0, 0xfff0d8, f * f * .7, 2); } } }
    else if (D.kind === 'flak') { const L = Math.max(sv * .012, 8 * px); B.streak.add(p.x, p.y, 3, L, Math.max(2.2, px * 2), ang, D.col, 1, 2.6); B.glow.add(p.x, p.y, 3, Math.max(4, px * 5), Math.max(4, px * 5), 0, D.col, .5, 1.8); } // a flak round: a short bright dash with a hot head
    else { const L = Math.max(sv * .02, 12 * px), th = Math.max(2, px * 1.8); B.streak.add(p.x - Math.cos(ang) * L * .9, p.y - Math.sin(ang) * L * .9, 3, L * 1.8, th * .5, ang, D.col, .3, 2); B.streak.add(p.x, p.y, 3, L, th, ang, D.col, 1, 2.6); } // a gun round: a tracer with a fading tail, so a broadside reads as a volley
    if (D.kind === 'flak' && p.life < .1 && !p._puffed) { p._puffed = true; flakPuff(p.x, p.y, p.vx, p.vy); } // the round bursting at the end of its run
    if ((D.kind === 'bullet' || D.kind === 'flak') && D.life) { // the muzzle flash: a short bright cone at the gun for the round's first few frames, sized to the calibre
      const T = D.kind === 'flak' ? .05 : .09, age = D.life - p.life; if (age >= 0 && age < T) { const f = 1 - age / T, mx = p.x - p.vx * age, my = p.y - p.vy * age, Lm = Math.max(D.kind === 'flak' ? 12 : D.big ? 44 : 26, (D.kind === 'flak' ? 7 : 13) * px) * (.5 + .5 * f), Wm = Lm * .34;
        B.plume.add(mx, my, 3.2, Lm, Wm, ang + PI, D.kind === 'flak' ? D.col : 0xffd9a0, f * .85, 2.2); B.plume.add(mx, my, 3.21, Lm * .55, Wm * .45, ang + PI, 0xffffff, f, 2.6); B.glow.add(mx, my, 3.2, Wm * 1.4, Wm * 1.4, 0, 0xfff0d0, f * f * .7, 2); } }
  }
  for (const m of S.missiles) {
    if (!onScr(m.x, m.y, 60)) continue;
    // she is drawn pointing the way she is actually going (her velocity), not the way her motor is pushing: the motor's
    // aim swings hard as she steers, and drawing the body along it made a salvo look like it was spinning in circles.
    // Eased on the render clock so a slow missile (velocity near zero, its direction meaningless) holds its line.
    if (!inPip) { const sp = Math.hypot(m.vx, m.vy), va = sp > 40 ? Math.atan2(m.vy, m.vx) : (m._da ?? m.a); if (m._da === undefined) m._da = va; else m._da += angDiff(m._da, va) * (1 - Math.exp(-10 * GDT)); }
    const da = m._da ?? m.a, ca = Math.cos(da), sa = Math.sin(da);
    // drawn at 150× real size (5× the hulls' 30×, and following the Hulls setting), never under 4 px so a salvo can still be followed; the plume carries it at range
    const L = Math.max(MISSILE_M[m.nuke ? 'nuke' : m.emp ? 'emp' : 'std'] * M_TO_UNITS * MISSILE_X * (S.hullX || HULL_REF) / HULL_REF, 4 * px), Wd = L * .25;
    const tc = m.emp ? 0x8fd3ff : m.nuke ? 0xff4b3e : hex(S.teamc[m.team].light);
    (m.nuke ? missileM.nuke : m.emp ? missileM.emp : missileM.std).add(m.x, m.y, 3, -da, L, L, L, tc); // the 3-D body, its fins and bands in the team's colour (hulls.js)
    if (m.nuke && (S.time * 5 | 0) % 2) B.glow.add(m.x + ca * L * .1, m.y + sa * L * .1, 3.1, Wd * 2.2, Wd * 2.2, 0, 0xff5040, .9, 1.8); // the warhead's blinking light
    if (m.thrusting) { const ex = m.emp ? 0x8fd3ff : 0xffc8a0, fl = .9 + .1 * Math.sin(S.time * 53 + m.x), nx = m.x - ca * L * .5, ny = m.y - sa * L * .5, pl = Math.max(L * 3.2, 12 * px) * (m.nuke ? 1.3 : 1) * fl; // the plume follows the body, with a floor so a salvo reads at range
      B.glow.add(nx, ny, 3, Math.max(Wd * 1.5, 2 * px), Math.max(Wd * 1.5, 2 * px), 0, ex, .8, 1.8); // glare at the nozzle
      B.plume.add(nx, ny, 2, pl, Math.max(Wd * 1.3, 4), da, ex, .95, 1.6); /* the tail */ B.plume.add(nx, ny, 2.01, pl * .45, Math.max(Wd * .7, 2.5), da, 0xffffff, 1, 2.4); /* the white throat */
      if (!S.paused && !inPip && Math.random() < 36 * GDT && px < 40) S.parts.push({ x: m.x - ca * 8, y: m.y - sa * 8, vx: m.vx * .15 + rand(-6, 6), vy: m.vy * .15 + rand(-6, 6), life: m.nuke ? 2.2 : 1.1, max: m.nuke ? 2.2 : 1.1, size: (m.nuke ? 9 : 4) + px * .6, col: 0x9a948c, smoke: 1, drag: 1.5 }); }
  }
  for (const f of S.flashes) { const k = f.life / f.max, g = 1 - k, e = 1 - (1 - g) * (1 - g), R = Math.max(f.r * 2, (f.px || 0) * px) * (f.fire ? .6 + e * .6 : 1); if (f._rot == null) f._rot = (f.x * 5.3 + f.y * 2.9) % TAU;
    B.sglow.add(f.x, f.y, 6, R * (f.fire ? .8 : 1.2), R * (f.fire ? .8 : 1.2), 0, f.blue ? 0xb0dcff : f.col || 0xffd7a0, f.fire ? k * .9 : k * k, 2);
    if (!f.fire && !f.blue && f.r >= 800) { // a nuclear flash: the double pulse (a first spike, a dip as the shock front hides the fireball, then the long second peak), a white core with a cross of streaks, and the condensation ring running out ahead of the fireball
      const b = g < .1 ? 1 : g < .28 ? .3 : g < .5 ? .3 + (g - .28) / .22 * .65 : .95 * (1 - g) / .5, Rc = f.r * .35 * (1 + g * .6);
      B.sglow.add(f.x, f.y, 6.02, Rc, Rc, 0, 0xffffff, b, 3); B.anam.add(f.x, f.y, 6.03, R * 4.5, R * .14, 0, 0xfff4e4, b * .8, 2); B.anam.add(f.x, f.y, 6.03, R * .14, R * 3, 0, 0xfff4e4, b * .6, 2);
      const rd = f.r * (.9 + g * 3.2); B.shock.add(f.x, f.y, 5.95, rd, rd, 0, 0xfff6ea, (1 - g) * (1 - g) * .4, 1.6); }
    if (f.r >= 60 && !f.fire && k > .3) B.anam.add(f.x, f.y, 6.01, R * 3.2, R * .22, 0, f.blue ? 0xb0dcff : 0xfff0d8, (k - .3) * .6, 1.4); // the streak of a hard flash across the lens
    if (f.fire) { const d = f.r * (.5 + e * 1.3), col = k > .75 ? 0xfff2dc : k > .5 ? 0xffc860 : k > .25 ? 0xff8a3a : 0xd0481c, kk = k > .75 ? 2.4 : k > .5 ? 1.8 : 1.3; // a fireball: two turning layers, white → yellow → orange → ember
      B.fire.add(f.x, f.y, 6, d, d, f._rot + g * .7, col, Math.min(1, k * 1.5), kk); B.fire.add(f.x, f.y, 6.01, d * .8, d * .8, f._rot + 2.1 - g * .5, col, Math.min(1, k * 1.3) * .8, kk);
      if (f.r >= 500) { B.fire.add(f.x, f.y, 6.02, d * 1.1, d * 1.1, f._rot - 1.3 + g * .4, col, Math.min(1, k * 1.2) * .6, kk * .9); B.smoke.add(f.x, f.y, 5.88, d * (1.3 + g * .9), d * (1.3 + g * .9), f._rot + g * .6, 0x1e1814, g * .55); } // a nuclear fireball: a third turning layer, and a sooty cloud swelling round it for as long as it hangs
      if (k < .5) B.smoke.add(f.x, f.y, 5.9, d * 1.25, d * 1.25, f._rot - g, 0x2a2420, (.5 - k) * .8); } } // and the soot that follows
  for (const m of Object.values(missileM)) m.end(); for (const b of Object.values(B)) b.end();
  return { z, px, icons };
}
function drawMeter() { // F9: frame time, draw calls and the preset, top right under the bar
  const M = meterTick(performance.now()), I = renderer.info.render, P = preset();
  const lines = [`${M.fps.toFixed(0)} fps · ${M.ms.toFixed(1)} ms` + (M.gpu != null ? ` · GPU ${M.gpu.toFixed(1)} ms` : ''), `${I.drawCalls ?? I.calls} draws · ${(I.triangles / 1e6).toFixed(2)}M tris`, `${P.label} · ${DPR}× res · hulls ${S.hullX}×`, `${S.backend || ''}${S.gpu ? ' · ' + S.gpu : ''}`];
  ctx.save(); ctx.font = '12px ui-monospace,Consolas,monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16, x = S.W / 2 + w / 2, y = 94;
  ctx.fillStyle = 'rgba(8,9,12,.78)'; ctx.fillRect(x - w, y, w, lines.length * 16 + 10);
  ctx.fillStyle = M.ms > 20 ? '#ff9a3c' : '#cfe8d8'; lines.forEach((l, i) => ctx.fillText(l, x - 8, y + 6 + i * 16)); ctx.restore();
}

// ---------------------------------------------------------------- the campaign map: the same worlds, laid out as an orrery
// L.pos[id] = {x, y, r} in map units; L.orbits = [[cx, cy, R, kind]]; L.overlay(G, label, projectTo) draws the UI marks
export const overlayAPI = { label, projectTo, reserve: (x, y, w, h) => { for (let yy = y; yy < y + h; yy += 12) rects.push({ x: x + w / 2, y: yy, w }); }, get ctx() { return ctx; } };
function renderOrrery(L) {
  const c = S.cam, z = c.z, d = camDist();
  O.x = c.x; O.y = c.y;
  camera.aspect = S.W / S.H; camera.near = d * .04; camera.far = d * 40; camera.position.set(0, d * SE, d * CE); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const u = bgMesh.material.uniforms; u.res.value.set(S.W, S.H); SH.res.value.set(S.W, S.H); SH.time.value = performance.now() / 1000;
  u.o01.value.set((-c.x * .002 * z * 50) % 1024, (-c.y * .002 * z * 50) % 1024, (-c.x * .005 * z * 50) % 1024, (-c.y * .005 * z * 50) % 1024);
  u.o2n.value.set((-c.x * .01 * z * 50) % 1024, (-c.y * .01 * z * 50) % 1024, (-c.x * .065 * z) % 4096, (-c.y * .065 * z) % 4096); u.nz.value = 1 + .1 * clamp(Math.log10(z * 1e4) / 2, -1, 1); // the nebula sits between the far stars and the near, and breathes with the zoom
  if ((S.bodyVer || 0) !== bodyVerSeen) buildBodies();
  const sp = L.pos.sun, sunP = new THREE.Vector3(sp.x - O.x, 0, sp.y - O.y); scene.userData.sun.position.copy(sunP);
  for (const v of bodyVis) {
    const P = L.pos[v.b.id]; if (!P) { v.g.visible = false; if (v.atmo) v.atmo.visible = false; continue; }
    const x = P.x - O.x, y = P.y - O.y, vis = onScr(P.x, P.y, Math.max(P.r * z * 2.6, 40)); v.g.visible = vis; if (v.atmo) v.atmo.visible = vis;
    if (v.glow) { v.glow.position.set(x, 0, y); const gs = Math.max(P.r * 5, 120 / z); v.glow.scale.set(gs, gs, 1); } // never smaller than a glow on the screen
    if (v.corona) { v.corona.position.set(x, 0, y); const cs = Math.max(P.r * 11, 520 / z); v.corona.scale.set(cs, cs, 1); v.corona.material.opacity = .55 * clamp((P.r * z - 1.5) / 8, .35, 1); }
    glintFor(v, x, y, P.r * z, z, onScr(P.x, P.y, 40));
    if (!vis) continue;
    const b = v.b, par = P.parent ? L.pos[P.parent] : null, rot = par ? Math.atan2(par.x - P.x, par.y - P.y) + .35 + moonSpin() : spinPhase(b, L, bodyVis.indexOf(v)); // a moon keeps (roughly) one face to its parent
    v.g.position.set(x, 0, y); v.g.scale.setScalar(P.r); v.g.rotation.set(v.tilt, 0, 0); v.mesh.rotation.y = v.face + rot;
    if (v.clouds) { v.clouds.rotation.y = v.face + 1.3 + rot + performance.now() / 1000 * v.cspin * 3; v.clouds.material.uniforms.sunPos.value.copy(sunP); v.mesh.material.uniforms.cloudOff.value = -(1.3 + performance.now() / 1000 * v.cspin * 3) / TAU; }
    const EU = v.mesh.material.uniforms; if (EU.ecl) { if (par) { const k = eclipseK(P.x, P.y, par.x, par.y, par.r, { x: sp.x, z: sp.y }), pv = bodyVis.find(q => q.b.id === P.parent); EU.ecl.value = k; if (k > 0) EU.eclCol.value.setRGB(...(pv && pv.b.pal && pv.b.pal.atmo && !pv.b.gas ? [.45, .14, .08] : [.2, .2, .24])); } else EU.ecl.value = 0; }
    if (v.extra) v.extra.rotation.y = v.face;
    const U = v.mesh.material.uniforms; if (U.sunPos) U.sunPos.value.copy(sunP); if (U.C) { U.C.value.set(x, 0, y); U.pr.value = P.r; }
    if (v.atmo) { const R = P.r * v.atmoK; v.atmo.position.set(x, 0, y); v.atmo.scale.setScalar(R); const A = v.atmo.material.uniforms; A.C.value.set(x, 0, y); A.r.value = P.r; A.R.value = R; A.sunPos.value.copy(sunP); }
    if (v.ring) ringUniforms(v, x, y, P.r, sunP);
    if (v.moons && v.moons.length) moonShadows(v, x, y, P.r, sunP, m => L.pos[m.id]);
  }
  if (GD) GD.g.visible = false; if (VD) VD.g.visible = false; orreryYard('ganymede', L, z); orreryYard('venus', L, z);
  beltDust(sunP, z, true); comets(L, z);
  const fpz = footprint(); let reach = 0; for (const [wx, wy] of fpz) reach = Math.max(reach, hyp(wx - c.x, wy - c.y)); reach *= 1.15;
  for (const Lr of orbitL) Lr.n = 0;
  for (const [cx, cy, R, k] of L.orbits) ring(orbitL[k], cx, cy, R, reach);
  for (const Lr of orbitL) flushOrbit(Lr);
  shipsG.visible = false; rocksG.visible = false; debrisM.end(); for (const t of Object.values(turretM)) t.end(); for (const m of Object.values(missileM)) m.end(); for (const b of Object.values(B)) b.end();
  paradeDraw(S.parade); // the fleets in orbit
  renderer.info.reset();
  if (composer && (S.bloom || preset().post)) composer.render(); else renderer.render(scene, camera);
  gpuTimer(renderer); // resolve every frame so the query pool never fills; the meter reads the result
  ctx.setTransform(ODPR, 0, 0, ODPR, 0, 0); ctx.clearRect(0, 0, S.W, S.H); ctx.lineJoin = 'round';
  G.z = z; G.fresh = true; rects = []; labels = [];
  sunGlare(L.pos.sun);
  L.overlay(G, label, projectTo);
  flushLabels(); ctx.globalAlpha = 1;
}
// an orbit as a ribbon of quads: only the part near the screen, at a fixed number of segments
function ring(L, x, y, r, reach) {
  const c = S.cam, dc = hyp(c.x - x, c.y - y);
  if (dc - reach > r || dc + reach < r) return;
  let a0 = 0, a1 = TAU;
  if (reach < r * .5) { const mid = Math.atan2(c.y - y, c.x - x), half = Math.min(PI, reach / Math.max(1, dc - reach * .99) * 1.2 + .02); a0 = mid - half; a1 = mid + half; }
  const n = 160, A = L.a, Qa = L.q, Al = L.al; if ((L.n + n) * 12 > A.length) return;
  const fade = clamp((r * c.z - 10) / 60, .2, 1); // a small orbit on the screen fades, so the crowded middle never burns white
  let lx = x + Math.cos(a0) * r - O.x, ly = y + Math.sin(a0) * r - O.y;
  for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, nx = x + Math.cos(a) * r - O.x, ny = y + Math.sin(a) * r - O.y, o = L.n * 12, o4 = L.n * 4;
    Al[o4] = Al[o4 + 1] = Al[o4 + 2] = Al[o4 + 3] = fade;
    A[o] = lx; A[o + 1] = 0; A[o + 2] = ly; A[o + 3] = lx; A[o + 4] = 0; A[o + 5] = ly; A[o + 6] = nx; A[o + 7] = 0; A[o + 8] = ny; A[o + 9] = nx; A[o + 10] = 0; A[o + 11] = ny;
    Qa[o] = nx; Qa[o + 1] = 0; Qa[o + 2] = ny; Qa[o + 3] = nx; Qa[o + 4] = 0; Qa[o + 5] = ny; Qa[o + 6] = lx; Qa[o + 7] = 0; Qa[o + 8] = ly; Qa[o + 9] = lx; Qa[o + 10] = 0; Qa[o + 11] = ly;
    L.n++; lx = nx; ly = ny; }
}
function flushOrbit(L) { const g = L.l.geometry; g.setDrawRange(0, L.n * 6); L.l.visible = L.n > 0; /* WebGPU warns on an empty draw */ for (const k of ['position', 'oq', 'oa']) { const a = g.attributes[k]; a.clearUpdateRanges(); a.addUpdateRange(0, L.n * a.itemSize * 4); a.needsUpdate = true; } }

// Drop 3 materials, one set per class, team and navy: plating with lit windows, team-coloured trim (gold or bone on
// Society and Rim hulls), dark recesses, glowing windows and engines, and heavier armour plate
function shipMats3(type, team) { const fac = facKey(team) || 'none'; return mats3(type, fac, S.teamc[team], '3:' + type + ':' + team + ':' + fac); }
function mats3(type, fac, col, k) {
  if (MAT[k]) return MAT[k];
  const P = paintOf(type, fac), [map, emi, bump, rough] = hullTextures(type, fac);
  const trimC = new THREE.Color(col.main); if (P.trimMix) trimC.lerp(new THREE.Color(fac === 'rim' ? 0xe8e2d0 : 0xd9b25a), P.trimMix);
  const std = o => new THREE.MeshStandardMaterial({ flatShading: true, metalness: P.metal ?? .55, roughness: P.rough ?? .5, ...o });
  const bs = preset().post ? .0045 : .003; // plate relief: the edges catch the key light
  const hull = std({ color: P.hull, map, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: 1.25, bumpMap: bump, bumpScale: bs, roughnessMap: rough });
  const trim = std({ color: trimC, emissive: new THREE.Color(col.main), emissiveIntensity: .2, roughness: .36, metalness: .7 });
  const dark = std({ color: P.dark, metalness: .7, roughness: .62, bumpMap: bump, bumpScale: bs * .6 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc890, emissiveIntensity: 1.1 });
  const armour = std({ color: P.armour, map, roughness: (P.rough ?? .5) + .1, bumpMap: bump, bumpScale: bs * 1.4, roughnessMap: rough });
  const gun = std({ color: P.gun, metalness: .8, roughness: .34 });
  const red = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3020, emissiveIntensity: 2.2 }), green = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x30ff70, emissiveIntensity: 2.2 });
  const flash = std({ color: 0x8a8580, map, emissive: 0xff9070, emissiveIntensity: .8 });
  const dh = std({ color: 0x4a4a4c, map }), dd = std({ color: 0x2a2a2c });
  return MAT[k] = { n: [hull, trim, dark, glow, armour, gun, red, green], f: [flash, flash, dark, flash, flash, flash, red, green], d: [dh, dd, dark, dd, dh, dd, dd, dd], bell: { emissiveIntensity: 0 } };
}
// the strategic map's parade: [{ id, type, fac (style key), col (palette), x, y, a, vr }] — a mesh per ship, kept between frames
const paradeG = new THREE.Group(), paradeVis = new Map(); let paradeAdded = false;
function paradeDraw(L) {
  if (scene && paradeG.parent !== scene) scene.add(paradeG);
  paradeG.visible = !!(L && L.length); if (!L) return;
  const seen = new Set();
  for (const p of L) {
    if (!HAS_3D(p.type)) continue; seen.add(p.id);
    let v = paradeVis.get(p.id);
    if (!v || v.type !== p.type || v.fac !== p.fac || v.col !== p.col) { if (v) paradeG.remove(v.g); const H = buildHull(p.type, p.fac, p.vt || ''), M = mats3(p.type, p.fac, p.col, 'P:' + p.type + ':' + p.fac + ':' + p.col.main); const g = new THREE.Group(); g.add(new THREE.Mesh(H.geo, M.n)); paradeG.add(g); v = { g, type: p.type, fac: p.fac, col: p.col }; paradeVis.set(p.id, v); }
    v.g.position.set(p.x - O.x, p.y3 || 0, p.y - O.y); v.g.rotation.set(0, -p.a, 0); v.g.scale.setScalar(p.vr); v.g.visible = true;
  }
  for (const [id, v] of paradeVis) if (!seen.has(id)) { paradeG.remove(v.g); paradeVis.delete(id); }
}
// a named flagship with its own hull: the Annihilo, Atalantia au Grimmus's dreadnought, "shaped like an atavistic spear"
// the named flagships, by who commands the dreadnought: the Annihilo (Atalantia), the Pandora (the Julii: Victra, Antonia),
// the Invictus (House Augustus), the Pax (Orion, who captained her for Darrow); then a class's fittings
const NAMED = [[/Atalantia/, 'spear'], [/Victra|Antonia|Julii/, 'pandora'], [/Augustus/, 'invictus'], [/Orion|Darrow/, 'pax']];
const variantOf = s => (s.type === 'dread' && s.cmdr ? (NAMED.find(([re]) => re.test(s.cmdr.name || '')) || [0, ''])[1] : '') + (s.vt ? '|' + s.vt : '');
function makeShip(s) {
  if (HAS_3D(s.type)) {
    const vt = variantOf(s), H = buildHull(s.type, facKey(s.team) || 'none', vt), mats = shipMats3(s.type, s.team), g = new THREE.Group();
    const hull = new THREE.Mesh(H.geo, mats.n); g.add(hull); shipsG.add(g);
    return { g, hull, sup: [], mats, team: s.team, st: 'n', xmin: H.xmin, bells: H.bells, T: H.top * 2, hw: H.hw, deck: H.deck, band: H.band, is3d: true, vt };
  }
  const geo = hullGeo(s.type, facKey(s.team)), mats = shipMats(s.type, s.team), g = new THREE.Group();
  const hull = new THREE.Mesh(geo.hull, mats.n); g.add(hull); const sup = [];
  if (geo.sup) for (const sg of geo.sup) { const m = new THREE.Mesh(sg, mats.n); g.add(m); sup.push(m); }
  for (const yy of geo.bells) { const m = new THREE.Mesh(bellGeo(), mats.bell); m.position.set(geo.xmin - .02, 0, yy); m.scale.setScalar(s.def.fighter ? 1.4 : 1); g.add(m); }
  shipsG.add(g);
  return { g, hull, sup, mats, team: s.team, st: 'n', xmin: geo.xmin, bells: geo.bells, T: geo.T };
}

// ---------------------------------------------------------------- how a hull answers her guns and the enemy's
// Render-only: the sim records when each gun fired (w.fT) and where and how hard she was struck (s.hitX/Y, s.hitSum).
// Recoil and hits kick a damped spring in roll, yaw and pitch: quick and light on small hulls, slow and heavy on capitals.
// A hit lights where it landed and throws sparks; only a heavy blow flashes the whole hull. Hits that bite leave scars,
// and as her hull fails the scars vent atmosphere, then burn, her lights stutter and her drive coughs.
const recoilK = w => { const t = S.time - (w.fT ?? -9); return t < 0 || t > .7 ? 0 : t < .025 ? t / .025 : Math.exp(-(t - .025) * 7); };
function scarAt(v, th, out) { // a point on the hull's skin toward local bearing th
  const cx = Math.cos(th), sy = Math.sin(th), lx = clamp(cx, -.85, .85) * .85, hw = v.hw ? v.hw(lx) : .22;
  out.lx = lx; out.ly = (sy < 0 ? -1 : 1) * hw * Math.min(1, Math.abs(sy) * 1.6); return out; }
// ---------------------------------------------------------------- how she leans, and where her thrusters fire
// The hull leans into its acceleration, as a pilot would read it: into the curve of her path when she is under way
// (a burning turn), into a sideways shove from her side thrusters when she is slow. A capital turning in place on her
// axis does not roll at all. Fighters keep some roll from the turn itself, and dip the nose when they brake.
// Attitude jets fire when her turn speeds up or slows down, not all through a steady turn, at bow and stern on the
// skin, blowing outward; side thrusters fire on the flank (or the bow, braking) opposite the push. Nothing fires off
// the hull, nothing blows inward through it.
// where a round's line meets the hull AS DRAWN, for the sim's hit effects (it judges hits on a circle; a long thin hull
// fills little of it). (x, y) is the sim's hit point, (dx, dy) the round's path relative to the hull. Returns [x, y] on
// the skin, or null when the hull isn't drawn (off screen, a station) and the sim keeps its own point.
S.skinAt = (o, x, y, dx, dy) => {
  const v = shipVis.get(o.id); if (!v || !v.g || o.def.static) return null; hullX(v);
  const R = vrOf(o), ca = Math.cos(o.a), sa = Math.sin(o.a), hx = ((x - o.x) * ca + (y - o.y) * sa) / R, hy = (-(x - o.x) * sa + (y - o.y) * ca) / R;
  const inside = (lx, ly) => lx >= v.xlo && lx <= v.xmax && Math.abs(ly) <= skinW(v, lx), W = (lx, ly) => [o.x + (lx * ca - ly * sa) * R, o.y + (lx * sa + ly * ca) * R];
  const d = Math.hypot(dx, dy); let ux = 1, uy = 0; if (d > 0) { ux = (dx * ca + dy * sa) / d; uy = (-dx * sa + dy * ca) / d; }
  if (d > 0) { const span = Math.max(v.xmax - v.xlo, .5) * 1.4, N = 72, st = 2 * span / N;
    for (let i = 0; i <= N; i++) { const t = -span + st * i; if (!inside(hx + ux * t, hy + uy * t)) continue; // the first point of her inside, coming along the round's path
      let a = t - st, b = t; for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (inside(hx + ux * m, hy + uy * m)) b = m; else a = m; } return W(hx + ux * b, hy + uy * b); } }
  // the path misses the hull as drawn (the circle caught it): the round lands on the skin nearest its closest approach
  const tc = -(hx * ux + hy * uy), cx = hx + ux * tc, cy = hy + uy * tc, lx = clamp(cx, v.xlo * .92, v.xmax * .92);
  return W(lx, (cy < 0 ? -1 : 1) * skinW(v, lx));
};
function hullX(v) { if (v.xmax === undefined) { const g = v.hull && v.hull.geometry; if (g) { if (!g.boundingBox) g.computeBoundingBox(); v.xmax = g.boundingBox.max.x; v.xlo = g.boundingBox.min.x; } else { v.xmax = 1; v.xlo = v.xmin ?? -1; } } }
const skinW = (v, lx) => Math.max(.03, v.hw ? v.hw(lx) : .18);
function jet(s, v, vr, lx, ly, dx, dy, k) { // a cold-gas puff from the hull's skin at (lx, ly), blowing along local (dx, dy)
  const ca = Math.cos(s.a), sa = Math.sin(s.a), sp = 30 + vr * 1.6 * (.7 + .3 * k);
  S.parts.push({ x: s.x + (lx * ca - ly * sa) * vr, y: s.y + (lx * sa + ly * ca) * vr, vx: s.vx + (dx * ca - dy * sa) * sp + rand(-8, 8), vy: s.vy + (dx * sa + dy * ca) * sp + rand(-8, 8), life: rand(.16, .26), max: .26, size: vr * (.03 + .025 * k) + .4, col: 0xdfe6ee, drag: 3.5 });
}
function thrusters(s, v, vr, vz, dark) {
  const dt = GDT; if (!(dt > 0)) return; hullX(v);
  const stale = RCLK - (v.thT ?? -1) > .25; v.thT = RCLK;
  if (stale || v.vxP === undefined) { v.vxP = s.vx; v.vyP = s.vy; v.avP = s.av || 0; v.aa = 0; v.alx = v.aly = 0; return; }
  const T = Math.max(1, s.def.thrust * Math.max(s.hf || 1, .15) * (s.transit || 1)), fast = s.def.fighter || s.def.shell, big = vr > 30;
  // her acceleration, read from her velocity, smoothed (a frame may hold no sim step, the next two); a blast's shove is clipped
  let ax = (s.vx - v.vxP) / dt, ay = (s.vy - v.vyP) / dt; v.vxP = s.vx; v.vyP = s.vy; const am = Math.hypot(ax, ay); if (am > T * 2) { ax *= T * 2 / am; ay *= T * 2 / am; }
  const ks = 1 - Math.exp(-dt / .12); v.alx += (ax - v.alx) * ks; v.aly += (ay - v.aly) * ks;
  const aa = ((s.av || 0) - v.avP) / dt; v.avP = s.av || 0; v.aa += (aa - v.aa) * (1 - Math.exp(-dt / .08));
  // the lean: across her path when under way, across her hull when slow
  const ca = Math.cos(s.a), sa = Math.sin(s.a), sp = Math.hypot(s.vx, s.vy), wv = clamp(sp / (T * 2.5), 0, 1);
  const perpV = sp > 1 ? (s.vx * v.aly - s.vy * v.alx) / sp : 0, perpH = -v.alx * sa + v.aly * ca, along = sp > 1 ? (s.vx * v.alx + s.vy * v.aly) / sp : 0;
  const trMax = s.def.turn * Math.max(s.hf || 1, .15) || 1, maxB = fast ? .7 : big ? .1 : .28;
  let bankT = clamp((perpV * wv + perpH * (1 - wv)) / T, -1, 1) * maxB;
  if (fast) bankT = bankT * .55 + clamp((s.av || 0) / trMax, -1, 1) * maxB * .45;
  v.bank += (bankT - v.bank) * (1 - Math.exp(-4.4 * dt));
  const pitchT = fast ? clamp(along / T, -1, 1) * .12 : big ? 0 : clamp(along / T, -1, 1) * .035; // she dips her nose to brake, squats a little to burn
  v.pitch += (pitchT - v.pitch) * (1 - Math.exp(-5 * dt));
  if (S.paused || dark || s.cold || vz < 7 || s.def.static) return;
  // attitude jets: only while her turn is changing speed
  const acc = trMax * 2.2, ka = Math.abs(v.aa) / acc;
  if (ka > .25) { const sg = Math.sign(v.aa), k = Math.min(1, ka), bx = v.xmax * .82, sx = v.xlo * .82, r = (12 + 18 * k) * dt;
    if (Math.random() < r) jet(s, v, vr, bx, -sg * skinW(v, bx), 0, -sg, k); // bow pushed one way...
    if (Math.random() < r) jet(s, v, vr, sx, sg * skinW(v, sx), 0, sg, k); } // ...stern the other: a couple
  // side thrusters: on the skin opposite the push, a pair along the flank so she slides without turning
  const rx = s.rx || 0, ry = s.ry || 0, rm = Math.hypot(rx, ry), rmax = T * (s.def.rcs || .2);
  if (rm > rmax * .25) { const k = Math.min(1, rm / rmax), fx = (rx * ca + ry * sa) / rm, fy = (-rx * sa + ry * ca) / rm, r = (10 + 16 * k) * dt;
    if (Math.abs(fy) > .3) { const sd = -Math.sign(fy); for (const lx of [v.xmax * .5, v.xlo * .5]) if (Math.random() < r * Math.abs(fy)) jet(s, v, vr, lx, sd * skinW(v, lx), 0, sd, k); }
    if (fx < -.3) { const bx = v.xmax * .9; for (const sd of [-1, 1]) if (Math.random() < r * -fx) jet(s, v, vr, bx, sd * skinW(v, bx) * .6, 1, sd * .25, k); } } // braking: retro jets at the bow, blowing forward
}
function fxInit(v) { v.kr = v.ky = v.kp = v.krv = v.kyv = v.kpv = 0; v.bank = v.pitch = v.alx = v.aly = 0; v.vxP = v.vyP = v.avP = v.aa = undefined; v.hits = []; v.scars = []; v.hvT = v.ltT = v.cutT = 0; v.sput = 1; }
function shipFx(s, v, vr, vz, dark) {
  const stale = RCLK - (v.fxT ?? -1) > .25; v.fxT = RCLK; // back from off screen or the icon view: take the books as they stand, no backlog of effects
  const dt = Math.min(GDT, .05), big = vr > 30, w0 = s.def.fighter || s.def.shell ? 24 : big ? 6.5 : 11, ca = Math.cos(s.a), sa = Math.sin(s.a), parts = !S.paused && vz > 6;
  // her own guns
  for (const w of s.weapons) { if (w.fT == null || w.fT === w._fT) continue; const fresh = w._fT !== undefined && !stale && S.time - w.fT < .3; w._fT = w.fT;
    if (!fresh || !w.def.recoil || s.def.static) continue;
    const J = Math.min(1, Math.sqrt(w.def.recoil / Math.max(.5, s.mass || s.def.mass || 1) / 60)), rel = angDiff(s.a, w.ang ?? s.a + (w.dir || 0));
    v.krv -= Math.sin(rel) * J * .05 * w0; /* she heels away from a broadside */ v.kpv += Math.max(0, Math.cos(rel)) * J * .035 * w0; /* and her bow lifts to a spinal gun */ v.kyv -= Math.sin(rel) * J * .008 * w0; }
  // the enemy's
  const hs = s.hitSum || 0, dH = v._hs === undefined || stale ? 0 : hs - v._hs; v._hs = hs;
  if (dH > 0) { const f = dH / s.def.hp, k = Math.min(1, f * 12), th = s.hitX != null ? Math.atan2(s.hitY - s.y, s.hitX - s.x) - s.a : Math.random() * TAU, h = { t: RCLK, k };
    if (s.hitX != null) { hullX(v); const dx = s.hitX - s.x, dy = s.hitY - s.y, lx = (dx * ca + dy * sa) / vr, ly = (-dx * sa + dy * ca) / vr; // where it landed, on her skin as drawn (S.skinAt)
      if (lx >= v.xlo - .05 && lx <= v.xmax + .05 && Math.abs(ly) <= skinW(v, lx) * 1.2 + .02) { h.lx = lx; h.ly = ly; } else scarAt(v, th, h); } else scarAt(v, th, h);
    h.hz = v.deck ? Math.max(.02, v.deck(clamp(h.lx, v.xlo ?? -1, v.xmax ?? 1), h.ly * .9) * .6) : .12; // up her side, not on the waterline of the plane
    v.hits.push(h); if (v.hits.length > 6) v.hits.shift();
    (v.scorch || (v.scorch = [])).push({ lx: h.lx, ly: h.ly, hz: h.hz, r: .05 + .12 * k, a: Math.random() * TAU, k }); if (v.scorch.length > 18) v.scorch.shift(); // and the burn stays on her skin
    // she is knocked away from the blow: a hit on one flank rolls her off it, and one forward or aft of her middle slews her
    const sd = h.ly < 0 ? -1 : 1, lever = clamp(h.lx, -1, 1);
    v.krv -= sd * (.035 + .02 * Math.random()) * k * w0; v.kyv += sd * lever * .03 * k * w0; v.kpv += (h.lx > 0 ? -1 : 1) * .008 * k * w0 * (Math.abs(lever) > .5 ? 1 : 0);
    if (f > .06) v.hvT = RCLK + .09;
    if (f > .015) { const sc = { lx: h.lx, ly: h.ly, p: Math.random() * TAU, f: 6 + Math.random() * 6 }; if (v.scars.length < 5) v.scars.push(sc); else v.scars[(Math.random() * 5) | 0] = sc; }
    if (parts) { const wx = s.x + (h.lx * ca - h.ly * sa) * vr, wy = s.y + (h.lx * sa + h.ly * ca) * vr, a0 = th + s.a, n = 2 + Math.round(k * 10);
      for (let i = 0; i < n; i++) { const a = a0 + rand(-.9, .9), sp = rand(150, 500) * (.6 + k); S.parts.push({ x: wx, y: wy, vx: s.vx + Math.cos(a) * sp, vy: s.vy + Math.sin(a) * sp, life: rand(.15, .4), max: .4, size: 2, col: i & 1 ? 0xffc27a : 0xfff0d0, spark: 1, drag: 3 }); } } }
  while (v.hits.length && RCLK - v.hits[0].t > .35) v.hits.shift();
  // the springs (substepped: a quick small hull would ring itself apart in one long frame)
  if (dt > 0) { const n = Math.ceil(dt * w0 / .25), h = dt / n, d2 = 2 * .32 * w0, k2 = w0 * w0;
    for (let i = 0; i < n; i++) { v.krv += (-k2 * v.kr - d2 * v.krv) * h; v.kyv += (-k2 * v.ky - d2 * v.kyv) * h; v.kpv += (-k2 * v.kp - d2 * v.kpv) * h; v.kr += v.krv * h; v.ky += v.kyv * h; v.kp += v.kpv * h; }
    v.kr = clamp(v.kr, -.14, .14); v.ky = clamp(v.ky, -.05, .05); v.kp = clamp(v.kp, -.06, .06); }
  // how badly she is hurt
  const hp = s.hp / s.def.hp, want = hp < .35 ? 3 : hp < .6 ? 2 : 0;
  while (v.scars.length < want) { const sc = scarAt(v, Math.random() * TAU, { p: Math.random() * TAU, f: 6 + Math.random() * 6 }); v.scars.push(sc); }
  if (hp < .6 && parts && dt > 0) for (let i = 0; i < v.scars.length && i < (hp < .35 ? 5 : 2); i++) if (Math.random() < (hp < .35 ? 6 : 3.5) * dt) { // venting atmosphere, out of the breach
    const q = v.scars[i], sg = q.ly < 0 ? -1 : 1, wx = s.x + (q.lx * ca - q.ly * sa) * vr, wy = s.y + (q.lx * sa + q.ly * ca) * vr, nx = -sa * sg, ny = ca * sg, sp = rand(40, 110);
    S.parts.push({ x: wx, y: wy, vx: s.vx + nx * sp + rand(-15, 15), vy: s.vy + ny * sp + rand(-15, 15), life: rand(.4, .7), max: .7, size: vr * .022 + .5, col: 0xd2d8de, smoke: 1, drag: 1.6 });
    if (hp < .35 && Math.random() < .3) for (let j = 0; j < 3; j++) { const a = Math.atan2(ny, nx) + rand(-.8, .8), v2 = rand(120, 380); S.parts.push({ x: wx, y: wy, vx: s.vx + Math.cos(a) * v2, vy: s.vy + Math.sin(a) * v2, life: rand(.1, .3), max: .3, size: 2, col: 0xffb060, spark: 1, drag: 3 }); } }
  if (s.sub && parts && dt > 0) { hullX(v); const sb = s.sub; // a wrecked compartment smokes where it is: the drive aft, the bridge amidships, a gun deck on its own flank
    for (const [down, lx, side] of [[sb.eng <= 0, v.xlo * .85, 0], [sb.bridge <= 0, v.xmax * .15, 0], [sb.gunsP <= 0, 0, -1], [sb.gunsS <= 0, 0, 1]]) if (down && Math.random() < 2 * dt) {
      const ly = side * skinW(v, lx) * (.8 + Math.random() * .2), lx2 = lx + rand(-.12, .12), wx = s.x + (lx2 * ca - ly * sa) * vr, wy = s.y + (lx2 * sa + ly * ca) * vr;
      S.parts.push({ x: wx, y: wy, vx: s.vx + (-sa * side) * rand(5, 20) + rand(-10, 10), vy: s.vy + (ca * side) * rand(5, 20) + rand(-10, 10), life: rand(1.2, 2.4), max: 2.4, size: vr * .05 + 2, col: 0x3a3430, smoke: 1, drag: .5 }); } }
  if (hp < .35 && !dark && dt > 0 && RCLK > v.ltT + .15 && Math.random() < 1.6 * dt) v.ltT = RCLK + rand(.04, .12); // her lights stutter
  if (hp < .2 && dt > 0 && RCLK > v.cutT + .3 && Math.random() < .8 * dt) v.cutT = RCLK + rand(.06, .14); // and her drive coughs
  v.sput = hp >= .2 ? 1 : RCLK < v.cutT ? .2 : .82 + .18 * Math.sin(RCLK * 23 + s.id) * Math.sin(RCLK * 7.3 + s.id * .4);
}
// a big ship's shadow falling across a smaller one lying behind her from the Sun: a soft dark blot over the shadowed
// hull, deepest in the middle of the corridor, fading with distance down it. Only where a hull is there to catch it.
function shipShadow(s, vr, sunP) {
  if (s.def.static || s.r < 28) return; let lx = s.x - (sunP.x + O.x), ly = s.y - (sunP.z + O.y); const l = hyp(lx, ly) || 1; lx /= l; ly /= l; // away from the Sun
  const hw = vr * .5, reach = vr * 7;
  for (const t of S.ships) { if (t === s || t.dead || t.def.static) continue; const dx = t.x - s.x, dy = t.y - s.y, along = dx * lx + dy * ly; if (along < vr * .3 || along > reach) continue;
    const perp = Math.abs(dx * ly - dy * lx), tv = vrOf(t); if (perp > hw + tv) continue;
    const k = clamp((hw + tv * .5 - perp) / (tv + 1), 0, 1) * (1 - along / reach) * (tv < vr ? 1 : .4); if (k < .03) continue;
    B.soot.add(t.x, t.y, tv * .36, tv * 2.6, tv * 2.2, t.a, 0x000000, k * .55, 1); }
}
function shipFxDraw(s, v, vr, z) {
  if (!v.hits) return; const ca = Math.cos(s.a), sa = Math.sin(s.a), mn = 3 / Math.max(z, 1e-9);
  for (const h of v.hits) { const k = 1 - (RCLK - h.t) / .35; if (k <= 0) continue; const wx = s.x + (h.lx * ca - h.ly * sa) * vr, wy = s.y + (h.lx * sa + h.ly * ca) * vr, gs = Math.max(mn * (1 + h.k * 2), vr * (.07 + .2 * h.k)) * (1.5 - k * .5);
    B.glow.add(wx, wy, vr * (h.hz ?? .12), gs, gs, 0, k > .6 ? 0xffd8b0 : 0xff9a50, k * k * (.35 + .4 * h.k), 1.7); } // the scorch on her skin (the strike's own flash is the ring's, in the fx pass)
  const hp = s.hp / s.def.hp;
  if (v.scorch && vr * z > 10) for (const q of v.scorch) { const wx = s.x + (q.lx * ca - q.ly * sa) * vr, wy = s.y + (q.lx * sa + q.ly * ca) * vr, gs = vr * q.r * 2.4; // soot where each blow landed, darker on a hurt ship
    B.soot.add(wx, wy, vr * (q.hz ?? .12) + .01, gs * 1.6, gs * 1.3, q.a + s.a, 0x8a8078, .22 * (.5 + q.k), 1); B.soot.add(wx, wy, vr * (q.hz ?? .12) + .012, gs, gs * .8, q.a + s.a, 0x070605, (.5 + .35 * q.k), 1); } // an ash-pale ring round a black heart
  if (hp < .6) for (const q of v.scars) { // cracks glowing round each breach: three short jagged lines, pulsing with the fire inside
    if (!q.cr) q.cr = [0, 1, 2].map(i => ({ a: q.p + i * 2.1 + Math.random() * .7, l: .07 + Math.random() * .09, w: .5 + Math.random() * .5 }));
    const wx = s.x + (q.lx * ca - q.ly * sa) * vr, wy = s.y + (q.lx * sa + q.ly * ca) * vr, fl = .6 + .4 * Math.sin(RCLK * q.f * .7 + q.p), heat = hp < .35 ? 1 : (.6 - hp) / .25;
    for (const c of q.cr) B.streak.add(wx, wy, vr * .15, vr * c.l * (1 + heat * .4), Math.max(mn * .8, vr * .022 * c.w), c.a + s.a, fl > .7 ? 0xffb060 : 0xff6a28, (.5 + .5 * fl) * heat, 2); }
  if (hp < .35) for (const q of v.scars) { const wx = s.x + (q.lx * ca - q.ly * sa) * vr, wy = s.y + (q.lx * sa + q.ly * ca) * vr, fl = Math.sin(RCLK * q.f + q.p), gs = Math.max(mn, vr * (.13 + .03 * fl + .015 * Math.sin(RCLK * q.f * 2.3 + q.p)));
    B.glow.add(wx, wy, vr * .14, gs, gs, 0, fl > .3 ? 0xffc070 : 0xff8a3c, .45 + .15 * fl, 1.4); } // fires burning in the breaches
}

// a capital ship in her death throes, and the hulk she leaves: one mesh each, reusing the ship's own hull and its dark
// materials; the throes add fires along the hull and a flicker of the flash material. Nothing is drawn off screen.
function drawWrecks(z, seen) {
  for (const L of [S.wrecks, S.hulks]) for (const w of L || []) {
    if (w.dead) continue; const key = 'w' + w.id; seen.add(key);
    const vr = w.def.vr0 ? w.def.vr0 * (S.hullX || HULL_REF) / HULL_REF : w.r, on = onScr(w.x, w.y, vr * z * 3 + 80) && vr * z > 2;
    let v = shipVis.get(key);
    if (!on) { if (v) v.g.visible = false; continue; }
    if (!v) { v = makeShip({ type: w.type, team: w.origTeam ?? w.team, cmdr: w.cmdr, vt: w.vt, def: w.def }); v.g.rotation.order = 'YXZ'; shipVis.set(key, v); }
    v.g.visible = true; v.g.position.set(w.x - O.x, 0, w.y - O.y); v.g.rotation.set(w.roll, -w.a, 0); v.g.scale.setScalar(vr);
    if (!w.hulk && !inPip && RCLK > (v.fT || 0) + .05 && Math.random() < 4.2 * GDT) v.fT = RCLK + 1 / 45; const st = !w.hulk && RCLK < (v.fT || 0) ? 'f' : 'd'; /* a flicker that lasts a beat at any refresh rate */ if (v.st !== st) { v.st = st; v.hull.material = v.mats[st]; for (const m of v.sup) m.material = v.mats[st]; }
    if (v.mats.bell) v.mats.bell.emissiveIntensity = 0;
    if (!w.hulk) { const k = (S.time - w.t0) / w.T, ca = Math.cos(w.a), sa = Math.sin(w.a);
      if (!v.fires) v.fires = [0, 1, 2, 3].map(() => ({ x: Math.random() * 1.8 - .9, y: (Math.random() - .5) * .3, p: Math.random() * TAU, f: 5 + Math.random() * 7, c: Math.random() < .5 ? 0xff8a3c : 0xffc070 })); // fires that stay where they broke out, and flicker
      for (const F of v.fires) { const lx = F.x * vr, ly = F.y * vr, gx = w.x + ca * lx - sa * ly, gy = w.y + sa * lx + ca * ly, gs = vr * (.4 + .1 * Math.sin(RCLK * F.f + F.p) + .05 * Math.sin(RCLK * F.f * 2.3 + F.p * 1.7)) * (1 + k); B.glow.add(gx, gy, vr * .2, gs, gs, 0, F.c, .35 + .4 * k, 1.4); }
      if (k > .85) { const gs = vr * 3 * (k - .85) / .15; B.glow.add(w.x, w.y, vr * .3, gs, gs, 0, 0xfff0d0, .8, 1.8); } } // the reactor going
  }
}
// turrets, batteries and missile tubes on top of a hull
// ---------------------------------------------------------------- turrets on a hull that rolls, pitches and kicks
// A ship's guns ride her hull: each mount is placed in the hull's own frame, so when she banks, heels to a broadside
// or shudders from a hit, her turrets go with her. The barbette sits on the highest deck under it and reaches down to
// the lowest, so it never floats off a chamfer or sinks into a raised deck; and each barrel lifts as it trains over
// the hull, by a clearance table worked out once per hull shape and mount (72 bearings), so it never passes through
// the superstructure, the deck, or a tower: the way a ship's guns elevate to fire across her own deck.
const _TM = new THREE.Matrix4(), _TT = new THREE.Matrix4(), _TZ = new THREE.Matrix4(), _TF = new THREE.Matrix4(), _TP = new THREE.Vector3(), _TS = new THREE.Vector3();
const CLR = new WeakMap(), CLR_N = 72;
function mountClear(v, lx, ly, trU, lenU, axU, lat) {
  const k0 = v.hw || v; let M = CLR.get(k0); if (!M) CLR.set(k0, M = new Map());
  const key = lx.toFixed(3) + ',' + ly.toFixed(3) + ',' + trU.toFixed(4) + ',' + lenU.toFixed(4) + ',' + axU.toFixed(4); let c = M.get(key); if (c) return c;
  const deck = (x, y) => v.deck(x, y);
  let hi = deck(lx, ly), lo = hi; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, d = deck(lx + Math.cos(a) * trU * 1.05, ly + Math.sin(a) * trU * 1.05); if (d > hi) hi = d; if (d < lo) lo = d; }
  lo = Math.max(lo, hi - trU * 1.5);
  const ha = hi + axU, el = new Float32Array(CLR_N);
  for (let i = 0; i < CLR_N; i++) { const f = i / CLR_N * TAU, dx = Math.cos(f), dy = -Math.sin(f), px0 = Math.sin(f), py0 = Math.cos(f); let e = 0;
    for (const off of lat) for (let j = 1; j <= 8; j++) { const t = trU * .9 + (lenU * 1.1 - trU * .9) * j / 8, top = deck(lx + dx * t + px0 * off, ly + dy * t + py0 * off) + trU * .14;
      if (top > ha) e = Math.max(e, Math.atan2(top - ha, t)); }
    el[i] = e > 0 ? Math.min(1.15, e * 1.08 + .03) : 0; }
  const w = new Float32Array(CLR_N); for (let i = 0; i < CLR_N; i++) w[i] = Math.max(el[(i + CLR_N - 1) % CLR_N], el[i], el[(i + 1) % CLR_N]); // a barrel between bearings clears both
  M.set(key, c = { hi, lo, el: w }); return c;
}
const clearAt = (c, yaw) => { if (!c.el) return 0; let f = (yaw % TAU + TAU) % TAU / TAU * CLR_N; const i = Math.floor(f) % CLR_N, j = (i + 1) % CLR_N; f -= Math.floor(f); return c.el[i] * (1 - f) + c.el[j] * f; };
function turrets(s, z, top, R = s.r, v = null) {
  if (R * z < 7 || !onScr(s.x, s.y, R * z * 2)) return;
  if (!v || !v.g || s.def.static) return turretsFlat(s, z, top, R, v);
  const mk = s.def.vr0 ? R / s.def.vr0 : 1, c0 = Math.cos(s.a), s0 = Math.sin(s.a), hw = v.hw, is3d = !!v.is3d;
  const loc = w => { let lx = ((w.mx - s.x) * c0 + (w.my - s.y) * s0) * mk / R, ly = (-(w.mx - s.x) * s0 + (w.my - s.y) * c0) * mk / R; if (hw) { const h = hw(lx), [lo, hi] = v.band || [0, .62], sg = ly < 0 ? -1 : 1, a = Math.abs(ly); ly = sg * Math.max(lo * h, Math.min(hi * h, a)); } return [lx, ly]; };
  _TM.makeRotationFromEuler(v.g.rotation); const hy = v.g.rotation.y, topU = top / R;
  const put = (inst, lx, lh, ly, yaw, elev, sx, sy, sz, col) => { _TP.set(lx * R, lh * R, ly * R).applyMatrix4(_TM); _TT.makeRotationY(yaw); if (elev) _TT.multiply(_TZ.makeRotationZ(elev)); _TT.scale(_TS.set(sx, sy, sz)); _TF.multiplyMatrices(_TM, _TT); inst.addM(_TF, s.x + _TP.x, s.y + _TP.z, _TP.y, col); };
  const col = hex(S.teamc[s.team].main), dead = disabled(s);
  for (const w of s.weapons) {
    const D = w.def;
    if (D.kind === 'missile') { const sz = R * .08, [lx, ly] = loc(w), h = v.deck ? v.deck(lx, ly) : topU; put(turretM.box, lx, h - sz * .1 / R, ly, 0, 0, sz, sz * .32, sz * .8, D.nuke ? 0x5a1a14 : D.emp ? 0x1a3a5a : 0x1a1a1e); continue; } // a flush silo hatch
    if (D.turn === 0) continue;
    if (D.battery && is3d) continue; // broadside rail guns: they are the gun houses built along the hull's flanks
    const yaw = -w.ang - hy; // her bearing on the hull: she keeps her aim while the hull kicks under her
    if (D.battery) {
      const half = R * .14, tr = R * .045, n = Math.min(w.guns, 5), [lx, ly] = loc(w), rb = recoilK(w) * tr * .8;
      put(turretM.box, lx, topU, ly, 0, 0, half * 2, tr * .9, tr * 2.2, 0x26262c);
      for (let i = 0; i < n; i++) { const k = (i / Math.max(1, n - 1) - .5) * 2 * half / R; put(turretM.barrel, lx + k - Math.cos(yaw) * rb / R, topU + tr * .5 / R, ly + Math.sin(yaw) * rb / R, yaw, 0, tr * 2.6, tr * .45, tr * .45, w.ammo <= 0 ? 0x5a4a40 : 0x8f8a80); }
      continue;
    }
    const tr = D.pd ? R * .045 : R * .075, trU = tr / R, [lx, ly] = loc(w), flak = D.pd && is3d;
    const lenM = D.pd ? (flak ? 1.1 : 1.7) : 2, pivM = D.pd ? (flak ? .05 : .2) : .18, thM = D.pd ? (flak ? .18 : .2) : .26;
    const C = v.deck ? mountClear(v, lx, ly, trU, lenM * trU, (pivM + thM * .5) * trU, D.pd ? [0] : [-.3 * trU, .3 * trU]) : { hi: topU, lo: topU, el: null };
    const sy0 = tr * (flak ? .35 : .8); // the barbette, from the lowest deck under it to its own height above the highest
    put(turretM.base, lx, C.lo - trU * .08, ly, yaw, 0, tr, sy0 + (C.hi - C.lo) * R / .64, tr, dead ? 0x3a3a3a : D.pd ? 0x3a3a40 : 0x4a4844);
    const eT = clearAt(C, yaw); if (w._elT !== RCLK) { w._elT = RCLK; const e0 = w._el ?? eT; w._el = Math.max(eT - .04, e0 + (eT - e0) * (1 - Math.exp(-(eT > e0 ? 14 : 5) * GDT))); } // lift quickly, settle slowly
    const e = Math.max(0, w._el), ce = Math.cos(e), se = Math.sin(e), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const bc = dead ? 0x555555 : w.ammo <= 0 ? 0x5a4a40 : 0x6e6a64, rb = recoilK(w) * trU * (D.pd ? .25 : .55); // the barrels slam back along their own line and run out again
    const bx = lx - cy * ce * rb, bh = C.hi + pivM * trU - se * rb, by = ly + sy * ce * rb;
    if (D.pd) { put(turretM.barrel, bx, bh, by, yaw, e, tr * lenM, tr * thM, tr * thM, bc); continue; }
    for (const k of [-.3, .3]) put(turretM.barrel, bx + sy * trU * k, bh, by + cy * trU * k, yaw, e, tr * lenM, tr * thM, tr * thM, bc); // twin barrels
  }
}
function turretsFlat(s, z, top, R = s.r, v = null) { // stations and platforms: they do not roll
  if (R * z < 7 || !onScr(s.x, s.y, R * z * 2)) return;
  const mk = s.def.vr0 && !s.def.static ? R / s.def.vr0 : 1; // the sim places mounts at the reference hull size
  const c0 = Math.cos(s.a), s0 = Math.sin(s.a), hw = v && v.hw;
  // a mount's place on the hull, in hull units: kept inboard of the hull's real flank, so no gun hangs off the side
  const loc = w => { let lx = ((w.mx - s.x) * c0 + (w.my - s.y) * s0) * mk / R, ly = (-(w.mx - s.x) * s0 + (w.my - s.y) * c0) * mk / R; if (hw) { const h = hw(lx), [lo, hi] = v.band || [0, .62], sg = ly < 0 ? -1 : 1, a = Math.abs(ly); ly = sg * Math.max(lo * h, Math.min(hi * h, a)); } return [lx, ly]; };
  const WX = w => { const [lx, ly] = loc(w); return s.x + (lx * c0 - ly * s0) * R; }, WY = w => { const [lx, ly] = loc(w); return s.y + (lx * s0 + ly * c0) * R; };
  const TOP = w => { if (!v || !v.deck) return top; const [lx, ly] = loc(w); return v.deck(lx, ly) * R; }; // seated on the deck beneath it
  const col = hex(S.teamc[s.team].main), dead = disabled(s);
  for (const w of s.weapons) {
    const D = w.def;
    if (D.kind === 'missile') { const sz = s.def.static ? 8 : R * .08, h = TOP(w); turretM.box.add(WX(w), WY(w), h - sz * .1, -s.a, sz, sz * .32, sz * .8, D.nuke ? 0x5a1a14 : D.emp ? 0x1a3a5a : 0x1a1a1e); continue; } // a flush silo hatch
    if (D.turn === 0) continue;
    if (D.battery && v && v.is3d) continue; // broadside rail guns: they are the gun houses built along the hull's flanks
    if (D.battery) {
      const half = R * .14, tr = Math.max(s.def.static ? 2 : 0, R * .045), n = Math.min(w.guns, 5);
      turretM.box.add(WX(w), WY(w), top, -s.a, half * 2, tr * .9, tr * 2.2, 0x26262c);
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const rb = recoilK(w) * tr * .8, rx = -Math.cos(w.ang) * rb, ry = -Math.sin(w.ang) * rb;
      for (let i = 0; i < n; i++) { const k = (i / Math.max(1, n - 1) - .5) * 2 * half; turretM.barrel.add(WX(w) + ca * k + rx, WY(w) + sa * k + ry, top + tr * .5, -w.ang, tr * 2.6, tr * .45, tr * .45, w.ammo <= 0 ? 0x5a4a40 : 0x8f8a80); }
      continue;
    }
    const tr = s.def.static ? (D.pd ? (s.type === 'station' ? 6 : 5) : (s.type === 'station' ? 11 : 9)) : D.pd ? R * .045 : R * .075, h = TOP(w), x0 = WX(w), y0 = WY(w);
    turretM.base.add(x0, y0, h - tr * .08, -w.ang, tr, tr * (D.pd && v && v.is3d ? .35 : .8), tr, dead ? 0x3a3a3a : D.pd ? 0x3a3a40 : 0x4a4844);
    const bc = dead ? 0x555555 : w.ammo <= 0 ? 0x5a4a40 : 0x6e6a64, ca = Math.cos(w.ang), sa = Math.sin(w.ang), rb = recoilK(w) * tr * (D.pd ? .25 : .55), x = x0 - ca * rb, y = y0 - sa * rb; // the barrels slam back and run out again
    if (D.pd && v && v.is3d) { turretM.barrel.add(x, y, h + tr * .05, -w.ang, tr * 1.1, tr * .18, tr * .18, bc); continue; } // a low flak blister with a stubby gun
    if (D.pd) turretM.barrel.add(x, y, h + tr * .2, -w.ang, tr * 1.7, tr * .2, tr * .2, bc);
    else for (const k of [-.3, .3]) turretM.barrel.add(x - sa * tr * k, y + ca * tr * k, h + tr * .18, -w.ang, tr * 2, tr * .26, tr * .26, bc); // twin barrels
  }
}

// ---------------------------------------------------------------- structures: stations, dockyards, outposts, platforms
function structMats(team, dead) { return structMatsC('st:' + team + ':' + (dead ? 1 : 0), S.teamc[team] || S.teamc[0], dead); }
function structMatsC(k, C, dead) {
  if (MAT[k]) return MAT[k];
  const col = dead ? 0x555555 : hex(C.main);
  return MAT[k] = {
    hull: new THREE.MeshStandardMaterial({ color: 0x4a4a54, metalness: .6, roughness: .45, flatShading: true }),
    armour: new THREE.MeshStandardMaterial({ color: 0x5c5c66, metalness: .5, roughness: .55, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e1e24, metalness: .5, roughness: .6, flatShading: true }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2c2c32, metalness: .75, roughness: .35 }),
    win: new THREE.MeshStandardMaterial({ color: dead ? 0x2a2a2a : 0xffd9a0, emissive: dead ? 0x000000 : 0xffd9a0, emissiveIntensity: dead ? 0 : 1.1 }),
    trim: new THREE.MeshStandardMaterial({ color: col, metalness: .3, roughness: .4, emissive: col, emissiveIntensity: dead ? 0 : .28 }),
    glow: new THREE.MeshStandardMaterial({ color: dead ? 0x333333 : 0x7ff3ff, emissive: dead ? 0x000000 : 0x7ff3ff, emissiveIntensity: dead ? 0 : .8 }),
    shield: new THREE.MeshStandardMaterial({ color: dead ? 0x333333 : 0x8fd3ff, emissive: dead ? 0x000000 : 0x8fd3ff, emissiveIntensity: dead ? 0 : .55, transparent: true, opacity: .85 }),
    lt: new THREE.MeshStandardMaterial({ color: hex(C.light), emissive: hex(C.light), emissiveIntensity: dead ? 0 : 1.6 }),
  };
}
function buildStruct(s) {
  const M = structMats(s.team, s.derelict), g = new THREE.Group(), add = (geo, mat, x = 0, y = 0, zz = 0, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, zz); m.rotation.y = ry; g.add(m); return m; };
  const blink = [];
  if (s.type === 'station' || s.type === 'outpost' || s.type === 'gunplat' || s.type === 'shieldplat') { // built in hulls.js; the Shield Station's sphere stays here
    for (const [slot, geo] of buildStation(s.type)) { const m = add(geo, M[slot] || M.hull); if (slot === 'lt') blink.push(m); }
    if (s.type === 'shieldplat') blink.push(add(new THREE.SphereGeometry(.35, 24, 16), M.shield, 0, .35));
  } else if (s.type === 'dockyard') { // a construction slip with a hull on the stocks; Venus and Ganymede can lay down moonBreakers
    const type = s.world === 'venus' || s.world === 'ganymede' ? 'moonbreaker' : 'dread', Y = buildSlip(M, t => shipMats3(t, s.team).n, type, facKey(s.team) || 'none', (s.id * 7919) >>> 0);
    g.add(Y.g); g.userData.upd = Y.update;
  } else { add(new THREE.CylinderGeometry(.6, .6, .2, 12), M.dark); }
  shipsG.add(g); return { g, blink, team: s.team, dead: s.derelict, top: s.type === 'station' ? .12 : s.type === 'dockyard' ? .07 : s.type === 'outpost' ? .13 : .12 };
}
function structure(s, z) {
  let v = structVis.get(s.id);
  if (!v || v.team !== s.team || v.dead !== s.derelict) { if (v) shipsG.remove(v.g); v = buildStruct(s); structVis.set(s.id, v); }
  const on = onScr(s.x, s.y, s.r * z * 2.5 + 30) && s.r * z > .8; v.g.visible = on; if (!on) return;
  if (v.g.userData.upd) v.g.userData.upd(S.time);
  v.g.position.set(s.x - O.x, 0, s.y - O.y); v.g.rotation.y = -s.a; v.g.scale.setScalar(s.r);
  if (!v.dead) v.blink.forEach((m, i) => { m.visible = s.type === 'shieldplat' || (S.time + i * .25) % 2 < 1.3; if (s.type === 'shieldplat') m.scale.setScalar(.92 + .08 * Math.sin(S.time * 3)); });
  turrets(s, z, v.top * s.r);
}

// ---------------------------------------------------------------- overlay: shields, shockwaves, nuke marks (additive)
function drawFxOverlay(z, px) {
  ctx.globalCompositeOperation = 'lighter'; G.ground();
  for (const s of S.ships) {
    if (s.dead || (!s.seen && s.team !== 0) || !s.def.shield || s.sh <= 0 || !onScr(s.x, s.y, s.r * z * 2)) continue;
    const R = Math.max(s.r * 1.25, s.def.static ? 0 : vrOf(s) * 1.5), f = s.sh / s.def.shield; // the bubble always clears the hull, whatever the Hull size
    if (s.def.static) { G.circle(s.x, s.y, R).stroke({ width: Math.max(px, 1.5), color: 0x8fd3ff, alpha: s.shFlash > 0 ? .5 : .05 + .08 * f }); continue; }
    if (s.sub && (s.braceT > S.time || S.selection.includes(s))) { // the two halves of the shield, port and starboard; a braced half burns bright
      for (const side of [-1, 1]) { const v = side > 0 ? s.shS : s.shP, cap = s.def.shield / 2, a0 = s.a + side * PI / 2, br = s.braceT > S.time && s.braceSide === side;
        if (v <= 0) continue; G.moveTo(s.x + Math.cos(a0 - 1.3) * R, s.y + Math.sin(a0 - 1.3) * R); G.arc(s.x, s.y, R * (br ? 1.06 : 1), a0 - 1.3, a0 + 1.3); G.stroke({ width: Math.max(px * (br ? 3 : 1.4), s.r * (br ? .07 : .025)), color: br ? 0xbfe8ff : 0x8fd3ff, alpha: (br ? .55 : .16) * Math.min(1, v / cap + .2) }); } }
    if (s.shFlash > 0) { const k = s.shFlash / .35; G.moveTo(s.x + Math.cos(s.shA - .7) * R, s.y + Math.sin(s.shA - .7) * R); G.arc(s.x, s.y, R, s.shA - .7, s.shA + .7); G.stroke({ width: Math.max(2 * px, s.r * .08), color: 0x8fd3ff, alpha: .8 * k }); G.circle(s.x, s.y, R).stroke({ width: Math.max(px, s.r * .03), color: 0x8fd3ff, alpha: .18 * k }); }
    else if (S.selection.includes(s) || S.time - (s.shHit ?? -99) < 2.5) G.circle(s.x, s.y, R).stroke({ width: Math.max(px, 1), color: 0x8fd3ff, alpha: .05 + .1 * f }); // quiet unless selected or just hit
  }
  // a bow lance building its charge: a glowing line down the bore, brighter as it fills; both sides can see it
  for (const s of S.ships) {
    if (s.dead) continue;
    for (const w of s.weapons) {
      if (!w.chg || !w.def.bow) continue; const k = clamp((S.time - (w.chg0 ?? S.time)) / Math.max(.1, w.chg - (w.chg0 ?? S.time)), 0, 1), a = s.a + w.dir, L = w.def.range;
      if (!onScr(w.mx + Math.cos(a) * L * .5, w.my + Math.sin(a) * L * .5, L * z * .6 + 60)) continue;
      const ex = w.mx + Math.cos(a) * L, ey = w.my + Math.sin(a) * L, col = w.def.col || 0xff6a3d, flick = .85 + .15 * Math.sin(S.time * 40);
      G.moveTo(w.mx, w.my).lineTo(ex, ey).stroke({ width: Math.max(1.5 * px, (w.def.huge ? 9 : 5) * (.4 + k)), color: col, alpha: (.08 + .22 * k) * flick });
      G.moveTo(w.mx, w.my).lineTo(w.mx + (ex - w.mx) * (.25 + .75 * k), w.my + (ey - w.my) * (.25 + .75 * k)).stroke({ width: Math.max(px, 1.6 * (.5 + k)), color: 0xffe6cc, alpha: .25 + .5 * k });
    }
  }
  for (const m of S.missiles) if (m.nuke && onScr(m.x, m.y, 200)) { G.circle(m.x, m.y, 14 * px).stroke({ width: 1.5 * px, color: 0xff5040, alpha: .6 }); if (m.tp) { G.dashed(m.tp.x, m.tp.y, 650, 30, 30); G.stroke({ width: 1.5 * px, color: 0xff5040, alpha: .5 }); } }
  ctx.globalCompositeOperation = 'source-over';
}

// class glyphs in units of the icon size, nose along +x
const GLYPH = {
  ripwing: [[1, 0, -.8, -.7, -.4, 0, -.8, .7]], starshell: [[.6, 0, 0, .6, -.6, 0, 0, -.6]], boarder: [[1, 0, -.7, -.7, -.7, .7]],
  hauler: [[.8, -.6, .8, .6, -.8, .6, -.8, -.6]], tender: [[.9, -.25, .9, .25, -.9, .25, -.9, -.25], [.25, -.9, .25, .9, -.25, .9, -.25, -.9]],
  scout: [[1.1, 0, 0, .5, -1, 0, 0, -.5]], corvette: [[1, 0, -.8, -.6, -.5, 0, -.8, .6]], corsair: [[1, 0, -.6, -.75, -.3, 0, -.6, .75]],
  frigate: [[1.1, 0, -.9, -.8, -.5, 0, -.9, .8]], raider: [[1.4, 0, -.8, -.5, -.5, 0, -.8, .5]],
  destroyer: [[1.3, 0, .2, .55, -1, .35, -1, -.35, .2, -.55]], torch: [[1.2, -.3, 1.2, .3, -1.1, .4, -1.1, -.4], [.2, -.75, .5, -.75, .5, .75, .2, .75]],
  dread: [[1.1, -.45, 1.1, .45, -1.1, .55, -1.1, -.55], [1.1, -.45, 1.5, -.75, 1.2, -.1, 1.5, 0, 1.2, .1, 1.5, .75, 1.1, .45]],
  moonbreaker: [[1, -.6, 1, .6, -1.1, .7, -1.1, -.7], [1, -.6, 1.5, -.95, 1.2, -.2, 1.6, 0, 1.2, .2, 1.5, .95, 1, .6], [-.4, -1, -.1, -1, -.1, 1, -.4, 1]] };
const GLYPH_CACHE = {};
const glyphOf = (type, fac) => { const k = type + ':' + fac; if (GLYPH_CACHE[k]) return GLYPH_CACHE[k]; const G0 = GLYPH[type] || GLYPH.frigate;
  const m = fac === 'core' ? [1.15, .85] : fac === 'rim' ? [1.08, .78] : fac === 'rising' ? [.94, 1.12] : [1, 1];
  return GLYPH_CACHE[k] = G0.map(P => P.map((v, i) => v * m[i % 2])); };
const HC = f => f > .5 ? 0x3ddc84 : f > .25 ? 0xff9a3c : 0xff4b3e; // health: green, amber, red, never a faction colour
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
function drawOverlay(z, px, icons) {
  const g = G, sel = S.selection, pulse = .5 + .5 * Math.sin(S.time * 7);
  // fields: a faint wash where the rocks are
  g.ground(); for (const f of S.fields) if (!f.hulk && z > 2e-4 && onScr(f.x, f.y, f.r * z + 40)) g.circle(f.x, f.y, f.r).fill({ color: 0x8a7a68, alpha: .03 });
  // worlds stay findable at any zoom: a marker, an owner ring, a name, an owner bar and status marks; biggest first
  const order = BODIES.slice().sort((a, b) => (a.kind === 'moon') - (b.kind === 'moon') || b.r - a.r);
  // at whole-system zoom the inner worlds crowd onto the Sun: they share one badge instead of six names
  projectTo(Q, BODIES[0].x, BODIES[0].y); const sunX = Q.x, sunY = Q.y; let crowd = 0;
  const near = (X, Y) => hyp(X - sunX, Y - sunY) < 42;
  for (const b of BODIES) if (b.kind !== 'star') { projectTo(Q, b.x, b.y); if (near(Q.x, Q.y)) crowd++; }
  const clustered = crowd >= 3;
  for (const b of order) {
    projectTo(Q, b.x, b.y); if (!Q.ok) continue; const X = Q.x, Y = Q.y, rs = b.r * Q.k;
    if (clustered && b.kind !== 'star' && near(X, Y)) { const w0 = S.worlds && S.worlds[b.id]; if (w0 && worldUnderAttack(b.id)) { g.screen(); g.circle(X, Y, 6).stroke({ width: 1.5, color: 0xff4b3e, alpha: .5 + .5 * pulse }); } continue; }
    if (X < -rs - 60 || Y < -rs - 60 || X > S.W + rs + 60 || Y > S.H + rs + 60) continue;
    g.screen();
    const minPx = b.kind === 'moon' ? 3.5 : b.kind === 'star' ? 0 : 5.5, rr = Math.max(rs, minPx);
    if (rs < minPx) g.circle(X, Y, rr).fill({ color: hex(b.pal ? b.pal.c[1] : '#888888') });
    const w = S.worlds && S.worlds[b.id], own = w ? w.owner : -1, oc = own >= 0 ? hex(S.teamc[own].main) : own === -2 ? hex(S.teamc[2].main) : 0x5a5650;
    if (w) g.circle(X, Y, Math.max(rs * 1.1, rr + 3)).stroke({ width: S.worldSel === b.id ? 2.5 : 1.5, color: oc, alpha: rs > 200 ? .35 : .85 });
    const att = w && worldUnderAttack(b.id);
    if (att) { g.dashed(X, Y, Math.max(rs * 1.2, rr + 8), 14, 10); g.stroke({ width: 2, color: 0xff4b3e, alpha: .4 + .5 * pulse }); }
    if (b.kind === 'moon' && z < .0025 && S.worldSel !== b.id && !(w && (w.owner === 0 || att))) continue; // your own moons and moons under attack keep their names
    const marks = w ? (att ? ' ⚔' : '') + (S.ships.some(s => s.world === b.id && s.def.producer && !s.dead && s.team === own && own >= 0) ? ' ⚒' : '') + ((S.halt && S.halt[b.id] > S.time) || (own >= 0 && S.food && S.food[own] < 0) ? ' ⚠' : '') : '';
    let ly = b.kind === 'star' ? Y - Math.max(rs * 1.05, 52) : Y + Math.max(rs * 1.1, rr + 3) + 6;
    if (ly > S.H - 30 && Y < S.H) ly = Math.max(Y + 20, S.H - 120); // a world bigger than the screen keeps its name in view
    if (!label(b.kind === 'star' && clustered ? 'THE INNER SYSTEM' : b.name.toUpperCase() + marks, X, ly, b.kind === 'star' ? 0xffe0a0 : 0xefe6d2, true, 'skip')) continue;
    if (w) g.rect(X - 14, ly + 15, 28, 3).fill({ color: own >= 0 || own === -2 ? oc : 0x4a4640 });
  }
  if (S.worldSel && S.worlds && S.worlds[S.worldSel] && S.worlds[S.worldSel].gov && !S.worlds[S.worldSel].gov.dead) { // the selected world's orbital authority, bracketed and named
    const gv = S.worlds[S.worldSel].gov; projectTo(Q, gv.x, gv.y);
    if (Q.ok) { g.screen(); const r = Math.max(gv.r * Q.k * 1.3, 12), c = r * .45, x = Q.x, y = Q.y; for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.moveTo(x + sx * r, y + sy * (r - c)).lineTo(x + sx * r, y + sy * r).lineTo(x + sx * (r - c), y + sy * r); g.stroke({ width: 1.5, color: 0xe8c87e, alpha: .9 });
      label(gv.def.name.toUpperCase() + ' · ORBITAL AUTHORITY', x, y + r + 4, 0xefe6d2, false, true); }
  }
  g.ground();
  const st0 = S.stations[0];
  if (st0 && !st0.dead && (sel.some(s => !s.def.static && needsService(s)) || sel.includes(st0))) { g.dashed(st0.x, st0.y, 1000, 50, 40); g.stroke({ width: 1.5 * px, color: 0x7ff3ff, alpha: .2 }); }
  for (const n of S.nodes) { if (n.amount <= 0 || !onScr(n.x, n.y, n.r * z + 40)) continue; const f = n.amount / n.max; g.moveTo(n.x, n.y - n.r - 20); g.arc(n.x, n.y, n.r + 20, -PI / 2, -PI / 2 + TAU * f); g.stroke({ width: 3 * px, color: n.kind === 'ore' ? 0xe0995a : 0x7ff3ff, alpha: .5 }); }
  if (S.showVec && sel.length && sel.length <= 30) {
    for (const s of sel) {
      if (s.def.static) continue; let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
      for (let i = 0; i < 60; i++) { const gv = grav(x, y); vx += gv.x * .1; vy += gv.y * .1; const nx = x + vx * .1, ny = y + vy * .1; if (i % 2 === 0) g.moveTo(x, y).lineTo(nx, ny); x = nx; y = ny; }
      g.stroke({ width: 1.3 * px, color: 0xff8a6e, alpha: .45 });
      g.moveTo(s.x, s.y).lineTo(s.x + s.vx, s.y + s.vy).stroke({ width: 1.3 * px, color: 0x7ff3ff, alpha: .8 });
    }
  }
  const agg = new Map(), many = sel.length > 6; // big selections: one line per destination, not one per ship
  for (const s of sel) {
    const o = s.order; let tx = null, ty = null, col = 0x3ddc84, al = .35;
    if (o.type === 'move' || o.type === 'amove') { tx = o.x; ty = o.y; if (o.type === 'amove') col = 0xff4b3e; }
    else if ((o.type === 'attack' || o.type === 'board') && o.t) { tx = o.t.x; ty = o.t.y; col = 0xff4b3e; al = .45; }
    else if ((o.type === 'follow' || o.type === 'guard' || o.type === 'dock') && o.t) { tx = o.t.x; ty = o.t.y; al = .25; }
    else if (o.type === 'mine' && o.node) { tx = o.node.x; ty = o.node.y; col = 0x7ff3ff; al = .25; }
    else if (o.type === 'rearm' && st0) { tx = st0.x; ty = st0.y; col = 0x7ff3ff; }
    if (s.def.static) { if (!s.def.producer) continue; const rp = s.rally || defaultRally(s); tx = rp.x; ty = rp.y; col = 0x7ff3ff; al = .4; }
    if (tx != null && many && !s.def.static) { const kk = Math.round(tx / 3000) + ':' + Math.round(ty / 3000) + ':' + col; const a = agg.get(kk) || { n: 0, x: 0, y: 0, tx: 0, ty: 0, col, al }; a.n++; a.x += s.x; a.y += s.y; a.tx += tx; a.ty += ty; agg.set(kk, a); }
    else if (tx != null) { g.ground().moveTo(s.x, s.y).lineTo(tx, ty).stroke({ width: px, color: col, alpha: al }); g.flat(tx, ty); g.screen(); const [qx, qy] = [g.sx, g.sy]; g.rect(qx - 3, qy - 3, 6, 6).fill({ color: col, alpha: al }); g.ground(); }
  }
  for (const s of sel) { // queued waypoints, and orders still on their way to the ship
    if (s.def.static || s.team !== 0) continue; let o = s.order, px0 = o.x, py0 = o.y, n = 0;
    while (o && o.next && n++ < 8) { const q = o.next; const qx = q.t ? q.t.x : q.x, qy = q.t ? q.t.y : q.y; if (px0 != null && qx != null) { g.ground().moveTo(px0, py0).lineTo(qx, qy).stroke({ width: px, color: q.type === 'amove' || q.type === 'attack' ? 0xff4b3e : 0x3ddc84, alpha: .3 }); g.flat(qx, qy); g.screen(); g.rect(g.sx - 2.5, g.sy - 2.5, 5, 5).stroke({ width: 1, color: 0x3ddc84, alpha: .6 }); g.ground(); } o = q; px0 = qx; py0 = qy; }
    if (s.order.face != null && s.order.x != null) { const fx = s.order.x + Math.cos(s.order.face) * (s.r + 140), fy = s.order.y + Math.sin(s.order.face) * (s.r + 140); g.ground().moveTo(s.order.x, s.order.y).lineTo(fx, fy).stroke({ width: 1.4 * px, color: 0x3ddc84, alpha: .45 }); }
    if (s.pend) { const q = s.pend.order, qx = q.t ? q.t.x : q.x, qy = q.t ? q.t.y : q.y; if (qx != null) { g.ground().moveTo(s.x, s.y).lineTo(qx, qy).stroke({ width: px, color: 0xe8c87e, alpha: .18 + .22 * pulse }); } }
  }
  if (S.rdrag) { const R = S.rdrag, a = Math.atan2(R.y1 - R.y0, R.x1 - R.x0), L = Math.max(hyp(R.x1 - R.x0, R.y1 - R.y0), 60 * px), ex = R.x0 + Math.cos(a) * L, ey = R.y0 + Math.sin(a) * L, h = 14 * px;
    g.ground().moveTo(R.x0, R.y0).lineTo(ex, ey).stroke({ width: 2 * px, color: 0x3ddc84, alpha: .85 });
    g.moveTo(ex + Math.cos(a + 2.6) * h, ey + Math.sin(a + 2.6) * h).lineTo(ex, ey).lineTo(ex + Math.cos(a - 2.6) * h, ey + Math.sin(a - 2.6) * h).stroke({ width: 2 * px, color: 0x3ddc84, alpha: .85 });
    projectTo(Q, ex, ey); if (Q.ok) label('FACE ON ARRIVAL', Q.x, Q.y - 18, 0x9be8a8, false, true); }
  for (const a of agg.values()) { // one line from the formation's centre to its destination, and a diamond there
    const x0 = a.x / a.n, y0 = a.y / a.n, x1 = a.tx / a.n, y1 = a.ty / a.n; g.ground().moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.5 * px, color: a.col, alpha: .45 });
    g.flat(x1, y1); g.screen(); const qx = g.sx, qy = g.sy; g.poly([qx, qy - 7, qx + 7, qy, qx, qy + 7, qx - 7, qy]).stroke({ width: 1.5, color: a.col, alpha: .8 }); g.ground();
  }
  for (const s of S.ships) if (s.type === 'tender' && s.team === 0 && (sel.includes(s) || s.resupplying)) { g.dashed(s.x, s.y, 520, 30, 40); g.stroke({ width: px, color: 0x7ff3ff, alpha: s.resupplying ? .3 : .15 }); }
  for (const s of S.ships) if (s.type === 'shieldplat' && !s.dead && !s.derelict && (s.team === 0 || sel.includes(s) || S.inspect === s) && onScr(s.x, s.y, s.def.aura * z + 40)) { g.dashed(s.x, s.y, s.def.aura, 40, 40); g.stroke({ width: px * 1.2, color: 0x8fd3ff, alpha: .22 }); }
  // icons for ships too small to see
  g.screen();
  // fighters and starShells that crowd together on screen share one wing icon with a count; a click on it takes the wing
  WINGS.length = 0; WF++; const cells = new Map(), draw = [];
  for (const s of icons) {
    if (!(s.def.fighter || s.def.shell) || s._ia < 1) { draw.push(s); continue; }
    projectTo(Q, s.x, s.y); if (!Q.ok) continue;
    const key = s.team + ':' + s.type, list = cells.get(key) || []; cells.set(key, list); // join the nearest wing within 24 px, or start one
    let c = null; for (const o of list) if (hyp(o.x - Q.x, o.y - Q.y) < 24) { c = o; break; }
    if (!c) { c = { team: s.team, type: s.type, x: Q.x, y: Q.y, sx: 0, sy: 0, members: [] }; list.push(c); }
    c.members.push(s); c.sx += Q.x; c.sy += Q.y; c.x = c.sx / c.members.length; c.y = c.sy / c.members.length;
  }
  for (const list of cells.values()) for (const c of list) { if (c.members.length < 3) { draw.push(...c.members); continue; } WINGS.push(c); for (const m of c.members) m._wing = WF; } // a wing's members skip their own bars
  const glyph = (s, X, Y, sz, alpha) => {
    const a = screenAng(s.a), ca = Math.cos(a), sa = Math.sin(a);
    const col = disabled(s) ? 0x777777 : hex(S.teamc[s.team].main), polys = glyphOf(s.type, facKey(s.team));
    for (const P of polys) { const arr = []; for (let i = 0; i < P.length; i += 2) arr.push(X + (ca * P[i] - sa * P[i + 1]) * sz, Y + (sa * P[i] + ca * P[i + 1]) * sz); g.poly(arr).fill({ color: col, alpha }).stroke(s.team !== 0 && s.team < 2 ? { width: 1.6, color: 0xf6f1e6, alpha: .9 * alpha } : { width: 1, color: 0x000000, alpha: .85 * alpha }); }
  };
  const isz = s => (ICON_SCALE[s.type] || 4) * 1.15 * (S.mode === 'battle' ? 1.25 : 1);
  for (const s of draw) { // a glyph for each class of hull, the same size on screen at any zoom, with a health pip
    projectTo(Q, s.x, s.y); if (!Q.ok) continue; const sz = isz(s), al = s._ia ?? 1;
    glyph(s, Q.x, Q.y, sz, al);
    if (al > .5 && (s.def.cmd || s.def.capture)) { const f = clamp(s.hp / s.def.hp, 0, 1); if (f < .98 || S.selection.includes(s)) { const w = Math.max(10, sz * 2.4); g.rect(Q.x - w / 2, Q.y + sz * 1.3 + 2, w, 2.5).fill({ color: 0x000000, alpha: .7 }); g.rect(Q.x - w / 2, Q.y + sz * 1.3 + 2, w * f, 2.5).fill({ color: HC(f) }); } }
    if (S.selection.includes(s)) g.circle(Q.x, Q.y, sz * 1.7 + 2).stroke({ width: 1.2, color: 0x3ddc84, alpha: .8 * al });
  }
  for (const c of WINGS) { // the wing: one glyph a size up, two ghosts behind it, and the count
    const lead = c.members[0], sz = isz(lead) * 1.25, sel = c.members.filter(m => S.selection.includes(m)).length;
    glyph(lead, c.x - 4, c.y + 3, sz * .8, .35); glyph(lead, c.x + 4, c.y + 3, sz * .8, .35); glyph(lead, c.x, c.y, sz, 1);
    label('×' + c.members.length, c.x + sz * 1.6 + 6, c.y - 7, sel ? 0x3ddc84 : 0xefe6d2, false, 'skip');
    if (sel) g.circle(c.x, c.y, sz * 1.8 + 3).stroke({ width: 1.2, color: 0x3ddc84, alpha: .8 });
  }
  if (z < .08) { // battles at a distance: a pulsing crossed-swords ring wherever ships took fire in the last three seconds
    const fights = new Map(), C2 = 60 / z;
    for (const s of S.ships) { if (s.dead || s.def.fighter || S.time - (s.lastHit ?? -99) > 3 || (s.team !== 0 && !s.seen)) continue; const k = Math.floor(s.x / C2) + ':' + Math.floor(s.y / C2); const f = fights.get(k) || { n: 0, x: 0, y: 0 }; f.n++; f.x += s.x; f.y += s.y; fights.set(k, f); }
    g.screen(); for (const f of fights.values()) { projectTo(Q, f.x / f.n, f.y / f.n); if (!Q.ok) continue; g.circle(Q.x, Q.y, 14 + 3 * pulse).stroke({ width: 2, color: 0xff4b3e, alpha: .4 + .5 * pulse }); label('⚔', Q.x, Q.y - 7, 0xff6a5a, false, 'skip'); }
  }
  const soup = sel.length > 4 && z < .15, minLab = !!(S.gx && S.gx.labels === 'min'); // minimal labels: names and states only on what is selected
  for (const s of S.ships) {
    if (s.dead || (!s.seen && s.team !== 0)) continue;
    if (!onScr(s.x, s.y, s.r * z + 40)) continue;
    const isSel = sel.includes(s); const dmg = s.hp < s.def.hp || s.sh < s.def.shield; const R = Math.max(s.r + 6, 9 * px);
    g.ground();
    const inForm = (soup && isSel && s.group && !s.detached && s !== s.group.flag) || s._wing === WF; // the group, or the wing, gets one ring, not thirteen
    if (isSel && !inForm) g.circle(s.x, s.y, R).stroke({ width: 1.5 * px, color: 0x3ddc84 });
    if (S.inspect === s) g.circle(s.x, s.y, R).stroke({ width: 1.5 * px, color: 0xff4b3e });
    if (S.hover === s && !isSel && s._wing !== WF) g.circle(s.x, s.y, R).stroke({ width: 1 * px, color: 0xefe6d2, alpha: .5 });
    g.flat(s.x, s.y, s.def.static ? 0 : s.r * .15); // bars ride on the hull's deck, not the plane beneath it
    // at fleet zoom, members of a selected group in formation share one bar over the flagship
    if (soup && isSel && s.group && !s.detached && s.hp > s.def.hp * .5 && !s.boardProg && !disabled(s)) {
      if (s === s.group.flag) { const m = s.group.members, hp = m.reduce((a, o) => a + o.hp, 0) / m.reduce((a, o) => a + o.def.hp, 0), shm = m.reduce((a, o) => a + o.def.shield, 0), sh = shm ? m.reduce((a, o) => a + o.sh, 0) / shm : 0, w = 64 * px, h = 4 * px, y = s.y - Math.max(s.r + 16, 20 * px);
        g.rect(s.x - w / 2, y, w, h).fill({ color: 0x000000, alpha: .6 }); g.rect(s.x - w / 2, y, w * hp, h).fill({ color: HC(hp) });
        if (shm) { g.rect(s.x - w / 2, y - h * 1.5, w, h * .8).fill({ color: 0x000000, alpha: .6 }); g.rect(s.x - w / 2, y - h * 1.5, w * sh, h * .8).fill({ color: 0x8fd3ff }); } }
      continue;
    }
    if ((isSel || (!(S.gx && S.gx.bars === 'sel') && (dmg || disabled(s))) || s.boardProg > 0) && (s.r * z > 4 || isSel) && (isSel || !(s.def.fighter || s.def.shell)) && s._wing !== WF) {
      const w = clamp(s.r * 2, 26 * px, 90 * px), h = 3.5 * px; const top = s.y - Math.max(s.r + 12, 14 * px); let y = top;
      g.rect(s.x - w / 2, y, w, h).fill({ color: 0x000000, alpha: .6 }); const f = clamp(s.hp / s.def.hp, 0, 1); g.rect(s.x - w / 2, y, w * f, h).fill({ color: HC(f) });
      if (s.team !== 0 || s.ally) g.rect(s.x - w / 2 - px, y - px, w + 2 * px, h + 2 * px).stroke({ width: px, color: s.ally ? 0x9be8d8 : hex(S.teamc[s.team].light), alpha: .7 }); // a foe's bars are framed in its colours, an ally's in pale green
      if (s.def.shield) { y -= h * 1.5; g.rect(s.x - w / 2, y, w, h * .8).fill({ color: 0x000000, alpha: .6 }); g.rect(s.x - w / 2, y, w * clamp(s.sh / s.def.shield, 0, 1), h * .8).fill({ color: S.time - s.shDown < 8 && s.sh < s.def.shield * .05 ? 0xff4b3e : 0x8fd3ff }); }
      if (s.boardProg > 0) { y -= h * 1.5; g.rect(s.x - w / 2, y, w * s.boardProg, h).fill({ color: hex(S.teamc[s.boardTeam].main) }); }
      if (s.team === 0 && s.weapons.length && !s.def.static && (isSel || mainAmmo(s) < .25)) { const a = mainAmmo(s); g.rect(s.x - w / 2, top + h * 1.3, w, h * .7).fill({ color: 0x000000, alpha: .6 }); g.rect(s.x - w / 2, top + h * 1.3, w * a, h * .7).fill({ color: a < .25 ? 0xff9a3c : 0xcfd8e0 }); }
      if (s.type === 'hauler' && s.team === 0 && s.cargo > 0) g.rect(s.x - w / 2, top + h * 1.3, w * s.cargo / s.def.cargo, h * .7).fill({ color: s.cargoKind === 'he' || !s.cargoKind ? 0x7ff3ff : 0xe0995a });
      if (s.rank && !s.def.fighter) for (let i = 0; i < s.rank; i++) { const cx = s.x + w / 2 + 6 * px + i * 6 * px, cy = top + h / 2; g.poly([cx - 2.5 * px, cy + 2 * px, cx, cy - 2.5 * px, cx + 2.5 * px, cy + 2 * px]).fill({ color: 0xf2c14e }); }
      if (disabled(s) && (s.surrendered || s.derelict ? s.r * z > 3 : isSel || s.def.cmd || s.r * z > 14) && !(s.def.static && s.team === 2)) label(s.surrendered ? 'STRUCK COLORS' : s.derelict ? (s.team === 2 ? 'HULK' : 'DERELICT') : 'EMP ' + s.emp.toFixed(0) + 's', ...fp(s.x, s.y + s.r + 8 * px), s.surrendered ? 0xffffff : s.derelict ? 0xc0c4c8 : 0x8fd3ff);
    }
    if (!s.surrendered && !disabled(s) && (s.broken || s.waver > S.time) && (isSel || !minLab && (s.broken ? s.r * z > 2.5 || s.def.cmd : s.r * z > 6))) label(s.broken ? (s.orderly ? 'WITHDRAWING' : 'BROKEN · RUNNING') : 'WAVERING', ...fp(s.x, s.y + s.r + 8 * px), s.broken ? (s.team === 0 ? 0xff8a7a : 0xffd27a) : 0xe8c87e, false, true);
    if (s.cmdr && (isSel || !minLab && s.r * z > 14 && (S.mode !== 'battle' || s.hp < s.def.hp * .6 || S.time - (s.lastHit ?? -99) < 4) || S.inspect === s)) label('★ ' + s.cmdr.name, ...fp(s.x, s.y - Math.max(s.r + 12, 14 * px) - (s.def.shield ? 40 : 30) * px), s.team === 0 ? 0xf2c14e : hex(S.teamc[s.team].light));
    if (s.team === 2 && s.def.static && (isSel || S.inspect === s || s.r * z > 12)) label((s.derelict ? 'ABANDONED ' : 'NEUTRAL ') + s.def.name.toUpperCase(), ...fp(s.x, s.y + s.r + 8 * px), 0xc0c4c8);
    if (s.h && (isSel || s.r * z > 20) && s.team === 0 && (s.h.ripwing || s.h.starshell || s.h.boarder)) label([s.h.ripwing ? `${s.h.ripwing} ripWing${s.h.ripwing === 1 ? '' : 's'}` : '', s.h.starshell ? `${s.h.starshell} starShells` : '', s.h.boarder ? `${s.h.boarder} pod${s.h.boarder === 1 ? '' : 's'}` : '', s.hmode === 'hold' ? 'holding' : ''].filter(Boolean).join(' · '), ...fp(s.x, s.y + s.r + 8 * px + (disabled(s) ? 14 * px : 0)), 0xcfd8e0);
  }
  g.ground(); for (const h of S.hulks || []) { if (h.dead || h.r * z < 5 || !onScr(h.x, h.y, 60)) continue; const hs = S.selection.some(s => s.type === 'hauler'); // a hulk: cover for the fight, salvage after it
    label((h.title ? 'WRECK OF THE ' + h.title : h.def.name + ' WRECK').toUpperCase() + (hs ? ' · SALVAGE ' + Math.round(h.salvage) : ''), ...fp(h.x, h.y + h.r + 8 * px), 0xa8a29a, false, 'skip'); }
  // battle groups: a flag over each flagship, ghost slots and tethers for the selected group
  for (const gr of groupList()) {
    const f = gr.flag; if (!f || f.dead || f.offField) continue;
    const isSel = gr.members.some(m => sel.includes(m));
    if (z >= .008 && onScr(f.x, f.y, 80)) { g.flat(f.x, f.y); label('⚑ ' + (ROMAN[gr.n - 1] || gr.n) + ' ' + gr.name.toUpperCase(), ...fp(f.x, f.y + Math.max(f.r + 10, 12 * px) + (f.h ? 16 * px : 0)), isSel ? 0x3ddc84 : 0xc8b890, false, true); }
    if (!isSel) continue;
    g.ground(); const ca = Math.cos(gr.hdg), sa = Math.sin(gr.hdg);
    g.moveTo(f.x, f.y).lineTo(f.x + ca * (f.r + 160), f.y + sa * (f.r + 160)).stroke({ width: 1.5 * px, color: 0x3ddc84, alpha: .45 });
    // slots are small chevrons pointing along the heading, shown only while a ship is still moving into its place
    for (const m of gr.members) {
      if (m === f || !m.slot || m.detached || m.dead) continue;
      const tx = f.x + ca * m.slot.x - sa * m.slot.y, ty = f.y + sa * m.slot.x + ca * m.slot.y, d = hyp(tx - m.x, ty - m.y);
      if (d < m.r) continue;
      const k = 8 * px; g.moveTo(tx - ca * k - sa * k * .8, ty - sa * k + ca * k * .8).lineTo(tx, ty).lineTo(tx - ca * k + sa * k * .8, ty - sa * k - ca * k * .8).stroke({ width: 1.2 * px, color: 0x3ddc84, alpha: .3 });
      if (d > m.r + 40 && z <= .3) g.moveTo(m.x, m.y).lineTo(tx, ty).stroke({ width: px, color: 0x3ddc84, alpha: .12 });
    }
    if (soup) { // the whole group under one dashed ring, the flagship ringed solid
      let cx = 0, cy = 0, n = 0; for (const m of gr.members) if (!m.dead && !m.detached) { cx += m.x; cy += m.y; n++; }
      if (n > 1) { cx /= n; cy /= n; let R = 0; for (const m of gr.members) if (!m.dead && !m.detached) R = Math.max(R, hyp(m.x - cx, m.y - cy) + m.r); g.dashed(cx, cy, R + 14 * px, 18 * px, 12 * px); g.stroke({ width: 1.5 * px, color: 0x3ddc84, alpha: .5 }); }
    }
  }
  // system zoom: fleets become tokens with a count and a strength readout
  if (z < .008) {
    const cells = new Map(), C = 48 / z;
    for (const s of S.ships) {
      if (s.dead || s.def.static || !s.def.capture || s.team > 1 || (s.team === 1 && !s.seen) || s.docked) continue;
      const key = s.team === 0 && s.group && !s.detached ? 'g' + s.group.n : s.team + ':' + Math.floor(s.x / C) + ':' + Math.floor(s.y / C);
      let c = cells.get(key); if (!c) cells.set(key, c = { team: s.team, g: s.team === 0 && s.group && !s.detached ? s.group : null, n: 0, x: 0, y: 0, hp: 0, mhp: 0, val: 0, hit: false });
      c.n++; c.x += s.x; c.y += s.y; c.hp += s.hp; c.mhp += s.def.hp; c.val += s.def.value || 0; if (S.time - s.lastHit < 3) c.hit = true;
    }
    g.screen(); let stack = 0;
    for (const c of cells.values()) {
      let wx = c.x / c.n, wy = c.y / c.n; if (c.g && c.g.flag && !c.g.flag.dead) { wx = c.g.flag.x; wy = c.g.flag.y; }
      projectTo(Q, wx, wy); if (!Q.ok || Q.x < -40 || Q.y < -40 || Q.x > S.W + 40 || Q.y > S.H + 40) continue; let x = Q.x, y = Q.y;
      if (clustered && near(x, y)) { // tokens in the crowded inner system stack beside it, with a leader line to where they are
        const tx = x, ty = y; x = sunX + 96; y = sunY - 40 + stack++ * 36; g.moveTo(tx, ty).lineTo(x - 14, y).stroke({ width: 1, color: hex(S.teamc[c.team].main), alpha: .45 });
      } else for (const b of BODIES) { projectTo(Q, b.x, b.y); const dx = x - Q.x, dy = y - Q.y, rs = b.r * Q.k; if (Math.abs(dx) < 46 && dy > -20 && dy < 34) { y = Q.y - Math.max(rs * 1.1, 8) - 30; x = Q.x + (c.team === 0 ? -16 : 16); c.lift = true; break; } }
      const col = hex(S.teamc[c.team].main), w = 13, gsel = c.team === 0 && c.g && c.g.members.some(m => S.selection.includes(m));
      if (c.team === 0) g.poly([x - w, y - w * .7, x, y - w * .1, x + w, y - w * .7, x + w, y + w * .25, x, y + w * .85, x - w, y + w * .25]).fill({ color: col, alpha: .9 }).stroke({ width: gsel ? 2.2 : 1.2, color: c.hit ? 0xff4b3e : gsel ? 0x3ddc84 : 0x000000 });
      else g.poly([x, y - w, x + w, y, x, y + w, x - w, y]).fill({ color: col, alpha: .85 }).stroke({ width: 1.2, color: c.hit ? 0xffffff : 0x000000 });
      const f = c.hp / c.mhp; g.rect(x - w, y + w * 1.2, w * 2, 3).fill({ color: 0x000000, alpha: .7 }); g.rect(x - w, y + w * 1.2, w * 2 * f, 3).fill({ color: HC(f) });
      const v = c.val >= 1000 ? (c.val / 1000).toFixed(1) + 'k' : c.val;
      label(c.team === 0 ? (c.g ? (ROMAN[c.g.n - 1] || c.g.n) + ' ' + c.g.name.toUpperCase() + ' · ' : '') + c.n + ' ships' : c.n + ' hostile · ≈' + v, x, c.lift ? y - w * 1.1 - 16 : y + w * 1.2 + 6, c.team === 0 ? 0xefe6d2 : 0xffb6ad, false, 'skip');
    }
  }
  g.ground();
  if (S.battleOverlay) { S.battleOverlay(g, label, z, px); g.ground(); }
  for (const m of S.markers) { const k = m.life / .7; g.circle(m.x, m.y, (1 - k) * 30 * px + 8 * px).stroke({ width: 2 * px, color: m.col, alpha: Math.max(0, k) }); }
  if (S.nmode) { const [wx, wy] = toWorld(S.mouse.x, S.mouse.y); g.circle(wx, wy, 650).fill({ color: 0xff3c28, alpha: .06 }); g.dashed(wx, wy, 650, 30, 25); g.stroke({ width: 2 * px, color: 0xff5040, alpha: .8 }); }
  if (S.tmode) for (const s of S.tmode.ships || []) if (!s.dead && s.h && s.h[S.tmode.kind === 'pods' ? 'boarder' : 'starshell'] > 0) { g.dashed(s.x, s.y, 15000, 900, 700); g.stroke({ width: 1.2 * px, color: 0xffb070, alpha: .35 }); } /* how far the carriers can send them */
}
// the Sun's glare: when the Sun is on or near the screen, a soft flare over the view and a few ghosts across the centre;
// a world between the camera and the Sun blocks it
// ---- comets: two long-period visitors on Keplerian ellipses round the Sun, timed off Jupiter's place in its orbit
// (the layout carries no clock; Jupiter's angle advances 2π in 11.86 years, so it is one). Each draws a nucleus, a coma
// that swells as it nears the Sun, a curved dust tail and a straight blue ion tail, both pointing away from the Sun.
const COMETS = [{ a: 8, e: .9, w: 1.1, M0: 3.78, P: 22.6, col: 0xfff0d8 }, { a: 20, e: .96, w: 3.9, M0: 5.63, P: 89.4, col: 0xf0f4ff }]; // both inbound at the campaign's start: 2.5 AU and 3.7 AU out
function cometPos(cm, tYears) { const M = (TAU * tYears / cm.P + cm.M0) % TAU; let E = M; for (let i = 0; i < 7; i++) E -= (E - cm.e * Math.sin(E) - M) / (1 - cm.e * Math.cos(E));
  const r = cm.a * (1 - cm.e * Math.cos(E)), nu = Math.atan2(Math.sqrt(1 - cm.e * cm.e) * Math.sin(E), Math.cos(E) - cm.e); return { x: r * Math.cos(nu + cm.w) * AU, y: r * Math.sin(nu + cm.w) * AU, d: r }; }
function comets(L, z) {
  const J = L.pos.jupiter, sp = L.pos.sun; if (!J) return; const t = ((Math.atan2(J.y - sp.y, J.x - sp.x) + TAU) % TAU) / TAU * 11.86;
  for (const cm of COMETS) { const c = cometPos(cm, t), x = sp.x + c.x, y = sp.y + c.y; if (!onScr(x, y, Math.max(AU * .6 * z, 60))) continue; // world coordinates: the batches subtract O themselves
    const near = clamp(1.6 / c.d, 0, 1), act = near * near, aw = Math.atan2(c.y, c.x), g = Math.max(AU * .012 * (.4 + act), 9 / z); // activity falls off with the square of the distance
    B.glow.add(x, y, 2, g, g, 0, cm.col, .55 + .4 * act, 2); B.sglow.add(x, y, 2, g * 4 * (.3 + act), g * 4 * (.3 + act), 0, cm.col, .22 * act + .05, 1.5); // nucleus and coma
    if (act > .02) { const Ld = AU * (.12 + .5 * act) * clamp(1.2 / c.d, .2, 1.5), Li = Ld * 1.7, fl = .9 + .1 * Math.sin(SH.time.value * 3.1 + cm.a);
      B.plume.add(x, y, 2, Ld, Ld * .22, aw + PI + .1, 0xffe8c0, .45 * act * fl, 1.3); B.plume.add(x, y, 2.01, Ld * .7, Ld * .3, aw + PI + .22, 0xffd8a8, .25 * act, 1.2); // the dust tail, lagging the orbit a little
      B.streak.add(x, y, 2.02, Li, Math.max(Ld * .03, 1.5 / z), aw + PI, 0x9fc8ff, .5 * act * fl, 1.6); } } // the ion tail, straight down the Sun's wind
}
// ---- 2D helpers the strategic overlay calls for things it knows and the renderer does not (fleets in transit, worlds under siege)
const FLK = c => '#' + c.toString(16).padStart(6, '0');
export function fleetGlow(ctx, x, y, tx, ty, col, k = 1) { // a torch: a hot dot with a short flickering tail pointing back along the track
  const dx = tx - x, dy = ty - y, L = Math.hypot(dx, dy) || 1, ux = -dx / L, uy = -dy / L, fl = .8 + .2 * Math.sin(performance.now() * .021 + x), len = 16 * fl * k;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const gr = ctx.createLinearGradient(x, y, x + ux * len, y + uy * len); gr.addColorStop(0, `rgba(255,230,190,${.75 * k})`); gr.addColorStop(.3, `rgba(255,170,90,${.35 * k})`); gr.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.strokeStyle = gr; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * len, y + uy * len); ctx.stroke();
  const rg = ctx.createRadialGradient(x, y, 0, x, y, 7); rg.addColorStop(0, `rgba(255,245,225,${.9 * k})`); rg.addColorStop(.35, `rgba(255,200,140,${.4 * k})`); rg.addColorStop(1, 'rgba(255,160,90,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
  ctx.restore();
}
export function clashFx(ctx, cx, cy, rr) { // hostile fleets sharing an orbit: a ring of brief flashes and streaks round the world, where the fighting is
  const now = performance.now() / 1000; ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) { const t = now * 2.2 + i * .53, ph = t % 1, sd = Math.floor(t) * 7.31 + i * 2.7, h = Math.abs(Math.sin(sd * 12.9898) * 43758.5453) % 1, h2 = Math.abs(Math.sin(sd * 78.233) * 12345.6789) % 1;
    const a = h * TAU, rad = rr + 7 + h2 * 9, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad, al = (1 - ph) * (1 - ph) * (ph < .06 ? ph / .06 : 1), r = 1.5 + 4 * (1 - ph);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,255,245,${.9 * al})`); g.addColorStop(.4, `rgba(255,210,150,${.4 * al})`); g.addColorStop(1, 'rgba(255,160,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
    if (h2 > .55) { ctx.strokeStyle = `rgba(200,230,255,${.45 * al})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a + 1.2) * 6, py + Math.sin(a + 1.2) * 6); ctx.stroke(); } } // a tracer
  ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(190,180,170,.22)'; ctx.lineWidth = 1; ctx.setLineDash([1, 4]); ctx.beginPath(); ctx.arc(cx, cy, rr + 12, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}
export function surfaceFx(ctx, cx, cy, rr, kind = 'rising') { // war on the ground, seen from orbit: tiny flashes over the disc and a smudge of smoke; a sacked world smoulders
  const now = performance.now() / 1000; ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rr - 1, 0, TAU); ctx.clip();
  const n = kind === 'sacked' ? 3 : 7; ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const t = now * (kind === 'sacked' ? .35 : 1.8) + i * .61, ph = t % 1, sd = Math.floor(t) * 5.17 + i * 1.9, h = Math.abs(Math.sin(sd * 12.9898) * 43758.5453) % 1, h2 = Math.abs(Math.sin(sd * 78.233) * 12345.6789) % 1;
    const a = h * TAU, rad = Math.sqrt(h2) * rr * .8, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad, al = kind === 'sacked' ? .35 * Math.sin(ph * PI) : (1 - ph) * (1 - ph) * (ph < .05 ? ph / .05 : 1), r = kind === 'sacked' ? 3 + rr * .06 : 1.2 + 2.5 * (1 - ph);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, kind === 'sacked' ? `rgba(255,120,50,${al})` : `rgba(255,255,240,${al})`); g.addColorStop(1, 'rgba(255,140,80,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over'; // smoke: a few soft grey smudges drifting with the clock
  for (let i = 0; i < 3; i++) { const a = (now * .03 + i * 2.1) % TAU, rad = rr * (.35 + .25 * ((i * .37) % 1)), px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad, r = rr * (kind === 'sacked' ? .2 : .13);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(70,64,60,.32)'); g.addColorStop(1, 'rgba(70,64,60,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); }
  ctx.restore();
}
export function siegeFx(ctx, cx, cy, rr, sil = null) { // bombardment seen from space: brief flashes along the world's limb and dark side, each fading out, and a faint ring of debris
  const now = performance.now() / 1000; ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) { const t = now * 1.3 + i * .41, ph = t % 1, sd = Math.floor(t) * 9.17 + i * 3.3, h = Math.abs(Math.sin(sd * 12.9898) * 43758.5453) % 1, h2 = Math.abs(Math.sin(sd * 78.233) * 12345.6789) % 1;
    const a = h * TAU, rad = rr * (.55 + .45 * h2), px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad, al = (1 - ph) * (1 - ph) * (ph < .08 ? ph / .08 : 1), r = 2.5 + 7 * (1 - ph) * (.5 + h2);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,250,235,${.9 * al})`); g.addColorStop(.3, `rgba(255,190,120,${.5 * al})`); g.addColorStop(1, 'rgba(255,120,60,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(200,190,180,.28)'; ctx.lineWidth = 1; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.arc(cx, cy, rr + 2.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}
function sunGlare(sp = null) {
  if (S.gx && S.gx.glare === false) return;
  const sun = sp ? { x: sp.x, y: sp.y, r: sp.r, kind: 'star' } : BODIES[0]; if (!sun || !FLARE_C || S.cam.z > 3) return; projectTo(Q, sun.x, sun.y); if (!Q.ok) return;
  const mx = S.W * .5, my = S.H * .5, dx = Q.x - mx, dy = Q.y - my, dd = Math.hypot(dx / S.W, dy / S.H);
  if (dd > 1.1) { // off screen: a light leak at the edge nearest the Sun, fading as it swings further round
    if (dd > 2.6 || S.cam.z > .05) return; const t = Math.min(mx / Math.max(1e-6, Math.abs(dx)), my / Math.max(1e-6, Math.abs(dy))), ex = mx + dx * t, ey = my + dy * t, k = .12 * (1 - (dd - 1.1) / 1.5), R = S.H * .55;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(ex, ey, 0, ex, ey, R); gr.addColorStop(0, `rgba(255,214,160,${k})`); gr.addColorStop(.5, `rgba(255,190,130,${k * .35})`); gr.addColorStop(1, 'rgba(255,180,120,0)'); ctx.fillStyle = gr; ctx.fillRect(ex - R, ey - R, R * 2, R * 2); ctx.restore(); return; }
  if (!sp) for (const b of BODIES) { if (b === sun || b.kind === 'star') continue; const rp = b.r * S.cam.z; if (rp < 4) continue; projectTo(Q, b.x, b.y); if (Q.ok && Math.hypot(Q.x - (mx + dx), Q.y - (my + dy)) < rp * .98 && hyp(b.x - S.cam.x, b.y - S.cam.y) < hyp(sun.x - S.cam.x, sun.y - S.cam.y)) return; projectTo(Q, sun.x, sun.y); }
  const sr = sun.r * Q.k, k = clamp(1.15 - dd, 0, 1) * clamp(sr / 40, .25, 1) * (sr > S.H * 2 ? .3 : 1), R = clamp(160 + sr * 1.2, 160, S.H * 1.3); // apparent size from the projection's depth, not the map zoom
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = .5 * k; ctx.drawImage(FLARE_C, Q.x - R, Q.y - R, R * 2, R * 2);
  ctx.globalAlpha = .14 * k; ctx.drawImage(FLARE_C, Q.x - R * 2.2, Q.y - R * 2.2, R * 4.4, R * 4.4);
  // ghosts along the axis through the screen centre
  const ghosts = [[-.35, 18, 'rgba(255,170,110,'], [-.7, 10, 'rgba(255,220,160,'], [-1.2, 26, 'rgba(120,170,255,'], [.5, 8, 'rgba(255,240,200,'], [1.1, 14, 'rgba(255,190,120,']];
  for (const [t, r, c] of ghosts) { const gx = mx - dx * t, gy = my - dy * t, gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, r); gr.addColorStop(0, c + (.14 * k) + ')'); gr.addColorStop(.7, c + (.06 * k) + ')'); gr.addColorStop(1, c + '0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill(); }
  { const gx = mx + dx * .9, gy = my + dy * .9, r = 30 + sr * .1; ctx.strokeStyle = `rgba(255,200,140,${.09 * k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.stroke(); } // a hollow ring ghost
  // the anamorphic streak: a thin blue-white line across the screen through the Sun, brightest at the Sun and fading out
  const sw = S.W * (.4 + .25 * clamp(sr / 60, 0, 1)), ks = clamp(1.15 - dd, 0, 1) * clamp(sr / 6, .5, 1) * (sr > S.H * 2 ? .3 : 1);
  for (const [h, a] of [[1.5, 1], [5, .4], [16, .12]]) { const gr = ctx.createLinearGradient(Q.x - sw, 0, Q.x + sw, 0);
    for (const [t, f] of [[0, 0], [.12, .1], [.25, .3], [.38, .6], [.5, 1], [.62, .6], [.75, .3], [.88, .1], [1, 0]]) gr.addColorStop(t, `rgba(${f > .5 ? '225,238,255' : '150,190,255'},${a * ks * f})`);
    ctx.fillStyle = gr; ctx.fillRect(Q.x - sw, Q.y - h, sw * 2, h * 2); }
  ctx.restore();
}
function drawScreen() {
  const g = G.screen(), m = S.mouse;
  if (m.down) { const x = Math.min(m.bx, m.x), y = Math.min(m.by, m.y), w = Math.abs(m.x - m.bx), h = Math.abs(m.y - m.by); g.rect(x, y, w, h).fill({ color: 0x3ddc84, alpha: .07 }).stroke({ width: 1, color: 0x3ddc84 }); }
  if (S.screenFlash > 0) g.rect(0, 0, S.W, S.H).fill({ color: 0xfffaf0, alpha: S.screenFlash });
  sunGlare();
  if (S.amode && S.selection.length) { // attack-move preview: a dashed line from the selection to the cursor
    const mob = S.selection.filter(s => !s.def.static && !s.dead); if (mob.length) { const cx = mob.reduce((a, s) => a + s.x, 0) / mob.length, cy = mob.reduce((a, s) => a + s.y, 0) / mob.length; projectTo(Q, cx, cy);
      if (Q.ok) { ctx.setLineDash([8, 6]); g.moveTo(Q.x, Q.y).lineTo(m.x, m.y).stroke({ width: 1.5, color: 0xff4b3e, alpha: .7 }); ctx.setLineDash([]); } }
  }
  if (S.nmode) for (const s of S.selection) if (!s.dead && nukesOf(s).some(w => w.ammo >= 1)) { // nuke mode: where each launcher is
    projectTo(Q, s.x, s.y); if (Q.ok) g.circle(Q.x, Q.y, 18).stroke({ width: 1.5, color: 0xff5040, alpha: .7 });
  }
  // every nuke in flight is tracked: a ring and its time to impact on screen, an arrow at the edge when it is off it
  for (const mi of S.missiles) {
    if (!mi.nuke || mi.dead) continue; const tg = mi.t && !mi.t.dead ? mi.t : mi.tp, sp = Math.max(60, hyp(mi.vx, mi.vy)), eta = tg ? Math.max(0, hyp(tg.x - mi.x, tg.y - mi.y) / sp) : mi.life;
    const col = mi.team === 0 ? 0xffd27a : 0xff5040, txt = `☢ ${mi.team === 0 ? 'OUR NUKE' : 'NUKE'} · ${eta.toFixed(0)}s`; projectTo(Q, mi.x, mi.y);
    const inside = Q.ok && Q.x > 24 && Q.y > 60 && Q.x < S.W - 24 && Q.y < S.H - 24;
    if (inside) { g.circle(Q.x, Q.y, 20 + 4 * Math.sin(S.time * 8)).stroke({ width: 1.6, color: col, alpha: .8 }); label(txt, Q.x, Q.y + 24, col, false, true); continue; }
    const cx = S.W / 2, cy = S.H / 2, dx = (Q.ok ? Q.x : cx + (mi.x - S.cam.x)) - cx, dy = (Q.ok ? Q.y : cy + (mi.y - S.cam.y)) - cy, k = Math.min((S.W / 2 - 34) / Math.max(1e-3, Math.abs(dx)), (S.H / 2 - 50) / Math.max(1e-3, Math.abs(dy))), ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
    g.poly([ex + Math.cos(a) * 14, ey + Math.sin(a) * 14, ex + Math.cos(a + 2.5) * 10, ey + Math.sin(a + 2.5) * 10, ex + Math.cos(a - 2.5) * 10, ey + Math.sin(a - 2.5) * 10]).fill({ color: col, alpha: .6 + .4 * Math.sin(S.time * 8) });
    label(txt, ex - Math.cos(a) * 30, ey - Math.sin(a) * 22 - 6, col, false, true);
  }
  if (S.follow && !S.follow.dead) label(`FOLLOWING · ${(S.follow.title || S.follow.def.name).toUpperCase()} · middle-drag to orbit · . to release`, S.W / 2, 96, 0x9be8a8, false, false);
  else if (S.director && S.mode === 'battle') label(S.dirShot ? 'DIRECTOR · ' + S.dirShot.what : 'DIRECTOR ON', S.W / 2, 96, 0xe8c87e, false, false);
  const txt = S.amode ? 'ATTACK-MOVE' : S.nmode ? '☢ NUCLEAR TARGET' : S.tmode ? (S.tmode.kind === 'pods' ? '▼ ASSAULT PODS · CLICK AN ENEMY CAPITAL SHIP' : '⬡ STARSHELLS · CLICK AN ENEMY CAPITAL SHIP') : '';
  if (txt) { ctx.globalAlpha = 1; ctx.font = 'bold 12px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = S.nmode ? '#fff' : S.tmode ? '#ffb070' : '#ff4b3e'; ctx.fillText(txt, m.x + 14, m.y - 6); }
  flushLabels();
}

// ---------------------------------------------------------------- minimap (2D canvas)
export function drawMini(mm, MMS) {
  // the whole system: orbits to scale, named worlds ringed in their holder's color, fleets, pings and the camera
  const m = mm.getContext('2d'), Sz = mm.width, dpr = Sz / (mm.clientWidth || Sz / 2), k = Sz / (MMS.h * 2), px = 1 / k, U = dpr * px; // U: one CSS pixel in world units
  m.setTransform(1, 0, 0, 1, 0, 0); m.fillStyle = '#05060a'; m.fillRect(0, 0, Sz, Sz);
  m.setTransform(k, 0, 0, k, Sz / 2 - MMS.x * k, Sz / 2 - MMS.y * k);
  m.lineWidth = U;
  for (const b of BODIES) if (b.kind === 'planet' && (!MMS.inner || hyp(b.x, b.y) < 12e6)) { m.strokeStyle = 'rgba(201,162,94,.18)'; m.beginPath(); m.arc(0, 0, hyp(b.x, b.y), 0, TAU); m.stroke(); }
  for (const f of S.fields) { if (f.hulk) continue; m.fillStyle = 'rgba(150,130,110,.4)'; m.beginPath(); m.arc(f.x, f.y, Math.max(f.r, 2 * U), 0, TAU); m.fill(); }
  const pulse = .5 + .5 * Math.sin(S.time * 7);
  for (const b of BODIES) {
    const r = Math.max(b.r, (b.kind === 'star' ? 4.5 : b.kind === 'planet' ? 3.4 : 1.8) * U);
    m.fillStyle = b.pal ? b.pal.c[1] : '#888'; m.beginPath(); m.arc(b.x, b.y, r, 0, TAU); m.fill();
    const w = S.worlds && S.worlds[b.id];
    if (w) { const att = worldUnderAttack(b.id); m.strokeStyle = att ? `rgba(255,75,62,${.5 + .5 * pulse})` : w.owner >= 0 ? S.teamc[w.owner].main : '#8a857c'; m.lineWidth = (att ? 2.2 : 1.4) * U; m.beginPath(); m.arc(b.x, b.y, r + 2 * U, 0, TAU); m.stroke(); m.lineWidth = U; }
  }
  // names in screen space (canvas text can't be drawn at world-unit font sizes)
  m.save(); m.setTransform(1, 0, 0, 1, 0, 0); m.font = `700 ${10.5 * dpr}px Cinzel, Georgia, serif`; m.textAlign = 'left';
  const mr = [], whole = !MMS.inner && !MMS.local;
  const named = BODIES.filter(b => MMS.local ? (b.parent != null && BODIES[b.parent].name === MMS.local) || b.name === MMS.local : b.kind !== 'moon' && !(MMS.inner && hyp(b.x, b.y) > 12e6) && !(whole && b.kind !== 'star' && hyp(b.x, b.y) < 12e6)).sort((a, b) => b.r - a.r);
  for (const b of named) { const sx = (b.x - MMS.x) * k + Sz / 2, sy = (b.y - MMS.y) * k + Sz / 2, r = Math.max(b.r * k, 3.4 * dpr);
    const t = whole && b.kind === 'star' ? 'INNER SYSTEM' : b.name.replace('The ', '').toUpperCase(), tw = m.measureText(t).width, left = sx + r + 4 * dpr + tw > Sz - 2;
    const lx = left ? sx - r - 4 * dpr - tw : sx + r + 4 * dpr; if (mr.some(q => lx < q.x + q.w && lx + tw > q.x && Math.abs(q.y - sy) < 11 * dpr)) continue; mr.push({ x: lx, y: sy, w: tw });
    m.fillStyle = 'rgba(0,0,0,.6)'; m.fillText(t, lx + 1, sy + 3.5 * dpr + 1);
    m.fillStyle = b.kind === 'star' ? 'rgba(255,224,160,.85)' : 'rgba(239,230,210,.9)'; m.fillText(t, lx, sy + 3.5 * dpr); }
  m.restore();
  // fleets: battle groups as numbered chevrons, other warships as small marks, enemies you can see as diamonds
  const done = new Set();
  for (const g of groupList()) { const f = g.flag; if (!f || f.dead) continue; for (const s of g.members) done.add(s); const sz = 4.5 * U;
    m.fillStyle = S.teamc[0].main; m.beginPath(); m.moveTo(f.x - sz, f.y - sz * .6); m.lineTo(f.x, f.y); m.lineTo(f.x + sz, f.y - sz * .6); m.lineTo(f.x + sz, f.y + sz * .3); m.lineTo(f.x, f.y + sz); m.lineTo(f.x - sz, f.y + sz * .3); m.closePath(); m.fill();
    m.font = `${9 * U}px ui-monospace,monospace`; m.fillStyle = '#efe6d2'; m.textAlign = 'center'; m.fillText(String(g.n), f.x, f.y - sz * 1.1); }
  for (const s of S.ships) {
    if (done.has(s) || s.def.fighter || s.def.shell || s.dead) continue; if (s.team !== 0 && !s.seen) continue;
    const r = (s.def.static ? 2 : (s.def.r0 ?? s.r) > 40 ? 2.6 : 1.6) * U; m.fillStyle = S.selection.includes(s) ? '#3ddc84' : disabled(s) ? '#777' : S.teamc[s.team].main;
    if (s.team === 1 && !s.def.static) { m.beginPath(); m.moveTo(s.x, s.y - r * 1.3); m.lineTo(s.x + r * 1.3, s.y); m.lineTo(s.x, s.y + r * 1.3); m.lineTo(s.x - r * 1.3, s.y); m.closePath(); m.fill(); }
    else m.fillRect(s.x - r / 2, s.y - r / 2, r, r);
  }
  for (const mi of S.missiles) if (mi.nuke) { m.fillStyle = '#fff'; m.fillRect(mi.x - 2 * U, mi.y - 2 * U, 4 * U, 4 * U); }
  // pings: a ring that grows, then a dot that fades over ten seconds
  if (S.pings) { S.pings = S.pings.filter(p => S.time - p.t < 10 && S.time >= p.t);
    for (const p of S.pings) { const a = S.time - p.t; m.strokeStyle = p.col; m.fillStyle = p.col;
      if (a < .9) { m.globalAlpha = 1 - a / .9; m.lineWidth = 1.6 * U; m.beginPath(); m.arc(p.x, p.y, (4 + 12 * a / .9) * U, 0, TAU); m.stroke(); }
      m.globalAlpha = .9 * (1 - a / 10); m.beginPath(); m.arc(p.x, p.y, 1.8 * U, 0, TAU); m.fill(); m.globalAlpha = 1; } }
  // the camera: its ground footprint (a trapezoid under the tilt), or corner brackets when it is only a few pixels
  const fpz = footprint(); let span = 0; for (const [x] of fpz) span = Math.max(span, Math.abs(x - S.cam.x) * 2);
  m.strokeStyle = 'rgba(232,200,126,.85)'; m.lineWidth = 1.5 * U;
  if (span < MMS.h * 2) {
    if (span * k / dpr < 9) { const b = 6 * U, c = 3 * U, x = S.cam.x, y = S.cam.y; m.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { m.moveTo(x + sx * b, y + sy * (b - c)); m.lineTo(x + sx * b, y + sy * b); m.lineTo(x + sx * (b - c), y + sy * b); } m.stroke(); }
    else { m.beginPath(); fpz.forEach(([x, y], i) => i ? m.lineTo(x, y) : m.moveTo(x, y)); m.closePath(); m.stroke(); }
  }
  // which tier the camera is at
  m.setTransform(1, 0, 0, 1, 0, 0); m.font = `600 ${10 * dpr}px Cinzel, Georgia, serif`; m.fillStyle = 'rgba(201,162,94,.9)'; m.textAlign = 'left';
  let nb = null, nd = 1e18; for (const b of BODIES) { const d = hyp(S.cam.x - b.x, S.cam.y - b.y) - b.r; if (d < nd) { nd = d; nb = b; } }
  m.fillText(MMS.local ? MMS.local.toUpperCase() + ' SYSTEM' : S.cam.z < .004 ? (MMS.inner ? 'THE INNER SYSTEM' : 'THE SOLAR SYSTEM') : nd > 150000 ? 'DEEP SPACE' : S.cam.z >= .15 ? 'CLOSE · ' + (nb ? nb.name.toUpperCase() : '') : (nb ? nb.name.toUpperCase() : ''), 6 * dpr, 13 * dpr);
}
// how big each class draws on a card, so the size of the hull reads at a glance
const ICON_K = { ripwing: .42, boarder: .42, starshell: .4, scout: .5, corvette: .55, corsair: .58, frigate: .64, raider: .7, tender: .7, hauler: .74, torch: .78, destroyer: .86, dread: .97, moonbreaker: 1.12 };
export function buildIcon(type, fac, color) { // small 2D icon for the build bar and the ship cards, in its navy's lines
  const P = fshape(type, fac), [c, g] = canvas(120, 88); g.translate(60, 44); const sc = 30 / Math.max(...P.map(p => Math.abs(p[0]))) * .95 * (ICON_K[type] || .75);
  hullPath(g, P, sc); g.fillStyle = '#2a2224'; g.fill(); g.strokeStyle = color || (S.teamc[0] ? S.teamc[0].main : '#ff4b3e'); g.lineWidth = 1.6; g.stroke();
  g.globalAlpha = .5; g.beginPath(); g.moveTo(-sc * .8, 0); g.lineTo(sc * .9, 0); g.stroke(); return c;
}
