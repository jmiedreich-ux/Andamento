-- Unsent planning input survives a full page reload and a service restart.
--
-- The owner decided this on 2026-08-15. It is held by the service in SQLite
-- rather than in browser storage: SQLite is already the authoritative store,
-- and a durable record survives a reload, a restart, and a different browser
-- window, which browser storage would not.
--
-- A draft is undurable working text, never an authority record. It carries no
-- disposition, no approval, and no lineage; it is deleted the moment its
-- mutation confirms.

CREATE TABLE IF NOT EXISTS input_drafts (
  slot TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  discussion_id TEXT NOT NULL DEFAULT '',
  owner_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  updated_at TEXT NOT NULL
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_input_drafts_route
  ON input_drafts(project_id, discussion_id, updated_at DESC);

-- Only the owner holds working input, matching every other authority boundary.
CREATE TRIGGER IF NOT EXISTS input_drafts_require_owner
BEFORE INSERT ON input_drafts
WHEN NOT EXISTS (
  SELECT 1 FROM participants
  WHERE id = NEW.owner_participant_id AND kind = 'OWNER'
)
BEGIN
  SELECT RAISE(ABORT, 'input drafts belong to the owner');
END;

-- A draft never changes which route it belongs to; a different route is a
-- different draft.
CREATE TRIGGER IF NOT EXISTS input_drafts_route_immutable
BEFORE UPDATE ON input_drafts
WHEN NEW.project_id <> OLD.project_id OR NEW.discussion_id <> OLD.discussion_id
BEGIN
  SELECT RAISE(ABORT, 'an input draft cannot move between routes');
END;
