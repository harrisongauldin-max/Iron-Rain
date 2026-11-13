// Faces for the commanders: a portrait drawn from what the game knows of them, so the same officer always looks the
// same. Colour sets hair and eyes (a Gold's eyes and hair are gold, an Obsidian's hair is pale, a Red's is rust red),
// age greys the hair and lines the face, a Peerless Scarred carries the Institute's scar across the cheek, rank shows
// on the collar and the power's colour on the coat. Plain SVG, no assets.
import { FACTIONS } from './data.js';

const SIDE = { rep: 'rising', soc: 'core', rim: 'rim' };
// hair and eyes by Colour; skin is the officer's own
const COL = {
  Gold:     { hair: ['#e8c25a', '#d9a93a', '#f0d27a', '#c99a2e'], eye: '#e3b53c' },
  Red:      { hair: ['#9c3b25', '#b4472c', '#7e2c1d'], eye: '#9a4a3a' },
  Gray:     { hair: ['#6f6a64', '#4a4643', '#8a857e'], eye: '#7e8a91' },
  Obsidian: { hair: ['#e9e6dc', '#d8d4c8'], eye: '#c7d3dc' },
  Blue:     { hair: ['#2b3446', '#1f2533'], eye: '#4f86d6' },
  Silver:   { hair: ['#c9cbd0', '#a9acb3'], eye: '#b9bec7' },
  Copper:   { hair: ['#8a5a36', '#6d4428'], eye: '#b9783e' },
  Violet:   { hair: ['#4a2f5c', '#2e1f3a'], eye: '#9b6fc2' },
  Green:    { hair: ['#2f3a2a', '#1f241c'], eye: '#5e9a52' },
  Orange:   { hair: ['#a5541f', '#7d3d14'], eye: '#c9762e' },
  Yellow:   { hair: ['#a08b3c', '#7e6b2a'], eye: '#c2a63e' },
  Brown:    { hair: ['#4a3426', '#33241a'], eye: '#6b4a32' },
  Pink:     { hair: ['#c98a8f', '#a86a70'], eye: '#c47d86' },
};
const SKIN = ['#e9c6a5', '#d8ab83', '#c08b62', '#a06b45', '#7b4e31', '#f1d3b8', '#b97f58'];
// who is a woman: the books' characters as written, and the officers the game raises by their first names
const WOMEN = new Set(['Virginia', 'Victra', 'Atalantia', 'Kalindora', 'Seraphina', 'Dido', 'Thraxa', 'Valeria', 'Orion', 'Livia', 'Drusilla', 'Octavia', 'Aurelia', 'Junia', 'Thalia', 'Vela', 'Lyra', 'Mira', 'Mara', 'Cyra', 'Syl', 'Deanna', 'Ria']);
const MEN = new Set(['Darrow', 'Sevro', 'Kavax', 'Ajax', 'Atlas', 'Rhone', 'Diomedes', 'Romulus', 'Lysander', 'Magnus', 'Daxo', 'Publius', 'Dancer', 'Volsung', 'Lucan', 'Tactus', 'Marius', 'Severus', 'Quintus', 'Felix', 'Cato', 'Galen', 'Nero', 'Corvus', 'Pallas', 'Silenus', 'Titus', 'Trigg', 'Holtz', 'Kell', 'Brin', 'Ion', 'Pell', 'Quill', 'Kieran', 'Loran', 'Narol']);
export const isWoman = c => { const f = String(c.name || '').split(' ')[0]; return WOMEN.has(f) ? true : MEN.has(f) ? false : null; };
// a small hash, so a commander's face is fixed by who they are
function seedOf(c) { const s = (c.name || '') + '|' + (c.owner || '') + '|' + (c.id || 0); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const mix = (a, b, k) => { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)), A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
let uid = 0;
// the face itself. opts.size: pixel size (square); opts.dead: drawn in grey, as in the Chronicle
export function faceSVG(c, opts = {}) {
  if (!c) return '';
  const r = rng(seedOf(c)), size = opts.size || 56, id = 'fz' + (++uid);
  const F = FACTIONS[SIDE[c.owner]], coat = F ? F.col.main : '#6a6f78', coat2 = mix(coat, '#000000', .55);
  const P = COL[c.colour] || COL.Gold, age = c.age || 35, old = Math.max(0, Math.min(1, (age - 42) / 30));
  const skin = pick(r, SKIN), shade = mix(skin, '#2a1408', .35), hair = mix(pick(r, P.hair), '#d8d6d0', old * .75);
  const g = c.fem != null ? c.fem : isWoman(c), female = g != null ? g : r() < .42, jaw = female ? 15 : 17 + r() * 2, faceW = female ? 15.5 : 17;
  const scar = (c.talents || []).some(t => t === 'peerless') || /Peerless/.test(c.title || '');
  const style = pick(r, female ? ['long', 'bun', 'crop', 'braid'] : ['crop', 'shaved', 'swept', 'long', 'crop']);
  const rank = c.rank || 0, browY = 33 + r() * 1.5, eyeY = 37, eyeS = 4.2 + r() * .8, noseL = 6 + r() * 2;
  // hair behind the head (long styles), the head, the hair in front
  const back = style === 'long' ? `<path d="M14 30 Q12 58 20 66 L44 66 Q52 58 50 30 Z" fill="${hair}"/>` : style === 'braid' ? `<path d="M40 40 Q50 52 44 70 L40 70 Q46 54 36 42 Z" fill="${hair}"/>` : '';
  const front = {
    crop: `<path d="M${32 - faceW} 34 Q${32 - faceW} 14 32 13 Q${32 + faceW} 14 ${32 + faceW} 34 Q${30 + faceW} 23 32 22 Q${34 - faceW} 23 ${32 - faceW} 34 Z" fill="${hair}"/>`,
    shaved: `<path d="M${32 - faceW} 31 Q${32 - faceW} 16 32 15 Q${32 + faceW} 16 ${32 + faceW} 31 Q32 22 ${32 - faceW} 31 Z" fill="${hair}" opacity=".55"/>`,
    swept: `<path d="M${31 - faceW} 36 Q${30 - faceW} 12 34 12 Q${33 + faceW} 13 ${33 + faceW} 30 Q${28 + faceW} 18 ${20} 26 Q${33 - faceW} 30 ${31 - faceW} 36 Z" fill="${hair}"/>`,
    long: `<path d="M${31 - faceW} 40 Q${30 - faceW} 12 32 12 Q${34 + faceW} 12 ${33 + faceW} 40 Q${31 + faceW} 22 32 20 Q${33 - faceW} 22 ${31 - faceW} 40 Z" fill="${hair}"/>`,
    bun: `<circle cx="32" cy="10" r="6" fill="${hair}"/><path d="M${32 - faceW} 33 Q${32 - faceW} 14 32 14 Q${32 + faceW} 14 ${32 + faceW} 33 Q${30 + faceW} 22 32 21 Q${34 - faceW} 22 ${32 - faceW} 33 Z" fill="${hair}"/>`,
    braid: `<path d="M${32 - faceW} 34 Q${32 - faceW} 13 32 13 Q${32 + faceW} 13 ${32 + faceW} 34 Q${30 + faceW} 22 32 21 Q${34 - faceW} 22 ${32 - faceW} 34 Z" fill="${hair}"/>`,
  }[style];
  const lines = old > .2 ? `<path d="M${32 - faceW + 4} 44 q3 2 6 1 M${32 + faceW - 4} 44 q-3 2 -6 1" stroke="${shade}" stroke-width=".6" fill="none" opacity="${.3 + old * .5}"/>` : '';
  const beard = !female && r() < .28 ? `<path d="M${32 - jaw + 2} 44 Q32 ${62 + r() * 3} ${32 + jaw - 2} 44 Q32 54 ${32 - jaw + 2} 44 Z" fill="${hair}" opacity=".85"/>` : '';
  const scarP = scar ? `<path d="M${36 + r() * 2} 29 L${44 + r() * 2} 49" stroke="#f3d9cf" stroke-width="1.6" stroke-linecap="round" opacity=".9"/><path d="M${36 + r() * 2} 29 L${44 + r() * 2} 49" stroke="#8a3b33" stroke-width=".6" opacity=".6"/>` : '';
  const stars = Array.from({ length: rank + 1 }, (_, i) => `<circle cx="${23 + i * 3.2}" cy="73" r="1.1" fill="#f1d68a"/>`).join('');
  const eye = x => `<ellipse cx="${x}" cy="${eyeY}" rx="${eyeS * .62}" ry="${eyeS * .36}" fill="#f4efe6"/><circle cx="${x}" cy="${eyeY}" r="${eyeS * .3}" fill="${P.eye}"/><circle cx="${x}" cy="${eyeY}" r="${eyeS * .13}" fill="#141414"/><path d="M${x - eyeS * .7} ${eyeY - .4} q${eyeS * .7} -${eyeS * .55} ${eyeS * 1.4} 0" stroke="${shade}" stroke-width=".7" fill="none"/>`;
  const svg = `<svg class="face${opts.dead ? ' dead' : ''}" viewBox="0 0 64 80" width="${size}" height="${Math.round(size * 1.25)}" role="img" aria-label="${(c.name || '').replace(/"/g, '')}">
<defs><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(coat, '#0b0d12', .55)}"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
<radialGradient id="${id}s" cx=".42" cy=".38" r=".75"><stop offset="0" stop-color="${mix(skin, '#ffffff', .12)}"/><stop offset=".7" stop-color="${skin}"/><stop offset="1" stop-color="${shade}"/></radialGradient></defs>
<rect width="64" height="80" fill="url(#${id}b)"/>${back}
<path d="M6 80 Q8 62 22 58 L42 58 Q56 62 58 80 Z" fill="${coat2}"/><path d="M22 58 L32 70 L42 58 L38 57 L32 64 L26 57 Z" fill="${coat}"/>${stars}
<path d="M27 50 L27 59 Q32 62 37 59 L37 50 Z" fill="${shade}"/>
<path d="M${32 - faceW} 34 Q${32 - faceW} 18 32 17 Q${32 + faceW} 18 ${32 + faceW} 34 Q${32 + jaw - 2} 52 32 ${55 + (female ? -1 : 1)} Q${32 - jaw + 2} 52 ${32 - faceW} 34 Z" fill="url(#${id}s)"/>
${eye(25.5)}${eye(38.5)}<path d="M21.5 ${browY} q4 -2.2 8 -.6 M34.5 ${browY - .6} q4 -1.6 8 .6" stroke="${mix(hair, '#000000', .3)}" stroke-width="${female ? 1 : 1.5}" fill="none" stroke-linecap="round"/>
<path d="M32 ${eyeY + 1} l-1.6 ${noseL} q1.6 1 3.2 0" stroke="${shade}" stroke-width=".8" fill="none"/>
<path d="M27.5 ${eyeY + noseL + 6} q4.5 ${female ? 1.6 : .8} 9 0" stroke="${female ? '#9a5550' : mix(shade, '#000000', .2)}" stroke-width="${female ? 1.3 : 1}" fill="none" stroke-linecap="round"/>
${lines}${beard}${scarP}${front}</svg>`;
  return svg.replace(/\n/g, '');
}
