import * as THREE from 'three';
import { C, BOSS_DEPTH } from './config.js';
import { basic } from './render.js';
import { character, prop, medieval, MEDIEVAL_SCALE } from './assets.js';
import { btn, pressed } from './input.js';
import { makePlan, BIOMES, meta, saveMeta } from './run.js';

// The Keep: the last dry room above the dungeon, where Dungeon runs start and end (Hades' House, in small).
// Maren keeps the fire and has something to say about each run. Rattle walked out of the Lock long ago and stayed.

export function keepPlan() {
  const plan = makePlan(0, 'keep');
  plan.biome = BIOMES.keep;
  plan.doorPlans = [{ kind: 'keep', reward: null }];
  plan.banner = ['THE KEEP', 'The last dry room above the dungeon'];
  return plan;
}

const MAREN = 'Maren', RATTLE = 'Rattle';
const LINES = {
  intro: [
    [MAREN, "So you're the one who came down the stairs. Welcome to the Keep, the last dry room above the dungeon."],
    [MAREN, 'Below us is the Lock. Everyone who goes down is trying to open it. Nobody has, not for good.'],
    [MAREN, "The Anvil by the wall takes ash. Rattle takes patience. The gate is behind me when you're ready."],
  ],
  escaped: [
    [MAREN, "You came back up through the Lock! I'll admit I had started clearing out your bunk."],
    [MAREN, "It closes behind you, you know. It always closes. But now you know the way."],
  ],
  trapped: [
    [MAREN, 'No key at the Lock. I know that face. Everyone who reaches it empty-handed wears it.'],
    [MAREN, 'Keys are worth more than boons down there. Take the doors that offer them.'],
  ],
  warden: [[MAREN, "The Warden. He guarded this Keep once, before the Lock got hold of him. Watch his charge: once he starts, he can't turn."]],
  prior: [[MAREN, 'The Hollow Prior still thinks he is saying mass. His bolts come in rings, so look for the gaps.']],
  reaver: [[MAREN, 'The Reaver lunges three times, four when he is angry. Count them, and hit him after the last one.']],
  drownedking: [[MAREN, 'So the water got you. The Drowned King ruled up here once. Cross his waves, never walk along them.']],
  vaults: [
    [MAREN, 'You went below the first Lock, into the flooded halls. Most never see the water at all.'],
    [MAREN, "The drowned drag at your legs. Don't trade blows with them. Let them come to you."],
  ],
  record: [[MAREN, 'Depth {depth}. Deeper than you have ever been. The dungeon noticed, I promise you.']],
  early: [[MAREN, 'Back already? The first rooms are the cruelest, because you still think it will be easy.']],
  hardcore: [[MAREN, "No Anvil, and they hit half again as hard? You're either very good or very stubborn. Both, I'd guess."]],
  fell: [[MAREN, 'You fell at depth {depth}. Sit by the fire a moment. The dungeon will still be there.']],
  lore: [
    [[MAREN, "The patrons aren't gods, whatever they tell you. They're old, and bored, and they like to watch."]],
    [[MAREN, 'Ash is what is left of the dead down there. It remembers being strong. That is why the Anvil can use it.']],
    [[MAREN, 'I went down once. Depth six. I came back up and decided someone had better keep the fire going.']],
    [[MAREN, 'Rattle was the first skeleton ever to walk out of the Lock. He has been here so long he forgot to be frightening.']],
    [[MAREN, 'Below the first Lock the stairs run into water. I do not know why. I have stopped asking.']],
    [[MAREN, 'There is a fifth patron now. Gale. She howls down the stairwell at night. Her lightning jumps from foe to foe, so fight her way in a crowd.']],
    [[MAREN, 'Two more patrons woke this week. Knell rings a bell when something is about to die. Vigil just watches. I liked it better when they slept.']],
    [[MAREN, "Knell's Doom lands a breath after you strike. Hit again before it falls and the blow only gets heavier."]],
    [[MAREN, "Vigil marks a weak spot. Your next hit there is a Critical. Hit the mark, then hit it again: that's the whole trick."]],
  ],
  idle: [[MAREN, "The gate's behind me whenever you're ready."]],
  rattle: [
    [RATTLE, 'Oh! A visitor with skin on. Lovely. Mind the bones, they are mine.'],
    [RATTLE, 'Tip from a skeleton: the red shapes on the floor are where it hurts. I learned that the hard way. Twice.'],
    [RATTLE, 'Shards come back if you go and pick them up. Unlike my left arm, which I am still looking for.'],
    [RATTLE, 'Elites glow red. Hit those first. Or don\'t, and come back and tell me how it went.'],
    [RATTLE, 'You can buy new weapons on the class screen. Up and down. I would take the greatsword. I would also fall over.'],
    [RATTLE, "Bonecallers raise grunts out of the floor. Rude, honestly. Some of us are trying to rest."],
    [RATTLE, 'Fountains heal you halfway. I drink from them too. It all runs out the bottom, but it is the thought that counts.'],
    [RATTLE, 'The Wizard blinks right through danger. I would blink too, if I had eyelids.'],
    [RATTLE, 'Dashing makes you untouchable for a heartbeat. I have no heartbeat, so I just stand very still.'],
    [RATTLE, 'The Necromancer raises skeletons to fight for him. Twelve seconds, then back to dust. Union rules, I think.'],
    [RATTLE, 'The Barbarian hits harder the more he bleeds. I tried that. I just fell apart. Literally. Took an hour.'],
    [RATTLE, 'Elites with names over their heads? Read the name. Volatile ones go bang. Vampiric ones drink. Rude, both.'],
    [RATTLE, 'There is a Peddler down there. Hooded fellow. Sells keys and boons for the ash in your pockets. Never tells me his name. Rude.'],
    [RATTLE, 'Shrines offer bargains. Never take a bargain from a glowing red ball. I did once. That is how I lost the arm.'],
    [RATTLE, 'Dash through a blow just as it lands and the whole world slows down. Perfect dodge, they call it. I call it showing off.'],
    [RATTLE, 'Pause in the middle of a fight and you can read every boon you carry. I read mine every morning. I have none. It is a short read.'],
    [RATTLE, 'Little coloured squares over a foe tell you what you did to it. Red blinking means Doom is coming. For them. Probably.'],
    [RATTLE, 'Feats pay ash the moment you do them. I earned one once: Stood In A Corner For Ninety Years. Nobody gave me ash.'],
  ],
};
const fill = (lines, run) => lines.map(([who, text]) => [who, text.replace('{depth}', run?.depth ?? 0)]);

