// Surface maps for every world, painted to the lore of the Red Rising saga (Iron Gold era, 753 PCE).
// Pure JS, no DOM: runs in a Web Worker (or on the main thread as a fallback, or in node for previews).
// generate(id, W) → { W, H, day, night, cW, cH, clouds }: RGBA byte arrays, rows stored bottom-up
// (row 0 = south) so they upload straight into a THREE.DataTexture.
//   day:   rgb surface colour; alpha = how much it shines like water (sun glint)
//   night: rgb city light
//   clouds: rgb shade, alpha cover (a separate shell turning slowly over the surface)

// ---------------------------------------------------------------- noise
const PERM = new Uint8Array(512), GV = new Float32Array(256);
{ const p = [...Array(256).keys()]; let s = 1013; for (let i = 255; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; for (let i = 0; i < 256; i++) { s = (s * 1664525 + 1013904223) >>> 0; GV[i] = s / 2147483648 - 1; } }
function vn(x, y, z) { // value noise, -1..1
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); x -= X; y -= Y; z -= Z;
  const u = x * x * (3 - 2 * x), v = y * y * (3 - 2 * y), w = z * z * (3 - 2 * z);
  const A = PERM[X & 255] + (Y & 255), AA = PERM[A] + (Z & 255), AB = PERM[A + 1] + (Z & 255), B = PERM[(X + 1) & 255] + (Y & 255), BA = PERM[B] + (Z & 255), BB = PERM[B + 1] + (Z & 255);
  const a0 = GV[PERM[AA]], a1 = GV[PERM[BA]], a2 = GV[PERM[AB]], a3 = GV[PERM[BB]], b0 = GV[PERM[AA + 1]], b1 = GV[PERM[BA + 1]], b2 = GV[PERM[AB + 1]], b3 = GV[PERM[BB + 1]];
  const c0 = a0 + (a1 - a0) * u, c1 = a2 + (a3 - a2) * u, c2 = b0 + (b1 - b0) * u, c3 = b2 + (b3 - b2) * u, d0 = c0 + (c1 - c0) * v, d1 = c2 + (c3 - c2) * v;
  return d0 + (d1 - d0) * w;
}
let XO = 0; // extra octaves for the sharper maps, so a 4096 map holds finer ground and not just a bigger blur
function fbm(x, y, z, o, f = 1, sd = 0) { o += XO; let a = 0, s = .5, n = 0; x = x * f + sd * 17.3; y = y * f - sd * 9.1; z = z * f + sd * 5.7; for (let i = 0; i < o; i++) { a += vn(x, y, z) * s; n += s; x *= 2.03; y *= 2.03; z *= 2.03; s *= .5; } return a / n; }
function ridged(x, y, z, o, f = 1, sd = 0) { o += XO; let a = 0, s = .5, n = 0; x = x * f + sd * 13.1; y = y * f + sd * 3.3; z = z * f - sd * 7.9; for (let i = 0; i < o; i++) { const v = 1 - Math.abs(vn(x, y, z)); a += v * v * s; n += s; x *= 2.07; y *= 2.07; z *= 2.07; s *= .5; } return a / n; }
const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const cl01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const D = Math.PI / 180;
const hexc = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = new Proxy({}, { get: (t, k) => t[k] || (t[k] = hexc('#' + k)) }); // C.aabbcc → [r,g,b]
function mixTo(o, c, t) { if (t <= 0) return; if (t >= 1) { o.r = c[0]; o.g = c[1]; o.b = c[2]; return; } o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; }
function set(o, c) { o.r = c[0]; o.g = c[1]; o.b = c[2]; }
function ramp(o, stops, t) { // stops: [[t, colour], ...] ascending
  if (t <= stops[0][0]) return set(o, stops[0][1]);
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0); o.r = c0[0] + (c1[0] - c0[0]) * k; o.g = c0[1] + (c1[1] - c0[1]) * k; o.b = c0[2] + (c1[2] - c0[2]) * k; return; }
  set(o, stops[stops.length - 1][1]);
}
const vec = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
// a soft round region on the sphere: 1 at its centre, 0 beyond r degrees
function spot(x, y, z, c, r) { const d = x * c[0] + y * c[1] + z * c[2]; const k = 1 - Math.cos(r * D); return cl01(1 - (1 - d) / k); }
function lights(o, x, y, z, i, j, dens, col = C.ffc58a, k = 1) { // clustered city light, grainy like real night photos
  if (dens <= 0) return; k *= sm(0, .35, dens);
  const v = fbm(x, y, z, 3, 34, 41) * .5 + .5, c = sm(.62 - dens * .3, .9 - dens * .3, v), h = hash(i, j);
  const a = c * (h > .45 ? .35 + .65 * h : .12) * k + sm(.86, .97, v) * .6 * dens * k;
  o.lr += col[0] * a; o.lg += col[1] * a; o.lb += col[2] * a;
}

// ---------------------------------------------------------------- polygon masks (for Earth and Mercury's continents)
function polyMask(W, H, polys) { // polys: [[lon, lat], ...] in degrees; drawn with wrap-around in longitude
  const m = new Float32Array(W * H), X = lon => (lon + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
  for (const poly of polys) {
    const val = poly.sea ? 0 : 1, pts = poly.pts || poly;
    for (const off of [-W, 0, W]) {
      const P = pts.map(([lo, la]) => [X(lo) + off, Y(la)]);
      let y0 = Infinity, y1 = -Infinity; for (const p of P) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
        const yy = y + .5, xs = [];
        for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; if ((a[1] <= yy) !== (b[1] <= yy)) xs.push(a[0] + (yy - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - .5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - .5)); x++) m[y * W + x] = val;
      }
    }
  }
  return m;
}
function blur(m, W, H, r) { // separable box blur, twice, wrapping in x
  const t = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) { let s = 0; const o = y * W; for (let k = -r; k <= r; k++) s += m[o + ((k % W) + W) % W]; for (let x = 0; x < W; x++) { t[o + x] = s / (2 * r + 1); s += m[o + (x + r + 1) % W] - m[o + ((x - r) % W + W) % W]; } }
    for (let x = 0; x < W; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(H - 1, Math.max(0, k)) * W + x]; for (let y = 0; y < H; y++) { m[y * W + x] = s / (2 * r + 1); s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  }
  return m;
}
const sample = (m, W, H, lat, lon) => { const x = Math.floor((lon + 180) / 360 * W), y = Math.floor((90 - lat) / 180 * H); return m[Math.min(H - 1, Math.max(0, y)) * W + ((x % W) + W) % W]; };

// ---------------------------------------------------------------- Earth: the real continents, coarse, with noisy coasts
const EARTH = [
  [[-168, 66], [-162, 70], [-140, 70], [-125, 72], [-100, 73], [-82, 72], [-75, 68], [-62, 60], [-56, 52], [-66, 45], [-70, 42], [-76, 38], [-76, 35], [-81, 31], [-80, 26], [-82, 25], [-83, 29], [-90, 30], [-94, 29], [-97, 26], [-97, 22], [-92, 18], [-88, 21], [-87, 16], [-83, 15], [-83, 10], [-80, 8], [-77, 8], [-79, 9], [-85, 11], [-88, 14], [-92, 15], [-96, 16], [-105, 20], [-106, 23], [-110, 28], [-113, 31], [-115, 30], [-110, 23], [-112, 25], [-117, 32], [-121, 35], [-124, 40], [-124, 46], [-123, 49], [-128, 51], [-134, 57], [-140, 60], [-148, 61], [-152, 59], [-158, 57], [-164, 55], [-158, 59], [-162, 60], [-166, 62], [-165, 65]],
  [[-55, 60], [-44, 60], [-40, 65], [-22, 70], [-20, 76], [-18, 81], [-35, 83], [-60, 82], [-70, 78], [-58, 75], [-54, 70], [-52, 65]],
  [[-80, 63], [-62, 66], [-68, 72], [-80, 73], [-90, 70]], [[-90, 76], [-62, 82], [-80, 83], [-95, 80]], [[-85, 22], [-74, 20], [-78, 22]],
  [[-77, 8], [-72, 12], [-63, 11], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-35, -5], [-35, -9], [-39, -15], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-62, -40], [-65, -45], [-68, -50], [-69, -55], [-74, -52], [-75, -46], [-73, -38], [-71, -30], [-70, -18], [-76, -14], [-81, -6], [-80, -1], [-78, 2]],
  [[-9, 43], [-9, 37], [-6, 36], [0, 38], [3, 42], [5, 43], [9, 44], [12, 42], [16, 38], [18, 40], [14, 45], [19, 42], [24, 38], [26, 40], [29, 41], [36, 36], [35, 33], [35, 28], [39, 21], [43, 13], [45, 13], [52, 16], [58, 20], [60, 23], [57, 25], [52, 24], [50, 26], [48, 30], [50, 30], [57, 27], [62, 25], [67, 25], [70, 21], [73, 17], [75, 12], [77, 8], [80, 10], [80, 15], [87, 21], [92, 22], [94, 17], [98, 16], [98, 8], [101, 3], [104, 1], [103, 6], [100, 13], [105, 9], [109, 12], [108, 17], [106, 20], [110, 21], [117, 23], [121, 28], [122, 31], [120, 36], [122, 37], [118, 38], [121, 40], [125, 40], [127, 35], [129, 35], [129, 40], [132, 43], [138, 46], [141, 52], [137, 54], [140, 58], [150, 59], [156, 61], [162, 61], [156, 57], [156, 51], [162, 56], [163, 60], [170, 60], [178, 64], [180, 66], [180, 69], [170, 70], [160, 70], [150, 72], [140, 73], [130, 71], [113, 74], [105, 78], [95, 76], [80, 73], [70, 73], [68, 69], [60, 69], [55, 68], [44, 68], [40, 66], [33, 69], [25, 71], [18, 70], [13, 67], [5, 62], [5, 58], [8, 58], [11, 59], [12, 56], [10, 54], [8, 54], [4, 52], [2, 51], [-2, 48], [-4, 48], [-1, 46], [-2, 43]],
  [[-17, 15], [-17, 21], [-13, 27], [-10, 30], [-6, 35], [0, 36], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [34, 28], [37, 22], [39, 16], [43, 12], [51, 12], [47, 7], [40, -2], [39, -7], [40, -15], [35, -20], [35, -25], [32, -29], [27, -34], [20, -35], [18, -32], [15, -27], [12, -18], [13, -12], [12, -5], [9, -1], [9, 4], [5, 6], [-4, 5], [-8, 4], [-13, 8], [-15, 11]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [136, -15], [141, -17], [142, -11], [145, -15], [153, -25], [150, -37], [146, -39], [140, -38], [135, -35], [130, -31], [118, -35], [115, -34]],
  [[-5, 50], [1, 51], [2, 53], [-1, 55], [-2, 58], [-5, 59], [-6, 56], [-5, 54], [-3, 54], [-4, 52]], [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54]],
  [[130, 31], [132, 34], [136, 35], [140, 36], [142, 40], [141, 45], [144, 44], [140, 42], [139, 38], [136, 37], [133, 35], [130, 33]],
  [[95, 5], [98, 4], [106, -6], [104, -6], [100, -1], [95, 3]], [[109, 1], [110, -3], [116, -4], [119, 1], [117, 7], [113, 4]], [[131, -1], [141, -3], [150, -10], [147, -10], [138, -8], [132, -4]], [[105, -6], [114, -8], [106, -7]],
  [[172, -35], [178, -38], [174, -41], [171, -45], [167, -46], [172, -41]], [[80, 10], [82, 7], [80, 6]], [[-24, 64], [-14, 64], [-15, 66], [-22, 66]],
  [[120, 18], [123, 18], [126, 7], [122, 7], [120, 12]], [[142, 46], [144, 49], [143, 54], [142, 52]],
  { sea: 1, pts: [[47, 45], [53, 47], [54, 41], [52, 37], [49, 38], [47, 42]] }, { sea: 1, pts: [[28, 42], [28, 46], [34, 46], [38, 47], [41, 42], [35, 42]] },
  { sea: 1, pts: [[-95, 59], [-85, 55], [-80, 52], [-78, 57], [-77, 62], [-85, 64], [-94, 62]] },
  { sea: 1, pts: [[10, 54], [14, 54], [20, 55], [21, 57], [24, 57], [24, 60], [30, 60], [22, 61], [21, 64], [25, 66], [22, 66], [17, 62], [18, 59], [16, 56], [12, 56]] },
];
// Mercury's two continents after Dark Age's maps: Helios on the prime meridian (Talarian and Petasos peninsulas to
// the north, the Waste of Ladon at its heart, jungles south) and Borealis opposite it
const HELIOS = [[-38, 50], [-33, 58], [-24, 52], [-15, 54], [-6, 46], [6, 47], [14, 55], [22, 56], [26, 48], [34, 44], [40, 34], [44, 22], [42, 8], [46, -6], [40, -16], [34, -28], [24, -38], [14, -44], [4, -40], [-6, -46], [-14, -36], [-22, -30], [-30, -14], [-26, -6], [-34, -2], [-40, 8], [-34, 16], [-42, 24], [-40, 38]];
const BOREALIS = [[140, 44], [152, 52], [166, 50], [180, 56], [196, 50], [212, 44], [222, 30], [218, 14], [226, 0], [220, -14], [206, -26], [192, -34], [178, -30], [164, -38], [150, -26], [144, -12], [136, 0], [140, 14], [132, 28]];

