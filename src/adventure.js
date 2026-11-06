import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { basic } from './render.js';
import { makePlan } from './run.js';
import { spawnEnemy } from './enemies.js';
import { noise, WATER, SAND, MEADOW, GRASS, FOREST } from './wild.js';
import { MEDIEVAL_SCALE as S } from './assets.js';

// Adventure mode, "The Swordsmith": six chapters from your village to the top of the castle tower.
// Chapters 1-3 are outdoor fields (built by wild.js), 4-6 are castle rooms (built by room.js). Between them is your forge.

const MORNING = { sky: 0xe4d8c4, ground: 0x4a5c36, sun: 0xfff0d8, amb: 1.55, sunI: 2.7, grade: [1.0, 0.96, 0.88] };
const AFTERNOON = { sky: 0xd2e4f4, ground: 0x4a5c36, sun: 0xfff2d8, amb: 1.55, sunI: 2.8, grade: [1.0, 0.98, 0.92] };
const DUSK = { sky: 0xa08088, ground: 0x2a2224, sun: 0xffa878, amb: 1.0, sunI: 1.7, grade: [1.0, 0.82, 0.72] };
// the castle inside: warm torchlight on pale stone, red banners
const CASTLE = { name: 'The Castle', glow: 1.1, amb: 0.85, torch: 0xffb060, sky: 0x8a7060, ground: 0x151313, sun: 0xd8c8b0, grade: [1.0, 0.9, 0.76],
  stone: 0xf2e6d8, embers: 0xffc080, abyss: 0x3a2e28, slabs: 0.5, broken: 0.03, rubble: 2, stains: 2 };

export const CHAPTERS = [
  {
    title: 'The Forge', sub: 'Your village, first light', size: 34, mood: MORNING, layout: village,
    triggers: [{ t: 0.82, waves: [['bandit', 'bandit']] }],
    lines: [
      ['', 'The castle bells are ringing wrong.'],
      ['Old Marta', 'Riders came in the night. A black knight holds the castle, and the princess is locked in the tower.'],
      ['Old Marta', 'The soldiers ran. You still have the blade you finished yesterday.'],
      ['You', 'Then someone has to go.'],
      ['', 'Attack swings your sword; it lands a moment after you start, so time it. Dash takes one quick step the way you move, or back if you stand still. There is no magic in this.'],
    ],
  },
  {
    title: "The King's Road", sub: 'Two days to the castle', size: 54, mood: AFTERNOON, layout: road,
    triggers: [{ t: 0.35, waves: [['bandit', 'bandit', 'bandit']] }, { t: 0.7, waves: [['bandit', 'bandit'], ['bandit', 'crossbowman', 'crossbowman']] }],
    lines: [['You', "Deserters are robbing anyone on the King's Road. I'll keep to the middle of it."]],
  },
  {
    title: 'The Outer Wall', sub: 'Dusk at the castle gate', size: 44, mood: DUSK, layout: wall,
    triggers: [{ t: 0.45, waves: [['soldier', 'soldier', 'crossbowman']] }, { t: 0.76, waves: [['guard', 'guard'], ['crossbowman', 'crossbowman', 'soldier']] }],
    lines: [['You', "Their camp is outside the wall. The gate's held. Shields up front: I'll have to get round them."]],
  },
  {
    title: 'The Courtyard', sub: 'Inside the walls', room: 'combat',
    waves: [['soldier', 'soldier', 'guard'], ['crossbowman', 'crossbowman', 'soldier', 'guard'], ['captain', 'soldier']],
    lines: [['You', 'Inside. Their captain is somewhere in the yard.']],
  },
  {
    title: 'The Great Hall', sub: "The usurper's household", room: 'combat',
    waves: [['guard', 'guard', 'soldier'], ['guard', 'captain', 'crossbowman', 'crossbowman']],
    lines: [['You', 'The great hall. The tower stair is at the back.']],
  },
  {
    title: 'The Tower', sub: 'At the top of the stairs', room: 'boss', waves: [['blackknight']],
    lines: [['The Black Knight', 'A smith. They sent a smith.'], ['You', 'I made this sword. We will see if it holds.']],
  },
];

