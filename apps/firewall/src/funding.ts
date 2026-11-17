// Buyer exposure cap: the fallback for Circle Agent Wallet policies, which are mainnet-only (docs/RESEARCH.md Q9).
// The buyer key only ever controls a small amount:
//   - Its Gateway balance is topped up from the TREASURY with depositFor(), at most DAILY_CAP per UTC day
//     (ledger in gateway_topups; the ledger, not the observed balance, is what bounds the daily total).
//   - USDC in the buyer wallet above a small gas reserve is swept back to the treasury.
// A leaked buyer key therefore exposes at most ~DAILY_CAP + the gas reserve, independent of the firewall's rules.
// API per @circle-fin/x402-batching@2.0.4 typings: GatewayClient.getBalances(), depositFor(amount, depositor).
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import type { DB } from "./db";
import { arcPublicClient, arcTestnet, serialized, usdcAddress } from "./arc";

const DAILY_CAP = Math.round(Number(process.env.GATEWAY_DAILY_TOPUP_USDC ?? 5) * 1e6);
const GAS_RESERVE = Math.round(Number(process.env.BUYER_GAS_RESERVE_USDC ?? 0.5) * 1e6);
const MIN_MOVE = 10_000; // ignore dust under $0.01

const buyerKey = process.env.BUYER_PRIVATE_KEY as Hex | undefined;
const treasuryKey = config.arc.servicePrivateKey;
const enabled = Boolean(buyerKey && treasuryKey) && process.env.MOCK_PAYMENTS !== "1" && process.env.FUNDING !== "off";

const buyer = enabled ? new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey!, rpcUrl: config.arc.rpcUrl }) : null;
const treasury = enabled ? new GatewayClient({ chain: "arcTestnet", privateKey: treasuryKey!, rpcUrl: config.arc.rpcUrl }) : null;
const buyerAccount = buyerKey ? privateKeyToAccount(buyerKey) : null;
const treasuryAddress = treasuryKey ? privateKeyToAccount(treasuryKey).address : null;

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const toUsd = (micro: number | bigint) => (Number(micro) / 1e6).toFixed(2);

export function depositedToday(db: DB): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount_micro),0) AS s FROM gateway_topups WHERE day=?").get(utcDay()) as { s: number };
  return r.s;
}

export async function fundingStatus(db: DB) {
  if (!buyer) return { enabled: false as const };
  const b = await buyer.getBalances();
  return {
    enabled: true as const,
    dailyCapUsdc: DAILY_CAP / 1e6,
    depositedTodayUsdc: depositedToday(db) / 1e6,
    gatewayAvailableUsdc: Number(b.gateway.available) / 1e6,
    buyerWalletUsdc: Number(b.wallet.balance) / 1e6,
    gasReserveUsdc: GAS_RESERVE / 1e6,
  };
}

/** Bring the buyer's Gateway balance up toward DAILY_CAP, never depositing more than DAILY_CAP per UTC day. */
export async function topUpGateway(db: DB): Promise<{ deposited: number; tx: string | null }> {
  if (!buyer || !treasury || !buyerAccount) return { deposited: 0, tx: null };
  const available = Number((await buyer.getBalances()).gateway.available);
  const room = DAILY_CAP - depositedToday(db);
  const amount = Math.min(DAILY_CAP - available, room);
  if (amount < MIN_MOVE) return { deposited: 0, tx: null };
  // Record first (pessimistic): a failed deposit removes its row; a crash mid-deposit can only under-fund, never over-fund.
  const row = db.prepare("INSERT INTO gateway_topups (day, amount_micro, created_at) VALUES (?,?,?)").run(utcDay(), amount, new Date().toISOString());
  try {
    // Same queue as the vault/registry txs: the treasury is the service key.
    const res = await serialized(treasuryAddress!, () => treasury.depositFor(toUsd(amount), buyerAccount.address));
    db.prepare("UPDATE gateway_topups SET tx=? WHERE id=?").run(res.depositTxHash, row.lastInsertRowid);
    console.log(`[funding] topped up buyer Gateway by $${toUsd(amount)} (tx ${res.depositTxHash})`);
    return { deposited: amount, tx: res.depositTxHash };
  } catch (e) {
    db.prepare("DELETE FROM gateway_topups WHERE id=?").run(row.lastInsertRowid);
    throw e;
  }
}

const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

/** Move buyer-wallet USDC above the gas reserve back to the treasury, so the buyer key can't reach it. */
export async function sweepBuyerWallet(): Promise<{ swept: number; tx: string | null }> {
  if (!enabled || !buyerAccount || !treasuryAddress) return { swept: 0, tx: null };
  const usdc = await usdcAddress();
  if (!usdc) return { swept: 0, tx: null };
  const bal = Number(await arcPublicClient.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [buyerAccount.address] }));
  const amount = bal - GAS_RESERVE;
  if (amount < MIN_MOVE) return { swept: 0, tx: null };
  const wallet = createWalletClient({ chain: arcTestnet, transport: http(config.arc.rpcUrl), account: buyerAccount });
  const hash = await serialized(buyerAccount.address, () =>
    wallet.writeContract({ address: usdc, abi: erc20, functionName: "transfer", args: [treasuryAddress, BigInt(amount)], chain: arcTestnet, account: buyerAccount }),
  );
  const receipt = await arcPublicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`sweep reverted: ${hash}`);
  console.log(`[funding] swept $${toUsd(amount)} from buyer wallet to treasury (tx ${hash})`);
  return { swept: amount, tx: hash };
}
