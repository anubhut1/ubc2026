# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: the owner whose money the agent spends.** They delegate purchases (APIs, data, compute) to an AI agent and want to cap and supervise its spending without being a crypto or developer person. Jobs: set rules in plain words, see at a glance what the agent spent and what's left, and decide quickly when something is held (often from a phone, via a text-message link).
- **Secondary: the developer wiring the firewall into an agent.** They are comfortable with rule JSON, hashes, tx links and the HTTP API (`docs/API.md`). They get depth in secondary places (Activity details, "verify on Arc" links, API), never in the owner's main path.
- **Near-term evaluators (through Nov 21, 2026):** UBC 2026 hackathon judges. They are Circle judging "Best use of Arc" (they want real onchain proof and genuine use of Circle tools) and main-track judges for Agentic Payments & AI (wallets, budgets, guardrails). The UI is also seen in a 2–3 minute demo video, so screens must read clearly in a screen recording.

## Product Purpose

It gives AI agents spending guardrails that are enforced **outside the agent**, so a prompt-injected or hijacked agent still can't overspend. Success: the owner sets rules in one sentence, the agent spends freely within them, anything unusual is held for a human decision, and every decision is provable on Arc.

## Positioning

The firewall extends Circle's agent payment stack. It is not a competing "financial OS", and the UI or copy must never call it an OS. Its mechanism is something a prompt-based guardrail can't truthfully claim: the agent holds no key. The firewall is the only signer, and it signs an x402 payment authorization only when payee and amount match a payment it already allowed. Held payments sit in an Arc contract until the owner approves with a passkey. A text message can cancel a payment but never approve one. Rule fingerprints and decisions are logged on Arc.

## Operating Context

- **Owner loop:** write rules on the Rules page → review the compiled sentences → quick test against sample payments → explicitly save (commits a hash to Arc). Then watch Home while the agent works.
- **Held payments arrive as a text message** with a single-use link to the approve page, usually opened on a phone. The owner either cancels (refund) or approves with a passkey (Face ID/Touch ID). Doing nothing refunds the payment after 15 minutes.
- **Demo path** (HANDOFF §11): set rules → normal purchases at $0.02 → race (two $0.80 requests with $1.00 left, one blocked) → injection attack ($3 to an unknown address: held, texted, cancelled, refunded on Arc) → activity log with Arc links.

## Capabilities and Constraints

- Rule kinds: per-payment limit, task budget, daily/weekly/monthly budget, purchase categories, approved recipients, time windows, rate limit (auto-pause), approval threshold, emergency pause.
- Rules compiled from English are always shown, dry-run, and confirmed. They are never applied silently, and vague phrases are flagged, not guessed.
- Runs on Arc testnet with Circle Gateway nanopayments (x402). Amounts are in USDC, displayed as dollars.
- **Terminology:** owner-facing copy uses plain words: "held", "waiting for you", "cancel", "approve with passkey", "locked on Arc". Hashes, tx ids and contract names appear only behind small "verify on Arc" links.
- **Honesty constraints** (README "Safety limits"): Circle Agent Wallet caps are mainnet-only and must not be claimed in the testnet demo. The vault owner key is service-held behind a passkey check, a disclosed shortcut.
- **Undecided:** the product name (see Brand Commitments) and whether a landing page will exist.

## Brand Commitments

- Working name "Agent Firewall". **The name may change, so don't build identity around it yet** (no wordmark or name-dependent motifs).
- Voice: plain, calm and specific. Say what happened and what the owner can do. No jargon or hype in the main UI.
- Semantic color meaning is a product commitment, not a style choice: **blue = allowed, orange = blocked / needs attention.** Never green/red, so it stays readable for color-blind users.

## Evidence on Hand

- Live Arc testnet deployment and real transactions (addresses and tx links in HANDOFF.md §0 "Live on Arc testnet").
- Test suites: policy, firewall (including a multi-process race test and a signer test), Foundry contracts.
- The demo sellers are our own and disclosed as such. **There are no customers, testimonials, usage numbers or press; never fabricate them.**

## Product Principles

1. **Enforcement lives outside the agent.** The UI should make clear what is enforced where, and never imply the agent's own judgment is a safeguard.
2. **Exception-first.** When everything is fine, stay quiet. When something needs the owner, it becomes the loudest thing on screen.
3. **Denying is easy; releasing money takes deliberate proof.** Cancel is always the primary action, and Approve always requires a passkey.
4. **Show the proof, hide the plumbing.** Every claim can be verified on Arc, but crypto detail never blocks the owner's path.
5. **Nothing changes without consent.** Rules apply only after an explicit save.

## Accessibility & Inclusion

- Color-blind safe semantics (blue/orange), with text labels always accompanying color.
- Tap targets ≥ 44px on the approve page and primary actions. Use real `<button>`, `<a>`, `<label>` elements.
- The approve page must work one-handed on a phone, opened cold from a text message.