// ---------------------------------------------------------------- the worlds
// px(o, lat, lon, x, y, z, i, j, ctx): write o.r/g/b (surface), o.sea (0..1 glint), o.lr/lg/lb (city light)
const W_ = {};
W_.sun = { px(o, lat, lon, x, y, z) {
  const g = fbm(x, y, z, 5, 26), s = fbm(x, y, z, 3, 4, 5), spots = sm(.42, .55, fbm(x, y, z, 3, 7, 9)) * sm(40, 10, Math.abs(Math.abs(lat) - 18));
  ramp(o, [[-1, C.ff8a1e], [-.2, C.ffb43c], [.25, C.ffd46a], [1, C.fff3c0]], g * 1.4 + s * .5);
  mixTo(o, C['5a1e06'], spots * .85);
} };
W_.mercury = { // terraformed hard: coral seas, alpine north, the Waste of Ladon, southern jungles, the seams left by the work
  pre(W, H) { const m = blur(polyMask(W, H, [HELIOS, BOREALIS]), W, H, Math.max(3, W >> 7)); return { m }; },
  night: 1, clouds: { cover: .44, scale: 3.2, warp: 1.2, col: C.ffffff },
  px(o, lat, lon, x, y, z, i, j, { m, W, H }) {
    const n = fbm(x, y, z, 6, 2.2), land0 = sample(m, W, H, lat, lon) + n * .32 + fbm(x, y, z, 4, 10, 46) * .08 + fbm(x, y, z, 3, 34, 47) * .04;
    const polar = lat > 73 + fbm(x, y, z, 4, 5, 3) * 6, isl = ridged(x, y, z, 4, 6, 2) > .93 && Math.abs(lat) < 60 && fbm(x, y, z, 3, 2, 9) > .1;
    const land = land0 > .5 || polar || isl;
    if (!land) { const depth = cl01((.5 - land0) * 2.2); ramp(o, [[0, C['3ad6c6']], [.18, C['1aa0aa']], [.55, C['0c6488']], [1, C['083c64']]], depth); o.sea = 1;
      if (depth < .25 && fbm(x, y, z, 3, 40, 7) > .1) mixTo(o, C.e8c0a0, .25); // coral shallows
      return; }
    const h = ridged(x, y, z, 6, 4, 11), mtn = sm(.55, .85, h);
    if (polar) { ramp(o, [[0, C.c8d0d8], [1, C.ffffff]], .5 + n); return; }
    const ladon = sm(.15, .55, spot(x, y, z, MERC_LADON, 30) + fbm(x, y, z, 4, 4, 13) * .35);
    const north = sm(15, 40, lat), south = sm(-5, -25, lat);
    set(o, C['4a7a3a']); // temperate green
    const veg = fbm(x, y, z, 4, 12, 50), can = fbm(x, y, z, 3, 40, 51); mixTo(o, C['6a8a3c'], sm(.1, .5, veg) * .45); mixTo(o, C['2e5a2a'], sm(-.1, -.5, veg) * .4); // meadow and wood in patches
    mixTo(o, C['5b6b4a'], north); mixTo(o, C['1e4a20'], south * (1 - ladon)); // alpine scrub north, deep jungle south
    mixTo(o, C['153a18'], south * sm(.2, .6, can) * .5); mixTo(o, C['8a9a5a'], north * sm(.3, .7, can) * .4); // canopy and scrub texture
    const riv = sm(.96, 1, 1 - Math.abs(fbm(x, y, z, 5, 6, 52))) * sm(.5, .2, h); mixTo(o, C['1a4a6a'], riv * .8); // the river systems of the lowlands
    mixTo(o, C.d8b878, ladon * sm(-.3, .1, n)); mixTo(o, C.c49a5a, ladon * sm(.1, .5, h)); mixTo(o, C.a8824a, ladon * sm(.3, .7, Math.sin(lon * D * 60 + fbm(x, y, z, 3, 9, 53) * 5) * .5 + .5) * .4); // the Waste's dune seas
    mixTo(o, C['8a7c70'], mtn * .8); mixTo(o, C.f4f4f8, sm(.78, .95, h) * (.4 + north)); // Hesperides and Aigle snows
    // Tyche, Heliopolis, Keryx and the mining towns of the Ladon
    const dens = .25 + .5 * spot(x, y, z, MERC_TYCHE, 7) + .55 * spot(x, y, z, MERC_HELIO, 6) + .3 * spot(x, y, z, MERC_KERYX, 6);
    lights(o, x, y, z, i, j, dens * (1 - mtn * .6));
  },
  post(o, lat, lon) { // the seams: straight scars at the edge of the polar ice and near Helios's southern end
    if ((Math.abs(lat - 71) < .35 && lon > -40 && lon < 30) || (Math.abs(lat + 43) < .3 && lon > -12 && lon < 26) || (Math.abs(lon - 160) < .3 && lat > -20 && lat < 40)) { mixTo(o, C.e8dcc8, .7); o.sea = 0; }
  } };
const MERC_LADON = vec(6, 2), MERC_TYCHE = vec(46, -26), MERC_HELIO = vec(-4, -24), MERC_KERYX = vec(8, 40);
W_.venus = { // an ocean world: 80% sea, two continents, white-sand archipelagos and an ice cap at each pole
  night: 1, clouds: { cover: .5, scale: 2.6, warp: 1.6, col: C.fffaf0 },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 2.4, 2);
    const ishtar = spot(x, y, z, VEN_ISHTAR, 30), aph = Math.max(spot(x, y, z, VEN_APH1, 30), spot(x, y, z, VEN_APH2, 28), spot(x, y, z, VEN_APH3, 22) * .9);
    const arch = sm(.6, .85, ridged(x, y, z, 5, 5, 6)) * sm(.0, .3, fbm(x, y, z, 3, 2.5, 4)) * sm(55, 30, Math.abs(lat));
    const e = Math.max(ishtar, aph) * .75 + n * .55 + arch * .45 - .4, cap = sm(73, 79, Math.abs(lat) + n * 6);
    if (cap > .5) { ramp(o, [[0, C.dfe8f0], [1, C.ffffff]], n + .5); return; }
    if (e < 0) { ramp(o, [[-.6, C['0b2a6e']], [-.15, C['134a9a']], [-.03, C['1f86b8']], [0, C['5cd0d8']]], e); o.sea = 1; return; }
    if (e < .025) { set(o, C.f4ecd8); return; } // the beaches
    const h = ridged(x, y, z, 5, 3, 8), h2 = ridged(x, y, z, 4, 11, 57);
    ramp(o, [[0, C['2f7a32']], [.25, C['1d5a22']], [.5, C['3d6a2c']], [.8, C['7a7060']], [1, C.e8e4dc]], e * 1.6 + h * .3 + h2 * .12);
    mixTo(o, C['5a8a3a'], sm(.2, .6, fbm(x, y, z, 4, 14, 58)) * .4 * (1 - sm(.5, .8, e * 1.6 + h * .3))); mixTo(o, C.f0e8d0, arch * sm(.0, .06, e) * .6); // lowland meadow; the white sands of the archipelagos
    o.h = e * 1.2 + h * .5 + h2 * .15;
    lights(o, x, y, z, i, j, .35 + .5 * spot(x, y, z, VEN_HARMONIA, 8));
  } };
const VEN_ISHTAR = vec(68, 10), VEN_APH1 = vec(-6, 95), VEN_APH2 = vec(-12, 140), VEN_APH3 = vec(0, 185), VEN_HARMONIA = vec(-4, 100);
// [lat, lon, radius°]: deserts, and points along the great ranges
const EARTH_DESERTS = [[22, 8, 15], [24, -6, 11], [20, 26, 12], [26, 18, 10], [23, 46, 10], [29, 58, 6], [27, 70, 5], [42, 104, 8], [39, 84, 6], [-25, 128, 11], [-28, 137, 6], [-23, 20, 6], [-23, 15, 3], [-24, -69, 3], [-46, -69, 4], [33, -112, 6], [40, -117, 4], [44, 62, 6]];
const EARTH_RANGES = [[29, 82, 4], [31, 88, 4], [33, 77, 3], [35, 72, 3], [28, 92, 3], [37, 70, 3], [32, 96, 3], [42, 80, 3], [-38, -70, 2.5], [-30, -69, 2.5], [-22, -67, 3], [-15, -71, 3], [-8, -77, 2.5], [0, -78, 2.5], [5, -75, 2], [-46, -72, 2.5],
  [40, -107, 3], [45, -112, 3], [50, -117, 3], [56, -125, 3], [62, -140, 3], [36, -117, 2], [19, -100, 2], [46, 9, 2], [42, 1, 1.5], [42, 44, 2], [43, 20, 1.5], [38, 47, 2], [32, 55, 2], [10, 38, 3], [-0, 30, 1.5], [62, 9, 2], [55, 60, 2], [-34, 147, 1.5], [44, 140, 1.5], [36, 138, 1.5]];
