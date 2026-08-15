import assert from 'node:assert/strict';
import { access, mkdir, rm } from 'node:fs/promises';
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
  const fakeRepository = await fixture.makeFakeRepository();

  for (const repositoryRoot of ['', missing, nonRepository, plainFile, fakeRepository]) {
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
  const nestedDirectory = path.join(repositoryRoot, 'nested', 'selection');
  await mkdir(nestedDirectory, { recursive: true });
  const result = await fixture.service.createProject({
    name: '  Canonical project  ',
    repositoryRoot: `  ${nestedDirectory}  `,
    idempotencyKey: idempotencyKey('valid-project'),
  });
  assert.equal(result.project.name, 'Canonical project');
  assert.equal(result.project.repositoryRoot, repositoryRoot);
  const discussion = fixture.service.createDiscussion(result.project.id, {
    title: 'Repository availability',
    idempotencyKey: idempotencyKey('repository-discussion'),
  }).discussion;
  await rm(path.join(repositoryRoot, '.git'), { recursive: true, force: true });
  const unavailable = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'Do not reach the adapter after the registered repository disappears.',
    idempotencyKey: idempotencyKey('unavailable-repository-run'),
  }).run;
  const failed = await waitForRun(fixture.service, discussion.id, unavailable.id, 'FAILED');
  assert.equal(failed.errorCode, 'REPOSITORY_UNAVAILABLE');
  assert.equal(failed.errorMessage, 'The registered Git repository is no longer available. Restore it before retrying.');
  assert.deepEqual(fixture.service.verifyInvariants().passed.length, 25);
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
  assert.equal(fixture.database.prepare('PRAGMA locking_mode').get().locking_mode.toLowerCase(), 'exclusive');
  assert.equal(Number(fixture.database.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
  assert.equal(Number(fixture.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count), 8);
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
  fixture.database.prepare(`
    INSERT INTO participants(
      id, participant_key, kind, display_name, provider, model, created_at
    ) VALUES (
      'legacy-imported-participant', 'imported:anthropic:legacy-model:legacy reviewer',
      'IMPORTED', 'Legacy reviewer', 'Anthropic', 'legacy-model', ?
    )
  `).run(new Date().toISOString());
  const reusedLegacyIdentity = fixture.service.addMessage(first.discussion.id, {
    contributionType: 'IMPORTED',
    displayName: 'legacy REVIEWER',
    provider: 'anthropic',
    model: 'LEGACY-MODEL',
    content: 'A legacy imported identity remains stable after the collision-safe key upgrade.',
    idempotencyKey: idempotencyKey('legacy-imported-identity'),
  }).message;
  assert.equal(reusedLegacyIdentity.participant.id, 'legacy-imported-participant');
  const delimiterIdentityA = fixture.service.addMessage(first.discussion.id, {
    contributionType: 'IMPORTED',
    displayName: 'Reviewer',
    provider: 'alpha:beta',
    model: 'gamma',
    content: 'First delimiter-bearing identity.',
    idempotencyKey: idempotencyKey('delimiter-identity-a'),
  }).message;
  const delimiterIdentityB = fixture.service.addMessage(first.discussion.id, {
    contributionType: 'IMPORTED',
    displayName: 'Reviewer',
    provider: 'alpha',
    model: 'beta:gamma',
    content: 'Second delimiter-bearing identity.',
    idempotencyKey: idempotencyKey('delimiter-identity-b'),
  }).message;
  assert.notEqual(delimiterIdentityA.participant.id, delimiterIdentityB.participant.id);
  assert.deepEqual(
    [delimiterIdentityA.participant.provider, delimiterIdentityA.participant.model],
    ['alpha:beta', 'gamma'],
  );
  assert.deepEqual(
    [delimiterIdentityB.participant.provider, delimiterIdentityB.participant.model],
    ['alpha', 'beta:gamma'],
  );
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
    content: 'One durable contribution.',
    contributionType: 'OWNER',
    idempotencyKey: messageKey,
  });
  assert.equal(replayedMessage.replayed, true);
  assert.equal(replayedMessage.message.id, firstMessage.message.id);
  assert.equal(replayedMessage.message.content, 'One durable contribution.');
  assertAppError(() => fixture.service.addMessage(discussion.id, {
    content: 'A changed payload must be refused for the same key.',
    contributionType: 'OWNER',
    idempotencyKey: messageKey,
  }), { status: 409, code: 'CONFLICT', message: /different request/ });

  const pointKey = idempotencyKey('same-point');
  const firstPoint = fixture.service.capturePoint(firstMessage.message.id, {
    pointType: 'REQUIREMENT',
    text: 'Use idempotent mutations.',
    idempotencyKey: pointKey,
  });
  const replayedPoint = fixture.service.capturePoint(firstMessage.message.id, {
    pointType: 'REQUIREMENT',
    text: 'Use idempotent mutations.',
    idempotencyKey: pointKey,
  });
  assert.equal(replayedPoint.replayed, true);
  assert.equal(replayedPoint.point.id, firstPoint.point.id);
  assertAppError(() => fixture.service.capturePoint(firstMessage.message.id, {
    pointType: 'RISK',
    text: 'Changed replay payload.',
    idempotencyKey: pointKey,
  }), { status: 409, code: 'CONFLICT', message: /different request/ });

  const countsBeforeCrossOperationConflict = fixture.database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM participants) AS participants,
      (SELECT COUNT(*) FROM agent_runs) AS runs,
      (SELECT COUNT(*) FROM audit_events) AS auditEvents
  `).get();
  assertAppError(() => fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'A refused key reuse must not create attribution or run state.',
    idempotencyKey: messageKey,
  }), { status: 409, code: 'CONFLICT', message: /different request/ });
  const countsAfterCrossOperationConflict = fixture.database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM participants) AS participants,
      (SELECT COUNT(*) FROM agent_runs) AS runs,
      (SELECT COUNT(*) FROM audit_events) AS auditEvents
  `).get();
  assert.deepEqual(
    { ...countsAfterCrossOperationConflict },
    { ...countsBeforeCrossOperationConflict },
    'A refused idempotency-key reuse must be a zero-write operation.',
  );
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
    prompt: 'Return one contribution.',
    idempotencyKey: runKey,
  });
  assert.equal(replayedRun.replayed, true);
  assert.equal(replayedRun.run.id, firstRun.run.id);
  assertAppError(() => fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'A changed prompt must be refused for the same key.',
    idempotencyKey: runKey,
  }), { status: 409, code: 'CONFLICT', message: /different request/ });
  await waitForRun(fixture.service, discussion.id, firstRun.run.id, 'COMPLETED');

  const { discussion: otherDiscussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'idempotency-other-project',
    projectName: 'Other project',
    discussionTitle: 'Other room',
  });
  assertAppError(() => fixture.service.addMessage(otherDiscussion.id, {
    content: 'One durable contribution.',
    contributionType: 'OWNER',
    idempotencyKey: messageKey,
  }), { status: 409, code: 'CONFLICT', message: /different request/ });
  assert.equal(fixture.service.getDiscussion(otherDiscussion.id).messages.length, 0);

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
  const fingerprints = fixture.database.prepare(`
    SELECT request_fingerprint AS fingerprint FROM mutation_receipts
    WHERE request_fingerprint <> 'LEGACY_UNBOUND'
  `).all();
  assert.ok(fingerprints.length > 0);
  assert.ok(fingerprints.every(row => /^[0-9a-f]{64}$/.test(row.fingerprint)));

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
  const replacementKey = idempotencyKey('replacement');
  const replacementInput = {
    pointType: 'REQUIREMENT',
    text: 'Replacement proposal.',
    expectedVersion: original.rowVersion,
    idempotencyKey: replacementKey,
  };
  const replacementResult = fixture.service.replacePoint(original.id, replacementInput);
  const replacement = replacementResult.point;
  const replayedReplacement = fixture.service.replacePoint(original.id, replacementInput);
  assert.equal(replayedReplacement.replayed, true);
  assert.equal(replayedReplacement.point.id, replacement.id);
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

