import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  addOwnerMessage,
  assertAppError,
  captureAndAcceptPoint,
  completePackageContent,
  createFixture,
  createProjectAndDiscussion,
  idempotencyKey,
  prepareCompleteDraft,
  waitForRun,
} from './test-support.mjs';

test('validates repository roots and stores only canonical local Git repositories', async t => {
  const fixture = await createFixture(t);
  const missing = path.join(fixture.root, 'missing');
  const nonRepository = await fixture.makeNonRepository();
  const plainFile = await fixture.makeFile();

  for (const repositoryRoot of ['', missing, nonRepository, plainFile]) {
    await assert.rejects(
      fixture.service.createProject({
        name: 'Invalid repository',
        repositoryRoot,
        idempotencyKey: idempotencyKey('invalid-project'),
      }),
      error => {
        assert.equal(error.status, 400);
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.match(error.message, /existing local Git repository|Repository root is required/);
        return true;
      },
    );
  }

  const repositoryRoot = await fixture.makeRepository('canonical-repository');
  const result = await fixture.service.createProject({
    name: '  Canonical project  ',
    repositoryRoot: `  ${repositoryRoot}  `,
    idempotencyKey: idempotencyKey('valid-project'),
  });
  assert.equal(result.project.name, 'Canonical project');
  assert.equal(result.project.repositoryRoot, repositoryRoot);
  assert.deepEqual(fixture.service.verifyInvariants().passed.length, 9);
});

test('persists the planning loop on disk across a real application restart in WAL mode', async t => {
  const fixture = await createFixture(t);
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    projectName: 'Persistent project',
    discussionTitle: 'Persistent planning room',
  });
  const imported = fixture.service.addMessage(discussion.id, {
    contributionType: 'IMPORTED',
    displayName: 'Claude',
    provider: 'anthropic',
    model: 'claude-test',
    content: 'Keep the source relationship visible after restart.',
    idempotencyKey: idempotencyKey('imported-message'),
  }).message;
  const accepted = captureAndAcceptPoint(fixture.service, imported.id, 'Persist accepted lineage.');
  const draft = prepareCompleteDraft(fixture.service, discussion.id);
  fixture.service.verifyInvariants();

  assert.equal(fixture.database.prepare('PRAGMA journal_mode').get().journal_mode.toLowerCase(), 'wal');
  assert.equal(Number(fixture.database.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
  assert.equal(Number(fixture.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count), 2);
  await fixture.close();
  await fixture.open();

  const restored = fixture.service.getDiscussion(discussion.id);
  assert.equal(restored.project.id, project.id);
  assert.equal(restored.messages.length, 1);
  assert.equal(restored.messages[0].participant.displayName, 'Claude');
  assert.equal(restored.messages[0].participant.provider, 'anthropic');
  assert.equal(restored.points[0].id, accepted.id);
  assert.equal(restored.points[0].source.messageId, imported.id);
  assert.equal(restored.workPackage.currentVersion.id, draft.id);
  assert.equal(restored.workPackage.currentVersion.status, 'DRAFT');
  fixture.service.verifyInvariants();
  await access(fixture.databasePath);
});

