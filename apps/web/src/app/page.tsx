"use client";
import Link from "next/link";
import { useState } from "react";
import { AGENT_ID, api, txUrl, type ActivityItem, type Summary } from "@/lib/api";
import { useNow, usePoll } from "@/lib/hooks";
import { ErrorState, Icon, Money, VerifyLink, shortAddr, shortTime } from "@/components";

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
  const taskLeft = task.budgetMicro !== null ? Math.max(0, task.budgetMicro - task.spentMicro) : null;
  const dayLeft = today.capMicro !== null ? Math.max(0, today.capMicro - today.spentMicro) : null;
  const policyUrl = policy ? txUrl(policy.committedTx, policy.committedTxUrl) : null;
  const name = data.agent.name.charAt(0).toUpperCase() + data.agent.name.slice(1);

  return (
    <>
      {error && <ErrorState error={error} onRetry={refresh} />}

      <header className="page-head">
        <div>
          <h1>{name}</h1>
          <p className="sub">
            <span className={`chip ${paused ? "warn" : "ok"}`}><span className="dot" aria-hidden="true" />{paused ? "Paused" : "Active"}</span>
            {paused ? data.agent.pausedReason ?? "Spending is stopped." : <>Working within your rules · task <span className="mono">{task.id}</span></>}
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn secondary" href="/rules"><Icon name="shield" size={16} />Edit rules</Link>
          <button className={`btn ${paused ? "" : "attention secondary"}`} onClick={toggle} disabled={busy}>
            <Icon name={paused ? "play" : "pause"} size={16} />
            {paused ? "Resume agent" : "Pause agent"}
          </button>
        </div>
      </header>
      {actionError && <p role="alert" style={{ color: "var(--orange)" }}>{actionError}</p>}

      <section className="grid-hero" aria-label="Spending">
        <div className="card">
          <div className="card-head">
            <span className="label">Spent on this task</span>
            {task.budgetMicro !== null && <span className="chip">Budget <Money micro={task.budgetMicro} /></span>}
          </div>
          <Money micro={task.spentMicro} size="xl" />
          <Spark items={recent} />
          {task.budgetMicro !== null ? (
            <>
              <div className={`meter ${pct(task.spentMicro, task.budgetMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${pct(task.spentMicro, task.budgetMicro)}%` }} /></div>
              <div className="meter-legend"><span>{Math.round(pct(task.spentMicro, task.budgetMicro))}% used</span><span><Money micro={taskLeft ?? 0} /> left</span></div>
            </>
          ) : (
            <span className="muted">No task budget set.</span>
          )}
        </div>

        {pending.length > 0 ? (
          <div className="card attention" aria-live="polite">
            <div className="card-head">
              <span className="label" style={{ color: "var(--orange)" }}>Waiting for you</span>
              <span className="chip warn"><Icon name="clock" size={13} />{fmtLeft(new Date(pending[0]!.expiresAt).getTime() - now)}</span>
            </div>
            <Money micro={pending[0]!.amountMicro} size="lg" />
            <p className="muted">To <span className="mono">{shortAddr(pending[0]!.recipient)}</span></p>
            <p>{pending[0]!.reason}</p>
            {pending[0]!.flags.some((f) => /injection/i.test(f)) && (
              <span className="chip warn"><Icon name="alert" size={13} />Possible prompt injection</span>
            )}
            <div style={{ marginTop: "auto" }}>
              {pending[0]!.token ? (
                <Link className="btn attention block lg" href={`/a/${pending[0]!.token}`}>Review payment</Link>
              ) : (
                <span className="muted">Open the link we texted you to review.</span>
              )}
            </div>
            {pending.length > 1 && <span className="muted">+{pending.length - 1} more waiting</span>}
          </div>
        ) : (
          <div className="card">
            <span className="label">Waiting for you</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "auto 0" }}>
              <span className="ico" style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--blue-tint)", color: "var(--blue)" }}><Icon name="check" /></span>
              <div>
                <p style={{ fontWeight: 600 }}>All clear</p>
                <p className="muted">Anything unusual gets held here and texted to you.</p>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid-2" aria-label="Limits and rules">
        <div className="card">
          <div className="card-head"><span className="label">Can still spend today</span>{today.capMicro !== null && <span className="chip">Cap <Money micro={today.capMicro} /></span>}</div>
          {dayLeft !== null ? <Money micro={dayLeft} size="lg" /> : <span className="muted">No daily cap</span>}
          {today.capMicro !== null && (
            <>
              <div className={`meter ${pct(today.spentMicro, today.capMicro) >= 80 ? "warn" : ""}`}><span style={{ width: `${pct(today.spentMicro, today.capMicro)}%` }} /></div>
              <div className="meter-legend"><span><Money micro={today.spentMicro} /> spent today</span><span>resets at midnight UTC</span></div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="label">Your rules</span>
            {policy ? <span className="chip ok"><Icon name="lock" size={12} />Locked on Arc</span> : <span className="chip">Not locked yet</span>}
          </div>
          {rules.length === 0 ? (
            <p className="muted">No rules yet. <Link href="/rules">Set your rules</Link> before your agent can spend.</p>
          ) : (
            <ul className="rows">
              {rules.map((r) => (
                <li key={r.ruleId} style={{ minHeight: 40, padding: "8px 0" }}>
                  <span style={{ color: "var(--blue)" }}><Icon name="check" size={16} /></span>
                  <span className="body"><span className="title" style={{ whiteSpace: "normal" }}>{r.sentence}</span></span>
                </li>
              ))}
            </ul>
          )}
          {policyUrl && <VerifyLink href={policyUrl}>verify on Arc</VerifyLink>}
        </div>
      </section>

      <section className="card" aria-labelledby="feed">
        <div className="section-head">
          <h2 id="feed">What your agent did</h2>
          <Link href="/activity" className="verify">View all<Icon name="arrow" size={12} /></Link>
        </div>
        {recent.length === 0 ? (
          <p className="muted">Nothing yet. Purchases show up here as they happen.</p>
        ) : (
          <ul className="rows">
            {recent.map((a) => <FeedRow key={a.requestId} a={a} />)}
          </ul>
        )}
      </section>
    </>
  );
}

