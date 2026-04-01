const state = {
  selectedSessionId: null,
  selectedTurnIndex: null,
  sessions: [],
  sessionDetail: null,
  isBusy: false,
  busyButtonKey: null,
  busyButtonText: "Working",
  modelServiceStatus: null,
  modelServiceLogs: null,
  galleryUrls: [],
  galleryIndex: 0,
};

const elements = {
  archivedCount: document.getElementById("archived-count"),
  archivedSessionList: document.getElementById("archived-session-list"),
  activeJobLog: document.getElementById("active-job-log"),
  artifactSummary: document.getElementById("artifact-summary"),
  archivedBanner: document.getElementById("archived-banner"),
  archivedBannerText: document.getElementById("archived-banner-text"),
  chatLog: document.getElementById("chat-log"),
  closeSessionButton: document.getElementById("close-session-button"),
  defaultEndpoint: document.getElementById("default-endpoint"),
  errorBanner: document.getElementById("error-banner"),
  errorBannerText: document.getElementById("error-banner-text"),
  galleryCaption: document.getElementById("gallery-caption"),
  galleryClose: document.getElementById("gallery-close"),
  galleryImage: document.getElementById("gallery-image"),
  galleryModal: document.getElementById("gallery-modal"),
  galleryNext: document.getElementById("gallery-next"),
  galleryPrev: document.getElementById("gallery-prev"),
  latestSnapshotLink: document.getElementById("latest-snapshot-link"),
  liveCount: document.getElementById("live-count"),
  liveSessionList: document.getElementById("live-session-list"),
  modelLogView: document.getElementById("model-log-view"),
  modelStatusGrid: document.getElementById("model-status-grid"),
  newChatButton: document.getElementById("new-chat-button"),
  newChatButtonTopbar: document.getElementById("new-chat-button-topbar"),
  promptInput: document.getElementById("prompt-input"),
  promptMaxSteps: document.getElementById("prompt-max-steps"),
  refreshSessionButton: document.getElementById("refresh-session-button"),
  sendPromptButton: document.getElementById("send-prompt-button"),
  sessionEndpoint: document.getElementById("session-endpoint"),
  sessionHeadless: document.getElementById("session-headless"),
  sessionMaxSteps: document.getElementById("session-max-steps"),
  sessionMeta: document.getElementById("session-meta"),
  sessionSummary: document.getElementById("session-summary"),
  snapshotGrid: document.getElementById("snapshot-grid"),
  stepLog: document.getElementById("step-log"),
  trajectoryLink: document.getElementById("trajectory-link"),
  workspaceTitle: document.getElementById("workspace-title"),
};

const buttonLabels = new Map();

[
  elements.newChatButton,
  elements.newChatButtonTopbar,
  elements.refreshSessionButton,
  elements.closeSessionButton,
  elements.sendPromptButton,
].forEach((button) => {
  if (button) {
    buttonLabels.set(button, button.textContent);
  }
});

async function fetchJson(url, options = {}) {
  // Step 1: Send the HTTP request and read the body once so error parsing is safe.
  const response = await fetch(url, options);
  const rawText = await response.text();

  // Step 2: Parse the response body when it contains JSON.
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = null;
    }
  }

  // Step 3: Raise a readable error when the request failed.
  if (!response.ok) {
    const detail = payload && payload.detail ? payload.detail : rawText || response.statusText;
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  // Step 4: Return JSON payloads, or an empty object for blank successful responses.
  return payload ?? {};
}

