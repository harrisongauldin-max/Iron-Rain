// Ground-battle textures and effects: the terrain's procedural surface, the water and the sky dome,
// all as TSL node materials (WebGPU, or its WebGL2 backend). Nothing here owns a model: groundview.js builds the
// meshes and calls in for their materials; groundmodels.js owns the figures and props.
import * as THREE from 'three/webgpu';
import { NH, CH, MAP, BIOME, G, heightAt } from './ground.js';
import { Fn, float, vec2, vec3, vec4, uniform, uniformArray, attribute, varying, positionGeometry, positionWorld, normalWorld, cameraPosition, cameraViewMatrix, cameraProjectionMatrix, uv,
  mx_noise_float, mx_fractal_noise_float, mx_worley_noise_float, smoothstep, mix, dot, cross, sqrt, normalize, length, fract, floor, max, min, clamp, pow, abs, select, sin, cos, step, exp, hash,
  transformNormalToView, texture } from 'three/tsl';

const one = float(1), lum = c => dot(c, vec3(.3, .55, .15));
const col3 = h => { const c = new THREE.Color(h); return vec3(c.r, c.g, c.b); };
const T = uniform(0); // the clock, for water and cloud drift
const sunDirU = uniform(new THREE.Vector3(.3, .8, .5)), coverU = uniform(0); // the Sun and the cloud cover, shared by the dome and the ground (the dome sets them)
let dome = null;
// the clouds, as the dome paints them and as the ground wears their shadows: one noise, in world metres, drifting with the clock
const cloudN = q => mx_fractal_noise_float(vec3(q.x.mul(.00075), q.y.mul(.00075), T.mul(.006)), 4, 2.1, .5, 1).mul(.5).add(.5);
const cloudCover = n => smoothstep(one.sub(coverU), one.sub(coverU).add(.32), n);
// the cloud shadow on a ground point: the cloud that lies along the Sun's line 2,600 m up
const cloudShadow = p => { const lean = sunDirU.xz.div(max(sunDirU.y, .2)).mul(float(2600).sub(p.y)); return cloudCover(cloudN(p.xz.add(lean).add(T.mul(9)))).mul(step(.01, coverU)); };
// shell impacts: the last 24, as (x, z, radius, time); the ground wears a scorch at each for a minute
const SCORCH_N = 24, scorchA = uniformArray(Array.from({ length: SCORCH_N }, () => new THREE.Vector4(0, 0, 0, -1e9)), 'vec4'); let scorchI = 0;
const scorchMask = p => { let k = float(0); for (let i = 0; i < SCORCH_N; i++) { const e = scorchA.element(i), d = length(p.xz.sub(e.xy)), age = T.sub(e.w), fade = one.sub(smoothstep(30, 75, age)).mul(step(0, age)).mul(step(.5, e.z));
  const rag = mx_noise_float(vec3(p.x.mul(.6), p.z.mul(.6), e.w)).mul(.35).add(one), m = smoothstep(e.z.mul(1.05), e.z.mul(.3), d.mul(rag)); k = max(k, m.mul(fade)); } return k; };

