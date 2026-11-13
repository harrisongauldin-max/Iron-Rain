// ---------------------------------------------------------------- how the ground war's figures move
// Owned by the animator chat (see claude/ownership.md and claude/ship-animation.md). The figures are built in
// groundmodels.js as one merged mesh per kind; this module gives each kind a small rig and poses every figure on the GPU,
// so thousands of soldiers can each walk, aim, recoil, swing and fall on their own without skinned meshes.
//
// How it works
// - Rig: per kind, the joints (hips, knees, ankles, waist, neck, shoulders, elbows, cape, banner) where the builders put
//   them. Bones: 0 pelvis, 1/2/11 right thigh/shin/foot, 3/4/12 left thigh/shin/foot, 5 chest, 6 head, 7/13 right upper
//   arm/forearm (and what the hand holds), 8/14 left upper arm/forearm, 9 cape, 10 banner. Each part the builder merged
//   (groundmodels records the part ranges in geometry.userData.parts) is tagged with one bone, so a part never tears.
// - Pose: the joint angles are worked out here per figure and kept in a float texture read by instance index; the
//   material's positionNode poses the model's own vertices joint by joint (foot → knee → hip; forearm → shoulder;
//   spine; pelvis), then places the figure itself. Normals follow, and the shadow pass uses the same node.
//
// The gait (from human gait measurements, scaled up a little so it reads at battle distance)
// - Hip: flexed ~30° at heel strike, extended ~10° at toe-off; knee: a ~15° give as the foot takes the weight, nearly
//   straight in mid-stance, ~60° in the swing (≈100° running); ankle: toes up at heel strike, foot flat through the
//   stance, heel rising to push off, toes lifted to clear in the swing.
// - The pelvis height comes from the legs themselves (the planted foot stays on the ground), so the body rises over
//   the stance leg and dips at the double support, as people do. The pelvis turns with the swinging leg, tilts down on
//   the swing side and shifts over the stance foot; the chest turns against it, the spine bends against the tilt, and
//   the head stays level and looking ahead. Free arms swing against the legs with the elbows bending on the way
//   forward, a beat behind the legs.
// - Cadence is set by the speed so the planted foot does not skate; every figure has its own size of stride and pace
//   (Grays keep step within a few percent).
// - Standing is never still: the weight shifts from foot to foot every several seconds with the other knee relaxing,
//   the chest rises with each breath, the head turns to look and holds, and now and then a soldier shifts his grip.
//
// The motion, drawn from the books
// - Grays march in step, rifles at port when moving and shouldered when firing, each shot kicking the rifle and the
//   shoulders back; in melee they drive in with the rifle butt.
// - Obsidians lumber with a heavy roll, the axe sloped on the shoulder and the free arm swinging; in melee they wind
//   the pulseAxe back over the shoulder and bring it down with the whole body, the forearm whipping through last.
// - Golds fight in the Willow Way ("flow around him; never retreat backward"): the razor sweeps in a figure of eight,
//   the hips and torso turning with it, small steps only forward; capes stream, and in gravBoot flight the legs trail.
// - StarShells walk heavy, every stride a long roll; the pulseCannon arm bucks when it fires and the free fist punches.
// - A figure that dies is struck back, buckles at the knees, slumps and topples forward, then lies where it fell.
import * as THREE from 'three';
import { Fn, attribute, positionGeometry, normalGeometry, normalLocal, vec3, select, cos, sin, textureLoad, instanceIndex, ivec2, int } from 'three/tsl';
import { G, heightAt } from './ground.js';
import { MUZZLE } from './groundmodels.js'; // read-only: the units (for aim, shots and hits) and the ground under the feet

const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, k) => a + (b - a) * k, ease = k => k * k * (3 - 2 * k);
const fract = x => x - Math.floor(x);
const hash = (a, b = 0) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
const gauss = (c, m, w) => { let d = c - m; d -= Math.round(d); return Math.exp(-(d * d) / (2 * w * w)); }; // on the cycle

