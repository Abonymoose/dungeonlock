import { world } from './world.js';
import { toScreen } from './render.js';
import { input } from './input.js';

// Quick chat: 1-9 and 0 send an emoji over your head (Shift for the second ten), seen by everyone in a co-op run.
// Phones get a chat button with all twenty. Names and health bars ride over the other players here too.
export const EMOTES = ['👍', '👎', '💩', '😂', '🔥', '💀', '❤️', '😭', '😎', '👋', '🤡', '🎉', '😡', '🙏', '🤝', '👀', '💯', '🗿', '🐐', '🤯'];
export const emoteHooks = { send: null }; // the co-op layer sets this to pass emotes on
const BUBBLE = 2.6, FEED = 5;

const layer = Object.assign(document.createElement('div'), { id: 'tags' });
const feed = Object.assign(document.createElement('div'), { id: 'chatfeed' });
const button = Object.assign(document.createElement('div'), { id: 'emotebtn', textContent: '💬' });
const panel = Object.assign(document.createElement('div'), { id: 'emotepanel', className: 'hidden' });
panel.innerHTML = EMOTES.map((e, i) => `<span data-emote="${i}">${e}<small>${i < 10 ? (i + 1) % 10 : `⇧${(i - 9) % 10}`}</small></span>`).join('');
document.body.append(layer, feed, button, panel);

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
    const name = esc(r.netName ?? 'Player');
    if (t.name.innerHTML !== name) t.name.innerHTML = name;
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
