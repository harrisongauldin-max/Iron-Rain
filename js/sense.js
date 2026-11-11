// What one ship can know of another: the shared rules behind fire-control locks (sim.js) and sensor contacts
// (sensors.js). The emission a ship puts out is worked out each tick in sim.js as s.sig.
import { S } from './state.js';
import { angDiff } from './util.js';
import { passiveOf, lockOf, EMIT, WASH } from './data.js';

// the nuclear blasts whose wash still blinds the sensors round them
export const washes = () => (S.wash || (S.wash = [])).filter(w => S.time - w.t < WASH.T);
export function addWash(x, y) { S.wash = washes(); S.wash.push({ x, y, t: S.time }); }
// a target inside a fresh blast is lost to every sensor
export const inWash = s => (S.wash || []).some(w => S.time - w.t < WASH.hideT && Math.hypot(w.x - s.x, w.y - s.y) < WASH.hideR);
const blinded = o => (S.wash || []).some(w => S.time - w.t < WASH.T && Math.hypot(w.x - o.x, w.y - o.y) < WASH.R);

// how far observer o reaches toward target s, before her emission is counted: the Sun's glare, the ground, damage, a blast
export function reachK(o, s) {
  let k = (S.env ? S.env.sight : 1) * (o.disabledK || 1);
  const dx = s.x - o.x, dy = s.y - o.y, sunward = Math.abs(angDiff(Math.atan2(-o.y, -o.x), Math.atan2(dy, dx)));
  if (s.glare > S.time && sunward < .45) k *= .35; /* they came at you out of the Sun */
  else if (S.env && S.env.sun && sunward < .5) k *= .55; /* near the Sun, anything sunward of you is half lost in the glare */
  if (blinded(o)) k *= WASH.blindK;
  return k;
}
// what the target shows to this observer: a picket hears a cold ship at twice the range
const emitFor = (o, s) => Math.min(1, (s.sig ?? 1) * (o.picket || o.type === 'scout' ? 2 : 1));
// the range at which o holds a fire-control lock on s
export const lockRange = (o, s) => lockOf(o) * reachK(o, s) * Math.min(1, emitFor(o, s) / EMIT.lockFull);
// the range at which o picks s up as a contact
export const detectRange = (o, s) => passiveOf(o) * (o.picket || o.type === 'scout' ? 1.5 : 1) * reachK(o, s) * emitFor(o, s);
