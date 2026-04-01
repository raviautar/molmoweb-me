from __future__ import annotations

import base64
import io
import json
import queue
import re
import shutil
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from PIL import Image

from agent.actions import SendMsgToUser
from inference import MolmoWeb
from inference.web_episode import Trajectory, save_trajectory_screenshots_png


def _utc_now_iso() -> str:
    # Step 1: Generate a stable UTC timestamp string for persisted artifacts.
    return datetime.now(timezone.utc).isoformat()


def _read_json_file(file_path: Path, default: Any) -> Any:
    # Step 1: Return the provided default quickly when the file does not exist yet.
    if not file_path.exists():
        return default

    # Step 2: Load and return the JSON payload from disk.
    return json.loads(file_path.read_text(encoding="utf-8"))


def _write_json_file(file_path: Path, payload: Any) -> None:
    # Step 1: Ensure the parent directory exists before writing.
    file_path.parent.mkdir(parents=True, exist_ok=True)

    # Step 2: Persist the payload with stable indentation for later inspection.
    file_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _image_to_base64(img: Image.Image) -> str:
    # Step 1: Encode a PIL image as a PNG payload for model-service requests.
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _fallback_session_title(prompt: str) -> str:
    # Step 1: Normalize whitespace and remove common leading imperative phrases.
    normalized = re.sub(r"\s+", " ", prompt).strip()
    normalized = re.sub(r"^(go to|open|find|check|look up|search for)\s+", "", normalized, flags=re.IGNORECASE)

    # Step 2: Truncate the fallback title to a short operator-friendly phrase.
    words = normalized.split(" ")
    fallback_title = " ".join(words[:6]).strip()
    return fallback_title or "Untitled Session"


def _sanitize_title(raw_title: str, prompt: str) -> str:
    # Step 1: Collapse the raw title response to a single concise line.
    title = raw_title.strip().splitlines()[0].strip()
    title = title.strip("\"'`[](){}:;,. ")
    title = re.sub(r"\s+", " ", title)

    # Step 2: Fall back when the model returns an empty or obviously noisy title.
    if not title or len(title) > 80:
        return _fallback_session_title(prompt)
    return title


@dataclass
class WorkerTask:
    task_type: str
    payload: dict[str, Any] = field(default_factory=dict)
    done_event: threading.Event = field(default_factory=threading.Event)
    result: Any = None
    error: Exception | None = None


@dataclass
class SessionRuntime:
    session_id: str
    metadata: dict[str, Any]
    session_dir: Path
    client: MolmoWeb | None = None
    lock: threading.RLock = field(default_factory=threading.RLock)
    task_queue: queue.Queue[WorkerTask] | None = None
    worker_thread: threading.Thread | None = None
    ready_event: threading.Event = field(default_factory=threading.Event)
    startup_error: str = ""


