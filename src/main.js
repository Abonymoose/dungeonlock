import { C } from './config.js';
import { world } from './world.js';
import { renderer, scene, updateCamera, updateLights, draw, GROUND_UP, GROUND_RIGHT } from './render.js';
import { loadAssets } from './assets.js';
import { pollInput, pressed, btn, rumble, input, keyName, padName } from './input.js';
import { settings, saveSettings, resetControls, ACTIONS } from './settings.js';
import { startTutorial, updateTutorial } from './tutorial.js';
import { TABS, codexBody } from './codex.js';
import { CLASSES, CAST, createPlayer, updatePlayer } from './classes.js';
import { spawnEnemy, updateEnemies, bossOf, TYPES } from './enemies.js';
import { updateCombat, clearCombat, heal, floatText } from './combat.js';
import { buildRoom } from './room.js';
import { makePlan, rollDoors, rollPerks, xpToNext, meta, saveMeta, UPGRADES } from './run.js';
import { PATRONS, RARITY, SLOT_NAME, BOONS, offerBoons, takeBoon, describe, value, slotIcons } from './boons.js';
import { disposeObject } from './models.js';
import * as ui from './ui.js';
import { sfx, applyVolume } from './audio.js';
import { exportSave, importSave } from './save.js';
import { makeWild, buildWild, wildUpdate, RECIPES, canCraft, craft, costText } from './wild.js';
import { CHAPTERS, ENDING, FORGE, chapterPlan, adventureUpdate, canForge, forgeCost, forge, applyForge, newAdventure } from './adventure.js';
import { makePrincess } from './models.js';
import { updateTouch } from './touch.js';

const CLASS_IDS = Object.keys(CLASSES);
let hadPad = false;
const menu = { home: 0, play: 0, cls: 0, anvil: 0, boon: 0, choice: null, pause: 0, set: 0, tab: 0, over: 0, click: false };
const BANNERS = {
  start: ['DUNGEONLOCK', 'Not everything unlocks.'],
  tutorial: ['TUTORIAL', "Learn the basics. You can't lose here."],
  elite: ['ELITE', 'Something heavy stirs.'],
  vault: ['VAULT', 'Your key bought this.'],
  fountain: ['FOUNTAIN', 'Drink, and go on.'],
  exit: ['THE LOCK', 'One key, one way out. Or go deeper.'],
  wild: ['THE WILDS', 'Gather by day. Survive the night.'],
};
const REWARD_NAME = { boon: 'Boon', ash: 'Ash', key: 'Key', heal: 'Healing', pom: 'Keystone' };

// ---- world setup ----

function resetWorld() {
  clearCombat();
  for (const e of world.enemies) disposeObject(e.model.root);
  world.enemies.length = 0;
  world.room?.dispose();
  world.room = null;
  Object.assign(world, { pendingSpawns: 0, waveDelay: 0, hitstop: 0 });
}

function newPlayer() {
  if (world.player) disposeObject(world.player.model.root);
  world.player = createPlayer(CLASS_IDS[menu.cls], anvil());
}

// Every menu sits over the same torchlit backdrop room with the chosen class standing in it
async function enterMenu(state) {
  world.state = 'transition';
  await ui.fadeTo(true);
  resetWorld();
  ui.showHud(false);
  ui.setPrompt(null);
  world.room = buildRoom(makePlan(0, 'start'), []);
  world.adventure = null;
  newPlayer();
  show(state);
  await ui.fadeTo(false);
}

// Hardcore leaves the Anvil's help at home (Greed still pays out)
const NO_UPGRADES = { vitality: 0, whetstone: 0, lastbreath: 0, shards: 0, quickstep: 0, favor: 0, insight: 0, sparekey: 0 };
const anvil = () => (settings.hardcore ? NO_UPGRADES : meta);

function startRun() {
  world.run = { depth: 0, keys: anvil().sparekey ? 1 : 0, ash: 0, kills: 0, boons: [], keyDoorsSeen: 0, xp: 0, level: 1, pendingLevels: 0, rerolls: anvil().insight };
  ui.hideScreen();
  newPlayer();
  world.player.lives = anvil().lastbreath;
  ui.setSlots([]);
  enterRoom(menu.mode === 'open' ? makeWild() : makePlan(0, 'start'));
}

