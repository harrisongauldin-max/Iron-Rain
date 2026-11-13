// The dockyards, as the books describe them.
//
//  - Every dockyard: a construction slip, an open cradle of steel frames on rails with gantry cranes riding the top,
//    tugs working round it, a control tower at the stern, and a hull on the stocks: its stern plated, its bow still bare
//    ribs, welders' sparks at the join. Venus and Ganymede, the only yards that can lay down a moonBreaker, have one in.
//  - Ganymede (Morning Star): "the monument of industry they've built in orbit at her equator ... Two hundred kilometers
//    of docks. Hundreds of haulers and freighters. Birthplace of the greatest ships in the Sol System including the
//    Colossus herself." Drawn at the ships' scale (200 km is about a third of the way round the moon), and as it stands
//    in 753 PCE: Darrow wrecked it with the Colossus after Ilium, and the Rim has it working again at 60%: the berths
//    on one side are still twisted wreckage in a cloud of debris.
//  - Phobos (Morning Star): "carved hollow by man and wreathed with metal", ringed by two huge dockyards running
//    perpendicular to each other, lit for docking ships, alive with magnetic trams and cargo vessels; the Hive's
//    spiked towers rise around them.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { buildHull } from './hulls.js';
import { DEFS } from './data.js';
const VR = t => DEFS[t] && DEFS[t].vr0 || 30; // a class's drawn half-length at the default hull scale, so a hull on the stocks matches one in flight

const TAU = Math.PI * 2;
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const box = (sx, sy, sz, x = 0, y = 0, z = 0, ry = 0) => { const g = new THREE.BoxGeometry(sx, sy, sz); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
const merge = list => { const g = mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g)); g.computeVertexNormals(); return g; };

// ---------------------------------------------------------------- a hull on the stocks
// the built part of a hull: every triangle aft of the cut, keeping its material groups
const PART = {};
export function hullOnStocks(type, fac, cut) {
  const key = type + ':' + fac + ':' + cut; if (PART[key]) return PART[key];
  const H = buildHull(type, fac), src = H.geo, P = src.attributes.position.array, U = src.attributes.uv.array;
  const pos = [], uv = [], groups = [];
  for (const gr of src.groups) {
    const start = pos.length / 3;
    for (let t = gr.start; t < gr.start + gr.count; t += 3) {
      if (P[t * 3] > cut || P[t * 3 + 3] > cut || P[t * 3 + 6] > cut) continue;
      for (let k = 0; k < 3; k++) { const i = t + k; pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); uv.push(U[i * 2], U[i * 2 + 1]); }
    }
    groups.push([start, pos.length / 3 - start, gr.materialIndex]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const [s, n, m] of groups) if (n) g.addGroup(s, n, m);
  g.computeVertexNormals(); g.computeBoundingSphere();
  // the bow still in frames: hoops round the hull's section, a keel and two stringers
  const ribs = [], x1 = 1.25;
  for (let x = cut + .06; x < x1; x += .09) { const w = H.hw(x), h = Math.max(.04, H.deck(x, 0)); ribs.push(box(.012, h * 2, .012, x, 0, w), box(.012, h * 2, .012, x, 0, -w), box(.012, .012, w * 2, x, h, 0), box(.012, .012, w * 2, x, -h, 0)); }
  ribs.push(box(x1 - cut, .02, .02, (cut + x1) / 2, -.1, 0));
  for (const z of [-1, 1]) ribs.push(box(x1 - cut, .012, .012, (cut + x1) / 2, .05, z * H.hw(cut) * .8));
  return PART[key] = { geo: g, ribs: merge(ribs), cut, hw: H.hw };
}

