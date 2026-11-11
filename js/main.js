import { S } from './state.js';
import { update, newGame, attract, setGameOverHandler, explosion, nukeBlast } from './sim.js';
import { initRender, render, drawMini, resizeRender, setBloom, applyQuality, setLowRes } from './render.js';
import { preset, setQualityName, setHullX, nextIn, QUALITY_ORDER, HULL_STEPS } from './gfx.js';
import { initInput, camUpdate, MMS, fitMini } from './input.js';
import { buildUI, updUI, togglePause, showHelp, endGame, $, buildMenu, toggleCmdPanel, forceUI, toggleGrpPanel, startRename, endRename, worldJump, toggleLog, jumpTo, setOTab, OPTS, saveOpts, AP_LIST, speedTxt } from './ui.js';
import { setAim, commanderAction, setFormation, setStance, setHelm, braceSel, formGroup, cycle, selGroup } from './commands.js';
import { disbandGroup, groupOrder, FORMATIONS, STANCES, HELMS } from './sim.js';
import { initAudio, audio } from './audio.js';
import { startCampaign, stratFrame, setQuitHandler, loadCampaign, slotsHTML } from './stratview.js';
import * as SV from './save.js';
import { STARTS } from './starts.js';
import { FACTIONS } from './data.js';
import { battleTick } from './battle.js';
import { ffStop } from './tactics.js';
import { initGfxMenu, toggleGfx } from './gfxmenu.js';
import { groundFrame } from './groundview.js';

const STEP = 1 / 60;
let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0;