async function enterRoom(plan) {
  world.state = 'transition';
  ui.setPrompt(null);
  if (plan.depth > 0) sfx('door');
  await ui.fadeTo(true);
  resetWorld();
  world.run.depth = plan.depth;
  const room = world.room = plan.kind === 'wild' || plan.kind === 'field' ? buildWild(plan) : buildRoom(plan, plan.doorPlans ?? rollDoors(plan.depth, world.run));
  const p = world.player;
  // enter from the bottom corner of the screen, facing up into the room
  p.pos.copy(room.entry);
  p.vel.set(0, 0, 0); p.knock.set(0, 0, 0);
  p.facing.copy(GROUND_UP);
  p.model.root.rotation.y = Math.atan2(GROUND_UP.x, GROUND_UP.z);
  p.dashT = 0; p.charge = null;
  p.ammo = p.maxAmmo;
  updateCamera(0, p.pos.clone().lerp(room.center, 0.2), true);

  if (!plan.waves.length) room.cleared = true;
  if (plan.kind === 'vault') { room.addPickup('boon', room.center.x - 1.2, room.center.z, plan.patron); room.addPickup('heal', room.center.x + 1.2, room.center.z); }
  if (['start', 'fountain', 'exit', 'vault'].includes(plan.kind)) room.openDoors();
  world.waveDelay = plan.waves.length ? 0.9 : 0;

  const reward = plan.patron ? `${PATRONS[plan.patron].name}'s Boon` : REWARD_NAME[plan.reward];
  // entering a new biome names it, the way Hades names each region
  const fresh = world.run.biome !== plan.biome.name;
  world.run.biome = plan.biome.name;
  const boss = plan.kind === 'boss' && TYPES[plan.waves[0][0]];
  const [title, sub] = plan.banner ?? (boss ? [boss.name.toUpperCase(), boss.title + '.'] : null) ?? BANNERS[plan.kind] ?? (fresh && plan.depth > 0 ? [plan.biome.name.toUpperCase(), `Depth ${plan.depth}`] : [`DEPTH ${plan.depth}`, reward ? `Reward: ${reward}` : '']);
  ui.showBanner(title, sub);
  ui.showHud(true);
  world.state = 'play';
  await ui.fadeTo(false);
}

function endRun(kind) {
  if (world.tutorial) return leaveTutorial(false); // the tutorial never banks or counts as a run
  if (world.adventure) return adventureEnded(kind);
  const run = world.run, ash = Math.round((run.ash + (kind === 'escaped' ? 60 : 0)) * (1 + 0.15 * meta.greed));
  meta.ash += ash;
  meta.runs++;
  if (kind === 'escaped') meta.escapes++;
  const wild = world.room?.plan.kind === 'wild';
  if (wild) meta.bestNights = Math.max(meta.bestNights ?? 0, run.depth); // in the Wilds, depth counts nights survived
  else meta.bestDepth = Math.max(meta.bestDepth, run.depth);
  saveMeta();
  world.state = 'over';
  ui.setPrompt(null);
  ui.showHud(false);
  ui.overScreen({ kind, className: world.player.cls.name, depth: run.depth, kills: run.kills, ash, wild });
}

// ---- room flow ----

function spawnWave() {
  const room = world.room, p = world.player, types = room.plan.waves[room.waveIndex++];
  for (const type of types) {
    if (TYPES[type].boss) { spawnEnemy(type, room.center.x - 2, room.center.z - 2, room.plan.depth); continue; }
    const { x, z } = room.freeSpot(p.pos, 4.5);
    const eliteOdds = room.plan.kind === 'elite' ? 0.35 : Math.min(0.5, Math.max(0, room.plan.depth - 4) * 0.03 + (settings.hardcore ? 0.15 : 0));
    spawnEnemy(type, x, z, room.plan.depth, type !== 'brute' && Math.random() < eliteOdds);
  }
}

function clearRoom() {
  const room = world.room, kind = room.plan.kind;
  room.cleared = true;
  world.slowmo = 0.8; // the last kill lands in slow motion
  ui.showBanner(kind === 'boss' ? TYPES[room.plan.waves[0][0]].name.toUpperCase() + ' FALLS' : 'CLEARED', '', 1400);
  rumble(0.3, 0.3, 120);
  // shards come home when the fight ends, like Hades' bloodstones
  for (const k of room.pickups.filter((k) => k.type === 'shard')) disposeObject(k.obj);
  room.pickups = room.pickups.filter((k) => k.type !== 'shard');
  world.player.ammo = world.player.maxAmmo;
  if (world.adventure && kind === 'boss') return rescue();
  const reward = kind === 'boss' ? 'bigash' : room.plan.reward;
  const [dx, dz] = room.plan.drop ?? [room.center.x, room.center.z]; // a centre pillar moves the drop in front of it
  if (reward) room.addPickup(reward, dx, dz, room.plan.patron);
  else room.openDoors();
}

