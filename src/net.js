import * as THREE from 'three';
import { world } from './world.js';
import { hooks, damage, telegraph, fireProjectile } from './combat.js';
import { createPuppet, TYPES } from './enemies.js';
import { createPlayer, CLASSES, WEAPONS } from './classes.js';
import { disposeObject } from './models.js';
import { emote, emoteHooks } from './emote.js';

// Co-op: up to four players share a Dungeon run through a relay (server/relay.js) on Cloudflare.
// The host runs the rooms and the enemies; every player runs their own hero, and sends where they are and what they hit.
//   host -> all: start, room (the next room's plan), en (enemies), tele / shot (enemy warnings and bolts), cleared,
//                chest, revive, end
//   all -> all:  hello (name and class), st (where you are), act (an attack animation), emote
//   guest -> host: hit (damage you did to an enemy);  host -> one guest: hurt (damage an enemy did to you)
// Everything from the wire is checked before use: it comes from other people's browsers.

const RELAY = 'wss://dungeonrelay.dungeonlock.workers.dev/room/';
const ST_EVERY = 1 / 12, EN_EVERY = 1 / 8;
export const net = { ws: null, id: null, host: false, code: null, peers: new Map(), inRun: false, me: null, onChange: null, on: {} };
export const coop = () => net.inRun;
export const isHost = () => net.inRun && net.host;
export const isGuest = () => net.inRun && !net.host;
const HOSTILE = { team: 1, dead: true }; // the source of a hit relayed from the host: an enemy, already accounted for
const num = (v, lo = -1e4, hi = 1e4) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
const clean = (s, n = 16) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').slice(0, n) || 'Player';

export function send(msg) { if (net.ws?.readyState === 1) net.ws.send(JSON.stringify(msg)); }

// ---- the lobby ----

export const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

// joins room `code`; resolves { host } once the relay says hello, rejects if the room is full or unreachable
export function connect(code, me) {
  leave();
  net.code = code;
  net.me = me;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY + code);
    net.ws = ws;
    let settled = false;
    const fail = (why) => { if (!settled) { settled = true; reject(new Error(why)); } };
    ws.onerror = () => fail('could not reach the relay');
    ws.onclose = (e) => {
      fail(e.code === 4001 ? 'that room is full' : 'the connection closed');
      if (net.ws === ws) { const wasIn = net.inRun; reset(); net.on.lost?.(wasIn); }
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'welcome') {
        net.id = m.id; net.host = !!m.host; settled = true;
        for (const p of Array.isArray(m.peers) ? m.peers : []) if (typeof p?.id === 'string') peer(p.id).host = !!p.host;
        hello();
        resolve({ host: net.host });
        return net.onChange?.();
      }
      handle(m);
    };
  });
}

function reset() {
  for (const p of net.peers.values()) dropPuppet(p);
  net.peers.clear();
  Object.assign(net, { ws: null, id: null, host: false, code: null, inRun: false });
  world.remotes = [];
}

export function leave() {
  const ws = net.ws;
  reset();
  try { ws?.close(1000, 'bye'); } catch { /* already gone */ }
}

export function hello(to = undefined) { send({ t: 'hello', to, name: net.me?.name, cls: net.me?.cls, weapon: net.me?.weapon }); }
export const players = () => [{ id: net.id, name: net.me?.name, cls: net.me?.cls, host: net.host, me: true }, ...[...net.peers.values()].map((p) => ({ id: p.id, name: p.name, cls: p.cls, host: p.host }))];

// ---- remote heroes: a puppet each, steered toward where its player says it is ----

