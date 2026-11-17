import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from './data/moves.json';
import guides from './data/guides.json';
import { store } from './store';

type Link = { url: string; kind: 'tutorial' | 'tips' | 'preview' | 'buy'; teacher: string; status: string; title: string | null };
type Move = {
  id: string;
  name: string;
  creator: string | null;
  difficulty: 'Easy' | 'Intermediate' | 'Advanced' | null;
  category: string; // main family
  categories: string[]; // main family first, then any others it also belongs to
  iconic: boolean;
  starter: number | null;
  description: string | null;
  links: Link[];
};
type Folder = { id: string; name: string; tricks: string[] };
type Saved = { learnt: Record<string, string>; folders: Folder[] };
type View = 'all' | 'learnt' | 'guides' | string; // a folder id otherwise
type Layout = 'grid' | 'list';
type Status = 'all' | 'todo' | 'learnt';
type Sort = 'suggested' | 'az' | 'level' | 'levelDesc';
type Option = { value: string; label: string; count?: number };

const MOVES = data.moves as unknown as Move[];
const BY_ID = new Map(MOVES.map((m) => [m.id, m]));

const CATEGORIES = [
  'Basics',
  'One-handed cuts',
  'Two-handed cuts',
  'Fans & spreads',
  'Aerials & drops',
  'Twirls',
  'Isolations',
  'Displays & structures',
  'Shuffles & weaves',
  'Combos',
  'Flourishes',
  'Table',
  'Other',
  'Unsorted',
];
// "Iconic" sits in the Type menu beside the families. A move can be both, e.g. a two-handed cut that is also iconic.
const ICONIC = 'Iconic';
const inType = (m: Move, type: string) => (type === ICONIC ? m.iconic : m.categories.includes(type));
const LEVELS = ['Starter', 'Easy', 'Intermediate', 'Advanced', 'Unrated'] as const;
type Level = (typeof LEVELS)[number];
const levelOf = (m: Move): Level => (m.starter ? 'Starter' : m.difficulty ?? 'Unrated');

const primary = (m: Move) => m.links.find((l) => l.kind === 'tutorial') ?? m.links.find((l) => l.kind !== 'buy') ?? m.links[0];
const linkLabel = (l: Link) => (l.kind === 'buy' ? `Buy · ${l.teacher}` : l.kind === 'tips' ? `Tips · ${l.teacher}` : l.teacher);

const ytId = (url: string) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
const thumbOf = (m: Move) => {
  const id = ytId(primary(m).url) ?? m.links.map((l) => ytId(l.url)).find(Boolean);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
};
const DRAG = 'application/x-cardistry-trick';

const GUIDE_COUNT = guides.groups.reduce((n, g) => n + g.videos.length, 0);
const FAQ_COUNT = guides.faq.sections.reduce((n, s) => n + s.items.length, 0);
const PAGE = 60;
const LEGACY = 'cardistry.v1'; // progress saved before profiles existed
const storeKey = (profileId: string) => `cardistry.v1.${profileId}`;
const load = (key: string): Saved => {
  try {
    const s = JSON.parse(store.getItem(key) ?? 'null');
    if (s && typeof s === 'object') return { learnt: s.learnt ?? {}, folders: Array.isArray(s.folders) ? s.folders : [] };
  } catch {}
  return { learnt: {}, folders: [] };
};