// ---------------------------------------------------------------- the ground
// Vertex colours carry only the broad shape: the biome's height ramp, slope shading and a little grain. What grows,
// what is paved and where the shore lies go in a mask attribute, and the shader blends them with noise so the
// 25 m cells never show as blobs. The shader adds grain at three scales, rock on the slopes and a bump normal.
export function terrainArrays(M, B) {
  const W = NH + 1, N = W * W, col = new Float32Array(N * 3), mask = new Float32Array(N * 4), tmp = new THREE.Color();
  const ramp = B.ground.map(h => new THREE.Color(h)), rampAt = (f, out) => { const k = Math.min(.999, Math.max(0, f)) * (ramp.length - 1), i = Math.floor(k), t = k - i; return out.copy(ramp[i]).lerp(ramp[Math.min(ramp.length - 1, i + 1)], t); };
  const cell = (i, j) => Math.min(NH - 1, Math.max(0, j)) * NH + Math.min(NH - 1, Math.max(0, i));
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, h = M.H[k];
    rampAt(h / (M.relief || 1), tmp);
    const s = Math.abs((M.H[Math.min(N - 1, k + 1)] || h) - h) + Math.abs((M.H[Math.min(N - 1, k + W)] || h) - h); tmp.multiplyScalar(Math.min(1.1, Math.max(.6, 1.06 - s / 60)));
    const n = ((i * 73856093 ^ j * 19349663) >>> 0) % 1000 / 1000; tmp.multiplyScalar(.95 + n * .1);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    // the mask, averaged over the four cells round the vertex so a patch's edge is a slope, not a step
    let veg = 0, urb = 0, cov = 0;
    for (const [di, dj] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) { const c = cell(i + di, j + dj); veg += M.veg[c] ? .25 : 0; urb += M.urban[c] ? .25 : 0; cov += (M.cover ? M.cover[c] || 0 : 0) * .25; }
    const shore = M.seaH >= 0 ? Math.max(0, 1 - Math.abs(h - (M.seaH + 1)) / 7) : 0;
    mask[k * 4] = veg; mask[k * 4 + 1] = urb; mask[k * 4 + 2] = shore; mask[k * 4 + 3] = Math.min(1, cov);
  }
  return { col, mask };
}
export function terrainMaterial(M, B) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: .95, metalness: 0 });
  const vc = attribute('color', 'vec3'), mk = attribute('mask', 'vec4');
  const vegC = col3(B.veg_c), sandC = col3(B.ground[3]), paveC = col3(B.ground[2]).mul(.55).add(vec3(.26, .25, .24)), wetC = col3(B.water);
  const grain = p => mx_noise_float(p.mul(.42)).mul(.5).add(mx_noise_float(p.mul(1.7)).mul(.25));
  const clump = p => mx_fractal_noise_float(p.mul(.05), 3, 2.1, .55, 1);
  const frag = Fn(() => {
    const p = positionWorld.toVar(), d = length(p.sub(cameraPosition)).toVar();
    const near = one.sub(smoothstep(900, 3200, d)).toVar(); // the fine grain fades before it can shimmer
    const n1 = grain(p).mul(near).toVar(), n2 = clump(p).toVar(), n3 = mx_noise_float(p.mul(.0055)).toVar(), n4 = mx_noise_float(p.mul(.0012).add(7)).toVar();
    const slope = one.sub(clamp(normalWorld.y, 0, 1)).toVar();
    let c = vc.mul(one.add(n1.mul(.08)).add(n2.mul(.14)).add(n3.mul(.09)).add(n4.mul(.07))).toVar();
    // the open ground drifts between a dustier and a stonier tint by the clumps, and wind ripples cross it
    c.assign(mix(c, mix(c, vec3(lum(c)), .35).mul(.9), smoothstep(.1, .6, n2.negate()).mul(.5)));
    const wind = sin(p.x.mul(.55).add(p.z.mul(.22)).add(n2.mul(5)).add(n1.mul(2))).mul(.035).mul(near).add(one);
    c.mulAssign(wind);
    // stones: a cellular scatter, sparse on the flats, thick on the slopes; each a little lighter on top, dark in its shadow
    const wv = mx_worley_noise_float(p.mul(.55)).toVar(), stone = smoothstep(.55, .25, wv).mul(near).toVar();
    const rockK = smoothstep(.16, .42, slope.add(n2.mul(.1)).add(n1.mul(.04))).toVar();
    const stoneK = stone.mul(smoothstep(.2, .7, n2.add(.2)).mul(.35).add(rockK.mul(.6)));
    c.assign(mix(c, mix(c, vec3(lum(c)), .5).mul(float(.8).add(smoothstep(.3, .1, wv).mul(.45))), stoneK));
    // rock where the ground is steep: greyer, darker, striated across the slope
    const stria = sin(p.y.mul(.8).add(n2.mul(2.5)).add(n3.mul(4))).mul(.1).add(one);
    const rockC = mix(c, vec3(lum(c)), .4).mul(.72).mul(stria).mul(one.add(n1.mul(.18)));
    c.assign(mix(c, rockC, rockK));
    // growth: the patch's edge broken by the clumps, the grass itself grainy; thins out on rock
    const vegK = smoothstep(.32, .68, mk.x.add(n2.mul(.42)).add(n1.mul(.12))).mul(one.sub(rockK.mul(.85))).toVar();
    const vegCol = vegC.mul(float(.82).add(n1.mul(.3)).add(n2.mul(.22)).add(n3.mul(.1)));
    c.assign(mix(c, mix(c, vegCol, .85), vegK));
    // the shore: pale sand with ripples, darkening to wet sand at the waterline
    const shoreK = smoothstep(.25, .7, mk.z.add(n1.mul(.15))).toVar();
    const ripple = sin(p.x.mul(.45).add(p.z.mul(.3)).add(n2.mul(3))).mul(.05).add(one);
    c.assign(mix(c, sandC.mul(ripple).mul(one.add(n1.mul(.1))), shoreK));
    if (M.seaH >= 0) { const wet = smoothstep(2.5, -.5, p.y.sub(M.seaH)); c.assign(mix(c, mix(c, wetC, .35).mul(.6), wet.mul(.8))); }
    // pavement: dark stone in a block grid, the joints a little darker, grime in the clumps
    const urbK = smoothstep(.3, .62, mk.y.add(n2.mul(.18))).toVar();
    const g = fract(p.xz.div(25)), joint = max(step(.955, g.x), step(.955, g.y)), slabs = fract(p.xz.div(6.25)), seam = max(step(.94, slabs.x), step(.94, slabs.y)).mul(.5);
    const pave = paveC.mul(float(.92).add(n1.mul(.1)).add(n2.mul(.08))).mul(one.sub(joint.mul(.28)).sub(seam.mul(.12))).mul(one.sub(max(n3, 0).mul(.15)));
    c.assign(mix(c, pave, urbK));
    // rubble and cover: a little darker and rougher
    c.mulAssign(one.sub(mk.w.mul(.12)));
    // the seabed in the shallows: a caustic web of light, two cellular patterns drifting over each other
    if (M.seaH >= 0) { const under = smoothstep(.4, -1.2, p.y.sub(M.seaH)).mul(smoothstep(-16, -3, p.y.sub(M.seaH))).mul(near);
      const w1 = mx_worley_noise_float(vec3(p.x.mul(.22).add(T.mul(.35)), p.z.mul(.22).sub(T.mul(.2)), T.mul(.3))), w2 = mx_worley_noise_float(vec3(p.x.mul(.31).sub(T.mul(.25)), p.z.mul(.31).add(T.mul(.3)), T.mul(.22).add(5)));
      const caus = smoothstep(.45, .85, w1).mul(smoothstep(.4, .85, w2)).mul(2.2).add(smoothstep(.6, .95, w1).mul(.6));
      c.mulAssign(one.add(caus.mul(under).mul(.55))); }
    // shell scorches: blackened ground with an ash-pale rim, fading over a minute
    const sk = scorchMask(p).toVar(); c.assign(mix(c, mix(c.mul(.22), vec3(.1, .09, .08), .6), sk.mul(.9)));
    c.mulAssign(one.add(smoothstep(.02, .12, sk).mul(one.sub(smoothstep(.12, .3, sk))).mul(.35)));
    // the clouds' shadows crossing the ground
    c.mulAssign(one.sub(cloudShadow(p).mul(.42)));
    return c;
  })();
  m.colorNode = frag;
  if (B === BIOME._ice) m.emissiveNode = Fn(() => { // ice: scattered crystals glinting where the Sun's reflection meets the eye, each with its own flicker
    const p = positionWorld, d = length(p.sub(cameraPosition)), near = one.sub(smoothstep(300, 1600, d)), V = normalize(cameraPosition.sub(p)), H = normalize(V.add(sunDirU));
    const cell = floor(p.xz.mul(1.6)), hv = hash(cell.x.mul(13.7).add(cell.y.mul(311.1))), f = fract(p.xz.mul(1.6)).sub(.5), pt = smoothstep(.2, .02, length(f));
    const gl = pow(max(dot(normalWorld, H), 0), 28).mul(smoothstep(.93, 1, hv)).mul(pt).mul(float(.6).add(sin(T.mul(7).add(hv.mul(60))).mul(.4)));
    return vec3(1, .98, .95).mul(gl).mul(near).mul(2.5); })();
  // the bump normal: two finite differences of the clumps and the grain, only near the camera
  m.normalNode = Fn(() => {
    const p = positionWorld.toVar(), d = length(p.sub(cameraPosition)), near = one.sub(smoothstep(700, 2600, d)).toVar(), e = float(.9);
    const hgt = q => clump(q).mul(1.6).add(mx_noise_float(q.mul(.42)).mul(.5));
    const h0 = hgt(p), hx = hgt(p.add(vec3(e, 0, 0))), hz = hgt(p.add(vec3(0, 0, e)));
    const k = near.mul(.9).mul(one.add(one.sub(clamp(normalWorld.y, 0, 1)).mul(2)));
    const Nw = normalize(normalWorld.add(vec3(h0.sub(hx).mul(k), 0, h0.sub(hz).mul(k))));
    return transformNormalToView(Nw);
  })();
  m.roughnessNode = Fn(() => { const mk2 = attribute('mask', 'vec4'); return float(.96).sub(mk2.z.mul(.2)).sub(mk2.y.mul(.18)); })();
  return m;
}
// the plain beyond the field: the biome's base ground, broken by the same clumps, fading into the haze
export function skirtMaterial(B) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const base = col3(B.ground[0]).mul(.72).add(col3(B.ground[1]).mul(.1));
  m.colorNode = Fn(() => { const p = positionWorld, near = one.sub(smoothstep(2000, 9000, length(p.sub(cameraPosition)))); return base.mul(one.add(mx_fractal_noise_float(p.mul(.0012), 2, 2, .5, 1).mul(.12).mul(near.mul(.6).add(.4))).add(mx_noise_float(p.mul(.03)).mul(.08).mul(near))); })();
  return m;
}

