import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { input, pressed, isHeld, rumble } from './input.js';
import { GROUND_RIGHT, GROUND_UP, basic, flashLight, screenToGround } from './render.js';
import { makeKnight, makeRogue, makeWizard, makeBarbarian, makeNecromancer, makeSmith } from './models.js';
import { summonAlly } from './enemies.js';
import { hooks, makeEntity, meleeArc, fireProjectile, aoe, spawnGhost, addTrail, moveEntity, tickEntity, turnToward, opponents, damage, heal } from './combat.js';
import { sfx } from './audio.js';

const Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), aimDir = new THREE.Vector3(), move = new THREE.Vector3();

// true when the attacker stands behind the target (target faces away)
const behind = (p) => (t) => tmp.subVectors(p.pos, t.pos).setY(0).normalize().dot(t.facing) < -0.2;

// Every class can reach every room; they differ only in how they handle danger.
export const CLASSES = {
  knight: {
    name: 'Knight', blurb: 'Slow and armored. Shrugs off hits that would floor anyone else.',
    hp: 120, speed: 4.4, armor: 0.2, model: makeKnight, swingAxis: 'y',
    attack: {
      name: 'Cleave', cd: 0.42, desc: 'Wide sword arcs; every third is a heavy sweep',
      use: (p, f) => meleeArc(p, { range: f.fin ? 2.3 : 1.9, arc: f.fin ? 3.6 : 2.6, damage: 16 * p.mods.atk * f.mult, knockback: f.fin ? 11 : 6, heavy: f.fin, tag: 'attack' }),
    },
    special: {
      name: 'Shield Charge', cd: 1.4, desc: 'Charge forward and stun what you hit',
      use: (p) => { p.charge = { t: 0.32, hit: new Set() }; p.invuln = Math.max(p.invuln, 0.34); addTrail(() => (p.charge ? p.pos.clone().setY(0.45) : undefined), C.SAND, 0.9); },
    },
    dash: { name: 'Roll', speed: 13, time: 0.16, cd: 0.55, charges: 1 },
    passive: 'Takes 20% less damage',
  },
  rogue: {
    name: 'Rogue', blurb: 'Fast and fragile, and the only one with two dashes.',
    hp: 70, speed: 6.4, armor: 0, model: makeRogue, swingAxis: 'y',
    attack: {
      name: 'Stab', cd: 0.2, desc: 'Fast jabs, double damage from behind',
      use: (p, f) => meleeArc(p, { range: f.fin ? 1.6 : 1.35, arc: 1.5, damage: 9 * p.mods.atk * f.mult, knockback: f.fin ? 7 : 2, critIf: behind(p), heavy: f.fin, tag: 'attack' }),
    },
    special: {
      name: 'Knife Fan', cd: 0.9, desc: 'Throw three knives in a spread',
      use: (p) => {
        for (const a of [-0.25, 0, 0.25]) {
          fireProjectile({ owner: p, dir: aimDir.copy(p.facing).applyAxisAngle(Y, a), speed: 16, damage: 13 * p.mods.spc, range: 9, color: C.SAND, tag: 'special' });
        }
      },
    },
    dash: { name: 'Shadowstep', speed: 19, time: 0.15, cd: 0.6, charges: 2 },
    passive: 'Two dash charges',
  },
  wizard: {
    name: 'Wizard', blurb: 'Frail, and fights from range. Blinks through danger instead of rolling.',
    hp: 80, speed: 5.2, armor: 0, model: makeWizard, swingAxis: 'x',
    attack: {
      name: 'Arcane Bolt', cd: 0.34, desc: 'Magic bolts; every third pierces',
      use: (p, f) => fireProjectile({ owner: p, dir: p.facing, speed: f.fin ? 18 : 14, damage: 11 * p.mods.atk * f.mult, range: 10, size: f.fin ? 0.26 : 0.16, pierce: f.fin, color: C.SAND, tag: 'attack' }),
    },
    special: {
      name: 'Frost Nova', cd: 2.4, desc: 'Burst around you that freezes enemies',
      use: (p) => aoe(p, { pos: p.pos, radius: 3, damage: 16 * p.mods.spc, knockback: 7, stun: 0.9, slow: 2, color: C.SAND, tag: 'special' }),
    },
    dash: { name: 'Blink', blink: 3.4, cd: 1.0, charges: 1 },
    passive: 'Blink teleports through danger', ranged: true,
  },
  necromancer: {
    name: 'Necromancer', blurb: 'Frail, and never alone. The dead get up when he asks.',
    hp: 75, speed: 5.0, armor: 0, model: makeNecromancer, swingAxis: 'x', ranged: true,
    attack: {
      name: 'Bone Bolt', cd: 0.36, desc: 'Bolts of bone; every third splits in three',
      use: (p, f) => { for (const a of f.fin ? [-0.2, 0, 0.2] : [0]) fireProjectile({ owner: p, dir: aimDir.copy(p.facing).applyAxisAngle(Y, a), speed: 15, damage: 10 * p.mods.atk * f.mult, range: 10, size: 0.16, color: C.OAK, tag: 'attack' }); },
    },
    special: {
      name: 'Raise Dead', cd: 6, desc: 'Two skeletons rise beside you and fight for twelve seconds',
      use: (p) => raise(p, 'grunt', 2, 12),
    },
    dash: { name: 'Shade Step', speed: 14, time: 0.15, cd: 0.7, charges: 1 },
    passive: 'The dead he raises fight beside him',
  },
  barbarian: {
    name: 'Barbarian', blurb: 'Huge, tough and angry. The more he bleeds, the harder he hits.',
    hp: 140, speed: 4.6, armor: 0.1, model: makeBarbarian, swingAxis: 'y',
    attack: {
      name: 'Chop', cd: 0.55, desc: 'Heavy two-handed chops; every third spins all the way round',
      use: (p, f) => meleeArc(p, { range: f.fin ? 2.4 : 2.2, arc: f.fin ? Math.PI * 2 : 2.4, damage: 24 * p.mods.atk * f.mult * rage(p), knockback: f.fin ? 11 : 7, heavy: f.fin, tag: 'attack' }),
    },
    special: {
      name: 'War Cry', cd: 2.6, desc: 'A roar that stuns everything near you and heals you a little',
      use: (p) => { aoe(p, { pos: p.pos, radius: 3.4, damage: 8 * p.mods.spc * rage(p), knockback: 6, stun: 1.0, color: C.SAND, tag: 'special' }); heal(p, p.maxHp * 0.06); world.shake = 0.2; },
    },
    dash: { name: 'Leap', speed: 12, time: 0.2, cd: 0.7, charges: 1 },
    passive: 'Rage: up to 50% more damage as his health runs low',
  },
};