function collect(k) {
  const p = world.player, run = world.run, type = k.type;
  sfx('pickup');
  if (type === 'shard') { p.ammo = Math.min(p.maxAmmo, p.ammo + 1); return; }
  if (type === 'key') { run.keys++; floatText(p.pos, '+1 KEY', 'crit'); }
  else if (type === 'heal') heal(p, p.maxHp * 0.35);
  else if (type === 'ash' || type === 'bigash') {
    const n = type === 'bigash' ? 40 : 10 + run.depth * 2;
    run.ash += n;
    floatText(p.pos, `+${n} ash`, 'ash');
  } else if (type === 'boon') return openBoon(k.patron ?? Object.keys(PATRONS)[Math.floor(Math.random() * 4)]);
  else if (type === 'pom') return openKeystone();
  world.room.openDoors();
}

// ---- choices: patron boons, Keystones, level-up perks all share one pick-one-of-three state ----

function openChoice(choice) {
  Object.assign(menu, { choice, boon: 0, boonDelay: 0.4 }); // the delay stops a dash-mashed A taking the first card
  world.state = 'choice';
  ui.setPrompt(null);
  renderChoice();
}

function renderChoice() {
  const c = menu.choice, rerolls = world.run.rerolls;
  const hints = `<span>${btn('confirm')}TAKE</span>` + (c.reroll && rerolls > 0 ? `<span>${btn('alt')}REROLL (${rerolls})</span>` : '') + (c.cancel ? `<span>${btn('back')}CLOSE</span>` : '');
  ui.choiceScreen(c.header, c.items.map(c.toCard), menu.boon, hints);
}

function boonCard(p, b) {
  const def = BOONS[b.id], r = RARITY.find((x) => x.id === b.rarity), pat = PATRONS[def.patron ?? def.duo[0]];
  const holder = def.slot && p.boons.find((x) => BOONS[x.id].slot === def.slot && x.id !== b.id);
  return {
    kind: def.slot ? SLOT_NAME[def.slot].toUpperCase() : def.duo ? 'DUO' : def.legendary ? 'LEGENDARY' : 'PASSIVE',
    name: def.name, rarity: r.name, rarityCss: r.css, css: def.duo ? r.css : pat.css, desc: describe(b),
    note: holder ? `Replaces ${BOONS[holder.id].name}` : def.duo ? `${PATRONS[def.duo[0]].name} + ${PATRONS[def.duo[1]].name}` : '',
  };
}

function openBoon(pid) {
  const p = world.player, pat = PATRONS[pid];
  openChoice({
    header: { name: pat.name, title: pat.title, css: pat.css },
    items: offerBoons(pid, p, anvil()),
    toCard: (b) => boonCard(p, b),
    reroll: () => offerBoons(pid, p, anvil()),
    onPick: (b) => {
      takeBoon(p, b);
      world.run.boons.push(b.id);
      ui.setSlots(slotIcons(p));
      ui.showBanner(BOONS[b.id].name.toUpperCase(), describe(b), 1500);
      world.room.openDoors();
    },
  });
}

// Keystone (Hades' Pom of Power): level up one of up to three boons you carry
function openKeystone() {
  const p = world.player;
  if (!p.boons.length) {
    world.run.ash += 25;
    floatText(p.pos, '+25 ash', 'ash');
    return world.room.openDoors();
  }
  openChoice({
    header: { name: 'Keystone', title: 'Strengthen a boon you carry', css: '#E7D6BC' },
    items: [...p.boons].sort(() => Math.random() - 0.5).slice(0, 3),
    toCard: (b) => ({ ...boonCard(p, { ...b, level: b.level + 1 }), note: `LV ${b.level} &rarr; ${b.level + 1}` }),
    onPick: (b) => {
      const before = value(b);
      b.level++;
      BOONS[b.id].onTake?.(p, value(b) - before); // stat boons grant the difference
      ui.setSlots(slotIcons(p));
      ui.showBanner(BOONS[b.id].name.toUpperCase(), describe(b), 1500);
      world.room.openDoors();
    },
  });
}

// Crafting in the Wilds: the same pick-a-card screen, showing what each thing costs; Back closes it
function openCraft() {
  openChoice({
    header: { name: 'Crafting', title: 'Spend what you gathered', css: '#D4C5AC' },
    items: RECIPES, cancel: true, canPick: canCraft,
    toCard: (r) => ({ kind: 'CRAFT', name: r.name, desc: r.desc, note: canCraft(r) ? costText(r) : `Needs ${costText(r)}`, css: canCraft(r) ? '#D4C5AC' : '#6E2323' }),
    onPick: craft,
  });
}

