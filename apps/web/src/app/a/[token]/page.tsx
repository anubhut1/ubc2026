"use client";
import Link from "next/link";
import { use, useEffect, useState, type ReactNode } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { formatUsd } from "@agent-firewall/policy";
import { ApiError, api, txUrl, type HeldPayment } from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { Avatar, ErrorState, Icon, shortAddr } from "@/components";

type Held = HeldPayment & { agentName?: string };

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A payment request laid out like a receipt (Stripe / Venmo style): who, how much, details, then the decision. */
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
  // While the escrow tx is in flight, poll so the page flips to "Held on Arc" on its own.
  useEffect(() => {
    if (!held || held.status !== "held" || held.holdTx || held.holdError) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held?.status, held?.holdTx, held?.holdError]);

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
      <div className="pay">
        <Link href="/" className="pay-back"><Icon name="back" size={16} />Back to overview</Link>
        {error
          ? error.status === 404
            ? <div className="pay-card"><div className="pay-result"><span className="result-icon warn"><Icon name="alert" size={22} /></span><h1>Link no longer valid</h1><p className="muted">It may have been used or expired. Nothing is waiting on you here.</p></div></div>
            : <ErrorState error={error} onRetry={load} />
          : <p className="muted" role="status">Loading…</p>}
      </div>
    );
  }

  const remaining = new Date(held.expiresAt).getTime() - now;
  const open = held.status === "held" && remaining > 0;
  const onArc = Boolean(held.holdTx);
  const holdUrl = txUrl(held.holdTx, held.holdTxUrl);
  const resolveUrl = txUrl(held.resolveTx, held.resolveTxUrl);
  const amount = formatUsd(held.amountMicro);
  const to = held.recipient.length > 22 ? shortAddr(held.recipient) : held.recipient;

  const escrowRow: ReactNode = onArc
    ? <a href={holdUrl ?? undefined} target="_blank" rel="noreferrer" className="pay-link">Held on Arc <Icon name="arrow" size={12} /></a>
    : held.holdError
      ? <span className="warn-text">Not recorded on Arc</span>
      : held.status === "held" ? <span className="muted">Recording on Arc…</span> : <span className="muted">Not on Arc</span>;

  return (
    <div className="pay">
      <Link href="/" className="pay-back"><Icon name="back" size={16} />Back to overview</Link>
      <div className="pay-card">
        {open ? (
          <div className="pay-head">
            <Avatar recipient={held.recipient} />
            <p className="muted"><b className="ink">{held.agentName ?? "Your agent"}</b> wants to pay</p>
            <p className="pay-to mono" title={held.recipient}>{to}</p>
            <div className="pay-amount">{amount}</div>
            <span className="pill warn"><Icon name="clock" size={13} />Waiting for you · {fmtCountdown(remaining)}</span>
          </div>
        ) : (
          <Result held={held} amount={amount} onArc={onArc} />
        )}

        <dl className="receipt">
          <div><dt>To</dt><dd className="mono" title={held.recipient}>{to}</dd></div>
          <div><dt>Amount</dt><dd>{amount} USDC</dd></div>
          <div><dt>Requested</dt><dd>{new Date(held.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</dd></div>
          <div><dt>Escrow</dt><dd>{escrowRow}</dd></div>
          {resolveUrl && (
            <div><dt>{held.status === "approved" ? "Released" : "Refund"}</dt><dd><a href={resolveUrl} target="_blank" rel="noreferrer" className="pay-link">View on Arc <Icon name="arrow" size={12} /></a></dd></div>
          )}
        </dl>

        <section className="why" aria-labelledby="why">
          <h2 id="why">Why it was held</h2>
          <ul>
            <li><Icon name="alert" size={15} /><span>{held.reason}</span></li>
            {held.flags.map((f) => <li key={f}><Icon name="alert" size={15} /><span>{f}</span></li>)}
          </ul>
        </section>

        {held.holdError && (
          <p className="pay-note" role="status">
            The vault on Arc couldn&apos;t take this payment: {held.holdError.replace(/\.$/, "")}. The money never left your treasury{open ? ", so it can only be cancelled" : ""}.
          </p>
        )}

        {open && (
          <div className="pay-actions">
            <button className="btn attention block" onClick={deny} disabled={busy !== null}>
              {busy === "deny" ? "Cancelling…" : "Cancel payment"}
            </button>
            <button className="btn secondary block" onClick={approve} disabled={busy !== null || Boolean(held.holdError)}>
              {busy === "approve" ? "Waiting for passkey…" : "Approve with passkey"}
            </button>
            <p className="pay-fine">Refunded automatically if you do nothing. Approving always needs your passkey; a text reply can only cancel.</p>
          </div>
        )}
        {msg && <p role="alert" className="warn-text">{msg}</p>}
        {error && <ErrorState error={error} onRetry={load} />}
      </div>
    </div>
  );
}

function Result({ held, amount, onArc }: { held: Held; amount: string; onArc: boolean }) {
  const approved = held.status === "approved";
  const title = approved ? "Payment sent" : held.status === "denied" ? "Payment cancelled" : "Payment refunded";
  let detail: string;
  if (approved) detail = `${amount} was released to the recipient.`;
  else if (!onArc) detail = `${amount} never left your treasury.`;
  else if (held.resolveTx) detail = `${amount} was returned to your treasury.`;
  else detail = `${amount} is being returned to your treasury.`;
  return (
    <div className="pay-result" role="status">
      <span className={`result-icon ${approved ? "ok" : ""}`}><Icon name={approved ? "check" : "undo"} size={22} /></span>
      <h1>{title}</h1>
      <p className="muted">{detail}</p>
    </div>
  );
}