// the Necromancer's Special: n of the dead rise around you and fight for life seconds
function raise(p, type, n, life) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    const at = world.room.freeSpot(p.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4)), 0, 2);
    summonAlly(type, at.x, at.z, world.run?.depth ?? 0, life);
  }
}

// the Barbarian's passive: 1 at full health, 1.5 at none
const rage = (p) => 1 + 0.5 * (1 - Math.max(0, p.hp) / p.maxHp);

// Three weapons per class. The first is the class as it comes; the others cost ash once, on class select.
// A weapon brings its own Attack and Special (and what the hero holds); health, dash and passive stay the class's.
export const WEAPONS = {
  knight: [
    { id: 'sword', name: 'Sword and Shield', desc: 'Wide sword arcs, and a shield charge that stuns.' },
    {
      id: 'greatsword', name: 'Greatsword', cost: 150, desc: 'Two hands, slow and wide. Heavy sweeps, and a slam that stuns everything near you.',
      hide: ['1H_Sword', '1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', 'Round_Shield'],
      anims: { attack: '2H_Melee_Attack_Slice', attack2: '2H_Melee_Attack_Spin', special: '2H_Melee_Attack_Chop' },
      attack: {
        name: 'Sweep', cd: 0.6, desc: 'Slow, wide sweeps; every third spins all the way round',
        use: (p, f) => meleeArc(p, { range: f.fin ? 2.6 : 2.4, arc: f.fin ? Math.PI * 2 : 3.0, damage: 24 * p.mods.atk * f.mult, knockback: f.fin ? 12 : 8, heavy: f.fin, tag: 'attack' }),
      },
      special: {
        name: 'Earthsplitter', cd: 2.2, desc: 'Slam the ground and stun everything around you',
        use: (p) => { aoe(p, { pos: p.pos, radius: 3.2, damage: 22 * p.mods.spc, knockback: 10, stun: 0.8, color: C.SAND, tag: 'special' }); world.shake = 0.3; },
      },
    },
    {
      id: 'twinblades', name: 'Twin Blades', cost: 200, desc: 'A sword in each hand and no shield. Quick cuts, and a lunge that carries you through a crowd.',
      hide: ['Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', 'Round_Shield', '2H_Sword'],
      anims: { attack: 'Dualwield_Melee_Attack_Slice', attack2: 'Dualwield_Melee_Attack_Chop', special: 'Dualwield_Melee_Attack_Stab' },
      attack: {
        name: 'Flurry', cd: 0.24, desc: 'Fast crossing cuts',
        use: (p, f) => meleeArc(p, { range: 1.7, arc: 2.2, damage: 10 * p.mods.atk * f.mult, knockback: f.fin ? 7 : 3, heavy: f.fin, tag: 'attack' }),
      },
      special: {
        name: 'Lunge', cd: 1.2, desc: 'Leap forward and cut everything in your path',
        use: (p) => {
          p.knock.addScaledVector(p.facing, 16);
          p.invuln = Math.max(p.invuln, 0.25);
          addTrail(() => (p.knock.lengthSq() > 4 ? p.pos.clone().setY(0.45) : undefined), C.SAND, 0.7);
          aoe(p, { pos: p.pos.clone().addScaledVector(p.facing, 1.8), radius: 1.7, damage: 22 * p.mods.spc, knockback: 6, color: C.SAND, tag: 'special' });
        },
      },
    },
  ],
  rogue: [
    { id: 'daggers', name: 'Daggers', desc: 'Fast stabs that crit from behind, and a fan of knives.' },
    {
      id: 'crossbow', name: 'Crossbow', cost: 150, ranged: true, desc: 'Fight from range. Heavy bolts that punch through on every third shot, and a volley of five.',
      hide: ['1H_Crossbow', 'Throwable', 'Knife', 'Knife_Offhand'],
      anims: { attack: '2H_Ranged_Shoot', attack2: '2H_Ranged_Shoot', special: '2H_Ranged_Shoot' },
      attack: {
        name: 'Bolt', cd: 0.5, desc: 'Heavy bolts; every third goes through',
        use: (p, f) => fireProjectile({ owner: p, dir: p.facing, speed: 22, damage: 15 * p.mods.atk * f.mult, range: 14, size: f.fin ? 0.22 : 0.15, pierce: f.fin, color: C.SAND, tag: 'attack' }),
      },
      special: {
        name: 'Volley', cd: 1.3, desc: 'Five bolts in a wide spread',
        use: (p) => { for (const a of [-0.4, -0.2, 0, 0.2, 0.4]) fireProjectile({ owner: p, dir: aimDir.copy(p.facing).applyAxisAngle(Y, a), speed: 20, damage: 11 * p.mods.spc, range: 11, color: C.SAND, tag: 'special' }); },
      },
    },
    {
      id: 'knives', name: 'Throwing Knives', cost: 200, ranged: true, desc: 'Very fast throws at short range, and a smoke bomb that stuns everything around you.',
      hide: ['1H_Crossbow', '2H_Crossbow', 'Knife', 'Knife_Offhand'],
      anims: { attack: 'Throw', attack2: 'Throw', special: 'Throw' },
      attack: {
        name: 'Toss', cd: 0.2, desc: 'Quick knives at short range',
        use: (p, f) => fireProjectile({ owner: p, dir: p.facing, speed: 18, damage: 8 * p.mods.atk * f.mult, range: 7, size: 0.12, color: C.SAND, tag: 'attack' }),
      },
      special: {
        name: 'Smoke Bomb', cd: 1.8, desc: 'Stun everything around you, and you cannot be hit for a moment',
        use: (p) => { aoe(p, { pos: p.pos, radius: 2.4, damage: 6 * p.mods.spc, stun: 1.2, color: C.OAK, tag: 'special' }); p.invuln = Math.max(p.invuln, 0.6); },
      },
    },
  ],
  necromancer: [
    { id: 'bonewand', name: 'Bone Wand', desc: 'Bolts of bone, and two skeletons raised to fight beside you.' },
    {
      id: 'gravestaff', name: 'Grave Staff', cost: 150, desc: 'Slow bolts that pass through foes and heal you for each one hit, and two skeleton archers.',
      hide: ['Spellbook', 'Spellbook_open', '1H_Wand'],
      anims: { attack: 'Spellcast_Long', special: 'Spellcast_Summon' },
      attack: {
        name: 'Grave Bolt', cd: 0.5, desc: 'A slow bolt that goes through foes; each one it hits heals you 1',
        use: (p, f) => fireProjectile({ owner: p, dir: p.facing, speed: 10, damage: 13 * p.mods.atk * f.mult, range: 11, size: 0.2, pierce: true, color: C.OAK, tag: 'attack', onHit: () => heal(p, 1) }),
      },
      special: {
        name: 'Raise Archers', cd: 7, desc: 'Two skeleton archers rise and shoot for twelve seconds',
        use: (p) => raise(p, 'hexer', 2, 12),
      },
    },
    {
      id: 'deadbook', name: 'Book of the Dead', cost: 200, desc: 'Draining bolts at close range that heal you as they land, and one great brute raised to fight for you.',
      hide: ['Spellbook', '1H_Wand', '2H_Staff'],
      anims: { attack: 'Spellcast_Shoot', special: 'Spellcast_Summon' },
      attack: {
        name: 'Soul Drain', cd: 0.22, desc: 'Quick bolts at close range; each hit heals you 1',
        use: (p, f) => fireProjectile({ owner: p, dir: p.facing, speed: 16, damage: 6 * p.mods.atk * f.mult, range: 6.5, size: 0.13, color: C.OAK, tag: 'attack', onHit: () => heal(p, 1) }),
      },
      special: {
        name: 'Raise Brute', cd: 9, desc: 'A brute rises and fights for you for ten seconds',
        use: (p) => raise(p, 'brute', 1, 10),
      },
    },
  ],
  barbarian: [
    { id: 'greataxe', name: 'Greataxe', desc: 'Heavy chops that spin on every third, and a war cry that stuns.' },
    {
      id: 'twinaxes', name: 'Twin Axes', cost: 150, desc: 'An axe in each hand. Fast hacking, and two thrown axes that cut through a crowd.',
      hide: ['2H_Axe', 'Barbarian_Round_Shield', 'Mug'],
      anims: { attack: 'Dualwield_Melee_Attack_Chop', attack2: 'Dualwield_Melee_Attack_Slice', special: 'Throw' },
      attack: {
        name: 'Hack', cd: 0.28, desc: 'Fast two-handed hacking',
        use: (p, f) => meleeArc(p, { range: 1.8, arc: 2.0, damage: 11 * p.mods.atk * f.mult * rage(p), knockback: f.fin ? 7 : 3, heavy: f.fin, tag: 'attack' }),
      },
      special: {
        name: 'Axe Throw', cd: 1.2, desc: 'Throw both axes; they go through everything',
        use: (p) => { for (const a of [-0.12, 0.12]) fireProjectile({ owner: p, dir: aimDir.copy(p.facing).applyAxisAngle(Y, a), speed: 15, damage: 18 * p.mods.spc * rage(p), range: 10, size: 0.22, pierce: true, color: C.SAND, tag: 'special' }); },
      },
    },
    {
      id: 'axeshield', name: 'Axe and Shield', cost: 200, desc: 'A hand axe and a round shield. Solid cuts, and a shield bash that bowls foes over.',
      hide: ['2H_Axe', '1H_Axe_Offhand', 'Mug'],
      anims: { attack: '1H_Melee_Attack_Chop', attack2: '1H_Melee_Attack_Slice_Diagonal', special: 'Block_Attack' },
      attack: {
        name: 'Cleave', cd: 0.4, desc: 'Steady one-handed cuts',
        use: (p, f) => meleeArc(p, { range: 1.9, arc: 2.4, damage: 17 * p.mods.atk * f.mult * rage(p), knockback: f.fin ? 9 : 5, heavy: f.fin, tag: 'attack' }),
      },
      special: {
        name: 'Shield Bash', cd: 1.4, desc: 'Charge behind the shield and stun what you hit',
        use: (p) => { p.charge = { t: 0.32, hit: new Set() }; p.invuln = Math.max(p.invuln, 0.34); addTrail(() => (p.charge ? p.pos.clone().setY(0.45) : undefined), C.SAND, 0.9); },
      },
    },
  ],
  wizard: [
    { id: 'staff', name: 'Staff', desc: 'Arcane bolts that pierce on every third, and a freezing nova.' },
    {
      id: 'wand', name: 'Wand', cost: 150, ranged: true, desc: 'Rapid sparks that fan out on every third, and three slow orbs that go through everything.',
      hide: ['Spellbook_open', '2H_Staff'],
      anims: { attack: 'Spellcast_Shoot', special: 'Spellcast_Summon' },
      attack: {
        name: 'Spark', cd: 0.16, desc: 'Fast little sparks; every third fans out',
        use: (p, f) => { for (const a of f.fin ? [-0.15, 0, 0.15] : [0]) fireProjectile({ owner: p, dir: aimDir.copy(p.facing).applyAxisAngle(Y, a), speed: 18, damage: 6 * p.mods.atk * f.mult, range: 9, size: 0.12, color: C.SAND, tag: 'attack' }); },
      },
      special: {
        name: 'Arcane Orbs', cd: 2.0, desc: 'Three slow orbs that pass through every foe',
        use: (p) => { for (const a of [-0.35, 0, 0.35]) fireProjectile({ owner: p, dir: aimDir.copy(p.facing).applyAxisAngle(Y, a), speed: 6, damage: 14 * p.mods.spc, range: 9, size: 0.32, pierce: true, color: C.SAND, tag: 'special' }); },
      },
    },
    {
      id: 'tome', name: 'Book of Storms', cost: 200, ranged: true, desc: 'Slow hexes that burst where they land, and a well that drags foes together.',
      hide: ['Spellbook', '1H_Wand', '2H_Staff'],
      anims: { attack: 'Spellcast_Shoot', special: 'Spellcast_Raise' },
      attack: {
        name: 'Hex Burst', cd: 0.55, desc: 'A slow hex that bursts where it lands',
        use: (p, f) => {
          const burstAt = (pos) => aoe(p, { pos, radius: f.fin ? 2.0 : 1.5, damage: 12 * p.mods.atk * f.mult, knockback: 4, color: C.SAND, tag: 'attack' });
          fireProjectile({ owner: p, dir: p.facing, speed: 11, damage: 6 * p.mods.atk * f.mult, range: 9, size: 0.22, color: C.SAND, tag: 'attack', onHit: (t) => burstAt(t.pos.clone()), onExpire: burstAt });
        },
      },
      special: {
        name: 'Gravity Well', cd: 2.4, desc: 'Drag everything near a point in front of you into it',
        use: (p) => aoe(p, { pos: p.pos.clone().addScaledVector(p.facing, 3.5), radius: 3.2, damage: 12 * p.mods.spc, knockback: -9, slow: 2, color: C.SAND, tag: 'special' }),
      },
    },
  ],
};
// which weapons a save owns and has equipped; the first of each class is always owned
export const owns = (meta, w) => !w.cost || !!meta.owned?.includes(w.id);
export const equipped = (id, meta) => WEAPONS[id].find((w) => w.id === meta.gear?.[id] && owns(meta, w)) ?? WEAPONS[id][0];
// a class with a weapon in hand: the weapon's moves over the class's
export const armed = (id, w) => ({ ...CLASSES[id], attack: w.attack ?? CLASSES[id].attack, special: w.special ?? CLASSES[id].special, ranged: w.ranged ?? CLASSES[id].ranged, weapon: w });