test('carries a maximum-length accepted planning point through package save', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'maximum-point-repository',
    projectName: 'Maximum point project',
    discussionTitle: 'Maximum point room',
  });
  const pointText = 'p'.repeat(2000);
  const point = fixture.service.capturePoint(
    addOwnerMessage(fixture.service, discussion.id, 'Carry the complete accepted point into the package.').id,
    {
      pointType: 'REQUIREMENT',
      text: pointText,
      idempotencyKey: idempotencyKey('maximum-point'),
    },
  ).point;
  fixture.service.dispositionPoint(point.id, {
    disposition: 'ACCEPTED',
    expectedVersion: point.rowVersion,
    idempotencyKey: idempotencyKey('accept-maximum-point'),
  });
  const prepared = fixture.service.preparePackage(discussion.id, {
    idempotencyKey: idempotencyKey('prepare-maximum-point'),
  }).version;
  assert.deepEqual(prepared.content.includedScope, [pointText]);
  const saved = fixture.service.updatePackageVersion(prepared.id, {
    content: completePackageContent({ includedScope: prepared.content.includedScope }),
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('save-maximum-point'),
  }).version;
  assert.deepEqual(saved.content.includedScope, [pointText]);
  fixture.service.verifyInvariants();
});

test('prepares and saves 100 accepted inputs but atomically refuses 101', async t => {
  const fixture = await createFixture(t);
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'package-input-limit-repository',
    projectName: 'Package input limit project',
    discussionTitle: 'One hundred accepted inputs',
  });
  const overflowDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'One hundred and one accepted inputs',
    idempotencyKey: idempotencyKey('package-input-overflow-room'),
  }).discussion;

  const acceptInputs = (targetDiscussion, count, prefix) => {
    const message = addOwnerMessage(
      fixture.service,
      targetDiscussion.id,
      `Provide ${count} independently accepted package inputs.`,
    );
    for (let index = 1; index <= count; index += 1) {
      const point = fixture.service.capturePoint(message.id, {
        pointType: 'REQUIREMENT',
        text: `${prefix} accepted input ${index}.`,
        idempotencyKey: idempotencyKey(`${prefix}-capture-${index}`),
      }).point;
      fixture.service.dispositionPoint(point.id, {
        disposition: 'ACCEPTED',
        expectedVersion: point.rowVersion,
        idempotencyKey: idempotencyKey(`${prefix}-accept-${index}`),
      });
    }
  };

  acceptInputs(discussion, 100, 'limit');
  const prepared = fixture.service.preparePackage(discussion.id, {
    idempotencyKey: idempotencyKey('prepare-one-hundred-inputs'),
  }).version;
  assert.equal(prepared.content.includedScope.length, 100);
  const saved = fixture.service.updatePackageVersion(prepared.id, {
    content: completePackageContent({ includedScope: prepared.content.includedScope }),
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('save-one-hundred-inputs'),
  }).version;
  assert.equal(saved.content.includedScope.length, 100);

  acceptInputs(overflowDiscussion, 101, 'overflow');
  const countsBeforeRefusal = fixture.database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM work_packages WHERE discussion_id = ?) AS packages,
      (SELECT COUNT(*) FROM work_package_versions) AS versions,
      (SELECT COUNT(*) FROM work_package_points) AS links,
      (SELECT COUNT(*) FROM mutation_receipts) AS receipts,
      (SELECT COUNT(*) FROM audit_events) AS auditEvents
  `).get(overflowDiscussion.id);
  assertAppError(() => fixture.service.preparePackage(overflowDiscussion.id, {
    idempotencyKey: idempotencyKey('refuse-one-hundred-one-inputs'),
  }), { status: 400, code: 'VALIDATION_ERROR', message: /Included scope may contain at most 100 items/ });
  const countsAfterRefusal = fixture.database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM work_packages WHERE discussion_id = ?) AS packages,
      (SELECT COUNT(*) FROM work_package_versions) AS versions,
      (SELECT COUNT(*) FROM work_package_points) AS links,
      (SELECT COUNT(*) FROM mutation_receipts) AS receipts,
      (SELECT COUNT(*) FROM audit_events) AS auditEvents
  `).get(overflowDiscussion.id);
  assert.deepEqual({ ...countsAfterRefusal }, { ...countsBeforeRefusal });
  assert.equal(Number(countsAfterRefusal.packages), 0);
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
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

