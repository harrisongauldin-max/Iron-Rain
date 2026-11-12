"""City texture generator for Iron Rain: one albedo + normal + roughness per role per world, all seamless (periodic noise).
Roles: wall (main facade), column (pillar / shaft, wraps a cylinder), windows (one storey strip), trim (frieze / cornice band),
pave (streets and courts), metal (roofs, domes, canopies, doors).  Usage: python3 citytex.py [world ...]"""
import sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
N = 512

# ------------------------------------------------------------------ noise and helpers (everything wraps at the tile edge)
def vnoise(n, cells, seed):
    r = np.random.default_rng(seed); g = r.random((cells, cells))
    y, x = np.mgrid[0:n, 0:n] / n * cells
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
    fx = fx*fx*(3-2*fx); fy = fy*fy*(3-2*fy)
    x1 = (x0+1) % cells; y1 = (y0+1) % cells; x0 %= cells; y0 %= cells
    return (g[y0,x0]*(1-fx)+g[y0,x1]*fx)*(1-fy) + (g[y1,x0]*(1-fx)+g[y1,x1]*fx)*fy
def fbm(seed, oct=5, base=4, n=N):
    out = np.zeros((n,n)); a = 1; tot = 0
    for o in range(oct): out += a*vnoise(n, base*2**o, seed+o); tot += a; a *= .5
    return out/tot