W_.earth = {
  pre(W, H) { const m = blur(polyMask(W, H, EARTH), W, H, Math.max(1, W >> 9)); const inl = blur(Float32Array.from(m), W, H, Math.max(4, W >> 6)); return { m, inl }; },
  night: 1, clouds: { cover: .5, scale: 3, warp: 1.4, col: C.ffffff },
  px(o, lat, lon, x, y, z, i, j, { m, inl, W, H }) {
    const n = fbm(x, y, z, 6, 3, 4), v = sample(m, W, H, lat, lon) + n * .22 + fbm(x, y, z, 4, 11, 44) * .07 + fbm(x, y, z, 3, 36, 45) * .035, ice = lat < -66 + n * 6;
    if (v < .5 && !ice) { const d = cl01((.5 - v) * 2.4); ramp(o, [[0, C['2a7ab0']], [.25, C['154f8a']], [1, C['0a2654']]], d); o.sea = 1; return; }
    if (ice || (lat > 60 + n * 4 && lon > -58 + n * 8 && lon < -18 + n * 6)) { ramp(o, [[0, C.d8e2ea], [1, C.ffffff]], n + .5); o.h = .5 + n * .3; return; } // the ice caps, Greenland
    const interior = sample(inl, W, H, lat, lon), al = Math.abs(lat);
    // climate: the great deserts where they really lie, a weak subtropical dry belt, wet tropics; edges broken by noise
    const wn = fbm(x, y, z, 4, 7, 12) * .09, qx = x + wn, qy = y - wn, qz = z + wn * .5;
    const dw = fbm(x, y, z, 4, 16, 14) * .05; let des = 0; for (const [la, lo, r] of EARTH_DESERTS) des = Math.max(des, spot(qx + dw, qy - dw, qz, vec(la, lo), r));
    des *= sm(.2, .55, fbm(x, y, z, 4, 10, 15) * .5 + .5 + des * .9); // ragged, never round
    const belt = Math.exp(-(((al - 24) / 9) ** 2)) * (.2 + .6 * interior);
    const arid = cl01(sm(.05, .7, des) * 1.1 + belt * .55 + n * .25 - .08);
    const rain = cl01(sm(15, 3, al) * (1 - arid * 1.4) + sm(.5, .8, fbm(x, y, z, 3, 6, 13) * .5 + .5) * .3 * sm(30, 10, al));
    ramp(o, [[0, C['2f5e26']], [.3, C['46702e']], [.55, C['7a7444']], [.78, C.c0a068], [1, C.d8bc84]], arid + n * .1);
    mixTo(o, C['1c4418'], rain * .75);                                                                    // rainforest
    { const can = fbm(x, y, z, 4, 18, 54), sav = sm(.3, .55, arid) * (1 - sm(.55, .8, arid)); mixTo(o, C['2a5a22'], rain * sm(.1, .5, can) * .5); mixTo(o, C['0f3010'], rain * sm(-.1, -.5, can) * .4); // canopy
      mixTo(o, C['9a9a4a'], sav * sm(.0, .4, fbm(x, y, z, 3, 11, 55)) * .5); // savannah grass
      const riv = sm(.965, 1, 1 - Math.abs(fbm(x, y, z, 5, 7, 56))) * (1 - arid) * sm(.5, .2, interior * .4); mixTo(o, C['1a3a5a'], riv * .7); } // the great river basins
    mixTo(o, C.b07848, cl01(arid - .65) * sm(-.1, .4, fbm(x, y, z, 4, 9, 6)) * .55);                      // red dunes
    mixTo(o, C['24421e'], sm(45, 58, al) * (1 - sm(62, 70, al)) * .6 * (1 - arid)); mixTo(o, C['7c7464'], sm(64, 72, al) * .8); // boreal forest, tundra
    // the mountain chains: Himalaya, Andes, Rockies, Alps and the rest, ridged and snow-capped
    let mt = 0; for (const [la, lo, r] of EARTH_RANGES) mt = Math.max(mt, spot(x + wn * .4, y - wn * .4, z, vec(la, lo), r * .7));
    const rg = ridged(x, y, z, 6, 14, 3), peak = sm(.1, .8, mt) * rg;
    mixTo(o, C['5e5446'], sm(.15, .55, peak) * .75); mixTo(o, C['3a332c'], sm(.5, .75, peak) * .3 * (1 - sm(.75, .9, peak)));
    mixTo(o, C.eef0f2, sm(.72, .92, peak + sm(30, 60, al) * .12) * .95);
    o.h = .12 + interior * .15 + peak * 1.3 + rg * .12 + n * .1;
    const dens = .3 + .25 * sm(25, 45, lat) * (1 - sm(55, 65, lat)) - .3 * cl01(arid);
    lights(o, x, y, z, i, j, dens);
  } };
W_.luna = { // seas poured into the old maria across the north; several great vertical cities over the equator and the
  // south, Hyperion alone on the shore of the Sea of Serenity; a seeded green over grey regolith; stuffy, hazy air
  night: 1, clouds: { cover: .22, scale: 3, warp: 1, col: C.e8e0cc },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 3, 5), crat = craters(x, y, z, 1);
    const wx = x + fbm(x, y, z, 4, 3, 31) * .09, wy = y + fbm(x, y, z, 4, 3, 32) * .09, wz = z + fbm(x, y, z, 4, 3, 33) * .09; // ragged shores
    let mare = 0; for (const [c, r] of LUNA_MARIA) mare = Math.max(mare, spot(wx, wy, wz, c, r));
    let city = 0; for (const [c, r] of LUNA_CITIES) city = Math.max(city, spot(wx, wy, wz, c, r));
    const sprawl = city; city = sm(.08, .75, city + fbm(x, y, z, 5, 12, 34) * .4);
    const sea = mare + n * .18 + crat.bowl * .25 * sm(10, 40, lat);
    if (sea > .32 && city < .5) { ramp(o, [[.32, C['3a9aa4']], [.4, C['1f7290']], [.75, C['124a70']], [1, C['0c3658']]], sea); o.sea = 1; return; }
    // countryside: grey regolith under a seeded green, the old craters and the ranges like the Atlas Mountains
    ramp(o, [[-.6, C['5a5c56']], [0, C['7c7e70']], [.5, C.a4a494]], n + crat.rim * .18 - crat.bowl * .18);
    mixTo(o, C['4e6a3e'], sm(-.15, .3, fbm(x, y, z, 4, 7, 2)) * .65);
    mixTo(o, C.d4d4cc, sm(.84, .96, ridged(x, y, z, 5, 4, 7)) * .7);
    if (sea > .26) mixTo(o, C.c8c0a0, sm(.26, .32, sea) * .6); // beaches and salt flats on the shore
    if (city > 0) { // kilometres-tall towers in districts, with canyons and avenues between them
      const d = fbm(x, y, z, 3, 12, 8), road = ridged(x, y, z, 3, 16, 35), lane = ridged(x, y, z, 2, 55, 36);
      const c0 = [o.r, o.g, o.b]; ramp(o, [[-.6, C['505256']], [0, C['66676a']], [.6, C['86878a']]], d + fbm(x, y, z, 3, 40, 9) * .5 + city * .25);
      if (lane > .9) mixTo(o, C['44464c'], .45); if (road > .9) mixTo(o, C['2c2e33'], .75);
      if (hash(i, j) > .993) mixTo(o, C.d4d6da, .5);
      const k = sm(0, .8, city); o.r = c0[0] + (o.r - c0[0]) * k; o.g = c0[1] + (o.g - c0[1]) * k; o.b = c0[2] + (o.b - c0[2]) * k;
      lights(o, x, y, z, i, j, .35 + city * .65, C.ffe2b4, 1.25);
      const hl = (road > .9 ? .8 : lane > .93 ? .3 : 0) * city; o.lr += 255 * hl; o.lg += 205 * hl; o.lb += 140 * hl;
      return;
    }
    lights(o, x, y, z, i, j, .06 + sm(0, .2, sprawl) * .5);
  } };
// the near-side maria as Earth sees them, flooded, and the far side's few basins
const LUNA_MARIA = [[vec(20, -57), 20], [vec(5, -45), 12], [vec(33, -16), 12], [vec(28, 17), 8], [vec(8, 31), 9], [vec(-4, 24), 5], [vec(17, 59), 6], [vec(-6, 52), 6],
  [vec(56, 0), 9], [vec(57, -28), 9], [vec(58, 28), 8], [vec(-21, -17), 6], [vec(-24, -39), 4.5], [vec(-15, 35), 4], [vec(27, 147), 5], [vec(42, 110), 8], [vec(45, -130), 9], [vec(35, 170), 7]];
// several large cities over the equator and the south; Hyperion on the Sea of Serenity; Endymion on the far side;
// Tycho City in its crater
const LUNA_CITIES = [[vec(21, 18), 7], [vec(-40, -11), 17], [vec(-18, 45), 18], [vec(-35, 80), 16], [vec(-12, -28), 14], [vec(-28, -68), 17], [vec(-6, -105), 14],
  [vec(-38, 130), 20], [vec(-6, 165), 16], [vec(-36, -150), 18], [vec(-64, 20), 14], [vec(-62, -95), 14], [vec(-4, 98), 13], [vec(50, 85), 7]];
function craters(x, y, z, k) { // cellular craters: bowl darker, rim bright (the 8 nearest cells)
  const f = 7 * k, X = x * f, Y = y * f, Z = z * f, ix = Math.floor(X - .5), iy = Math.floor(Y - .5), iz = Math.floor(Z - .5);
  let best = 9;
  for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) for (let c = 0; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c, h = hash(cx + 991 * cz, cy);
    const d = Math.hypot(X - cx - h, Y - cy - hash(cy, cx + 17), Z - cz - hash(cz + 5, cy + 3)), r = .15 + .3 * hash(cx + 7, cy + 9 * cz);
    if (d / r < best) best = d / r;
  }
  const rim = Math.max(0, 1 - Math.abs(best - .92) * 4.5); return { bowl: best < .85 ? 1 - best / .85 : 0, rim: rim * rim * (.6 + .4 * hash(ix + 3, iz + 5)) };
}
W_.mars = { // green and white from orbit: the Borealis Basin ocean round a polar plain, the Thermic and Amazonian Seas,
  // the South Sea round the Martian Antarctic, red highlands scarred with grass, Olympus Mons and Valles Marineris
  night: 1, clouds: { cover: .38, scale: 3.2, warp: 1.2, col: C.fff6ee },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 2.6, 3);
    let e = sm(-10, 40, -lat + 18 * Math.cos((lon - 20) * D) + 14) * .9 - .45;        // the dichotomy: high south, low north
    { const sq = v => v * v; e += .7 * spot(x, y, z, MARS_THARSIS, 38) + 1.1 * sq(spot(x, y, z, MARS_OLYMPUS, 8)) + .5 * sq(spot(x, y, z, MARS_ELYSIUM, 9)); }
    for (const t of MARS_MONTES) { const v = spot(x, y, z, t, 4); e += .6 * v * v; }
    e -= .9 * spot(x, y, z, MARS_HELLAS, 17) + .7 * spot(x, y, z, MARS_ARGYRE, 9);       // crater basins hold lakes
    const vm = lon > -92 && lon < -38 ? sm(2.6, .6, Math.abs(lat + 8 + 2 * Math.sin(lon * .2))) : 0; e -= vm * .6;
    const th = Math.abs((lon + 100) + (lat - 28) * .55 + fbm(x, y, z, 4, 3, 21) * 14); e -= sm(11, 2, th) * sm(-18, -6, lat) * sm(36, 26, lat) * .9; // the Thermic Sea
    e += sm(68, 78, lat) * 1.2;                                                          // the north polar plain
    e -= sm(10, 2, Math.abs(lat + 63)) * .8;                                             // the South Sea
    e += n * .35 + fbm(x, y, z, 4, 9, 48) * .1 + fbm(x, y, z, 3, 30, 49) * .05;
    if (Math.abs(lat) > 80 + n * 6 || (lat > 74 && e > 0)) { ramp(o, [[0, C.e6e8ec], [1, C.ffffff]], n + .5); return; }
    if (e < 0) { ramp(o, [[-.5, C['0c2e5a']], [-.12, C['15528a']], [0, C['2c7aa6']]], e); o.sea = 1; lights(o, x, y, z, i, j, spot(x, y, z, MARS_CORINTH, 3) * .9); return; }
    const h = ridged(x, y, z, 5, 3.4, 6); o.h = e * .9 + h * .35; const coast = sm(.18, 0, e), wet = sm(-.1, .35, fbm(x, y, z, 4, 4, 8)) * (1 - sm(.5, .9, e));
    ramp(o, [[0, C.b8603a], [.3, C['9e4a2c']], [.6, C['7c3a22'], ], [1, C.c8a890]], e * 1.1 + h * .3);
    mixTo(o, C['5a6a32'], cl01(wet * 1.1 + coast * .7) * .9); mixTo(o, C['2f4a24'], wet * coast * .7);
    { const gr = fbm(x, y, z, 4, 11, 64), dn = fbm(x, y, z, 3, 9, 65); mixTo(o, C['6a7a3a'], sm(.2, .6, gr) * (1 - sm(.5, .9, e)) * .45); // the grass the terraformers seeded, scarring the red highlands in patches
      mixTo(o, C.d08a58, sm(.5, .9, e) * sm(.3, .7, Math.sin(lon * D * 50 + dn * 5) * .5 + .5) * .35); mixTo(o, C['6a2e1c'], sm(.55, .95, ridged(x, y, z, 4, 16, 66)) * .35); } // dune streaks on the high desert; dark rock ridges
    mixTo(o, C['3a2018'], vm * .8); mixTo(o, C['8a5a3a'], vm * sm(.3, .7, ridged(x, y, z, 4, 30, 67)) * .5); // the layered walls of the Valles
    const dens = .32 + .9 * spot(x, y, z, MARS_AGEA, 5) + .2 * coast;
    lights(o, x, y, z, i, j, dens * (1 - sm(.7, 1, e)));
  } };
