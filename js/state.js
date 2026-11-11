// Shared mutable game state. Every module reads and writes through S.
// Teams: 0 = player, 1 = AI, 2 = neutral (derelicts, unclaimed stations and platforms).
export const S = {
  ships: [], shots: [], missiles: [], parts: [], debris: [], rings: [], flashes: [], nodes: [], markers: [], fields: [], cmdrs: [],
  stations: [null, null], res: [0, 0], ore: [0, 0], ord: [0, 0], man: [0, 0], prodLog: [{}, {}], stats: {}, time: 0, selection: [], groups: {}, builder: null,
  difficulty: 1, gameState: 'menu', paused: false, speed: 1, showVec: true, bloom: true, fogT: 0, incomeLog: [],
  screenFlash: 0, aiNukeT: 0, inspect: null, nid: 0, legion: [0, 0], aggro: [-99, -99, -99],
  choice: { player: 'rising', ai: 'core' }, fac: ['rising', 'core'], fdefs: [null, null, null], teamc: [null, null, null], roster: [],
  cam: { x: 0, y: 0, z: .3 }, W: innerWidth, H: innerHeight,
  mouse: { x: 0, y: 0, down: false, bx: 0, by: 0, mid: false, lmx: 0, lmy: 0, inCanvas: true },
  amode: false, nmode: false,
  AI: { t: 0, attacking: false, threshold: 700, sentValue: 0 },
};
