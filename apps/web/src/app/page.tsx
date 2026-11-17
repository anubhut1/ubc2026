"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, api, txUrl, type ActivityItem, type Summary } from "@/lib/api";
import { useNow, usePoll } from "@/lib/hooks";
import { Avatar, ErrorState, Icon, Money, OutcomeBadge, VerifyLink, shortAddr, shortTime } from "@/components";

const PAID = ["settled", "reserved", "approved"];
const STOPPED = ["blocked", "held", "denied", "expired"];

export default function Home() {
  const { data, error, refresh } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 2000);
  const { data: log } = usePoll(() => api<{ items: ActivityItem[] }>(`/v1/activity?agentId=${AGENT_ID}&filter=all&limit=200`), 5000);
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
  const items = log?.items ?? recent;
  const stopped = items.filter((a) => STOPPED.includes(a.status) && a.status !== "held");
  const keptMicro = stopped.reduce((n, a) => n + a.amountMicro, 0);
  const name = data.agent.name.charAt(0).toUpperCase() + data.agent.name.slice(1);

  return (
    <>
      {error && <ErrorState error={error} onRetry={refresh} />}
      <section className="row" aria-label="Agent status">
        <div>
          <p className="crumbs">Agents / <span className="mono">{data.agent.id}</span> / <span className="mono">{task.id}</span></p>
          <h1>{name}<span className="soft">, {paused ? "paused" : "working within your rules"}</span></h1>
        </div>
        <div className="toolbar">
          <Link className="btn secondary" href="/rules"><Icon name="edit" size={16} />Edit rules</Link>
          <button className={`btn ${paused ? "" : "attention secondary"}`} onClick={toggle} disabled={busy}>
            <Icon name={paused ? "play" : "pause"} size={16} />{paused ? "Resume agent" : "Pause agent"}
          </button>
        </div>
      </section>
      {paused && data.agent.pausedReason && <p className="muted">Paused because: {data.agent.pausedReason}</p>}
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

      <section className="bento" aria-label="Spending">
        <div className="stack">
          <div className="card">
            <div className="card-top">
              <div><h2>Daily allowance</h2><span className="sub">Resets at midnight</span></div>
              <Link className="round-link" href="/rules" aria-label="Change limits"><Icon name="arrow" size={16} /></Link>
            </div>
            <div className="hero">
              <div className="row1"><span>USDC</span><span className="k">Arc testnet</span></div>
              <div>
                <span className="k">Can still spend today</span><br />
                {dayLeft !== null ? <Money micro={dayLeft} size="xl" /> : <span className="money xl">No cap</span>}
              </div>
              {today.capMicro !== null && <div className="hero-bar" aria-hidden="true"><span style={{ width: `${pct(today.spentMicro, today.capMicro)}%` }} /></div>}
              <div className="row3"><span>{formatUsd(today.spentMicro)} used</span><span>cap {today.capMicro !== null ? formatUsd(today.capMicro) : "none"}</span></div>
            </div>
          </div>
          <div className="card">
            <span className="muted small">Spent on this task</span>
            <div className="row">
              <span><Money micro={task.spentMicro} size="md" />{task.budgetMicro !== null && <span className="muted"> / {formatUsd(task.budgetMicro)}</span>}</span>
              {task.budgetMicro !== null && <span className="pill ok">{Math.round(pct(task.spentMicro, task.budgetMicro))}% used</span>}
            </div>
            {task.budgetMicro !== null && <div className="bar"><span style={{ width: `${pct(task.spentMicro, task.budgetMicro)}%` }} /></div>}
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-top">
            <h2>Payments by hour</h2>
            <div className="legend"><span><i className="sw" />Paid</span><span><i className="sw stopped" />Stopped</span></div>
          </div>
          <HourChart items={items} now={now} />
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-top">
              <div><h2>Kept from leaving</h2><span className="sub">Blocked, cancelled or refunded</span></div>
              <Link className="round-link" href="/activity" aria-label="See stopped payments"><Icon name="arrow" size={16} /></Link>
            </div>
            <div className="row" style={{ marginTop: "auto" }}>
              <Money micro={keptMicro} size="lg" />
              <span className="pill warn">{stopped.length} stopped</span>
            </div>
          </div>
          <div className={`card ${pending.length ? "attention" : ""}`}>
            <div className="card-top"><h2>Waiting for you</h2></div>
            {pending.length === 0
              ? <p className="lockline"><Icon name="check" size={16} />Nothing is waiting.</p>
              : <p className="lockline" style={{ color: "var(--orange)" }}><Icon name="clock" size={16} />{pending.length} held · {fmtLeft(new Date(pending[0]!.expiresAt).getTime() - now)}</p>}
          </div>
        </div>

        <div className="panel flush span2">
          <div className="panel-bar">
            <h2>Payment history</h2>
            <Link className="round-link" href="/activity" aria-label="View all activity"><Icon name="arrow" size={16} /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="muted" style={{ padding: "0 22px 22px" }}>Nothing yet. Payments appear here as your agent pays.</p>
          ) : (
            <div className="tx-wrap">
              <table className="tx">
                <thead><tr><th>Time</th><th>To</th><th>Status</th><th className="r">Amount</th><th className="r hide-sm">Arc tx</th></tr></thead>
                <tbody>{recent.slice(0, 6).map((a) => <TxRow key={a.requestId} a={a} />)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-top">
            <h2>Your rules</h2>
            <Link className="round-link" href="/rules" aria-label="Change rules"><Icon name="edit" size={16} /></Link>
          </div>
          {rules.length === 0 ? (
            <p className="muted">No rules yet, so the agent can&apos;t spend. <Link href="/rules">Set your rules</Link></p>
          ) : (
            <ul className="pol">{rules.map((r) => <li key={r.ruleId}><Icon name="check" size={16} /><span>{r.sentence}</span></li>)}</ul>
          )}
          <p className="lockline" style={{ marginTop: "auto" }}>
            <Icon name="lock" size={15} />{policy ? "Locked on Arc" : "Not locked on Arc yet"}
            <VerifyLink href={policyUrl}>verify</VerifyLink>
          </p>
        </div>
      </section>
    </>
  );
}

