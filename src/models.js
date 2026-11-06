import * as THREE from 'three';
import { C } from './config.js';
import { toon, basic } from './render.js';
import { character } from './assets.js';

// Animation names in the KayKit rigs, mapped to the roles the game asks for
const HERO = { idle: 'Idle', run: 'Running_A', dash: 'Dodge_Forward', hit: 'Hit_A', death: 'Death_A', throw: 'Throw' };
const SKEL = { idle: 'Idle_Combat', run: 'Running_C', hit: 'Hit_A', death: 'Death_C_Skeletons', spawn: 'Spawn_Ground_Skeletons' };

// ---- player classes ----

// palette ramps per class: [dark, mid, light, strength]
const KNIGHT_TINT = [C.ONYX, C.CHOC, C.OAK, 0.55], ROGUE_TINT = [C.ONYX, C.CHOC, C.OAK, 0.55], WIZARD_TINT = [C.ONYX, 0x4a2838, C.OAK, 0.5];

export const makeKnight = () => character('Knight', {
  tint: KNIGHT_TINT,
  hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'],
  anims: { ...HERO, attack: '1H_Melee_Attack_Slice_Horizontal', attack2: '1H_Melee_Attack_Slice_Diagonal', special: 'Block_Attack' },
});

export const makeRogue = () => character('Rogue_Hooded', {
  tint: ROGUE_TINT,
  hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable'],
  anims: { ...HERO, attack: 'Dualwield_Melee_Attack_Stab', attack2: 'Dualwield_Melee_Attack_Slice', special: 'Throw' },
});

export const makeWizard = () => character('Mage', {
  tint: WIZARD_TINT,
  hide: ['Spellbook', 'Spellbook_open', '1H_Wand'],
  anims: { ...HERO, attack: 'Spellcast_Shoot', special: 'Spellcast_Raise' },
});

// ---- enemies: skeletons with crimson eyes, so danger always reads as red ----

const skeleton = (name, opts) => {
  const m = character(name, opts);
  m.body.traverse((o) => {
    if (!o.isMesh || !o.name.endsWith('_Eyes')) return;
    m.mats.splice(m.mats.indexOf(o.material), 1);
    o.material = basic(C.CRIMSON);
  });
  return m;
};

