import { settings } from './settings.js';

// Synthesized blips so the game has feedback without any audio files: [wave, startHz, endHz, seconds, volume]
const SOUNDS = {
  swing: ['triangle', 520, 180, 0.08, 0.05],
  special: ['sawtooth', 220, 660, 0.18, 0.05],
  dash: ['sine', 300, 900, 0.09, 0.05],
  blink: ['sine', 1200, 300, 0.15, 0.06],
  hit: ['square', 180, 60, 0.07, 0.06],
  hurt: ['sawtooth', 140, 40, 0.25, 0.09],
  kill: ['square', 400, 50, 0.18, 0.06],
  shoot: ['triangle', 900, 400, 0.1, 0.04],
  pickup: ['triangle', 600, 1400, 0.15, 0.06],
  unlock: ['square', 300, 900, 0.3, 0.06],
  door: ['sawtooth', 90, 60, 0.35, 0.05],
  menu: ['square', 700, 700, 0.04, 0.03],
  slam: ['sawtooth', 90, 30, 0.4, 0.1],
};

let ctx = null, master = null, sfxBus = null, musicBus = null;
export const audio = { muted: false }; // tests set this; it silences everything, music included

// Browsers only allow sound after a key press or click, so the context starts on the first one
function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    applyVolume();
    return true;
  } catch { return false; }
}

export function applyVolume() {
  if (!ctx) return;
  master.gain.value = audio.muted || settings.muted ? 0 : settings.master;
  sfxBus.gain.value = settings.sfx;
  musicBus.gain.value = settings.music;
}

export function sfx(name) {
  const s = SOUNDS[name];
  if (!s || audio.muted || !ensure()) return;
  const [type, f0, f1, dur, vol] = s, t = ctx.currentTime;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur);
}

// ---- music: a low drone and slow, sparse bell notes in a minor key; each biome shifts the root ----

const ROOTS = { 'The Cells': 55, 'The Crypt': 46.25, 'The Rot': 73.42, "The Warden's Halls": 65.41 };
const SCALE = [0, 3, 5, 7, 10, 12, 15];
let music = null, root = 55;

function startMusic() {
  if (music || audio.muted || !ensure()) return;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;
  lp.connect(musicBus);
  const drones = [-6, 6].map((detune) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.detune.value = detune;
    o.frequency.value = root;
    g.gain.value = 0.045;
    o.connect(g).connect(lp);
    o.start();
    return o;
  });
  music = { drones };
  const bell = () => {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = root * 4 * 2 ** (SCALE[Math.floor(Math.random() * SCALE.length)] / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    o.connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + 3);
    setTimeout(bell, 1800 + Math.random() * 2800);
  };
  bell();
}

export function musicFor(biomeName) {
  root = ROOTS[biomeName] ?? root;
  if (music) for (const o of music.drones) o.frequency.setTargetAtTime(root, ctx.currentTime, 1.5);
}

addEventListener('keydown', startMusic);
addEventListener('mousedown', startMusic);
