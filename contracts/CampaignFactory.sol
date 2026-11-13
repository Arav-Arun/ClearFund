// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Campaign, IUSDC} from "./Campaign.sol";

/// @title CampaignFactory
/// @author Arav Arun
/// @notice Creates campaigns as EIP-1167 clones of one implementation, all in one token. It has no owner:
///         nobody can pause, upgrade or redirect a campaign once it exists.
contract CampaignFactory {
    IUSDC public immutable token;
    address public immutable implementation;

    address[] private campaigns;
    mapping(address => bool) public isCampaign;

    event CampaignCreated(address indexed campaign, address indexed creator);

    error CloneFailed();

    constructor(IUSDC token_) {
        token = token_;
        implementation = address(new Campaign());
    }

    function createCampaign(Campaign.Config calldata config, Campaign.MilestoneInput[] calldata milestones)
        external
        returns (address campaign)
    {
        campaign = _clone(implementation);
        Campaign(campaign).initialize(msg.sender, token, config, milestones);
        campaigns.push(campaign);
        isCampaign[campaign] = true;
        emit CampaignCreated(campaign, msg.sender);
    }

    function getCampaigns() external view returns (address[] memory) {
        return campaigns;
    }

    /// @dev Minimal proxy deployment, the same bytecode as OpenZeppelin's Clones.clone.
    function _clone(address target) private returns (address instance) {
        assembly ("memory-safe") {
            mstore(0x00, or(shr(0xe8, shl(0x60, target)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, target), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(0, 0x09, 0x37)
        }
        if (instance == address(0)) revert CloneFailed();
    }
}
