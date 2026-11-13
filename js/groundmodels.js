// The figures of the ground war, built in code the way js/hulls.js builds the ships: boxes and low-segment cylinders
// merged into ONE non-indexed geometry per kind, so each kind stays one InstancedMesh, one material, one draw call.
//
// Conventions (shared with groundview.js): metres, Y up, +Z forward, origin at the feet (the Stork's at its centre,
// the gravPod's at the underside of its hull), true size — the view scales figures by VS itself.
//
// Three vertex attributes on every figure:
//   color  the figure's own paint (Grays in duroArmor grey, Obsidians near-black, Golds gilt, suits gunmetal)
//   tm     team mask 0..1: where the per-instance colour (setColorAt) lands — crests, pauldrons, capes, banners,
//          carapace plates, a Stork's tail. The Total War read: a dark body and one bright block that says whose it is.
//   em     emissive mask 0..1: razor blades, axe edges, gravBoots, cockpit slits, engine bells, bay lights glow.
// figureMaterial() is a TSL node material (the game renders with WebGPURenderer): colour = mix(paint, paint × instanceColour, tm);
// emissive += colour × em.
//
// v2 (design-panel pass): real stances, tapered limbs on the elites, overlapping plates, caste shape language,
// the StarShell rebuilt to the book ("apelike, elongated limbs and armored carapaces… a crustaceous golem"),
// v3 (smoothing pass, for an RTX-class GPU): primitives keep their own smooth normals, armour plates are rounded boxes,
// helmets spheres, limbs 10–14-segment tapered cylinders. Budgets (triangles): inf/rail ≤ 1,600 · obs/gold/lead ≤ 3,000 ·
// shell/pod/aa ≤ 6,000 · corpse ≤ 300 · stork ≤ 15,000. triCount() reports them.
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, max, min, vec2, vec3, float, instanceColor, positionWorld, normalWorld, transformNormalToView, texture, fract, floor, abs, pow, select, dFdx, dFdy, log2, length, clamp, normalize, sign, uniform, Fn, dot } from 'three/tsl';
import { cityPlan } from './ground.js';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';

const PI = Math.PI;
export const KINDS = ['inf', 'rail', 'obs', 'gold', 'lead', 'shell', 'pod', 'aa'];
// where each kind's weapon fires from (metres, before VS): x right, y up, z forward
export const MUZZLE = { inf: [.16, 1.22, .8], rail: [.16, 1.24, 1.2], obs: [-.42, 1.5, .5], gold: [-.3, 1.3, .6], lead: [-.3, 1.3, .6], shell: [.8, 1.95, 1.4], pod: [0, 1.25, 3.3], aa: [0, 2.4, 1.0] };

// paints
const C = {
  duro: '#6b7079', duroD: '#41454c', duroL: '#858b95', pack: '#3c3e44', gun: '#1b1d22', visor: '#0e1216', boot: '#24262a', cloth: '#2c2a2e',
  obs: '#34363c', obsD: '#1a1b1f', obsL: '#4a4d55', fur: '#4b3b2d', furL: '#6a563f', haft: '#2a2320', edge: '#bfe9ff', hair: '#d9d2c2', bone: '#cfc6b4', skin: '#b9a99a',
  gilt: '#c9a24c', giltD: '#8a6a24', giltL: '#f1d47d', razor: '#e6edf4', pulse: '#ff7a4a', giltK: '#5a4418',
  shell: '#59606b', shellD: '#30343b', shellL: '#737a86', cannon: '#1a1c21', lens: '#ff9a4c', vent: '#15171b', exhaust: '#ffb070',
  pod: '#5c616a', podD: '#34383f', podL: '#767c86', tube: '#6a6f77', crate: '#5a4e34', olive: '#4a4f3c',
  hull: '#6a6f78', hullD: '#3d4148', hullL: '#858b95', belly: '#2b2d33', glass: '#9fd7ff', red: '#ff3a24', glow: '#ffb070', team: '#ffffff',
};

// ---------------------------------------------------------------- the kit
const _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3();
const clampN = (v, a, b) => v < a ? a : v > b ? b : v;
// a rounded box: a 3-segment box whose inner vertex rings are moved to where the bevel starts (half − r), so every face
// keeps a flat centre with a true face normal, and only the outer ring is pulled onto the rounded edge, normals following
function roundedBox(w, h, d, r, seg = 3) {
  seg = 3; const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, n = g.attributes.normal;
  r = Math.min(r, w / 2, h / 2, d / 2); const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, E = 1e-5;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    // inner rings → the bevel start; the outer ring stays on the edge
    _v.set(snapIn(_v.x, w / 2, hx), snapIn(_v.y, h / 2, hy), snapIn(_v.z, d / 2, hz));
    _c.set(clampN(_v.x, -hx, hx), clampN(_v.y, -hy, hy), clampN(_v.z, -hz, hz)); _d.subVectors(_v, _c);
    if (_d.lengthSq() < 1e-10) _d.fromBufferAttribute(n, i); _d.normalize();
    p.setXYZ(i, _c.x + _d.x * r, _c.y + _d.y * r, _c.z + _d.z * r); n.setXYZ(i, _d.x, _d.y, _d.z);
  }
  return g;
}
// a coordinate on the outer face stays; anything inside is scaled so the outermost inner ring lands at the bevel start
const snapIn = (v, half, hin) => Math.abs(Math.abs(v) - half) < 1e-5 ? v : Math.abs(v) < 1e-9 ? 0 : Math.sign(v) * hin;
class Fig {
  constructor() { this.parts = []; this.tris = 0; this.role = null; this.roleFn = null; }  // role: which city texture a part wears (CITY_ROLE); figures leave it 0
  add(g, paint, tm = 0, em = 0) {
    if (!g.attributes.normal) g.computeVertexNormals();
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.attributes.position.count, c = new THREE.Color(paint), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tm', new THREE.BufferAttribute(new Float32Array(n).fill(tm), 1));
    g.setAttribute('em', new THREE.BufferAttribute(new Float32Array(n).fill(em), 1));
    g.setAttribute('role', new THREE.BufferAttribute(new Float32Array(n).fill(this.role != null ? this.role : this.roleFn ? this.roleFn(paint) : 0), 1));
    this.parts.push(g); this.tris += n / 3; return this;
  }
  // a rounded box: edges bevelled to radius r with smooth normals, so plates read as forged metal rather than voxels
  rbox(w, h, d, r, seg, x, y, z, paint, tm = 0, ry = 0, rx = 0, rz = 0, em = 0) { const g = roundedBox(w, h, d, r, seg); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(g, paint, tm, em); }
  // a sphere (optionally squashed) placed by its centre
  sph(r, ws, hs, x, y, z, paint, tm = 0, sy = 1, sz = 1, em = 0) { const g = new THREE.SphereGeometry(r, ws, hs); if (sy !== 1 || sz !== 1) { g.scale(1, sy, sz); g.computeVertexNormals(); } g.translate(x, y, z); return this.add(g, paint, tm, em); }
  // a box of w×h×d centred at (x, y, z); rotations about its own centre, X then Z then Y
  box(w, h, d, x, y, z, paint, tm = 0, ry = 0, rx = 0, rz = 0, em = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(g, paint, tm, em); }
  // a cylinder of radii rt (top) / rb (bottom), height h along its own Y, rotated then placed by its centre
  cyl(rt, rb, h, seg, x, y, z, paint, tm = 0, rx = 0, rz = 0, ry = 0, open = false, em = 0) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(g, paint, tm, em); }
  // a limb: a tapered cylinder from point a to point b (radius ra at a, rb at b)
  limb(a, b, ra, rb, seg, paint, tm = 0, em = 0) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = _d.length(); _d.normalize();
    const g = new THREE.CylinderGeometry(rb, ra, L, seg); _q.setFromUnitVectors(_y, _d); g.applyQuaternion(_q); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return this.add(g, paint, tm, em);
  }
  // a bar: a box of section w×d from point a to point b
  bar(a, b, w, d, paint, tm = 0, em = 0) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = _d.length(); _d.normalize();
    const g = new THREE.BoxGeometry(w, L, d); _q.setFromUnitVectors(_y, _d); g.applyQuaternion(_q); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return this.add(g, paint, tm, em);
  }
  // a flat plate from a 2-D outline in the ground plane ([x, z] points, counter-clockwise seen from above), thick t,
  // its top face at height y; mirror = -1 builds the mirrored outline (x → −x)
  plate(pts, t, y, paint, tm = 0, em = 0, mirror = 1) {
    const sh = new THREE.Shape(); const P = mirror < 0 ? pts.slice().reverse() : pts;
    P.forEach(([x, z], i) => i ? sh.lineTo(mirror * x, z) : sh.moveTo(mirror * x, z));
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }); g.rotateX(PI / 2); g.translate(0, y, 0); return this.add(g, paint, tm, em);
  }
  // a smooth shell lofted through elliptical sections [y, rx, rz, cx = 0, cz = 0] (bottom to top), closed with caps:
  // torsos, helmets, hulls. axis: a unit vector the sections are stacked along (default up); the whole shell is then placed at (x, y, z)
  loft(secs, seg, x, y, z, paint, tm = 0, em = 0, axis = null, ry = 0) {
    const pos = [], idx = [], n = secs.length;
    for (let i = 0; i < n; i++) { const [sy, rx, rz, cx = 0, cz = 0] = secs[i]; for (let k = 0; k < seg; k++) { const a = k / seg * PI * 2; pos.push(cx + Math.cos(a) * rx, sy, cz + Math.sin(a) * rz); } }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) { const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
    const b0 = pos.length / 3; pos.push(secs[0][3] || 0, secs[0][0], secs[0][4] || 0); const t0 = pos.length / 3; pos.push(secs[n - 1][3] || 0, secs[n - 1][0], secs[n - 1][4] || 0);
    for (let k = 0; k < seg; k++) { idx.push(b0, (k + 1) % seg, k); idx.push(t0, (n - 1) * seg + k, (n - 1) * seg + (k + 1) % seg); }
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    if (seg <= 8) g = g.toNonIndexed(); g.computeVertexNormals(); // few sides: a faceted hull with flat faces; many: a smooth skin
    if (axis) { _d.set(axis[0], axis[1], axis[2]).normalize(); _q.setFromUnitVectors(_y, _d); g.applyQuaternion(_q); }
    if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(g, paint, tm, em);
  }
  // a jointed limb: a tapered segment from a to b with a ball at b (the joint), so limbs bend without a seam
  jlimb(a, b, ra, rb, seg, paint, tm = 0, ball = null) { this.limb(a, b, ra, rb, seg, paint, tm); if (ball) this.sph(ball, 10, 7, b[0], b[1], b[2], paint, tm); return this; }
  // a hull lofted along +Z through sections [z, halfWidth, halfHeight, centreY] (tail to nose), placed at (x, y, z)
  hull(secs, seg, x, y, z, paint, tm = 0, em = 0) { return this.loft(secs.map(([zz, hw, hh, cy = 0]) => [zz, hw, hh, 0, -cy]), seg, x, y, z, paint, tm, em, [0, 0, 1]); }
  both(fn) { fn(1); fn(-1); return this; }
  build() { const g = mergeGeometries(this.parts); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.tris = this.tris; g.userData.parts = this.parts.map(p => p.attributes.position.count); return g; } // part ranges: groundanim.js tags each whole part with a bone
}

// ---------------------------------------------------------------- a human body, built at a rig's joints
// J: the joints groundanim.js expects (hip, knee, ankle, shoulder, elbow, hand per side; waist, neck, head), so every part
// is split at a joint and centred where the rig's classify() finds it. D: the build — radii of thigh, knee, shin, ankle,
// upper arm, elbow, forearm; torso half-widths at hips, waist, ribs, chest and shoulders; depths; head radius. P: paints.
// Anatomy that reads at battle distance: thighs thicker at the top, a calf, a ball at every joint, a V torso from wide
// shoulders to a narrow waist over a pelvis, a neck, a rounded skull. Armour goes on over it in each kind's builder.
function human(F, J, D, P) {
  const { thigh, knee, shin, ankle, upper, elbow, fore, hand } = D, s = D.seg || 10;
  // joint caps: a ball centred exactly on every pivot, a little wider than the limb ends that meet there, so when the rig
  // bends a knee to 100° or whips a forearm the flat ends of the two limbs stay inside the ball and no gap opens. The
  // limb ends are tapered to .88 of the ball so their rims never poke out. (A ball centred on the pivot looks the same
  // whichever bone it rides.)
  const KB = knee * 1.15, EB = elbow * 1.15, HB = thigh * 1.06, AB = ankle * 1.2, SB = upper * 1.28;
  for (const side of ['R', 'L']) {
    const hip = J['hip' + side], kn = J['knee' + side], an = J['ank' + side], sh = J['sh' + side], el = J['el' + side], hd = J['hand' + side];
    // leg: hip ball, thigh (quad bulge high), knee ball, shin with a calf, ankle ball
    F.sph(HB, 8, 6, hip[0], hip[1], hip[2], P.thigh);
    F.limb(hip, kn, thigh, KB * .88, s, P.thigh); F.sph(thigh * 1.08, 8, 6, hip[0], hip[1] - (hip[1] - kn[1]) * .22, hip[2] + (kn[2] - hip[2]) * .22, P.thigh, 0, 1.3, 1);
    F.sph(KB, 8, 6, kn[0], kn[1], kn[2], P.knee);
    F.limb(kn, an, KB * .88, AB * .88, s, P.shin); F.sph(shin * 1.12, 8, 6, kn[0], kn[1] - (kn[1] - an[1]) * .3, kn[2] - (kn[2] - an[2]) * .3 - shin * .25, P.shin, 0, 1.5, 1);
    F.sph(AB, 8, 6, an[0], an[1], an[2], P.shin);
    // arm: deltoid ball on the shoulder pivot, upper arm, elbow ball, forearm (thicker near the elbow), hand
    if (sh && el && hd) {
      F.sph(SB, 8, 6, sh[0], sh[1], sh[2], P.upper);
      F.limb(sh, el, upper, EB * .88, s, P.upper); F.sph(EB, 8, 6, el[0], el[1], el[2], P.elbow);
      F.limb(el, hd, EB * .88, fore * .8, s, P.fore);
      if (hand) F.sph(hand, 8, 6, hd[0], hd[1], hd[2], P.hand, 0, .8, 1.3);
    }
  }
  // pelvis and torso: one shell each, lofted through the rig's heights; a flattened ball on the waist pivot and one on
  // the neck pivot fill the gap when the spine bends or the head turns
  const w = J.waist[1], nk = J.neck[1], hipY = J.hipR[1], hw = D.hips, ww = D.waist, rw = D.ribs, cw = D.chest, sw = D.shoulders, dp = D.depth;
  F.loft([[hipY - .06, hw * .85, dp * .9], [hipY + .04, hw, dp], [w, ww * 1.02, dp * .92]], 12, 0, 0, 0, P.pelvis);
  F.sph(ww * .98, 10, 6, 0, w, 0, P.pelvis, 0, .55, dp * .9 / ww);
  const ch = w + (nk - w) * .62, sb = nk - (nk - w) * .12;
  F.loft([[w - .005, ww, dp * .9], [w + (ch - w) * .5, rw, dp * .98, 0, .01], [ch, cw, dp * 1.05, 0, .02], [sb, sw, dp * .95, 0, .01], [nk - .01, sw * .72, dp * .7, 0, .0]], 12, 0, 0, 0, P.chest);
  F.sph(D.neck * 1.35, 8, 6, 0, nk, 0, P.neck);
  F.cyl(D.neck, D.neck * 1.1, (J.head - nk) * .7, 10, 0, nk + (J.head - nk) * .3, 0, P.neck);
  F.sph(D.head, 14, 10, 0, J.head, 0, P.head, 0, 1.12, 1.02);
  return F;
}

