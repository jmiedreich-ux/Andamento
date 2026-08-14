import { randomUUID } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
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

const OWNER_ID = 'owner-local';
const POINT_TYPES = ['QUESTION', 'DECISION', 'REQUIREMENT', 'CONSTRAINT', 'RISK', 'DEPENDENCY', 'ASSUMPTION', 'PROPOSED_WORK', 'PARKING_LOT'];
const POINT_DECISIONS = ['ACCEPTED', 'REJECTED', 'DEFERRED'];
const SAFE_AGENT_FAILURES = new Map([
  ['CANCELLED', 'The owner cancelled this contribution.'],
  ['CODEX_FAILURE', 'Codex could not complete this contribution. Retry is available.'],
  ['DETERMINISTIC_FAILURE', 'The planning participant could not complete this attempt. Retry is available.'],
  ['MALFORMED_CONTRIBUTION', 'The participant returned an unusable contribution.'],
]);

function safeAgentFailure(error) {
  const requestedCode = String(error?.code || '').toUpperCase();
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
  let resolved;
  try {
    resolved = await realpath(requested);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error('not-directory');
    await access(path.join(resolved, '.git'));
  } catch {
    throw validationError('Repository root must be an existing local Git repository.', { field: 'repositoryRoot' });
  }
  return resolved;
}

