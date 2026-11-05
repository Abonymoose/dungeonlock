// Shared mutable game state, kept in one place so modules don't import each other in circles
export const world = {
  state: 'title',
  player: null,
  enemies: [],
  room: null,
  run: null,
  pendingSpawns: 0,
  waveDelay: 0,
  hitstop: 0,
  shake: 0,
  time: 0,
};
