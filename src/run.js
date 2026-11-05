import { BOSS_DEPTH } from './config.js';
import { heal } from './combat.js';
import { PATRONS } from './boons.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// ---- biomes: the dungeon changes look as you go deeper, and the cycle repeats every 10 depths ----
// torch: fire colour; sky/ground/sun: ambient and key light; grade: screen colour grade; stone: tint on every prop;
// glow/amb: torch and ambient strength (cold and green light read darker, so those biomes burn hotter); embers: floating particles; abyss: colour of the ruins in the void; slabs/broken/rubble/stains: how the floor is dressed
export const BIOMES = {
  cells: { name: 'The Cells', glow: 1, amb: 0.7, torch: 0xff9a50, sky: 0x8a6d60, ground: 0x131515, sun: 0xb8c0d0, grade: [1.0, 0.86, 0.68], stone: 0xffffff,
    embers: 0xffb070, abyss: 0x4a3a30, slabs: 0, broken: 0.05, rubble: 4, stains: 4 },
  crypt: { name: 'The Crypt', glow: 1.7, amb: 1.25, torch: 0x8fb4ff, sky: 0x7484a4, ground: 0x10141c, sun: 0xb0c4e8, grade: [0.84, 0.9, 1.0], stone: 0xd8e0ee,
    embers: 0xa8c8ff, abyss: 0x2a3448, slabs: 0.6, broken: 0.04, rubble: 3, stains: 2 },
  rot: { name: 'The Rot', glow: 1.4, amb: 1.05, torch: 0xa8d868, sky: 0x76885c, ground: 0x121610, sun: 0xc0d0a0, grade: [0.86, 0.96, 0.7], stone: 0xd8deba,
    embers: 0xb8e070, abyss: 0x2e3a24, slabs: 0.15, broken: 0.22, rubble: 10, stains: 6 },
  halls: { name: "The Warden's Halls", glow: 1.2, amb: 0.9, torch: 0xff5a3a, sky: 0x94564a, ground: 0x160c0c, sun: 0xdcb0a8, grade: [1.0, 0.7, 0.62], stone: 0xead0c8,
    embers: 0xff5a40, abyss: 0x4a1c18, slabs: 0.35, broken: 0.08, rubble: 5, stains: 12 },
};

export function biomeFor(depth) {
  const k = depth % (BOSS_DEPTH + 1);
  if (k === BOSS_DEPTH || (depth > 0 && k === 0)) return BIOMES.halls; // the Warden's room and the Lock after it
  return k <= 2 ? BIOMES.cells : k <= 5 ? BIOMES.crypt : BIOMES.rot;
}

// ---- room plans: Hades-style arenas merged from rectangles and ovals on a tile grid ----

const key = (x, z) => `${x},${z}`;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Each shape is a list of [kind, ...args] in tile units around the origin, sized by s
const SHAPES = {
  octagon: (s) => [['oct', 0, 0, s * 0.5]],
  cross: (s) => [['rect', -s * 0.2, -s * 0.5, s * 0.4, s], ['rect', -s * 0.5, -s * 0.2, s, s * 0.4], ['oct', 0, 0, s * 0.32]],
  tee: (s) => [['rect', -s * 0.5, -s * 0.5, s, s * 0.42], ['rect', -s * 0.22, -s * 0.2, s * 0.44, s * 0.7]],
  ell: (s) => [['rect', -s * 0.5, -s * 0.5, s * 0.5, s], ['rect', -s * 0.5, 0, s, s * 0.5], ['oct', -s * 0.1, -s * 0.05, s * 0.3]],
  wings: (s) => [['oval', 0, 0, s * 0.32, s * 0.48], ['rect', -s * 0.5, -s * 0.16, s, s * 0.32]],
  hall: (s) => [['rect', -s * 0.26, -s * 0.5, s * 0.52, s], ['rect', -s * 0.48, -s * 0.32, s * 0.24, s * 0.26], ['rect', s * 0.24, s * 0.04, s * 0.24, s * 0.26]],
};

