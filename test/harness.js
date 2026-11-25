// Test harness: drives the real game with a fake controller at a fixed 60 steps per second.
// In the browser console on http://localhost:5173:  const T = await import('/test/harness.js'); await T.smoke();
import { frame } from '../src/main.js';
import { world as W } from '../src/world.js';
import { createPlayer } from '../src/classes.js';
import { meta, makePlan } from '../src/run.js';
import { torchLights, GROUND_RIGHT } from '../src/render.js';
import { audio } from '../src/audio.js';
import { settings, resetControls } from '../src/settings.js';
import * as THREE from 'three';
import { input, label } from '../src/input.js';
import { spawnEnemy, TYPES } from '../src/enemies.js';
import { damage } from '../src/combat.js';

audio.muted = true; // tests never make noise

export const pad = { connected: true, id: 'test pad', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
navigator.getGamepads = () => [pad];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const step = (sec) => { for (let i = 0; i < sec * 60; i++) frame(1 / 60); };
export const press = (b) => { pad.buttons[b].pressed = true; frame(1 / 60); pad.buttons[b].pressed = false; frame(1 / 60); };

// room transitions wait on real-time fades (throttled to ~1s in background tabs)
export async function waitFor(state, ms = 6000) {
  for (let t = 0; t < ms && W.state !== state; t += 100) await sleep(100);
  step(0.05);
  return W.state === state;
}

// clicks a menu item the way the mouse does, then lets a frame run
export function clickSel(i) {
  document.querySelector(`#screen [data-sel="${i}"]`)?.click();
  step(0.05);
}

// gets from any menu (home, play menu, end of a run, the Keep) to the class select screen
export async function toTitle() {
  for (let i = 0; i < 24 && W.state !== 'title'; i++) {
    if (W.state === 'over') press(0);
    else if (W.state === 'home' || W.state === 'playmenu') clickSel(0); // the Dungeon card leads into the Keep
    else if (W.state === 'play' && W.room?.plan.kind === 'keep') { W.player.pos.copy(W.room.doors[0].pos); step(0.1); } // walk into the gate
    await sleep(250);
  }
  return W.state === 'title';
}

// gets to the Play menu from anywhere: class select goes back, and the Keep is left through the pause menu
export async function toPlayMenu() {
  for (let i = 0; i < 24 && W.state !== 'playmenu'; i++) {
    if (W.state === 'title' || W.state === 'anvil') press(1);
    else if (W.state === 'over') press(0);
    else if (W.state === 'home') clickSel(0);
    else if (W.state === 'play' && W.room?.plan.kind === 'keep') { press(9); step(0.05); if (W.state === 'pause') clickSel(1); } // pause, then Leave the Keep
    await sleep(250);
    step(0.05);
  }
  return W.state === 'playmenu';
}

export async function goDoor(d) {
  W.player.pos.set(d.pos.x + (d.wall === 'x' ? 0.4 : 0), 0, d.pos.z + (d.wall === 'z' ? 0.4 : 0));
  step(0.05);
  await sleep(300);
  return waitFor('play');
}

// stick values that move the player along a world direction
function stickToward(dx, dz) {
  const len = Math.hypot(dx, dz) || 1, s = Math.SQRT1_2;
  return [(dx * s - dz * s) / len, (dx * s + dz * s) / len];
}

// Crude bot: walk at the nearest enemy and attack. Doesn't dodge or path.
export function autofight(maxSec) {
  let t = 0;
  while (t < maxSec && !W.player.dead && W.state === 'play' && !W.room.cleared) {
    const alive = W.enemies.filter((e) => !e.dead).sort((a, b) => a.pos.distanceTo(W.player.pos) - b.pos.distanceTo(W.player.pos));
    const e = alive[0];
    if (e) {
      const dx = e.pos.x - W.player.pos.x, dz = e.pos.z - W.player.pos.z, len = Math.hypot(dx, dz);
      const range = (W.player.id === 'wizard' ? 6 : 1.4) + e.radius;
      const [sx, sy] = stickToward(dx, dz);
      const k = len > range ? 1 : 0.25;
      pad.axes[0] = sx * k; pad.axes[1] = sy * k;
      pad.buttons[2].pressed = len < range + 0.4;
      pad.buttons[3].pressed = len < 2.5 + e.radius && Math.random() < 0.3;
    }
    step(0.1);
    t += 0.1;
  }
  pad.axes[0] = pad.axes[1] = 0;
  pad.buttons[2].pressed = pad.buttons[3].pressed = false;
  return t;
}

export function swapClass(id) {
  W.player.model.root.removeFromParent();
  W.player = createPlayer(id, meta);
  W.player.pos.set(0, 0, 3);
}

// Every generated room must let you reach the reward spot and every door from the entry
export function plans(n = 200) {
  const k = (x, z) => `${x},${z}`, bad = [];
  for (const kind of ['combat', 'elite', 'boss', 'start', 'fountain', 'vault', 'exit']) {
    for (let i = 0; i < n; i++) {
      const p = makePlan(5, kind, 'boon');
      const floor = new Set(p.tiles.map(([x, z]) => k(x, z))), solid = new Set(p.pillars.map(([x, z]) => k(x, z)));
      const seen = new Set([k(...p.entry)]), todo = [p.entry];
      while (todo.length) {
        const [x, z] = todo.pop();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = k(x + dx, z + dz);
          if (floor.has(nk) && !solid.has(nk) && !seen.has(nk)) { seen.add(nk); todo.push([x + dx, z + dz]); }
        }
      }
      const doorTiles = p.slots.map((s) => (s.wall === 'z' ? [s.x - 0.5, s.z + 0.5] : [s.x + 0.5, s.z - 0.5]));
      const drop = p.drop ? p.drop.map((v) => Math.floor(v) + 0.5) : p.center;
      const onPillar = p.traps.some(([x, z]) => p.pillars.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1));
      if (!seen.has(k(...drop)) || onPillar || p.slots.length < 2 || doorTiles.some((t) => !seen.has(k(...t)))) bad.push(kind);
    }
  }
  return bad;
}

