import { validationError } from './errors.mjs';

export function requiredText(value, label, { min = 1, max = 2000 } = {}) {
  if (typeof value !== 'string') throw validationError(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < min) throw validationError(`${label} is required.`);
  if (normalized.length > max) throw validationError(`${label} must be ${max} characters or fewer.`);
  return normalized;
}

export function optionalText(value, label, { max = 2000 } = {}) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw validationError(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > max) throw validationError(`${label} must be ${max} characters or fewer.`);
  return normalized;
}

export function requiredId(value, label = 'Identifier') {
  return requiredText(value, label, { max: 120 });
}

export function requiredIdempotencyKey(value) {
  const key = requiredText(value, 'Idempotency key', { max: 160 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(key)) {
    throw validationError('Idempotency key must be at least 8 safe characters.');
  }
  return key;
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw validationError(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

export function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw validationError('Expected version must be a positive integer.');
  }
  return value;
}

export function stringList(value, label, { min = 0, maxItems = 100, maxItemLength = 1000 } = {}) {
  if (!Array.isArray(value)) throw validationError(`${label} must be a list.`);
  if (value.length < min) throw validationError(`${label} requires at least ${min} item${min === 1 ? '' : 's'}.`);
  if (value.length > maxItems) throw validationError(`${label} may contain at most ${maxItems} items.`);
  return value.map((item, index) => requiredText(item, `${label} item ${index + 1}`, { max: maxItemLength }));
}

export function packageContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Package content is required.');
  }
  return {
    outcome: optionalText(input.outcome, 'Outcome', { max: 4000 }),
    includedScope: stringList(input.includedScope ?? [], 'Included scope', { maxItems: 100, maxItemLength: 1200 }),
    exclusions: stringList(input.exclusions ?? [], 'Exclusions', { maxItems: 100, maxItemLength: 1200 }),
    acceptanceCriteria: stringList(input.acceptanceCriteria ?? [], 'Acceptance criteria', { maxItems: 100, maxItemLength: 1200 }),
    reviewRequirements: stringList(input.reviewRequirements ?? [], 'Review requirements', { maxItems: 50, maxItemLength: 1200 }),
    evidenceRequirements: stringList(input.evidenceRequirements ?? [], 'Evidence requirements', { maxItems: 50, maxItemLength: 1200 }),
  };
}

export function packageApprovalGaps(content) {
  const gaps = [];
  if (!content.outcome.trim()) gaps.push('Outcome');
  if (!content.includedScope.length) gaps.push('Included scope');
  if (!content.exclusions.length) gaps.push('Exclusions');
  if (!content.acceptanceCriteria.length) gaps.push('Acceptance criteria');
  if (!content.reviewRequirements.length) gaps.push('Review requirements');
  if (!content.evidenceRequirements.length) gaps.push('Evidence requirements');
  return gaps;
}
