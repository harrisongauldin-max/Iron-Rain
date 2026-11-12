// The strategic view of the campaign: an orrery of the Solar System, one turn a week. Worlds are drawn on a
// compressed map (true order and true angles, sizes and gaps squeezed so everything fits on one screen);
// fleets sit beside the worlds they orbit and crawl between them. All rules live in camp.js; this file only
// draws them and turns clicks into orders.
import { S } from './state.js';
import { BODIES, FACTIONS, sigilSVG, ICON_SCALE, COUNTER, CRAFT, CRAFT_NAME, BAY, bayUse, REPLACE_COST, REPLACE_MAN } from './data.js';
import { WORLDS, WORLD as WDEF, bodyOf, setupBodies, AU } from './solar.js';
const PI = Math.PI;
import * as K from './camp.js';
import { C } from './camp.js';
import { toWorld, projectTo } from './cam.js';
import { buildIcon, overlayAPI, portrait } from './render.js';
import { setupFactions } from './sim.js';
import { fightBattle } from './battle.js';
import * as GV from './groundview.js';
import * as IN from './intel.js';
import * as CM from './command.js';
import * as EC from './economy.js';
import * as TE from './tech.js';
import * as P from './politics.js';
import * as AG from './agents.js';
import * as ST from './story.js';
import * as RU from './rulers.js';
import * as CQ from './conquest.js';
import * as SR from './starts.js';
import * as QS from './quests.js';
import { initAudio, sfx } from './audio.js';
import { OPTS, saveOpts } from './ui.js';
import { toggleGfx, gfxOpen } from './gfxmenu.js';
import { DEFS } from './data.js';
import * as SV from './save.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fmt = n => { n = Math.round(n); return Math.abs(n) >= 10000 ? (n / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1) + 'k' : n.toLocaleString(); };
const sgn = n => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
const nm = id => bodyOf(id).name;
const colS = f => f === 'neu' ? '#9aa0a6' : FACTIONS[K.BLOCS[f]].col.main;
const colN = f => parseInt(colS(f).slice(1), 16);
const RES = [['he', 'He-3', '#7ff3ff'], ['ore', 'Ore', '#d9a066'], ['alloy', 'Alloys', '#c9d4e0'], ['rare', 'Rare', '#d98cff'], ['ord', 'Ordnance', '#f2c14e'], ['man', 'Manpower', '#e9e3d4'], ['food', 'Food', '#b6f5a0'], ['inf', 'Influence', '#ffd27a'], ['sci', 'Research', '#8fe3c0']];
const RSH = { he: 'He', ore: 'Ore', alloy: 'Alloy', rare: 'Rare', ord: 'Ord', man: 'Man', food: 'Food', inf: 'Inf', sci: 'Sci' };
const costTxt = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${fmt(v)} ${RSH[k] || k}`).join(' · ');
export const V = { sel: null, hover: null, busy: false, dirty: true, mark: new Set(), keys: {}, drag: null, tok: [] };
const date = t => `Week ${((t - 1) % 52) + 1}, ${753 + Math.floor((t - 1) / 52)} PCE`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// every number explained: a tooltip of [label, value] parts, as the game computes them
const sg1 = v => (v >= 0 ? '+' : '−') + (Math.abs(v) >= 10 || Math.abs(v - Math.round(v)) < .05 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1));
const partsHTML = (parts, unit = '') => parts.map(([l, v]) => `<div class='trow'><span>${esc(l)}</span><b class='${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}'>${sg1(v)}${unit}</b></div>`).join('');
const partsTip = (title, parts, total, note, unit) => `<div class='th'>${esc(title)}</div>${partsHTML(parts, unit)}${total != null ? `<div class='trow tsum'><span>Comes to</span><b>${total}</b></div>` : ''}${note ? `<div class='tdim'>${note}</div>` : ''}`;
const traitChip = t => { const T = RU.TRAITS[t]; return T ? `<span class="tal trait" data-tip="${tipA(`<div class='th'>${T.name}</div><div class='tdim'>${T.desc}</div>`)}">${T.name}</span>` : ''; };

// ---------------------------------------------------------------- the map: the same true-scale system as the sandbox
let LAY = null;
const INNER = new Set(['mercury', 'venus', 'earth', 'luna', 'mars', 'phobos', 'deimos', 'marcher']);
function layout() {
  const sun = BODIES.find(b => b.kind === 'star'), pos = { sun: { x: 0, y: 0, r: sun.r } }, orbits = [];
  for (const b of BODIES) if (b.kind === 'planet') { pos[b.id] = { x: b.x, y: b.y, r: b.r }; orbits.push([0, 0, Math.hypot(b.x, b.y), 0]); }
  for (const b of BODIES) if (b.kind === 'moon') { const p = BODIES[b.parent]; pos[b.id] = { x: p.x + Math.cos(b.phase) * b.orbitR, y: p.y + Math.sin(b.phase) * b.orbitR, r: b.r, parent: p.id }; orbits.push([p.x, p.y, b.orbitR, 1]); }
  for (let i = 0; i < 5; i++) orbits.push([0, 0, AU * (2.2 + i * .27), 2]);
  return { pos, orbits, overlay: drawOverlay };
}
const LP = id => LAY.pos[id];
function fleetPos(fl) {
  if (!fl.transit && !fl.engage) return LAY.pos[fl.at];
  const p = IN.locPos(IN.fleetLoc(fl), LP); return { x: p.x, y: p.y, r: 0 };
}
// what the player sees of each fleet: 2 tracked, 1 a contact, 0 nothing (refreshed a few times a second)
function vis(fl) { if (!V.vis || performance.now() - V.visT > 250 || V.visTurn !== C.turn) { V.vis = new Map(); V.visT = performance.now(); V.visTurn = C.turn; IN.scan(C.player); for (const o of C.fleets) V.vis.set(o, IN.levelOf(C.player, o)); } return V.vis.has(fl) ? V.vis.get(fl) : IN.levelOf(C.player, fl); }
const estN = fl => { const m = C.intel && C.intel[C.player] && C.intel[C.player][fl.id]; return m ? m.n : fl.ships.length; };
const Q = { x: 0, y: 0, k: 0, ok: false };
const P2 = (x, y) => { projectTo(Q, x, y); return { x: Q.x, y: Q.y, k: Q.k, ok: Q.ok }; };
// where each world is on screen, and which marker stands for it when it is too close to its neighbours to draw:
// a moon folds into its planet, and the whole inner system folds into one marker when zoomed far out
function anchors() {
  const sp = {}, an = {}, sunS = P2(0, 0);
  for (const id in C.worlds) { const P = LAY.pos[id], q = P2(P.x, P.y); q.R = P.r * q.k; sp[id] = q; }
  const innerFold = Math.hypot(sp.mars.x - sunS.x, sp.mars.y - sunS.y) < 80;
  const ceresFold = innerFold && Math.hypot(sp.ceres.x - sunS.x, sp.ceres.y - sunS.y) < 48;
  for (const id in C.worlds) {
    let a = id; const P = LAY.pos[id];
    if (P.parent && Math.hypot(sp[id].x - sp[P.parent].x, sp[id].y - sp[P.parent].y) < 26) a = P.parent;
    if (innerFold && (INNER.has(a) || (ceresFold && a === 'ceres'))) a = 'inner';
    an[id] = a;
  }
  sp.inner = { x: sunS.x, y: sunS.y, R: 6, ok: sunS.ok };
  return { sp, an, innerFold };
}
const onScreen = q => q.ok && q.x > -120 && q.y > -120 && q.x < S.W + 120 && q.y < S.H + 120;
function drawOverlay(G, label) {
  const ctx = overlayAPI.ctx, me = C.player; V.tok = []; V.hit = [];
  const { sp, an, innerFold } = anchors(); V.an = an; V.sp = sp;
  const at = id => sp[an[id]];
  ctx.lineCap = 'round';
  // transit lines first so the worlds draw over them
  V.vis = null;
  for (const fl of C.fleets) {
    if (!fl.transit || fl.engage) continue; const lv = vis(fl); if (!lv) continue;
    const p = fleetPos(fl), a = P2(p.x, p.y); let t = fl.transit.p1 ? (q => (q.R = 0, q))(P2(...Object.values(IN.locPos(fl.transit.p1, LP)))) : at(fl.transit.to); if (!a.ok || !t.ok) continue;
    if (lv === 1) { const dx = t.x - a.x, dy = t.y - a.y, L = Math.hypot(dx, dy) || 1, hx = a.x + dx / L * 34, hy = a.y + dy / L * 34; // a contact: its heading, not its goal
      ctx.globalAlpha = .55; ctx.strokeStyle = colS(fl.owner); ctx.lineWidth = 1.2; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]); continue; }
    const mine = fl.owner === me, threat = !mine && C.worlds[fl.transit.to].owner === me && !fl.transit.sortie;
    ctx.globalAlpha = mine ? .85 : threat ? .8 : .4; ctx.strokeStyle = threat ? '#ff6a5a' : colS(fl.owner); ctx.lineWidth = mine && V.sel && V.sel.fl === fl ? 2.2 : 1.3;
    ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(t.y - a.y, t.x - a.x), tr = Math.max(t.R || 0, 4) + 9, hx = t.x - Math.cos(ang) * tr, hy = t.y - Math.sin(ang) * tr;
    if (Math.hypot(t.x - a.x, t.y - a.y) > tr + 10) { ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(ang - .45) * 9, hy - Math.sin(ang - .45) * 9); ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(ang + .45) * 9, hy - Math.sin(ang + .45) * 9); ctx.stroke(); }
    if ((mine || threat) && Math.hypot(t.x - a.x, t.y - a.y) > 60) label(fl.transit.left + ' wk', (a.x + t.x) / 2, (a.y + t.y) / 2 - 16, threat ? 0xff8a7a : 0xe9e3d4, false, 'skip');
  }
  // the selected fleet's move preview
  const sf = V.sel && V.sel.fl; if (sf && sf.owner === me && !sf.transit && V.hover && V.hover.w && V.hover.w !== sf.at) {
    const a = at(sf.at), b = at(V.hover.w);
    if (a.ok && b.ok) { ctx.globalAlpha = .9; ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const n = K.moveWeeks(sf, V.hover.w), nf = K.moveWeeks(sf, V.hover.w, true); label(nm(V.hover.w) + ': ' + n + (n === 1 ? ' week' : ' weeks') + (sf.run === 'dark' ? ' dark' : '') + ' · right-click to send', b.x, b.y + Math.max(b.R || 0, 4) + 34, 0xf2c14e, false, false); if (nf < n) label(`Shift + right-click: forced burn, ${nf} wk, ${K.burnCost(sf, V.hover.w)} He-3`, b.x, b.y + Math.max(b.R || 0, 4) + 50, 0xff9a5a, false, false); }
  }
  // the inner system, folded
  if (innerFold && onScreen(sp.inner)) {
    const q = sp.inner, hov = V.hover && V.hover.zoom === 'inner';
    G.screen().circle(q.x, q.y, 26).stroke({ width: hov ? 1.8 : 1.1, color: 0xf2c14e, alpha: hov ? .95 : .55 });
    label('THE INNER SYSTEM', q.x, q.y + 32, 0xf2c14e, true, true);
    // one pip per world, coloured by its holder
    const ids = Object.keys(C.worlds).filter(id => an[id] === 'inner'); ids.forEach((id, i) => { const ang = -PI / 2 + (i - (ids.length - 1) / 2) * .32; G.screen().circle(q.x + Math.cos(ang) * 26, q.y + Math.sin(ang) * 26, 3.2).fill({ color: colN(C.worlds[id].owner), alpha: 1 }); });
    V.hit.push({ x: q.x, y: q.y, r: 30, zoom: 'inner' });
    const by = {}; for (const fl of C.fleets) if (!fl.transit && an[fl.at] === 'inner' && vis(fl)) by[fl.owner] = (by[fl.owner] || 0) + (vis(fl) === 2 ? fl.ships.length : estN(fl));
    const os = Object.keys(by); let x0 = q.x - os.reduce((a, o) => a + 20 + String(by[o]).length * 7, -6) / 2; for (const o of os) { tokenBox(ctx, colS(o), String(by[o]), x0, q.y + 50, o === me, false, { zoom: 'inner' }); x0 += 20 + String(by[o]).length * 7; }
  }
  // the orbits the fleets keep, faintly, in their colours
  for (const r of V.rings || []) { ctx.globalAlpha = r.mine ? .3 : .22; ctx.strokeStyle = r.col; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.beginPath(); for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, q = P2(r.x + Math.cos(a) * r.R, r.y + Math.sin(a) * r.R); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.stroke(); ctx.setLineDash([]); }
  // worlds, planets first
  const wl = Object.values(C.worlds).filter(w => an[w.id] === w.id).sort((a, b) => (LAY.pos[a.id].parent ? 1 : 0) - (LAY.pos[b.id].parent ? 1 : 0));
  // fleets in orbit (and at folded moons), stacked to the right of their world, drawn first so the names step around them
  for (const w of wl) {
    const q = sp[w.id]; if (!onScreen(q)) continue;
    const rr = Math.max(q.R + 3, LAY.pos[w.id].parent ? 3.5 : 5), here = C.fleets.filter(f => !f.transit && !f.engage && an[f.at] === w.id && vis(f) && !(V.replay && V.replay.ids.has(f.id))); let i = 0;
    for (const fl of here) { const x = q.x + rr + 9, y = q.y - rr * .45 - 7 - i * 16; token(ctx, fl, x, y); overlayAPI.reserve(x, y, tokW(fl), 14); i++; }
  }
  for (const w of wl) {
    const q = sp[w.id]; if (!onScreen(q)) continue;
    const R = q.R, oc = colN(w.owner), selW = V.sel && V.sel.w && an[V.sel.w] === w.id, hov = V.hover && V.hover.w === w.id, moon = !!LAY.pos[w.id].parent, rr = Math.max(R + 3, moon ? 3.5 : 5);
    if (w.owner !== 'neu') { const hr = rr + (moon ? 11 : 19), cs = colS(w.owner), gr = ctx.createRadialGradient(q.x, q.y, rr * .5, q.x, q.y, hr); gr.addColorStop(0, cs + '80'); gr.addColorStop(.55, cs + '30'); gr.addColorStop(1, cs + '00'); // UI v2: who holds it, at a glance
      ctx.globalAlpha = w.owner === me ? 1 : .8; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(q.x, q.y, hr, 0, PI * 2); ctx.fill();
      if (w.id === K.CAPITAL[w.owner]) { ctx.globalAlpha = .55; ctx.strokeStyle = cs; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, rr + 4.5, 0, PI * 2); ctx.stroke(); } ctx.globalAlpha = 1; }
    if (R < 2.5) G.screen().circle(q.x, q.y, moon ? 2.2 : 3).fill({ color: oc, alpha: .95 });
    G.screen().circle(q.x, q.y, rr).stroke({ width: selW ? 2.4 : hov ? 1.8 : 1.1, color: oc, alpha: selW || hov ? 1 : .7 });
    if (w.siege) G.screen().dashed(q.x, q.y, rr + 5, 5, 4).stroke({ width: 1.6, color: 0xff5a4a, alpha: .95 });
    if (K.wreckAt(w.id)) debris(ctx, q.x, q.y, rr + (w.siege ? 10 : 6), K.wreckAt(w.id));
    if (selW) { const s = rr + 9, l = 7; ctx.globalAlpha = 1; ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(q.x + dx * s, q.y + dy * s - dy * l); ctx.lineTo(q.x + dx * s, q.y + dy * s); ctx.lineTo(q.x + dx * s - dx * l, q.y + dy * s); } ctx.stroke(); }
    // moons folded into this planet: one pip each, coloured by holder
    const folded = Object.keys(C.worlds).filter(id => id !== w.id && an[id] === w.id);
    folded.forEach((id, i) => { const ang = -PI / 2 + (i - (folded.length - 1) / 2) * .42; G.screen().circle(q.x + Math.cos(ang) * (rr + 6), q.y + Math.sin(ang) * (rr + 6), 2.6).fill({ color: colN(C.worlds[id].owner), alpha: 1 }); });
    const tags = (w.siege ? ' ⚔' : '') + (w.bq.length || w.sq.length ? ' ⚒' : '') + (w.id === K.CAPITAL[w.owner] ? ' ★' : '');
    const crowd = moon && Math.hypot(q.x - sp[LAY.pos[w.id].parent].x, q.y - sp[LAY.pos[w.id].parent].y) < 70; // a moon hugging its planet gives way; one with room keeps its name
    label(nm(w.id).toUpperCase() + tags, q.x, q.y + rr + (selW ? 12 : 7), w.owner === 'neu' ? 0xbfc4c8 : oc, !moon, crowd ? 'skip' : true);
    V.hit.push({ x: q.x, y: q.y, r: Math.max(rr + 6, 12), w: w.id });
    // Total War's movement range: weeks to get here from the selected fleet, a line under the world's name (the label
    // system steps it clear of the name and the tokens, so nothing writes over anything)
    if (sf && sf.owner === me && !sf.transit && an[sf.at] !== w.id) {
      const n = K.moveWeeks(sf, w.id), c = n <= 1 ? 0x7fe08a : n <= 3 ? 0xf2c14e : n <= 5 ? 0xff9a5a : 0xff6a5a;
      label(n + (n === 1 ? ' week' : ' weeks'), q.x, q.y + rr + 21, c, false, true);
    }
  }
  for (const fl of C.fleets) if ((fl.transit || fl.engage) && vis(fl) && !(V.replay && V.replay.ids.has(fl.id))) { const p = fleetPos(fl), q = P2(p.x, p.y); if (onScreen(q)) token(ctx, fl, q.x - 16, q.y - 7); }
  // the week's enemy moves, replayed: each token slides from where it was to where it is now
  if (V.replay) { const R0 = V.replay, k0 = clamp((performance.now() - R0.t0) / R0.dur, 0, 1), k = k0 < .5 ? 2 * k0 * k0 : 1 - Math.pow(-2 * k0 + 2, 2) / 2;
    for (const e of R0.L) { const a = P2(e.p0.x, e.p0.y), b = P2(e.p1.x, e.p1.y), x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k; if (!a.ok || !b.ok) continue;
      ctx.globalAlpha = .55 * (1 - k * .5); ctx.strokeStyle = e.threat ? '#ff6a5a' : colS(e.fl.owner); ctx.lineWidth = 1.6; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      if (e.threat) { ctx.globalAlpha = .9 * (1 - k0) + .2; ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + 4, y, 14 + 8 * Math.sin(performance.now() / 120), 0, 6.3); ctx.stroke(); }
      token(ctx, e.fl, x - 16, y - 7); } }
  for (const W of Object.values(C.wrecks || {})) if (!W.at) { const p = IN.locPos(W.loc, LP), q = P2(p.x, p.y); if (onScreen(q)) { debris(ctx, q.x, q.y, 7, W); } }
  for (const e of C.engage || []) { const p = IN.locPos(e.loc, LP), q = P2(p.x, p.y); if (!onScreen(q)) continue; ctx.globalAlpha = .95; ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(q.x - 7, q.y - 7); ctx.lineTo(q.x + 7, q.y + 7); ctx.moveTo(q.x + 7, q.y - 7); ctx.lineTo(q.x - 7, q.y + 7); ctx.stroke(); }
  const mem = C.intel && C.intel[me];
  if (mem) for (const id in mem) { const m = mem[id]; if (m.lvl) continue; const fl = C.fleets.find(x => x.id === +id); if (fl && vis(fl)) continue;
    const p = IN.locPos(m.loc, LP), q = P2(p.x, p.y); if (!onScreen(q)) continue; tokenBox(ctx, colS(m.owner), '? ' + m.n, q.x - 16, q.y - 7, false, false, { ghost: +id }, .38, true); }
  ctx.globalAlpha = 1;
}
// a wreck field: a ring of drifting hulks round the world, or round the point in deep space where they died
function debris(ctx, x, y, R, W) {
  const n = Math.min(30, 10 + W.n * 2), t = performance.now() / 9000, fade = clamp((W.until - C.turn) / 6, .35, 1); R += 3;
  ctx.save(); ctx.globalAlpha = .75 * fade;
  for (let i = 0; i < n; i++) { const h = (i * 2.399 + W.t * .7) % (PI * 2), a = h + t * (i % 2 ? 1 : -.7), r = R + 2 + ((i * 37) % 9), sz = 1.3 + (i % 3) * .7;
    ctx.fillStyle = i % 4 ? '#b8a48a' : '#ff9a5a'; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r * .92, sz * 1.6, sz, a, 0, PI * 2); ctx.fill(); }
  ctx.globalAlpha = .28 * fade; ctx.strokeStyle = '#b8a48a'; ctx.lineWidth = 1; ctx.setLineDash([1.5, 3.5]); ctx.beginPath(); ctx.arc(x, y, R + 5, 0, PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
}
function tokenBox(ctx, col, txt, x, y, mine, sel, ref, alpha = .92, est = false) {
  const w = 14 + txt.length * 7, h = 14, tip = mine ? 6 : 0;
  ctx.globalAlpha = alpha; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); if (tip) ctx.lineTo(x + w + tip, y + h / 2); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  ctx.fillStyle = mine ? 'rgba(14,12,18,.92)' : 'rgba(8,10,16,.85)'; ctx.fill(); ctx.fillStyle = col; ctx.fillRect(x, y, 4, h);
  if (est) ctx.setLineDash([2, 2]); ctx.strokeStyle = sel ? '#f2c14e' : mine ? col : 'rgba(255,255,255,.3)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke(); ctx.setLineDash([]);
  if (sel) { ctx.globalAlpha = .35; ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = alpha; }
  ctx.font = '600 10.5px ui-monospace,Consolas,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = mine ? '#fff' : est ? '#bdb8ac' : '#d8d4c8'; ctx.fillText(txt, x + 8, y + h / 2 + .5);
  V.tok.push(Object.assign({ x, y, w: w + tip, h }, ref));
}
const tokTxt = fl => { if (fl.owner !== C.player && vis(fl) === 1) return '≈' + estN(fl) + '?'; const c = CM.cmdrOf(fl); return (fl.transit && fl.transit.retreat ? '↩' : '') + (fl.transit && fl.transit.sortie ? '⌖' : '') + (fl.transit && fl.transit.mode === 'dark' ? '◌' : '') + (c ? '★'.repeat(Math.min(c.rank + 1, 3)) + ' ' : '') + fl.ships.length; };
const tokW = fl => 14 + tokTxt(fl).length * 7 + (fl.owner === C.player ? 6 : 0);
function token(ctx, fl, x, y) {
  const txt = tokTxt(fl);
  tokenBox(ctx, colS(fl.owner), txt, x, y, fl.owner === C.player, V.sel && V.sel.fl === fl, { fl }, .92, fl.owner !== C.player && vis(fl) === 1);
  if (fl.stance === 'picket') { ctx.globalAlpha = .8; ctx.strokeStyle = colS(fl.owner); ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.strokeRect(x - 3, y - 3, 20 + txt.length * 7, 20); ctx.setLineDash([]); }
  if (fl.owner === C.player && !fl.transit && !CM.inSupply(fl)) { ctx.globalAlpha = 1; ctx.fillStyle = '#ff6a5a'; ctx.strokeStyle = '#0a0c12'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + 14 + txt.length * 7, y, 3.5, 0, 6.3); ctx.fill(); ctx.stroke(); }
}
// frame a world, a planet's moon system, or the inner system
// the part of the screen the map can be seen in: below the top bar, above the selection panel when it is open
function viewBand() { const el = $('sinfo'), open = el && !el.classList.contains('hide'); const top = 56, bot = open ? S.H - (V.imin ? 64 : 236) : S.H - 24; return { top, bot, h: Math.max(200, bot - top) }; }
// put world point (x, y) at the middle of the visible band, not the middle of the screen
function centreOn(x, y) { const B = viewBand(); S.cam.x = x; S.cam.y = y; const [wx, wy] = toWorld(S.W / 2, (B.top + B.bot) / 2); S.cam.x += x - wx; S.cam.y += y - wy; }
function zoomTo(t) {
  const H = viewBand().h; hideTip();
  if (t === 'inner') { S.cam.z = H * .42 / (1.65 * AU); return centreOn(0, 0); }
  const P = LAY.pos[t], b = bodyOf(t), host = P.parent ? P.parent : t, moons = BODIES.filter(m => m.parent != null && BODIES[m.parent].id === host);
  if (!P.parent && moons.length && S.cam.z < H * .3 / (Math.max(...moons.map(m => m.orbitR)) * 1.25)) { const hp = LAY.pos[host]; S.cam.z = H * .4 / (Math.max(...moons.map(m => m.orbitR)) * 1.25); return centreOn(hp.x, hp.y); }
  S.cam.z = clamp(H * .14 / b.r, 2.2e-6, .25); centreOn(P.x, P.y);
}

// ---------------------------------------------------------------- entering and leaving
export function startCampaign(playerFk, difficulty, start, opts) {
  const f = { rising: 'rep', core: 'soc', rim: 'rim' }[playerFk] || 'rep';
  setupBodies(); K.newCampaign(f, difficulty, start, opts);
  enterStrat();
  const hero = C.start && C.cmdrs.find(c => c.hero && c.owner === f && c.state === 'fleet'), hf = hero && C.fleets.find(x => x.id === hero.fleet);
  const main = hf || C.fleets.filter(x => x.owner === f).sort((a, b) => K.fleetStr(b) - K.fleetStr(a))[0];
  V.sel = main ? { fl: main } : { w: K.CAPITAL[f] }; V.mark = new Set(); homeView();
  refresh(); setTimeout(() => briefing(f), 400); autosave();
}
// a saved campaign, put back in place: the map is laid out again and the strongest fleet selected
export function loadCampaign(d) {
  setupBodies(); SV.restore(d); V.busy = false; V.drag = null; V.hover = null;
  enterStrat();
  const f = C.player, main = C.fleets.filter(x => x.owner === f).sort((a, b) => K.fleetStr(b) - K.fleetStr(a))[0];
  V.sel = main ? { fl: main } : { w: K.CAPITAL[f] }; V.mark = new Set(); homeView(); refresh();
  toastS(`${date(C.turn)} · campaign loaded`, 'good');
}
function autosave() { if (!C.on || C.over) return; const e = SV.saveSlot('auto'); if (e) console.warn(e); }
// the first thing a new campaign shows: who you are, who the enemy is, and three things to do first
const BRIEF = {
  rep: { who: 'Sovereign Virginia au Augustus of the Solar Republic', text: 'The tenth year of the war. Against the Senate’s vote, Darrow has taken the White Fleet and the Morning Star to Mercury, where the Free Legions fight for Heliopolis. The Society Remnant’s Ash Armada waits at Venus under Atalantia au Grimmus. The Rim keeps its peace, and watches.',
    steps: ['Break the Heliopolis garrison over Mercury, then hold the siege until its defences break and drop the Iron Rain.', 'Keep a fleet at Luna: the Ash Armada will strike at the capital within weeks.', 'Watch the Senate (C): it will vote to recall Darrow. If it does, give the White Fleet to Orion.'] },
  soc: { who: 'Atalantia au Grimmus, for the Society Remnant', text: 'Your father the Ash Lord is dying on Venus. The Reaper has come to Mercury with the Morning Star and lays siege to Heliopolis. The Republic’s capital, Luna, lies a few weeks from Venus with its main fleet away.',
    steps: ['Decide on Mercury: relieve Heliopolis with the Ash Armada, or let it go and strike at Luna while Darrow is away.', 'Keep the Houses content (C): Grimmus wants war, Carthii wants its yards, Saud wants trade.', 'Build at Venus: its yards are the Remnant’s heart, and it must not fall.'] },
  rim: { who: 'Sovereign Romulus au Raa of the Rim Dominion', text: 'The Rim is at peace with both the Republic and the Remnant, and the Moon Lords mean to keep their independence. The Republic grows strong; every world it takes raises the Moon Lords’ alarm, and the Remnant will come asking for an alliance.',
    steps: ['Arm the Dominion: lay down hulls at Ganymede and Io while the Core bleeds itself.', 'Keep the Moon Lords together (C): a council that loses faith in you will put you on trial.', 'Choose your war: when the alarm runs high, the Remnant’s offer comes. Strike when the Republic is weakest.'] },
};
function briefing(f) { const B = SR.brief(f) || BRIEF[f]; if (!B || modalOpen()) return toastS('Click a fleet or world · right-click to send a fleet · Enter ends the turn', '');
  modal(`<div class="kicker">${date(C.turn)} · the briefing</div><h2>${esc(B.who)}</h2><p>${esc(B.text)}</p><div class="sec">First, three things</div><ol class="brief">${B.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><p class="dim">Click a fleet or world to select it · right-click to send a fleet · Enter ends the turn · hover anything for what it does.</p>`, [['ok', 'To war', 'go']], { esc: 'ok', enter: 'ok', cls: 'wide' }); }
export function enterStrat() {
  LAY = layout(); /* the planets may have moved since the map was last laid out */
  setupFactions(K.BLOCS[C.player], K.BLOCS[C.player] === 'core' ? 'rising' : 'core');
  S.scam = S.scam || { x: 0, y: 0, z: 1e-4 }; S.cam = S.scam; S.orrery = LAY; S.gameState = 'strat'; S.paused = false; S.selection = [];
  document.body.classList.add('strat'); document.body.classList.remove('battle'); document.body.dataset.fac = C.player;
  buildStratDOM(); V.dirty = true;
}
function homeView() { const cap = K.CAPITAL[C.player]; if (INNER.has(cap)) zoomTo('inner'); else { const host = LAY.pos[cap].parent || cap; S.cam.z = 1e-9; zoomTo(host); } }
export function leaveStrat() { S.orrery = null; document.body.classList.remove('strat'); }

// ---------------------------------------------------------------- DOM
// The campaign interface follows the Total War campaign layout: a thin top bar for the treasury and the
// powers; the selected fleet or world in a panel along the bottom, its ships and buildings shown as cards;
// the end-turn button bottom-right, ringed by the screens and by the things that still need orders.
let built = false;
const LEADER2 = { rep: 'ArchImperator Darrow au Andromedus', soc: 'Atalantia au Grimmus commands the fleets', rim: 'Ruling from Sungrave, on Io' };
const RELT = { war: 'At war', peace: 'At peace', ally: 'Allied' };
function buildStratDOM() {
  if (built) return; built = true;
  const mk = (id, cls) => { const d = document.createElement('div'); d.id = id; d.className = 'panel sv ' + (cls || ''); document.body.appendChild(d); return d; };
  for (const id of ['stop', 'sinfo', 'send', 'sfeed', 'slist', 'sobj', 'srail']) mk(id).addEventListener('click', onClick);
  { const h = document.createElement('div'); h.id = 'shint'; h.className = 'sv'; document.body.appendChild(h); } // UI v2: what a click does right now
  $('sinfo').addEventListener('contextmenu', e => { const x = e.target.closest('[data-bk],[data-si]'); if (!x || !V.sel || !V.sel.w) return; e.preventDefault();
    onClick({ target: { closest: () => ({ dataset: x.dataset.bk ? { bcancel: x.dataset.bk } : { scancel: x.dataset.si }, disabled: false }) } }); });
  mk('spop', 'hide').addEventListener('click', onClick);
  mk('smodal', 'hide'); $('smodal').addEventListener('click', onClick); $('smodal').addEventListener('input', onInput); $('smodal').addEventListener('change', onInput);
  const tip = document.createElement('div'); tip.id = 'stip'; tip.className = 'sv hide'; document.body.appendChild(tip);
  const tt = document.createElement('div'); tt.id = 'sturn'; tt.className = 'sv hide'; document.body.appendChild(tt);
  // rich tooltips: any element with data-tip
  addEventListener('mouseover', e => { if (S.gameState !== 'strat') return; const t = e.target.closest && e.target.closest('[data-tip]'); V.tipEl = t; if (t) showTip(t.dataset.tip, e.clientX, e.clientY); else if (e.target !== $('c')) hideTip(); });
  const cv = $('c');
  cv.addEventListener('mousedown', e => { if (S.gameState !== 'strat' || modalOpen()) return; closePop(); hideTip(); if (e.button === 0 || e.button === 1) V.drag = { x: e.clientX, y: e.clientY, moved: false, w: toWorld(e.clientX, e.clientY) }; });
  addEventListener('mousemove', e => {
    if (S.gameState !== 'strat') return; S.mouse.x = e.clientX; S.mouse.y = e.clientY;
    if (V.drag) { if (Math.hypot(e.clientX - V.drag.x, e.clientY - V.drag.y) > 4) V.drag.moved = true; if (V.drag.moved) { const p = toWorld(e.clientX, e.clientY); S.cam.x += V.drag.w[0] - p[0]; S.cam.y += V.drag.w[1] - p[1]; } }
    if (V.tipEl) { placeTip(e.clientX, e.clientY); return; }
    V.hover = e.target === cv ? pick(e.clientX, e.clientY) : null; cv.style.cursor = V.hover ? 'pointer' : V.drag && V.drag.moved ? 'grabbing' : 'default';
    if (e.target === cv) { const h = V.hover; if (h && !V.drag) { const html = h.fl ? fleetTip(h.fl) : h.ghost ? ghostTip(h.ghost) : h.w ? worldTip(C.worlds[h.w]) : h.zoom ? '<b>The inner system</b><div class="tdim">Click to zoom in</div>' : ''; if (html) showTip(html, e.clientX, e.clientY, true); } else hideTip(); }
  });
  addEventListener('mouseup', e => {
    if (S.gameState !== 'strat') return; const d = V.drag; V.drag = null; if (!d || d.moved || e.target !== cv || e.button !== 0) return;
    const h = pick(e.clientX, e.clientY); if (h && h.zoom) { zoomTo(h.zoom); return; } select(h && !h.ghost ? (h.fl ? { fl: h.fl } : { w: h.w }) : null); if (h) sfx && sfx('click');
  });
  cv.addEventListener('dblclick', e => { if (S.gameState !== 'strat') return; const h = pick(e.clientX, e.clientY); if (h && (h.w || h.zoom)) zoomTo(h.w || h.zoom); });
  cv.addEventListener('contextmenu', e => { if (S.gameState !== 'strat') return; e.preventDefault(); const h = pick(e.clientX, e.clientY); const fl = V.sel && V.sel.fl; if (!fl || fl.owner !== C.player || !h) return; if (h.fl && h.fl.owner !== C.player && h.fl.transit && !h.fl.engage) return intercept(fl, h.fl); const to = h.w || (h.fl && (h.fl.at || null)); if (to) order(fl, to, e.shiftKey); });
  cv.addEventListener('wheel', e => {
    if (S.gameState !== 'strat') return; e.preventDefault(); hideTip();
    const b = toWorld(e.clientX, e.clientY); S.cam.z = clamp(S.cam.z * Math.exp(-e.deltaY * .0014), 2.2e-6, .25); const a = toWorld(e.clientX, e.clientY); S.cam.x += b[0] - a[0]; S.cam.y += b[1] - a[1];
  }, { passive: false });
  addEventListener('keydown', e => {
    if (S.gameState !== 'strat' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (modalOpen()) { if (e.key === 'Escape' && M.esc) closeModal(M.esc); else if (e.key === 'Enter' && M.enter) closeModal(M.enter); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (!V.busy) savesUI('save'); return; } /* Ctrl+S: the save slots */
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; V.keys[k] = true;
    if (e.key === 'Enter') endTurnUI();
    else if (e.key === 'Escape') { if (!$('spop').classList.contains('hide')) closePop(); else if (V.list) toggleList(); else select(null); }
    else if (e.key === ' ' || e.key === 'Home') { homeView(); e.preventDefault(); }
    else if (e.key === 'Tab') { e.preventDefault(); const mine = C.fleets.filter(f => f.owner === C.player); if (mine.length) { const i = (mine.indexOf(V.sel && V.sel.fl) + 1) % mine.length; select({ fl: mine[i] }, true); } }
    else if (k === 't') techUI();
    else if (k === 'y') classUI();
    else if (k === 'c') courtUI();
    else if (k === 'f') factionUI(); else if (k === 'h') ledgerUI(); else if (k === 'p') diploUI(); else if (k === 'l') toggleList(); else if (k === 'r') toggleFeed();
    else if (k === 'q' && V.sel && V.sel.w) { e.preventDefault(); popRecruit(); }
  });
  addEventListener('keyup', e => { V.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
}
function select(sel, focus) {
  if (sel && sel.tech) return techUI();
  if (sel && sel.court) { V.ctab = 'ag'; return courtUI(); }
  V.sel = sel; V.mark = new Set(); closePop(); hideTip(); // a folded panel stays folded until unfolded
  if (focus && sel) { const p = sel.fl ? fleetPos(sel.fl) : LAY.pos[sel.w]; $('sinfo').classList.remove('hide'); centreOn(p.x, p.y); if (sel.w && S.cam.z < 1e-4) zoomTo(sel.w); }
  refresh();
}
function pick(sx, sy) {
  for (let i = V.tok.length - 1; i >= 0; i--) { const t = V.tok[i]; if (sx >= t.x && sx <= t.x + t.w && sy >= t.y && sy <= t.y + t.h) return t.fl ? { fl: t.fl } : t.ghost ? { ghost: t.ghost } : { zoom: t.zoom }; }
  let best = null, bd = 1e9; for (const h of V.hit || []) { const d = Math.hypot(sx - h.x, sy - h.y); if (d < h.r && d - h.r < bd) { bd = d - h.r; best = h; } }
  return best ? (best.w ? { w: best.w } : { zoom: best.zoom }) : null;
}
// fleets in orbit, as their hulls: every world close enough on screen has the fleets there (ours, and those we track)
// circling it in loose columns, the biggest hulls leading; each fleet keeps its own orbit and pace
const STYLEK = { rep: 'rising', soc: 'core', rim: 'rim' }, NEUC = { main: '#9aa0a6', hi: '#c8ccd0', lo: '#2a2c30', d1: '#202124', d2: '#2c2e32' };
function parade() {
  const out = [], rings = []; S.parade = out; V.rings = rings; if (!LAY || !C.on) return;
  const t = performance.now() / 1000, me = C.player;
  for (const id in C.worlds) {
    const P = LAY.pos[id], q = P2(P.x, P.y); if (!onScreen(q)) continue; const Rpx = P.r * q.k; if (Rpx < 16) continue;
    const here = C.fleets.filter(f => !f.transit && !f.engage && f.at === id && f.ships.length && (f.owner === me || vis(f) === 2));
    here.forEach((fl, fi) => {
      const fac = STYLEK[fl.owner] || 'none', col = fl.owner === 'neu' ? NEUC : FACTIONS[K.BLOCS[fl.owner]].col, cmd = CM.cmdrOf(fl);
      const ships = fl.ships.slice().sort((a, b) => (ICON_SCALE[b.t] || 4) - (ICON_SCALE[a.t] || 4)).slice(0, 30);
      const lenPx = s => Math.min(Rpx * .6, 10 + (ICON_SCALE[s.t] || 4) * 4), lead = lenPx(ships[0]) / q.k;
      const R = P.r * 1.32 + lead * 1.4 + fi * lead * 2.4, dir = fi % 2 ? -1 : 1, ph = (fl.id * 2.399) % (Math.PI * 2) + dir * t * .05 / (1 + fi * .25);
      rings.push({ x: P.x, y: P.y, R, col: col.main, mine: fl.owner === me });
      ships.forEach((s, i) => {
        const L = lenPx(s) / q.k, col3 = i % 3, rank = Math.floor(i / 3), ang = ph - dir * rank * lead * 1.25 / R - dir * (col3 === 1 ? lead * .45 / R : 0), r = R + (col3 - 1) * lead * .75;
        const tags = s.cls ? (TE.classSpec(fl.owner, s.cls) || {}).tags : '', spear = s.t === 'dread' && i === 0 && cmd && /Atalantia/.test(cmd.name);
        out.push({ id: s.id, type: s.t, fac, col, x: P.x + Math.cos(ang) * r, y: P.y + Math.sin(ang) * r, a: ang + dir * Math.PI / 2, vr: L / 2.4, vt: (spear ? 'spear' : '') + (tags ? '|' + tags : '') });
      });
    });
  }
}
export function stratFrame(dt) {
  if (V.pan) { const P0 = V.pan, k = clamp((performance.now() - P0.t0) / P0.dur, 0, 1), e = 1 - Math.pow(1 - k, 3); S.cam.x = P0.x0 + (P0.x1 - P0.x0) * e; S.cam.y = P0.y0 + (P0.y1 - P0.y0) * e; }
  parade();
  const k = V.keys, sp = 700 / S.cam.z * dt;
  if (!modalOpen()) { if (k.a || k.ArrowLeft) S.cam.x -= sp; if (k.d || k.ArrowRight) S.cam.x += sp; if (k.w || k.ArrowUp) S.cam.y -= sp; if (k.s || k.ArrowDown) S.cam.y += sp; }
  S.cam.x = clamp(S.cam.x, -45 * AU, 45 * AU); S.cam.y = clamp(S.cam.y, -45 * AU, 45 * AU);
  if (V.dirty) { V.dirty = false; if (V.sel && V.sel.fl && !C.fleets.includes(V.sel.fl)) V.sel = null; K.checkObjectives(); drawTop(); drawObj(); drawInfo(); drawEnd(); drawFeed(); if (V.list) drawList(); if (V.tipEl && !document.contains(V.tipEl)) hideTip(); }
}
const refresh = () => { V.dirty = true; };

function order(fl, to, forced) {
  if (fl.levy) return toastS(`${fl.name} follows ${P.defOf('soc', fl.levy) ? P.defOf('soc', fl.levy).name : 'its House'}, not your orders`, 'bad');
  if (fl.raid) fl.raid = null;
  if (fl.transit) { if (fl.transit.left === fl.transit.total && !fl.transit.retreat) { fl.at = fl.transit.from; fl.transit = null; } else return toastS('Already under way: a fleet in transit cannot turn back', 'bad'); }
  if (fl.at === to) { refresh(); return; }
  const e = K.moveFleet(fl, to, forced); if (e) return toastS(e, 'bad');
  const n = fl.transit.total, rel = C.worlds[to].owner === C.player ? '' : ' · ' + RELT[K.relOf(C.player, C.worlds[to].owner)].toLowerCase();
  toastS(`${fl.name} sets course for ${nm(to)}${forced ? ' at a forced burn' : ''}: ${n} week${n > 1 ? 's' : ''}${C.worlds[to].owner === 'neu' ? '' : rel}`, ''); refresh();
}
function intercept(fl, tg) {
  if (fl.levy) return toastS(`${fl.name} follows its House, not your orders`, 'bad');
  const lv = vis(tg), e = K.orderIntercept(fl, tg); if (e) return toastS(`Cannot intercept: ${e}`, 'bad');
  const so = fl.transit.sortie; toastS(`${fl.name} moves to intercept ${lv === 2 ? tg.name : 'the contact'}: on their course in ${so.w} week${so.w > 1 ? 's' : ''}, ${Math.round(so.chance * 100)}% to find them`, 'gold'); sfx && sfx('click'); refresh();
}
function toastS(msg, cls) { const t = $('toasts'); if (!t) return; const d = document.createElement('div'); d.className = 'toast ' + (cls || ''); d.textContent = msg; t.appendChild(d); setTimeout(() => d.remove(), 3200); }

// ---------------------------------------------------------------- tooltips
const tipA = html => esc(html);
function showTip(html, x, y, raw) { const t = $('stip'); t.innerHTML = raw ? html : html; t.classList.remove('hide'); placeTip(x, y); }
function placeTip(x, y) { const t = $('stip'), w = t.offsetWidth, h = t.offsetHeight; t.style.left = Math.min(S.W - w - 8, x + 16) + 'px'; t.style.top = (y + h + 22 > S.H ? y - h - 12 : y + 18) + 'px'; }
function hideTip() { $('stip').classList.add('hide'); V.tipEl = null; }
function worldTip(w) {
  const me = C.player, here = K.fleetsAt(w.id), sf = V.sel && V.sel.fl;
  let h = `<div class="th" style="--fc:${colS(w.owner)}">${nm(w.id)}${w.id === K.CAPITAL[w.owner] ? ' ★' : ''}</div><div class="tdim">${K.BLOC_NAME[w.owner]}${w.owner !== me && w.owner !== 'neu' ? ' · ' + RELT[K.relOf(me, w.owner)] : ''}</div>`;
  h += `<div class="trow"><span>Loyalty</span><b>${Math.round(w.loyalty)}%${w.unrest ? ` · <i class='bad'>${w.unrest} restless</i>` : ''}</b></div><div class="trow"><span>Garrison</span><b>${fmt(w.garrison)}</b></div><div class="trow"><span>Defences</span><b>${w.gun} gun · ${w.shield} shield</b></div>`;
  if (w.siege) h += `<div class="tbad">Besieged by ${K.BLOC_NAME[w.siege.by]} · ${w.siege.turns} wk</div>`;
  { const W = K.wreckAt(w.id); if (W) h += `<div class="tgold">Wreck field: ${W.n} hulks · ${fmt(W.ore)} ore, ${fmt(W.alloy)} alloys to salvage · ${Math.max(0, W.until - C.turn)} wk</div><div class="tdim">Battles here are fought among the wrecks. Haulers in orbit salvage it each week.</div>`; }
  if (w.client) h += `<div class="tgold">A free client world of the Republic</div>`; if (w.fief) h += `<div class="tgold">A fief of ${esc(P.defOf('soc', w.fief) ? P.defOf('soc', w.fief).name : 'a House')}</div>`; if (w.hostage > C.turn) h += `<div class="tgold">Hostages held at Io: no revolt for ${w.hostage - C.turn} wk</div>`;
  for (const f of here) { const v = f.owner === me ? 2 : vis(f); if (!v) continue; h += v === 2 ? `<div class="trow"><span style="color:${colS(f.owner)}">${esc(f.name)}</span><b>${f.ships.length} ships</b></div>` : `<div class="trow"><span style="color:${colS(f.owner)}">A contact</span><b>~${estN(f)} ships</b></div>`; }
  { const y = K.yieldOf(w), ks = RES.filter(([k]) => Math.abs(y[k]) >= .5).slice(0, 6); if (ks.length) h += `<div class="tyld">${ks.map(([k, n, c]) => `<span><i style="color:${c}">${RSH[k]}</i>${sgn(y[k])}</span>`).join('')}</div>`; }
  if (w.owner === me) { const bq = w.bq[0], sq = w.sq.length; h += `<div class="trow"><span>Slots</span><b>${K.usedSlots(w)} / ${w.slots}${bq ? ` · ${esc(K.BUILD[bq.k].name)} ${bq.left} wk` : ''}${sq ? ` · ${sq} in the yards` : ''}</b></div>`; }
  if (sf && sf.owner === me && !sf.transit && sf.at !== w.id) { const n = K.travel(sf.at, w.id); h += `<div class="tgold">${esc(sf.name)}: ${n} week${n > 1 ? 's' : ''} · right-click to send</div>`; }
  h += `<div class="tdim tact">Click to select · double-click to zoom</div>`;
  return h;
}
const kindOf = fl => { const v = fl.ships.reduce((a, s) => a + ((K.defsOf(fl.owner)[s.t] || {}).value || 50), 0); return v > 4000 ? 'a great armada' : v > 1800 ? 'a strong fleet' : v > 700 ? 'a fleet' : 'a small squadron'; };
function interceptLine(tg) {
  const sf = V.sel && V.sel.fl; if (!sf || sf.owner !== C.player || !tg.transit || tg.engage || tg.owner === C.player) return '';
  const p = K.planIntercept(sf, tg); return typeof p === 'string' ? `<div class="tbad">${esc(sf.name)} cannot intercept: ${esc(p)}</div>` : p.meet ? `<div class="tgold">Right-click: ${esc(sf.name)} cannot catch them on the way, but can be waiting at ${nm(p.meet)} in ${p.w} wk</div>` : `<div class="tgold">Right-click: ${esc(sf.name)} intercepts on their course in ${p.w} wk · ${Math.round(p.chance * 100)}% to find them</div>`;
}
function ghostTip(id) { const m = C.intel[C.player][id], wk = C.turn - m.seen;
  return `<div class="th" style="--fc:${colS(m.owner)}">Lost contact</div><div class="tdim">${K.BLOC_NAME[m.owner]} · about ${m.n} ships · last seen ${wk} week${wk > 1 ? 's' : ''} ago${m.to ? ', bound for ' + nm(m.to) : m.moving ? ', under way' : typeof m.loc === 'string' ? ' at ' + nm(m.loc) : ''}</div><div class="tdim">Out of sensor range, or running dark. Pickets, Sensor Pickets in your fleets and spies watching the enemy's docks find them again.</div>`; }
function fleetTip(fl) {
  if (fl.owner !== C.player && vis(fl) === 1) return `<div class="th" style="--fc:${colS(fl.owner)}">Contact</div><div class="tdim">${K.BLOC_NAME[fl.owner]} drive signatures · ${kindOf(fl)}, about ${estN(fl)} ships${fl.transit ? ', under way' : ' in orbit at ' + nm(fl.at)}</div><div class="tdim">Too far for a firm track: no names, no destination. Get closer, or bring Sensor Pickets.</div>` + interceptLine(fl);
  const by = {}; for (const s of fl.ships) by[s.t] = (by[s.t] || 0) + 1; const defs = K.defsOf(fl.owner);
  return `<div class="th" style="--fc:${colS(fl.owner)}">${esc(fl.name)}</div><div class="tdim">${K.BLOC_NAME[fl.owner]} · ${fl.engage ? 'locked in battle in deep space' : fl.transit ? (fl.transit.sortie ? 'moving to intercept, ' : fl.transit.ret ? 'returning to ' + nm(fl.transit.to) + ', ' : (fl.transit.retreat ? 'retreating to ' : 'bound for ') + nm(fl.transit.to) + ', ') + fl.transit.left + ' wk' + (fl.transit.mode === 'dark' ? ' · running dark' : fl.transit.mode === 'hard' ? ' · hard burn' : '') : 'at ' + nm(fl.at)}</div>` +
    Object.entries(by).map(([t, n]) => `<div class="trow"><span>${defs[t] ? defs[t].name : t}</span><b>×${n}</b></div>`).join('') + `<div class="trow"><span>Strength</span><b>${fmt(K.fleetStr(fl))}</b></div>` + (CM.cmdrOf(fl) ? `<div class="trow"><span>Commander</span><b>${esc(CM.cmdrOf(fl).name)}</b></div>` : '') + (fl.owner === C.player && !fl.transit && !CM.inSupply(fl) ? `<div class="tbad">Out of supply: wearing down each week</div>` : '') + interceptLine(fl) + `<div class="tdim tact">${fl.owner === C.player ? 'Click to select · then right-click a world to send it' : 'Click for details'}</div>`;
}

// ---------------------------------------------------------------- the top bar
const SHIELD = (f, sz = 22) => sigilSVG(f, colS(f), sz);
function resTip(k, n) {
  const me = C.player, rows = []; let up = 0;
  for (const w of Object.values(C.worlds)) if (w.owner === me) { const v = K.yieldOf(w)[k]; if (Math.abs(v) >= 1) rows.push([nm(w.id), v]); }
  if (k === 'he') for (const f of C.fleets) if (f.owner === me) up += K.upkeep(f);
  rows.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const tot = rows.reduce((a, r) => a + r[1], 0) - up;
  const extra = { he: 'Fuel, energy and the coin of the realm. Fleets burn it as upkeep; trade and taxes bring it in.', ore: 'Hull metal for ships and buildings, and the feed of the Foundries.', ord: 'Slugs, missiles and nukes: every rearm draws on it.', man: 'Crews and legions for new hulls and garrisons.', food: 'A stockpile. Below zero there is famine: every estate loses loyalty, Reds most of all.',
    alloy: 'Refined by Foundries from ore: the keels of destroyers and capital ships, yards, guns and fortresses.', rare: 'Rare metals from deep mines on Mercury, Ceres, Europa and a few moons: torch drives, shield arrays, dreadnought keels.', inf: 'The favour of the Golds and the weight of your name. Spent on governors, designations, officers and, soon, diplomacy.', sci: 'The work of the Greens. Spent on technology.' }[k];
  let tr = null; if (k === 'he') { tr = EC.tradeSummary(me); }
  return `<div class="th">${n}</div><div class="tdim">${extra}</div>` + rows.slice(0, 7).map(([a, v]) => `<div class="trow"><span>${a}</span><b class="${v < 0 ? 'neg' : 'pos'}">${sgn(v)}</b></div>`).join('') +
    (rows.length > 7 ? `<div class="tdim">and ${rows.length - 7} more worlds</div>` : '') + (tr && tr.gross > 0 ? `<div class="trow"><span>Trade${tr.lost > 1 ? ', after pirates take ' + fmt(tr.lost) : ''}</span><b class="pos">${sgn(tr.net)}</b></div>` : '') + (k === 'inf' && EC.govsOf(me).length ? `<div class="trow"><span>Governors' households</span><b class="neg">${sgn(-EC.govsOf(me).length * 1.5)}</b></div>` : '') + (up ? `<div class="trow"><span>Fleet upkeep</span><b class="neg">${sgn(-up)}</b></div>` : '') + `<div class="trow tsum"><span>A week</span><b class="${(tot + (tr ? tr.net : 0)) < 0 ? 'neg' : 'pos'}">${sgn(K.income(me)[k])}</b></div>` + (EC.STORE[k] < 1e8 ? `<div class="tdim">Depots hold ${fmt(EC.STORE[k])}; above that, 6% of the excess spoils each week.</div>` : '');
}
const RGRP = [['Economy', ['he', 'ore', 'alloy', 'rare']], ['War', ['ord', 'man']], ['State', ['food', 'inf', 'sci']]];
const RELW = { war: 'At war', peace: 'Peace', ally: 'Allied', fallen: 'Fallen' };
function drawTop() {
  const me = C.player, r = C.fac[me].res, inc = K.income(me), wr = Math.round(C.weary[me] || 0);
  const rels = ['rep', 'soc', 'rim'].filter(f => f !== me).map(f => { const rel = C.fac[f].alive ? K.relOf(me, f) : 'fallen';
    return `<button class="relchip ${rel}" data-a="diplo" style="--fc:${colS(f)}" data-tip="${tipA(`<div class='th' style='--fc:${colS(f)}'>${K.BLOC_NAME[f]}</div><div class='tdim'>${C.leaders[f]}</div><div class='trow'><span>Relation</span><b>${rel === 'fallen' ? 'Fallen' : RELT[rel]}</b></div><div class='tdim'>Click for diplomacy (P)</div>`)}">${SHIELD(f, 20)}<span><b>${esc(K.BLOC_NAME[f].replace(/^The /, '').split(' ').slice(-1)[0])}</b><em>${RELW[rel]}</em></span></button>`; }).join('');
  const RD = Object.fromEntries(RES.map(x => [x[0], x]));
  const cell = k => { const [, n, c] = RD[k], low = r[k] <= 0 && inc[k] < 0, dry = inc[k] < 0 && r[k] + inc[k] * 3 < 0;
    return `<div class="sres ${low ? 'crit' : dry ? 'warn' : ''}" data-tip="${tipA(resTip(k, n) + (low ? `<div class='tbad'>Exhausted and still falling.</div>` : dry ? `<div class='tbad'>Runs out within three weeks at this rate.</div>` : ''))}"><i style="color:${c}">${n}</i><b>${fmt(r[k])}</b><em class="${inc[k] < 0 ? 'neg' : ''}">${sgn(inc[k])}</em></div>`; };
  $('stop').innerHTML = `<button class="btn ico" data-a="menu" data-tip="Menu (Esc)">≡</button>
    <div class="fbanner" data-a="faction" data-tip="${tipA('Faction summary (F)')}" style="--fc:${colS(me)}">${SHIELD(me, 28)}<div><b>${K.BLOC_NAME[me]}</b><span>${C.leaders[me]}</span></div></div>
    <div class="sres-row">${RGRP.map(([g, ks]) => `<div class="sgrp" data-g="${g}">${ks.map(cell).join('')}</div>`).join('')}</div>
    <div class="sp"></div>
    <div class="wchip ${wr > 40 ? 'bad' : wr > 25 ? 'warn' : ''}" data-tip="${tipA(`<div class='th'>War weariness ${wr}%</div><div class='tdim'>Rises with every week at war, every besieged world and every ship lost. Above 40%, loyalty falls on every world and manpower income shrinks.</div>`)}"><span>Weariness</span><div class="bar cap"><i style="width:${wr}%"></i><u style="left:40%"></u></div><b>${wr}%</b></div><div class="wchip navy ${K.navalUsed(me) > K.navalCap(me) ? 'bad' : ''}" data-tip="${tipA(`<div class='th'>Naval capacity ${Math.round(K.navalUsed(me))} / ${K.navalCap(me)}</div><div class='tdim'>How many hulls your yards, docks and crews can keep in service: 20, plus 8 for each level of your four greatest shipyards, 2 for each world and 15 for your capital. A frigate counts 1, a destroyer 2, a torchShip 3, a dreadnought 6, a moonBreaker 10, light craft half. Past capacity, the upkeep of every fleet climbs: double at a half over.</div>${K.navalMul(me) > 1 ? `<div class='tbad'>Upkeep ×${K.navalMul(me).toFixed(2)}</div>` : ''}`)}"><span>Navy</span><b>${Math.round(K.navalUsed(me))}<small>/${K.navalCap(me)}</small></b></div><div class="rels">${rels}</div>
    <div class="views"><button class="btn sm" data-a="vhome" data-tip="Your home system (Space)">Home</button><button class="btn sm" data-a="vinner" data-tip="Mercury out to the Belt">Inner</button><button class="btn sm" data-a="vall" data-tip="The whole Solar System">System</button><button class="btn sm key" data-a="legend" data-tip="What the marks on the map mean">Key</button></div>`;
}

// ---------------------------------------------------------------- the bottom-right: end turn, screens and what still needs orders
function needs() {
  const me = C.player, out = [];
  const idle = C.fleets.filter(f => f.owner === me && !f.transit && !(C.worlds[f.at].siege && C.worlds[f.at].siege.by === me));
  if (idle.length) out.push({ k: 'idle', lbl: 'idle', n: idle.length, ico: '⚑', tip: `${idle.length} fleet${idle.length > 1 ? 's' : ''} without orders`, list: idle.map(f => ({ fl: f })) });
  const mine = Object.values(C.worlds).filter(w => w.owner === me);
  const slots = mine.filter(w => !w.siege && !w.bq.length && K.usedSlots(w) < w.slots);
  if (slots.length) out.push({ k: 'slots', lbl: 'build', n: slots.length, ico: '⌂', tip: `${slots.length} world${slots.length > 1 ? 's' : ''} with free building slots and nothing under construction`, list: slots.map(w => ({ w: w.id })) });
  const yards = mine.filter(w => w.lv.yard > 0 && !w.siege && !w.sq.length);
  if (yards.length) out.push({ k: 'yards', lbl: 'yards', n: yards.length, ico: '⚒', tip: `${yards.length} idle shipyard${yards.length > 1 ? 's' : ''}`, list: yards.map(w => ({ w: w.id })) });
  const sieged = mine.filter(w => w.siege);
  if (sieged.length) out.push({ k: 'siege', lbl: 'siege', n: sieged.length, ico: '⚔', bad: true, tip: `${sieged.length} of your worlds under siege`, list: sieged.map(w => ({ w: w.id })) });
  const strikes = mine.filter(w => w.unrest && w.loyalty >= 35);
  if (strikes.length) out.push({ k: 'strike', lbl: 'strikes', n: strikes.length, ico: '✊', bad: true, tip: `${strikes.length} world${strikes.length > 1 ? 's' : ''} where an estate is restless or on strike`, list: strikes.map(w => ({ w: w.id })) });
  const unrest = mine.filter(w => w.loyalty < 35);
  if (unrest.length) out.push({ k: 'unrest', lbl: 'revolt', n: unrest.length, ico: '!', bad: true, tip: `${unrest.length} world${unrest.length > 1 ? 's' : ''} close to revolt (loyalty under 35%)`, list: unrest.map(w => ({ w: w.id })) });
  const ia = AG.agentsOf(me).filter(a => a.state === 'idle');
  if (ia.length) out.push({ k: 'agents', lbl: 'agents', n: ia.length, ico: '◐', tip: `${ia.length} agent${ia.length > 1 ? 's' : ''} awaiting orders`, list: [{ court: true }] });
  const rc = TE.pendingChoice(me);
  if (rc.length) out.push({ k: 'tech', lbl: 'research', n: rc.length, ico: '⚗', gold: true, tip: `${rc.length} field${rc.length > 1 ? 's' : ''} of research waiting for a project: ${rc.map(t => TE.TRACKS[t]).join(', ')}`, list: [{ tech: true }] });
  const rain = C.fleets.filter(f => f.owner === me && !f.transit && (o => !o.err && o.chance >= .5)(rainCheck(f)));
  if (rain.length) out.push({ k: 'rain', lbl: 'Rain', n: rain.length, ico: '☄', gold: true, tip: `Iron Rain ready, at even odds or better, over ${rain.map(f => nm(f.at)).join(', ')}`, list: rain.map(f => ({ fl: f })) });
  const threat = C.fleets.filter(f => K.hostile(f.owner, me) && f.transit && !f.engage && !f.transit.sortie && C.worlds[f.transit.to] && C.worlds[f.transit.to].owner === me && vis(f));
  if (threat.length) out.push({ k: 'threat', lbl: 'inbound', n: threat.length, ico: '➤', bad: true, tip: `${threat.length} hostile fleet${threat.length > 1 ? 's' : ''} inbound to your worlds`, list: threat.map(f => ({ fl: f })) });
  return out;
}
// what each kind of loose end reads as, once and many
const NEEDW = { idle: ['fleet idle', 'fleets idle'], slots: ['world can build', 'worlds can build'], yards: ['shipyard idle', 'shipyards idle'], siege: ['world besieged', 'worlds besieged'],
  strike: ['world restless', 'worlds restless'], unrest: ['near revolt', 'near revolt'], agents: ['agent idle', 'agents idle'], tech: ['research to pick', 'research to pick'],
  rain: ['Iron Rain ready', 'Iron Rains ready'], threat: ['enemy inbound', 'enemies inbound'] };
const SCREENS = [['faction', '⚜', 'Faction', 'F', 'Your power: the throne, taxes, regions and victory'], ['diplo', '☍', 'Diplomacy', 'P', 'War, peace and alliances with the other powers'], ['tech', '⚗', 'Research', 'T', 'Technology and traditions'],
  ['court', '♛', 'Court', 'C', 'The Houses, laws and your agents'], ['classes', '⚒', 'Ship classes', 'Y', 'Design how your hulls are fitted out'], ['list', '☰', 'Fleets & worlds', 'L', 'Every fleet, world and commander you hold'],
  ['ledger', '⌇', 'Ledger', 'H', 'The war in numbers, and the Chronicle'], ['feed', '✉', 'Dispatches', 'R', 'Every report, not just this week\'s']];
function drawRail() {
  const pend = { tech: TE.pendingChoice(C.player).length > 0, court: !!(C.motion && C.motion[C.player]) || AG.agentsOf(C.player).some(a => a.state === 'idle') };
  $('srail').innerHTML = `<div class="rh">Screens</div>` + SCREENS.map(([a, ic, l, k, t]) => `<button class="rbtn ${pend[a] ? 'pend' : ''} ${(a === 'list' && V.list) || (a === 'feed' && V.feedOpen) ? 'on' : ''}" data-a="${a}" data-tip="${tipA(`<div class='th'>${l}</div><div class='tdim'>${t}</div><div class='tgold'>Hotkey ${k}</div>`)}"><i>${ic}</i><span>${l}</span><kbd>${k}</kbd></button>`).join('');
}
function drawEnd() {
  const N = needs(); V.needs = N; drawRail();
  const row = (n, i) => { const w = NEEDW[n.k] || [n.lbl, n.lbl], cur = V.needI && V.needI.k === n.k && n.list.length > 1 ? ` <u>${V.needI.i + 1}/${n.list.length}</u>` : '';
    return `<button class="need ${n.bad ? 'bad' : ''} ${n.gold ? 'gold' : ''}" data-need="${i}" data-tip="${tipA(n.tip + `<div class=tdim>${n.list.length > 1 ? 'Click to step through them, one by one' : 'Click to go there'}</div>`)}"><span>${n.ico}</span><b>${n.n}</b><em>${n.n === 1 ? w[0] : w[1]}${cur}</em></button>`; };
  const urgent = N.filter(n => n.bad).length;
  $('send').innerHTML = `<div class="needs">${N.length ? `<div class="nh">${urgent ? `<b class="bad">${urgent} urgent</b> · ` : ''}Awaiting orders</div>` + N.map(row).join('') : `<div class="nh ok">All orders given</div>`}</div>
    <div class="ecore"><button class="endbtn ${urgent ? 'warn' : ''}" data-a="end" data-tip="${tipA(`<div class='th'>End the week</div><div class='tdim'>Every fleet moves, every battle is fought, every world pays.${N.length ? ` ${N.length} kind${N.length > 1 ? 's' : ''} of order still waiting.` : ''}</div><div class='tgold'>Hotkey Enter</div>`)}"><span>End turn</span><b>${C.turn}</b></button>
    <div class="edate">${date(C.turn)}</div></div>`;
  drawHint();
}
// the line under the map that says what a click does now (the panel's "teach the verbs where they are used")
// the map key: every mark the campaign map draws, in one place (the first-time player's "what is ≈8?")
function mapKey(anchor) {
  const me = colS(C.player), foe = colS(['rep', 'soc', 'rim'].find(f => f !== C.player));
  const tok = (txt, col, cls = '') => `<span class="ktok ${cls}" style="--fc:${col}">${txt}</span>`;
  const row = (sym, t, d) => `<div class="krow"><div class="ksym">${sym}</div><div><b>${t}</b><span>${d}</span></div></div>`;
  openPop(`<div class="ph">The map key <span>Esc closes</span></div><div class="kgrid">
    ${row(tok('★★ 8', me, 'mine'), 'Your fleet', 'Pennant in your colour. Stars are the commander\'s rank, the number its hulls. Click to select, then right-click a world to send it.')}
    ${row(tok('★★★ 11', foe), 'A tracked fleet', 'Seen clearly: its true size and, if moving, where it is bound.')}
    ${row(tok('≈13?', foe, 'est'), 'A contact', 'A drive signature at the edge of your sensors: an estimate, and only its heading.')}
    ${row(tok('? 6', foe, 'est ghost'), 'Last sighting', 'Where a fleet was when you last saw it. It may have moved.')}
    ${row(`<i class="kdot"></i>`, 'Out of supply', 'Hulls, crews and ammunition wear down each week. Bring it home or near a world you hold.')}
    ${row(`<i class="khalo" style="--fc:${me}"></i>`, 'Who holds a world', 'The glow is the holder\'s colour. A second thin ring marks a capital.')}
    ${row('<b class="kglyph">★</b>', 'Capital', 'Lose your capital and the war goes badly.')}
    ${row('<b class="kglyph bad">⚔</b>', 'Under siege', 'A dashed red ring: an enemy fleet holds the orbit.')}
    ${row('<b class="kglyph">⚒</b>', 'Building', 'Something is being built or laid down here.')}
    ${row('<span class="kwk">3 weeks</span>', 'Travel time', 'Shown under every world while one of your fleets is selected: green is close, red is far.')}
    ${row('<i class="kline"></i>', 'A fleet under way', 'Dashed line to its destination; red when it is coming for a world of yours.')}
  </div>`, anchor);
}
function drawHint() {
  const el = $('shint'); if (!el) return; const s = V.sel, me = C.player; let h;
  if (s && s.fl && s.fl.owner === me) { const fl = s.fl;
    h = fl.transit ? `<b>${esc(fl.name)}</b> is under way to ${nm(fl.transit.to)} · <kbd>Tab</kbd> next fleet · <kbd>Esc</kbd> deselect`
      : `<kbd>Right-click</kbd> a world to send <b>${esc(fl.name)}</b> · <kbd>Shift</kbd>+<kbd>Right-click</kbd> forced burn · <kbd>Right-click</kbd> an enemy in transit to intercept · <kbd>Tab</kbd> next fleet`; }
  else if (s && s.fl) h = `A ${K.BLOC_NAME[s.fl.owner] ? esc(K.BLOC_NAME[s.fl.owner]) : 'foreign'} fleet · select one of yours and <kbd>Right-click</kbd> it in transit to intercept · <kbd>Esc</kbd> deselect`;
  else if (s && s.w) h = C.worlds[s.w].owner === me ? `<b>${nm(s.w)}</b> · click an empty slot to build · <kbd>Q</kbd> recruit · <kbd>Double-click</kbd> to zoom · <kbd>Esc</kbd> deselect` : `<b>${nm(s.w)}</b> · send a fleet here to besiege it, then drop the Iron Rain · <kbd>Esc</kbd> deselect`;
  else h = `<kbd>Click</kbd> a fleet or world · <kbd>Drag</kbd> to pan · <kbd>Wheel</kbd> to zoom · <kbd>Tab</kbd> cycles your fleets · <kbd>Enter</kbd> ends the turn`;
  el.innerHTML = h; el.classList.toggle('up', !!s); el.classList.toggle('upmin', !!s && !!V.imin);
}

// ---------------------------------------------------------------- the objectives tracker (top left)
function drawObj() {
  const me = C.player, act = K.activeObjectives().filter(o => !o.mission).slice(0, 3), ms = ST.missionsOf(me), sits = ST.situationsOf(me).filter(x => x.prog >= 10), cr = ST.activeCrises(), cm = ST.crisisMeters().slice(0, 3), el = $('sobj');
  el.classList.toggle('hide', !(act.length || ms.length || sits.length || cr.length || cm.length) || !!V.list);
  let h = `<div class="omin" data-a="objmin" data-tip="${V.objMin ? 'Show everything' : 'Fold to the first objective'}">${V.objMin ? '▸' : '▾'}</div>`; el.classList.toggle('min', !!V.objMin);
  if (cr.length) h += cr.map(k => `<div class="crisis" data-tip="${tipA(`<div class='th'>${ST.CRISES[k].name}</div><div class='tdim'>${ST.CRISES[k].desc}</div>`)}">⚠ ${ST.CRISES[k].name}</div>`).join('');
  if (act.length) h += `<div class="oh">Objectives</div>` + act.map((o, i) => `<div class="orow ${i ? '' : 'first'}" data-tip="${tipA(`<div class='th'>Objective</div><div>${esc(o.text)}</div><div class='tgold'>Reward: ${K.rewardText(o.reward)}</div>`)}"><span>${i ? '○' : '◆'}</span><div><b>${esc(o.text)}</b><em>${K.rewardText(o.reward)}</em></div></div>`).join('');
  if (ms.length) h += `<div class="oh">Missions</div>` + ms.map(o => `<div class="orow" data-tip="${tipA(`<div class='th'>Mission</div><div>${esc(o.text)}</div><div class='tgold'>Reward: ${K.rewardText(o.reward)}</div><div class='tdim'>${o.left} weeks left</div>`)}"><span>◇</span><div><b>${esc(o.text)}</b><em>${K.rewardText(o.reward)} · ${o.left} wk left</em></div></div>`).join('');
  if (cm.length) h += `<div class="oh">Gathering crises</div>` + cm.map(x => `<div class="sitrow crm" data-tip="${tipA(partsTip(`${x.name}: ${Math.round(x.prog)}%`, x.parts, null, x.desc + ' At 100% it can break any week.'))}"><span>${x.name}</span><div class="bar cap"><i style="width:${Math.round(x.prog)}%"></i></div><b>${Math.round(x.prog)}%</b></div>`).join('');
  if (sits.length) h += `<div class="oh">Situations</div>` + sits.map(x => `<div class="sitrow" data-tip="${tipA(`<div class='th'>${x.name}</div><div class='tdim'>${x.desc}</div><div class='tbad'>At 100% it breaks.</div>`)}"><span>${x.name}</span><div class="bar cap"><i style="width:${Math.round(x.prog)}%"></i></div><b>${Math.round(x.prog)}%</b></div>`).join('');
  el.innerHTML = h;
}
// ---------------------------------------------------------------- the dispatch feed (top right)
function drawFeed() {
  const el = $('sfeed'), open = !!V.feedOpen, rows = (open ? C.log.slice(0, 60) : C.log.filter(l => l.turn >= C.turn - 1).slice(0, 3));
  el.classList.toggle('open', open);
  el.innerHTML = `<div class="fh" data-a="feed"><span>Dispatches${!open && C.log.filter(l => l.turn >= C.turn - 1).length > 3 ? ` <i>${C.log.filter(l => l.turn >= C.turn - 1).length - 3} more</i>` : ''}</span><em>${open ? 'Fold ▴' : 'All ▾'}</em></div>` + rows.map(l => `<div class="frow ${l.cls}" ${l.at ? `data-go="${l.at}"` : ''} ${open ? '' : `data-tip="${tipA(esc(l.msg) + (l.at ? `<div class='tdim'>Click to go there</div>` : ''))}"`}><span class="lt">W${((l.turn - 1) % 52) + 1}</span>${esc(l.msg)}</div>`).join('');
}
function toggleFeed() { V.feedOpen = !V.feedOpen; refresh(); }

// ---------------------------------------------------------------- the bottom panel: the selected fleet or world
const bar = (v, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></i></div>`;
const icons = {};
const icon = (t, f = C.player) => icons[f + t] || (icons[f + t] = buildIcon(t, f === 'neu' ? null : K.BLOCS[f], colS(f)).toDataURL());
function drawInfo() {
  const el = $('sinfo'), s = V.sel;
  if (!s) { el.classList.add('hide'); return; }
  el.classList.remove('hide'); el.classList.toggle('min', !!V.imin);
  el.innerHTML = s.fl ? fleetPanel(s.fl) : worldPanel(C.worlds[s.w]);
}
const rainCheck = fl => K.rainOdds(fl);
const RANK = ['Green', 'Blooded', 'Veteran', 'Scarred'];
function shipCard(s, owner, opts = {}) {
  const d = K.defsOf(owner)[s.t] || {}, sel = opts.sel, cls = (sel ? ' on' : '') + (opts.dead ? ' dead' : '') + (opts.prize ? ' prize' : '') + (s.name ? ' named' : '');
  const tip = `<div class='th'>${s.name ? esc(s.name) + ' · ' : ''}${d.name || s.t}</div><div class='tdim'>${esc(d.role || '')}</div>${COUNTER[s.t] ? `<div class='trow'><span>Strong against</span><b>${esc(COUNTER[s.t][0])}</b></div><div class='trow'><span>Weak against</span><b>${esc(COUNTER[s.t][1])}</b></div>` : ''}<div class='trow'><span>Hull</span><b>${Math.round(s.hp * 100)}%</b></div><div class='trow'><span>Crew</span><b>${Math.round(s.crew * 100)}%</b></div><div class='trow'><span>Ammunition</span><b>${Math.round(s.ammo * 100)}%</b></div>${s.fit ? `<div class='trow'><span>Fit</span><b>${TE.FITS[s.fit].name}</b></div><div class='tdim'>${TE.FITS[s.fit].desc}</div>` : ''}${s.cls && TE.classById(owner, s.cls) ? `<div class='trow'><span>Class</span><b>${esc(TE.classById(owner, s.cls).name)}</b></div><div class='tdim'>${TE.SLOTS.map(S => S.opts[TE.classById(owner, s.cls).s[S.k]]).filter(O => O && Object.keys(O.mul).length).map(O => O.name).join(' · ') || 'standard fittings'}</div>` : ''}<div class='trow'><span>Rank</span><b>${RANK[s.rank || 0]}</b></div>${s.battles ? `<div class='trow'><span>Service</span><b>${s.battles} battle${s.battles > 1 ? 's' : ''} · ${s.kills || 0} kill${s.kills === 1 ? '' : 's'}</b></div>` : ''}${s.honours ? `<div class='tgold'>Ship of the battle ×${s.honours}</div>` : ''}${opts.risk != null ? `<div class='trow'><span>If auto-resolved</span><b>${Math.round(opts.risk * 100)}% lost · ~${Math.round((opts.hpE || 0) * 100)}% hull</b></div>` : ''}${opts.hint ? `<div class='tgold'>${opts.hint}</div>` : ''}`;
  return `<div class="ucard${cls}" ${opts.click ? `data-card="${s.id}"` : ''} data-tip="${tipA(tip)}"><div class="uimg"><img src="${icon(s.t, owner)}"></div>${s.rank ? `<div class="urank">${'▲'.repeat(s.rank)}</div>` : ''}${s.honours ? `<div class="uhon" title="Ship of the battle ×${s.honours}">★${s.honours > 1 ? s.honours : ''}</div>` : ''}${s.fit ? `<div class="ufit" title="${TE.FITS[s.fit].name}">${{ gunline: 'G', armoured: 'A', assault: 'B', interceptor: 'I', carrier: 'C' }[s.fit]}</div>` : ''}<div class="uname">${esc(s.name || (d.name || s.t))}</div><div class="ubars"><i style="width:${Math.round(s.hp * 100)}%" class="${s.hp < .35 ? 'low' : ''}"></i></div><div class="ubars thin"><i class="cr" style="width:${Math.round(s.crew * 100)}%"></i><i class="am" style="width:${Math.round(s.ammo * 100)}%"></i></div>${opts.dead ? '<div class="ux">✕</div>' : ''}${opts.prize ? '<div class="uprize">Prize</div>' : ''}${opts.risk != null && opts.risk >= .05 ? `<div class="urisk" style="opacity:${Math.min(1, .35 + opts.risk)}">${Math.round(opts.risk * 100)}%</div>` : ''}</div>`;
}
const initials = n => n.split(' ').filter(w => w.length > 2 && w[0] === w[0].toUpperCase()).slice(0, 2).map(w => w[0]).join('');
function cmdrCard(c, f, opts = {}) {
  const tal = c.talents.map(t => `<span class="tal" data-tip="${tipA(`<div class='th'>${CM.TALENT[t].name}</div><div class='tdim'>${CM.TALENT[t].desc}${CM.TALENT[t].tac ? ' · also in real-time battle' : ''}</div>`)}">${CM.TALENT[t].name}</span>`).join('');
  const nx = CM.XP_NEXT[c.rank], xp = nx === Infinity ? 1 : c.xp / nx;
  const hn = CM.houseName(c), loy = Math.round(c.loyalty == null ? 70 : c.loyalty), R0 = C.rulers && C.rulers[c.owner], role = R0 ? (R0.id === c.id ? 'Ruler' : R0.regent === c.id ? 'Regent' : R0.heir === c.id ? 'Heir' : null) : null;
  const lt = partsTip(`Loyalty ${loy}%`, CM.loyParts(c), Math.round(CM.loyTarget(c)) + '%', 'Loyalty moves an eighth of the way toward this each week. Under 30%, a senior officer refuses forced burns; under 25%, a commander may go over to the enemy with the fleet.');
  const hl = c.owner === 'neu' ? '' : `<div class="chouse"><span>${hn ? esc(hn) : 'No great House'}</span><em class="${loy < 30 ? 'bad' : loy < 50 ? 'warn' : 'ok'}" data-tip="${tipA(lt)}">Loyalty ${loy}%</em>${role ? `<i class="croy">${role}</i>` : ''}${c.turnTo && c.turnTo === C.player ? '<i class="croy bm">Ours</i>' : ''}</div>`;
  return `<div class="ccard ${opts.cls || ''}" ${opts.pick ? `data-pickc="${c.id}"` : ''} style="--fc:${colS(f)}"><div class="cport">${initials(c.name)}<i>${'★'.repeat(c.rank + 1)}</i></div><div class="cbody"><b>${esc(c.name)}</b><span>${CM.RANK[c.rank]} · ${esc(c.colour)}${c.ageKnown ? ' · age ' + c.age : ''}${c.wounded ? ` · <em class="bad">wounded ${c.wounded} wk</em>` : ''}</span>${hl}<div class="ctal">${tal}</div><div class="cxp" data-tip="${tipA(`${c.xp} experience${nx !== Infinity ? ' · ' + nx + ' for ' + CM.RANK[c.rank + 1] : ''} · ${c.battles} battles, ${c.wins} won`)}"><i style="width:${Math.round(Math.min(1, xp) * 100)}%"></i></div></div></div>`;
}
function fleetPanel(fl) {
  const me = C.player, mine = fl.owner === me, tr = fl.transit;
  if (!mine && vis(fl) < 2) return `<div class="ihead" style="--fc:${colS(fl.owner)}">${SHIELD(fl.owner, 30)}<div class="iname"><h3>${vis(fl) ? 'Contact' : 'Lost contact'}</h3><div class="isub">${K.BLOC_NAME[fl.owner]} drive signatures · ${kindOf(fl)}, about ${estN(fl)} ships</div></div><button class="btn ico fold" data-a="imin" data-tip="Fold the panel to its title">▁</button><button class="btn ico x" data-a="close" data-tip="Close (Esc)">✕</button></div><div class="ibody"><div class="ihint">Too far for a firm track: no names, no destination. Bring a fleet with Sensor Pickets closer, or set a spy to watch the docks it left.</div>${interceptLine(fl)}</div>`;
  const tgt = tr && tr.sortie && C.fleets.find(x => x.id === tr.sortie.target);
  const status = fl.engage ? 'Locked in battle in deep space' : tr ? (tr.sortie ? `Intercepting <b>${tgt && vis(tgt) === 2 ? esc(tgt.name) : 'a contact'}</b> · on their course in ${tr.left} week${tr.left > 1 ? 's' : ''} · ${Math.round(tr.sortie.chance * 100)}% to find them` : `${tr.ret ? 'Returning to' : tr.retreat ? 'Retreating to' : 'Bound for'} <b>${nm(tr.to)}</b> · ${tr.left} week${tr.left > 1 ? 's' : ''} out`) + (tr.mode === 'dark' ? ' · running dark' : tr.mode === 'hard' ? ' · hard burn' : '') : `In orbit at <b>${nm(fl.at)}</b>`;
  const lv = fl.levy && P.defOf('soc', fl.levy), xs = (fl.raid ? ` · <b class="gold">raiding ${nm(fl.raid)}</b>` : '') + (lv ? ` · <b class="gold">levy of ${esc(lv.name)}</b>` : '') + ((C.risings || []).some(r => r.fl === fl.id) ? ` · <b class="good">the Sons of Ares wait for it at ${nm(C.risings.find(r => r.fl === fl.id).w)}</b>` : '');
  let h = `<div class="ihead" style="--fc:${colS(fl.owner)}">${SHIELD(fl.owner, 30)}<div class="iname"><h3>${esc(fl.name)}</h3><div class="isub">${K.BLOC_NAME[fl.owner]} · ${status}${xs}</div></div><button class="btn ico fold" data-a="imin" data-tip="Fold the panel to its title">▁</button><button class="btn ico x" data-a="close" data-tip="Close (Esc)">✕</button></div>
    <div class="ibody"><div class="istats">
      <div class="stat" data-tip="${tipA('Fighting strength: hulls, guns and crews, weighted by condition')}"><i>Strength</i><b>${fmt(K.fleetStr(fl))}</b></div>
      <div class="stat" data-tip="${tipA('What an Iron Rain from this fleet can put on the ground: the first wave (starShells, leechCraft and troop hulls) and the Storks behind it. Storks land only if the first wave holds a beachhead.')}"><i>Troops</i><b>${fmt(K.troopsOf(fl))}</b></div>
      <div class="stat ${fl.ships.length > CM.capOf(fl) ? 'over' : ''}" data-tip="${tipA(`<div class='th'>Command</div><div class='tdim'>A fleet can hold together as many hulls as its commander's rank allows: Legate ${CM.CAP[0]}, Praetor ${CM.CAP[1]}, Imperator ${CM.CAP[2]}, ArchImperator ${CM.CAP[3]} (half again with the Marshal talent). Without a commander, ${CM.PATROL}. A great navy needs many officers. Ships beyond the limit fight at half strength, cost half again in upkeep, and slow the fleet.</div>`)}"><i>Ships / cap</i><b>${fl.ships.length} / ${CM.capOf(fl)}</b></div>
      ${mine ? `<div class="stat" data-tip="${tipA('Helium-3 burned each week to keep these hulls in service')}"><i>Upkeep</i><b>${Math.round(K.upkeep(fl))} He</b></div>` : ''}
      ${AG.championOf(fl) ? `<div class="supply ok" data-tip="${tipA('A Peerless champion rides with this fleet: +8% strength when auto-resolved, +15% to its Iron Rains')}">⚔ ${esc(AG.championOf(fl).name)}</div>` : ''}
      ${!tr ? (CM.inSupply(fl) ? `<div class="supply ok" data-tip="${tipA('In supply: at or near a world you hold. Ships repair, re-crew and rearm at your own worlds.')}">● In supply</div>` : `<div class="supply bad" data-tip="${tipA('Out of supply: each week hulls lose 1.5%, crews 2% and ammunition 4%. A Supply Tender halves it; a Quartermaster prevents it.')}">● Out of supply</div>`) : ''}
    </div>`;
  const c = CM.cmdrOf(fl);
  h += `<div class="icmd">${c ? cmdrCard(c, fl.owner) : `<div class="nocmd">No commander<span>Patrol: ${CM.PATROL} ships at most</span></div>`}</div>`;
  const cbt = mine && !tr ? `<button class="btn ${c ? '' : 'go'}" data-a="cpick" ${c ? '' : 'style="grid-column:1/-1"'}>${c ? 'Replace commander' : 'Appoint a commander'}</button>${c ? '<button class="btn" data-a="crelieve">Relieve</button>' : ''}` : '';
  h += `<div class="icards">${fl.ships.map(s => shipCard(s, fl.owner, { prize: !!s.prize, click: mine && !tr && fl.ships.length > 1, sel: V.mark.has(s.id), hint: (s.prize ? 'A prize hull, taken from the enemy: scrap it at a world of ours for ore and alloys. ' : '') + (mine && !tr && fl.ships.length > 1 ? 'Click to mark for detaching · Shift-click marks the whole class' : '') })).join('')}</div>`;
  h += `<div class="iacts flacts">` + cbt;
  if (mine && lv) h += `<div class="ihint">A House levy: ${esc(lv.name)} steers it by its own ends (${esc(CQ.LEVY[fl.levy].desc)}). Its captain is as loyal as the House is content: keep ${esc(lv.name)} happy at court (C), or it recalls its ships.</div>`;
  else if (mine) {
    if (!tr) {
      const n = V.mark.size, here = C.worlds[fl.at];
      if (here.siege && here.siege.by === me && here.siege.hold > 0) h += `<button class="btn sm" data-tr="sworks" ${here.siege.worksT === C.turn ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>Siege works</div><div class='tdim'>Sappers, breaching charges and decoy drops: a week off the holdout, ${EC.WORKS_SIEGE} He-3. Once a week.</div>`)}">Siege works · ${EC.WORKS_SIEGE} He-3</button>`;
      if (here.siege && here.siege.by === me) h += `<div class="stance" data-tip=""${tipA(`<div class='th'>Holdout</div><div class='tdim'>A besieged world holds for a time: a week, plus its fortress levels, two more for a capital, one less if it is starving. Bombardment breaks it a week each week; a blockade every two weeks, or every week if the world is starving; staging, a third of a week. Until it breaks, an Iron Rain storms the walls with half its troops. The gun platforms still up fire on your fleet each week.</div>`)}"><span>Siege · ${(here.siege.hold || 0) > 0 ? 'holds ~' + Math.ceil(here.siege.hold) + ' wk' : 'breached'}</span>${[['blockade', 'Blockade', 'Starve the world: half a week off its holdout each week, a whole week if it cannot feed itself; its garrison shrinks'], ['bombard', 'Bombard', 'Break the holdout a week each week, and its platforms and orbital authority; kills civilians, so the world hates you when taken'], ['stage', 'Stage', 'Ready the drop: each week adds 10% to the Iron Rain, up to 30%; the holdout breaks slowly']].map(([k, t, d]) => { const no = k === 'bombard' && me === 'rim' && SR.rule('storm'); return `<button class="btn sm ${(here.siege.mode || 'blockade') === k ? 'on' : ''}" data-siege="${k}" ${no ? 'disabled' : ''} data-tip="${tipA(no ? 'The Storm Knight will not bombard a world: his honour forbids it' : d)}">${t}</button>`; }).join('')}</div>`;
      else h += `<button class="btn ${fl.stance === 'picket' ? 'on' : ''}" data-a="picket" data-tip="${tipA('Picket: hostile fleets whose course passes close to this world are stopped here and must fight. A Hunter doubles the range.')}">${fl.stance === 'picket' ? '◉ Picket on' : '○ Picket'}</button>`;
      h += `<button class="btn ${fl.run === 'dark' ? 'on' : ''}" data-a="dark" data-tip="${tipA(`<div class='th'>Run dark</div><div class='tdim'>Coast with cold drives: moves take half as long again, but enemy sensors only see the fleet at close range, and it slips past pickets it is not seen by. Running dark gets no supply runs: each week under way, hulls lose 1.5%, crews 2% and ammunition 4%. A fleet that intercepts while running dark, and is not seen, springs an ambush.</div>`)}">${fl.run === 'dark' ? '◉ Running dark' : '○ Run dark'}</button>`;
      if (n && n < fl.ships.length) h += `<button class="btn" data-a="split">Detach ${n} marked</button>`;
      if (fl.ships.length > 1) h += `<button class="btn" data-a="half">Split in two</button>`;
      h += factionActs(fl);
      if (fl.ships.some(x => K.hangarOf(me, x))) h += `<button class="btn" data-a="hangars" data-tip="${tipA(`<div class='th'>Hangars</div><div class='tdim'>What the carriers hold: ripWings, starShells, leechCraft and Storks, each taking bay space. Refitted at a world of your own; new craft come aboard as the fleet rests there.</div>`)}">Hangars</button>`;
      if (!K.canRefit(fl)) h += `<button class="btn" data-a="refit" data-tip="${tipA('Change the fit of the marked hulls, or of the whole fleet, at this shipyard')}">Refit${V.mark.size ? ' ' + V.mark.size + ' marked' : ''}</button>`;
      for (const o of K.fleetsAt(fl.at, me)) if (o !== fl) h += `<button class="btn" data-merge="${o.id}">Merge ${esc(o.name)}</button>`;
      const w = C.worlds[fl.at], rc = rainCheck(fl);
      if (K.hostile(me, w.owner)) {
        if (rc.err) h += `<div class="rainbox off" data-tip="${tipA(rc.err + (rc.troops ? '. ' + fmt(rc.troops) + ' troops are ready' + (rc.need ? ', ' + fmt(rc.need) + ' more needed for even odds' : '') + '.' : '.'))}"><b>Iron Rain</b><span>${rc.err}</span></div>`;
        else if (rc.chance < .2) h += `<button class="rainbox weak" data-a="rain" data-tip="${tipA(`<div class='th'>Iron Rain on ${nm(fl.at)}</div><div class='tbad'>${Math.round(rc.chance * 100)}% to take it. Bring about ${fmt(rc.need)} more troops for even odds.</div>`)}"><b>Iron Rain · ${Math.round(rc.chance * 100)}%</b><span>Need ~${fmt(rc.need)} more troops for even odds</span></button>`;
        else h += `<button class="rainbox" data-a="rain" data-tip="${tipA(`<div class='th'>Iron Rain on ${nm(fl.at)}</div><div class='trow'><span>Troops in the drop</span><b>${fmt(rc.troops)}</b></div><div class='trow'><span>Shot down on the way in</span><b>${Math.round(rc.shot * 100)}%</b></div><div class='trow'><span>Garrison</span><b>${fmt(w.garrison)}</b></div>${rc.storm ? `<div class='tbad'>The defences hold ~${rc.hold} more week${rc.hold > 1 ? 's' : ''}: dropping now storms the walls with half the troops.</div>` : ''}<div class='tdim'>The leechCraft are spent in the drop, win or lose.</div>`)}"><b>${rc.storm ? 'Storm the walls' : 'Drop the Iron Rain'}</b><span>${Math.round(rc.chance * 100)}% to take ${nm(fl.at)}${rc.storm ? ' · half strength' : ''}</span></button>`;
      }
    } else if (tr.left === tr.total && !tr.retreat && !fl.engage) h += `<button class="btn" data-a="cancel">Cancel the move</button>` + risingBtn(fl);
    else h += `<div class="ihint">Under way. A fleet in transit cannot be turned back.</div>` + (fl.engage ? '' : risingBtn(fl));
  } else h += `<div class="ihint">${RELT[K.relOf(me, fl.owner)] || ''}${fl.owner === 'neu' ? 'Independent' : ''}</div>`;
  return h + `</div></div>`;
}
// the deeds only one power can do, on the fleet panel: the Rim's raids, the Remnant's House levies, the Sons of Ares
function factionActs(fl) {
  const me = C.player, w = C.worlds[fl.at]; let h = '';
  if (CQ.canRaid(me)) h += `<button class="btn" data-a="raid" data-tip="${tipA(`<div class='th'>Raid</div><div class='tdim'>Strike a hostile world within ${CQ.RAID_REACH} weeks without laying siege: take He-3, ore and hostages from it, and run for home. Its platforms fire on the raiders, and any fleet in orbit must be beaten first. The Moon Lords who want the Republic checked approve; it raises the council's alarm when it falls on the Republic.</div>`)}">Raid…</button>`;
  if (me === 'soc' && w && w.owner === me && !w.siege) h += `<button class="btn" data-a="levy" data-tip="${tipA(`<div class='th'>House levy</div><div class='tdim'>Ask a great House to raise a fleet of its own here, for ${CQ.LEVY_COST.inf} influence and ${CQ.LEVY_COST.he} He-3. It is the House's fleet: it follows the House's ends, not your orders, and costs a third of the upkeep. Its captain is as loyal as the House is content; a bitter House recalls it, and a House in revolt takes it over to the rebels.</div>`)}">House levy…</button>`;
  if (me === 'rep') h += `<button class="btn" data-a="rising" data-tip="${tipA(`<div class='th'>Sons of Ares rising</div><div class='tdim'>For ${CQ.risingCost()} influence, the cells on an enemy world with Reds on it rise the week this fleet arrives: half the garrison is cut down (three in ten at a capital), the orbital authority is sabotaged and a gun platform may be blown. The fleet sets course at once.</div>`)}">Sons of Ares…</button>`;
  if (fl.ships.some(s => s.prize) && w && w.owner === me) { const v = fl.ships.filter(s => s.prize).reduce((a, s) => { const x = K.scrapValue(me, s); return { ore: a.ore + x.ore, alloy: a.alloy + x.alloy }; }, { ore: 0, alloy: 0 });
    h += `<button class="btn" data-a="scrap" data-tip="${tipA(`<div class='th'>Scrap prize hulls</div><div class='tdim'>Break up the ${fl.ships.filter(s => s.prize).length} prize hull${fl.ships.filter(s => s.prize).length > 1 ? 's' : ''} in this fleet${V.mark.size ? ' that are marked' : ''} for their plate and keels: about +${v.ore} ore${v.alloy ? ', +' + v.alloy + ' alloys' : ''}.</div>`)}">Scrap prizes</button>`; }
  return h;
}
function risingBtn(fl) {
  if (C.player !== 'rep' || fl.owner !== 'rep' || !fl.transit || (C.risings || []).some(r => r.fl === fl.id)) return '';
  const to = fl.transit.to, e = CQ.risingWhy(fl, to); if (e && /Reds|not an enemy/.test(e)) return '';
  return `<button class="btn" data-rising="${to}" ${e ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>Sons of Ares on ${nm(to)}</div><div class='tdim'>The cells rise the week ${esc(fl.name)} arrives, in ${fl.transit.left} week${fl.transit.left > 1 ? 's' : ''}: half the garrison cut down (three in ten at a capital), the orbital authority sabotaged.</div>${e ? `<div class='tbad'>${esc(e)}</div>` : ''}`)}">Sons of Ares rise at ${nm(to)} · ${CQ.risingCost()} Inf</button>`;
}
// the hangars of a fleet's carriers: bay space, what each holds, what it is set to hold, and the cost to fill it
const HICON = { ripwing: '✈', starshell: '⬡', boarder: '◆', stork: '▼' };
function hangarPreset(H, t, k) {
  const c = H.cap, L = { ripwing: 0, starshell: 0, boarder: 0, stork: 0 };
  if (k === 'mix') return { ...H.mix };
  if (k === 'invade') { if (K.INVADE[t]) { const f = c / BAY.stork / ((K.INVADE[t].stork * BAY.stork + K.INVADE[t].starshell + K.INVADE[t].ripwing * 2 + K.INVADE[t].boarder * 4) / BAY.stork); for (const q of CRAFT) L[q] = Math.floor(K.INVADE[t][q] * f); } else { L.starshell = Math.floor(c * .5); L.boarder = Math.floor(c * .5 / 4); } }
  if (k === 'fight') { L.ripwing = Math.floor(c * .7 / 2); L.starshell = Math.floor(c * .3); }
  if (k === 'board') { L.boarder = Math.floor(c * .6 / 4); L.starshell = c - L.boarder * 4; }
  while (bayUse(L) > c) { for (const q of ['ripwing', 'starshell', 'boarder', 'stork']) if (L[q] > 0 && bayUse(L) > c) L[q]--; }
  return L;
}
function popHangars(fl, anchor) {
  const me = C.player, home = K.hangarHome(fl), L = fl.ships.filter(x => K.hangarOf(me, x)); V.hangAnchor = anchor;
  let he = 0, man = 0;
  const row = x => { const H = K.hangarOf(me, x), used = bayUse(H.load), d = K.defsOf(me)[x.t];
    for (const k of CRAFT) { const n = Math.max(0, (H.load[k] || 0) - (H.cur[k] || 0)); he += n * (REPLACE_COST[k] || 0); man += n * (REPLACE_MAN[k] || 0); }
    return `<div class="hrow"><div class="hname"><b>${esc(x.name || d.name)}</b><span>${esc(d.name)}${x.cls ? ' · ' + esc(TE.classSpec(me, x.cls)?.name || '') : ''}</span></div>
      <div class="hbar" data-tip="${tipA(`${used} of ${H.cap} bays: ripWing 2 · starShell 1 · leechCraft 4 · Stork 20`)}"><i style="width:${Math.min(100, used / H.cap * 100)}%"></i><em>${used} / ${H.cap} bays</em></div>
      <div class="hcraft">${CRAFT.map(k => `<div class="hc ${(H.load[k] || 0) ? '' : 'zero'}"><span class="hi">${HICON[k]}</span><span class="hn">${CRAFT_NAME[k]}</span><b>${H.cur[k] || 0}${(H.cur[k] || 0) !== (H.load[k] || 0) ? `<small>→${H.load[k] || 0}</small>` : ''}</b><span class="hpm"><button class="btn xs" data-hl="${x.id}:${k}:-${k === 'stork' ? 1 : k === 'starshell' ? 4 : 1}" ${home && (H.load[k] || 0) > 0 ? '' : 'disabled'}>−</button><button class="btn xs" data-hl="${x.id}:${k}:${k === 'stork' ? 1 : k === 'starshell' ? 4 : 1}" ${home && used + BAY[k] <= H.cap ? '' : 'disabled'}>+</button></span></div>`).join('')}</div>
      <div class="hpre">${[['mix', 'Yard mix'], ['invade', 'Invade'], ['fight', 'Fighters'], ['board', 'Boarders']].map(([pk, n]) => `<button class="btn xs" data-hlp="${x.id}:${pk}" ${home ? '' : 'disabled'}>${n}</button>`).join('')}${fl.ships.filter(o => o.t === x.t && o.cls === x.cls).length > 1 ? `<button class="btn xs" data-hla="${x.id}" ${home ? '' : 'disabled'}>Same for every ${esc(d.name)}</button>` : ''}</div></div>`; };
  const rows = L.map(row).join('');
  const W = K.rainWaves(fl);
  openPop(`<div class="ph">Hangars · ${esc(fl.name)} <span>${home ? 'At a world of ours: refit the mix, and new craft come aboard as the fleet rests here' : 'Away from our worlds: the mix is refitted at a world of your own'}</span></div>
    <div class="hsum"><span>Iron Rain from this fleet: <b>${fmt(W.w1)}</b> in the first wave (starShells, leechCraft, troop hulls)${W.storks ? ` · <b>${fmt(W.storks)}</b> by Stork behind it` : ''}</span>${he || man ? `<span>To fill: <b>${fmt(he)} He-3 · ${fmt(man)} manpower</b>, paid as the fleet rests at a world of ours</span>` : '<span class="good">Every hangar is full</span>'}</div>
    <div class="hrows">${rows}</div>`, anchor);
}
function popRaid(fl, anchor) {
  const L = Object.keys(C.worlds).filter(id => K.hostile(fl.owner, C.worlds[id].owner) && C.worlds[id].owner !== 'neu').map(id => ({ id, e: CQ.raidWhy(fl, id), t: K.travel(fl.at, id) })).filter(x => x.t <= CQ.RAID_REACH + 2).sort((a, b) => a.t - b.t);
  openPop(`<div class="ph">Raid from ${nm(fl.at)} <span>strike, loot and run · within ${CQ.RAID_REACH} weeks</span></div><div class="pgrid">${L.map(x => { const w = C.worlds[x.id], lo = CQ.raidLoot(w), foe = IN.knownStrAt(fl.owner, x.id, K.fleetStr);
    return `<button class="bopt" data-raid="${x.id}" ${x.e ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>Raid ${nm(x.id)}</div><div class='trow'><span>Loot, about</span><b>+${lo.he} He · +${lo.ore} ore · +${lo.inf} Inf</b></div><div class='trow'><span>Gun platforms firing</span><b>${w.gun}</b></div>${foe ? `<div class='tbad'>A fleet we know of holds its orbit (${fmt(foe)}): beat it first</div>` : ''}${x.e ? `<div class='tbad'>${esc(x.e)}</div>` : ''}`)}"><b>${nm(x.id)}</b><span>${K.BLOC_NAME[w.owner].replace('The ', '')} · ${w.gun} guns${foe ? ' · defended' : ''}</span><em>${x.t} wk · ${lo.he} He · ${lo.ore} ore</em></button>`; }).join('') || '<div class="ihint">No world we are at war with is within reach.</div>'}</div>`, anchor);
}
function popLevy(fl, anchor) {
  const at = fl.at, G = P.groupsOf('soc');
  openPop(`<div class="ph">Call a House levy at ${nm(at)} <span>${CQ.LEVY_COST.inf} influence · ${CQ.LEVY_COST.he} He-3</span></div><div class="pgrid">${G.filter(g => CQ.LEVY[g.id]).map(g => { const D = P.defOf('soc', g.id), L = CQ.LEVY[g.id], e = CQ.levyWhy('soc', g.id, at), comp = Object.entries(L.comp).map(([t, n]) => `${n} ${(K.defsOf('soc')[t] || {}).name || t}`).join(', ');
    return `<button class="bopt" data-levy="${g.id}" ${e ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>${esc(D.name)}</div><div class='tdim'>${esc(L.desc)}</div><div class='trow'><span>Raises</span><b>${esc(comp)}</b></div><div class='trow'><span>Content</span><b>${Math.round(g.sat)}%</b></div>${e ? `<div class='tbad'>${esc(e)}</div>` : ''}`)}"><b>${esc(D.name)}</b><span>${esc(comp)}</span><em>content ${Math.round(g.sat)}%${e ? ' · ' + esc(e) : ''}</em></button>`; }).join('')}</div>`, anchor);
}
function popRising(fl, anchor) {
  const L = Object.keys(C.worlds).filter(id => K.hostile('rep', C.worlds[id].owner) && C.worlds[id].owner !== 'neu' && EC.mixOf(id).red >= .06).map(id => ({ id, e: CQ.risingWhy(fl, id), t: K.moveWeeks(fl, id) })).filter(x => x.t <= 8).sort((a, b) => a.t - b.t);
  openPop(`<div class="ph">Raise the Sons of Ares <span>${CQ.risingCost()} influence · the fleet sets course at once</span></div><div class="pgrid">${L.map(x => { const w = C.worlds[x.id];
    return `<button class="bopt" data-rising="${x.id}" ${x.e ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>${nm(x.id)}</div><div class='trow'><span>Reds</span><b>${Math.round(EC.mixOf(x.id).red * 100)}% of the people</b></div><div class='trow'><span>Garrison</span><b>${fmt(w.garrison)} → ~${fmt(w.garrison * (K.CAPITAL[w.owner] === x.id ? .7 : .5))}</b></div>${x.e ? `<div class='tbad'>${esc(x.e)}</div>` : ''}`)}"><b>${nm(x.id)}</b><span>${K.BLOC_NAME[w.owner].replace('The ', '')} · Reds ${Math.round(EC.mixOf(x.id).red * 100)}%</span><em>${x.t} wk · garrison ${fmt(w.garrison)}</em></button>`; }).join('') || '<div class="ihint">No enemy world with Reds on it is within eight weeks.</div>'}</div>`, anchor);
}
// a world taken: what to do with it
async function takeUI(p) {
  const me = C.player, w = C.worlds[p.w]; if (!w || w.owner !== me) return;
  const L = CQ.takeOpts(me), loot = CQ.sackLoot(w), fh = me === 'soc' ? CQ.fiefHouse() : null;
  const extra = { sack: loot.k ? `${K.BUILD[loot.k].name} torn down a level · +${loot.ore} ore · +${loot.alloy} alloys · +${loot.he} He-3 · loyalty ~10` : `+${loot.ore} ore · +${loot.alloy} alloys · +${loot.he} He-3 · loyalty ~10`, liberate: `+2,500 garrison · +3,000 manpower · Vox Populi +8 · a third of its yields`, hostage: 'No revolt for 16 weeks · House Raa −4, House Lux +3', occupy: `Loyalty ${Math.round(w.loyalty)}% · full yields`, fief: '' };
  const ch = [];
  for (const k of L) { if (k === 'fief') { for (const g of P.groupsOf('soc')) ch.push([`fief:${g.id}`, `Grant to ${P.defOf('soc', g.id).name}`, `${CQ.TAKE.fief.desc} ${P.defOf('soc', g.id).name} is content at ${Math.round(g.sat)}%: +14.${g.id === fh ? ' The unhappiest House.' : ''}`]); continue; } ch.push([k, CQ.TAKE[k].name, `${CQ.TAKE[k].desc} ${extra[k] ? '(' + extra[k] + ')' : ''}`]); }
  const v = await modal(`${rainArt(w.id, 'won')}<div class="kicker">${date(C.turn)} · ${nm(w.id)}</div><h2>A world taken</h2><p>${nm(w.id)}${p.old && p.old !== 'neu' ? ', held by ' + K.BLOC_NAME[p.old] + ',' : ''} is ours. What is to be done with it?</p><div class="echoices">${ch.map(([k, t, d], i) => `<button class="btn ${i === 0 ? 'go' : ''}" data-m="${k}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join('')}</div>`, [], { cls: 'event' });
  const [k, gid] = String(v || 'occupy').split(':'); const e = CQ.applyTake(w, me, k, p.old, gid); if (e) toastS(e, 'bad'); refresh();
}
async function crewsUI(p) {
  const v0 = CQ.crewValue(p), ch = Object.entries(CQ.CREWS).map(([k, X]) => [k, X.name, X.desc + (k === 'exchange' ? ` (+${fmt(v0.man)} manpower)` : k === 'ransom' ? ` (+${v0.inf} influence)` : '')]);
  const v = await modal(`<div class="evart war"></div><div class="kicker">${date(C.turn)}</div><h2>The struck crews</h2><p>${p.n} ship${p.n > 1 ? 's' : ''} of ${K.BLOC_NAME[p.foe]} struck ${p.n > 1 ? 'their' : 'her'} colours to us: about ${fmt(p.crew)} officers and crew are in our hands, and their hulls are prizes. What becomes of the crews?</p><div class="echoices">${ch.map(([k, t, d], i) => `<button class="btn ${i === 0 ? 'go' : ''}" data-m="${k}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join('')}</div>`, [], { cls: 'event' });
  CQ.applyCrews(p, CREWK.includes(v) ? v : 'press'); refresh();
}
const CREWK = Object.keys(CQ.CREWS);
async function pendingUI() {
  while (C.crewPend && !C.over) { const p = C.crewPend; C.crewPend = null; await crewsUI(p); }
  while (C.takePend && C.takePend.length && !C.over) await takeUI(C.takePend.shift());
}
// buildings as cards in their slots
const BICO = {
  mine: 'M5 19 L12 8 L19 19 M9 13 H15 M12 8 V4', skimmer: 'M4 12 A8 4 0 0 0 20 12 A8 4 0 0 0 4 12 M12 8 V3 M9 4 H15', arsenal: 'M9 20 V9 L12 4 L15 9 V20 Z M9 14 H15', farms: 'M4 18 A8 8 0 0 1 20 18 Z M12 10 V18 M8 14 L12 10 L16 14',
  barracks: 'M6 18 V10 A6 6 0 0 1 18 10 V18 M6 13 H18 M10 18 V15 H14 V18', yard: 'M4 20 H20 M7 20 V6 H17 M7 6 L12 2 M17 6 V12 M15 12 H19', grid: 'M6 18 H18 M12 18 V11 M12 11 L19 5 M8 18 L12 11 L16 18', array: 'M12 3 L19 6 V11 C19 16 16 19 12 21 C8 19 5 16 5 11 V6 Z', fort: 'M5 20 V8 H8 V10 H10.5 V8 H13.5 V10 H16 V8 H19 V20 Z M10 20 V15 H14 V20',
  foundry: 'M4 20 H20 M6 20 V11 L10 13 V11 L14 13 V8 H18 V20 M15 8 V4 M18 6 V3', court: 'M4 20 H20 M5 10 H19 L12 4 Z M7 10 V18 M10.5 10 V18 M13.5 10 V18 M17 10 V18 M5 18 H19', lab: 'M10 3 H14 M11 3 V9 L6 19 A1 1 0 0 0 7 20 H17 A1 1 0 0 0 18 19 L13 9 V3 M8.5 15 H15.5'
};
const bico = (k, sz = 26) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24"><path d="${BICO[k]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
// what one more level of a building does at this world, worked out from the economy itself: the world's weekly
// yields, garrison cap and estate loyalty with and without it, so taxes, technology, gas giants and strikes all count
const ESTN = { gold: 'Golds', mid: 'Silvers and Coppers', blue: 'Blues', green: 'Greens', orange: 'Oranges', war: 'Grays and Obsidians', red: 'Reds', low: 'lowColors' };
function levelFx(k, w, from, to) {
  const a = { ...w, lv: { ...w.lv, [k]: from } }, b = { ...w, lv: { ...w.lv, [k]: to } }, out = [];
  const ya = K.yieldOf(a), yb = K.yieldOf(b);
  for (const [r, n] of RES) { const d = (yb[r] || 0) - (ya[r] || 0); if (Math.abs(d) >= .5) out.push([`${sgn(Math.round(d))} ${n.toLowerCase()} a week`, d < 0 ? 'neg' : 'pos', `${sgn(Math.round(d))} ${RSH[r]}/wk`]); }
  out.sort((p, q) => (p[1] === 'neg') - (q[1] === 'neg')); // what it makes before what it costs
  const g = K.garrisonCap(b) - K.garrisonCap(a); if (g) out.push([`${sgn(Math.round(g)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} garrison cap`, 'pos', `${sgn(Math.round(g / 100) / 10)}k garrison`]);
  if (k === 'grid') out.push([`+1 orbital gun platform (${w.gun + (from - w.lv.grid)} → ${w.gun + (to - w.lv.grid)})`, 'pos', '+1 gun platform']);
  if (k === 'array') out.push([`+1 shield platform (${w.shield + (from - w.lv.array)} → ${w.shield + (to - w.lv.array)})`, 'pos', '+1 shield platform']);
  if (k === 'court') out.push(['+4 administrative capacity for the realm', 'pos', '+4 admin']);
  if (k === 'yard') { const tier = ['', 'light hulls: ripWings, corvettes and frigates', 'destroyers and torchShips', w.id === 'venus' || w.id === 'ganymede' ? 'dreadnoughts and moonBreakers' : 'dreadnoughts']; out.unshift([`Can lay down ${tier[to]}`, 'pos', to === 1 ? 'light hulls' : to === 2 ? 'destroyers' : 'dreadnoughts']); }
  if (w.cl) { const m = EC.mixOf(w.id), ds = EC.EK.filter(e => m[e] > .02).map(e => [e, EC.target(b, e) - EC.target(a, e)]).filter(([, d]) => Math.abs(d) >= .5);
    if (ds.length) { const same = ds.every(([, d]) => Math.abs(d - ds[0][1]) < .5) && ds.length === EC.EK.filter(e => m[e] > .02).length; out.push(same ? [`Every estate ${sgn(Math.round(ds[0][1]))} loyalty`, 'pos', `${sgn(Math.round(ds[0][1]))} loyalty`] : [ds.map(([e, d]) => `${ESTN[e] || e} ${sgn(Math.round(d))}`).join(', ') + ' loyalty', 'pos', `${sgn(Math.round(ds[0][1]))} ${ESTN[ds[0][0]] || ''} loyalty`]); } }
  if (!out.length) out.push([K.BUILD[k].desc, 'tdim', '']);
  return out;
}
const fxRows = rows => rows.map(([t, c]) => `<div class='trow'><span class='${c}'>${esc(t)}</span></div>`).join('');
function buildingTip(k, w, mode) {
  const B = K.BUILD[k], me = C.player, e = w.owner === me ? K.canBuild(me, w, k) : 'not your world', lv = w.lv[k], q = w.bq.filter(x => x.k === k).length, top = lv + q;
  const next = top < B.max ? `<div class='tsec'>${top ? `Level ${top} → ${top + 1}` : 'Level 1'} here</div>${fxRows(levelFx(k, w, top, top + 1))}` : `<div class='tsec'>At its highest level (${B.max})</div>`;
  const now = lv ? `<div class='tsec'>Level ${lv} now gives</div>${fxRows(levelFx(k, w, 0, lv))}` : '';
  const queued = q ? `<div class='tsec'>In the queue: level${q > 1 ? 's' : ''} ${[...Array(q)].map((_, i) => lv + i + 1).join(', ')}</div>${fxRows(levelFx(k, w, lv, top))}` : '';
  const wk = B.work ? (k === 'barracks' ? EC.levyOf(w.id) : k === 'skimmer' ? EC.skimMul(w.id) : EC.workOf(w.id)) : null;
  const work = wk != null ? `<div class='trow'><span>${k === 'barracks' ? 'People to raise' : 'Workforce'} here (${EC.popOf(w.id)} million)</span><b class='${wk < .6 ? 'tbad' : ''}'>×${wk.toFixed(2)}</b></div>` : '';
  return `<div class='th'>${B.name}</div><div class='tdim'>${B.desc} per level · up to level ${B.max}</div>${work}${now}${queued}${next}<div class='trow'><span>Cost</span><b>${costTxt({ ore: B.ore, he: B.he, ...(EC.BLD[k] || {}) })}</b></div><div class='trow'><span>Time</span><b>${B.t} weeks</b></div>${mode && e ? `<div class='tbad'>Cannot: ${e}</div>` : mode ? `<div class='tgold'>Click to ${mode}</div>` : ''}`;
}
function estateTip(w, e) {
  const E = EC.ESTATES[e], m = EC.mixOf(w.id)[e], P = EC.targetParts(w, e), t = EC.target(w, e);
  return `<div class='th' style='color:${E.col}'>${E.name}</div><div class='tdim'>${E.work}</div><div class='trow'><span>Share of the people</span><b>${Math.round(m * 100)}%</b></div><div class='trow'><span>Loyalty now</span><b>${Math.round(w.cl[e])}%</b></div>` +
    P.map(([n, v]) => `<div class='trow'><span>${esc(n)}</span><b class='${v < 0 ? 'neg' : 'pos'}'>${n === 'Base' || n === 'Free and unruled' ? v : sgn(v)}</b></div>`).join('') + `<div class='trow tsum'><span>Settles toward</span><b>${Math.round(t)}%</b></div>` + (w.cl[e] < 25 ? `<div class='tbad'>On strike: its work is halved${e === 'red' ? '. The Reds may rise' : e === 'orange' ? ', and the yards stand idle' : e === 'war' ? ', and legionnaires desert' : e === 'mid' ? ', and trade stops' : e === 'blue' ? ', and new hulls leave the yards short of crew' : ''}</div>` : '');
}
function estateStrip(w) {
  if (!w.cl) return bar(w.loyalty / 100);
  const m = EC.mixOf(w.id);
  return `<div class="estates">${EC.EK.filter(e => m[e] > .02).map(e => { const E = EC.ESTATES[e], v = w.cl[e], t = EC.target(w, e);
    return `<div class="est ${v < 25 ? 'strike' : v < 35 ? 'low' : ''}" style="--ec:${E.col};flex:${Math.max(.6, m[e] * 10).toFixed(2)}" data-tip="${tipA(estateTip(w, e))}"><div class="eb"><i style="height:${Math.round(v)}%"></i><b class="tgt" style="bottom:${Math.round(t)}%"></b></div><span>${m[e] >= .12 ? { gold: 'Gold', mid: 'Silver', blue: 'Blue', green: 'Green', orange: 'Orange', war: 'Gray', red: 'Red' }[e] : ''}</span></div>`; }).join('')}</div>`;
}
function popDesig(anchor) {
  const w = C.worlds[V.sel.w], me = C.player;
  openPop(`<div class="ph">Designate ${nm(w.id)} <span>${EC.DESIG_COST} influence · you have ${fmt(C.fac[me].res.inf)}</span></div><div class="pgrid dsg">${Object.entries(EC.DESIG).map(([k, D]) => `<button class="bopt ${(w.desig || 'none') === k ? 'on' : ''}" data-desig="${k}" ${(w.desig || 'none') === k || (k !== 'none' && C.fac[me].res.inf < EC.DESIG_COST) ? 'disabled' : ''}><b>${D.name}</b><span>${D.desc}</span></button>`).join('')}</div>`, anchor);
}
function worldPanel(w) {
  const me = C.player, W = WDEF[w.id], own = w.owner === me, y = K.yieldOf(w), cap = K.garrisonCap(w), P = LAY.pos[w.id];
  const loyC = w.loyalty < 30 ? 'cap' : w.loyalty < 50 ? 'am' : '';
  let h = `<div class="ihead" style="--fc:${colS(w.owner)}">${SHIELD(w.owner, 30)}<div class="iname"><h3>${nm(w.id)}${w.id === K.CAPITAL[w.owner] ? ' <span class="cap">★ Capital</span>' : ''}</h3><div class="isub">${W.region || ''}${w.owner !== 'neu' && EC.holdsRegion(w.owner, W.region) ? ' ✦' : ''} · <span style="color:${colS(w.owner)}">${K.BLOC_NAME[w.owner]}</span>${w.owner !== w.home ? ' · held from ' + K.BLOC_NAME[w.home] : ''}${w.owner !== me && w.owner !== 'neu' ? ' · ' + RELT[K.relOf(me, w.owner)] : ''}</div></div>
    <div class="chips">${w.owner !== 'neu' ? `<button class="chip desig" ${own ? 'data-a="desig"' : ''} data-tip="${tipA(`<div class='th'>${EC.DESIG[w.desig || 'none'].name}</div><div class='tdim'>${EC.DESIG[w.desig || 'none'].desc}</div>${own ? `<div class='tgold'>Click to change (${EC.DESIG_COST} influence)</div>` : ''}`)}">◆ ${EC.DESIG[w.desig || 'none'].name}</button>` : ''}${P.parent ? `<button class="chip" data-selw="${P.parent}">↑ ${nm(P.parent)}</button>` : ''}${Object.keys(C.worlds).filter(id => LAY.pos[id].parent === w.id).map(id => `<button class="chip" data-selw="${id}" style="--fc:${colS(C.worlds[id].owner)}">${nm(id)}</button>`).join('')}${K.fleetsAt(w.id).map(f => `<button class="chip fl" data-selfl="${f.id}" style="--fc:${colS(f.owner)}">⚑ ${esc(f.name)} · ${f.ships.length}</button>`).join('')}</div>
    <button class="btn ico fold" data-a="imin" data-tip="Fold the panel to its title">▁</button><button class="btn ico x" data-a="close" data-tip="Close (Esc)">✕</button></div>
    <div class="ibody"><div class="istats">
      <div class="lore" data-tip="${tipA(`<div class='th'>${nm(w.id)}</div><div class='tdim'>${esc(W.lore || '')}</div>` + (W.pros || []).map(p => `<div class='tgood'>+ ${esc(p[0])}: ${esc(p[1])}</div>`).join('') + (W.cons || []).map(c => `<div class='tbad'>− ${esc(c[0])}: ${esc(c[1])}</div>`).join(''))}">${esc(W.lore || '')}</div>
      ${w.siege ? `<div class="warn">Besieged by ${K.BLOC_NAME[w.siege.by]} · week ${w.siege.turns}. Output falls to a quarter and nothing can be built.</div>` : ''}
      <div class="mrow" data-tip="${tipA(`<div class='th'>Loyalty</div><div class='tdim'>The loyalty of the world's estates, weighted by their numbers. Each estate drives its own work. Under 12% the world may revolt; an estate under 25% goes on strike.</div>`)}"><span>Loyalty</span><b>${Math.round(w.loyalty)}%</b></div>${estateStrip(w)}
      <div class="mrow" data-tip="${tipA(`<div class='th'>Garrison</div><div class='tdim'>Legions on the ground. An Iron Rain must beat them. Barracks and Fortresses raise the cap.</div>`)}"><span>Garrison</span><b>${fmt(w.garrison)} / ${fmt(cap)}</b></div>${bar(w.garrison / cap, 'am')}
      <div class="dchips"><span data-tip="${tipA('Orbital gun platforms: they fire on hostile fleets and shoot down Iron Rain drops')}">⊕ ${w.gun} guns</span><span data-tip="${tipA('Shield platforms: they cover the guns and the authority')}">◈ ${w.shield} shields</span><span data-tip="${tipA('The orbital authority: board it in battle and the world falls at once')}">⌖ ${Math.round(w.gov * 100)}%</span></div>
      <div class="ychips">${RES.filter(([k]) => Math.abs(y[k]) >= .5 || ['he', 'ore', 'man', 'food'].includes(k)).map(([k, n, c]) => `<span data-tip="${tipA(n + ' a week from ' + nm(w.id))}"><i style="color:${c}">${RSH[k]}</i>${sgn(y[k])}</span>`).join('')}${(t => t >= .5 ? `<span data-tip="${tipA('Trade: He-3 a week that Silvers and Coppers earn moving goods to your capital' + (C.worlds[K.CAPITAL[w.owner]] && EC.crossesBelt(w.id, K.CAPITAL[w.owner]) ? '. The lane crosses the Belt: pirates take ' + Math.round(EC.piracy(w.owner) * 100) + '%' : ''))}"><i style="color:#7ff3ff">Trade</i>${sgn(t)}</span>` : '')(EC.tradeOf(w))}</div>
    </div>`;
  // building slots
  const chains = Object.keys(K.BUILD).filter(k => w.lv[k] > 0 || w.bq.some(q => q.k === k));
  const free = Math.max(0, w.slots - K.usedSlots(w));
  h += `<div class="islots"><div class="slh">Buildings <span>${K.usedSlots(w)} / ${w.slots} slots</span></div><div class="slrow">`;
  for (const k of chains) {
    const B = K.BUILD[k], lv = w.lv[k], q = w.bq.filter(x => x.k === k), top = lv + q.length, can = own && top < B.max;
    const build = q.length ? w.bq.findIndex(x => x.k === k) : -1, cur = build === 0 ? w.bq[0] : null;
    h += `<div class="bcard ${q.length ? 'busy' : ''}" data-tip="${tipA(buildingTip(k, w, can ? 'upgrade to level ' + (top + 1) : ''))}" ${can ? `data-bld="${k}"` : ''} ${own && q.length ? `data-bk="${k}"` : ''}>${own && q.length ? `<button class="bx" data-bcancel="${k}" data-tip="${tipA('Cancel the last queued level of ' + B.name + ': everything paid is refunded (right-click works too)')}">✕</button>` : ''}<div class="bico">${bico(k)}</div><div class="bname">${B.name}</div><div class="bpips">${'<i class=on></i>'.repeat(lv)}${'<i class=q></i>'.repeat(q.length)}${'<i></i>'.repeat(Math.max(0, B.max - top))}</div>${cur ? `<div class="bprog"><i style="width:${Math.round((1 - cur.left / B.t) * 100)}%"></i></div><div class="bwk">${cur.left} wk</div>` : q.length ? `<div class="bwk">queued</div>` : can ? `<div class="bup">▲ Lv ${top + 1}</div><div class="bfx">${esc(levelFx(k, w, top, top + 1)[0][2] || '')}</div>` : lv >= B.max ? `<div class="bwk">max level</div>` : ''}</div>`;
  }
  for (let i = 0; i < free; i++) h += own && !w.siege ? `<button class="bcard empty" data-a="bmenu" data-tip="${tipA('A free building slot. Click to build.')}"><span>+</span><div class="bname">Build</div></button>` : `<div class="bcard empty off"><span>·</span><div class="bname">Free slot</div></div>`;
  h += `</div></div>`;
  // the shipyard
  h += `<div class="iacts yard">`;
  if (w.lv.yard > 0) {
    h += `<div class="slh">Shipyard <span>level ${w.lv.yard}</span></div><div class="yq">${w.sq.map((q, i) => `<div class="qcard" ${own ? `data-si="${i}"` : ''} data-tip="${tipA(K.defsOf(w.owner)[q.t].name + ' · ' + q.left + ' weeks' + (own ? ' · ✕ or right-click to cancel, full refund' : ''))}">${own ? `<button class="bx" data-scancel="${i}">✕</button>` : ''}<img src="${icon(q.t, w.owner)}"><b>${q.left}</b>${i === 0 ? `<div class="bprog"><i style="width:${Math.round((1 - q.left / Math.max(1, K.buildWeeks(w.owner, q.t))) * 100)}%"></i></div>` : ''}</div>`).join('') || '<div class="ihint">No hulls laid down</div>'}</div>`;
    if (own) h += `<button class="btn go" data-a="recruit" ${w.siege ? 'disabled' : ''} data-tip="${tipA('Open the shipyard (Q)')}">Lay down a hull</button>`;
  } else h += `<div class="slh">Shipyard</div><div class="ihint">${own ? 'Build a Shipyard here to lay down hulls.' : 'No yards.'}</div>`;
  if (own) h += `<div class="wacts"><button class="btn sm" data-tr="works" ${w.works > C.turn || w.siege ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>Public works</div><div class='tdim'>Roads, water and housing for the lowColors: Reds and Silvers & Coppers here +8 loyalty for ${EC.WORKS.weeks} weeks. ${EC.WORKS.he} He-3 and ${EC.WORKS.alloy} alloys.</div>`)}">${w.works > C.turn ? 'Works · ' + (w.works - C.turn) + ' wk' : 'Public works'}</button><button class="btn sm" data-tr="levy" ${(w.levyT || -99) > C.turn ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>Emergency levy</div><div class='tdim'>Raise ${fmt(EC.LEVY.garrison)} troops for the garrison at once: ${EC.LEVY.he} He-3 and ${fmt(EC.LEVY.man)} manpower. Once every ${EC.LEVY.cd} weeks.</div>`)}">${(w.levyT || -99) > C.turn ? 'Levy · ' + (w.levyT - C.turn) + ' wk' : 'Emergency levy'}</button></div>`;
  return h + `</div></div>`;
}

// ---------------------------------------------------------------- popovers: the build and recruit menus
function openPop(html, anchor) {
  const p = $('spop'); p.innerHTML = html; p.classList.remove('hide');
  const r = (anchor || $('sinfo')).getBoundingClientRect(); p.style.left = Math.min(S.W - p.offsetWidth - 10, Math.max(10, r.left)) + 'px'; p.style.top = Math.max(56, r.top - p.offsetHeight - 8) + 'px';
}
function closePop() { const p = $('spop'); if (p) p.classList.add('hide'); }
function popBuild(anchor) {
  const w = C.worlds[V.sel.w], me = C.player, opts = Object.keys(K.BUILD).filter(k => w.lv[k] === 0 && !w.bq.some(q => q.k === k));
  openPop(`<div class="ph">Build at ${nm(w.id)}</div><div class="pgrid">${opts.map(k => { const B = K.BUILD[k], e = K.canBuild(me, w, k);
    return `<button class="bopt" data-bld="${k}" ${e ? 'disabled' : ''} data-tip="${tipA(buildingTip(k, w, 'build it'))}"><div class="bico">${bico(k, 30)}</div><b>${B.name}</b><span>${levelFx(k, w, 0, 1).map(r => esc(r[0])).join(' · ')}</span><em>${costTxt({ ore: B.ore, he: B.he, ...(EC.BLD[k] || {}) })} · ${B.t} wk</em></button>`; }).join('') || '<div class="ihint">Everything is built here: upgrade from the cards.</div>'}</div>`, anchor);
}
function popRecruit(anchor) {
  const w = V.sel && C.worlds[V.sel.w], me = C.player; if (!w || w.owner !== me || !w.lv.yard) return;
  const card = (t, c) => { const d = K.defsOf(me)[t], id = c ? c.id : null, e = K.hullOK(me, w, t, id), p = K.hullCost(me, t, id), wk = K.buildWeeks(me, t, id), bad = c && TE.SLOTS.some(S => TE.optWhy(me, d, S.k, c.s[S.k]));
    const fx = c ? TE.SLOTS.map(S => S.opts[c.s[S.k]]).filter(O => O && Object.keys(O.mul).length).map(O => O.name) : [];
    return `<button class="hopt ${c ? 'cls' : ''}" data-ship="${t}" ${c ? `data-cls="${c.id}"` : ''} ${e || bad ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>${c ? esc(c.name) + '-class ' : ''}${d.name}</div><div class='tdim'>${esc(d.role || '')}</div>${fx.length ? `<div class='tsec'>Fittings</div><div class='tdim'>${fx.map(esc).join(' · ')}</div>` : ''}<div class='trow'><span>Cost</span><b>${costTxt({ he: p.he, ore: p.ore, alloy: p.alloy, rare: p.rare })} · ${fmt(p.man)} crew</b></div><div class='trow'><span>Time</span><b>${wk} weeks</b></div>${bad ? `<div class='tbad'>A fitting in this class needs research you have not done</div>` : e ? `<div class='tbad'>Cannot: ${esc(e)}</div>` : ''}`)}"><img src="${icon(t)}"><b>${c ? esc(c.name) : d.name}</b>${c ? `<s>${d.name}</s>` : ''}<em>${costTxt({ he: p.he, ore: p.ore, alloy: p.alloy, rare: p.rare })}</em><i>${wk} wk</i></button>`; };
  const L = TE.classesOf(me);
  openPop(`<div class="ph">Lay down a hull at ${nm(w.id)} <span>${w.sq.length}/${4 + TE.mod(me, 'yardQ')} in the yards · navy ${Math.round(K.navalUsed(me))}/${K.navalCap(me)}</span><button class="btn sm" data-a="classes" data-tip="${tipA('Design classes: how a hull is fitted out (Y)')}">⚒ Ship classes</button></div><div class="pgrid hulls">${K.roster(me).map(t => K.defsOf(me)[t] ? card(t, null) + L.filter(c => c.hull === t).map(c => card(t, c)).join('') : '').join('')}</div>`, anchor);
}