export const ENDING = [
  ['Princess Elin', 'You came alone?'],
  ['You', 'Everyone else ran. I make swords; it seemed a waste not to use one.'],
  ['Princess Elin', 'Then take me home, swordsmith.'],
];

// ---- the forge: coin and iron from the road buy a better blade and a coat of mail ----

export const FORGE = [
  { id: 'edge', name: 'Hone the Edge', desc: '+25% damage with every swing.', coin: (l) => 8 + l * 6, iron: (l) => 1 + l },
  { id: 'reach', name: 'Lengthen the Blade', desc: 'Your swing reaches a little further.', coin: (l) => 6 + l * 5, iron: (l) => 2 + l },
  { id: 'mail', name: 'Forge Mail', desc: 'Take 12% less damage and carry a little more health.', coin: (l) => 8 + l * 6, iron: (l) => 2 + l },
];
export const FORGE_MAX = 3;
export const canForge = (a, f) => a[f.id] < FORGE_MAX && a.coin >= f.coin(a[f.id]) && a.iron >= f.iron(a[f.id]);
export const forgeCost = (a, f) => (a[f.id] >= FORGE_MAX ? 'Finished' : `${f.coin(a[f.id])} coin, ${f.iron(a[f.id])} iron`);
export function forge(a, f) {
  a.coin -= f.coin(a[f.id]);
  a.iron -= f.iron(a[f.id]);
  a[f.id]++;
}
// what the forge has made shows up on the swordsmith
export function applyForge(p, a) {
  p.mods.atk = 1 + a.edge * 0.25;
  p.reach = a.reach * 0.3;
  p.armor = a.mail * 0.12;
  p.maxHp = 60 + a.mail * 8;
}
export const newAdventure = () => ({ chapter: 0, coin: 0, iron: 0, edge: 0, reach: 0, mail: 0 });

// ---- building a chapter ----

export function chapterPlan(i) {
  const ch = CHAPTERS[i];
  const banner = [`CHAPTER ${i + 1}: ${ch.title.toUpperCase()}`, ch.sub];
  if (ch.room) {
    // a castle room from the dungeon generator, dressed as the castle, with this chapter's fight and one way on
    const plan = makePlan(i + 1, ch.room);
    return Object.assign(plan, { biome: CASTLE, waves: ch.waves, reward: null, patron: null, doorPlans: ch.room === 'boss' ? [] : [{ kind: 'adv', reward: null }], banner });
  }
  const f = field(ch.size, (Math.random() * 1e9) | 0, ch.layout === road ? 0.55 : 0.68);
  const plan = {
    kind: 'field', depth: i + 1, waves: [], biome: { name: ch.title }, size: ch.size, ground: f.ground, mood: ch.mood, seaColor: 0x16221a,
    entry: f.at(0.02), center: f.at(0.5), clear: f.clear, buildings: [], fires: [], banner,
    triggers: ch.triggers.map((t) => ({ ...t, at: f.at(t.t), state: 'waiting', wave: 0 })), exit: f.at(0.97),
  };
  ch.layout(plan, f);
  return plan;
}

