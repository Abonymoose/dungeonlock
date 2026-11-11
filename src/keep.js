import * as THREE from 'three';
import { prop, medieval, MEDIEVAL_SCALE } from './assets.js';
import { btn, pressed } from './input.js';
import { makePlan, BIOMES, meta } from './run.js';

// The Keep: the last dry room above the dungeon, where Dungeon runs start and end (Hades' House, in small).
// Just the Anvil and the gate: no one lives here.

export function keepPlan() {
  const plan = makePlan(0, 'keep');
  plan.biome = BIOMES.keep;
  plan.doorPlans = [{ kind: 'keep', reward: null }];
  plan.banner = ['THE KEEP', 'The last dry room above the dungeon'];
  return plan;
}

// Puts the Anvil corner into a freshly built Keep room
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
  room.keep = { anvil };
}

// Each frame in the Keep: Use by the Anvil opens it
export function keepUpdate(room, player) {
  if (room.keep.anvil.distanceTo(player.pos) >= 1.8) return {};
  if (pressed('interact')) return { anvil: true };
  return { prompt: `${btn('interact')}THE ANVIL <span class="dim">${meta.ash} ASH</span>` };
}
