import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createApplication } from '../../server/application.mjs';

const databasePath = path.resolve(
  process.env.ANDAMENTO_E2E_DATABASE_PATH || path.join('var', 'e2e-planning-loop.db'),
);
const varDirectory = path.resolve('var');
const relativeDatabasePath = path.relative(varDirectory, databasePath);
const safeDatabaseName = path.basename(databasePath).startsWith('e2e-');

if (
  !safeDatabaseName
  || relativeDatabasePath.startsWith('..')
  || path.isAbsolute(relativeDatabasePath)
) {
  throw new Error(`Refusing to use an unsafe end-to-end database path: ${databasePath}`);
}

await mkdir(path.dirname(databasePath), { recursive: true });
if (process.env.ANDAMENTO_E2E_RESET === '1') {
  for (const suffix of ['', '-shm', '-wal']) {
    await rm(`${databasePath}${suffix}`, { force: true });
  }
}

const application = await createApplication({
  databasePath,
  host: process.env.ANDAMENTO_HOST || '127.0.0.1',
  port: Number(process.env.ANDAMENTO_PORT || 47841),
  testMode: true,
  enableDeterministic: true,
  codexUrl: process.env.ANDAMENTO_CODEX_URL || 'ws://127.0.0.1:1',
});
const address = await application.start();
console.log(`Andamento E2E service is ready at ${address.url}`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await application.close();
  process.exit(0);
}

process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