test('isolates projects and preserves imported and agent attribution through source-linked points', async t => {
  const fixture = await createFixture(t);
  const first = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'project-a',
    projectName: 'Project A',
    discussionTitle: 'Room A',
  });
  const second = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'project-b',
    projectName: 'Project B',
    discussionTitle: 'Room B',
  });
  const imported = fixture.service.addMessage(first.discussion.id, {
    contributionType: 'IMPORTED',
    displayName: 'External reviewer',
    provider: 'anthropic',
    model: 'claude-local-copy',
    content: 'Project A imported contribution.',
    idempotencyKey: idempotencyKey('import-a'),
  }).message;
  const importedPoint = fixture.service.capturePoint(imported.id, {
    pointType: 'RISK',
    text: 'Project A risk.',
    idempotencyKey: idempotencyKey('point-a'),
  }).point;
  addOwnerMessage(fixture.service, second.discussion.id, 'Project B owner contribution.');
  const run = fixture.service.startAgentRun(first.discussion.id, {
    adapter: 'deterministic',
    prompt: 'Review project A authority.',
    idempotencyKey: idempotencyKey('run-a'),
  }).run;
  await waitForRun(fixture.service, first.discussion.id, run.id, 'COMPLETED');

  const roomA = fixture.service.getDiscussion(first.discussion.id);
  const roomB = fixture.service.getDiscussion(second.discussion.id);
  assert.equal(roomA.project.id, first.project.id);
  assert.equal(roomB.project.id, second.project.id);
  assert.deepEqual(fixture.service.listDiscussions(first.project.id).map(item => item.id), [first.discussion.id]);
  assert.deepEqual(fixture.service.listDiscussions(second.project.id).map(item => item.id), [second.discussion.id]);
  assert.ok(roomA.messages.every(message => message.discussionId === first.discussion.id));
  assert.ok(roomB.messages.every(message => message.discussionId === second.discussion.id));
  assert.equal(roomB.messages.some(message => /Project A/.test(message.content)), false);
  assert.equal(roomA.points[0].id, importedPoint.id);
  assert.deepEqual(roomA.points[0].source, {
    messageId: imported.id,
    excerpt: 'Project A imported contribution.',
    displayName: 'External reviewer',
    provider: 'anthropic',
  });
  const completedContribution = roomA.messages.find(message => message.agentRunId === run.id);
  assert.equal(completedContribution.participant.kind, 'AGENT');
  assert.equal(completedContribution.participant.provider, 'deterministic');
  assert.equal(completedContribution.participant.model, 'planning-test-v1');
  fixture.service.verifyInvariants();
});