function peer(id) {
  let p = net.peers.get(id);
  if (!p) { p = { id, name: 'Player', cls: 'knight', weapon: null, st: null, puppet: null, host: false }; net.peers.set(id, p); }
  return p;
}
function dropPuppet(p) {
  if (!p.puppet) return;
  disposeObject(p.puppet.model.root);
  world.remotes = (world.remotes ?? []).filter((r) => r !== p.puppet);
  p.puppet = null;
}
function puppetFor(p) {
  if (p.puppet || !net.inRun || !world.room) return p.puppet;
  const cls = CLASSES[p.cls] ? p.cls : 'knight';
  const weapon = WEAPONS[cls].find((w) => w.id === p.weapon) ?? WEAPONS[cls][0];
  const e = createPlayer(cls, { vitality: 0, whetstone: 0, shards: 0, quickstep: 0 }, weapon);
  Object.assign(e, { remote: true, peerId: p.id, netName: p.name });
  e.pos.copy(world.room.entry ?? world.player.pos);
  p.puppet = e;
  (world.remotes ??= []).push(e);
  return e;
}
// a new room: every puppet starts at the door with the rest of us
export function placeRemotes(at) {
  for (const p of net.peers.values()) {
    const e = puppetFor(p);
    if (e) { e.pos.copy(at); if (p.st) { p.st.x = at.x; p.st.z = at.z; } }
  }
}

function steerRemotes(dt) {
  for (const p of net.peers.values()) {
    const e = puppetFor(p);
    if (!e || !p.st) continue;
    const s = p.st;
    e.hp = s.hp; e.maxHp = s.mx;
    if (s.dead && !e.dead) { e.dead = true; e.model.anim.once('death', 0.8, true); }
    if (!s.dead && e.dead) { e.dead = false; e.model.anim.loop('idle'); }
    const dx = s.x - e.pos.x, dz = s.z - e.pos.z, far = Math.hypot(dx, dz);
    if (far > 4) e.pos.set(s.x, 0, s.z); // too far behind to slide: jump
    else e.pos.x += dx * Math.min(1, dt * 12), e.pos.z += dz * Math.min(1, dt * 12);
    let d = s.ry - e.model.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e.model.root.rotation.y += d * Math.min(1, dt * 15);
    e.facing.set(Math.sin(s.ry), 0, Math.cos(s.ry));
    if (!e.dead) e.model.anim.loop(s.mv > 0.4 ? 'run' : 'idle', s.mv > 0.4 ? 1.15 : 1);
    e.model.anim.update(dt);
  }
}

// ---- enemies on a guest's screen: puppets of the host's, by id ----

const byId = new Map(); // netId -> puppet (guest) or enemy (host)
function enemy(id) {
  const e = byId.get(id);
  if (e && world.enemies.includes(e)) return e;
  const found = world.enemies.find((x) => x.netId === id);
  if (found) byId.set(id, found);
  return found ?? null;
}

function applyEnemies(list) {
  if (!Array.isArray(list) || !world.room) return;
  const seen = new Set();
  for (const row of list.slice(0, 80)) {
    if (!Array.isArray(row)) continue;
    const [id, type, x, z, ry, hp, mx, elite, dead, affix] = row;
    if (!TYPES[type] || type === 'dummy') continue;
    seen.add(id);
    let e = enemy(id);
    if (!e) {
      if (dead) continue;
      e = createPuppet(type, id, num(x), num(z), world.run?.depth ?? 0, !!elite, typeof affix === 'string' ? affix : null);
      byId.set(id, e);
    }
    e.netX = num(x); e.netZ = num(z); e.netRy = num(ry, -10, 10);
    e.maxHp = Math.max(1, num(mx, 1, 1e6));
    if (!e.dead) e.hp = Math.max(dead ? 0 : 1, Math.min(e.hp, num(hp, 0, 1e6))); // ours may be ahead of theirs, never behind
    if (dead && !e.dead) { e.hp = 0; e.dead = true; e.onDeath?.(); }
  }
  // gone from the host's list without dying here: it was cleared up there
  for (const e of world.enemies) if (e.puppet && !e.dead && !seen.has(e.netId) && (e.unseen = (e.unseen ?? 0) + 1) > 6) { e.hp = 0; e.dead = true; }
}

// ---- the wire ----

