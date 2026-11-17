// Builds data/hub.json from an HTML export of the r/cardistry "Cardistry Hub" doc.
// Usage: node scripts/import-hub.mjs <path-to-hub.html>
// Also asks YouTube's public oEmbed endpoint for each video's title, channel and availability.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) throw new Error('Pass the path to the exported hub.html');
const html = readFileSync(src, 'utf8');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../data/hub.json');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
const text = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const realUrl = (href) => {
  const h = decode(href);
  try {
    const u = new URL(h);
    if (u.hostname.endsWith('google.com') && u.pathname === '/url') return u.searchParams.get('q') ?? h;
  } catch {}
  return h;
};
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TEACHERS = {
  Lotus: 'Lotus in Hand', SoC: 'School of Cardistry', Fontaine: 'Fontaine Cards', Virts: 'The Virts',
  'DG Tips': 'Dealersgrip', 'Rise Tips': 'Rise Magic', Rise: 'Rise Magic', Buck: 'Dan and Dave Buck',
};
const KINDS = { '[LINK]': 'tutorial', '[PREVIEW]': 'preview', '[TIPS]': 'tips', '[BUY]': 'buy' };
const CATEGORIES = ['Iconic Moves', 'One-Handed Cuts', 'Two-Handed Cuts', 'Aerials', 'Fans', 'Isolations / Twirls / 1-Card Moves', 'Combo Moves', 'Misc. Moves'];

const moves = new Map();
const upsert = (name) => {
  const id = slug(name);
  if (!moves.has(id)) moves.set(id, { id, name, creator: null, difficulty: null, categories: [], starter: null, description: null, links: [] });
  return moves.get(id);
};
const addLink = (m, link) => {
  if (!link.url || link.url.startsWith('#')) return;
  if (!m.links.some((l) => l.url === link.url)) m.links.push(link);
};

let category = null;
const token = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>|<tr[^>]*>([\s\S]*?)<\/tr>/g;
for (const t of html.matchAll(token)) {
  if (t[1]) {
    const h = text(t[2]);
    if (CATEGORIES.includes(h)) category = h;
    continue;
  }
  const cells = [...t[3].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
  if (cells.length < 3) continue;
  const first = text(cells[0]);
  const linksIn = (cell) => [...cell.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((a) => ({ url: realUrl(a[1]), label: text(a[2]) }));

  const starter = first.match(/^(\d+)\.\s+(.*)$/);
  if (starter) {
    const m = upsert(starter[2]);
    m.starter = +starter[1];
    m.description = text(cells[cells.length - 1]) || null;
    for (const cell of cells.slice(1, -1))
      for (const l of linksIn(cell))
        addLink(m, { url: l.url, kind: /tips/i.test(l.label) ? 'tips' : 'tutorial', teacher: TEACHERS[l.label] ?? l.label });
    continue;
  }

  const difficulty = text(cells[2]);
  if (!['Easy', 'Intermediate', 'Advanced'].includes(difficulty) || !first) continue;
  const m = upsert(first);
  m.creator ??= text(cells[1]) || null;
  m.difficulty ??= difficulty;
  if (category && !m.categories.includes(category)) m.categories.push(category);
  for (const cell of cells.slice(3))
    for (const l of linksIn(cell)) addLink(m, { url: l.url, kind: KINDS[l.label] ?? 'tutorial', teacher: null });
}

const ytId = (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
const ids = [...new Set([...moves.values()].flatMap((m) => m.links.map((l) => ytId(l.url)).filter(Boolean)))];
const info = new Map();
await Promise.all(
  ids.map(async (id) => {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
      if (r.ok) {
        const j = await r.json();
        info.set(id, { status: 'ok', title: j.title, channel: j.author_name });
      } else info.set(id, { status: r.status === 404 ? 'gone' : 'restricted' });
    } catch {
      info.set(id, { status: 'unchecked' });
    }
  }),
);

const host = (url) => {
  try { return new URL(url).hostname.replace(/^www\.|^store\./, ''); } catch { return 'link'; }
};
for (const m of moves.values()) {
  for (const l of m.links) {
    const id = ytId(l.url);
    const i = id ? info.get(id) : null;
    l.status = i?.status ?? 'unchecked';
    l.title = i?.title ?? null;
    l.teacher ??= i?.channel ?? host(l.url);
  }
}

// One clear family per trick. The doc's own section wins when it is specific;
// its catch-all sections (Iconic, Misc, the beginner list) are sorted by name.
const SPECIFIC = {
  'One-Handed Cuts': 'One-handed cuts', 'Two-Handed Cuts': 'Two-handed cuts', Aerials: 'Aerials & shots',
  Fans: 'Fans & spreads', 'Combo Moves': 'Combos',
};
const family = (m) => {
  const n = m.name.toLowerCase();
  for (const c of m.categories) if (SPECIFIC[c]) return SPECIFIC[c];
  if (m.categories.includes('Isolations / Twirls / 1-Card Moves')) return /\biso\b|iso\.|isolation/.test(n) ? 'Isolations' : 'Twirls & single card';
  if (/grip/.test(n)) return 'Basics';
  if (/shuffle|faro/.test(n)) return 'Shuffles';
  if (/spring|dribble|dripple|cascade|anaconda|waterwheel|friffle/.test(n)) return 'Springs & cascades';
  if (/fan|spread|pressure/.test(n)) return 'Fans & spreads';
  if (/charlier|revolution|scissor|hot shot/.test(n)) return 'One-handed cuts';
  if (/cut|sybil|werm/.test(n)) return 'Two-handed cuts';
  return 'Flourishes';
};
for (const m of moves.values()) {
  m.iconic = m.categories.includes('Iconic Moves');
  m.category = family(m);
  delete m.categories;
}

const list = [...moves.values()].sort((a, b) => (a.starter ?? 999) - (b.starter ?? 999) || a.name.localeCompare(b.name));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ source: 'r/cardistry Cardistry Hub v1.1', checked: new Date().toISOString().slice(0, 10), moves: list }, null, 1));

const all = list.flatMap((m) => m.links);
console.log(`${list.length} moves, ${all.length} links`);
console.log('starter:', list.filter((m) => m.starter).length, '| no links:', list.filter((m) => !m.links.length).map((m) => m.name).join(', '));
console.log('status:', JSON.stringify(all.reduce((a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {})));
console.log('kinds:', JSON.stringify(all.reduce((a, l) => ((a[l.kind] = (a[l.kind] ?? 0) + 1), a), {})));
console.log('families:', JSON.stringify(list.reduce((a, m) => ((a[m.category] = (a[m.category] ?? 0) + 1), a), {})));
console.log('flourishes:', list.filter((m) => m.category === 'Flourishes').map((m) => m.name).join(', '));