function Library({ profile, onSwitch, guest }: { profile: Profile; onSwitch: () => void; guest?: boolean }) {
  const STORE = storeKey(profile.id);
  const [saved, setSaved] = useState<Saved>(() => load(STORE));
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<Sort>('suggested');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastGo, setToastGo] = useState<string | null>(null);
  // A guest's first save asks, once, whether to put it under a name. Their progress is kept either way.
  const [nudge, setNudge] = useState(false);
  const hasProgress = Object.keys(saved.learnt).length > 0 || saved.folders.length > 0;
  useEffect(() => {
    if (!guest || !hasProgress || store.getItem(NUDGED)) return;
    store.setItem(NUDGED, '1');
    setNudge(true);
  }, [guest, hasProgress]); // folder the toast's "Open" goes to
  const say = (text: string, go: string | null = null) => {
    setToast(text);
    setToastGo(go);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toastGo ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [toast, toastGo]);
  const [layout, setLayout] = useState<Layout>(() => (store.getItem('cardistry.layout') === 'list' ? 'list' : 'grid'));
  useEffect(() => {
    try {
      store.setItem('cardistry.layout', layout);
    } catch {}
  }, [layout]);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      store.setItem(STORE, JSON.stringify(saved));
    } catch {}
  }, [saved]);

  // "/" jumps to search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const folder = saved.folders.find((f) => f.id === view) ?? null;
  useEffect(() => {
    if (view !== 'all' && view !== 'learnt' && view !== 'guides' && !folder) setView('all');
  }, [view, folder]);

  const toggleLearnt = (id: string) =>
    setSaved((s) => {
      const learnt = { ...s.learnt };
      if (learnt[id]) delete learnt[id];
      else learnt[id] = new Date().toISOString();
      return { ...s, learnt };
    });
  const createFolder = (name: string, tricks: string[] = []) => {
    const id = crypto.randomUUID();
    setSaved((s) => ({ ...s, folders: [...s.folders, { id, name: name.trim(), tricks }] }));
    return id;
  };
  const addToFolder = (folderId: string, tricks: string[]) =>
    setSaved((s) => ({
      ...s,
      folders: s.folders.map((f) => (f.id !== folderId ? f : { ...f, tricks: [...f.tricks, ...tricks.filter((t) => !f.tricks.includes(t))] })),
    }));
  const removeFromFolder = (folderId: string, tricks: string[]) =>
    setSaved((s) => ({ ...s, folders: s.folders.map((f) => (f.id !== folderId ? f : { ...f, tricks: f.tricks.filter((t) => !tricks.includes(t)) })) }));
  const setLearnt = (ids: string[], on: boolean) =>
    setSaved((s) => {
      const learnt = { ...s.learnt };
      for (const id of ids) {
        if (on) learnt[id] ??= new Date().toISOString();
        else delete learnt[id];
      }
      return { ...s, learnt };
    });
  const lastPicked = useRef<string | null>(null);
  const toggleSelect = (id: string) => {
    lastPicked.current = id;
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  };
  // Shift-click selects everything between the last move you picked and this one, as in Finder.
  const selectRange = (id: string) => {
    const ids = [...document.querySelectorAll<HTMLElement>('main [data-id]')].map((el) => el.dataset.id!);
    const a = ids.indexOf(lastPicked.current ?? id);
    const b = ids.indexOf(id);
    if (a < 0 || b < 0) return toggleSelect(id);
    const span = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    setSelected((sel) => [...new Set([...sel, ...span])]);
    lastPicked.current = id;
  };

  // Drag a box from any empty spot to select every move it touches. Holding Shift or Cmd adds to what's already selected.
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const startBox = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    // Any empty spot counts, including the margins either side of the page, but not controls or the moves themselves.
    if (t.closest('.card, .row, button, a, input, label, .picker, .bulk, .controls, .top, .shelf, .head, .scrim, .marquee')) return;
    if (!document.querySelector('main [data-id]')) return;
    e.preventDefault();
    const keep = e.shiftKey || e.metaKey || e.ctrlKey ? [...selected] : [];
    const x0 = e.clientX;
    const y0 = e.clientY + window.scrollY;
    const items = [...document.querySelectorAll<HTMLElement>('main [data-id]')];
    let moved = false;
    let lastY = e.clientY;
    let lastX = e.clientX;
    let raf = 0;
    const update = () => {
      const y1 = lastY + window.scrollY;
      const r = { left: Math.min(x0, lastX), right: Math.max(x0, lastX), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
      if (!moved && r.right - r.left < 6 && r.bottom - r.top < 6) return;
      moved = true;
      setBox({ x: r.left, y: r.top - window.scrollY, w: r.right - r.left, h: r.bottom - r.top });
      const hit = items
        .filter((el) => {
          const b = el.getBoundingClientRect();
          const top = b.top + window.scrollY;
          return b.left < r.right && b.right > r.left && top < r.bottom && top + b.height > r.top;
        })
        .map((el) => el.dataset.id!);
      setSelected([...new Set([...keep, ...hit])]);
    };
    // Scroll the page when the box reaches the top or bottom edge.
    const tick = () => {
      const edge = 60;
      const dy = lastY < edge ? -(edge - lastY) / 3 : lastY > innerHeight - edge ? (lastY - (innerHeight - edge)) / 3 : 0;
      if (dy) {
        window.scrollBy(0, dy);
        update();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      update();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(null);
      if (!moved && !keep.length) setSelected([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const boxRef = useRef(startBox);
  boxRef.current = startBox;
  useEffect(() => {
    const down = (e: MouseEvent) => boxRef.current(e);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);

  const nameOf = (id: string) => saved.folders.find((f) => f.id === id)?.name ?? 'folder';
  const count = (n: number) => `${n} ${n === 1 ? 'move' : 'moves'}`;
  const renameFolder = (id: string, name: string) =>
    setSaved((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)) }));
  const deleteFolder = (id: string) => setSaved((s) => ({ ...s, folders: s.folders.filter((f) => f.id !== id) }));

  const base = useMemo(() => {
    if (view === 'all') return MOVES;
    if (view === 'learnt') return MOVES.filter((m) => saved.learnt[m.id]);
    return (folder?.tricks ?? []).map((id) => BY_ID.get(id)).filter((m): m is Move => !!m);
  }, [view, folder, saved.learnt]);

  // Ignore spaces and punctuation, so "deckflip" finds Deck Flip and "lepaul" finds LePaul Spread.
  const q = query.trim();
  // One test for every filter. `skip` leaves one filter out, which is how each menu counts
  // what its options would give you with all the other filters still applied.
  const pass = (m: Move, skip?: 'type' | 'level' | 'teacher' | 'status') =>
    (!q || matchMove(m, q)) &&
    (skip === 'type' || !types.length || types.some((t) => inType(m, t))) &&
    (skip === 'level' || !levels.length || levels.includes(levelOf(m))) &&
    (skip === 'teacher' || !teachers.length || m.links.some((l) => teachers.includes(l.teacher))) &&
    (skip === 'status' || status === 'all' || (status === 'learnt') === !!saved.learnt[m.id]);

  const filterCount = types.length + levels.length + teachers.length + (status !== 'all' ? 1 : 0);
  const filtering = !!q || filterCount > 0 || sort !== 'suggested';
  const results = useMemo(() => {
    const out = base.filter((m) => pass(m));
    if (sort === 'az') return [...out].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'level') return [...out].sort((a, b) => LEVELS.indexOf(levelOf(a)) - LEVELS.indexOf(levelOf(b)) || a.name.localeCompare(b.name));
    if (sort === 'levelDesc') { const r = (m: Move) => (levelOf(m) === 'Unrated' ? 99 : -LEVELS.indexOf(levelOf(m))); return [...out].sort((a, b) => r(a) - r(b) || a.name.localeCompare(b.name)); }
    return out;
  }, [base, q, types, levels, teachers, status, sort, saved.learnt]);

  const typeOptions: Option[] = [...CATEGORIES, ICONIC].map((c) => ({ value: c, label: c, count: base.filter((m) => inType(m, c) && pass(m, 'type')).length })).filter(
    (o) => o.count || types.includes(o.value),
  );
  const levelOptions: Option[] = LEVELS.map((l) => ({ value: l, label: l, count: base.filter((m) => levelOf(m) === l && pass(m, 'level')).length })).filter(
    (o) => o.count || levels.includes(o.value),
  );
  const teacherOptions: Option[] = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of base) {
      if (!pass(m, 'teacher')) continue;
      for (const t of new Set(m.links.filter((l) => l.kind !== 'buy').map((l) => l.teacher))) n.set(t, (n.get(t) ?? 0) + 1);
    }
    for (const t of teachers) if (!n.has(t)) n.set(t, 0);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }));
  }, [base, q, types, levels, teachers, status, saved.learnt]);
  const statusOptions: Option[] = [
    { value: 'all', label: 'Any', count: base.filter((m) => pass(m, 'status')).length },
    { value: 'todo', label: 'Not learnt yet', count: base.filter((m) => pass(m, 'status') && !saved.learnt[m.id]).length },
    { value: 'learnt', label: 'Learnt', count: base.filter((m) => pass(m, 'status') && saved.learnt[m.id]).length },
  ];
  const sortOptions: Option[] = [
    { value: 'suggested', label: 'Suggested order' },
    { value: 'az', label: 'Name, A to Z' },
    { value: 'level', label: 'Level, easiest first' },
    { value: 'levelDesc', label: 'Level, hardest first' },
  ];

  useEffect(() => setLimit(PAGE), [view, query, types, levels, teachers, status, sort]);

  const clearFilters = () => {
    setTypes([]);
    setLevels([]);
    setTeachers([]);
    setStatus('all');
  };
  const clear = () => {
    setQuery('');
    clearFilters();
    setSort('suggested');
  };
  const go = (v: View) => {
    setView(v);
    clear();
    setSelected([]);
    window.scrollTo({ top: 0 });
  };

  const learntCount = MOVES.filter((m) => saved.learnt[m.id]).length;

  // The browser tab names where you are.
  useEffect(() => {
    const where = folder ? folder.name : view === 'learnt' ? 'Learnt' : view === 'guides' ? 'Introductions' : null;
    document.title = where ? `${where} · Cardistry Tutorials` : 'Cardistry Tutorials';
  }, [view, folder]);

  const foldersApi: FoldersApi = {
    folders: saved.folders,
    toggle: (fid, id) => {
      const f = saved.folders.find((x) => x.id === fid);
      if (!f) return;
      const name = BY_ID.get(id)?.name ?? 'Move';
      if (f.tricks.includes(id)) {
        removeFromFolder(fid, [id]);
        setToast(`Removed ${name} from ${f.name}`);
      } else {
        addToFolder(fid, [id]);
        say(`Added ${name} to ${f.name}`, fid);
      }
    },
    create: (name, id) => {
      say(`Added ${BY_ID.get(id)?.name ?? 'move'} to ${name.trim()}`, createFolder(name, [id]));
    },
  };
  const list = (moves: Move[], paged = true) => {
    const shown = paged ? moves.slice(0, limit) : moves;
    return (
      <>
        <FoldersCtx.Provider value={foldersApi}>
        <ul className={`${layout === 'grid' ? 'grid' : 'list'}${selected.length ? ' selecting' : ''}`}>
          {shown.map((m) => {
            const props = {
              move: m,
              learnt: !!saved.learnt[m.id],
              selected: selected.includes(m.id),
              dragIds: selected.includes(m.id) ? selected : [m.id],
              onSelect: (e: React.MouseEvent) => (e.shiftKey ? selectRange(m.id) : toggleSelect(m.id)),
              onLearnt: () => toggleLearnt(m.id),
            };
            return layout === 'grid' ? <Card key={m.id} {...props} /> : <Row key={m.id} {...props} />;
          })}
        </ul>
        </FoldersCtx.Provider>
        {shown.length < moves.length && (
          <button className="more" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, moves.length - shown.length)} more
            <span> · {moves.length - shown.length} left</span>
          </button>
        )}
      </>
    );
  };

  return (
    <div className="page">
      <div className="top">
        <button className="brand" onClick={() => go('all')}>
          <Mark /> Cardistry
        </button>
        <div className="topright">
          {guest ? (
            <button className="btn small" onClick={onSwitch}>Make a profile</button>
          ) : (
            <ProfileMenu profile={profile} onSwitch={onSwitch} />
          )}
        </div>
      </div>

      {view === 'all' ? (
        <section className="shelf" aria-label="Your folders">
          <FolderIcon tone="guide" name="Introductions" meta={`${GUIDE_COUNT} videos · ${FAQ_COUNT} answers`} onOpen={() => go('guides')} />
          <FolderIcon tone="done" name="Learnt" meta={`${learntCount} ${learntCount === 1 ? 'move' : 'moves'}`} onOpen={() => go('learnt')} />
          {saved.folders.map((f) => {
            const done = f.tricks.filter((t) => saved.learnt[t]).length;
            return (
              <FolderIcon
                key={f.id}
                name={f.name}
                meta={f.tricks.length ? `${done} of ${f.tricks.length} learnt` : 'Empty'}
                onOpen={() => go(f.id)}
                onDropTrick={(ids) => {
                  addToFolder(f.id, ids);
                  say(`Added ${count(ids.length)} to ${f.name}`, f.id);
                  setSelected([]);
                }}
              />
            );
          })}
          <NewFolder onCreate={(name) => createFolder(name)} />
        </section>
      ) : (
        <button className="back" onClick={() => go('all')}>
          <span aria-hidden="true">‹</span> Back
        </button>
      )}

      <div>
        {folder ? (
          <FolderHeader
            key={folder.id}
            folder={folder}
            done={folder.tricks.filter((t) => saved.learnt[t]).length}
            onRename={(name) => renameFolder(folder.id, name)}
            onDelete={() => deleteFolder(folder.id)}
            onAdd={() => setAdding(true)}
          />
        ) : (
          <header className="head">
            <h1>{view === 'learnt' ? 'Learnt' : view === 'guides' ? 'Introductions' : 'All moves'}</h1>
            <p className="headsub">
              {view === 'guides'
                ? 'Watch these before you touch a deck. They explain what cardistry is and how to begin; the moves come after.'
                : view === 'learnt'
                ? `${learntCount} of ${MOVES.length} moves`
                : `${MOVES.length} moves, each one click from its tutorial. Select a few, or drag one onto a folder, to save them.`}
            </p>
          </header>
        )}

        {view !== 'guides' && base.length > 0 && (
          <div className="controls">
            <div className="searchwrap">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                ref={search}
                className="search"
                type="text"
                placeholder={folder ? 'Search this folder' : 'Search moves, creators or sources'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                aria-label="Search moves, creators or sources"
              />
              {query ? (
                <div className="searchtrail">
                  <span className="searchmirror" aria-hidden="true">{query}</span>
                  <button className="searchclear" onClick={() => { setQuery(''); search.current?.focus(); }} aria-label="Clear search">✕</button>
                </div>
              ) : null}
            </div>
            <div className="filterrow">
              <FilterMenu label="Type" options={typeOptions} value={types} onChange={setTypes} />
              <FilterMenu label="Level" options={levelOptions} value={levels} onChange={setLevels} />
              <FilterMenu label="Source" options={teacherOptions} value={teachers} onChange={setTeachers} searchable />
              {view !== 'learnt' && (
                <FilterMenu label="Status" options={statusOptions} value={[status]} onChange={(v) => setStatus((v[0] as Status) ?? 'all')} single fallback="all" />
              )}
              <span className="gap" />
        <div className="viewswitch" role="group" aria-label="View">
          <button aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} aria-label="Icon view" title="Icon view">
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
          </button>
          <button aria-pressed={layout === 'list'} onClick={() => setLayout('list')} aria-label="List view" title="List view">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
          </button>
        </div>
              <FilterMenu label="Sort" options={sortOptions} value={[sort]} onChange={(v) => setSort((v[0] as Sort) ?? 'suggested')} single fallback="suggested" alignRight />
            </div>
            {(filterCount > 0 || !!q) && (
              <div className="activerow" aria-live="polite">
                <span className="resultcount">
                  {results.length} {results.length === 1 ? 'move' : 'moves'}
                </span>
                {types.map((t) => (
                  <Applied key={t} label={t} onRemove={() => setTypes(types.filter((x) => x !== t))} />
                ))}
                {levels.map((l) => (
                  <Applied key={l} label={l} onRemove={() => setLevels(levels.filter((x) => x !== l))} />
                ))}
                {teachers.map((t) => (
                  <Applied key={t} label={t} onRemove={() => setTeachers(teachers.filter((x) => x !== t))} />
                ))}
                {status !== 'all' && <Applied label={status === 'todo' ? 'Not learnt yet' : 'Learnt'} onRemove={() => setStatus('all')} />}
                {filterCount > 0 && (
                  <button className="clearall" onClick={clearFilters}>
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <main>
          {view === 'guides' ? (
            <>
              {guides.groups.map((g) => (
              <section key={g.title} className="guidegroup">
                <h2 className="guidetitle">{g.title}</h2>
                <p className="guideblurb">{g.blurb}</p>
                <ul className="grid">
                  {g.videos.map((v) => (
                    <li key={v.id} className="card guide">
                      <a className="thumb" href={`https://youtu.be/${v.id}`} target="_blank" rel="noreferrer">
                        <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
                        <span className="play" aria-hidden="true">▶</span>
                      </a>
                      <a className="name guidename" href={`https://youtu.be/${v.id}`} target="_blank" rel="noreferrer">
                        {v.title}
                      </a>
                      <span className="sub">{v.channel}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
              <section className="guidegroup faq">
                <h2 className="guidetitle">Common questions</h2>
                <p className="guideblurb">
                  {guides.faq.credit}{' '}
                  <a href={guides.faq.creditUrl} target="_blank" rel="noreferrer">
                    Read the full guide ↗
                  </a>
                </p>
                {guides.faq.sections.map((sec) => (
                  <div key={sec.title} className="faqsection">
                    <h3>{sec.title}</h3>
                    {sec.items.map((it) => (
                      <details key={it.q} className="faqitem">
                        <summary>{it.q}</summary>
                        <p>{it.a}</p>
                      </details>
                    ))}
                  </div>
                ))}
              </section>
            </>
          ) : base.length === 0 ? (
            <div className="empty big">
              <EmptyArt kind={folder ? 'folder' : 'learnt'} />
              <p className="emptytitle">{folder ? 'Nothing in here yet' : 'Nothing learnt yet'}</p>
              <p>
                {folder
                  ? 'Add the moves you want to learn next.'
                  : 'Press “Mark as learnt” on a move once you can do it, and it will show up here.'}
              </p>
              {folder ? (
                <button className="btn solid" onClick={() => setAdding(true)}>Browse and add moves</button>
              ) : (
                <button className="btn solid" onClick={() => go('all')}>Browse all moves</button>
              )}
            </div>
          ) : view === 'all' && !filtering ? (
            <>
              <h2 className="section">Start here</h2>
              {list(MOVES.filter((m) => m.starter), false)}
              <h2 className="section">Everything else</h2>
              {list(MOVES.filter((m) => !m.starter))}
            </>
          ) : results.length ? (
            <>
              {list(results)}
            </>
          ) : (
            <div className="empty">
              <p className="emptytitle">No moves match that</p>
              <button className="text" onClick={clear}>Clear search and filters</button>
            </div>
          )}
        </main>
        {box && createPortal(<div className="marquee" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />, document.body)}

        {selected.length > 0 && (
          <BulkBar
            n={selected.length}
            folders={saved.folders}
            inFolder={!!folder}
            allLearnt={selected.every((id) => saved.learnt[id])}
            onAdd={(fid) => {
              addToFolder(fid, selected);
              say(`Added ${count(selected.length)} to ${nameOf(fid)}`, fid);
              setSelected([]);
            }}
            onCreate={(name) => {
              say(`Added ${count(selected.length)} to ${name.trim()}`, createFolder(name, selected));
              setSelected([]);
            }}
            onLearnt={(on) => {
              setLearnt(selected, on);
              setToast(on ? `Marked ${count(selected.length)} as learnt` : `Unmarked ${count(selected.length)}`);
              setSelected([]);
            }}
            onRemove={() => {
              if (folder) removeFromFolder(folder.id, selected);
              setToast(`Removed ${count(selected.length)} from this folder`);
              setSelected([]);
            }}
            onClear={() => setSelected([])}
          />
        )}
        {adding && folder && (
          <AddMoves
            folder={folder}
            learnt={saved.learnt}
            onClose={() => setAdding(false)}
            onAdd={(ids) => {
              addToFolder(folder.id, ids);
              setToast(`Added ${count(ids.length)} to ${folder.name}`);
              setAdding(false);
            }}
          />
        )}
        <BackToTop raised={selected.length > 0} />
        {nudge && (
          <Dialog
            safe
            title="Keep your progress?"
            body="It's saved in this browser already. Add your name to keep it as your profile, so others on this computer can have their own."
            confirm="Add my name"
            cancel="Not now"
            onConfirm={() => {
              setNudge(false);
              onSwitch();
            }}
            onCancel={() => setNudge(false)}
          />
        )}
        {toast &&
          createPortal(
            <div className="toast" role="status">
              {toast}
              {toastGo && toastGo !== view && saved.folders.some((f) => f.id === toastGo) && (
                <button className="toastgo" onClick={() => { go(toastGo); setToast(null); }}>Open</button>
              )}
            </div>,
            document.body,
          )}

        <footer className="foot">
          Moves and links come from the r/cardistry Cardistry Hub guide and YouTube. Every tutorial belongs to its creator. Your folders and
          ticks are saved in this browser only.
        </footer>
      </div>
    </div>
  );
}

function FolderArt({ tone }: { tone?: 'done' | 'new' | 'guide' }) {
  return (
    <svg className="folderart" data-tone={tone} viewBox="0 0 120 92" aria-hidden="true">
      <path className="fback" d="M6 18a8 8 0 0 1 8-8h27a8 8 0 0 1 5.7 2.3l5 5a8 8 0 0 0 5.6 2.3H106a8 8 0 0 1 8 8V78a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V18z" />
      <rect className="ffront" x="6" y="30" width="108" height="56" rx="8" />
      {tone === 'new' && <path className="fplus" d="M60 48v20M50 58h20" />}
      {tone === 'done' && <path className="fplus" d="M50 58l7 7 14-15" />}
      {tone === 'guide' && <path className="fplay" d="M53 47v22l19-11z" />}
    </svg>
  );
}

function FolderIcon({ name, meta, tone, onOpen, onDropTrick }: { name: string; meta: string; tone?: 'done' | 'guide'; onOpen: () => void; onDropTrick?: (ids: string[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button
      className="folder"
      data-over={over || undefined}
      onClick={onOpen}
      onDragOver={(e) => {
        if (!onDropTrick || !e.dataTransfer.types.includes(DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG);
        if (id && onDropTrick) {
          e.preventDefault();
          onDropTrick(id.split(','));
        }
      }}
    >
      <FolderArt tone={tone} />
      <span className="foldername">{name}</span>
      <span className="foldermeta">{meta}</span>
    </button>
  );
}

function NewFolder({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const done = () => {
    setOpen(false);
    setName('');
  };
  if (!open)
    return (
      <button className="folder" onClick={() => setOpen(true)}>
        <FolderArt tone="new" />
        <span className="foldername muted">New folder</span>
        <span className="foldermeta">&nbsp;</span>
      </button>
    );
  return (
    <form
      className="folder"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(name);
        done();
      }}
    >
      <FolderArt />
      <input
        className="foldinput"
        autoFocus
        value={name}
        maxLength={40}
        placeholder="untitled folder"
        aria-label="Folder name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && done()}
        onBlur={() => {
          if (name.trim()) onCreate(name);
          done();
        }}
      />
      <span className="foldermeta">Press return</span>
    </form>
  );
}

function FolderHeader({ folder, done, onRename, onDelete, onAdd }: { folder: Folder; done: number; onRename: (n: string) => void; onDelete: () => void; onAdd: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(folder.name);
  const total = folder.tricks.length;
  const save = () => {
    onRename(name);
    if (!name.trim()) setName(folder.name);
    setEditing(false);
  };
  return (
    <header className="head folderhead">
      <div className="headmain">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              className="titleinput"
              autoFocus
              value={name}
              maxLength={40}
              aria-label="Folder name"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setName(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setName(folder.name);
                  setEditing(false);
                }
              }}
            />
          </form>
        ) : (
          <h1>
            <button className="titlebtn" onClick={() => setEditing(true)} title="Click to rename" aria-label={`${folder.name}. Click to rename`}>
              {folder.name}
            </button>
          </h1>
        )}
        <p className="headsub">{total ? `${done} of ${total} learnt` : 'No moves yet'}</p>
      </div>
      <div className="headbtns">
      <button className="btn solid small" onClick={onAdd}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
        Add moves
      </button>
      <button className="btn ghost" onClick={() => setConfirming(true)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.8 4.3h10.4M6.3 4.3V2.9h3.4v1.4M4.2 4.3l.6 8.4c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.4M6.7 7v4M9.3 7v4" />
        </svg>
        Delete folder
      </button>
      </div>
      {total > 0 && (
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Learnt in this folder">
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {confirming && (
        <Dialog
          title={`Delete “${folder.name}”?`}
          body={
            total
              ? `The ${total === 1 ? 'move' : `${total} moves`} inside will stay in your library. Only the folder goes.`
              : 'The folder is empty, so nothing else changes.'
          }
          confirm="Delete folder"
          cancel="Keep folder"
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </header>
  );
}

function Dialog({ title, body, confirm, cancel, onConfirm, onCancel, safe }: { title: string; body: string; confirm: string; cancel: string; onConfirm: () => void; onCancel: () => void; safe?: boolean }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      // Keep Tab moving between the two buttons instead of escaping behind the dialog.
      if (e.key === 'Tab') {
        const btns = [...document.querySelectorAll<HTMLElement>('.dialog button')];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length]?.focus();
      }
    };
    const back = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
      back?.focus?.();
    };
  }, [onCancel]);
  // Rendered on the body so it always covers the whole window, whatever it was opened from.
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
        <FolderArt />
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-body">{body}</p>
        <div className="dialogactions">
          <button ref={keep} className="btn" onClick={onCancel}>{cancel}</button>
          <button className={`btn ${safe ? 'solid' : 'danger'}`} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EmptyArt({ kind }: { kind: 'folder' | 'learnt' }) {
  return (
    <svg className="emptyart" data-kind={kind} viewBox="0 0 200 150" aria-hidden="true">
      <ellipse className="eshadow" cx="100" cy="136" rx="62" ry="6" />
      <path className="fback" d="M38 62a9 9 0 0 1 9-9h30a9 9 0 0 1 6.4 2.6l5.6 5.6a9 9 0 0 0 6.4 2.6H153a9 9 0 0 1 9 9v51a9 9 0 0 1-9 9H47a9 9 0 0 1-9-9V62z" />
      <g className="ecards">
        <rect className="ecard c1" x="62" y="26" width="34" height="48" rx="5" transform="rotate(-16 79 50)" />
        <rect className="ecard c2" x="83" y="18" width="34" height="48" rx="5" />
        <rect className="ecard c3" x="104" y="26" width="34" height="48" rx="5" transform="rotate(16 121 50)" />
      </g>
      <path className="ffront" d="M30 82a8 8 0 0 1 8-8h124a8 8 0 0 1 7.9 9.3l-7 42a8 8 0 0 1-7.9 6.7H45a8 8 0 0 1-7.9-6.7l-7-42A8 8 0 0 1 30 82z" />
      {kind === 'learnt' && <path className="fplus" d="M86 103l10 10 20-22" />}
    </svg>
  );
}

type ItemProps = { move: Move; learnt: boolean; selected: boolean; dragIds: string[]; onSelect: (e: React.MouseEvent) => void; onLearnt: () => void };

const Tick = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

// Every tutorial for the trick, each its own link.
function Tutorials({ move }: { move: Move }) {
  // When one teacher has several videos for the same trick, number them so they can be told apart.
  const total: Record<string, number> = {};
  for (const l of move.links) total[linkLabel(l)] = (total[linkLabel(l)] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return (
    <div className="links">
      {move.links.map((l) => {
        const label = linkLabel(l);
        seen[label] = (seen[label] ?? 0) + 1;
        return (
          <a key={l.url} className="link" data-kind={l.kind} href={l.url} target="_blank" rel="noreferrer" title={l.title ?? undefined} draggable={false}>
            {label}
            {total[label] > 1 && <span className="linknum">{seen[label]}</span>}
            <span className="linkout" aria-hidden="true">↗</span>
          </a>
        );
      })}
    </div>
  );
}

function SelectDot({ move, selected, onSelect, className = '' }: { move: Move; selected: boolean; onSelect: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <button className={`check ${className}`} onClick={onSelect} aria-pressed={selected} aria-label={`${selected ? 'Deselect' : 'Select'} ${move.name}`} title="Select">
      <Tick />
    </button>
  );
}

function LearntButton({ move, learnt, onLearnt }: { move: Move; learnt: boolean; onLearnt: () => void }) {
  return (
    <button className="learntbtn" aria-pressed={learnt} onClick={onLearnt} aria-label={learnt ? `${move.name} is learnt. Undo` : `Mark ${move.name} as learnt`}>
      <Tick />
      {learnt ? 'Learnt' : 'Mark as learnt'}
    </button>
  );
}

const startDrag = (e: React.DragEvent, move: Move, ids: string[]) => {
  e.dataTransfer.setData(DRAG, ids.join(','));
  e.dataTransfer.setData('text/plain', ids.length > 1 ? `${ids.length} moves` : move.name);
  e.dataTransfer.effectAllowed = 'copy';
};

// Top-right of each card: add this one move to a folder (or take it out) without selecting it first.
type FoldersApi = { folders: Folder[]; toggle: (folderId: string, moveId: string) => void; create: (name: string, moveId: string) => void };
const FoldersCtx = createContext<FoldersApi | null>(null);

function FolderButton({ move }: { move: Move }) {
  const api = useContext(FoldersCtx);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [name, setName] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const away = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && close();
    document.addEventListener('keydown', esc);
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', close);
    };
  }, [pos]);
  if (!api) return null;
  const inAny = api.folders.some((f) => f.tricks.includes(move.id));
  const open = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setName('');
    const w = Math.min(240, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, right: Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - 8 - w)) });
  };
  return (
    <>
      <button ref={btn} className="foldbtn" data-on={inAny || undefined} aria-expanded={!!pos} aria-haspopup="menu" onClick={open} aria-label={`Add ${move.name} to a folder`} title="Add to folder">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2.5 6.5a2 2 0 0 1 2-2h3.2l1.6 1.8h6.2a2 2 0 0 1 2 2v6.7a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
          {inAny ? <path className="foldmark" d="M7.4 11.2l1.9 1.9 3.4-3.6" /> : <path d="M10 8.6v5M7.5 11.1h5" />}
        </svg>
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className="picker cardmenu" role="menu" style={{ top: pos.top, right: pos.right }}>
            {api.folders.length > 0 && <p className="pickhead">Add to</p>}
            {api.folders.map((f) => {
              const has = f.tricks.includes(move.id);
              return (
                <button key={f.id} className="pickitem" role="menuitemcheckbox" aria-checked={has} onClick={() => api.toggle(f.id, move.id)}>
                  <span className="box"><Tick /></span>
                  <span className="pickname">{f.name}</span>
                  <span className="pickcount">{f.tricks.length}</span>
                </button>
              );
            })}
            <form
              className="picknew"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                api.create(name, move.id);
                setPos(null);
              }}
            >
              <input autoFocus={api.folders.length === 0} value={name} maxLength={40} placeholder="New folder name" aria-label="New folder name" onChange={(e) => setName(e.target.value)} />
              <button type="submit" disabled={!name.trim()}>Create</button>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

function Card({ move, learnt, selected, dragIds, onSelect, onLearnt }: ItemProps) {
  const main = primary(move);
  const thumb = thumbOf(move);
  return (
    <li className="card" data-id={move.id} data-learnt={learnt || undefined} data-selected={selected || undefined} draggable onDragStart={(e) => startDrag(e, move, dragIds)}>
      <div className="thumbwrap">
        <a className="thumb" href={main.url} target="_blank" rel="noreferrer" aria-label={`Open the ${main.teacher} tutorial for ${move.name}`} draggable={false}>
          {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : <span className="nothumb"><Mark /></span>}
          <span className="play" aria-hidden="true">{main.kind === 'buy' ? 'Buy' : '▶'}</span>
        </a>
        <SelectDot move={move} selected={selected} onSelect={onSelect} className="oncard" />
        <FolderButton move={move} />
        {learnt && (
          <span className="tag">
            <Tick />
            Learnt
          </span>
        )}
      </div>
      <span className="name">
        {move.starter && <span className="num">{move.starter}</span>}
        {move.name}
      </span>
      <span className="sub">
        {move.categories.join(', ')} · {levelOf(move)}
      </span>
      <Tutorials move={move} />
      <LearntButton move={move} learnt={learnt} onLearnt={onLearnt} />
    </li>
  );
}

function Row({ move, learnt, selected, dragIds, onSelect, onLearnt }: ItemProps) {
  const sub = [move.categories.join(', '), levelOf(move), move.creator && move.creator !== 'Classic Move' ? move.creator : null, move.description].filter(Boolean).join(' · ');
  return (
    <li className="row" data-id={move.id} data-learnt={learnt || undefined} data-selected={selected || undefined} draggable onDragStart={(e) => startDrag(e, move, dragIds)}>
      <SelectDot move={move} selected={selected} onSelect={onSelect} />
      <div className="what">
        <span className="name">
          {move.starter && <span className="num">{move.starter}</span>}
          {move.name}
          {learnt && (
            <span className="tag inline">
              <Tick />
              Learnt
            </span>
          )}
        </span>
        <span className="sub">{sub}</span>
      </div>
      <div className="side-actions">
        <LearntButton move={move} learnt={learnt} onLearnt={onLearnt} />
      </div>
      <Tutorials move={move} />
    </li>
  );
}

type BulkProps = {
  n: number;
  folders: Folder[];
  inFolder: boolean;
  allLearnt: boolean;
  onAdd: (folderId: string) => void;
  onCreate: (name: string) => void;
  onLearnt: (on: boolean) => void;
  onRemove: () => void;
  onClear: () => void;
};

// Appears once something is selected. Everything here acts on the whole selection.
function BulkBar({ n, folders, inFolder, allLearnt, onAdd, onCreate, onLearnt, onRemove, onClear }: BulkProps) {
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(false);
      else onClear();
    };
    const away = (e: MouseEvent) => menu && wrap.current && !wrap.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('keydown', esc);
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', away);
    };
  }, [menu, onClear]);
  return createPortal(
    <>
    <div className="bulkfade" aria-hidden="true" />
    <div className="bulk" role="toolbar" aria-label="Actions for selected moves">
      <span className="bulkcount">
        <strong>{n}</strong><span className="bulkword"> selected</span>
      </span>
      <div className="pickwrap" ref={wrap}>
        <button className="btn solid small" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          Add to folder
        </button>
        {menu && (
          <div className="picker up" role="menu">
            {folders.length > 0 && <p className="pickhead">Add {n === 1 ? 'it' : `all ${n}`} to</p>}
            {folders.map((f) => (
              <button key={f.id} className="pickitem" role="menuitem" onClick={() => onAdd(f.id)}>
                <FolderArt />
                <span className="pickname">{f.name}</span>
                <span className="pickcount">{f.tricks.length}</span>
              </button>
            ))}
            <form
              className="picknew"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) onCreate(name);
              }}
            >
              <input autoFocus={folders.length === 0} value={name} maxLength={40} placeholder="New folder name" aria-label="New folder name" onChange={(e) => setName(e.target.value)} />
              <button type="submit" disabled={!name.trim()}>Create</button>
            </form>
          </div>
        )}
      </div>
      <button className="btn small" onClick={() => onLearnt(!allLearnt)}>{allLearnt ? 'Mark as not learnt' : 'Mark as learnt'}</button>
      {inFolder && <button className="btn small" onClick={onRemove}>Remove from folder</button>}
      <button className="bulkclose" onClick={onClear} aria-label="Clear selection" title="Clear selection">✕</button>
    </div>
    </>,
    document.body,
  );
}

