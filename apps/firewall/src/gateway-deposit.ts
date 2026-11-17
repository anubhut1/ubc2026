// Operator script: move testnet USDC from the firewall-held buyer wallet into Circle Gateway,
// so x402 nanopayments can draw from it. Run once after funding the buyer at faucet.circle.com.
//   npm run deposit -w @agent-firewall/firewall -- 2      (deposits 2 USDC)
// API per @circle-fin/x402-batching@2.0.4 typings: new GatewayClient({chain, privateKey}).deposit(amount), getBalances().
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

const key = process.env.BUYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("Set BUYER_PRIVATE_KEY in .env");
const amount = process.argv[2] ?? "1";
const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key, rpcUrl: process.env.ARC_RPC_URL });
console.log("before:", (await gateway.getBalances()).gateway.formattedAvailable, "USDC available in Gateway");
const res = await gateway.deposit(amount);
console.log("deposit:", res);
console.log("after:", (await gateway.getBalances()).gateway.formattedAvailable, "USDC available in Gateway");