// ---------------------------------------------------------------- the water
// Depth from the height grid (a texture): shallows pale toward the sand, foam along the waterline, two drifting
// noise layers for the surface normal so the Sun breaks into glitter
export function waterMaterial(M, B) {
  const W = NH + 1, data = new Uint16Array(W * W); for (let i = 0; i < W * W; i++) data[i] = THREE.DataUtils.toHalfFloat(M.H[i]); // half floats: filterable on every WebGPU adapter, 32-bit floats are not
  const ht = new THREE.DataTexture(data, W, W, THREE.RedFormat, THREE.HalfFloatType); ht.minFilter = ht.magFilter = THREE.LinearFilter; ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping; ht.needsUpdate = true;
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: .08, metalness: .08, depthWrite: false });
  const deep = col3(B.water), shallow = col3(B.water).mul(.5).add(col3(B.ground[3]).mul(.5)), seaH = float(M.seaH);
  const depthAt = p => { const q = p.xz.div(MAP), inside = step(0, q.x).mul(step(q.x, 1)).mul(step(0, q.y)).mul(step(q.y, 1)); return mix(float(60), seaH.sub(texture(ht, clamp(q, 0, 1)).r), inside); }; // open sea beyond the field
  const wave = p => mx_noise_float(vec3(p.x.mul(.09).add(T.mul(.5)), p.z.mul(.11).sub(T.mul(.35)), T.mul(.12))).mul(.6)
    .add(mx_noise_float(vec3(p.x.mul(.027).sub(T.mul(.2)), p.z.mul(.021).add(T.mul(.25)), T.mul(.05))));
  const dep = depthAt(positionWorld).toVar();
  m.colorNode = Fn(() => {
    const p = positionWorld, dk = smoothstep(0, 28, dep), c = mix(shallow, deep, dk).toVar(), near = one.sub(smoothstep(1500, 7000, length(p.sub(cameraPosition)))); // the detail fades before it can shimmer in the distance
    const foamN = mx_noise_float(vec3(p.x.mul(.3), p.z.mul(.3), T.mul(.4))).mul(.5).add(.5), line = smoothstep(3.5, .2, dep).mul(smoothstep(.35, .75, foamN.add(sin(dep.mul(2.2).sub(T.mul(1.5))).mul(.15))));
    c.assign(mix(c, vec3(.9, .92, .9), line.mul(.7).mul(near)));
    c.mulAssign(one.add(wave(p).mul(.06).mul(near)));
    c.mulAssign(one.sub(cloudShadow(p).mul(.3)));
    return c;
  })();
  m.opacityNode = Fn(() => clamp(float(.5).add(dep.mul(.035)), .45, .9))();
  m.roughnessNode = Fn(() => float(.07).add(smoothstep(3.5, .2, dep).mul(.5)))();
  m.normalNode = Fn(() => {
    const p = positionWorld, d = length(p.sub(cameraPosition)), near = one.sub(smoothstep(1200, 6000, d)), e = float(.7);
    const h0 = wave(p), hx = wave(p.add(vec3(e, 0, 0))), hz = wave(p.add(vec3(0, 0, e))), k = near.mul(.5);
    return transformNormalToView(normalize(vec3(h0.sub(hx).mul(k), 1, h0.sub(hz).mul(k))));
  })();
  return m;
}

