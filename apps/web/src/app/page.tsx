"use client";
import Link from "next/link";
import { useState } from "react";
import { AGENT_ID, api, txUrl, type ActivityItem, type Summary } from "@/lib/api";
import { useNow, usePoll } from "@/lib/hooks";
import { ErrorState, Icon, Money, OutcomeBadge, SellerTile, VerifyLink, shortAddr, shortTime } from "@/components";

export default function Home() {
  const { data, error, refresh } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 2000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow(1000);

  if (!data) {
    return error ? <ErrorState error={error} onRetry={refresh} /> : <p className="muted" role="status">Loading your agent…</p>;
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

  // The guest list: who the rules say it can pay, plus how often it did.
  const allow = policy?.rules?.find((r) => r.kind === "allowlist");
  const approved = allow && allow.kind === "allowlist" ? allow.recipients : [];
  const bought = (r: string) => recent.filter((a) => a.recipient === r && ["settled", "reserved", "approved"].includes(a.status)).length;

  return (
    <>
      {error && <ErrorState error={error} onRetry={refresh} />}

      <section className="hero" aria-label="Your agent">
        <div className="hero-left">
          <h1>
            {paused ? <>{name} is <span className="red">paused</span></> : held ? <>One payment <span className="red">needs you</span></> : <>{name} is spending <span className="blue">safely</span></>}
          </h1>
          <p className="hero-sub">
            {paused ? data.agent.pausedReason ?? "It can't spend anything until you resume it." : <>Working on <span className="mono">{task.id}</span> within your rules.</>}
            {policyUrl && <VerifyLink href={policyUrl}>Rules locked on Arc<Icon name="arrow" size={13} /></VerifyLink>}
          </p>

          <div className="money-pair">
            <div className="card">
              <span className="label">Spent on this task</span>
              <Money micro={task.spentMicro} size="xl" />
              {task.budgetMicro !== null ? (
                <>
                  <div className={`meter ${pct(task.spentMicro, task.budgetMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${Math.max(2, pct(task.spentMicro, task.budgetMicro))}%` }} /></div>
                  <div className="meter-legend"><span>of <Money micro={task.budgetMicro} /></span><span><Money micro={taskLeft ?? 0} /> left</span></div>
                </>
              ) : <span className="muted">No task budget set.</span>}
            </div>
            <div className="card">
              <span className="label">Can still spend today</span>
              {dayLeft !== null ? <Money micro={dayLeft} size="xl" /> : <span className="money lg">No cap</span>}
              {today.capMicro !== null && (
                <>
                  <div className={`meter ${pct(today.spentMicro, today.capMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${Math.max(2, pct(today.spentMicro, today.capMicro))}%` }} /></div>
                  <div className="meter-legend"><span><Money micro={today.spentMicro} /> spent</span><span>of <Money micro={today.capMicro} /> a day</span></div>
                </>
              )}
            </div>
          </div>

          <div className="hero-actions">
            <button className={`btn ${paused ? "" : "secondary"}`} onClick={toggle} disabled={busy}>
              <Icon name={paused ? "play" : "pause"} size={18} />{paused ? "Resume agent" : "Pause agent"}
            </button>
            <Link className="btn secondary" href="/rules"><Icon name="shield" size={18} />Change rules</Link>
          </div>
          {actionError && <p role="alert" className="red" style={{ fontWeight: 700 }}>{actionError}</p>}
        </div>

        <div className="hero-right" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div className="card guest">
            <div className="card-head"><h2>Who it can pay</h2><Link className="verify" href="/rules">Edit list</Link></div>
            <div className="tiles">
              {approved.map((r) => (
                <div className="tile-wrap" key={r}>
                  <SellerTile recipient={r} />
                  <span className="tile-name">{r}</span>
                  <span className="tile-meta">{bought(r)} {bought(r) === 1 ? "purchase" : "purchases"}</span>
                </div>
              ))}
              {held && (
                <div className="tile-wrap">
                  <SellerTile recipient={held.recipient} />
                  <span className="tile-name red">Unknown</span>
                  <span className="tile-meta">not on your list</span>
                </div>
              )}
              {approved.length === 0 && <p className="muted" style={{ gridColumn: "1 / -1" }}>No approved sellers yet. <Link href="/rules">Add some</Link> and only they can get paid.</p>}
            </div>
          </div>

          {held ? (
            <div className="held" aria-live="polite">
              <span className="note note-held" aria-hidden="true">
                <span className="hand">this one needs you</span>
                <svg width="46" height="44" viewBox="0 0 46 44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6c14 0 28 8 32 30" /><path d="M28 30l8 7 5-10" /></svg>
              </span>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="label" style={{ color: "#3b2a00" }}>Waiting for your OK</span>
                <span className="countdown"><Icon name="clock" size={15} /> {fmtLeft(new Date(held.expiresAt).getTime() - now)}</span>
              </div>
              <Money micro={held.amountMicro} size="xl" />
              <p className="to">to <span className="mono">{shortAddr(held.recipient)}</span></p>
              <p className="why">{held.reason}</p>
              {held.flags.some((f) => /injection/i.test(f)) && <div className="row"><span className="chip"><Icon name="alert" size={14} />Possible prompt injection</span></div>}
              {held.token ? (
                <Link className="btn lg block" href={`/a/${held.token}`}>Review payment<Icon name="arrow" size={18} /></Link>
              ) : (
                <p className="why">Open the link we texted you to review it.</p>
              )}
              {pending.length > 1 && <p className="why">+{pending.length - 1} more waiting</p>}
            </div>
          ) : (
            <div className="allclear"><span className="tile sm" style={{ background: "var(--blue)" }}><Icon name="check" size={20} /></span>All clear. Anything unusual gets held right here and texted to you.</div>
          )}
        </div>
      </section>

      <section className="lower">
        <div className="card">
          <div className="section-head"><h2>What it bought</h2><Link className="verify" href="/activity">See everything<Icon name="arrow" size={13} /></Link></div>
          {recent.length === 0 ? (
            <p className="muted">Nothing yet. Purchases show up here the moment they happen.</p>
          ) : (
            <div>{recent.slice(0, 7).map((a) => <FeedRow key={a.requestId} a={a} />)}</div>
          )}
        </div>
        <div className="card">
          <div className="section-head"><h2>Your rules</h2>{policy ? <span className="chip ok"><Icon name="lock" size={13} />Locked on Arc</span> : <span className="chip off">Not saved yet</span>}</div>
          {rules.length === 0 ? (
            <p className="muted">No rules yet, so your agent can't spend. <Link href="/rules">Write your rules</Link>.</p>
          ) : (
            <div>{rules.map((r) => <div className="rule-line" key={r.ruleId}><span className="tick"><Icon name="check" size={15} /></span>{r.sentence}</div>)}</div>
          )}
        </div>
      </section>
    </>
  );
}

function FeedRow({ a }: { a: ActivityItem }) {
  const purpose = a.purpose?.trim() ? a.purpose.trim() : `${a.category} from ${a.recipient}`;
  const cap = purpose.charAt(0).toUpperCase() + purpose.slice(1);
  const unknown = /^0x/i.test(a.recipient);
  const title = unknown ? `Payment to ${shortAddr(a.recipient)}` : cap;
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
