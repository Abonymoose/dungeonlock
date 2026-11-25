import { C } from './config.js';
import { world } from './world.js';
import { renderer, scene, updateCamera, updateLights, draw, GROUND_UP, GROUND_RIGHT } from './render.js';
import { loadAssets } from './assets.js';
import { pollInput, pressed, btn, rumble, input, keyName, padName } from './input.js';
import { settings, saveSettings, resetControls, ACTIONS } from './settings.js';
import { startTutorial, updateTutorial } from './tutorial.js';
import { TABS, codexBody } from './codex.js';
import { CLASSES, CAST, WEAPONS, owns, equipped, armed, createPlayer, updatePlayer } from './classes.js';
import { spawnEnemy, updateEnemies, updateAllies, clearAllies, bossOf, TYPES } from './enemies.js';
import { updateCombat, clearCombat, heal, floatText, burst } from './combat.js';
import { buildRoom } from './room.js';
import { makePlan, rollDoors, rollWaves, rollPerks, xpToNext, meta, saveMeta, UPGRADES, MAX_PATRONS } from './run.js';
import { PATRONS, RARITY, SLOT_NAME, BOONS, offerBoons, takeBoon, describe, value, slotIcons } from './boons.js';
import { disposeObject } from './models.js';
import * as ui from './ui.js';
import { sfx, applyVolume, playTrack } from './audio.js';
import { exportSave, importSave } from './save.js';
import { updateTouch } from './touch.js';
import { keepPlan, furnishKeep, keepUpdate, VOWS, sworn, vowBonus } from './keep.js';
import { earn } from './feats.js';
import { net, coop, isHost, isGuest, connect, leave, hello, players, randomCode, send, netTick, placeRemotes, waitingOn, allDown, aliveRemote } from './net.js';
import { updateTags, padEmotes, EMOTES, COLORS } from './emote.js';
import { WARES, priceOf, furnishShop, BARGAINS, furnishShrine, furnishChest } from './shop.js';

const CLASS_IDS = Object.keys(CLASSES);

// ---- the Daily Run: one dungeon a day, the same class and vow for everyone, best scores on a shared board ----
const SCORES = 'https://dungeonscores.dungeonlock.workers.dev/daily';
const realRandom = Math.random;
const todayUTC = () => new Date().toISOString().slice(0, 10);
const dayNumber = (day) => Math.floor(Date.parse(day) / 864e5);
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dailyRules = (day = todayUTC()) => { const n = dayNumber(day); return { day, cls: CLASS_IDS[n % CLASS_IDS.length], vow: VOWS[n % VOWS.length].id }; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let board = null; // today's top ten, fetched when the Play menu opens
async function loadBoard() {
  try { board = (await fetch(`${SCORES}?day=${todayUTC()}`).then((r) => r.json())).top ?? []; } catch { board = null; }
  if (world.state === 'playmenu') RENDER.playmenu();
}
function dailyInfo() {
  const d = dailyRules();
  return { cls: CLASSES[d.cls].name, vow: VOWS.find((v) => v.id === d.vow).name,
    board: board?.slice(0, 5).map((b) => `${esc(b.name)} <span class="dim">${b.score}</span>`) ?? null };
}
function startDaily() {
  const d = dailyRules();
  menu.mode = 'dungeon';
  menu.cls = CLASS_IDS.indexOf(d.cls);
  menu.look = { [d.cls]: 0 }; // everyone gets the class's first weapon
  // shortcut: this seeds all of the game's randomness for the run, so rooms, doors and boons start the same for
  // everyone, then drift apart with how each player fights. Seed only the run's own rolls if that ever matters.
  Math.random = seeded(dayNumber(d.day) * 7919);
  startRun(d);
}
async function postDaily(run, kind) {
  const score = run.depth * 100 + run.kills + (kind === 'escaped' ? 500 : 0);
  let name = meta.name;
  if (!name) {
    name = (window.prompt('Your name for the daily board (up to 16 letters):') ?? '').trim().slice(0, 16);
    if (name) { meta.name = name; saveMeta(); }
  }
  if (!name) return ui.toast(`<b>DAILY: ${score} POINTS</b><span>No name given, so it was not posted.</span>`);
  try {
    const r = await fetch(SCORES, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day: run.daily.day, name, score, depth: run.depth, cls: run.daily.cls }) }).then((x) => x.json());
    ui.toast(r.ok ? `<b>DAILY: ${score} POINTS</b><span>Rank ${r.rank} today, as ${esc(name)}.</span>` : `<b>DAILY: NOT POSTED</b><span>${esc(r.error)}</span>`);
  } catch { ui.toast('<b>DAILY: OFFLINE</b><span>Your score could not be posted.</span>'); }
  board = null;
}
let hadPad = false;
const menu = { home: 0, play: 0, cls: 0, anvil: 0, boon: 0, choice: null, pause: 0, set: 0, tab: 0, over: 0, click: false, look: {} };
const BANNERS = {
  start: ['DUNGEONLOCK', 'Not everything unlocks.'],
  tutorial: ['TUTORIAL', "Learn the basics. You can't lose here."],
  elite: ['ELITE', 'Something heavy stirs.'],
  vault: ['VAULT', 'Your key bought this.'],
  fountain: ['FOUNTAIN', 'Drink, and go on.'],
  shop: ['THE PEDDLER', 'Spend your ash. It will not save you down here.'],
  shrine: ['THE SHRINE', 'The Lock will deal, for a price.'],
  chest: ['A CHEST', 'Locked tight. Something rattles inside.'],
  exit: ['THE LOCK', 'One key, one way out. Or go deeper.'],
};
const REWARD_NAME = { boon: 'Boon', ash: 'Ash', key: 'Key', heal: 'Healing', pom: 'Keystone', shop: 'The Peddler', shrine: 'A Bargain', trial: 'A Trial', chest: 'A Chest' };

// ---- world setup ----

