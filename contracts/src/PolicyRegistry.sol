// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PolicyRegistry
/// @notice Append-only audit trail for Agent Firewall. Events only, no heavy storage.
///         The owner commits a hash of each agent's rules; the firewall service logs decisions.
contract PolicyRegistry {
    enum Outcome { Allow, Block, Hold }

    address public owner;
    address public service;
    /// @notice Latest committed policy hash per agent (cheap lookup for verifiers).
    mapping(bytes32 => bytes32) public currentPolicy;

    event PolicyCommitted(bytes32 indexed agentId, bytes32 policyHash, uint256 timestamp);
    event Decision(bytes32 indexed agentId, bytes32 indexed requestId, uint8 outcome, bytes32 ruleId, uint256 amount, bytes32 policyHash);
    event ServiceChanged(address service);
    event OwnershipTransferred(address owner);

    error NotOwner();
    error NotService();
    error BadOutcome();
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyService() {
        if (msg.sender != service && msg.sender != owner) revert NotService();
        _;
    }

    constructor(address _owner, address _service) {
        owner = _owner;
        service = _service;
    }

    function commitPolicy(bytes32 agentId, bytes32 policyHash) external onlyOwner {
        currentPolicy[agentId] = policyHash;
        emit PolicyCommitted(agentId, policyHash, block.timestamp);
    }

    function logDecision(bytes32 agentId, bytes32 requestId, uint8 outcome, bytes32 ruleId, uint256 amount) public onlyService {
        if (outcome > uint8(Outcome.Hold)) revert BadOutcome();
        emit Decision(agentId, requestId, outcome, ruleId, amount, currentPolicy[agentId]);
    }

    /// @notice Batch variant so the service can flush many small decisions in one tx.
    function logDecisions(
        bytes32 agentId,
        bytes32[] calldata requestIds,
        uint8[] calldata outcomes,
        bytes32[] calldata ruleIds,
        uint256[] calldata amounts
    ) external onlyService {
        uint256 n = requestIds.length;
        if (outcomes.length != n || ruleIds.length != n || amounts.length != n) revert LengthMismatch();
        for (uint256 i; i < n; ++i) logDecision(agentId, requestIds[i], outcomes[i], ruleIds[i], amounts[i]);
    }

    function setService(address _service) external onlyOwner {
        service = _service;
        emit ServiceChanged(_service);
    }

    function transferOwnership(address _owner) external onlyOwner {
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }
}