// ---------------------------------------------------------------- the rigs (model metres, +Z forward, Y up)
// classify(c, s): c = the part's centre, s = its size; returns the bone
const GRAY = {
  hipR: [.13, .96, 0], hipL: [-.13, .96, 0], kneeR: [.14, .5, .08], kneeL: [-.14, .5, -.04], ankR: [.14, .1, .1], ankL: [-.14, .1, -.07],
  waist: [0, 1.04, 0], neck: [0, 1.6, 0], shR: [0, 1.48, .02], shL: [0, 1.48, .02], elR: [0, 0, 0], elL: [0, 0, 0],
  cape: [0, 0, 0], banner: [0, 0, 0], leg: .92, toe: .17, heel: .07, style: 'gray',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[1] < .12 && Math.abs(c[0]) > .05) return side ? 11 : 12;
    if (c[1] < .53 && Math.abs(c[0]) > .05) return side ? 2 : 4;
    if (c[1] < .97 && Math.abs(c[0]) > .05) return side ? 1 : 3;
    if (Math.abs(c[0]) > .05 && c[2] > .03 && c[1] > 1.04 && c[1] < 1.46) return 7; // both arms and the rifle: one group
    if (c[1] > 1.6 && Math.abs(c[0]) < .15) return 6;
    return c[1] < 1.04 ? 0 : 5;
  },
};
const OBS = {
  hipR: [.19, 1.32, 0], hipL: [-.19, 1.32, 0], kneeR: [.2, .72, .07], kneeL: [-.2, .72, -.05], ankR: [.21, .14, .08], ankL: [-.21, .14, -.09],
  waist: [0, 1.5, 0], neck: [0, 2.42, 0], shR: [.5, 2.22, 0], shL: [-.5, 2.22, 0], elR: [.53, 1.82, .2], elL: [-.49, 1.82, .12],
  cape: [0, 0, 0], banner: [0, 0, 0], leg: 1.3, toe: .24, heel: .1, style: 'obs',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[1] > 2.28 && Math.abs(c[0]) > .35 && Math.abs(c[2]) < .15) return 5; // pauldrons and tusks ride the chest (the axe head, further forward, does not)
    if (c[1] < .16 && Math.abs(c[0]) > .08) return side ? 11 : 12;
    if (c[1] < .78 && Math.abs(c[0]) > .08) return side ? 2 : 4;
    if (c[1] < 1.33 && Math.abs(c[0]) > .08) return side ? 1 : 3;
    if (c[0] > .3 && c[1] > 1.2) return c[1] > 1.9 && c[2] < .2 && s[1] < .8 ? 7 : 13; // the axe arm: upper arm; forearm, haft and head
    if (c[0] < -.3 && c[1] > 1.2 && c[1] < 2.25) return c[1] > 1.85 ? 8 : 14;      // the pistol arm
    if (c[1] > 2.44 && s[0] < .5) return 6;                                       // helm, mask, braids
    return c[1] < 1.52 ? 0 : 5;
  },
};
const GOLD = {
  hipR: [.12, 1.02, 0], hipL: [-.12, 1.02, 0], kneeR: [.13, .56, .04], kneeL: [-.13, .56, -.03], ankR: [.13, .1, .07], ankL: [-.13, .1, -.05],
  waist: [0, 1.14, 0], neck: [0, 1.78, 0], shR: [.27, 1.66, .02], shL: [-.27, 1.66, .02], elR: [.28, 1.38, .22], elL: [-.29, 1.49, .2],
  cape: [0, 1.72, -.2], banner: [-.46, 3.08, -.2], leg: 1.0, toe: .18, heel: .07, style: 'gold',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[2] < -.18 && Math.abs(c[0]) < .12 && s[0] > .4 && c[1] < 1.62) return 9;                  // the cape
    if (c[0] < -.4 && c[2] < -.3 && c[1] > 2.3 && c[1] < 3.0) return 10;                           // the banner cloth
    if (c[1] < .12 && Math.abs(c[0]) > .05 && Math.abs(c[2]) < .3) return side ? 11 : 12;
    if (c[1] < .6 && Math.abs(c[0]) > .05 && Math.abs(c[2]) < .3) return side ? 2 : 4;
    if (c[1] < 1.04 && Math.abs(c[0]) > .05 && Math.abs(c[0]) < .3 && Math.abs(c[2]) < .3) return side ? 1 : 3; // (the razor, reaching forward past the knee, is the arm's)
    if (c[0] > .2 && c[2] > .05 && c[1] < 1.62) return c[1] < 1.4 ? 13 : 7;                         // razor arm: forearm, gauntlet, razor
    if (c[0] < -.2 && c[2] > .05 && c[1] < 1.62) return c[2] > .25 ? 14 : 8;                       // pulseFist arm
    if (c[1] > 1.8 && Math.abs(c[0]) < .2) return 6;
    return c[1] < 1.15 ? 0 : 5;
  },
};
const SHELL = {
  hipR: [.3, 1.86, 0], hipL: [-.3, 1.86, 0], kneeR: [.33, 1.04, .06], kneeL: [-.33, 1.04, 0], ankR: [.34, .2, .1], ankL: [-.34, .2, -.06],
  waist: [0, 2.12, 0], neck: [0, 3.36, 0], shR: [.64, 3.1, 0], shL: [-.64, 3.1, 0], elR: [.78, 2.36, .1], elL: [-.78, 2.36, -.05],
  cape: [0, 0, 0], banner: [0, 0, 0], leg: 1.8, toe: .42, heel: .2, style: 'shell',
  classify(c, s) {
    const side = c[0] >= 0;
    if (c[1] < .2 && Math.abs(c[0]) > .1) return side ? 11 : 12;
    if (c[1] < 1.16 && Math.abs(c[0]) > .1) return side ? 2 : 4;
    if (c[1] < 1.78 && Math.abs(c[0]) > .1 && Math.abs(c[0]) < .45) return side ? 1 : 3;
    if (c[0] > .55 && c[1] < 3.05) return c[1] < 2.2 ? 13 : 7;                 // the pulseCannon arm
    if (c[0] < -.55 && c[1] < 3.05) return c[1] < 2.2 ? 14 : 8;                // the fist
    if (c[1] > 3.38 && Math.abs(c[0]) < .3) return 6;
    return c[1] < 2.1 ? 0 : 5;
  },
};
export const RIG = { inf: GRAY, rail: GRAY, obs: OBS, gold: GOLD, lead: GOLD, shell: SHELL };
export const rigged = k => !!RIG[k];
// the leg's rest geometry, worked out once per rig: segment lengths and the angles the model was built standing at
for (const R of new Set(Object.values(RIG))) for (const sd of ['R', 'L']) {
  const H = R['hip' + sd], K = R['knee' + sd], A = R['ank' + sd];
  R['F0' + sd] = Math.atan2(K[2] - H[2], H[1] - K[1]);   // thigh's forward lean at rest
  R['S0' + sd] = Math.atan2(A[2] - K[2], K[1] - A[1]);   // shin's
  R['Lt' + sd] = Math.hypot(H[1] - K[1], H[2] - K[2]); R['Ls' + sd] = Math.hypot(K[1] - A[1], K[2] - A[2]);
}

// ---------------------------------------------------------------- tagging the parts with bones
const _bb = new THREE.Box3(), _v = new THREE.Vector3();
export function tagBones(geo, kind) {
  if (geo.attributes.bone && geo.userData.boneRig === 2) return geo;
  const R = RIG[kind], n = geo.attributes.position.count, bone = new Float32Array(n), parts = geo.userData.parts, P = geo.attributes.position;
  if (R && parts && parts.length) {
    let o = 0;
    for (const cnt of parts) {
      _bb.makeEmpty(); for (let i = o; i < o + cnt; i++) _bb.expandByPoint(_v.set(P.getX(i), P.getY(i), P.getZ(i)));
      const c = [(_bb.min.x + _bb.max.x) / 2, (_bb.min.y + _bb.max.y) / 2, (_bb.min.z + _bb.max.z) / 2], s = [_bb.max.x - _bb.min.x, _bb.max.y - _bb.min.y, _bb.max.z - _bb.min.z];
      bone.fill(R.classify(c, s), o, o + cnt); o += cnt;
    }
  }
  geo.setAttribute('bone', new THREE.BufferAttribute(bone, 1)); geo.userData.boneRig = 2;
  return geo;
}

