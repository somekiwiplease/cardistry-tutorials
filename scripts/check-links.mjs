// Checks every link on the site and saves the result to data/link-status.json.
// YouTube videos are checked through the official API; everything else by visiting the page.
// Usage: npm run check-links   (needs YOUTUBE_API_KEY in .env)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.YOUTUBE_API_KEY || readFileSync(resolve(root, '.env'), 'utf8').match(/^YOUTUBE_API_KEY=(.+)$/m)?.[1]?.trim();
const moves = JSON.parse(readFileSync(resolve(root, 'src/data/moves.json'), 'utf8')).moves;
const ytId = (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
const urls = [...new Set(moves.flatMap((m) => m.links.map((l) => l.url)))];
const status = {};

// YouTube: anything the API doesn't return as public and processed is not watchable.
const ids = [...new Set(urls.map(ytId).filter(Boolean))];
const ok = new Set();
for (let i = 0; i < ids.length; i += 50) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${ids.slice(i, i + 50).join(',')}`, { headers: { 'X-Goog-Api-Key': KEY } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? r.statusText);
  for (const it of j.items ?? []) if (it.status.privacyStatus !== 'private' && it.status.uploadStatus === 'processed') ok.add(it.id);
}
for (const u of urls) {
  const id = ytId(u);
  if (id) status[u] = ok.has(id) ? 'ok' : 'broken';
}

// Everything else: visit it. A missing page, a dead site or a redirect to the shop's home page counts as broken.
const others = urls.filter((u) => !ytId(u));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
await Promise.all(
  others.map(async (u) => {
    try {
      const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      const landed = new URL(r.url);
      const home = landed.pathname === '/' || landed.pathname === '';
      const wasHome = new URL(u).pathname === '/' || new URL(u).pathname === '';
      status[u] = r.status === 404 || r.status === 410 || r.status >= 500 ? 'broken' : home && !wasHome ? 'broken' : r.status >= 400 ? `unclear ${r.status}` : 'ok';
      if (status[u] !== 'ok') status[u] += ` (${r.status} → ${r.url})`;
    } catch (e) {
      status[u] = `broken (${e.cause?.code ?? e.name})`;
    }
  }),
);

writeFileSync(resolve(root, 'data/link-status.json'), JSON.stringify({ checked: new Date().toISOString().slice(0, 10), status }, null, 1));
const tally = {};
for (const s of Object.values(status)) tally[s.split(' ')[0]] = (tally[s.split(' ')[0]] ?? 0) + 1;
console.log(urls.length, 'links:', JSON.stringify(tally));
for (const [u, s] of Object.entries(status)) if (s !== 'ok') console.log(s.padEnd(12).slice(0, 60), u);