function pickCmdr(fl, anchor) {
  const L = CM.pool(C.player);
  openPop(`<div class="ph">Appoint a commander to ${esc(fl.name)} <span>${L.length} in the officer corps</span></div><div class="cgrid">${L.map(c => cmdrCard(c, C.player, { pick: true, cls: 'pick' })).join('') || '<div class="ihint">No officers are free. Raise one from the Commanders list (L).</div>'}</div>`, anchor);
}
// ---------------------------------------------------------------- the lists (fleets and worlds)
function toggleList() { V.list = V.list ? null : 'fleets'; $('slist').classList.toggle('open', !!V.list); refresh(); }
function drawList() {
  const me = C.player, tab = V.list;
  let h = `<div class="ltabs"><button class="${tab === 'fleets' ? 'on' : ''}" data-tab="fleets">Fleets</button><button class="${tab === 'worlds' ? 'on' : ''}" data-tab="worlds">Worlds</button><button class="${tab === 'cmdrs' ? 'on' : ''}" data-tab="cmdrs">Commanders</button><button class="btn ico x" data-a="list">✕</button></div><div class="lbody">`;
  if (tab === 'fleets') h += C.fleets.filter(f => f.owner === me).map(f => `<div class="lrow2" data-selfl="${f.id}"><b>${esc(f.name)}</b><span>${f.ships.length} ships · ${fmt(K.fleetStr(f))}</span><em>${f.transit ? '→ ' + nm(f.transit.to) + ' · ' + f.transit.left + ' wk' : nm(f.at)}</em></div>`).join('') || '<div class="ihint">No fleets.</div>';
  else if (tab === 'cmdrs') { const L = C.cmdrs.filter(c => c.owner === me && c.state !== 'dead'); h += `<div class="lraise"><button class="btn sm" data-a="raise" data-tip="${tipA('Raise a new Legate: 600 He-3, 3,000 manpower and 25 influence')}">Raise an officer</button></div>` + L.map(c => { const f = C.fleets.find(x => x.id === c.fleet); return `<div class="lcm" ${f ? `data-selfl="${f.id}"` : ''}>${cmdrCard(c, me)}<em>${c.state === 'captured' ? 'Prisoner of ' + K.BLOC_NAME[c.captor] : f ? 'Commands ' + esc(f.name) : c.state === 'gov' ? 'Governor of ' + c.region : c.wounded ? 'Recovering' : 'In the officer corps'}</em></div>`; }).join(''); }
  else h += Object.values(C.worlds).filter(w => w.owner === me).map(w => { const y = K.yieldOf(w);
    return `<div class="lrow2" data-selw="${w.id}"><b>${nm(w.id)}${w.id === K.CAPITAL[me] ? ' ★' : ''}${w.siege ? ' <i class=bad>⚔</i>' : ''}</b><span>Loyalty ${Math.round(w.loyalty)}% · ${fmt(w.garrison)} troops</span><em>He ${sgn(y.he)} · Ore ${sgn(y.ore)}${w.bq.length ? ' · ⌂ ' + w.bq[0].left + 'wk' : ''}${w.sq.length ? ' · ⚒ ' + w.sq.length : ''}</em></div>`; }).join('');
  $('slist').innerHTML = h + `</div>`;
}

