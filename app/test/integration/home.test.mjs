import assert from 'node:assert/strict';
import test from 'node:test';

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

test('an empty workspace reports nothing waiting on the owner', async t => {
  const fixture = await createFixture(t);
  const home = fixture.service.getHome();
  assert.equal(home.waitingCount, 0);
  assert.deepEqual(home.undecidedPoints, []);
  assert.deepEqual(home.draftPackages, []);
  assert.deepEqual(home.approvedNotDispatched, []);
  assert.deepEqual(home.stoppedWork, []);
});

test('an undecided point is waiting, and deciding it clears the entry', async t => {
  const fixture = await createFixture(t);
  const { discussion, project } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  const point = fixture.service.capturePoint(message.id, {
    pointType: 'REQUIREMENT',
    text: 'Only the owner decides this.',
    idempotencyKey: idempotencyKey('point'),
  }, 'owner-local').point;

  const waiting = fixture.service.getHome();
  assert.equal(waiting.waitingCount, 1);
  assert.equal(waiting.undecidedPoints.length, 1);
  assert.equal(waiting.undecidedPoints[0].id, point.id);
  assert.equal(waiting.undecidedPoints[0].projectId, project.id);
  assert.equal(waiting.undecidedPoints[0].discussionTitle, discussion.title);

  fixture.service.dispositionPoint(point.id, {
    disposition: 'REJECTED',
    expectedVersion: point.rowVersion,
    idempotencyKey: idempotencyKey('decide'),
  }, 'owner-local');
  assert.equal(fixture.service.getHome().undecidedPoints.length, 0);
});

test('a draft package reports whether it is ready for the approval checkpoint', async t => {
  const fixture = await createFixture(t);
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  captureAndAcceptPoint(fixture.service, message.id);

  const prepared = fixture.service.preparePackage(discussion.id, {
    idempotencyKey: idempotencyKey('prepare'),
  }, 'owner-local').version;
  const incomplete = fixture.service.getHome().draftPackages;
  assert.equal(incomplete.length, 1);
  assert.equal(incomplete[0].readyToApprove, false);
  assert.ok(incomplete[0].gaps.includes('Outcome'), 'names the missing sections');
  assert.equal(incomplete[0].sourceCount, 1);

  fixture.service.updatePackageVersion(prepared.id, {
    content: completePackageContent(),
    expectedVersion: prepared.rowVersion,
    idempotencyKey: idempotencyKey('update'),
  }, 'owner-local');
  const complete = fixture.service.getHome().draftPackages;
  assert.equal(complete[0].readyToApprove, true);
  assert.deepEqual(complete[0].gaps, []);
});

test('an approved package waits for dispatch and clears once dispatched', async t => {
  const fixture = await createFixture(t, { enableDeterministic: true });
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id);
  captureAndAcceptPoint(fixture.service, message.id);
  const version = approveCompleteDraft(fixture.service, discussion.id);

  const home = fixture.service.getHome();
  assert.equal(home.draftPackages.length, 0, 'an approved version is no longer a draft');
  assert.equal(home.approvedNotDispatched.length, 1);
  assert.equal(home.approvedNotDispatched[0].id, version.id);

  const run = await fixture.service.dispatchExecution(version.id, {
    adapter: 'deterministic', idempotencyKey: idempotencyKey('dispatch'),
  }, 'owner-local');
  await waitForExecution(fixture.service, discussion.id, run.id, 'SUCCEEDED');
  assert.equal(fixture.service.getHome().approvedNotDispatched.length, 0);
});

test('stopped work is listed until it is retried', async t => {
  const fixture = await createFixture(t, { enableDeterministic: true });
  const { discussion } = await createProjectAndDiscussion(fixture);
  const started = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: '[fail-once] challenge this package',
    idempotencyKey: idempotencyKey('run'),
  }, 'owner-local').run;
  await fixture.service.getDiscussion(discussion.id);
  const failed = await (async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const run = fixture.service.getDiscussion(discussion.id).runs.find(item => item.id === started.id);
      if (run && run.status === 'FAILED') return run;
      await new Promise(resolve => { setTimeout(resolve, 20); });
    }
    assert.fail('the deterministic run did not fail');
  })();

  const home = fixture.service.getHome();
  assert.equal(home.stoppedWork.length, 1);
  assert.equal(home.stoppedWork[0].id, failed.id);
  assert.equal(home.stoppedWork[0].kind, 'contribution');

  fixture.service.retryAgentRun(failed.id, { idempotencyKey: idempotencyKey('retry') }, 'owner-local');
  const afterRetry = fixture.service.getHome();
  assert.equal(
    afterRetry.stoppedWork.filter(item => item.id === failed.id).length,
    0,
    'a retried run is no longer waiting',
  );
});

test('the waiting list spans every project', async t => {
  const fixture = await createFixture(t);
  const first = await createProjectAndDiscussion(fixture, {
    projectName: 'First project', discussionTitle: 'First room',
  });
  const second = await createProjectAndDiscussion(fixture, {
    projectName: 'Second project', discussionTitle: 'Second room',
  });
  for (const workspace of [first, second]) {
    const message = addOwnerMessage(fixture.service, workspace.discussion.id);
    fixture.service.capturePoint(message.id, {
      pointType: 'QUESTION',
      text: `Undecided in ${workspace.project.name}`,
      idempotencyKey: idempotencyKey('point'),
    }, 'owner-local');
  }
  const home = fixture.service.getHome();
  assert.equal(home.undecidedPoints.length, 2);
  assert.deepEqual(
    [...new Set(home.undecidedPoints.map(point => point.projectName))].sort(),
    ['First project', 'Second project'],
  );
});
