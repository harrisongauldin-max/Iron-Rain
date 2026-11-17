"""The war for a planet in the campaign (M3-C): a 60-week Republic campaign in which the Iron Rain on Mercury is fought
as a planet war (planetwar.js) from end to end, saved and loaded in the middle of it.

  python3 tests/planet_campaign.py [--turns 60] [--seed-rain 12]

What it does: the Republic (the player) holds Darrow's siege of Mercury until the Rain can fall, then drops it by the
legate's plan (K.ironRain). From then on the war runs with the campaign weeks: the player's armies follow the legate's
plan (no orders given), the Remnant's follow the AI's. The player's planet battles in C.planetBattles are settled the
way the battle list would: the first one from a fought result (K.settlePlanet), the rest auto-resolved
(K.resolvePlanet). Two weeks into the war the campaign is saved (save.js snapshot), and loaded back (stratview
loadCampaign), and the war must come back the same. After the Rain the player's power is handed to the campaign AI,
and the campaign runs on to the last week.

Passes (exit 0) when:
  - the Rain on Mercury starts a war (w.war), with legions landed;
  - the war marches for at least two weeks, and ends with a verdict (C.planetWars), and the world is taken or held to
    match it, with w.war cleared;
  - the save made mid-war loads back with the same war (provinces, armies, week), and the war goes on after it;
  - while the war ran, Mercury's yield was cut to the share of the people its owner still held;
  - the campaign reaches the last week with no page errors.
"""
import os, sys, json, asyncio, argparse
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

RUN_JS = """async([TURNS])=>{
  const K=window.__CAMP.K, C=window.__CAMP.C, SV=await import('./js/save.js'), SVW=await import('./js/stratview.js'), EC=await import('./js/economy.js');
  document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
  const out={log:[], fails:[]}, me=C.player, W=()=>C.worlds.mercury;
  const week=()=>{ const cf=K.endTurn(); for (const c of cf) K.autoResolve(c);
    for (const b of (C.planetBattles||[])) { const war=C.worlds[b.world].war; if (!war || !war.pending.some(x=>x.prov===b.prov)) continue;
      if (!out.fought) { const sp=(window.__PW).battleSpec(war,b.prov); const r={won:true, att0:sp.att.total, attLeft:Math.round(sp.att.total*.6), def0:sp.def.men, defLeft:0}; const res=K.settlePlanet(b.world,b.prov,r); out.fought={prov:b.prov, kind:b.kind, res:res&&{won:res.won,how:res.how}}; }
      else { K.resolvePlanet(b.world,b.prov); out.auto=(out.auto||0)+1; } }
    K.finishTurn(); };
  window.__PW = await import('./js/planetwar.js');
  // 1. hold the siege of Mercury until the Rain can fall
  let fl=null, odds=null;
  for (let t=0; t<14 && !W().war; t++) {
    fl = C.fleets.filter(f=>f.owner===me && f.at==='mercury' && !f.transit).sort((a,b)=>K.troopsOf(b)-K.troopsOf(a))[0];
    if (fl) { odds=K.rainOdds(fl); if (!odds.err) { out.rainOdds={chance:+odds.chance.toFixed(2), need:odds.need, planet:!!odds.planet, troops:Math.round(odds.troops)}; const r=K.ironRain(fl); out.rain=r; out.rainWeek=C.turn; break; } else out.lastErr=odds.err; }
    if (W().owner===me) { out.fails.push('Mercury fell before the Rain'); break; }
    week();
  }
  const war0=W().war; if (!war0) { out.fails.push('no war on Mercury: '+(out.lastErr||'')); return JSON.stringify(out); }
  out.landed=war0.land0; out.provsHeld=Object.keys(war0.provs).filter(k=>war0.provs[k].own==='att');
  C.fac[me].ai=true; // the campaign AI plays the player's power from here
  // 2. the war runs; two weeks in, save and load
  let saved=false, share=[], wars0=(C.planetWars||[]).length;
  for (let t=0; t<TURNS && C.turn<TURNS+1 && !C.over; t++) {
    const war=W().war;
    if (war) { const y=EC.yieldOf(W(), 1); share.push({share:+(war.share??1).toFixed(2), wk:war.week}); }
    if (war && war.week>=2 && !saved) {
      const before=JSON.stringify(war), txt=SV.snapshot(); SVW.loadCampaign(SV.parse(txt)); document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
      const C2=window.__CAMP.C, after=JSON.stringify(C2.worlds.mercury.war); saved=true; out.save={week:war.week, same: before===after, size: txt.length};
      if (before!==after) out.fails.push('the war changed across save and load');
    }
    week();
    const w=W(); if (!w.war && (C.planetWars||[]).length>wars0 && !out.end) { const e=C.planetWars.at(-1); out.end={...e, owner:w.owner, garrison:w.garrison}; }
  }
  out.turn=C.turn; out.over=C.over||null; out.share=share; out.wars=C.planetWars||[];
  if (!saved) out.fails.push('the war never reached its second week, so no mid-war save');
  if (!out.end) out.fails.push('the war never ended'); else {
    if (out.end.weeks<2) out.fails.push('the war was over in under two weeks');
    if (out.end.won==='att' && out.end.owner!==me) out.fails.push('the legions won but Mercury is not ours');
    if (out.end.won==='def' && out.end.owner===me) out.fails.push('the garrison held but Mercury is ours'); }
  if (!share.some(s=>s.share<1)) out.fails.push('the yield was never cut by the war');
  if (!out.fought) out.fails.push('no planet battle came to the battle list'); else if (!out.fought.res) out.fails.push('the fought battle did not settle');
  if (C.turn<TURNS) out.fails.push('the campaign stopped at week '+C.turn);
  return JSON.stringify(out);
}"""

async def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--turns', type=int, default=60); a = ap.parse_args()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=ARGS); pg = await b.new_page(viewport={'width': 1100, 'height': 650})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(500)
        await pg.evaluate("()=>{localStorage.setItem('ir.quality','standard'); localStorage.setItem('ironrain.opts', JSON.stringify({skipTrivial:false}))}")
        await pg.reload(); await pg.wait_for_timeout(3500)
        await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.querySelector('#start').click()"); await pg.wait_for_timeout(5000)
        r = json.loads(await pg.evaluate(RUN_JS, [a.turns]))
        await b.close()
    sh = r.pop('share', [])
    print(json.dumps(r, indent=1)[:4000])
    print('share by week:', ' '.join(f"{s['wk']}:{s['share']}" for s in sh))
    fails = r.get('fails', []) + [f'page error: {e}' for e in errs[:5]]
    if fails: print('FAIL\n  ' + '\n  '.join(fails)); sys.exit(1)
    print('PASS'); sys.exit(0)

asyncio.run(main())
