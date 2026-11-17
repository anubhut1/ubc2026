"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, api, txUrl, type Summary } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { ErrorState, VerifyLink, shortTime } from "@/components";

export default function Home() {
  const { data, error, refresh } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 2000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!data) {
    return error ? <ErrorState error={error} onRetry={refresh} /> : <p className="muted" role="status">Loading…</p>;
  }

  const paused = data.agent.status === "paused";
  async function toggle() {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/v1/agents/${AGENT_ID}/${paused ? "resume" : "pause"}`, { method: "POST", body: {} });
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't update the agent.");
    } finally {
      setBusy(false);
    }
  }

  const { task, today, pending, recent, rules, policy } = data;
  const pct = (spent: number, cap: number | null) => (cap ? Math.min(100, (spent / cap) * 100) : 0);
  const taskLeft = task.budgetMicro !== null ? Math.max(0, task.budgetMicro - task.spentMicro) : null;
  const dayLeft = today.capMicro !== null ? Math.max(0, today.capMicro - today.spentMicro) : null;
  const policyUrl = policy ? txUrl(policy.committedTx, policy.committedTxUrl) : null;

  return (
    <>
      {error && <ErrorState error={error} onRetry={refresh} />}
      <section className="row" aria-label="Agent status">
        <div>
          <h1>{data.agent.name}</h1>
          <p className="status">
            <span className={`dot ${paused ? "paused" : ""}`} aria-hidden="true" />
            {paused ? `Paused${data.agent.pausedReason ? ` · ${data.agent.pausedReason}` : ""}` : "Working within your rules"}
          </p>
        </div>
        <button className={`btn ${paused ? "" : "attention secondary"}`} onClick={toggle} disabled={busy}>
          {paused ? "Resume agent" : "Pause agent"}
        </button>
      </section>
      {actionError && <p role="alert" style={{ color: "var(--orange)" }}>{actionError}</p>}

      <section className="cards" aria-label="Spending">
        <div className="card">
          <span className="label">Spent on this task</span>
          <span className="big">{formatUsd(task.spentMicro)}</span>
          <span className="muted">{task.budgetMicro !== null ? `of ${formatUsd(task.budgetMicro)}` : "No task budget set"}</span>
          {task.budgetMicro !== null && <div className="bar"><span style={{ width: `${pct(task.spentMicro, task.budgetMicro)}%` }} /></div>}
          {taskLeft !== null && <span className="muted">{formatUsd(taskLeft)} left</span>}
        </div>
        <div className="card">
          <span className="label">Can still spend today</span>
          <span className="big">{dayLeft !== null ? formatUsd(dayLeft) : "No daily cap"}</span>
          <span className="muted">{today.capMicro !== null ? `${formatUsd(today.spentMicro)} of ${formatUsd(today.capMicro)} used` : `${formatUsd(today.spentMicro)} spent`}</span>
          {today.capMicro !== null && <div className="bar"><span style={{ width: `${pct(today.spentMicro, today.capMicro)}%` }} /></div>}
        </div>
        <div className={`card ${pending.length ? "attention" : ""}`}>
          <span className="label">Waiting for you</span>
          {pending.length === 0 ? (
            <span className="muted">Nothing is waiting.</span>
          ) : (
            pending.map((p) => (
              <div key={p.requestId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="big">{formatUsd(p.amountMicro)}</span>
                <span>{p.reason}</span>
                {p.token ? (
                  <Link className="btn attention" href={`/a/${p.token}`}>Review</Link>
                ) : (
                  <span className="muted">Open the link we texted you to review.</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="feed">
        <h2 id="feed">What your agent did</h2>
        {recent.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="list">
            {recent.map((a) => (
              <li key={a.requestId} className={a.outcome === "allow" ? "" : "warn"}>
                <span className="what">{a.sentence}</span>
                <span className="when">{shortTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p style={{ marginTop: 8 }}><Link href="/activity">See the full activity log</Link></p>
      </section>

      <section aria-labelledby="rules">
        <h2 id="rules">Your rules</h2>
        {rules.length === 0 ? (
          <p className="muted">No rules yet. <Link href="/rules">Set your rules</Link></p>
        ) : (
          <ul className="list">
            {rules.map((r) => <li key={r.ruleId}>{r.sentence}</li>)}
          </ul>
        )}
        <p style={{ marginTop: 8 }} className="row">
          <span className="muted">
            {policy ? "Rules locked on Arc · " : "Rules not locked on Arc yet"}
            <VerifyLink href={policyUrl}>verify</VerifyLink>
          </span>
          <Link href="/rules">Change rules</Link>
        </p>
      </section>
    </>
  );
}
