import { world } from './world.js';
import { hooks, damage, aoe, floatText, burst, heal, opponents } from './combat.js';

// ---- patrons: the old keepers of the dungeon, each with one status effect ----
// about: what the status does, for the codex
export const PATRONS = {
  cinder: { name: 'Cinder', title: 'the Burning Warden', color: 0xe07a3a, css: '#E07A3A', status: 'Burn', about: 'Burn deals damage over time, and stacks.',
    sigil: ["...#...","..##...","..###..",".#####.",".##.##.",".#...#.","..###.."], lines: ["Burn it all down, little thief.","Warm work ahead. Take this.","Let them feel the heat they kept from us."] },
  rime: { name: 'Rime', title: 'the Frozen Gaoler', color: 0x9fc0d6, css: '#9FC0D6', status: 'Chill', about: 'Chill slows; at 60% the foe freezes solid for a moment.',
    sigil: ["...#...",".#.#.#.","..###..","#######","..###..",".#.#.#.","...#..."], lines: ["Be still. Let the cold do the work.","Every cell freezes in the end.","Take my gift, and walk slowly."] },
  verdigris: { name: 'Verdigris', title: 'the Rusted Keeper', color: 0x7fa37a, css: '#7FA37A', status: 'Corrode', about: 'Corrode makes a foe take more damage from everything.',
    sigil: ["..###..",".#...#.","#..#..#","#.###.#","#..#..#",".#...#.","..###.."], lines: ["Everything rusts, given time.","Old iron, old debts. Collect them.","Rot their armor first. The rest follows."] },
  hush: { name: 'Hush', title: 'the Silent Turnkey', color: 0xb49ad0, css: '#B49AD0', status: 'Hex', about: 'A hexed foe bursts when it dies, hurting everything near it.',
    sigil: ["..###..",".##....","##.....","##.....","##.....",".##....","..###.."], lines: ["Shh. Let the dead speak for you.","They will not hear you coming.","Quiet now. Choose."] },
  gale: { name: 'Gale', title: 'the Howling Warder', color: 0xe8d25a, css: '#E8D25A', status: 'Shock', about: 'Shock jumps from the foe you hit to the nearest other foe, dealing that much damage.',
    sigil: ["....##.","...##..","..##...",".#####.","...##..","..##...",".##...."], lines: ["Faster! They are slow. You are not.","Let the storm out of its cage.","Hold on to something."] },
  knell: { name: 'Knell', title: 'the Tolling Headsman', color: 0xc8463c, css: '#C8463C', status: 'Doom', about: 'Doom strikes a moment after it lands, all at once. More Doom while it waits adds to the blow.',
    sigil: ["...#...","..###..",".#####.",".#####.",".#####.","#######","...#..."], lines: ["The bell tolls. For them, not you.","Strike once. The bell does the rest.","Every toll is a name crossed off."] },
  vigil: { name: 'Vigil', title: 'the Sleepless Sentry', color: 0x46c2a8, css: '#46C2A8', status: 'Mark', about: 'Your next hit on a marked foe is a Critical, dealing that much more damage.',
    sigil: [".......","..###..",".#...#.","#..#..#",".#...#.","..###..","......."], lines: ["I never sleep. Neither should your blade.","I see where they are weak. Now so do you.","Watch. Wait. Strike true."] },
};

export const RARITY = [
  { id: 'common', name: 'Common', mult: 1, css: '#D4C5AC' },
  { id: 'rare', name: 'Rare', mult: 1.5, css: '#7FB2D9' },
  { id: 'epic', name: 'Epic', mult: 2, css: '#B57BD6' },
  { id: 'legendary', name: 'Legendary', mult: 1, css: '#E8A33C' },
  { id: 'duo', name: 'Duo', mult: 1, css: '#E7D6BC' },
];
const R = Object.fromEntries(RARITY.map((r) => [r.id, r]));

export const SLOT_NAME = { attack: 'Attack', special: 'Special', cast: 'Cast', dash: 'Dash' };
const GLYPH = { attack: 'A', special: 'S', cast: 'C', dash: 'D' };

