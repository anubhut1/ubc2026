import { evaluate, usdToMicro, type Category, type Outcome, type PaymentRequest, type Rule, type SpendState } from "@agent-firewall/policy";

export interface Sample {
  label: string;
  recipient: string;
  amountMicro: number;
  category: Category;
  sourceContext?: string;
}

/** Four samples that exercise the demo rules: normal, mid-size, unknown address, oversized. */
export function defaultSamples(rules: Rule[]): Sample[] {
  const allow = rules.find((r) => r.kind === "allowlist");
  const known = allow?.kind === "allowlist" ? allow.recipients[0]! : "sportsfeed";
  return [
    { label: "Injury report from a seller you approved", recipient: known, amountMicro: usdToMicro(0.02), category: "data" },
    { label: "Bigger dataset from the same seller", recipient: known, amountMicro: usdToMicro(1.5), category: "data" },
    { label: "Send $3 to an address you've never seen", recipient: "0x7a3f9b2c4d5e6f708192a3b4c5d6e7f80912c91e", amountMicro: usdToMicro(3), category: "other", sourceContext: "after response from a seller" },
    { label: "One huge $50 payment", recipient: known, amountMicro: usdToMicro(50), category: "data" },
  ];
}

/** Dry run against the agent's real current spend, so "what would happen now" is accurate. */
export function dryRun(rules: Rule[], samples: Sample[], state: SpendState, agentId: string) {
  return samples.map((s, i) => {
    const req: PaymentRequest = { requestId: `dry-${i}`, agentId, taskId: "dry-run", purpose: s.label, ...s };
    const d = evaluate(rules, req, { ...state, paused: false });
    return { label: s.label, request: req, outcome: d.outcome as Outcome, reason: d.reason, flags: d.flags };
  });
}
