import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { mutation, openDatabase } from '../../server/storage/database.mjs';
import { createFixture } from './test-support.mjs';

const LEGACY_CREATED_AT = '2026-08-14T00:00:02.000Z';

async function createLegacyV2Database(databasePath, {
  includeSource = true,
  decidedByAgent = false,
  emptyDecisionTime = false,
} = {}) {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec('PRAGMA foreign_keys = ON;');
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const first = await readFile(path.resolve('app/migrations/001_planning_loop.sql'), 'utf8');
    const second = await readFile(path.resolve('app/migrations/002_retry_uniqueness.sql'), 'utf8');
    legacy.exec(first);
    legacy.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
      .run(1, '001_planning_loop.sql', '2026-08-14T00:00:00.000Z');
    legacy.exec(second);
    legacy.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
      .run(2, '002_retry_uniqueness.sql', '2026-08-14T00:00:01.000Z');

    legacy.prepare(`
      INSERT INTO participants(id, participant_key, kind, display_name, created_at)
      VALUES ('owner-local', 'owner:local', 'OWNER', 'Owner', ?)
    `).run(LEGACY_CREATED_AT);
    if (decidedByAgent) {
      legacy.prepare(`
        INSERT INTO participants(id, participant_key, kind, display_name, provider, model, created_at)
        VALUES ('legacy-agent', 'agent:legacy', 'AGENT', 'Legacy agent', 'legacy', 'legacy', ?)
      `).run(LEGACY_CREATED_AT);
    }
    legacy.prepare(`
      INSERT INTO projects(id, name, repository_root, created_at)
      VALUES ('project-v2', 'Legacy project', 'C:\\legacy-repository', ?)
    `).run(LEGACY_CREATED_AT);
    legacy.prepare(`
      INSERT INTO discussions(id, project_id, title, created_at, updated_at)
      VALUES ('discussion-v2', 'project-v2', 'Legacy room', ?, ?)
    `).run(LEGACY_CREATED_AT, LEGACY_CREATED_AT);
    legacy.prepare(`
      INSERT INTO messages(id, discussion_id, participant_id, content, contribution_type, created_at)
      VALUES ('message-v2', 'discussion-v2', 'owner-local', 'Legacy source.', 'OWNER', ?)
    `).run(LEGACY_CREATED_AT);
    legacy.prepare(`
      INSERT INTO planning_points(
        id, discussion_id, source_message_id, created_by_participant_id, point_type, text,
        disposition, decided_by_participant_id, decided_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', ?, ?, ?)
    `).run(
      'point-v2',
      'discussion-v2',
      'message-v2',
      'owner-local',
      'REQUIREMENT',
      'Legacy accepted point.',
      decidedByAgent ? 'legacy-agent' : 'owner-local',
      emptyDecisionTime ? '   ' : LEGACY_CREATED_AT,
      LEGACY_CREATED_AT,
    );
    legacy.prepare(`
      INSERT INTO work_packages(id, discussion_id, created_at)
      VALUES ('package-v2', 'discussion-v2', ?)
    `).run(LEGACY_CREATED_AT);
    legacy.prepare(`
      INSERT INTO work_package_versions(
        id, work_package_id, version_number, status, content_json, created_at, updated_at
      ) VALUES ('version-v2', 'package-v2', 1, 'DRAFT', ?, ?, ?)
    `).run(JSON.stringify({
      outcome: 'Preserve the legacy authority record.',
      includedScope: ['Legacy accepted point.'],
      exclusions: ['No execution.'],
      acceptanceCriteria: ['The source lineage survives migration.'],
      reviewRequirements: ['Independent review.'],
      evidenceRequirements: ['Migration test.'],
    }), LEGACY_CREATED_AT, LEGACY_CREATED_AT);
    if (includeSource) {
      legacy.prepare(`
        INSERT INTO work_package_points(work_package_version_id, planning_point_id)
        VALUES ('version-v2', 'point-v2')
      `).run();
    }
    legacy.prepare(`
      UPDATE work_package_versions
      SET status = 'READY_FOR_EXECUTION', approved_at = ?, row_version = 2
      WHERE id = 'version-v2'
    `).run(LEGACY_CREATED_AT);
    legacy.prepare(`
      INSERT INTO approval_events(
        id, work_package_version_id, owner_participant_id, authorization_scope, occurred_at
      ) VALUES ('approval-v2', 'version-v2', 'owner-local', 'Legacy approval.', ?)
    `).run(LEGACY_CREATED_AT);
    legacy.prepare(`
      INSERT INTO mutation_receipts(idempotency_key, operation, resource_id, response_json, created_at)
      VALUES ('legacy-key', 'message.create', 'message-v2', '{"id":"message-v2"}', ?)
    `).run(LEGACY_CREATED_AT);
  } finally {
    legacy.close();
  }
}

