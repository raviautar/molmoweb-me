from __future__ import annotations

import os
from typing import Any


def build_local_url(host: str, port: int) -> str:
    return f"http://{host}:{port}"


APP_NAME = "MolmoWeb"
WEBUI_BROWSER_TITLE = "MolmoWeb Session Console"
WEBUI_BRAND_EYEBROW = "MolmoWeb"
WEBUI_BRAND_TITLE = "Session Console"
WEBUI_BRAND_COPY = "Persistent browser sessions, archived trajectory artifacts, and expert operator controls."
WEBUI_STATUS_EYEBROW = "Title"
WEBUI_DEFAULT_WORKSPACE_TITLE = "Main Chat"
WEBUI_DEFAULT_SESSION_SUMMARY = "No live session selected yet. The first prompt creates one automatically."

DEFAULT_SERVER_HOST = "127.0.0.1"
MODEL_SERVER_PORT = 8001
WEBUI_PORT = 8010
DEFAULT_MAX_STEPS = 15
MIN_MAX_STEPS = 1
MAX_MAX_STEPS = 50
DEFAULT_HEADLESS = True
MODEL_STATUS_LOG_LINES = 200
MODEL_STATUS_REFRESH_SECONDS = 5
WEBUI_REFRESH_INTERVAL_MS = 1500
MAX_MODEL_LOG_LINES = 1000
DEFAULT_MODEL_SERVICE_TIMEOUT_SECONDS = 30
TITLE_GENERATION_TIMEOUT_SECONDS = 120
SESSION_WORKER_READY_TIMEOUT_SECONDS = 60
SESSION_WORKER_TASK_TIMEOUT_SECONDS = 2.0
SESSION_CLOSE_JOIN_TIMEOUT_SECONDS = 5
PREDICTOR_ACQUIRE_TIMEOUT_SECONDS = 30
PREDICT_REQUEST_TIMEOUT_SECONDS = 120
MAX_TRACKED_JOBS = 100

MODEL_SERVICE_STATUS_PATH = "/status"
MODEL_SERVICE_PREDICT_PATH = "/predict"
WEBUI_STATIC_MOUNT_PATH = "/webui-static"
WEBUI_ARTIFACT_MOUNT_PATH = "/webui-artifacts"
WEBUI_STATIC_STYLES_PATH = "/webui-static/styles.css"
WEBUI_STATIC_SCRIPT_PATH = "/webui-static/app.js"
API_CONFIG_PATH = "/api/config"
API_STATUS_PATH = "/api/status"
API_MODEL_SERVICE_STATUS_PATH = "/api/model-service/status"
API_MODEL_SERVICE_LOGS_PATH = "/api/model-service/logs"
API_SESSIONS_PATH = "/api/sessions"
API_ADMIN_MARK_INACTIVE_PATH = "/api/admin/mark-sessions-inactive"

BROWSER_START_URL = "about:blank"
MULTIMODAL_SYSTEM_MESSAGE = "molmo_web_think"
SESSION_UNTITLED_TITLE = "Untitled Session"
SESSION_TITLE_PROMPT_TEMPLATE = (
    "Generate a concise neutral task label of 3 to 6 words for this browser session. "
    "Do not answer the task. Do not infer an outcome that is not explicitly shown. "
    "Original task: {prompt} "
    "Return plain text only."
)

TEST_SERVER_PROMPT = (
    "Read the text on this page. "
    "What are the first four job titles listed under 'Open roles'?"
)

UNLOAD_RUNNING_MESSAGE = (
    "A browser run is still in progress for this session. Leaving now can interrupt your live review workflow."
)
UNLOAD_IDLE_MESSAGE = (
    "This tab contains your session console and saved context. Leave only if you are done reviewing this workspace."
)
FAQ_SAMPLE_PROMPT = "Go to hazlnut.in and in the FAQs find out what is the cost of the service"
FAQ_SAMPLE_EXPECTED_ANSWER = "3%"

