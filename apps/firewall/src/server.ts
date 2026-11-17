import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describeRule, enforcedBy, formatUsd, policyHash, shortRecipient, validateRules, type Rule } from "@agent-firewall/policy";
import { config, explorerTx } from "./config";
import { ensureAgent, type DB } from "./db";
import { activePolicy, evaluateAndReserve, markFailed, markSettled, parsePaymentRequest, savePolicy, setPaused, spendState } from "./engine";
import { compileRules } from "./compiler";
import { defaultSamples, dryRun, type Sample } from "./dryrun";
import { arcStatus, commitPolicyOnArc, logDecisionsOnArc } from "./arc";
import {
  approvalOptions,
  approveWithPasskey,
  denyHold,
  denyLatestByPhone,
  hasPasskey,
  holdByToken,
  onHold,
  pendingHolds,
  registerPasskey,
  registrationOptions,
} from "./approvals";
import { sendSms, smsConfigured, twiml, validTwilioSignature } from "./sms";
import { SignError, signForRequest, signerAddress } from "./signer";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (ctx: { db: DB; req: IncomingMessage; params: Record<string, string>; query: URLSearchParams; body: any; raw: string }) => Promise<unknown> | unknown;
const routes: { method: string; re: RegExp; keys: string[]; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) => {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, handler });
};

// ---------- views ----------
function sentence(r: any): string {
  const amt = formatUsd(r.amount_micro);
  const to = shortRecipient(r.recipient);
  const what = r.purpose?.trim() ? r.purpose.trim() : `${r.category} from ${to}`;
  switch (r.status) {
    case "reserved":
    case "settled":
      return `Bought ${what.charAt(0).toLowerCase() + what.slice(1)}, ${amt}`;
    case "released":
      return `Tried to buy ${what}, ${amt}, but the payment didn't go through (budget returned)`;
    case "blocked":
      return `Blocked ${amt} to ${to}: ${r.reason}`;
    case "held":
      return `Held ${amt} to ${to} and texted you`;
    case "approved":
      return `You approved ${amt} to ${to}`;
    case "denied":
      return `You cancelled ${amt} to ${to}. Refunded`;
    case "expired":
      return `${amt} to ${to} expired without approval. Refunded`;
    default:
      return `${amt} to ${to}`;
  }
}

function activityItem(r: any) {
  return {
    requestId: r.request_id,
    at: r.created_at,
    outcome: r.outcome,
    status: r.status,
    amountMicro: r.amount_micro,
    recipient: r.recipient,
    category: r.category,
    taskId: r.task_id,
    ruleId: r.rule_id,
    reason: r.reason,
    sentence: sentence(r),
    purpose: r.purpose,
    flags: JSON.parse(r.flags_json),
    arcTx: r.hold_tx ?? r.arc_tx ?? null,
    arcTxUrl: explorerTx(r.hold_tx ?? r.arc_tx),
    resolveTx: r.resolve_tx ?? null,
    resolveTxUrl: explorerTx(r.resolve_tx),
  };
}

const ACTIVITY_SQL = `SELECT r.*, h.hold_tx, h.resolve_tx FROM requests r LEFT JOIN holds h ON h.request_id = r.request_id`;
const ruleViews = (rules: Rule[]) => rules.map((r) => ({ ruleId: r.id, kind: r.kind, sentence: describeRule(r), enforcedBy: enforcedBy(r) }));
const policyView = (p: ReturnType<typeof activePolicy>) => p && { id: p.id, hash: p.hash, rules: p.rules, committedTx: p.committedTx, committedTxUrl: explorerTx(p.committedTx), createdAt: p.createdAt };

// ---------- routes ----------
route("GET", "/health", ({ db }) => ({ ok: true, signer: signerAddress(), arc: arcStatus(), twilio: smsConfigured(), llm: Boolean(config.llmApiKey), passkey: hasPasskey(db) }));

