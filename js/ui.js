import { onScr } from './cam.js';
import { S } from './state.js';
import { COLORS, DIFF, FACTIONS, TRAITS, RANKS, CMD_RANKS, SUBS, sigilSVG, BLOC_OF, counterHTML, counterText } from './data.js';
import { hyp, clamp, pct } from './util.js';
import { enqueue, cancelBuild, mainAmmo, nukesOf, disabled, countType, defOf, shMax, producersOf, rate, groupList, FORMATIONS, STANCES, HELMS, helmOf, worldMul, worldUnderAttack } from './sim.js';
import { selGroup, nextFreeGroup } from './commands.js';
import { buildIcon } from './render.js';
import { WORLD as WDEF, WORLDS, PROD_K } from './solar.js';
import { BODIES } from './data.js';
import { initAudio } from './audio.js';

const $ = id => document.getElementById(id);
export { $ };
const cache = new WeakMap();
function setHTML(el, h) { if (cache.get(el) === h) return false; cache.set(el, h); el.innerHTML = h; return true; }
function setText(el, t) { t = String(t); if (el.textContent !== t) el.textContent = t; }
export const onScreen = (x, y, m) => onScr(x, y, m);
// ---------------------------------------------------------------- options that last between sessions: auto-pause, the director
const OPT_KEY = 'ironrain.opts';
function loadOpts() {
  const d = { ap: { flagSh: false, nuke: true, board: true, rout: true }, director: false };
  try { const o = JSON.parse(localStorage.getItem(OPT_KEY) || '{}'); return { ...d, ...o, ap: { ...d.ap, ...(o.ap || {}) } }; } catch (e) { return d; }
}
export const OPTS = loadOpts();
export function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(OPTS)); } catch (e) { /* private mode: they last the session */ } }
export const AP_LIST = [['flagSh', 'Flagship shields down', 'A flagship or commander’s ship of ours loses her shields'], ['nuke', 'Enemy nuke launched', 'The enemy fires a nuclear missile'], ['board', 'Boarders aboard', 'Enemy boarders get aboard one of our ships'], ['rout', 'A group breaking', 'A ship of one of our battle groups breaks and runs']];
const AP_TEXT = { flagSh: s => `the ${s.title || s.def.name}'s shields are down`, nuke: () => 'nuclear launch detected', board: s => `boarders are aboard the ${s.title || s.def.name}`, rout: s => `${s.group ? s.group.name : 'one of our groups'} is breaking` };
const apT = {};
// the sim calls this when something happens that a player might want to stop the clock for
S.alert = (k, s) => {
  if (!OPTS.ap[k] || S.gameState !== 'play' || S.paused || S.mode !== 'battle') return;
  if (performance.now() - (apT[k] || -1e9) < 12000) return; apT[k] = performance.now();
  togglePause(); toast('Auto-paused: ' + AP_TEXT[k](s) + ' · P to resume', 'prompt', s, true);
};
export const speedTxt = v => v === .25 ? '¼×' : v === .5 ? '½×' : (Math.round(v * 100) / 100) + '×';
// Every message lands in the Dispatches log. Messages that carry a place (a ship or {x, y}) stay in the
// log, ping the minimap and can be clicked to jump there; only command feedback and critical alarms
// also flash in the middle of the screen.
// a line in the Dispatches with no toast on screen: the battle's own events land here
export function logLine(msg, cls, at) {
  if (S.gameState === 'menu') return;
  S.log = S.log || []; const pos = at ? { x: at.x, y: at.y, ref: at.def ? at : null } : null;
  const dup = S.log.find(e => e.base === msg && S.time - e.t < 10);
  if (dup) { dup.n = (dup.n || 1) + 1; dup.msg = msg + ' ×' + dup.n; dup.t = S.time; S.log.splice(S.log.indexOf(dup), 1); S.log.unshift(dup); }
  else { S.log.unshift({ t: S.time, msg, base: msg, cls: cls || '', at: pos }); if (S.log.length > 60) S.log.pop(); }
  forceUI();
}
// a voiced line on the open channel: it goes in the log with the speaker's chip, and shows as the live transmission
S.voice = v => {
  if (S.gameState === 'menu') return;
  S.log = S.log || []; const pos = v.at ? { x: v.at.x, y: v.at.y, ref: v.at.def ? v.at : null } : null;
  S.log.unshift({ t: S.time, msg: v.line, base: v.line, cls: 'voice' + (v.enemy ? ' icpt' : ''), at: pos, voice: v }); if (S.log.length > 60) S.log.pop();
  S.liveTx = { ...v, t: S.time }; forceUI();
};
export function toast(msg, cls, at, banner) {
  if (S.gameState === 'menu') return;
  const pos = at ? { x: at.x, y: at.y, ref: at.def ? at : null } : null;
  S.log = S.log || [];
  const prompt = cls === 'prompt'; // prompts flash on screen; they are not news
  const dup = !prompt && S.log.find(e => e.base === msg && S.time - e.t < 10);
  if (dup) { dup.n = (dup.n || 1) + 1; dup.msg = msg + ' ×' + dup.n; dup.t = S.time; S.log.splice(S.log.indexOf(dup), 1); S.log.unshift(dup); }
  else if (!prompt) { S.log.unshift({ t: S.time, msg, base: msg, cls: cls || '', at: pos }); if (S.log.length > 60) S.log.pop(); }
  if (pos && cls !== 'good') { S.pings = S.pings || []; S.pings.push({ x: pos.x, y: pos.y, t: S.time, col: cls === 'bad' ? '#ff4b3e' : '#e3c27a' }); }
  forceUI();
  if (pos && !banner && cls !== 'nuke') return;
  const el = document.createElement('div'); el.className = 'toast ' + (cls || ''); el.textContent = msg; $('toasts').appendChild(el);
  setTimeout(() => el.remove(), cls === 'nuke' || banner ? 6000 : 2600); while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}
export function jumpTo(e) { if (!e || !e.at) return; const r = e.at.ref && !e.at.ref.dead ? e.at.ref : e.at; S.cam.x = r.x; S.cam.y = r.y; if (S.cam.z < .02) S.cam.z = .06; }
export const builder = () => (S.builder && !S.builder.dead && S.builder.team === 0) ? S.builder : S.stations[0];

// ---------------------------------------------------------------- menu
export function buildMenu() {
  const mk = (id, side) => {
    const el = $(id); el.innerHTML = '';
    for (const k in FACTIONS) {
      const f = FACTIONS[k]; const b = document.createElement('button'); b.className = 'fac' + (S.choice[side] === k ? ' on' : ''); b.dataset.k = k; b.style.setProperty('--fc', f.col.main);
      b.innerHTML = side === 'player' ? `<div class="fsig">${sigilSVG(BLOC_OF[k], f.col.main, 44)}</div><b>${f.name}</b><span>${f.blurb}</span><ul>${f.perks.map(p => `<li>${p}</li>`).join('')}</ul>` : `<b>${f.name}</b><span>${f.blurb.split('. ')[0].replace(/\.$/, '')}.</span>`;
      b.onclick = () => { S.choice[side] = k; buildMenu(); };
      el.appendChild(b);
    }
  };
  mk('facP', 'player'); mk('facA', 'ai');
  const intro = document.querySelector('#menu .card.wide>p'); if (intro && !intro.onclick) intro.onclick = () => intro.classList.toggle('more');
}

