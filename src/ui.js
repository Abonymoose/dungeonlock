import { btn } from './input.js';
import { toScreen } from './render.js';

const $ = (s) => document.querySelector(s);
const hud = $('#hud'), screen = $('#screen'), prompt = $('#prompt'), banner = $('#banner'), fade = $('#fade');
const hpFill = $('#hud .hp-fill'), hpLag = $('#hud .hp-lag'), hpText = $('#hud .hp-text'), ammoEl = $('#hud .ammo');
const livesEl = $('#hud .lives'), lvEl = $('#hud .lv'), xpFill = $('#hud .xp i');
const keysEl = $('#hud .keys'), ashEl = $('#hud .ash'), depthEl = $('#hud .depth'), slotsEl = $('#hud .slots');
const bossEl = $('#boss'), bossName = $('#boss .name'), bossFill = $('#boss .fill'), bossLag = $('#boss .lag'), barsEl = $('#bars');

const KEY_SVG = '<svg class="ico" viewBox="0 0 8 4"><path fill="currentColor" fill-rule="evenodd" d="M0 0h3v4H0zM1 1h1v2H1zM3 1h5v1H3zM5 2h1v1H5zM7 2h1v2H7z"/></svg>';
const set = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };

export function showHud(on) { hud.classList.toggle('hidden', !on); if (!on) { updateBoss(null); updateEnemyBars([]); } }

// Health drains instantly; a pale "lag" chunk trails behind it so you can see how much a hit took
let lagHp = 1;
export function updateHud(p, run, xpNeed) {
  const k = p.hp / p.maxHp;
  lagHp = k > lagHp ? k : lagHp + (k - lagHp) * 0.04;
  hpFill.style.width = k * 100 + '%';
  hpLag.style.width = lagHp * 100 + '%';
  set(hpText, `${Math.ceil(p.hp)}<span class="dim">/${p.maxHp}</span>`);
  set(ammoEl, '<i class="pip full"></i>'.repeat(p.ammo) + '<i class="pip"></i>'.repeat(Math.max(0, p.maxAmmo - p.ammo)));
  set(livesEl, '<i class="pip life"></i>'.repeat(p.lives ?? 0));
  set(lvEl, `LV ${run.level}`);
  xpFill.style.width = Math.min(100, 100 * run.xp / xpNeed) + '%';
  set(keysEl, run.keys ? KEY_SVG.repeat(run.keys) : '');
  set(ashEl, `${run.ash}<small>${run.currency ?? 'ASH'}</small>`);
  hud.classList.toggle('noxp', !!run.noXp);
  set(depthEl, run.label ?? (run.depth ? `DEPTH ${run.depth}` : ''));
}

// Left column, like Hades: one icon per filled move slot, patron-coloured, with its level
export function setSlots(slots) {
  set(slotsEl, slots.map((s) => `
    <div class="slot" style="--c:${s.color}"><b>${s.glyph}</b>${s.level > 1 ? `<i>${s.level}</i>` : ''}</div>`).join(''));
}

let bossLagK = 1;
export function updateBoss(boss) {
  bossEl.classList.toggle('hidden', !boss);
  if (!boss) { bossLagK = 1; return; }
  set(bossName, boss.T.name.toUpperCase());
  const k = boss.hp / boss.maxHp;
  bossLagK = k > bossLagK ? k : bossLagK + (k - bossLagK) * 0.03;
  bossFill.style.width = k * 100 + '%';
  bossLag.style.width = bossLagK * 100 + '%';
}

