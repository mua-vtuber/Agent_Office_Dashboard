#!/usr/bin/env bash
set -u

# Claude Code hook payload arrives via stdin.
payload="$(cat || true)"
if [ -z "${payload}" ]; then
  exit 0
fi

collector_url="${AOD_COLLECTOR_URL:-http://127.0.0.1:4800/ingest/hooks}"
workspace_id="${AOD_WORKSPACE_ID:-$(basename "${PWD:-unknown-workspace}")}"
terminal_session_id="${AOD_TERMINAL_SESSION_ID:-${CLAUDE_SESSION_ID:-${TERM_SESSION_ID:-}}}"
run_id="${AOD_RUN_ID:-}"
terminal_label="${AOD_TERMINAL_LABEL:-${WT_PROFILE_ID:-${TERM_PROGRAM:-terminal}}}"
collected_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

enriched_payload="$(python3 - "$payload" "$workspace_id" "$terminal_session_id" "$run_id" "$terminal_label" "$collected_at" <<'PY'
import json
import sys

raw, workspace_id, terminal_session_id, run_id, terminal_label, collected_at = sys.argv[1:]

try:
    obj = json.loads(raw)
except Exception:
    print(raw)
    sys.exit(0)

meta = obj.get("_meta")
if not isinstance(meta, dict):
    meta = {}

if workspace_id and "workspace" not in meta:
    meta["workspace"] = workspace_id
if terminal_session_id and "terminal_session" not in meta:
    meta["terminal_session"] = terminal_session_id
if run_id and "run" not in meta:
    meta["run"] = run_id
if terminal_label and "terminal_label" not in meta:
    meta["terminal_label"] = terminal_label
if "collected_at" not in meta:
    meta["collected_at"] = collected_at

obj["_meta"] = meta

if workspace_id and "workspace_id" not in obj:
    obj["workspace_id"] = workspace_id
if terminal_session_id and "terminal_session_id" not in obj:
    obj["terminal_session_id"] = terminal_session_id
if run_id and "run_id" not in obj:
    obj["run_id"] = run_id

print(json.dumps(obj, ensure_ascii=False))
PY
)"

if [ -z "${enriched_payload}" ]; then
  exit 0
fi

curl_args=(
  -sS
  -m 2
  -X POST
  "$collector_url"
  -H "Content-Type: application/json"
  -d "$enriched_payload"
)

if [ -n "${DASHBOARD_TOKEN:-}" ]; then
  curl_args+=( -H "Authorization: Bearer ${DASHBOARD_TOKEN}" )
fi

curl "${curl_args[@]}" >/dev/null 2>&1 || true
exit 0