// Adventure mode's hero, kept apart from the classes so he never shows on class select.
// Grounded: one honest swing with a windup, and one short step. No Cast, no Special, no long dash.
export const SMITH = {
  name: 'Swordsmith', blurb: 'A village smith with a sword he made himself.', hp: 60, speed: 4.2, armor: 0, model: makeSmith, swingAxis: 'y', grounded: true,
  attack: {
    name: 'Swing', cd: 0.62, windup: 0.18, desc: 'One heavy swing',
    use: (p) => meleeArc(p, { range: 1.55 + (p.reach ?? 0), arc: 1.8, damage: 24 * p.mods.atk, knockback: 6, tag: 'attack' }),
  },
  special: null,
  dash: { name: 'Step', speed: 8.5, time: 0.14, cd: 0.7, charges: 1, step: true, invuln: 0.06 },
  passive: 'No magic. Every hit counts',
};

// Cast, shared by every class like Hades' bloodstone: a limited shard that lodges in a foe
// and drops when it dies, so you have to go get it back.
export const CAST = { name: 'Lock Shard', desc: 'Throw a shard that sticks in a foe. Pick it back up.' };
function cast(p) {
  p.ammo--;
  fireProjectile({
    owner: p, dir: p.facing, speed: 22, damage: 30 * p.mods.cast, range: 11, size: 0.2, color: C.SAND, knockback: 4,
    tag: 'cast',
    onHit: (t) => { t.shards = (t.shards ?? 0) + 1; hooks.onCast?.(t.pos.clone()); },
    onExpire: (pos) => { world.room.addPickup('shard', pos.x, pos.z); hooks.onCast?.(pos); },
  });
}

