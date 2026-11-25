import { CLASSES, CAST, WEAPONS } from './classes.js';
import { BESTIARY, AFFIXES } from './enemies.js';
import { PATRONS, BOONS, describe } from './boons.js';
import { PERKS, UPGRADES } from './run.js';
import { settings, ACTIONS } from './settings.js';
import { keyName, padName } from './input.js';
import { FEATS, hasFeat } from './feats.js';

// The encyclopedia, built from the game's own data so it can't go out of date.
// The in-game Codex shows one section at a time; the wiki site prints them all.
export const TABS = ['Classes', 'Enemies', 'Patrons', 'Biomes', 'Upgrades', 'Feats', 'Controls'];

// img is a picture rendered from the game (test/shots.js); `base` is where those live for whoever shows the codex
let base = 'assets/shots/';
const entry = (title, body, color, img, wide = false) => `<article class="entry"${color ? ` style="--c:${color}"` : ''}>${img ? `<img class="${wide ? 'wide' : 'portrait'}" src="${base}${img}.png" alt="" loading="lazy">` : ''}<h3>${title}</h3>${body}</article>`;
const boonLine = (b, rarity, extra = '') => `<li><b>${b.name}</b>${extra}: ${describe({ id: b.id, rarity, level: 1 })}</li>`;

// mine: mark the ones this save has earned (the wiki shows the plain list)
const feats = (mine) => entry('Feats', `<p>One-time goals in every mode. Each pays its ash the moment you earn it.</p><ul>${FEATS.map((f) =>
  `<li><b>${mine && hasFeat(f.id) ? '&#9670; ' : ''}${f.name}</b> (${f.ash} ash): ${f.desc}</li>`).join('')}</ul>`);
export const FEATS_WIKI = () => feats(false);

const classEntry = (c, img) => entry(c.name, `
    <p>${c.blurb}</p>
    <p class="stat">Health ${c.hp}, speed ${c.speed}. ${c.passive}.</p>
    <dl>
      <dt>Attack</dt><dd>${c.attack.name}. ${c.attack.desc}.</dd>
      ${c.special ? `<dt>Special</dt><dd>${c.special.name}. ${c.special.desc}.</dd>` : ''}
      <dt>Cast</dt><dd>${CAST.name}. ${CAST.desc}</dd>
      <dt>Dash</dt><dd>${c.dash.name}${c.dash.charges > 1 ? `, ${c.dash.charges} charges` : ''}.</dd>
    </dl>`, null, img);
const foe = (e, growth) => entry(e.boss ? `${e.name}, ${e.title}` : e.name, `<p>${e.about}</p><p class="stat">${e.boss ? 'Boss. ' : ''}Base health ${e.hp}, ${growth}</p>`, e.boss ? 'var(--crimson)' : null, 'enemy-' + e.id);
const dungeonGrowth = (e) => `rising with depth.${e.boss ? '' : ' Elites are bigger, armored and tinted crimson.'}`;
const foes = (ids, growth) => BESTIARY.filter((e) => ids.includes(e.id)).map((e) => foe(e, typeof growth === 'function' ? growth(e) : growth)).join('');
const DUNGEON_FOES = BESTIARY.map((e) => e.id);
const ELITES = () => entry('Elites', `<p>Bigger, armoured and tinted crimson, more common the deeper you go. Each carries one affix, named over its head as it rises:</p><ul>${Object.values(AFFIXES).map((a) => `<li><b>${a.name}</b>: ${a.about}.</li>`).join('')}</ul>`, 'var(--crimson)');

