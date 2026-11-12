// ---------------------------------------------------------------- how the ground war's figures move
// Owned by the animator chat (see claude/ownership.md and claude/ship-animation.md). The figures are built in
// groundmodels.js as one merged mesh per kind; this module gives each kind a small rig and poses every figure on the GPU,
// so thousands of soldiers can each walk, aim, recoil, swing and fall on their own without skinned meshes.
//
// How it works
// - Rig: per kind, the joints (hips, knees, waist, neck, shoulders, cape, banner) where the builders put them.
// - Bones: each part the builder merged (groundmodels records the part ranges in geometry.userData.parts) is tagged
//   with one bone by where it sits on the body, so a part never tears. Bones: 0 pelvis, 1/2 right thigh/shin,
//   3/4 left thigh/shin, 5 chest, 6 head, 7 right arm (and what it holds), 8 left arm, 9 cape, 10 banner.
// - Pose: the joint angles are worked out here on the CPU per figure (cheap: a few dozen numbers) and written to six
//   per-instance vec4s; the material's positionNode reads the model's own vertices, poses them bone by bone, then
//   places the figure itself (this three.js applies the instance matrix before positionNode, so the pose cannot be
//   layered on top of it). Normals follow the same rotations, and the shadow pass uses the same node.
//
// The motion, drawn from the books
// - Grays march in step, rifles at port when moving and shouldered when firing, each shot kicking the rifle up; in
//   melee they drive in with the rifle butt.
// - Obsidians lumber, the free arm swinging; in melee they wind the pulseAxe back over the shoulder and bring it down
//   with their whole body behind it.
// - Golds fight in the Willow Way ("flow around him; never retreat backward"): the razor sweeps in a figure of eight,
//   the torso turning with it, small steps that only ever go forward; their capes stream behind them, and when they
//   fly on gravBoots the legs trail and the body leans into the flight.
// - StarShells walk heavy, with a long roll from foot to foot; the pulseCannon arm bucks when it fires and the free
//   fist punches in melee.
// - Every figure breathes and looks about when it stands; a figure that dies buckles at the knees and topples forward,
//   then lies where it fell (handing over to groundview's corpse).
import * as THREE from 'three';
import { Fn, attribute, positionGeometry, normalGeometry, normalLocal, vec3, select, cos, sin, textureLoad, instanceIndex, ivec2, int } from 'three/tsl';

const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, k) => a + (b - a) * k, ease = k => k * k * (3 - 2 * k);

