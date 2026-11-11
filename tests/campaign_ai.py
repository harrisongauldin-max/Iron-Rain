"""Campaign AI benchmark: plays whole campaigns with auto-resolved battles and measures how the AI powers make war.

  python3 tests/campaign_ai.py [--mode passive|allai] [--turns 80] [--runs 3] [--save NAME] [--compare NAME]

passive: the player's power (the Republic by default) is played by nobody, so it neither builds nor moves on its own
         beyond what the game does for it. Shows how the AI treats a power that does not fight back.
allai:   the player's power is handed to the AI as well, so all three powers are AI. The main benchmark.

Metrics, averaged over the runs (per power where it says so):
  hoard         the most He-3 a power sat on while at peace with everyone and under its naval cap (lower is better past ~8,000)
  yardIdle      share of yard-weeks with an empty queue while the treasury had He-3 to spare and the navy had room
  warsAI        wars declared by AI powers, and how many of those by each power
  ops / multi   offensives launched, and how many of them by more than one fleet; opFleets is fleets per offensive
  idle          fleet-weeks of a strong fleet (900+) sitting still for 8+ weeks while its power is at war
  streak        the longest run of battles at one world without it changing hands
  ping5         worlds where 5 or more battles were fought in a row without it changing hands
  manMin        the lowest manpower a power fell to after week 10
  linger        weeks a power spent alive on 2 worlds or fewer while at war with someone who was not weary
  peaceNearDead peace treaties made with a power that held 2 worlds or fewer
  heEnd/worldsEnd each power's weekly He-3 income (after upkeep) and worlds held at the end
Passes (exit 0) if no page errors. --save NAME writes tests/results/campaign_ai_NAME.json (not committed); --compare
takes such a NAME or a path, e.g. tests/baseline/campaign_ai.json, the reference summary (6 runs x 80 weeks, all-AI)
after the campaign AI rework. Results vary a good deal from run to run: compare 6 runs or more.
"""
import os, sys, json, asyncio, argparse
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
F = ['rep', 'soc', 'rim']

RUN_JS = """async([MODE,TURNS])=>{const K=window.__CAMP.K, C=window.__CAMP.C; document.querySelectorAll('#smodal').forEach(m=>m.classList.add('hide'));
  if (MODE==='allai') C.fac[C.player].ai=true;
  const F=['rep','soc','rim'], pos={}, still={}, out={hoard:{rep:0,soc:0,rim:0}, yardIdle:0, yardTot:0, idle:0, streak:0, ping5:0, manMin:{rep:1e9,soc:1e9,rim:1e9}, linger:0, peaceNearDead:0, wars:{rep:0,soc:0,rim:0}, peace:0, fell:[]};
  const owner={}, run={}, bn0={}; for (const id in C.worlds) owner[id]=C.worlds[id].owner;
  let last=(C.chron||[]).slice(-1)[0];
  const nW=f=>Object.values(C.worlds).filter(w=>w.owner===f).length;
  for(let t=0;t<TURNS;t++){
    const small={}; for (const f of F) small[f]=C.fac[f].alive && nW(f)<=2;
    const cf=K.endTurn(); for(const c of cf) K.autoResolve(c); K.finishTurn();
    // new chronicle entries this week
    const ch=C.chron||[], i=last?ch.indexOf(last):-1, neu=ch.slice(i+1); last=ch.slice(-1)[0];
    for (const e of neu) { if (e.k==='war' && e.f && F.includes(e.f)) out.wars[e.f]++; if (e.k==='peace') { out.peace++; if (F.some(f=>small[f] && e.text.includes(K.BLOC_NAME[f]))) out.peaceNearDead++; } if (e.k==='fall') out.fell.push(e.f+'@'+C.turn); }
    // battles in a row at one world without it changing hands
    const bn=C.battleN||{};
    for (const id in C.worlds) { const w=C.worlds[id], n=(bn[id]||0)+(bn['off:'+id]||0); if (owner[id]!==w.owner) { run[id]=0; owner[id]=w.owner; } else { const d=n-(bn0[id]||0); if (d>0) { run[id]=(run[id]||0)+d; if (run[id]>out.streak) out.streakAt=id+' ('+w.owner+', week '+C.turn+')'; out.streak=Math.max(out.streak,run[id]); if (run[id]>=5 && run[id]-d<5) out.ping5++; } } bn0[id]=n; }
    if (C.over) break;
    for (const fl of C.fleets) { if (fl.owner==='neu') continue; const k=fl.id, at=fl.transit?'T':fl.at; if (pos[k]===at && !fl.transit) still[k]=(still[k]||0)+1; else still[k]=0; pos[k]=at;
      const warring=F.some(o=>o!==fl.owner&&C.fac[o]&&C.fac[o].alive&&K.hostile(fl.owner,o)); if (warring && !fl.garrison && !fl.holdFast && still[k]>=8 && K.fleetStr(fl)>=900) out.idle++; }
    for (const f of F) { if (!C.fac[f].alive) continue; const R=C.fac[f].res, atWar=F.some(o=>o!==f&&C.fac[o].alive&&K.hostile(f,o));
      const room=K.navalUsed(f)<K.navalCap(f)-3; // a hoard only counts while the yards could still be building
      if (!atWar && room) out.hoard[f]=Math.max(out.hoard[f], R.he);
      if (C.turn>10) out.manMin[f]=Math.min(out.manMin[f], R.man);
      for (const id in C.worlds) { const w=C.worlds[id]; if (w.owner!==f||!w.lv.yard) continue; if (!room) continue; out.yardTot++; if (!w.sq.length && R.he>1500) out.yardIdle++; }
      if (nW(f)<=2 && F.some(o=>o!==f&&C.fac[o].alive&&K.relOf(f,o)==='war'&&(C.weary[o]||0)<55)) out.linger++; }
  }
  const S=C.aiStats||{}; out.ops=S.ops||C.opsLog||0; out.multi=S.multi||C.opsMulti||0; out.opFleets=S.ops?+(S.fleets/S.ops).toFixed(2):null;
  out.inc={}; for (const f of F) out.inc[f]=C.fac[f].alive?Math.round(K.income(f).he):null;
  out.cut=S.cut||0; out.turn=C.turn; out.over=C.over||null;
  out.own={}; for (const id in C.worlds) out.own[C.worlds[id].owner]=(out.own[C.worlds[id].owner]||0)+1;
  out.rel=[['rep','soc'],['rep','rim'],['soc','rim']].map(([a,b])=>a+'-'+b+':'+K.relOf(a,b)).join(' ');
  for (const f of F) if (out.manMin[f]===1e9) out.manMin[f]=null;
  return JSON.stringify(out);}"""