function shapeTiles(name, s) {
  const set = new Set();
  const span = Math.ceil(s / 2) + 2;
  for (let x = -span; x < span; x++) for (let z = -span; z < span; z++) {
    const cx = x + 0.5, cz = z + 0.5;
    const inside = SHAPES[name](s).some(([k, a, b, c, d]) =>
      k === 'rect' ? cx >= a && cx <= a + c && cz >= b && cz <= b + d
        : k === 'oct' ? Math.abs(cx - a) <= c && Math.abs(cz - b) <= c && Math.abs(cx - a) + Math.abs(cz - b) <= c * 1.45
          : ((cx - a) / c) ** 2 + ((cz - b) / d) ** 2 <= 1);
    if (inside) set.add(key(x, z));
  }
  return set;
}

function arena(name, s) {
  let tiles = shapeTiles(name, s);
  // an alcove or two pushed out of random edges, so no two rooms share a silhouette
  const list = () => [...tiles].map((t) => t.split(',').map(Number));
  for (let a = rint(0, 2); a > 0; a--) {
    const [x, z] = pick(list());
    const [dx, dz] = pick(N4);
    if (tiles.has(key(x + dx * 2, z + dz * 2))) continue;
    for (let i = 1; i <= 3; i++) for (let j = -1; j <= 1; j++) tiles.add(dx ? key(x + dx * i, z + j) : key(x + j, z + dz * i));
  }
  // random quarter turn and mirror
  const r = rint(0, 3), m = Math.random() < 0.5;
  tiles = new Set(list().map(([x, z]) => {
    if (m) x = -x - 1;
    for (let i = 0; i < r; i++) [x, z] = [-z - 1, x];
    return key(x, z);
  }));
  // smooth: drop one-tile spurs, fill one-tile notches
  for (let pass = 0; pass < 2; pass++) {
    const n = (x, z) => N4.filter(([dx, dz]) => tiles.has(key(x + dx, z + dz))).length;
    for (const [x, z] of list()) if (n(x, z) <= 1) tiles.delete(key(x, z));
    for (const [x, z] of list()) for (const [dx, dz] of N4) { const vx = x + dx, vz = z + dz; if (!tiles.has(key(vx, vz)) && n(vx, vz) >= 3) tiles.add(key(vx, vz)); }
  }
  return tiles;
}

// A back wall at (wx, wz) would hide any floor just behind it from the camera; those edges get a low curb instead
export const occludes = (hasCentre, wx, wz) => [0.7, 1.4, 2.1, 2.8].some((t) => hasCentre(Math.floor(wx - t) + 0.5, Math.floor(wz - t) + 0.5));

// Door slots sit on straight 2-tile runs of back wall: 'z' walls face down-right, 'x' walls face down-left
function doorSlots(tiles, entry) {
  const has = (x, z) => tiles.has(key(x, z)), cands = [];
  const hasC = (cx, cz) => tiles.has(key(cx - 0.5, cz - 0.5));
  for (const t of tiles) {
    const [x, z] = t.split(',').map(Number);
    if (has(x + 1, z) && !has(x, z - 1) && !has(x + 1, z - 1) && has(x, z + 1) && has(x + 1, z + 1) && !occludes(hasC, x + 1, z)) cands.push({ wall: 'z', x: x + 1, z, score: x + z });
    if (has(x, z + 1) && !has(x - 1, z) && !has(x - 1, z + 1) && has(x + 1, z) && has(x + 1, z + 1) && !occludes(hasC, x, z + 1)) cands.push({ wall: 'x', x, z: z + 1, score: x + z });
  }
  const far = (a, list, d) => list.every((b) => Math.hypot(a.x - b.x, a.z - b.z) >= d);
  const usable = cands.filter((c) => Math.hypot(c.x - entry[0], c.z - entry[1]) >= 6).sort((a, b) => a.score - b.score);
  const out = [];
  for (const wall of ['z', 'x']) { const c = usable.find((u) => u.wall === wall && far(u, out, 4)); if (c) out.push(c); }
  const extra = usable.find((u) => far(u, out, 4));
  if (extra) out.push(extra);
  return out;
}