// ---------------------------------------------------------------- the Grays (1.8 m) — modern tactical troopers
// stance: feet apart, right foot a half-step forward, weight on the front foot, rifle shouldered
const GRAY_J = { hipR: [.13, .96, 0], hipL: [-.13, .96, 0], kneeR: [.14, .5, .08], kneeL: [-.14, .5, -.04], ankR: [.14, .1, .1], ankL: [-.14, .1, -.07],
  waist: [0, 1.04, 0], neck: [0, 1.6, 0], head: 1.71, shR: [.22, 1.48, .02], shL: [-.22, 1.48, .02], elR: [.25, 1.22, .18], elL: [-.23, 1.24, .22], handR: [.17, 1.16, .22], handL: [-.08, 1.2, .44] };
const GRAY_D = { thigh: .085, knee: .07, shin: .066, ankle: .05, upper: .056, elbow: .05, fore: .05, hand: .045, hips: .17, waist: .14, ribs: .17, chest: .2, shoulders: .225, depth: .11, neck: .05, head: .105, seg: 8 };
function grayBody(F, o = {}) {
  const arm = o.arm || C.duro, dark = o.dark || C.duroD, J = GRAY_J;
  human(F, J, GRAY_D, { thigh: arm, knee: dark, shin: arm, upper: arm, elbow: dark, fore: arm, hand: C.pack, pelvis: dark, chest: arm, neck: C.pack, head: dark });
  // duroArmor over the body: boots, shin guards, thigh plates, belt, cuirass with a sloped chest plate, pauldrons, pack, helmet
  F.both(s => { const z = s > 0 ? .1 : -.07; F.rbox(.15, .09, .2, .03, 2, s * .14, .055, z - .02, C.boot); F.sph(.07, 8, 6, s * .14, .05, z + .11, C.boot, 0, .75, 1.2); F.rbox(.16, .05, .22, .02, 2, s * .14, .09, z - .02, dark); }); // boots: heel block, rounded toe, cuff
  F.both(s => { const kn = s > 0 ? J.kneeR : J.kneeL; F.sph(.085, 8, 6, kn[0], kn[1] + .01, kn[2] + .03, dark, 0, .9, .7); });                       // knee pads
  F.rbox(.36, .09, .25, .03, 2, 0, 1.03, 0, dark); F.box(.1, .07, .05, 0, 1.03, .13, C.duroL);                            // belt and buckle
  F.rbox(.4, .34, .14, .05, 3, 0, 1.34, .07, arm, 0, 0, .08);                                                            // cuirass front, leaning in
  F.rbox(.3, .2, .05, .02, 2, 0, 1.4, .15, C.duroL, 0, 0, .16);                                                           // chest plate, sloped
  F.rbox(.34, .36, .12, .04, 3, 0, 1.3, -.17, C.pack);                                                                   // pack
  F.both(s => F.rbox(.05, .3, .04, .01, 2, s * .12, 1.34, .06, C.pack, 0, 0, .1));                                       // pack straps
  F.both(s => F.sph(.105, 10, 7, s * .245, 1.51, .01, C.team, 1, .62, 1.1));                                               // pauldrons: half-domes (team)
  F.sph(.125, 14, 10, 0, 1.71, 0, dark, 0, 1.08, 1.02);                                                                  // helmet shell
  F.loft([[1.6, .11, .1, 0, -.02], [1.66, .135, .125, 0, -.01], [1.72, .13, .12]], 12, 0, 0, 0, dark);                   // helmet skirt / neck guard
  F.box(.16, .04, .03, 0, 1.7, .12, C.visor, 0, 0, 0, 0, .6);                                                            // visor slit (faint glow)
  F.rbox(.2, .05, .22, .02, 2, 0, 1.8, .01, arm, 0, 0, .08);                                                             // brow ridge
  F.box(.04, .07, .18, 0, 1.87, -.02, C.team, 1);                                                                        // crest (team)
  return F;
}
function legionnaire() {
  const F = grayBody(new Fig());
  F.rbox(.06, .09, .34, .02, 2, .16, 1.2, .2, C.gun); F.rbox(.05, .06, .12, .015, 2, .16, 1.17, -.02, C.gun, 0, 0, .1);   // scorcher receiver and stock
  F.cyl(.018, .022, .5, 8, .16, 1.23, .58, C.gun, 0, PI / 2); F.cyl(.03, .03, .16, 8, .16, 1.23, .42, C.duroD, 0, PI / 2); // barrel and shroud
  F.rbox(.035, .035, .36, .01, 2, .16, 1.265, .5, C.duroL); F.box(.02, .02, .3, .16, 1.265, .5, C.edge, 0, 0, 0, 0, .35);   // charge rail, faintly lit
  F.rbox(.04, .12, .06, .01, 2, .16, 1.11, .12, C.gun, 0, 0, .15); F.box(.03, .07, .04, .16, 1.12, .02, C.gun, 0, 0, -.3); // magazine and grip
  return F.build();
}
function railman() {
  const F = grayBody(new Fig(), { arm: '#7a808a' });
  F.box(.08, .12, .4, .16, 1.2, .2, C.gun);                      // railRifle receiver
  F.cyl(.025, .03, 1.0, 8, .16, 1.24, .9, C.gun, 0, PI / 2);     // long barrel
  F.box(.03, .03, .9, .16, 1.29, .85, C.edge, 0, 0, 0, 0, .9);   // the rail, lit blue-white
  F.rbox(.36, .5, .22, .05, 2, 0, 1.26, -.27, '#2e3036');        // capacitor pack
  F.cyl(.05, .05, .36, 8, .1, 1.5, -.3, C.edge, 0, PI / 2, 0, 0, false, .5); // coil, glowing
  return F.build();
}

// ---------------------------------------------------------------- Obsidian shock (2.45 m) — braided, fur-draped giant
const OBS_J = { hipR: [.19, 1.32, 0], hipL: [-.19, 1.32, 0], kneeR: [.2, .72, .07], kneeL: [-.2, .72, -.05], ankR: [.21, .14, .08], ankL: [-.21, .14, -.09],
  waist: [0, 1.5, 0], neck: [0, 2.42, 0], head: 2.6, shR: [.5, 2.22, 0], shL: [-.5, 2.22, 0], elR: [.53, 1.82, .2], elL: [-.49, 1.82, .12], handR: [.5, 1.5, .4], handL: [-.44, 1.42, .3] };
const OBS_D = { thigh: .145, knee: .11, shin: .115, ankle: .085, upper: .14, elbow: .105, fore: .12, hand: .085, hips: .3, waist: .27, ribs: .34, chest: .39, shoulders: .44, depth: .21, neck: .1, head: .165, seg: 10 };
function obsidian() {
  const F = new Fig(), J = OBS_J;
  human(F, J, OBS_D, { thigh: C.obs, knee: C.bone, shin: C.obs, upper: C.skin, elbow: C.obsD, fore: C.obs, hand: C.skin, pelvis: C.obsD, chest: C.obsL, neck: C.skin, head: C.obs });
  F.both(s => { const z = s > 0 ? .12 : -.1; F.rbox(.24, .14, .3, .04, 2, s * .22, .08, z - .04, C.obsD); F.sph(.12, 8, 6, s * .22, .08, z + .14, C.obsD, 0, .8, 1.2); F.rbox(.26, .1, .34, .03, 2, s * .22, .17, z - .04, C.fur); }); // boots, fur-cuffed
  F.both(s => F.sph(.12, 8, 6, s * .2, .76, s > 0 ? .12 : 0, C.bone, 0, 1.1, .7));                                    // bone knee guards
  F.rbox(.62, .22, .42, .07, 3, 0, 1.46, 0, C.obsD); F.rbox(.2, .14, .06, .02, 2, 0, 1.46, .22, C.bone);                // belt and bone buckle
  F.rbox(.56, .36, .12, .06, 3, 0, 1.98, .2, C.obsD, 0, 0, .12);                                                         // breast plate (dark)
  F.loft([[2.2, .5, .28, 0, -.02], [2.3, .56, .3, 0, -.02], [2.4, .5, .27, 0, -.03]], 12, 0, 0, 0, C.fur);               // fur mantle round the shoulders
  F.both(s => { F.sph(.2, 10, 7, s * .5, 2.3, 0, C.team, 1, .7, 1.2); F.cyl(.0, .04, .26, 6, s * .62, 2.5, 0, C.bone, 0, 0, -s * .5); }); // pauldrons (team), tusk spikes
  F.sph(.18, 12, 9, 0, 2.6, 0, C.obs, 0, 1.05, 1.0);                                                                    // helm over the skull
  F.loft([[2.44, .16, .15], [2.52, .19, .17], [2.6, .19, .17]], 12, 0, 0, 0, C.obs);                                      // helm skirt
  F.box(.26, .07, .05, 0, 2.6, .17, C.visor, 0, 0, 0, 0, .5);                                                            // eye slit
  F.rbox(.2, .14, .1, .03, 2, 0, 2.47, .19, C.bone);                                                                     // jaw / skull mask
  F.both(s => F.cyl(.0, .04, .3, 6, s * .18, 2.78, -.02, C.bone, 0, 0, -s * .7));                                        // horns
  F.limb([0, 2.76, -.12], [0, 2.3, -.42], .06, .05, 8, C.hair); F.limb([.1, 2.7, -.14], [.22, 2.1, -.38], .035, .03, 6, C.hair); F.limb([-.1, 2.7, -.14], [-.22, 2.1, -.38], .035, .03, 6, C.hair); // braids down the back
  // pulseAxe: a long haft tilted forward, a crescent head above the helm with a glowing edge
  F.limb([.46, .9, .1], [.56, 3.2, .5], .03, .03, 8, C.haft);
  F.rbox(.08, .56, .3, .02, 2, .56, 2.95, .62, C.obsD, 0, 0, .15); F.rbox(.08, .3, .22, .02, 2, .56, 3.22, .52, C.obsD, 0, 0, .15); F.rbox(.08, .3, .22, .02, 2, .56, 2.66, .66, C.obsD, 0, 0, .15); // crescent head
  F.box(.03, .9, .06, .56, 2.95, .78, C.edge, 0, 0, .15, 0, 1.0);  // the edge
  F.box(.06, .34, .1, .56, 2.95, .34, C.obsD, 0, 0, .15);         // back spike
  F.rbox(.1, .14, .26, .02, 2, -.44, 1.36, .4, C.gun); F.box(.03, .03, .08, -.44, 1.4, .54, C.edge, 0, 0, 0, 0, .5); // plasma pistol
  return F.build();
}

// ---------------------------------------------------------------- Gold Peerless (2.1 m) and the Legate (banner)
const GOLD_J = { hipR: [.12, 1.02, 0], hipL: [-.12, 1.02, 0], kneeR: [.13, .56, .04], kneeL: [-.13, .56, -.03], ankR: [.13, .1, .07], ankL: [-.13, .1, -.05],
  waist: [0, 1.14, 0], neck: [0, 1.78, 0], head: 1.88, shR: [.27, 1.66, .02], shL: [-.27, 1.66, .02], elR: [.28, 1.38, .22], elL: [-.29, 1.49, .2], handR: [.26, 1.16, .46], handL: [-.3, 1.5, .5] };
const GOLD_D = { thigh: .08, knee: .065, shin: .062, ankle: .048, upper: .055, elbow: .05, fore: .05, hand: .045, hips: .16, waist: .13, ribs: .165, chest: .2, shoulders: .23, depth: .11, neck: .05, head: .105, seg: 10 };
function goldBody(F) {
  const J = GOLD_J;
  human(F, J, GOLD_D, { thigh: C.gilt, knee: C.giltL, shin: C.gilt, upper: C.gilt, elbow: C.giltD, fore: C.giltD, hand: C.giltL, pelvis: C.giltD, chest: C.gilt, neck: C.giltD, head: C.gilt });
  F.both(s => { const z = s > 0 ? .07 : -.05; F.rbox(.14, .09, .2, .03, 2, s * .13, .05, z - .02, C.giltD); F.sph(.065, 8, 6, s * .13, .045, z + .1, C.giltD, 0, .7, 1.2); F.box(.12, .03, .26, s * .13, .01, z, C.lens, 0, 0, 0, 0, 1.0); }); // gravBoots, soles lit
  F.both(s => F.sph(.075, 8, 6, s * .13, .57, s > 0 ? .08 : .01, C.giltL, 0, 1.0, .7));                                 // knee plates
  F.rbox(.34, .1, .22, .03, 2, 0, 1.12, 0, C.giltD); F.box(.08, .07, .04, 0, 1.12, .12, C.giltK);                         // belt and clasp
  F.rbox(.38, .36, .12, .05, 3, 0, 1.5, .08, C.giltL, 0, 0, .06);                                                         // sculpted cuirass front
  F.rbox(.2, .18, .04, .02, 2, 0, 1.56, .16, C.gilt, 0, 0, .16); F.box(.07, .11, .03, 0, 1.53, .19, C.giltK, 0, 0, .16);    // breastplate relief and sigil
  F.both(s => F.sph(.095, 10, 7, s * .27, 1.7, .01, C.team, 1, .6, 1.15));                                               // pauldrons (team)
  F.both(s => F.sph(.1, 10, 7, s * .27, 1.68, .01, C.giltL, 0, .25, 1.2));                                                // their gilt rims
  F.sph(.12, 14, 10, 0, 1.88, 0, C.gilt, 0, 1.1, 1.0);                                                                   // helm
  F.loft([[1.78, .1, .09], [1.84, .125, .115], [1.9, .12, .11]], 12, 0, 0, 0, C.gilt);                                     // helm skirt
  F.box(.16, .04, .03, 0, 1.885, .12, C.visor, 0, 0, 0, 0, .6);                                                           // visor
  F.loft([[1.96, .13, .13], [2.0, .15, .14], [2.04, .1, .1]], 12, 0, 0, 0, C.giltL);                                       // lion mane: crown ring
  F.both(s => F.rbox(.06, .16, .2, .02, 2, s * .14, 2.02, -.02, C.giltL, 0, 0, 0, -s * .5));                              // mane side flares
  F.rbox(.06, .16, .28, .02, 2, 0, 2.08, -.02, C.team, 1);                                                                // crest (team)
  F.box(.5, .5, .035, 0, 1.5, -.2, C.team, 1, 0, .1);                                                        // cape, upper
  F.box(.58, .7, .035, 0, .9, -.3, C.team, 1, 0, .18);                                                       // cape, lower, flaring
  F.box(.56, .06, .04, 0, .56, -.36, C.giltL, 0, 0, .18);                                                                 // cape hem
  F.rbox(.1, .1, .12, .025, 2, .26, 1.14, .48, C.giltL);                                                                  // right gauntlet
  F.bar([.26, 1.12, .54], [.24, .78, 1.5], .03, .035, C.razor, 0, .9);                                                    // the razor, rigid, lit
  F.rbox(.17, .17, .22, .04, 2, -.3, 1.52, .58, C.giltL);                                                                 // pulseFist
  F.box(.09, .09, .05, -.3, 1.52, .71, C.pulse, 0, 0, 0, 0, 1.0);                                                          // its emitter, lit
  return F;
}
const peerless = () => goldBody(new Fig()).build();
function legate() {
  const F = goldBody(new Fig());
  F.cyl(.02, .024, 3.4, 8, -.46, 1.7, -.2, C.giltD);             // standard pole
  F.box(.5, .04, .04, -.46, 3.1, -.2, C.giltL);                  // crossbar
  F.sph(.07, 10, 8, -.46, 3.48, -.2, C.giltL, 0, 1.3, 1, .4);    // finial, lit
  F.box(.035, .55, .46, -.46, 2.8, -.46, C.team, 1);   // banner (team), hanging from the crossbar
  F.box(.035, .12, .46, -.46, 2.46, -.46, C.giltL);              // fringe
  F.box(.035, .14, .14, -.46, 2.8, -.46, C.giltK);               // device on the banner
  return F.build();
}