const HOUR = 3_600_000;
function HourChart({ items, now }: { items: ActivityItem[]; now: number }) {
  const end = Math.ceil(now / HOUR) * HOUR;
  const buckets = Array.from({ length: 8 }, (_, i) => {
    const start = end - (8 - i) * HOUR;
    const inside = items.filter((a) => { const t = new Date(a.at).getTime(); return t >= start && t < start + HOUR; });
    return {
      start,
      paid: inside.filter((a) => PAID.includes(a.status)).length,
      stopped: inside.filter((a) => STOPPED.includes(a.status)).length,
    };
  });
  const peak = Math.max(...buckets.map((b) => b.paid + b.stopped));
  if (peak === 0) return <div className="chart-empty">No payments in the last 8 hours.</div>;
  const top = Math.max(4, Math.ceil(peak / 4) * 4);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const label = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric" });
  return (
    <div className="chart" role="img" aria-label={`Payments per hour: ${buckets.map((b) => `${label(b.start)} ${b.paid} paid, ${b.stopped} stopped`).join("; ")}`}>
      <div className="yaxis" aria-hidden="true">{ticks.map((t) => <span key={t}>{t}</span>)}</div>
      <div className="plot">
        {buckets.map((b) => (
          <div className="col" key={b.start} tabIndex={0} aria-hidden="true">
            {b.paid > 0 && <span className="seg" style={{ height: `${(b.paid / top) * 100}%` }} />}
            {b.stopped > 0 && <span className="seg stopped" style={{ height: `${(b.stopped / top) * 100}%` }} />}
            <span className="tip">{label(b.start)} · {b.paid} paid · {b.stopped} stopped</span>
            <span className="x">{label(b.start)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TxRow({ a }: { a: ActivityItem }) {
  const struck = ["blocked", "released", "denied", "expired"].includes(a.status);
  const purpose = a.purpose?.trim() || a.category;
  // The address is already in the row; drop it from the reason ("0x7a3f…c91e isn't on…" → "Isn't on…").
  const why = a.reason.replace(/^0x[0-9a-f]+…[0-9a-f]+\s+(\w)/i, (_, c: string) => c.toUpperCase());
  const memo = struck || a.status === "held" ? `${purpose} · ${why}` : purpose;
  const url = txUrl(a.arcTx, a.arcTxUrl);
  return (
    <tr>
      <td className="t-time muted mono nowrap">{shortTime(a.at)}</td>
      <td className="t-to">
        <span className="who">
          <Avatar recipient={a.recipient} />
          <span style={{ minWidth: 0 }}>
            <span className={/^0x/i.test(a.recipient) ? "mono" : ""} title={a.recipient}>{shortAddr(a.recipient)}</span>
            <span className="memo">{memo}</span>
          </span>
        </span>
      </td>
      <td className="t-status"><OutcomeBadge outcome={a.outcome} status={a.status} /></td>
      <td className={`t-amt r mono ${struck ? "strike" : ""}`}>{formatUsd(a.amountMicro)}</td>
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
