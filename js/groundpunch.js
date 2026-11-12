// Ground-battle combat effects: the ground counterpart of render.js's space-battle punch.
// Shots fly as lit ribbons (never thinner than ~1.5 px, so a firefight reads at any zoom) with a hot head; guns
// flash at the muzzle; heavy rounds burst in a turning fireball with sparks, smoke and a shock ring; drop pods and
// breaches throw a column of fire and smoke; big blasts near the camera shake it; and the frame goes through the
// same bloom as the space battles. Owned by the ground chat; the texture painters follow render.js's (graphics).
// groundview.js calls: init(scene) per battle, shot / impact / muzzle / blast / sparks as events come in,
// ribbon() for anything drawn fresh each frame, frame(dt, camera, H) once a frame, shake(camera) around the render.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uniform, attribute, varying, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, cameraPosition,
  uv, texture, normalize, cross, mix, length, max, min, smoothstep, cos, sin, pow, abs, clamp } from 'three/tsl';
import { S } from './state.js';

// ---------------------------------------------------------------- textures (as render.js paints them)
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function radial(n, stops) { const [c, g] = canvas(n, n), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); for (const [k, a] of stops) gr.addColorStop(k, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(0, 0, n, n); return c; }
// a fireball: soft blobs, outward tongues, a white core and dark gaps punched between the tongues
function fireC() { const [c, g] = canvas(256, 256), R = seeded(17);
  for (let i = 0; i < 46; i++) { const d = R() * 70, a = R() * Math.PI * 2, r = 16 + R() * 44 * (1 - d / 110), x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, k = .3 + R() * .4; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${k})`); gr.addColorStop(.4, `rgba(255,255,255,${k * .4})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 14; i++) { const a = R() * Math.PI * 2, L = 60 + R() * 60, w = 6 + R() * 10; g.save(); g.translate(128, 128); g.rotate(a); const gr = g.createLinearGradient(0, 0, L, 0); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(.6, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(10, -w); g.quadraticCurveTo(L * .6, -w * .4, L, 0); g.quadraticCurveTo(L * .6, w * .4, 10, w); g.closePath(); g.fill(); g.restore(); }
  const core = g.createRadialGradient(128, 128, 0, 128, 128, 70); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(.35, 'rgba(255,255,255,.6)'); core.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = core; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 18; i++) { const a = R() * Math.PI * 2, d = 30 + R() * 60, r = 8 + R() * 18, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  return c; }
// smoke: a puffy cluster, soft-edged, that turns as it drifts
function smokeC() { const [c, g] = canvas(128, 128), R = seeded(23);
  for (let i = 0; i < 22; i++) { const d = R() * 34, a = R() * Math.PI * 2, r = 14 + R() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, k = .25 + R() * .3; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${k})`); gr.addColorStop(.5, `rgba(255,255,255,${k * .45})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const fade = g.createRadialGradient(64, 64, 0, 64, 64, 64); fade.addColorStop(0, 'rgba(255,255,255,1)'); fade.addColorStop(.7, 'rgba(255,255,255,.8)'); fade.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = 'destination-in'; g.fillStyle = fade; g.fillRect(0, 0, 128, 128);
  return c; }
// a thin shock ring with a soft outer skirt
function shockC() { const [c, g] = canvas(256, 256); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.8, 'rgba(255,255,255,0)'); gr.addColorStop(.9, 'rgba(255,255,255,.9)'); gr.addColorStop(.95, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return c; }
let TEX = null;
function textures() { if (TEX) return TEX; const t = c => { const x = new THREE.CanvasTexture(c); x.colorSpace = THREE.NoColorSpace; x.generateMipmaps = true; x.minFilter = THREE.LinearMipmapLinearFilter; return x; };
  return (TEX = { glow: t(radial(64, [[0, 1], [.2, .62], [.5, .2], [1, 0]])), fire: t(fireC()), smoke: t(smokeC()), shock: t(shockC()) }); }

