// Drop 3: the hulls in 3D. Each class is built in code from a parts kit: a lofted body (a chamfered section swept
// stern to bow, smoothed between its stations), armour layers, broadside gun decks that hug the hull, hangar mouths,
// a stepped bridge, fins, running lights and an engine cluster. Built once per class and navy, shared by every ship.
//
// Shape language comes from the reference board (Justin Wong's Red Rising concept sheets, the Sons of Ares comics and
// fan builds) and from the books:
//  - the ripWing a black bat; the torchShip a long dart with its engines clustered at the stern and raked fins;
//  - the destroyer a long spine with a crescent blade at the bow, a tower amidships and swept fins;
//  - the dreadnought a layered slab, 80 rail guns in broadside decks (the Pax, Golden Son); 10 houses of 4 a side;
//  - the moonBreaker "twice the length of my ship, three times the girth ... a floating military dock city eight
//    kilometers long" (Morning Star), up to 1.5 km tall: about 3 km wide here. "City" means a dock the size of one,
//    never buildings on the hull: its back is layered armour decks and hangar tiers;
//  - the Annihilo, Atalantia's flagship, "shaped like an atavistic spear": a long shaft and a leaf-bladed head;
//  - the named dreadnoughts (variants, picked by commander in render.js): the Pax (the Vanguard, 5 km, 80 guns, eight
//    engines, four hangars), the Invictus (Augustus, 6 km, "the heaviest ship in the fleet", gilt), the Pandora (Julii,
//    "a black, hulking monster", 22 levels tall, crescent-walled flanks).
// Navies: the Society builds polished grey-white hulls with gold-trimmed crescent bows; the Republic flies the same
// Society hulls refitted, patched with red armour; the Rim's Ganymede-built ships are black, lean and fork-bowed.
// The Republic's moonBreaker is the Morning Star, once the Colossus: black as night, as in Golden Son.
//
// Units: the same as the old flat hulls (the outline in SHAPES), so mounts, plumes and hit circles still line up.
// World axes: x along the hull (bow +x), y up, z across.
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, max, vec3, instanceColor } from 'three/tsl';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { SHAPES, fshape, LEN_M } from './data.js';

export const SLOT = { hull: 0, trim: 1, dark: 2, glow: 3, armour: 4, gun: 5, red: 6, green: 7 };
const NSLOT = 8;

// ---------------------------------------------------------------- the kit
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const seedOf = str => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const lerp = (a, b, t) => a + (b - a) * t, ease = t => t * t * (3 - 2 * t);

// stations between the given sections, eased, so a hull curves instead of kinking
function smooth(secs, per = 3) {
  const out = [];
  for (let i = 0; i < secs.length - 1; i++) { const a = secs[i], b = secs[i + 1];
    for (let k = 0; k < per; k++) { const t = k / per, e = ease(t); out.push({ x: lerp(a.x, b.x, t), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e), y: lerp(a.y || 0, b.y || 0, e), b: lerp(a.b ?? .3, b.b ?? .3, t), p: a.p || b.p }); } }
  out.push({ ...secs[secs.length - 1] }); return out;
}
// a loft through sections {x, w (half-width), h (half-height), y (centre height), b (chamfer 0..0.5), p (profile)}; uv: u along, v around
// profiles: 'oct' a chamfered box (the default); 'slab' a wide flat-decked hull with short sides, for the capital ships;
// 'blade' a hexagon with knife-edge flanks, for the Rim's Ganymede hulls
function loft(secs, x0, x1) {
  const ring = s => { const { w, h } = s, y = s.y || 0, c = Math.min(.49, s.b ?? .3), p = s.p || 'oct';
    const r = p === 'slab' ? [[w, h * .5], [w * .72, h], [-w * .72, h], [-w, h * .5], [-w, -h * .5], [-w * .72, -h], [w * .72, -h], [w, -h * .5]]
      : p === 'blade' ? [[w, h * .1], [w * .42, h], [-w * .42, h], [-w, h * .1], [-w, -h * .1], [-w * .42, -h], [w * .42, -h], [w, -h * .1]]
      : [[w, h * (1 - c)], [w * (1 - c), h], [-w * (1 - c), h], [-w, h * (1 - c)], [-w, -h * (1 - c)], [-w * (1 - c), -h], [w * (1 - c), -h], [w, -h * (1 - c)]];
    return r.map(([z, yy]) => [z, yy + y]); };
  const P = [], UV = [], I = [], N = 8;
  secs.forEach(s => { const r = ring(s); for (let k = 0; k <= N; k++) { const [z, y] = r[k % N]; P.push(s.x, y, z); UV.push((s.x - x0) / (x1 - x0), k / N); } });
  for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < N; k++) { const a = i * (N + 1) + k, b = a + N + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
  for (const [si, flip] of [[0, true], [secs.length - 1, false]]) { // caps
    const s = secs[si], c = P.length / 3; P.push(s.x, s.y || 0, 0); UV.push((s.x - x0) / (x1 - x0), .5);
    for (let k = 0; k < N; k++) { const a = si * (N + 1) + k; flip ? I.push(c, a + 1, a) : I.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  return g;
}
function box(cx, cy, cz, sx, sy, sz, ry = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); if (ry) g.rotateY(ry); g.translate(cx, cy, cz); return g; }
function fin(xr, xt, yr, span, chord, t, side) { // a raked fin: root chord from xr forward, tip at xt, out along z (side ±1) or up (side 0)
  const pts = [[xr, 0], [xr + chord, 0], [xt + chord * .3, span], [xt, span]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: t, bevelEnabled: false }); g.translate(0, 0, -t / 2);
  if (side !== 0) g.rotateX(-side * Math.PI / 2);
  g.translate(0, yr, 0); return g;
}
function bell(x, y, z, r, L) { const g = new THREE.CylinderGeometry(r * .78, r, L, 16, 1, true); g.rotateZ(Math.PI / 2); g.translate(x - L / 2, y, z); return g; }
function ringG(x, y, z, r, t) { const g = new THREE.TorusGeometry(r, t, 5, 18); g.rotateY(Math.PI / 2); g.translate(x, y, z); return g; }
function disc(x, y, z, r) { const g = new THREE.CircleGeometry(r, 16); g.rotateY(-Math.PI / 2); g.translate(x, y, z); return g; }
function arc(x, y, R, tube, spread) { // the crescent blade: its convex edge is the prow at x, its horns sweep back past the bow
  const g = new THREE.TorusGeometry(R, tube, 6, 36, spread); g.rotateZ(-spread / 2); g.rotateX(Math.PI / 2); g.scale(1, .5, 1);
  g.translate(x - R, y, 0); return g;
}
function cylX(x0, x1, y, z, r, seg = 10) { const g = new THREE.CylinderGeometry(r, r, x1 - x0, seg); g.rotateZ(Math.PI / 2); g.translate((x0 + x1) / 2, y, z); return g; }
function cylZ(x, y, z0, z1, r, seg = 8) { const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg); g.rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2); return g; }

// collects geometry by material slot, keeps the hull's surfaces for placing guns, and merges into one geometry
class Kit {
  constructor() { this.parts = [...Array(NSLOT)].map(() => []); this.bells = []; this.top = 0; this.surf = []; this.body = null; this.band = [0, .62]; }
  add(slot, g) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); this.parts[slot].push(g.index ? g.toNonIndexed() : g); return this; }
  loft(slot, secs, x0, x1, deck = true) { if (!this.body && this.profile) for (const s of secs) if (!s.p) s.p = this.profile; const S = smooth(secs); if (deck) this.surf.push(S); if (!this.body) this.body = S; return this.add(slot, loft(S, x0, x1)); }
  build() {
    const geos = [], groups = []; let start = 0;
    for (let s = 0; s < NSLOT; s++) {
      if (!this.parts[s].length) continue;
      const m = mergeGeometries(this.parts[s].map(g => { const c = g.clone(); for (const k of Object.keys(c.attributes)) if (!['position', 'uv'].includes(k)) c.deleteAttribute(k); return c; }));
      m.computeVertexNormals(); geos.push(m); groups.push([start, m.attributes.position.count, s]); start += m.attributes.position.count;
    }
    const g = mergeGeometries(geos); g.clearGroups(); for (const [st, n, s] of groups) g.addGroup(st, n, s);
    g.computeBoundingSphere(); return g;
  }
}
// a section list read at x: half-width, top
const at = (secs, x) => { if (x <= secs[0].x) return secs[0]; for (let i = 0; i < secs.length - 1; i++) { const a = secs[i], b = secs[i + 1]; if (x <= b.x) { const t = (x - a.x) / (b.x - a.x || 1); return { w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), y: lerp(a.y || 0, b.y || 0, t), b: lerp(a.b ?? .3, b.b ?? .3, t), p: a.p }; } } return secs[secs.length - 1]; };
const inX = (secs, x) => x >= secs[0].x && x <= secs[secs.length - 1].x;

// the outline's half-width at x (for lofting the classes that have no hand-built body)
function halfWidth(pts, x) { let w = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) { const t = (x - a[0]) / (b[0] - a[0]); w = Math.max(w, Math.abs(a[1] + (b[1] - a[1]) * t)); } } return w; }
const extent = pts => { const xs = pts.map(p => p[0]); return [Math.min(...xs), Math.max(...xs)]; };