// ---------------------------------------------------------------- clicks
function onClick(e) {
  const b = e.target.closest('[data-hl],[data-hlp],[data-hla],[data-dgive],[data-deal],[data-dclear],[data-propose],[data-law],[data-motion],[data-lg],[data-lm],[data-lf],[data-ctab],[data-honour],[data-marry],[data-recruit],[data-amis],[data-atgt],[data-attach],[data-arecall],[data-peace],[data-ally],[data-ransom],[data-release],[data-exec],[data-ttab],[data-tpick],[data-focus],[data-trad],[data-fit],[data-desig],[data-tax],[data-gov],[data-ungov],[data-govpick],[data-pickc],[data-siege],[data-promo],[data-war],[data-a],[data-bcancel],[data-scancel],[data-bld],[data-ship],[data-dz],[data-rcls],[data-tr],[data-selfl],[data-selw],[data-merge],[data-card],[data-go],[data-m],[data-need],[data-tab],[data-raid],[data-levy],[data-rising]'); if (!b || b.disabled) return;
  const d = b.dataset, me = C.player, s = V.sel; hideTip();
  if (d.m === 'nowithdraw') { toastS('You withdrew from this enemy here last week: this time you must fight', 'bad'); return; }
  if (d.m === 'noassault') { toastS('An assault from orbit needs leechCraft hulls in orbit', 'bad'); return; }
  if (d.m !== undefined) return closeModal(d.m);
  if (d.war) { closeModal(null); return warUI(d.war); }
  if (d.tab) { V.list = d.tab; return refresh(); }
  if (d.need !== undefined) { const n = V.needs[+d.need]; if (!n) return; V.needI = V.needI && V.needI.k === n.k ? { k: n.k, i: (V.needI.i + 1) % n.list.length } : { k: n.k, i: 0 }; return select(n.list[V.needI.i], true); }
  if (d.a === 'end') return endTurnUI();
  if (d.a === 'feed') return toggleFeed();
  if (d.a === 'imin') { V.imin = !V.imin; return refresh(); }
  if (d.a === 'legend') return mapKey(b);
  if (d.a === 'objmin') { V.objMin = !V.objMin; return refresh(); }
  if (d.a === 'list') return toggleList();
  if (d.a === 'raise') { const r = CM.raiseOfficer(me); if (typeof r === 'string') toastS(r, 'bad'); return refresh(); }
  if (d.promo) { const [cid, t] = d.promo.split(':'), c = C.cmdrs.find(x => x.id === +cid); if (c && !c.talents.includes(t)) c.talents.push(t); return closeModal('ok'); }
  if (d.a === 'menu') return menuUI();
  if (d.a === 'faction') return factionUI();
  if (d.a === 'ledger') return ledgerUI();
  if (d.lg) { V.lgtab = d.lg; return ledgerUI(); }
  if (d.lm) { V.lgm = d.lm; return ledgerUI(); }
  if (d.lf) { V.lgf = d.lf; return ledgerUI(); }
  if (d.deal) { const [o, key] = d.deal.split('|'); V.deal = V.deal || {}; const L = V.deal[o] = V.deal[o] || []; const i = L.indexOf(key); if (i >= 0) L.splice(i, 1); else L.push(key); return diploUI(); }
  if (d.dgive) { V.dealGive = V.dealGive || {}; V.dealGive[d.dgive] = !V.dealGive[d.dgive]; return diploUI(); }
  if (d.dclear) { V.deal = V.deal || {}; V.deal[d.dclear] = []; return diploUI(); }
  if (d.propose) { const o = d.propose, items = dealOf(o), e2 = P.proposePeace(me, o, items); if (!e2) { toastS('Peace with ' + K.BLOC_NAME[o], 'good'); V.deal[o] = []; } return diploUI(); }
  if (d.law) { const [kk, id] = d.law.split(':'), e2 = P.proposeLaw(me, id, kk === 'repeal'); if (e2) toastS(e2, 'bad'); else toastS(`${P.bodyName(me)[0].toUpperCase() + P.bodyName(me).slice(1)} will vote in two weeks`, 'good'); return courtUI(); }
  if (d.motion) { const e2 = P.proposeMotion(me, d.motion); if (e2) toastS(e2, 'bad'); return courtUI(); }
  if (d.a === 'tech') return techUI();
  if (d.a === 'court') return courtUI();
  if (d.ctab) { V.ctab = d.ctab; V.apick = null; return courtUI(); }
  if (d.honour) { const e2 = P.honour(me, d.honour); if (e2) toastS(e2, 'bad'); return courtUI(); }
  if (d.marry) { if (!V.marry) V.marry = d.marry; else if (V.marry === d.marry) V.marry = null; else { const e2 = P.marry(me, V.marry, d.marry); if (e2) toastS(e2, 'bad'); V.marry = null; } return courtUI(); }
  if (d.recruit) { const r2 = AG.recruit(me, d.recruit); if (typeof r2 === 'string') toastS(r2, 'bad'); return courtUI(); }
  if (d.amis) { const [aid, m] = d.amis.split(':'); V.apick = { id: +aid, m }; return courtUI(); }
  if (d.atgt) { const [aid, m, w, x] = d.atgt.split(':'), a = C.agents.find(x0 => x0.id === +aid); const e2 = AG.send(a, m, x !== undefined ? { w, x: isNaN(+x) ? x : +x } : w); if (e2) toastS(e2, 'bad'); V.apick = null; return courtUI(); }
  if (d.attach) { const [aid, fid] = d.attach.split(':'), a = C.agents.find(x => x.id === +aid), f2 = C.fleets.find(x => x.id === +fid); AG.attach(a, f2); return courtUI(); }
  if (d.arecall) { const a = C.agents.find(x => x.id === +d.arecall); if (a) AG.recall(a); return courtUI(); }
  if (d.peace) { const [o, t] = d.peace.split(':'), e2 = P.proposePeace(me, o, t); if (!e2) toastS('Peace with ' + K.BLOC_NAME[o], 'good'); return diploUI(); }
  if (d.ally) { const e2 = P.proposeAlliance(me, d.ally); if (!e2) toastS('Allied with ' + K.BLOC_NAME[d.ally], 'good'); else toastS(K.BLOC_NAME[d.ally] + ' declines', 'bad'); return diploUI(); }
  if (d.ransom) { const e2 = P.ransomBack(me, +d.ransom); if (e2 && e2 !== 'refused') toastS(e2, 'bad'); return diploUI(); }
  if (d.release) { P.releaseFor(me, +d.release); return diploUI(); }
  if (d.exec) { P.execute(me, +d.exec); return diploUI(); }
  if (d.ttab) { V.ttab = d.ttab; return techUI(); }
  if (d.tpick) { const [t, id] = d.tpick.split(':'); TE.pick(me, t, id); return techUI(); }
  if (d.focus !== undefined) { C.tech[me].focus = C.tech[me].focus === d.focus ? null : d.focus; return techUI(); }
  if (d.trad) { const e2 = TE.takeTrad(me, d.trad); if (e2) toastS(e2, 'bad'); return techUI(); }
  if (d.fit) { const f0 = s && s.fl; if (f0) { const ids = V.mark.size ? [...V.mark] : f0.ships.map(x => x.id), e2 = K.refit(f0, ids, d.fit); if (e2) toastS(e2, 'bad'); else toastS('Refit complete: ' + TE.FITS[d.fit].name, 'good'); closePop(); } return refresh(); }
  if (d.a === 'diplo') return diploUI();
  if (d.a === 'close') return select(null);
  if (d.a === 'vhome') return homeView();
  if (d.a === 'vinner') return zoomTo('inner');
  if (d.a === 'vall') { S.cam.x = 0; S.cam.y = 0; S.cam.z = S.H * .45 / (42 * AU); return; }
  if (d.go) { if (modalOpen()) closeModal('ok'); V.sel = { w: d.go }; const P = LAY.pos[d.go]; S.cam.x = P.x; S.cam.y = P.y; if (S.cam.z < 1e-4) zoomTo(d.go); return refresh(); }
  if (d.selw) return select({ w: d.selw }, true);
  if (d.selfl) { const f = C.fleets.find(f => f.id === +d.selfl); return select(f ? { fl: f } : null, true); }
  if (d.a === 'bmenu') return popBuild(b);
  if (d.a === 'desig') return popDesig(b);
  if (d.desig) { const e2 = EC.setDesig(me, C.worlds[s.w], d.desig); if (e2) toastS(e2, 'bad'); closePop(); return refresh(); }
  if (d.tax !== undefined) { C.tax[me] = +d.tax; return factionUI(); }
  if (d.gov) { const [cid, rg] = d.gov.split('|'), e2 = EC.appointGov(me, +cid, rg); if (e2) toastS(e2, 'bad'); V.govPick = null; return factionUI(); }
  if (d.ungov) { EC.recallGov(me, d.ungov); return factionUI(); }
  if (d.govpick) { V.govPick = V.govPick === d.govpick ? null : d.govpick; return factionUI(); }
  if (d.a === 'recruit') return popRecruit(b);
  if (d.bcancel) { const e2 = K.cancelBuild(me, C.worlds[s.w], d.bcancel); if (e2) toastS(e2, 'bad'); else { sfx && sfx('click'); toastS('Cancelled: ' + K.BUILD[d.bcancel].name + ', refunded'); } return refresh(); }
  if (d.scancel !== undefined) { const w = C.worlds[s.w], q = w.sq[+d.scancel], e2 = K.cancelShip(me, w, +d.scancel); if (e2) toastS(e2, 'bad'); else { sfx && sfx('click'); toastS('Cancelled: ' + K.defsOf(me)[q.t].name + ', refunded'); } return refresh(); }
  if (d.bld) { const e2 = K.startBuild(me, C.worlds[s.w], d.bld); if (e2) toastS(e2, 'bad'); else { sfx && sfx('click'); closePop(); } return refresh(); }
  if (d.dz !== undefined) return dzClick(d.dz);
  if (d.tr) { const w = s && s.w && C.worlds[s.w], f0 = s && s.fl, e2 = d.tr === 'patron' ? EC.patronage(me) : d.tr === 'charter' ? EC.charter(me) : d.tr === 'works' ? EC.publicWorks(me, w) : d.tr === 'levy' ? EC.levy(me, w) : d.tr === 'sworks' ? EC.siegeWorks(me, C.worlds[f0.at]) : 'unknown';
    if (e2) toastS(e2, 'bad'); else toastS({ patron: 'Favours bought: +15 influence', charter: 'Charter signed: naval capacity +' + EC.CHARTER.cap, works: 'Public works begin', levy: 'The levy musters: +' + fmt(EC.LEVY.garrison) + ' garrison', sworks: 'The sappers go in: a week off the holdout' }[d.tr], 'good');
    if (d.tr === 'patron' || d.tr === 'charter') return factionUI(); return refresh(); }
  if (d.rcls !== undefined) { const f0 = s && s.fl; if (f0) { const ids = V.mark.size ? [...V.mark] : f0.ships.map(x => x.id), e2 = K.refitClass(f0, ids, d.rcls); if (e2) toastS(e2, 'bad'); else toastS('Refit complete: ' + (d.rcls ? TE.classById(me, d.rcls).name + ' class' : 'standard fit'), 'good'); closePop(); } return refresh(); }
  if (d.a === 'classes') return classUI();
  if (d.ship) { const e2 = K.orderShip(me, C.worlds[s.w], d.ship, d.cls || null); if (e2) toastS(e2, 'bad'); else { toastS((d.cls ? TE.classById(me, d.cls).name + '-class ' : '') + K.defsOf(me)[d.ship].name + ' laid down at ' + nm(s.w), 'good'); refresh(); setTimeout(() => popRecruit(document.querySelector('#sinfo [data-a=recruit]')), 0); } return refresh(); }
  const fl = s && s.fl; if (!fl) return;
  if (d.card) { const id = +d.card, t = fl.ships.find(x => x.id === id); if (e.shiftKey && t) { const all = fl.ships.filter(x => x.t === t.t), on = all.every(x => V.mark.has(x.id)); for (const x of all) on ? V.mark.delete(x.id) : V.mark.add(x.id); } else V.mark.has(id) ? V.mark.delete(id) : V.mark.add(id); return refresh(); }
  if (d.a === 'split' || d.a === 'half') {
    let ids = [];
    if (d.a === 'split') ids = [...V.mark];
    else { const by = {}; for (const x of fl.ships) (by[x.t] = by[x.t] || []).push(x); for (const t in by) ids.push(...by[t].filter((_, i) => i % 2).map(x => x.id)); if (!ids.length) ids = [fl.ships[fl.ships.length - 1].id]; }
    const nf = K.splitFleet(fl, ids); if (nf) { toastS('Detached: ' + nf.name, ''); select({ fl: nf }); } return refresh();
  }
  if (d.merge) { const o = C.fleets.find(f => f.id === +d.merge); if (o) K.mergeFleets(fl, o); return refresh(); }
  if (d.a === 'cancel') { fl.at = fl.transit.from; fl.transit = null; return refresh(); }
  if (d.a === 'dark') { fl.run = fl.run === 'dark' ? null : 'dark'; return refresh(); }
  if (d.a === 'picket') { fl.stance = fl.stance === 'picket' ? null : 'picket'; return refresh(); }
  if (d.siege) { C.worlds[fl.at].siege.mode = d.siege; return refresh(); }
  if (d.a === 'crelieve') { CM.relieve(fl); return refresh(); }
  if (d.a === 'cpick') return pickCmdr(fl, b);
  if (d.pickc) { const c = C.cmdrs.find(x => x.id === +d.pickc), e2 = CM.assign(c, fl); if (e2) toastS('That officer cannot take command now', 'bad'); closePop(); return refresh(); }
  if (d.a === 'rain') return rainUI(fl);
  if (d.a === 'assault') return rainUI(fl, true);
  if (d.a === 'raid') return popRaid(fl, b);
  if (d.a === 'levy') return popLevy(fl, b);
  if (d.a === 'rising') return popRising(fl, b);
  if (d.raid) { const e2 = CQ.orderRaid(fl, d.raid); closePop(); if (e2) toastS(e2, 'bad'); else toastS(`${fl.name} sets out to raid ${nm(d.raid)}: ${fl.transit.left} week${fl.transit.left > 1 ? 's' : ''}`, 'gold'); return refresh(); }
  if (d.levy) { const e2 = CQ.requestLevy(C.player, d.levy, fl.at); closePop(); if (e2) toastS(e2, 'bad'); else toastS(`${P.defOf('soc', d.levy).name} raises its levy`, 'good'); return refresh(); }
  if (d.rising) { const e2 = CQ.planRising(fl, d.rising); closePop(); if (e2) toastS(e2, 'bad'); else toastS(`The Sons of Ares on ${nm(d.rising)} will rise when ${fl.name} arrives`, 'good'); return refresh(); }
  if (d.a === 'scrap') { const r2 = K.scrapPrizes(fl, [...V.mark]); if (typeof r2 === 'string') toastS(r2, 'bad'); else { toastS(`${r2.n} prize hull${r2.n > 1 ? 's' : ''} broken up: +${r2.ore} ore${r2.alloy ? ', +' + r2.alloy + ' alloys' : ''}`, 'good'); V.mark = new Set(); if (!C.fleets.includes(fl)) V.sel = null; } return refresh(); }
  if (d.a === 'refit') return popRefit(fl, b);
  if (d.a === 'hangars') return popHangars(fl, b);
  if (d.hl) { const [sid, k, dv] = d.hl.split(':'), sh = fl.ships.find(x => String(x.id) === sid), H = sh && K.hangarOf(me, sh); if (!H) return; const L = { ...H.load }; L[k] = Math.max(0, (L[k] || 0) + +dv); const e2 = K.setLoad(fl, sh, L); if (e2) toastS(e2, 'bad'); return popHangars(fl, V.hangAnchor); }
  if (d.hlp) { const [sid, pk] = d.hlp.split(':'), sh = fl.ships.find(x => String(x.id) === sid), H = sh && K.hangarOf(me, sh); if (!H) return; const e2 = K.setLoad(fl, sh, hangarPreset(H, sh.t, pk)); if (e2) toastS(e2, 'bad'); return popHangars(fl, V.hangAnchor); }
  if (d.hla) { const sh = fl.ships.find(x => String(x.id) === d.hla), H = sh && K.hangarOf(me, sh); if (!H) return; let n = 0; for (const o of fl.ships) if (o !== sh && o.t === sh.t && o.cls === sh.cls && !K.setLoad(fl, o, H.load)) n++; toastS(`The same hangar mix for ${n} more ${K.defsOf(me)[sh.t].name}${n === 1 ? '' : 's'}`, 'good'); return popHangars(fl, V.hangAnchor); }
}
function onInput(e) { if (M.onInput) M.onInput(e); }

