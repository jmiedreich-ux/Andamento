const app = document.querySelector('#app');
const header = document.querySelector('#registrationHeader');
const liveRegion = document.querySelector('#liveRegion');
const assertiveRegion = document.querySelector('#assertiveRegion');

const state = {
  phase: 'loading',
  bootstrap: null,
  projects: [],
  projectId: '',
  returnProjectId: '',
  discussions: [],
  discussionListUnavailable: false,
  discussionId: '',
  detail: null,
  feedback: null,
  busy: new Set(),
  composerMode: 'owner',
  projectDraft: { name: '', repositoryRoot: '' },
  discussionDraft: { title: '' },
  composerDraft: { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' },
  composerRevision: 0,
  captureDrafts: {},
  replacementDrafts: {},
  captureMessageId: '',
  editPointId: '',
  pointFilter: 'ACTIVE',
  rightTab: 'decisions',
  packageDraft: null,
  packageBase: null,
  packageBaseRowVersion: null,
  packageDraftVersionId: '',
  packageDirty: false,
  packageConflict: null,
  packageOrphan: null,
  packageOrphanFocusPending: false,
  approvalArmedVersionId: '',
  viewedVersionId: '',
  pollTimer: null,
  pollFailureCount: 0,
  pollOutageActive: false,
  routeGeneration: 0,
  detailRequestSequence: 0,
  bootstrapRequestSequence: 0,
  bootstrapLoadGeneration: 0,
  routeNotice: '',
  mutationKeys: new Map(),
  pendingRefreshOperations: new Map(),
  pendingDraftRecoveries: new Map(),
  recoverySequence: 0,
};

class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `Request failed with status ${status}.`);
    this.status = status;
    this.code = payload?.error?.code || 'REQUEST_FAILED';
    this.details = payload?.error?.details;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function idempotencyKey(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function canonicalRequestValue(value) {
  if (Array.isArray(value)) return value.map(item => canonicalRequestValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => [key, canonicalRequestValue(value[key])]));
  }
  return value;
}

function operationKey(slot, prefix, { method = 'POST', target, payload = {} }) {
  const fingerprint = JSON.stringify(canonicalRequestValue({
    method: String(method).toUpperCase(),
    target: String(target),
    payload,
  }));
  let history = state.mutationKeys.get(slot);
  if (!history) {
    history = new Map();
    state.mutationKeys.set(slot, history);
  }
  if (!history.has(fingerprint)) history.set(fingerprint, idempotencyKey(prefix));
  return history.get(fingerprint);
}

function holdDraftRecovery(slot, recovery) {
  if (!slot || !recovery) return;
  state.pendingDraftRecoveries.set(slot, {
    ...structuredClone(recovery),
    discussionId: recovery.discussionId || '',
    sequence: ++state.recoverySequence,
  });
}

function refreshHeldDraftRecoveries() {
  for (const recovery of state.pendingDraftRecoveries.values()) {
    if (recovery.projectId !== state.projectId) continue;
    if (recovery.type === 'discussion') {
      if (state.phase === 'project') recovery.title = state.discussionDraft.title;
      continue;
    }
    if (state.phase !== 'workspace' || recovery.discussionId !== state.discussionId) continue;
    if (recovery.type === 'message') {
      recovery.mode = state.composerMode;
      recovery.draft = { ...state.composerDraft };
    } else if (recovery.type === 'capture') {
      const draft = state.captureDrafts[recovery.messageId];
      if (draft) recovery.draft = { ...draft };
    } else if (recovery.type === 'replacement') {
      const draft = state.replacementDrafts[recovery.pointId];
      if (draft) recovery.draft = { ...draft };
    } else if (recovery.type === 'package'
      && state.packageDraft
      && state.packageDraftVersionId === recovery.versionId) {
      recovery.draft = { ...state.packageDraft };
      recovery.base = { ...(state.packageBase || blankPackageDraft()) };
      recovery.baseRowVersion = state.packageBaseRowVersion;
    }
  }
}

function clearOperation(slot) {
  if (!slot) return;
  state.mutationKeys.delete(slot);
  state.pendingRefreshOperations.delete(slot);
  state.pendingDraftRecoveries.delete(slot);
}

function clearOperationsForPrefix(prefix) {
  for (const slot of state.mutationKeys.keys()) {
    if (slot.startsWith(prefix)) clearOperation(slot);
  }
}

function holdOperationUntilRefresh(slot, discussionId) {
  if (slot) state.pendingRefreshOperations.set(slot, { discussionId });
}

function releasePendingRefreshOperations(discussionId = '') {
  for (const [slot, pending] of state.pendingRefreshOperations) {
    if (!discussionId || pending.discussionId === discussionId) clearOperation(slot);
  }
}

function icon(name) {
  const attrs = 'viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const paths = {
    mark: '<circle cx="12" cy="12" r="6"></circle><path d="M12 1v5m0 12v5M1 12h5m12 0h5"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    project: '<path d="M3 6.5h7l2 2h9v10H3z"></path><path d="M3 6.5v-2h7l2 2"></path>',
    room: '<path d="M4 5h16v11H8l-4 4z"></path><path d="M8 9h8m-8 3h5"></path>',
    source: '<circle cx="7" cy="12" r="3"></circle><circle cx="17" cy="7" r="2"></circle><circle cx="17" cy="17" r="2"></circle><path d="m10 11 5-3m-5 5 5 3"></path>',
    retry: '<path d="M20 7v5h-5"></path><path d="M19 12a7 7 0 1 0-2 5"></path>',
    stop: '<rect x="6" y="6" width="12" height="12"></rect>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    clock: '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v5l3 2"></path>',
    cross: '<path d="m6 6 12 12M18 6 6 18"></path>',
    edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"></path><path d="m13.5 7 3.5 3.5"></path>',
    package: '<path d="M5 3h10l4 4v14H5z"></path><path d="M15 3v5h5M8 12h8m-8 4h8"></path>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"></path>',
    back: '<path d="M19 12H5m5-5-5 5 5 5"></path>',
  };
  return `<svg ${attrs}>${paths[name] || paths.mark}</svg>`;
}

function stateIcon(disposition) {
  const normalized = disposition || 'PROPOSED';
  const iconName = normalized === 'ACCEPTED' ? 'check'
    : normalized === 'DEFERRED' ? 'clock'
      : ['REJECTED', 'SUPERSEDED'].includes(normalized) ? 'cross' : 'mark';
  return `<span class="state-mark" data-state="${escapeHtml(normalized)}" aria-hidden="true">${icon(iconName)}</span>`;
}

