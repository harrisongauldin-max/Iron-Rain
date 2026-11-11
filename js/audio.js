import { project } from './cam.js';
import { S } from './state.js';
import { clamp } from './util.js';

let AC = null, master = null, noiseBuf = null; export const audio = { muted: false };
const last = {};
export function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = .32; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2.5, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function screenPos(x, y) { const [sx, sy] = project(x, y); return [sx, sy]; }
export function sfx(kind, x, y, size) {
  if (!AC || audio.muted || S.gameState === 'menu') return;
  const gap = { radio: .6, pd: .07, cannon: .06, rail: .045, hit: .05, boom: .06, missile: .08, shdown: .1 }[kind] || .03;
  if (AC.currentTime - (last[kind] || 0) < gap) return;
  let vol = 1;
  if (x != null) {
    const [sx, sy] = screenPos(x, y); const off = Math.max(0, Math.max(-sx, sx - S.W, -sy, sy - S.H));
    vol = clamp(1 - off / (kind === 'nuke' ? 3000 : 600), 0, 1) * clamp(.35 + S.cam.z, .3, 1); if (kind === 'nuke') vol = Math.max(vol, .4); if (vol <= .02) return;
  }
  last[kind] = AC.currentTime; const t = AC.currentTime;
  const noise = (dur, f, type, g, q) => { const s = AC.createBufferSource(); s.buffer = noiseBuf; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q; const gn = AC.createGain(); gn.gain.setValueAtTime(g * vol, t); gn.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(fl); fl.connect(gn); gn.connect(master); s.start(t, Math.random() * .4); s.stop(t + dur); };
  const tone = (f0, f1, dur, g, type) => { const o = AC.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); const gn = AC.createGain(); gn.gain.setValueAtTime(g * vol, t); gn.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur); };
  switch (kind) {
    case 'rail': noise(.25, 1400, 'lowpass', .3); tone(180, 40, .3, .35); break;
    case 'lance': noise(.9, 900, 'lowpass', .7); tone(90, 25, 1.1, .7, 'sawtooth'); break;
    case 'pd': noise(.04, 3000, 'highpass', .12); break;
    case 'cannon': noise(.05, 1800, 'bandpass', .18, 2); break;
    case 'missile': noise(.35, 1200, 'bandpass', .2, 1.5); break;
    case 'hit': noise(.15, 2500, 'bandpass', .3, 1); tone(900, 200, .1, .08, 'square'); break;
    case 'boom': noise(.6 + (size || 10) * .01, 500, 'lowpass', .5); tone(80, 30, .5, .3); break;
    case 'bigboom': noise(2.2, 300, 'lowpass', .9); tone(60, 18, 2, .6); break;
    case 'nuke': noise(2.4, 220, 'lowpass', 1.2); tone(50, 14, 2.4, .9); tone(120, 30, 1.2, .4, 'sawtooth'); break;
    case 'emp': tone(1800, 60, .6, .2, 'sawtooth'); noise(.4, 4000, 'highpass', .2); break;
    case 'shdown': tone(900, 120, .35, .15, 'triangle'); break;
    case 'clang': tone(320, 140, .35, .2, 'triangle'); noise(.2, 1500, 'bandpass', .2, 3); break;
    case 'capture': tone(440, 880, .25, .15, 'triangle'); setTimeout(() => sfx('capture2'), 150); break;
    case 'capture2': tone(660, 1320, .3, .12, 'triangle'); break;
    case 'alarm': tone(700, 500, .25, .12, 'square'); break;
    case 'sel': tone(1200, 1500, .05, .05); break;
    case 'ack': tone(900, 700, .07, .06); break;
    case 'click': tone(600, 900, .06, .07, 'triangle'); break;
    case 'built': tone(500, 1000, .15, .08, 'triangle'); break;
    case 'deny': tone(200, 150, .15, .1, 'square'); break;
    case 'radio': noise(.09, 2600, 'bandpass', .16, 2.5); tone(1250, 1250, .05, .05, 'square'); setTimeout(() => sfx('radio2'), 110); break;
    case 'radio2': noise(.22, 1800, 'bandpass', .05, 1.2); break;
  }
}

// battle music: a low drone in D under the fight, and war drums once the fleets are in contact. level 0 stops it.
let mus = null;
export function music(level) {
  if (!AC) return;
  const want = audio.muted || S.gameState === 'menu' ? 0 : level, t = AC.currentTime;
  if (!mus) {
    if (!want) return;
    const g = AC.createGain(); g.gain.value = 0; g.connect(master);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 3; lp.connect(g);
    const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = .07; lg.gain.value = 140; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    const oscs = [[73.42, 'sawtooth', .5], [73.42 * 1.006, 'sawtooth', .5], [110, 'sine', .35], [36.71, 'sine', .6]].map(([f, ty, a]) => { const o = AC.createOscillator(), og = AC.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = a; o.connect(og); og.connect(lp); o.start(); return o; });
    mus = { g, lp, oscs, lfo, beat: t + .5, n: 0, level: 0 };
  }
  mus.level = want; mus.g.gain.setTargetAtTime(want * .085, t, 1.2);
  // the drums: a war beat at 84 to the minute, heavier when the fighting is close
  if (want > .6 && t + .1 > mus.beat) {
    const at = Math.max(mus.beat, t), hit = [1, 0, .55, .7, 1, 0, .55, 0][mus.n++ % 8];
    if (hit) {
      const o = AC.createOscillator(), og = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(70, at); o.frequency.exponentialRampToValueAtTime(32, at + .35); og.gain.setValueAtTime(.55 * hit * want, at); og.gain.exponentialRampToValueAtTime(.001, at + .45); o.connect(og); og.connect(master); o.start(at); o.stop(at + .5);
      const n = AC.createBufferSource(); n.buffer = noiseBuf; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; const ng = AC.createGain(); ng.gain.setValueAtTime(.35 * hit * want, at); ng.gain.exponentialRampToValueAtTime(.001, at + .25); n.connect(f); f.connect(ng); ng.connect(master); n.start(at, Math.random()); n.stop(at + .3);
    }
    mus.beat = at + 60 / 84 / 2;
  } else if (want <= .6) mus.beat = Math.max(mus.beat, t);
  if (!want && mus.g.gain.value < .002) { mus.oscs.forEach(o => o.stop()); mus.lfo.stop(); mus.g.disconnect(); mus = null; }
}
