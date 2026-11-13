// The sound menu (the Sound button): levels for each part of the mix, how space battles sound, and a sound test
// to audition every effect and both pieces of the score. Changes apply at once and are remembered per browser.
import { audio, saveAudio, initAudio, preview, previewMusic } from './audio.js';

const LEVELS = [['master', 'Master'], ['sfx', 'Effects'], ['music', 'Music'], ['amb', 'Ambience'], ['ui', 'Interface & comms']];
const TEST = [
  ['Space', [['rail', 'Railgun'], ['lance', 'Broadside'], ['cannon', 'Autocannon'], ['pd', 'Point defence'], ['missile', 'Missile'], ['hit', 'Hull hit'], ['shhit', 'Shield hit'], ['shdown', 'Shields down'], ['emp', 'EMP'], ['clang', 'Ram'], ['boom', 'Explosion'], ['throes', 'Death throes'], ['bigboom', 'Reactor'], ['nuke', 'Nuke']]],
  ['Ground', [['scorch', 'Scorcher'], ['pulse', 'PulseFist'], ['plasma', 'Plasma'], ['heavy', 'Heavy gun'], ['sarissa', 'AA missile'], ['melee', 'Melee']]],
  ['Command', [['sel', 'Select'], ['ack', 'Order'], ['deny', 'Refused'], ['built', 'Built'], ['radio', 'Comms'], ['alarm', 'Klaxon'], ['capture', 'Captured'], ['victory', 'Victory'], ['defeat', 'Defeat']]],
];
let P = null, btn = null;
function build() {
  P = document.createElement('div'); P.id = 'sndp'; P.className = 'panel hide';
  P.innerHTML = `<div class="gx-head"><b>Sound</b><span>Synthesised live · no samples</span><button class="btn ico" data-sx="close" title="Close">×</button></div><div class="gx-body">
    <div class="gx-row"><span class="gx-name">Sound</span><span class="gx-opts"><button class="btn sm" data-mute="0">On</button><button class="btn sm" data-mute="1">Muted</button></span></div>
    <div class="gx-sec">Levels</div>` +
    LEVELS.map(([k, n]) => `<div class="gx-row"><span class="gx-name">${n}</span><span class="sx-vol"><input type="range" min="0" max="100" step="1" data-vol="${k}"><i data-vv="${k}"></i></span></div>`).join('') +
    `<div class="gx-sec">Space battles</div>
    <div class="gx-row" title="Space carries no sound. Through the hull: the battle as the crew hear it, low and heavy, the ship ringing when her guns fire. Cinematic: the full range, as a film would play it."><span class="gx-name">Space sound</span><span class="gx-opts"><button class="btn sm" data-sp="hull">Through the hull</button><button class="btn sm" data-sp="cinematic">Cinematic</button></span></div>
    <div class="gx-sec">Score</div>
    <div class="gx-row"><span class="gx-name">Preview</span><span class="gx-opts"><button class="btn sm" data-mu="battle" title="The battle score building from drone to full brass over about 16 seconds">Battle</button><button class="btn sm" data-mu="map" title="The campaign map theme">Campaign map</button><button class="btn sm" data-mu="" title="Back to the music for where you are">Stop</button></span></div>
    <div class="gx-sec">Sound test</div>` +
    TEST.map(([sec, list]) => `<div class="sx-test"><span>${sec}</span>${list.map(([k, n]) => `<button class="btn sm" data-play="${k}">${n}</button>`).join('')}</div>`).join('') +
    `</div><div class="gx-foot"><span>Headphones recommended: sounds are placed left and right by where they are on screen</span><button class="btn sm" data-sx="reset">Reset</button></div>`;
  document.body.appendChild(P);
  P.addEventListener('input', e => { const k = e.target.dataset.vol; if (!k) return; audio.vol[k] = e.target.value / 100; saveAudio(); sync(); });
  P.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; initAudio(); const d = b.dataset;
    if (d.sx === 'close') return close();
    if (d.sx === 'reset') { Object.assign(audio.vol, { master: .8, sfx: 1, music: .55, amb: .7, ui: .8 }); audio.space = 'hull'; audio.muted = false; }
    if (d.mute != null) audio.muted = d.mute === '1';
    if (d.sp) audio.space = d.sp;
    if (d.mu != null) previewMusic(d.mu || null);
    if (d.play) preview(d.play);
    saveAudio(); sync();
  });
  for (const ev of ['mousedown', 'keydown']) P.addEventListener(ev, e => e.stopPropagation());
  P.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
}
function sync() {
  if (!P) return;
  for (const [k] of LEVELS) { const v = Math.round(audio.vol[k] * 100); P.querySelector(`[data-vol="${k}"]`).value = v; P.querySelector(`[data-vv="${k}"]`).textContent = v + '%'; }
  for (const b of P.querySelectorAll('[data-mute]')) b.classList.toggle('on', (b.dataset.mute === '1') === audio.muted);
  for (const b of P.querySelectorAll('[data-sp]')) b.classList.toggle('on', b.dataset.sp === audio.space);
  if (btn) { btn.classList.toggle('on', !audio.muted); btn.textContent = audio.muted ? 'Muted' : 'Sound'; }
}
function close() { if (P) P.classList.add('hide'); if (btn) btn.classList.remove('open'); }
export const soundOpen = () => !!P && !P.classList.contains('hide');
export function toggleSound(button) { btn = button || btn; if (!P) build(); if (soundOpen()) return close(); P.classList.remove('hide'); sync(); }
export function initSoundButton(button) { btn = button; sync(); button.classList.toggle('on', !audio.muted); button.textContent = audio.muted ? 'Muted' : 'Sound'; }
