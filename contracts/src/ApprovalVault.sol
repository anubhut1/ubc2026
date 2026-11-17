// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ApprovalVault
/// @notice Holds payments that need a human's OK.
///         - The firewall service holds funds pulled from the treasury (treasury pre-approves this vault).
///         - Only the OWNER (passkey-backed wallet) can release money to the recipient.
///         - The owner OR the service (acting on an SMS "NO") can deny, which refunds the treasury.
///         - Anyone can refund after expiry.
///         The asymmetry is deliberate: denying is always safe; releasing requires the owner.
/// @dev USDC is used through its 6-decimal ERC-20 interface only.
contract ApprovalVault {
    enum Status { None, Held, Released, Refunded }

    struct Hold {
        address recipient;
        uint96 amount; // 6-decimal USDC units; uint96 is plenty
        uint64 expiresAt;
        Status status;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public service;
    address public treasury;
    uint64 public constant MAX_HOLD = 1 days;

    mapping(bytes32 => Hold) public holds;
    uint256 private locked = 1;

    event Held(bytes32 indexed requestId, address indexed recipient, uint256 amount, uint64 expiresAt);
    event Released(bytes32 indexed requestId, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed requestId, address indexed to, uint256 amount, bool expired);
    event ServiceChanged(address service);
    event TreasuryChanged(address treasury);
    event OwnershipTransferred(address owner);

    error NotOwner();
    error NotAuthorized();
    error AlreadyExists();
    error NotHeld();
    error Expired();
    error NotExpired();
    error BadParams();
    error TransferFailed();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(IERC20 _usdc, address _owner, address _service, address _treasury) {
        usdc = _usdc;
        owner = _owner;
        service = _service;
        treasury = _treasury;
    }

    /// @notice Firewall service pulls `amount` from the treasury into escrow.
    function hold(bytes32 requestId, address recipient, uint256 amount, uint64 expiresAt) external nonReentrant {
        if (msg.sender != service) revert NotAuthorized();
        if (holds[requestId].status != Status.None) revert AlreadyExists();
        if (recipient == address(0) || amount == 0 || amount > type(uint96).max) revert BadParams();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_HOLD) revert BadParams();
        holds[requestId] = Hold(recipient, uint96(amount), expiresAt, Status.Held);
        if (!usdc.transferFrom(treasury, address(this), amount)) revert TransferFailed();
        emit Held(requestId, recipient, amount, expiresAt);
    }

    /// @notice Owner-only release to the recipient, before expiry.
    function approve(bytes32 requestId) external onlyOwner nonReentrant {
        Hold storage h = holds[requestId];
        if (h.status != Status.Held) revert NotHeld();
        if (block.timestamp >= h.expiresAt) revert Expired();
        h.status = Status.Released;
        if (!usdc.transfer(h.recipient, h.amount)) revert TransferFailed();
        emit Released(requestId, h.recipient, h.amount);
    }

    /// @notice Owner or service (on SMS "NO") cancels; funds go back to the treasury.
    function deny(bytes32 requestId) external nonReentrant {
        if (msg.sender != owner && msg.sender != service) revert NotAuthorized();
        _refund(requestId, false);
    }

    /// @notice Anyone can trigger the refund after expiry.
    function refundExpired(bytes32 requestId) external nonReentrant {
        if (block.timestamp < holds[requestId].expiresAt) revert NotExpired();
        _refund(requestId, true);
    }

    function _refund(bytes32 requestId, bool expired) internal {
        Hold storage h = holds[requestId];
        if (h.status != Status.Held) revert NotHeld();
        h.status = Status.Refunded;
        if (!usdc.transfer(treasury, h.amount)) revert TransferFailed();
        emit Refunded(requestId, treasury, h.amount, expired);
    }

    function setService(address _service) external onlyOwner {
        service = _service;
        emit ServiceChanged(_service);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
    }

    function transferOwnership(address _owner) external onlyOwner {
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }
}
