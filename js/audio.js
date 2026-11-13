// Iron Rain sound: every effect, the score and the ambience, synthesised live with Web Audio. No sample files.
//
// The mix:   voices ─▶ pan/distance ─▶ effects bus ─▶ duck ─▶ "hull" filter ─┐
//            reverb sends (hull resonance in space, open field on the ground) ┤
//            interface + comms ──────────────────────────────────────────────┼─▶ master ─▶ glue compressor ─▶ limiter
//            score (own hall reverb, ducked under big blasts) ───────────────┤
//            ambience (bridge hum in space; wind and the far battle below) ──┘
//
// Space is a vacuum, so by default the space battle is heard as the crew would hear it: through the hull, heavy and
// low, the ship's own frame ringing when her broadside fires ("Through the hull"). "Cinematic" opens the filter.
// On the ground the air matters: an airless moon is heard through the suit; a thick world carries wind and echo.
//
// API (unchanged for callers): initAudio(), sfx(kind, x, y, size), music(level), audio.{muted}.
// New: audio.vol.{master,sfx,music,amb,ui}, audio.space ('hull'|'cinematic'), saveAudio(), preview(kind),
//      previewMusic(cue), setGroundWorld(name), renderOffline(...) for the tests.
import { project } from './cam.js';
import { S } from './state.js';
import { clamp } from './util.js';

// ---------------------------------------------------------------- settings, kept per browser
const KEY = 'ironrain.audio';
export const audio = { muted: false, space: 'hull', vol: { master: .8, sfx: 1, music: .55, amb: .7, ui: .8 }, preview: null };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { audio.muted = !!s.muted; if (s.space) audio.space = s.space; Object.assign(audio.vol, s.vol || {}); } } catch (e) { /* private mode */ }
export function saveAudio() { try { localStorage.setItem(KEY, JSON.stringify({ muted: audio.muted, space: audio.space, vol: audio.vol })); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- the sound kinds
// gap: least seconds between two of the kind (a louder one may cut in); bus: where it goes; wet: reverb send;
// act: how much it stirs the battle (the score and the far din follow it); pri 2: never dropped by the voice cap;
// far: space falloff, px off screen; reach: ground falloff, metres; late: arrives late with distance (sound in air).
const DEF = {
  rail:    { gap: .045, g: 1.6,  wet: .18, act: .3,  reach: 1400 },
  lance:   { gap: .07,  g: 1,   wet: .35, act: .8,  reach: 2600, far: 900, duck: .12 },
  pd:      { gap: .09,  g: 2.1, wet: .06, act: .05, reach: 900 },
  cannon:  { gap: .06,  g: 2.6,  wet: .12, act: .15, reach: 1600 },
  missile: { gap: .08,  g: 2, wet: .22, act: .25, reach: 1600 },
  hit:     { gap: .05,  g: 1.55,  wet: .2,  act: .2,  reach: 1300 },
  shhit:   { gap: .05,  g: 1.5,  wet: .3,  act: .15, reach: 1300 },
  shdown:  { gap: .1,   g: 1.6, wet: .35, act: .5,  reach: 2000, far: 800 },
  boom:    { gap: .06,  g: 1,   wet: .35, act: .8,  reach: 2600, far: 900, late: 1, duck: .15 },
  throes:  { gap: .2,   g: 1,   wet: .45, act: 1.2, reach: 3000, far: 1200, late: 1, duck: .2, pri: 2 },
  bigboom: { gap: .15,  g: 1,   wet: .5,  act: 3,   reach: 4500, far: 1800, late: 1, duck: .45, pri: 2 },
  nuke:    { gap: .3,   g: 1,   wet: .6,  act: 10,  reach: 12000, far: 3000, late: 1, duck: .85, pri: 2, hi: 1 },
  emp:     { gap: .2,   g: 2.1, wet: .4,  act: 1,   reach: 2500, far: 1000 },
  clang:   { gap: .08,  g: 1.75,  wet: .25, act: .2,  reach: 900 },
  melee:   { gap: .05,  g: 1.45,  wet: .2,  act: .12, reach: 700 },
  capture: { gap: .5,   g: 0.72,  bus: 'ui', pri: 2 },
  alarm:   { gap: .9,   g: 2.5,  bus: 'ui', pri: 2 },
  sel:     { gap: .04,  g: 8.7,  bus: 'ui', pri: 2 },
  ack:     { gap: .05,  g: 5.7,  bus: 'ui', pri: 2 },
  click:   { gap: .03,  g: 10.7,  bus: 'ui', pri: 2 },
  built:   { gap: .15,  g: 1.9,  bus: 'ui', pri: 2 },
  deny:    { gap: .15,  g: 2.35,  bus: 'ui', pri: 2 },
  radio:   { gap: .6,   g: 3.4,  bus: 'comms', pri: 2 },
  victory: { gap: 2,    g: .9,  bus: 'ui', pri: 2, mduck: .8 },
  defeat:  { gap: 2,    g: .9,  bus: 'ui', pri: 2, mduck: .8 },
  // the ground war
  scorch:  { gap: .035, g: 3.3, wet: .3,  act: .1,  reach: 800 },
  pulse:   { gap: .06,  g: 1.6,  wet: .3,  act: .25, reach: 1100 },
  plasma:  { gap: .05,  g: 5,  wet: .28, act: .15, reach: 1000 },
  heavy:   { gap: .08,  g: .9,  wet: .45, act: .5,  reach: 2600, late: 1 },
  sarissa: { gap: .1,   g: 1.85,  wet: .3,  act: .25, reach: 1600 },
};
export const SOUND_KINDS = Object.keys(DEF);
const MAXV = 44;

// ---------------------------------------------------------------- small tools
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ST = s => Math.pow(2, s / 12); // semitones to a ratio
const E0 = 1e-4;
function env(p, t, peak, a, h, d) {
  peak = Math.max(peak, E0 * 2); a = Math.max(a || .002, .001); h = h || 0;
  p.setValueAtTime(E0, t); p.exponentialRampToValueAtTime(peak, t + a); if (h) p.setValueAtTime(peak, t + a + h);
  p.exponentialRampToValueAtTime(E0, t + a + h + d); return t + a + h + d;
}
// a filter after a source: ft type, ff frequency (swept to ff1 by the end), q
function filt(E, src, t, T, o) {
  if (!o.ft) return src; const f = E.ctx.createBiquadFilter(); f.type = o.ft; f.frequency.setValueAtTime(o.ff, t);
  if (o.ff1) f.frequency.exponentialRampToValueAtTime(o.ff1, T); if (o.q) f.Q.value = o.q; src.connect(f); return f;
}
// noise: buf white|pink|brown, rate (pitch), g peak, a attack, h hold, d decay
function nz(E, out, t, o) {
  const c = E.ctx, s = c.createBufferSource(); s.buffer = E.buf[o.buf || 'white']; s.loop = true; s.playbackRate.value = o.rate || 1;
  const T = t + (o.a || .002) + (o.h || 0) + o.d, g = c.createGain(); filt(E, s, t, T, o).connect(g); g.connect(out);
  env(g.gain, t, o.g, o.a, o.h, o.d); s.start(t, E.r() * 2); s.stop(T + .03); return T;
}
// oscillator: type, f swept to f1 (over glide, or the whole note), g, a, h, d, det (cents)
function os(E, out, t, o) {
  const c = E.ctx, s = c.createOscillator(); s.type = o.type || 'sine'; const T = t + (o.a || .002) + (o.h || 0) + o.d;
  s.frequency.setValueAtTime(o.f, t); if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, o.glide ? t + o.glide : T); if (o.det) s.detune.value = o.det;
  const g = c.createGain(); filt(E, s, t, T, o).connect(g); g.connect(out); env(g.gain, t, o.g, o.a, o.h, o.d); s.start(t); s.stop(T + .03); return T;
}
// FM pair: carrier f→f1, modulator at r × carrier, index i→i1. Bells, zings, energy.
function fm(E, out, t, o) {
  const c = E.ctx, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), T = t + (o.a || .002) + (o.h || 0) + o.d;
  car.type = o.type || 'sine'; car.frequency.setValueAtTime(o.f, t); mod.frequency.setValueAtTime(o.f * o.r, t);
  if (o.f1) { car.frequency.exponentialRampToValueAtTime(o.f1, T); mod.frequency.exponentialRampToValueAtTime(o.f1 * o.r, T); }
  mg.gain.setValueAtTime(o.i * o.f, t); mg.gain.exponentialRampToValueAtTime(Math.max(.5, (o.i1 != null ? o.i1 : o.i * .1) * (o.f1 || o.f)), T);
  mod.connect(mg); mg.connect(car.frequency); const g = c.createGain(); filt(E, car, t, T, o).connect(g); g.connect(out);
  env(g.gain, t, o.g, o.a, o.h, o.d); car.start(t); mod.start(t); car.stop(T + .03); mod.stop(T + .03); return T;
}
// struck metal: a few inharmonic partials, each with its own decay
function modal(E, out, t, f0, ratios, decays, g) {
  let T = t; ratios.forEach((r, i) => { T = Math.max(T, os(E, out, t, { f: f0 * r * (1 + (E.r() - .5) * .012), g: g / (1 + i * .5), a: .0015, d: decays[i] })); }); return T;
}
// grit: n tiny bursts scattered over span seconds, thick at the start
function grains(E, out, t, n, span, f, g, q) {
  let T = t; for (let i = 0; i < n; i++) { const at = t + Math.pow(E.r(), 1.8) * span; T = Math.max(T, nz(E, out, at, { ft: 'bandpass', ff: f * (.6 + E.r() * .9), q: q || 1.4, g: g * (.4 + E.r() * .6), a: .001, d: .01 + E.r() * .05 })); } return T;
}
const curves = {};
function drv(E, out, k) { // soft clipping, for weight
  const ws = E.ctx.createWaveShaper(); if (!curves[k]) { const n = 1024, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * k) / Math.tanh(k); } curves[k] = cv; }
  ws.curve = curves[k]; ws.oversample = '2x'; ws.connect(out); return ws;
}