// ---------------------------------------------------------------- the parts
const STYLE = {
  core:   { slim: 1, crescent: true, patches: false, fork: false },
  rising: { slim: 1.03, crescent: true, patches: true, fork: false },
  rim:    { slim: .84, crescent: false, patches: false, fork: true, profile: 'blade' },
  none:   { slim: 1, crescent: false, patches: false, fork: false },
};
function bow(K, st, x, y, w, h, R) { // the prow: a crescent blade (Society lines), a forked lancer's bow (Rim), or a plain ram
  if (st.crescent) { // sized so its horns lie along the hull's flanks, braced to them, never floating ahead of the bow
    let r = R; if (K.body) for (let t = .08; t <= R; t += .005) if (at(K.body, x - t).w * 1.06 <= t) { r = Math.min(R, t * 1.6); break; }
    K.add(SLOT.trim, arc(x, y, r, Math.max(.014, r * .13), Math.PI * .9));
    for (const sd of [-1, 1]) for (const f of [.45, .8]) { const bx = x - r * f, hw = at(K.body || [{ x: 0, w }], bx).w, ro = r * Math.sqrt(1 - (1 - f) ** 2) * .97; if (ro > hw) K.add(SLOT.armour, box(bx, y, sd * (hw + ro) / 2, .022, h * .7, ro - hw + .01)); } // braces from the flank to the blade
  }
  else if (st.fork) for (const s of [-1, 1]) K.add(SLOT.hull, loft(smooth([{ x: x - R * .9, w: w * .5, h, y, b: .35 }, { x: x + R * .5, w: w * .24, h: h * .55, y }, { x: x + R * .9, w: .006, h: h * .2, y }]), x - 2, x + 2).translate(0, 0, s * w * .85));
}
function engines(K, x, y, list, r, L) { // bells with a glowing throat and a trim ring
  if (K.tags && K.tags.has('t')) { r *= 1.22; L *= 1.35; } // a torch drive: bigger bells
  for (const [yy, zz] of list) { K.add(SLOT.dark, bell(x, y + yy, zz, r, L)); K.add(SLOT.glow, disc(x - L * .9, y + yy, zz, r * .74)); K.add(SLOT.trim, ringG(x - L, y + yy, zz, r * .98, r * .07)); K.bells.push(zz); }
}
// broadside gun decks that sit on the hull's flank: a deck rail, and houses of rail guns pointing outboard
function gunDecks(K, body, x0, x1, y, n, barrels, scale = 1, reach = 1) {
  const L = (x1 - x0) / n;
  if (K.tags && K.tags.has('m')) { // missile cells: armoured launch blocks with rows of hatches, where the gun houses would be
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) { const x = x0 + (i + .5) * L, s = at(body, x), z = side * s.w * .97, d = .045 * scale, hh = .06 * scale;
      K.add(SLOT.armour, box(x, y, z + side * d * .5, L * .86, hh, d));
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) K.add(SLOT.dark, box(x + (c - 1) * L * .26, y + (r - .5) * hh * .45, z + side * (d + .001), L * .18, hh * .3, .004)); }
    return;
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + .5) * L, s = at(body, x), z = side * (s.w * .97), d = .05 * scale, hh = .055 * scale;
      K.add(SLOT.armour, box(x, y, z + side * d * .5, L * .8, hh, d));                        // the gun house, built onto the flank
      K.add(SLOT.hull, box(x, y + hh * .5, z + side * d * .4, L * .86, .008 * scale, d * .9));  // its cap
      const rows = Math.max(1, Math.round(barrels / 2));
      for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) {                              // rail guns, run out to the side
        const bx = x + (c - .5) * L * .4, by = y + (r - (rows - 1) / 2) * hh * .42, z0 = z + side * d, z1 = z0 + side * .065 * scale * reach;
        K.add(SLOT.gun, cylZ(bx, by, z0, z1, .0075 * scale, 6)); K.add(SLOT.dark, cylZ(bx, by, z1 - side * .008 * scale, z1, .0105 * scale, 6));
      }
    }
    K.add(SLOT.trim, box((x0 + x1) / 2, y - .03 * scale, side * (at(body, (x0 + x1) / 2).w * .96 + .002), x1 - x0, .006 * scale, .006)); // the deck's painted line
  }
}
function patches(K, R, x0, x1, body, h, n) { // the Republic's bolted-on refit armour, in the team's colour, on the hull's flanks
  for (let i = 0; i < n; i++) { const x = x0 + R() * (x1 - x0), s = at(body, x), side = R() < .5 ? -1 : 1, L = .08 + R() * .14; K.add(SLOT.trim, box(x, s.y + s.h * (R() * .5 - .25), side * s.w * 1.0, L, s.h * (.35 + R() * .35), .016)); }
}
function stripe(K, body, x0, x1, side, y, slot = SLOT.trim) { // a painted line down the flank, following the hull
  const n = 10; for (let i = 0; i < n; i++) { const xa = x0 + (x1 - x0) * i / n, xb = x0 + (x1 - x0) * (i + 1) / n, s = at(body, (xa + xb) / 2); K.add(slot, box((xa + xb) / 2, s.y + y * s.h, side * (s.w * (1 - .3 * Math.abs(y)) + .003), xb - xa + .002, .01, .004)); }
}
function navLights(K, xs, zs, y) { K.add(SLOT.red, box(xs, y, -zs, .012, .012, .012)); K.add(SLOT.green, box(xs, y, zs, .012, .012, .012)); }
function bridge(K, x, y, w, h, tiers = 2) {
  let yy = y;
  for (let i = 0; i < tiers; i++) { const s = 1 - i * .28; K.add(i ? SLOT.armour : SLOT.hull, box(x - i * .02, yy + h * s / 2, 0, w * s, h * s, w * .55 * s)); yy += h * s; }
  K.add(SLOT.glow, box(x + w * .5 * (1 - (tiers - 1) * .28) + .002, yy - h * .3, 0, .004, h * .14, w * .38)); // the bridge's lit windows
  K.add(SLOT.dark, cylX(x - .02, x + .02, yy + .03, 0, .004)); K.add(SLOT.dark, box(x - .02, yy + .02, 0, .004, .04, .004)); // mast
  return yy;
}
// ---------------------------------------------------------------- the classes
const BUILD = {
  torch(K, st, R) { // a long rocket dart: engines clustered at the stern, raked fins, a cockpit hump
    const s = st.slim, x0 = -1.12, x1 = 1.4;
    K.loft(SLOT.hull, [{ x: x0, w: .19 * s, h: .15 }, { x: -.92, w: .21 * s, h: .16 }, { x: -.45, w: .16 * s, h: .13 }, { x: .35, w: .12 * s, h: .1 }, { x: 1, w: .055 * s, h: .055 }, { x: x1, w: .006, h: .008 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.85, w: .1 * s, h: .05, y: .15 }, { x: .2, w: .07 * s, h: .04, y: .1 }, { x: .55, w: .05 * s, h: .05, y: .09 }, { x: .72, w: .015, h: .02, y: .08 }], x0, x1);
    K.add(SLOT.glow, box(.6, .135, 0, .06, .012, .05 * s));
    engines(K, x0, 0, [[.08, .1 * s], [.08, -.1 * s], [-.08, .1 * s], [-.08, -.1 * s]], .07, .16);
    K.add(SLOT.trim, fin(-.8, -1.04, .14, .26, .42, .012, 0));
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.78, -1.02, 0, .34 * s, .48, .014, side));
    for (const side of [-1, 1]) stripe(K, body, -.8, .9, side, .2);
    navLights(K, -.95, .5 * s, 0);
    if (st.fork) bow(K, st, 1.1, 0, .05, .04, .3);
    if (st.patches) patches(K, R, -.7, .5, body, .12, 6);
    K.top = .2; return [x0, x1];
  },
  destroyer(K, st, R) { // a long spine, a crescent blade at the bow, a tower amidships, swept fins aft
    const s = st.slim, x0 = -1.05, x1 = 1.4;
    K.loft(SLOT.hull, [{ x: x0, w: .17 * s, h: .13 }, { x: -.6, w: .19 * s, h: .145 }, { x: .2, w: .13 * s, h: .11 }, { x: .85, w: .09 * s, h: .08 }, { x: 1.15, w: .06 * s, h: .06 }, { x: 1.28, w: .02, h: .03 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.9, w: .12 * s, h: .05, y: .13 }, { x: .5, w: .08 * s, h: .04, y: .1 }, { x: .7, w: .03, h: .02, y: .08 }], x0, x1);
    const top = bridge(K, -.12, .17, .15, .09, 3);
    gunDecks(K, body, -.7, .4, .02, 4, 2, .7);                                 // 4 houses of 2 a side: its 8 broadside guns
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.72, -.98, .02, .26 * s, .4, .014, side));
    K.add(SLOT.trim, fin(-.78, -.96, .16, .14, .3, .012, 0));
    engines(K, x0, 0, [[.05, 0], [-.05, .1 * s], [-.05, -.1 * s]], .065, .14);
    for (const side of [-1, 1]) stripe(K, body, .45, 1.1, side, .3);
    navLights(K, -.88, .45 * s, .02);
    bow(K, st, st.crescent ? 1.18 : 1.15, 0, .06, .05, st.crescent ? .34 : .32);
    if (st.patches) patches(K, R, -.8, .6, body, .13, 8);
    K.top = top; return [x0, x1];
  },
  dread(K, st, R) { // a capital ship, not a bigger destroyer: a flat armoured slab, heavy at the bow (a blunt wedge prow under the spinal lance), layered deck armour, 80 rail guns in two long rows of small houses, a low bridge well aft, no fins
    const s = st.slim, x0 = -1.12, x1 = 1.34, P = 'slab';
    K.loft(SLOT.hull, [{ x: x0, w: .24 * s, h: .1, p: P }, { x: -.85, w: .3 * s, h: .115, p: P }, { x: -.2, w: .32 * s, h: .12, p: P }, { x: .5, w: .31 * s, h: .125, p: P }, { x: .9, w: .26 * s, h: .12, p: P }, { x: 1.12, w: .15 * s, h: .09, p: P }, { x: 1.26, w: .04, h: .04, p: P }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.95, w: .24 * s, h: .035, y: .12, p: P }, { x: .4, w: .25 * s, h: .035, y: .13, p: P }, { x: .95, w: .17 * s, h: .03, y: .12, p: P }, { x: 1.1, w: .06, h: .015, y: .1, p: P }], x0, x1); // first armour layer
    K.loft(SLOT.hull, [{ x: -.8, w: .15 * s, h: .025, y: .16, p: P }, { x: .3, w: .16 * s, h: .028, y: .17, p: P }, { x: .8, w: .08 * s, h: .02, y: .155, p: P }], x0, x1);             // second, narrower
    K.loft(SLOT.armour, [{ x: .55, w: .2 * s, h: .05, y: -.11, p: P }, { x: 1.0, w: .18 * s, h: .06, y: -.1, p: P }, { x: 1.2, w: .05, h: .02, y: -.06, p: P }], x0, x1, false);     // the prow's keel armour: mass forward
    for (let i = 0; i < 5; i++) K.add(SLOT.armour, box(.95 + i * .06, .08 - i * .01, 0, .03, .07 - i * .01, (.3 - i * .045) * s));                                                 // the wedge's stepped glacis plates
    gunDecks(K, body, -.9, .75, .01, 20, 2, .42, .5);                        // 20 houses of 2 a side, small against the hull: 80 guns
    for (const side of [-1, 1]) { const sx = at(body, .55); K.add(SLOT.dark, box(.55, -.04, side * sx.w * .99, .16, .04, .01)); K.add(SLOT.dark, box(-.3, -.05, side * at(body, -.3).w * .99, .16, .04, .01)); } // hangar mouths, two a side
    for (let i = 0; i < 12; i++) { const x = -.95 + i * .17, sx = at(body, x); K.add(SLOT.armour, box(x, sx.h + .003, 0, .01, .006, sx.w * 1.1)); } // armour ribs across the deck
    for (let i = 0; i < 7; i++) K.add(SLOT.dark, box(-.9 + i * .26, .2, 0, .012, .018, .012));                                                  // deck masts and sensor pylons
    const top = bridge(K, -.82, .19, .11, .055, 3);
    K.add(SLOT.dark, cylX(.95, 1.42, .02, 0, .026)); K.add(SLOT.glow, disc(1.43, .02, 0, .02)); // the spinal lance
    engines(K, x0, 0, [[.04, .17 * s], [.04, -.17 * s], [.04, 0], [-.05, .09 * s], [-.05, -.09 * s]], .065, .15);
    for (const side of [-1, 1]) stripe(K, body, -.6, 1.0, side, .55);
    navLights(K, -1.0, .3 * s, .06);
    if (st.crescent) bow(K, st, 1.2, 0, .08, .05, .3); else if (st.fork) bow(K, st, 1.14, 0, .08, .05, .32);
    if (st.patches) patches(K, R, -.9, .9, body, .11, 12);
    K.top = top; return [x0, x1];
  },
  pandora(K, st, R) { // the Julii flagship: "a black, hulking monster" — heavy, but a predator's lines: a long low hull with a knife-edged flank, a raked ram prow, swept armour curtains over the gun decks, a lean citadel aft
    const s = st.slim, x0 = -1.12, x1 = 1.34, P = 'blade';
    K.loft(SLOT.hull, [{ x: x0, w: .22 * s, h: .13, p: P }, { x: -.8, w: .3 * s, h: .16, p: P }, { x: -.2, w: .31 * s, h: .165, p: P }, { x: .4, w: .27 * s, h: .15, p: P }, { x: .85, w: .18 * s, h: .11, p: P }, { x: 1.15, w: .08 * s, h: .06, p: P }, { x: 1.3, w: .015, h: .015, p: P }], x0, x1);
    const body = K.body;
    // the armour curtains: low swept blades along each flank, each raked forward, standing just proud of the gun decks
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const x = -.7 + i * .36, sx = at(body, x); K.add(SLOT.armour, loft(smooth([{ x: x - .2, w: .012, h: sx.h * .3, b: .45 }, { x: x + .02, w: .03, h: sx.h * .5, b: .45 }, { x: x + .22, w: .008, h: sx.h * .25, b: .45 }]), x0, x1).translate(0, .01, side * (sx.w + .02))); }
    K.loft(SLOT.armour, [{ x: -.95, w: .17 * s, h: .03, y: .155, p: P }, { x: .2, w: .18 * s, h: .032, y: .16, p: P }, { x: .8, w: .08 * s, h: .02, y: .12, p: P }], x0, x1);        // a long low spine of deck armour
    K.loft(SLOT.dark, [{ x: .7, w: .1 * s, h: .07, p: P }, { x: 1.1, w: .06 * s, h: .04, p: P }, { x: 1.34, w: .006, h: .006, p: P }], x0, x1);                                     // the ram prow, black, drawn out to a point
    K.loft(SLOT.armour, [{ x: .3, w: .14 * s, h: .04, y: -.12, p: P }, { x: .9, w: .1 * s, h: .04, y: -.08, p: P }, { x: 1.2, w: .03, h: .015, y: -.04, p: P }], x0, x1, false);   // keel blade under the prow
    gunDecks(K, body, -.85, .5, .035, 16, 2, .42, .5); gunDecks(K, body, -.85, .5, -.055, 16, 2, .42, .5);                                                                          // two tiers of small houses
    for (const side of [-1, 1]) { const sx = at(body, .1); K.add(SLOT.dark, box(.1, -.1, side * sx.w * .99, .24, .045, .01)); }                                                      // hangar mouths, low
    const top = bridge(K, -.62, .185, .1, .07, 3);                                                                                                                                  // a lean citadel
    for (let i = 0; i < 9; i++) { const x = -.95 + i * .2, sx = at(body, x); K.add(SLOT.armour, box(x, sx.h + .003, 0, .01, .006, sx.w * 1.0)); }
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.78, -1.02, .0, .18 * s, .36, .012, side));                                                                                    // short swept fins aft
    engines(K, x0, 0, [[.05, .12 * s], [.05, -.12 * s], [-.05, .12 * s], [-.05, -.12 * s], [0, 0]], .07, .16);
    for (const side of [-1, 1]) stripe(K, body, -.6, .9, side, .25);
    navLights(K, -1.0, .28 * s, .08);
    if (st.patches) patches(K, R, -.9, .6, body, .14, 8);
    K.top = top; return [x0, x1];
  },
  invictus(K, st, R) { // the Augustus flagship: the heaviest ship of its fleet, a broad slab a size up from the Pax, gilt-lined, a lion's crest of armour over the bridge, ten engines
    const s = st.slim, x0 = -1.14, x1 = 1.34, P = 'slab';
    K.loft(SLOT.hull, [{ x: x0, w: .3 * s, h: .12, p: P }, { x: -.85, w: .36 * s, h: .135, p: P }, { x: -.2, w: .38 * s, h: .14, p: P }, { x: .5, w: .36 * s, h: .14, p: P }, { x: .95, w: .28 * s, h: .13, p: P }, { x: 1.14, w: .15 * s, h: .09, p: P }, { x: 1.28, w: .04, h: .04, p: P }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -1.0, w: .3 * s, h: .04, y: .14, p: P }, { x: .4, w: .31 * s, h: .04, y: .15, p: P }, { x: 1.0, w: .18 * s, h: .03, y: .14, p: P }, { x: 1.14, w: .06, h: .015, y: .11, p: P }], x0, x1);
    K.loft(SLOT.hull, [{ x: -.85, w: .2 * s, h: .03, y: .185, p: P }, { x: .3, w: .21 * s, h: .032, y: .195, p: P }, { x: .85, w: .1 * s, h: .02, y: .18, p: P }], x0, x1);
    K.loft(SLOT.armour, [{ x: .5, w: .24 * s, h: .05, y: -.12, p: P }, { x: 1.0, w: .2 * s, h: .06, y: -.11, p: P }, { x: 1.22, w: .05, h: .02, y: -.06, p: P }], x0, x1, false);
    for (let i = 0; i < 5; i++) K.add(SLOT.armour, box(.98 + i * .06, .09 - i * .01, 0, .03, .08 - i * .012, (.34 - i * .05) * s));                                              // stepped glacis
    gunDecks(K, body, -.95, .8, .01, 24, 2, .42, .5);                                                                                                                           // 24 houses of 2 a side: 96 guns
    for (const side of [-1, 1]) for (const x of [-.4, .2, .7]) { const sx = at(body, x); K.add(SLOT.dark, box(x, -.04, side * sx.w * .99, .16, .04, .01)); }                       // three hangar mouths a side
    for (let i = 0; i < 13; i++) { const x = -1.0 + i * .17, sx = at(body, x); K.add(SLOT.armour, box(x, sx.h + .003, 0, .01, .006, sx.w * 1.1)); }
    for (const side of [-1, 1]) stripe(K, body, -.9, 1.05, side, .9); for (const side of [-1, 1]) stripe(K, body, -.9, 1.05, side, .2);                                            // gilt lines, two a side
    const top = bridge(K, -.85, .215, .13, .06, 3);
    K.add(SLOT.trim, fin(-.72, -.98, .22, .12, .3, .012, 0));                                                                                                                    // the lion's crest: a gilt dorsal blade over the bridge
    for (const side of [-1, 1]) K.add(SLOT.trim, fin(-.74, -.96, .2, .09, .24, .01, side));
    K.add(SLOT.dark, cylX(.98, 1.42, .02, 0, .028)); K.add(SLOT.glow, disc(1.43, .02, 0, .022));
    engines(K, x0, 0, [[.045, .2 * s], [.045, -.2 * s], [.045, .07 * s], [.045, -.07 * s], [-.055, .14 * s], [-.055, -.14 * s], [-.055, 0]], .058, .15);
    navLights(K, -1.02, .36 * s, .07);
    if (st.crescent) bow(K, st, 1.2, 0, .09, .05, .32); else if (st.fork) bow(K, st, 1.14, 0, .09, .05, .32);
    if (st.patches) patches(K, R, -.9, .9, body, .12, 14);
    K.top = top; return [x0, x1];
  },
  pax(K, st, R) { // the Vanguard, taken by Darrow and renamed the Pax: the standard five-kilometre Lune-built dreadnought — eighty railguns, eight engines, four hangar bays
    const s = st.slim, x0 = -1.12, x1 = 1.34, P = 'slab';
    K.loft(SLOT.hull, [{ x: x0, w: .25 * s, h: .105, p: P }, { x: -.85, w: .3 * s, h: .115, p: P }, { x: -.2, w: .32 * s, h: .12, p: P }, { x: .5, w: .31 * s, h: .125, p: P }, { x: .9, w: .26 * s, h: .12, p: P }, { x: 1.12, w: .15 * s, h: .09, p: P }, { x: 1.26, w: .04, h: .04, p: P }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.95, w: .24 * s, h: .035, y: .12, p: P }, { x: .4, w: .25 * s, h: .035, y: .13, p: P }, { x: .95, w: .17 * s, h: .03, y: .12, p: P }, { x: 1.1, w: .06, h: .015, y: .1, p: P }], x0, x1);
    K.loft(SLOT.hull, [{ x: -.8, w: .15 * s, h: .025, y: .16, p: P }, { x: .3, w: .16 * s, h: .028, y: .17, p: P }, { x: .8, w: .08 * s, h: .02, y: .155, p: P }], x0, x1);
    K.loft(SLOT.armour, [{ x: .55, w: .2 * s, h: .05, y: -.11, p: P }, { x: 1.0, w: .18 * s, h: .06, y: -.1, p: P }, { x: 1.2, w: .05, h: .02, y: -.06, p: P }], x0, x1, false);
    for (let i = 0; i < 5; i++) K.add(SLOT.armour, box(.95 + i * .06, .08 - i * .01, 0, .03, .07 - i * .01, (.3 - i * .045) * s));
    gunDecks(K, body, -.9, .75, .01, 20, 2, .42, .5);                                                                                                                           // 80 guns
    for (const side of [-1, 1]) for (const x of [-.45, .55]) { const sx = at(body, x); K.add(SLOT.dark, box(x, -.04, side * sx.w * .99, .22, .045, .01)); }                       // four hangar bays, the forward pair the long ones
    for (let i = 0; i < 12; i++) { const x = -.95 + i * .17, sx = at(body, x); K.add(SLOT.armour, box(x, sx.h + .003, 0, .01, .006, sx.w * 1.1)); }
    const top = bridge(K, -.82, .19, .11, .055, 3);
    K.add(SLOT.dark, cylX(.95, 1.42, .02, 0, .026)); K.add(SLOT.glow, disc(1.43, .02, 0, .02));
    engines(K, x0, 0, [[.05, .18 * s], [.05, -.18 * s], [.05, .06 * s], [.05, -.06 * s], [-.05, .18 * s], [-.05, -.18 * s], [-.05, .06 * s], [-.05, -.06 * s]], .052, .15); // eight engines
    for (const side of [-1, 1]) stripe(K, body, -.6, 1.0, side, .55);
    navLights(K, -1.0, .3 * s, .06);
    if (st.crescent) bow(K, st, 1.2, 0, .08, .05, .3); else if (st.fork) bow(K, st, 1.14, 0, .08, .05, .32);
    if (st.patches) patches(K, R, -.9, .9, body, .11, 12);
    K.top = top; return [x0, x1];
  },
  spear(K, st, R) { // the Annihilo: a long shaft, a leaf-bladed head, broadside decks along the shaft
    const s = st.slim, x0 = -1.12, x1 = 1.32;
    K.loft(SLOT.hull, [{ x: x0, w: .2 * s, h: .14 }, { x: -.9, w: .22 * s, h: .15 }, { x: -.2, w: .16 * s, h: .12 }, { x: .45, w: .12 * s, h: .1 }, { x: .62, w: .1 * s, h: .09 },
      { x: .68, w: .13 * s, h: .06, b: .45 }, { x: .88, w: .25 * s, h: .045, b: .48 }, { x: 1.08, w: .2 * s, h: .04, b: .48 }, { x: 1.25, w: .07 * s, h: .025, b: .48 }, { x: x1, w: .006, h: .008 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.95, w: .12 * s, h: .05, y: .14 }, { x: .4, w: .08 * s, h: .04, y: .1 }, { x: .55, w: .02, h: .02, y: .09 }], x0, x1);
    K.add(SLOT.armour, box(.62, 0, 0, .04, .15, .3 * s)); K.add(SLOT.trim, box(.62, .076, 0, .042, .006, .3 * s)); // the head's socket and crossguard, a red line along its top
    K.add(SLOT.armour, loft(smooth([{ x: .64, w: .03, h: .03, b: .45 }, { x: .9, w: .028, h: .03, b: .45 }, { x: 1.3, w: .003, h: .004 }]), x0, x1).translate(0, .03, 0)); // the blade's spine ridge
    for (const side of [-1, 1]) K.add(SLOT.trim, loft(smooth([{ x: .7, w: .006, h: .004 }, { x: .95, w: .008, h: .004 }, { x: 1.24, w: .002, h: .002 }]), x0, x1).translate(0, .046, side * .09)); // gilt lines down the blade
    gunDecks(K, body, -.8, .4, .02, 10, 4, .8, .55);
    for (const side of [-1, 1]) stripe(K, body, .66, 1.2, side, .2);
    K.add(SLOT.trim, fin(-.82, -1.04, .17, .2, .36, .014, 0));
    const top = bridge(K, -.65, .19, .18, .1, 3);
    engines(K, x0, 0, [[.06, .1 * s], [.06, -.1 * s], [-.06, .1 * s], [-.06, -.1 * s]], .075, .16);
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.8, -1.06, 0, .3 * s, .44, .014, side));
    navLights(K, -1.0, .3 * s, .05);
    K.top = top; return [x0, x1];
  },
  moonbreaker(K, st, R) { // "twice the length of my ship, three times the girth ... a floating military dock city": a slab keel carrying a vast forward dock block, its back a city of decks and towers, twin siege lances, 160 guns in four rows, a bridge tower aft
    const s = st.slim, x0 = -1.16, x1 = 1.3, P = 'slab';
    K.loft(SLOT.hull, [{ x: x0, w: .3 * s, h: .16, p: P }, { x: -.9, w: .34 * s, h: .18, p: P }, { x: -.4, w: .36 * s, h: .19, p: P }, { x: -.1, w: .48 * s, h: .27, p: P }, { x: .6, w: .5 * s, h: .28, p: P }, { x: .95, w: .36 * s, h: .2, p: P }, { x: 1.15, w: .14 * s, h: .1, p: P }, { x: 1.26, w: .03, h: .04, p: P }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -1.0, w: .25 * s, h: .05, y: .17, p: P }, { x: -.3, w: .3 * s, h: .05, y: .2, p: P }, { x: -.12, w: .2 * s, h: .03, y: .22, p: P }], x0, x1);          // aft deck armour
    K.loft(SLOT.armour, [{ x: -.95, w: .22 * s, h: .05, y: -.17, p: P }, { x: .5, w: .34 * s, h: .07, y: -.28, p: P }, { x: 1.0, w: .18, h: .05, y: -.2, p: P }, { x: 1.2, w: .04, h: .02, y: -.1, p: P }], x0, x1, false); // the keel, deepest under the dock
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const x = .05 + i * .18, sx = at(body, x); K.add(SLOT.dark, box(x, -.02, side * sx.w * .99, .12, .12, .012)); K.add(SLOT.glow, box(x, -.02, side * (sx.w * .99 + .007), .1, .1, .004)); } // the dock's open bays, lit
    for (let i = 0; i < 6; i++) { const x = -.05 + i * .16, sx = at(body, x); K.add(SLOT.armour, box(x, sx.h + .004, 0, .014, .01, sx.w * 1.3)); }       // armour ribs across the dock's back
    // the dock's back: layered armour decks stepping up to a long armoured spine, hangar tiers cut into the steps, sensor masts
    K.loft(SLOT.armour, [{ x: -.1, w: .4 * s, h: .03, y: .28, p: P }, { x: .5, w: .42 * s, h: .03, y: .29, p: P }, { x: .9, w: .28 * s, h: .025, y: .27, p: P }, { x: 1.05, w: .1, h: .012, y: .24, p: P }], x0, x1);
    K.loft(SLOT.hull, [{ x: -.05, w: .26 * s, h: .035, y: .32, p: P }, { x: .45, w: .28 * s, h: .04, y: .33, p: P }, { x: .82, w: .14 * s, h: .025, y: .3, p: P }], x0, x1);
    K.loft(SLOT.armour, [{ x: .0, w: .12 * s, h: .03, y: .37, p: P }, { x: .4, w: .13 * s, h: .035, y: .38, p: P }, { x: .7, w: .05, h: .015, y: .35, p: P }], x0, x1);
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) { const x = .02 + i * .16; K.add(SLOT.dark, box(x, .325, side * .27 * s, .1, .05, .012)); K.add(SLOT.glow, box(x, .325, side * (.27 * s + .007), .08, .04, .004)); } // hangar tiers in the step, lit
    for (let i = 0; i < 8; i++) { const x = -.05 + i * .13; K.add(SLOT.armour, box(x, .42, 0, .012, .012, .25 * s)); }                      // armour ribs across the spine
    for (const x of [.15, .55]) { K.add(SLOT.dark, box(x, .47, 0, .01, .08, .01)); K.add(SLOT.dark, box(x, .5, 0, .006, .006, .08)); }        // sensor masts
    const top = bridge(K, -.65, .25, .16, .08, 3);
    gunDecks(K, body, -1.0, -.2, .02, 10, 2, .5, .5); gunDecks(K, body, -1.0, -.2, -.06, 10, 2, .5, .5);  // aft: 20 houses of 2 a side in two rows
    gunDecks(K, body, 0, .9, .1, 15, 2, .5, .5); gunDecks(K, body, 0, .9, -.1, 15, 2, .5, .5);           // the dock's flanks: 30 houses of 2 a side in two rows: 160 guns in all
    for (const z of [-1, 1]) { K.add(SLOT.dark, cylX(.9, 1.4, .0, z * .12, .04)); K.add(SLOT.armour, box(1.0, .0, z * .12, .3, .1, .09)); K.add(SLOT.glow, disc(1.41, .0, z * .12, .03)); } // twin siege lances
    engines(K, x0, 0, [[.08, .2 * s], [.08, 0], [.08, -.2 * s], [-.08, .1 * s], [-.08, -.1 * s]], .09, .2);
    for (const side of [-1, 1]) stripe(K, body, -.9, -.2, side, .5);
    navLights(K, -1.05, .32 * s, .1);
    if (st.crescent) bow(K, st, 1.18, 0, .12, .07, .3); else if (st.fork) bow(K, st, 1.12, 0, .13, .07, .32);
    if (st.patches) patches(K, R, -1, .9, body, .22, 18);
    K.top = top; return [x0, x1];
  },

  // ---------------- the small ships, in the same family: a spine, a stepped deck, swept fins, the navy's bow
  frigate(K, st, R) { // a short destroyer: a spine, a low tower, two gun houses a side, swept fins
    const s = st.slim, x0 = -1, x1 = 1.35;
    K.loft(SLOT.hull, [{ x: x0, w: .16 * s, h: .125 }, { x: -.62, w: .175 * s, h: .135 }, { x: .15, w: .13 * s, h: .105 }, { x: .75, w: .08 * s, h: .075 }, { x: 1.12, w: .04 * s, h: .045 }, { x: 1.3, w: .012, h: .016 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.85, w: .1 * s, h: .05, y: .125 }, { x: .35, w: .07 * s, h: .04, y: .1 }, { x: .6, w: .025, h: .02, y: .08 }], x0, x1);
    const top = bridge(K, -.32, .16, .15, .085, 2);
    gunDecks(K, body, -.6, .15, .015, 2, 2, .7, .6);
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.66, -.94, .02, .26 * s, .38, .014, side));
    K.add(SLOT.trim, fin(-.72, -.94, .15, .17, .32, .012, 0));
    engines(K, x0, 0, [[.04, .07 * s], [.04, -.07 * s], [-.05, 0]], .06, .13);
    for (const side of [-1, 1]) stripe(K, body, .35, 1.05, side, .3);
    navLights(K, -.85, .32 * s, .02);
    bow(K, st, 1.1, 0, .05, .045, .28);
    if (st.patches) patches(K, R, -.7, .5, body, .11, 5);
    K.top = top; return [x0, x1];
  },
  corvette(K, st, R) { // a fast escort: a slim dart between two outrigger engine pods
    const s = st.slim, x0 = -1, x1 = 1.3;
    K.loft(SLOT.hull, [{ x: x0, w: .12 * s, h: .1 }, { x: -.7, w: .135 * s, h: .11 }, { x: 0, w: .1 * s, h: .085 }, { x: .7, w: .06 * s, h: .055 }, { x: 1.12, w: .02, h: .022 }, { x: x1, w: .004, h: .006 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.8, w: .07 * s, h: .04, y: .1 }, { x: .3, w: .045 * s, h: .03, y: .08 }, { x: .5, w: .015, h: .015, y: .07 }], x0, x1);
    for (const z of [-1, 1]) {                                                        // the outrigger pods and their pylons
      K.add(SLOT.hull, loft(smooth([{ x: -1, w: .045, h: .05, b: .45 }, { x: -.7, w: .055, h: .06, b: .45 }, { x: -.25, w: .04, h: .045, b: .45 }, { x: -.05, w: .008, h: .01 }]), x0, x1).translate(0, -.01, z * .24 * s));
      K.add(SLOT.armour, box(-.55, -.005, z * .17 * s, .22, .02, .14 * s));
      K.add(SLOT.trim, box(-.45, .04, z * .24 * s, .3, .006, .02));
    }
    const top = bridge(K, -.15, .11, .13, .07, 2);
    K.add(SLOT.trim, fin(-.7, -.92, .1, .16, .3, .012, 0));
    engines(K, x0, 0, [[0, 0], [-.01, .24 * s], [-.01, -.24 * s]], .05, .11);
    for (const side of [-1, 1]) stripe(K, body, .2, 1.0, side, .3);
    navLights(K, -.85, .29 * s, 0);
    if (st.fork) bow(K, st, 1.05, 0, .04, .03, .25); else if (st.crescent) bow(K, st, 1.08, 0, .04, .035, .22);
    if (st.patches) patches(K, R, -.6, .4, body, .09, 4);
    K.top = top; return [x0, x1];
  },
  corsair(K, st, R) { // a brawler: a deep hull with armoured belts down the flanks, a turret deck and a heavy ram
    const s = st.slim, x0 = -1, x1 = 1.2;
    K.loft(SLOT.hull, [{ x: x0, w: .19 * s, h: .14 }, { x: -.55, w: .21 * s, h: .155 }, { x: .25, w: .17 * s, h: .13 }, { x: .8, w: .11 * s, h: .09 }, { x: 1.08, w: .05, h: .05 }, { x: x1, w: .012, h: .018 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.8, w: .12 * s, h: .05, y: .14 }, { x: .45, w: .09 * s, h: .045, y: .12 }, { x: .7, w: .03, h: .02, y: .1 }], x0, x1);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const x = -.6 + i * .32, sx = at(body, x); K.add(SLOT.armour, box(x, -.01, side * (sx.w + .012), .26, sx.h * 1.1, .024)); } // armour belts
    const top = bridge(K, -.4, .19, .19, .09, 2);
    gunDecks(K, body, -.5, .35, .01, 3, 2, .7, .55);
    K.add(SLOT.armour, loft(smooth([{ x: .85, w: .07, h: .07 }, { x: 1.1, w: .05, h: .05 }, { x: 1.24, w: .015, h: .02 }]), x0, x1)); // the ram
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.7, -.98, .02, .32 * s, .42, .016, side));
    engines(K, x0, 0, [[.05, .1 * s], [.05, -.1 * s], [-.06, .1 * s], [-.06, -.1 * s]], .065, .13);
    for (const side of [-1, 1]) stripe(K, body, .5, 1.05, side, .35);
    navLights(K, -.88, .36 * s, .02);
    if (st.fork) bow(K, st, 1.0, 0, .06, .05, .28);
    if (st.patches) patches(K, R, -.7, .5, body, .12, 5);
    K.top = top; return [x0, x1];
  },
  raider(K, st, R) { // the Rim Lancer: a lean hull behind a long spinal lance, big swept fins, the Rim's fork
    const s = st.slim, x0 = -1.1, x1 = 1.5;
    K.loft(SLOT.hull, [{ x: x0, w: .16 * s, h: .12 }, { x: -.65, w: .18 * s, h: .13 }, { x: 0, w: .12 * s, h: .1 }, { x: .45, w: .07 * s, h: .07 }, { x: .9, w: .035, h: .035 }, { x: 1.2, w: .012, h: .014 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.95, w: .1 * s, h: .05, y: .12 }, { x: .2, w: .06 * s, h: .04, y: .1 }, { x: .4, w: .02, h: .02, y: .08 }], x0, x1);
    K.add(SLOT.dark, cylX(.3, 1.48, 0, 0, .022)); K.add(SLOT.armour, box(.55, 0, 0, .3, .05, .07)); K.add(SLOT.glow, disc(1.49, 0, 0, .016)); // the lance
    for (let i = 0; i < 4; i++) K.add(SLOT.trim, ringG(.75 + i * .18, 0, 0, .028, .006));
    const top = bridge(K, -.55, .17, .17, .08, 2);
    gunDecks(K, body, -.6, -.05, .015, 2, 2, .7, .55);
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.7, -1.12, .02, .5 * s, .55, .014, side));
    K.add(SLOT.trim, fin(-.78, -1.08, .17, .24, .38, .012, 0));
    engines(K, x0, 0, [[.04, .08 * s], [.04, -.08 * s], [-.05, 0]], .06, .14);
    for (const side of [-1, 1]) stripe(K, body, -.4, .5, side, .3);
    navLights(K, -.95, .34 * s, .02);
    if (st.fork) bow(K, st, .95, 0, .05, .04, .3);
    K.top = top; return [x0, x1];
  },
  scout(K, st, R) { // the sensor picket: a needle hull carrying a dish, mast arrays and long sensor booms
    const s = st.slim, x0 = -1, x1 = 1.45;
    K.loft(SLOT.hull, [{ x: x0, w: .1 * s, h: .085 }, { x: -.6, w: .115 * s, h: .095 }, { x: .2, w: .075 * s, h: .065 }, { x: .95, w: .03, h: .03 }, { x: x1, w: .004, h: .004 }], x0, x1);
    const body = K.body;
    K.loft(SLOT.armour, [{ x: -.8, w: .06 * s, h: .03, y: .085 }, { x: .2, w: .04 * s, h: .025, y: .065 }, { x: .4, w: .012, h: .012, y: .055 }], x0, x1);
    { const g = new THREE.CylinderGeometry(.11, .035, .025, 20); g.rotateZ(-.5); g.translate(-.25, .2, 0); K.add(SLOT.armour, g); K.add(SLOT.dark, box(-.25, .14, 0, .02, .1, .02)); K.add(SLOT.glow, box(-.2, .245, 0, .01, .01, .01)); } // the dish
    for (const x of [-.6, .1]) { K.add(SLOT.dark, box(x, .14, 0, .008, .12, .008)); K.add(SLOT.dark, box(x, .19, 0, .006, .006, .09)); } // mast arrays
    for (const z of [-1, 1]) { K.add(SLOT.dark, cylX(-.5, .95, 0, z * .16 * s, .006)); K.add(SLOT.armour, box(-.3, 0, z * .1 * s, .05, .012, .14 * s)); K.add(SLOT.glow, disc(.96, 0, z * .16 * s, .006)); } // sensor booms
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.62, -.96, .01, .26 * s, .38, .01, side));
    engines(K, x0, 0, [[0, 0]], .055, .12);
    for (const side of [-1, 1]) stripe(K, body, -.2, .9, side, .3);
    navLights(K, -.85, .28 * s, 0);
    K.top = .26; return [x0, x1];
  },
  tender(K, st, R) { // the supply tender: a cargo spine racked with containers and tanks between an engine block and a forward bridge
    const s = st.slim, x0 = -1.05, x1 = 1.1;
    K.loft(SLOT.hull, [{ x: x0, w: .17 * s, h: .14 }, { x: -.75, w: .18 * s, h: .15 }, { x: -.6, w: .07, h: .06 }, { x: .55, w: .07, h: .06 }, { x: .65, w: .13 * s, h: .11 }, { x: .95, w: .1 * s, h: .085 }, { x: x1, w: .03, h: .035 }], x0, x1);
    const body = K.body;
    for (let i = 0; i < 6; i++) { const x = -.5 + i * .19; for (const z of [-1, 1]) { K.add(i % 3 === 1 ? SLOT.trim : i % 2 ? SLOT.armour : SLOT.hull, box(x, .0, z * .12, .16, .11, .09)); } K.add(SLOT.hull, box(x, .1, 0, .16, .07, .14)); } // containers
    for (const z of [-1, 1]) K.add(SLOT.armour, cylX(-.55, .5, -.09, z * .09, .035, 12)); // fuel tanks under the racks
    for (let i = 0; i < 4; i++) K.add(SLOT.dark, box(-.48 + i * .32, .0, 0, .012, .2, .32)); // the rack frames
    const top = bridge(K, .75, .1, .15, .07, 2);
    for (const side of [-1, 1]) K.add(SLOT.hull, fin(-.78, -1.02, .02, .28 * s, .3, .014, side));
    engines(K, x0, 0, [[.05, .08 * s], [.05, -.08 * s], [-.06, 0]], .065, .13);
    navLights(K, -.9, .2 * s, .02);
    if (st.patches) patches(K, R, -1, -.8, body, .12, 2);
    K.top = top; return [x0, x1];
  },
  hauler(K, st, R) { // the cosmosHauler: a mining barge, an open truss of ore hoppers and He-3 tanks behind a pair of scoop arms
    const s = st.slim, x0 = -1, x1 = 1;
    K.loft(SLOT.hull, [{ x: x0, w: .22 * s, h: .16 }, { x: -.75, w: .24 * s, h: .17 }, { x: -.55, w: .2 * s, h: .15 }, { x: -.5, w: .05, h: .05 }, { x: .7, w: .05, h: .05 }, { x: .78, w: .1, h: .08 }, { x: .9, w: .06, h: .05 }], x0, x1);
    const body = K.body;
    for (const z of [-1, 1]) { K.add(SLOT.dark, box(.1, -.07, z * .19, 1.25, .025, .025)); K.add(SLOT.dark, box(.1, .07, z * .19, 1.25, .025, .025)); } // the truss rails
    for (let i = 0; i < 6; i++) { const x = -.42 + i * .2; K.add(SLOT.dark, box(x, 0, 0, .02, .16, .4)); K.add(i % 2 ? SLOT.armour : SLOT.hull, box(x + .09, -.01, 0, .15, .12, .3)); } // ribs and ore hoppers
    for (const z of [-1, 1]) { K.add(SLOT.armour, cylX(-.45, .55, .13, z * .1, .045, 12)); K.add(SLOT.trim, ringG(-.2, .13, z * .1, .047, .006)); K.add(SLOT.trim, ringG(.3, .13, z * .1, .047, .006)); } // He-3 tanks on top, banded in the navy's colour
    for (const z of [-1, 1]) { K.add(SLOT.armour, box(.95, -.02, z * .14, .26, .05, .04, z * .35)); K.add(SLOT.gun, box(1.06, -.03, z * .1, .08, .04, .03, -z * .5)); } // the scoop arms
    const top = bridge(K, -.75, .17, .16, .08, 2);
    engines(K, x0, 0, [[.06, .1 * s], [.06, -.1 * s], [-.06, .1 * s], [-.06, -.1 * s]], .065, .12);
    for (const side of [-1, 1]) stripe(K, body, -1, -.56, side, .3);
    navLights(K, -.85, .26 * s, .02);
    K.top = top; return [x0, x1];
  },
  boarder(K, st, R) { // the assault pod: an armoured slug, banded, with a drill head and one heavy engine
    const x0 = -1, x1 = 1.25;
    K.loft(SLOT.armour, [{ x: x0, w: .2, h: .2, b: .45 }, { x: -.55, w: .27, h: .26, b: .45 }, { x: .25, w: .25, h: .24, b: .45 }, { x: .75, w: .19, h: .18, b: .45 }, { x: .95, w: .13, h: .13, b: .45 }], x0, x1);
    const body = K.body;
    for (const x of [-.6, -.2, .2, .6]) { const a = at(body, x); K.add(SLOT.hull, loft(smooth([{ x: x - .04, w: a.w * 1.05, h: a.h * 1.05, b: .45 }, { x: x + .04, w: a.w * 1.05, h: a.h * 1.05, b: .45 }], 1), x0, x1)); } // the bands
    { const g = new THREE.ConeGeometry(.12, .32, 12); g.rotateZ(-Math.PI / 2); g.translate(1.1, 0, 0); K.add(SLOT.gun, g); } // the drill head
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; K.add(SLOT.dark, box(.98, Math.sin(a) * .11, Math.cos(a) * .11, .1, .03, .03)); } // its cutter mounts
    K.add(SLOT.trim, box(-.2, .27, 0, .6, .01, .05)); // a painted line along the back
    engines(K, x0, 0, [[0, 0]], .13, .2);
    K.top = .3; return [x0, x1];
  },
};

