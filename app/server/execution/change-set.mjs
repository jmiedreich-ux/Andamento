import { createHash } from 'node:crypto';

const FENCE = /^```[a-zA-Z-]*\s*\n([\s\S]*?)\n?```\s*$/;

export function buildExecutionPrompt(content) {
  const list = values => (values || []).map(value => `- ${value}`).join('\n') || '- none stated';
  return [
    'You are proposing a change set for an approved work package.',
    '',
    'Return ONLY a unified diff, with no commentary before or after it.',
    'Use standard `diff --git a/<path> b/<path>` headers with `---`/`+++` and `@@` hunks.',
    'Propose no change at all rather than inventing work outside the stated scope.',
    'Do not modify files outside the repository you were given.',
    '',
    `# Outcome\n${content.outcome}`,
    `\n# Included scope\n${list(content.includedScope)}`,
    `\n# Exclusions\n${list(content.exclusions)}`,
    `\n# Acceptance criteria\n${list(content.acceptanceCriteria)}`,
    `\n# Review requirements\n${list(content.reviewRequirements)}`,
    `\n# Evidence requirements\n${list(content.evidenceRequirements)}`,
  ].join('\n');
}

export function normalizeDiff(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  const fenced = trimmed.match(FENCE);
  return (fenced ? fenced[1] : trimmed).replace(/\r\n/g, '\n').trim();
}

export function changedFiles(diff) {
  const paths = new Set();
  for (const line of diff.split('\n')) {
    const git = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (git) {
      paths.add(git[2]);
      continue;
    }
    const target = line.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/);
    if (target && target[1] !== '/dev/null') paths.add(target[1]);
  }
  return [...paths];
}

export function escapesRepository(diff) {
  return changedFiles(diff).some(file => file.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(file)
    || file.split(/[\\/]/).includes('..'));
}

export function buildChangeSet(text) {
  const diff = normalizeDiff(text);
  if (!diff) return { diff: '', diffSha256: createHash('sha256').update('').digest('hex'), files: [], fileCount: 0 };
  if (!/^(diff --git |--- |\+\+\+ |@@ )/m.test(diff)) {
    const error = new Error('The participant returned an unusable change set.');
    error.code = 'MALFORMED_CHANGE_SET';
    throw error;
  }
  if (escapesRepository(diff)) {
    const error = new Error('The proposed change set refers to a path outside the project repository.');
    error.code = 'CHANGE_SET_ESCAPES_REPOSITORY';
    throw error;
  }
  const files = changedFiles(diff);
  return {
    diff,
    diffSha256: createHash('sha256').update(diff).digest('hex'),
    files,
    fileCount: files.length,
  };
}
