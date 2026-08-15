import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { createApplication } from '../../server/application.mjs';
import { PlanningService } from '../../server/planning-service.mjs';

const execFileAsync = promisify(execFile);

export function idempotencyKey(label) {
  return `${label}:${randomUUID()}`;
}

export function completePackageContent(overrides = {}) {
  return {
    outcome: 'Produce one immutable, owner-approved planning package.',
    includedScope: ['Preserve accepted source lineage.'],
    exclusions: ['Do not execute repository work.'],
    acceptanceCriteria: ['The approved version is READY_FOR_EXECUTION.'],
    reviewRequirements: ['Independent implementation review is required.'],
    evidenceRequirements: ['Record rerunnable local test output.'],
    ...overrides,
  };
}

export async function createFixture(t, options = {}) {
  assert.equal(process.platform, 'win32', 'Integration tests must run with Windows Node.');
  const windowsTemp = os.tmpdir();
  const root = await mkdtemp(path.join(windowsTemp, 'andamento-service-test-'));
  const relativeToTemp = path.relative(windowsTemp, root);
  assert.ok(relativeToTemp && !relativeToTemp.startsWith('..') && !path.isAbsolute(relativeToTemp));
  const databasePath = path.join(root, 'storage', 'andamento.test.db');
  let application = null;

  async function open() {
    assert.equal(application, null, 'Close the current application before reopening the fixture.');
    application = await createApplication({
      databasePath,
      host: '127.0.0.1',
      port: 0,
      testMode: true,
      enableDeterministic: true,
      ...options,
    });
    assert.ok(application.service instanceof PlanningService);
    return application;
  }

  async function close() {
    if (!application) return;
    const closing = application;
    application = null;
    await closing.close();
  }

  async function makeRepository(name = `repository-${randomUUID()}`) {
    const repositoryRoot = path.join(root, name);
    await mkdir(repositoryRoot, { recursive: true });
    await execFileAsync('git', ['init', '--quiet', repositoryRoot], {
      encoding: 'utf8',
      maxBuffer: 4096,
      timeout: 5000,
      windowsHide: true,
    });
    return repositoryRoot;
  }

  async function makeFakeRepository(name = `fake-repository-${randomUUID()}`) {
    const repositoryRoot = path.join(root, name);
    await mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    return repositoryRoot;
  }

  async function makeNonRepository(name = `not-a-repository-${randomUUID()}`) {
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async function makeFile(name = `plain-file-${randomUUID()}`) {
    const file = path.join(root, name);
    await writeFile(file, 'not a repository', 'utf8');
    return file;
  }

  t.after(async () => {
    await close();
    const cleanupRelative = path.relative(windowsTemp, root);
    assert.ok(cleanupRelative && !cleanupRelative.startsWith('..') && !path.isAbsolute(cleanupRelative));
    await rm(root, { recursive: true, force: true });
  });

  await open();
  return {
    root,
    databasePath,
    get application() {
      return application;
    },
    get service() {
      return application.service;
    },
    get database() {
      return application.database;
    },
    open,
    close,
    makeRepository,
    makeFakeRepository,
    makeNonRepository,
    makeFile,
  };
}

export async function createProjectAndDiscussion(fixture, names = {}) {
  const repositoryRoot = await fixture.makeRepository(names.repositoryDirectory);
  const projectResult = await fixture.service.createProject({
    name: names.projectName || 'Test project',
    repositoryRoot,
    idempotencyKey: idempotencyKey('project'),
  });
  const discussionResult = fixture.service.createDiscussion(projectResult.project.id, {
    title: names.discussionTitle || 'Planning room',
    idempotencyKey: idempotencyKey('discussion'),
  });
  return {
    repositoryRoot,
    project: projectResult.project,
    discussion: discussionResult.discussion,
  };
}

export function addOwnerMessage(service, discussionId, content = 'Keep authority and lineage explicit.') {
  return service.addMessage(discussionId, {
    content,
    contributionType: 'OWNER',
    idempotencyKey: idempotencyKey('owner-message'),
  }).message;
}

export function captureAndAcceptPoint(service, messageId, text = 'Only accepted points become package sources.') {
  const point = service.capturePoint(messageId, {
    pointType: 'REQUIREMENT',
    text,
    idempotencyKey: idempotencyKey('point'),
  }).point;
  return service.dispositionPoint(point.id, {
    disposition: 'ACCEPTED',
    expectedVersion: point.rowVersion,
    idempotencyKey: idempotencyKey('accept-point'),
  }).point;
}

export function prepareCompleteDraft(service, discussionId, content = completePackageContent()) {
  const prepared = service.preparePackage(discussionId, {
    idempotencyKey: idempotencyKey('prepare-package'),
  }).version;
  return service.updatePackageVersion(prepared.id, {
    content,
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('update-package'),
  }).version;
}

export function approveCompleteDraft(service, discussionId, content = completePackageContent()) {
  const complete = prepareCompleteDraft(service, discussionId, content);
  service.approvePackageVersion(complete.id, {
    expectedVersion: complete.rowVersion,
    idempotencyKey: idempotencyKey('approve-package'),
  });
  return service.requirePackageVersion(complete.id);
}

export async function waitForExecution(service, discussionId, runId, expectedStatuses, timeoutMs = 4000) {
  const statuses = new Set(Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = service.getDiscussion(discussionId).workPackage?.executions || [];
    const run = runs.find(candidate => candidate.id === runId);
    if (run && statuses.has(run.status)) return run;
    await delay(20);
  }
  const runs = service.getDiscussion(discussionId).workPackage?.executions || [];
  const current = runs.find(candidate => candidate.id === runId);
  assert.fail(`Execution ${runId} did not reach ${[...statuses].join('/')} within ${timeoutMs}ms; current=${current?.status || 'missing'}`);
}

export async function waitForRun(service, discussionId, runId, expectedStatuses, timeoutMs = 4000) {
  const statuses = new Set(Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = service.getDiscussion(discussionId).runs.find(candidate => candidate.id === runId);
    if (run && statuses.has(run.status)) return run;
    await delay(20);
  }
  const current = service.getDiscussion(discussionId).runs.find(candidate => candidate.id === runId);
  assert.fail(`Run ${runId} did not reach ${[...statuses].join('/')} within ${timeoutMs}ms; current=${current?.status || 'missing'}`);
}

export function assertAppError(callback, { status, code, message, details }) {
  assert.throws(callback, error => {
    if (status !== undefined) assert.equal(error.status, status);
    if (code !== undefined) assert.equal(error.code, code);
    if (message !== undefined) assert.match(error.message, message);
    if (details !== undefined) details(error.details);
    return true;
  });
}