// ---------------------------------------------------------------- the sky
// A dome round the camera: horizon haze to zenith, the Sun's disc and glare, drifting clouds where the world has
// weather, stars where it has next to no air. Per-world looks sit on top of the biome's own sky and fog colours.
const SKY = {
  mercury: { zen: '#5f7fb4', cover: .22, stars: 0, haze: .6 }, venus: { zen: '#8c8a78', cover: .78, stars: 0, haze: 1 }, earth: { zen: '#2f5fa8', cover: .45, stars: 0, haze: .5 },
  mars: { zen: '#5c4a5a', cover: .14, stars: .12, haze: .8 }, luna: { zen: '#2a4e9a', cover: .3, stars: 0, haze: .35 } /* terraformed: a thin, high blue sky */, phobos: { zen: '#030308', cover: 0, stars: 1, haze: .1 },
  deimos: { zen: '#030308', cover: 0, stars: 1, haze: .1 }, _ice: { zen: '#0a1222', cover: .08, stars: .8, haze: .35 } };
// what hangs in the sky: the Earth over Hyperion, Mars filling the sky over the Hive, Jupiter over Sungrave, Saturn over Titan
// (dir: where it hangs; r: its angular radius in radians; band: a banded giant)
const PARENT = {
  luna: { dir: [.3, .22, .93], r: .034, col: '#4d7fc4', atmo: '#8fb8ff', band: 0, day: 1 }, // seen through Luna's own daytime sky, as the Moon is from Earth phobos: { dir: [-.2, .22, .95], r: .36, col: '#b86a3e', atmo: '#e0a070', band: 0 }, deimos: { dir: [-.2, .22, .95], r: .11, col: '#b86a3e', atmo: '#e0a070', band: 0 },
  io: { dir: [.15, .22, .95], r: .17, col: '#c9a37e', atmo: '#e8d0b0', band: 1 }, europa: { dir: [.15, .22, .95], r: .1, col: '#c9a37e', atmo: '#e8d0b0', band: 1 }, ganymede: { dir: [.15, .22, .95], r: .065, col: '#c9a37e', atmo: '#e8d0b0', band: 1 },
  callisto: { dir: [.15, .22, .95], r: .038, col: '#c9a37e', atmo: '#e8d0b0', band: 1 }, titan: { dir: [.4, .22, .9], r: .05, col: '#d8c49a', atmo: '#f0e0b8', band: 1 }, triton: { dir: [0, .22, .97], r: .07, col: '#3a58c8', atmo: '#7090e0', band: 1 } };