// a class's fittings, drawn onto any hull: armour belts down the flanks, a point-defence screen of blisters,
// wider hangar mouths, heavy-rail barrels, shield emitters, radiator vanes for a cold-running drive
function fittings(K, x0, x1, R) {
  const T = K.tags, body = K.body; if (!T || !T.size || !body) return; const span = x1 - x0;
  if (T.has('a')) for (const side of [-1, 1]) for (let i = 0; i < 5; i++) { const x = x0 + span * (.22 + i * .13), s = at(body, x); K.add(SLOT.armour, box(x, s.y - s.h * .25, side * (s.w + .01), span * .1, s.h * .7, .02)); }
  if (T.has('p')) for (const side of [-1, 1]) for (let i = 0; i < 6; i++) { const x = x0 + span * (.2 + i * .11), s = at(body, x); K.add(SLOT.gun, box(x, s.y + s.h * .85, side * s.w * .7, .028, .02, .028)); K.add(SLOT.dark, cylX(x, x + .03, s.y + s.h * .85 + .012, side * s.w * .7, .003, 5)); }
  if (T.has('c')) for (const side of [-1, 1]) { const x = x0 + span * .62, s = at(body, x); K.add(SLOT.dark, box(x, s.y - s.h * .1, side * s.w * .995, span * .14, s.h * .5, .012)); K.add(SLOT.trim, box(x, s.y + s.h * .2, side * (s.w + .004), span * .14, .008, .006)); }
  if (T.has('s')) for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { const x = x0 + span * (.3 + i * .2), s = at(body, x); K.add(SLOT.glow, box(x, s.y + s.h * .55, side * (s.w * .98 + .002), .03, .012, .004)); K.add(SLOT.armour, box(x, s.y + s.h * .55, side * (s.w * .96), .045, .03, .02)); }
  if (T.has('q')) for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const x = x0 + span * (.08 + i * .05), s = at(body, x); K.add(SLOT.dark, box(x, s.y + s.h + .025, side * s.w * .45, .012, .05, s.w * .5)); }
  if (T.has('h')) for (const side of [-1, 1]) { const x = x0 + span * .78, s = at(body, x); K.add(SLOT.dark, cylX(x, x + span * .12, s.y + s.h + .02, side * s.w * .3, .012)); K.add(SLOT.armour, box(x, s.y + s.h + .012, side * s.w * .3, .06, .03, .04)); }
}

