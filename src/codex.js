import { CLASSES, CAST, SMITH } from './classes.js';
import { BESTIARY } from './enemies.js';
import { PATRONS, BOONS, describe } from './boons.js';
import { PERKS, UPGRADES } from './run.js';
import { settings, ACTIONS } from './settings.js';
import { keyName, padName } from './input.js';
import { RECIPES, costText } from './wild.js';
import { CHAPTERS, FORGE, FORGE_MAX } from './adventure.js';

// The encyclopedia, built from the game's own data so it can't go out of date.
// The in-game Codex shows one section at a time; the wiki site prints them all.
export const TABS = ['Classes', 'Enemies', 'Patrons', 'Biomes', 'Upgrades', 'Controls'];

// img is a picture rendered from the game (test/shots.js); `base` is where those live for whoever shows the codex
let base = 'assets/shots/';
const entry = (title, body, color, img, wide = false) => `<article class="entry"${color ? ` style="--c:${color}"` : ''}>${img ? `<img class="${wide ? 'wide' : 'portrait'}" src="${base}${img}.png" alt="" loading="lazy">` : ''}<h3>${title}</h3>${body}</article>`;
const boonLine = (b, rarity, extra = '') => `<li><b>${b.name}</b>${extra}: ${describe({ id: b.id, rarity, level: 1 })}</li>`;

// a grounded class (the swordsmith) has no special and no cast
const classEntry = (c, img) => entry(c.name, `
    <p>${c.blurb}</p>
    <p class="stat">Health ${c.hp}, speed ${c.speed}. ${c.passive}.</p>
    <dl>
      <dt>Attack</dt><dd>${c.attack.name}. ${c.attack.desc}.</dd>
      ${c.special ? `<dt>Special</dt><dd>${c.special.name}. ${c.special.desc}.</dd>` : ''}
      ${c.grounded ? '' : `<dt>Cast</dt><dd>${CAST.name}. ${CAST.desc}</dd>`}
      <dt>Dash</dt><dd>${c.dash.name}${c.dash.charges > 1 ? `, ${c.dash.charges} charges` : ''}.</dd>
    </dl>`, null, img);
const foe = (e, growth) => entry(e.boss ? `${e.name}, ${e.title}` : e.name, `<p>${e.about}</p><p class="stat">${e.boss ? 'Boss. ' : ''}Base health ${e.hp}, ${growth}</p>`, e.boss ? 'var(--crimson)' : null, 'enemy-' + e.id);
const dungeonGrowth = (e) => `rising with depth.${e.boss ? '' : ' Elites are bigger, armored and tinted crimson.'}`;
const foes = (ids, growth) => BESTIARY.filter((e) => ids.includes(e.id)).map((e) => foe(e, typeof growth === 'function' ? growth(e) : growth)).join('');
const WILDS_FOES = ['zombie', 'crawler', 'bloater'], STORY_FOES = ['bandit', 'crossbowman', 'guard', 'soldier', 'captain', 'blackknight'];
const DUNGEON_FOES = BESTIARY.map((e) => e.id).filter((id) => !WILDS_FOES.includes(id) && !STORY_FOES.includes(id));

const BIOMES = [
  ['The Cells', 'Depths 1 and 2 of every ten. Warm stone and orange torchlight.', 'cells'],
  ['The Crypt', 'Depths 3 to 5. Cold blue fire and great stone slabs.', 'crypt'],
  ['The Rot', 'Depths 6 to 8. Green light, broken floors and rubble everywhere.', 'rot'],
  ["The Warden's Halls", 'A boss waits at depth 9: the Warden, the Hollow Prior or the Reaver, chosen at random. The Lock comes after: pay one key to escape, or take a door and go deeper. The cycle repeats every ten depths, and each lap is harder.', 'halls'],
  ['The Swordsmith', "Adventure mode: a story in six chapters, from your village down the King's Road, through the castle wall, courtyard and great hall, to the Black Knight at the top of the tower. No magic: Attack is one swing that lands a moment after you start it, and Dash is one step back. Coin and iron from the men you beat buy a better blade and mail at your forge between chapters. Every chapter start is saved; falling sends you back to it.", 'adventure'],
  ['The Wilds', 'The Open World mode: a huge island of meadow, forest, rock and lakes. Press Use by trees, rocks and bushes for wood, stone and fiber, and Tab, C or the View button to craft campfires, barricades, bandages and whetstones. Zombies rise every night and burn at dawn, and each dawn brings a boon.', 'wilds'],
];
const biome = ([n, t, id]) => entry(n, `<p>${t}</p>`, null, 'biome-' + id, true);

