"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, api, txUrl, type ActivityItem, type Summary } from "@/lib/api";
import { useNow, usePoll } from "@/lib/hooks";
import { ErrorState, OutcomeBadge, VerifyLink, shortAddr, shortTime } from "@/components";

const PAID = ["settled", "reserved", "approved"];
const STOPPED = ["blocked", "held", "denied", "expired"];

export default function Home() {
  const { data, error, refresh } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 2000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow(1000);

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
  const dayLeft = today.capMicro !== null ? Math.max(0, today.capMicro - today.spentMicro) : null;
  const policyUrl = policy ? txUrl(policy.committedTx, policy.committedTxUrl) : null;
  const paidCount = recent.filter((a) => PAID.includes(a.status)).length;
  const stoppedCount = recent.filter((a) => STOPPED.includes(a.status)).length;

  return (
    <>
      {error && <ErrorState error={error} onRetry={refresh} />}
      <section className="row" aria-label="Agent status">
        <div>
          <p className="crumbs"><span>Agents</span> / <span className="mono">{data.agent.id}</span> / <span className="mono">{task.id}</span></p>
          <h1>Overview</h1>
          <p className="status">
            <span className={`dot ${paused ? "paused" : ""}`} aria-hidden="true" />
            {paused ? `Paused${data.agent.pausedReason ? ` · ${data.agent.pausedReason}` : ""}` : "Working within your rules"}
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn secondary" href="/rules">Edit rules</Link>
          <button className={`btn ${paused ? "" : "attention secondary"}`} onClick={toggle} disabled={busy}>
            {paused ? "Resume agent" : "Pause agent"}
          </button>
        </div>
      </section>
      {actionError && <p role="alert" style={{ color: "var(--orange)" }}>{actionError}</p>}

      {pending.map((h) => (
        <div className="callout attention alert" key={h.requestId} role="status" aria-live="polite">
          <div>
            <strong>{formatUsd(h.amountMicro)} held for your approval</strong> · to <span className="mono">{shortAddr(h.recipient)}</span>
            <p className="muted">{h.reason}</p>
          </div>
          <div className="alert-right">
            <span className="countdown">{fmtLeft(new Date(h.expiresAt).getTime() - now)}</span>
            {h.token ? <Link className="btn attention" href={`/a/${h.token}`}>Review</Link> : <span className="muted">Open the link we texted you.</span>}
          </div>
        </div>
      ))}

      <section className="stats" aria-label="Spending">
        <div className="stat">
          <span className="label">Spent on this task</span>
          <span className="v">{formatUsd(task.spentMicro)}{task.budgetMicro !== null && <small> / {formatUsd(task.budgetMicro)}</small>}</span>
          {task.budgetMicro !== null && <div className="bar"><span style={{ width: `${pct(task.spentMicro, task.budgetMicro)}%` }} /></div>}
        </div>
        <div className="stat">
          <span className="label">Can still spend today</span>
          <span className="v">{dayLeft !== null ? formatUsd(dayLeft) : "No cap"}{today.capMicro !== null && <small> / {formatUsd(today.capMicro)}</small>}</span>
          {today.capMicro !== null && <div className="bar"><span style={{ width: `${pct(today.spentMicro, today.capMicro)}%` }} /></div>}
        </div>
        <div className="stat">
          <span className="label">Payments made</span>
          <span className="v">{paidCount}</span>
          <span className="muted foot">in the last {recent.length} requests</span>
        </div>
        <div className="stat">
          <span className="label">Stopped by firewall</span>
          <span className="v">{stoppedCount}</span>
          <span className="muted foot">blocked, held or refunded</span>
        </div>
      </section>

      <section className="console">
        <div className="panel flush">
          <div className="panel-bar"><h2>Transactions</h2><Link href="/activity">View all</Link></div>
          {recent.length === 0 ? (
            <p className="muted" style={{ padding: "0 18px 18px" }}>Nothing yet. Payments appear here as your agent pays.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tx">
                <thead><tr><th>Time</th><th>Paid to</th><th>Status</th><th className="r">Amount</th><th className="r hide-sm">Arc tx</th></tr></thead>
                <tbody>{recent.slice(0, 8).map((a) => <TxRow key={a.requestId} a={a} />)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Your rules</h2><Link href="/rules">Change</Link></div>
          {rules.length === 0 ? (
            <p className="muted">No rules yet, so the agent can't spend. <Link href="/rules">Set your rules</Link></p>
          ) : (
            <ul className="pol">{rules.map((r) => <li key={r.ruleId}>{r.sentence}</li>)}</ul>
          )}
          <p className="muted small">
            {policy ? <>Locked on Arc · <span className="mono">{policy.hash.slice(0, 10)}…{policy.hash.slice(-6)}</span> </> : "Rules not locked on Arc yet "}
            <VerifyLink href={policyUrl}>verify</VerifyLink>
          </p>
        </div>
      </section>
    </>
  );
}

function TxRow({ a }: { a: ActivityItem }) {
  const struck = ["blocked", "released", "denied", "expired"].includes(a.status);
  const memo = struck || a.status === "held" ? a.reason : a.purpose?.trim() || a.category;
  const url = txUrl(a.arcTx, a.arcTxUrl);
  return (
    <tr>
      <td className="muted mono nowrap">{shortTime(a.at)}</td>
      <td>
        <span className={/^0x/i.test(a.recipient) ? "mono" : ""}>{shortAddr(a.recipient)}</span>
        <span className="memo">{memo}</span>
      </td>
      <td><OutcomeBadge outcome={a.outcome} status={a.status} /></td>
      <td className={`r mono ${struck ? "strike" : ""}`}>{formatUsd(a.amountMicro)}</td>
      <td className="r hide-sm">{url ? <a className="mono" href={url} target="_blank" rel="noreferrer">{(a.arcTx ?? "").slice(0, 8)}…</a> : <span className="muted">pending</span>}</td>
    </tr>
  );
}

function fmtLeft(ms: number) {
  if (ms <= 0) return "refunding";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `refunds in ${m}:${String(s).padStart(2, "0")}`;
}
