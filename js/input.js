import { S } from './state.js';
import { WORLD, BODIES } from './data.js';
import { clamp, hyp } from './util.js';
import { enqueue, nukesOf } from './sim.js';
import { command, nukeCommand, pickAt, toggleHangars, formGroup, setFormation, setStance, cycle, selGroup , launchAt } from './commands.js';
import { FORMATIONS, STANCES } from './sim.js';
import { toWorld, project, footprint, setView, viewIsDefault, ELEV, ELEV0, AZ } from './cam.js';
import { WINGS } from './render.js';
import { toast, togglePause, showHelp, forceUI, $, builder, toggleCmdPanel, worldJump, lastAlert, toggleLog, OPTS, saveOpts } from './ui.js';
import { WORLDS } from './solar.js';
import { initAudio, sfx } from './audio.js';

const keys = {}; let lastClick = 0, mmDrag = false;
// the minimap frames every body on the map, the Sun included
export const MM = { x: 0, y: 0, h: 420000 };
// near the Sun it frames the inner system out to the Belt; out past the Belt it frames the whole system
export function fitMini() {
  // zoomed in beside a giant: frame its moons
  if (S.cam.z > 2e-4) for (const g of BODIES) { if (!g.gas) continue; const moons = BODIES.filter(m => m.parent != null && BODIES[m.parent] === g); if (!moons.length) continue; const R = Math.min(3e6, Math.max(...moons.map(m => m.orbitR)) * 1.15);
    if (Math.hypot(S.cam.x - g.x, S.cam.y - g.y) < R * 1.3) { MM.x = g.x; MM.y = g.y; MM.h = R; MM.inner = false; MM.local = g.name; return; } }
  MM.local = null;
  let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18; const fp = footprint(), span = Math.max(...fp.map(([x, y]) => Math.hypot(x - S.cam.x, y - S.cam.y)));
  const inner = Math.hypot(S.cam.x, S.cam.y) < 15e6 && span < 12e6; MM.inner = inner; // zoomed out past the inner system: show the whole of it
  for (const b of BODIES) { if (inner && Math.hypot(b.x, b.y) > 12e6) continue; x0 = Math.min(x0, b.x - b.r); y0 = Math.min(y0, b.y - b.r); x1 = Math.max(x1, b.x + b.r); y1 = Math.max(y1, b.y + b.r); }
  MM.x = (x0 + x1) / 2; MM.y = (y0 + y1) / 2; MM.h = Math.max(x1 - x0, y1 - y0) / 2 * 1.12 + 150000;
}
export const MMS = MM;