// ---------------------------------------------------------------- the rigs (model metres, +Z forward, Y up)
// classify(c, s): c = the part's centre, s = its size; returns the bone
const GRAY = {
  hipR: [.13, .96, 0], hipL: [-.13, .96, 0], kneeR: [.14, .5, .08], kneeL: [-.14, .5, -.04], waist: [0, 1.04, 0], neck: [0, 1.6, 0],
  shR: [0, 1.48, .02], shL: [0, 1.48, .02], cape: [0, 0, 0], banner: [0, 0, 0], leg: .92, style: 'gray',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[1] < .53 && Math.abs(c[0]) > .05) return side ? 2 : 4;
    if (c[1] < .97 && Math.abs(c[0]) > .05) return side ? 1 : 3;
    if (Math.abs(c[0]) > .05 && c[2] > .03 && c[1] > 1.04 && c[1] < 1.46) return 7; // both arms and the rifle: one group
    if (c[1] > 1.6 && Math.abs(c[0]) < .15) return 6;
    return c[1] < 1.04 ? 0 : 5;
  },
};
const OBS = {
  hipR: [.19, 1.32, 0], hipL: [-.19, 1.32, 0], kneeR: [.2, .72, .07], kneeL: [-.2, .72, -.05], waist: [0, 1.5, 0], neck: [0, 2.42, 0],
  shR: [.5, 2.22, 0], shL: [-.5, 2.22, 0], cape: [0, 0, 0], banner: [0, 0, 0], leg: 1.3, style: 'obs',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[1] > 2.28 && Math.abs(c[0]) > .35 && Math.abs(c[2]) < .15) return 5; // pauldrons and tusks ride the chest (the axe head, further forward, does not)
    if (c[1] < .78 && Math.abs(c[0]) > .08) return side ? 2 : 4;
    if (c[1] < 1.33 && Math.abs(c[0]) > .08) return side ? 1 : 3;
    if (c[0] > .3 && c[1] > 1.2) return 7;                                   // the axe arm, the haft and the head
    if (c[0] < -.3 && c[1] > 1.2 && c[1] < 2.25) return 8;                   // the pistol arm
    if (c[1] > 2.44 && s[0] < .5) return 6;                                  // helm, mask, braids
    return c[1] < 1.52 ? 0 : 5;
  },
};
const GOLD = {
  hipR: [.12, 1.02, 0], hipL: [-.12, 1.02, 0], kneeR: [.13, .56, .04], kneeL: [-.13, .56, -.03], waist: [0, 1.14, 0], neck: [0, 1.78, 0],
  shR: [.27, 1.66, .02], shL: [-.27, 1.66, .02], cape: [0, 1.72, -.2], banner: [-.46, 3.08, -.2], leg: 1.0, style: 'gold',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[2] < -.18 && Math.abs(c[0]) < .12 && s[0] > .4 && c[1] < 1.62) return 9;                  // the cape
    if (c[0] < -.4 && c[2] < -.3 && c[1] > 2.3 && c[1] < 3.0) return 10;                           // the banner cloth
    if (c[1] < .6 && Math.abs(c[0]) > .05 && Math.abs(c[2]) < .3) return side ? 2 : 4;
    if (c[1] < 1.04 && Math.abs(c[0]) > .05 && Math.abs(c[0]) < .3 && Math.abs(c[2]) < .3) return side ? 1 : 3; // (the razor, reaching forward past the knee, is the arm's)
    if (c[0] > .2 && c[2] > .05 && c[1] < 1.62) return 7;                                          // razor arm
    if (c[0] < -.2 && c[2] > .05 && c[1] < 1.62) return 8;                                         // pulseFist arm
    if (c[1] > 1.8 && Math.abs(c[0]) < .2) return 6;
    return c[1] < 1.15 ? 0 : 5;
  },
};
const SHELL = {
  hipR: [.3, 1.86, 0], hipL: [-.3, 1.86, 0], kneeR: [.33, 1.04, .06], kneeL: [-.33, 1.04, 0], waist: [0, 2.12, 0], neck: [0, 3.36, 0],
  shR: [.64, 3.1, 0], shL: [-.64, 3.1, 0], cape: [0, 0, 0], banner: [0, 0, 0], leg: 1.8, style: 'shell',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[1] < 1.16 && Math.abs(c[0]) > .1) return side ? 2 : 4;
    if (c[1] < 1.78 && Math.abs(c[0]) > .1 && Math.abs(c[0]) < .45) return side ? 1 : 3;
    if (c[0] > .55 && c[1] < 3.05) return 7;                                  // the pulseCannon arm
    if (c[0] < -.55 && c[1] < 3.05) return 8;                                 // the fist
    if (c[1] > 3.38 && Math.abs(c[0]) < .3) return 6;
    return c[1] < 2.1 ? 0 : 5;
  },
};
export const RIG = { inf: GRAY, rail: GRAY, obs: OBS, gold: GOLD, lead: GOLD, shell: SHELL };
export const rigged = k => !!RIG[k];

// ---------------------------------------------------------------- tagging the parts with bones
const _bb = new THREE.Box3();
export function tagBones(geo, kind) {
  if (geo.attributes.bone) return geo;
  const R = RIG[kind], n = geo.attributes.position.count, bone = new Float32Array(n), parts = geo.userData.parts, P = geo.attributes.position;
  if (R && parts && parts.length) {
    let o = 0;
    for (const cnt of parts) {
      _bb.makeEmpty(); for (let i = o; i < o + cnt; i++) _bb.expandByPoint(new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)));
      const c = [(_bb.min.x + _bb.max.x) / 2, (_bb.min.y + _bb.max.y) / 2, (_bb.min.z + _bb.max.z) / 2], s = [_bb.max.x - _bb.min.x, _bb.max.y - _bb.min.y, _bb.max.z - _bb.min.z];
      bone.fill(R.classify(c, s), o, o + cnt); o += cnt;
    }
  }
  geo.setAttribute('bone', new THREE.BufferAttribute(bone, 1));
  return geo;
}

