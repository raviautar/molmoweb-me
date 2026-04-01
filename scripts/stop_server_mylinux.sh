#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
PID_FILE="${PID_FILE:-$LOG_DIR/molmoweb_server_port_${PORT}.pid}"
WEBUI_PORT="${WEBUI_PORT:-8010}"


mark_sessions_stale() {
  local payload='{"reason":"Model server stopped","running_state":"stale_running","idle_state":"stale"}'
  local curl_timeout_seconds="3"

  # Step 1: Prefer the running WebUI API so in-memory session state is updated immediately.
  if command -v curl >/dev/null 2>&1; then
    if curl -sf --max-time "$curl_timeout_seconds" -X POST "http://127.0.0.1:${WEBUI_PORT}/api/admin/mark-sessions-inactive" -H 'Content-Type: application/json' -d "$payload" >/dev/null; then
      return
    fi
  fi

  # Step 2: Fall back to directly rewriting the persisted session artifacts on disk.
  python3 "$REPO_ROOT/scripts/mark_sessions_stale.py" \
    --sessions-root "$REPO_ROOT/logs/webui_sessions" \
    --reason "Model server stopped" \
    --running-state "stale_running" \
    --idle-state "stale" >/dev/null 2>&1 || true
}


kill_process_tree() {
  local root_pid="$1"
  local child_pid=""

  # Step 1: Walk the child process tree first so leaf worker processes exit before the wrapper.
  while read -r child_pid; do
    if [[ -n "$child_pid" ]]; then
      kill_process_tree "$child_pid"
    fi
  done < <(pgrep -P "$root_pid" || true)

  # Step 2: Terminate the current process when it is still running.
  if kill -0 "$root_pid" 2>/dev/null; then
    kill "$root_pid"
  fi
}

# Step 1: Resolve the PID file and exit cleanly if nothing is tracked.
if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found at $PID_FILE"
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"

# Step 2: Mark live sessions stale before the model server process is terminated.
mark_sessions_stale

# Step 3: Stop the tracked process if it is still running.
if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
  kill_process_tree "$SERVER_PID"
  echo "Stopped MolmoWeb server PID $SERVER_PID"
else
  echo "Process $SERVER_PID is not running"
fi

# Step 4: Remove the stale PID file after shutdown.
rm -f "$PID_FILE"