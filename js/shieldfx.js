// Iron Rain: how shields look (graphics chat; claude/shields.md, S-GFX).
// One energy-field material for three things: a city shield over a ground battle (a ceiling 200 m up and 320 km across,
// which from the field is a lid to the horizon), a field generator's dome (20 km across: over the whole 8 km field, its
// wall standing in view beyond it) and a city shield's disc on the planet globe. The field is a faint lattice of
// hexagonal cells that is almost clear looked at square on and thickens to a glowing sheen at grazing angles, so a
// camera above the ceiling sees the battle through it and the horizon all round carries the shield's colour. The
// lattice drifts slowly and a brightness wave runs through it; the dome's foot glows where it meets the ground.
// TSL only. The colour is the owner's faction colour pulled toward shield blue-white.
//   groundShields(sc, spec) → { city, dome, set(o), tick(t) }   (groundfx owns the call; spec.shield is the ground chat's)
//   globeShield(seat, radDeg, opts) → { mesh, setOn(k), setColor(c), tick(t) }   (for planetwarview.js)
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uniform, positionWorld, positionView, positionGeometry, normalView, smoothstep, mix, dot, length, floor, max, clamp, abs, sin, atan, normalize, select } from 'three/tsl';
import { FACTIONS } from './data.js';

const PI = Math.PI;
export const SHIELD_BLUE = new THREE.Color(.55, .85, 1);
export const CEIL_H = 200;     // the city shield's height over the ground, m (the books: disc-shaped shields two hundred metres above the surface); the field's highest ground sets the floor
export const CEIL_R = 160000;  // its radius, m: 160 km around the city
export const DOME_R = 10000;   // a field generator's radius, m: 20 km across
// the owner's colour, pulled most of the way to shield blue-white, so a Society shield is warm and a Republic one rose without losing the look
export function shieldColor(faction) { const F = FACTIONS[faction] || FACTIONS[{ rep: 'rising', soc: 'core', rim: 'rim' }[faction]]; const c = SHIELD_BLUE.clone(); if (F) c.lerp(new THREE.Color(F.col.main), .42); return c; }

