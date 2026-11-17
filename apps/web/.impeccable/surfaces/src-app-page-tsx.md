---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/rules/page.tsx","src/app/activity/page.tsx","src/app/a/[token]/page.tsx"]
---

# Surface brief: Agent Firewall web app (Home, Rules, Activity, Approve)

Scope: apps/web, all four routes. Mode: Operate. Audience/job per PRODUCT.md (owner first; judges + demo video near-term).
User asked for: "cool, but easy to follow"; rejected the dark dashboard as "generic / soulless, cold / corporate".

## Direction contract

THESIS: A payments console in the UBC 2026 Hackathon palette: technical and fintech in structure, warm in color; only the payment that needs you is loud. Refuses both the promotional landing-page structure and the dark-neon dashboard.

OWN-WORLD: Slate-navy (#1A2A36) full-bleed hero with a dot grid; warm off-white body (#F4F3EF); slate ink (#293C4B); Inter Black two-tone headlines (white + orange #EC8644); orange glow pills, white pills, glass pills; floating dark rounded nav; slanted orange band listing your sellers and limits; round orange badge with "left today" set around its edge (only when nothing is held); cards in three tones (slate, white, steel #9AACBB). States: orange = needs you, slate blue = allowed, brick = blocked, grey = refunded, always with words.

STORY: Owner sees in one glance whether the agent is fine or needs them, what's left, who it can pay, and what it bought; one orange button takes them to decide.

FIRST VIEWPORT: Navy dotted sidebar (nav with waiting count, agent box: id, status, task, policy hash, signer; network footer). Main: breadcrumb + Overview title + status chip, Edit rules / Pause agent. Navy alert banner per held payment with countdown + orange Review payment. One stats strip (task spend, available today, settled, stopped). Transactions table (time, counterparty tile + memo, status, right-aligned amount, Arc tx hash) beside a slate Policy card (rule kind tags, hash, verify) and Approved counterparties.

FORM: pinned by user reference, seed: none (pinned), "can you make the design similar to this: https://www.universityblockchain.org/programs/hackathon ... in terms of design" (replaces the earlier uizze pin); then "more technical ... payments and fintech vibes ... look at inspo for structure, but I do like the color scheme" (structure from Mercury/Stripe-style consoles).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
