import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { policyHash, type Rule } from "@agent-firewall/policy";

const SELLER = privateKeyToAccount(generatePrivateKey()).address;
const ATTACKER = privateKeyToAccount(generatePrivateKey()).address;
const KEY = generatePrivateKey();
process.env.BUYER_PRIVATE_KEY = KEY;
process.env.SELLER_ADDRESSES = `sportsfeed=${SELLER}`;

const { openDb } = await import("../src/db");
const { evaluateAndReserve, savePolicy } = await import("../src/engine");
const { signForRequest } = await import("../src/signer");

const db = openDb(join(mkdtempSync(join(tmpdir(), "sig-")), "s.db"));
const rules: Rule[] = [
  { id: "task", kind: "taskBudget", taskId: "*", maxMicro: 10_000_000 },
  { id: "allow", kind: "allowlist", recipients: ["sportsfeed"] },
];
const requirements = (payTo: string, amount: string) => ({
  scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount, payTo, maxTimeoutSeconds: 345600,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
});
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
let captured: any;
const remoteScheme = (requestId: string) =>
  new BatchEvmScheme({
    address: privateKeyToAccount(KEY).address,
    signTypedData: async (td) => {
      captured = td;
      return signForRequest(db, requestId, json(td)); // what crosses the wire is JSON
    },
  });
const ask = (id: string, amountMicro: number) =>
  evaluateAndReserve(db, { requestId: id, agentId: "a", taskId: "t", recipient: "sportsfeed", amountMicro, category: "data", purpose: "x" }).decision.outcome;

beforeAll(() => savePolicy(db, "a", rules, policyHash(rules)));

describe("firewall signer (real BatchEvmScheme)", () => {
  it("signs an allowed payment and the signature recovers to the buyer", async () => {
    expect(ask("ok", 20_000)).toBe("allow");
    const p = await remoteScheme("ok").createPaymentPayload(2, requirements(SELLER, "20000"));
    const addr = await recoverTypedDataAddress({ ...captured, signature: (p.payload as any).signature });
    expect(addr).toBe(privateKeyToAccount(KEY).address);
  });
  it("refuses a second signature for the same request", async () => {
    await expect(remoteScheme("ok").createPaymentPayload(2, requirements(SELLER, "20000"))).rejects.toThrow(/already signed/);
  });
  it("refuses when payTo is swapped (injection redirect)", async () => {
    expect(ask("swap", 20_000)).toBe("allow");
    await expect(remoteScheme("swap").createPaymentPayload(2, requirements(ATTACKER, "20000"))).rejects.toThrow(/Payee/);
  });
  it("refuses when the amount differs from what was approved", async () => {
    expect(ask("amt", 20_000)).toBe("allow");
    await expect(remoteScheme("amt").createPaymentPayload(2, requirements(SELLER, "2000000"))).rejects.toThrow(/Amount/);
  });
  it("refuses requests that weren't allowed", async () => {
    await expect(remoteScheme("never-asked").createPaymentPayload(2, requirements(SELLER, "20000"))).rejects.toThrow(/Unknown request/);
  });
});
