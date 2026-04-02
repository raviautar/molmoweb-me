const state = {
  appConfig: null,
  selectedSessionId: null,
  selectedTurnIndex: null,
  sessions: [],
  sessionDetail: null,
  isBusy: false,
  busyButtonKey: null,
  busyButtonText: "Working",
  closeInFlight: false,
  modelServiceStatus: null,
  modelServiceLogs: null,
  galleryUrls: [],
  galleryIndex: 0,
  sidebarOpen: false,
  backgroundRefreshInFlight: false,
  expandedThoughtKeys: new Set(),
};

const elements = {
  activeJobLog: document.getElementById("active-job-log"),
  archivedBanner: document.getElementById("archived-banner"),
  archivedBannerText: document.getElementById("archived-banner-text"),
  archivedCount: document.getElementById("archived-count"),
  archivedSessionList: document.getElementById("archived-session-list"),
  artifactInfoHint: document.getElementById("artifact-info-hint"),
  artifactInfoTitle: document.getElementById("artifact-info-title"),
  artifactSummary: document.getElementById("artifact-summary"),
  artifactsTitle: document.getElementById("artifacts-title"),
  brandCopy: document.getElementById("brand-copy"),
  brandEyebrow: document.getElementById("brand-eyebrow"),
  brandTitle: document.getElementById("brand-title"),
  chatLog: document.getElementById("chat-log"),
  closeSessionButton: document.getElementById("close-session-button"),
  conversationTitle: document.getElementById("conversation-title"),
  currentSessionsSummary: document.getElementById("current-sessions-summary"),
  defaultEndpoint: document.getElementById("default-endpoint"),
  errorBanner: document.getElementById("error-banner"),
  errorBannerText: document.getElementById("error-banner-text"),
  runningBanner: document.getElementById("running-banner"),
  runningBannerText: document.getElementById("running-banner-text"),
  galleryCaption: document.getElementById("gallery-caption"),
  galleryClose: document.getElementById("gallery-close"),
  galleryImage: document.getElementById("gallery-image"),
  galleryModal: document.getElementById("gallery-modal"),
  galleryNext: document.getElementById("gallery-next"),
  galleryPrev: document.getElementById("gallery-prev"),
  latestSnapshotLink: document.getElementById("latest-snapshot-link"),
  liveCount: document.getElementById("live-count"),
  liveSessionList: document.getElementById("live-session-list"),
  metricArchivedLabel: document.getElementById("metric-archived-label"),
  metricEndpointLabel: document.getElementById("metric-endpoint-label"),
  metricLiveLabel: document.getElementById("metric-live-label"),
  modelLogView: document.getElementById("model-log-view"),
  modelStatusGrid: document.getElementById("model-status-grid"),
  newChatButton: document.getElementById("new-chat-button"),
  newChatButtonTopbar: document.getElementById("new-chat-button-topbar"),
  nextPromptLabel: document.getElementById("next-prompt-label"),
  pastSessionsSummary: document.getElementById("past-sessions-summary"),
  promptInput: document.getElementById("prompt-input"),
  promptMaxSteps: document.getElementById("prompt-max-steps"),
  promptMaxStepsLabel: document.getElementById("prompt-max-steps-label"),
  refreshSessionButton: document.getElementById("refresh-session-button"),
  sendPromptButton: document.getElementById("send-prompt-button"),
  serviceHealthHint: document.getElementById("service-health-hint"),
  serviceHealthTitle: document.getElementById("service-health-title"),
  stopRunButton: document.getElementById("stop-run-button"),
  samplePromptExpectedAnswer: document.getElementById("sample-prompt-expected-answer"),
  samplePromptExpectationLabel: document.getElementById("sample-prompt-expectation-label"),
  samplePromptTitle: document.getElementById("sample-prompt-title"),
  sessionDefaultsMeta: document.getElementById("session-defaults-meta"),
  sessionDefaultsTitle: document.getElementById("session-defaults-title"),
  sessionEndpoint: document.getElementById("session-endpoint"),
  sessionEndpointLabel: document.getElementById("session-endpoint-label"),
  sessionHeadless: document.getElementById("session-headless"),
  sessionHeadlessLabel: document.getElementById("session-headless-label"),
  sessionChromeProfile: document.getElementById("session-chrome-profile"),
  sessionChromeProfileLabel: document.getElementById("session-chrome-profile-label"),
  sessionChromeChannel: document.getElementById("session-chrome-channel"),
  sessionChromeChannelLabel: document.getElementById("session-chrome-channel-label"),
  sessionChromeProfileName: document.getElementById("session-chrome-profile-name"),
  sessionChromeProfileNameLabel: document.getElementById("session-chrome-profile-name-label"),
  profileHint: document.getElementById("profile-hint"),
  sessionInfoButton: document.getElementById("session-info-button"),
  sessionMaxSteps: document.getElementById("session-max-steps"),
  sessionMaxStepsLabel: document.getElementById("session-max-steps-label"),
  sessionMeta: document.getElementById("session-meta"),
  sessionSummary: document.getElementById("session-summary"),
  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  sidebarCloseButton: document.getElementById("sidebar-close-button"),
  sidebarToggleButton: document.getElementById("sidebar-toggle-button"),
  snapshotGrid: document.getElementById("snapshot-grid"),
  snapshotsTitle: document.getElementById("snapshots-title"),
  toastBanner: document.getElementById("toast-banner"),
  toastBannerText: document.getElementById("toast-banner-text"),
  trajectoryLink: document.getElementById("trajectory-link"),
  runSamplePromptButton: document.getElementById("run-sample-prompt-button"),
  useSamplePromptButton: document.getElementById("use-sample-prompt-button"),
  workspaceEyebrow: document.getElementById("workspace-eyebrow"),
  workspaceTitle: document.getElementById("workspace-title"),
};

let toastTimerId = null;
const buttonLabels = new Map();

[
  elements.newChatButton,
  elements.newChatButtonTopbar,
  elements.refreshSessionButton,
  elements.closeSessionButton,
  elements.sendPromptButton,
  elements.useSamplePromptButton,
  elements.runSamplePromptButton,
].forEach((button) => {
  if (button) {
    buttonLabels.set(button, button.textContent || "");
  }
});

function getRoutes() {
  // Step 1: Return the configured API routes after the frontend config has loaded.
  return state.appConfig ? state.appConfig.routes : {};
}

function getLabels() {
  // Step 1: Return the configured UI labels so render functions stay concise.
  return state.appConfig ? state.appConfig.labels : {};
}

function getAlerts() {
  // Step 1: Return the configured alerts so all user-facing prompts come from one source.
  return state.appConfig ? state.appConfig.alerts : {};
}

function getEmptyStates() {
  // Step 1: Return the configured empty-state copy used across the main panels.
  return state.appConfig ? state.appConfig.emptyStates : {};
}

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