function showError(message) {
  // Step 1: Hide the banner when there is nothing useful to show.
  if (!message) {
    elements.errorBanner.classList.add("hidden");
    elements.errorBannerText.textContent = "";
    return;
  }

  // Step 2: Render the operator-facing error text in the chat panel.
  elements.errorBannerText.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

function showArchivedMessage(message) {
  // Step 1: Hide the archived banner when there is no archived-session message to show.
  if (!message) {
    elements.archivedBanner.classList.add("hidden");
    elements.archivedBannerText.textContent = "";
    return;
  }

  // Step 2: Render the archived-session explanation for the selected session.
  elements.archivedBannerText.textContent = message;
  elements.archivedBanner.classList.remove("hidden");
}

function setButtonBusy(button, isBusy, busyText) {
  // Step 1: Stop early when the target button does not exist.
  if (!button) {
    return;
  }

  // Step 2: Restore the original button label when the busy state clears.
  if (!isBusy) {
    button.classList.remove("button-busy");
    button.innerHTML = escapeHtml(buttonLabels.get(button) || button.textContent || "");
    return;
  }

  // Step 3: Replace the button content with a small spinner and action label.
  button.classList.add("button-busy");
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(busyText)}</span>`;
}

function setBusy(isBusy, busyButtonKey = null, busyText = "Working") {
  // Step 1: Store the busy state so UI actions can be disabled consistently.
  state.isBusy = isBusy;
  state.busyButtonKey = isBusy ? busyButtonKey : null;
  state.busyButtonText = isBusy ? busyText : "Working";

  const selectedSessionIsLive = Boolean(state.selectedSessionId && state.sessionDetail && state.sessionDetail.live);
  const selectedSessionIsArchived = Boolean(state.selectedSessionId && state.sessionDetail && !state.sessionDetail.live);

  // Step 2: Toggle the action buttons and inputs based on the current busy and session state.
  elements.sendPromptButton.disabled = isBusy || selectedSessionIsArchived;
  elements.closeSessionButton.disabled = isBusy || !selectedSessionIsLive;
  elements.refreshSessionButton.disabled = isBusy || !state.selectedSessionId;
  elements.newChatButton.disabled = isBusy;
  elements.newChatButtonTopbar.disabled = isBusy;
  elements.promptInput.disabled = isBusy || selectedSessionIsArchived;
  elements.promptMaxSteps.disabled = isBusy || selectedSessionIsArchived;
  elements.sessionEndpoint.disabled = isBusy;
  elements.sessionHeadless.disabled = isBusy;
  elements.sessionMaxSteps.disabled = isBusy;

  // Step 3: Show a small spinner only on the action button tied to the current operation.
  setButtonBusy(elements.sendPromptButton, isBusy && busyButtonKey === "send", busyText);
  setButtonBusy(elements.closeSessionButton, isBusy && busyButtonKey === "close", busyText);
  setButtonBusy(elements.refreshSessionButton, isBusy && busyButtonKey === "refresh", busyText);
  setButtonBusy(elements.newChatButton, isBusy && busyButtonKey === "newChat", busyText);
  setButtonBusy(elements.newChatButtonTopbar, isBusy && busyButtonKey === "newChatTopbar", busyText);
}

function formatDate(value) {
  // Step 1: Return a fallback label when no timestamp is available.
  if (!value) {
    return "N/A";
  }

  // Step 2: Format the timestamp in the operator's local timezone.
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  // Step 1: Convert arbitrary text into safe HTML for insertion into templates.
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summarizeSession(session) {
  // Step 1: Build a concise summary string used throughout the header and sidebar.
  const scope = session.live ? "Live" : "Archived";
  const runState = session.run_state ? ` • ${session.run_state}` : "";
  return `${scope}${runState} • ${session.turn_count || 0} turns • Updated ${formatDate(session.updated_at)}`;
}

function clearSelection() {
  // Step 1: Reset the active session and turn selection.
  state.selectedSessionId = null;
  state.selectedTurnIndex = null;
  state.sessionDetail = null;

  // Step 2: Re-render the workspace in its default chat-first state.
  renderSessionList();
  renderWorkspace();
}

function getSessionDefaults() {
  // Step 1: Read the current operator defaults from the side panel.
  return {
    title: null,
    endpoint: elements.sessionEndpoint.value.trim() || null,
    local: true,
    headless: elements.sessionHeadless.value === "true",
    max_steps_default: Number(elements.sessionMaxSteps.value || 15),
  };
}

function renderSessionList() {
  // Step 1: Split sessions into live and archived groups for the collapsible sidebar.
  const liveSessions = state.sessions.filter((session) => session.live);
  const archivedSessions = state.sessions.filter((session) => !session.live);

  // Step 2: Render one group at a time using the shared helper.
  renderSessionGroup(elements.liveSessionList, liveSessions);
  renderSessionGroup(elements.archivedSessionList, archivedSessions);
}

function renderSessionGroup(container, sessions) {
  // Step 1: Render an empty message when the group has no sessions.
  if (sessions.length === 0) {
    container.innerHTML = '<div class="empty-state">No sessions yet.</div>';
    return;
  }

  // Step 2: Render clickable session cards with current summary and status details.
  container.innerHTML = sessions
    .map((session) => {
      const isActive = session.session_id === state.selectedSessionId;
      const latestSnapshot = session.latest_snapshot_url
        ? `<a class="artifact-link" href="${session.latest_snapshot_url}" target="_blank" rel="noreferrer">Latest Snapshot</a>`
        : "";
      return `
        <article class="session-card ${isActive ? "active" : ""}" data-session-id="${session.session_id}">
          <div class="status-pill">${session.live ? "Live Browser" : "Artifact Only"}</div>
          <h3>${escapeHtml(session.title)}</h3>
          <div class="session-card-meta">${escapeHtml(summarizeSession(session))}</div>
          <div class="session-card-meta">Endpoint: ${escapeHtml(session.endpoint || "")}</div>
          <div class="session-card-meta">${escapeHtml(session.session_id)}</div>
          ${latestSnapshot}
        </article>
      `;
    })
    .join("");

  // Step 3: Attach click handlers after the HTML has been written.
  container.querySelectorAll(".session-card").forEach((card) => {
    card.addEventListener("click", async () => {
      await selectSession(card.dataset.sessionId);
    });
  });
}

function renderMetaGrid(session) {
  // Step 1: Clear the grid when no session is selected.
  if (!session) {
    elements.sessionMeta.innerHTML = '<div class="empty-state">The next prompt will create a live session with the defaults on the left.</div>';
    return;
  }

  // Step 2: Render key metadata fields that matter during analysis.
  const entries = [
    ["Session ID", session.session_id],
    ["Created", formatDate(session.created_at)],
    ["Updated", formatDate(session.updated_at)],
    ["Closed", formatDate(session.closed_at)],
    ["Endpoint", session.endpoint],
    ["Headless", String(session.headless)],
    ["Local Browser", String(session.local)],
    ["Max Steps Default", String(session.max_steps_default)],
    ["Run State", session.run_state || "idle"],
    ["Current Turn", String(session.current_turn_index || 0)],
    ["Current Step", String(session.current_step_index || 0)],
    ["Transcript", session.chat_transcript_path],
    ["Event Log", session.event_log_path],
  ];

  elements.sessionMeta.innerHTML = entries
    .map(
      ([label, value]) => `
        <div class="meta-item">
          <span class="label">${escapeHtml(label)}</span>
          <span class="value mono">${escapeHtml(value || "N/A")}</span>
        </div>
      `,
    )
    .join("");
}

function getArchivedMessage(session) {
  // Step 1: Return no message while no archived session is selected.
  if (!session || session.live) {
    return "";
  }

  // Step 2: Explain that the browser session is no longer available.
  if (session.last_error === "Browser window closed") {
    return "This session is archived because the browser window was closed. Its artifacts remain available, but you need Start Fresh to continue browsing.";
  }
  if ((session.run_state || "") === "closed") {
    return "This session is archived. The live browser is no longer attached, but all saved artifacts remain available for review.";
  }
  return "This session is archived and cannot accept new prompts. Use Start Fresh to create a new live browser session.";
}

function renderChat(session) {
  // Step 1: Show the empty state until a session is selected.
  if (!session) {
    elements.chatLog.className = "chat-log empty-state";
    elements.chatLog.textContent = "Send a prompt to start a persistent browser session. The first completed turn will generate the session title automatically.";
    return;
  }

  // Step 2: Render each turn as paired user and assistant cards.
  const cards = [];
  session.turns.forEach((turn) => {
    const isSelectedTurn = state.selectedTurnIndex === turn.turn_index;
    cards.push(`
      <article class="chat-card user ${isSelectedTurn ? "active" : ""}" data-turn-index="${turn.turn_index}">
        <div class="chat-card-meta">Turn ${turn.turn_index} • ${escapeHtml(formatDate(turn.started_at))}</div>
        <h3>User</h3>
        <pre>${escapeHtml(turn.prompt)}</pre>
      </article>
    `);
    cards.push(`
      <article class="chat-card assistant ${isSelectedTurn ? "active" : ""}" data-turn-index="${turn.turn_index}">
        <div class="chat-card-meta">${escapeHtml(turn.final_page_title || "No page title")} • ${escapeHtml(turn.final_page_url || "")}</div>
        <h3>Assistant</h3>
        <pre>${escapeHtml(turn.assistant_text || turn.final_error || "No textual output")}</pre>
      </article>
    `);
  });

  if ((session.run_state || "") === "running") {
    cards.push(`
      <article class="chat-card assistant active">
        <div class="chat-card-meta">Running • turn ${escapeHtml(String(session.current_turn_index || 0))} • step ${escapeHtml(String(session.current_step_index || 0))}</div>
        <h3>Assistant</h3>
        <pre>${escapeHtml(session.current_prompt || "Browser session is working...")}</pre>
      </article>
    `);
  }

  elements.chatLog.className = "chat-log";
  elements.chatLog.innerHTML = cards.join("");

  // Step 3: Attach click handlers so any turn card updates the artifact inspector.
  elements.chatLog.querySelectorAll(".chat-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (!card.dataset.turnIndex) {
        return;
      }
      state.selectedTurnIndex = Number(card.dataset.turnIndex);
      renderInspector(session);
      renderChat(session);
    });
  });
}

function setArtifactLink(element, url) {
  // Step 1: Disable the link cleanly when no artifact URL is available.
  if (!url) {
    element.href = "#";
    element.classList.add("disabled");
    return;
  }

  // Step 2: Enable the link and point it to the requested artifact.
  element.href = url;
  element.classList.remove("disabled");
}

function renderInspector(session) {
  // Step 1: Show the empty state until a session is selected.
  if (!session) {
    state.galleryUrls = [];
    elements.snapshotGrid.className = "snapshot-grid empty-state";
    elements.snapshotGrid.textContent = "Select a turn to inspect saved step snapshots.";
    elements.stepLog.className = "step-log empty-state";
    elements.stepLog.textContent = "Step summaries will appear here.";
    elements.artifactSummary.textContent = "Snapshots and trajectory outputs for the selected turn.";
    setArtifactLink(elements.trajectoryLink, "");
    setArtifactLink(elements.latestSnapshotLink, "");
    return;
  }

  // Step 2: Select the active turn, defaulting to the most recent one.
  if (!state.selectedTurnIndex && session.turns.length > 0) {
    state.selectedTurnIndex = session.turns[session.turns.length - 1].turn_index;
  }
  const turn = session.turns.find((candidate) => candidate.turn_index === state.selectedTurnIndex) || null;

  // Step 3: Render the inspector header and artifact links.
  elements.artifactSummary.textContent = turn
    ? `Turn ${turn.turn_index} • ${turn.step_count} steps • ${turn.final_page_title || "No final page title"}`
    : "No turns have been run for this session yet.";
  setArtifactLink(elements.trajectoryLink, turn ? turn.trajectory_html_url : "");
  setArtifactLink(elements.latestSnapshotLink, session.latest_snapshot_url || "");

  // Step 4: Render the snapshot gallery for the selected turn.
  if (!turn || !turn.snapshot_urls || turn.snapshot_urls.length === 0) {
    state.galleryUrls = [];
    elements.snapshotGrid.className = "snapshot-grid empty-state";
    elements.snapshotGrid.textContent = "No snapshots have been saved for the selected turn.";
  } else {
    state.galleryUrls = turn.snapshot_urls.slice();
    elements.snapshotGrid.className = "snapshot-grid";
    elements.snapshotGrid.innerHTML = turn.snapshot_urls
      .map(
        (url, index) => `
          <figure class="snapshot-card">
            <button class="snapshot-button" type="button" data-gallery-index="${index}">
              <img src="${url}" alt="Turn ${turn.turn_index} step ${index + 1}" />
            </button>
            <figcaption class="session-card-meta">Step ${index + 1}</figcaption>
          </figure>
        `,
      )
      .join("");
    elements.snapshotGrid.querySelectorAll(".snapshot-button").forEach((button) => {
      button.addEventListener("click", () => {
        openGallery(Number(button.dataset.galleryIndex || 0));
      });
    });
  }

  // Step 5: Render the step-by-step textual summary log.
  if (!turn || !turn.steps || turn.steps.length === 0) {
    elements.stepLog.className = "step-log empty-state";
    elements.stepLog.textContent = "Step summaries will appear here.";
  } else {
    elements.stepLog.className = "step-log";
    elements.stepLog.innerHTML = turn.steps
      .map(
        (step) => `
          <article class="step-card">
            <div class="chat-card-meta">Step ${step.step_index} • ${escapeHtml(step.action_name || "no-action")}</div>
            <h4>${escapeHtml(step.page_title || "Untitled page")}</h4>
            <p>${escapeHtml(step.page_url || "")}</p>
            <pre>${escapeHtml(step.thought || step.action_text || step.message || step.error || "No structured text")}</pre>
          </article>
        `,
      )
      .join("");
  }
}

function renderModelService() {
  // Step 1: Render an empty state until the main model-service payload has been loaded.
  if (!state.modelServiceStatus) {
    elements.modelStatusGrid.innerHTML = '<div class="empty-state">Main service status will appear here.</div>';
    elements.activeJobLog.className = 'step-log empty-state';
    elements.activeJobLog.textContent = 'Active model-service jobs will appear here.';
    elements.modelLogView.className = 'log-view empty-state';
    elements.modelLogView.textContent = 'Main service logs will appear here.';
    return;
  }

  // Step 2: Render key model-service metadata and the active job count.
  const status = state.modelServiceStatus;
  const metadataEntries = [
    ['Service PID', String(status.pid || 'N/A')],
    ['Service Log', status.log_file || 'N/A'],
    ['Checkpoint', status.checkpoint || 'N/A'],
    ['Predictor Type', status.predictor_type || 'N/A'],
    ['Queue Size', `${status.predictor_queue_size}/${status.predictor_queue_capacity}`],
    ['Active Jobs', String(status.active_job_count || 0)],
  ];
  const gpuEntries = Array.isArray(status.gpu_status)
    ? status.gpu_status.map((gpu) => {
        const total = Number(gpu.memory_total_mb || 0);
        const used = Number(gpu.memory_used_mb || 0);
        const percent = total > 0 ? ((used / total) * 100).toFixed(1) : '0.0';
        return [`GPU ${gpu.device_index}`, `${percent}% (${used}/${total} MB)`];
      })
    : [];
  elements.modelStatusGrid.innerHTML = metadataEntries
    .concat(gpuEntries)
    .map(
      ([label, value]) => `
        <div class="meta-item">
          <span class="label">${escapeHtml(label)}</span>
          <span class="value mono">${escapeHtml(value)}</span>
        </div>
      `,
    )
    .join('');

  // Step 3: Render active jobs when present, otherwise show the most recent tracked jobs.
  const activeJobs = Array.isArray(status.active_jobs) ? status.active_jobs : [];
  const trackedJobs = Array.isArray(status.tracked_jobs) ? status.tracked_jobs : [];
  const jobsToRender = activeJobs.length > 0 ? activeJobs : trackedJobs.slice(0, 5);
  if (jobsToRender.length === 0) {
    elements.activeJobLog.className = 'step-log empty-state';
    elements.activeJobLog.textContent = 'No tracked model-service jobs yet.';
  } else {
    elements.activeJobLog.className = 'step-log';
    elements.activeJobLog.innerHTML = jobsToRender
      .map(
        (job) => `
          <article class="step-card">
            <div class="chat-card-meta">${escapeHtml(job.state || 'unknown')} • turn ${escapeHtml(String(job.turn_index || 0))} • step ${escapeHtml(String(job.step_index || 0))}/${escapeHtml(String(job.max_steps || 0))}</div>
            <h4>${escapeHtml(job.session_title || job.session_id || job.job_key || 'anonymous request')}</h4>
            <p>${escapeHtml(job.page_title || '')} • ${escapeHtml(job.page_url || '')}</p>
            <pre>${escapeHtml(job.query || job.last_error || '')}</pre>
          </article>
        `,
      )
      .join('');
  }

  // Step 4: Render the tail of the model-service log inside the inspector.
  const logText = state.modelServiceLogs && state.modelServiceLogs.text ? state.modelServiceLogs.text : '';
  elements.modelLogView.className = 'log-view';
  elements.modelLogView.textContent = logText || 'Main service log file is empty.';
}

function renderWorkspace() {
  // Step 1: Update the top-level workspace labels and action state.
  const session = state.sessionDetail;
  elements.workspaceTitle.textContent = session ? session.title : "Main Chat";
  elements.sessionSummary.textContent = session ? summarizeSession(session) : "No live session selected yet. The first prompt creates one automatically.";
  showArchivedMessage(getArchivedMessage(session));
  renderMetaGrid(session);
  renderChat(session);
  renderInspector(session);
  renderModelService();
  setBusy(state.isBusy, state.busyButtonKey, state.busyButtonText);
}

async function loadModelServiceData() {
  // Step 1: Fetch the main model-service status and its current log tail through the WebUI backend.
  state.modelServiceStatus = await fetchJson('/api/model-service/status');
  state.modelServiceLogs = await fetchJson('/api/model-service/logs?lines=200');
}

async function loadAppStatus() {
  // Step 1: Fetch the aggregate web UI status from the backend.
  const payload = await fetchJson("/api/status");

  // Step 2: Update the summary cards in the workspace header.
  elements.liveCount.textContent = String(payload.live_session_count);
  elements.archivedCount.textContent = String(payload.archived_session_count);
  elements.defaultEndpoint.textContent = payload.default_model_endpoint;
  if (!elements.sessionEndpoint.value) {
    elements.sessionEndpoint.value = payload.default_model_endpoint;
  }
}

async function loadSessions() {
  // Step 1: Fetch the sidebar session summaries from the backend.
  state.sessions = await fetchJson("/api/sessions");

  // Step 2: Re-render the sidebar with the latest session inventory.
  renderSessionList();
}

async function selectSession(sessionId) {
  // Step 1: Store the selected session identifier and clear the previous turn focus.
  state.selectedSessionId = sessionId;
  state.selectedTurnIndex = null;

  // Step 2: Fetch the full session detail payload for the workspace view.
  state.sessionDetail = await fetchJson(`/api/sessions/${sessionId}`);

  // Step 3: Default the inspector to the most recent turn when one exists.
  if (state.sessionDetail.turns.length > 0) {
    state.selectedTurnIndex = state.sessionDetail.turns[state.sessionDetail.turns.length - 1].turn_index;
  }

  // Step 4: Re-render the entire workspace and sidebar highlight state.
  renderSessionList();
  renderWorkspace();
}

async function ensureLiveSession() {
  // Step 1: Reuse the current live session when one is already selected.
  if (state.selectedSessionId && state.sessionDetail && state.sessionDetail.live) {
    return state.selectedSessionId;
  }

  // Step 2: Create a fresh live session using the operator defaults.
  const session = await fetchJson("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getSessionDefaults()),
  });

  // Step 3: Refresh the sidebar inventory and select the newly created session.
  await loadAppStatus();
  await loadSessions();
  await selectSession(session.session_id);
  return session.session_id;
}

async function sendPrompt() {
  // Step 1: Stop early when the prompt is empty.
  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    return;
  }

  // Step 2: Create a live session on demand when none is currently selected.
  showError("");
  setBusy(true, "send", "Running");
  try {
    if (state.selectedSessionId && state.sessionDetail && !state.sessionDetail.live) {
      throw new Error("The selected session is archived. Click Start Fresh to begin a new live chat.");
    }
    const sessionId = await ensureLiveSession();
    state.sessionDetail = await fetchJson(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_steps: Number(elements.promptMaxSteps.value || 15),
      }),
    });
    elements.promptInput.value = "";
    if (state.sessionDetail.turns.length > 0) {
      state.selectedTurnIndex = state.sessionDetail.turns[state.sessionDetail.turns.length - 1].turn_index;
    }
    await loadAppStatus();
    await loadModelServiceData();
    await loadSessions();
    renderWorkspace();
  } catch (error) {
    showError(error.message || "The browser session failed.");
    await loadAppStatus();
    await loadModelServiceData();
    if (state.selectedSessionId) {
      await selectSession(state.selectedSessionId);
    } else {
      renderWorkspace();
    }
  } finally {
    setBusy(false);
  }
}

async function closeSelectedSession() {
  // Step 1: Stop early when no session is selected.
  if (!state.selectedSessionId) {
    return;
  }

  // Step 2: Ask the backend to close the live browser session while preserving artifacts.
  showError("");
  setBusy(true, "close", "Closing");
  try {
    state.sessionDetail = await fetchJson(`/api/sessions/${state.selectedSessionId}/close`, {
      method: "POST",
    });
    await loadAppStatus();
    await loadModelServiceData();
    await loadSessions();
    renderWorkspace();
  } catch (error) {
    showError(error.message || "Could not close the session.");
  } finally {
    setBusy(false);
  }
}

async function refreshSelectedSession() {
  // Step 1: Stop early when no session is selected.
  if (!state.selectedSessionId) {
    return;
  }

  // Step 2: Reload the selected session detail and refresh the workspace.
  showError("");
  setBusy(true, "refresh", "Refreshing");
  try {
    await loadAppStatus();
    await loadSessions();
    await selectSession(state.selectedSessionId);
    await loadModelServiceData();
  } catch (error) {
    showError(error.message || "Could not refresh the session.");
  } finally {
    setBusy(false);
  }
}

function renderGallery() {
  // Step 1: Hide the modal when there are no gallery images available.
  if (state.galleryUrls.length === 0) {
    elements.galleryModal.classList.add("hidden");
    elements.galleryModal.setAttribute("aria-hidden", "true");
    return;
  }

  // Step 2: Clamp the selected image index and update the modal content.
  state.galleryIndex = Math.max(0, Math.min(state.galleryIndex, state.galleryUrls.length - 1));
  const url = state.galleryUrls[state.galleryIndex];
  elements.galleryImage.src = url;
  elements.galleryCaption.textContent = `Snapshot ${state.galleryIndex + 1} of ${state.galleryUrls.length}`;
  elements.galleryModal.classList.remove("hidden");
  elements.galleryModal.setAttribute("aria-hidden", "false");
}

function openGallery(index) {
  // Step 1: Ignore requests when the selected turn has no snapshot gallery.
  if (state.galleryUrls.length === 0) {
    return;
  }

  // Step 2: Store the requested gallery position and render the modal.
  state.galleryIndex = index;
  renderGallery();
}

function closeGallery() {
  // Step 1: Hide the modal without discarding the current turn selection.
  elements.galleryModal.classList.add("hidden");
  elements.galleryModal.setAttribute("aria-hidden", "true");
}

function moveGallery(delta) {
  // Step 1: Ignore keyboard or button navigation when the gallery is closed.
  if (elements.galleryModal.classList.contains("hidden") || state.galleryUrls.length === 0) {
    return;
  }

  // Step 2: Wrap around the snapshot list and re-render the modal.
  const lastIndex = state.galleryUrls.length - 1;
  state.galleryIndex = (state.galleryIndex + delta + state.galleryUrls.length) % (lastIndex + 1);
  renderGallery();
}

async function initialize() {
  // Step 1: Attach all user interaction handlers to the static controls.
  elements.newChatButton.addEventListener("click", clearSelection);
  elements.newChatButtonTopbar.addEventListener("click", clearSelection);
  elements.sendPromptButton.addEventListener("click", sendPrompt);
  elements.closeSessionButton.addEventListener("click", closeSelectedSession);
  elements.refreshSessionButton.addEventListener("click", refreshSelectedSession);
  elements.galleryClose.addEventListener("click", closeGallery);
  elements.galleryPrev.addEventListener("click", () => moveGallery(-1));
  elements.galleryNext.addEventListener("click", () => moveGallery(1));
  elements.galleryModal.addEventListener("click", (event) => {
    if (event.target === elements.galleryModal) {
      closeGallery();
    }
  });
  elements.promptInput.addEventListener("keydown", async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      await sendPrompt();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (elements.galleryModal.classList.contains("hidden")) {
      return;
    }
    if (event.key === "Escape") {
      closeGallery();
    }
    if (event.key === "ArrowLeft") {
      moveGallery(-1);
    }
    if (event.key === "ArrowRight") {
      moveGallery(1);
    }
  });

  // Step 2: Load the initial backend status and session inventory.
  await loadAppStatus();
  await loadModelServiceData();
  await loadSessions();
  renderWorkspace();

  // Step 3: Keep the sidebar counts fresh while preserving the current selection.
  window.setInterval(async () => {
    if (state.isBusy) {
      return;
    }
    try {
      await loadAppStatus();
      await loadModelServiceData();
      await loadSessions();
      if (state.selectedSessionId) {
        renderSessionList();
      }
      renderWorkspace();
    } catch (error) {
      showError(error.message || "Background refresh failed.");
    }
  }, 5000);
}

initialize().catch((error) => {
  // Step 1: Surface bootstrap errors in the main workspace when initialization fails.
  elements.chatLog.className = "chat-log empty-state";
  elements.chatLog.textContent = `Initialization failed: ${error.message}`;
});