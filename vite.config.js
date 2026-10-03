import { defineConfig } from 'vite';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const localRoot = path.join(repoRoot, 'local');
// Content hash + size of each packed data file: versioned URLs (cached forever by the decode worker)
// and exact download progress even when the host gzips the response.
const DATA_FILES = Object.fromEntries(['meta.json', 'neurons.flyn', 'graph.flyg', 'skeletons.flys'].map(f => {
  const b = fs.readFileSync(`public/data/${f}`);
  return [f, { v: createHash('sha1').update(b).digest('hex').slice(0, 10), size: b.length }];
}));
// Unpacked tables stay in public/data for the node scripts and Python pipeline but are not deployed.
const NOT_DEPLOYED = ['graph_w3.bin', 'neurons.bin'];
const dropUnpacked = { name: 'drop-unpacked-data', apply: 'build', closeBundle() { for (const f of NOT_DEPLOYED) fs.rmSync(`dist/data/${f}`, { force: true }); } };
// Cross-origin isolation enables SharedArrayBuffer (one read-only connectome shared by all fly workers)
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
function rewriteWatch(req) {
  const q = req.url.indexOf('?'), path = q < 0 ? req.url : req.url.slice(0, q), qs = q < 0 ? '' : req.url.slice(q);
  if (/\/watch\/?$/.test(path)) req.url = path.replace(/\/watch\/?$/, '/index.html') + qs;
  else if (/\/brain\/?$/.test(path)) req.url = path.replace(/\/brain\/?$/, '/brain.html') + qs;
  else if (/\/admin\/?$/.test(path)) req.url = path.replace(/\/admin\/?$/, '/admin.html') + qs;
  else if (/\/racehost\/?$/.test(path)) req.url = path.replace(/\/racehost\/?$/, '/arena.html') + qs;
  else if (/\/local\/chaos\/?$/.test(path)) req.url = path.replace(/\/local\/chaos\/?$/, '/local/chaos.html') + qs;
  else if (/\/local\/prop-studio\/?$/.test(path)) req.url = path.replace(/\/local\/prop-studio\/?$/, '/local/prop-studio.html') + qs;
}
function serveLocalOverlay(req, res, next) {
  rewriteWatch(req);
  const q = req.url.indexOf('?');
  const urlPath = q < 0 ? req.url : req.url.slice(0, q);
  if (!urlPath.startsWith('/local/')) return next();
  let rel = decodeURIComponent(urlPath.slice('/local/'.length));
  if (!rel || rel.includes('..')) return next();
  const filePath = path.join(localRoot, rel);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return next();
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
  res.end(fs.readFileSync(filePath));
  return undefined;
}

const watchRoute = {
  name: 'watch-route',
  configureServer(server) { server.middlewares.use(serveLocalOverlay); },
  configurePreviewServer(server) { server.middlewares.use(serveLocalOverlay); },
};
export default defineConfig({
  base: process.env.BASE_PATH || '/', // CI sets /fly-brain/ for GitHub Pages
  plugins: [dropUnpacked, watchRoute],
  define: { __DATA_FILES__: JSON.stringify(DATA_FILES) },
  server: { headers: isolation, fs: { allow: [repoRoot, localRoot] } },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  worker: { format: 'es' },
  build: { target: 'esnext', rollupOptions: { input: { main: 'index.html', arena: 'arena.html', brain: 'brain.html', admin: 'admin.html', fly: 'fly.html', structures: 'structures.html', textbook: 'textbook/index.html' } } },
});