// the hexagonal lattice: distance to the nearest cell edge on a pointy-top grid of unit spacing (0 at a centre, .5 at an edge)
const hexD = Fn(([p]) => { const s = vec2(1, 1.7320508), h = s.mul(.5);
  const a = p.sub(s.mul(floor(p.div(s)))).sub(h), b = p.sub(h).sub(s.mul(floor(p.sub(h).div(s)))).sub(h);
  const g = select(length(b).lessThan(length(a)), b, a).toVar(), q = abs(g);
  return max(dot(q, vec2(.5, .8660254)), q.x); }).setLayout({ name: 'ir_hexD', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// mode: 'ceil' (lattice on world xz), 'dome' (on azimuth × height round a centre, seamless), 'globe' (on the cap's uv)
function shieldMat(mode, o = {}) {
  const U = { col: uniform(new THREE.Color(.55, .85, 1)), on: uniform(1), t: uniform(0), cell: uniform(o.cell || 120), c: uniform(new THREE.Vector3()), r: uniform(o.r || 1), cells: uniform(o.cells || 64) };
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  m.colorNode = Fn(() => {
    const P = positionWorld.toVar(), t = U.t;
    let p2, foot = float(0), rim = float(0), span = float(1);
    if (mode === 'ceil') { p2 = P.xz.div(U.cell).add(vec2(t.mul(.012), t.mul(.007))); }
    else if (mode === 'dome') { const d = P.sub(U.c), az = atan(d.z, d.x), n = U.cells; p2 = vec2(az.div(PI * 2).add(.5).mul(n).add(t.mul(.01)), P.y.div(U.cell).add(t.mul(.008))); foot = smoothstep(120, 0, P.y.sub(U.c.y)); } // n cells round, so the seam joins
    else { const q = positionGeometry.xz, rr = length(q).div(U.r); p2 = q.div(U.r).mul(U.cells.mul(.5)).add(vec2(t.mul(.02), 0)); rim = smoothstep(.8, .96, rr).mul(smoothstep(1.03, .98, rr)); } // the cap round +Y: its x,z are the disc's own plane, so the cells are even across it
    const d = hexD(p2), edge = smoothstep(.43, .5, d).toVar(), cellK = smoothstep(.5, .1, d).mul(.12); // thin bright edges, a faint fill toward each cell's centre
    const V = normalize(positionView), fres = float(1).sub(abs(dot(normalView, V))).toVar(), graze = fres.mul(fres).mul(fres).toVar();
    const wave = sin(P.x.mul(.0012).add(P.z.mul(.0007)).sub(t.mul(1.6))).mul(.5).add(.5).mul(.35).add(.65); // a slow brightness wave through the lattice
    let a;
    if (mode === 'globe') a = float(.11).add(edge.mul(.4)).add(cellK.mul(.6)).add(rim.mul(1.1)).mul(span).mul(wave.mul(.6).add(.4)); // on the globe we look square on: a visible veil with a bright rim
    else a = float(.02).add(edge.mul(.15)).add(cellK.mul(.4)).add(graze.mul(.4)).add(foot.mul(.4)).mul(wave); // on the ground: nearly clear from above, a sheen at the horizon, a glowing foot
    const col = mix(U.col, vec3(1, 1, 1), edge.mul(.5).add(graze.mul(.3)));
    return vec4(col, clamp(a, 0, 1).mul(U.on));
  })();
  m.uniforms = U; return m;
}

// the two shields of a ground battle. spec.shield = { city: 'att'|'def'|null, field: 'att'|'def'|null, gen: { x, y } } is
// the ground chat's (S-G); until it exists, a defender with a shield level has its city shield up over the city's field.
export function groundShields(sc, spec, city, top = 0, cityH = 0) { // top: the field's highest ground, cityH: the ground under the city; the ceiling is 200 m over the city and clear of every hill
  const sh = spec.shield || (spec.def && spec.def.shield > 0 && !(spec.site && !spec.site.field) ? { city: 'def' } : null) || {};
  const facOf = sd => sd === 'att' ? spec.att && spec.att.f : spec.def && spec.def.f;
  const out = { city: null, dome: null, set, tick(t) { if (out.city) out.city.material.uniforms.t.value = t; if (out.dome) out.dome.material.uniforms.t.value = t; } };
  function set(o) { // change what's up without rebuilding the scene: o = { city, field, gen }
    if (o.city !== undefined) { if (o.city && !out.city) { const m = new THREE.Mesh(new THREE.CircleGeometry(Math.min(CEIL_R, 30000), 96), shieldMat('ceil', { cell: 300 })); m.rotation.x = -PI / 2; m.position.set(city ? city.x : 4000, Math.max(cityH + CEIL_H, top + 60), city ? city.y : 4000); m.renderOrder = 40; m.frustumCulled = false; sc.add(m); out.city = m; }
      if (out.city) { out.city.visible = !!o.city; if (o.city) out.city.material.uniforms.col.value.copy(shieldColor(facOf(o.city))); } }
    if (o.field !== undefined || o.gen) { const g = o.gen || (out.dome && out.dome.userData.gen) || { x: 4000, y: 6000 };
      if ((o.field || o.gen) && !out.dome) { const geo = new THREE.SphereGeometry(DOME_R, 128, 48, 0, PI * 2, 0, PI * .56), m = new THREE.Mesh(geo, shieldMat('dome', { cell: 420, cells: Math.round(2 * PI * DOME_R / 420) })); m.renderOrder = 41; m.frustumCulled = false; sc.add(m); out.dome = m; }
      if (out.dome) { out.dome.userData.gen = g; out.dome.position.set(g.x, -DOME_R * .06, g.y); out.dome.material.uniforms.c.value.set(g.x, 0, g.y); if (o.field !== undefined) out.dome.visible = !!o.field; if (o.field) out.dome.material.uniforms.col.value.copy(shieldColor(facOf(o.field))); } }
  }
  set({ city: sh.city || null, field: sh.field || null, gen: sh.gen });
  return out;
}

// a city shield's disc on the planet globe: a spherical cap of radDeg round the seat (a unit vector), a hair above the
// surface, in the owner's colour. planetwarview places one per shielded city and sets it on or off as the war goes.
export function globeShield(seat, radDeg = 3.8, o = {}) {
  const geo = new THREE.SphereGeometry(o.lift || 1.006, 64, 12, 0, PI * 2, 0, radDeg * PI / 180);
  const m = new THREE.Mesh(geo, shieldMat('globe', { cells: 13, r: Math.sin(radDeg * PI / 180) * (o.lift || 1.006) })); m.renderOrder = 5;
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), seat.clone().normalize());
  const U = m.material.uniforms; if (o.faction) U.col.value.copy(shieldColor(o.faction)); else if (o.color) U.col.value.set(o.color);
  return { mesh: m, setOn(k) { U.on.value = k ? (k === true ? 1 : k) : 0; m.visible = U.on.value > 0; }, setColor(c) { U.col.value.copy(c.isColor ? c : shieldColor(c)); }, setFaction(f) { U.col.value.copy(shieldColor(f)); }, tick(t) { U.t.value = t; }, dispose() { geo.dispose(); m.material.dispose(); } };
}