// ---------------------------------------------------------------- the engine: buffers, buses, reverbs
function noiseBuffers(c, r) {
  const n = Math.floor(c.sampleRate * 3), mk = () => c.createBuffer(1, n, c.sampleRate);
  const W = mk(), P = mk(), B = mk(), w = W.getChannelData(0), p = P.getChannelData(0), b = B.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1; w[i] = x;
    b0 = .99886 * b0 + x * .0555179; b1 = .99332 * b1 + x * .0750759; b2 = .969 * b2 + x * .153852; b3 = .8665 * b3 + x * .3104856; b4 = .55 * b4 + x * .5329522; b5 = -.7616 * b5 - x * .016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * .5362) * .11; b6 = x * .115926;
    br = (br + .02 * x) / 1.02; b[i] = br * 3.5;
  }
  return { white: W, pink: P, brown: B };
}
// impulse responses, made rather than recorded: dur, decay shape, how fast the tail darkens, early echoes, ringing modes
function makeIR(c, r, o) {
  const sr = c.sampleRate, n = Math.floor(sr * o.dur), B = c.createBuffer(2, n, sr), pre = Math.floor((o.pre || 0) * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = B.getChannelData(ch); let y = 0;
    for (let i = pre; i < n; i++) {
      const k = (i - pre) / (n - pre), x = (r() * 2 - 1) * Math.pow(1 - k, o.decay), a = .15 + .8 * Math.pow(k, .6) * o.dark; y += (x - y) * (1 - a); d[i] = y;
    }
    for (const [tm, g] of o.early || []) { const at = pre + Math.floor((tm + ch * .007) * sr); for (let j = 0; j < 90 && at + j < n; j++) d[at + j] += g * (r() * 2 - 1) * Math.exp(-j / 18); }
    for (const [f, tau, g] of o.modes || []) { const ph = r() * 6.28; for (let i = 0; i < n; i++) { const t = i / sr; d[i] += g * Math.sin(6.2832 * f * t + ph) * Math.exp(-t / tau) * Math.min(1, t * 200); } }
  }
  return B;
}
function buildEngine(c, opt = {}) {
  const r = mulberry(opt.seed || (Date.now() & 0xffffff)), E = { ctx: c, r, last: {}, voices: [], act: 0, actT: 0, scene: opt.scene || 'space', air: 1, live: !opt.offline };
  E.buf = noiseBuffers(c, r);
  const G = v => { const g = c.createGain(); g.gain.value = v; return g; };
  // master: glue, then a hard ceiling
  E.master = G(audio.vol.master);
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = .008; comp.release.value = .25;
  const lim = c.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .12;
  const trim = G(.92); E.master.connect(comp); comp.connect(lim); lim.connect(trim); trim.connect(c.destination);
  // effects: duck ─▶ hull lowpass ─▶ low shelf ─▶ sfx volume
  E.sfxIn = G(1); E.duck = G(1); E.hi = G(1); E.hullLP = c.createBiquadFilter(); E.hullLP.type = 'lowpass'; E.hullLP.Q.value = .4; E.hullLP.frequency.value = 20000;
  E.shelf = c.createBiquadFilter(); E.shelf.type = 'lowshelf'; E.shelf.frequency.value = 160; E.shelf.gain.value = 0; E.sfxOut = G(audio.vol.sfx);
  E.sfxIn.connect(E.duck); E.duck.connect(E.hullLP); E.hi.connect(E.hullLP); E.hullLP.connect(E.shelf); E.shelf.connect(E.sfxOut); E.sfxOut.connect(E.master);
  // reverbs: the ship's frame in space; an open field with a city's walls on the ground
  E.revSpace = c.createConvolver(); E.revSpace.buffer = makeIR(c, r, { dur: 1.2, decay: 2.6, dark: .9, modes: [[61, .5, .05], [97, .45, .04], [143, .35, .035], [211, .3, .025], [318, .22, .02]] });
  E.revGround = c.createConvolver(); E.revGround.buffer = makeIR(c, r, { dur: 2.8, decay: 2.1, dark: .97, pre: .03, early: [[.07, .5], [.13, .35], [.21, .3], [.34, .22], [.52, .15]] });
  E.revSpace.connect(E.duck); E.revGround.connect(E.duck);
  // interface, and comms through a radio band
  E.ui = G(audio.vol.ui); E.ui.connect(E.master);
  E.comms = c.createBiquadFilter(); E.comms.type = 'bandpass'; E.comms.frequency.value = 1700; E.comms.Q.value = .8; E.comms.connect(drv(E, E.ui, 2.5));
  // score: duck ─▶ music volume, with its own hall
  E.musIn = G(1); E.musDuck = G(1); E.mus = G(audio.vol.music); E.musIn.connect(E.musDuck); E.musDuck.connect(E.mus); E.mus.connect(E.master);
  E.revMus = c.createConvolver(); E.revMus.buffer = makeIR(c, r, { dur: 3.6, decay: 2.4, dark: .85, pre: .02 }); E.revMus.connect(E.musDuck);
  // ambience: its own volume, and a lowpass for thin air
  E.ambIn = G(1); E.ambLP = c.createBiquadFilter(); E.ambLP.type = 'lowpass'; E.ambLP.frequency.value = 20000; E.amb = G(audio.vol.amb);
  E.ambIn.connect(E.ambLP); E.ambLP.connect(E.amb); E.amb.connect(E.master);
  E.mu = { cue: null, next: 0, n: 0, pad: null }; E.bed = {};
  applyScene(E, 0);
  return E;
}
// the scene sets the hull filter: through the hull in space (or open), open air on the ground (or the suit, airless)
function applyScene(E, tc) {
  const t = E.ctx.currentTime, set = (p, v) => tc ? p.setTargetAtTime(v, t, tc) : p.setValueAtTime(v, t);
  let lp = 20000, sh = 0;
  if (E.scene === 'space' && audio.space === 'hull') { lp = 2300; sh = 5; }
  if (E.scene === 'ground' && E.air < .15) { lp = 650; sh = 6; }
  else if (E.scene === 'ground') lp = 6000 + 14000 * E.air;
  set(E.hullLP.frequency, lp); set(E.shelf.gain, sh);
  set(E.ambLP.frequency, E.scene === 'ground' ? (E.air < .15 ? 500 : 4000 + 16000 * E.air) : 20000);
}
// a voice: its gain (the volume and a little variation), distance lowpass, pan, reverb send
function voice(E, D, o) {
  const c = E.ctx, g = c.createGain(); g.gain.value = o.gain; let n = g;
  if (o.lp && o.lp < 16000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = .5; g.connect(f); n = f; }
  if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); n.connect(p); n = p; }
  const bus = D.bus === 'ui' ? E.ui : D.bus === 'comms' ? E.comms : D.hi ? E.hi : E.sfxIn; n.connect(bus);
  if (D.wet && !D.bus) { const s = c.createGain(); s.gain.value = D.wet * (E.scene === 'ground' ? (E.air < .15 ? .25 : .6 + .5 * E.air) : 1); n.connect(s); s.connect(E.scene === 'ground' ? E.revGround : E.revSpace); }
  return g;
}
// big blasts press everything else down for a moment, the score too
function duck(E, depth, t, hold, rel, music = .7) {
  depth = clamp(depth, 0, .92); if (depth < .03) return;
  for (const [node, k] of [[E.duck, 1], [E.musDuck, music]]) {
    const p = node.gain; p.cancelScheduledValues(t); p.setTargetAtTime(1 - depth * k, t, .012); p.setTargetAtTime(1, t + hold, rel / 3);
  }
}

