import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { changedFiles } from './change-set.mjs';

const execFileAsync = promisify(execFile);

function applyFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function insideRepository(repositoryRoot, filePath) {
  const resolved = path.resolve(repositoryRoot, filePath);
  const relative = path.relative(repositoryRoot, resolved);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Snapshot every file the change set touches so a revert never depends on the
// owner having committed. Missing files are recorded as absent, not skipped.
async function snapshotFiles(repositoryRoot, backupDirectory, files) {
  await mkdir(backupDirectory, { recursive: true });
  const manifest = [];
  for (const [index, file] of files.entries()) {
    if (!insideRepository(repositoryRoot, file)) {
      throw applyFailure(
        'The proposed change set refers to a path outside the project repository.',
        'CHANGE_SET_ESCAPES_REPOSITORY',
      );
    }
    const absolute = path.resolve(repositoryRoot, file);
    let previous = null;
    try {
      previous = await readFile(absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (previous === null) {
      manifest.push({ file, existedBefore: false, backup: '' });
      continue;
    }
    const backup = `${index}.bak`;
    await writeFile(path.join(backupDirectory, backup), previous);
    manifest.push({ file, existedBefore: true, backup });
  }
  return manifest;
}

export async function applyChangeSet({ repositoryRoot, backupDirectory, diff }) {
  const files = changedFiles(diff);
  if (!files.length) return { applied: false, files: [], manifest: [] };
  const manifest = await snapshotFiles(repositoryRoot, backupDirectory, files);
  const patchPath = path.join(backupDirectory, `${randomUUID()}.patch`);
  await writeFile(patchPath, diff.endsWith('\n') ? diff : `${diff}\n`, 'utf8');
  try {
    // git apply validates the whole patch before touching anything, so a
    // rejected patch leaves the working tree exactly as it was.
    await execFileAsync('git', ['apply', '--whitespace=nowarn', patchPath], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
  } catch {
    throw applyFailure(
      'The proposed change set did not apply cleanly to the current files. Nothing was changed.',
      'CHANGE_SET_DID_NOT_APPLY',
    );
  } finally {
    await rm(patchPath, { force: true });
  }
  return { applied: true, files, manifest };
}

export async function revertApplication({ repositoryRoot, backupDirectory, manifest }) {
  const restored = [];
  for (const entry of manifest) {
    if (!insideRepository(repositoryRoot, entry.file)) continue;
    const absolute = path.resolve(repositoryRoot, entry.file);
    if (!entry.existedBefore) {
      await rm(absolute, { force: true });
      restored.push(entry.file);
      continue;
    }
    const backup = await readFile(path.join(backupDirectory, entry.backup));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, backup);
    restored.push(entry.file);
  }
  return restored;
}
