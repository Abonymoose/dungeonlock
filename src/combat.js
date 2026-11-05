import * as THREE from 'three';
import { C } from './config.js';
import { world } from './world.js';
import { scene, basic, toScreen, flashLight } from './render.js';
import { rumble } from './input.js';
import { sfx } from './audio.js';
import { freezePose } from './assets.js';
import { settings } from './settings.js';

const projectiles = [], telegraphs = [], effects = [], texts = [], trails = [];
const fxLayer = document.getElementById('fx');
const tmp = new THREE.Vector3(), guardV = new THREE.Vector3();

// Filled in by boons.js, so combat never imports the boon system: dmgMult, onHit, onCast, onDash, playerHurt, onKill
export const hooks = {};

// ---- entities ----

export function makeEntity(model, { team, hp, radius = 0.35, speed = 3, armor = 0 }) {
  scene.add(model.root);
  return {
    model, pos: model.root.position, team, hp, maxHp: hp, radius, speed, armor,
    vel: new THREE.Vector3(), knock: new THREE.Vector3(), facing: new THREE.Vector3(0, 0, 1),
    stun: 0, slow: 0, invuln: 0, hurtT: 0, flash: 0, dead: false,
  };
}

export const opponents = (team) => team === 0
  ? world.enemies.filter((e) => !e.dead)
  : (world.player && !world.player.dead ? [world.player] : []);

export function tickEntity(e, dt) {
  e.stun = Math.max(0, e.stun - dt);
  e.slow = Math.max(0, e.slow - dt);
  e.invuln = Math.max(0, e.invuln - dt);
  e.hurtT = Math.max(0, e.hurtT - dt);
  e.flash = Math.max(0, e.flash - dt);
  // white on hit, then the colour of whatever status it carries, then a faint glow while stunned
  for (const m of e.model.mats) {
    if (e.flash > 0) m.emissive.setScalar(0.9);
    else if (e.statusTint) m.emissive.setHex(e.statusTint).multiplyScalar(0.35);
    else m.emissive.setScalar(e.stun > 0 ? 0.25 : 0);
  }
}

export function moveEntity(e, dt) {
  e.pos.addScaledVector(e.vel, dt * (e.slow > 0 ? 0.5 : 1) * (e.speedMul ?? 1)).addScaledVector(e.knock, dt);
  e.knock.multiplyScalar(Math.exp(-10 * dt));
  world.room?.collide(e.pos, e.radius);
}

// turn the model toward a direction the short way round
export function turnToward(e, dir, dt, rate = 25) {
  let d = Math.atan2(dir.x, dir.z) - e.model.root.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  e.model.root.rotation.y += d * (1 - Math.exp(-rate * dt));
}

export function heal(e, amount) {
  const h = Math.min(Math.round(amount), e.maxHp - e.hp);
  if (h <= 0) return;
  e.hp += h;
  floatText(e.pos, '+' + h, 'heal');
}