function handle(m) {
  const from = typeof m.from === 'string' ? m.from : null;
  switch (m.t) {
    case 'join': { const p = peer(m.id); p.host = !!m.host; hello(m.id); break; }
    case 'leave': {
      const p = net.peers.get(m.id);
      if (p) { dropPuppet(p); net.peers.delete(m.id); }
      if (m.host && net.inRun) net.on.hostLeft?.();
      break;
    }
    case 'hello': {
      if (!from) return;
      const p = peer(from);
      p.name = clean(m.name); p.cls = CLASSES[m.cls] ? m.cls : 'knight'; p.weapon = typeof m.weapon === 'string' ? m.weapon : null;
      if (p.puppet && (p.puppet.id !== p.cls)) dropPuppet(p);
      if (p.puppet) p.puppet.netName = p.name;
      break;
    }
    case 'st': if (from) peer(from).st = { x: num(m.x), z: num(m.z), ry: num(m.ry, -10, 10), hp: num(m.hp, 0, 1e5), mx: num(m.mx, 1, 1e5), dead: !!m.dead, ready: !!m.ready, mv: num(m.mv, 0, 50) }; break;
    case 'act': { const e = from && net.peers.get(from)?.puppet; if (e && typeof m.a === 'string' && e.model.anim.has(m.a)) e.model.anim.once(m.a, num(m.d, 0.1, 3)); break; }
    case 'emote': { const p = from && net.peers.get(from); if (p) emote(puppetFor(p) ?? null, num(m.i, 0, 99) | 0, p.name); break; }
    // host -> guests
    case 'start': if (!net.host) net.on.start?.(); break;
    case 'room': if (!net.host && m.plan && typeof m.plan === 'object') net.on.room?.(m.plan); break;
    case 'en': if (!net.host) applyEnemies(m.e); break;
    case 'tele': if (!net.host) remoteTelegraph(m); break;
    case 'shot': if (!net.host) remoteShot(m); break;
    case 'cleared': if (!net.host) net.on.cleared?.(); break;
    case 'chest': if (!net.host) net.on.chest?.(!!m.ambush); break;
    case 'revive': if (!net.host) net.on.revive?.(); break;
    case 'end': if (!net.host) net.on.end?.(['escaped', 'trapped', 'dead', 'abandoned'].includes(m.kind) ? m.kind : 'dead'); break;
    // guest -> host: a hit on one of our enemies
    case 'hit': {
      if (!net.host || !from) return;
      const e = enemy(m.id), src = net.peers.get(from)?.puppet;
      if (!e || e.dead) return;
      damage(e, num(m.a, 0, 5000), new THREE.Vector3(num(m.x), 0, num(m.z)), { knockback: num(m.k, 0, 30), stun: num(m.st, 0, 5), source: src ?? null, tag: 'remote', raw: true, quiet: m.q === 1 });
      break;
    }
    // host -> this guest: an enemy hit you
    case 'hurt': {
      if (net.host || m.to !== net.id || !world.player || world.player.dead) return;
      damage(world.player, num(m.a, 0, 5000), new THREE.Vector3(num(m.x), 0, num(m.z)), { knockback: num(m.k, 0, 30), stun: num(m.st, 0, 5), source: HOSTILE });
      break;
    }
  }
  net.onChange?.();
}

// a host's enemy warning, drawn here for show: the host decides what it hits
function remoteTelegraph(m) {
  const owner = m.o ? enemy(m.o) : null;
  const shape = ['circle', 'arc', 'line'].includes(m.s) ? m.s : 'circle';
  const duration = num(m.d, 0.05, 5);
  telegraph({ owner, shape, pos: new THREE.Vector3(num(m.x), 0, num(m.z)), dir: m.dx != null ? new THREE.Vector3(num(m.dx, -1, 1), 0, num(m.dz, -1, 1)) : null,
    radius: num(m.r, 0.1, 20), arc: num(m.a, 0.1, 7), length: num(m.l, 0.1, 30), width: num(m.w, 0.1, 10), duration, cosmetic: true });
  if (owner && owner.model.anim.has('attack')) owner.model.anim.once('attack', duration / 0.55);
}
function remoteShot(m) {
  fireProjectile({ owner: { team: 1, pos: new THREE.Vector3(num(m.x), 0, num(m.z)) }, dir: new THREE.Vector3(num(m.dx, -1, 1), 0, num(m.dz, -1, 1)),
    speed: num(m.sp, 0.1, 60), size: num(m.sz, 0.05, 2), range: num(m.rg, 0.1, 40), color: num(m.c, 0, 0xffffff), damage: 0, cosmetic: true });
}