// status each patron applies through its slot boons, with the per-hit strength those boons start at
const APPLY = {
  cinder: (t, v) => addStatus(t, 'burn', v),     // v damage per second, stacking
  rime: (t, v) => addStatus(t, 'chill', v),      // v% slow; 60% freezes
  verdigris: (t, v) => addStatus(t, 'corrode', v), // v% more damage taken
  hush: (t, v) => addStatus(t, 'hex', v),        // explodes for v when it dies
  gale: (t, v) => shock(t, v),                    // v damage to the nearest other foe, at once
  knell: (t, v) => addStatus(t, 'doom', v),       // v damage 1.2 s later, piling up meanwhile
  vigil: (t, v) => addStatus(t, 'mark', v),       // next hit is a Critical for +v%
};
const BASE = { cinder: 3, rime: 12, verdigris: 6, hush: 25, gale: 6, knell: 10, vigil: 50 };
// Damage on slot boons is the same for every patron; only the status differs. `k` is the boon's rarity x level multiplier.
const SPECIAL_BONUS = 25, CAST_BURST = 18, DASH_BURST = 10;
const kOf = (pid, v) => v / BASE[pid];
const UNIT = { cinder: ' Burn', rime: '% Chill', verdigris: '% Corrode', hush: ' Hex', gale: ' Shock', knell: ' Doom', vigil: '% Mark' };

// 4 slot boons per patron, generated from the same shape so every patron covers every move
const SLOT_BOONS = Object.keys(PATRONS).flatMap((pid) => [
  { slot: 'attack', name: { cinder: 'Searing Strike', rime: 'Frostbite Strike', verdigris: 'Rusted Strike', hush: 'Hushed Strike', gale: 'Static Strike', knell: 'Tolling Strike', vigil: 'Watchful Strike' }[pid],
    desc: (v) => `Your Attack inflicts ${v}${UNIT[pid]}.`, base: BASE[pid] },
  { slot: 'special', name: { cinder: 'Blazing Flourish', rime: 'Glacial Flourish', verdigris: 'Corroding Flourish', hush: 'Silent Flourish', gale: 'Thunder Flourish', knell: 'Funeral Flourish', vigil: 'Piercing Flourish' }[pid],
    desc: (v) => `Your Special deals +${Math.round(SPECIAL_BONUS * kOf(pid, v))}% damage and inflicts ${v * 2}${UNIT[pid]}.`, base: BASE[pid] },
  { slot: 'cast', name: { cinder: 'Flare Shard', rime: 'Rime Shard', verdigris: 'Acid Shard', hush: 'Grave Shard', gale: 'Storm Shard', knell: 'Bell Shard', vigil: 'Seeker Shard' }[pid],
    desc: (v) => `Your Cast bursts on impact for ${Math.round(CAST_BURST * kOf(pid, v))} damage and inflicts ${v * 2}${UNIT[pid]}.`, base: BASE[pid] },
  { slot: 'dash', name: { cinder: 'Ember Step', rime: 'Frost Step', verdigris: 'Rust Step', hush: 'Shade Step', gale: 'Spark Step', knell: 'Mourning Step', vigil: 'Sentry Step' }[pid],
    desc: (v) => `Your Dash leaves a burst that deals ${Math.round(DASH_BURST * kOf(pid, v))} damage and inflicts ${v}${UNIT[pid]}.`, base: BASE[pid] },
].map((b) => ({ ...b, id: `${pid}_${b.slot}`, patron: pid })));

