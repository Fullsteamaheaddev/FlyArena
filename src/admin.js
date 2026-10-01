import {
  CHAIN_ID, chainConfigured, connectWallet, getAccount, poolContract,
  adminSetToken, adminSetWindow, adminSetOperator, adminSetFeeBps, adminSetFeeRecipient,
  adminMint, readChipMeta, chipSymbol,
} from './chain.js';
import { fetchSiteTickerUrl, saveSiteTickerUrl } from './ticker-url.js';
import { fetchSiteMap, saveSiteMap } from './race-map.js';
import { t, applyDom, onLocaleChange } from './i18n.js';

const $ = s => document.querySelector(s);
const status = s => { $('#adminStatus').textContent = s; };
const sameAddr = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
applyDom();
onLocaleChange(() => { applyDom(); refresh().catch(() => {}); });

function hidePanel() {
  const el = $('#adminPanel');
  if (el) el.hidden = true;
}

async function authorize() {
  hidePanel();
  if (!chainConfigured()) { status(t('admin.notConfigured')); return false; }
  const a = getAccount();
  if (!a) { status(t('admin.statusConnect')); return false; }
  const owner = await poolContract().owner();
  if (!sameAddr(a, owner)) {
    status(t('admin.notOwner'));
    return false;
  }
  $('#adminPanel').hidden = false;
  status(t('admin.connected', { addr: a.slice(0, 6) + '…' + a.slice(-4) }));
  return true;
}

async function refresh() {
  if (!(await authorize())) return;
  const p = poolContract();
  const token = await p.token();
  const op = await p.operator();
  const windowSec = await p.windowSeconds();
  const owner = await p.owner();
  const feeBps = Number(await p.feeBps());
  const feeTo = await p.feeRecipient();
  let meta = { symbol: 'CHIP' };
  try { meta = await readChipMeta(); } catch {}
  $('#adminInfo').innerHTML = `<span>${t('admin.info.chain')}</span><span>${CHAIN_ID}</span>
    <span>${t('admin.info.pool')}</span><span>${p.target}</span>
    <span>${t('admin.info.token')}</span><span>${token} (${meta.symbol})</span>
    <span>${t('admin.info.operator')}</span><span>${op}</span>
    <span>${t('admin.info.owner')}</span><span>${owner}</span>
    <span>${t('admin.info.window')}</span><span>${t('admin.windowVal', { n: windowSec })}</span>
    <span>${t('admin.info.fee')}</span><span>${t('admin.feeVal', { pct: feeBps / 100, bps: feeBps })}</span>
    <span>${t('admin.info.feeWallet')}</span><span>${feeTo}</span>`;
  $('#adminWindow').value = windowSec;
  $('#adminToken').value = token;
  $('#adminOp').value = op;
  $('#adminFee').value = feeBps / 100;
  $('#adminFeeTo').value = feeTo;
  const siteTicker = await fetchSiteTickerUrl();
  if (siteTicker) $('#adminTicker').value = siteTicker;
  else {
    try { $('#adminTicker').value = localStorage.getItem('sugarRunTickerUrl') || ''; }
    catch { $('#adminTicker').value = ''; }
  }
  $('#adminMap').value = await fetchSiteMap();
  const mint = $('#adminMint');
  if (mint) mint.textContent = t('admin.mint', { symbol: meta.symbol || chipSymbol() });
}

$('#adminConnect').onclick = async () => {
  try {
    await connectWallet();
    await refresh();
  } catch (e) { hidePanel(); status(e.message || String(e)); }
};

window.ethereum?.on?.('accountsChanged', async () => {
  try {
    await connectWallet();
    await refresh();
  } catch (e) { hidePanel(); status(e.message || String(e)); }
});

$('#adminSetWindow').onclick = async () => {
  try { if (!(await authorize())) return; await adminSetWindow(+$('#adminWindow').value); status(t('admin.windowSaved')); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminSetToken').onclick = async () => {
  try { if (!(await authorize())) return; await adminSetToken($('#adminToken').value.trim()); status(t('admin.tokenSaved')); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminSetOp').onclick = async () => {
  try { if (!(await authorize())) return; await adminSetOperator($('#adminOp').value.trim()); status(t('admin.opSaved')); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminSetFee').onclick = async () => {
  try {
    if (!(await authorize())) return;
    const bps = Math.round((Number($('#adminFee').value) || 0) * 100);
    if (bps < 0 || bps > 1000) { status(t('admin.feeRange')); return; }
    await adminSetFeeBps(bps);
    status(t('admin.feeSaved'));
    await refresh();
  } catch (e) { status(e.message || String(e)); }
};
$('#adminSetFeeTo').onclick = async () => {
  try { if (!(await authorize())) return; await adminSetFeeRecipient($('#adminFeeTo').value.trim()); status(t('admin.feeWalletSaved')); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminSetTicker').onclick = async () => {
  try {
    if (!(await authorize())) return;
    const url = $('#adminTicker').value.trim();
    try { localStorage.setItem('sugarRunTickerUrl', url); } catch {}
    await saveSiteTickerUrl(url);
    status(url ? t('admin.tickerSaved') : t('admin.tickerCleared'));
  } catch (e) {
    status(e.message || String(e));
  }
};
$('#adminSetMap').onclick = async () => {
  try {
    if (!(await authorize())) return;
    const map = await saveSiteMap($('#adminMap').value);
    status(t('admin.mapSaved', { map }));
  } catch (e) {
    status(e.message || String(e));
  }
};
$('#adminMint').onclick = async () => {
  try {
    if (!(await authorize())) return;
    const to = $('#adminMintTo').value.trim() || getAccount();
    await adminMint(to, +$('#adminMintAmt').value || 100);
    status(t('admin.minted'));
  } catch (e) { status(e.message || String(e)); }
};