// ---------------------------------------------------------------- StarShell (3.7 m, ~3 t): a knight's build at twice the height
const SHELL_J = { hipR: [.3, 1.86, 0], hipL: [-.3, 1.86, 0], kneeR: [.33, 1.04, .06], kneeL: [-.33, 1.04, 0], ankR: [.34, .2, .1], ankL: [-.34, .2, -.06],
  waist: [0, 2.12, 0], neck: [0, 3.36, 0], head: 3.48, shR: [.64, 3.1, 0], shL: [-.64, 3.1, 0], elR: [.78, 2.36, .1], elL: [-.78, 2.36, -.05], handR: [.8, 1.6, .5], handL: [-.82, 1.55, .25] };
const SHELL_D = { thigh: .2, knee: .17, shin: .18, ankle: .14, upper: .16, elbow: .15, fore: .18, hand: 0, hips: .45, waist: .36, ribs: .46, chest: .53, shoulders: .6, depth: .3, neck: .14, head: .2, seg: 12 };
function starshell() {
  const F = new Fig(), J = SHELL_J;
  human(F, J, SHELL_D, { thigh: C.shellL, knee: C.shellD, shin: C.shell, upper: C.shell, elbow: C.shellD, fore: C.shellL, hand: C.shellD, pelvis: C.shellD, chest: C.shellL, neck: C.vent, head: C.shellD });
  F.both(s => { const z = s > 0 ? .14 : -.1; F.rbox(.44, .24, .56, .07, 3, s * .34, .13, z - .1, C.shellD); F.sph(.22, 10, 7, s * .34, .14, z + .26, C.shellD, 0, .6, 1.3); F.box(.36, .06, .7, s * .34, .02, z, C.lens, 0, 0, 0, 0, .8); }); // boots, gravBoot soles lit
  F.both(s => F.sph(.22, 10, 7, s * .33, 1.06, s > 0 ? .14 : .08, C.shellL, 0, .9, .7));                                  // knee plates
  F.both(s => F.rbox(.26, .5, .5, .06, 3, s * .5, 1.8, 0, C.shellD, 0, 0, 0, -s * .15));                                   // hip guards
  F.rbox(.7, .5, .16, .06, 3, 0, 2.9, .34, C.shell, 0, 0, .18);                                                           // breastplate
  F.box(.5, .08, .1, 0, 3.0, .42, C.lens, 0, 0, .18, 0, 1.0);                                                             // chest sensor bar, lit
  F.loft([[2.4, .36, .2, 0, -.42], [2.75, .4, .22, 0, -.48], [3.15, .34, .18, 0, -.44]], 12, 0, 0, 0, C.shellD);           // back pack
  F.both(s => { F.cyl(.11, .13, .5, 10, s * .25, 2.95, -.74, C.vent); F.cyl(.1, .13, .14, 10, s * .25, 2.62, -.74, C.exhaust, 0, 0, 0, 0, false, .9); }); // twin thrusters, lit
  F.both(s => { F.sph(.34, 12, 8, s * .62, 3.24, 0, C.team, 1, .55, 1.1); F.sph(.35, 12, 8, s * .62, 3.2, 0, C.shellL, 0, .25, 1.12); }); // pauldrons (team) with a rim
  F.sph(.22, 14, 10, 0, 3.48, .02, C.shellD, 0, 1.0, 1.0);        // helm
  F.loft([[3.36, .2, .18], [3.44, .24, .22], [3.5, .23, .21]], 12, 0, 0, 0, C.shellD);                                     // helm skirt
  F.box(.34, .08, .06, 0, 3.49, .2, C.lens, 0, 0, 0, 0, 1.0);     // visor, lit
  F.rbox(.4, .08, .4, .03, 2, 0, 3.68, 0, C.shell);               // crown plate
  F.cyl(.13, .13, 1.0, 12, .8, 1.75, .85, C.cannon, 0, PI / 2 - .35); F.cyl(.15, .12, .22, 12, .8, 1.95, 1.3, C.shellD, 0, PI / 2 - .35); // pulseCannon along the right forearm, muzzle
  F.rbox(.4, .34, .36, .06, 3, -.82, 1.4, .3, C.shellD); F.both(s => F.rbox(.1, .18, .2, .03, 2, -.82 + s * .13, 1.26, .4, C.vent)); // the fist
  F.rbox(.42, .34, .62, .05, 3, -.62, 3.62, -.2, C.shellD, 0, 0, .2); // missile pod over the left pauldron
  for (let i = 0; i < 6; i++) F.cyl(.055, .055, .1, 8, -.76 + (i % 3) * .14, 3.56 + Math.floor(i / 3) * .15, .1 - Math.floor(i / 3) * .04, C.vent, 0, PI / 2 + .2);
  return F.build();
}

// ---------------------------------------------------------------- QR-13 gravPod (origin: underside of the hull): an armoured sled
function gravpod() {
  const F = new Fig();
  F.loft([[0, 1.3, 1.3], [.18, 1.72, 1.72], [.42, 1.78, 1.78], [.62, 1.5, 1.5], [.72, .9, .9]], 20, 0, 0, 0, C.pod);        // hull: a smooth saucer
  F.cyl(1.8, 1.8, .1, 20, 0, .42, 0, C.team, 1, 0, 0, 0, true);                                                             // team band round the rim (open)
  F.hull([[-.2, .5, .2, .3], [1.2, .7, .24, .3], [1.9, .3, .1, .36]], 10, 0, 0, 0, C.podD);                                   // prow fairing
  for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3 + PI / 6; F.cyl(.3, .4, .22, 14, Math.cos(a) * 1.0, .04, Math.sin(a) * 1.0, C.lens, 0, 0, 0, 0, false, 1.0); } // grav emitters, lit
  F.loft([[.7, .8, .8], [.85, .9, .9], [1.15, .82, .82], [1.4, .55, .55], [1.5, .3, .3]], 16, 0, 0, 0, C.pod);              // turret: a low dome
  F.rbox(1.3, .7, .12, .05, 3, 0, 1.2, .62, C.podL, 0, 0, -.2);                                                              // gun shield
  F.cyl(.14, .16, 2.8, 14, 0, 1.18, 1.9, C.cannon, 0, PI / 2);                                                               // QR-13 barrel
  F.cyl(.22, .24, .8, 14, 0, 1.18, .8, C.podD, 0, PI / 2);                                                                   // recoil sleeve
  F.cyl(.19, .16, .3, 14, 0, 1.18, 3.3, C.podD, 0, PI / 2);                                                                  // muzzle brake
  F.rbox(.3, .26, .5, .06, 2, -.55, 1.15, -.1, C.podD);                                                                      // feed box
  F.both(s => F.cyl(.18, .18, .5, 12, s * .9, .7, -.9, C.crate, 0, 0, PI / 2));                                              // ammo drums
  F.both(s => F.bar([s * 1.4, .55, -1.2], [s * 1.4, .55, 1.0], .04, .04, C.podL));                                           // side rails
  F.sph(.11, 10, 8, .5, 1.5, -.7, C.duroD); F.loft([[.95, .13, .1], [1.2, .16, .12], [1.38, .11, .09]], 8, .5, 0, -.7, C.duro); // the gunner
  F.sph(.11, 10, 8, -.9, 1.25, -.9, C.duroD); F.loft([[.75, .13, .1], [.95, .16, .12], [1.13, .11, .09]], 8, -.9, 0, -.9, C.duro); // the loader, kneeling
  return F.build();
}

// ---------------------------------------------------------------- Sarissa battery (origin: ground): a crewed launcher rack
function sarissa() {
  const F = new Fig();
  for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3 + PI / 2; F.limb([Math.cos(a) * .1, 1.25, Math.sin(a) * .1], [Math.cos(a) * .95, .06, Math.sin(a) * .95], .07, .05, 8, C.podD); F.rbox(.3, .08, .3, .03, 2, Math.cos(a) * .95, .04, Math.sin(a) * .95, C.podD); }
  F.cyl(.38, .34, .36, 14, 0, 1.2, 0, C.pod);                     // hub
  F.rbox(.5, .44, .5, .06, 2, 0, 1.52, 0, C.podD);                // pivot
  const el = PI / 3, ce = Math.cos(el), se = Math.sin(el);        // tubes elevated 60°, pointing up and forward
  F.rbox(1.16, .86, .36, .05, 3, 0, 2.0, .45, C.pod, 0, 0, el);   // the rack frame
  F.box(1.2, .12, .38, 0, 2.0, .45, C.team, 1, 0, el);            // team stripe
  F.both(s => F.rbox(.08, .9, 1.4, .03, 2, s * .64, 2.0, .45, C.podL, 0, 0, el)); // blast shields either side
  for (let i = 0; i < 6; i++) { const x = -.36 + (i % 3) * .36, yy = -.24 + Math.floor(i / 3) * .48, y = 2.0 + yy * ce, z = .45 + yy * se;
    F.cyl(.11, .11, 2.3, 12, x, y, z, C.tube, 0, el); F.cyl(.09, .09, .06, 12, x, y + 1.15 * ce, z + 1.15 * se, C.vent, 0, el); }
  F.cyl(.28, .05, .12, 14, .9, 2.7, -.4, C.podL, 0, -.6); F.cyl(.025, .03, .9, 8, .9, 2.15, -.35, C.podD); // targeting dish on a mast
  F.both(s => { F.sph(.11, 10, 8, s * 1.05, 1.0, -.6, C.duroD); F.rbox(.34, .5, .24, .05, 2, s * 1.05, .65, -.6, C.duro); F.rbox(.17, .08, .24, .02, 2, s * 1.05, .92, -.6, C.team, 1); }); // crew, crouched
  F.rbox(.6, .4, .4, .04, 2, 0, .2, -1.3, C.crate); F.rbox(.6, .4, .4, .04, 2, .7, .2, -1.4, C.crate); F.rbox(.5, .3, .5, .04, 2, -.4, .15, -1.5, C.olive); // crates, console
  return F.build();
}

