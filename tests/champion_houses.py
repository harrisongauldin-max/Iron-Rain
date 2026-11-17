"""G3: every champion carries a House of his own power.

  python3 tests/champion_houses.py

Starts a campaign, then recruits champions for each power (resources topped up, each dismissed so the cap does not
bite) and checks every name's House is in that power's list (command.js HOUSES). Passes (exit 0) when all are.
"""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

async def main():
    errs = []
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS))
        pg = await b.new_page(viewport={'width': 1280, 'height': 800})
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        await pg.goto(URL); await pg.wait_for_timeout(3000)
        await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4000)
        r = await pg.evaluate("""async()=>{const C=window.__CAMP.C, AG=await import('./js/agents.js'), CM=await import('./js/command.js'); const out={};
          for (const f of ['rep','soc','rim']) { out[f]={n:0, bad:[]};
            for (let k=0;k<60;k++) { C.fac[f].res.inf=1e6; C.fac[f].res.he=1e6; const a=AG.recruit(f,'champion'); if (typeof a==='string') { out[f].err=a; break; }
              out[f].n++; const h=a.name.split(' au ')[1]; if (!CM.HOUSES[f].includes(h)) out[f].bad.push(a.name); a.state='dead'; C.agents=C.agents.filter(x=>x!==a); } }
          return out;}""")
        await b.close()
    print(json.dumps(r))
    ok = all(v['n'] >= 50 and not v['bad'] and 'err' not in v for v in r.values()) and not errs
    for e in errs: print('PAGEERROR', e)
    print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)

if __name__ == '__main__':
    asyncio.run(main())
