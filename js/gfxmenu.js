// The graphics menu (F10, or Display ▸ Graphics settings): the quality preset and, over it, every setting the player
// may want to change on its own: resolution, anti-aliasing, world maps, effects, bloom, plumes, glare, the sky,
// hull size and the battle overlay. Changes apply at once and are remembered per browser.
import { S } from './state.js';
import { PRESETS, QUALITY_ORDER, HULL_STEPS, preset, setQualityName, setGx, resetGx, setHullX, customised } from './gfx.js';
import { applyQuality, setBloom, setBloomK, setSky } from './render.js';

const ROWS = [
  { sec: 'Rendering' },
  { k: 'preset', name: 'Preset', tip: 'Sets resolution, anti-aliasing, world maps and effects together. Changing one of those after makes it Custom.',
    opts: QUALITY_ORDER.map(q => [q, PRESETS[q].label]), get: () => customised() ? null : S.quality, set: v => { setQualityName(v); applyQuality(); } },
  { k: 'res', name: 'Resolution', tip: 'Pixels drawn per screen pixel (never more than your screen has). Lower is faster on a laptop GPU.',
    opts: [[.5, '50%'], [.75, '75%'], [1, '100%'], [1.5, '150%'], [2, '200%']], get: () => preset().dpr, set: v => { setGx('res', v); applyQuality(); } },
  { k: 'aa', name: 'Anti-aliasing', tip: 'MSAA smooths hull edges; SMAA also smooths thin lines and tracers.',
    opts: [['off', 'Off'], ['msaa', 'MSAA 4×'], ['smaa', 'MSAA + SMAA']], get: () => { const P = preset(); return !P.msaa ? 'off' : P.smaa ? 'smaa' : 'msaa'; }, set: v => { setGx('aa', v); applyQuality(); } },
  { k: 'planet', name: 'World maps', tip: 'The size the worlds are painted at. Ultra paints the big worlds at 4096 for close passes.',
    opts: [['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']], get: () => { const p = preset().planet || {}; return p.big >= 4096 ? 'ultra' : p.big >= 2048 ? 'high' : 'low'; }, set: v => { setGx('planet', v); applyQuality(); } },
  { sec: 'Effects' },
  { k: 'fx', name: 'Effect density', tip: 'Sparks, fire, smoke and debris per explosion and hit.',
    opts: [[.6, 'Low'], [1, 'Medium'], [1.4, 'High']], get: () => preset().fx, set: v => setGx('fx', v) },
  { k: 'bloom', name: 'Bloom', tip: 'The glow around flashes, drives and tracers.',
    opts: [[0, 'Off'], [.6, 'Soft'], [1, 'Normal'], [1.4, 'Strong']], get: () => S.bloom ? S.gx.bloomK || 1 : 0,
    set: v => { setGx('bloomK', v); if (v) { setBloom(true); setBloomK(v); } else setBloom(false); if (S.gfxLabels) S.gfxLabels(); } },
  { k: 'plumes', name: 'Drive plumes', tip: 'The flames behind ships under thrust. The drive bells still glow with them off.', opts: [[true, 'On'], [false, 'Off']], get: () => S.gx.plumes, set: v => setGx('plumes', v) },
  { k: 'ripples', name: 'Shield hits', tip: 'Shield cells lighting up where a shot lands.', opts: [[true, 'On'], [false, 'Off']], get: () => S.gx.ripples, set: v => setGx('ripples', v) },
  { k: 'glare', name: 'Sun glare', tip: 'The Sun\'s flare and lens ghosts when it is on or near the screen.', opts: [[true, 'On'], [false, 'Off']], get: () => S.gx.glare, set: v => setGx('glare', v) },
  { k: 'sky', name: 'Milky Way', tip: 'The band of the galaxy behind the stars. Off leaves only the stars.', opts: [[0, 'Off'], [.5, 'Faint'], [1, 'Full']], get: () => S.gx.sky, set: v => { setGx('sky', v); setSky(v); } },
  { sec: 'Battle map' },
  { k: 'hull', name: 'Hull size', tip: 'How many times their true size ships are drawn. 1× is true scale: hulls are specks beside the worlds.',
    opts: HULL_STEPS.map(h => [h, h + '×']), get: () => S.hullX, set: v => { setHullX(v); if (S.gfxLabels) S.gfxLabels(); } },
  { k: 'bars', name: 'Health bars', tip: 'Bars over damaged ships as well as selected ones, or over selected ships only.', opts: [['auto', 'Damaged'], ['sel', 'Selected']], get: () => S.gx.bars, set: v => setGx('bars', v) },
  { k: 'labels', name: 'Labels', tip: 'Commander names and states (wavering, broken) over every ship, or only over the selection.', opts: [['full', 'Full'], ['min', 'Minimal']], get: () => S.gx.labels, set: v => setGx('labels', v) },
  { k: 'meter', name: 'Frame meter', tip: 'Frame time, draw calls and the GPU\'s own time (F9).', opts: [[true, 'On'], [false, 'Off']], get: () => !!S.meter, set: v => { S.meter = v; if (S.gfxLabels) S.gfxLabels(); } },
];