// What Maren says now: the first visit, then the last run if there is news, then a bit of lore, then small talk
function marenLines() {
  const run = meta.lastRun, wasNews = meta.keepNews;
  meta.keepNews = false;
  meta.keepSeen = meta.keepSeen ?? {};
  let lines;
  if (!meta.keepSeen.intro) { meta.keepSeen.intro = true; lines = LINES.intro; }
  else if (wasNews && run) {
    const why = run.kind === 'escaped' ? 'escaped' : run.kind === 'trapped' ? 'trapped' : run.boss && LINES[run.boss] ? run.boss
      : run.hardcore && !meta.keepSeen.hardcore ? 'hardcore' : run.record && run.depth > 3 ? 'record'
        : run.depth > BOSS_DEPTH + 1 && !meta.keepSeen.vaults ? 'vaults' : run.depth <= 2 ? 'early' : 'fell';
    meta.keepSeen[why] = true;
    lines = fill(LINES[why], run);
  } else {
    const i = meta.keepSeen.lore ?? 0;
    if (i < LINES.lore.length) { lines = LINES.lore[i]; meta.keepSeen.lore = i + 1; }
    else lines = LINES.idle;
  }
  saveMeta();
  return lines;
}
function rattleLine() {
  const i = meta.keepSeen?.rattle ?? 0;
  meta.keepSeen = { ...meta.keepSeen, rattle: (i + 1) % LINES.rattle.length };
  saveMeta();
  return [LINES.rattle[i]];
}

// Puts Maren, Rattle and the Anvil corner into a freshly built Keep room
export function furnishKeep(room) {
  const door = room.doors[0]?.pos ?? room.center, c = room.center;
  const people = [];
  const stand = (model, at, name, idle) => {
    model.root.position.copy(at);
    model.anim.loop(idle);
    model.anim.update(Math.random());
    room.group.add(model.root);
    room.obstacles.push({ x: at.x, z: at.z, hw: 0.35, hd: 0.35 });
    people.push({ name, model, pos: at.clone() });
  };
  // Maren between the middle and the gate; Rattle sitting on the floor off to one side
  const side = new THREE.Vector3(door.z - c.z, 0, c.x - door.x).normalize();
  stand(character('Mage', { tint: [C.ONYX, 0x4a4a5e, 0xd8d0c4, 0.6], hide: ['Spellbook', '1H_Wand', '2H_Staff'], anims: { idle: 'Idle', cheer: 'Cheer' } }),
    room.freeSpot(c.clone().lerp(door, 0.35).addScaledVector(side, 1.4), 0, 2), MAREN, 'idle');
  stand(character('Skeleton_Minion', { anims: { idle: 'Sit_Floor_Idle', cheer: 'Cheer' } }), room.freeSpot(c.clone().addScaledVector(side, -2.6), 0, 2), RATTLE, 'idle');
  // the Anvil: a weapon rack and a crate of tools against the far side
  const anvil = room.freeSpot(c.clone().addScaledVector(side, 3).lerp(door, -0.2), 0, 3);
  const rack = medieval('weaponrack', MEDIEVAL_SCALE);
  rack.position.copy(anvil);
  room.group.add(rack);
  const chest = prop('box_large', 0.5);
  chest.position.copy(anvil).addScaledVector(side, -0.9);
  room.group.add(chest);
  room.obstacles.push({ x: anvil.x, z: anvil.z, hw: 0.5, hd: 0.5 }, { x: chest.position.x, z: chest.position.z, hw: 0.4, hd: 0.4 });
  // a sand-coloured mark over Maren while she has news
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), basic(C.SAND));
  people[0].model.root.add(mark);
  mark.position.y = 2.3;
  room.keep = { people, anvil, mark };
  room.extras = people.map((p) => p.model);
}

// Each frame in the Keep: people turn to face you as you come near, and Use talks to them or opens the Anvil
export function keepUpdate(room, player, dt) {
  const k = room.keep;
  k.mark.visible = !meta.keepSeen?.intro || !!meta.keepNews;
  k.mark.position.y = 2.3 + Math.sin(performance.now() / 300) * 0.08;
  let near = null, best = 2.0;
  for (const p of k.people) {
    p.model.anim.update(dt);
    const d = p.pos.distanceTo(player.pos);
    if (d < 4 && p.name === MAREN) p.model.root.rotation.y = Math.atan2(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
    if (d < best) { best = d; near = p; }
  }
  if (near) {
    if (pressed('interact')) return { lines: near.name === MAREN ? marenLines() : rattleLine() };
    return { prompt: `${btn('interact')}TALK TO ${near.name.toUpperCase()}` };
  }
  if (k.anvil.distanceTo(player.pos) < 1.8) {
    if (pressed('interact')) return { anvil: true };
    return { prompt: `${btn('interact')}THE ANVIL <span class="dim">${meta.ash} ASH</span>` };
  }
  return {};
}
