import * as THREE from 'three';
import { C } from './config.js';
import { basic } from './render.js';
import { prop, medieval, MEDIEVAL_SCALE } from './assets.js';
import { btn, pressed } from './input.js';
import { makePlan, BIOMES, meta } from './run.js';

// The Keep: the last dry room above the dungeon, where Dungeon runs start and end (Hades' House, in small).
// No one lives here: just the Anvil, the vow altar and the gate.

export function keepPlan() {
  const plan = makePlan(0, 'keep');
  plan.biome = BIOMES.keep;
  plan.doorPlans = [{ kind: 'keep', reward: null }];
  plan.banner = ['THE KEEP', 'The last dry room above the dungeon'];
  return plan;
}

// Vows: hard modifiers sworn at the altar in the Keep. Each makes Dungeon runs harder and pays more ash at the end.
export const VOWS = [
  { id: 'swift', name: 'Vow of Haste', desc: 'Foes move 25% faster.', bonus: 15 },
  { id: 'iron', name: 'Vow of Iron', desc: 'Foes have 40% more health.', bonus: 20 },
  { id: 'nomercy', name: 'Vow of Thirst', desc: 'No fountains, and no healing behind doors.', bonus: 15 },
  { id: 'forsworn', name: 'Vow of One Life', desc: 'No Last Breath.', bonus: 20 },
  { id: 'plague', name: 'Vow of the Horde', desc: 'Elites turn up twice as often.', bonus: 20 },
  { id: 'brittle', name: 'Vow of Glass', desc: 'Take 25% more damage.', bonus: 25 },
];
export const sworn = (run, id) => !!run?.vows?.includes(id);
export const vowBonus = (ids = []) => VOWS.filter((v) => ids.includes(v.id)).reduce((a, v) => a + v.bonus, 0);

// Puts the Anvil corner and the vow altar into a freshly built Keep room
export function furnishKeep(room) {
  const door = room.doors[0]?.pos ?? room.center, c = room.center;
  const side = new THREE.Vector3(door.z - c.z, 0, c.x - door.x).normalize();
  // the Anvil: a weapon rack and a crate of tools against the far side
  const anvil = room.freeSpot(c.clone().addScaledVector(side, 3).lerp(door, -0.2), 0, 3);
  const rack = medieval('weaponrack', MEDIEVAL_SCALE);
  rack.position.copy(anvil);
  room.group.add(rack);
  const chest = prop('box_large', 0.5);
  chest.position.copy(anvil).addScaledVector(side, -0.9);
  room.group.add(chest);
  room.obstacles.push({ x: anvil.x, z: anvil.z, hw: 0.5, hd: 0.5 }, { x: chest.position.x, z: chest.position.z, hw: 0.4, hd: 0.4 });
  // the vow altar on the other side: a pillar under a crimson flame
  const altar = room.freeSpot(c.clone().addScaledVector(side, -3).lerp(door, -0.2), 0, 3);
  const pillar = prop('pillar_decorated', 0.5);
  pillar.position.copy(altar);
  pillar.scale.multiplyScalar(0.55);
  room.group.add(pillar);
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), basic(C.CRIMSON));
  flame.position.set(altar.x, 2.3, altar.z);
  room.group.add(flame);
  room.obstacles.push({ x: altar.x, z: altar.z, hw: 0.5, hd: 0.5 });
  room.lightSpots?.push({ x: altar.x, y: 2.3, z: altar.z, color: C.CRIMSON, base: 12 });
  room.keep = { anvil, altar, flame };
}

// Each frame in the Keep: Use by the Anvil opens it
export function keepUpdate(room, player, dt = 0) {
  const k = room.keep, n = meta.vows?.length ?? 0;
  k.flame.rotation.y += dt * 2;
  k.flame.scale.setScalar(1 + n * 0.15);
  if (k.altar.distanceTo(player.pos) < 1.8) {
    if (pressed('interact')) return { vows: true };
    return { prompt: `${btn('interact')}SWEAR VOWS <span class="dim">${n ? `${n} SWORN, +${vowBonus(meta.vows)}% ASH` : 'NONE SWORN'}</span>` };
  }
  if (k.anvil.distanceTo(player.pos) >= 1.8) return {};
  if (pressed('interact')) return { anvil: true };
  return { prompt: `${btn('interact')}THE ANVIL <span class="dim">${meta.ash} ASH</span>` };
}
