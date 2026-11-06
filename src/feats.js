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
  { id: 'depth20', name: 'Twenty Down', desc: 'Reach depth 20.', ash: 150 },
  { id: 'untouched', name: 'Untouched', desc: 'Clear a room at depth 5 or deeper without taking a hit.', ash: 50 },
  { id: 'collector', name: 'Full House', desc: 'Carry six boons at once.', ash: 60 },
  { id: 'hardcore', name: 'No Help Needed', desc: 'Reach depth 5 with Hardcore on.', ash: 80 },
  { id: 'armory', name: 'Armory', desc: 'Own every weapon.', ash: 100 },
  { id: 'nights', name: 'Five Nights', desc: 'Live through five nights in the Wilds.', ash: 80 },
  { id: 'story', name: 'Happily Ever After', desc: 'Finish the Adventure.', ash: 100 },
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