// ---------------------------------------------------------------- build bar
const iconURL = {};
export const shipIcon = t => { const k = t + (S.fac ? S.fac[0] : ''); return iconURL[k] || (iconURL[k] = buildIcon(t, S.fac && S.fac[0]).toDataURL()); };
export function buildUI() {
  const root = document.documentElement.style; if (S.teamc[0]) { root.setProperty('--you', S.teamc[0].main); root.setProperty('--foe', S.teamc[1].main); }
  for (const k in iconURL) delete iconURL[k];
  const b = $('build'); b.innerHTML = '<div id="bhead"></div>';
  $('bhead').onclick = e => { if (e.target.closest('.qt')) return; S.buildPin = !S.buildPin; uiT = 0; };
  $('bhead').oncontextmenu = e => { const q = e.target.closest('.qt'); if (!q) return; e.preventDefault(); const p = builder(); if (p && p.queue[+q.dataset.i]) { cancelBuild(0, p, p.queue[+q.dataset.i].type); refreshBuild(); } };
  // the help sheet's build keys follow the faction you chose
  S.roster.forEach((row, i) => { const h = $('hkB' + (i + 1)); if (h) h.textContent = row.map(([t, key]) => key.toUpperCase() + ' ' + defOf(0, t).name + (defOf(0, t).squad ? ' (' + defOf(0, t).squad + ')' : '') + (defOf(0, t).limit ? ' (one per side)' : '')).join(' · '); });
  let tip = $('bbtip'); if (!tip) { tip = document.createElement('div'); tip.id = 'bbtip'; tip.className = 'panel hide'; document.body.appendChild(tip); }
  for (const row of S.roster) for (const [t, key] of row) {
    const d = defOf(0, t); const el = document.createElement('button'); el.className = 'bb'; el.dataset.t = t;
    el.appendChild(buildIcon(t, S.fac && S.fac[0]));
    const man = d.man >= 1000 ? (d.man / 1000).toFixed(d.man >= 10000 ? 0 : 1) + 'k' : d.man;
    el.insertAdjacentHTML('beforeend', `<span class="k">${key}</span><span class="q"></span><span class="n">${d.name}</span><span class="cst"><i class="he">He ${d.cost}</i><i class="or">Or ${d.ore}</i><i class="mn">Crew ${man}</i></span><span class="pg"></span>`);
    el.title = `${d.name}${d.squad ? ' ×' + d.squad : ''}: ${d.role}${counterText(t)}\nCost: ${d.cost} He-3 · ${d.ore} ore · ${d.man.toLocaleString()} crew from the manpower pool\nHull ${d.hp} · Shields ${d.shield} · Crew ${d.crew.toLocaleString()}${d.troops ? ' · ' + d.troops + ' troops' : ''}${d.hangar ? '\nHangar: ' + Object.entries(d.hangar).map(([k, v]) => v + ' ' + defOf(0, k).name).join(', ') : ''}${d.cmd ? '\nCan carry a commander' : ''}\nMass ${d.mass} · Thrust ${Math.round(d.thrust)} · Fuel ${d.burn}s of burn · Build ${d.time}s${d.limit ? ' · limit ' + d.limit : ''}\nRight-click to cancel one`;
    el.dataset.tip = el.title; el.removeAttribute('title');
    el.onmouseenter = () => { tip.textContent = el.dataset.tip; tip.classList.remove('hide'); const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect(); tip.style.left = Math.max(6, Math.min(S.W - tr.width - 6, r.left + r.width / 2 - tr.width / 2)) + 'px'; tip.style.top = Math.max(50, r.top - tr.height - 8) + 'px'; };
    el.onmouseleave = () => tip.classList.add('hide');
    el.onclick = () => { initAudio(); enqueue(0, t, builder()); refreshBuild(); };
    el.oncontextmenu = e => { e.preventDefault(); cancelBuild(0, builder(), t); refreshBuild(); };
    b.appendChild(el);
  }
}
function refreshBuild() {
  const p = builder(), b = $('build'); if (!p || !$('bhead')) return; const q = p.queue;
  // the bar opens with a producer selected (or pinned); otherwise it folds to one line. Hotkeys always work.
  const open = S.buildPin || S.selection.some(s => s.def.producer);
  if (b.classList.contains('mini') === open) b.classList.toggle('mini', !open);
  const n = producersOf(0).length, cur = q[0] ? defOf(0, q[0].type) : null;
  const eta = cur ? Math.max(0, Math.ceil((cur.time - q[0].t) / (p.buildMul || 1))) : 0;
  const thumbs = q.slice(0, 8).map((x, i) => `<span class="qt${i ? '' : ' first'}" data-i="${i}" title="${defOf(0, x.type).name} · right-click to cancel"${i ? '' : ` style="background:conic-gradient(rgba(201,162,94,.35) ${(x.t / defOf(0, x.type).time * 360).toFixed(0)}deg, rgba(255,255,255,.04) 0)"`}><img src="${shipIcon(x.type)}"></span>`).join('');
  setHTML($('bhead'), `<span>Production · <b>${p.def.name}</b>${p.world ? ' · ' + p.world.toUpperCase() : ''}</span>${q.length ? `<span class="bq">${thumbs}</span><span class="eta">${eta}s</span>` : '<span>· idle</span>'}${n > 1 && open ? '<span title="Select a Dockyard to build there instead">· +' + (n - 1) + ' yard' + (n > 2 ? 's' : '') + '</span>' : ''}<span class="pin">${open ? (S.buildPin ? 'pinned ▾' : '▾') : 'click to open ▴'}</span>`);
  if (!open) return;
  for (const el of b.querySelectorAll('.bb')) {
    const t = el.dataset.t, d = defOf(0, t); const k = q.filter(x => x.type === t).length;
    const lock = !!(d.limit && countType(0, t) >= d.limit) || (t === 'moonbreaker' && S.worlds && p.world !== 'venus');
    const lh = S.res[0] < d.cost, lo = S.ore[0] < d.ore, lm = S.man[0] < d.man, no = !lock && (lh || lo || lm);
    if (el.classList.contains('no') !== no) el.classList.toggle('no', no);
    if (el.classList.contains('lock') !== lock) el.classList.toggle('lock', lock);
    const c = el.querySelectorAll('.cst i'); c[0].classList.toggle('lack', lh); c[1].classList.toggle('lack', lo); c[2].classList.toggle('lack', lm);
    setText(el.querySelector('.q'), k ? '×' + k : '');
    const w = q[0] && q[0].type === t ? (q[0].t / d.time * 100).toFixed(1) + '%' : '0px'; const pg = el.querySelector('.pg'); if (pg.style.width !== w) pg.style.width = w;
  }
}

// ---------------------------------------------------------------- selection panel
function bar(cls, f, color) { return `<div class="bar ${cls}"><i style="width:${pct(f)}%${color ? ';background:' + color : ''}"></i></div>`; }
function crewHTML(s) {
  const d = s.def;
  if (d.crew <= 2) return d.boarder ? `<div class="row">${d.shell ? 'Trooper' : 'Obsidian troops'}<b>${Math.ceil(s.troops)} / ${d.troops}</b></div>${bar('cap', s.troops / d.troops)}` : `<div class="row">Pilot<b style="color:#5aa9ff">Blue</b></div>`;
  const mar = Math.max(0, s.marines), rest = Math.max(0, s.crew - mar);
  const segs = COLORS.map(([n, c, f]) => [n, c, rest * f]); segs.splice(3, 0, ['Gray marines', '#9aa0a6', mar]);
  let h = `<div class="row">Crew<b>${Math.round(s.crew).toLocaleString()} / ${d.crew.toLocaleString()}</b></div><div class="bar">${segs.map(([n, c, v]) => `<i style="width:${v / d.crew * 100}%;background:${c}"></i>`).join('')}</div>
    <div class="legend">${segs.map(([n, c, v]) => `<span style="--c:${c}">${n} ${Math.round(v).toLocaleString()}</span>`).join('')}</div>`;
  if (s.team !== 2 && !d.static) h += `<div class="row">Loyalty<b style="color:${s.loy < .25 ? '#ff4b3e' : s.loy < .5 ? '#ff9a3c' : ''}">${pct(s.loy)}%</b></div>${bar('loy', s.loy)}`;
  return h;
}
function ammoHTML(s) {
  if (!s.weapons.length) return ''; const g = {};
  for (const w of s.weapons) { const k = w.def.name; if (!g[k]) g[k] = { a: 0, m: 0, u: w.def.unit, guns: 0 }; g[k].a += w.ammo; g[k].m += w.mag; g[k].guns += w.guns; }
  let h = '<div class="sec">Munitions</div>';
  const inf = s.def.static && s.team < 2;
  for (const k in g) { const v = g[k], f = v.a / v.m; h += `<div class="row">${k}${v.guns > 1 ? ` (${v.guns})` : ''}<b style="color:${f <= 0 ? '#ff4b3e' : f < .25 ? '#ff9a3c' : ''}">${inf && !k.startsWith('Nuc') ? '∞' : Math.floor(v.a) + ' / ' + v.m + ' ' + v.u}</b></div>`; }
  return h;
}
const chainLen = o => { let n = 0; while (o.next && n < 9) { o = o.next; n++; } return n + ' queued'; };
// the helm: which side the broadside ships turn to the enemy (for a group, all of its broadside ships)
function helmHTML(g, sel) { const k = g ? g.helm || 'auto' : (sel.length && sel.every(s => helmOf(s) === helmOf(sel[0])) ? helmOf(sel[0]) : null);
  return `<div class="sec">Helm${g ? ' · ' + g.name : ''}</div><div class="chips">${HELMS.map(([v, n, d]) => `<span class="chip${k === v ? ' on' : ''}" data-helm="${v}" title="${d}">${n}</span>`).join('')}</div>`; }
