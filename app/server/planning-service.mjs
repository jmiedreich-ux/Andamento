import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  AppError,
  capabilityUnavailable,
  conflict,
  forbidden,
  notFound,
  normalizeError,
  validationError,
} from './domain/errors.mjs';
import {
  expectedVersion,
  oneOf,
  packageApprovalGaps,
  packageContent,
  requiredId,
  requiredIdempotencyKey,
  requiredText,
  optionalText,
} from './domain/validation.mjs';
import { appendAudit, mutation, now, transaction } from './storage/database.mjs';
import { buildChangeSet } from './execution/change-set.mjs';
import { applyChangeSet, revertApplication } from './execution/apply.mjs';

const OWNER_ID = 'owner-local';
const CODEX_CLEANUP_PENDING = 'CODEX_CLEANUP_PENDING';
const CODEX_CLEANUP_UNCONFIRMED = 'CODEX_CLEANUP_UNCONFIRMED';
const CODEX_PENDING_MESSAGE = 'Codex cancellation was requested and provider cleanup is still being confirmed. Further Codex work in this planning room is temporarily blocked.';
const CODEX_BLOCKED_MESSAGE = 'Andamento could not confirm that the Codex contribution stopped. Further Codex work in this planning room is blocked to prevent overlapping turns.';
const POINT_TYPES = ['QUESTION', 'DECISION', 'REQUIREMENT', 'CONSTRAINT', 'RISK', 'DEPENDENCY', 'ASSUMPTION', 'PROPOSED_WORK', 'PARKING_LOT'];
const POINT_DECISIONS = ['ACCEPTED', 'REJECTED', 'DEFERRED'];
const SAFE_AGENT_FAILURES = new Map([
  ['CANCELLED', 'The owner cancelled this contribution.'],
  ['CODEX_FAILURE', 'Codex could not complete this contribution. Retry is available.'],
  [CODEX_CLEANUP_UNCONFIRMED, CODEX_BLOCKED_MESSAGE],
  ['CODEX_TIMEOUT', 'Codex exceeded the planning time limit and was interrupted. Retry is available.'],
  ['DETERMINISTIC_FAILURE', 'The planning participant could not complete this attempt. Retry is available.'],
  ['MALFORMED_CONTRIBUTION', 'The participant returned an unusable contribution.'],
  ['REPOSITORY_UNAVAILABLE', 'The registered Git repository is no longer available. Restore it before retrying.'],
  ['MALFORMED_CHANGE_SET', 'The participant answered without a change set. This usually means the package does not yet describe a concrete change to this repository. Sharpen the outcome and included scope, then dispatch again.'],
  ['CHANGE_SET_ESCAPES_REPOSITORY', 'The proposed change set refers to a path outside the project repository and was refused.'],
  ['CHANGE_SET_DID_NOT_APPLY', 'The proposed change set did not apply cleanly to the current files. Nothing was changed.'],
  ['CLAUDE_NOT_CONFIGURED', 'No Anthropic credential is configured for Claude. Set ANTHROPIC_API_KEY and restart the local service.'],
  ['CLAUDE_AUTH', 'The Anthropic credential was refused. Check ANTHROPIC_API_KEY and restart the local service.'],
  ['CLAUDE_RATE_LIMITED', 'Claude is rate limited right now. Retry is available.'],
  ['CLAUDE_REQUEST_TOO_LARGE', 'That request was too large for Claude. Shorten the prompt and retry.'],
  ['CLAUDE_UNAVAILABLE', 'Claude could not be reached. Retry is available.'],
  ['CLAUDE_REFUSED', 'Claude declined this request. Rephrase the prompt or use another participant.'],
  ['CLAUDE_MALFORMED', 'Claude returned an unusable contribution.'],
  ['CLAUDE_FAILURE', 'Claude could not complete this contribution. Retry is available.'],
]);
const execFileAsync = promisify(execFile);

function identityPart(value) {
  return String(value || '').toLowerCase();
}

function importedParticipantKey({ displayName, provider, model }) {
  const identity = [provider, model, displayName].map(identityPart);
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `imported:v2:${digest}`;
}

function legacyImportedParticipantKey({ displayName, provider, model }) {
  return `imported:${identityPart(provider)}:${identityPart(model)}:${identityPart(displayName)}`;
}

function sameParticipantIdentity(existing, candidate) {
  return existing.kind === candidate.kind
    && identityPart(existing.displayName) === identityPart(candidate.displayName)
    && identityPart(existing.provider) === identityPart(candidate.provider)
    && identityPart(existing.model) === identityPart(candidate.model);
}

function safeAgentFailure(error, adapter) {
  const requestedCode = String(error?.code || '').toUpperCase();
  if (requestedCode === CODEX_CLEANUP_UNCONFIRMED && adapter !== 'codex') {
    return {
      code: 'AGENT_FAILURE',
      message: 'The planning participant could not complete this contribution. Retry is available.',
    };
  }
  if (SAFE_AGENT_FAILURES.has(requestedCode)) {
    return { code: requestedCode, message: SAFE_AGENT_FAILURES.get(requestedCode) };
  }
  return {
    code: 'AGENT_FAILURE',
    message: 'The planning participant could not complete this contribution. Retry is available.',
  };
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    repositoryRoot: row.repositoryRoot,
    createdAt: row.createdAt,
    rowVersion: row.rowVersion,
  };
}

function mapDiscussion(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rowVersion: row.rowVersion,
  };
}

function mapParticipant(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    provider: row.provider || '',
    model: row.model || '',
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    discussionId: row.discussionId,
    content: row.content,
    contributionType: row.contributionType,
    createdAt: row.createdAt,
    agentRunId: row.agentRunId || '',
    participant: {
      id: row.participantId,
      kind: row.participantKind,
      displayName: row.displayName,
      provider: row.provider || '',
      model: row.model || '',
    },
  };
}

function mapExecutionRun(row) {
  return {
    id: row.id,
    workPackageVersionId: row.workPackageVersionId,
    adapter: row.adapter,
    provider: row.provider,
    model: row.model,
    displayName: row.displayName,
    status: row.status,
    errorCode: row.errorCode || '',
    errorMessage: row.errorMessage || '',
    startedAt: row.startedAt,
    completedAt: row.completedAt || '',
    rowVersion: row.rowVersion,
    appliedAt: row.appliedAt || '',
    revertedAt: row.revertedAt || '',
    changeSet: row.changeSetId ? {
      id: row.changeSetId,
      diff: row.diff,
      diffSha256: row.diffSha256,
      fileCount: row.fileCount,
      createdAt: row.changeSetCreatedAt,
    } : null,
  };
}

function mapRun(row) {
  return {
    id: row.id,
    discussionId: row.discussionId,
    participantId: row.participantId,
    adapter: row.adapter,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    status: row.status,
    errorCode: row.errorCode || '',
    errorMessage: row.errorMessage || '',
    retryOfRunId: row.retryOfRunId || '',
    startedAt: row.startedAt,
    completedAt: row.completedAt || '',
    rowVersion: row.rowVersion,
    participant: row.displayName ? {
      id: row.participantId,
      displayName: row.displayName,
      provider: row.provider,
      model: row.model,
    } : undefined,
  };
}

function mapPoint(row) {
  return {
    id: row.id,
    discussionId: row.discussionId,
    sourceMessageId: row.sourceMessageId,
    createdByParticipantId: row.createdByParticipantId,
    pointType: row.pointType,
    text: row.text,
    disposition: row.disposition,
    decidedByParticipantId: row.decidedByParticipantId || '',
    decidedAt: row.decidedAt || '',
    supersedesPointId: row.supersedesPointId || '',
    createdAt: row.createdAt,
    rowVersion: row.rowVersion,
    source: row.sourceContent ? {
      messageId: row.sourceMessageId,
      excerpt: row.sourceContent.slice(0, 220),
      displayName: row.sourceDisplayName,
      provider: row.sourceProvider || '',
    } : undefined,
  };
}

function mapPackageVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.workPackageId,
    versionNumber: row.versionNumber,
    status: row.status,
    content: JSON.parse(row.contentJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt || '',
    rowVersion: row.rowVersion,
    sourcePointIds: row.sourcePointIds ? row.sourcePointIds.split(',').filter(Boolean) : [],
  };
}

async function validateRepositoryRoot(input) {
  const requested = requiredText(input, 'Repository root', { max: 1000 });
  try {
    const resolved = await realpath(requested);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error('not-directory');
    const { stdout } = await execFileAsync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      maxBuffer: 4096,
      timeout: 5000,
      windowsHide: true,
    });
    const repositoryRoot = await realpath(String(stdout).trim());
    const repositoryInfo = await stat(repositoryRoot);
    if (!repositoryInfo.isDirectory()) throw new Error('not-directory');
    return repositoryRoot;
  } catch {
    throw validationError('Repository root must be an existing local Git repository.', { field: 'repositoryRoot' });
  }
}

export class PlanningService {
  constructor({ database, agents, testMode = false }) {
    this.database = database;
    this.agents = agents;
    this.testMode = testMode;
    this.activeRuns = new Map();
    this.activeExecutions = new Map();
    this.trackedExecutions = new Set();
    this.shuttingDown = false;
    this.shutdownFinalized = false;
    this.shutdownPromise = null;
  }

  async bootstrap() {
    const projects = this.listProjects();
    const capabilities = await this.agents.capabilities();
    const owner = mapParticipant(this.database.prepare(`
      SELECT id, kind, display_name AS displayName, provider, model
      FROM participants WHERE id = ?
    `).get(OWNER_ID));
    return { owner, projects, capabilities };
  }

  listProjects() {
    return this.database.prepare(`
      SELECT p.id, p.name, p.repository_root AS repositoryRoot, p.created_at AS createdAt,
             p.row_version AS rowVersion,
             COUNT(d.id) AS discussionCount,
             MAX(d.updated_at) AS lastDiscussionAt
      FROM projects p
      LEFT JOIN discussions d ON d.project_id = p.id
      GROUP BY p.id
      ORDER BY COALESCE(MAX(d.updated_at), p.created_at) DESC, p.name COLLATE NOCASE
    `).all().map(row => ({
      ...mapProject(row),
      discussionCount: Number(row.discussionCount),
      lastDiscussionAt: row.lastDiscussionAt || '',
    }));
  }

