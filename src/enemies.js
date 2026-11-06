import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { makeGrunt, makeZombie, makeCrawler, makeBloater, makeBandit, makeCrossbowman, makeGuard, makeSoldier, makeCaptain, makeBlackKnight, makeHexer, makeBrute, makeStalker, makeSapper, makeWhirler, makeSlinger, makeShieldbearer, makeBonecaller, makeWarden, makePrior, makeReaver, makeDrowned, makeTidecaller, makeLurker, makeDrownedKing, disposeObject } from './models.js';
import { XP_FOR, xpToNext } from './run.js';
import { updateStatus } from './boons.js';
import { hooks, makeEntity, meleeArc, fireProjectile, aoe, telegraph, addTrail, moveEntity, tickEntity, turnToward, floatText, burst, damage, heal } from './combat.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';

const Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), dir = new THREE.Vector3();

export const TYPES = {
  zombie: { name: 'Zombie', about: 'Claws its way out of the earth at night in the Wilds and shambles toward you. The sun burns it at dawn.', model: makeZombie, hp: 40, speed: 1.9, radius: 0.33, ash: 1, rise: true, think: gruntAI },
  crawler: { name: 'Crawler', about: 'Half a body dragging itself fast through the grass. Shows a short red line, then leaps along it.', model: makeCrawler, hp: 22, speed: 3.8, radius: 0.3, ash: 1, rise: true, think: stalkerAI },
  bloater: { name: 'Bloater', about: 'Fat, slow and tough. Slams the ground around itself after a long windup, so hit it from range.', model: makeBloater, hp: 90, speed: 1.5, radius: 0.5, armor: 0.1, ash: 3, knockResist: 0.3, stunResist: 0.5, rise: true, think: bruteAI },
  // Adventure mode's people. ash is the coin they carry; iron is what an armoured man leaves for your forge.
  bandit: { name: 'Bandit', about: 'A road thief with a knife. Quick, but goes down in two or three cuts.', model: makeBandit, hp: 34, speed: 3.2, radius: 0.32, ash: 3, think: gruntAI },
  crossbowman: { name: 'Crossbowman', about: 'Keeps back and shoots down a red line. Close the distance or step out of the line.', model: makeCrossbowman, hp: 26, speed: 2.6, radius: 0.3, ash: 3, think: hexerAI },
  guard: { name: 'Castle Guard', about: 'Holds a tall shield to the front and turns slowly. Step round it and strike its back.', model: makeGuard, hp: 46, speed: 2.3, radius: 0.36, armor: 0.1, ash: 4, iron: 1, knockResist: 0.5, guard: true, think: shieldAI },
  soldier: { name: 'Soldier', about: "The usurper's man-at-arms. Wide, heavy chops; wait for the swing, then answer it.", model: makeSoldier, hp: 44, speed: 2.8, radius: 0.34, armor: 0.1, ash: 4, iron: 1, think: gruntAI },
  captain: { name: 'Captain', about: 'Leads the guard. A long windup, then a cut all the way round him. Step back and come in after.', model: makeCaptain, hp: 110, speed: 2.4, radius: 0.45, armor: 0.15, ash: 10, iron: 3, knockResist: 0.3, stunResist: 0.5, think: bruteAI },
  blackknight: { name: 'The Black Knight', title: "Champion of the Usurper", boss: true, about: 'Waits at the top of the tower. Wide sweeps, an overhead smash, and a running thrust.', model: makeBlackKnight, hp: 300, speed: 2.6, radius: 0.6, armor: 0.15, ash: 30, iron: 5, knockResist: 0.15, stunResist: 0.3, think: knightBossAI },
  grunt: { name: 'Grunt', about: 'Walks up and swings its sword in a wide arc. Slow to recover.', model: makeGrunt, hp: 34, speed: 3.0, radius: 0.33, ash: 2, think: gruntAI },
  hexer: { name: 'Hexer', about: 'Keeps its distance and fires aimed bolts down a red line. Close in fast.', model: makeHexer, hp: 24, speed: 2.6, radius: 0.3, ash: 3, think: hexerAI },
  stalker: { name: 'Stalker', about: 'Fast. Shows a short red line, then lunges along it. Step aside.', model: makeStalker, hp: 28, speed: 4.2, radius: 0.3, ash: 3, think: stalkerAI },
  brute: { name: 'Brute', about: 'Armored and heavy. Slams the ground around itself after a long windup.', model: makeBrute, hp: 90, speed: 2.0, radius: 0.55, armor: 0.2, ash: 6, knockResist: 0.3, stunResist: 0.5, think: bruteAI },
  sapper: { name: 'Sapper', about: 'Small, fast and carrying a bomb. It runs up and lights the fuse: get out of the circle, or stun it to put the fuse out.', model: makeSapper, hp: 18, speed: 4.6, radius: 0.28, ash: 2, think: sapperAI },
  whirler: { name: 'Whirler', about: 'Spins toward you with both blades out, then stands dizzy. Back off while it spins, and hit it while it reels.', model: makeWhirler, hp: 60, speed: 2.4, radius: 0.4, armor: 0.1, ash: 5, knockResist: 0.4, think: whirlerAI },
  slinger: { name: 'Slinger', about: 'Lobs bone bombs at where you stand. The red circle is where it lands, so keep moving.', model: makeSlinger, hp: 26, speed: 2.8, radius: 0.3, ash: 3, think: slingerAI },
  shieldbearer: { name: 'Shieldbearer', about: 'Blocks almost everything from the front and turns slowly. Dash past it and hit its back.', model: makeShieldbearer, hp: 50, speed: 2.2, radius: 0.4, armor: 0.1, ash: 4, knockResist: 0.5, guard: true, think: shieldAI },
  bonecaller: { name: 'Bonecaller', about: 'Hangs back and raises grunts from the floor. Kill it first.', model: makeBonecaller, hp: 30, speed: 2.4, radius: 0.3, ash: 5, think: callerAI },
  // the bosses: every tenth depth, one of these guards the Lock
  warden: { name: 'The Warden', title: 'Keeper of the Lock', boss: true, about: 'Slams, volleys and charges, and calls skeletons when hurt.', model: makeWarden, hp: 420, speed: 2.4, radius: 0.85, armor: 0.1, ash: 40, knockResist: 0.1, stunResist: 0.25, think: wardenAI },
  prior: { name: 'The Hollow Prior', title: 'Speaker for the Dead', boss: true, about: 'Fires rings of bolts, rains fire on where you stand, and blinks away when you close in. Calls hexers when hurt.', model: makePrior, hp: 360, speed: 2.2, radius: 0.8, armor: 0.05, ash: 40, knockResist: 0.1, stunResist: 0.25, think: priorAI },
  reaver: { name: 'The Reaver', title: 'Blade of the Deep', boss: true, about: 'Lunges three or four times in a row, then throws a fan of knives. Calls stalkers when hurt.', model: makeReaver, hp: 380, speed: 3.4, radius: 0.75, armor: 0.05, ash: 40, knockResist: 0.15, stunResist: 0.3, think: reaverAI },
  // the Sunken Vaults (depths 11-20, then every other ten): the drowned dead, and their king
  drowned: { name: 'Drowned', about: 'Waterlogged and slow, but tough. Its axe drags at you: get hit and you wade for a moment.', model: makeDrowned, hp: 52, speed: 2.4, radius: 0.36, armor: 0.1, ash: 3, knockResist: 0.6, think: drownedAI },
  tidecaller: { name: 'Tidecaller', about: 'Hangs back and throws a wave of three slow bolts. Walk between them, or close in.', model: makeTidecaller, hp: 30, speed: 2.4, radius: 0.3, ash: 4, think: tidecallerAI },
  lurker: { name: 'Lurker', about: 'Fast and low. Lunges twice in a row along red lines, so dodge the second one too.', model: makeLurker, hp: 32, speed: 4.4, radius: 0.3, ash: 4, think: lurkerAI },
  drownedking: { name: 'The Drowned King', title: 'Lord of the Sunken Vaults', boss: true, about: 'Sends walls of water down long lines, opens whirlpools that drag you in, and charges. Calls the drowned when hurt.', model: makeDrownedKing, hp: 460, speed: 2.3, radius: 0.85, armor: 0.1, ash: 45, knockResist: 0.1, stunResist: 0.25, think: kingAI },
  // the tutorial's training target: never moves, never attacks, never dies
  dummy: { name: 'Dummy', model: makeGrunt, hp: 99999, speed: 0, radius: 0.33, ash: 0, knockResist: 0, think: () => {} },
};

