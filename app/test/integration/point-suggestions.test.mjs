import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSuggestions } from '../../server/agents/suggestions.mjs';
import {
  addOwnerMessage,
  createProjectAndDiscussion,
  createFixture,
  idempotencyKey,
} from './test-support.mjs';

const CONTRIBUTION = 'Every package needs one explicit owner approval. '
  + 'Skipping review would let unreviewed work ship. '
  + 'Should execution run automatically after approval?';

async function seeded(t) {
  const fixture = await createFixture(t, { enableDeterministic: true });
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id, CONTRIBUTION);
  return { fixture, discussion, message };
}

function suggest(fixture, messageId, overrides = {}) {
  return fixture.service.suggestPoints(messageId, {
    adapter: 'deterministic',
    idempotencyKey: idempotencyKey('suggest'),
    ...overrides,
  }, 'owner-local');
}

test('parsing keeps decidable candidates and drops the noise around them', () => {
  const parsed = parseSuggestions([
    'REQUIREMENT|Every package needs one explicit owner approval.',
    '- RISK: Skipping review would let unreviewed work ship.',
    '1. QUESTION | Should execution run automatically after approval?',
    'NONSENSE_TYPE|Falls back to a proposal rather than being dropped.',
    'short',
    '',
    'REQUIREMENT|Every package needs one explicit owner approval.',
  ].join('\n'));
  assert.deepEqual(parsed.map(item => item.pointType), ['REQUIREMENT', 'RISK', 'QUESTION', 'PROPOSED_WORK']);
  assert.match(parsed[3].text, /^Falls back/);
  assert.equal(parsed.length, 4, 'the duplicate and the too-short line are dropped');
});

test('suggestions are candidates: they create no planning points and carry no authority', async t => {
  const { fixture, discussion, message } = await seeded(t);
  const result = await suggest(fixture, message.id);
  assert.equal(result.count > 0, true);

  const detail = fixture.service.getDiscussion(discussion.id);
  assert.equal(detail.points.length, 0, 'nothing became a planning point');
  assert.equal(detail.suggestions.length, result.count);
  for (const suggestion of detail.suggestions) {
    assert.equal(suggestion.status, 'PENDING');
    assert.equal(suggestion.capturedPointId, null);
    assert.equal(suggestion.sourceMessageId, message.id);
    assert.equal(suggestion.provider, 'deterministic');
  }
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('capturing a suggestion creates a proposal and resolves it in the same act', async t => {
  const { fixture, discussion, message } = await seeded(t);
  const [candidate] = (await suggest(fixture, message.id)).suggestions;

  const captured = fixture.service.capturePoint(message.id, {
    pointType: candidate.pointType,
    text: candidate.text,
    suggestionId: candidate.id,
    idempotencyKey: idempotencyKey('capture'),
  }, 'owner-local').point;

  assert.equal(captured.disposition, 'PROPOSED', 'a captured suggestion still needs an owner decision');
  assert.equal(captured.sourceMessageId, message.id, 'lineage points at the contribution, not the agent');

  const detail = fixture.service.getDiscussion(discussion.id);
  assert.equal(detail.points.length, 1);
  assert.equal(detail.suggestions.some(item => item.id === candidate.id), false, 'it is no longer pending');
  const stored = fixture.database.prepare('SELECT status, captured_point_id AS pointId FROM point_suggestions WHERE id = ?')
    .get(candidate.id);
  assert.equal(stored.status, 'CAPTURED');
  assert.equal(stored.pointId, captured.id);
  assert.equal(fixture.service.verifyInvariants().passed.length, 25);
});

test('a resolved suggestion is final, at the service and at the storage boundary', async t => {
  const { fixture, message } = await seeded(t);
  const [candidate] = (await suggest(fixture, message.id)).suggestions;
  fixture.service.dismissSuggestion(candidate.id, { idempotencyKey: idempotencyKey('dismiss') }, 'owner-local');

  assert.throws(
    () => fixture.service.dismissSuggestion(candidate.id, { idempotencyKey: idempotencyKey('again') }, 'owner-local'),
    error => {
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.throws(
    () => fixture.service.capturePoint(message.id, {
      pointType: candidate.pointType,
      text: candidate.text,
      suggestionId: candidate.id,
      idempotencyKey: idempotencyKey('capture-dismissed'),
    }, 'owner-local'),
    error => {
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.throws(() => fixture.database.prepare(
    "UPDATE point_suggestions SET status = 'PENDING', resolved_at = '' WHERE id = ?",
  ).run(candidate.id), /already resolved|resolved suggestion is final/);
});

test('the recorded suggestion text is immutable evidence of what was proposed', async t => {
  const { fixture, message } = await seeded(t);
  const [candidate] = (await suggest(fixture, message.id)).suggestions;
  assert.throws(() => fixture.database.prepare(
    'UPDATE point_suggestions SET text = ? WHERE id = ?',
  ).run('something the agent never said', candidate.id), /immutable/);
});

test('only the owner may ask for or resolve suggestions', async t => {
  const { fixture, message } = await seeded(t);
  const agent = fixture.service.ensureParticipant({
    participantKey: 'agent:test:impostor',
    kind: 'AGENT',
    displayName: 'Impostor',
    provider: 'test',
    model: 'impostor-v1',
  });
  await assert.rejects(
    () => fixture.service.suggestPoints(message.id, {
      adapter: 'deterministic', idempotencyKey: idempotencyKey('suggest'),
    }, agent.id),
    error => {
      assert.equal(error.status, 403);
      return true;
    },
  );
  const [candidate] = (await suggest(fixture, message.id)).suggestions;
  assert.throws(
    () => fixture.service.dismissSuggestion(candidate.id, { idempotencyKey: idempotencyKey('dismiss') }, agent.id),
    error => {
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test('a contribution with nothing decidable produces no candidates rather than invented ones', async t => {
  const fixture = await createFixture(t, { enableDeterministic: true });
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id, 'Thanks. [no-points]');
  const result = await suggest(fixture, message.id);
  assert.equal(result.count, 0);
  assert.deepEqual(fixture.service.getDiscussion(discussion.id).suggestions, []);
});

test('a participant failure is reported safely and records nothing', async t => {
  const fixture = await createFixture(t, { enableDeterministic: true });
  const { discussion } = await createProjectAndDiscussion(fixture);
  const message = addOwnerMessage(fixture.service, discussion.id, 'Read this. [fail]');
  await assert.rejects(
    () => suggest(fixture, message.id),
    error => {
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /stack|at Object/i);
      return true;
    },
  );
  assert.deepEqual(fixture.service.getDiscussion(discussion.id).suggestions, []);
});