const MARS_THARSIS = vec(2, -105), MARS_OLYMPUS = vec(18, -134), MARS_ELYSIUM = vec(25, 147), MARS_MONTES = [vec(-2, -112), vec(1.5, -104), vec(12, -101)];
const MARS_HELLAS = vec(-42, 70), MARS_ARGYRE = vec(-50, -43), MARS_AGEA = vec(-8, -70), MARS_CORINTH = vec(5, -104);
W_.phobos = { // hollowed and roofed in metal: the Hive, the Needles, red lights for incoming ships
  night: 1, px(o, lat, lon, x, y, z, i, j) {
    const b = fbm(x, y, z, 3, 26, 4), gx = Math.abs(((lon + 360) * 1.2) % 3 - 1.5), gy = Math.abs(((lat + 90) * 1.2) % 3 - 1.5), grid = gx < .18 || gy < .18;
    ramp(o, [[-.6, C['24252a']], [0, C['3c3e46']], [.6, C['5c5e66']]], b + (hash(i >> 2, j >> 2) - .5) * .5);
    if (grid) mixTo(o, C['15161a'], .8);
    const st = craters(x, y, z, .4); mixTo(o, C['1a1a1e'], st.bowl * .6);
    if (hash(i, j) > .995) mixTo(o, C.f0f0f0, .8); // glyphs
    lights(o, x, y, z, i, j, .75, C.ffd8a8, 1.2);
    if (hash(i + 7, j + 3) > .9985) { o.lr += 255; o.lg += 40; o.lb += 30; }
  } };
W_.deimos = { // the Battle Moon: bare rock, ringed with fleet berths and batteries
  night: 1, px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 5, 4, 6), cr = craters(x, y, z, .8);
    ramp(o, [[-.6, C['4a4440']], [0, C['6a625a']], [.6, C['8a8278']]], n + cr.rim * .4 - cr.bowl * .4);
    const base = Math.abs(lat) < 18 && (Math.abs(((lon + 360) * 2) % 6 - 3) < .4 || Math.abs(lat) < 2.5);
    if (base) mixTo(o, C['3a3c44'], .85);
    lights(o, x, y, z, i, j, base ? .9 : .05, C.ffe2c0);
  } };
W_.thebe = { // the bombed-out base, abandoned early in the Second Moon Lord Rebellion
  px(o, lat, lon, x, y, z) {
    const n = fbm(x, y, z, 5, 4, 9), cr = craters(x, y, z, 1.4);
    ramp(o, [[-.6, C['3a2a24']], [0, C['5a4436']], [.6, C['7a6050']]], n + cr.rim * .5 - cr.bowl * .3);
    mixTo(o, C['141010'], cr.bowl * .7); // scorched
  } };
W_.ceres = { // the Belt's trading post: the Hanging Market and the War Reserve, under domes in its craters
  night: 1, px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 5, 3, 2), cr = craters(x, y, z, 1.1);
    ramp(o, [[-.6, C['4c4844']], [0, C['6e6862']], [.6, C['8e8880']]], n + cr.rim * .5 - cr.bowl * .4);
    mixTo(o, C.f4f0e8, sm(.5, .9, cr.bowl) * spot(x, y, z, CERES_OCCATOR, 40)); // bright salts
    lights(o, x, y, z, i, j, .25 + 1.2 * spot(x, y, z, CERES_MARKET, 14) + cr.bowl * .4);
  } };
const CERES_OCCATOR = vec(20, -120), CERES_MARKET = vec(10, 20);
W_.io = { // never wholly terraformed: the sulphur dunes of the Yellow Sea, silicate cliffs, live volcanoes, and Demeter's
  // Garter, a belt of domed farmland round the equator under artificial suns
  night: 1, px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 3, 7), dune = fbm(x * 3, y * 3, z * 9, 3, 6, 2);
    ramp(o, [[-.6, C.b8902e], [-.1, C.e0c048], [.3, C.f0dc78], [.6, C.e8e8c8]], n + dune * .25);
    mixTo(o, C.c06a2a, sm(.2, .6, fbm(x, y, z, 4, 2, 11)) * .7);                      // red-orange sulphur
    mixTo(o, C['6a6458'], sm(.8, .92, ridged(x, y, z, 5, 4, 5)) * .9);                // silicate cliffs
    const v = volcano(x, y, z); mixTo(o, C.a03a1a, v.ring * .8); mixTo(o, C['1a1410'], v.core); // Pele-style rings, black paterae
    mixTo(o, C['3a2418'], sm(.55, .85, fbm(x * 2, y * 2, z * 2, 4, 7, 12)) * v.ring * .9); // dark flows spreading from the vents
    mixTo(o, C.f4f0d8, sm(.6, .9, fbm(x, y, z, 3, 9, 17)) * sm(30, 60, Math.abs(lat)) * .5); // sulphur-dioxide frost toward the poles
    // Demeter's Garter: a belt of domed farms round the equator, its edge ragged, its fields a patchwork under the domes
    const edge = fbm(x, y, z, 4, 4, 19) * 3.6 + fbm(x, y, z, 3, 12, 20) * 1.2, g = sm(5.4, 2.6, Math.abs(lat + Math.sin(lon * 3 * D) * 1.2 + edge));
    if (g > 0) { const q = 5, fy = Math.floor(lat * q), fx = Math.floor(lon * q * 1.4 + hash(fy, 7) * 3), fh = hash(fx, fy), fc = [[0x4e, 0x7e, 0x2a], [0x6e, 0x8e, 0x34], [0x8a, 0x9a, 0x3a], [0xa8, 0x9c, 0x4c], [0x3e, 0x6a, 0x2e]][Math.floor(fh * 5)];
      mixTo(o, fc, g * .92); if (Math.abs(lat * q - fy - .5) > .45 || Math.abs((lon * q * 1.4 + hash(fy, 7) * 3) % 1 - .5) > .46) mixTo(o, C['5a4a2a'], g * .4); /* the roads between the domes */
      const dome = fbm(x, y, z, 2, 90, 21); mixTo(o, C.e4f0d8, g * sm(.25, .45, dome) * .35); }
    o.lr += 255 * g * .55; o.lg += 220 * g * .55; o.lb += 150 * g * .45;              // the Garter's artificial suns
    o.lr += 255 * v.core * .9; o.lg += 90 * v.core * .9; o.lb += 20 * v.core;          // lava glows at night
    lights(o, x, y, z, i, j, .1 + .9 * spot(x, y, z, IO_SUNGRAVE, 5) + .7 * spot(x, y, z, IO_NESOS, 4) + .6 * spot(x, y, z, IO_PLUTUS, 4));
  } };
const IO_SUNGRAVE = vec(20, 30), IO_NESOS = vec(14, -20), IO_PLUTUS = vec(7, -14);
function volcano(x, y, z) { // scattered vents
  const f = 6, X = x * f, Y = y * f, Z = z * f, ix = Math.floor(X - .5), iy = Math.floor(Y - .5), iz = Math.floor(Z - .5); let ring = 0, core = 0;
  for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) for (let c = 0; c <= 1; c++) {
    const cx0 = ix + a, cy0 = iy + b, cz0 = iz + c; if (hash(cx0 + 31 * cz0, cy0 + 7) > .3) continue;
    const d = Math.hypot(X - cx0 - hash(cx0, cy0 + 3), Y - cy0 - hash(cy0, cx0 + 5), Z - cz0 - hash(cz0, cx0 + 11));
    const R = .12 + .2 * hash(cx0 + 3, cy0 + 13); ring = Math.max(ring, sm(.1, 0, Math.abs(d - R)) * .7 * sm(R * 1.6, R, d)); core = Math.max(core, sm(.06, .015, d));
    ring = Math.max(ring, sm(R, 0, d) * .35);
  }
  return { ring, core };
}
W_.europa = { // a stormy salt sea: the Nixian Isles along the equator, mountains in the south, more islands north
  night: 1, clouds: { cover: .56, scale: 3.4, warp: 2, col: C.f0f6ff },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 3.4, 12), r = ridged(x, y, z, 5, 6, 4);
    const e = n * .6 + sm(.6, .9, r) * (sm(9, 0, Math.abs(lat)) * .8 + sm(12, 30, lat) * .5 + sm(-20, -45, lat) * 1) - .32;
    if (e < 0) { ramp(o, [[-.5, C['062a48']], [-.12, C['0c4a72']], [0, C['2a90a8']]], e); o.sea = 1; return; }
    ramp(o, [[0, C.d8d0b0], [.03, C['3a7a4a']], [.2, C['2a5a3a']], [.4, C['6a6a68']], [.6, C.e8f0f8]], e + sm(-25, -50, lat) * .25);
    mixTo(o, C['4a8a4a'], sm(.1, .5, fbm(x, y, z, 4, 15, 62)) * .4); mixTo(o, C['2a2a28'], sm(.0, .02, e) * sm(.4, .8, fbm(x, y, z, 3, 20, 63)) * .6); // the isles' hills; black sand on some shores
    o.h = e * 1.3 + r * .3;
    lights(o, x, y, z, i, j, .65, C.ffe0b8, 1.2);
  } };
W_.ganymede = { // mountains, forests and oceans, the equatorial seas the Dockyards hung over, cities everywhere;
  // New Troy still scarred where the Dockyards' wreckage fell
  night: 1, clouds: { cover: .4, scale: 3, warp: 1.3, col: C.ffffff },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 2.8, 14), eq = sm(16, 4, Math.abs(lat + n * 10));
    const e = n * .8 - eq * .55 + .06;
    if (e < 0) { ramp(o, [[-.5, C['0a2a50']], [-.1, C['14508a']], [0, C['3a8aa8']]], e); o.sea = 1; lights(o, x, y, z, i, j, .12); return; }
    const h = ridged(x, y, z, 5, 4, 2), urb = sm(-.05, .25, fbm(x, y, z, 4, 6, 8));
    ramp(o, [[0, C['2e5a30']], [.3, C['24482a']], [.55, C['5a5a52']], [.8, C.c8c8c4]], e + h * .35);
    mixTo(o, C['4a7a3a'], sm(.1, .5, fbm(x, y, z, 4, 13, 59)) * .4 * (1 - urb)); mixTo(o, C['8a8a4a'], urb * sm(.2, .6, fbm(x, y, z, 3, 20, 60)) * .45); // woodland; the farm belts round the cities
    mixTo(o, C['7a7a7c'], urb * .55); mixTo(o, C['5e5e60'], urb * sm(.3, .7, fbm(x, y, z, 2, 70, 61)) * .3); // the city blocks
    o.h = e * .8 + h * .6;
    const scar = spot(x, y, z, GAN_TROY, 7); mixTo(o, C['2a2420'], scar * sm(.2, .6, craters(x, y, z, 2).bowl + scar * .4));
    lights(o, x, y, z, i, j, .45 + urb * .55 - scar * .5, C.ffe0b0, 1.3);
  } };