// ---------------------------------------------------------------- the pose on the GPU
// eight vec4s per figure, kept in a float texture (64 figures to a row) and read by instance index (the vertex
// attributes are already near their limit of 16):
// A0 place x, y, z, yaw          A1 thigh R, knee R, thigh L, knee L     A2 foot R, foot L, pelvis yaw, pelvis tilt
// A3 pelvis shift, pelvis drop, fall, scale                               A4 spine twist, spine lean, spine bend, head yaw
// A5 head nod, cape, banner, —   A6 right arm pitch, swing, thrust, elbow  A7 left arm pitch, swing, thrust, elbow
// A8 hip abduction R, L (+ = foot out to the right), —, —
// Angles about X are positive backward (a limb hanging down swings its end back; a foot dips its toe).
const NV = 9, PER_ROW = 64;
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
  const HR = v3(R.hipR), HL = v3(R.hipL), KR = v3(R.kneeR), KL = v3(R.kneeL), AR = v3(R.ankR), AL = v3(R.ankL), W = v3(R.waist), NK = v3(R.neck);
  const SR = v3(R.shR), SL = v3(R.shL), ER = v3(R.elR), EL = v3(R.elL), CP = v3(R.cape), BP = v3(R.banner), PV = vec3(0, R.hipR[1], 0);
  const m = im.material;
  m.positionNode = Fn(() => {
    const b = attribute('bone', 'float'), [a0, a1, a2, a3, a4, a5, a6, a7, a8] = A;
    const p = positionGeometry.toVar(), n = normalGeometry.toVar();
    const rot = (cond, piv, fn, c, s) => { p.assign(select(cond, fn(p.sub(piv), c, s).add(piv), p)); n.assign(select(cond, fn(n, c, s), n)); };
    const is = v => b.equal(v);
    // legs: the foot about the ankle, the shin (and foot) about the knee, the whole leg about the hip
    const legR = is(1).or(is(2)).or(is(11)), legL = is(3).or(is(4)).or(is(12)), foot = is(11).or(is(12)), shin = is(2).or(is(4)).or(foot);
    const fA = select(legR, a2.x, a2.y), kA = select(legR, a1.y, a1.w), tA = select(legR, a1.x, a1.z);
    rot(foot, select(legR, AR, AL), rX, cos(fA), sin(fA));
    rot(shin, select(legR, KR, KL), rX, cos(kA), sin(kA));
    rot(legR.or(legL), select(legR, HR, HL), rX, cos(tA), sin(tA));
    const ab = select(legR, a8.x, a8.y); rot(legR.or(legL), select(legR, HR, HL), rZ, cos(ab), sin(ab)); // stepping out to the side
    // arms: the forearm about the elbow, then the whole arm about the shoulder (pitch, then swing), then its thrust
    const armR = is(7).or(is(13)), arm = armR.or(is(8)).or(is(14)), fore = is(13).or(is(14));
    const eA = select(armR, a6.w, a7.w); rot(fore, select(armR, ER, EL), rX, cos(eA), sin(eA));
    const aP = select(armR, a6.x, a7.x), aY = select(armR, a6.y, a7.y), aZ = select(armR, a6.z, a7.z), Sp = select(armR, SR, SL);
    rot(arm, Sp, rX, cos(aP), sin(aP)); rot(arm, Sp, rY, cos(aY), sin(aY)); p.assign(select(arm, p.add(vec3(0, 0, aZ)), p));
    // the head looks and nods; the cape streams; the banner swings
    rot(is(6), NK, rY, cos(a4.w), sin(a4.w)); rot(is(6), NK, rX, cos(a5.x), sin(a5.x));
    rot(is(9), CP, rX, cos(a5.y), sin(a5.y));
    const bn = a5.z; rot(is(10), BP, rZ, cos(bn), sin(bn)); rot(is(10), BP, rX, cos(bn.mul(.7)), sin(bn.mul(.7)));
    // the spine: everything above the waist turns, bends to the side and leans
    const up = b.greaterThan(4.5).and(b.lessThan(10.5)).or(b.greaterThan(12.5));
    rot(up, W, rY, cos(a4.x), sin(a4.x)); rot(up, W, rZ, cos(a4.z), sin(a4.z)); rot(up, W, rX, cos(a4.y), sin(a4.y));
    // the pelvis carries it all: turned, tilted, shifted over the stance foot, at the height the legs allow
    // (the legs lean in against the sideways shift so the planted foot stays put, and the tilt is the pelvis's and the
    // body's above it, not the legs')
    const all = b.greaterThan(-1), legs = legR.or(legL), body = is(0).or(up), lb = a3.x.mul(-1 / R.leg);
    rot(legs, select(legR, HR, HL), rZ, cos(lb), sin(lb));
    rot(legs, PV, rY, cos(a8.z), sin(a8.z));                            // the legs keep the step's heading: the pelvis's swing (and a turn to aim) turns in the hip sockets, not under the planted feet
    rot(all, PV, rY, cos(a2.z), sin(a2.z)); rot(body, PV, rZ, cos(a2.w), sin(a2.w)); p.assign(p.add(vec3(a3.x, a3.y, 0)));
    rot(all, vec3(0, 0, 0), rX, cos(a3.z), sin(a3.z));                // a fall, about the feet
    const cy = cos(a0.w), sy = sin(a0.w);
    normalLocal.assign(rY(n, cy, sy));
    return rY(p.mul(a3.w), cy, sy).add(a0.xyz);
  })();
  m.needsUpdate = true;
  im.userData.anim = { tex, data, kind, rig: R };
  return true;
}

// ---------------------------------------------------------------- each figure walks to its place
// groundview lays a unit's figures out on formation slots every frame; settle() eases each figure from where it stood
// last frame (L = [x, y, z, yaw, lift]) toward its slot, turns it at its own pace and lifts it smoothly; it returns
// [x, z, yaw, lift, speed], the speed being how fast the figure itself is moving, so its legs step when it shuffles into
// a new place. Far jumps (a landing, a first frame) are taken at once.
const SET = [0, 0, 0, 0, 0, 0, 0]; // x, z, yaw, lift, speed, forward speed, rightward speed
export function settle(L, tx, tz, tyaw, lift, dt) {
  if (globalThis.__irNoSettle || !L || !(dt >= 0) || Math.hypot(L[0] - tx, L[2] - tz) > 40) { SET[0] = tx; SET[1] = tz; SET[2] = tyaw; SET[3] = lift; SET[4] = SET[5] = SET[6] = 0; return SET; }
  const k = 1 - Math.exp(-dt * 7), ky = 1 - Math.exp(-dt * 8), kl = 1 - Math.exp(-dt * 3), l0 = L[4] ?? lift;
  let da = tyaw - L[3]; da -= TAU * Math.round(da / TAU);
  SET[0] = L[0] + (tx - L[0]) * k; SET[1] = L[2] + (tz - L[2]) * k; SET[2] = L[3] + da * ky; SET[3] = l0 + (lift - l0) * kl;
  const vx = dt > 0 ? (SET[0] - L[0]) / dt : 0, vz = dt > 0 ? (SET[1] - L[2]) / dt : 0, cy = Math.cos(SET[2]), sy = Math.sin(SET[2]);
  SET[4] = Math.hypot(vx, vz); SET[5] = vx * sy + vz * cy; SET[6] = vx * cy - vz * sy; return SET; // model +Z (forward) is (sin yaw, cos yaw) in the world, +X (right) is (cos yaw, −sin yaw)
}

