"""Space-battle AI tournament: one scenario, one AI ('old' = tests/baseline/enemyai_v1.js, 'new' = js/enemyai.js), one run.
Usage: python3 tests/ai_tournament.py SCENARIO AI SEED     (prints one JSON line)
Scenarios (Mercury, week 1): even, even-attack, even-attack-far, attack, defend; add -easy / -hard for difficulty.
  even*   the player brings a squadron only (no moonBreaker or torchShips), so the fight is roughly even
  attack  the AI attacks a player who holds still; otherwise the player advances on a defending AI
  far     the fleets start 60,000 km apart instead of 24,000
Metrics: value lost by each side, enemy seconds idle while hit, seconds hit with no target in reach, warships that never fired."""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)
SC=sys.argv[1]; AI=sys.argv[2]; SEED=sys.argv[3] if len(sys.argv)>3 else '0'
OLD=open(os.path.join(HERE, 'baseline', 'enemyai_v1.js')).read()
async def main():
    async with async_playwright() as p:
        b=await launch(p)
        ctx=await b.new_context(viewport={'width':960,'height':540})
        if AI=='old':
            await ctx.route('**/js/enemyai.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=OLD))
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)[:200]))
        await pg.goto(URL); await pg.wait_for_timeout(500)
        await pg.evaluate("()=>localStorage.setItem('ir.quality','standard')"); await pg.reload(); await pg.wait_for_timeout(3500); await pg.mouse.move(480,270)
        await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.querySelector('#start').click()"); await pg.wait_for_timeout(5000)
        for _ in range(5):
            if not await pg.evaluate("()=>!document.getElementById('smodal').classList.contains('hide')"): break
            await pg.evaluate("()=>{const e=document.querySelector('#smodal [data-m=ok]')||document.querySelector('#smodal .mbtns .btn'); e&&e.click()}"); await pg.wait_for_timeout(1000)
        await pg.keyboard.press('Enter')
        for _ in range(20):
            await pg.wait_for_timeout(1500)
            if await pg.query_selector('#smodal [data-m=fight]'): break
        await pg.evaluate("()=>document.querySelector('#smodal [data-m=fight]').click()"); await pg.wait_for_timeout(6000)
        await pg.evaluate("()=>{const e=document.querySelector('[data-ba=begin]'); e&&e.click()}"); await pg.wait_for_timeout(300)
        r = await pg.evaluate("""async([SC])=>{
          const S=window.__IR.S, sim=await import('./js/sim.js'), bt=await import('./js/battle.js'), EA=await import('./js/enemyai.js'), MO=await import('./js/morale.js'), T=await import('./js/tactics.js');
          S.paused=false; T.T.ff=false; T.T.ffOff=true; T.T.manual=false; S.speed=1; S.ffStep=null; const H=Math.hypot;
          const mob=t=>S.ships.filter(s=>s.team===t&&!s.dead&&!s.def.static&&!s.offField&&!s.def.fighter&&!s.def.shell);
          const cen=L=>[L.reduce((a,s)=>a+s.x,0)/L.length, L.reduce((a,s)=>a+s.y,0)/L.length];
          // even: the player brings only a squadron (no moonBreaker, no torchShips)
          if (SC.startsWith('even')) for (const s of mob(0)) if (['moonbreaker','torch'].includes(s.type)) { s.dead=true; s.offField=true; }
          S.ships=S.ships.filter(s=>!s.dead);
          const A0=mob(0), E0=mob(1); let ac=cen(A0), ec=cen(E0); const D0=SC.includes('far')?60000:24000; const d=H(ac[0]-ec[0],ac[1]-ec[1]), k=(d-D0)/d; for(const s of A0){s.x-=(ac[0]-ec[0])*k; s.y-=(ac[1]-ec[1])*k;}
          if (SC.includes('easy')) EA.plan().ctx.diff=0; if (SC.includes('hard')) EA.plan().ctx.diff=2; const att = SC.includes('attack'); if (att) { EA.plan().ctx.defending=false; const OPm=await import('./js/ops.js'); OPm.OP.orb=null; for (const s of S.ships) if (s.team===1&&s.def.static) { s.dead=true; } S.ships=S.ships.filter(s=>!s.dead); }
          if (!att) T.advance(); else for (const s of mob(0)) s.order={type:'idle',x:s.x,y:s.y};
          const val=L=>L.reduce((a,s)=>a+(s.def.value||50),0);
          const startV=[val(mob(0)), val(mob(1))];
          const M={idleHit:0, outNoFire:0, fired:new Set(), spreadAtContact:null, posts:{}};
          S.debugAI=[]; let t=0; const dt=1/30;
          const reachOf=s=>s.weapons.reduce((a,w)=>w.def.pd||w.def.nuke?a:Math.max(a,w.def.eff||w.def.range),0);
          while (t<600) {
            for(let k=0;k<30;k++){ sim.update(dt); bt.battleTick(dt); } t+=1;
            const E=mob(1), A=mob(0); if (!E.length||!A.length) break; if (MO.M.rout[1]!=null && t>(MO.M.rout[1]+40)) break; if (MO.M.rout[0]!=null) break;
            for (const s of E) { if (S.time-(s.lastFire??-99)<1.2) M.fired.add(s.id);
              const hit = S.time-Math.max(s.shHit??-99,s.lastHit??-99) < 1.5; if(!hit) continue;
              if (s.order.type==='idle' && !s.lying) M.idleHit++;
              const inR=A.some(f=>H(f.x-s.x,f.y-s.y)<reachOf(s)*1.05); if(!inR && S.time-(s.lastFire??-99)>2) M.outNoFire++; }
            if (M.spreadAtContact==null && T.T.contact) { const c=cen(E); M.spreadAtContact=Math.round(Math.max(...E.map(s=>H(s.x-c[0],s.y-c[1])))); }
            const p=EA.plan().post||'-'; M.posts[p]=(M.posts[p]||0)+1;
          }
          const endV=[val(mob(0)), val(mob(1))], war1=E0.filter(s=>s.weapons.length&&s.type!=='hauler'&&s.type!=='tender');
          return {t, lostA:startV[0]-endV[0], lostE:startV[1]-endV[1], startV, leftA:mob(0).length, leftE:mob(1).length, routE:MO.M.rout[1], routA:MO.M.rout[0],
            idleHit:M.idleHit, outNoFire:M.outNoFire, neverFired:war1.filter(s=>!M.fired.has(s.id)).length, spread:M.spreadAtContact, posts:M.posts, doc:MO.M.doc,
            trace:(S.debugAI||[]).filter((x,i,a)=>i===0||x.post!==a[i-1].post).slice(0,14).map(x=>`${Math.round(x.t)}:${x.post}${x.why?'('+x.why+')':''} r${x.ratio}`)};
        }""", [SC])
        r.update({'sc':SC,'ai':AI,'seed':SEED,'err':errs[:3]})
        print(json.dumps(r)); await b.close()
asyncio.run(main())
