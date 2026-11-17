# Firewall HTTP API (apps/firewall, default `http://localhost:4000`)

All money is **integer micro-USDC** (`$1.00 = 1_000_000`). Use `formatUsd` from `@agent-firewall/policy` to display.
All responses are JSON. Errors: `{ "error": string }` with 4xx/5xx.
CORS is open to `APP_BASE_URL` in dev.

Demo agent id: `research-agent`. Demo task id: `nba-injuries`.

## Types

```ts
type ActivityItem = {
  requestId: string; at: string;                       // ISO
  outcome: "allow" | "block" | "hold";
  status: "reserved" | "settled" | "released" | "held" | "approved" | "denied" | "expired" | "blocked";
  amountMicro: number; recipient: string; category: string; taskId: string;
  ruleId: string | null; reason: string;               // plain English
  sentence: string;                                    // e.g. "Bought an injury report, $0.02"
  purpose: string; flags: string[];
  arcTx: string | null; arcTxUrl: string | null;       // explorer link when logged onchain
};

type HeldPayment = {
  requestId: string; token?: string;                   // token only returned to the owner UI in dev
  amountMicro: number; recipient: string; reason: string; flags: string[];
  createdAt: string; expiresAt: string;
  status: "held" | "approved" | "denied" | "expired";
  holdTx: string | null; holdTxUrl: string | null;
};

type RuleView = { ruleId: string; kind: string; sentence: string; enforcedBy: string };
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/v1/agents/:agentId/summary` | | `{ agent: {id, name, status: "active"\|"paused", pausedReason}, task: {id, spentMicro, budgetMicro\|null}, today: {spentMicro, capMicro\|null}, pending: HeldPayment[], recent: ActivityItem[] (10), rules: RuleView[], policy: {hash, committedTx, committedTxUrl, createdAt} \| null }` |
| POST | `/v1/agents/:agentId/pause` | `{reason?}` | `{ status: "paused" }` |
| POST | `/v1/agents/:agentId/resume` | | `{ status: "active" }` |
| GET | `/v1/activity?agentId=&filter=all\|blocked&limit=` | | `{ items: ActivityItem[] }` (newest first) |
| POST | `/v1/rules/compile` | `{ text }` | `{ rules: Rule[], views: RuleView[], ambiguities: {phrase, question}[], model: string }` |
| POST | `/v1/rules/dry-run` | `{ agentId, rules, samples? }` | `{ results: { label, request, outcome, reason }[] }` (4 default samples) |
| GET | `/v1/policy/:agentId` | | `{ policy, views: RuleView[], notify }` |
| POST | `/v1/policy` | `{ agentId, rules, notify?: { phone, events: ("hold"\|"budget80"\|"paused")[] }, confirmed: true }` | `{ policy }` — commits hash to Arc PolicyRegistry when configured |
| GET | `/v1/approvals/:token` | | `HeldPayment & { agentName }` |
| POST | `/v1/approvals/:token/deny` | | `{ status: "denied", refundTx }` |
| POST | `/v1/approvals/:token/approve/options` | | WebAuthn assertion options |
| POST | `/v1/approvals/:token/approve` | `{ assertion }` | `{ status: "approved", releaseTx }` |
| POST | `/v1/payments/evaluate` | `PaymentRequest` | `Decision & { holdToken? }` (agent-facing) |
| POST | `/v1/payments/:requestId/settled` | `{ txHash? }` | `{ ok }` |
| POST | `/v1/payments/:requestId/failed` | | `{ ok }` — releases the reservation |
| POST | `/v1/twilio/inbound` | Twilio form post | TwiML |
| GET | `/health` | | `{ ok, arc: bool, twilio: bool, llm: bool }` |

Live updates: the web app polls `summary` / `activity` every 2s.
