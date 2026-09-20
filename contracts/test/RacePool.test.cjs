const { ethers } = require("hardhat");
const assert = require("node:assert/strict");

const chips = n => ethers.parseUnits(String(n), 18);

async function reverts(promise, reason) {
  try {
    const tx = await promise;
    if (tx?.wait) await tx.wait();
  } catch (e) {
    const msg = String(e.message || e);
    assert.ok(msg.includes(reason), `expected revert "${reason}", got: ${msg}`);
    return;
  }
  throw new Error(`expected revert "${reason}"`);
}

describe("RacePool", function () {
  async function deploy() {
    const [owner, op, a, b, c, outsider] = await ethers.getSigners();
    const Chip = await ethers.getContractFactory("PlayChip");
    const chip = await Chip.deploy();
    const Pool = await ethers.getContractFactory("RacePool");
    const pool = await Pool.deploy(await chip.getAddress(), op.address);
    const poolAddr = await pool.getAddress();
    for (const s of [a, b, c]) {
      await chip.mint(s.address, chips(1000));
      await chip.connect(s).approve(poolAddr, ethers.MaxUint256);
    }
    return { owner, op, a, b, c, outsider, chip, pool, poolAddr };
  }

  it("pays the winner pool and refunds a void", async function () {
    const { op, a, b, chip, pool } = await deploy();
    await pool.connect(op).openRace(1, [0, 1, 2]);
    await pool.connect(a).bet(1, 0, chips(10));
    await pool.connect(b).bet(1, 1, chips(30));
    await pool.connect(op).lockRace(1);
    await pool.connect(op).settle(1, 0);
    const before = await chip.balanceOf(a.address);
    await pool.connect(a).claim(1);
    assert.equal(await chip.balanceOf(a.address) - before, chips(40));

    await pool.connect(op).openRace(2, [0, 1]);
    await pool.connect(a).bet(2, 0, chips(5));
    await pool.connect(op).voidRace(2);
    const mid = await chip.balanceOf(a.address);
    await pool.connect(a).refund(2);
    assert.equal(await chip.balanceOf(a.address) - mid, chips(5));
  });

  it("only the operator or owner can open, lock and settle", async function () {
    const { owner, op, a, outsider, pool } = await deploy();
    await reverts(pool.connect(outsider).openRace(10, [0, 1, 2]), "not operator");
    await pool.connect(owner).openRace(10, [0, 1, 2]);
    await reverts(pool.connect(op).openRace(10, [0, 1, 2]), "exists");
    await reverts(pool.connect(outsider).lockRace(10), "not operator");
    await pool.connect(a).bet(10, 1, chips(7));
    await pool.connect(op).lockRace(10);
    await reverts(pool.connect(outsider).settle(10, 1), "not operator");
    await pool.connect(op).settle(10, 1);
    assert.equal(Number((await pool.raceInfo(10)).winnerFly), 1);
  });

  it("rejects bad opens and bad bets", async function () {
    const { op, a, pool } = await deploy();
    await reverts(pool.connect(op).openRace(20, []), "flies");
    await reverts(pool.connect(op).openRace(20, [0, 0]), "dup");
    await reverts(pool.connect(a).bet(20, 0, chips(1)), "closed");
    await pool.connect(op).openRace(20, [0, 1, 2]);
    await reverts(pool.connect(a).bet(20, 9, chips(1)), "fly");
    await reverts(pool.connect(a).bet(20, 0, 0), "amount");
    await pool.connect(op).lockRace(20);
    await reverts(pool.connect(a).bet(20, 0, chips(1)), "closed");
    await reverts(pool.connect(op).lockRace(20), "state");
  });

  it("reverts a bet with no allowance or no balance", async function () {
    const { op, outsider, chip, pool, poolAddr } = await deploy();
    await pool.connect(op).openRace(25, [0, 1, 2]);
    await chip.mint(outsider.address, chips(1));
    await reverts(pool.connect(outsider).bet(25, 0, chips(1)), "ERC20InsufficientAllowance");
    await chip.connect(outsider).approve(poolAddr, ethers.MaxUint256);
    await reverts(pool.connect(outsider).bet(25, 0, chips(5)), "ERC20InsufficientBalance");
    await pool.connect(outsider).bet(25, 0, chips(1));
    assert.equal(await pool.total(25), chips(1));
  });

  it("splits the pot pari-mutuel across several bettors and stakes", async function () {
    const { op, a, b, c, chip, pool, poolAddr } = await deploy();
    await pool.connect(op).openRace(30, [0, 1, 2]);
    await pool.connect(a).bet(30, 0, chips(10));
    await pool.connect(a).bet(30, 0, chips(10));   // same wallet, same fly: accumulates
    await pool.connect(a).bet(30, 1, chips(5));    // same wallet hedges another fly
    await pool.connect(b).bet(30, 0, chips(20));
    await pool.connect(c).bet(30, 2, chips(15));
    assert.equal(await pool.poolByFly(30, 0), chips(40));
    assert.equal(await pool.userTotal(30, a.address), chips(25));
    assert.equal(await pool.stake(30, a.address, 0), chips(20));
    assert.equal(await pool.total(30), chips(60));

    await pool.connect(op).lockRace(30);
    await pool.connect(op).settle(30, 0);
    const beforeA = await chip.balanceOf(a.address);
    const beforeB = await chip.balanceOf(b.address);
    await pool.connect(a).claim(30);
    await pool.connect(b).claim(30);
    // 60 total over a 40 winning pool: 1.5x the winning stake.
    assert.equal(await chip.balanceOf(a.address) - beforeA, chips(30));
    assert.equal(await chip.balanceOf(b.address) - beforeB, chips(30));
    assert.equal(await chip.balanceOf(poolAddr), 0n);
    await reverts(pool.connect(c).claim(30), "no win");
    await reverts(pool.connect(a).claim(30), "claimed");
    await reverts(pool.connect(a).refund(30), "state");
  });

  it("claims are impossible before settle and refunds impossible while betting", async function () {
    const { op, a, pool } = await deploy();
    await pool.connect(op).openRace(40, [0, 1, 2]);
    await pool.connect(a).bet(40, 0, chips(10));
    await reverts(pool.connect(a).claim(40), "state");
    await reverts(pool.connect(a).refund(40), "state");
    await pool.connect(op).lockRace(40);
    await reverts(pool.connect(a).claim(40), "state");
  });

  it("refunds when the winning fly drew no bets", async function () {
    const { op, a, b, chip, pool, poolAddr } = await deploy();
    await pool.connect(op).openRace(50, [0, 1, 2]);
    await pool.connect(a).bet(50, 0, chips(10));
    await pool.connect(b).bet(50, 1, chips(10));
    await pool.connect(op).lockRace(50);
    await pool.connect(op).settle(50, 2);            // nobody backed fly 2
    assert.equal(await pool.winningPool(50), 0n);
    await reverts(pool.connect(a).claim(50), "use refund");
    await pool.connect(a).refund(50);
    await pool.connect(b).refund(50);
    assert.equal(await chip.balanceOf(poolAddr), 0n);
    await reverts(pool.connect(a).refund(50), "claimed");
  });

  it("voids from betting or locked, once per wallet, only with a stake", async function () {
    const { op, a, b, outsider, chip, pool, poolAddr } = await deploy();
    await pool.connect(op).openRace(60, [0, 1, 2]);
    await pool.connect(a).bet(60, 0, chips(10));
    await pool.connect(op).voidRace(60);
    await reverts(pool.connect(op).voidRace(60), "state");
    await reverts(pool.connect(op).settle(60, 0), "state");
    await pool.connect(a).refund(60);
    await reverts(pool.connect(a).refund(60), "claimed");
    await reverts(pool.connect(outsider).refund(60), "none");

    await pool.connect(op).openRace(61, [0, 1, 2]);
    await pool.connect(b).bet(61, 1, chips(12));
    await pool.connect(op).lockRace(61);
    await pool.connect(op).voidRace(61);
    await pool.connect(b).refund(61);
    assert.equal(await chip.balanceOf(poolAddr), 0n);
  });

  it("lets anyone void a stuck race only after the timeout", async function () {
    const { op, a, outsider, pool } = await deploy();
    await pool.connect(op).openRace(70, [0, 1, 2]);
    await pool.connect(a).bet(70, 0, chips(10));
    await reverts(pool.connect(outsider).voidRace(70), "not operator");
    const wait = Number(await pool.windowSeconds()) + Number(await pool.voidTimeout()) + 1;
    await ethers.provider.send("evm_increaseTime", [wait]);
    await ethers.provider.send("evm_mine", []);
    await pool.connect(outsider).voidRace(70);
    assert.equal(Number((await pool.raceInfo(70)).status), 4);
    await pool.connect(a).refund(70);
  });

  it("guards the owner-only settings the admin page uses", async function () {
    const { owner, op, a, b, pool } = await deploy();
    await reverts(pool.connect(a).setWindow(60), "OwnableUnauthorizedAccount");
    await reverts(pool.connect(owner).setWindow(5), "window");
    await reverts(pool.connect(owner).setWindow(601), "window");
    await pool.connect(owner).setWindow(60);
    assert.equal(Number(await pool.windowSeconds()), 60);
    await reverts(pool.connect(a).setOperator(a.address), "OwnableUnauthorizedAccount");
    await pool.connect(owner).setOperator(b.address);
    await reverts(pool.connect(op).openRace(80, [0, 1, 2]), "not operator");
    await pool.connect(b).openRace(80, [0, 1, 2]);
    assert.equal(Number((await pool.raceInfo(80)).status), 1);
  });

  it("keeps races independent so a fresh match id is always bettable", async function () {
    const { op, a, pool } = await deploy();
    const id1 = Date.now();
    const id2 = id1 + 1;
    await pool.connect(op).openRace(id1, [0, 1, 2]);
    await pool.connect(a).bet(id1, 0, chips(10));
    await pool.connect(op).lockRace(id1);
    await pool.connect(op).settle(id1, 0);
    await pool.connect(op).openRace(id2, [0, 1, 2]);
    assert.equal(Number((await pool.raceInfo(id2)).status), 1);
    await pool.connect(a).bet(id2, 2, chips(10));
    assert.equal(await pool.poolByFly(id2, 2), chips(10));
    assert.deepEqual((await pool.flyIds(id2)).map(Number), [0, 1, 2]);
  });
});
