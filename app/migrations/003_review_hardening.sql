ALTER TABLE mutation_receipts
  ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT 'LEGACY_UNBOUND'
  CHECK (
    request_fingerprint = 'LEGACY_UNBOUND'
    OR (length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*')
  );

CREATE TABLE IF NOT EXISTS approved_package_point_snapshots (
  work_package_version_id TEXT NOT NULL REFERENCES work_package_versions(id) ON DELETE RESTRICT,
  planning_point_id TEXT NOT NULL REFERENCES planning_points(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (work_package_version_id, planning_point_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE migration_003_approved_lineage_guard (
  valid INTEGER NOT NULL
    CONSTRAINT approved_versions_require_source_lineage CHECK (valid = 1)
) STRICT;

INSERT INTO migration_003_approved_lineage_guard(valid)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM work_package_versions wpv
  WHERE wpv.status = 'READY_FOR_EXECUTION'
    AND NOT EXISTS (
      SELECT 1
      FROM work_package_points wpp
      WHERE wpp.work_package_version_id = wpv.id
    )
) THEN 0 ELSE 1 END;

DROP TABLE migration_003_approved_lineage_guard;

CREATE INDEX IF NOT EXISTS idx_approved_package_point_snapshots_point
  ON approved_package_point_snapshots(planning_point_id);

INSERT OR IGNORE INTO approved_package_point_snapshots(
  work_package_version_id,
  planning_point_id,
  captured_at
)
SELECT wpp.work_package_version_id, wpp.planning_point_id, ae.occurred_at
FROM work_package_points wpp
JOIN approval_events ae ON ae.work_package_version_id = wpp.work_package_version_id;

CREATE TRIGGER IF NOT EXISTS approved_package_point_snapshots_append_only_update
BEFORE UPDATE ON approved_package_point_snapshots BEGIN
  SELECT RAISE(ABORT, 'approved work package point snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS approved_package_point_snapshots_append_only_delete
BEFORE DELETE ON approved_package_point_snapshots BEGIN
  SELECT RAISE(ABORT, 'approved work package point snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS approved_version_points_immutable_update
BEFORE UPDATE ON work_package_points
WHEN EXISTS (
  SELECT 1 FROM work_package_versions
  WHERE id = OLD.work_package_version_id AND status = 'READY_FOR_EXECUTION'
)
OR EXISTS (
  SELECT 1 FROM work_package_versions
  WHERE id = NEW.work_package_version_id AND status = 'READY_FOR_EXECUTION'
) BEGIN
  SELECT RAISE(ABORT, 'approved work package point sources are immutable');
END;

CREATE TRIGGER IF NOT EXISTS ready_versions_require_sources_insert
BEFORE INSERT ON work_package_versions
WHEN NEW.status = 'READY_FOR_EXECUTION'
AND NOT EXISTS (
  SELECT 1 FROM work_package_points
  WHERE work_package_version_id = NEW.id
) BEGIN
  SELECT RAISE(ABORT, 'approved work package versions require at least one source');
END;

CREATE TRIGGER IF NOT EXISTS ready_versions_require_sources_update
BEFORE UPDATE OF status ON work_package_versions
WHEN NEW.status = 'READY_FOR_EXECUTION'
AND NOT EXISTS (
  SELECT 1 FROM work_package_points
  WHERE work_package_version_id = NEW.id
) BEGIN
  SELECT RAISE(ABORT, 'approved work package versions require at least one source');
END;
