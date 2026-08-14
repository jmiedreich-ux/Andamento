import { createApplication } from './application.mjs';

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
