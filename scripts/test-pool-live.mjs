// Live RacePool check on the deployed chain: owner + two ephemeral bettors.
import hre from 'hardhat';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

const { ethers } = hre;
const EX = 'https://explorer.testnet.chain.robinhood.com';

async function mustRevert(label, fn) {
  try {
    const tx = await fn();
    if (tx?.wait) await tx.wait();
    throw new Error(`${label}: expected revert`);
  } catch (e) {
    if (String(e.message || e).includes('expected revert')) throw e;
    console.log('revert ok', label);
  }
}

async function send(label, p) {
  const tx = await p;
  const rec = await tx.wait();
  console.log(label, `${EX}/tx/${rec.hash}`);
  return rec;
}

async function main() {
  const [owner] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const dest = path.join(process.cwd(), 'contracts', 'deployments', `${chainId}.json`);
  if (!fs.existsSync(dest)) throw new Error(`missing ${dest}`);
  const dep = JSON.parse(fs.readFileSync(dest, 'utf8'));
  if (!dep.chip || !dep.pool) throw new Error('deploy first');
  const chip = await ethers.getContractAt('PlayChip', dep.chip);
  const pool = await ethers.getContractAt('RacePool', dep.pool);
  assert.equal((await pool.owner()).toLowerCase(), owner.address.toLowerCase());
  const a = ethers.Wallet.createRandom().connect(ethers.provider);
  const b = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log(JSON.stringify({
    chainId, owner: owner.address, chip: dep.chip, pool: dep.pool, bettorA: a.address, bettorB: b.address,
  }, null, 2));

  const gas = ethers.parseEther('0.001');
  await send('fund A', owner.sendTransaction({ to: a.address, value: gas }));
  await send('fund B', owner.sendTransaction({ to: b.address, value: gas }));
  const mint = ethers.parseUnits('1000', 18);
  await send('mint A', chip.mint(a.address, mint));
  await send('mint B', chip.mint(b.address, mint));
  await send('approve A', chip.connect(a).approve(dep.pool, mint));
  await send('approve B', chip.connect(b).approve(dep.pool, mint));

  const ten = ethers.parseUnits('10', 18);
  const thirty = ethers.parseUnits('30', 18);
  const five = ethers.parseUnits('5', 18);
  const id1 = 900_000_000 + (Date.now() % 1_000_000);
  const id2 = id1 + 1;

  await send('open 1', pool.openRace(id1, [0, 1, 2]));
  await send('bet A fly0 10', pool.connect(a).bet(id1, 0, ten));
  await send('bet B fly1 30', pool.connect(b).bet(id1, 1, thirty));
  await send('lock 1', pool.lockRace(id1));
  await mustRevert('bet after lock', () => pool.connect(a).bet(id1, 0, ten));
  await send('settle fly0', pool.settle(id1, 0));

  const before = await chip.balanceOf(a.address);
  await send('claim A', pool.connect(a).claim(id1));
  assert.equal(await chip.balanceOf(a.address) - before, ethers.parseUnits('40', 18));
  await mustRevert('claim B lost', () => pool.connect(b).claim(id1));
  await mustRevert('claim A twice', () => pool.connect(a).claim(id1));

  await send('open 2', pool.openRace(id2, [0, 1]));
  await send('bet A fly0 5', pool.connect(a).bet(id2, 0, five));
  await send('void 2', pool.voidRace(id2));
  const mid = await chip.balanceOf(a.address);
  await send('refund A', pool.connect(a).refund(id2));
  assert.equal(await chip.balanceOf(a.address) - mid, five);

  console.log('pool live test passed', { matchWin: id1, matchVoid: id2 });
}

main().catch(e => { console.error(e); process.exit(1); });