function formatDate(value, { timeOnly = false } = {}) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat(undefined, timeOnly
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

let announcementSequence = 0;

function clearAnnouncements() {
  announcementSequence += 1;
  liveRegion.textContent = '';
  assertiveRegion.textContent = '';
}

function announce(message, assertive = false) {
  const sequence = ++announcementSequence;
  liveRegion.textContent = '';
  assertiveRegion.textContent = '';
  requestAnimationFrame(() => {
    if (sequence !== announcementSequence) return;
    (assertive ? assertiveRegion : liveRegion).textContent = message;
  });
}

async function api(path, options = {}) {
  const { timeoutMs = 6_000, signal: externalSignal, ...fetchOptions } = options;
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const controller = new AbortController();
  let timedOut = false;
  const relayExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) relayExternalAbort();
  else externalSignal?.addEventListener('abort', relayExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(path, { ...fetchOptions, headers, body, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`The local service did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
      timeoutError.code = 'REQUEST_UNCONFIRMED';
      throw timeoutError;
    }
    if (error instanceof ApiError || externalSignal?.aborted) throw error;
    const transportError = new Error(error?.message || 'The local service response could not be confirmed.');
    transportError.code = 'REQUEST_UNCONFIRMED';
    throw transportError;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', relayExternalAbort);
  }
}

function setBusy(key, value) {
  if (value) state.busy.add(key);
  else state.busy.delete(key);
}

function isBusy(key) {
  return state.busy.has(key);
}

function setFeedback(message, tone = 'error', details = undefined, source = 'action') {
  state.feedback = { message, tone, details, source };
  announce(message, tone === 'error');
}

function clearFeedback() {
  if (state.feedback?.tone === 'error') clearAnnouncements();
  state.feedback = null;
}

function clearPollOutage({ announceRecovery = false } = {}) {
  const wasActive = state.pollOutageActive;
  const reconciledUnconfirmedMutation = state.feedback?.source === 'unconfirmed-mutation';
  state.pollFailureCount = 0;
  state.pollOutageActive = false;
  releasePendingRefreshOperations(state.discussionId);
  if (['poll', 'refresh', 'unconfirmed-mutation'].includes(state.feedback?.source)) clearFeedback();
  if (wasActive && announceRecovery) announce('Local service connection restored.');
  else if (reconciledUnconfirmedMutation) announce('Latest saved state reconciled.');
}

function feedbackMarkup(feedback = state.feedback) {
  if (!feedback) return '';
  const gaps = Array.isArray(feedback.details?.gaps)
    ? `<span>Missing: ${feedback.details.gaps.map(escapeHtml).join(', ')}.</span>` : '';
  const recovery = feedback.details?.current
    ? '<button type="button" data-action="refresh-after-conflict">Refresh saved state</button>'
    : feedback.source === 'unconfirmed-mutation'
      ? '<button type="button" data-action="reconcile-unconfirmed">Reconcile saved state</button>' : '';
  return `<div class="feedback" data-tone="${escapeHtml(feedback.tone)}" role="${feedback.tone === 'error' ? 'alert' : 'status'}"><strong>${escapeHtml(feedback.message)}</strong>${gaps}${recovery}</div>`;
}

function registrationMark() {
  return `<span class="registration-mark">${icon('mark')}</span>`;
}

function renderHeader() {
  const project = state.projects.find(item => item.id === state.projectId);
  const discussion = state.detail?.discussion;
  const projectRegisterUnknown = state.phase === 'bootstrap-error' && !state.bootstrap;
  const projectOptions = state.projects.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === state.projectId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  const roomValue = discussion && project
    ? `<a class="header-value" href="#/projects/${escapeHtml(project.id)}" aria-label="Return to ${escapeHtml(project.name)} room list">${escapeHtml(discussion.title)}</a>`
    : `<span class="header-value">${escapeHtml(project ? 'Project register' : projectRegisterUnknown ? 'Register unavailable' : 'First registration')}</span>`;
  const localState = state.busy.size ? 'Saving locally…'
    : state.packageDirty ? 'Package edits unsaved'
      : state.feedback?.tone === 'error' ? 'Action needs attention' : 'Local service ready';
  const projectRegistrationUnavailable = ['loading', 'bootstrap-error'].includes(state.phase);
  header.innerHTML = `
    <a class="brand" href="${project ? `#/projects/${escapeHtml(project.id)}` : '#/'}" aria-label="Andamento home">${registrationMark()}<span>Andamento</span></a>
    <div class="header-cell project-cell">
      <span class="header-label">Project</span>
      ${state.projects.length
        ? `<select class="header-project-select" id="headerProject" aria-label="Current project"><option value="">Select project</option>${projectOptions}</select>`
        : `<span class="header-value">${projectRegisterUnknown ? 'Project status unknown' : 'No project registered'}</span>`}
    </div>
    <div class="header-cell room-cell">
      <span class="header-label">Room</span>
      ${roomValue}
    </div>
    <div class="header-actions">
      <span class="local-status">${escapeHtml(localState)}</span>
      <button type="button" class="icon-button" data-action="new-project" aria-label="Register another project" title="${projectRegistrationUnavailable ? 'Wait for the local project register' : 'Register another project'}" ${projectRegistrationUnavailable ? 'disabled' : ''}>${icon('plus')}</button>
    </div>
  `;
}

function renderLoading() {
  app.innerHTML = `
    <div class="loading-surface" aria-label="Loading Andamento">
      <section class="skeleton-block"><div class="skeleton-line"></div><div class="skeleton-line"></div></section>
      <section class="skeleton-block"><div class="skeleton-line"></div></section>
      <section class="skeleton-block"><div class="skeleton-line"></div><div class="skeleton-line"></div></section>
    </div>`;
}

function renderBootstrapError() {
  app.innerHTML = `
    <section class="onboarding" aria-labelledby="bootstrapErrorTitle">
      ${registrationMark()}
      <h1 id="bootstrapErrorTitle">Local service unavailable</h1>
      <p class="onboarding-intro">Andamento could not load the local project register. Existing planning data may still be present, so project registration is paused until the service responds.</p>
      ${feedbackMarkup()}
      <button type="button" class="primary-action" data-action="retry-bootstrap">Try local service again</button>
      <p class="lineage-footnote">No project, discussion, or package state was changed.</p>
    </section>`;
}

function renderNewProject() {
  const firstRun = state.projects.length === 0;
  const projectBusy = isBusy('project');
  app.innerHTML = `
    <section class="onboarding" aria-labelledby="registrationTitle">
      ${registrationMark()}
      <h1 id="registrationTitle">${firstRun ? 'Start with the work' : 'Register another project'}</h1>
      <p class="onboarding-intro">Andamento keeps planning discussion, owner decisions, and approved work packages together on this machine. Register one local Git repository; nothing is pushed or executed by this step.</p>
      ${feedbackMarkup()}
      <form class="registration-line" data-form="project" novalidate>
        <div class="field">
          <label for="projectName">Project name</label>
          <input id="projectName" name="name" type="text" required maxlength="80" autocomplete="off" value="${escapeHtml(state.projectDraft.name)}" placeholder="My product" ${projectBusy ? 'disabled' : ''}>
        </div>
        <div class="field">
          <label for="repositoryRoot">Local Git repository</label>
          <input id="repositoryRoot" name="repositoryRoot" type="text" required maxlength="1000" autocomplete="off" value="${escapeHtml(state.projectDraft.repositoryRoot)}" placeholder="C:\\development\\project" ${projectBusy ? 'disabled' : ''}>
          <p class="field-help">The service validates the directory and records it as this project's allowed root.</p>
        </div>
        <button class="primary-action" type="submit" ${projectBusy ? 'disabled' : ''}>${projectBusy ? 'Registering…' : 'Register project'}</button>
      </form>
      ${firstRun ? '<p class="lineage-footnote">Local service · SQLite WAL · no provider connection required</p>' : `<button type="button" class="text-action" data-action="cancel-new-project" ${projectBusy ? 'disabled' : ''}>Return to current project</button>`}
    </section>`;
}

function renderProjectRegister() {
  const project = state.projects.find(item => item.id === state.projectId);
  if (!project) return renderNewProject();
  const discussionBusy = isBusy('discussion');
  const roomRows = state.discussionListUnavailable
    ? `<li class="empty-trace"><h2>Planning room list unavailable</h2><p>Andamento could not confirm whether rooms already exist. Room creation is paused to prevent duplicates.</p><button type="button" data-action="retry-room-list">Try room list again</button></li>`
    : state.discussions.length
    ? state.discussions.map((room, index) => `
        <li class="room-row">
          <span class="room-index">ROOM ${String(index + 1).padStart(2, '0')}</span>
          <span class="room-title"><a href="#/projects/${escapeHtml(project.id)}/discussions/${escapeHtml(room.id)}">${escapeHtml(room.title)}</a></span>
          <span class="room-time">${escapeHtml(formatDate(room.updatedAt))}</span>
          <a class="button-link" href="#/projects/${escapeHtml(project.id)}/discussions/${escapeHtml(room.id)}">Open room</a>
        </li>`).join('')
    : `<li class="empty-trace"><h2>No planning room yet</h2><p>Open one room for a concrete question or capability. Discussion remains context until you decide its planning points.</p></li>`;
  app.innerHTML = `
    <section class="project-register" aria-labelledby="projectTitle">
      <div class="project-head">
        <div>
          <span class="station-label">Local project register</span>
          <h1 id="projectTitle">${escapeHtml(project.name)}</h1>
          <p title="${escapeHtml(project.repositoryRoot)}">${escapeHtml(project.repositoryRoot)}</p>
        </div>
        ${registrationMark()}
      </div>
      ${feedbackMarkup()}
      <ul class="room-register" aria-label="Planning rooms">${roomRows}</ul>
      <form class="new-room-form" data-form="discussion" novalidate>
        <div class="field">
          <label for="roomTitle">New planning room</label>
          <input id="roomTitle" name="title" type="text" required maxlength="120" autocomplete="off" value="${escapeHtml(state.discussionDraft.title)}" placeholder="Plan a durable capability" ${discussionBusy || state.discussionListUnavailable ? 'disabled' : ''}>
        </div>
        <button class="primary-action" type="submit" ${discussionBusy || state.discussionListUnavailable ? 'disabled' : ''}>${discussionBusy ? 'Opening…' : 'Open room'}</button>
      </form>
    </section>`;
}

function messageMarkup(message) {
  const isCapture = state.captureMessageId === message.id;
  const captureBusy = isBusy(`capture:${message.id}`);
  const provider = message.participant.provider ? `${message.participant.provider}${message.participant.model ? ` · ${message.participant.model}` : ''}` : 'Local owner';
  return `
    <li>
      <article class="message-trace" id="message-${escapeHtml(message.id)}" data-kind="${escapeHtml(message.contributionType)}" aria-labelledby="message-${escapeHtml(message.id)}-actor" tabindex="-1">
        <div class="message-byline">
          <span class="actor-mark" aria-hidden="true"></span>
          <strong id="message-${escapeHtml(message.id)}-actor">${escapeHtml(message.participant.displayName)}</strong>
          <span>${escapeHtml(provider)}</span>
          <time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(formatDate(message.createdAt, { timeOnly: true }))}</time>
        </div>
        <div class="message-body">
          <div class="message-role">${escapeHtml(message.contributionType === 'OWNER' ? 'Owner context' : message.contributionType === 'IMPORTED' ? 'Imported contribution' : 'Agent contribution')}</div>
          <p class="message-content">${escapeHtml(message.content)}</p>
        </div>
        <div class="message-actions">
          <button type="button" data-action="toggle-capture" data-message-id="${escapeHtml(message.id)}" aria-label="Capture point" aria-expanded="${isCapture}" aria-controls="capture-${escapeHtml(message.id)}" ${captureBusy ? 'disabled' : ''}>
            <span class="button-icon">${icon('source')}</span><span class="button-label"> Capture point</span>
          </button>
        </div>
        ${isCapture ? captureFormMarkup(message) : ''}
      </article>
    </li>`;
}

function captureDraft(message) {
  return state.captureDrafts[message.id] || { pointType: 'REQUIREMENT', text: message.content.slice(0, 800) };
}

function captureFormMarkup(message) {
  const draft = captureDraft(message);
  const captureBusy = isBusy(`capture:${message.id}`);
  return `
    <form class="capture-form" id="capture-${escapeHtml(message.id)}" data-form="capture-point" data-message-id="${escapeHtml(message.id)}">
      <div class="field">
        <label for="pointType-${escapeHtml(message.id)}">Point type</label>
        <select id="pointType-${escapeHtml(message.id)}" name="pointType" ${captureBusy ? 'disabled' : ''}>${pointTypeOptions(draft.pointType)}</select>
      </div>
      <div class="field">
        <label for="pointText-${escapeHtml(message.id)}">Proposed planning point</label>
        <textarea id="pointText-${escapeHtml(message.id)}" name="text" required maxlength="2000" ${captureBusy ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="text-action" data-action="close-capture" ${captureBusy ? 'disabled' : ''}>Cancel</button>
        <button type="submit" class="primary-action" ${captureBusy ? 'disabled' : ''}>${captureBusy ? 'Adding…' : 'Add proposal'}</button>
      </div>
    </form>`;
}

function runMarkup(run) {
  if (run.status === 'COMPLETED') return '';
  const promptPreserved = ['FAILED', 'INTERRUPTED'].includes(run.status);
  const cleanupPending = run.errorCode === 'CODEX_CLEANUP_PENDING';
  const cleanupUnconfirmed = run.errorCode === 'CODEX_CLEANUP_UNCONFIRMED';
  const cleanupBlocked = cleanupPending || cleanupUnconfirmed;
  const canRetry = promptPreserved && !cleanupBlocked;
  const runBusy = isBusy(`run:${run.id}`);
  return `
    <li>
      <article class="run-trace" data-status="${escapeHtml(run.status)}">
        <div class="message-byline">
          <span class="run-status-mark" aria-hidden="true"></span>
          <strong>${escapeHtml(run.participant?.displayName || run.adapter)}</strong>
          <span>${escapeHtml(run.provider)} · ${escapeHtml(run.model)}</span>
        </div>
        <div class="message-body">
          <div class="message-role">${run.status === 'RUNNING' ? 'Contribution in progress' : 'Contribution needs attention'}</div>
          <p class="message-content">${escapeHtml(run.status === 'RUNNING' ? run.prompt : run.errorMessage)}</p>
          ${promptPreserved ? `<p class="source-summary">Prompt preserved: ${escapeHtml(run.prompt)}</p>` : ''}
          ${cleanupPending ? '<p class="source-summary" role="status">Retry is blocked while Andamento confirms that the Codex turn stopped. Owner notes, imported input, and other available participants remain usable.</p>' : ''}
          ${cleanupUnconfirmed ? '<p class="source-summary" role="status">Retry is blocked until Codex cleanup can be confirmed. Owner notes, imported input, and other available participants remain usable.</p>' : ''}
        </div>
        <div class="message-actions">
          ${run.status === 'RUNNING'
            ? `<button type="button" data-action="cancel-run" data-run-id="${escapeHtml(run.id)}" ${runBusy ? 'disabled' : ''}>${icon('stop')}<span class="visually-hidden">${runBusy ? 'Cancelling contribution' : 'Cancel contribution'}</span></button>`
            : canRetry ? `<button type="button" data-action="retry-run" data-run-id="${escapeHtml(run.id)}" aria-label="${runBusy ? 'Retrying' : 'Retry'}" ${runBusy ? 'disabled' : ''}>${icon('retry')}<span class="button-label"> ${runBusy ? 'Retrying…' : 'Retry'}</span></button>` : ''}
        </div>
      </article>
    </li>`;
}

function composerMarkup() {
  const capabilities = state.bootstrap.capabilities;
  const codexAvailability = state.detail?.agentAvailability?.codex || { blocked: false, reason: '' };
  const codexBlocked = Boolean(codexAvailability.blocked);
  const codexDisabled = !capabilities.codex.available || codexBlocked;
  const codexDisabledReason = codexBlocked ? codexAvailability.reason : capabilities.codex.reason;
  const modes = [
    { id: 'owner', label: 'Owner note', disabled: false },
    { id: 'codex', label: 'Ask Codex', disabled: codexDisabled, reason: codexDisabledReason },
    { id: 'imported', label: 'Import agent input', disabled: false },
    ...(capabilities.deterministic.available ? [{ id: 'deterministic', label: 'Test participant', disabled: false }] : []),
  ];
  const modeButtons = modes.map(mode => `<button type="button" data-action="composer-mode" data-mode="${mode.id}" aria-pressed="${state.composerMode === mode.id}" ${mode.disabled ? 'disabled' : ''} title="${escapeHtml(mode.reason || mode.label)}">${escapeHtml(mode.label)}</button>`).join('');
  const imported = state.composerMode === 'imported' ? `
    <div class="import-fields">
      <div class="field"><label for="importName">Contributor</label><input id="importName" name="displayName" type="text" required maxlength="80" value="${escapeHtml(state.composerDraft.displayName)}" placeholder="Claude"></div>
      <div class="field"><label for="importProvider">Provider</label><input id="importProvider" name="provider" type="text" required maxlength="80" value="${escapeHtml(state.composerDraft.provider)}"></div>
      <div class="field"><label for="importModel">Model</label><input id="importModel" name="model" type="text" maxlength="120" value="${escapeHtml(state.composerDraft.model)}" placeholder="Optional"></div>
    </div>` : '';
  const label = state.composerMode === 'owner' ? 'Add owner context'
    : state.composerMode === 'imported' ? 'Paste the attributed contribution'
      : 'Ask for a planning contribution';
  const guidance = state.composerMode === 'owner' ? 'Owner notes remain context until you decide a planning point.'
    : state.composerMode === 'imported' ? 'Paste only content you are allowed to store locally.'
      : 'The participant can recommend and challenge; it cannot approve.';
  const capabilityNote = codexBlocked
    ? `<div class="capability-note" id="codexCapabilityNote" role="status"><span>Codex is blocked in this room: ${escapeHtml(codexAvailability.reason)} Owner notes, imported input, and other available participants remain usable.</span></div>`
    : !capabilities.codex.available
      ? `<div class="capability-note" id="codexCapabilityNote" role="status"><span>Codex is unavailable: ${escapeHtml(capabilities.codex.reason)} Import attributed input to keep planning.</span><button type="button" data-action="refresh-capabilities" ${isBusy('capabilities') ? 'disabled' : ''}>${isBusy('capabilities') ? 'Checking…' : 'Check bridge again'}</button></div>` : '';
  const codexSubmissionBlocked = state.composerMode === 'codex' && codexBlocked;
  const messageBusy = isBusy('message');
  return `
    <section class="composer" aria-labelledby="composerTitle">
      <h2 id="composerTitle" class="visually-hidden">Add to discussion</h2>
      <div class="composer-modes" aria-label="Contribution type">${modeButtons}</div>
      ${capabilityNote}
      <form class="composer-form" data-form="message" novalidate>
        ${imported}
        <div class="field">
          <label for="messageText">${escapeHtml(label)}</label>
          <textarea id="messageText" name="content" required maxlength="20000" placeholder="Share a question, proposal, concern, or constraint…">${escapeHtml(state.composerDraft.content)}</textarea>
        </div>
        <div class="composer-footer">
          <p class="composer-guidance">${escapeHtml(guidance)}</p>
          <div class="form-actions">
            <button type="button" class="text-action" data-action="clear-composer" ${messageBusy ? 'disabled' : ''}>Cancel</button>
            <button type="submit" class="primary-action" ${messageBusy || codexSubmissionBlocked ? 'disabled' : ''} ${codexSubmissionBlocked ? 'aria-describedby="codexCapabilityNote"' : ''}>${messageBusy ? 'Adding…' : codexSubmissionBlocked ? 'Codex blocked' : state.composerMode === 'owner' || state.composerMode === 'imported' ? 'Add to discussion' : 'Request contribution'}</button>
          </div>
        </div>
      </form>
    </section>`;
}

function decisionMarkup(point, index) {
  const editing = state.editPointId === point.id;
  const proposed = point.disposition === 'PROPOSED';
  const editDraft = state.replacementDrafts[point.id] || { pointType: point.pointType, text: point.text };
  const replacementBusy = isBusy(`replace:${point.id}`);
  const decisionBusy = isBusy(`point:${point.id}`);
  const pointBusy = replacementBusy || decisionBusy;
  return `
    <li class="decision-row" id="point-${escapeHtml(point.id)}" data-state="${escapeHtml(point.disposition)}" tabindex="-1">
      ${stateIcon(point.disposition)}
      <div class="decision-copy">
        <div class="decision-state"><span>${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(point.pointType.replaceAll('_', ' '))}</span><span>${escapeHtml(point.disposition)}</span></div>
        <div class="decision-text">${escapeHtml(point.text)}</div>
        <div class="source-summary">From ${escapeHtml(point.source?.displayName || 'source')} · “${escapeHtml(point.source?.excerpt || '')}”</div>
      </div>
      ${proposed ? `<div class="decision-actions">
        <div class="disposition-actions" role="group" aria-label="Decide this planning point">
          <button type="button" data-action="disposition" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}" data-disposition="ACCEPTED" ${pointBusy ? 'disabled' : ''}>Accept</button>
          <button type="button" data-action="disposition" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}" data-disposition="DEFERRED" ${pointBusy ? 'disabled' : ''}>Defer</button>
          <button type="button" data-action="disposition" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}" data-disposition="REJECTED" ${pointBusy ? 'disabled' : ''}>Reject</button>
        </div>
        ${decisionBusy ? '<span class="source-summary" role="status">Recording owner decision…</span>' : ''}
        <button type="button" class="point-edit-action" data-action="edit-point" data-point-id="${escapeHtml(point.id)}" ${pointBusy ? 'disabled' : ''}>Edit proposal</button>
      </div>` : ''}
      ${editing ? `
        <form class="point-edit-form" data-form="replace-point" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}">
          <div class="field"><label for="editType-${escapeHtml(point.id)}">Point type</label><select id="editType-${escapeHtml(point.id)}" name="pointType" ${pointBusy ? 'disabled' : ''}>${pointTypeOptions(editDraft.pointType)}</select></div>
          <div class="field"><label for="editText-${escapeHtml(point.id)}">Replacement proposal</label><textarea id="editText-${escapeHtml(point.id)}" name="text" maxlength="2000" required ${pointBusy ? 'disabled' : ''}>${escapeHtml(editDraft.text)}</textarea></div>
          <div class="form-actions"><button type="button" class="text-action" data-action="cancel-edit-point" ${pointBusy ? 'disabled' : ''}>Cancel</button><button class="primary-action" type="submit" ${pointBusy ? 'disabled' : ''}>${replacementBusy ? 'Creating…' : decisionBusy ? 'Decision pending…' : 'Create replacement'}</button></div>
        </form>` : ''}
    </li>`;
}

function pointTypeOptions(selected) {
  const values = ['REQUIREMENT', 'DECISION', 'RISK', 'CONSTRAINT', 'QUESTION', 'DEPENDENCY', 'ASSUMPTION', 'PROPOSED_WORK', 'PARKING_LOT'];
  return values.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(value.replaceAll('_', ' '))}</option>`).join('');
}

function decisionStationMarkup() {
  const visible = state.detail.points.filter(point => {
    if (state.pointFilter === 'ALL') return true;
    if (state.pointFilter === 'ACTIVE') return point.disposition !== 'SUPERSEDED';
    return point.disposition === state.pointFilter;
  });
  const rows = visible.length
    ? visible.map(decisionMarkup).join('')
    : `<li class="decision-empty"><h3>No ${state.pointFilter === 'ACTIVE' ? '' : escapeHtml(state.pointFilter.toLowerCase()) + ' '}planning points</h3><p>Capture a specific requirement, decision, risk, or question from an attributed contribution.</p></li>`;
  return `
    <section class="decision-station" id="decisionStation" role="tabpanel" aria-labelledby="decisionTab decisionTitle">
      <div class="station-head">
        <div class="station-title"><h2 id="decisionTitle">Owner decision ledger</h2><span class="station-meta">${state.detail.points.filter(p => p.disposition !== 'SUPERSEDED').length} points</span></div>
        <div class="decision-toolbar">
          <label class="visually-hidden" for="pointFilter">Filter points</label>
          <select id="pointFilter">
            ${['ACTIVE', 'PROPOSED', 'ACCEPTED', 'DEFERRED', 'REJECTED', 'ALL'].map(value => `<option value="${value}" ${state.pointFilter === value ? 'selected' : ''}>${value.charAt(0) + value.slice(1).toLowerCase()}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="decision-scroll"><ul class="decision-list">${rows}</ul></div>
    </section>`;
}

function blankPackageDraft() {
  return { outcome: '', includedScope: '', exclusions: '', acceptanceCriteria: '', reviewRequirements: '', evidenceRequirements: '' };
}

function draftFromPackageContent(content = {}) {
  return {
    outcome: content.outcome || '',
    includedScope: (content.includedScope || []).join('\n'),
    exclusions: (content.exclusions || []).join('\n'),
    acceptanceCriteria: (content.acceptanceCriteria || []).join('\n'),
    reviewRequirements: (content.reviewRequirements || []).join('\n'),
    evidenceRequirements: (content.evidenceRequirements || []).join('\n'),
  };
}

function normalizedPackageDraft(draft) {
  return draftFromPackageContent(contentFromPackageDraft(draft));
}

function packageDraftsEqual(left, right) {
  return Object.keys(blankPackageDraft()).every(name => left[name] === right[name]);
}

function applyPackageVersionToDetail(version) {
  const workPackage = state.detail?.workPackage;
  if (!workPackage || !version) return;
  workPackage.currentVersion = version;
  workPackage.versions = workPackage.versions.map(item => item.id === version.id ? version : item);
}

function clearActivePackageDraft() {
  state.packageDraft = null;
  state.packageBase = null;
  state.packageBaseRowVersion = null;
  state.packageDraftVersionId = '';
  state.packageDirty = false;
  state.packageConflict = null;
  disarmApproval();
}

function preserveOrphanedPackageDraft(current) {
  const unresolvedFields = state.packageConflict?.fieldConflicts || {};
  if ((!state.packageDirty && !Object.keys(unresolvedFields).length) || !state.packageDraft || !state.packageDraftVersionId || state.packageOrphan) return;
  const sourceVersion = state.detail?.workPackage?.versions
    .find(version => version.id === state.packageDraftVersionId);
  const priorBase = state.packageBase || blankPackageDraft();
  const localDraft = { ...state.packageDraft };
  for (const [name, values] of Object.entries(unresolvedFields)) localDraft[name] = values.local;
  const normalizedLocal = normalizedPackageDraft(localDraft);
  const normalizedPriorBase = normalizedPackageDraft(priorBase);
  const sourceDraft = sourceVersion
    ? draftFromPackageContent(sourceVersion.content)
    : normalizedPriorBase;
  const heldDraft = { ...sourceDraft };
  for (const name of Object.keys(heldDraft)) {
    if (normalizedLocal[name] !== normalizedPriorBase[name] || Object.hasOwn(unresolvedFields, name)) {
      heldDraft[name] = localDraft[name];
    }
  }
  if (packageDraftsEqual(normalizedPackageDraft(heldDraft), normalizedPackageDraft(sourceDraft))) return;
  state.packageOrphan = {
    draft: heldDraft,
    base: sourceDraft,
    sourceVersionId: state.packageDraftVersionId,
    sourceVersionNumber: sourceVersion?.versionNumber || '',
  };
  state.packageOrphanFocusPending = true;
  if (current?.id) state.viewedVersionId = current.id;
}

function syncPackageDraft() {
  const current = state.detail?.workPackage?.currentVersion;
  const activeDraftStillCurrent = Boolean(
    current
    && current.status === 'DRAFT'
    && state.packageDraftVersionId === current.id,
  );
  if (!activeDraftStillCurrent) preserveOrphanedPackageDraft(current);
  if (!current || current.status !== 'DRAFT') {
    clearActivePackageDraft();
    return;
  }
  if (state.packageDraftVersionId === current.id && state.packageDraft) {
    if (state.packageBaseRowVersion === current.rowVersion) return;
    disarmApproval();
    const savedDraft = draftFromPackageContent(current.content);
    if (
      state.packageDirty
      && !hasUnresolvedPackageFields()
      && packageDraftsEqual(normalizedPackageDraft(state.packageDraft), normalizedPackageDraft(savedDraft))
    ) {
      state.packageDraft = savedDraft;
      state.packageBase = { ...savedDraft };
      state.packageBaseRowVersion = current.rowVersion;
      state.packageDirty = false;
      state.packageConflict = null;
      clearOperation(`package-save:${current.id}`);
      setFeedback(
        `Your package edits are already saved in the current draft of v${current.versionNumber}. Nothing further to submit.`,
        'success',
        undefined,
        'recovery',
      );
      renderHeader();
      return;
    }
    if (state.packageDirty) {
      state.packageConflict = {
        message: 'This package changed in another view while you were editing.',
        current,
      };
      return;
    }
    state.packageDraft = draftFromPackageContent(current.content);
    state.packageBase = { ...state.packageDraft };
    state.packageBaseRowVersion = current.rowVersion;
    state.packageConflict = null;
    return;
  }
  disarmApproval();
  state.packageDraftVersionId = current.id;
  state.packageDraft = draftFromPackageContent(current.content);
  state.packageBase = { ...state.packageDraft };
  state.packageBaseRowVersion = current.rowVersion;
  state.packageDirty = false;
  state.packageConflict = null;
}

function rebasePackageChanges(localDraft, priorBase, current) {
  const latestBase = draftFromPackageContent(current.content);
  const mergedDraft = { ...latestBase };
  const fieldConflicts = {};
  for (const name of Object.keys(latestBase)) {
    const localChanged = localDraft[name] !== priorBase[name];
    const latestChanged = latestBase[name] !== priorBase[name];
    if (localChanged && latestChanged && localDraft[name] !== latestBase[name]) {
      fieldConflicts[name] = { local: localDraft[name], latest: latestBase[name] };
      mergedDraft[name] = localDraft[name];
    } else if (localChanged) mergedDraft[name] = localDraft[name];
  }
  return { latestBase, mergedDraft, fieldConflicts };
}

function installRebasedPackageDraft({ localDraft, priorBase, current, carried = false }) {
  const { latestBase, mergedDraft, fieldConflicts } = rebasePackageChanges(localDraft, priorBase, current);
  applyPackageVersionToDetail(current);
  state.packageDraftVersionId = current.id;
  state.packageBase = latestBase;
  state.packageBaseRowVersion = current.rowVersion;
  state.packageDraft = mergedDraft;
  state.packageDirty = Object.keys(mergedDraft).some(name => mergedDraft[name] !== latestBase[name]);
  disarmApproval();
  state.packageConflict = {
    current,
    rebased: true,
    fieldConflicts,
    message: Object.keys(fieldConflicts).length
      ? 'Some fields changed in both views. Choose each value before saving.'
      : carried
        ? 'Your held edits are applied to the current draft for review.'
        : 'Your non-overlapping changes are reapplied to the latest saved version.',
  };
}

function packageField(label, name, help = '') {
  const value = state.packageDraft?.[name] || '';
  const maxLength = {
    outcome: 4000,
    includedScope: 200099,
    exclusions: 120099,
    acceptanceCriteria: 120099,
    reviewRequirements: 60049,
    evidenceRequirements: 60049,
  }[name];
  const locked = isBusy('package-save')
    || isBusy('package-approve')
    || Boolean(state.packageOrphan)
    || Boolean(state.packageConflict?.fieldConflicts?.[name]);
  return `
    <div class="package-field" data-field="${escapeHtml(name)}">
      <label class="field-label" for="package-${escapeHtml(name)}">${escapeHtml(label)}</label>
      <textarea id="package-${escapeHtml(name)}" name="${escapeHtml(name)}" maxlength="${maxLength}" placeholder="${name === 'exclusions' ? 'State an explicit exclusion, or write None for this package.' : ''}" ${locked ? 'disabled' : ''}>${escapeHtml(value)}</textarea>
      ${help ? `<p class="field-help">${escapeHtml(help)}</p>` : ''}
    </div>`;
}

function packageOrphanMarkup(current) {
  const orphan = state.packageOrphan;
  if (!orphan || !current) return '';
  const changedFields = Object.keys(orphan.draft)
    .filter(name => orphan.draft[name] !== orphan.base[name])
    .map(packageFieldLabel);
  const actionLabel = current.status === 'DRAFT'
    ? `Compare and carry edits into v${current.versionNumber}`
    : `Create v${current.versionNumber + 1} and carry edits`;
  const carrying = isBusy('carry-package');
  const recoveryLocked = carrying || isPackageMutationBusy();
  return `
    <div class="feedback package-orphan" data-tone="warning" role="alert">
      <strong>Your unsaved edits were not part of approved v${escapeHtml(orphan.sourceVersionNumber || current.versionNumber)}.</strong>
      <span>They remain held in this browser and have not changed any approved version.</span>
      ${changedFields.length ? `<span>Held fields: ${changedFields.map(escapeHtml).join(', ')}.</span>` : ''}
      <div class="feedback-actions">
        <button type="button" data-action="carry-orphan-package" ${recoveryLocked ? 'disabled' : ''}>${carrying ? 'Preparing recovery…' : escapeHtml(actionLabel)}</button>
        <button type="button" data-action="discard-orphan-package" ${recoveryLocked ? 'disabled' : ''}>Discard held edits</button>
      </div>
    </div>`;
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function packageReadOnlyField(label, value, isList = true) {
  const content = isList
    ? (value?.length ? `<ul class="package-list">${value.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>None recorded.</p>')
    : `<p>${escapeHtml(value || 'None recorded.')}</p>`;
  return `<section class="package-field"><h3 class="field-label">${escapeHtml(label)}</h3>${content}</section>`;
}

function packageFieldLabel(name) {
  return ({
    outcome: 'Outcome',
    includedScope: 'Included scope',
    exclusions: 'Exclusions',
    acceptanceCriteria: 'Acceptance criteria',
    reviewRequirements: 'Review requirements',
    evidenceRequirements: 'Evidence requirements',
  })[name] || name;
}

function hasUnresolvedPackageFields() {
  return Boolean(Object.keys(state.packageConflict?.fieldConflicts || {}).length);
}

function isPackageMutationBusy() {
  return ['package-save', 'package-approve', 'carry-package', 'next-version'].some(isBusy);
}

function disarmApproval() {
  state.approvalArmedVersionId = '';
}

function packageCompleteness(draft = {}) {
  const completeFields = [
    String(draft.outcome || '').trim(),
    ...['includedScope', 'exclusions', 'acceptanceCriteria', 'reviewRequirements', 'evidenceRequirements']
      .map(name => lines(draft[name]).length ? name : ''),
  ].filter(Boolean).length;
  return { completeFields, totalFields: 6 };
}

function executionStatusLabel(run) {
  return {
    RUNNING: 'Reading the repository…',
    SUCCEEDED: `${run.changeSet?.fileCount || 0} file${run.changeSet?.fileCount === 1 ? '' : 's'} proposed`,
    FAILED: 'Execution failed',
    CANCELLED: 'Execution cancelled',
    INTERRUPTED: 'Execution interrupted',
  }[run.status] || run.status;
}

function changeSetMarkup(run) {
  if (run.status !== 'SUCCEEDED' || !run.changeSet) return '';
  if (!run.changeSet.fileCount) {
    return '<p class="execution-empty">The participant proposed no change for this package.</p>';
  }
  return `
    <details class="execution-diff">
      <summary>Read the proposed change set</summary>
      <pre class="diff-view" tabindex="0" aria-label="Proposed change set">${escapeHtml(run.changeSet.diff)}</pre>
      <p class="lineage-footnote">Nothing was written. This change set is a proposal recorded against v${run.versionNumber || ''} · sha256 ${escapeHtml(run.changeSet.diffSha256.slice(0, 12))}…</p>
    </details>`;
}

function executionMarkup(selected) {
  const executions = (state.detail.workPackage?.executions || [])
    .filter(run => run.workPackageVersionId === selected.id);
  const dispatchBusy = isBusy('dispatch-execution');
  const running = executions.find(run => run.status === 'RUNNING');
  const availability = state.detail.agentAvailability?.codex || { blocked: false };
  const codexReady = state.bootstrap.capabilities.codex.available && !availability.blocked;
  const adapters = [
    ...(codexReady ? [{ id: 'codex', label: 'Dispatch to Codex' }] : []),
    ...(state.bootstrap.capabilities.deterministic.available
      ? [{ id: 'deterministic', label: 'Dispatch to test participant' }] : []),
  ];
  const actions = adapters.length
    ? adapters.map(adapter => `
        <button type="button" class="primary-action" data-action="dispatch-execution"
          data-version-id="${escapeHtml(selected.id)}" data-adapter="${escapeHtml(adapter.id)}"
          ${dispatchBusy || running ? 'disabled' : ''}>${icon('arrow')} ${escapeHtml(dispatchBusy ? 'Dispatching…' : adapter.label)}</button>`).join('')
    : '<p class="execution-empty">No execution participant is available. Start the local Codex bridge to dispatch this package.</p>';
  const rows = executions.map(run => `
    <li class="execution-run" data-status="${escapeHtml(run.status)}">
      <div class="execution-line">
        <span class="execution-actor">${escapeHtml(run.displayName)}</span>
        <span class="execution-state">${escapeHtml(executionStatusLabel(run))}</span>
        <time datetime="${escapeHtml(run.startedAt)}">${escapeHtml(formatDate(run.startedAt, { timeOnly: true }))}</time>
        ${run.status === 'RUNNING'
          ? `<button type="button" class="text-action" data-action="cancel-execution" data-run-id="${escapeHtml(run.id)}" ${isBusy(`execution:${run.id}`) ? 'disabled' : ''}>Cancel</button>` : ''}
      </div>
      ${run.errorMessage ? `<p class="execution-error" role="status">${escapeHtml(run.errorMessage)}</p>` : ''}
      ${changeSetMarkup({ ...run, versionNumber: selected.versionNumber })}
    </li>`).join('');
  return `
    <section class="execution-station" aria-labelledby="executionTitle">
      <span class="station-label">Execution</span>
      <h4 id="executionTitle">Proposed change set</h4>
      <p class="execution-guidance">Dispatch reads this repository and returns a change set for you to read. Nothing is written to your files.</p>
      <div class="execution-actions">${actions}</div>
      ${executions.length ? `<ul class="execution-list" aria-label="Execution runs">${rows}</ul>` : ''}
    </section>`;
}

function packageStationMarkup() {
  const acceptedCount = state.detail.points.filter(point => point.disposition === 'ACCEPTED').length;
  const workPackage = state.detail.workPackage;
  if (!workPackage) {
    const prepareBusy = isBusy('prepare-package');
    return `
      <section class="package-station" id="packageStation" role="tabpanel" aria-labelledby="packageTab packageTitle" tabindex="-1">
        <div class="station-head"><div class="station-title"><h2 id="packageTitle">Work package</h2><span class="station-meta">Not prepared</span></div></div>
        <div class="package-scroll"><div class="package-empty">
          <h3>Collect accepted points</h3>
          <p>${acceptedCount ? `${acceptedCount} accepted point${acceptedCount === 1 ? ' is' : 's are'} ready to become a bounded package.` : 'Accept at least one planning point before preparing a package.'}</p>
          <button type="button" class="primary-action" data-action="prepare-package" ${acceptedCount && !prepareBusy ? '' : 'disabled'}>${icon('package')} ${prepareBusy ? 'Preparing…' : 'Prepare package'}</button>
        </div></div>
      </section>`;
  }

  const versions = workPackage.versions;
  const selected = versions.find(version => version.id === state.viewedVersionId) || workPackage.currentVersion;
  if (!selected) return '';
  const packageMutationBusy = isPackageMutationBusy();
  const history = versions.map(version => `<button type="button" data-action="view-version" data-version-id="${escapeHtml(version.id)}" aria-current="${selected.id === version.id}" ${packageMutationBusy ? 'disabled' : ''}>v${version.versionNumber} · ${version.status === 'DRAFT' ? 'Draft' : 'Approved'}</button>`).join('');
  const approval = workPackage.approvals.find(item => item.workPackageVersionId === selected.id);
  const isApprovalArmed = state.approvalArmedVersionId === selected.id;
  const completeness = packageCompleteness(state.packageDraft || draftFromPackageContent(selected.content));
  const ownerName = state.bootstrap?.owner?.displayName || 'Owner';
  const fieldConflicts = state.packageConflict?.fieldConflicts || {};
  const collisionMarkup = Object.entries(fieldConflicts).map(([name, values]) => `
    <section class="field-collision" aria-labelledby="collision-${escapeHtml(name)}">
      <strong id="collision-${escapeHtml(name)}">${escapeHtml(packageFieldLabel(name))} changed in both views</strong>
      <div class="collision-values"><div><span>Yours</span><pre>${escapeHtml(values.local || '(empty)')}</pre></div><div><span>Latest saved</span><pre>${escapeHtml(values.latest || '(empty)')}</pre></div></div>
      <div class="feedback-actions"><button type="button" id="resolve-package-${escapeHtml(name)}-local" data-action="resolve-package-field" data-field="${escapeHtml(name)}" data-choice="local" ${packageMutationBusy ? 'disabled' : ''}>Keep yours</button><button type="button" id="resolve-package-${escapeHtml(name)}-latest" data-action="resolve-package-field" data-field="${escapeHtml(name)}" data-choice="latest" ${packageMutationBusy ? 'disabled' : ''}>Use latest</button></div>
    </section>`).join('');
  const conflictMarkup = state.packageConflict ? `
    <div class="feedback" data-tone="warning" role="alert">
      <strong>${escapeHtml(state.packageConflict.message)}</strong>
      <span>Your entered package text is still here.</span>
      ${collisionMarkup}
      ${state.packageConflict.rebased && !hasUnresolvedPackageFields() ? '<span>All changed fields are resolved. Review the combined draft, then save.</span>' : ''}
      <div class="feedback-actions">${state.packageConflict.rebased ? '' : `<button type="button" data-action="retry-package-conflict" ${packageMutationBusy ? 'disabled' : ''}>Compare and reapply changes</button>`}<button type="button" data-action="discard-package" ${packageMutationBusy ? 'disabled' : ''}>Use latest saved version</button></div>
    </div>` : '';

  const body = selected.status === 'DRAFT' && selected.id === workPackage.currentVersion.id
    ? `<form class="package-form" data-form="package" data-version-id="${escapeHtml(selected.id)}" data-version="${selected.rowVersion}">
        ${packageField('Outcome', 'outcome')}
        ${packageField('Included scope', 'includedScope', 'One item per line. Accepted points populate this section when the draft is created.')}
        ${packageField('Exclusions', 'exclusions', 'One item per line. Approval requires an explicit boundary.')}
        ${packageField('Acceptance criteria', 'acceptanceCriteria', 'One observable outcome per line.')}
        ${packageField('Review requirements', 'reviewRequirements', 'Name the independent review expected before acceptance.')}
        ${packageField('Evidence requirements', 'evidenceRequirements', 'Name rerunnable proof the implementer must return.')}
        <div class="package-footer">
          ${conflictMarkup}
          <div class="form-actions">
            <button type="button" class="text-action" data-action="discard-package" ${state.packageDirty && !state.packageOrphan && !packageMutationBusy ? '' : 'disabled'}>Discard edits</button>
            <button type="submit" ${packageMutationBusy || hasUnresolvedPackageFields() || state.packageOrphan ? 'disabled' : ''}>${isBusy('package-save') ? 'Saving…' : state.packageOrphan ? 'Resolve held edits first' : hasUnresolvedPackageFields() ? 'Resolve conflicts to save' : state.packageDirty ? 'Save draft' : 'Draft saved'}</button>
          </div>
          ${isApprovalArmed ? `
            <section class="approval-checkpoint" aria-labelledby="approvalCheckpointTitle">
              <span class="station-label">Approval checkpoint</span>
              <h4 id="approvalCheckpointTitle">Approve version ${selected.versionNumber} as ${escapeHtml(ownerName)}?</h4>
              <dl class="approval-facts">
                <div><dt>Exact version</dt><dd>v${selected.versionNumber} · Draft</dd></div>
                <div><dt>Completeness</dt><dd>${completeness.completeFields}/${completeness.totalFields} required sections</dd></div>
                <div><dt>Source lineage</dt><dd>${selected.sourcePointIds.length} accepted point${selected.sourcePointIds.length === 1 ? '' : 's'}</dd></div>
              </dl>
              <p>${state.packageDirty ? 'Your unsaved edits will be saved first. ' : ''}Confirmation records an append-only owner event and makes this exact version immutable. It marks the package ready; it does not execute or change the repository.</p>
              <div class="approval-confirm-actions">
                <button type="button" class="text-action" data-action="cancel-approval" ${packageMutationBusy ? 'disabled' : ''}>Continue reviewing</button>
                <button type="button" class="approval-action" data-action="confirm-approval" data-version-id="${escapeHtml(selected.id)}" ${packageMutationBusy || hasUnresolvedPackageFields() || state.packageOrphan ? 'disabled' : ''}>${isBusy('package-approve') ? 'Recording approval…' : state.packageOrphan ? 'Resolve held edits first' : hasUnresolvedPackageFields() ? 'Resolve conflicts first' : `Confirm approval of v${selected.versionNumber}`} ${icon('arrow')}</button>
              </div>
            </section>` : `
            <button type="button" class="approval-action" data-action="review-approval" data-version-id="${escapeHtml(selected.id)}" ${packageMutationBusy || hasUnresolvedPackageFields() || state.packageOrphan ? 'disabled' : ''}>${state.packageOrphan ? 'Resolve held edits before approval' : hasUnresolvedPackageFields() ? 'Resolve conflicts before approval' : `Review approval of v${selected.versionNumber}`} ${icon('arrow')}</button>
            <p class="lineage-footnote">Review the exact version, owner, completeness, and source lineage before recording approval. Approval never starts execution.</p>`}
        </div>
      </form>`
    : `<div class="package-readonly">
        <div class="ready-banner"><strong>Ready for execution</strong><span>Version ${selected.versionNumber} is immutable. Approval did not dispatch execution.</span></div>
        ${packageReadOnlyField('Outcome', selected.content.outcome, false)}
        ${packageReadOnlyField('Included scope', selected.content.includedScope)}
        ${packageReadOnlyField('Exclusions', selected.content.exclusions)}
        ${packageReadOnlyField('Acceptance criteria', selected.content.acceptanceCriteria)}
        ${packageReadOnlyField('Review requirements', selected.content.reviewRequirements)}
        ${packageReadOnlyField('Evidence requirements', selected.content.evidenceRequirements)}
        <div class="owner-seal" aria-hidden="true"><span>Owner authority</span><strong>A</strong><span>Andamento</span></div>
        <p class="lineage-footnote">Approved by ${escapeHtml(approval?.ownerDisplayName || 'Owner')} · ${escapeHtml(formatDate(approval?.occurredAt || selected.approvedAt))} · ${selected.sourcePointIds.length} source point${selected.sourcePointIds.length === 1 ? '' : 's'}</p>
        ${executionMarkup(selected)}
        ${selected.id === workPackage.currentVersion.id && !versions.some(version => version.status === 'DRAFT')
          ? `<button type="button" class="primary-action" data-action="next-version" data-version-id="${escapeHtml(selected.id)}" ${packageMutationBusy ? 'disabled' : ''}>Create version ${selected.versionNumber + 1} draft</button>` : ''}
      </div>`;

  return `
    <section class="package-station" id="packageStation" role="tabpanel" aria-labelledby="packageTab packageTitle" tabindex="-1">
      <div class="station-head">
        <div class="station-title"><h2 id="packageTitle">Work package</h2><span class="station-meta">${escapeHtml(selected.status === 'DRAFT' ? `Version ${selected.versionNumber} · Draft` : `Version ${selected.versionNumber} · Approved`)}</span></div>
        <div class="version-history" aria-label="Package versions">${history}</div>
      </div>
      <div class="package-scroll">
        <article class="package-sheet" data-status="${escapeHtml(selected.status)}">
          <div class="package-title-line"><h3>Planning loop package</h3><div class="package-version">v${selected.versionNumber}<br>${escapeHtml(selected.status)}</div></div>
          ${packageOrphanMarkup(workPackage.currentVersion)}
          ${body}
        </article>
      </div>
    </section>`;
}

function lineageMarkup() {
  const messages = state.detail.messages;
  const points = state.detail.points;
  const pointLabels = new Map(points.map((point, index) => [point.id, `P${index + 1}`]));
  const currentVersion = state.detail.workPackage?.currentVersion;
  const packageSources = new Set(currentVersion?.sourcePointIds || []);
  const groups = messages.map((message, messageIndex) => {
    const messageLabel = `M${messageIndex + 1}`;
    const sourcedPoints = points.filter(point => point.sourceMessageId === message.id);
    const pointNodes = sourcedPoints.length ? sourcedPoints.map(point => {
      const pointLabel = pointLabels.get(point.id);
      const included = packageSources.has(point.id);
      const priorLabel = point.supersedesPointId ? pointLabels.get(point.supersedesPointId) : '';
      const relationship = `${pointLabel} sourced from ${messageLabel}, ${point.disposition.toLowerCase()}${priorLabel ? `, replacement for ${priorLabel}` : ''}${included ? `, included in work package v${currentVersion.versionNumber}` : ', not included in the current work package'}`;
      return `<li class="lineage-point"><button type="button" class="lineage-node" data-state="${escapeHtml(point.disposition)}" data-in-package="${included}" data-action="lineage-point" data-point-id="${escapeHtml(point.id)}" aria-label="${escapeHtml(relationship)}" title="${escapeHtml(relationship)}"><span aria-hidden="true">${escapeHtml(pointLabel)}</span></button>${included ? `<span class="lineage-package-link" aria-hidden="true">v${currentVersion.versionNumber}</span>` : ''}</li>`;
    }).join('') : '<li class="lineage-no-point" aria-label="No planning point captured from this contribution">—</li>';
    const sourceLabel = `${messageLabel}, source contribution from ${message.participant.displayName}, ${sourcedPoints.length} planning point${sourcedPoints.length === 1 ? '' : 's'}`;
    return `<li class="lineage-group"><button type="button" class="lineage-node lineage-source" data-state="SOURCE" data-action="lineage-message" data-message-id="${escapeHtml(message.id)}" aria-label="${escapeHtml(sourceLabel)}" title="${escapeHtml(sourceLabel)}"><span aria-hidden="true">${messageLabel}</span></button><ol class="lineage-branch">${pointNodes}</ol></li>`;
  }).join('');
  const packageLabel = currentVersion
    ? `Work package v${currentVersion.versionNumber}, ${currentVersion.status.toLowerCase().replaceAll('_', ' ')}, includes ${currentVersion.sourcePointIds.length} planning point${currentVersion.sourcePointIds.length === 1 ? '' : 's'}`
    : 'Work package not prepared';
  const packageNode = `<li class="lineage-terminal"><button type="button" class="lineage-package-node" data-action="lineage-package" aria-label="${escapeHtml(packageLabel)}" title="${escapeHtml(packageLabel)}"><span aria-hidden="true">${currentVersion ? `v${currentVersion.versionNumber}` : 'WP'}</span><small aria-hidden="true">${currentVersion ? escapeHtml(currentVersion.status) : 'OPEN'}</small></button></li>`;
  const nodes = groups || '<li class="lineage-waiting">Waiting for a source contribution</li>';
  return `
    <aside class="lineage-station" aria-labelledby="lineageTitle">
      <div class="lineage-head"><strong id="lineageTitle">Lineage</strong><span class="visually-hidden">Navigate every source, its planning points, and current work package membership.</span></div>
      <ol class="lineage-nodes">${nodes}${packageNode}</ol>
    </aside>`;
}

function applyResponsiveStationVisibility() {
  const narrow = matchMedia('(max-width: 1279px)').matches;
  const decisions = document.querySelector('#decisionStation');
  const packageSection = document.querySelector('#packageStation');
  if (!decisions || !packageSection) return;
  decisions.hidden = narrow && state.rightTab !== 'decisions';
  packageSection.hidden = narrow && state.rightTab !== 'package';
}

function focusedControlSnapshot() {
  const control = document.activeElement;
  if (!control?.id || !app.contains(control)) return null;
  return {
    id: control.id,
    start: typeof control.selectionStart === 'number' ? control.selectionStart : null,
    end: typeof control.selectionEnd === 'number' ? control.selectionEnd : null,
  };
}

function restoreFocusedControl(snapshot) {
  if (!snapshot) return;
  const control = document.getElementById(snapshot.id);
  if (!control) return;
  control.focus({ preventScroll: true });
  if (snapshot.start !== null && typeof control.setSelectionRange === 'function') {
    control.setSelectionRange(snapshot.start, snapshot.end);
  }
}

function stationScrollSnapshot() {
  const selectors = ['#messageScroll', '.decision-scroll', '.package-scroll'];
  return Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector);
    return [selector, element ? { top: element.scrollTop, left: element.scrollLeft } : null];
  }));
}

