// Read-only aggregates for the owner dashboard: the agent list, today's money by state, an hourly series, and
// filtered activity. Everything comes from the existing agents / policies / requests / holds tables.
//
// Money states (never mix them up in the UI):
//   paid        status settled | approved. "settled" = the seller accepted the x402 payment through Circle Gateway;
//               Gateway batches the actual onchain settlement later, so this is NOT an Arc settlement tx.
//               "approved" = the owner released a held payment from the ApprovalVault.
//   inProgress  status reserved | unconfirmed. Allowed and counted against budgets, not confirmed paid.
//   held        status held. Waiting for the owner; counts against budgets until resolved.
//   stopped     status blocked | denied | expired. Never left (or came back to) the treasury.
//   released    failed before signing; the budget was given back. Not money spent.
import { periodStart, type Rule } from "@agent-firewall/policy";
import type { AuthConfig } from "./auth";
import type { DB } from "./db";
import { activePolicy, spendState } from "./engine";

const SUMS = `
  COALESCE(SUM(CASE WHEN status IN ('settled','approved') THEN amount_micro END),0) paid,
  COALESCE(SUM(CASE WHEN status IN ('reserved','unconfirmed') THEN amount_micro END),0) inProgress,
  COALESCE(SUM(CASE WHEN status='held' THEN amount_micro END),0) held,
  COALESCE(SUM(CASE WHEN status IN ('blocked','denied','expired') THEN amount_micro END),0) stopped,
  COALESCE(SUM(outcome='allow'),0) allowed,
  COALESCE(SUM(outcome='hold'),0) heldCount,
  COALESCE(SUM(outcome='block'),0) blocked,
  COALESCE(SUM(status='approved'),0) ownerApproved,
  COUNT(*) requests,
  COALESCE(SUM(anomalies_json <> '[]'),0) flagged,
  COALESCE(SUM(anomalies_json LIKE '%"severity":"high"%'),0) flaggedHigh`;

export interface Totals {
  paidMicro: number;
  inProgressMicro: number;
  heldMicro: number;
  stoppedMicro: number;
  counts: { requests: number; allowed: number; held: number; blocked: number; ownerApproved: number };
  anomalies: { flaggedRequests: number; high: number };
}

const toTotals = (r: any): Totals => ({
  paidMicro: Number(r?.paid ?? 0),
  inProgressMicro: Number(r?.inProgress ?? 0),
  heldMicro: Number(r?.held ?? 0),
  stoppedMicro: Number(r?.stopped ?? 0),
  counts: { requests: Number(r?.requests ?? 0), allowed: Number(r?.allowed ?? 0), held: Number(r?.heldCount ?? 0), blocked: Number(r?.blocked ?? 0), ownerApproved: Number(r?.ownerApproved ?? 0) },
  anomalies: { flaggedRequests: Number(r?.flagged ?? 0), high: Number(r?.flaggedHigh ?? 0) },
});

/** Today's (UTC day, same as the daily budget) money and counts for one agent. */
export function todayTotals(db: DB, agentId: string, now = new Date()): Totals {
  return toTotals(db.prepare(`SELECT ${SUMS} FROM requests WHERE agent_id=? AND created_ms >= ?`).get(agentId, periodStart("day", now).getTime()));
}

export interface SeriesBucket { start: string; paidMicro: number; inProgressMicro: number; stoppedMicro: number; paid: number; inProgress: number; stopped: number }

/** Hourly buckets ending at the current hour, aggregated in SQL (one indexed range scan). */
export function hourlySeries(db: DB, agentId: string, hours = 8, now = new Date()): SeriesBucket[] {
  const H = 3_600_000;
  const end = Math.ceil(now.getTime() / H) * H;
  const start = end - hours * H;
  const rows = db.prepare(`
    SELECT CAST((created_ms - ?) / ${H} AS INTEGER) b, -- node:sqlite binds JS numbers as REAL, so cast the bucket index
      COALESCE(SUM(CASE WHEN status IN ('settled','approved') THEN amount_micro END),0) paidMicro,
      COALESCE(SUM(CASE WHEN status IN ('reserved','unconfirmed','held') THEN amount_micro END),0) inProgressMicro,
      COALESCE(SUM(CASE WHEN status IN ('blocked','denied','expired') THEN amount_micro END),0) stoppedMicro,
      COALESCE(SUM(status IN ('settled','approved')),0) paid,
      COALESCE(SUM(status IN ('reserved','unconfirmed','held')),0) inProgress,
      COALESCE(SUM(status IN ('blocked','denied','expired')),0) stopped
    FROM requests WHERE agent_id=? AND created_ms >= ? AND created_ms < ? GROUP BY b`).all(start, agentId, start, end) as any[];
  const byBucket = new Map(rows.map((r) => [Number(r.b), r]));
  return Array.from({ length: hours }, (_, i) => {
    const r = byBucket.get(i);
    return {
      start: new Date(start + i * H).toISOString(),
      paidMicro: Number(r?.paidMicro ?? 0), inProgressMicro: Number(r?.inProgressMicro ?? 0), stoppedMicro: Number(r?.stoppedMicro ?? 0),
      paid: Number(r?.paid ?? 0), inProgress: Number(r?.inProgress ?? 0), stopped: Number(r?.stopped ?? 0),
    };
  });
}

