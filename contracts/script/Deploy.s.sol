// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ApprovalVault, IERC20} from "../src/ApprovalVault.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";

/// forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --private-key $SERVICE_PRIVATE_KEY
/// Env: OWNER_ADDRESS (vault owner: releases held funds), USDC_ADDRESS, TREASURY_ADDRESS.
/// The deployer becomes the service AND the registry owner (so the firewall can commit policy
/// hashes). See README "Safety limits".
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        vm.startBroadcast();
        address service = msg.sender;
        PolicyRegistry registry = new PolicyRegistry(service, service);
        ApprovalVault vault = new ApprovalVault(IERC20(usdc), owner, service, treasury);
        vm.stopBroadcast();
        console.log("REGISTRY_ADDRESS=%s", address(registry));
        console.log("VAULT_ADDRESS=%s", address(vault));
    }
}
