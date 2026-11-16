"""Battle camera test (task U1): after Begin the battle at Mercury in week 1, both fleets' centres are on screen.
Checks each approach the player can pick, right after Begin and again after the fleets have closed for a while.
Usage: python3 tests/battle_camera.py          (exit 1 on failure)"""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)

# where both fleet centres are on screen, in pixels, and how far the camera centre is from each (km)
VIEW = """async()=>{const S=window.__IR.S, C=await import('./js/cam.js'); const o={}, out={W:S.W,H:S.H,z:S.cam.z,fleets:[]};
  for (const t of [0,1]) { const L=S.ships.filter(s=>s.team===t&&!s.dead&&!s.def.static&&!s.offField&&!s.def.fighter&&!s.def.shell); if(!L.length) continue;
    const x=L.reduce((a,s)=>a+s.x,0)/L.length, y=L.reduce((a,s)=>a+s.y,0)/L.length; C.projectTo(o,x,y);
    out.fleets.push({team:t, sx:Math.round(o.x), sy:Math.round(o.y), ok:o.ok, on:o.ok&&o.x>=0&&o.x<=S.W&&o.y>=0&&o.y<=S.H, km:Math.round(Math.hypot(x-S.cam.x,y-S.cam.y))}); }
  return out;}"""

async def one(p, approach):
    b = await launch(p); pg = await b.new_page(viewport={'width': 1600, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    await pg.goto(URL); await pg.wait_for_timeout(500)
    await pg.evaluate("()=>{localStorage.setItem('ir.quality','standard'); localStorage.setItem('ironrain.opts', JSON.stringify({skipTrivial:false}))}"); await pg.reload(); await pg.wait_for_timeout(3500)
    await pg.mouse.move(800, 450)
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
    if approach: await pg.evaluate(f"()=>{{const e=document.querySelector('[data-ap={approach}]'); e&&!e.disabled&&e.click()}}"); await pg.wait_for_timeout(500)
    # the player pans away during deployment: Begin must still open on the fleets
    await pg.evaluate("()=>{const S=window.__IR.S; S.cam.x+=400000; S.cam.y-=250000;}")
    await pg.evaluate("()=>{const e=document.querySelector('[data-ba=begin]'); e&&e.click()}"); await pg.wait_for_timeout(1500)
    v0 = await pg.evaluate(VIEW)
    # close for a while at the closing speed, the way a player who gives the Advance order would
    await pg.evaluate("""async()=>{const S=window.__IR.S, sim=await import('./js/sim.js'), bt=await import('./js/battle.js'), T=await import('./js/tactics.js');
      T.advance(); for(let k=0;k<20*60;k++){ sim.update(1/60*8); bt.battleTick(1/60); } }""")
    await pg.wait_for_timeout(1500)
    v1 = await pg.evaluate(VIEW)
    await b.close()
    return {'approach': approach or 'default', 'begin': v0, 'later': v1, 'errs': errs[:3]}

async def main():
    fails = []
    async with async_playwright() as p:
        for ap in [None, 'sun', 'shadow', 'line']:
            r = await one(p, ap); print(json.dumps(r))
            for k in ('begin', 'later'):
                v = r[k]
                if len(v['fleets']) < 2 or not all(f['on'] for f in v['fleets']): fails.append(f"{r['approach']}/{k}: {v['fleets']}")
            if r['errs']: fails.append(f"{r['approach']}: page errors {r['errs']}")
    print('FAIL' if fails else 'PASS', fails)
    sys.exit(1 if fails else 0)
asyncio.run(main())
