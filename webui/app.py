from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import requests

from webui.session_manager import SessionManager


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = Path(__file__).resolve().parent / "static"
ARTIFACT_ROOT = PROJECT_ROOT / "logs" / "webui_sessions"
DEFAULT_MODEL_ENDPOINT = os.environ.get("MOLMOWEB_MODEL_ENDPOINT", "http://127.0.0.1:8001")

session_manager = SessionManager(
    sessions_root=ARTIFACT_ROOT,
    default_endpoint=DEFAULT_MODEL_ENDPOINT,
)


def _get_model_service_status() -> dict:
    # Step 1: Fetch the main model-service status payload from the configured endpoint.
    response = requests.get(f"{DEFAULT_MODEL_ENDPOINT}/status", timeout=30)
    response.raise_for_status()
    return response.json()


def _tail_text_file(file_path: Path, max_lines: int) -> str:
    # Step 1: Return an empty string when the requested file does not exist.
    if not file_path.exists():
        return ""

    # Step 2: Read the full file and return only the final requested lines.
    lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-max_lines:])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Step 1: Yield control to FastAPI while the app is serving requests.
    yield

    # Step 2: Close all live browser sessions during shutdown.
    session_manager.close_all_live_sessions()


app = FastAPI(title="MolmoWeb WebUI", lifespan=lifespan)
app.mount("/webui-static", StaticFiles(directory=STATIC_ROOT), name="webui-static")
app.mount("/webui-artifacts", StaticFiles(directory=ARTIFACT_ROOT), name="webui-artifacts")


class CreateSessionRequest(BaseModel):
    title: str | None = Field(default=None)
    endpoint: str | None = Field(default=None)
    local: bool = Field(default=True)
    headless: bool = Field(default=True)
    max_steps_default: int = Field(default=15, ge=1, le=50)


class SendMessageRequest(BaseModel):
    prompt: str = Field(min_length=1)
    max_steps: int | None = Field(default=None, ge=1, le=50)


@app.get("/")
def index() -> FileResponse:
    # Step 1: Serve the standalone expert UI HTML shell.
    return FileResponse(STATIC_ROOT / "index.html")


@app.get("/api/status")
def webui_status() -> dict:
    # Step 1: Collect the current session inventory for the dashboard summary.
    sessions = session_manager.list_sessions()
    live_count = sum(1 for session in sessions if session.get("live"))
    archived_count = len(sessions) - live_count

    # Step 2: Return a concise server-side status payload for the UI header.
    return {
        "status": "ok",
        "project_root": str(PROJECT_ROOT),
        "artifact_root": str(ARTIFACT_ROOT),
        "default_model_endpoint": DEFAULT_MODEL_ENDPOINT,
        "live_session_count": live_count,
        "archived_session_count": archived_count,
        "total_session_count": len(sessions),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/model-service/status")
def model_service_status() -> dict:
    # Step 1: Proxy the current model-service status into the WebUI backend.
    try:
        return _get_model_service_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach model service: {exc}") from exc


@app.get("/api/model-service/logs")
def model_service_logs(lines: int = 200) -> dict:
    # Step 1: Fetch the model-service status to discover the current log file path.
    try:
        status_payload = _get_model_service_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach model service: {exc}") from exc

    # Step 2: Load and return the requested tail of the model-service log file.
    log_file = status_payload.get("log_file", "")
    if not log_file:
        return {"log_file": "", "lines": [], "text": ""}
    log_path = Path(log_file)
    log_text = _tail_text_file(log_path, max_lines=max(1, min(lines, 1000)))
    return {
        "log_file": str(log_path),
        "text": log_text,
        "lines": log_text.splitlines(),
    }


@app.get("/api/sessions")
def list_sessions() -> list[dict]:
    # Step 1: Return the sidebar session summaries.
    return session_manager.list_sessions()


@app.post("/api/sessions")
def create_session(request: CreateSessionRequest) -> dict:
    # Step 1: Create a new isolated browser session for a new user conversation.
    return session_manager.create_session(
        title=request.title,
        endpoint=request.endpoint,
        local=request.local,
        headless=request.headless,
        max_steps_default=request.max_steps_default,
    )


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    # Step 1: Resolve and return the full session detail payload.
    try:
        return session_manager.get_session_detail(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/sessions/{session_id}/messages")
def send_message(session_id: str, request: SendMessageRequest) -> dict:
    # Step 1: Execute a new turn against the live browser session for this user.
    try:
        return session_manager.run_turn(
            session_id=session_id,
            prompt=request.prompt,
            max_steps=request.max_steps,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected session error: {exc}") from exc


@app.post("/api/sessions/{session_id}/close")
def close_session(session_id: str) -> dict:
    # Step 1: Close the live browser session while keeping its artifacts visible in the UI.
    try:
        return session_manager.close_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc