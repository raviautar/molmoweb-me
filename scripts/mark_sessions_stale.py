import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now_iso() -> str:
    # Step 1: Generate a UTC timestamp used for consistent archived-session updates.
    return datetime.now(timezone.utc).isoformat()


def mark_sessions_inactive(sessions_root: Path, reason: str, running_state: str, idle_state: str) -> tuple[int, int]:
    # Step 1: Collect all persisted session metadata files under the artifact root.
    session_files = sorted(sessions_root.glob("*/session.json"))
    marked_count = 0
    running_count = 0

    # Step 2: Rewrite any still-live sessions as stale/closed on disk.
    for session_file in session_files:
        metadata = json.loads(session_file.read_text(encoding="utf-8"))
        if not metadata.get("live", False):
            continue

        was_running = metadata.get("run_state") == "running"
        closed_at = utc_now_iso()
        metadata["live"] = False
        metadata["closed_at"] = closed_at
        metadata["updated_at"] = closed_at
        metadata["current_prompt"] = ""
        metadata["run_state"] = running_state if was_running else idle_state
        metadata["last_error"] = f"{reason} while session was running" if was_running else reason
        session_file.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        marked_count += 1
        if was_running:
            running_count += 1

    # Step 3: Return a compact summary for the caller.
    return marked_count, running_count


def main() -> int:
    # Step 1: Parse command-line arguments for the target session directory and inactive-state labels.
    parser = argparse.ArgumentParser(description="Mark persisted MolmoWeb sessions stale or closed.")
    parser.add_argument("--sessions-root", default="logs/webui_sessions")
    parser.add_argument("--reason", required=True)
    parser.add_argument("--running-state", required=True)
    parser.add_argument("--idle-state", required=True)
    args = parser.parse_args()

    # Step 2: Apply the inactive-state rewrite and print a concise summary.
    marked_count, running_count = mark_sessions_inactive(
        sessions_root=Path(args.sessions_root),
        reason=args.reason,
        running_state=args.running_state,
        idle_state=args.idle_state,
    )
    print(f"Marked {marked_count} session(s) inactive; {running_count} were running.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