// What the codex shows about each enemy
export const BESTIARY = Object.entries(TYPES).filter(([k]) => k !== 'dummy').map(([id, t]) => ({ id, name: t.name, title: t.title, boss: !!t.boss, about: t.about, hp: t.hp }));

// Enemies always get a crimson warning circle before they appear, so nothing spawns on top of you unseen
export function spawnEnemy(type, x, z, depth, elite = false) {
  world.pendingSpawns++;
  telegraph({
    shape: 'circle', pos: new THREE.Vector3(x, 0, z), radius: TYPES[type].radius + 0.4, duration: 0.8,
    onDone: () => { world.pendingSpawns--; create(type, x, z, depth, elite); },
  });
}

function create(type, x, z, depth, elite = false) {
  const T = TYPES[type];
  const e = makeEntity(T.model(), { team: 1, hp: Math.round(T.hp * (1 + depth * 0.08 + Math.max(0, depth - 10) * 0.05) * (settings.hardcore ? 1.5 : 1)), radius: T.radius, speed: T.speed * (1 + Math.min(depth, 40) * 0.008), armor: T.armor ?? 0 });
  Object.assign(e, {
    type, T, depth, state: 'recover', timer: 0.4 + Math.random() * 0.6, phase: 0, swingT: 0, walkT: 0, deadT: 0,
    knockResist: T.knockResist ?? 1, stunResist: T.stunResist ?? 1, guard: !!T.guard,
  });
  e.pos.set(x, 0, z);
  e.onDeath = () => onDeath(e);
  // elites: bigger, tougher, armoured, and glowing faintly crimson so you spot them first
  if (elite) {
    e.elite = true;
    e.maxHp = e.hp = Math.round(e.hp * 1.8);
    e.armor = Math.min(0.5, e.armor + 0.15);
    e.model.root.scale.setScalar(1.2);
    for (const m of e.model.mats) m.color.lerp(new THREE.Color(C.CRIMSON), 0.25);
  }
  // skeletons claw their way up out of the floor before they act
  e.model.anim.once('spawn', 0.9);
  if (!e.model.anim.has('spawn') && T.rise) e.riseT = 0.9; // the dead claw their way up; people just arrive
  e.timer = Math.max(e.timer, 0.9);
  burst(e.pos, C.OAK, 10);
  world.enemies.push(e);
  return e;
}

