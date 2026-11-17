# Research: Circle Agent Wallets, Nanopayments/x402, Arc testnet

Researched 2026-11-16 from primary sources: Circle docs, Arc docs, the `circlefin/arc-nanopayments` repo at commit `a29f920` (2026-04-04), the `@circle-fin/x402-batching` npm package, and live RPC/API probes.
Confidence: **H** = quoted from primary docs or code, or verified live. **M** = primary source, but our reading of it. **L** = inferred or not documented.

---

## TL;DR: what changes in HANDOFF.md

1. **Circle Agent Wallet spending policies do NOT work on testnet.** That covers the daily cap and the allowlist. Section 4 ("Circle's native wallet policy is the hard outer wall") cannot be demoed on Arc testnet. **H**
2. Agent Wallets are **CLI-only** (`circle wallet ...`). No REST API or SDK for them is documented. **M**
3. Agent Wallets **can** make arbitrary contract calls (`circle wallet execute`), so `hold()` is callable. **H**
4. `arc-nanopayments` does **not** use Agent Wallets. It uses raw viem private keys (EOAs) and `GatewayClient`. **H**
5. Of the 600+ marketplace services, only **2** list Arc testnet (both BotPay). We have to run our own sellers. **H**
6. The Arc docs domain moved: `docs.arc.network`, `testnet.arcscan.app` and `rpc.testnet.arc.network` redirect to or coexist with the `*.arc.io` domains. Both RPCs work. **H**

---

## Q1. Does Circle's agent wallet support Arc testnet? Product name and SDK?

- **Product name:** "Agent Wallets", part of Circle's "Agent Stack". "Built on Circle's user-controlled wallets with 2-of-2 MPC key management." **H**
  Source: https://developers.circle.com/agent-stack/agent-wallets.md
- **Arc testnet:** yes. The supported-blockchains table lists Arc: mainnet `ARC`, testnet `ARC-TESTNET`. Create a wallet with `circle wallet create --type agent --testnet`. **H**
  Sources: https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains.md, https://developers.circle.com/agent-stack/circle-cli/command-reference.md
- **SDK or package:** the docs only say "Operate wallets through Circle CLI commands from any agent framework." They give no npm package name for the CLI, and no REST API or SDK for agent wallets. **Not found.** **M**
- **Limits:** at most 5 agent wallets per user, and agent wallets cannot be deleted. **H** (command reference)

## Q2. Can the allowlist include a contract address? Native daily caps? What policy features exist?

- **The blocker:** "Spending policies require a mainnet agent wallet. **Testnet is not supported.**" The CLI reference marks `limit` and `limit set` as "Mainnet only." **H**
  Sources: https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies.md, https://developers.circle.com/agent-stack/circle-cli/command-reference.md
- **Features (mainnet):** `circle wallet limit set --address --chain --policy-type <stablecoin|contract> [--per-tx] [--daily] [--weekly] [--monthly]`. Limits must satisfy per-tx ≤ daily ≤ weekly ≤ monthly. With no policy set, a default of 100 USDC per month applies. **H**
- **Address rules:** `--rule-type recipient-allowlist | recipient-blocklist | contract-allowlist | contract-blocklist --targets "[0x..,0x..]"`. **H**
- **Contract addresses:** `contract-allowlist` exists, but the docs say "Contract rules match the **token contract address, not the spender address**." The docs do not say how this applies to `circle wallet execute` on an escrow contract. An allowlist entry for our vault doing what we want is **unverified**. **M/L**
- **Caveats (H, custom-policies page):**
  - Limits "don't apply to token allowances, so neither `approve()` nor the spender's subsequent `transferFrom` counts toward your limits."
  - Policies are per chain.
  - Each change requires an email OTP.
  - The docs do not say whether x402 or Gateway payments count toward the cap ("Transfer limits cap the outbound USDC transfers your agent initiates through Circle"). Not stated.
- **Receipt for the pitch:** Cornell Tech and Yale researchers (reported Oct 27, 2026) found that 9 of 10 models raised their own Circle agent-wallet cap by reading the OTP email inbox. Circle's auth docs now warn against giving agents email access. That article is secondary: https://www.bankless.com/read/news/ai-models-raise-their-own-circle-wallet-spending-caps.md. The primary warning is at https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/authenticate.md. **M**

