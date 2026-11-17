"use client";
import { useState } from "react";
import { AGENT_ID, api, txUrl, type ActivityItem } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { Callout, ErrorState, Money, OutcomeBadge, SellerTile, VerifyLink, shortAddr, shortTime } from "@/components";

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
      <header className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="sub">Every payment your agent asked for, what we decided, and the proof on Arc.</p>
        </div>
        <div className="segmented" role="group" aria-label="Filter">
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          <button aria-pressed={filter === "blocked"} onClick={() => setFilter("blocked")}>Stopped or held</button>
        </div>
      </header>
      {error && <ErrorState error={error} onRetry={refresh} />}
      {!items && !error && <p className="muted" role="status">Loading…</p>}
      {items && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Status</th><th>Recipient</th><th>Why</th><th className="r">Amount</th><th className="r">Proof</th></tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={6} className="muted">Nothing to show.</td></tr>}
              {items.map((a) => (
                <tr key={a.requestId}>
                  <td className="muted num" style={{ whiteSpace: "nowrap" }}>{shortTime(a.at)}</td>
                  <td><OutcomeBadge outcome={a.outcome} status={a.status} /></td>
                  <td title={a.recipient}><span className="who"><SellerTile recipient={a.recipient} size="sm" /><span className={/^0x/i.test(a.recipient) ? "mono" : ""}>{shortAddr(a.recipient)}</span></span></td>
                  <td><span className="reason">{a.reason}</span>{a.flags.some((f) => /injection/i.test(f)) && <><br /><span className="chip warn" style={{ marginTop: 6 }}>Possible injection</span></>}</td>
                  <td className="r"><Money micro={a.amountMicro} /></td>
                  <td className="r">{a.arcTx || a.arcTxUrl ? <VerifyLink href={txUrl(a.arcTx, a.arcTxUrl)}>Arc</VerifyLink> : <span className="faint">—</span>}</td>
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
        <Callout tone="attention" title="A seller told the agent to send $3">
          Text hidden in a seller&apos;s reply can try to hijack your agent. We never trust the agent&apos;s reasons. The payment is checked against your rules, held, and you decide.
        </Callout>
      </section>
    </>
  );
}