function restoreStationScroll(snapshot) {
  if (!snapshot) return;
  for (const [selector, position] of Object.entries(snapshot)) {
    const element = document.querySelector(selector);
    if (element && position) element.scrollTo({ top: position.top, left: position.left, behavior: 'instant' });
  }
}

function renderWorkspace({ keepFocus = false } = {}) {
  const focusSnapshot = keepFocus ? focusedControlSnapshot() : null;
  const scrollSnapshot = keepFocus ? stationScrollSnapshot() : null;
  syncPackageDraft();
  const detail = state.detail;
  const transientRuns = detail.runs.filter(run => run.status !== 'COMPLETED');
  const contributions = [
    ...detail.messages.map(message => ({ at: message.createdAt, html: messageMarkup(message) })),
    ...transientRuns.map(run => ({ at: run.startedAt, html: runMarkup(run) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const messageList = contributions.length
    ? contributions.map(item => item.html).join('')
    : '<li class="empty-trace"><h2>Set the planning context</h2><p>Add the owner’s question first. Invite Codex or import another agent’s pushback only when it can improve the decision.</p></li>';
  const activePoints = detail.points.filter(point => point.disposition !== 'SUPERSEDED');
  app.innerHTML = `
    <div class="workspace">
      <section class="discussion-station" aria-labelledby="discussionTitle">
        <div class="station-head">
          <div class="discussion-heading">
            <a class="compact-room-return" href="#/projects/${escapeHtml(detail.project.id)}" aria-label="Return to ${escapeHtml(detail.project.name)} rooms">${icon('back')}<span>Rooms</span></a>
            <div class="station-title"><span class="station-label">Planning room</span><h1 id="discussionTitle">${escapeHtml(detail.discussion.title)}</h1></div>
          </div>
          <span class="station-meta">${detail.messages.length} contributions · ${activePoints.length} points</span>
        </div>
        <div class="message-scroll" id="messageScroll">
          ${feedbackMarkup()}
          <ol class="message-list">${messageList}</ol>
        </div>
        ${composerMarkup()}
      </section>
      ${lineageMarkup()}
      <section class="right-station" aria-label="Owner decisions and package">
        <div class="right-tabs" role="tablist" aria-label="Right work station">
          <button type="button" role="tab" id="decisionTab" data-action="right-tab" data-tab="decisions" aria-selected="${state.rightTab === 'decisions'}" aria-controls="decisionStation" tabindex="${state.rightTab === 'decisions' ? '0' : '-1'}">Decisions (${activePoints.length})</button>
          <button type="button" role="tab" id="packageTab" data-action="right-tab" data-tab="package" aria-selected="${state.rightTab === 'package'}" aria-controls="packageStation" tabindex="${state.rightTab === 'package' ? '0' : '-1'}">Package</button>
        </div>
        ${decisionStationMarkup()}
        ${packageStationMarkup()}
      </section>
    </div>`;
  applyResponsiveStationVisibility();
  restoreStationScroll(scrollSnapshot);
  const focusOrphanRecovery = state.packageOrphanFocusPending
    && keepFocus
    && (focusSnapshot?.id.startsWith('package-') || focusSnapshot?.id.startsWith('resolve-package-'));
  state.packageOrphanFocusPending = false;
  if (focusOrphanRecovery) {
    document.querySelector('.package-orphan [data-action="carry-orphan-package"]')?.focus({ preventScroll: true });
  } else if (keepFocus) restoreFocusedControl(focusSnapshot);
  else app.focus({ preventScroll: true });
  schedulePoll();
}

function render() {
  renderHeader();
  if (state.phase === 'loading') renderLoading();
  else if (state.phase === 'bootstrap-error') renderBootstrapError();
  else if (state.phase === 'new-project') renderNewProject();
  else if (state.phase === 'project') renderProjectRegister();
  else if (state.phase === 'workspace') renderWorkspace();
}

function parseRoute() {
  const hash = location.hash || '#/';
  const discussion = hash.match(/^#\/projects\/([^/]+)\/discussions\/([^/]+)$/);
  if (discussion) return { name: 'discussion', projectId: discussion[1], discussionId: discussion[2] };
  const project = hash.match(/^#\/projects\/([^/]+)$/);
  if (project) return { name: 'project', projectId: project[1] };
  if (hash === '#/new-project') return { name: 'new-project' };
  return { name: 'home' };
}

function resetWorkspaceTransient() {
  releasePendingRefreshOperations(state.discussionId);
  state.composerMode = 'owner';
  state.composerDraft = { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' };
  state.composerRevision += 1;
  state.captureMessageId = '';
  state.editPointId = '';
  state.captureDrafts = {};
  state.replacementDrafts = {};
  state.packageDraft = null;
  state.packageBase = null;
  state.packageBaseRowVersion = null;
  state.packageDraftVersionId = '';
  state.packageDirty = false;
  state.packageConflict = null;
  state.packageOrphan = null;
  state.packageOrphanFocusPending = false;
  state.approvalArmedVersionId = '';
  state.viewedVersionId = '';
  state.pollFailureCount = 0;
  state.pollOutageActive = false;
}

function restorePackageRecovery(recovery) {
  const current = state.detail?.workPackage?.currentVersion;
  const pendingDraft = normalizedPackageDraft(recovery.draft);
  if (
    current
    && current.id === recovery.versionId
    && packageDraftsEqual(normalizedPackageDraft(draftFromPackageContent(current.content)), pendingDraft)
  ) {
    return 'already-durable';
  }
  if (current?.status === 'DRAFT') {
    if (current.id === recovery.versionId && current.rowVersion === recovery.baseRowVersion) {
      state.packageDraftVersionId = current.id;
      state.packageDraft = { ...recovery.draft };
      state.packageBase = { ...recovery.base };
      state.packageBaseRowVersion = recovery.baseRowVersion;
      state.packageDirty = true;
      state.packageConflict = null;
      state.viewedVersionId = current.id;
      return 'restored';
    }
    installRebasedPackageDraft({ localDraft: recovery.draft, priorBase: recovery.base, current });
    state.viewedVersionId = current.id;
    return 'rebased';
  }
  state.packageOrphan = {
    draft: { ...recovery.draft },
    base: { ...recovery.base },
    sourceVersionId: recovery.versionId,
    sourceVersionNumber: recovery.versionNumber || '',
  };
  state.packageOrphanFocusPending = true;
  if (current?.id) state.viewedVersionId = current.id;
  return 'held';
}

function heldRecoveryIsDurable(recovery) {
  if (recovery.type === 'discussion') {
    return state.discussions.some(item => item.title === recovery.title);
  }
  const detail = state.detail;
  if (!detail) return false;
  if (recovery.type === 'message') {
    return recovery.mode === 'owner' || recovery.mode === 'imported'
      ? detail.messages.some(message => message.content === recovery.draft.content)
      : detail.runs.some(run => run.prompt === recovery.draft.content);
  }
  if (recovery.type === 'capture') {
    return detail.points.some(point => point.sourceMessageId === recovery.messageId
      && point.text === recovery.draft.text);
  }
  if (recovery.type === 'replacement') {
    return detail.points.some(point => point.supersedesPointId === recovery.pointId
      && point.text === recovery.draft.text);
  }
  return false;
}

function heldRecoveryTarget(recovery) {
  const detail = state.detail;
  if (recovery.type === 'capture') {
    return detail?.messages.some(message => message.id === recovery.messageId)
      ? 'available'
      : 'source-gone';
  }
  if (recovery.type === 'replacement') {
    const point = detail?.points.find(item => item.id === recovery.pointId);
    if (!point) return 'source-gone';
    return point.disposition === 'PROPOSED' ? 'available' : 'decided';
  }
  return 'available';
}

function recoveryScopeLabel(discussionId) {
  return discussionId ? 'this planning room' : 'this project';
}

function consumePendingDraftRecoveries(projectId, discussionId = '') {
  const matching = [];
  for (const [slot, recovery] of state.pendingDraftRecoveries) {
    if (recovery.projectId === projectId && recovery.discussionId === discussionId) {
      matching.push({ slot, recovery });
    }
  }
  if (!matching.length) return false;
  matching.sort((left, right) => left.recovery.sequence - right.recovery.sequence);
  const scope = recoveryScopeLabel(discussionId);
  const notices = [];
  let tone = 'success';
  let restored = 0;
  for (const { slot, recovery } of matching) {
    if (recovery.type !== 'package' && heldRecoveryIsDurable(recovery)) {
      clearOperation(slot);
      notices.push('Your unconfirmed entry was already saved before its receipt was lost. Nothing further to submit.');
      continue;
    }
    const target = heldRecoveryTarget(recovery);
    if (target === 'decided') {
      clearOperation(slot);
      tone = 'warning';
      notices.push('The proposal you were editing has since been decided, so your replacement was not created. Capture a new proposal from its source contribution.');
      continue;
    }
    if (target === 'source-gone') {
      clearOperation(slot);
      tone = 'warning';
      notices.push('The contribution your unconfirmed entry belonged to is no longer available, so it was not saved.');
      continue;
    }
    if (recovery.type === 'discussion') {
      state.discussionDraft = { title: recovery.title };
      restored += 1;
    } else if (recovery.type === 'message') {
      state.composerMode = recovery.mode;
      state.composerDraft = { ...recovery.draft };
      state.composerRevision += 1;
      restored += 1;
    } else if (recovery.type === 'capture') {
      state.captureDrafts[recovery.messageId] = { ...recovery.draft };
      state.captureMessageId = recovery.messageId;
      restored += 1;
    } else if (recovery.type === 'replacement') {
      state.replacementDrafts[recovery.pointId] = { ...recovery.draft };
      state.editPointId = recovery.pointId;
      restored += 1;
    } else if (recovery.type === 'package') {
      const outcome = restorePackageRecovery(recovery);
      const versionNumber = state.detail?.workPackage?.currentVersion?.versionNumber || recovery.versionNumber;
      if (outcome === 'already-durable') {
        clearOperation(slot);
        notices.push(`Your package edits are already saved in the current draft of v${versionNumber}. Nothing further to submit.`);
        continue;
      }
      state.rightTab = 'package';
      tone = 'warning';
      if (outcome === 'rebased') {
        notices.push(`Your held package edits are reapplied to the latest saved v${versionNumber} in the package station. Resolve every marked field before saving.`);
      } else if (outcome === 'held') {
        notices.push('The package advanced while your save was unconfirmed. Your edits are held in the package station for explicit recovery.');
      } else {
        notices.push(`Your unsaved package edits are restored in the package station. Nothing was saved to v${versionNumber} yet.`);
      }
    }
  }
  if (restored) {
    tone = 'warning';
    notices.push(restored === 1
      ? `Your unconfirmed entry is restored in ${scope}. Nothing was submitted; submit it again when you are ready.`
      : `Your unconfirmed entries are restored in ${scope}. Nothing was submitted; submit each one again when you are ready.`);
  }
  if (!notices.length) return false;
  const message = notices.join(' ');
  setFeedback(message, tone, undefined, 'recovery');
  return true;
}

function detailFingerprint(detail) {
  return JSON.stringify({
    messages: detail.messages.map(message => message.id),
    runs: detail.runs.map(run => [run.id, run.status, run.rowVersion]),
    points: detail.points.map(point => [point.id, point.disposition, point.rowVersion]),
    versions: detail.workPackage?.versions.map(version => [version.id, version.status, version.rowVersion]) || [],
    approvals: detail.workPackage?.approvals.map(approval => approval.id) || [],
    codexAvailability: [
      Boolean(detail.agentAvailability?.codex?.blocked),
      detail.agentAvailability?.codex?.reason || '',
    ],
  });
}

async function requestBootstrap() {
  const requestSequence = ++state.bootstrapRequestSequence;
  try {
    const bootstrap = await api('/api/bootstrap');
    if (requestSequence !== state.bootstrapRequestSequence) return null;
    return bootstrap;
  } catch (error) {
    if (requestSequence !== state.bootstrapRequestSequence) return null;
    throw error;
  }
}

async function resumeAfterSupersededBootstrap() {
  if (!state.bootstrap) {
    state.phase = 'bootstrap-error';
    render();
    return;
  }
  state.projects = state.bootstrap.projects;
  await syncRoute();
}

async function loadBootstrap() {
  const loadGeneration = ++state.bootstrapLoadGeneration;
  const recoveringFromOutage = state.phase === 'bootstrap-error';
  const isCurrentLoad = () => loadGeneration === state.bootstrapLoadGeneration;
  state.phase = 'loading';
  render();
  try {
    const bootstrap = await requestBootstrap();
    if (!isCurrentLoad()) return;
    if (!bootstrap) {
      await resumeAfterSupersededBootstrap();
      return;
    }
    state.bootstrap = bootstrap;
    state.projects = state.bootstrap.projects;
    await syncRoute();
    if (recoveringFromOutage && isCurrentLoad() && !state.feedback) {
      announce('The local project register is available again.');
    }
  } catch (error) {
    if (!isCurrentLoad()) return;
    state.phase = 'bootstrap-error';
    setFeedback(error.message, 'error');
    render();
  }
}

async function syncRoute() {
  const generation = ++state.routeGeneration;
  clearTimeout(state.pollTimer);
  refreshHeldDraftRecoveries();
  if (state.phase === 'loading' && !state.bootstrap) {
    render();
    return;
  }
  if (state.phase === 'bootstrap-error' && !state.bootstrap) {
    render();
    return;
  }
  const route = parseRoute();
  const nextDiscussionId = route.name === 'discussion' ? route.discussionId : '';
  const nextProjectId = ['project', 'discussion'].includes(route.name) ? route.projectId : state.projectId;
  const leavesWorkspace = state.discussionId && (
    state.discussionId !== nextDiscussionId
    || (nextProjectId && state.projectId && state.projectId !== nextProjectId)
  );
  if (leavesWorkspace) resetWorkspaceTransient();
  if (state.projectId && nextProjectId && state.projectId !== nextProjectId) state.discussionDraft = { title: '' };
  clearFeedback();
  if (state.routeNotice) {
    setFeedback(state.routeNotice, 'error');
    state.routeNotice = '';
  }
  if (route.name === 'new-project' || !state.projects.length) {
    state.phase = 'new-project';
    if (!state.projects.length) state.projectId = '';
    state.discussionId = '';
    state.detail = null;
    render();
    return;
  }
  if (route.name === 'home') {
    location.replace(`#/projects/${state.projects[0].id}`);
    return;
  }
  const project = state.projects.find(item => item.id === route.projectId);
  if (!project) {
    state.routeNotice = 'That project is no longer available.';
    location.replace(`#/projects/${state.projects[0].id}`);
    return;
  }
  const projectChanged = state.projectId !== project.id;
  const discussionChanged = state.discussionId !== nextDiscussionId;
  state.projectId = project.id;
  state.discussionId = nextDiscussionId;
  if (projectChanged) state.discussions = [];
  if (projectChanged) state.discussionListUnavailable = false;
  if (projectChanged || discussionChanged) state.detail = null;
  if (route.name === 'project') state.discussions = [];
  if (route.name === 'project') state.discussionListUnavailable = false;
  state.phase = 'loading';
  render();
  if (route.name === 'project') {
    try {
      const result = await api(`/api/projects/${encodeURIComponent(project.id)}/discussions`);
      if (generation !== state.routeGeneration) return;
      state.discussions = result.discussions;
      state.discussionListUnavailable = false;
      state.phase = 'project';
      consumePendingDraftRecoveries(project.id);
      render();
    } catch (error) {
      if (generation !== state.routeGeneration) return;
      setFeedback(error.message, 'error', error.details);
      state.discussions = [];
      state.discussionListUnavailable = true;
      state.phase = 'project';
      render();
    }
    return;
  }
  try {
    const detail = await api(`/api/discussions/${encodeURIComponent(route.discussionId)}`);
    if (generation !== state.routeGeneration) return;
    if (detail.project.id !== project.id) {
      resetWorkspaceTransient();
      throw new ApiError(404, { error: { code: 'NOT_FOUND', message: 'That planning room does not belong to this project.' } });
    }
    state.detail = detail;
    state.discussionListUnavailable = false;
    clearPollOutage();
    state.phase = 'workspace';
    state.captureMessageId = '';
    state.editPointId = '';
    state.viewedVersionId = state.detail.workPackage?.currentVersion?.id || '';
    syncPackageDraft();
    consumePendingDraftRecoveries(project.id, route.discussionId);
    render();
  } catch (error) {
    if (generation !== state.routeGeneration) return;
    setFeedback(error.message, 'error', error.details);
    state.phase = 'project';
    state.discussionId = '';
    state.detail = null;
    state.discussions = [];
    try {
      const fallback = await api(`/api/projects/${encodeURIComponent(project.id)}/discussions`);
      if (generation !== state.routeGeneration) return;
      state.discussions = fallback.discussions;
      state.discussionListUnavailable = false;
      consumePendingDraftRecoveries(project.id);
    } catch {
      if (generation !== state.routeGeneration) return;
      state.discussionListUnavailable = true;
      setFeedback('The planning room and this project’s room list could not be loaded.', 'error');
    }
    render();
  }
}

async function refreshDiscussion({ keepFocus = true } = {}) {
  const discussionId = state.discussionId;
  const routeGeneration = state.routeGeneration;
  if (!discussionId || state.phase !== 'workspace') return false;
  clearTimeout(state.pollTimer);
  const requestSequence = ++state.detailRequestSequence;
  const isCurrentRequest = () => (
    state.discussionId === discussionId
    && state.phase === 'workspace'
    && state.routeGeneration === routeGeneration
    && state.detailRequestSequence === requestSequence
  );
  try {
    const detail = await api(`/api/discussions/${encodeURIComponent(discussionId)}`);
    if (!isCurrentRequest()) return false;
    state.detail = detail;
    clearPollOutage({ announceRecovery: true });
    renderHeader();
    renderWorkspace({ keepFocus });
    return true;
  } catch (error) {
    if (!isCurrentRequest()) return false;
    throw error;
  }
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  if (state.phase !== 'workspace') return;
  const discussionId = state.discussionId;
  const routeGeneration = state.routeGeneration;
  const delayMs = Math.min(450 * (2 ** Math.min(state.pollFailureCount, 5)), 8000);
  state.pollTimer = setTimeout(async () => {
    if (
      state.discussionId !== discussionId
      || state.phase !== 'workspace'
      || state.routeGeneration !== routeGeneration
    ) return;
    const requestSequence = ++state.detailRequestSequence;
    try {
      const priorFingerprint = detailFingerprint(state.detail);
      const detail = await api(`/api/discussions/${encodeURIComponent(discussionId)}`);
      if (
        state.discussionId !== discussionId
        || state.phase !== 'workspace'
        || state.routeGeneration !== routeGeneration
        || state.detailRequestSequence !== requestSequence
      ) return;
      const changed = detailFingerprint(detail) !== priorFingerprint;
      const recovered = state.pollOutageActive;
      clearPollOutage({ announceRecovery: recovered });
      if (changed || recovered) {
        state.detail = detail;
        renderHeader();
        renderWorkspace({ keepFocus: true });
      } else schedulePoll();
    } catch (error) {
      if (
        state.discussionId !== discussionId
        || state.phase !== 'workspace'
        || state.routeGeneration !== routeGeneration
        || state.detailRequestSequence !== requestSequence
      ) return;
      state.pollFailureCount += 1;
      if (!state.pollOutageActive) {
        state.pollOutageActive = true;
        if (!state.feedback || ['poll', 'refresh'].includes(state.feedback.source)) {
          setFeedback(
            'Live updates are paused while Andamento reconnects to the local service.',
            'error',
            undefined,
            'poll',
          );
          renderHeader();
          renderWorkspace({ keepFocus: true });
        } else schedulePoll();
      } else schedulePoll();
    }
  }, delayMs);
}

function renderAfterDetachedMutation() {
  if (state.phase === 'workspace') {
    renderHeader();
    renderWorkspace({ keepFocus: true });
  } else render();
}

function reportDisplayRefreshFailure({ committed = false } = {}) {
  state.pollFailureCount = Math.max(1, state.pollFailureCount + 1);
  state.pollOutageActive = true;
  setFeedback(
    committed
      ? 'The action was saved locally, but the latest view could not refresh. Andamento will keep retrying.'
      : 'The latest saved state could not refresh. Andamento will keep retrying.',
    'error',
    undefined,
    'refresh',
  );
  renderAfterDetachedMutation();
}

async function refreshAfterCommittedMutation({
  operationSlot = '',
  discussionId,
  routeGeneration,
  keepFocus = true,
} = {}) {
  const boundDiscussionId = discussionId || state.discussionId;
  const boundRouteGeneration = routeGeneration ?? state.routeGeneration;
  const isCurrentContext = () => state.phase === 'workspace'
    && state.discussionId === boundDiscussionId
    && state.routeGeneration === boundRouteGeneration;
  try {
    const applied = await refreshDiscussion({ keepFocus });
    if (applied || !isCurrentContext()) clearOperation(operationSlot);
    else holdOperationUntilRefresh(operationSlot, boundDiscussionId);
    return applied;
  } catch {
    if (!isCurrentContext()) {
      clearOperation(operationSlot);
      renderAfterDetachedMutation();
      return false;
    }
    holdOperationUntilRefresh(operationSlot, boundDiscussionId);
    reportDisplayRefreshFailure({ committed: true });
    return false;
  }
}

async function withMutation(key, callback, {
  refresh = true,
  successMessage = '',
  operationSlot = '',
  contextDiscussionId = undefined,
  contextRouteGeneration = undefined,
  contextProjectId = undefined,
  allowDetachedResult = false,
  unconfirmedSource = 'unconfirmed-mutation',
  recovery = null,
} = {}) {
  if (isBusy(key)) return null;
  const boundDiscussionId = contextDiscussionId === undefined && state.phase === 'workspace'
    ? state.discussionId : contextDiscussionId;
  const boundRouteGeneration = contextRouteGeneration === undefined && boundDiscussionId
    ? state.routeGeneration : contextRouteGeneration;
  const isCurrentContext = () => (
    (!boundDiscussionId || (state.phase === 'workspace' && state.discussionId === boundDiscussionId))
    && (boundRouteGeneration === undefined || state.routeGeneration === boundRouteGeneration)
    && (contextProjectId === undefined || state.projectId === contextProjectId)
  );
  setBusy(key, true);
  clearFeedback();
  if (state.phase === 'workspace') {
    renderHeader();
    renderWorkspace({ keepFocus: true });
  } else render();
  let result;
  try {
    result = await callback();
    state.detailRequestSequence += 1;
  } catch (error) {
    state.detailRequestSequence += 1;
    setBusy(key, false);
    if (error.code === 'REQUEST_UNCONFIRMED') holdDraftRecovery(operationSlot, recovery);
    if (!isCurrentContext()) {
      renderAfterDetachedMutation();
      announce('The outcome of an action in the planning room you left could not be confirmed.', true);
      return null;
    }
    setFeedback(
      error.message,
      'error',
      error.details,
      error.code === 'REQUEST_UNCONFIRMED' ? unconfirmedSource : 'action',
    );
    if (state.phase === 'workspace') {
      renderHeader();
      renderWorkspace({ keepFocus: true });
    }
    else render();
    return null;
  }
  setBusy(key, false);
  if (!isCurrentContext()) {
    clearOperation(operationSlot);
    renderAfterDetachedMutation();
    if (!allowDetachedResult) {
      announce('The action finished in the planning room you left.');
      return null;
    }
  }
  if (successMessage && isCurrentContext()) announce(successMessage);
  if (!refresh || !isCurrentContext()) return result;
  try {
    const applied = await refreshDiscussion();
    if (!isCurrentContext()) {
      clearOperation(operationSlot);
      renderAfterDetachedMutation();
      announce('The action finished in the planning room you left.');
      return allowDetachedResult ? result : null;
    }
    if (applied) clearOperation(operationSlot);
    else holdOperationUntilRefresh(operationSlot, boundDiscussionId);
  } catch {
    if (!isCurrentContext()) {
      clearOperation(operationSlot);
      renderAfterDetachedMutation();
      return allowDetachedResult ? result : null;
    }
    holdOperationUntilRefresh(operationSlot, boundDiscussionId);
    reportDisplayRefreshFailure({ committed: true });
  }
  return result;
}

async function submitProject(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const submissionGeneration = state.routeGeneration;
  const operationSlot = 'project-submit';
  const target = '/api/projects';
  const payload = { name: data.get('name'), repositoryRoot: data.get('repositoryRoot') };
  const result = await withMutation('project', () => api(target, {
    method: 'POST',
    body: { ...payload, idempotencyKey: operationKey(operationSlot, 'project', { target, payload }) },
  }), {
    refresh: false,
    successMessage: 'Project registered locally.',
    operationSlot,
    contextRouteGeneration: submissionGeneration,
    allowDetachedResult: true,
  });
  if (!result) return;
  clearOperation(operationSlot);
  state.projectDraft = { name: '', repositoryRoot: '' };
  state.projects = [...state.projects.filter(project => project.id !== result.project.id), result.project];
  if (state.bootstrap) state.bootstrap.projects = state.projects;
  if (state.routeGeneration !== submissionGeneration) {
    renderAfterDetachedMutation();
    announce('The project was registered locally and added to the project selector.');
    return;
  }
  let bootstrap;
  try {
    bootstrap = await requestBootstrap();
  } catch {
    if (state.routeGeneration !== submissionGeneration) return;
    announce('Project registered locally. The project list refresh was interrupted; opening the saved project.', true);
    location.hash = `#/projects/${result.project.id}`;
    return;
  }
  if (!bootstrap || state.routeGeneration !== submissionGeneration) return;
  state.bootstrap = bootstrap;
  state.projects = bootstrap.projects;
  location.hash = `#/projects/${result.project.id}`;
}

async function submitDiscussion(form) {
  if (state.discussionListUnavailable) return;
  if (!form.reportValidity()) return;
  const title = new FormData(form).get('title');
  const projectId = state.projectId;
  const submissionGeneration = state.routeGeneration;
  const operationSlot = `discussion:${projectId}`;
  const target = `/api/projects/${encodeURIComponent(projectId)}/discussions`;
  const payload = { title };
  const result = await withMutation('discussion', () => api(target, {
    method: 'POST', body: { ...payload, idempotencyKey: operationKey(operationSlot, 'discussion', { target, payload }) },
  }), {
    refresh: false,
    successMessage: 'Planning room opened.',
    operationSlot,
    contextRouteGeneration: submissionGeneration,
    contextProjectId: projectId,
    recovery: { type: 'discussion', projectId, title },
  });
  if (result) {
    clearOperation(operationSlot);
    if (state.routeGeneration !== submissionGeneration || state.projectId !== projectId) return;
    state.discussionDraft = { title: '' };
    location.hash = `#/projects/${projectId}/discussions/${result.discussion.id}`;
  }
}

async function submitMessage(form) {
  const mode = state.composerMode;
  const codexAvailability = state.detail?.agentAvailability?.codex;
  if (mode === 'codex' && codexAvailability?.blocked) {
    setFeedback(codexAvailability.reason || 'Codex is blocked in this planning room.', 'error');
    renderWorkspace({ keepFocus: true });
    return;
  }
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const content = data.get('content');
  const discussionId = state.discussionId;
  const submissionGeneration = state.routeGeneration;
  const submittedRevision = state.composerRevision;
  const key = 'message';
  const operationSlot = `message:${discussionId}:${mode}`;
  let request;
  if (mode === 'owner' || mode === 'imported') {
    const target = `/api/discussions/${encodeURIComponent(discussionId)}/messages`;
    const payload = {
      contributionType: mode === 'owner' ? 'OWNER' : 'IMPORTED',
      content,
      displayName: data.get('displayName'),
      provider: data.get('provider'),
      model: data.get('model'),
    };
    request = () => api(target, {
      method: 'POST',
      body: { ...payload, idempotencyKey: operationKey(operationSlot, 'message', { target, payload }) },
    });
  } else {
    const target = `/api/discussions/${encodeURIComponent(discussionId)}/agent-runs`;
    const payload = { adapter: mode, prompt: content };
    request = () => api(target, {
      method: 'POST',
      body: { ...payload, idempotencyKey: operationKey(operationSlot, 'agent-run', { target, payload }) },
    });
  }
  const result = await withMutation(key, request, {
    refresh: false,
    successMessage: mode === 'owner' || mode === 'imported' ? 'Contribution added.' : 'Planning participant started.',
    operationSlot,
    contextDiscussionId: discussionId,
    recovery: {
      type: 'message',
      projectId: state.projectId,
      discussionId,
      mode,
      draft: { ...state.composerDraft },
    },
  });
  if (result) {
    clearOperation(operationSlot);
    if (
      state.discussionId === discussionId
      && state.composerMode === mode
      && state.composerRevision === submittedRevision
    ) {
      state.composerDraft = { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' };
      state.composerRevision += 1;
    }
    await refreshAfterCommittedMutation({ discussionId, routeGeneration: submissionGeneration });
  }
}

async function submitCapture(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const messageId = form.dataset.messageId;
  const key = `capture:${messageId}`;
  const operationSlot = `capture:${messageId}`;
  const target = `/api/messages/${encodeURIComponent(messageId)}/planning-points`;
  const payload = { pointType: data.get('pointType'), text: data.get('text') };
  const result = await withMutation(key, () => api(target, {
    method: 'POST',
    body: { ...payload, idempotencyKey: operationKey(operationSlot, 'point', { target, payload }) },
  }), {
    refresh: false,
    successMessage: 'Planning point proposed for owner decision.',
    operationSlot,
    recovery: {
      type: 'capture',
      projectId: state.projectId,
      discussionId: state.discussionId,
      messageId,
      draft: { ...payload },
    },
  });
  if (result) {
    clearOperation(operationSlot);
    delete state.captureDrafts[messageId];
    if (state.captureMessageId === messageId) state.captureMessageId = '';
    await refreshAfterCommittedMutation();
  }
}

async function submitReplacement(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const pointId = form.dataset.pointId;
  if (isBusy(`point:${pointId}`) || isBusy(`replace:${pointId}`)) return;
  const operationSlot = `replace:${pointId}`;
  const target = `/api/planning-points/${encodeURIComponent(pointId)}/replacement`;
  const payload = {
    pointType: data.get('pointType'),
    text: data.get('text'),
    expectedVersion: Number(form.dataset.version),
  };
  const result = await withMutation(`replace:${pointId}`, () => api(target, {
    method: 'POST',
    body: { ...payload, idempotencyKey: operationKey(operationSlot, 'point-replacement', { target, payload }) },
  }), {
    refresh: false,
    successMessage: 'Replacement proposal created; the earlier proposal remains in history.',
    operationSlot,
    recovery: {
      type: 'replacement',
      projectId: state.projectId,
      discussionId: state.discussionId,
      pointId,
      draft: { pointType: payload.pointType, text: payload.text },
    },
  });
  if (result) {
    clearOperation(operationSlot);
    delete state.replacementDrafts[pointId];
    if (state.editPointId === pointId) state.editPointId = '';
    await refreshAfterCommittedMutation();
  }
}

function contentFromPackageDraft(draft = state.packageDraft) {
  return {
    outcome: draft.outcome.trim(),
    includedScope: lines(draft.includedScope),
    exclusions: lines(draft.exclusions),
    acceptanceCriteria: lines(draft.acceptanceCriteria),
    reviewRequirements: lines(draft.reviewRequirements),
    evidenceRequirements: lines(draft.evidenceRequirements),
  };
}

async function savePackage({ refresh = true } = {}) {
  const current = state.detail.workPackage?.currentVersion;
  if (!current || current.status !== 'DRAFT') return null;
  const discussionId = state.discussionId;
  const submissionGeneration = state.routeGeneration;
  const versionId = current.id;
  const draftSnapshot = { ...state.packageDraft };
  disarmApproval();
  if (hasUnresolvedPackageFields()) {
    setFeedback('Resolve every package field conflict before saving.', 'error');
    renderWorkspace({ keepFocus: true });
    return null;
  }
  const expected = state.packageBaseRowVersion;
  const operationSlot = `package-save:${current.id}`;
  const target = `/api/work-package-versions/${encodeURIComponent(current.id)}`;
  const payload = { content: contentFromPackageDraft(draftSnapshot), expectedVersion: expected };
  const result = await withMutation('package-save', () => api(target, {
    method: 'PUT',
    body: { ...payload, idempotencyKey: operationKey(operationSlot, 'package-save', { method: 'PUT', target, payload }) },
  }), {
    refresh: false,
    operationSlot,
    contextDiscussionId: discussionId,
    contextRouteGeneration: submissionGeneration,
    allowDetachedResult: true,
    recovery: {
      type: 'package',
      projectId: state.projectId,
      discussionId,
      versionId,
      versionNumber: current.versionNumber,
      draft: { ...draftSnapshot },
      base: { ...(state.packageBase || blankPackageDraft()) },
      baseRowVersion: expected,
    },
  });
  const sameRoute = state.phase === 'workspace'
    && state.discussionId === discussionId
    && state.routeGeneration === submissionGeneration;
  if (!result) {
    if (sameRoute && state.feedback?.details?.current) {
      const conflictCurrent = state.feedback.details.current;
      const conflictMessage = state.feedback.message;
      clearFeedback();
      if (state.detail.workPackage?.currentVersion?.id === versionId) {
        applyPackageVersionToDetail(conflictCurrent);
        state.packageConflict = { message: conflictMessage, current: conflictCurrent };
      } else if (!state.packageOrphan) {
        setFeedback('The save stopped because a newer package version is current.', 'error');
      }
      renderHeader();
      renderWorkspace({ keepFocus: true });
      if (state.packageOrphan) announce('The package advanced while saving. Your edits remain held for explicit recovery.', true);
    }
    return null;
  }
  clearOperation(operationSlot);
  const contextCurrent = sameRoute
    && state.detail.workPackage?.currentVersion?.id === versionId;
  if (!contextCurrent) {
    if (sameRoute) {
      const savedDraft = draftFromPackageContent(result.version.content);
      if (
        state.packageOrphan?.sourceVersionId === versionId
        && packageDraftsEqual(normalizedPackageDraft(state.packageOrphan.draft), savedDraft)
      ) {
        state.packageOrphan = null;
        state.packageOrphanFocusPending = false;
        announce(`Your package edits were saved in v${result.version.versionNumber}; a newer version is now current.`);
      }
      renderHeader();
      renderWorkspace({ keepFocus: true });
    }
    return { version: result.version, contextCurrent: false };
  }
  applyPackageVersionToDetail(result.version);
  state.packageDirty = false;
  state.packageDraft = { ...draftSnapshot };
  state.packageBase = { ...draftSnapshot };
  state.packageBaseRowVersion = result.version.rowVersion;
  state.packageConflict = null;
  announce('Package draft saved locally.');
  renderHeader();
  renderWorkspace({ keepFocus: true });
  let displayRefreshed = true;
  if (refresh) {
    displayRefreshed = await refreshAfterCommittedMutation({ discussionId, routeGeneration: submissionGeneration });
  }
  return { version: result.version, contextCurrent: true, displayRefreshed };
}

async function carryOrphanedPackageDraft() {
  const orphan = state.packageOrphan;
  let current = state.detail?.workPackage?.currentVersion;
  if (!orphan || !current) return;
  if (current.status !== 'DRAFT') {
    const discussionId = state.discussionId;
    const operationSlot = `carry-next-version:${current.id}`;
    const target = `/api/work-package-versions/${encodeURIComponent(current.id)}/next-version`;
    const payload = {};
    const result = await withMutation('carry-package', () => api(target, {
      method: 'POST',
      body: { idempotencyKey: operationKey(operationSlot, 'package-next', { target, payload }) },
    }), {
      refresh: false,
      operationSlot,
      contextDiscussionId: discussionId,
    });
    if (!result || state.packageOrphan !== orphan) return;
    state.viewedVersionId = result.version.id;
    const refreshed = await refreshAfterCommittedMutation({ operationSlot, discussionId });
    if (!refreshed) return;
    current = state.detail?.workPackage?.currentVersion;
  }
  if (!current || current.status !== 'DRAFT' || state.packageOrphan !== orphan) return;
  installRebasedPackageDraft({
    localDraft: orphan.draft,
    priorBase: orphan.base,
    current,
    carried: true,
  });
  state.packageOrphan = null;
  state.packageOrphanFocusPending = false;
  state.viewedVersionId = current.id;
  state.rightTab = 'package';
  renderWorkspace({ keepFocus: true });
  requestAnimationFrame(() => {
    const nextAction = document.querySelector('.field-collision [data-action="resolve-package-field"]')
      || document.querySelector('#package-outcome');
    nextAction?.focus({ preventScroll: true });
  });
  announce(`Held edits are ready for review in package v${current.versionNumber}.`);
}

async function approvePackage(versionId) {
  let current = state.detail.workPackage?.currentVersion;
  if (!current || current.status !== 'DRAFT' || current.id !== versionId || state.approvalArmedVersionId !== versionId) return;
  const discussionId = state.discussionId;
  disarmApproval();
  if (state.packageDirty) {
    const saved = await savePackage({ refresh: true });
    if (!saved) return;
    if (!saved.contextCurrent || state.discussionId !== discussionId || saved.version.id !== versionId) {
      announce('The draft was saved, but approval stopped because you left the reviewed package.', true);
      return;
    }
    if (!saved.displayRefreshed) {
      announce('The draft was saved, but approval stopped because the latest package state could not be confirmed.', true);
      return;
    }
    const refreshedCurrent = state.detail.workPackage?.currentVersion;
    if (
      !refreshedCurrent
      || refreshedCurrent.id !== versionId
      || refreshedCurrent.status !== 'DRAFT'
      || refreshedCurrent.rowVersion !== saved.version.rowVersion
    ) {
      announce('The draft was saved, but approval stopped because the reviewed package changed.', true);
      return;
    }
    current = refreshedCurrent;
  }
  if (state.discussionId !== discussionId || current.id !== versionId) return;
  const operationSlot = `package-approve:${current.id}`;
  const target = `/api/work-package-versions/${encodeURIComponent(current.id)}/approve`;
  const payload = { expectedVersion: current.rowVersion };
  const result = await withMutation('package-approve', () => api(target, {
    method: 'POST',
    body: { ...payload, idempotencyKey: operationKey(operationSlot, 'package-approve', { target, payload }) },
  }), { successMessage: 'Package version approved and locked. No execution was dispatched.', operationSlot });
  if (result && state.detail.workPackage?.currentVersion?.id === result.version.id) {
    state.viewedVersionId = result.version.id;
  }
}

function updateDraftFromControl(control) {
  const form = control.closest('form[data-form]');
  if (!form || !control.name) return;
  if (form.dataset.form === 'project' && Object.hasOwn(state.projectDraft, control.name)) {
    state.projectDraft[control.name] = control.value;
  }
  if (form.dataset.form === 'discussion' && Object.hasOwn(state.discussionDraft, control.name)) {
    state.discussionDraft[control.name] = control.value;
  }
  if (form.dataset.form === 'message' && Object.hasOwn(state.composerDraft, control.name)) {
    state.composerDraft[control.name] = control.value;
    state.composerRevision += 1;
  }
  if (form.dataset.form === 'capture-point') {
    const draft = state.captureDrafts[form.dataset.messageId] || { pointType: 'REQUIREMENT', text: '' };
    draft[control.name] = control.value;
    state.captureDrafts[form.dataset.messageId] = draft;
  }
  if (form.dataset.form === 'replace-point') {
    const draft = state.replacementDrafts[form.dataset.pointId] || { pointType: 'REQUIREMENT', text: '' };
    draft[control.name] = control.value;
    state.replacementDrafts[form.dataset.pointId] = draft;
  }
  if (form.dataset.form === 'package' && state.packageDraft && Object.hasOwn(state.packageDraft, control.name)) {
    const approvalWasArmed = Boolean(state.approvalArmedVersionId);
    state.packageDraft[control.name] = control.value;
    state.packageDirty = true;
    disarmApproval();
    if (approvalWasArmed) {
      renderWorkspace({ keepFocus: true });
      return;
    }
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton && !hasUnresolvedPackageFields()) saveButton.textContent = 'Save draft';
    const discardButton = form.querySelector('[data-action="discard-package"]');
    if (discardButton) discardButton.disabled = false;
    const localStatus = header.querySelector('.local-status');
    if (localStatus) localStatus.textContent = 'Package edits unsaved';
  }
}

document.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const handlers = {
    project: submitProject,
    discussion: submitDiscussion,
    message: submitMessage,
    'capture-point': submitCapture,
    'replace-point': submitReplacement,
    package: () => savePackage(),
  };
  void handlers[form.dataset.form]?.(form);
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (isPackageMutationBusy() && [
    'review-approval',
    'cancel-approval',
    'confirm-approval',
    'discard-package',
    'retry-package-conflict',
    'resolve-package-field',
    'view-version',
    'carry-orphan-package',
    'discard-orphan-package',
    'next-version',
  ].includes(action)) return;
  if (action === 'new-project') {
    if (['loading', 'bootstrap-error'].includes(state.phase)) return;
    state.returnProjectId = state.projectId;
    location.hash = '#/new-project';
  }
  if (action === 'retry-bootstrap') void loadBootstrap();
  if (action === 'retry-room-list') {
    const projectHash = `#/projects/${state.projectId}`;
    if (location.hash === projectHash) void syncRoute();
    else location.hash = projectHash;
  }
  if (action === 'cancel-new-project') {
    if (isBusy('project')) return;
    clearOperation('project-submit');
    state.projectDraft = { name: '', repositoryRoot: '' };
    const projectId = state.returnProjectId || state.projectId;
    location.hash = projectId ? `#/projects/${projectId}` : '#/';
  }
  if (action === 'composer-mode') {
    state.composerMode = button.dataset.mode;
    state.composerRevision += 1;
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('#messageText')?.focus());
  }
  if (action === 'clear-composer') {
    if (isBusy('message')) return;
    clearOperationsForPrefix(`message:${state.discussionId}:`);
    state.composerDraft = { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' };
    state.composerRevision += 1;
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('#messageText')?.focus());
    announce('Composer cleared.');
  }
  if (action === 'toggle-capture') {
    if (isBusy(`capture:${button.dataset.messageId}`)) return;
    state.captureMessageId = state.captureMessageId === button.dataset.messageId ? '' : button.dataset.messageId;
    if (state.captureMessageId && !state.captureDrafts[state.captureMessageId]) {
      const message = state.detail.messages.find(item => item.id === state.captureMessageId);
      if (message) state.captureDrafts[state.captureMessageId] = captureDraft(message);
    }
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector(`#pointText-${CSS.escape(state.captureMessageId)}`)?.focus());
  }
  if (action === 'close-capture') {
    clearOperation(`capture:${state.captureMessageId}`);
    delete state.captureDrafts[state.captureMessageId];
    state.captureMessageId = '';
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'edit-point') {
    if (isBusy(`point:${button.dataset.pointId}`) || isBusy(`replace:${button.dataset.pointId}`)) return;
    state.editPointId = button.dataset.pointId;
    if (!state.replacementDrafts[state.editPointId]) {
      const point = state.detail.points.find(item => item.id === state.editPointId);
      if (point) state.replacementDrafts[state.editPointId] = { pointType: point.pointType, text: point.text };
    }
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector(`#editText-${CSS.escape(state.editPointId)}`)?.focus());
  }
  if (action === 'cancel-edit-point') {
    if (isBusy(`point:${state.editPointId}`) || isBusy(`replace:${state.editPointId}`)) return;
    clearOperation(`replace:${state.editPointId}`);
    delete state.replacementDrafts[state.editPointId];
    state.editPointId = '';
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'disposition') {
    const pointId = button.dataset.pointId;
    if (isBusy(`point:${pointId}`) || isBusy(`replace:${pointId}`)) return;
    const operationSlot = `disposition:${pointId}`;
    const target = `/api/planning-points/${encodeURIComponent(pointId)}/disposition`;
    const payload = { disposition: button.dataset.disposition, expectedVersion: Number(button.dataset.version) };
    void withMutation(`point:${pointId}`, () => api(target, {
      method: 'POST',
      body: { ...payload, idempotencyKey: operationKey(operationSlot, 'point-decision', { target, payload }) },
    }), { successMessage: `Planning point ${button.dataset.disposition.toLowerCase()}.`, operationSlot });
  }
  if (action === 'retry-run') {
    if (isBusy(`run:${button.dataset.runId}`)) return;
    const operationSlot = `retry:${button.dataset.runId}`;
    const target = `/api/agent-runs/${encodeURIComponent(button.dataset.runId)}/retry`;
    const payload = {};
    void withMutation(`run:${button.dataset.runId}`, () => api(target, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'run-retry', { target, payload }) },
    }), { successMessage: 'Contribution retry started with the preserved prompt.', operationSlot });
  }
  if (action === 'cancel-run') {
    if (isBusy(`run:${button.dataset.runId}`)) return;
    const operationSlot = `cancel:${button.dataset.runId}`;
    const target = `/api/agent-runs/${encodeURIComponent(button.dataset.runId)}/cancel`;
    const payload = {};
    void withMutation(`run:${button.dataset.runId}`, () => api(target, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'run-cancel', { target, payload }) },
    }), { operationSlot }).then(result => {
      if (!result) return;
      if (result.run.errorCode === 'CODEX_CLEANUP_PENDING') {
        announce('Cancellation requested. Andamento is confirming that the Codex turn stopped.', true);
      } else if (result.run.errorCode === 'CODEX_CLEANUP_UNCONFIRMED') {
        announce('Cancellation cleanup could not be confirmed; Codex is blocked in this room.', true);
      } else {
        announce('Contribution cancelled; its prompt remains available.');
      }
    });
  }
  if (action === 'prepare-package') {
    if (isBusy('prepare-package')) return;
    const operationSlot = `prepare:${state.discussionId}`;
    const target = `/api/discussions/${encodeURIComponent(state.discussionId)}/work-package`;
    const payload = {};
    void withMutation('prepare-package', () => api(target, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'package-prepare', { target, payload }) },
    }), { refresh: false, successMessage: 'Draft package prepared from accepted points.', operationSlot }).then(async result => {
      if (result) {
        state.viewedVersionId = result.version.id;
        state.rightTab = 'package';
        await refreshAfterCommittedMutation({ operationSlot });
      }
    });
  }
  if (action === 'review-approval') {
    const current = state.detail.workPackage?.currentVersion;
    if (!current || current.id !== button.dataset.versionId || current.status !== 'DRAFT') return;
    state.approvalArmedVersionId = current.id;
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('[data-action="confirm-approval"]')?.focus());
  }
  if (action === 'cancel-approval') {
    clearOperation(`package-approve:${state.approvalArmedVersionId}`);
    disarmApproval();
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('[data-action="review-approval"]')?.focus());
    announce('Approval checkpoint closed. The package remains a draft.');
  }
  if (action === 'confirm-approval') void approvePackage(button.dataset.versionId);
  if (action === 'carry-orphan-package') void carryOrphanedPackageDraft();
  if (action === 'discard-orphan-package') {
    state.packageOrphan = null;
    state.packageOrphanFocusPending = false;
    renderWorkspace({ keepFocus: true });
    announce('Held package edits discarded; approved versions remain unchanged.');
  }
  if (action === 'discard-package') {
    const discardedVersionId = state.detail.workPackage?.currentVersion?.id || state.packageDraftVersionId;
    clearOperation(`package-save:${discardedVersionId}`);
    clearOperation(`package-approve:${discardedVersionId}`);
    if (state.packageConflict?.current) applyPackageVersionToDetail(state.packageConflict.current);
    state.packageDraftVersionId = '';
    state.packageDraft = null;
    state.packageBase = null;
    state.packageBaseRowVersion = null;
    state.packageDirty = false;
    state.packageConflict = null;
    disarmApproval();
    syncPackageDraft();
    renderWorkspace({ keepFocus: true });
    announce('Undurable package edits discarded.');
  }
  if (action === 'retry-package-conflict') {
    const current = state.packageConflict?.current;
    if (!current || !state.packageDraft || !state.packageBase) return;
    const localDraft = { ...state.packageDraft };
    const priorBase = { ...state.packageBase };
    installRebasedPackageDraft({ localDraft, priorBase, current });
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('.field-collision [data-action="resolve-package-field"]')?.focus({ preventScroll: true }));
  }
  if (action === 'resolve-package-field') {
    const name = button.dataset.field;
    const conflict = state.packageConflict?.fieldConflicts?.[name];
    if (!conflict || !Object.hasOwn(state.packageDraft, name)) return;
    state.packageDraft[name] = button.dataset.choice === 'local' ? conflict.local : conflict.latest;
    delete state.packageConflict.fieldConflicts[name];
    state.packageDirty = Object.keys(state.packageDraft).some(field => state.packageDraft[field] !== state.packageBase[field]);
    disarmApproval();
    state.packageConflict.message = hasUnresolvedPackageFields()
      ? 'Resolve every field that changed in both views before saving.'
      : 'All field conflicts are resolved. Review the combined draft, then save.';
    const hasRemainingCollisions = hasUnresolvedPackageFields();
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => {
      const nextCollisionAction = hasRemainingCollisions
        ? document.querySelector('.field-collision [data-action="resolve-package-field"]')
        : null;
      (nextCollisionAction || document.getElementById(`package-${name}`))?.focus({ preventScroll: true });
    });
  }
  if (action === 'refresh-after-conflict') {
    void refreshDiscussion({ keepFocus: true }).then(applied => {
      if (!applied || !state.feedback?.details?.current) return;
      clearFeedback();
      renderHeader();
      renderWorkspace({ keepFocus: true });
    }).catch(() => reportDisplayRefreshFailure());
  }
  if (action === 'reconcile-unconfirmed') {
    if (state.phase === 'workspace') {
      void refreshDiscussion({ keepFocus: true }).catch(() => reportDisplayRefreshFailure());
    } else if (state.phase === 'project') void syncRoute();
    else void loadBootstrap();
  }
  if (action === 'view-version') {
    disarmApproval();
    state.viewedVersionId = button.dataset.versionId;
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'next-version') {
    disarmApproval();
    const operationSlot = `next-version:${button.dataset.versionId}`;
    const target = `/api/work-package-versions/${encodeURIComponent(button.dataset.versionId)}/next-version`;
    const payload = {};
    void withMutation('next-version', () => api(target, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'package-next', { target, payload }) },
    }), { refresh: false, successMessage: 'New draft version created; the approved version remains unchanged.', operationSlot }).then(async result => {
      if (result) {
        state.viewedVersionId = result.version.id;
        await refreshAfterCommittedMutation({ operationSlot });
      }
    });
  }
  if (action === 'dispatch-execution') {
    if (isBusy('dispatch-execution')) return;
    const versionId = button.dataset.versionId;
    const operationSlot = `dispatch:${versionId}:${button.dataset.adapter}`;
    const target = `/api/work-package-versions/${encodeURIComponent(versionId)}/execution-runs`;
    const payload = { adapter: button.dataset.adapter };
    void withMutation('dispatch-execution', () => api(target, {
      method: 'POST',
      body: { ...payload, idempotencyKey: operationKey(operationSlot, 'execution-dispatch', { target, payload }) },
    }), {
      successMessage: 'Execution dispatched. Nothing is written until you say so.',
      operationSlot,
    });
  }
  if (action === 'cancel-execution') {
    const runId = button.dataset.runId;
    if (isBusy(`execution:${runId}`)) return;
    const operationSlot = `cancel-execution:${runId}`;
    const target = `/api/execution-runs/${encodeURIComponent(runId)}/cancel`;
    void withMutation(`execution:${runId}`, () => api(target, {
      method: 'POST',
      body: { idempotencyKey: operationKey(operationSlot, 'execution-cancel', { target, payload: {} }) },
    }), { successMessage: 'Execution cancelled.', operationSlot });
  }
  if (action === 'right-tab') {
    state.rightTab = button.dataset.tab;
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector(`[data-action="right-tab"][data-tab="${state.rightTab}"]`)?.focus());
  }
  if (action === 'lineage-message') {
    const targetId = `message-${button.dataset.messageId}`;
    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
      announce('Source contribution in view.');
    });
  }
  if (action === 'lineage-point') {
    state.pointFilter = 'ALL';
    state.rightTab = 'decisions';
    const targetId = `point-${button.dataset.pointId}`;
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
      announce('Sourced planning point in view.');
    });
  }
  if (action === 'lineage-package') {
    state.rightTab = 'package';
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => {
      const target = document.querySelector('#packageStation .package-sheet, #packageStation .package-empty');
      target?.scrollIntoView({ block: 'start' });
      document.querySelector('#packageStation')?.focus({ preventScroll: true });
      announce('Current work package in view.');
    });
  }
  if (action === 'refresh-capabilities') {
    void withMutation('capabilities', () => requestBootstrap(), {
      refresh: false,
      unconfirmedSource: 'action',
    }).then(result => {
      if (!result) return;
      state.bootstrap = result;
      state.projects = result.projects;
      renderHeader();
      renderWorkspace({ keepFocus: true });
      announce('Provider capabilities checked.');
    });
  }
});

document.addEventListener('change', event => {
  updateDraftFromControl(event.target);
  if (event.target.id === 'headerProject') {
    const projectId = event.target.value;
    if (projectId) location.hash = `#/projects/${projectId}`;
  }
  if (event.target.id === 'pointFilter') {
    state.pointFilter = event.target.value;
    renderWorkspace({ keepFocus: true });
  }
});

document.addEventListener('input', event => {
  updateDraftFromControl(event.target);
});

document.addEventListener('keydown', event => {
  const tab = event.target.closest('[role="tab"][data-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const order = ['decisions', 'package'];
  const current = order.indexOf(tab.dataset.tab);
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? order.length - 1
      : event.key === 'ArrowLeft' ? (current - 1 + order.length) % order.length
        : (current + 1) % order.length;
  state.rightTab = order[next];
  renderWorkspace({ keepFocus: true });
  requestAnimationFrame(() => document.querySelector(`[role="tab"][data-tab="${state.rightTab}"]`)?.focus());
});

window.addEventListener('hashchange', () => void syncRoute());
matchMedia('(max-width: 1279px)').addEventListener('change', applyResponsiveStationVisibility);

void loadBootstrap();
