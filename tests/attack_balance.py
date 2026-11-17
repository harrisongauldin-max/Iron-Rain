"""Attack balance (task U2): can the side that closes win?

Open space, no worlds, platforms or commanders: the pure sim. The same ships of the same faction on
both sides (the Society's 2 destroyers, 3 frigates, 2 corvettes), 24,000 km apart. The attacker attack-moves on the
defender's centre; the defender holds where it is. Both fire at effective range. Morale runs.
Scenarios, SEEDS runs each (default 6):
  equal-0   team 0 attacks an equal fleet (team 0 runs on the player's morale rules)
  equal-1   team 1 attacks an equal fleet (team 1 runs on the enemy's morale rules, which can rout)
  ratio-1.5 team 0 attacks with 1.5x the ships
The task board's target (U2): an equal attack wins about half the time, and a 1.5:1 attack wins at
least 4 of 6. The test fails if the 1.5:1 attack wins fewer than 4 of 6, or if the equal attacks
together win fewer than a quarter or more than three quarters of their runs (3 to 9 of 12 at 6 seeds:
about half, allowing for the noise of 12 runs). Before U2 an equal attack won none.
A win: the attacker holds the field (it did not rout) and lost less of its fleet than the defender,
or the defender routed.
Usage: python3 tests/attack_balance.py [SCENARIO ...]     JOBS=2 runs in parallel; prints one JSON line a run."""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)
SEEDS = int(os.environ.get('SEEDS', 6)); JOBS = int(os.environ.get('JOBS', 2))
SCEN = {'equal-0': {'att': 0}, 'equal-1': {'att': 1}, 'ratio-1.5': {'att': 0, 'ratio': 1.5}}

TRIAL = r"""async (C) => {
  const S = window.__IR.S, sim = await import('./js/sim.js'), bt = await import('./js/battle.js'), MO = await import('./js/morale.js'), T = await import('./js/tactics.js'), OPm = await import('./js/ops.js');
  const H = Math.hypot, w0 = MO.M.world;
  S.ships = []; S.shots = []; S.missiles = []; S.wrecks = []; S.hulks = []; S.parts = []; S.rings = []; S.flashes = [];
  for (const g of Object.keys(S.bgroups || {})) delete S.bgroups[g];
  OPm.OP.orb = null; S.aiHook = null; S.fireLong = [false, false];
  S.fdefs[0] = S.fdefs[1]; S.fac[0] = S.fac[1];   /* one faction on both sides */
  const X0 = 2.0e7, Y0 = 2.0e7, D0 = 24000, att = C.att, def = 1 - att;
  const comp = ['destroyer', 'destroyer', 'frigate', 'frigate', 'frigate', 'corvette', 'corvette'];
  const mk = (team, list, cx, face) => list.map((t, k) => { const row = Math.floor(k / 4), col = k % 4;
    const s = sim.makeShip(t, team, cx + Math.cos(face + Math.PI) * row * 900 + Math.cos(face + Math.PI / 2) * (col - 1.5) * 1100, Y0 + Math.sin(face + Math.PI) * row * 900 + Math.sin(face + Math.PI / 2) * (col - 1.5) * 1100, face);
    s.seen = true; s.vis = [true, true, false]; return s; });
  const n = Math.round(comp.length * (C.ratio || 1)), alist = Array.from({ length: n }, (_, k) => comp[k % comp.length]);
  const A = mk(att, alist, att === 0 ? X0 - D0 / 2 : X0 + D0 / 2, att === 0 ? 0 : Math.PI);
  const Dd = mk(def, comp, def === 0 ? X0 - D0 / 2 : X0 + D0 / 2, def === 0 ? 0 : Math.PI);
  MO.setup(w0, att);
  S.paused = false; T.T.ff = false; T.T.ffOff = true; T.T.manual = false; S.speed = 1; S.ffStep = null;
  const cen = L => { const a = L.filter(s => !s.dead); return a.length ? [a.reduce((q, s) => q + s.x, 0) / a.length, a.reduce((q, s) => q + s.y, 0) / a.length] : [0, 0]; };
  const dc = cen(Dd);
  for (const s of A) s.order = { type: 'amove', x: dc[0], y: dc[1] };
  for (const s of Dd) s.order = { type: 'idle', x: s.x, y: s.y };
  const val = L => L.reduce((q, s) => q + (s.dead || s.surrendered ? 0 : (s.def.value || 50)), 0), v0 = [val(A), val(Dd)];
  let t = 0; const dt = 1 / 30;
  while (t < 420) {
    for (let k = 0; k < 30; k++) { sim.update(dt); bt.battleTick(dt); }
    t++;
    if (!A.some(s => !s.dead && !s.surrendered) || !Dd.some(s => !s.dead && !s.surrendered)) break;
    const r = MO.M.rout[att] ?? MO.M.rout[def]; if (r != null && S.time > r + 40) break;
  }
  const lostA = 1 - val(A) / v0[0], lostD = 1 - val(Dd) / v0[1];
  const win = MO.M.rout[att] == null && (MO.M.rout[def] != null || lostA < lostD);
  return { t, v0, lostA: +lostA.toFixed(2), lostD: +lostD.toFixed(2), routA: MO.M.rout[att] != null, routD: MO.M.rout[def] != null, win };
}"""

async def run(p, sc, seed):
    b = await launch(p); ctx = await b.new_context(viewport={'width': 960, 'height': 540}); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    try:
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
        r = await pg.evaluate(TRIAL, SCEN[sc])
    except Exception as e:
        r = {'error': str(e)[:200]}
    r.update({'sc': sc, 'seed': seed, 'err': errs[:2]}); print(json.dumps(r), flush=True)
    await b.close(); return r

async def main():
    names = [a for a in sys.argv[1:] if a in SCEN] or list(SCEN)
    jobs = [(sc, k) for sc in names for k in range(SEEDS)]; out = []
    async with async_playwright() as p:
        sem = asyncio.Semaphore(JOBS)
        async def one(j):
            async with sem: out.append(await run(p, *j))
        await asyncio.gather(*(one(j) for j in jobs))
    fails = []; eq = 0; eqn = 0
    for sc in names:
        R = [r for r in out if r['sc'] == sc]; w = sum(1 for r in R if r.get('win')); bad = [r for r in R if 'error' in r or r['err']]
        print(f'{sc:10s} attacker won {w} of {len(R)}   mean lost attacker {sum(r.get("lostA", 1) for r in R) / max(1, len(R)):.2f} defender {sum(r.get("lostD", 0) for r in R) / max(1, len(R)):.2f}')
        if sc.startswith('ratio') and w < 4 * len(R) / 6: fails.append(f'{sc}: {w} of {len(R)}, want at least {round(4 * len(R) / 6)}')
        if sc.startswith('equal'): eq += w; eqn += len(R)
        if bad: fails.append(f'{sc}: errors {[r.get("error") or r["err"] for r in bad][:2]}')
    if eqn:
        print(f'equal attacks won {eq} of {eqn}; the U2 target is about half')
        if not eqn / 4 <= eq <= eqn * 3 / 4: fails.append(f'equal attacks won {eq} of {eqn}, want about half ({round(eqn / 4)}-{round(eqn * 3 / 4)})')
    print('FAIL' if fails else 'PASS', fails); sys.exit(1 if fails else 0)
asyncio.run(main())