// ---------------------------------------------------------------- the construction slips (structure space: 1 = s.r)
// each slip is sized to the hull on its stocks: a cradle of frames on rails, cross-braced, a slipway bed beneath
const SLIPS = {};
function slipGeo(L, W, y0, y1) {
  const key = [L, W, y0, y1].map(v => v.toFixed(3)).join(); if (SLIPS[key]) return SLIPS[key];
  const frame = [], rail = [], stripe = [], dark = [], n = Math.max(6, Math.round(L / .2)), t = .022;
  for (let i = 0; i <= n; i++) { const x = -L / 2 + i * L / n; frame.push(box(t, y1 - y0, t, x, (y0 + y1) / 2, W), box(t, y1 - y0, t, x, (y0 + y1) / 2, -W), box(t, t, W * 2, x, y1, 0), box(t, t, W * 2, x, y0, 0)); }
  for (let i = 0; i < n; i++) { const x = -L / 2 + (i + .5) * L / n; for (const z of [-W, W]) { const d = new THREE.BoxGeometry(.008, Math.hypot(L / n, y1 - y0), .008); d.rotateZ(Math.atan2(L / n, y1 - y0) * (i % 2 ? 1 : -1)); d.translate(x, (y0 + y1) / 2, z); frame.push(d); } }
  for (const z of [-W, W]) for (const y of [y0, y1]) { rail.push(box(L + .08, .04, .045, 0, y, z)); stripe.push(box(L + .08, .008, .047, 0, y + .016, z)); }
  dark.push(box(L * .95, .03, W * 1.6, 0, y0 - .035, 0));
  return SLIPS[key] = { frame: merge(frame), rail: merge(rail), stripe: merge(stripe), dark: merge(dark) };
}
const crane = W => merge([box(.06, .05, W * 2.25, 0, 0, 0), box(.08, .08, .1, 0, -.05, W * .3), box(.005, .26, .005, 0, -.22, W * .3), box(.026, .018, .026, 0, -.36, W * .3)]);
const TUG = merge([box(.08, .03, .04), box(.026, .045, .036, -.035, .026, 0)]);
const STEEL = new THREE.MeshStandardMaterial({ color: 0x8a8c94, metalness: .7, roughness: .38 });

// → { g, update(t) }: a dockyard: a main slip with `type` on the stocks and a second, smaller slip beside it,
// a control tower at the stern, gantry cranes riding the top rails, tugs working round, sparks at the join
export function buildSlip(M, hullMatsOf, type, fac, seed) {
  const g = new THREE.Group(), R = rnd(seed), anim = [];
  const second = type === 'moonbreaker' ? 'dread' : 'destroyer', jobs = [[type, -.2], [second, .62]];
  let mainL = 1;
  for (const [t, zOff] of jobs) {
    const k = VR(t) / 115, cut = .05 + R() * .55, part = hullOnStocks(t, fac, cut), L = 2.62 * k * 1.18 + .12, W = Math.max(.12, part.hw(.0) * k * 1.6), y0 = -Math.max(.14, .3 * k * 1.4), y1 = -y0 * 1.05;
    const S = new THREE.Group(); S.position.z = t === type ? -.24 : .42; g.add(S); if (t === type) mainL = L;
    const G = slipGeo(L, W, y0, y1); for (const [geo, mat] of [[G.frame, STEEL], [G.rail, M.hull], [G.stripe, M.trim], [G.dark, M.dark]]) S.add(new THREE.Mesh(geo, mat));
    const hull = new THREE.Group(); hull.scale.setScalar(k); hull.position.x = -.08 * k; hull.add(new THREE.Mesh(part.geo, hullMatsOf(t)), new THREE.Mesh(part.ribs, STEEL)); S.add(hull);
    const sm = new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false });
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(.01, 6, 4), sm); sp.position.set((cut - .08) * k + .01, (R() - .3) * .2 * k * 3, (R() * 2 - 1) * part.hw(cut) * k); const ph = R() * 10; anim.push(tt => { sp.visible = Math.sin(tt * 9 + ph * 7) + Math.sin(tt * 23 + ph) > .9; }); S.add(sp); }
    for (let i = 0; i < 2; i++) { const c = new THREE.Mesh(crane(W), STEEL); c.position.y = y1 + .04; S.add(c); const ph = R() * TAU, sp = .05 + R() * .05; anim.push(tt => { c.position.x = Math.sin(tt * sp + ph) * L * .42; }); }
  }
  // the control tower at the stern of the main slip, lit windows, its signal mast
  const tower = new THREE.Group(); tower.position.set(-mainL / 2 - .16, 0, -.24); g.add(tower);
  tower.add(new THREE.Mesh(merge([box(.2, .56, .24, 0, 0, 0), box(.14, .16, .18, 0, .36, 0), box(.006, .22, .006, 0, .55, 0)]), M.hull), new THREE.Mesh(box(.21, .012, .245, 0, .2, 0), M.trim));
  const win = new THREE.InstancedMesh(new THREE.BoxGeometry(.026, .01, .004), M.lt, 24), o = new THREE.Object3D();
  for (let i = 0; i < 24; i++) { o.position.set(-.07 + (i % 6) * .028, -.2 + Math.floor(i / 6) * .1, .122); o.updateMatrix(); win.setMatrixAt(i, o.matrix); } tower.add(win);
  // tugs working round the slips
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(TUG, M.dark), lt = new THREE.Mesh(new THREE.BoxGeometry(.01, .01, .026), M.lt); lt.position.x = -.045; m.add(lt); g.add(m);
    const ph = R() * TAU, rr = .6 + R() * .5, sp = (.05 + R() * .08) * (R() < .5 ? -1 : 1), y = (R() - .5) * .5;
    anim.push(tt => { const a = tt * sp + ph; m.position.set(Math.cos(a) * (mainL * .65 + rr * .25), y, Math.sin(a) * (.75 + rr * .4)); m.rotation.y = -a - Math.sign(sp) * Math.PI / 2; }); }
  return { g, update: t => { for (const f of anim) f(t); }, blink: [] };
}

