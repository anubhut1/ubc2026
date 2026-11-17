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
cp .env.firewall.example .env.firewall && chmod 600 .env.firewall   # ALL secrets; firewall only
cp .env.agent.example .env.agent         # no secrets
cp .env.sellers.example .env.sellers     # payee addresses only
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
5. Fund the treasury (the service key). The firewall then tops up the buyer's Gateway balance itself, at most `GATEWAY_DAILY_TOPUP_USDC` (default $5) per UTC day, and sweeps idle buyer-wallet USDC back to the treasury. `npm run deposit` still exists for a manual override.
6. Set `MOCK_PAYMENTS=0`.

Without an `LLM_API_KEY`, the compiler falls back to an offline parser that handles the demo phrasings. The API reports `model: "offline-parser"`.

## Safety limits (read this)

What is actually enforced, and where. There are two payment modes (`PAYMENT_MODE`):

- **Testnet (`local-key`, default): firewall-only enforcement.** The firewall holds the buyer key and signs each Gateway authorization itself. Circle spending policies are mainnet-only, so nothing at Circle backs up our rules; the $5/day outer cap below is our own top-up job.
- **Mainnet (`circle-agent-wallet`): Circle policy as an outer wall, plus the firewall.** The buyer is a Circle Agent Wallet with a Circle policy of $5/day and only our seller allowlisted. The firewall checks the seller's terms against the reservation, then pays with `circle services pay --max-amount <reserved>`. Even if our service is compromised, Circle refuses anything over the cap or to another address. The vault and registry stay on Arc testnet (not redeployed). See `docs/RESEARCH.md` Q10 and `HANDOFF.md`.


| Protection | Enforced by | Trust assumption |
|---|---|---|
| All rules (budgets, limits, allowlist, categories, hours, rate limit, pause) | Firewall service (atomic `BEGIN IMMEDIATE` reservation) | You trust our service and its database |
| Agent can't pay without approval | Testnet: the firewall is the only x402 signer; the agent holds no key. Mainnet: only the firewall's OS user holds the Circle CLI session; the agent is started with a different, empty HOME | The firewall host isn't compromised. Mainnet: a same-user process could still read `~/.circle-cli`, and then Circle's policy is the only limit |
| **Mainnet outer wall** | **Circle Agent Wallet policy:** daily transfer limit + recipient allowlist, set with `circle wallet limit set` (email OTP per change) | Circle's enforcement. Docs say limits cover "outbound transfers and x402 payments"; allowlist coverage of x402 payees is checked by test (c2) in `HANDOFF.md` |
| Agent can't see any secret | The agent starts with a clean environment (`scripts/run-agent.sh`, `env -i` + allowlist) and refuses to run if it sees a key (exit 78). Secrets live only in `.env.firewall` | **Environment only.** On one laptop the agent runs as the same OS user and *could* read `.env.firewall` from disk. Real isolation needs a separate OS user or container |
| Payee and amount can't be swapped after approval | Signer checks the EIP-712 message against the reservation; one signature per request | Typed-data shape as of `@circle-fin/x402-batching` 2.0.4 |
| A failed payment can't be quietly re-settled | If a payment fails *after* signing, it stays counted ("unconfirmed") until the authorization expires (~9 days) | None beyond the firewall DB |
| **Testnet outer wall: daily cap on what the buyer can spend at all** | The buyer key only controls its Gateway balance, topped up from the treasury by at most **$5 per UTC day**; idle buyer-wallet USDC is swept to the treasury | The cap is enforced by *our* service's top-up job and the treasury key it holds, **not by Circle**. A compromised firewall host holds the treasury key too |
| Held money can't be released without you | `ApprovalVault.approve` is `onlyOwner` | **Hackathon shortcut:** the owner key is held by the service and used only after a WebAuthn check. A compromised service could release funds. The fix is a passkey-native owner wallet (Circle Modular Wallets), not yet done |
| Held payment really is escrowed | `vaultHold` preflights the treasury allowance/balance; if the hold fails, the UI says "Not recorded on Arc" and cancel says "never left your treasury" | Treasury allowance must be topped up (`/health` → `vault.low`) |
| Cancel by text | Twilio webhook signature + `deny()` callable by the service | Twilio and SIM security. Cancelling only ever refunds |
| Held money comes back if you do nothing | `refundExpired` is callable by anyone after expiry | Arc liveness |
| Rules weren't changed after the fact | Policy hash committed to `PolicyRegistry` | `commitPolicy` is owner-only. For the demo, the service key is deployed as owner |

**What we do not claim.**

- **Circle Agent Wallet caps and allowlists are not part of the testnet demo.** Re-verified 2026-11-16: "Spending policies require a mainnet agent wallet. Testnet is not supported." (`docs/RESEARCH.md`, Q2 and Q9). Our outer wall on testnet is the $5/day Gateway top-up cap above, which our own service enforces. On mainnet, a Circle Agent Wallet policy would add a cap that Circle enforces.
- **Worst case if the agent is fully hijacked:** it can only request payments. It can't spend beyond your rules or pay anyone the firewall didn't approve.
- **Worst case if only the buyer key leaks:** about $5 (that day's Gateway balance) plus a $0.50 gas reserve.
- **Worst case if the firewall host is compromised:** it holds the treasury and owner keys too, so it can spend the treasury and release held funds. Keep the treasury small. This is the main remaining trust assumption.
- **The sellers are ours,** run for the demo. Arc testnet has no comparable real x402 sellers (`docs/RESEARCH.md`, Q6).
- **The "hijacked agent" in the demo is scripted to obey the injection.** That's the point: the firewall holds even when the agent doesn't.
- **Injection flags are heuristics,** shown only to the human. They never cause a payment to be allowed.
