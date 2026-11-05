import { world } from './world.js';
import { btn, input } from './input.js';
import { spawnEnemy } from './enemies.js';
import { sfx } from './audio.js';

// The guided tutorial: one room, one step at a time. Each step has a goal count; reaching it starts the next step.
const dummy = () => world.enemies.find((e) => e.type === 'dummy' && !e.dead);
const fightOver = () => world.pendingSpawns === 0 && !world.enemies.some((e) => !e.dead && e.type !== 'dummy');

export const STEPS = [
  { text: () => (input.touch ? 'Walk around the room: drag your thumb on the left side of the screen.' : 'Walk around the room with the left stick or WASD.'), goal: 6, count: (t) => t.moved },
  { text: () => `Dash with ${btn('dash')}. You can't be hit while dashing.`, goal: 2, count: (t) => t.dashes },
  { text: () => `Hold ${btn('attack')} to attack the training dummy. Every third hit is a heavy finisher.`, goal: 3, count: (t) => t.hits.attack ?? 0 },
  { text: () => `Use your special on the dummy with ${btn('special')}.`, goal: 1, count: (t) => t.hits.special ?? 0 },
  { text: () => `Throw a Lock Shard with ${btn('cast')}, then walk over it to pick it back up.`, goal: 1, count: (t, p) => (t.thrown && p.ammo === p.maxAmmo ? 1 : 0) },
  {
    text: () => 'Skeletons! A red shape on the floor shows where an attack will land. Dash out of it, then strike back.',
    start: () => { const c = world.room.center; spawnEnemy('grunt', c.x + 2, c.z - 2, 0); spawnEnemy('grunt', c.x - 2, c.z + 2, 0); },
    fight: true, // the one step with health on show: you can be hit, and these foes are meant to die
    goal: 1, count: () => (fightOver() ? 1 : 0),
  },
  {
    text: () => 'Walk into the glowing orb and take a boon. Boons upgrade your moves for the rest of the run.',
    start: () => { const c = world.room.center; world.room.addPickup('boon', c.x, c.z + 1, 'cinder'); },
    goal: 1, count: (t, p) => (p.boons.length ? 1 : 0),
  },
  { text: () => 'Walk through the open door to finish.', start: () => world.room.openDoors(), goal: 1, count: () => 0 },
];

export function startTutorial() {
  world.tutorial = { step: 0, moved: 0, dashes: 0, hits: {}, thrown: false };
  world.player.lives = 99; // you can't lose the tutorial
  const c = world.room.center;
  spawnEnemy('dummy', c.x - 2, c.z - 1, 0);
}

// Returns what the tutorial panel should show this frame
export function updateTutorial(dt) {
  const t = world.tutorial, p = world.player, d = dummy();
  t.moved += p.vel.length() * dt * 0.5;
  if (p.sinceDash === 0) t.dashes++;
  if (p.ammo < p.maxAmmo) t.thrown = true;
  if (d) {
    d.onHurt ??= (tag) => { t.hits[tag] = (t.hits[tag] ?? 0) + 1; };
    // the dummy never dies, so shards stuck in it drop straight back out
    for (; d.shards > 0; d.shards--) world.room.addPickup('shard', d.pos.x + 0.8, d.pos.z + 0.8);
  }
  const s = STEPS[t.step], n = Math.min(s.goal, s.count(t, p));
  if (n >= s.goal && t.step < STEPS.length - 1) {
    t.step++;
    STEPS[t.step].start?.();
    sfx('unlock');
  }
  return { step: t.step + 1, total: STEPS.length, fight: !!STEPS[t.step].fight, text: STEPS[t.step].text(), progress: Math.min(1, STEPS[t.step].count(t, p) / STEPS[t.step].goal) };
}