// every other class: a body lofted from its outline, with a deckhouse, a painted line and its engines
function generic(K, type, fac, st) {
  const pts = fshape(type, fac) || SHAPES[type], [x0, x1] = extent(pts), n = 9, secs = [];
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * (.02 + .96 * i / n), w = Math.max(.01, halfWidth(pts, x)); secs.push({ x, w: w * .92, h: Math.min(.16, Math.max(.035, w * .38)), b: .35 }); }
  K.loft(SLOT.hull, secs, x0, x1);
  const body = K.body, mid = x0 + (x1 - x0) * .4, mw = at(body, mid);
  K.add(SLOT.armour, box(mid, mw.h + .03, 0, (x1 - x0) * .22, .06, mw.w * .7));
  K.add(SLOT.glow, box(mid + (x1 - x0) * .11, mw.h + .045, 0, .004, .015, mw.w * .4));
  for (const side of [-1, 1]) stripe(K, body, x0 + .2, x1 - .3, side, .25);
  const nb = (LEN_M[type] || 0) >= 600 ? 2 : 1; engines(K, x0 + .02, 0, nb === 2 ? [[0, .12], [0, -.12]] : [[0, 0]], .065, .12);
  if (st.patches) { const R = rnd(seedOf(type + fac)); patches(K, R, x0 + .3, x1 - .4, body, .08, 4); }
  K.top = mw.h + .06; return [x0, x1];
}

