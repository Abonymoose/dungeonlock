// Save files: everything the game keeps in this browser (progress, Anvil upgrades, records, settings) as one JSON file,
// so it can be backed up or moved to another browser or computer.
const PREFIX = 'dungeonlock.';
const MAX = 200000; // a real save is a few KB; anything this big isn't one of ours

// Everything under our keys, ready to write out
export function saveData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(PREFIX)) data[k] = localStorage.getItem(k);
  }
  return { game: 'dungeonlock', version: 1, saved: new Date().toISOString(), data };
}

export function exportSave() {
  const blob = new Blob([JSON.stringify(saveData(), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `dungeonlock-save-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// A loaded file is untrusted: check it really is a Dungeonlock save before anything is overwritten.
// Returns its entries, or throws an Error whose message says what's wrong in plain words.
export function parseSave(text) {
  if (text.length > MAX) throw new Error('That file is too big to be a save.');
  let s;
  try { s = JSON.parse(text); } catch { throw new Error("That file isn't a save file."); }
  if (s?.game !== 'dungeonlock' || !s.data || typeof s.data !== 'object' || Array.isArray(s.data)) throw new Error("That file isn't a Dungeonlock save.");
  const entries = Object.entries(s.data);
  if (!entries.length) throw new Error('That save file is empty.');
  for (const [k, v] of entries) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') throw new Error('That save file is damaged.');
    try { JSON.parse(v); } catch { throw new Error('That save file is damaged.'); }
  }
  return entries;
}

// Opens a file picker; on a good save, asks before replacing what's here. onDone(null) on success, onDone(reason) if not.
export function importSave(onDone) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const entries = parseSave(await file.text());
      if (!confirm('Replace your current progress and settings with this save file?')) return;
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k.startsWith(PREFIX)) localStorage.removeItem(k); }
      for (const [k, v] of entries) localStorage.setItem(k, v);
      onDone(null);
    } catch (e) {
      onDone(e.message);
    }
  };
  input.click();
}