test('idempotency receipts prevent duplicate messages, runs, points, packages, and approvals', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const messageKey = idempotencyKey('same-message');
  const firstMessage = fixture.service.addMessage(discussion.id, {
    content: 'One durable contribution.',
    contributionType: 'OWNER',
    idempotencyKey: messageKey,
  });
  const replayedMessage = fixture.service.addMessage(discussion.id, {
    content: 'A changed payload must not create another contribution.',
    contributionType: 'OWNER',
    idempotencyKey: messageKey,
  });
  assert.equal(replayedMessage.replayed, true);
  assert.equal(replayedMessage.message.id, firstMessage.message.id);
  assert.equal(replayedMessage.message.content, 'One durable contribution.');

  const pointKey = idempotencyKey('same-point');
  const firstPoint = fixture.service.capturePoint(firstMessage.message.id, {
    pointType: 'REQUIREMENT',
    text: 'Use idempotent mutations.',
    idempotencyKey: pointKey,
  });
  const replayedPoint = fixture.service.capturePoint(firstMessage.message.id, {
    pointType: 'RISK',
    text: 'Changed replay payload.',
    idempotencyKey: pointKey,
  });
  assert.equal(replayedPoint.replayed, true);
  assert.equal(replayedPoint.point.id, firstPoint.point.id);
  const accepted = fixture.service.dispositionPoint(firstPoint.point.id, {
    disposition: 'ACCEPTED',
    expectedVersion: 1,
    idempotencyKey: idempotencyKey('accept'),
  }).point;

  const runKey = idempotencyKey('same-run');
  const firstRun = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'Return one contribution.',
    idempotencyKey: runKey,
  });
  const replayedRun = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'A changed prompt must not start a second run.',
    idempotencyKey: runKey,
  });
  assert.equal(replayedRun.replayed, true);
  assert.equal(replayedRun.run.id, firstRun.run.id);
  await waitForRun(fixture.service, discussion.id, firstRun.run.id, 'COMPLETED');

  const packageKey = idempotencyKey('same-package');
  const firstDraft = fixture.service.preparePackage(discussion.id, { idempotencyKey: packageKey });
  const replayedDraft = fixture.service.preparePackage(discussion.id, { idempotencyKey: packageKey });
  assert.equal(replayedDraft.replayed, true);
  assert.equal(replayedDraft.version.id, firstDraft.version.id);
  const complete = fixture.service.updatePackageVersion(firstDraft.version.id, {
    content: completePackageContent({ includedScope: [accepted.text] }),
    expectedVersion: firstDraft.version.rowVersion,
    idempotencyKey: idempotencyKey('complete'),
  }).version;
  const approvalKey = idempotencyKey('same-approval');
  const firstApproval = fixture.service.approvePackageVersion(complete.id, {
    expectedVersion: complete.rowVersion,
    idempotencyKey: approvalKey,
  });
  const replayedApproval = fixture.service.approvePackageVersion(complete.id, {
    expectedVersion: complete.rowVersion,
    idempotencyKey: approvalKey,
  });
  assert.equal(replayedApproval.replayed, true);
  assert.equal(replayedApproval.approval.id, firstApproval.approval.id);

  const counts = fixture.database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE discussion_id = ?) AS messages,
      (SELECT COUNT(*) FROM planning_points WHERE discussion_id = ?) AS points,
      (SELECT COUNT(*) FROM agent_runs WHERE discussion_id = ?) AS runs,
      (SELECT COUNT(*) FROM approval_events WHERE work_package_version_id = ?) AS approvals
  `).get(discussion.id, discussion.id, discussion.id, complete.id);
  assert.deepEqual({ ...counts }, { messages: 2, points: 1, runs: 1, approvals: 1 });
  fixture.service.verifyInvariants();
});

test('replacement and owner dispositions preserve immutable history and accepted-only package inputs', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  const original = fixture.service.capturePoint(message.id, {
    pointType: 'ASSUMPTION',
    text: 'Original proposal.',
    idempotencyKey: idempotencyKey('original'),
  }).point;
  const replacement = fixture.service.replacePoint(original.id, {
    pointType: 'REQUIREMENT',
    text: 'Replacement proposal.',
    expectedVersion: original.rowVersion,
    idempotencyKey: idempotencyKey('replacement'),
  }).point;
  const rejected = fixture.service.capturePoint(message.id, {
    pointType: 'RISK',
    text: 'Rejected proposal.',
    idempotencyKey: idempotencyKey('rejected'),
  }).point;
  const deferred = fixture.service.capturePoint(message.id, {
    pointType: 'PARKING_LOT',
    text: 'Deferred proposal.',
    idempotencyKey: idempotencyKey('deferred'),
  }).point;
  fixture.service.dispositionPoint(replacement.id, {
    disposition: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idempotencyKey('accept-replacement'),
  });
  fixture.service.dispositionPoint(rejected.id, {
    disposition: 'REJECTED', expectedVersion: 1, idempotencyKey: idempotencyKey('reject'),
  });
  fixture.service.dispositionPoint(deferred.id, {
    disposition: 'DEFERRED', expectedVersion: 1, idempotencyKey: idempotencyKey('defer'),
  });

  const room = fixture.service.getDiscussion(discussion.id);
  const storedOriginal = room.points.find(point => point.id === original.id);
  const storedReplacement = room.points.find(point => point.id === replacement.id);
  assert.equal(storedOriginal.text, 'Original proposal.');
  assert.equal(storedOriginal.disposition, 'SUPERSEDED');
  assert.equal(storedReplacement.supersedesPointId, original.id);
  assert.equal(storedReplacement.disposition, 'ACCEPTED');
  assert.equal(room.points.find(point => point.id === rejected.id).disposition, 'REJECTED');
  assert.equal(room.points.find(point => point.id === deferred.id).disposition, 'DEFERRED');
  const draft = fixture.service.preparePackage(discussion.id, {
    idempotencyKey: idempotencyKey('accepted-only-package'),
  }).version;
  assert.deepEqual(draft.sourcePointIds, [replacement.id]);
  assert.deepEqual(draft.content.includedScope, ['Replacement proposal.']);
  fixture.service.verifyInvariants();
});

test('denies non-owner decisions and approvals without changing durable authority records', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  const point = fixture.service.capturePoint(message.id, {
    pointType: 'DECISION', text: 'Owner-only decision.', idempotencyKey: idempotencyKey('owner-only-point'),
  }).point;
  const agent = fixture.service.createTestParticipant({
    kind: 'AGENT', displayName: 'Unauthorized agent', provider: 'test', model: 'test-agent',
  });
  assertAppError(() => fixture.service.dispositionPoint(point.id, {
    disposition: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idempotencyKey('denied-decision'),
  }, agent.id), { status: 403, code: 'FORBIDDEN', message: /Only the owner/ });
  assert.equal(fixture.service.requirePoint(point.id).disposition, 'PROPOSED');

  const accepted = fixture.service.dispositionPoint(point.id, {
    disposition: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idempotencyKey('owner-decision'),
  }).point;
  assert.equal(accepted.decidedByParticipantId, 'owner-local');
  const complete = prepareCompleteDraft(fixture.service, discussion.id);
  assertAppError(() => fixture.service.approvePackageVersion(complete.id, {
    expectedVersion: complete.rowVersion, idempotencyKey: idempotencyKey('denied-approval'),
  }, agent.id), { status: 403, code: 'FORBIDDEN', message: /Only the owner/ });
  assert.equal(fixture.service.requirePackageVersion(complete.id).status, 'DRAFT');
  assert.equal(Number(fixture.database.prepare('SELECT COUNT(*) AS count FROM approval_events').get().count), 0);
  fixture.service.verifyInvariants();
});

test('refuses incomplete approval without losing valid input, then locks one approval and clones version 2', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const accepted = captureAndAcceptPoint(fixture.service, addOwnerMessage(fixture.service, discussion.id).id);
  const prepared = fixture.service.preparePackage(discussion.id, {
    idempotencyKey: idempotencyKey('prepare-incomplete'),
  }).version;
  const partialContent = {
    ...prepared.content,
    outcome: 'Keep this valid outcome after refusal.',
    exclusions: ['No execution.'],
  };
  const partial = fixture.service.updatePackageVersion(prepared.id, {
    content: partialContent,
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('partial-update'),
  }).version;
  assertAppError(() => fixture.service.approvePackageVersion(partial.id, {
    expectedVersion: partial.rowVersion,
    idempotencyKey: idempotencyKey('incomplete-approval'),
  }), {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: /Complete every required package section/,
    details(details) {
      assert.deepEqual(details.gaps, ['Acceptance criteria', 'Review requirements', 'Evidence requirements']);
      assert.equal(details.current.content.outcome, partialContent.outcome);
    },
  });
  assert.deepEqual(fixture.service.requirePackageVersion(partial.id).content, partialContent);

  const complete = fixture.service.updatePackageVersion(partial.id, {
    content: completePackageContent({ includedScope: [accepted.text] }),
    expectedVersion: partial.rowVersion,
    idempotencyKey: idempotencyKey('complete-after-refusal'),
  }).version;
  const approved = fixture.service.approvePackageVersion(complete.id, {
    expectedVersion: complete.rowVersion,
    idempotencyKey: idempotencyKey('approve-v1'),
  });
  assert.equal(approved.state, 'READY_FOR_EXECUTION');
  assert.equal(approved.version.status, 'READY_FOR_EXECUTION');
  assert.equal(approved.version.rowVersion, complete.rowVersion + 1);
  assert.match(approved.approval.authorizationScope, /No execution was dispatched/);

  const repeatedWithNewKey = fixture.service.approvePackageVersion(complete.id, {
    expectedVersion: 1,
    idempotencyKey: idempotencyKey('repeat-approved-v1'),
  });
  assert.equal(repeatedWithNewKey.approval.id, approved.approval.id);
  assert.equal(Number(fixture.database.prepare(`
    SELECT COUNT(*) AS count FROM approval_events WHERE work_package_version_id = ?
  `).get(complete.id).count), 1);
  assertAppError(() => fixture.service.updatePackageVersion(complete.id, {
    content: completePackageContent({ outcome: 'Attempted mutation.' }),
    expectedVersion: approved.version.rowVersion,
    idempotencyKey: idempotencyKey('mutate-approved-v1'),
  }), { status: 409, code: 'CONFLICT', message: /immutable/ });
  assert.throws(() => fixture.database.prepare('UPDATE approval_events SET authorization_scope = ? WHERE id = ?')
    .run('mutated', approved.approval.id), /append-only/);
  assert.throws(() => fixture.database.prepare('DELETE FROM approval_events WHERE id = ?')
    .run(approved.approval.id), /append-only/);
  assert.throws(() => fixture.database.prepare('UPDATE work_package_versions SET content_json = ? WHERE id = ?')
    .run(JSON.stringify(completePackageContent({ outcome: 'mutated' })), complete.id), /immutable/);

  const next = fixture.service.createNextPackageVersion(complete.id, {
    idempotencyKey: idempotencyKey('create-v2'),
  }).version;
  assert.equal(next.versionNumber, 2);
  assert.equal(next.status, 'DRAFT');
  assert.deepEqual(next.content, approved.version.content);
  assert.deepEqual(next.sourcePointIds, approved.version.sourcePointIds);
  const editedV2 = fixture.service.updatePackageVersion(next.id, {
    content: completePackageContent({ outcome: 'Version 2 has a separate outcome.' }),
    expectedVersion: next.rowVersion,
    idempotencyKey: idempotencyKey('edit-v2'),
  }).version;
  assert.equal(editedV2.content.outcome, 'Version 2 has a separate outcome.');
  assert.equal(fixture.service.requirePackageVersion(complete.id).content.outcome, approved.version.content.outcome);
  assert.equal(fixture.service.requirePackageVersion(complete.id).status, 'READY_FOR_EXECUTION');
  fixture.service.verifyInvariants();
});

test('refuses stale point and package versions with the recoverable current state', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  const point = fixture.service.capturePoint(message.id, {
    pointType: 'CONSTRAINT', text: 'Stale writes must fail.', idempotencyKey: idempotencyKey('stale-point'),
  }).point;
  const accepted = fixture.service.dispositionPoint(point.id, {
    disposition: 'ACCEPTED', expectedVersion: point.rowVersion, idempotencyKey: idempotencyKey('fresh-point-write'),
  }).point;
  assertAppError(() => fixture.service.dispositionPoint(point.id, {
    disposition: 'REJECTED', expectedVersion: point.rowVersion, idempotencyKey: idempotencyKey('stale-point-write'),
  }), {
    status: 409,
    code: 'CONFLICT',
    message: /changed in another view/,
    details(details) {
      assert.equal(details.current.rowVersion, accepted.rowVersion);
      assert.equal(details.current.disposition, 'ACCEPTED');
    },
  });

  const prepared = fixture.service.preparePackage(discussion.id, {
    idempotencyKey: idempotencyKey('prepare-stale-package'),
  }).version;
  const saved = fixture.service.updatePackageVersion(prepared.id, {
    content: completePackageContent(),
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('fresh-package-write'),
  }).version;
  assertAppError(() => fixture.service.updatePackageVersion(prepared.id, {
    content: completePackageContent({ outcome: 'Stale overwrite.' }),
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('stale-package-write'),
  }), {
    status: 409,
    code: 'CONFLICT',
    message: /changed in another view/,
    details(details) {
      assert.equal(details.current.rowVersion, saved.rowVersion);
      assert.equal(details.current.content.outcome, saved.content.outcome);
    },
  });
  fixture.service.verifyInvariants();
});

test('completes concurrent deterministic agents separately and supports failure retry and cancellation', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const first = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic', prompt: 'First concurrent review.', idempotencyKey: idempotencyKey('concurrent-first'),
  }).run;
  const second = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic', prompt: 'Second concurrent review.', idempotencyKey: idempotencyKey('concurrent-second'),
  }).run;
  const [completedFirst, completedSecond] = await Promise.all([
    waitForRun(fixture.service, discussion.id, first.id, 'COMPLETED'),
    waitForRun(fixture.service, discussion.id, second.id, 'COMPLETED'),
  ]);
  assert.equal(completedFirst.status, 'COMPLETED');
  assert.equal(completedSecond.status, 'COMPLETED');
  const afterConcurrent = fixture.service.getDiscussion(discussion.id);
  const concurrentMessages = afterConcurrent.messages.filter(message => [first.id, second.id].includes(message.agentRunId));
  assert.equal(concurrentMessages.length, 2);
  assert.equal(new Set(concurrentMessages.map(message => message.id)).size, 2);
  assert.ok(concurrentMessages.every(message => message.participant.provider === 'deterministic'));

  const failedStart = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: '[fail-once] Review retry handling.',
    idempotencyKey: idempotencyKey('fail-once'),
  }).run;
  const failed = await waitForRun(fixture.service, discussion.id, failedStart.id, 'FAILED');
  assert.equal(failed.errorCode, 'DETERMINISTIC_FAILURE');
  const retryStart = fixture.service.retryAgentRun(failed.id, {
    idempotencyKey: idempotencyKey('retry-failed-first-actor'),
  }).run;
  const concurrentRetry = fixture.service.retryAgentRun(failed.id, {
    idempotencyKey: idempotencyKey('retry-failed-second-actor'),
  }).run;
  assert.equal(concurrentRetry.id, retryStart.id);
  const retried = await waitForRun(fixture.service, discussion.id, retryStart.id, 'COMPLETED');
  assert.equal(retried.retryOfRunId, failed.id);

  const slow = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: '[slow] This contribution will be cancelled.',
    idempotencyKey: idempotencyKey('slow-run'),
  }).run;
  const cancellation = fixture.service.cancelAgentRun(slow.id, {
    idempotencyKey: idempotencyKey('cancel-slow-run'),
  });
  assert.equal(cancellation.run.status, 'INTERRUPTED');
  assert.equal(cancellation.run.errorCode, 'CANCELLED');
  await new Promise(resolve => setTimeout(resolve, 950));
  const finalRoom = fixture.service.getDiscussion(discussion.id);
  assert.equal(finalRoom.messages.some(message => message.agentRunId === failed.id), false);
  assert.equal(finalRoom.messages.some(message => message.agentRunId === retryStart.id), true);
  assert.equal(finalRoom.runs.filter(run => run.retryOfRunId === failed.id).length, 1);
  assert.equal(finalRoom.messages.filter(message => message.agentRunId === retryStart.id).length, 1);
  assert.equal(finalRoom.messages.some(message => message.agentRunId === slow.id), false);
  assert.equal(finalRoom.runs.find(run => run.id === slow.id).status, 'INTERRUPTED');
  fixture.service.verifyInvariants();
});

test('sanitizes provider failures before durable storage or browser delivery', async t => {
  const secretCanary = 'wss://owner:do-not-store-this-token@provider.invalid/private';
  const leakyAgent = {
    id: 'codex',
    provider: 'provider-test',
    model: 'leaky-test',
    displayName: 'Leaky provider',
    async contribute() {
      const error = new Error(`Provider diagnostic exposed ${secretCanary}`);
      error.code = 'PROVIDER_LEAK';
      throw error;
    },
  };
  const agents = {
    get(adapter) {
      assert.equal(adapter, 'codex');
      return leakyAgent;
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: false }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { discussion } = await createProjectAndDiscussion(fixture);
  const started = fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Exercise the provider failure boundary.',
    idempotencyKey: idempotencyKey('leaky-provider'),
  }).run;
  const failed = await waitForRun(fixture.service, discussion.id, started.id, 'FAILED');
  assert.equal(failed.errorCode, 'AGENT_FAILURE');
  assert.equal(failed.errorMessage, 'The planning participant could not complete this contribution. Retry is available.');
  const durableText = fixture.database.prepare(`
    SELECT error_message AS errorMessage FROM agent_runs WHERE id = ?
  `).get(started.id).errorMessage;
  const auditText = fixture.database.prepare(`
    SELECT details_json AS detailsJson FROM audit_events WHERE resource_id = ? ORDER BY sequence DESC LIMIT 1
  `).get(started.id).detailsJson;
  assert.equal(durableText.includes(secretCanary), false);
  assert.equal(auditText.includes(secretCanary), false);
  assert.equal(JSON.stringify(fixture.service.getDiscussion(discussion.id)).includes(secretCanary), false);
  fixture.service.verifyInvariants();
});
