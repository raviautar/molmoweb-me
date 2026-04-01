#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8010}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
PID_FILE="${PID_FILE:-$LOG_DIR/molmoweb_webui_port_${PORT}.pid}"


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

# Step 1: Exit cleanly when the UI PID file does not exist.
if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found at $PID_FILE"
  exit 0
fi

WEBUI_PID="$(cat "$PID_FILE")"

# Step 2: Stop the tracked UI process if it is still alive.
if [[ -n "$WEBUI_PID" ]] && kill -0 "$WEBUI_PID" 2>/dev/null; then
  kill_process_tree "$WEBUI_PID"
  echo "Stopped MolmoWeb WebUI PID $WEBUI_PID"
else
  echo "Process $WEBUI_PID is not running"
fi

# Step 3: Remove the stale PID file after shutdown.
rm -f "$PID_FILE"