async def one(p, mode, turns):
    b = await (p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS) if os.path.exists(CHROME) else p.chromium.launch(headless=True, args=ARGS))
    pg = await b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)[:300]))
    await pg.goto(URL); await pg.wait_for_timeout(500)
    await pg.evaluate("()=>{localStorage.setItem('ir.quality','standard'); localStorage.setItem('ironrain.opts', JSON.stringify({skipTrivial:false}))}")
    await pg.reload(); await pg.wait_for_timeout(3500)
    await pg.evaluate("()=>document.querySelector('[data-mode=camp]').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("()=>document.querySelector('#start').click()"); await pg.wait_for_timeout(5000)
    r = json.loads(await pg.evaluate(RUN_JS, [mode, turns]))
    await b.close(); return r, errs

def summarise(runs):
    n = len(runs); avg = lambda xs: round(sum(xs) / max(1, len(xs)), 2)
    S = {'runs': n}
    for f in F:
        S['hoard_' + f] = avg([r['hoard'][f] for r in runs])
        S['manMin_' + f] = avg([r['manMin'][f] for r in runs if r['manMin'][f] is not None])
        S['warsBy_' + f] = avg([r['wars'][f] for r in runs])
    S['warsAI'] = avg([sum(r['wars'].values()) for r in runs])
    S['yardIdle'] = avg([r['yardIdle'] / max(1, r['yardTot']) for r in runs])
    for k in ['ops', 'multi', 'idle', 'streak', 'ping5', 'linger', 'peaceNearDead', 'peace', 'cut']: S[k] = avg([r[k] for r in runs])
    S['opFleets'] = avg([r['opFleets'] for r in runs if r['opFleets'] is not None]) if any(r['opFleets'] for r in runs) else None
    S['falls'] = avg([len(r['fell']) for r in runs])
    for f in F: S['heEnd_' + f] = avg([r['inc'][f] for r in runs if r.get('inc') and r['inc'][f] is not None]); S['worldsEnd_' + f] = avg([r['own'].get(f, 0) for r in runs])
    return S

async def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--mode', default='allai'); ap.add_argument('--turns', type=int, default=80); ap.add_argument('--runs', type=int, default=3)
    ap.add_argument('--save'); ap.add_argument('--compare'); a = ap.parse_args()
    runs, errs = [], []
    async with async_playwright() as p:
        res = await asyncio.gather(*[one(p, a.mode, a.turns) for _ in range(a.runs)])
    for r, e in res:
        runs.append(r); errs += e
        print(json.dumps({k: r.get(k) for k in ["turn", "own", "rel", "wars", "fell", 'ops', 'multi', 'idle', 'streak', 'streakAt', 'linger', 'peaceNearDead', 'fell', 'hoard', 'manMin']}))
    S = summarise(runs); S['mode'] = a.mode; S['turns'] = a.turns
    print('SUMMARY', json.dumps(S))
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    if a.save: json.dump(S, open(os.path.join(HERE, 'results', f'campaign_ai_{a.save}.json'), 'w'), indent=1)
    if a.compare:
        B = json.load(open(a.compare if os.path.exists(a.compare) else os.path.join(HERE, 'results', f'campaign_ai_{a.compare}.json')))
        for k, v in S.items():
            if isinstance(v, (int, float)) and isinstance(B.get(k), (int, float)): print(f'  {k:16} {B[k]:>10} -> {v}')
    if errs: print('ERRORS', errs[:5])
    sys.exit(1 if errs else 0)

if __name__ == '__main__': asyncio.run(main())
