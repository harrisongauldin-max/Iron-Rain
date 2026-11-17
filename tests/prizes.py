"""G2: prize hulls cost something.

  RUNS=2 WEEKS=60 python3 tests/prizes.py

Plays 60-week campaigns as the menu's power (the Republic), handed to the campaign AI, which parleys and demands
surrender whenever it may (as tests/campaign_ai.py --parley does). Reports the surrenders, the hulls struck to us,
those scuttled by their crews and those recommissioned. Passes (exit 0) when no run puts more than 40 prize hulls
into service, and the page throws nothing.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
URL=os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html'); CH='/usr/bin/google-chrome'; ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
RUNS=int(os.environ.get('RUNS','2')); N=int(os.environ.get('WEEKS','60'))
JS="""async(N)=>{const K=window.__CAMP.K, C=window.__CAMP.C, PA=await import('./js/parley.js'); document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
  C.fac[C.player].ai=true; let surr=0, taken=0;
  for(let t=0;t<N&&!C.over;t++){ const cfs=K.endTurn(); for(const c of cfs){ if (PA.canParley(c, C.player)) { const x=PA.context(c, C.player); if (x.pSurrender>0) { if (Math.random()<x.pSurrender) { const r=PA.surrender(c, C.player, x.foe); surr++; taken+=r.captured||0; continue; } PA.defied(c, x.foe); } } K.autoResolve(c); } K.finishTurn(); }
  const prizesNow={}; for (const fl of C.fleets) for (const s of fl.ships) if (s.prize) prizesNow[fl.owner]=(prizesNow[fl.owner]||0)+1;
  return {wk:C.turn, player:C.player, surr, taken, stats:C.stats, prizesNow};}"""
async def one(p):
    b=await p.chromium.launch(executable_path=CH, headless=True, args=ARGS); pg=await b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    await pg.goto(URL); await pg.wait_for_timeout(3000)
    await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4000)
    r=await pg.evaluate(JS, N); await b.close(); r['errs']=errs[:2]; return r
async def main():
    async with async_playwright() as p:
        rs=await asyncio.gather(*[one(p) for _ in range(RUNS)])
    for r in rs:
        st=r['stats'] or {}
        print(json.dumps({'wk':r['wk'],'surrenders':r['surr'],'hulls struck to us':r['taken'],'scuttled (all)':st.get('scuttled'),'recommissioned':st.get('recommissioned'),'prize hulls still waiting':r['prizesNow'],'errs':r['errs']}))
    bad=[r for r in rs if ((r['stats'] or {}).get('recommissioned') or {}).get(r['player'],0) > 40 or r['errs']]
    print('PASS' if not bad else 'FAIL'); sys.exit(1 if bad else 0)
if __name__ == '__main__': asyncio.run(main())