// passives, legendaries and duos: numbers scale with rarity and level through `v`
const OTHER_BOONS = [
  { id: 'kindling', patron: 'cinder', name: 'Kindling', base: 25, desc: (v) => `Burn deals +${v}% damage.` },
  { id: 'heatwithin', patron: 'cinder', name: 'Heat Within', base: 15, desc: (v) => `Deal +${v}% damage to burning foes.` },
  { id: 'brittle', patron: 'rime', name: 'Brittle', base: 30, desc: (v) => `Frozen foes take +${v}% damage.` },
  { id: 'coldblood', patron: 'rime', name: 'Cold Blood', base: 20, desc: (v) => `Take ${v}% less damage from chilled foes.` },
  { id: 'oldiron', patron: 'verdigris', name: 'Old Iron', base: 20, desc: (v) => `+${v} max health, and heal that much now.`, onTake: (p, v) => { p.maxHp += v; heal(p, v); } },
  { id: 'greencoin', patron: 'verdigris', name: 'Green Coin', base: 2, desc: (v) => `Gain +${v} Ash from every kill.` },
  { id: 'lastrites', patron: 'hush', name: 'Last Rites', base: 3, desc: (v) => `Heal ${v} whenever a hexed foe dies.` },
  { id: 'echo', patron: 'hush', name: 'Echo', base: 30, desc: (v) => `Hex blasts are ${v}% bigger and stronger.` },
  { id: 'wildfire', patron: 'cinder', name: 'Wildfire', legendary: true, base: 1, desc: () => 'Burning foes spread their Burn to everything near them when they die.' },
  { id: 'shatter', patron: 'rime', name: 'Shatter', legendary: true, base: 40, desc: (v) => `When a foe freezes, it shatters the ice around it for ${v} damage.` },
  { id: 'ruin', patron: 'verdigris', name: 'Ruin', legendary: true, base: 1, desc: () => 'Corrode can stack twice as high.' },
  { id: 'requiem', patron: 'hush', name: 'Requiem', legendary: true, base: 1, desc: () => 'Hex blasts hex every foe they hit.' },
  { id: 'tailwind', patron: 'gale', name: 'Tailwind', base: 10, desc: (v) => `Move ${v}% faster.`, onTake: (p, v) => { p.mods.speed *= 1 + v / 100; } },
  { id: 'conductor', patron: 'gale', name: 'Conductor', base: 1, desc: (v) => `Shock jumps to ${Math.round(v)} more foe${Math.round(v) > 1 ? 's' : ''}.` },
  { id: 'stormcall', patron: 'gale', name: 'Stormcall', legendary: true, base: 40, desc: (v) => `Every fifth Shock calls down a bolt on the foe you hit, for ${v} damage.` },
  // a third passive for each of the first five
  { id: 'smolder', patron: 'cinder', name: 'Smolder', base: 1.5, desc: (v) => `Burn lasts ${v}s longer.` },
  { id: 'permafrost', patron: 'rime', name: 'Permafrost', base: 40, desc: (v) => `Frozen foes stay frozen ${v}% longer.` },
  { id: 'ironskin', patron: 'verdigris', name: 'Iron Skin', base: 6, desc: (v) => `Take ${v}% less damage from everything.` },
  { id: 'lament', patron: 'hush', name: 'Lament', base: 25, desc: (v) => `Hexed foes deal ${v}% less damage.` },
  { id: 'overcharge', patron: 'gale', name: 'Overcharge', base: 30, desc: (v) => `Shock deals +${v}% damage.` },
  // Knell
  { id: 'dread', patron: 'knell', name: 'Dread', base: 25, desc: (v) => `Doom deals +${v}% damage.` },
  { id: 'gallows', patron: 'knell', name: 'Gallows', base: 4, desc: (v) => `Heal ${v} whenever Doom kills a foe.` },
  { id: 'tollunending', patron: 'knell', name: 'Toll Unending', legendary: true, base: 1, desc: () => 'When Doom kills a foe, the same Doom falls on the nearest other foe.' },
  // Vigil
  { id: 'keeneye', patron: 'vigil', name: 'Keen Eye', base: 8, desc: (v) => `Every hit has a ${v}% chance to be a Critical, for double damage.` },
  { id: 'firstwatch', patron: 'vigil', name: 'First Watch', base: 30, desc: (v) => `Deal +${v}% damage to foes at full health.` },
  { id: 'allseeing', patron: 'vigil', name: 'All-Seeing', legendary: true, base: 1, desc: () => 'A Critical Marks every foe near the one you hit.' },
  // duos with Knell
  { id: 'pyrebell', duo: ['cinder', 'knell'], name: 'Pyre Bell', base: 6, desc: (v) => `Doom also inflicts ${v} Burn when it strikes.` },
  { id: 'coldtoll', duo: ['rime', 'knell'], name: 'Cold Toll', base: 30, desc: (v) => `Doom also inflicts ${v}% Chill when it strikes.` },
  { id: 'rustbell', duo: ['verdigris', 'knell'], name: 'Rust Bell', base: 40, desc: (v) => `Doom deals +${v}% damage to corroded foes.` },
  { id: 'lastbell', duo: ['hush', 'knell'], name: 'Last Bell', base: 25, desc: (v) => `Doom hexes the foe for ${v} just before it strikes.` },
  { id: 'thunderclap', duo: ['gale', 'knell'], name: 'Thunderclap', base: 10, desc: (v) => `Doom sets off a ${v} Shock when it strikes.` },
  { id: 'executioner', duo: ['knell', 'vigil'], name: 'Executioner', base: 50, desc: (v) => `Doom always strikes as a Critical, for +${v}% damage.` },
  // duos with Vigil
  { id: 'flashpoint', duo: ['cinder', 'vigil'], name: 'Flashpoint', base: 5, desc: (v) => `Criticals inflict ${v} Burn.` },
  { id: 'frostsight', duo: ['rime', 'vigil'], name: 'Frost Sight', base: 1, desc: () => 'Hits on frozen foes are always Critical, for double damage.' },
  { id: 'weakspot', duo: ['verdigris', 'vigil'], name: 'Weak Spot', base: 10, desc: (v) => `Criticals inflict ${v}% Corrode.` },
  { id: 'markedfordeath', duo: ['hush', 'vigil'], name: 'Marked for Death', base: 50, desc: (v) => `Hexing a foe also Marks it for +${v}%.` },
  { id: 'arcsight', duo: ['gale', 'vigil'], name: 'Arc Sight', base: 10, desc: (v) => `Criticals set off a ${v} Shock.` },
  { id: 'firestorm', duo: ['cinder', 'gale'], name: 'Firestorm', base: 3, desc: (v) => `Shock also inflicts ${v} Burn on every foe it jumps to.` },
  { id: 'hailstorm', duo: ['rime', 'gale'], name: 'Hailstorm', base: 15, desc: (v) => `Shock also inflicts ${v}% Chill on every foe it jumps to.` },
  { id: 'galvanize', duo: ['verdigris', 'gale'], name: 'Galvanize', base: 40, desc: (v) => `Shock deals +${v}% damage to corroded foes.` },
  { id: 'thunderhex', duo: ['hush', 'gale'], name: 'Thunderhex', base: 8, desc: (v) => `Hex blasts set off a ${v} Shock from every foe they hit.` },
  { id: 'steamvent', duo: ['cinder', 'rime'], name: 'Steam Vent', base: 50, desc: (v) => `Foes that are both burning and chilled take +${v}% damage.` },
  { id: 'moltenrust', duo: ['cinder', 'verdigris'], name: 'Molten Rust', base: 2, desc: (v) => `Each Burn tick also adds ${v}% Corrode.` },
  { id: 'pyrerite', duo: ['cinder', 'hush'], name: 'Pyre Rite', base: 6, desc: (v) => `Hex blasts inflict ${v} Burn.` },
  { id: 'coldiron', duo: ['rime', 'verdigris'], name: 'Cold Iron', base: 30, desc: (v) => `Chilled foes deal ${v}% less damage.` },
  { id: 'stillgrave', duo: ['rime', 'hush'], name: 'Still Grave', base: 25, desc: (v) => `Hexing a foe also inflicts ${v}% Chill.` },
  { id: 'rottoll', duo: ['verdigris', 'hush'], name: 'Rot Toll', base: 40, desc: (v) => `Hex blasts deal +${v}% damage to corroded foes.` },
];

