#!/usr/bin/env node
/**
 * Export docs/social/flies-armageddon-rebrand-3x2.html → public PNG + JPG (1500×1000).
 * Usage: node scripts/export-rebrand-infographic.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'docs', 'social', 'flies-armageddon-rebrand-3x2.html');
const htmlUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
const pngOut = path.join(root, 'public', 'flies-armageddon-rebrand-infographic.png');
const jpgOut = path.join(root, 'public', 'flies-armageddon-rebrand-infographic.jpg');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  deviceScaleFactor: 1,
});
await page.goto(htmlUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: pngOut, type: 'png' });
await page.screenshot({ path: jpgOut, type: 'jpeg', quality: 92 });
await browser.close();
console.log('Wrote', pngOut);
console.log('Wrote', jpgOut);