test('enforces immutable planning-point identity and owner decisions at SQLite and invariant boundaries', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'point-authority-repository',
    projectName: 'Point authority project',
    discussionTitle: 'Point authority room',
  });
  const source = addOwnerMessage(fixture.service, discussion.id, 'Preserve this source and proposal exactly.');
  const point = fixture.service.capturePoint(
    source.id,
    {
      pointType: 'REQUIREMENT',
      text: 'Immutable proposed text.',
      idempotencyKey: idempotencyKey('immutable-proposal'),
    },
  ).point;
  const agent = fixture.service.createTestParticipant({
    kind: 'AGENT',
    displayName: 'Direct SQL agent',
    provider: 'test',
    model: 'authority-test',
  });

  assert.throws(() => fixture.database.prepare(`
    INSERT INTO planning_points(
      id, discussion_id, source_message_id, created_by_participant_id, point_type, text,
      disposition, decided_by_participant_id, decided_at, created_at
    ) VALUES (?, ?, ?, 'owner-local', 'REQUIREMENT', 'Illegally pre-decided point',
              'ACCEPTED', 'owner-local', ?, ?)
  `).run('pre-decided-point', discussion.id, source.id, new Date().toISOString(), new Date().toISOString()), /must start proposed/);
  assert.deepEqual({ ...fixture.database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM planning_points WHERE id = 'pre-decided-point') AS points,
      (SELECT COUNT(*) FROM planning_point_identity_snapshots WHERE planning_point_id = 'pre-decided-point') AS identities,
      (SELECT COUNT(*) FROM planning_point_decision_snapshots WHERE planning_point_id = 'pre-decided-point') AS decisions
  `).get() }, { points: 0, identities: 0, decisions: 0 });
  assert.throws(() => fixture.database.prepare(`
    UPDATE planning_points SET text = 'Rewritten in place' WHERE id = ?
  `).run(point.id), /identity and text are immutable/);
  assert.throws(() => fixture.database.prepare(`
    UPDATE planning_points
    SET disposition = 'ACCEPTED', decided_by_participant_id = ?, decided_at = ?, row_version = row_version + 1
    WHERE id = ?
  `).run(agent.id, new Date().toISOString(), point.id), /require owner authority/);
  assert.throws(() => fixture.database.prepare(`
    UPDATE planning_points
    SET disposition = 'ACCEPTED', decided_by_participant_id = 'owner-local',
        decided_at = '   ', row_version = row_version + 1
    WHERE id = ?
  `).run(point.id), /complete decision metadata/);
  assert.throws(() => fixture.database.prepare(`
    UPDATE planning_point_identity_snapshots SET text = 'Changed snapshot' WHERE planning_point_id = ?
  `).run(point.id), /append-only/);

  fixture.database.exec(`
    SAVEPOINT point_authority_tamper;
    DROP TRIGGER planning_points_identity_immutable_update;
    DROP TRIGGER planning_points_owner_decision_update;
  `);
  fixture.database.prepare(`
    UPDATE planning_points
    SET text = 'Rewritten in place', disposition = 'ACCEPTED',
        decided_by_participant_id = ?, decided_at = ?, row_version = row_version + 1
    WHERE id = ?
  `).run(agent.id, new Date().toISOString(), point.id);
  assertAppError(() => fixture.service.verifyInvariants(), {
    status: 500,
    code: 'INVARIANT_VIOLATION',
    message: /invariants failed/,
    details(details) {
      const names = new Set(details.failures.map(failure => failure.name));
      assert.ok(names.has('planning point identity and text match their immutable snapshots'));
      assert.ok(names.has('planning point decisions match immutable owner-authority snapshots'));
    },
  });
  fixture.database.exec('ROLLBACK TO point_authority_tamper; RELEASE point_authority_tamper;');
  assert.equal(fixture.service.requirePoint(point.id).text, 'Immutable proposed text.');
  assert.equal(fixture.service.requirePoint(point.id).disposition, 'PROPOSED');

  const decided = fixture.service.dispositionPoint(point.id, {
    disposition: 'ACCEPTED',
    expectedVersion: point.rowVersion,
    idempotencyKey: idempotencyKey('snapshot-owner-decision'),
  }).point;
  assert.deepEqual({ ...fixture.database.prepare(`
    SELECT disposition, decided_by_participant_id AS decidedByParticipantId, decided_at AS decidedAt
    FROM planning_point_decision_snapshots WHERE planning_point_id = ?
  `).get(point.id) }, {
    disposition: 'ACCEPTED',
    decidedByParticipantId: 'owner-local',
    decidedAt: decided.decidedAt,
  });
  assert.throws(() => fixture.database.prepare(`
    UPDATE planning_points
    SET disposition = 'REJECTED', decided_at = ?, row_version = row_version + 1
    WHERE id = ?
  `).run(new Date().toISOString(), point.id), /decided planning points are immutable/);
  assert.throws(() => fixture.database.prepare(`
    UPDATE planning_point_decision_snapshots SET disposition = 'REJECTED' WHERE planning_point_id = ?
  `).run(point.id), /append-only/);

  fixture.database.exec(`
    SAVEPOINT decided_point_tamper;
    DROP TRIGGER decided_points_immutable;
  `);
  fixture.database.prepare(`
    UPDATE planning_points
    SET disposition = 'REJECTED', decided_by_participant_id = 'owner-local',
        decided_at = ?, row_version = row_version + 1
    WHERE id = ?
  `).run('2099-01-01T00:00:00.000Z', point.id);
  assertAppError(() => fixture.service.verifyInvariants(), {
    status: 500,
    code: 'INVARIANT_VIOLATION',
    message: /invariants failed/,
    details(details) {
      assert.ok(details.failures.some(
        failure => failure.name === 'planning point decisions match immutable owner-authority snapshots',
      ));
    },
  });
  fixture.database.exec('ROLLBACK TO decided_point_tamper; RELEASE decided_point_tamper;');
  assert.equal(fixture.service.requirePoint(point.id).disposition, 'ACCEPTED');
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
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

  const laterAccepted = captureAndAcceptPoint(
    fixture.service,
    addOwnerMessage(fixture.service, discussion.id, 'Later accepted context must not replace approved lineage.').id,
    'A later accepted point.',
  );
  const approvedSourceId = approved.version.sourcePointIds[0];
  assert.equal(Number(fixture.database.prepare(`
    SELECT COUNT(*) AS count FROM approved_package_point_snapshots WHERE work_package_version_id = ?
  `).get(complete.id).count), 1);
  assert.throws(() => fixture.database.prepare(`
    UPDATE work_package_points SET planning_point_id = ?
    WHERE work_package_version_id = ? AND planning_point_id = ?
  `).run(laterAccepted.id, complete.id, approvedSourceId), /immutable/);
  assert.throws(() => fixture.database.prepare(`
    UPDATE work_package_points SET work_package_version_id = ?
    WHERE work_package_version_id = ? AND planning_point_id = ?
  `).run('unrelated-draft-version', complete.id, approvedSourceId), /immutable/);
  assert.throws(() => fixture.database.prepare(`
    UPDATE approved_package_point_snapshots SET planning_point_id = ?
    WHERE work_package_version_id = ? AND planning_point_id = ?
  `).run(laterAccepted.id, complete.id, approvedSourceId), /append-only/);

  const emptyVersionId = 'test-empty-source-version';
  fixture.database.prepare(`
    INSERT INTO work_package_versions(
      id, work_package_id, version_number, status, content_json, created_at, updated_at
    ) VALUES (?, ?, 99, 'DRAFT', ?, ?, ?)
  `).run(
    emptyVersionId,
    complete.workPackageId,
    JSON.stringify(completePackageContent()),
    complete.updatedAt,
    complete.updatedAt,
  );
  assert.throws(() => fixture.database.prepare(`
    UPDATE work_package_versions SET status = 'READY_FOR_EXECUTION', approved_at = ?
    WHERE id = ?
  `).run(complete.updatedAt, emptyVersionId), /require at least one source/);
  fixture.database.prepare('DELETE FROM work_package_versions WHERE id = ?').run(emptyVersionId);
  assert.throws(() => fixture.database.prepare(`
    INSERT INTO work_package_versions(
      id, work_package_id, version_number, status, content_json, created_at, updated_at, approved_at
    ) VALUES (?, ?, 99, 'READY_FOR_EXECUTION', ?, ?, ?, ?)
  `).run(
    emptyVersionId,
    complete.workPackageId,
    JSON.stringify(completePackageContent()),
    complete.updatedAt,
    complete.updatedAt,
    complete.updatedAt,
  ), /require at least one source/);

  fixture.database.exec('SAVEPOINT empty_lineage_tamper; DROP TRIGGER ready_versions_require_sources_update;');
  fixture.database.prepare(`
    INSERT INTO work_package_versions(
      id, work_package_id, version_number, status, content_json, created_at, updated_at
    ) VALUES (?, ?, 99, 'DRAFT', ?, ?, ?)
  `).run(
    emptyVersionId,
    complete.workPackageId,
    JSON.stringify(completePackageContent()),
    complete.updatedAt,
    complete.updatedAt,
  );
  fixture.database.prepare(`
    UPDATE work_package_versions SET status = 'READY_FOR_EXECUTION', approved_at = ?
    WHERE id = ?
  `).run(complete.updatedAt, emptyVersionId);
  fixture.database.prepare(`
    INSERT INTO approval_events(
      id, work_package_version_id, owner_participant_id, authorization_scope, occurred_at
    ) VALUES ('test-empty-source-approval', ?, 'owner-local', 'Tamper-only approval.', ?)
  `).run(emptyVersionId, complete.updatedAt);
  assertAppError(() => fixture.service.verifyInvariants(), {
    status: 500,
    code: 'INVARIANT_VIOLATION',
    message: /invariants failed/,
    details(details) {
      assert.ok(details.failures.some(
        failure => failure.name === 'approved versions have at least one snapshotted source',
      ));
    },
  });
  fixture.database.exec('ROLLBACK TO empty_lineage_tamper; RELEASE empty_lineage_tamper;');

  fixture.database.exec('SAVEPOINT lineage_tamper; DROP TRIGGER approved_version_points_immutable_update;');
  fixture.database.prepare(`
    UPDATE work_package_points SET planning_point_id = ?
    WHERE work_package_version_id = ? AND planning_point_id = ?
  `).run(laterAccepted.id, complete.id, approvedSourceId);
  assertAppError(() => fixture.service.verifyInvariants(), {
    status: 500,
    code: 'INVARIANT_VIOLATION',
    message: /invariants failed/,
    details(details) {
      assert.ok(details.failures.some(failure => failure.name === 'approved package lineage matches its approval snapshot'));
    },
  });
  fixture.database.exec('ROLLBACK TO lineage_tamper; RELEASE lineage_tamper;');
  fixture.service.verifyInvariants();

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
  assertAppError(() => fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'Forge a different retry prompt.',
    retryOfRunId: failed.id,
    idempotencyKey: idempotencyKey('forged-retry'),
  }), { status: 400, code: 'VALIDATION_ERROR', message: /retry action/ });
  assert.equal(Number(fixture.database.prepare(`
    SELECT COUNT(*) AS count FROM agent_runs WHERE retry_of_run_id = ?
  `).get(failed.id).count), 0);
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

test('serializes provider-active Codex turns by discussion and stored thread through cancellation cleanup', async t => {
  const sharedThreadId = 'codex-thread-shared-across-rooms';
  let resolveFirstStarted;
  const firstStarted = new Promise(resolve => { resolveFirstStarted = resolve; });
  let resolveCancellationObserved;
  const cancellationObserved = new Promise(resolve => { resolveCancellationObserved = resolve; });
  let releaseProviderCleanup;
  const providerCleanupAcknowledged = new Promise(resolve => { releaseProviderCleanup = resolve; });
  const prompts = [];
  const controlledCodexAgent = {
    id: 'codex',
    provider: 'openai',
    model: 'codex-controlled-test',
    displayName: 'Controlled Codex',
    async contribute({ prompt, signal, onThread }) {
      prompts.push(prompt);
      if (prompt === 'Hold the first Codex turn open.') {
        await onThread(sharedThreadId);
        resolveFirstStarted();
        await new Promise(resolve => {
          const observeCancellation = () => {
            resolveCancellationObserved();
            void providerCleanupAcknowledged.then(resolve);
          };
          if (signal.aborted) observeCancellation();
          else signal.addEventListener('abort', observeCancellation, { once: true });
        });
        const error = new Error('The controlled Codex provider acknowledged interruption.');
        error.code = 'CANCELLED';
        throw error;
      }
      return {
        provider: 'openai',
        model: 'codex-controlled-test',
        content: `Completed independent Codex turn: ${prompt}`,
      };
    },
  };
  const agents = {
    get(adapter) {
      assert.equal(adapter, 'codex');
      return controlledCodexAgent;
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: false }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'codex-serialization-repository',
    projectName: 'Codex serialization project',
    discussionTitle: 'Primary Codex room',
  });
  const sharedDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Shared-thread Codex room',
    idempotencyKey: idempotencyKey('shared-thread-discussion'),
  }).discussion;
  const independentDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Independent Codex room',
    idempotencyKey: idempotencyKey('independent-thread-discussion'),
  }).discussion;
  fixture.database.prepare('UPDATE discussions SET codex_thread_id = ? WHERE id = ?')
    .run(sharedThreadId, sharedDiscussion.id);
  fixture.database.prepare('UPDATE discussions SET codex_thread_id = ? WHERE id = ?')
    .run('codex-thread-independent', independentDiscussion.id);

  const firstKey = idempotencyKey('serialized-first-codex-run');
  const firstInput = {
    adapter: 'codex',
    prompt: 'Hold the first Codex turn open.',
    idempotencyKey: firstKey,
  };
  const first = fixture.service.startAgentRun(discussion.id, firstInput).run;
  await firstStarted;

  const replayedWhileActive = fixture.service.startAgentRun(discussion.id, firstInput);
  assert.equal(replayedWhileActive.replayed, true);
  assert.equal(replayedWhileActive.run.id, first.id);
  assertAppError(() => fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'A second same-room Codex turn must wait.',
    idempotencyKey: idempotencyKey('same-room-overlap'),
  }), { status: 409, code: 'CONFLICT', message: /still contributing/ });
  assertAppError(() => fixture.service.startAgentRun(sharedDiscussion.id, {
    adapter: 'codex',
    prompt: 'A shared-thread Codex turn must wait.',
    idempotencyKey: idempotencyKey('shared-thread-overlap'),
  }), { status: 409, code: 'CONFLICT', message: /shared Codex thread/ });

  const independent = fixture.service.startAgentRun(independentDiscussion.id, {
    adapter: 'codex',
    prompt: 'An unrelated stored Codex thread may run concurrently.',
    idempotencyKey: idempotencyKey('independent-thread-run'),
  }).run;
  await waitForRun(fixture.service, independentDiscussion.id, independent.id, 'COMPLETED');

  const cancellation = fixture.service.cancelAgentRun(first.id, {
    idempotencyKey: idempotencyKey('cancel-serialized-first'),
  });
  assert.equal(cancellation.run.status, 'INTERRUPTED');
  assert.equal(cancellation.run.errorCode, 'CODEX_CLEANUP_PENDING');
  assert.equal(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.blocked, true);
  assert.equal(fixture.service.getDiscussion(sharedDiscussion.id).agentAvailability.codex.blocked, true);
  await cancellationObserved;
  const replayedDuringCleanup = fixture.service.startAgentRun(discussion.id, firstInput);
  assert.equal(replayedDuringCleanup.replayed, true);
  assert.equal(replayedDuringCleanup.run.id, first.id);
  assertAppError(() => fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Do not start before interrupt acknowledgement.',
    idempotencyKey: idempotencyKey('during-cancellation-cleanup'),
  }), { status: 409, code: 'CONFLICT', message: /still being confirmed/ });

  releaseProviderCleanup();
  const laterInput = {
    adapter: 'codex',
    prompt: 'Start after provider cleanup settles.',
    idempotencyKey: idempotencyKey('after-cancellation-cleanup'),
  };
  const cleanupDeadline = Date.now() + 2000;
  let later;
  while (!later && Date.now() < cleanupDeadline) {
    try {
      later = fixture.service.startAgentRun(discussion.id, laterInput).run;
    } catch (error) {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'CONFLICT');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  assert.ok(later, 'A later Codex turn should start after provider cleanup settles.');
  const completedLater = await waitForRun(fixture.service, discussion.id, later.id, 'COMPLETED');
  assert.equal(completedLater.status, 'COMPLETED');
  const confirmedCancellation = fixture.service.getDiscussion(discussion.id).runs
    .find(candidate => candidate.id === first.id);
  assert.equal(confirmedCancellation.errorCode, 'CANCELLED');
  assert.equal(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.blocked, false);
  assert.equal(fixture.service.getDiscussion(sharedDiscussion.id).agentAvailability.codex.blocked, false);
  assert.deepEqual(prompts, [
    'Hold the first Codex turn open.',
    'An unrelated stored Codex thread may run concurrently.',
    'Start after provider cleanup settles.',
  ]);
  fixture.service.verifyInvariants();
});

test('cancelling before Codex provider invocation never creates a cleanup quarantine', async t => {
  let providerCalls = 0;
  const codexAgent = {
    id: 'codex',
    provider: 'openai',
    model: 'codex-pre-provider-test',
    displayName: 'Codex',
    async contribute() {
      providerCalls += 1;
      return { provider: 'openai', model: 'codex-pre-provider-test', content: 'Unexpected contribution.' };
    },
  };
  const agents = {
    get(adapter) {
      assert.equal(adapter, 'codex');
      return codexAgent;
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: false }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'codex-pre-provider-cancel-repository',
    projectName: 'Codex pre-provider cancellation project',
    discussionTitle: 'Repository validation cancellation',
  });
  await rm(path.join(project.repositoryRoot, '.git'), { recursive: true, force: true });

  const run = fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Cancel before the unavailable repository can reach Codex.',
    idempotencyKey: idempotencyKey('pre-provider-cancel-run'),
  }).run;
  const cancellation = fixture.service.cancelAgentRun(run.id, {
    idempotencyKey: idempotencyKey('pre-provider-cancel-action'),
  }).run;

  assert.equal(cancellation.status, 'INTERRUPTED');
  assert.equal(cancellation.errorCode, 'CANCELLED');
  assert.equal(cancellation.completedAt.length > 0, true);
  assert.equal(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.blocked, false);

  const completionDeadline = Date.now() + 2000;
  while (fixture.service.activeRuns.has(run.id) && Date.now() < completionDeadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(fixture.service.activeRuns.has(run.id), false);
  assert.equal(providerCalls, 0);
  const durableRun = fixture.service.getDiscussion(discussion.id).runs.find(candidate => candidate.id === run.id);
  assert.equal(durableRun.errorCode, 'CANCELLED');
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('shutdown before Codex provider invocation remains safely retryable', async t => {
  let providerCalls = 0;
  const codexAgent = {
    id: 'codex',
    provider: 'openai',
    model: 'codex-pre-provider-shutdown-test',
    displayName: 'Codex',
    async contribute() {
      providerCalls += 1;
      return { provider: 'openai', model: 'codex-pre-provider-shutdown-test', content: 'Unexpected contribution.' };
    },
  };
  const agents = {
    get(adapter) {
      assert.equal(adapter, 'codex');
      return codexAgent;
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: false }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'codex-pre-provider-shutdown-repository',
    projectName: 'Codex pre-provider shutdown project',
    discussionTitle: 'Repository validation shutdown',
  });

  const run = fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Stop the service before repository validation can invoke Codex.',
    idempotencyKey: idempotencyKey('pre-provider-shutdown-run'),
  }).run;
  const activeRun = fixture.service.activeRuns.get(run.id);
  assert.equal(activeRun.providerStarted, false);
  const completion = activeRun.completion;

  await fixture.service.shutdown({ timeoutMs: 1 });
  const interrupted = fixture.service.getDiscussion(discussion.id).runs.find(candidate => candidate.id === run.id);
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.errorCode, 'SERVICE_SHUTDOWN');
  assert.equal(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.blocked, false);
  await completion;
  assert.equal(providerCalls, 0);
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('restart recovery quarantines crashed Codex runs while preserving deterministic retry', async t => {
  const fixture = await createFixture(t);
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'crash-recovery-repository',
    projectName: 'Crash recovery project',
    discussionTitle: 'Crashed Codex room',
  });
  const deterministicDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Crashed deterministic room',
    idempotencyKey: idempotencyKey('crash-deterministic-room'),
  }).discussion;
  const cancellationPendingDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Owner-cancelled Codex room at crash',
    idempotencyKey: idempotencyKey('crash-cancellation-pending-room'),
  }).discussion;
  const codexParticipant = fixture.service.createTestParticipant({
    kind: 'AGENT',
    displayName: 'Crashed Codex',
    provider: 'openai',
    model: 'codex-crash-test',
  });
  const deterministicParticipant = fixture.service.createTestParticipant({
    kind: 'AGENT',
    displayName: 'Crashed deterministic agent',
    provider: 'deterministic',
    model: 'deterministic-v1',
  });
  const startedAt = new Date().toISOString();
  fixture.database.prepare('UPDATE discussions SET codex_thread_id = ? WHERE id = ?')
    .run('codex-thread-before-crash', discussion.id);
  fixture.database.prepare('UPDATE discussions SET codex_thread_id = ? WHERE id = ?')
    .run('codex-thread-cancellation-pending-at-crash', cancellationPendingDiscussion.id);
  const insertRun = fixture.database.prepare(`
    INSERT INTO agent_runs(
      id, discussion_id, participant_id, adapter, provider, model, prompt, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
  `);
  insertRun.run(
    'crashed-codex-run', discussion.id, codexParticipant.id, 'codex', 'openai', 'codex-crash-test',
    'This provider turn may still be live after the process disappears.', startedAt,
  );
  insertRun.run(
    'crashed-deterministic-run', deterministicDiscussion.id, deterministicParticipant.id,
    'deterministic', 'deterministic', 'deterministic-v1',
    'This local deterministic run can be retried after restart.', startedAt,
  );
  fixture.database.prepare(`
    INSERT INTO agent_runs(
      id, discussion_id, participant_id, adapter, provider, model, prompt, status,
      error_code, error_message, started_at
    ) VALUES (?, ?, ?, 'codex', 'openai', 'codex-crash-test', ?, 'INTERRUPTED', ?, ?, ?)
  `).run(
    'crashed-cancelled-codex-run',
    cancellationPendingDiscussion.id,
    codexParticipant.id,
    'The owner cancelled, but the process crashed before provider cleanup confirmation.',
    'CODEX_CLEANUP_PENDING',
    'Codex cancellation was requested and provider cleanup is still being confirmed.',
    startedAt,
  );

  await fixture.close();
  await fixture.open();
  const crashedCodex = fixture.service.getDiscussion(discussion.id).runs
    .find(run => run.id === 'crashed-codex-run');
  const crashedDeterministic = fixture.service.getDiscussion(deterministicDiscussion.id).runs
    .find(run => run.id === 'crashed-deterministic-run');
  const crashedCancellationPending = fixture.service.getDiscussion(cancellationPendingDiscussion.id).runs
    .find(run => run.id === 'crashed-cancelled-codex-run');
  assert.equal(crashedCodex.status, 'INTERRUPTED');
  assert.equal(crashedCodex.errorCode, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.equal(crashedDeterministic.status, 'INTERRUPTED');
  assert.equal(crashedDeterministic.errorCode, 'SERVICE_RESTARTED');
  assert.equal(crashedCancellationPending.status, 'INTERRUPTED');
  assert.equal(crashedCancellationPending.errorCode, 'CODEX_CLEANUP_UNCONFIRMED');
  assertAppError(() => fixture.service.retryAgentRun(crashedCodex.id, {
    idempotencyKey: idempotencyKey('crashed-codex-retry-refusal'),
  }), { status: 409, code: 'CONFLICT', message: /could not confirm that an earlier Codex turn stopped/ });
  assertAppError(() => fixture.service.retryAgentRun(crashedCancellationPending.id, {
    idempotencyKey: idempotencyKey('crashed-cancellation-pending-retry-refusal'),
  }), { status: 409, code: 'CONFLICT', message: /could not confirm that an earlier Codex turn stopped/ });
  const retriedDeterministic = fixture.service.retryAgentRun(crashedDeterministic.id, {
    idempotencyKey: idempotencyKey('crashed-deterministic-retry'),
  }).run;
  await waitForRun(
    fixture.service,
    deterministicDiscussion.id,
    retriedDeterministic.id,
    'COMPLETED',
  );
  const recoveryAudits = fixture.database.prepare(`
    SELECT resource_id AS resourceId, event_type AS eventType, details_json AS detailsJson
    FROM audit_events
    WHERE resource_id IN (
      'crashed-cancelled-codex-run', 'crashed-codex-run', 'crashed-deterministic-run'
    )
    ORDER BY resource_id
  `).all();
  assert.deepEqual(recoveryAudits.map(row => ({
    resourceId: row.resourceId,
    eventType: row.eventType,
    reason: JSON.parse(row.detailsJson).reason,
  })), [
    {
      resourceId: 'crashed-cancelled-codex-run',
      eventType: 'AGENT_CLEANUP_UNCONFIRMED',
      reason: 'CODEX_CLEANUP_UNCONFIRMED',
    },
    {
      resourceId: 'crashed-codex-run',
      eventType: 'AGENT_CLEANUP_UNCONFIRMED',
      reason: 'CODEX_CLEANUP_UNCONFIRMED',
    },
    {
      resourceId: 'crashed-deterministic-run',
      eventType: 'AGENT_RUN_INTERRUPTED',
      reason: 'SERVICE_RESTARTED',
    },
  ]);
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('durably quarantines a room and shared thread when Codex cleanup cannot be confirmed', async t => {
  const quarantinedThreadId = 'codex-thread-cleanup-unconfirmed';
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const codexAgent = {
    id: 'codex',
    provider: 'openai',
    model: 'codex-quarantine-test',
    displayName: 'Quarantine test Codex',
    async contribute({ prompt, signal, onThread }) {
      if (prompt !== 'Leave provider cleanup unconfirmed.') {
        return {
          provider: 'openai',
          model: 'codex-quarantine-test',
          content: `Completed safe independent turn: ${prompt}`,
        };
      }
      await onThread(quarantinedThreadId);
      resolveStarted();
      await new Promise(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      });
      const error = new Error('Sensitive provider cleanup detail must not be stored.');
      error.code = 'CODEX_CLEANUP_UNCONFIRMED';
      throw error;
    },
  };
  const deterministicAgent = {
    id: 'deterministic',
    provider: 'deterministic',
    model: 'quarantine-control',
    displayName: 'Deterministic control',
    async contribute({ prompt }) {
      if (prompt === 'A non-Codex adapter cannot claim the cleanup quarantine code.') {
        const error = new Error('A foreign adapter tried to claim a Codex-only state.');
        error.code = 'CODEX_CLEANUP_UNCONFIRMED';
        throw error;
      }
      return { provider: 'deterministic', model: 'quarantine-control', content: `Control: ${prompt}` };
    },
  };
  const agents = {
    get(adapter) {
      if (adapter === 'codex') return codexAgent;
      if (adapter === 'deterministic') return deterministicAgent;
      throw new Error(`Unexpected adapter ${adapter}`);
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: true }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'codex-quarantine-repository',
    projectName: 'Codex quarantine project',
    discussionTitle: 'Quarantined room',
  });
  const sharedDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Shared quarantined thread',
    idempotencyKey: idempotencyKey('quarantine-shared-room'),
  }).discussion;
  const independentDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Independent Codex room',
    idempotencyKey: idempotencyKey('quarantine-independent-room'),
  }).discussion;
  fixture.database.prepare('UPDATE discussions SET codex_thread_id = ? WHERE id = ?')
    .run(quarantinedThreadId, sharedDiscussion.id);
  fixture.database.prepare('UPDATE discussions SET codex_thread_id = ? WHERE id = ?')
    .run('codex-thread-independent-from-quarantine', independentDiscussion.id);

  const unsafe = fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Leave provider cleanup unconfirmed.',
    idempotencyKey: idempotencyKey('quarantine-unsafe-run'),
  }).run;
  await started;
  const cancelled = fixture.service.cancelAgentRun(unsafe.id, {
    idempotencyKey: idempotencyKey('quarantine-cancel-run'),
  }).run;
  assert.equal(cancelled.status, 'INTERRUPTED');
  assert.equal(cancelled.errorCode, 'CODEX_CLEANUP_PENDING');

  const cleanupDeadline = Date.now() + 2000;
  let quarantined;
  while (Date.now() < cleanupDeadline) {
    quarantined = fixture.service.getDiscussion(discussion.id).runs.find(run => run.id === unsafe.id);
    if (quarantined?.errorCode === 'CODEX_CLEANUP_UNCONFIRMED') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(quarantined.status, 'INTERRUPTED');
  assert.equal(quarantined.errorCode, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.match(quarantined.errorMessage, /could not confirm that the Codex contribution stopped/);
  assert.equal(quarantined.errorMessage.includes('Sensitive provider cleanup detail'), false);
  assert.equal(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.blocked, true);
  assert.match(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.reason, /blocked/);
  assert.equal(fixture.service.getDiscussion(sharedDiscussion.id).agentAvailability.codex.blocked, true);
  assert.equal(fixture.service.getDiscussion(independentDiscussion.id).agentAvailability.codex.blocked, false);
  const runCountBeforeRefusals = Number(fixture.database.prepare('SELECT COUNT(*) AS count FROM agent_runs').get().count);
  const assertQuarantined = targetDiscussionId => assertAppError(() => fixture.service.startAgentRun(targetDiscussionId, {
    adapter: 'codex',
    prompt: 'This Codex turn must remain blocked.',
    idempotencyKey: idempotencyKey(`quarantine-refusal-${targetDiscussionId}`),
  }), { status: 409, code: 'CONFLICT', message: /could not confirm that an earlier Codex turn stopped/ });
  assertQuarantined(discussion.id);
  assertQuarantined(sharedDiscussion.id);
  assert.equal(Number(fixture.database.prepare('SELECT COUNT(*) AS count FROM agent_runs').get().count), runCountBeforeRefusals);

  const deterministic = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'Deterministic planning remains available in the quarantined room.',
    idempotencyKey: idempotencyKey('quarantine-deterministic-control'),
  }).run;
  await waitForRun(fixture.service, discussion.id, deterministic.id, 'COMPLETED');
  const foreignCleanupCode = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: 'A non-Codex adapter cannot claim the cleanup quarantine code.',
    idempotencyKey: idempotencyKey('quarantine-foreign-code'),
  }).run;
  const normalizedForeignFailure = await waitForRun(
    fixture.service,
    discussion.id,
    foreignCleanupCode.id,
    'FAILED',
  );
  assert.equal(normalizedForeignFailure.errorCode, 'AGENT_FAILURE');
  const independent = fixture.service.startAgentRun(independentDiscussion.id, {
    adapter: 'codex',
    prompt: 'An unrelated Codex thread remains available.',
    idempotencyKey: idempotencyKey('quarantine-independent-codex'),
  }).run;
  await waitForRun(fixture.service, independentDiscussion.id, independent.id, 'COMPLETED');

  await fixture.close();
  await fixture.open();
  assertQuarantined(discussion.id);
  assertQuarantined(sharedDiscussion.id);
  assert.equal(fixture.service.getDiscussion(discussion.id).agentAvailability.codex.blocked, true);
  assert.equal(fixture.service.getDiscussion(sharedDiscussion.id).agentAvailability.codex.blocked, true);
  const cleanupAudit = fixture.database.prepare(`
    SELECT event_type AS eventType, details_json AS detailsJson
    FROM audit_events WHERE resource_id = ? AND event_type = 'AGENT_CLEANUP_UNCONFIRMED'
  `).get(unsafe.id);
  assert.equal(cleanupAudit.eventType, 'AGENT_CLEANUP_UNCONFIRMED');
  assert.equal(JSON.parse(cleanupAudit.detailsJson).code, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('shutdown timeout durably quarantines a Codex turn whose cleanup is still pending', async t => {
  const shutdownThreadId = 'codex-thread-pending-at-shutdown';
  const cancelledShutdownThreadId = 'codex-thread-cancelled-before-shutdown';
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  let resolveCancelledStarted;
  const cancelledStarted = new Promise(resolve => { resolveCancelledStarted = resolve; });
  let releaseProvider;
  const providerRelease = new Promise(resolve => { releaseProvider = resolve; });
  let resolveProviderReturned;
  const providerReturned = new Promise(resolve => { resolveProviderReturned = resolve; });
  let providerReturnCount = 0;
  const hangingCodexAgent = {
    id: 'codex',
    provider: 'openai',
    model: 'codex-shutdown-timeout-test',
    displayName: 'Shutdown timeout Codex',
    async contribute({ prompt, onThread }) {
      const cancelledBeforeShutdown = prompt === 'Remain active after owner cancellation and into shutdown.';
      await onThread(cancelledBeforeShutdown ? cancelledShutdownThreadId : shutdownThreadId);
      if (cancelledBeforeShutdown) resolveCancelledStarted();
      else resolveStarted();
      await providerRelease;
      providerReturnCount += 1;
      if (providerReturnCount === 2) resolveProviderReturned();
      return {
        provider: 'openai',
        model: 'codex-shutdown-timeout-test',
        content: 'This late provider result must never be persisted after shutdown.',
      };
    },
  };
  const agents = {
    get(adapter) {
      assert.equal(adapter, 'codex');
      return hangingCodexAgent;
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: false }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { project, discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'codex-shutdown-timeout-repository',
    projectName: 'Codex shutdown timeout project',
    discussionTitle: 'Pending cleanup room',
  });
  const cancelledDiscussion = fixture.service.createDiscussion(project.id, {
    title: 'Cancelled before shutdown room',
    idempotencyKey: idempotencyKey('shutdown-timeout-cancelled-room'),
  }).discussion;
  const run = fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Remain active beyond the service shutdown cleanup budget.',
    idempotencyKey: idempotencyKey('shutdown-timeout-run'),
  }).run;
  await started;
  const cancelledRun = fixture.service.startAgentRun(cancelledDiscussion.id, {
    adapter: 'codex',
    prompt: 'Remain active after owner cancellation and into shutdown.',
    idempotencyKey: idempotencyKey('shutdown-timeout-cancelled-run'),
  }).run;
  await cancelledStarted;
  const ownerCancelled = fixture.service.cancelAgentRun(cancelledRun.id, {
    idempotencyKey: idempotencyKey('shutdown-timeout-owner-cancel'),
  }).run;
  assert.equal(ownerCancelled.status, 'INTERRUPTED');
  assert.equal(ownerCancelled.errorCode, 'CODEX_CLEANUP_PENDING');

  await fixture.service.shutdown({ timeoutMs: 25 });
  const quarantined = fixture.service.getDiscussion(discussion.id).runs.find(candidate => candidate.id === run.id);
  const cancelledQuarantined = fixture.service.getDiscussion(cancelledDiscussion.id).runs
    .find(candidate => candidate.id === cancelledRun.id);
  assert.equal(quarantined.status, 'INTERRUPTED');
  assert.equal(quarantined.errorCode, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.match(quarantined.errorMessage, /could not confirm that the Codex contribution stopped/);
  assert.equal(cancelledQuarantined.status, 'INTERRUPTED');
  assert.equal(cancelledQuarantined.errorCode, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);

  releaseProvider();
  await providerReturned;
  await new Promise(resolve => setImmediate(resolve));
  await fixture.close();
  await fixture.open();
  const restored = fixture.service.getDiscussion(discussion.id);
  const restoredCancelled = fixture.service.getDiscussion(cancelledDiscussion.id);
  assert.equal(restored.messages.some(message => message.agentRunId === run.id), false);
  assert.equal(restored.runs.find(candidate => candidate.id === run.id).errorCode, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.equal(restoredCancelled.messages.some(message => message.agentRunId === cancelledRun.id), false);
  assert.equal(
    restoredCancelled.runs.find(candidate => candidate.id === cancelledRun.id).errorCode,
    'CODEX_CLEANUP_UNCONFIRMED',
  );
  assertAppError(() => fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Restart must not clear an unconfirmed provider turn.',
    idempotencyKey: idempotencyKey('shutdown-timeout-restart-refusal'),
  }), { status: 409, code: 'CONFLICT', message: /could not confirm that an earlier Codex turn stopped/ });
  assertAppError(() => fixture.service.startAgentRun(cancelledDiscussion.id, {
    adapter: 'codex',
    prompt: 'Owner cancellation must not erase an unconfirmed shutdown cleanup.',
    idempotencyKey: idempotencyKey('shutdown-cancelled-restart-refusal'),
  }), { status: 409, code: 'CONFLICT', message: /could not confirm that an earlier Codex turn stopped/ });
  fixture.service.verifyInvariants();
});

test('graceful shutdown awaits provider cancellation before closing SQLite', async t => {
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  let providerStopped = false;
  const cancellableAgent = {
    id: 'codex',
    provider: 'provider-test',
    model: 'shutdown-test',
    displayName: 'Shutdown test provider',
    contribute({ signal }) {
      resolveStarted();
      return new Promise((resolve, reject) => {
        const stop = () => {
          setTimeout(() => {
            providerStopped = true;
            const error = new Error('Provider stopped after cancellation acknowledgement.');
            error.code = 'CANCELLED';
            reject(error);
          }, 35);
        };
        if (signal.aborted) stop();
        else signal.addEventListener('abort', stop, { once: true });
      });
    },
  };
  const agents = {
    get(adapter) {
      assert.equal(adapter, 'codex');
      return cancellableAgent;
    },
    async capabilities() {
      return { codex: { available: true }, deterministic: { available: false }, imported: { available: true } };
    },
  };
  const fixture = await createFixture(t, { agents });
  const { discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'shutdown-repository',
    projectName: 'Shutdown project',
    discussionTitle: 'Shutdown room',
  });
  const run = fixture.service.startAgentRun(discussion.id, {
    adapter: 'codex',
    prompt: 'Wait until graceful shutdown interrupts this provider.',
    idempotencyKey: idempotencyKey('shutdown-run'),
  }).run;
  await started;

  const beganClosingAt = Date.now();
  await fixture.close();
  assert.equal(providerStopped, true);
  assert.ok(Date.now() - beganClosingAt >= 30);

  await fixture.open();
  const restored = fixture.service.getDiscussion(discussion.id).runs.find(candidate => candidate.id === run.id);
  assert.equal(restored.status, 'INTERRUPTED');
  assert.equal(restored.errorCode, 'SERVICE_SHUTDOWN');
  assert.equal(restored.errorMessage, 'The local service stopped before this contribution completed. Retry is available.');
  fixture.service.verifyInvariants();
});