export class PlanningService {
  constructor({ database, agents, testMode = false }) {
    this.database = database;
    this.agents = agents;
    this.testMode = testMode;
    this.activeRuns = new Map();
    this.shuttingDown = false;
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'project.create' }, () => {
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'discussion.create' }, () => {
      const id = randomUUID();
      const createdAt = now();
      this.database.prepare(`
        INSERT INTO discussions(id, project_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, normalizedProjectId, title, createdAt, createdAt);
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

    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'message.create' }, () => {
      const storedParticipant = contributionType === 'OWNER'
        ? participant
        : this.ensureParticipant({
            participantKey: `imported:${participant.provider.toLowerCase()}:${participant.model.toLowerCase()}:${participant.displayName.toLowerCase()}`,
            ...participant,
          });
      const id = randomUUID();
      const createdAt = now();
      this.database.prepare(`
        INSERT INTO messages(id, discussion_id, participant_id, content, contribution_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, normalizedDiscussionId, storedParticipant.id, content, contributionType, createdAt);
      this.touchDiscussion(normalizedDiscussionId, createdAt);
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
    this.assertOwner(actorId);
    const normalizedDiscussionId = requiredId(discussionId, 'Discussion');
    const context = this.requireDiscussionContext(normalizedDiscussionId);
    const adapterName = oneOf(input.adapter || 'codex', ['codex', 'deterministic'], 'Agent adapter');
    const adapter = this.agents.get(adapterName);
    const prompt = requiredText(input.prompt, 'Agent prompt', { max: 12000 });
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const retryOfRunId = input.retryOfRunId ? requiredId(input.retryOfRunId, 'Retry run') : null;
    const participant = this.ensureParticipantOutsideMutation({
      participantKey: `agent:${adapter.provider}:${adapter.model}:${adapter.id}`,
      kind: 'AGENT',
      displayName: adapter.displayName,
      provider: adapter.provider,
      model: adapter.model,
    });

    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'agent-run.start' }, () => {
      if (retryOfRunId) {
        const prior = this.requireRun(retryOfRunId);
        if (prior.discussionId !== normalizedDiscussionId) throw conflict('The retry source belongs to a different planning room.');
        if (!['FAILED', 'INTERRUPTED'].includes(prior.status)) throw conflict('Only a failed or interrupted contribution can be retried.');
        const existingRetry = this.database.prepare(`
          SELECT id FROM agent_runs WHERE retry_of_run_id = ? ORDER BY started_at, id LIMIT 1
        `).get(retryOfRunId);
        if (existingRetry) return this.requireRun(existingRetry.id);
      }
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
        retryOfRunId: retryOfRunId || '',
        startedAt: now(),
        completedAt: '',
        rowVersion: 1,
      };
      this.database.prepare(`
        INSERT INTO agent_runs(
          id, discussion_id, participant_id, adapter, provider, model, prompt, status,
          retry_of_run_id, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?)
      `).run(run.id, run.discussionId, run.participantId, run.adapter, run.provider, run.model, run.prompt, retryOfRunId, run.startedAt);
      this.touchDiscussion(normalizedDiscussionId, run.startedAt);
      appendAudit(this.database, {
        eventType: 'AGENT_RUN_STARTED', resourceType: 'AGENT_RUN', resourceId: run.id, actorId,
        details: { discussionId: normalizedDiscussionId, adapter: adapterName, retryOfRunId },
      });
      return run;
    });

    if (!replayed && value.status === 'RUNNING' && !this.activeRuns.has(value.id)) {
      const controller = new AbortController();
      this.activeRuns.set(value.id, controller);
      void this.completeAgentRun({
        run: value,
        adapter,
        context,
        controller,
      });
    }
    return { run: value, replayed };
  }

  retryAgentRun(runId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const prior = this.requireRun(requiredId(runId, 'Agent run'));
    if (!['FAILED', 'INTERRUPTED'].includes(prior.status)) {
      throw conflict('Only a failed or interrupted contribution can be retried.');
    }
    return this.startAgentRun(prior.discussionId, {
      adapter: prior.adapter,
      prompt: prior.prompt,
      retryOfRunId: prior.id,
      idempotencyKey: input.idempotencyKey,
    }, actorId);
  }

  cancelAgentRun(runId, input, actorId = OWNER_ID) {
    this.assertOwner(actorId);
    const normalizedRunId = requiredId(runId, 'Agent run');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'agent-run.cancel' }, () => {
      const run = this.requireRun(normalizedRunId);
      if (run.status !== 'RUNNING') return run;
      const completedAt = now();
      this.database.prepare(`
        UPDATE agent_runs
        SET status = 'INTERRUPTED', error_code = 'CANCELLED',
            error_message = 'The owner cancelled this contribution.', completed_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'RUNNING'
      `).run(completedAt, normalizedRunId);
      appendAudit(this.database, {
        eventType: 'AGENT_RUN_CANCELLED', resourceType: 'AGENT_RUN', resourceId: normalizedRunId, actorId,
        details: {},
      });
      return this.requireRun(normalizedRunId);
    });
    this.activeRuns.get(normalizedRunId)?.abort();
    return { run: value, replayed };
  }

  async completeAgentRun({ run, adapter, context, controller }) {
    try {
      const contribution = await adapter.contribute({
        prompt: run.prompt,
        repositoryRoot: context.repositoryRoot,
        threadId: context.codexThreadId,
        retryOfRunId: run.retryOfRunId || '',
        signal: controller.signal,
        onThread: async threadId => {
          if (this.shuttingDown) return;
          transaction(this.database, () => {
            this.database.prepare(`
              UPDATE discussions SET codex_thread_id = ?, updated_at = ?, row_version = row_version + 1
              WHERE id = ?
            `).run(threadId, now(), run.discussionId);
          });
        },
      });
      if (this.shuttingDown) return;
      transaction(this.database, () => {
        const current = this.requireRun(run.id);
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
      if (this.shuttingDown) return;
      const failure = safeAgentFailure(error);
      transaction(this.database, () => {
        const current = this.requireRun(run.id);
        if (current.status !== 'RUNNING') return;
        const completedAt = now();
        this.database.prepare(`
          UPDATE agent_runs
          SET status = 'FAILED', error_code = ?, error_message = ?, completed_at = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'RUNNING'
        `).run(failure.code, failure.message, completedAt, run.id);
        this.touchDiscussion(run.discussionId, completedAt);
        appendAudit(this.database, {
          eventType: 'AGENT_CONTRIBUTION_FAILED', resourceType: 'AGENT_RUN', resourceId: run.id,
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'planning-point.capture' }, () => {
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
    if (original.disposition !== 'PROPOSED') {
      throw conflict('A decided planning point is immutable. Create a new proposal from its source instead.');
    }
    const pointType = oneOf(input.pointType || original.pointType, POINT_TYPES, 'Planning-point type');
    const text = requiredText(input.text, 'Planning point', { max: 2000 });
    const version = expectedVersion(input.expectedVersion);
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'planning-point.replace' }, () => {
      const current = this.requirePoint(original.id);
      if (current.rowVersion !== version) {
        throw conflict('This planning point changed in another view.', { current });
      }
      if (current.disposition !== 'PROPOSED') throw conflict('This planning point was already decided.', { current });
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'planning-point.disposition' }, () => {
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'work-package.prepare' }, () => {
      const existingDraft = this.findDraftVersion(normalizedDiscussionId);
      if (existingDraft) return existingDraft;
      const acceptedPoints = this.database.prepare(`
        SELECT id, text FROM planning_points
        WHERE discussion_id = ? AND disposition = 'ACCEPTED'
        ORDER BY created_at, id
      `).all(normalizedDiscussionId);
      if (!acceptedPoints.length) throw validationError('Accept at least one planning point before preparing a package.');
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
        content: {
          outcome: '',
          includedScope: acceptedPoints.map(point => point.text),
          exclusions: [],
          acceptanceCriteria: [],
          reviewRequirements: [],
          evidenceRequirements: [],
        },
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'work-package.update' }, () => {
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'work-package.approve' }, () => {
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
    const { value, replayed } = mutation(this.database, { idempotencyKey, operation: 'work-package.new-version' }, () => {
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

  getDiscussion(discussionId) {
    const id = requiredId(discussionId, 'Discussion');
    const discussionRow = this.database.prepare(`
      SELECT d.id, d.project_id AS projectId, d.title, d.status, d.created_at AS createdAt,
             d.updated_at AS updatedAt, d.row_version AS rowVersion,
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
      workPackage = { ...packageRow, versions, currentVersion: versions[0] || null, approvals };
    }
    return { project, discussion, messages, runs, points, workPackage };
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
        name: 'completed agent runs have one contribution',
        sql: `SELECT ar.id FROM agent_runs ar LEFT JOIN messages m ON m.agent_run_id = ar.id
              WHERE ar.status = 'COMPLETED' GROUP BY ar.id HAVING COUNT(m.id) <> 1`,
      },
      {
        name: 'non-completed runs have no contribution',
        sql: `SELECT ar.id FROM agent_runs ar JOIN messages m ON m.agent_run_id = ar.id WHERE ar.status <> 'COMPLETED'`,
      },
      {
        name: 'retry sources have at most one child run',
        sql: `SELECT retry_of_run_id FROM agent_runs WHERE retry_of_run_id IS NOT NULL
              GROUP BY retry_of_run_id HAVING COUNT(*) > 1`,
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
    if (existing) return mapParticipant(existing);
    const participant = { id: randomUUID(), kind, displayName, provider, model };
    this.database.prepare(`
      INSERT INTO participants(id, participant_key, kind, display_name, provider, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(participant.id, participantKey, kind, displayName, provider || null, model || null, now());
    return participant;
  }

  ensureParticipantOutsideMutation(input) {
    return transaction(this.database, () => this.ensureParticipant(input));
  }

  touchDiscussion(id, timestamp) {
    this.database.prepare(`
      UPDATE discussions SET updated_at = ?, row_version = row_version + 1 WHERE id = ?
    `).run(timestamp, id);
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

  shutdown() {
    this.shuttingDown = true;
    for (const controller of this.activeRuns.values()) controller.abort();
    this.activeRuns.clear();
  }
}

export function safeServiceCall(callback) {
  try {
    return callback();
  } catch (error) {
    throw normalizeError(error);
  }
}
