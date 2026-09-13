// Ebook reader for docs/textbook — networkstate-style: landing page with cover +
// nested part/chapter TOC; chapter pages with a collapsible TOC overlay panel.
// Content is pre-rendered by scripts/build_textbook.mjs.
const tocEl = document.getElementById('toc');
const landingTocEl = document.getElementById('landing-toc');
const landingEl = document.getElementById('landing');
const readerEl = document.getElementById('reader');
const contentEl = document.getElementById('content');
const prevEl = document.getElementById('prev');
const nextEl = document.getElementById('next');
const panel = document.getElementById('toc-panel');
const scrim = document.getElementById('scrim');

const { parts, chapters } = await (await fetch('../data/textbook.json')).json();

function tocHTML(linkPrefix) {
  return parts.map((p, i) => `
    <div class="part">
      <div class="part-name">${i + 1}. ${p.name}</div>
      ${p.chapters.map(s => {
        const ch = chapters.find(c => c.slug === s);
        return `<a href="${linkPrefix}${s}" data-slug="${s}">${ch.title}</a>`;
      }).join('')}
    </div>`).join('');
}
landingTocEl.innerHTML = tocHTML('#');
tocEl.innerHTML = tocHTML('#');

const openPanel = (on) => { panel.classList.toggle('open', on); scrim.classList.toggle('on', on); };
document.getElementById('toc-btn').onclick = () => openPanel(!panel.classList.contains('open'));
scrim.onclick = () => openPanel(false);
addEventListener('keydown', e => { if (e.key === 'Escape') openPanel(false); });

function route() {
  const slug = location.hash.slice(1);
  const ch = chapters.find(c => c.slug === slug);
  if (!ch) {                          // landing page
    landingEl.hidden = false; readerEl.hidden = true;
    document.title = 'Compiling the Fly Brain';
    openPanel(false); return;
  }
  landingEl.hidden = true; readerEl.hidden = false;
  const idx = chapters.indexOf(ch);
  document.getElementById('part-label').textContent = ch.part;
  document.getElementById('chap-label').textContent =
    ch.slug.startsWith('A-') ? 'Appendix' : `Chapter ${idx + 1}`;
  document.getElementById('chap-title').textContent = ch.title;
  // strip the chapter's own h1 — the header renders it
  contentEl.innerHTML = ch.html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, '');
  tocEl.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.slug === ch.slug));

  const prev = chapters[idx - 1], next = chapters[idx + 1];
  prevEl.style.visibility = prev ? 'visible' : 'hidden';
  nextEl.style.visibility = next ? 'visible' : 'hidden';
  if (prev) { prevEl.href = `#${prev.slug}`; prevEl.innerHTML = `← Previous<br/><b>${prev.title}</b>`; }
  if (next) { nextEl.href = `#${next.slug}`; nextEl.innerHTML = `Next Section:<br/><b>${next.title}</b>`; }
  document.title = `${ch.title} — Compiling the Fly Brain`;
  openPanel(false);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