// tag says which move dealt it (attack, special, cast, dash, status...) so boons can react; quiet skips the juice (burn ticks)
export function damage(target, amount, from, { knockback = 0, stun = 0, crit = false, heavy = false, source = null, tag = null, quiet = false, color = null } = {}) {
  if (target.dead || target.invuln > 0) return false;
  const byPlayer = target.team === 1 && (source?.team === 0 || tag === 'status');
  if (byPlayer && hooks.dmgMult) amount *= hooks.dmgMult(target, tag);
  if (target.team === 0 && hooks.playerHurt) amount = hooks.playerHurt(source, amount);
  // a shieldbearer takes a fifth of any hit that comes from in front of it
  if (target.guard && from && guardV.subVectors(from, target.pos).setY(0).dot(target.facing) > 0.3 * guardV.length()) { amount *= 0.2; floatText(target.pos, 'BLOCK', 'status'); }
  amount = Math.max(1, Math.round(amount * (1 - target.armor)));
  target.hp -= amount;
  target.onHurt?.(tag); // the tutorial counts hits through this
  if (quiet) {
    if (settings.numbers && target.type !== 'dummy') floatText(target.pos, String(amount), color ?? 'hit');
    if (target.hp <= 0) { target.hp = 0; target.dead = true; target.onDeath?.(); }
    return true;
  }
  target.flash = 0.1;
  // flinch, unless mid-windup: a telegraphed attack still lands where it said it would
  if (target.state !== 'windup' && target.state !== 'charging' && target.hp > 0) target.model.anim?.once('hit', 0.3);
  if (from && knockback) {
    tmp.subVectors(target.pos, from).setY(0);
    if (tmp.lengthSq() > 1e-6) target.knock.addScaledVector(tmp.normalize(), knockback * (target.knockResist ?? 1));
  }
  if (stun) target.stun = Math.max(target.stun, stun * (target.stunResist ?? 1));
  if (settings.numbers && target.type !== 'dummy') floatText(target.pos, crit ? amount + '!' : String(amount), target.team === 0 ? 'hurt' : crit ? 'crit' : 'hit');
  burst(target.pos, target.team === 0 ? C.CRIMSON : C.OAK, crit ? 10 : 6);
  if (target.team === 0) {
    target.invuln = 0.7; target.hurtT = 0.7;
    world.shake = 0.25; world.hitstop = 0.07;
    rumble(0.8, 0.5, 160); sfx('hurt');
    if (source && !source.dead && target.mods?.thorns) damage(source, target.mods.thorns, target.pos);
  } else {
    world.hitstop = Math.max(world.hitstop, crit || heavy ? 0.07 : 0.03);
    world.shake = Math.max(world.shake, crit || heavy ? 0.16 : 0.07);
    rumble(0.15, 0.35, 50); sfx('hit');
  }
  if (byPlayer && tag) hooks.onHit?.(target, tag);
  // Last Breath (Hades' Death Defiance): a killing blow leaves you standing at 40%
  if (target.hp <= 0 && target.lives > 0) {
    target.lives--;
    target.hp = Math.round(target.maxHp * 0.4);
    target.invuln = target.hurtT = 2;
    world.hitstop = 0.3;
    floatText(target.pos, 'LAST BREATH', 'status');
    flashLight(target.pos, 0xffe0b0, 30, 0.8);
  }
  if (target.hp <= 0) { target.hp = 0; target.dead = true; target.onDeath?.(); }
  return true;
}

// ---- attacks ----

// Hits every opponent inside a wedge in front of the owner
export function meleeArc(owner, { range, arc, damage: dmg, knockback = 4, stun = 0, critIf = null, color, tag = null, heavy = false }) {
  const hits = [];
  for (const t of opponents(owner.team)) {
    tmp.subVectors(t.pos, owner.pos).setY(0);
    const dist = tmp.length();
    if (dist > range + t.radius) continue;
    const touching = dist < owner.radius + t.radius;
    if (!touching && tmp.dot(owner.facing) / dist < Math.cos(arc / 2)) continue;
    const crit = !!critIf?.(t);
    if (damage(t, dmg * (crit ? 2 : 1), owner.pos, { knockback, stun, crit, heavy, source: owner, tag })) hits.push(t);
  }
  slash(owner.pos, owner.facing, range, arc, color ?? (owner.team === 0 ? C.SAND : C.CRIMSON));
  return hits;
}

export function fireProjectile({ owner, dir, pos = owner.pos, speed = 12, damage: dmg, range = 10, size = 0.14, color, knockback = 2, stun = 0, pierce = false, onHit = null, onExpire = null, tag = null }) {
  const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(size), basic(color));
  mesh.position.set(pos.x, 0.55, pos.z);
  scene.add(mesh);
  const shot = { owner, team: owner.team, mesh, dir: dir.clone().setY(0).normalize(), speed, dmg, life: range / speed, radius: size + 0.05, knockback, stun, pierce, hit: new Set(), onHit, onExpire, tag };
  projectiles.push(shot);
  addTrail(() => (shot.gone ? undefined : mesh.position), color, size * 1.8);
  sfx('shoot');
}

export function aoe(owner, { pos, radius, damage: dmg, knockback = 6, stun = 0, slow = 0, color, tag = null, onEach = null, dmgFn = null }) {
  const center = pos.clone();
  for (const t of opponents(owner.team)) {
    if (t.pos.distanceTo(center) > radius + t.radius) continue;
    if (!damage(t, dmg * (dmgFn?.(t) ?? 1), center, { knockback, stun, source: owner, tag })) continue;
    if (slow) t.slow = Math.max(t.slow, slow);
    onEach?.(t);
  }
  ring(center, radius, color ?? (owner.team === 0 ? C.SAND : C.CRIMSON));
  flashLight(center, owner.team === 0 ? (color ?? 0xffe0b0) : 0xff3020, 16, 0.3);
}

