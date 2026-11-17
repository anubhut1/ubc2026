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

THESIS: A firewall you'd want to show a friend: a bright, tactile, playful control room where only one thing is ever loud: the payment that needs you. Refuses the dark fintech dashboard and the grey KPI-card grid.

OWN-WORLD: Near-white ground (#FAFAFA) with a faint grid of rounded squares; ink #0A0A0A; Figtree 900 headings with one word in red; glossy tactile pill buttons (inset white highlight, soft drop, step on hover, press on click) in saturated blue #2563EB (do / allowed) and yellow #FACC15 (needs you); a solid red band #C8000A for blocked/danger; white cards, one 20px radius scale; approved sellers as glossy app-icon tiles; hand-drawn script notes (Caveat) with an ink arrow, used once per screen. No violet.

STORY: The owner sees the agent is fine at a glance, sees exactly what it bought, and if something is held, the page points at it and one big button takes them to decide.

FIRST VIEWPORT: Top bar (wordmark left, Home / Rules / Activity pills, Pause agent right). Left: huge "Your agent is *spending safely*" headline with live sub-line; two big money numbers (task, today) with chunky bars. Right: the guest-list tile grid of approved sellers + red "?" tile for the unknown address; when a payment is held, a yellow card with a hand-drawn arrow "this one needs you" and Review payment. Below: activity feed rows with seller tiles.

FORM: pinned by user reference, seed: none (pinned), "use this https://github.com/Leonxlnx/taste-skill, https://uizze.com/" (look from uizze.com; craft rules from taste-skill).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