// ---------------------------------------------------------------- the recipes: (E, out, t, size, rnd) → end time
const R = {
  // light railgun: an electric crack, the round's zing away down the rail, the mount's thump, the breech clacking
  rail(E, o, t) {
    nz(E, o, t, { ft: 'highpass', ff: 3500, g: .5, a: .001, d: .025 });
    fm(E, o, t, { f: 2600 * (.85 + E.r() * .3), f1: 170, r: 1.41, i: 2, i1: .05, g: .2, a: .001, d: .13 });
    os(E, o, t, { f: 150, f1: 46, g: .55, a: .002, d: .15 });
    return Math.max(t + .2, modal(E, o, t + .01, 610 * (.9 + E.r() * .2), [1, 2.02, 3.1], [.06, .04, .03], .05));
  },
  // a capital's main battery: coil snap, the slam, the shell's long zing, and her own frame ringing like a bell
  lance(E, o, t) {
    os(E, o, t, { f: 420, f1: 2600, g: .07, a: .03, d: .01 });
    const s = t + .04, d = drv(E, o, 2.2);
    nz(E, o, s, { ft: 'bandpass', ff: 2200, q: .7, g: .9, a: .001, d: .06 });
    nz(E, d, s, { buf: 'brown', ft: 'lowpass', ff: 900, ff1: 110, g: 1, a: .004, d: .9 });
    os(E, d, s, { f: 72, f1: 27, g: .95, a: .003, d: .8 });
    fm(E, o, s, { f: 900, f1: 70, r: 2.01, i: 3, g: .14, a: .002, d: .5 });
    return Math.max(s + 1, modal(E, o, s, 57 * (.9 + E.r() * .2), [1, 1.6, 2.51, 3.46], [1.5, 1.1, .8, .6], .13));
  },
  // point defence: a short ripping burst of rounds
  pd(E, o, t) {
    const n = 3 + Math.floor(E.r() * 3); let T = t;
    for (let i = 0; i < n; i++) { const at = t + i * (.026 + E.r() * .008); nz(E, o, at, { ft: 'bandpass', ff: 1800 * (.8 + E.r() * .4), q: 1.2, g: .28, a: .001, d: .02 }); T = os(E, o, at, { type: 'square', f: 220, f1: 110, g: .045, a: .001, d: .02, ft: 'lowpass', ff: 1200 }); }
    return T;
  },
  // autocannon: a dull "dug" and a click
  cannon(E, o, t) {
    nz(E, o, t, { ft: 'highpass', ff: 4000, g: .15, a: .001, d: .008 });
    nz(E, o, t, { buf: 'pink', ft: 'bandpass', ff: 900 * (.85 + E.r() * .3), q: 1, g: .45, a: .001, d: .07 });
    return os(E, o, t, { f: 170, f1: 70, g: .38, a: .002, d: .08 });
  },
  // missile away: ignition pop, the motor's roar opening up, a low rumble through the launcher
  missile(E, o, t) {
    nz(E, o, t, { ft: 'bandpass', ff: 1500, q: 1, g: .3, a: .001, d: .03 });
    nz(E, o, t + .01, { ft: 'lowpass', ff: 500, ff1: 2800, g: .3, a: .09, d: .55 });
    return nz(E, o, t, { buf: 'brown', ft: 'lowpass', ff: 320, g: .35, a: .03, d: .5 });
  },
  // a round into armour: the impact, the plate's body, its ring, and spall for the big ones (size 1–3)
  hit(E, o, t, s) {
    s = clamp(s || 1, 1, 3); const f0 = 430 / s * (.8 + E.r() * .4);
    nz(E, o, t, { ft: 'bandpass', ff: 1900 / Math.sqrt(s), q: .8, g: .5, a: .001, d: .05 * s });
    nz(E, o, t, { buf: 'brown', ft: 'lowpass', ff: 800, g: .5 * Math.sqrt(s), a: .002, d: .16 * s });
    let T = modal(E, o, t, f0, [1, 1.47, 2.09, 2.56, 3.39], [.35, .28, .2, .15, .1].map(x => x * s), .12);
    if (s >= 2) T = Math.max(T, grains(E, o, t + .02, 5 * s, .4, 3000, .08));
    return T;
  },
  // a round into a shield: a crystalline snap and a shimmering, beating ring
  shhit(E, o, t, s) {
    s = clamp(s || 1, 1, 3); const k = 1 / Math.pow(s, .5), f = 1400 * k * (.85 + E.r() * .3);
    nz(E, o, t, { ft: 'highpass', ff: 5000, g: .25, a: .001, d: .03 });
    fm(E, o, t, { f, f1: f * .5, r: 3.5, i: 1.5, i1: .2, g: .14, a: .002, d: .32 * s });
    os(E, o, t, { type: 'triangle', f: 220 * k, f1: 175 * k, g: .1, a: .003, d: .28 * s });
    os(E, o, t, { f: f * 1.36, g: .04, a: .002, d: .22 * s }); return os(E, o, t, { f: f * 1.36 + 37, g: .04, a: .002, d: .22 * s });
  },
  // shields collapse: a falling electric wail, crackle, a thud as the generator dumps
  shdown(E, o, t) {
    os(E, o, t, { type: 'sawtooth', f: 1200, f1: 60, g: .15, a: .005, d: .55, ft: 'lowpass', ff: 3000, ff1: 400 });
    fm(E, o, t, { f: 600, f1: 90, r: 1.5, i: 6, g: .1, a: .003, d: .6 });
    grains(E, o, t, 10, .5, 4500, .08, 3);
    return os(E, o, t, { f: 120, f1: 38, g: .4, a: .003, d: .32 });
  },
  // an explosion, scaled by size (a missile's ~6 to a destroyer's ~40): crack, body, sub, fire, debris
  boom(E, o, t, s) {
    const z = clamp((s || 14) / 40, 0, 1), d = drv(E, o, 1.8);
    nz(E, o, t, { ft: 'bandpass', ff: 2500, q: .6, g: .55, a: .001, d: .04 });
    nz(E, d, t, { buf: 'brown', ft: 'lowpass', ff: 1400 - 700 * z, ff1: 150, g: .9, a: .006, d: .5 + z });
    os(E, d, t, { f: 78 - 30 * z, f1: 27, g: .85, a: .003, d: .45 + .8 * z });
    nz(E, o, t + .02, { buf: 'pink', ft: 'bandpass', ff: 900, ff1: 380, q: .5, g: .25, a: .05, d: .6 + z });
    return Math.max(t + .7 + z, grains(E, o, t + .05, Math.round(4 + 10 * z), .3 + 1.2 * z, 2500, .08));
  },
  // a capital ship's death throes begin: the hit that kills her, and her frame groaning as she breaks up
  throes(E, o, t, s) {
    let T = R.boom(E, o, t, s);
    const g = E.ctx.createGain(), lfo = E.ctx.createOscillator(), lg = E.ctx.createGain(); g.gain.value = .7; lfo.frequency.value = 6 + E.r() * 4; lg.gain.value = .3; lfo.connect(lg); lg.connect(g.gain); g.connect(o); lfo.start(t); lfo.stop(t + 3.4);
    os(E, g, t + .25, { type: 'sawtooth', f: 46 * (.9 + E.r() * .2), f1: 33, g: .3, a: .35, d: 2.6, ft: 'bandpass', ff: 220, ff1: 520, q: 7 });
    for (let i = 0; i < 4; i++) T = Math.max(T, modal(E, o, t + .5 + E.r() * 2.2, 180 + E.r() * 260, [1, 1.53, 2.31], [.5, .4, .3], .05));
    return Math.max(T, t + 3.3);
  },
  // her reactor goes: the in-suck, a slam, a long rolling rumble, debris for seconds
  bigboom(E, o, t) {
    nz(E, o, t, { buf: 'pink', ft: 'lowpass', ff: 200, ff1: 2400, g: .25, a: .18, d: .03 });
    const s = t + .2, d = drv(E, o, 2.6);
    nz(E, o, s, { ft: 'bandpass', ff: 1800, q: .6, g: .8, a: .001, d: .08 });
    nz(E, d, s, { buf: 'brown', ft: 'lowpass', ff: 1100, ff1: 90, g: 1.2, a: .01, d: 2.4 });
    os(E, d, s, { f: 54, f1: 18, g: 1.1, a: .004, d: 2.2 });
    nz(E, o, s + .1, { buf: 'brown', ft: 'lowpass', ff: 130, g: .6, a: .3, d: 3.4 });
    modal(E, o, s, 38 * (.9 + E.r() * .2), [1, 1.6, 2.34], [3, 2.5, 2], .09);
    return Math.max(s + 3.8, grains(E, o, s + .1, 18, 2.5, 2000, .1));
  },
  // a nuclear warhead: a white crack, a sub-bass fall for four seconds, the fireball's roar, and a ringing in the ears
  nuke(E, o, t) {
    const d = drv(E, o, 3);
    nz(E, o, t, { ft: 'highpass', ff: 2000, g: .5, a: .001, d: .3 });
    os(E, d, t, { f: 48, f1: 14, g: 1.3, a: .01, d: 4 });
    nz(E, d, t, { buf: 'brown', ft: 'lowpass', ff: 900, ff1: 60, g: 1.3, a: .02, d: 4.5 });
    nz(E, o, t + .1, { buf: 'pink', ft: 'bandpass', ff: 400, ff1: 150, q: .4, g: .5, a: .4, d: 4.5 });
    grains(E, o, t + .2, 24, 4, 1600, .1);
    os(E, E.ui, t + .05, { f: 3800, g: .03 * audio.vol.sfx, a: .05, h: .6, d: 2.6 }); // the tinnitus, past the hull filter
    return t + 5.2;
  },
  // EMP: a falling FM chirp, a stuttering square, a dying buzz
  emp(E, o, t) {
    os(E, o, t, { type: 'square', f: 1800, f1: 60, g: .1, a: .002, d: .5, ft: 'lowpass', ff: 4000 });
    fm(E, o, t, { f: 3000, f1: 200, r: 1.07, i: 8, g: .1, a: .002, d: .6 });
    for (let i = 0; i < 8; i++) os(E, o, t + .05 + i * .04 + E.r() * .01, { type: 'square', f: 80 + E.r() * 600, g: .05, a: .001, d: .02 });
    nz(E, o, t, { ft: 'highpass', ff: 4000, g: .15, a: .001, d: .35 });
    return os(E, o, t + .1, { type: 'sawtooth', f: 120, f1: 50, g: .12, a: .01, d: .8, ft: 'bandpass', ff: 700, q: 2 });
  },
  // metal on metal: a ram, a boarding grapple, a blade on armour
  clang(E, o, t) {
    nz(E, o, t, { ft: 'bandpass', ff: 3000, q: 2, g: .3, a: .001, d: .02 });
    os(E, o, t, { f: 180, f1: 90, g: .2, a: .002, d: .08 });
    return modal(E, o, t, 520 * (.75 + E.r() * .5), [1, 2.32, 4.25, 6.63], [.5, .35, .22, .12], .18);
  },
  // the press of a melee: blades meeting, a razor's whip, a blow landing
  melee(E, o, t) {
    const k = E.r();
    if (k < .4) return R.clang(E, o, t);
    if (k < .75) { nz(E, o, t, { ft: 'bandpass', ff: 1200, ff1: 4200, q: 2, g: .22, a: .05, d: .08 }); return modal(E, o, t + .06, 2200 * (.9 + E.r() * .2), [1, 1.55], [.25, .18], .04); }
    nz(E, o, t, { buf: 'brown', ft: 'lowpass', ff: 600, g: .45, a: .002, d: .1 }); return os(E, o, t, { f: 110, f1: 60, g: .3, a: .002, d: .09 });
  },
  // a ship taken: a short rising horn call
  capture(E, o, t) { horn(E, o, t, 220, .22, .1); horn(E, o, t + .16, 293.7, .22, .1); return horn(E, o, t + .32, 440, .55, .11); },
  // the ship's klaxon: two rising whoops
  alarm(E, o, t) {
    let T = t; for (let i = 0; i < 2; i++) T = os(E, o, t + i * .45, { type: 'square', f: 420, f1: 760, glide: .3, g: .1, a: .02, h: .22, d: .1, ft: 'bandpass', ff: 1000, q: 1.6 }); return T;
  },
  sel(E, o, t) { nz(E, o, t, { ft: 'highpass', ff: 6000, g: .03, a: .001, d: .01 }); return os(E, o, t, { f: 1800, f1: 1500, g: .05, a: .001, d: .035 }); },
  ack(E, o, t) { os(E, o, t, { type: 'square', f: 1100, g: .03, a: .001, d: .04, ft: 'bandpass', ff: 1600, q: 1 }); return os(E, o, t + .05, { type: 'square', f: 1450, g: .03, a: .001, d: .05, ft: 'bandpass', ff: 1600, q: 1 }); },
  click(E, o, t) { nz(E, o, t, { ft: 'bandpass', ff: 4000, q: 3, g: .05, a: .001, d: .01 }); return os(E, o, t, { type: 'triangle', f: 900, f1: 1300, g: .06, a: .001, d: .04 }); },
  built(E, o, t) { bell(E, o, t, 587.3, .05, .7); bell(E, o, t + .07, 740, .05, .7); return bell(E, o, t + .14, 880, .05, .9); },
  deny(E, o, t) { os(E, o, t, { type: 'square', f: 160, g: .06, a: .002, d: .07, ft: 'lowpass', ff: 700 }); return os(E, o, t + .1, { type: 'square', f: 150, g: .06, a: .002, d: .09, ft: 'lowpass', ff: 700 }); },
  // comms: squelch, a carrier blip, a breath of static
  radio(E, o, t) { nz(E, o, t, { ft: 'bandpass', ff: 2600, q: 2.5, g: .18, a: .001, d: .09 }); os(E, o, t, { type: 'square', f: 1250, g: .05, a: .001, d: .05 }); return nz(E, o, t + .11, { ft: 'bandpass', ff: 1800, q: 1.2, g: .06, a: .01, d: .22 }); },
  // battle won: horns climbing D–A–D over a timpani roll; lost: a falling call over one slow drum
  victory(E, o, t) {
    for (let i = 0; i < 6; i++) drum(E, o, t + i * .07, 70, .18 + i * .03);
    horn(E, o, t + .05, 293.7, .25, .12); horn(E, o, t + .3, 440, .25, .12); horn(E, o, t + .55, 587.3, 1.3, .13); horn(E, o, t + .55, 440, 1.3, .07); horn(E, o, t + .55, 370, 1.3, .06);
    drum(E, o, t + .55, 62, .6); return t + 2.4;
  },
  defeat(E, o, t) {
    drum(E, o, t, 55, .6); drum(E, o, t + 1.1, 50, .5);
    horn(E, o, t + .05, 220, .6, .11); horn(E, o, t + .7, 174.6, .6, .11); horn(E, o, t + 1.35, 146.8, 1.6, .12); horn(E, o, t + 1.35, 174.6, 1.6, .06);
    return t + 3.4;
  },
  // ---- the ground war
  // a scorcher: a bright snap, the bolt's sizzle, the air cracking
  scorch(E, o, t) {
    nz(E, o, t, { ft: 'highpass', ff: 5000, g: .12, a: .001, d: .015 });
    nz(E, o, t, { ft: 'bandpass', ff: 2600 * (.85 + E.r() * .3), q: .8, g: .3, a: .001, d: .035 });
    return os(E, o, t, { type: 'sawtooth', f: 1900 * (.9 + E.r() * .2), f1: 380, g: .07, a: .001, d: .06, ft: 'lowpass', ff: 5000 });
  },
  // a pulseFist: a concussion of air, felt more than heard
  pulse(E, o, t) {
    fm(E, o, t, { f: 500, f1: 120, r: 1.5, i: 3, g: .08, a: .002, d: .1 });
    nz(E, o, t, { buf: 'brown', ft: 'lowpass', ff: 900, g: .45, a: .003, d: .15 });
    return os(E, o, t, { f: 165, f1: 48, g: .55, a: .002, d: .13 });
  },
  plasma(E, o, t) {
    nz(E, o, t, { ft: 'bandpass', ff: 3000, q: 1, g: .15, a: .001, d: .05 });
    fm(E, o, t, { f: 2000, f1: 300, r: .5, i: 4, g: .07, a: .002, d: .12 });
    return os(E, o, t, { type: 'sawtooth', f: 620, f1: 120, g: .12, a: .002, d: .12, ft: 'bandpass', ff: 1200, q: 1 });
  },
  // a heavy gun on the ground: a battery's slam, rolling back off the walls
  heavy(E, o, t) {
    const d = drv(E, o, 2);
    nz(E, o, t, { ft: 'bandpass', ff: 2000, q: .7, g: .7, a: .001, d: .05 });
    nz(E, d, t, { buf: 'brown', ft: 'lowpass', ff: 1000, ff1: 140, g: .9, a: .004, d: .7 });
    return os(E, d, t, { f: 80, f1: 32, g: .8, a: .003, d: .6 });
  },
  sarissa(E, o, t) {
    nz(E, o, t, { ft: 'bandpass', ff: 2200, q: 1, g: .25, a: .001, d: .03 });
    return nz(E, o, t + .01, { ft: 'bandpass', ff: 900, ff1: 3600, q: .7, g: .28, a: .05, d: .4 });
  },
};
// instruments the stingers and the score share
function horn(E, o, t, f, dur, g) {
  const c = E.ctx, lp = c.createBiquadFilter(), gg = c.createGain(); lp.type = 'lowpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(1600 + f * 2, t + .06); lp.frequency.exponentialRampToValueAtTime(500 + f, t + dur);
  lp.connect(gg); gg.connect(o); env(gg.gain, t, g, .05, dur * .5, dur * .6 + .25);
  for (const det of [-7, 0, 7]) { const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f; s.detune.value = det + (E.r() - .5) * 4; s.connect(lp); s.start(t); s.stop(t + .05 + dur * 1.1 + .35); }
  return t + .05 + dur * 1.1 + .25;
}
function bell(E, o, t, f, g, d) { fm(E, o, t, { f, r: 3.5, i: 1.6, i1: .01, g, a: .002, d }); return os(E, o, t, { f: f * 2, g: g * .25, a: .002, d: d * .5 }); }
function drum(E, o, t, f, g) { os(E, o, t, { f: f * 1.9, f1: f, glide: .08, g: g, a: .002, d: .5 }); nz(E, o, t, { buf: 'brown', ft: 'lowpass', ff: 220, g: g * .7, a: .002, d: .22 }); return t + .55; }

