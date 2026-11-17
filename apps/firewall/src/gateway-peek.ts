// Read-only: Gateway balances for any addresses (npm run peek -w @agent-firewall/firewall -- 0xA 0xB).
import "./network";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Address, Hex } from "viem";
import { config } from "./config";
const g = new GatewayClient({ chain: "arcTestnet", privateKey: config.arc.servicePrivateKey as Hex, rpcUrl: config.arc.rpcUrl });
for (const a of process.argv.slice(2)) {
  const b = await g.getBalances(a as Address);
  console.log(a, JSON.stringify(b.gateway, (_, v) => (typeof v === "bigint" ? Number(v) / 1e6 : v)));
}