// ---------------------------------------------------------------- batches
// pxK: metres per pixel at one metre from the camera (set each frame), so no sprite or ribbon draws under ~1.5 px
const pxK = uniform(.001), one = float(1);
// camera-facing quads: iP position, iS (size m, rotation, alpha), iC colour (may exceed 1: bloom takes the excess)
function spriteBatch(n, tex, mode) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const iP = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), iS = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), iC = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  for (const a of [iP, iS, iC]) a.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iP', iP); g.setAttribute('iS', iS); g.setAttribute('iC', iC); g.instanceCount = 0;
  const m = new THREE.NodeMaterial(); m.transparent = true; m.depthWrite = false; m.lights = false; m.fog = false; m.side = THREE.DoubleSide;
  m.blending = mode === 'smoke' || mode === 'fire' ? THREE.NormalBlending : THREE.AdditiveBlending; // fire blends over the ground, so it stays orange on a sunlit plain; its HDR colour still blooms
  const aP = attribute('iP', 'vec3'), aS = attribute('iS', 'vec3'), aC = attribute('iC', 'vec3'), flat = mode === 'flat';
  const size = max(aS.x, length(cameraPosition.sub(aP)).mul(pxK).mul(2.2)), dim = aS.x.div(size);
  const vA = varying(aS.z.mul(mix(dim.mul(dim), one, .25))), vC = varying(aC);    // a sprite held at its minimum pixel size fades instead of glaring
  m.vertexNode = Fn(() => {
    const c = cos(aS.y), s = sin(aS.y);
    const q = positionGeometry.xy.mul(size), r = vec2(c.mul(q.x).sub(s.mul(q.y)), s.mul(q.x).add(c.mul(q.y)));
    if (flat) return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(aP.add(vec3(r.x, 0, r.y)), 1)); // lies on the ground: shock rings
    const mv = cameraViewMatrix.mul(vec4(aP, 1)).toVar(); return cameraProjectionMatrix.mul(vec4(mv.xy.add(r), mv.z.add(size.mul(.45)), mv.w)); })(); // pulled toward the camera so the ground does not cut it in half
  m.fragmentNode = Fn(() => { const t = texture(tex, uv());
    return mode === 'smoke' || mode === 'fire' ? vec4(vC, t.a.mul(vA)) : vec4(vC.mul(t.r).mul(vA), 1); })();
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = mode === 'smoke' ? 21 : mode === 'fire' ? 21.5 : 22;
  return { mesh, n, P: iP.array, S: iS.array, C: iC.array, a: [iP, iS, iC], k: 0 };
}
// ribbons from A to B, turned to face the camera: iA, iB, iW (width m, alpha, head share), iC colour
// across: a hot core and a soft edge; along: dim at the tail, full at the head, a white-hot tip
function ribbonBatch(n) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -.5, 0, 1, -.5, 0, 1, .5, 0, 0, .5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const iA = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), iB = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), iW = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), iC = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  for (const a of [iA, iB, iW, iC]) a.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iA', iA); g.setAttribute('iB', iB); g.setAttribute('iW', iW); g.setAttribute('iC', iC); g.instanceCount = 0;
  const m = new THREE.NodeMaterial(); m.transparent = true; m.depthWrite = false; m.lights = false; m.fog = false; m.blending = THREE.NormalBlending; m.side = THREE.DoubleSide; // painted over, not added: added light vanishes on a sunlit plain; the strip faces the camera either way round
  const aA = attribute('iA', 'vec3'), aB = attribute('iB', 'vec3'), aW = attribute('iW', 'vec3'), aC = attribute('iC', 'vec3');
  const pR = mix(aA, aB, positionGeometry.x), toCam = cameraPosition.sub(pR), w = max(aW.x, length(toCam).mul(pxK).mul(1.5)), dim = aW.x.div(w);
  const vA = varying(aW.y.mul(mix(dim, one, .35))), vC = varying(aC), vW = varying(aW);
  m.vertexNode = Fn(() => {
    const p = pR, d = aB.sub(aA), side = normalize(cross(d, toCam).add(vec3(0, 1e-5, 0)));
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p.add(side.mul(positionGeometry.y.mul(w))), 1)); })();
  m.fragmentNode = Fn(() => { const u = uv(), across = one.sub(abs(u.y.mul(2).sub(1))), core = pow(across, 3), soft = pow(across, 1.2);
    const along = mix(float(.08), one, pow(u.x, 1.6)), tip = smoothstep(one.sub(vW.z), one, u.x);
    const c = mix(vC, vec3(1.6, 1.5, 1.35), clamp(core.mul(.3).add(tip.mul(core).mul(.8)), 0, 1)); // the weapon's colour, white only in the hot core at the head
    const a = clamp(soft.mul(.55).add(core.mul(.6)).mul(along.add(tip.mul(.8))).mul(vA), 0, 1);
    return vec4(c.mul(core.mul(.35).add(.55)), a); })();
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 23;
  return { mesh, n, A: iA.array, B: iB.array, W: iW.array, C: iC.array, a: [iA, iB, iW, iC], k: 0 };
}