// ---------------------------------------------------------------- the follow camera and the director
// Follow (.): the camera rides with one ship, low over the plane; middle-drag orbits it. Director (Shift+.): with no ship
// followed, the camera cuts to the big moments of a battle (a capital ship dying, a nuke, a boarding) and back.
const FOLLOW_EL = 30 * Math.PI / 180, FV = { el: FOLLOW_EL, az: 0 };
export function toggleFollow(s) {
  if (S.follow && !s) { endFollow(); return; }
  const t = s || S.selection.find(o => !o.def.static && o.group && o.group.flag === o) || S.selection.find(o => !o.def.static) || (S.inspect && !S.inspect.def.static ? S.inspect : null);
  if (!t) { toast('Select a ship to follow (.)', 'bad'); sfx('deny'); return; }
  S.follow = t; S.followW = null; S.dirShot = null; FV.el = FOLLOW_EL; FV.az = AZ;
  const vr = t.def.vr0 ? t.def.vr0 * (S.hullX || 30) / 30 : t.r; S.cam.z = clamp(Math.max(S.cam.z, S.H * .1 / vr), .02, 4);
}
export function endFollow() { S.follow = null; S.followW = null; }
S.camReset = () => { S.follow = null; S.followW = null; S.dirShot = null; setView(ELEV0, 0); };
const DIR_PRI = { nuke: 3, kill: 2, board: 1, reactor: 1 }, DIR_WHAT = { nuke: 'NUCLEAR LAUNCH', kill: 'A CAPITAL SHIP IS DYING', board: 'BOARDERS AWAY', reactor: 'REACTOR BREACH' };
S.cue = (kind, x, y, r) => {
  if (!OPTS.director || S.follow || S.gameState !== 'play' || S.mode !== 'battle') return;
  const pri = DIR_PRI[kind] || 0, cur = S.dirShot, now = performance.now();
  if (cur && now < cur.until && pri <= cur.pri) return;
  if (!cur) S.dirHome = { x: S.cam.x, y: S.cam.y, z: S.cam.z };
  S.dirShot = { x, y, until: now + (kind === 'nuke' ? 6000 : 4500), pri, what: DIR_WHAT[kind] || '' };
  S.cam.x = x; S.cam.y = y; S.cam.z = clamp(S.H * .09 / Math.max(20, r || 40), .04, .6); // a cut, not a pan
};
const userMoved = () => { if (S.dirShot) { S.dirShot = null; S.dirHome = null; } };
function keyType(k) { for (const row of S.roster) for (const [t, key] of row) if (key.toLowerCase() === k) return t; return null; }
function pickBuilder() { const p = S.selection.length === 1 && S.selection[0].def.producer && S.selection[0].team === 0 ? S.selection[0] : null; if (p) S.builder = p; }
function clearModes(cv) { S.amode = S.nmode = false; S.tmode = null; cv.classList.remove('amode', 'nmode', 'tmode'); }
export function setTargetMode(kind, ships) { const cv = document.getElementById('c'); clearModes(cv); S.tmode = { kind, ships }; cv.classList.add('tmode'); }
export function setNukeMode(ships) { const cv = document.getElementById('c'); clearModes(cv); if (ships) S.selection = ships; S.nmode = true; cv.classList.add('nmode'); toast('Select nuclear target · Esc to abort', 'prompt'); }
function onScreenSel(o) { const [sx, sy, , ok] = project(o.x, o.y); return ok && sx > 0 && sy > 0 && sx < S.W && sy < S.H; }
export function centerSel() {
  const s = S.selection.filter(o => !o.dead); if (!s.length) return;
  // a selection spread across the system: centre on its biggest cluster (or the last group's flagship) instead of the empty middle
  let cx = s.reduce((a, o) => a + o.x, 0) / s.length, cy = s.reduce((a, o) => a + o.y, 0) / s.length, R = 0; for (const o of s) R = Math.max(R, hyp(o.x - cx, o.y - cy));
  const fp = footprint(), span = Math.max(...fp.map(([x, y]) => hyp(x - S.cam.x, y - S.cam.y)));
  if (R > span * .7) {
    const g = S.lastGroup && S.bgroups[S.lastGroup], f = g && g.flag && !g.flag.dead && s.includes(g.flag) ? g.flag : null;
    if (f) { cx = f.x; cy = f.y; }
    else { const cell = 8000, m = new Map(); let best = null; for (const o of s) { const k = Math.floor(o.x / cell) + ':' + Math.floor(o.y / cell); const c = m.get(k) || { n: 0, x: 0, y: 0 }; c.n += o.r; c.x += o.x * o.r; c.y += o.y * o.r; m.set(k, c); if (!best || c.n > best.n) best = c; } cx = best.x / best.n; cy = best.y / best.n; }
  }
  S.cam.x = cx; S.cam.y = cy;
}

