"""Counter cards (task U3): does each ship card's "Strong against" claim hold in the sim?

Each claim below sets the card's ship against what it claims to beat, at about equal value (DEFS value), in open
space: no worlds, platforms, commanders or AI, one faction on both sides (the faction that has both hulls). The two
fleets start 24,000 km apart and attack-move on each other. Both fire at effective range, and morale runs. The
claimant fights as team 0 in half the runs and as team 1 in the other half (the two teams' morale rules differ).
A win: the side holds the field (did not rout) and lost a smaller share of its value (hull) than the other side, by
more than 2 points, or the other side routed. Within 2 points, with nobody routed, is a draw. Each card's "Weak
against" line is the mirror of another card's claim (the dreadnought is weak
against corvettes: the corvette claims the dreadnought), so the list covers both columns.

Fails if any claim loses more runs than it wins (the task board's "done when"), or on page errors.

Usage: python3 tests/counters.py [CLAIM ...]   SEEDS=4 (runs per claim, even) JOBS=3 (browsers in parallel)
Prints one JSON line a run, then a table per claim."""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)
SEEDS = int(os.environ.get('SEEDS', 4)); JOBS = int(os.environ.get('JOBS', 3))

# name: (faction, claimant, n, foe, n, the card's words)
# name: (faction, claimant, how many, foe, the card's words). The foe's number is worked out to the same value.
CLAIMS = {
  'corvette>dread':     ('core', 'corvette', 9, 'dread', 'corvette: capital ships, torpedoes from in under their guns'),
  'corvette>frigate':   ('core', 'corvette', 9, 'frigate', 'corvette: frigates'),
  'corsair>frigate':    ('rising', 'corsair', 12, 'frigate', 'corsair: frigates'),
  'corsair>ripwing':    ('rising', 'corsair', 10, 'ripwing', 'corsair: fighters'),
  'raider>torch':       ('rim', 'raider', 9, 'torch', 'Rim Lancer: torchShips'),
  'raider>destroyer':   ('rim', 'raider', 9, 'destroyer', 'Rim Lancer: destroyers'),
  'raider>frigate':     ('rim', 'raider', 2, 'frigate', 'Rim Lancer: frigates'),
  'torch>corvette':     ('core', 'torch', 3, 'corvette', 'torchShip: escorts'),
  'torch>ripwing':      ('core', 'torch', 1, 'ripwing', 'torchShip: fighters'),
  'destroyer>corvette': ('core', 'destroyer', 2, 'corvette', 'destroyer: escorts'),
  'destroyer>ripwing':  ('core', 'destroyer', 1, 'ripwing', 'destroyer: fighters'),
  'dread>destroyer':    ('core', 'dread', 4, 'destroyer', 'dreadnought: destroyers, at long range'),
  'dread>torch':        ('core', 'dread', 1, 'torch', 'dreadnought: torchShips, at long range'),
  'dread>raider':       ('rim', 'dread', 1, 'raider', 'dreadnought: Lancers, at long range'),
  'moonbreaker>dread':  ('core', 'moonbreaker', 1, 'dread', 'moonBreaker: every line ship'),
  'moonbreaker>destroyer': ('core', 'moonbreaker', 1, 'destroyer', 'moonBreaker: every line ship'),
  'ripwing>boarder':    ('core', 'ripwing', 16, 'boarder', 'ripWing: other fighters, leechCraft'),
  # the ripWing card no longer claims a capital ship as such: at equal value a dreadnought's flak and her own twelve
  # ripWings shot down most of the nukes before they burst (claude/space-tasks.md, U3)
}