// Crimson ground warning that fills up, then fires. Cancelled if its owner dies or is stunned: that's the opening.
export function telegraph({ owner = null, shape, pos, dir = null, radius = 1, arc = Math.PI, length = 6, width = 0.5, duration, onDone, onCancel }) {
  const group = new THREE.Group();
  group.position.set(pos.x, 0.03, pos.z);
  const geo = shape === 'line'
    ? new THREE.PlaneGeometry(length, width).translate(length / 2, 0, 0)
    : new THREE.CircleGeometry(radius, 24, shape === 'arc' ? -arc / 2 : 0, shape === 'arc' ? arc : Math.PI * 2);
  const outline = new THREE.Mesh(geo, basic(C.CRIMSON, { transparent: true, opacity: 0.22, depthWrite: false }));
  const fill = new THREE.Mesh(geo, basic(C.CRIMSON, { transparent: true, opacity: 0.5, depthWrite: false }));
  outline.rotation.x = fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.01;
  group.add(outline, fill);
  if (dir) group.rotation.y = Math.atan2(-dir.z, dir.x);
  scene.add(group);
  const t = { owner, group, fill, shape, duration, t: 0, onDone, onCancel, geo };
  telegraphs.push(t);
  return t;
}

// ---- effects ----

function addEffect(obj, life, update) {
  scene.add(obj);
  effects.push({ obj, life, max: life, update });
}

function fadingMesh(geo, color, opacity) {
  return new THREE.Mesh(geo, basic(color, { transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
}

function slash(pos, dir, range, arc, color) {
  const pivot = new THREE.Group();
  const mesh = fadingMesh(new THREE.RingGeometry(range * 0.45, range, 16, 1, -arc / 2, arc), color, 0.7);
  mesh.rotation.x = -Math.PI / 2;
  pivot.add(mesh);
  pivot.position.set(pos.x, 0.5, pos.z);
  pivot.rotation.y = Math.atan2(-dir.z, dir.x);
  addEffect(pivot, 0.14, (k) => { mesh.material.opacity = 0.7 * k; });
}

function ring(pos, radius, color) {
  const mesh = fadingMesh(new THREE.RingGeometry(radius * 0.85, radius, 32), color, 0.8);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.08, pos.z);
  addEffect(mesh, 0.3, (k) => { mesh.material.opacity = 0.8 * k; mesh.scale.setScalar(1.15 - 0.15 * k); });
}

const PGEO = new THREE.BoxGeometry(0.09, 0.09, 0.09), pmats = {};
export function burst(pos, color, n = 6) {
  pmats[color] ??= basic(color);
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(PGEO, pmats[color]);
    p.position.set(pos.x, 0.5, pos.z);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).multiplyScalar(6);
    addEffect(p, 0.4, (k, dt) => {
      v.y -= 18 * dt;
      p.position.addScaledVector(v, dt);
      if (p.position.y < 0.05) { p.position.y = 0.05; v.multiplyScalar(0.5); }
      p.scale.setScalar(k);
    });
  }
}

// Fading frozen copy of a character, for dash trails. Shares geometry, so only its own material is freed.
export function spawnGhost(model, color = C.SAND) {
  const g = freezePose(model);
  const mat = basic(color, { transparent: true, opacity: 0.35, depthWrite: false });
  g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
  g.userData.ghostMat = mat;
  addEffect(g, 0.25, (k) => { mat.opacity = 0.35 * k; });
}

export function floatText(pos, text, cls = 'hit') {
  const el = document.createElement('div');
  el.className = 'ftext ' + cls;
  el.textContent = text;
  fxLayer.append(el);
  texts.push({ el, pos: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.3, 0, pos.z), life: 0.8 });
}

// ---- per-frame ----