function FeedRow({ a }: { a: ActivityItem }) {
  const purpose = a.purpose?.trim() ? a.purpose.trim() : `${a.category} from ${a.recipient}`;
  const v = VIEW[a.status] ?? VIEW.settled!;
  const title = v.title(purpose, shortAddr(a.recipient));
  return (
    <li>
      <span className={`ico ${v.tone}`}><Icon name={v.icon} size={16} /></span>
      <span className="body">
        <span className="title">{title}</span>
        <span className="sub">{shortTime(a.at)} · {v.sub(a)}</span>
      </span>
      <Money micro={a.amountMicro} className={`amt ${v.amt}`} />
    </li>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const VIEW: Record<string, { icon: string; tone: string; amt: string; title: (p: string, to: string) => string; sub: (a: ActivityItem) => string }> = {
  settled: { icon: "check", tone: "", amt: "", title: (p) => cap(p), sub: (a) => a.recipient },
  reserved: { icon: "clock", tone: "", amt: "", title: (p) => cap(p), sub: (a) => `${a.recipient} · paying` },
  released: { icon: "undo", tone: "neutral", amt: "strike", title: (p) => cap(p), sub: () => "Didn't go through · budget returned" },
  blocked: { icon: "x", tone: "warn", amt: "strike", title: (_, to) => `Blocked payment to ${to}`, sub: (a) => a.reason },
  held: { icon: "alert", tone: "warn", amt: "warn", title: (_, to) => `Held for you: ${to}`, sub: (a) => a.reason },
  approved: { icon: "check", tone: "", amt: "", title: (_, to) => `You approved ${to}`, sub: () => "Released from the vault" },
  denied: { icon: "undo", tone: "neutral", amt: "strike", title: (_, to) => `You cancelled ${to}`, sub: () => "Refunded" },
  expired: { icon: "undo", tone: "neutral", amt: "strike", title: (_, to) => `Expired: ${to}`, sub: () => "No reply · refunded" },
};

/** Cumulative spend across recent paid items: a small trend line, like a balance chart. */
function Spark({ items }: { items: ActivityItem[] }) {
  const paid = [...items].reverse().filter((i) => ["settled", "reserved", "approved"].includes(i.status));
  if (paid.length < 2) return <div className="spark" aria-hidden="true" />;
  let sum = 0;
  const pts = paid.map((i) => (sum += i.amountMicro));
  const max = Math.max(...pts);
  const W = 400, H = 72;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 6 - (v / max) * (H - 12)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7c9cff" stopOpacity=".35" />
          <stop offset="1" stopColor="#7c9cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#sg)" />
      <path d={line} fill="none" stroke="#7c9cff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function fmtLeft(ms: number) {
  if (ms <= 0) return "refunding";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `refunds in ${m}:${String(s).padStart(2, "0")}`;
}