// the pointer leaving the page (into the browser's own bar, or the host page round an embedded game) must not leave the
// camera edge-scrolling toward wherever it last was: the view would fly off across the system
document.addEventListener('mouseout', e => { if (!e.relatedTarget && S.mouse) S.mouse.out = true; });
addEventListener('blur', () => { if (S.mouse) S.mouse.out = true; });
addEventListener('mousemove', e => { if (!S.mouse) return; S.mouse.out = false; const t = e.target; S.mouse.edgeOk = !(t && t.closest && t.closest('button,input,select,a,.bb,.otab,[data-wjump],[data-wsel]')); if (!S.mouse.inCanvas) { S.mouse.x = e.clientX; S.mouse.y = e.clientY; } });
// hover: a faint ring on the ship under the cursor, its name after a moment, and a cursor that says what a right-click would do
let hovT = 0, hovLast = null;
function hoverAt(cv) {
  const M = S.mouse, tip = document.getElementById('hovtip') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'hovtip' });
  if (!M.inCanvas || M.down || S.gameState !== 'play') { S.hover = null; tip.style.display = 'none'; cv.classList.remove('hov-attack', 'hov-board', 'hov-escort'); return; }
  const [wx, wy] = toWorld(M.x, M.y), h = pickAt(wx, wy, null);
  if (h !== hovLast) { hovLast = h; hovT = performance.now(); tip.style.display = 'none'; }
  S.hover = h;
  const mine = S.selection.some(s => s.team === 0 && !s.def.static), hostile = h && h.team !== 0 && !(h.team === 2 && !h.def.static && !h.derelict);
  cv.classList.toggle('hov-board', !!(mine && hostile && S.selection.some(s => s.def.boarder) && h.def.capture));
  cv.classList.toggle('hov-attack', !!(mine && hostile) && !cv.classList.contains('hov-board'));
  cv.classList.toggle('hov-escort', !!(mine && h && h.team === 0 && !S.selection.includes(h)));
  clearTimeout(hoverAt.t); if (h) hoverAt.t = setTimeout(() => { if (S.hover !== h) return; const who = h.team === 0 ? '' : h.team === 2 ? 'Neutral · ' : 'Enemy · ';
    tip.textContent = who + h.def.name + (h.cmdr ? ' · ★ ' + h.cmdr.name : '') + ' · hull ' + Math.round(h.hp / h.def.hp * 100) + '%'; tip.style.display = 'block'; tip.style.left = (M.x + 16) + 'px'; tip.style.top = (M.y + 14) + 'px'; }, 300);
}
export function initInput(cv, mm) {
  const M = S.mouse;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  mm.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => {
    initAudio(); M.x = e.clientX; M.y = e.clientY;
    if (S.gameState !== 'play') return;
    if (e.button === 1) { M.mid = true; M.lmx = e.clientX; M.lmy = e.clientY; e.preventDefault(); return; }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (e.button === 0) {
      if (S.amode) { command(wx, wy, true); clearModes(cv); return; }
      if (S.nmode) { nukeCommand(wx, wy); clearModes(cv); return; }
      if (S.tmode) { if (launchAt(S.tmode.kind, wx, wy, S.tmode.ships)) clearModes(cv); return; }
      M.down = true; M.bx = e.clientX; M.by = e.clientY;
    }
    if (e.button === 2) { if (S.amode || S.nmode || S.tmode) { clearModes(cv); return; } M.rd = { sx: e.clientX, sy: e.clientY, wx, wy, drag: false }; }
  });
  addEventListener('mousemove', e => {
    if (M.mid && S.follow) { FV.az -= (e.clientX - M.lmx) * .006; FV.el = clamp(FV.el + (e.clientY - M.lmy) * .004, 24 * Math.PI / 180, 80 * Math.PI / 180); M.lmx = e.clientX; M.lmy = e.clientY; }
    else if (M.mid) { userMoved(); const [ax, ay] = toWorld(M.lmx, M.lmy), [bx, by] = toWorld(e.clientX, e.clientY); S.cam.x -= bx - ax; S.cam.y -= by - ay; M.lmx = e.clientX; M.lmy = e.clientY; }
    if (M.rd) { if (!M.rd.drag && Math.hypot(e.clientX - M.rd.sx, e.clientY - M.rd.sy) > 14) M.rd.drag = true; if (M.rd.drag) { const [wx, wy] = toWorld(e.clientX, e.clientY); S.rdrag = { x0: M.rd.wx, y0: M.rd.wy, x1: wx, y1: wy }; } }
    M.x = e.clientX; M.y = e.clientY; M.inCanvas = e.target === cv;
    hoverAt(cv);
  });
  addEventListener('mouseup', e => {
    mmDrag = false;
    if (e.button === 1) { M.mid = false; return; }
    if (e.button === 2 && M.rd) { const R = M.rd; M.rd = null; S.rdrag = null; if (S.gameState !== 'play') return;
      let face; if (R.drag) { const [wx, wy] = toWorld(e.clientX, e.clientY); face = Math.atan2(wy - R.wy, wx - R.wx); }
      command(R.wx, R.wy, false, { face, queue: e.shiftKey, stern: e.altKey }); return; } /* Alt: attack from astern */
    if (e.button !== 0 || !M.down) return; M.down = false;
    const dx = e.clientX - M.bx, dy = e.clientY - M.by;
    if (!e.shiftKey) S.selection = [];
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
      const [wx, wy] = toWorld(e.clientX, e.clientY); const now = performance.now();
      const wing = WINGS.find(c => c.team === 0 && Math.hypot(c.x - e.clientX, c.y - e.clientY) < 15); // a wing icon takes the whole wing
      const s = wing ? wing.members[0] : pickAt(wx, wy, null);
      if (s && s.team === 0) {
        if (now - lastClick < 300 && !s.def.static) S.selection = S.ships.filter(o => o.team === 0 && o.type === s.type && !o.docked && onScreenSel(o));
        else if (e.shiftKey && S.selection.includes(s)) S.selection = S.selection.filter(o => o !== s);
        else if (wing) { for (const o of wing.members) if (!o.dead && !S.selection.includes(o)) S.selection.push(o); }
        else if (!S.selection.includes(s)) S.selection.push(s);
        sfx('sel');
      } else if (s) { S.selection = []; S.inspect = s; }
      else { // empty space: did we click a world?
        let wsel = null; for (const b of BODIES) if (hyp(b.x - wx, b.y - wy) < Math.max(b.r * 1.15, 14 / S.cam.z)) wsel = b.id;
        S.worldSel = wsel; S.inspect = null;
      }
      if (s) S.worldSel = null;
      lastClick = now;
    } else {
      // under the tilt the box is a screen rectangle, not a world one: test each ship where it is drawn
      const x0 = Math.min(M.bx, e.clientX), x1 = Math.max(M.bx, e.clientX), y0 = Math.min(M.by, e.clientY), y1 = Math.max(M.by, e.clientY);
      const inBox = S.ships.filter(s => { if (s.team !== 0 || s.docked) return false; const [sx, sy, k, ok] = project(s.x, s.y); const m = s.r * k * .8; return ok && sx >= x0 - m && sx <= x1 + m && sy >= y0 - m && sy <= y1 + m; });
      const mob = inBox.filter(s => !s.def.static);
      for (const s of (mob.length ? mob : inBox)) if (!S.selection.includes(s)) S.selection.push(s);
      if (S.selection.length) sfx('sel');
    }
    if (S.selection.length) S.inspect = null; pickBuilder(); forceUI();
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); const [wx, wy] = toWorld(e.clientX, e.clientY); const f = Math.exp(-e.deltaY * .0015);
    S.cam.z = clamp(S.cam.z * f, .0000018, 24); if (S.follow) return; userMoved(); const [nx, ny] = toWorld(e.clientX, e.clientY); S.cam.x += wx - nx; S.cam.y += wy - ny;
  }, { passive: false });
  addEventListener('keydown', e => {
    if (S.gameState !== 'play') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase(); keys[e.key] = true; keys[k] = true;
    if ('wasd'.includes(k) && k.length === 1 && !e.ctrlKey && !e.metaKey) { if (S.follow) endFollow(); userMoved(); return; }
    if (e.key === '.') { toggleFollow(); return; }
    if (e.key === '>') { OPTS.director = !OPTS.director; saveOpts(); S.dirShot = null; toast(OPTS.director ? 'Director on: the camera cuts to the big moments of a battle (Shift+. to turn off)' : 'Director off', ''); if (S.syncOpts) S.syncOpts(); return; }
    if (e.key.startsWith('Arrow')) { e.preventDefault(); if (S.follow) endFollow(); userMoved(); return; }
    if (k === ' ') { e.preventDefault(); if (!S.selection.length && S.lastGroup && S.bgroups[S.lastGroup]) { S.selection = S.bgroups[S.lastGroup].members.filter(s => !s.dead); pickBuilder(); forceUI(); } centerSel(); return; }
    // navigating a map the size of the Core
    if (e.key === 'Home') { e.preventDefault(); const c = S.stations[0]; if (c && !c.dead) { S.cam.x = c.x; S.cam.y = c.y; S.cam.z = Math.max(S.cam.z, .07); S.selection = [c]; S.builder = c; } forceUI(); return; }
    if (e.key === '[' || e.key === ']') { const n = WORLDS.length; S.wIdx = ((S.wIdx ?? -1) + (e.key === ']' ? 1 : n - 1)) % n; worldJump(WORLDS[S.wIdx].id, false); return; }
    if (e.key === 'Tab') { e.preventDefault(); const gs = Object.values(S.bgroups).filter(g => g.flag && !g.flag.dead).sort((a, b) => a.n - b.n); if (!gs.length) return; S.gIdx = ((S.gIdx ?? -1) + 1) % gs.length; const g = gs[S.gIdx]; S.selection = g.members.filter(s => !s.dead); S.lastGroup = g.n; S.cam.x = g.flag.x; S.cam.y = g.flag.y; if (S.cam.z < .02) S.cam.z = .06; pickBuilder(); forceUI(); return; }
    if (e.key === 'F9') { e.preventDefault(); S.meter = !S.meter; if (S.gfxLabels) S.gfxLabels(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); lastAlert(); return; }
    if (e.key === '-' || e.key === '=' || e.key === '+') { let pb = null, pd = 1e18; for (const b of BODIES) if (b.kind === 'planet') { const d = hyp(b.x - S.cam.x, b.y - S.cam.y); if (d < pd) { pd = d; pb = b; } }
      let mo = 0; if (pb) for (const b of BODIES) if (b.parent != null && BODIES[b.parent] === pb) mo = Math.max(mo, b.orbitR || 0);
      const sys = mo ? clamp(S.H * .42 / (mo * 1.15), .0002, .02) : .004; // the planet tier frames the whole moon system
      const T = [.0000025, .00012, sys, .06, .4].sort((a, b) => a - b); const i = T.findIndex(z => z > S.cam.z * 1.05); const cur = i < 0 ? T.length : i; S.cam.z = e.key === '-' ? T[Math.max(0, cur - 2)] ?? T[0] : T[Math.min(T.length - 1, cur)]; return; }
    if (e.key === 'Escape' && S.follow) { endFollow(); return; }
    if (e.key === 'Escape') { // close the innermost thing first
      if (!$('help').classList.contains('hide')) { showHelp(false); if (S.paused) togglePause(); return; }
      if (!$('optp').classList.contains('hide')) { $('optp').classList.add('hide'); $('bOpt').classList.remove('on'); return; }
      if ($('log').classList.contains('open')) { toggleLog(); return; }
      if (S.amode || S.nmode || S.tmode) { clearModes(cv); return; }
      togglePause(); return; }
    if (k === 'p') { togglePause(); return; }
    if (k === 'h') { showHelp(true); return; }
    if (k === 't') { S.showVec = !S.showVec; $('bVec').classList.toggle('on', S.showVec); return; }
    const dk = /^Digit[1-9]$/.test(e.code || '') ? e.code.slice(5) : k;
    if (/^[1-9]$/.test(dk)) {
      if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); formGroup(+dk, false); forceUI(); }
      else if (e.shiftKey) { formGroup(+dk, true); forceUI(); }
      else if (S.bgroups[dk]) { S.lastGroup = +dk; const g = S.bgroups[dk].members.filter(s => !s.dead && s.team === 0); const same = g.length && g.length === S.selection.length && g.every(s => S.selection.includes(s)); S.selection = g; if (same) centerSel(); pickBuilder(); forceUI(); }
      return;
    }
    // active pause: selection, queues and orders all work while the clock is stopped
    if (k === 'f' && e.shiftKey) { const g = selGroup(); setFormation(cycle(FORMATIONS, g ? g.formation : (S.formation || 'wedge')), g); forceUI(); return; }
    if (k === 'q' && e.shiftKey) { const g = selGroup(); if (g) setStance(cycle(STANCES, g.stance), g); else setStance('aggressive'); forceUI(); return; }
    if (k === 'f' && S.selection.some(s => !s.def.static)) { clearModes(cv); S.amode = true; cv.classList.add('amode'); return; }
    if (k === 'g') {
      if (S.selection.some(s => nukesOf(s).some(w => w.ammo >= 1))) { clearModes(cv); S.nmode = true; cv.classList.add('nmode'); toast('Select nuclear target · Esc to abort', 'prompt'); }
      else { toast('No nuclear missiles in selection · Dreadnoughts, the moonBreaker and the Citadel carry them', 'bad'); sfx('deny'); }
      return;
    }
    if (k === 'k') { for (const s of S.selection) if (!s.def.static) { s.order = { type: 'brake' }; s.engage = null; } sfx('ack'); return; }
    if (k === 'r') { let n = 0; for (const s of S.selection) if (!s.def.static && s.type !== 'hauler') { s.order = { type: 'rearm' }; s.engage = null; n++; } if (n) { toast(n + ' ship' + (n > 1 ? 's' : '') + ' returning to rearm', ''); sfx('ack'); } return; }
    if (k === 'l') { toggleHangars(); return; }
    if (k === 'q') { S.selection = S.ships.filter(s => s.team === 0 && !s.def.static && s.type !== 'hauler' && !s.docked); forceUI(); return; }
    if (k === 'e') { if (S.stations[0] && !S.stations[0].dead) { S.selection = [S.stations[0]]; S.builder = S.stations[0]; } forceUI(); return; }
    if (k === 'c' && e.shiftKey) { toggleCmdPanel(); return; }
    const bt = keyType(k); if (bt) { enqueue(0, bt, builder()); forceUI(); }
  });
  addEventListener('keyup', e => { keys[e.key] = false; keys[e.key.toLowerCase()] = false; if (e.key === 'Alt') S.altDown = false; });
  addEventListener('keydown', e => { if (e.key === 'Alt') { S.altDown = true; e.preventDefault(); } }, true); /* Alt held: the stern arc of the ship under the cursor */
  addEventListener('blur', () => { S.altDown = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  const mmWorld = e => { const r = mm.getBoundingClientRect(); return [MM.x + ((e.clientX - r.left) / r.width * 2 - 1) * MM.h, MM.y + ((e.clientY - r.top) / r.height * 2 - 1) * MM.h]; };
  mm.addEventListener('mousedown', e => {
    if (S.gameState !== 'play') return; const [x, y] = mmWorld(e);
    if (e.button === 0) { if (S.nmode) { nukeCommand(x, y); clearModes(cv); return; } if (S.follow) endFollow(); userMoved(); S.cam.x = x; S.cam.y = y; mmDrag = true; }
    else if (e.button === 2) { command(x, y, S.amode, { queue: e.shiftKey }); clearModes(cv); }
  });
  mm.addEventListener('mousemove', e => { if (mmDrag) { const [x, y] = mmWorld(e); S.cam.x = x; S.cam.y = y; } });
}
export function camUpdate(dt) {
  const sp = 900 / S.cam.z * dt, c = S.cam, M = S.mouse;
  // the follow camera rides with its ship (and on with her wreck); the view eases down to it and back up after
  if (S.follow) {
    const f = S.follow; if (f.dead || f.offField) { const w = S.wrecks.find(o => o.id === f.id) || S.hulks.find(o => o.id === f.id && !o.dead); if (w) S.followW = w; else endFollow(); }
  }
  const tg = S.follow ? (S.followW || S.follow) : null;
  if (tg) { const k = Math.min(1, dt * 7); c.x += (tg.x - c.x) * k; c.y += (tg.y - c.y) * k; }
  { const el = tg ? FV.el : ELEV0, az = tg ? FV.az : 0; if (Math.abs(el - ELEV) > 1e-4 || Math.abs(az - AZ) > 1e-4) { const k = Math.min(1, dt * 5), da = ((az - AZ + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; setView(Math.abs(el - ELEV) < 1e-3 ? el : ELEV + (el - ELEV) * k, Math.abs(da) < 1e-3 ? az : AZ + da * k); } }
  if (S.dirShot && performance.now() > S.dirShot.until) { const h = S.dirHome; S.dirShot = null; if (h) { c.x = h.x; c.y = h.y; c.z = h.z; } S.dirHome = null; }
  if (tg) { c.x = clamp(c.x, -WORLD, WORLD); c.y = clamp(c.y, -WORLD, WORLD); return; }
  if (S.gameState === 'play') {
    if (keys.ArrowLeft || keys.a) c.x -= sp; if (keys.ArrowRight || keys.d) c.x += sp; if (keys.ArrowUp || keys.w) c.y -= sp; if (keys.ArrowDown || keys.s) c.y += sp;
    if ((M.inCanvas || M.edgeOk) && !M.out && !M.down && !M.mid && document.hasFocus()) { const m = 6; if (M.x < m) c.x -= sp; if (M.x > S.W - m) c.x += sp; if (M.y < m) c.y -= sp; if (M.y > S.H - m) c.y += sp; }
  }
  c.x = clamp(c.x, -WORLD, WORLD); c.y = clamp(c.y, -WORLD, WORLD);
}
