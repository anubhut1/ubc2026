"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, api, txUrl, type ActivityItem, type Summary } from "@/lib/api";
import { useNow, usePoll } from "@/lib/hooks";
import { ErrorState, Icon, OutcomeBadge, SellerTile, VerifyLink, shortAddr, shortTime } from "@/components";

export default function Home() {
  const { data, error, refresh } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 2000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow(1000);

  if (!data) return error ? <ErrorState error={error} onRetry={refresh} /> : <p className="muted" role="status">Loading…</p>;

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
  const paidStatuses = ["settled", "reserved", "approved"];
  const paidCount = recent.filter((a) => paidStatuses.includes(a.status)).length;
  const stoppedCount = recent.filter((a) => ["blocked", "held", "denied", "expired"].includes(a.status)).length;

  const allow = policy?.rules?.find((r) => r.kind === "allowlist");
  const approved = allow && allow.kind === "allowlist" ? allow.recipients : [];
  const spentWith = (r: string) => recent.filter((a) => a.recipient === r && paidStatuses.includes(a.status)).reduce((n, a) => n + a.amountMicro, 0);

  return (
    <>
      <header className="head">
        <div>
          <div className="crumbs"><span>Agents</span><span aria-hidden="true">/</span><span className="mono">{data.agent.id}</span><span aria-hidden="true">/</span><span className="mono">{task.id}</span></div>
          <h1>Overview <span className={`chip ${paused ? "warn" : "ok"}`}><span className="dot" aria-hidden="true" />{paused ? "Paused" : "Spending within rules"}</span></h1>
        </div>
        <div className="toolbar">
          <Link className="btn secondary sm" href="/rules"><Icon name="shield" size={16} />Edit rules</Link>
          <button className={`btn sm ${paused ? "" : "ink"}`} onClick={toggle} disabled={busy}>
            <Icon name={paused ? "play" : "pause"} size={16} />{paused ? "Resume agent" : "Pause agent"}
          </button>
        </div>
      </header>
      {actionError && <p role="alert" style={{ color: "var(--brick)", fontWeight: 600 }}>{actionError}</p>}

      {pending.map((h) => (
        <div className="alert" key={h.requestId} role="status" aria-live="polite">
          <span className="ic"><Icon name="alert" size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <div><b>{formatUsd(h.amountMicro)} held for your approval</b> · to <span className="mono">{shortAddr(h.recipient)}</span></div>
            <div className="sub">{h.reason}{h.flags.some((f) => /injection/i.test(f)) ? " Requested right after a seller response: possible prompt injection." : ""}</div>
          </div>
          <div className="right">
            <span className="countdown"><Icon name="clock" size={15} /> {fmtLeft(new Date(h.expiresAt).getTime() - now)}</span>
            {h.token ? <Link className="btn sm" href={`/a/${h.token}`}>Review payment</Link> : <span className="sub">Open the texted link</span>}
          </div>
        </div>
      ))}

      <section className="stats" aria-label="Spending">
        <div className="stat">
          <span className="label">Task spend</span>
          <span className="v">{formatUsd(task.spentMicro)} {task.budgetMicro !== null && <small>/ {formatUsd(task.budgetMicro)}</small>}</span>
          {task.budgetMicro !== null && <div className={`meter ${pct(task.spentMicro, task.budgetMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${Math.max(1.5, pct(task.spentMicro, task.budgetMicro))}%` }} /></div>}
        </div>
        <div className="stat">
          <span className="label">Available today</span>
          <span className="v">{dayLeft !== null ? formatUsd(dayLeft) : "No cap"} {today.capMicro !== null && <small>/ {formatUsd(today.capMicro)}</small>}</span>
          {today.capMicro !== null && <div className={`meter ${pct(today.spentMicro, today.capMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${Math.max(1.5, pct(today.spentMicro, today.capMicro))}%` }} /></div>}
        </div>
        <div className="stat">
          <span className="label">Payments settled</span>
          <span className="v">{paidCount}</span>
          <span className="foot">in the last {recent.length} requests</span>
        </div>
        <div className="stat">
          <span className="label">Stopped by firewall</span>
          <span className="v">{stoppedCount}</span>
          <span className="foot">blocked, held or refunded</span>
        </div>
      </section>

      <section className="console">
        <div className="card tight">
          <div className="card-bar"><h2>Transactions</h2><Link className="verify" href="/activity">View all</Link></div>
          {recent.length === 0 ? (
            <p className="muted" style={{ padding: 20 }}>No transactions yet. They appear here as your agent pays.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tx">
                <thead><tr><th>Time</th><th>Counterparty</th><th>Status</th><th className="r">Amount</th><th className="r hide-sm">Arc tx</th></tr></thead>
                <tbody>{recent.slice(0, 8).map((a) => <TxRow key={a.requestId} a={a} />)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="side-stack">
          <div className="card slate">
            <div className="card-head"><h2 style={{ fontSize: "1.05rem" }}>Policy</h2>{policy ? <span className="chip"><Icon name="lock" size={12} />Locked on Arc</span> : <span className="chip">Not saved</span>}</div>
            {rules.length === 0
              ? <p>No rules saved, so the agent can't spend. <Link className="verify" href="/rules">Write rules</Link></p>
              : <div>{rules.map((r) => <div className="pol-row" key={r.ruleId}><span className="k">{r.kind}</span><span>{r.sentence}</span></div>)}</div>}
            {policy && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".8rem", color: "#a7b6c2" }}>
                <span className="mono">{policy.hash.slice(0, 10)}…{policy.hash.slice(-6)}</span>
                {policyUrl && <VerifyLink href={policyUrl}>Verify</VerifyLink>}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h2 style={{ fontSize: "1.05rem" }}>Approved counterparties</h2><Link className="verify" href="/rules">Edit</Link></div>
            {approved.length === 0 ? <p className="muted">None yet. Anyone your agent pays will need your OK.</p> : approved.map((r) => (
              <div className="cp-row" key={r}>
                <SellerTile recipient={r} size="sm" />
                <div><div className="n">{r}</div><div className="m">x402 seller</div></div>
                <span className="amt">{formatUsd(spentWith(r))}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function TxRow({ a }: { a: ActivityItem }) {
  const purpose = a.purpose?.trim() ? a.purpose.trim() : a.category;
  const struck = ["blocked", "released", "denied", "expired"].includes(a.status);
  const url = txUrl(a.arcTx, a.arcTxUrl);
  return (
    <tr>
      <td className="muted num" style={{ whiteSpace: "nowrap" }}>{shortTime(a.at)}</td>
      <td>
        <span className="who">
          <SellerTile recipient={a.recipient} size="sm" />
          <span style={{ minWidth: 0 }}>
            <span className={/^0x/i.test(a.recipient) ? "mono" : ""} style={{ display: "block" }}>{shortAddr(a.recipient)}</span>
            <span className="memo" style={{ display: "block" }}>{struck || a.status === "held" ? a.reason : purpose}</span>
          </span>
        </span>
      </td>
      <td><OutcomeBadge outcome={a.outcome} status={a.status} /></td>
      <td className={`amt ${struck ? "strike" : ""}`}>{formatUsd(a.amountMicro)}</td>
      <td className="r hide-sm">{url ? <a className="hash" href={url} target="_blank" rel="noreferrer">{(a.arcTx ?? "").slice(0, 8)}…</a> : <span className="muted">pending</span>}</td>
    </tr>
  );
}

function fmtLeft(ms: number) {
  if (ms <= 0) return "refunding";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `refunds in ${m}:${String(s).padStart(2, "0")}`;
}
