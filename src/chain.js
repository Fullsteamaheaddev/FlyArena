import { BrowserProvider, Contract, JsonRpcProvider, MaxUint256, formatUnits, parseUnits } from 'ethers';
import poolAbi from './abi/RacePool.json';
import chipAbi from './abi/PlayChip.json';
import deployed46630 from '../contracts/deployments/46630.json';

export const DEFAULT_WINDOW = 45;
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 46630);
const known = Number(deployed46630.chainId) === CHAIN_ID ? deployed46630 : {};
export const POOL_ADDR = import.meta.env.VITE_POOL || known.pool || '';
export const FALLBACK_CHIP_ADDR = import.meta.env.VITE_CHIP || known.chip || '';
export let CHIP_ADDR = FALLBACK_CHIP_ADDR;
let chipMeta = { address: FALLBACK_CHIP_ADDR, symbol: 'CHIP', name: '' };
const RPC_BY_CHAIN = {
  31337: 'http://127.0.0.1:8545',
  46630: 'https://rpc.testnet.chain.robinhood.com',
  4663: 'https://rpc.mainnet.chain.robinhood.com',
  84532: 'https://sepolia.base.org',
};
const RPC = import.meta.env.VITE_RPC || RPC_BY_CHAIN[CHAIN_ID] || 'https://rpc.testnet.chain.robinhood.com';

export function chainConfigured() { return !!(POOL_ADDR && (CHIP_ADDR || FALLBACK_CHIP_ADDR)); }
export function chipSymbol() { return chipMeta.symbol || 'CHIP'; }
export function getChipMeta() { return chipMeta; }

let browser, signer, account, walletHooked = false, walletCb = null;

export function getAccount() { return account || null; }
export function chipAmount(n) { return parseUnits(String(n), 18); }
export function chipFmt(wei) { return formatUnits(wei ?? 0n, 18); }

function clearLocalWallet() {
  account = null;
  signer = null;
  browser = null;
}

export async function disconnectWallet() {
  clearLocalWallet();
  try {
    await window.ethereum?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
  } catch { /* wallet may not support revoke */ }
}

async function applyAccounts(accs) {
  if (!accs?.length) { clearLocalWallet(); return null; }
  browser = new BrowserProvider(window.ethereum);
  signer = await browser.getSigner(accs[0]);
  account = await signer.getAddress();
  return account;
}

export function onWalletChange(cb) {
  walletCb = cb;
  if (!window.ethereum || walletHooked) return;
  walletHooked = true;
  window.ethereum.on('accountsChanged', async accs => {
    try {
      await applyAccounts(accs);
      walletCb?.(account);
    } catch {
      clearLocalWallet();
      walletCb?.(null);
    }
  });
  window.ethereum.on('chainChanged', async () => {
    if (!account) return;
    try {
      await applyAccounts(await window.ethereum.request({ method: 'eth_accounts' }));
      walletCb?.(account);
    } catch { clearLocalWallet(); walletCb?.(null); }
  });
}

// Reads never go through the wallet: MetaMask serves eth_call from its own block cache and can
// trail the chain by 10-15 s, so a race the operator just opened still looks closed.
let reader = null;
function readProv() {
  if (!reader) reader = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  return reader;
}

export function poolContract(write = false) {
  if (!POOL_ADDR) throw new Error('VITE_POOL missing');
  return new Contract(POOL_ADDR, poolAbi, write ? signer : readProv());
}
export function chipContract(write = false) {
  const addr = CHIP_ADDR || FALLBACK_CHIP_ADDR;
  if (!addr) throw new Error('Stake token not configured');
  return new Contract(addr, chipAbi, write ? signer : readProv());
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export async function resolveChip() {
  if (POOL_ADDR) {
    try {
      const addr = await poolContract().token();
      if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== ZERO_ADDR) {
        if (addr.toLowerCase() === (CHIP_ADDR || '').toLowerCase() && chipMeta.address && chipMeta.symbol) return chipMeta;
        CHIP_ADDR = addr;
      }
    } catch { /* keep fallback */ }
  }
  const addr = CHIP_ADDR || FALLBACK_CHIP_ADDR;
  if (!addr) return chipMeta;
  try {
    const c = new Contract(addr, chipAbi, readProv());
    chipMeta = { address: addr, symbol: await c.symbol(), name: await c.name() };
  } catch {
    chipMeta = { address: addr, symbol: chipMeta.symbol || 'CHIP', name: chipMeta.name || '' };
  }
  return chipMeta;
}

