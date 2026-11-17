import { config } from "./config";
import { openDb } from "./db";
import { createApp, flushDecisionsToArc } from "./server";
import { expireHolds } from "./approvals";
import { arcStatus } from "./arc";
import { smsConfigured } from "./sms";

const db = openDb(config.dbPath);
createApp(db).listen(config.port, () => {
  console.log(`Agent Firewall listening on http://localhost:${config.port}`);
  console.log(`  db=${config.dbPath} arc=${JSON.stringify(arcStatus())} sms=${smsConfigured() ? "twilio" : "dry-run (console)"} llm=${config.llmApiKey ? "claude" : "offline parser"}`);
});

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await expireHolds(db);
    await flushDecisionsToArc(db);
  } finally {
    busy = false;
  }
}, 10_000);
