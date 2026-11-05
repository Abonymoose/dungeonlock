// Copies only the game into dist/ for deploying, so the design doc, tests and tooling are never published
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
for (const item of ['index.html', 'src', 'assets']) fs.cpSync(path.join(__dirname, item), path.join(out, item), { recursive: true });
console.log('Built dist/');
