import path from 'node:path';
import { createAgentRegistry } from './agents/registry.mjs';
import { createHttpServer } from './http-server.mjs';
import { PlanningService } from './planning-service.mjs';
import { openDatabase } from './storage/database.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function localHost(input) {
  const host = String(input || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    const error = new Error('Remote binding is unavailable until Andamento has real authentication. Use a loopback host.');
    error.code = 'REMOTE_BINDING_REQUIRES_AUTH';
    throw error;
  }
  return host;
}

function localProviderUrl(input) {
  const value = String(input || '').trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const error = new Error('The provider bridge URL is not a valid URL.');
    error.code = 'INVALID_PROVIDER_URL';
    throw error;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['ws:', 'wss:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(host)) {
    const error = new Error('The provider bridge must be a loopback ws:// or wss:// URL. Andamento does not send planning content off this machine.');
    error.code = 'REMOTE_PROVIDER_REQUIRES_APPROVAL';
    throw error;
  }
  return value;
}

function localPort(input) {
  const port = Number(input);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    const error = new Error('The configured port is not a valid TCP port.');
    error.code = 'INVALID_PORT';
    throw error;
  }
  return port;
}

export async function createApplication(options = {}) {
  const databasePath = options.databasePath || process.env.ANDAMENTO_DATABASE_PATH || path.resolve('var', 'andamento.db');
  const host = localHost(options.host || process.env.ANDAMENTO_HOST || '127.0.0.1');
  const port = localPort(options.port ?? process.env.ANDAMENTO_PORT ?? 47831);
  const testMode = options.testMode ?? process.env.ANDAMENTO_TEST_MODE === '1';
  const enableDeterministic = options.enableDeterministic ?? (testMode || process.env.ANDAMENTO_ENABLE_TEST_ADAPTER === '1');
  const codexUrl = localProviderUrl(options.codexUrl || process.env.ANDAMENTO_CODEX_URL || 'ws://127.0.0.1:47823');

  const database = await openDatabase(databasePath, { busyTimeoutMs: options.databaseBusyTimeoutMs });
  const agents = options.agents || createAgentRegistry({ codexUrl, enableDeterministic });
  const service = new PlanningService({ database, agents, testMode });
  const httpServer = createHttpServer({ service, host, port });

  let closed = false;
  let address = null;
  return {
    database,
    service,
    async start() {
      if (closed) throw new Error('The Andamento application is closed.');
      if (address) return address;
      try {
        address = await httpServer.listen();
        return address;
      } catch (error) {
        await httpServer.close().catch(() => {});
        database.close();
        closed = true;
        throw error;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await httpServer.close();
      } finally {
        database.close();
      }
    },
  };
}