// ---------------------------------------------------------------- live engine
let E = null;
export function initAudio() {
  if (E) { if (E.ctx.state === 'suspended') E.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    E = buildEngine(new AC({ latencyHint: 'interactive' })); E.mu.next = E.ctx.currentTime + .1;
    setInterval(tick, 40);
    document.addEventListener('visibilitychange', () => { if (!E) return; if (document.hidden) E.ctx.suspend(); else E.ctx.resume(); });
  } catch (e) { E = null; }
}
export const audioReady = () => !!E;
// for the tests: what the engine is doing
export const audioStats = () => E ? { state: E.ctx.state, voices: E.voices.filter(e => e > E.ctx.currentTime).length, act: +E.act.toFixed(2), cue: E.mu.cue, lvl: +(E.lvl || 0).toFixed(2), scene: E.scene, air: E.air, played: E.played || 0 } : null;

// where a sound is: pan, distance, filter and lateness, from the space camera or the ground camera
function place(kind, D, x, y) {
  if (S.gameState === 'ground') {
    if (!S.groundEar) return { vol: 1, pan: 0, lp: 20000, delay: 0 };
    const [pan, d] = S.groundEar(x, y), reach = D.reach || 1200;
    const vol = 1 / (1 + Math.pow(d / reach, 1.5)), lp = E.air < .15 ? 20000 : clamp(20000 * Math.exp(-d / (2600 * E.air + 400)), 450, 20000);
    return { vol, pan: pan * .85, lp, delay: D.late && E.air >= .15 ? Math.min(.7, d / 343 * .35) : 0 };
  }
  const [sx, sy] = project(x, y), off = Math.max(0, -sx, sx - S.W, -sy, sy - S.H);
  let vol = clamp(1 - off / (D.far || 600), 0, 1) * clamp(.35 + S.cam.z, .3, 1); if (kind === 'nuke') vol = Math.max(vol, .45);
  return { vol, pan: clamp(sx / S.W * 2 - 1, -1, 1) * .7, lp: clamp(16000 * Math.exp(-off / 450), 700, 20000), delay: 0 };
}
function play(E, kind, o) {
  const D = DEF[kind], vary = Math.pow(10, (E.r() - .5) * .12); // ±0.6 dB
  const out = voice(E, D, { gain: o.vol * D.g * vary, pan: o.pan, lp: o.lp }), t = o.t;
  const end = R[kind](E, out, t, o.s);
  if (D.duck) duck(E, D.duck * Math.min(1, o.vol * 1.2) * (kind === 'boom' ? clamp((o.s || 14) / 40, .2, 1) : 1), t, kind === 'nuke' ? .8 : .12, kind === 'nuke' ? 3.5 : 1.2);
  if (D.mduck) duck(E, D.mduck, t, 1.6, 2.5, 1);
  return end;
}
export function sfx(kind, x, y, size) {
  if (!E || audio.muted || S.gameState === 'menu') return;
  const D = DEF[kind]; if (!D) return;
  let p = { vol: 1, pan: 0, lp: 20000, delay: 0 };
  if (x != null && !D.bus) { p = place(kind, D, x, y); }
  E.act += (D.act || 0) * (.3 + .7 * p.vol);
  if (p.vol <= .02) return;
  const now = E.ctx.currentTime, L = E.last[kind];
  if (L && now - L.t < D.gap && p.vol <= L.v * 1.6) return;
  E.last[kind] = { t: now, v: p.vol };
  E.voices = E.voices.filter(e => e > now);
  if (E.voices.length >= MAXV && (D.pri || 0) < 2) return;
  try { E.voices.push(play(E, kind, { ...p, t: now + .005 + p.delay, s: size })); E.played = (E.played || 0) + 1; } catch (e) { /* a bad parameter never breaks the game */ }
}
// play one sound centred, for the sound test
export function preview(kind) { initAudio(); if (!E || !DEF[kind]) return; const now = E.ctx.currentTime; E.voices.push(play(E, kind, { vol: 1, pan: 0, lp: 20000, t: now + .02, s: kind === 'hit' || kind === 'shhit' ? 2 : kind === 'boom' ? 24 : undefined })); }
export function setGroundWorld(name) {
  const k = String(name || '').toLowerCase(), AIR = { phobos: 0, deimos: 0, mercury: .85, venus: 1, earth: 1, mars: .85, luna: .7, titan: 1, io: .35, europa: .4, ganymede: .45, callisto: .35, triton: .3, rhea: .3 };
  const hit = Object.keys(AIR).find(w => k.includes(w)); if (E) { E.air = hit != null ? AIR[hit] : .8; applyScene(E, .3); }
}