// A field: grass and meadow by noise with woods round the edge, and a dirt road from the bottom of the screen to the top.
// at(t) is the point t of the way along the road; side(t, d) is d tiles off to its side.
function field(size, seed, woods) {
  const n1 = noise(seed), n2 = noise(seed + 7), ground = new Uint8Array(size * size);
  const a = new THREE.Vector2(size - 5, size - 5), b = new THREE.Vector2(5, 5), across = new THREE.Vector2(1, -1).normalize();
  const point = (t) => a.clone().lerp(b, t).addScaledVector(across, Math.sin(t * Math.PI * 2) * size * 0.07);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const edge = Math.min(x, z, size - 1 - x, size - 1 - z);
    ground[z * size + x] = edge < 3 || n1(x, z, 9) > woods + edge * 0.004 ? FOREST : n2(x, z, 12) > 0.6 ? MEADOW : GRASS;
  }
  const clear = [];
  for (let t = 0; t <= 1; t += 0.5 / size) {
    const p = point(t);
    clear.push({ x: p.x, z: p.y, r: 2.6 });
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(p.x - 0.5) + dx, z = Math.round(p.y - 0.5) + dz;
      if (x >= 0 && z >= 0 && x < size && z < size) ground[z * size + x] = SAND;
    }
  }
  const at = (t) => { const p = point(t); return [p.x, p.y]; };
  const side = (t, d) => { const p = point(t).addScaledVector(across, d); return [p.x, p.y]; };
  return { ground, at, side, across, clear };
}

// places a Medieval piece beside the road, keeping trees off its plot
function put(plan, name, [x, z], { rot = 0, s = S, hw = 0, clear = 0 } = {}) {
  plan.buildings.push({ name, x, z, rot, s, hw });
  if (clear) plan.clear.push({ x, z, r: clear });
}
const faceRoad = (f, t, [x, z]) => { const [rx, rz] = f.at(t); return Math.atan2(rx - x, rz - z); };

function village(plan, f) {
  const home = (t, d, name, hw, clear) => { const at = f.side(t, d); put(plan, name, at, { rot: faceRoad(f, t, at), hw, clear }); };
  home(0.1, 5, 'building_blacksmith_red', 2.0, 4);   // your forge, by the road you leave on
  home(0.2, -5, 'building_home_A_red', 1.3, 3);
  home(0.3, 5.5, 'building_home_B_red', 1.4, 3);
  home(0.36, -4, 'building_well_red', 0.9, 2.5);
  home(0.46, -6, 'building_tavern_red', 1.9, 4);
  home(0.55, 6, 'building_market_red', 2.4, 4.5);
  home(0.66, -6, 'building_church_red', 1.7, 4);
  for (const [t, d, name, s] of [[0.06, 3, 'weaponrack', S], [0.13, 2.8, 'barrel', S], [0.15, 3.2, 'barrel', S], [0.24, -2.8, 'wheelbarrow', S], [0.5, 3, 'crate_A_big', S], [0.6, -2.8, 'sack', S]]) {
    put(plan, name, f.side(t, d), { rot: Math.random() * 6, s, hw: 0.35 });
  }
  // flags where the road leaves the village
  put(plan, 'flag_red', f.side(0.95, 2.2), { hw: 0.2 });
  put(plan, 'flag_red', f.side(0.95, -2.2), { hw: 0.2 });
}

function road(plan, f) {
  // a robbed cart, and the deserters' camp in the trees
  put(plan, 'wheelbarrow', f.side(0.22, 2.4), { rot: 1.2, hw: 0.5 });
  put(plan, 'resource_lumber', f.side(0.24, -2.6), { rot: 0.4, hw: 0.8 });
  const camp = f.side(0.62, 7);
  plan.clear.push({ x: camp[0], z: camp[1], r: 5 });
  put(plan, 'tent', [camp[0] + 1.6, camp[1] - 1.2], { rot: 0.6, hw: 1.0 });
  put(plan, 'tent', [camp[0] - 1.6, camp[1] + 1.4], { rot: 2.4, hw: 1.0 });
  put(plan, 'sack', [camp[0] + 0.4, camp[1] + 1.8], { hw: 0.2 });
  plan.fires.push({ x: camp[0], z: camp[1] });
  put(plan, 'flag_red', f.side(0.95, 2.2), { hw: 0.2 });
  put(plan, 'flag_red', f.side(0.95, -2.2), { hw: 0.2 });
}

