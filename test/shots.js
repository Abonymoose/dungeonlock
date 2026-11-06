// Renders the art for the Play cards, the codex and the wiki straight from the game, and saves each PNG to
// assets/shots/ through the local server's /__shot endpoint. Run in the console on http://localhost:5173:
//   const S = await import('/test/shots.js'); await S.all();
import * as T from './harness.js';
import { world as W } from '../src/world.js';
import * as R from '../src/render.js';
import { spawnEnemy, BESTIARY } from '../src/enemies.js';
import { createPlayer } from '../src/classes.js';
import { meta } from '../src/run.js';

const FACE_CAMERA = Math.PI / 4; // the camera looks from +x +z, so this turns a model toward it

// Frames the camera on a point at a zoom, renders, crops w x h canvas pixels around it and saves it
async function shot(name, at, { zoom = 1, w = 0, h = 0, lift = 0.6 } = {}) {
  R.camera.zoom = zoom;
  R.camera.updateProjectionMatrix();
  R.updateCamera(0, at, true);
  R.playerLight.position.set(at.x + 0.6, 1.8, at.z + 0.6);
  R.draw();
  const src = R.renderer.domElement;
  let sx = 0, sy = 0, sw = src.width, sh = src.height;
  if (w) {
    const s = R.toScreen(at, lift), k = src.width / src.clientWidth;
    sw = w; sh = h;
    sx = Math.round(s.x * k - w / 2); sy = Math.round(s.y * k - h / 2);
  }
  const c = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const res = await fetch('/__shot/' + name, { method: 'POST', body: blob });
  R.camera.zoom = 1;
  R.camera.updateProjectionMatrix();
  return `${name} ${sw}x${sh} ${res.ok ? 'saved' : 'FAILED'}`;
}

// clears the current room and walks through a door into a room of the given kind at the given depth
async function visit(depth, kind = 'combat') {
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  Object.assign(W, { pendingSpawns: 0, waveDelay: 0 });
  T.step(2.2);
  Object.assign(W.room, { cleared: true });
  W.room.pickups.length = 0;
  W.run.pendingLevels = 0;
  W.run.depth = depth - 1;
  const d = W.room.doors[0];
  Object.assign(d, { kind, reward: 'boon', patron: 'cinder', locked: false });
  W.room.openDoors();
  d.open = true;
  await T.goDoor(d);
  T.step(0.1);
  W.waveDelay = 99; // keep the room empty unless a shot spawns its own enemies
}

const swap = (id) => {
  W.player.model.root.removeFromParent();
  W.player = createPlayer(id, meta);
};