function openPerks() {
  const run = world.run, p = world.player;
  openChoice({
    header: { name: `Level ${run.level - run.pendingLevels + 1}`, title: 'You grow stronger', css: '#D4C5AC' },
    items: rollPerks(),
    toCard: (k) => ({ kind: 'PERK', name: k.name, desc: k.desc, css: '#D4C5AC' }),
    onPick: (k) => {
      k.apply(p);
      run.pendingLevels--;
      if (run.pendingLevels > 0) openPerks();
    },
  });
}

function roomLogic(dt) {
  const room = world.room, run = world.run, p = world.player;
  if (!room.cleared) {
    if (world.waveDelay > 0) {
      world.waveDelay -= dt;
      if (world.waveDelay <= 0) spawnWave();
    } else if (world.pendingSpawns === 0 && !world.enemies.some((e) => !e.dead)) {
      if (room.waveIndex < room.plan.waves.length) world.waveDelay = 0.7;
      else clearRoom();
    }
  }
  let wildPrompt = null;
  if (world.adventure) run.label = `CHAPTER ${world.adventure.chapter + 1}<br>${world.adventure.iron} IRON`;
  if (room.plan.kind === 'field') {
    const f = adventureUpdate(room);
    if (f.exit) return finishChapter();
    wildPrompt = f.prompt;
  }
  if (room.plan.kind === 'wild') {
    const w = wildUpdate(dt);
    wildPrompt = w.prompt;
    if (w.dawn) {
      ui.showBanner('DAWN', `You lived through night ${run.wild.nights}. Take a gift.`, 1800);
      return openBoon(Object.keys(PATRONS)[Math.floor(Math.random() * 4)]);
    }
    if (pressed('craft')) return openCraft();
  }
  // level-ups wait until nothing is left alive (the open world is never 'cleared' room by room)
  if (room.cleared && run.pendingLevels > 0 && !world.pendingSpawns && !world.enemies.some((e) => !e.dead)) return openPerks();

  for (let i = room.pickups.length - 1; i >= 0; i--) {
    const k = room.pickups[i];
    if (Math.hypot(k.obj.position.x - p.pos.x, k.obj.position.z - p.pos.z) > 0.8) continue;
    room.pickups.splice(i, 1);
    disposeObject(k.obj);
    collect(k);
    if (world.state !== 'play') return;
  }

  let prompt = wildPrompt;
  const door = room.cleared && !room.pickups.some((k) => k.type !== 'shard') ? room.doorNear(p.pos) : null;
  if (door?.kind === 'gate') {
    prompt = run.keys ? `${btn('interact')}UNLOCK THE GATE` : `<span class="dim">NO KEY FOR THE LOCK.</span> ${btn('interact')}ACCEPT YOUR FATE`;
    if (pressed('interact')) {
      const escaped = run.keys > 0;
      if (escaped) { run.keys--; room.unlock(door); }
      return endRun(escaped ? 'escaped' : 'trapped');
    }
  } else if (door?.locked) {
    prompt = run.keys ? `${btn('interact')}UNLOCK (1 KEY)` : '<span class="dim">LOCKED. NEEDS A KEY.</span>';
    if (pressed('interact') && run.keys) { run.keys--; room.unlock(door); }
  } else if (door?.open && door.pos.distanceTo(p.pos) < 0.8) {
    return door.kind === 'home' ? leaveTutorial(true) : door.kind === 'adv' ? finishChapter() : enterRoom(makePlan(run.depth + 1, door.kind, door.reward, door.patron));
  }

  const f = room.fountain;
  if (f && !f.used && p.pos.distanceTo(f.pos) < 2.2) {
    prompt = `${btn('interact')}DRINK`;
    if (pressed('interact')) {
      f.used = true;
      heal(p, p.maxHp * 0.5);
      f.water.material.color.setHex(C.ONYX);
      sfx('pickup');
    }
  }
  ui.setPrompt(prompt);
}

// ---- menus ----

const WIKI_URL = 'https://dungeonwiki.pages.dev';
const ACTION_NAME = { attack: 'Attack', special: 'Special', cast: 'Cast', dash: 'Dash', interact: 'Use', pause: 'Pause' };

// which menu index each screen moves, so the mouse can drive it too
const SEL_KEY = { home: 'home', playmenu: 'play', title: 'cls', anvil: 'anvil', choice: 'boon', pause: 'pause', settings: 'set', over: 'over' };
const RENDER = {
  home: () => ui.homeScreen(menu.home, meta),
  playmenu: () => ui.playScreen(menu.play, meta),
  title: () => ui.titleScreen(CLASSES, menu.cls, meta, CAST),
  anvil: () => ui.anvilScreen(UPGRADES, menu.anvil, meta),
  settings: () => ui.settingsScreen(settingRows(), menu.set, !!input.capture),
  codex: () => ui.codexScreen(TABS, menu.tab, codexBody(menu.tab)),
  pause: () => ui.pauseScreen(menu.pause, world.player.cls, CAST, world.tutorial ? 'Leave the tutorial' : world.adventure ? 'Leave (your chapter is saved)' : 'Abandon run'),
  choice: () => renderChoice(),
};
function show(state) {
  world.state = state;
  heroes(state === 'home');
  RENDER[state]?.();
}