// Small bars over enemies, only once they've been hurt (bosses use the top bar)
const bars = new Map();
export function updateEnemyBars(enemies) {
  const live = new Set();
  for (const e of enemies) {
    if (e.dead || e.hp >= e.maxHp || e.T.boss || e.type === 'dummy') continue;
    live.add(e);
    let el = bars.get(e);
    if (!el) { el = document.createElement('div'); el.className = 'ebar' + (e.maxHp > 80 ? ' big' : ''); el.innerHTML = '<i></i>'; barsEl.append(el); bars.set(e, el); }
    const s = toScreen(e.pos, e.radius * 2 + 1.3);
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translateX(-50%)`;
    el.firstChild.style.width = (100 * e.hp / e.maxHp) + '%';
  }
  for (const [e, el] of bars) if (!live.has(e)) { el.remove(); bars.delete(e); }
}

export function setPrompt(html) {
  prompt.classList.toggle('hidden', !html);
  if (html) set(prompt, html);
}

let bannerTimer = 0;
export function showBanner(title, sub = '', ms = 1800) {
  banner.querySelector('h1').textContent = title;
  banner.querySelector('p').textContent = sub;
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), ms);
}

export function fadeTo(dark) {
  fade.classList.toggle('clear', !dark);
  return new Promise((r) => setTimeout(r, 260));
}

export function hideScreen() { screen.classList.add('hidden'); }
function showScreen(html, view = '') {
  screen.classList.remove('hidden');
  screen.dataset.view = view;
  set(screen, html);
}

// ---- screens. Anything with data-sel="i" can be hovered and clicked with the mouse. ----

const moveRow = (action, name, desc = '') => `<div class="move">${btn(action)}<span>${name}${desc ? `<small>${desc}</small>` : ''}</span></div>`;
const KEYHOLE = '<svg class="keyhole" viewBox="0 0 6 10" aria-hidden="true"><path fill="currentColor" d="M1 0h4v1h1v3H5v1H4v5H2V5H1V4H0V1h1z"/></svg>';

const HOME = [
  ['Play', 'Descend into the dungeon, or learn the ropes first.'],
  ['Settings', 'Sound, screen shake, controls and key bindings.'],
  ['Wiki', 'Every class, foe, patron and boon.'],
];
export function homeScreen(sel, meta) {
  const items = HOME.map(([t], i) =>
    `<div class="home-item ${i === sel ? 'sel' : ''}" data-sel="${i}">${KEYHOLE}<span>${t}</span></div>`).join('');
  const record = meta.runs ? `${meta.runs} ${meta.runs === 1 ? 'run' : 'runs'}, ${meta.escapes} escaped, deepest depth ${meta.bestDepth}` : 'No runs yet. The Tutorial is in Play.';
  showScreen(`
    <div class="home">
      <div class="crest">${KEYHOLE}</div>
      <h1 class="logo">DUNGEONLOCK</h1>
      <p class="tag">Not everything unlocks.</p>
      <nav class="home-menu">${items}</nav>
      <p class="home-desc">${HOME[sel][1]}</p>
      <p class="record">${record}</p>
    </div>
    <p class="credits">Art from KayKit by Kay Lousberg and Quaternius. Music from OpenGameArt: yd, MintoDog, Paul Wortmann, qubodup, cynicmusic and RandomMind. All CC0</p>
    <div class="hints corner"><span>${btn('confirm')}Select</span></div>`, 'home');
}

// The ways in, as red cards with a scene rendered from the game
const CARDS = [
  { id: 'dungeon', name: 'Dungeon', desc: 'Pick a class and descend. It gets harder the deeper you go.', art: 'card-dungeon' },
  { id: 'open', name: 'Open World', desc: 'Beta. A huge wild island. Gather and craft by day; zombies rise at night. How many nights can you last?', art: 'card-open' },
  { id: 'adventure', name: 'Adventure', desc: 'A story in six chapters. You are a village swordsmith, and the princess is held in the castle. No magic: one sword.', art: 'card-adventure' },
  { id: 'tutorial', name: 'Tutorial', desc: 'Learn to move, fight, cast and take boons in one quiet room.', art: 'card-tutorial' },
];
export const PLAY_CARDS = CARDS.map((c) => c.id);
export function playScreen(sel, meta) {
  const cards = CARDS.map((c, i) => `
    <div class="pcard ${c.locked ? 'locked' : ''} ${i === sel ? 'sel' : ''}" data-sel="${i}">
      <div class="art"><img src="assets/shots/${c.art}.png" alt="">${c.locked ? `<div class="padlock">${KEYHOLE}</div>` : ''}</div>
      <div class="pbody">
        <h3>${c.name}</h3>
        <p>${c.desc}</p>
        ${c.id === 'tutorial' && meta.tutorialDone ? '<p class="done">Completed</p>' : ''}
        ${c.id === 'adventure' && meta.adventure ? `<p class="done">Continue: Chapter ${meta.adventure.chapter + 1}</p>` : c.id === 'adventure' && meta.adventureDone ? '<p class="done">Completed</p>' : ''}
      </div>
    </div>`).join('');
  showScreen(`
    <h2>Play</h2>
    <div class="pcards">${cards}</div>
    <p class="tag">&nbsp;</p>
    <div class="hints"><span>${btn('confirm')}Enter</span><span>${btn('back')}Back</span></div>`, 'play');
}

// classes: each with the weapon it shows ({ ...class, weapon, owned, count, at }); up and down look through weapons
export function titleScreen(classes, sel, meta, cast) {
  const cards = classes.map((c, i) => {
    const w = c.weapon, here = i === sel;
    const price = c.owned ? '' : `<span class="${meta.ash >= w.cost ? 'cost' : 'cost red'}">${w.cost} ash</span>`;
    const pips = Array.from({ length: c.count }, (_, k) => (k === c.at ? '&#9670;' : '&#9671;')).join('');
    return `
    <div class="card ${here ? 'sel' : ''}" data-sel="${i}">
      <h3>${c.name.toUpperCase()}</h3>
      <p>${c.blurb}</p>
      <p class="stat">HP ${c.hp}, speed ${c.speed}</p>
      <div class="weapon ${c.owned ? '' : 'locked'}">
        <div class="wname">${here ? btn('up') : ''}<b>${w.name}</b>${here ? btn('down') : ''}<span class="pips">${pips}</span></div>
        ${price}${here ? `<small>${w.desc}</small>` : ''}
      </div>
      ${moveRow('attack', c.attack.name)}${moveRow('special', c.special.name)}${moveRow('cast', cast.name)}${moveRow('dash', c.dash.name)}
      <p class="dim">${c.passive}</p>
    </div>`;
  }).join('');
  const w = classes[sel], go = w.owned ? 'Descend' : `Buy ${w.weapon.name} (${w.weapon.cost} ash)`;
  showScreen(`
    <h2>Choose your class</h2>
    <div class="cards">${cards}</div>
    <div class="hints"><span>${btn('confirm')}${go}</span><span>${btn('up')}${btn('down')}Weapon</span><span>${btn('alt')}The Anvil (${meta.ash} ash)</span><span>${btn('back')}Back</span></div>`);
}

export function anvilScreen(upgrades, sel, meta) {
  const items = upgrades.map((u, i) => {
    const lvl = meta[u.id] ?? 0, maxed = lvl >= u.max, cost = u.cost(lvl);
    return `<div class="item ${i === sel ? 'sel' : ''}" data-sel="${i}">
      <span>${u.name} ${'&#9632;'.repeat(lvl)}${'&#9633;'.repeat(u.max - lvl)}<small>${u.desc}</small></span>
      <span class="${maxed || meta.ash >= cost ? '' : 'red'}">${maxed ? 'Maxed' : cost + ' ash'}</span></div>`;
  }).join('');
  showScreen(`
    <h2>The Anvil</h2>
    <div class="dim">Ash carried out of the dungeon buys permanent strength.</div>
    <div class="list panel">${items}</div>
    <div>${meta.ash} ash</div>
    <div class="hints"><span>${btn('confirm')}Buy</span><span>${btn('back')}Back</span></div>`);
}

// One layout for every "pick one of these" moment: patron boons, Keystone level-ups, level-up perks.
// header { name, title, css }; cards [{ kind, name, rarity, rarityCss, css, desc, note }]
export function choiceScreen(header, cards, sel, hints) {
  const html = cards.map((c, i) => `
    <div class="card boon ${i === sel ? 'sel' : ''}" data-sel="${i}" style="--c:${c.css}; --r:${c.rarityCss ?? c.css}">
      <div class="kind">${c.kind ?? ''}</div>
      <h3>${c.name.toUpperCase()}</h3>
      ${c.rarity ? `<div class="rar">${c.rarity.toUpperCase()}</div>` : ''}
      <p>${c.desc}</p>
      ${c.note ? `<p class="dim">${c.note}</p>` : ''}
    </div>`).join('');
  showScreen(`
    <div class="patron" style="--c:${header.css}"><h2>${header.name.toUpperCase()}</h2><div class="tag">${header.title}</div></div>
    <div class="cards ${cards.length > 5 ? 'many' : ''}">${html}</div>
    <div class="hints">${hints}</div>`);
}

export function pauseScreen(sel, cls, cast, leave = 'Abandon run') {
  const items = ['Resume', leave, 'Settings'].map((t, i) =>
    `<div class="item ${i === sel ? 'sel' : ''}" data-sel="${i}"><span>${t}</span></div>`).join('');
  showScreen(`<h2>Paused</h2><div class="list">${items}</div>
    <div class="panel moves">
      ${moveRow('attack', cls.attack.name, cls.attack.desc)}${cls.special ? moveRow('special', cls.special.name, cls.special.desc) : ''}
      ${cls.grounded ? '' : moveRow('cast', cast.name, cast.desc)}${moveRow('dash', cls.dash.name)}${moveRow('interact', 'Use')}
    </div>`);
}

export function overScreen(result) {
  const titles = { escaped: ['ESCAPED', 'The Lock gave way. You walk out into the light.'],
    trapped: ['NOT EVERYTHING UNLOCKS', 'No key for the Lock. The dungeon keeps you.'],
    dead: ['FALLEN', 'The dungeon remembers. So do you.'],
    abandoned: ['ABANDONED', 'You let the dark take you.'] };
  const [t, sub] = result.adventure ? ['FALLEN', `Back to the start of ${result.adventure}. Your forge work is kept.`]
    : result.wild && result.kind === 'dead' ? ['FALLEN', 'The Wilds take another.'] : titles[result.kind];
  showScreen(`
    <h1>${t}</h1><div class="tag">${sub}</div>
    <div class="panel list">
      <div class="item"><span>Class</span><span>${result.className}</span></div>
      <div class="item"><span>${result.adventure ? 'Chapter' : result.wild ? 'Nights survived' : 'Depth'}</span><span>${result.depth}</span></div>
      <div class="item"><span>Kills</span><span>${result.kills}</span></div>
      <div class="item"><span>Ash banked</span><span>${result.ash}</span></div>
    </div>
    <div class="hints"><span data-sel="0">${btn('confirm')}Continue</span></div>`);
}

// rows: [{ group?, name, note?, value }] built by main from the settings
export function settingsScreen(rows, sel, capturing) {
  const html = rows.map((r, i) => `
    ${r.group ? `<div class="group">${r.group}</div>` : ''}
    <div class="item ${i === sel ? 'sel' : ''}" data-sel="${i}">
      <span>${r.name}${r.note ? `<small>${r.note}</small>` : ''}</span>
      <span class="val">${i === sel && capturing ? '<span class="blink">Press a key or button</span>' : r.value}</span>
    </div>`).join('');
  showScreen(`
    <h2>Settings</h2>
    <div class="list panel settings">${html}</div>
    <div class="hints"><span>${btn('left')}${btn('right')}Adjust</span><span>${btn('confirm')}Change</span><span>${btn('back')}Back</span></div>`, 'settings');
  screen.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
}

export function codexScreen(tabs, tab, body) {
  const t = tabs.map((name, i) => `<span class="tab ${i === tab ? 'sel' : ''}" data-tab="${i}">${name}</span>`).join('');
  showScreen(`
    <h2>Codex</h2>
    <div class="tabs">${t}</div>
    <div class="codex panel">${body}</div>
    <div class="hints"><span>${btn('left')}${btn('right')}Section</span><span>${btn('up')}${btn('down')}Scroll</span><span>${btn('alt')}Full wiki</span><span>${btn('back')}Back</span></div>`, 'codex');
}
export function scrollCodex(dy) { const el = screen.querySelector('.codex'); if (el) el.scrollTop += dy; }

// Step-by-step panel at the top of the screen during the tutorial
const tut = $('#tutorial');
// A line of story at the bottom of the screen: who speaks, what they say, and how to go on
const talkEl = $('#talk');
const toastEl = document.getElementById('toast');
let toastTimer = 0;
export function toast(html) {
  toastEl.innerHTML = html;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600);
}

export function dialogue(line) {
  talkEl.classList.toggle('hidden', !line);
  if (line) set(talkEl, `${line[0] ? `<div class="who">${line[0]}</div>` : ''}<p>${line[1]}</p><div class="next">${btn('confirm')}</div>`);
}

export function tutorialPanel(s) {
  tut.classList.toggle('hidden', !s);
  // the tutorial HUD shows only what the current step needs (see #hud.tut in index.html)
  hud.classList.toggle('tut', !!s);
  hud.classList.toggle('tut-fight', !!s?.fight);
  if (s) set(tut, `<div class="step">Step ${s.step} of ${s.total}</div><p>${s.text}</p><div class="bar"><i style="width:${Math.round(s.progress * 100)}%"></i></div>`);
}
