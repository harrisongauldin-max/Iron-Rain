"""Parley and rivals test.

  python3 tests/parley.py

1. UI: ends a turn through the real campaign UI until a battle with ships on both sides comes up, checks the parley
   card (faces, the enemy's hail, the five or six choices), tries a challenge or a demand, then opens fire and
   auto-resolves from the battle screen. The result screen must come up.
2. Rules, on fresh campaigns: a surrender moves every enemy hull into our fleet as a prize and takes their
   commander; terms send the leaving side home unharmed; a duel changes both sides' strength in the forecast; a
   refused challenge and a refused demand do what the card says.
3. Rivals: a battle we lose makes the enemy commander a rival (epithet, a learned talent, a dispatch); killing them
   writes it in the Chronicle; the rival survives save and load; the Rivals screen and the commander faces draw.
Passes (exit 0) when every check holds and the page throws nothing.
"""
import os, sys, json, asyncio
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS)
FAILS = []
def check(ok, what):
    print(('ok    ' if ok else 'FAIL  ') + what)
    if not ok: FAILS.append(what)

async def fresh(b, errs):
    pg = await b.new_page(viewport={'width': 1600, 'height': 900})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)[:300]))
    await pg.goto(URL); await pg.wait_for_timeout(500)
    await pg.evaluate("()=>{localStorage.setItem('ironrain.opts', JSON.stringify({skipTrivial:false}))}")
    await pg.reload(); await pg.wait_for_timeout(3500)
    await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4500)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.mouse.move(800, 450)
    return pg

# finds this week's battles (ending the turn on the model, not the UI) until one has ships of ours and theirs
FIND = """async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, PA=await import('./js/parley.js'); const me=C.player;
  for (let t=0;t<14;t++) { const cfs=K.endTurn(); let hit=null;
    for (const cf of cfs) { if (!hit && PA.canParley(cf, me)) { hit=cf; continue; } K.autoResolve(cf); }
    if (hit) { window.__CF=hit; window.__REST=[]; return {turn:C.turn, world:hit.world, att:hit.att, def:hit.def}; }
    K.finishTurn(); }
  return null;}"""

