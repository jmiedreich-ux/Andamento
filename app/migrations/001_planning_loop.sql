CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  participant_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('OWNER', 'AGENT', 'IMPORTED')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  repository_root TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  codex_thread_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  adapter TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 12000),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED')),
  error_code TEXT,
  error_message TEXT,
  retry_of_run_id TEXT REFERENCES agent_runs(id) ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  agent_run_id TEXT UNIQUE REFERENCES agent_runs(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 20000),
  contribution_type TEXT NOT NULL CHECK (contribution_type IN ('OWNER', 'AGENT', 'IMPORTED')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS planning_points (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  created_by_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  point_type TEXT NOT NULL CHECK (point_type IN ('QUESTION', 'DECISION', 'REQUIREMENT', 'CONSTRAINT', 'RISK', 'DEPENDENCY', 'ASSUMPTION', 'PROPOSED_WORK', 'PARKING_LOT')),
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 2000),
  disposition TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (disposition IN ('PROPOSED', 'ACCEPTED', 'REJECTED', 'DEFERRED', 'SUPERSEDED')),
  decided_by_participant_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
  decided_at TEXT,
  supersedes_point_id TEXT REFERENCES planning_points(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS work_packages (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL UNIQUE REFERENCES discussions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS work_package_versions (
  id TEXT PRIMARY KEY,
  work_package_id TEXT NOT NULL REFERENCES work_packages(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY_FOR_EXECUTION')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  UNIQUE (work_package_id, version_number)
) STRICT;

CREATE TABLE IF NOT EXISTS work_package_points (
  work_package_version_id TEXT NOT NULL REFERENCES work_package_versions(id) ON DELETE RESTRICT,
  planning_point_id TEXT NOT NULL REFERENCES planning_points(id) ON DELETE RESTRICT,
  PRIMARY KEY (work_package_version_id, planning_point_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS approval_events (
  id TEXT PRIMARY KEY,
  work_package_version_id TEXT NOT NULL UNIQUE REFERENCES work_package_versions(id) ON DELETE RESTRICT,
  owner_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  authorization_scope TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  actor_participant_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mutation_receipts (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_discussions_project_updated
  ON discussions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_discussion_created
  ON messages(discussion_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_discussion_status
  ON agent_runs(discussion_id, status, started_at);
CREATE INDEX IF NOT EXISTS idx_points_discussion_disposition
  ON planning_points(discussion_id, disposition, created_at);
CREATE INDEX IF NOT EXISTS idx_points_source
  ON planning_points(source_message_id);
CREATE INDEX IF NOT EXISTS idx_package_versions_package_number
  ON work_package_versions(work_package_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_package_points_point
  ON work_package_points(planning_point_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_events(resource_type, resource_id, sequence);

CREATE TRIGGER IF NOT EXISTS messages_append_only_update
BEFORE UPDATE ON messages BEGIN
  SELECT RAISE(ABORT, 'messages are append-only');
END;

CREATE TRIGGER IF NOT EXISTS messages_append_only_delete
BEFORE DELETE ON messages BEGIN
  SELECT RAISE(ABORT, 'messages are append-only');
END;

CREATE TRIGGER IF NOT EXISTS approval_events_append_only_update
BEFORE UPDATE ON approval_events BEGIN
  SELECT RAISE(ABORT, 'approval events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS approval_events_append_only_delete
BEFORE DELETE ON approval_events BEGIN
  SELECT RAISE(ABORT, 'approval events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_append_only_update
BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_append_only_delete
BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS mutation_receipts_append_only_update
BEFORE UPDATE ON mutation_receipts BEGIN
  SELECT RAISE(ABORT, 'mutation receipts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS mutation_receipts_append_only_delete
BEFORE DELETE ON mutation_receipts BEGIN
  SELECT RAISE(ABORT, 'mutation receipts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS decided_points_immutable
BEFORE UPDATE ON planning_points
WHEN OLD.disposition <> 'PROPOSED' BEGIN
  SELECT RAISE(ABORT, 'decided planning points are immutable');
END;

CREATE TRIGGER IF NOT EXISTS approved_versions_immutable_update
BEFORE UPDATE ON work_package_versions
WHEN OLD.status = 'READY_FOR_EXECUTION' BEGIN
  SELECT RAISE(ABORT, 'approved work package versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS approved_versions_immutable_delete
BEFORE DELETE ON work_package_versions
WHEN OLD.status = 'READY_FOR_EXECUTION' BEGIN
  SELECT RAISE(ABORT, 'approved work package versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS approved_version_points_immutable_insert
BEFORE INSERT ON work_package_points
WHEN EXISTS (
  SELECT 1 FROM work_package_versions
  WHERE id = NEW.work_package_version_id AND status = 'READY_FOR_EXECUTION'
) BEGIN
  SELECT RAISE(ABORT, 'approved work package point sources are immutable');
END;

CREATE TRIGGER IF NOT EXISTS approved_version_points_immutable_delete
BEFORE DELETE ON work_package_points
WHEN EXISTS (
  SELECT 1 FROM work_package_versions
  WHERE id = OLD.work_package_version_id AND status = 'READY_FOR_EXECUTION'
) BEGIN
  SELECT RAISE(ABORT, 'approved work package point sources are immutable');
END;