route("GET", "/v1/agents/:agentId/summary", ({ db, params }) => {
  const { agentId } = params as { agentId: string };
  ensureAgent(db, agentId, agentId === "research-agent" ? "research agent" : agentId);
  const agent = db.prepare("SELECT * FROM agents WHERE id=?").get(agentId) as any;
  const policy = activePolicy(db, agentId);
  const rules = policy?.rules ?? [];
  const taskId = agent.current_task ?? "nba-injuries";
  const state = spendState(db, agentId, taskId, new Date());
  const task = rules.find((r) => r.kind === "taskBudget" && (r.taskId === "*" || r.taskId === taskId));
  const day = rules.find((r) => r.kind === "periodBudget" && r.period === "day");
  return {
    agent: { id: agent.id, name: agent.name, status: agent.status, pausedReason: agent.paused_reason },
    task: { id: taskId, spentMicro: state.taskSpentMicro, budgetMicro: task?.kind === "taskBudget" ? task.maxMicro : null },
    today: { spentMicro: state.periodSpentMicro.day, capMicro: day?.kind === "periodBudget" ? day.maxMicro : null },
    pending: pendingHolds(db, agentId),
    recent: (db.prepare(`${ACTIVITY_SQL} WHERE r.agent_id=? ORDER BY r.created_ms DESC LIMIT 10`).all(agentId) as any[]).map(activityItem),
    rules: ruleViews(rules),
    policy: policyView(policy),
    passkey: hasPasskey(db),
  };
});

route("POST", "/v1/agents/:agentId/pause", async ({ db, params, body }) => {
  setPaused(db, params.agentId!, true, typeof body?.reason === "string" ? body.reason : undefined);
  return { status: "paused" };
});
route("POST", "/v1/agents/:agentId/resume", ({ db, params }) => {
  setPaused(db, params.agentId!, false);
  return { status: "active" };
});

route("GET", "/v1/activity", ({ db, query }) => {
  const agentId = query.get("agentId") ?? "research-agent";
  const blocked = query.get("filter") === "blocked";
  const limit = Math.min(500, Number(query.get("limit") ?? 200));
  const rows = db
    .prepare(`${ACTIVITY_SQL} WHERE r.agent_id=? ${blocked ? "AND r.outcome IN ('block','hold')" : ""} ORDER BY r.created_ms DESC LIMIT ?`)
    .all(agentId, limit) as any[];
  return { items: rows.map(activityItem) };
});

route("POST", "/v1/rules/compile", async ({ body }) => {
  const text = typeof body?.text === "string" ? body.text : "";
  const r = await compileRules(text);
  return { rules: r.rules, views: ruleViews(r.rules), ambiguities: r.ambiguities, model: r.model, errors: r.errors };
});

route("POST", "/v1/rules/dry-run", ({ db, body }) => {
  const agentId = typeof body?.agentId === "string" ? body.agentId : "research-agent";
  const { rules, errors } = validateRules(body?.rules);
  if (errors.length) throw new HttpError(400, errors.join("; "));
  const samples: Sample[] = Array.isArray(body?.samples) && body.samples.length ? body.samples : defaultSamples(rules);
  const agent = db.prepare("SELECT current_task FROM agents WHERE id=?").get(agentId) as any;
  const state = spendState(db, agentId, agent?.current_task ?? "nba-injuries", new Date());
  return { results: dryRun(rules, samples, state, agentId) };
});

route("GET", "/v1/policy/:agentId", ({ db, params }) => {
  const p = activePolicy(db, params.agentId!);
  const notify = db.prepare("SELECT * FROM notify WHERE agent_id=?").get(params.agentId!) as any;
  return { policy: policyView(p), views: ruleViews(p?.rules ?? []), notify: notify ? { phone: notify.phone, events: JSON.parse(notify.events_json) } : null };
});

route("POST", "/v1/policy", async ({ db, body }) => {
  if (body?.confirmed !== true) throw new HttpError(400, "Rules are only saved after you confirm them.");
  const agentId = typeof body?.agentId === "string" ? body.agentId : "research-agent";
  const { rules, errors } = validateRules(body?.rules);
  if (errors.length) throw new HttpError(400, errors.join("; "));
  const hash = policyHash(rules);
  const saved = savePolicy(db, agentId, rules, hash);
  if (body?.notify) {
    const phone = typeof body.notify.phone === "string" ? body.notify.phone.trim() : null;
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) throw new HttpError(400, "Phone must be in international format, e.g. +15125551234");
    const events = Array.isArray(body.notify.events) ? body.notify.events.filter((e: unknown) => ["hold", "budget80", "paused"].includes(e as string)) : ["hold"];
    db.prepare("INSERT OR REPLACE INTO notify (agent_id, phone, events_json) VALUES (?,?,?)").run(agentId, phone, JSON.stringify(events));
  }
  try {
    const tx = await commitPolicyOnArc(agentId, hash);
    if (tx) {
      db.prepare("UPDATE policies SET committed_tx=? WHERE id=?").run(tx, saved.id);
      saved.committedTx = tx;
    }
  } catch (e) {
    console.error("[commitPolicy]", e);
  }
  return { policy: policyView(saved), arcConfigured: arcStatus().registry };
});

