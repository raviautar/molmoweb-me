import os
import socket
import threading
import time
from html import escape
from pathlib import Path
from typing import Any

# Set before any `olmo` import (lazy in model_backends). Public molmo2 warns if unset.
os.environ.setdefault("MOLMO_DATA_DIR", os.path.join(os.environ.get("TMPDIR", "/tmp"), "molmo_data"))

import queue
import torch
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

import config
from agent.model_backends import HFActionPredictor, NativeActionPredictor
from utils.vis_utils.image import base64_to_numpy_image


SERVER_IMPORT_STARTED_AT = time.time()
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SERVER_PID = os.getpid()
SERVER_HOSTNAME = socket.gethostname()
SERVER_LOG_FILE = os.environ.get("MOLMOWEB_LOG_FILE", "")
SERVER_PORT = int(os.environ.get("PORT", str(config.MODEL_SERVER_PORT)))

CKPT = os.environ.get("CKPT")
if CKPT is None:
    print("Warning: environment variable CKPT is not set")

NUM_PREDICTORS = int(os.environ.get("NUM_PREDICTORS", "1"))
PREDICTOR_TYPE = os.environ.get("PREDICTOR_TYPE", "native")

TEMPERATURE = float(os.environ.get("TEMPERATURE", "0.7"))
TOP_P = float(os.environ.get("TOP_P", "0.8"))
MAX_TRACKED_JOBS = int(os.environ.get("MAX_TRACKED_JOBS", str(config.MAX_TRACKED_JOBS)))
JOB_STATE_LOCK = threading.RLock()
TRACKED_JOBS: dict[str, dict[str, Any]] = {}


def _get_gpu_status() -> list[dict]:
    # Step 1: Return an empty list quickly when CUDA is unavailable.
    if not torch.cuda.is_available():
        return []

    gpu_status = []

    # Step 2: Collect per-device memory and allocation stats for status reporting.
    for device_index in range(torch.cuda.device_count()):
        free_bytes, total_bytes = torch.cuda.mem_get_info(device_index)
        allocated_bytes = torch.cuda.memory_allocated(device_index)
        reserved_bytes = torch.cuda.memory_reserved(device_index)
        gpu_status.append(
            {
                "device_index": device_index,
                "device_name": torch.cuda.get_device_name(device_index),
                "memory_total_mb": round(total_bytes / (1024 * 1024), 2),
                "memory_free_mb": round(free_bytes / (1024 * 1024), 2),
                "memory_used_mb": round((total_bytes - free_bytes) / (1024 * 1024), 2),
                "memory_allocated_mb": round(allocated_bytes / (1024 * 1024), 2),
                "memory_reserved_mb": round(reserved_bytes / (1024 * 1024), 2),
            }
        )

    return gpu_status


def _prune_tracked_jobs() -> None:
    # Step 1: Keep only the most recently updated jobs when the registry grows too large.
    if len(TRACKED_JOBS) <= MAX_TRACKED_JOBS:
        return

    sorted_jobs = sorted(
        TRACKED_JOBS.items(),
        key=lambda item: item[1].get("last_updated_at_epoch", 0.0),
        reverse=True,
    )
    kept_jobs = dict(sorted_jobs[:MAX_TRACKED_JOBS])
    TRACKED_JOBS.clear()
    TRACKED_JOBS.update(kept_jobs)


def _job_key_from_context(request_context: dict[str, Any] | None) -> str:
    # Step 1: Prefer a stable session identifier so the same browser session collapses into one tracked job.
    if request_context is None:
        return f"anonymous-{time.time_ns()}"
    if request_context.get("session_id"):
        return str(request_context["session_id"])
    return f"anonymous-{time.time_ns()}"


