// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ImpactFundCampaign — Simplified Milestone-gated donation escrow
/// @notice Escrows ETH. Milestones release when >50% of the donated weight approves.
contract ImpactFundCampaign is ReentrancyGuard {
    enum CampaignStatus { Fundraising, Active, Completed, Cancelled }
    enum MilestoneStatus { Pending, Submitted, Approved, Rejected }

    struct Milestone {
        string title;
        string description;
        uint256 fundPercent;
        uint256 deadline;
        MilestoneStatus status;
        string evidenceUrl;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 submissionCount;
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
    mapping(address => mapping(uint256 => uint256)) public lastVotedSubmission;

    address[] public donorList;
    mapping(address => bool) private isDonor;

    bool public bootstrapReleased;
    mapping(uint256 => bool) public fundsReleased;
    mapping(address => bool) public refunded;

    address public deployer;

    event DonationReceived(address indexed donor, uint256 amount);
    event BootstrapReleased(uint256 amount);
    event MilestoneSubmitted(uint256 indexed milestoneId, string evidenceUrl);
    event VoteCast(address indexed voter, uint256 indexed milestoneId, bool approved);
    event FundsReleased(uint256 indexed milestoneId, uint256 amount);
    event MilestoneRejected(uint256 indexed milestoneId);
    event RefundIssued(address indexed donor, uint256 amount);

    modifier onlyNGO() {
        require(msg.sender == ngoAddress, "Campaign: caller is not the NGO");
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
        string memory _title,
        string memory _description,
        string memory _ngoName,
        uint256 _goalAmount,
        uint256 _campaignDeadline,
        uint256 _bootstrapPercent
    ) {
        require(_goalAmount > 0, "Campaign: goal must be > 0");
        ngoAddress = _ngoAddress;
        title = _title;
        description = _description;
        ngoName = _ngoName;
        goalAmount = _goalAmount;
        campaignDeadline = _campaignDeadline;
        bootstrapPercent = _bootstrapPercent;
        status = CampaignStatus.Fundraising;
        deployer = msg.sender;

        // Milestone 0 is the Bootstrap Grant, released automatically
        milestones.push(Milestone({
            title: "Initial Operating Grant",
            description: "Bootstrap funds released automatically once its tranche is funded.",
            fundPercent: _bootstrapPercent,
            deadline: 0,
            status: MilestoneStatus.Pending,
            evidenceUrl: "",
            votesFor: 0,
            votesAgainst: 0,
            submissionCount: 0
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
            votesFor: 0,
            votesAgainst: 0,
            submissionCount: 0
        }));
    }

    function donate() external payable nonReentrant {
        require(status == CampaignStatus.Fundraising || status == CampaignStatus.Active, "Campaign: closed");
        require(msg.value > 0, "Campaign: donation > 0");
        require(msg.sender != ngoAddress, "Campaign: NGO cannot donate");
        require(block.timestamp < campaignDeadline, "Campaign: deadline passed");
        require(raisedAmount + msg.value <= goalAmount, "Campaign: exceeds goal");

        if (!isDonor[msg.sender]) {
            donorList.push(msg.sender);
            isDonor[msg.sender] = true;
        }
        donations[msg.sender] += msg.value;
        raisedAmount += msg.value;

        emit DonationReceived(msg.sender, msg.value);

        if (!bootstrapReleased && raisedAmount >= (goalAmount * milestones[0].fundPercent) / 100) {
            _releaseBootstrap();
        }
    }

    function _releaseBootstrap() internal {
        uint256 bootstrapAmount = (goalAmount * bootstrapPercent) / 100;
        bootstrapReleased = true;
        milestones[0].status = MilestoneStatus.Approved;
        fundsReleased[0] = true;
        status = CampaignStatus.Active;

        (bool success, ) = payable(ngoAddress).call{value: bootstrapAmount}("");
        require(success, "Campaign: transfer failed");

        emit BootstrapReleased(bootstrapAmount);
        emit FundsReleased(0, bootstrapAmount);
    }

    function submitMilestone(uint256 milestoneId, string memory evidenceUrl) external onlyNGO inStatus(CampaignStatus.Active) {
        require(milestoneId > 0 && milestoneId < milestones.length, "Campaign: invalid id");
        require(bootstrapReleased, "Campaign: bootstrap not released");
        require(_previousMilestoneApproved(milestoneId), "Campaign: previous not approved");

        uint256 cumulativePercent = 0;
        for (uint256 i = 0; i <= milestoneId; i++) {
            cumulativePercent += milestones[i].fundPercent;
        }
        require(raisedAmount >= (goalAmount * cumulativePercent) / 100, "Campaign: funding not unlocked");

        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.Rejected, "Campaign: not submittable");
        
        m.evidenceUrl = evidenceUrl;
        m.status = MilestoneStatus.Submitted;
        m.submissionCount += 1;
        m.votesFor = 0;
        m.votesAgainst = 0;

        emit MilestoneSubmitted(milestoneId, evidenceUrl);
    }

    function vote(uint256 milestoneId, bool approve) external onlyDonor nonReentrant inStatus(CampaignStatus.Active) {
        require(milestoneId > 0 && milestoneId < milestones.length, "Campaign: invalid id");
        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Submitted, "Campaign: not in voting");
        require(lastVotedSubmission[msg.sender][milestoneId] < m.submissionCount, "Campaign: already voted");

        lastVotedSubmission[msg.sender][milestoneId] = m.submissionCount;
        uint256 weight = donations[msg.sender];

        if (approve) {
            m.votesFor += weight;
        } else {
            m.votesAgainst += weight;
        }

        emit VoteCast(msg.sender, milestoneId, approve);

        // Auto-resolve if simple majority is reached
        uint256 threshold = raisedAmount / 2;
        if (m.votesFor > threshold) {
            _releaseMilestoneFunds(milestoneId);
        } else if (m.votesAgainst > threshold) {
            m.status = MilestoneStatus.Rejected;
            emit MilestoneRejected(milestoneId);
        }
    }

    function _releaseMilestoneFunds(uint256 milestoneId) internal {
        Milestone storage m = milestones[milestoneId];
        uint256 trancheAmount = milestoneId == milestones.length - 1 ? address(this).balance : (goalAmount * m.fundPercent) / 100;
        uint256 available = address(this).balance;
        if (trancheAmount > available) trancheAmount = available;

        m.status = MilestoneStatus.Approved;
        fundsReleased[milestoneId] = true;

        (bool success, ) = payable(ngoAddress).call{value: trancheAmount}("");
        require(success, "Campaign: transfer failed");

        emit FundsReleased(milestoneId, trancheAmount);

        if (_allMilestonesApproved()) status = CampaignStatus.Completed;
    }

    function refund() external onlyDonor nonReentrant {
        bool fundraisingFailed = block.timestamp > campaignDeadline && raisedAmount < goalAmount && status != CampaignStatus.Completed;
        require(status == CampaignStatus.Cancelled || fundraisingFailed, "Campaign: refund not available");
        require(!refunded[msg.sender], "Campaign: refunded");

        if (fundraisingFailed && status != CampaignStatus.Cancelled) status = CampaignStatus.Cancelled;

        uint256 amount = (address(this).balance * donations[msg.sender]) / raisedAmount;
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

    receive() external payable {}
}