TRIAL = r"""async (C) => {
  const S = window.__IR.S, sim = await import('./js/sim.js'), bt = await import('./js/battle.js'), MO = await import('./js/morale.js'), T = await import('./js/tactics.js'), OPm = await import('./js/ops.js');
  const w0 = MO.M.world;
  if (!bt.curBattle() || S.gameState !== 'play') return { reboot: true }; // the battle screen closed: the harness opens a new one
  S.ships = []; S.shots = []; S.missiles = []; S.wrecks = []; S.hulks = []; S.parts = []; S.rings = []; S.flashes = [];
  for (const g of Object.keys(S.bgroups || {})) delete S.bgroups[g];
  OPm.OP.orb = null; S.aiHook = null; S.fireLong = [false, false];
  sim.setupFactions(C.fk, C.fk);
  const X0 = 2.0e7, Y0 = 2.0e7, D0 = 24000, ct = C.team, ft = 1 - ct;
  const mk = (team, type, n) => { const face = team === 0 ? 0 : Math.PI, cx = team === 0 ? X0 - D0 / 2 : X0 + D0 / 2, per = 5;
    return Array.from({ length: n }, (_, k) => { const row = Math.floor(k / per), col = k % per, gap = 700 + sim.defOf(team, type).r * 8;
      const s = sim.makeShip(type, team, cx + Math.cos(face + Math.PI) * row * gap + Math.cos(face + Math.PI / 2) * (col - (Math.min(n, per) - 1) / 2) * gap, Y0 + Math.sin(face + Math.PI) * row * gap + Math.sin(face + Math.PI / 2) * (col - (Math.min(n, per) - 1) / 2) * gap, face);
      s.seen = true; s.vis = [true, true, false]; return s; }); };
  // the same value on both sides: the foe's fleet is as many hulls as the value buys, the last one with the part of
  // her hull the remainder buys (2.74 dreadnoughts: the third at 74%); under a quarter of a hull is left out
  const nf = C.na * sim.defOf(ct, C.a).value / sim.defOf(ft, C.b).value, fr = nf - Math.floor(nf), nb = Math.max(1, fr >= .25 ? Math.ceil(nf) : Math.floor(nf));
  const A = mk(ct, C.a, C.na), B = mk(ft, C.b, nb); if (fr >= .25 && nf > 1) { const z = B[B.length - 1]; z.hp *= fr; }
  const dmg = {}, launched = {}; S.dbgHit = C.dbg ? (s, amt, team, x, y, kind, src) => { const k = (src ? src.type : '?') + '>' + s.type + ':' + kind; dmg[k] = (dmg[k] || 0) + amt; } : null;
  const seenM = new Set(), fate = {}, fired = {}; S.dbgFire = C.dbg ? (s, w, D) => { const k = s.type + ':' + (D.name || '?'); fired[k] = (fired[k] || 0) + 1; } : null; S.dbgMis = C.dbg ? (m, ic) => { const k = (m.src ? m.src.type : '?') + (m.breach ? ':breach' : ':msl') + (ic ? ':shot down' : m.life <= 0 ? ':ran out' : ':burst'); fate[k] = (fate[k] || 0) + 1; } : null;
  MO.setup(w0, 0);
  S.paused = false; T.T.ff = false; T.T.ffOff = true; T.T.manual = false; S.speed = 1; S.ffStep = null;
  const cen = L => { const a = L.filter(s => !s.dead); return a.length ? [a.reduce((q, s) => q + s.x, 0) / a.length, a.reduce((q, s) => q + s.y, 0) / a.length] : [0, 0]; };
  const ca = cen(A), cb = cen(B);
  for (const s of A) s.order = { type: 'amove', x: cb[0], y: cb[1] };
  for (const s of B) s.order = { type: 'amove', x: ca[0], y: ca[1] };
  const val = L => L.reduce((q, s) => q + (s.dead || s.surrendered ? 0 : (s.def.value || 50) * Math.max(0, Math.min(1, s.hp / s.def.hp))), 0), v0 = [val(A), val(B)];
  let t = 0; const dt = 1 / 30;
  while (t < 480) {
    for (let k = 0; k < 30; k++) { S.speed = 1; sim.update(dt); const Bt = bt.curBattle(); if (!Bt) return { reboot: true }; Bt.endT = null; Bt.result = null; Bt.diseng = null; bt.battleTick(dt); } // the battle screen is kept open, so the next run can use it
    if (C.dbg) { for (const m of S.missiles) { if (seenM.has(m)) continue; seenM.add(m); const k = (m.src ? m.src.type : '?') + (m.breach ? ':breach' : m.emp ? ':emp' : ':msl'); launched[k] = (launched[k] || 0) + 1; } }
    t++; if (C.dbg && (t % 20 === 0 || t < 4)) { const a = cen(A), b = cen(B); C.log = (C.log || []); C.log.push([t, Math.round(Math.hypot(a[0]-b[0], a[1]-b[1])), A.filter(s=>!s.dead).map(s=>s.order.type+(s.engage?'*':'')).join(','), B.filter(s=>!s.dead).map(s=>s.order.type+(s.engage?'*':'')).join(','), Math.round(A[0].x-X0), Math.round(B[0].x-X0)]); }
    if (!A.some(s => !s.dead && !s.surrendered) || !B.some(s => !s.dead && !s.surrendered)) break;
    const r = MO.M.rout[ct] ?? MO.M.rout[ft]; if (r != null && S.time > r + 40) break;
  }
  const lostA = 1 - val(A) / v0[0], lostB = 1 - val(B) / v0[1];
  const rA = MO.M.rout[ct] != null, rB = MO.M.rout[ft] != null, d = lostA - lostB;
  const win = !rA && (rB || d < -.02), loss = !rB && (rA || d > .02); // within 2 points of each other and nobody routed: a draw
  S.dbgHit = null; S.dbgMis = null; S.dbgFire = null; for (const k in dmg) dmg[k] = Math.round(dmg[k]);
  return { log: C.log, dmg: C.dbg ? dmg : undefined, launched: C.dbg ? launched : undefined, fate: C.dbg ? fate : undefined, fired: C.dbg ? fired : undefined, t, v0: v0.map(Math.round), lostA: +lostA.toFixed(2), lostB: +lostB.toFixed(2), routA: rA, routB: rB, win, loss };
}"""