// ---------------------------------------------------------------- state
let B = null, parts = [], kick = 0; const FX = () => clamp(S.fxK || 1, .4, 1.6), rnd = (a, b) => a + Math.random() * (b - a);
export function init(scene) {
  const T = textures();
  B = { glow: spriteBatch(3000, T.glow, 'add'), fire: spriteBatch(900, T.fire, 'fire'), smoke: spriteBatch(1400, T.smoke, 'smoke'), ring: spriteBatch(64, T.shock, 'flat'), rib: ribbonBatch(7000) };
  for (const k in B) scene.add(B[k].mesh);
  parts = []; kick = 0;
}
export function dispose() { if (B) for (const k in B) { const m = B[k].mesh; m.parent && m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); } B = null; parts = []; } // the textures are shared and stay
export const ready = () => !!B;

// one quad this frame
function sprite(b, x, y, z, size, rot, al, r, g, bl) { const o = b.k; if (o >= b.n) return; b.k++;
  b.P[o * 3] = x; b.P[o * 3 + 1] = y; b.P[o * 3 + 2] = z; b.S[o * 3] = size; b.S[o * 3 + 1] = rot; b.S[o * 3 + 2] = al; b.C[o * 3] = r; b.C[o * 3 + 1] = g; b.C[o * 3 + 2] = bl; }
// one ribbon this frame: from a to b, width w (m), alpha, colour, the share of its length that burns white at the head
export function ribbon(ax, ay, az, bx, by, bz, w, al, r, g, bl, head = .15) { if (!B) return; const R = B.rib, o = R.k; if (o >= R.n) return; R.k++;
  R.A[o * 3] = ax; R.A[o * 3 + 1] = ay; R.A[o * 3 + 2] = az; R.B[o * 3] = bx; R.B[o * 3 + 1] = by; R.B[o * 3 + 2] = bz; R.W[o * 3] = w; R.W[o * 3 + 1] = al; R.W[o * 3 + 2] = head; R.C[o * 3] = r; R.C[o * 3 + 1] = g; R.C[o * 3 + 2] = bl; }
export function glow(x, y, z, size, al, r, g, b) { if (B) sprite(B.glow, x, y, z, size, 0, al, r, g, b); }

// particles that live a while: kind fire | glow | smoke | ring | spark
function add(p) { if (!B || parts.length > 5000) return; p.age = 0; parts.push(p); return p; }
const FIRE = [[1, 1, 1], [1, .92, .6], [1, .62, .22], [.75, .28, .08], [.25, .08, .03]]; // white → yellow → orange → ember
function fireCol(k, out) { const f = Math.min(3.999, k * 4), i = f | 0, t = f - i, a = FIRE[i], b = FIRE[i + 1]; out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; }
const tmpC = [0, 0, 0];