// ---- hooks the game calls (combat, enemies) ----

// host: an enemy's warning or bolt is drawn on everyone's screen
hooks.onTelegraph = (o) => {
  if (!isHost() || o.cosmetic || o.owner?.team === 0) return;
  send({ t: 'tele', s: o.shape, x: +o.pos.x.toFixed(2), z: +o.pos.z.toFixed(2), dx: o.dir ? +o.dir.x.toFixed(3) : undefined, dz: o.dir ? +o.dir.z.toFixed(3) : undefined,
    r: o.radius, a: o.arc, l: o.length, w: o.width, d: o.duration, o: o.owner?.netId });
};
hooks.onShot = (o) => {
  if (!isHost()) return;
  send({ t: 'shot', x: +o.pos.x.toFixed(2), z: +o.pos.z.toFixed(2), dx: +o.dir.x.toFixed(3), dz: +o.dir.z.toFixed(3), sp: o.speed, sz: o.size, rg: o.range, c: o.color });
};
// host: something hit another player's hero; that player takes it, through their own dodges and armour
hooks.remoteHurt = (target, amount, from, { knockback = 0, stun = 0 } = {}) => {
  if (!isHost() || target.dead) return;
  send({ t: 'hurt', to: target.peerId, a: Math.round(amount), x: from ? +from.x.toFixed(2) : target.pos.x, z: from ? +from.z.toFixed(2) : target.pos.z, k: knockback, st: stun });
};
// guest: you hit one of the host's enemies
hooks.puppetHit = (e, amount, from, { knockback = 0, stun = 0, tag = null, quiet = false } = {}) => {
  if (!isGuest()) return;
  send({ t: 'hit', id: e.netId, a: amount, x: from ? +from.x.toFixed(2) : e.pos.x, z: from ? +from.z.toFixed(2) : e.pos.z, k: knockback, st: stun, tag, q: quiet ? 1 : 0 });
};
emoteHooks.send = (i) => { if (net.ws) send({ t: 'emote', i }); };

// your own attack animations play on your puppet everywhere else
function wrapAnims(p) {
  if (!p || p.netWrapped) return;
  const once = p.model.anim.once.bind(p.model.anim);
  p.model.anim.once = (name, d, hold) => { if (net.inRun && name !== 'death') send({ t: 'act', a: name, d: +(+d).toFixed(2) }); return once(name, d, hold); };
  p.netWrapped = true;
}

// ---- once a frame in a co-op run ----

let stT = 0, enT = 0, lastEn = 0;
export function netTick(dt, ready) {
  if (!net.inRun) return;
  const p = world.player;
  wrapAnims(p);
  steerRemotes(dt);
  if ((stT -= dt) <= 0 && p) {
    stT = ST_EVERY;
    send({ t: 'st', x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), ry: +p.model.root.rotation.y.toFixed(2), hp: Math.ceil(p.hp), mx: p.maxHp, dead: !!p.dead, ready, mv: +p.vel.length().toFixed(1) });
  }
  if (net.host && (enT -= dt) <= 0) {
    enT = EN_EVERY;
    const list = world.enemies.filter((e) => !e.puppet && e.netId).map((e) => [e.netId, e.type, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), +e.model.root.rotation.y.toFixed(2), Math.ceil(e.hp), e.maxHp, e.elite ? 1 : 0, e.dead ? 1 : 0, e.affix ?? '']);
    if (list.length || lastEn) send({ t: 'en', e: list }); // and once more when the room empties
    lastEn = list.length;
  }
}

// who the host is still waiting on before going through a door
export const waitingOn = () => [...net.peers.values()].filter((p) => !p.st || (!p.st.ready && !p.st.dead)).map((p) => p.name);
export const allDown = () => [...net.peers.values()].every((p) => p.st?.dead);
export const aliveRemote = () => (world.remotes ?? []).find((r) => !r.dead) ?? null;