// ---------------------------------------------------------------- the fallen (≤ 300 tris)
// the fallen (origin at the hips, lying face down along +Z, head forward, feet at -leg): one for each kind of body
// L: leg length, hip half-width, limb radii, torso half-widths, head radius. Low-poly: thousands lie on a field at once.
function fallenBody(F, L, P) {
  const { leg, hip, thigh, shin, upper, fore, waist, chest, head, hh } = L, y = hh;           // hh: how thick the body lies (its half height)
  F.both(s => { const sp = s * (hip + .06), kz = -leg * .5, fz = -leg * .95; F.limb([s * hip, y, 0], [sp, y * .9, kz], thigh, thigh * .85, 6, P.thigh); F.sph(thigh * .95, 6, 4, sp, y * .9, kz, P.thigh); F.limb([sp, y * .9, kz], [sp * 1.3, y * .8, fz], thigh * .85, shin * .8, 6, P.shin); F.box(shin * 2.2, shin * 1.6, shin * 3, sp * 1.3, y * .75, fz - shin, P.boot); }); // legs, one knee a little bent
  F.hull([[-.08, hip * 1.1, y * .9, y * .9], [.18, waist, y, y], [.5, chest, y * 1.05, y * 1.05], [.72, chest * .9, y, y]], 8, 0, 0, 0, P.chest);            // the torso, face down
  F.sph(head, 7, 5, 0, head * .9, .72 + head * 1.1, P.head, 0, 1, 1.1);                                                                                           // the head, turned
  F.limb([chest * .9, y, .62], [chest * 2.6, head * .6, .92], upper, fore * .9, 5, P.arm); F.limb([-chest * .9, y, .6], [-chest * 1.9, head * .5, .1], upper, fore * .9, 5, P.arm); // arms flung out and back
  return F;
}
function corpse() {   // a Gray
  const F = fallenBody(new Fig(), { leg: .95, hip: .13, thigh: .085, shin: .066, upper: .055, fore: .05, waist: .15, chest: .21, head: .11, hh: .12 }, { thigh: C.duro, shin: C.duro, boot: C.boot, chest: C.duro, head: C.duroD, arm: C.duro });
  F.sph(.1, 6, 4, .26, .18, .6, C.team, 1, .5, 1.1);                                                                   // one pauldron showing the colour
  F.box(.3, .14, .34, 0, .26, .36, C.pack);                                                                   // the pack on top
  F.cyl(.02, .02, .7, 6, -.5, .05, .45, C.gun, 0, PI / 2, 0, .3);                                                       // the dropped scorcher
  return F.build();
}
function corpseObs() {   // an Obsidian: a long body, fur mantle up, the axe beside the hand
  const F = fallenBody(new Fig(), { leg: 1.3, hip: .19, thigh: .145, shin: .115, upper: .14, fore: .12, waist: .27, chest: .39, head: .17, hh: .22 }, { thigh: C.obs, shin: C.obs, boot: C.obsD, chest: C.obsL, head: C.obs, arm: C.skin });
  F.hull([[.5, .46, .14, .36], [.8, .5, .12, .34]], 8, 0, 0, 0, C.fur);                                                 // fur mantle
  F.sph(.2, 8, 5, .5, .3, .62, C.team, 1, .5, 1.1); F.cyl(0, .04, .26, 5, .62, .34, .62, C.bone, 0, 0, -.5);              // pauldron (team) and tusk
  F.limb([.9, .08, 1.6], [1.1, .08, -.6], .03, .03, 6, C.haft); F.rbox(.08, .3, .5, .02, 2, 1.05, .16, 1.3, C.obsD, 0, 0, 0, PI / 2); // the pulseAxe, fallen beside
  return F.build();
}
function corpseGold() {   // a Gold: the cape spread flat over the body, the razor gone slack
  const F = fallenBody(new Fig(), { leg: 1.0, hip: .12, thigh: .08, shin: .062, upper: .055, fore: .05, waist: .14, chest: .21, head: .11, hh: .12 }, { thigh: C.gilt, shin: C.gilt, boot: C.giltD, chest: C.gilt, head: C.gilt, arm: C.gilt });
  F.plate([[-.3, .9], [.32, .9], [.4, -.2], [.1, -.6], [-.35, -.3]], .03, .27, C.team, 1);                                   // the cape, spread on the ground
  F.sph(.1, 8, 5, .25, .19, .6, C.giltL, 0, .5, 1.1); F.rbox(.08, .1, .22, .02, 2, 0, .16, .95, C.giltL);                 // a pauldron rim, the lion-mane crown
  F.bar([.6, .04, 1.0], [1.3, .04, 1.6], .03, .03, C.razor, 0, .3);                                                      // the razor, dim
  return F.build();
}
function corpseShell() {   // a StarShell: the suit down on its face, pack and thrusters uppermost
  const F = fallenBody(new Fig(), { leg: 1.8, hip: .3, thigh: .2, shin: .18, upper: .16, fore: .18, waist: .36, chest: .55, head: .21, hh: .32 }, { thigh: C.shellL, shin: C.shell, boot: C.shellD, chest: C.shellL, head: C.shellD, arm: C.shell });
  F.hull([[.1, .4, .18, .6], [.6, .44, .2, .64], [1.0, .38, .16, .6]], 8, 0, 0, 0, C.shellD);                              // the pack on top
  F.both(s => F.cyl(.11, .13, .5, 8, s * .25, .62, .3, C.vent, 0, PI / 2));                                                // thrusters, dark
  F.both(s => F.sph(.34, 8, 5, s * .64, .5, .95, C.team, 1, .5, 1.1));                                                     // pauldrons (team)
  F.cyl(.13, .13, 1.0, 8, 1.3, .14, 1.5, C.cannon, 0, PI / 2, 0, .4);                                                     // the pulseCannon arm, out
  return F.build();
}

// ---------------------------------------------------------------- the Stork (~70 m; origin at the fuselage centre)
// a hard-edged military lifter: a deep slab-sided cargo body with rounded chamfers, a raised flight deck, swept stub
// wings carrying four lift nacelles, two main thrusters, a tail boom and fin
function stork() {
  const F = new Fig();
  // fuselage: one lofted body from the tail boom through the deep cargo hold to the flight deck and chin
  F.hull([[-38, 4, 3, 2], [-30, 7, 5, 1], [-22, 10.5, 7.5, -.5], [-10, 11.5, 8, -1], [4, 11.5, 8, -1], [14, 10, 7, -.5], [22, 7.5, 5, .5], [28, 5, 3.2, -.5], [31, 2.5, 1.5, -1.5]], 8, 0, 0, 0, C.hull); // eight sides: flat flanks and chamfers, a lifter not a blimp
  F.hull([[-26, 8, 1.2, -7.2], [-8, 9, 1.4, -7.6], [10, 9, 1.4, -7.6], [20, 6, 1, -7]], 10, 0, 0, 0, C.belly);                       // belly plate
  F.hull([[8, 4.5, 2.2, 6.6], [14, 4.8, 2.4, 6.8], [19, 4.2, 2.0, 6.6], [22, 2.8, 1.2, 6.0]], 12, 0, 0, 0, C.hullD);                  // raised flight deck
  F.box(8.0, 2.0, .8, 0, 6.6, 20.9, C.glass, 0, 0, .35, 0, .35);   // viewport, front
  F.both(s => F.box(.6, 1.6, 6, s * 4.4, 6.5, 15, C.glass, 0, 0, .1, 0, .35)); // viewport sides
  F.hull([[-2, 3, .3, 7.1], [10, 3, .3, 7.4]], 6, 0, 0, 0, C.team, 1);                                                                 // dorsal stripe (team)
  F.rbox(15, 1.6, 12, .5, 2, 0, -7.0, -25, C.hullD, 0, 0, .4);     // rear ramp, part lowered
  F.rbox(1.6, 3, 12, .4, 2, 0, 6.0, -31, C.hullD); F.rbox(1.0, 11, 10, .3, 2, 0, 12.5, -33, C.team, 1, 0, 0, 0); F.rbox(2.4, 1.0, 4, .4, 2, 0, 18.2, -35, C.hullL); // tail fin: root, team blade, cap
  F.both(s => F.rbox(12, .7, 6, .25, 2, s * 8, 4.5, -34, C.hull, 0, 0, 0, s * .08));                                                     // tailplanes
  // swept stub wings with four lift nacelles and two main thrusters
  F.both(s => {
    F.rbox(14, 1.4, 14, .5, 3, s * 16, 2.0, -1, C.hull, s * -.35, 0, 0, s * .05); F.rbox(13, .5, 13, .2, 2, s * 16, 1.2, -1, C.hullD, s * -.35, 0, 0, s * .05); // wing, swept back
    for (const dz of [-8, 4]) { F.hull([[dz - 3.6, 2.4, 2.4, -2.6], [dz - 2, 2.9, 2.9, -2.6], [dz + 2, 2.9, 2.9, -2.6], [dz + 3.6, 2.2, 2.2, -2.6]], 16, s * 17.5, 0, 0, C.hullD); F.cyl(2.0, 2.0, .5, 20, s * 17.5, -5.4, dz, C.glow, 0, 0, 0, 0, false, .9); } // lift nacelles, lit below
    F.hull([[-48, 2.0, 2.0, -1], [-45, 2.7, 2.7, -1], [-40, 2.8, 2.8, -1], [-37, 2.2, 2.2, -1]], 16, s * 6.5, 0, 0, C.hullD); F.cyl(2.1, 2.1, .5, 20, s * 6.5, -1, -47.9, C.glow, 0, PI / 2, 0, 0, false, .9); // main thrusters
    for (let i = 0; i < 5; i++) F.box(.5, .7, 1.4, s * 10.6, -4.5, -18 + i * 7, C.red, 0, 0, 0, 0, 1.0);   // launch-bay lights along the flank
    for (let i = 0; i < 3; i++) F.cyl(.6, .6, 2.4, 12, s * 5.5, -8.4, -12 + i * 8, C.cannon);          // spitTubes under the belly
    F.box(1.2, .6, 20, s * 8.1, -7.6, -6, C.hullL);                                                    // belly skid rails
  });
  return F.build();
}

// ================================================================ Section B: the units from the books, modelled ahead of their rules
// Aircraft are built around their centre (like the Stork) and fly; ground vehicles and mechs stand on their feet at the
// origin. Draw these at true size (DRAW_SCALE), not ×VS: a 40 m mech needs no help being seen.
export const DRAW_SCALE = { rip: 1, riplead: 1, thunder: 1, wasp: 1, drachen: 1, titan: 1, hover: 1, spider: 1, bike: 1.6 };
const A = { wing: '#23252c', wingL: '#363941', wingD: '#15161a', canopy: '#7fd0ff', mech: '#3d424b', mechD: '#24272d', mechL: '#59606b', beam: '#a9c8ff', cleaver: '#cfe8ff', remn: '#4a4530', remnD: '#2a2719', remnL: '#6b6447', tank: '#4b5058', tankD: '#2c3036', tankL: '#666c76', skirt: '#1e2024' };

// ripWing: "bats glued together from shattered ebony" (the books' only description) — a narrow dark fuselage, swept
// wings with ragged bat-finger trailing edges, chainguns in the nose, missiles under the wings. The 13 m length, the
// canopy, engines and fins are our design; the bomb bay belongs to the thunderWing only
function ripwingBody(F, lead = false) {
  const trim = lead ? C.giltL : C.team, trimTm = lead ? 0 : 1;
  F.rbox(1.6, 1.3, 9, .3, 3, 0, 0, 0, A.wing);                          // fuselage
  F.rbox(1.0, .8, 3.6, .25, 2, 0, -.1, 5.6, A.wingD, 0, 0, .05);        // nose
  F.sph(.6, 12, 8, 0, .7, 1.6, A.canopy, 0, .7, 1.8, .4);               // bubble canopy, lit faintly
  F.both(s => F.cyl(.06, .06, 1.6, 8, s * .35, -.25, 7.6, C.cannon, 0, PI / 2)); // chainguns
  // the wings: swept bat outlines with three finger points and concave scallops along the trailing edge
  const WING = [[.7, 2.6], [3.5, 1.4], [6.4, -.2], [7.3, -1.6], [6.0, -1.1], [5.6, -2.8], [4.3, -2.0], [3.9, -3.6], [2.6, -2.7], [2.0, -4.0], [.7, -3.0]];
  const SPAR = [[.7, 2.2], [6.0, -.4], [6.2, -1.0], [.7, -1.2]];
  F.both(s => {
    F.plate(WING, .16, .02, A.wing, 0, 0, s);                                                   // the membrane
    F.plate(SPAR, .3, .2, A.wingL, 0, 0, s);                                                    // the spar, raised
    F.plate([[6.0, -.5], [7.3, -1.6], [6.4, -1.3]], .2, .12, trim, trimTm, 0, s);              // wingtip (team / gilt)
    F.cyl(.42, .5, 2.6, 12, s * 1.1, -.25, -3.4, A.wingD, 0, PI / 2); F.cyl(.36, .36, .3, 12, s * 1.1, -.25, -4.85, C.glow, 0, PI / 2, 0, 0, false, .9); // engines, lit
    F.cyl(.1, .1, 1.8, 8, s * 2.2, -.3, .4, A.wingD, 0, PI / 2); F.cyl(.1, .1, 1.8, 8, s * 3.4, -.25, -.1, A.wingD, 0, PI / 2); // missiles under the wing
  });
  F.both(s => F.box(.1, 1.3, 1.6, s * .55, .9, -3.6, trim, trimTm, 0, 0, -s * .3)); // twin canted tail fins (team / gilt)
  if (lead) { F.box(1.4, .08, 2.2, 0, .75, -1.6, C.giltL); F.sph(.35, 10, 8, 0, .3, 7.3, C.giltL, 0, 1, 1.6); }     // the Gold's upgraded ripWing: gilt spine and nose cap
  return F;
}
const ripwing = () => ripwingBody(new Fig()).build();
const ripwingLead = () => ripwingBody(new Fig(), true).build();

// thunderWing (~20 m): the bomber built in the shape of a spider — a fat central body, eight angled wing-legs, a
// deep bomb bay, four engines
function thunderwing() {
  const F = new Fig();
  F.sph(2.4, 16, 12, 0, 0, 0, A.wing, 0, .6, 1.4);                       // abdomen
  F.sph(1.6, 14, 10, 0, .2, 3.6, A.wingD, 0, .7, 1.0);                   // cephalothorax
  F.sph(.5, 10, 8, 0, .9, 4.6, A.canopy, 0, .6, 1.2, .4);                // canopy
  // eight legs: tapered plates radiating from the body, each bent down at a knee
  for (let i = 0; i < 4; i++) { const a = -.55 + i * .5, z0 = 2.6 - i * 1.5, L = 8 + (i === 1 || i === 2 ? 1.5 : 0), ca = Math.cos(a), sa = Math.sin(a);
    const kx = 1.4 + L * .55 * ca, kz = z0 + L * .55 * sa, tx = 1.4 + L * ca, tz = z0 + L * sa;
    F.both(s => { F.plate([[1.2, z0 + .7], [kx, kz + .35], [kx, kz - .35], [1.2, z0 - .7]], .5, .1, A.wing, 0, 0, s);
      F.plate([[kx - .1, kz + .34], [tx, tz + .12], [tx + .2 * ca, tz + .2 * sa], [tx, tz - .12], [kx - .1, kz - .34]], .3, -1.2, A.wingD, 0, 0, s);
      F.sph(.45, 10, 8, s * kx, -.3, kz, A.wingL, 0, 1, 1); });
  }
  F.rbox(2.6, 1.0, 5, .3, 2, 0, -1.5, -.4, A.wingL);                     // bomb bay
  F.both(s => F.box(1.2, .5, 4.4, s * .7, -2.05, -.4, A.wingD, 0, 0, s * .4)); // its doors, ajar
  F.both(s => { for (const dz of [-1.6, 1.0]) { F.cyl(.5, .6, 2.4, 12, s * 2.2, .3, dz - 2.6, A.wingD, 0, PI / 2); F.cyl(.42, .42, .3, 12, s * 2.2, .3, dz - 3.95, C.glow, 0, PI / 2, 0, 0, false, .9); } }); // four engines
  F.box(1.2, .08, 3.0, 0, 1.5, -.4, C.team, 1);                           // dorsal stripe (team)
  return F.build();
}

// Wasp (~12 m): a lighter, needle-nosed fighter with forward-swept wings — the Rim's look
function wasp() {
  const F = new Fig();
  F.rbox(1.2, 1.1, 7, .3, 3, 0, 0, 0, A.wingL);
  F.cyl(.08, .55, 4.2, 10, 0, 0, 5.4, A.wingD, 0, PI / 2);               // needle nose
  F.sph(.5, 12, 8, 0, .6, 1.4, A.canopy, 0, .7, 1.6, .4);
  F.both(s => { F.plate([[.6, -1.2], [.6, .6], [5.8, 2.6], [6.4, 2.2], [5.6, .4]], .14, .05, A.wingL, 0, 0, s); F.plate([[5.0, 1.6], [5.8, 2.6], [6.4, 2.2], [5.8, 1.2]], .18, .1, C.team, 1, 0, s); }); // forward-swept wings, team tips
  F.both(s => { F.box(.1, 1.0, 1.4, s * .5, .8, -3.0, A.wingL, 0, 0, -s * .5); F.cyl(.4, .45, 2.2, 12, s * .8, -.2, -3.2, A.wingD, 0, PI / 2); F.cyl(.34, .34, .3, 12, s * .8, -.2, -4.45, C.glow, 0, PI / 2, 0, 0, false, .9); });
  F.both(s => F.cyl(.05, .05, 1.4, 8, s * .3, -.3, 4.4, C.cannon, 0, PI / 2));
  F.cyl(.06, .06, 1.2, 8, 0, -.7, -3.4, C.team, 1, PI / 2);               // tail boom stripe
  return F.build();
}