// ---------------------------------------------------------------- the gait
// The stride as a cycle c in 0..1 for the right leg (0 = heel strike; the left leg runs half a cycle behind).
// Returns the hip's forward flexion F, the knee's flexion K and the foot's pitch P (toe down +) for that leg, for a
// walk (k = 0) blending to a run (k = 1).
const PKW = [[0, -.22], [.08, 0], [.42, 0], [.58, .5], [.68, .28], [.8, -.14], [1, -.22]];   // the foot through a walk
const PKR = [[0, -.06], [.1, .05], [.28, .55], [.42, .35], [.62, -.2], [1, -.06]];            // and a run (no heel-to-toe)
const keys = (K, c) => { for (let i = 1; i < K.length; i++) if (c <= K[i][0]) { const a = K[i - 1], b = K[i]; return lerp(a[1], b[1], ease((c - a[0]) / (b[0] - a[0]))); } return K[0][1]; };
const kneeAt = (c, k) => lerp(.2, .5, k) * gauss(c, lerp(.13, .14, k), .06) + lerp(1.05, 1.75, k) * gauss(c, lerp(.72, .6, k), lerp(.12, .13, k)) + .05;
const ankZ = (R, sd, F, K) => R['Lt' + sd] * Math.sin(F) + R['Ls' + sd] * Math.sin(F - K); // the ankle's reach ahead of the hip
const gaitEnds = k => { const Fm = lerp(.1, .22, k), Fa = lerp(.4, .58, k); return [Fm + Fa, Fm - .9 * Fa, lerp(.6, .4, k)]; };
// how far the planted ankle travels back under the hip in one stance (model metres), for the cadence
export function reachOf(R, k) { const [Fx, Fn, beta] = gaitEnds(k); return (ankZ(R, 'R', Fx, kneeAt(0, k)) - ankZ(R, 'R', Fn, kneeAt(beta, k)) + ankZ(R, 'L', Fx, kneeAt(0, k)) - ankZ(R, 'L', Fn, kneeAt(beta, k))) / 2; }
function leg(c, k, out, R, sd) {
  c = fract(c);
  // hip: forward at heel strike; while the foot is down the hip is solved (two-joint IK, a few Newton steps) so the
  // ankle moves back under the body in a straight line at an even speed, whatever the knee is doing: the planted foot
  // holds its ground; then the leg swings through. β is the share of the cycle the foot is down.
  const [Fx, Fn, beta] = gaitEnds(k), K = kneeAt(c, k);
  let F;
  if (c < beta) {
    const z0 = ankZ(R, sd, Fx, kneeAt(0, k)), z1 = ankZ(R, sd, Fn, kneeAt(beta, k)), zt = lerp(z0, z1, c / beta), Lt = R['Lt' + sd], Ls = R['Ls' + sd];
    F = lerp(Fx, Fn, c / beta); for (let it = 0; it < 4; it++) { const e = ankZ(R, sd, F, K) - zt, d = Lt * Math.cos(F) + Ls * Math.cos(F - K); F -= e / Math.max(.2, d); }
  } else F = Fn + (Fx - Fn) * ease((c - beta) / (1 - beta));
  out[0] = F; out[1] = K; out[2] = lerp(keys(PKW, c), keys(PKR, c), k); return out;
}
const LR = [0, 0, 0], LL = [0, 0, 0];
// the leg's height from hip to ground for given angles (the lower of heel and toe touches)
function legH(R, sd, F, K, P) {
  return R['Lt' + sd] * Math.cos(F) + R['Ls' + sd] * Math.cos(F - K) + R['ank' + sd][1] - Math.min(0, -(P > 0 ? R.toe * Math.sin(P) : R.heel * Math.sin(-P)));
}

// ---------------------------------------------------------------- per-unit clocks
const U = new Map();   // per unit: stride phase, gait, turn, melee and fire blends, flight, losses, ground slope
const POSE = new Map(); // per unit, per figure: the last pose written (near figures only), for shots
function unitClock(u, t, kind, scale) {
  let s = U.get(u.id); if (!s) { s = { ph: Math.random(), g: 0, a: u.a, turn: 0, fire: 0, fly: 0, mel: 0, run: 0, t, hits: [], hn: 0, men: null, gx: 0, gy: 0 }; U.set(u.id, s); }
  const dt = Math.max(0, Math.min(.1, t - s.t)); s.t = t; if (dt <= 0) return s;
  const R = RIG[kind], L = R.leg * scale, T = u.T || {}, ca = Math.cos(u.a), sa = Math.sin(u.a);
  const v0 = Math.hypot(u.vx || 0, u.vy || 0), along = (u.vx || 0) * ca + (u.vy || 0) * sa;
  s.v = (s.v ?? v0) + (v0 - (s.v ?? v0)) * (1 - Math.exp(-dt * 4)); const v = s.v; // the stride follows a steadied speed
  let da = u.a - s.a; da -= TAU * Math.round(da / TAU); s.a = u.a; s.turn += (clamp(Math.abs(da) / Math.max(dt, 1e-3), 0, 2) - s.turn) * (1 - Math.exp(-dt * 6));
  const flying = (kind === 'gold' || kind === 'lead') && v0 > 8;
  s.fly += ((flying ? 1 : 0) - s.fly) * (1 - Math.exp(-dt * 3));
  const walk = T.walk || 3, run = T.run || walk * 2;
  s.run += (clamp((v - walk) / Math.max(.1, run - walk), 0, 1) - s.run) * (1 - Math.exp(-dt * 3));
  const gT = v > .3 && !flying ? clamp(v / (walk * .7), .3, 1) : s.turn > .25 ? .45 : 0; // shuffling round when turning on the spot
  s.g += (gT - s.g) * (1 - Math.exp(-dt * 4));
  // cadence: a stride (two steps) covers 2 × leg × (sin(F at heel strike) − sin(F at toe-off)), so the planted foot holds
  // the planted foot is down for a share β of the cycle (0.6 walking, 0.4 running) while the hip passes over it from
  // flexed (heel strike) to extended (toe-off), so the cycle rate is v·β / (leg · (sin F_hs − sin F_to)) at full stride
  const k = s.run, beta = lerp(.6, .4, k), reach = reachOf(R, k) * scale;
  const f = v > .3 ? v * beta / Math.max(.15, reach * Math.max(.35, s.g)) : .7;
  s.ph += f * dt * (along < -.3 ? -1 : 1);       // walking backward plays the stride backward
  s.mel += ((u.melee ? 1 : 0) - s.mel) * (1 - Math.exp(-dt * 6));
  // men lost since the last look: a flinch runs through the ranks, from the side the blow came
  if (s.men != null && u.men < s.men) { const foe = u.melee && u.melee.x != null ? u.melee : u.aim && u.aim.x != null ? u.aim : null;
    s.hits.push({ t, k: clamp(.22 + 8 * (s.men - u.men) / Math.max(1, s.men), .22, .95), from: foe ? Math.atan2(foe.y - u.y, foe.x - u.x) : u.a + (Math.random() - .5) * 2, id: s.hn++ }); if (s.hits.length > 4) s.hits.shift(); }
  s.men = u.men;
  // the slope of the ground under the unit (dh per metre east and north), for the feet
  if (!(t - (s.gT ?? -9) < .25)) { s.gT = t; const e = 2; s.aimH = u.aim && u.aim.x != null ? heightAt(u.aim.x, u.aim.y) : null; s.gx = (heightAt(u.x + e, u.y) - heightAt(u.x - e, u.y)) / (2 * e); s.gy = (heightAt(u.x, u.y + e) - heightAt(u.x, u.y - e)) / (2 * e); }
  s.fire += ((u.firing || u.state === 'fire' ? 1 : 0) - s.fire) * (1 - Math.exp(-dt * 4));
  return s;
}

