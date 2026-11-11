"""Campaign smoke test: starts a campaign and plays 12 turns with auto-resolved battles. Passes if no page errors."""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)
async def main():
    async with async_playwright() as p:
        b=await launch(p)
        pg=await b.new_page(viewport={'width':1600,'height':900}); errs=[]
        pg.on('pageerror',lambda e: errs.append('PAGEERROR: '+str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(4000)
        await pg.evaluate("()=>{document.querySelector('[data-mode=camp]').click()}"); await pg.wait_for_timeout(500); await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(5000)
        r=await pg.evaluate("""async()=>{const K=window.__CAMP.K, C=window.__CAMP.C; document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
          for(let t=0;t<12;t++){ const cf=K.endTurn(); for(const c of cf) K.autoResolve(c); K.finishTurn(); } return C.turn;}""")
        print('turn', r, errs[:5]); await b.close(); sys.exit(1 if errs else 0)
asyncio.run(main())