export function makePlan(depth, kind, reward = null, patron = null) {
  const combat = kind === 'combat' || kind === 'elite';
  const size = kind === 'boss' ? 24 : combat ? 17 + 2 * rint(0, 2) : kind === 'start' ? 14 : 12;
  const shapes = kind === 'boss' ? ['octagon', 'cross'] : combat ? Object.keys(SHAPES) : ['octagon', 'wings'];
  let tiles, slots, entry, center, interior;
  for (let tries = 0; tries < 30; tries++) {
    tiles = arena(pick(shapes), size);
    const all = [...tiles].map((t) => t.split(',').map(Number));
    interior = all.filter(([x, z]) => N4.every(([dx, dz]) => tiles.has(key(x + dx, z + dz))));
    // enter at the front-most interior tile (bottom of the screen); the reward lands near the middle
    const front = interior.reduce((a, b) => (b[0] + b[1] > a[0] + a[1] ? b : a));
    entry = [front[0] + 0.5, front[1] + 0.5];
    const cx = all.reduce((a, [x]) => a + x, 0) / all.length, cz = all.reduce((a, [, z]) => a + z, 0) / all.length;
    const mid = interior.reduce((a, b) => (Math.hypot(b[0] - cx, b[1] - cz) < Math.hypot(a[0] - cx, a[1] - cz) ? b : a));
    center = [mid[0] + 0.5, mid[1] + 0.5];
    slots = doorSlots(tiles, entry);
    if (slots.length >= 3 || (slots.length >= 2 && tries > 10) || (slots.length >= 1 && tries > 25)) break;
  }
  const centres = [...tiles].map((t) => t.split(',').map((v) => Number(v) + 0.5));
  const away = ([x, z], pts, d) => pts.every(([px, pz]) => Math.hypot(px - x, pz - z) >= d);
  const doorPts = slots.map((sl) => [sl.x, sl.z]);
  const plan = { depth, kind, reward, patron, biome: biomeFor(depth), tiles: centres, slots, entry, center, pillars: [], traps: [], waves: [] };

  if (combat || kind === 'boss') {
    // Everything is laid out around the room's true middle (the centre of the carved 2x2 seal) in mirrored sets,
    // so it reads as built. A set that hits the void is dropped whole; a copy that would block a doorway is left out.
    const O = [center[0] + 0.5, center[1] + 0.5];
    const has = (x, z) => tiles.has(key(x - 0.5, z - 0.5));
    const clear = (p) => away(p, [entry], 3) && away(p, doorPts, 2.5);
    const turn = Math.random() < 0.5; // two-way sets run across the screen or up it
    const place = (sets, fits) => sets.flatMap(([a, b, n], i) => {
      if (turn && n === 2) [a, b] = [-b, a];
      const pts = (n === 1 ? [[a, b]] : n === 2 ? [[a, b], [-a, -b]] : [[a, b], [-b, a], [-a, -b], [b, -a]]).map(([dx, dz]) => [O[0] + dx, O[1] + dz]);
      return pts.every(fits) ? pts.filter(clear).map((p) => [...p, i]) : [];
    });
    const seal = [0, 1].every((dx) => [0, 1].every((dz) => has(center[0] + dx, center[1] + dz)));
    const solid = ([x, z]) => (x === O[0] && z === O[1]) ? seal && has(O[0] + 1.5, O[1] + 1.5) // the centre pillar stands in the seal
      : [-1, 0, 1].every((dx) => [-1, 0, 1].every((dz) => has(x + dx, z + dz)));
    const layout = pick(kind === 'boss' ? BOSS_PILLARS : PILLARS);
    plan.pillars = place(layout, solid).map(([x, z]) => [x, z]);
    // the reward can't land inside a centre pillar, so it drops just in front of it
    if (plan.pillars.some(([x, z]) => x === O[0] && z === O[1])) plan.drop = [O[0] + 1.2, O[1] + 1.2];
    if (depth >= 2) {
      const floorOk = (p) => N4.every(([dx, dz]) => has(p[0] + dx, p[1] + dz)) && away(p, plan.pillars, 1.5) && away(p, [O], 2.5);
      // "corners" pushes the four sets as far out as the room allows
      const sets = trapSets(depth);
      if (sets[0][0] === 'corner') {
        for (let r = 7.5; r >= 2.5; r--) {
          const s = sets.slice(1).map(([a, b, n]) => [a + r, b + r, n]);
          if (place(s.slice(0, 1), floorOk).length) { plan.traps = place(s, floorOk); break; }
        }
      } else plan.traps = place(sets, floorOk);
    }
  }
  plan.waves = kind === 'boss' ? [[pick(BOSSES)]] : combat ? rollWaves(depth, kind) : [];
  return plan;
}

