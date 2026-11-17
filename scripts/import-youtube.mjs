// Lists every video from the cardistry channels and playlists below using the official
// YouTube Data API v3, and saves them to data/youtube-videos.json.
// Usage: put YOUTUBE_API_KEY in .env, then `npm run import:youtube`.
// The key is read from .env, sent only to googleapis.com in a request header, and never printed or saved.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trickFromTitle } from './lib/titles.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
const fromFile = existsSync(envFile) ? readFileSync(envFile, 'utf8').match(/^YOUTUBE_API_KEY=(.+)$/m)?.[1]?.trim() : null;
const KEY = process.env.YOUTUBE_API_KEY || fromFile;
if (!KEY) {
  console.error('No key found. Copy .env.example to .env and add YOUTUBE_API_KEY.');
  process.exit(1);
}

// Sources named in the r/cardistry Cardistry Hub guide.
const SOURCES = [
  { name: 'Lotus in Hand', channel: 'UCErKkHyrzaxD1PzaebCCoZw' },
  { name: 'School of Cardistry', user: 'SchoolOfCardistry' },
  { name: 'Cardistry Touch', channel: 'UCfIH2al0lYgAg9S3OEjDOLQ' },
  { name: 'Fontaine Cards', channel: 'UCujBiYlw9avXsut3s671X6g' },
  { name: 'Zach Mueller', user: 'zachmonky' },
  { name: 'Dealersgrip', user: 'dealersgrip' },
  { name: 'di.cardistry', channel: 'UCtIHx88KZWdbWf30lAZEkKg' },
  { name: 'Best Cardist Alive', channel: 'UCj7QTSVnliwlcs8Z3IbgDGg' },
  { name: 'Anyone Worldwide', channel: 'UCiFU_korxXCF9PR91Wq0_Kg' },
  { name: 'Galaxy Decks', channel: 'UCCkvdrqCed6VGf3YvZgYWhg' },
  { name: "Zomb Tien's tutorial list", playlist: 'PLYlPrxtF5YHE03cfXUEEluf7793fi9LgN' },
  { name: 'Kenneth Aidan Foo: Finesse', playlist: 'PLvsE06skRLKZxHnAJtd9y22NNsoEapoGT' },
  { name: 'Kenneth Aidan Foo: NSS', playlist: 'PLvsE06skRLKZ8SI3UeCAZf2L_LnNeCFDL' },
];

let units = 0;
async function api(path, params) {
  units += 1;
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`, {
    headers: { 'X-Goog-Api-Key': KEY },
  });
  if (!r.ok) {
    const reason = (await r.json().catch(() => null))?.error?.message ?? r.statusText;
    throw new Error(`YouTube API ${r.status} on ${path}: ${reason}`);
  }
  return r.json();
}

async function uploadsOf(src) {
  const who = src.channel ? { id: src.channel } : { forUsername: src.user };
  const j = await api('channels', { part: 'contentDetails', ...who });
  return j.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

async function listPlaylist(playlistId) {
  const out = [];
  let pageToken;
  do {
    const j = await api('playlistItems', { part: 'snippet,contentDetails', maxResults: '50', playlistId, ...(pageToken ? { pageToken } : {}) });
    for (const it of j.items ?? []) {
      const title = it.snippet?.title ?? '';
      if (title === 'Private video' || title === 'Deleted video') continue;
      out.push({
        id: it.contentDetails.videoId,
        title,
        channel: it.snippet.videoOwnerChannelTitle ?? null,
        published: it.contentDetails.videoPublishedAt?.slice(0, 10) ?? null,
      });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

const videos = new Map();
const report = [];
for (const src of SOURCES) {
  try {
    const playlist = src.playlist ?? (await uploadsOf(src));
    if (!playlist) throw new Error('channel not found');
    const items = await listPlaylist(playlist);
    for (const v of items) if (!videos.has(v.id)) videos.set(v.id, { ...v, source: src.name });
    report.push(`${src.name}: ${items.length} videos`);
  } catch (e) {
    report.push(`${src.name}: FAILED (${e.message})`);
  }
}

// Descriptions and tags, only for videos that look like tutorials. They decide the family.
const tutorials = [...videos.values()].filter((v) => trickFromTitle(v.title));
for (let i = 0; i < tutorials.length; i += 50) {
  const batch = tutorials.slice(i, i + 50);
  const j = await api('videos', { part: 'snippet', id: batch.map((v) => v.id).join(','), maxResults: '50' });
  for (const it of j.items ?? []) {
    const v = videos.get(it.id);
    v.description = (it.snippet.description ?? '').slice(0, 600);
    v.tags = it.snippet.tags ?? [];
  }
}

mkdirSync(resolve(root, 'data'), { recursive: true });
writeFileSync(
  resolve(root, 'data/youtube-videos.json'),
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      videos: tutorials,
      // Everything else from the same channels: introductions, guides and talks are picked from here.
      others: [...videos.values()].filter((v) => !tutorials.includes(v)),
    },
    null,
    1,
  ),
);
console.log(report.join('\n'));
console.log(`${videos.size} videos seen, ${tutorials.length} look like tutorials. API units used: about ${units} of the 10,000 daily allowance.`);
console.log('Next: npm run library');
