"use client";
import { use, useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { formatUsd } from "@agent-firewall/policy";
import { ApiError, api, txUrl, type HeldPayment } from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { ErrorState, Icon, Money, VerifyLink, shortAddr } from "@/components";

type Held = HeldPayment & { agentName?: string };

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [held, setHeld] = useState<Held | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<"deny" | "approve" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const now = useNow();

  async function load() {
    try {
      setHeld(await api<Held>(`/v1/approvals/${encodeURIComponent(token)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("Something went wrong.", 0));
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  async function deny() {
    setBusy("deny"); setMsg(null);
    try {
      await api(`/v1/approvals/${encodeURIComponent(token)}/deny`, { method: "POST", body: {} });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't cancel. Try again.");
    } finally { setBusy(null); }
  }

  async function approve() {
    setBusy("approve"); setMsg(null);
    try {
      const base = `/v1/approvals/${encodeURIComponent(token)}`;
      const options = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(`${base}/approve/options`, { method: "POST", body: {} });
      const assertion = await startAuthentication({ optionsJSON: options });
      await api(`${base}/approve`, { method: "POST", body: { assertion } });
      await load();
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setMsg(name === "NotAllowedError" ? "Passkey check was cancelled. Nothing was approved." : e instanceof Error ? e.message : "Couldn't approve. Try again.");
    } finally { setBusy(null); }
  }

  if (!held) {
    return (
      <div className="approve-wrap"><div className="approve">
        {error
          ? error.status === 404
            ? <div className="callout attention" role="alert"><strong>This link isn&apos;t valid anymore.</strong><p>It may have been used or expired. Nothing is waiting on you here.</p></div>
            : <ErrorState error={error} onRetry={load} />
          : <p className="muted" role="status">Loading…</p>}
      </div></div>
    );
  }

  const remaining = new Date(held.expiresAt).getTime() - now;
  const open = held.status === "held" && remaining > 0;
  const closedText: Record<string, string> = {
    approved: "You approved this payment. It has been sent.",
    denied: "You cancelled this payment. The money is being returned.",
    expired: "This payment expired and the money was returned.",
    held: "This payment expired and the money is being returned.",
  };

  return (
    <div className="approve-wrap"><div className="approve">
      <div className="brand" style={{ padding: 0 }}><span className="brand-mark" aria-hidden="true"><Icon name="shield" size={16} /></span>Agent Firewall</div>
      <div className="card">
      <p className="muted">{held.agentName ? held.agentName.charAt(0).toUpperCase() + held.agentName.slice(1) : "Your agent"} wants to pay</p>
      <Money micro={held.amountMicro} size="xl" className="amount" />
      <dl className="kv">
        <dt>To</dt><dd className="to" title={held.recipient}>{held.recipient.length > 40 ? shortAddr(held.recipient) : held.recipient}</dd>
        <dt>Held in</dt><dd>Arc vault <VerifyLink href={txUrl(held.holdTx, held.holdTxUrl)}>proof</VerifyLink></dd>
      </dl>
      </div>

      <section className="callout attention" aria-labelledby="why">
        <strong id="why">Why we stopped it</strong>
        <p>{held.reason}</p>
        {held.flags.length > 0 && (
          <ul className="flags">{held.flags.map((f) => <li key={f} className="badge warn">{f}</li>)}</ul>
        )}
      </section>

      {open ? (
        <>
          <p>
            If you do nothing, the money is refunded in <span className="countdown" role="timer">{fmtCountdown(remaining)}</span>.
          </p>
          <div className="actions">
            <button className="btn attention block lg" onClick={deny} disabled={busy !== null}>
              {busy === "deny" ? "Cancelling…" : "Cancel payment"}
            </button>
            <button className="btn secondary block lg" onClick={approve} disabled={busy !== null}>
              {busy === "approve" ? "Waiting for passkey…" : "Approve with passkey"}
            </button>
          </div>
          <p className="muted">Approving always needs your passkey. Replying YES by text never approves.</p>
        </>
      ) : (
        <div className={`callout ${held.status === "approved" ? "info" : "attention"}`} role="status">
          <strong>{held.status === "approved" ? "Approved" : "Closed"}</strong>
          <p>{closedText[held.status] ?? closedText.held}</p>
        </div>
      )}
      {msg && <p role="alert" style={{ color: "var(--orange)" }}>{msg}</p>}
      {error && <ErrorState error={error} onRetry={load} />}
    </div></div>
  );
}