// ---------------------------------------------------------------- one figure's pose
const Q = new Float32Array(NV * 4);
// a melee blow: wind up, strike, recover (k in 0..1) → −1 (wound back) … +1 (struck through)
const blow = (k, up = .45, hit = .14) => k < up ? -ease(k / up) : k < up + hit ? lerp(-1, 1, ease((k - up) / hit)) : lerp(1, 0, ease((k - up - hit) / (1 - up - hit)));
// a kick that eases in and settles with a small overshoot, as a body absorbing a recoil does
const kick = (k, w = .08) => k < w ? Math.sin(k / w * PI / 2) : Math.exp(-(k - w) * 7) * Math.cos((k - w) * 13);
// a hold-and-turn glance: the head picks a new mark every few seconds, turns to it and holds
function glance(t, h, amp) { const P = 2.6 + 2.4 * h, i = Math.floor((t + h * 13) / P), k = clamp(((t + h * 13) / P - i) / .22, 0, 1); return amp * lerp(hash(i, h) * 2 - 1, hash(i + 1, h) * 2 - 1, ease(k)) * (1 - .3 * hash(i + 7, h)); }
// write one figure: (x, y, z) its feet, yaw as groundview turns it, n its index in the unit, h a stable 0..1 hash
export function animFigure(im, i, x, y, z, yaw, u, kind, n, h, scale, t, mv = 0) {
  const D = im.userData.anim; if (!D) return false;
  // mv: settle()'s result (or just the figure's speed): how fast and which way, in its own frame, the figure itself moves
  const fv = typeof mv === 'number' ? mv : mv[4], vf = typeof mv === 'number' ? mv : mv[5], vr = typeof mv === 'number' ? 0 : mv[6];
  const s = unitClock(u, t, kind, scale), R = D.rig, st = R.style, q = Q; q.fill(0);
  const T = u.T || {}, walk = T.walk || 3;
  // how much the figure walks: the unit's gait, or the figure's own shuffle into its place
  const g = clamp(Math.max(s.g, (1 - s.fly) * clamp((fv - .4) / walk, 0, 1) * .9), 0, 1), idle = 1 - g, k = s.run;
  // its own stride: Grays keep step within a few percent, the others each their own pace and size
  const own = st === 'gray' ? .02 : .07, c = s.ph * (1 + own * (h - .5)) + (st === 'gray' ? (h - .5) * .06 : h);
  let amp = (1 + (hash(h, 3) - .5) * .1) * g; // stride size, ±5% from one man to the next
  // which way he is going, in his own frame: forward, or crabbing sideways as the outer files do when the line wheels.
  // People turn the hips toward their way and keep the chest on the enemy; what is left over is taken in side steps.
  let hipTurn = 0, tr = 0;
  if (fv > .5 && g > .05 && s.fly < .5) { const th = Math.atan2(vr, Math.max(-.2, vf)), lim = .9; hipTurn = clamp(th, -lim, lim) * Math.min(1, fv / 1.5); const rest = th - hipTurn; tr = Math.tan(clamp(rest, -1.2, 1.2)) * Math.min(1, g); amp *= Math.max(.25, Math.abs(Math.cos(rest))); }
  const heavy = st === 'shell' ? 1.9 : st === 'obs' ? 1.45 : 1;
  // ---- legs: from the gait cycle, blended to a stance
  leg(c, k, LR, R, 'R'); leg(c + .5, k, LL, R, 'L');
  // the stance, standing: weight on one foot for a few seconds, then the other; the free knee relaxed
  const wP = 7 + 5 * h, w = Math.sin(TAU * (t / wP + h)) , ws = Math.sign(w) * Math.pow(Math.abs(w), .35); // a held shift with a quick change
  const brace = .1 * s.fire;
  const Fr = lerp(.1 * Math.max(0, -ws) + .03, LR[0] * amp + (1 - amp) * .03, g), Fl = lerp(.1 * Math.max(0, ws) + .03, LL[0] * amp + (1 - amp) * .03, g);
  const Kr = lerp(.05 + .34 * Math.max(0, -ws) + brace, LR[1] * amp + (1 - amp) * .08, g), Kl = lerp(.05 + .34 * Math.max(0, ws) + brace, LL[1] * amp + (1 - amp) * .08, g);
  let Pr = lerp(-.04 * Math.max(0, -ws), LR[2] * amp, g), Pl = lerp(-.04 * Math.max(0, ws), LL[2] * amp, g);
  // side steps: each foot swings out and plants beside its own hip (the feet never cross), as the sagittal sweep does
  // the foot's sideways place keeps a fixed ratio to its fore-aft place (tan of the crab angle), so it moves with the
  // ankle's even stance sweep and stays planted on the diagonal; the swing carries it back out in the same proportion
  const [GFx, GFn, beta] = gaitEnds(k), aF = (F, K) => [F * amp + (1 - amp) * .03, K * amp + (1 - amp) * .08];
  const zMid = sd => (ankZ(R, sd, ...aF(GFx, kneeAt(0, k))) + ankZ(R, sd, ...aF(GFn, kneeAt(beta, k)))) / 2;
  const abOf = (sd, F, K) => tr ? Math.asin(clamp(tr * (ankZ(R, sd, F, K) - zMid(sd)) / (R['Lt' + sd] * Math.cos(F) + R['Ls' + sd] * Math.cos(F - K) + R['ank' + sd][1]), -.3, .3)) : 0;
  const abR = abOf('R', Fr, Kr), abL = abOf('L', Fl, Kl);
  // the ground under each foot: the slope along and across the way he faces (model +Z and +X), from the unit's slope
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sF = clamp((s.gx || 0) * sy + (s.gy || 0) * cy, -.7, .7), sX = clamp((s.gx || 0) * cy - (s.gy || 0) * sy, -.7, .7);
  const cR = fract(c), cL = fract(c + .5), downR = g < .1 || cR < beta, downL = g < .1 || cL < beta; // which feet are on the ground
  const sA = Math.atan(sF); Pr -= sA; Pl -= sA;                                                // soles lie along the slope (toe up, climbing)
  let Fr2 = Fr, Kr2 = Kr, Fl2 = Fl, Kl2 = Kl;
  // the pelvis height this leg needs so neither its toe nor its heel goes under the ground there
  const need = (sd, F, K, P, ab) => { const zA = R['hip' + sd][2] + ankZ(R, sd, F, K), d0 = R['Lt' + sd] * Math.cos(F) + R['Ls' + sd] * Math.cos(F - K) + R['ank' + sd][1], dA = d0 * Math.cos(ab), gX = sX * (R['hip' + sd][0] + d0 * Math.sin(ab)), c = Math.cos(P), sn = Math.sin(P);
    return Math.max(sF * (zA + R.toe * c) + dA + R.toe * sn, sF * (zA - R.heel * c) + dA - R.heel * sn) + gX; };
  let nR = need('R', Fr, Kr, Pr, abR), nL = need('L', Fl, Kl, Pl, abL);
  // the pelvis sits as high as the lowest planted foot allows (on flat ground, the standing leg); a leg whose ground is
  // higher than that bends to fit (knee and hip together, as in a squat), so no foot sinks and no planted foot floats
  const Y = downR && downL ? Math.min(nR, nL) : downR ? nR : downL ? nL : Math.max(nR, nL);
  // bend by dk at the knee and re-solve the hip so the ankle stays exactly over the same ground (a planted foot holds)
  const keepF = (sd, F, K, dk) => { const z = ankZ(R, sd, F, K); let f = F + dk / 2; for (let it = 0; it < 4; it++) { const e = ankZ(R, sd, f, K + dk) - z, d = R['Lt' + sd] * Math.cos(f) + R['Ls' + sd] * Math.cos(f - K - dk); f -= e / Math.max(.2, d); } return f; };
  const fit = (sd, F, K, P, ab) => { const hAt = dk => need(sd, keepF(sd, F, K, dk), K + dk, P, ab) - Y; let dk = 0;
    for (let it = 0; it < 4; it++) { const e = hAt(dk); if (e <= 1e-4) break; const d = (hAt(dk + .02) - e) / .02; if (d > -1e-5) break; dk = clamp(dk - e / d, 0, 1.6); } return dk; };
  if (nR - Y > 1e-4) { const dk = fit('R', Fr, Kr, Pr, abR); Fr2 = keepF('R', Fr, Kr, dk); Kr2 += dk; }
  if (nL - Y > 1e-4) { const dk = fit('L', Fl, Kl, Pl, abL); Fl2 = keepF('L', Fl, Kl, dk); Kl2 += dk; }
  // joint commands relative to the model's rest pose (positive = backward)
  q[4] = R.F0R - Fr2; q[5] = R.S0R - R.F0R + Kr2; q[6] = R.F0L - Fl2; q[7] = R.S0L - R.F0L + Kl2;
  q[8] = Pr - q[4] - q[5]; q[9] = Pl - q[6] - q[7]; q[32] = abR; q[33] = abL;
  const h0 = R.hipR[1];
  let drop = Y - h0;
  if (k > .2) drop += R.leg * .06 * k * g * Math.max(0, Math.sin(TAU * 2 * (c - .08)));  // the run's flight
  // ---- pelvis and spine: turning with the swinging leg, tilting down on the swing side, over the stance foot
  const cs = Math.cos(TAU * c), sn = Math.sin(TAU * c);
  let pYaw = -.1 * cs * amp * (1 + .3 * k), pTilt = .07 * sn * amp * heavy * (1 - .5 * k), pShift = .035 * R.leg * sn * amp * heavy * (1 - .6 * k);
  pTilt += idle * -.075 * ws; pShift += idle * .05 * R.leg * ws;         // standing, the hip drops toward the relaxed knee
  pYaw += hipTurn;
  const sway = Math.sin(TAU * (t / (5.5 + 2 * h) + h * 3)); // and the whole body sways a little, as standing people do
  let twist = -1.15 * (pYaw - hipTurn) - hipTurn + .06 * sway * idle, bend = -.8 * pTilt, lean = lerp(.04, .2, k) * g + .02 * idle + .025 * sway * idle;
  lean += Math.atan(sF) * (.35 * g + .15);                                   // leaning into a climb, back against a descent
  // ---- aim: firing, he turns from the hips and chest to his own mark in the target unit and lifts or drops the weapon to it
  let aimY = 0, aimE = 0;
  if (s.fire > .03 && u.aim && u.aim.x != null) { const dx = u.aim.x - x, dz = u.aim.y - z, d = Math.hypot(dx, dz) || 1; let dy = Math.atan2(dx, dz) - yaw; dy -= TAU * Math.round(dy / TAU);
    aimY = clamp(dy, -.85, .85) * s.fire; aimE = clamp(Math.atan2((s.aimH ?? y) + 1.2 * scale - (y + R.shR[1] * scale), d), -.6, .6) * s.fire; pYaw += aimY * .3; twist += aimY * .7; lean -= aimE * .25; }
  const br = Math.sin(TAU * (t / (3.4 + h) + h * 5)); lean += .03 * br * idle; // breathing
  lean += .04 * s.fire;
  let headYaw = -(twist + pYaw - aimY) * .85 + glance(t, h, st === 'shell' ? .35 : .55) * idle * (1 - .7 * s.fire) * (1 - s.mel), nod = -lean * .55 + .03 * br * idle;
  // ---- arms
  const ac = Math.cos(TAU * (c - .04)); // the arms swing a beat behind the legs
  let rp = 0, ry = 0, rz = 0, re = 0, lp = 0, ly = 0, lz = 0, le = 0;
  const swing = (side, A, eb) => { const sg = side * ac; return [sg * A * amp, -(eb + .35 * Math.max(0, -sg) * amp + k * .9 * g)]; }; // forward swing bends the elbow
  if (st === 'gray') { // rifle at port on the move, shouldered to fire; it rides the shoulders' swing
    rp = (.3 * g + .38 * idle) * (1 - s.fire) + .045 * Math.sin(TAU * 2 * c) * amp - .04 * br * idle; ry = .06 * sn * amp + .08 * sway * idle * (1 - s.fire); // low ready at rest, port on the march
    const fid = hash(Math.floor((t + h * 31) / 9), h) < .35 ? Math.sin(PI * clamp(fract((t + h * 31) / 9) / .12, 0, 1)) : 0; // now and then, a shifted grip
    rp -= .28 * fid * idle * (1 - s.fire); // brings the rifle up to look it over
  }
  if (st === 'obs') { [lp, le] = swing(-1, .42, .25); rp = .05 * ac * amp + .04 * Math.sin(TAU * 2 * c) * amp - .05 * br * idle; re = -.05; lp += .25 * idle; } // heavy breathing heaves the axe
  if (st === 'gold') { [rp, re] = swing(1, .1, .2); re *= .6; [lp, le] = swing(-1, .3, .25); rp += .06 * idle; re -= .1 * idle; // the razor held steady, low and ready (its long blade magnifies any swing)
    lp += .7 * idle * (1 - s.fire); le += .35 * idle * (1 - s.fire);                                  // the pulseFist lowered at rest
    const P = 6 + 3 * h, fk = fract((t + h * 17) / P), fl = hash(Math.floor((t + h * 17) / P), h + 1) < .55 ? Math.sin(PI * clamp(fk / .3, 0, 1)) : 0; // a flourish of the razor
    ry += .8 * fl * Math.sin(TAU * clamp(fk / .3, 0, 1)) * idle; rp -= .35 * fl * idle; twist += .12 * fl * idle; }
  if (st === 'shell') { [lp, le] = swing(-1, .2, .15); [rp, re] = swing(1, .12, .1); }
  // ---- firing: braced, each shot kicking the weapon and the shoulders (own rate, own moment)
  const rate = st === 'gray' ? (kind === 'rail' ? .3 : .75) : st === 'shell' ? .5 : st === 'obs' ? .9 : 1, rk = kick(fract(t * rate + h * 7.3)) * s.fire;
  if (st === 'gray') { rp -= (kind === 'rail' ? .2 : .13) * rk; rz = -.05 * rk; lean -= .05 * rk; twist += .04 * rk; }
  if (st === 'obs') { lp = lerp(lp, -.55, s.fire) + .25 * rk; le = lerp(le, -.1, s.fire); twist += .1 * s.fire; }
  if (st === 'gold') { lp = lerp(lp, -.75, s.fire) + .22 * rk; le = lerp(le, .05, s.fire); lz = -.04 * rk; twist -= .12 * s.fire; }
  if (st === 'shell') { rp -= .3 * rk; rz = -.08 * rk; re += .15 * rk; lean -= .05 * rk; twist += .06 * rk; }
  // the weapon arm follows the mark up or down
  if (aimE) { if (st === 'gray' || st === 'shell') rp -= aimE; else lp -= aimE; }
  // ---- hit: when the unit loses men a flinch runs through the ranks, from the side the blow came (each man his own
  // moment, a share of them as the loss is heavy); a jerk back, the head snapping, the weapon dipping, the knees giving
  for (const e of s.hits) { const dtE = t - e.t - h * .09; if (dtE < 0 || dtE > .55 || hash(h * 7.13, e.id) > e.k) continue;
    const f = kick(dtE / .55, .07) * (.6 + .4 * hash(h, e.id + 3)), rb = e.from - u.a, fr = Math.cos(rb), sd = Math.sin(rb);
    lean -= .32 * f * fr; twist -= .22 * f * sd; bend += .14 * f * sd; nod -= .35 * f;
    // the knees give: hip and knee together (half and whole, so the ankles stay over the same ground), the soles flat, the pelvis down by what that costs
    const dF = .16 * f, dK = .32 * f, dR = legH(R, 'R', Fr2, Kr2, 0) - legH(R, 'R', Fr2 + dF, Kr2 + dK, 0), dL = legH(R, 'L', Fl2, Kl2, 0) - legH(R, 'L', Fl2 + dF, Kl2 + dK, 0);
    drop -= Math.max(0, downR && downL ? Math.min(dR, dL) : downR ? dR : downL ? dL : 0); q[4] -= dF; q[6] -= dF; q[5] += dK; q[7] += dK; q[8] -= dK - dF; q[9] -= dK - dF;
    if (st === 'gray' || st === 'shell') rp += .22 * f; else { lp += .25 * f; rp += .15 * f; } }
  // ---- melee: each figure on its own beat
  if (s.mel > .02) {
    const m = s.mel, mk = fract(t / (st === 'obs' ? 1.5 : st === 'gold' ? 1.3 : st === 'shell' ? 1.6 : 1.1) + h * 3.7);
    if (st === 'gray') { const b = blow(mk, .4, .12); rz += m * (b > 0 ? .32 * b : .1 * b); rp += m * (-.15 * b); lean += m * .16 * Math.max(0, b); pYaw += m * .12 * b; q[4] -= m * .2 * Math.max(0, b); }
    if (st === 'obs') { const b = blow(mk, .5, .12), lag = blow(Math.max(0, mk - .03), .5, .12); // the forearm whips through a beat after the arm
      rp = lerp(rp, b < 0 ? -1.0 * -b : 1.1 * b, m); re = lerp(re, lag < 0 ? -.6 * -lag : 0, m);
      lean += m * (b < 0 ? -.18 * -b : .32 * b); pYaw += m * -.18 * b; twist += m * -.15 * b; q[4] -= m * .25 * Math.max(0, b); q[5] += m * .3 * Math.max(0, b); lp = lerp(lp, -.3, m); le = lerp(le, -.4, m); }
    if (st === 'gold') { // the Willow Way: the razor's figure of eight, the hips leading it, stepping only forward
      const a = TAU * mk; ry = lerp(ry, 1.05 * Math.sin(a), m); rp = lerp(rp, -.55 * Math.sin(2 * a) - .2, m); re = lerp(re, -.3 - .35 * Math.max(0, Math.cos(a)), m);
      pYaw += m * .18 * Math.sin(a - .7); twist += m * .3 * Math.sin(a - .3); lean += m * .1;
      lp = lerp(lp, -.5 + .15 * Math.sin(a + 1), m); le = lerp(le, -.7, m); q[4] -= m * .18 * Math.max(0, Math.sin(a)); q[5] += m * .25 * Math.max(0, Math.sin(a)); }
    if (st === 'shell') { const b = blow(mk, .45, .1); lp = lerp(lp, b < 0 ? .65 * -b : -1.0 * b, m); le = lerp(le, b < 0 ? -1.7 * -b : -.1 * (1 - b), m); /* the fist drawn back at the shoulder, then driven out */ lz += m * .45 * Math.max(0, b); pYaw += m * -.12 * b; twist += m * -.15 * b; lean += m * .12 * Math.max(0, b); }
  }
  // ---- flight on gravBoots: legs trail, the body leans into it, the cape streams
  let cape = .08;
  if (s.fly > .02) { const f = s.fly; q[4] = lerp(q[4], .35, f); q[6] = lerp(q[6], .45, f); q[5] = lerp(q[5], .7, f); q[7] = lerp(q[7], .9, f); q[8] = lerp(q[8], .4, f); q[9] = lerp(q[9], .5, f); lean = lerp(lean, .38, f); drop *= 1 - f; pTilt = lerp(pTilt, .08 * Math.sin(t * 1.1 + h * 9), f); pShift *= 1 - f; }
  if (R.cape[1]) { const v = Math.hypot(u.vx || 0, u.vy || 0); cape = Math.min(.75, .1 + .45 * Math.min(1, v / 7) + .2 * s.fly + .06 * Math.sin(t * 5.3 + h * 17) * (.3 + Math.min(1, v / 5)) + .05 * Math.sin(TAU * 2 * c) * g + .1 * s.mel * Math.sin(t * 9 + h)); }
  let banner = 0; if (kind === 'lead') banner = .08 * Math.sin(t * 1.3 + h * 5) + .25 * Math.min(1, Math.hypot(u.vx || 0, u.vy || 0) / 6) + .04 * Math.sin(TAU * 2 * c) * g;
  q[0] = x; q[1] = y; q[2] = z; q[3] = yaw;
  q[10] = pYaw; q[11] = pTilt; q[12] = pShift; q[13] = drop; q[14] = 0; q[15] = scale;
  q[16] = twist; q[17] = lean; q[18] = bend; q[19] = headYaw;
  q[20] = nod; q[21] = cape; q[22] = banner; q[23] = 0;
  q[24] = rp; q[25] = ry; q[26] = rz; q[27] = re; q[28] = lp; q[29] = ly; q[30] = lz; q[31] = le;
  q[34] = (hipTurn - pYaw) * g; // legs keep the step's heading; standing, they follow the pelvis
  write(D, i, q);
  // keep the pose, so a shot can leave this figure's own barrel and land on a figure (shotEnds)
  let PU = POSE.get(u.id); if (!PU) POSE.set(u.id, PU = new Map()); let pe = PU.get(n); if (!pe) PU.set(n, pe = { q: new Float32Array(NV * 4), kind, t: 0 });
  pe.q.set(q); pe.kind = kind; pe.t = t; pe.scale = scale;
  const ST = globalThis.__irAnimStats; if (ST) { // test hook: how far each figure moves against its own unit, frame to frame
    const key = u.id * 4096 + n, rx = x - u.x, rz2 = z - u.y, p = ST.last.get(key);
    if (p && t > p[3]) { const d = Math.hypot(rx - p[0], rz2 - p[1]); let dy = yaw - p[2]; dy = Math.abs(dy - TAU * Math.round(dy / TAU)); ST.n++; ST.d.push(d); ST.y.push(dy); }
    ST.last.set(key, [rx, rz2, yaw, t]); }
  return true;
}
function write(D, i, q) { const o = i * NV * 4, a = D.data; for (let k = 0; k < NV * 4; k++) a[o + k] = q[k]; }
export function animEnd(meshes) { for (const k in meshes) { const D = meshes[k].userData.anim; if (D) D.tex.needsUpdate = true; } }
export function animReset() { U.clear(); DY.length = 0; POSE.clear(); }
// for tests: the gait's leg angles, the pelvis height rule, and the rest geometry
export const gaitProbe = { leg, legH, reachOf, RIG };

