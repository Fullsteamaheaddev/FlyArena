// Renders docs/textbook/*.md -> public/data/textbook.json (chapters as HTML fragments)
// so the /textbook/ ebook viewer can ship without a JS markdown dependency.
// Usage: node scripts/build_textbook.mjs   (requires pandoc)
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DIR = 'docs/textbook';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md')).sort();
const chapters = [];
for (const f of files) {
  let md = fs.readFileSync(path.join(DIR, f), 'utf8');
  md = md.replace(/^---[\s\S]*?---\n/, '');          // strip YAML front matter
  md = md.replace(/\\newpage|\\tableofcontents/g, '');
  const html = execFileSync('pandoc', ['-f', 'markdown', '-t', 'html', '--wrap=none'], { input: md }).toString();
  const title = (md.match(/^#\s+(.+)$/m) || [null, f.replace(/\.md$/, '')])[1].trim();
  chapters.push({ slug: f.replace(/\.md$/, ''), title, html });
}
fs.writeFileSync('public/data/textbook.json', JSON.stringify({ chapters }));
console.log(`textbook.json: ${chapters.length} chapters`);