const check = (results, name, ok, info = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' (' + info + ')' : ''}`); };

// Plays the start room and a combat room with each class, unkillable so the bot can't fail a run
export async function smoke() {
  const results = [];
  const badRooms = plans();
  check(results, 'generated rooms are all reachable', !badRooms.length, badRooms.slice(0, 3).join(', '));
  await toTitle();
  for (const id of ['knight', 'rogue', 'wizard', 'barbarian', 'necromancer']) {
    await toTitle();
    press(0);
    check(results, `${id}: run starts`, await waitFor('play'), W.room?.plan.kind);
    swapClass(id);
    if (id === 'knight') {
      // a Cast thrown off the front edge must drop its shard back on the floor
      W.player.pos.copy(W.room.entry);
      W.player.facing.set(Math.SQRT1_2, 0, Math.SQRT1_2);
      press(1);
      step(1.2);
      const shard = W.room.pickups.find((k) => k.type === 'shard');
      // it may land at your feet and be picked straight back up; the bug is a shard lost in the void
      check(results, 'missed Cast lands on the floor', W.player.ammo === W.player.maxAmmo || (!!shard && W.room.onFloor(shard.obj.position)));
      // the mouse cursor to the right of the player turns them to face it
      Object.assign(input, { mouseAim: true, mouseAt: performance.now(), mouse: { x: innerWidth * 0.8, y: innerHeight * 0.5 } });
      step(0.1);
      const right = W.player.facing.x - W.player.facing.z; // screen-right on the ground is (+x, -z)
      check(results, 'mouse aim faces the cursor', right > 1);
      // a cursor left resting doesn't hold your aim: walking left turns you left
      input.mouseAt = performance.now() - 2000;
      pad.axes[0] = -1; step(0.2); pad.axes[0] = 0;
      input.mouseAim = false;
      check(results, 'a resting mouse lets you face the way you walk', W.player.facing.x - W.player.facing.z < -1);
    }
    W.player.maxHp = W.player.hp = 9999;
    await goDoor(W.room.doors[0]);
    check(results, `${id}: enters depth 1`, W.run.depth === 1 && W.room.plan.kind !== 'start', W.room.plan.kind);
    autofight(90);
    step(1);
    check(results, `${id}: clears the room`, W.room.cleared, `kills ${W.run.kills}`);
    // walk onto each reward where it actually lies (a centre pillar moves it off the centre)
    for (const k of [...W.room.pickups]) { W.player.pos.set(k.obj.position.x, 0, k.obj.position.z); step(0.3); }
    while (W.state === 'choice') { step(0.5); press(0); step(0.1); }
    check(results, `${id}: doors open after reward`, W.room.doors.some((d) => d.open));
    W.player.hp = 0; W.player.dead = true;
    step(2);
    check(results, `${id}: death ends the run`, W.state === 'over');
    press(0);
  }
  return results;
}

// Every enemy and boss spawns, acts against an unkillable player, and dies. The shield blocks from the front only.
export async function bestiary() {
  const results = [];
  await toTitle();
  press(0);
  await waitFor('play');
  W.player.maxHp = W.player.hp = 99999;
  W.player.lives = 99;
  W.run.xp = -1e9; // no level-up menu between fights
  W.room.doors.length = 0; // and no walking out through a door mid-test
  for (const type of Object.keys(TYPES).filter((t) => t !== 'dummy')) {
    const at = W.room.freeSpot(W.player.pos, 5.5);
    spawnEnemy(type, at.x, at.z, 9);
    step(1);
    const e = W.enemies.find((x) => x.type === type && !x.dead);
    if (!e) { check(results, type + ' spawns', false, `${W.state} in ${W.room?.plan.kind}`); continue; }
    if (type === 'shieldbearer') {
      e.facing.subVectors(W.player.pos, e.pos).setY(0).normalize();
      const front = e.pos.clone().addScaledVector(e.facing, 1), back = e.pos.clone().addScaledVector(e.facing, -1);
      const h0 = e.hp; damage(e, 40, front); const blocked = h0 - e.hp;
      const h1 = e.hp; damage(e, 40, back); const hit = h1 - e.hp;
      check(results, 'shieldbearer blocks from the front only', blocked < 12 && hit > 30, `front ${blocked}, back ${hit}`);
    }
    let moved = 0, acted = false;
    const from = e.pos.clone();
    for (let t = 0; t < 10 && !e.dead; t += 0.1) { W.room.cleared = false; step(0.1); acted ||= e.state !== 'recover'; moved = Math.max(moved, e.pos.distanceTo(from)); }
    const bar = document.querySelector('#boss .name')?.textContent;
    if (TYPES[type].boss) check(results, type + ' shows its name on the boss bar', !document.querySelector('#boss').classList.contains('hidden') && bar === TYPES[type].name.toUpperCase(), bar);
    // finish it and anything it summoned through the real death path (a bot chasing a kiter round props proves nothing)
    for (let i = 0; i < 3; i++) { for (const x of W.enemies.filter((x) => !x.dead)) damage(x, 1e6, x.pos); step(1); }
    check(results, type + ' acts and dies', (acted || moved > 1) && W.enemies.every((x) => x.dead), `moved ${moved.toFixed(1)}, left ${W.enemies.filter((x) => !x.dead).map((x) => x.type)}`);
    step(2);
  }
  W.player.hp = 0; W.player.dead = true;
  step(2);
  return results;
}

// picks the first card on every choice screen until play resumes
const takeChoices = () => { while (W.state === 'choice') { step(0.5); press(0); step(0.1); } };

export async function fullRun(maxRooms = 14) {
  await toTitle();
  press(0);
  await waitFor('play');
  const log = [];
  for (let n = 0; n < maxRooms && W.state !== 'over'; n++) {
    W.player.maxHp = W.player.hp = 9999;
    if (!W.room.cleared) { W.player.pos.copy(W.room.center); autofight(120); step(1.5); }
    takeChoices();
    for (const k of [...W.room.pickups]) { W.player.pos.set(k.obj.position.x, 0, k.obj.position.z); step(0.2); takeChoices(); }
    log.push(`${W.run.depth}:${W.room.plan.kind}/${W.room.plan.reward ?? '-'}${W.room.plan.patron ? `(${W.room.plan.patron})` : ''} lv${W.run.level} boons=${W.player.boons.length}`);
    const gate = W.room.doors.find((d) => d.kind === 'gate');
    if (gate) {
      W.run.keys = Math.max(1, W.run.keys);
      W.player.pos.set(gate.pos.x, 0, gate.pos.z + 0.9);
      step(0.1);
      press(5); // RB: interact
      step(0.1);
      break;
    }
    const door = W.room.doors.find((d) => d.open);
    if (!door) { log.push('no open door'); break; }
    await goDoor(door);
  }
  return { log, end: W.state, kills: W.run.kills, boons: W.player.boons.map((b) => `${b.id}:${b.rarity}:${b.level}`) };
}

// Walks through every tutorial step with the fake controller and checks it ends back at the play menu
export async function tutorial() {
  const results = [], t = () => W.tutorial;
  await toPlayMenu();
  clickSel(3); // Tutorial
  check(results, 'tutorial asks how you play', W.state === 'device' && document.querySelectorAll('#screen [data-sel]').length === 4);
  const was = settings.keysOnly;
  settings.keysOnly = true; input.usingPad = input.touch = false;
  check(results, 'keyboard only shows keys, not mouse buttons', label('attack') === 'J' && label('special') === 'K', label('attack'));
  settings.keysOnly = was;
  clickSel(2); // controller
  await waitFor('play');
  for (let i = 0; i < 50 && !W.tutorial; i++) await sleep(100); // it starts once the fade-in finishes
  check(results, 'tutorial starts', !!W.tutorial, W.room?.plan.kind);
  step(1);
  for (let i = 0; i < 8; i++) { pad.axes[0] = [1, 0, -1, 0][i % 4]; pad.axes[1] = [0, 1, 0, -1][i % 4]; step(0.5); }
  pad.axes[0] = pad.axes[1] = 0;
  step(0.1);
  check(results, 'step 1: move', t()?.step >= 1);
  press(0); step(0.8); press(0); step(0.8);
  check(results, 'step 2: dash', t()?.step >= 2);
  const d = W.enemies.find((e) => e.type === 'dummy');
  const faceDummy = (gap = 1) => { W.player.pos.set(d.pos.x + gap, 0, d.pos.z); W.player.facing.set(-1, 0, 0); };
  faceDummy(); pad.buttons[2].pressed = true; step(2); pad.buttons[2].pressed = false; step(0.2);
  check(results, 'step 3: attack the dummy', t()?.step >= 3);
  faceDummy(); W.player.spcCd = 0; press(3); step(0.8);
  check(results, 'step 4: special', t()?.step >= 4);
  faceDummy(2.5); press(1); step(0.6);
  const sh = W.room.pickups.find((k) => k.type === 'shard');
  if (sh) { W.player.pos.set(sh.obj.position.x, 0, sh.obj.position.z); step(0.3); }
  check(results, 'step 5: cast and pick up', t()?.step >= 5);
  W.player.maxHp = W.player.hp = 9999;
  for (let k = 0; k < 160 && t()?.step === 5; k++) {
    const g = W.enemies.find((e) => !e.dead && e.type === 'grunt');
    if (g) { W.player.pos.set(g.pos.x + 1, 0, g.pos.z); W.player.facing.set(-1, 0, 0); }
    pad.buttons[2].pressed = !!g;
    step(0.25);
  }
  pad.buttons[2].pressed = false;
  step(0.3);
  check(results, 'step 6: fight', t()?.step >= 6);
  const orb = W.room.pickups.find((k) => k.type === 'boon');
  if (orb) { W.player.pos.set(orb.obj.position.x, 0, orb.obj.position.z); step(0.2); }
  takeChoices();
  step(0.1);
  check(results, 'step 7: boon', t()?.step >= 7);
  const door = W.room.doors[0];
  W.player.pos.set(door.pos.x + (door.wall === 'x' ? 0.4 : 0), 0, door.pos.z + (door.wall === 'z' ? 0.4 : 0));
  step(0.1);
  check(results, 'tutorial finishes at the play menu', await waitFor('playmenu') && meta.tutorialDone && !W.tutorial);
  return results;
}

// Rebinding, sliders and toggles in Settings; restores the defaults afterwards
export async function settingsCheck() {
  const results = [];
  await toPlayMenu();
  press(1); step(0.05); // play menu -> home
  clickSel(1);
  check(results, 'settings opens', W.state === 'settings');
  const before = settings.master;
  pad.axes[0] = 1; step(0.05); pad.axes[0] = 0; step(0.05); // master volume up one notch
  check(results, 'slider moves', Math.abs(settings.master - Math.min(1, before + 0.1)) < 1e-9);
  clickSel(9); // the Attack row
  check(results, 'rebind waits for a key', !!input.capture);
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
  check(results, 'attack rebinds to F', settings.keys.attack.join() === 'KeyF');
  input.lastCapture = 0;
  clickSel(10); // Special: take F as well, so the two swap
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
  check(results, 'taking a used key swaps them', settings.keys.special.join() === 'KeyF' && settings.keys.attack.join() !== 'KeyF' && settings.keys.attack.length > 0);
  input.lastCapture = 0;
  clickSel(4); // screen shake toggle
  check(results, 'toggle flips', settings.shake === false);
  clickSel(4);
  settings.master = before;
  resetControls();
  press(1); step(0.05);
  check(results, 'back returns home', W.state === 'home');
  return results;
}

// Save files: what the game writes reads back exactly, and anything that isn't a good save is refused with a reason
export async function saves() {
  const results = [];
  const { saveData, parseSave } = await import('../src/save.js');
  const { saveMeta } = await import('../src/run.js');
  const { saveSettings } = await import('../src/settings.js');
  saveMeta(); saveSettings(); // a fresh browser may not have written either yet
  const file = JSON.stringify(saveData());
  const entries = parseSave(file);
  const keys = entries.map(([k]) => k);
  check(results, 'a save file holds progress and settings', keys.includes('dungeonlock.meta.v1') && keys.includes('dungeonlock.settings.v1'), keys.join(', '));
  check(results, 'a save file reads back exactly', entries.every(([k, v]) => localStorage.getItem(k) === v));
  const refuses = (name, text) => { try { parseSave(text); check(results, 'refuses ' + name, false); } catch (e) { check(results, 'refuses ' + name, !!e.message, e.message); } };
  refuses('a file that is not JSON', 'hello');
  refuses("another game's save", JSON.stringify({ game: 'other', data: { 'dungeonlock.meta.v1': '{}' } }));
  refuses('keys that are not ours', JSON.stringify({ game: 'dungeonlock', data: { 'evil.key': '{}' } }));
  refuses('a damaged value', JSON.stringify({ game: 'dungeonlock', data: { 'dungeonlock.meta.v1': '{broken' } }));
  refuses('a huge file', 'x'.repeat(300000));
  return results;
}

// Phone controls: a touch switches prompts over; the left-side stick walks; held buttons swing; aim finds the foe;
// a tapped hint works as its button; the buttons hide in menus
export async function touchControls() {
  const results = [];
  const P = await import('./phone.js');
  const { touch } = await import('../src/input.js');
  await toTitle();
  press(0);
  await waitFor('play');
  const p = W.player;
  p.maxHp = p.hp = 99999;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  step(0.5);
  P.tap(innerWidth * 0.75, innerHeight * 0.1);
  step(1 / 60);
  check(results, 'a touch shows the touch buttons', input.touch && !document.getElementById('touch').classList.contains('hidden'));
  p.pos.copy(W.room.center);
  const from = p.pos.clone(), f = P.down(innerWidth * 0.2, innerHeight * 0.6);
  P.move(f, innerWidth * 0.2 - 60, innerHeight * 0.6);
  step(0.4);
  P.up(f);
  step(1 / 60);
  check(results, 'the stick walks', p.pos.distanceTo(from) > 1 && !touch.x, p.pos.distanceTo(from).toFixed(2));
  const a = P.down(...P.centre('#touch .attack'));
  let swung = 0;
  for (let i = 0; i < 40; i++) { step(1 / 60); if (p.attackLock > 0) swung++; }
  P.up(a);
  step(1 / 60);
  check(results, 'holding Attack swings', swung > 0 && !touch.held.size, `${swung} frames`);
  spawnEnemy('grunt', p.pos.x + 3, p.pos.z, 0);
  step(1);
  const foe = W.enemies.find((e) => !e.dead);
  check(results, 'aim turns to the nearest foe', foe && p.facing.dot(foe.pos.clone().sub(p.pos).setY(0).normalize()) > 0.9);
  P.tapEl('#touch .pause');
  step(1 / 30);
  check(results, 'the pause button pauses, and the buttons hide', W.state === 'pause' && document.getElementById('touch').classList.contains('hidden'), W.state);
  P.tapEl('[data-sel="1"]'); // abandon
  for (let t = 0; t < 8000 && W.state !== 'over'; t += 100) { await sleep(100); step(0.02); }
  press(0);
  await waitFor('title');
  P.tap(innerWidth / 2, 4);
  P.tapEl('.hints > span:last-child'); // Back, as a chip
  step(1 / 30);
  check(results, 'a tapped hint works as its button', W.state !== 'title', W.state);
  clickSel(0);
  input.touch = false; // the other tests use the pad
  return results;
}

// Hardcore: the Anvil's help stays home, enemies are tougher, and their hits land harder
export async function hardcore() {
  const results = [];
  settings.hardcore = true;
  try {
    await toTitle();
    press(0);
    await waitFor('play');
    const p = W.player;
    check(results, 'Anvil upgrades are off', p.maxHp === p.cls.hp && !p.lives && !W.run.keys && p.mods.atk === 1, `health ${p.maxHp}`);
    spawnEnemy('grunt', p.pos.x + 3, p.pos.z, 0);
    step(1);
    const g = W.enemies.find((e) => !e.dead && e.type === 'grunt');
    check(results, 'enemies have half again the health', g?.maxHp === Math.round(TYPES.grunt.hp * 1.5), `${g?.maxHp} vs ${TYPES.grunt.hp}`);
    p.maxHp = p.hp = 9999;
    const hit = (on) => { settings.hardcore = on; p.invuln = 0; const before = p.hp; damage(p, 20, g.pos, { source: g }); return before - p.hp; };
    const normal = hit(false), hard = hit(true);
    check(results, 'their hits land half again as hard', hard >= normal * 1.4, `${normal} vs ${hard}`);
    p.hp = 0; p.dead = true;
    step(3);
    await toTitle();
  } finally { settings.hardcore = false; }
  return results;
}

// The Keep: the Dungeon card leads into it; no one lives there; the Anvil opens and returns; the gate leads to
// class select; a finished run comes back to the Keep
export async function keep() {
  const results = [];
  const go = async (cond, ms = 6000) => { for (let t = 0; t < ms && !cond(); t += 100) { await sleep(100); step(0.02); } return cond(); };
  await toPlayMenu();
  clickSel(0);
  check(results, 'the Dungeon card opens the Keep', await go(() => W.state === 'play' && W.room?.plan.kind === 'keep'), W.room?.plan.kind);
  const k = W.room.keep, p = W.player;
  check(results, 'the Anvil is there, and no one else', !!k.anvil && !W.room.extras?.length);
  p.pos.copy(k.anvil).add(new THREE.Vector3(0.9, 0, 0.9));
  step(0.1);
  press(5);
  check(results, 'the Anvil opens from the Keep', await go(() => W.state === 'anvil'), W.state);
  press(1);
  check(results, 'leaving the Anvil goes back to the Keep', await go(() => W.state === 'play' && W.room?.plan.kind === 'keep'), W.state);
  W.player.pos.copy(W.room.doors[0].pos);
  step(0.1);
  check(results, 'the gate leads to class select', await go(() => W.state === 'title'), W.state);
  press(0);
  await go(() => W.state === 'play');
  W.player.hp = 0; W.player.dead = true;
  step(3);
  press(0);
  check(results, 'a finished run comes back to the Keep', await go(() => W.state === 'play' && W.room?.plan.kind === 'keep'), W.state);
  return results;
}

// Feats: clearing a fight earns First Blood once, pays its ash into the bank, and pops up
export async function feats() {
  const results = [];
  const F = await import('../src/feats.js');
  meta.feats = {};
  await toTitle();
  press(0);
  await waitFor('play');
  W.player.maxHp = W.player.hp = 99999;
  const ash = meta.ash, d = W.room.doors[0];
  Object.assign(d, { kind: 'combat', reward: 'ash', locked: false });
  W.room.openDoors();
  d.open = true;
  await goDoor(d);
  for (let i = 0; i < 30 && !W.room.cleared; i++) { for (const e of W.enemies.filter((x) => !x.dead)) damage(e, 1e6, e.pos); step(0.5); }
  check(results, 'clearing a fight earns First Blood and pays its ash', F.hasFeat('firstblood') && meta.ash === ash + 20, `${meta.ash - ash} ash`);
  check(results, 'the feat pops up', /FIRST BLOOD/.test(document.getElementById('toast').textContent));
  const banked = meta.ash;
  check(results, 'a feat pays only once', F.earn('firstblood') === false && meta.ash === banked);
  W.player.hp = 0; W.player.dead = true;
  step(3);
  return results;
}

// Gale: a Shock boon makes your hit jump to the nearest other foe
export async function gale() {
  const results = [];
  const B = await import('../src/boons.js');
  await toTitle();
  press(0);
  await waitFor('play');
  const p = W.player;
  p.maxHp = p.hp = 99999;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  step(0.5);
  p.pos.copy(W.room.center);
  B.takeBoon(p, { id: 'gale_attack', rarity: 'common', level: 1 });
  spawnEnemy('grunt', p.pos.x + 1.5, p.pos.z, 0);
  spawnEnemy('grunt', p.pos.x + 3.2, p.pos.z, 0);
  step(1.2);
  for (const e of W.enemies) Object.assign(e, { timer: 99, state: 'recover' });
  const far = W.enemies.filter((e) => !e.dead).sort((a, b) => b.pos.x - a.pos.x)[0], before = far.hp;
  p.facing.set(1, 0, 0);
  pad.buttons[2].pressed = true; step(0.3); pad.buttons[2].pressed = false; step(0.1);
  check(results, 'Shock jumps to the next foe', before - far.hp >= 6, `${before - far.hp} damage`);
  check(results, 'Gale offers her own boons', B.offerBoons('gale', p, meta).every((b) => B.BOONS[b.id].patron === 'gale' || B.BOONS[b.id].duo?.includes('gale')));
  p.hp = 0; p.dead = true;
  step(3);
  return results;
}

// The Necromancer's raised dead: they rise on his Special, hurt enemies on their own, and crumble when their time is up
export async function allies() {
  const results = [];
  await toTitle();
  for (let i = 0; i < 6 && W.player.cls.name !== 'Necromancer'; i++) { pad.buttons[15].pressed = true; step(1 / 60); pad.buttons[15].pressed = false; step(1 / 60); }
  press(0);
  await waitFor('play');
  const p = W.player;
  p.maxHp = p.hp = 99999;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  step(0.5);
  p.pos.copy(W.room.center);
  spawnEnemy('brute', p.pos.x + 3, p.pos.z, 0);
  step(1.2);
  const foe = W.enemies.find((e) => !e.dead);
  Object.assign(foe, { timer: 99, state: 'recover', speed: 0 });
  const before = foe.hp;
  p.facing.set(1, 0, 0);
  press(3);
  step(0.1);
  check(results, 'Raise Dead raises two skeletons', (W.allies ?? []).length === 2, `${(W.allies ?? []).length}`);
  p.pos.x -= 4;
  step(6);
  check(results, 'the raised dead fight on their own', foe.hp < before || foe.dead, `${before} -> ${foe.hp}`);
  step(7);
  check(results, 'they crumble when their time is up', (W.allies ?? []).length === 0);
  p.hp = 0; p.dead = true;
  step(3);
  return results;
}

// The Peddler: a shop room sells for run ash, once per ware, and keeps the doors open
export async function shop() {
  const results = [];
  await toTitle();
  press(0);
  await waitFor('play');
  W.player.maxHp = W.player.hp = 99999;
  W.run.depth = 3;
  const d = W.room.doors[0];
  Object.assign(d, { kind: 'shop', reward: 'shop', locked: false });
  W.room.openDoors();
  d.open = true;
  await goDoor(d);
  const sh = W.room.shop;
  check(results, 'a shop door leads to the Peddler', W.room.plan.kind === 'shop' && !!sh, W.room.plan.kind);
  W.run.ash = 500;
  W.player.hp = 100;
  W.player.pos.copy(sh.pos).add(new THREE.Vector3(1, 0, 1));
  step(0.1);
  press(5);
  check(results, 'Use opens his stall', W.state === 'choice', W.state);
  step(0.5); // the stall ignores input for a moment, so a mashed button can't buy by accident
  clickSel(0); // Healing Draught
  step(0.1);
  check(results, 'buying spends run ash and works', W.run.ash < 500 && W.player.hp > 100 && sh.sold.has('draught'), `${W.run.ash} ash, ${Math.round(W.player.hp)} hp`);
  press(5);
  step(0.5);
  const ash = W.run.ash;
  clickSel(0); // sold already
  step(0.1);
  check(results, 'each ware sells once', W.run.ash === ash, `${W.run.ash}`);
  press(1);
  step(0.1);
  check(results, 'the doors stay open', W.room.doors.every((x) => x.open || x.locked) && W.state === 'play'); // a vault door stays locked until you use a key
  W.player.hp = 0; W.player.dead = true;
  step(3);
  return results;
}

// Perfect dodge: a blow that lands mid-dash slows the world and sharpens your next hits
export async function dodge() {
  const results = [];
  await toTitle();
  press(0);
  await waitFor('play');
  const p = W.player;
  p.maxHp = p.hp = 99999;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  step(0.5);
  spawnEnemy('grunt', p.pos.x + 1, p.pos.z, 0);
  step(1.2);
  const g = W.enemies.find((e) => !e.dead);
  press(0); // dash
  damage(p, 10, g.pos, { source: g });
  check(results, 'a hit mid-dash is a perfect dodge', p.dodgeT > 0 && W.slowmo > 0 && W.run.dodges === 1, `${W.run.dodges}`);
  const before = g.hp;
  damage(g, 10, p.pos, { source: p });
  check(results, 'and your next hits land harder', before - g.hp >= 14, `${before - g.hp}`);
  p.hp = 0; p.dead = true;
  step(3);
  return results;
}

// The Shrine: one bargain; Iron Debt pays ash now and toughens foes until three fights are cleared
export async function shrine() {
  const results = [];
  await toTitle();
  press(0);
  await waitFor('play');
  W.player.maxHp = W.player.hp = 99999;
  W.run.depth = 4;
  const d = W.room.doors[0];
  Object.assign(d, { kind: 'shrine', reward: 'shrine', locked: false });
  W.room.openDoors();
  d.open = true;
  await goDoor(d);
  const sr = W.room.shrine;
  check(results, 'a shrine door leads to the Shrine', W.room.plan.kind === 'shrine' && !!sr, W.room.plan.kind);
  const ash = W.run.ash;
  W.player.pos.copy(sr.pos).add(new THREE.Vector3(1.2, 0, 1.2));
  step(0.1);
  press(5);
  step(0.5);
  clickSel(1); // Iron Debt
  step(0.1);
  check(results, 'Iron Debt pays 120 ash and leaves a debt', W.run.ash === ash + 120 && W.run.curse?.id === 'iron' && sr.used, `${W.run.ash - ash} ash`);
  spawnEnemy('grunt', W.player.pos.x + 2, W.player.pos.z, 0);
  step(1.2);
  const g = W.enemies.find((e) => !e.dead && e.type === 'grunt');
  check(results, 'while it lasts, foes are tougher', g?.maxHp === Math.round(TYPES.grunt.hp * 1.4), `${g?.maxHp}`);
  W.player.hp = 0; W.player.dead = true;
  step(3);
  return results;
}

// Knell and Vigil: Doom lands later, all at once; a Mark turns the next hit into a Critical. The boon screen and pause list show them.
// Boon doors lean towards patrons you have met, and only offer those once you have met three.
export async function patrons() {
  const results = [];
  const B = await import('../src/boons.js');
  await toTitle();
  press(0);
  await waitFor('play');
  const p = W.player;
  p.maxHp = p.hp = 99999;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  step(0.5);
  p.pos.copy(W.room.center);
  spawnEnemy('brute', p.pos.x + 3, p.pos.z, 3);
  step(1.2);
  const e = W.enemies.find((x) => !x.dead);
  Object.assign(e, { timer: 99, state: 'recover' });
  B.takeBoon(p, { id: 'knell_attack', rarity: 'common', level: 1 });
  B.takeBoon(p, { id: 'vigil_special', rarity: 'common', level: 1 });
  damage(e, 1, p.pos, { source: p, tag: 'attack' });
  const doom = e.status?.doom?.v, hp = e.hp;
  step(0.6);
  const early = e.hp;
  step(0.8);
  check(results, 'Doom waits, then strikes all at once', doom === 10 && early === hp && e.hp < hp && !e.status.doom, `${hp} -> ${early} -> ${e.hp}`);
  damage(e, 1, p.pos, { source: p, tag: 'special' });
  check(results, 'a Vigil Special leaves a Mark', e.status?.mark?.v === 100);
  const before = e.hp;
  damage(e, 10, p.pos, { source: p, tag: 'attack' });
  const crit = before - e.hp, b2 = e.hp;
  damage(e, 10, p.pos, { source: p, tag: 'attack' });
  check(results, 'the Mark makes the next hit a Critical, then is spent', crit >= 2 * (b2 - e.hp) - 1 && !e.status.mark, `${crit} vs ${b2 - e.hp}`);
  e.status = { burn: { dps: 1, t: 9, tick: 0.5 }, mark: { v: 50, t: 9 } };
  step(0.1);
  check(results, 'statuses show over the foe\'s health bar', document.querySelectorAll('#bars .st u').length >= 2);
  const descs = Object.values(B.BOONS).map((d) => d.desc(d.base));
  check(results, 'every boon reads cleanly', descs.every((s) => typeof s === 'string' && !/NaN|undefined/.test(s)), `${descs.length} boons`);
  const { rollDoors } = await import('../src/run.js');
  const doorPatrons = (boons) => Array.from({ length: 400 }, (_, i) => rollDoors(1 + (i % 7), { boons, keyDoorsSeen: 2 })).flat().map((d) => d.patron).filter(Boolean);
  const three = doorPatrons(['cinder_attack', 'knell_dash', 'gale_cast']);
  check(results, 'with three patrons met, boon doors offer only them', three.length > 100 && three.every((x) => ['cinder', 'knell', 'gale'].includes(x)), `${three.length} doors`);
  const one = doorPatrons(['vigil_attack']), share = one.filter((x) => x === 'vigil').length / one.length;
  check(results, 'a patron you have met turns up far more often than 1 in 7', share > 0.3 && new Set(one).size === 7, `${Math.round(share * 100)}%`);
  check(results, 'Knell and Vigil offer their own boons', ['knell', 'vigil'].every((pid) => B.offerBoons(pid, p, meta).every((b) => B.BOONS[b.id].patron === pid || B.BOONS[b.id].duo?.includes(pid))));
  W.room.addPickup('boon', p.pos.x, p.pos.z, 'knell');
  step(0.3);
  const scr = document.getElementById('screen');
  check(results, 'the boon screen shows the patron\'s emblem and a line', W.state === 'choice' && !!scr.querySelector('.patron .sigil') && !!scr.querySelector('.patron .says') && scr.querySelectorAll('.card .marks .sigil').length >= 3);
  step(0.5);
  clickSel(0);
  step(2);
  press(9);
  step(0.1);
  check(results, 'pause lists the boons you carry', W.state === 'pause' && scr.querySelectorAll('.carried .bn').length === p.boons.length, `${scr.querySelectorAll('.carried .bn').length} of ${p.boons.length}`);
  press(9);
  step(0.1);
  p.hp = 0; p.dead = true;
  step(3);
  return results;
}

// Door signs sit on the doors; Trials pay an Epic boon or a little ash; a Chest can be an ambush; the Ember Forges below the second Lock
export async function rooms() {
  const results = [];
  const R = await import('../src/run.js');
  const { damage: hurt } = await import('../src/combat.js');
  const enter = async (kind, roll) => {
    await toTitle();
    press(0);
    await waitFor('play');
    W.player.maxHp = W.player.hp = 99999;
    W.run.depth = 3;
    const d = W.room.doors[0];
    Object.assign(d, { kind, reward: kind, locked: false, patron: null });
    W.room.openDoors();
    d.open = true;
    const rnd = Math.random;
    if (roll != null) Math.random = () => roll;
    await goDoor(d);
    Math.random = rnd;
  };
  // kills give XP; a level-up menu would open once the room clears, so those levels are dropped here
  const clear = () => { for (let i = 0; i < 40 && !W.room.cleared; i++) { for (const e of W.enemies.filter((x) => !x.dead)) damage(e, 1e6, e.pos); W.run.pendingLevels = 0; step(0.5); } };
  const die = () => { W.player.lives = 0; W.player.hp = 0; W.player.dead = true; step(3); };

  await toTitle();
  press(0);
  await waitFor('play');
  const signs = W.room.doors.filter((d) => d.sign);
  check(results, 'door signs sit on the door, not above it', signs.length > 0 && signs.every((d) => d.sign.position.y > 1 && d.sign.position.y < 2), signs.map((d) => d.sign.position.y).join(','));
  die();

  await enter('trial', 0.1); // the take-no-hits trial
  check(results, 'a Trial names its condition', W.room.plan.kind === 'trial' && W.run.trial?.id === 'untouched' && /Take no hits/.test(document.querySelector('#banner p').textContent));
  clear();
  check(results, 'passing a Trial pays an Epic boon', W.room.pickups.some((k) => k.type === 'boon' && k.epic), W.room.pickups.map((k) => k.type).join(','));
  die();

  await enter('trial', 0.1);
  step(1.2);
  W.player.invuln = 0;
  hurt(W.player, 5, null, { source: W.enemies.find((e) => !e.dead) });
  step(0.3); // the hit-stop holds the HUD for a few frames
  check(results, 'a hit fails it, and the HUD says so', /FAILED/.test(document.querySelector('#hud .depth').textContent));
  clear();
  check(results, 'failing pays a little ash instead', W.room.pickups.some((k) => k.type === 'ash') && !W.room.pickups.some((k) => k.type === 'boon'));
  die();

  await enter('chest');
  const ch = W.room.chest;
  check(results, 'a Chest room has a chest and open doors', !!ch && W.room.cleared && W.room.doors.every((d) => d.open || d.locked));
  W.player.pos.copy(ch.pos).add(new THREE.Vector3(1, 0, 1));
  step(0.1);
  const rnd = Math.random;
  Math.random = () => 0.9; // the ambush
  press(5);
  Math.random = rnd;
  step(1.5);
  check(results, 'an ambush shuts the doors on a wave', ch.opened && !W.room.cleared && W.room.doors.every((d) => !d.open) && W.enemies.some((e) => !e.dead));
  clear();
  check(results, 'surviving it pays a Keystone and ash', ['pom', 'bigash'].every((t) => W.room.pickups.some((k) => k.type === t)), W.room.pickups.map((k) => k.type).join(','));
  die();

  const foes = R.makePlan(24, 'combat').waves.flat();
  check(results, 'the Ember Forges lie below the second Lock', R.biomeFor(21).name === 'The Ember Forges' && R.biomeFor(29).name === 'The Crucible' && R.regionOf(31) === 'dry');
  check(results, 'the furnace dead fight there, and the Forgemaster waits at 29', foes.some((t) => ['cinderling', 'smelter', 'anvilback'].includes(t)) && !foes.includes('grunt') && R.makePlan(29, 'boss').waves[0][0] === 'forgemaster');
  return results;
}