// ---------------------------------------------------------------- modals
const M = { res: null, esc: null, enter: null, onInput: null };
const modalOpen = () => !$('smodal').classList.contains('hide');
function modal(html, buttons, opts = {}) {
  hideTip(); closePop();
  const el = $('smodal'); el.className = 'panel sv ' + (opts.cls || '');
  const mx = opts.esc != null && typeof opts.esc !== 'object' ? `<button class="btn ico mx" data-m="${esc(String(opts.esc))}" data-tip="Close (Esc)">✕</button>` : '';
  el.innerHTML = mx + html + (buttons.length ? `<div class="mbtns">${buttons.map(([v, t, cls, tip]) => `<button class="btn ${cls || ''}" data-m="${v}" ${tip ? `data-tip="${tipA(tip)}"` : ''}>${t}</button>`).join('')}</div>` : '');
  M.esc = opts.esc ?? null; M.enter = opts.enter ?? null; M.onInput = opts.onInput || null;
  return new Promise(r => { M.res = r; });
}
function closeModal(v) { $('smodal').className = 'panel sv hide'; const r = M.res; M.res = null; M.onInput = null; if (r) r(v); }

function econBlock(me) {
  const tax = C.tax[me], tr = EC.tradeSummary(me), sp = EC.sprawl(me), cap = EC.adminCap(me), over = EC.overSprawl(me), pool = CM.pool(me);
  let h = `<div class="sec">Treasury and taxes</div><div class="taxrow">${EC.TAX.map((T, i) => `<button class="btn sm ${i === tax ? 'on' : ''}" data-tax="${i}" data-tip="${tipA(`<div class='th'>${T.name} taxes</div><div class='tdim'>${T.desc}</div>`)}">${T.name}</button>`).join('')}</div>
    <div class="fgrid3"><div class="stat" data-tip="${tipA(`<div class='th'>Administration</div><div class='tdim'>Every world costs administration: 1, or half for a gas giant or a dead moon, and half again if conquered. Governor’s Courts add 4 each level, governors 4 each. Past capacity, every estate on every world loses 3 loyalty for each point over, and output falls 3% for each.</div>`)}"><i>Administration</i><b class="${over ? 'bad' : ''}">${sp % 1 ? sp.toFixed(1) : sp} / ${cap}</b>${bar(sp / cap, over ? 'cap' : 'am')}</div>
    <div class="stat" data-tip="${tipA(`<div class='th'>Trade</div><div class='tdim'>Silvers and Coppers move goods from each world to your capital, and peace or alliance with another power adds to it. Lanes that cross the Belt run past the Ascomanni and the free pirates: a fleet at Ceres keeps most of them off.</div>` + tr.rows.slice(0, 6).map(([id, v, x]) => `<div class='trow'><span>${nm(id)}${x ? ' · Belt' : ''}</span><b>${sgn(v - x)}</b></div>`).join(''))}"><i>Trade a week</i><b>${sgn(tr.net)} He</b><span class="dim">${tr.lost > 1 ? `pirates take ${fmt(tr.lost)} (${Math.round(tr.piracy * 100)}% of Belt lanes)` : 'no lanes raided'}</span></div>
    <div class="stat"><i>Influence</i><b>${fmt(C.fac[me].res.inf)}</b><span class="dim">${sgn(K.income(me).inf)} a week</span></div></div>
    ${(() => { const pc = EC.patronCost(me), cc = EC.charterCost(me), nch = EC.chartersOf(me), gr = (C.graft && C.graft[me]) || 0;
      return `<div class="treas"><button class="bopt" data-tr="patron" data-tip="${tipA(`<div class='th'>Patronage</div><div class='tdim'>Buy favours: +15 influence. Each purchase costs 15% more; the price eases 5% a week. The commerce blocs like it; the Vox Populi does not.</div>`)}"><b>Patronage</b><span>+15 influence</span><em>${fmt(pc)} He-3</em></button>
      <button class="bopt" data-tr="charter" ${nch >= 6 ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>Dockyard charter</div><div class='tdim'>Charter the Orange yard guilds: +${EC.CHARTER.cap} naval capacity for good, ${EC.CHARTER.upkeep} He-3 a week upkeep. Each charter costs half again as much as the last; six at most. You hold ${nch}.</div>`)}"><b>Dockyard charter</b><span>+${EC.CHARTER.cap} naval capacity · ${nch}/6</span><em>${cc.alloy} alloys · ${cc.rare} rare · ${cc.inf} inf</em></button>
      ${gr > 1 ? `<div class="ihint bad" data-tip="${tipA('Stockpiles past what the depots hold spoil 6% a week, and the skimming costs 1 influence for every 500 lost. Spend it: patronage, public works, charters, levies, siege works.')}">Spoiling ${fmt(gr)} a week: −${(gr / 500).toFixed(1)} influence to graft</div>` : ''}</div>`; })()}
    <div class="sec">Regions and governors</div><div class="regs">`;
  for (const r of EC.REGIONS) {
    const ws = EC.regionWorlds(r), mine = ws.filter(id => C.worlds[id].owner === me), full = EC.holdsRegion(me, r), g = EC.govOf(me, r), B = EC.REGION_BONUS[r];
    if (!ws.length) continue;
    h += `<div class="reg ${full ? 'full' : ''}"><div class="rh"><b>${r}</b><span>${mine.length} / ${ws.length} worlds</span></div><div class="rb ${full ? 'on' : ''}" data-tip="${tipA(`<div class='th'>${B.name}</div><div class='tdim'>${B.desc}. Hold every world of ${r} to win it.</div>`)}">✦ ${B.name}</div>`;
    if (mine.length) h += g ? `<div class="rgov">${cmdrCard(g, me)}<button class="btn sm" data-ungov="${r}">Recall</button></div>` : `<button class="btn sm" data-govpick="${r}" ${pool.length ? '' : 'disabled'} data-tip="${tipA(`A governor from the officer corps: +4 administration and +6 loyalty for every estate in ${r}. Costs ${EC.GOV_COST} influence, and 1.5 a week for the household.`)}">Appoint a governor</button>`;
    if (V.govPick === r) h += `<div class="cgrid">${pool.map(c => `<div data-gov="${c.id}|${r}">${cmdrCard(c, me, { cls: 'pick' })}</div>`).join('')}</div>`;
    h += `</div>`;
  }
  return h + `</div>`;
}
// ---------------------------------------------------------------- offers and the Senate's verdicts
async function offerUI(o) {
  const f = o.from, me = C.player, c = o.cid && C.cmdrs.find(x => x.id === o.cid);
  const T = { armistice: ['The Ash Lord’s armistice', `Emissaries of Magnus au Grimmus, the Ash Lord, have come under a white flag with an offer: an armistice of twelve weeks, the siege of Mercury lifted, each side keeping what it holds. The Vox Populi would welcome it. Darrow would not.`, 'Accept the armistice', 'Send them away'],
    peace: ['An offer of peace', `${K.BLOC_NAME[f]} offers peace: each side keeps what it holds, with a truce of twenty weeks.`, 'Make peace', 'Fight on'],
    tribute: ['They sue for peace', `${K.BLOC_NAME[f]} sues for peace, and offers tribute: ${P.TRIBUTE} He-3 a week for ${P.TRIBUTE_WEEKS} weeks.`, 'Accept', 'Fight on'],
    ransom: ['A ransom offer', c ? `${K.BLOC_NAME[f]} offers ${P.ransomOf(c).he} He-3 for the return of ${c.name}, our prisoner.` : '', 'Take the ransom', 'Keep the prisoner'],
    deal: ['They sue for peace', `${K.BLOC_NAME[f]} sues for peace${(o.items || []).length ? ', and offers terms' : ': each side keeps what it holds'}.${(o.items || []).length ? `<ul class="dlist">${o.items.map(it => `<li>${esc(P.itemName(it))}</li>`).join('')}</ul>` : ''} A truce of twenty weeks would follow. The war score stands at ${sgn(Math.round(P.warScore(me, f)))}.`, 'Make peace on these terms', 'Fight on'],
    demand: ['Terms of surrender', `${K.BLOC_NAME[f]} has the upper hand, and names its price for peace:<ul class="dlist">${(o.items || []).map(it => `<li>${esc(P.itemName(it))}</li>`).join('')}</ul> The war score stands at ${sgn(Math.round(P.warScore(me, f)))}. Refuse, and they will remember it.`, 'Accept their terms', 'Refuse'] }[o.kind];
  if (!T || !T[1]) return;
  const v = await modal(`<div class="mbanner" style="--fc:${colS(f)}">${SHIELD(f, 46)}<div><div class="kicker">${date(C.turn - 1)}</div><h2>${T[0]}</h2></div></div><p>${T[1]}</p>`, [['no', T[3]], ['yes', T[2], 'go']], { esc: 'no', cls: 'event' });
  P.answerOffer(o, v === 'yes'); refresh();
}
async function voteUI(pv) {
  const me = C.player, M = P.MOTIONS[pv.k];
  const v = await modal(`<div class="evart war"></div><div class="kicker">${date(C.turn - 1)} · the Senate</div><h2>${M.name}</h2><p>The Senate votes ${pv.yes} to ${140 - pv.yes}: the motion passes. ${M.desc}</p><p class="dim">You may comply, or defy the Senate. Defiance keeps your hands free, but every bloc remembers it: the Vox Populi most of all, and the worlds of the Republic lose faith.${P.groupsOf(me).length ? ` Defied so far: ${C.pol[me].defied}.` : ''}</p>`, [['comply', 'Comply'], ['defy', 'Defy the Senate', 'go']], { esc: 'comply', cls: 'event' });
  P.applyMotion(me, pv.k, true, v === 'defy'); refresh();
}
// ---------------------------------------------------------------- research and traditions
function techCard(f, t, id, mode) {
  const T = TE.TECHS[id], cost = TE.costOf(id, f), prog = C.tech[f].prog[t], rate = TE.effSci(K.income(f).sci) * TE.shares(f)[t];
  const eta = rate > 0 ? Math.max(0, Math.ceil((cost - prog) / rate)) : '∞';
  return `<div class="tcard t${T.tier} ${mode}" ${mode === 'offer' ? `data-tpick="${t}:${id}"` : ''}><div class="ttier">${'I II III IV'.split(' ')[T.tier - 1]}</div><b>${T.name}</b><span>${T.desc}</span>${mode === 'cur' ? `<div class="bar"><i style="width:${Math.round(Math.min(1, prog / cost) * 100)}%"></i></div><em>${Math.floor(prog)} / ${cost} · ${eta} wk</em>` : mode === 'offer' ? `<em>${cost} research · ~${eta} wk</em>` : ''}</div>`;
}
function techUI() {
  const me = C.player, T = C.tech[me], tab = V.ttab || 'tech', raw = K.income(me).sci, eff = TE.effSci(raw);
  let h = `<div class="kicker">${date(C.turn)}</div><h2>${tab === 'tech' ? 'Research' : 'Traditions'}</h2><div class="ttabs"><button class="btn sm ${tab === 'tech' ? 'on' : ''}" data-ttab="tech">Technology</button><button class="btn sm ${tab === 'trad' ? 'on' : ''}" data-ttab="trad">Traditions</button></div>`;
  if (tab === 'tech') {
    h += `<p class="dim" data-tip="${tipA('Research is the work of the Greens: raise it with Research Spires, research worlds and the Greens’ loyalty. The first points count most: research a week is 4 + 5 × the square root of what your Greens produce.')}">Your Greens produce ${fmt(raw)} a week, which makes <b>${eff.toFixed(1)} research</b>. ${T.focus ? `Focus on ${TE.TRACKS[T.focus]}: half to it, a quarter to each of the others.` : 'Split evenly across the three fields. Click a field’s name to focus it.'}</p><div class="tcols">`;
    for (const t in TE.TRACKS) {
      h += `<div class="tcol"><button class="th2 ${T.focus === t ? 'on' : ''}" data-focus="${t}" data-tip="${tipA('Focus research here: half of it goes to this field')}">${TE.TRACKS[t]} <span>${Math.round(TE.shares(me)[t] * 100)}%</span></button>`;
      if (T.cur[t]) h += techCard(me, t, T.cur[t], 'cur');
      else if (T.offers[t].length) h += `<div class="tpick">Choose a project</div>` + T.offers[t].map(id => techCard(me, t, id, 'offer')).join('') + (T.prog[t] > 0 ? `<div class="dim small">${Math.floor(T.prog[t])} research banked</div>` : '');
      else h += `<div class="ihint">Every project in this field is complete.</div>`;
      const done = T.done.filter(id => TE.TECHS[id].tr === t);
      if (done.length) h += `<div class="tdone">${done.map(id => `<span data-tip="${tipA(`<div class='th'>${TE.TECHS[id].name}</div><div class='tdim'>${TE.TECHS[id].desc}</div>`)}">✔ ${TE.TECHS[id].name}</span>`).join('')}</div>`;
      h += `</div>`;
    }
    h += `</div>`;
  } else {
    const L = TE.TRAD[me] || [], c = TE.tradCost(me), mine = C.trad[me], inf = C.fac[me].res.inf;
    h += `<p class="dim">The path your power takes, bought with influence. The next tradition costs <b>${c} influence</b>; you have ${fmt(inf)}. Within a line, each tradition needs the one before it.</p><div class="trlines">`;
    for (const line of [...new Set(L.map(t => t.line))]) {
      const ts = L.filter(t => t.line === line);
      h += `<div class="trline"><div class="th2">${line}</div><div class="trrow">${ts.map((t, i) => { const got = mine.includes(t.id), open = i === 0 || mine.includes(ts[i - 1].id);
        return `<button class="trc ${got ? 'got' : open ? 'open' : 'lock'}" ${!got && open ? `data-trad="${t.id}"` : ''} ${!got && open && inf < c ? 'disabled' : ''}><b>${t.name}</b><span>${t.desc}</span><em>${got ? '✔ Adopted' : open ? c + ' influence' : 'Locked'}</em></button>`; }).join('<i class="arr">›</i>')}</div></div>`;
    }
    h += `</div>`;
  }
  modal(h, [['ok', 'Close', 'go']], { esc: 'ok', enter: 'ok', cls: 'wide xwide' });
}
// ---------------------------------------------------------------- ship classes
// The shipwrights' hall: pick a hull, fit its four slots, name the class and save it. The build menu then offers it.
function classUI() {
  const me = C.player, defs = K.defsOf(me), hulls = K.roster(me).filter(t => TE.designable(defs[t]));
  if (!hulls.length) return toastS('No hull to design for', 'bad');
  const Z = V.dz = V.dz && hulls.includes(V.dz.hull) ? V.dz : { hull: hulls.includes('destroyer') ? 'destroyer' : hulls[0], c: null };
  if (!Z.c || Z.c.hull !== Z.hull) Z.c = { name: '', hull: Z.hull, s: { ...TE.SLOT_STD } };
  const d = defs[Z.hull], sp = TE.specOf(Z.c.s), m = sp.mul, L = TE.classesOf(me);
  const p0 = K.hullCost(me, Z.hull, null), wk0 = K.buildWeeks(me, Z.hull, null), wk = Math.max(1, Math.ceil(wk0 * sp.time));
  const guns = d.weapons.filter(w => !['missile', 'pd', 'nuke', 'emp'].includes(w[0])).length, mis = d.weapons.filter(w => w[0] === 'missile').length, pds = d.weapons.filter(w => w[0] === 'pd').length;
  const row = (lbl, a, b, fmtv = v => fmt(Math.round(v)), lowGood) => { const dlt = b - a, good = lowGood ? dlt < 0 : dlt > 0, eq = Math.abs(dlt) < 1e-6 * Math.max(1, Math.abs(a)); return `<div class="dzr"><span>${lbl}</span><i>${fmtv(a)}</i><b class="${eq ? '' : good ? 'up' : 'dn'}">${fmtv(b)}</b></div>`; };
  const pct = v => Math.round(v * 100) + '%';
  const H = d.hangar || {}, hx = k => (H[k] || 0) * (m.hangar || 1) * ((m.hmix && m.hmix[k]) || 1);
  const stats = row('Structure', d.hp, d.hp * (m.hp || 1)) + row('Shields', d.shield, d.shield * (m.shield || 1))
    + (guns ? row('Gunnery', 1, m.gun || 1, pct) : '') + (mis ? row('Missile rate', 1, (m.gun || 1) * (m.missile || 1), pct) + row('Missile magazine', 1, m.misMag || 1, pct) : '') + (pds ? row('Point defence', 1, (m.gun || 1) * (m.pd || 1), pct) : '')
    + row('Thrust', 1, m.thrust || 1, pct) + row('Turn', 1, m.turn || 1, pct) + row('Signature', 1, m.sig || 1, pct, true)
    + (d.crew && d.mar ? row('Marines', d.crew * d.mar, d.crew * d.mar * (m.mar || 1)) : '') + (d.troops ? row('Troops', d.troops, d.troops * sp.troops) : '')
    + (H.ripwing ? row('ripWings', H.ripwing, Math.round(hx('ripwing'))) : '') + (H.starshell ? row('starShells', H.starshell, Math.round(hx('starshell'))) : '') + (H.boarder ? row('Assault pods', H.boarder, Math.round(hx('boarder'))) : '')
    + `<div class="dzr sep"><span>He-3</span><i>${fmt(p0.he)}</i><b class="${sp.cost > 1 ? 'dn' : ''}">${fmt(Math.round(p0.he * sp.cost))}</b></div>` + row('Ore', p0.ore, p0.ore * sp.cost, undefined, true) + (p0.alloy ? row('Alloys', p0.alloy, p0.alloy * sp.cost, undefined, true) : '') + row('Build weeks', wk0, wk, v => v, true)
    + row('Battle weight', 1, sp.ar, v => v.toFixed(2));
  const slots = TE.SLOTS.map(S => `<div class="dzs"><div class="dzh">${S.name}</div><div class="dzo">${Object.entries(S.opts).map(([o, O]) => { const why = TE.optWhy(me, d, S.k, o); if (why === 'this hull cannot take it') return ''; const on = Z.c.s[S.k] === o;
    return `<button class="bopt ${on ? 'on' : ''}" data-dz="opt:${S.k}:${o}" ${why ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>${O.name}</div><div class='tdim'>${O.desc}</div>${O.cost ? `<div class='trow'><span>Cost</span><b>+${Math.round(O.cost * 100)}%</b></div>` : ''}${O.time ? `<div class='trow'><span>Build time</span><b>+${Math.round(O.time * 100)}%</b></div>` : ''}${why ? `<div class='tbad'>${esc(why[0].toUpperCase() + why.slice(1))}</div>` : ''}`)}"><b>${O.name}</b><span>${O.desc}</span>${why ? `<em>${esc(why)}</em>` : ''}</button>`; }).join('')}</div></div>`).join('');
  const hullList = hulls.map(t => { const n = L.filter(c => c.hull === t).length; return `<button class="dzhull ${t === Z.hull ? 'on' : ''}" data-dz="hull:${t}"><img src="${icon(t)}"><b>${defs[t].name}</b>${n ? `<i>${n}</i>` : ''}</button>`; }).join('');
  const saved = L.filter(c => c.hull === Z.hull).map(c => `<button class="btn sm ${Z.c.id === c.id ? 'on' : ''}" data-dz="load:${c.id}">${esc(c.name)}</button>`).join('');
  const blds = Object.values(C.worlds).filter(w => w.owner === me).reduce((a, w) => a + w.sq.filter(q => q.cls && Z.c.id && q.cls === Z.c.id).length, 0), afloat = C.fleets.filter(f => f.owner === me).reduce((a, f) => a + f.ships.filter(x => Z.c.id && x.cls === Z.c.id).length, 0);
  const h = `<div class="kicker">${date(C.turn)} · the shipwrights</div><h2>Ship classes</h2><p class="dim">Fit a hull out four ways and save it as a class: the build menu at every shipyard then offers it, and a fleet at a shipyard can refit its hulls to it. Every fitting is a trade, priced into the hull.</p>
    <div class="dz"><div class="dzl">${hullList}</div>
    <div class="dzm"><div class="dzname"><input id="dzname" maxlength="24" placeholder="${esc(d.name)} class name" value="${esc(Z.c.name)}"><span>${saved ? 'Saved: ' + saved : 'No class of this hull yet'}</span></div>${slots}</div>
    <div class="dzp"><div class="dzimg"><img src="${icon(Z.hull, me)}"></div><div class="dzt">${Z.c.name ? esc(Z.c.name) + '-class ' : ''}${d.name}</div><div class="dzr hd"><span></span><i>Standard</i><b>This class</b></div>${stats}
      ${Z.c.id ? `<div class="dim sm">${afloat} afloat · ${blds} in the yards</div>` : ''}
      <div class="dzb"><button class="btn go" data-dz="save">${Z.c.id ? 'Save changes' : 'Save class'}</button>${Z.c.id ? `<button class="btn" data-dz="copy">Save as new</button><button class="btn" data-dz="del">Delete</button>` : ''}<button class="btn" data-dz="new">New</button></div></div></div>`;
  modal(h, [['ok', 'Close', 'go']], { esc: 'ok', cls: 'wide xwide dzm0', onInput: e => { if (e.target.id === 'dzname') Z.c.name = e.target.value.slice(0, 24); } });
}
function dzClick(v) {
  const me = C.player, Z = V.dz; if (!Z) return; const [a, b, c] = v.split(':');
  if (a === 'hull') { Z.hull = b; Z.c = null; }
  else if (a === 'opt') Z.c.s[b] = c;
  else if (a === 'load') { const k = TE.classById(me, v.slice(5)); if (k) Z.c = JSON.parse(JSON.stringify(k)); }
  else if (a === 'new') Z.c = null;
  else if (a === 'save' || a === 'copy') {
    const d = K.defsOf(me)[Z.hull], n = TE.classesOf(me).filter(x => x.hull === Z.hull).length + 1, name = (Z.c.name || '').trim() || `${d.name} Mk ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n - 1] || n}`;
    const out = TE.saveClass(me, { id: a === 'copy' ? undefined : Z.c.id, name, hull: Z.hull, s: { ...Z.c.s } }); Z.c = JSON.parse(JSON.stringify(out)); toastS(`${name} class saved: the yards can lay it down`, 'good');
  }
  else if (a === 'del' && Z.c.id) { const name = Z.c.name; TE.deleteClass(me, Z.c.id); Z.c = null; toastS(`${name} class struck from the lists: its ships go back to the standard fit`, ''); }
  classUI();
}