function onDeath(e) {
  const run = world.run, p = world.player;
  run.kills++;
  run.ash += e.T.ash;
  if (world.adventure && e.T.iron) world.adventure.iron += e.T.iron;
  // XP: level-ups wait until the room is clear, so a menu never pops up mid-fight
  run.xp += XP_FOR[e.type] ?? 0;
  while (run.xp >= xpToNext(run.level)) {
    run.xp -= xpToNext(run.level);
    run.level++;
    run.pendingLevels++;
    floatText(p.pos, 'LEVEL UP', 'status');
  }
  floatText(e.pos, '+' + e.T.ash + ' ' + (run.currency ?? 'ash').toLowerCase(), 'ash');
  if (p.mods.lifesteal) heal(p, p.mods.lifesteal);
  e.model.anim.once('death', 0.9, true);
  hooks.onKill?.(e);
  // shards lodged in it fall out where it dies
  for (let k = 0; k < (e.shards ?? 0); k++) world.room.addPickup('shard', e.pos.x + (Math.random() - 0.5) * 0.6, e.pos.z + (Math.random() - 0.5) * 0.6);
  burst(e.pos, C.OAK, 14);
  sfx('kill');
}

export function bossOf(enemies) {
  return enemies.find((e) => e.T.boss && !e.dead) ?? null;
}

export function updateEnemies(dt) {
  const p = world.player;
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    if (e.dead) {
      // collapse into a pile of bones, then sink into the floor and free it
      e.deadT += dt;
      e.model.anim.update(dt);
      e.pos.y = -Math.max(0, e.deadT - 1.1) * 1.2;
      if (e.deadT > 1.8) { disposeObject(e.model.root); world.enemies.splice(i, 1); }
      continue;
    }
    if (e.riseT > 0) { e.riseT -= dt; e.pos.y = -Math.max(0, e.riseT) * 1.3; }
    updateStatus(e, dt);
    if (e.dead) continue; // a burn tick can finish it off
    tickEntity(e, dt);
    e.vel.set(0, 0, 0);
    if (e.stun > 0) e.state = 'recover';
    else if (p && !p.dead) e.T.think(e, p, dt);
    moveEntity(e, dt);
    animate(e, dt);
  }
  separate();
}

// ---- AI ----

// A free floor spot about d from a point, so anything summoned rises on the floor and never out in the void
function near(pos, d) {
  const room = world.room;
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2, at = pos.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d));
    if (room.onFloor(at) && !(room.near?.(at) ?? room.obstacles).some((o) => Math.abs(at.x - o.x) < o.hw + 0.4 && Math.abs(at.z - o.z) < o.hd + 0.4)) return at;
  }
  return room.freeSpot(pos, 0, 3);
}