async def boot(p):
    b = await launch(p); ctx = await b.new_context(viewport={'width': 960, 'height': 540}); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    await pg.goto(URL); await pg.wait_for_timeout(500)
    await pg.evaluate("()=>{localStorage.setItem('ir.quality','standard'); localStorage.setItem('ironrain.opts', JSON.stringify({skipTrivial:false}))}"); await pg.reload(); await pg.wait_for_timeout(3500)
    await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("()=>document.querySelector('#start').click()"); await pg.wait_for_timeout(5000)
    for _ in range(5):
        if not await pg.evaluate("()=>!document.getElementById('smodal').classList.contains('hide')"): break
        await pg.evaluate("()=>{const e=document.querySelector('#smodal [data-m=ok]')||document.querySelector('#smodal .mbtns .btn'); e&&e.click()}"); await pg.wait_for_timeout(1000)
    await pg.keyboard.press('Enter')
    for _ in range(20):
        await pg.wait_for_timeout(1500)
        if await pg.query_selector('#smodal [data-m=fight]'): break
    for _ in range(3):   # the parley card first (its Open fire also says fight), then the battle screen
        parley = await pg.evaluate("()=>document.getElementById('smodal').className.includes('parley')")
        await pg.evaluate("()=>document.querySelector('#smodal [data-m=fight]').click()")
        if not parley: break
        await pg.wait_for_timeout(2500)
    await pg.wait_for_timeout(6000)
    await pg.evaluate("()=>{const e=document.querySelector('[data-ba=begin]'); e&&e.click()}"); await pg.wait_for_timeout(300)
    return b, pg, errs

async def worker(p, q, out):
    # one battle screen serves run after run; when it closes (a run's end can still finish the battle) or a run fails,
    # a fresh page is opened and the run is played again there
    b = pg = None; errs = []
    while True:
        try: name, seed = q.get_nowait()
        except asyncio.QueueEmpty: break
        fk, a, na, fb, _ = CLAIMS[name]
        for tries in range(3):
            try:
                if pg is None: b, pg, errs = await boot(p)
                r = await pg.evaluate(TRIAL, {'fk': fk, 'a': a, 'na': na, 'b': fb, 'team': seed % 2, 'dbg': os.environ.get('DBG') == '1'})
            except Exception as e: r = {'error': str(e)[:200]}
            if not (r.get('reboot') or 'error' in r): break
            if b: await b.close()
            b = pg = None
        r.update({'claim': name, 'seed': seed, 'err': errs[:2]}); errs.clear(); print(json.dumps(r), flush=True); out.append(r)
    if b: await b.close()

async def main():
    names = [a for a in sys.argv[1:] if a in CLAIMS] or list(CLAIMS)
    q = asyncio.Queue(); out = []
    for n in names:
        for k in range(SEEDS): q.put_nowait((n, k))
    async with async_playwright() as p:
        await asyncio.gather(*(worker(p, q, out) for _ in range(min(JOBS, q.qsize()))))
    fails = []
    print(f"\n{'claim':20s} {'W-L':>5s}  {'value':>11s}  lost (claimant / foe)")
    for n in names:
        R = [r for r in out if r['claim'] == n]; w = sum(1 for r in R if r.get('win')); l = sum(1 for r in R if r.get('loss') or 'error' in r); bad = [r for r in R if 'error' in r or r['err']]
        v = R[0].get('v0', ['?', '?']) if R else ['?', '?']
        la = sum(r.get('lostA', 1) for r in R) / max(1, len(R)); lb = sum(r.get('lostB', 0) for r in R) / max(1, len(R))
        print(f"{n:20s} {w:>2d}-{l:<2d}  {v[0]:>5}/{v[1]:<5}  {la:.2f} / {lb:.2f}   {CLAIMS[n][4]}")
        if w < l: fails.append(f'{n}: won {w}, lost {l} of {len(R)}')
        if bad: fails.append(f'{n}: errors {[r.get("error") or r["err"] for r in bad][:2]}')
    print('FAIL' if fails else 'PASS', fails); sys.exit(1 if fails else 0)
asyncio.run(main())