export const BOONS = Object.fromEntries([...SLOT_BOONS, ...OTHER_BOONS].map((b) => [b.id, b]));

// ---- values ----

// each level adds 40% of the boon's starting value
export const value = (b) => {
  const def = BOONS[b.id], v = def.base * R[b.rarity].mult * (1 + 0.4 * (b.level - 1));
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
};
export const describe = (b) => BOONS[b.id].desc(value(b));
const has = (p, id) => p.boons.find((b) => b.id === id);
const v = (p, id) => { const b = has(p, id); return b ? value(b) : 0; };
export const patronOf = (b) => BOONS[b.id].patron ?? null;

// ---- offering and taking ----

function rollRarity(meta) {
  const r = Math.random() - (meta?.favor ?? 0) * 0.05;
  return r < 0.07 ? 'epic' : r < 0.32 ? 'rare' : 'common';
}

// Three choices from one patron. Duos and legendaries can show up once you've earned them.
export function offerBoons(patronId, p, meta) {
  const mine = new Set(p.boons.map((b) => b.id));
  const patrons = new Set(p.boons.map(patronOf).filter(Boolean));
  const pool = Object.values(BOONS).filter((d) => d.patron === patronId && !d.legendary && !mine.has(d.id));
  const special = Object.values(BOONS).filter((d) => !mine.has(d.id) && (
    (d.legendary && d.patron === patronId && p.boons.filter((b) => patronOf(b) === patronId).length >= 2)
    || (d.duo?.includes(patronId) && d.duo.every((x) => patrons.has(x) || x === patronId) && d.duo.some((x) => x !== patronId && patrons.has(x)))));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = pool.slice(0, 3).map((d) => ({ id: d.id, rarity: rollRarity(meta), level: 1 }));
  if (special.length && Math.random() < 0.35) {
    const d = special[Math.floor(Math.random() * special.length)];
    picks[picks.length - 1] = { id: d.id, rarity: d.legendary ? 'legendary' : 'duo', level: 1 };
  }
  return picks;
}