// ---------------------------------------------------------------- refits
function popRefit(fl, anchor) {
  const me = C.player, ids = V.mark.size ? [...V.mark] : fl.ships.map(x => x.id), defs = K.defsOf(me), r = C.fac[me].res, here = new Set(fl.ships.filter(x => ids.includes(x.id)).map(x => x.t));
  const opt = (id, name, desc, n) => { const c = K.refitClassCost(fl, ids, id), ok = n && r.alloy >= c.alloy && r.he >= c.he; return `<button class="bopt" data-rcls="${id}" ${ok ? '' : 'disabled'}><b>${esc(name)}</b><span>${esc(desc)}</span><em>${n ? n + ' hull' + (n > 1 ? 's' : '') + ' · ' + costTxt(c) : 'no hull here takes it'}</em></button>`; };
  const L = TE.classesOf(me).filter(c => here.has(c.hull) && TE.SLOTS.every(S => !TE.optWhy(me, defs[c.hull], S.k, c.s[S.k])));
  const desc = c => TE.SLOTS.map(S => S.opts[c.s[S.k]]).filter(O => O && Object.keys(O.mul).length).map(O => O.name).join(' · ') || 'standard fittings';
  openPop(`<div class="ph">Refit ${V.mark.size ? V.mark.size + ' marked hulls' : 'the whole of ' + esc(fl.name)} <span>to a class of their hull</span><button class="btn sm" data-a="classes">⚒ Ship classes</button></div><div class="pgrid dsg">${L.map(c => opt(c.id, c.name + '-class ' + defs[c.hull].name, desc(c), fl.ships.filter(x => ids.includes(x.id) && x.t === c.hull && x.cls !== c.id).length)).join('')}${opt('', 'Standard fit', 'Strip a class or old fit back to the yard’s own', fl.ships.filter(x => ids.includes(x.id) && (x.cls || x.fit)).length)}</div>${L.length ? '' : `<div class="ihint">No class of these hulls yet: design one under Ship classes (Y).</div>`}`, anchor);
}

