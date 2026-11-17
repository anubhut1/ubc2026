"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { formatUsd } from "@agent-firewall/policy";
import { AGENT_ID, ApiError, FIREWALL_URL, api, type Outcome, type Summary } from "@/lib/api";
import { usePoll } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/rules", label: "Rules", icon: "shield" },
  { href: "/activity", label: "Activity", icon: "list" },
] as const;

/** App shell: sidebar navigation (with a live count of payments waiting for you) + main column. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: summary } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 3000);
  const { data: health } = usePoll(() => api<{ arc: { registry: boolean } }>("/health"), 10000);
  if (path.startsWith("/a/")) return <>{children}</>; // approve page is a focused, standalone screen
  const waiting = summary?.pending.length ?? 0;
  const live = Boolean(health?.arc.registry);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="shield" size={16} /></span>
          Agent Firewall
        </Link>
        <nav aria-label="Main" className="side-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>
              <Icon name={n.icon} />
              {n.label}
              {n.href === "/" && waiting > 0 && <span className="count" aria-label={`${waiting} waiting for you`}>{waiting}</span>}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <span className="net"><span className={`pulse ${health ? "" : "off"}`} aria-hidden="true" />{health ? (live ? "Arc testnet · live" : "Local mode") : "Firewall offline"}</span>
          {summary && <span className="net"><Icon name="bot" size={14} />{summary.agent.name}</span>}
        </div>
      </aside>
      <div className="main"><main className="page">{children}</main></div>
    </div>
  );
}

/** "$9.80" → $9.<sup>80</sup>, banking-dashboard style. */
export function Money({ micro, size = "md", className = "" }: { micro: number; size?: "xl" | "lg" | "md"; className?: string }) {
  const s = formatUsd(micro);
  const i = s.indexOf(".");
  return (
    <span className={`money ${size} ${className}`} aria-label={s}>
      <span aria-hidden="true">{i < 0 ? s : s.slice(0, i)}</span>
      {i >= 0 && <span className="cents" aria-hidden="true">.{s.slice(i + 1)}</span>}
    </span>
  );
}

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 14h.01M15 14h.01" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="m7 5 12 7-12 7z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  arrow: <path d="M7 17 17 7M8 7h9v9" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** Kept for compatibility; the Shell renders navigation now. */
export function Header() {
  return null;
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
  return <span className={`badge ${ok ? "ok" : "warn"}`}><span className="dot" aria-hidden="true" />{label}</span>;
}

export function VerifyLink({ href, children = "verify on Arc" }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href) return null;
  return <a className="verify" href={href} target="_blank" rel="noreferrer">{children}<Icon name="arrow" size={12} /></a>;
}

export function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function shortAddr(s: string) {
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}
