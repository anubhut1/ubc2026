// Live stress checks against a running firewall (no money moves: nothing here is signed or settled).
//   FIREWALL_OWNER_TOKEN=… FIREWALL_AGENT_TOKEN=… npx tsx scripts/stress-api.ts   (FIREWALL_URL defaults to http://localhost:4000)
//   FIREWALL_AGENT_TOKEN must be the token for STRESS_AGENT_ID (default "stress-agent") in the firewall's FIREWALL_AGENT_TOKENS.
// 1. Race: 20 concurrent $0.80 requests with $1.00 of task budget -> exactly 1 allowed, never over budget.
// 2. Idempotency: the same requestId evaluated 10x concurrently -> one reservation.
// 3. Failure before signing: markFailed releases the reservation.
// 4. Signing a request that was blocked/held is refused.
import { randomUUID } from "node:crypto";

const FW = process.env.FIREWALL_URL ?? "http://localhost:4000";
const bearer = (t: string | undefined): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const OWNER = bearer(process.env.FIREWALL_OWNER_TOKEN);
const AGENT = bearer(process.env.FIREWALL_AGENT_TOKEN);
const post = async (path: string, body: unknown, auth = AGENT) => {
  const r = await fetch(FW + path, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const get = async (path: string) => (await (await fetch(FW + path, { headers: OWNER })).json()) as any;

const results: { test: string; pass: boolean; detail: string }[] = [];
const check = (test: string, pass: boolean, detail: string) => results.push({ test, pass, detail });

// A token is bound to one agent id, so the agent is fixed; a fresh task per run gives a full task budget.
const agentId = process.env.STRESS_AGENT_ID ?? "stress-agent";
const taskId = `t-${Date.now().toString(36)}`;
const saved = await post("/v1/policy", {
  agentId, confirmed: true,
  rules: [{ id: "task-budget", kind: "taskBudget", taskId: "*", maxMicro: 1_000_000 }, { id: "approved-recipients", kind: "allowlist", recipients: ["oddsapi"] }],
}, OWNER);
if (saved.status !== 200) throw new Error(`Saving rules failed (HTTP ${saved.status}: ${saved.body.error}). Set FIREWALL_OWNER_TOKEN.`);
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