// ---------------------------------------------------------------- the score
// "battle": D minor in 5/4 at 84, a nod to Holst's Mars. Layers enter with the fighting: a drone on D; a pulsing
// string ostinato; war drums; then brass on every bar. Chords over the D pedal: Dm, B♭, C, A.
// "map": the campaign map. Slow pads in D minor (Dm9, B♭maj7, Gm9, Asus4) with a sparse bell line.
const BAT = { e8: 60 / 84 / 2, len: 10, roots: [0, -4, -2, -5], qual: [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]],
  ost: [1, 0, 1, 1, 1, 0, 1, 0, 1, 1], ostP: [0, 0, 0, 0, 7, 0, 0, 0, 12, 7], ostA: [1, 0, .55, .55, .8, 0, .9, 0, .7, .6],
  drum: [1, 0, 0, .55, 0, .85, 0, .5, .7, 0], frame: [0, 0, 1, 0, 0, 0, 0, 1, 0, .6] };
const MAP = { e8: .5, len: 8, chords: [[50, 53, 57, 64], [46, 50, 53, 57], [43, 46, 50, 57], [45, 50, 52, 57]], bells: [74, 77, 79, 81, 84, 86] };
const hz = m => 440 * Math.pow(2, (m - 69) / 12), D2 = 73.42;
let explicit = null, explicitT = -9;
export function music(level) { explicit = level; explicitT = E ? E.ctx.currentTime : 0; }
export function previewMusic(cue) { initAudio(); if (!E) return; audio.preview = cue ? { cue, until: E.ctx.currentTime + 24 } : null; }
function musVoice(E, wet) { const g = E.ctx.createGain(); g.connect(E.musIn); if (wet) { const s = E.ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(E.revMus); } return g; }
function setCue(E, cue, t) {
  const M = E.mu; if (M.cue === cue) return;
  if (M.pad) { const p = M.pad; p.g.gain.cancelScheduledValues(t); p.g.gain.setTargetAtTime(0, t, .8); setTimeout(() => { p.oscs.forEach(o => { try { o.stop(); } catch (e) { /* stopped */ } }); p.g.disconnect(); }, 4000); M.pad = null; }
  M.cue = cue; M.n = 0; M.next = Math.max(M.next, t + .1);
  if (cue === 'battle') { // the drone: two beating saws on D, D an octave down, A above, under a slowly breathing filter
    const c = E.ctx, g = c.createGain(); g.gain.value = 0; g.connect(musVoice(E, .3));
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 3; lp.connect(g);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .07; lg.gain.value = 140; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(t);
    const oscs = [[D2, 'sawtooth', .5], [D2 * 1.006, 'sawtooth', .5], [110, 'sine', .35], [D2 / 2, 'sine', .6]].map(([f, ty, a]) => { const o = c.createOscillator(), og = c.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); return o; });
    oscs.push(lfo); M.pad = { g, oscs };
  }
}
// schedule the score's notes from M.next up to t1, at intensity lvl
function scoreTo(E, t1, lvl) {
  const M = E.mu, c = E.ctx;
  if (M.cue === 'battle') {
    if (M.pad) M.pad.g.gain.setTargetAtTime(lvl > 0 ? .085 + .03 * lvl : 0, c.currentTime, 1.2);
    while (M.next < t1) {
      const t = M.next, i = M.n % BAT.len, bar = Math.floor(M.n / BAT.len), ch = bar % 4, root = D2 * ST(BAT.roots[ch]);
      if (lvl > .25 && BAT.ost[i]) { // the ostinato: plucked low strings
        const f = root * 2 * ST(BAT.ostP[i]), a = BAT.ostA[i] * Math.min(1, (lvl - .2) * 2), o = musVoice(E, .15);
        os(E, o, t, { type: 'sawtooth', f, g: .085 * a, a: .004, d: .24, ft: 'lowpass', ff: 600 + 1800 * a, ff1: 260, q: 2 });
        os(E, o, t, { type: 'sawtooth', f: f * 1.004, g: .05 * a, a: .004, d: .2, ft: 'lowpass', ff: 500 + 1400 * a, ff1: 240 });
      }
      if (lvl > .5 && BAT.drum[i]) { const o = musVoice(E, .35), k = BAT.drum[i] * Math.min(1, (lvl - .45) * 2.5); drum(E, o, t, 41, .5 * k); }
      if (lvl > .75 && BAT.frame[i]) nz(E, musVoice(E, .3), t, { ft: 'bandpass', ff: 340, q: 1.2, g: .22 * BAT.frame[i], a: .002, d: .12 });
      if (lvl > .85) nz(E, musVoice(E, 0), t, { ft: 'highpass', ff: 6500, g: .025 * (i % 2 ? .6 : 1), a: .001, d: .015 });
      if (lvl > .82 && i === 0) { const o = musVoice(E, .4); for (const iv of BAT.qual[ch]) horn(E, o, t, root * 2 * ST(iv) * (iv ? 1 : 2), 1.1, .035); horn(E, o, t, root, 1.1, .045); }
      if (lvl > .7 && ch === 3 && i === 6) nz(E, musVoice(E, .5), t, { ft: 'highpass', ff: 3500, g: .07, a: 1.05, d: .06 }); // a swell into the next cycle
      M.n++; M.next += BAT.e8;
    }
  } else if (M.cue === 'map') {
    while (M.next < t1) {
      const t = M.next, i = M.n % MAP.len, bar = Math.floor(M.n / MAP.len), chord = MAP.chords[bar % 4];
      if (i === 0) { const o = musVoice(E, .55);
        for (const m of chord) { os(E, o, t, { type: 'triangle', f: hz(m), g: .042 * lvl, a: 1.6, h: 1.5, d: 2.6, ft: 'lowpass', ff: 1100 }); os(E, o, t, { f: hz(m + 12), g: .014 * lvl, a: 2, h: 1, d: 2.4 }); }
        os(E, o, t, { f: hz(chord[0] - 12), g: .08 * lvl, a: 1, h: 1.5, d: 3 }); }
      if ((i === 2 || i === 5 || i === 6 || i === 7) && E.r() < .3) bell(E, musVoice(E, .7), t, hz(MAP.bells[Math.floor(E.r() * MAP.bells.length)]), .035 * lvl, 2.4);
      M.n++; M.next += MAP.e8;
    }
  } else M.next = Math.max(M.next, t1);
}