const CACHE = {};
export const HAS_3D = t => !!(LEN_M[t] && !['ripwing', 'starshell'].includes(t));
// → { geo (with material groups by SLOT), bells (z offsets), xmin, top, hw(x) half-width, deck(x, z) height of the hull's top }
export function buildHull(type, fac, variant = '') {
  const key = type + ':' + (fac || 'none') + ':' + variant; if (CACHE[key]) return CACHE[key];
  const st = STYLE[fac] || STYLE.none, K = new Kit(), R = rnd(seedOf(key)), [vb, tags = ''] = variant.split('|'); K.profile = st.profile;
  K.tags = new Set(tags); const fn = BUILD[vb] || BUILD[type];
  const [x0, x1] = fn ? fn(K, st, R) : generic(K, type, fac, st);
  fittings(K, x0, x1, R);
  const body = K.body, surf = K.surf;
  const hw = x => Math.max(.02, at(body, Math.max(x0, Math.min(x1, x))).w);
  // the height of the hull's top surface at (x, z), down the chamfer toward the flank
  const surfTop = (a, z) => { const c = Math.min(.49, a.b ?? .3), az = Math.abs(z), e = a.w * (1 - c); return (a.y || 0) + (az <= e ? a.h : a.h - (az - e) * a.h / a.w); };
  const deck = (x, z) => { let top = -1e9; for (const S of surf) if (inX(S, x)) { const a = at(S, x); if (Math.abs(z) <= a.w * .98) top = Math.max(top, surfTop(a, z)); } return top > -1e8 ? top : surfTop(at(body, x), z); };
  return CACHE[key] = { geo: K.build(), bells: K.bells, xmin: x0, top: K.top, hw, deck, band: K.band };
}

