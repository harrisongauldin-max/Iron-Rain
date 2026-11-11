"""Summarise tests/results/*.json from ai_tournament.py runs."""
import os, json, glob, collections
rows=[]
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results', '*.json'))):
    t=open(f).read().strip()
    if t: rows.append(json.loads(t))
for r in rows:
    print(f"{r['sc']:16} {r['ai']} s{r['seed']} t{r['t']:4} lostA {r['lostA']:5} lostE {r['lostE']:5} /{r['startV']} idleHit {r['idleHit']:3} outNoFire {r['outNoFire']:3} never {r['neverFired']} routE {r['routE'] and round(r['routE'])} routA {r['routA'] and round(r['routA'])} {r['posts']} {r['err']}")
agg=collections.defaultdict(lambda: collections.defaultdict(float))
for r in rows:
    k=(r['sc'],r['ai']); a=agg[k]; a['n']+=1
    for m in ['lostA','lostE','idleHit','outNoFire','neverFired']: a[m]+=r[m]
    a['exch']+= r['lostA']/max(1,r['lostE'])
print()
for k in sorted(agg):
    a=agg[k]; n=a['n']; print(f"{k[0]:16} {k[1]}  n{int(n)}  player lost {a['lostA']/n:6.0f}  enemy lost {a['lostE']/n:6.0f}  exch(A/E) {a['exch']/n:4.2f}  idleHit {a['idleHit']/n:5.1f}  outNoFire {a['outNoFire']/n:5.1f}  never {a['neverFired']/n:3.1f}")