// On the home screen all three heroes stand together in the torchlight
let extras = [];
function heroes(on) {
  for (const m of extras) disposeObject(m.root);
  extras = [];
  if (!on || !world.player) return;
  world.player.model.root.rotation.y = Math.PI / 4;
  CLASS_IDS.filter((_, i) => i !== menu.cls).forEach((id, k) => {
    const m = CLASSES[id].model();
    m.root.position.copy(world.player.pos).addScaledVector(GROUND_RIGHT, k ? 1.3 : -1.3).addScaledVector(GROUND_UP, 0.7);
    m.root.rotation.y = Math.PI / 4 + (k ? -0.5 : 0.5);
    m.anim.loop('idle');
    m.anim.update(Math.random());
    scene.add(m.root);
    extras.push(m);
  });
}

// A click on a menu item selects it and counts as pressing confirm this frame
const confirmed = () => pressed('confirm') || (menu.click && !(menu.click = false));
function navigate(key, n, horizontal = false) {
  const back = horizontal ? 'left' : 'up', fwd = horizontal ? 'right' : 'down';
  if (!pressed(back) && !pressed(fwd)) return false;
  menu[key] = (menu[key] + (pressed(fwd) ? 1 : n - 1)) % n;
  if (key === 'cls') newPlayer();
  sfx('menu');
  return true;
}

const screenEl = document.getElementById('screen');
screenEl.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-sel]'), key = SEL_KEY[world.state];
  if (!el || !key || menu[key] === +el.dataset.sel || input.capture) return;
  menu[key] = +el.dataset.sel;
  if (key === 'cls') newPlayer();
  RENDER[world.state]?.();
});
screenEl.addEventListener('click', (e) => {
  if (performance.now() - (input.lastCapture ?? 0) < 400) return; // that click just finished a rebind
  const tab = e.target.closest('[data-tab]');
  if (tab && world.state === 'codex') { menu.tab = +tab.dataset.tab; return RENDER.codex(); }
  const el = e.target.closest('[data-sel]'), key = SEL_KEY[world.state];
  if (!el || !key) return;
  menu[key] = +el.dataset.sel;
  menu.click = true;
});

// ---- settings rows ----

const pct = (v) => `<span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span>${Math.round(v * 100)}%`;
const onoff = (b) => (b ? 'On' : 'Off');
function settingRows() {
  return [
    { group: 'Sound', name: 'Master volume', key: 'master', kind: 'slider' },
    { name: 'Music', key: 'music', kind: 'slider' },
    { name: 'Effects', key: 'sfx', kind: 'slider' },
    { name: 'Mute everything', key: 'muted', kind: 'toggle' },
    { group: 'Feel', name: 'Screen shake', key: 'shake', kind: 'toggle' },
    { name: 'Controller rumble', key: 'rumble', kind: 'toggle' },
    { name: 'Damage numbers', key: 'numbers', kind: 'toggle' },
    { name: 'Fullscreen', kind: 'fullscreen' },
    { group: 'Challenge', name: 'Hardcore', key: 'hardcore', kind: 'toggle', note: 'Enemies have 50% more health and hit 50% harder, elites are more common, and Anvil upgrades are off. Starts with your next run.' },
    ...(input.touch ? [] : [
      ...ACTIONS.map((a, i) => ({ group: i ? null : 'Controls', name: ACTION_NAME[a], action: a, kind: 'bind', note: i ? '' : 'Select a move, then press the new key, mouse button or controller button.' })),
      { name: 'Reset controls', kind: 'reset' },
    ]),
    { group: 'Save', name: 'Export save file', kind: 'export', note: 'Download your progress, upgrades and settings as a file.' },
    { name: 'Import save file', kind: 'import', note: 'Load a save file. It replaces what is here.' },
  ].map((r) => ({ ...r, value: valueOf(r) }));
}
function valueOf(r) {
  if (r.kind === 'slider') return pct(settings[r.key]);
  if (r.kind === 'toggle') return onoff(settings[r.key]);
  if (r.kind === 'fullscreen') return onoff(!!document.fullscreenElement);
  if (r.kind === 'bind') return `${settings.keys[r.action].map(keyName).join(' / ')}<span class="pad">${padName(settings.pad[r.action])}</span>`;
  return '';
}
function adjust(r, d) {
  if (r.kind === 'slider') settings[r.key] = Math.round(Math.min(1, Math.max(0, settings[r.key] + d * 0.1)) * 10) / 10;
  else if (r.kind === 'toggle') settings[r.key] = !settings[r.key];
  else return;
  applyVolume();
  saveSettings();
  sfx('menu');
  RENDER.settings();
}
// One key or button per move. Taking another move's key swaps the two, so no move is left unbound.
function rebind(action, b) {
  if (b.kind === 'key') {
    const old = settings.keys[action][0];
    for (const a of ACTIONS) {
      if (a === action || !settings.keys[a].includes(b.code)) continue;
      settings.keys[a] = settings.keys[a].filter((c) => c !== b.code);
      if (!settings.keys[a].length) settings.keys[a] = [old];
    }
    settings.keys[action] = [b.code];
  } else if (b.kind === 'pad') {
    const other = ACTIONS.find((a) => a !== action && settings.pad[a] === b.index);
    if (other) settings.pad[other] = settings.pad[action];
    settings.pad[action] = b.index;
  }
  saveSettings();
}
function activate(r) {
  if (r.kind === 'slider') return settings[r.key] >= 1 ? adjust(r, -10) : adjust(r, 1);
  if (r.kind === 'toggle') return adjust(r, 1);
  if (r.kind === 'fullscreen') {
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())?.catch?.(() => {});
    return setTimeout(() => world.state === 'settings' && RENDER.settings(), 300);
  }
  if (r.kind === 'reset') { resetControls(); sfx('unlock'); return RENDER.settings(); }
  if (r.kind === 'export') { exportSave(); sfx('unlock'); return ui.showBanner('SAVE EXPORTED', 'Look in your downloads folder.', 1800); }
  // the game reads its save when it starts, so a loaded save takes effect on a fresh start
  if (r.kind === 'import') return importSave((err) => (err ? ui.showBanner('NOT LOADED', err, 2400) : location.reload()));
  if (r.kind === 'bind') {
    input.capture = (b) => { input.lastCapture = performance.now(); if (b.kind !== 'cancel') rebind(r.action, b); RENDER.settings(); };
    RENDER.settings();
  }
}

