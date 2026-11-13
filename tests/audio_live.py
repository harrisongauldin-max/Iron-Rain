"""Live audio test: the real AudioContext in headless Chrome. Opens the sound menu and plays every test sound, runs a
sandbox battle, then a campaign with its map theme, then a ground battle (open-even on Mars) from the Iron Rain.
Passes if there are no page errors and each scene played sounds with the right cue."""
import os, sys, asyncio
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)
ST = "async()=>{const A=await import('./js/audio.js'); return A.audioStats();}"
async def main():
    async with async_playwright() as p:
        b = await launch(p); pg = await b.new_page(viewport={'width': 1600, 'height': 900}); errs = []; fails = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(4000)
        # the sandbox battle
        await pg.evaluate("()=>{document.querySelector('[data-mode=sandbox]').click()}"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(2500)
        # the sound menu: every test sound and both score previews
        await pg.evaluate("()=>document.getElementById('bSnd').click()"); await pg.wait_for_timeout(200)
        n = await pg.evaluate("async()=>{const bs=[...document.querySelectorAll('#sndp [data-play]')]; for(const b of bs){b.click(); await new Promise(r=>setTimeout(r,120));} document.querySelector('#sndp [data-sp=cinematic]').click(); document.querySelector('#sndp [data-mu=battle]').click(); return bs.length;}")
        await pg.wait_for_timeout(3000); s = await pg.evaluate(ST); print('menu', n, 'buttons;', s)
        if n < 25 or not s or s['state'] != 'running' or s['cue'] != 'battle': fails.append(f'sound menu: {n} buttons, {s}')
        await pg.evaluate("()=>{document.querySelector('#sndp [data-mu=\"\"]').click(); document.querySelector('#sndp [data-sp=hull]').click(); document.querySelector('#sndp [data-sx=close]').click();}")
        # let the sandbox fight: speed it up, send everyone at the enemy
        await pg.evaluate("()=>{const S=window.__IR.S; S.paused=false; S.speed=4; const foe=S.ships.find(s=>s.team===1&&!s.dead); for(const s of S.ships) if(s.team===0&&!s.def.static&&foe) s.order={type:'amove',x:foe.x,y:foe.y};}")
        await pg.wait_for_timeout(8000)
        # and blasts where the camera looks: a missile's, a destroyer's, a reactor's, a nuke, an EMP, a shield and a hull hit
        await pg.evaluate("async()=>{const {S,fx}=window.__IR, A=await import('./js/audio.js'); const x=S.cam.x, y=S.cam.y, w=r=>new Promise(f=>setTimeout(f,r)); fx.explosion(x,y,0,0,6); await w(150); fx.explosion(x+200,y,0,0,30); await w(150); fx.explosion(x-200,y,0,0,60); await w(150); A.sfx('shhit',x,y,2); A.sfx('hit',x,y,3); A.sfx('throes',x,y,30); await w(150); fx.nukeBlast(x,y,0,0,1); }")
        await pg.wait_for_timeout(2000); best = await pg.evaluate(ST)
        print('sandbox', best)
        if not best or best['played'] < 5 or best['scene'] != 'space': fails.append(f'sandbox: {best}')
        # a campaign: the map theme, then a ground battle on Mars
        await pg.evaluate("()=>{window.__IR.S.gameState='menu'; document.getElementById('menu').classList.remove('hide'); document.querySelector('[data-mode=camp]').click()}"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(6000)
        await pg.evaluate("()=>document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'))"); await pg.wait_for_timeout(1500)
        s = await pg.evaluate(ST); print('campaign map', s)
        if not s or s['cue'] != 'map': fails.append(f'campaign map cue: {s}')
        await pg.set_viewport_size({'width': 480, 'height': 270})  # SwiftShader draws the ground war slowly
        await pg.evaluate("""async()=>{const GV=await import('./js/groundview.js'); const c={ world:'mars', att:{ f:'rep', shells:900, leech:9000, storks:12000 }, def:{ f:'soc', men:44000, fort:0, gun:1, shield:0, barracks:1 } };
          const spec={ world:c.world, storm:false, maxT:1800, att:{ ...c.att, cmdr:'Legatus', total:c.att.shells*6+c.att.leech+c.att.storks }, def:{ ...c.def, garrison:c.def.men, morale:1, cmdr:'The Legate' } };
          window.__gb = GV.fight(spec, { world:'Mars', attName:'Republic', defName:'Society' }); }""")
        await pg.wait_for_timeout(5000)
        await pg.evaluate("()=>{const b=document.querySelector('[data-g=rain]'); if(b) b.click();}")
        await pg.wait_for_timeout(5000); p0 = (await pg.evaluate(ST))['played']
        # SwiftShader runs the ground war too slowly to reach the fighting: sound the weapons where the units stand
        ears = await pg.evaluate("""async()=>{const A=await import('./js/audio.js'), GR=await import('./js/ground.js'), S=window.__IR.S, w=r=>new Promise(f=>setTimeout(f,r));
          const us=GR.G.units.filter(u=>u.men>0).slice(0,4), out=[]; for(const [i,k] of ['scorch','pulse','heavy','boom','rail','melee'].entries()){ const u=us[i%us.length]; A.sfx(k,u.x,u.y,18); out.push(S.groundEar(u.x,u.y).map(v=>Math.round(v*100)/100)); await w(120);} return out;}""")
        await pg.wait_for_timeout(1500); best = await pg.evaluate(ST)
        gs = await pg.evaluate("()=>window.__IR.S.gameState"); print('ground', gs, best, 'pan/dist', ears)
        if gs != 'ground' or not best or best['scene'] != 'ground' or best['played'] - p0 < 4 or abs(best['air'] - .85) > .01: fails.append(f'ground: {gs} {best} (played {best["played"] - p0} here)')
        await b.close()
        for e in errs[:8]: print(e)
        for f in fails: print('FAIL', f)
        print('audio live:', 'FAIL' if errs or fails else 'OK'); sys.exit(1 if errs or fails else 0)
asyncio.run(main())
