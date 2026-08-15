import { createApplication } from './application.mjs';

// Load ANTHROPIC_API_KEY and other local settings from .env when present.
// .env is gitignored; the file is optional and a missing one is not an error.
try {
  process.loadEnvFile();
} catch {
  // No .env file on this machine; environment variables still apply.
}

const application = await createApplication();
const address = await application.start();
console.log(`Andamento is ready at ${address.url}`);

let closing = false;
async function close(signal) {
  if (closing) return;
  closing = true;
  console.log(`Andamento received ${signal}; closing local service.`);
  await application.close();
  process.exit(0);
}

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));
