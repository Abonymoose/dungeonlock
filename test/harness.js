// Test harness: drives the real game with a fake controller at a fixed 60 steps per second.
// In the browser console on http://localhost:5173:  const T = await import('/test/harness.js'); await T.smoke();
import { frame } from '../src/main.js';
import { world as W } from '../src/world.js';
import { createPlayer } from '../src/classes.js';
import { meta, makePlan } from '../src/run.js';
import { makeWild, SIZE } from '../src/wild.js';
import { torchLights, GROUND_RIGHT } from '../src/render.js';
import { audio } from '../src/audio.js';
import { settings, resetControls } from '../src/settings.js';
import * as THREE from 'three';
import { input } from '../src/input.js';
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
    else if (W.state === 'talk') press(0);
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
    else if (W.state === 'talk') press(0);
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
      Object.assign(input, { mouseAim: true, mouse: { x: innerWidth * 0.8, y: innerHeight * 0.5 } });
      step(0.1);
      const right = W.player.facing.x - W.player.facing.z; // screen-right on the ground is (+x, -z)
      input.mouseAim = false;
      check(results, 'mouse aim faces the cursor', right > 1);
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

// The Wilds: an island with the start on dry land; gathering fills the pack; crafting spends it and builds;
// night raises zombies, dawn burns them and offers a boon; dying counts nights survived
export async function wilds() {
  const results = [];
  const plan = makeWild(), kinds = [0, 0, 0, 0, 0, 0];
  for (const k of plan.ground) kinds[k]++;
  const mid = (SIZE / 2) * SIZE + SIZE / 2;
  check(results, 'the island has sea, forest and rock, and starts on land', kinds[0] > 2000 && kinds[4] > 400 && kinds[5] > 200 && plan.ground[mid] !== 0, kinds.join('/'));

  await toPlayMenu();
  clickSel(1); // Open World
  press(0);
  await waitFor('play');
  const room = W.room, w = W.run.wild;
  check(results, 'the Wilds start from the third card', room?.plan.kind === 'wild', room?.plan.kind);
  if (room?.plan.kind !== 'wild') return results;
  W.player.maxHp = W.player.hp = 99999;
  W.run.xp = -1e9; // no level-up menu mid-test
  check(results, 'thousands of trees and rocks to gather', room.nodes.length > 1000, room.nodes.length + ' nodes');

  // a tree with nothing else close, so every press lands on it (Use takes the nearest node)
  const tree = room.nodes.find((n) => n.kind === 'tree' && !room.nodes.some((o) => o !== n && Math.hypot(o.x - n.x, o.z - n.z) < 2.5));
  W.player.pos.set(tree.x + 0.8, 0, tree.z);
  step(0.05);
  for (let i = 0; i < 3; i++) press(5); // Use
  check(results, 'chopping a tree three times gives 3 wood and fells it', w.mats.wood === 3 && w.mats.stone + w.mats.fiber === 0 && !room.nodes.includes(tree), `wood ${w.mats.wood}, stone ${w.mats.stone}, fiber ${w.mats.fiber}`);

  Object.assign(w.mats, { wood: 20, stone: 20, fiber: 20 });
  W.player.pos.copy(room.entry);
  step(0.05);
  press(8); // craft
  step(0.5);
  check(results, 'the craft button opens crafting', W.state === 'choice');
  press(0); // the first recipe is the campfire
  step(0.2);
  check(results, 'crafting a campfire spends wood and stone and lights it', room.fires.length === 1 && w.mats.wood === 15 && w.mats.stone === 18 && room.lightSpots.length === 1, `${w.mats.wood} wood`);
  press(8);
  step(0.5);
  press(1); // back closes it without crafting
  step(0.1);
  check(results, 'back closes crafting', W.state === 'play' && w.mats.wood === 15);

  W.player.pos.set(room.entry.x + 30, 0, room.entry.z); // well away from the fire
  W.player.pos.copy(room.freeSpot(W.player.pos, 0, 6));
  w.clock = 0.619;
  step(0.2);
  for (let t = 0; t < 12 && !W.enemies.some((e) => !e.dead); t += 0.5) step(0.5);
  check(results, 'night raises zombies', w.nights === 1 && W.enemies.some((e) => !e.dead && e.type === 'zombie'), `night ${w.nights}`);
  w.clock = 0.9499;
  step(0.1);
  check(results, 'dawn burns them and offers a boon', W.enemies.every((e) => e.dead) && W.state === 'choice' && W.run.depth === 1, W.state);
  step(0.5);
  press(0);
  step(0.2);

  W.player.hp = 0; W.player.dead = true;
  step(3);
  check(results, 'dying ends the run with nights survived', W.state === 'over' && /Nights survived/.test(document.querySelector('#screen').textContent), W.state);
  // a finished run returns to class select in the same mode, so pick the Dungeon card again for the other tests
  press(0);
  await waitFor('title');
  press(1);
  step(0.1);
  clickSel(0);
  return results;
}