export const makeGrunt = () => skeleton('Skeleton_Minion', {
  lend: [['Knight', '1H_Sword', 'handslotr']], anims: { ...SKEL, attack: '1H_Melee_Attack_Chop' },
});
export const makeHexer = () => skeleton('Skeleton_Mage', {
  lend: [['Mage', '2H_Staff', 'handslotr']], anims: { ...SKEL, attack: 'Spellcast_Shoot' },
});
export const makeBrute = () => skeleton('Skeleton_Warrior', {
  scale: 0.72, lend: [['Knight', '2H_Sword', 'handslotr']], anims: { ...SKEL, attack: '2H_Melee_Attack_Chop' },
});
export const makeStalker = () => skeleton('Skeleton_Rogue', {
  lend: [['Rogue_Hooded', 'Knife', 'handslotr'], ['Rogue_Hooded', 'Knife_Offhand', 'handslotl']],
  anims: { ...SKEL, run: 'Running_A', attack: 'Dualwield_Melee_Attack_Stab' },
});
// ---- the dead of the Wilds: Quaternius zombies, about grunt height ----
const ZOMBIE = { idle: 'Idle', run: 'Walk', hit: 'HitReact', death: 'Death', attack: 'Punch' };
export const makeZombie = () => character(Math.random() < 0.5 ? 'Zombie_Basic' : 'Zombie_Arm', { scale: 0.9, anims: ZOMBIE });
export const makeCrawler = () => character('Zombie_Ribcage', { scale: 0.9, anims: { ...ZOMBIE, run: 'Crawl', attack: 'Jump' } });
export const makeBloater = () => character('Zombie_Chubby', { scale: 0.85, anims: ZOMBIE });
export const makeSapper = () => {
  const m = skeleton('Skeleton_Minion', {
    scale: 0.44, lend: [['Rogue_Hooded', 'Throwable', 'handslotr']], anims: { ...SKEL, run: 'Running_B', attack: 'Spellcast_Raise' },
  });
  for (const mat of m.mats) mat.color.multiply(new THREE.Color(0xe8b890)); // scorched, so it reads as the one that explodes
  return m;
};
export const makeWhirler = () => skeleton('Skeleton_Rogue', {
  lend: [['Knight', '1H_Sword', 'handslotr'], ['Knight', '1H_Sword_Offhand', 'handslotl']],
  anims: { ...SKEL, attack: 'Dualwield_Melee_Attack_Slice', spin: '2H_Melee_Attack_Spinning' },
});
export const makeSlinger = () => skeleton('Skeleton_Minion', {
  lend: [['Rogue_Hooded', 'Throwable', 'handslotr']], anims: { ...SKEL, attack: 'Throw' },
});
export const makeShieldbearer = () => skeleton('Skeleton_Warrior', {
  scale: 0.58, lend: [['Knight', '1H_Sword', 'handslotr'], ['Knight', 'Rectangle_Shield', 'handslotl']],
  anims: { ...SKEL, idle: 'Blocking', run: 'Walking_B', attack: 'Block_Attack' },
});
export const makeBonecaller = () => {
  const m = skeleton('Skeleton_Mage', {
    lend: [['Mage', '1H_Wand', 'handslotr'], ['Mage', 'Spellbook_open', 'handslotl']], anims: { ...SKEL, attack: 'Spellcast_Summon' },
  });
  for (const mat of m.mats) mat.color.multiply(new THREE.Color(0xb8c8a0)); // grave-green, so you pick it out of a crowd
  return m;
};
// the other two bosses: a giant mage and a giant rogue
export const makePrior = () => {
  const m = skeleton('Skeleton_Mage', {
    scale: 1.1, lend: [['Mage', '2H_Staff', 'handslotr']],
    anims: { ...SKEL, run: 'Walking_D_Skeletons', attack: 'Spellcast_Long', cast: 'Spellcast_Summon' },
  });
  for (const mat of m.mats) mat.color.multiply(new THREE.Color(0xc0acd8));
  return m;
};
export const makeReaver = () => {
  const m = skeleton('Skeleton_Rogue', {
    scale: 1.05, lend: [['Rogue_Hooded', 'Knife', 'handslotr'], ['Rogue_Hooded', 'Knife_Offhand', 'handslotl']],
    anims: { ...SKEL, run: 'Running_A', attack: 'Dualwield_Melee_Attack_Stab', cast: 'Throw' },
  });
  for (const mat of m.mats) mat.color.multiply(new THREE.Color(0xd8c4a8));
  return m;
};
export const makeWarden = () => {
  const m = skeleton('Skeleton_Warrior', {
    scale: 1.15, lend: [['Knight', '2H_Sword', 'handslotr']],
    anims: { ...SKEL, run: 'Walking_D_Skeletons', attack: '2H_Melee_Attack_Chop', spin: '2H_Melee_Attack_Spin', cast: 'Spellcast_Summon' },
  });
  for (const mat of m.mats) mat.color.multiply(new THREE.Color(0xd8a8a0)); // bloodier than its minions
  return m;
};

// ---- Adventure mode: a village swordsmith, the princess, and the usurper's men. All KayKit, recoloured with the same ramp ----