// ---------------------------------------------------------------- the stations
// Built for render.js's buildStruct: a list of [slot, geometry] in station units (the hit radius is 1; y up). Slots are
// the struct material names: hull, armour, dark, gun, trim (the owner's colour), glow (emitters, hangar mouths), win (lit
// windows, warm), lt (blinking nav lights). The dockyard keeps its own build (a slip with a hull on the stocks) in render.js.
const SG = { cyl: (rt, rb, h, seg, x, y, z, rx = 0, rz = 0) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; },
  box: (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; },
  torus: (r, t, seg, x, y, z) => { const g = new THREE.TorusGeometry(r, t, 8, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; },
  sph: (r, x, y, z, ws = 12, hs = 8) => { const g = new THREE.SphereGeometry(r, ws, hs); g.translate(x, y, z); return g; } };
export function buildStation(type) {
  const P = [], add = (slot, g) => P.push([slot, g]), TAU = Math.PI * 2;
  // a radial part: placed at radius r, angle a, turned to face outward
  const at = (slot, g, r, a, y = 0) => { g.rotateY(-a); g.translate(Math.cos(a) * r, y, Math.sin(a) * r); add(slot, g); };
  const windows = (r, y, n, w = .05, h = .012) => { for (let i = 0; i < n; i++) { const a = i / n * TAU; if ((i * 7) % 5 === 0) continue; at('win', SG.box(w, h, .01, 0, 0, 0), r, a, y); } };
  if (type === 'station') { // the Citadel: a great habitat ring on four spars round an armoured hub, bastions with spitTube batteries on the ring, docking arms out past it, a command tower on the hub
    add('hull', SG.torus(.8, .07, 96, 0, 0, 0)); add('trim', SG.torus(.8, .012, 96, 0, .075, 0)); add('trim', SG.torus(.8, .012, 96, 0, -.075, 0));
    windows(.872, .02, 72); windows(.872, -.02, 72);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; // the bastions: an armoured block over the ring, spitTubes in rows on its face, a rail turret on top
      at('armour', SG.box(.2, .16, .22, 0, 0, 0), .8, a); at('dark', SG.box(.16, .04, .22, 0, 0, 0), .8, a, .1);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) at('dark', SG.cyl(.012, .012, .03, 6, (c - 1.5) * .04, (r - .5) * .05, 0, Math.PI / 2), .905, a);
      at('hull', SG.cyl(.045, .05, .03, 10, 0, 0, 0), .8, a, .095); at('gun', SG.cyl(.008, .008, .09, 6, .04, 0, 0, 0, Math.PI / 2), .8, a, .11);
      at('lt', SG.sph(.02, 0, 0, 0, 8, 6), .93, a, .02);
    }
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; // spars from hub to ring, and the docking arms beyond, each ending in a cradle
      at('hull', SG.box(.5, .045, .06, 0, 0, 0), .49, a); at('dark', SG.box(.5, .02, .03, 0, 0, 0), .49, a, .03);
      at('armour', SG.box(.3, .04, .05, 0, 0, 0), 1.02, a); at('hull', SG.box(.06, .08, .2, 0, 0, 0), 1.17, a); at('glow', SG.box(.02, .05, .16, 0, 0, 0), 1.2, a);
      at('lt', SG.sph(.018, 0, 0, 0, 8, 6), 1.2, a, .06);
    }
    add('dark', SG.cyl(.3, .34, .24, 24, 0, 0, 0)); add('trim', SG.cyl(.31, .31, .02, 24, 0, .12, 0)); add('armour', SG.cyl(.34, .3, .06, 24, 0, -.14, 0));   // the hub
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; at('dark', SG.box(.02, .06, .1, 0, 0, 0), .33, a, -.02); at('glow', SG.box(.012, .04, .08, 0, 0, 0), .335, a, -.02); } // hangar mouths, lit
    add('hull', SG.cyl(.16, .22, .14, 16, 0, .19, 0)); add('armour', SG.cyl(.1, .16, .12, 16, 0, .32, 0)); add('hull', SG.cyl(.06, .1, .1, 12, 0, .43, 0));    // the command tower, stepped
    windows(.165, .19, 20, .03, .01); windows(.105, .32, 14, .025, .01);
    add('glow', SG.cyl(.062, .062, .025, 12, 0, .49, 0)); add('dark', SG.cyl(.012, .02, .3, 6, 0, .65, 0)); add('lt', SG.sph(.025, 0, .81, 0, 8, 6));           // the bridge's lit crown, the mast
    add('hull', SG.cyl(.14, .26, .2, 16, 0, -.26, 0)); add('glow', SG.cyl(.09, .09, .02, 16, 0, -.37, 0));                                                     // the reactor below, lit
  } else if (type === 'outpost') { // the Mining Station: a hexagonal refinery drum ringed with He-3 tanks, three collector arms ending in scoop dishes, a flare stack
    add('dark', SG.cyl(.5, .5, .26, 6, 0, 0, 0)); add('trim', SG.cyl(.51, .51, .02, 6, 0, .13, 0)); add('armour', SG.cyl(.44, .5, .08, 6, 0, -.17, 0));
    windows(.5, .04, 24, .04, .012);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; at('hull', SG.cyl(.09, .09, .3, 12, 0, 0, 0, Math.PI / 2), .62, a, -.02); at('trim', SG.torus(.092, .008, 12, 0, 0, 0), .62, a, -.02); } // the tanks, banded
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; at('hull', SG.box(.5, .06, .1, 0, 0, 0), .78, a); at('dark', SG.box(.5, .02, .03, 0, 0, 0), .78, a, .04);
      at('armour', SG.cyl(.16, .04, .1, 14, 0, 0, 0, 0, -Math.PI / 2), 1.08, a); at('glow', SG.cyl(.06, .06, .02, 12, 0, 0, 0, 0, -Math.PI / 2), 1.0, a); at('lt', SG.sph(.02, 0, 0, 0, 8, 6), 1.16, a); } // collector arms and scoop dishes
    add('hull', SG.cyl(.18, .24, .18, 12, 0, .22, 0)); windows(.185, .22, 12, .03, .012); add('dark', SG.cyl(.03, .04, .34, 8, .3, .3, .2)); add('glow', SG.sph(.05, .3, .5, .2, 10, 8)); // control block, flare stack
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + .4; at('dark', SG.cyl(.012, .012, .3, 6, 0, 0, 0, 0, Math.PI / 2), .35, a, .1); }                   // pipework
  } else if (type === 'gunplat') { // the Gun Platform: an orbital rail battery — an armoured drum core, a heavy twin-rail turret on a barbette, long barrels with cooling rings, capacitor banks and radiator vanes round the core, a docking collar beneath
    add('armour', SG.cyl(.46, .5, .3, 12, 0, 0, 0)); add('dark', SG.cyl(.5, .5, .04, 12, 0, .17, 0)); add('hull', SG.cyl(.52, .46, .08, 12, 0, -.19, 0));   // the core, faceted
    windows(.48, -.06, 24, .04, .012);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; at('armour', SG.box(.18, .22, .3, 0, 0, 0), .5, a, -.02); at('dark', SG.box(.06, .16, .24, 0, 0, 0), .6, a, -.02); // capacitor banks, hull-mounted
      for (let k = 0; k < 3; k++) at('glow', SG.box(.012, .02, .18, 0, 0, 0), .63, a, -.1 + k * .07); }                                                         // their charge lights
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; at('hull', SG.box(.4, .012, .14, 0, 0, 0), .78, a, -.08); at('dark', SG.box(.4, .03, .02, 0, 0, 0), .78, a, -.08); } // radiator vanes between the banks
    add('dark', SG.cyl(.3, .34, .08, 24, 0, .23, 0)); add('trim', SG.torus(.32, .012, 48, 0, .27, 0));                                                         // the barbette ring
    add('armour', SG.box(.5, .2, .44, -.05, .37, 0)); add('hull', SG.box(.36, .06, .4, -.08, .5, 0)); add('dark', SG.box(.2, .12, .34, .18, .4, 0));           // the turret: armoured house, mantlet forward
    for (const z of [-.11, .11]) { add('gun', SG.cyl(.028, .032, .9, 10, .68, .4, z, 0, Math.PI / 2)); for (let k = 0; k < 4; k++) add('dark', SG.cyl(.04, .04, .025, 10, .4 + k * .18, .4, z, 0, Math.PI / 2)); add('dark', SG.cyl(.036, .036, .06, 10, 1.12, .4, z, 0, Math.PI / 2)); } // the rails, with cooling rings and muzzle collars
    add('glow', SG.box(.02, .05, .3, .28, .42, 0)); add('armour', SG.box(.14, .1, .14, -.28, .4, .0)); add('win', SG.box(.04, .03, .1, -.36, .42, 0));         // breech glow, the gun director aft with its lit window
    add('hull', SG.cyl(.012, .02, .36, 6, -.2, .68, .12)); add('lt', SG.sph(.025, -.2, .88, .12, 8, 6));                                                      // sensor mast
    add('dark', SG.cyl(.2, .24, .1, 16, 0, -.28, 0)); add('glow', SG.cyl(.1, .1, .02, 16, 0, -.34, 0));                                                        // docking collar and reactor beneath
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + .3; at('lt', SG.sph(.018, 0, 0, 0, 8, 6), .56, a, .17); }
  } else if (type === 'shieldplat') { // the Shield Station: a hub with three emitter pylons holding a ring above it (the shield sphere is render's)
    add('dark', SG.cyl(.7, .62, .16, 24, 0, 0, 0)); add('trim', SG.torus(.7, .022, 48, 0, .06, 0)); add('armour', SG.cyl(.3, .36, .12, 16, 0, .14, 0));
    windows(.705, -.02, 30, .04, .012);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; at('hull', SG.cyl(.035, .05, .6, 8, 0, 0, 0), .45, a, .35); at('glow', SG.cyl(.045, .045, .03, 10, 0, 0, 0), .45, a, .66); }
    add('trim', SG.torus(.45, .02, 36, 0, .68, 0)); add('glow', SG.torus(.45, .008, 36, 0, .7, 0));                                                     // the emitter ring
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + .5; at('hull', SG.box(.08, .1, .14, 0, 0, 0), .64, a, .1); at('glow', SG.box(.02, .06, .1, 0, 0, 0), .685, a, .1); at('lt', SG.sph(.018, 0, 0, 0, 8, 6), .74, a, .02); }
  }
  return P;
}

