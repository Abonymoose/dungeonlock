import { input, touch } from './input.js';

// Phone controls: drag anywhere on the left half to move, diamond buttons on the right.
// They only show after a touch and during play, so mouse and controller players never see them.
const BUTTONS = { attack: 'ATTACK', dash: 'DASH', special: 'SPECIAL', cast: 'CAST', interact: 'USE', craft: 'CRAFT', pause: 'II' };
const R = 52; // CSS px of thumb travel for full speed

const root = document.createElement('div');
root.id = 'touch';
root.className = 'hidden';
root.innerHTML = '<div class="zone"></div><div class="stick hidden"><i></i></div>'
  + Object.entries(BUTTONS).map(([a, t]) => `<div class="tb ${a}" data-hold="${a}"><span>${t}</span></div>`).join('');
document.body.append(root);
const stick = root.querySelector('.stick'), knob = stick.firstChild, prompt = document.getElementById('prompt');

let stickId = null, ox = 0, oy = 0;
const holds = new Map(); // touch id -> the button it is holding

function release(id) {
  if (id === stickId) { stickId = null; touch.x = touch.y = 0; stick.classList.add('hidden'); }
  const a = holds.get(id);
  if (!a) return;
  holds.delete(id);
  if (![...holds.values()].includes(a)) { touch.held.delete(a); root.querySelector('.tb.' + a).classList.remove('on'); }
}

// any touch switches prompts over to the touch buttons; on a phone the first one also goes fullscreen, sideways
addEventListener('touchstart', () => { touch.last = performance.now(); input.touch = true; input.usingPad = input.mouseAim = false; }, { capture: true, passive: true });
addEventListener('touchend', () => { touch.last = performance.now(); }, { capture: true, passive: true });
addEventListener('touchend', () => {
  if (!matchMedia('(pointer: coarse)').matches || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}, { once: true });

root.addEventListener('touchstart', (e) => {
  e.preventDefault(); // no fake mouse clicks, no zoom
  for (const t of e.changedTouches) {
    const b = t.target.closest('[data-hold]');
    if (b) {
      holds.set(t.identifier, b.dataset.hold);
      touch.held.add(b.dataset.hold);
      touch.taps.add(b.dataset.hold); // a tap quicker than a frame still counts
      b.classList.add('on');
    } else if (stickId === null) {
      stickId = t.identifier; ox = t.clientX; oy = t.clientY;
      stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
      knob.style.transform = '';
      stick.classList.remove('hidden');
    }
  }
}, { passive: false });
root.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== stickId) continue;
    let dx = t.clientX - ox, dy = t.clientY - oy;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    [touch.x, touch.y] = m < 8 ? [0, 0] : [dx / R, dy / R];
  }
}, { passive: false });
const end = (e) => { for (const t of e.changedTouches) release(t.identifier); };
root.addEventListener('touchend', end);
root.addEventListener('touchcancel', end);

// tappable hints in menus and prompts: the button itself, or the whole hint around a lone button
addEventListener('click', (e) => {
  const own = e.target.closest('.weapon [data-act]'); // the weapon arrows inside a class card
  if (!own && e.target.closest('[data-sel], [data-tab]')) return; // menus handle their own items
  const b = own ?? e.target.closest('[data-act]') ?? e.target.closest('.hints > span')?.querySelector('[data-act]');
  if (b) touch.taps.add(b.dataset.act);
});

// once a frame: show the buttons that make sense right now
export function updateTouch(world) {
  document.body.classList.toggle('touch-on', input.touch);
  const on = input.touch && ['play', 'talk'].includes(world.state);
  root.classList.toggle('hidden', !on);
  if (!on) { for (const id of [...holds.keys(), stickId]) release(id); return; }
  root.classList.toggle('grounded', !!world.player?.cls.grounded);
  root.classList.toggle('wild', world.room?.plan.kind === 'wild');
  root.classList.toggle('use', !prompt.classList.contains('hidden'));
  // turned upright mid-fight: stop the fight until the phone is sideways again
  if (innerHeight > innerWidth && world.state === 'play' && !world.player?.dead) touch.taps.add('pause');
}