function escapeHtml(value) {
  // Step 1: Convert arbitrary text into safe HTML for insertion into templates.
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkifyText(value) {
  // Step 1: Walk the raw text so URL extraction preserves the exact source characters.
  const rawValue = String(value || "");
  const urlPattern = /(https?:\/\/[^\s<>"]+)/g;
  const chunks = [];
  let cursor = 0;
  let match = urlPattern.exec(rawValue);

  // Step 2: Escape non-URL text and wrap URL text in a safe anchor without altering encoded characters.
  while (match) {
    const matchedUrl = match[0];
    const matchIndex = match.index;
    let normalizedUrl = matchedUrl;
    let trailingText = "";

    while (/[),.;!?]$/.test(normalizedUrl)) {
      trailingText = normalizedUrl.slice(-1) + trailingText;
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    chunks.push(escapeHtml(rawValue.slice(cursor, matchIndex)));
    if (normalizedUrl) {
      const escapedUrl = escapeHtml(normalizedUrl);
      chunks.push(`<a class="inline-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`);
    }
    chunks.push(escapeHtml(trailingText));
    cursor = matchIndex + matchedUrl.length;
    match = urlPattern.exec(rawValue);
  }

  // Step 3: Append the remaining plain text after the final URL match.
  chunks.push(escapeHtml(rawValue.slice(cursor)));
  return chunks.join("");
}

function renderLinkedTextBlock(value, className = "") {
  // Step 1: Render chat text in a whitespace-preserving block with clickable links.
  const resolvedClassName = className ? ` class="${className}"` : "";
  return `<div${resolvedClassName}>${linkifyText(value || "")}</div>`;
}

function formatDate(value) {
  // Step 1: Return a fallback label when no timestamp is available.
  if (!value) {
    return "N/A";
  }

  // Step 2: Format the timestamp in the operator's local timezone.
  return new Date(value).toLocaleString();
}

function toFiniteNumber(value) {
  // Step 1: Parse numeric values from mixed payload types safely.
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatSeconds(value, fractionDigits = 3) {
  // Step 1: Render a stable seconds label for runtime debugging fields.
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) {
    return "N/A";
  }
  return `${numericValue.toFixed(fractionDigits)} s`;
}

function getTurnModelRuntimeSeconds(turn) {
  // Step 1: Prefer the precomputed turn-level model runtime when available.
  const turnRuntime = toFiniteNumber(turn && turn.model_runtime_total_seconds);
  if (turnRuntime !== null) {
    return turnRuntime;
  }

  // Step 2: Fall back to summing per-step inference runtimes for older persisted turns.
  const steps = Array.isArray(turn && turn.steps) ? turn.steps : [];
  const stepRuntimeTotal = steps.reduce((total, step) => {
    const stepRuntime = toFiniteNumber(step && step.model_inference_seconds);
    return total + (stepRuntime === null ? 0 : stepRuntime);
  }, 0);
  return stepRuntimeTotal > 0 ? stepRuntimeTotal : null;
}

function getTurnInferenceCount(turn) {
  // Step 1: Prefer the precomputed turn-level inference count when available.
  const turnCount = toFiniteNumber(turn && turn.model_inference_count);
  if (turnCount !== null) {
    return Math.max(0, Math.trunc(turnCount));
  }

  // Step 2: Count per-step inference records for older persisted turns.
  const steps = Array.isArray(turn && turn.steps) ? turn.steps : [];
  const count = steps.reduce((total, step) => {
    return total + (toFiniteNumber(step && step.model_inference_seconds) === null ? 0 : 1);
  }, 0);
  return count > 0 ? count : null;
}

function showError(message) {
  // Step 1: Hide the error banner when there is nothing useful to show.
  if (!message) {
    elements.errorBanner.classList.add("hidden");
    elements.errorBannerText.textContent = "";
    return;
  }

  // Step 2: Render the operator-facing error text in the chat panel.
  elements.errorBannerText.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

function showRunningBanner(session) {
  // Step 1: Hide the stop banner when no selected live run is active.
  if (!session || !session.live || session.run_state !== "running") {
    elements.runningBanner.classList.add("hidden");
    elements.runningBannerText.textContent = "";
    return;
  }

  // Step 2: Explain that the active run can be interrupted immediately from the workspace.
  elements.runningBannerText.textContent = "Run in progress. Use Stop Run to close the session and stop further reasoning.";
  elements.runningBanner.classList.remove("hidden");
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

function showToast(message) {
  // Step 1: Hide any existing toast timer before showing the next message.
  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId);
  }

  // Step 2: Render the new toast message.
  elements.toastBannerText.textContent = message;
  elements.toastBanner.classList.remove("hidden");

  // Step 3: Clear the toast after a short delay.
  toastTimerId = window.setTimeout(() => {
    elements.toastBanner.classList.add("hidden");
    elements.toastBannerText.textContent = "";
    toastTimerId = null;
  }, 3200);
}

function formatCompletionStatus(status) {
  // Step 1: Return an empty label when the turn has no completion state.
  if (!status) {
    return "";
  }

  // Step 2: Convert the machine-readable status into an operator-facing label.
  return status.replaceAll("_", " ");
}

function renderCompletionBadge(status) {
  // Step 1: Skip badge rendering when no completion status is present.
  if (!status) {
    return "";
  }

  // Step 2: Render a compact badge that makes completion states visible in the UI.
  const statusClass = status.replaceAll("_", "-");
  return `<span class="completion-badge ${escapeHtml(statusClass)}">${escapeHtml(formatCompletionStatus(status))}</span>`;
}

async function copyTextToClipboard(text) {
  // Step 1: Prefer the async clipboard API when it is available.
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Step 2: Fall back to a temporary textarea for non-secure contexts.
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "true");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  document.body.removeChild(helper);
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
  const selectedSessionIsRunning = Boolean(selectedSessionIsLive && state.sessionDetail && state.sessionDetail.run_state === "running");
  const closeIsBusy = state.closeInFlight || (isBusy && busyButtonKey === "close");

  // Step 2: Toggle the action buttons and inputs based on the current busy and session state.
  elements.sendPromptButton.disabled = isBusy || selectedSessionIsArchived;
  elements.closeSessionButton.disabled = closeIsBusy || !(selectedSessionIsLive || selectedSessionIsRunning);
  elements.refreshSessionButton.disabled = isBusy || !state.selectedSessionId;
  elements.stopRunButton.disabled = closeIsBusy || !selectedSessionIsRunning;
  elements.newChatButton.disabled = isBusy;
  elements.newChatButtonTopbar.disabled = isBusy;
  elements.useSamplePromptButton.disabled = isBusy;
  elements.runSamplePromptButton.disabled = isBusy || selectedSessionIsArchived;
  elements.promptInput.disabled = isBusy || selectedSessionIsArchived;
  elements.promptMaxSteps.disabled = isBusy || selectedSessionIsArchived;
  elements.sessionEndpoint.disabled = isBusy;
  elements.sessionHeadless.disabled = isBusy;
  elements.sessionMaxSteps.disabled = isBusy;
  elements.sessionChromeProfile.disabled = isBusy;
  elements.sessionChromeChannel.disabled = isBusy;
  elements.sessionChromeProfileName.disabled = isBusy;

  // Step 3: Show a small spinner only on the action button tied to the current operation.
  setButtonBusy(elements.sendPromptButton, isBusy && busyButtonKey === "send", busyText);
  setButtonBusy(elements.closeSessionButton, closeIsBusy, state.closeInFlight ? "Closing" : busyText);
  setButtonBusy(elements.refreshSessionButton, isBusy && busyButtonKey === "refresh", busyText);
  setButtonBusy(elements.newChatButton, isBusy && busyButtonKey === "newChat", busyText);
  setButtonBusy(elements.newChatButtonTopbar, isBusy && busyButtonKey === "newChatTopbar", busyText);
  setButtonBusy(elements.useSamplePromptButton, isBusy && busyButtonKey === "sampleUse", busyText);
  setButtonBusy(elements.runSamplePromptButton, isBusy && busyButtonKey === "sampleRun", busyText);
}

function setSidebarOpen(isOpen) {
  // Step 1: Store the drawer state so the hamburger and backdrop stay synchronized.
  state.sidebarOpen = isOpen;

  // Step 2: Toggle the body class that drives the drawer animation and backdrop interactivity.
  document.body.classList.toggle("sidebar-open", isOpen);
}

function applyFrontendConfig() {
  // Step 1: Stop early until the backend-provided frontend config has been loaded.
  if (!state.appConfig) {
    return;
  }

  const branding = state.appConfig.branding;
  const labels = state.appConfig.labels;
  const placeholders = state.appConfig.placeholders;
  const defaults = state.appConfig.defaults;
  const sample = state.appConfig.samples.hazlnutFaq;

  // Step 2: Apply the static copy and default field values to the DOM.
  document.title = branding.browserTitle;
  elements.brandEyebrow.textContent = branding.brandEyebrow;
  elements.brandTitle.textContent = branding.brandTitle;
  elements.brandCopy.textContent = branding.brandCopy;
  elements.workspaceEyebrow.textContent = branding.statusEyebrow;
  elements.workspaceTitle.textContent = branding.workspaceDefaultTitle;
  elements.sessionDefaultsTitle.textContent = labels.sessionDefaultsTitle;
  elements.sessionDefaultsMeta.textContent = labels.sessionDefaultsMeta;
  elements.sessionEndpointLabel.textContent = labels.sessionEndpoint;
  elements.sessionMaxStepsLabel.textContent = labels.sessionMaxSteps;
  elements.sessionHeadlessLabel.textContent = labels.sessionHeadless;
  elements.sessionChromeProfileLabel.textContent = labels.sessionChromeProfile;
  elements.sessionChromeChannelLabel.textContent = labels.sessionChromeChannel;
  elements.sessionChromeProfileNameLabel.textContent = labels.sessionChromeProfileName;
  elements.newChatButton.textContent = labels.startFresh;
  elements.newChatButtonTopbar.textContent = labels.startFreshShort;
  elements.currentSessionsSummary.textContent = labels.currentSessions;
  elements.pastSessionsSummary.textContent = labels.pastSessions;
  elements.metricLiveLabel.textContent = labels.metricLive;
  elements.metricArchivedLabel.textContent = labels.metricArchived;
  elements.metricEndpointLabel.textContent = labels.metricEndpoint;
  elements.conversationTitle.textContent = labels.conversation;
  elements.refreshSessionButton.textContent = labels.refresh;
  elements.closeSessionButton.textContent = labels.closeSession;
  elements.nextPromptLabel.textContent = labels.nextPrompt;
  elements.promptMaxStepsLabel.textContent = labels.sessionMaxSteps;
  elements.sendPromptButton.textContent = labels.runTurn;
  elements.artifactsTitle.textContent = labels.artifacts;
  elements.artifactInfoTitle.textContent = labels.artifactInfoTitle;
  elements.artifactInfoHint.textContent = labels.artifactInfoHint;
  elements.trajectoryLink.textContent = labels.openTrajectory;
  elements.latestSnapshotLink.textContent = labels.openLatestSnapshot;
  elements.snapshotsTitle.textContent = labels.snapshots;
  elements.samplePromptTitle.textContent = labels.samplePromptTitle;
  elements.samplePromptExpectationLabel.textContent = labels.samplePromptExpectation;
  elements.samplePromptExpectedAnswer.textContent = sample.expectedAnswer;
  elements.useSamplePromptButton.textContent = labels.samplePromptUse;
  elements.runSamplePromptButton.textContent = labels.samplePromptRun;
  elements.serviceHealthTitle.textContent = labels.serviceHealth;
  elements.serviceHealthHint.textContent = labels.serviceHealthHint;
  elements.sessionEndpoint.placeholder = placeholders.endpoint;
  // Step 1: Embed the quick-sample hint directly into the textarea placeholder so no
  // extra UI block is needed — the sample label + expected answer appear as a second
  // line of greyed-out hint text when the field is empty.
  const sampleHint = `\n— ${labels.samplePromptTitle}: ${sample.prompt.length > 100 ? sample.prompt.slice(0, 100) + "…" : sample.prompt}  (${labels.samplePromptExpectation}: ${sample.expectedAnswer})`;
  elements.promptInput.placeholder = placeholders.prompt + sampleHint;
  elements.sessionChromeProfile.placeholder = placeholders.chromeProfile;
  elements.sessionChromeChannel.placeholder = placeholders.chromeChannel;
  elements.sessionChromeProfileName.placeholder = placeholders.chromeProfileName;
  // Step 3: Pre-fill the profile name with the correct default so it is visible to the user.
  if (!elements.sessionChromeProfileName.value) {
    elements.sessionChromeProfileName.value = "Default";
  }
  elements.sessionMaxSteps.min = String(defaults.minSteps);
  elements.sessionMaxSteps.max = String(defaults.maxStepsLimit);
  elements.sessionMaxSteps.value = String(defaults.maxSteps);
  elements.promptMaxSteps.min = String(defaults.minSteps);
  elements.promptMaxSteps.max = String(defaults.maxStepsLimit);
  elements.promptMaxSteps.value = String(defaults.maxSteps);
  elements.sessionHeadless.value = defaults.headless ? "true" : "false";

  // Step 3: Refresh cached button labels after the configured copy has been applied.
  [
    elements.newChatButton,
    elements.newChatButtonTopbar,
    elements.refreshSessionButton,
    elements.closeSessionButton,
    elements.sendPromptButton,
    elements.useSamplePromptButton,
    elements.runSamplePromptButton,
  ].forEach((button) => {
    if (button) {
      buttonLabels.set(button, button.textContent || "");
    }
  });
}

function summarizeSession(session) {
  // Step 1: Build a concise summary string used throughout the header and sidebar.
  const summary = state.appConfig.summary;
  const scope = session.live ? summary.live : summary.archived;
  const runState = session.run_state ? ` • ${session.run_state}` : "";
  return `${scope}${runState} • ${session.turn_count || 0} ${summary.turns} • ${summary.updated} ${formatDate(session.updated_at)}`;
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

function updateProfileHint() {
  const hint = elements.profileHint;
  if (!hint) {
    return;
  }

  const raw = elements.sessionChromeProfile.value.trim();

  // Step 1: Hide the hint when the field is empty — no noise for default isolated sessions.
  if (!raw) {
    hint.textContent = "";
    hint.className = "field-hint hint-idle hidden";
    return;
  }

  // Step 2: Warn when a Windows-style path is entered but the server is running on Linux.
  // The Playwright browser launches on the server, not the user's local machine.
  const isWindowsPath = /^[A-Za-z]:[/\\]/.test(raw);
  const serverIsLinux = state.appConfig && state.appConfig.serverPlatform !== "win32";
  if (isWindowsPath && serverIsLinux) {
    hint.textContent =
      "⚠ Windows path detected, but the browser runs on the Linux server — not your local machine. " +
      "You need a Linux path to a Chrome profile copied onto the server, or leave this field empty to use an isolated session.";
    hint.className = "field-hint hint-warn";
    hint.classList.remove("hidden");
    return;
  }

  // Step 3: Check whether the value looks like a plausible absolute path.
  const looksAbsolute = /^(\/|~\/|[A-Za-z]:[/\\])/.test(raw);
  if (!looksAbsolute) {
    hint.textContent = "⚠ Path should be absolute, e.g. /home/you/.config/google-chrome";
    hint.className = "field-hint hint-warn";
    hint.classList.remove("hidden");
    return;
  }

  // Step 4: Warn about the most common mistake — pointing at the Default sub-folder instead of User Data.
  const endsAtDefault = /[/\\]Default\s*$/.test(raw);
  if (endsAtDefault) {
    hint.textContent = "⚠ Use the parent 'User Data' directory, not the 'Default' sub-folder inside it.";
    hint.className = "field-hint hint-warn";
    hint.classList.remove("hidden");
    return;
  }

  // Step 5: Path looks good — remind the user Chrome must be closed before starting.
  hint.textContent = "✓ Profile path set. Make sure Chrome is fully closed before clicking Start Fresh.";
  hint.className = "field-hint hint-ok";
  hint.classList.remove("hidden");
}

async function startFreshSession(busyKey) {
  // Step 1: Validate Chrome profile path before creating the session.
  const profileDir = elements.sessionChromeProfile.value.trim();
  if (profileDir) {
    const isWindowsPath = /^[A-Za-z]:[/\\]/.test(profileDir);
    const serverIsLinux = state.appConfig && state.appConfig.serverPlatform !== "win32";
    const looksAbsolute = /^(\/|~\/|[A-Za-z]:[/\\])/.test(profileDir);
    const endsAtDefault = /[/\\]Default\s*$/.test(profileDir);
    if ((isWindowsPath && serverIsLinux) || !looksAbsolute || endsAtDefault) {
      updateProfileHint();
      elements.sessionChromeProfile.focus();
      return;
    }
  }

  // Step 2: Clear any existing selection so the workspace moves to a blank slate immediately.
  clearSelection();

  setBusy(true, busyKey, "Creating");
  showError("");

  try {
    // Step 3: Eagerly create the session so the user sees a live context right away, without
    // waiting to type a prompt first.
    const session = await fetchJson(getRoutes().sessions, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSessionDefaults()),
    });

    // Step 4: Refresh the sidebar and select the brand-new session.
    await loadAppStatus();
    await loadSessions();
    await selectSession(session.session_id);

    // Step 5: Show a toast that describes which browser mode was started.
    const profileSet = (session.chrome_profile_dir || "").trim();
    const channel = (session.chrome_channel || "").trim();
    const modeLabel = profileSet
      ? `Chrome profile session${channel ? ` (${channel})` : ""} — inheriting existing logins`
      : "Isolated Chromium session — no existing logins";
    showToast(`Session created: ${modeLabel}`);

    // Step 6: Close the sidebar so the workspace is the focus after creation.
    setSidebarOpen(false);
  } catch (err) {
    showError(String(err));
  } finally {
    setBusy(false);
  }
}

function applySamplePrompt() {
  // Step 1: Copy the built-in Hazlnut FAQ prompt into the composer for quick manual runs.
  elements.promptInput.value = state.appConfig.samples.hazlnutFaq.prompt;
  elements.promptInput.focus();
}

function getSessionDefaults() {
  // Step 1: Read the current operator defaults from the drawer panel.
  return {
    title: null,
    endpoint: elements.sessionEndpoint.value.trim() || null,
    local: true,
    headless: elements.sessionHeadless.value === "true",
    max_steps_default: Number(elements.sessionMaxSteps.value || state.appConfig.defaults.maxSteps),
    // Step 2: Pass the Chrome profile path and channel so ProfiledChromeEnv is used when set.
    chrome_profile_dir: elements.sessionChromeProfile.value.trim(),
    chrome_channel: elements.sessionChromeChannel.value.trim(),
    // Step 3: Send the sub-profile name; defaults to "Default" on the server when blank.
    chrome_profile_name: elements.sessionChromeProfileName.value.trim() || "Default",
  };
}

function renderSessionList() {
  // Step 1: Split sessions into live and archived groups for the drawer explorer.
  const liveSessions = state.sessions.filter((session) => session.live);
  const archivedSessions = state.sessions.filter((session) => !session.live);

  // Step 2: Render one group at a time using the shared helper.
  renderSessionGroup(elements.liveSessionList, liveSessions);
  renderSessionGroup(elements.archivedSessionList, archivedSessions);
}

function renderSessionGroup(container, sessions) {
  // Step 1: Render an empty message when the group has no sessions.
  if (sessions.length === 0) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(getEmptyStates().sessions)}</div>`;
    return;
  }

  const statusPills = state.appConfig.statusPills;

  // Step 2: Render clickable session cards with current summary and status details.
  container.innerHTML = sessions
    .map((session) => {
      const isActive = session.session_id === state.selectedSessionId;
      const completionBadge = renderCompletionBadge(session.completion_status || "");
      const sessionCardClass = session.completion_status === "max_steps"
        ? "max-steps"
        : session.completion_status === "error"
          ? "error"
          : "";
      return `
        <article class="session-card ${sessionCardClass} ${isActive ? "active" : ""}" data-session-id="${session.session_id}">
          <div class="session-card-header">
            <div class="status-pill">${session.live ? statusPills.live : statusPills.archived}</div>
            ${completionBadge}
          </div>
          <h3>${escapeHtml(session.title)}</h3>
          <div class="session-card-meta">${escapeHtml(summarizeSession(session))}</div>
          <div class="session-card-meta">${escapeHtml(session.endpoint || "")}</div>
        </article>
      `;
    })
    .join("");

  // Step 3: Attach click handlers after the HTML has been written.
  container.querySelectorAll(".session-card").forEach((card) => {
    card.addEventListener("click", async () => {
      await selectSession(card.dataset.sessionId);
      setSidebarOpen(false);
    });
  });
}

function renderSessionInfo(session) {
  // Step 1: Render the info-popover empty state when no session is selected.
  if (!session) {
    elements.sessionMeta.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(getEmptyStates().sessionInfo)}</div>`;
    return;
  }

  const entries = [
    ["Session ID", session.session_id],
    ["Created", formatDate(session.created_at)],
    ["Updated", formatDate(session.updated_at)],
    ["Closed", formatDate(session.closed_at)],
    ["Endpoint", session.endpoint],
    ["Headless", String(session.headless)],
    ["Local Browser", String(session.local)],
    ["Chrome Profile", session.chrome_profile_dir || ""],
    ["Chrome Profile Name", session.chrome_profile_name || "Default"],
    ["Chrome Channel", session.chrome_channel || ""],
    ["Max Steps Default", String(session.max_steps_default)],
    ["Run State", session.run_state || "idle"],
    ["Current Turn", String(session.current_turn_index || 0)],
    ["Current Step", String(session.current_step_index || 0)],
    ["Transcript", session.chat_transcript_path],
    ["Event Log", session.event_log_path],
  ];

  // Step 2: Render the selected session metadata inside the hover card.
  elements.sessionMeta.innerHTML = entries
    .map(
      ([label, value]) => `
        <div class="meta-item compact">
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
  if ((session.run_state || "") === "stale_running") {
    return "This session was still running when the model server or WebUI was stopped. Its live browser was detached and the run was marked stale.";
  }
  if ((session.run_state || "") === "stale") {
    return "This session was marked stale because the model server was stopped. Its saved artifacts remain available for review.";
  }
  if ((session.run_state || "") === "closed") {
    return "This session is archived. The live browser is no longer attached, but all saved artifacts remain available for review.";
  }
  return "This session is archived and cannot accept new prompts. Use Start Fresh to create a new live browser session.";
}

function renderStepThoughtMessages(turn, isSelectedTurn) {
  // Step 1: Skip step-thought rendering when the turn has no persisted step data.
  if (!Array.isArray(turn.steps) || turn.steps.length === 0) {
    return "";
  }

  // Step 2: Render each step as a compact assistant-side reasoning card with collapsible details.
  return turn.steps
    .map((step) => {
      const thoughtKey = `${turn.turn_index}-${step.step_index}`;
      const thoughtText = step.thought || step.action_text || step.message || step.error || "No structured text";
      const summaryText = thoughtText.length > 140 ? `${thoughtText.slice(0, 140).trim()}...` : thoughtText;
      const pageTitle = step.page_title || "Untitled page";
      const pageUrl = step.page_url || "";
      const actionName = step.action_name || "no-action";
      const actionText = step.action_text || "";
      const stepMessage = step.message || "";
      const stepError = step.error || "";
      const stepInferenceSeconds = toFiniteNumber(step.model_inference_seconds);
      const stepTotalRuntimeSeconds = toFiniteNumber(step.model_total_runtime_seconds);
      const stepTotalInferenceCount = toFiniteNumber(step.model_total_inference_count);
      const runtimeSegments = [];
      if (stepInferenceSeconds !== null) {
        runtimeSegments.push(`Inference runtime ${formatSeconds(stepInferenceSeconds)}`);
      }
      if (stepTotalRuntimeSeconds !== null) {
        const callSuffix = stepTotalInferenceCount !== null ? ` (${Math.max(0, Math.trunc(stepTotalInferenceCount))} calls)` : "";
        runtimeSegments.push(`Model total ${formatSeconds(stepTotalRuntimeSeconds)}${callSuffix}`);
      }
      const runtimeMeta = runtimeSegments.length > 0
        ? `<div class="chat-step-meta mono">${escapeHtml(runtimeSegments.join(" • "))}</div>`
        : "";
      const openAttribute = state.expandedThoughtKeys.has(thoughtKey) ? " open" : "";
      return `
        <div class="chat-row assistant-row thought-row" data-turn-index="${turn.turn_index}">
          <article class="chat-card assistant thought-card ${isSelectedTurn ? "active" : ""}">
            <details class="thought-disclosure" data-thought-key="${escapeHtml(thoughtKey)}"${openAttribute}>
              <summary>
                <span class="thought-summary-eyebrow">Thought ${escapeHtml(String(step.step_index))} • ${escapeHtml(actionName)}</span>
                <span class="thought-summary-text">${escapeHtml(summaryText)}</span>
              </summary>
              <div class="thought-body">
                <div class="chat-step-meta">${escapeHtml(pageTitle)}</div>
                <div class="chat-step-meta mono">${escapeHtml(pageUrl)}</div>
                ${runtimeMeta}
                ${renderLinkedTextBlock(thoughtText, "thought-paragraph")}
                ${actionText ? renderLinkedTextBlock(actionText, "thought-detail mono") : ""}
                ${stepMessage ? renderLinkedTextBlock(stepMessage, "thought-detail") : ""}
                ${stepError ? renderLinkedTextBlock(stepError, "thought-detail error-text") : ""}
              </div>
            </details>
          </article>
        </div>
      `;
    })
    .join("");
}

function getLiveTurn(session) {
  // Step 1: Return the in-memory live turn only while the session is actively running.
  if (!session || !session.live_turn || session.run_state !== "running") {
    return null;
  }

  return session.live_turn;
}

function getDisplayTurns(session) {
  // Step 1: Start from the persisted turns already saved for the selected session.
  const persistedTurns = Array.isArray(session && session.turns) ? session.turns : [];
  const liveTurn = getLiveTurn(session);

  // Step 2: Drop the matching running turn from disk when an in-memory live turn is available.
  const turns = liveTurn
    ? persistedTurns.filter((turn) => !(turn.turn_index === liveTurn.turn_index && turn.completion_status === "running"))
    : persistedTurns;

  return { turns, liveTurn };
}

function getTurnByIndex(session, turnIndex) {
  // Step 1: Search the persisted and in-memory turn sources using one shared helper.
  const { turns, liveTurn } = getDisplayTurns(session);
  const persistedTurn = turns.find((candidate) => candidate.turn_index === turnIndex) || null;
  if (persistedTurn) {
    return persistedTurn;
  }

  // Step 2: Fall back to the live in-progress turn when it matches the requested turn index.
  if (liveTurn && liveTurn.turn_index === turnIndex) {
    return liveTurn;
  }

  return null;
}

function renderChat(session) {
  // Step 1: Show the empty state until a session is selected.
  if (!session) {
    elements.chatLog.className = "chat-log empty-state";
    elements.chatLog.textContent = getEmptyStates().chatNoSelection;
    return;
  }

  const { turns, liveTurn } = getDisplayTurns(session);
  const cards = [];

  // Step 2: Render each turn as a user card, streamed assistant thought cards, and a final assistant answer card.
  turns.forEach((turn) => {
    const isSelectedTurn = state.selectedTurnIndex === turn.turn_index;
    const completionStatus = turn.completion_status || "";
    const assistantMetaParts = [turn.final_page_title || "No page title", turn.final_page_url || ""];
    if (completionStatus) {
      assistantMetaParts.push(formatCompletionStatus(completionStatus));
    }
    cards.push(`
      <div class="chat-row user-row" data-turn-index="${turn.turn_index}">
        <article class="chat-card user ${isSelectedTurn ? "active" : ""}">
          <div class="chat-card-header">
            <div>
              <div class="chat-card-meta">Turn ${turn.turn_index} • ${escapeHtml(formatDate(turn.started_at))}</div>
              <h3>User</h3>
            </div>
            <button class="copy-prompt-button" type="button" data-copy-prompt="${escapeHtml(turn.prompt)}">Copy Prompt</button>
          </div>
          ${renderLinkedTextBlock(turn.prompt, "chat-text-block")}
        </article>
      </div>
    `);
    cards.push(renderStepThoughtMessages(turn, isSelectedTurn));
    cards.push(`
      <div class="chat-row assistant-row" data-turn-index="${turn.turn_index}">
        <article class="chat-card assistant ${completionStatus === "max_steps" ? "max-steps" : ""} ${completionStatus === "error" ? "error" : ""} ${isSelectedTurn ? "active" : ""}">
          <div class="chat-card-header">
            <div>
              <div class="chat-card-meta">${escapeHtml(assistantMetaParts.filter(Boolean).join(" • "))}</div>
              <h3>Assistant</h3>
            </div>
            ${renderCompletionBadge(completionStatus)}
          </div>
          ${renderLinkedTextBlock(turn.assistant_text || turn.final_error || "No textual output", "chat-text-block")}
        </article>
      </div>
    `);
  });

  // Step 3: Render the in-progress live turn after completed turns so thoughts stream during execution.
  if (liveTurn) {
    const isSelectedTurn = state.selectedTurnIndex === liveTurn.turn_index;
    cards.push(`
      <div class="chat-row user-row" data-turn-index="${liveTurn.turn_index}">
        <article class="chat-card user ${isSelectedTurn ? "active" : ""}">
          <div class="chat-card-header">
            <div>
              <div class="chat-card-meta">Turn ${liveTurn.turn_index} • ${escapeHtml(formatDate(liveTurn.started_at))}</div>
              <h3>User</h3>
            </div>
            <button class="copy-prompt-button" type="button" data-copy-prompt="${escapeHtml(liveTurn.prompt || "")}">Copy Prompt</button>
          </div>
          ${renderLinkedTextBlock(liveTurn.prompt || "", "chat-text-block")}
        </article>
      </div>
    `);
    cards.push(renderStepThoughtMessages(liveTurn, isSelectedTurn));
    cards.push(`
      <div class="chat-row assistant-row" data-turn-index="${liveTurn.turn_index}">
        <article class="chat-card assistant active running-card ${isSelectedTurn ? "active" : ""}">
          <div class="chat-card-header">
            <div>
              <div class="chat-card-meta">Running • turn ${escapeHtml(String(liveTurn.turn_index || 0))} • step ${escapeHtml(String(liveTurn.step_count || 0))}/${escapeHtml(String(liveTurn.max_steps || session.max_steps_default || state.appConfig.defaults.maxSteps))}</div>
              <h3>Assistant</h3>
            </div>
            ${renderCompletionBadge("running")}
          </div>
          ${renderLinkedTextBlock(liveTurn.assistant_text || session.current_prompt || "Browser session is working...", "chat-text-block")}
        </article>
      </div>
    `);
  } else if ((session.run_state || "") === "running") {
    cards.push(`
      <div class="chat-row assistant-row">
        <article class="chat-card assistant active running-card">
          <div class="chat-card-meta">Running • turn ${escapeHtml(String(session.current_turn_index || 0))} • step ${escapeHtml(String(session.current_step_index || 0))}</div>
          <h3>Assistant</h3>
          ${renderLinkedTextBlock(session.current_prompt || "Browser session is working...", "chat-text-block")}
        </article>
      </div>
    `);
  }

  elements.chatLog.className = "chat-log";
  elements.chatLog.innerHTML = cards.join("");

  // Step 4: Attach click handlers so any turn card updates the artifact inspector.
  elements.chatLog.querySelectorAll(".chat-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button, a, summary, details")) {
        return;
      }
      if (!row.dataset.turnIndex) {
        return;
      }
      state.selectedTurnIndex = Number(row.dataset.turnIndex);
      renderInspector(session);
      renderChat(session);
    });
  });

  // Step 5: Persist thought disclosure state so polling does not collapse expanded reasoning cards.
  elements.chatLog.querySelectorAll(".thought-disclosure").forEach((details) => {
    details.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    details.addEventListener("toggle", () => {
      const thoughtKey = details.dataset.thoughtKey || "";
      if (!thoughtKey) {
        return;
      }
      if (details.open) {
        state.expandedThoughtKeys.add(thoughtKey);
      } else {
        state.expandedThoughtKeys.delete(thoughtKey);
      }
    });
  });

  // Step 6: Attach copy handlers to user prompt cards.
  elements.chatLog.querySelectorAll(".copy-prompt-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await copyTextToClipboard(button.dataset.copyPrompt || "");
        showToast(getAlerts().copySuccess);
      } catch (_error) {
        showError(getAlerts().copyFailure);
      }
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
  // Step 1: Render the inspector empty state until a session is selected.
  if (!session) {
    state.galleryUrls = [];
    elements.artifactSummary.textContent = getEmptyStates().artifacts;
    elements.snapshotGrid.className = "snapshot-grid empty-state";
    elements.snapshotGrid.textContent = getEmptyStates().snapshots;
    setArtifactLink(elements.trajectoryLink, "");
    setArtifactLink(elements.latestSnapshotLink, "");
    renderSessionInfo(null);
    return;
  }

  const { turns, liveTurn } = getDisplayTurns(session);

  if (!state.selectedTurnIndex) {
    if (liveTurn) {
      state.selectedTurnIndex = liveTurn.turn_index;
    } else if (turns.length > 0) {
      state.selectedTurnIndex = turns[turns.length - 1].turn_index;
    }
  }
  const turn = getTurnByIndex(session, state.selectedTurnIndex) || null;

  // Step 2: Render the selected session metadata inside the info popover.
  renderSessionInfo(session);

  // Step 3: Render the inspector summary and artifact links.
  const completionSuffix = turn && turn.completion_status ? ` • ${turn.completion_status.replaceAll("_", " ")}` : "";
  const turnModelRuntime = getTurnModelRuntimeSeconds(turn);
  const turnInferenceCount = getTurnInferenceCount(turn);
  const modelRuntimeSuffix = turnModelRuntime !== null
    ? ` • model runtime ${formatSeconds(turnModelRuntime)}${turnInferenceCount !== null ? ` (${turnInferenceCount} calls)` : ""}`
    : "";
  elements.artifactSummary.textContent = turn
    ? `Turn ${turn.turn_index} • ${turn.step_count} steps${completionSuffix}${modelRuntimeSuffix} • ${turn.final_page_title || "No final page title"}`
    : "No turns have been run for this session yet.";
  setArtifactLink(elements.trajectoryLink, turn ? turn.trajectory_html_url : "");
  setArtifactLink(
    elements.latestSnapshotLink,
    turn && Array.isArray(turn.snapshot_urls) && turn.snapshot_urls.length > 0
      ? turn.snapshot_urls[turn.snapshot_urls.length - 1]
      : session.latest_snapshot_url || "",
  );

  // Step 4: Render the snapshot rail for the selected turn.
  if (!turn || !turn.snapshot_urls || turn.snapshot_urls.length === 0) {
    state.galleryUrls = [];
    elements.snapshotGrid.className = "snapshot-grid empty-state";
    elements.snapshotGrid.textContent = getEmptyStates().noSnapshots;
  } else {
    const snapshotEntries = turn.snapshot_urls
      .map((url, index) => ({
        url,
        stepNumber: index + 1,
      }))
      .reverse();
    state.galleryUrls = snapshotEntries.map((entry) => entry.url);
    elements.snapshotGrid.className = "snapshot-grid";
    elements.snapshotGrid.innerHTML = snapshotEntries
      .map(
        (entry, index) => `
          <figure class="snapshot-card">
            <button class="snapshot-button" type="button" data-gallery-index="${index}">
              <img src="${entry.url}" alt="Turn ${turn.turn_index} step ${entry.stepNumber}" />
            </button>
            <figcaption class="session-card-meta">Step ${entry.stepNumber}</figcaption>
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
}