// what each weapon looks like at the muzzle and in flight: colour (linear, >1 blooms), ribbon width (m), streak length (m), muzzle flash size (m)
export const LOOK = {
  scorch:  { c: [2.2, 1.35, .55], w: .45, len: 14, mz: 2.4 },
  pulse:   { c: [2.6, .55, .3], w: .8, len: 10, mz: 3.2 },
  plasma:  { c: [.5, 2.4, .8], w: 1.1, len: 8, mz: 3, head: 3.2 },
  rail:    { c: [1.1, 1.9, 2.8], w: .32, len: 140, mz: 4.5, sheath: 1.4 },
  cannon:  { c: [2.8, 1.35, .45], w: 1.5, len: 18, mz: 7, head: 5 },
  heavy:   { c: [2.8, 2.1, .7], w: 1.7, len: 20, mz: 9, head: 6 },
  missile: { c: [2.4, 1.4, .6], w: .9, len: 8, mz: 5, head: 4, smoke: true },
  sarissa: { c: [2.2, 2.4, 2.8], w: .7, len: 60, mz: 6 },
};
// a gun fires: a flash at the muzzle, turned to the line of fire, and a puff for the heavy guns
export function muzzle(x, y, z, dx, dy, dz, kind) { if (!B) return; const L = LOOK[kind] || LOOK.scorch, n = Math.hypot(dx, dy, dz) || 1, s = L.mz;
  add({ k: 'glow', x, y, z, size: s * 2.2, life: .07, al: 1, c: L.c });
  add({ k: 'glow', x: x + dx / n * s * .5, y: y + dy / n * s * .5, z: z + dz / n * s * .5, size: s * .9, life: .05, al: 1, c: [2, 1.9, 1.7] });
  add({ k: 'streak', x, y, z, dx: dx / n, dy: dy / n, dz: dz / n, len: s * 1.6, w: s * .45, life: .06, c: L.c });
  if (s >= 5 && Math.random() < FX()) add({ k: 'smoke', x, y: y + 1, z, vx: dx / n * 3, vy: 1.5, vz: dz / n * 3, size: s * 1.4, grow: 3, life: 1.6, al: .35, c: [.55, .53, .5], rot: Math.random() * 6, spin: rnd(-.6, .6) });
}
// sparks thrown out from a point: short bright ribbons on ballistic paths
export function sparks(x, y, z, n, speed, c, life = .5) { if (!B) return; n = Math.round(n * FX());
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, e = rnd(.15, 1.1), v = speed * rnd(.4, 1); add({ k: 'spark', x, y, z, ground: y - .5, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(e) * v, vz: Math.sin(a) * Math.cos(e) * v, life: life * rnd(.6, 1.2), w: rnd(.15, .3), c }); } }
// a glow that fades over its life (the old flash), and a puff of grey left behind a missile in flight
export function flare(x, y, z, size, life, c) { add({ k: 'glow', x, y, z, size, life, al: 1, c }); }
export function trail(x, y, z) { if (Math.random() < .6 * FX()) add({ k: 'smoke', x, y, z, vx: rnd(-.5, .5), vy: rnd(.3, 1), vz: rnd(-.5, .5), size: 1.6, grow: 4, life: rnd(1.4, 2.2), al: .3, c: [.7, .7, .7], rot: Math.random() * 6, spin: rnd(-.8, .8) }); }
// a round lands. Small arms: a spark and a glint. Heavy rounds: a fireball in two turning layers, sparks, smoke, dust
export function impact(x, y, z, kind) { if (!B) return; const L = LOOK[kind] || LOOK.scorch;
  if (kind === 'cannon' || kind === 'heavy' || kind === 'missile') {
    const R = kind === 'missile' ? 11 : kind === 'heavy' ? 9 : 7;
    add({ k: 'glow', x, y: y + R * .4, z, size: R * 2, life: .12, al: .55, c: [2, 1.5, .9] });
    for (let i = 0; i < 2; i++) add({ k: 'fire', x, y: y + R * .5, z, size: R, life: .75 + i * .15, rot: Math.random() * 6, spin: i ? -1.6 : 1.9, al: 1, rise: 4 });
    sparks(x, y + 1, z, kind === 'missile' ? 12 : 8, 38, [2.6, 1.6, .6], .7);
    for (let i = 0; i < Math.round(3 * FX()); i++) add({ k: 'smoke', x: x + rnd(-2, 2), y: y + R * .6, z: z + rnd(-2, 2), vx: rnd(-1.5, 1.5), vy: rnd(3, 6), vz: rnd(-1.5, 1.5), size: R * 1.2, grow: R * .7, life: rnd(3, 4.5), al: .55, c: [.22, .21, .2], rot: Math.random() * 6, spin: rnd(-.4, .4), delay: .25 });
    return; }
  add({ k: 'glow', x, y, z, size: L.mz * (kind === 'rail' ? 1.6 : 1.1), life: kind === 'rail' ? .22 : .12, al: 1, c: L.c });
  if (kind === 'rail' || Math.random() < .25) sparks(x, y, z, kind === 'rail' ? 5 : 2, kind === 'rail' ? 30 : 16, L.c, .35);
}
// a big blast on the ground: drop pods landing, a wall coming down, a magazine going up. A column of fire, a shock
// ring running out along the ground, debris sparks, a rolling smoke column; the camera feels it
export function blast(x, y, z, big) { if (!B) return; const R = big ? 34 : 18;
  add({ k: 'glow', x, y: y + R * .5, z, size: R * 1.4, life: .14, al: .55, c: [2, 1.5, .9] });
  for (let i = 0; i < 3; i++) add({ k: 'fire', x: x + rnd(-R, R) * .2, y: y + R * (.4 + i * .3), z: z + rnd(-R, R) * .2, size: R * (1 - i * .2), life: 1.1 + i * .25, rot: Math.random() * 6, spin: (i % 2 ? -1 : 1) * rnd(.9, 1.6), al: 1, rise: 7 + i * 4 });
  add({ k: 'ring', x, y: y + 1.5, z, size: R, grow: R * 3.5, life: .8, al: .8, c: [1.6, 1.4, 1.1] });
  sparks(x, y + 2, z, big ? 26 : 14, big ? 70 : 50, [2.8, 1.7, .6], 1.1);
  for (let i = 0; i < Math.round((big ? 9 : 5) * FX()); i++) add({ k: 'smoke', x: x + rnd(-R, R) * .4, y: y + R * rnd(.3, 1), z: z + rnd(-R, R) * .4, vx: rnd(-2, 2), vy: rnd(5, 11), vz: rnd(-2, 2), size: R * 1.1, grow: R * 1.3, life: rnd(5, 8), al: .6, c: [.2, .19, .18], rot: Math.random() * 6, spin: rnd(-.3, .3), delay: rnd(.2, .6) });
  kick = Math.max(kick, big ? 1 : .55); kickAt = { x, z, amp: big ? 9 : 5 };
}
let kickAt = null;

