"""G5: a late game.

  RUNS=2 WEEKS=60 FALL=soc:rep:20 python3 tests/late_game.py

Plays campaigns on the model with every power handed to the AI. At week 20 (FALL) every world of the Society passes
to the Republic and its fleets are struck, so it falls. Passes (exit 0) when, in every run:
- every power still standing gets a card at least every 3 weeks after the fall (story.js lateTick, C.cardLog);
- He-3 and influence stop climbing: at the end each is under its store (economy.js STORE) or no more than 15% above
  what it was ten weeks before;
- the page throws nothing.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
URL=os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html'); CH='/usr/bin/google-chrome'; ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
RUNS=int(os.environ.get('RUNS','2')); N=int(os.environ.get('WEEKS','60')); FALL=os.environ.get('FALL','soc:rep:20').split(':'); MODE=os.environ.get('MODE','allai')
JS="""async([N,FALL,MODE])=>{const K=window.__CAMP.K, C=window.__CAMP.C; document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
  if (MODE==='allai') C.fac[C.player].ai=true; const st={}, cards={}, threats={};
  for(let t=0;t<N&&!C.over;t++){
    if (C.turn===+FALL[2]) { for (const id in C.worlds) if (C.worlds[id].owner===FALL[0]) { C.worlds[id].owner=FALL[1]; C.worlds[id].siege=null; } C.fleets=C.fleets.filter(f=>f.owner!==FALL[0]); }
    const cfs=K.endTurn(); for(const c of cfs) K.autoResolve(c); K.finishTurn();
    if (MODE!=='allai' && C.pendingEvents) { C.pendingEvents.length=0; }
    for (const f of ['rep','soc','rim']) { (st[f]=st[f]||[]).push([C.turn, Math.round(C.fac[f].res.he), Math.round(C.fac[f].res.inf), Math.round(C.fac[f].res.man)]); }
  }
  for (const e of (C.cardLog||[])) (cards[e.f]=cards[e.f]||[]).push([e.t, e.k]);
  return {wk:C.turn, alive:['rep','soc','rim'].filter(f=>C.fac[f].alive), st, cards, fellT:C.fellT||null};}"""
async def one(p):
    b=await p.chromium.launch(executable_path=CH, headless=True, args=ARGS); pg=await b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    await pg.goto(URL); await pg.wait_for_timeout(3000)
    await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4000)
    r=await pg.evaluate(JS, [N,FALL,MODE]); await b.close(); r['errs']=errs[:3]; return r
STORE={'he':15000,'inf':1000}
async def main():
    bad=[]
    async with async_playwright() as p:
        rs=await asyncio.gather(*[one(p) for _ in range(RUNS)])
    for r in rs:
        if r['errs']: bad.append('page errors')
        if not r['fellT']: bad.append('no fall recorded')
        print('weeks', r['wk'], 'alive', r['alive'], 'fell at', r['fellT'], 'errors', r['errs'])
        for f in r['alive']:
            ts=sorted(set(t for t,k in r['cards'].get(f,[]) if r['fellT'] and t>=r['fellT']))
            gaps=[b-a for a,b in zip([r['fellT']]+ts, ts+[r['wk']])] if r['fellT'] else []
            late=[k for t,k in r['cards'].get(f,[]) if r['fellT'] and t>=r['fellT']]
            S={row[0]:row for row in r['st'][f]}
            pick=lambda w: S.get(w) or S[max(k for k in S if k<=w)]
            print(f"  {f}: cards after the fall {len(ts)} weeks, longest gap {max(gaps) if gaps else None}; kinds {sorted(set(late))}")
            print(f"     He-3/inf/man at wk 20,40,50,60:", [pick(w)[1:] for w in (20,40,50,60)])
            if not gaps or max(gaps) > 3: bad.append(f'{f}: a gap of {max(gaps) if gaps else None} weeks without a card')
            end, ten = pick(r['wk']), pick(r['wk'] - 10)
            for j, k in ((1, 'he'), (2, 'inf')):
                if end[j] > STORE[k] and end[j] > ten[j] * 1.15: bad.append(f'{f}: {k} still climbing ({ten[j]} -> {end[j]})')
    print('PASS' if not bad else 'FAIL ' + '; '.join(bad)); sys.exit(1 if bad else 0)
if __name__ == '__main__': asyncio.run(main())
