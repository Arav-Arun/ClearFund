// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @title Campaign
/// @author Arav Arun
/// @notice Escrow for one cause. Donations are released milestone by milestone, each after the creator
///         posts proof and a fixed review window passes. There is no vote: during every window each
///         donor may walk away with their unspent share, and the release is paid only by those who stay.
///         Nobody's action can move anyone else's money, so stake, sybils and bribes have nothing to win.
/// @dev Deployed once as an implementation and cloned per campaign by CampaignFactory.
contract Campaign {
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

    IUSDC public token;
    address public creator;
    string public metadataCid;
    bytes32 public metadataHash;
    uint256 public goal;
    uint256 public minimum;
    uint256 public fundingDeadline;

    Status public status;
    uint256 public current; // index of the milestone in progress
    uint256 public raised; // everything ever donated
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

    bool private initialized;

    constructor() {
        initialized = true; // only clones can be initialized
    }

    function initialize(address creator_, IUSDC token_, Config calldata c, MilestoneInput[] calldata inputs) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;

        if (
            bytes(c.metadataCid).length == 0 || c.metadataHash == 0 || c.minimum == 0 || c.minimum > c.goal
                || c.fundingDeadline <= block.timestamp || inputs.length < 2 || inputs.length > 4
        ) revert InvalidConfig();

        uint256 total;
        uint256 previous = c.fundingDeadline;
        for (uint256 i; i < inputs.length; i++) {
            if (inputs[i].shareBps == 0 || inputs[i].deadline <= previous) revert InvalidConfig();
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

    function donate(uint256 amount) external {
        _donate(amount);
    }

    /// @dev If someone front-runs the permit with the same signature, the allowance is already set,
    ///      so the failed permit is ignored and the donation still goes through.
    function donateWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        try token.permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _donate(amount);
    }

    function _donate(uint256 amount) private {
        if (status != Status.Funding || block.timestamp > fundingDeadline) revert FundingClosed();
        if (msg.sender == creator) revert CreatorCannotDonate();
        if (amount == 0 || raised + amount > goal) revert GoalExceeded();

        // Book what actually arrived, so a token fee can never leave the escrow short.
        uint256 before = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (token.balanceOf(address(this)) - before != amount) revert AmountMismatch();

        contributionOf[msg.sender] += amount;
        raised += amount;
        activeRaised += amount;
        emit Donated(msg.sender, amount);
    }

    function start() external {
        if (msg.sender != creator) revert NotCreator();
        if (status != Status.Funding || block.timestamp > fundingDeadline + START_GRACE) revert WrongStatus();
        if (raised < minimum) revert BelowMinimum();
        status = Status.Active;
        emit Started();
    }

    // --------------------------------------------------------------- milestones

    /// @notice Posts proof for the current milestone and opens its review window. A milestone takes
    ///         exactly one proof, so files cannot be swapped while donors are reviewing them.
    function submitProof(string calldata cid, bytes32 hash) external {
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

    /// @notice Walks away with the caller's unspent share. Open during a review window, and for good
    ///         once the campaign is cancelled.
    function exit() external {
        if (!canExit()) revert CannotExit();
        uint256 amount = claimOf(msg.sender);
        if (amount == 0) revert NothingToClaim();

        exited[msg.sender] = true;
        activeRaised -= contributionOf[msg.sender];
        _pay(msg.sender, amount);
        emit Exited(msg.sender, amount);
    }

    /// @notice Releases the current milestone once its window has closed. Anyone may call it; the money
    ///         is credited to the creator, who withdraws it, so a frozen creator address blocks no one.
    function release() external {
        if (status != Status.Active) revert WrongStatus();
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

    function withdraw() external {
        uint256 amount = creatorOwed;
        if (amount == 0) revert NothingToClaim();
        creatorOwed = 0;
        _pay(creator, amount);
        emit Withdrawn(amount);
    }

    /// @notice Ends the campaign so every donor can take back what is unspent. The creator may do it
    ///         at any time; anyone may once funding failed or the current milestone missed its deadline.
    function cancel() external {
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
        if (status == Status.Cancelled) return true;
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
        return m.step == Step.Pending && block.timestamp > m.deadline;
    }

    function getMilestones() external view returns (Milestone[] memory) {
        return milestones;
    }

    function _pay(address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }
}
