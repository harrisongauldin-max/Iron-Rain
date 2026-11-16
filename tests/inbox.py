"""Dispatch inbox test (U6).

  python3 tests/inbox.py

1. Tiers (inbox.js): a threat at a world of ours this week is "decide now"; a threat elsewhere that names one of our
   worlds is too; our own defeat report is "this week"; a routine report and anything from an earlier week is "for
   the record"; ticking one off moves it to "this week".
2. The panel: the old dispatch list is gone and the top-right panel is the Inbox. Folded, it shows the "to decide"
   and "this week" counts with the decide-now rows first, each with a ✓. Open (R), it has the three sections, each
   folding on a click. A row with a place selects it; ✓ moves the row down; the rail's Inbox entry is marked while
   anything waits.
3. Thirty weeks of the campaign on the model: no week has more than 8 decide-now items; prints the counts.
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

TIERS = """async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, IB=await import('./js/inbox.js'), {bodyOf}=await import('./js/solar.js');
  const me=C.player, cap=K.CAPITAL[me], capN=bodyOf(cap).name;
  const foe=Object.keys(C.worlds).find(id=>C.worlds[id].owner!==me && !C.fleets.some(f=>f.owner===me&&(f.at===id||(f.transit&&f.transit.to===id))));
  const foeN=bodyOf(foe).name, mk=(msg,cls,at,turn)=>({turn:turn??C.turn, msg, cls, at});
  const E={
    threat: mk(`Enemy fleet Ash Armada (The Society Remnant) has reached ${capN}!`,'bad',cap),
    siege: mk(`${capN} is under siege!`,'bad',cap),
    named: mk(`Ash Armada is massing at ${foeN}. Our agents believe the blow will fall on ${capN}.`,'bad',foe),
    elsewhere: mk(`Enemy fleet Ash Armada (The Society Remnant) has reached ${foeN}!`,'bad',foe),
    defeat: mk(`Defeat at ${capN}: our ships withdraw.`,'bad',cap),
    routine: mk(`The Rim Dominion defeats The Society Remnant at ${foeN}.`,'',foe),
    old: mk(`${capN} is under siege!`,'bad',cap,C.turn-3),
    mission: mk('New mission: hold the line.','gold',null) };
  const t={}; for(const k in E) t[k]=IB.tierOf(E[k]);
  IB.done(E.threat); t.ticked=IB.tierOf(E.threat);
  return t;}"""

async def main():
    errs = []
    async with async_playwright() as p:
        b = await launch(p)
        pg = await b.new_page(viewport={'width': 1600, 'height': 900})
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)[:300]))
        await pg.goto(URL); await pg.wait_for_timeout(3500)
        await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.getElementById('start').click()"); await pg.wait_for_timeout(4500)
        for _ in range(4):
            if await pg.evaluate("()=>document.getElementById('smodal').classList.contains('hide')"): break
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.mouse.move(800, 450)

        # 1. tiers
        t = await pg.evaluate(TIERS)
        exp = {'threat': 'now', 'siege': 'now', 'named': 'now', 'elsewhere': 'week', 'defeat': 'week', 'routine': 'record', 'old': 'record', 'mission': 'week', 'ticked': 'week'}
        for k, v in exp.items(): check(t.get(k) == v, f'tier: {k} is {v} ({t.get(k)})')

        # 2. the panel
        await pg.evaluate("""()=>{const K=window.__CAMP.K, C=window.__CAMP.C, cap=K.CAPITAL[C.player];
          K.note('The Rim Dominion defeats The Society Remnant at Io.', '', 'io');
          K.note('Enemy fleet Ash Armada (The Society Remnant) has reached our capital!', 'bad', cap);
          K.note('Our capital is under siege!', 'bad', cap);
}""")
        await pg.keyboard.press('l'); await pg.wait_for_timeout(200); await pg.keyboard.press('l'); await pg.wait_for_timeout(400)  # the list toggles redraw the map panels
        f = await pg.evaluate("""()=>{const el=document.getElementById('sfeed'); return {txt:el.innerText, now:el.querySelectorAll('.frow.ib-now').length, ok:el.querySelectorAll('.ibok').length,
          first:(el.querySelector('.frow')||{}).className||'', open:el.classList.contains('open'), urgent:el.classList.contains('urgent'),
          rail:(document.querySelector('#srail [data-a=feed]')||{}).className||'', railTxt:(document.querySelector('#srail [data-a=feed]')||{}).innerText||''}}""")
        check('Inbox' in f['txt'] or 'INBOX' in f['txt'], 'the top-right panel is the Inbox')
        check('Dispatches' not in f['txt'] and 'Inbox' in f['railTxt'], 'the old dispatch list is folded in (no "Dispatches" panel or rail entry)')
        check(not f['open'] and f['now'] >= 2 and f['ok'] == f['now'] and 'ib-now' in f['first'], f"folded: decide-now rows first, each with a ✓ ({f['now']} rows)")
        check('to decide' in f['txt'] and f['urgent'], 'folded: the "to decide" count and the red rim')
        check('pend' in f['rail'], 'the rail marks the Inbox while something waits')
        n0 = await pg.evaluate("async()=>(await import('./js/inbox.js')).counts().now")
        await pg.evaluate("()=>document.querySelector('#sfeed .ibok').click()"); await pg.wait_for_timeout(300)
        n1 = await pg.evaluate("async()=>(await import('./js/inbox.js')).counts().now")
        check(n1 == n0 - 1, f'✓ moves a row out of decide now ({n0} → {n1})')
        await pg.keyboard.press('r'); await pg.wait_for_timeout(400)
        o = await pg.evaluate("()=>{const el=document.getElementById('sfeed'); return {open:el.classList.contains('open'), heads:[...el.querySelectorAll('.ibh')].map(h=>h.dataset.ibf), rec:el.querySelectorAll('.frow.ib-record').length}}")
        check(o['open'] and o['heads'] == ['now', 'week', 'record'] and o['rec'] >= 1, f"open (R): the three sections ({o})")
        await pg.evaluate("()=>document.querySelector('#sfeed [data-ibf=record]').click()"); await pg.wait_for_timeout(300)
        rec = await pg.evaluate("()=>document.querySelectorAll('#sfeed .frow.ib-record').length")
        check(rec == 0, 'a section folds on a click')
        go = await pg.evaluate("()=>{const r=document.querySelector('#sfeed .frow[data-go] .fm'); if(!r) return null; const id=r.parentElement.dataset.go; r.click(); const s=window.__CAMP.V.sel; return [id, s&&s.w];}")
        check(go and go[0] == go[1], f'clicking a row selects its world ({go})')
        await pg.keyboard.press('r'); await pg.wait_for_timeout(300)
        # an ordinary week ends through the End button with the inbox in place
        await pg.evaluate("()=>document.querySelector('[data-a=end]').click()")
        t0 = await pg.evaluate("()=>window.__CAMP.C.turn")
        for _ in range(240):
            await pg.wait_for_timeout(250)
            st = await pg.evaluate("()=>({t:window.__CAMP.C.turn, busy:window.__CAMP.V.busy, up:!document.getElementById('smodal').classList.contains('hide')})")
            if st['up']:
                await pg.evaluate("()=>{for(const v of ['auto','ok','back','no','c0','yes']){const b=document.querySelector(`#smodal [data-m=\"${v}\"]`); if(b){b.click(); return;}} const b=document.querySelector('#smodal [data-m]'); if(b) b.click();}")
            elif st['t'] > t0 and not st['busy']: break
        check(await pg.evaluate("()=>/Inbox|INBOX/.test(document.getElementById('sfeed').innerText)"), 'after a week ends the Inbox redraws')

        # 3. volume over thirty weeks
        per = await pg.evaluate("""async()=>{const K=window.__CAMP.K, C=window.__CAMP.C, IB=await import('./js/inbox.js'); const out=[];
          for(let i=0;i<30&&!C.over;i++){ const cfs=K.endTurn(); for(const c of cfs) K.autoResolve(c); K.finishTurn(); const c=IB.counts(); out.push([c.now,c.week]); } return out;}""")
        print('decide now / this week, per week:', ' '.join(f'{a}/{b}' for a, b in per))
        check(max(a for a, b in per) <= 8, f'no week has more than 8 to decide (max {max(a for a, b in per)})')
        await b.close()
    for e in errs: print(e)
    check(not errs, 'no page errors')
    print('PASS' if not FAILS else f'{len(FAILS)} FAILED'); sys.exit(1 if FAILS else 0)

if __name__ == '__main__':
    asyncio.run(main())
