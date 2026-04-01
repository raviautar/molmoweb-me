#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8010}"
CONDA_ENV_NAME="${CONDA_ENV_NAME:-molmoweb}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
LOG_FILE="${2:-$LOG_DIR/molmoweb_webui_port_${PORT}.log}"
PID_FILE="${PID_FILE:-$LOG_DIR/molmoweb_webui_port_${PORT}.pid}"
MODEL_ENDPOINT_VALUE="${MOLMOWEB_MODEL_ENDPOINT:-http://127.0.0.1:8001}"

# Step 1: Move to the repository root and create the log directory for the UI process.
cd "$REPO_ROOT"
mkdir -p "$LOG_DIR"

# Step 2: Fail fast if the tracked UI process is already running.
if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "WebUI already running with PID $EXISTING_PID"
    echo "PID file: $PID_FILE"
    echo "Log file: $LOG_FILE"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# Step 3: Launch the WebUI in the background and route all output into the log file.
nohup conda run --live-stream -n "$CONDA_ENV_NAME" bash -lc '
export UV_PROJECT_ENVIRONMENT="$CONDA_PREFIX"
export UV_CACHE_DIR="$CONDA_PREFIX/.uv-cache"
export PLAYWRIGHT_BROWSERS_PATH="$CONDA_PREFIX/.playwright"
export MOLMOWEB_MODEL_ENDPOINT="'"$MODEL_ENDPOINT_VALUE"'"
uv run uvicorn webui.app:app --host 0.0.0.0 --port "'"$PORT"'" --log-config config/uvicorn_logging.json
' >"$LOG_FILE" 2>&1 &
WEBUI_PID="$!"
echo "$WEBUI_PID" > "$PID_FILE"

# Step 4: Print the operator-facing monitoring commands.
echo "Started MolmoWeb WebUI in background"
echo "PID: $WEBUI_PID"
echo "PID file: $PID_FILE"
echo "Log file: $LOG_FILE"
echo "URL: http://127.0.0.1:$PORT"
echo "Tail logs: tail -f $LOG_FILE"