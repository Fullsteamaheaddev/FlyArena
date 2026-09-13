// Ebook reader for docs/textbook — networkstate-style: two-column landing
// (cover + actions | description + part/chapter card lists), chapter pages
// with centered crumbs, per-part progress segments, and a TOC overlay card.
// Content is pre-rendered by scripts/build_textbook.mjs.
const $ = id => document.getElementById(id);
const tocEl = $('toc'), landingTocEl = $('landing-toc');
const landingEl = $('landing'), readerEl = $('reader');
const contentEl = $('content'), progressEl = $('progress');
const card = $('toc-card'), scrim = $('scrim');

// Resolve all assets against the vite base so the page works both at
// /textbook/ and /fly-brain/textbook (no trailing slash) on any host.
const B = import.meta.env.BASE_URL;
document.querySelectorAll('[data-base]').forEach(el => {
  const v = B + el.dataset.base;
  if (el.tagName === 'IMG') el.src = v; else el.href = v;
});

const res = await fetch(B + 'data/textbook.json');
if (!res.ok) throw new Error(`textbook.json: ${res.status}`);
const { parts, chapters } = await res.json();

// TOC card: serif part headings, plain rows, active row highlighted
tocEl.innerHTML = parts.map((p, i) => `
  <div class="toc-part">${i + 1}. ${p.name}</div>
  ${p.chapters.map(s => {
    const ch = chapters.find(c => c.slug === s);
    return `<a class="toc-row" href="#${s}" data-slug="${s}">${ch.title}</a>`;
  }).join('')}`).join('');

// Landing TOC: serif part heading + rounded card of chapter rows with arrows
landingTocEl.innerHTML = parts.map((p, i) => `
  <h3 class="part-head">${i + 1}. ${p.name} <a class="part-arrow" href="#${p.chapters[0]}">&#8599;</a></h3>
  <div class="chap-card">
    ${p.chapters.map(s => {
      const ch = chapters.find(c => c.slug === s);
      return `<a class="chap-row" href="#${s}"><span class="row-arrow">&#8599;</span>${ch.title}</a>`;
    }).join('')}
  </div>`).join('');

const openCard = on => { card.classList.toggle('open', on); scrim.classList.toggle('on', on); };
$('menu-btn').onclick = () => openCard(!card.classList.contains('open'));
scrim.onclick = () => openCard(false);
addEventListener('keydown', e => { if (e.key === 'Escape') openCard(false); });

function route() {
  const slug = location.hash.slice(1);
  const ch = chapters.find(c => c.slug === slug);
  if (!ch) {
    landingEl.hidden = false; readerEl.hidden = true;
    $('crumb-part').textContent = ''; $('crumb-chap').textContent = '';
    progressEl.innerHTML = '';
    document.title = 'Compiling the Fly Brain';
    openCard(false); return;
  }
  landingEl.hidden = true; readerEl.hidden = false;
  const idx = chapters.indexOf(ch);

  // centered crumbs: part (bold) over chapter title (muted)
  $('crumb-part').textContent = ch.part;
  $('crumb-chap').textContent = ch.title;

  // progress segments: one per chapter in this part
  const part = parts[ch.partIndex];
  progressEl.innerHTML = part.chapters.map(s =>
    `<a class="seg${s === ch.slug ? ' cur' : ''}" href="#${s}"></a>`).join('');

  const app = ch.slug.match(/^([A-Z])-/);
  $('chap-label').textContent = app ? `Appendix ${app[1]}` : `Chapter ${idx + 1}`;
  $('chap-title').textContent = ch.title;
  contentEl.innerHTML = ch.html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, '');
  tocEl.querySelectorAll('.toc-row').forEach(a => a.classList.toggle('active', a.dataset.slug === ch.slug));

  const prev = chapters[idx - 1], next = chapters[idx + 1];
  $('next-label').innerHTML = next ? `<b>Next Section:</b><br/>${next.title}` : '';
  const nb = $('next-btn');
  nb.style.visibility = next ? 'visible' : 'hidden';
  if (next) nb.href = `#${next.slug}`;
  const pv = $('prev');
  pv.textContent = prev ? `← ${prev.title}` : '';
  if (prev) pv.href = `#${prev.slug}`;

  document.title = `${ch.title} — Compiling the Fly Brain`;
  openCard(false);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
