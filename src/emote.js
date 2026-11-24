import { world } from './world.js';
import { toScreen } from './render.js';
import { input } from './input.js';

// Quick chat: 1-9 and 0 send an emoji over your head (Shift for the second ten), seen by everyone in a co-op run.
// Phones get a chat button with all twenty. On a controller the d-pad sends four, and holding LT (or pressing in the
// right stick) opens a wheel of all twenty: point the right stick at one and let go. Names and health bars ride here too.
export const EMOTES = ['👍', '👎', '💩', '😂', '🔥', '💀', '❤️', '😭', '😎', '👋', '🤡', '🎉', '😡', '🙏', '🤝', '👀', '💯', '🗿', '🐐', '🤯'];
// a co-op profile's color: on your name tag, and as a ring at your hero's feet
export const COLORS = [
  { name: 'Gold', css: '#E8D25A', hex: 0xe8d25a }, { name: 'Teal', css: '#46C2A8', hex: 0x46c2a8 }, { name: 'Crimson', css: '#E0504A', hex: 0xe0504a },
  { name: 'Sky', css: '#7FB2D9', hex: 0x7fb2d9 }, { name: 'Violet', css: '#B57BD6', hex: 0xb57bd6 }, { name: 'Moss', css: '#8FC46A', hex: 0x8fc46a },
  { name: 'Ember', css: '#E8893A', hex: 0xe8893a }, { name: 'Bone', css: '#EFE3CC', hex: 0xefe3cc },
];
export const emoteHooks = { send: null }; // the co-op layer sets this to pass emotes on
const BUBBLE = 2.6, FEED = 5;

const layer = Object.assign(document.createElement('div'), { id: 'tags' });
const feed = Object.assign(document.createElement('div'), { id: 'chatfeed' });
const button = Object.assign(document.createElement('div'), { id: 'emotebtn', textContent: '💬' });
const panel = Object.assign(document.createElement('div'), { id: 'emotepanel', className: 'hidden' });
panel.innerHTML = EMOTES.map((e, i) => `<span data-emote="${i}">${e}<small>${i < 10 ? (i + 1) % 10 : `⇧${(i - 9) % 10}`}</small></span>`).join('');
const wheel = Object.assign(document.createElement('div'), { id: 'emotewheel', className: 'hidden' });
wheel.innerHTML = EMOTES.map((e, i) => { const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2; return `<span style="transform: translate(${(Math.cos(a) * 7.5).toFixed(2)}em, ${(Math.sin(a) * 7.5).toFixed(2)}em)">${e}</span>`; }).join('') + '<b>LET GO TO SEND</b>';
document.body.append(layer, feed, button, panel, wheel);

const tags = new Map(); // entity -> { el, bubble, until, name, hp }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function tagFor(e) {
  let t = tags.get(e);
  if (!t) {
    const el = document.createElement('div');
    el.className = 'ptag';
    el.innerHTML = '<div class="bubble"></div><div class="pname"></div><div class="php"><i></i></div>';
    layer.append(el);
    t = { el, bubble: el.firstChild, name: el.children[1], hp: el.children[2], until: 0 };
    tags.set(e, t);
  }
  return t;
}

// show emoji i over an entity's head, and a line in the feed
export function emote(e, i, who = 'You') {
  i = Number(i);
  if (!e || !Number.isInteger(i) || i < 0 || i >= EMOTES.length) return;
  const t = tagFor(e);
  t.bubble.textContent = EMOTES[i];
  t.bubble.classList.remove('pop');
  void t.bubble.offsetWidth; // restart the pop animation
  t.bubble.classList.add('pop');
  t.until = performance.now() + BUBBLE * 1000;
  const line = document.createElement('div');
  line.innerHTML = `<b>${esc(who)}</b> <span class="emo">${EMOTES[i]}</span>`;
  feed.append(line);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => line.classList.add('gone'), FEED * 1000);
  setTimeout(() => line.remove(), FEED * 1000 + 600);
}

function send(i) {
  if (world.state !== 'play' || !world.player) return;
  emote(world.player, i);
  emoteHooks.send?.(i);
}

addEventListener('keydown', (e) => {
  const m = e.code.match(/^(?:Digit|Numpad)(\d)$/);
  if (!m || e.repeat || world.state !== 'play') return;
  const n = (Number(m[1]) + 9) % 10; // 1 is the first, 0 the tenth
  send(n + (e.shiftKey ? 10 : 0));
});
button.addEventListener('click', () => panel.classList.toggle('hidden'));
panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-emote]');
  if (!b) return;
  send(Number(b.dataset.emote));
  panel.classList.add('hidden');
});

// once a frame, right after input is read: the d-pad's four, and the wheel (which borrows the right stick from aiming)
const DPAD = { 12: 0, 13: 1, 14: 2, 15: 3 }; // up 👍, down 👎, left 💩, right 😂
let padWas = [], pick = -1;
export function padEmotes() {
  const pad = input.pad, now = pad ? pad.buttons.map((b) => b.pressed) : [];
  const was = padWas;
  padWas = now;
  const open = world.state === 'play' && (now[6] || now[11]);
  if (world.state === 'play') for (const [b, i] of Object.entries(DPAD)) if (now[b] && !was[b]) send(i);
  if (open) {
    const x = pad.axes[2] ?? 0, y = pad.axes[3] ?? 0;
    if (Math.hypot(x, y) > 0.5) pick = Math.round((((Math.atan2(y, x) + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * EMOTES.length) % EMOTES.length;
    input.aim = null; // the stick is choosing an emoji, not turning you
    [...wheel.children].forEach((s, i) => s.classList.toggle('on', i === pick));
  } else if (!wheel.classList.contains('hidden')) {
    if (pick >= 0) send(pick);
    pick = -1;
  }
  wheel.classList.toggle('hidden', !open);
}

// once a frame: keep every tag over its owner. Remote players show a name and health; anyone can show a bubble.
export function updateTags(remotes = []) {
  const playing = ['play', 'pause', 'choice'].includes(world.state);
  layer.classList.toggle('hidden', !playing);
  feed.classList.toggle('hidden', !playing);
  const touchPlay = input.touch && world.state === 'play';
  button.classList.toggle('hidden', !touchPlay);
  if (!touchPlay) panel.classList.add('hidden');
  for (const r of remotes) {
    const t = tagFor(r);
    const name = `<span class="ticon">${EMOTES[r.netIcon] ?? ''}</span>${esc(r.netName ?? 'Player')}`;
    if (t.name.innerHTML !== name) t.name.innerHTML = name;
    t.name.style.color = COLORS[r.netColor]?.css ?? '';
    t.hp.firstChild.style.width = Math.max(0, Math.min(100, 100 * r.hp / (r.maxHp || 1))) + '%';
    t.el.classList.toggle('remote', true);
    t.el.classList.toggle('down', !!r.dead);
  }
  const now = performance.now();
  for (const [e, t] of tags) {
    const alive = e === world.player || remotes.includes(e);
    if (!alive || !e.model?.root.parent) { t.el.remove(); tags.delete(e); continue; }
    const showBubble = now < t.until;
    t.bubble.classList.toggle('hidden', !showBubble);
    if (!showBubble && !t.el.classList.contains('remote')) { t.el.classList.add('hidden'); continue; }
    t.el.classList.remove('hidden');
    const s = toScreen(e.pos, 2.3);
    t.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
  }
}
