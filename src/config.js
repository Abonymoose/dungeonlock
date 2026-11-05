// Palette from the design doc, plus ASH: a lifted Onyx so dark enemies still show their shading bands
export const C = {
  SAND: 0xE7D6BC, OAK: 0xD4C5AC, CRIMSON: 0x9B1C1C, CHOC: 0x6E2323, ONYX: 0x131515, ASH: 0x3A3433,
};

export const VIEW = 9;        // world units visible top to bottom: the camera zoom, the same at any window size
export const ROWS = 240;      // aim for about this many pixel rows, scaled up by a whole number
export const DEADZONE = 0.2;
export const BOSS_DEPTH = 9;  // the Warden waits here; the Lock is one room after