const SECTIONS = [
  () => Object.entries(CLASSES).map(([id, c]) => classEntry(c, 'class-' + id)).join(''),

  () => BESTIARY.map((e) => foe(e, dungeonGrowth(e))).join(''),

  () => Object.entries(PATRONS).map(([id, p]) => {
    const own = Object.values(BOONS).filter((b) => b.patron === id);
    const list = own.map((b) => boonLine(b, b.legendary ? 'legendary' : 'common', b.slot ? ` (${b.slot})` : b.legendary ? ' (legendary)' : '')).join('');
    return entry(`${p.name}, ${p.title}`, `<p>Inflicts ${p.status}. Numbers shown are for a Common boon at level 1.</p><ul>${list}</ul>`, p.css);
  }).join('')
    + entry('Duo boons', `<p>Offered once you carry boons from both patrons.</p><ul>${Object.values(BOONS).filter((b) => b.duo)
      .map((b) => boonLine(b, 'duo', ` (${b.duo.map((d) => PATRONS[d].name).join(' and ')})`)).join('')}</ul>`)
    + entry('Rarity and Keystones', '<p>Common, Rare and Epic boons are worth 1, 1.5 and 2 times their base. A Keystone raises one boon by a level; each level adds 40% of its starting value. A new boon for a move replaces the old one in that slot.</p>'),

  () => BIOMES.map(biome).join(''),

  () => entry('The Anvil', `<p>Spend ash between runs. These last forever.</p><ul>${UPGRADES.map((u) => `<li><b>${u.name}</b>: ${u.desc} (up to ${u.max})</li>`).join('')}</ul>`)
    + entry('Level-up perks', `<p>Kills give XP. Each level lets you pick one of three perks once the room is clear.</p><ul>${PERKS.map((k) => `<li><b>${k.name}</b>: ${k.desc}</li>`).join('')}</ul>`),

  () => entry('Moves', `<p>Change these in Settings.</p><dl>${ACTIONS.map((a) => `<dt>${a[0].toUpperCase() + a.slice(1)}</dt><dd>${settings.keys[a].map(keyName).join(' or ')}, or ${padName(settings.pad[a])} on a controller</dd>`).join('')}</dl>`)
    + entry('Moving and menus', '<p>Move with WASD, the arrow keys or the left stick. Aim with the mouse or the right stick. In menus, Enter or A selects, Esc or B goes back, and Tab or Y opens extras.</p>')
    + entry('On a phone', '<p>Hold it sideways. Drag anywhere on the left half of the screen to move, and use the buttons on the right. You face the nearest enemy on your own. Tap menus and hints directly.</p>'),
];

export const codexBody = (i, imgBase = 'assets/shots/') => { base = imgBase; return SECTIONS[i](); };

// The wiki is laid out by the three ways to play; each part is [title, () => entries]
export const MODES = [
  {
    id: 'dungeon', name: 'The Dungeon', art: 'card-dungeon',
    intro: 'Pick a class and descend. Every room you clear pays out a boon, a key or ash, and it gets harder the deeper you go. New here? The Tutorial card on the Play menu teaches the moves in one quiet room.',
    parts: [
      ['Classes', SECTIONS[0]],
      ['Depths', () => BIOMES.slice(0, 4).map(biome).join('')],
      ['Enemies and bosses', () => foes(DUNGEON_FOES, dungeonGrowth)],
      ['Patrons and boons', SECTIONS[2]],
      ['Upgrades', SECTIONS[4]],
    ],
  },
  {
    id: 'wilds', name: 'The Wilds', art: 'card-open',
    intro: 'The Open World card, in beta. A huge wild island with no dungeon in sight: gather and build by day, and keep a fire lit when the dead rise at night. How many nights can you last?',
    parts: [
      ['The island', () => entry('The Wilds', "<p>Meadow, forest, rock and lakes, far bigger than any room. You play one of the Dungeon's three classes. Zombies rise every night and burn at dawn, and each dawn brings a boon. Crawlers join from the second night, bloaters from the third.</p>", null, 'biome-wilds', true)],
      ['Gathering and crafting', () => entry('Crafting', `<p>Press Use by trees, rocks and bushes for wood, stone and fiber. Craft with Tab, C, the View button, or the CRAFT button on a phone.</p><ul>${RECIPES.map((r) => `<li><b>${r.name}</b> (${costText(r)}): ${r.desc}</li>`).join('')}</ul>`)],
      ['The dead', () => foes(WILDS_FOES, 'more each night. From the third night some are elites: bigger, armored and tinted crimson.')],
    ],
  },
  {
    id: 'adventure', name: 'Adventure', art: 'card-adventure',
    intro: 'A story in six chapters. You are a village swordsmith, the castle has fallen to a black knight, and the princess is locked in the tower. No magic: one sword, and the mail you forge yourself.',
    parts: [
      ['The swordsmith', () => classEntry(SMITH, null) + biome(BIOMES[4])],
      ['Chapters', () => entry('The road to the tower', `<p>Every chapter start is saved. Fall, and you go back to the start of that chapter with your forge work kept.</p><ol>${CHAPTERS.map((c) => `<li><b>${c.title}</b>: ${c.sub}</li>`).join('')}</ol>`)],
      ['The forge', () => entry('Your forge', `<p>Coin and iron come from the men you beat. Spend them between chapters.</p><ul>${FORGE.map((f) => `<li><b>${f.name}</b>: ${f.desc} Up to ${FORGE_MAX} times.</li>`).join('')}</ul>`)],
      ['Enemies', () => foes(STORY_FOES, 'a little more each chapter.')],
    ],
  },
];
// the wiki renders a part with its own picture folder
export const wikiPart = (part, imgBase) => { base = imgBase; return part(); };
export const CONTROLS = SECTIONS[5];
