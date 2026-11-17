// Shared types for the Agent Firewall.
// All money is integer micro-USDC (6 decimals): $1.00 === 1_000_000.

export const CATEGORIES = ["data", "inference", "compute", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Period = "day" | "week" | "month";

/** What happens when a rule is violated. "hold" escalates to a human instead of blocking. */
export type Severity = "block" | "hold";

interface RuleBase {
  id: string;
  /** Overrides the default severity for this rule kind (see DEFAULT_SEVERITY). */
  onViolation?: Severity;
}

export type Rule =
  | (RuleBase & { kind: "perTxLimit"; maxMicro: number })
  | (RuleBase & { kind: "taskBudget"; taskId: string; maxMicro: number })
  | (RuleBase & { kind: "periodBudget"; period: Period; maxMicro: number })
  | (RuleBase & { kind: "categories"; allowed: Category[] })
  | (RuleBase & { kind: "allowlist"; recipients: string[] }) // addresses or x402 service ids
  | (RuleBase & { kind: "timeWindow"; days: number[]; startHour: number; endHour: number; tz: string })
  | (RuleBase & { kind: "rateLimit"; maxPerMinute: number; action: "pause" })
  | (RuleBase & { kind: "approvalThreshold"; aboveMicro: number })
  | (RuleBase & { kind: "paused" });

export type RuleKind = Rule["kind"];

export interface Policy {
  id: string;
  agentId: string;
  rules: Rule[];
  hash: `0x${string}`;
  committedTx?: string;
  createdAt: string;
}

export interface PaymentRequest {
  requestId: string;
  agentId: string;
  taskId: string;
  recipient: string;
  amountMicro: number;
  category: Category;
  /** The agent's stated reason. Logged, NEVER trusted for decisions. */
  purpose: string;
  /** e.g. "after response from sportsfeed.x402". Used only to flag possible injection. */
  sourceContext?: string;
}

export type Outcome = "allow" | "block" | "hold";

export interface Violation {
  ruleId: string;
  kind: RuleKind;
  severity: Severity;
  reason: string;
}

export interface Decision {
  requestId: string;
  outcome: Outcome;
  /** The rule that decided the outcome (first blocking violation, else first hold). */
  ruleId?: string;
  reason: string;
  violations: Violation[];
  /** True when a rateLimit rule fired and the agent must be paused. */
  triggerPause: boolean;
  /** Heuristic flags for the human (e.g. possible injection). Never used to allow. */
  flags: string[];
  at: string;
}

/** Spend state the evaluator needs. Computed by the store inside the same transaction as the reservation. */
export interface SpendState {
  /** Micro-USDC reserved or settled for this task (excludes released). */
  taskSpentMicro: number;
  /** Micro-USDC reserved or settled in the current calendar period (UTC). */
  periodSpentMicro: Record<Period, number>;
  /** Payment requests (any outcome) from this agent in the last 60s, excluding this one. */
  requestsLastMinute: number;
  /** Whether the agent is currently paused (emergency pause or rate-limit trip). */
  paused: boolean;
}