const GAN_TROY = vec(10, 40);
W_.callisto = { // made breathable by planting trees: dark forest over old craters, polar ice where the Obsidians live,
  // the Valhalla rings, and the garrison of the 8th Fleet
  night: 1, clouds: { cover: .35, scale: 3, warp: 1, col: C.f4f8f4 },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 3, 15), cr = craters(x, y, z, 1.2), ice = Math.abs(lat) > 62 + n * 10;
    if (ice) { ramp(o, [[0, C.d8e0e8], [1, C.ffffff]], n + .5); lights(o, x, y, z, i, j, .06); return; }
    if (cr.bowl > .55 && hash(Math.floor(x * 9 + 50), Math.floor(y * 9 + 50)) > .5) { set(o, C['1c4a5a']); o.sea = 1; return; } // crater lakes
    ramp(o, [[-.6, C['14301a']], [0, C['1e4024']], [.5, C['2e5430']]], n + cr.rim * .3);
    const patch = fbm(x, y, z, 4, 9, 23), old = sm(.3, .7, fbm(x, y, z, 3, 4, 24)), reg = sm(.2, .6, fbm(x, y, z, 4, 2.5, 68)); // the planting went in waves: young light woods, old dark forest, open ground between
    mixTo(o, C['6a6e5a'], reg * .5); mixTo(o, C.c8ccd0, sm(45, 62, Math.abs(lat)) * sm(.2, .6, fbm(x, y, z, 3, 8, 69)) * .6); // regolith where the planting never took; snow dusting toward the caps
    mixTo(o, C['4a6e34'], sm(.15, .5, patch) * .5); mixTo(o, C['0e2412'], old * .45); mixTo(o, C['7a7458'], sm(.55, .8, patch) * (1 - old) * .35);
    const vd = 1 - (x * VAL[0] + y * VAL[1] + z * VAL[2]), vr = Math.sin(Math.sqrt(Math.max(0, vd)) * 120 + fbm(x, y, z, 3, 20, 25) * 4) * sm(.3, .7, fbm(x, y, z, 3, 9, 70) * .5 + .5); // Valhalla: rings broken and bent, fading outward
    mixTo(o, C['5a6a44'], sm(.5, 1, vr) * sm(.2, .02, vd) * (.4 + .5 * sm(.1, .01, vd)) * .75);
    mixTo(o, C['8a8878'], sm(.6, 1, cr.rim) * .5); mixTo(o, C['223a26'], sm(.3, .7, cr.bowl) * .3);
    lights(o, x, y, z, i, j, .2 + .8 * spot(x, y, z, CAL_GARRISON, 6));
  } };
const VAL = vec(15, -56), CAL_GARRISON = vec(-5, 30);
W_.titan = { // farmland second only to Io's Garter under an amber sky; the northern seas; Titan Arms' works
  night: 1, clouds: { cover: .42, scale: 2.4, warp: 1.4, col: C.f4d8a8 },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 2.6, 16), sv = n + sm(50, 78, lat) * .6;
    if (sv > .32) { ramp(o, [[0, C['2a6a6a']], [1, C['0c2a3a']]], (sv - .32) * 4); o.sea = 1; return; }
    const dunes = sm(18, 6, Math.abs(lat)), q = 7, wob = fbm(x, y, z, 3, 6, 26) * 1.5, fy = Math.floor(lat * q + wob), fx = Math.floor(lon * q * 1.2 + hash(fy, 1) * 3 + wob), fh = hash(fx, fy), f2 = hash(fx * 3 + 1, fy * 5 + 2);
    ramp(o, [[0, C['3e6626']], [.25, C['5a7a30']], [.5, C['7a8a3c']], [.7, C.a89a48], [.85, C['6a6a30']], [1, C.c0a860]], fh * .8 + (n + .5) * .2); // the field patchwork, finer, each field its own crop
    if (f2 < .12) mixTo(o, C['8a7a4a'], .5); // fallow
    if (Math.abs(lat * q + wob - fy - .5) > .45 || Math.abs((lon * q * 1.2 + hash(fy, 1) * 3 + wob) % 1 - .5) > .46) mixTo(o, C['3a3020'], .4); // hedgerows and canals
    mixTo(o, C['2e4e22'], sm(.1, .5, fbm(x, y, z, 4, 3, 22)) * .45); // woodland between the farms
    mixTo(o, C.c8a066, dunes * .85); mixTo(o, C.a88454, dunes * sm(.3, .7, Math.sin(lon * D * 40 + fbm(x, y, z, 3, 8, 27) * 4) * .5 + .5) * .45); // the equatorial dunes, streaked by the wind
    mixTo(o, C['7a6a5a'], sm(.82, .95, ridged(x, y, z, 5, 4, 3)) * .8);
    mixTo(o, C['1c3a3a'], sm(.32, .22, sv) * .35); // the wet margins of the seas: marsh and delta
    lights(o, x, y, z, i, j, .3 + .6 * spot(x, y, z, TITAN_ARMS, 6));
  } };
const TITAN_ARMS = vec(30, 80);
W_.rhea = { // burned with atomics by the Ash Lord in 701: a glassy corpse, its old ocean beds fused black
  px(o, lat, lon, x, y, z) {
    const n = fbm(x, y, z, 6, 3, 17), basin = sm(.05, -.1, n), cr = craters(x, y, z, 1.6);
    ramp(o, [[-.6, C['2a2c30']], [0, C['4a4e52']], [.5, C['74787a']]], n + cr.rim * .3); // ash-grey plains
    mixTo(o, C['141e24'], basin * .8); if (basin > .5) o.sea = .8; // the old ocean beds, fused to black glass that shines
    mixTo(o, C['2a3a40'], basin * sm(.3, .7, fbm(x, y, z, 4, 12, 28)) * .5); // ripples frozen in the glass
    mixTo(o, C['7a8280'], sm(.85, .97, ridged(x, y, z, 4, 8, 6)) * .7); // fracture lines
    mixTo(o, C.a8aaa4, sm(.3, 1, cr.rim) * .55); mixTo(o, C['3a2a24'], sm(.6, .9, fbm(x, y, z, 3, 5, 29)) * .35); // scorched ground round the strike sites
  } };
W_.enceladus = { // white ice, the tiger stripes at the south pole; shares an Institute with Ceres
  night: 1, px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 5, 4, 18); ramp(o, [[-.5, C.a8b4c0], [0, C.c4ccd4], [.5, C.dce2e8]], n);
    if (lat < -55) { const s = Math.abs(Math.sin(lon * D * 2 + (lat + 90) * D * 6 + fbm(x, y, z, 3, 3, 5) * 1.5)); mixTo(o, C['4a8ab0'], sm(.06, .01, s) * .9); }
    mixTo(o, C['9ab0c4'], sm(.85, .95, ridged(x, y, z, 4, 6, 2)) * .6);
    lights(o, x, y, z, i, j, .12);
  } };
W_.iapetus = { // two-faced: a dark leading hemisphere, a bright trailing one, and the ridge along its equator
  px(o, lat, lon, x, y, z) {
    const n = fbm(x, y, z, 5, 4, 19), cr = craters(x, y, z, 1), dark = sm(.25, -.25, Math.cos((lon - 90) * D) * Math.cos(lat * D) - .2 + n * .2);
    ramp(o, [[-.6, C.a8a49a], [0, C.d8d4cc], [.6, C.f4f0e8]], n + cr.rim * .3);
    mixTo(o, C['2a1c14'], dark); mixTo(o, C['8a7a6a'], sm(2.5, .8, Math.abs(lat)) * .7);
  } };
W_.triton = { // terraforming without end: the Lovelock engines at each pole raise miles-high dust, towns sit under glass
  night: 1, clouds: { cover: .5, scale: 3, warp: 2.2, col: C.a08060, polar: 1, max: .8 },
  px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 6, 3, 20), cant = sm(.4, .9, ridged(x, y, z, 4, 9, 4));
    ramp(o, [[-.6, C.b89090], [0, C.d8b4b0], [.5, C.f0dcd8]], n); mixTo(o, C['9a7a74'], cant * .4 * sm(-10, 20, lat));
    const pol = sm(55, 75, Math.abs(lat)); mixTo(o, C.f4f6fa, pol * .9); // the ice fields round the engines
    const eng = sm(84, 88.5, Math.abs(lat)); o.lr += 255 * eng; o.lg += 150 * eng; o.lb += 60 * eng; set(o, eng > .5 ? C['5a4a40'] : [o.r, o.g, o.b]);
    lights(o, x, y, z, i, j, .15 + pol * .2);
  } };
W_.pluto = { // the Far Ink: first years of terraforming, a few Shamed outposts
  night: 1, px(o, lat, lon, x, y, z, i, j) {
    const n = fbm(x, y, z, 5, 3, 21), n2 = fbm(x, y, z, 4, 12, 30), heart = Math.max(spot(x, y, z, PL_H1, 34), spot(x, y, z, PL_H2, 30) * .9);
    ramp(o, [[-.6, C['8a6a4a']], [0, C.c8a888], [.5, C.e8d8c8]], n + n2 * .25);
    mixTo(o, C['3a1a12'], sm(15, 0, Math.abs(lat + 5 + n * 15)) * sm(.1, .5, Math.cos((lon - 120) * D) * .5 + .5) * (1 - heart)); // the dark tholin belt
    mixTo(o, C['6a4a3a'], sm(.4, .7, n2) * .3 * (1 - heart)); // scarps and pits in the highlands
    const hk = sm(.1, .4, heart + n * .3); mixTo(o, C.f0ece8, hk); // the heart: nitrogen ice ...
    mixTo(o, C.c8ccd4, hk * sm(.2, .6, Math.abs(Math.sin(lon * D * 36 + n2 * 3)) * Math.abs(Math.sin(lat * D * 36 + n * 3))) * .35); // ... in convection cells
    mixTo(o, C['3a5a3a'], hk * sm(.55, .8, fbm(x, y, z, 3, 7, 31)) * sm(20, 0, Math.abs(lat)) * .5); // the first green where the thaw has taken
    lights(o, x, y, z, i, j, .06);
  } };
const PL_H1 = vec(25, 175), PL_H2 = vec(10, -145);
// ---------------------------------------------------------------- the worlds the books name in passing, and the fandom's fills
// the Belt's rocks: grey-brown regolith, cratered, with mine lights in the big basins
W_.vesta = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 80), cr = craters(x, y, z, 1.3), rs = spot(x, y, z, VES_RS, 40);
  ramp(o, [[-.6, C['5a544c']], [0, C['8a8278']], [.5, C.b4aca0]], n + cr.rim * .3 - cr.bowl * .2); mixTo(o, C['6a5a48'], rs * .4); mixTo(o, C['3a3630'], sm(.5, .9, ridged(x, y, z, 4, 6, 81)) * .4); // the Rheasilvia basin, dark pyroxene troughs
  o.h = n * .4 + cr.rim * .2 - cr.bowl * .3 - rs * .4; lights(o, x, y, z, i, j, .15 + .6 * rs * sm(.7, 1, rs), C.ffd090, .8); } };
