import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { scene, toon, basic, torchLights, setMood } from './render.js';
import { makeIcon, disposeObject } from './models.js';
import { prop, instanced, tintProps } from './assets.js';
import { damage, burst } from './combat.js';
import { PATRONS } from './boons.js';
import { occludes } from './run.js';
import { sfx, musicFor } from './audio.js';

const clamp = THREE.MathUtils.clamp;
const ICON = { key: 'key', heal: 'heal', boon: 'boon', ash: 'ash', treasure: 'boon', boss: 'skull', exit: 'key', pom: 'pom' };
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const key = (x, z) => `${x},${z}`;

// A soft round glow card for flames, shared per colour; the post pass blooms it
const haloTex = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 32, height: 32 }), g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const haloMats = new Map();
export const haloMat = (hex) => haloMats.get(hex) ?? haloMats.set(hex, new THREE.SpriteMaterial({ map: haloTex, color: hex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })).get(hex);

function place(obj, x, y, z, rotY = 0, parent) {
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  parent.add(obj);
  return obj;
}

// Irregular blood stain: a jittered disc in Bitter Chocolate, the doc's "dried blood"
function stain(x, z, r, parent, color = C.CHOC) {
  const geo = new THREE.CircleGeometry(r, 9);
  const pos = geo.attributes.position;
  for (let i = 1; i < pos.count; i++) { const k = 0.6 + Math.random() * 0.6; pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k); }
  const m = new THREE.Mesh(geo, basic(color, { transparent: true, opacity: 0.55, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.random() * 6;
  return place(m, x, 0.03, z, 0, parent);
}

// picks up to n items from a list, keeping them at least `gap` apart
function spaced(list, n, gap) {
  const out = [];
  for (const w of [...list].sort(() => Math.random() - 0.5)) if (out.length < n && out.every((o) => Math.hypot(o.x - w.x, o.z - w.z) >= gap)) out.push(w);
  return out;
}

export function buildRoom(plan, doorPlans) {
  const group = new THREE.Group();
  scene.add(group);
  const biome = plan.biome;
  setMood(biome);
  tintProps(biome.stone);
  musicFor(biome.name, plan.kind === 'boss' ? 'boss' : biome.music ?? 'dungeon');
  const floor = new Set(plan.tiles.map(([x, z]) => key(x, z)));
  const has = (x, z) => floor.has(key(x, z));
  const xs = plan.tiles.map((t) => t[0]), zs = plan.tiles.map((t) => t[1]);
  const room = {
    plan, group, floor, obstacles: [], traps: [], doors: [], pickups: [], fountain: null, cleared: false, waveIndex: 0, lightSpots: [], flames: [], lightT: 0,
    entry: new THREE.Vector3(plan.entry[0], 0, plan.entry[1]), center: new THREE.Vector3(plan.center[0], 0, plan.center[1]),
    bounds: { x0: Math.min(...xs) - 0.5, x1: Math.max(...xs) + 0.5, z0: Math.min(...zs) - 0.5, z1: Math.max(...zs) + 0.5 },
  };
  const q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const at = (x, y, z, rot = 0, sx = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, rot), new THREE.Vector3(sx, 1, 1));
  const tiles = plan.tiles;
  const edge = (x, z) => !has(x + 1, z) || !has(x - 1, z) || !has(x, z + 1) || !has(x, z - 1);
  // a big map gets proportionally more torches, crates and rubble
  const k = Math.max(1, tiles.length / 300);

  // ---- doors claim their slots; the wall edges they cover stay open ----
  const doors = doorPlans.slice(0, plan.slots.length).map((d, i) => ({ ...d, wall: plan.slots[i].wall, pos: new THREE.Vector3(plan.slots[i].x, 0, plan.slots[i].z) }));
  const doorEdge = new Set();
  for (const d of doors) {
    const pair = d.wall === 'z' ? [[d.pos.x - 0.5, d.pos.z + 0.5], [d.pos.x + 0.5, d.pos.z + 0.5]] : [[d.pos.x + 0.5, d.pos.z - 0.5], [d.pos.x + 0.5, d.pos.z + 0.5]];
    for (const [x, z] of pair) doorEdge.add(d.wall + key(x, z));
  }

  // ---- floor: clean stone with cracked tiles, rubble-strewn edges, and a carved seal in the middle ----
  const skip = new Set(plan.traps.map(([x, z]) => key(x, z)));
  const [cx, cz] = plan.center;
  const quad = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const seal = quad.every(([dx, dz]) => has(cx + dx, cz + dz) && !skip.has(key(cx + dx, cz + dz)));
  if (seal) for (const [dx, dz] of quad) skip.add(key(cx + dx, cz + dz));
  // big 2x2 slabs, as many as the biome likes (the Crypt is mostly slabs)
  const slabs = seal ? [at(cx + 0.5, 0, cz + 0.5)] : [];
  if (biome.slabs) for (const [x, z] of tiles) {
    if (Math.random() > biome.slabs || !quad.every(([dx, dz]) => has(x + dx, z + dz) && !skip.has(key(x + dx, z + dz)))) continue;
    for (const [dx, dz] of quad) skip.add(key(x + dx, z + dz));
    slabs.push(at(x + 0.5, 0, z + 0.5, Math.floor(Math.random() * 4) * Math.PI / 2));
  }
  if (slabs.length) group.add(instanced('floor_tile_large', slabs));
  const floors = { floor_tile_small: [], floor_tile_small_broken_A: [], floor_tile_small_broken_B: [], floor_tile_small_decorated: [] };
  for (const [x, z] of tiles) {
    if (skip.has(key(x, z))) continue;
    const r = Math.random();
    const broken = biome.broken;
    const kind = edge(x, z) && r < 0.05 ? 'floor_tile_small_decorated' : r < 1 - broken ? 'floor_tile_small' : r < 1 - broken * 0.4 ? 'floor_tile_small_broken_A' : 'floor_tile_small_broken_B';
    floors[kind].push(at(x, 0, z, Math.floor(Math.random() * 4) * Math.PI / 2));
  }
  for (const [name, mats] of Object.entries(floors)) if (mats.length) group.add(instanced(name, mats));
  if (seal) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.88, 24), basic(C.CHOC, { transparent: true, opacity: 0.7, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    place(ring, cx + 0.5, 0.04, cz + 0.5, 0, group);
  }

  // ---- front edges drop to the void on stone foundations that follow the outline ----
  const fronts = [], corners = [];
  for (const [x, z] of tiles) {
    const s = !has(x, z + 1), e = !has(x + 1, z);
    if (s && e) corners.push(at(x, -1, z, Math.PI / 2));
    else if (s) fronts.push(at(x, -1, z));
    else if (e) fronts.push(at(x, -1, z, Math.PI / 2));
  }
  if (fronts.length) group.add(instanced('floor_foundation_front', fronts));
  if (corners.length) group.add(instanced('floor_foundation_corner', corners));

  // ---- the void isn't empty: ruined columns sink into the abyss around the arena, fading to black ----
  const colGeo = new THREE.BoxGeometry(1, 12, 1).translate(0, -6, 0);
  const vp = colGeo.attributes.position, cols = new Float32Array(vp.count * 3), top = new THREE.Color(biome.abyss), deep = new THREE.Color(C.ONYX), col = new THREE.Color();
  for (let i = 0; i < vp.count; i++) { col.copy(deep).lerp(top, (vp.getY(i) + 12) / 12); cols.set([col.r, col.g, col.b], i * 3); }
  colGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const colMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const bx = room.bounds, mx = (bx.x0 + bx.x1) / 2, mz = (bx.z0 + bx.z1) / 2, rad = Math.hypot(bx.x1 - bx.x0, bx.z1 - bx.z0) / 2;
  for (let i = 0, placed = 0; i < 120 && placed < 12; i++) {
    const a = Math.random() * Math.PI * 2, d = rad * 0.6 + Math.random() * 7;
    const x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d;
    if (x + z < mx + mz - rad * 0.5) continue; // the back is hidden by walls anyway
    if (tiles.some(([tx, tz]) => Math.abs(tx - x) < 2.5 && Math.abs(tz - z) < 2.5)) continue;
    const m = new THREE.Mesh(colGeo, colMat), s = 0.6 + Math.random() * 1.4;
    m.scale.set(s, 1, s);
    place(m, x, -1.3 - Math.random() * 3, z, Math.random(), group);
    placed++;
  }

  // ---- back edges: walls where they won't hide the floor behind them, a low curb elsewhere ----
  const walls = [], cracked = [], wallSpots = [];
  const curbGeo = new THREE.BoxGeometry(1, 0.22, 0.22), curbMat = toon(C.OAK);
  for (const [x, z] of tiles) {
    for (const side of ['z', 'x']) {
      const back = side === 'z' ? !has(x, z - 1) : !has(x - 1, z);
      if (!back || doorEdge.has(side + key(x, z))) continue;
      const wx = side === 'z' ? x : x - 0.5, wz = side === 'z' ? z - 0.5 : z, rot = side === 'z' ? 0 : Math.PI / 2;
      if (occludes(has, wx, wz)) {
        place(new THREE.Mesh(curbGeo, curbMat), side === 'z' ? wx : wx - 0.11, 0.11, side === 'z' ? wz - 0.11 : wz, rot, group);
        continue;
      }
      (Math.random() < 0.15 ? cracked : walls).push(at(side === 'z' ? wx : wx - 0.25, 0, side === 'z' ? wz - 0.25 : wz, rot, 0.5));
      wallSpots.push({ side, x, z, wx, wz, rot });
    }
  }
  if (walls.length) group.add(instanced('wall', walls));
  if (cracked.length) group.add(instanced('wall_cracked', cracked));
  // posts where a 'z' wall and an 'x' wall meet at an angle, so the joins never gap
  const ends = (w) => (w.side === 'z' ? [[w.wx - 0.5, w.wz], [w.wx + 0.5, w.wz]] : [[w.wx, w.wz - 0.5], [w.wx, w.wz + 0.5]]);
  const sidesAt = new Map();
  for (const w of wallSpots) for (const [px, pz] of ends(w)) {
    const k = key(px, pz);
    sidesAt.set(k, (sidesAt.get(k) ?? new Set()).add(w.side));
  }
  const posts = [...sidesAt].filter(([, s]) => s.size === 2).map(([k]) => { const [px, pz] = k.split(',').map(Number); return at(px - 0.25, 0, pz - 0.25); });
  if (posts.length) group.add(instanced('pillar', posts, 0.42));

  // ---- a torch either side of every doorway, then a couple more along the walls; banners hang between ----
  const spotAt = (side, x, z) => wallSpots.find((w) => w.side === side && w.x === x && w.z === z);
  const lit = [];
  for (const d of doors) {
    const pair = d.wall === 'z' ? [spotAt('z', d.pos.x - 1.5, d.pos.z + 0.5), spotAt('z', d.pos.x + 1.5, d.pos.z + 0.5)]
      : [spotAt('x', d.pos.x + 0.5, d.pos.z - 1.5), spotAt('x', d.pos.x + 0.5, d.pos.z + 1.5)];
    if (pair.every(Boolean)) lit.push(...pair);
  }
  for (const w of spaced(wallSpots, Math.round(6 * k), 4)) if (lit.length < 6 * k && lit.every((o) => Math.hypot(o.x - w.x, o.z - w.z) >= 3)) lit.push(w);
  for (const w of lit) {
    place(prop('torch_mounted'), w.wx, 0.85, w.wz, w.rot, group);
    addLight(room, w.side === 'z' ? w.wx : w.wx + 0.7, 1.5, w.side === 'z' ? w.wz + 0.7 : w.wz, 16);
    room.flames.push(new THREE.Vector3(w.side === 'z' ? w.wx : w.wx + 0.25, 1.25, w.side === 'z' ? w.wz + 0.25 : w.wz));
  }
  for (const w of spaced(wallSpots.filter((w) => !lit.includes(w)), Math.round(3 * k), 3)) {
    const b = prop(rand(['banner_red', 'banner_patternA_red']));
    b.scale.x *= 0.5;
    place(b, w.side === 'z' ? w.wx : w.wx - 0.25, 0, w.side === 'z' ? w.wz - 0.25 : w.wz, w.rot, group);
  }

  // ---- clutter: crates stacked in the back corners with a barrel either side (solid); debris and stains on the floor (not) ----
  const nearDoor = (x, z, d = 2.5) => doors.some((dr) => Math.hypot(dr.pos.x - x, dr.pos.z - z) < d);
  const awayFromEntry = (x, z) => Math.hypot(x - plan.entry[0], z - plan.entry[1]) > 2.5;
  const solidProp = (name, x, z, rot, s, hw) => { place(prop(name, s), x, 0, z, rot, group); room.obstacles.push({ x, z, hw, hd: hw }); };
  // a true corner has straight wall running both ways from it; stair-steps along a diagonal wall don't count
  const nooks = wallSpots.filter((w) => w.side === 'z' && spotAt('x', w.x, w.z) && spotAt('z', w.x + 1, w.z) && spotAt('x', w.x, w.z + 1)
    && !nearDoor(w.x, w.z, 3) && awayFromEntry(w.x, w.z));
  for (const w of spaced(nooks, Math.round(3 * k), 5)) {
    solidProp(rand(['crates_stacked', 'box_large']), w.x, w.z, 0, 0.35, 0.35);
    for (const [x, z] of [[w.x + 1, w.z], [w.x, w.z + 1]]) if (!nearDoor(x, z)) solidProp(rand(['barrel_small', 'barrel_large']), x, z, Math.random() * 6, 0.45, 0.25);
  }
  const edgeSpots = tiles.filter(([x, z]) => edge(x, z) && !nearDoor(x, z) && awayFromEntry(x, z)).map(([x, z]) => ({ x, z }));
  for (const e of spaced(edgeSpots, Math.round(biome.rubble * k), 2.5)) place(prop(rand(['rubble_half', 'sword_shield_broken']), 0.14), e.x, 0, e.z, Math.random() * 6, group);
  for (const [x, z] of [...tiles].sort(() => Math.random() - 0.5).slice(0, Math.round(biome.stains * k))) stain(x + Math.random() - 0.5, z + Math.random() - 0.5, (biome.puddle ? 0.55 : 0.35) + Math.random() * 0.4, group, biome.puddle);
  // ---- pillars carry a torch on the side facing the camera; a matched set shares one design ----
  const pillarKind = rand(['pillar', 'pillar_decorated']);
  for (const [x, z] of plan.pillars) {
    place(prop(pillarKind, 0.5), x, 0, z, 0, group);
    place(prop('torch_mounted'), x + 0.38, 0.85, z, Math.PI / 2, group);
    addLight(room, x + 0.9, 1.4, z + 0.3, 12);
    room.flames.push(new THREE.Vector3(x + 0.6, 1.25, z));
    room.obstacles.push({ x, z, hw: 0.4, hd: 0.4 });
  }

  const frontSpots = tiles.filter(([x, z]) => !has(x, z + 1) || !has(x + 1, z)).map(([x, z]) => ({ x, z }));
  for (const e of spaced(frontSpots, Math.round(2 * k), 6)) {
    place(prop('candle_triple'), e.x, 0, e.z, Math.random() * 6, group);
    addLight(room, e.x, 0.9, e.z, 8);
  }

  // ---- spike traps: dark plates that flush crimson, then the kit's spikes rise. Each set fires together, a beat after the last ----
  for (const [x, z, set = 0] of plan.traps) {
    const plate = place(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.04, 0.96), toon(C.CHOC)), x, 0.0, z, 0, group);
    plate.receiveShadow = true;
    const spikes = place(prop('floor_tile_big_spikes', 0.25), x, -0.5, z, 0, group);
    room.traps.push({ x, z, plate, spikes, t: (CYCLE - set * 0.9) % CYCLE, hit: new Set() });
  }

  // ---- doorways: gated until opened, a lock if keyed, the reward floating above ----
  for (const d of doors) {
    const rot = d.wall === 'z' ? 0 : Math.PI / 2, ox = d.wall === 'z' ? d.pos.x : d.pos.x - 0.25, oz = d.wall === 'z' ? d.pos.z - 0.25 : d.pos.z;
    d.gated = place(prop('wall_gated'), ox, 0, oz, rot, group);
    d.open_ = place(prop('wall_doorway'), ox, 0, oz, rot, group);
    d.open_.visible = false;
    const g = new THREE.Group();
    g.position.copy(d.pos);
    g.rotation.y = rot;
    if (d.locked) {
      d.lock = new THREE.Group();
      place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.16), toon(C.CHOC)), 0, 0.85, 0.1, 0, d.lock);
      place(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 4, 8, Math.PI), toon(C.CHOC)), 0, 1.07, 0.1, 0, d.lock);
      place(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.05), basic(C.SAND)), 0, 0.82, 0.2, 0, d.lock);
      g.add(d.lock);
    }
    const iconType = d.patron ? PATRONS[d.patron].color : ICON[d.reward ?? d.kind];
    if (iconType) {
      d.icon = makeIcon(iconType).root;
      d.icon.position.set(0, 2.35, 0.3);
      g.add(d.icon);
    }
    d.open = false;
    group.add(g);
    room.doors.push(d);
  }

  if (plan.kind === 'fountain') {
    const c = room.center;
    room.fountain = { pos: c.clone(), used: false };
    place(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.5, 10).translate(0, 0.25, 0), toon(C.OAK)), c.x, 0, c.z, 0, group);
    room.fountain.water = place(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 10), basic(C.SAND)), c.x, 0.5, c.z, 0, group);
    room.obstacles.push({ x: c.x, z: c.z, hw: 1.1, hd: 1.1 });
    addLight(room, c.x, 1.2, c.z, 8, 0xffe2b0);
  }

  // ---- the outline is solid: every empty tile touching the floor blocks movement (walls also block shots) ----
  const rim = new Set();
  for (const [x, z] of tiles) for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) if (!has(x + dx, z + dz)) rim.add(key(x + dx, z + dz));
  for (const k of rim) {
    const [x, z] = k.split(',').map(Number);
    room.obstacles.push({ x, z, hw: 0.5, hd: 0.5, edge: true, wall: has(x, z + 1) || has(x + 1, z) });
  }

  // every flame wears a glow card that flickers with it
  room.halos = room.flames.map((f) => {
    const h = new THREE.Sprite(haloMat(biome.torch));
    h.position.copy(f);
    h.scale.setScalar(0.9);
    group.add(h);
    return h;
  });
  room.embers = makeEmbers(room, group);
  attachLogic(room);
  assignLights(room, room.entry);
  return room;
}

