// The camera: a perspective view over the game plane at a tilt.
// S.cam.{x,y} is the ground point at the screen centre; S.cam.z is pixels per world unit there.
// World (x, y, height) maps to render space (x, height, y): screen-down is world +y, as in 2D.
// The tilt (ELEV) and the bearing (AZ, round the vertical) can change: the follow camera drops low and orbits its
// ship. Everything that maps between the screen and the world goes through projectTo and toWorld below, which read
// the same live values, so the two always agree.
import { S } from './state.js';

export const FOV = 36;                    // vertical field of view, degrees
export const ELEV0 = 55 * Math.PI / 180;  // the normal elevation above the plane
export const TANH = Math.tan(FOV * Math.PI / 360);
export let ELEV = ELEV0, SE = Math.sin(ELEV), CE = Math.cos(ELEV), AZ = 0, SA = 0, CA = 1;
// set the tilt and the bearing; AZ 0 is the normal view, north up
export function setView(elev, az = 0) {
  ELEV = Math.min(85, Math.max(24, elev * 180 / Math.PI)) * Math.PI / 180; SE = Math.sin(ELEV); CE = Math.cos(ELEV);
  AZ = ((az % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; SA = Math.sin(AZ); CA = Math.cos(AZ);
}
export const viewIsDefault = () => Math.abs(ELEV - ELEV0) < 1e-4 && Math.abs(AZ) < 1e-4;

export const camDist = (z = S.cam.z) => S.H / (2 * TANH * z);
// where the camera sits relative to the ground point it looks at, in render space
export const camOffset = (d = camDist()) => [-d * CE * SA, d * SE, d * CE * CA];

// screen pixel → point on the game plane
export function toWorld(sx, sy) {
  const d = camDist(), A = S.W / S.H;
  const nx = (sx - S.W / 2) / (S.W / 2) * TANH * A, ny = -(sy - S.H / 2) / (S.H / 2) * TANH;
  const dx = nx, dy = -SE + ny * CE, dz = -CE - ny * SE;   // forward + right·nx + up·ny
  const t = -(d * SE) / Math.min(dy, -1e-6);
  const lx = t * dx, ly = d * CE + t * dz;                  // in the camera's bearing; turned back to the world's
  return [S.cam.x + lx * CA - ly * SA, S.cam.y + lx * SA + ly * CA];
}

// world point (with optional height) → screen; writes into o = {x, y, k, ok}; k is pixels per world unit at that depth
export function projectTo(o, x, y, h = 0) {
  const d = camDist(), X = x - S.cam.x, Y = y - S.cam.y, lx = X * CA + Y * SA, ly = -X * SA + Y * CA;
  const rx = lx, ry = h - d * SE, rz = ly - d * CE;
  const cy = ry * CE - rz * SE, depth = -SE * ry - CE * rz;
  if (depth < d * .02) { o.ok = false; o.x = o.y = -1e5; o.k = 0; return o; }
  const k = (S.H / 2) / (TANH * depth);
  o.x = S.W / 2 + rx * k; o.y = S.H / 2 - cy * k; o.k = k; o.ok = true; return o;
}
const P0 = { x: 0, y: 0, k: 0, ok: false };
export function project(x, y, h = 0) { projectTo(P0, x, y, h); return [P0.x, P0.y, P0.k, P0.ok]; }
export function onScr(x, y, m = 0, h = 0) {
  projectTo(P0, x, y, h); return P0.ok && P0.x > -m && P0.y > -m && P0.x < S.W + m && P0.y < S.H + m;
}
// a world heading as it looks on screen (for icons drawn flat on the overlay)
export const screenAng = a => Math.atan2(Math.sin(a - AZ) * SE, Math.cos(a - AZ));
// the ground footprint of the screen: its four corners in world units (the tilt never drops low enough for the top edge to miss the plane)
export function footprint() { return [toWorld(0, 0), toWorld(S.W, 0), toWorld(S.W, S.H), toWorld(0, S.H)]; }
