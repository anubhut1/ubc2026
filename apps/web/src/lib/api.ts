import type { Rule } from "@agent-firewall/policy";

export const FIREWALL_URL = (process.env.NEXT_PUBLIC_FIREWALL_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const AGENT_ID = "research-agent";
// TODO(verify): Arc explorer base URL (HANDOFF §10). Only used if the API returns a tx hash without a URL.
export const ARC_EXPLORER = (process.env.NEXT_PUBLIC_ARC_EXPLORER ?? "https://explorer.testnet.arc.io").replace(/\/$/, "");

export type Outcome = "allow" | "block" | "hold";

export type ActivityItem = {
  requestId: string;
  at: string;
  outcome: Outcome;
  status: string;
  amountMicro: number;
  recipient: string;
  category: string;
  taskId: string;
  ruleId: string | null;
  reason: string;
  sentence: string;
  purpose: string;
  flags: string[];
  arcTx: string | null;
  arcTxUrl: string | null;
};

export type HeldPayment = {
  requestId: string;
  token?: string;
  amountMicro: number;
  recipient: string;
  reason: string;
  flags: string[];
  createdAt: string;
  expiresAt: string;
  status: "held" | "approved" | "denied" | "expired";
  holdTx: string | null;
  holdTxUrl: string | null;
  /** Why the Arc escrow failed; null when it succeeded or Arc isn't configured. */
  holdError?: string | null;
  resolveTx?: string | null;
  resolveTxUrl?: string | null;
};

export type RuleView = { ruleId: string; kind: string; sentence: string; enforcedBy: string };
export type Ambiguity = { phrase: string; question: string };
export type DryRunResult = { label: string; request: unknown; outcome: Outcome; reason: string };
export type NotifyEvent = "hold" | "budget80" | "paused";

export type PolicyInfo = {
  hash: string;
  committedTx?: string | null;
  committedTxUrl?: string | null;
  createdAt?: string;
};

export type Summary = {
  agent: { id: string; name: string; status: "active" | "paused"; pausedReason: string | null };
  task: { id: string; spentMicro: number; budgetMicro: number | null };
  today: { spentMicro: number; capMicro: number | null };
  pending: HeldPayment[];
  recent: ActivityItem[];
  rules: RuleView[];
  policy: PolicyInfo | null;
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Fetch JSON from the firewall. Network failures become ApiError(status 0) so the UI can show a friendly state. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(FIREWALL_URL + path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach the firewall right now.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((data && typeof data.error === "string" && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export function txUrl(tx: string | null | undefined, url?: string | null): string | null {
  if (url) return url;
  return tx ? `${ARC_EXPLORER}/tx/${tx}` : null;
}

export type { Rule };
