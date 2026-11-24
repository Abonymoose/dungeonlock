// Co-op relay: a Cloudflare Worker (dungeonrelay.dungeonlock.workers.dev) with one Durable Object per room code.
//   wss://.../room/ABCD   joins room ABCD. The first player in is the host; a room holds four.
// It only passes JSON messages along: a message with `to` goes to that player, any other to everyone else, each stamped
// with `from`. Players are told when someone joins or leaves. The game itself runs on the players' machines.

const ORIGIN_OK = (o) => !o || o === 'https://dungeonlock.pages.dev' || o === 'https://play.dungeonlock.workers.dev'
  || /^https:\/\/[a-z0-9]+\.dungeonlock\.pages\.dev$/.test(o) || /^http:\/\/localhost:\d+$/.test(o);
const MAX = 4;

export default {
  async fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    if (!ORIGIN_OK(req.headers.get('Origin'))) return new Response('forbidden', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class Room {
  constructor(ctx) { this.ctx = ctx; }

  async fetch() {
    const peers = this.ctx.getWebSockets();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (peers.length >= MAX) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4001, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const me = { id: crypto.randomUUID().slice(0, 8), host: !peers.some((ws) => ws.deserializeAttachment()?.host) };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: 'welcome', ...me, peers: peers.map((ws) => ws.deserializeAttachment()) }));
    for (const ws of peers) this.send(ws, JSON.stringify({ t: 'join', ...me }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 65536) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    const me = ws.deserializeAttachment();
    msg.from = me.id;
    const out = JSON.stringify(msg);
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws || (msg.to && other.deserializeAttachment()?.id !== msg.to)) continue;
      this.send(other, out);
    }
  }

  webSocketClose(ws, code, reason) {
    const me = ws.deserializeAttachment();
    if (me) for (const other of this.ctx.getWebSockets()) if (other !== ws) this.send(other, JSON.stringify({ t: 'leave', ...me }));
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
  }

  webSocketError(ws) { this.webSocketClose(ws, 1011, 'error'); }

  send(ws, text) { try { ws.send(text); } catch { /* a socket mid-close */ } }
}
