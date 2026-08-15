-- Package execution, milestone 2: an approved package is authorization to act.
-- Dispatch applies the proposed change set to the allowlisted repository.
-- The owner's approval of the package is the boundary; there is no second one.
--
-- Undo belongs to Andamento, not to git: every file the change set touches is
-- snapshotted before it is written, so a revert never depends on the owner
-- having committed first.

CREATE TABLE IF NOT EXISTS execution_applications (
  id TEXT PRIMARY KEY,
  execution_run_id TEXT NOT NULL UNIQUE REFERENCES execution_runs(id) ON DELETE RESTRICT,
  work_package_version_id TEXT NOT NULL REFERENCES work_package_versions(id) ON DELETE RESTRICT,
  diff_sha256 TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count > 0),
  repository_root TEXT NOT NULL,
  backup_manifest_json TEXT NOT NULL CHECK (json_valid(backup_manifest_json)),
  applied_at TEXT NOT NULL,
  reverted_at TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX IF NOT EXISTS idx_execution_applications_version
  ON execution_applications(work_package_version_id, applied_at DESC);

-- Files are only ever written for a run that recorded the exact change set,
-- and the applied hash must equal the recorded one, so the durable record is a
-- truthful account of what happened to the repository.
CREATE TRIGGER IF NOT EXISTS execution_applications_match_change_set
BEFORE INSERT ON execution_applications
WHEN NOT EXISTS (
  SELECT 1 FROM execution_change_sets ecs
  WHERE ecs.execution_run_id = NEW.execution_run_id
    AND ecs.work_package_version_id = NEW.work_package_version_id
    AND ecs.diff_sha256 = NEW.diff_sha256
    AND ecs.file_count = NEW.file_count
)
BEGIN
  SELECT RAISE(ABORT, 'an application must match its recorded change set exactly');
END;

-- What was applied is append-only. Only the revert stamp may ever change.
CREATE TRIGGER IF NOT EXISTS execution_applications_append_only
BEFORE UPDATE ON execution_applications
WHEN NEW.execution_run_id <> OLD.execution_run_id
  OR NEW.work_package_version_id <> OLD.work_package_version_id
  OR NEW.diff_sha256 <> OLD.diff_sha256
  OR NEW.file_count <> OLD.file_count
  OR NEW.repository_root <> OLD.repository_root
  OR NEW.backup_manifest_json <> OLD.backup_manifest_json
  OR NEW.applied_at <> OLD.applied_at
  OR (OLD.reverted_at <> '' AND NEW.reverted_at <> OLD.reverted_at)
BEGIN
  SELECT RAISE(ABORT, 'an execution application is append-only; only its revert may be recorded once');
END;

CREATE TRIGGER IF NOT EXISTS execution_applications_no_delete
BEFORE DELETE ON execution_applications
BEGIN
  SELECT RAISE(ABORT, 'execution applications cannot be deleted');
END;
