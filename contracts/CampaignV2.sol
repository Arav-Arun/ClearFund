// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IUSDC} from "./Campaign.sol";

/// @title CampaignV2
/// @author Arav Arun
/// @notice Escrow for one cause. Donations are released milestone by milestone, each after the creator
///         posts proof and a fixed review window passes. There is no vote: during every window each
///         donor may walk away with their unspent share, and the release is paid only by those who stay.
///         Silence after 72 hours authorizes payment; hashes verify integrity, not truthful evidence.
/// @dev Deployed once as an implementation and cloned per campaign by CampaignFactory.
contract CampaignV2 {
    enum Status {
        Funding,
        Active,
        Completed,
        Cancelled
    }

    enum Step {
        Pending,
        InReview,
        Released
    }

    struct Config {
        string metadataCid; // IPFS JSON with the title, story, cover photo and milestone text
        bytes32 metadataHash; // sha256 of that JSON, so a gateway cannot swap it
        uint256 goal;
        uint256 minimum;
        uint256 fundingDeadline;
    }

    struct MilestoneInput {
        uint256 shareBps;
        uint256 deadline;
    }

    struct Milestone {
        uint256 shareBps;
        uint256 deadline;
        uint256 reviewEndsAt;
        Step step;
        string proofCid;
        bytes32 proofHash;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant REVIEW_WINDOW = 72 hours;
    uint256 public constant START_GRACE = 7 days;

    uint256 public constant MAX_FUNDING = 30 days;
    uint256 public constant MAX_CAMPAIGN = 180 days;
    uint256 public constant MAX_STAGE_GAP = 30 days;
    uint256 public constant MIN_WORK = 1 days;
    uint256 public constant RELEASE_GRACE = 1 days;
    uint256 public constant MAX_FIRST_BPS = 2_500;
    uint256 public constant MAX_STAGE_BPS = 7_500;
    uint256 public constant protocolVersion = 2;

    IUSDC public token;
    address public creator;
    string public metadataCid;
    bytes32 public metadataHash;
    uint256 public goal;
    uint256 public minimum;
    uint256 public fundingDeadline;

    Status public status;
    uint256 public current; // index of the milestone in progress
    uint256 public raised; // net funding commitments; frozen when work starts
    uint256 public activeRaised; // contributions of donors who have not walked away
    uint256 public releasedBps; // share of every remaining contribution already released
    uint256 public creatorOwed; // released but not yet withdrawn

    Milestone[] private milestones;
    mapping(address => uint256) public contributionOf;
    mapping(address => bool) public exited;

    event Donated(address indexed donor, uint256 amount);
    event Started();
    event ProofSubmitted(uint256 indexed milestone, string cid, bytes32 hash, uint256 reviewEndsAt);
    event Exited(address indexed donor, uint256 amount);
    event Released(uint256 indexed milestone, uint256 amount);
    event Withdrawn(uint256 amount);
    event Cancelled();

    error AlreadyInitialized();
    error InvalidConfig();
    error NotCreator();
    error WrongStatus();
    error FundingClosed();
    error GoalExceeded();
    error CreatorCannotDonate();
    error AmountMismatch();
    error BelowMinimum();
    error NotSubmittable();
    error InvalidProof();
    error ReviewOpen();
    error CannotExit();
    error NothingToClaim();
    error NotCancellable();
    error TransferFailed();

    bool private entered;
    modifier nonReentrant() {
        if (entered) revert WrongStatus();
        entered = true;
        _;
        entered = false;
    }
    bool private initialized;

    constructor() {
        initialized = true; // only clones can be initialized
    }

    function initialize(address creator_, IUSDC token_, Config calldata c, MilestoneInput[] calldata inputs) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;

        if (
            bytes(c.metadataCid).length == 0 || c.metadataHash == 0 || c.minimum == 0 || c.minimum > c.goal
                || c.fundingDeadline <= block.timestamp || c.fundingDeadline > block.timestamp + MAX_FUNDING
                || creator_ == address(0) || address(token_) == address(0) || inputs.length < 2 || inputs.length > 4
        ) revert InvalidConfig();

        uint256 total = 0;
        uint256 previous = c.fundingDeadline;
        for (uint256 i; i < inputs.length; i++) {
            uint256 minGap = i == 0 ? START_GRACE + MIN_WORK : REVIEW_WINDOW + RELEASE_GRACE + MIN_WORK;
            if (
                inputs[i].shareBps == 0 || inputs[i].shareBps > MAX_STAGE_BPS
                    || (i == 0 && inputs[i].shareBps > MAX_FIRST_BPS) || inputs[i].deadline < previous + minGap
                    || inputs[i].deadline > previous + MAX_STAGE_GAP
                    || inputs[i].deadline > block.timestamp + MAX_CAMPAIGN
            ) revert InvalidConfig();
            previous = inputs[i].deadline;
            total += inputs[i].shareBps;
            milestones.push(Milestone(inputs[i].shareBps, inputs[i].deadline, 0, Step.Pending, "", 0));
        }
        if (total != BPS) revert InvalidConfig();

        creator = creator_;
        token = token_;
        metadataCid = c.metadataCid;
        metadataHash = c.metadataHash;
        goal = c.goal;
        minimum = c.minimum;
        fundingDeadline = c.fundingDeadline;
    }

    // ------------------------------------------------------------------ funding

    function donate(uint256 amount) external nonReentrant {
        _donate(amount);
    }

    /// @dev If someone front-runs the permit with the same signature, the allowance is already set,
    ///      so the failed permit is ignored and the donation still goes through.
    function donateWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        try token.permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _donate(amount);
    }

    function _donate(uint256 amount) private {
        if (status != Status.Funding || block.timestamp > fundingDeadline) revert FundingClosed();
        if (msg.sender == creator) revert CreatorCannotDonate();
        if (amount == 0 || raised + amount > goal) revert GoalExceeded();

        // Effects precede token interaction; every mutating entry point has the same lock.
        contributionOf[msg.sender] += amount;
        raised += amount;
        activeRaised += amount;
        uint256 before = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        // Deliberate balance-delta check rejects transfer fees; the shared lock prevents callbacks
        // changing this campaign's accounting while the token call is in progress.
        if (token.balanceOf(address(this)) - before != amount) revert AmountMismatch();

        emit Donated(msg.sender, amount);
    }

    function start() external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (status != Status.Funding || block.timestamp > fundingDeadline + START_GRACE) revert WrongStatus();
        if (raised < minimum) revert BelowMinimum();
        if (block.timestamp + MIN_WORK > milestones[0].deadline) revert NotSubmittable();
        status = Status.Active;
        emit Started();
    }

    // --------------------------------------------------------------- milestones

    /// @notice Posts proof for the current milestone and opens its review window. A milestone takes
    ///         exactly one proof, so files cannot be swapped while donors are reviewing them.
    function submitProof(string calldata cid, bytes32 hash) external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (status != Status.Active) revert WrongStatus();
        Milestone storage m = milestones[current];
        if (m.step != Step.Pending || block.timestamp > m.deadline) revert NotSubmittable();
        if (bytes(cid).length == 0 || bytes(cid).length > 100 || hash == 0) revert InvalidProof();

        m.proofCid = cid;
        m.proofHash = hash;
        m.reviewEndsAt = block.timestamp + REVIEW_WINDOW;
        m.step = Step.InReview;
        emit ProofSubmitted(current, cid, hash, m.reviewEndsAt);
    }

    /// @notice Funding may be withdrawn at any time. During work, exit during review or after a
    ///         missed work/release deadline; a stalled campaign is cancelled in the same transaction.
    function exit() external nonReentrant {
        if (!canExit()) revert CannotExit();
        uint256 amount = claimOf(msg.sender);
        if (amount == 0) revert NothingToClaim();

        if (isStalled()) {
            status = Status.Cancelled;
            emit Cancelled();
        }
        uint256 contribution = contributionOf[msg.sender];
        if (status == Status.Funding) {
            // Funding is revocable. Clearing the position permits a later fresh donation.
            contributionOf[msg.sender] = 0;
            raised -= contribution;
        } else {
            exited[msg.sender] = true;
        }
        activeRaised -= contribution;
        _pay(msg.sender, amount);
        emit Exited(msg.sender, amount);
    }

    /// @notice Releases the current milestone once its window has closed. Anyone may call it; the money
    ///         is credited to the creator, who withdraws it, so a frozen creator address blocks no one.
    function release() external nonReentrant {
        if (status != Status.Active) revert WrongStatus();
        if (isStalled()) revert NotSubmittable();
        uint256 index = current;
        Milestone storage m = milestones[index];
        if (m.step != Step.InReview || block.timestamp <= m.reviewEndsAt) revert ReviewOpen();

        bool last = index == milestones.length - 1;
        // The last milestone sweeps what the remaining donors left in, rounding dust included.
        uint256 amount = last ? token.balanceOf(address(this)) - creatorOwed : (activeRaised * m.shareBps) / BPS;

        m.step = Step.Released;
        releasedBps += m.shareBps;
        creatorOwed += amount;
        if (last) status = Status.Completed;
        else current = index + 1;
        emit Released(index, amount);
    }

    function withdraw() external nonReentrant {
        uint256 amount = creatorOwed;
        if (amount == 0) revert NothingToClaim();
        creatorOwed = 0;
        _pay(creator, amount);
        emit Withdrawn(amount);
    }

    /// @notice Ends the campaign so every donor can take back what is unspent. The creator may do it
    ///         at any time; anyone may once funding failed or the current milestone missed its deadline.
    function cancel() external nonReentrant {
        if (msg.sender != creator && !isStalled()) revert NotCancellable();
        if (status != Status.Funding && status != Status.Active) revert WrongStatus();
        status = Status.Cancelled;
        emit Cancelled();
    }

    // -------------------------------------------------------------------- views

    function claimOf(address donor) public view returns (uint256) {
        if (exited[donor]) return 0;
        return (contributionOf[donor] * (BPS - releasedBps)) / BPS;
    }

    function canExit() public view returns (bool) {
        if (status == Status.Cancelled || status == Status.Funding || isStalled()) return true;
        if (status != Status.Active) return false;
        Milestone storage m = milestones[current];
        return m.step == Step.InReview && block.timestamp <= m.reviewEndsAt;
    }

    function isStalled() public view returns (bool) {
        if (status == Status.Funding) {
            return
                block.timestamp > fundingDeadline + START_GRACE
                    || (block.timestamp > fundingDeadline && raised < minimum);
        }
        if (status != Status.Active) return false;
        Milestone storage m = milestones[current];
        return (m.step == Step.Pending && block.timestamp > m.deadline)
            || (m.step == Step.InReview && block.timestamp > m.reviewEndsAt + RELEASE_GRACE);
    }

    function getMilestones() external view returns (Milestone[] memory) {
        return milestones;
    }

    function _pay(address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }
}
