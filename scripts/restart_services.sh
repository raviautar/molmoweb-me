#!/usr/bin/env bash
set -euo pipefail

CKPT_PATH="${1:-./checkpoints/MolmoWeb-8B}"
MODEL_PORT="${2:-8001}"
WEBUI_PORT="${3:-8010}"
SERVER_LOG_FILE="${4:-}"
WEBUI_LOG_FILE="${5:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_STATUS_URL="http://127.0.0.1:${MODEL_PORT}/status?format=json"
WEBUI_STATUS_URL="http://127.0.0.1:${WEBUI_PORT}/api/status"
STATUS_RETRY_COUNT="${STATUS_RETRY_COUNT:-30}"
STATUS_RETRY_SLEEP_SECONDS="${STATUS_RETRY_SLEEP_SECONDS:-2}"


wait_for_status() {
  local service_name="$1"
  local status_url="$2"
  local attempt="0"

  # Step 1: Poll the target status endpoint until it responds or the retry budget is exhausted.
  while [[ "$attempt" -lt "$STATUS_RETRY_COUNT" ]]; do
    if curl -sf "$status_url" >/dev/null; then
      echo "$service_name is healthy: $status_url"
      return 0
    fi
    attempt="$((attempt + 1))"
    sleep "$STATUS_RETRY_SLEEP_SECONDS"
  done

  # Step 2: Fail clearly when the service never becomes healthy in time.
  echo "$service_name did not become healthy in time: $status_url" >&2
  return 1
}


# Step 1: Move to the repository root so all delegated scripts resolve relative paths consistently.
cd "$REPO_ROOT"

# Step 2: Stop the WebUI first so its live session bookkeeping is closed before the model server stops.
bash "$SCRIPT_DIR/stop_webui_mylinux.sh" "$WEBUI_PORT"

# Step 3: Stop the model server after the WebUI has detached from any live sessions.
WEBUI_PORT="$WEBUI_PORT" bash "$SCRIPT_DIR/stop_server_mylinux.sh" "$MODEL_PORT"

# Step 4: Restart the model server and optionally pass through a custom log file path.
if [[ -n "$SERVER_LOG_FILE" ]]; then
  bash "$SCRIPT_DIR/start_server_mylinux.sh" "$CKPT_PATH" "$MODEL_PORT" "$SERVER_LOG_FILE"
else
  bash "$SCRIPT_DIR/start_server_mylinux.sh" "$CKPT_PATH" "$MODEL_PORT"
fi

# Step 5: Wait for the model server status endpoint before bringing the WebUI back up.
wait_for_status "Model server" "$SERVER_STATUS_URL"

# Step 6: Restart the WebUI and optionally pass through a custom log file path.
if [[ -n "$WEBUI_LOG_FILE" ]]; then
  bash "$SCRIPT_DIR/start_webui_mylinux.sh" "$WEBUI_PORT" "$WEBUI_LOG_FILE"
else
  bash "$SCRIPT_DIR/start_webui_mylinux.sh" "$WEBUI_PORT"
fi

# Step 7: Wait for the WebUI status endpoint and print both final status URLs.
wait_for_status "WebUI" "$WEBUI_STATUS_URL"
echo "Model server status: $SERVER_STATUS_URL"
echo "WebUI status: $WEBUI_STATUS_URL"