function resetWorld() {
  clearCombat();
  for (const e of world.enemies) disposeObject(e.model.root);
  world.enemies.length = 0;
  clearAllies();
  world.room?.dispose();
  world.room = null;
  Object.assign(world, { pendingSpawns: 0, waveDelay: 0, hitstop: 0 });
}

function newPlayer() {
  if (world.player) disposeObject(world.player.model.root);
  world.player = createPlayer(CLASS_IDS[menu.cls], anvil(), shownWeapon());
}
// the weapon on show for the chosen class: the one you carry, unless you are looking through the others on class select
function shownWeapon() {
  const id = CLASS_IDS[menu.cls], list = WEAPONS[id];
  return list[menu.look[id] ?? list.indexOf(equipped(id, meta))];
}

// Every menu sits over the same torchlit backdrop room with the chosen class standing in it
async function enterMenu(state) {
  world.state = 'transition';
  await ui.fadeTo(true);
  resetWorld();
  ui.showHud(false);
  ui.setPrompt(null);
  world.room = buildRoom(makePlan(0, 'start'), []);
  playTrack('keep'); // the menus share the Keep's quiet music
  newPlayer();
  show(state);
  await ui.fadeTo(false);
}

// Hardcore leaves the Anvil's help at home (Greed still pays out)
const NO_UPGRADES = { vitality: 0, whetstone: 0, lastbreath: 0, shards: 0, quickstep: 0, favor: 0, insight: 0, sparekey: 0 };
const anvil = () => (settings.hardcore || world.run?.daily ? NO_UPGRADES : meta); // the Daily Run is the same for everyone

function startRun(daily = null, wait = false) {
  world.run = { depth: 0, keys: anvil().sparekey ? 1 : 0, ash: 0, kills: 0, boons: [], keyDoorsSeen: 0, xp: 0, level: 1, pendingLevels: 0, rerolls: anvil().insight, t0: world.time, featsAtStart: Object.keys(meta.feats ?? {}).length,
    vows: daily ? [daily.vow] : menu.mode !== 'dungeon' ? [] : [...(meta.vows ?? [])], daily };
  ui.hideScreen();
  newPlayer();
  world.player.lives = sworn(world.run, 'forsworn') ? 0 : anvil().lastbreath;
  ui.setSlots([]);
  if (wait) { world.state = 'transition'; ui.fadeTo(true); return; } // a co-op guest: the host sends the first room
  enterRoom(makePlan(0, 'start'));
}

async function enterRoom(plan) {
  world.state = 'transition';
  ui.setPrompt(null);
  if (plan.depth > 0) sfx('door');
  if (isHost()) { plan.doorPlans ??= rollDoors(plan.depth, world.run); send({ t: 'room', plan }); }
  await ui.fadeTo(true);
  resetWorld();
  world.run.depth = plan.depth;
  const room = world.room = buildRoom(plan, plan.doorPlans ?? rollDoors(plan.depth, world.run));
  if (plan.kind === 'keep') furnishKeep(room);
  if (plan.kind === 'shop') furnishShop(room);
  if (plan.kind === 'shrine') furnishShrine(room);
  if (plan.kind === 'chest') furnishChest(room);
  // a Trial names its condition as you walk in; pass it for an Epic boon
  world.run.trial = plan.kind === 'trial' ? pick(TRIALS(plan)) : null;
  if (world.run.trial) plan.banner = ['TRIAL', world.run.trial.desc];
  const echo = meta.echo;
  if (echo && !world.run.echoMet && !world.run.daily && !coop() && ['combat', 'elite'].includes(plan.kind) && plan.depth >= echo.depth) {
    world.run.echoMet = true;
    plan.echo = true;
    plan.waves = [['echo']];
    dressEcho(echo);
    plan.banner = ['YOUR ECHO', `Your ${CLASSES[echo.cls].name} fell here. It remembers.`];
  }
  world.run.hurt = false;
  dungeonFeats(false);
  const p = world.player;
  // enter from the bottom corner of the screen, facing up into the room
  p.pos.copy(room.entry);
  p.vel.set(0, 0, 0); p.knock.set(0, 0, 0);
  p.facing.copy(GROUND_UP);
  p.model.root.rotation.y = Math.atan2(GROUND_UP.x, GROUND_UP.z);
  p.dashT = 0; p.charge = null;
  p.ammo = p.maxAmmo;
  if (coop()) { if (p.dead) revive(p); placeRemotes(room.entry); }
  updateCamera(0, p.pos.clone().lerp(room.center, 0.2), true);

  if (!plan.waves.length) room.cleared = true;
  if (plan.kind === 'vault') { room.addPickup('boon', room.center.x - 1.2, room.center.z, plan.patron); room.addPickup('heal', room.center.x + 1.2, room.center.z); }
  if (['start', 'fountain', 'exit', 'vault', 'keep', 'shop', 'shrine', 'chest'].includes(plan.kind)) room.openDoors();
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
  if (world.run.keep) return enterMenu('playmenu'); // leaving the Keep isn't a run
  Math.random = realRandom;
  // a solo hero who dies carrying boons leaves an Echo at that depth for the next run (it replaces any older one)
  const fallen = world.player;
  if (kind === 'dead' && !world.run.daily && !coop() && fallen.boons.length && world.run.depth >= 2) {
    meta.echo = { cls: CLASS_IDS[menu.cls], weapon: fallen.cls.weapon?.id, depth: world.run.depth, boons: fallen.boons.map((b) => ({ id: b.id, rarity: b.rarity, level: b.level })) };
  }
  if (world.run.daily) postDaily(world.run, kind);
  if (isHost()) send({ t: 'end', kind });
  if (net.code) leave(); // a co-op run ends for everyone together
  const run = world.run, ash = Math.round((run.ash + (kind === 'escaped' ? 60 : 0)) * (1 + 0.15 * meta.greed) * (1 + vowBonus(run.vows) / 100));
  meta.ash += ash;
  meta.runs++;
  if (kind === 'escaped') { meta.escapes++; earn('escape'); }
  meta.bestDepth = Math.max(meta.bestDepth, run.depth);
  saveMeta();
  world.state = 'over';
  ui.setPrompt(null);
  ui.showHud(false);
  const secs = Math.round(world.time - (run.t0 ?? world.time));
  ui.overScreen({ kind, className: world.player.cls.name, weapon: world.player.cls.weapon?.name, depth: run.depth, kills: run.kills, ash,
    time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, boons: world.player.boons.length, feats: Object.keys(meta.feats ?? {}).length - (run.featsAtStart ?? 0) });
}