function renderModelService() {
  // Step 1: Render an empty state until the main model-service payload has been loaded.
  if (!state.modelServiceStatus) {
    elements.modelStatusGrid.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(getEmptyStates().modelStatus)}</div>`;
    elements.activeJobLog.className = "step-log empty-state";
    elements.activeJobLog.textContent = getEmptyStates().modelJobs;
    elements.modelLogView.className = "log-view empty-state";
    elements.modelLogView.textContent = getEmptyStates().modelLogs;
    return;
  }

  const status = state.modelServiceStatus;
  const totalInferenceCount = Math.max(0, Math.trunc(toFiniteNumber(status.model_total_inference_count) || 0));
  const totalInferenceRuntime = toFiniteNumber(status.model_total_inference_seconds) || 0;
  const averageInferenceRuntime = toFiniteNumber(status.model_average_inference_seconds);
  const lastInferenceRuntime = toFiniteNumber(status.last_inference_seconds);

  // Step 2: Render key model-service metadata and the active job count.
  const metadataEntries = [
    ["Service PID", String(status.pid || "N/A")],
    ["Service Log", status.log_file || "N/A"],
    ["Checkpoint", status.checkpoint || "N/A"],
    ["Predictor Type", status.predictor_type || "N/A"],
    ["Queue Size", `${status.predictor_queue_size}/${status.predictor_queue_capacity}`],
    ["Active Jobs", String(status.active_job_count || 0)],
    ["Last Inference Runtime", formatSeconds(lastInferenceRuntime)],
    ["Average Inference Runtime", formatSeconds(averageInferenceRuntime)],
    ["Total Model Runtime", `${formatSeconds(totalInferenceRuntime)} (${totalInferenceCount} calls)`],
  ];
  const gpuEntries = Array.isArray(status.gpu_status)
    ? status.gpu_status.map((gpu) => {
        const total = Number(gpu.memory_total_mb || 0);
        const used = Number(gpu.memory_used_mb || 0);
        const percent = total > 0 ? ((used / total) * 100).toFixed(1) : "0.0";
        return [`GPU ${gpu.device_index}`, `${percent}% (${used}/${total} MB)`];
      })
    : [];
  elements.modelStatusGrid.innerHTML = metadataEntries
    .concat(gpuEntries)
    .map(
      ([label, value]) => `
        <div class="meta-item compact">
          <span class="label">${escapeHtml(label)}</span>
          <span class="value mono">${escapeHtml(value)}</span>
        </div>
      `,
    )
    .join("");

  // Step 3: Render active jobs when present, otherwise show the most recent tracked jobs.
  const activeJobs = Array.isArray(status.active_jobs) ? status.active_jobs : [];
  const trackedJobs = Array.isArray(status.tracked_jobs) ? status.tracked_jobs : [];
  const jobsToRender = activeJobs.length > 0 ? activeJobs : trackedJobs.slice(0, 5);
  if (jobsToRender.length === 0) {
    elements.activeJobLog.className = "step-log empty-state";
    elements.activeJobLog.textContent = getEmptyStates().modelJobsNone;
  } else {
    elements.activeJobLog.className = "step-log";
    elements.activeJobLog.innerHTML = jobsToRender
      .map((job) => {
        const inferenceRuntime = toFiniteNumber(job.inference_seconds);
        const runningRuntime = toFiniteNumber(job.running_elapsed_seconds);
        const runtimeLabel = inferenceRuntime !== null
          ? `Inference runtime ${formatSeconds(inferenceRuntime)}`
          : runningRuntime !== null
            ? `Inference runtime ${formatSeconds(runningRuntime)} (running)`
            : "Inference runtime pending";
        return `
          <article class="step-card compact-step-card">
            <div class="chat-card-meta">${escapeHtml(job.state || "unknown")} • turn ${escapeHtml(String(job.turn_index || 0))} • step ${escapeHtml(String(job.step_index || 0))}/${escapeHtml(String(job.max_steps || 0))}</div>
            <div class="chat-step-meta mono">${escapeHtml(runtimeLabel)}</div>
            <h4>${escapeHtml(job.session_title || job.session_id || job.job_key || "anonymous request")}</h4>
            <p>${escapeHtml(job.page_title || "")}</p>
            <pre>${escapeHtml(job.query || job.last_error || "")}</pre>
          </article>
        `;
      })
      .join("");
  }

  // Step 4: Render the tail of the model-service log inside the collapsed service details panel.
  const logText = state.modelServiceLogs && state.modelServiceLogs.text ? state.modelServiceLogs.text : "";
  elements.modelLogView.className = "log-view";
  elements.modelLogView.textContent = logText || getEmptyStates().modelLogsEmpty;
}

function renderWorkspace() {
  // Step 1: Update the top-level workspace labels and action state.
  const session = state.sessionDetail;
  elements.workspaceTitle.textContent = session ? session.title : state.appConfig.branding.workspaceDefaultTitle;
  elements.sessionSummary.textContent = session ? summarizeSession(session) : state.appConfig.branding.workspaceDefaultSummary;
  showArchivedMessage(getArchivedMessage(session));
  showRunningBanner(session);
  renderChat(session);
  renderInspector(session);
  renderModelService();
  setBusy(state.isBusy, state.busyButtonKey, state.busyButtonText);
}

async function loadFrontendConfig() {
  // Step 1: Fetch the backend-provided frontend config and apply it to the static DOM.
  state.appConfig = await fetchJson("/api/config");
  applyFrontendConfig();
}

async function loadModelServiceData() {
  // Step 1: Fetch the main model-service status and its current log tail through the WebUI backend.
  const routes = getRoutes();
  state.modelServiceStatus = await fetchJson(routes.modelServiceStatus);
  state.modelServiceLogs = await fetchJson(`${routes.modelServiceLogs}?lines=${state.appConfig.defaults.modelLogLines}`);
}

async function loadAppStatus() {
  // Step 1: Fetch the aggregate web UI status from the backend.
  const payload = await fetchJson(getRoutes().status);

  // Step 2: Update the summary cards in the workspace header.
  elements.liveCount.textContent = String(payload.live_session_count);
  elements.archivedCount.textContent = String(payload.archived_session_count);
  elements.defaultEndpoint.textContent = payload.default_model_endpoint;
  if (!elements.sessionEndpoint.value) {
    elements.sessionEndpoint.value = payload.default_model_endpoint;
  }
}

async function loadSessions() {
  // Step 1: Fetch the drawer session summaries from the backend.
  state.sessions = await fetchJson(getRoutes().sessions);

  // Step 2: Re-render the drawer with the latest session inventory.
  renderSessionList();
}

async function selectSession(sessionId) {
  // Step 1: Store the selected session identifier and clear the previous turn focus.
  state.selectedSessionId = sessionId;
  state.selectedTurnIndex = null;

  // Step 2: Fetch the full session detail payload for the workspace view.
  state.sessionDetail = await fetchJson(`${getRoutes().sessions}/${sessionId}`);

  // Step 3: Default the inspector to the most recent turn when one exists.
  const { turns, liveTurn } = getDisplayTurns(state.sessionDetail);
  if (liveTurn) {
    state.selectedTurnIndex = liveTurn.turn_index;
  } else if (turns.length > 0) {
    state.selectedTurnIndex = turns[turns.length - 1].turn_index;
  }

  // Step 4: Re-render the entire workspace and drawer highlight state.
  renderSessionList();
  renderWorkspace();
}

async function ensureLiveSession() {
  // Step 1: Reuse the current live session when one is already selected.
  if (state.selectedSessionId && state.sessionDetail && state.sessionDetail.live) {
    return state.selectedSessionId;
  }

  // Step 2: Create a fresh live session using the operator defaults.
  const session = await fetchJson(getRoutes().sessions, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getSessionDefaults()),
  });

  // Step 3: Refresh the drawer inventory and select the newly created session.
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

  showError("");
  setBusy(true, "send", "Running");
  try {
    // Step 2: Prevent new work from being sent to an archived session.
    if (state.selectedSessionId && state.sessionDetail && !state.sessionDetail.live) {
      throw new Error(getAlerts().archivedSelection);
    }

    // Step 3: Create a live session on demand when none is currently selected.
    const sessionId = await ensureLiveSession();
    const optimisticTurnIndex = Number(state.sessionDetail && state.sessionDetail.turn_count ? state.sessionDetail.turn_count : 0) + 1;

    // Step 4: Seed an optimistic live-turn record so the chat switches to the running turn immediately.
    if (state.sessionDetail) {
      state.sessionDetail.run_state = "running";
      state.sessionDetail.current_turn_index = optimisticTurnIndex;
      state.sessionDetail.current_step_index = 0;
      state.sessionDetail.current_prompt = prompt;
      state.sessionDetail.live_turn = {
        turn_index: optimisticTurnIndex,
        prompt,
        assistant_text: "Run in progress...",
        completion_status: "running",
        started_at: new Date().toISOString(),
        completed_at: "",
        max_steps: Number(elements.promptMaxSteps.value || state.appConfig.defaults.maxSteps),
        trajectory_html_url: "",
        trajectory_html_path: "",
        snapshot_urls: [],
        snapshot_paths: [],
        step_count: 0,
        steps: [],
        model_runtime_total_seconds: 0,
        model_inference_count: 0,
        final_page_url: "",
        final_page_title: "",
        final_error: "",
      };
      state.selectedTurnIndex = optimisticTurnIndex;
      renderWorkspace();
    }

    // Step 5: Dispatch the actual prompt to the backend and replace the optimistic turn with the canonical response.
    state.sessionDetail = await fetchJson(`${getRoutes().sessions}/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_steps: Number(elements.promptMaxSteps.value || state.appConfig.defaults.maxSteps),
      }),
    });
    elements.promptInput.value = "";
    const { turns, liveTurn } = getDisplayTurns(state.sessionDetail);
    if (liveTurn) {
      state.selectedTurnIndex = liveTurn.turn_index;
    } else if (turns.length > 0) {
      state.selectedTurnIndex = turns[turns.length - 1].turn_index;
    }
    await loadAppStatus();
    await loadModelServiceData();
    await loadSessions();
    renderWorkspace();
    if (state.sessionDetail) {
      const { turns: completedTurns } = getDisplayTurns(state.sessionDetail);
      const latestTurn = completedTurns.length > 0 ? completedTurns[completedTurns.length - 1] : null;
      if (latestTurn) {
      const completionStatus = latestTurn.completion_status || state.appConfig.completion.defaultFinished;
      showToast(`Run finished: ${formatCompletionStatus(completionStatus)}.`);
      }
    }
  } catch (error) {
    // Step 4: Surface a readable failure and refresh whichever state can still be loaded.
    const errorMessage = error.message || "The browser session failed.";
    if (errorMessage !== "This session is archived and cannot continue running browser actions") {
      showError(errorMessage);
      showToast(getAlerts().runFailure);
    }
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
  if (!state.selectedSessionId || state.closeInFlight) {
    return;
  }

  showError("");
  state.closeInFlight = true;
  setBusy(state.isBusy, state.busyButtonKey, state.busyButtonText);
  try {
    // Step 2: Ask the backend to close the live browser session while preserving artifacts.
    state.sessionDetail = await fetchJson(`${getRoutes().sessions}/${state.selectedSessionId}/close`, {
      method: "POST",
    });
    await loadAppStatus();
    await loadModelServiceData();
    await loadSessions();
    renderWorkspace();
    showToast(getAlerts().sessionClosed);
  } catch (error) {
    showError(error.message || "Could not close the session.");
  } finally {
    state.closeInFlight = false;
    setBusy(state.isBusy, state.busyButtonKey, state.busyButtonText);
  }
}