// ---------------------------------------------------------------- the frame
// dt: real seconds; step: battle seconds (0 when paused); camera: the view's; H: canvas height in px
export function frame(dt, step, camera, H) {
  if (!B) return;
  pxK.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(200, H);
  const keep = [];
  for (const p of parts) {
    if (p.delay > 0) { p.delay -= step; keep.push(p); continue; }
    p.age += step; const k = p.age / p.life; if (k >= 1) continue; keep.push(p);
    if (p.k === 'glow') { const a = (1 - k) * (1 - k) * p.al; sprite(B.glow, p.x, p.y, p.z, p.size * (1 + k * .4), 0, a, p.c[0], p.c[1], p.c[2]); }
    else if (p.k === 'streak') { const a = 1 - k; ribbon(p.x, p.y, p.z, p.x + p.dx * p.len, p.y + p.dy * p.len, p.z + p.dz * p.len, p.w, a, p.c[0], p.c[1], p.c[2], .5); }
    else if (p.k === 'fire') { const e = 1 - (1 - k) * (1 - k), s = p.size * (.5 + 1.3 * e); fireCol(Math.min(1, k * 1.1 + .2), tmpC); const hot = 2.2 * (1 - k * .7), a = p.al * .9 * (k < .55 ? 1 : (1 - k) / .45); // three layers overlap: kept under white so the colour survives the bloom
      sprite(B.fire, p.x, p.y + p.rise * p.age, p.z, s, (p.rot += p.spin * step), a, tmpC[0] * hot, tmpC[1] * hot, tmpC[2] * hot); }
    else if (p.k === 'smoke') { p.x += p.vx * step; p.y += p.vy * step; p.z += p.vz * step; p.vy *= Math.exp(-.35 * step); const a = p.al * Math.min(1, k * 6) * (1 - k);
      sprite(B.smoke, p.x, p.y, p.z, p.size + p.grow * Math.sqrt(k) * 2, (p.rot += p.spin * step), a, p.c[0], p.c[1], p.c[2]); }
    else if (p.k === 'ring') { const a = (1 - k) * p.al; sprite(B.ring, p.x, p.y, p.z, p.size + p.grow * (1 - (1 - k) ** 3), 0, a, p.c[0], p.c[1], p.c[2]); }
    else if (p.k === 'spark') { p.vy -= 22 * step; p.x += p.vx * step; p.y = Math.max(p.ground ?? -1e9, p.y + p.vy * step); p.z += p.vz * step;
      const v = Math.hypot(p.vx, p.vy, p.vz) || 1, L = Math.min(6, v * .06 + .5); ribbon(p.x - p.vx / v * L, p.y - p.vy / v * L, p.z - p.vz / v * L, p.x, p.y, p.z, p.w, 1 - k, p.c[0], p.c[1], p.c[2], .3); }
  }
  parts = keep;
  for (const k in B) { const b = B[k]; b.mesh.geometry.instanceCount = b.k; for (const a of b.a) a.needsUpdate = true; b.k = 0; }
  kick = Math.max(0, kick - dt * 2.2);
}
// the camera shake: offset the camera for this render only; call restore() after
const saved = new THREE.Vector3();
export function shake(camera, on = true) {
  saved.copy(camera.position); if (!on || kick <= 0 || !kickAt || S.gx && S.gx.shake === false) return;
  const d = Math.hypot(camera.position.x - kickAt.x, camera.position.z - kickAt.z), fall = Math.max(0, 1 - d / 3500), amp = kickAt.amp * kick * kick * fall * Math.min(1, camera.position.distanceTo(new THREE.Vector3(kickAt.x, camera.position.y, kickAt.z)) / 400 + .3);
  if (amp < .05) return; camera.position.x += rnd(-1, 1) * amp; camera.position.y += rnd(-1, 1) * amp * .6; camera.position.z += rnd(-1, 1) * amp; camera.updateMatrixWorld();
}
export function restore(camera) { camera.position.copy(saved); camera.updateMatrixWorld(); }
export const _dbg = () => ({ parts: parts.length, ready: !!B, kick });