// ---- adventure: The Swordsmith ----

// Starts (or resumes) the story at the chapter you last reached; every chapter start is a checkpoint
function startAdventure() {
  const a = world.adventure = { ...(meta.adventure ?? newAdventure()) };
  world.run = { depth: 0, keys: 0, ash: a.coin, kills: 0, boons: [], keyDoorsSeen: 0, xp: 0, level: 1, pendingLevels: 0, rerolls: 0, currency: 'COIN', noXp: true };
  ui.hideScreen();
  if (world.player) disposeObject(world.player.model.root);
  world.player = createPlayer('smith', meta);
  world.player.lives = 0;
  ui.setSlots([]);
  enterChapter();
}

async function enterChapter() {
  const a = world.adventure, p = world.player;
  meta.adventure = { chapter: a.chapter, coin: a.coin, iron: a.iron, edge: a.edge, reach: a.reach, mail: a.mail };
  saveMeta();
  world.run.ash = a.coin;
  applyForge(p, a);
  p.hp = p.maxHp; // a night's rest between chapters
  await enterRoom(chapterPlan(a.chapter));
  talk(CHAPTERS[a.chapter].lines);
}

// The way on: spend at your forge, then the next chapter
function finishChapter() {
  const a = world.adventure;
  a.coin = world.run.ash;
  a.chapter++;
  ui.setPrompt(null);
  openForge();
}

function openForge() {
  const a = world.adventure;
  world.run.ash = a.coin;
  openChoice({
    header: { name: 'Your Forge', title: `${a.coin} coin and ${a.iron} iron to spend before you go on`, css: '#D4C5AC' },
    items: [...FORGE, { id: 'go', name: 'Set out', desc: `On to Chapter ${a.chapter + 1}: ${CHAPTERS[a.chapter].title}.` }],
    canPick: (f) => f.id === 'go' || canForge(a, f),
    toCard: (f) => f.id === 'go' ? { kind: 'ONWARD', name: f.name, desc: f.desc, css: '#E7D6BC' }
      : { kind: `LEVEL ${a[f.id]}/3`, name: f.name, desc: f.desc, note: canForge(a, f) ? forgeCost(a, f) : `Needs ${forgeCost(a, f)}`, css: canForge(a, f) ? '#D4C5AC' : '#6E2323' },
    onPick: (f) => {
      if (f.id === 'go') return enterChapter();
      forge(a, f);
      sfx('slam');
      openForge();
    },
  });
}

