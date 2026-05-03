// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title ClearFundCampaign — AI Oracle Verification with Veto
/// @author Arav Arun
/// @notice Escrows ETH. Milestones are verified by an AI Oracle, followed by a 24-hour donor veto window.
contract ClearFundCampaign {
    enum CampaignStatus { Fundraising, Active, Completed, Cancelled }
    enum MilestoneStatus { Pending, Submitted, InVeto, Approved, Rejected }

    struct Milestone {
        string title;
        string description;
        uint256 fundPercent;
        uint256 deadline;
        MilestoneStatus status;
        string evidenceUrl;
        uint256 vetoEndsAt;
    }

    struct CampaignView {
        address ngoAddress;
        string title;
        string description;
        string ngoName;
        uint256 goalAmount;
        uint256 raisedAmount;
        uint256 campaignDeadline;
        uint256 bootstrapPercent;
        CampaignStatus status;
        uint256 milestoneCount;
    }

    address public ngoAddress;
    address public oracleAddress;
    string public title;
    string public description;
    string public ngoName;
    uint256 public goalAmount;
    uint256 public raisedAmount;
    uint256 public campaignDeadline;
    uint256 public bootstrapPercent;
    CampaignStatus public status;

    Milestone[] public milestones;
    mapping(address => uint256) public donations;

    address[] public donorList;
    mapping(address => bool) private isDonor;

    bool public bootstrapReleased;
    mapping(uint256 => bool) public fundsReleased;
    mapping(address => bool) public refunded;
    uint256 public refundPool;

    address public deployer;
    bool private locked;

    mapping(uint256 => uint256) public vetoVotes;
    mapping(uint256 => uint256) public vetoRounds;
    mapping(uint256 => mapping(address => uint256)) public lastVetoRound;

    event DonationReceived(address indexed donor, uint256 amount);
    event BootstrapReleased(uint256 amount);
    event CampaignStarted();
    event MilestoneSubmitted(uint256 indexed milestoneId, string evidenceUrl);
    event OracleDecision(uint256 indexed milestoneId, bool approved);
    event VetoWindowOpened(uint256 indexed milestoneId, uint256 vetoEndsAt, address ngo, uint256 donorCount);
    event VetoCast(address indexed voter, uint256 indexed milestoneId);
    event VetoMajorityReached(uint256 indexed milestoneId, uint256 vetoVotes, uint256 donorCount);
    event FundsReleased(uint256 indexed milestoneId, uint256 amount);
    event CampaignCancelled();
    event RefundIssued(address indexed donor, uint256 amount);

    modifier nonReentrant() {
        require(!locked, "Campaign: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyNGO() {
        require(msg.sender == ngoAddress, "Campaign: caller is not the NGO");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracleAddress, "Campaign: caller is not the Oracle");
        _;
    }

    modifier onlyDonor() {
        require(donations[msg.sender] > 0, "Campaign: caller is not a donor");
        _;
    }

    modifier inStatus(CampaignStatus _status) {
        require(status == _status, "Campaign: invalid status");
        _;
    }

    constructor(
        address _ngoAddress,
        address _oracleAddress,
        string memory _title,
        string memory _description,
        string memory _ngoName,
        uint256 _goalAmount,
        uint256 _campaignDeadline,
        uint256 _bootstrapPercent
    ) {
        require(_goalAmount > 0, "Campaign: goal must be > 0");
        require(_oracleAddress != address(0), "Campaign: oracle required");
        ngoAddress = _ngoAddress;
        oracleAddress = _oracleAddress;
        title = _title;
        description = _description;
        ngoName = _ngoName;
        goalAmount = _goalAmount;
        campaignDeadline = _campaignDeadline;
        bootstrapPercent = _bootstrapPercent;
        status = CampaignStatus.Fundraising;
        deployer = msg.sender;

        // Milestone 0 is the Bootstrap Grant
        milestones.push(Milestone({
            title: "Initial Operating Grant",
            description: "Bootstrap funds released when campaign starts.",
            fundPercent: _bootstrapPercent,
            deadline: 0,
            status: MilestoneStatus.Pending,
            evidenceUrl: "",
            vetoEndsAt: 0
        }));
    }

    function addMilestone(
        string memory _title,
        string memory _description,
        uint256 _fundPercent,
        uint256 _milestoneDeadline
    ) external {
        require(msg.sender == deployer, "Campaign: only deployer");
        require(raisedAmount == 0, "Campaign: cannot add after donations");

        milestones.push(Milestone({
            title: _title,
            description: _description,
            fundPercent: _fundPercent,
            deadline: _milestoneDeadline,
            status: MilestoneStatus.Pending,
            evidenceUrl: "",
            vetoEndsAt: 0
        }));
    }

    function donate() external payable nonReentrant inStatus(CampaignStatus.Fundraising) {
        require(msg.value > 0, "Campaign: donation > 0");
        require(msg.sender != ngoAddress, "Campaign: NGO cannot donate");
        require(block.timestamp < campaignDeadline, "Campaign: deadline passed");
        // Soft Cap: We DO NOT restrict raisedAmount <= goalAmount, allowing overfunding.

        if (!isDonor[msg.sender]) {
            donorList.push(msg.sender);
            isDonor[msg.sender] = true;
        }
        donations[msg.sender] += msg.value;
        raisedAmount += msg.value;

        emit DonationReceived(msg.sender, msg.value);
    }

    function startCampaign() external onlyNGO inStatus(CampaignStatus.Fundraising) {
        require(raisedAmount >= (goalAmount * milestones[0].fundPercent) / 100, "Campaign: bootstrap not reached");
        
        status = CampaignStatus.Active;
        emit CampaignStarted();
        
        _releaseBootstrap();
    }

    function _releaseBootstrap() internal {
        // Calculate based on actual raised amount (handles overfunding)
        uint256 bootstrapAmount = (raisedAmount * bootstrapPercent) / 100;
        bootstrapReleased = true;
        milestones[0].status = MilestoneStatus.Approved;
        fundsReleased[0] = true;

        (bool success, ) = payable(ngoAddress).call{value: bootstrapAmount}("");
        require(success, "Campaign: transfer failed");

        emit BootstrapReleased(bootstrapAmount);
        emit FundsReleased(0, bootstrapAmount);
    }

    function submitMilestone(uint256 milestoneId, string memory evidenceUrl) external onlyNGO inStatus(CampaignStatus.Active) {
        require(milestoneId > 0 && milestoneId < milestones.length, "Campaign: invalid id");
        require(bootstrapReleased, "Campaign: bootstrap not released");
        require(_previousMilestoneApproved(milestoneId), "Campaign: previous not approved");

        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.Rejected, "Campaign: not submittable");
        
        m.evidenceUrl = evidenceUrl;
        m.status = MilestoneStatus.Submitted;

        emit MilestoneSubmitted(milestoneId, evidenceUrl);
    }

    // ORACLE FUNCTIONS
    function oracleApproveMilestone(uint256 milestoneId) external onlyOracle inStatus(CampaignStatus.Active) {
        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Submitted, "Campaign: not submitted");

        m.status = MilestoneStatus.InVeto;
        m.vetoEndsAt = block.timestamp + 24 hours;
        vetoVotes[milestoneId] = 0;
        vetoRounds[milestoneId] += 1;

        emit OracleDecision(milestoneId, true);
        emit VetoWindowOpened(milestoneId, m.vetoEndsAt, ngoAddress, donorList.length);
    }

    function oracleRejectMilestone(uint256 milestoneId) external onlyOracle inStatus(CampaignStatus.Active) {
        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Submitted, "Campaign: not submitted");

        m.status = MilestoneStatus.Rejected;
        emit OracleDecision(milestoneId, false);
    }

    // DONOR VETO
    function vetoMilestone(uint256 milestoneId) external onlyDonor nonReentrant inStatus(CampaignStatus.Active) {
        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.InVeto, "Campaign: not in veto phase");
        require(block.timestamp <= m.vetoEndsAt, "Campaign: veto period ended");
        require(lastVetoRound[milestoneId][msg.sender] != vetoRounds[milestoneId], "Campaign: already voted");

        lastVetoRound[milestoneId][msg.sender] = vetoRounds[milestoneId];
        vetoVotes[milestoneId] += 1;
        emit VetoCast(msg.sender, milestoneId);

        if (vetoVotes[milestoneId] > donorList.length / 2) {
            m.status = MilestoneStatus.Rejected;
            emit VetoMajorityReached(milestoneId, vetoVotes[milestoneId], donorList.length);
        }
    }

    // EXECUTE
    function executeMilestone(uint256 milestoneId) external nonReentrant inStatus(CampaignStatus.Active) {
        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.InVeto, "Campaign: not in veto phase");
        require(block.timestamp > m.vetoEndsAt, "Campaign: veto period active");

        _releaseMilestoneFunds(milestoneId);
    }

    function _releaseMilestoneFunds(uint256 milestoneId) internal {
        Milestone storage m = milestones[milestoneId];
        
        // Payouts scale based on actual raised amount
        uint256 trancheAmount = milestoneId == milestones.length - 1 ? address(this).balance : (raisedAmount * m.fundPercent) / 100;
        uint256 available = address(this).balance;
        if (trancheAmount > available) trancheAmount = available;

        m.status = MilestoneStatus.Approved;
        fundsReleased[milestoneId] = true;

        (bool success, ) = payable(ngoAddress).call{value: trancheAmount}("");
        require(success, "Campaign: transfer failed");

        emit FundsReleased(milestoneId, trancheAmount);

        if (_allMilestonesApproved()) status = CampaignStatus.Completed;
    }

    // Cancellation after a missed active milestone deadline.
    function cancelStalledCampaign() external {
        require(status == CampaignStatus.Active, "Campaign: not active");
        uint256 activeMilestone = 0;
        
        for (uint256 i = 1; i < milestones.length; i++) {
            if (milestones[i].status != MilestoneStatus.Approved) {
                activeMilestone = i;
                break;
            }
        }
        
        require(activeMilestone > 0, "Campaign: all milestones approved");
        require(block.timestamp > milestones[activeMilestone].deadline, "Campaign: deadline not passed");
        
        status = CampaignStatus.Cancelled;
        refundPool = address(this).balance;
        emit CampaignCancelled();
    }

    function refund() external onlyDonor nonReentrant {
        bool fundraisingFailed = block.timestamp > campaignDeadline && raisedAmount < (goalAmount * bootstrapPercent) / 100 && status == CampaignStatus.Fundraising;
        require(status == CampaignStatus.Cancelled || fundraisingFailed, "Campaign: refund not available");
        require(!refunded[msg.sender], "Campaign: refunded");

        if (fundraisingFailed && status != CampaignStatus.Cancelled) {
            status = CampaignStatus.Cancelled;
            refundPool = address(this).balance;
            emit CampaignCancelled();
        }

        if (refundPool == 0) refundPool = address(this).balance;

        uint256 amount = (refundPool * donations[msg.sender]) / raisedAmount;
        require(amount > 0, "Campaign: nothing to refund");

        refunded[msg.sender] = true;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Campaign: transfer failed");

        emit RefundIssued(msg.sender, amount);
    }

    function _allMilestonesApproved() internal view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i].status != MilestoneStatus.Approved) return false;
        }
        return true;
    }

    function _previousMilestoneApproved(uint256 milestoneId) internal view returns (bool) {
        if (milestoneId == 0) return true;
        return milestones[milestoneId - 1].status == MilestoneStatus.Approved;
    }

    function getCampaign() external view returns (CampaignView memory) {
        return CampaignView(ngoAddress, title, description, ngoName, goalAmount, raisedAmount, campaignDeadline, bootstrapPercent, status, milestones.length);
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        return milestones[milestoneId];
    }

    function getAllMilestones() external view returns (Milestone[] memory) {
        return milestones;
    }

    function getDonors() external view returns (address[] memory) {
        return donorList;
    }

    function getDonation(address donor) external view returns (uint256) {
        return donations[donor];
    }

    function getVetoInfo(uint256 milestoneId, address voter) external view returns (
        uint256 donorCount,
        uint256 currentVetoVotes,
        bool voterHasVetoed,
        uint256 vetoEndsAt
    ) {
        Milestone storage m = milestones[milestoneId];
        bool voterVetoed = vetoRounds[milestoneId] > 0 && lastVetoRound[milestoneId][voter] == vetoRounds[milestoneId];
        return (donorList.length, vetoVotes[milestoneId], voterVetoed, m.vetoEndsAt);
    }

    receive() external payable {}
}