// Points the enemy at the player and returns the distance
function face(e, p) {
  tmp.subVectors(p.pos, e.pos).setY(0);
  const d = tmp.length();
  if (d > 0.001) e.facing.copy(tmp).divideScalar(d);
  return d;
}

const perp = new THREE.Vector3();
// Walk along facing; if a pillar is just ahead, veer around it instead of grinding into it
function walk(e, sign = 1) {
  dir.copy(e.facing).multiplyScalar(sign);
  for (const o of world.room.near?.(e.pos) ?? world.room.obstacles) {
    tmp.set(o.x - e.pos.x, 0, o.z - e.pos.z);
    const ahead = tmp.dot(dir);
    if (ahead <= 0 || ahead > o.hw + e.radius + 1) continue;
    perp.set(dir.z, 0, -dir.x);
    const side = tmp.dot(perp);
    if (Math.abs(side) > o.hw + e.radius + 0.3) continue;
    dir.multiplyScalar(0.2).addScaledVector(perp, side > 0 ? -1 : 1).normalize();
    break;
  }
  e.vel.copy(dir).multiplyScalar(e.speed);
}

// Freeze, show the telegraph, then strike. Being stunned mid-windup cancels the strike.
// strike runs after the state reset, so it may switch to another state (the boss charge does).
function windup(e, opts, strike, recover) {
  e.state = 'windup';
  // stretch the attack clip so its strike frame (about 55% in) lands as the telegraph fills
  e.model.anim.once('attack', opts.duration / 0.55);
  telegraph({
    owner: e, pos: e.pos, dir: e.facing, ...opts,
    onDone: () => { e.state = 'recover'; e.timer = recover; e.swingT = 1; strike(); },
    onCancel: () => { e.state = 'recover'; e.timer = 0.3; },
  });
}

function ready(e, dt) {
  if (e.state === 'windup' || e.state === 'charging') return false;
  e.timer -= dt;
  return e.timer <= 0;
}

function gruntAI(e, p, dt) {
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d > 1.5) return walk(e);
  windup(e, { shape: 'arc', radius: 1.9, arc: 1.8, duration: 0.55 },
    () => meleeArc(e, { range: 1.9, arc: 1.8, damage: 10 + e.depth, knockback: 5 }), 0.7);
}

function hexerAI(e, p, dt) {
  if (e.state === 'windup') return;
  e.timer -= dt;
  const d = face(e, p);
  // keep a firing distance: back off when crowded, close in when too far
  if (d < 4.5) walk(e, -1);
  else if (d > 8) walk(e);
  else if (e.timer <= 0) {
    windup(e, { shape: 'line', length: 12, width: 0.35, duration: 0.75 },
      () => fireProjectile({ owner: e, dir: e.facing, speed: 10, damage: 9 + e.depth, range: 12, size: 0.18, color: C.CRIMSON }),
      1.3 + Math.random() * 0.8);
  }
}

function bruteAI(e, p, dt) {
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d > 2.0) return walk(e);
  windup(e, { shape: 'circle', radius: 2.6, duration: 1.0 }, () => {
    aoe(e, { pos: e.pos, radius: 2.6, damage: 18 + e.depth * 1.5, knockback: 9 });
    world.shake = 0.3;
    sfx('slam');
  }, 1.2);
}

// Boss: cycles slam, volley and charge. Below half health it attacks faster and calls grunts.
function wardenAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (e.state === 'windup') return;
  const enraged = e.hp < e.maxHp / 2, k = enraged ? 0.75 : 1;
  e.timer -= dt;
  const d = face(e, p);
  if (e.timer > 0) return walk(e, d > 3 ? 0.6 : 0);

  if (enraged && !e.called) {
    e.called = true;
    floatText(e.pos, 'RISE!', 'crit');
    for (let i = 0; i < 2; i++) { const at = near(e.pos, 2.2); spawnEnemy('grunt', at.x, at.z, e.depth); }
  }

  const pick = d < 3.2 ? 0 : e.phase++ % 3;
  if (pick === 0) {
    windup(e, { shape: 'circle', radius: 3.4, duration: 1.0 * k }, () => {
      aoe(e, { pos: e.pos, radius: 3.4, damage: 22, knockback: 11 });
      world.shake = 0.4;
      sfx('slam');
    }, 1.1 * k);
  } else if (pick === 1) {
    const spread = enraged ? [-0.6, -0.3, 0, 0.3, 0.6] : [-0.4, 0, 0.4];
    const dirs = spread.map((a) => e.facing.clone().applyAxisAngle(Y, a));
    dirs.forEach((dv, i) => telegraph({
      owner: e, shape: 'line', pos: e.pos, dir: dv, length: 13, width: 0.3, duration: 0.9 * k,
      onDone: i ? null : () => {
        dirs.forEach((v) => fireProjectile({ owner: e, dir: v, speed: 11, damage: 12, range: 13, size: 0.22, color: C.CRIMSON }));
        e.state = 'recover'; e.timer = 1.0 * k; e.swingT = 1;
      },
      onCancel: i ? null : () => { e.state = 'recover'; e.timer = 0.3; },
    }));
    e.state = 'windup';
    e.model.anim.once('cast', 0.9 * k / 0.6);
  } else {
    const line = e.facing.clone();
    windup(e, { shape: 'line', length: 9, width: 1.7, duration: 0.85 * k }, () => {
      Object.assign(e, { state: 'charging', chargeT: 9 / 15, chargeHit: false, chargeDir: line });
    }, 0);
  }
}

