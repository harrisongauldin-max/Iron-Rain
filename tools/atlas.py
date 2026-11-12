# packs the six roles of a world into one atlas per map: 3 x 2 cells of 512 with 16 px wrapped gutters (1632 x 1088)
import numpy as np, os
from PIL import Image
ROLES = ['wall','column','windows','trim','pave','metal']; G = 16; C = 512; P = C + 2*G
os.makedirs('atlas', exist_ok=True)
for w in ['mercury','luna','mars','venus','phobos','deimos','earth','_ice']:
    for suf, mode, fallback in [('_a','RGB',None), ('_n','RGB',(128,128,255)), ('_r','L',128), ('_e','L',0)]:
        atlas = Image.new(mode, (3*P, 2*P), fallback if fallback is not None else (0,0,0))
        for k, role in enumerate(ROLES):
            path = f'out/{w}_{role}{"" if suf == "_a" else suf}.png'
            if not os.path.exists(path): continue
            im = np.array(Image.open(path).convert(mode))
            pad = ((G, G), (G, G), (0, 0)) if im.ndim == 3 else ((G, G), (G, G))
            atlas.paste(Image.fromarray(np.pad(im, pad, mode='wrap')), ((k % 3)*P, (k // 3)*P))
        if suf in ('_r', '_e'): atlas = atlas.resize((atlas.width // 2, atlas.height // 2), Image.LANCZOS)
        atlas.save(f'atlas/{w}{suf}.png', optimize=True)
    print(w, [round(os.path.getsize(f'atlas/{w}{s}.png')/1024) for s in ('_a','_n','_r','_e')], 'KB')
