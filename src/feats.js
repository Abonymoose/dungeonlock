import { meta, saveMeta } from './run.js';
import * as ui from './ui.js';

// Feats: one-time goals across all three modes. Each pays its ash into your bank the moment you earn it.
export const FEATS = [
  { id: 'firstblood', name: 'First Blood', desc: 'Clear a room in the Dungeon.', ash: 20 },
  { id: 'depth10', name: 'Deep End', desc: 'Reach the Lock at depth 10.', ash: 60 },
  { id: 'escape', name: 'Daylight', desc: 'Escape through the Lock.', ash: 100 },
  { id: 'warden', name: 'Wardenbane', desc: 'Defeat the Warden.', ash: 50 },
  { id: 'prior', name: 'Last Rites', desc: 'Defeat the Hollow Prior.', ash: 50 },
  { id: 'reaver', name: 'Blunted', desc: 'Defeat the Reaver.', ash: 50 },
  { id: 'vaults', name: 'Wet Feet', desc: 'Reach the Sunken Vaults, below the first Lock.', ash: 60 },
  { id: 'drownedking', name: 'Dethroned', desc: 'Defeat the Drowned King.', ash: 120 },
  { id: 'forges', name: 'Into the Fire', desc: 'Reach the Ember Forges, below the second Lock.', ash: 100 },
  { id: 'forgemaster', name: 'Quenched', desc: 'Defeat the Forgemaster.', ash: 160 },
  { id: 'depth20', name: 'Twenty Down', desc: 'Reach depth 20.', ash: 150 },
  { id: 'untouched', name: 'Untouched', desc: 'Clear a room at depth 5 or deeper without taking a hit.', ash: 50 },
  { id: 'collector', name: 'Full House', desc: 'Carry six boons at once.', ash: 60 },
  { id: 'hardcore', name: 'No Help Needed', desc: 'Reach depth 5 with Hardcore on.', ash: 80 },
  { id: 'armory', name: 'Armory', desc: 'Own every weapon.', ash: 100 },
  { id: 'merchant', name: 'Good Custom', desc: 'Buy three wares from the Peddler in one run.', ash: 60 },
  { id: 'dodger', name: 'Ghost Step', desc: 'Make ten perfect dodges in one run.', ash: 80 },
  { id: 'shrine', name: 'A Fair Price', desc: 'Strike a bargain at a Shrine.', ash: 30 },
  { id: 'trial', name: 'Proven', desc: 'Pass a Trial.', ash: 40 },
  { id: 'ambush', name: 'Not a Chest', desc: 'Survive a chest ambush.', ash: 40 },
  { id: 'echo', name: 'Laid to Rest', desc: 'Defeat the Echo of a hero you lost.', ash: 60 },
  { id: 'vowed', name: 'Sworn', desc: 'Reach depth 10 with three or more vows sworn.', ash: 150 },
  { id: 'army', name: 'Army of One', desc: 'Have four raised dead fighting for you at once.', ash: 60 },
];

export const hasFeat = (id) => !!meta.feats?.[id];

export function earn(id) {
  const f = FEATS.find((x) => x.id === id);
  if (!f || hasFeat(id)) return false;
  meta.feats = { ...meta.feats, [id]: true };
  meta.ash += f.ash;
  saveMeta();
  ui.toast(`<b>FEAT: ${f.name.toUpperCase()}</b><span>${f.desc}</span><span class="ash">+${f.ash} ash</span>`);
  return true;
}
