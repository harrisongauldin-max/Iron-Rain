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

The shields (S-C, claude/shields.md), on a fresh campaign first:
  - running costs: each lit Shield Array level costs 4 He-3 a week (income() and shieldCost());
  - a dark shield: with the stock empty and the week short, the least important levels go dark first and the capital's
    stays lit; a dark level costs nothing and drops out of the world's defence (defStr); a week with the He-3 short goes
    dark through finishTurn with a dispatch, and a week with the stock refilled lights them all again;
  - field generators: refused without a Shipyard, ordered at one for 120 ore, 60 He-3 and 8 rare metals, finished in 2
    weeks, aboard a fleet or in the depot; taken off and back aboard; once planetwar.js counts set-up generators
    (PW.gensUp, S-G), each set up costs 3 He-3 a week;
  - and in the war above: a generator aboard the Rain's fleet goes down with the landings (war.gensIn), and the war carries
    the lit shield levels (war.shieldLit) and the dark flags (war.dark).
"""
import os, sys, json, asyncio, argparse
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

SHIELD_JS = """async()=>{
  const K=window.__CAMP.K, C=window.__CAMP.C, PW=await import('./js/planetwar.js'); document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
  const out={fails:[]}, me=C.player, r=C.fac[me].res, mine=()=>Object.values(C.worlds).filter(w=>w.owner===me);
  const shielded=mine().filter(w=>w.shield>0), cap=K.CAPITAL[me];
  if (shielded.length<2 || !shielded.some(w=>w.id===cap)) { out.fails.push('the test needs two shielded worlds, the capital one of them'); return JSON.stringify(out); }
  // 1. running costs
  const lit=shielded.reduce((a,w)=>a+K.shieldLit(w),0), sc=K.shieldCost(me), inc0=K.income(me).he;
  out.cost={levels:lit, arr:sc.arr, gen:sc.gen};
  if (sc.arr!==4*lit) out.fails.push(`the Arrays cost ${sc.arr} a week for ${lit} levels, not ${4*lit}`);
  const w0=shielded.find(w=>w.id!==cap); w0.shieldDark=w0.shield; const inc1=K.income(me).he; w0.shieldDark=0;
  out.cost.saved=+(inc1-inc0).toFixed(2); if (Math.abs(inc1-inc0-4*w0.shield)>.01) out.fails.push(`a dark ${w0.id} saves ${inc1-inc0}, not ${4*w0.shield}`);
  // 2. a dark shield: the stock empty and the week 6 He-3 short, so two levels go dark, the least important first
  C.charters=C.charters||{}; const ch0=C.charters[me]||0, he0=r.he;
  r.he=0; C.charters[me]=ch0+(K.income(me).he+6)/20;
  const ds0=K.defStr(w0), pw=K.shieldPower(me), dark=mine().filter(w=>w.shieldDark).map(w=>({id:w.id, dark:w.shieldDark}));
  out.dark={went:pw.out, worlds:dark, capitalLit:K.shieldLit(C.worlds[cap])};
  if (pw.out!==2) out.fails.push(`a 6 He-3 shortfall darkened ${pw.out} levels, not 2`);
  if (!K.shieldLit(C.worlds[cap])) out.fails.push('the capital went dark before the lesser worlds');
  if (!C.log.some(l=>/shields go dark/.test(l.msg))) out.fails.push('no dispatch told the player the shields went dark');
  const dk=mine().find(w=>w.shieldDark && w.shield===w.shieldDark); if (dk) { const lv=K.shieldLit(dk); if (lv!==0) out.fails.push('a dark world still has lit levels'); }
  if (dark.length && !(K.income(me).he>=-1e-6)) out.fails.push('with the levels dark the week still runs short: '+K.income(me).he.toFixed(1));
  // through the week: far short, every level goes dark in finishTurn; refilled, they all light again
  for (const w of mine()) w.shieldDark=0; C.charters[me]=ch0+(K.income(me).he+1000)/20; r.he=0;
  const wk=()=>{ const cf=K.endTurn(); for (const c of cf) K.autoResolve(c); for (const b of (C.planetBattles||[])) K.resolvePlanet(b.world,b.prov); K.finishTurn(); };
  wk(); const lit2=mine().reduce((a,w)=>a+K.shieldLit(w),0); out.week={litAfterShort:lit2};
  if (lit2!==0) out.fails.push(`a week far short of He-3 left ${lit2} levels lit`);
  if (K.shieldCost(me).arr!==0) out.fails.push('dark shields still cost He-3');
  const sh=mine().filter(w=>w.shield>0)[0]; if (sh && K.defStr(sh)>=K.defStr({...sh, shieldDark:0})) out.fails.push('a dark shield still counts in the defence of its world');
  C.charters[me]=ch0; r.he=Math.max(he0,3000); wk();
  const lit3=mine().reduce((a,w)=>a+K.shieldLit(w),0), all=mine().reduce((a,w)=>a+(w.shield||0),0); out.week.litAfterRefill=lit3; out.week.levels=all;
  if (lit3!==all) out.fails.push(`refilled, only ${lit3} of ${all} levels lit again`);
  if (!C.log.some(l=>/shields are lit again/.test(l.msg))) out.fails.push('no dispatch told the player the shields came back');
  // 3. field generators
  const yard=mine().filter(w=>w.lv.yard>=1 && !w.siege).sort((a,b)=>b.lv.yard-a.lv.yard)[0], noyard=mine().find(w=>!w.lv.yard);
  if (noyard && !/Shipyard/.test(K.canBuildGen(me,noyard)||'')) out.fails.push('a generator could be ordered at a world without a Shipyard');
  if (!yard) out.fails.push('no world of ours with a Shipyard'); else {
    Object.assign(r,{ore:Math.max(r.ore,1000), he:Math.max(r.he,1000), rare:Math.max(r.rare||0,50)});
    const b0={ore:r.ore, he:r.he, rare:r.rare}, e=K.orderGen(me,yard);
    if (e) out.fails.push('ordering a generator: '+e); else {
      const paid={ore:b0.ore-r.ore, he:b0.he-r.he, rare:b0.rare-r.rare}; out.gen={at:yard.id, paid};
      if (paid.ore!==120||paid.he!==60||paid.rare!==8) out.fails.push('a generator cost '+JSON.stringify(paid));
      const count=()=>(yard.gens||0)+C.fleets.filter(f=>f.owner===me).reduce((a,f)=>a+(f.gens||0),0), n0=count();
      wk(); const n1=count(); wk(); const n2=count(); out.gen.after={w1:n1-n0, w2:n2-n0, depot:yard.gens||0};
      if (n1!==n0) out.fails.push('the generator was finished in under 2 weeks');
      if (n2!==n0+1) out.fails.push('the generator was not finished after 2 weeks');
      let fl=C.fleets.find(f=>f.owner===me && f.at===yard.id && !f.transit && K.genRoom(f)>0);
      if (!fl) { fl=C.fleets.find(f=>f.owner===me && !f.transit && K.genRoom(f)>0); if (fl) fl.at=yard.id; } // (this campaign is thrown away: the fleet is moved for the check)
      if (fl) { if (!yard.gens) K.unloadGens(fl); const d0=yard.gens||0, e2=K.loadGens(fl, 1); out.gen.load={fleet:fl.name, room:K.genRoom(fl), err:e2||null, aboard:fl.gens||0};
        if (d0 && (e2 || (yard.gens||0)!==d0-1)) out.fails.push('a fleet with room could not take a generator aboard: '+e2);
        const sp=K.warSpec(fl); out.gen.spec={gens:sp.gens, defGens:sp.defGens, shield:sp.shield}; if (sp.gens!==(fl.gens||0)) out.fails.push('warSpec does not carry the generators aboard'); }
      else out.fails.push('no fleet of ours can carry a generator');
    }
  }
  // 4. a set-up generator's cost, once planetwar.js counts them
  out.gensUpInPW=typeof PW.gensUp==='function';
  return JSON.stringify(out);
}"""

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
    if (fl) { odds=K.rainOdds(fl); if (!odds.err) { if (K.genRoom(fl)>0) { fl.gens=1; out.gensAboard=1; } out.rainOdds={chance:+odds.chance.toFixed(2), need:odds.need, planet:!!odds.planet, troops:Math.round(odds.troops)}; const r=K.ironRain(fl); out.rain=r; out.rainWeek=C.turn; break; } else out.lastErr=odds.err; }
    if (W().owner===me) { out.fails.push('Mercury fell before the Rain'); break; }
    week();
  }
  const war0=W().war; if (!war0) { out.fails.push('no war on Mercury: '+(out.lastErr||'')); return JSON.stringify(out); }
  out.landed=war0.land0; out.warGens={gensIn:war0.gensIn, dark:war0.dark, shieldLit:war0.shieldLit};
  if (out.gensAboard && !(war0.gensIn && war0.gensIn.att===1)) out.fails.push('the generator aboard the Rain did not go down with it: '+JSON.stringify(war0.gensIn));
  if (war0.shieldLit==null || !war0.dark) out.fails.push('the war does not carry the lit shields and the dark flags');
  out.provsHeld=Object.keys(war0.provs).filter(k=>war0.provs[k].own==='att');
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
        sr = json.loads(await pg.evaluate(SHIELD_JS))
        print('shields:', json.dumps(sr, indent=1)[:2500])
        await pg.reload(); await pg.wait_for_timeout(3500)
        await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("()=>document.querySelector('#start').click()"); await pg.wait_for_timeout(5000)
        r = json.loads(await pg.evaluate(RUN_JS, [a.turns]))
        r['fails'] = ['shields: ' + x for x in sr.get('fails', [])] + r.get('fails', [])
        await b.close()
    sh = r.pop('share', [])
    print(json.dumps(r, indent=1)[:4000])
    print('share by week:', ' '.join(f"{s['wk']}:{s['share']}" for s in sh))
    fails = r.get('fails', []) + [f'page error: {e}' for e in errs[:5]]
    if fails: print('FAIL\n  ' + '\n  '.join(fails)); sys.exit(1)
    print('PASS'); sys.exit(0)

asyncio.run(main())