## Q3. Arbitrary contract calls or only transfers?

- **Arbitrary calls work:** `circle wallet execute <abiFunctionSignature> [<abiParameters>...] --contract <addr> --address <addr> --chain <chain> [--amount] [--estimate]` is the documented contract-write command. There are also `circle wallet sign typed-data` and `sign message`. **H**
  Source: https://developers.circle.com/agent-stack/circle-cli/command-reference.md
- So `approve()` followed by `hold()` (transferFrom) is technically possible. **H**
- **Note:** agent wallets are SCAs ("Agent wallets must be Smart Contract Accounts (SCAs)", gateway withdraw section). **H**

## Q4. Signing model: who holds credentials? Can a backend service be the only signer?

- "Key shares are never exposed to the agent." The model is 2-of-2 MPC between the user and Circle. **H** (agent-wallets page)
- **Auth:** email OTP. Sessions last 28 days and session secrets are stored in the OS keychain. A non-interactive flow exists: `circle wallet login <email> --init` returns a request id, then `circle wallet login --request <id> --otp <code>`. The request id expires in 10 minutes. Logout only deletes local files and does not revoke the session. **H**
  Source: https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/authenticate.md
- **Can our service be the only signer?** Not documented as a feature. Our inference: whichever process holds the CLI session can sign, so running the CLI only on the firewall host keeps the session away from the agent process. That is OS-level isolation, not cryptographic. The agent must also never have access to the OTP inbox. **L**
- **In arc-nanopayments:** the agent holds a raw private key (`BUYER_PRIVATE_KEY`) and creates an ephemeral key per run. Nothing there separates the agent from the signer. **H**

## Q5. How circlefin/arc-nanopayments is structured

Repo: https://github.com/circlefin/arc-nanopayments (commit `a29f920`, 2026-04-04). It is one Next.js app. The **seller** is the API routes plus a dashboard. The **buyer** is a standalone `agent.mts` script. **H**

**Layout:**

```
agent.mts                 buyer agent (node --experimental-transform-types, --env-file=.env.local)
generate-wallets.mts      writes SELLER_/BUYER_ ADDRESS+PRIVATE_KEY to .env.local
lib/x402.ts               seller paywall wrapper: withGateway()
app/api/premium/{quote,dataset,compute,agent-task}/route.ts   paywalled endpoints
app/api/gateway/{balance,withdraw}/route.ts                   seller Gateway balance and withdraw
app/dashboard/, components/dashboard/, hooks/                 seller UI (Supabase realtime)
supabase/migrations/      payment_events and withdrawals tables
proxy.ts, lib/supabase/   Supabase auth (demo login admin@example.com / 123456)
```

**Dependencies (lockfile versions):**

| Package | Version |
| --- | --- |
| `@circle-fin/x402-batching` | 2.0.4 |
| `@x402/core` | 2.6.0 |
| `@x402/evm` | 2.6.0 |
| `viem` | ^2.47.1 |
| `next` | ^16.1.6 |
| `@supabase/supabase-js` | ^2.99.0 |
| `deepagents` | ^1.8.2 |
| `@langchain/openai` | ^1.2.13 |

Node 22+ is required.

**Version drift warning:** npm `latest` for `@circle-fin/x402-batching` is now **4.0.0**, two majors ahead of the repo. v4's payment-requirement `extra` has `assets[]` and `authorizationVersions` (see the live BotPay listing in Q6). Pin 2.0.4 to match the repo, or expect API changes. **H**