// Lunges along a telegraphed line: used by the stalker (short and quick) and the Warden (long and heavy)
function stalkerAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d > 4.5) return walk(e);
  const line = e.facing.clone();
  windup(e, { shape: 'line', length: 4.5, width: 0.6, duration: 0.5 }, () => {
    Object.assign(e, { state: 'charging', chargeT: 4.5 / 16, chargeHit: false, chargeDir: line, chargeSpeed: 16, chargeDmg: 9 + e.depth });
  }, 0.9 + Math.random() * 0.6);
}

function chargeStep(e, p, dt) {
  if (!e.trailing) { e.trailing = true; addTrail(() => (e.state === 'charging' && !e.dead ? e.pos.clone().setY(0.5) : (e.trailing = false, undefined)), C.CRIMSON, e.radius * 1.8); }
  e.chargeT -= dt;
  e.vel.copy(e.chargeDir).multiplyScalar(e.chargeSpeed ?? 15);
  if (!e.chargeHit && e.pos.distanceTo(p.pos) < e.radius + p.radius + 0.2) {
    e.chargeHit = true;
    damage(p, e.chargeDmg ?? 20, e.pos, { knockback: 12, source: e });
  }
  if (e.chargeT <= 0) { e.state = 'recover'; e.timer = Math.max(e.timer, e.chain > 0 ? 0.15 : 0.6); if (e.T.boss) world.shake = 0.2; }
}

// Runs at you, then blows itself up when the circle fills. A stun mid-fuse snuffs it out.
function sapperAI(e, p, dt) {
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d > 1.4) return walk(e);
  windup(e, { shape: 'circle', radius: 2.0, duration: 0.8 }, () => {
    aoe(e, { pos: e.pos, radius: 2.0, damage: 20 + e.depth, knockback: 10 });
    world.shake = 0.25;
    sfx('slam');
    e.hp = 0; e.dead = true; e.onDeath();
  }, 0.4);
}

// Winds up, then spins toward you for a while, cutting everything around it; afterwards it stands dizzy
function whirlerAI(e, p, dt) {
  if (e.state === 'spinning') {
    e.spinT -= dt; e.cutT -= dt;
    face(e, p);
    walk(e, 1.3);
    if (e.cutT <= 0) { e.cutT = 0.3; aoe(e, { pos: e.pos, radius: 1.5, damage: 6 + e.depth * 0.5, knockback: 4 }); }
    if (e.spinT <= 0) { e.state = 'recover'; e.timer = 1.6; floatText(e.pos, 'DIZZY', 'status'); }
    return;
  }
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d > 3.5) return walk(e);
  windup(e, { shape: 'circle', radius: 1.5, duration: 0.7 }, () => Object.assign(e, { state: 'spinning', spinT: 1.8, cutT: 0 }), 0);
}

