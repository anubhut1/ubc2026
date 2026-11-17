"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/lib/api";

/** Owner passkey enrollment. Approving a held payment needs this passkey. */
export function PasskeySetup() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ passkey: boolean }>("/health").then((h) => setReady(h.passkey)).catch(() => setReady(null));
  }, []);

  async function enroll() {
    setBusy(true);
    setMsg(null);
    try {
      const options = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/v1/owner/passkey/options", { method: "POST", body: {} });
      const response = await startRegistration({ optionsJSON: options });
      await api("/v1/owner/passkey", { method: "POST", body: { response } });
      setReady(true);
      setMsg("Passkey saved. You'll use it to approve held payments.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't set up the passkey.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="pk">
      <h2 id="pk">Your passkey</h2>
      <p>Money held for your OK is only released with your passkey (Face ID, Touch ID or a security key). A text message can cancel a payment, but it can never approve one.</p>
      {ready ? (
        <p role="status"><strong>Passkey is set up.</strong></p>
      ) : (
        <div><button className="btn secondary" onClick={enroll} disabled={busy}>{busy ? "Waiting for your device…" : "Set up passkey"}</button></div>
      )}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
