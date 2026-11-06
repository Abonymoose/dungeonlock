import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { scene, toon, basic, torchLights, setMood } from './render.js';
import { makeIcon, disposeObject } from './models.js';
import { PATRONS } from './boons.js';
import { spawnEnemy } from './enemies.js';
import { burst, floatText, heal, damage } from './combat.js';
import { sfx } from './audio.js';
import { btn, pressed } from './input.js';
import { haloMat } from './room.js';
import { natureMesh, medieval } from './assets.js';
import * as ui from './ui.js';

// The Wilds (Open World): one huge island of meadow, forest, rock and lakes. Gather and craft by day; zombies rise at night.
export const SIZE = 160, WILD_SIZE = SIZE; // tiles across the island
const CELL = 2;                          // obstacle grid cell, in tiles
const CYCLE = 180;                       // seconds for a whole day and night
const DUSK = 0.55, NIGHT = 0.62, DAWN = 0.95;
export const WATER = 0, SAND = 1, MEADOW = 2, GRASS = 3, FOREST = 4, ROCK = 5;
const PAINT = [[34, 58, 68], [190, 172, 124], [120, 150, 76], [88, 122, 58], [54, 82, 46], [116, 110, 100]];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Smooth value noise from a seed, two octaves
export function noise(seed) {
  const h = (x, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 982451653);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t) => t * t * (3 - 2 * t);
  const v = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = s(x - xi), fz = s(z - zi);
    const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  return (x, z, k) => v(x / k, z / k) * 0.65 + v(x / k * 2.3 + 17, z / k * 2.3 + 31) * 0.35;
}

// What each tile is: an island (sea all round the edge), lakes inland, and forest, meadow and rock by noise
export function makeWild(seed = (Math.random() * 1e9) | 0) {
  const n1 = noise(seed), n2 = noise(seed + 1), n3 = noise(seed + 2), ground = new Uint8Array(SIZE * SIZE), mid = SIZE / 2;
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x - mid, z - mid) / mid;
    const h = n1(x, z, 26) - Math.max(0, d - 0.7) * 2.2 + (d < 0.08 ? 0.4 : 0); // the start is always dry land
    const wet = n2(x, z, 34), rocky = n3(x, z, 20);
    ground[z * SIZE + x] = h < 0.3 ? WATER : h < 0.34 ? SAND : rocky > 0.68 ? ROCK : wet > 0.6 ? FOREST : wet < 0.36 ? MEADOW : GRASS;
  }
  const c = mid + 0.5;
  return { kind: 'wild', depth: 0, waves: [], biome: { name: 'The Wilds' }, seed, ground, entry: [c, c], center: [c, c] };
}

// ---- building it ----