// ---------------------------------------------------------------- missiles
// Instanced 3-D missile bodies for the battle (render.js draws them with Inst, scaled to read on screen as the old
// sprites did). Built along +X (the flight direction), origin at the centre, length 1. Three bodies: the standard
// ship-to-ship missile (slim, four fins), the EMP round (a blunt sensor nose, canards) and the nuke (fat, a warhead
// band, six fins). Vertex colours carry the paint; a `tm` mask marks the fins and bands, where missileMaterial()
// lands the per-instance colour (the team's light colour, blue for EMP, red for a nuke).
function missileGeo(kind = 'std') {
  const parts = [], add = (g, paint, tm = 0) => { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, c = new THREE.Color(paint), col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('tm', new THREE.BufferAttribute(new Float32Array(n).fill(tm), 1)); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'tm'].includes(k)) g.deleteAttribute(k); parts.push(g); };
  const cylX = (rt, rb, h, x, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.rotateZ(-Math.PI / 2); g.translate(x, 0, 0); return g; };
  const body = '#d8dbe0', dark = '#8a8e96', steel = '#2a2c31', hot = '#ffc8a0';
  if (kind === 'nuke') {
    add(cylX(.09, .09, .62, -.08, 12), body); add(cylX(.0, .09, .22, .42, 12), dark);                 // body, nose cone
    add(cylX(.1, .1, .1, .2, 12), '#ffffff', 1); add(cylX(.1, .1, .04, -.3, 12), '#ffffff', 1);     // the warhead band and a tail band (tinted red)
    add(cylX(.07, .09, .08, -.43, 12), steel); add(cylX(.04, .06, .03, -.49, 10), hot);               // boat-tail and nozzle
    for (let i = 0; i < 6; i++) { const g = new THREE.BoxGeometry(.18, .13, .012); g.translate(0, .1, 0); g.rotateX(i * Math.PI / 3); g.translate(-.34, 0, 0); add(g, '#ffffff', 1); }
  } else if (kind === 'emp') {
    add(cylX(.06, .06, .66, -.06, 10), body); add(cylX(.07, .06, .14, .34, 10), '#3a4a5c'); add(cylX(.0, .07, .08, .45, 10), '#3a4a5c'); // body, blunt sensor nose
    add(cylX(.065, .065, .05, .05, 10), '#ffffff', 1); add(cylX(.05, .06, .06, -.42, 10), steel); add(cylX(.03, .045, .03, -.465, 8), hot);
    for (let i = 0; i < 4; i++) { const g = new THREE.BoxGeometry(.14, .11, .01); g.translate(0, .07, 0); g.rotateX(i * Math.PI / 2 + Math.PI / 4); g.translate(-.36, 0, 0); add(g, '#ffffff', 1); }
    for (let i = 0; i < 4; i++) { const g = new THREE.BoxGeometry(.08, .06, .008); g.translate(0, .07, 0); g.rotateX(i * Math.PI / 2 + Math.PI / 4); g.translate(.2, 0, 0); add(g, dark); }   // canards
  } else {
    add(cylX(.055, .055, .7, -.05, 10), body); add(cylX(.0, .055, .2, .4, 10), dark);                 // body, nose cone
    add(cylX(.06, .06, .04, .12, 10), '#ffffff', 1); add(cylX(.045, .055, .06, -.43, 10), steel); add(cylX(.025, .04, .03, -.475, 8), hot); // band, boat-tail, nozzle
    for (let i = 0; i < 4; i++) { const g = new THREE.BoxGeometry(.16, .12, .01); g.translate(0, .06, 0); g.rotateX(i * Math.PI / 2 + Math.PI / 4); g.translate(-.37, 0, 0); add(g, '#ffffff', 1); }
    for (let i = 0; i < 2; i++) { const g = new THREE.BoxGeometry(.5, .012, .012); g.translate(-.1, .058, 0); g.rotateX(i * Math.PI); add(g, '#6a6e76'); }   // raceways along the body
  }
  const g = mergeGeometries(parts); g.computeBoundingSphere(); g.userData.tris = g.attributes.position.count / 3; return g;
}
// real lengths in metres: a ship-to-ship missile, the EMP round, a nuclear missile
export const MISSILE_M = { std: 15, emp: 15, nuke: 25 };
const MGEO = {};
export const missileGeoOf = kind => MGEO[kind] || (MGEO[kind] = missileGeo(kind));
export function missileMaterial() { // paint × instance colour where tm is set; the base node material multiplies by instanceColor itself, so pre-divide
  const m = new MeshStandardNodeMaterial({ roughness: .4, metalness: .55 });
  const paint = attribute('color', 'vec3'), tm = attribute('tm', 'float'), tinted = mix(paint, paint.mul(instanceColor), tm);
  m.colorNode = tinted.div(max(instanceColor, vec3(.05, .05, .05)));
  return m;
}