// The Keep: the room above the dungeon where Dungeon runs begin and end. Walk, talk, use the Anvil, take the gate.
function enterKeep() {
  world.run = { depth: 0, keys: 0, ash: meta.ash, kills: 0, boons: [], keyDoorsSeen: 0, xp: 0, level: 1, pendingLevels: 0, rerolls: 0, noXp: true, label: 'THE KEEP', keep: true };
  menu.look = {};
  ui.hideScreen();
  newPlayer();
  ui.setSlots([]);
  return enterRoom(keepPlan()).then(() => meta.echo && ui.toast(`<b>YOUR ECHO WAITS</b><span>Your ${CLASSES[meta.echo.cls].name} fell at depth ${meta.echo.depth}.</span>`));
}

// ---- room flow ----

function spawnWave() {
  const room = world.room, p = world.player, types = room.plan.waves[room.waveIndex++];
  for (const type of types) {
    if (TYPES[type].boss) { spawnEnemy(type, room.center.x - 2, room.center.z - 2, room.plan.depth); continue; }
    const { x, z } = room.freeSpot(p.pos, 4.5);
    const eliteOdds = (room.plan.kind === 'elite' ? 0.35 : Math.min(0.5, Math.max(0, room.plan.depth - 4) * 0.03 + (settings.hardcore ? 0.15 : 0))) * (sworn(world.run, 'plague') ? 2 : 1);
    spawnEnemy(type, x, z, room.plan.depth, type !== 'brute' && Math.random() < eliteOdds);
  }
}

// The vow altar: each card swears or breaks one vow, and the screen stays open until you close it
function openVows(at = 0) {
  openChoice({
    header: { name: 'Vows', title: `Sworn vows make Dungeon runs harder and pay more ash. Now: +${vowBonus(meta.vows)}% ash`, css: '#9B1C1C' },
    items: VOWS, cancel: true,
    toCard: (v) => ({ kind: meta.vows?.includes(v.id) ? 'SWORN' : 'VOW', name: v.name, desc: v.desc, note: `+${v.bonus}% ash`, css: meta.vows?.includes(v.id) ? '#C8463C' : '#6E5050' }),
    onPick: (v) => {
      const on = meta.vows?.includes(v.id);
      meta.vows = on ? meta.vows.filter((x) => x !== v.id) : [...(meta.vows ?? []), v.id];
      saveMeta();
      sfx(on ? 'menu' : 'slam');
      openVows(VOWS.indexOf(v));
    },
  });
  menu.boon = at;
  menu.boonDelay = 0.15;
  renderChoice();
}