const DEPTHS = [
  ['The Keep', 'Where every Dungeon run starts and ends: the last dry room above the dungeon. The Anvil is in one corner. The vow altar is in the other: swear vows (faster foes, tougher foes, no healing, no Last Breath, more elites, or taking more damage) and every Dungeon run pays more ash, up to +115% with all six; the gate takes you to class select and down.', 'keep'],
  ['The Cells', 'Depths 1 and 2 of every ten. Warm stone and orange torchlight.', 'cells'],
  ['The Crypt', 'Depths 3 to 5. Cold blue fire and great stone slabs.', 'crypt'],
  ['The Rot', 'Depths 6 to 8. Green light, broken floors and rubble everywhere.', 'rot'],
  ["The Warden's Halls", 'A boss waits at depth 9: the Warden, the Hollow Prior or the Reaver, chosen at random. The Lock comes after: pay one key to escape, or take a door and go deeper.', 'halls'],
  ['The Sunken Vaults', 'Below the first Lock the stairs run into water: depths 11 to 18. Sea-green fire and standing water, and the drowned in place of the dry dead.', 'vaults'],
  ['The Drowned Throne', 'Depth 19, where the Drowned King waits. Past him, the Lock again.', 'throne'],
  ['The Ember Forges', 'Below the second Lock the dungeon runs hot: depths 21 to 28. Molten light and slag pools, worked by cinderlings that burst when they die, smelters that throw molten iron, and armoured anvilbacks.', 'forge'],
  ['The Crucible', 'Depth 29, where the Forgemaster waits. Past him, the Lock again, and the three regions start over: each ten depths harder than the last.', 'crucible'],
];
const BIOMES = DEPTHS;
const biome = ([n, t, id]) => entry(n, `<p>${t}</p>`, null, 'biome-' + id, true);
// what can wait behind a door
const ROOMS = () => entry('Rooms', `<p>Each door shows what waits behind it.</p><dl>
  <dt>Fights</dt><dd>Clear the room for the reward shown on the door: a patron's boon, ash, a key, healing or a Keystone.</dd>
  <dt>Elite rooms</dt><dd>From depth 3: tougher fights, with brutes and more elites, for a better reward.</dd>
  <dt>Fountains</dt><dd>From depth 2: drink to heal half your health. No fight.</dd>
  <dt>Vaults</dt><dd>Locked: spend a key for a boon and healing, no fight.</dd>
  <dt>The Peddler</dt><dd>From depth 3: a hooded trader who sells healing, keys, boons, Keystones and max health for the ash you carry this run. Each once per visit.</dd>
  <dt>Shrines</dt><dd>From depth 4: strike one bargain. Blood Price trades max health for an Epic boon; Iron Debt and Glass Pact pay up front, then make the next three fights harder.</dd>
  <dt>Trials</dt><dd>From depth 3, crossed blades on the door: a fight with a condition, named as you walk in. Take no hits, or clear it before the time runs out. Pass for an Epic boon; fail and you get a little ash.</dd>
  <dt>Chests</dt><dd>From depth 2: a room with one chest and no fight. Open it for a heap of ash and a key, or it is an ambush: the doors shut on a wave of elites, and surviving pays a Keystone and more ash. You can always walk past it.</dd>
  <dt>The Lock</dt><dd>Every tenth depth: pay a key to escape with your ash, or go deeper.</dd>
</dl>`);

// each class's three weapons; all but the first are bought once, with ash, on class select
const weaponsEntry = (id) => entry(`${CLASSES[id].name}'s weapons`, `<p>Press up or down on class select to look through them.</p><dl>${WEAPONS[id].map((w) =>
  `<dt>${w.name}${w.cost ? ` (${w.cost} ash)` : ''}</dt><dd>${w.desc} Attack: ${(w.attack ?? CLASSES[id].attack).name}. Special: ${(w.special ?? CLASSES[id].special).name}.</dd>`).join('')}</dl>`);
const HARDCORE = () => entry('Hardcore', '<p>A switch in Settings, for when it gets easy. Enemies have 50% more health and hit 50% harder, elites turn up more often, and your Anvil upgrades stay switched off. Weapons you own still work.</p>');