export function createPlayer(id, meta, weapon = null) {
  const cls = id === 'smith' ? SMITH : armed(id, weapon ?? WEAPONS[id][0]);
  if (cls.grounded) meta = { vitality: 0, whetstone: 0, shards: -2, quickstep: 0 }; // the Anvil's upgrades are for the dungeon; his come from his own forge
  const model = cls.model(cls.weapon);
  // x-ray silhouette: draws only where something stands in front of the player, so you never lose them
  const xray = basic(C.SAND, { transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false });
  const meshes = [];
  model.root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  for (const o of meshes) {
    let x;
    if (o.isSkinnedMesh) {
      x = new THREE.SkinnedMesh(o.geometry, xray);
      x.bind(o.skeleton, o.bindMatrix);
      x.position.copy(o.position); x.quaternion.copy(o.quaternion); x.scale.copy(o.scale);
      o.parent.add(x);
    } else {
      x = new THREE.Mesh(o.geometry, xray);
      o.add(x);
    }
    x.frustumCulled = false;
    x.castShadow = false;
    x.userData.shared = true;
  }
  const p = makeEntity(model, { team: 0, hp: cls.hp + meta.vitality * 10, radius: 0.32, speed: cls.speed, armor: cls.armor });
  const dmg = 1 + meta.whetstone * 0.08;
  Object.assign(p, {
    id, cls, atkCd: 0, spcCd: 0, dashCd: 0, dashCharges: cls.dash.charges, dashT: 0, dashDir: new THREE.Vector3(),
    attackLock: 0, swingT: 0, walkT: 0, charge: null, deathT: 0, boons: [], combo: 0,
    ammo: 2 + (meta.shards ?? 0), maxAmmo: 2 + (meta.shards ?? 0),
    mods: { atk: dmg, spc: dmg, cast: dmg, speed: 1, atkCd: 1, spcCd: 1, dashCd: 1 - meta.quickstep * 0.08, lifesteal: 0, thorns: 0, extraDash: 0 },
  });
  p.facing.copy(GROUND_UP);
  model.root.rotation.y = Math.atan2(p.facing.x, p.facing.z);
  return p;
}