function subsHTML(s) {
  if (!s.sub) return '';
  return `<div class="sec">Subsystems</div><div class="subs">${SUBS.map(([k, n]) => { const v = s.sub[k]; return `<span class="sub ${v <= 0 ? 'dead' : v < .5 ? 'hurt' : ''}">${n}<i>${v <= 0 ? 'OUT' : pct(v) + '%'}</i></span>`; }).join('')}</div>`;
}
function aimHTML(s) {
  const k = s.aimSub || '';
  return `<div class="sec">Fire control</div><div class="chips">${[['', 'At will'], ['eng', 'Engines'], ['bridge', 'Bridge'], ['guns', 'Weapons'], ['shld', 'Shields']].map(([v, n]) => `<span class="chip${k === v ? ' on' : ''}" data-aim="${v}">${n}</span>`).join('')}</div>`;
}
function cmdrHTML(s) {
  if (!s.def.cmd || s.team !== 0) return s.cmdr ? `<div class="sec">Commander</div><div class="cmd"><b>${s.cmdr.name}</b> · ${s.cmdr.caste}<br><span>${s.cmdr.traits.map(t => TRAITS[t].name).join(' · ')}</span></div>` : '';
  if (s.cmdr) { const c = s.cmdr; return `<div class="sec">Commander</div><div class="cmd"><b>★ ${c.name}</b> · ${CMD_RANKS[c.rank]}<br><span>${c.caste} · ${c.title}</span><br>${c.traits.map(t => `<span class="tr" title="${TRAITS[t].desc}">${TRAITS[t].name}</span>`).join('')}<br><span>Renown ${Math.round(c.renown)} · kills ${c.kills}</span></div>${s.depot ? `<span class="chip" data-cact="recall" data-cid="${c.id}">Land commander</span>` : ''}`; }
  if (S.mode === 'battle') return '';
  const ready = S.cmdrs.filter(c => c.team === 0 && c.state === 'ready');
  if (!ready.length) return `<div class="sec">Commander</div><div class="hint">No commander available.</div>`;
  if (!s.depot) return `<div class="sec">Commander</div><div class="hint">Bring her to a friendly depot to take one of your ${ready.length} available commanders aboard.</div>`;
  return `<div class="sec">Assign a commander</div><div class="chips">${ready.map(c => `<span class="chip" data-cact="assign" data-cid="${c.id}" title="${c.traits.map(t => TRAITS[t].name + ': ' + TRAITS[t].desc).join('\n')}">★ ${c.name}</span>`).join('')}</div>`;
}
let uiT = 0;
// ---------------------------------------------------------------- world strip and dispatches
export function worldJump(id, select) {
  const b = BODIES.find(x => x.id === id); if (!b) return; S.cam.x = b.x; S.cam.y = b.y; S.cam.z = b.kind === 'moon' ? .15 : .06;
  const w = S.worlds && S.worlds[id];
  if (select && w && w.gov && !w.gov.dead) { if (w.gov.team === 0) { S.selection = [w.gov]; S.builder = w.gov.def.producer ? w.gov : S.builder; } else { S.selection = []; S.inspect = w.gov; } S.worldSel = null; }
  else if (!select) { S.selection = []; S.inspect = null; S.worldSel = id; }
  uiT = 0;
}
// who holds a world, in words and in colour
export const ownerName = o => o === 0 ? 'Yours' : o === 1 ? FACTIONS[S.fac[1]].name : o === -2 ? 'Neutral garrison' : 'Unheld';
export const ownerCol = o => o >= 0 ? S.teamc[o].main : o === -2 ? S.teamc[2].main : '#5a5650';
function worldStrip() {
  const el = $('wstrip'); if (!S.worlds) { setHTML(el, ''); return; }
  // your worlds, plus any of theirs or the neutrals' that is under attack right now
  setHTML(el, WORLDS.filter(w => S.worlds[w.id].owner === 0 || worldUnderAttack(w.id)).map(w => { const b = BODIES.find(x => x.id === w.id), o = S.worlds[w.id].owner, oc = ownerCol(o);
    const att = worldUnderAttack(w.id) || (S.worlds[w.id].gov.boardProg > 0);
    return `<button class="wp${b.kind === 'moon' ? ' moon' : ''}${att ? ' att' : ''}" data-world="${w.id}" style="--oc:${oc};--c0:${b.pal.c[0]};--c1:${b.pal.c[1]};--c2:${b.pal.c[2]}" title="${b.name} · ${ownerName(o)}${att ? ' · UNDER ATTACK' : ''}"></button>`; }).join(''));
}
let logOpen = false;
export function toggleLog() { logOpen = !logOpen; $('log').classList.toggle('open', logOpen); uiT = 0; }
function updLog() {
  const L0 = S.log || [], L = S.mode === 'battle' && !logOpen ? L0.filter(e => e.voice || /bad|gold|nuke/.test(e.cls)) : L0, n = logOpen ? 40 : S.mode === 'battle' ? 2 : 5, f = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  setHTML($('log'), `<h4 data-log="toggle">${S.mode === 'battle' ? 'Comms' : 'Dispatches'} <span>${L.length ? (logOpen ? '▴ fewer' : L.length + ' ▾') : ''}</span></h4>` + (L.length ? L.slice(0, n).map((e, i) => e.voice ? voiceRow(e, i, f) : `<div class="lg ${e.cls}${e.at ? ' at' : ''}${S.time - e.t > 12 ? ' old' : ''}" ${e.at ? `data-log="${i}"` : ''}><i>${f(e.t)}</i><span>${esc(e.msg)}</span></div>`).join('') : '<div class="hint">Reports from across the Core land here. Click one with ⌖ to jump to it. Backspace jumps to the latest.</div>'));
}
// a line from a person: the Color chip, the name and the ship, then what was said
const voiceRow = (e, i, f) => { const v = e.voice;
  return `<div class="lg vc ${e.cls}${e.at ? ' at' : ''}${S.time - e.t > 12 ? ' old' : ''}${S.time - e.t < 5 && i < 2 ? ' live' : ''}" ${e.at ? `data-log="${i}"` : ''} style="--cc:${v.col}"><b class="vchip" title="${v.sp.caste}">${v.sig}</b><div class="vbody"><div class="vwho">${v.enemy ? '<em>Intercept</em> ' : ''}${esc(v.sp.name)}<span>${esc(v.sp.ship || '')}</span></div><span>${esc(e.msg)}</span></div></div>`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function lastAlert() { const e = (S.log || []).find(x => x.at); if (e) jumpTo(e); }

// what a world pays and what holding it means
function worldPanel(id, full) {
  const W = WDEF[id], b = BODIES.find(x => x.id === id);
  if (!W) return `<h3>${b ? b.name : id}</h3><div class="role">${b && b.kind === 'star' ? 'The Sun · drawn to true scale with the orbits' : ''}</div><div class="hint">Nothing here can be held.</div>`;
  const st = S.worlds && S.worlds[id], own = st ? st.owner : -1, ownName = ownerName(own);
  const g = st && st.gov, as = own >= 0 ? own : 0, mul = worldMul(id, as);
  const per = k => { const v = W.prod[k] * PROD_K * mul * 60; return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v); };
  if (!full) return `<div class="sec">The world it holds</div><div class="row"><span>${b.name}</span><b>+${per('he')} He-3 · +${per('man')} crew /m</b></div><div class="chips"><span class="chip" data-wview="${id}">World details ›</span></div>`;
  let h = full ? `<h3>${b.name}</h3><div class="role"><span class="tag" style="color:${ownerCol(own)};border-color:${ownerCol(own)}">${ownName}</span> ${b.kind === 'moon' ? 'Moon of ' + BODIES[b.parent].name : b.gas ? 'Gas giant' : b.dwarf ? 'Dwarf planet' : 'Planet'} · ${W.region}</div><p class="lore">${W.lore}</p>` : `<div class="sec">${b.name} · the world this holds</div>`;
  if (full) {
    const chips = [];
    if (worldUnderAttack(id)) chips.push('<span class="tag bad">⚔ Under attack</span>');
    if (g && g.boardProg > 0) chips.push(`<span class="tag bad">Boarders aboard ${Math.round(g.boardProg * 100)}%</span>`);
    if (g && g.def.shield) chips.push(`<span class="tag blue">Shields ${Math.round(g.sh / g.def.shield * 100)}%</span>`);
    if (S.halt && S.halt[id] > S.time) chips.push(`<span class="tag bad">⚠ Output halted ${Math.ceil(S.halt[id] - S.time)}s</span>`);
    if (id === 'titan' && S.halt && S.halt.titanFood > S.time) chips.push('<span class="tag bad">⚠ Harvest failed</span>');
    if (own >= 0 && S.food && S.food[own] < 0) chips.push('<span class="tag bad">⚠ Famine</span>');
    if (mul < 1 && mul > 0) chips.push(`<span class="tag dim">Pays ${Math.round(mul * 100)}%${own < 0 ? ' if taken' : ''}</span>`);
    if (chips.length) h += `<div>${chips.join('')}</div>`;
    h += `<div class="chips" style="margin:6px 0"><span class="chip" data-wjump="${id}">⌖ Jump</span>${g ? `<span class="chip" data-wsel="${id}">Select ${g.def.name}</span>` : ''}</div>`;
  }
  if (full && g) h += `<div class="row"><span>Held through</span><b>${g.def.name}</b></div><div class="row"><span>Its marines</span><b>${Math.round(g.marines).toLocaleString()}${W.ground > 1 && g.type !== 'station' ? ' (×' + W.ground + ' garrison)' : ''}</b></div>`;
  h += `<div class="outs" title="What this world pays ${own === 0 ? 'you' : own === 1 ? 'its holder' : 'whoever takes it'} per minute, after its downsides">${[['he', 'He-3'], ['ore', 'Ore'], ['ord', 'Ord'], ['man', 'Crew']].map(([k, n]) => `<span><i>${n}/m</i>+${per(k)}</span>`).join('')}<span class="${W.prod.food < 0 ? 'neg' : ''}"><i>Food</i>${W.prod.food > 0 ? '+' : ''}${W.prod.food}</span></div>`;
  h += `<div class="sec">Benefits of holding it</div>` + W.pros.map(p => `<div class="pro"><b>${p[0]}</b> ${p[1]}</div>`).join('');
  h += `<div class="sec">Downsides</div>` + W.cons.map(p => `<div class="con"><b>${p[0]}</b> ${p[1]}</div>`).join('');
  if (full) h += `<div class="hint" style="margin-top:8px">A world belongs to whoever holds its ${g ? g.def.name : 'orbital authority'}. It cannot be destroyed: break its shields, thin its marines and board it.</div>`;
  return h;
}
export function updUI(dt) {
  uiT -= dt; if (uiT > 0) return; uiT = .15;
  const k = v => v >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.floor(v).toLocaleString();
  setText($('res'), k(S.res[0])); setText($('ore'), k(S.ore[0])); setText($('ord'), k(S.ord[0])); setText($('man'), k(S.man[0]));
  // income per minute: everything the economy is paying in, before spending
  const rr = (id, v) => { const el = $(id), t = (v > 0 ? '+' : v < 0 ? '−' : '') + k(Math.abs(v)) + '/m'; setText(el, t); const c = v > 0 ? 'pos' : v < 0 ? 'neg' : ''; if (el.className !== c) el.className = c; };
  rr('resR', rate('he')); rr('oreR', rate('ore')); rr('ordR', rate('ord')); rr('manR', rate('man'));
  // warnings: can't afford the cheapest warship, can't restock a nuke, can't crew the biggest hull in the queue
  const war = (S.roster[1] || []).map(([t]) => defOf(0, t)), cheapHe = Math.min(...war.map(d => d.cost)), cheapOre = Math.min(...war.map(d => d.ore));
  const bigQ = Math.max(0, ...producersOf(0).flatMap(p => p.queue.map(x => defOf(0, x.type).man)));
  const flag = (id, crit, warn) => { const el = $(id); el.classList.toggle('crit', !!crit); el.classList.toggle('warn', !crit && !!warn); };
  flag('cHe', S.res[0] < 1, S.res[0] < cheapHe); flag('cOre', S.ore[0] < 1, S.ore[0] < cheapOre); flag('cOrd', S.ord[0] < 1, S.ord[0] < 200); flag('cMan', S.man[0] < 1, bigQ && S.man[0] < bigQ);
  if (S.food) flag('cFood', S.food[0] < 0, false);
  worldStrip(); updLog();
  const mine = S.ships.filter(s => s.team === 0 && !s.def.static);
  setText($('fleet'), mine.length);
  if (S.worlds) { const f = S.food ? S.food[0] : 0; setText($('food'), (f > 0 ? '+' : '') + f); $('food').style.color = f < 0 ? '#ff8a7a' : '#b6f5a0'; setText($('foodR'), f < 0 ? 'famine' : 'balance'); }
  setText($('crew'), Math.round(mine.reduce((a, s) => a + s.crew + (s.troops || 0), 0)).toLocaleString());
  setText($('clock'), Math.floor(S.time / 60) + ':' + String(Math.floor(S.time % 60)).padStart(2, '0'));
  refreshBuild(); updCmdPanel(); updGrpPanel();
  const p = $('selp'); { const lg = $('log'), r = lg && lg.getBoundingClientRect(); if (r && r.height) p.style.maxHeight = Math.max(160, innerHeight - r.bottom - 22) + 'px'; }
  const sel = S.selection.length ? S.selection : (S.inspect && !S.inspect.dead && S.inspect.seen ? [S.inspect] : []);
  if (!sel.length && S.worldSel) { setHTML(p, worldPanel(S.worldSel, true)); return; }
  if (!sel.length && S.mode === 'battle') { setHTML(p, fleetCard()); return; }
  if (!sel.length) { setHTML(p, `<h3>Fleet Command</h3><div class="role">${FACTIONS[S.fac[0]].name} · nothing selected</div><div class="hint tips${S.tipsOpen ? ' open' : ''}" data-tips><b>Drag</b> to select, <b>right-click</b> to order. <b>Click a world</b> to see what holding it gives you. <span style="color:var(--gold)">${S.tipsOpen ? 'Fewer tips ▴' : 'More tips ▾'}</span><div class="more"><b>E</b> selects the citadel, <b>Q</b> every warship. <b>Space</b> centres on the selection.<br><b>R</b> sends ships to the nearest depot to rearm, refuel and re-crew.<br>Grey structures are neutral: shoot their shields down and board them to claim them.<br>Haulers can strip derelict hulks for He-3 (right-click the hulk).<br>Battered, disloyal crews surrender. Bring a warship alongside to take her.<br><b>H</b> lists every control.</div></div>`); return; }
  if (S.mode === 'battle' && sel.length === 1 && sel[0].team === 0 && !sel[0].ally && !sel[0].def.static) { setHTML(p, ownCard(sel[0])); return; }
  if (S.mode === 'battle' && sel.length > 1 && sel.every(s => s.team === 0 && !s.ally)) { setHTML(p, ownMulti(sel)); return; }
  if (sel.length === 1) {
    const s = sel[0], d = s.def; const sp = hyp(s.vx, s.vy); const tn = s.order.t ? s.order.t.def.name : '';
    const ord = { idle: 'Holding station', move: 'Burning to waypoint', amove: 'Attack-move', attack: 'Engaging ' + tn, board: (s.waiting ? 'Waiting for shields to drop: ' : 'Boarding ') + tn, mine: 'Mining · ' + (s.order.phase || ''), salvage: 'Salvaging ' + tn, brake: 'Full stop burn', follow: 'Escorting ' + tn, guard: 'Flying CAP over ' + tn, dock: 'Returning to ' + tn, rearm: 'Returning to depot', line: 'Holding the line of battle', form: 'In formation' }[s.order.type] || '';
    let tags = '';
    if (s.team === 2) tags += `<span class="tag dim">${s.derelict ? 'Derelict hulk' : 'Neutral'}</span>`;
    if (s.surrendered) tags += '<span class="tag bad">Struck colors</span>';
    if (s.derelict && s.team !== 2) tags += '<span class="tag bad">Derelict</span>';
    if (s.emp > 0) tags += `<span class="tag blue">EMP ${s.emp.toFixed(1)}s</span>`;
    if (s.atBase) tags += `<span class="tag ok">${s.depot.def.fullService ? 'Full service' : 'Depot service'}</span>`;
    if (s.resupplying) tags += '<span class="tag ok">Resupplying fleet</span>';
    if (s.shAura) tags += '<span class="tag blue">Shield aura</span>';
    if (s.inspired) tags += '<span class="tag ok">Inspired</span>';
    if (s.rank) tags += `<span class="tag gold">${'▲'.repeat(s.rank)} ${RANKS[s.rank]}</span>`;
    if (!d.static) tags += `<span class="tag dim">Signature ${s.sig < .55 ? 'low' : s.sig < .85 ? 'medium' : 'high'}</span>`;
    const mx = shMax(s);
    const tteam = s.ally ? 'Allied · ' + (s.allyName || '') : s.team === 0 ? 'Yours' : s.team === 2 ? 'Neutral' : 'Enemy · ' + FACTIONS[S.fac[s.team]].name;
    let h = `<h3>${s.title || d.name}<span class="tteam" style="color:${S.teamc[s.team].light || S.teamc[s.team].main}">${tteam}</span></h3><div class="role">${s.title ? d.name + ' · ' : ''}${d.role}</div>${counterHTML(s.type)}${tags ? '<div>' + tags + '</div>' : ''}
      <div class="row">Hull<b>${Math.ceil(s.hp).toLocaleString()} / ${d.hp.toLocaleString()}</b></div>${bar('', s.hp / d.hp)}`;
    if (d.shield && s.sub) { const hc = mx / 2 || 1, br = s.braceT > S.time ? (s.braceSide > 0 ? ' · braced starboard' : ' · braced port') : '';
      h += `<div class="row">Shields${br}<b>${mx <= 0 ? 'GENERATOR OUT' : s.sh <= 0 && S.time - s.shDown < 15 ? 'OVERLOADED' : Math.ceil(s.sh).toLocaleString() + ' / ' + Math.round(mx).toLocaleString()}</b></div><div class="halves"><span>Port</span>${bar('sh', s.shP / hc)}${bar('sh', s.shS / hc)}<span>Stbd</span></div>`; }
    else if (d.shield) h += `<div class="row">Shields<b>${mx <= 0 ? 'GENERATOR OUT' : s.sh <= 0 && S.time - s.shDown < 8 ? 'OVERLOADED' : Math.ceil(s.sh).toLocaleString() + ' / ' + Math.round(mx).toLocaleString()}</b></div>${bar('sh', s.sh / d.shield)}`;
    if (!d.static) h += `<div class="row">He-3 fuel<b style="color:${s.fuel <= 0 ? '#ff4b3e' : s.fuel < .2 ? '#ff9a3c' : ''}">${s.fuel <= 0 ? 'DRY · drifting' : pct(s.fuel) + '%'}</b></div>${bar('fuel', s.fuel)}`;
    if (s.boardProg > 0) h += `<div class="row">Boarding action<b>${s.marines > 0 ? Math.ceil(s.marines).toLocaleString() + ' marines holding' : 'falling'}</b></div>${bar('cap', s.boardProg)}` + (s.team !== 0 && s.boardTeam === 0 && s.def.cmd ? aimRow(s, s.boardAim || '') : '');
    if (s.salvage != null || (s.derelict && s.team === 2)) h += `<div class="row">Salvage value<b>${Math.round(s.salvage ?? (d.value || 300) * .6)} (70% ore)</b></div>`;
    // what you act on first: orders, fire control, the battle group; the readouts after
    if (s.ally) h += `<div class="hint">An allied hull of ${s.allyName || 'an ally'}: the battle AI fights her, and she takes no orders from you.</div>`;
    if (s.team === 0 && !d.static) h += `<div class="row">Orders<b>${s.docked ? 'Fighting deck by deck' : s.pend ? 'Signal on its way · ' + Math.max(0, s.pend.at - S.time).toFixed(1) + 's' : s.freezeT > S.time ? 'Waiting for orders' : ord}${s.order.next ? ' +' + chainLen(s.order) : ''}</b></div>`;
    if (s.team === 0 && !s.ally && !d.static && d.broadside) h += helmHTML(s.group && !s.detached ? s.group : null, [s]);
    if (s.team === 0 && !s.ally && !d.static && s.weapons.length && !d.fighter && !d.shell) h += aimHTML(s);
    if (s.team === 0 && !s.ally && s.sub && d.shield && !d.static) h += `<div class="chips"><span class="chip${s.braceT > S.time ? ' on' : ''}" data-brace="1" title="Throw shield power to the side the threat is on for 8 seconds: that half holds 150%, the other 50%">Brace shields</span></div>`;
    if (s.team === 0 && !s.ally && !d.static) h += s.group ? `<div class="sec">Battle group</div><div class="row">${s.group.name} (${s.group.n})<b>${s.group.flag === s ? '⚑ Flagship' : s.detached ? 'Detached' : 'In formation'}</b></div>${s.detached ? `<div class="chips"><span class="chip" data-greg="${s.group.n}">Regroup</span></div>` : ''}` : groupControls(null, sel);
    h += '<div class="sec">Crew</div>' + crewHTML(s) + cmdrHTML(s) + subsHTML(s);
    if (d.supply) h += `<div class="row">Supply stores<b>${Math.floor(s.supply)} / ${d.supply}</b></div>${bar('am', s.supply / d.supply)}`;
    if (s.h) { const hd = d.hangar; const out = S.ships.filter(f => f.carrier === s && !f.dead).length; h += `<div class="sec">Hangar · spitTubes</div>${hd.ripwing ? `<div class="row">ripWings docked<b>${s.h.ripwing} / ${hd.ripwing}</b></div>` : ''}${hd.starshell ? `<div class="row">starShells docked<b>${s.h.starshell} / ${hd.starshell}</b></div>` : ''}${hd.boarder ? `<div class="row">Assault pods in the tubes<b>${s.h.boarder} / ${hd.boarder}</b></div>` : ''}<div class="row">Craft out<b>${out}</b></div><div class="row">Mode<b>${s.hmode === 'hold' ? 'Hold (L)' : 'Auto-launch (L)'}</b></div>`; }
    h += ammoHTML(s);
    if (!d.static) h += `<div class="sec">Flight</div><div class="row">Velocity<b>${sp.toFixed(0)} km/s</b></div><div class="row">Mass · thrust<b>${d.mass} kt · ${Math.round(d.thrust * (s.hf ?? 1))}/${Math.round(d.thrust)} g</b></div>`;
    if (s.type === 'hauler') h += `<div class="row">Cargo<b>${Math.floor(s.cargo)} / ${d.cargo} ${s.cargoKind === 'ore' ? 'ore' : s.cargoKind === 'salvage' ? 'salvage' : 'He-3'}</b></div>`;
    if (s.short && s.atBase) h += `<div class="hint" style="color:#ff9a3c">Service stalled: not enough ${{ ore: 'ore for hull repairs', ord: 'ordnance to rearm', man: 'manpower to replace crew' }[s.short]}.</div>`;
    if (d.static && s.team === 0) h += `<div class="hint">${d.producer ? 'Builds ships (the build bar now builds here). Right-click sets the rally point. ' : ''}Ships within ${d.service || 0} km are ${d.fullService ? 'rearmed, refuelled, re-crewed and repaired' : 'rearmed, refuelled and repaired'}.${d.prod ? ` Produces ${Math.round(d.prod.he * 60)} He-3, ${Math.round(d.prod.ord * 60)} ordnance and ${Math.round((d.prod.man === 'recruit' ? FACTIONS[S.fac[0]].recruit : d.prod.man * FACTIONS[S.fac[0]].liberate) * 60).toLocaleString()} recruits a minute.` : ''}${d.aura ? ' Friendly shields within ' + d.aura + ' km recharge three times faster.' : ''}</div>`;
    if (d.static && s.team === 2) h += `<div class="hint">${s.marines < 5 ? 'Abandoned: any boarder can claim it.' : 'Garrisoned. Bring its shields under 25%, then board it.'} Neutral defenses only fire at ships that come within 650 km or that have attacked a neutral in the last 30 s.</div>`;
    if (s.world) h += worldPanel(s.world, false);
    setHTML(p, h); p.classList.toggle('scrolls', p.scrollHeight > p.clientHeight + 4 && p.scrollTop + p.clientHeight < p.scrollHeight - 4); return;
  }
  const counts = {}; for (const s of sel) counts[s.type] = (counts[s.type] || 0) + 1;
  const g = selGroup();
  const sum = f => sel.reduce((a, s) => a + f(s), 0);
  const hp = sum(s => s.hp) / sum(s => s.def.hp), shm = sum(s => s.def.shield), sh = shm ? sum(s => s.sh) / shm : 0, cm = sum(s => s.def.crew > 2 ? s.def.crew : 0), cr = cm ? sum(s => s.def.crew > 2 ? s.crew : 0) / cm : 1;
  const mob = sel.filter(s => !s.def.static); const fu = mob.length ? mob.reduce((a, s) => a + s.fuel, 0) / mob.length : 1;
  const armed = sel.filter(s => s.weapons.length && !s.def.static); const am = armed.length ? armed.reduce((a, s) => a + mainAmmo(s), 0) / armed.length : 1;
  const nukes = sum(s => nukesOf(s).reduce((a, w) => a + Math.floor(w.ammo), 0));
  const aims = new Set(armed.map(s => s.aimSub || '')); const aimK = aims.size === 1 ? [...aims][0] : null;
  setHTML(p, `<h3>${sel.length} ships selected</h3><div class="role">Fleet value ${sum(s => s.def.value || 0).toLocaleString()}${nukes ? ' · ☢ ' + nukes + ' nukes ready' : ''}</div>
    <div class="row">Hull integrity<b>${pct(hp)}%</b></div>${bar('', hp)}
    ${shm ? `<div class="row">Shields<b>${pct(sh)}%</b></div>${bar('sh', sh)}` : ''}
    <div class="row">Crew strength<b>${pct(cr)}%</b></div>${bar('', cr, '#5aa9ff')}
    <div class="row">He-3 fuel<b>${pct(fu)}%</b></div>${bar('fuel', fu)}
    ${armed.length ? `<div class="row">Munitions<b>${pct(am)}%</b></div>${bar('am', am)}` : ''}
    <div class="chips">${Object.entries(counts).map(([t, n]) => `<span class="chip" data-t="${t}">${defOf(0, t).name} ×${n}</span>`).join('')}</div>
    ${groupControls(g, sel)}
    ${sel.some(s => s.def.broadside && s.team === 0) ? helmHTML(g, sel.filter(s => s.def.broadside)) : ''}
    ${sel.some(s => s.team === 0 && s.sub && s.def.shield) ? `<div class="chips"><span class="chip" data-brace="1" title="Each ship throws her shield power to the side the threat is on, for 8 seconds">Brace shields</span></div>` : ''}
    ${armed.length ? `<div class="sec">Fire control</div><div class="chips">${[['', 'At will'], ['eng', 'Engines'], ['bridge', 'Bridge'], ['guns', 'Weapons'], ['shld', 'Shields']].map(([v, n]) => `<span class="chip${aimK === v ? ' on' : ''}" data-aim="${v}">${n}</span>`).join('')}</div>` : ''}`);
}