const SECTIONS = [
  () => Object.entries(CLASSES).map(([id, c]) => classEntry(c, 'class-' + id)).join('') + Object.keys(CLASSES).map(weaponsEntry).join(''),

  () => ELITES() + BESTIARY.map((e) => foe(e, dungeonGrowth(e))).join(''),

  () => Object.entries(PATRONS).map(([id, p]) => {
    const own = Object.values(BOONS).filter((b) => b.patron === id);
    const list = own.map((b) => boonLine(b, b.legendary ? 'legendary' : 'common', b.slot ? ` (${b.slot})` : b.legendary ? ' (legendary)' : '')).join('');
    return entry(`${p.name}, ${p.title}`, `<p>Inflicts ${p.status}. ${p.about} Numbers shown are for a Common boon at level 1.</p><ul>${list}</ul>`, p.css);
  }).join('')
    + entry('Duo boons', `<p>Offered once you carry boons from both patrons.</p><ul>${Object.values(BOONS).filter((b) => b.duo)
      .map((b) => boonLine(b, 'duo', ` (${b.duo.map((d) => PATRONS[d].name).join(' and ')})`)).join('')}</ul>`)
    + entry('Rarity and Keystones', '<p>Common, Rare and Epic boons are worth 1, 1.5 and 2 times their base. A Keystone raises one boon by a level; each level adds 40% of its starting value. A new boon for a move replaces the old one in that slot. Boon doors lean towards patrons you have already taken a boon from; once you have boons from three patrons, only those three appear for the rest of the run.</p>'),

  () => BIOMES.map(biome).join('') + ROOMS(),

  () => entry('The Anvil', `<p>Spend ash between runs, at the Anvil in the Keep. These last forever.</p><ul>${UPGRADES.map((u) => `<li><b>${u.name}</b>: ${u.desc} (up to ${u.max})</li>`).join('')}</ul>`)
    + entry('Level-up perks', `<p>Kills give XP. Each level lets you pick one of three perks once the room is clear.</p><ul>${PERKS.map((k) => `<li><b>${k.name}</b>: ${k.desc}</li>`).join('')}</ul>`)
    + HARDCORE()
    + entry('Daily Run', '<p>On the Play menu. One dungeon a day, the same for everyone: the day picks the class, the vow and the seed, everyone gets the first weapon, and the Anvil stays switched off. Your score is depth times 100, plus kills, plus 500 for escaping through a Lock; your best one each day goes on the shared board.</p>'),

  () => feats(true),

  () => entry('Moves', `<p>Change these in Settings.</p><dl>${ACTIONS.map((a) => `<dt>${a[0].toUpperCase() + a.slice(1)}</dt><dd>${settings.keys[a].map(keyName).join(' or ')}, or ${padName(settings.pad[a])} on a controller</dd>`).join('')}</dl>`)
    + entry('Moving and menus', '<p>Move with WASD, the arrow keys or the left stick. Aim with the mouse or the right stick. In menus, Enter or A selects, Esc or B goes back, and Tab or Y opens extras.</p>')
    + entry('Perfect dodge', '<p>Dash through an attack just as it lands. Time slows for a moment, and your hits deal 50% more for a second and a half.</p>')
    + entry('Quick chat', '<p>Number keys send an emoji over your head: 1 👍, 2 👎, 3 💩, 4 😂, 5 🔥, 6 💀, 7 ❤️, 8 😭, 9 😎, 0 👋. Hold Shift for ten more: 🤡 🎉 😡 🙏 🤝 👀 💯 🗿 🐐 🤯. On a phone, tap the speech bubble. On a controller, the d-pad sends 👍 (up), 👎 (down), 💩 (left) and 😂 (right); hold LT or press in the right stick for a wheel of all twenty, point the right stick at one and let go. In co-op everyone sees them.</p>')
    + entry('Co-op', '<p>The Co-op card on the Play menu: up to four players in one Dungeon run. One player hosts a room and shares its four-letter code; the others join with it. In the lobby, set your name, color, emoji icon, class and weapon (left and right change them); everyone in the room sees them, and your color rings your hero in the run. Each of you plays your own hero, with your own boons and rewards. The host picks the doors, once everyone has collected their reward. Foes go for whoever is nearest. Fall, and you watch until the room is won, then get back up at 40% health; the run ends when everyone is down, or when the host takes the Lock. Vows are left at home for co-op.</p>')
    + entry('Reading a fight', '<p>Coloured squares over a foe show what you have done to it: orange Burn, pale blue Chill, green Corrode, lilac Hex, blinking red Doom, teal Mark, white Frozen. The screen edge pulses red when you are below 30% health. Pause to read every boon you carry.</p>')
    + entry('On a phone', '<p>Hold it sideways. Drag anywhere on the left half of the screen to move, and use the buttons on the right. You face the nearest enemy on your own. Tap menus and hints directly.</p>'),
];

export const codexBody = (i, imgBase = 'assets/shots/') => { base = imgBase; return SECTIONS[i](); };

// The wiki's main section; each part is [title, () => entries]
export const MODES = [
  {
    id: 'dungeon', name: 'The Dungeon', art: 'card-dungeon',
    intro: 'Start in the Keep, pick a class and a weapon, and descend. Every room you clear pays out a boon, a key or ash, and it gets harder the deeper you go. New here? The Tutorial card on the Play menu teaches the moves in one quiet room.',
    parts: [
      ['Classes', () => Object.entries(CLASSES).map(([id, c]) => classEntry(c, 'class-' + id)).join('')],
      ['Weapons', () => Object.keys(CLASSES).map(weaponsEntry).join('')],
      ['The Keep and the depths', () => DEPTHS.map(biome).join('')],
      ['Rooms', ROOMS],
      ['Enemies and bosses', () => ELITES() + foes(DUNGEON_FOES, dungeonGrowth)],
      ['Patrons and boons', SECTIONS[2]],
      ['Upgrades', SECTIONS[4]],
    ],
  },
];
// the wiki renders a part with its own picture folder
export const wikiPart = (part, imgBase) => { base = imgBase; return part(); };
export const CONTROLS = SECTIONS[6];