export async function all() {
  const out = [];
  await T.toTitle();
  T.press(0);
  await T.waitFor('play');
  W.player.maxHp = W.player.hp = 9999;
  W.player.lives = 99;
  const c = W.room.center;

  // class portraits, in the warm start room
  for (const id of ['knight', 'rogue', 'wizard', 'barbarian', 'necromancer']) {
    swap(id);
    W.player.pos.copy(c);
    W.player.model.root.rotation.y = FACE_CAMERA;
    W.player.model.anim.loop('idle');
    W.player.model.anim.update(0.4);
    out.push(await shot('class-' + id, c, { zoom: 2.6, w: 120, h: 132 }));
  }

  // the Dungeon card: a fight in the Crypt
  await visit(4);
  const k = W.room.center;
  W.player.pos.copy(k);
  for (const [type, dx, dz] of [['grunt', -1.6, -0.6], ['hexer', 0.4, -2], ['brute', 1.4, 0.4]]) spawnEnemy(type, k.x + dx, k.z + dz, 4);
  T.step(2.4);
  for (const e of W.enemies) { e.timer = 99; e.state = 'recover'; e.facing.subVectors(W.player.pos, e.pos).setY(0).normalize(); }
  T.step(0.4);
  W.player.facing.set(-1, 0, -0.3).normalize();
  W.player.model.root.rotation.y = Math.atan2(W.player.facing.x, W.player.facing.z);
  out.push(await shot('card-dungeon', k, { zoom: 1.5, w: 300, h: 220, lift: 0.2 }));

  // enemy portraits, one at a time, on a patch of floor with no pillar or crate nearby and the player out of frame
  const clearSpot = () => {
    for (let i = 0; i < 200; i++) { const p = W.room.freeSpot(k, 0); if (!W.room.obstacles.some((o) => !o.edge && Math.hypot(o.x - p.x, o.z - p.z) < 2.8)) return p; }
    return k.clone();
  };
  for (const { id: type, boss } of BESTIARY) {
    for (const e of W.enemies) { e.hp = 0; e.dead = true; }
    T.step(2);
    const at = clearSpot();
    W.player.pos.copy(W.room.freeSpot(at, 6));
    spawnEnemy(type, at.x, at.z, 4);
    T.step(2.2);
    const e = W.enemies.find((x) => !x.dead && x.type === type);
    if (!e) { out.push(type + ' missing'); continue; }
    Object.assign(e, { timer: 99, state: 'recover' });
    e.facing.set(1, 0, 1).normalize();
    e.model.root.rotation.y = FACE_CAMERA;
    T.step(0.3);
    const big = boss ? 1.6 : type === 'brute' ? 1.3 : 1;
    out.push(await shot('enemy-' + type, e.pos, { zoom: 2.4 / big, w: 120, h: 132, lift: 0.6 * big }));
  }
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  T.step(2);

  // a wide shot of each biome
  for (const [name, depth, kind] of [['cells', 1, 'combat'], ['crypt', 4, 'combat'], ['rot', 7, 'combat'], ['halls', 9, 'boss']]) {
    await visit(depth, kind);
    for (const e of W.enemies) { e.hp = 0; e.dead = true; }
    W.pendingSpawns = 0;
    T.step(2);
    W.player.pos.copy(W.room.center).add({ x: 1.2, y: 0, z: 1.2 });
    T.step(0.2);
    out.push(await shot('biome-' + name, W.room.center, { zoom: 1 }));
  }

  // the locked card: the Lock's gate, up close
  await visit(10, 'exit');
  const gate = W.room.doors.find((d) => d.kind === 'gate') ?? W.room.doors[0];
  W.player.pos.set(gate.pos.x + (gate.wall === 'x' ? 2.2 : 0), 0, gate.pos.z + (gate.wall === 'z' ? 2.2 : 0));
  T.step(0.2);
  out.push(await shot('card-locked', gate.pos.clone().add({ x: 0.6, y: 0, z: 0.6 }), { zoom: 2.2, w: 300, h: 220, lift: 0.9 }));

  // the Tutorial card: the training room and its dummy
  W.player.hp = 0; W.player.dead = true;
  T.step(2);
  await T.toPlayMenu();
  T.clickSel(3); // Tutorial
  await T.waitFor('play');
  for (let i = 0; i < 50 && !W.tutorial; i++) await T.sleep(100);
  T.step(1.2);
  const dummy = W.enemies.find((e) => e.type === 'dummy');
  if (dummy) {
    dummy.model.root.rotation.y = FACE_CAMERA;
    W.player.pos.set(dummy.pos.x + 1.4, 0, dummy.pos.z + 0.4);
    W.player.facing.set(-1, 0, -0.2).normalize();
    W.player.model.root.rotation.y = Math.atan2(W.player.facing.x, W.player.facing.z);
    T.step(0.2);
    out.push(await shot('card-tutorial', dummy.pos.clone().add({ x: 0.7, y: 0, z: 0.2 }), { zoom: 2, w: 300, h: 220, lift: 0.5 }));
  }
  return out;
}

// Rebuilds wiki/index.html from the codex: everything between <main> and </main> is regenerated, pictures from img/.
// Run on http://localhost:5173 after all(), then copy assets/shots/*.png to wiki/img/:
//   const S = await import('/test/shots.js'); await S.buildWiki();
export async function buildWiki() {
  const { MODES, CONTROLS, FEATS_WIKI, wikiPart } = await import('../src/codex.js');
  const { resetControls } = await import('../src/settings.js');
  resetControls(); // the wiki lists the default keys, not this browser's
  let page = await (await fetch('/wiki/index.html')).text();
  const slug = (t) => t.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  const entries = (part) => wikiPart(part, 'img/').replace(/<(\/?)h3>/g, '<$1h4>'); // entries sit under a part heading
  const nav = MODES.map((m) => `<a class="mode" href="#${m.id}">${m.name}</a>` + m.parts.map(([t]) => `<a href="#${m.id}-${slug(t)}">${t}</a>`).join(''))
    .join('') + '<a class="mode" href="#controls">Controls</a><a class="mode" href="#feats">Feats</a>';
  const main = MODES.map((m) => `<section id="${m.id}" class="mode">
    <div class="mode-head"><img src="img/${m.art}.png" alt="" width="300" height="220"><div><h2>${m.name}</h2><p>${m.intro}</p></div></div>
    ${m.parts.map(([t, part]) => `<div class="part" id="${m.id}-${slug(t)}"><h3>${t}</h3><div class="entries">${entries(part)}</div></div>`).join('\n    ')}
  </section>`).join('\n')
    + `\n<aside class="appendix" id="controls"><h3>Controls</h3><div class="entries">${entries(CONTROLS).replace('Change these in Settings.', 'These are the defaults. Change any of them in Settings.')}</div></aside>`
    + `\n<aside class="appendix" id="feats"><h3>Feats</h3><div class="entries">${entries(FEATS_WIKI)}</div></aside>`;
  const splice = (open, close, html) => { const a = page.indexOf(open) + open.length, b = page.indexOf(close, a); page = page.slice(0, a) + '\n' + html + '\n  ' + page.slice(b); };
  splice('<nav aria-label="Sections">', '</nav>', nav);
  splice('<main>', '</main>', main);
  const res = await fetch('/__wiki', { method: 'POST', body: page });
  return res.ok ? 'wiki rebuilt' : 'FAILED';
}

