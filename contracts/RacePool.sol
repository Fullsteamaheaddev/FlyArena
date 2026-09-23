// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Pari-mutuel winner pool. One market per matchId. Operator opens/locks/settles.
contract RacePool is Ownable {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Betting,
        Locked,
        Settled,
        Voided
    }

    struct RaceView {
        Status status;
        uint64 openedAt;
        uint32 winnerFly;
        uint256 total;
        uint256 winningPool;
        uint32[] flyIds;
    }

    IERC20 public token;
    address public operator;
    uint32 public windowSeconds = 45;
    uint32 public voidTimeout = 30 minutes;
    uint16 public feeBps = 500;
    address public feeRecipient = 0x000000000000000000000000000000000000dEaD;

    mapping(uint256 => Status) public status;
    mapping(uint256 => uint64) public openedAt;
    mapping(uint256 => uint32) public winnerFly;
    mapping(uint256 => uint256) public total;
    mapping(uint256 => uint256) public winningPool;
    /// Pot minus the fee, snapshotted at settle so a later setFeeBps cannot move a pending claim.
    mapping(uint256 => uint256) public payoutTotal;
    mapping(uint256 => uint32[]) private _flyIds;
    mapping(uint256 => mapping(uint32 => bool)) public isFly;
    mapping(uint256 => mapping(uint32 => uint256)) public poolByFly;
    mapping(uint256 => mapping(address => mapping(uint32 => uint256))) public stake;
    mapping(uint256 => mapping(address => uint256)) public userTotal;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event TokenSet(address token);
    event WindowSet(uint32 seconds_);
    event OperatorSet(address operator);
    event FeeBpsSet(uint16 bps);
    event FeeRecipientSet(address recipient);
    event FeeTaken(uint256 indexed matchId, address indexed recipient, uint256 amount);
    event RaceOpened(uint256 indexed matchId, uint32[] flyIds);
    event BetPlaced(uint256 indexed matchId, address indexed user, uint32 flyId, uint256 amount);
    event RaceLocked(uint256 indexed matchId);
    event Settled(uint256 indexed matchId, uint32 winnerFly, uint256 total, uint256 winningPool);
    event Voided(uint256 indexed matchId);
    event Claimed(uint256 indexed matchId, address indexed user, uint256 payout);
    event Refunded(uint256 indexed matchId, address indexed user, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner(), "not operator");
        _;
    }

    constructor(IERC20 token_, address operator_) Ownable(msg.sender) {
        token = token_;
        operator = operator_;
        emit TokenSet(address(token_));
        emit OperatorSet(operator_);
    }

    function setToken(IERC20 token_) external onlyOwner {
        token = token_;
        emit TokenSet(address(token_));
    }

    function setWindow(uint32 seconds_) external onlyOwner {
        require(seconds_ >= 10 && seconds_ <= 600, "window");
        windowSeconds = seconds_;
        emit WindowSet(seconds_);
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setVoidTimeout(uint32 seconds_) external onlyOwner {
        voidTimeout = seconds_;
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        require(bps <= 1000, "fee");
        feeBps = bps;
        emit FeeBpsSet(bps);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "recipient");
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function flyIds(uint256 matchId) external view returns (uint32[] memory) {
        return _flyIds[matchId];
    }

    function raceInfo(uint256 matchId) external view returns (RaceView memory) {
        return RaceView({
            status: status[matchId],
            openedAt: openedAt[matchId],
            winnerFly: winnerFly[matchId],
            total: total[matchId],
            winningPool: winningPool[matchId],
            flyIds: _flyIds[matchId]
        });
    }

    function openRace(uint256 matchId, uint32[] calldata flyIds_) external onlyOperator {
        require(status[matchId] == Status.None, "exists");
        require(flyIds_.length > 0 && flyIds_.length <= 16, "flies");
        for (uint256 i; i < flyIds_.length; i++) {
            require(!isFly[matchId][flyIds_[i]], "dup");
            isFly[matchId][flyIds_[i]] = true;
            _flyIds[matchId].push(flyIds_[i]);
        }
        status[matchId] = Status.Betting;
        openedAt[matchId] = uint64(block.timestamp);
        emit RaceOpened(matchId, flyIds_);
    }

    function bet(uint256 matchId, uint32 flyId, uint256 amount) external {
        require(status[matchId] == Status.Betting, "closed");
        require(isFly[matchId][flyId], "fly");
        require(amount > 0, "amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        stake[matchId][msg.sender][flyId] += amount;
        userTotal[matchId][msg.sender] += amount;
        poolByFly[matchId][flyId] += amount;
        total[matchId] += amount;
        emit BetPlaced(matchId, msg.sender, flyId, amount);
    }

    function lockRace(uint256 matchId) external onlyOperator {
        require(status[matchId] == Status.Betting, "state");
        status[matchId] = Status.Locked;
        emit RaceLocked(matchId);
    }

    function settle(uint256 matchId, uint32 winnerFlyId) external onlyOperator {
        require(status[matchId] == Status.Locked, "state");
        require(isFly[matchId][winnerFlyId], "fly");
        status[matchId] = Status.Settled;
        winnerFly[matchId] = winnerFlyId;
        winningPool[matchId] = poolByFly[matchId][winnerFlyId];
        uint256 pot = total[matchId];
        uint256 fee = 0;
        // No winning stake means everyone refunds in full, so the pot is never taxed.
        if (winningPool[matchId] > 0 && feeBps > 0) {
            fee = pot * feeBps / 10000;
            if (fee > 0) {
                token.safeTransfer(feeRecipient, fee);
                emit FeeTaken(matchId, feeRecipient, fee);
            }
        }
        payoutTotal[matchId] = pot - fee;
        emit Settled(matchId, winnerFlyId, pot, winningPool[matchId]);
    }

    function voidRace(uint256 matchId) external {
        Status s = status[matchId];
        require(s == Status.Betting || s == Status.Locked, "state");
        bool timedOut = block.timestamp >= uint256(openedAt[matchId]) + windowSeconds + voidTimeout;
        require(msg.sender == operator || msg.sender == owner() || timedOut, "not operator");
        status[matchId] = Status.Voided;
        emit Voided(matchId);
    }

    function claim(uint256 matchId) external {
        require(status[matchId] == Status.Settled, "state");
        require(winningPool[matchId] > 0, "use refund");
        require(!claimed[matchId][msg.sender], "claimed");
        uint256 s = stake[matchId][msg.sender][winnerFly[matchId]];
        require(s > 0, "no win");
        claimed[matchId][msg.sender] = true;
        uint256 payout = s * payoutTotal[matchId] / winningPool[matchId];
        token.safeTransfer(msg.sender, payout);
        emit Claimed(matchId, msg.sender, payout);
    }

    function refund(uint256 matchId) external {
        Status s = status[matchId];
        bool ok = s == Status.Voided || (s == Status.Settled && winningPool[matchId] == 0);
        require(ok, "state");
        require(!claimed[matchId][msg.sender], "claimed");
        uint256 t = userTotal[matchId][msg.sender];
        require(t > 0, "none");
        claimed[matchId][msg.sender] = true;
        token.safeTransfer(msg.sender, t);
        emit Refunded(matchId, msg.sender, t);
    }
}