// The Black Knight is down: the princess, the last words, and home
function rescue() {
  const room = world.room, p = world.player, princess = makePrincess();
  princess.root.position.copy(room.freeSpot(p.pos, 1.4, 3)); // near you, and never inside a centre pillar
  princess.root.rotation.y = Math.atan2(p.pos.x - princess.root.position.x, p.pos.z - princess.root.position.z);
  princess.anim.loop('idle');
  scene.add(princess.root);
  room.extras = [princess];
  setTimeout(() => talk(ENDING, () => {
    meta.adventureDone = true;
    meta.adventure = null;
    saveMeta();
    disposeObject(princess.root);
    enterMenu('playmenu').then(() => ui.showBanner('THE END', 'The princess is home, and the smith goes back to the forge.', 4000));
  }), 1600);
}

// Falling sends you back to the start of the chapter; leaving keeps your checkpoint
function adventureEnded(kind) {
  if (kind === 'abandoned') return enterMenu('playmenu');
  world.adventure = { ...meta.adventure };
  world.state = 'over';
  ui.setPrompt(null);
  ui.showHud(false);
  ui.overScreen({ kind: 'dead', adventure: CHAPTERS[world.adventure.chapter].title, className: 'Swordsmith', depth: world.adventure.chapter + 1, kills: world.run.kills, ash: 0 });
}

// Story lines, one at a time; the fight waits while people talk
let talking = null;
function talk(lines, then = null) {
  if (!lines?.length) return then?.();
  talking = { lines, i: 0, then, delay: 0.3 };
  world.state = 'talk';
  ui.setPrompt(null);
  ui.dialogue(lines[0]);
}

// ---- tutorial ----

async function beginTutorial() {
  world.run = { depth: 0, keys: 0, ash: 0, kills: 0, boons: [], keyDoorsSeen: 0, xp: 0, level: 1, pendingLevels: 0, rerolls: 0 };
  ui.hideScreen();
  newPlayer();
  ui.setSlots([]);
  const plan = makePlan(0, 'tutorial');
  plan.doorPlans = [{ kind: 'home', reward: null }];
  await enterRoom(plan);
  startTutorial();
}

function leaveTutorial(done) {
  world.tutorial = null;
  ui.tutorialPanel(null);
  if (done) { meta.tutorialDone = true; saveMeta(); }
  enterMenu('playmenu').then(() => done && ui.showBanner('TUTORIAL COMPLETE', 'The dungeon is waiting.', 2200));
}

// ---- states ----