class SessionManager:
    def __init__(self, sessions_root: Path, default_endpoint: str):
        # Step 1: Store the root settings and initialize the shared session registry.
        self.sessions_root = sessions_root
        self.default_endpoint = default_endpoint
        self._sessions: dict[str, SessionRuntime] = {}
        self._registry_lock = threading.RLock()

        # Step 2: Ensure the artifact root exists and load archived sessions from disk.
        self.sessions_root.mkdir(parents=True, exist_ok=True)
        self._load_existing_sessions()

    def _load_existing_sessions(self) -> None:
        # Step 1: Scan the session root for previously persisted session metadata files.
        session_files = sorted(self.sessions_root.glob("*/session.json"))

        # Step 2: Register archived sessions so they can be analyzed in the UI.
        for session_file in session_files:
            metadata = _read_json_file(session_file, default={})
            if not metadata:
                continue
            session_id = metadata.get("session_id") or session_file.parent.name
            metadata["session_id"] = session_id
            metadata.setdefault("title", "Untitled Session")
            metadata.setdefault("title_pending", False)
            metadata.setdefault("title_source", "archive")
            metadata.setdefault("run_state", "idle")
            metadata.setdefault("current_turn_index", 0)
            metadata.setdefault("current_step_index", 0)
            metadata.setdefault("current_prompt", "")
            metadata.setdefault("last_error", "")
            metadata.setdefault("completion_status", "")
            if metadata.get("live", False):
                metadata["closed_at"] = metadata.get("closed_at") or metadata.get("updated_at", "")
                if metadata.get("run_state") == "running":
                    metadata["run_state"] = "closed"
            metadata["live"] = False
            _write_json_file(session_file, metadata)
            self._sessions[session_id] = SessionRuntime(
                session_id=session_id,
                metadata=metadata,
                session_dir=session_file.parent,
            )

    def _session_dir(self, session_id: str) -> Path:
        # Step 1: Resolve the artifact directory for the requested session identifier.
        return self.sessions_root / session_id

    def _artifact_url(self, file_path: Path) -> str:
        # Step 1: Convert a filesystem path inside the artifact root into a browser URL.
        relative_path = file_path.relative_to(self.sessions_root)
        return f"/webui-artifacts/{relative_path.as_posix()}"

    def _session_json_path(self, runtime: SessionRuntime) -> Path:
        # Step 1: Resolve the canonical metadata file for a session.
        return runtime.session_dir / "session.json"

    def _turns_dir(self, runtime: SessionRuntime) -> Path:
        # Step 1: Resolve the directory that stores turn artifacts for a session.
        return runtime.session_dir / "turns"

    def _append_text_line(self, file_path: Path, line: str) -> None:
        # Step 1: Ensure the parent directory exists before appending.
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Step 2: Append the provided line using UTF-8 encoding.
        with file_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    def _append_jsonl_line(self, file_path: Path, payload: dict[str, Any]) -> None:
        # Step 1: Serialize the payload as a single JSON line for log streaming and replay.
        self._append_text_line(file_path, json.dumps(payload, ensure_ascii=True))

    def _write_session_metadata(self, runtime: SessionRuntime) -> None:
        # Step 1: Persist the latest session metadata for later UI reloads.
        _write_json_file(self._session_json_path(runtime), runtime.metadata)

    def _mark_runtime_inactive(self, runtime: SessionRuntime, run_state: str, reason: str = "") -> None:
        # Step 1: Skip duplicate work when the session is already archived.
        if not runtime.metadata.get("live", False):
            return

        # Step 2: Persist the archived state so the UI stops presenting the session as live.
        closed_at = _utc_now_iso()
        with runtime.lock:
            runtime.client = None
            runtime.task_queue = None
            runtime.worker_thread = None
            runtime.metadata["live"] = False
            runtime.metadata["run_state"] = run_state
            runtime.metadata["current_prompt"] = ""
            runtime.metadata["updated_at"] = closed_at
            runtime.metadata["closed_at"] = closed_at
            if reason:
                runtime.metadata["last_error"] = reason
            self._write_session_metadata(runtime)
            self._append_jsonl_line(
                runtime.session_dir / "events.jsonl",
                {
                    "timestamp": closed_at,
                    "type": "session_closed",
                    "text": reason or run_state,
                },
            )

    def _turn_json_paths(self, runtime: SessionRuntime) -> list[Path]:
        # Step 1: Collect all persisted turn metadata files in ascending order.
        return sorted(self._turns_dir(runtime).glob("turn_*/turn.json"))

    def _load_turn_records(self, runtime: SessionRuntime) -> list[dict[str, Any]]:
        # Step 1: Load each persisted turn file from disk.
        turn_records = [_read_json_file(turn_path, default={}) for turn_path in self._turn_json_paths(runtime)]

        # Step 2: Filter out any empty records that may come from interrupted writes.
        return [turn_record for turn_record in turn_records if turn_record]

    def _extract_assistant_text(self, trajectory: Trajectory, max_steps: int) -> tuple[str, str]:
        # Step 1: Search for the first explicit answer emitted by the agent.
        last_message = ""
        for step in trajectory.steps:
            if step.prediction is None:
                continue
            action = step.prediction.action
            if isinstance(action, SendMsgToUser):
                last_message = action.msg
                if action.msg.startswith("[ANSWER]"):
                    return action.msg.removeprefix("[ANSWER]").strip(), "answered"
                if action.msg.startswith("[EXIT]"):
                    return action.msg.removeprefix("[EXIT]").strip() or action.msg, "stopped"

        # Step 2: Surface explicit terminal errors before falling back to action strings.
        if trajectory.steps and trajectory.steps[-1].error:
            return str(trajectory.steps[-1].error), "error"

        # Step 3: Report that the run exhausted the step budget when no final answer was produced.
        if trajectory.steps and len(trajectory.steps) >= max_steps:
            return "Run reached the max step limit before producing a final answer.", "max_steps"

        # Step 4: Fall back to the last user-visible message or the last structured action string.
        if last_message:
            return last_message.removeprefix("[EXIT]").strip() or last_message, "message"

        if trajectory.steps and trajectory.steps[-1].prediction is not None:
            return trajectory.steps[-1].prediction.to_str(), "action"

        return "", "empty"

    def _live_turn_summary(self, trajectory: Trajectory) -> str:
        # Step 1: Show a generic progress message while no steps have been recorded yet.
        if not trajectory.steps:
            return "Run in progress..."

        last_step = trajectory.steps[-1]

        # Step 2: Surface errors as soon as they occur.
        if last_step.error:
            return str(last_step.error)

        # Step 3: Prefer user-facing messages when the agent has emitted one.
        if last_step.prediction is not None and isinstance(last_step.prediction.action, SendMsgToUser):
            return last_step.prediction.action.msg

        # Step 4: Fall back to the latest structured action while the run is still in progress.
        if last_step.prediction is not None:
            return last_step.prediction.to_str()

        return "Run in progress..."

    def _write_live_turn_artifacts(
        self,
        runtime: SessionRuntime,
        turn_index: int,
        prompt: str,
        max_steps: int,
        turn_started_at: str,
        trajectory: Trajectory,
    ) -> None:
        # Step 1: Stop early when there is no recorded step yet.
        if not trajectory.steps:
            return

        turn_dir = self._turns_dir(runtime) / f"turn_{turn_index:03d}"
        screenshots_dir = turn_dir / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)
        latest_step = trajectory.steps[-1]
        screenshot_path = screenshots_dir / f"step_{len(trajectory.steps) - 1:03d}.png"

        # Step 2: Persist the latest screenshot as soon as it becomes available.
        if latest_step.state is not None and latest_step.state.img is not None and not screenshot_path.exists():
            latest_step.state.img.save(screenshot_path, format="PNG")

        # Step 3: Build the current live turn record that the UI can poll while the run is active.
        snapshot_paths = sorted(screenshots_dir.glob("step_*.png"))
        partial_turn = {
            "turn_index": turn_index,
            "prompt": prompt,
            "assistant_text": self._live_turn_summary(trajectory),
            "completion_status": "running",
            "started_at": turn_started_at,
            "completed_at": "",
            "max_steps": max_steps,
            "trajectory_html_url": "",
            "trajectory_html_path": "",
            "snapshot_urls": [self._artifact_url(path) for path in snapshot_paths],
            "snapshot_paths": [str(path) for path in snapshot_paths],
            "step_count": len(trajectory.steps),
            "steps": self._build_step_summaries(runtime.session_id, turn_index, trajectory),
            "final_page_url": latest_step.state.page_url if latest_step.state is not None else "",
            "final_page_title": latest_step.state.page_title if latest_step.state is not None else "",
            "final_error": latest_step.error or "",
        }
        _write_json_file(turn_dir / "turn.json", partial_turn)

        # Step 4: Keep the session summary current so the sidebar and workspace update live.
        with runtime.lock:
            runtime.metadata["updated_at"] = _utc_now_iso()
            runtime.metadata["current_step_index"] = len(trajectory.steps)
            runtime.metadata["latest_snapshot_url"] = self._artifact_url(snapshot_paths[-1]) if snapshot_paths else ""
            runtime.metadata["completion_status"] = "running"
            self._write_session_metadata(runtime)

    def _build_step_summaries(self, session_id: str, turn_index: int, trajectory: Trajectory) -> list[dict[str, Any]]:
        # Step 1: Iterate through the trajectory and map each step to a UI-friendly summary.
        step_summaries: list[dict[str, Any]] = []
        screenshot_root = self._session_dir(session_id) / "turns" / f"turn_{turn_index:03d}" / "screenshots"

        for step_index, step in enumerate(trajectory.steps):
            screenshot_path = screenshot_root / f"step_{step_index:03d}.png"
            step_summaries.append(
                {
                    "step_index": step_index + 1,
                    "page_url": step.state.page_url if step.state is not None else "",
                    "page_title": step.state.page_title if step.state is not None else "",
                    "action_name": step.prediction.name if step.prediction is not None else "",
                    "action_text": step.prediction.to_str() if step.prediction is not None else "",
                    "thought": step.prediction.thought if step.prediction is not None else "",
                    "message": (
                        step.prediction.action.msg
                        if step.prediction is not None and isinstance(step.prediction.action, SendMsgToUser)
                        else ""
                    ),
                    "error": step.error or "",
                    "snapshot_url": self._artifact_url(screenshot_path) if screenshot_path.exists() else "",
                }
            )

        return step_summaries

    def _create_runtime_metadata(
        self,
        session_id: str,
        title: str,
        endpoint: str,
        local: bool,
        headless: bool,
        max_steps_default: int,
        title_pending: bool,
    ) -> dict[str, Any]:
        # Step 1: Build the initial persisted session metadata structure.
        created_at = _utc_now_iso()
        session_dir = self._session_dir(session_id)
        return {
            "session_id": session_id,
            "title": title,
            "title_pending": title_pending,
            "title_source": "pending" if title_pending else "user",
            "created_at": created_at,
            "updated_at": created_at,
            "closed_at": "",
            "live": True,
            "endpoint": endpoint,
            "local": local,
            "headless": headless,
            "max_steps_default": max_steps_default,
            "turn_count": 0,
            "current_turn_index": 0,
            "current_step_index": 0,
            "run_state": "idle",
            "current_prompt": "",
            "last_prompt": "",
            "last_answer": "",
            "completion_status": "",
            "last_error": "",
            "latest_snapshot_url": "",
            "session_dir": str(session_dir),
            "chat_transcript_path": str(session_dir / "chat_transcript.txt"),
            "event_log_path": str(session_dir / "events.jsonl"),
        }

    def _generate_session_title(self, runtime: SessionRuntime, prompt: str, trajectory: Trajectory, turn_index: int) -> tuple[str, str]:
        # Step 1: Fall back immediately when no final screenshot is available.
        final_step = trajectory.steps[-1] if trajectory.steps else None
        if final_step is None or final_step.state is None or final_step.state.img is None:
            return _fallback_session_title(prompt), "fallback"

        # Step 2: Ask the model service for a concise session title using the final screenshot.
        title_prompt = (
            "Generate a concise neutral task label of 3 to 6 words for this browser session. "
            "Do not answer the task. Do not infer an outcome that is not explicitly shown. "
            f"Original task: {prompt} "
            "Return plain text only."
        )
        payload = {
            "prompt": title_prompt,
            "image_base64": _image_to_base64(final_step.state.img),
            "request_context": {
                "session_id": runtime.session_id,
                "session_title": runtime.metadata.get("title", "Untitled Session"),
                "turn_index": turn_index,
                "step_index": len(trajectory.steps),
                "max_steps": len(trajectory.steps),
                "page_url": final_step.state.page_url,
                "page_title": final_step.state.page_title,
                "query": title_prompt,
            },
        }

        try:
            response = requests.post(f"{runtime.metadata['endpoint'].rstrip('/')}/predict", json=payload, timeout=120)
            response.raise_for_status()
            raw_title = response.json()
            if not isinstance(raw_title, str):
                raw_title = str(raw_title)
            return _sanitize_title(raw_title, prompt), "model"
        except Exception:
            return _fallback_session_title(prompt), "fallback"

    def _is_client_live_on_worker(self, runtime: SessionRuntime) -> bool:
        # Step 1: Return early when the session no longer has an initialized client object.
        if runtime.client is None:
            return False

        # Step 2: Treat a pre-first-turn session as live even before the browser env is created.
        if runtime.client.env is None:
            return True

        env = runtime.client.env

        # Step 3: Check the underlying Playwright browser and page handles on the owning thread.
        try:
            if env.browser is None or env.page is None:
                return False
            if hasattr(env.browser, "is_connected") and not env.browser.is_connected():
                return False
            if env.page.is_closed():
                return False
        except Exception:
            return False

        # Step 4: Treat the session as live only when the browser primitives are still usable.
        return True

    def _session_worker(self, runtime: SessionRuntime) -> None:
        # Step 1: Create the browser client on the dedicated worker thread.
        try:
            runtime.client = MolmoWeb(
                endpoint=runtime.metadata["endpoint"],
                local=bool(runtime.metadata["local"]),
                keep_alive=True,
                headless=bool(runtime.metadata["headless"]),
                verbose=False,
                session_id=runtime.session_id,
                session_title=runtime.metadata.get("title", "Untitled Session"),
            )
        except Exception as exc:
            runtime.startup_error = str(exc)
            runtime.ready_event.set()
            return

        runtime.ready_event.set()

        # Step 2: Process queued session tasks on the same thread for the lifetime of the session.
        while True:
            assert runtime.task_queue is not None
            task = runtime.task_queue.get()
            try:
                if task.task_type == "run_turn":
                    task.result = self._run_turn_on_worker(
                        runtime=runtime,
                        prompt=str(task.payload["prompt"]),
                        max_steps=task.payload.get("max_steps"),
                    )
                elif task.task_type == "close":
                    if runtime.client is not None:
                        runtime.client.close()
                        runtime.client = None
                    task.result = True
                    return
                elif task.task_type == "is_live":
                    task.result = self._is_client_live_on_worker(runtime)
                    if not task.result:
                        if runtime.client is not None:
                            runtime.client.close()
                            runtime.client = None
                        return
                else:
                    raise ValueError(f"Unsupported task type: {task.task_type}")
            except Exception as exc:
                task.error = exc
            finally:
                task.done_event.set()

    def _refresh_runtime_liveness(self, runtime: SessionRuntime) -> bool:
        # Step 1: Return the persisted state immediately for archived sessions.
        if not runtime.metadata.get("live", False):
            return False

        # Step 2: Keep actively running sessions live until the worker reports a terminal result.
        if runtime.metadata.get("run_state") == "running":
            return True

        # Step 3: Archive the session when the worker thread has already stopped.
        if runtime.worker_thread is None or not runtime.worker_thread.is_alive():
            self._mark_runtime_inactive(runtime, run_state="closed", reason="Browser worker stopped")
            return False

        # Step 4: Ask the worker thread whether the Playwright browser is still open.
        try:
            is_live = bool(self._submit_task(runtime, "is_live", {}, timeout_seconds=2.0))
        except Exception as exc:
            self._mark_runtime_inactive(runtime, run_state="closed", reason=f"Worker liveness check failed: {exc}")
            is_live = False

        # Step 5: Persist the archived state when the browser has been closed externally.
        if not is_live:
            self._mark_runtime_inactive(runtime, run_state="closed", reason="Browser window closed")
            return False

        return True

    def _start_runtime_worker(self, runtime: SessionRuntime) -> None:
        # Step 1: Start the dedicated worker thread for this live browser session.
        runtime.task_queue = queue.Queue()
        runtime.worker_thread = threading.Thread(
            target=self._session_worker,
            args=(runtime,),
            name=f"molmoweb-session-{runtime.session_id}",
            daemon=True,
        )
        runtime.worker_thread.start()

        # Step 2: Block until the session worker finishes initialization.
        runtime.ready_event.wait(timeout=60)
        if runtime.startup_error:
            raise RuntimeError(runtime.startup_error)
        if runtime.client is None:
            raise RuntimeError("Session worker did not initialize the browser client")

    def _submit_task(
        self,
        runtime: SessionRuntime,
        task_type: str,
        payload: dict[str, Any],
        timeout_seconds: float | None = None,
    ) -> Any:
        # Step 1: Validate that the session still has a live worker thread.
        if runtime.task_queue is None or runtime.worker_thread is None or not runtime.worker_thread.is_alive():
            raise RuntimeError("Session worker is not available")

        # Step 2: Enqueue the task and wait synchronously for the worker-thread result.
        task = WorkerTask(task_type=task_type, payload=payload)
        runtime.task_queue.put(task)
        finished = task.done_event.wait(timeout=timeout_seconds)
        if not finished:
            raise TimeoutError(f"Session worker timed out while handling {task_type}")
        if task.error is not None:
            raise task.error
        return task.result

    def create_session(
        self,
        title: str | None,
        endpoint: str | None,
        local: bool,
        headless: bool,
        max_steps_default: int,
    ) -> dict[str, Any]:
        # Step 1: Generate a stable session identifier and resolve the session defaults.
        session_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        title_pending = not (title and title.strip())
        session_title = title.strip() if title and title.strip() else "Untitled Session"
        session_endpoint = endpoint.strip() if endpoint and endpoint.strip() else self.default_endpoint
        session_dir = self._session_dir(session_id)

        # Step 2: Create, persist, and start the live session runtime.
        with self._registry_lock:
            runtime = SessionRuntime(
                session_id=session_id,
                metadata=self._create_runtime_metadata(
                    session_id=session_id,
                    title=session_title,
                    endpoint=session_endpoint,
                    local=local,
                    headless=headless,
                    max_steps_default=max_steps_default,
                    title_pending=title_pending,
                ),
                session_dir=session_dir,
            )
            runtime.session_dir.mkdir(parents=True, exist_ok=True)
            self._sessions[session_id] = runtime
            self._write_session_metadata(runtime)
            self._start_runtime_worker(runtime)

        # Step 3: Return the session detail payload used by the UI.
        return self.get_session_detail(session_id)

    def list_sessions(self) -> list[dict[str, Any]]:
        # Step 1: Refresh the liveness of idle sessions before building the sidebar payload.
        with self._registry_lock:
            runtimes = list(self._sessions.values())

        for runtime in runtimes:
            self._refresh_runtime_liveness(runtime)

        # Step 2: Snapshot the current registry under the shared lock.
        with self._registry_lock:
            sessions = [dict(runtime.metadata) for runtime in self._sessions.values()]

        # Step 3: Sort sessions by most recently updated first for the left-side explorer.
        sessions.sort(key=lambda session: session.get("updated_at", ""), reverse=True)
        return sessions

    def get_session_detail(self, session_id: str) -> dict[str, Any]:
        # Step 1: Resolve the requested runtime or fail clearly if it does not exist.
        runtime = self._sessions.get(session_id)
        if runtime is None:
            raise KeyError(f"Unknown session_id: {session_id}")

        # Step 2: Refresh liveness so the detail view reflects a manually closed browser.
        self._refresh_runtime_liveness(runtime)

        # Step 3: Load all persisted turns and return the full detail payload for the UI.
        return {
            **runtime.metadata,
            "turns": self._load_turn_records(runtime),
        }

    def _run_turn_on_worker(self, runtime: SessionRuntime, prompt: str, max_steps: int | None) -> dict[str, Any]:
        # Step 1: Validate that the worker thread still owns a live browser client.
        if runtime.client is None:
            raise RuntimeError("This session does not have a live browser client")

        # Step 2: Mark the session as actively running before browser execution begins.
        with runtime.lock:
            turn_index = int(runtime.metadata.get("turn_count", 0)) + 1
            effective_max_steps = max_steps or int(runtime.metadata.get("max_steps_default", 15))
            turn_started_at = _utc_now_iso()
            runtime.metadata["run_state"] = "running"
            runtime.metadata["current_turn_index"] = turn_index
            runtime.metadata["current_step_index"] = 0
            runtime.metadata["current_prompt"] = prompt
            runtime.metadata["last_error"] = ""
            runtime.metadata["updated_at"] = turn_started_at
            self._write_session_metadata(runtime)
            self._append_jsonl_line(
                runtime.session_dir / "events.jsonl",
                {
                    "timestamp": turn_started_at,
                    "type": "turn_started",
                    "turn_index": turn_index,
                    "text": prompt,
                },
            )

        try:
            # Step 3: Execute the browser turn entirely on the dedicated session thread.
            trajectory = runtime.client.run(
                query=prompt,
                max_steps=effective_max_steps,
                step_callback=lambda _step_num, live_trajectory: self._write_live_turn_artifacts(
                    runtime=runtime,
                    turn_index=turn_index,
                    prompt=prompt,
                    max_steps=effective_max_steps,
                    turn_started_at=turn_started_at,
                    trajectory=live_trajectory,
                ),
            )
        except Exception as exc:
            # Step 4: Persist the failure cleanly so the UI can surface it without a stack trace.
            failure_time = _utc_now_iso()
            with runtime.lock:
                runtime.metadata["run_state"] = "error"
                runtime.metadata["last_error"] = str(exc)
                runtime.metadata["updated_at"] = failure_time
                self._write_session_metadata(runtime)
                self._append_jsonl_line(
                    runtime.session_dir / "events.jsonl",
                    {
                        "timestamp": failure_time,
                        "type": "turn_error",
                        "turn_index": turn_index,
                        "text": str(exc),
                    },
                )
            raise RuntimeError(f"Browser session failed: {exc}") from exc

        # Step 5: Build the persisted artifacts for the completed turn.
        turn_dir = self._turns_dir(runtime) / f"turn_{turn_index:03d}"
        screenshots_dir = turn_dir / "screenshots"
        screenshots = save_trajectory_screenshots_png(trajectory, screenshots_dir, prefix="step")
        trajectory_html_path = Path(trajectory.save_html(output_path=str(turn_dir / "trajectory.html"), query=prompt))
        assistant_text, completion_status = self._extract_assistant_text(trajectory, effective_max_steps)
        step_summaries = self._build_step_summaries(runtime.session_id, turn_index, trajectory)
        latest_snapshot_path = Path(screenshots[-1]) if screenshots else None
        if latest_snapshot_path is not None:
            shutil.copy2(latest_snapshot_path, runtime.session_dir / "latest.png")
        final_step = trajectory.steps[-1] if trajectory.steps else None
        turn_completed_at = _utc_now_iso()

        # Step 6: Ask the model service to title the session after the first completed turn when needed.
        generated_title = runtime.metadata.get("title", "Untitled Session")
        generated_title_source = runtime.metadata.get("title_source", "user")
        if turn_index == 1 and runtime.metadata.get("title_pending", False):
            generated_title, generated_title_source = self._generate_session_title(runtime, prompt, trajectory, turn_index)
            runtime.client.session_title = generated_title

        # Step 7: Persist the structured turn artifacts for later analysis in the UI.
        turn_record = {
            "turn_index": turn_index,
            "prompt": prompt,
            "assistant_text": assistant_text,
            "completion_status": completion_status,
            "started_at": turn_started_at,
            "completed_at": turn_completed_at,
            "max_steps": effective_max_steps,
            "trajectory_html_url": self._artifact_url(trajectory_html_path),
            "trajectory_html_path": str(trajectory_html_path),
            "snapshot_urls": [self._artifact_url(Path(path)) for path in screenshots],
            "snapshot_paths": screenshots,
            "step_count": len(trajectory.steps),
            "steps": step_summaries,
            "final_page_url": final_step.state.page_url if final_step and final_step.state is not None else "",
            "final_page_title": final_step.state.page_title if final_step and final_step.state is not None else "",
            "final_error": final_step.error if final_step is not None and final_step.error is not None else "",
        }
        _write_json_file(turn_dir / "turn.json", turn_record)

        # Step 8: Append transcript and structured event records for the new turn.
        transcript_path = runtime.session_dir / "chat_transcript.txt"
        events_path = runtime.session_dir / "events.jsonl"
        self._append_text_line(transcript_path, f"[{turn_started_at}] USER: {prompt}")
        self._append_text_line(transcript_path, f"[{turn_completed_at}] ASSISTANT: {assistant_text}")
        self._append_jsonl_line(events_path, {"timestamp": turn_started_at, "type": "user", "text": prompt})
        self._append_jsonl_line(
            events_path,
            {
                "timestamp": turn_completed_at,
                "type": "assistant",
                "text": assistant_text,
                "completion_status": completion_status,
                "turn_index": turn_index,
            },
        )

        # Step 9: Update the live session summary so the UI reflects the completed turn immediately.
        with runtime.lock:
            runtime.metadata["title"] = generated_title
            runtime.metadata["title_pending"] = False
            runtime.metadata["title_source"] = generated_title_source
            runtime.metadata["updated_at"] = turn_completed_at
            runtime.metadata["turn_count"] = turn_index
            runtime.metadata["current_turn_index"] = turn_index
            runtime.metadata["current_step_index"] = len(trajectory.steps)
            runtime.metadata["run_state"] = "idle"
            runtime.metadata["current_prompt"] = ""
            runtime.metadata["last_prompt"] = prompt
            runtime.metadata["last_answer"] = assistant_text
            runtime.metadata["completion_status"] = completion_status
            runtime.metadata["last_error"] = turn_record["final_error"]
            runtime.metadata["latest_snapshot_url"] = (
                self._artifact_url(runtime.session_dir / "latest.png") if latest_snapshot_path is not None else ""
            )
            runtime.metadata["live"] = True
            self._write_session_metadata(runtime)

        # Step 10: Return the refreshed session detail payload to the caller.
        return self.get_session_detail(runtime.session_id)

    def run_turn(self, session_id: str, prompt: str, max_steps: int | None) -> dict[str, Any]:
        # Step 1: Resolve the runtime and ensure it still has a live session worker attached.
        runtime = self._sessions.get(session_id)
        if runtime is None:
            raise KeyError(f"Unknown session_id: {session_id}")
        if not self._refresh_runtime_liveness(runtime):
            raise ValueError("This session is archived and cannot continue running browser actions")

        # Step 2: Execute the turn on the session's dedicated worker thread.
        return self._submit_task(runtime, "run_turn", {"prompt": prompt, "max_steps": max_steps})

    def close_session(self, session_id: str) -> dict[str, Any]:
        # Step 1: Resolve the runtime or fail clearly if the session does not exist.
        runtime = self._sessions.get(session_id)
        if runtime is None:
            raise KeyError(f"Unknown session_id: {session_id}")

        # Step 2: Stop the live worker thread when one is still attached.
        if runtime.worker_thread is not None:
            self._submit_task(runtime, "close", {})
            if runtime.worker_thread.is_alive():
                runtime.worker_thread.join(timeout=5)

        # Step 3: Persist the archived state for later UI analysis.
        self._mark_runtime_inactive(runtime, run_state="closed")

        # Step 4: Return the updated session detail payload for UI refresh.
        return self.get_session_detail(session_id)

    def close_all_live_sessions(self) -> None:
        # Step 1: Snapshot all known session identifiers under the registry lock.
        with self._registry_lock:
            session_ids = list(self._sessions.keys())

        # Step 2: Close each live session so browser processes are released during shutdown.
        for session_id in session_ids:
            runtime = self._sessions.get(session_id)
            if runtime is not None and runtime.worker_thread is not None:
                self.close_session(session_id)

    def mark_all_live_sessions_inactive(self, running_state: str, idle_state: str, reason: str) -> dict[str, int]:
        # Step 1: Snapshot the current live runtimes under the registry lock.
        with self._registry_lock:
            runtimes = [runtime for runtime in self._sessions.values() if runtime.metadata.get("live", False)]

        marked_count = 0
        running_count = 0

        # Step 2: Close any still-live browser workers and persist a stale/closed state for each session.
        for runtime in runtimes:
            was_running = runtime.metadata.get("run_state") == "running"
            if was_running:
                running_count += 1
            try:
                if runtime.worker_thread is not None and runtime.worker_thread.is_alive():
                    self._submit_task(runtime, "close", {})
            except Exception:
                pass
            self._mark_runtime_inactive(
                runtime,
                run_state=running_state if was_running else idle_state,
                reason=f"{reason} while session was running" if was_running else reason,
            )
            marked_count += 1

        # Step 3: Return a short summary for the caller and logs.
        return {"marked_count": marked_count, "running_count": running_count}
