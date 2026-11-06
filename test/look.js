// Dev helper for eyeballing generated rooms and Adventure chapters.
// In the console on http://localhost:5173:  const L = await import('/test/look.js'); await L.room(6); await L.chapter(2);
import * as T from './harness.js';
import { world as W } from '../src/world.js';
import * as R from '../src/render.js';
import { meta } from '../src/run.js';

export async function room(depth, kind = 'combat', boss = null) {
  if (W.state !== 'play') { await T.toTitle(); T.press(0); await T.waitFor('play'); }
  W.player.maxHp = W.player.hp = 99999;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  Object.assign(W, { pendingSpawns: 0 });
  T.step(2);
  W.room.cleared = true;
  W.room.pickups.length = 0;
  W.run.pendingLevels = 0;
  W.run.depth = depth - 1;
  const d = W.room.doors[0];
  Object.assign(d, { kind, reward: 'boon', patron: 'cinder', locked: false });
  W.room.openDoors();
  await T.goDoor(d);
  if (boss) W.room.plan.waves = [[boss]];
  T.step(2.5); // let the first wave rise
  W.player.pos.copy(W.room.center).add({ x: 2, y: 0, z: 2 });
  T.step(0.1);
  R.updateCamera(0, W.player.pos, true);
  R.draw();
  const p = W.room.plan;
  return { pillars: p.pillars.length, traps: p.traps.length, drop: !!p.drop, enemies: W.enemies.filter((e) => !e.dead).map((e) => e.type) };
}

// Opens Adventure at chapter i (0-5), past its opening lines
export async function chapter(i) {
  meta.adventure = { chapter: i, coin: 0, iron: 0, edge: 0, reach: 0, mail: 0 };
  if (W.adventure && W.state === 'play') {
    // already in the story: falling restarts at the saved chapter, which is now i
    W.player.hp = 0; W.player.dead = true;
    T.step(2);
    W.adventure.chapter = i;
    meta.adventure.chapter = i;
    T.press(0);
  } else {
    await T.toPlayMenu();
    T.clickSel(2); // Adventure
  }
  for (let t = 0; t < 80 && W.state !== 'talk'; t++) { await T.sleep(100); T.step(0.02); }
  for (let k = 0; k < 20 && W.state === 'talk'; k++) { T.step(0.35); T.press(0); }
  W.player.maxHp = W.player.hp = 99999;
  return { state: W.state, kind: W.room.plan.kind, title: document.querySelector('#banner h1')?.textContent };
}

// redraws a few times so a screenshot of a hidden pane is current
export async function frame(at = W.player.pos) {
  R.updateCamera(0, at, true);
  for (let k = 0; k < 3; k++) { R.draw(); await T.sleep(250); }
}
