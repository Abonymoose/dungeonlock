// Tiny static server: ES modules can't load from file://, and gamepads need a secure context (localhost counts).
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = process.env.PORT || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // dev only: test/shots.js posts game screenshots here and they land in assets/shots/<name>.png
  const shot = req.method === 'POST' && url.match(/^\/__shot\/([a-z0-9-]{1,40})$/);
  if (req.method === 'POST' && url === '/__wiki') {
    // dev only: test/shots.js rebuilds the wiki page from the codex and saves it here
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => fs.writeFile(path.join(root, 'wiki', 'index.html'), Buffer.concat(chunks), (err) => { res.writeHead(err ? 500 : 200); res.end(); }));
    return;
  }
  if (req.method === 'POST') {
    if (!shot) { res.writeHead(404); return res.end(); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(path.join(root, 'assets', 'shots'), { recursive: true });
      fs.writeFile(path.join(root, 'assets', 'shots', shot[1] + '.png'), Buffer.concat(chunks), (err) => { res.writeHead(err ? 500 : 200); res.end(); });
    });
    return;
  }
  const file = path.resolve(root, '.' + (url === '/' ? '/index.html' : url));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Dungeonlock running at http://localhost:${port}`));