// ---------------------------------------------------------------- Ganymede: 200 km of docks at the equator
// world units; the group is centred on Ganymede, the docks' middle at local +x, in the battle plane
export function ganymedeDocks(R0, rMoon, M, hullMats, fac) {
  const g = new THREE.Group(), R = rnd(912), KM = 18, span = 200 * KM / R0 / 2; // half-angle covered by 200 km
  const NB = 16, ruin = new Set([11, 12, 13, 14, 15]);                       // the berths still wrecked since Ilium (60% working)
  const at = (phi, r, y = 0) => new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);
  const place = (m, phi, r, y = 0, yaw = 0) => { m.position.copy(at(phi, r, y)); m.rotation.y = -phi - Math.PI / 2 + yaw; };
  // the spine: a wide truss on the inside, a service rail and lights along both faces
  const segs = 60, dphi = span * 2 / segs, spine = [], rail = [], dead = [];
  for (let i = 0; i < segs; i++) {
    const phi = -span + (i + .5) * dphi, bi = Math.floor((i / segs) * NB), L = R0 * dphi * 1.04;
    if (ruin.has(bi) && R() < .45) continue;                                  // gaps torn in the spine
    const list = ruin.has(bi) ? dead : spine;
    const s = box(L, 26, 54, 0, 0, 0); s.rotateY(-phi - Math.PI / 2); s.translate(...at(phi, R0 - 40).toArray());
    if (ruin.has(bi)) { s.rotateZ((R() - .5) * .05); s.translate(0, (R() - .5) * 30, 0); }
    list.push(s);
    if (!ruin.has(bi)) for (const off of [-30, 30]) { const r2 = box(L, 6, 8); r2.rotateY(-phi - Math.PI / 2); r2.translate(...at(phi, R0 - 40 + off, 16).toArray()); rail.push(r2); }
  }
  g.add(new THREE.Mesh(merge(spine), M.hull)); g.add(new THREE.Mesh(merge(rail), M.trim)); if (dead.length) g.add(new THREE.Mesh(merge(dead), M.dark));
  // the berths: cradles reaching outboard of the spine, each big enough for a moonBreaker; hulls on the stocks
  const cradle = (() => { const L = 200, W = 62, H = 40, f = []; for (let i = 0; i <= 6; i++) { const x = -L / 2 + i * L / 6; f.push(box(5, H * 2, 5, x, 0, W), box(5, H * 2, 5, x, 0, -W), box(5, 5, W * 2, x, H, 0), box(5, 5, W * 2, x, -H, 0)); }
    for (const z of [-W, W]) for (const y of [-H, H]) f.push(box(L, 6, 6, 0, y, z)); return merge(f); })();
  const live = new THREE.InstancedMesh(cradle, M.hull, NB), wreck = new THREE.InstancedMesh(cradle, M.dark, NB), o = new THREE.Object3D();
  let nl = 0, nw = 0; const pick = ['moonbreaker', 'dread', 'dread', 'destroyer', 'dread', 'moonbreaker', 'destroyer', 'dread', 'dread', 'destroyer', 'dread'];
  for (let b = 0; b < NB; b++) {
    const phi = -span + (b + .5) * span * 2 / NB, r = R0 + 80;
    o.position.copy(at(phi, r)); o.rotation.set(0, -phi - Math.PI / 2, 0); o.scale.set(1, 1, 1);
    if (ruin.has(b)) { o.position.y += (R() - .5) * 60; o.rotation.x = (R() - .5) * .5; o.rotation.z = (R() - .5) * .4; o.rotation.y += (R() - .5) * .6; o.updateMatrix(); wreck.setMatrixAt(nw++, o.matrix); continue; }
    o.updateMatrix(); live.setMatrixAt(nl++, o.matrix);
    const type = pick[b % pick.length]; if (b % 4 === 3) continue;           // a berth or two empty, waiting
    const part = hullOnStocks(type, fac, .1 + R() * .9), k = VR(type), hull = new THREE.Group();
    hull.add(new THREE.Mesh(part.geo, hullMats)); hull.add(new THREE.Mesh(part.ribs, M.hull)); hull.scale.setScalar(k); place(hull, phi, r); g.add(hull);
  }
  live.count = nl; wreck.count = nw; g.add(live, wreck);
  // tethers down to the moon from the spine
  for (let i = 0; i < 7; i++) { const phi = -span * .9 + i * span * 1.8 / 6; if (i >= 5) continue; const len = R0 - 40 - rMoon, c = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, len, 6), M.hull); c.rotation.z = Math.PI / 2; const h = new THREE.Group(); h.add(c); c.position.x = 0; place(h, phi, R0 - 40 - len / 2, 0, Math.PI / 2); g.add(h); }
  // lights: docking lights along the berth ends and the spine
  const nLt = 220, lights = new THREE.InstancedMesh(new THREE.SphereGeometry(4, 6, 4), M.lt, nLt); let li = 0;
  for (let i = 0; i < nLt; i++) { const phi = -span + (i + .5) * span * 2 / nLt, bi = Math.floor((i / nLt) * NB); if (ruin.has(bi)) continue; o.position.copy(at(phi, i % 2 ? R0 - 14 : R0 + 152, i % 2 ? 14 : 46)); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix(); lights.setMatrixAt(li++, o.matrix); }
  lights.count = li; g.add(lights);
  // the wreckage of Ilium: hull plates and girders tumbling slowly round the ruined berths
  const nD = 160, debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.dark, nD), deb = [];
  for (let i = 0; i < nD; i++) { const phi = -span + (11 + R() * 5) / NB * span * 2, r = R0 + (R() - .3) * 420; deb.push({ phi, r, y: (R() - .5) * 160, s: [4 + R() * 30, 2 + R() * 8, 3 + R() * 14], rx: R() * TAU, ry: R() * TAU, w: (R() - .5) * .2, d: (R() - .5) * .0004 }); }
  g.add(debris);
  // hundreds of haulers and freighters: lanes running the length of the docks, outbound and inbound, and shuttles to the berths
  const fg = merge([box(14, 5, 6), box(5, 6, 7, -6, 1, 0), box(8, 3, 9, 3, 0, 0)]), nF = 320;
  const ships = new THREE.InstancedMesh(fg, M.hull, nF), burns = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 2.4, 2.4), new THREE.MeshBasicMaterial({ color: 0xffb070, toneMapped: false }), nF), lane = [];
  for (let i = 0; i < nF; i++) { const kind = R(); const out = R() < .72, r = out ? R0 + 240 + R() * 520 : R0 - 110 - R() * Math.min(80, R0 - rMoon - 140); lane.push(kind < .75 ? { r, y: (R() - .5) * 140, ph: R() * span * 2.6 - span * 1.3, v: (8 + R() * 16) / r * (out ? 1 : -1), s: .6 + R() * 1.4 }
    : { berth: Math.floor(R() * 11), ph: R() * TAU, v: .05 + R() * .08, s: .4 + R() * .5, y: (R() - .5) * 80 }); }
  g.add(ships, burns);
  const update = t => {
    for (let i = 0; i < nD; i++) { const d = deb[i]; o.position.copy(at(d.phi + d.d * t, d.r, d.y)); o.rotation.set(d.rx + t * d.w, d.ry + t * d.w * .7, 0); o.scale.set(...d.s); o.updateMatrix(); debris.setMatrixAt(i, o.matrix); }
    debris.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < nF; i++) { const l = lane[i]; let phi, r, y, dir;
      if (l.berth !== undefined) { const bphi = -span + (l.berth + .5) * span * 2 / NB, u = (Math.sin(t * l.v + l.ph) + 1) / 2; phi = bphi + Math.sin(l.ph) * .01; r = R0 + 160 + u * 500; y = l.y; dir = Math.cos(t * l.v + l.ph) > 0 ? 0 : Math.PI; o.position.copy(at(phi, r, y)); o.rotation.set(0, -phi + dir, 0); }
      else { const w = span * 1.3; phi = ((l.ph + t * l.v + w) % (2 * w) + 2 * w) % (2 * w) - w; r = l.r; y = l.y; o.position.copy(at(phi, r, y)); o.rotation.set(0, -phi - Math.sign(l.v) * Math.PI / 2, 0); }
      o.scale.setScalar(l.s); o.updateMatrix(); ships.setMatrixAt(i, o.matrix);
      o.translateX(-9); o.updateMatrix(); burns.setMatrixAt(i, o.matrix); }
    ships.instanceMatrix.needsUpdate = true; burns.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { g, update, span };
}