// Agent-facing
route("POST", "/v1/payments/evaluate", async ({ db, body }) => {
  let req;
  try {
    req = parsePaymentRequest(body);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const before = spendState(db, req.agentId, req.taskId, new Date());
  const res = evaluateAndReserve(db, req, { holdMinutes: config.holdMinutes, devMode: config.devMode });
  if (!res.duplicate) {
    if (res.decision.outcome === "hold" && res.holdToken) void onHold(db, req.requestId, res.holdToken, res.expiresAt!);
    if (res.decision.triggerPause) void notifyEvent(db, req.agentId, "paused", `Your agent was paused: ${res.decision.reason} Reply PAUSE anytime to stop it, or resume it from the dashboard.`);
    if (res.decision.outcome === "allow") void maybeBudgetAlert(db, req.agentId, req.taskId, before.taskSpentMicro);
  }
  // The agent never receives the approval token.
  return { ...res.decision, duplicate: res.duplicate, policyHash: res.policyHash };
});
route("GET", "/v1/signer", () => ({ address: signerAddress() }));
route("POST", "/v1/payments/:requestId/sign", async ({ db, params, body }) => {
  try {
    return { signature: await signForRequest(db, params.requestId!, body?.typedData) };
  } catch (e) {
    if (e instanceof SignError) throw new HttpError(403, e.message);
    throw e;
  }
});
route("POST", "/v1/payments/:requestId/settled", ({ db, params, body }) => ({ ok: markSettled(db, params.requestId!, typeof body?.txHash === "string" ? body.txHash : undefined) }));
route("POST", "/v1/payments/:requestId/failed", ({ db, params }) => ({ ok: markFailed(db, params.requestId!) }));

// Approvals
route("GET", "/v1/approvals/:token", ({ db, params }) => {
  const h = holdByToken(db, params.token!);
  if (!h) throw new HttpError(404, "This link isn't valid.");
  return { ...h, passkeyReady: hasPasskey(db) };
});
route("POST", "/v1/approvals/:token/deny", async ({ db, params }) => {
  const h = holdByToken(db, params.token!);
  if (!h) throw new HttpError(404, "This link isn't valid.");
  const r = await denyHold(db, h.requestId);
  if (!r.ok) throw new HttpError(409, `This payment was already ${h.status}.`);
  return { status: "denied", refundTx: r.refundTx, refundTxUrl: explorerTx(r.refundTx) };
});
route("POST", "/v1/approvals/:token/approve/options", async ({ db, params }) => {
  try {
    return await approvalOptions(db, params.token!);
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
});
route("POST", "/v1/approvals/:token/approve", async ({ db, params, body }) => {
  try {
    const r = await approveWithPasskey(db, params.token!, body?.assertion);
    return { status: "approved", releaseTx: r.releaseTx, releaseTxUrl: explorerTx(r.releaseTx) };
  } catch (e) {
    throw new HttpError(403, (e as Error).message);
  }
});

// Owner passkey enrollment
route("POST", "/v1/owner/passkey/options", ({ db }) => registrationOptions(db));
route("POST", "/v1/owner/passkey", async ({ db, body }) => {
  try {
    return await registerPasskey(db, body?.response);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

// Twilio inbound SMS
route("POST", "/v1/twilio/inbound", async ({ db, req, raw }) => {
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
  const url = config.publicUrl + (req.url ?? "");
  if (!validTwilioSignature(req.headers["x-twilio-signature"] as string | undefined, url, params)) throw new HttpError(403, "bad signature");
  const from = params.From ?? "";
  const text = (params.Body ?? "").trim().toUpperCase();
  db.prepare("INSERT INTO sms_log (direction, phone, body, at) VALUES ('in', ?, ?, ?)").run(from, params.Body ?? "", new Date().toISOString());
  let reply: string;
  if (/^(NO|N|STOP PAYMENT|CANCEL)\b/.test(text)) {
    const r = await denyLatestByPhone(db, from);
    reply = r.ok ? `Cancelled ${r.count === 1 ? "the payment" : `${r.count} payments`}. The money is going back to your wallet.` : "Nothing is waiting for you right now.";
  } else if (/^PAUSE\b/.test(text)) {
    const agents = db.prepare("SELECT agent_id FROM notify WHERE phone=?").all(from) as any[];
    const ids = agents.length ? agents.map((a) => a.agent_id) : from === config.twilio.ownerPhone ? ["research-agent"] : [];
    ids.forEach((id) => setPaused(db, id, true, "Paused by text message"));
    reply = ids.length ? "Your agent is paused. It can't spend anything until you resume it." : "We don't recognize this number.";
  } else if (/^(YES|Y|APPROVE|OK)\b/.test(text)) {
    reply = "To approve, open the link. Approving needs your passkey.";
  } else {
    reply = "Reply NO to cancel a held payment, or PAUSE to stop your agent. To approve, open the link we sent.";
  }
  return { __twiml: twiml(reply) };
});

// ---------- notifications ----------
async function notifyEvent(db: DB, agentId: string, event: "paused" | "budget80", body: string) {
  const n = db.prepare("SELECT * FROM notify WHERE agent_id=?").get(agentId) as any;
  const phone = n?.phone ?? config.twilio.ownerPhone;
  const events: string[] = n ? JSON.parse(n.events_json) : [];
  if (!phone || !events.includes(event)) return;
  try {
    await sendSms(db, phone, body);
  } catch (e) {
    console.error("[notify]", e);
  }
}

async function maybeBudgetAlert(db: DB, agentId: string, taskId: string, beforeMicro: number) {
  const p = activePolicy(db, agentId);
  const rule = p?.rules.find((r) => r.kind === "taskBudget" && (r.taskId === "*" || r.taskId === taskId));
  if (rule?.kind !== "taskBudget") return;
  const after = spendState(db, agentId, taskId, new Date()).taskSpentMicro;
  const line = rule.maxMicro * 0.8;
  if (beforeMicro < line && after >= line) await notifyEvent(db, agentId, "budget80", `Heads up: your agent has used ${formatUsd(after)} of its ${formatUsd(rule.maxMicro)} task budget.`);
}

// ---------- Arc decision log batcher ----------
export async function flushDecisionsToArc(db: DB) {
  if (!arcStatus().registry) return;
  const rows = db.prepare("SELECT request_id, agent_id, outcome, rule_id, amount_micro FROM requests WHERE arc_logged=0 ORDER BY created_ms LIMIT 50").all() as any[];
  const byAgent = new Map<string, any[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  for (const [agentId, items] of byAgent) {
    const ids = items.map((i) => i.request_id);
    const mark = db.prepare(`UPDATE requests SET arc_logged=?, arc_tx=COALESCE(?, arc_tx) WHERE request_id IN (${ids.map(() => "?").join(",")})`);
    mark.run(2, null, ...ids); // 2 = in flight
    try {
      const tx = await logDecisionsOnArc(agentId, items.map((i) => ({ requestId: i.request_id, outcome: i.outcome, ruleId: i.rule_id, amountMicro: i.amount_micro })));
      mark.run(1, tx, ...ids);
    } catch (e) {
      console.error("[arc log]", e);
      mark.run(0, null, ...ids);
    }
  }
}

// ---------- server ----------
function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", config.devMode ? "*" : config.appBaseUrl);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function createApp(db: DB) {
  return createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://x");
    const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!match) return res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" }));
    const m = url.pathname.match(match.re)!;
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) return res.writeHead(413).end();
    }
    let body: any = undefined;
    if (raw && (req.headers["content-type"] ?? "").includes("application/json")) {
      try {
        body = JSON.parse(raw);
      } catch {
        return res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid JSON" }));
      }
    }
    try {
      const out: any = await match.handler({ db, req, params, query: url.searchParams, body, raw });
      if (out && typeof out === "object" && "__twiml" in out) return res.writeHead(200, { "Content-Type": "text/xml" }).end(out.__twiml);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out ?? { ok: true }));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(`[${req.method} ${url.pathname}]`, e);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: status === 500 ? "Something went wrong on our side." : (e as Error).message }));
    }
  });
}