  async createProject(input) {
    const name = requiredText(input.name, 'Project name', { max: 80 });
    const repositoryRoot = await validateRepositoryRoot(input.repositoryRoot);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'project.create',
      request: { name, repositoryRoot },
    }, () => {
      const id = randomUUID();
      const createdAt = now();
      this.database.prepare(`
        INSERT INTO projects(id, name, repository_root, created_at) VALUES (?, ?, ?, ?)
      `).run(id, name, repositoryRoot, createdAt);
      appendAudit(this.database, {
        eventType: 'PROJECT_CREATED', resourceType: 'PROJECT', resourceId: id, actorId: OWNER_ID,
        details: { name, repositoryRoot },
      });
      return { id, name, repositoryRoot, createdAt, rowVersion: 1 };
    });
    return { project: value, replayed };
  }

  listDiscussions(projectId) {
    const id = requiredId(projectId, 'Project');
    this.requireProject(id);
    return this.database.prepare(`
      SELECT id, project_id AS projectId, title, status, created_at AS createdAt,
             updated_at AS updatedAt, row_version AS rowVersion
      FROM discussions WHERE project_id = ? ORDER BY updated_at DESC, id
    `).all(id).map(mapDiscussion);
  }

  createDiscussion(projectId, input) {
    const normalizedProjectId = requiredId(projectId, 'Project');
    this.requireProject(normalizedProjectId);
    const title = requiredText(input.title, 'Planning room title', { max: 120 });
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'discussion.create',
      request: { projectId: normalizedProjectId, title },
    }, () => {
      const id = randomUUID();
      const createdAt = now();
      this.database.prepare(`
        INSERT INTO discussions(id, project_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, normalizedProjectId, title, createdAt, createdAt);
      this.retireDraftSlot(input.draftSlot);
      appendAudit(this.database, {
        eventType: 'DISCUSSION_CREATED', resourceType: 'DISCUSSION', resourceId: id, actorId: OWNER_ID,
        details: { projectId: normalizedProjectId, title },
      });
      return { id, projectId: normalizedProjectId, title, status: 'OPEN', createdAt, updatedAt: createdAt, rowVersion: 1 };
    });
    return { discussion: value, replayed };
  }

  addMessage(discussionId, input, actorId = OWNER_ID) {
    const normalizedDiscussionId = requiredId(discussionId, 'Discussion');
    this.requireDiscussion(normalizedDiscussionId);
    const content = requiredText(input.content, 'Contribution', { max: 20000 });
    const contributionType = oneOf(input.contributionType || 'OWNER', ['OWNER', 'IMPORTED'], 'Contribution type');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    let participant;
    if (contributionType === 'OWNER') {
      this.assertOwner(actorId);
      participant = this.requireParticipant(OWNER_ID);
    } else {
      const displayName = requiredText(input.displayName, 'Contributor name', { max: 80 });
      const provider = requiredText(input.provider || 'external', 'Provider', { max: 80 });
      const model = optionalText(input.model, 'Model', { max: 120 });
      participant = { kind: 'IMPORTED', displayName, provider, model };
    }

    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'message.create',
      request: {
        discussionId: normalizedDiscussionId,
        actorId,
        contributionType,
        content,
        participant,
      },
    }, () => {
      const storedParticipant = contributionType === 'OWNER'
        ? participant
        : this.ensureImportedParticipant(participant);
      const id = randomUUID();
      const createdAt = now();
      this.database.prepare(`
        INSERT INTO messages(id, discussion_id, participant_id, content, contribution_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, normalizedDiscussionId, storedParticipant.id, content, contributionType, createdAt);
      this.touchDiscussion(normalizedDiscussionId, createdAt);
      this.retireDraftSlot(input.draftSlot);
      appendAudit(this.database, {
        eventType: contributionType === 'OWNER' ? 'OWNER_MESSAGE_ADDED' : 'IMPORTED_CONTRIBUTION_ADDED',
        resourceType: 'MESSAGE', resourceId: id, actorId,
        details: { discussionId: normalizedDiscussionId, participantId: storedParticipant.id },
      });
      return {
        id,
        discussionId: normalizedDiscussionId,
        content,
        contributionType,
        createdAt,
        agentRunId: '',
        participant: storedParticipant,
      };
    });
    return { message: value, replayed };
  }

  startAgentRun(discussionId, input, actorId = OWNER_ID) {
    if (Object.hasOwn(input, 'retryOfRunId')) {
      throw validationError('Use the retry action to retry an existing contribution.', { field: 'retryOfRunId' });
    }
    return this.startAgentRunInternal(discussionId, input, actorId, null);
  }

  startAgentRunInternal(discussionId, input, actorId, retryOfRunId) {
    this.assertOwner(actorId);
    const normalizedDiscussionId = requiredId(discussionId, 'Discussion');
    const context = this.requireDiscussionContext(normalizedDiscussionId);
    const adapterName = oneOf(input.adapter || 'codex', ['codex', 'claude', 'deterministic'], 'Agent adapter');
    const adapter = this.agents.get(adapterName);
    const prompt = requiredText(input.prompt, 'Agent prompt', { max: 12000 });
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const normalizedRetryId = retryOfRunId ? requiredId(retryOfRunId, 'Retry run') : null;
    const participantIdentity = {
      participantKey: `agent:${adapter.provider}:${adapter.model}:${adapter.id}`,
      kind: 'AGENT',
      displayName: adapter.displayName,
      provider: adapter.provider,
      model: adapter.model,
    };

    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'agent-run.start',
      request: {
        discussionId: normalizedDiscussionId,
        actorId,
        adapter: adapterName,
        prompt,
        retryOfRunId: normalizedRetryId || '',
      },
    }, () => {
      if (normalizedRetryId) {
        const prior = this.requireRun(normalizedRetryId);
        if (prior.discussionId !== normalizedDiscussionId) throw conflict('The retry source belongs to a different planning room.');
        if (!['FAILED', 'INTERRUPTED'].includes(prior.status)) throw conflict('Only a failed or interrupted contribution can be retried.');
        const existingRetry = this.database.prepare(`
          SELECT id FROM agent_runs WHERE retry_of_run_id = ? ORDER BY started_at, id LIMIT 1
        `).get(normalizedRetryId);
        if (existingRetry) {
          const existing = this.requireRun(existingRetry.id);
          if (
            existing.discussionId !== prior.discussionId
            || existing.adapter !== prior.adapter
            || existing.prompt !== prior.prompt
          ) {
            throw new AppError(500, 'INVARIANT_VIOLATION', 'Saved retry lineage does not match its source contribution.');
          }
          return existing;
        }
      }
      if (adapterName === 'codex') {
        // Exact idempotency replays bypass the mutation callback and must remain replayable.
        this.assertCodexTurnAvailable({
          discussionId: normalizedDiscussionId,
          threadId: context.codexThreadId,
        });
      }
      const participant = this.ensureParticipant(participantIdentity);
      const run = {
        id: randomUUID(),
        discussionId: normalizedDiscussionId,
        participantId: participant.id,
        adapter: adapterName,
        provider: adapter.provider,
        model: adapter.model,
        prompt,
        status: 'RUNNING',
        errorCode: '',
        errorMessage: '',
        retryOfRunId: normalizedRetryId || '',
        startedAt: now(),
        completedAt: '',
        rowVersion: 1,
      };
      this.database.prepare(`
        INSERT INTO agent_runs(
          id, discussion_id, participant_id, adapter, provider, model, prompt, status,
          retry_of_run_id, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?)
      `).run(run.id, run.discussionId, run.participantId, run.adapter, run.provider, run.model, run.prompt, normalizedRetryId, run.startedAt);
      this.touchDiscussion(normalizedDiscussionId, run.startedAt);
      this.retireDraftSlot(input.draftSlot);
      appendAudit(this.database, {
        eventType: 'AGENT_RUN_STARTED', resourceType: 'AGENT_RUN', resourceId: run.id, actorId,
        details: { discussionId: normalizedDiscussionId, adapter: adapterName, retryOfRunId: normalizedRetryId },
      });
      return run;
    });

    if (!replayed && value.status === 'RUNNING' && !this.activeRuns.has(value.id)) {
      const controller = new AbortController();
      const activeRun = {
        controller,
        completion: null,
        discussionId: value.discussionId,
        adapter: value.adapter,
        providerStarted: false,
        threadId: context.codexThreadId || '',
      };
      this.activeRuns.set(value.id, activeRun);
      const completion = this.completeAgentRun({
        run: value,
        adapter,
        context,
        controller,
      });
      activeRun.completion = completion;
      void completion;
    }
    return { run: value, replayed };
  }

  retryAgentRun(runId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const prior = this.requireRun(requiredId(runId, 'Agent run'));
    if (!['FAILED', 'INTERRUPTED'].includes(prior.status)) {
      throw conflict('Only a failed or interrupted contribution can be retried.');
    }
    return this.startAgentRunInternal(prior.discussionId, {
      adapter: prior.adapter,
      prompt: prior.prompt,
      idempotencyKey: input.idempotencyKey,
    }, actorId, prior.id);
  }

  cancelAgentRun(runId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedRunId = requiredId(runId, 'Agent run');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'agent-run.cancel',
      request: { runId: normalizedRunId, actorId },
    }, () => {
      const run = this.requireRun(normalizedRunId);
      if (run.status !== 'RUNNING') return run;
      const completedAt = now();
      const activeRun = this.activeRuns.get(normalizedRunId);
      const codexCleanupPending = run.adapter === 'codex' && activeRun?.providerStarted === true;
      const codexCleanupUnconfirmed = run.adapter === 'codex' && !activeRun;
      const errorCode = codexCleanupPending
        ? CODEX_CLEANUP_PENDING
        : codexCleanupUnconfirmed ? CODEX_CLEANUP_UNCONFIRMED : 'CANCELLED';
      const errorMessage = codexCleanupPending
        ? CODEX_PENDING_MESSAGE
        : codexCleanupUnconfirmed ? CODEX_BLOCKED_MESSAGE : 'The owner cancelled this contribution.';
      this.database.prepare(`
        UPDATE agent_runs
        SET status = 'INTERRUPTED', error_code = ?,
            error_message = ?, completed_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'RUNNING'
      `).run(errorCode, errorMessage, codexCleanupPending ? null : completedAt, normalizedRunId);
      appendAudit(this.database, {
        eventType: codexCleanupPending
          ? 'AGENT_CANCELLATION_REQUESTED'
          : codexCleanupUnconfirmed ? 'AGENT_CLEANUP_UNCONFIRMED' : 'AGENT_RUN_CANCELLED',
        resourceType: 'AGENT_RUN', resourceId: normalizedRunId, actorId,
        details: { reason: errorCode },
      });
      return this.requireRun(normalizedRunId);
    });
    this.activeRuns.get(normalizedRunId)?.controller.abort();
    return { run: value, replayed };
  }

  async completeAgentRun({ run, adapter, context, controller }) {
    try {
      let repositoryRoot;
      try {
        repositoryRoot = await validateRepositoryRoot(context.repositoryRoot);
        if (repositoryRoot !== context.repositoryRoot) throw new Error('repository-root-changed');
      } catch {
        const error = new Error('The registered repository is unavailable.');
        error.code = 'REPOSITORY_UNAVAILABLE';
        throw error;
      }
      if (controller.signal.aborted) {
        const error = new Error('The contribution was cancelled before the provider started.');
        error.code = 'CANCELLED';
        throw error;
      }
      const activeRun = this.activeRuns.get(run.id);
      if (activeRun) activeRun.providerStarted = true;
      const contribution = await adapter.contribute({
        prompt: run.prompt,
        repositoryRoot,
        threadId: context.codexThreadId,
        retryOfRunId: run.retryOfRunId || '',
        signal: controller.signal,
        onThread: async threadId => {
          const activeRun = this.activeRuns.get(run.id);
          if (activeRun) activeRun.threadId = threadId;
          if (this.shutdownFinalized) return;
          transaction(this.database, () => {
            this.database.prepare(`
              UPDATE discussions SET codex_thread_id = ?, updated_at = ?, row_version = row_version + 1
              WHERE id = ?
            `).run(threadId, now(), run.discussionId);
          });
        },
      });
      if (this.shutdownFinalized) return;
      transaction(this.database, () => {
        const current = this.requireRun(run.id);
        if (current.errorCode === CODEX_CLEANUP_PENDING && run.adapter === 'codex') {
          this.confirmPendingCodexCleanup(run, now());
          return;
        }
        if (this.shuttingDown) return;
        if (current.status !== 'RUNNING') return;
        const createdAt = now();
        const messageId = randomUUID();
        this.database.prepare(`
          INSERT INTO messages(id, discussion_id, participant_id, agent_run_id, content, contribution_type, created_at)
          VALUES (?, ?, ?, ?, ?, 'AGENT', ?)
        `).run(messageId, run.discussionId, run.participantId, run.id, requiredText(contribution.content, 'Agent contribution', { max: 20000 }), createdAt);
        this.database.prepare(`
          UPDATE agent_runs
          SET status = 'COMPLETED', provider = ?, model = ?, completed_at = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'RUNNING'
        `).run(contribution.provider || run.provider, contribution.model || run.model, createdAt, run.id);
        this.touchDiscussion(run.discussionId, createdAt);
        appendAudit(this.database, {
          eventType: 'AGENT_CONTRIBUTION_COMPLETED', resourceType: 'AGENT_RUN', resourceId: run.id,
          actorId: run.participantId, details: { messageId, provider: contribution.provider, model: contribution.model },
        });
      });
    } catch (error) {
      const failure = safeAgentFailure(error, run.adapter);
      const cleanupUnconfirmed = failure.code === CODEX_CLEANUP_UNCONFIRMED;
      if (this.shutdownFinalized) return;
      transaction(this.database, () => {
        const current = this.requireRun(run.id);
        const cleanupConfirmed = run.adapter === 'codex'
          && failure.code === 'CANCELLED'
          && current.errorCode === CODEX_CLEANUP_PENDING;
        if (cleanupConfirmed) {
          this.confirmPendingCodexCleanup(run, now());
          return;
        }
        if (this.shuttingDown && !cleanupUnconfirmed) return;
        if (
          current.status !== 'RUNNING'
          && !(cleanupUnconfirmed && current.status === 'INTERRUPTED')
        ) return;
        const completedAt = now();
        const status = this.shuttingDown || current.status === 'INTERRUPTED'
          ? 'INTERRUPTED'
          : 'FAILED';
        this.database.prepare(`
          UPDATE agent_runs
          SET status = ?, error_code = ?, error_message = ?, completed_at = ?, row_version = row_version + 1
          WHERE id = ?
        `).run(status, failure.code, failure.message, completedAt, run.id);
        this.touchDiscussion(run.discussionId, completedAt);
        appendAudit(this.database, {
          eventType: cleanupUnconfirmed ? 'AGENT_CLEANUP_UNCONFIRMED' : 'AGENT_CONTRIBUTION_FAILED',
          resourceType: 'AGENT_RUN', resourceId: run.id,
          actorId: run.participantId, details: { code: failure.code },
        });
      });
    } finally {
      this.activeRuns.delete(run.id);
    }
  }

  capturePoint(messageId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const source = this.requireMessage(requiredId(messageId, 'Source message'));
    const pointType = oneOf(input.pointType, POINT_TYPES, 'Planning-point type');
    const text = requiredText(input.text, 'Planning point', { max: 2000 });
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'planning-point.capture',
      request: { messageId: source.id, actorId, pointType, text },
    }, () => {
      const point = {
        id: randomUUID(),
        discussionId: source.discussionId,
        sourceMessageId: source.id,
        createdByParticipantId: actorId,
        pointType,
        text,
        disposition: 'PROPOSED',
        decidedByParticipantId: '',
        decidedAt: '',
        supersedesPointId: '',
        createdAt: now(),
        rowVersion: 1,
      };
      this.database.prepare(`
        INSERT INTO planning_points(
          id, discussion_id, source_message_id, created_by_participant_id, point_type, text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(point.id, point.discussionId, point.sourceMessageId, point.createdByParticipantId, point.pointType, point.text, point.createdAt);
      this.touchDiscussion(point.discussionId, point.createdAt);
      this.retireDraftSlot(input.draftSlot);
      appendAudit(this.database, {
        eventType: 'PLANNING_POINT_PROPOSED', resourceType: 'PLANNING_POINT', resourceId: point.id, actorId,
        details: { sourceMessageId: source.id, pointType },
      });
      return point;
    });
    return { point: value, replayed };
  }

  replacePoint(pointId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const original = this.requirePoint(requiredId(pointId, 'Planning point'));
    const pointType = oneOf(input.pointType || original.pointType, POINT_TYPES, 'Planning-point type');
    const text = requiredText(input.text, 'Planning point', { max: 2000 });
    const version = expectedVersion(input.expectedVersion);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'planning-point.replace',
      request: { pointId: original.id, actorId, pointType, text, expectedVersion: version },
    }, () => {
      const current = this.requirePoint(original.id);
      if (current.rowVersion !== version) {
        throw conflict('This planning point changed in another view.', { current });
      }
      if (current.disposition !== 'PROPOSED') {
        throw conflict('A decided planning point is immutable. Create a new proposal from its source instead.', { current });
      }
      const createdAt = now();
      this.database.prepare(`
        UPDATE planning_points
        SET disposition = 'SUPERSEDED', decided_by_participant_id = ?, decided_at = ?, row_version = row_version + 1
        WHERE id = ? AND row_version = ? AND disposition = 'PROPOSED'
      `).run(actorId, createdAt, current.id, version);
      const replacement = {
        id: randomUUID(),
        discussionId: current.discussionId,
        sourceMessageId: current.sourceMessageId,
        createdByParticipantId: actorId,
        pointType,
        text,
        disposition: 'PROPOSED',
        decidedByParticipantId: '',
        decidedAt: '',
        supersedesPointId: current.id,
        createdAt,
        rowVersion: 1,
      };
      this.database.prepare(`
        INSERT INTO planning_points(
          id, discussion_id, source_message_id, created_by_participant_id, point_type, text,
          supersedes_point_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(replacement.id, replacement.discussionId, replacement.sourceMessageId, actorId, pointType, text, current.id, createdAt);
      this.retireDraftSlot(input.draftSlot);
      appendAudit(this.database, {
        eventType: 'PLANNING_POINT_REPLACED', resourceType: 'PLANNING_POINT', resourceId: replacement.id, actorId,
        details: { supersedesPointId: current.id },
      });
      return replacement;
    });
    return { point: value, replayed };
  }

  dispositionPoint(pointId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedPointId = requiredId(pointId, 'Planning point');
    const disposition = oneOf(input.disposition, POINT_DECISIONS, 'Disposition');
    const version = expectedVersion(input.expectedVersion);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'planning-point.disposition',
      request: { pointId: normalizedPointId, actorId, disposition, expectedVersion: version },
    }, () => {
      const current = this.requirePoint(normalizedPointId);
      if (current.rowVersion !== version) throw conflict('This planning point changed in another view.', { current });
      if (current.disposition !== 'PROPOSED') throw conflict('This planning point was already decided.', { current });
      const decidedAt = now();
      const result = this.database.prepare(`
        UPDATE planning_points
        SET disposition = ?, decided_by_participant_id = ?, decided_at = ?, row_version = row_version + 1
        WHERE id = ? AND row_version = ? AND disposition = 'PROPOSED'
      `).run(disposition, actorId, decidedAt, normalizedPointId, version);
      if (Number(result.changes) !== 1) throw conflict('This planning point changed before the decision was saved.');
      appendAudit(this.database, {
        eventType: `PLANNING_POINT_${disposition}`, resourceType: 'PLANNING_POINT', resourceId: normalizedPointId, actorId,
        details: {},
      });
      return this.requirePoint(normalizedPointId);
    });
    return { point: value, replayed };
  }

  preparePackage(discussionId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedDiscussionId = requiredId(discussionId, 'Discussion');
    this.requireDiscussion(normalizedDiscussionId);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'work-package.prepare',
      request: { discussionId: normalizedDiscussionId, actorId },
    }, () => {
      const existingDraft = this.findDraftVersion(normalizedDiscussionId);
      if (existingDraft) return existingDraft;
      const acceptedPoints = this.database.prepare(`
        SELECT id, text FROM planning_points
        WHERE discussion_id = ? AND disposition = 'ACCEPTED'
        ORDER BY created_at, id
      `).all(normalizedDiscussionId);
      if (!acceptedPoints.length) throw validationError('Accept at least one planning point before preparing a package.');
      const derivedContent = packageContent({
        outcome: '',
        includedScope: acceptedPoints.map(point => point.text),
        exclusions: [],
        acceptanceCriteria: [],
        reviewRequirements: [],
        evidenceRequirements: [],
      });
      let workPackage = this.database.prepare(`
        SELECT id, discussion_id AS discussionId FROM work_packages WHERE discussion_id = ?
      `).get(normalizedDiscussionId);
      if (!workPackage) {
        workPackage = { id: randomUUID(), discussionId: normalizedDiscussionId };
        this.database.prepare(`
          INSERT INTO work_packages(id, discussion_id, created_at) VALUES (?, ?, ?)
        `).run(workPackage.id, normalizedDiscussionId, now());
      }
      const nextNumber = Number(this.database.prepare(`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS nextNumber
        FROM work_package_versions WHERE work_package_id = ?
      `).get(workPackage.id).nextNumber);
      if (nextNumber > 1) throw conflict('Create a new draft from the approved version before preparing another package.');
      const createdAt = now();
      const version = {
        id: randomUUID(),
        workPackageId: workPackage.id,
        versionNumber: nextNumber,
        status: 'DRAFT',
        content: derivedContent,
        createdAt,
        updatedAt: createdAt,
        approvedAt: '',
        rowVersion: 1,
        sourcePointIds: acceptedPoints.map(point => point.id),
      };
      this.database.prepare(`
        INSERT INTO work_package_versions(
          id, work_package_id, version_number, status, content_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(version.id, version.workPackageId, version.versionNumber, JSON.stringify(version.content), createdAt, createdAt);
      const link = this.database.prepare(`
        INSERT INTO work_package_points(work_package_version_id, planning_point_id) VALUES (?, ?)
      `);
      for (const point of acceptedPoints) link.run(version.id, point.id);
      this.touchDiscussion(normalizedDiscussionId, createdAt);
      appendAudit(this.database, {
        eventType: 'WORK_PACKAGE_DRAFT_CREATED', resourceType: 'WORK_PACKAGE_VERSION', resourceId: version.id, actorId,
        details: { discussionId: normalizedDiscussionId, versionNumber: nextNumber, sourcePointIds: version.sourcePointIds },
      });
      return version;
    });
    return { version: value, replayed };
  }

  updatePackageVersion(versionId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedVersionId = requiredId(versionId, 'Work-package version');
    const version = expectedVersion(input.expectedVersion);
    const content = packageContent(input.content);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'work-package.update',
      request: { versionId: normalizedVersionId, actorId, expectedVersion: version, content },
    }, () => {
      const current = this.requirePackageVersion(normalizedVersionId);
      if (current.status !== 'DRAFT') throw conflict('Approved work-package versions are immutable.', { current });
      if (current.rowVersion !== version) throw conflict('This package changed in another view.', { current });
      const updatedAt = now();
      const result = this.database.prepare(`
        UPDATE work_package_versions
        SET content_json = ?, updated_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'DRAFT' AND row_version = ?
      `).run(JSON.stringify(content), updatedAt, normalizedVersionId, version);
      if (Number(result.changes) !== 1) throw conflict('This package changed before the draft was saved.');
      this.retireDraftSlot(input.draftSlot);
      appendAudit(this.database, {
        eventType: 'WORK_PACKAGE_DRAFT_UPDATED', resourceType: 'WORK_PACKAGE_VERSION', resourceId: normalizedVersionId, actorId,
        details: { rowVersion: version + 1 },
      });
      return this.requirePackageVersion(normalizedVersionId);
    });
    return { version: value, replayed };
  }

  approvePackageVersion(versionId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedVersionId = requiredId(versionId, 'Work-package version');
    const version = expectedVersion(input.expectedVersion);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'work-package.approve',
      request: { versionId: normalizedVersionId, actorId, expectedVersion: version },
    }, () => {
      const current = this.requirePackageVersion(normalizedVersionId);
      const existingApproval = this.database.prepare(`
        SELECT id, owner_participant_id AS ownerParticipantId, authorization_scope AS authorizationScope,
               occurred_at AS occurredAt
        FROM approval_events WHERE work_package_version_id = ?
      `).get(normalizedVersionId);
      if (current.status === 'READY_FOR_EXECUTION' && existingApproval) {
        return { id: current.id, version: current, approval: existingApproval, state: 'READY_FOR_EXECUTION' };
      }
      if (current.status !== 'DRAFT') throw conflict('Only a draft package can be approved.', { current });
      if (current.rowVersion !== version) throw conflict('This package changed in another view.', { current });
      const gaps = packageApprovalGaps(current.content);
      if (gaps.length) {
        throw validationError('Complete every required package section before approval.', { gaps, current });
      }
      const invalidSources = this.database.prepare(`
        SELECT p.id, p.disposition
        FROM work_package_points wpp
        JOIN planning_points p ON p.id = wpp.planning_point_id
        WHERE wpp.work_package_version_id = ? AND p.disposition <> 'ACCEPTED'
      `).all(normalizedVersionId);
      const sourceCount = Number(this.database.prepare(`
        SELECT COUNT(*) AS count FROM work_package_points WHERE work_package_version_id = ?
      `).get(normalizedVersionId).count);
      if (!sourceCount || invalidSources.length) {
        throw conflict('The package source set is no longer eligible for approval.', { invalidSources });
      }
      const approvedAt = now();
      const update = this.database.prepare(`
        UPDATE work_package_versions
        SET status = 'READY_FOR_EXECUTION', approved_at = ?, updated_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'DRAFT' AND row_version = ?
      `).run(approvedAt, approvedAt, normalizedVersionId, version);
      if (Number(update.changes) !== 1) throw conflict('This package changed before approval was recorded.');
      const approval = {
        id: randomUUID(),
        workPackageVersionId: normalizedVersionId,
        ownerParticipantId: actorId,
        authorizationScope: 'Planning package is ready for a separately authorized execution milestone. No execution was dispatched.',
        occurredAt: approvedAt,
      };
      this.database.prepare(`
        INSERT INTO approval_events(id, work_package_version_id, owner_participant_id, authorization_scope, occurred_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(approval.id, approval.workPackageVersionId, approval.ownerParticipantId, approval.authorizationScope, approval.occurredAt);
      const snapshot = this.database.prepare(`
        INSERT INTO approved_package_point_snapshots(
          work_package_version_id, planning_point_id, captured_at
        ) VALUES (?, ?, ?)
      `);
      for (const pointId of current.sourcePointIds) snapshot.run(normalizedVersionId, pointId, approvedAt);
      appendAudit(this.database, {
        eventType: 'WORK_PACKAGE_VERSION_APPROVED', resourceType: 'WORK_PACKAGE_VERSION', resourceId: normalizedVersionId, actorId,
        details: { approvalId: approval.id, sourceCount },
      });
      const approved = this.requirePackageVersion(normalizedVersionId);
      return { id: approved.id, version: approved, approval, state: 'READY_FOR_EXECUTION' };
    });
    return { ...value, replayed };
  }

  createNextPackageVersion(versionId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedVersionId = requiredId(versionId, 'Work-package version');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'work-package.new-version',
      request: { versionId: normalizedVersionId, actorId },
    }, () => {
      const source = this.requirePackageVersion(normalizedVersionId);
      if (source.status !== 'READY_FOR_EXECUTION') throw conflict('Create the next draft from an approved package version.');
      const existing = this.database.prepare(`
        SELECT id FROM work_package_versions
        WHERE work_package_id = ? AND status = 'DRAFT'
        ORDER BY version_number DESC LIMIT 1
      `).get(source.workPackageId);
      if (existing) return this.requirePackageVersion(existing.id);
      const nextNumber = Number(this.database.prepare(`
        SELECT MAX(version_number) + 1 AS nextNumber FROM work_package_versions WHERE work_package_id = ?
      `).get(source.workPackageId).nextNumber);
      const createdAt = now();
      const next = {
        id: randomUUID(),
        workPackageId: source.workPackageId,
        versionNumber: nextNumber,
        status: 'DRAFT',
        content: source.content,
        createdAt,
        updatedAt: createdAt,
        approvedAt: '',
        rowVersion: 1,
        sourcePointIds: source.sourcePointIds,
      };
      this.database.prepare(`
        INSERT INTO work_package_versions(
          id, work_package_id, version_number, status, content_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(next.id, next.workPackageId, next.versionNumber, JSON.stringify(next.content), createdAt, createdAt);
      const insertLink = this.database.prepare(`
        INSERT INTO work_package_points(work_package_version_id, planning_point_id) VALUES (?, ?)
      `);
      for (const pointId of source.sourcePointIds) insertLink.run(next.id, pointId);
      appendAudit(this.database, {
        eventType: 'WORK_PACKAGE_VERSION_CREATED', resourceType: 'WORK_PACKAGE_VERSION', resourceId: next.id, actorId,
        details: { sourceVersionId: source.id, versionNumber: next.versionNumber },
      });
      return next;
    });
    return { version: value, replayed };
  }

  // Working input the owner has not confirmed yet. Held durably so a reload or
  // a restart cannot discard it, and deleted the moment its mutation confirms.
  // Retiring the draft inside the mutation that made the input durable removes
  // any window where a reload could offer back work that already committed.
  retireDraftSlot(slot) {
    if (!slot || typeof slot !== 'string') return;
    this.database.prepare('DELETE FROM input_drafts WHERE slot = ?').run(slot);
  }

  saveInputDraft(slot, input = {}, actorId) {
    this.assertOwner(actorId);
    const normalizedSlot = requiredText(slot, 'Draft slot', { max: 400 });
    const projectId = requiredId(input.projectId, 'Project');
    const discussionId = input.discussionId ? requiredId(input.discussionId, 'Discussion') : '';
    if (!input.payload || typeof input.payload !== 'object') {
      throw validationError('A draft payload is required.');
    }
    const payloadJson = JSON.stringify(input.payload);
    if (payloadJson.length > 400_000) throw validationError('That draft is too large to hold.');
    this.database.prepare(`
      INSERT INTO input_drafts(slot, project_id, discussion_id, owner_participant_id, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
    `).run(normalizedSlot, projectId, discussionId, actorId, payloadJson, now());
    return { slot: normalizedSlot };
  }

  listInputDrafts(projectId, discussionId = '', actorId) {
    this.assertOwner(actorId);
    const normalizedProjectId = requiredId(projectId, 'Project');
    const normalizedDiscussionId = discussionId ? requiredId(discussionId, 'Discussion') : '';
    return this.database.prepare(`
      SELECT slot, project_id AS projectId, discussion_id AS discussionId,
             payload_json AS payloadJson, updated_at AS updatedAt
      FROM input_drafts
      WHERE project_id = ? AND discussion_id = ?
      ORDER BY updated_at
    `).all(normalizedProjectId, normalizedDiscussionId).map(row => ({
      slot: row.slot,
      projectId: row.projectId,
      discussionId: row.discussionId,
      updatedAt: row.updatedAt,
      payload: JSON.parse(row.payloadJson),
    }));
  }

  deleteInputDraft(slot, actorId) {
    this.assertOwner(actorId);
    const normalizedSlot = requiredText(slot, 'Draft slot', { max: 400 });
    this.database.prepare('DELETE FROM input_drafts WHERE slot = ?').run(normalizedSlot);
    return { slot: normalizedSlot };
  }

  // One cross-project answer to "what is waiting on the owner?". Every item is
  // something only the owner can resolve, or work that stopped and needs a
  // decision to continue.
  getHome() {
    const undecidedPoints = this.database.prepare(`
      SELECT pp.id, pp.text, pp.point_type AS pointType, pp.created_at AS createdAt,
             d.id AS discussionId, d.title AS discussionTitle,
             pr.id AS projectId, pr.name AS projectName
      FROM planning_points pp
      JOIN discussions d ON d.id = pp.discussion_id
      JOIN projects pr ON pr.id = d.project_id
      WHERE pp.disposition = 'PROPOSED'
      ORDER BY pp.created_at DESC
    `).all();

    const draftVersions = this.database.prepare(`
      SELECT wpv.id, wpv.version_number AS versionNumber, wpv.content_json AS contentJson,
             wpv.updated_at AS updatedAt,
             d.id AS discussionId, d.title AS discussionTitle,
             pr.id AS projectId, pr.name AS projectName,
             (SELECT COUNT(*) FROM work_package_points wpp
               WHERE wpp.work_package_version_id = wpv.id) AS sourceCount
      FROM work_package_versions wpv
      JOIN work_packages wp ON wp.id = wpv.work_package_id
      JOIN discussions d ON d.id = wp.discussion_id
      JOIN projects pr ON pr.id = d.project_id
      WHERE wpv.status = 'DRAFT'
      ORDER BY wpv.updated_at DESC
    `).all().map(row => {
      const content = JSON.parse(row.contentJson);
      const gaps = packageApprovalGaps(content);
      return {
        id: row.id,
        versionNumber: row.versionNumber,
        updatedAt: row.updatedAt,
        discussionId: row.discussionId,
        discussionTitle: row.discussionTitle,
        projectId: row.projectId,
        projectName: row.projectName,
        sourceCount: row.sourceCount,
        gaps,
        readyToApprove: gaps.length === 0 && row.sourceCount > 0,
      };
    });

    const approvedNotDispatched = this.database.prepare(`
      SELECT wpv.id, wpv.version_number AS versionNumber, wpv.approved_at AS approvedAt,
             d.id AS discussionId, d.title AS discussionTitle,
             pr.id AS projectId, pr.name AS projectName
      FROM work_package_versions wpv
      JOIN work_packages wp ON wp.id = wpv.work_package_id
      JOIN discussions d ON d.id = wp.discussion_id
      JOIN projects pr ON pr.id = d.project_id
      WHERE wpv.status = 'READY_FOR_EXECUTION'
        AND NOT EXISTS (
          SELECT 1 FROM execution_runs er WHERE er.work_package_version_id = wpv.id
        )
      ORDER BY wpv.approved_at DESC
    `).all();

    const stoppedWork = [
      ...this.database.prepare(`
        SELECT ar.id, ar.status, ar.error_code AS errorCode, ar.prompt AS label,
               ar.completed_at AS stoppedAt, 'contribution' AS kind,
               d.id AS discussionId, d.title AS discussionTitle,
               pr.id AS projectId, pr.name AS projectName
        FROM agent_runs ar
        JOIN discussions d ON d.id = ar.discussion_id
        JOIN projects pr ON pr.id = d.project_id
        WHERE ar.status IN ('FAILED', 'INTERRUPTED')
          AND NOT EXISTS (SELECT 1 FROM agent_runs child WHERE child.retry_of_run_id = ar.id)
      `).all(),
      ...this.database.prepare(`
        SELECT er.id, er.status, er.error_code AS errorCode,
               'Execution of v' || wpv.version_number AS label,
               er.completed_at AS stoppedAt, 'execution' AS kind,
               d.id AS discussionId, d.title AS discussionTitle,
               pr.id AS projectId, pr.name AS projectName
        FROM execution_runs er
        JOIN work_package_versions wpv ON wpv.id = er.work_package_version_id
        JOIN discussions d ON d.id = er.discussion_id
        JOIN projects pr ON pr.id = d.project_id
        WHERE er.status IN ('FAILED', 'INTERRUPTED')
      `).all(),
    ].sort((left, right) => String(right.stoppedAt).localeCompare(String(left.stoppedAt)));

    return {
      undecidedPoints,
      draftPackages: draftVersions,
      approvedNotDispatched,
      stoppedWork,
      waitingCount: undecidedPoints.length
        + draftVersions.length
        + approvedNotDispatched.length
        + stoppedWork.length,
    };
  }

  getDiscussion(discussionId) {
    const id = requiredId(discussionId, 'Discussion');
    const discussionRow = this.database.prepare(`
      SELECT d.id, d.project_id AS projectId, d.title, d.status, d.created_at AS createdAt,
             d.updated_at AS updatedAt, d.row_version AS rowVersion,
             d.codex_thread_id AS codexThreadId,
             p.id AS projectRecordId, p.name AS projectName, p.repository_root AS repositoryRoot,
             p.created_at AS projectCreatedAt, p.row_version AS projectRowVersion
      FROM discussions d JOIN projects p ON p.id = d.project_id WHERE d.id = ?
    `).get(id);
    if (!discussionRow) throw notFound('Planning room not found.');
    const discussion = mapDiscussion(discussionRow);
    const project = {
      id: discussionRow.projectRecordId,
      name: discussionRow.projectName,
      repositoryRoot: discussionRow.repositoryRoot,
      createdAt: discussionRow.projectCreatedAt,
      rowVersion: discussionRow.projectRowVersion,
    };
    const messages = this.database.prepare(`
      SELECT m.id, m.discussion_id AS discussionId, m.content,
             m.contribution_type AS contributionType, m.created_at AS createdAt,
             m.agent_run_id AS agentRunId, p.id AS participantId, p.kind AS participantKind,
             p.display_name AS displayName, p.provider, p.model
      FROM messages m JOIN participants p ON p.id = m.participant_id
      WHERE m.discussion_id = ? ORDER BY m.created_at, m.id
    `).all(id).map(mapMessage);
    const runs = this.database.prepare(`
      SELECT r.id, r.discussion_id AS discussionId, r.participant_id AS participantId,
             r.adapter, r.provider, r.model, r.prompt, r.status,
             r.error_code AS errorCode, r.error_message AS errorMessage,
             r.retry_of_run_id AS retryOfRunId, r.started_at AS startedAt,
             r.completed_at AS completedAt, r.row_version AS rowVersion,
             p.display_name AS displayName
      FROM agent_runs r JOIN participants p ON p.id = r.participant_id
      WHERE r.discussion_id = ? ORDER BY r.started_at, r.id
    `).all(id).map(mapRun);
    const points = this.database.prepare(`
      SELECT pp.id, pp.discussion_id AS discussionId, pp.source_message_id AS sourceMessageId,
             pp.created_by_participant_id AS createdByParticipantId, pp.point_type AS pointType,
             pp.text, pp.disposition, pp.decided_by_participant_id AS decidedByParticipantId,
             pp.decided_at AS decidedAt, pp.supersedes_point_id AS supersedesPointId,
             pp.created_at AS createdAt, pp.row_version AS rowVersion,
             m.content AS sourceContent, sp.display_name AS sourceDisplayName, sp.provider AS sourceProvider
      FROM planning_points pp
      JOIN messages m ON m.id = pp.source_message_id
      JOIN participants sp ON sp.id = m.participant_id
      WHERE pp.discussion_id = ? ORDER BY pp.created_at, pp.id
    `).all(id).map(mapPoint);
    const packageRow = this.database.prepare(`
      SELECT id, discussion_id AS discussionId, created_at AS createdAt
      FROM work_packages WHERE discussion_id = ?
    `).get(id);
    let workPackage = null;
    if (packageRow) {
      const versions = this.database.prepare(`
        SELECT wpv.id, wpv.work_package_id AS workPackageId, wpv.version_number AS versionNumber,
               wpv.status, wpv.content_json AS contentJson, wpv.created_at AS createdAt,
               wpv.updated_at AS updatedAt, wpv.approved_at AS approvedAt,
               wpv.row_version AS rowVersion,
               GROUP_CONCAT(wpp.planning_point_id) AS sourcePointIds
        FROM work_package_versions wpv
        LEFT JOIN work_package_points wpp ON wpp.work_package_version_id = wpv.id
        WHERE wpv.work_package_id = ?
        GROUP BY wpv.id ORDER BY wpv.version_number DESC
      `).all(packageRow.id).map(mapPackageVersion);
      const approvals = this.database.prepare(`
        SELECT ae.id, ae.work_package_version_id AS workPackageVersionId,
               ae.owner_participant_id AS ownerParticipantId, ae.authorization_scope AS authorizationScope,
               ae.occurred_at AS occurredAt, p.display_name AS ownerDisplayName
        FROM approval_events ae JOIN participants p ON p.id = ae.owner_participant_id
        JOIN work_package_versions wpv ON wpv.id = ae.work_package_version_id
        WHERE wpv.work_package_id = ? ORDER BY ae.occurred_at, ae.id
      `).all(packageRow.id);
      const executions = this.database.prepare(`
        SELECT er.id, er.work_package_version_id AS workPackageVersionId, er.adapter, er.provider,
               er.model, er.status, er.error_code AS errorCode, er.error_message AS errorMessage,
               er.started_at AS startedAt, er.completed_at AS completedAt,
               er.row_version AS rowVersion, p.display_name AS displayName,
               ecs.id AS changeSetId, ecs.diff, ecs.diff_sha256 AS diffSha256,
               ecs.file_count AS fileCount, ecs.created_at AS changeSetCreatedAt,
               ea.applied_at AS appliedAt, ea.reverted_at AS revertedAt
        FROM execution_runs er
        JOIN participants p ON p.id = er.participant_id
        LEFT JOIN execution_change_sets ecs ON ecs.execution_run_id = er.id
        LEFT JOIN execution_applications ea ON ea.execution_run_id = er.id
        JOIN work_package_versions wpv ON wpv.id = er.work_package_version_id
        WHERE wpv.work_package_id = ? ORDER BY er.started_at DESC, er.id
      `).all(packageRow.id).map(mapExecutionRun);
      workPackage = {
        ...packageRow, versions, currentVersion: versions[0] || null, approvals, executions,
      };
    }
    const codexQuarantine = this.findCodexCleanupQuarantine({
      discussionId: id,
      threadId: discussionRow.codexThreadId,
    });
    const agentAvailability = {
      codex: {
        blocked: Boolean(codexQuarantine),
        reason: codexQuarantine
          ? codexQuarantine.errorCode === CODEX_CLEANUP_PENDING
            ? CODEX_PENDING_MESSAGE
            : CODEX_BLOCKED_MESSAGE
          : '',
      },
    };
    return { project, discussion, messages, runs, points, workPackage, agentAvailability };
  }

  verifyInvariants() {
    const checks = [
      {
        name: 'approved versions have exactly one approval',
        sql: `SELECT wpv.id FROM work_package_versions wpv LEFT JOIN approval_events ae ON ae.work_package_version_id = wpv.id
              WHERE wpv.status = 'READY_FOR_EXECUTION' GROUP BY wpv.id HAVING COUNT(ae.id) <> 1`,
      },
      {
        name: 'draft versions have no approval',
        sql: `SELECT wpv.id FROM work_package_versions wpv JOIN approval_events ae ON ae.work_package_version_id = wpv.id
              WHERE wpv.status = 'DRAFT'`,
      },
      {
        name: 'only owners approve',
        sql: `SELECT ae.id FROM approval_events ae JOIN participants p ON p.id = ae.owner_participant_id WHERE p.kind <> 'OWNER'`,
      },
      {
        name: 'package sources remain accepted',
        sql: `SELECT wpp.work_package_version_id FROM work_package_points wpp JOIN planning_points p ON p.id = wpp.planning_point_id
              WHERE p.disposition <> 'ACCEPTED'`,
      },
      {
        name: 'point and message share a discussion',
        sql: `SELECT pp.id FROM planning_points pp JOIN messages m ON m.id = pp.source_message_id WHERE pp.discussion_id <> m.discussion_id`,
      },
      {
        name: 'package source and package share a discussion',
        sql: `SELECT wpp.work_package_version_id FROM work_package_points wpp
              JOIN work_package_versions wpv ON wpv.id = wpp.work_package_version_id
              JOIN work_packages wp ON wp.id = wpv.work_package_id
              JOIN planning_points pp ON pp.id = wpp.planning_point_id
              WHERE wp.discussion_id <> pp.discussion_id`,
      },
      {
        name: 'approved package lineage matches its approval snapshot',
        sql: `SELECT wpv.id FROM work_package_versions wpv
              WHERE wpv.status = 'READY_FOR_EXECUTION' AND (
                EXISTS (
                  SELECT planning_point_id FROM work_package_points WHERE work_package_version_id = wpv.id
                  EXCEPT
                  SELECT planning_point_id FROM approved_package_point_snapshots WHERE work_package_version_id = wpv.id
                )
                OR EXISTS (
                  SELECT planning_point_id FROM approved_package_point_snapshots WHERE work_package_version_id = wpv.id
                  EXCEPT
                  SELECT planning_point_id FROM work_package_points WHERE work_package_version_id = wpv.id
                )
              )`,
      },
      {
        name: 'approved versions have at least one snapshotted source',
        sql: `SELECT wpv.id FROM work_package_versions wpv
              WHERE wpv.status = 'READY_FOR_EXECUTION' AND (
                NOT EXISTS (
                  SELECT 1 FROM work_package_points wpp WHERE wpp.work_package_version_id = wpv.id
                )
                OR NOT EXISTS (
                  SELECT 1 FROM approved_package_point_snapshots snapshots
                  WHERE snapshots.work_package_version_id = wpv.id
                )
              )`,
      },
      {
        name: 'planning point identity and text match their immutable snapshots',
        sql: `SELECT pp.id FROM planning_points pp
              LEFT JOIN planning_point_identity_snapshots snapshots
                ON snapshots.planning_point_id = pp.id
              WHERE snapshots.planning_point_id IS NULL
                 OR snapshots.discussion_id IS NOT pp.discussion_id
                 OR snapshots.source_message_id IS NOT pp.source_message_id
                 OR snapshots.created_by_participant_id IS NOT pp.created_by_participant_id
                 OR snapshots.point_type IS NOT pp.point_type
                 OR snapshots.text IS NOT pp.text
                 OR snapshots.supersedes_point_id IS NOT pp.supersedes_point_id
                 OR snapshots.created_at IS NOT pp.created_at`,
      },
      {
        name: 'planning point decisions match immutable owner-authority snapshots',
        sql: `SELECT pp.id FROM planning_points pp
              LEFT JOIN participants decided_by ON decided_by.id = pp.decided_by_participant_id
              LEFT JOIN planning_point_decision_snapshots snapshots
                ON snapshots.planning_point_id = pp.id
              WHERE (
                pp.disposition = 'PROPOSED'
                AND (
                  pp.decided_by_participant_id IS NOT NULL
                  OR pp.decided_at IS NOT NULL
                  OR snapshots.planning_point_id IS NOT NULL
                )
              ) OR (
                pp.disposition <> 'PROPOSED'
                AND (
                  pp.decided_by_participant_id IS NULL
                  OR pp.decided_at IS NULL
                  OR length(trim(pp.decided_at)) = 0
                  OR decided_by.kind IS NOT 'OWNER'
                  OR snapshots.planning_point_id IS NULL
                  OR snapshots.disposition IS NOT pp.disposition
                  OR snapshots.decided_by_participant_id IS NOT pp.decided_by_participant_id
                  OR snapshots.decided_at IS NOT pp.decided_at
                )
              )`,
      },
      {
        name: 'completed agent runs have one contribution',
        sql: `SELECT ar.id FROM agent_runs ar LEFT JOIN messages m ON m.agent_run_id = ar.id
              WHERE ar.status = 'COMPLETED' GROUP BY ar.id HAVING COUNT(m.id) <> 1`,
      },
      {
        name: 'non-completed runs have no contribution',
        sql: `SELECT ar.id FROM agent_runs ar JOIN messages m ON m.agent_run_id = ar.id WHERE ar.status <> 'COMPLETED'`,
      },
      {
        name: 'unconfirmed Codex cleanup remains durably quarantined',
        sql: `SELECT ar.id FROM agent_runs ar
              WHERE ar.error_code = '${CODEX_CLEANUP_UNCONFIRMED}'
                AND (
                  ar.adapter <> 'codex'
                  OR ar.status NOT IN ('FAILED', 'INTERRUPTED')
                  OR ar.completed_at IS NULL
                )`,
      },
      {
        name: 'pending Codex cleanup remains incomplete and quarantined',
        sql: `SELECT ar.id FROM agent_runs ar
              WHERE ar.error_code = '${CODEX_CLEANUP_PENDING}'
                AND (
                  ar.adapter <> 'codex'
                  OR ar.status <> 'INTERRUPTED'
                  OR ar.completed_at IS NOT NULL
                )`,
      },
      {
        name: 'executions dispatch only approved versions',
        sql: `SELECT er.id FROM execution_runs er
              JOIN work_package_versions wpv ON wpv.id = er.work_package_version_id
              WHERE wpv.status <> 'READY_FOR_EXECUTION'`,
      },
      {
        name: 'executions are dispatched by an owner',
        sql: `SELECT er.id FROM execution_runs er
              LEFT JOIN participants p ON p.id = er.dispatched_by_participant_id
              WHERE p.id IS NULL OR p.kind <> 'OWNER'`,
      },
      {
        name: 'change sets belong to their dispatched version',
        sql: `SELECT ecs.id FROM execution_change_sets ecs
              JOIN execution_runs er ON er.id = ecs.execution_run_id
              WHERE ecs.work_package_version_id <> er.work_package_version_id`,
      },
      {
        name: 'only a succeeded execution carries a change set',
        sql: `SELECT er.id FROM execution_runs er
              JOIN execution_change_sets ecs ON ecs.execution_run_id = er.id
              WHERE er.status <> 'SUCCEEDED'`,
      },
      {
        name: 'applied files always match a recorded change set',
        sql: `SELECT ea.id FROM execution_applications ea
              LEFT JOIN execution_change_sets ecs ON ecs.execution_run_id = ea.execution_run_id
              WHERE ecs.id IS NULL
                 OR ecs.diff_sha256 <> ea.diff_sha256
                 OR ecs.file_count <> ea.file_count`,
      },
      {
        name: 'only a succeeded execution writes files',
        sql: `SELECT ea.id FROM execution_applications ea
              JOIN execution_runs er ON er.id = ea.execution_run_id
              WHERE er.status <> 'SUCCEEDED'`,
      },
      {
        name: 'a succeeded execution has exactly one change set',
        sql: `SELECT er.id FROM execution_runs er
              LEFT JOIN execution_change_sets ecs ON ecs.execution_run_id = er.id
              WHERE er.status = 'SUCCEEDED' AND ecs.id IS NULL`,
      },
      {
        name: 'retry sources have at most one child run',
        sql: `SELECT retry_of_run_id FROM agent_runs WHERE retry_of_run_id IS NOT NULL
              GROUP BY retry_of_run_id HAVING COUNT(*) > 1`,
      },
      {
        name: 'retry children preserve source discussion adapter and prompt',
        sql: `SELECT child.id FROM agent_runs child
              JOIN agent_runs parent ON parent.id = child.retry_of_run_id
              WHERE child.discussion_id <> parent.discussion_id
                 OR child.adapter <> parent.adapter
                 OR child.prompt <> parent.prompt`,
      },
    ];
    const failures = checks.flatMap(check => {
      const rows = this.database.prepare(check.sql).all();
      return rows.length ? [{ name: check.name, rows }] : [];
    });
    if (failures.length) throw new AppError(500, 'INVARIANT_VIOLATION', 'Planning-loop invariants failed.', { failures });
    return { passed: checks.map(check => check.name), checkedAt: now() };
  }

  requireProject(id) {
    const row = this.database.prepare(`
      SELECT id, name, repository_root AS repositoryRoot, created_at AS createdAt, row_version AS rowVersion
      FROM projects WHERE id = ?
    `).get(id);
    if (!row) throw notFound('Project not found.');
    return mapProject(row);
  }

  requireDiscussion(id) {
    const row = this.database.prepare(`
      SELECT id, project_id AS projectId, title, status, created_at AS createdAt,
             updated_at AS updatedAt, row_version AS rowVersion
      FROM discussions WHERE id = ?
    `).get(id);
    if (!row) throw notFound('Planning room not found.');
    return mapDiscussion(row);
  }

  requireDiscussionContext(id) {
    const row = this.database.prepare(`
      SELECT d.id, d.codex_thread_id AS codexThreadId, p.repository_root AS repositoryRoot
      FROM discussions d JOIN projects p ON p.id = d.project_id WHERE d.id = ?
    `).get(id);
    if (!row) throw notFound('Planning room not found.');
    return row;
  }

  requireMessage(id) {
    const row = this.database.prepare(`
      SELECT id, discussion_id AS discussionId, participant_id AS participantId,
             content, contribution_type AS contributionType, created_at AS createdAt
      FROM messages WHERE id = ?
    `).get(id);
    if (!row) throw notFound('Source contribution not found.');
    return row;
  }

  requireRun(id) {
    const row = this.database.prepare(`
      SELECT id, discussion_id AS discussionId, participant_id AS participantId,
             adapter, provider, model, prompt, status, error_code AS errorCode,
             error_message AS errorMessage, retry_of_run_id AS retryOfRunId,
             started_at AS startedAt, completed_at AS completedAt, row_version AS rowVersion
      FROM agent_runs WHERE id = ?
    `).get(id);
    if (!row) throw notFound('Agent contribution run not found.');
    return mapRun(row);
  }

  requirePoint(id) {
    const row = this.database.prepare(`
      SELECT id, discussion_id AS discussionId, source_message_id AS sourceMessageId,
             created_by_participant_id AS createdByParticipantId, point_type AS pointType,
             text, disposition, decided_by_participant_id AS decidedByParticipantId,
             decided_at AS decidedAt, supersedes_point_id AS supersedesPointId,
             created_at AS createdAt, row_version AS rowVersion
      FROM planning_points WHERE id = ?
    `).get(id);
    if (!row) throw notFound('Planning point not found.');
    return mapPoint(row);
  }

  executionBackupDirectory(runId) {
    return path.resolve('var', 'execution-backups', runId);
  }

  async revertExecution(runId, input = {}, actorId) {
    this.assertOwner(actorId);
    const normalizedRunId = requiredId(runId, 'Execution run');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const application = this.database.prepare(`
      SELECT id, repository_root AS repositoryRoot, backup_manifest_json AS manifestJson,
             reverted_at AS revertedAt
      FROM execution_applications WHERE execution_run_id = ?
    `).get(normalizedRunId);
    if (!application) throw notFound('That execution did not change any files.');
    if (application.revertedAt) throw conflict('That execution was already reverted.');
    const restored = await revertApplication({
      repositoryRoot: application.repositoryRoot,
      backupDirectory: this.executionBackupDirectory(normalizedRunId),
      manifest: JSON.parse(application.manifestJson),
    });
    const { value } = mutation(this.database, {
      idempotencyKey,
      operation: 'execution.revert',
      request: { runId: normalizedRunId, actorId },
    }, () => {
      const revertedAt = now();
      this.database.prepare(`
        UPDATE execution_applications SET reverted_at = ? WHERE id = ? AND reverted_at = ''
      `).run(revertedAt, application.id);
      appendAudit(this.database, {
        eventType: 'EXECUTION_REVERTED', resourceType: 'EXECUTION_RUN', resourceId: normalizedRunId,
        actorId, details: { files: restored.length },
      });
      return this.requireExecutionRun(normalizedRunId);
    });
    return value;
  }

  requireExecutionRun(id) {
    const row = this.database.prepare(`
      SELECT er.id, er.work_package_version_id AS workPackageVersionId, er.adapter, er.provider,
             er.model, er.status, er.error_code AS errorCode, er.error_message AS errorMessage,
             er.started_at AS startedAt, er.completed_at AS completedAt,
             er.row_version AS rowVersion, p.display_name AS displayName,
             ecs.id AS changeSetId, ecs.diff, ecs.diff_sha256 AS diffSha256,
             ecs.file_count AS fileCount, ecs.created_at AS changeSetCreatedAt,
             ea.applied_at AS appliedAt, ea.reverted_at AS revertedAt
      FROM execution_runs er
      JOIN participants p ON p.id = er.participant_id
      LEFT JOIN execution_change_sets ecs ON ecs.execution_run_id = er.id
      LEFT JOIN execution_applications ea ON ea.execution_run_id = er.id
      WHERE er.id = ?
    `).get(id);
    if (!row) throw notFound('Execution run not found.');
    return mapExecutionRun(row);
  }

  async dispatchExecution(versionId, input = {}, actorId) {
    this.assertOwner(actorId);
    const normalizedVersionId = requiredId(versionId, 'Work-package version');
    const adapterName = oneOf(input.adapter || 'codex', ['codex', 'deterministic'], 'Execution adapter');
    const adapter = this.agents.get(adapterName);
    if (typeof adapter.execute !== 'function') {
      throw capabilityUnavailable(`The ${adapterName} participant cannot execute a package.`, { adapter: adapterName });
    }
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const version = this.requirePackageVersion(normalizedVersionId);
    if (version.status !== 'READY_FOR_EXECUTION') {
      throw conflict('Only an approved work-package version can be dispatched for execution.');
    }
    const discussionRow = this.database.prepare(`
      SELECT d.id FROM discussions d
      JOIN work_packages wp ON wp.discussion_id = d.id
      WHERE wp.id = ?
    `).get(version.workPackageId);
    if (!discussionRow) throw notFound('Planning room not found.');
    const context = this.requireDiscussionContext(discussionRow.id);
    // Re-validate the allowlisted root at dispatch: an approval can outlive a moved repository.
    const repositoryRoot = await validateRepositoryRoot(context.repositoryRoot);
    const participantIdentity = {
      participantKey: `agent:${adapter.provider}:${adapter.model}:${adapter.id}`,
      kind: 'AGENT',
      displayName: adapter.displayName,
      provider: adapter.provider,
      model: adapter.model,
    };

    const { value, replayed } = mutation(this.database, {
      idempotencyKey,
      operation: 'execution.dispatch',
      request: { versionId: normalizedVersionId, actorId, adapter: adapterName, repositoryRoot },
    }, () => {
      const participant = this.ensureParticipant(participantIdentity);
      const run = {
        id: randomUUID(),
        workPackageVersionId: normalizedVersionId,
        discussionId: discussionRow.id,
        adapter: adapterName,
        provider: adapter.provider,
        model: adapter.model,
        displayName: adapter.displayName,
        status: 'RUNNING',
        errorCode: '',
        errorMessage: '',
        startedAt: now(),
        completedAt: '',
        rowVersion: 1,
        changeSet: null,
      };
      this.database.prepare(`
        INSERT INTO execution_runs(
          id, work_package_version_id, discussion_id, participant_id,
          dispatched_by_participant_id, adapter, provider, model, repository_root,
          status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
      `).run(
        run.id, normalizedVersionId, discussionRow.id, participant.id, actorId,
        adapterName, adapter.provider, adapter.model, repositoryRoot, run.startedAt,
      );
      this.touchDiscussion(discussionRow.id, run.startedAt);
      appendAudit(this.database, {
        eventType: 'EXECUTION_DISPATCHED', resourceType: 'EXECUTION_RUN', resourceId: run.id, actorId,
        details: { workPackageVersionId: normalizedVersionId, adapter: adapterName },
      });
      return run;
    });

    if (!replayed && value.status === 'RUNNING' && !this.activeExecutions.has(value.id)) {
      const controller = new AbortController();
      this.activeExecutions.set(value.id, { controller });
      const completion = this.completeExecutionRun({
        run: value, adapter, content: version.content, repositoryRoot, controller,
      }).finally(() => this.activeExecutions.delete(value.id));
      this.trackedExecutions.add(completion);
      completion.finally(() => this.trackedExecutions.delete(completion));
    }
    return this.requireExecutionRun(value.id);
  }

  async completeExecutionRun({ run, adapter, content, repositoryRoot, controller }) {
    try {
      const result = await adapter.execute({ content, repositoryRoot, signal: controller.signal });
      const changeSet = buildChangeSet(result?.diff);
      // The owner approved this package; applying it is the authorized act.
      // Every touched file is snapshotted first so revert never needs git.
      const backupDirectory = this.executionBackupDirectory(run.id);
      const application = changeSet.fileCount
        ? await applyChangeSet({ repositoryRoot, backupDirectory, diff: changeSet.diff })
        : { applied: false, manifest: [] };
      const completedAt = now();
      transaction(this.database, () => {
        const current = this.requireExecutionRun(run.id);
        if (current.status !== 'RUNNING') return;
        this.database.prepare(`
          INSERT INTO execution_change_sets(
            id, execution_run_id, work_package_version_id, diff, diff_sha256, file_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), run.id, run.workPackageVersionId,
          changeSet.diff, changeSet.diffSha256, changeSet.fileCount, completedAt,
        );
        this.database.prepare(`
          UPDATE execution_runs
          SET status = 'SUCCEEDED', completed_at = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'RUNNING'
        `).run(completedAt, run.id);
        if (application.applied) {
          this.database.prepare(`
            INSERT INTO execution_applications(
              id, execution_run_id, work_package_version_id, diff_sha256, file_count,
              repository_root, backup_manifest_json, applied_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            randomUUID(), run.id, run.workPackageVersionId, changeSet.diffSha256,
            changeSet.fileCount, repositoryRoot, JSON.stringify(application.manifest), completedAt,
          );
        }
        appendAudit(this.database, {
          eventType: application.applied ? 'EXECUTION_CHANGE_SET_APPLIED' : 'EXECUTION_CHANGE_SET_RECORDED',
          resourceType: 'EXECUTION_RUN',
          resourceId: run.id,
          actorId: null,
          details: { fileCount: changeSet.fileCount, diffSha256: changeSet.diffSha256 },
        });
      });
      this.touchDiscussion(run.discussionId, completedAt);
    } catch (error) {
      // A shutdown races the database close; startup recovery marks the run interrupted.
      if (this.shuttingDown) return;
      const failure = safeAgentFailure(error, run.adapter);
      const completedAt = now();
      const status = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
      this.database.prepare(`
        UPDATE execution_runs
        SET status = ?, error_code = ?, error_message = ?, completed_at = ?,
            row_version = row_version + 1
        WHERE id = ? AND status = 'RUNNING'
      `).run(status, failure.code, failure.message, completedAt, run.id);
      this.touchDiscussion(run.discussionId, completedAt);
    }
  }

  cancelExecution(runId, input = {}, actorId) {
    this.assertOwner(actorId);
    const normalizedRunId = requiredId(runId, 'Execution run');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value } = mutation(this.database, {
      idempotencyKey,
      operation: 'execution.cancel',
      request: { runId: normalizedRunId, actorId },
    }, () => {
      const run = this.requireExecutionRun(normalizedRunId);
      if (run.status !== 'RUNNING') return run;
      this.activeExecutions.get(normalizedRunId)?.controller.abort();
      this.database.prepare(`
        UPDATE execution_runs
        SET status = 'CANCELLED', error_code = 'CANCELLED',
            error_message = 'The owner cancelled this execution.',
            completed_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'RUNNING'
      `).run(now(), normalizedRunId);
      appendAudit(this.database, {
        eventType: 'EXECUTION_CANCELLED', resourceType: 'EXECUTION_RUN', resourceId: normalizedRunId, actorId,
        details: {},
      });
      return this.requireExecutionRun(normalizedRunId);
    });
    return value;
  }

  requirePackageVersion(id) {
    const row = this.database.prepare(`
      SELECT wpv.id, wpv.work_package_id AS workPackageId, wpv.version_number AS versionNumber,
             wpv.status, wpv.content_json AS contentJson, wpv.created_at AS createdAt,
             wpv.updated_at AS updatedAt, wpv.approved_at AS approvedAt,
             wpv.row_version AS rowVersion,
             GROUP_CONCAT(wpp.planning_point_id) AS sourcePointIds
      FROM work_package_versions wpv
      LEFT JOIN work_package_points wpp ON wpp.work_package_version_id = wpv.id
      WHERE wpv.id = ? GROUP BY wpv.id
    `).get(id);
    if (!row) throw notFound('Work-package version not found.');
    return mapPackageVersion(row);
  }

  findDraftVersion(discussionId) {
    const row = this.database.prepare(`
      SELECT wpv.id
      FROM work_package_versions wpv JOIN work_packages wp ON wp.id = wpv.work_package_id
      WHERE wp.discussion_id = ? AND wpv.status = 'DRAFT'
      ORDER BY wpv.version_number DESC LIMIT 1
    `).get(discussionId);
    return row ? this.requirePackageVersion(row.id) : null;
  }

  requireParticipant(id) {
    const row = this.database.prepare(`
      SELECT id, kind, display_name AS displayName, provider, model FROM participants WHERE id = ?
    `).get(id);
    if (!row) throw notFound('Participant not found.');
    return mapParticipant(row);
  }

  ensureParticipant({ participantKey, kind, displayName, provider, model }) {
    const existing = this.database.prepare(`
      SELECT id, kind, display_name AS displayName, provider, model FROM participants WHERE participant_key = ?
    `).get(participantKey);
    if (existing) {
      const participant = mapParticipant(existing);
      if (!sameParticipantIdentity(participant, { kind, displayName, provider, model })) {
        throw new AppError(500, 'INVARIANT_VIOLATION', 'A participant identity key resolved to different attribution metadata.');
      }
      return participant;
    }
    const participant = { id: randomUUID(), kind, displayName, provider, model };
    this.database.prepare(`
      INSERT INTO participants(id, participant_key, kind, display_name, provider, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(participant.id, participantKey, kind, displayName, provider || null, model || null, now());
    return participant;
  }

  ensureImportedParticipant(identity) {
    const participantKey = importedParticipantKey(identity);
    const existingByKey = this.database.prepare(`
      SELECT id, kind, display_name AS displayName, provider, model
      FROM participants WHERE participant_key = ?
    `).get(participantKey);
    if (existingByKey) {
      const participant = mapParticipant(existingByKey);
      if (!sameParticipantIdentity(participant, identity)) {
        throw new AppError(500, 'INVARIANT_VIOLATION', 'An imported participant identity key resolved to different attribution metadata.');
      }
      return participant;
    }

    const legacy = this.database.prepare(`
      SELECT id, kind, display_name AS displayName, provider, model
      FROM participants WHERE participant_key = ? AND kind = 'IMPORTED'
    `).get(legacyImportedParticipantKey(identity));
    if (legacy) {
      const participant = mapParticipant(legacy);
      if (sameParticipantIdentity(participant, identity)) return participant;
      // Legacy delimiter collisions cannot be repaired retrospectively; a v2 key keeps new attribution exact.
    }
    return this.ensureParticipant({ participantKey, ...identity });
  }

  touchDiscussion(id, timestamp) {
    this.database.prepare(`
      UPDATE discussions SET updated_at = ?, row_version = row_version + 1 WHERE id = ?
    `).run(timestamp, id);
  }

  confirmPendingCodexCleanup(run, completedAt) {
    const update = this.database.prepare(`
      UPDATE agent_runs
      SET status = 'INTERRUPTED', error_code = 'CANCELLED',
          error_message = 'The owner cancelled this contribution.', completed_at = ?,
          row_version = row_version + 1
      WHERE id = ? AND adapter = 'codex' AND status = 'INTERRUPTED'
        AND error_code = ?
    `).run(completedAt, run.id, CODEX_CLEANUP_PENDING);
    if (Number(update.changes) !== 1) return false;
    this.touchDiscussion(run.discussionId, completedAt);
    appendAudit(this.database, {
      eventType: 'AGENT_CLEANUP_CONFIRMED',
      resourceType: 'AGENT_RUN',
      resourceId: run.id,
      actorId: run.participantId,
      details: { reason: 'CANCELLED' },
    });
    return true;
  }

  assertCodexTurnAvailable({ discussionId, threadId }) {
    const quarantinedRun = this.findCodexCleanupQuarantine({ discussionId, threadId });
    if (quarantinedRun) {
      if (quarantinedRun.errorCode === CODEX_CLEANUP_PENDING) {
        throw conflict('Codex cancellation is still being confirmed. Wait for provider cleanup before starting another Codex turn.');
      }
      throw conflict('Andamento could not confirm that an earlier Codex turn stopped. Further Codex work in this planning room or shared Codex thread is blocked to prevent overlap.');
    }
    const overlappingRun = [...this.activeRuns.values()].find(activeRun => (
      activeRun.adapter === 'codex'
      && (
        activeRun.discussionId === discussionId
        || (threadId && activeRun.threadId && activeRun.threadId === threadId)
      )
    ));
    if (overlappingRun) {
      throw conflict('Codex is still contributing in this planning room or shared Codex thread. Wait for it to finish before starting another Codex turn.');
    }
  }

  findCodexCleanupQuarantine({ discussionId, threadId }) {
    const normalizedThreadId = threadId || '';
    return this.database.prepare(`
      SELECT prior_run.id, prior_run.error_code AS errorCode
      FROM agent_runs prior_run
      JOIN discussions prior_discussion ON prior_discussion.id = prior_run.discussion_id
      WHERE prior_run.adapter = 'codex'
        AND prior_run.error_code IN (?, ?)
        AND (
          prior_run.discussion_id = ?
          OR (? <> '' AND prior_discussion.codex_thread_id = ?)
        )
      LIMIT 1
    `).get(
      CODEX_CLEANUP_PENDING,
      CODEX_CLEANUP_UNCONFIRMED,
      discussionId,
      normalizedThreadId,
      normalizedThreadId,
    );
  }

  assertOwner(actorId) {
    const actor = this.requireParticipant(actorId);
    if (actor.kind !== 'OWNER') throw forbidden('Only the owner can make planning decisions or approve work.');
    return actor;
  }

  resolveActor(requestedActorId) {
    if (!requestedActorId || !this.testMode) return OWNER_ID;
    return requiredId(requestedActorId, 'Actor');
  }

  createTestParticipant(input) {
    if (!this.testMode) throw notFound();
    const kind = oneOf(input.kind || 'AGENT', ['OWNER', 'AGENT', 'IMPORTED'], 'Participant kind');
    const displayName = requiredText(input.displayName || 'Test agent', 'Participant name', { max: 80 });
    return transaction(this.database, () => this.ensureParticipant({
      participantKey: `test:${kind}:${displayName.toLowerCase()}:${randomUUID()}`,
      kind,
      displayName,
      provider: optionalText(input.provider || 'test', 'Provider', { max: 80 }),
      model: optionalText(input.model || 'test', 'Model', { max: 120 }),
    }));
  }

  shutdown({ timeoutMs = 6000 } = {}) {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    for (const state of this.activeExecutions.values()) state.controller.abort();
    const active = [...this.activeRuns.entries()];
    this.shutdownPromise = (async () => {
      for (const [, state] of active) state.controller.abort();
      if (active.length) {
        const pendingRunIds = new Set(active.map(([runId]) => runId));
        const settled = Promise.allSettled(active.map(([runId, state]) => (
          Promise.resolve(state.completion).finally(() => pendingRunIds.delete(runId))
        )));
        let timeoutHandle;
        try {
          await Promise.race([
            settled,
            new Promise(resolve => { timeoutHandle = setTimeout(resolve, timeoutMs); }),
          ]);
        } finally {
          clearTimeout(timeoutHandle);
        }
        const completedAt = now();
        transaction(this.database, () => {
          for (const [runId, state] of active) {
            const cleanupUnconfirmed = state.adapter === 'codex'
              && state.providerStarted === true
              && pendingRunIds.has(runId);
            const errorCode = cleanupUnconfirmed ? CODEX_CLEANUP_UNCONFIRMED : 'SERVICE_SHUTDOWN';
            const errorMessage = cleanupUnconfirmed
              ? SAFE_AGENT_FAILURES.get(CODEX_CLEANUP_UNCONFIRMED)
              : 'The local service stopped before this contribution completed. Retry is available.';
            const update = this.database.prepare(cleanupUnconfirmed ? `
              UPDATE agent_runs
              SET status = 'INTERRUPTED', error_code = ?,
                  error_message = ?,
                  completed_at = ?, row_version = row_version + 1
              WHERE id = ? AND status IN ('RUNNING', 'INTERRUPTED')
            ` : `
              UPDATE agent_runs
              SET status = 'INTERRUPTED', error_code = ?,
                  error_message = ?,
                  completed_at = ?, row_version = row_version + 1
              WHERE id = ? AND status = 'RUNNING'
            `).run(errorCode, errorMessage, completedAt, runId);
            if (Number(update.changes) === 1) {
              appendAudit(this.database, {
                eventType: cleanupUnconfirmed ? 'AGENT_CLEANUP_UNCONFIRMED' : 'AGENT_RUN_INTERRUPTED',
                resourceType: 'AGENT_RUN',
                resourceId: runId,
                details: { reason: errorCode },
              });
            }
          }
        });
      }
      this.shutdownFinalized = true;
      this.activeRuns.clear();
    })();
    return this.shutdownPromise;
  }
}

export function safeServiceCall(callback) {
  try {
    return callback();
  } catch (error) {
    throw normalizeError(error);
  }
}
