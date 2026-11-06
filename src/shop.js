import * as THREE from 'three';
import { C } from './config.js';
import { character, prop } from './assets.js';
import { basic } from './render.js';

// The Peddler: a hooded trader who turns up behind some doors from depth 3. He sells for the ash you carry this run.
// Each item once per visit; prices climb with depth.
export const WARES = [
  { id: 'draught', name: 'Healing Draught', desc: 'Heal 40% of your health.', base: 30 },
  { id: 'key', name: 'Key', desc: 'One more key for a vault or the Lock.', base: 45 },
  { id: 'boon', name: "Patron's Gift", desc: 'Choose a boon from a random patron.', base: 70 },
  { id: 'keystone', name: 'Keystone', desc: 'Raise a boon you carry by one level.', base: 55 },
  { id: 'vigor', name: 'Hearty Meal', desc: '+15 max health, and heal 15.', base: 50 },
];
export const priceOf = (w, depth) => Math.round(w.base * (1 + depth * 0.04));

// The Shrine of the Lock: three bargains, pick one. Debts (curses) last three cleared rooms.
export const BARGAINS = [
  { id: 'blood', name: 'Blood Price', desc: 'Lose 20% of your max health. Choose an Epic boon.' },
  { id: 'iron', name: 'Iron Debt', desc: 'Foes have 40% more health for the next three rooms. Gain 120 ash now.', curse: 'Iron Debt' },
  { id: 'glass', name: 'Glass Pact', desc: 'Take 30% more damage for the next three rooms. Gain a key and a Keystone.', curse: 'Glass Pact' },
];

export function furnishShrine(room) {
  const at = room.freeSpot(room.center, 0, 2);
  const base = prop('pillar_decorated', 0.5);
  base.position.copy(at);
  base.scale.multiplyScalar(0.6);
  room.group.add(base);
  for (const [dx, dz] of [[0.9, 0.4], [-0.9, 0.4], [0, -0.9]]) {
    const c = prop('candle_triple', 0.5);
    c.position.set(at.x + dx, 0, at.z + dz);
    room.group.add(c);
  }
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3), basic(C.CRIMSON));
  orb.position.set(at.x, 2.6, at.z);
  room.group.add(orb);
  room.obstacles.push({ x: at.x, z: at.z, hw: 0.5, hd: 0.5 });
  room.lightSpots?.push({ x: at.x, y: 2.6, z: at.z, color: C.CRIMSON, base: 14 });
  room.shrine = { pos: at, orb, used: false };
}

export function furnishShop(room) {
  const c = room.center;
  const peddler = character('Rogue_Hooded', { tint: [C.ONYX, 0x3a2a4a, 0xd8c8b0, 0.7], hide: ['1H_Crossbow', '2H_Crossbow', 'Knife', 'Knife_Offhand'], anims: { idle: 'Idle', cheer: 'Cheer' } });
  const at = room.freeSpot(c.clone().add(new THREE.Vector3(-1.2, 0, -1.2)), 0, 2);
  peddler.root.position.copy(at);
  peddler.root.rotation.y = Math.PI / 4;
  peddler.anim.loop('idle');
  room.group.add(peddler.root);
  // his stall: crates, a barrel and a lit candle
  for (const [name, dx, dz] of [['box_large', 0.9, -0.3], ['barrel_small', -0.8, 0.5], ['candle_triple', 0.9, -0.3]]) {
    const o = prop(name, 0.5);
    o.position.set(at.x + dx, name === 'candle_triple' ? 0.5 : 0, at.z + dz);
    room.group.add(o);
  }
  room.obstacles.push({ x: at.x, z: at.z, hw: 0.4, hd: 0.4 }, { x: at.x + 0.9, z: at.z - 0.3, hw: 0.4, hd: 0.4 });
  const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), basic(C.SAND));
  glow.position.y = 2.1;
  peddler.root.add(glow);
  room.shop = { pos: at, model: peddler, sold: new Set(), glow };
  room.extras = [peddler];
}