const VES_RS = vec(-75, 0);
W_.pallas = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 82), cr = craters(x, y, z, 1.5);
  ramp(o, [[-.6, C['3e3a38']], [0, C['6a6462']], [.5, C['8e8884']]], n + cr.rim * .3); mixTo(o, C['2a2826'], cr.bowl * .4); mixTo(o, C.c8c4c0, sm(.6, .9, ridged(x, y, z, 4, 8, 83)) * .3);
  o.h = n * .4 + cr.rim * .2 - cr.bowl * .3; lights(o, x, y, z, i, j, .1 + .5 * spot(x, y, z, vec(10, 60), 8), C.ffd090, .7); } };
W_.hygiea = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 3, 84), cr = craters(x, y, z, 1.2);
  ramp(o, [[-.6, C['1e1c1a']], [0, C['34302c']], [.5, C['4a4640']]], n + cr.rim * .25); mixTo(o, C['6a6a70'], sm(.5, .8, fbm(x, y, z, 3, 12, 85)) * .25); // soot over ice; the ice shows through in patches
  o.h = n * .3 + cr.rim * .15 - cr.bowl * .25; lights(o, x, y, z, i, j, .08, C.ffc080, .6); } };
W_.hildas = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 5, 86), cr = craters(x, y, z, 2);
  ramp(o, [[-.6, C['3a3634']], [0, C['5e5a56']], [.5, C['827e78']]], n + cr.rim * .3); // the anchorage: a girdle of docks and lit berths round the biggest rock
  const belt = sm(14, 6, Math.abs(lat + fbm(x, y, z, 3, 4, 87) * 4)); mixTo(o, C['2a2c32'], belt * .7); const dock = sm(.3, .7, Math.abs(Math.sin(lon * D * 18)) ) * belt; mixTo(o, C['8a8e96'], dock * .5);
  o.h = n * .3 + cr.rim * .15 + belt * .15; lights(o, x, y, z, i, j, .1 + belt * .9, C.ffe0b0, 1.2); o.lr += 200 * dock * belt; o.lg += 60 * dock * belt; } }; // red berth lights down the girdle
W_.marcher = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 6, 88), cr = craters(x, y, z, 2.2);
  ramp(o, [[-.6, C['2e2a28']], [0, C['4a4440']], [.5, C['665e58']]], n + cr.rim * .2); const heap = sm(.3, .7, fbm(x, y, z, 4, 9, 89)); mixTo(o, C['6a5a44'], heap * .5); mixTo(o, C['8a8a92'], sm(.55, .85, ridged(x, y, z, 3, 20, 90)) * heap * .6); // scrap heaps: rust and bright alloy
  o.h = n * .3 + heap * .2; lights(o, x, y, z, i, j, .2 + heap * .4, C.ffb070, .7); } };
// the small Rim moons: rock and ice under a thin scatter of lights
W_.amalthea = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 5, 91), cr = craters(x, y, z, 1.8); ramp(o, [[-.6, C['5a2e22']], [0, C['8a4a34']], [.5, C.b07050]], n + cr.rim * .3); mixTo(o, C.e8e0a0, sm(.6, .9, fbm(x, y, z, 3, 7, 92)) * .35); o.h = n * .35 + cr.rim * .2 - cr.bowl * .3; lights(o, x, y, z, i, j, .1, C.ffd090, .6); } };
W_.kalyke = { px(o, lat, lon, x, y, z) { const n = fbm(x, y, z, 5, 6, 93), cr = craters(x, y, z, 2.5); ramp(o, [[-.6, C['1a1816']], [0, C['2e2a28']], [.5, C['46423e']]], n + cr.rim * .3); o.h = n * .3 + cr.rim * .2 - cr.bowl * .3; } };
W_.mimas = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 94), cr = craters(x, y, z, 1.4), h = spot(x, y, z, MIM_H, 24); ramp(o, [[-.6, C.a8b0ba], [0, C.ccd2da], [.5, C.e8ecf0]], n + cr.rim * .2);
  const t = Math.sqrt(1 - Math.min(1, h)); mixTo(o, C['7a8290'], sm(.1, .5, h) * sm(.85, .95, 1 - Math.abs(t - .9) * 8) * .5); mixTo(o, C['5e6670'], sm(.7, 1, h) * .35); mixTo(o, C.f4f6f8, sm(.92, 1, h) * .6); // Herschel: a rim, a dark floor, a central peak
  o.h = n * .3 + cr.rim * .15 - sm(.1, .9, h) * .6 + sm(.92, 1, h) * .5; lights(o, x, y, z, i, j, .1 + .8 * sm(.4, .8, h), C.ffd0a0, .9); } };
const MIM_H = vec(0, -110);
W_.tethys = { night: 1, clouds: { cover: .22, scale: 3.5, warp: 1, col: C.ffffff }, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 95), cr = craters(x, y, z, 1.2), ith = sm(6, 1.5, Math.abs(lat * .9 - 10 * Math.sin((lon + 40) * D)));
  if (ith > .5 && n > -.2) { ramp(o, [[0, C['2a6a80']], [1, C['0c3a52']]], ith); o.sea = 1; return; } // Ithaca Chasma, thawed to a sea
  ramp(o, [[-.6, C.c0c8d0], [0, C.dce2e8], [.5, C.f0f4f8]], n + cr.rim * .2); mixTo(o, C['4a7a4a'], sm(.3, .6, ith) * sm(0, .4, fbm(x, y, z, 3, 10, 96)) * .7); // farm domes along the chasm's shores
  o.h = n * .3 + cr.rim * .15 - ith * .4; lights(o, x, y, z, i, j, .1 + ith * .9, C.ffe0b0, 1); } };
W_.dione = { night: 1, clouds: { cover: .2, scale: 3.2, warp: 1, col: C.ffffff }, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 97), cr = craters(x, y, z, 1.1), wisp = sm(.88, .97, ridged(x, y, z, 5, 5, 98));
  ramp(o, [[-.6, C.b4bcc6], [0, C.d4dae0], [.5, C.eceff2]], n + cr.rim * .2); mixTo(o, C.ffffff, wisp * .8); // the wispy terrain: bright ice cliffs
  const city = sm(.3, .7, fbm(x, y, z, 4, 5, 99)) * wisp; mixTo(o, C['5a5e68'], city * .6); mixTo(o, C['3a4a3a'], sm(.5, .8, fbm(x, y, z, 3, 8, 100)) * .25); // cities in the canyon walls; lichen farms
  o.h = n * .3 + cr.rim * .15 + wisp * .3; lights(o, x, y, z, i, j, .3 + city * 1.2, C.ffe0b0, 1.1); } };
W_.hyperion = { px(o, lat, lon, x, y, z) { const n = fbm(x, y, z, 5, 7, 101), cr = craters(x, y, z, 3.2); ramp(o, [[-.6, C['3a342e']], [0, C['6a6058']], [.5, C.a09888]], n + cr.rim * .4 - cr.bowl * .5); mixTo(o, C['1e1a18'], cr.bowl * .6); o.h = n * .2 + cr.rim * .3 - cr.bowl * .7; } }; // the sponge: pits on pits
W_.miranda = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 102), cr = craters(x, y, z, 1.3), prov = Math.floor((fbm(x, y, z, 2, 2, 103) + 1) * 2.5);
  ramp(o, [[-.6, C['7a8290']], [0, C.a8b0bc], [.5, C.d0d6de]], n + cr.rim * .2); if (prov % 2) mixTo(o, C['5a6270'], .35); // the coronae: mismatched provinces
  mixTo(o, C.e8ecf0, sm(.85, .96, ridged(x, y, z, 4, 9, 104)) * .6); mixTo(o, C['2e3440'], sm(.9, .98, ridged(x, y, z, 3, 14, 105)) * .5); // ridges and the great scarps
  o.h = n * .3 + cr.rim * .15 + (prov % 2 ? .25 : 0); lights(o, x, y, z, i, j, .08, C.ffe0c0, .6); } };
W_.ariel = { night: 1, clouds: { cover: .18, scale: 3.6, warp: 1, col: C.ffffff }, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 106), cr = craters(x, y, z, 1.1), rift = sm(.9, .98, ridged(x, y, z, 5, 4, 107));
  ramp(o, [[-.6, C.b8c0c8], [0, C.d8dde2], [.5, C.f0f2f4]], n + cr.rim * .2); mixTo(o, C['3a6a3a'], rift * .8); mixTo(o, C['2a5a6a'], rift * sm(.6, .9, fbm(x, y, z, 3, 12, 108)) * .6); // the rift valleys: farms and meltwater
  o.h = n * .3 + cr.rim * .15 - rift * .4; lights(o, x, y, z, i, j, .1 + rift * .9, C.ffe0b0, .9); } };
W_.umbriel = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 109), cr = craters(x, y, z, 1.3), wun = spot(x, y, z, UMB_W, 9);
  ramp(o, [[-.6, C['1e1c1e']], [0, C['34323a']], [.5, C['4a4850']]], n + cr.rim * .2); mixTo(o, C.e8ecf0, sm(.4, .8, wun) * sm(.85, .95, 1 - Math.abs(Math.sqrt(1 - Math.min(1, wun)) - .8) * 6) * .7); // Wunda: the bright ring on the floor
  o.h = n * .3 + cr.rim * .15 - cr.bowl * .3; lights(o, x, y, z, i, j, .08 + .5 * spot(x, y, z, vec(-20, 40), 6), C.ffc090, .6); } };
const UMB_W = vec(8, 273);
W_.titania = { night: 1, clouds: { cover: .25, scale: 3, warp: 1.2, col: C.f4eef0 }, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 3.4, 110), cr = craters(x, y, z, 1.1), can = sm(.92, .985, ridged(x, y, z, 5, 3.6, 111));
  ramp(o, [[-.6, C['5e4a44']], [0, C['8a6e64']], [.5, C.b09a90]], n + cr.rim * .2); mixTo(o, C['2a2228'], can * .7); // Messina Chasma and the rest: canyons cut deep into the dusty ice
  const urb = sm(.4, .7, fbm(x, y, z, 4, 6, 112)); mixTo(o, C['6a6a74'], urb * .5); mixTo(o, C['3a5a3a'], sm(.5, .8, fbm(x, y, z, 3, 9, 113)) * .25); // cities and farm domes
  o.h = n * .3 + cr.rim * .15 - can * .5; lights(o, x, y, z, i, j, .3 + urb * .9 + can * .4, C.ffe0b0, 1.1); } };
W_.oberon = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 3.6, 114), cr = craters(x, y, z, 1.2);
  ramp(o, [[-.6, C['4a2e2a']], [0, C['7a5048']], [.5, C.a07868]], n + cr.rim * .25); mixTo(o, C['1a1416'], cr.bowl * .5); mixTo(o, C.e8e0e0, sm(.6, .9, fbm(x, y, z, 3, 8, 115)) * cr.rim * .4); // dark-floored craters, bright ejecta
  o.h = n * .3 + cr.rim * .2 - cr.bowl * .35; lights(o, x, y, z, i, j, .15 + .4 * sm(.4, .7, fbm(x, y, z, 3, 5, 116)), C.ffc890, .8); } };
