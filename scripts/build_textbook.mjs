// Renders docs/textbook/*.md -> public/data/textbook.json (chapters as HTML fragments)
// so the /textbook/ ebook viewer can ship without a JS markdown dependency.
// Usage: node scripts/build_textbook.mjs   (requires pandoc)
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DIR = 'docs/textbook';
const PARTS = [
  { name: 'Foundations', slugs: ['01-introduction', '02-data-and-ir', '03-generic-structures'] },
  { name: 'The Method', slugs: ['04-operators', '05-ensemble-method'] },
  { name: 'Three Circuits', slugs: ['06-heading-lab', '07-field-model', '08-cross-validation', '09-phasor-circuit', '10-mushroom-body'] },
  { name: 'Assessment', slugs: ['11-benchmark', '12-compiler', '13-synthesis'] },
  { name: 'Appendix', slugs: ['A-reproduction'] },
];

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md')).sort();
const bySlug = {};
for (const f of files) {
  let md = fs.readFileSync(path.join(DIR, f), 'utf8');
  md = md.replace(/^---[\s\S]*?---\n/, '');          // strip YAML front matter
  md = md.replace(/\\newpage|\\tableofcontents/g, '');
  const html = execFileSync('pandoc', ['-f', 'markdown', '-t', 'html', '--wrap=none'], { input: md }).toString();
  const title = (md.match(/^#\s+(.+)$/m) || [null, f.replace(/\.md$/, '')])[1].trim();
  bySlug[f.replace(/\.md$/, '')] = { slug: f.replace(/\.md$/, ''), title, html };
}
const parts = PARTS.map(p => ({ name: p.name, chapters: p.slugs.filter(s => bySlug[s]) }));
const chapters = parts.flatMap((p, pi) => p.chapters.map(s => ({ ...bySlug[s], part: p.name, partIndex: pi })));
fs.writeFileSync('public/data/textbook.json', JSON.stringify({ parts, chapters }));
console.log(`textbook.json: ${chapters.length} chapters in ${parts.length} parts`);