def _update_job_state(
    request_context: dict[str, Any] | None,
    state: str,
    started_at_epoch: float | None = None,
    error: str = "",
) -> str:
    # Step 1: Resolve the tracked job key for this request.
    job_key = _job_key_from_context(request_context)
    now = time.time()

    # Step 2: Merge the request context into the in-memory job registry.
    with JOB_STATE_LOCK:
        job_record = TRACKED_JOBS.get(job_key, {"job_key": job_key, "first_seen_at_epoch": now})
        if request_context is not None:
            job_record.update(
                {
                    "session_id": request_context.get("session_id", ""),
                    "session_title": request_context.get("session_title", ""),
                    "turn_index": request_context.get("turn_index", 0),
                    "step_index": request_context.get("step_index", 0),
                    "max_steps": request_context.get("max_steps", 0),
                    "page_url": request_context.get("page_url", ""),
                    "page_title": request_context.get("page_title", ""),
                    "query": request_context.get("query", ""),
                }
            )
        job_record["state"] = state
        job_record["last_updated_at_epoch"] = now
        if started_at_epoch is not None:
            job_record["started_at_epoch"] = started_at_epoch
        if error:
            job_record["last_error"] = error
        TRACKED_JOBS[job_key] = job_record
        _prune_tracked_jobs()

    # Step 3: Return the resolved job key to the caller for later updates.
    return job_key


def _list_tracked_jobs() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    # Step 1: Snapshot the tracked jobs under the shared lock.
    with JOB_STATE_LOCK:
        tracked_jobs = [dict(job_record) for job_record in TRACKED_JOBS.values()]

    # Step 2: Sort jobs by most recent update and split active from historical entries.
    tracked_jobs.sort(key=lambda job_record: job_record.get("last_updated_at_epoch", 0.0), reverse=True)
    active_jobs = [job_record for job_record in tracked_jobs if job_record.get("state") == "running"]
    return active_jobs, tracked_jobs


def create_predictor_pool(
    ckpt: str,
    num_predictors: int = 1,
    predictor_type: str = "native",
    max_new_tokens: int = 1024,
    temperature: float = 0.7,
    top_p: float = 0.8,
) -> queue.Queue:
    pool: queue.Queue = queue.Queue(maxsize=num_predictors)

    print(f"Using checkpoint: {ckpt}")
    print(f"GPUs: {torch.cuda.device_count()}, predictors: {num_predictors}, type: {predictor_type}")

    for i in range(num_predictors):
        device = f"cuda:{i}"

        if predictor_type == "hf":
            predictor = HFActionPredictor(checkpoint=ckpt, device=device)
        elif predictor_type == "native":
            predictor = NativeActionPredictor(
                checkpoint=ckpt, device=device,
                max_new_tokens=max_new_tokens, temperature=temperature,
                top_p=top_p,
            )
        else:
            raise ValueError(f"Unknown predictor_type: {predictor_type}")

        print(f"Created {type(predictor).__name__} on {device}")
        pool.put(predictor)

    return pool


predictor_pool = create_predictor_pool(
    ckpt=CKPT,
    num_predictors=NUM_PREDICTORS,
    predictor_type=PREDICTOR_TYPE,
    temperature=TEMPERATURE,
    top_p=TOP_P,
)
MODEL_READY_AT = time.time()

app = FastAPI()


def _gpu_memory_percent(gpu_record: dict[str, Any]) -> float:
    # Step 1: Read the GPU memory counters with safe numeric fallbacks.
    total_mb = float(gpu_record.get("memory_total_mb") or 0.0)
    used_mb = float(gpu_record.get("memory_used_mb") or 0.0)

    # Step 2: Return a percentage only when total memory is known.
    if total_mb <= 0.0:
        return 0.0
    return round((used_mb / total_mb) * 100.0, 1)


def _render_status_html(status_payload: dict[str, Any]) -> str:
    # Step 1: Extract the main sections that will be rendered into the HTML dashboard.
    gpu_status = list(status_payload.get("gpu_status") or [])
    active_jobs = list(status_payload.get("active_jobs") or [])

    # Step 2: Build the runtime summary cards at the top of the page.
    summary_cards = [
        (config.MODEL_STATUS_PAGE["summaryLabels"]["status"], status_payload.get("status", "unknown")),
        (config.MODEL_STATUS_PAGE["summaryLabels"]["pid"], str(status_payload.get("pid", "N/A"))),
        (
            config.MODEL_STATUS_PAGE["summaryLabels"]["predictors"],
            f"{status_payload.get('predictor_queue_size', 0)}/{status_payload.get('predictor_queue_capacity', 0)} queued",
        ),
        (config.MODEL_STATUS_PAGE["summaryLabels"]["activeJobs"], str(status_payload.get("active_job_count", 0))),
        (config.MODEL_STATUS_PAGE["summaryLabels"]["loadTime"], f"{status_payload.get('model_load_seconds', 0)} s"),
        (config.MODEL_STATUS_PAGE["summaryLabels"]["uptime"], f"{status_payload.get('uptime_seconds', 0)} s"),
    ]
    summary_html = "".join(
        f"<article class='metric-card'><span class='metric-label'>{escape(label)}</span><span class='metric-value'>{escape(value)}</span></article>"
        for label, value in summary_cards
    )

    # Step 3: Render per-GPU memory cards with an explicit percentage for quick monitoring.
    if gpu_status:
        gpu_html_parts: list[str] = []
        for gpu_record in gpu_status:
            device_label = str(gpu_record.get("device_name") or f"GPU {gpu_record.get('device_index', 0)}")
            gpu_html_parts.append(
                "<article class='gpu-card'>"
                f"<h3>{escape(device_label)}</h3>"
                f"<div class='gpu-percent'>{_gpu_memory_percent(gpu_record)}%</div>"
                f"<p>{escape(str(gpu_record.get('memory_used_mb', 0)))} MB used / {escape(str(gpu_record.get('memory_total_mb', 0)))} MB total</p>"
                "</article>"
            )
        gpu_html = "".join(gpu_html_parts)
    else:
        gpu_html = f"<div class='empty-state'>{escape(config.MODEL_STATUS_PAGE['emptyGpu'])}</div>"

    # Step 4: Render only active jobs so the page stays focused on live work.
    if active_jobs:
        active_job_html = "".join(
            (
                "<article class='job-card'>"
                f"<div class='job-meta'>{escape(str(job.get('state', 'unknown')))} • turn {escape(str(job.get('turn_index', 0)))} • step {escape(str(job.get('step_index', 0)))}/{escape(str(job.get('max_steps', 0)))}</div>"
                f"<h3>{escape(str(job.get('session_title') or job.get('session_id') or job.get('job_key') or 'anonymous request'))}</h3>"
                f"<p>{escape(str(job.get('page_title') or ''))}</p>"
                f"<p class='mono'>{escape(str(job.get('page_url') or ''))}</p>"
                f"<pre>{escape(str(job.get('query') or job.get('last_error') or ''))}</pre>"
                "</article>"
            )
            for job in active_jobs
        )
    else:
        active_job_html = f"<div class='empty-state'>{escape(config.MODEL_STATUS_PAGE['emptyJobs'])}</div>"

    # Step 5: Render the remaining process metadata below the live job section.
    detail_entries = [
        (config.MODEL_STATUS_PAGE["detailLabels"]["projectPath"], status_payload.get("project_path", "")),
        (config.MODEL_STATUS_PAGE["detailLabels"]["logFile"], status_payload.get("log_file", "")),
        (config.MODEL_STATUS_PAGE["detailLabels"]["checkpoint"], status_payload.get("checkpoint", "")),
        (config.MODEL_STATUS_PAGE["detailLabels"]["predictorType"], status_payload.get("predictor_type", "")),
        (config.MODEL_STATUS_PAGE["detailLabels"]["python"], status_payload.get("python_executable", "")),
        (config.MODEL_STATUS_PAGE["detailLabels"]["condaPrefix"], status_payload.get("conda_prefix", "")),
    ]
    details_html = "".join(
        (
            "<div class='detail-row'>"
            f"<span>{escape(label)}</span>"
            f"<span class='mono'>{escape(str(value or 'N/A'))}</span>"
            "</div>"
        )
        for label, value in detail_entries
    )

    # Step 6: Return the final standalone HTML payload with a light auto-refresh.
    return f"""
<!DOCTYPE html>
<html lang='en'>
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <meta http-equiv='refresh' content='{config.MODEL_STATUS_REFRESH_SECONDS}' />
    <title>{escape(config.MODEL_STATUS_PAGE['title'])}</title>
    <style>
      :root {{
        --bg: #06101c;
        --panel: rgba(14, 27, 45, 0.94);
        --panel-strong: rgba(19, 38, 64, 0.98);
        --border: rgba(143, 188, 255, 0.16);
        --text: #e7eefc;
        --muted: #9bb0ce;
        --accent: #6fe3c1;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        padding: 24px;
        color: var(--text);
        font-family: 'Segoe UI', sans-serif;
        background:
          radial-gradient(circle at top left, rgba(111, 227, 193, 0.14), transparent 28%),
          radial-gradient(circle at bottom right, rgba(116, 160, 255, 0.14), transparent 24%),
          linear-gradient(135deg, #040a14 0%, #0a1323 52%, #09111e 100%);
      }}
      .page {{ display: grid; gap: 20px; max-width: 1400px; margin: 0 auto; }}
      .panel {{ background: var(--panel); border: 1px solid var(--border); border-radius: 22px; padding: 20px; }}
      .header h1 {{ margin: 0 0 8px; }}
      .muted {{ color: var(--muted); }}
      .mono {{ font-family: 'IBM Plex Mono', monospace; word-break: break-word; }}
      .metrics, .gpu-grid, .job-grid {{ display: grid; gap: 14px; }}
      .metrics {{ grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }}
      .gpu-grid {{ grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }}
      .job-grid {{ grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }}
      .metric-card, .gpu-card, .job-card {{ background: var(--panel-strong); border-radius: 18px; padding: 16px; border: 1px solid var(--border); }}
      .metric-label, .job-meta, .detail-row span:first-child {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }}
      .metric-value {{ display: block; margin-top: 10px; font-size: 24px; font-weight: 700; }}
      .gpu-percent {{ font-size: 32px; font-weight: 700; color: var(--accent); margin: 12px 0 8px; }}
      .detail-grid {{ display: grid; gap: 10px; }}
      .detail-row {{ display: grid; grid-template-columns: 180px 1fr; gap: 16px; padding: 12px 0; border-bottom: 1px solid rgba(143, 188, 255, 0.08); }}
      .detail-row:last-child {{ border-bottom: 0; }}
      .empty-state {{ color: var(--muted); padding: 18px; border-radius: 16px; border: 1px dashed var(--border); }}
      pre {{ white-space: pre-wrap; margin: 12px 0 0; font-family: inherit; }}
      @media (max-width: 900px) {{
        body {{ padding: 16px; }}
        .detail-row {{ grid-template-columns: 1fr; }}
      }}
    </style>
  </head>
  <body>
    <main class='page'>
      <section class='panel header'>
        <div class='muted'>{escape(config.MODEL_STATUS_PAGE['headerEyebrow'])}</div>
        <h1>{escape(config.MODEL_STATUS_PAGE['headerTitle'])}</h1>
        <p class='muted'>{escape(config.MODEL_STATUS_PAGE['headerSubtitle'])}</p>
      </section>
      <section class='metrics'>{summary_html}</section>
      <section class='panel'>
        <h2>{escape(config.MODEL_STATUS_PAGE['gpuHeading'])}</h2>
        <div class='gpu-grid'>{gpu_html}</div>
      </section>
      <section class='panel'>
        <h2>{escape(config.MODEL_STATUS_PAGE['jobsHeading'])}</h2>
        <div class='job-grid'>{active_job_html}</div>
      </section>
      <section class='panel'>
        <h2>{escape(config.MODEL_STATUS_PAGE['detailsHeading'])}</h2>
        <div class='detail-grid'>{details_html}</div>
      </section>
    </main>
  </body>
</html>
"""


@app.get(config.MODEL_SERVICE_STATUS_PATH)
def status(request: Request, format: str | None = None):
    # Step 1: Compute live uptime and queue depth metrics.
    now = time.time()
    active_jobs, tracked_jobs = _list_tracked_jobs()

    # Step 2: Report runtime, filesystem, and GPU information that helps monitor the process.
    status_payload = {
        "status": "ok",
        "pid": SERVER_PID,
        "hostname": SERVER_HOSTNAME,
        "project_path": str(PROJECT_ROOT),
        "log_file": SERVER_LOG_FILE,
        "port": SERVER_PORT,
        "checkpoint": CKPT,
        "predictor_type": PREDICTOR_TYPE,
        "num_predictors": NUM_PREDICTORS,
        "predictor_queue_size": predictor_pool.qsize(),
        "predictor_queue_capacity": predictor_pool.maxsize,
        "active_job_count": len(active_jobs),
        "active_jobs": active_jobs,
        "tracked_jobs": tracked_jobs,
        "cuda_device_count": torch.cuda.device_count(),
        "gpu_status": _get_gpu_status(),
        "temperature": TEMPERATURE,
        "top_p": TOP_P,
        "server_import_started_at_epoch": round(SERVER_IMPORT_STARTED_AT, 3),
        "model_ready_at_epoch": round(MODEL_READY_AT, 3),
        "model_load_seconds": round(MODEL_READY_AT - SERVER_IMPORT_STARTED_AT, 3),
        "uptime_seconds": round(now - MODEL_READY_AT, 3),
        "python_executable": os.sys.executable,
        "cwd": os.getcwd(),
        "conda_prefix": os.environ.get("CONDA_PREFIX", ""),
        "molmo_data_dir": os.environ.get("MOLMO_DATA_DIR", ""),
    }

    # Step 3: Return HTML for browser visits while preserving JSON for programmatic clients.
    accepts_html = "text/html" in request.headers.get("accept", "")
    wants_html = format == "html" or (format != "json" and accepts_html)
    if wants_html:
        return HTMLResponse(_render_status_html(status_payload))
    return JSONResponse(status_payload)


