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
  discussionId: '',
  detail: null,
  feedback: null,
  busy: new Set(),
  composerMode: 'owner',
  projectDraft: { name: '', repositoryRoot: '' },
  discussionDraft: { title: '' },
  composerDraft: { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' },
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
  approvalArmedVersionId: '',
  viewedVersionId: '',
  pollTimer: null,
  routeGeneration: 0,
  mutationKeys: new Map(),
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

function operationKey(slot, prefix) {
  if (!state.mutationKeys.has(slot)) state.mutationKeys.set(slot, idempotencyKey(prefix));
  return state.mutationKeys.get(slot);
}

function completeOperation(slot) {
  if (slot) state.mutationKeys.delete(slot);
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

function announce(message, assertive = false) {
  const region = assertive ? assertiveRegion : liveRegion;
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

function setBusy(key, value) {
  if (value) state.busy.add(key);
  else state.busy.delete(key);
}

function isBusy(key) {
  return state.busy.has(key);
}

function setFeedback(message, tone = 'error', details = undefined) {
  state.feedback = { message, tone, details };
  announce(message, tone === 'error');
}

function clearFeedback() {
  state.feedback = null;
}

function feedbackMarkup(feedback = state.feedback) {
  if (!feedback) return '';
  const gaps = Array.isArray(feedback.details?.gaps)
    ? `<span>Missing: ${feedback.details.gaps.map(escapeHtml).join(', ')}.</span>` : '';
  const recovery = feedback.details?.current
    ? '<button type="button" data-action="refresh-after-conflict">Refresh saved state</button>' : '';
  return `<div class="feedback" data-tone="${escapeHtml(feedback.tone)}" role="${feedback.tone === 'error' ? 'alert' : 'status'}"><strong>${escapeHtml(feedback.message)}</strong>${gaps}${recovery}</div>`;
}

function registrationMark() {
  return `<span class="registration-mark">${icon('mark')}</span>`;
}

function renderHeader() {
  const project = state.projects.find(item => item.id === state.projectId);
  const discussion = state.detail?.discussion;
  const projectOptions = state.projects.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === state.projectId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  const roomValue = discussion && project
    ? `<a class="header-value" href="#/projects/${escapeHtml(project.id)}" aria-label="Return to ${escapeHtml(project.name)} room list">${escapeHtml(discussion.title)}</a>`
    : `<span class="header-value">${escapeHtml(project ? 'Project register' : 'First registration')}</span>`;
  const localState = state.busy.size ? 'Saving locally…'
    : state.packageDirty ? 'Package edits unsaved'
      : state.feedback?.tone === 'error' ? 'Action needs attention' : 'Local service ready';
  header.innerHTML = `
    <a class="brand" href="${project ? `#/projects/${escapeHtml(project.id)}` : '#/'}" aria-label="Andamento home">${registrationMark()}<span>Andamento</span></a>
    <div class="header-cell project-cell">
      <span class="header-label">Project</span>
      ${state.projects.length
        ? `<select class="header-project-select" id="headerProject" aria-label="Current project"><option value="">Select project</option>${projectOptions}</select>`
        : '<span class="header-value">No project registered</span>'}
    </div>
    <div class="header-cell room-cell">
      <span class="header-label">Room</span>
      ${roomValue}
    </div>
    <div class="header-actions">
      <span class="local-status">${escapeHtml(localState)}</span>
      <button type="button" class="icon-button" data-action="new-project" aria-label="Register another project" title="Register another project">${icon('plus')}</button>
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

function renderNewProject() {
  const firstRun = state.projects.length === 0;
  app.innerHTML = `
    <section class="onboarding" aria-labelledby="registrationTitle">
      ${registrationMark()}
      <h1 id="registrationTitle">${firstRun ? 'Start with the work' : 'Register another project'}</h1>
      <p class="onboarding-intro">Andamento keeps planning discussion, owner decisions, and approved work packages together on this machine. Register one local Git repository; nothing is pushed or executed by this step.</p>
      ${feedbackMarkup()}
      <form class="registration-line" data-form="project" novalidate>
        <div class="field">
          <label for="projectName">Project name</label>
          <input id="projectName" name="name" type="text" required maxlength="80" autocomplete="off" value="${escapeHtml(state.projectDraft.name)}" placeholder="My product">
        </div>
        <div class="field">
          <label for="repositoryRoot">Local Git repository</label>
          <input id="repositoryRoot" name="repositoryRoot" type="text" required maxlength="1000" autocomplete="off" value="${escapeHtml(state.projectDraft.repositoryRoot)}" placeholder="C:\\development\\project">
          <p class="field-help">The service validates the directory and records it as this project's allowed root.</p>
        </div>
        <button class="primary-action" type="submit" ${isBusy('project') ? 'disabled' : ''}>${isBusy('project') ? 'Registering…' : 'Register project'}</button>
      </form>
      ${firstRun ? '<p class="lineage-footnote">Local service · SQLite WAL · no provider connection required</p>' : '<button type="button" class="text-action" data-action="cancel-new-project">Return to current project</button>'}
    </section>`;
}

function renderProjectRegister() {
  const project = state.projects.find(item => item.id === state.projectId);
  if (!project) return renderNewProject();
  const roomRows = state.discussions.length
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
          <input id="roomTitle" name="title" type="text" required maxlength="120" autocomplete="off" value="${escapeHtml(state.discussionDraft.title)}" placeholder="Plan a durable capability">
        </div>
        <button class="primary-action" type="submit" ${isBusy('discussion') ? 'disabled' : ''}>${isBusy('discussion') ? 'Opening…' : 'Open room'}</button>
      </form>
    </section>`;
}

function messageMarkup(message) {
  const isCapture = state.captureMessageId === message.id;
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
          <button type="button" data-action="toggle-capture" data-message-id="${escapeHtml(message.id)}" aria-label="Capture point" aria-expanded="${isCapture}" aria-controls="capture-${escapeHtml(message.id)}">
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
  return `
    <form class="capture-form" id="capture-${escapeHtml(message.id)}" data-form="capture-point" data-message-id="${escapeHtml(message.id)}">
      <div class="field">
        <label for="pointType-${escapeHtml(message.id)}">Point type</label>
        <select id="pointType-${escapeHtml(message.id)}" name="pointType">${pointTypeOptions(draft.pointType)}</select>
      </div>
      <div class="field">
        <label for="pointText-${escapeHtml(message.id)}">Proposed planning point</label>
        <textarea id="pointText-${escapeHtml(message.id)}" name="text" required maxlength="2000">${escapeHtml(draft.text)}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="text-action" data-action="close-capture">Cancel</button>
        <button type="submit" class="primary-action" ${isBusy(`capture:${message.id}`) ? 'disabled' : ''}>Add proposal</button>
      </div>
    </form>`;
}

function runMarkup(run) {
  if (run.status === 'COMPLETED') return '';
  const canRetry = ['FAILED', 'INTERRUPTED'].includes(run.status);
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
          ${canRetry ? `<p class="source-summary">Prompt preserved: ${escapeHtml(run.prompt)}</p>` : ''}
        </div>
        <div class="message-actions">
          ${run.status === 'RUNNING'
            ? `<button type="button" data-action="cancel-run" data-run-id="${escapeHtml(run.id)}">${icon('stop')}<span class="visually-hidden">Cancel contribution</span></button>`
            : `<button type="button" data-action="retry-run" data-run-id="${escapeHtml(run.id)}" aria-label="Retry">${icon('retry')}<span class="button-label"> Retry</span></button>`}
        </div>
      </article>
    </li>`;
}

function composerMarkup() {
  const capabilities = state.bootstrap.capabilities;
  const modes = [
    { id: 'owner', label: 'Owner note', disabled: false },
    { id: 'codex', label: 'Ask Codex', disabled: !capabilities.codex.available, reason: capabilities.codex.reason },
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
  const capabilityNote = !capabilities.codex.available
    ? `<div class="capability-note" role="status"><span>Codex is unavailable: ${escapeHtml(capabilities.codex.reason)} Import attributed input to keep planning.</span><button type="button" data-action="refresh-capabilities" ${isBusy('capabilities') ? 'disabled' : ''}>${isBusy('capabilities') ? 'Checking…' : 'Check bridge again'}</button></div>` : '';
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
            <button type="button" class="text-action" data-action="clear-composer">Cancel</button>
            <button type="submit" class="primary-action" ${isBusy('message') ? 'disabled' : ''}>${isBusy('message') ? 'Adding…' : state.composerMode === 'owner' || state.composerMode === 'imported' ? 'Add to discussion' : 'Request contribution'}</button>
          </div>
        </div>
      </form>
    </section>`;
}

function decisionMarkup(point, index) {
  const editing = state.editPointId === point.id;
  const proposed = point.disposition === 'PROPOSED';
  const editDraft = state.replacementDrafts[point.id] || { pointType: point.pointType, text: point.text };
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
          <button type="button" data-action="disposition" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}" data-disposition="ACCEPTED">Accept</button>
          <button type="button" data-action="disposition" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}" data-disposition="DEFERRED">Defer</button>
          <button type="button" data-action="disposition" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}" data-disposition="REJECTED">Reject</button>
        </div>
        <button type="button" class="point-edit-action" data-action="edit-point" data-point-id="${escapeHtml(point.id)}">Edit proposal</button>
      </div>` : ''}
      ${editing ? `
        <form class="point-edit-form" data-form="replace-point" data-point-id="${escapeHtml(point.id)}" data-version="${point.rowVersion}">
          <div class="field"><label for="editType-${escapeHtml(point.id)}">Point type</label><select id="editType-${escapeHtml(point.id)}" name="pointType">${pointTypeOptions(editDraft.pointType)}</select></div>
          <div class="field"><label for="editText-${escapeHtml(point.id)}">Replacement proposal</label><textarea id="editText-${escapeHtml(point.id)}" name="text" maxlength="2000" required>${escapeHtml(editDraft.text)}</textarea></div>
          <div class="form-actions"><button type="button" class="text-action" data-action="cancel-edit-point">Cancel</button><button class="primary-action" type="submit">Create replacement</button></div>
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

function applyPackageVersionToDetail(version) {
  const workPackage = state.detail?.workPackage;
  if (!workPackage || !version) return;
  workPackage.currentVersion = version;
  workPackage.versions = workPackage.versions.map(item => item.id === version.id ? version : item);
}

function syncPackageDraft() {
  const current = state.detail?.workPackage?.currentVersion;
  if (!current || current.status !== 'DRAFT') {
    state.packageDraft = null;
    state.packageBase = null;
    state.packageBaseRowVersion = null;
    state.packageDraftVersionId = '';
    state.packageDirty = false;
    state.packageConflict = null;
    disarmApproval();
    return;
  }
  if (state.packageDraftVersionId === current.id && state.packageDraft) {
    if (state.packageBaseRowVersion === current.rowVersion) return;
    disarmApproval();
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

function packageField(label, name, help = '') {
  const value = state.packageDraft?.[name] || '';
  const locked = isBusy('package-save') || isBusy('package-approve');
  return `
    <div class="package-field" data-field="${escapeHtml(name)}">
      <label class="field-label" for="package-${escapeHtml(name)}">${escapeHtml(label)}</label>
      <textarea id="package-${escapeHtml(name)}" name="${escapeHtml(name)}" ${name === 'outcome' ? 'maxlength="4000"' : 'maxlength="12000"'} placeholder="${name === 'exclusions' ? 'State an explicit exclusion, or write None for this package.' : ''}" ${locked ? 'disabled' : ''}>${escapeHtml(value)}</textarea>
      ${help ? `<p class="field-help">${escapeHtml(help)}</p>` : ''}
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

function packageStationMarkup() {
  const acceptedCount = state.detail.points.filter(point => point.disposition === 'ACCEPTED').length;
  const workPackage = state.detail.workPackage;
  if (!workPackage) {
    return `
      <section class="package-station" id="packageStation" role="tabpanel" aria-labelledby="packageTab packageTitle" tabindex="-1">
        <div class="station-head"><div class="station-title"><h2 id="packageTitle">Work package</h2><span class="station-meta">Not prepared</span></div></div>
        <div class="package-scroll"><div class="package-empty">
          <h3>Collect accepted points</h3>
          <p>${acceptedCount ? `${acceptedCount} accepted point${acceptedCount === 1 ? ' is' : 's are'} ready to become a bounded package.` : 'Accept at least one planning point before preparing a package.'}</p>
          <button type="button" class="primary-action" data-action="prepare-package" ${acceptedCount ? '' : 'disabled'}>${icon('package')} Prepare package</button>
        </div></div>
      </section>`;
  }

  const versions = workPackage.versions;
  const selected = versions.find(version => version.id === state.viewedVersionId) || workPackage.currentVersion;
  if (!selected) return '';
  const history = versions.map(version => `<button type="button" data-action="view-version" data-version-id="${escapeHtml(version.id)}" aria-current="${selected.id === version.id}">v${version.versionNumber} · ${version.status === 'DRAFT' ? 'Draft' : 'Approved'}</button>`).join('');
  const approval = workPackage.approvals.find(item => item.workPackageVersionId === selected.id);
  const isApprovalArmed = state.approvalArmedVersionId === selected.id;
  const completeness = packageCompleteness(state.packageDraft || draftFromPackageContent(selected.content));
  const ownerName = state.bootstrap?.owner?.displayName || 'Owner';
  const fieldConflicts = state.packageConflict?.fieldConflicts || {};
  const collisionMarkup = Object.entries(fieldConflicts).map(([name, values]) => `
    <section class="field-collision" aria-labelledby="collision-${escapeHtml(name)}">
      <strong id="collision-${escapeHtml(name)}">${escapeHtml(packageFieldLabel(name))} changed in both views</strong>
      <div class="collision-values"><div><span>Yours</span><pre>${escapeHtml(values.local || '(empty)')}</pre></div><div><span>Latest saved</span><pre>${escapeHtml(values.latest || '(empty)')}</pre></div></div>
      <div class="feedback-actions"><button type="button" data-action="resolve-package-field" data-field="${escapeHtml(name)}" data-choice="local">Keep yours</button><button type="button" data-action="resolve-package-field" data-field="${escapeHtml(name)}" data-choice="latest">Use latest</button></div>
    </section>`).join('');
  const conflictMarkup = state.packageConflict ? `
    <div class="feedback" data-tone="warning" role="alert">
      <strong>${escapeHtml(state.packageConflict.message)}</strong>
      <span>Your entered package text is still here.</span>
      ${collisionMarkup}
      ${state.packageConflict.rebased && !hasUnresolvedPackageFields() ? '<span>All changed fields are resolved. Review the combined draft, then save.</span>' : ''}
      <div class="feedback-actions">${state.packageConflict.rebased ? '' : '<button type="button" data-action="retry-package-conflict">Compare and reapply changes</button>'}<button type="button" data-action="discard-package">Use latest saved version</button></div>
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
            <button type="button" class="text-action" data-action="discard-package" ${state.packageDirty ? '' : 'disabled'}>Discard edits</button>
            <button type="submit" ${isBusy('package-save') || hasUnresolvedPackageFields() ? 'disabled' : ''}>${isBusy('package-save') ? 'Saving…' : hasUnresolvedPackageFields() ? 'Resolve conflicts to save' : state.packageDirty ? 'Save draft' : 'Draft saved'}</button>
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
                <button type="button" class="text-action" data-action="cancel-approval">Continue reviewing</button>
                <button type="button" class="approval-action" data-action="confirm-approval" data-version-id="${escapeHtml(selected.id)}" ${isBusy('package-approve') || hasUnresolvedPackageFields() ? 'disabled' : ''}>${isBusy('package-approve') ? 'Recording approval…' : hasUnresolvedPackageFields() ? 'Resolve conflicts first' : `Confirm approval of v${selected.versionNumber}`} ${icon('arrow')}</button>
              </div>
            </section>` : `
            <button type="button" class="approval-action" data-action="review-approval" data-version-id="${escapeHtml(selected.id)}" ${isBusy('package-approve') || hasUnresolvedPackageFields() ? 'disabled' : ''}>${hasUnresolvedPackageFields() ? 'Resolve conflicts before approval' : `Review approval of v${selected.versionNumber}`} ${icon('arrow')}</button>
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
        ${selected.id === workPackage.currentVersion.id && !versions.some(version => version.status === 'DRAFT')
          ? `<button type="button" class="primary-action" data-action="next-version" data-version-id="${escapeHtml(selected.id)}">Create version ${selected.versionNumber + 1} draft</button>` : ''}
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
  if (keepFocus) restoreFocusedControl(focusSnapshot);
  else app.focus({ preventScroll: true });
  schedulePoll();
}

function render() {
  renderHeader();
  if (state.phase === 'loading') renderLoading();
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
  state.composerMode = 'owner';
  state.composerDraft = { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' };
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
  state.approvalArmedVersionId = '';
  state.viewedVersionId = '';
  state.mutationKeys.clear();
}

function detailFingerprint(detail) {
  return JSON.stringify({
    messages: detail.messages.map(message => message.id),
    runs: detail.runs.map(run => [run.id, run.status, run.rowVersion]),
    points: detail.points.map(point => [point.id, point.disposition, point.rowVersion]),
    versions: detail.workPackage?.versions.map(version => [version.id, version.status, version.rowVersion]) || [],
    approvals: detail.workPackage?.approvals.map(approval => approval.id) || [],
  });
}

async function loadBootstrap() {
  state.phase = 'loading';
  render();
  try {
    state.bootstrap = await api('/api/bootstrap');
    state.projects = state.bootstrap.projects;
    await syncRoute();
  } catch (error) {
    state.phase = 'new-project';
    setFeedback(error.message, 'error');
    render();
  }
}

async function syncRoute() {
  const generation = ++state.routeGeneration;
  clearTimeout(state.pollTimer);
  const route = parseRoute();
  const nextDiscussionId = route.name === 'discussion' ? route.discussionId : '';
  const nextProjectId = ['project', 'discussion'].includes(route.name) ? route.projectId : state.projectId;
  if (state.discussionId && state.discussionId !== nextDiscussionId) resetWorkspaceTransient();
  if (state.projectId && nextProjectId && state.projectId !== nextProjectId) state.discussionDraft = { title: '' };
  clearFeedback();
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
    setFeedback('That project is no longer available.', 'error');
    location.replace(`#/projects/${state.projects[0].id}`);
    return;
  }
  state.projectId = project.id;
  state.phase = 'loading';
  render();
  if (route.name === 'project') {
    state.discussionId = '';
    state.detail = null;
    try {
      const result = await api(`/api/projects/${encodeURIComponent(project.id)}/discussions`);
      if (generation !== state.routeGeneration) return;
      state.discussions = result.discussions;
      state.phase = 'project';
      render();
    } catch (error) {
      setFeedback(error.message, 'error', error.details);
      state.phase = 'project';
      render();
    }
    return;
  }
  state.discussionId = route.discussionId;
  try {
    const detail = await api(`/api/discussions/${encodeURIComponent(route.discussionId)}`);
    if (generation !== state.routeGeneration) return;
    if (detail.project.id !== project.id) throw new ApiError(404, { error: { code: 'NOT_FOUND', message: 'That planning room does not belong to this project.' } });
    state.detail = detail;
    state.phase = 'workspace';
    state.captureMessageId = '';
    state.editPointId = '';
    state.viewedVersionId = state.detail.workPackage?.currentVersion?.id || '';
    syncPackageDraft();
    render();
  } catch (error) {
    if (generation !== state.routeGeneration) return;
    setFeedback(error.message, 'error', error.details);
    state.phase = 'project';
    state.discussionId = '';
    state.detail = null;
    const fallback = await api(`/api/projects/${encodeURIComponent(project.id)}/discussions`);
    if (generation !== state.routeGeneration) return;
    state.discussions = fallback.discussions;
    render();
  }
}

async function refreshDiscussion({ keepFocus = true } = {}) {
  const discussionId = state.discussionId;
  if (!discussionId) return;
  const detail = await api(`/api/discussions/${encodeURIComponent(discussionId)}`);
  if (state.discussionId !== discussionId || state.phase !== 'workspace') return;
  state.detail = detail;
  renderHeader();
  renderWorkspace({ keepFocus });
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  if (state.phase !== 'workspace' || !state.detail?.runs.some(run => run.status === 'RUNNING')) return;
  const discussionId = state.discussionId;
  state.pollTimer = setTimeout(async () => {
    try {
      const priorFingerprint = detailFingerprint(state.detail);
      const detail = await api(`/api/discussions/${encodeURIComponent(discussionId)}`);
      if (state.discussionId !== discussionId || state.phase !== 'workspace') return;
      const changed = detailFingerprint(detail) !== priorFingerprint;
      if (changed || !detail.runs.some(run => run.status === 'RUNNING')) {
        state.detail = detail;
        renderHeader();
        renderWorkspace({ keepFocus: true });
      } else schedulePoll();
    } catch (error) {
      setFeedback(error.message, 'error', error.details);
      renderWorkspace({ keepFocus: true });
    }
  }, 450);
}

async function withMutation(key, callback, {
  refresh = true,
  successMessage = '',
  operationSlot = '',
  contextDiscussionId = undefined,
  allowDetachedResult = false,
} = {}) {
  if (isBusy(key)) return null;
  const boundDiscussionId = contextDiscussionId === undefined && state.phase === 'workspace'
    ? state.discussionId : contextDiscussionId;
  const isCurrentContext = () => !boundDiscussionId
    || (state.phase === 'workspace' && state.discussionId === boundDiscussionId);
  setBusy(key, true);
  clearFeedback();
  if (state.phase === 'workspace') {
    renderHeader();
    renderWorkspace({ keepFocus: true });
  } else render();
  try {
    const result = await callback();
    completeOperation(operationSlot);
    setBusy(key, false);
    if (!isCurrentContext() && !allowDetachedResult) {
      announce('The action finished in the planning room you left.');
      return null;
    }
    if (successMessage && isCurrentContext()) announce(successMessage);
    if (refresh && isCurrentContext()) await refreshDiscussion();
    return result;
  } catch (error) {
    setBusy(key, false);
    if (!isCurrentContext()) {
      announce('An action in the planning room you left did not complete.', true);
      return null;
    }
    setFeedback(error.message, 'error', error.details);
    if (state.phase === 'workspace') renderWorkspace({ keepFocus: true });
    else render();
    return null;
  }
}

async function submitProject(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const operationSlot = 'project-submit';
  const values = { name: data.get('name'), repositoryRoot: data.get('repositoryRoot'), idempotencyKey: operationKey(operationSlot, 'project') };
  const result = await withMutation('project', () => api('/api/projects', { method: 'POST', body: values }), { refresh: false, successMessage: 'Project registered locally.', operationSlot });
  if (!result) return;
  state.projectDraft = { name: '', repositoryRoot: '' };
  state.bootstrap = await api('/api/bootstrap');
  state.projects = state.bootstrap.projects;
  location.hash = `#/projects/${result.project.id}`;
}

async function submitDiscussion(form) {
  if (!form.reportValidity()) return;
  const title = new FormData(form).get('title');
  const operationSlot = `discussion:${state.projectId}`;
  const result = await withMutation('discussion', () => api(`/api/projects/${encodeURIComponent(state.projectId)}/discussions`, {
    method: 'POST', body: { title, idempotencyKey: operationKey(operationSlot, 'discussion') },
  }), { refresh: false, successMessage: 'Planning room opened.', operationSlot });
  if (result) {
    state.discussionDraft = { title: '' };
    location.hash = `#/projects/${state.projectId}/discussions/${result.discussion.id}`;
  }
}

async function submitMessage(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const content = data.get('content');
  const mode = state.composerMode;
  const key = 'message';
  const operationSlot = `message:${state.discussionId}:${mode}`;
  let request;
  if (mode === 'owner' || mode === 'imported') {
    request = () => api(`/api/discussions/${encodeURIComponent(state.discussionId)}/messages`, {
      method: 'POST',
      body: {
        contributionType: mode === 'owner' ? 'OWNER' : 'IMPORTED',
        content,
        displayName: data.get('displayName'),
        provider: data.get('provider'),
        model: data.get('model'),
        idempotencyKey: operationKey(operationSlot, 'message'),
      },
    });
  } else {
    request = () => api(`/api/discussions/${encodeURIComponent(state.discussionId)}/agent-runs`, {
      method: 'POST',
      body: { adapter: mode, prompt: content, idempotencyKey: operationKey(operationSlot, 'agent-run') },
    });
  }
  const result = await withMutation(key, request, { refresh: false, successMessage: mode === 'owner' || mode === 'imported' ? 'Contribution added.' : 'Planning participant started.', operationSlot });
  if (result) {
    state.composerDraft = { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' };
    await refreshDiscussion();
  }
}

async function submitCapture(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const messageId = form.dataset.messageId;
  const key = `capture:${messageId}`;
  const operationSlot = `capture:${messageId}`;
  const result = await withMutation(key, () => api(`/api/messages/${encodeURIComponent(messageId)}/planning-points`, {
    method: 'POST',
    body: { pointType: data.get('pointType'), text: data.get('text'), idempotencyKey: operationKey(operationSlot, 'point') },
  }), { refresh: false, successMessage: 'Planning point proposed for owner decision.', operationSlot });
  if (result) {
    state.captureMessageId = '';
    delete state.captureDrafts[messageId];
    await refreshDiscussion();
  }
}

async function submitReplacement(form) {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const pointId = form.dataset.pointId;
  const operationSlot = `replace:${pointId}`;
  const result = await withMutation(`replace:${pointId}`, () => api(`/api/planning-points/${encodeURIComponent(pointId)}/replacement`, {
    method: 'POST',
    body: {
      pointType: data.get('pointType'),
      text: data.get('text'),
      expectedVersion: Number(form.dataset.version),
      idempotencyKey: operationKey(operationSlot, 'point-replacement'),
    },
  }), { refresh: false, successMessage: 'Replacement proposal created; the earlier proposal remains in history.', operationSlot });
  if (result) {
    state.editPointId = '';
    delete state.replacementDrafts[pointId];
    await refreshDiscussion();
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
  const result = await withMutation('package-save', () => api(`/api/work-package-versions/${encodeURIComponent(current.id)}`, {
    method: 'PUT',
    body: { content: contentFromPackageDraft(draftSnapshot), expectedVersion: expected, idempotencyKey: operationKey(operationSlot, 'package-save') },
  }), { refresh: false, operationSlot, contextDiscussionId: discussionId, allowDetachedResult: true });
  if (!result) {
    if (state.discussionId === discussionId && state.feedback?.details?.current) {
      const current = state.feedback.details.current;
      applyPackageVersionToDetail(current);
      state.packageConflict = { message: state.feedback.message, current };
      renderWorkspace({ keepFocus: true });
    }
    return null;
  }
  const contextCurrent = state.phase === 'workspace'
    && state.discussionId === discussionId
    && state.detail.workPackage?.currentVersion?.id === versionId;
  if (!contextCurrent) return { version: result.version, contextCurrent: false };
  applyPackageVersionToDetail(result.version);
  state.packageDirty = false;
  state.packageDraft = { ...draftSnapshot };
  state.packageBase = { ...draftSnapshot };
  state.packageBaseRowVersion = result.version.rowVersion;
  state.packageConflict = null;
  announce('Package draft saved locally.');
  if (refresh) await refreshDiscussion();
  return { version: result.version, contextCurrent: true };
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
    current = saved.version;
  }
  if (state.discussionId !== discussionId || current.id !== versionId) return;
  const operationSlot = `package-approve:${current.id}`;
  const result = await withMutation('package-approve', () => api(`/api/work-package-versions/${encodeURIComponent(current.id)}/approve`, {
    method: 'POST',
    body: { expectedVersion: current.rowVersion, idempotencyKey: operationKey(operationSlot, 'package-approve') },
  }), { successMessage: 'Package version approved and locked. No execution was dispatched.', operationSlot });
  if (result) state.viewedVersionId = result.version.id;
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
  if (action === 'new-project') {
    state.returnProjectId = state.projectId;
    location.hash = '#/new-project';
  }
  if (action === 'cancel-new-project') {
    state.projectDraft = { name: '', repositoryRoot: '' };
    const projectId = state.returnProjectId || state.projectId;
    location.hash = projectId ? `#/projects/${projectId}` : '#/';
  }
  if (action === 'composer-mode') {
    state.composerMode = button.dataset.mode;
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('#messageText')?.focus());
  }
  if (action === 'clear-composer') {
    state.composerDraft = { content: '', displayName: 'Claude', provider: 'Anthropic', model: '' };
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('#messageText')?.focus());
    announce('Composer cleared.');
  }
  if (action === 'toggle-capture') {
    state.captureMessageId = state.captureMessageId === button.dataset.messageId ? '' : button.dataset.messageId;
    if (state.captureMessageId && !state.captureDrafts[state.captureMessageId]) {
      const message = state.detail.messages.find(item => item.id === state.captureMessageId);
      if (message) state.captureDrafts[state.captureMessageId] = captureDraft(message);
    }
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector(`#pointText-${CSS.escape(state.captureMessageId)}`)?.focus());
  }
  if (action === 'close-capture') {
    delete state.captureDrafts[state.captureMessageId];
    state.captureMessageId = '';
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'edit-point') {
    state.editPointId = button.dataset.pointId;
    if (!state.replacementDrafts[state.editPointId]) {
      const point = state.detail.points.find(item => item.id === state.editPointId);
      if (point) state.replacementDrafts[state.editPointId] = { pointType: point.pointType, text: point.text };
    }
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector(`#editText-${CSS.escape(state.editPointId)}`)?.focus());
  }
  if (action === 'cancel-edit-point') {
    delete state.replacementDrafts[state.editPointId];
    state.editPointId = '';
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'disposition') {
    const pointId = button.dataset.pointId;
    const operationSlot = `disposition:${pointId}`;
    void withMutation(`point:${pointId}`, () => api(`/api/planning-points/${encodeURIComponent(pointId)}/disposition`, {
      method: 'POST',
      body: { disposition: button.dataset.disposition, expectedVersion: Number(button.dataset.version), idempotencyKey: operationKey(operationSlot, 'point-decision') },
    }), { successMessage: `Planning point ${button.dataset.disposition.toLowerCase()}.`, operationSlot });
  }
  if (action === 'retry-run') {
    const operationSlot = `retry:${button.dataset.runId}`;
    void withMutation(`run:${button.dataset.runId}`, () => api(`/api/agent-runs/${encodeURIComponent(button.dataset.runId)}/retry`, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'run-retry') },
    }), { successMessage: 'Contribution retry started with the preserved prompt.', operationSlot });
  }
  if (action === 'cancel-run') {
    const operationSlot = `cancel:${button.dataset.runId}`;
    void withMutation(`run:${button.dataset.runId}`, () => api(`/api/agent-runs/${encodeURIComponent(button.dataset.runId)}/cancel`, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'run-cancel') },
    }), { successMessage: 'Contribution cancelled; its prompt remains available.', operationSlot });
  }
  if (action === 'prepare-package') {
    const operationSlot = `prepare:${state.discussionId}`;
    void withMutation('prepare-package', () => api(`/api/discussions/${encodeURIComponent(state.discussionId)}/work-package`, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'package-prepare') },
    }), { refresh: false, successMessage: 'Draft package prepared from accepted points.', operationSlot }).then(async result => {
      if (result) {
        state.viewedVersionId = result.version.id;
        state.rightTab = 'package';
        await refreshDiscussion();
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
    disarmApproval();
    renderWorkspace({ keepFocus: true });
    requestAnimationFrame(() => document.querySelector('[data-action="review-approval"]')?.focus());
    announce('Approval checkpoint closed. The package remains a draft.');
  }
  if (action === 'confirm-approval') void approvePackage(button.dataset.versionId);
  if (action === 'discard-package') {
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
    const latestDraft = draftFromPackageContent(current.content);
    const fieldConflicts = {};
    for (const name of Object.keys(latestDraft)) {
      const localChanged = localDraft[name] !== state.packageBase[name];
      const latestChanged = latestDraft[name] !== state.packageBase[name];
      if (localChanged && latestChanged && localDraft[name] !== latestDraft[name]) {
        fieldConflicts[name] = { local: localDraft[name], latest: latestDraft[name] };
      } else if (localChanged) latestDraft[name] = localDraft[name];
    }
    applyPackageVersionToDetail(current);
    state.packageBase = draftFromPackageContent(current.content);
    state.packageBaseRowVersion = current.rowVersion;
    state.packageDraft = latestDraft;
    state.packageDirty = Object.keys(latestDraft).some(name => latestDraft[name] !== state.packageBase[name]);
    disarmApproval();
    state.packageConflict = {
      ...state.packageConflict,
      rebased: true,
      fieldConflicts,
      message: Object.keys(fieldConflicts).length
        ? 'Some fields changed in both views. Choose each value before saving.'
        : 'Your non-overlapping changes are reapplied to the latest saved version.',
    };
    renderWorkspace({ keepFocus: true });
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
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'refresh-after-conflict') void refreshDiscussion({ keepFocus: true });
  if (action === 'view-version') {
    disarmApproval();
    state.viewedVersionId = button.dataset.versionId;
    renderWorkspace({ keepFocus: true });
  }
  if (action === 'next-version') {
    disarmApproval();
    const operationSlot = `next-version:${button.dataset.versionId}`;
    void withMutation('next-version', () => api(`/api/work-package-versions/${encodeURIComponent(button.dataset.versionId)}/next-version`, {
      method: 'POST', body: { idempotencyKey: operationKey(operationSlot, 'package-next') },
    }), { refresh: false, successMessage: 'New draft version created; the approved version remains unchanged.', operationSlot }).then(async result => {
      if (result) {
        state.viewedVersionId = result.version.id;
        await refreshDiscussion();
      }
    });
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
    void withMutation('capabilities', () => api('/api/bootstrap'), {
      refresh: false,
      successMessage: 'Provider capabilities checked.',
    }).then(result => {
      if (!result) return;
      state.bootstrap = result;
      state.projects = result.projects;
      renderHeader();
      renderWorkspace({ keepFocus: true });
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
