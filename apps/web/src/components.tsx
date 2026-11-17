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

/** App shell: one sticky top bar (live count of payments waiting for you) over an airy page. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: summary } = usePoll(() => api<Summary>(`/v1/agents/${AGENT_ID}/summary`), 3000);
  const { data: health } = usePoll(() => api<{ arc: { registry: boolean } }>("/health"), 10000);
  if (path.startsWith("/a/")) return <>{children}</>; // approve page is a focused, standalone screen
  const waiting = summary?.pending.length ?? 0;
  const live = Boolean(health?.arc.registry);
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true"><Icon name="shield" size={18} /></span>
            Agent Firewall
          </Link>
          <nav aria-label="Main" className="nav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>
                {n.label}
                {n.href === "/" && waiting > 0 && <span className="count" aria-label={`${waiting} waiting for you`}>{waiting}</span>}
              </Link>
            ))}
          </nav>
          <span className="spacer" />
          <span className="net"><span className={`led ${health ? "" : "off"}`} aria-hidden="true" />{health ? (live ? "Live on Arc testnet" : "Local mode") : "Firewall offline"}</span>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}

const TILE_COLORS = ["#1a2a36", "#3f6f92", "#a94f14", "#2d4356", "#5b6b2f", "#475569"]; // all ≥4.5:1 with white
const isAddress = (r: string) => /^0x[0-9a-fA-F]{6,}$/.test(r);
/** A seller as a glossy app-icon tile. Unknown raw addresses are always a red "?" tile. */
export function SellerTile({ recipient, size = "lg" }: { recipient: string; size?: "lg" | "sm" }) {
  const unknown = isAddress(recipient);
  let h = 0;
  for (const c of recipient) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = unknown ? "#a8382a" : TILE_COLORS[h % TILE_COLORS.length];
  const letters = unknown ? "?" : recipient.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return <span className={`tile ${size === "sm" ? "sm" : ""}`} style={{ background: bg }} aria-hidden="true">{letters}</span>;
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

const OUTCOME_LABEL: Record<Outcome, string> = { allow: "Paid", hold: "Needs you", block: "Blocked" };
// What happened next matters more than the first decision (a hold can end cancelled, a reserved payment can fail).
const STATUS_LABEL: Record<string, string> = {
  reserved: "Paying", settled: "Paid", released: "Didn't go through", held: "Needs you",
  approved: "You approved", denied: "You cancelled", expired: "Refunded (no reply)", blocked: "Blocked",
};
export function OutcomeBadge({ outcome, status }: { outcome: Outcome; status?: string }) {
  // blue = allowed, orange = needs attention / blocked. Text label always present (not color alone).
  const label = (status && STATUS_LABEL[status]) ?? OUTCOME_LABEL[outcome];
  const tone = status
    ? ({ reserved: "ok", settled: "ok", approved: "ok", held: "warn", blocked: "bad", released: "off", denied: "off", expired: "off" } as Record<string, string>)[status] ?? "off"
    : outcome === "allow" ? "ok" : outcome === "hold" ? "warn" : "bad";
  return <span className={`badge ${tone}`}><span className="dot" aria-hidden="true" />{label}</span>;
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