export function skyDome(sc, B, world, sunLight) {
  const K = SKY[world] || SKY[Object.keys(BIOME).find(k => BIOME[k] === B)] || SKY._ice, PAR = PARENT[world] || null, sky = new THREE.Color(B.sky), fog = new THREE.Color(B.fog), bright = sky.r * .3 + sky.g * .55 + sky.b * .15;
  const ca2 = (a, b) => dot(a, b);
  const zen = new THREE.Color(K.zen), hor = fog.clone().lerp(sky, .35).multiplyScalar(K.stars >= .8 ? .3 : 1), sunC = new THREE.Color(B.sun); // an airless horizon is nearly as black as its zenith
  const dir = sunLight.position.clone().sub(sunLight.target.position).normalize(); sunDirU.value.copy(dir); coverU.value = K.cover; for (const e of scorchA.array) e.set(0, 0, 0, -1e9);
  const geo = new THREE.SphereGeometry(26000, 48, 24), m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const zenV = vec3(zen.r, zen.g, zen.b), horV = vec3(hor.r, hor.g, hor.b), sunV = vec3(sunC.r, sunC.g, sunC.b), starK = float(K.stars), cover = K.cover;
  m.colorNode = Fn(() => {
    const d = normalize(positionWorld.sub(cameraPosition)).toVar(), y = d.y.toVar();
    const t = pow(clamp(y, 0, 1), .62), c = mix(horV, zenV, t).toVar();
    c.assign(mix(horV.mul(.72), c, smoothstep(-.1, .015, y))); // under the horizon: the haze, darker
    // the Sun: a disc, a tight glare, and a wide warm glow that the haze spreads
    const ca = dot(d, sunDirU).toVar(), cp = max(ca, 0);
    const disc = smoothstep(.99955, .99985, ca), glare = pow(cp, 220).mul(.55).add(pow(cp, 14).mul(.16 + .14 * K.haze)).add(pow(cp, 2.5).mul(.05 + .06 * K.haze).mul(one.sub(t)));
    c.addAssign(sunV.mul(disc.mul(2.2).add(glare)));
    // stars, where the air is thin: sparse points from a hashed lattice, hidden under the haze
    if (K.stars > 0) { const q = d.mul(260), cellId = floor(q), f = fract(q).sub(.5), hv = hash(cellId.x.mul(7.1).add(cellId.y.mul(131.7)).add(cellId.z.mul(1113.3)));
      const st = smoothstep(.985, 1, hv).mul(smoothstep(.22, .05, length(f))).mul(hash(cellId.x.add(cellId.z.mul(3))).mul(.7).add(.3));
      c.addAssign(vec3(1, .98, .95).mul(st).mul(starK).mul(1.3).mul(smoothstep(0, .12, y)).mul(one.sub(smoothstep(.9995, 1, ca)))); }
    // the world this one circles, hanging in the sky: a lit globe with its own terminator, limb darkening and a rim of air
    if (PAR) { const pd = normalize(vec3(...PAR.dir)), u = normalize(cross(pd, vec3(0, 1, 0))), v = cross(u, pd), sr = Math.sin(PAR.r), cr = Math.cos(PAR.r);
      const px = dot(d, u).div(sr), py = dot(d, v).div(sr), rr2 = px.mul(px).add(py.mul(py)).toVar(), inside = smoothstep(cr, cr + (1 - cr) * .04, ca2(d, pd)).toVar();
      const pz = sqrt(max(one.sub(rr2), 0)), N = u.mul(px).add(v.mul(py)).sub(pd.mul(pz)).toVar();
      const lit = max(dot(N, sunDirU).add(.08), 0).div(1.08).add(.035).toVar(), pc = col3(PAR.col).toVar(); // a little shine on the night side too
      if (PAR.band) { const bnd = sin(py.mul(11).add(mx_noise_float(vec3(px.mul(2.5), py.mul(8), 1)).mul(2.2)).add(px.mul(.6))).mul(.5).add(.5); pc.assign(mix(pc.mul(.74), pc.mul(1.14).add(.04), bnd).mul(one.add(mx_noise_float(vec3(px.mul(7), py.mul(24), 3)).mul(.07)))); }
      else pc.assign(mix(pc, pc.mul(1.5).add(.15), smoothstep(.45, .75, mx_fractal_noise_float(vec3(px.mul(2.2), py.mul(2.2), pz.mul(2.2)).mul(1.5), 3, 2, .5, 1).mul(.5).add(.5)).mul(.6))); // cloud and land on a rocky world
      pc.assign(pc.mul(lit.mul(.95).add(.02)).mul(float(.55).add(pz.mul(.45))));
      const rim = col3(PAR.atmo).mul(pow(one.sub(pz), 5)).mul(lit.mul(.6).add(.1));
      const pcol = PAR.day ? mix(pc.add(rim), c, .45).add(c.mul(.35)) : pc.add(rim); // by day the sky washes it out, like the Moon at noon
      c.assign(mix(c, pcol, inside.mul(smoothstep(-.02, .04, y))));
      if (!PAR.day) c.addAssign(col3(PAR.atmo).mul(pow(max(ca2(d, pd), 0), 1 / (PAR.r * PAR.r * 60) + 8)).mul(.035).mul(one.sub(inside))); } // a faint halo round it, on a dark sky
    // clouds: noise on the dome's ceiling, drifting; lit from the Sun's side, shadowed underneath
    if (cover > 0) { const cq = cameraPosition.xz.add(d.xz.div(max(y, .1)).mul(2600)).add(T.mul(9)), n = cloudN(cq); // fixed to the world, 2,600 m up, so the ground wears the same clouds' shadows
      const cv = cloudCover(n).mul(smoothstep(.04, .26, y)).toVar();
      const lit = horV.mul(.9).add(sunV.mul(.2)), dark = mix(horV, zenV, .5).mul(.55), cc = mix(dark, lit, smoothstep(.1, .9, n.add(ca.mul(.15))));
      c.assign(mix(c, cc, cv.mul(.85))); }
    return c;
  })();
  dome = new THREE.Mesh(geo, m); dome.renderOrder = -10; dome.frustumCulled = false; sc.add(dome);
  sc.background = null; sc.fog = new THREE.Fog(hor.clone().lerp(sky, .2), 3500 + (1 - K.haze) * 9000, 18000 + (1 - K.haze) * 50000); // next to no haze on an airless world
  return { dome, bright };
}

