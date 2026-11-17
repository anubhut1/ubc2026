#!/usr/bin/env bash
# Start the demo agent with a CLEAN environment: nothing from the caller's shell except an allowlist
# of harmless settings. The agent never sees the firewall's keys, even if they are exported in this shell.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARGS=(PATH="$PATH" HOME="$HOME")
for v in FIREWALL_URL SELLERS_URL AGENT_ID TASK_ID MOCK_PAYMENTS; do
  if [ -n "${!v:-}" ]; then ARGS+=("$v=${!v}"); fi
done
cd "$ROOT/apps/agent"
exec env -i "${ARGS[@]}" "$ROOT/node_modules/.bin/tsx" --env-file-if-exists="$ROOT/.env.agent" src/index.ts "$@"