async function boot() {
  try { await Promise.race([document.fonts.load('600 24px Cinzel'), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* fall back to Georgia */ }
  try { await initRender(); }
  catch (err) { console.error(err); $('menu').querySelector('.card').insertAdjacentHTML('beforeend', '<p style="color:#ff8a6e">The renderer failed to start in this browser: ' + err.message + '</p>'); return; }
  const cv = document.getElementById('c'); const mm = $('mini');
  initInput(cv, mm); initGfxMenu();
  setGameOverHandler(endGame);
  addEventListener('resize', () => { S.W = innerWidth; S.H = innerHeight; resizeRender(); });
  $('bVec').classList.add('on'); $('bBloom').classList.toggle('on', S.bloom);
  $('bVec').onclick = () => { S.showVec = !S.showVec; $('bVec').classList.toggle('on', S.showVec); };
  $('bBloom').onclick = () => { setBloom(!S.bloom); $('bBloom').classList.toggle('on', S.bloom); };
  const gfxLabels = () => { $('bQual').textContent = preset().label + ' quality'; $('bHull').textContent = 'Hulls ' + S.hullX + '×'; $('bMeter').classList.toggle('on', !!S.meter); };
  gfxLabels();
  $('bQual').onclick = () => { setQualityName(nextIn(QUALITY_ORDER, S.quality)); applyQuality(); gfxLabels(); };
  $('bHull').onclick = () => { setHullX(nextIn(HULL_STEPS, S.hullX)); gfxLabels(); };
  $('bMeter').onclick = () => { S.meter = !S.meter; gfxLabels(); };
  $('bGfx').onclick = e => { e.stopPropagation(); $('optp').classList.add('hide'); $('bOpt').classList.remove('on'); toggleGfx(); };
  S.gfxLabels = gfxLabels;
  // the clock: slow time for the moments that matter, fast for the long burns; right-click steps it back down
  const SPEEDS = [.25, .5, 1, 2, 3], stepSpd = d => { if (S.mode === 'battle' && ffStop()) { $('bSpd').textContent = 'Speed ' + speedTxt(S.speed); return; } const i = SPEEDS.indexOf(S.speed); S.speed = SPEEDS[i < 0 ? 2 : (i + d + SPEEDS.length) % SPEEDS.length]; $('bSpd').textContent = 'Speed ' + speedTxt(S.speed); };
  $('bSpd').onclick = () => stepSpd(1); $('bSpd').oncontextmenu = e => { e.preventDefault(); stepSpd(-1); };
  // the options panel: auto-pause and the director, kept between sessions
  const syncOpts = () => { for (const b of document.querySelectorAll('#optp [data-ap]')) b.classList.toggle('on', !!OPTS.ap[b.dataset.ap]); const d = $('bDir'); if (d) d.classList.toggle('on', !!OPTS.director); };
  S.syncOpts = syncOpts;
  $('apRow').innerHTML = AP_LIST.map(([k, n, d]) => `<button class="btn sm" data-ap="${k}" title="Pause the battle when: ${d}">${n}</button>`).join('');
  $('optp').addEventListener('click', e => { const b = e.target.closest('[data-ap]'); if (b) { OPTS.ap[b.dataset.ap] = !OPTS.ap[b.dataset.ap]; saveOpts(); syncOpts(); } });
  $('bDir').onclick = () => { OPTS.director = !OPTS.director; S.dirShot = null; saveOpts(); syncOpts(); };
  syncOpts();
  $('bPause').onclick = togglePause;
  $('bSnd').onclick = () => { initAudio(); audio.muted = !audio.muted; $('bSnd').classList.toggle('on', !audio.muted); $('bSnd').textContent = audio.muted ? 'Muted' : 'Sound'; };
  $('bHelp').onclick = () => showHelp(true);
  $('bCmd').onclick = toggleCmdPanel;
  // delegated clicks for the rebuilt-on-change panels
  const panelClick = e => {
    const el = e.target.closest('[data-baim],[data-pick],[data-dets],[data-aim],[data-cact],[data-t],[data-form],[data-stance],[data-helm],[data-brace],[data-gform],[data-gcyc],[data-gjump],[data-gdis],[data-greg],[data-tips],[data-gren],[data-gsel],[data-wjump],[data-wsel],[data-otab],[data-wview]'); if (!el || el.tagName === 'INPUT') return;
    const ds = el.dataset, G = ds.gn ? S.bgroups[ds.gn] : null;
    if (ds.pick) { const id = +ds.pick, sh = S.ships.find(x => x.id === id); if (sh) { if (e.shiftKey) S.selection = S.selection.includes(sh) ? S.selection.filter(x => x !== sh) : S.selection.concat(sh); else S.selection = [sh]; if (ds.jump && !e.shiftKey && e.detail > 1) { S.cam.x = sh.x; S.cam.y = sh.y; if (S.cam.z < .03) S.cam.z = .06; } } }
    else if (ds.baim != null) { const t = ds.sid && S.ships.find(x => x.id === +ds.sid); if (t) t.boardAim = ds.baim || null; else S.boardAim0 = ds.baim || null; }
    else if (ds.dets) S.detOpen = !S.detOpen;
    else if (ds.wview) { S.selection = []; S.inspect = null; S.worldSel = ds.wview; }
    else if (ds.wjump) worldJump(ds.wjump, false);
    else if (ds.wsel) worldJump(ds.wsel, true);
    else if (ds.otab) setOTab(ds.otab);
    else if (ds.form) setFormation(ds.form);
    else if (ds.stance) setStance(ds.stance);
    else if (ds.helm) setHelm(ds.helm);
    else if (ds.brace) braceSel();
    else if (ds.gform) formGroup(+ds.gform, false);
    else if (ds.gcyc) { if (G) { if (ds.gcyc === 'form') setFormation(cycle(FORMATIONS, G.formation), G); else if (ds.gcyc === 'helm') setHelm(cycle(HELMS, G.helm || 'auto'), G); else setStance(cycle(STANCES, G.stance), G); } }
    else if (ds.gjump) { const g = S.bgroups[ds.gjump]; if (g && g.flag) { S.cam.x = g.flag.x; S.cam.y = g.flag.y; if (S.cam.z < .02) S.cam.z = .06; S.selection = g.members.slice(); S.lastGroup = g.n; } }
    else if (ds.gdis) disbandGroup(+ds.gdis);
    else if (ds.greg) { const g = S.bgroups[ds.greg]; if (g && g.flag && !g.flag.dead) groupOrder(g, 'move', g.flag.x, g.flag.y); }
    else if (ds.tips !== undefined) { S.tipsOpen = !S.tipsOpen; forceUI(); }
    else if (ds.gren) startRename(+ds.gren);
    else if (ds.gsel) { const g = S.bgroups[ds.gsel]; if (g) { S.selection = g.members.slice(); S.lastGroup = g.n; } }
    else if (ds.aim !== undefined) setAim(ds.aim);
    else if (el.dataset.cact) commanderAction(+el.dataset.cid, el.dataset.cact);
    else if (el.dataset.t) S.selection = S.selection.filter(s => s.type === el.dataset.t);
    forceUI();
  };
  $('selp').addEventListener('click', panelClick); $('cmdp').addEventListener('click', panelClick); $('grpp').addEventListener('click', panelClick);
  $('grpp').addEventListener('keydown', e => { if (e.target.id === 'grpname') { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') endRename(+e.target.dataset.gn, e.key === 'Enter' ? e.target.value : null); } });
  $('grpp').addEventListener('focusout', e => { if (e.target.id === 'grpname') endRename(+e.target.dataset.gn, e.target.value); });
  $('bGrp').onclick = toggleGrpPanel; $('bGrp').classList.add('on');
  document.body.appendChild($('optp')); // outside the top bar so nothing clips it
  $('bOpt').onclick = e => { e.stopPropagation(); $('optp').classList.toggle('hide'); $('bOpt').classList.toggle('on'); };
  addEventListener('mousedown', e => { if (!e.target.closest('#optp,#bOpt')) { $('optp').classList.add('hide'); $('bOpt').classList.remove('on'); } });
  let wClickT = null;
  $('wstrip').addEventListener('click', e => { const b = e.target.closest('[data-world]'); if (!b) return; clearTimeout(wClickT); const id = b.dataset.world; wClickT = setTimeout(() => worldJump(id, false), 220); });
  $('wstrip').addEventListener('dblclick', e => { const b = e.target.closest('[data-world]'); if (!b) return; clearTimeout(wClickT); worldJump(b.dataset.world, true); });
  $('log').addEventListener('click', e => { const r = e.target.closest('[data-log]'); if (!r) return; if (r.dataset.log === 'toggle') toggleLog(); else jumpTo((S.log || [])[+r.dataset.log]); forceUI(); });
  buildMenu();
  // the legendary starts: the selected power's commanders, each with a place and a rule of their own
  const POWOF = { rising: 'rep', core: 'soc', rim: 'rim' }; S.startSel = S.startSel || {}; S.ahist = false;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const buildStarts = () => { const f = POWOF[S.choice.player] || 'rep', L = STARTS[f] || [], cur = S.startSel[f] || L[0].id, col = FACTIONS[S.choice.player] ? FACTIONS[S.choice.player].col.main : '#f2c14e';
    $('starts').innerHTML = L.map(st => `<button class="start ${st.id === cur ? 'on' : ''}" data-start="${st.id}" style="--fc:${col}" title="${esc(st.rule.name + ': ' + st.rule.desc)}"><b>${esc(st.name)}</b><i>${esc(st.cmdr)} · ${esc(st.where)}</i><span>${esc(st.blurb)}</span><em>${esc(st.rule.name)}</em></button>`).join(''); };
  $('starts').addEventListener('click', e => { const b = e.target.closest('[data-start]'); if (!b) return; S.startSel[POWOF[S.choice.player] || 'rep'] = b.dataset.start; buildStarts(); });
  $('facP').addEventListener('click', () => setTimeout(buildStarts, 0));
  $('bAhist').onclick = () => { S.ahist = !S.ahist; $('bAhist').classList.toggle('on', S.ahist); };
  $('bMove').onclick = () => { S.moving = !S.moving; $('bMove').classList.toggle('on', S.moving); };
  buildStarts();
  $('closeHelp').onclick = () => { showHelp(false); if (S.paused) togglePause(); };
  for (const b of document.querySelectorAll('#diffs .btn')) b.onclick = () => { S.difficulty = +b.dataset.d; for (const o of document.querySelectorAll('#diffs .btn')) o.classList.toggle('on', o === b); };
  S.cam0 = S.cam; S.menuMode = 'camp';
  const setMode = m => { S.menuMode = m; for (const o of document.querySelectorAll('#modes .btn')) o.classList.toggle('on', o.dataset.mode === m); document.body.classList.toggle('mcamp', m === 'camp'); $('start').textContent = m === 'camp' ? 'Begin the war' : 'Break the Line'; if (S.menuSaves) S.menuSaves(); };
  for (const b of document.querySelectorAll('#modes .btn')) b.onclick = () => setMode(b.dataset.mode);
  setMode('camp');
  setQuitHandler(() => { S.cam = S.cam0; $('menu').classList.remove('hide'); S.gameState = 'menu'; setLowRes(true); attract(); if (S.menuSaves) S.menuSaves(); });
  $('start').onclick = () => { initAudio(); setLowRes(false); $('menu').classList.add('hide'); if (S.menuMode === 'camp') { const f = POWOF[S.choice.player] || 'rep'; startCampaign(S.choice.player, S.difficulty, S.startSel[f] || null, { ahist: !!S.ahist, moving: !!S.moving }); return; } S.cam = S.cam0; S.gameState = 'play'; newGame(); document.body.dataset.fac = { rising: 'rep', core: 'soc', rim: 'rim' }[S.choice.player] || 'rep'; buildUI(); S.paused = false; $('pauseTag').classList.add('hide'); $('bSnd').classList.toggle('on', !audio.muted); };
  // saved campaigns: Continue picks up the latest; Load lists the slots and takes a file
  const go = d => { initAudio(); setLowRes(false); $('menu').classList.add('hide'); $('loadp').classList.add('hide'); loadCampaign(d); };
  const saves = () => { const L = SV.listSlots(), camp = S.menuMode === 'camp'; $('bCont').classList.toggle('hide', !L.length || !camp); $('bLoad').classList.toggle('hide', !camp); if (!camp) $('loadp').classList.add('hide'); return L; };
  S.menuSaves = saves; saves();
  $('bCont').onclick = () => { const m = SV.latest(), d = m && SV.readSlot(m.slot); if (d) go(d); else saves(); };
  $('bLoad').onclick = () => { const p = $('loadp'); if (!p.classList.contains('hide')) return p.classList.add('hide');
    p.innerHTML = `<div class="slots">${slotsHTML('load', saves())}</div><div class="lrow"><button class="btn" data-m="file">Load from a file</button><span class="lerr"></span></div>`; p.classList.remove('hide'); };
  $('loadp').addEventListener('click', async e => { const b = e.target.closest('[data-m]'); if (!b) return; const v = b.dataset.m, err = $('loadp').querySelector('.lerr');
    if (v === 'file') { try { go(await SV.pickFile()); } catch (x) { err.textContent = x.message || 'That file could not be loaded'; } return; }
    const d = SV.readSlot(v.split(':')[1]); if (d) go(d); else err.textContent = 'That save could not be read'; });
  $('again').onclick = () => { $('over').classList.add('hide'); $('menu').classList.remove('hide'); S.gameState = 'menu'; setLowRes(true); attract(); };
  setLowRes(true); attract();
  requestAnimationFrame(frame);
}
// the menu's attract battle: on a GPU too slow to draw it smoothly (a software renderer), it is drawn every second
// and a half instead, so the menu itself stays responsive
const MR = { next: 0, after: false, cost: 0 };
function frame(now) {
  const raw = now - last, dt = Math.min(.1, raw / 1000); last = now;
  if (MR.after) { MR.cost = raw; MR.after = false; }
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { S.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  try {
    if (S.gameState === 'ground') { groundFrame(dt); requestAnimationFrame(frame); return; } // the ground war draws itself (groundview.js)
    if (S.gameState === 'play' && !S.paused) { acc += dt * S.speed; let n = 0; const cap = S.mode === 'battle' ? (S.stepCap || 16) : 10; const st = S.mode === 'battle' && S.ffStep || STEP, t0 = performance.now(); while (acc >= st && n < cap) { update(st); acc -= st; n++; if (S.ffStep && performance.now() - t0 > 11) { acc = 0; break; } } if (n >= cap) acc = 0; } // closing speed gets a time budget: the view stays smooth, the clock runs as fast as the machine allows
    if (S.gameState === 'play') { updUI(dt); if (S.mode === 'battle') battleTick(dt); }
    else if (S.gameState === 'strat') { stratFrame(dt); render(); requestAnimationFrame(frame); return; }
    else if (S.gameState === 'menu') { acc += dt; let n = 0; while (acc >= STEP && n < 4) { update(STEP); acc -= STEP; n++; } if (n >= 4) acc = 0; if (S.ships.length < 8 || S.time > 80) attract();
      camUpdate(dt); if (now >= MR.next) { render(); MR.after = true; MR.next = MR.cost > 120 ? now + 1500 : 0; } requestAnimationFrame(frame); return; }
    else if (S.gameState === 'over') { acc += dt * .5; let n = 0; while (acc >= STEP && n < 4) { update(STEP); acc -= STEP; n++; } }
    camUpdate(dt); render(); fitMini(); drawMini($('mini'), MMS);
  } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}
window.__IR = { S, update, newGame, fx: { explosion, nukeBlast } };
boot();
