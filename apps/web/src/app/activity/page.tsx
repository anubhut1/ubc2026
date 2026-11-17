"use client";
import { useState } from "react";
import { formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, api, txUrl, type ActivityItem } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { Callout, ErrorState, OutcomeBadge, VerifyLink, shortAddr, shortTime } from "@/components";

export default function Activity() {
  const [filter, setFilter] = useState<"all" | "blocked">("all");
  const { data, error, refresh } = usePoll(
    () => api<{ items: ActivityItem[] }>(`/v1/activity?agentId=${AGENT_ID}&filter=${filter}&limit=100`),
    2000,
  );
  // Avoid showing stale rows from the other filter while the new one loads.
  const items = data?.items.filter((i) => filter === "all" || i.outcome !== "allow") ?? null;

  return (
    <>
      <div className="row">
        <h1>Activity</h1>
        <div className="filters" role="group" aria-label="Filter">
          <button className="btn secondary" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          <button className="btn secondary" aria-pressed={filter === "blocked"} onClick={() => setFilter("blocked")}>Blocked only</button>
        </div>
      </div>
      {error && <ErrorState error={error} onRetry={refresh} />}
      {!items && !error && <p className="muted" role="status">Loading…</p>}
      {items && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Decision</th><th>Amount</th><th>Recipient</th><th>Rule</th><th>Detail</th><th>Arc</th></tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className="muted">Nothing to show.</td></tr>}
              {items.map((a) => (
                <tr key={a.requestId}>
                  <td className="mono">{shortTime(a.at)}</td>
                  <td><OutcomeBadge outcome={a.outcome} /></td>
                  <td className="mono">{formatUsd(a.amountMicro)}</td>
                  <td className="mono" title={a.recipient}>{shortAddr(a.recipient)}</td>
                  <td>{a.ruleId ?? "—"}</td>
                  <td>{a.reason}</td>
                  <td>{a.arcTx || a.arcTxUrl ? <span className="table-verify"><VerifyLink href={txUrl(a.arcTx, a.arcTxUrl)}>verify</VerifyLink></span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="two" aria-label="How to read this">
        <Callout title="Two payments at once, one dollar left">
          If two requests arrive together and only one fits, we reserve the money for the first and block the second. They can&apos;t both slip through.
        </Callout>
        <Callout tone="attention" title="A seller told the agent to send $50">
          Text hidden in a seller&apos;s reply can try to hijack your agent. We never trust the agent&apos;s reasons. The payment is checked against your rules, held, and you decide.
        </Callout>
      </section>
    </>
  );
}