// ---------------------------------------------------------------- rulers: the throne, its heir, its legitimacy
function personCard(c, role, f) {
  if (!c) return '';
  const nmR = c.council ? c.name : (c.style && !c.style.startsWith('the ') ? c.style + ' ' : '') + c.name + (c.style && c.style.startsWith('the ') ? ', ' + c.style : '');
  const st = c.council ? 'Rules by vote of the great Houses' : c.state === 'captured' ? `<em class="bad">A prisoner of ${K.BLOC_NAME[c.captor] || 'raiders'}</em>` : c.state === 'fleet' ? 'Commands a fleet in person' : c.state === 'dead' ? 'Dead' : '';
  return `<div class="rcard" style="--fc:${colS(f)}"><div class="rk">${role}</div><b>${esc(nmR)}</b><span>${c.council ? st : [esc(c.title || ''), st].filter(Boolean).join(' · ')}</span>${CM.houseName(c) ? `<span class="dim">${esc(CM.houseName(c))}</span>` : ''}<div class="ctal">${(c.traits || []).map(traitChip).join('')}</div></div>`;
}
function throneBlock(f, intel = true) {
  const r = C.rulers && C.rulers[f]; if (!r) return '';
  const ru = RU.rulerOf(f), h = RU.heirOf(f), L = RU.legitOf(f), D = RU.docOf(f);
  let heir = '';
  if (h) heir = personCard(h, 'Heir', f);
  else if (f === 'rep') { const el = RU.electionParts(), tot = el.reduce((a, x) => a + x[1], 0) || 1;
    heir = `<div class="rcard" style="--fc:${colS(f)}" data-tip="${tipA(`<div class='th'>The Senate elects the next Sovereign</div>${el.map(([c, v]) => `<div class='trow'><span>${esc(c.name)} · ${esc(CM.houseName(c) || '')}</span><b>${Math.round(v / tot * 100)}%</b></div>`).join('')}<div class='tdim'>Each bloc votes for its own candidate, weighted by its seats and its mood: please a bloc and its candidate gains.</div>`)}"><div class="rk">Successor</div><b>Elected by the Senate</b><span>Frontrunner: ${el[0] ? esc(el[0][0].name) + ' (' + Math.round(el[0][1] / tot * 100) + '%)' : 'none'}</span><div class="ctal">${el[0] ? (el[0][0].traits || []).map(traitChip).join('') : ''}</div></div>`; }
  else heir = `<div class="rcard" style="--fc:${colS(f)}"><div class="rk">Heir</div><b>No heir</b><span>If the throne falls empty, the ${f === 'soc' ? 'Houses' : 'council'} will choose.</span></div>`;
  const reg = r.regent != null ? personCard(RU.cById(r.regent), 'Regent', f) : '';
  const lg = `<div class="legit" data-tip="${tipA(partsTip(`Legitimacy ${Math.round(L)}%`, RU.legitParts(f), null, 'It falls when the throne changes hands, and recovers about a point a week toward where it settles. Below 60%, every group at court and every officer grows restless; below 50%, influence falls; below 40%, Houses betray more readily and civil war comes closer.'))}"><span>Legitimacy</span>${bar(L / 100, L < 40 ? 'cap' : L < 60 ? 'am' : '')}<b>${Math.round(L)}%</b></div>`;
  const dc = f !== C.player && intel ? `<div class="rdoc" data-tip="${tipA(`<div class='th'>Way of war: ${D.name}</div><div class='tdim'>${D.desc}</div><div class='trow'><span>Edge it wants before it strikes</span><b>×${D.sup}</b></div><div class='trow'><span>Odds it wants for an Iron Rain</span><b>${Math.round(D.rain * 100)}%</b></div><div class='trow'><span>Keeps its truces</span><b>${D.truce ? 'not always' : 'always'}</b></div>`)}">Way of war: <b>${D.name}</b></div>` : '';
  return `<div class="throne">${personCard(ru, r.council ? 'Rulers' : 'Ruler', f)}${reg}${heir}</div><div class="throne2">${lg}${dc}</div>`;
}
function crisisBlock() {
  const act = ST.activeCrises(), cm = ST.crisisMeters();
  if (!act.length && !cm.length) return '';
  return `<div class="sec">Crises</div>${act.map(k => `<div class="goal"><span class="bad">⚠</span><b class="bad">${ST.CRISES[k].name}</b>&nbsp;<span class="dim" style="width:auto">${ST.CRISES[k].desc}</span></div>`).join('')}${cm.map(x => `<div class="sitrow crm" data-tip="${tipA(partsTip(`${x.name}: ${Math.round(x.prog)}%`, x.parts, null, x.desc + ' At 100% it can break any week; after the first year a stalled war pushes the nearest crisis over the edge.'))}"><span>${x.name}</span><div class="bar cap"><i style="width:${Math.round(x.prog)}%"></i></div><b>${Math.round(x.prog)}%</b></div>`).join('')}`;
}
function factionUI() {
  const me = C.player, ws = Object.values(C.worlds).filter(w => w.owner === me), fls = C.fleets.filter(f => f.owner === me), inc = K.income(me);
  const rivals = ['rep', 'soc', 'rim'].filter(f => f !== me && K.relOf(me, f) !== 'ally');
  const goals = rivals.map(f => { const done = C.worlds[K.CAPITAL[f]].owner === me || !C.fac[f].alive; return `<div class="goal ${done ? 'done' : ''}"><span>${done ? '✔' : '○'}</span>${C.fac[f].alive ? `Hold ${nm(K.CAPITAL[f])}, capital of ${K.BLOC_NAME[f]}` : `${K.BLOC_NAME[f]} has fallen`}</div>`; }).join('');
  const wg = P.atWarWith(me).map(o => { const g = P.goalOf(me, o), held = P.goalHeld(me, o); return g ? `<div class="goal ${held ? 'done' : ''}"><span>${held ? '✔' : '◇'}</span>War goal against ${K.BLOC_NAME[o]}: ${esc(P.goalText(me, o))}${held ? ' · held: +20 war score' : ''}</div>` : ''; }).join('');
  const laws = P.lawsOf(me).map(id => P.lawDef(me, id)).filter(Boolean);
  modal(`<div class="mbanner" style="--fc:${colS(me)}">${SHIELD(me, 54)}<div><div class="kicker">${date(C.turn)}</div><h2>${K.BLOC_NAME[me]}</h2><div class="dim">${C.leaders[me]}${me === 'rep' && C.cmdrs.some(c => c.name.startsWith('Darrow') && c.owner === 'rep' && c.state !== 'dead') ? ' · ' + LEADER2[me] : ''}</div></div><button class="btn sm" data-a="ledger" style="margin-left:auto" data-tip="${tipA('The Ledger: the war in charts, and its Chronicle (H)')}">Ledger · Chronicle</button></div>
    <div class="sec">The throne</div>${throneBlock(me)}
    ${laws.length ? `<div class="sec">Laws in force · ${laws.length} of ${RU.lawSlots(me)}</div><div class="lawpills">${laws.map(L => `<span class="lawpill" data-tip="${tipA(lawTip(me, L))}">${esc(L.name)}</span>`).join('')}</div>` : ''}
    <div class="fgrid"><div class="stat"><i>Worlds</i><b>${ws.length}</b></div><div class="stat"><i>Fleets</i><b>${fls.length}</b></div><div class="stat"><i>Ships</i><b>${fls.reduce((a, f) => a + f.ships.length, 0)}</b></div><div class="stat"><i>Fleet strength</i><b>${fmt(fls.reduce((a, f) => a + K.fleetStr(f), 0))}</b></div><div class="stat"><i>He-3 a week</i><b>${sgn(inc.he)}</b></div><div class="stat"><i>Ore a week</i><b>${sgn(inc.ore)}</b></div><div class="stat" data-tip="${tipA('War weariness: rises with every week at war, every world under siege and every ship lost; falls in peace. Above 40%, every world loses loyalty each week, and manpower income falls.')}"><i>War weariness</i><b class="${(C.weary[me] || 0) > 40 ? 'bad' : ''}">${Math.round(C.weary[me] || 0)}%</b></div></div>
    ${econBlock(me)}
    ${crisisBlock()}
    <div class="sec">Victory</div>${goals}<div class="goal"><span>!</span>Keep ${nm(K.CAPITAL[me])}, or at least one shipyard, or the war is lost</div>${wg}
    <div class="sec">The powers</div>${['rep', 'soc', 'rim'].map(f => `<div class="prow" style="--fc:${colS(f)}">${SHIELD(f, 22)}<b>${K.BLOC_NAME[f]}</b><span>${esc(C.leaders[f])} · ${Object.values(C.worlds).filter(w => w.owner === f).length} worlds · ${fmt(C.fleets.filter(o => o.owner === f).reduce((a, o) => a + K.fleetStr(o), 0))} fleet</span><em class="rt ${f === me ? '' : K.relOf(me, f)}">${f === me ? 'You' : C.fac[f].alive ? RELT[K.relOf(me, f)] : 'Fallen'}</em></div>`).join('')}`,
    [['ok', 'Close', 'go']], { esc: 'ok', enter: 'ok', cls: 'wide' });
}
// ---------------------------------------------------------------- diplomacy: opinions, war score, war goals, peace item by item
const FXN = { man: 'manpower', inf: 'influence', he: 'He-3', build: 'build time', garrison: 'garrison caps', uprise: 'Red risings', trade: 'trade', ar: 'battle strength', weary: 'war weariness', rain: 'Iron Rain troops' };
const fxText = X => Object.entries(X || {}).filter(([k]) => FXN[k]).map(([k, v]) => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}% ${FXN[k]}`).join(' · ');
function lawTip(f, L) { const st = Object.entries(L.stance).map(([g, v]) => `<div class='trow'><span>${esc(P.defOf(f, g) ? P.defOf(f, g).name : g)}</span><b class='${v > 0 ? 'pos' : 'neg'}'>${sg1(v)}</b></div>`).join(''), est = Object.entries(L.est || {}).map(([e, v]) => `<div class='trow'><span>${ESTN[e] || e}, every world</span><b class='${v > 0 ? 'pos' : 'neg'}'>${sg1(v)}</b></div>`).join('');
  return `<div class='th'>${esc(L.name)}</div><div class='tdim'>${esc(L.desc)}</div>${fxText(L.fx) ? `<div class='tgold'>${fxText(L.fx)}</div>` : ''}<div class='tsec'>Where each group settles, while it stands</div>${st}${est ? `<div class='tsec'>Estates' loyalty</div>${est}` : ''}`; }
const itemKey = it => [it.k, it.from, it.w || '', it.cid || '', it.x || ''].join(':');
const keyItem = (k, to) => { const [kk, from, w, cid, x] = k.split(':'); return { k: kk, from, to: from === C.player ? to : C.player, w: w || undefined, cid: cid ? +cid : undefined, x: x || undefined }; };
function dealOf(o) { V.deal = V.deal || {}; const L = (V.deal[o] || []).map(k => keyItem(k, o)).filter(P.itemOK); V.deal[o] = L.map(itemKey); return L; }
function dealPicker(me, o) {
  const items = dealOf(o), on = new Set(items.map(itemKey)), chance = P.acceptChance(me, o, items), parts = P.acceptParts(me, o, items), cost = P.dealCost(o, items);
  const short = it => it.k === 'cede' || it.k === 'demil' ? nm(it.w) : it.k === 'tribute' ? `Tribute, ${P.TRIBUTE_WEEKS} weeks` : it.k === 'prisoners' ? P.itemName(it).replace('Return every officer held', 'Officers held') : it.k === 'ruler' ? P.itemName(it).replace('Hand over ', '') : `Break with ${K.BLOC_NAME[it.x].replace('The ', '')}`;
  const chip = it => `<button class="chip dchip ${on.has(itemKey(it)) ? 'on' : ''}" data-deal="${o}|${itemKey(it)}" data-tip="${tipA(`<div class='th'>${esc(P.itemName(it))}</div><div class='trow'><span>Price in war score</span><b>${P.priceOf(it)}</b></div>`)}">${esc(short(it))}<i>${P.priceOf(it)}</i></button>`;
  const give = P.itemsFor(o, me), take = P.itemsFor(me, o), open = V.dealGive && V.dealGive[o];
  const row = (t, L) => L.length ? `<div class="drow"><span class="dk">${t}</span><div class="dchips">${L.map(chip).join('')}</div></div>` : '';
  const block = (L, who) => row(who + ' cede', L.filter(i => i.k === 'cede')) + row(who === 'They' ? 'They tear down the yards of' : 'We tear down the yards of', L.filter(i => i.k === 'demil')) + row(who === 'They' ? 'And they give' : 'And we give', L.filter(i => i.k !== 'cede' && i.k !== 'demil'));
  return `<div class="deal"><div class="dh">Terms of peace <span>each item is priced in war score</span></div>${block(give, 'They')}<button class="btn sm dgive" data-dgive="${o}">${open ? '▾ What we would give' : '▸ What we would give'}</button>${open ? block(take, 'We') : ''}
    <div class="dsum"><span>${items.length ? esc(items.map(P.itemName).join(' · ')) : 'A white peace: each side keeps what it holds'}</span><b data-tip="${tipA(partsTip(`They would accept: ${Math.round(chance * 100)}%`, parts, null, 'Every point is worth 2% either side of even odds. They weigh the war as they see it, how tired they are, what they think of us and what their ruler wants, against what we ask.'))}" class="${chance > .55 ? 'pos' : chance < .3 ? 'neg' : ''}">${cost > 0 ? 'We ask ' + cost : cost < 0 ? 'We give ' + -cost : 'Even'} · ${Math.round(chance * 100)}% they accept</b>
    <button class="btn sm" data-dclear="${o}">Clear</button><button class="btn sm go" data-propose="${o}" ${C.lastAsk && C.lastAsk[o] === C.turn ? 'disabled' : ''}>Offer these terms</button></div></div>`;
}
function diploUI() {
  const me = C.player;
  const card = f => { const rel = K.relOf(me, f), alive = C.fac[f].alive, tl = P.truceLeft(me, f), sc = alive ? Math.round(P.warScore(me, f)) : 0, net = AG.netOf(me, f), read = net >= AG.NET_READ;
    const desc = !alive ? 'Fallen.' : rel === 'war' ? 'At war. Their fleets will attack yours and their worlds can be taken.' : rel === 'ally' ? 'Allied. Your fleets share orbits without fighting; their capital does not count against your victory.' : (me === 'rim' || f === 'rim') && !C.events.rimAlliance ? 'At peace: the Rim and the Republic have kept the peace of Ilium for ten years.' : 'At peace. Neither side may attack the other.';
    const opT = P.opinionOf(f, me), opM = P.opinionOf(me, f);
    const ops = `<div class="dops"><span data-tip="${tipA(partsTip(`${K.BLOC_NAME[f]}'s opinion of us: ${Math.round(opT)}`, P.opinionParts(f, me), null, 'Grievances and favours fade with time. Opinion moves the odds of every peace, alliance and ransom, and a power that hates you looks for revenge.'))}">Their opinion of us <b class="${opT > 0 ? 'pos' : opT < 0 ? 'neg' : ''}">${sgn(Math.round(opT))}</b></span><span data-tip="${tipA(partsTip(`Our opinion of ${K.BLOC_NAME[f]}: ${Math.round(opM)}`, P.opinionParts(me, f)))}">Ours of them <b class="${opM > 0 ? 'pos' : opM < 0 ? 'neg' : ''}">${sgn(Math.round(opM))}</b></span></div>`;
    const ws = rel === 'war' ? `<span data-tip="${tipA(partsTip(`War score ${sgn(sc)}`, P.warScoreParts(me, f), null, 'The worse the war goes for them, the more they will give for peace. Each item in a peace is priced in war score.'))}">War score <b class="${sc > 0 ? 'pos' : sc < 0 ? 'neg' : ''}">${sgn(sc)}</b></span>` : '';
    const goals = rel === 'war' ? `<div class="dgoals"><div class="${P.goalHeld(me, f) ? 'good' : ''}">Our goal: ${esc(P.goalText(me, f) || 'none')}${P.goalHeld(me, f) ? ' ✔' : ''}</div><div class="${P.goalHeld(f, me) ? 'bad' : 'dim'}">Their goal: ${esc(P.goalText(f, me) || 'none')}${P.goalHeld(f, me) ? ' ✔' : ''}</div></div>` : '';
    const nt = `<div class="alarm net" data-tip="${tipA(partsTip(`Our network in ${K.BLOC_NAME[f]}: ${Math.round(net)}%`, AG.netParts(me, f), null, 'Built by spies set to Build a network in their realm. At 50% we read their court and see every fleet at their worlds; at 80% our spies can turn a House, blackmail an officer, kidnap an heir or rescue a prisoner. Exposure costs us their opinion.'))}"><span>Network</span><div class="bar ${net >= 80 ? '' : net >= 50 ? 'am' : 'cap'}"><i style="width:${Math.round(net)}%"></i></div><b>${Math.round(net)}%</b></div>`;
    const court = read && alive ? `<div class="dcourt"><div class="dk">Their court, as our network reads it</div>${P.groupsOf(f).map(g => `<div class="trow2" data-tip="${tipA(partsTip(`${P.defOf(f, g.id).name}: ${Math.round(g.sat)}%`, P.targetParts(f, g), Math.round(P.targetOf(f, g)) + '%'))}"><span>${esc(P.defOf(f, g.id).name)}</span>${bar(g.sat / 100, g.sat < 30 ? 'cap' : g.sat < 50 ? 'am' : '')}<b>${Math.round(g.sat)}%</b></div>`).join('')}${C.motion[f] ? `<div class="dim small">Before ${P.bodyName(f)}: ${esc((P.motionDef(f, C.motion[f].k) || {}).name || '')}</div>` : ''}</div>` : alive ? `<div class="dim small">Their court is closed to us: a 50% network would read it.</div>` : '';
    const ruler = alive ? `<div class="druler">${esc(C.leaders[f])}${read ? `<div class="ctal">${RU.traitsOf(f).map(traitChip).join('')}</div>` : ''}${read ? `<div class="dim small" data-tip="${tipA(`<div class='th'>Way of war: ${RU.docOf(f).name}</div><div class='tdim'>${RU.docOf(f).desc}</div>`)}">Way of war: ${RU.docOf(f).name} · legitimacy ${Math.round(RU.legitOf(f))}%</div>` : ''}</div>` : '';
    const alarm = f === 'rim' && me !== 'rim' && rel === 'peace' && !C.events.rimAlliance ? `<div class="alarm" data-tip="${tipA(partsTip(`Rim alarm ${Math.round(C.alarm || 0)}%: this week`, K.alarmParts(), null, 'How close the Moon Lords are to war with the Republic. At 100% the Rim goes to war.'))}"><span>Rim alarm</span><div class="bar cap"><i style="width:${Math.round(C.alarm || 0)}%"></i></div><b>${Math.round(C.alarm || 0)}%</b></div>` : '';
    const allyTip = partsTip(`Alliance: ${Math.round(P.allianceChance(me, f) * 100)}%`, P.allianceParts(me, f), null, 'An alliance needs a common enemy.');
    const breakTip = `<div class='th'>Break the truce</div><div class='tdim'>${tl} weeks of truce remain. Breaking it: their opinion of us −40, every other power −15, our ruler's legitimacy −8, and the court is shaken.${RU.hasTrait(me, 'honour') ? ' Our ruler is Honour-bound and will not do it.' : ''}</div>`;
    return `<div class="dcard" style="--fc:${colS(f)}">${SHIELD(f, 46)}<h4>${K.BLOC_NAME[f]}</h4>${ruler}<div class="rt big ${rel}">${alive ? RELT[rel] : 'Fallen'}</div><p>${desc}</p>${alarm}
      <div class="dstats"><span>${Object.values(C.worlds).filter(w => w.owner === f).length} worlds</span><span>${fmt(C.fleets.filter(o => o.owner === f).reduce((a, o) => a + K.fleetStr(o), 0))} fleet</span>${ws}${tl ? `<span>Truce: ${tl} wk</span>` : ''}</div>
      ${alive ? ops + nt : ''}${goals}${court}
      ${alive && rel === 'war' ? dealPicker(me, f) : ''}
      ${alive && rel === 'peace' ? `<div class="dterms"><button class="btn" data-war="${f}" ${tl && RU.hasTrait(me, 'honour') ? 'disabled' : ''} ${tl ? `data-tip="${tipA(breakTip)}"` : ''}>${tl ? 'Break the truce · ' + tl + ' wk' : 'Declare war'}</button><button class="btn" data-ally="${f}" ${C.lastAsk && C.lastAsk[f] === C.turn ? 'disabled' : ''} data-tip="${tipA(allyTip)}">Propose alliance · ${Math.round(P.allianceChance(me, f) * 100)}%</button></div>` : ''}</div>`; };
  const ours = C.cmdrs.filter(c => c.owner === me && c.state === 'captured'), theirs = P.prisoners(me);
  const pris = (ours.length || theirs.length) ? `<div class="sec">Prisoners</div><div class="pris">${ours.map(c => { const R2 = P.ransomOf(c), rp = P.ransomParts(me, c); return `<div class="prow2">${cmdrCard(c, me)}<span>Held by ${K.BLOC_NAME[c.captor] || 'raiders'}</span><button class="btn sm" data-ransom="${c.id}" data-tip="${tipA(partsTip(`They would take it: ${Math.round(Math.min(100, rp.reduce((a, p) => a + p[1], 0)))}%`, rp))}">Ransom · ${costTxt(R2)}</button></div>`; }).join('')}${theirs.map(c => `<div class="prow2">${cmdrCard(c, c.owner)}<span>Our prisoner${RU.isRoyal(c) ? ' · <b class="tgold">a ruler’s blood</b>' : ''}</span><button class="btn sm" data-release="${c.id}" data-tip="${tipA('Free them for what their side will pay: their opinion of us rises')}">Release for ransom</button><button class="btn sm" data-exec="${c.id}" data-tip="${tipA(`Their opinion of us ${RU.isRoyal(c) ? '−50' : '−30'}, every other power −5; your own Golds think less of you${RU.hasTrait(me, 'ruthless') ? ' (not under a Ruthless ruler)' : ''}`)}">Execute</button></div>`).join('')}</div>` : '';
  modal(`<div class="kicker">${date(C.turn)}</div><h2>Diplomacy</h2><div class="dgrid">${['rep', 'soc', 'rim'].filter(f => f !== me).map(card).join('')}</div>${pris}${C.tribute.length ? `<div class="sec">Tribute</div>${C.tribute.map(t => `<div class="goal"><span>◇</span>${K.BLOC_NAME[t.from]} pays ${K.BLOC_NAME[t.to]} ${t.he} He-3 a week · ${t.left} weeks left</div>`).join('')}` : ''}`, [['ok', 'Close', 'go']], { esc: 'ok', enter: 'ok', cls: 'wide xwide' });
}
// ---------------------------------------------------------------- the court: Senate, Houses or council, and agents
function courtUI() {
  const me = C.player, tab = V.ctab || 'pol', k = P.kindOf(me), G = P.groupsOf(me);
  let h = `<div class="kicker">${date(C.turn)}</div><h2>${tab === 'pol' ? P.titleOf(me) : 'Agents'}</h2><div class="ttabs"><button class="btn sm ${tab === 'pol' ? 'on' : ''}" data-ctab="pol">${{ senate: 'The Senate', houses: 'The Houses', council: 'The council' }[k]}</button><button class="btn sm ${tab === 'ag' ? 'on' : ''}" data-ctab="ag">Agents</button></div>`;
  if (tab === 'pol') {
    const sup = P.supportOf(me), fx = (C.polFx && C.polFx[me]) || {};
    if (k === 'senate') {
      const M = C.motion[me];
      h += `<p class="dim">140 senators in three blocs. Each bloc’s mood drifts with the war and jumps with what you do: victories, Iron Rains, bombardment, defiance. Lobbying a bloc costs ${P.LOBBY_COST} influence. Support ${Math.round(sup)}%: ${sup > 60 ? 'the war budget flows: +10% He-3 and influence' : sup < 40 ? 'the Senate starves the war: −15% He-3' : 'the Senate pays, grudgingly'}.</p>`;
      h += `<div class="senate">${G.map(g => { const D = P.defOf(me, g.id); return `<i style="flex:${D.w};--sc:${g.sat > 60 ? '#9be8a8' : g.sat < 40 ? '#ff8a7a' : '#e0c070'}" data-tip="${tipA(`${D.name}: ${D.w} seats, ${Math.round(g.sat)}% satisfied`)}"></i>`; }).join('')}</div>`;
      if (M) { const y = P.projected(me, M.k); h += `<div class="motion"><b>${P.MOTIONS[M.k].name}</b><span>${P.MOTIONS[M.k].desc}</span><em>Vote in ${Math.max(0, M.due - C.turn)} week${M.due - C.turn === 1 ? '' : 's'} · counted now: ${y} for, ${140 - y} against · it needs 71</em></div>`; }
    } else h += `<p class="dim">${k === 'houses' ? `The great Houses of the Remnant. Their favour drifts with the war and jumps with what you do; a House left long in bitterness may betray you, and take its seat with it. Honours cost ${P.HONOUR_COST} influence, a marriage between two Houses ${P.MARRY_COST}.` : `The Moon Lords who make up the council of the Rim. A lord left long in bitterness may break with the Dominion and take his moon with him. Council support ${Math.round(sup)}%: ${sup > 60 ? 'every estate +3 loyalty' : sup < 35 ? 'every estate −4 loyalty' : 'the council is divided'}.`}</p>`;
    h += `<div class="sec">The throne</div>${throneBlock(me)}`;
    h += `<div class="gcards">${G.map(g => { const D = P.defOf(me, g.id), t = P.targetOf(me, g), rk = P.riskParts(me, g), risk = Math.round(rk.reduce((a, x) => a + x[1], 0)), offs = C.cmdrs.filter(c => c.owner === me && c.house === g.id && c.state !== 'dead').length;
      return `<div class="gcard"><div class="gh"><b>${D.name}</b><span>${D.w}${k === 'senate' ? ' seats' : ' power'}${D.seat ? ' · ' + nm(D.seat) : ''}</span></div><div class="dim">${esc(P.headOf(me, g.id))}${offs ? ` · ${offs} officer${offs > 1 ? 's' : ''}` : ''}</div><div class="gsat" data-tip="${tipA(partsTip(`${D.name}: ${Math.round(g.sat)}% satisfied`, P.targetParts(me, g), Math.round(t) + '%', 'Satisfaction moves 8% of the way toward this each week, and jumps with what you do: victories, Iron Rains, bombardment, defiance, honours, and its officers promoted, posted or lost.'))}"><div class="bar ${g.sat < 30 ? 'cap' : g.sat < 50 ? 'am' : ''}"><i style="width:${Math.round(g.sat)}%"></i></div><b>${Math.round(g.sat)}%</b></div><p>${esc(D.likes)}</p>${D.low ? `<div class="gfx"><span class="bad">Below 30%: ${D.low}</span><span class="good">Above 70%: ${D.high}</span></div>` : ''}${D.seat && k !== 'senate' ? `<div class="${risk ? 'bad' : 'dim small'}" data-tip="${tipA(partsTip(`Betrayal: ${risk}% a week`, rk, null, 'A House left under 15% for three weeks running may go over with its seat: to whoever turned it, or to your strongest enemy.'))}">${risk ? `Betrayal risk ${risk}% a week` : g.low ? `Bitter for ${g.low} week${g.low > 1 ? 's' : ''}` : 'Loyal to the throne'}</div>` : ''}
        <div class="gbtns"><button class="btn sm" data-honour="${g.id}">${k === 'senate' ? 'Lobby' : 'Honour'} · ${k === 'senate' ? P.LOBBY_COST : P.HONOUR_COST} inf</button>${k === 'houses' ? `<button class="btn sm ${V.marry === g.id ? 'on' : ''}" data-marry="${g.id}">${V.marry === g.id ? 'Choose the other House' : V.marry ? 'Marry into ' + esc(P.defOf(me, V.marry).name) : 'Arrange a marriage'}</button>` : ''}</div>${g.wed.length ? `<div class="dim small">Bound by marriage to ${g.wed.map(x => P.defOf(me, x).name).join(', ')}</div>` : ''}</div>`; }).join('')}</div>`;
    h += lawsBlock(me);
  } else {
    const A = AG.agentsOf(me);
    h += `<div class="nets">${['rep', 'soc', 'rim'].filter(o => o !== me && C.fac[o].alive).map(o => { const n = AG.netOf(me, o); return `<div class="alarm net" data-tip="${tipA(partsTip(`Our network in ${K.BLOC_NAME[o]}: ${Math.round(n)}%`, AG.netParts(me, o), null, 'At 50% we read their court and see every fleet at their worlds. At 80%: turn a House, blackmail an officer, kidnap an heir, rescue a prisoner.'))}"><span>${SHIELD(o, 16)} ${K.BLOC_NAME[o].replace('The ', '')}</span><div class="bar ${n >= 80 ? '' : n >= 50 ? 'am' : 'cap'}"><i style="width:${Math.round(n)}%"></i></div><b>${Math.round(n)}%</b></div>`; }).join('')}</div>`;
    h += `<p class="dim">Your people in the shadows. Spies and assassins travel to their target and act when they arrive; the better they get, the likelier they are to succeed. Guards, fortresses and capitals make a world harder to work in.</p><div class="arec">${Object.entries(AG.TYPES).map(([t, T]) => `<button class="btn sm" data-recruit="${t}" data-tip="${tipA(`<div class='th'>${T.name[me]}</div><div class='tdim'>${T.desc}</div><div class='trow'><span>Cost</span><b>${T.cost.inf} influence · ${T.cost.he} He-3</b></div><div class='tdim'>At most ${T.max}</div>`)}">Recruit a ${T.name[me]}</button>`).join('')}</div>`;
    h += `<div class="alist">${A.map(a => { const T = AG.TYPES[a.type], fl = a.fleet && C.fleets.find(x => x.id === a.fleet);
      const st = a.state === 'riding' ? `Rides with ${esc(fl ? fl.name : '?')}` : a.state === 'busy' ? `${AG.MISSIONS[a.mission].name} · ${nm(a.target.w || a.target)}${a.mission === 'guard' ? '' : a.left > 0 ? ' · ' + a.left + ' wk' : a.mission === 'network' ? ' · at work' : ''}` : 'Awaiting orders';
      let acts = '';
      if (a.state === 'idle') {
        if (a.type === 'champion') acts = C.fleets.filter(x => x.owner === me).slice(0, 8).map(x => `<button class="btn sm" data-attach="${a.id}:${x.id}">Ride with ${esc(x.name)}</button>`).join('');
        else acts = Object.entries(AG.MISSIONS).filter(([, M]) => M.type === a.type).map(([mk, M]) => `<button class="btn sm" data-amis="${a.id}:${mk}" data-tip="${tipA(M.desc)}">${M.name}</button>`).join('');
      } else acts = `<button class="btn sm" data-arecall="${a.id}">Recall</button>`;
      const pickT = V.apick && V.apick.id === a.id ? `<div class="atgt">${agentTargets(a, V.apick.m).map(t => `<button class="chip" data-atgt="${a.id}:${V.apick.m}:${t.w}${t.x != null ? ':' + t.x : ''}">${esc(t.label)}</button>`).join('') || `<span class="dim">${AG.MISSIONS[V.apick.m].need ? 'No realm where our network reaches ' + AG.MISSIONS[V.apick.m].need + '%' : 'No target in reach'}</span>`}</div>` : '';
      return `<div class="agent"><div class="ah"><b>${esc(a.name)}</b><span>${T.name[me]} · skill ${'◆'.repeat(a.skill)}${'◇'.repeat(3 - a.skill)}</span></div><div class="dim">${st}</div><div class="abtns">${acts}</div>${pickT}</div>`; }).join('') || '<div class="ihint">No agents yet.</div>'}</div>`;
  }
  modal(h, [['ok', 'Close', 'go']], { esc: 'ok', enter: 'ok', cls: 'wide xwide' });
}
function agentTargets(a, m) {
  const me = C.player, M = AG.MISSIONS[m], T = id => ({ w: id, label: nm(id) });
  if (M.target === 'own') return Object.keys(C.worlds).filter(id => C.worlds[id].owner === me).map(T);
  if (M.target === 'cmdr') return [...new Set(C.fleets.filter(f => f.at && K.hostile(me, f.owner) && f.owner !== 'neu' && CM.cmdrOf(f)).map(f => f.at))].map(T);
  if (M.target === 'realm') return Object.keys(C.worlds).filter(id => { const o = C.worlds[id].owner; return o !== 'neu' && o !== me; }).sort((x, y) => (C.worlds[x].owner > C.worlds[y].owner ? 1 : -1) || K.travel(K.CAPITAL[me], x) - K.travel(K.CAPITAL[me], y)).slice(0, 14).map(id => ({ w: id, label: `${nm(id)} · ${K.BLOC_NAME[C.worlds[id].owner].replace('The ', '')} ${Math.round(AG.netOf(me, C.worlds[id].owner))}%` }));
  if (M.target === 'net') { const out = [];
    for (const o of ['rep', 'soc', 'rim']) { if (o === me || !C.fac[o].alive || AG.netOf(me, o) < M.need) continue; const w = C.worlds[K.CAPITAL[o]] && C.worlds[K.CAPITAL[o]].owner === o ? K.CAPITAL[o] : Object.keys(C.worlds).find(id => C.worlds[id].owner === o); if (!w) continue; const tag = ' · ' + K.BLOC_NAME[o].replace('The ', '');
      if (m === 'turn') for (const g of P.groupsOf(o)) out.push({ w, x: g.id, label: `${P.defOf(o, g.id).name} (${Math.round(g.sat)}%)${tag}` });
      if (m === 'blackmail') for (const c of C.cmdrs.filter(c => c.owner === o && ['fleet', 'pool', 'gov'].includes(c.state) && !RU.isRoyal(c) && !c.turnTo).sort((x, y) => y.rank - x.rank).slice(0, 8)) out.push({ w, x: c.id, label: `${c.name}, ${CM.RANK[c.rank]} (loyalty ${Math.round(c.loyalty)}%)` });
      if (m === 'kidnap') { const h = RU.heirOf(o); if (h && ['court', 'pool', 'gov'].includes(h.state)) out.push({ w, x: h.id, label: `${h.name}, heir${tag}` }); }
      if (m === 'rescue') for (const c of C.cmdrs.filter(c => c.owner === me && c.state === 'captured' && c.captor === o)) out.push({ w, x: c.id, label: `${c.name}${tag}` }); }
    return out; }
  return Object.keys(C.worlds).filter(id => { const w = C.worlds[id]; return w.owner !== 'neu' && K.hostile(me, w.owner) && (m !== 'sabotage' || w.lv.yard || Object.values(w.lv).some(v => v)); }).sort((x, y) => K.travel(K.CAPITAL[me], x) - K.travel(K.CAPITAL[me], y)).slice(0, 12).map(T);
}
// laws and edicts: what is in force, what could be, and how the vote would go now
function lawsBlock(me) {
  const L = P.LAWS[me] || [], slots = RU.lawSlots(me), on = P.lawsOf(me), cost = P.lawCost(me), tot = P.totalVotes(me), M = C.motion[me];
  let h = `<div class="sec">Laws and edicts · ${on.length} of ${slots} in force</div><p class="dim">${me === 'rep' ? 'Laws pass the Senate: more than 70 of 140 seats.' : me === 'soc' ? 'Edicts need the assent of the Houses: more than half their power.' : 'Compacts need the council: more than half the Moon Lords’ power.'} Each group votes by its stance on the law and its mood; while a law stands, every group and estate settles by its stance. Proposing costs ${cost} influence; the vote is in two weeks.</p>`;
  if (M) { const D = P.motionDef(me, M.k), y = P.projected(me, M.k); if (D) h += `<div class="motion"><b>${esc(D.name)}</b><span>${esc(D.desc)}</span><em>Vote in ${Math.max(0, M.due - C.turn)} week${M.due - C.turn === 1 ? '' : 's'} · counted now: ${y} for, ${tot - y} against · it needs more than ${Math.floor(tot / 2)}</em></div>`; }
  h += `<div class="laws">${L.map(Lw => { const inF = on.includes(Lw.id), k = (inF ? 'repeal:' : 'law:') + Lw.id, y = P.projected(me, k), e = P.canPropose(me, Lw.id, inF);
    const votes = P.groupsOf(me).map(g => { const ln = P.leanOf(me, g, k); return `<i class="${ln > 50 ? 'y' : 'n'}" style="flex:${P.defOf(me, g.id).w}" data-tip="${tipA(`${P.defOf(me, g.id).name}: ${ln > 50 ? 'for' : 'against'} (stance ${sg1(Lw.stance[g.id] || 0)}, mood ${Math.round(g.sat)}%)`)}"></i>`; }).join('');
    return `<div class="lawc ${inF ? 'on' : ''}" data-tip="${tipA(lawTip(me, Lw))}"><div class="gh"><b>${esc(Lw.name)}</b><span>${inF ? 'In force' : ''}</span></div><p>${esc(Lw.desc)}</p>${fxText(Lw.fx) ? `<div class="tgold small">${fxText(Lw.fx)}</div>` : ''}<div class="lvotes">${votes}</div><div class="gbtns"><button class="btn sm" data-law="${inF ? 'repeal:' : 'law:'}${Lw.id}" ${e ? `disabled title="${esc(e)}"` : ''}>${inF ? 'Repeal' : 'Propose'} · ${cost} inf</button><span class="dim small">${y} of ${tot} for now</span></div></div>`; }).join('')}</div>`;
  if (P.kindOf(me) === 'senate') h += `<div class="sec">The Senate’s own motions</div><div class="gbtns">${Object.entries(P.MOTIONS).filter(([, x]) => x.call).map(([mk, x]) => `<button class="btn sm" data-motion="${mk}" ${M ? 'disabled' : ''} data-tip="${tipA(`<div class='th'>${x.name}</div><div class='tdim'>${x.desc}</div><div class='trow'><span>Counted now</span><b>${P.projected(me, mk)} of ${tot}</b></div>`)}">Call a vote: ${x.name} · ${P.MOTION_COST} inf</button>`).join('')}</div>`;
  return h;
}
function warUI(f) {
  const me = C.player;
  const tl = P.truceLeft(me, f); if (tl && RU.hasTrait(me, 'honour')) { toastS(`A truce holds for ${tl} more weeks, and our ruler is Honour-bound`, 'bad'); return; }
  const council = me === 'rim' && f === 'rep' && P.supportOf('rim') < 50;
  modal(`<div class="mbanner" style="--fc:${colS(f)}">${SHIELD(f, 46)}<div><h2>${tl ? 'Break the truce with' : 'Declare war on'} ${K.BLOC_NAME[f]}?</h2></div></div><p>${f === 'rim' || me === 'rim' ? 'The peace between the Republic and the Rim has held for ten years.' : 'The peace has held.'} Breaking it will cost the faith of your own people: every world you hold loses 6 loyalty, and ${K.BLOC_NAME[f]} will remember it (−20 opinion).</p>${tl ? `<p class="bad">A truce has ${tl} weeks to run. Breaking it: their opinion of us −40, every other power −15 (an oath-breaker), our ruler's legitimacy −8, and the court is shaken.</p>` : ''}<p class="dim">A war goal will be set against them: holding it is worth 20 war score.</p>`, [['war', tl ? 'Break the truce' : 'Declare war', 'go'], ['no', 'Keep the peace']], { esc: 'no' })
    .then(v => { if (v === 'war') { if (council) { P.react(me, 'war', 3); toastS('The council is against it: the Moon Lords will not forget', 'bad'); } const e = K.declareWar(me, f, !!tl); if (e) toastS('The truce holds', 'bad'); else toastS(`${K.BLOC_NAME[me]} is at war with ${K.BLOC_NAME[f]}`, 'bad'); } refresh(); });
}
function menuUI() {
  modal(`<h2>Campaign</h2><p class="dim">${date(C.turn)} · ${K.BLOC_NAME[C.player]}</p><div class="keys"><b>Click</b> select a world or fleet · <b>Right-click</b> send the selected fleet · <b>Wheel</b> zoom · <b>Drag / WASD</b> pan · <b>Tab</b> next fleet · <b>Space</b> home · <b>F</b> faction · <b>P</b> diplomacy · <b>H</b> ledger and chronicle · <b>L</b> lists · <b>R</b> dispatches · <b>Q</b> lay down a hull · <b>Enter</b> end turn · <b>Ctrl+S</b> save · <b>F10</b> graphics</div>`, [['back', 'Back to the war', 'go'], ['save', 'Save'], ['load', 'Load'], ['gfx', 'Graphics'], ['quit', 'Quit to the main menu']], { esc: 'back' })
    .then(v => { if (v === 'quit') quitToMenu(); else if (v === 'save' || v === 'load') savesUI(v); else if (v === 'gfx' && !gfxOpen()) toggleGfx(); });
}
// the save slots: an autosave written every week, three of the player's own, and files for safe keeping
const SIDE_NAME = { rep: 'The Solar Republic', soc: 'The Society Remnant', rim: 'The Rim Dominion' };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 60 * 24 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(); };
export function slotsHTML(mode, list) {
  const by = Object.fromEntries(list.map(m => [m.slot, m]));
  return SV.SLOTS.map(sl => { const m = by[sl], label = sl === 'auto' ? 'Autosave' : 'Slot ' + sl;
    const can = mode === 'save' ? sl !== 'auto' : !!m;
    return `<button class="slot ${m ? '' : 'empty'}" ${can ? `data-m="${mode}:${sl}"` : 'disabled'}><b>${label}</b>${m ? `<span>${esc(SIDE_NAME[m.player] || m.player)} · ${date(m.turn)}</span><i>${m.worlds} world${m.worlds === 1 ? '' : 's'} · saved ${ago(m.t)}</i>` : `<span class="dim">${sl === 'auto' ? 'Written at the start of every week' : 'Empty'}</span>`}${mode === 'save' && m && sl !== 'auto' ? '<em>Overwrite</em>' : ''}</button>`; }).join('');
}
async function savesUI(mode) {
  const list = SV.listSlots();
  const v = await modal(`<div class="kicker">${date(C.turn)} · ${K.BLOC_NAME[C.player]}</div><h2>${mode === 'save' ? 'Save the campaign' : 'Load a campaign'}</h2>
    <p class="dim">${mode === 'save' ? 'Saves are kept in this browser. Export a file as well if you want a copy that survives the browser being cleared.' : 'Loading replaces the war in progress. Anything since its last save is lost.'}</p>
    <div class="slots">${slotsHTML(mode, list)}</div>`, [['back', 'Back', ''], [mode === 'save' ? 'export' : 'import', mode === 'save' ? 'Export to a file' : 'Load from a file', '']], { esc: 'back', cls: 'saves' });
  if (!v || v === 'back') return;
  if (v === 'export') { SV.exportFile(); return toastS('Campaign written to a file', 'good'); }
  if (v === 'import') { try { const d = await SV.pickFile(); loadCampaign(d); } catch (e) { toastS(e.message || 'That file could not be loaded', 'bad'); } return; }
  const [op, sl] = String(v).split(':');
  if (op === 'save') { const e = SV.saveSlot(sl); toastS(e || `Saved to slot ${sl}`, e ? 'bad' : 'good'); return; }
  if (op === 'load') { const d = SV.readSlot(sl); if (!d) return toastS('That save could not be read', 'bad'); loadCampaign(d); }
}
export let onQuit = null; export function setQuitHandler(fn) { onQuit = fn; }
function quitToMenu() { leaveStrat(); C.on = false; V.sel = null; if (onQuit) onQuit(); }