// Rooms list where they want light; the fixed pool of lights goes to the spots nearest the player
function addLight(room, x, y, z, intensity, color) {
  const b = room.plan.biome;
  room.lightSpots.push({ x, y, z, color: color ?? b.torch, base: intensity * b.glow });
}
function assignLights(room, from) {
  const d = (s) => (s.x - from.x) ** 2 + (s.z - from.z) ** 2;
  const spots = room.lightSpots.length > torchLights.length ? [...room.lightSpots].sort((a, b) => d(a) - d(b)) : room.lightSpots;
  torchLights.forEach((l, i) => {
    const s = spots[i];
    l.userData.base = l.intensity = s?.base ?? 0;
    if (s) { l.position.set(s.x, s.y, s.z); l.color.setHex(s.color); }
  });
}

// Drifting 1px embers rising from the torches, plus slow dust over the whole floor
function makeEmbers(room, group) {
  const n = 90, pos = new Float32Array(n * 3), vel = [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: room.plan.biome.embers, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  group.add(pts);
  const reset = (i) => {
    const f = room.flames.length && Math.random() < 0.6 ? rand(room.flames) : null, t = rand(room.plan.tiles);
    pos[i * 3] = f ? f.x + (Math.random() - 0.5) * 0.3 : t[0] + Math.random() - 0.5;
    pos[i * 3 + 1] = f ? f.y : Math.random() * 0.5;
    pos[i * 3 + 2] = f ? f.z + (Math.random() - 0.5) * 0.3 : t[1] + Math.random() - 0.5;
    vel[i] = { y: 0.3 + Math.random() * 0.6, life: 1 + Math.random() * 2.5, sx: Math.random() * 10 };
  };
  for (let i = 0; i < n; i++) { reset(i); vel[i].life *= Math.random(); }
  return (dt) => {
    for (let i = 0; i < n; i++) {
      const v = vel[i];
      v.life -= dt;
      if (v.life <= 0) { reset(i); continue; }
      pos[i * 3] += Math.sin(world.time * 2 + v.sx) * 0.15 * dt;
      pos[i * 3 + 1] += v.y * dt;
    }
    geo.attributes.position.needsUpdate = true;
  };
}

function attachLogic(room) {
  room.collide = (pos, r) => {
    for (const o of room.obstacles) {
      if (Math.abs(pos.x - o.x) > o.hw + r || Math.abs(pos.z - o.z) > o.hd + r) continue;
      const cx = clamp(pos.x, o.x - o.hw, o.x + o.hw), cz = clamp(pos.z, o.z - o.hd, o.z + o.hd);
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
      else pos.x = pos.x < o.x ? o.x - o.hw - r : o.x + o.hw + r; // centre got inside: push out sideways
    }
  };

  room.onFloor = (pos) => room.floor.has(key(Math.floor(pos.x) + 0.5, Math.floor(pos.z) + 0.5));
  // shots fly over the void but stop at walls and solid props
  const b = room.bounds;
  room.blocked = (pos) => pos.x < b.x0 - 3 || pos.x > b.x1 + 3 || pos.z < b.z0 - 3 || pos.z > b.z1 + 3
    || room.obstacles.some((o) => (!o.edge || o.wall) && Math.abs(pos.x - o.x) < o.hw && Math.abs(pos.z - o.z) < o.hd);
  // a free floor spot at least `away` from a point (and within `near` of it, on a big map), for spawns
  room.freeSpot = (from, away, near = Infinity) => {
    const pool = near < Infinity ? room.plan.tiles.filter(([x, z]) => Math.abs(x - from.x) <= near && Math.abs(z - from.z) <= near) : room.plan.tiles;
    for (let i = 0; i < 60 && pool.length; i++) {
      const [x, z] = rand(pool);
      const p = new THREE.Vector3(x, 0, z), d = p.distanceTo(from);
      if (d >= away && d <= near && !room.obstacles.some((o) => !o.edge && Math.abs(x - o.x) < o.hw + 0.4 && Math.abs(z - o.z) < o.hd + 0.4)) return p;
    }
    return near < Infinity ? from.clone() : room.center.clone();
  };

  const swing = (d) => {
    d.open = true;
    d.gated.visible = false;
    d.open_.visible = true;
    burst(d.pos, C.OAK, 8);
  };
  room.openDoors = () => {
    const closed = room.doors.filter((d) => !d.open && !d.locked);
    if (closed.length) sfx('door');
    closed.forEach(swing);
  };
  room.unlock = (d) => { d.locked = false; d.lock?.removeFromParent(); swing(d); sfx('unlock'); };
  room.doorNear = (pos, range = 1.3) => room.doors.find((d) => d.pos.distanceTo(pos) < range) ?? null;

  room.addPickup = (type, x, z, patron = null) => {
    const m = makeIcon(patron ? PATRONS[patron].color : type === 'bigash' ? 'ash' : type);
    m.root.position.set(x, 0, z);
    if (type === 'bigash') m.root.scale.setScalar(1.6);
    scene.add(m.root);
    room.pickups.push({ type, obj: m.root, t: 0, patron });
    return room.pickups.at(-1);
  };

  room.update = (dt) => {
    for (const d of room.doors) {
      if (d.icon) { d.icon.position.y = 2.35 + Math.sin(world.time * 3) * 0.08; d.icon.rotation.y += dt * 1.5; }
    }
    for (const p of room.pickups) {
      p.t += dt;
      p.obj.position.y = 0.15 + Math.sin(p.t * 4) * 0.08;
      p.obj.rotation.y += dt * 2;
    }
    room.embers(dt);
    updateTraps(room, dt);
    for (const [i, h] of room.halos.entries()) h.scale.setScalar(0.8 + 0.12 * Math.sin(world.time * 11 + i * 2.3) * Math.sin(world.time * 7.3 + i));
    if (room.lightSpots.length > torchLights.length && (room.lightT -= dt) <= 0 && world.player) { room.lightT = 0.25; assignLights(room, world.player.pos); }
  };

  room.dispose = () => {
    disposeObject(room.group);
    for (const p of room.pickups) disposeObject(p.obj);
    for (const l of torchLights) { l.intensity = 0; l.userData.base = 0; }
  };
}

// Spike cycle: 2s idle, 0.7s crimson warning, 0.5s spikes up
const IDLE = 2, WARN = 0.7, UP = 0.5, CYCLE = IDLE + WARN + UP;
function updateTraps(room, dt) {
  const victims = world.enemies.filter((e) => !e.dead);
  if (world.player && !world.player.dead) victims.push(world.player);
  for (const t of room.traps) {
    t.t = (t.t + dt) % CYCLE;
    const warn = t.t > IDLE && t.t < IDLE + WARN, up = t.t >= IDLE + WARN;
    t.plate.material.color.setHex(warn || up ? C.CRIMSON : C.CHOC);
    t.spikes.position.y += ((up ? 0 : -0.5) - t.spikes.position.y) * (1 - Math.exp(-30 * dt));
    if (!up) { t.hit.clear(); continue; }
    for (const v of victims) {
      if (t.hit.has(v) || Math.abs(v.pos.x - t.x) > 0.5 || Math.abs(v.pos.z - t.z) > 0.5) continue;
      t.hit.add(v);
      damage(v, v.team === 0 ? 12 : 20, null, { stun: 0.3 });
    }
  }
}
