export const TAU = Math.PI * 2, PI = Math.PI;
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const hyp = Math.hypot;
export function angDiff(a, b) { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; }
export const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
export function segHit(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  let t = l2 ? ((cx - x0) * dx + (cy - y0) * dy) / l2 : 0; t = clamp(t, 0, 1);
  const px = x0 + dx * t - cx, py = y0 + dy * t - cy; return px * px + py * py <= r * r ? t : -1;
}
export const hex = s => parseInt(s.slice(1), 16);
export const pct = v => Math.round(clamp(v, 0, 1) * 100);