// Drachenjäger (40 m, Solar Republic): headless boxy humanoid, cockpit hunched low between the shoulders, six arms
// with particle cannons at the elbows and ion cleavers in the lower hands, a spiked backpack; heavy digitigrade legs
function drachen() {
  const F = new Fig();
  F.both(s => {
    F.rbox(5, 2.4, 9, .6, 3, s * 4, 1.2, .8, A.mechD);                                        // feet
    F.limb([s * 4, 2, 1], [s * 4.2, 9, -2.5], 2.0, 1.7, 14, A.mech); F.sph(2.3, 14, 10, s * 4.2, 9.2, -2.5, A.mechD); // shin, knee back
    F.limb([s * 4.2, 9.4, -2.5], [s * 3.4, 17.5, 1.0], 1.9, 2.3, 14, A.mech);                  // thigh forward
    F.rbox(3.6, 3.2, 1.2, .4, 2, s * 4.4, 13.5, 1.6, A.mechL, 0, 0, .3);                      // knee plate
  });
  F.rbox(9, 4, 6, .8, 3, 0, 19, 0, A.mechD);                               // pelvis
  F.rbox(11, 9, 8, 1.2, 3, 0, 25.5, 0, A.mech);                            // torso
  F.rbox(16, 4, 9, 1.0, 3, 0, 31, -.5, A.mechL);                           // shoulder yoke, headless
  F.both(s => F.rbox(5, 2.5, 6, .6, 3, s * 7.5, 33, -.5, C.team, 1, 0, 0, -s * .2)); // shoulder plates (team)
  F.rbox(5, 2.6, 4, .6, 3, 0, 31.5, 3.2, A.mechD); F.box(3.6, .9, .4, 0, 31.8, 5.2, C.lens, 0, 0, 0, 0, 1.0); // the cockpit hunched low, visor lit
  F.rbox(8, 7, 3.5, .8, 3, 0, 27, -5.2, A.mechD);                          // backpack
  for (let i = 0; i < 6; i++) F.cyl(0, .5, 4.5 + (i % 3) * 1.2, 8, -3 + (i % 3) * 3, 31 + (i % 3) * 1.2, -5.2 - (i > 2 ? 1.3 : 0), A.mechL, 0, -.3 * (i > 2 ? 1.4 : 1)); // the spikes
  // six arms: upper, middle and lower pair; particle cannons at every elbow, ion cleavers in the lowest hands
  F.both(s => {
    const arms = [[33, 1.5, -1.2], [29, 2.0, 0.2], [25, 1.4, 1.4]];
    arms.forEach(([y, dz, tilt], i) => {
      const sx = s * 8.5 - s * i * .4, ex = s * (12.5 - i * .6), ey = y - 6, ez = dz - 3, hx = s * (12 - i * .6), hy = y - 13, hz = dz + 4;
      F.sph(1.5, 12, 8, sx, y, dz, A.mechD);                                                    // shoulder
      F.limb([sx, y, dz], [ex, ey, ez], 1.3, 1.1, 12, A.mech);                                  // upper arm
      F.sph(1.5, 12, 8, ex, ey, ez, A.mechD);                                                   // elbow
      F.cyl(.5, .6, 3.6, 10, ex + s * 1.4, ey + .4, ez + 1.4, C.cannon, 0, PI / 2 - .5);        // particle cannon off the elbow
      F.cyl(.42, .42, .3, 10, ex + s * 1.4, ey + 1.2, ez + 3.0, A.beam, 0, PI / 2 - .5, 0, 0, false, 1.0);
      F.limb([ex, ey, ez], [hx, hy, hz], 1.1, 1.0, 12, A.mechL);                                // forearm
      F.rbox(2.2, 2.0, 2.4, .4, 2, hx, hy, hz, A.mechD);                                        // hand
      if (i === 2) { F.rbox(.5, 9, 3.2, .2, 2, hx, hy - 5, hz + 1.2, A.mechD, 0, .15); F.box(.12, 9.2, .5, hx, hy - 5, hz + 2.85, A.cleaver, 0, .15, 0, 0, 1.0); } // ion cleaver, edge lit
    });
  });
  return F.build();
}

// Titan (60 m, Society Remnant): four legs, three arms, three main cannons (one the gravity gun), a disc cockpit
function titan() {
  const F = new Fig();
  const legs = [[7, 6], [-7, 6], [8, -6], [-8, -6]];
  for (const [lx, lz] of legs) { const sx = Math.sign(lx), sz = Math.sign(lz);
    F.rbox(5, 2.5, 6, .6, 3, lx * 1.9, 1.25, lz * 2.2, A.remnD);                                                   // foot
    F.limb([lx * 1.9, 2, lz * 2.2], [lx * 2.1, 14, lz * 1.9], 1.9, 1.6, 14, A.remn); F.sph(2.2, 14, 10, lx * 2.1, 14.2, lz * 1.9, A.remnD); // shin, knee out
    F.limb([lx * 2.1, 14.4, lz * 1.9], [lx, 24, lz], 1.8, 2.2, 14, A.remn);                                       // thigh in to the hips
    F.rbox(3.4, 3, 1.4, .4, 2, lx * 2.3, 9, lz * 2.3 + sz * .6, A.remnL, 0, 0, sz * .3, 0);                        // shin plate
  }
  F.rbox(20, 6, 16, 1.5, 3, 0, 26, 0, A.remnD);                            // hip ring
  F.rbox(14, 12, 12, 1.5, 3, 0, 35, 0, A.remn);                            // torso
  F.rbox(24, 5, 11, 1.2, 3, 0, 42, 0, A.remnL);                            // shoulder yoke
  F.both(s => F.rbox(7, 3, 8, .8, 3, s * 10, 44.5, 0, C.team, 1, 0, 0, -s * .2)); // shoulder plates (team)
  F.cyl(7.5, 6, 2.4, 24, 0, 46.5, 1.5, A.remnD); F.cyl(7.6, 7.6, .6, 24, 0, 47.4, 1.5, C.lens, 0, 0, 0, 0, true, .8); F.sph(5.4, 20, 10, 0, 47.6, 1.5, A.remn, 0, .35, 1); // the disc cockpit: lit rim, low dome
  F.cyl(2.2, 2.2, 1.4, 16, 0, 49.1, 1.5, A.remnL);
  // three arms: two at the shoulders with main cannons, the third from the chest with the gravity gun
  F.both(s => { F.sph(2.4, 12, 8, s * 12, 42, 0, A.remnD); F.limb([s * 12, 42, 0], [s * 15, 34, -2], 2.0, 1.7, 14, A.remn); F.sph(2.2, 12, 8, s * 15, 34, -2, A.remnD);
    F.limb([s * 15, 34, -2], [s * 14, 30, 7], 1.8, 2.0, 14, A.remnL); F.cyl(.9, 1.1, 14, 14, s * 14, 29, 14, C.cannon, 0, PI / 2); F.cyl(1.3, 1.3, 1.2, 14, s * 14, 29, 20.5, A.remnD, 0, PI / 2); }); // main cannons
  F.sph(2.6, 12, 8, 0, 36, 6, A.remnD); F.limb([0, 36, 6], [0, 31, 12], 2.2, 2.0, 14, A.remn); F.sph(2.4, 12, 8, 0, 31, 12, A.remnD);
  F.cyl(2.4, 1.6, 10, 18, 0, 31, 18, A.remnL, 0, PI / 2); F.cyl(3.2, 2.4, 2.4, 18, 0, 31, 23.5, A.remnD, 0, PI / 2); F.cyl(2.0, 2.0, .6, 18, 0, 31, 24.8, A.beam, 0, PI / 2, 0, 0, false, 1.0); // the gravity gun, muzzle lit
  for (let i = 0; i < 4; i++) F.cyl(3.4, 3.4, .5, 18, 0, 31, 14 + i * 2.6, A.remnD, 0, PI / 2, 0, 0, true);     // its coil rings
  const g = F.build(); g.scale(1.2, 1.2, 1.2); g.computeBoundingBox(); g.computeBoundingSphere(); return g;   // 60 m to the cockpit
}

// HoverTank (~12 m): a low hover hull on a dark skirt, grav emitters beneath, a turret with a long gun
function hovertank() {
  const F = new Fig();
  F.hull([[-6.2, 2.0, .6, 1.5], [-4.5, 3.0, 1.0, 1.7], [-1, 3.3, 1.15, 1.8], [2.5, 3.2, 1.05, 1.8], [5, 2.6, .8, 1.7], [6.4, 1.4, .4, 1.5]], 16, 0, 0, 0, A.tank);  // hull: a smooth lozenge
  F.hull([[-6.4, 2.6, .35, .75], [-3, 3.5, .45, .75], [3, 3.5, .45, .75], [6.6, 2.2, .3, .75]], 12, 0, 0, 0, A.skirt);                                        // the grav skirt
  for (let i = 0; i < 4; i++) F.cyl(.9, 1.1, .5, 14, i % 2 ? 1.8 : -1.8, .3, i < 2 ? 3.5 : -3.5, C.lens, 0, 0, 0, 0, false, 1.0); // grav emitters, lit
  F.hull([[1.5, 2.4, .5, 2.4], [4.5, 1.8, .35, 2.2], [6.0, .9, .15, 2.0]], 10, 0, 0, 0, A.tankL);                                                             // glacis fairing
  F.loft([[2.8, 2.0, 2.2], [3.2, 2.2, 2.4], [3.9, 2.1, 2.3], [4.6, 1.7, 1.9], [5.2, 1.1, 1.3], [5.5, .5, .6]], 16, 0, 0, -.5, A.tank);                      // turret: a low dome
  F.cyl(.26, .32, 7.5, 14, 0, 4.2, 4.5, C.cannon, 0, PI / 2); F.cyl(.4, .36, 1.2, 14, 0, 4.2, 1.6, A.tankD, 0, PI / 2); F.cyl(.36, .36, .6, 14, 0, 4.2, 8.0, A.tankD, 0, PI / 2); // main gun, mantlet, muzzle
  F.cyl(2.25, 2.25, .22, 16, 0, 4.0, -.5, C.team, 1, 0, 0, 0, true);                                                                                           // team band round the turret (open)
  F.both(s => F.cyl(.12, .12, 1.4, 8, s * 1.2, 5.6, -1.2, A.tankL));                                                                                           // antennae
  F.both(s => F.hull([[-5, .5, .4, 2.3], [-1, .6, .5, 2.4], [3, .5, .4, 2.3]], 8, s * 2.9, 0, 0, A.tankD));                                                   // sponsons
  return F.build();
}

// SpiderTank (~10 m): a turreted body on six angled legs
function spidertank() {
  const F = new Fig();
  F.hull([[-3.4, 1.8, 1.0, 4.2], [-1.5, 2.6, 1.4, 4.3], [1, 2.7, 1.45, 4.3], [2.8, 2.0, 1.1, 4.2], [3.8, 1.0, .6, 4.1]], 14, 0, 0, 0, A.tank);   // body: a smooth carapace
  for (let i = 0; i < 6; i++) { const s = i < 3 ? 1 : -1, z = (i % 3 - 1) * 2.4, a = (i % 3 - 1) * .5;
    const hx = s * 2.4, kx = s * (4.6 + Math.abs(a)), kz = z + Math.sin(a) * 2.2, fx = s * (5.2 + Math.abs(a) * 1.2), fz = z + Math.sin(a) * 3.4;
    F.sph(.55, 10, 8, hx, 4.2, z, A.tankD); F.limb([hx, 4.2, z], [kx, 6.2, kz], .45, .38, 10, A.tankD); F.sph(.5, 10, 8, kx, 6.2, kz, A.tankL); F.limb([kx, 6.2, kz], [fx, .3, fz], .36, .22, 10, A.tankD); F.sph(.4, 8, 6, fx, .3, fz, A.skirt, 0, .5, 1); }
  F.loft([[5.3, 1.3, 1.5], [5.7, 1.5, 1.7], [6.3, 1.35, 1.5], [6.9, .9, 1.0], [7.2, .4, .5]], 14, 0, 0, 0, A.tank);                                      // turret dome
  F.cyl(.18, .22, 4.5, 12, 0, 6.2, 3.4, C.cannon, 0, PI / 2); F.cyl(.3, .28, .8, 12, 0, 6.2, 1.4, A.tankD, 0, PI / 2);                                // gun and mantlet
  F.cyl(1.55, 1.55, .2, 14, 0, 5.75, 0, C.team, 1, 0, 0, 0, true);                                                                                      // team band (open)
  F.both(s => F.sph(.4, 8, 6, s * 1.0, 3.9, 3.4, C.lens, 0, .6, 1, .8));                                                                                // sensor eyes, lit
  return F.build();
}

// GravBike (~3 m) with rider: a grav-lifted bike, emitters fore and aft, a crouched Gray
function gravbike() {
  const F = new Fig();
  F.hull([[-1.5, .14, .12, .95], [-.9, .3, .26, .95], [-.1, .34, .32, 1.0], [.8, .28, .26, 1.05], [1.5, .14, .1, 1.1], [1.75, .05, .04, 1.1]], 12, 0, 0, 0, A.tank);   // fuselage: a sleek teardrop
  F.hull([[-1.2, .4, .08, .62], [0, .5, .1, .6], [1.2, .36, .07, .62]], 8, 0, 0, 0, A.skirt);                                                                      // grav skirt
  F.both(s => F.hull([[-.4, .08, .04, 1.0], [.4, .1, .05, 1.02], [1.0, .05, .02, 1.05]], 6, s * .36, 0, 0, C.team, 1));                                           // flank fairings (team)
  F.cyl(.3, .4, .25, 12, 0, .55, 1.0, C.lens, 0, 0, 0, 0, false, 1.0); F.cyl(.3, .4, .25, 12, 0, .55, -1.0, C.lens, 0, 0, 0, 0, false, 1.0);                        // grav emitters, lit
  F.cyl(.2, .16, .5, 10, 0, .95, -1.75, A.tankD, 0, PI / 2); F.cyl(.17, .17, .16, 10, 0, .95, -2.05, C.glow, 0, PI / 2, 0, 0, false, .9);                           // thruster
  F.both(s => F.limb([s * .2, 1.2, .9], [s * .45, 1.36, .62], .035, .03, 6, A.tankL));                                                                            // handlebars
  F.loft([[1.2, .22, .34, 0, -.3], [1.3, .2, .3, 0, -.3]], 10, 0, 0, 0, A.skirt);                                                                                  // saddle
  // the rider, crouched forward
  F.limb([.2, 1.3, -.3], [.3, .95, .5], .07, .06, 8, C.duroD); F.limb([-.2, 1.3, -.3], [-.3, .95, .5], .07, .06, 8, C.duroD);
  F.loft([[1.3, .18, .14, 0, -.2], [1.5, .22, .15, 0, 0], [1.62, .18, .12, 0, .1]], 10, 0, 0, 0, C.duro);                                                            // torso leaning in
  F.limb([.22, 1.6, .05], [.4, 1.38, .6], .05, .045, 8, C.duroD); F.limb([-.22, 1.6, .05], [-.4, 1.38, .6], .05, .045, 8, C.duroD);
  F.sph(.12, 10, 8, 0, 1.72, .3, C.duroD); F.box(.17, .05, .03, 0, 1.72, .415, C.visor, 0, 0, 0, 0, .6); F.box(.05, .08, .2, 0, 1.86, .28, C.team, 1);
  F.cyl(.03, .03, .9, 6, .3, 1.05, .2, C.gun, 0, PI / 2);                 // scorcher strapped on
  return F.build();
}