// "Add moves" from inside a folder: a searchable list where you tick as many as you like, then add them in one go.
// Same pattern as Linear's "Add issues" and Notion's relation picker.
function AddMoves({ folder, learnt, onClose, onAdd }: { folder: Folder; learnt: Record<string, string>; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inFolder = new Set(folder.tricks);
  const q = query.trim();
  const shown = MOVES.filter(
    (m) =>
      (!q || matchMove(m, q)) &&
      (!type || inType(m, type)),
  ).slice(0, 200);
  const toggle = (id: string) => {
    if (inFolder.has(id)) return;
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  useEffect(() => setActive(0), [query, type]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (picked.length) onAdd(picked);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) toggle(shown[active].id);
    }
  };
  const types = [...CATEGORIES, ICONIC].filter((c) => MOVES.some((m) => inType(m, c)));
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="addmoves" role="dialog" aria-modal="true" aria-label={`Add moves to ${folder.name}`} onKeyDown={onKey}>
        <div className="addhead">
          <h2>
            Add moves to <span>{folder.name}</span>
          </h2>
          <button className="bulkclose" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="searchwrap">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input className="search" autoFocus value={query} placeholder="Search moves, creators or sources" aria-label="Search moves" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="addtypes" role="group" aria-label="Type">
          <button className="applied" aria-pressed={!type} onClick={() => setType(null)}>
            All
          </button>
          {types.map((t) => (
            <button key={t} className="applied" aria-pressed={type === t} onClick={() => setType(type === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="addlist" ref={listRef} role="listbox" aria-multiselectable="true" aria-label="Moves">
          {shown.map((m, i) => {
            const have = inFolder.has(m.id);
            const on = have || picked.includes(m.id);
            const thumb = thumbOf(m);
            return (
              <button
                key={m.id}
                data-i={i}
                className="additem"
                role="option"
                aria-selected={on}
                aria-disabled={have || undefined}
                data-active={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => toggle(m.id)}
              >
                <span className="box" aria-hidden="true">
                  <Tick />
                </span>
                {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="addnothumb" />}
                <span className="addtext">
                  <span className="addname">{m.name}</span>
                  <span className="addsub">
                    {m.category} · {levelOf(m)}
                    {learnt[m.id] ? ' · Learnt' : ''}
                  </span>
                </span>
                {have && <span className="addhave">In folder</span>}
              </button>
            );
          })}
          {!shown.length && <p className="menuempty">No moves match “{query}”</p>}
        </div>
        <div className="addfoot">
          <span className="addhint">
            {picked.length ? (
              <button className="clearall" onClick={() => setPicked([])}>
                Clear {picked.length} selected
              </button>
            ) : (
              'Tick as many as you like'
            )}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" disabled={!picked.length} onClick={() => onAdd(picked)}>
            {picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'move' : 'moves'}` : 'Add moves'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Appears once you've scrolled down a screen or so; sits above the selection bar when that's showing.
// Search looks at everything a move has: name, creator, sources, video titles, families, level, description.
// Spaces and punctuation are ignored ("deckflip" finds Deck Flip), every word must match, and a few
// everyday words map onto the site's own terms ("beginner" finds Starter and Easy moves).
const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const ALIASES: Record<string, string[]> = {
  beginner: ['starter', 'easy'], beginners: ['starter', 'easy'], simple: ['starter', 'easy'],
  medium: ['intermediate'], hard: ['advanced'], difficult: ['advanced'], expert: ['advanced'],
  famous: ['iconic'], classic: ['iconic'],
  aerial: ['aerials'], drop: ['drops'], fan: ['fans'], spread: ['spreads'], cut: ['cuts'],
  onehanded: ['onehandedcuts'], twohanded: ['twohandedcuts'], iso: ['isolations'], isolation: ['isolations'],
  shuffle: ['shuffles'], weave: ['weaves'], display: ['displays'], structure: ['structures'], twirl: ['twirls'],
  spin: ['twirls', 'spin'], combo: ['combos'], basic: ['basics'],
};
const HAY = new Map<string, string>();
function hay(m: Move) {
  let h = HAY.get(m.id);
  if (!h) {
    h = [m.name, m.creator, m.description, ...m.categories, levelOf(m), m.iconic ? 'iconic' : '', ...m.links.flatMap((l) => [l.teacher, l.title])]
      .filter(Boolean)
      .map((t) => squash(t as string))
      .join('|');
    HAY.set(m.id, h);
  }
  return h;
}
function matchMove(m: Move, query: string) {
  const h = hay(m);
  const whole = squash(query);
  if (h.includes(whole)) return true;
  const words = query.toLowerCase().split(/\s+/).map(squash).filter(Boolean);
  return words.length > 0 && words.every((w) => h.includes(w) || (ALIASES[w] ?? []).some((a) => h.includes(a)));
}

function BackToTop({ raised }: { raised: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 800);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  return createPortal(
    <button
      className="totop"
      data-raised={raised || undefined}
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
      aria-label="Back to top"
      title="Back to top"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
      </svg>
    </button>,
    document.body,
  );
}

function Applied({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button className="applied" onClick={onRemove} aria-label={`Remove filter: ${label}`}>
      {label}
      <span aria-hidden="true">✕</span>
    </button>
  );
}

type FilterMenuProps = {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  single?: boolean; // pick exactly one, like a radio group
  fallback?: string; // the "nothing chosen" value of a single menu
  searchable?: boolean;
  alignRight?: boolean;
};

function FilterMenu({ label, options, value, onChange, single, fallback, searchable, alignRight }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Keyboard: focus lands on the chosen (or first) option when the menu opens, and returns to the button when it closes.
  // Keep the open menu on screen: nudge it sideways if it would run past either edge.
  useLayoutEffect(() => {
    const m = wrap.current?.querySelector<HTMLElement>('.picker.menu');
    if (!open || !m) return;
    m.style.translate = '';
    // Measure from layout, not the box on screen, which is still scaled by the opening animation.
    const left = wrap.current!.getBoundingClientRect().left + m.offsetLeft;
    const over = left + m.offsetWidth - (document.documentElement.clientWidth - 8);
    const under = 8 - left;
    if (over > 0) m.style.translate = `${-over}px 0`;
    else if (under > 0) m.style.translate = `${under}px 0`;
  }, [open]);
  useEffect(() => {
    if (open) {
      const first = wrap.current?.querySelector<HTMLElement>('.menufind, .pickitem[aria-checked="true"], .pickitem');
      first?.focus();
    } else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('.pickitem') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1;
    items[next].focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setFind('');
  }, [open]);

  const active = single ? value[0] !== fallback : value.length > 0;
  const chosen = single ? options.find((o) => o.value === value[0])?.label : null;
  const shown = find.trim() ? options.filter((o) => o.label.toLowerCase().includes(find.trim().toLowerCase())) : options;
  const pick = (v: string) => {
    if (single) {
      onChange([v]);
      setOpen(false);
    } else onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <div className="pickwrap" ref={wrap}>
      <button ref={trigger} className="fpill" data-active={active || undefined} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {single && (active || label === 'Sort') ? (
          <>
            <span className="fpilllabel">{label}:</span> {chosen}
          </>
        ) : (
          label
        )}
        {!single && value.length > 0 && <span className="fbadge">{value.length}</span>}
        <svg className="caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className={`picker menu${alignRight ? '' : ' left'}`} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {searchable && (
            <input className="menufind" autoFocus value={find} placeholder={`Find a ${label.toLowerCase()}`} aria-label={`Find a ${label.toLowerCase()}`} onChange={(e) => setFind(e.target.value)} />
          )}
          <div className="menulist">
            {shown.map((o) => {
              const on = value.includes(o.value);
              return (
                <button key={o.value} className="pickitem" role={single ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={on} data-empty={o.count === 0 || undefined} onClick={() => pick(o.value)}>
                  <span className={single ? 'radio' : 'box'} aria-hidden="true">
                    {!single && <Tick />}
                  </span>
                  <span className="pickname">{o.label}</span>
                  {o.count !== undefined && <span className="pickcount">{o.count}</span>}
                </button>
              );
            })}
            {shown.length === 0 && <p className="menuempty">Nothing matches “{find}”</p>}
          </div>
          {!single && value.length > 0 && (
            <button className="menuclear" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="10" height="14" rx="2" transform="rotate(-14 9 12)" />
      <rect x="10" y="5" width="10" height="14" rx="2" transform="rotate(12 15 12)" />
    </svg>
  );
}

/* ---------------- Profiles (local, like Pile) ---------------- */

type Profile = { id: string; name: string; color: string; pin?: string; salt?: string };
const PROFILES = 'cardistry.profiles';
const GUEST: Profile = { id: 'guest', name: 'Guest', color: '#8a8780' };
const NUDGED = 'cardistry.guestNudged';
const CURRENT = 'cardistry.current';
const COLORS = ['#4aa3ee', '#e8a838', '#6cc08a', '#d9739e', '#9b86e8', '#e8715c'];

const loadProfiles = (): Profile[] => {
  try {
    const p = JSON.parse(store.getItem(PROFILES) ?? '[]');
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};
const saveProfiles = (p: Profile[]) => {
  try {
    store.setItem(PROFILES, JSON.stringify(p));
  } catch {}
};
const remember = (id: string | null) => {
  try {
    if (id) store.setItem(CURRENT, id);
    else store.removeItem(CURRENT);
  } catch {}
};

// The PIN is stored only as a salted hash. It keeps people sharing a computer out of each other's
// progress; it is not real security, since everything lives in this browser.
const hashPin = async (pin: string, salt: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);
  const [current, setCurrent] = useState<string | null>(() => {
    try {
      const id = store.getItem(CURRENT);
      return id && loadProfiles().some((p) => p.id === id) ? id : null;
    } catch {
      return null;
    }
  });
  const profile = profiles.find((p) => p.id === current) ?? null;
  // No profiles yet: people browse (and save) straight away as a guest, and only see the profile screen if they ask.
  const [welcome, setWelcome] = useState(false);

  const enter = (id: string) => {
    remember(id);
    setCurrent(id);
  };
  const create = async (name: string, pin: string) => {
    const id = crypto.randomUUID();
    const p: Profile = { id, name: name.trim(), color: COLORS[profiles.length % COLORS.length] };
    if (pin) {
      p.salt = crypto.randomUUID();
      p.pin = await hashPin(pin, p.salt);
    }
    // The first profile inherits whatever was saved as a guest, or before profiles existed.
    if (!profiles.length) {
      try {
        const old = store.getItem(storeKey(GUEST.id)) ?? store.getItem(LEGACY);
        if (old) {
          store.setItem(storeKey(id), old);
          store.removeItem(storeKey(GUEST.id));
          store.removeItem(LEGACY);
        }
      } catch {}
    }
    const next = [...profiles, p];
    saveProfiles(next);
    setProfiles(next);
    enter(id);
  };
  const remove = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    saveProfiles(next);
    setProfiles(next);
    try {
      store.removeItem(storeKey(id));
    } catch {}
  };

  if (profile)
    return (
      <Library
        key={profile.id}
        profile={profile}
        onSwitch={() => {
          remember(null);
          setCurrent(null);
        }}
      />
    );
  if (!profiles.length && !welcome) return <Library key="guest" profile={GUEST} guest onSwitch={() => setWelcome(true)} />;
  return <Welcome profiles={profiles} onEnter={enter} onCreate={create} onRemove={remove} onBrowse={profiles.length ? undefined : () => setWelcome(false)} />;
}

function Avatar({ profile, size = 40 }: { profile: Pick<Profile, 'name' | 'color'>; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: profile.color }} aria-hidden="true">
      {profile.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function Welcome({
  profiles,
  onEnter,
  onCreate,
  onRemove,
  onBrowse,
}: {
  profiles: Profile[];
  onEnter: (id: string) => void;
  onCreate: (name: string, pin: string) => Promise<void>;
  onRemove: (id: string) => void;
  onBrowse?: () => void;
}) {
  const [mode, setMode] = useState<'pick' | 'new' | { pin: Profile }>(profiles.length ? 'pick' : 'new');
  const [removing, setRemoving] = useState<Profile | null>(null);
  return (
    <div className="welcome">
      <div className="welcomecard">
        <div className="appicon">
          <Mark />
        </div>
        <h1>Cardistry</h1>
        {mode === 'pick' && (
          <>
            <p className="welcomesub">Who's practising?</p>
            <div className="profilelist">
              {profiles.map((p) => (
                <div key={p.id} className="profilerow">
                  <button className="profilebtn" onClick={() => (p.pin ? setMode({ pin: p }) : onEnter(p.id))}>
                    <Avatar profile={p} />
                    <span className="profilename">{p.name}</span>
                    {p.pin && (
                      <svg className="lock" viewBox="0 0 16 16" aria-label="Has a PIN">
                        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                      </svg>
                    )}
                  </button>
                  <button className="profileremove" onClick={() => setRemoving(p)} aria-label={`Remove ${p.name}`} title="Remove profile">
                    ✕
                  </button>
                </div>
              ))}
              <button className="profilebtn add" onClick={() => setMode('new')}>
                <span className="avatar ghost" aria-hidden="true">+</span>
                <span className="profilename">New profile</span>
              </button>
            </div>
          </>
        )}
        {mode === 'new' && <NewProfile first={!profiles.length} onCancel={profiles.length ? () => setMode('pick') : onBrowse} onCreate={onCreate} />}
        {typeof mode === 'object' && <PinEntry profile={mode.pin} onBack={() => setMode('pick')} onOk={() => onEnter(mode.pin.id)} />}
        <p className="welcomefoot">Profiles and progress are saved in this browser only.</p>
      </div>
      {removing && (
        <Dialog
          title={`Remove ${removing.name}?`}
          body="Their folders and learnt moves will be deleted from this browser. This can't be undone."
          confirm="Remove profile"
          cancel="Keep"
          onConfirm={() => {
            onRemove(removing.id);
            setRemoving(null);
            if (profiles.length <= 1) setMode('new');
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function NewProfile({ first, onCancel, onCreate }: { first: boolean; onCancel?: () => void; onCreate: (name: string, pin: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [usePin, setUsePin] = useState(false);
  const [pin, setPin] = useState('');
  const ok = name.trim() && (!usePin || /^\d{4}$/.test(pin));
  return (
    <form
      className="newprofile"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onCreate(name, usePin ? pin : '');
      }}
    >
      <p className="welcomesub">{first ? 'Make a profile to keep your folders and learnt moves.' : 'Add someone new.'}</p>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} maxLength={24} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={usePin} onChange={(e) => setUsePin(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
        Lock with a 4-digit PIN
      </label>
      {usePin && (
        <label className="field">
          <span>PIN</span>
          <input
            className="pininput"
            value={pin}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="••••"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </label>
      )}
      <div className="welcomeactions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Back
          </button>
        )}
        <button type="submit" className="btn solid" disabled={!ok}>
          {first ? 'Start' : 'Create profile'}
        </button>
      </div>
    </form>
  );
}

function PinEntry({ profile, onBack, onOk }: { profile: Profile; onBack: () => void; onOk: () => void }) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  useEffect(() => {
    if (pin.length < 4) return;
    let live = true;
    hashPin(pin, profile.salt ?? '').then((h) => {
      if (!live) return;
      if (h === profile.pin) onOk();
      else {
        setWrong(true);
        setPin('');
      }
    });
    return () => {
      live = false;
    };
  }, [pin, profile, onOk]);
  return (
    <div className="pinentry">
      <Avatar profile={profile} size={56} />
      <p className="welcomesub">Enter {profile.name}'s PIN</p>
      <input
        className="pininput big"
        autoFocus
        value={pin}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        aria-label="PIN"
        aria-invalid={wrong || undefined}
        data-wrong={wrong || undefined}
        placeholder="••••"
        onChange={(e) => {
          setWrong(false);
          setPin(e.target.value.replace(/\D/g, ''));
        }}
      />
      <p className="pinmsg" role="status">{wrong ? 'That PIN is not right. Try again.' : ' '}</p>
      <button className="btn" onClick={onBack}>
        Back
      </button>
    </div>
  );
}

function ProfileMenu({ profile, onSwitch }: { profile: Profile; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="pickwrap" ref={wrap}>
      <button className="profilechip" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} aria-label={`Signed in as ${profile.name}`}>
        <Avatar profile={profile} size={28} />
      </button>
      {open && (
        <div className="picker profilemenu" role="menu">
          <div className="profilemenuhead">
            <Avatar profile={profile} size={32} />
            <span>{profile.name}</span>
          </div>
          <button className="pickitem" role="menuitem" onClick={onSwitch}>
            Switch profile
          </button>
        </div>
      )}
    </div>
  );
}