// ---------------------------------------------------------------- dust and scorches
// Puffs under moving formations: dust on dry ground, mud spray at the waterline, snow on the ice. A billboard batch
// of soft discs, one draw call; the rules' 'land' events (a shell or a dying machine hitting the ground) also throw a
// puff and leave a scorch in the terrain shader's slots.
const PUFF_N = 1600; let puffs = null, puffMesh = null;
function puffBatch() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const iP = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 3), 3), iS = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 3), 3), iC = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 3), 3);
  for (const a of [iP, iS, iC]) a.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iP', iP); g.setAttribute('iS', iS); g.setAttribute('iC', iC); g.instanceCount = 0;
  const m = new THREE.NodeMaterial(); m.transparent = true; m.depthWrite = false; m.lights = false;
  const aP = attribute('iP', 'vec3'), aS = attribute('iS', 'vec3'), aC = attribute('iC', 'vec3');
  m.vertexNode = Fn(() => { const c = cos(aS.z), s2 = sin(aS.z), q = positionGeometry.xy.mul(aS.x), r = vec2(c.mul(q.x).sub(s2.mul(q.y)), s2.mul(q.x).add(c.mul(q.y))); const mv = cameraViewMatrix.mul(vec4(aP, 1)).toVar(); return cameraProjectionMatrix.mul(vec4(mv.xy.add(r), mv.z, mv.w)); })();
  m.fragmentNode = Fn(() => { const vS = varying(aS), vC = varying(aC), d = length(uv().sub(.5)).mul(2), n = mx_noise_float(vec3(uv().mul(5), vS.z.mul(3))).mul(.5).add(.5);
    const a = smoothstep(1, .3, d.add(n.mul(.35))).mul(vS.y); return vec4(vC, a); })();
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 20; return mesh;
}
function puffColour(B, x, y) { if (B === BIOME._ice) return [.9, .93, .96]; const wet = G.map && G.map.seaH >= 0 && heightAt(x, y) < G.map.seaH + 2.5;
  const c = new THREE.Color(wet ? B.water : B.ground[3]); if (wet) c.lerp(new THREE.Color(B.ground[0]), .5).multiplyScalar(.7); else c.lerp(new THREE.Color(1, 1, 1), .12); return [c.r, c.g, c.b]; }