// ================================================================ Section C: props and effects
// the ablative entry cocoon round a falling starShell / leechCraft: an elongated ovoid, blunt end first (−Z), fins aft, lit
function entryPod() {
  const F = new Fig();
  F.sph(1.6, 16, 12, 0, 0, 0, '#5a4034', 0, 1, 2.6);                                            // the cocoon, scorched
  F.sph(1.5, 14, 10, 0, 0, -1.8, C.exhaust, 0, 1, 1.1, 1.0);                                      // the burning face
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; F.box(.2, 1.6, 1.8, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 2.8, '#3a2a22', 0, 0, 0, a + PI / 2); } // fins
  F.cyl(.6, .3, 1.2, 10, 0, 0, 4.4, C.vent, 0, PI / 2); F.cyl(.5, .5, .3, 10, 0, 0, 5.0, C.glow, 0, PI / 2, 0, 0, false, .9); // retro bell
  return F.build();
}

// a site standard: plinth, fluted pole, crossbar and finial; the flag itself stays a separate mesh (it changes colour)
function standard() {
  const F = new Fig();
  F.cyl(5, 6, 2, 12, 0, 1, 0, '#6a6a70'); F.cyl(3, 4, 1.6, 12, 0, 2.8, 0, '#808088');          // plinth
  F.cyl(1.2, 1.7, 86, 12, 0, 46, 0, '#9a9aa2');                                                  // pole
  for (let i = 0; i < 3; i++) F.cyl(2.0, 2.0, .8, 12, 0, 20 + i * 24, 0, '#5a5a62');             // rings
  F.cyl(.5, .5, 30, 8, 0, 88, 0, '#9a9aa2', 0, 0, PI / 2);                                       // crossbar
  F.sph(2.2, 12, 10, 0, 92, 0, '#d8c070', 0, 1.4, 1, .5);                                        // finial, lit
  return F.build();
}