// ---------------------------------------------------------------- the command panel (your own ships, in battle)
// A unit card in the Total War manner: who she is, a compact readout of what matters in the fight, then the few
// decisions the panel owns (what to aim at, formation, stance). Abilities and the helm live on the order card below;
// everything else is folded away under Details
const M = (label, f, txt, cls, col) => `<div class="mt ${cls || ''}"><span>${label}</span><b${col ? ` style="color:${col}"` : ''}>${txt}</b><i><u style="width:${pct(Math.max(0, Math.min(1, f)))}%"></u></i></div>`;
const warnCol = f => f <= 0 ? '#ff4b3e' : f < .25 ? '#ff9a3c' : '';
const seg = (label, items, cur, attr, tipOf) => `<div class="seg"><span class="sl">${label}</span><div class="sb">${items.map(([v, n, d]) => `<button class="sgb${cur === v ? ' on' : ''}" data-${attr}="${v}"${d || tipOf ? ` title="${esc2(d || (tipOf && tipOf(v)) || '')}"` : ''}>${n}</button>`).join('')}</div></div>`;
const esc2 = t => String(t).replace(/"/g, '&quot;');
const AIMS = [['', 'At will', 'Each gun picks its own target'], ['eng', 'Engines', 'Aim for the drive: slow her, and from astern, no plate'], ['bridge', 'Bridge', 'Aim for the bridge: her command falters'], ['guns', 'Guns', 'Aim for her weapons'], ['shld', 'Shields', 'Aim for her shield generators']];
function orderText(s) { const tn = s.order.t ? (s.order.t.title || s.order.t.def.name) : '';
  return ({ idle: 'Holding station', move: 'Burning to waypoint', amove: 'Attack-move', attack: (s.order.stern ? 'Going for the stern of ' : 'Engaging ') + tn, board: (s.waiting ? 'Waiting for shields to drop: ' : 'Boarding ') + tn, mine: 'Mining', salvage: 'Salvaging ' + tn, brake: 'Full stop burn', follow: 'Escorting ' + tn, guard: 'Flying CAP over ' + tn, dock: 'Returning to ' + tn, rearm: 'Returning to depot', line: 'Holding the line of battle', form: 'In formation' }[s.order.type] || '') + (s.order.next ? ' · ' + chainLen(s.order) : ''); }
// nothing selected in battle: the fleet at a glance, and every boarding action on the decks
export const BAIM = { bridge: ['Bridge', 'Cut through to the bridge: the quickest capture, but the bridge is wrecked in the fighting'], engines: ['Engines', 'Blow her engines: she is dead in space whatever happens after; then they push on to take her'], whole: ['Whole', 'Take her deck by deck: slow and costly, but she comes over intact, crew and all, and it shakes her fleet more'] };
export const aimRow = (t, cur) => `<div class="seg baim"><span class="sl">Boarders</span><div class="sb"><button class="sgb${!cur ? ' on' : ''}" data-baim="" data-sid="${t ? t.id : ''}" title="Storm her wherever they get in: the default">Storm</button>${Object.entries(BAIM).filter(([k]) => k !== 'engines' || !(t && t.engWreck)).map(([k, [n, d]]) => `<button class="sgb${cur === k ? ' on' : ''}" data-baim="${k}" data-sid="${t ? t.id : ''}" title="${d}">${n}</button>`).join('')}</div></div>`;
function fleetCard() {
  const L = S.ships.filter(s => s.team === 0 && !s.dead && !s.offField && !s.def.static && !s.def.fighter && !s.def.shell && !s.ally), n = L.length || 1;
  const avg = f => L.reduce((a, s) => a + f(s), 0) / n, hull = avg(s => s.hp / s.def.hp), shd = avg(s => s.def.shield ? s.sh / s.def.shield : 1), ammo = avg(s => { const w = s.weapons.filter(x => !x.def.nuke && !x.def.pd); return w.length ? w.reduce((a, x) => a + x.ammo / x.mag, 0) / w.length : 1; }), fuel = avg(s => s.fuel ?? 1);
  const pods = S.ships.filter(s => s.team === 0 && !s.dead && s.h && s.h.boarder > 0).reduce((a, s) => a + s.h.boarder, 0), broke = L.filter(s => s.broken).length, gs = new Set(L.map(s => s.group).filter(Boolean)).size;
  const D = S.decksFn ? S.decksFn() : [];
  let h = `<div class="uhead"><div><h3>Fleet Command</h3><div class="role">${FACTIONS[S.fac[0]].name} · ${L.length} ships · ${gs} group${gs === 1 ? '' : 's'}${broke ? ` · <span style="color:#ff8a7a">${broke} running</span>` : ''}</div></div></div>`;
  h += `<div class="mts">${M('Hull', hull, pct(hull) + '%', '', hull < .4 ? '#ff8a7a' : '')}${M('Shields', shd, pct(shd) + '%', 'sh')}${M('Munitions', ammo, pct(ammo) + '%', 'am', ammo < .25 ? '#ff9a3c' : '')}${M('Fuel', fuel, pct(fuel) + '%', 'fu')}</div>`;
  { const sum = k => S.ships.filter(s => s.team === 0 && !s.dead && s.h && s.h[k] > 0).reduce((a, s) => a + s.h[k], 0), lc = sum('boarder'), sk = sum('stork'), ss = sum('starshell'); if (lc || sk || ss) h += `<div class="row">In the hangars<b>${ss} starShells · ${lc} leechCraft · ${sk} Storks</b></div>`; }
  h += aimRow(null, S.boardAim0 || '');
  if (D.length) h += `<div class="sec">On the decks</div>` + D.map(x => { const t = x.t, ours = x.team === 0;
    return `<div class="deckrow ${ours ? 'ok' : 'bad'}" data-pick="${t.id}" data-jump="1"><b>${ours ? 'Boarding' : 'Repelling boarders on'} ${t.title || 'the ' + t.def.name}</b><span>${Math.round((t.boardProg || 0) * 100)}%${t.engWreck ? ' · engines wrecked' : ''}${x.duel ? ' · ' + (x.duel.res ? 'duel decided' : 'a duel on the decks') : ''}</span><i><u style="width:${Math.round((t.boardProg || 0) * 100)}%"></u></i></div>${ours && t.def.cmd ? aimRow(t, t.boardAim || '') : ''}`; }).join('');
  h += `<div class="hint tight"><b>Drag</b> select · <b>right-click</b> order · <b>Alt</b>+right-click astern · <b>H</b> every control</div>`;
  return h;
}
function ownCard(s) {
  const d = s.def, mx = shMax(s), hc = mx / 2 || 1;
  const ord = s.docked ? 'Fighting deck by deck' : s.pend ? 'Signal on its way · ' + Math.max(0, s.pend.at - S.time).toFixed(1) + 's' : s.freezeT > S.time ? 'Waiting for orders' : orderText(s);
  const helm = (s.group && !s.detached ? s.group.helm : s.helm) || 'auto', HN = Object.fromEntries(HELMS.map(([k, n]) => [k, n]));
  let tags = '';
  if (s.braceT > S.time) tags += `<span class="tag blue">Braced ${s.braceSide > 0 ? 'starboard' : 'port'}</span>`;
  if (s.cold) tags += `<span class="tag blue">Cold · shields down</span>`; else if (s.spinT > S.time) tags += `<span class="tag bad">Shields spinning up ${Math.ceil(s.spinT - S.time)}s</span>`;
  if (s.lockT > S.time) tags += `<span class="tag gold">Locked on</span>`;
  if (s.burnT > S.time) tags += `<span class="tag gold">Flank burn</span>`;
  if (s.tiredT > S.time && S.time > (s.tiredA || 0)) tags += `<span class="tag bad">Crews spent</span>`;
  if (s.emp > 0) tags += `<span class="tag blue">EMP ${s.emp.toFixed(1)}s</span>`;
  if (s.inspired) tags += '<span class="tag ok">Inspired</span>';
  if (s.rank) tags += `<span class="tag gold">${'▲'.repeat(s.rank)} ${RANKS[s.rank]}</span>`;
  tags += `<span class="tag dim">Signature ${s.sig < .55 ? 'low' : s.sig < .85 ? 'medium' : 'high'}</span>`;
  let h = `<div class="uhead"><img src="${shipIcon(s.type)}" alt=""><div><h3>${s.title || d.name}</h3><div class="role">${s.title ? d.name + ' · ' : ''}${s.cmdr ? '★ ' + s.cmdr.name : (s.group ? s.group.name + (s.group.flag === s ? ' · flagship' : '') : 'Unattached')}</div></div></div>`;
  h += `<div class="mts">${M('Hull', s.hp / d.hp, Math.ceil(s.hp).toLocaleString(), 'hull', warnCol(s.hp / d.hp))}`;
  if (d.shield && s.sub) h += `<div class="mt sh2"><span>Shields</span><b>${mx <= 0 ? 'OUT' : s.sh <= 0 && S.time - s.shDown < 15 ? 'DOWN' : Math.ceil(s.sh).toLocaleString()}</b><i class="split"><u style="width:${pct(Math.min(1, (s.shP || 0) / hc))}%"></u></i><i class="split"><u style="width:${pct(Math.min(1, (s.shS || 0) / hc))}%"></u></i><em>port · stbd</em></div>`;
  else if (d.shield) h += M('Shields', s.sh / d.shield, Math.ceil(s.sh).toLocaleString(), 'sh');
  if (d.crew > 2) h += M('Crew', s.crew / d.crew, pct(s.crew / d.crew) + '%', 'crew', warnCol(s.crew / d.crew));
  if (s.weapons.length) { const am = mainAmmo(s); h += M('Munitions', am, pct(am) + '%', 'am', warnCol(am)); }
  h += M('Fuel', s.fuel, s.fuel <= 0 ? 'DRY' : pct(s.fuel) + '%', 'fuel', warnCol(s.fuel));
  if (s.boardProg > 0) h += M('Boarded', s.boardProg, s.marines > 0 ? Math.ceil(s.marines) + ' marines' : 'falling', 'cap', '#ff9a3c');
  h += `</div><div class="uord"><span>${ord}</span><b>Helm · ${HN[helm] || 'Auto'}</b></div>`;
  if (tags) h += `<div class="utags">${tags}</div>`;
  if (s.weapons.length && !d.fighter && !d.shell) h += seg('Aim', AIMS, s.aimSub || '', 'aim');
  if (s.group) { h += seg('Formation', FORMATIONS, s.group.formation, 'form'); h += seg('Stance', STANCES, s.group.stance, 'stance'); }
  else { const n = nextFreeGroup(); if (n) h += `<div class="seg"><span class="sl">Group</span><div class="sb"><button class="sgb" data-gform="${n}">Form battle group ${n}</button></div></div>`; }
  h += `<div class="ctrs">${counterHTML(s.type)}</div>`;
  h += `<div class="dets${S.detOpen ? ' open' : ''}"><button class="dhead" data-dets="1">${S.detOpen ? '▾' : '▸'} Details · crew, systems, magazines</button>${S.detOpen ? '<div class="dbody">' + crewHTML(s) + cmdrHTML(s) + subsHTML(s) + ammoHTML(s) + `<div class="sec">Flight</div><div class="row">Velocity<b>${hyp(s.vx, s.vy).toFixed(0)} km/s</b></div>` + '</div>' : ''}</div>`;
  return h;
}
function ownMulti(sel) {
  const g = selGroup(), sum = f => sel.reduce((a, s) => a + f(s), 0);
  const hp = sum(s => s.hp) / sum(s => s.def.hp), shm = sum(s => s.def.shield), sh = shm ? sum(s => s.sh) / shm : 0, cm = sum(s => s.def.crew > 2 ? s.def.crew : 0), cr = cm ? sum(s => s.def.crew > 2 ? s.crew : 0) / cm : 1;
  const mob = sel.filter(s => !s.def.static), fu = mob.length ? mob.reduce((a, s) => a + s.fuel, 0) / mob.length : 1;
  const armed = sel.filter(s => s.weapons.length && !s.def.static), am = armed.length ? armed.reduce((a, s) => a + mainAmmo(s), 0) / armed.length : 1;
  const aims = new Set(armed.map(s => s.aimSub || '')), aimK = aims.size === 1 ? [...aims][0] : null;
  const ORDER = ['moonbreaker', 'dread', 'destroyer', 'torch', 'raider', 'frigate', 'corvette', 'corsair', 'scout', 'tender', 'hauler', 'ripwing', 'boarder', 'starshell'];
  const L = sel.slice().sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || b.hp / b.def.hp - a.hp / a.def.hp);
  const nukes = sum(s => nukesOf(s).reduce((a, w) => a + Math.floor(w.ammo), 0));
  let h = `<h3>${sel.length} ships selected${g ? `<span class="tteam">${g.name}</span>` : ''}</h3><div class="role">Fleet value ${sum(s => s.def.value || 0).toLocaleString()}${nukes ? ' · ☢ ' + nukes + ' nukes' : ''} · click a card to take that ship alone, shift-click to drop it</div>`;
  h += `<div class="ustrip">${L.slice(0, 24).map(s => { const f = s.hp / s.def.hp, sf = s.def.shield ? s.sh / (shMax(s) || s.def.shield) : 0;
    return `<button class="uc${f < .35 ? ' low' : ''}" data-pick="${s.id}" title="${esc2((s.title || s.def.name) + ' · hull ' + pct(f) + '%' + (s.def.shield ? ' · shields ' + pct(sf) + '%' : ''))}"><img src="${shipIcon(s.type)}" alt=""><i class="h"><u style="width:${pct(f)}%"></u></i>${s.def.shield ? `<i class="s"><u style="width:${pct(Math.min(1, sf))}%"></u></i>` : ''}${s.cmdr ? '<em>★</em>' : ''}</button>`; }).join('')}${L.length > 24 ? `<span class="more">+${L.length - 24}</span>` : ''}</div>`;
  h += `<div class="mts">${M('Hull', hp, pct(hp) + '%', 'hull', warnCol(hp))}${shm ? M('Shields', sh, pct(sh) + '%', 'sh') : ''}${cm ? M('Crew', cr, pct(cr) + '%', 'crew', warnCol(cr)) : ''}${armed.length ? M('Munitions', am, pct(am) + '%', 'am', warnCol(am)) : ''}${M('Fuel', fu, pct(fu) + '%', 'fuel', warnCol(fu))}</div>`;
  if (armed.length) h += seg('Aim', AIMS, aimK, 'aim');
  const fk = g ? g.formation : (S.formation || 'wedge');
  h += seg('Formation', FORMATIONS, fk, 'form');
  if (g) h += seg('Stance', STANCES, g.stance, 'stance');
  else { const n = nextFreeGroup(); if (n && sel.some(s => !s.def.static)) h += `<div class="seg"><span class="sl">Group</span><div class="sb"><button class="sgb" data-gform="${n}">Form battle group ${n}</button><span class="sh">Ctrl+${n}</span></div></div>`; }
  return h;
}
function groupControls(g, sel) {
  const fk = g ? g.formation : (S.formation || 'wedge');
  let h = `<div class="sec">${g ? 'Battle group · ' + g.name + ' (' + g.n + ')' : 'Formation'}</div><div class="chips">${FORMATIONS.map(([k, n]) => `<span class="chip${fk === k ? ' on' : ''}" data-form="${k}">${n}</span>`).join('')}</div>`;
  if (g) h += `<div class="chips" style="margin-top:4px">${STANCES.map(([k, n, d]) => `<span class="chip${g.stance === k ? ' on' : ''}" data-stance="${k}" title="${d}">${n}</span>`).join('')}</div>`;
  else if (sel.some(s => !s.def.static && s.team === 0)) { const n = nextFreeGroup(); if (n) h += `<div class="chips" style="margin-top:4px"><span class="chip" data-gform="${n}">Form battle group ${n}</span></div>`; }
  return h;
}
export function forceUI() { uiT = 0; }

