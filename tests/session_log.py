"""Session log test (U7).

  python3 tests/session_log.py

1. Off by default: opening screens, pressing hotkeys and ending a week through the real UI records nothing
   (no 'ironrain.sessionlog' in localStorage, nothing in the log module).
2. Turned on from the campaign menu (Menu > Session log > Start recording): it records the screens opened and
   for how long, the hotkeys, the week's length and how the player's battles were settled.
3. Export JSON from the same screen downloads a file whose summary has turns, screens, battles and neverUsed.
4. Turned off again: more clicks and another week add nothing. The ⚙ panel's Session log button toggles it too.
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

MODAL_UP = "()=>!document.getElementById('smodal').classList.contains('hide')"
async def click_m(pg, v):
    return await pg.evaluate(f"()=>{{const b=document.querySelector('#smodal [data-m=\"{v}\"]'); if(!b) return false; b.click(); return true;}}")

# ends the week through the End button and clears whatever the week throws up: battles auto-resolve, cards take their first answer
async def end_week(pg):
    t0 = await pg.evaluate("()=>window.__CAMP.C.turn")
    await pg.evaluate("()=>document.querySelector('[data-a=end]').click()")
    for _ in range(240):
        await pg.wait_for_timeout(250)
        st = await pg.evaluate("()=>({t:window.__CAMP.C.turn, busy:window.__CAMP.V.busy, up:!document.getElementById('smodal').classList.contains('hide')})")
        if st['up']:
            for v in ['auto', 'ok', 'back', 'no', 'c0', 'yes']:
                if await click_m(pg, v): break
            else: await pg.evaluate("()=>{const b=document.querySelector('#smodal [data-m]'); if(b) b.click();}")
        elif st['t'] > t0 and not st['busy']: return True
        if await pg.evaluate("()=>window.__IR && window.__IR.S.gameState!=='strat'"):  # a battle screen: auto-resolve it
            await pg.evaluate("()=>{const b=document.querySelector('[data-ba=auto],#bAuto'); if(b) b.click();}")
    return False

async def open_screens(pg):
    await pg.evaluate("()=>document.querySelector('#srail [data-a=faction]').click()"); await pg.wait_for_timeout(1300)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.mouse.move(800, 450)
    await pg.keyboard.press('h'); await pg.wait_for_timeout(700)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.keyboard.press('l'); await pg.wait_for_timeout(300); await pg.keyboard.press('l'); await pg.wait_for_timeout(200)

STATE = "async()=>{const SL=await import('./js/sessionlog.js'); return {on:SL.isOn(), stored:localStorage.getItem('ironrain.sessionlog'), counts:SL.counts(), sum:SL.summary()};}"

async def main():
    errs = []
    async with async_playwright() as p:
        b = await launch(p)
        ctx = await b.new_context(accept_downloads=True, viewport={'width': 1600, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)[:300]))
        await pg.goto(URL); await pg.wait_for_timeout(500)
        await pg.evaluate("()=>{localStorage.removeItem('ironrain.sessionlog'); localStorage.setItem('ironrain.opts', JSON.stringify({}))}")
        await pg.reload(); await pg.wait_for_timeout(3500)
        await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4500)
        for _ in range(4):
            if not await pg.evaluate(MODAL_UP): break
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.mouse.move(800, 450)

        # 1. off: nothing recorded
        await open_screens(pg)
        check(await end_week(pg), 'off: a week ends through the End button')
        s = await pg.evaluate(STATE)
        check(not s['on'], 'off by default')
        check(s['stored'] is None and s['counts'] is None, f"off: nothing recorded (stored={s['stored'] and len(s['stored'])}, counts={s['counts']})")

        # 2. on, from the campaign menu
        await pg.evaluate("()=>document.querySelector('[data-a=menu]').click()"); await pg.wait_for_timeout(300)
        check(await click_m(pg, 'slog'), 'the campaign menu has a Session log button')
        await pg.wait_for_timeout(300)
        check(await click_m(pg, 'toggle'), 'Start recording')
        await pg.wait_for_timeout(300)
        txt = await pg.evaluate("()=>document.getElementById('smodal').innerText")
        check('recording' in txt.lower(), 'the Session log screen says it is recording')
        await click_m(pg, 'back'); await pg.wait_for_timeout(300)
        opts = await pg.evaluate("()=>JSON.parse(localStorage.getItem('ironrain.opts')||'{}')")
        check(opts.get('sessionLog') is True, 'the setting is saved with the options')
        await open_screens(pg)
        await pg.wait_for_timeout(1200)  # some thinking time this week
        check(await end_week(pg), 'on: a week ends through the End button')
        await pg.wait_for_timeout(1200)  # let the log save
        s = await pg.evaluate(STATE); sm = s['sum'] or {}
        sc = sm.get('screens', {})
        check(s['stored'] is not None, 'on: the log is kept in localStorage')
        check(sc.get('faction', {}).get('opens', 0) >= 1 and sc['faction']['secs'] >= 1, f"faction screen: opens and seconds ({sc.get('faction')})")
        check(sc.get('ledger', {}).get('opens', 0) >= 1, f"ledger opened by its hotkey ({sc.get('ledger')})")
        check(sc.get('list', {}).get('opens', 0) >= 2, f"list toggled by L ({sc.get('list')})")
        check((sm.get('keys') or {}).get('h', 0) >= 1, 'hotkeys counted')
        tu = sm.get('turns') or {}
        check(tu.get('n', 0) >= 1 and tu.get('max', 0) >= 1, f"the week's length recorded ({tu})")
        check('neverUsed' in sm and 'faction' not in sm['neverUsed']['screens'] and 'tech' in sm['neverUsed']['screens'], f"neverUsed lists the unopened screens ({sm.get('neverUsed')})")
        # a battle settled in the battle loop is logged by how (driven on the model so one is sure to come up)
        bt = await pg.evaluate("""async()=>{const SL=await import('./js/sessionlog.js'), C=window.__CAMP.C, K=window.__CAMP.K, me=C.player;
          SL.battle('auto', {world:'mars', att:me, def:'soc'}, {attWin:true}); SL.battle('sure', {world:'luna', att:'soc', def:me}, {attWin:false}); SL.parley('demand');
          return SL.summary();}""")
        check(bt['battles']['total'] >= 2 and bt['battles']['autoResolved'] >= 2 and bt['parley'].get('demand') == 1, f"battles and parley picks counted ({bt['battles']}, {bt['parley']})")

        # 3. export
        await pg.evaluate("()=>document.querySelector('[data-a=menu]').click()"); await pg.wait_for_timeout(300)
        await click_m(pg, 'slog'); await pg.wait_for_timeout(300)
        async with pg.expect_download() as dl:
            await click_m(pg, 'export')
        d = await dl.value
        path = await d.path()
        j = json.load(open(path))
        check(d.suggested_filename.startswith('ironrain-session-') and d.suggested_filename.endswith('.json'), f'exported file name ({d.suggested_filename})')
        check(j.get('kind') == 'session-log' and all(k in j['summary'] for k in ['turns', 'screens', 'battles', 'neverUsed', 'keys']) and len(j['events']) > 5 and j['summary']['screens'].get('menu', {}).get('opens', 0) >= 1, f"export (the menu counts as a screen) has the summary and events ({list(j.get('summary', {}).keys())}, {len(j.get('events', []))} events)")
        # 4. off again
        check(await click_m(pg, 'toggle'), 'Stop recording'); await pg.wait_for_timeout(300)
        await click_m(pg, 'back'); await pg.wait_for_timeout(300)
        before = await pg.evaluate(STATE)
        await open_screens(pg)
        check(await end_week(pg), 'off again: a week ends')
        await pg.wait_for_timeout(1200)
        after = await pg.evaluate(STATE)
        check(not after['on'] and after['stored'] == before['stored'] and after['counts'] == before['counts'], 'off again: nothing more recorded')
        # the ⚙ panel toggle
        on = await pg.evaluate("async()=>{const SL=await import('./js/sessionlog.js'); document.getElementById('bSlog').click(); const a=SL.isOn(), c=document.getElementById('bSlog').classList.contains('on'); document.getElementById('bSlog').click(); return [a, c, SL.isOn()];}")
        check(on == [True, True, False], f'the options panel Session log button toggles it ({on})')
        await b.close()
    for e in errs: print(e)
    check(not errs, 'no page errors')
    print('PASS' if not FAILS else f'{len(FAILS)} FAILED'); sys.exit(1 if FAILS else 0)

if __name__ == '__main__':
    asyncio.run(main())