const CHAIN_META = {
  46630: { chainName: 'Robinhood Chain Testnet', rpcUrls: ['https://rpc.testnet.chain.robinhood.com'], blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'] },
  4663: { chainName: 'Robinhood Chain', rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com'] },
  84532: { chainName: 'Base Sepolia', rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] },
  31337: { chainName: 'Hardhat', rpcUrls: ['http://127.0.0.1:8545'] },
};

export async function ensureWallet() {
  if (!window.ethereum) throw new Error('No wallet found');
  if (account && signer) {
    const net = await browser.getNetwork();
    if (Number(net.chainId) === CHAIN_ID) return account;
    return connectWallet();
  }
  const accs = await window.ethereum.request({ method: 'eth_accounts' });
  if (accs?.length) return applyAccounts(accs);
  return connectWallet();
}

// Silent restore after a reload: MetaMask keeps the permission, so no prompt is needed.
export async function restoreWallet() {
  if (!window.ethereum) return null;
  try {
    const accs = await window.ethereum.request({ method: 'eth_accounts' });
    return accs?.length ? await applyAccounts(accs) : null;
  } catch { return null; }
}

// MetaMask never tells a page about an account it has not permitted, so switching
// accounts in the extension needs this explicit picker (wallet_requestPermissions).
export async function switchAccount() {
  if (!window.ethereum) throw new Error('No wallet found');
  await window.ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  return connectWallet();
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error('No wallet found');
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  browser = new BrowserProvider(window.ethereum);
  const net = await browser.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) {
    const hex = '0x' + CHAIN_ID.toString(16);
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code === 4902) {
        const meta = CHAIN_META[CHAIN_ID] || { chainName: 'Chain ' + CHAIN_ID, rpcUrls: [RPC] };
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: hex, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, ...meta }],
        });
      } else throw e;
    }
    browser = new BrowserProvider(window.ethereum);
  }
  signer = await browser.getSigner();
  account = await signer.getAddress();
  return account;
}

export async function readWindow() {
  if (!chainConfigured()) return DEFAULT_WINDOW;
  return Number(await poolContract().windowSeconds());
}

export async function readRace(matchId) {
  const p = poolContract();
  const info = await p.raceInfo(matchId);
  return {
    status: Number(info.status),
    openedAt: Number(info.openedAt),
    winnerFly: Number(info.winnerFly),
    total: info.total,
    winningPool: info.winningPool,
    flyIds: [...info.flyIds].map(Number),
  };
}

export async function readPools(matchId, flyIds) {
  const p = poolContract();
  const rows = [];
  for (const id of flyIds) {
    const amount = await p.poolByFly(matchId, id);
    rows.push({ id, amount: amount.toString(), display: chipFmt(amount) });
  }
  return rows;
}

export async function readChipMeta() {
  return resolveChip();
}

export async function readBalance(addr) {
  return chipFmt(await chipContract().balanceOf(addr));
}

export async function userStake(matchId, addr, flyId) {
  return await poolContract().stake(matchId, addr, flyId);
}

export async function userTotal(matchId, addr) {
  return await poolContract().userTotal(matchId, addr);
}

export async function isClaimed(matchId, addr) {
  return poolContract().claimed(matchId, addr);
}

export async function approveIfNeeded(amount) {
  const a = await chipContract().allowance(account, POOL_ADDR);
  if (a >= amount) return;
  // One generous allowance, so later bets are a single wallet prompt instead of approve + bet.
  const tx = await chipContract(true).approve(POOL_ADDR, MaxUint256);
  await tx.wait();
}

