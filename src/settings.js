// Player settings, saved in the browser. Everything that reads a setting reads it from here.
const SAVE_KEY = 'dungeonlock.settings.v1';

// The rebindable moves. Keyboard codes include mouse buttons as 'Mouse0' (left) / 'Mouse2' (right); pad is a button index.
export const ACTIONS = ['attack', 'special', 'cast', 'dash', 'interact', 'pause'];

const DEFAULTS = {
  master: 0.8, music: 0.5, sfx: 0.8, muted: false, shake: true, rumble: true, numbers: true,
  keys: { attack: ['Mouse0', 'KeyJ'], special: ['Mouse2', 'KeyK'], cast: ['KeyQ', 'KeyL'], dash: ['Space', 'ShiftLeft'], interact: ['KeyE'], pause: ['Escape'] },
  pad: { attack: 2, special: 3, cast: 1, dash: 0, interact: 5, pause: 9 },
};

export const settings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { ...structuredClone(DEFAULTS), ...s, keys: { ...structuredClone(DEFAULTS.keys), ...s.keys }, pad: { ...DEFAULTS.pad, ...s.pad } };
  } catch { return structuredClone(DEFAULTS); }
})();

export function saveSettings() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(settings)); } catch { /* private mode: settings last this session only */ }
}

export function resetControls() {
  settings.keys = structuredClone(DEFAULTS.keys);
  settings.pad = { ...DEFAULTS.pad };
  saveSettings();
}