export function takeBoon(p, boon) {
  const def = BOONS[boon.id];
  if (def.slot) p.boons = p.boons.filter((b) => BOONS[b.id].slot !== def.slot); // a slot holds one boon
  p.boons.push(boon);
  def.onTake?.(p, value(boon));
}

// what the HUD shows down the left edge
export function slotIcons(p) {
  const order = ['attack', 'special', 'cast', 'dash'];
  const slotted = order.map((s) => p.boons.find((b) => BOONS[b.id].slot === s)).filter(Boolean);
  const rest = p.boons.filter((b) => !BOONS[b.id].slot);
  return [...slotted, ...rest].map((b) => {
    const def = BOONS[b.id], pat = PATRONS[def.patron ?? def.duo[0]];
    return { color: def.duo ? R.duo.css : pat.css, glyph: def.slot ? GLYPH[def.slot] : def.duo ? '+' : '*', sigil: def.slot || def.duo || def.legendary ? null : pat.sigil, level: b.level };
  });
}

// ---- status effects on enemies ----

const STATUS_TINT = { burn: 0xe07a3a, chill: 0x9fc0d6, corrode: 0x7fa37a, hex: 0xb49ad0, shock: 0xe8d25a, doom: 0xc8463c, mark: 0x46c2a8 };

// Knell's Doom lands all at once: everything that piled up while it waited
function toll(e, val) {
  const p = world.player, exec = has(p, 'executioner');
  if (has(p, 'lastbell')) addStatus(e, 'hex', v(p, 'lastbell'));
  let dmg = val * (1 + v(p, 'dread') / 100) * (e.status?.corrode ? 1 + v(p, 'rustbell') / 100 : 1);
  if (exec) dmg *= 1 + v(p, 'executioner') / 100;
  burst(e.pos, STATUS_TINT.doom, 10);
  floatText(e.pos, 'DOOM', 'doom');
  damage(e, dmg, null, { tag: 'doom', source: p, crit: exec, heavy: true });
  if (exec) onCrit(e, 1 + v(p, 'executioner') / 100);
  if (has(p, 'pyrebell')) addStatus(e, 'burn', v(p, 'pyrebell'));
  if (has(p, 'coldtoll')) addStatus(e, 'chill', v(p, 'coldtoll'));
  if (has(p, 'thunderclap')) shock(e, v(p, 'thunderclap'));
  if (!e.dead) return;
  if (has(p, 'gallows')) heal(p, v(p, 'gallows'));
  if (has(p, 'tollunending')) {
    let next = null, best = 5;
    for (const o of opponents(0)) { const d = o.pos.distanceTo(e.pos); if (o !== e && d < best) { best = d; next = o; } }
    if (next) addStatus(next, 'doom', val);
  }
}

// Vigil: whatever made the hit a Critical, these follow it
function onCrit(t, mult) {
  const p = world.player;
  if (has(p, 'flashpoint')) addStatus(t, 'burn', v(p, 'flashpoint'));
  if (has(p, 'weakspot')) addStatus(t, 'corrode', v(p, 'weakspot'));
  if (has(p, 'arcsight')) shock(t, v(p, 'arcsight'));
  if (has(p, 'allseeing')) for (const o of opponents(0)) if (o !== t && o.pos.distanceTo(t.pos) < 2.5) addStatus(o, 'mark', (mult - 1) * 100);
}