let P = null;
const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;
function build() {
  P = document.createElement('div'); P.id = 'gfxp'; P.className = 'panel hide';
  P.innerHTML = `<div class="gx-head"><b>Graphics</b><span id="gxGpu"></span><button class="btn ico" data-gx="close" title="Close (Esc)">×</button></div><div class="gx-body">` +
    ROWS.map((r, i) => r.sec ? `<div class="gx-sec">${r.sec}</div>` : `<div class="gx-row" title="${r.tip.replace(/"/g, '&quot;')}"><span class="gx-name">${r.name}</span><span class="gx-opts">` +
      r.opts.map(([v, t], j) => `<button class="btn sm" data-r="${i}" data-o="${j}">${t}</button>`).join('') + `</span></div>`).join('') +
    `</div><div class="gx-foot"><span id="gxNote"></span><button class="btn sm" data-gx="reset" title="Back to the preset's values and every switch on">Reset</button></div>`;
  document.body.appendChild(P);
  P.addEventListener('click', e => {
    const c = e.target.closest('[data-gx]'); if (c) { if (c.dataset.gx === 'close') close(); else { resetGx(); setQualityName(S.quality); applyQuality(); setBloom(true); setBloomK(1); setSky(1); if (S.gfxLabels) S.gfxLabels(); sync(); } return; }
    const b = e.target.closest('[data-r]'); if (!b) return; const r = ROWS[+b.dataset.r], v = r.opts[+b.dataset.o][0];
    try { r.set(v); } catch (err) { console.warn('graphics setting', r.k, err); }
    sync();
  });
  P.addEventListener('mousedown', e => e.stopPropagation());
  P.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
}
function sync() {
  if (!P) return;
  ROWS.forEach((r, i) => { if (r.sec) return; const cur = r.get(); for (const b of P.querySelectorAll(`[data-r="${i}"]`)) b.classList.toggle('on', same(r.opts[+b.dataset.o][0], cur)); });
  P.querySelector('#gxGpu').textContent = [S.backend, S.gpu].filter(Boolean).join(' · ');
  P.querySelector('#gxNote').textContent = customised() ? 'Custom: ' + (PRESETS[S.quality] || PRESETS.high).label + ' with your changes' : (PRESETS[S.quality] || PRESETS.high).label + ' preset';
}
export const gfxOpen = () => !!P && !P.classList.contains('hide');
export function close() { if (P) P.classList.add('hide'); }
export function toggleGfx() { if (!P) build(); P.classList.toggle('hide'); if (!P.classList.contains('hide')) sync(); }
// at boot, after the renderer: settings the renderer does not read for itself
export function initGfxMenu() {
  if (S.gx && S.gx.bloomK === 0) setBloom(false); else if (S.gx) setBloomK(S.gx.bloomK || 1);
  addEventListener('keydown', e => {
    if (e.key === 'F10') { e.preventDefault(); toggleGfx(); return; }
    if (e.key === 'Escape' && gfxOpen()) { close(); e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}
