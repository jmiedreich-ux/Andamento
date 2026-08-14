CREATE TABLE IF NOT EXISTS planning_point_identity_snapshots (
  planning_point_id TEXT PRIMARY KEY REFERENCES planning_points(id) ON DELETE RESTRICT,
  discussion_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  created_by_participant_id TEXT NOT NULL,
  point_type TEXT NOT NULL,
  text TEXT NOT NULL,
  supersedes_point_id TEXT,
  created_at TEXT NOT NULL
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS planning_point_decision_snapshots (
  planning_point_id TEXT PRIMARY KEY REFERENCES planning_points(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL CHECK (disposition IN ('ACCEPTED', 'REJECTED', 'DEFERRED', 'SUPERSEDED')),
  decided_by_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL CHECK (length(trim(decided_at)) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_cleanup_quarantine
ON agent_runs(error_code, discussion_id)
WHERE adapter = 'codex'
  AND error_code IN ('CODEX_CLEANUP_PENDING', 'CODEX_CLEANUP_UNCONFIRMED');

CREATE TABLE migration_004_point_authority_guard (
  valid INTEGER NOT NULL
    CONSTRAINT decided_points_require_owner_authority CHECK (valid = 1)
) STRICT;

INSERT INTO migration_004_point_authority_guard(valid)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM planning_points pp
  LEFT JOIN participants decided_by ON decided_by.id = pp.decided_by_participant_id
  WHERE (
    pp.disposition = 'PROPOSED'
    AND (pp.decided_by_participant_id IS NOT NULL OR pp.decided_at IS NOT NULL)
  ) OR (
    pp.disposition <> 'PROPOSED'
    AND (
      pp.decided_by_participant_id IS NULL
      OR pp.decided_at IS NULL
      OR length(trim(pp.decided_at)) = 0
      OR decided_by.kind IS NOT 'OWNER'
    )
  )
) THEN 0 ELSE 1 END;

DROP TABLE migration_004_point_authority_guard;

INSERT INTO planning_point_identity_snapshots(
  planning_point_id,
  discussion_id,
  source_message_id,
  created_by_participant_id,
  point_type,
  text,
  supersedes_point_id,
  created_at
)
SELECT
  id,
  discussion_id,
  source_message_id,
  created_by_participant_id,
  point_type,
  text,
  supersedes_point_id,
  created_at
FROM planning_points;

INSERT INTO planning_point_decision_snapshots(
  planning_point_id,
  disposition,
  decided_by_participant_id,
  decided_at
)
SELECT
  id,
  disposition,
  decided_by_participant_id,
  decided_at
FROM planning_points
WHERE disposition <> 'PROPOSED';

CREATE TRIGGER IF NOT EXISTS planning_point_identity_snapshots_append_only_update
BEFORE UPDATE ON planning_point_identity_snapshots BEGIN
  SELECT RAISE(ABORT, 'planning point identity snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS planning_point_identity_snapshots_append_only_delete
BEFORE DELETE ON planning_point_identity_snapshots BEGIN
  SELECT RAISE(ABORT, 'planning point identity snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS planning_point_decision_snapshots_append_only_update
BEFORE UPDATE ON planning_point_decision_snapshots BEGIN
  SELECT RAISE(ABORT, 'planning point decision snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS planning_point_decision_snapshots_append_only_delete
BEFORE DELETE ON planning_point_decision_snapshots BEGIN
  SELECT RAISE(ABORT, 'planning point decision snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS planning_points_snapshot_after_insert
AFTER INSERT ON planning_points BEGIN
  INSERT INTO planning_point_identity_snapshots(
    planning_point_id,
    discussion_id,
    source_message_id,
    created_by_participant_id,
    point_type,
    text,
    supersedes_point_id,
    created_at
  ) VALUES (
    NEW.id,
    NEW.discussion_id,
    NEW.source_message_id,
    NEW.created_by_participant_id,
    NEW.point_type,
    NEW.text,
    NEW.supersedes_point_id,
    NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS planning_points_identity_immutable_update
BEFORE UPDATE ON planning_points
WHEN NEW.id IS NOT OLD.id
  OR NEW.discussion_id IS NOT OLD.discussion_id
  OR NEW.source_message_id IS NOT OLD.source_message_id
  OR NEW.created_by_participant_id IS NOT OLD.created_by_participant_id
  OR NEW.point_type IS NOT OLD.point_type
  OR NEW.text IS NOT OLD.text
  OR NEW.supersedes_point_id IS NOT OLD.supersedes_point_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'planning point identity and text are immutable');
END;

CREATE TRIGGER IF NOT EXISTS planning_points_start_proposed_insert
BEFORE INSERT ON planning_points
WHEN NEW.disposition <> 'PROPOSED'
  OR NEW.decided_by_participant_id IS NOT NULL
  OR NEW.decided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'planning points must start proposed without decision metadata');
END;

CREATE TRIGGER IF NOT EXISTS planning_points_owner_decision_update
BEFORE UPDATE ON planning_points
WHEN (
  NEW.disposition = 'PROPOSED'
  AND (NEW.decided_by_participant_id IS NOT NULL OR NEW.decided_at IS NOT NULL)
) OR (
  NEW.disposition <> 'PROPOSED'
  AND (
    NEW.decided_by_participant_id IS NULL
    OR NEW.decided_at IS NULL
    OR length(trim(NEW.decided_at)) = 0
    OR NOT EXISTS (
      SELECT 1 FROM participants
      WHERE id = NEW.decided_by_participant_id AND kind = 'OWNER'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'planning point decisions require owner authority and complete decision metadata');
END;

CREATE TRIGGER IF NOT EXISTS planning_points_decision_snapshot_after_update
AFTER UPDATE ON planning_points
WHEN OLD.disposition = 'PROPOSED' AND NEW.disposition <> 'PROPOSED'
BEGIN
  INSERT INTO planning_point_decision_snapshots(
    planning_point_id,
    disposition,
    decided_by_participant_id,
    decided_at
  ) VALUES (
    NEW.id,
    NEW.disposition,
    NEW.decided_by_participant_id,
    NEW.decided_at
  );
END;