// ---------------------------------------------------------------- battle group panel
let grpOpen = true, editing = null;
export function toggleGrpPanel() { grpOpen = !grpOpen; $('grpp').classList.toggle('hide', !grpOpen); $('bGrp').classList.toggle('on', grpOpen); uiT = 0; }
export function startRename(n) { editing = n; uiT = 0; }
export function endRename(n, v) { const g = S.bgroups[n]; if (g && v && v.trim()) g.name = v.trim().slice(0, 24); editing = null; uiT = 0; }
// the fleet roster's ship cards: a picture, hull and shields, a mark when she is under fire; a click takes her
function rosterCards(L) {
  if (S.mode !== 'battle') return '';
  return `<div class="gships">${L.filter(s => !s.dead && !s.offField && !s.def.fighter && !s.def.boarder && !s.def.shell).map(s => { const f = s.hp / s.def.hp, sf = s.def.shield ? Math.min(1, s.sh / (shMax(s) || s.def.shield)) : 0, hot = S.time - (s.lastHit || -99) < 4;
    return `<button class="gs${f < .35 ? ' low' : ''}${S.selection.includes(s) ? ' on' : ''}${hot ? ' hot' : ''}" data-pick="${s.id}" data-jump="1" title="${esc2((s.title || s.def.name) + ' · hull ' + pct(f) + '%' + (s.def.shield ? ' · shields ' + pct(sf) + '%' : '') + (hot ? ' · under fire' : ''))}"><img src="${shipIcon(s.type)}" alt=""><i><u style="width:${pct(f)}%"></u></i>${s.def.shield ? `<i class="s"><u style="width:${pct(sf)}%"></u></i>` : ''}</button>`; }).join('')}</div>`;
}
function mini(f, c) { return `<span class="mb"><i style="width:${pct(f)}%;background:${c}"></i></span>`; }
let otab = 'groups';
export function setOTab(t) { otab = t; uiT = 0; }
function worldRows() {
  if (!S.worlds) return '';
  let reg = null;
  return WORLDS.map(w => { const b = BODIES.find(x => x.id === w.id), st = S.worlds[w.id], o = st.owner, g = st.gov, att = worldUnderAttack(w.id);
    const head = w.region !== reg ? `<div class="wreg">${(reg = w.region)}</div>` : '';
    const he = Math.round(w.prod.he * PROD_K * worldMul(w.id, o >= 0 ? o : 0) * 60);
    return head + `<div class="wrow${S.worldSel === w.id ? " sel" : ""}" data-wjump="${w.id}" style="--oc:${ownerCol(o)}"><i class="ob"></i><div><b>${b.name}</b><span>${ownerName(o)} · ${g.def.name}${g.def.shield ? ' · sh ' + Math.round(g.sh / g.def.shield * 100) + '%' : ''}</span></div><em class="${att ? 'att' : ''}">${att ? '⚔ attack' : (o === 0 ? '+' + he + ' He/m' : '')}</em></div>`; }).join('');
}
function updGrpPanel() {
  if (!grpOpen) return;
  const el = $('grpp'); if (editing != null && document.activeElement && document.activeElement.id === 'grpname') return;
  const tabs = `<div class="otabs"><button class="otab${otab === 'groups' ? ' on' : ''}" data-otab="groups">Groups</button><button class="otab${otab === 'worlds' ? ' on' : ''}" data-otab="worlds">Worlds</button><button class="otab${otab === 'cmdrs' ? ' on' : ''}" data-otab="cmdrs">Commanders</button></div>`;
  if (otab === 'cmdrs') { setHTML(el, tabs + `<div class="obody">${cmdRows()}</div>`); return; }
  if (otab === 'worlds') { setHTML(el, tabs + `<div class="obody">${worldRows()}<div class="hint" style="margin-top:6px">Click to jump. <b>[</b> and <b>]</b> step through the worlds.</div></div>`); return; }
  const gs = groupList();
  const loose = S.mode === 'battle' ? S.ships.filter(s => s.team === 0 && !s.dead && !s.offField && !s.def.static && !s.def.fighter && !s.def.boarder && !s.def.shell && !s.ally && !s.group) : [];
  const looseRow = loose.length ? `<div class="grp loose"><div class="gh"><span class="gn">·</span><b>Unattached</b><span class="gc">${loose.length}</span></div>${rosterCards(loose)}</div>` : '';
  if (!gs.length) { setHTML(el, tabs + `<div class="obody"><div class="hint">Select ships and press <b>Alt+1–9</b> (or Ctrl+1–9) to form a battle group, or use the button in the ship panel. <b>Shift+number</b> adds the selection. A group flies at its slowest ship's pace and holds formation on its flagship.</div></div>`); return; }
  setHTML(el, tabs + `<div class="obody">` + looseRow + gs.map(g => {
    const m = g.members, f = g.flag; const sum = fn => m.reduce((a, s) => a + fn(s), 0);
    const hp = sum(s => s.hp) / sum(s => s.def.hp), shm = sum(s => s.def.shield), sh = shm ? sum(s => s.sh) / shm : 0;
    const fu = sum(s => s.fuel) / m.length, armed = m.filter(s => s.weapons.length), am = armed.length ? armed.reduce((a, s) => a + mainAmmo(s), 0) / armed.length : 1;
    const sel = m.length && m.every(s => S.selection.includes(s));
    const engaged = m.some(s => S.time - s.lastHit < 5), detached = m.filter(s => s.detached).length;
    return `<div class="grp${sel ? ' sel' : ''}" data-gsel="${g.n}">
      <div class="gh"><span class="gn">${["I","II","III","IV","V","VI","VII","VIII","IX"][g.n - 1] || g.n}</span>${editing === g.n ? `<input id="grpname" data-gn="${g.n}" value="${g.name.replace(/"/g, '')}" maxlength="24">` : `<b data-gren="${g.n}" title="Click to rename">${g.name}</b>`}<span class="gc">${m.length}</span>${engaged ? '<span class="tag bad">Engaged</span>' : ''}</div>
      <div class="t">⚑ ${f ? f.def.name + (f.cmdr ? ' · ★ ' + f.cmdr.name : '') : '—'}${detached ? ` · ${detached} detached` : ''}</div>
      <div class="mbs">${mini(hp, '#3ddc84')}${shm ? mini(sh, '#8fd3ff') : ''}${mini(fu, '#7ff3ff')}${mini(am, '#f2c14e')}</div>
      ${rosterCards(m)}
      <div class="chips"><span class="chip" data-gcyc="form" data-gn="${g.n}" title="Shift+F cycles formation">${FORMATIONS.find(x => x[0] === g.formation)[1]}</span><span class="chip" data-gcyc="stance" data-gn="${g.n}" title="${STANCES.find(x => x[0] === g.stance)[2]} · Shift+Q cycles">${STANCES.find(x => x[0] === g.stance)[1]}</span>${m.some(s => s.def.broadside) ? `<span class="chip helm" data-gcyc="helm" data-gn="${g.n}" title="Helm: ${(HELMS.find(x => x[0] === (g.helm || 'auto')) || HELMS[0])[2]} · click to cycle">⎈ ${(HELMS.find(x => x[0] === (g.helm || 'auto')) || HELMS[0])[1]}</span>` : ''}${g.lineOn ? '<span class="tag gold">In line</span>' : ''}<span class="chip" data-gjump="${g.n}">Jump</span>${detached ? `<span class="chip" data-greg="${g.n}" title="Bring detached ships back into formation">Regroup</span>` : ''}<span class="chip" data-gdis="${g.n}">Disband</span></div>
    </div>`;
  }).join('') + '</div>');
  const inp = $('grpname'); if (inp && document.activeElement !== inp) { inp.focus(); inp.select(); }
}

// ---------------------------------------------------------------- commander roster panel
let cmdOpen = false;
// the roster lives in the outliner as its third tab; the Commanders button and Shift+C open it
export function toggleCmdPanel() { const show = !(grpOpen && otab === 'cmdrs'); otab = show ? 'cmdrs' : 'groups'; if (show && !grpOpen) toggleGrpPanel(); $('bCmd').classList.toggle('on', show); uiT = 0; }
function updCmdPanel() { $('bCmd').classList.toggle('on', grpOpen && otab === 'cmdrs'); }
function cmdRows() {
  const st = { ready: 'Ready', aboard: 'Aboard', pod: 'In escape pod', dead: 'Fallen', captured: 'Prisoner' };
  const mine = S.cmdrs.filter(c => c.team === 0 && !c.ally), prisoners = S.cmdrs.filter(c => c.state === 'captured' && c.heldBy === 0);
  const one = S.selection.length === 1 && S.selection[0].team === 0 && S.selection[0].def.cmd && !S.selection[0].cmdr;
  return `<div class="hint">Assign a commander to a capital ship (Destroyer or larger) while it sits at a friendly depot. Losing one shakes nearby crews.</div>` +
    mine.map(c => `<div class="crd ${c.state}"><div><b>${c.state === 'aboard' ? '★ ' : ''}${c.name}</b> <span>· ${CMD_RANKS[c.rank]}</span></div><div class="t">${c.caste} · ${c.title}</div><div>${c.traits.map(t => `<span class="tr" title="${TRAITS[t].desc}">${TRAITS[t].name}</span>`).join('')}</div>
      <div class="t">${st[c.state]}${c.state === 'aboard' ? ' the ' + c.ship.def.name : ''}${c.state === 'pod' ? ' · ' + Math.max(0, Math.ceil(c.timer)) + ' s' : ''} · renown ${Math.round(c.renown)}</div>
      <div class="chips">${c.state === 'ready' && one ? `<span class="chip" data-cact="assign" data-cid="${c.id}">Assign to the ${S.selection[0].def.name}</span>` : ''}${c.state === 'aboard' ? `<span class="chip" data-cact="locate" data-cid="${c.id}">Locate</span>` : ''}</div></div>`).join('') +
    (prisoners.length ? `<div class="sec">Prisoners</div>` + prisoners.map(c => `<div class="t">${c.name} · ${c.title}</div>`).join('') : '');
}

export function togglePause() { S.paused = !S.paused; document.body.classList.toggle('paused', S.paused); $('pauseTag').classList.toggle('hide', !S.paused); $('bPause').classList.toggle('on', S.paused); }
export function showHelp(v) { $('help').classList.toggle('hide', !v); if (v && !S.paused && S.gameState === 'play') togglePause(); }
export function endGame(win) {
  if (S.gameState !== 'play') return; S.gameState = 'over';
  $('overT').textContent = win ? 'VICTORY' : 'DEFEAT'; $('overT').style.color = win ? 'var(--gold)' : 'var(--red)';
  $('overS').textContent = win ? 'The enemy citadel is slag' : 'Your citadel has fallen';
  $('overP').innerHTML = `${FACTIONS[S.fac[0]].name} vs ${FACTIONS[S.fac[1]].name} · ${DIFF[S.difficulty].name}<br>Time ${$('clock').textContent} · Built ${S.stats.built} · Lost ${S.stats.lost} · Kills ${S.stats.kills} · Captured ${S.stats.captured} (${S.stats.mutinies} by mutiny)<br>Crew lost ${Math.round(S.stats.crewLost).toLocaleString()}`;
  $('over').classList.remove('hide');
}