// the city: a kit of building types placed per block and merged into one static mesh. Each block is {i, j, h} on the
// CH grid; the caller gives heightAt, the world's stone colour (a THREE.Color, used only where a style has no palette
// of its own) and the world id, which picks the style. Vertex colours carry the paint; windows carry an emissive mask,
// so staticMaterial() lights them.
//
// Each world builds differently, from the books:
//   luna     Hyperion: an ecumenopolis "built and layered on top of itself", a Promenade as its uppermost pedestrian
//            layer, spires like the Zenith Spire — stacked promenade tiers with railings and skybridges, slender spires
//            with lit crowns, white metal and gilt, dense warm windows (a rain-drenched city)
//   mars     Agea: "a network of white and red spires", neoclassical Gold ideals — banded white-and-red spires with
//            pointed caps, colonnaded blocks, domes, stepped terraces in red stone
//   mercury  Heliopolis: "Corinthian-inspired office spires ... parks, viaducts, amphitheaters" — fluted sandstone
//            towers with capitals and entablatures, amphitheatre rings, viaduct arcades, low domes
//   venus    the Isles: the Carthii "built the Columns of Venus" — monumental colonnade pavilions with roof gardens,
//            terraces in coral stone, slender lantern spires, sea-glass
//   earth    the old lands: a backwater built over for centuries — masonry blocks with cornices, industrial stacks
//            and chimneys, the odd old tower
//   phobos   the Hive: "a jigsaw city formed according to raw economics uninhibited by gravity", "dark metal with white
//            glyphs and blinking red lights", "spiked towers" — cantilevered jigsaw stacks, spikes, scaffolds, red lights
//   deimos   the Battle Moon, a fleet base — bunkers with glacis plates, gun batteries, blast walls, radar masts
//   _ice     a Rim colony: "very minimalistic and serene" — low pavilions with wide eaves, glass domes, thin white spires
export const CITY_ROLE = { wall: 0, column: 1, facade: 2, trim: 3, pave: 4, metal: 5 }; // cells of the city texture atlas, see cityMaterial
const CITY = {
  luna:    { base: '#d4d6dc', dark: '#9a9ea8', light: '#eceef2', trim: '#c9a24c', roof: '#6c7078', win: '#ffd9a0' },
  mars:    { base: '#8e3f2a', dark: '#5a2618', light: '#e8e2d8', trim: '#e8e2d8', roof: '#4a2016', win: '#ffd9a0' },
  mercury: { base: '#c9a76a', dark: '#8c7044', light: '#e6d2a4', trim: '#f0e0b8', roof: '#7a6038', win: '#ffe4b0' },
  venus:   { base: '#d9c3b0', dark: '#9c8370', light: '#f0e4d8', trim: '#8fd0c0', roof: '#4b7a4a', win: '#fff0c8' },
  earth:   { base: '#7a6e64', dark: '#4a403a', light: '#a09488', trim: '#7a4a3a', roof: '#3a322e', win: '#ffd09a' },
  phobos:  { base: '#2e3036', dark: '#1a1b1f', light: '#4a4d55', trim: '#d8dce4', roof: '#202226', win: '#ffb070', red: '#ff3a24' },
  deimos:  { base: '#4a4c52', dark: '#2c2e33', light: '#656870', trim: '#7a7e88', roof: '#33353a', win: '#ffc890' },
  _ice:    { base: '#d0d8e0', dark: '#8a96a4', light: '#eef2f6', trim: '#b8c6d4', roof: '#9aa6b2', win: '#ffe8c0' },
};
export function cityGeo(blocks, CH, heightAt, stone, world) {
  const F = new Fig(), PI2 = PI * 2;
  const sph0 = F.sph.bind(F); F.sph = (...a) => { const r0 = F.role; if (r0 == null) F.role = CITY_ROLE.metal; sph0(...a); F.role = r0; return F; }; // domes wear the metal
  const S = CITY[world] || CITY._ice; if (!CITY[world]) world = '_ice';
  // how each world builds: hx scales every height, core lifts the heart further, grand is the chance a whole 3x3 block between streets
  // becomes one great structure, split the chance an outer block is broken into several small buildings, open the chance it is left as a
  // plaza or garden instead, rot the twist of organic cities off the street grid
  const { plots, lay: LAY, hashf } = cityPlan(blocks, CH, world);
  const V = (c, v) => { const k = new THREE.Color(c); k.multiplyScalar(v); return k.getStyle(); };
  for (const b of plots) {
    const x = b.x, z = b.z, w = b.w, y0 = heightAt(x, z) - 2, h = (Math.max(b.h * LAY.hx, LAY.min * (b.small ? .5 : 1)) + hashf(b.i, b.j, 61) * LAY.jit * (b.small ? .4 : 1) * (1.2 - b.d * .6)) * (1 + (LAY.core - 1) * Math.max(0, 1 - b.d / .4)) + 2, hsh = ((b.i * 31 + b.j * 17) % 10) / 10, v = .84 + hsh * .22, h2 = b.grand ? 0 : ((b.i * 7 + b.j * 13) % 10) / 10, h3 = ((b.i * 11 + b.j * 5) % 10) / 10;
    const n0 = F.parts.length, rot = LAY.rot ? (hashf(b.i, b.j, 53) - .5) * 2 * LAY.rot : 0;
    // which texture each part wears (cityMaterial): facade (windows) for bodies in the base or light paint, stone for the dark
    // paint, trim for trim, metal for roofs and lit parts; columns(), plazas and a few pieces say so themselves
    F.role = null; F.roleFn = paint => paint === P || paint === L ? CITY_ROLE.facade : paint === D ? CITY_ROLE.wall : paint === T ? CITY_ROLE.trim : CITY_ROLE.metal;
    const P = V(S.base, v), D = V(S.dark, v), L = V(S.light, v), R = V(S.roof, v), T = S.trim, W = S.win;
    const win = () => {}, winR = () => {}; // the storeys and their lit windows are in the facade texture now (cityMaterial); nothing to build
    const parapet = (cx, cy, cz, sx, sz) => { F.box(sx + 1, 1.4, sz + 1, cx, cy, cz, D); F.box(sx * .9, .4, sz * .9, cx, cy + .1, cz, R); };
    const columns = (cx, cy, cz, sx, sz, n, ch, r, paint) => { const r0 = F.role; F.role = CITY_ROLE.column; for (let i = 0; i < n; i++) { const t = (i + .5) / n; F.cyl(r, r * 1.08, ch, 8, cx - sx / 2 + t * sx, cy + ch / 2, cz + sz / 2, paint); F.cyl(r, r * 1.08, ch, 8, cx - sx / 2 + t * sx, cy + ch / 2, cz - sz / 2, paint); if (i > 0 && i < n - 1) { F.cyl(r, r * 1.08, ch, 8, cx - sx / 2, cy + ch / 2, cz - sz / 2 + t * sz, paint); F.cyl(r, r * 1.08, ch, 8, cx + sx / 2, cy + ch / 2, cz - sz / 2 + t * sz, paint); } }  F.role = r0; };
    // the everyday buildings: never a plain cube. slab, L-plan, round tower, setback tiers or twin towers with a bridge, by hash
    const tower = (kind, cap = 'parapet', ww = w, hh = h, paintA = P, paintB = L) => {
      const wr = Math.floor(h3 * 5 + hsh * 2) % 5 || kind, yt = y0 + hh, swap = hsh > .5;
      if (wr === 0) { const a = ww, c = ww * .55; F.rbox(swap ? c : a, hh, swap ? a : c, .8, 2, x, y0 + hh / 2, z, paintA); win(x, y0, z, (swap ? c : a) * .92, (swap ? a : c) * .92, Math.floor(hh / 4.2)); if (cap === 'parapet') parapet(x, yt, z, swap ? c : a, swap ? a : c); } // a slab
      else if (wr === 1) { const a = ww * .55; F.rbox(ww, hh, a, .7, 2, x, y0 + hh / 2, z - ww / 2 + a / 2, paintA); F.rbox(a, hh * (.6 + h3 * .4), ww, .7, 2, x - ww / 2 + a / 2, y0 + hh * (.3 + h3 * .2), z, paintB); win(x, y0, z - ww / 2 + a / 2, ww * .92, a * .92, Math.floor(hh / 4.2)); win(x - ww / 2 + a / 2, y0, z, a * .92, ww * .92, Math.floor(hh * (.6 + h3 * .4) / 4.2)); if (cap === 'parapet') parapet(x, yt, z - ww / 2 + a / 2, ww, a); } // an L-plan
      else if (wr === 2) { const r = ww * .42; F.cyl(r * .92, r, hh, 16, x, y0 + hh / 2, z, paintA); winR(x, y0, z, r, Math.floor(hh / 4.2)); F.cyl(r * 1.06, r * 1.06, 1.4, 16, x, yt + .7, z, D); F.cyl(r * .5, r * .55, 3, 12, x, yt + 2.5, z, paintB); } // a round tower
      else if (wr === 3) { const n = 3, f = [1, .78, .55]; let yy = y0; for (let k = 0; k < n; k++) { const th = hh * (k === 0 ? .5 : k === 1 ? .3 : .2), wk = ww * f[k]; F.rbox(wk, th, wk * (k === 1 ? .8 : 1), .7, 2, x + (k ? ww * .08 * (k % 2 ? 1 : -1) : 0), yy + th / 2, z, k % 2 ? paintB : paintA); win(x + (k ? ww * .08 * (k % 2 ? 1 : -1) : 0), yy, z, wk * .92, wk * .92, Math.floor(th / 4.2)); yy += th; } if (cap === 'parapet') parapet(x + ww * .08, yy, z, ww * .55, ww * .55); } // setback tiers
      else { const a = ww * .4; for (const sgn of [-1, 1]) { const th = hh * (sgn < 0 ? 1 : .7 + h3 * .3); F.rbox(a, th, a, .6, 2, x + sgn * ww * .28, y0 + th / 2, z, sgn < 0 ? paintA : paintB); win(x + sgn * ww * .28, y0, z, a * .92, a * .92, Math.floor(th / 4.2)); if (cap === 'parapet') parapet(x + sgn * ww * .28, y0 + th, z, a, a); } F.box(ww * .56, 2.4, 3.5, x, y0 + hh * .5, z, D); F.box(ww * .56, .5, 3.5, x, y0 + hh * .5 + 1.4, z, T); } // twin towers and a bridge
    };
    const spire = (cx, cz, tiers, caps) => { let yy = y0, ww = w * .72; for (let k = 0; k < tiers.length; k++) { const th = h * tiers[k]; F.rbox(ww, th, ww, Math.min(1, ww * .08), 2, cx, yy + th / 2, cz, k % 2 ? L : P); win(cx, yy, cz, ww * .92, ww * .92, Math.floor(th / 4.2)); yy += th; ww *= .68; } return yy; };

    if (b.open) { F.role = CITY_ROLE.pave; // open ground: a plaza, garden, yard or pad, in the city's own manner
      if (world === 'venus' || world === 'earth') { F.cyl(w * .4, w * .44, 1.2, 16, x, y0 + .6, z, R); for (let k = 0; k < 6; k++) F.sph(2 + hashf(k, b.i, 7) * 2, 6, 5, x + Math.cos(k * 1.05 + b.j) * w * .28, y0 + 3, z + Math.sin(k * 1.05 + b.j) * w * .28, V(S.roof, 1.2)); F.cyl(1.5, 1.5, 4, 8, x, y0 + 2, z, L); } // a garden with a fountain
      else if (world === 'deimos') { F.rbox(w, 1.6, w, .4, 2, x, y0 + .8, z, D); for (const s of [-1, 1]) F.box(w * .9, 4, 1.2, x, y0 + 2, z + s * w * .42, P); F.box(3, 2, 3, x, y0 + 2.6, z, D); } // a hardstand
      else if (world === 'mercury') { F.cyl(w * .42, w * .46, 2, 16, x, y0 + 1, z, L); for (let k = 0; k < 8; k++) F.cyl(.6, .7, 8, 6, x + Math.cos(k * PI / 4) * w * .36, y0 + 5, z + Math.sin(k * PI / 4) * w * .36, P); F.cyl(w * .4, w * .4, .6, 16, x, y0 + 9.3, z, T); } // a shaded court
      else { F.rbox(w, 1.2, w, .3, 2, x, y0 + .6, z, L); F.box(w * .2, .8, w * .2, x, y0 + 1.6, z, T); F.cyl(.5, .6, 7, 6, x, y0 + 4.6, z, D); F.sph(.6, 6, 5, x, y0 + 8.2, z, W, 0, 1, 1, .8); } // a plaza with a lamp
      continue; }
    if (world === 'luna') { // Hyperion: tiers and promenades, spires, skybridges
      if (h > 34 && h2 < .5) { const top = spire(x, z, [.45, .3, .25]); F.cyl(w * .12, w * .12, 1.2, 12, x, top + .6, z, T, 0, 0, 0, 0, true); F.cyl(.4, 1.2, 10, 8, x, top + 5, z, D); F.sph(.9, 8, 6, x, top + 10, z, W, 0, 1, 1, 1.0); F.cyl(w * .13, w * .13, .6, 12, x, top + .3, z, W, 0, 0, 0, 0, false, .8);
        if (b.grand) for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const tw = w * .22, th = h * (.45 + hashf(sx + 2, sz + 2 + b.i, 71) * .25); F.rbox(tw, th, tw, .8, 2, x + sx * w * .42, y0 + th / 2, z + sz * w * .42, L); win(x + sx * w * .42, y0, z + sz * w * .42, tw * .92, tw * .92, Math.floor(th / 4.2), 3.6, .55); parapet(x + sx * w * .42, y0 + th, z + sz * w * .42, tw, tw); F.box(w * .3, 2, 3, x + sx * w * .27, y0 + th * .7, z + sz * w * .42, L); } } // spire with a lit crown and beacon; a grand one has four lesser towers bridged to it
      else if (h > 14 && h2 < .8) { const n = 2 + Math.floor(h3 * 3), hs = h / n; for (let k = 0; k < n; k++) { const wk = w * (.92 - k * .1), yk = y0 + hs * k; F.rbox(wk, hs, wk, .8, 2, x, yk + hs / 2, z, k % 2 ? L : P); win(x, yk, z, wk * .92, wk * .92, Math.floor(hs / 4.2), 3.6, .55);
          F.box(wk + 4, .6, wk + 4, x, yk + hs, z, D); F.box(wk + 4, 1.2, .3, x, yk + hs + .9, z + wk / 2 + 1.85, T); F.box(wk + 4, 1.2, .3, x, yk + hs + .9, z - wk / 2 - 1.85, T); F.box(.3, 1.2, wk + 4, x + wk / 2 + 1.85, yk + hs + .9, z, T); F.box(.3, 1.2, wk + 4, x - wk / 2 - 1.85, yk + hs + .9, z, T); } // promenade decks with gilt railings
        if (h3 > .5) F.box(CH * .5, 1.2, 3, x + CH * .45, y0 + hs * 1.0 + .6, z, L); parapet(x, y0 + h, z, w * (.92 - (n - 1) * .1), w * (.92 - (n - 1) * .1)); } // a skybridge east
      else { tower(3); F.box(w * .5, .5, w * .5, x, y0 + h * .5, z, T); }
    } else if (world === 'mars') { // Agea: white and red spires, colonnades, domes, terraces
      if (h > 34 && h2 < .45) { let yy = y0, r = w * .34; for (let k = 0; k < 6; k++) { const th = h / 7; F.cyl(r * (1 - k * .06), r * (1 - (k - 1) * .06), th, 12, x, yy + th / 2, z, k % 2 ? L : P); winR(x, yy, z, r * (1 - k * .06), Math.floor(th / 4.2)); yy += th; } F.cyl(0, r * .68, h / 7 + 6, 12, x, yy + (h / 7 + 6) / 2, z, L); F.sph(.8, 8, 6, x, yy + h / 7 + 6.6, z, T, 0, 1, 1, .8); } // banded spire, pointed cap
      else if (h > 18 && h2 < .7) { const ph = Math.min(6, h * .25), ch = h - ph - 4; F.rbox(w, ph, w, .6, 2, x, y0 + ph / 2, z, P); columns(x, y0 + ph, z, w * .82, w * .82, 5, ch, 1.1, L); F.rbox(w, 4, w, .4, 2, x, y0 + ph + ch + 2, z, L); F.rbox(w * .6, 3, w * .6, .4, 2, x, y0 + h + 1.5, z, P); F.rbox(w * .7, ch * .9, w * .7, .6, 2, x, y0 + ph + ch * .45, z, D); win(x, y0 + ph, z, w * .64, w * .64, Math.floor(ch / 4.2)); } // colonnaded block, cella inside
      else if (h > 22 && h2 >= .7) { const r = w * .42, hd = h * .55; F.rbox(w, hd, w, 1.0, 2, x, y0 + hd / 2, z, P); win(x, y0, z, w * .92, w * .92, Math.floor(hd / 4.2)); F.cyl(r, r * 1.05, 3, 20, x, y0 + hd + 1.5, z, D); F.sph(r, 20, 10, x, y0 + hd + 3, z, L, 0, (h - hd - 3) / r, 1); F.cyl(1.5, 2, 4, 8, x, y0 + h + 1, z, T); }
      else if (h3 > .5) tower(2, 'none', w, h, P, L);
      else { const n = 3, hs = h / n; for (let k = 0; k < n; k++) { const wk = w * (1 - k * .22); F.rbox(wk, hs, wk, .6, 2, x, y0 + hs * (k + .5), z, k % 2 ? D : P); win(x, y0 + hs * k, z, wk * .92, wk * .92, Math.floor(hs / 4.2)); } parapet(x, y0 + h, z, w * .56, w * .56); } // stepped terrace
    } else if (world === 'mercury') { // Heliopolis: Corinthian towers, amphitheatres, viaducts, low domes
      if (h > 30 && h2 < .55) { const r = w * .3, sh = h * .78; F.rbox(w, 3, w, .4, 2, x, y0 + 1.5, z, D); F.cyl(r, r * 1.06, sh, 14, x, y0 + 3 + sh / 2, z, P); for (let k = 0; k < 8; k++) F.box(1.2, sh * .96, .6, x + Math.cos(k * PI2 / 8) * r * 1.0, y0 + 3 + sh / 2, z + Math.sin(k * PI2 / 8) * r * 1.0, L, 0, -k * PI2 / 8); // flutes
        F.cyl(r * 1.35, r * 1.05, h * .08, 14, x, y0 + 3 + sh + h * .04, z, L); F.rbox(r * 2.9, h * .1, r * 2.9, .5, 2, x, y0 + 3 + sh + h * .13, z, P); win(x, y0 + 3 + sh + h * .08, z, r * 2.6, r * 2.6, 2, 3.5); F.rbox(r * 1.6, 3, r * 1.6, .4, 2, x, y0 + h + 1.5, z, D); } // capital and entablature on top
      else if (h < 16 && h2 < .15 && !b.small) { F.role = CITY_ROLE.wall; const r = w * .46; for (let k = 0; k < 14; k++) { const a = k * PI2 / 14, hh = 6 + 5 * Math.sin(a) ** 2; F.box(4.2, hh, w * .2, x + Math.cos(a) * r * .9, y0 + hh / 2, z + Math.sin(a) * r * .9, P, 0, -a + PI / 2); } F.cyl(r * .55, r * .6, 1.2, 14, x, y0 + .6, z, L); } // amphitheatre
      else if (h < 20 && h2 < .7) { for (let k = 0; k < 5; k++) F.box(2.4, 10, 2.4, x - w / 2 + (k + .5) * w / 5, y0 + 5, z, P); F.rbox(w, 2.4, 5, .4, 2, x, y0 + 11.2, z, L); for (let k = 0; k < 4; k++) F.box(.8, 4, 4.6, x - w / 2 + (k + 1) * w / 5, y0 + 8, z, D); } // viaduct arcade
      else if (h3 > .55) tower(0, 'parapet', w, h, P, L);
      else { const r = w * .44, hd = h * .5; F.rbox(w, hd, w, .8, 2, x, y0 + hd / 2, z, P); win(x, y0, z, w * .92, w * .92, Math.floor(hd / 4.2)); F.sph(r, 18, 9, x, y0 + hd, z, L, 0, Math.max(.3, (h - hd) / r), 1); F.cyl(1.2, 1.8, 3, 8, x, y0 + h + .8, z, D); } // low dome
    } else if (world === 'venus') { // the Isles: the Columns of Venus, roof gardens, lantern spires
      if (h > 16 && h2 < .5) { const ph = 3, ch = Math.min(h - 8, 26); F.rbox(w, ph, w, .5, 2, x, y0 + ph / 2, z, P); columns(x, y0 + ph, z, w * .9, w * .9, 6, ch, 1.3, L); F.rbox(w, 3, w, .5, 2, x, y0 + ph + ch + 1.5, z, L); F.rbox(w * .85, 1.6, w * .85, .4, 2, x, y0 + ph + ch + 3.8, z, R); for (let k = 0; k < 5; k++) F.sph(2.2, 6, 5, x + (((b.i + k * 3) % 5) - 2) * w * .16, y0 + ph + ch + 5.5, z + (((b.j + k * 7) % 5) - 2) * w * .16, V(S.roof, 1.2)); // garden on the roof
        F.rbox(w * .5, h - ph - ch - 4, w * .5, .5, 2, x, y0 + ph + ch + 4 + (h - ph - ch - 4) / 2, z, P); win(x, y0 + ph, z, w * .5, w * .5, Math.floor(ch / 4.2)); }
      else if (h > 28 && h2 >= .5 && h2 < .7) { const r = w * .18; F.cyl(r, r * 1.3, h * .85, 10, x, y0 + h * .425, z, L); winR(x, y0, z, r * 1.15, Math.floor(h * .85 / 4.2)); F.cyl(r * 1.4, r * 1.1, h * .08, 10, x, y0 + h * .89, z, P); F.sph(r * 1.0, 10, 7, x, y0 + h * .97, z, W, 0, 1, 1, .9); F.cyl(0, r * 1.2, 4, 10, x, y0 + h + 3, z, L); } // lantern spire
      else { const n = 3, hs = h / n; for (let k = 0; k < n; k++) { const wk = w * (1 - k * .2), yk = y0 + hs * k; F.rbox(wk, hs, wk, .7, 2, x - k * w * .1, yk + hs / 2, z, k % 2 ? L : P); win(x - k * w * .1, yk, z, wk * .92, wk * .92, Math.floor(hs / 4.2)); F.box(wk + 1, .8, wk + 1, x - k * w * .1, yk + hs, z, R); } F.box(w * .4, 1.2, w * .4, x - (n - 1) * w * .1, y0 + h + .6, z, R); } // garden terraces
    } else if (world === 'phobos') { // the Hive: jigsaw stacks, spikes, scaffolds, red lights
      if (h > 30 && h2 < .45) { const r = w * .3; F.cyl(r * .35, r, h * .7, 7, x, y0 + h * .35, z, P); F.cyl(0, r * .35, h * .3, 7, x, y0 + h * .85, z, D); winR(x, y0, z, r * .7, 3, h * .2, .35); for (let k = 0; k < 4; k++) F.box(.6, .6, .6, x + Math.cos(k * 1.7) * r * .5, y0 + h * (.3 + k * .15), z + Math.sin(k * 1.7) * r * .5, S.red, 0, 0, 0, 0, 1.0); F.box(.3, h * .5, 2.2, x + r * .9, y0 + h * .3, z, T, 0, 0, 0, 0, .3); } // spike with a white glyph strip and red lights
      else if (h2 < .8) { const n = 3 + Math.floor(h3 * 3), hs = h / n; let cx = x, cz = z; for (let k = 0; k < n; k++) { const wx = w * (.5 + ((b.i * 3 + k * 7) % 5) / 10), wz = w * (.5 + ((b.j * 5 + k * 3) % 5) / 10); cx = x + (((b.i + k) % 3) - 1) * w * .18; cz = z + (((b.j + k * 2) % 3) - 1) * w * .18; F.rbox(wx, hs, wz, .4, 2, cx, y0 + hs * (k + .5), cz, k % 2 ? L : P); win(cx, y0 + hs * k, cz, wx * .92, wz * .92, Math.floor(hs / 4.2), 4.2, .35); if (k % 2) F.box(wx * .6, .4, .5, cx, y0 + hs * (k + .5), cz + wz / 2 + .3, T, 0, 0, 0, 0, .3); } F.box(.6, .6, .6, cx, y0 + h + .4, cz, S.red, 0, 0, 0, 0, 1.0); } // jigsaw stack
      else if (h3 > .6) tower(4, 'none', w, h, D, P);
      else { F.rbox(w * .7, h, w * .7, .4, 2, x, y0 + h / 2, z, D); win(x, y0, z, w * .64, w * .64, Math.floor(h / 4.2), 4.2, .35); for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) F.box(.6, h + 2, .6, x + sx * w * .45, y0 + h / 2 + 1, z + sz * w * .45, L); for (let k = 1; k < 4; k++) { F.box(w * .92, .4, .4, x, y0 + h * k / 4, z + w * .45, L); F.box(w * .92, .4, .4, x, y0 + h * k / 4, z - w * .45, L); F.box(.4, .4, w * .92, x + w * .45, y0 + h * k / 4, z, L); F.box(.4, .4, w * .92, x - w * .45, y0 + h * k / 4, z, L); } } // scaffolded block
    } else if (world === 'deimos') { // the Battle Moon: bunkers, batteries, blast walls, masts
      if (h2 < .35) { const bh = Math.min(h, 12); F.rbox(w, bh, w, 1.2, 2, x, y0 + bh / 2, z, P); for (const s of [-1, 1]) { F.box(w, bh * .9, 3, x, y0 + bh * .45, z + s * (w / 2 + 1), D, 0, s * .45); F.box(3, bh * .9, w, x + s * (w / 2 + 1), y0 + bh * .45, z, D, 0, 0, -s * .45); } F.box(w * .5, 1.2, .3, x, y0 + bh * .75, z + w / 2 + .1, W, 0, 0, 0, 0, .5); } // bunker with glacis plates and a lit slit
      else if (h2 < .6) { const bh = Math.min(h, 10), r = w * .3; F.rbox(w, bh, w, 1.0, 2, x, y0 + bh / 2, z, P); F.sph(r, 14, 8, x, y0 + bh, z, D, 0, .7, 1); for (const s of [-1, 1]) F.cyl(.6, .7, 16, 8, x + 8, y0 + bh + r * .4, z + s * 1.6, D, 0, 0, -PI / 2 + .25); } // a gun battery
      else if (h2 < .8) { F.rbox(w * .8, 6, 2.4, .4, 2, x, y0 + 3, z, P); F.rbox(2.4, 6, w * .8, .4, 2, x, y0 + 3, z, P); F.cyl(.5, .8, h, 8, x + w * .25, y0 + h / 2, z + w * .25, D); F.box(6, .4, .4, x + w * .25, y0 + h, z + w * .25, L); F.sph(.6, 6, 5, x + w * .25, y0 + h + .5, z + w * .25, S.red || '#ff4040', 0, 1, 1, 1.0); } // blast walls and a radar mast
      else { tower(h3 < .5 ? 0 : 1); F.box(w * .3, 2, w * .3, x, y0 + h + 1, z, D); } // barracks
    } else if (world === 'earth') { // the old lands: masonry, cornices, stacks
      if (h > 30 && h2 < .3) { F.rbox(w * .7, h * .7, w * .7, .6, 2, x, y0 + h * .35, z, P); F.rbox(w * .5, h * .3, w * .5, .5, 2, x, y0 + h * .85, z, D); win(x, y0, z, w * .64, w * .64, Math.floor(h * .7 / 4.2)); win(x, y0 + h * .7, z, w * .46, w * .46, Math.floor(h * .3 / 4.2)); F.box(w * .76, 1.2, w * .76, x, y0 + h * .7, z, L); F.cyl(.3, .5, 6, 6, x, y0 + h + 3, z, D); } // an old tower
      else if (h2 < .55) { tower(1); F.box(w * .7, .6, w * .7, x, y0 + h * .5, z, L); } // masonry with a cornice
      else if (h2 < .82) tower(h3 < .5 ? 0 : 3, 'parapet', w, h, D, P);
      else { const bh = Math.min(h, 14); F.rbox(w, bh, w, .5, 2, x, y0 + bh / 2, z, D); for (let k = 0; k < 3; k++) F.cyl(1.0, 1.3, h - bh + 6, 8, x - w * .3 + k * w * .3, y0 + bh + (h - bh + 6) / 2, z + w * .2, S.trim); F.box(w * .6, 3, w * .4, x, y0 + bh + 1.5, z - w * .2, P); } // industrial stacks
    } else { // a Rim colony: pavilions with wide eaves, glass domes, thin spires
      if (h > 26 && h2 < .3) { const r = w * .14; F.cyl(r * .6, r, h * .9, 10, x, y0 + h * .45, z, L); F.cyl(r * 1.6, r * 1.6, .4, 10, x, y0 + h * .9, z, T, 0, 0, 0, 0, true); F.cyl(0, r * .6, h * .1 + 3, 10, x, y0 + h * .95 + 1.5, z, L); F.sph(.7, 8, 6, x, y0 + h + 3.4, z, W, 0, 1, 1, .8); } // a thin spire
      else if (h2 > .3 && h2 < .55) { const r = w * .44, hd = Math.min(h * .4, 8); F.cyl(r, r * 1.04, hd, 20, x, y0 + hd / 2, z, P); F.sph(r, 20, 10, x, y0 + hd, z, W, 0, Math.max(.35, (h - hd) / r), 1, .25); } // a glass dome, faintly lit
      else { const n = 1 + Math.floor(h3 * 2), hs = Math.min(h, 24) / n; for (let k = 0; k < n; k++) { const wk = w * (.9 - k * .15), yk = y0 + hs * k; F.rbox(wk, hs * .8, wk, .5, 2, x, yk + hs * .4, z, k % 2 ? L : P); win(x, yk, z, wk * .92, wk * .92, 1, 3.2, .35); F.box(wk + 6, .6, wk + 6, x, yk + hs * .85, z, D); for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) F.box(.4, hs * .85, .4, x + sx * (wk / 2 + 2.6), yk + hs * .42, z + sz * (wk / 2 + 2.6), D); } F.box(w * .3, 1, w * .3, x, y0 + Math.min(h, 24) * .9, z, T); } // pavilions with wide eaves on posts
    }
    if (rot) for (let k = n0; k < F.parts.length; k++) { const g = F.parts[k]; g.translate(-x, 0, -z); g.rotateY(rot); g.translate(x, 0, z); }
  }
  return F.build();
}