// which KayKit Forest models grow on which ground
const TREES = {
  [FOREST]: ['Tree_4_A', 'Tree_2_A', 'Tree_2_C', 'Tree_1_B'], [GRASS]: ['Tree_1_A', 'Tree_3_A', 'Tree_1_B'],
  [MEADOW]: ['Tree_3_A', 'Tree_1_A'], [ROCK]: ['Tree_Bare_1_A', 'Tree_4_A'],
};
const ROCKS = ['Rock_1_A', 'Rock_1_E', 'Rock_3_A', 'Rock_3_E'], BUSHES = ['Bush_2_B', 'Bush_3_A', 'Bush_4_A'];
const DECOR = ['Grass_1_B', 'Grass_2_B', 'Grass_1_B', 'Bush_1_A', 'Rock_2_A']; // too small to gather; just texture on the ground
const MAT = { tree: 'wood', rock: 'stone', bush: 'fiber' };
const VERB = { tree: 'CHOP', rock: 'MINE', bush: 'GATHER' };
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// The island, or one of Adventure's outdoor maps (plan.kind 'field': its own size, buildings, cleared ground and light)
export function buildWild(plan) {
  const group = new THREE.Group();
  scene.add(group);
  const SIZE = plan.size ?? WILD_SIZE, G = plan.ground, at = (x, z) => (x < 0 || z < 0 || x >= SIZE || z >= SIZE ? WATER : G[z * SIZE + x]);

  // ground: one texture, 4 art pixels per tile, each pixel jittered so grass and stone read as texture
  const P = 4, W = SIZE * P, cv = Object.assign(document.createElement('canvas'), { width: W, height: W }), g = cv.getContext('2d'), img = g.createImageData(W, W);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    const k = at(x >> 2, z >> 2), c = PAINT[k], j = (Math.random() - 0.5) * (k === WATER ? 10 : 24), i = (z * W + x) * 4;
    img.data[i] = c[0] + j; img.data[i + 1] = c[1] + j; img.data[i + 2] = c[2] + j; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  Object.assign(tex, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false, colorSpace: THREE.SRGBColorSpace });
  const land = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), toon(0xffffff, tex));
  land.rotation.x = -Math.PI / 2;
  land.position.set(SIZE / 2, 0, SIZE / 2);
  land.receiveShadow = true;
  group.add(land);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 4, SIZE * 4), toon(plan.seaColor ?? 0x223a44)); // a field's edge reads as deep woods
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(SIZE / 2, -0.02, SIZE / 2);
  group.add(sea);

  // obstacles live in a grid, so a map with thousands of trees still collides cheaply
  const obstacles = [], grid = new Map(), cellOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const addObs = (o) => { obstacles.push(o); const k = cellOf(o.x, o.z); (grid.get(k) ?? grid.set(k, []).get(k)).push(o); return o; };
  const removeObs = (o) => {
    obstacles.splice(obstacles.indexOf(o), 1);
    const c = grid.get(cellOf(o.x, o.z));
    c.splice(c.indexOf(o), 1);
  };
  // the shore is solid (shots fly over water, people don't)
  for (let z = -1; z <= SIZE; z++) for (let x = -1; x <= SIZE; x++) {
    if (at(x, z) !== WATER) continue;
    let shore = false;
    for (let dz = -1; dz <= 1 && !shore; dz++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, z + dz) !== WATER) { shore = true; break; }
    if (shore) addObs({ x: x + 0.5, z: z + 0.5, hw: 0.5, hd: 0.5, edge: true });
  }

  // scatter trees, rocks, bushes and grass by ground kind; anything gatherable is a node
  const lists = {}, nodes = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const put = (name, x, z, s) => {
    const l = (lists[name] ??= []), shade = 0.85 + Math.random() * 0.2; // a little light and dark between instances
    l.push({ m: M.compose(V.set(x, 0, z), Q.setFromAxisAngle(Y, Math.random() * 6.28), S.set(s, s, s)).clone(), c: new THREE.Color(shade, shade, shade) });
    return [name, l.length - 1];
  };
  const mid = SIZE / 2;
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const k = at(x, z);
    if (k === WATER || (plan.kind === 'wild' && Math.hypot(x - mid, z - mid) < 6)) continue; // a clearing to start in
    if (plan.clear?.some((c) => Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) < c.r)) continue; // roads, yards and building plots
    const px = x + 0.5 + (Math.random() - 0.5) * 0.6, pz = z + 0.5 + (Math.random() - 0.5) * 0.6, r = Math.random();
    const tree = { [FOREST]: 0.24, [GRASS]: 0.045, [MEADOW]: 0.015, [ROCK]: 0.02 }[k] ?? 0;
    const rock = { [ROCK]: 0.14, [GRASS]: 0.01, [SAND]: 0.015 }[k] ?? 0;
    const bush = { [FOREST]: 0.05, [GRASS]: 0.04, [MEADOW]: 0.035 }[k] ?? 0;
    if (r < tree) {
      nodes.push({ kind: 'tree', x: px, z: pz, left: 3, parts: [put(pick(TREES[k]), px, pz, 0.85 + Math.random() * 0.35)], obs: addObs({ x: px, z: pz, hw: 0.22, hd: 0.22 }) });
    } else if (r < tree + rock) {
      const name = pick(ROCKS), sc = 0.9 + Math.random() * 0.4, hw = natureMesh(name).size.x * sc * 0.4;
      nodes.push({ kind: 'rock', x: px, z: pz, left: 3, parts: [put(name, px, pz, sc)], obs: addObs({ x: px, z: pz, hw, hd: hw }) });
    } else if (r < tree + rock + bush) {
      nodes.push({ kind: 'bush', x: px, z: pz, left: 2, parts: [put(pick(BUSHES), px, pz, 0.9 + Math.random() * 0.4)], obs: null });
    } else if ((k === MEADOW || k === GRASS || k === FOREST) && r > 0.82) put(pick(DECOR), px, pz, 0.8 + Math.random() * 0.5);
  }
  // one instanced mesh per model; geometry and material belong to the loaded pack, so they're never disposed here
  const meshes = {};
  for (const [name, list] of Object.entries(lists)) {
    const { geometry, material } = natureMesh(name);
    const im = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((e, i) => { im.setMatrixAt(i, e.m); im.setColorAt(i, e.c); });
    im.castShadow = !DECOR.includes(name);
    im.receiveShadow = true;
    im.userData.shared = true;
    group.add(im);
    meshes[name] = im;
  }

  const room = {
    plan, group, obstacles, nodes, pickups: [], doors: [], traps: [], fires: [], spikes: [], lightSpots: [], fountain: null, cleared: true, waveIndex: 0, lightT: 0,
    entry: new THREE.Vector3(plan.entry[0], 0, plan.entry[1]), center: new THREE.Vector3(plan.center[0], 0, plan.center[1]),
    bounds: { x0: 0, x1: SIZE, z0: 0, z1: SIZE },
  };
  room.near = (pos) => {
    const out = [], cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = grid.get(`${cx + dx},${cz + dz}`); if (c) out.push(...c); }
    return out;
  };
  room.collide = (pos, r) => {
    for (const o of room.near(pos)) {
      if (Math.abs(pos.x - o.x) > o.hw + r || Math.abs(pos.z - o.z) > o.hd + r) continue;
      const cx = Math.max(o.x - o.hw, Math.min(pos.x, o.x + o.hw)), cz = Math.max(o.z - o.hd, Math.min(pos.z, o.z + o.hd));
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
      else pos.x = pos.x < o.x ? o.x - o.hw - r : o.x + o.hw + r;
    }
  };
  room.onFloor = (pos) => at(Math.floor(pos.x), Math.floor(pos.z)) !== WATER;
  // shots stop at trees, rocks and walls, and at the edge of the world
  room.blocked = (pos) => pos.x < -3 || pos.z < -3 || pos.x > SIZE + 3 || pos.z > SIZE + 3
    || room.near(pos).some((o) => !o.edge && Math.abs(pos.x - o.x) < o.hw && Math.abs(pos.z - o.z) < o.hd);
  room.freeSpot = (from, away, near = Infinity) => {
    const span = Math.min(near, SIZE);
    for (let i = 0; i < 80; i++) {
      const p = new THREE.Vector3(from.x + (Math.random() - 0.5) * 2 * span, 0, from.z + (Math.random() - 0.5) * 2 * span);
      const d = p.distanceTo(from);
      if (d >= away && d <= near && room.onFloor(p) && !room.near(p).some((o) => Math.abs(p.x - o.x) < o.hw + 0.4 && Math.abs(p.z - o.z) < o.hd + 0.4)) return p;
    }
    return from.clone();
  };
  room.openDoors = () => {};
  room.unlock = () => {};
  room.doorNear = () => null;
  room.addPickup = (type, x, z, patron = null) => {
    const m = makeIcon(patron ? PATRONS[patron].color : type === 'bigash' ? 'ash' : type);
    m.root.position.set(x, 0, z);
    scene.add(m.root);
    room.pickups.push({ type, obj: m.root, t: 0, patron });
    return room.pickups.at(-1);
  };
  room.nodeNear = (pos, range) => {
    let best = null, bd = range;
    for (const n of nodes) { const d = Math.hypot(n.x - pos.x, n.z - pos.z); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  room.deplete = (n) => {
    for (const [name, i] of n.parts) meshes[name].setMatrixAt(i, HIDDEN), (meshes[name].instanceMatrix.needsUpdate = true);
    if (n.obs) removeObs(n.obs);
    nodes.splice(nodes.indexOf(n), 1);
  };
  // crafted things: a campfire (light, healing, a safe circle) or a barricade
  room.build = (kind, x, z, rot = 0) => {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = rot;
    if (kind === 'fire') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 4, 8), toon(0x77726a));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      b.add(ring);
      for (const a of [0, 1.2, 2.4]) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.85, 5), toon(0x5a3a26));
        log.rotation.set(Math.PI / 2, 0, a);
        log.position.y = 0.08;
        log.castShadow = true;
        b.add(log);
      }
      // two cones of fire, a hot core inside a bigger orange one, under a wide glow card
      const flame = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 6).translate(0, 0.42, 0), basic(0xff8a30));
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5).translate(0, 0.28, 0), basic(0xffe08a));
      flame.add(outer, core);
      flame.position.y = 0.1;
      const halo = new THREE.Sprite(haloMat(0xff9a50));
      halo.position.y = 0.55;
      halo.scale.setScalar(2.4);
      b.add(flame, halo);
      room.fires.push({ x, z, flame, halo });
      room.lightSpots.push({ x, y: 1.2, z, color: 0xff9a50, base: 22 });
      addObs({ x, z, hw: 0.3, hd: 0.3 });
      room.lightT = 0;
    } else if (kind === 'spikes') {
      // eight stakes in a ring, low enough to walk over
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, stake = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 4).translate(0, 0.19, 0), toon(0x8a6a4a));
        stake.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
        stake.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
        stake.castShadow = true;
        b.add(stake);
      }
      room.spikes.push({ x, z, t: 0 });
    } else if (kind === 'torch') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.3, 5).translate(0, 0.65, 0), toon(0x5a3a26));
      post.castShadow = true;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 5).translate(0, 0.17, 0), basic(0xffb060));
      flame.position.y = 1.3;
      const halo = new THREE.Sprite(haloMat(0xffb060));
      halo.position.y = 1.45;
      halo.scale.setScalar(1.6);
      b.add(post, flame, halo);
      room.fires.push({ x, z, flame, halo, torch: true });
      room.lightSpots.push({ x, y: 1.7, z, color: 0xffb060, base: 14 });
      addObs({ x, z, hw: 0.15, hd: 0.15 });
      room.lightT = 0;
    } else {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.3).translate(0, 0.45, 0), toon(0x7a5434));
      wall.castShadow = wall.receiveShadow = true;
      b.add(wall);
      addObs({ x, z, hw: 0.55, hd: 0.55 });
    }
    group.add(b);
    burst(b.position, C.OAK, 10);
  };
  room.update = (dt) => {
    for (const p of room.pickups) {
      p.t += dt;
      p.obj.position.y = 0.15 + Math.sin(p.t * 4) * 0.08;
      p.obj.rotation.y += dt * 2;
    }
    for (const [i, f] of room.fires.entries()) {
      const k = Math.sin(world.time * 11 + i * 2.3) * Math.sin(world.time * 7.3 + i);
      f.flame.scale.set(1, 1 + 0.25 * k, 1);
      f.halo.scale.setScalar((f.torch ? 1.5 : 2.3) + 0.25 * k);
    }
    // the fixed pool of lights goes to the campfires nearest the player
    if ((room.lightT -= dt) <= 0 && world.player) {
      room.lightT = 0.25;
      const p = world.player.pos, d = (s) => (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      const spots = [...room.lightSpots].sort((a, b) => d(a) - d(b));
      torchLights.forEach((l, i) => {
        const s = spots[i];
        l.userData.base = l.intensity = s?.base ?? 0;
        if (s) { l.position.set(s.x, s.y, s.z); l.color.setHex(s.color); }
      });
    }
  };
  room.dispose = () => {
    for (const im of Object.values(meshes)) im.dispose(); // frees the per-instance buffers; the pack's geometry stays
    disposeObject(group);
    tex.dispose();
    for (const p of room.pickups) disposeObject(p.obj);
    for (const l of torchLights) { l.intensity = 0; l.userData.base = 0; }
  };

  // a field's buildings and props: KayKit Medieval pieces, each solid where it stands
  for (const b of plan.buildings ?? []) {
    if (b.name) { // a nameless entry is just a solid block, e.g. along a slanted wall
      const o = medieval(b.name, b.s);
      o.position.set(b.x, 0, b.z);
      o.rotation.y = b.rot ?? 0;
      o.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
      group.add(o);
    }
    if (b.hw) addObs({ x: b.x, z: b.z, hw: b.hw, hd: b.hd ?? b.hw });
  }
  for (const f of plan.fires ?? []) room.build('fire', f.x, f.z);

  if (plan.kind === 'wild') {
    world.run.wild = { clock: 0.08, nights: 0, spawnT: 0, mats: { wood: 0, stone: 0, fiber: 0 } };
    sky(0.08);
  } else setMood(plan.mood);
  return room;
}