function wall(plan, f) {
  // the castle wall across the road, a gate where the road meets it, towers at each end and the castle beyond
  const t = 0.86, [gx, gz] = f.at(t), along = new THREE.Vector2(f.across.x, f.across.y), rot = Math.atan2(along.y, along.x) * -1;
  const seg = 2 * S;
  for (let k = -3; k <= 3; k++) {
    const x = gx + along.x * k * seg, z = gz + along.y * k * seg;
    put(plan, k === 0 ? 'wall_straight_gate' : 'wall_straight', [x, z], { rot, clear: 3 });
    // walls run on a slant, so they're solid as a chain of small blocks; the gate leaves its middle open
    for (let u = -seg / 2; u <= seg / 2; u += 0.8) if (k !== 0 || Math.abs(u) > 1.6) plan.buildings.push({ name: null, x: x + along.x * u, z: z + along.y * u, hw: 0.6 });
  }
  for (const k of [-3.6, 3.6]) put(plan, 'building_tower_A_red', [gx + along.x * k * seg, gz + along.y * k * seg], { hw: 1.6, clear: 4 });
  const [cx, cz] = f.at(1.02);
  put(plan, 'building_castle_red', [cx - 2, cz - 2], { rot: Math.PI / 4, s: S * 1.2, clear: 9 });
  plan.exit = f.at(t);
  // their camp before the wall
  const camp = f.side(0.5, -6);
  plan.clear.push({ x: camp[0], z: camp[1], r: 5 });
  put(plan, 'tent', [camp[0] - 1.6, camp[1] - 1], { rot: 0.8, hw: 1.0 });
  put(plan, 'tent', [camp[0] + 1.8, camp[1] + 1], { rot: 2.2, hw: 1.0 });
  put(plan, 'weaponrack', [camp[0] + 0.2, camp[1] - 2], { hw: 0.3 });
  put(plan, 'target', f.side(0.4, 4), { hw: 0.3 });
  plan.fires.push({ x: camp[0], z: camp[1] }, { x: gx + along.x * 3 + 1.4, z: gz + along.y * 3 + 1.4 }); // a brazier on our side of the gate
}

// ---- playing a field: ambushes along the road, and the way on at the end of it ----

// Runs every frame of a field chapter. Returns the prompt to show, and exit: true when you reach the way on.
export function adventureUpdate(room) {
  const p = world.player, plan = room.plan;
  if (!room.exitRing) {
    room.exitRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 24), basic(C.SAND, { transparent: true, opacity: 0.0, depthWrite: false }));
    room.exitRing.rotation.x = -Math.PI / 2;
    room.exitRing.position.set(plan.exit[0], 0.05, plan.exit[1]);
    room.group.add(room.exitRing);
  }
  const alive = world.enemies.some((e) => !e.dead) || world.pendingSpawns > 0;
  for (const t of plan.triggers) {
    if (t.state === 'waiting' && Math.hypot(p.pos.x - t.at[0], p.pos.z - t.at[1]) < 6) t.state = 'fighting';
    if (t.state !== 'fighting' || alive) continue;
    if (t.wave < t.waves.length) {
      const c = new THREE.Vector3(t.at[0], 0, t.at[1]);
      for (const type of t.waves[t.wave++]) {
        let s = room.freeSpot(c, 1.5, 6);
        for (let i = 0; i < 8 && s.distanceTo(p.pos) < 3.5; i++) s = room.freeSpot(c, 1.5, 6);
        spawnEnemy(type, s.x, s.z, plan.depth);
      }
    } else t.state = 'done';
    break; // one fight at a time
  }
  const open = plan.triggers.every((t) => t.state === 'done') && !alive;
  room.exitRing.material.opacity = open ? 0.6 + 0.3 * Math.sin(world.time * 4) : 0;
  const d = Math.hypot(p.pos.x - plan.exit[0], p.pos.z - plan.exit[1]);
  if (!open) return { prompt: d < 4 ? '<span class="dim">NOT YET. DEAL WITH THEM FIRST.</span>' : null };
  return { prompt: null, exit: d < 1.4 };
}