// ---------------------------------------------------------------- ambience
// space: the hum of the ship around you, and now and then her frame creaking. ground: wind in gusts, and the far
// battle: a rumble and scattered distant fire that rise with the fighting.
function bedNode(E, k, make) { if (!E.bed[k]) E.bed[k] = make(); return E.bed[k]; }
function loopNoise(E, buf, type, f, q) { const c = E.ctx, s = c.createBufferSource(); s.buffer = E.buf[buf]; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(E.ambIn); s.start(); return { s, fl, g }; }
function ambience(E, dt, activity) {
  const c = E.ctx, t = c.currentTime, sc = S.gameState;
  const hum = bedNode(E, 'hum', () => { const n = loopNoise(E, 'brown', 'lowpass', 140, 1); const o = c.createOscillator(); o.frequency.value = 55; const og = c.createGain(); og.gain.value = .15; o.connect(og); og.connect(n.g); o.start(); return n; });
  hum.g.gain.setTargetAtTime(sc === 'play' ? .22 + .1 * activity : 0, t, 1.5);
  const wind = bedNode(E, 'wind', () => loopNoise(E, 'pink', 'bandpass', 500, 1.4));
  const din = bedNode(E, 'din', () => loopNoise(E, 'brown', 'lowpass', 190, .7));
  const g = sc === 'ground';
  if (g && E.r() < dt * .4) { wind.fl.frequency.setTargetAtTime(250 + E.r() * 700, t, 1.5); wind.g.gain.setTargetAtTime(E.air * (.08 + E.r() * .16), t, 1.2); }
  if (!g || E.air < .15) wind.g.gain.setTargetAtTime(0, t, .8);
  din.g.gain.setTargetAtTime(g ? .12 + .5 * activity : 0, t, 1);
  if (g && activity > .05) { // distant fire, a few grains per tick; now and then a far gun
    const n = activity * 16 * dt; let k = Math.floor(n) + (E.r() < n % 1 ? 1 : 0);
    while (k--) { const at = t + .05 + E.r() * dt; nz(E, E.ambIn, at, { ft: 'bandpass', ff: 1200 + E.r() * 1800, q: 1.5, g: .05 + E.r() * .05, a: .001, d: .02 + E.r() * .03 }); }
    if (E.r() < activity * .5 * dt) nz(E, E.ambIn, t + .05, { buf: 'brown', ft: 'lowpass', ff: 320, g: .25, a: .02, d: .9 });
  }
  if (sc === 'play' && E.r() < dt / 14) modal(E, E.ambIn, t + .05, 70 + E.r() * 80, [1, 1.41, 2.2], [1.6, 1.2, .8], .03); // the hull creaks
}

