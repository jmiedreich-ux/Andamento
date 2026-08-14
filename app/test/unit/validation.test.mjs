import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeError } from '../../server/domain/errors.mjs';
import {
  expectedVersion,
  oneOf,
  optionalText,
  packageApprovalGaps,
  packageContent,
  requiredIdempotencyKey,
  requiredText,
  stringList,
} from '../../server/domain/validation.mjs';

function assertAppError(callback, { status = 400, code = 'VALIDATION_ERROR', message }) {
  assert.throws(callback, error => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test('text validation trims valid values and refuses missing, non-text, and oversized input', () => {
  assert.equal(requiredText('  durable decision  ', 'Decision', { max: 20 }), 'durable decision');
  assert.equal(optionalText(undefined, 'Model'), '');
  assert.equal(optionalText('  sonnet  ', 'Model'), 'sonnet');

  assertAppError(() => requiredText('   ', 'Decision'), { message: /Decision is required/ });
  assertAppError(() => requiredText(42, 'Decision'), { message: /Decision is required/ });
  assertAppError(() => requiredText('12345', 'Decision', { max: 4 }), { message: /4 characters or fewer/ });
  assertAppError(() => optionalText({}, 'Model'), { message: /Model must be text/ });
});

test('identifiers, enumerations, and optimistic versions reject unsafe values', () => {
  assert.equal(requiredIdempotencyKey('package.approve:123'), 'package.approve:123');
  assert.equal(oneOf('RISK', ['RISK', 'DECISION'], 'Type'), 'RISK');
  assert.equal(expectedVersion(2), 2);

  for (const key of ['', 'short', '-unsafe-start', 'contains spaces']) {
    assertAppError(() => requiredIdempotencyKey(key), { message: /Idempotency key/ });
  }
  assertAppError(() => oneOf('UNKNOWN', ['RISK', 'DECISION'], 'Type'), { message: /RISK, DECISION/ });
  for (const value of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assertAppError(() => expectedVersion(value), { message: /positive integer/ });
  }
});

test('list and package validation normalize every field and report all approval gaps', () => {
  assert.deepEqual(stringList([' first ', 'second'], 'Items'), ['first', 'second']);
  assertAppError(() => stringList('not-a-list', 'Items'), { message: /must be a list/ });
  assertAppError(() => stringList([], 'Items', { min: 1 }), { message: /requires at least 1 item/ });
  assertAppError(() => stringList(['one', 'two'], 'Items', { maxItems: 1 }), { message: /at most 1 item/ });
  assertAppError(() => stringList([''], 'Items'), { message: /Items item 1 is required/ });

  const empty = packageContent({});
  assert.deepEqual(empty, {
    outcome: '',
    includedScope: [],
    exclusions: [],
    acceptanceCriteria: [],
    reviewRequirements: [],
    evidenceRequirements: [],
  });
  assert.deepEqual(packageApprovalGaps(empty), [
    'Outcome',
    'Included scope',
    'Exclusions',
    'Acceptance criteria',
    'Review requirements',
    'Evidence requirements',
  ]);

  const complete = packageContent({
    outcome: '  A ready package  ',
    includedScope: ['  source-linked scope  '],
    exclusions: ['Execution'],
    acceptanceCriteria: ['Owner sees READY_FOR_EXECUTION'],
    reviewRequirements: ['Independent review'],
    evidenceRequirements: ['Rerunnable test output'],
  });
  assert.equal(complete.outcome, 'A ready package');
  assert.deepEqual(complete.includedScope, ['source-linked scope']);
  assert.deepEqual(packageApprovalGaps(complete), []);

  const maximumPlanningPoint = 'p'.repeat(2000);
  assert.deepEqual(packageContent({ includedScope: [maximumPlanningPoint] }).includedScope, [maximumPlanningPoint]);
  assertAppError(() => packageContent({ includedScope: [`${maximumPlanningPoint}p`] }), {
    message: /Included scope item 1 must be 2000 characters or fewer/,
  });

  assertAppError(() => packageContent(null), { message: /Package content is required/ });
  assertAppError(() => packageContent([]), { message: /Package content is required/ });
});

test('unexpected storage failures normalize without leaking internal details', () => {
  const duplicate = normalizeError(new Error('UNIQUE constraint failed: projects.repository_root'));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.code, 'CONFLICT');

  const immutable = normalizeError(new Error('approved work package versions are immutable'));
  assert.equal(immutable.status, 409);
  assert.equal(immutable.code, 'CONFLICT');

  const unexpected = normalizeError(new Error('password=do-not-leak'));
  assert.equal(unexpected.status, 500);
  assert.equal(unexpected.code, 'INTERNAL_ERROR');
  assert.equal(unexpected.message, 'Andamento could not complete the request.');
  assert.doesNotMatch(unexpected.message, /password/);
});