test('migrations 003 through 005 upgrade existing authority records without losing lineage', async t => {
  const fixture = await createFixture(t);
  const databasePath = path.join(fixture.root, 'legacy', 'andamento-v2.db');
  await createLegacyV2Database(databasePath);

  const upgraded = await openDatabase(databasePath);
  try {
    assert.equal(Number(upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version), 7);
    assert.deepEqual({ ...upgraded.prepare(`
      SELECT work_package_version_id AS versionId, planning_point_id AS pointId
      FROM approved_package_point_snapshots
    `).get() }, { versionId: 'version-v2', pointId: 'point-v2' });
    assert.deepEqual({ ...upgraded.prepare(`
      SELECT snapshots.planning_point_id AS pointId, snapshots.text,
             points.decided_by_participant_id AS decidedBy
      FROM planning_point_identity_snapshots snapshots
      JOIN planning_points points ON points.id = snapshots.planning_point_id
    `).get() }, {
      pointId: 'point-v2',
      text: 'Legacy accepted point.',
      decidedBy: 'owner-local',
    });
    assert.deepEqual({ ...upgraded.prepare(`
      SELECT planning_point_id AS pointId, disposition,
             decided_by_participant_id AS decidedBy, decided_at AS decidedAt
      FROM planning_point_decision_snapshots
    `).get() }, {
      pointId: 'point-v2',
      disposition: 'ACCEPTED',
      decidedBy: 'owner-local',
      decidedAt: LEGACY_CREATED_AT,
    });
    assert.throws(() => upgraded.prepare(`
      UPDATE planning_point_decision_snapshots SET disposition = 'REJECTED'
      WHERE planning_point_id = 'point-v2'
    `).run(), /append-only/);
    assert.equal(Number(upgraded.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_approved_package_point_snapshots_point'
    `).get().count), 1);
    assert.equal(Number(upgraded.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_agent_runs_cleanup_quarantine'
    `).get().count), 1);
    assert.equal(upgraded.prepare(`
      SELECT request_fingerprint AS fingerprint FROM mutation_receipts WHERE idempotency_key = 'legacy-key'
    `).get().fingerprint, 'LEGACY_UNBOUND');
    assert.throws(() => upgraded.prepare(`
      UPDATE work_package_points SET work_package_version_id = 'other-version'
      WHERE work_package_version_id = 'version-v2' AND planning_point_id = 'point-v2'
    `).run(), /immutable/);
    assert.throws(() => mutation(upgraded, {
      idempotencyKey: 'legacy-key',
      operation: 'message.create',
      request: { discussionId: 'discussion-v2', content: 'Legacy source.' },
    }, () => ({ id: 'should-not-run' })), error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'CONFLICT');
      assert.match(error.message, /different request/);
      return true;
    });
    assert.equal(upgraded.prepare(`
      SELECT content FROM messages WHERE id = 'message-v2'
    `).get().content, 'Legacy source.');
  } finally {
    upgraded.close();
  }
});

test('migration 003 refuses an approved v2 package with no source lineage', async t => {
  const fixture = await createFixture(t);
  const databasePath = path.join(fixture.root, 'invalid-legacy', 'andamento-v2.db');
  await createLegacyV2Database(databasePath, { includeSource: false });

  await assert.rejects(openDatabase(databasePath), error => {
    assert.match(error.message, /approved_versions_require_source_lineage/);
    return true;
  });

  const unchanged = new DatabaseSync(databasePath);
  try {
    assert.equal(Number(unchanged.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version), 2);
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM work_package_points WHERE work_package_version_id = 'version-v2'
    `).get().count), 0);
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM approval_events WHERE work_package_version_id = 'version-v2'
    `).get().count), 1);
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'approved_package_point_snapshots'
    `).get().count), 0);
    assert.equal(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM pragma_table_info('mutation_receipts')
      WHERE name = 'request_fingerprint'
    `).get().count, 0);
  } finally {
    unchanged.close();
  }
});

test('migration 004 refuses legacy planning-point decisions without owner authority', async t => {
  const fixture = await createFixture(t);
  const databasePath = path.join(fixture.root, 'invalid-point-authority', 'andamento-v2.db');
  await createLegacyV2Database(databasePath, { decidedByAgent: true });

  await assert.rejects(openDatabase(databasePath), error => {
    assert.match(error.message, /decided_points_require_owner_authority/);
    return true;
  });

  const unchanged = new DatabaseSync(databasePath);
  try {
    assert.equal(Number(unchanged.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version), 3);
    assert.equal(unchanged.prepare(`
      SELECT decided_by_participant_id AS decidedBy FROM planning_points WHERE id = 'point-v2'
    `).get().decidedBy, 'legacy-agent');
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'planning_point_identity_snapshots'
    `).get().count), 0);
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'planning_point_decision_snapshots'
    `).get().count), 0);
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM approved_package_point_snapshots
      WHERE work_package_version_id = 'version-v2'
    `).get().count), 1);
  } finally {
    unchanged.close();
  }
});

test('migration 004 refuses legacy decisions with empty decision time', async t => {
  const fixture = await createFixture(t);
  const databasePath = path.join(fixture.root, 'invalid-decision-time', 'andamento-v2.db');
  await createLegacyV2Database(databasePath, { emptyDecisionTime: true });

  await assert.rejects(openDatabase(databasePath), error => {
    assert.match(error.message, /decided_points_require_owner_authority/);
    return true;
  });

  const unchanged = new DatabaseSync(databasePath);
  try {
    assert.equal(Number(unchanged.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version), 3);
    assert.equal(unchanged.prepare(`
      SELECT decided_at AS decidedAt FROM planning_points WHERE id = 'point-v2'
    `).get().decidedAt, '   ');
    assert.equal(Number(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'planning_point_decision_snapshots'
    `).get().count), 0);
  } finally {
    unchanged.close();
  }
});