// a node material for the static props (city, standards): own paint, lit where em is set, no team mask
export function staticMaterial(opts = {}) {
  const m = new MeshStandardNodeMaterial(Object.assign({ roughness: .85, metalness: .05 }, opts));
  const paint = attribute('color', 'vec3'), em = attribute('em', 'float');
  m.colorNode = paint; m.emissiveNode = paint.mul(em).mul(1.6);
  return m;
}

// the textured city: one atlas per map (albedo, normal, roughness, emissive) per world, six 512 px cells (CITY_ROLE) with
// 16 px wrapped gutters, under textures/city/ (made by tools/citytex.py and tools/atlas.py). Mapping is triplanar in world
// metres, so no UV pass is needed on the kit: a vertical face takes its storeys from world y, a roof takes the metal or
// the paving. Each cell tiles by fract(), so the mip level is computed from the untiled coordinate and sampled explicitly
// (no seam at the tile edge); the gutters cover the levels that are used.
const ATLAS_W = 1632, ATLAS_H = 1088, CELL = 544, GUT = 16, TEX = 512;
const TILE = [[10, 10], [4, 4], [12, 12.6], [6, 6], [10, 10], [6, 6]]; // metres per tile per role (u, v): the facade tile is three storeys of 4.2 m
export function cityMaterial(world) {
  const S = CITY[world] || CITY._ice; if (!CITY[world]) world = '_ice';
  const tl = new THREE.TextureLoader();
  const load = (suf, srgb) => { const t = tl.load(`textures/city/${world}${suf}.png`); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; return t; };
  const A = load('_a', true), Nm = load('_n', false), Rg = load('_r', false), Em = load('_e', false);
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const paint = attribute('color', 'vec3'), em = attribute('em', 'float'), role = attribute('role', 'float');
  const winColor = uniform(new THREE.Color(S.win));
  const tileOf = r => { let u = vec2(TILE[0][0], TILE[0][1]); for (let k = 1; k < TILE.length; k++) u = select(r.equal(float(k)), vec2(TILE[k][0], TILE[k][1]), u); return u; };
  // atlas coordinate of a tiled uv in a role's cell, and the mip level that uv would get
  const cellUV = (r, uvT) => { const cx = r.mod(3), cy = floor(r.div(3)); const o = vec2(cx.mul(CELL).add(GUT).div(ATLAS_W), float(1).sub(cy.add(1).mul(CELL).div(ATLAS_H)).add(GUT / ATLAS_H)); return o.add(fract(uvT).mul(vec2(TEX / ATLAS_W, TEX / ATLAS_H))); };
  const lodOf = uvT => { const px = uvT.mul(TEX); return clamp(log2(max(length(dFdx(px)), length(dFdy(px)))), 0, 4); };
  const sampleAll = (r, uvT) => { const uv = cellUV(r, uvT), lod = lodOf(uvT); return { a: texture(A, uv).level(lod), n: texture(Nm, uv).level(lod).xyz.mul(2).sub(1), g: texture(Rg, uv).level(lod).x, e: texture(Em, uv).level(lod).x }; };
  const p = positionWorld, n = normalWorld, an = abs(n);
  const w0 = pow(an, vec3(8)), w = w0.div(w0.x.add(w0.y).add(w0.z));
  const roofRole = select(role.equal(float(CITY_ROLE.pave)), float(CITY_ROLE.pave), float(CITY_ROLE.metal));
  const tv = tileOf(role), th = tileOf(roofRole);
  const sx = sampleAll(role, vec2(p.z, p.y).div(tv)), sz = sampleAll(role, vec2(p.x, p.y).div(tv)), sy = sampleAll(roofRole, vec2(p.x, p.z).div(th));
  const blend = k => sx[k].mul(w.x).add(sz[k].mul(w.z)).add(sy[k].mul(w.y));
  // the sampled normals into world space per plane: tangent along the face, bitangent up (or +z on a roof), then blended
  const nx = vec3(sign(n.x).mul(sx.n.z), sx.n.y, sx.n.x.mul(sign(n.x))), nz = vec3(sz.n.x.mul(sign(n.z)), sz.n.y, sign(n.z).mul(sz.n.z)), ny = vec3(sy.n.x, sign(n.y).mul(sy.n.z), sy.n.y);
  const nW = normalize(nx.mul(w.x).add(nz.mul(w.z)).add(ny.mul(w.y)));
  const tone = clamp(dot(paint, vec3(.333)).div(.5), .8, 1.15); // the kit's per-plot paint variation survives as a tint
  m.colorNode = blend('a').rgb.mul(tone);
  m.normalNode = transformNormalToView(nW);
  m.roughnessNode = blend('g');
  m.metalnessNode = select(role.equal(float(CITY_ROLE.metal)), float(.6), float(0));
  m.emissiveNode = paint.mul(em).mul(1.6).add(winColor.mul(blend('e')).mul(.9));
  m.userData.textures = [A, Nm, Rg, Em];
  return m;
}

// ---------------------------------------------------------------- public
const BUILD = { inf: legionnaire, rail: railman, obs: obsidian, gold: peerless, lead: legate, shell: starshell, pod: gravpod, aa: sarissa, corpse, corpse_obs: corpseObs, corpse_gold: corpseGold, corpse_shell: corpseShell, stork,
  rip: ripwing, riplead: ripwingLead, thunder: thunderwing, wasp, drachen, titan, hover: hovertank, spider: spidertank, bike: gravbike, drop: entryPod, standard };
const CACHE = {};
export function figureGeo(kind) { return CACHE[kind] || (CACHE[kind] = BUILD[kind]()); }
export const corpseGeo = () => figureGeo('corpse');
// which fallen model each kind leaves: the Grays' for anything without its own (pods and batteries are wrecks for another day)
export const CORPSE_KINDS = ['corpse', 'corpse_obs', 'corpse_gold', 'corpse_shell'];
export const corpseOf = kind => kind === 'obs' ? 'corpse_obs' : kind === 'gold' || kind === 'lead' ? 'corpse_gold' : kind === 'shell' ? 'corpse_shell' : 'corpse';
export const storkGeo = () => figureGeo('stork');
export const triCount = kind => figureGeo(kind).userData.tris;
export const BUDGET = { inf: 4500, rail: 4500, obs: 5000, gold: 5000, lead: 5500, shell: 6000, pod: 6000, aa: 6000, corpse: 500, corpse_obs: 700, corpse_gold: 700, corpse_shell: 800, stork: 15000, rip: 4000, riplead: 4500, thunder: 8000, wasp: 4000, drachen: 20000, titan: 24000, hover: 6000, spider: 8000, bike: 3000, drop: 2000, standard: 2000 };
// kinds that exist as models but have no unit type in ground.js yet (section B of the unit list)
export const PLANNED = ['rip', 'riplead', 'thunder', 'wasp', 'drachen', 'titan', 'hover', 'spider', 'bike'];

// one standard material per kind, with the team and emissive masks. Written in TSL for the WebGPU renderer (which
// ignores onBeforeCompile): the base material multiplies the colour by the instance colour itself, so the colour node is
// pre-divided by it and the product comes out as mix(paint, paint × instanceColour, tm). The emissive node adds the
// glow where em is set. Every figure InstancedMesh must have an instanceColor (groundview seeds one with setColorAt).
const LOOK = { drop: { roughness: .9, metalness: .1 }, rip: { roughness: .4, metalness: .6 }, riplead: { roughness: .35, metalness: .65, glow: [.1, .07, 0] }, thunder: { roughness: .4, metalness: .6 }, wasp: { roughness: .4, metalness: .6 }, drachen: { roughness: .5, metalness: .65 }, titan: { roughness: .55, metalness: .6 }, hover: { roughness: .55, metalness: .55 }, spider: { roughness: .55, metalness: .55 }, bike: { roughness: .5, metalness: .5 }, gold: { roughness: .35, metalness: .65, glow: [.12, .085, 0] }, lead: { roughness: .35, metalness: .65, glow: [.12, .085, 0] }, obs: { roughness: .7, metalness: .25 }, shell: { roughness: .5, metalness: .6 }, pod: { roughness: .5, metalness: .6 }, aa: { roughness: .6, metalness: .4 }, stork: { roughness: .45, metalness: .7 }, corpse: { roughness: 1, metalness: 0 } };
// fill: the paints are dark by design (a dark body, one bright team block), and a vertical face lit only by the sky
// went near-black at battle range, so every figure carries a little of its own paint as light
const FILL = .4;
export function figureMaterial(kind) {
  const L = Object.assign({ roughness: .65, metalness: .15 }, LOOK[kind] || {});
  const m = new MeshStandardNodeMaterial({ roughness: L.roughness, metalness: L.metalness });
  const paint = attribute('color', 'vec3'), tm = attribute('tm', 'float'), em = attribute('em', 'float');
  const tinted = mix(paint, paint.mul(instanceColor), tm);
  m.colorNode = tinted.div(max(instanceColor, vec3(.05, .05, .05)));
  const lit = tinted.mul(em).mul(1.8).add(tinted.mul(FILL)); // the glow where em is set, and the fill everywhere
  m.emissiveNode = L.glow ? lit.add(vec3(...L.glow)) : lit;
  return m;
}
// the far figure: three boxes in the model's own size and average paint, with its team block (36 triangles), drawn
// beyond the near range and casting no shadow, so a legion at full strength costs the GPU a fraction of the full models
const LCACHE = {};
export function lodGeo(kind) {
  if (LCACHE[kind]) return LCACHE[kind];
  const hi = figureGeo(kind); if (!hi.boundingBox) hi.computeBoundingBox();
  const bb = hi.boundingBox, col = hi.attributes.color.array, tmA = hi.attributes.tm.array;
  let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < tmA.length; i++) if (tmA[i] < .5) { r += col[i * 3]; g += col[i * 3 + 1]; b += col[i * 3 + 2]; n++; }
  const paint = new THREE.Color(r / Math.max(1, n), g / Math.max(1, n), b / Math.max(1, n)), dark = paint.clone().multiplyScalar(.6), hex = c => '#' + c.getHexString();
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z, cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2, y0 = bb.min.y, F = new Fig();
  if (kind === 'corpse') F.box(w * .8, h * .8, d * .85, cx, y0 + h * .4, cz, hex(paint)); // one low box: the fallen at a distance
  else { F.box(w * .62, h * .72, d * .6, cx, y0 + h * .36, cz, hex(paint)); F.box(w * .78, h * .1, d * .66, cx, y0 + h * .77, cz, '#ffffff', 1); F.box(w * .34, h * .16, d * .38, cx, y0 + h * .9, cz, hex(dark)); }
  return (LCACHE[kind] = F.build());
}
