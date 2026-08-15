import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { conflict } from '../domain/errors.mjs';
import { requiredIdempotencyKey } from '../domain/validation.mjs';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations/', import.meta.url));

function utcNow() {
  return new Date().toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function fingerprintRequest(operation, request) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson({ operation, request })))
    .digest('hex');
}

export async function openDatabase(databasePath, { busyTimeoutMs = 5000 } = {}) {
  if (databasePath !== ':memory:') await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.min(Number(busyTimeoutMs) || 0, 30000))};`);
    database.exec('PRAGMA locking_mode = EXCLUSIVE;');
    if (databasePath !== ':memory:') database.exec('PRAGMA journal_mode = WAL;');
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);

    const migrationFiles = (await readdir(MIGRATIONS_DIRECTORY))
      .filter(file => /^\d{3}_.+\.sql$/.test(file))
      .sort();

    for (const file of migrationFiles) {
      const version = Number(file.slice(0, 3));
      const existing = database.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
      if (existing) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, file), 'utf8');
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.exec(sql);
        database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
          .run(version, file, utcNow());
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }
    }

    const owner = {
      id: 'owner-local',
      participantKey: 'owner:local',
      kind: 'OWNER',
      displayName: 'Owner',
      provider: null,
      model: null,
    };
    database.prepare(`
      INSERT INTO participants(id, participant_key, kind, display_name, provider, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(participant_key) DO NOTHING
    `).run(owner.id, owner.participantKey, owner.kind, owner.displayName, owner.provider, owner.model, utcNow());

    const selectInterruptedRuns = database.prepare(`
      SELECT id, adapter FROM agent_runs
      WHERE status = 'RUNNING'
         OR (
           adapter = 'codex'
           AND status = 'INTERRUPTED'
           AND error_code = 'CODEX_CLEANUP_PENDING'
         )
      ORDER BY started_at, id
    `);
    database.exec('BEGIN IMMEDIATE;');
    try {
      const interruptedRuns = selectInterruptedRuns.all();
      const completedAt = utcNow();
      const updateRun = database.prepare(`
        UPDATE agent_runs
        SET status = 'INTERRUPTED', error_code = ?, error_message = ?,
            completed_at = ?, row_version = row_version + 1
        WHERE id = ?
          AND (
            status = 'RUNNING'
            OR (
              adapter = 'codex'
              AND status = 'INTERRUPTED'
              AND error_code = 'CODEX_CLEANUP_PENDING'
            )
          )
      `);
      const insertAudit = database.prepare(`
        INSERT INTO audit_events(
          id, event_type, resource_type, resource_id, actor_participant_id, details_json, occurred_at
        ) VALUES (?, ?, 'AGENT_RUN', ?, NULL, ?, ?)
      `);
      for (const run of interruptedRuns) {
        const cleanupUnconfirmed = run.adapter === 'codex';
        const errorCode = cleanupUnconfirmed ? 'CODEX_CLEANUP_UNCONFIRMED' : 'SERVICE_RESTARTED';
        const errorMessage = cleanupUnconfirmed
          ? 'Andamento could not confirm that the Codex contribution stopped. Further Codex work in this planning room is blocked to prevent overlapping turns.'
          : 'The local service restarted before this contribution completed. Retry is available.';
        const update = updateRun.run(errorCode, errorMessage, completedAt, run.id);
        if (Number(update.changes) === 1) {
          insertAudit.run(
            randomUUID(),
            cleanupUnconfirmed ? 'AGENT_CLEANUP_UNCONFIRMED' : 'AGENT_RUN_INTERRUPTED',
            run.id,
            JSON.stringify({ reason: errorCode }),
            completedAt,
          );
        }
      }
      // An execution that was in flight when the process stopped produced no
      // change set, so it can only be reported as interrupted.
      const interruptedExecutions = database.prepare(`
        SELECT id FROM execution_runs WHERE status = 'RUNNING' ORDER BY started_at, id
      `).all();
      const updateExecution = database.prepare(`
        UPDATE execution_runs
        SET status = 'INTERRUPTED', error_code = 'SERVICE_RESTARTED',
            error_message = 'The local service restarted before this execution completed. Dispatch again to retry.',
            completed_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'RUNNING'
      `);
      const insertExecutionAudit = database.prepare(`
        INSERT INTO audit_events(
          id, event_type, resource_type, resource_id, actor_participant_id, details_json, occurred_at
        ) VALUES (?, 'EXECUTION_RUN_INTERRUPTED', 'EXECUTION_RUN', ?, NULL, ?, ?)
      `);
      for (const run of interruptedExecutions) {
        if (Number(updateExecution.run(completedAt, run.id).changes) === 1) {
          insertExecutionAudit.run(
            randomUUID(), run.id, JSON.stringify({ reason: 'SERVICE_RESTARTED' }), completedAt,
          );
        }
      }
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }

    return database;
  } catch (error) {
    try { database.close(); } catch {}
    if (String(error?.message || '').toLowerCase().includes('database is locked')) {
      const inUse = new Error('The Andamento database is already owned by another local service.');
      inUse.code = 'DATABASE_IN_USE';
      throw inUse;
    }
    throw error;
  }
}

export function transaction(database, callback) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const value = callback();
    database.exec('COMMIT;');
    return value;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

export function mutation(database, { idempotencyKey, operation, request }, callback) {
  const key = requiredIdempotencyKey(idempotencyKey);
  const requestFingerprint = fingerprintRequest(operation, request);
  return transaction(database, () => {
    const receipt = database.prepare(`
      SELECT operation, request_fingerprint AS requestFingerprint, response_json AS responseJson
      FROM mutation_receipts
      WHERE idempotency_key = ?
    `).get(key);
    if (receipt) {
      if (receipt.operation !== operation || receipt.requestFingerprint !== requestFingerprint) {
        throw conflict('That idempotency key was already used for a different request.');
      }
      return { value: JSON.parse(receipt.responseJson), replayed: true };
    }

    const value = callback();
    const resourceId = String(value?.id || value?.resourceId || 'none');
    database.prepare(`
      INSERT INTO mutation_receipts(
        idempotency_key, operation, resource_id, response_json, created_at, request_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(key, operation, resourceId, JSON.stringify(value), utcNow(), requestFingerprint);
    return { value, replayed: false };
  });
}

export function appendAudit(database, { eventType, resourceType, resourceId, actorId = null, details = {} }) {
  database.prepare(`
    INSERT INTO audit_events(id, event_type, resource_type, resource_id, actor_participant_id, details_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), eventType, resourceType, resourceId, actorId, JSON.stringify(details), utcNow());
}

export function now() {
  return utcNow();
}
