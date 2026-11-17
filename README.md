# Agent Firewall

**Spending rules for AI agents, written in plain English and enforced outside the agent.** Payments that need a human are held on Arc until the owner approves them with a passkey. Every decision is logged onchain.

Built for UBC 2026, Agentic Payments & AI track, on Circle Nanopayments (x402) and Arc testnet.

## What it does

- **Rules in plain English.** You type "Up to $10 for this task, $5 a day. Text me before anything over $1. Only pay sportsfeed and oddsapi." Claude compiles that into structured rules. You see each rule as a sentence, run a quick test on sample payments, and then confirm. Rules are never applied silently. Vague phrases such as "if it goes crazy" are flagged, not guessed.
- **The firewall is the only signer.** The agent has no private key. To pay an x402 seller, it asks the firewall. The firewall signs the Gateway `TransferWithAuthorization` only if the payee, amount, chain and contract match a payment it has already allowed. Each request gets one signature.
- **Held payments.** An unknown recipient, or a payment above your threshold, is held in `ApprovalVault` on Arc and you get a text message. Reply **NO** to cancel it. Approving requires your passkey; replying "YES" by text does nothing. If you do nothing, the payment is refunded after 15 minutes.
- **No race conditions.** Each payment is evaluated and its budget reserved in a single SQLite `BEGIN IMMEDIATE` transaction. Two $0.80 requests against $1.00 always produce one allow and one block, including across separate processes (tested).
- **Audit trail.** The policy hash is committed to `PolicyRegistry`, and decisions are batch-logged there as events.

## Architecture

```
 ┌───────────────┐ 1. GET resource            ┌──────────────────────┐
 │  Demo agent   │ ─────────────────────────▶ │ x402 sellers (demo)  │
 │  (no keys)    │ ◀──── 402 + requirements ─ │ Circle Gateway mw    │
 └──────┬────────┘                            └──────────▲───────────┘
        │ 2. PaymentRequest                               │ 5. Payment-Signature
        ▼                                                 │
 ┌──────────────────────────────────────────┐             │
 │ Firewall service (apps/firewall)         │             │
 │  policy engine + SQLite ledger           │ 3. allow ───┘ 4. sign typed data
 │  atomic reserve · signer (buyer key)     │    (only if it matches the reservation)
 │  Twilio SMS · WebAuthn · Arc logger      │
 └──────┬──────────────────────┬────────────┘
        │ hold                 │ commit hash / log decisions
        ▼                      ▼
 ┌────────────────┐    ┌──────────────────┐        Gateway batches the
 │ ApprovalVault  │    │ PolicyRegistry   │        authorizations and
 │ hold/approve/  │    │ events only      │        settles on Arc
 │ deny/expire    │    └──────────────────┘
 └────────────────┘
```

| Path | What it is |
|---|---|
| `packages/policy` | Pure rule evaluation (9 rule kinds), canonical policy hash, money normalization (Arc native 18 decimals vs. ERC-20 6 decimals), plain-English descriptions |
| `apps/firewall` | HTTP API (`docs/API.md`), SQLite ledger, rules compiler, dry run, signer, holds, SMS, passkeys, Arc adapter |
| `apps/web` | Next.js site: Home, Rules, Activity, and the `/a/[token]` approve page |
| `apps/sellers` | Demo x402 sellers. Two are honest; one endpoint returns a prompt injection |
| `apps/agent` | Demo agent: normal buying, the race, and a simulated hijack |
| `contracts` | Foundry: `PolicyRegistry`, `ApprovalVault`, with tests (including reentrancy and fuzz tests) |
| `docs/RESEARCH.md` | Verified answers on Circle, Arc and x402, with sources |

## Run it

```bash
npm install
npm test                 # policy + firewall unit tests (incl. multi-process race)
npm run test:contracts   # forge tests
npm run demo:local       # full demo with throwaway keys, mock seller settlement, no funds needed
```

Interactive, with three terminals:

```bash
cp .env.example .env     # fill in what you have; everything degrades gracefully
npm run dev:firewall     # :4000  (prints which integrations are live)
npm run dev:sellers      # :4200
npm run dev:web          # :3000  → set rules on /rules, then:
npm run dev:agent -- all 5
```

To go live on Arc testnet:

1. Fund keys at faucet.circle.com.
2. Deploy the contracts: `cd contracts && forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --private-key $SERVICE_PRIVATE_KEY`.
3. Set `REGISTRY_ADDRESS` and `VAULT_ADDRESS`.
4. From the treasury, `approve` the vault to spend USDC.
5. Deposit to Gateway: `npm run deposit -w @agent-firewall/firewall -- 2`.
6. Set `MOCK_PAYMENTS=0`.

Without an `LLM_API_KEY`, the compiler falls back to an offline parser that handles the demo phrasings. The API reports `model: "offline-parser"`.

## Safety limits (read this)

What is actually enforced, and where:

| Protection | Enforced by | Trust assumption |
|---|---|---|
| All rules (budgets, limits, allowlist, categories, hours, rate limit, pause) | Firewall service | You trust our service and its database |
| Agent can't pay without approval | The firewall holds the buyer key; the agent holds none | The firewall host isn't compromised |
| Payee and amount can't be swapped after approval | Signer checks the EIP-712 message against the reservation | Typed-data shape as of `@circle-fin/x402-batching` 2.0.4 |
| Held money can't be released without you | `ApprovalVault.approve` is `onlyOwner` | **Hackathon shortcut:** the owner key is held by the service and used only after a WebAuthn check. A compromised service could release funds. The fix is a passkey-native owner wallet (Circle Modular Wallets), not yet done. |
| Cancel by text | Twilio webhook signature + `deny()` callable by the service | Twilio and SIM security. Cancelling only ever refunds, so the worst case is a wrongly cancelled payment |
| Held money comes back if you do nothing | `refundExpired` is callable by anyone after expiry | Arc liveness |
| Rules weren't changed after the fact | Policy hash committed to `PolicyRegistry` | `commitPolicy` is owner-only. For the demo, the service key is deployed as owner |

**What we do not claim.**

- **Circle Agent Wallet caps and allowlists are not part of the testnet demo.** Circle's spending policies are mainnet-only (`docs/RESEARCH.md`, Q2). On mainnet they would add a second hard outer wall. On testnet, the outer wall is that the agent has no key at all.
- **Worst case if the agent is fully hijacked:** it can only request payments. It can't spend beyond your rules or pay anyone the firewall didn't approve.
- **Worst case if the firewall host is compromised:** it can spend the buyer's Gateway balance. Keep that balance small; the loss is bounded by what you deposit.
- **The sellers are ours,** run for the demo. Arc testnet has no comparable real x402 sellers (`docs/RESEARCH.md`, Q6).
- **The "hijacked agent" in the demo is scripted to obey the injection.** That's the point: the firewall holds even when the agent doesn't.
- **Injection flags are heuristics,** shown only to the human. They never cause a payment to be allowed.