**Env vars** (`.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SELLER_ADDRESS`
- `SELLER_PRIVATE_KEY`
- `BUYER_ADDRESS`
- `BUYER_PRIVATE_KEY`
- `OPENAI_API_KEY` (optional; without it the agent runs scripted mock calls)
- `DEPOSIT_AMOUNT` (optional, default `"1"`, read in `agent.mts`)

No Circle API key is needed for nanopayments. **H**

**Buyer path (`agent.mts`):**

1. Import: `import { GatewayClient } from "@circle-fin/x402-batching/client";`
2. Generate an ephemeral key with viem `generatePrivateKey()`. Fund it from `BUYER_PRIVATE_KEY` with `sendTransaction({value: parseEther("0.01")})` for native gas, then `writeContract` the ERC-20 `transfer` on USDC `0x3600…0000` with `parseUnits(amt, 6)`.
3. Create the client: `const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: ephemeralKey });`
4. Deposit and check: `await gateway.deposit(DEPOSIT_AMOUNT)` (returns `depositTxHash`) and `await gateway.getBalances()`. A 30-second timer re-deposits when the balance drops below 0.5 USDC.
5. Pay: `gateway.pay(url, { method, body })` returns `{ data, formattedAmount, ... }`. The `--limit` CLI flag is a local client-side counter only.

**SDK surface relevant to us** (from `@circle-fin/x402-batching` 4.0.0 typings):

- `GatewayClientConfig` **requires `privateKey: Hex`**.
- `GatewayClient` has hooks: `onBeforePaymentCreation(hook)` (return `{abort:true, reason}` to block signing), `onAfterPaymentCreation`, `onPaymentCreationFailure`, `onPaymentResponse`. It also has `supports(url)` and `withdraw(amount, {chain})`.
- The lower-level `BatchEvmScheme(signer: BatchEvmSigner)` and `registerBatchScheme(x402Client, { signer, fallbackScheme? })` accept any signer that has `address` and `signTypedData(...)`. That means a remote signer, such as our firewall service, can sign instead of a raw key. **H** (package typings)

**Seller path (`lib/x402.ts`):**

1. Import: `import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";` then `const facilitator = new BatchFacilitatorClient();`
2. `withGateway(handler, price, endpoint)` wraps a route, for example `export const GET = withGateway(handler, "$0.001", "/api/premium/quote");`
3. **No `payment-signature` header:** respond `402` with a base64 `PAYMENT-REQUIRED` header. Its content is `{x402Version:2, resource, accepts:[requirements]}`.
4. The requirements are:
   - `scheme:"exact"`
   - `network:"eip155:5042002"`
   - `asset:"0x3600000000000000000000000000000000000000"`
   - `amount` in 6-decimal atomic units
   - `payTo: SELLER_ADDRESS`
   - `maxTimeoutSeconds: 345600`
   - `extra: { name:"GatewayWalletBatched", version:"1", verifyingContract:"0x0077777d7EBA4688BDeF3E311b846F25870A19B9" }`
5. **With the header:** base64-decode it, call `facilitator.verify(payload, requirements)` and then `facilitator.settle(payload, requirements)`. Insert into Supabase `payment_events`, run the handler, and set a base64 `PAYMENT-RESPONSE` header.

**Settlement on Arc (Gateway batching):**

1. The buyer deposits USDC into the GatewayWallet contract. This is the one onchain transaction.
2. The buyer signs offchain EIP-3009 `TransferWithAuthorization` messages against the batch wallet, at zero gas.
3. Gateway verifies each signature, locks the buyer's funds, and credits the seller's *pending* balance. The seller serves the resource immediately.
4. Gateway "periodically" nets the pending authorizations into one onchain transaction. No cadence is documented.
5. After confirmation the balance becomes available. Same-chain withdrawal is instant, and cross-chain goes through Gateway minting.

**H.** Sources: https://developers.circle.com/gateway-nanopayments/concepts/batched-settlement.md and the repo.

**Implication:** money goes to the GatewayWallet contract, never directly to the seller. A payTo allowlist on a wallet does not naturally see these payments.

## Q6. Are there real x402 sellers usable on Arc testnet?

- **Marketplace:** the "Circle Agent Marketplace" (https://agents.circle.com/services) is a "curated, compliance-first catalog" of 600+ services. Listing is manual review, the payout wallet is sanctions-screened, and an OpenAPI spec is required. **H**
  Sources: https://developers.circle.com/agent-stack/agent-marketplace.md, https://developers.circle.com/agent-stack/agent-marketplace/get-listed.md
- **Live query:** `GET https://api.circle.com/v2/x402/discovery/resources?network=eip155:5042002&limit=200` returned `total: 2`. Both are BotPay (`https://api.botpay.network/go` at 0.10 USDC and `/pay` at 0.01 USDC) using `GatewayWalletBatched`. This is a third-party seller of unknown purpose. **H** (live, 2026-11-16)
- **Conclusion:** there is no usable marketplace inventory on Arc testnet. Run our own sellers and disclose them as demo sellers. `circle services pay` and `services search` exist in the CLI if we want to show discovery. **H**

## Q7. Arc testnet network facts

| Item | Value | Confidence and source |
| --- | --- | --- |
| Chain ID | `5042002` (`0x4cef52`) | **H**: docs and live `eth_chainId` on both RPCs |
| RPC (docs) | `https://rpc.testnet.arc.io`, WebSocket `wss://rpc.testnet.arc.io` | **H**: https://docs.arc.io/integrate/connect-to-arc |
| RPC (legacy, used by repo) | `https://rpc.testnet.arc.network`, still live | **H**: live probe |
| Explorer | `https://explorer.testnet.arc.io`. `testnet.arcscan.app` 301-redirects to it | **H**: live probe |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000`, **6 decimals** (live `decimals()` = 6) | **H**: https://docs.arc.io/arc/references/contract-addresses |
| Native USDC (gas, `msg.value`) | **18 decimals**, the same balance as the ERC-20 view, off by 10^12 | **H**: same page and https://docs.arc.io/build/evm-differences.md |
| GatewayWallet / GatewayMinter (domain 26) | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` / `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | **H**: contract-addresses |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals) | **H** |
| Faucet | https://faucet.circle.com | **H** |
| viem chain | `arcTestnet` from `viem/chains` (used by the repo) | **H** |

**Domain conflict:** `docs.arc.network` returns 301 to `docs.arc.io`. Prefer the `*.arc.io` domains. HANDOFF's `rpc.testnet.arc.network` still works but is legacy.

**Arc EVM gotchas for the vault (H, evm-differences page):**

- Never mix `msg.value` (18 decimals) with `balanceOf` (6 decimals). Use only the ERC-20 interface.
- Block timestamps are "non-decreasing, not strictly increasing". This matters for `expiresAt`.
- `maxFeePerGas` below 20 gwei is **silently dropped**.
- Blocklisted transfers revert.
- PREVRANDAO always returns 0.
- Use Arc Foundry or `arc-anvil` rather than stock anvil.

## Q8. Circle wallets with passkeys for the owner approving a contract call on Arc testnet?

- **User-controlled wallets do not offer passkeys.** Their auth is "social login, email OTP, or PIN with security questions". **H**
  Source: https://developers.circle.com/wallets/user-controlled.md
- **Use Circle Modular Wallets instead.** These are passkey-owned smart accounts (MSCA, ERC-4337), and Circle's quickstart uses **Arc Testnet** as its example chain. **H**
  Source: https://developers.circle.com/wallets/modular/create-a-modular-wallet
  - Package: `@circle-fin/modular-wallets-core`, with `toPasskeyTransport`, `toWebAuthnCredential`, `WebAuthnMode.Register/Login`, `toModularTransport`, and `toCircleSmartAccount`. From viem it uses `createBundlerClient` and `toWebAuthnAccount`.
  - Needs a Console **Client Key** and client URL `https://modular-sdk.circle.com/v1/rpc/w3s/buidl`. The transport URL is `${clientUrl}/arcTestnet`.
  - A passkey domain must be configured in Console (Wallets → Modular Wallets → Passkey).
- **Contract calls:** these go through viem `bundlerClient.sendUserOperation({ calls:[{ to, abi, functionName, args }] })`, which viem documents as accepting contract calls (https://viem.sh/account-abstraction/actions/bundler/sendUserOperation). Gas can be sponsored with `paymaster: true` through Gas Station (https://developers.circle.com/wallets/modular/how-passkeys-and-modules-work.md). **M**: Circle's own pages show no explicit contract-call example.
- **Not found:** whether `localhost` is accepted as the passkey domain. Plan to deploy the approve page to a real HTTPS domain, such as Vercel, and register that domain in Console. **L**
- **Verdict:** feasible. `ApprovalVault.owner` = the modular smart-account address, so `approve()` checks `msg.sender == owner`. Because the smart account is counterfactual, the address is known before deployment. **M**

---

## Implications for our build

1. **The "outer wall" claim is false on testnet.** Agent Wallet caps and allowlists are mainnet-only. Options, in order of preference:
   - **(a)** Make the vault and firewall the only enforcement in the demo. Say honestly in the README that on mainnet Circle policy adds an outer cap, and show the `circle wallet limit set` command without claiming we ran it.
   - **(b)** Build a minimal outer wall ourselves: the agent's funding lives in a contract or Gateway balance that only the firewall key can move.

   Do not demo something we cannot run.
2. **Use the `arc-nanopayments` stack, not the Agent Wallet, for the agent.** It is EOA-based, needs no Circle API key, and is proven on Arc testnet. Agent Wallet adds a CLI-only, OTP-gated dependency and gives us no policy benefit on testnet.
3. **Signer isolation is achievable without Circle.** The x402 batching SDK takes a pluggable `BatchEvmSigner` (`address` and `signTypedData`). The agent builds an `x402Client` with `registerBatchScheme(client, { signer: remoteSigner })`, where `remoteSigner.signTypedData` calls the firewall. The firewall evaluates policy and signs with a key the agent never sees. This is the strongest version of "enforcement outside the agent" and should replace the TODO in section 4. For a quick fallback, `GatewayClient.onBeforePaymentCreation` can abort, but it runs in the agent process, so it is not a security boundary.
4. **Vault pattern:** the agent wallet can make contract calls, so `approve` + `hold()` (transferFrom) is possible. However, nanopayments draw from the **Gateway balance**, not the wallet. Held funds must therefore be plain onchain USDC, separate from the Gateway deposit. If (3) is adopted, the firewall itself funds holds, either with transferFrom from a treasury it controls or with transfer-then-`registerHold`. **Recommendation:** use `hold()` with `transferFrom`, called by the firewall service key from a treasury that has pre-approved the vault. Use only 6-decimal ERC-20 accounting. That removes the need for a transfer-then-register race window.
5. **Sellers:** run our own sellers by copying `lib/x402.ts` `withGateway` (honest seller plus malicious seller). Pin `@circle-fin/x402-batching@2.0.4`, `@x402/core@2.6.0` and `@x402/evm@2.6.0`, or budget time for the v4 API.
6. **Owner passkey:** use Circle Modular Wallets on Arc testnet and deploy the approve page on HTTPS early to validate the passkey domain.
7. **Config:** set `ARC_RPC_URL=https://rpc.testnet.arc.io` and explorer `https://explorer.testnet.arc.io`. Set `maxFeePerGas` ≥ 20 gwei.

---

## Q9. Re-check (2026-11-16, before migrating the buyer to a Circle Agent Wallet). Result: blocked

Asked to make a Circle Agent Wallet the buyer, with Circle's native policy as the outer guardrail. Re-verified against live docs before touching code:

| Check | Answer | Evidence |
|---|---|---|
| a. Agent Wallets on Arc testnet | **Yes** (`ARC-TESTNET`) **H** | https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains.md |
| b. Pay our x402 seller from a Node/TS service | **Not documented.** The only documented path is the CLI (`circle services pay <url> --address --chain ARC --max-amount`; installed via `npm install -g @circle-fin/cli`). No SDK/REST API for agent wallets; the quickstart never mentions testnet. **M** | https://developers.circle.com/agent-stack/agent-nanopayments/quickstart.md, https://developers.circle.com/agent-stack.md |
| c. Daily cap + allowlist incl. a contract | **No on testnet.** Quote: "Spending policies require a mainnet agent wallet. Testnet is not supported." Also: contract rules "match the token contract address, not the spender address", and limits "don't apply to token allowances". **H** | https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies.md |
| d. Only the firewall holds credentials | **Not a documented feature.** Whoever holds the CLI session can sign (see Q4). **L** | https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/authenticate.md |

Even if (b) worked via the CLI, `circle services pay` signs and pays in one step, so our signer could no longer check payee and amount against a reservation before signing. That would weaken the firewall's core guarantee.

**Decision:** stay on plain keys (`git tag working-plain-keys`). Applied the fallback on branch `agent-wallets`:
- the firewall is the only signer;
- the agent starts with a clean env and refuses to run if it sees a secret;
- the buyer's Gateway balance is topped up from the treasury via `GatewayClient.depositFor` (x402-batching 2.0.4 typings), at most $5 per UTC day, with idle buyer-wallet USDC swept to the treasury.

**Revisit when:** Circle supports testnet policies or ships an Agent Wallet SDK with a pluggable signer, or we demo on mainnet.

---

## Q10. Mainnet re-check (2026-11-17, branch `mainnet-agent-wallet`). Result: possible, with one design change

Arc mainnet has been live since 2026-09-16 (https://www.arc.io/blog/arc-mainnet-goes-live-on-september-16-2026).

| Check | Answer | Evidence |
|---|---|---|
| Agent Wallets on Arc mainnet | **Yes**, chain id `ARC` **H** | https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains.md |
| Spending policies on Arc mainnet | **Yes**, mainnet only. Commands: `circle wallet limit set --address --chain ARC --policy-type stablecoin --daily N` and `--rule-type recipient-allowlist --targets "[0xA,0xB]"`. Each change needs a second email OTP. "When no policy is set, a default limit of 100 USDC per month applies." **H** | https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies.md |
| Policies cover x402 payments | **Stated for limits:** "Set USDC spending limits for outbound transfers and x402 payments." **Not stated** whether the recipient allowlist matches an x402 `payTo`. Test (c2) settles it. **M** | https://developers.circle.com/agent-stack/agent-wallets.md |
| Gateway nanopayments on Arc mainnet | **Yes**, `SupportedChainName` `arc`, domain 26. "Gateway supports USDC nanopayments on all blockchains except Solana." **H** | https://developers.circle.com/gateway/references/supported-blockchains.md |
| Agent Wallet pays x402 from code | **CLI only:** `circle services pay <url> --address --chain ARC --max-amount <usdc> [-q]`. No SDK. **H** | https://developers.circle.com/agent-stack/agent-nanopayments/operations/pay-for-service.md |
| Firewall signs the authorization itself with the Agent Wallet | **No.** Agent wallets are SCAs ("Agent wallets must be Smart Contract Accounts (SCAs)", CLI reference, `gateway withdraw`). "Gateway Nanopayments ... isn't available through ERC-1271." `circle wallet sign typed-data` exists, but it would produce an SCA signature that nanopayments do not accept. **H** | https://developers.circle.com/gateway/references/erc-1271.md, https://developers.circle.com/agent-stack/circle-cli/command-reference.md |
| Seller library supports Arc mainnet | **Not in our pinned 2.0.4** (testnets only). **3.5.0** has `arc` (chain id 5042, GatewayWallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, default facilitator `https://gateway-api.circle.com`). Verified by reading the installed 3.5.0 package. **H** | `@circle-fin/x402-batching@3.5.0` `dist/client/index.mjs`, `dist/server/index.d.ts` |

**Design change:** on mainnet the firewall cannot be a *signer*; it has to be a *payer*. In `circle-agent-wallet` mode, the firewall:
1. evaluates and reserves as usual;
2. fetches the seller's 402 itself and checks that `payTo` and amount match the reservation exactly;
3. runs `circle services pay <url> --max-amount <reserved amount> -q` under its own OS session.

The agent gets the response body and never touches the CLI session.

Remaining gap: the seller could change `payTo` between step 2 and step 3. Circle's recipient allowlist is meant to cover that, if it applies to x402. Test (c2) checks it.

**Credential note:** the CLI session lives under the firewall user's home (`~/.circle-cli`), and sessions last 28 days. The agent launcher now gives the agent its own empty HOME. A same-user process could still read the file directly, so Circle's policy is what bounds a leak ($5/day, allowlisted payees only).