FRONTEND_CONFIG: dict[str, Any] = {
    "branding": {
        "browserTitle": WEBUI_BROWSER_TITLE,
        "brandEyebrow": WEBUI_BRAND_EYEBROW,
        "brandTitle": WEBUI_BRAND_TITLE,
        "brandCopy": WEBUI_BRAND_COPY,
        "statusEyebrow": WEBUI_STATUS_EYEBROW,
        "workspaceDefaultTitle": WEBUI_DEFAULT_WORKSPACE_TITLE,
        "workspaceDefaultSummary": WEBUI_DEFAULT_SESSION_SUMMARY,
    },
    "defaults": {
        "maxSteps": DEFAULT_MAX_STEPS,
        "minSteps": MIN_MAX_STEPS,
        "maxStepsLimit": MAX_MAX_STEPS,
        "headless": DEFAULT_HEADLESS,
        "modelLogLines": MODEL_STATUS_LOG_LINES,
        "refreshIntervalMs": WEBUI_REFRESH_INTERVAL_MS,
    },
    "alerts": {
        "runningUnload": UNLOAD_RUNNING_MESSAGE,
        "idleUnload": UNLOAD_IDLE_MESSAGE,
        "copySuccess": "Prompt copied to clipboard.",
        "copyFailure": "Could not copy the prompt to the clipboard.",
        "runFailure": "Run failed.",
        "sessionClosed": "Session closed.",
        "archivedSelection": "The selected session is archived. Click Start Fresh to begin a new live chat.",
    },
    "labels": {
        "sidebarToggle": "Open session controls",
        "sidebarClose": "Close session controls",
        "sessionDefaultsTitle": "Session Defaults",
        "sessionDefaultsMeta": "A session is created automatically on the first prompt",
        "sessionEndpoint": "Model Endpoint",
        "sessionMaxSteps": "Max Steps",
        "sessionHeadless": "Headless",
        "startFresh": "Start Fresh Chat",
        "startFreshShort": "Start Fresh",
        "currentSessions": "Current Sessions",
        "pastSessions": "Past Sessions",
        "metricLive": "Live",
        "metricArchived": "Archived",
        "metricEndpoint": "Model Endpoint",
        "conversation": "Conversation",
        "refresh": "Refresh",
        "closeSession": "Close Session",
        "nextPrompt": "Next Prompt",
        "runTurn": "Run",
        "artifacts": "Artifacts",
        "artifactInfoTitle": "Session Details",
        "artifactInfoHint": "Hover to inspect technical details",
        "openTrajectory": "Open trajectory HTML",
        "openLatestSnapshot": "Open latest snapshot",
        "snapshots": "Snapshots",
        "steps": "Steps",
        "samplePromptTitle": "Quick Sample",
        "samplePromptUse": "Use Hazlnut FAQ Sample",
        "samplePromptRun": "Run Sample",
        "samplePromptExpectation": "Expected answer",
        "serviceHealth": "Service Health",
        "serviceHealthHint": "Live model-server status and recent logs.",
        "modelService": "Main Service",
    },
    "placeholders": {
        "endpoint": build_local_url(DEFAULT_SERVER_HOST, MODEL_SERVER_PORT),
        "prompt": "Go to the target site and extract the answer.",
    },
    "emptyStates": {
        "sessions": "No sessions yet.",
        "chat": "Send a prompt to start a persistent browser session. The first completed turn will generate the session title automatically.",
        "chatNoSelection": "Send a prompt to start a persistent browser session. The first completed turn will generate the session title automatically.",
        "artifacts": "Snapshots and trajectory outputs for the selected turn.",
        "snapshots": "Select a turn to inspect saved step snapshots.",
        "noSnapshots": "No snapshots have been saved for the selected turn.",
        "steps": "Step summaries will appear here.",
        "sessionInfo": "The next prompt will create a live session with the defaults in the menu.",
        "modelStatus": "Main service status will appear here.",
        "modelJobs": "Active model-service jobs will appear here.",
        "modelJobsNone": "No tracked model-service jobs yet.",
        "modelLogs": "Main service logs will appear here.",
        "modelLogsEmpty": "Main service log file is empty.",
    },
    "statusPills": {
        "live": "Live Browser",
        "archived": "Artifact Only",
    },
    "samples": {
        "hazlnutFaq": {
            "title": "Hazlnut FAQ Cost",
            "prompt": FAQ_SAMPLE_PROMPT,
            "expectedAnswer": FAQ_SAMPLE_EXPECTED_ANSWER,
        }
    },
    "summary": {
        "live": "Live",
        "archived": "Archived",
        "turns": "turns",
        "updated": "Updated",
    },
    "completion": {
        "defaultFinished": "answered",
    },
    "routes": {
        "status": API_STATUS_PATH,
        "config": API_CONFIG_PATH,
        "sessions": API_SESSIONS_PATH,
        "modelServiceStatus": API_MODEL_SERVICE_STATUS_PATH,
        "modelServiceLogs": API_MODEL_SERVICE_LOGS_PATH,
    },
}

MODEL_STATUS_PAGE = {
    "title": "MolmoWeb Model Service Status",
    "headerEyebrow": "Model Service",
    "headerTitle": "MolmoWeb Runtime Status",
    "headerSubtitle": f"Active jobs only, auto-refresh every {MODEL_STATUS_REFRESH_SECONDS} seconds.",
    "gpuHeading": "GPU Memory",
    "jobsHeading": "Active Jobs",
    "detailsHeading": "Process Details",
    "emptyGpu": "No CUDA devices detected.",
    "emptyJobs": "No active jobs.",
    "detailLabels": {
        "projectPath": "Project Path",
        "logFile": "Log File",
        "checkpoint": "Checkpoint",
        "predictorType": "Predictor Type",
        "python": "Python",
        "condaPrefix": "Conda Prefix",
    },
    "summaryLabels": {
        "status": "Status",
        "pid": "PID",
        "predictors": "Predictors",
        "activeJobs": "Active Jobs",
        "loadTime": "Load Time",
        "uptime": "Uptime",
    },
}


def get_default_model_endpoint() -> str:
    return os.environ.get("MOLMOWEB_MODEL_ENDPOINT", build_local_url(DEFAULT_SERVER_HOST, MODEL_SERVER_PORT))


def get_frontend_config(default_model_endpoint: str | None = None) -> dict[str, Any]:
    # Step 1: Clone the static front-end config structure so request-specific values can be injected safely.
    frontend_config = {
        key: (value.copy() if isinstance(value, dict) else value)
        for key, value in FRONTEND_CONFIG.items()
    }

    # Step 2: Inject the active default endpoint so the UI reflects the current environment configuration.
    frontend_config["defaults"] = dict(frontend_config["defaults"])
    frontend_config["defaults"]["endpoint"] = default_model_endpoint or get_default_model_endpoint()
    frontend_config["placeholders"] = dict(frontend_config["placeholders"])
    frontend_config["placeholders"]["endpoint"] = frontend_config["defaults"]["endpoint"]
    return frontend_config