// ---------------------------------------------------------------- the pose on the GPU
// six vec4s per figure, kept in a float texture (64 figures to a row) and read by instance index, since the vertex
// attributes are already near the limit of 16 (position, normal, paint, team and glow masks, bone, the instance matrix
// and colour): A0 = place (x, y, z, yaw); A1 = thigh R, knee R, thigh L, knee L; A2 = waist twist, waist lean,
// head yaw, cape; A3 = right arm pitch, yaw, thrust, left arm pitch; A4 = left arm yaw, thrust, pelvis drop, pelvis roll;
// A5 = fall (pitch about the feet), banner, scale, head nod
const NV = 6, PER_ROW = 64;
const v3 = a => vec3(a[0], a[1], a[2]);
const rX = (p, c, s) => vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
const rY = (p, c, s) => vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s)));
const rZ = (p, c, s) => vec3(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)), p.z);
export function animMesh(im, kind) {
  const R = RIG[kind]; if (!R) return false;
  tagBones(im.geometry, kind);
  const cap = im.instanceMatrix.count, rows = Math.max(1, Math.ceil(cap / PER_ROW)), data = new Float32Array(PER_ROW * NV * rows * 4);
  const tex = new THREE.DataTexture(data, PER_ROW * NV, rows, THREE.RGBAFormat, THREE.FloatType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const ii = int(instanceIndex), row = ii.div(PER_ROW), col = ii.mod(PER_ROW).mul(NV);
  const A = []; for (let v = 0; v < NV; v++) A.push(textureLoad(tex, ivec2(col.add(v), row)));
  const HR = v3(R.hipR), HL = v3(R.hipL), KR = v3(R.kneeR), KL = v3(R.kneeL), W = v3(R.waist), NK = v3(R.neck), SR = v3(R.shR), SL = v3(R.shL), CP = v3(R.cape), BP = v3(R.banner);
  const m = im.material;
  m.positionNode = Fn(() => {
    const b = attribute('bone', 'float'), a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5];
    const p = positionGeometry.toVar(), n = normalGeometry.toVar();
    const rot = (cond, piv, fn, c, s) => { p.assign(select(cond, fn(p.sub(piv), c, s).add(piv), p)); n.assign(select(cond, fn(n, c, s), n)); };
    // the shins about the knees, then the whole leg about the hip
    const isR = b.equal(1).or(b.equal(2)), isShin = b.equal(2).or(b.equal(4)), isLeg = b.greaterThan(.5).and(b.lessThan(4.5));
    const kA = select(isR, a1.y, a1.w), tA = select(isR, a1.x, a1.z);
    rot(isShin, select(isR, KR, KL), rX, cos(kA), sin(kA));
    rot(isLeg, select(isR, HR, HL), rX, cos(tA), sin(tA));
    // the arms about the shoulders (pitch, then swing), then their thrust along the body's forward line
    const isAR = b.equal(7), isArm = isAR.or(b.equal(8)), aP = select(isAR, a3.x, a3.w), aY = select(isAR, a3.y, a4.x), aZ = select(isAR, a3.z, a4.y), Sp = select(isAR, SR, SL);
    rot(isArm, Sp, rX, cos(aP), sin(aP)); rot(isArm, Sp, rY, cos(aY), sin(aY)); p.assign(select(isArm, p.add(vec3(0, 0, aZ)), p));
    // the head looks about and nods; the cape streams; the banner swings
    const isH = b.equal(6); rot(isH, NK, rY, cos(a2.z), sin(a2.z)); rot(isH, NK, rX, cos(a5.w), sin(a5.w));
    rot(b.equal(9), CP, rX, cos(a2.w), sin(a2.w));
    const bn = a5.y; rot(b.equal(10), BP, rZ, cos(bn), sin(bn)); rot(b.equal(10), BP, rX, cos(bn.mul(.7)), sin(bn.mul(.7)));
    // everything above the waist turns and leans at the waist
    const up = b.greaterThan(4.5); rot(up, W, rY, cos(a2.x), sin(a2.x)); rot(up, W, rX, cos(a2.y), sin(a2.y));
    // the whole figure: the weight shifting side to side, the pelvis riding the stride, the fall about the feet
    rot(b.greaterThan(-1), W, rZ, cos(a4.w), sin(a4.w)); p.assign(p.add(vec3(0, a4.z, 0)));
    rot(b.greaterThan(-1), vec3(0, 0, 0), rX, cos(a5.x), sin(a5.x));
    // placed: scaled, turned to face, set down
    const cy = cos(a0.w), sy = sin(a0.w);
    normalLocal.assign(rY(n, cy, sy));
    return rY(p.mul(a5.z), cy, sy).add(a0.xyz);
  })();
  m.needsUpdate = true;
  im.userData.anim = { tex, data, kind, rig: R };
  return true;
}