export const maxDashes = (p) => p.cls.dash.charges + p.mods.extraDash;

// Light aim assist: snap facing to the enemy closest to where you're pointing, if it's within a small cone
function assist(p, range) {
  let best = null, bestDot = Math.cos(0.4);
  for (const t of opponents(0)) {
    tmp.subVectors(t.pos, p.pos).setY(0);
    const d = tmp.length();
    if (d > range || d < 0.01) continue;
    const dot = tmp.dot(p.facing) / d;
    if (dot > bestDot) { bestDot = dot; best = t; }
  }
  if (best) p.facing.subVectors(best.pos, p.pos).setY(0).normalize();
}

// the dodge that matches a step's direction against where you face
function stepAnim(p) {
  const ahead = p.facing.dot(p.dashDir), side = p.facing.x * p.dashDir.z - p.facing.z * p.dashDir.x;
  if (ahead > 0.7) return 'dashF';
  if (ahead < -0.7) return 'dash';
  return side > 0 ? 'dashR' : 'dashL';
}

// touch auto-aim: the closest living enemy within reach, if any
let foe = null;
function nearestFoe(p, reach = 7) {
  let best = null, d2 = reach * reach;
  for (const e of opponents(0)) {
    const d = e.pos.distanceToSquared(p.pos);
    if (d < d2 && d > 0.01) { d2 = d; best = e; }
  }
  return best;
}