// ---------------------------------------------------------------- the clock: score, ambience and levels, 25 times a second
let lastTick = 0;
function tick() {
  if (!E || E.ctx.state !== 'running') return;
  try {
    const c = E.ctx, now = c.currentTime, dt = Math.min(.5, now - (lastTick || now)); lastTick = now;
    const scene = S.gameState === 'ground' ? 'ground' : 'space'; if (scene !== E.scene) { E.scene = scene; if (scene !== 'ground') E.air = 1; applyScene(E, .3); }
    // levels
    const V = audio.vol; E.master.gain.setTargetAtTime(audio.muted ? 0 : V.master, now, .05); E.sfxOut.gain.setTargetAtTime(V.sfx, now, .05);
    E.mus.gain.setTargetAtTime(V.music, now, .05); E.ui.gain.setTargetAtTime(V.ui, now, .05); E.amb.gain.setTargetAtTime(V.amb, now, .3);
    if (E.spaceMode !== audio.space) { E.spaceMode = audio.space; applyScene(E, .2); }
    // how hard the fighting is: recent effects, decaying over ~4 s
    E.act *= Math.exp(-dt / 4); const activity = 1 - Math.exp(-E.act / 8);
    // the cue and its intensity
    let cue = null, lvl = 0; const ex = explicit != null && now - explicitT < 1.5 ? explicit : null, gs = S.gameState;
    if (audio.preview && now < audio.preview.until) { cue = audio.preview.cue; lvl = cue === 'battle' ? clamp((now - audio.preview.until + 24) / 16, .3, 1) : .7; }
    else if (gs === 'strat' || gs === 'menu') { cue = 'map'; lvl = gs === 'menu' ? .5 : .65; }
    else if (gs === 'play') { cue = 'battle'; lvl = ex == null ? (activity > .04 ? .3 + .7 * activity : .22) : ex < .5 ? ex : ex * (.7 + .3 * Math.min(1, activity * 1.5)); }
    else if (gs === 'ground') { cue = 'battle'; lvl = explicit === 0 ? 0 : clamp(.3 + .75 * activity, 0, 1); }
    if (audio.preview && now >= audio.preview.until) audio.preview = null;
    E.lvl = (E.lvl || 0) + (lvl - (E.lvl || 0)) * Math.min(1, dt * .6); // the score moves between layers over a few seconds
    setCue(E, cue, now); scoreTo(E, now + Math.max(.25, dt * 2), E.lvl);
    ambience(E, dt, activity);
  } catch (e) { /* never break the game for sound */ }
}

// ---------------------------------------------------------------- offline rendering, for the tests and the sound reel
// events: [[time, kind, size?, pan?], ...]; music: { cue, lvl, from, to }. Returns the AudioBuffer.
export async function renderOffline({ events = [], music: mus = null, dur = 4, scene = 'space', space = 'hull', air = 1, seed = 7, sr = 44100 }) {
  const prev = audio.space; audio.space = space;
  const c = new OfflineAudioContext(2, Math.ceil(sr * dur), sr), X = buildEngine(c, { offline: true, scene, seed }); X.air = air; applyScene(X, 0);
  for (const [t, kind, s, pan] of events) play(X, kind, { vol: 1, pan: pan || 0, lp: 20000, t: t + .01, s });
  if (mus) { X.mu.next = mus.from || 0; setCue(X, mus.cue, mus.from || 0); if (X.mu.pad) X.mu.pad.g.gain.setValueAtTime(mus.lvl > 0 ? .085 + .03 * mus.lvl : 0, 0); scoreTo(X, mus.to || dur - 3, mus.lvl); }
  audio.space = prev;
  return c.startRendering();
}
