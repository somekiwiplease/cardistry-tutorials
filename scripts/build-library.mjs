// Merges the curated Hub tricks (data/hub.json) with tricks found on YouTube
// (data/youtube-videos.json, optional) into src/data/moves.json, which the site reads.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trickFromTitle, keyOf, familyOf } from './lib/titles.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const hub = read('data/hub.json');
const yt = existsSync(resolve(root, 'data/youtube-videos.json')) ? read('data/youtube-videos.json') : null;

const ytId = (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
const moves = hub.moves.map((m) => ({ ...m, source: 'hub' }));
const byKey = new Map(moves.map((m) => [keyOf(m.name), m]));

// Other names the same trick goes by on YouTube, mapped to the name used in the Hub guide.
const ALIASES = {
  Grips: 'Basic Grips', 'The Grips': 'Basic Grips', Sybil: 'Five Faces of Sybil', 'Card Spring': 'Spring',
  Waterfall: 'Cascade', Flick: 'Flic', 'Long Distance Spinner': 'Long Dist. Spinner', Pirouette: 'Padiddle / Pirouette',
  'Kickflip Skater Cut': 'Skater Cut/Kickflip', 'One Handed Shuffle': 'OH Shuffle', 'L Cut': 'L-Cuts',
  'Table Spread': 'Ribbon Spread', 'Swing and Swivel Cut': 'Swing Cut', 'Swing Cut & Swivel Cut': 'Swing Cut',
  'One Handed Fan': 'Smear Fan', Nestlo: 'Nestlo Iso.', Inso: 'Inso Iso.', 'The Werm': 'WERM', 'Hot Shot Card Shoot': 'Hot Shot Cut',
  'Card Twirl': 'Basic Twirl', 'No-Weave Giant Circle': 'No-Weave Circle', 'Riffle Shuffle and Bridge': 'Riffle Shuffle',
};
for (const [alias, name] of Object.entries(ALIASES)) {
  const m = byKey.get(keyOf(name));
  if (m) byKey.set(keyOf(alias), m);
}
// One letter apart ("Piroutte" / "Pirouette") counts as the same trick when the name is long enough to be sure.
const oneApart = (a, b) => {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
const nearKey = (key) => {
  if (key.length < 7 || /\d/.test(key)) return null;
  for (const k of byKey.keys()) if (k.length >= 7 && !/\d/.test(k) && oneApart(k, key)) return k;
  return null;
};
const known = new Set(moves.flatMap((m) => m.links.map((l) => ytId(l.url)).filter(Boolean)));
const ids = new Set(moves.map((m) => m.id));

let added = 0, merged = 0;
for (const v of yt?.videos ?? []) {
  if (known.has(v.id)) continue;
  const t = trickFromTitle(v.title);
  if (!t) continue;
  const key = keyOf(t.name);
  if (!key) continue;
  const link = { url: `https://youtu.be/${v.id}`, kind: 'tutorial', teacher: v.channel ?? v.source, status: 'ok', title: v.title };
  let m = byKey.get(key) ?? byKey.get(nearKey(key));
  if (m) merged++;
  else {
    let id = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || v.id;
    while (ids.has(id)) id += '-2';
    ids.add(id);
    m = { id, name: t.name, creator: t.creator, difficulty: null, starter: null, description: null, links: [], iconic: false, category: familyOf(v), source: 'youtube' };
    moves.push(m);
    byKey.set(key, m);
    added++;
  }
  m.creator ??= t.creator;
  m.links.push(link);
  known.add(v.id);
}

// Hand-set families for tricks the titles could not place.
const overrides = existsSync(resolve(root, 'data/overrides.json')) ? read('data/overrides.json').families : {};
for (const m of moves) if (overrides[m.name]) m.category = overrides[m.name][0];
if (overrides["Newton s Cradle"]) for (const m of moves) if (m.name === 'Newton s Cradle') m.name = "Newton's Cradle";

// Families follow the common cardistry groupings, and a move can belong to several.
// The first is its main family; the rest come from Cardistry Base's tags where the move is listed there.
const RENAME = {
  'Aerials & shots': 'Aerials & drops',
  'Springs & cascades': 'Aerials & drops',
  'Twirls & single card': 'Twirls',
  Shuffles: 'Shuffles & weaves',
  Flourishes: 'Other',
};
const cb = existsSync(resolve(root, 'data/cardistrybase.json')) ? read('data/cardistrybase.json').moves : {};
const TAG_FAMILIES = [
  ['One-handed cuts', (t) => t.has('one-handed') && t.has('packet-cut')],
  ['Two-handed cuts', (t) => t.has('two-handed') && t.has('packet-cut')],
  ['Isolations', (t) => t.has('isolation')],
  ['Twirls', (t) => t.has('twirl') || (t.has('single-card') && t.has('spin') && !t.has('packet-cut'))],
  ['Fans & spreads', (t) => t.has('fan') || t.has('spread')],
  ['Aerials & drops', (t) => t.has('aerial') || t.has('card-shot') || t.has('cascade') || t.has('deck-flip')],
  ['Shuffles & weaves', (t) => t.has('shuffle') || t.has('interlock')],
  ['Displays & structures', (t) => t.has('display') || t.has('polygonal')],
  ['Combos', (t) => t.has('combo')],
  ['Flourishes', (t) => t.has('opener')],
  // Styles: how or where it's done, rather than what the cards do.
  ['Table', (t) => t.has('table')],
];
// Only used to pick a main family for a move we had no family for.
const LOOSE = [
  ['One-handed cuts', (t) => t.has('one-handed')],
  ['Two-handed cuts', (t) => t.has('two-handed') && t.has('rotation')],
];
const levelFromCb = (n) => (n <= 2 ? 'Easy' : n <= 4 ? 'Intermediate' : 'Advanced');
let sorted = 0, rated = 0;
for (const m of moves) {
  let main = RENAME[m.category] ?? m.category;
  const hit = cb[m.id];
  const tags = new Set(hit ? hit[2].split(' ') : []);
  const fromTags = TAG_FAMILIES.filter(([, test]) => test(tags)).map(([f]) => f);
  if ((main === 'Unsorted' || main === 'Other') && hit) {
    const pick = fromTags.find((f) => f !== 'Table' && f !== 'Body') ?? LOOSE.find(([, test]) => test(tags))?.[0];
    if (pick) {
      if (main === 'Unsorted') sorted++;
      main = pick;
    }
  }
  m.category = main;
  // Families you set by hand are final: they replace anything worked out from tags.
  m.categories = overrides[m.name]?.[1] === 'you' ? [main] : [main, ...fromTags.filter((f) => f !== main)];
  for (const extra of overrides[m.name]?.[2] ?? []) if (!m.categories.includes(extra)) m.categories.push(extra);
  if (overrides[m.name]?.[3] && !m.starter) {
    m.difficulty = overrides[m.name][3];
    m.levelSource = 'you';
  }
  if (hit) {
    m.cardistryBase = `https://cardistrybase.com/moves/${hit[0]}`;
    if (!m.starter && !m.difficulty && hit[1]) {
      m.difficulty = levelFromCb(hit[1]);
      m.levelSource = 'Cardistry Base';
      rated++;
    }
  }
}
console.log(`Cardistry Base: ${Object.keys(cb).length} moves matched, ${sorted} unsorted moves placed, ${rated} unrated moves given a level.`);

// Levels you supplied for moves that had none.
const myLevels = existsSync(resolve(root, 'data/levels.json')) ? read('data/levels.json') : {};
const levelByName = new Map();
for (const lvl of ['Easy', 'Intermediate', 'Advanced']) for (const n of myLevels[lvl] ?? []) levelByName.set(n, lvl);
const unmatched = new Set(levelByName.keys());
for (const m of moves) {
  const lvl = levelByName.get(m.name);
  if (!lvl) continue;
  unmatched.delete(m.name);
  if (m.starter) continue;
  m.difficulty = lvl;
  m.levelSource = 'you';
}
if (unmatched.size) console.log('Levels for names not found:', [...unmatched].join(', '));

// Keep only links you can learn from. Out go performance previews, demo reels, teasers for
// paid tutorials, clips too short to teach anything, and videos that are gone or private.
const durations = existsSync(resolve(root, 'data/durations.json')) ? read('data/durations.json') : {};
const SHOWCASE = /\bdemos?\b|demonstrations?|teaser|trailer|premium|patreon exclusive/i;
const teaches = (l) => {
  if (l.kind === 'buy') return true;
  if (l.kind === 'preview' || l.status === 'gone' || l.status === 'restricted') return false;
  if (l.title && SHOWCASE.test(l.title)) return false;
  const secs = durations[ytId(l.url)];
  return !(secs !== undefined && secs < 45);
};
// Dead links found by `npm run check-links`, and old insecure addresses that have a secure version.
const fixes = existsSync(resolve(root, 'data/link-fixes.json')) ? read('data/link-fixes.json') : { remove: [], replace: {} };
const dead = new Set(fixes.remove);
const linkStatus = existsSync(resolve(root, 'data/link-status.json')) ? read('data/link-status.json').status : {};
for (const m of moves) {
  for (const l of m.links) l.url = fixes.replace[l.url] ?? l.url;
  m.links = m.links.filter((l) => !dead.has(l.url) && !String(linkStatus[l.url] ?? '').startsWith('broken') && !l.url.startsWith('http://'));
}
let cutLinks = 0;
for (const m of moves) {
  const before = m.links.length;
  // A "preview" that points at a shop page is really where the tutorial is sold.
  for (const l of m.links) if (l.kind === 'preview' && !/youtu|instagram/.test(l.url)) l.kind = 'buy';
  m.links = m.links.filter(teaches);
  cutLinks += before - m.links.length;
}
// Moves you asked to take off the site.
const removed = new Set(existsSync(resolve(root, 'data/overrides.json')) ? read('data/overrides.json').removed ?? [] : []);
const empty = moves.filter((m) => !m.links.length).map((m) => m.name);
const kept = moves.filter((m) => m.links.length && !removed.has(m.name));
moves.length = 0;
moves.push(...kept);

// One spelling per teacher, whatever the channel calls itself.
const TEACHER = { 'school of cardistry': 'School of Cardistry', lotusinhand: 'Lotus in Hand', dealersgrip: 'Dealersgrip', anyone: 'Anyone Worldwide', 'di.cardistry': 'di.cardistry' };
for (const m of moves) for (const l of m.links) l.teacher = TEACHER[l.teacher.toLowerCase()] ?? l.teacher;

moves.sort((a, b) => (a.starter ?? 999) - (b.starter ?? 999) || a.name.localeCompare(b.name));
mkdirSync(resolve(root, 'src/data'), { recursive: true });
writeFileSync(
  resolve(root, 'src/data/moves.json'),
  JSON.stringify({ source: hub.source, checked: hub.checked, youtubeFetched: yt?.fetched ?? null, moves }, null, 1),
);
console.log(`${moves.length} moves: ${hub.moves.length} from the Hub guide, ${added} new from YouTube, ${merged} extra tutorials attached to existing tricks.`);
console.log(`Removed ${cutLinks} links that don't teach, and ${empty.length} tricks left with nothing to learn from: ${empty.join(', ')}`);
console.log(JSON.stringify(moves.reduce((a, m) => ((a[m.category] = (a[m.category] ?? 0) + 1), a), {})));
