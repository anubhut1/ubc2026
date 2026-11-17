"use client";
import Link from "next/link";
import { useState } from "react";
import { describeRule, formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, api, txUrl, type ActivityItem, type Summary } from "@/lib/api";
import { useNow, usePoll } from "@/lib/hooks";
import { ErrorState, Icon, Money, OutcomeBadge, SellerTile, VerifyLink, shortAddr, shortTime } from "@/components";

export default function Home() {
  const { data, error, refresh } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 2000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow(1000);

  if (!data) {
    return (
      <section className="home-hero dark bleed">
        {error ? <ErrorState error={error} onRetry={refresh} /> : <p role="status">Loading your agent…</p>}
      </section>
    );
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
  const held = pending[0];
  const pct = (spent: number, cap: number | null) => (cap ? Math.min(100, (spent / cap) * 100) : 0);
  const taskLeft = task.budgetMicro !== null ? Math.max(0, task.budgetMicro - task.spentMicro) : null;
  const dayLeft = today.capMicro !== null ? Math.max(0, today.capMicro - today.spentMicro) : null;
  const policyUrl = policy ? txUrl(policy.committedTx, policy.committedTxUrl) : null;
  const name = data.agent.name.charAt(0).toUpperCase() + data.agent.name.slice(1);

  const allow = policy?.rules?.find((r) => r.kind === "allowlist");
  const approved = allow && allow.kind === "allowlist" ? allow.recipients : [];
  const bought = (r: string) => recent.filter((a) => a.recipient === r && ["settled", "reserved", "approved"].includes(a.status)).length;
  // The band repeats your rules in the site's ticker form: sellers first, then the limits.
  const bandItems = [...approved, ...(policy?.rules ?? []).filter((r) => r.kind !== "allowlist").map(shortRule)].filter(Boolean) as string[];

  return (
    <>
      <section className="home-hero dark bleed" aria-label="Your agent">
        <div className="in">
          <div>
            <h1>
              {paused ? <>{name}<br /><span className="orange">is paused</span></> : held ? <>One payment<br /><span className="orange">needs you</span></> : <>{name}<br /><span className="orange">spends safely</span></>}
            </h1>
            <p className="hero-sub">
              {paused
                ? data.agent.pausedReason ?? "It can't spend anything until you resume it."
                : held
                  ? "Your agent tried to pay someone who isn't on your list. The money is held on Arc until you decide."
                  : "It buys what it needs within your rules. Anything unusual gets held and texted to you."}
            </p>
            <div className="hero-actions">
              {held?.token && <Link className="btn lg" href={`/a/${held.token}`}>Review payment<Icon name="arrow" size={18} /></Link>}
              <button className={`btn lg ${held ? "glass" : paused ? "" : "secondary"}`} onClick={toggle} disabled={busy}>
                <Icon name={paused ? "play" : "pause"} size={18} />{paused ? "Resume agent" : "Pause agent"}
              </button>
            </div>
            {actionError && <p role="alert" className="orange" style={{ marginTop: 12, fontWeight: 700 }}>{actionError}</p>}
            <div className="hero-meta">
              <span>Task {task.id}</span>
              <span aria-hidden="true">·</span>
              {policyUrl ? <VerifyLink href={policyUrl}>Rules locked on Arc</VerifyLink> : <span>Rules not saved yet</span>}
              <span aria-hidden="true">·</span>
              <Link className="verify" href="/rules">Change rules</Link>
            </div>
          </div>

          {held ? (
            <div className="held" aria-live="polite">
              <div className="row">
                <span className="label">Waiting for your OK</span>
                <span className="countdown"><Icon name="clock" size={15} />{fmtLeft(new Date(held.expiresAt).getTime() - now)}</span>
              </div>
              <Money micro={held.amountMicro} size="xl" />
              <p>to <span className="mono">{shortAddr(held.recipient)}</span></p>
              <p>{held.reason}</p>
              {held.flags.some((f) => /injection/i.test(f)) && <div><span className="chip warn"><Icon name="alert" size={13} />Possible prompt injection</span></div>}
              {held.token
                ? <Link className="btn block" href={`/a/${held.token}`}>Review payment</Link>
                : <p className="muted">Open the link we texted you to review it.</p>}
              {pending.length > 1 && <p className="muted">+{pending.length - 1} more waiting</p>}
            </div>
          ) : (
            <div className="allclear">
              <span className="label" style={{ color: "#a7b6c2" }}>Waiting for you</span>
              <p style={{ fontSize: "1.6rem", fontWeight: 900, color: "#fff", letterSpacing: "-0.03em" }}>Nothing. All clear.</p>
              <p>Payments over your limit, or to anyone not on your list, will show up here.</p>
            </div>
          )}
        </div>

        {!held && dayLeft !== null && today.capMicro !== null && (
          <div className="seal" aria-label={`${formatUsd(dayLeft)} left today of ${formatUsd(today.capMicro)}`}>
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="98" fill="#ec8644" />
              <defs><path id="sealPath" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" /></defs>
              <text fill="#1a2a36" fontSize="13" fontWeight="800" letterSpacing="3.2">
                <textPath href="#sealPath">LEFT TODAY ✦ RESETS AT MIDNIGHT ✦ {formatUsd(today.capMicro)} A DAY ✦</textPath>
              </text>
            </svg>
            <div className="core"><b>{formatUsd(dayLeft)}</b><span>left today</span></div>
          </div>
        )}
      </section>

      {bandItems.length > 0 && (
        <div className="band bleed" aria-label="Your rules at a glance">
          <ul>{bandItems.slice(0, 7).map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <section className="section-title" style={{ marginTop: 40 }}>
        <h2>Where the money is.</h2>
        <p>Every number here is enforced by the firewall, not by your agent, so it holds even if the agent gets tricked.</p>
      </section>

      <section className="trio" aria-label="Spending">
        <div className="card slate">
          <span className="label">Spent on this task</span>
          <Money micro={task.spentMicro} size="xl" />
          {task.budgetMicro !== null ? (
            <>
              <div className={`meter ${pct(task.spentMicro, task.budgetMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${Math.max(2, pct(task.spentMicro, task.budgetMicro))}%` }} /></div>
              <div className="meter-legend"><span>of {formatUsd(task.budgetMicro)}</span><span>{formatUsd(taskLeft ?? 0)} left</span></div>
            </>
          ) : <span>No task budget set.</span>}
        </div>
        <div className="card">
          <span className="label">Can still spend today</span>
          {dayLeft !== null ? <Money micro={dayLeft} size="xl" /> : <span className="money lg">No cap</span>}
          {today.capMicro !== null && (
            <>
              <div className={`meter ${pct(today.spentMicro, today.capMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${Math.max(2, pct(today.spentMicro, today.capMicro))}%` }} /></div>
              <div className="meter-legend"><span>{formatUsd(today.spentMicro)} spent</span><span>of {formatUsd(today.capMicro)} a day</span></div>
            </>
          )}
        </div>
        <div className="card steel">
          <div className="card-head"><span className="label">Who it can pay</span><Link className="verify" style={{ color: "var(--ink-strong)" }} href="/rules">Edit</Link></div>
          <div className="tiles">
            {approved.map((r) => (
              <div className="tile-wrap" key={r}>
                <SellerTile recipient={r} />
                <span><span className="tile-name">{r}</span><span className="tile-meta">{bought(r)} recent {bought(r) === 1 ? "purchase" : "purchases"}</span></span>
              </div>
            ))}
            {approved.length === 0 && <p>No approved sellers yet. <Link href="/rules">Add some</Link>.</p>}
          </div>
        </div>
      </section>

      <section className="lower">
        <div className="card">
          <div className="section-head"><h2>What it bought</h2><Link className="verify" href="/activity">See everything</Link></div>
          {recent.length === 0
            ? <p className="muted">Nothing yet. Purchases show up here the moment they happen.</p>
            : <div>{recent.slice(0, 7).map((a) => <FeedRow key={a.requestId} a={a} />)}</div>}
        </div>
        <div className="card slate">
          <div className="section-head"><h2>Your rules</h2>{policy ? <span className="chip"><Icon name="lock" size={12} />Locked</span> : null}</div>
          {rules.length === 0
            ? <p>No rules yet, so your agent can't spend. <Link className="verify" href="/rules">Write your rules</Link></p>
            : <div>{rules.map((r) => <div className="rule-line" key={r.ruleId}><span className="tick"><Icon name="check" size={14} /></span>{r.sentence}</div>)}</div>}
          {policyUrl && <VerifyLink href={policyUrl}>Verify on Arc</VerifyLink>}
        </div>
      </section>
    </>
  );
}

function shortRule(r: Parameters<typeof describeRule>[0]): string | null {
  switch (r.kind) {
    case "taskBudget": return `${formatUsd(r.maxMicro)} per task`;
    case "periodBudget": return `${formatUsd(r.maxMicro)} a ${r.period}`;
    case "approvalThreshold": return `Texts you over ${formatUsd(r.aboveMicro)}`;
    case "perTxLimit": return `Max ${formatUsd(r.maxMicro)} a payment`;
    case "rateLimit": return `Max ${r.maxPerMinute} a minute`;
    case "categories": return r.allowed.join(" + ");
    default: return null;
  }
}

function FeedRow({ a }: { a: ActivityItem }) {
  const purpose = a.purpose?.trim() ? a.purpose.trim() : `${a.category} from ${a.recipient}`;
  const unknown = /^0x/i.test(a.recipient);
  const title = unknown ? `Payment to ${shortAddr(a.recipient)}` : purpose.charAt(0).toUpperCase() + purpose.slice(1);
  const struck = ["blocked", "released", "denied", "expired"].includes(a.status);
  const sub = a.status === "settled" || a.status === "reserved" ? `${a.recipient} · ${shortTime(a.at)}` : `${a.reason} · ${shortTime(a.at)}`;
  return (
    <div className="feed-row">
      <SellerTile recipient={a.recipient} size="sm" />
      <div style={{ minWidth: 0 }}><div className="t">{title}</div><div className="s">{sub}</div></div>
      <OutcomeBadge outcome={a.outcome} status={a.status} />
      <Money micro={a.amountMicro} className={`amt ${struck ? "strike" : ""}`} />
    </div>
  );
}

function fmtLeft(ms: number) {
  if (ms <= 0) return "refunding";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `refunds in ${m}:${String(s).padStart(2, "0")}`;
}
