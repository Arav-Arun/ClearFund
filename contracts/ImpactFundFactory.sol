// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./ImpactFundCampaign.sol";

/// @title ImpactFundFactory — Campaign deployer and registry
/// @notice Deploys new ImpactFundCampaign contracts with bootstrap grant config
///         and maintains a global registry of all campaigns.
contract ImpactFundFactory {
    struct MilestoneInput {
        string title;
        string description;
        uint256 fundPercent;
        uint256 deadline;
    }

    address[] public campaigns;
    mapping(address => address[]) public campaignsByNGO;

    event CampaignCreated(address indexed campaignAddress, address indexed ngo, string title);

    constructor() {}

    function createCampaign(
        string memory _title,
        string memory _description,
        string memory _ngoName,
        uint256 _bootstrapPercent,
        MilestoneInput[] memory _milestones,
        uint256 _goalAmount,
        uint256 _campaignDeadline
    ) external returns (address) {
        require(bytes(_title).length > 0, "Factory: title required");
        require(bytes(_ngoName).length > 0, "Factory: NGO name required");
        require(_goalAmount > 0, "Factory: goal must be > 0");

        uint256 totalPercent = 0;
        for (uint256 i = 0; i < _milestones.length; i++) {
            totalPercent += _milestones[i].fundPercent;
        }
        require(totalPercent == 100, "Factory: milestone percentages must sum to 100");
        require(_milestones.length >= 2 && _milestones.length <= 5, "Factory: 2-5 milestones required");
        require(_bootstrapPercent >= 1 && _bootstrapPercent <= 15, "Factory: bootstrap must be 1-15%");
        require(_campaignDeadline > block.timestamp, "Factory: fundraising deadline must be in the future");

        uint256 previousDeadline = _campaignDeadline;
        for (uint256 i = 0; i < _milestones.length; i++) {
            require(_milestones[i].deadline > block.timestamp, "Factory: milestone deadline must be in the future");
            require(_milestones[i].deadline > _campaignDeadline, "Factory: milestone deadline must be after fundraising deadline");
            require(_milestones[i].deadline > previousDeadline, "Factory: milestone deadlines must be increasing");
            previousDeadline = _milestones[i].deadline;
        }

        ImpactFundCampaign campaign = new ImpactFundCampaign(
            msg.sender,
            _title,
            _description,
            _ngoName,
            _goalAmount,
            _campaignDeadline,
            _bootstrapPercent
        );

        uint256 remainingPercent = 100 - _bootstrapPercent;
        uint256 assignedPercent = 0;
        for (uint256 i = 0; i < _milestones.length; i++) {
            uint256 actualPercent = i == _milestones.length - 1
                ? remainingPercent - assignedPercent
                : (_milestones[i].fundPercent * remainingPercent) / 100;

            assignedPercent += actualPercent;
            campaign.addMilestone(
                _milestones[i].title,
                _milestones[i].description,
                actualPercent,
                _milestones[i].deadline
            );
        }

        address campaignAddr = address(campaign);
        campaigns.push(campaignAddr);
        campaignsByNGO[msg.sender].push(campaignAddr);

        emit CampaignCreated(campaignAddr, msg.sender, _title);

        return campaignAddr;
    }

    function getAllCampaigns() external view returns (address[] memory) {
        return campaigns;
    }

    function getCampaignsByNGO(address ngo) external view returns (address[] memory) {
        return campaignsByNGO[ngo];
    }

    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