// ---------------------------------------------------------------- Venus: the Carthii's dockyards, 120 km at the equator
// The books give the Dockyards of Venus no picture, only a pedigree: the Carthii "built the Columns of Venus" and the yards
// turned out the Remnant's warships through the Solar War. So they are drawn as the Columns' heirs: a crown of great
// fluted towers standing off the planet, two tiers of berths slung between them (hulls on the stocks above and below the
// spine), gilt trim, warm lights, every berth working — the Society's one yard that was never wrecked.
export function venusDocks(R0, rPlanet, M, hullMats, fac, gold) {
  const g = new THREE.Group(), R = rnd(2271), KM = 18, span = 120 * KM / R0 / 2, NB = 10, NC = NB + 1, TIER = 150;
  const at = (phi, r, y = 0) => new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);
  const place = (m, phi, r, y = 0, yaw = 0) => { m.position.copy(at(phi, r, y)); m.rotation.y = -phi - Math.PI / 2 + yaw; };
  // the columns: fluted towers 460 units tall standing radially off the spine, a capital at each end, gilt bands
  const col = (() => { const parts = [], h = 460, n = 12; for (let i = 0; i < n; i++) { const a = i / n * TAU; const f = new THREE.BoxGeometry(14, h, 9); f.translate(Math.cos(a) * 30, 0, Math.sin(a) * 30); f.rotateY(-a); parts.push(f); }
    parts.push(new THREE.CylinderGeometry(28, 28, h, 12)); return merge(parts); })();
  const cap = merge([new THREE.CylinderGeometry(44, 34, 40, 12, 1, false), box(96, 14, 96, 0, 27, 0)]);
  const cols = new THREE.InstancedMesh(col, M.hull, NC), caps = new THREE.InstancedMesh(cap, gold || M.trim, NC * 2), bands = new THREE.InstancedMesh(new THREE.CylinderGeometry(33, 33, 10, 12), gold || M.trim, NC * 4), o = new THREE.Object3D();
  let nc = 0, nk = 0, nb = 0;
  for (let c = 0; c < NC; c++) { const phi = -span + c * span * 2 / NB;
    o.position.copy(at(phi, R0)); o.rotation.set(0, -phi, 0); o.scale.set(1, 1, 1); o.updateMatrix(); cols.setMatrixAt(nc++, o.matrix);   // the tower stands across the plane, the tiers hung between
    for (const s of [-1, 1]) { o.position.copy(at(phi, R0, s * 235)); o.rotation.set(s < 0 ? Math.PI : 0, -phi, 0); o.updateMatrix(); caps.setMatrixAt(nk++, o.matrix); }
    for (const d of [-180, -70, 70, 180]) { o.position.copy(at(phi, R0, d)); o.rotation.set(0, -phi, 0); o.updateMatrix(); bands.setMatrixAt(nb++, o.matrix); } }
  g.add(cols, caps, bands);
  // the spine between the columns, and the two tier rails the berths hang from
  const segs = 50, dphi = span * 2 / segs, spine = [], rails = [];
  for (let i = 0; i < segs; i++) { const phi = -span + (i + .5) * dphi, L = R0 * dphi * 1.04;
    const sp = box(L, 34, 70); sp.rotateY(-phi - Math.PI / 2); sp.translate(...at(phi, R0).toArray()); spine.push(sp);
    for (const y of [-TIER, TIER]) for (const off of [-120, 120]) { const r2 = box(L, 8, 10); r2.rotateY(-phi - Math.PI / 2); r2.translate(...at(phi, R0 + off, y).toArray()); rails.push(r2); } }
  g.add(new THREE.Mesh(merge(spine), M.armour || M.hull), new THREE.Mesh(merge(rails), gold || M.trim));
  // the berths: a cradle on each tier between every pair of columns, a hull on the stocks in most
  const cradle = (() => { const L = 190, W = 60, H = 36, f = []; for (let i = 0; i <= 5; i++) { const x = -L / 2 + i * L / 5; f.push(box(5, H * 2, 5, x, 0, W), box(5, H * 2, 5, x, 0, -W), box(5, 5, W * 2, x, H, 0), box(5, 5, W * 2, x, -H, 0)); }
    for (const z of [-W, W]) for (const y of [-H, H]) f.push(box(L, 6, 6, 0, y, z)); return merge(f); })();
  const live = new THREE.InstancedMesh(cradle, M.hull, NB * 2); let nl = 0;
  const pick = ['moonbreaker', 'dread', 'destroyer', 'dread', 'moonbreaker', 'dread', 'destroyer', 'dread'];
  for (let b = 0; b < NB; b++) for (const y of [-TIER, TIER]) {
    const phi = -span + (b + .5) * span * 2 / NB, r = R0;
    o.position.copy(at(phi, r, y)); o.rotation.set(0, -phi - Math.PI / 2, 0); o.scale.set(1, 1, 1); o.updateMatrix(); live.setMatrixAt(nl++, o.matrix);
    const k = b * 2 + (y > 0 ? 1 : 0); if (k % 5 === 4) continue;                                    // a berth in five stands empty
    const type = pick[k % pick.length], part = hullOnStocks(type, fac, .1 + R() * .9), vr = VR(type), hull = new THREE.Group();
    hull.add(new THREE.Mesh(part.geo, hullMats), new THREE.Mesh(part.ribs, M.hull)); hull.scale.setScalar(vr); place(hull, phi, r, y); g.add(hull); }
  live.count = nl; g.add(live);
  // the anchor towers: three tethers down to the planet's upper air, each with a station at the foot
  for (let i = 0; i < 3; i++) { const phi = -span * .8 + i * span * .8, len = R0 - 40 - rPlanet * 1.03, c = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, len, 6), M.hull); c.rotation.z = Math.PI / 2; const h = new THREE.Group(); h.add(c); c.position.x = -len / 2 - 40; place(h, phi, R0); g.add(h);
    const st = new THREE.Mesh(merge([box(60, 24, 60), box(90, 8, 90, 0, -14, 0)]), gold || M.trim); place(st, phi, rPlanet * 1.03 + 30); g.add(st); }
  // lights: warm, along both tier rails and up the columns
  const nLt = 300, lights = new THREE.InstancedMesh(new THREE.SphereGeometry(4, 6, 4), M.lt, nLt); let li = 0;
  for (let i = 0; i < nLt; i++) { const phi = -span + (i + .5) * span * 2 / nLt, y = i % 2 ? -TIER - 10 : TIER + 10; o.position.copy(at(phi, R0 + (i % 4 < 2 ? -124 : 124), y)); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix(); lights.setMatrixAt(li++, o.matrix); }
  lights.count = li; g.add(lights);
  // haulers and the Carthii's own yachts in lanes along the yard, shuttles to the berths
  const fg = merge([box(14, 5, 6), box(5, 6, 7, -6, 1, 0), box(8, 3, 9, 3, 0, 0)]), nF = 220;
  const ships = new THREE.InstancedMesh(fg, M.hull, nF), burns = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 2.4, 2.4), new THREE.MeshBasicMaterial({ color: 0xffd090, toneMapped: false }), nF), lane = [];
  for (let i = 0; i < nF; i++) { const out = R() < .7, r = out ? R0 + 380 + R() * 500 : R0 - 380 - R() * Math.min(200, R0 - rPlanet * 1.03 - 500); lane.push(R() < .75 ? { r, y: (R() - .5) * 400, ph: R() * span * 2.6 - span * 1.3, v: (.04 + R() * .08) * (out ? 1 : -1) * (R() < .5 ? 1 : -1), s: .5 + R() * .8 } : { berth: Math.floor(R() * NB), tier: R() < .5 ? -TIER : TIER, ph: R() * TAU, v: .05 + R() * .08, s: .4 + R() * .5 }); }
  g.add(ships, burns);
  const update = t => {
    for (let i = 0; i < nF; i++) { const l = lane[i];
      if (l.berth !== undefined) { const bphi = -span + (l.berth + .5) * span * 2 / NB, u = (Math.sin(t * l.v + l.ph) + 1) / 2; o.position.copy(at(bphi + Math.sin(l.ph) * .01, R0 + 200 + u * 500, l.tier)); o.rotation.set(0, -bphi - (Math.cos(t * l.v + l.ph) > 0 ? 0 : Math.PI), 0); }
      else { const w = span * 1.3; const phi = ((l.ph + t * l.v + w) % (2 * w) + 2 * w) % (2 * w) - w; o.position.copy(at(phi, l.r, l.y)); o.rotation.set(0, -phi - Math.sign(l.v) * Math.PI / 2, 0); }
      o.scale.setScalar(l.s); o.updateMatrix(); ships.setMatrixAt(i, o.matrix); o.translateX(-9); o.updateMatrix(); burns.setMatrixAt(i, o.matrix); }
    ships.instanceMatrix.needsUpdate = true; burns.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { g, update, span };
}