function puff(x, y, z, vx, vy, vz, size, life, col, al = .4) { if (!puffs) return; const p = puffs.find(p => p.life <= 0); if (!p) return; Object.assign(p, { x, y, z, vx, vy, vz, size, life, max: life, col, al, rot: Math.random() * 6.28 }); }
export function scorch(x, y, r) { const e = scorchA.array[scorchI]; e.set(x, y, r, T.value); scorchI = (scorchI + 1) % SCORCH_N; }
function dustTick(dt, camera) {
  if (!G.on || !G.units) return; const B = G.map && G.map.B; if (!B) return;
  if (!puffMesh && dome && dome.parent) { puffMesh = puffBatch(); dome.parent.add(puffMesh); puffs = Array.from({ length: PUFF_N }, () => ({ life: 0 })); }
  if (!puffs) return;
  const cx = camera.position.x, cz = camera.position.z, step = G.paused ? 0 : dt * (G.speed || 1);
  if (step > 0) {
    for (const u of G.units) { if (u.gone || u.men <= 0 || u.T.fly) continue; const sp = Math.hypot(u.vx, u.vy); if (sp < .6) continue; if (Math.hypot(u.x - cx, u.y - cz) > 2600) continue;
      const rate = Math.min(1, u.men / 300) * (2 + sp * .6) * step; if (Math.random() > rate) continue;
      const r = Math.max(6, Math.min(40, Math.sqrt(u.men) * 1.2)), a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * r, px = u.x + Math.cos(a) * d, py = u.y + Math.sin(a) * d;
      puff(px, heightAt(px, py) + 1, py, -u.vx * .25 + (Math.random() - .5) * 1.5, .9 + Math.random() * .8, -u.vy * .25 + (Math.random() - .5) * 1.5, 3 + Math.random() * 3, 1.6 + Math.random() * 1.2, puffColour(B, px, py), .32); }
    for (const f of G.fx) if (f.k === 'land') { const R = f.big ? 30 : 16; scorch(f.x, f.y, R); const h = heightAt(f.x, f.y), col = puffColour(B, f.x, f.y);
      for (let i = 0; i < (f.big ? 14 : 7); i++) { const a = Math.random() * 6.28, v = 4 + Math.random() * 10; puff(f.x + (Math.random() - .5) * 4, h + 2, f.y + (Math.random() - .5) * 4, Math.cos(a) * v, 5 + Math.random() * 9, Math.sin(a) * v, 4 + Math.random() * 6, 2 + Math.random() * 2, [col[0] * .55, col[1] * .5, col[2] * .45], .5); } }
  }
  const g = puffMesh.geometry, P = g.attributes.iP.array, Sz = g.attributes.iS.array, C = g.attributes.iC.array; let n = 0;
  for (const p of puffs) { if (p.life <= 0) continue; p.life -= step; if (p.life <= 0) continue; p.x += p.vx * step; p.y += p.vy * step; p.z += p.vz * step; p.vx *= 1 - step * .8; p.vz *= 1 - step * .8; p.vy *= 1 - step * 1.2;
    const k = p.life / p.max, grow = 1 + (1 - k) * 1.6; P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z; Sz[n * 3] = p.size * grow; Sz[n * 3 + 1] = p.al * Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 6 + .2); Sz[n * 3 + 2] = p.rot + (1 - k) * .6; C[n * 3] = p.col[0]; C[n * 3 + 1] = p.col[1]; C[n * 3 + 2] = p.col[2]; n++; }
  g.instanceCount = n; for (const k of ['iP', 'iS', 'iC']) { const a = g.attributes[k]; a.clearUpdateRanges(); a.addUpdateRange(0, n * 3); a.needsUpdate = true; }
}
// per frame: the clock, the dome follows the camera, dust and scorches
export function tick(dt, camera) { T.value += dt; if (dome) dome.position.copy(camera.position); dustTick(dt, camera); }
export function dispose() { dome = null; puffMesh = null; puffs = null; }
export const _dbg = () => ({ scorch: scorchA.array.map(v => v.toArray()), live: puffs ? puffs.filter(p => p.life > 0).length : -1, n: puffMesh ? puffMesh.geometry.instanceCount : -1, T: T.value, mesh: !!puffMesh, dome: !!dome, units: G.units ? G.units.filter(u => !u.gone && Math.hypot(u.vx, u.vy) > .6).length : -1 });