// ---- the day ----

const DAY = { sky: new THREE.Color(0xd2e4f4), ground: new THREE.Color(0x4a5c36), sun: new THREE.Color(0xfff2d8), amb: 1.5, sunI: 2.7, grade: [1.0, 0.98, 0.92] };
const NITE = { sky: new THREE.Color(0x2a3868), ground: new THREE.Color(0x090c14), sun: new THREE.Color(0x7d8fc8), amb: 0.3, sunI: 0.35, grade: [0.62, 0.74, 1.0] };
const tc = new THREE.Color();
// 1 by day, 0 at night, easing through dusk and dawn
const daylight = (t) => (t < DUSK ? 1 : t < NIGHT ? 1 - (t - DUSK) / (NIGHT - DUSK) : t < DAWN ? 0 : (t - DAWN) / (1 - DAWN));
function sky(t) {
  const k = daylight(t), mix = (a, b) => tc.copy(a).lerp(b, k).getHex(), lerp = (a, b) => a + (b - a) * k;
  setMood({
    sky: mix(NITE.sky, DAY.sky), ground: mix(NITE.ground, DAY.ground), sun: mix(NITE.sun, DAY.sun),
    amb: lerp(NITE.amb, DAY.amb), sunI: lerp(NITE.sunI, DAY.sunI), grade: NITE.grade.map((v, i) => lerp(v, DAY.grade[i])),
  });
}