export async function openRace(matchId, flyIds) {
  const tx = await poolContract(true).openRace(matchId, flyIds);
  await tx.wait();
}
export async function lockRace(matchId) {
  const tx = await poolContract(true).lockRace(matchId);
  await tx.wait();
}
export async function settleRace(matchId, winnerFly) {
  const tx = await poolContract(true).settle(matchId, winnerFly);
  await tx.wait();
}
export async function voidRace(matchId) {
  const tx = await poolContract(true).voidRace(matchId);
  await tx.wait();
}
export async function placeBet(matchId, flyId, chips) {
  const amount = chipAmount(chips);
  let status = null, bal = null;
  try { status = Number((await poolContract().raceInfo(matchId)).status); } catch { status = 'err'; }
  try { bal = await chipContract().balanceOf(account); } catch { /* read failed */ }
  if (status !== 1) throw new Error(status === 0 ? 'Race not open on-chain yet' : 'Betting closed');
  if (bal != null && bal < amount) throw new Error(`Only ${Number(chipFmt(bal)).toFixed(1)} ${chipSymbol()} — ask the host to mint more`);
  await approveIfNeeded(amount);
  const tx = await poolContract(true).bet(matchId, flyId, amount);
  await tx.wait();
}
export async function claimRace(matchId) {
  const tx = await poolContract(true).claim(matchId);
  await tx.wait();
}
export async function refundRace(matchId) {
  const tx = await poolContract(true).refund(matchId);
  await tx.wait();
}

export async function adminSetToken(addr) {
  const tx = await poolContract(true).setToken(addr);
  await tx.wait();
}
export async function adminSetWindow(sec) {
  const tx = await poolContract(true).setWindow(sec);
  await tx.wait();
}
export async function adminSetOperator(addr) {
  const tx = await poolContract(true).setOperator(addr);
  await tx.wait();
}
export async function adminSetFeeBps(bps) {
  const tx = await poolContract(true).setFeeBps(bps);
  await tx.wait();
}
export async function adminSetFeeRecipient(addr) {
  const tx = await poolContract(true).setFeeRecipient(addr);
  await tx.wait();
}
export async function adminMint(to, chips) {
  const tx = await chipContract(true).mint(to, chipAmount(chips));
  await tx.wait();
}

export async function loadHistory(addr) {
  if (!chainConfigured() || !addr) return [];
  const p = poolContract();
  const placed = await p.queryFilter(p.filters.BetPlaced(null, addr));
  const claimed = await p.queryFilter(p.filters.Claimed(null, addr));
  const refunded = await p.queryFilter(p.filters.Refunded(null, addr));
  const settled = await p.queryFilter(p.filters.Settled());
  const voided = await p.queryFilter(p.filters.Voided());
  const settleBy = new Map(settled.map(e => [e.args.matchId.toString(), e]));
  const voidBy = new Set(voided.map(e => e.args.matchId.toString()));
  const claimedBy = new Set(claimed.map(e => e.args.matchId.toString()));
  const refundedBy = new Set(refunded.map(e => e.args.matchId.toString()));
  const paidBy = new Map(claimed.map(e => [e.args.matchId.toString(), e.args.payout]));
  const backBy = new Map(refunded.map(e => [e.args.matchId.toString(), e.args.amount]));
  const byMatch = new Map();
  for (const e of placed) {
    const id = e.args.matchId.toString();
    const row = byMatch.get(id) || { matchId: id, flyId: Number(e.args.flyId), amount: 0n, byFly: new Map() };
    const fly = Number(e.args.flyId);
    row.amount += e.args.amount;
    row.byFly.set(fly, (row.byFly.get(fly) || 0n) + e.args.amount);
    byMatch.set(id, row);
  }
  return [...byMatch.values()].map(row => {
    const se = settleBy.get(row.matchId);
    let flyId = row.flyId, biggest = 0n;
    for (const [fly, amt] of row.byFly) if (amt > biggest) { biggest = amt; flyId = fly; }
    let outcome = 'open', payout = null;
    if (voidBy.has(row.matchId) || (se && se.args.winningPool === 0n)) {
      outcome = refundedBy.has(row.matchId) ? 'refunded' : 'void';
      payout = backBy.get(row.matchId) ?? row.amount;
    } else if (se) {
      const winner = Number(se.args.winnerFly);
      const winStake = row.byFly.get(winner) || 0n;
      const won = winStake > 0n;
      if (won) flyId = winner;
      if (claimedBy.has(row.matchId)) { outcome = won ? 'won' : 'lost'; payout = paidBy.get(row.matchId) ?? 0n; }
      else { outcome = won ? 'unclaimed' : 'lost'; payout = won ? winStake * se.args.total / se.args.winningPool : 0n; }
    }
    return { matchId: row.matchId, flyId, amount: chipFmt(row.amount), payout: payout == null ? null : chipFmt(payout), outcome };
  }).reverse();
}
