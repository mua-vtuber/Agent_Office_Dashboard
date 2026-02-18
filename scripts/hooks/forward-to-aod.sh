#!/usr/bin/env bash
set -euo pipefail

# Claude Code hook payload arrives via stdin.
payload="$(cat)"
if [ -z "${payload}" ]; then
  echo "[AOD hook] empty payload from stdin" >&2
  exit 1
fi

collector_url="${AOD_COLLECTOR_URL:-http://127.0.0.1:4800/ingest/hooks}"
integration_error_url="${AOD_INTEGRATION_ERROR_URL:-${collector_url%/ingest/hooks}/api/integration/hook-error}"
workspace_id="${AOD_WORKSPACE_ID:-$(basename "${PWD:-unknown-workspace}")}"
tty_raw="$(tty 2>/dev/null || true)"
tty_id=""
if [ -n "${tty_raw}" ] && [ "${tty_raw}" != "not a tty" ]; then
  tty_id="tty_${tty_raw#/dev/}"
  tty_id="${tty_id//\//_}"
fi
terminal_session_id="${AOD_TERMINAL_SESSION_ID:-${TERM_SESSION_ID:-${tty_id:-}}}"
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

existing_terminal = obj.get("terminal_session_id")
if not isinstance(existing_terminal, str):
    existing_terminal = ""

meta_terminal = meta.get("terminal_session")
if not isinstance(meta_terminal, str):
    meta_terminal = ""

parent_session = obj.get("parent_session_id")
if not isinstance(parent_session, str):
    parent_session = ""

session_id = obj.get("session_id")
if not isinstance(session_id, str):
    session_id = ""

effective_terminal = existing_terminal or meta_terminal or terminal_session_id or parent_session or session_id

if workspace_id and "workspace" not in meta:
    meta["workspace"] = workspace_id
if effective_terminal and "terminal_session" not in meta:
    meta["terminal_session"] = effective_terminal
if run_id and "run" not in meta:
    meta["run"] = run_id
if terminal_label and "terminal_label" not in meta:
    meta["terminal_label"] = terminal_label
if "collected_at" not in meta:
    meta["collected_at"] = collected_at

obj["_meta"] = meta

if workspace_id and "workspace_id" not in obj:
    obj["workspace_id"] = workspace_id
if effective_terminal and "terminal_session_id" not in obj:
    obj["terminal_session_id"] = effective_terminal
if run_id and "run_id" not in obj:
    obj["run_id"] = run_id

print(json.dumps(obj, ensure_ascii=False))
PY
)"

if [ -z "${enriched_payload}" ]; then
  echo "[AOD hook] failed to enrich payload" >&2
  exit 1
fi

build_error_payload() {
  python3 - "$workspace_id" "$terminal_session_id" "$run_id" "$1" "$2" "$collector_url" "$collected_at" <<'PY'
import json
import sys

workspace_id, terminal_session_id, run_id, reason, response_body, collector_url, ts = sys.argv[1:]
print(json.dumps({
    "workspace_id": workspace_id or None,
    "terminal_session_id": terminal_session_id or None,
    "run_id": run_id or None,
    "reason": reason,
    "response_body": response_body[:2000],
    "collector_url": collector_url,
    "ts": ts
}, ensure_ascii=False))
PY
}

report_hook_error() {
  local reason="$1"
  local response_body="${2:-}"
  local error_payload
  error_payload="$(build_error_payload "$reason" "$response_body")"

  local report_args=(
    -sS
    -m 2
    -X POST
    "$integration_error_url"
    -H "Content-Type: application/json"
    -d "$error_payload"
  )
  if [ -n "${DASHBOARD_TOKEN:-}" ]; then
    report_args+=( -H "Authorization: Bearer ${DASHBOARD_TOKEN}" )
  fi

  if ! curl "${report_args[@]}" >/dev/null; then
    echo "[AOD hook] failed to report hook error: ${reason}" >&2
  fi
}

post_args=(
  -sS
  -m 2
  -o /tmp/aod-hook-response.$$
  -w "%{http_code}"
  -X POST
  "$collector_url"
  -H "Content-Type: application/json"
  -d "$enriched_payload"
)

if [ -n "${DASHBOARD_TOKEN:-}" ]; then
  post_args+=( -H "Authorization: Bearer ${DASHBOARD_TOKEN}" )
fi

http_code=""
if ! http_code="$(curl "${post_args[@]}")"; then
  curl_rc=$?
  response_body="$(cat /tmp/aod-hook-response.$$ 2>/dev/null || true)"
  rm -f /tmp/aod-hook-response.$$
  report_hook_error "collector request failed (curl exit ${curl_rc})" "$response_body"
  echo "[AOD hook] collector request failed (curl exit ${curl_rc})" >&2
  exit 1
fi

response_body="$(cat /tmp/aod-hook-response.$$ 2>/dev/null || true)"
rm -f /tmp/aod-hook-response.$$

if [[ ! "${http_code}" =~ ^2[0-9][0-9]$ ]]; then
  report_hook_error "collector returned HTTP ${http_code}" "$response_body"
  echo "[AOD hook] collector returned HTTP ${http_code}" >&2
  exit 1
fi

exit 0