async function rainUI(fl, preferAssault) {
  const w = C.worlds[fl.at], name = nm(w.id), before = w.owner, o = rainCheck(fl); if (o.err) return toastS(o.err, 'bad');
  const podHulls = K.fleetsAt(fl.at, C.player).reduce((a, f) => a + f.ships.filter(s => (K.defsOf(f.owner)[s.t] || {}).troops).length, 0);
  const aTip = podHulls ? `<div class='th'>Assault from orbit</div><div class='tdim'>Fight the landing yourself, on the tactical map. Three landing zones on ${name}'s disk each hold a third of the garrison. Send leechCraft within ${(1600).toLocaleString()} km of a zone to land their legions (the platforms near it shoot some down); warships within 5,000 km of a zone give fire support. Hold two zones of three and ${name} falls. ${podHulls} leechCraft hull${podHulls > 1 ? 's' : ''} in orbit.</div>` : `<div class='th'>Assault from orbit</div><div class='tbad'>Needs leechCraft hulls in orbit: the landing is made by the pods themselves</div>`;
  const gTip = `<div class='th'>Lead it on the ground</div><div class='tdim'>Fight the landing yourself, on the surface of ${name}. Pick the drop zones, then command the cohorts as they land: starShells and leechCraft first, the Storks' legions after them, only onto a zone you still hold. Take two of the city's three sites and hold them, or break the garrison, within 30 minutes.</div>`;
  const pods = fl.ships.reduce((a, s) => a + K.podsIn(fl.owner, s) + ((K.defsOf(fl.owner)[s.t] || {}).troops ? 1 : 0), 0), col = o.chance >= .6 ? 'good' : o.chance >= .35 ? 'gold' : 'bad';
  const go = await modal(`${rainArt(w.id)}<div class="kicker">${date(C.turn)}</div><h2>Drop the Iron Rain on ${name}?</h2>
    <div class="fgrid"><div class="stat"><i>Troops in the drop</i><b>${fmt(o.troops)}</b></div><div class="stat"><i>Shot down on the way</i><b>${Math.round(o.shot * 100)}%</b></div><div class="stat"><i>Garrison</i><b>${fmt(w.garrison)}</b></div><div class="stat"><i>Chance to take it</i><b class="${col}">${Math.round(o.chance * 100)}%</b></div></div>
    ${C.senateHold && C.senateHold.world === w.id && fl.owner === 'rep' ? `<p class="bad"><b>The Senate voted to hold the siege.</b> Dancer's Vox Populi and the Moderates will not spend a million lives on an assault. Drop the Rain and you defy them: the coalition turns on the government, and the Senate will move to recall the ArchImperator.</p>` : ''}${o.storm ? `<p class="bad">${name}'s defences hold about ${o.hold} more week${o.hold > 1 ? 's' : ''}. Drop now and the legions storm the walls: only half the troops reach the surface in fighting order.</p>` : ''}<p>${pods} leechCraft${pods === 1 ? '' : 's'} will be spent in the drop, win or lose.${o.need ? ` For even odds, bring about <b>${fmt(o.need)}</b> more troops, or keep up the siege: each week it wears the garrison down.` : ''}${w.gun ? ` Destroying ${name}'s ${w.gun} gun platform${w.gun > 1 ? 's' : ''} first means fewer drop-ships shot down.` : ''}</p>`,
    [['no', 'Not yet'], [podHulls ? 'assault' : 'noassault', 'Assault from orbit ▸', podHulls ? (preferAssault ? 'go' : '') : 'off', aTip], ['ground', 'Lead it on the ground ▸', '', gTip], ['go', 'Drop the Iron Rain', preferAssault ? '' : 'go']], { esc: 'no', cls: 'rain' });
  if (go === 'assault') return assaultBattle(fl);
  if (go === 'ground') return groundUI(fl);
  if (go !== 'go') return;
  const r = K.ironRain(fl); if (r.err) return toastS(r.err, 'bad');
  sfx && sfx(r.won ? 'built' : 'alarm');
  const last = C.log[0];
  await modal(`${rainArt(w.id, r.won ? 'won' : 'lost')}<div class="kicker">${date(C.turn)}</div><h2 class="${r.won ? 'good' : 'bad'}">${r.won ? 'Iron Rain: ' + name + ' falls' : 'The drop on ' + name + ' fails'}</h2><p>${esc(last ? last.msg : '')}</p>${r.won ? `<p class="dim">${name} was held by ${K.BLOC_NAME[before]}. Its loyalty starts low: garrison it and build a Fortress before it revolts.</p>` : ''}`, [['ok', 'Continue', 'go']], { esc: 'ok', enter: 'ok', cls: 'rain' });
  await pendingUI();
  if (!C.fleets.includes(fl)) V.sel = { w: w.id }; refresh(); checkOver();
}