function removeEffect(e) {
  e.obj.removeFromParent();
  if (e.obj.userData.ghostMat) return e.obj.userData.ghostMat.dispose();
  if (e.obj.isMesh && e.obj.geometry !== PGEO) { e.obj.geometry.dispose(); e.obj.material.dispose(); }
  e.obj.traverse((o) => { if (o !== e.obj && o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}

function removeTelegraph(t) {
  t.group.removeFromParent();
  t.geo.dispose();
  t.group.children.forEach((m) => m.material.dispose());
}

function removeProjectile(p) {
  p.gone = true;
  p.mesh.removeFromParent();
  p.mesh.geometry.dispose();
  p.mesh.material.dispose();
}

export function updateCombat(dt) {
  updateTrails();
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.dir, p.speed * dt);
    p.mesh.rotation.y += dt * 12;
    let gone = p.life <= 0 || world.room?.blocked(p.mesh.position);
    for (const t of opponents(p.team)) {
      if (gone || p.hit.has(t)) continue;
      tmp.subVectors(t.pos, p.mesh.position).setY(0);
      if (tmp.length() > t.radius + p.radius) continue;
      p.hit.add(t);
      damage(t, p.dmg, p.mesh.position, { knockback: p.knockback, stun: p.stun, source: p.owner, tag: p.tag });
      p.onHit?.(t);
      if (!p.pierce) gone = true;
    }
    if (gone && !p.hit.size && p.onExpire) {
      // land just inside the room, so whatever it drops can be picked up
      const q = p.mesh.position.clone().addScaledVector(p.dir, -0.3).setY(0);
      // shots fly over the void: walk back along the path to the last floor tile
      for (let i = 0; i < 60 && world.room && !world.room.onFloor(q); i++) q.addScaledVector(p.dir, -0.3);
      world.room?.collide(q, 0.3);
      p.onExpire(q);
    }
    if (gone) { burst(p.mesh.position, p.mesh.material.color.getHex(), 3); removeProjectile(p); projectiles.splice(i, 1); }
  }

  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const t = telegraphs[i];
    if (t.owner && (t.owner.dead || t.owner.stun > 0)) {
      removeTelegraph(t); telegraphs.splice(i, 1); t.onCancel?.();
      continue;
    }
    t.t += dt;
    const k = Math.min(1, t.t / t.duration);
    if (t.shape === 'line') t.fill.scale.x = Math.max(0.001, k);
    else t.fill.scale.setScalar(Math.max(0.001, k));
    if (t.t >= t.duration) { removeTelegraph(t); telegraphs.splice(i, 1); t.onDone?.(); }
  }

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    e.update?.(Math.max(0, e.life / e.max), dt);
    if (e.life <= 0) { removeEffect(e); effects.splice(i, 1); }
  }

  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= dt;
    t.pos.y += dt * 1.4;
    const s = toScreen(t.pos, 1.1);
    t.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    t.el.style.opacity = Math.min(1, t.life * 3);
    if (t.life <= 0) { t.el.remove(); texts.splice(i, 1); }
  }
}

// ---- trails: a fading ribbon behind anything fast (shots, dashes, lunges) ----

const TRAIL = 12, perpV = new THREE.Vector3();
// follow() gives the point to trail from; null while idle (the ribbon shrinks away), undefined once it's done for good
export function addTrail(follow, color, width = 0.3) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(TRAIL * 6), col = new Float32Array(TRAIL * 6), idx = [];
  for (let i = 0; i < TRAIL - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const c = new THREE.Color(color);
  for (let i = 0; i < TRAIL; i++) { const k = (1 - i / (TRAIL - 1)) ** 1.6; col.set([c.r * k, c.g * k, c.b * k, c.r * k, c.g * k, c.b * k], i * 6); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  // additive, so it brightens what's under it and fades to nothing at the tail
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  trails.push({ follow, mesh, pts: [], width });
}

function updateTrails() {
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i], at = t.follow();
    if (at) t.pts.unshift(at.clone());
    if (!at || t.pts.length > TRAIL) t.pts.pop();
    if (at === undefined && !t.pts.length) {
      t.mesh.removeFromParent(); t.mesh.geometry.dispose(); t.mesh.material.dispose();
      trails.splice(i, 1);
      continue;
    }
    const n = t.pts.length, pos = t.mesh.geometry.attributes.position.array;
    t.mesh.visible = n > 1;
    if (n < 2) continue;
    for (let j = 0; j < TRAIL; j++) {
      const p = t.pts[Math.min(j, n - 1)], a = t.pts[Math.max(0, Math.min(j, n - 1) - 1)], b = t.pts[Math.min(j + 1, n - 1)];
      // flat on the ground plane, across the direction of travel, tapering to a point
      perpV.set(-(a.z - b.z), 0, a.x - b.x);
      if (perpV.lengthSq() < 1e-8) perpV.set(1, 0, 0);
      perpV.normalize().multiplyScalar((t.width / 2) * (1 - j / TRAIL));
      pos.set([p.x + perpV.x, p.y, p.z + perpV.z, p.x - perpV.x, p.y, p.z - perpV.z], j * 6);
    }
    t.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// Wipes everything in flight, e.g. when changing rooms
export function clearCombat() {
  trails.splice(0).forEach((t) => { t.mesh.removeFromParent(); t.mesh.geometry.dispose(); t.mesh.material.dispose(); });
  projectiles.splice(0).forEach(removeProjectile);
  telegraphs.splice(0).forEach(removeTelegraph);
  effects.splice(0).forEach(removeEffect);
  texts.splice(0).forEach((t) => t.el.remove());
}
