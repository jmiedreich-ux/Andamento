-- Agent-proposed planning points.
--
-- A suggestion is a candidate, not a planning point. It carries no
-- disposition, no lineage into a package, and no authority of any kind. It
-- becomes a planning point only when the owner captures it, through the same
-- capture path as text the owner typed, and the resulting point starts
-- PROPOSED like every other.

CREATE TABLE IF NOT EXISTS point_suggestions (
  id TEXT PRIMARY KEY,
  source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  point_type TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CAPTURED', 'DISMISSED')),
  captured_point_id TEXT REFERENCES planning_points(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  resolved_at TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX IF NOT EXISTS idx_point_suggestions_message
  ON point_suggestions(source_message_id, created_at);

-- A suggestion that claims to have become a point must name that point, and a
-- suggestion that has not been captured must not name one.
CREATE TRIGGER IF NOT EXISTS point_suggestions_capture_is_explicit
BEFORE UPDATE ON point_suggestions
WHEN (NEW.status = 'CAPTURED' AND NEW.captured_point_id IS NULL)
  OR (NEW.status <> 'CAPTURED' AND NEW.captured_point_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'only a captured suggestion may name a planning point');
END;

-- Resolution is one-way: a suggestion the owner already acted on cannot be
-- reopened or re-pointed at a different planning point.
CREATE TRIGGER IF NOT EXISTS point_suggestions_resolution_final
BEFORE UPDATE ON point_suggestions
WHEN OLD.status <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'a resolved suggestion is final');
END;

-- The suggested text is what the agent actually proposed; it is evidence, not
-- an editable draft.
CREATE TRIGGER IF NOT EXISTS point_suggestions_text_immutable
BEFORE UPDATE ON point_suggestions
WHEN NEW.text <> OLD.text
  OR NEW.point_type <> OLD.point_type
  OR NEW.source_message_id <> OLD.source_message_id
  OR NEW.participant_id <> OLD.participant_id
BEGIN
  SELECT RAISE(ABORT, 'a recorded suggestion is immutable');
END;