const STATES = {
  transition() {},

  talk(dt) {
    world.room?.extras?.forEach((m) => m.anim.update(dt));
    if ((talking.delay -= dt) > 0) return;
    if (!confirmed() && !pressed('attack')) return;
    talking.delay = 0.2;
    if (++talking.i < talking.lines.length) return ui.dialogue(talking.lines[talking.i]);
    ui.dialogue(null);
    world.state = 'play';
    const then = talking.then;
    talking = null;
    then?.();
  },

  home() {
    if (navigate('home', 3)) return RENDER.home();
    if (confirmed()) { sfx('menu'); show(['playmenu', 'settings', 'codex'][menu.home]); menu.settingsFrom = 'home'; }
  },

  playmenu() {
    if (navigate('play', 4, true)) return RENDER.playmenu();
    if (pressed('back')) return show('home');
    if (!confirmed()) return;
    if (menu.play === 1) return beginTutorial();
    if (menu.play === 3) return startAdventure();
    menu.mode = menu.play === 2 ? 'open' : 'dungeon';
    show('title');
  },

  title(dt) {
    world.player.model.root.rotation.y += dt * 0.8;
    if (navigate('cls', CLASS_IDS.length, true)) return RENDER.title();
    if (pressed('alt')) return show('anvil');
    if (pressed('back')) return show('playmenu');
    if (confirmed()) startRun();
  },

  anvil() {
    if (navigate('anvil', UPGRADES.length)) return RENDER.anvil();
    if (pressed('back') || pressed('alt')) return show('title');
    if (!confirmed()) return;
    const u = UPGRADES[menu.anvil], lvl = meta[u.id];
    if (lvl < u.max && meta.ash >= u.cost(lvl)) { meta.ash -= u.cost(lvl); meta[u.id]++; saveMeta(); sfx('unlock'); }
    RENDER.anvil();
  },

  settings() {
    if (input.capture) return; // waiting for the new key
    const rows = settingRows();
    if (navigate('set', rows.length)) return RENDER.settings();
    if (pressed('back')) { saveSettings(); return show(menu.settingsFrom ?? 'home'); }
    if (pressed('left') || pressed('right')) adjust(rows[menu.set], pressed('right') ? 1 : -1);
    else if (confirmed()) activate(rows[menu.set]);
  },

  codex() {
    if (navigate('tab', TABS.length, true)) return RENDER.codex();
    if (pressed('up') || pressed('down')) ui.scrollCodex(pressed('down') ? 60 : -60);
    if (pressed('alt')) window.open(WIKI_URL, '_blank', 'noopener');
    if (pressed('back')) show('home');
  },

  play(dt) {
    const p = world.player;
    // hit-stop: freeze the action for a few frames on impact
    if (world.hitstop > 0) { world.hitstop -= dt; return; }
    // pause if the controller drops out mid-fight
    const padLost = hadPad && !input.pad;
    hadPad = !!input.pad;
    if ((pressed('pause') || padLost) && !p.dead) {
      menu.pause = 0;
      ui.setPrompt(null);
      return show('pause');
    }
    world.slowmo = Math.max(0, (world.slowmo ?? 0) - dt);
    const gdt = p.dead ? dt * 0.35 : world.slowmo > 0 ? dt * 0.3 : dt;
    world.time += gdt;
    updatePlayer(p, gdt);
    updateEnemies(gdt);
    updateCombat(gdt);
    world.room.update(gdt);
    ui.updateHud(p, world.run, xpToNext(world.run.level));
    ui.updateEnemyBars(world.enemies);
    if (p.dead) {
      ui.setPrompt(null);
      if (p.deathT > 0.6) endRun('dead');
      return;
    }
    roomLogic(gdt);
    ui.updateBoss(bossOf(world.enemies));
    if (world.tutorial && world.state === 'play') ui.tutorialPanel(updateTutorial(gdt));
  },

  choice(dt) {
    if ((menu.boonDelay -= dt) > 0) { menu.click = false; return; }
    const c = menu.choice, n = c.items.length;
    if (navigate('boon', n, true) || navigate('boon', n)) return renderChoice();
    if (c.cancel && (pressed('back') || pressed('craft'))) { ui.hideScreen(); world.state = 'play'; return; }
    if (pressed('alt') && c.reroll && world.run.rerolls > 0) {
      world.run.rerolls--;
      c.items = c.reroll();
      menu.boon = 0;
      sfx('unlock');
      renderChoice();
    } else if (confirmed()) {
      const item = c.items[menu.boon];
      if (c.canPick && !c.canPick(item)) { sfx('menu'); world.shake = 0.1; return; }
      ui.hideScreen();
      world.state = 'play';
      c.onPick(item); // may open the next choice (perks chain)
    }
  },

  pause() {
    if (navigate('pause', 3)) return RENDER.pause();
    if (pressed('pause') || pressed('back')) { ui.hideScreen(); world.state = 'play'; return; }
    if (!confirmed()) return;
    if (menu.pause === 0) { ui.hideScreen(); world.state = 'play'; }
    else if (menu.pause === 1) endRun('abandoned');
    else { menu.settingsFrom = 'pause'; menu.set = 0; show('settings'); }
  },

  over() {
    if (!confirmed()) return;
    if (world.adventure) return startAdventure(); // back to the start of the chapter you fell in
    enterMenu('title');
  },
};

// One simulation step. Exported so tests can step the game at a fixed rate.
export function frame(dt) {
  // skip polling during hit-stop so presses made in those frames still count afterwards
  if (!(world.state === 'play' && world.hitstop > 0)) pollInput();
  STATES[world.state](dt);
  menu.click = false;
  updateTouch(world);
  // menu backdrops: keep the heroes breathing
  if (['home', 'playmenu', 'title', 'anvil', 'settings', 'codex'].includes(world.state)) {
    world.player?.model.anim.loop('idle');
    world.player?.model.anim.update(dt);
    for (const m of extras) m.anim.update(dt);
  }
  // lean the camera a fifth of the way toward the arena's middle, so the edges show less void
  // on the home screen the camera sits left of the character, so they stand clear of the menu
  const target = world.state === 'home' ? world.player?.pos.clone().addScaledVector(GROUND_RIGHT, -3.2) : world.room && !['wild', 'field'].includes(world.room.plan.kind) ? world.player?.pos.clone().lerp(world.room.center, 0.2) : world.player?.pos;
  if (target) updateCamera(dt, target);
  updateLights(dt, performance.now() / 1000);
}

// the title room needs the models, so load them behind the fade first
document.getElementById('fade').textContent = 'LOADING';
await loadAssets((k) => { document.getElementById('fade').textContent = `LOADING ${Math.round(k * 100)}%`; });
document.getElementById('fade').textContent = '';

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  // a bug in one frame shouldn't freeze the game: three.js stops the loop if this callback throws
  try { frame(dt); } catch (err) { console.error(err); }
  draw();
});

enterMenu('home');
