import {
  CHAIN_ID, chainConfigured, connectWallet, getAccount, poolContract,
  adminSetToken, adminSetWindow, adminSetOperator, adminMint, readChipMeta,
} from './chain.js';

const $ = s => document.querySelector(s);
const status = s => { $('#adminStatus').textContent = s; };
const sameAddr = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

function hidePanel() {
  const el = $('#adminPanel');
  if (el) el.hidden = true;
}

async function authorize() {
  hidePanel();
  if (!chainConfigured()) { status('Pool not configured (set VITE_POOL / VITE_CHIP or deploy).'); return false; }
  const a = getAccount();
  if (!a) { status('Connect the owner wallet.'); return false; }
  const owner = await poolContract().owner();
  if (!sameAddr(a, owner)) {
    status('Not the owner wallet.');
    return false;
  }
  $('#adminPanel').hidden = false;
  status('Connected ' + a.slice(0, 6) + '…' + a.slice(-4));
  return true;
}

async function refresh() {
  if (!(await authorize())) return;
  const p = poolContract();
  const token = await p.token();
  const op = await p.operator();
  const windowSec = await p.windowSeconds();
  const owner = await p.owner();
  let meta = { symbol: 'CHIP' };
  try { meta = await readChipMeta(); } catch {}
  $('#adminInfo').innerHTML = `<span>chain</span><span>${CHAIN_ID}</span>
    <span>pool</span><span>${p.target}</span>
    <span>token</span><span>${token} (${meta.symbol})</span>
    <span>operator</span><span>${op}</span>
    <span>owner</span><span>${owner}</span>
    <span>window</span><span>${windowSec} s</span>`;
  $('#adminWindow').value = windowSec;
  $('#adminToken').value = token;
  $('#adminOp').value = op;
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
  try { if (!(await authorize())) return; await adminSetWindow(+$('#adminWindow').value); status('Window saved.'); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminSetToken').onclick = async () => {
  try { if (!(await authorize())) return; await adminSetToken($('#adminToken').value.trim()); status('Token saved.'); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminSetOp').onclick = async () => {
  try { if (!(await authorize())) return; await adminSetOperator($('#adminOp').value.trim()); status('Operator saved.'); await refresh(); }
  catch (e) { status(e.message || String(e)); }
};
$('#adminMint').onclick = async () => {
  try {
    if (!(await authorize())) return;
    const to = $('#adminMintTo').value.trim() || getAccount();
    await adminMint(to, +$('#adminMintAmt').value || 100);
    status('Minted.');
  } catch (e) { status(e.message || String(e)); }
};
