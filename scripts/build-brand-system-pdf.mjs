#!/usr/bin/env node
/**
 * Build docs/brand-system.pdf from docs/brand-system.html (Playwright).
 * Usage: node scripts/build-brand-system-pdf.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'docs', 'brand-system.html');
const pdfPath = path.join(root, 'docs', 'brand-system.pdf');
const htmlUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(htmlUrl, { waitUntil: 'networkidle' });
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log('Wrote', pdfPath);