export function updatePlayer(p, dt) {
  const cls = p.cls;
  tickEntity(p, dt);
  if (p.dead) return animateDeath(p, dt);

  move.set(0, 0, 0).addScaledVector(GROUND_RIGHT, input.move.x).addScaledVector(GROUND_UP, -input.move.y);
  const busy = p.dashT > 0 || p.charge;
  if (!busy) {
    if (input.aim) p.facing.set(0, 0, 0).addScaledVector(GROUND_RIGHT, input.aim.x).addScaledVector(GROUND_UP, -input.aim.y).normalize();
    else if (input.mouseAim && input.mouse) {
      // keyboard and mouse: always face the cursor, twin-stick style
      const g = screenToGround(input.mouse.x, input.mouse.y).sub(p.pos).setY(0);
      if (g.lengthSq() > 0.04) p.facing.copy(g.normalize());
    } else if (input.touch && (foe = nearestFoe(p))) p.facing.copy(foe.pos).sub(p.pos).setY(0).normalize();
    else if (move.lengthSq() > 0.0001) p.facing.copy(move).normalize();
  }

  p.atkCd -= dt; p.spcCd -= dt; p.attackLock -= dt;
  p.sinceDash = (p.sinceDash ?? 9) + dt;
  if (p.dashCharges < maxDashes(p)) {
    p.dashCd -= dt;
    if (p.dashCd <= 0) { p.dashCharges++; p.dashCd = cls.dash.cd * p.mods.dashCd; }
  }

  if (pressed('dash') && p.dashCharges > 0 && !p.charge) {
    if (p.dashCharges === maxDashes(p)) p.dashCd = cls.dash.cd * p.mods.dashCd;
    p.dashCharges--;
    p.sinceDash = 0;
    if (!cls.dash.blink && !cls.dash.step) addTrail(() => (p.dashT > 0 ? p.pos.clone().setY(0.45) : undefined), C.SAND, 0.7);
    // a step goes the way you move (back when you stand still) and keeps you facing the fight
    if (cls.dash.step) {
      if (move.lengthSq() > 0.01) p.dashDir.copy(move).normalize();
      else p.dashDir.copy(p.facing).negate();
    } else { p.dashDir.copy(move.lengthSq() > 0.01 ? move : p.facing).normalize(); p.facing.copy(p.dashDir); }
    if (cls.dash.blink) {
      spawnGhost(p.model);
      p.pos.addScaledVector(p.dashDir, cls.dash.blink);
      // never blink out over the void: step back until there's floor underfoot
      for (let i = 0; i < 14 && !world.room.onFloor(p.pos); i++) p.pos.addScaledVector(p.dashDir, -0.25);
      world.room.collide(p.pos, p.radius);
      p.invuln = Math.max(p.invuln, 0.2);
      p.model.root.rotation.y = Math.atan2(p.facing.x, p.facing.z);
      flashLight(p.pos, C.SAND, 8, 0.2);
      hooks.onDash?.(p.pos.clone());
      sfx('blink');
    } else {
      p.dashT = cls.dash.time;
      p.invuln = Math.max(p.invuln, cls.dash.invuln ?? cls.dash.time + 0.05);
      p.model.anim.once(cls.dash.step ? stepAnim(p) : 'dash', cls.dash.time + 0.12);
      sfx('dash');
    }
    rumble(0.1, 0.25, 50);
  }

  // hold attack to keep swinging; special is one press per use
  const reach = cls.ranged ? 10 : 3;
  if (cls.attack.windup && isHeld('attack') && p.atkCd <= 0 && !busy) {
    // the swordsmith: draw back, then cut. The blow lands after the windup, so timing matters.
    p.atkCd = cls.attack.cd * p.mods.atkCd;
    p.attackLock = cls.attack.windup + 0.28;
    assist(p, reach);
    p.swingIn = cls.attack.windup;
    p.model.anim.once('attack', cls.attack.cd);
  } else if (!cls.attack.windup && isHeld('attack') && p.atkCd <= 0 && !busy) {
    p.atkCd = cls.attack.cd * p.mods.atkCd;
    p.attackLock = 0.12;
    assist(p, reach);
    // three-hit chain, Hades-style: the third is a heavier finisher. Attacking out of a dash is a dash-strike.
    p.combo = performance.now() - (p.lastAttack ?? 0) < 700 ? (p.combo + 1) % 3 : 0;
    p.lastAttack = performance.now();
    const fin = p.combo === 2, dashStrike = p.sinceDash < 0.25;
    cls.attack.use(p, { fin, mult: (fin ? 1.6 : 1) * (dashStrike ? 1.5 : 1) });
    if (fin) { p.atkCd *= 1.4; p.attackLock = 0.22; }
    if (dashStrike) p.knock.addScaledVector(p.facing, 6); // lunge into the strike
    p.model.anim.once(fin && p.model.anim.has('attack2') ? 'attack2' : 'attack', Math.max(0.28, cls.attack.cd * p.mods.atkCd * (fin ? 1.5 : 1.1)));
    sfx('swing');
  }
  if (p.swingIn > 0 && (p.swingIn -= dt) <= 0) { cls.attack.use(p, { fin: false, mult: 1 }); sfx('swing'); }
  if (!cls.grounded && pressed('cast') && p.ammo > 0 && !busy) {
    assist(p, 11);
    cast(p);
    p.attackLock = 0.15;
    p.model.anim.once('throw', 0.35);
    sfx('special');
  }
  if (!cls.grounded && pressed('special') && p.spcCd <= 0 && !busy) {
    p.spcCd = cls.special.cd * p.mods.spcCd;
    assist(p, reach * 2);
    cls.special.use(p);
    p.model.anim.once('special', 0.5);
    sfx('special');
    rumble(0.3, 0.3, 90);
  }

  if (p.charge) {
    p.charge.t -= dt;
    p.vel.copy(p.facing).multiplyScalar(12);
    for (const t of opponents(0)) {
      if (p.charge.hit.has(t) || t.pos.distanceTo(p.pos) > t.radius + p.radius + 0.45) continue;
      p.charge.hit.add(t);
      damage(t, 15 * p.mods.spc, p.pos, { knockback: 10, stun: 0.9, source: p, tag: 'special' });
    }
    if (Math.floor(p.charge.t * 60) % 2) spawnGhost(p.model);
    if (p.charge.t <= 0) p.charge = null;
  } else if (p.dashT > 0) {
    p.dashT -= dt;
    p.vel.copy(p.dashDir).multiplyScalar(cls.dash.speed);
    if (p.dashT <= 0) hooks.onDash?.(p.pos.clone());
    if (!cls.dash.step) spawnGhost(p.model);
  } else {
    const sp = p.speed * p.mods.speed * (p.attackLock > 0 ? 0.35 : 1);
    p.vel.lerp(move.multiplyScalar(sp), 1 - Math.exp(-20 * dt));
  }

  moveEntity(p, dt);
  turnToward(p, p.facing, dt);
  animate(p, dt);
}

function animate(p, dt) {
  const m = p.model, speed = p.vel.length();
  if (p.dashT > 0 || p.charge) m.anim.loop('run', 2);
  else if (speed > 0.4) m.anim.loop('run', Math.max(0.6, speed / p.speed) * 1.15);
  else m.anim.loop('idle');
  m.anim.update(dt);
  m.root.visible = !(p.hurtT > 0 && Math.floor(p.hurtT * 20) % 2);
}

function animateDeath(p, dt) {
  if (p.deathT === 0) p.model.anim.once('death', 0.8, true);
  p.deathT += dt;
  p.model.root.visible = true;
  p.model.anim.update(dt);
}