W_.nereid = { px(o, lat, lon, x, y, z) { const n = fbm(x, y, z, 5, 5, 117), cr = craters(x, y, z, 1.8); ramp(o, [[-.6, C['6a7078']], [0, C['9aa0a8']], [.5, C.c4c8cc]], n + cr.rim * .3); o.h = n * .3 + cr.rim * .2 - cr.bowl * .3; } };
W_.charon = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 3.4, 118), cr = craters(x, y, z, 1.1), mordor = sm(62, 80, lat + n * 6);
  ramp(o, [[-.6, C['6e6868']], [0, C['9a9494']], [.5, C.c4bebe]], n + cr.rim * .2); mixTo(o, C['4a2e24'], mordor * .8); // Mordor Macula: the red cap
  mixTo(o, C['2e2c30'], sm(.9, .98, ridged(x, y, z, 4, 5, 119)) * .5); mixTo(o, C.e0dcdc, sm(.3, .6, fbm(x, y, z, 3, 7, 120)) * sm(-30, 10, lat) * .3); // the chasms; Vulcan Planum's smooth plains
  o.h = n * .3 + cr.rim * .15 - cr.bowl * .3; lights(o, x, y, z, i, j, .06 + .4 * spot(x, y, z, vec(-10, 20), 5), C.ffc890, .6); } };
W_.haumea = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 4, 121), cr = craters(x, y, z, 1.2); // crystalline ice, streaked by the spin; a dark red spot
  ramp(o, [[-.6, C.c8ccd4], [0, C.e4e8ee], [.5, C.f8fafc]], n * .6 + cr.rim * .15); mixTo(o, C.a8b0c0, sm(.3, .7, Math.sin(lon * D * 24 + fbm(x, y, z, 3, 6, 122) * 3) * .5 + .5) * sm(50, 20, Math.abs(lat)) * .25);
  mixTo(o, C['6a3a30'], sm(.4, .9, spot(x, y, z, vec(10, 60), 14)) * .6); o.h = n * .25 + cr.rim * .15; lights(o, x, y, z, i, j, .08 + .5 * spot(x, y, z, vec(-20, -120), 6), C.ffb080, .7); } };
W_.makemake = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 3.6, 123), cr = craters(x, y, z, 1.2);
  ramp(o, [[-.6, C['6e3a2a']], [0, C.a05a40], [.5, C.c88a68]], n + cr.rim * .2); mixTo(o, C.f0e8e0, sm(.6, .9, fbm(x, y, z, 4, 9, 124)) * .4); mixTo(o, C['2e1a16'], sm(.5, .85, fbm(x, y, z, 3, 5, 125)) * .4); // methane frost over the tholins; dark stains
  o.h = n * .3 + cr.rim * .15 - cr.bowl * .3; lights(o, x, y, z, i, j, .1 + .7 * spot(x, y, z, vec(15, 30), 7), C.ffb080, .8); } }; // the old domes, the raiders' long halls
W_.arrokoth = { px(o, lat, lon, x, y, z) { const n = fbm(x, y, z, 5, 6, 126), cr = craters(x, y, z, 2.4), neck = sm(8, 2, Math.abs(lat)); ramp(o, [[-.6, C['5e3a2e']], [0, C['8a5a48']], [.5, C.b08070]], n + cr.rim * .3); mixTo(o, C['2e1e1a'], neck * .7); mixTo(o, C.d0b0a0, sm(.7, .95, spot(x, y, z, vec(60, 0), 30)) * .3); o.h = n * .3 - neck * .6; } }; // two lobes and the dark neck between
W_.eris = { night: 1, px(o, lat, lon, x, y, z, i, j) { const n = fbm(x, y, z, 5, 3.4, 127), cr = craters(x, y, z, 1.1), fort = Math.max(spot(x, y, z, ER_F1, 7), spot(x, y, z, ER_F2, 5), spot(x, y, z, ER_F3, 5));
  ramp(o, [[-.6, C.c4cad4], [0, C.e0e4ea], [.5, C.f4f6f8]], n * .7 + cr.rim * .15); mixTo(o, C['8a9aac'], sm(.4, .8, fbm(x, y, z, 4, 8, 128)) * .3); // methane frost, the brightest world in the dark
  mixTo(o, C['2a2e3a'], sm(.3, .8, fort) * .7); mixTo(o, C['4a3a30'], sm(.9, .98, ridged(x, y, z, 4, 7, 129)) * .4); // the ice fortresses, black on the frost; dark fracture lines
  o.h = n * .25 + cr.rim * .15 + fort * .3; lights(o, x, y, z, i, j, .06 + fort * 1.3, C.ff9a60, 1.1); } }; // the raiders' fires burn red
const ER_F1 = vec(20, 10), ER_F2 = vec(-15, 60), ER_F3 = vec(5, -70);