// The Black Knight: nothing magic, just a big man with a big sword. A wide sweep, an overhead smash, and a running thrust.
function knightBossAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (e.state === 'windup') return;
  const enraged = e.hp < e.maxHp / 2, k = enraged ? 0.75 : 1;
  e.timer -= dt;
  const d = face(e, p);
  if (e.timer > 0) return walk(e, d > 2.2 ? 0.8 : 0);
  const move = d > 4.5 ? 2 : e.phase++ % 2;
  if (move === 0) {
    windup(e, { shape: 'arc', radius: 2.5, arc: 2.6, duration: 0.65 * k }, () => meleeArc(e, { range: 2.5, arc: 2.6, damage: 18 + e.depth, knockback: 9 }), 0.9 * k);
  } else if (move === 1) {
    windup(e, { shape: 'circle', radius: 1.9, duration: 0.95 * k }, () => {
      aoe(e, { pos: e.pos, radius: 1.9, damage: 24 + e.depth, knockback: 10 });
      world.shake = 0.3;
      sfx('slam');
    }, 1.1 * k);
  } else {
    const line = e.facing.clone();
    windup(e, { shape: 'line', length: 6, width: 1.1, duration: 0.7 * k }, () => {
      Object.assign(e, { state: 'charging', chargeT: 6 / 14, chargeHit: false, chargeDir: line, chargeSpeed: 14, chargeDmg: 20 + e.depth });
    }, 0.8 * k);
  }
}

// Throws at where you are now; the bomb lands when the circle fills. Stun the thrower and the throw is lost.
function slingerAI(e, p, dt) {
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d < 4) return walk(e, -1);
  if (d > 9) return walk(e);
  const at = p.pos.clone();
  e.state = 'windup';
  e.model.anim.once('attack', 1);
  telegraph({
    owner: e, shape: 'circle', pos: at, radius: 1.4, duration: 1.0,
    onDone: () => { aoe(e, { pos: at, radius: 1.4, damage: 12 + e.depth, knockback: 6 }); e.state = 'recover'; e.timer = 1.6 + Math.random(); sfx('slam'); },
    onCancel: () => { e.state = 'recover'; e.timer = 0.4; },
  });
}

// Turns slowly behind its shield (damage() blocks hits from the front), then bashes forward
function shieldAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (!ready(e, dt)) return;
  tmp.subVectors(p.pos, e.pos).setY(0);
  const d = tmp.length();
  if (d > 0.001) e.facing.lerp(tmp.divideScalar(d), Math.min(1, dt * 2.2)).normalize();
  if (d > 2.4 || e.facing.dot(tmp) < 0.8) return walk(e, d > 2.4 ? 0.8 : 0);
  const line = e.facing.clone();
  windup(e, { shape: 'line', length: 2.8, width: 0.9, duration: 0.6 }, () => {
    Object.assign(e, { state: 'charging', chargeT: 2.8 / 12, chargeHit: false, chargeDir: line, chargeSpeed: 12, chargeDmg: 12 + e.depth });
  }, 1.1);
}

// Keeps far back and raises up to three grunts, one at a time
function callerAI(e, p, dt) {
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d < 6) return walk(e, -1);
  if ((e.raised ?? 0) >= 3 || d > 11) return walk(e, d > 11 ? 1 : 0);
  windup(e, { shape: 'circle', radius: 0.9, duration: 0.9 }, () => {
    e.raised = (e.raised ?? 0) + 1;
    const at = near(e.pos, 1.6);
    spawnEnemy('grunt', at.x, at.z, e.depth);
  }, 3.5);
}

// Boss: rings of slow bolts, fire raining where you stand, and a blink away when crowded. Calls hexers when hurt.
function priorAI(e, p, dt) {
  if (e.state === 'windup') return;
  const enraged = e.hp < e.maxHp / 2, k = enraged ? 0.75 : 1;
  e.timer -= dt;
  const d = face(e, p);
  if (e.timer > 0) return walk(e, d < 5 ? -0.8 : d > 9 ? 0.8 : 0);
  if (enraged && !e.called) {
    e.called = true;
    floatText(e.pos, 'RISE!', 'crit');
    for (let i = 0; i < 2; i++) { const at = near(e.pos, 2.2); spawnEnemy('hexer', at.x, at.z, e.depth); }
  }
  const move = d < 3 ? 2 : e.phase++ % 3;
  if (move === 0) {
    windup(e, { shape: 'circle', radius: 1.5, duration: 0.8 * k }, () => {
      const n = enraged ? 14 : 10, off = Math.random();
      for (let i = 0; i < n; i++) fireProjectile({ owner: e, dir: new THREE.Vector3(1, 0, 0).applyAxisAngle(Y, off + (i / n) * Math.PI * 2), speed: 6, damage: 11, range: 14, size: 0.22, color: C.CRIMSON });
    }, 1.2 * k);
  } else if (move === 1) {
    e.model.anim.once('cast', 1);
    for (let i = 0, n = enraged ? 5 : 3; i < n; i++) {
      const at = p.pos.clone().add(i ? new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5) : new THREE.Vector3());
      telegraph({ owner: e, shape: 'circle', pos: at, radius: 1.3, duration: 1.1 * k + i * 0.15, onDone: () => aoe(e, { pos: at, radius: 1.3, damage: 15, knockback: 5 }) });
    }
    e.timer = 1.8 * k; // it keeps moving while the fire falls
  } else {
    const to = world.room.freeSpot(p.pos, 6, 9);
    e.state = 'windup';
    telegraph({
      owner: e, shape: 'circle', pos: to, radius: e.radius + 0.3, duration: 0.6,
      onDone: () => { burst(e.pos, C.CRIMSON, 12); e.pos.copy(to); burst(e.pos, C.CRIMSON, 12); e.state = 'recover'; e.timer = 0.5; },
      onCancel: () => { e.state = 'recover'; e.timer = 0.3; },
    });
  }
}