const budgetOf = (rules: Rule[], taskId: string) => {
  const task = rules.find((r) => r.kind === "taskBudget" && (r.taskId === "*" || r.taskId === taskId));
  const day = rules.find((r) => r.kind === "periodBudget" && r.period === "day");
  return { taskMax: task?.kind === "taskBudget" ? task.maxMicro : null, dayMax: day?.kind === "periodBudget" ? day.maxMicro : null };
};

/** Every registered agent with status, today's money, remaining budgets, pending approvals and recent anomalies. */
export function listAgents(db: DB, auth: AuthConfig, now = new Date()) {
  const agents = db.prepare("SELECT * FROM agents ORDER BY created_at, id").all() as any[];
  const since = periodStart("day", now).getTime();
  const totals = new Map((db.prepare(`SELECT agent_id, ${SUMS} FROM requests WHERE created_ms >= ? GROUP BY agent_id`).all(since) as any[]).map((r) => [r.agent_id, toTotals(r)]));
  const pending = new Map((db.prepare("SELECT r.agent_id, COUNT(*) n FROM holds h JOIN requests r ON r.request_id=h.request_id WHERE h.status='held' GROUP BY r.agent_id").all() as any[]).map((r) => [r.agent_id, Number(r.n)]));
  const day = 24 * 3_600_000;
  const flagged = new Map((db.prepare("SELECT agent_id, COUNT(*) n, COALESCE(SUM(anomalies_json LIKE '%\"severity\":\"high\"%'),0) high FROM requests WHERE anomalies_json <> '[]' AND created_ms >= ? GROUP BY agent_id").all(now.getTime() - day) as any[]).map((r) => [r.agent_id, { requests: Number(r.n), high: Number(r.high) }]));
  return agents.map((a) => {
    const policy = activePolicy(db, a.id);
    const taskId = a.current_task ?? null;
    const state = spendState(db, a.id, taskId ?? "", now);
    const { taskMax, dayMax } = budgetOf(policy?.rules ?? [], taskId ?? "");
    return {
      id: a.id as string,
      name: a.name as string,
      status: a.status as "active" | "paused",
      pausedReason: (a.paused_reason as string | null) ?? null,
      currentTask: taskId as string | null,
      createdAt: a.created_at as string,
      hasPolicy: Boolean(policy),
      policyHash: policy?.hash ?? null,
      /** Whether the firewall has an agent token for this id (never the token itself). No token = it can't pay. */
      credentialConfigured: auth.agents.some((x) => x.agentId === a.id),
      today: totals.get(a.id) ?? toTotals(null),
      // Counts against budgets: paid + in progress + held (the same ledger sums the policy engine uses).
      budget: {
        daySpentMicro: state.periodSpentMicro.day,
        dayCapMicro: dayMax,
        dayAvailableMicro: dayMax === null ? null : Math.max(0, dayMax - state.periodSpentMicro.day),
        taskSpentMicro: taskId ? state.taskSpentMicro : 0,
        taskBudgetMicro: taskMax,
        taskAvailableMicro: taskMax === null ? null : Math.max(0, taskMax - (taskId ? state.taskSpentMicro : 0)),
      },
      pendingApprovals: pending.get(a.id) ?? 0,
      anomalies24h: flagged.get(a.id) ?? { requests: 0, high: 0 },
    };
  });
}

const STATUS_GROUPS: Record<string, string[]> = {
  paid: ["settled", "approved"],
  pending: ["reserved", "unconfirmed"],
  held: ["held"],
  blocked: ["blocked"],
  returned: ["released", "denied", "expired"],
};
export const ACTIVITY_STATUS_GROUPS = Object.keys(STATUS_GROUPS);

/** WHERE clause + args for /v1/activity. agentId "all" = every agent. Unknown status groups are ignored. */
export function activityFilter(q: URLSearchParams): { where: string; args: (string | number)[]; limit: number } {
  const conds: string[] = [];
  const args: (string | number)[] = [];
  const agentId = q.get("agentId") ?? "research-agent"; // historical default, kept for old callers
  const add = (cond: string, ...values: (string | number)[]) => {
    conds.push(cond);
    args.push(...values);
  };
  if (agentId !== "all") add("r.agent_id=?", agentId);
  if (q.get("filter") === "blocked") add("r.outcome IN ('block','hold')");
  const group = STATUS_GROUPS[q.get("status") ?? ""];
  if (group) add(`r.status IN (${group.map(() => "?").join(",")})`, ...group);
  if (q.get("anomalies") === "1") add("r.anomalies_json <> '[]'");
  const requestId = q.get("requestId");
  if (requestId) add("r.request_id=?", requestId);
  const limit = Math.max(1, Math.min(500, Number(q.get("limit") ?? 200) || 200));
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", args, limit };
}
