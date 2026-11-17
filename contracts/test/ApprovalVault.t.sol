// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ApprovalVault, IERC20} from "../src/ApprovalVault.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public hook; // optional reentrancy attacker notified on transfer

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function setHook(address h) external { hook = h; }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        if (hook != address(0) && to == hook) Reenter(hook).onReceive();
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

interface Reenter { function onReceive() external; }

contract ReentrantRecipient is Reenter {
    ApprovalVault public vault;
    bytes32 public id;
    bool public reverted;
    constructor(ApprovalVault v) { vault = v; }
    function setId(bytes32 _id) external { id = _id; }
    function onReceive() external {
        try vault.refundExpired(id) { } catch { reverted = true; }
    }
}

contract ApprovalVaultTest is Test {
    MockUSDC usdc;
    ApprovalVault vault;
    address owner = makeAddr("owner");
    address service = makeAddr("service");
    address treasury = makeAddr("treasury");
    address seller = makeAddr("seller");
    address attacker = makeAddr("attacker");
    bytes32 constant ID = keccak256("req-1");
    uint256 constant AMT = 3_000_000; // $3.00

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ApprovalVault(IERC20(address(usdc)), owner, service, treasury);
        usdc.mint(treasury, 100_000_000);
        vm.prank(treasury);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _hold() internal {
        vm.prank(service);
        vault.hold(ID, seller, AMT, uint64(block.timestamp + 15 minutes));
    }

    function test_holdThenApprovePaysRecipient() public {
        _hold();
        assertEq(usdc.balanceOf(address(vault)), AMT);
        vm.prank(owner);
        vault.approve(ID);
        assertEq(usdc.balanceOf(seller), AMT);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_holdThenDenyRefundsTreasury() public {
        _hold();
        vm.prank(service);
        vault.deny(ID);
        assertEq(usdc.balanceOf(treasury), 100_000_000);
    }

    function test_onlyServiceCanHold() public {
        vm.prank(attacker);
        vm.expectRevert(ApprovalVault.NotAuthorized.selector);
        vault.hold(ID, seller, AMT, uint64(block.timestamp + 1));
    }

    function test_duplicateHoldReverts() public {
        _hold();
        vm.prank(service);
        vm.expectRevert(ApprovalVault.AlreadyExists.selector);
        vault.hold(ID, seller, AMT, uint64(block.timestamp + 60));
    }

    function test_badHoldParams() public {
        vm.startPrank(service);
        vm.expectRevert(ApprovalVault.BadParams.selector);
        vault.hold(ID, address(0), AMT, uint64(block.timestamp + 60));
        vm.expectRevert(ApprovalVault.BadParams.selector);
        vault.hold(ID, seller, 0, uint64(block.timestamp + 60));
        vm.expectRevert(ApprovalVault.BadParams.selector);
        vault.hold(ID, seller, AMT, uint64(block.timestamp));
        vm.expectRevert(ApprovalVault.BadParams.selector);
        vault.hold(ID, seller, AMT, uint64(block.timestamp + 2 days));
        vm.stopPrank();
    }

    function test_serviceCannotApprove() public {
        _hold();
        vm.prank(service);
        vm.expectRevert(ApprovalVault.NotOwner.selector);
        vault.approve(ID);
    }

    function test_attackerCannotApproveOrDeny() public {
        _hold();
        vm.startPrank(attacker);
        vm.expectRevert(ApprovalVault.NotOwner.selector);
        vault.approve(ID);
        vm.expectRevert(ApprovalVault.NotAuthorized.selector);
        vault.deny(ID);
        vm.stopPrank();
    }

    function test_doubleApproveReverts() public {
        _hold();
        vm.startPrank(owner);
        vault.approve(ID);
        vm.expectRevert(ApprovalVault.NotHeld.selector);
        vault.approve(ID);
        vm.stopPrank();
    }

    function test_approveAfterExpiryReverts() public {
        _hold();
        vm.warp(block.timestamp + 15 minutes);
        vm.prank(owner);
        vm.expectRevert(ApprovalVault.Expired.selector);
        vault.approve(ID);
    }

    function test_denyThenApproveReverts() public {
        _hold();
        vm.prank(owner);
        vault.deny(ID);
        vm.prank(owner);
        vm.expectRevert(ApprovalVault.NotHeld.selector);
        vault.approve(ID);
        assertEq(usdc.balanceOf(seller), 0);
    }

    function test_refundExpiredByAnyone() public {
        _hold();
        vm.prank(attacker);
        vm.expectRevert(ApprovalVault.NotExpired.selector);
        vault.refundExpired(ID);
        vm.warp(block.timestamp + 15 minutes);
        vm.prank(attacker);
        vault.refundExpired(ID);
        assertEq(usdc.balanceOf(treasury), 100_000_000);
        vm.expectRevert(ApprovalVault.NotHeld.selector);
        vault.refundExpired(ID);
    }

    function test_reentrancyOnReleaseIsBlocked() public {
        ReentrantRecipient evil = new ReentrantRecipient(vault);
        usdc.setHook(address(evil));
        bytes32 id2 = keccak256("req-2");
        evil.setId(id2);
        vm.startPrank(service);
        vault.hold(ID, address(evil), AMT, uint64(block.timestamp + 15 minutes));
        vault.hold(id2, seller, AMT, uint64(block.timestamp + 15 minutes));
        vm.stopPrank();
        vm.prank(owner);
        vault.approve(ID);
        assertTrue(evil.reverted(), "re-entrant call should revert");
        assertEq(usdc.balanceOf(address(vault)), AMT);
    }

    function testFuzz_holdAccounting(uint96 amount) public {
        amount = uint96(bound(amount, 1, 100_000_000));
        vm.prank(service);
        vault.hold(ID, seller, amount, uint64(block.timestamp + 60));
        vm.prank(service);
        vault.deny(ID);
        assertEq(usdc.balanceOf(treasury), 100_000_000);
    }
}

contract PolicyRegistryTest is Test {
    PolicyRegistry reg;
    address owner = makeAddr("owner");
    address service = makeAddr("service");

    event PolicyCommitted(bytes32 indexed agentId, bytes32 policyHash, uint256 timestamp);

    function setUp() public {
        reg = new PolicyRegistry(owner, service);
    }

    function test_commitAndLog() public {
        bytes32 agent = keccak256("research-agent");
        vm.expectEmit(true, false, false, true);
        emit PolicyCommitted(agent, bytes32(uint256(1)), block.timestamp);
        vm.prank(owner);
        reg.commitPolicy(agent, bytes32(uint256(1)));
        assertEq(reg.currentPolicy(agent), bytes32(uint256(1)));
        vm.prank(service);
        reg.logDecision(agent, keccak256("r"), 2, keccak256("approve"), 3_000_000);
    }

    function test_onlyOwnerCommits() public {
        vm.prank(service);
        vm.expectRevert(PolicyRegistry.NotOwner.selector);
        reg.commitPolicy(bytes32(0), bytes32(0));
    }

    function test_onlyServiceLogs() public {
        vm.prank(makeAddr("x"));
        vm.expectRevert(PolicyRegistry.NotService.selector);
        reg.logDecision(bytes32(0), bytes32(0), 0, bytes32(0), 0);
    }

    function test_badOutcomeAndBatch() public {
        vm.startPrank(service);
        vm.expectRevert(PolicyRegistry.BadOutcome.selector);
        reg.logDecision(bytes32(0), bytes32(0), 3, bytes32(0), 0);
        bytes32[] memory ids = new bytes32[](2);
        uint8[] memory outs = new uint8[](2);
        bytes32[] memory rules = new bytes32[](2);
        uint256[] memory amts = new uint256[](1);
        vm.expectRevert(PolicyRegistry.LengthMismatch.selector);
        reg.logDecisions(bytes32(0), ids, outs, rules, amts);
        vm.stopPrank();
    }
}
