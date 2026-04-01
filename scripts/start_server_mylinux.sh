#!/usr/bin/env bash
set -euo pipefail

CKPT_PATH="${1:-./checkpoints/MolmoWeb-8B}"
PORT="${2:-8001}"
CONDA_ENV_NAME="${CONDA_ENV_NAME:-molmoweb}"
PREDICTOR_TYPE_VALUE="${PREDICTOR_TYPE:-hf}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
LOG_FILE="${3:-$LOG_DIR/molmoweb_server_port_${PORT}.log}"
PID_FILE="${PID_FILE:-$LOG_DIR/molmoweb_server_port_${PORT}.pid}"

# Step 1: Move to the repository root so relative checkpoint paths resolve consistently.
cd "$REPO_ROOT"

# Step 2: Create the log directory and fail fast if an existing PID is still alive.
mkdir -p "$LOG_DIR"
if [[ -f "$PID_FILE" ]]; then
	EXISTING_PID="$(cat "$PID_FILE")"
	if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
		echo "Server already running with PID $EXISTING_PID"
		echo "PID file: $PID_FILE"
		echo "Log file: $LOG_FILE"
		exit 1
	fi
	rm -f "$PID_FILE"
fi

# Step 3: Launch the server in the background and stream all output into the log file.
nohup conda run --live-stream -n "$CONDA_ENV_NAME" bash -lc '
export UV_PROJECT_ENVIRONMENT="$CONDA_PREFIX"
export UV_CACHE_DIR="$CONDA_PREFIX/.uv-cache"
export PLAYWRIGHT_BROWSERS_PATH="$CONDA_PREFIX/.playwright"
export MOLMOWEB_LOG_FILE="'"$LOG_FILE"'"
export PORT="'"$PORT"'"
export PREDICTOR_TYPE="'"$PREDICTOR_TYPE_VALUE"'"
bash scripts/start_server.sh "'"$CKPT_PATH"'" "'"$PORT"'"
' >"$LOG_FILE" 2>&1 &
SERVER_PID="$!"
echo "$SERVER_PID" > "$PID_FILE"

# Step 4: Print the monitoring commands needed for the background workflow.
echo "Started MolmoWeb server in background"
echo "PID: $SERVER_PID"
echo "PID file: $PID_FILE"
echo "Log file: $LOG_FILE"
echo "Status URL: http://127.0.0.1:$PORT/status"
echo "Tail logs: tail -f $LOG_FILE"