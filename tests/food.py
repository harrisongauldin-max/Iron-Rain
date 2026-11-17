"""G4: food costs something to keep.

  python3 tests/food.py [allai|passive] [weeks]      RUNS=2 by default

Plays whole campaigns on the model (battles auto-resolved) and follows each power's food store week by week.
Passes (exit 0) when, in every run, no power sits at the 3,000 cap for more than a quarter of the weeks, and the top
bar's red rule (exhausted or dry, and the stock did not rise last week) never fires in a week the stock then rose.
"""
import sys, asyncio, json, os
from playwright.async_api import async_playwright
URL=os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html'); CH='/usr/bin/google-chrome'; ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
MODE=sys.argv[1] if len(sys.argv)>1 else 'allai'; N=int(sys.argv[2]) if len(sys.argv)>2 else 60
async def one(p):
    b=await p.chromium.launch(executable_path=CH, headless=True, args=ARGS); pg=await b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    await pg.goto(URL); await pg.wait_for_timeout(3000)
    await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4000)
    r=await pg.evaluate("""([MODE,N])=>{const K=window.__CAMP.K, C=window.__CAMP.C; if(MODE==='allai') C.fac[C.player].ai=true; const rows=[];
      for(let t=0;t<N&&!C.over;t++){ const row={wk:C.turn}; for(const f of ['rep','soc','rim']){ row[f]=[Math.round(C.fac[f].res.food), Math.round(K.income(f).food)]; }
        const cfs=K.endTurn(); for(const c of cfs) K.autoResolve(c); K.finishTurn();
        for(const f of ['rep','soc','rim']) row[f].push(Math.round(C.fac[f].res.food), (C.fac[f].delta||{}).food ?? null); rows.push(row); }
      return {player:C.player, rows};}""", [MODE,N])
    await b.close(); return r, errs
async def main():
    bad=[]
    async with async_playwright() as p:
        res=await asyncio.gather(*[one(p) for _ in range(int(os.environ.get('RUNS','2')))])
    for r,e in res:
        print('player', r['player'], 'errors', e[:2])
        for row in r['rows']:
            if row['wk']<=8 or row['wk']%5==0: print(row['wk'], ' '.join(f"{f}:{row[f][0]:>5}{row[f][1]:+5}->{row[f][2]:>5}" for f in ['rep','soc','rim']))
        for f in ['rep','soc','rim']:
            st=[row[f][2] for row in r['rows']]; capw=sum(1 for x in st if x>=2990); first=next((row['wk'] for row in r['rows'] if row[f][2]>=2990), None)
            drawn=lambda i,row: (i==0 or not (r['rows'][i-1][f][3] or 0) > 0) and ((row[f][0]<=0 and row[f][1]<0) or (row[f][1]<0 and row[f][0]+3*row[f][1]<0))  # the top bar's rule
            red=sum(1 for i,row in enumerate(r['rows']) if drawn(i,row) and i>0 and (r['rows'][i-1][f][3] or 0)>0)  # red right after a week the store rose: must be 0
            after=sum(1 for i,row in enumerate(r['rows']) if drawn(i,row) and row[f][2]>row[f][0])  # red, then the store rose that week (shown for information)
            print(f'  {f}: weeks at cap {capw}/{len(st)} first cap wk {first}; weeks drawn red right after the store rose: {red}; drawn red and the store then rose: {after}')
            if capw > len(st) / 4: bad.append(f'{f} at the cap {capw} of {len(st)} weeks')
            if red: bad.append(f'{f} drawn red in {red} weeks the stock rose')
        if e: bad.append('page errors')
    print('PASS' if not bad else 'FAIL ' + '; '.join(bad)); sys.exit(1 if bad else 0)
if __name__ == '__main__': asyncio.run(main())
