// The daily leaderboard: a Cloudflare Worker (dungeonscores.dungeonlock.workers.dev) over a D1 table.
//   GET  /daily?day=YYYY-MM-DD  -> { day, top: [{ name, score, depth, cls }] }   (today, UTC, if no day)
//   POST /daily { day, name, score, depth, cls }  -> keeps each name's best score for the day
// Table: scores (day, name, score, depth, cls, at), primary key (day, name).
// shortcut: scores are checked for sane bounds only, not replayed; a determined cheat can post a fake one. Upgrade to
// server-side run validation if the board ever matters.

const ORIGINS = ['https://dungeonlock.pages.dev', 'https://play.dungeonlock.workers.dev'];
const CLASSES = ['knight', 'rogue', 'wizard', 'barbarian', 'necromancer'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[\p{L}\p{N} _.'-]{1,16}$/u;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = ORIGINS.includes(origin) || /^https:\/\/[a-z0-9]+\.dungeonlock\.pages\.dev$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname !== '/daily') return json({ error: 'not found' }, 404);
    const today = new Date().toISOString().slice(0, 10);

    if (req.method === 'GET') {
      const asked = url.searchParams.get('day') ?? '';
      const day = DAY.test(asked) ? asked : today;
      const { results } = await env.DB.prepare('SELECT name, score, depth, cls FROM scores WHERE day = ?1 ORDER BY score DESC, at ASC LIMIT 10').bind(day).all();
      return json({ day, top: results });
    }

    if (req.method === 'POST') {
      let b;
      try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const name = String(b?.name ?? '').trim(), day = String(b?.day ?? ''), cls = String(b?.cls ?? '');
      const depth = Number(b?.depth), score = Number(b?.score);
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10); // a run that crosses midnight still counts
      if (!NAME.test(name)) return json({ error: 'name must be 1-16 letters, numbers, spaces or _ . \' -' }, 400);
      if (day !== today && day !== yesterday) return json({ error: 'only today\'s board takes scores' }, 400);
      if (!CLASSES.includes(cls)) return json({ error: 'unknown class' }, 400);
      if (!Number.isInteger(depth) || depth < 0 || depth > 300) return json({ error: 'bad depth' }, 400);
      if (!Number.isInteger(score) || score < 0 || score > depth * 100 + 3000) return json({ error: 'bad score' }, 400);
      await env.DB.prepare(`INSERT INTO scores (day, name, score, depth, cls, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT (day, name) DO UPDATE SET score = excluded.score, depth = excluded.depth, cls = excluded.cls, at = excluded.at WHERE excluded.score > scores.score`)
        .bind(day, name, score, depth, cls, Date.now()).run();
      const { rank } = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE day = ?1 AND score > ?2').bind(day, score).first();
      return json({ ok: true, rank });
    }
    return json({ error: 'method not allowed' }, 405);
  },
};