def col(h): return np.array([int(h[i:i+2],16) for i in (1,3,5)])/255
def mix(a, b, t): t = np.asarray(t); return a*(1-t[...,None]) + b*t[...,None]
def blur(a, r): return np.array(Image.fromarray((np.clip(a,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)))/255
def tile_blur(a, r):  # blur that wraps: pad by tiling, blur, crop
    n = a.shape[0]; big = np.tile(a, (3,3)); b = blur(big, r); return b[n:2*n, n:2*n]
YY = np.mgrid[0:N,0:N][0]/N; XX = np.mgrid[0:N,0:N][1]/N
def grime(img, color, seed, strength=.5, start=.6):   # dirt climbing from the bottom of the tile
    return mix(img, color, np.clip((YY-start)/(1-start),0,1)*fbm(seed,3,3)*strength*2)
def pil(img): return Image.fromarray((np.clip(img,0,1)*255).astype(np.uint8))
def arr(im): return np.array(im.convert('RGB'))/255
def normal_from_height(h, strength=.012):
    h = np.broadcast_to(np.asarray(h, float), (N, N)); dx = (np.roll(h,-1,1) - np.roll(h,1,1))*strength*N/2; dy = (np.roll(h,-1,0) - np.roll(h,1,0))*strength*N/2
    n = np.dstack([-dx, -dy, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2)[...,None]
    return n*.5+.5
def save_set(name, albedo, height, rough):
    pil(albedo).save(f'out/{name}.png'); pil(normal_from_height(height)).save(f'out/{name}_n.png')
    Image.fromarray((np.clip(np.broadcast_to(rough, (N, N)),0,1)*255).astype(np.uint8)).save(f'out/{name}_r.png')

# ------------------------------------------------------------------ building blocks shared by the worlds
def courses(nc, bw_frac, stagger=True, seed=1, jitter=0):  # courses are rounded so the last one is as tall as the rest and the tile wraps
    """ashlar / panel layout: returns (tone per block, mortar mask, height). bw_frac = block width as a fraction of the tile"""
    r = np.random.default_rng(seed); tone = np.ones((N,N)); mort = np.zeros((N,N)); bh = N//nc; bw = int(N*bw_frac)
    for c in range(nc):
        off = (bw//2 if c%2 else 0) if stagger else 0; y0 = round(c*N/nc); bh = round((c+1)*N/nc) - y0
        x = -bw + off
        while x < N:
            w = bw + (int(r.integers(-jitter, jitter+1)) if jitter else 0); t = .85 + r.random()*.3
            xs = np.arange(x, x+w) % N; tone[y0:y0+bh, xs] = t; mort[y0:y0+bh, xs[:3]] = 1; x += w
        mort[y0:y0+3,:] = 1
    h = 1 - tile_blur(mort, 1.5)*.9
    return tone, mort, h
def stone_wall(light, dark, mortar, nc=6, bw=.33, seed=1, vein=0, grimec=None, jitter=0):
    tone, mort, h = courses(nc, bw, True, seed, jitter)
    g = fbm(seed*7+1, 6, 8)
    base = mix(dark, light, g*.9+.05)*tone[...,None]
    if vein: v = np.abs(fbm(seed*7+3, 3, 2)-.5)*2; base = mix(base, dark, np.clip((.06-v)*12,0,1)*vein)
    base = mix(base, mortar, mort*.85)
    base *= (1 - tile_blur(mort, 3)[...,None]*.25)
    if grimec is not None: base = grime(base, grimec, seed*7+5, .45)
    rough = .55 + g*.3 + mort*.2
    return base, h*(.6+g*.4), rough
def panel_wall(light, dark, seam, nx=3, ny=5, seed=2, bevel=4, rivets=0, grimec=None, streaks=0):
    """metal / composite panels with recessed seams, optional rivets and rain streaks"""
    g = fbm(seed*7+1, 4, 6); base = mix(dark, light, g*.6+.2)
    seams = np.zeros((N,N)); pw, ph = N//nx, N//ny
    for i in range(nx+1): seams[:, (i*pw)%N:(i*pw)%N+bevel] = 1
    for j in range(ny+1): seams[(j*ph)%N:(j*ph)%N+bevel, :] = 1
    r = np.random.default_rng(seed); tone = np.ones((N,N))
    for i in range(nx):
        for j in range(ny): tone[j*ph:(j+1)*ph, i*pw:(i+1)*pw] = .9 + r.random()*.2
    base = base*tone[...,None]; h = 1 - tile_blur(seams, 1.2)
    base = mix(base, seam, seams*.9); base *= (1 - tile_blur(seams, 2.5)[...,None]*.2)
    if rivets:
        im = pil(base); d = ImageDraw.Draw(im)
        for i in range(nx):
            for j in range(ny):
                for (a,b) in [(i*pw+10, j*ph+10), ((i+1)*pw-14, j*ph+10), (i*pw+10, (j+1)*ph-14), ((i+1)*pw-14, (j+1)*ph-14)]:
                    d.ellipse([a, b, a+6, b+6], fill=tuple(int(v*255) for v in seam*.9)); d.ellipse([a+1, b+1, a+4, b+4], fill=tuple(int(v*255) for v in light))
        base = arr(im)
    if streaks: s = fbm(seed*7+9, 3, 1); s = (s*s)*np.clip((YY-.1)*1.3,0,1); base = mix(base, dark*.6, s*streaks)
    if grimec is not None: base = grime(base, grimec, seed*7+5, .4, .7)
    rough = .35 + g*.25 + seams*.3
    return base, h, rough
def brick_wall(light, dark, mortar, seed=3, nc=16, grimec=None):
    tone, mort, h = courses(nc, .125, True, seed)
    g = fbm(seed*7+1, 5, 8); base = mix(dark, light, g)*tone[...,None]
    base = mix(base, mortar, mort*.9)
    if grimec is not None: base = grime(base, grimec, seed*7+5, .5)
    return base, h, .7 + g*.2
def plaster_wall(light, dark, seed=4, crack=.3, grimec=None):
    g = fbm(seed*7+1, 6, 3); base = mix(dark, light, g*.5+.4)
    v = np.abs(fbm(seed*7+3, 4, 3)-.5)*2; cr = np.clip((.04-v)*25,0,1)*crack
    base = mix(base, dark*.7, cr)
    if grimec is not None: base = grime(base, grimec, seed*7+5, .35)
    return base, 1 - cr*.5 + g*.1, .8 - g*.2
def fluted(light, dark, flutes=24, seed=5, grimec=None, sharp=False):
    ph = (XX*flutes) % 1
    depth = np.abs(ph*2-1) if sharp else np.cos(ph*2*np.pi)*.5+.5
    shade = 1 - depth*.45 + (np.sin(ph*2*np.pi)*.15)
    g = fbm(seed*7+1, 5, 6); base = mix(dark, light, g*.6+.2)*shade[...,None]
    if grimec is not None: base = grime(base, grimec, seed*7+5, .4, .75)
    return base, 1 - depth*.8, .5 + g*.3
def window_strip(wallf, glass_dark, glass_lit, frame, nw=4, shape='rect', lit=.45, seed=6, sill=True, band=None, inset=.2, top=.25, bottom=.8, mullions=2, glow=True, storeys=3):
    """three storeys of windows per tile (so the lit ones do not line up in columns); returns albedo, height, rough, emissive mask"""
    base = wallf(); im = pil(base); d = ImageDraw.Draw(im); em = Image.new('L', (N,N), 0); de = ImageDraw.Draw(em); hgt = Image.new('L', (N,N), 255); dh = ImageDraw.Draw(hgt)
    r = np.random.default_rng(seed); w = N//nw; fr = tuple(int(v*255) for v in frame); SH = N/storeys
    for st in range(storeys):
        lit_set = set(r.permutation(nw)[:max(1, round(nw*lit*.7))].tolist())   # exactly the lit share, never none
        oy = int(st*SH)
        for k in range(nw):
            x0 = k*w + int(w*inset); x1 = (k+1)*w - int(w*inset); y0 = oy + int(SH*top); y1 = oy + int(SH*bottom)
            on = k in lit_set; g = glass_lit*.5 if on else glass_dark; gc = tuple(int(v*255) for v in g)
            if shape == 'arch':
                rr = min((x1-x0)//2, (y1-y0)//2)
                d.rectangle([x0, y0, x1, y1], fill=gc); d.pieslice([x0, y0-rr, x1, y0+rr], 180, 360, fill=gc)
                dh.rectangle([x0, y0, x1, y1], fill=150); dh.pieslice([x0, y0-rr, x1, y0+rr], 180, 360, fill=150)
                if on: de.rectangle([x0, y0, x1, y1], fill=255); de.pieslice([x0, y0-rr, x1, y0+rr], 180, 360, fill=255)
            elif shape == 'slit':
                for q in range(3):
                    sx0 = x0 + q*(x1-x0)//3 + 3; sx1 = x0 + (q+1)*(x1-x0)//3 - 3
                    d.rectangle([sx0, y0, sx1, y1], fill=gc); dh.rectangle([sx0, y0, sx1, y1], fill=150)
                    if on: de.rectangle([sx0, y0, sx1, y1], fill=255)
            elif shape == 'hex':
                pts = [(x0, (y0+y1)//2), ((x0+x1)//2, y0), (x1, (y0+y1)//2), ((x0+x1)//2, y1)]
                d.polygon(pts, fill=gc); dh.polygon(pts, fill=150)
                if on: de.polygon(pts, fill=255)
            else:
                d.rectangle([x0, y0, x1, y1], fill=gc); dh.rectangle([x0, y0, x1, y1], fill=150)
                if on: de.rectangle([x0, y0, x1, y1], fill=255)
            if shape != 'slit':
                for m in range(1, mullions+1): d.line([(x0+(x1-x0)*m//(mullions+1), y0-(rr if shape=='arch' else 0)), (x0+(x1-x0)*m//(mullions+1), y1)], fill=fr, width=3)
                if mullions: d.line([(x0, (y0+y1)//2), (x1, (y0+y1)//2)], fill=fr, width=2)
            if sill: d.rectangle([x0-3, y1, x1+3, y1+5], fill=fr); dh.rectangle([x0-3, y1, x1+3, y1+5], fill=255)
    if band is not None:
        bc = tuple(int(v*255) for v in band); d.rectangle([0, 0, N, N//24], fill=bc); d.rectangle([0, N//24-3, N, N//24], fill=tuple(int(v*110) for v in band)); dh.rectangle([0, 0, N, N//24], fill=255)
    a = arr(im); emm = np.array(em)/255; emm = emm*(.55 + .45*tile_blur(emm, 6)); h = np.array(hgt)/255
    rough = .7 - emm*.5 - (h < .7)*.3
    return a, h, np.clip(rough, .05, 1), emm
def frieze_classical(light, dark, accent, seed=7, motif='egg'):
    g = fbm(seed*7+1, 4, 4); base = mix(light, light*.92, g); im = pil(base); d = ImageDraw.Draw(im); hg = Image.new('L', (N,N), 128); dh = ImageDraw.Draw(hg)
    dk = tuple(int(v*255) for v in dark); lt = tuple(int(v*255) for v in accent)
    for k in range(0, N, 32): d.rectangle([k+6, 20, k+26, 60], fill=dk); d.rectangle([k+6, 20, k+24, 24], fill=lt); dh.rectangle([k+6, 20, k+26, 60], fill=220)
    if motif == 'egg':
        for k in range(0, N, 48): d.ellipse([k+8, 90, k+40, 150], outline=dk, width=5); d.ellipse([k+16, 100, k+32, 140], fill=lt); dh.ellipse([k+8, 90, k+40, 150], fill=200)
    elif motif == 'sun':
        for k in range(0, N, 64):
            d.ellipse([k+16, 96, k+48, 128], fill=lt, outline=dk, width=3); dh.ellipse([k+16, 96, k+48, 128], fill=230)
            for a in range(12): import math; ca, sa = math.cos(a*math.pi/6), math.sin(a*math.pi/6); d.line([(k+32+ca*18, 112+sa*18), (k+32+ca*26, 112+sa*26)], fill=dk, width=3)
    elif motif == 'laurel':
        import math
        for k in range(0, N, 32):   # a laurel garland: paired leaves along a stem
            d.line([(k, 112), (k+32, 112)], fill=dk, width=3)
            for sgn in (-1, 1): d.polygon([(k+4, 112), (k+14, 112+sgn*18), (k+26, 112+sgn*6)], fill=lt, outline=dk)
            dh.polygon([(k+4, 112), (k+14, 94), (k+26, 106)], fill=200); dh.polygon([(k+4, 112), (k+14, 130), (k+26, 118)], fill=200)
    elif motif == 'wave':
        for k in range(0, N, 32): d.arc([k, 92, k+40, 140], 180, 360, fill=dk, width=5); d.arc([k+8, 104, k+32, 132], 180, 360, fill=lt, width=3)
    elif motif == 'lion':
        for k in range(0, N, 96):
            d.ellipse([k+16, 78, k+80, 142], fill=dk)                                                   # the mane
            for a in range(0, 360, 24): import math; ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a)); d.polygon([(k+48+ca*30, 110+sa*30), (k+48+ca*40+sa*6, 110+sa*40-ca*6), (k+48+ca*40-sa*6, 110+sa*40+ca*6)], fill=dk)
            d.ellipse([k+30, 94, k+66, 130], fill=lt); d.polygon([(k+32, 98), (k+36, 84), (k+44, 96)], fill=lt); d.polygon([(k+64, 98), (k+60, 84), (k+52, 96)], fill=lt)   # face and ears
            d.ellipse([k+39, 106, k+44, 111], fill=dk); d.ellipse([k+52, 106, k+57, 111], fill=dk); d.polygon([(k+44, 117), (k+52, 117), (k+48, 123)], fill=dk); d.line([(k+48, 123), (k+48, 128)], fill=dk, width=2)
    for k in range(0, N, 128):
        d.arc([k+10, 200, k+118, 330], 200, 520, fill=dk, width=8); d.arc([k+40, 230, k+88, 300], 0, 360, fill=lt, width=4); d.polygon([(k+64, 335), (k+40, 420), (k+64, 400), (k+88, 420)], fill=dk)
        dh.arc([k+10, 200, k+118, 330], 200, 520, fill=200, width=8)
    d.rectangle([0, 440, N, 470], fill=dk); d.rectangle([0, 470, N, 480], fill=lt); dh.rectangle([0, 440, N, 480], fill=230)
    a = arr(im); h = np.array(hg)/255; sh = tile_blur(h, 2)
    return a*(.85 + sh[...,None]*.2), h, .6 + g*.2
def frieze_tech(base_c, line_c, glow_c, seed=8, pattern='chevron'):
    g = fbm(seed*7+1, 4, 6); base = mix(base_c*.8, base_c, g); im = pil(base); d = ImageDraw.Draw(im); em = Image.new('L', (N,N), 0); de = ImageDraw.Draw(em); hg = Image.new('L', (N,N), 128); dh = ImageDraw.Draw(hg)
    lc = tuple(int(v*255) for v in line_c); gc = tuple(int(v*255) for v in glow_c)
    d.rectangle([0, 40, N, 48], fill=lc); d.rectangle([0, 464, N, 472], fill=lc); dh.rectangle([0, 40, N, 48], fill=60); dh.rectangle([0, 464, N, 472], fill=60)
    if pattern == 'chevron':
        for k in range(-64, N+64, 64): d.polygon([(k, 100), (k+32, 160), (k+64, 100), (k+64, 130), (k+32, 190), (k, 130)], fill=lc); dh.polygon([(k, 100), (k+32, 160), (k+64, 100), (k+64, 130), (k+32, 190), (k, 130)], fill=200)
        d.rectangle([0, 300, N, 312], fill=gc); de.rectangle([0, 300, N, 312], fill=255)
        for k in range(0, N, 48): d.rectangle([k+8, 360, k+40, 420], fill=lc); d.rectangle([k+8, 360, k+40, 366], fill=gc); de.rectangle([k+8, 360, k+40, 366], fill=255)
    elif pattern == 'glyph':
        r = np.random.default_rng(seed)
        for k in range(0, N, 40):
            for j in range(0, 3):
                if r.random() < .7: d.rectangle([k+6, 90+j*36, k+32, 90+j*36+24], fill=gc if r.random() < .25 else lc)
                if r.random() < .25: de.rectangle([k+6, 90+j*36, k+32, 90+j*36+24], fill=255)
        d.rectangle([0, 230, N, 236], fill=gc); de.rectangle([0, 230, N, 236], fill=255)
        for k in range(0, N, 24): d.polygon([(k, 300), (k+12, 280), (k+24, 300), (k+12, 420)], fill=lc); dh.polygon([(k, 300), (k+12, 280), (k+24, 300), (k+12, 420)], fill=210)
    elif pattern == 'hazard':
        for k in range(-64, N+64, 64): d.polygon([(k, 120), (k+32, 120), (k+64, 200), (k+32, 200)], fill=gc)
        d.rectangle([0, 260, N, 266], fill=lc); d.rectangle([0, 380, N, 386], fill=lc)
        for k in range(0, N, 64): d.ellipse([k+24, 300, k+40, 316], fill=lc); dh.ellipse([k+24, 300, k+40, 316], fill=255)
    elif pattern == 'plain':
        for k in range(0, N, 64):   # a meander (Greek key) in the line colour, a lit line through the middle
            d.line([(k, 120), (k+48, 120), (k+48, 168), (k+16, 168), (k+16, 136), (k+32, 136), (k+32, 152)], fill=lc, width=5)
            d.line([(k, 400), (k+48, 400), (k+48, 352), (k+16, 352), (k+16, 384), (k+32, 384), (k+32, 368)], fill=lc, width=5)
        d.rectangle([0, 120, N, 124], fill=lc); d.rectangle([0, 400, N, 404], fill=lc)
        d.rectangle([0, 254, N, 262], fill=gc); de.rectangle([0, 254, N, 262], fill=255)
    a = arr(im); emm = np.array(em)/255
    return a, np.array(hg)/255, .4 + g*.2 - emm*.3, emm
def flagstones(light, dark, joint, cells=8, jitter=10, seed=9, grimec=None, sandc=None):
    n = fbm(seed*7+1, 5, 5); y, x = np.mgrid[0:N,0:N]; cs = N//cells
    xx = x + (vnoise(N, cells, seed*7+2)-.5)*jitter*2; yy = y + (vnoise(N, cells, seed*7+3)-.5)*jitter*2
    cx = (xx//cs)*cs + cs/2; cy = (yy//cs)*cs + cs/2
    dist = np.maximum(np.abs(xx-cx), np.abs(yy-cy))/(cs/2); jt = np.clip((dist-.86)*8, 0, 1)
    tone = vnoise(N, cells, seed*7+4)*.3 + .75
    base = mix(dark, light, n)*tone[...,None]; base = mix(base, joint, jt*.8)
    crack = np.abs(fbm(seed*7+5, 4, 16)-.5); base *= (1 - crack[...,None]*.3)
    if sandc is not None: base = mix(base, sandc, np.clip(fbm(seed*7+6, 3, 2)*1.4-.6, 0, 1)*.5)
    if grimec is not None: base = mix(base, grimec, fbm(seed*7+7, 3, 3)*.3)
    return base, 1 - jt*.8 + n*.1, .75 + n*.15
def grid_tile(light, dark, joint, cells=12, seed=10, grimec=None):
    y, x = np.mgrid[0:N,0:N]; cs = N//cells; jt = ((x % cs) < 3) | ((y % cs) < 3)
    n = fbm(seed*7+1, 4, 6); tone = vnoise(N, cells, seed*7+2)*.25 + .8
    base = mix(dark, light, n)*tone[...,None]; base = mix(base, joint, jt*.9)
    if grimec is not None: base = mix(base, grimec, fbm(seed*7+3, 3, 2)*.35)
    return base, 1 - jt*.7, .4 + n*.2
def grating(light, dark, seed=11):
    y, x = np.mgrid[0:N,0:N]; bar = ((x % 32) < 10) | ((y % 32) < 10); n = fbm(seed*7+1, 4, 8)
    base = mix(dark*.4, dark, (~bar)*.3); base = mix(base, light, bar*(n*.6+.3))
    return base, bar*1.0, .5 + n*.2
def metal(light, dark, seed=12, hammer=0, streak=0, patina=None, rust=None, brushed=0):
    g = fbm(seed*7+1, 4, 3); base = mix(dark, light, g)
    if brushed: b = vnoise(N, 2, seed*7+2)*0 + fbm(seed*7+3, 3, 64)*0; lines = np.abs(np.sin(YY*N*.8 + fbm(seed*7+4,2,2)*4))**8; base = base*(1 - lines[...,None]*brushed*.25)
    if hammer: hm = np.abs(vnoise(N, 24, seed*7+5)-.5)*2; base = base*(.85 + hm[...,None]*.3*hammer)
    if streak: s = fbm(seed*7+6, 3, 1)**2*np.clip((YY-.1)*1.3,0,1); base = mix(base, dark*.6, s*streak)
    if patina is not None: p = np.clip(fbm(seed*7+7, 4, 2)*1.6-.6, 0, 1); base = mix(base, patina, p*.5)
    if rust is not None: rr = np.clip(fbm(seed*7+8, 5, 3)*1.8-.8, 0, 1); base = mix(base, rust, rr*.8)
    base *= (.9 + (vnoise(N, 32, seed*7+9)-.5)[...,None]*.2)
    rough = .3 + g*.2 + (0 if rust is None else np.clip(fbm(seed*7+8, 5, 3)*1.8-.8, 0, 1)*.5)
    return base, .5 + (0 if not hammer else (np.abs(vnoise(N, 24, seed*7+5)-.5)*2-.5)*.12), rough

# ------------------------------------------------------------------ the worlds
W = {}
def world(name):
    def deco(f): W[name] = f; return f
    return deco

@world('mercury')   # Heliopolis: sun city on the Bay of Sirens; sandstone, bronze, Helios sun motif, Water Plaza, hippodrome
def mercury():
    SAND, SAND_D, SAND_L, BR, BR_D, GR = col('#d9b98a'), col('#b7925f'), col('#efd9b4'), col('#8a6a2f'), col('#4f3a17'), col('#6b5a44')
    out = {}
    out['wall'] = stone_wall(SAND_L, SAND, col('#5a4a36'), 6, .33, 1, vein=.2, grimec=GR, jitter=30)
    out['column'] = fluted(SAND_L, SAND, 24, 5, GR)
    a, h, r, e = window_strip(lambda: mix(SAND, SAND_L, fbm(41,4,4)*.7), col('#2e2c34'), col('#ffb25c'), col('#8c6a36'), 4, 'arch', .45, 6, True, BR*1.3)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_classical(SAND_L, col('#8c6a36'), col('#f4e4c8'), 7, 'sun')
    out['pave'] = flagstones(col('#e9d3ad'), col('#c9ab7e'), col('#7d6a4e'), 8, 5, 9, sandc=col('#e8cf9a'))
    out['metal'] = metal(col('#b8904a'), col('#6a4c22'), 12, hammer=1, streak=.2, patina=col('#6f9a84'))
    return out

@world('luna')      # Hyperion: the Eternal City, kilometre towers in layers, the Promenade; pale composite, chrome, gilt, glass
def luna():
    L, D, S, G = col('#e6e8ee'), col('#aeb3bd'), col('#6c7078'), col('#c9a24c')
    out = {}
    out['wall'] = panel_wall(L, D, S, 3, 6, 2, 3, rivets=0, streaks=.25)
    out['column'] = fluted(col('#f0f1f5'), col('#b8bcc6'), 16, 5, None, sharp=True)
    a, h, r, e = window_strip(lambda: mix(D, L, fbm(42,3,3)*.5+.3), col('#2b3644'), col('#f3f0e4'), col('#7c8089'), 6, 'rect', .55, 16, False, G, .1, .12, .9, 1)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_tech(col('#d8dbe2'), G, col('#fff1c2'), 8, 'plain')
    out['pave'] = grid_tile(col('#d4d6dc'), col('#9a9ea8'), col('#5e626b'), 12, 10)
    out['metal'] = metal(col('#f2f3f6'), col('#9fa4ad'), 12, brushed=1, streak=.15)
    return out

@world('mars')      # Agea: the Citadel's white and red spires with lions; red stone, white marble, gold lions
def mars():
    RED, RED_D, WH, WH_D, GOLD = col('#a24a33'), col('#5a2618'), col('#f2ede4'), col('#cfc6b8'), col('#d4a84b')
    out = {}
    out['wall'] = stone_wall(col('#b85a40'), RED_D, col('#3b1c12'), 5, .4, 21, vein=.15, grimec=col('#4a2a1e'), jitter=20)
    out['column'] = fluted(WH, WH_D, 20, 25, col('#8a6a5a'))
    a, h, r, e = window_strip(lambda: mix(WH_D, WH, fbm(43,4,4)), col('#2a2228'), col('#ffd27a'), GOLD*.8, 4, 'arch', .5, 26, True, RED*.9, .22, .2, .82, 1)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_classical(WH, col('#8a3b28'), GOLD, 27, 'lion')
    out['pave'] = flagstones(col('#c98a6c'), col('#8e4f3a'), col('#4a2a1e'), 7, 6, 29, sandc=col('#d8b58a'))
    out['metal'] = metal(GOLD, col('#8a6a2f'), 32, hammer=.6, streak=.1)
    return out

@world('venus')     # the Columns of Venus (Carthii); coral and sea-green marble, verdigris bronze, gardens
def venus():
    COR, COR_D, GRN, GRN_D, VB = col('#e8b7a3'), col('#b8766a'), col('#6f9a84'), col('#3d5a4b'), col('#4f8a76')
    out = {}
    out['wall'] = stone_wall(col('#f3d8c8'), COR_D, col('#5a3a34'), 5, .36, 31, vein=.4, grimec=col('#5c6a5a'), jitter=24)
    out['column'] = fluted(col('#f6e4d8'), COR, 28, 35, col('#5c6a5a'))
    a, h, r, e = window_strip(lambda: mix(COR_D, COR, fbm(44,4,4)*.7+.2), col('#243432'), col('#ffe3b0'), VB, 3, 'arch', .5, 36, True, VB, .18, .18, .8, 2)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_classical(col('#f3d8c8'), col('#4f8a76'), col('#fff3e2'), 37, 'wave')
    out['pave'] = flagstones(col('#e4cbb8'), col('#b59684'), col('#56604f'), 6, 14, 39, grimec=col('#5c7a5a'))
    out['metal'] = metal(col('#7f6a3a'), col('#3f3418'), 42, hammer=.8, patina=col('#58a08a'))
    return out

@world('phobos')    # the Hive: a hollowed moon wrapped in metal, jagged needles, refineries and docks; black steel, rivets, red light
def phobos():
    K, K_L, R, RD = col('#2e3036'), col('#5a5e68'), col('#ff3a24'), col('#1a1b1f')
    out = {}
    out['wall'] = panel_wall(K_L, K, RD, 4, 4, 52, 5, rivets=1, streaks=.5, grimec=col('#15161a'))
    out['column'] = fluted(col('#4a4e58'), col('#202228'), 8, 55, col('#101114'), sharp=True)
    a, h, r, e = window_strip(lambda: mix(K, K_L, fbm(45,4,6)*.4+.1), col('#0d0e12'), col('#ff5a3a'), col('#1a1b1f'), 8, 'slit', .4, 56, False, None, .08, .3, .7, 0, glow=False)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_tech(col('#34363d'), col('#6a6e78'), R, 58, 'glyph')
    out['pave'] = grating(col('#6a6e78'), col('#2a2c32'), 59)
    out['metal'] = metal(col('#6b6f78'), col('#2a2c32'), 62, hammer=.4, streak=.6, rust=col('#5a3520'))
    return out

@world('deimos')    # the Bastion: the war moon's docks and batteries; gunmetal, armour plate, concrete, hazard stripes
def deimos():
    G, G_L, C, C_D, Y = col('#4a4e55'), col('#7a7f88'), col('#8c8a84'), col('#5d5b56'), col('#d9a62a')
    out = {}
    out['wall'] = panel_wall(C, C_D, col('#3a3936'), 2, 3, 72, 6, rivets=1, streaks=.35, grimec=col('#3a3936'))
    out['column'] = fluted(G_L, G, 6, 75, col('#2e3034'), sharp=True)
    a, h, r, e = window_strip(lambda: mix(C_D, C, fbm(46,4,4)*.5+.2), col('#101216'), col('#c8d8e0'), col('#34363c'), 5, 'slit', .3, 76, False, None, .12, .35, .6, 0, glow=False)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_tech(col('#56595f'), col('#2e3034'), Y, 78, 'hazard')
    out['pave'] = grid_tile(col('#8c8a84'), col('#5d5b56'), col('#3a3936'), 6, 79, grimec=col('#2e2d2a'))
    out['metal'] = metal(G_L, G, 82, brushed=.6, streak=.4, rust=col('#5a4030'))
    return out

@world('earth')     # Earth: the cradle, high-tech and proud of its history; travertine and polished marble, bronze inlay, glass, laurel, no rust
def earth():
    TR, TR_D, MB, MB_D, BZ, BZ_D = col('#efe6d6'), col('#c8b99d'), col('#f4f1ea'), col('#cdc8bd'), col('#b8863b'), col('#6b4c1e')
    out = {}
    a, h, r = panel_wall(TR, TR_D, BZ, 2, 4, 83, 5, streaks=0)                      # cut travertine panels with bronze seams
    g = fbm(84, 5, 10); a = a*(.92 + g[...,None]*.12); v = np.abs(fbm(85,3,2)-.5)*2; a = mix(a, TR_D*.95, np.clip((.03 - v)*20, 0, 1)*.25)  # faint travertine veining
    out['wall'] = (a, h, r*.8)
    out['column'] = fluted(MB, MB_D, 24, 86, col('#8a8070'))                          # Roman marble column
    a, h, r, e = window_strip(lambda: mix(TR_D, TR, fbm(47,4,4)*.6+.2), col('#17262c'), col('#fff0cc'), BZ, 5, 'rect', .55, 87, False, BZ, .08, .1, .9, 0)
    out['windows'] = (a, h, r, e)                                                    # tall glass in bronze frames under a bronze string course
    out['trim'] = frieze_classical(MB, BZ_D, BZ, 88, 'laurel')
    out['pave'] = grid_tile(col('#e6dfd0'), col('#bfb5a2'), BZ_D, 8, 89)                # polished stone with bronze joints
    out['metal'] = metal(col('#d9a74e'), col('#7a5a22'), 92, brushed=.8, hammer=0)   # polished bronze-gold
    return out

@world('_ice')      # the Rim: minimalist and serene; white plaster, dark timber, slate, matte ceramic, no ornament
def rim():
    out = {}
    out['wall'] = plaster_wall(col('#eef0f3'), col('#cfd4da'), 93, .06, grimec=col('#8a949c'))
    a, h, r = fluted(col('#5a4636'), col('#2e2219'), 4, 95, None, sharp=True)
    grain = np.abs(np.sin((YY + fbm(96, 3, 2)*.35)*N*.25)) ** 6; a = a*(1 - grain[...,None]*.35); h = h - grain*.2; r = r + .25   # timber grain
    out['column'] = (a, h, r)
    a, h, r, e = window_strip(lambda: mix(col('#c3c8cf'), col('#eef0f3'), fbm(48,3,3)*.5+.4), col('#1a222a'), col('#cfe8ff'), col('#3a2e24'), 3, 'rect', .5, 96, False, col('#3a2e24'), .14, .15, .85, 3)
    out['windows'] = (a, h, r, e)
    out['trim'] = frieze_tech(col('#e4e7eb'), col('#3a2e24'), col('#9fd3ff'), 98, 'plain')
    out['pave'] = grid_tile(col('#6e747c'), col('#3e434a'), col('#22262b'), 8, 99)
    out['metal'] = metal(col('#4e535a'), col('#23272c'), 102, brushed=.4)
    return out

NAMES = {'mercury':'Heliopolis (Mercury)','luna':'Hyperion (Luna)','mars':'Agea (Mars)','venus':'the Columns (Venus)','phobos':'the Hive (Phobos)','deimos':'the Bastion (Deimos)','earth':'Earth','_ice':'Rim colony'}
if __name__ == '__main__':
    import os; os.makedirs('out', exist_ok=True)
    worlds = sys.argv[1:] or list(W)
    for w in worlds:
        T = W[w]()
        sheet = Image.new('RGB', (6*300+20, 920), (30,30,30)); d = ImageDraw.Draw(sheet); d.text((12, 4), NAMES[w], fill=(240,240,240))
        for i, role in enumerate(['wall','column','windows','trim','pave','metal']):
            t = T[role]; a, h, r = t[0], t[1], t[2]
            save_set(f'{w}_{role}', a, h, r)
            if len(t) > 3: Image.fromarray((t[3]*255).astype(np.uint8)).save(f'out/{w}_{role}_e.png')
            im = pil(a); sheet.paste(im.resize((280,280)), (10+i*300, 20))
            q = im.resize((140,140)); tl = Image.new('RGB', (280,280))
            for aa in range(2):
                for bb in range(2): tl.paste(q, (aa*140, bb*140))
            sheet.paste(tl, (10+i*300, 320)); sheet.paste(Image.open(f'out/{w}_{role}_n.png').resize((280,280)), (10+i*300, 620)); d.text((12+i*300, 904), f'{role}   tiled 2x2 / normal', fill=(220,220,220))
        sheet.save(f'sheet_{w}.png'); print(w, 'done')
