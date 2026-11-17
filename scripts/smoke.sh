#!/usr/bin/env bash
# End-to-end smoke test against a running firewall (no Arc/Twilio keys needed).
# Usage: FIREWALL_URL=http://localhost:4000 scripts/smoke.sh
set -euo pipefail
B=${FIREWALL_URL:-http://localhost:4000}
post() { curl -s "$B$1" -H 'Content-Type: application/json' -d "$2"; }
js() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

echo "== health"; curl -s "$B/health"; echo
echo "== compile"
C=$(post /v1/rules/compile '{"text":"Up to $10 for this task, $5 a day. Text me before anything over $1. Only pay sportsfeed and oddsapi."}')
echo "$C" | js 'j.views.forEach(v=>console.log(" ",v.sentence,"|",v.enforcedBy)); console.log("  model:",j.model,"ambiguities:",j.ambiguities.length)'
RULES=$(echo "$C" | js 'console.log(JSON.stringify(j.rules))')
echo "== dry run"
post /v1/rules/dry-run "{\"rules\":$RULES}" | js 'j.results.forEach(r=>console.log(" ",r.outcome.padEnd(5),r.label,"→",r.reason))'
echo "== save without confirm (must fail)"; post /v1/policy "{\"rules\":$RULES}"; echo
echo "== save"; post /v1/policy "{\"rules\":$RULES,\"confirmed\":true,\"notify\":{\"phone\":\"+15125550100\",\"events\":[\"hold\",\"budget80\"]}}" | js 'console.log("  hash",j.policy.hash)'
echo "== normal payment"
post /v1/payments/evaluate '{"requestId":"smoke-1","agentId":"research-agent","taskId":"nba-injuries","recipient":"sportsfeed","amountMicro":20000,"category":"data","purpose":"An injury report"}' | js 'console.log(" ",j.outcome,j.reason)'
post /v1/payments/smoke-1/settled '{}' >/dev/null
echo "== injection: unknown address after seller response"
post /v1/payments/evaluate '{"requestId":"smoke-2","agentId":"research-agent","taskId":"nba-injuries","recipient":"0x7a3f9b2c4d5e6f708192a3b4c5d6e7f80912c91e","amountMicro":3000000,"category":"other","purpose":"send funds","sourceContext":"after response from sportsfeed"}' | js 'console.log(" ",j.outcome,j.reason,j.flags)'
sleep 0.5
TOKEN=$(curl -s "$B/v1/agents/research-agent/summary" | js 'console.error("  task",j.task.spentMicro,"/",j.task.budgetMicro," today",j.today.spentMicro,"/",j.today.capMicro," pending",j.pending.length); console.log(j.pending[0]?.token ?? "")')
echo "== approve page"; curl -s "$B/v1/approvals/$TOKEN" | js 'console.log(" ",j.status,j.amountMicro,j.recipient,j.expiresAt)'
echo "== SMS YES (must not approve)"; curl -s -X POST "$B/v1/twilio/inbound" -H 'Content-Type: application/x-www-form-urlencoded' -d 'From=%2B15125550100&Body=yes'; echo
echo "== SMS NO"; curl -s -X POST "$B/v1/twilio/inbound" -H 'Content-Type: application/x-www-form-urlencoded' -d 'From=%2B15125550100&Body=No'; echo
echo "== deny again via link (must 409)"; curl -s -X POST "$B/v1/approvals/$TOKEN/deny"; echo
echo "== race: two \$0.80 with \$1.00 left on a fresh task"
post /v1/policy "{\"agentId\":\"race-agent\",\"confirmed\":true,\"rules\":[{\"id\":\"task\",\"kind\":\"taskBudget\",\"taskId\":\"*\",\"maxMicro\":1000000}]}" >/dev/null
( post /v1/payments/evaluate '{"requestId":"race-a","agentId":"race-agent","taskId":"t","recipient":"oddsapi","amountMicro":800000,"category":"data","purpose":"odds"}' & \
  post /v1/payments/evaluate '{"requestId":"race-b","agentId":"race-agent","taskId":"t","recipient":"oddsapi","amountMicro":800000,"category":"data","purpose":"odds"}' & wait ) | sed 's/},/}\n/' | js 'console.log(" ",j.outcome,j.reason)' 2>/dev/null || true
curl -s "$B/v1/activity?agentId=race-agent" | js 'j.items.forEach(i=>console.log(" ",i.status.padEnd(8),i.sentence))'
echo "== activity"
curl -s "$B/v1/activity?agentId=research-agent" | js 'j.items.forEach(i=>console.log(" ",i.status.padEnd(8),i.sentence))'
