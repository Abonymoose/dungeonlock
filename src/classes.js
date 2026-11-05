import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { input, pressed, isHeld, rumble } from './input.js';
import { GROUND_RIGHT, GROUND_UP, basic, flashLight, screenToGround } from './render.js';
import { makeKnight, makeRogue, makeWizard, makeSmith } from './models.js';
import { hooks, makeEntity, meleeArc, fireProjectile, aoe, spawnGhost, addTrail, moveEntity, tickEntity, turnToward, opponents, damage } from './combat.js';
import { sfx } from './audio.js';

const Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), aimDir = new THREE.Vector3(), move = new THREE.Vector3();

// true when the attacker stands behind the target (target faces away)
const behind = (p) => (t) => tmp.subVectors(p.pos, t.pos).setY(0).normalize().dot(t.facing) < -0.2;

// Every class can reach every room; they differ only in how they handle danger.
export const CLASSES = {
  knight: {
    name: 'Knight', blurb: 'Slow and armored. Wide sword arcs, and a shield charge that stuns.',
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
    name: 'Rogue', blurb: 'Fast and fragile. Quick stabs that crit from behind, and two dashes.',
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
    name: 'Wizard', blurb: 'Fights from range. Arcane bolts, a freezing nova, and a blink.',
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
    passive: 'Blink teleports through danger',
  },
};

// Adventure mode's hero, kept apart from the three classes so he never shows on class select.
// Grounded: one honest swing with a windup, and a short step back. No Cast, no Special, no long dash.
export const SMITH = {
  name: 'Swordsmith', blurb: 'A village smith with a sword he made himself.', hp: 60, speed: 4.2, armor: 0, model: makeSmith, swingAxis: 'y', grounded: true,
  attack: {
    name: 'Swing', cd: 0.62, windup: 0.18, desc: 'One heavy swing',
    use: (p) => meleeArc(p, { range: 1.55 + (p.reach ?? 0), arc: 1.8, damage: 24 * p.mods.atk, knockback: 6, tag: 'attack' }),
  },
  special: null,
  dash: { name: 'Step back', speed: 8.5, time: 0.14, cd: 0.7, charges: 1, back: true, invuln: 0.06 },
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

export function createPlayer(id, meta) {
  const cls = id === 'smith' ? SMITH : CLASSES[id];
  if (cls.grounded) meta = { vitality: 0, whetstone: 0, shards: -2, quickstep: 0 }; // the Anvil's upgrades are for the dungeon; his come from his own forge
  const model = cls.model();
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
    } else if (move.lengthSq() > 0.0001) p.facing.copy(move).normalize();
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
    if (!cls.dash.blink && !cls.dash.back) addTrail(() => (p.dashT > 0 ? p.pos.clone().setY(0.45) : undefined), C.SAND, 0.7);
    // a step back goes away from where you face and keeps you facing the fight
    if (cls.dash.back) p.dashDir.copy(p.facing).negate();
    else { p.dashDir.copy(move.lengthSq() > 0.01 ? move : p.facing).normalize(); p.facing.copy(p.dashDir); }
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
      p.model.anim.once('dash', cls.dash.time + 0.12);
      sfx('dash');
    }
    rumble(0.1, 0.25, 50);
  }

  // hold attack to keep swinging; special is one press per use
  const reach = p.id === 'wizard' ? 10 : 3;
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
    if (!cls.dash.back) spawnGhost(p.model);
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
