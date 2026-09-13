// Ebook reader for docs/textbook — sidebar TOC + single-chapter reading pane,
// hash-routed (#01-introduction). Content is pre-rendered by scripts/build_textbook.mjs.
const tocEl = document.getElementById('toc');
const contentEl = document.getElementById('content');
const prevEl = document.getElementById('prev');
const nextEl = document.getElementById('next');
const sidebar = document.getElementById('sidebar');

document.getElementById('toc-toggle').onclick = () => sidebar.classList.toggle('open');

const { chapters } = await (await fetch('../data/textbook.json')).json();

// drop the title/TOC pseudo-chapter from the reading list but keep it as the landing view
const reading = chapters.filter(c => c.slug !== '00-title');

tocEl.innerHTML = reading.map((c, i) => {
  const label = c.slug.startsWith('A-') ? 'A' : String(i + 1).padStart(2, '0');
  return `<a href="#${c.slug}" data-slug="${c.slug}"><span class="num">${label}</span>${c.title}</a>`;
}).join('');

function route() {
  const slug = location.hash.slice(1) || reading[0].slug;
  const idx = Math.max(0, reading.findIndex(c => c.slug === slug));
  const ch = reading[idx];
  const label = ch.slug.startsWith('A-') ? 'Appendix' : `Chapter ${idx + 1}`;
  contentEl.innerHTML = `<div class="chapnum">${label}</div>` + ch.html;
  tocEl.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.slug === ch.slug));
  prevEl.textContent = idx > 0 ? `← ${reading[idx - 1].title}` : '';
  prevEl.href = idx > 0 ? `#${reading[idx - 1].slug}` : '#';
  prevEl.style.visibility = idx > 0 ? 'visible' : 'hidden';
  nextEl.textContent = idx < reading.length - 1 ? `${reading[idx + 1].title} →` : '';
  nextEl.href = idx < reading.length - 1 ? `#${reading[idx + 1].slug}` : '#';
  nextEl.style.visibility = idx < reading.length - 1 ? 'visible' : 'hidden';
  document.title = `${ch.title} — Compiling the Fly Brain`;
  window.scrollTo(0, 0);
  sidebar.classList.remove('open');
}
addEventListener('hashchange', route);
route();
