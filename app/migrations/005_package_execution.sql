-- Package execution, milestone 1: dispatch an approved version and record a
-- proposed change set. Nothing in this migration permits a repository write.

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  work_package_version_id TEXT NOT NULL REFERENCES work_package_versions(id) ON DELETE RESTRICT,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  dispatched_by_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  adapter TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  repository_root TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS execution_change_sets (
  id TEXT PRIMARY KEY,
  execution_run_id TEXT NOT NULL UNIQUE REFERENCES execution_runs(id) ON DELETE RESTRICT,
  work_package_version_id TEXT NOT NULL REFERENCES work_package_versions(id) ON DELETE RESTRICT,
  diff TEXT NOT NULL,
  diff_sha256 TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_execution_runs_version
  ON execution_runs(work_package_version_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_runs_discussion
  ON execution_runs(discussion_id, started_at DESC);

-- Only an approved version may be dispatched. This is the second owner
-- boundary: approval marks a version ready, dispatch is a separate act.
CREATE TRIGGER IF NOT EXISTS execution_runs_require_ready_version
BEFORE INSERT ON execution_runs
WHEN NOT EXISTS (
  SELECT 1 FROM work_package_versions
  WHERE id = NEW.work_package_version_id AND status = 'READY_FOR_EXECUTION'
)
BEGIN
  SELECT RAISE(ABORT, 'execution requires an approved work package version');
END;

-- Dispatch is an owner act.
CREATE TRIGGER IF NOT EXISTS execution_runs_require_owner_dispatch
BEFORE INSERT ON execution_runs
WHEN NOT EXISTS (
  SELECT 1 FROM participants
  WHERE id = NEW.dispatched_by_participant_id AND kind = 'OWNER'
)
BEGIN
  SELECT RAISE(ABORT, 'execution dispatch requires owner authority');
END;

-- A change set may only exist for a run that produced it, and must belong to
-- the same version the run was dispatched against.
CREATE TRIGGER IF NOT EXISTS execution_change_sets_match_run
BEFORE INSERT ON execution_change_sets
WHEN NOT EXISTS (
  SELECT 1 FROM execution_runs
  WHERE id = NEW.execution_run_id
    AND work_package_version_id = NEW.work_package_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'a change set must belong to its dispatched version');
END;

-- Change sets are immutable evidence.
CREATE TRIGGER IF NOT EXISTS execution_change_sets_immutable
BEFORE UPDATE ON execution_change_sets
BEGIN
  SELECT RAISE(ABORT, 'recorded change sets are immutable');
END;

CREATE TRIGGER IF NOT EXISTS execution_change_sets_no_delete
BEFORE DELETE ON execution_change_sets
BEGIN
  SELECT RAISE(ABORT, 'recorded change sets cannot be deleted');
END;

-- An execution run never changes which version it was dispatched against.
CREATE TRIGGER IF NOT EXISTS execution_runs_version_immutable
BEFORE UPDATE ON execution_runs
WHEN NEW.work_package_version_id <> OLD.work_package_version_id
  OR NEW.dispatched_by_participant_id <> OLD.dispatched_by_participant_id
  OR NEW.repository_root <> OLD.repository_root
BEGIN
  SELECT RAISE(ABORT, 'execution run lineage is immutable');
END;