const takeChoices = () => { while (W.state === 'choice') { step(0.5); press(0); step(0.1); } };

// Plays a whole run start to finish, unkillable, always taking the first door and the first card offered
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

// Adventure: the fourth card starts the story as the swordsmith; his moves are grounded; chapter 1's ambush must be
// beaten before the way on opens; the forge spends coin and keeps its work; a fall restarts the chapter; the tower ends it
export async function adventure() {
  const results = [];
  const { saveMeta } = await import('../src/run.js');
  const { damage } = await import('../src/combat.js');
  meta.adventure = null; meta.adventureDone = false; saveMeta();
  const until = async (cond, ms = 8000) => { for (let t = 0; t < ms && !cond(); t += 100) { await sleep(100); step(0.02); } return cond(); };
  const skipTalk = () => { for (let i = 0; i < 20 && W.state === 'talk'; i++) { step(0.35); press(0); } };
  const tough = () => { W.player.maxHp = W.player.hp = 99999; };

  await toPlayMenu();
  clickSel(2); // Adventure
  await until(() => W.state === 'talk');
  check(results, 'the fourth card starts the story as the swordsmith', W.state === 'talk' && W.player.cls.name === 'Swordsmith' && W.room?.plan.kind === 'field', W.state);
  skipTalk();
  check(results, 'story lines play, then the fight', W.state === 'play', W.state);
  tough();

  const p = W.player, from = p.pos.clone();
  p.facing.set(1, 0, 0);
  press(3); press(1); // Special, then Cast: neither does anything
  const spc = p.spcCd;
  press(0); // Dash
  step(0.3);
  check(results, 'no Cast, no Special, and Dash steps back', p.maxAmmo === 0 && spc <= 0 && p.pos.x < from.x - 0.4, `moved ${(p.pos.x - from.x).toFixed(2)}`);
  step(0.8); // the step comes back
  pad.axes[0] = 1; // walking right on the stick
  frame(1 / 60);
  press(0);
  pad.axes[0] = 0;
  check(results, 'Dash steps the way you walk', p.dashDir.dot(GROUND_RIGHT) > 0.9, p.dashDir.toArray().map((v) => v.toFixed(2)).join(','));

  const plan = W.room.plan, ambush = plan.triggers[0];
  p.pos.set(plan.exit[0], 0, plan.exit[1]);
  step(0.3);
  check(results, 'the way on stays shut while the ambush waits', W.state === 'play' && ambush.state !== 'done');
  p.pos.set(ambush.at[0], 0, ambush.at[1]);
  for (let i = 0; i < 40 && ambush.state !== 'done'; i++) { step(0.5); for (const e of W.enemies.filter((x) => !x.dead)) damage(e, 1e6, e.pos); }
  step(2);
  check(results, 'bandits ambush on the road and fall to the sword', ambush.state === 'done' && W.run.kills >= 2, `kills ${W.run.kills}`);
  p.pos.set(plan.exit[0], 0, plan.exit[1]);
  step(0.2);
  check(results, 'the way on opens onto your forge', W.state === 'choice', W.state);

  Object.assign(W.adventure, { coin: 60, iron: 10 });
  step(0.5);
  press(0); // the first card: Hone the Edge
  step(0.5);
  check(results, 'the forge spends coin and iron', W.adventure.edge === 1 && W.adventure.coin === 52 && W.adventure.iron === 9, `edge ${W.adventure.edge}, coin ${W.adventure.coin}`);
  for (let i = 0; i < 3; i++) press(15);
  press(0); // Set out
  await until(() => W.state === 'talk' && W.adventure.chapter === 1);
  check(results, 'chapter 2 starts with the forge work kept and saved', W.room.plan.kind === 'field' && p.mods.atk === 1.25 && meta.adventure?.chapter === 1 && meta.adventure.edge === 1, `chapter ${meta.adventure?.chapter}`);
  skipTalk();

  W.player.hp = 0; W.player.dead = true;
  step(2);
  check(results, 'falling shows the chapter screen', W.state === 'over' && /Chapter/.test(document.querySelector('#screen').textContent), W.state);
  meta.adventure.chapter = 5; // straight to the tower
  press(0);
  await until(() => W.state === 'talk' && W.adventure.chapter === 5);
  check(results, 'a fall restarts from the saved chapter', W.room.plan.kind === 'boss' && W.adventure.edge === 1, W.room?.plan.kind);
  skipTalk();
  tough();
  await until(() => W.enemies.some((e) => !e.dead && e.type === 'blackknight'));
  check(results, 'the Black Knight waits in the tower', document.querySelector('#boss .name').textContent === 'THE BLACK KNIGHT');
  for (let i = 0; i < 20 && W.enemies.some((e) => !e.dead); i++) { for (const e of W.enemies.filter((x) => !x.dead)) damage(e, 1e6, e.pos); step(0.5); }
  await until(() => W.state === 'talk', 5000);
  check(results, 'his fall brings the princess and the last words', W.state === 'talk' && W.room.extras?.length === 1, W.state);
  skipTalk();
  await until(() => W.state === 'playmenu');
  check(results, 'the ending marks the adventure completed', W.state === 'playmenu' && meta.adventureDone === true && !meta.adventure, W.state);
  clickSel(0); // back toward Dungeon mode for the other tests
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

// The Keep: the Dungeon card leads into it; Maren and Rattle talk; the Anvil opens and returns; the gate leads to
// class select; a finished run comes back to the Keep with news for Maren
export async function keep() {
  const results = [];
  const go = async (cond, ms = 6000) => { for (let t = 0; t < ms && !cond(); t += 100) { await sleep(100); step(0.02); } return cond(); };
  await toPlayMenu();
  clickSel(0);
  check(results, 'the Dungeon card opens the Keep', await go(() => W.state === 'play' && W.room?.plan.kind === 'keep'), W.room?.plan.kind);
  const k = W.room.keep, p = W.player;
  check(results, 'Maren, Rattle and the Anvil are there', k.people.length === 2 && !!k.anvil);
  const talkTo = async (who) => {
    const at = k.people.find((x) => x.name === who).pos;
    p.pos.copy(at).add(new THREE.Vector3(0.9, 0, 0.9));
    step(0.1);
    press(5); // Use
    const ok = W.state === 'talk' && document.getElementById('talk').textContent.includes(who);
    for (let i = 0; i < 12 && W.state === 'talk'; i++) { step(0.35); press(0); }
    return ok;
  };
  check(results, 'Maren talks', await talkTo('Maren'));
  check(results, 'Rattle talks', await talkTo('Rattle'));
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
  check(results, 'a finished run comes back to the Keep, with news', await go(() => W.state === 'play' && W.room?.plan.kind === 'keep') && meta.keepNews === true && meta.lastRun?.depth === 0, W.state);
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

// The Wilds' newer recipes: stew and charm change you, a torch post lights the ground, spikes cut the dead
export async function crafts() {
  const results = [];
  const { RECIPES, craft } = await import('../src/wild.js');
  const r = (id) => RECIPES.find((x) => x.id === id);
  await toPlayMenu();
  clickSel(1); // Open World
  press(0);
  await waitFor('play');
  const p = W.player, room = W.room;
  Object.assign(W.run.wild.mats, { wood: 50, stone: 50, fiber: 50 });
  const hp = p.maxHp, ammo = p.maxAmmo;
  craft(r('stew'));
  craft(r('charm'));
  check(results, 'stew and the charm make you tougher', p.maxHp === hp + 15 && p.maxAmmo === ammo + 1, `${p.maxHp} hp, ${p.maxAmmo} shards`);
  const fires = room.fires.length;
  craft(r('torch'));
  check(results, 'a torch post lights the ground', room.fires.length === fires + 1 && room.fires.at(-1).torch === true);
  p.facing.set(0, 0, 1);
  craft(r('spikes'));
  const s = room.spikes.at(-1);
  p.pos.x += 4; // stand clear, so the zombie stays on the stakes
  spawnEnemy('zombie', s.x, s.z, 1);
  step(2);
  const z = W.enemies.find((e) => !e.dead && e.type === 'zombie' && Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < 1);
  if (z) { Object.assign(z, { timer: 99, state: 'recover', speed: 0 }); z.pos.set(s.x, 0, s.z); }
  const before = z?.hp ?? 0;
  step(1.2);
  check(results, 'spike traps cut the dead', !!z && (z.dead || z.hp < before), z ? `${before} -> ${z.hp}` : 'no zombie');
  p.hp = 0; p.dead = true;
  step(3);
  await toPlayMenu();
  clickSel(0); // back to the Dungeon card for the other tests
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