// Gale's Shock is instant, not a lingering status: lightning leaps from the foe you hit to the nearest other one
function shock(t, val) {
  const p = world.player, jumps = 1 + Math.round(v(p, 'conductor'));
  const hit = new Set([t]);
  let from = t;
  for (let i = 0; i < jumps; i++) {
    let next = null, best = 4;
    for (const o of opponents(0)) {
      if (hit.has(o)) continue;
      const d = o.pos.distanceTo(from.pos);
      if (d < best) { best = d; next = o; }
    }
    if (!next) break;
    hit.add(next);
    burst(from.pos, STATUS_TINT.shock, 3);
    burst(next.pos, STATUS_TINT.shock, 5);
    damage(next, val * (1 + v(p, 'overcharge') / 100) * (next.status?.corrode ? 1 + v(p, 'galvanize') / 100 : 1), from.pos, { tag: 'status', quiet: true, color: 'shock' });
    if (has(p, 'firestorm')) addStatus(next, 'burn', v(p, 'firestorm'));
    if (has(p, 'hailstorm')) addStatus(next, 'chill', v(p, 'hailstorm'));
    from = next;
  }
  if (has(p, 'stormcall') && (p.shocks = (p.shocks ?? 0) + 1) % 5 === 0 && !t.dead) {
    aoe(p, { pos: t.pos.clone(), radius: 1.6, damage: v(p, 'stormcall'), knockback: 4, tag: 'status', color: STATUS_TINT.shock });
  }
}

function addStatus(t, kind, amount) {
  if (t.dead || t.team !== 1) return;
  const p = world.player, s = (t.status ??= {});
  if (kind === 'burn') s.burn = { dps: Math.min((s.burn?.dps ?? 0) + amount, 40), t: 3 + v(p, 'smolder'), tick: s.burn?.tick ?? 0.5 };
  if (kind === 'chill') {
    const c = Math.min((s.chill?.v ?? 0) + amount, 60);
    s.chill = { v: c, t: 3 };
    if (c >= 60) {
      // frozen solid: a free opening
      s.chill = null;
      const hold = 1.4 * (1 + v(p, 'permafrost') / 100);
      t.stun = Math.max(t.stun, hold * (t.stunResist ?? 1));
      t.frozen = hold;
      floatText(t.pos, 'FROZEN', 'status');
      if (has(p, 'shatter')) aoe(p, { pos: t.pos, radius: 2, damage: v(p, 'shatter'), knockback: 3, tag: 'status', color: STATUS_TINT.chill });
    }
  }
  if (kind === 'corrode') s.corrode = { v: Math.min((s.corrode?.v ?? 0) + amount, has(p, 'ruin') ? 100 : 50), t: 5 };
  if (kind === 'hex') {
    s.hex = { v: Math.max(s.hex?.v ?? 0, amount), t: 6 };
    if (has(p, 'stillgrave')) addStatus(t, 'chill', v(p, 'stillgrave'));
    if (has(p, 'markedfordeath')) addStatus(t, 'mark', v(p, 'markedfordeath'));
  }
  if (kind === 'doom') s.doom = { v: Math.min((s.doom?.v ?? 0) + amount, 300), t: s.doom?.t ?? 1.2 };
  if (kind === 'mark') s.mark = { v: Math.max(s.mark?.v ?? 0, amount), t: 4 };
  burst(t.pos, STATUS_TINT[kind], 3);
}

export function updateStatus(e, dt) {
  const s = e.status;
  e.speedMul = 1;
  e.statusTint = null;
  if (e.frozen > 0) e.frozen -= dt;
  if (!s) return;
  const p = world.player;
  if (s.burn) {
    s.burn.t -= dt; s.burn.tick -= dt;
    if (s.burn.tick <= 0) {
      s.burn.tick = 0.5;
      damage(e, s.burn.dps * 0.5 * (1 + v(p, 'kindling') / 100), null, { tag: 'status', quiet: true, color: 'burn' });
      if (has(p, 'moltenrust')) addStatus(e, 'corrode', v(p, 'moltenrust'));
    }
    if (s.burn.t <= 0) s.burn = null;
    e.statusTint = STATUS_TINT.burn;
  }
  if (s.chill) {
    s.chill.t -= dt;
    e.speedMul *= 1 - s.chill.v / 100;
    if (s.chill.t <= 0) s.chill = null;
    e.statusTint = STATUS_TINT.chill;
  }
  if (s.corrode) { s.corrode.t -= dt; if (s.corrode.t <= 0) s.corrode = null; else e.statusTint ??= STATUS_TINT.corrode; }
  if (s.hex) { s.hex.t -= dt; if (s.hex.t <= 0) s.hex = null; else e.statusTint ??= STATUS_TINT.hex; }
  if (s.mark) { s.mark.t -= dt; if (s.mark.t <= 0) s.mark = null; else e.statusTint ??= STATUS_TINT.mark; }
  if (s.doom) {
    s.doom.t -= dt;
    e.statusTint = STATUS_TINT.doom;
    if (s.doom.t <= 0) { const val = s.doom.v; s.doom = null; toll(e, val); }
  }
}