// the Iron Rain fought on the ground (ground.js, groundview.js): the drop is spent when it falls, win or lose
async function groundUI(fl) {
  const w = C.worlds[fl.at], name = nm(w.id), before = w.owner, spec = K.groundSpec(fl); if (spec.err) return toastS(spec.err, 'bad');
  V.busy = true; let r = null;
  try {
    const meta = { world: name, date: date(C.turn), attName: K.BLOC_NAME[fl.owner], defName: K.BLOC_NAME[w.owner] || 'The garrison', garrison: w.garrison * K.GROUND_SCALE };
    K.groundDrop(fl); leaveStrat();
    r = await GV.fight(spec, meta);
  } catch (e) { console.error(e); }
  enterStrat();
  if (!r) r = { won: false, why: 'the landing came apart.', attLeft: 0, defLeft: 1, def0: 1, leaderLost: [false, false], city: name, sites: [] };
  K.groundSettle(fl, w.id, r, r.def0);
  sfx && sfx(r.won ? 'built' : 'alarm');
  const last = C.log[0];
  await modal(`${rainArt(w.id, r.won ? 'won' : 'lost')}<div class="kicker">${date(C.turn)}</div><h2 class="${r.won ? 'good' : 'bad'}">${r.won ? 'Iron Rain: ' + name + ' falls' : 'The drop on ' + name + ' fails'}</h2><p>${esc(last ? last.msg : '')}</p><div class="fgrid"><div class="stat"><i>Lost in the sky</i><b>${fmt(r.sky || 0)}</b></div><div class="stat"><i>Legionnaires left</i><b>${fmt(r.attLeft)}</b></div><div class="stat"><i>Garrison killed</i><b>${fmt((r.killed || [0])[0])}</b></div><div class="stat"><i>Garrison now (troops)</i><b>${fmt(w.garrison)}</b></div></div>${r.won ? `<p class="dim">${name} was held by ${K.BLOC_NAME[before]}. Its loyalty starts low: garrison it and build a Fortress before it revolts.</p>` : `<p class="dim">The siege goes on. Every week of it wears the garrison down.</p>`}`, [['ok', 'Continue', 'go']], { esc: 'ok', enter: 'ok', cls: 'rain' });
  await pendingUI(); V.busy = false;
  if (!C.fleets.includes(fl)) V.sel = { w: w.id }; refresh(); checkOver();
}
// the Iron Rain as a battle you fight: the landing zones on the tactical map
async function assaultBattle(fl) {
  const me = C.player, w = C.worlds[fl.at], W0 = { gun: w.gun, shield: w.shield, owner: w.owner };
  const cf = { world: w.id, att: me, def: w.owner, atts: [me], defs: [w.owner], withWorld: true, alone: true, assault: true, fleets: K.fleetsAt(w.id, me).map(f => f.id) };
  const snap = [cf.att, cf.def].map(o => K.cfFleets(cf, o).flatMap(f => f.ships.map(s => ({ s, o: f.owner, hp0: s.hp }))));
  V.busy = true; try { const res = await fightBattle(cf); await battleResult(cf, res, snap, W0); await pendingUI(); } catch (e) { console.error(e); } V.busy = false;
  if (V.sel && V.sel.fl && !C.fleets.includes(V.sel.fl)) V.sel = { w: w.id }; refresh(); checkOver();
}
// a hero's quest battle, offered when the mission is done
async function questUI(qp) {
  const Q = QS.QUESTS[qp.k], fl = QS.heroFleetOf(qp.k); if (!Q) return;
  if (!fl || fl.at !== qp.w) { QS.outcome(qp, false); return; }
  const p = QS.chanceOf(qp), rw = K.rewardText(Q.reward);
  const v = await modal(`${Q.defend ? '<div class="evart war"></div>' : rainArt(qp.w)}<div class="kicker">${date(C.turn - 1)} · a quest of ${esc(Q.hero)} · ${nm(qp.w)}</div><h2>${esc(Q.title)}</h2><p>${esc(Q.text)}</p><div class="sec">Objective</div><p class="gold">◆ ${esc(Q.obj.text)}</p><p class="dim">Reward: ${rw}. ${esc(fl.name)} fights it against ${esc(Q.guardName)}${Q.withWorld ? ' and the world’s guns' : ''}.</p>`,
    [['no', 'Stand down', '', 'The quest is given up: it fails'], ['auto', `Let the dice decide · ${Math.round(p * 100)}%`, '', 'Resolve it at once'], ['fight', 'Take command ▸', 'go', 'Fight it on the tactical map']], { cls: 'event wide' });
  if (v === 'fight') { const cf = QS.conflictOf(qp); if (!cf) { QS.outcome(qp, false); return; } const w = C.worlds[cf.world], W0 = { gun: w.gun, shield: w.shield, owner: w.owner };
    const snap = [cf.att, cf.def].map(o => K.cfFleets(cf, o).flatMap(f => f.ships.map(s => ({ s, o: f.owner, hp0: s.hp }))));
    const res = await fightBattle(cf); await battleResult(cf, res, snap, W0); QS.outcome(qp, res.quest === 'won'); }
  else if (v === 'auto') { const r = QS.autoQuest(qp); toastS(`${Q.title}: ${r.won ? 'it succeeds' : 'it fails'}`, r.won ? 'good' : 'bad'); }
  else QS.outcome(qp, false);
  refresh();
}
// ---------------------------------------------------------------- the end of a turn
const sideSum = (cf, o) => { const f = K.cfFleets(cf, o); return { n: f.reduce((a, x) => a + x.ships.length, 0), str: f.reduce((a, x) => a + K.fleetStr(x), 0) }; };
const wait = ms => new Promise(r => setTimeout(r, ms));
// at the end of the turn: the enemy fleet moves the player can see, played back over a second and a half; the camera
// goes to whatever is bound for our worlds
async function replayMoves() {
  const me = C.player, M0 = C.moves0 || {}, L = [];
  for (const fl of C.fleets) { if (fl.owner === me || K.relOf(me, fl.owner) === 'ally' || !vis(fl)) continue; const a = M0[fl.id]; if (a == null) continue;
    let p0; try { p0 = IN.locPos(a, LP); } catch (e) { continue; } const p1 = fleetPos(fl); if (!p0 || !p1 || Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1) continue;
    L.push({ fl, p0, p1, threat: !!(fl.transit && !fl.transit.retreat && C.worlds[fl.transit.to] && C.worlds[fl.transit.to].owner === me && K.hostile(me, fl.owner)) || (!fl.transit && fl.at && C.worlds[fl.at].owner === me && K.hostile(me, fl.owner)) }); }
  if (!L.length) return;
  const T = L.filter(e => e.threat), dur = 1500; V.replay = { t0: performance.now(), dur, L, ids: new Set(L.map(e => e.fl.id)) };
  if (T.length) { const cx = T.reduce((a, e) => a + e.p1.x, 0) / T.length, cy = T.reduce((a, e) => a + e.p1.y, 0) / T.length; V.pan = { x0: S.cam.x, y0: S.cam.y, x1: cx, y1: cy, t0: performance.now(), dur: 1100 }; }
  await wait(dur + 150); V.replay = null; V.pan = null;
}
async function turnBanner() {
  const el = $('sturn'), order = ['rep', 'soc', 'rim'].filter(f => C.fac[f].alive);
  el.innerHTML = `<div class="tk">Ending turn ${C.turn}</div><div class="tf">${order.map(f => `<span data-f="${f}" style="--fc:${colS(f)}">${SHIELD(f, 30)}<i>${K.BLOC_NAME[f].replace('The ', '')}</i></span>`).join('')}</div>`;
  el.classList.remove('hide');
  for (const f of order) { const s = el.querySelector(`[data-f="${f}"]`); if (s) s.classList.add('on'); await wait(f === C.player ? 120 : 260); }
}
async function endTurnUI() {
  if (V.busy || modalOpen() || C.over) return; V.busy = true; initAudio(); closePop(); hideTip();
  try {
    await turnBanner();
    const cfs = K.endTurn(), me = C.player;
    $('sturn').classList.add('hide');
    await replayMoves();
    for (const cf of cfs) {
      if (C.over) break;
      const mineIn = cf.att === me || cf.def === me;
      if (!K.cfFleets(cf, cf.att).length) continue;
      if (!mineIn) { K.autoResolve(cf); continue; }
      if (cf.att === me && K.trivial(cf)) { K.autoResolve(cf); continue; } // the platforms cannot hurt us: no prompt, the guns do it
      const w = C.worlds[cf.world], W0 = { gun: w.gun, shield: w.shield, owner: w.owner };
      const snap = [cf.att, cf.def].map(o => K.cfFleets(cf, o).flatMap(f => f.ships.map(s => ({ s, o: f.owner, hp0: s.hp }))));
      const A0 = sideSum(cf, cf.att), D0 = sideSum(cf, cf.def);
      const myMobile = K.cfFleets(cf, me).some(f => f.ships.length);
      { const p = cf.space ? IN.locPos(cf.space.loc, LP) : LAY.pos[cf.world]; S.cam.x = p.x; S.cam.y = p.y; } S.cam.z = clamp(S.H * .035 / bodyOf(cf.world).r, Math.min(S.cam.z, 1e-3), .25);
      let v = !myMobile ? 'auto' : (await sureWin(cf)) ? 'auto' : await battlePrompt(cf, A0, D0);
      let res;
      if (v === 'withdraw') { res = { attWin: cf.att !== me, world: cf.world, att: cf.att, def: cf.def, atts: cf.atts, defs: cf.defs, withdrew: true, space: cf.space }; K.afterBattle(res); }
      else if (v === 'fight') res = await fightBattle(cf);
      else res = K.autoResolve(cf);
      await battleResult(cf, res, snap, W0); await pendingUI();
      if (C.over) break;
    }
    if (!C.over) K.finishTurn();
    if (C.moving) { LAY = layout(); S.orrery = LAY; }
    while (C.pendingEvents && C.pendingEvents.length && !C.over) { const ev = C.pendingEvents.shift(), E = ST.EVENTS[ev.k]; const tg = typeof ev.t === 'string' && C.worlds[ev.t] ? ev.t : null;
      const v = await modal(`<div class="evart ${E.kind || ''}"></div><div class="kicker">${date(C.turn - 1)}${tg ? ' · ' + nm(tg) : ''}</div><h2>${esc(E.title)}</h2><p>${esc(E.text(ev.f, ev.t))}</p><div class="echoices">${E.choices.map((c, i) => `<button class="btn ${i === 0 && ST.affordable(ev.f, c) ? 'go' : ''}" data-m="c${i}" ${ST.affordable(ev.f, c) ? '' : 'disabled'}><b>${esc(c.label)}</b><span>${esc(c.tip)}</span></button>`).join('')}</div>`, [], { cls: 'event' });
      ST.choose(ev, +String(v).slice(1) || 0); refresh(); }
    if (C.questPend && !C.over) { const q = C.questPend; C.questPend = null; await questUI(q); }
    if (C.pendingOffer && !C.over) { const o = C.pendingOffer; C.pendingOffer = null; await offerUI(o); }
    if (C.pendingVote && !C.over) { const pv = C.pendingVote; C.pendingVote = null; await voteUI(pv); }
    if (C.pending && C.pending.kind === 'rimOffer') {
      const alone = C.pending.alone; C.pending = null;
      const v = alone ? await modal(`<div class="evart war"></div><div class="kicker">${date(C.turn - 1)}</div><h2>The council of the Moon Lords</h2><p>The Remnant has fallen and the Republic's fleets are free. Your council urges war before Io is next.</p>`, [['yes', 'Declare war on the Republic', 'go'], ['no', 'Keep the peace']], { cls: 'event' }) : await modal(`<div class="evart alliance"></div><div class="kicker">${date(C.turn - 1)}</div><h2>An offer from Venus</h2><p>The Ash Lord is dead. Atalantia au Grimmus rules the Remnant as Dictator, and her envoy, Lysander au Lune, offers the Dominion an alliance against the Republic.</p><p class="dim">Accept, and the Remnant becomes your ally and the Republic your enemy. Refuse, and the Rim keeps its peace with both.</p>`, [['yes', 'Join the war', 'go'], ['no', 'Keep the peace']], { cls: 'event' });
      if (v === 'yes') K.acceptRimAlliance(); else K.note('The Rim refuses Atalantia. The Dominion keeps its peace.', 'gold', 'io');
    }
    // promotions: the player chooses the new talent
    while (C.promos && C.promos.length) { const p = C.promos.shift(), c = C.cmdrs.find(x => x.id === p.id); if (!c || c.state === 'dead') continue;
      await modal(`<div class="kicker">${date(C.turn - 1)}</div><h2>${esc(c.name)} · ${CM.RANK[c.rank]}</h2><p>Raised to ${CM.RANK[c.rank]}: ${c.name} can now command ${CM.CAP[c.rank]} ships. Choose a new talent.</p><div class="promos">${p.offer.map(t => `<button class="promo" data-promo="${c.id}:${t}"><b>${CM.TALENT[t].name}</b><span>${CM.TALENT[t].desc}</span></button>`).join('')}</div>`, [], { cls: 'event' }); }
    // event cards for what matters this week
    for (const r of C.report.filter(r => r.ev)) {
      const v = await modal(`<div class="evart ${r.ev.kind}"></div><div class="kicker">${date(C.turn - 1)}</div><h2>${esc(r.ev.title)}</h2><p>${esc(r.msg)}</p>`, r.at ? [['go', 'Show me'], ['ok', 'Continue', 'go']] : [['ok', 'Continue', 'go']], { esc: 'ok', enter: 'ok', cls: 'event' });
      if (v === 'go' && r.at) { select({ w: r.at }, true); zoomTo(r.at); }
    }
    await pendingUI();
    if (C.newTech && TE.pendingChoice(me).length && !C.over) { C.newTech = false; V.ttab = 'tech'; await new Promise(r => { techUI(); const t = setInterval(() => { if (!modalOpen()) { clearInterval(t); r(); } }, 120); }); }
    if (V.sel && V.sel.fl && !C.fleets.includes(V.sel.fl)) V.sel = null;
    refresh(); sfx && sfx('click');
    checkOver(); autosave(); /* every week starts with a save of where the war stands */
  } catch (e) { console.error(e); }
  $('sturn').classList.add('hide');
  V.busy = false;
}
// Total War's forecast: what auto-resolve expects
function forecast(r) { return r > 2.2 ? ['Decisive victory', 'good'] : r > 1.4 ? ['Clear victory', 'good'] : r > 1.05 ? ['Close victory', 'gold'] : r > .8 ? ['Close defeat', 'warnc'] : r > .5 ? ['Clear defeat', 'bad'] : ['Crushing defeat', 'bad']; }
function sideCards(cf, o, withWorld, mine, fc) {
  const w = C.worlds[cf.world], fls = K.cfFleets(cf, o);
  const side = (K.sideOf(cf, o) || [o]).filter(x => x !== o), withA = side.length ? `<em class="bally" data-tip="${tipA(`<div class='th'>A coalition</div><div class='tdim'>Every fleet of an allied power in this orbit fights on this side. ${o === C.player ? 'The battle AI commands the allied hulls: they take no orders from you.' : ''}</div>`)}"> with ${side.map(x => K.BLOC_NAME[x].replace('The ', '')).join(' and ')}</em>` : '';
  let h = `<div class="bside" style="--fc:${colS(o)}"><div class="bsh">${SHIELD(o, 30)}<div><b>${K.BLOC_NAME[o]}${withA}</b><span>${cf.space ? (cf.att === o ? 'Intercepting' : 'Intercepted') : cf.att === o ? 'Attacking' : 'Defending'}${mine ? ' · you' : ''}</span></div></div>`;
  for (const f of fls) h += `<div class="bfl" ${f.owner !== o ? `style="--fc:${colS(f.owner)}"` : ''}>${f.owner !== o ? `<i class="bally">Allied · ${K.BLOC_NAME[f.owner].replace('The ', '')}</i> ` : ''}${esc(f.name)}${CM.cmdrOf(f) ? ` <em class="bcm">${CM.RANK[CM.cmdrOf(f).rank]} ${esc(CM.cmdrOf(f).name)}</em>` : ''} <span>${f.ships.length} ships · ${fmt(K.fleetStr(f))}</span></div><div class="bcards">${f.ships.map(s => shipCard(s, f.owner, fc ? { risk: fc.dieP[s.id], hpE: fc.hpE[s.id] } : {})).join('')}</div>`;
  if (withWorld) h += `<div class="bfl">${nm(cf.world)}'s defences <span>${fmt(K.defStr(w))}</span></div><div class="bdef"><span>⊕ ${w.gun} gun platforms</span><span>◈ ${w.shield} shield platforms</span><span>⌖ Orbital authority ${Math.round(w.gov * 100)}%</span></div>`;
  if (!fls.length && !withWorld) h += `<div class="ihint">No ships.</div>`;
  return h + `</div>`;
}
// the Iron Rain over a world: its portrait at the foot of the frame, pods streaking down into it
function rainArt(id, cls = '') {
  const pic = portrait(id); let streaks = '';
  for (let i = 0; i < 16; i++) streaks += `<i style="--x:${(8 + i * 5.6 + (i * 37 % 7)).toFixed(1)}%;--d:${(i * .23 % 1.6).toFixed(2)}s;--s:${(1.3 + (i * 13 % 7) / 10).toFixed(2)}s"></i>`;
  return `<div class="rainart ${cls}">${pic ? `<img class="rplanet" src="${pic}" alt="">` : ''}${streaks}</div>`;
}
const SPACE_T = { open: 'Open space', belt: 'The Belt', glare: 'In the Sun\'s glare', giant: 'In a gas giant\'s shadow' };
const SPACE_D = { open: 'Nothing to hide behind: no world, no platforms, no Iron Rain.', belt: 'Among the asteroids of the Belt: rocks for cover, lanes for ambush.', glare: 'So close to the Sun that sensors burn out at range: the fight starts close.', giant: 'In the shadow of a gas giant, where its moons and storms break up the sensors.' };
// a battle the forecast calls certain (97%+ and no ship of ours expected lost) is auto-resolved without the battle
// screen: a banner says so for a few seconds, with "Fight it anyway". The setting lives on the battle screen
const SURE_WIN = .97, SURE_LOSS = .5; // the same "we lose none" the battle screen shows
function sureWin(cf) {
  if (OPTS.skipTrivial === false || cf.quest || cf.assault) return Promise.resolve(false);
  const me = C.player, att = cf.att === me, fc = K.forecastBattle(cf, 200), win = att ? fc.attWin : 1 - fc.attWin, lost = fc.lost[att ? 0 : 1];
  if (win < SURE_WIN || lost > SURE_LOSS) return Promise.resolve(false);
  return new Promise(done => {
    const el = document.createElement('div'); el.className = 'surewin';
    el.innerHTML = `<div class="kicker">${cf.space ? 'Battle in deep space off ' : 'Battle of '}${nm(cf.world)}</div><b>A sure win: auto-resolving</b><span>${Math.round(win * 100)}% to win, no ships of ours expected lost</span><div class="swbtns"><button class="btn go" data-sw="fight">Fight it anyway</button><button class="btn" data-sw="ask" title="Always show the battle screen. You can turn this back on there.">Always ask</button></div><i class="swbar"></i>`;
    document.body.appendChild(el); let t = null;
    const end = v => { clearTimeout(t); el.remove(); done(v); };
    el.addEventListener('click', e => { const b = e.target.closest('[data-sw]'); if (!b) return; if (b.dataset.sw === 'ask') { OPTS.skipTrivial = false; saveOpts(); } end(false); });
    // four seconds, and the clock stops while the pointer is over the banner: nobody should lose a battle to a reflex
    let left = 4000, t0 = performance.now(); const go = () => { t0 = performance.now(); t = setTimeout(() => end(true), left); };
    el.addEventListener('mouseenter', () => { clearTimeout(t); left = Math.max(800, left - (performance.now() - t0)); el.classList.add('held'); });
    el.addEventListener('mouseleave', () => { el.classList.remove('held'); go(); }); go();
  });
}
// what only a battle fought on the map can win here, and what it risks: the line under the forecast
function fightWins(cf, fc, att, myLost) {
  const me = C.player, foeO = att ? cf.def : cf.att, foes = K.cfFleets(cf, foeO).flatMap(f => f.ships), mine = K.cfFleets(cf, me).flatMap(f => f.ships);
  const dv = s => { const d = DEFS[s.t] || {}; return d.value || d.cost || 50; };
  const capN = foes.filter(s => (DEFS[s.t] || {}).capture).length, ore = Math.round(foes.reduce((a, s) => a + (fc.dieP[s.id] || 0) * dv(s), 0) * .15);
  const caps = mine.filter(s => { const d = DEFS[s.t] || {}; return d.cmd && (d.len || 0) >= 1500; }).length, G = K.GRADES;
  const it = [
    `<span data-tip="${tipA(`<div class='th'>Victory grades</div><div class='tdim'>A Decisive victory: ${G.decisive.inf} influence, enemy war-weariness +${G.decisive.weary}, commanders +${G.decisive.xp} xp. An Annihilation: ${G.annihilation.inf} influence, war-weariness +${G.annihilation.weary}, commanders +${G.annihilation.xp} xp, and the court's biggest reaction. Auto-resolve stops at Victory (${G.victory.inf} influence).</div>`)}"><b>Up to Annihilation</b> (auto-resolve stops at Victory)</span>`,
    capN ? `<span data-tip="${tipA('Hulls that strike their colours, are boarded, or are left derelict on a field you hold come home as prize ships.')}"><b>Prizes</b> ${capN} of their hulls can be taken</span>` : '',
    ore > 0 ? `<span data-tip="${tipA('Hold the field and the salvage crews strip the wrecks.')}"><b>Salvage</b> ~${fmt(ore)} ore</span>` : '',
    `<span data-tip="${tipA('Hold the field and most of our wrecked escorts (about 6 in 10) are towed home for repair, and some of theirs (about 3 in 10) come in as prize hulls. Capital ships go up with their reactors.')}"><b>Wrecks towed home</b></span>`,
    `<span data-tip="${tipA('The ship of the battle gains a rank: a better crew from then on.')}"><b>Crew ranks</b></span>`,
  ].filter(Boolean).join('');
  const risk = `<span class="bwrisk" data-tip="${tipA(`Auto-resolve spreads losses thin: it leaves capital ships crippled rather than lost unless the enemy is strong, and keeps a big winner's losses small. A battle you fight has no such cushion: what happens on the map is what you keep.`)}"><b>The risk</b> no auto-resolve cushion${caps ? ': capital ships can be lost outright' : ''} (auto-resolve expects ${myLost < .5 ? 'no losses' : '~' + Math.max(1, Math.round(myLost)) + ' lost'})</span>`;
  return `<div class="bwins"><div class="kicker">Take command to win</div><div class="bwl">${it}</div>${risk}</div>`;
}
function battlePrompt(cf, A0, D0) {
  const me = C.player, w = C.worlds[cf.world], att = cf.att === me;
  // fleets a week out that arrive while the battle is joined: the forecast counts them, so the balance shows them too
  const inc = o => cf.space ? [] : C.fleets.filter(f => (K.sideOf(cf, o) || [o]).includes(f.owner) && f.transit && !f.transit.retreat && f.transit.to === cf.world && f.transit.left === 1 && !f.engage);
  const incA = inc(cf.att), incD = inc(cf.def), incS = L => L.reduce((a, f) => a + K.fleetStr(f) * .7, 0);
  const ds = D0.str + (cf.withWorld ? K.defStr(w) : 0) + incS(incD), as = A0.str + incS(incA);
  const myS = att ? as : ds, foeS = att ? ds : as, share = myS / Math.max(1, myS + foeS);
  const incLine = (L, o) => L.length ? `<div class="binc ${o === me || (K.sideOf(cf, me) || [me]).includes(o) ? 'good' : 'bad'}" data-tip="${tipA('A week out, these fleets reach the battle while it is joined. In a battle you fight yourself they arrive partway through, as reinforcements.')}">Arriving mid-battle for ${o === me ? 'us' : K.BLOC_NAME[o].replace('The ', 'the ')}: ${L.map(f => `${esc(f.name)} (${f.ships.length} ships, ${fmt(K.fleetStr(f))})`).join(' · ')}</div>` : '';
  const fc = K.forecastBattle(cf), myWin = att ? fc.attWin : 1 - fc.attWin, myLost = fc.lost[att ? 0 : 1], foeLost = fc.lost[att ? 1 : 0];
  const label = myWin > .97 ? 'Decisive victory' : myWin > .8 ? 'Likely victory' : myWin > .55 ? 'Close victory' : myWin > .45 ? 'A coin toss' : myWin > .2 ? 'Likely defeat' : 'Crushing defeat', lc = myWin > .55 ? 'good' : myWin > .45 ? 'gold' : 'bad';
  const meC = colS(me), foeC = colS(att ? cf.def : cf.att), canW = cf.space ? true : K.canWithdraw(cf.world, me), sp = cf.space;
  const range = v => v < .5 ? 'none' : `~${Math.max(1, Math.round(v))}`;
  // the world, and who leads each side, before the numbers
  const pic = sp ? null : portrait(cf.world), lead = o => { const f = K.cfFleets(cf, o).concat(C.fleets.filter(x => x.owner === o && x.transit && x.transit.to === cf.world && x.transit.left === 1)).map(x => CM.cmdrOf(x)).find(Boolean); return lead0(f, o); };
  const lead0 = (c, o) => c ? `<b style="color:${colS(o)}">${esc(c.name)}</b>` : `<b style="color:${colS(o)}">${o === 'neu' ? 'The garrison' : K.BLOC_NAME[o]}</b>`;
  return modal(`<div class="bhead">${pic ? `<img class="bport" src="${pic}" alt="">` : ''}<div><div class="kicker">${date(C.turn)} · ${sp ? SPACE_T[sp.terrain] : WDEF[cf.world].region || ''}</div><h2>${sp ? 'Battle in deep space off ' + nm(cf.world) : 'Battle of ' + nm(cf.world)}</h2><div class="bvs">${lead(cf.att)}<i>${sp ? (sp.kind === 'ambush' ? 'ambushes' : 'intercepts') : cf.att === me ? 'attacks' : 'comes against'}</i>${lead(cf.def)}${cf.withWorld ? `<i>and the world's guns</i>` : ''}</div>${sp ? `<div class="tdim">${SPACE_D[sp.terrain]}${sp.kind === 'ambush' ? ' Out of the dark: the ambushers strike first (+25% on auto-resolve).' : ''}</div>` : ''}</div></div>
    <div class="bop" data-tip="${tipA('Balance of power: fleets, crews and condition, with the world\'s platforms on the defender\'s side')}"><span style="width:${Math.round(share * 100)}%;background:${meC}"></span><span style="width:${Math.round((1 - share) * 100)}%;background:${foeC}"></span><em style="left:${Math.round(share * 100)}%"></em></div>
    <div class="bopl"><b>${fmt(myS)}</b><span class="${lc}" data-tip="${tipA('From 300 dry runs of this battle on auto-resolve. Red figures on the cards are each ship\'s chance of being lost.')}">Auto-resolve: ${label} · ${Math.round(myWin * 100)}% to win · we lose ${range(myLost)}, they lose ${range(foeLost)}</span><b>${fmt(foeS)}</b></div>${incLine(incA, cf.att)}${incLine(incD, cf.def)}
    ${fightWins(cf, fc, att, myLost)}
    <div class="bsides">${sideCards(cf, cf.att, false, att, fc)}${sideCards(cf, cf.def, cf.withWorld, !att, fc)}</div>
    <label class="bskip" data-tip="${tipA('Battles the forecast calls certain (97% or better, with no ship of ours expected lost) are auto-resolved after a short notice with a Fight it anyway button.')}"><input type="checkbox" data-skipsure ${OPTS.skipTrivial !== false ? 'checked' : ''}> Auto-resolve sure wins without asking</label>`,
    [[canW ? 'withdraw' : 'nowithdraw', sp ? (att ? 'Break off' : 'Break through') : att ? 'Withdraw' : 'Abandon orbit', canW ? '' : 'off', sp ? (att ? 'Let them go and turn for home. Every ship takes 8–18% hull damage on the way out.' : 'Run the gauntlet: hold your course for your destination under fire. Every ship takes 8–18% hull damage.') : canW ? (att ? 'Pull back to your nearest world. Every ship takes 8–18% hull damage on the way out, and you cannot slip away from this enemy here again next week.' : 'Fall back and leave the world to its platforms and garrison. Every ship takes 8–18% hull damage on the way out.') : 'You withdrew from this enemy here last week: this time you must fight.'], ['auto', 'Auto-resolve', '', `${Math.round(myWin * 100)}% to win`], ['fight', 'Take command ▸', 'go', 'Fight it in real time on the tactical map']], { enter: 'fight', esc: null, cls: 'battle wide' });
}
function battleResult(cf, res, snap, W0) {
  const me = C.player, w = C.worlds[cf.world], meSide = cf.att === me ? 0 : 1;
  // where every ship that fought has gone: still with its owner, taken as a prize, or lost
  const fate = e => { const f = C.fleets.find(f => f.ships.includes(e.s)); return !f ? 'dead' : f.owner === e.o ? 'ok' : 'prize'; };
  const lost = i => snap[i].filter(e => fate(e) !== 'ok').length, tot = i => snap[i].length;
  const myLoss = lost(meSide) / Math.max(1, tot(meSide)), foeLoss = lost(1 - meSide) / Math.max(1, tot(1 - meSide));
  const won = (res.attWin && cf.att === me) || (!res.attWin && cf.def === me);
  const grade = res.held && won ? 'The orbit holds' : cf.space && res.through ? (won ? 'Through the line' : 'They broke through') : cf.space && res.timeout ? (won ? 'Lost in the dark' : 'They slipped away') : res.withdrew ? (cf.space ? (cf.att === me ? 'Broken off' : 'Through the gauntlet') : cf.att === me ? 'Withdrawal' : 'Orbit abandoned') : won && res.rout ? (myLoss < .2 ? 'Rout' : 'The enemy breaks') : won ? (K.GRADES[res.grade] ? K.GRADES[res.grade].name : myLoss < .15 && foeLoss > .5 ? 'Decisive victory' : myLoss > .5 ? 'Pyrrhic victory' : myLoss < foeLoss * .6 ? 'Clear victory' : 'Close victory') : (foeLoss > .5 ? 'Close defeat' : myLoss > .6 ? 'Crushing defeat' : 'Defeat');
  const col = i => { const o = i === 0 ? cf.att : cf.def; return `<div class="bside" style="--fc:${colS(o)}"><div class="bsh">${SHIELD(o, 30)}<div><b>${K.BLOC_NAME[o]}</b><span>Lost ${lost(i)} of ${tot(i)} ships</span></div></div><div class="bcards">${snap[i].map(e => { const fa = fate(e); return shipCard(e.s, e.o, { dead: fa === 'dead', prize: fa === 'prize' }); }).join('')}</div>${i === 1 && cf.withWorld && (W0.gun !== w.gun || W0.shield !== w.shield) ? `<div class="bdef"><span class="bad">⊕ ${W0.gun - w.gun} gun platforms destroyed</span><span class="bad">◈ ${W0.shield - w.shield} shield platforms destroyed</span></div>` : ''}</div>`; };
  const after = cf.quest ? `<div class="${res.quest === 'won' ? 'good' : 'bad'} big">${esc(QS.QUESTS[cf.quest].title)}: ${res.quest === 'won' ? 'done' : 'it fails'}.</div>` : cf.space ? '' : res.taken && cf.assault ? `<div class="good big">The legions hold two landing zones of three: ${nm(cf.world)} is taken.</div>` : cf.assault && !res.taken ? `<div class="bad big">The assault on ${nm(cf.world)} fails: the garrison holds. The siege goes on.</div>` : res.taken ? `<div class="${res.attWin === (cf.att === me) ? 'good' : 'bad'} big">${res.rain ? `The Iron Rain fell: ${nm(cf.world)} is taken.` : `The orbital authority was boarded: ${nm(cf.world)} is taken.`}</div>` : w.siege && !res.withdrew ? `<p class="dim">${nm(cf.world)} is under siege by ${K.BLOC_NAME[w.siege.by]}.${w.siege.by === me ? ' Hold orbit a week, then drop the Iron Rain.' : ''}</p>` : '';
  // the grade of the victory, and what it was worth
  const GD = res.grade && K.GRADES[res.grade], sp0 = res.spoils || {}, foeN = K.BLOC_NAME[won ? (cf.att === me ? cf.def : cf.att) : (cf.att === me ? cf.att : cf.def)];
  const gradeLine = GD ? `<div class="vgrade g-${res.grade} ${won ? 'ours' : 'theirs'}"><b>${won ? 'Grade: ' : 'Theirs: '}${GD.name}</b><span>${esc(GD.text)}</span><span class="vgx">${[sp0.inf ? `${won ? '+' : 'They gain '}${sp0.inf} influence` : '', sp0.weary ? `${won ? foeN : 'Our'} war-weariness +${sp0.weary}` : '', sp0.xp ? `${won ? 'Our' : 'Their'} commanders +${sp0.xp} xp` : '', `the court ${GD.react >= 1.5 ? 'rejoices' : GD.react >= 1 ? 'approves' : 'counts the cost'}`].filter(Boolean).join(' · ')}</span>${!res.tactical && won && res.grade === 'victory' ? `<span class="vgcap">Auto-resolve never rises above Victory. Decisive victories and Annihilations are won by taking command.</span>` : ''}</div>` : '';
  return modal(`<div class="kicker">${cf.space ? 'Battle in deep space off ' : 'Battle of '}${nm(cf.world)} · ${date(C.turn)}</div><h2 class="${won ? 'good' : 'bad'}">${grade}</h2>${gradeLine}${after}${res.aar ? aarHTML(res.aar, meSide) : ''}<div class="bsides">${col(0)}${col(1)}</div>`, [['ok', 'Continue', 'go']], { enter: 'ok', esc: 'ok', cls: 'battle wide' });
}
// the after-action report of a battle fought on the tactical map
function aarHTML(A, meSide) {
  const mm = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const ev = [];
  ev.push(`<span>Fought for ${mm(A.t)} · ${esc(A.field)}${A.foe ? ` · against ${esc(A.foe)}` : ''}</span>`);
  if (A.rout[1]) ev.push(`<span class="good">The enemy line broke and ran${A.esc[1] ? `: ${A.esc[1]} ship${A.esc[1] > 1 ? 's' : ''} got clear` : ''}</span>`);
  if (A.broke[0]) ev.push(`<span class="bad">${A.broke[0]} of our crews broke${A.esc[0] ? `, ${A.esc[0]} got clear of the field` : ''}</span>`);
  if (A.prizes) ev.push(`<span class="good">${A.prizes} prize${A.prizes > 1 ? 's' : ''} taken${A.surr ? ` (${A.surr} struck their colours to us)` : ''}</span>`);
  if (A.held) ev.push(`<span class="good">We held the orbit until the assault broke off</span>`);
  if (A.convoy) ev.push(`<span class="${A.convoy.got ? 'good' : 'bad'}">${A.convoy.kind === 'evac' ? 'Evacuation' : 'Relief convoy'}: ${A.convoy.got} of ${A.convoy.of} transports through${A.convoy.lost ? `, ${A.convoy.lost} lost` : ''}</span>`);
  for (const c of A.cmdrs) ev.push(`<span class="${c.fate === 'came through' ? '' : c.ours ? 'bad' : 'good'}">${c.ours ? '' : 'Enemy: '}${esc(c.name)} ${c.fate}</span>`);
  for (const n of A.champs) ev.push(`<span class="bad">The champion ${esc(n)} fell in a duel</span>`);
  const hon = h => `<div class="hon ${h.lost ? 'lost' : ''}"><b>${esc(h.name)}</b><i>${esc(h.cls)}</i><span>${h.kills} kill${h.kills === 1 ? '' : 's'} · ${fmt(h.dmg)} damage${h.lost ? ' · lost' : ''}</span></div>`;
  const nW = n => ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][n] || String(n);
  if (A.towed && A.towed.own) ev.push(`<span class="good">${nW(A.towed.own)} of our wrecked escorts taken in tow: back to the yards for repair</span>`.replace('One of our wrecked escorts', 'One wrecked escort of ours'));
  if (A.towed && A.towed.prize) ev.push(`<span class="good">${nW(A.towed.prize)} enemy wreck${A.towed.prize > 1 ? 's' : ''} towed in as prize hull${A.towed.prize > 1 ? 's' : ''}</span>`);
  if (A.derelictPrizes) ev.push(`<span class="good">${A.derelictPrizes} hulk${A.derelictPrizes > 1 ? 's' : ''} left on the field taken in tow</span>`);
  if (A.salvage && A.salvage.ore) ev.push(`<span class="${A.salvage.team === 0 ? 'good' : ''}">Salvage: ${A.salvage.n} wreck${A.salvage.n > 1 ? 's' : ''} stripped, +${fmt(A.salvage.ore)} ore${A.salvage.team === 0 ? '' : ' to the enemy'}</span>`);
  return `<div class="aar"><div class="aev">${ev.join('')}</div>${A.mvp ? `<div class="amvp"><div class="kicker">Ship of the battle</div><b>${esc(A.mvp.name)}</b><i>${esc(A.mvp.cls)}${A.mvp.lost ? ' · lost with honour' : ''}</i><span>${A.mvp.kills} kill${A.mvp.kills === 1 ? '' : 's'} · ${fmt(A.mvp.dmg)} damage dealt</span>${A.mvp.killed.length ? `<em>${A.mvp.killed.map(esc).join(' · ')}</em>` : ''}</div>` : ''}${A.honours.length ? `<div class="ahon"><div class="kicker">Mentioned in dispatches</div>${A.honours.map(hon).join('')}</div>` : ''}</div>${whyHTML(A)}`;
}
// why it went the way it did: strength over time, damage by weapon, the swing, EMP and ordnance. Team 0 is the player.
function whyHTML(A) {
  if (!A.timeline || A.timeline.length < 2) return '';
  const me = C.player, tl = A.timeline, W = 600, H = 96, t1 = Math.max(1, tl[tl.length - 1][0]), mx = Math.max(1, ...tl.map(e => Math.max(e[1], e[2])));
  const X = t => (t / t1 * W).toFixed(1), Y = v => (H - 4 - v / mx * (H - 10)).toFixed(1), line = i => tl.map(e => `${X(e[0])},${Y(e[i])}`).join(' ');
  const foe = A.foeOwner || null, c0 = colS(me), c1 = foe ? colS(foe) : '#ff6a5a', mm = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  let ticks = ''; for (let t = 0; t <= t1; t += t1 > 900 ? 300 : t1 > 300 ? 120 : 60) ticks += `<line x1="${X(t)}" x2="${X(t)}" y1="0" y2="${H}" class="lg-grid"/><text x="${X(t)}" y="${H - 1}" class="lg-ax" text-anchor="middle">${mm(t)}</text>`;
  const sw = A.swing ? `<rect x="${X(A.swing.t0)}" y="0" width="${Math.max(3, +X(A.swing.t1) - +X(A.swing.t0)).toFixed(1)}" height="${H}" class="aswr"/>` : '';
  const svg = `<svg class="atl2" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ticks}${sw}<polyline points="${line(1)}" style="stroke:${c0}"/><polyline points="${line(2)}" style="stroke:${c1}"/></svg>`;
  const tot = Math.max(1, ...(A.dmgTotal || [0, 0])), bars = t => ((A.dmg || [[], []])[t] || []).slice(0, 5).map(e => `<div class="aw2" data-tip="${tipA(`<div class='th'>${esc(e.name)}</div><div class='trow'><span>On shields</span><b>${fmt(e.sh)}</b></div><div class='trow'><span>On hulls</span><b>${fmt(e.hull)}</b></div>`)}"><span>${esc(e.name)}</span><i style="width:${Math.round((e.sh + e.hull) / tot * 100)}%"><em style="width:${Math.round(e.hull / Math.max(1, e.sh + e.hull) * 100)}%"></em></i><b>${fmt(e.sh + e.hull)}</b></div>`).join('') || '<div class="aw2"><span>Nothing landed</span></div>';
  const n0 = tl[0], nz = tl[tl.length - 1];
  return `<div class="awhy"><div class="awl"><div class="kicker">The battle, minute by minute · fleet strength</div>${svg}<div class="alg"><span style="--c:${c0}"><i></i>Ours ${n0[3]} → ${nz[3]} ships</span><span style="--c:${c1}"><i></i>Theirs ${n0[4]} → ${nz[4]} ships</span></div>${A.swing ? `<div class="asw2">◆ ${esc(A.swing.text)}</div>` : ''}</div>
    <div class="awd"><div class="kicker">Our fire · ${fmt((A.dmgTotal || [0])[0])}</div>${bars(0)}</div><div class="awd"><div class="kicker">Theirs · ${fmt((A.dmgTotal || [0, 0])[1])}</div>${bars(1)}</div>
    <div class="ast2">EMP: our ships lost ${fmt((A.empSec || [0, 0])[0])} ship-seconds to it, theirs ${fmt((A.empSec || [0, 0])[1])} · Ordnance spent: ours ${fmt((A.ordSpent || [0, 0])[0])}, theirs ${fmt((A.ordSpent || [0, 0])[1])}${A.rounds ? ` · rounds fired ${fmt(A.rounds[0])} / ${fmt(A.rounds[1])}` : ''}</div></div>`;
}
// ---------------------------------------------------------------- the Ledger and the Chronicle
const METRICS = [['w', 'Worlds'], ['str', 'Fleet strength'], ['ships', 'Hulls'], ['weary', 'War weariness'], ['sup', 'Court support'], ['legit', 'Legitimacy'], ['he', 'He-3 stockpile'], ['man', 'Manpower'], ['inf', 'Influence']];
const series = () => (C.hist || []).concat([{ t: C.turn, p: K.histPoint() }]);
// a line chart of one metric for the three powers, from the five-weekly ledger
function lineChart(key, W = 900, H = 230, label = true) {
  const S0 = series(), pw = ['rep', 'soc', 'rim'], pad = { l: 52, r: 14, t: 12, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  if (S0.length < 2 || S0[S0.length - 1].t === S0[0].t) return `<div class="lgempty" style="height:${Math.round(H * .55)}px"><b>No history yet</b><span>The ledger takes a reading every five weeks: the first lines appear at week 6.</span></div>`;
  const t0 = S0[0].t, t1 = Math.max(t0 + 1, S0[S0.length - 1].t), vmax = Math.max(1, ...S0.flatMap(h => pw.map(f => (h.p[f] || {})[key] || 0))), top = key === 'weary' || key === 'sup' || key === 'legit' ? 100 : vmax * 1.08;
  const X = t => pad.l + (t - t0) / (t1 - t0) * iw, Y = v => pad.t + ih - v / top * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = top * k / 4, y = Y(v); g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="lg-grid"/><text x="${pad.l - 6}" y="${(y + 3).toFixed(1)}" class="lg-ax" text-anchor="end">${fmt(v)}</text>`; }
  const step = Math.max(5, Math.ceil((t1 - t0) / 8 / 5) * 5); for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) g += `<text x="${X(t).toFixed(1)}" y="${H - 8}" class="lg-ax" text-anchor="middle">W${t}</text>`;
  const lbl = [];
  for (const f of pw) { const pts = S0.filter(h => h.p[f] && (h.p[f].alive !== false || h.p[f][key])).map(h => `${X(h.t).toFixed(1)},${Y(h.p[f][key] || 0).toFixed(1)}`); if (pts.length < 2) continue; const last = pts[pts.length - 1].split(',');
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${colS(f)}" stroke-width="${f === C.player ? 2.6 : 1.8}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${colS(f)}"/>`;
    const lv = S0.filter(h => h.p[f] && (h.p[f].alive !== false || h.p[f][key])); lbl.push({ f, x: +last[0] - 6, y: +last[1] - 6, v: lv[lv.length - 1].p[f][key] || 0 }); }
  // the end labels, nudged apart so they do not sit on each other
  if (label) { lbl.sort((a, b) => a.y - b.y); for (let i = 1; i < lbl.length; i++) if (lbl[i].y - lbl[i - 1].y < 13) lbl[i].y = lbl[i - 1].y + 13;
    for (const L of lbl) { const left = L.x < pad.l + 70; g += `<text x="${(left ? L.x + 18 : L.x).toFixed(1)}" y="${Math.max(11, L.y).toFixed(1)}" class="lg-lbl" fill="${colS(L.f)}" text-anchor="${left ? 'start' : 'end'}">${fmt(L.v)}</text>`; } }
  return `<svg class="lgchart" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
const CHK = { battle: ['⚔', 'Battles'], world: ['◉', 'Worlds'], capital: ['◉', 'Worlds'], fall: ['✕', 'Worlds'], death: ['✝', 'Rulers and heroes'], capture: ['⛓', 'Rulers and heroes'], freed: ['⛓', 'Rulers and heroes'], succession: ['♛', 'Rulers and heroes'], defect: ['↯', 'Rulers and heroes'], war: ['⚔', 'Diplomacy'], peace: ['☮', 'Diplomacy'], treaty: ['✍', 'Diplomacy'], alliance: ['✦', 'Diplomacy'], capit: ['⚑', 'Diplomacy'], law: ['§', 'Courts'], betray: ['↯', 'Courts'], crisis: ['⚠', 'Crises'], start: ['◆', 'All'] };
function chronList(L, max = 200) {
  return `<div class="chron">${L.slice(-max).reverse().map(e => `<div class="chr ${e.k}" ${e.at ? `data-go="${e.at}"` : ''} style="--fc:${e.f ? colS(e.f) : '#9aa0a6'}"><span class="cw">${date(e.t).replace('Week ', 'W').replace(' PCE', '')}</span><i>${(CHK[e.k] || ['·'])[0]}</i><span class="ct">${esc(e.text)}</span></div>`).join('') || '<div class="ihint">Nothing yet.</div>'}</div>`;
}
function ledgerUI() {
  const tab = V.lgtab || 'ledger', mk = V.lgm || 'str', me = C.player;
  let h = `<div class="kicker">${date(C.turn)}</div><h2>${tab === 'ledger' ? 'The Ledger' : 'The Chronicle'}</h2><div class="ttabs"><button class="btn sm ${tab === 'ledger' ? 'on' : ''}" data-lg="ledger">Ledger</button><button class="btn sm ${tab === 'chron' ? 'on' : ''}" data-lg="chron">Chronicle</button></div>`;
  if (tab === 'ledger') {
    h += `<p class="dim">How the three powers have stood, every five weeks since the war began.</p><div class="ttabs">${METRICS.map(([k, n]) => `<button class="btn sm ${k === mk ? 'on' : ''}" data-lm="${k}">${n}</button>`).join('')}</div>${lineChart(mk)}
      <div class="lglegend">${['rep', 'soc', 'rim'].map(f => `<span style="--fc:${colS(f)}"><i></i>${K.BLOC_NAME[f]}${f === me ? ' (you)' : ''}${C.fac[f].alive ? '' : ' · fallen'}</span>`).join('')}</div>
      <div class="lgmini">${[['w', 'Worlds'], ['weary', 'War weariness'], ['legit', 'Legitimacy']].filter(([k]) => k !== mk).map(([k, n]) => `<div><div class="dk">${n}</div>${lineChart(k, 440, 150, false)}</div>`).join('')}</div>`;
  } else {
    const F = V.lgf || 'All', L = (C.chron || []).filter(e => F === 'All' || (CHK[e.k] || [0, ''])[1] === F);
    h += `<div class="ttabs">${['All', 'Battles', 'Worlds', 'Rulers and heroes', 'Diplomacy', 'Courts', 'Crises'].map(x => `<button class="btn sm ${x === F ? 'on' : ''}" data-lf="${x}">${x}</button>`).join('')}</div>${chronList(L)}`;
  }
  modal(h, [['ok', 'Close', 'go']], { esc: 'ok', enter: 'ok', cls: 'wide xwide' });
}
function checkOver() {
  if (!C.over) return;
  const win = C.over.win, me = C.player, L = (C.chron || []), big = L.filter(e => e.k !== 'battle' || /under/.test(e.text)), bat = L.filter(e => e.k === 'battle').length;
  const dead = L.filter(e => e.k === 'death').length, worlds = Object.values(C.worlds).filter(w => w.owner === me).length;
  modal(`<div class="evart ${win ? 'alliance' : 'fall'}"></div><h2 class="${win ? 'good' : 'bad'}">${win ? 'The war is won' : 'The war is lost'}</h2><p>${win ? `${K.BLOC_NAME[me]} rules the Solar System${C.over.how === 'capitulation' ? ': every rival has fallen or bent the knee' : C.over.how === 'supremacy' ? ': three worlds in five, and every rival capital, held for eight weeks' : ''}. ${date(C.turn)}.` : `${K.BLOC_NAME[me]} has fallen. ${date(C.turn)}.`}</p>
    <div class="fgrid"><div class="stat"><i>Weeks of war</i><b>${C.turn - 1}</b></div><div class="stat"><i>Worlds held</i><b>${worlds}</b></div><div class="stat"><i>Battles fought</i><b>${bat}</b></div><div class="stat"><i>Great names lost</i><b>${dead}</b></div><div class="stat"><i>Rulers of ${K.BLOC_NAME[me].replace('The ', '')}</i><b>${L.filter(e => e.k === 'succession' && e.f === me).length + 1}</b></div></div>
    <div class="sec">The powers, week by week · fleet strength</div>${lineChart('str', 900, 200)}<div class="lgmini"><div><div class="dk">Worlds</div>${lineChart('w', 440, 140, false)}</div><div><div class="dk">War weariness</div>${lineChart('weary', 440, 140, false)}</div></div>
    <div class="sec">The Chronicle of the war</div>${chronList(big, 60)}`, [['ledger', 'The full Ledger'], ['menu', 'Main menu', 'go']], { cls: 'event wide xwide' }).then(v => { if (v === 'ledger') { ledgerUI(); const t = setInterval(() => { if (!modalOpen()) { clearInterval(t); quitToMenu(); } }, 200); } else quitToMenu(); });
}
function showReport() { refresh(); }
window.__CAMP = { C, V, K, layout: () => LAY };

// the sure-win setting, from the checkbox on the battle screen
document.addEventListener('change', e => { const b = e.target.closest && e.target.closest('[data-skipsure]'); if (b) { OPTS.skipTrivial = !!b.checked; saveOpts(); } });