// Runs every frame of play in the Wilds. Returns the prompt to show and whether dawn just broke.
export function wildUpdate(dt) {
  const room = world.room, run = world.run, p = world.player, w = run.wild;
  const before = w.clock;
  w.clock = (w.clock + dt / CYCLE) % 1;
  const night = w.clock >= NIGHT && w.clock < DAWN;
  let dawn = false;
  if (before < NIGHT && w.clock >= NIGHT) {
    w.nights++;
    // every fifth night the Grave Lord digs up as well
    if (w.nights % 5 === 0) {
      const at = room.freeSpot(p.pos, 8, 12);
      spawnEnemy('gravelord', at.x, at.z, 1 + w.nights * 2);
      ui.showBanner('THE GRAVE LORD', `Night ${w.nights}. Something huge is digging its way up.`, 2400);
    } else ui.showBanner(`NIGHT ${w.nights}`, 'They rise. Stay near a fire.', 1800);
    sfx('slam');
  }
  if (before < DAWN && w.clock >= DAWN) {
    // the sun burns the dead back into the ground
    for (const e of world.enemies) if (!e.dead) { floatText(e.pos, 'BURNS', 'burn'); burst(e.pos, 0xffa040, 10); e.hp = 0; e.dead = true; e.burned = true; e.onDeath(); }
    run.depth = w.nights;
    dawn = true;
  }
  sky(w.clock);

  if (night) {
    w.spawnT -= dt;
    const alive = world.enemies.filter((e) => !e.dead).length + world.pendingSpawns;
    if (w.spawnT <= 0 && alive < 3 + w.nights * 3) {
      w.spawnT = Math.max(1.2, 3.2 - w.nights * 0.3);
      const pool = ['zombie', 'zombie', 'zombie', ...(w.nights >= 2 ? ['crawler', 'crawler'] : []), ...(w.nights >= 3 ? ['bloater'] : [])];
      const at = room.freeSpot(p.pos, 10, 15);
      // nothing rises inside a campfire's light
      if (at.distanceTo(p.pos) >= 10 && !room.fires.some((f) => Math.hypot(f.x - at.x, f.z - at.z) < 5)) {
        spawnEnemy(pick(pool), at.x, at.z, 1 + w.nights * 2, w.nights >= 3 && Math.random() < 0.15);
      }
    }
  }
  // resting by a fire heals
  if (room.fires.some((f) => !f.torch && Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < 3.2)) p.hp = Math.min(p.maxHp, p.hp + 4 * dt);
  // spike traps cut whatever dead stand on them, twice a second
  for (const s of room.spikes) {
    if ((s.t -= dt) > 0) continue;
    for (const e of world.enemies) {
      if (e.dead || Math.hypot(e.pos.x - s.x, e.pos.z - s.z) > 0.8) continue;
      damage(e, 10 + w.nights * 3, e.pos.clone().set(s.x, 0, s.z), { knockback: 1 });
      s.t = 0.5;
    }
  }

  const m = w.mats;
  run.label = `${night ? 'NIGHT ' + w.nights : 'DAY ' + (w.nights + 1)}<br>${m.wood} WOOD &nbsp;${m.stone} STONE &nbsp;${m.fiber} FIBER`;

  // gathering: stand by a tree, rock or bush and press Use
  let prompt = null;
  const n = room.nodeNear(p.pos, 1.5);
  if (n) {
    prompt = `${btn('interact')}${VERB[n.kind]} <span class="dim">${n.left} ${MAT[n.kind].toUpperCase()} LEFT</span>`;
    if (pressed('interact')) {
      n.left--;
      m[MAT[n.kind]]++;
      p.facing.set(n.x - p.pos.x, 0, n.z - p.pos.z).normalize();
      p.model.anim.once('attack', 0.3);
      floatText(new THREE.Vector3(n.x, 0.6, n.z), `+1 ${MAT[n.kind].toUpperCase()}`, 'ash');
      burst(new THREE.Vector3(n.x, 0, n.z), n.kind === 'rock' ? 0x9a948a : n.kind === 'tree' ? 0x5a3a26 : 0x4a7a3c, 6);
      sfx('pickup');
      if (n.left <= 0) room.deplete(n);
    }
  } else if (m.wood + m.stone + m.fiber > 0) prompt = `<span class="dim">${btn('craft')}CRAFT</span>`;
  return { prompt, dawn };
}

