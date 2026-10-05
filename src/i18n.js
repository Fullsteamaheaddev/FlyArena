import en from './locales/en.js';
import zhCN from './locales/zh-CN.js';
import es from './locales/es.js';
import ptBR from './locales/pt-BR.js';
import ru from './locales/ru.js';
import ko from './locales/ko.js';

const STORAGE = 'sugarRunLang';
const DICTS = { en, 'zh-CN': zhCN, es, 'pt-BR': ptBR, ru, ko };

export const LOCALES = [
  { id: 'en', flag: 'en.svg', htmlLang: 'en' },
  { id: 'zh-CN', flag: 'zh-CN.svg', htmlLang: 'zh-CN' },
  { id: 'es', flag: 'es.svg', htmlLang: 'es' },
  { id: 'pt-BR', flag: 'pt-BR.svg', htmlLang: 'pt-BR' },
  { id: 'ru', flag: 'ru.svg', htmlLang: 'ru' },
  { id: 'ko', flag: 'ko.svg', htmlLang: 'ko' },
];

const listeners = new Set();
let locale = 'en';

function fromNavigator() {
  const n = String(navigator.language || navigator.userLanguage || 'en').toLowerCase();
  if (n.startsWith('zh')) return 'zh-CN';
  if (n.startsWith('es')) return 'es';
  if (n.startsWith('pt')) return 'pt-BR';
  if (n.startsWith('ru')) return 'ru';
  if (n.startsWith('ko')) return 'ko';
  return 'en';
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE);
    if (v && DICTS[v]) return v;
  } catch { /* private mode */ }
  return null;
}

function localeMeta(id) {
  return LOCALES.find(l => l.id === id) || LOCALES[0];
}

function dictOf(id) {
  return DICTS[id] || en;
}

function lookup(key) {
  const cur = dictOf(locale)[key];
  if (cur != null) return cur;
  if (en[key] != null) return en[key];
  return undefined;
}

function interpolate(s, vars) {
  if (!vars) return s;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

export function t(key, vars) {
  const s = lookup(key);
  return interpolate(s == null ? key : s, vars);
}

export function getLocale() { return locale; }

export function flagUrl(id) {
  const meta = localeMeta(id);
  return `${import.meta.env.BASE_URL}flags/${meta.flag}`;
}

function applyHtmlLang() {
  document.documentElement.lang = localeMeta(locale).htmlLang;
}

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLocale(id) {
  if (!DICTS[id] || id === locale) return;
  locale = id;
  try { localStorage.setItem(STORAGE, id); } catch { /* private mode */ }
  applyHtmlLang();
  applyDom();
  for (const fn of listeners) fn(id);
}

export function groupLabel(g) {
  const s = lookup(`group.${g.key}`);
  return s == null ? g.label : s;
}

export function groupInfo(g) {
  const s = lookup(`group.${g.key}.info`);
  return s == null ? g.info : s;
}

export function behaviorLabel(behavior, { short = false } = {}) {
  if (!behavior) return '';
  const pe = / \(proboscis out\)$/.test(behavior);
  const base = behavior.replace(/ \(proboscis out\)$/, '');
  const key = short ? `behavior.short.${base}` : `behavior.${base}`;
  let s = lookup(key);
  if (s == null && short) s = lookup(`behavior.${base}`);
  if (s == null) s = base;
  if (pe) s = t('behavior.withProboscis', { action: s });
  return s;
}

export function chaosCopy(kind, name) {
  const title = t(`chaos.${kind}.title`);
  if (kind === 'double') {
    return { title, line: name ? t('chaos.double.line', { name }) : t('chaos.double.lineAnon') };
  }
  if (kind === 'laser') {
    return { title, line: name ? t('chaos.laser.line', { name }) : t('chaos.laser.lineAnon') };
  }
  if (kind === 'holy') {
    if (name?.dud) return { title, line: t('chaos.holy.lineDud') };
    if (name?.thrower && name?.target) return { title, line: t('chaos.holy.line', name) };
    if (name?.thrower) return { title, line: t('chaos.holy.lineSolo', name) };
    return { title, line: t('chaos.holy.lineAnon') };
  }
  if (kind === 'ufo') {
    return { title, line: name ? t(`chaos.${kind}.line`, { name }) : t(`chaos.${kind}.lineAnon`) };
  }
  return { title, line: t(`chaos.${kind}.line`, { name: name || t('chaos.aFly') }) };
}

const LOAD_EXACT = {
  'loading body model': 'load.body',
  'writing connectome into shared memory': 'load.shared',
  'writing connectome and optic-lobe model into shared memory': 'load.sharedVision',
  'loading arena': 'load.arena',
  'loading interface': 'load.site',
  'decoding Blender detail': 'load.blenderDecode',
  'applying Cycles lighting': 'load.cycles',
  'preparing lighting': 'load.lighting',
  'loading…': 'load.ellipsis',
  'joining…': 'load.joining',
  'loading results…': 'load.results',
  'connectome…': 'load.connectomeDots',
  'skeletons…': 'load.skeletonsDots',
};

export function formatLoadStatus(s) {
  if (s == null) return '';
  if (typeof s !== 'string') return String(s);
  if (LOAD_EXACT[s]) return t(LOAD_EXACT[s]);
  const mb = s.match(/^(neurons|connectome|skeletons) ([\d.]+) \/ ([\d.]+) MB$/);
  if (mb) return t(`load.${mb[1]}MB`, { a: mb[2], b: mb[3] });
  const dec = s.match(/^decoding (neurons|connectome|skeletons)$/);
  if (dec) return t(`load.decode.${dec[1]}`);
  const pct = s.match(/^loading Blender body ([\d.]+)%$/);
  if (pct) return t('load.blenderPct', { n: pct[1] });
  const blenderMb = s.match(/^loading Blender body ([\d.]+) MB$/);
  if (blenderMb) return t('load.blenderMB', { n: blenderMb[1] });
  if (s.startsWith('error: ')) return t('load.error', { msg: s.slice(7) });
  const typeMiss = s.match(/^type "(.+)" not found$/);
  if (typeMiss) return t('brain.typeNotFound', { type: typeMiss[1] });
  return s;
}

locale = readStored() || fromNavigator();
applyHtmlLang();
