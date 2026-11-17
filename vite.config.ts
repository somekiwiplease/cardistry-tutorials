import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import data from './src/data/moves.json';
import guides from './src/data/guides.json';

// Set SITE_URL when deploying (e.g. https://cardistry.vercel.app) to get canonical + sitemap.
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Search engines see a plain list of every move and its tutorials before the app loads.
// React replaces it on start, so people never see it.
function seo(): Plugin {
  type M = { name: string; category?: string; description?: string | null; links: { url: string; teacher?: string }[] };
  const moves = (data as { moves: M[] }).moves;
  const list = moves
    .map((m) => {
      const links = m.links.map((l) => `<a href="${esc(l.url)}">${esc(l.teacher || 'Tutorial')}</a>`).join(', ');
      return `<li><h3>${esc(m.name)} tutorial</h3>${m.category ? `<p>${esc(m.category)}${m.description ? ' · ' + esc(m.description) : ''}</p>` : ''}<p>${links}</p></li>`;
    })
    .join('');
  const faq = (guides as { faq: { sections: { items: { q: string; a: string }[] }[] } }).faq.sections.flatMap((x) => x.items);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Cardistry Tutorials', ...(SITE && { url: SITE + '/' }), description: 'Every cardistry move in one place, one click from its tutorial.' },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
      {
        '@type': 'ItemList',
        name: 'Cardistry moves',
        numberOfItems: moves.length,
        itemListElement: moves.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.name, url: m.links[0]?.url })),
      },
    ],
  };
  return {
    name: 'seo',
    transformIndexHtml(html) {
      const head = [
        SITE && `<link rel="canonical" href="${SITE}/" />`,
        SITE && `<meta property="og:url" content="${SITE}/" />`,
        `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
      ].filter(Boolean).join('\n    ');
      const body = `<main><h1>Cardistry Tutorials</h1><p>${moves.length} cardistry moves, from beginner cuts and fans to advanced aerials and isolations, each linked to its tutorial.</p><ul>${list}</ul><h2>Cardistry FAQ</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</main>`;
      return html.replace('</head>', `    ${head}\n  </head>`).replace('<div id="root"></div>', `<div id="root">${body}</div>`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n${SITE ? `Sitemap: ${SITE}/sitemap.xml\n` : ''}` });
      if (SITE)
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url></urlset>\n` });
    },
  };
}

export default defineConfig({ plugins: [react(), seo()] });