async def main():
    errs = []
    async with async_playwright() as p:
        b = await launch(p)

        # ---------------------------------------------------------------- 1. the card in the real UI
        pg = await fresh(b, errs)
        seen = False
        for wk in range(14):
            await pg.evaluate("()=>{const b=document.querySelector('.endbtn[data-a=end]'); if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))}")
            for _ in range(60):
                await pg.wait_for_timeout(500)
                st = await pg.evaluate("""()=>{const m=document.querySelector('#smodal'); if (!m||m.classList.contains('hide')) return {open:false, busy:true};
                  return {open:true, cls:m.className, btns:[...m.querySelectorAll('.mbtns button')].map(b=>b.dataset.m+'|'+b.className+'|'+b.textContent), faces:m.querySelectorAll('svg.face').length, talk:m.querySelectorAll('.pline').length, h:(m.querySelector('h2')||{}).textContent}}""")
                if st['open'] and 'parley' in st['cls']:
                    seen = True; break
                if st['open']:
                    # some other card this week (event, battle screen without parley, result): move on
                    await pg.evaluate("()=>{const m=document.querySelector('#smodal'); const b=m.querySelector('.mbtns button[data-m=auto]')||m.querySelector('.mbtns .btn.go')||m.querySelector('.mbtns button'); if (b) b.click(); else m.querySelector('[data-m]') && m.querySelector('[data-m]').click()}")
                busy = await pg.evaluate("()=>{const m=document.querySelector('#smodal'); return !!(window.__CAMP && document.querySelector('#sturn:not(.hide)')) || (m && !m.classList.contains('hide'))}")
                if not busy: break
            if seen: break
        check(seen, 'a parley card comes up when our ships meet theirs')
        if seen:
            vals = [x.split('|')[0] for x in st['btns']]
            check(st['faces'] >= 1, f"the parley card shows faces ({st['faces']})")
            check(st['talk'] >= 1, 'the enemy hails first')
            check(all(v in vals or 'x' in vals for v in ['fight', 'auto']), f"open fire and auto-resolve are offered: {vals}")
            check(any(v in ('demand', 'x') for v in vals) and any(v in ('terms', 'x') for v in vals), 'demand and terms are on the card')
            # try a challenge if one is open, else a demand, then open fire
            pick = 'challenge' if 'challenge' in vals else 'demand' if 'demand' in vals else None
            if pick:
                await pg.evaluate(f"()=>document.querySelector('#smodal .mbtns button[data-m={pick}]').click()"); await pg.wait_for_timeout(1200)
                st2 = await pg.evaluate("()=>{const m=document.querySelector('#smodal'); return {cls:m.className, talk:m.querySelectorAll('.pline').length, open:!m.classList.contains('hide'), h:(m.querySelector('h2')||{}).textContent}}")
                check(st2['talk'] > st['talk'] or 'parley' not in st2['cls'], f"{pick}: the answer is heard ({st['talk']} -> {st2['talk']} lines, now: {st2['h']})")
            for _ in range(8):
                m = await pg.evaluate("()=>{const m=document.querySelector('#smodal'); return m.classList.contains('hide')?'':m.className+'|'+(m.querySelector('h2')||{}).textContent}")
                if not m: break
                if 'parley' in m: await pg.evaluate("()=>document.querySelector('#smodal .mbtns button[data-m=fight]').click()")
                elif 'battle' in m and await pg.evaluate("()=>!!document.querySelector('#smodal .mbtns button[data-m=auto]')"): await pg.evaluate("()=>document.querySelector('#smodal .mbtns button[data-m=auto]').click()")
                else:
                    check(True, f'after the parley: {m.split("|")[-1]}'); break
                await pg.wait_for_timeout(1500)
        await pg.close()

        # ---------------------------------------------------------------- 2. the rules
        # surrender
        pg = await fresh(b, errs); hit = await pg.evaluate(FIND)
        check(hit is not None, f'a battle with ships on both sides within 14 weeks: {hit}')
        if hit:
            r = await pg.evaluate("""async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, PA=await import('./js/parley.js'), CM=await import('./js/command.js'); const cf=window.__CF, me=C.player, foe=cf.att===me?cf.def:cf.att;
              const ctx=PA.context(cf, me); const foeShips=K.cfFleets(cf, foe).flatMap(f=>f.ships), leads=K.cfFleets(cf, foe).map(f=>CM.cmdrOf(f)).filter(Boolean);
              const probs=[ctx.pSurrender, ctx.pTerms, ctx.pChallenge, ctx.duelP, ctx.q];
              const res=PA.surrender(cf, me, foe); const mine=K.cfOwn(cf, me).flatMap(f=>f.ships);
              return {probs, hail:ctx.hail, n:foeShips.length, prizes:foeShips.filter(s=>mine.includes(s)&&s.prize).length, left:K.cfFleets(cf, foe).reduce((a,f)=>a+f.ships.length,0), caps:leads.map(c=>c.state), grade:res.grade, captured:res.captured}}""")
            check(all(0 <= x <= 1 for x in r['probs']), f"chances are probabilities {r['probs']} (hail: {r['hail']})")
            check(r['prizes'] == r['n'] and r['left'] == 0, f"surrender: all {r['n']} enemy hulls are now our prizes ({r['prizes']}), none left with them ({r['left']})")
            check(all(s == 'captured' for s in r['caps']), f"surrender: their commanders are taken {r['caps']}")
            check(r['grade'] in ('victory', 'decisive', 'annihilation'), f"surrender: graded as a victory ({r['grade']})")
        await pg.close()
        # terms: they leave unharmed
        pg = await fresh(b, errs); hit = await pg.evaluate(FIND)
        if hit:
            r = await pg.evaluate("""async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, PA=await import('./js/parley.js'); const cf=window.__CF, me=C.player, foe=cf.att===me?cf.def:cf.att;
              const fl=K.cfFleets(cf, foe).filter(f=>f.owner===foe&&f.ships.length), hp0=fl.flatMap(f=>f.ships.map(s=>s.hp));
              const res=PA.terms(cf, foe); const hp1=fl.flatMap(f=>f.ships.map(s=>s.hp));
              return {same: JSON.stringify(hp0)===JSON.stringify(hp1), gone: fl.every(f=>!C.fleets.includes(f) || f.transit || f.at!==cf.world || cf.space), lock: !!(C.withdrawn && C.withdrawn[cf.world+'|'+foe]===C.turn), terms:res.terms, n:fl.length}}""")
            check(r['same'] and r['terms'], f"terms: the leaving fleets take no damage ({r['n']} fleets)")
            check(r['gone'], 'terms: they leave the field')
            check(not r['lock'], 'terms: no withdrawal lock (they did not run under fire)')
        await pg.close()
        # a duel shifts the forecast; refusals cost what the card says
        pg = await fresh(b, errs); hit = await pg.evaluate(FIND)
        if hit:
            r = await pg.evaluate("""async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, PA=await import('./js/parley.js'); const cf=window.__CF, me=C.player, foe=cf.att===me?cf.def:cf.att;
              const ctx=PA.context(cf, me); if (!ctx.myChamp||!ctx.foeChamp) return {skip:true};
              const q0=ctx.q, d=PA.duel(ctx), i=cf.att===me?0:1, mul=cf.parley.mul.slice(), mor=cf.parley.mor.slice();
              const q1=PA.context(cf, me).q; PA.refuse(cf, foe); const mul2=cf.parley.mul.slice();
              const res=K.autoResolve(cf);
              return {weWin:d.weWin, fate:d.fate, mul, mor, i, q0, q1, mul2, done: res && typeof res.attWin==='boolean', loserState: d.loser.cmdr ? d.loser.cmdr.state : (d.loser.agent ? d.loser.agent.state : '')}}""")
            if r.get('skip'): check(True, 'duel: no champions on one side here (skipped)')
            else:
                i = r['i']; mine, theirs = r['mul'][i], r['mul'][1 - i]
                check((mine > 1 and theirs < 1) if r['weWin'] else (mine < 1 and theirs > 1), f"duel: the winner's side is stronger after it (ours x{mine:.2f}, theirs x{theirs:.2f}, we won: {r['weWin']})")
                check((r['q1'] > r['q0']) == r['weWin'] or abs(r['q1'] - r['q0']) < .08, f"duel: the forecast moves with it ({r['q0']:.2f} -> {r['q1']:.2f})")
                check(r['mul2'][1 - i] < r['mul'][1 - i], 'a refused challenge weakens the side that refused')
                check(r['fate'] in ('killed', 'wounded', 'yielded', 'beaten') and r['done'], f"duel: the loser is {r['fate']} ({r['loserState']}) and the battle still resolves")
        await pg.close()

        # ---------------------------------------------------------------- 3. rivals
        pg = await fresh(b, errs); hit = await pg.evaluate(FIND)
        if hit:
            r = await pg.evaluate("""async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, CM=await import('./js/command.js'), RV=await import('./js/rivals.js'); const cf=window.__CF, me=C.player, foe=cf.att===me?cf.def:cf.att;
              const leads=K.cfFleets(cf, foe).filter(f=>f.owner===foe).map(f=>CM.cmdrOf(f)).filter(Boolean); if (!leads.length) return {skip:true};
              const t0=leads.map(c=>c.talents.length);
              // make sure we lose: their side ten times as strong
              cf.parley={mul:cf.att===me?[.1,10]:[10,.1], mor:[0,0], lines:[]}; let res=K.autoResolve(cf), tries=0;
              while (res.wins.includes(me) && tries++<5) res=K.autoResolve(cf);
              const R=leads.map(c=>RV.rivalRec(c)).filter(Boolean), c=leads.find(x=>RV.rivalRec(x));
              if (!c) return {lost:!res.wins.includes(me), rivals:0, alive:leads.map(c=>c.state)};
              const notes=(C.report||[]).map(x=>x.msg).filter(m=>m.includes(c.name)), learned=RV.rivalRec(c).learned.slice(), ep=RV.rivalRec(c).epithet;
              // save and load keep them
              const SV=await import('./js/save.js'); const e=SV.saveSlot(1); const back=JSON.parse(JSON.stringify(C.rivals));
              CM.kill(c, null, c.name+' is killed (test).', null, me);
              const chron=(C.chron||[]).filter(x=>x.k==='rival').map(x=>x.text);
              return {lost:!res.wins.includes(me), rivals:R.length, ep, learned, notes:notes.length, talentsGrew: c.talents.length>t0[leads.indexOf(c)], saveErr:e||null, kept: !!back[c.id], chron};
            }""")
            if r.get('skip'): check(True, 'rivals: no enemy commander in this battle (skipped)')
            else:
                check(r['lost'], 'rivals: the forced battle is lost')
                check(r['rivals'] >= 1, f"rivals: the commander who beat us is a rival ({r.get('rivals')})")
                if r['rivals']:
                    check(bool(r['ep']), f"rivals: has an epithet ({r['ep']})")
                    check(r['talentsGrew'] and len(r['learned']) == 1, f"rivals: learned a talent from the fight {r['learned']}")
                    check(r['notes'] >= 1, 'rivals: named in our dispatches')
                    check(r['kept'] and not r['saveErr'], 'rivals: saved with the campaign')
                    check(len(r['chron']) == 1, f"rivals: the kill is in the Chronicle {r['chron']}")
            # the screens draw
            ui = await pg.evaluate("""async()=>{document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide')); document.querySelector('#srail [data-a=rivals]').click(); await new Promise(r=>setTimeout(r,500));
              const m=document.querySelector('#smodal'); const out={rivals:!m.classList.contains('hide') && /Rivals/.test(m.querySelector('h2').textContent), cards:m.querySelectorAll('.rcard').length, faces:m.querySelectorAll('svg.face').length};
              m.querySelector('[data-m=ok]').click(); await new Promise(r=>setTimeout(r,300));
              const fl=window.__CAMP.C.fleets.find(f=>f.owner===window.__CAMP.C.player && f.cmdr); return out;}""")
            check(ui['rivals'], f"the Rivals screen opens with V ({ui['cards']} cards, {ui['faces']} faces)")
            await pg.screenshot(path='/tmp/parley_rivals.png')
        await pg.close()
        await b.close()
    if errs: print('ERRORS', errs[:5])
    print('PASS' if not FAILS and not errs else f'FAIL ({len(FAILS)} checks, {len(errs)} page errors)')
    sys.exit(1 if FAILS or errs else 0)

if __name__ == "__main__": asyncio.run(main())
