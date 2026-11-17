// Operator script: show the firewall-held buyer's wallet and Gateway balances.
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
const g = new GatewayClient({ chain: "arcTestnet", privateKey: process.env.BUYER_PRIVATE_KEY as Hex, rpcUrl: process.env.ARC_RPC_URL });
const b = await g.getBalances();
console.log(`wallet ${b.wallet.formatted} USDC · gateway available ${b.gateway.formattedAvailable} (total ${b.gateway.formattedTotal})`);