// The Wilds: a daytime wide shot for the codex and a night by the campfire for the Open World card.
// Run after all():  await S.wildShots();
export async function wildShots() {
  const out = [];
  await T.toPlayMenu();
  T.clickSel(1); // Open World
  T.press(0);
  await T.waitFor('play');
  W.player.maxHp = W.player.hp = 9999;
  W.run.xp = -1e9;
  const room = W.room, w = W.run.wild;
  // a forest edge by day
  const tree = room.nodes.find((n) => n.kind === 'tree' && Math.hypot(n.x - 80, n.z - 80) > 9 && Math.hypot(n.x - 80, n.z - 80) < 22);
  W.player.pos.copy(room.freeSpot(W.player.pos.clone().set(tree.x, 0, tree.z), 1.5, 3));
  w.clock = 0.25;
  T.step(0.2);
  out.push(await shot('biome-wilds', W.player.pos, { zoom: 1 }));
  // night by the fire, the dead closing in
  const spot = room.freeSpot(room.entry.clone().add({ x: 3, y: 0, z: 0 }), 0, 3);
  W.player.pos.copy(spot);
  W.player.facing.set(1, 0, 0.3).normalize();
  room.build('fire', spot.x + 1.3, spot.z + 0.4);
  w.clock = 0.6195;
  T.step(0.3);
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  T.step(2);
  for (const [dx, dz] of [[-3.2, -1.4], [-1.8, 2.6], [3.4, -2.6]]) spawnEnemy('zombie', spot.x + dx, spot.z + dz, 2);
  T.step(1.4);
  for (const e of W.enemies) { e.timer = 99; e.state = 'recover'; e.facing.subVectors(W.player.pos, e.pos).setY(0).normalize(); e.model.root.rotation.y = Math.atan2(e.facing.x, e.facing.z); }
  T.step(0.3);
  out.push(await shot('card-open', spot.clone().add({ x: 0.5, y: 0, z: 0.3 }), { zoom: 1.5, w: 300, h: 220, lift: 0.2 }));
  W.player.hp = 0; W.player.dead = true;
  T.step(3);
  T.press(0); // over -> title, then back to the Dungeon card so later runs are dungeon runs
  await T.waitFor('title');
  T.press(1);
  T.step(0.1);
  T.clickSel(0);
  return out;
}

