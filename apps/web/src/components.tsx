"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AGENT_ID, ApiError, FIREWALL_URL, api, type Outcome, type Summary } from "@/lib/api";
import { usePoll } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/rules", label: "Rules" },
  { href: "/activity", label: "Activity" },
];

/** App shell: a quiet left sidebar (nav, agent, network) next to the page. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: summary } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 3000);
  const { data: health } = usePoll(() => api<{ arc: { registry: boolean } }>("/health"), 10000);
  if (path.startsWith("/a/")) return <main className="page">{children}</main>; // approve page stands alone
  const waiting = summary?.pending.length ?? 0;
  const paused = summary?.agent.status === "paused";
  const live = Boolean(health?.arc.registry);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">Agent Firewall</Link>
        <nav aria-label="Main" className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>
              {n.label}
              {n.href === "/" && waiting > 0 && <span className="count" aria-label={`${waiting} waiting for you`}>{waiting}</span>}
            </Link>
          ))}
        </nav>
        {summary && (
          <div className="side-box">
            <span className="side-label">Agent</span>
            <span className="status"><span className={`dot ${paused ? "paused" : ""}`} aria-hidden="true" />{summary.agent.name}</span>
            <div className="kv"><span>Task</span><span className="mono">{summary.task.id}</span></div>
            <div className="kv"><span>Policy</span><span className="mono">{summary.policy ? `${summary.policy.hash.slice(0, 8)}…` : "none"}</span></div>
          </div>
        )}
        <div className="side-foot">
          <span className="status"><span className={`dot ${health ? "" : "paused"}`} aria-hidden="true" />{health ? (live ? "Arc testnet" : "Local mode") : "Firewall offline"}</span>
          <span className="muted mono">Chain 5042002 · USDC</span>
        </div>
      </aside>
      <main className="page">{children}</main>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const down = error.status === 0;
  return (
    <div className="callout attention" role="alert">
      <strong>{down ? "We can't reach your firewall." : "Something went wrong."}</strong>
      <p>
        {down
          ? `Check that the firewall service is running at ${FIREWALL_URL}. Your agent's rules stay in force while this page is offline.`
          : error.message}
      </p>
      {onRetry && (
        <button className="btn secondary" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

export function Callout({ title, children, tone = "info" }: { title: string; children: ReactNode; tone?: "info" | "attention" }) {
  return (
    <div className={`callout ${tone}`}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

const OUTCOME_LABEL: Record<Outcome, string> = { allow: "Paid", hold: "Held for you", block: "Blocked" };
// What happened next matters more than the first decision (a hold can end cancelled, a reserved payment can fail).
const STATUS_LABEL: Record<string, string> = {
  reserved: "Paying", settled: "Paid", released: "Didn't go through", held: "Held for you",
  approved: "You approved", denied: "You cancelled", expired: "Refunded (no reply)", blocked: "Blocked",
};
export function OutcomeBadge({ outcome, status }: { outcome: Outcome; status?: string }) {
  // blue = allowed, orange = needs attention / blocked. Text label always present (not color alone).
  const label = (status && STATUS_LABEL[status]) ?? OUTCOME_LABEL[outcome];
  const ok = status ? ["reserved", "settled", "approved"].includes(status) : outcome === "allow";
  return <span className={`badge ${ok ? "ok" : "warn"}`}>{label}</span>;
}

export function VerifyLink({ href, children = "verify on Arc" }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href) return null;
  return <a className="verify" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function shortAddr(s: string) {
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}
