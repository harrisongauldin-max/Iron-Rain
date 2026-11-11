// Graphics settings: quality presets and the hull-size setting, remembered per browser.
// Presets set the render resolution, anti-aliasing and post-processing. Ultra is picked on its own for a strong GPU.
import { S } from './state.js';

export const PRESETS = {
  standard: { label: 'Standard', dpr: 1, msaa: 0, smaa: false, post: false, aniso: 4, planet: {}, fx: .6 },
  high:     { label: 'High',     dpr: 1.5, msaa: 4, smaa: false, post: true, aniso: 8, planet: { big: 2048, small: 2048 }, fx: 1 },
  ultra:    { label: 'Ultra',    dpr: 2, msaa: 4, smaa: true, post: true, aniso: 16, planet: { big: 4096, small: 2048 }, fx: 1.4 },
};
export const QUALITY_ORDER = ['standard', 'high', 'ultra'];
// The player's own settings on top of the preset (the graphics menu). For the four the preset sets (resolution,
// anti-aliasing, world maps, effects), null means "the preset's"; the rest are switches the presets leave alone.
export const GX_DEF = { res: null, aa: null, planet: null, fx: null, bloomK: 1, plumes: true, glare: true, ripples: true, sky: 1, bars: 'auto', labels: 'full' };
export const PLANET_STEPS = { low: {}, high: { big: 2048, small: 2048 }, ultra: { big: 4096, small: 2048 } };
// Hull size: how many times their true size ships are drawn next to the worlds. 1 = true scale.
export const HULL_STEPS = [1, 10, 20, 30, 40, 50];
export const HULL_DEFAULT = 30;

const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: keep it for this visit */ } };

// the GPU's name, when the browser will say: WebGL's unmasked renderer string (a throwaway context, released at
// once) names the chip best; WebGPU's adapter info adds vendor and architecture
let ADAPTER = null;
export function gpuName() {
  try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info'), n = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); return n; } catch (e) { return ''; }
}
async function adapterInfo() {
  try { if (!navigator.gpu) return null; const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!a) return null;
    return { ...(a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : {}), fallback: !!(a.info?.isFallbackAdapter ?? a.isFallbackAdapter) }; } catch (e) { return null; }
}
export function detectQuality(name, info) {
  const n = name + ' ' + (info ? [info.vendor, info.architecture, info.description].join(' ') : '');
  if ((info && info.fallback) || /SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR|Intel|UHD|Iris/i.test(n)) return 'standard';
  if (/RTX|RX ?[5-9]\d{3}|Radeon Pro|Arc A7|Apple M\d (Pro|Max|Ultra)/i.test(n)) return 'ultra';
  return 'high';
}
export async function loadGfx(renderer) {
  ADAPTER = renderer.backend.isWebGPUBackend ? await adapterInfo() : null;
  S.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  const name = gpuName(), q = get('ir.quality'), h = +get('ir.hullX');
  S.quality = PRESETS[q] ? q : detectQuality(name, ADAPTER);
  S.hullX = HULL_STEPS.includes(h) ? h : HULL_DEFAULT;
  let gx = {}; try { gx = JSON.parse(get('ir.gfx') || '{}') || {}; } catch (e) { gx = {}; }
  S.gx = { ...GX_DEF }; for (const k in GX_DEF) if (k in gx) S.gx[k] = gx[k];
  S.gpu = name || (ADAPTER ? [ADAPTER.vendor, ADAPTER.architecture].filter(Boolean).join(' ') : ''); S.fxK = preset().fx || 1;
}
// the preset with the player's overrides laid over it
export const preset = () => { const P = PRESETS[S.quality] || PRESETS.high, g = S.gx; if (!g) return P;
  return { ...P, dpr: g.res ?? P.dpr, msaa: g.aa == null ? P.msaa : g.aa === 'off' ? 0 : 4, smaa: g.aa == null ? P.smaa : g.aa === 'smaa',
    post: P.post || g.aa === 'smaa', planet: g.planet == null ? P.planet : PLANET_STEPS[g.planet] || P.planet, fx: g.fx ?? P.fx }; };
export const customised = () => !!S.gx && ['res', 'aa', 'planet', 'fx'].some(k => S.gx[k] != null);
// a preset resets the four settings it owns; the switches stay as the player left them
export function setQualityName(q) { if (!PRESETS[q]) return; S.quality = q; if (S.gx) { for (const k of ['res', 'aa', 'planet', 'fx']) S.gx[k] = null; saveGx(); } S.fxK = preset().fx || 1; put('ir.quality', q); }
export function setGx(k, v) { if (!S.gx || !(k in GX_DEF)) return; S.gx[k] = v; if (k === 'fx') S.fxK = preset().fx || 1; saveGx(); }
export function resetGx() { S.gx = { ...GX_DEF }; S.fxK = preset().fx || 1; saveGx(); }
function saveGx() { put('ir.gfx', JSON.stringify(S.gx)); }
export function setHullX(h) { if (!HULL_STEPS.includes(h)) return; S.hullX = h; put('ir.hullX', String(h)); }
export const nextIn = (list, v) => list[(list.indexOf(v) + 1) % list.length];

// the frame-time meter (F9); with WebGPU timestamp queries it also shows the GPU's own time for the frame
const M = { t: 0, ms: 16.7, fps: 60, last: 0, gpu: null, busy: false };
export function meterTick(now) {
  if (M.last) { const dt = Math.min(250, now - M.last); M.ms += (dt - M.ms) * .08; M.fps = 1000 / Math.max(1, M.ms); }
  M.last = now; return M;
}
export function gpuTimer(renderer) {
  if (M.busy || !renderer.backend.isWebGPUBackend || !renderer.backend.trackTimestamp) return;
  M.busy = true;
  renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) M.gpu = M.gpu == null ? ms : M.gpu + (ms - M.gpu) * .15; })
    .catch(() => {}).finally(() => { M.busy = false; });
}
