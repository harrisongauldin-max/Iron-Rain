"""Audio check: renders every sound kind offline (OfflineAudioContext in headless Chrome), in space (through the
hull and cinematic) and on the ground (air and airless), plus both score cues. Fails on NaN, silence, clipping past
the limiter, or a sound that never ends. With --reel PATH, also writes a WAV sound reel to audition."""
import os, sys, json, base64, asyncio, wave
from playwright.async_api import async_playwright
URL = os.environ.get('IR_URL', 'http://127.0.0.1:8773/index.html').replace('index.html', 'tests/audio_check.html')
CHROME = os.environ.get('IR_CHROME', '/usr/bin/google-chrome')
def launch(p): return p.chromium.launch(executable_path=CHROME, headless=True) if os.path.exists(CHROME) else p.chromium.launch(headless=True)
UI = {'capture', 'alarm', 'sel', 'ack', 'click', 'built', 'deny', 'radio', 'victory', 'defeat'}
def wav(path, pcm, sr):
    with wave.open(path, 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm)
async def main():
    reel = sys.argv[sys.argv.index('--reel') + 1] if '--reel' in sys.argv else None
    async with async_playwright() as p:
        b = await launch(p); pg = await b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL); await pg.wait_for_function('window.ready === true', timeout=20000)
        kinds = await pg.evaluate('window.KINDS'); bad = []; rows = []
        for scene, space, air in [('space', 'hull', 1), ('space', 'cinematic', 1), ('ground', 'hull', 1), ('ground', 'hull', 0)]:
            for k in kinds:
                dur = 7 if k in ('nuke', 'bigboom', 'throes') else 4
                r = await pg.evaluate('([s]) => window.render(s)', [{'events': [[0, k, 2 if k in ('hit', 'shhit') else 24 if k == 'boom' else None]], 'dur': dur, 'scene': scene, 'space': space, 'air': air}])
                tag = f'{scene}/{space if scene == "space" else ("air" if air else "airless")}/{k}'
                rows.append((tag, r['peak'], r['rms'], r['tail']))
                if r['nan']: bad.append(f'{tag}: {r["nan"]} NaN samples')
                if r['peak'] < .01: bad.append(f'{tag}: silent (peak {r["peak"]:.4f})')
                if r['peak'] > 1.0: bad.append(f'{tag}: clips (peak {r["peak"]:.3f})')
                if r['tail'] > dur - .3: bad.append(f'{tag}: still sounding at the end ({r["tail"]:.2f}s)')
        for cue, lvl in [('battle', .4), ('battle', 1), ('map', .65)]:
            r = await pg.evaluate('([s]) => window.render(s)', [{'music': {'cue': cue, 'lvl': lvl, 'from': 0, 'to': 14}, 'dur': 20}])
            rows.append((f'music/{cue}@{lvl}', r['peak'], r['rms'], r['tail']))
            if r['nan'] or r['peak'] < .01 or r['peak'] > 1: bad.append(f'music {cue}@{lvl}: peak {r["peak"]:.3f} nan {r["nan"]}')
        for t, pk, rms, tail in rows: print(f'{t:34s} peak {pk:6.3f}  rms {rms:6.4f}  ends {tail:5.2f}s')
        if reel:
            ev = []; t = .3
            for k, s, gap in [('rail', None, .45), ('rail', None, .35), ('cannon', None, .3), ('pd', None, .5), ('missile', None, .9), ('lance', None, 1.6), ('hit', 1, .5), ('hit', 3, .9),
                              ('shhit', 1, .5), ('shhit', 3, .9), ('shdown', None, 1.1), ('emp', None, 1.3), ('boom', 8, .9), ('boom', 30, 1.8), ('throes', 30, 3.6), ('bigboom', None, 4.2), ('nuke', None, 5.5),
                              ('clang', None, .7), ('alarm', None, 1.3), ('capture', None, 1.1), ('radio', None, .7), ('sel', None, .35), ('ack', None, .35), ('click', None, .35), ('built', None, .8), ('deny', None, .7)]:
                ev.append([t, k, s]); t += gap
            for mode in ('hull', 'cinematic'):
                r = await pg.evaluate('([s]) => window.render(s, true)', [{'events': ev, 'dur': t + 1.5, 'scene': 'space', 'space': mode}]); wav(reel + f'_space_{mode}.wav', base64.b64decode(r['pcm']), r['sr'])
            ev = []; t = .3
            for k, s, gap in [('scorch', None, .12), ('scorch', None, .1), ('scorch', None, .25), ('scorch', None, .12), ('plasma', None, .5), ('pulse', None, .7), ('rail', None, .8), ('cannon', None, .5), ('sarissa', None, .9),
                              ('heavy', None, 1.6), ('melee', None, .25), ('melee', None, .25), ('melee', None, .25), ('melee', None, .6), ('boom', 18, 1.8), ('bigboom', None, 4.2), ('victory', None, 3), ('defeat', None, 3.8)]:
                ev.append([t, k, s, ((len(ev) % 5) - 2) * .3]); t += gap
            r = await pg.evaluate('([s]) => window.render(s, true)', [{'events': ev, 'dur': t + 1.5, 'scene': 'ground', 'air': 1}]); wav(reel + '_ground.wav', base64.b64decode(r['pcm']), r['sr'])
            r = await pg.evaluate('([s]) => window.render(s, true)', [{'music': {'cue': 'battle', 'lvl': 1, 'from': 0, 'to': 26}, 'dur': 30}]); wav(reel + '_battle_score.wav', base64.b64decode(r['pcm']), r['sr'])
            r = await pg.evaluate('([s]) => window.render(s, true)', [{'music': {'cue': 'map', 'lvl': .65, 'from': 0, 'to': 30}, 'dur': 35}]); wav(reel + '_map_theme.wav', base64.b64decode(r['pcm']), r['sr'])
        await b.close()
        for e in errs[:5]: print('ERROR', e)
        for x in bad: print('FAIL', x)
        print('audio check:', 'FAIL' if bad or errs else 'OK', f'({len(rows)} renders)'); sys.exit(1 if bad or errs else 0)
asyncio.run(main())
