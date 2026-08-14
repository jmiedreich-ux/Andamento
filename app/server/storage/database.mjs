import { randomUUID } from 'node:crypto';
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

export async function openDatabase(databasePath) {
  if (databasePath !== ':memory:') await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
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
      database.close();
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

  database.prepare(`
    UPDATE agent_runs
    SET status = 'INTERRUPTED',
        error_code = 'SERVICE_RESTARTED',
        error_message = 'The local service restarted before this contribution completed. Retry is available.',
        completed_at = ?,
        row_version = row_version + 1
    WHERE status = 'RUNNING'
  `).run(utcNow());

  return database;
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

export function mutation(database, { idempotencyKey, operation }, callback) {
  const key = requiredIdempotencyKey(idempotencyKey);
  return transaction(database, () => {
    const receipt = database.prepare(`
      SELECT operation, response_json AS responseJson
      FROM mutation_receipts
      WHERE idempotency_key = ?
    `).get(key);
    if (receipt) {
      if (receipt.operation !== operation) {
        throw conflict('That idempotency key was already used for a different operation.');
      }
      return { value: JSON.parse(receipt.responseJson), replayed: true };
    }

    const value = callback();
    const resourceId = String(value?.id || value?.resourceId || 'none');
    database.prepare(`
      INSERT INTO mutation_receipts(idempotency_key, operation, resource_id, response_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(key, operation, resourceId, JSON.stringify(value), utcNow());
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