// Pillar layouts: [dx, dz, copies] from the middle. 1 = the centre itself, 2 = mirrored, 4 = turned four ways.
const PILLARS = [
  [], [],
  [[0, 0, 1]],                      // one pillar in the dead centre
  [[2.5, 2.5, 4]],                  // a square of four around the middle
  [[3.5, 3.5, 4]],                  // the same, wider
  [[2.5, -2.5, 2], [4.5, -4.5, 2]], // a colonnade through the middle
  [[0, 0, 1], [3.5, 3.5, 4]],       // the centre and four around it
];
const BOSS_PILLARS = [[[3.5, 3.5, 4]], [[4.5, 4.5, 4]], [[0, 0, 1], [4.5, 4.5, 4]]];
export const BOSSES = ['warden', 'prior', 'reaver'];

// Trap layouts get busier with depth. Each set's spikes fire together, and the sets take turns.
function trapSets(depth) {
  const corners = ['corner', [0, 0, 4]], cluster = ['corner', [0, 0, 4], [-1, 0, 4], [0, -1, 4]];
  const ring = [[0.5, 2.5, 4], [-0.5, 2.5, 4]];
  const lanes = [[2.5, 0.5, 2], [1.5, 1.5, 2], [0.5, 2.5, 2]];
  return pick([corners, depth >= 3 && lanes, depth >= 4 && ring, depth >= 6 && cluster].filter(Boolean));
}

function rollWaves(depth, kind) {
  const pool = ['grunt', 'grunt'];
  if (depth >= 2) pool.push('hexer', 'sapper');
  if (depth >= 3) pool.push('stalker', 'shieldbearer');
  if (depth >= 4) pool.push('slinger', 'whirler');
  if (depth >= 5) pool.push('hexer', 'grunt', 'stalker', 'slinger');
  if (depth >= 6) pool.push('bonecaller');
  const count = depth >= 12 ? 3 : kind === 'elite' || depth >= 4 ? 2 : 1;
  const waves = [];
  for (let w = 0; w < count; w++) {
    const wave = Array.from({ length: Math.min(12, 2 + Math.floor(depth * 0.5) + w) }, () => pick(pool));
    if (kind === 'elite' || (depth >= 3 && w === count - 1 && Math.random() < 0.5)) wave.push('brute');
    if (kind === 'elite' && depth >= 5) wave.push('brute');
    waves.push(wave);
  }
  return waves;
}

// ---- door choices ----

// What the next room offers is shown above its door, Hades-style. Keys are scarce: vaults cost one, and so does the Lock.
export function rollDoors(depth, run) {
  // endless: the Warden returns every 10 depths, and each Lock offers escape (with a key) or the way deeper
  const cycle = BOSS_DEPTH + 1;
  if (depth % cycle === BOSS_DEPTH) return [{ kind: 'exit', reward: null }];
  if (depth % cycle === BOSS_DEPTH - 1) return [{ kind: 'boss', reward: null }];
  const lock = depth > 0 && depth % cycle === 0;
  const next = depth + 1;
  const pool = [
    { kind: 'combat', reward: 'boon' }, { kind: 'combat', reward: 'boon' }, { kind: 'combat', reward: 'boon' },
    { kind: 'combat', reward: 'ash' }, { kind: 'combat', reward: 'key' }, { kind: 'combat', reward: 'heal' },
  ];
  if (next >= 3) pool.push({ kind: 'elite', reward: 'boon' }, { kind: 'elite', reward: 'key' }, { kind: 'combat', reward: 'pom' });
  if (next >= 2) pool.push({ kind: 'fountain', reward: 'heal' });
  const a = pick(pool);
  let b = pick(pool);
  for (let i = 0; i < 10 && b.kind === a.kind && b.reward === a.reward; i++) b = pick(pool);
  const doors = [{ ...a }, { ...b }];
  // the first room always offers a patron, and each run sees a couple of keys
  if (next === 1) doors[0] = { kind: 'combat', reward: 'boon' };
  if (!doors.some((d) => d.reward === 'key') && (next === 3 || next === 6) && run.keyDoorsSeen < 2) doors[1] = { kind: 'combat', reward: 'key' };
  if (next >= 2 && Math.random() < 0.4) doors.push({ kind: 'vault', reward: 'treasure', locked: true });
  // boon doors name their patron, and two boon doors never offer the same one
  const patrons = Object.keys(PATRONS).sort(() => Math.random() - 0.5);
  for (const d of doors) if (d.reward === 'boon' || d.reward === 'treasure') d.patron = patrons.pop();
  run.keyDoorsSeen += doors.filter((d) => d.reward === 'key').length;
  return lock ? [{ kind: 'gate', reward: null, locked: true }, ...doors.slice(0, 2)] : doors;
}