// ---------------------------------------------------------------- shots from the barrel, onto a man
// The sim draws a shot between random points in the two units' footprints. shotEnds(f) moves its ends onto the figures
// as drawn: it leaves the muzzle of the nearest posed figure of the firing unit, where the barrel is this frame (kicked,
// aimed, turned), and lands on the chest of the nearest posed figure of the unit it was fired at. It returns
// [[x, y, z] | null, [x, y, z] | null] in world space, or null to keep the sim's own ends (aircraft, far units).
const MZB = { inf: 7, rail: 7, obs: 14, gold: 14, lead: 14, shell: 13 };  // the bone that holds the muzzle
const jX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const jY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s]; };
const jZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };
const about = (p, v, f, a) => { const r = f([p[0] - v[0], p[1] - v[1], p[2] - v[2]], a); return [r[0] + v[0], r[1] + v[1], r[2] + v[2]]; };
// a point on an arm, chest or head bone, posed exactly as the shader poses it
export function poseP(R, q, b, p) {
  const right = b === 7 || b === 13;
  if (b === 13 || b === 14) p = about(p, right ? R.elR : R.elL, jX, right ? q[27] : q[31]);
  if (b === 7 || b === 8 || b === 13 || b === 14) { const S = right ? R.shR : R.shL; p = about(p, S, jX, right ? q[24] : q[28]); p = about(p, S, jY, right ? q[25] : q[29]); p = [p[0], p[1], p[2] + (right ? q[26] : q[30])]; }
  if (b === 6) { p = about(p, R.neck, jY, q[19]); p = about(p, R.neck, jX, q[20]); }
  p = about(p, R.waist, jY, q[16]); p = about(p, R.waist, jZ, q[18]); p = about(p, R.waist, jX, q[17]);
  const PV = [0, R.hipR[1], 0]; p = about(p, PV, jY, q[10]); p = about(p, PV, jZ, q[11]); p = [p[0] + q[12], p[1] + q[13], p[2]];
  p = jX(p, q[14]); p = jY([p[0] * q[15], p[1] * q[15], p[2] * q[15]], q[3]);
  return [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
}
function nearUnit(x, y, team, foe) {
  let best = null, bd = 140 * 140;
  for (const u of G.units || []) { if (u.T && u.T.air || (foe ? u.team === team : u.team !== team) || !POSE.has(u.id)) continue; const d = (u.x - x) ** 2 + (u.y - y) ** 2; if (d < bd) { bd = d; best = u; } }
  return best;
}
function nearFig(u, x, y) {
  let best = null, bd = 1e18; const now = G.t;
  for (const pe of POSE.get(u.id).values()) { if (now - pe.t > .5) continue; const d = (pe.q[0] - x) ** 2 + (pe.q[2] - y) ** 2; if (d < bd) { bd = d; best = pe; } }
  return best;
}
export function shotEnds(f) {
  if (f.z0 != null || !RIG) return null;
  const a = nearUnit(f.x0, f.y0, f.team, false), fa = a && nearFig(a, f.x0, f.y0), M = fa && MUZZLE[fa.kind];
  const o = fa && M && MZB[fa.kind] ? poseP(RIG[fa.kind], fa.q, MZB[fa.kind], M) : null;
  let e = null;
  if (f.z1 == null) { const b = nearUnit(f.x1, f.y1, f.team, true), fb = b && nearFig(b, f.x1, f.y1); if (fb) { const R = RIG[fb.kind]; e = poseP(R, fb.q, 5, [0, (R.waist[1] + R.neck[1]) / 2, .1]); } }
  const st = globalThis.__irShotStats; if (st) { st.n++; if (o) { st.o++; st.dO = Math.max(st.dO || 0, Math.hypot(o[0] - f.x0, o[2] - f.y0)); } if (e) { st.e++; st.dE = Math.max(st.dE || 0, Math.hypot(e[0] - f.x1, e[2] - f.y1)); } } // test hook
  return o || e ? [o, e] : null;
}

// ---------------------------------------------------------------- the dying: struck back, they buckle, slump and topple
const DY = [], FALL = 1.05;
export function dyingAdd(f, team, kind, col, scale, t) {
  if (!RIG[kind] || DY.length > 600) return false;
  DY.push({ x: f[0], y: f[1], z: f[2], yaw: f[3] + (Math.random() - .5) * 1.2, kind, team, col, t0: t, h: Math.random(), scale }); return true;
}
// draw the dying into the near meshes after the living (cnt: the next free index per kind); when one has fallen, hand it
// to corpse(f, team): f = [x, y, z, yaw] where the corpse model (feet at −0.95 m) lies along the fallen figure
export function drawDying(meshes, cnt, t, corpse) {
  for (let j = DY.length - 1; j >= 0; j--) {
    const d = DY[j], k = (t - d.t0) / FALL, im = meshes[d.kind], R = RIG[d.kind];
    if (k >= 1 || k < 0 || !im || cnt[d.kind] >= im.instanceMatrix.count) {
      const fw = 1.1 * d.scale * (R.leg / .92); corpse([d.x + Math.sin(d.yaw) * fw, d.y, d.z + Math.cos(d.yaw) * fw, d.yaw], d.team, d.kind); DY.splice(j, 1); continue; } // (kind: so each body leaves its own corpse model)
    const D = im.userData.anim, i = cnt[d.kind]++, q = Q; q.fill(0);
    const hit = Math.sin(PI * clamp(k / .16, 0, 1)) * (1 - clamp(k / .16, 0, 1) * .3), crumple = ease(clamp((k - .08) / .3, 0, 1)), top = clamp((k - .25) / .75, 0, 1), fall = top * top * (PI / 2), straight = ease(clamp(top * 1.3, 0, 1));
    const sd = d.h < .5 ? -1 : 1, F = -.55 * crumple * (1 - straight), K = 1.2 * crumple * (1 - straight);
    q[0] = d.x; q[1] = d.y; q[2] = d.z; q[3] = d.yaw;
    q[4] = R.F0R - F; q[5] = R.S0R - R.F0R + K * (1 + .2 * sd); q[6] = R.F0L - F; q[7] = R.S0L - R.F0L + K * (1 - .2 * sd);
    q[8] = -q[4] - q[5] + .4 * crumple * (1 - straight); q[9] = -q[6] - q[7] + .4 * crumple * (1 - straight);
    q[10] = .25 * sd * hit; q[11] = .12 * sd * crumple; q[13] = -R.leg * .38 * crumple * (1 - straight);
    q[16] = .2 * sd * hit; q[17] = -.25 * hit + .35 * crumple; q[18] = .1 * sd * crumple; q[19] = .35 * sd * crumple; q[20] = -.3 * hit + .5 * crumple; q[21] = .3 + .5 * crumple;
    q[14] = fall; q[15] = d.scale;
    q[24] = -1.0 * hit + .5 * crumple; q[27] = -.2 - .3 * crumple; q[28] = -1.2 * hit + .4 * crumple; q[31] = -.3 * crumple; // arms flung, then limp
    im.setColorAt(i, d.col); write(D, i, q);
  }
}
