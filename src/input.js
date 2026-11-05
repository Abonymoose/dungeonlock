import { DEADZONE } from './config.js';
import { settings, ACTIONS } from './settings.js';

// Keyboard keys and mouse buttons share one set; mouse buttons are stored as 'Mouse0', 'Mouse1', 'Mouse2'
const keys = new Set();
export const input = { move: { x: 0, y: 0 }, aim: null, pad: null, usingPad: false, mouse: null, mouseAim: false, capture: null };

// Rebinding: the next key, mouse button or pad button goes to input.capture instead of the game
function captured(binding) {
  const cb = input.capture;
  if (!cb) return false;
  input.capture = null;
  cb(binding);
  return true;
}

addEventListener('keydown', (e) => {
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (captured(e.code === 'Escape' ? { kind: 'cancel' } : { kind: 'key', code: e.code })) return;
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => { input.mouse = { x: e.clientX, y: e.clientY }; input.mouseAim = true; input.usingPad = false; });
addEventListener('mousedown', (e) => {
  if (captured({ kind: 'key', code: 'Mouse' + e.button })) return; // rebinding takes any click, even on a menu
  if (e.target.closest?.('#screen')) return; // other clicks on menus are handled by the menus
  keys.add('Mouse' + e.button);
});
addEventListener('mouseup', (e) => keys.delete('Mouse' + e.button));
addEventListener('contextmenu', (e) => e.preventDefault()); // right click is a game button

// Moves read their bindings from settings; menu keys stay fixed so you can always get back out.
// Standard pad layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 9 Start, 12-15 d-pad. `axis` is [index, sign] for menu nav.
const MENU = {
  confirm: { pad: [0], keys: ['Enter', 'Space'] },
  back: { pad: [1], keys: ['Escape', 'Backspace'] },
  alt: { pad: [3], keys: ['Tab'] },
  craft: { pad: [8], keys: ['Tab', 'KeyC'] }, // the View button: Y is Special during play
  up: { pad: [12], keys: ['ArrowUp', 'KeyW'], axis: [1, -1] },
  down: { pad: [13], keys: ['ArrowDown', 'KeyS'], axis: [1, 1] },
  left: { pad: [14], keys: ['ArrowLeft', 'KeyA'], axis: [0, -1] },
  right: { pad: [15], keys: ['ArrowRight', 'KeyD'], axis: [0, 1] },
};
const binding = (a) => MENU[a] ?? { pad: [settings.pad[a]], keys: settings.keys[a] };
const ALL = [...ACTIONS, ...Object.keys(MENU)];

const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'START', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
const PS = ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
const isPlayStation = (pad) => /054c|playstation|dualsense|dualshock/i.test(pad?.id ?? '');
export const padName = (i) => (isPlayStation(input.pad) ? PS : XBOX)[i] ?? `BUTTON ${i}`;
export function keyName(code) {
  const named = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', AltLeft: 'ALT' };
  return named[code] ?? code.replace(/^(Key|Digit|Arrow)/, '').toUpperCase();
}

const held = {}, prev = {};
let padPrev = [];

// radial deadzone, rescaled so speed ramps up from zero at the deadzone edge
function stick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return [0, 0];
  const s = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
  return [x * s, y * s];
}

export function pollInput() {
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected) ?? null;
  input.pad = pad;
  const now = pad ? pad.buttons.map((b) => b.pressed) : [];
  if (input.capture && pad) {
    const i = now.findIndex((on, k) => on && !padPrev[k]);
    if (i >= 0) captured(i === 9 ? { kind: 'cancel' } : { kind: 'pad', index: i });
  }
  padPrev = now;

  for (const name of ALL) {
    const b = binding(name);
    prev[name] = held[name];
    let on = b.keys.some((k) => keys.has(k));
    if (pad) {
      on ||= b.pad.some((i) => pad.buttons[i]?.pressed);
      if (b.axis) on ||= (pad.axes[b.axis[0]] ?? 0) * b.axis[1] > 0.5;
    }
    held[name] = on;
  }

  let [x, y] = pad ? stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0) : [0, 0];
  const kx = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
  const ky = (keys.has('KeyS') || keys.has('ArrowDown')) - (keys.has('KeyW') || keys.has('ArrowUp'));
  if (kx || ky) { const l = Math.hypot(kx, ky); x = kx / l; y = ky / l; }
  input.move.x = x; input.move.y = y;

  const [ax, ay] = pad ? stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0) : [0, 0];
  input.aim = ax || ay ? { x: ax, y: ay } : null;

  // prompts and aiming follow whichever device was touched last
  if (keys.size) input.usingPad = false;
  if (pad && (now.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.5))) { input.usingPad = true; input.mouseAim = false; }
}

export const pressed = (action) => !!held[action] && !prev[action];
export const isHeld = (action) => !!held[action];
export const label = (action) => (input.usingPad ? padName(binding(action).pad[0]) : keyName(binding(action).keys[0]));
export const btn = (action) => `<span class="btn">${label(action)}</span>`;

export function rumble(strong = 0.4, weak = 0.4, ms = 80) {
  if (!settings.rumble) return;
  const p = input.pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
  p?.catch?.(() => {});
}
