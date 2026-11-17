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

THESIS: Minimal, plain, calm. The original light design is the committed world; the user tried four alternatives (dark dashboard, uizze-playful, UBC marketing, UBC console) and chose to return to it as "the best, minimal simplistic."

OWN-WORLD: Off-white #F6F7F9 ground, white cards with 1px #DFE2E8 borders and 14px radius, text #14171F, muted #5B6270; blue #1F4FD1 = allowed, orange #B54708 = blocked/attention; Inter body, Space Grotesk headings, JetBrains Mono amounts and addresses; simple top nav with underline on the current page.

STORY: The owner sees status, three cards (task spend, today, waiting for you), a plain-sentence feed, and their rules as sentences.

FIRST VIEWPORT: Top nav (Home / Rules / Activity); agent name + status + Pause; three cards; "What your agent did" list.

FORM: pinned by user, seed: none (pinned), "go back to the original design it was the best, minimal simplistic the original one".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
