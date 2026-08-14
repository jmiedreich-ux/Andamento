import path from 'node:path';
import { createAgentRegistry } from './agents/registry.mjs';
import { createHttpServer } from './http-server.mjs';
import { PlanningService } from './planning-service.mjs';
import { openDatabase } from './storage/database.mjs';

export async function createApplication(options = {}) {
  const databasePath = options.databasePath || process.env.ANDAMENTO_DATABASE_PATH || path.resolve('var', 'andamento.db');
  const host = options.host || process.env.ANDAMENTO_HOST || '127.0.0.1';
  const parsedPort = options.port ?? Number(process.env.ANDAMENTO_PORT || 47831);
  const port = Number.isSafeInteger(parsedPort) && parsedPort >= 0 ? parsedPort : 47831;
  const testMode = options.testMode ?? process.env.ANDAMENTO_TEST_MODE === '1';
  const enableDeterministic = options.enableDeterministic ?? (testMode || process.env.ANDAMENTO_ENABLE_TEST_ADAPTER === '1');
  const codexUrl = options.codexUrl || process.env.ANDAMENTO_CODEX_URL || 'ws://127.0.0.1:47823';

  const database = await openDatabase(databasePath);
  const agents = options.agents || createAgentRegistry({ codexUrl, enableDeterministic });
  const service = new PlanningService({ database, agents, testMode });
  const httpServer = createHttpServer({ service, host, port });

  return {
    database,
    service,
    async start() {
      return httpServer.listen();
    },
    async close() {
      await httpServer.close();
      database.close();
    },
  };
}