// Adventure: the village by morning for the codex, and the fight at the castle gate at dusk for the Play card.
// Run after all():  await S.adventureShots();
export async function adventureShots() {
  const { meta } = await import('../src/run.js');
  const out = [];
  const open = async (i) => {
    meta.adventure = { chapter: i, coin: 0, iron: 0, edge: 0, reach: 0, mail: 0 };
    if (W.adventure && W.state === 'play') { W.player.hp = 0; W.player.dead = true; T.step(2); W.adventure.chapter = i; T.press(0); }
    else { await T.toPlayMenu(); T.clickSel(2); }
    for (let t = 0; t < 80 && W.state !== 'talk'; t++) { await T.sleep(100); T.step(0.02); }
    for (let k = 0; k < 20 && W.state === 'talk'; k++) { T.step(0.35); T.press(0); }
    W.player.maxHp = W.player.hp = 9999;
  };
  await open(0);
  const v = W.room.plan, [fx, fz] = [v.buildings[0].x, v.buildings[0].z];
  W.player.pos.set((fx + v.entry[0]) / 2, 0, (fz + v.entry[1]) / 2);
  T.step(0.2);
  out.push(await shot('biome-adventure', W.player.pos.clone().add({ x: -1.5, y: 0, z: -1.5 }), { zoom: 0.9 }));
  await open(2);
  const plan = W.room.plan, gate = plan.triggers[1];
  W.player.pos.set(gate.at[0] + 1.2, 0, gate.at[1] + 1.2);
  T.step(2.4);
  for (const e of W.enemies) { e.timer = 99; e.state = 'recover'; e.facing.subVectors(W.player.pos, e.pos).setY(0).normalize(); e.model.root.rotation.y = Math.atan2(e.facing.x, e.facing.z); }
  W.player.facing.set(-1, 0, -1).normalize();
  W.player.model.root.rotation.y = Math.atan2(-1, -1);
  T.step(0.3);
  out.push(await shot('card-adventure', W.player.pos.clone().add({ x: -1.6, y: 0, z: -1.6 }), { zoom: 1.05, w: 300, h: 220, lift: 0.4 }));
  // forget the chapters these shots visited, so the real save isn't left at chapter 3 (reload the page after this)
  const { saveMeta } = await import('../src/run.js');
  meta.adventure = null;
  saveMeta();
  return out;
}

// The Sunken Vaults' foes and rooms, and the Keep, for the codex and wiki.  Run:  await S.newShots();
export async function newShots() {
  const out = [];
  await T.toTitle();
  T.press(0);
  await T.waitFor('play');
  W.player.maxHp = W.player.hp = 9999;
  W.player.lives = 99;
  await visit(12);
  const k = W.room.center;
  for (const type of ['drowned', 'tidecaller', 'lurker', 'drownedking']) {
    for (const e of W.enemies) { e.hp = 0; e.dead = true; }
    T.step(2);
    const at = W.room.freeSpot(k, 0);
    W.player.pos.copy(W.room.freeSpot(at, 6));
    spawnEnemy(type, at.x, at.z, 12);
    T.step(2.2);
    const e = W.enemies.find((x) => !x.dead && x.type === type);
    if (!e) { out.push(type + ' missing'); continue; }
    Object.assign(e, { timer: 99, state: 'recover' });
    e.facing.set(1, 0, 1).normalize();
    e.model.root.rotation.y = FACE_CAMERA;
    T.step(0.3);
    const big = type === 'drownedking' ? 2.1 : 1;
    out.push(await shot('enemy-' + type, e.pos, { zoom: 2.4 / big, w: 120, h: 132, lift: 0.6 * big }));
  }
  for (const [name, depth, kind] of [['vaults', 12, 'combat'], ['throne', 19, 'boss']]) {
    await visit(depth, kind);
    for (const e of W.enemies) { e.hp = 0; e.dead = true; }
    W.pendingSpawns = 0;
    T.step(2);
    W.player.pos.copy(W.room.center).add({ x: 1.2, y: 0, z: 1.2 });
    T.step(0.2);
    out.push(await shot('biome-' + name, W.room.center, { zoom: 1 }));
  }
  // the Keep, where a run ends: Maren and Rattle by the torches
  W.player.lives = 0;
  W.player.hp = 0; W.player.dead = true;
  T.step(3);
  T.press(0);
  for (let i = 0; i < 60 && !(W.state === 'play' && W.room?.plan.kind === 'keep'); i++) { await T.sleep(100); T.step(0.02); }
  W.player.pos.copy(W.room.keep.people[0].pos).add({ x: 1.4, y: 0, z: 0.6 });
  T.step(0.3);
  out.push(await shot('biome-keep', W.room.center, { zoom: 1.1 }));
  return out;
}

// Portraits for classes added later (the Barbarian and the Necromancer).  Run:  await S.classShots();
export async function classShots(ids = ['barbarian', 'necromancer']) {
  const out = [];
  await T.toTitle();
  T.press(0);
  await T.waitFor('play');
  W.player.maxHp = W.player.hp = 9999;
  const c = W.room.center;
  for (const e of W.enemies) { e.hp = 0; e.dead = true; }
  T.step(1);
  for (const id of ids) {
    swap(id);
    W.player.pos.copy(c);
    W.player.model.root.rotation.y = FACE_CAMERA;
    W.player.model.anim.loop('idle');
    W.player.model.anim.update(0.4);
    out.push(await shot('class-' + id, c, { zoom: 2.6, w: 120, h: 132 }));
  }
  W.player.hp = 0; W.player.dead = true;
  T.step(3);
  return out;
}