class PredictRequest(BaseModel):
    prompt: str
    image_base64: str
    past_actions: list | None = None
    temperature: float | None = None
    top_p: float | None = None
    request_context: dict[str, Any] | None = None


@app.post(config.MODEL_SERVICE_PREDICT_PATH)
def predict(request: PredictRequest):
    global predictor_pool

    # Step 1: Decode the incoming image payload.
    image_np = base64_to_numpy_image(request.image_base64)
    request_started_at = time.time()
    job_key = _update_job_state(request.request_context, state="running", started_at_epoch=request_started_at)

    # Step 2: Acquire a predictor from the shared pool.
    try:
        predictor = predictor_pool.get(timeout=config.PREDICTOR_ACQUIRE_TIMEOUT_SECONDS)
    except queue.Empty:
        _update_job_state(request.request_context, state="queue_timeout", started_at_epoch=request_started_at, error="All predictors are busy")
        return "Predictor error: All predictors are busy"

    try:
        # Step 3: Temporarily override sampling parameters for this request if provided.
        saved = {
            "temperature": getattr(predictor, "temperature", None),
            "top_p": getattr(predictor, "top_p", None),
        }
        if request.temperature is not None:
            predictor.temperature = request.temperature
        if request.top_p is not None:
            predictor.top_p = request.top_p

        try:
            result = predictor.predict(request.prompt, image_np, past_actions=request.past_actions)
        except Exception as e:
            _update_job_state(request.request_context, state="error", started_at_epoch=request_started_at, error=str(e))
            return f"Predictor error: {str(e)}"
        finally:
            # Step 4: Restore predictor sampling parameters before returning it to the pool.
            for k, v in saved.items():
                if v is not None:
                    setattr(predictor, k, v)
    finally:
        # Step 5: Return the predictor to the pool even if inference fails.
        predictor_pool.put(predictor)

    _update_job_state(request.request_context, state="idle", started_at_epoch=request_started_at)
    return result