// ---------------------------------------------------------------- the per-figure motion (CPU)
const U = new Map();   // per unit: stride phase, gait, turn, melee and fire phases
const Q = new Float32Array(NV * 4);
// the cycle of a melee blow: wind up, strike, recover (k in 0..1) → −1 (wound back) … +1 (struck through)
const blow = (k, up = .45, hit = .14) => k < up ? -ease(k / up) : k < up + hit ? lerp(-1, 1, ease((k - up) / hit)) : lerp(1, 0, ease((k - up - hit) / (1 - up - hit)));
const pulse = (k, w = .12) => k < w ? k / w : Math.exp(-(k - w) * 9);
// advance one unit's clocks (once per game step, before its figures are posed)
function unitClock(u, t, kind, scale) {
  let s = U.get(u.id); if (!s) { s = { ph: Math.random() * TAU, g: 0, a: u.a, turn: 0, mph: Math.random(), fire: 0, fly: 0, mel: 0, t }; U.set(u.id, s); }
  const dt = Math.max(0, Math.min(.1, t - s.t)); s.t = t; if (dt <= 0) return s;
  const R = RIG[kind], L = R.leg * scale, T = u.T || {}, ca = Math.cos(u.a), sa = Math.sin(u.a);
  const v = Math.hypot(u.vx || 0, u.vy || 0), along = (u.vx || 0) * ca + (u.vy || 0) * sa;
  let da = u.a - s.a; da -= TAU * Math.round(da / TAU); s.a = u.a; s.turn += (clamp(Math.abs(da) / Math.max(dt, 1e-3), 0, 2) - s.turn) * (1 - Math.exp(-dt * 6));
  const flying = (kind === 'gold' || kind === 'lead') && v > 8;
  s.fly += ((flying ? 1 : 0) - s.fly) * (1 - Math.exp(-dt * 3));
  // stride: the swing amplitude grows from a walk to a run, and the cadence is set so the feet don't slide
  const walk = T.walk || 3, run = T.run || walk * 2, k = clamp((v - walk) / Math.max(.1, run - walk), 0, 1), A = lerp(.28, .5, k);
  const gT = v > .3 && !flying ? clamp(v / walk, .35, 1) + k * .5 : s.turn > .25 ? .35 : 0; // shuffling round when turning on the spot
  s.g += (gT - s.g) * (1 - Math.exp(-dt * 5)); s.A = A;
  const f = v > .3 ? v / (4 * L * Math.sin(A)) : .8;  // cycles a second
  s.ph += TAU * f * dt * (along < -.3 ? -1 : 1);       // walking backward plays the stride backward
  s.mel += ((u.melee ? 1 : 0) - s.mel) * (1 - Math.exp(-dt * 6));
  s.fire += ((u.firing || u.state === 'fire' ? 1 : 0) - s.fire) * (1 - Math.exp(-dt * 4));
  s.run = k; return s;
}
// write one figure: (x, y, z) its feet, yaw as groundview turns it, n its index in the unit, h a stable 0..1 hash
export function animFigure(im, i, x, y, z, yaw, u, kind, n, h, scale, t) {
  const D = im.userData.anim; if (!D) return false;
  const s = unitClock(u, t, kind, scale), R = D.rig, st = R.style, q = Q; q.fill(0);
  // the gait: Grays keep step across the cohort (a little ragged), the others each their own
  const ph = s.ph + (st === 'gray' ? (h - .5) * .5 : h * TAU), g = s.g, A = (s.A || .3) * Math.min(1, g), sn = Math.sin(ph), cs = Math.cos(ph);
  const kb = .06 + .14 * s.fire * (1 - Math.min(1, g)), K = (.5 + .35 * (s.run || 0)) * Math.min(1, g);
  q[4] = -A * sn; q[5] = kb + K * Math.max(0, cs) ** 1.5; q[6] = A * sn; q[7] = kb + K * Math.max(0, -cs) ** 1.5;
  let drop = -R.leg * (1 - Math.cos(A * Math.abs(sn))) - R.leg * .45 * (1 - Math.cos(kb)), roll = .035 * g * sn * (st === 'shell' ? 2 : st === 'obs' ? 1.5 : 1);
  if ((s.run || 0) > .3) drop += R.leg * .05 * s.run * Math.abs(Math.sin(ph * 2)); // the run's lift off the ground
  let twist = .1 * g * sn, lean = .04 * Math.min(1, g) + .16 * (s.run || 0) * Math.min(1, g), head = 0, nod = 0, cape = .08, banner = 0;
  let aRp = 0, aRy = 0, aRz = 0, aLp = 0, aLy = 0, aLz = 0;
  // standing: breathing, a weight shift, looking about
  const idle = 1 - Math.min(1, g), br = Math.sin(t * 1.7 + h * 20);
  lean += .012 * br * idle; head += idle * (.35 * Math.sin(t * .37 + h * 31) * Math.sin(t * .13 + h * 7)); roll += idle * .015 * Math.sin(t * .29 + h * 13);
  // firing: braced, each shot kicking the weapon (own rate, own moment)
  const rate = st === 'gray' ? (kind === 'rail' ? .3 : .75) : st === 'shell' ? .5 : st === 'obs' ? .9 : 1, rk = pulse(((t * rate + h * 7.3) % 1 + 1) % 1) * s.fire;
  if (st === 'gray') { aRp = .3 * g * (1 - s.fire) + .03 * Math.sin(ph * 2) * g - (kind === 'rail' ? .2 : .13) * rk + .01 * br * idle; aRz = -.05 * rk; lean -= .03 * rk; }
  if (st === 'obs') { aLp = -.45 * g * sn - .5 * s.fire + .25 * rk; aRp = .06 * Math.sin(ph * 2) * g; } // the free arm swings; the pistol comes up to fire
  if (st === 'gold') { aRp = .25 * g * sn * (1 - s.fly); aLp = -.25 * g * sn * (1 - s.fly) + .2 * rk; aLz = -.04 * rk; }                // the pulseFist bucks
  if (st === 'shell') { aLp = -.3 * g * sn; aRp = .06 * Math.sin(ph * 2) * g - .3 * rk; aRz = -.08 * rk; lean -= .04 * rk; twist += .05 * rk; }
  // melee: each figure on its own beat
  if (s.mel > .02) {
    const m = s.mel, mk = ((t / (st === 'obs' ? 1.5 : st === 'gold' ? 1.3 : st === 'shell' ? 1.6 : 1.1) + h * 3.7) % 1 + 1) % 1;
    if (st === 'gray') { const b = blow(mk, .4, .12); aRz += m * (b > 0 ? .32 * b : .1 * b); aRp += m * (-.15 * b); lean += m * .16 * Math.max(0, b); q[4] -= m * .2 * Math.max(0, b); twist += m * .12 * b; }
    if (st === 'obs') { const b = blow(mk, .5, .12); aRp = lerp(aRp, b < 0 ? -1.0 * -b : 1.1 * b, m); lean += m * (b < 0 ? -.18 * -b : .32 * b); twist += m * -.25 * b; q[4] -= m * .25 * Math.max(0, b); q[5] += m * .3 * Math.max(0, b); aLp = lerp(aLp, -.3, m); }
    if (st === 'gold') { // the Willow Way: the razor's figure of eight, the body turning with it, stepping only forward
      const w = TAU * mk; aRy = lerp(aRy, 1.05 * Math.sin(w), m); aRp = lerp(aRp, -.55 * Math.sin(2 * w) - .2, m); twist += m * .4 * Math.sin(w - .4); lean += m * .1;
      aLp = lerp(aLp, -.5 + .15 * Math.sin(w + 1), m); q[4] -= m * .18 * Math.max(0, Math.sin(w)); q[5] += m * .25 * Math.max(0, Math.sin(w)); }
    if (st === 'shell') { const b = blow(mk, .45, .1); aLp = lerp(aLp, b < 0 ? .35 * -b : -.9 * b, m); aLz += m * .45 * Math.max(0, b); twist += m * -.25 * b; lean += m * .12 * Math.max(0, b); }
  }
  // flight on gravBoots: legs trail, the body leans into it, the cape streams
  if (s.fly > .02) { const f = s.fly; q[4] = lerp(q[4], .35, f); q[6] = lerp(q[6], .45, f); q[5] = lerp(q[5], .7, f); q[7] = lerp(q[7], .9, f); lean = lerp(lean, .38, f); drop *= 1 - f; roll = lerp(roll, .08 * Math.sin(t * 1.1 + h * 9), f); }
  if (R.cape[1]) { const v = Math.hypot(u.vx || 0, u.vy || 0); cape = Math.min(.75, .1 + .45 * Math.min(1, v / 7) + .2 * s.fly + .07 * Math.sin(t * 6 + h * 17) * (.3 + Math.min(1, v / 5)) + .1 * s.mel * Math.sin(t * 9 + h)); } // streams back, never past 43° (the cape is a rigid plate)
  if (kind === 'lead') banner = .08 * Math.sin(t * 1.3 + h * 5) + .25 * Math.min(1, Math.hypot(u.vx || 0, u.vy || 0) / 6);
  q[0] = x; q[1] = y; q[2] = z; q[3] = yaw;
  q[8] = twist; q[9] = lean; q[10] = head; q[11] = cape;
  q[12] = aRp; q[13] = aRy; q[14] = aRz; q[15] = aLp; q[16] = aLy; q[17] = aLz; q[18] = drop; q[19] = roll;
  q[20] = 0; q[21] = banner; q[22] = scale; q[23] = nod;
  write(D, i, q); return true;
}
function write(D, i, q) { const o = ((Math.floor(i / PER_ROW) * PER_ROW + i % PER_ROW) * NV) * 4, a = D.data; for (let k = 0; k < NV * 4; k++) a[o + k] = q[k]; }
export function animEnd(meshes) { for (const k in meshes) { const D = meshes[k].userData.anim; if (D) D.tex.needsUpdate = true; } }
export function animReset() { U.clear(); DY.length = 0; }