// ---------------------------------------------------------------- Phobos: trams and cargo vessels on the two rings
export function phobosTraffic(ringR) {
  const g = new THREE.Group(), R = rnd(31), n = 36, tram = new THREE.InstancedMesh(new THREE.BoxGeometry(.07, .022, .03), new THREE.MeshStandardMaterial({ color: 0x8a8a90, emissive: 0xffe2b0, emissiveIntensity: .5, metalness: .6, roughness: .4 }), n * 2);
  const cargo = new THREE.InstancedMesh(merge([box(.06, .025, .03), box(.02, .03, .035, -.03, 0, 0)]), new THREE.MeshStandardMaterial({ color: 0x6a6c74, metalness: .6, roughness: .5 }), 40), o = new THREE.Object3D();
  const T = [...Array(n * 2)].map((_, i) => ({ ring: i < n ? 0 : 1, ph: R() * TAU, v: (.04 + R() * .05) * (R() < .5 ? 1 : -1), off: (R() - .5) * .05 }));
  const C = [...Array(40)].map(() => ({ ring: R() < .5 ? 0 : 1, ph: R() * TAU, v: (.01 + R() * .02) * (R() < .5 ? 1 : -1), r: ringR + .12 + R() * .35, h: (R() - .5) * .3 }));
  g.add(tram, cargo);
  const update = t => {
    T.forEach((p, i) => { const a = p.ph + t * p.v, c = Math.cos(a) * (ringR + p.off), s = Math.sin(a) * (ringR + p.off);
      if (p.ring === 0) { o.position.set(c, 0, s); o.rotation.set(0, -a - Math.PI / 2, 0); } else { o.position.set(c, s, .06); o.rotation.set(0, 0, a + Math.PI / 2); }
      o.updateMatrix(); tram.setMatrixAt(i, o.matrix); });
    C.forEach((p, i) => { const a = p.ph + t * p.v; if (p.ring === 0) { o.position.set(Math.cos(a) * p.r, p.h, Math.sin(a) * p.r); o.rotation.set(0, -a - Math.PI / 2, 0); } else { o.position.set(Math.cos(a) * p.r, Math.sin(a) * p.r, p.h); o.rotation.set(0, 0, a + Math.PI / 2); } o.updateMatrix(); cargo.setMatrixAt(i, o.matrix); });
    tram.instanceMatrix.needsUpdate = true; cargo.instanceMatrix.needsUpdate = true;
  };
  update(0); return { g, update };
}
