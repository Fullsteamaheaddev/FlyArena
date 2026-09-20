import hre from 'hardhat';
import fs from 'fs';
import path from 'path';

const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const operator = process.env.OPERATOR || deployer.address;
  const Chip = await ethers.getContractFactory('PlayChip');
  const chip = await Chip.deploy();
  await chip.waitForDeployment();
  const Pool = await ethers.getContractFactory('RacePool');
  const pool = await Pool.deploy(await chip.getAddress(), operator);
  await pool.waitForDeployment();
  const out = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    chip: await chip.getAddress(),
    pool: await pool.getAddress(),
    owner: deployer.address,
    operator,
  };
  const dest = path.join(process.cwd(), 'contracts', 'deployments', `${out.chainId}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