// ---- co-op: the lobby, and what the host's messages do here ----
const coopMe = () => ({ name: meta.name, cls: CLASS_IDS[menu.cls], weapon: equipped(CLASS_IDS[menu.cls], meta).id, color: meta.color ?? 0, icon: meta.icon ?? 8 });
// rows marked cycle change with left and right (or Select); Name asks for a new one
function lobbyView() {
  const id = CLASS_IDS[menu.cls], c = COLORS[meta.color ?? 0];
  const profile = [
    { id: 'name', label: `Name <b>${esc(meta.name)}</b>` },
    { id: 'color', label: `Color <b style="color:${c.css}">&#9632; ${c.name}</b>`, cycle: true },
    { id: 'icon', label: `Icon <span class="emo">${EMOTES[meta.icon ?? 8]}</span>`, cycle: true },
    { id: 'class', label: `Class <b>${CLASSES[id].name}</b>`, cycle: true },
    { id: 'weapon', label: `Weapon <b>${equipped(id, meta).name}</b>`, cycle: true },
  ];
  const items = !net.code ? [{ id: 'host', label: 'Host a game' }, { id: 'join', label: 'Join a game' }, ...profile, { id: 'back', label: 'Back' }]
    : [...(net.host ? [{ id: 'start', label: 'Start the run' }] : []), ...profile, { id: 'leave', label: 'Leave' }];
  const weaponName = (cls, wid) => (WEAPONS[cls]?.find((w) => w.id === wid) ?? WEAPONS[cls]?.[0])?.name ?? '';
  return { code: net.code, host: net.host, items, msg: menu.lobbyMsg ?? '',
    players: players().map((p) => ({ name: p.name, me: p.me, host: p.host, img: `class-${CLASSES[p.cls] ? p.cls : 'knight'}`, cls: CLASSES[p.cls]?.name ?? '', weapon: weaponName(p.cls, p.weapon),
      color: (COLORS[p.color] ?? COLORS[0]).css, icon: EMOTES[p.icon] ?? '' })) };
}
function changeProfile(what, dir) {
  const n = CLASS_IDS.length;
  if (what === 'color') meta.color = ((meta.color ?? 0) + dir + COLORS.length) % COLORS.length;
  if (what === 'icon') meta.icon = ((meta.icon ?? 8) + dir + EMOTES.length) % EMOTES.length;
  if (what === 'class') menu.cls = (menu.cls + dir + n) % n;
  if (what === 'weapon') {
    const id = CLASS_IDS[menu.cls], mine = WEAPONS[id].filter((w) => owns(meta, w));
    meta.gear = { ...meta.gear, [id]: mine[(mine.indexOf(equipped(id, meta)) + dir + mine.length) % mine.length].id };
  }
  if (what === 'class' || what === 'weapon') newPlayer();
  profileChanged();
}
function editName() {
  const name = (window.prompt('Your name (up to 16 letters):', meta.name ?? '') ?? '').trim().slice(0, 16);
  if (!name) return;
  meta.name = name;
  profileChanged();
}
function profileChanged() {
  saveMeta();
  net.me = coopMe();
  if (net.ws) hello();
  sfx('menu');
  RENDER.lobby();
}
function enterLobby() {
  meta.name ||= `Player ${100 + Math.floor(Math.random() * 900)}`;
  menu.look = {};
  newPlayer();
  menu.lobby = 0;
  menu.lobbyMsg = '';
  net.onChange = () => { if (world.state === 'lobby') RENDER.lobby(); };
  show('lobby');
}
async function hostGame() {
  menu.lobbyMsg = 'Opening a room...';
  RENDER.lobby();
  try {
    // a code someone else is already using makes us a guest there: try another
    for (let i = 0; i < 5 && !(await connect(randomCode(), coopMe())).host; i++) leave();
    menu.lobbyMsg = net.host ? '' : 'Could not open a room. Try again.';
  } catch (e) { menu.lobbyMsg = `Could not open a room: ${e.message}.`; }
  menu.lobby = 0;
  RENDER.lobby();
}
async function joinGame() {
  const code = (window.prompt('Room code (4 letters):') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (code.length !== 4) return;
  menu.lobbyMsg = 'Joining...';
  RENDER.lobby();
  try {
    if ((await connect(code, coopMe())).host) { leave(); menu.lobbyMsg = `No game in room ${code}.`; } else menu.lobbyMsg = '';
  } catch (e) { menu.lobbyMsg = `Could not join: ${e.message}.`; }
  menu.lobby = 0;
  RENDER.lobby();
}
function revive(p) {
  Object.assign(p, { dead: false, deathT: 0, invuln: 2, hurtT: 0 });
  p.hp = Math.max(1, Math.round(p.maxHp * 0.4));
  p.model.anim.loop('idle');
  p.model.root.visible = true;
  floatText(p.pos, 'BACK UP', 'heal');
}
// you're down in a co-op run: watch, and the host keeps the room going; it's over when everyone is down
function coopDown(dt) {
  if (!world.player.downShown) { world.player.downShown = true; ui.showBanner('DOWN', 'You get back up when the room is won.', 2000); }
  if (!isHost()) return;
  roomFlow(dt);
  if (world.player.deathT > 0.6 && allDown()) endRun('dead');
}
net.on.start = () => { if (world.state !== 'lobby') return; menu.mode = 'coop'; net.inRun = true; startRun(null, true); };
net.on.room = (plan) => { if (net.inRun && world.run) enterRoom(plan); };
net.on.cleared = () => { if (world.room && !world.room.cleared) clearRoom(); };
net.on.chest = (ambush) => { if (world.room?.chest) openChest(world.room, ambush); };
net.on.revive = () => { if (world.player?.dead) revive(world.player); };
net.on.end = (kind) => { if (world.run && world.state !== 'over') endRun(kind); };
net.on.hostLeft = () => { ui.toast('<b>THE HOST LEFT</b><span>The run ends here.</span>'); if (world.run && world.state !== 'over') endRun('abandoned'); };
net.on.lost = (wasIn) => {
  if (wasIn && world.run && world.state !== 'over') { ui.toast('<b>CONNECTION LOST</b><span>The co-op run ends here.</span>'); endRun('abandoned'); }
  if (world.state === 'lobby') { menu.lobbyMsg = 'Disconnected.'; RENDER.lobby(); }
};

// ---- Trials and Chests ----
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const TRIALS = (plan) => [
  { id: 'untouched', desc: 'Take no hits.' },
  { id: 'swift', desc: `Clear it in ${20 + plan.waves.length * 12} seconds.`, limit: 20 + plan.waves.length * 12, t: 0 },
];
// a patron you've met, if any, so the Epic boon builds on what you carry
const metPatron = () => {
  const met = [...new Set(world.run.boons.flatMap((id) => BOONS[id].duo ?? [BOONS[id].patron]))];
  const ids = met.length >= MAX_PATRONS ? met : Object.keys(PATRONS);
  return pick(met.length && Math.random() < 0.7 ? met : ids);
};
function trialFailed() {
  const t = world.run.trial;
  return !t || (t.id === 'untouched' ? world.run.hurt : t.t > t.limit);
}
function trialReward(room) {
  const [dx, dz] = room.plan.drop ?? [room.center.x, room.center.z];
  if (trialFailed()) { ui.showBanner('TRIAL FAILED', 'The Lock gives you something for trying.', 1600); room.addPickup('ash', dx, dz); return; }
  earn('trial');
  ui.showBanner('TRIAL PASSED', 'Take an Epic boon.', 1600);
  room.addPickup('boon', dx, dz, metPatron()).epic = true;
}
function openChest(room, ambush = Math.random() >= 0.55) {
  const c = room.chest, depth = room.plan.depth;
  if (!c || c.opened) return;
  if (isHost()) send({ t: 'chest', ambush });
  c.opened = true;
  c.glow.visible = false;
  c.model.rotation.x = -0.3;
  sfx('unlock');
  if (!ambush) {
    ui.showBanner('TREASURE', '', 1200);
    burst(c.pos, 0xf0c040, 14);
    room.addPickup('bigash', c.pos.x + 1.1, c.pos.z + 0.3);
    room.addPickup('key', c.pos.x + 0.3, c.pos.z + 1.1);
    return;
  }
  // an ambush: the doors slam, an elite wave rises, and the reward is a Keystone and a heap of ash
  ui.showBanner('AMBUSH!', 'It was never a chest.', 1400);
  sfx('slam');
  world.shake = 0.4;
  room.closeDoors();
  room.cleared = false;
  room.waveIndex = 0;
  room.plan.waves = rollWaves(Math.max(depth, 3), 'elite').slice(0, 1);
  room.plan.reward = 'pom';
  room.plan.drop = [c.pos.x - 1.2, c.pos.z + 1.2]; // not inside the chest
  world.waveDelay = 0.6;
  world.run.ambush = true;
}

// The Echo wears your fallen hero's class and weapon, fights in their style, and hits harder for every boon they carried.
// shortcut: one Echo per run, so it sets the shared TYPES.echo entry; give it per-enemy fields if two ever meet.
function dressEcho(echo) {
  const w = WEAPONS[echo.cls].find((x) => x.id === echo.weapon) ?? WEAPONS[echo.cls][0], cls = armed(echo.cls, w);
  Object.assign(TYPES.echo, {
    model: () => cls.model(cls.weapon), name: `Echo of your ${cls.name}`, power: echo.boons.length,
    hp: 150 + 15 * echo.boons.length, style: ['wizard', 'necromancer'].includes(echo.cls) ? 'caster' : 'melee',
  });
}
function openEcho() {
  const p = world.player, echo = meta.echo, run = world.run;
  meta.echo = null; // laid to rest
  saveMeta();
  earn('echo');
  const items = (echo?.boons ?? []).filter((b) => BOONS[b.id] && !p.boons.some((x) => x.id === b.id)).sort(() => Math.random() - 0.5).slice(0, 3);
  if (!items.length) { run.ash += 60; floatText(p.pos, '+60 ash', 'ash'); return world.room.openDoors(); }
  openChoice({
    header: { name: 'Your Echo', title: `Take back one boon your ${CLASSES[echo.cls].name} carried`, css: '#7FB2D9' },
    items,
    toCard: (b) => boonCard(p, b),
    onPick: (b) => {
      takeBoon(p, { ...b });
      run.boons.push(b.id);
      ui.setSlots(slotIcons(p));
      ui.showBanner(BOONS[b.id].name.toUpperCase(), 'Reclaimed from your Echo.', 1500);
      world.room.openDoors();
    },
  });
}

function clearRoom() {
  const room = world.room, kind = room.plan.kind;
  room.cleared = true;
  if (isHost()) { send({ t: 'cleared' }); send({ t: 'revive' }); }
  if (coop() && world.player.dead) revive(world.player); // the fallen get up when the room is won
  const c = world.run.curse;
  if (c && room.plan.waves.length && --c.rooms <= 0) { world.run.curse = null; ui.toast(`<b>${c.name.toUpperCase()} PAID</b><span>The Lock is satisfied.</span>`); }
  dungeonFeats(true);
  if (kind === 'chest') earn('ambush');
  world.slowmo = 0.8; // the last kill lands in slow motion
  if (!room.plan.echo) ui.showBanner(kind === 'boss' ? TYPES[room.plan.waves[0][0]].name.toUpperCase() + ' FALLS' : 'CLEARED', '', 1400);
  rumble(0.3, 0.3, 120);
  // shards come home when the fight ends, like Hades' bloodstones
  for (const k of room.pickups.filter((k) => k.type === 'shard')) disposeObject(k.obj);
  room.pickups = room.pickups.filter((k) => k.type !== 'shard');
  world.player.ammo = world.player.maxAmmo;
  if (room.plan.echo) { room.addPickup('echo', room.center.x - 1.2, room.center.z + 1.2); ui.showBanner('AT REST', 'Your Echo leaves something behind.', 1600); }
  if (kind === 'trial') return trialReward(room);
  if (kind === 'chest') room.addPickup('bigash', room.center.x + 1.2, room.center.z - 1.2); // the ambush paid off
  const reward = kind === 'boss' ? 'bigash' : room.plan.reward;
  const [dx, dz] = room.plan.drop ?? [room.center.x, room.center.z]; // a centre pillar moves the drop in front of it
  if (reward) room.addPickup(reward, dx, dz, room.plan.patron);
  else room.openDoors();
}

// Feats a Dungeon room can earn: on entering it (depth) or on clearing it (the fight itself)
function dungeonFeats(cleared) {
  const room = world.room, run = world.run, depth = room.plan.depth;
  if (world.tutorial || run.keep) return;
  if (depth >= 10) earn('depth10');
  if (depth >= 11) earn('vaults');
  if (depth >= 20) earn('depth20');
  if (depth >= 21) earn('forges');
  if (depth >= 5 && settings.hardcore) earn('hardcore');
  if (depth >= 10 && (run.vows?.length ?? 0) >= 3) earn('vowed');
  if (world.player.boons.length >= 6) earn('collector');
  if ((run.dodges ?? 0) >= 10) earn('dodger');
  if (!cleared) return;
  if (room.plan.waves.length) earn('firstblood');
  if (depth >= 5 && room.plan.waves.length && !run.hurt) earn('untouched');
  if (room.plan.kind === 'boss') earn(room.plan.waves[0][0]); // warden, prior, reaver, drownedking, forgemaster
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
  } else if (type === 'boon') return openBoon(k.patron ?? Object.keys(PATRONS)[Math.floor(Math.random() * Object.keys(PATRONS).length)], !!k.epic);
  else if (type === 'pom') return openKeystone();
  else if (type === 'echo') return openEcho();
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

// the pause screen's list of what you carry
function carriedBoons() {
  return (world.player?.boons ?? []).map((b) => {
    const def = BOONS[b.id], r = RARITY.find((x) => x.id === b.rarity), pat = PATRONS[def.patron ?? def.duo[0]];
    return { name: def.name, css: def.duo ? r.css : pat.css, sigil: def.duo ? null : pat.sigil, rarity: r.name, rarityCss: r.css, level: b.level, desc: describe(b),
      kind: def.slot ? SLOT_NAME[def.slot] : def.duo ? 'Duo' : def.legendary ? 'Legendary' : 'Passive' };
  });
}

function boonCard(p, b) {
  const def = BOONS[b.id], r = RARITY.find((x) => x.id === b.rarity), pat = PATRONS[def.patron ?? def.duo[0]];
  const holder = def.slot && p.boons.find((x) => BOONS[x.id].slot === def.slot && x.id !== b.id);
  return {
    kind: def.slot ? SLOT_NAME[def.slot].toUpperCase() : def.duo ? 'DUO' : def.legendary ? 'LEGENDARY' : 'PASSIVE',
    name: def.name, rarity: r.name, rarityCss: r.css, css: def.duo ? r.css : pat.css, desc: describe(b),
    note: holder ? `Replaces ${BOONS[holder.id].name}` : def.duo ? `${PATRONS[def.duo[0]].name} + ${PATRONS[def.duo[1]].name}` : '',
    sigils: (def.duo ?? [def.patron]).map((id) => [PATRONS[id].sigil, PATRONS[id].css]),
  };
}

function openBoon(pid, epic = false) {
  const p = world.player, pat = PATRONS[pid];
  const offer = () => offerBoons(pid, p, anvil()).map((b) => (epic && ['common', 'rare'].includes(b.rarity) ? { ...b, rarity: 'epic' } : b));
  openChoice({
    header: { name: pat.name, title: pat.title, css: pat.css, sigil: pat.sigil, line: pat.lines[Math.floor(Math.random() * pat.lines.length)] },
    items: offer(),
    toCard: (b) => boonCard(p, b),
    reroll: offer,
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

// The Peddler's stall: pay with the ash you carry this run; each ware once per visit
function openShop() {
  const run = world.run, p = world.player, shop = world.room.shop, depth = world.room.plan.depth;
  const price = (w) => priceOf(w, depth);
  const can = (w) => !shop.sold.has(w.id) && run.ash >= price(w) && !(w.id === 'keystone' && !p.boons.length);
  openChoice({
    header: { name: 'The Peddler', title: `You carry ${run.ash} ash`, css: '#D4C5AC' },
    items: WARES, cancel: true, canPick: can,
    toCard: (w) => ({ kind: 'WARE', name: w.name, desc: w.desc, note: shop.sold.has(w.id) ? 'Sold' : `${price(w)} ash`, css: can(w) ? '#D4C5AC' : '#6E2323' }),
    onPick: (w) => {
      run.ash -= price(w);
      shop.sold.add(w.id);
      run.bought = (run.bought ?? 0) + 1;
      if (run.bought >= 3) earn('merchant');
      sfx('unlock');
      if (w.id === 'draught') heal(p, p.maxHp * 0.4);
      else if (w.id === 'key') { run.keys++; floatText(p.pos, '+1 KEY', 'crit'); }
      else if (w.id === 'vigor') { p.maxHp += 15; heal(p, 15); }
      else if (w.id === 'boon') return openBoon(Object.keys(PATRONS)[Math.floor(Math.random() * Object.keys(PATRONS).length)]);
      else if (w.id === 'keystone') return openKeystone();
    },
  });
}

// The Shrine: one bargain per shrine; a debt lasts three cleared rooms
function openShrine() {
  const run = world.run, p = world.player, shrine = world.room.shrine;
  openChoice({
    header: { name: 'The Shrine', title: 'Strike one bargain', css: '#9B1C1C' },
    items: BARGAINS, cancel: true, canPick: (b) => !(b.curse && run.curse),
    toCard: (b) => ({ kind: 'BARGAIN', name: b.name, desc: b.desc, note: b.curse && run.curse ? 'You already owe a debt' : '', css: '#9B1C1C' }),
    onPick: (b) => {
      shrine.used = true;
      shrine.orb.material.color.setHex(C.ONYX);
      earn('shrine');
      sfx('slam');
      if (b.curse) run.curse = { id: b.id, name: b.curse, rooms: 3 };
      if (b.id === 'blood') {
        p.maxHp = Math.max(1, Math.round(p.maxHp * 0.8));
        p.hp = Math.min(p.hp, p.maxHp);
        return openBoon(Object.keys(PATRONS)[Math.floor(Math.random() * Object.keys(PATRONS).length)], true);
      }
      if (b.id === 'iron') { run.ash += 120; floatText(p.pos, '+120 ash', 'ash'); }
      if (b.id === 'glass') { run.keys++; floatText(p.pos, '+1 KEY', 'crit'); return openKeystone(); }
    },
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

function roomFlow(dt) {
  const room = world.room;
  if (!room.cleared && !isGuest()) { // a guest's room clears when the host's does
    if (world.waveDelay > 0) {
      world.waveDelay -= dt;
      if (world.waveDelay <= 0) spawnWave();
    } else if (world.pendingSpawns === 0 && !world.enemies.some((e) => !e.dead)) {
      if (room.waveIndex < room.plan.waves.length) world.waveDelay = 0.7;
      else clearRoom();
    }
  }
}

function roomLogic(dt) {
  const room = world.room, run = world.run, p = world.player;
  roomFlow(dt);
  let keepPrompt = null;
  // a Dungeon fight shows what is left of it under the depth
  if (!run.keep && !world.tutorial) {
    const left = world.enemies.filter((e) => !e.dead).length + world.pendingSpawns, waves = room.plan.waves.length;
    const debt = run.curse ? `<br><span class="red">${run.curse.name.toUpperCase()} (${run.curse.rooms})</span>` : '';
    const t = run.trial;
    if (t && !room.cleared && t.id === 'swift') t.t += dt;
    const trial = t && !room.cleared ? `<br><span class="${trialFailed() ? 'red' : ''}">TRIAL: ${t.id === 'untouched' ? 'NO HITS' : Math.max(0, Math.ceil(t.limit - t.t)) + 's'}${trialFailed() ? ' FAILED' : ''}</span>` : '';
    run.label = (room.cleared || !waves ? `DEPTH ${room.plan.depth}` : `DEPTH ${room.plan.depth}<br>${left} LEFT${waves > 1 ? ` &nbsp;WAVE ${Math.max(1, room.waveIndex)} OF ${waves}` : ''}`) + trial + debt;
  }
  if (room.plan.kind === 'keep') {
    const k = keepUpdate(room, p, dt);
    if (k.vows) return openVows();
    keepPrompt = k.prompt;
    if (k.anvil) { menu.anvilFrom = 'keep'; return enterMenu('anvil'); }
  }
  // level-ups wait until nothing is left alive
  if (room.cleared && run.pendingLevels > 0 && !world.pendingSpawns && !world.enemies.some((e) => !e.dead)) return openPerks();

  for (let i = room.pickups.length - 1; i >= 0; i--) {
    const k = room.pickups[i];
    if (Math.hypot(k.obj.position.x - p.pos.x, k.obj.position.z - p.pos.z) > 0.8) continue;
    room.pickups.splice(i, 1);
    disposeObject(k.obj);
    collect(k);
    if (world.state !== 'play') return;
  }

  let prompt = keepPrompt;
  const door = room.cleared && !room.pickups.some((k) => k.type !== 'shard') ? room.doorNear(p.pos) : null;
  // co-op: the host picks the door, once everyone has their reward
  const hold = coop() && door ? (isGuest() ? 'THE HOST PICKS THE DOOR' : waitingOn().length ? `WAITING FOR ${waitingOn().map((n) => esc(n).toUpperCase()).join(', ')}` : null) : null;
  if (hold) prompt = `<span class="dim">${hold}</span>`;
  else if (door?.kind === 'gate') {
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
    if (door.kind === 'keep') { menu.titleFrom = 'keep'; return enterMenu('title'); } // the gate: pick a class and weapon, then down
    return door.kind === 'home' ? leaveTutorial(true) : door.kind === 'adv' ? finishChapter() : enterRoom(makePlan(run.depth + 1, door.kind, door.reward, door.patron));
  }

  const sr = room.shrine;
  if (sr && !sr.used) {
    sr.orb.rotation.y += dt;
    if (sr.pos.distanceTo(p.pos) < 2.2) {
      prompt = `${btn('interact')}STRIKE A BARGAIN`;
      if (pressed('interact')) return openShrine();
    }
  }
  const ch = room.chest;
  if (ch && !ch.opened && !isGuest()) {
    ch.glow.position.y = 1.3 + Math.sin(performance.now() / 300) * 0.08;
    if (ch.pos.distanceTo(p.pos) < 1.8) {
      prompt = `${btn('interact')}OPEN THE CHEST`;
      if (pressed('interact')) openChest(room);
    }
  }
  const sh = room.shop;
  if (sh) {
    sh.model.anim.update(dt);
    sh.glow.position.y = 2.1 + Math.sin(performance.now() / 300) * 0.08;
    if (sh.pos.distanceTo(p.pos) < 2) {
      prompt = `${btn('interact')}TRADE <span class="dim">${run.ash} ASH</span>`;
      if (pressed('interact')) return openShop();
    }
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
const SEL_KEY = { device: 'device', lobby: 'lobby', home: 'home', playmenu: 'play', title: 'cls', anvil: 'anvil', choice: 'boon', pause: 'pause', settings: 'set', over: 'over' };
const RENDER = {
  home: () => ui.homeScreen(menu.home, meta),
  device: () => ui.deviceScreen(menu.device),
  lobby: () => ui.lobbyScreen(menu.lobby ?? 0, lobbyView()),
  playmenu: () => { if (board === null) { board = []; loadBoard(); } return ui.playScreen(menu.play, meta, dailyInfo()); },
  title: () => ui.titleScreen(CLASS_IDS.map((id, i) => {
    const w = i === menu.cls ? shownWeapon() : equipped(id, meta);
    return { ...armed(id, w), owned: owns(meta, w), count: WEAPONS[id].length, at: WEAPONS[id].indexOf(w) };
  }), menu.cls, meta, CAST),
  anvil: () => ui.anvilScreen(UPGRADES, menu.anvil, meta),
  settings: () => ui.settingsScreen(settingRows(), menu.set, !!input.capture),
  codex: () => ui.codexScreen(TABS, menu.tab, codexBody(menu.tab)),
  pause: () => ui.pauseScreen(menu.pause, world.player.cls, CAST, world.tutorial ? 'Leave the tutorial' : world.run.keep ? 'Leave the Keep' : 'Abandon run', carriedBoons()),
  choice: () => renderChoice(),
};
function show(state) {
  world.state = state;
  heroes(state === 'home');
  RENDER[state]?.();
}

// On the home screen all the heroes stand together in the torchlight
let extras = [];
function heroes(on) {
  for (const m of extras) disposeObject(m.root);
  extras = [];
  if (!on || !world.player) return;
  world.player.model.root.rotation.y = Math.PI / 4;
  const spots = [[-1.3, 0.7, 0.5], [1.3, 0.7, -0.5], [0, 1.5, 0]]; // across, back, turn
  CLASS_IDS.filter((_, i) => i !== menu.cls).forEach((id, k) => {
    const m = CLASSES[id].model(equipped(id, meta)), [x, z, turn] = spots[k % spots.length];
    m.root.position.copy(world.player.pos).addScaledVector(GROUND_RIGHT, x).addScaledVector(GROUND_UP, z);
    m.root.rotation.y = Math.PI / 4 + turn;
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
  if (e.target.closest('.weapon [data-act]')) return; // the weapon arrows on a class card are buttons of their own
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

// ---- tutorial ----

async function beginTutorial() {
  const device = ui.DEVICES[menu.device].id;
  settings.keysOnly = device === 'keys'; // prompts show J, not the left mouse button
  saveSettings();
  input.usingPad = device === 'pad'; input.touch = device === 'touch'; // prompts start on that device
  world.run = { depth: 0, keys: 0, ash: 0, kills: 0, boons: [], keyDoorsSeen: 0, xp: 0, level: 1, pendingLevels: 0, rerolls: 0 };
  ui.hideScreen();
  newPlayer();
  ui.setSlots([]);
  const plan = makePlan(0, 'tutorial');
  plan.doorPlans = [{ kind: 'home', reward: null }];
  await enterRoom(plan);
  startTutorial(device);
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

  home() {
    if (navigate('home', 3)) return RENDER.home();
    if (confirmed()) { sfx('menu'); show(['playmenu', 'settings', 'codex'][menu.home]); menu.settingsFrom = 'home'; }
  },

  playmenu() {
    if (navigate('play', ui.PLAY_CARDS.length, true)) return RENDER.playmenu();
    if (pressed('back')) return show('home');
    if (!confirmed()) return;
    const card = ui.PLAY_CARDS[menu.play];
    if (card === 'tutorial') { menu.device = input.touch ? 3 : input.usingPad ? 2 : settings.keysOnly ? 1 : 0; return show('device'); }
    if (card === 'daily') return startDaily();
    if (card === 'coop') return enterLobby();
    menu.mode = 'dungeon';
    return enterKeep();
  },

  device() {
    if (navigate('device', ui.DEVICES.length)) return RENDER.device();
    if (pressed('back')) return show('playmenu');
    if (confirmed()) { sfx('menu'); beginTutorial(); }
  },

  title(dt) {
    world.player.model.root.rotation.y += dt * 0.8;
    if (navigate('cls', CLASS_IDS.length, true)) return RENDER.title();
    const id = CLASS_IDS[menu.cls], list = WEAPONS[id];
    // up and down look through this class's weapons; one you own goes straight into your hand
    if (pressed('up') || pressed('down')) {
      menu.look[id] = (list.indexOf(shownWeapon()) + (pressed('down') ? 1 : list.length - 1)) % list.length;
      const w = shownWeapon();
      if (owns(meta, w)) { meta.gear = { ...meta.gear, [id]: w.id }; saveMeta(); }
      newPlayer();
      sfx('menu');
      return RENDER.title();
    }
    if (pressed('alt')) return show('anvil');
    if (pressed('back')) { menu.look = {}; newPlayer(); return menu.titleFrom === 'keep' ? enterKeep() : show('playmenu'); }
    if (!confirmed()) return;
    const w = shownWeapon();
    if (owns(meta, w)) return startRun();
    // a weapon you don't own yet: confirm buys it, and the next confirm descends
    if (meta.ash < w.cost) { sfx('menu'); world.shake = 0.1; return; }
    meta.ash -= w.cost;
    meta.owned = [...(meta.owned ?? []), w.id];
    if (Object.values(WEAPONS).flat().every((x) => owns(meta, x))) earn('armory');
    meta.gear = { ...meta.gear, [id]: w.id };
    saveMeta();
    sfx('unlock');
    ui.showBanner(w.name.toUpperCase(), 'Yours now.', 1400);
    RENDER.title();
  },

  anvil() {
    if (navigate('anvil', UPGRADES.length)) return RENDER.anvil();
    if (pressed('back') || pressed('alt')) {
      if (menu.anvilFrom === 'keep') { menu.anvilFrom = null; return enterKeep(); }
      return show('title');
    }
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
    updateAllies(gdt);
    updateCombat(gdt);
    netTick(gdt, p.dead || (world.state === 'play' && world.room.cleared && !world.room.pickups.some((k) => k.type !== 'shard') && !(world.run.pendingLevels > 0)));
    world.room.update(gdt);
    ui.updateHud(p, world.run, xpToNext(world.run.level));
    ui.updateEnemyBars(world.enemies);
    if (p.dead) {
      ui.setPrompt(null);
      if (coop()) return coopDown(gdt);
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

  lobby() {
    const items = lobbyView().items;
    menu.lobby = Math.min(menu.lobby ?? 0, items.length - 1);
    if (navigate('lobby', items.length)) return RENDER.lobby();
    if (pressed('back')) { leave(); return show('playmenu'); }
    const it = items[menu.lobby];
    const dir = pressed('right') ? 1 : pressed('left') ? -1 : 0;
    if (it.cycle && dir) return changeProfile(it.id, dir);
    if (!confirmed()) return;
    sfx('menu');
    if (it.id === 'host') return hostGame();
    if (it.id === 'join') return joinGame();
    if (it.id === 'back') return show('playmenu');
    if (it.id === 'leave') { leave(); return show('playmenu'); }
    if (it.id === 'name') return editName();
    if (it.cycle) return changeProfile(it.id, 1);
    if (it.id === 'start') {
      menu.mode = 'coop';
      net.inRun = true;
      send({ t: 'start' });
      startRun();
    }
  },

  over() {
    if (!confirmed()) return;
    if (menu.mode === 'coop') return enterMenu('playmenu');
    if (menu.mode === 'dungeon') return enterKeep(); // a Dungeon run ends back in the Keep
    menu.titleFrom = 'playmenu';
    enterMenu('title');
  },
};

// One simulation step. Exported so tests can step the game at a fixed rate.
export function frame(dt) {
  // skip polling during hit-stop so presses made in those frames still count afterwards
  if (!(world.state === 'play' && world.hitstop > 0)) { pollInput(); padEmotes(); }
  STATES[world.state](dt);
  menu.click = false;
  updateTouch(world);
  updateTags(world.remotes ?? []);
  // menu backdrops: keep the heroes breathing
  if (['home', 'playmenu', 'title', 'anvil', 'settings', 'codex'].includes(world.state)) {
    world.player?.model.anim.loop('idle');
    world.player?.model.anim.update(dt);
    for (const m of extras) m.anim.update(dt);
  }
  // lean the camera a fifth of the way toward the arena's middle, so the edges show less void
  // on the home screen the camera sits left of the character, so they stand clear of the menu
  const hero = coop() && world.player?.dead ? (aliveRemote() ?? world.player) : world.player;
  const target = world.state === 'home' ? world.player?.pos.clone().addScaledVector(GROUND_RIGHT, -3.2) : world.room ? hero?.pos.clone().lerp(world.room.center, 0.2) : hero?.pos;
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
