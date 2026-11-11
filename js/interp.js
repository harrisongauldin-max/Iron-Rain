// Drawing between simulation steps.
// The sim runs at a fixed 1/60 s, but the screen draws at the monitor's own rate: at 144 Hz most frames would get no
// new step and ships would stutter (at ¼ speed they would move only 15 times a second). So before each step snap()
// keeps where everything was, and for the length of a frame lerpIn() moves every moving thing to where it is that far
// into the next step, then lerpOut() puts the sim's own values back. The sim never sees the drawn positions.
import { S } from './state.js';

const TAU = Math.PI * 2;
const LISTS = ['ships', 'missiles', 'shots', 'wrecks', 'hulks', 'debris', 'parts', 'flashes'];
const ANGLED = { ships: 1, missiles: 1, wrecks: 1, hulks: 1, debris: 1 };
let swapped = null; // the lists moved by lerpIn, so lerpOut restores exactly those

export function snap() {
  for (const k of LISTS) { const L = S[k]; if (!L) continue; const ang = ANGLED[k];
    for (let i = 0; i < L.length; i++) { const o = L[i]; o._pX = o.x; o._pY = o.y; if (ang) o._pA = o.a; } }
}

// t: how far into the next step the clock is, 0..1; st: the step length, to tell a jump (a ship placed on the field,
// a slot reset) from flight: anything that moved further than it could fly in a few steps is drawn where it is
export function lerpIn(t, st) {
  if (swapped) return; t = t > 0 ? Math.min(1, t) : 0; // at 0 she is drawn where the last step began, at 1 where it ended
  swapped = [];
  const u = 1 - t;
  for (const k of LISTS) { const L = S[k]; if (!L || !L.length) continue; swapped.push(L); const ang = ANGLED[k], ships = k === 'ships';
    for (let i = 0; i < L.length; i++) { const o = L[i]; o._sX = undefined; if (o._pX === undefined) continue;
      const dx = o.x - o._pX, dy = o.y - o._pY;
      if (ang) { const vx = o.vx || 0, vy = o.vy || 0, far = Math.sqrt(vx * vx + vy * vy) * st * 4 + 60; if (dx * dx + dy * dy > far * far) continue; }
      o._sX = o.x; o._sY = o.y; const ox = -dx * u, oy = -dy * u; o.x += ox; o.y += oy;
      if (ang && o._pA !== undefined) { let d = o.a - o._pA; d -= TAU * Math.round(d / TAU); o._sA = o.a; o.a -= d * u; }
      if (ships && o.weapons) for (const w of o.weapons) if (w.mx !== undefined) { w.mx += ox; w.my += oy; } // her gun mounts ride with her
    } }
}

export function lerpOut() {
  if (!swapped) return;
  for (const L of swapped) for (let i = 0; i < L.length; i++) { const o = L[i]; if (o._sX === undefined) continue;
    const ox = o._sX - o.x, oy = o._sY - o.y; o.x = o._sX; o.y = o._sY; if (o._sA !== undefined) { o.a = o._sA; o._sA = undefined; }
    if (o.weapons) for (const w of o.weapons) if (w.mx !== undefined) { w.mx += ox; w.my += oy; }
    o._sX = undefined; }
  swapped = null;
}
