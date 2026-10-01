import { LOCALES, getLocale, setLocale, t, flagUrl, onLocaleChange } from './i18n.js';

export function mountLangSelect(host) {
  if (!host || host.dataset.mounted === '1') return;
  host.dataset.mounted = '1';
  host.classList.add('lang-select');

  function paint() {
    const cur = getLocale();
    host.innerHTML = `<button type="button" class="lang-current" aria-haspopup="listbox" aria-expanded="false" aria-label="${t('lang.choose')}: ${t('lang.' + cur)}"><img src="${flagUrl(cur)}" alt="" width="20" height="14"></button>
      <ul class="lang-menu" hidden role="listbox">
        ${LOCALES.map(l => `<li><button type="button" data-lang="${l.id}" role="option" aria-selected="${l.id === cur ? 'true' : 'false'}" aria-label="${t('lang.' + l.id)}"><img src="${flagUrl(l.id)}" alt="" width="20" height="14"></button></li>`).join('')}
      </ul>`;
    const btn = host.querySelector('.lang-current');
    const menu = host.querySelector('.lang-menu');
    const close = () => {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.onclick = e => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    menu.querySelectorAll('[data-lang]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        setLocale(b.dataset.lang);
        close();
      };
    });
    host._closeLang = close;
  }

  paint();
  onLocaleChange(paint);
  if (!mountLangSelect._doc) {
    mountLangSelect._doc = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.lang-select').forEach(el => el._closeLang?.());
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.lang-select').forEach(el => el._closeLang?.());
    });
  }
}