// gas giants: latitude bands bent by turbulence
function bands(o, lat, x, y, z, pal, turb, sd, nb = 1) { // zonal bands: a palette walked by latitude, warped by eddies
  // eddies stretched along the longitudes, from belt-wide waves down to fine filaments, each warping the next
  const w = fbm(x, y, z * 3, 4, 2.5, sd) * turb, e = fbm(x * 2 + w * .3, y * 2, z * 12, 4, 5, sd + 1) * turb * .6;
  const f2 = fbm(x * 4 + e * .5, y * 4, z * 30, 4, 8, sd + 3) * turb * .45, f3 = fbm(x * 9 + f2, y * 9, z * 70, 3, 10, sd + 4) * turb * .3;
  const k = ((lat + 90) / 180 + (w * .55 + e + f2 * .8 + f3 * .45) * .015) * pal.length * nb, i0 = Math.floor(k), f = k - i0, n = pal.length;
  const a = pal[((i0 % n) + n) % n], b = pal[(((i0 + 1) % n) + n) % n], t = sm(.22, .78, f);
  o.r = a[0] + (b[0] - a[0]) * t; o.g = a[1] + (b[1] - a[1]) * t; o.b = a[2] + (b[2] - a[2]) * t;
  const v = 1 + fbm(x, y, z * 4, 3, 14, sd + 2) * .07 * Math.min(1, turb) + e * .05 + f3 * .1 * Math.min(1, turb); o.r *= v; o.g *= v; o.b *= v; // the quiet giants stay smooth
  const fest = sm(.55, .8, fbm(x * 3 + f2, y * 3, z * 40, 3, 6, sd + 5) * .5 + .5) * sm(.3, 0, Math.abs(f - .5)); mixTo(o, a, fest * .35); // festoons trailing across the band edges
}
const JUP = ['d8c8b0', 'c09a70', 'e8dcc4', 'b07850', 'f0e4cc', 'a8704a', 'e4d4b4', 'c8946a', 'f4ead4', 'b47c54', 'ecdcc0', 'a06844', 'e0ccaa', 'c49468', 'f0e2c8', 'b88a60', 'd8c4a4', 'c0a080'].map(h => hexc('#' + h));
W_.jupiter = { px(o, lat, lon, x, y, z) {
  bands(o, lat, x, y, z, JUP, 1.6, 30, 2);
  // the Great Red Spot: an oval storm, wider than tall, its bands spiralling into a pale core, a white collar round it
  const dla = (lat + 22) / 5.5, dlo = ((lon - 40 + 540) % 360 - 180) / 10, rr = Math.hypot(dla, dlo);
  if (rr < 1.6) { const ang = Math.atan2(dla, dlo) + rr * 2.6, sw = sm(-.8, .8, Math.sin(ang * 2 + fbm(x, y, z, 3, 20, 31) * 1.5 + rr * 4)), grs = sm(1.15, .55, rr);
    mixTo(o, C.f0e6d4, sm(1.6, 1.2, rr) * sm(.95, 1.2, rr) * .55);
    const cA = C.b44a30, cB = C.d07a58, c = [cA[0] + (cB[0] - cA[0]) * sw, cA[1] + (cB[1] - cA[1]) * sw, cA[2] + (cB[2] - cA[2]) * sw]; mixTo(o, c, grs * .85); mixTo(o, C.e0a88a, sm(.35, 0, rr) * .6); }
  for (const c of JUP_OVALS) mixTo(o, C.f4f0e8, sm(.4, .9, spot(x, y, z, c, 1.8)) * .8);
} };
const JUP_GRS = vec(-22, 40), JUP_OVALS = [vec(-33, 60), vec(-33, 90), vec(-33, 120), vec(40, -60)];
const SAT = ['e0d0a8', 'd4c090', 'eadcb4', 'c8b080', 'e4d4ac', 'd8c49a', 'f0e4c0', 'ccb688', 'e6d8b0', 'd0bc90', 'eadab2', 'c4ac80'].map(h => hexc('#' + h));
W_.saturn = { px(o, lat, lon, x, y, z) {
  bands(o, lat, x, y, z, SAT, 1, 40, 2);
  if (lat > 74) { const a = Math.atan2(y, x), hx = Math.cos(Math.PI / 6) / Math.cos(((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6), r = (90 - lat) / 16; // the hexagon
    if (r < hx) mixTo(o, C['8a9aa0'], .45 * sm(hx, hx - .15, r)); if (Math.abs(r - hx) < .04) mixTo(o, C.c8b890, .6); }
} };
W_.uranus = { px(o, lat, lon, x, y, z) { bands(o, lat, x, y, z, ['a8dce4', 'a0d6e0', 'aee0e8', '9cd2dc', 'b0e2ea', 'a4d8e2'].map(h => hexc('#' + h)), .3, 50); mixTo(o, C.c8eef0, sm(60, 85, lat) * .5); mixTo(o, C.e4f6f8, sm(.6, .9, fbm(x * 1, y * 1, z * 10, 3, 5, 71)) * sm(45, 25, Math.abs(lat)) * .25); } }; // the bright methane cirrus of the mid-latitudes
W_.neptune = { px(o, lat, lon, x, y, z) {
  bands(o, lat, x, y, z, ['3a58c8', '3450b8', '4262d0', '2e48a8', '4a6ad6', '3654bc'].map(h => hexc('#' + h)), 1.4, 60);
  mixTo(o, C['1a2a70'], sm(.3, .9, spot(x, y, z, NEP_GDS, 9)) * .8);
  const c = fbm(x * 1, y * 1, z * 8, 3, 6, 61); mixTo(o, C.e8f0ff, sm(.45, .7, c) * sm(45, 20, Math.abs(lat + 25)) * .8);
} };
const NEP_GDS = vec(-22, 30);

// ---------------------------------------------------------------- craters
// a field of impact craters for the airless and the old: a bowl, a raised rim, a bright splash of ejecta on the young ones.
// Deterministic per world; the big ones are few, the small ones many. Returns {dh, shade, bright} for a point.
const CRATERS = {};
function craterField(id, n) {
  if (CRATERS[id]) return CRATERS[id]; let s = [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const L = []; for (let i = 0; i < n; i++) { const u = R() * 2 - 1, th = R() * Math.PI * 2, r = Math.sqrt(1 - u * u); const size = .4 + 7 * Math.pow(R(), 3.2); L.push({ c: [r * Math.cos(th), r * Math.sin(th), u], r: size, k: 1 - Math.cos(size * D), young: R() < .18, depth: .5 + R() * .7 }); }
  return CRATERS[id] = L;
}
function impacts(o, x, y, z, L, strength = 1) { let dh = 0, shade = 0, bright = 0;
  for (const c of L) { const d = 1 - (x * c.c[0] + y * c.c[1] + z * c.c[2]); if (d > c.k * 2.6) continue; const t = Math.sqrt(d / c.k); // 0 at the centre, 1 at the rim
    if (t < 1) { const bowl = (t * t - 1) * c.depth, rim = sm(.72, 1, t) * .5; dh += (bowl + rim) * c.r * .06; shade += (t < .85 ? -.35 * (1 - t) : .25) * strength; }
    else if (t < 1.25) { dh += (1.25 - t) / .25 * .5 * c.r * .06; shade += .18 * (1.25 - t) / .25 * strength; }
    else if (c.young && t < 1.6) bright += (1.6 - t) / .35 * .35 * strength; }
  o.h = (o.h === undefined ? 0 : o.h) + dh; const m = 1 + shade * .35 + bright * .5; o.r *= m; o.g *= m; o.b *= m;
  return o;
}
const STORMY = new Set(['europa', 'venus', 'titan']);
const CRATERED = { luna: 140, callisto: 160, rhea: 120, iapetus: 110, ceres: 90, phobos: 60, thebe: 70, pluto: 80, triton: 40, mercury: 0, io: 0, vesta: 110, pallas: 120, hygiea: 90, hildas: 60, marcher: 50, amalthea: 60, kalyke: 40, mimas: 100, tethys: 90, dione: 80, hyperion: 60, miranda: 70, ariel: 60, umbriel: 110, titania: 90, oberon: 130, nereid: 60, charon: 90, haumea: 50, makemake: 70, arrokoth: 30, eris: 60 };

// ---------------------------------------------------------------- the sea up close
// open water is never one blue: currents and plankton blooms shift it, shoals pale toward the coast, and a stormy world
// shows the fronts of its weather as streaks of whitecaps
function sea(o, x, y, z, lat, sd, stormy) {
  const cur = fbm(x, y, z, 4, 7, sd + 8), bloom = sm(.35, .7, fbm(x, y, z, 3, 16, sd + 9));
  const m = 1 + cur * .14; o.r *= m; o.g *= m; o.b *= m; mixTo(o, [o.r * .9 + 20, o.g * .95 + 30, o.b * .9], bloom * .25);
  if (stormy) { const fr = sm(.7, .95, Math.abs(fbm(x * 2, y * 2, z, 4, 9, sd + 10))), chop = fbm(x, y, z, 3, 60, sd + 11) * .5 + .5; mixTo(o, C.e8f0f4, fr * chop * .55); }
}

// ---------------------------------------------------------------- the ground up close
// Every solid world's land goes through this after its own painter: ridged striations and fine broken ground in the
// colour and in the height, uplands greying toward bare rock and the highest ground to snow, a little less saturation
// and a little more contrast. This is what keeps a terraformed world from reading as smooth coloured clay.
function terrain(o, x, y, z, h, lat, sd, W) {
  const r1 = ridged(x, y, z, 3, 26, sd + 5), r2 = fbm(x, y, z, 3, 64, sd + 6), r3 = W >= 1000 ? fbm(x, y, z, 2, 150, sd + 7) : 0;
  const white = sm(190, 236, Math.min(o.r, o.g, o.b)), ground = 1 - white; // ice and snow keep their own look
  const rough = ((r1 - .5) * .26 + r2 * .12 + r3 * .07) * ground;
  h += ((r1 - .5) * .1 + r2 * .04 + r3 * .015) * ground;
  // uplands: the colour drains toward rock the higher the ground; above that, snow where the world has air
  const up = sm(.45, 1.05, h) * ground, L = o.r * .3 + o.g * .59 + o.b * .11;
  const rock = [L * .62 + 38 + r1 * 12, L * .6 + 36 + r1 * 10, L * .58 + 34 + r1 * 8];
  mixTo(o, rock, up * .6); mixTo(o, C.e8ecf0, sm(1.1, 1.5, h + Math.abs(lat) * .004) * ground * .9);
  const m = 1 + rough; o.r *= m; o.g *= m; o.b *= m;
  const L2 = o.r * .3 + o.g * .59 + o.b * .11; o.r = 118 + (L2 + (o.r - L2) * .84 - 118) * 1.1; o.g = 118 + (L2 + (o.g - L2) * .84 - 118) * 1.1; o.b = 118 + (L2 + (o.b - L2) * .84 - 118) * 1.1;
  return h;
}

// ---------------------------------------------------------------- driver
const CLOUDY = {};
const GAS = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);
export function generate(id, W = 1024) {
  XO = W >= 3000 ? 3 : W >= 1800 ? 2 : W >= 1000 ? 1 : 0;
  const w = W_[id] || W_.thebe, H = W / 2, day = new Uint8Array(W * H * 4), night = w.night ? new Uint8Array(W * H * 4) : null;
  const gas = GAS.has(id), hgt = gas ? null : new Uint8Array(W * H), sdh = [...id].reduce((a, ch) => a + ch.charCodeAt(0) * 13, 0) % 89;
  const ctx = Object.assign({ W, H }, w.pre ? w.pre(W, H) : {}), o = { r: 0, g: 0, b: 0, sea: 0, lr: 0, lg: 0, lb: 0 }, crat = CRATERED[id] ? craterField(id, CRATERED[id] + (W >= 1800 ? 120 : 0)) : null;
  for (let j = 0; j < H; j++) {
    const lat = 90 - (j + .5) / H * 180, cl = Math.cos(lat * D), sl = Math.sin(lat * D), row = (H - 1 - j) * W;
    for (let i = 0; i < W; i++) {
      const lon = (i + .5) / W * 360 - 180, x = cl * Math.cos(lon * D), y = cl * Math.sin(lon * D), z = sl;
      o.r = o.g = o.b = 128; o.sea = 0; o.lr = o.lg = o.lb = 0; o.h = undefined;
      w.px(o, lat, lon, x, y, z, i, j, ctx); if (w.post) w.post(o, lat, lon);
      if (crat && !o.sea) impacts(o, x, y, z, crat, w.craterK || 1);
      if (hgt) { // elevation for the relief: the world's own where it gives one, else ranges and hills; the seas lie flat
        let h = o.h; if (h === undefined) h = ridged(x, y, z, 4, 5, sdh) * .6 + fbm(x, y, z, 4, 11, sdh + 1) * .35;
        if (o.sea) { h = Math.min(h, 0) - .05; if (o.sea >= 1) sea(o, x, y, z, lat, sdh, STORMY.has(id)); }
        else h = terrain(o, x, y, z, h, lat, sdh, W); // the ground itself: broken, striated, greyer with height, never smooth clay
        hgt[row + i] = cl01(.35 + h * .45) * 255;
      }
      const k = (row + i) * 4;
      day[k] = o.r < 0 ? 0 : o.r > 255 ? 255 : o.r; day[k + 1] = o.g < 0 ? 0 : o.g > 255 ? 255 : o.g; day[k + 2] = o.b < 0 ? 0 : o.b > 255 ? 255 : o.b; day[k + 3] = o.sea * 255;
      if (night) { night[k] = Math.min(255, o.lr); night[k + 1] = Math.min(255, o.lg); night[k + 2] = Math.min(255, o.lb); night[k + 3] = 255; }
    }
  }
  if (hgt) { // ambient occlusion from the height field: low ground between rises sits in shadow, ridges catch the sky
    const rad = Math.max(2, W >> 8); for (let j = rad; j < H - rad; j++) for (let i = 0; i < W; i++) { const k = j * W + i, h0 = hgt[k]; let occ = 0;
      occ += hgt[k - rad * W] + hgt[k + rad * W] + hgt[j * W + ((i + rad) % W)] + hgt[j * W + ((i - rad + W) % W)]; occ = (occ * .25 - h0) / 255; // positive: neighbours are higher
      const m = 1 - cl01(occ * 2.4) * .3 + cl01(-occ * 2.4) * .08, q = k * 4; day[q] = Math.min(255, day[q] * m); day[q + 1] = Math.min(255, day[q + 1] * m); day[q + 2] = Math.min(255, day[q + 2] * m); } }
  let clouds = null, cW = 0, cH = 0;
  if (w.clouds) { // a cloud deck: domain-warped noise, streaked along the latitudes, thinner over the poles unless asked
    const c = w.clouds, sd = [...id].reduce((a, ch) => a + ch.charCodeAt(0) * 7, 0) % 97; cW = W >= 1000 ? W : W / 2; cH = cW / 2; clouds = new Uint8Array(cW * cH * 4);
    const storms = []; { let ss = sd * 7919 + 17; const R = () => ((ss = (ss * 1664525 + 1013904223) >>> 0) / 4294967296); for (let k = 0; k < 7; k++) { const la = (R() * 2 - 1) * 55, lo = R() * 360 - 180; storms.push({ c: vec(la, lo), r: 7 + R() * 9, s: la > 0 ? 1 : -1 }); } } // cyclones, spinning with their hemisphere
    for (let j = 0; j < cH; j++) {
      const lat = 90 - (j + .5) / cH * 180, cl = Math.cos(lat * D), sl = Math.sin(lat * D), row = (cH - 1 - j) * cW;
      for (let i = 0; i < cW; i++) {
        const lon = (i + .5) / cW * 360 - 180, x = cl * Math.cos(lon * D), y = cl * Math.sin(lon * D), z = sl;
        const wx = fbm(x, y, z, 3, 2, 70 + sd) * c.warp, wy = fbm(x, y, z, 3, 2, 71 + sd) * c.warp;
        let v = fbm(x + wx, y + wy, z * 2.2, 5, c.scale, 72 + sd) * .5 + .5;
        for (const st of storms) { const d = 1 - (x * st.c[0] + y * st.c[1] + z * st.c[2]), kk = 1 - Math.cos(st.r * D); if (d > kk) continue; const t = Math.sqrt(d / kk), ang = Math.atan2(y - st.c[1], x - st.c[0]); // spiral arms round an eye
          const arm = .5 + .5 * Math.sin(ang * 3 * st.s + t * 9 + fbm(x, y, z, 2, 30, sd) * 2); v = v * (1 - sm(1, .6, t) * .5) + (sm(1, .22, t) * (.25 + .5 * arm) + sm(.22, .07, t) * .5) * .45 * sm(.04, .1, t); }
        v = v * (.92 + .08 * fbm(x, y, z, 2, 40, 73 + sd)); // a fine grain in the deck
        const bandK = c.polar ? sm(40, 80, Math.abs(lat)) * .5 : (.15 * Math.cos(lat * D * 6) - sm(70, 90, Math.abs(lat)) * .2);
        v = sm(1 - c.cover, 1 - c.cover + .42, v + bandK); v *= .55 + .45 * (fbm(x + wx * .5, y, z * 2.2, 4, c.scale * 4.5, 74 + sd) * .5 + .5); v *= .75 + .35 * (fbm(x, y + wy * .3, z * 2.2, 3, c.scale * 14, 75 + sd) * .5 + .5); // thinner, with structure inside each deck: towers and streets of cumulus, not cotton
        const k = (row + i) * 4; clouds[k] = c.col[0]; clouds[k + 1] = c.col[1]; clouds[k + 2] = c.col[2]; clouds[k + 3] = v * (c.max || 1) * 255;
      }
    }
  }
  return { W, H, day, night, cW, cH, clouds, hgt };
}
// a quick first pass for everything, then sharper maps for the worlds you will see up close
export const HI = { mercury: 1536, venus: 1536, earth: 1536, mars: 1536, luna: 1536, jupiter: 1536, saturn: 1536, io: 1024, europa: 1024, ganymede: 1024, callisto: 1024, titan: 1024, uranus: 1024, neptune: 1024, triton: 1024, rhea: 1024, pluto: 1024, ceres: 1024, iapetus: 1024, enceladus: 1024, thebe: 512, phobos: 512,
  vesta: 1024, pallas: 1024, hygiea: 1024, hildas: 512, marcher: 512, amalthea: 512, kalyke: 512, mimas: 1024, tethys: 1024, dione: 1024, hyperion: 512, miranda: 1024, ariel: 1024, umbriel: 1024, titania: 1024, oberon: 1024, nereid: 512, charon: 1024, haumea: 1024, makemake: 1024, arrokoth: 512, eris: 1024 };
// worker entry: { id, W } → the generated maps, transferred
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = e => { const { id, W } = e.data; const r = generate(id, W); const t = [r.day.buffer]; if (r.night) t.push(r.night.buffer); if (r.hgt) t.push(r.hgt.buffer); if (r.clouds) t.push(r.clouds.buffer); self.postMessage({ id, ...r }, t); };
}