const HUMAN = { idle: 'Idle', run: 'Running_A', hit: 'Hit_A', death: 'Death_A', attack: '1H_Melee_Attack_Chop' };
const KNIGHT_PARTS = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword'];
const knightWith = (keep) => KNIGHT_PARTS.filter((n) => !keep.includes(n));
// the Barbarian without his bear hat, cape, axes and mug: a working smith with a plain sword
export const makeSmith = () => character('Barbarian', {
  tint: [C.ONYX, 0x5a3a2a, C.OAK, 0.5],
  hide: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Barbarian_Hat', 'Barbarian_Cape'],
  lend: [['Knight', '1H_Sword', 'handslotr']],
  anims: { ...HERO, attack: '1H_Melee_Attack_Slice_Diagonal', dash: 'Dodge_Backward', dashF: 'Dodge_Forward', dashL: 'Dodge_Left', dashR: 'Dodge_Right', cheer: 'Cheer' },
});
// the Mage without hat, staff or books, in rose and gold, with a little crown
export const makePrincess = () => {
  const m = character('Mage', { tint: [0x3a1428, 0xc85a8a, 0xFFE6C8, 0.6], hide: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Mage_Hat'], anims: { idle: 'Idle', cheer: 'Cheer', run: 'Walking_A' } });
  // unlit gold, so it reads at a glance even in a dim tower
  const crown = new THREE.Group(), gold = basic(0xF0C040);
  crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.16, 8), gold));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), gold);
    spike.position.set(Math.cos(a) * 0.33, 0.17, Math.sin(a) * 0.33);
    crown.add(spike);
  }
  let head = null;
  m.body.traverse((o) => { if (!head && o.isBone && /^head$/i.test(o.name)) head = o; });
  crown.position.set(0, 1.05, 0); // just above the hair, in the head bone's space
  (head ?? m.body).add(crown);
  return m;
};
export const makeBandit = () => character('Rogue_Hooded', {
  tint: [C.ONYX, 0x8a5a3a, 0xE0C8A0, 0.95], hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable', 'Knife_Offhand'],
  anims: { ...HUMAN, attack: 'Dualwield_Melee_Attack_Stab' },
});
export const makeCrossbowman = () => character('Rogue_Hooded', {
  tint: [C.ONYX, 0x4a5a80, 0xC8D0E0, 0.95], hide: ['1H_Crossbow', 'Throwable', 'Knife', 'Knife_Offhand'],
  anims: { ...HUMAN, attack: '2H_Ranged_Shoot' },
});
export const makeGuard = () => character('Knight', { tint: [C.ONYX, C.CRIMSON, C.OAK, 0.5], hide: knightWith(['1H_Sword', 'Rectangle_Shield']), anims: { ...HUMAN, attack: 'Block_Attack' } });
export const makeSoldier = () => character('Knight', { tint: [C.ONYX, 0x6E5050, C.OAK, 0.5], hide: [...knightWith(['1H_Sword']), 'Knight_Cape'], anims: HUMAN });
export const makeCaptain = () => character('Knight', { scale: 0.58, tint: [C.ONYX, 0x8a6a2a, 0xF0D898, 0.55], hide: knightWith(['1H_Sword', 'Badge_Shield']), anims: { ...HUMAN, attack: '1H_Melee_Attack_Slice_Horizontal' } });
export const makeBlackKnight = () => character('Knight', {
  scale: 0.68, tint: [0x08080c, 0x24242c, 0x5a5a66, 0.8], hide: knightWith(['2H_Sword']),
  anims: { ...HUMAN, attack: '2H_Melee_Attack_Slice', spin: '2H_Melee_Attack_Spin' },
});

// ---- pickups and door icons (code-made: they need to glow and read at a glance) ----

function part(group, geo, color, x, y, z, glow = false) {
  const mesh = new THREE.Mesh(geo, glow ? basic(color) : toon(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = !glow;
  group.add(mesh);
  return mesh;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export function makeIcon(type) {
  const root = new THREE.Group();
  if (type === 'key') {
    part(root, new THREE.TorusGeometry(0.16, 0.06, 4, 8), C.OAK, 0, 0.3, 0, true);
    part(root, box(0.08, 0.08, 0.5), C.OAK, 0, 0.3, 0.4, true);
    part(root, box(0.08, 0.16, 0.08), C.OAK, 0, 0.22, 0.58, true);
  } else if (type === 'heal') {
    part(root, new THREE.OctahedronGeometry(0.28), C.CRIMSON, 0, 0.35, 0, true);
  } else if (type === 'skull') {
    part(root, box(0.4, 0.36, 0.38), C.OAK, 0, 0.35, 0, true);
    for (const x of [-0.09, 0.09]) part(root, box(0.1, 0.1, 0.03), C.CRIMSON, x, 0.38, 0.2, true);
  } else if (type === 'pom') {
    part(root, new THREE.DodecahedronGeometry(0.24), C.CRIMSON, 0, 0.35, 0);
    part(root, box(0.06, 0.16, 0.06), C.OAK, 0, 0.62, 0, true);
  } else if (type === 'shard') {
    const m = part(root, new THREE.OctahedronGeometry(0.16), C.SAND, 0, 0.3, 0, true);
    m.scale.set(0.6, 1.4, 0.6);
  } else if (type === 'ash') {
    for (const [x, z, s] of [[0, 0, 0.22], [0.16, 0.1, 0.14], [-0.12, 0.12, 0.12]]) part(root, box(s, s, s), C.OAK, x, s / 2, z, true);
  } else {
    // a boon: glowing orb tinted by its patron, with a ring
    part(root, new THREE.IcosahedronGeometry(0.22), typeof type === 'number' ? type : C.SAND, 0, 0.35, 0, true);
    part(root, new THREE.TorusGeometry(0.34, 0.03, 4, 12), C.SAND, 0, 0.35, 0, true);
  }
  return { root };
}

// Frees GPU memory for something gone for good. Geometry/materials shared with loaded assets are left alone.
export function disposeObject(obj) {
  obj.removeFromParent();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.shared) o.geometry.dispose();
    if (!o.userData.shared || o.userData.ownMat) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}