// Boss: chains three or four short lunges, each re-aimed, then throws a fan of knives. Calls stalkers when hurt.
function reaverAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (e.state === 'windup') return;
  const enraged = e.hp < e.maxHp / 2, k = enraged ? 0.75 : 1;
  e.timer -= dt;
  face(e, p);
  if (e.timer > 0) return e.chain > 0 ? undefined : walk(e, 0.5);
  if (e.chain > 0) return lunge(e, k);
  if (enraged && !e.called) {
    e.called = true;
    floatText(e.pos, 'RISE!', 'crit');
    for (let i = 0; i < 2; i++) { const at = near(e.pos, 2.2); spawnEnemy('stalker', at.x, at.z, e.depth); }
  }
  if (e.phase++ % 2 === 0) { e.chain = enraged ? 4 : 3; return lunge(e, k); }
  const spread = enraged ? [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6] : [-0.4, -0.2, 0, 0.2, 0.4];
  windup(e, { shape: 'arc', radius: 6, arc: 1.4, duration: 0.7 * k }, () => {
    for (const a of spread) fireProjectile({ owner: e, dir: e.facing.clone().applyAxisAngle(Y, a), speed: 13, damage: 10, range: 12, size: 0.16, color: C.CRIMSON });
  }, 1.4 * k);
}
function lunge(e, k) {
  e.chain--;
  const line = e.facing.clone();
  windup(e, { shape: 'line', length: 6, width: 1.0, duration: 0.5 * k }, () => {
    Object.assign(e, { state: 'charging', chargeT: 6 / 18, chargeHit: false, chargeDir: line, chargeSpeed: 18, chargeDmg: 16 });
  }, e.chain > 0 ? 0 : 1.3 * k);
}

// A grunt that hits harder and slows you when it connects
function drownedAI(e, p, dt) {
  if (!ready(e, dt)) return;
  const d = face(e, p);
  if (d > 1.6) return walk(e);
  windup(e, { shape: 'arc', radius: 2.0, arc: 2.0, duration: 0.7 }, () => {
    if (meleeArc(e, { range: 2.0, arc: 2.0, damage: 12 + e.depth, knockback: 3 }).length) p.slow = Math.max(p.slow, 1.5);
  }, 0.9);
}

// Keeps its distance and throws three slow bolts in a fan
function tidecallerAI(e, p, dt) {
  if (e.state === 'windup') return;
  e.timer -= dt;
  const d = face(e, p);
  if (d < 5) return walk(e, -1);
  if (d > 9) return walk(e);
  if (e.timer > 0) return;
  const dirs = [-0.35, 0, 0.35].map((a) => e.facing.clone().applyAxisAngle(Y, a));
  dirs.forEach((v, i) => telegraph({
    owner: e, shape: 'line', pos: e.pos, dir: v, length: 11, width: 0.3, duration: 0.8,
    onDone: i ? null : () => {
      dirs.forEach((u) => fireProjectile({ owner: e, dir: u, speed: 7, damage: 9 + e.depth, range: 11, size: 0.24, color: C.CRIMSON }));
      e.state = 'recover'; e.timer = 1.8 + Math.random(); e.swingT = 1;
    },
    onCancel: i ? null : () => { e.state = 'recover'; e.timer = 0.4; },
  }));
  e.state = 'windup';
  e.model.anim.once('attack', 0.8 / 0.55);
}