// ---------------------------------------------------------------- the dying: they buckle, topple forward and lie still
const DY = [], FALL = .95;
export function dyingAdd(f, team, kind, col, scale, t) {
  if (!RIG[kind] || DY.length > 600) return false;
  DY.push({ x: f[0], y: f[1], z: f[2], yaw: f[3] + (Math.random() - .5) * 1.2, kind, team, col, t0: t, h: Math.random(), scale }); return true;
}
// draw the dying into the near meshes after the living (cnt: the next free index per kind); when one has fallen, hand it
// to corpse(f, team): f = [x, y, z, yaw] where the corpse model (feet at −0.95 m) lies along the fallen figure
export function drawDying(meshes, cnt, t, corpse) {
  for (let j = DY.length - 1; j >= 0; j--) {
    const d = DY[j], k = (t - d.t0) / FALL, im = meshes[d.kind];
    if (k >= 1 || k < 0 || !im || cnt[d.kind] >= im.instanceMatrix.count) {
      const fw = 1.1 * d.scale * (RIG[d.kind].leg / .92); corpse([d.x + Math.sin(d.yaw) * fw, d.y, d.z + Math.cos(d.yaw) * fw, d.yaw], d.team); DY.splice(j, 1); continue; }
    const D = im.userData.anim, i = cnt[d.kind]++, q = Q; q.fill(0);
    const crumple = ease(Math.min(1, k / .3)), top = Math.max(0, (k - .2) / .8), fall = top * top * (PI / 2) * 1.0, straight = ease(Math.min(1, top * 1.3));
    q[0] = d.x; q[1] = d.y; q[2] = d.z; q[3] = d.yaw;
    q[4] = q[6] = -.5 * crumple * (1 - straight); q[5] = q[7] = 1.1 * crumple * (1 - straight);
    q[18] = -RIG[d.kind].leg * .35 * crumple * (1 - straight);
    q[12] = -1.1 * Math.sin(k * PI) + .6 * straight; q[15] = -1.3 * Math.sin(k * PI * .9) + .5 * straight; // the arms thrown out
    q[9] = .25 * crumple; q[10] = .4 * (d.h - .5) * crumple; q[11] = .3 + .5 * crumple; q[23] = .3 * crumple;
    q[20] = fall; q[22] = d.scale;
    im.setColorAt(i, d.col); write(D, i, q);
  }
}