// ---- XP levels within a run ----

export const XP_FOR = { zombie: 2, crawler: 3, bloater: 6, grunt: 3, hexer: 4, stalker: 5, sapper: 3, whirler: 7, slinger: 4, shieldbearer: 6, bonecaller: 6, brute: 9, warden: 40, prior: 40, reaver: 40 };
export const xpToNext = (level) => 10 + (level - 1) * 8;

export const PERKS = [
  { id: 'vigor', name: 'Vigor', desc: '+15 max health, and heal 15', apply: (p) => { p.maxHp += 15; heal(p, 15); } },
  { id: 'might', name: 'Might', desc: '+10% damage with everything', apply: (p) => { p.mods.atk *= 1.1; p.mods.spc *= 1.1; p.mods.cast *= 1.1; } },
  { id: 'haste', name: 'Haste', desc: '+8% move speed', apply: (p) => { p.mods.speed *= 1.08; } },
  { id: 'flurry', name: 'Flurry', desc: 'Attack 10% faster', apply: (p) => { p.mods.atkCd *= 0.9; } },
  { id: 'focus', name: 'Focus', desc: 'Special recovers 15% faster', apply: (p) => { p.mods.spcCd *= 0.85; } },
  { id: 'pouch', name: 'Deep Pockets', desc: '+1 Cast shard', apply: (p) => { p.maxAmmo++; p.ammo++; } },
  { id: 'fleet', name: 'Fleet', desc: 'Dash recharges 15% faster', apply: (p) => { p.mods.dashCd *= 0.85; } },
  { id: 'leech', name: 'Leech', desc: 'Heal 2 per kill', apply: (p) => { p.mods.lifesteal += 2; } },
  { id: 'thorns', name: 'Thorns', desc: 'Attackers take 6 damage', apply: (p) => { p.mods.thorns += 6; } },
];

export function rollPerks() {
  return [...PERKS].sort(() => Math.random() - 0.5).slice(0, 3);
}

// ---- persistent upgrades between runs ----

const SAVE_KEY = 'dungeonlock.meta.v1';
const DEFAULT_META = {
  ash: 0, vitality: 0, whetstone: 0, quickstep: 0, sparekey: 0, lastbreath: 0, shards: 0, favor: 0, greed: 0, insight: 0,
  runs: 0, escapes: 0, bestDepth: 0,
};

export const meta = (() => {
  try { return { ...DEFAULT_META, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch { return { ...DEFAULT_META }; }
})();

export function saveMeta() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(meta)); } catch { /* private mode: progress lasts this session only */ }
}

export const UPGRADES = [
  { id: 'vitality', name: 'Vitality', desc: '+10 max health', max: 5, cost: (l) => 15 + l * 15 },
  { id: 'whetstone', name: 'Whetstone', desc: '+8% damage', max: 5, cost: (l) => 20 + l * 20 },
  { id: 'lastbreath', name: 'Last Breath', desc: 'Survive a killing blow once per run, per level', max: 2, cost: (l) => 80 + l * 90 },
  { id: 'shards', name: 'Shard Pouch', desc: '+1 Cast shard', max: 2, cost: (l) => 40 + l * 50 },
  { id: 'quickstep', name: 'Quickstep', desc: 'Dash recharges 8% faster', max: 3, cost: (l) => 25 + l * 25 },
  { id: 'favor', name: "Patron's Favor", desc: 'Better odds of Rare and Epic boons', max: 3, cost: (l) => 30 + l * 35 },
  { id: 'insight', name: 'Insight', desc: 'Reroll a boon offer once per run, per level', max: 2, cost: (l) => 50 + l * 60 },
  { id: 'greed', name: 'Greed', desc: '+15% Ash carried out of every run', max: 3, cost: (l) => 25 + l * 30 },
  { id: 'sparekey', name: 'Spare Key', desc: 'Start each run holding a key', max: 1, cost: () => 120 },
];