// Two quick lunges in a row; the second aims wherever you went
function lurkerAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (e.state === 'windup') return;
  e.timer -= dt;
  const d = face(e, p);
  if (e.timer > 0) return e.chain > 0 || d <= 4.5 ? undefined : walk(e);
  if (e.chain > 0) return dart(e);
  if (d > 4.5) return walk(e);
  e.chain = 2;
  dart(e);
}
function dart(e) {
  e.chain--;
  const line = e.facing.clone();
  windup(e, { shape: 'line', length: 4.5, width: 0.6, duration: 0.45 }, () => {
    Object.assign(e, { state: 'charging', chargeT: 4.5 / 16, chargeHit: false, chargeDir: line, chargeSpeed: 16, chargeDmg: 9 + e.depth });
  }, e.chain > 0 ? 0 : 1.1 + Math.random() * 0.5);
}

// Boss of the Sunken Vaults: walls of water down long lines, whirlpools where you stand, and a charge. Calls the drowned when hurt.
function kingAI(e, p, dt) {
  if (e.state === 'charging') return chargeStep(e, p, dt);
  if (e.state === 'windup') return;
  const enraged = e.hp < e.maxHp / 2, k = enraged ? 0.75 : 1;
  e.timer -= dt;
  const d = face(e, p);
  if (e.timer > 0) return walk(e, d > 3 ? 0.6 : 0);
  if (enraged && !e.called) {
    e.called = true;
    floatText(e.pos, 'RISE!', 'crit');
    for (let i = 0; i < 3; i++) { const at = near(e.pos, 2.4); spawnEnemy('drowned', at.x, at.z, e.depth); }
  }
  const move = e.phase++ % 3;
  if (move === 0) {
    // a wall of water down a long line; two crossing walls once he is hurt
    const dirs = (enraged ? [-0.5, 0.5] : [0]).map((a) => e.facing.clone().applyAxisAngle(Y, a));
    dirs.forEach((v, i) => telegraph({
      owner: e, shape: 'line', pos: e.pos, dir: v, length: 14, width: 1.8, duration: 0.9 * k,
      onDone: i ? null : () => {
        dirs.forEach((u) => fireProjectile({ owner: e, dir: u, speed: 9, damage: 20, range: 14, size: 0.85, pierce: true, knockback: 8, color: C.CRIMSON }));
        e.state = 'recover'; e.timer = 1.0 * k; e.swingT = 1;
      },
      onCancel: i ? null : () => { e.state = 'recover'; e.timer = 0.3; },
    }));
    e.state = 'windup';
    e.model.anim.once('attack', 0.9 * k / 0.55);
  } else if (move === 1) {
    // a whirlpool where you stand: it drags you to the middle as it bursts, and leaves you wading
    const at = p.pos.clone();
    e.state = 'windup';
    e.model.anim.once('cast', 1.1 * k / 0.6);
    telegraph({
      owner: e, shape: 'circle', pos: at, radius: 2.8, duration: 1.1 * k,
      onDone: () => { aoe(e, { pos: at, radius: 2.8, damage: 18, knockback: -7, slow: 1.5 }); world.shake = 0.3; sfx('slam'); e.state = 'recover'; e.timer = 1.0 * k; },
      onCancel: () => { e.state = 'recover'; e.timer = 0.3; },
    });
  } else {
    const line = e.facing.clone();
    windup(e, { shape: 'line', length: 9, width: 1.6, duration: 0.8 * k }, () => {
      Object.assign(e, { state: 'charging', chargeT: 9 / 15, chargeHit: false, chargeDir: line, chargeSpeed: 15, chargeDmg: 22 });
    }, 0.2);
  }
}

// ---- body language ----

function animate(e, dt) {
  const m = e.model, sp = e.vel.length();
  if (e.state === 'charging') m.anim.loop('run', 2.5);
  else if (e.state === 'spinning') m.anim.loop('spin', 1.4);
  else if (sp > 0.3) m.anim.loop('run', Math.max(0.5, sp / e.speed));
  else m.anim.loop('idle');
  m.anim.update(e.stun > 0 ? dt * 0.2 : dt);                      // stunned enemies move in slow motion
  m.body.rotation.z = e.stun > 0 ? Math.sin(world.time * 40) * 0.06 : 0; // and shiver
  turnToward(e, e.facing, dt, e.state === 'windup' ? 0 : 12);
}

// Keep bodies from overlapping. Dashing players slip through, like in Hades.
function separate() {
  const p = world.player;
  const all = world.enemies.filter((e) => !e.dead);
  if (p && !p.dead && p.dashT <= 0 && !p.charge) all.push(p);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      dir.subVectors(b.pos, a.pos).setY(0);
      const d = dir.length(), min = a.radius + b.radius;
      if (d >= min || d < 1e-4) continue;
      dir.multiplyScalar((min - d) / d / 2);
      a.pos.sub(dir);
      b.pos.add(dir);
    }
  }
}