// ---- hooks the combat code calls ----

// damage multiplier for a player hit on an enemy
hooks.dmgMult = (t, tag) => {
  const p = world.player, s = t.status ?? {};
  let m = 1 + (s.corrode?.v ?? 0) / 100;
  if (tag === 'status') return m;
  if (s.burn) m *= 1 + v(p, 'heatwithin') / 100;
  if (t.frozen > 0) m *= 1 + v(p, 'brittle') / 100;
  if (s.burn && s.chill) m *= 1 + v(p, 'steamvent') / 100;
  if (t.hp >= t.maxHp) m *= 1 + v(p, 'firstwatch') / 100;
  const slot = slotBoon(p, tag);
  if (slot && tag === 'special') m *= 1 + SPECIAL_BONUS / 100 * kOf(patronOf(slot), value(slot));
  return m;
};

function slotBoon(p, tag) {
  return p.boons.find((b) => BOONS[b.id].slot === tag) ?? null;
}

// a player hit that isn't already a Critical: a Mark makes it one (and is spent), or a Vigil boon's luck does
hooks.crit = (t, tag) => {
  if (tag === 'status') return 1;
  const p = world.player, s = t.status ?? {};
  let c = 1;
  if (s.mark) { c = 1 + s.mark.v / 100; s.mark = null; }
  else if (t.frozen > 0 && has(p, 'frostsight')) c = 2;
  else if (Math.random() < v(p, 'keeneye') / 100) c = 2;
  if (c > 1) onCrit(t, c);
  return c;
};

// after a player hit lands: slot boons apply their patron's status
hooks.onHit = (t, tag) => {
  const p = world.player, b = slotBoon(p, tag);
  if (!b || tag === 'cast' || tag === 'dash') return;
  APPLY[patronOf(b)](t, tag === 'special' ? value(b) * 2 : value(b));
};

// cast impact: the cast boon turns the shard into a burst
hooks.onCast = (pos) => {
  const p = world.player, b = slotBoon(p, 'cast');
  if (!b) return;
  const pid = patronOf(b), val = value(b);
  aoe(p, { pos, radius: 2, damage: CAST_BURST * kOf(pid, val), knockback: 4, tag: 'cast-burst', color: PATRONS[pid].color, onEach: (t) => APPLY[pid](t, val * 2) });
};

hooks.onDash = (pos) => {
  const p = world.player, b = slotBoon(p, 'dash');
  if (!b) return;
  const pid = patronOf(b), val = value(b);
  aoe(p, { pos, radius: 1.6, damage: DASH_BURST * kOf(pid, val), knockback: 3, tag: 'dash-burst', color: PATRONS[pid].color, onEach: (t) => APPLY[pid](t, val) });
};

// damage the player takes from an enemy
hooks.playerHurt = (src, amount) => {
  const p = world.player;
  if (src?.status?.chill) amount *= (1 - v(p, 'coldblood') / 100) * (1 - v(p, 'coldiron') / 100);
  if (src?.status?.hex) amount *= 1 - v(p, 'lament') / 100;
  return amount * (1 - Math.min(60, v(p, 'ironskin')) / 100);
};

hooks.onKill = (e) => {
  const p = world.player, s = e.status ?? {};
  if (has(p, 'greencoin')) { world.run.ash += v(p, 'greencoin'); }
  if (s.burn && has(p, 'wildfire')) for (const o of opponents(0)) if (o !== e && o.pos.distanceTo(e.pos) < 2.5) addStatus(o, 'burn', s.burn.dps);
  if (s.hex) {
    const big = 1 + v(p, 'echo') / 100;
    if (has(p, 'lastrites')) heal(p, v(p, 'lastrites'));
    aoe(p, {
      pos: e.pos.clone(), radius: 2.4 * Math.sqrt(big), damage: s.hex.v * big, knockback: 6, tag: 'hex', color: STATUS_TINT.hex,
      dmgFn: (t) => (t.status?.corrode ? 1 + v(p, 'rottoll') / 100 : 1),
      onEach: (t) => {
        if (has(p, 'requiem')) addStatus(t, 'hex', s.hex.v);
        if (has(p, 'pyrerite')) addStatus(t, 'burn', v(p, 'pyrerite'));
        if (has(p, 'thunderhex')) shock(t, v(p, 'thunderhex'));
      },
    });
  }
};