// ---- crafting ----

export const RECIPES = [
  { id: 'fire', name: 'Campfire', desc: 'Light in the dark. Standing by it heals you, and nothing rises near it.', cost: { wood: 5, stone: 2 } },
  { id: 'wall', name: 'Barricade', desc: 'A wall of stakes in front of you. Zombies have to go round it.', cost: { wood: 4 } },
  { id: 'bandage', name: 'Bandage', desc: 'Heal 35% of your health.', cost: { fiber: 3 } },
  { id: 'whet', name: 'Whetstone', desc: '+10% damage with everything.', cost: { stone: 4, wood: 2 } },
  { id: 'spikes', name: 'Spike Trap', desc: 'A ring of sharpened stakes on the ground. The dead that walk over it are cut.', cost: { wood: 3, stone: 2 } },
  { id: 'torch', name: 'Torch Post', desc: 'Lights the ground around it, and nothing rises near it. It does not heal you.', cost: { wood: 2, fiber: 1 } },
  { id: 'stew', name: 'Hearty Stew', desc: '+15 max health for the rest of the run, and heal 15.', cost: { fiber: 2, wood: 1 } },
  { id: 'charm', name: 'Lucky Charm', desc: '+1 Cast shard.', cost: { stone: 2, fiber: 2 } },
];
export const canCraft = (r) => Object.entries(r.cost).every(([k, v]) => world.run.wild.mats[k] >= v);
export const costText = (r) => Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ');
export function craft(r) {
  const w = world.run.wild, p = world.player, room = world.room;
  for (const [k, v] of Object.entries(r.cost)) w.mats[k] -= v;
  let front = p.pos.clone().addScaledVector(p.facing, 1.4);
  if (!room.onFloor(front)) front = p.pos.clone();
  if (r.id === 'fire' || r.id === 'spikes' || r.id === 'torch') room.build(r.id, front.x, front.z);
  else if (r.id === 'wall') room.build('wall', front.x, front.z, Math.atan2(p.facing.x, p.facing.z));
  else if (r.id === 'bandage') heal(p, p.maxHp * 0.35);
  else if (r.id === 'stew') { p.maxHp += 15; heal(p, 15); }
  else if (r.id === 'charm') { p.maxAmmo++; p.ammo++; }
  else { p.mods.atk *= 1.1; p.mods.spc *= 1.1; p.mods.cast *= 1.1; }
  ui.showBanner(r.name.toUpperCase(), r.id === 'whet' ? 'Your weapons bite deeper.' : '', 1200);
  sfx('unlock');
}
