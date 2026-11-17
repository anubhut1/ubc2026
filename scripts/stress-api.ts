// Live stress checks against a running firewall (no money moves: nothing here is signed or settled).
//   npx tsx scripts/stress-api.ts            (FIREWALL_URL defaults to http://localhost:4000)
// 1. Race: 20 concurrent $0.80 requests with $1.00 of task budget -> exactly 1 allowed, never over budget.
// 2. Idempotency: the same requestId evaluated 10x concurrently -> one reservation.
// 3. Failure before signing: markFailed releases the reservation.
// 4. Signing a request that was blocked/held is refused.
import { randomUUID } from "node:crypto";

const FW = process.env.FIREWALL_URL ?? "http://localhost:4000";
const post = async (path: string, body: unknown) => {
  const r = await fetch(FW + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const get = async (path: string) => (await (await fetch(FW + path)).json()) as any;

const results: { test: string; pass: boolean; detail: string }[] = [];
const check = (test: string, pass: boolean, detail: string) => results.push({ test, pass, detail });

const agentId = `stress-${Date.now().toString(36)}`;
const taskId = "t1";
await post("/v1/policy", {
  agentId, confirmed: true,
  rules: [{ id: "task-budget", kind: "taskBudget", taskId: "*", maxMicro: 1_000_000 }, { id: "approved-recipients", kind: "allowlist", recipients: ["oddsapi"] }],
});
const req = (id: string, amountMicro: number) => ({ requestId: id, agentId, taskId, recipient: "oddsapi", amountMicro, category: "data", purpose: "stress" });

// 1. Race
const ids = Array.from({ length: 20 }, () => `req_${randomUUID()}`);
const decisions = await Promise.all(ids.map((id) => post("/v1/payments/evaluate", req(id, 800_000))));
const allowed = decisions.filter((d) => d.body.outcome === "allow");
const spent = (await get(`/v1/agents/${agentId}/summary`)).task.spentMicro;
check("Race: 20 × $0.80 vs $1.00 budget", allowed.length === 1 && spent <= 1_000_000, `${allowed.length} allowed, ${decisions.length - allowed.length} blocked, reserved $${(spent / 1e6).toFixed(2)}`);

// 3. Failure before signing releases the budget
const winner = ids[decisions.findIndex((d) => d.body.outcome === "allow")]!;
await post(`/v1/payments/${winner}/failed`, {});
const afterFail = (await get(`/v1/agents/${agentId}/summary`)).task.spentMicro;
check("Failure (unsigned) releases reservation", afterFail === 0, `reserved after failure: $${(afterFail / 1e6).toFixed(2)}`);

// 2. Idempotency: same requestId 10x concurrently
const dup = `req_${randomUUID()}`;
const dupRes = await Promise.all(Array.from({ length: 10 }, () => post("/v1/payments/evaluate", req(dup, 300_000))));
const dupSpent = (await get(`/v1/agents/${agentId}/summary`)).task.spentMicro;
const sameOutcome = new Set(dupRes.map((d) => d.body.outcome)).size === 1;
check("Idempotency: same requestId × 10", dupSpent === 300_000 && sameOutcome, `reserved $${(dupSpent / 1e6).toFixed(2)} once; outcomes identical: ${sameOutcome}`);

// 4. Signing a blocked request is refused
const blockedId = ids[decisions.findIndex((d) => d.body.outcome === "block")]!;
const { mode } = await get("/v1/signer");
const sign = mode === "circle-agent-wallet"
  ? await post(`/v1/payments/${blockedId}/pay`, { url: `${process.env.SELLERS_URL ?? "http://localhost:4200"}/oddsapi/odds/bulk` })
  : await post(`/v1/payments/${blockedId}/sign`, { typedData: {} });
check(`Payer (${mode}) refuses a blocked request`, sign.status >= 400, `HTTP ${sign.status}: ${sign.body.error}`);

console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
