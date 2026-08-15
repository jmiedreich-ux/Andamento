import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import {
  addOwnerMessage,
  approveCompleteDraft,
  captureAndAcceptPoint,
  completePackageContent,
  createProjectAndDiscussion,
  createFixture,
  idempotencyKey,
  prepareCompleteDraft,
  waitForExecution,
} from './test-support.mjs';

async function seededDiscussion(t) {
  const fixture = await createFixture(t, { enableDeterministic: true });
  const { discussion, repositoryRoot } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  captureAndAcceptPoint(fixture.service, message.id);
  return { fixture, discussion, repositoryRoot };
}

async function approvedWorkspace(t, outcome) {
  const { fixture, discussion, repositoryRoot } = await seededDiscussion(t);
  const version = approveCompleteDraft(
    fixture.service,
    discussion.id,
    completePackageContent(outcome ? { outcome } : {}),
  );
  return { fixture, discussion, version, repositoryRoot };
}

function dispatch(fixture, versionId, overrides = {}) {
  return fixture.service.dispatchExecution(versionId, {
    adapter: 'deterministic',
    idempotencyKey: idempotencyKey('dispatch'),
    ...overrides,
  }, 'owner-local');
}

test('dispatching an approved version applies its change set and records what was written', async t => {
  const { fixture, discussion, version, repositoryRoot } = await approvedWorkspace(t);
  const started = await dispatch(fixture, version.id);
  assert.equal(started.status, 'RUNNING');
  assert.equal(started.changeSet, null);

  const finished = await waitForExecution(fixture.service, discussion.id, started.id, 'SUCCEEDED');
  assert.equal(finished.workPackageVersionId, version.id);
  assert.equal(finished.provider, 'deterministic');
  assert.ok(finished.changeSet, 'a succeeded execution carries a change set');
  assert.match(finished.changeSet.diff, /^diff --git a\/PLANNED_WORK\.md/);
  assert.equal(finished.changeSet.fileCount, 1);
  assert.match(finished.changeSet.diffSha256, /^[0-9a-f]{64}$/);

  // The approved version itself is untouched by execution.
  const version2 = fixture.service.requirePackageVersion(version.id);
  assert.equal(version2.status, 'READY_FOR_EXECUTION');
  assert.equal(version2.rowVersion, version.rowVersion);

  assert.throws(() => fixture.database.prepare(
    'UPDATE execution_change_sets SET diff = ? WHERE execution_run_id = ?',
  ).run('tampered', started.id), /immutable/);
  assert.throws(() => fixture.database.prepare(
    'DELETE FROM execution_change_sets WHERE execution_run_id = ?',
  ).run(started.id), /cannot be deleted/);

  // The approved package authorized this, so the file really exists now.
  const written = path.join(repositoryRoot, 'PLANNED_WORK.md');
  assert.match(await readFile(written, 'utf8'), /^# Produce one immutable/);
  assert.equal(finished.appliedAt !== '', true);
  assert.equal(finished.revertedAt, '');

  assert.throws(() => fixture.database.prepare(
    'DELETE FROM execution_applications WHERE execution_run_id = ?',
  ).run(started.id), /cannot be deleted/);

  const invariants = fixture.service.verifyInvariants();
  assert.equal(invariants.passed.length, 25);

  // Undo belongs to Andamento, not to git.
  const reverted = await fixture.service.revertExecution(started.id, {
    idempotencyKey: idempotencyKey('revert'),
  }, 'owner-local');
  assert.notEqual(reverted.revertedAt, '');
  await assert.rejects(readFile(written, 'utf8'), /ENOENT/);
  await assert.rejects(
    () => fixture.service.revertExecution(started.id, { idempotencyKey: idempotencyKey('revert-again') }, 'owner-local'),
    error => {
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('a change set that does not apply cleanly changes nothing', async t => {
  const { fixture, discussion, version, repositoryRoot } = await approvedWorkspace(t);
  // A pre-existing file makes the new-file patch impossible to apply.
  const ownerContent = 'owner content\n';
  await writeFile(path.join(repositoryRoot, 'PLANNED_WORK.md'), ownerContent, 'utf8');
  const started = await dispatch(fixture, version.id);
  const failed = await waitForExecution(fixture.service, discussion.id, started.id, 'FAILED');
  assert.equal(failed.errorCode, 'CHANGE_SET_DID_NOT_APPLY');
  assert.equal(failed.changeSet, null);
  assert.equal(
    await readFile(path.join(repositoryRoot, 'PLANNED_WORK.md'), 'utf8'),
    ownerContent,
    'the owner file is untouched',
  );
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('an execution that overwrites an existing file can be reverted to its exact prior content', async t => {
  const { fixture, discussion, version, repositoryRoot } = await approvedWorkspace(t);
  const target = path.join(repositoryRoot, 'PLANNED_WORK.md');
  await writeFile(target, 'owner content\n', 'utf8');
  await execFileAsync('git', ['add', 'PLANNED_WORK.md'], { cwd: repositoryRoot });
  await execFileAsync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: repositoryRoot });
  await rm(target);
  const started = await dispatch(fixture, version.id);
  const finished = await waitForExecution(fixture.service, discussion.id, started.id, 'SUCCEEDED');
  assert.notEqual(finished.appliedAt, '');
  await fixture.service.revertExecution(started.id, { idempotencyKey: idempotencyKey('revert') }, 'owner-local');
  await assert.rejects(readFile(target, 'utf8'), /ENOENT/);
});

test('a draft version cannot be dispatched at the service or the storage boundary', async t => {
  const { fixture, discussion } = await seededDiscussion(t);
  const draft = prepareCompleteDraft(fixture.service, discussion.id);

  await assert.rejects(
    () => dispatch(fixture, draft.id),
    error => {
      assert.equal(error.status, 409);
      assert.match(error.message, /approved work-package version/i);
      return true;
    },
  );

  const owner = fixture.database.prepare("SELECT id FROM participants WHERE kind = 'OWNER'").get();
  assert.throws(() => fixture.database.prepare(`
    INSERT INTO execution_runs(
      id, work_package_version_id, discussion_id, participant_id,
      dispatched_by_participant_id, adapter, provider, model, repository_root, status, started_at
    ) VALUES ('forced', ?, ?, ?, ?, 'deterministic', 'deterministic', 'm', 'C:\\\\root', 'RUNNING', '2026-01-01T00:00:00.000Z')
  `).run(draft.id, discussion.id, owner.id, owner.id), /approved work package version/);
});

test('only the owner may dispatch or cancel an execution', async t => {
  const { fixture, discussion, version } = await approvedWorkspace(t);
  const agentParticipant = fixture.service.ensureParticipant({
    participantKey: 'agent:test:impostor',
    kind: 'AGENT',
    displayName: 'Impostor agent',
    provider: 'test',
    model: 'impostor-v1',
  });
  await assert.rejects(
    () => fixture.service.dispatchExecution(version.id, {
      adapter: 'deterministic', idempotencyKey: idempotencyKey('dispatch'),
    }, agentParticipant.id),
    error => {
      assert.equal(error.status, 403);
      assert.match(error.message, /Only the owner/);
      return true;
    },
  );
  assert.deepEqual(fixture.service.getDiscussion(discussion.id).workPackage.executions, []);

  // The storage boundary refuses the same thing independently of the service.
  assert.throws(() => fixture.database.prepare(`
    INSERT INTO execution_runs(
      id, work_package_version_id, discussion_id, participant_id,
      dispatched_by_participant_id, adapter, provider, model, repository_root, status, started_at
    ) VALUES ('forced-actor', ?, ?, ?, ?, 'deterministic', 'deterministic', 'm', 'C:\\\\root', 'RUNNING', '2026-01-01T00:00:00.000Z')
  `).run(version.id, discussion.id, agentParticipant.id, agentParticipant.id), /owner authority/);
});

test('repeated dispatch with one key is idempotent and does not run twice', async t => {
  const { fixture, discussion, version } = await approvedWorkspace(t);
  const key = idempotencyKey('same-dispatch');
  const first = await dispatch(fixture, version.id, { idempotencyKey: key });
  const replayed = await dispatch(fixture, version.id, { idempotencyKey: key });
  assert.equal(replayed.id, first.id);

  await waitForExecution(fixture.service, discussion.id, first.id, 'SUCCEEDED');
  const runs = fixture.service.getDiscussion(discussion.id).workPackage.executions;
  assert.equal(runs.length, 1);
});

test('a failed execution records no change set and stays retryable', async t => {
  const { fixture, discussion, version } = await approvedWorkspace(t, 'Outcome [fail] for this attempt.');
  const started = await dispatch(fixture, version.id);
  const failed = await waitForExecution(fixture.service, discussion.id, started.id, 'FAILED');
  assert.equal(failed.changeSet, null);
  assert.equal(failed.errorCode, 'DETERMINISTIC_FAILURE');
  assert.doesNotMatch(failed.errorMessage, /stack|at Object|internal/i);
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('a malformed or escaping change set is refused rather than recorded', async t => {
  const malformed = await approvedWorkspace(t, 'Outcome [malformed] for this attempt.');
  const started = await dispatch(malformed.fixture, malformed.version.id);
  const failed = await waitForExecution(malformed.fixture.service, malformed.discussion.id, started.id, 'FAILED');
  assert.equal(failed.changeSet, null);
  assert.equal(failed.errorCode, 'MALFORMED_CHANGE_SET');

  const escaping = await approvedWorkspace(t, 'Outcome [escape] for this attempt.');
  const escapeRun = await dispatch(escaping.fixture, escaping.version.id);
  const refused = await waitForExecution(escaping.fixture.service, escaping.discussion.id, escapeRun.id, 'FAILED');
  assert.equal(refused.changeSet, null);
  assert.equal(refused.errorCode, 'CHANGE_SET_ESCAPES_REPOSITORY');
});

test('an execution proposing no change succeeds with an empty change set', async t => {
  const { fixture, discussion, version } = await approvedWorkspace(t, 'Outcome [no-change] for this attempt.');
  const started = await dispatch(fixture, version.id);
  const finished = await waitForExecution(fixture.service, discussion.id, started.id, 'SUCCEEDED');
  assert.equal(finished.changeSet.fileCount, 0);
  assert.equal(finished.changeSet.diff, '');
});

test('a moved repository is refused at dispatch even though the version stays approved', async t => {
  const { fixture, version } = await approvedWorkspace(t);
  fixture.database.prepare('UPDATE projects SET repository_root = ?')
    .run('C:\\Development\\definitely-not-a-repository-root');
  await assert.rejects(
    () => dispatch(fixture, version.id),
    error => {
      assert.match(error.code, /VALIDATION_ERROR|REPOSITORY_UNAVAILABLE/);
      return true;
    },
  );
  assert.equal(fixture.service.requirePackageVersion(version.id).status, 'READY_FOR_EXECUTION');
});

test('an execution interrupted by a restart is reported, not silently lost', async t => {
  const { fixture, discussion, version } = await approvedWorkspace(t, 'Outcome [slow] for this attempt.');
  const started = await dispatch(fixture, version.id);
  assert.equal(started.status, 'RUNNING');
  await fixture.close();
  await fixture.open();

  const runs = fixture.service.getDiscussion(discussion.id).workPackage.executions;
  const recovered = runs.find(run => run.id === started.id);
  assert.equal(recovered.status, 'INTERRUPTED');
  assert.equal(recovered.changeSet, null);
  assert.match(recovered.errorMessage, /restarted/i);
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
  assert.equal(fixture.service.requirePackageVersion(version.id).status, 'READY_FOR_EXECUTION');
});