// ---------------------------------------------------------------- materials
// hull plating: panel lines and plates along the length; lit windows in rows, as many as the ship's real size allows
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const TEXC = {};
export function hullTextures(type, fac) {
  const key = type + ':' + (fac || 'none'); if (TEXC[key]) return TEXC[key];
  // four maps from one pass: colour (plates, grime, stencils), what glows (windows, running strips), a bump map
  // (plate edges, hatches, conduits stand proud) and roughness (worn plates shine, paint is matt)
  const navy = fac || 'none', len = LEN_M[type] || 500, PW = len >= 2000 ? 2048 : len >= 700 ? 1024 : 512, PH = PW / 4; // pixels, sized to the hull: the great ships get the sharp maps
  const W = 2048, H = 512, q = PW / W, [c, g] = canvas(PW, PH), [ce, e] = canvas(PW, PH), [cb, b] = canvas(PW, PH), [cr, r] = canvas(PW, PH), R = rnd(seedOf(key) ^ 0x5bd1);
  for (const cx of [g, e, b, r]) cx.scale(q, q); // everything below is drawn in 2048×512 units
  g.fillStyle = '#d2d2d2'; g.fillRect(0, 0, W, H); e.fillStyle = '#000'; e.fillRect(0, 0, W, H); b.fillStyle = '#808080'; b.fillRect(0, 0, W, H); r.fillStyle = '#8c8c8c'; r.fillRect(0, 0, W, H);
  // the plating: two tiers of plates, each with a lit upper edge and a shadowed lower edge, bump raised a little
  const plates = Math.round(Math.min(220, 36 + len / 45)), ph = H / 14;
  const plate = (x, y, w, h, v, raise) => { g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x, y, w, 1.5); g.fillRect(x, y, 1.5, h); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + h - 1.6, w, 1.6); g.fillRect(x + w - 1.6, y, 1.6, h);
    const bv = 128 + raise; b.fillStyle = `rgb(${bv},${bv},${bv})`; b.fillRect(x + 1, y + 1, w - 2, h - 2); b.fillStyle = 'rgb(70,70,70)'; b.fillRect(x, y + h - 1.5, w, 1.5); b.fillRect(x + w - 1.5, y, 1.5, h);
    const rv = 110 + (R() * 60 | 0); r.fillStyle = `rgb(${rv},${rv},${rv})`; r.fillRect(x, y, w, h); };
  for (let row = 0; row < 14; row++) { let x = (R() * 40) | 0; while (x < W + 60) { const w = W / plates * (.8 + R() * 2.4), v = 188 + (R() * 44 | 0); plate(x - 30, row * ph, w, ph, v, 6 + (R() * 14 | 0)); x += w; } }
  for (let i = 0; i < plates * 1.4; i++) { const x = R() * W, y = R() * H, w = W / plates * (.4 + R() * 1.2), h = ph * (.35 + R() * .6), v = 176 + (R() * 50 | 0); plate(x, y, w, h, v, 14 + (R() * 18 | 0)); }
  // greebles: hatches, vents, conduit runs and antenna boxes, clustered along deck lines
  const greeble = (x, y, kind) => { const sz = 5 + R() * 9;
    if (kind === 0) { g.fillStyle = '#5a5a5e'; g.fillRect(x, y, sz, sz); g.strokeStyle = '#2a2a2e'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, sz - 1, sz - 1); b.fillStyle = 'rgb(190,190,190)'; b.fillRect(x, y, sz, sz); } // hatch
    else if (kind === 1) { for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#3a3a3e' : '#7a7a7e'; g.fillRect(x, y + k * 2, sz * 1.6, 1.5); } b.fillStyle = 'rgb(90,90,90)'; b.fillRect(x, y, sz * 1.6, 8); } // vent
    else if (kind === 2) { const L = 30 + R() * 120; g.fillStyle = '#6a6a70'; g.fillRect(x, y, L, 2.5); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(x, y, L, .8); b.fillStyle = 'rgb(200,200,200)'; b.fillRect(x, y, L, 2.5); for (let k = 0; k < L; k += 14) { g.fillStyle = '#3a3a3e'; g.fillRect(x + k, y - 1, 2, 4.5); } } // conduit
    else { g.fillStyle = '#48484c'; g.fillRect(x, y, sz * .7, sz * 1.4); b.fillStyle = 'rgb(220,220,220)'; b.fillRect(x, y, sz * .7, sz * 1.4); g.fillStyle = '#9a9a9e'; g.fillRect(x + 1, y + 1, sz * .7 - 2, 1.5); } }; // box
  const ng = Math.round(Math.min(900, 120 + len / 7));
  for (let i = 0; i < ng; i++) { const x = R() * W, y = Math.round(R() * 14) * ph + R() * 6, k = R(); greeble(x, y, k < .3 ? 0 : k < .5 ? 1 : k < .8 ? 2 : 3); }
  // the navy's paint and stencils
  if (navy === 'core') { // the Society: gilt lines along the decks, a laurel stencil amidships
    g.strokeStyle = 'rgba(214,170,80,.7)'; g.lineWidth = 2.2; for (const yy of [.12, .5, .88]) { g.beginPath(); g.moveTo(0, yy * H); g.lineTo(W, yy * H); g.stroke(); }
    g.strokeStyle = 'rgba(214,170,80,.35)'; g.lineWidth = 1; for (const yy of [.2, .42, .58, .8]) { g.beginPath(); g.moveTo(0, yy * H); g.lineTo(W, yy * H); g.stroke(); }
    g.fillStyle = 'rgba(214,170,80,.55)'; for (let i = 0; i < 9; i++) { const x = W * (.12 + i * .095), y = H * .5 - 16; g.beginPath(); g.ellipse(x, y, 9, 22, i % 2 ? .4 : -.4, 0, Math.PI * 2); g.fill(); }
  } else if (navy === 'rising') { // the Republic: refit plates in red oxide with weld seams, hull numbers in white
    for (let i = 0; i < 14; i++) { const x = R() * W, y = Math.round(R() * 13) * ph, w = 60 + R() * 160; g.fillStyle = `rgba(${140 + R() * 40 | 0},${40 + R() * 20 | 0},${34},${.55 + R() * .3})`; g.fillRect(x, y, w, ph); g.strokeStyle = 'rgba(255,230,200,.35)'; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.strokeRect(x + 1, y + 1, w - 2, ph - 2); g.setLineDash([]); r.fillStyle = 'rgb(60,60,60)'; r.fillRect(x, y, w, ph); }
    g.fillStyle = 'rgba(240,236,228,.65)'; g.font = `bold ${Math.round(ph * .9)}px ui-monospace,Consolas,monospace`; g.textBaseline = 'top'; const num = String(100 + (seedOf(key) % 880)); g.fillText(num, W * .17, ph * 3.1); g.fillText(num, W * .17, ph * 10.1);
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * H; g.fillRect(x, y, 2 + R() * 3, 20 + R() * 90); } // grime streaks
  } else if (navy === 'rim') { // the Rim: black hulls, bone-white banding, pale panel seams
    g.fillStyle = 'rgba(20,22,28,.78)'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(232,226,208,.5)'; g.lineWidth = 2; for (const yy of [.08, .92]) { g.beginPath(); g.moveTo(0, yy * H); g.lineTo(W, yy * H); g.stroke(); }
    g.strokeStyle = 'rgba(180,186,200,.16)'; g.lineWidth = 1; for (let i = 0; i < 60; i++) { const x = R() * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (R() - .5) * 40, H); g.stroke(); }
    r.fillStyle = 'rgba(40,40,40,.6)'; r.fillRect(0, 0, W, H);
  } else { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, W, H); }
  // weathering: scorch, oxide bloom and dust along the plate lines
  g.globalCompositeOperation = 'multiply'; for (let i = 0; i < 70; i++) { const x = R() * W, y = R() * H, rr = 20 + R() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(${90 + R() * 60 | 0},${80 + R() * 40 | 0},${70 + R() * 30 | 0},.45)`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); } g.globalCompositeOperation = 'source-over';
  // windows: rows of decks around the hull, clustered, mostly warm white; dark on the colour map so they read unlit too
  const cols = Math.round(Math.min(800, 40 + len / 9));
  for (const band of [.07, .19, .31, .44, .57, .69, .81, .94]) { let run = 0; for (let i = 0; i < cols; i++) {
    if (run <= 0) { if (R() < .5) { i += 2 + (R() * 6 | 0); continue; } run = 3 + (R() * 12 | 0); } run--;
    const x = (i + .5) / cols * W, y = band * H + (R() - .5) * 6, on = R(), w = Math.max(1.6, W / cols * .5), h = 3;
    e.fillStyle = on < .72 ? '#ffd9a0' : on < .9 ? '#bfe0ff' : '#ffa060'; e.globalAlpha = on < .08 ? .1 : .55 + R() * .45; e.fillRect(x, y, w, h);
    g.fillStyle = '#1e1e22'; g.fillRect(x, y, w, h); b.fillStyle = 'rgb(60,60,60)'; b.fillRect(x, y, w, h); } }
  e.globalAlpha = 1;
  // running strips: a faint line of light along the main deck seams, in the navy's tint
  e.strokeStyle = navy === 'rim' ? 'rgba(200,220,255,.5)' : navy === 'core' ? 'rgba(255,220,150,.45)' : 'rgba(255,200,170,.4)'; e.lineWidth = 1.2; for (const yy of [.125, .5, .875]) { e.beginPath(); e.setLineDash([24, 60]); e.moveTo(0, yy * H); e.lineTo(W, yy * H); e.stroke(); } e.setLineDash([]);
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const t = mk(c), te = mk(ce), tb = mk(cb), tr = mk(cr); t.colorSpace = te.colorSpace = THREE.SRGBColorSpace;
  return TEXC[key] = [t, te, tb, tr];
}
// a navy's paint
export const PAINT = {
  core:   { hull: 0xd8d4ca, armour: 0xa8a399, dark: 0x1a1a1e, gun: 0x5c5a56, trimMix: .55, metal: .5, rough: .42 },  // polished grey-white, gold-trimmed
  rising: { hull: 0x8e8983, armour: 0x7a4a40, dark: 0x18181a, gun: 0x4a4846, trimMix: 0, metal: .5, rough: .62 },    // Society hulls, weathered and patched in red oxide
  rim:    { hull: 0x3c4048, armour: 0x50545e, dark: 0x0c0c10, gun: 0x2e3036, trimMix: .7, metal: .7, rough: .36 },   // Ganymede black, bone trim, a wet-looking sheen
  none:   { hull: 0x8a8580, armour: 0x6a6660, dark: 0x1a1a1c, gun: 0x4a4846, trimMix: 0, metal: .55, rough: .5 },
  morningstar: { hull: 0x5e5f68, armour: 0x60616a, dark: 0x0e0e10, gun: 0x3a3a40, trimMix: 0, metal: .62, rough: .48 },
};
export const paintOf = (type, fac) => type === 'moonbreaker' && fac === 'rising' ? PAINT.morningstar : PAINT[fac] || PAINT.none;


// ---------------------------------------------------------------- planets: a sphere with the ground on it
// The world maps (planetgen.js) carry a height field; this raises the mesh itself by it, so mountain ranges break the limb
// and the terminator, and small bodies stop being perfect balls: below ~300 km a moon or asteroid gets the lumpy shape of
// a real one from a low-frequency noise seeded by its id. Height is stored as .35 + h × .45 (sea level at .35), see
// planetgen's generate(). Sea stays at the sphere. render.js swaps this in for GEO.sphere when a map arrives.
const _pv = new THREE.Vector3();
function hashP(i, j, k) { let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
function noiseP(x, y, z) { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => hashP(i + a, j + b, k + d); return (c(0, 0, 0) * (1 - u) + c(1, 0, 0) * u) * (1 - v) * (1 - w) + (c(0, 1, 0) * (1 - u) + c(1, 1, 0) * u) * v * (1 - w) + (c(0, 0, 1) * (1 - u) + c(1, 0, 1) * u) * (1 - v) * w + (c(0, 1, 1) * (1 - u) + c(1, 1, 1) * u) * v * w; }
export function planetGeo(hgt, W, H, { km = 3000, amp = .012, seg = 192, seed = 0 } = {}) {
  const g = new THREE.SphereGeometry(1, seg, seg >> 1), P = g.attributes.position, UV = g.attributes.uv;
  const lump = km < 300 ? Math.min(.3, (300 - km) / 300 * .3 + .04) : 0, s0 = seed * 7.13;   // how far from a ball a small body is
  const ampK = km < 300 ? amp * 6 : amp;
  for (let n = 0; n < P.count; n++) {
    _pv.set(P.getX(n), P.getY(n), P.getZ(n)); let r = 1;
    if (hgt) { const u = UV.getX(n), v = UV.getY(n), x = ((u % 1) + 1) % 1 * W, y = Math.min(Math.max(v, 0), 1) * (H - 1), i0 = Math.floor(x) % W, i1 = (i0 + 1) % W, j0 = Math.min(H - 1, Math.floor(y)), j1 = Math.min(H - 1, j0 + 1), fx = x - Math.floor(x), fy = y - j0;
      const h = (hgt[j0 * W + i0] * (1 - fx) + hgt[j0 * W + i1] * fx) * (1 - fy) + (hgt[j1 * W + i0] * (1 - fx) + hgt[j1 * W + i1] * fx) * fy;
      r += Math.max(0, h / 255 - .35) / .45 * ampK; }   // the sea stays at the sphere, the land rises
    if (lump) { const q = _pv.clone().multiplyScalar(1.6).addScalar(s0); r += (noiseP(q.x, q.y, q.z) - .5) * lump * 1.6 + (noiseP(q.x * 2.7 + 9, q.y * 2.7, q.z * 2.7) - .5) * lump * .5; }
    P.setXYZ(n, _pv.x * r, _pv.y * r, _pv.z * r);
  }
  if (lump) { let m = 0; for (let n = 0; n < P.count; n++) m += Math.hypot(P.getX(n), P.getY(n), P.getZ(n)); m = P.count / m; for (let n = 0; n < P.count; n++) P.setXYZ(n, P.getX(n) * m, P.getY(n) * m, P.getZ(n) * m); } // a lumpy body keeps its mean radius
  P.needsUpdate = true; g.computeVertexNormals(); return g;
}
