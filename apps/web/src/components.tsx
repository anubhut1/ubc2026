"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ApiError, FIREWALL_URL, type Outcome } from "@/lib/api";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/rules", label: "Rules" },
  { href: "/activity", label: "Activity" },
];

export function Header() {
  const path = usePathname();
  if (path.startsWith("/a/")) return null; // approve page is a focused, standalone screen
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">Agent Firewall</Link>
        <nav aria-label="Main" className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
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