async function refreshSelectedSession() {
  // Step 1: Stop early when no session is selected.
  if (!state.selectedSessionId) {
    return;
  }

  showError("");
  setBusy(true, "refresh", "Refreshing");
  try {
    // Step 2: Reload the selected session detail and refresh the workspace.
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

async function refreshActiveWorkspace() {
  // Step 1: Avoid overlapping refresh cycles while the UI is already polling the backend.
  if (state.backgroundRefreshInFlight || !state.appConfig) {
    return;
  }

  state.backgroundRefreshInFlight = true;
  try {
    // Step 2: Refresh the shared app status, service status, and session inventory.
    await loadAppStatus();
    await loadModelServiceData();
    await loadSessions();

    // Step 3: Refresh the selected session detail while preserving the selected turn when possible.
    if (state.selectedSessionId) {
      const selectedTurnIndex = state.selectedTurnIndex;
      state.sessionDetail = await fetchJson(`${getRoutes().sessions}/${state.selectedSessionId}`);
      if (selectedTurnIndex && getTurnByIndex(state.sessionDetail, selectedTurnIndex)) {
        state.selectedTurnIndex = selectedTurnIndex;
      } else {
        const { turns, liveTurn } = getDisplayTurns(state.sessionDetail);
        if (liveTurn) {
          state.selectedTurnIndex = liveTurn.turn_index;
        } else if (turns.length > 0) {
          state.selectedTurnIndex = turns[turns.length - 1].turn_index;
        }
      }
    }

    // Step 4: Re-render the workspace with the refreshed state.
    renderWorkspace();
    renderSessionList();
  } catch (_error) {
    // Step 5: Keep background polling silent so transient failures do not interrupt active runs.
  } finally {
    state.backgroundRefreshInFlight = false;
  }
}

async function runSamplePrompt() {
  // Step 1: Populate the composer with the built-in sample prompt before dispatching it.
  applySamplePrompt();

  // Step 2: Send the sample prompt through the normal session workflow.
  await sendPrompt();
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

function getBeforeUnloadMessage() {
  // Step 1: Wait until the frontend config has loaded before attempting to show an unload prompt.
  if (!state.appConfig) {
    return "";
  }

  const hasRunningWork = (state.isBusy && state.busyButtonKey === "send")
    || Boolean(state.sessionDetail && state.sessionDetail.live && state.sessionDetail.run_state === "running")
    || state.sessions.some((session) => session.live && session.run_state === "running");

  // Step 2: Return the running or idle confirmation message requested for tab refresh and close actions.
  return hasRunningWork ? getAlerts().runningUnload : getAlerts().idleUnload;
}

async function initialize() {
  // Step 1: Attach all static interaction handlers before the first data load.
  elements.sidebarToggleButton.addEventListener("click", () => setSidebarOpen(true));
  elements.sidebarCloseButton.addEventListener("click", () => setSidebarOpen(false));
  elements.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
  elements.newChatButton.addEventListener("click", () => startFreshSession("newChat"));
  elements.newChatButtonTopbar.addEventListener("click", () => startFreshSession("newChatTopbar"));
  elements.useSamplePromptButton.addEventListener("click", applySamplePrompt);
  elements.runSamplePromptButton.addEventListener("click", runSamplePrompt);
  elements.sendPromptButton.addEventListener("click", sendPrompt);
  elements.closeSessionButton.addEventListener("click", closeSelectedSession);
  elements.stopRunButton.addEventListener("click", closeSelectedSession);
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
  window.addEventListener("beforeunload", (event) => {
    const message = getBeforeUnloadMessage();
    if (!message) {
      return;
    }
    event.preventDefault();
    event.returnValue = message;
    return message;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.galleryModal.classList.contains("hidden")) {
        closeGallery();
        return;
      }
      if (state.sidebarOpen) {
        setSidebarOpen(false);
      }
      return;
    }
    if (!elements.galleryModal.classList.contains("hidden") && event.key === "ArrowLeft") {
      moveGallery(-1);
      return;
    }
    if (!elements.galleryModal.classList.contains("hidden") && event.key === "ArrowRight") {
      moveGallery(1);
    }
  });

  // Step 2: Attach live-validation listener on the Chrome Profile Dir field so feedback
  // appears as the user types, before they click Start Fresh.
  elements.sessionChromeProfile.addEventListener("input", updateProfileHint);
  elements.sessionChromeProfile.addEventListener("blur", updateProfileHint);

  // Step 3: Load all initial backend state required to render the application.
  await loadFrontendConfig();
  await loadAppStatus();
  await loadModelServiceData();
  await loadSessions();

  // Step 4: Render the initial workspace using the loaded config and server data.
  renderWorkspace();

  // Step 5: Start background polling so running turns update live in the WebUI.
  window.setInterval(() => {
    refreshActiveWorkspace();
  }, state.appConfig.defaults.refreshIntervalMs);
}

initialize().catch((error) => {
  showError(error.message || "Could not initialize the session console.");
});
