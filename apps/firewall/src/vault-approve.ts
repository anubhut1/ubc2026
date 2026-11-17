// Let the ApprovalVault pull up to N USDC from the treasury (hold() uses transferFrom, and every hold uses
// allowance even when refunded). Testnet: npm run vault:approve -w @agent-firewall/firewall -- 20
import { createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcPublicClient, arcTestnet, serialized, usdcAddress } from "./arc";
import { config } from "./config";

const amount = process.argv[2] ?? "20";
if (!config.arc.servicePrivateKey || !config.arc.vaultAddress) throw new Error("SERVICE_PRIVATE_KEY and VAULT_ADDRESS are required.");
const account = privateKeyToAccount(config.arc.servicePrivateKey);
const usdc = await usdcAddress();
if (!usdc) throw new Error("Couldn't read the vault's USDC address.");
const w = createWalletClient({ chain: arcTestnet, transport: http(config.arc.rpcUrl), account });
const hash = await serialized(account.address, () =>
  w.writeContract({ address: usdc, abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [config.arc.vaultAddress!, parseUnits(amount, 6)], chain: arcTestnet, account }),
);
const r = await arcPublicClient.waitForTransactionReceipt({ hash });
console.log(`approve ${amount} USDC for the vault: ${r.status} (tx ${hash})`);
