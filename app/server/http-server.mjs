import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, normalizeError } from './domain/errors.mjs';

const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.json', 'application/json; charset=utf-8'],
]);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  securityHeaders(response);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(body);
}

function formattedHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

function trustedAuthority(server, host, configuredPort) {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : configuredPort;
  const hostname = formattedHost(host);
  return port === 80 ? [hostname, `${hostname}:80`] : [`${hostname}:${port}`];
}

function enforceLocalRequestBoundary(server, host, port, request, url) {
  const receivedAuthority = String(request.headers.host || '').trim().toLowerCase();
  const authorities = trustedAuthority(server, host, port);
  if (!receivedAuthority || !authorities.includes(receivedAuthority)) {
    throw new AppError(421, 'UNTRUSTED_HOST', 'The request host is not trusted by this local service.');
  }
  if (!url.pathname.startsWith('/api/')) return;

  const origin = request.headers.origin;
  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(String(origin));
    } catch {
      throw new AppError(403, 'UNTRUSTED_ORIGIN', 'Cross-origin API requests are not allowed.');
    }
    if (parsedOrigin.protocol !== 'http:' || parsedOrigin.host.toLowerCase() !== receivedAuthority) {
      throw new AppError(403, 'UNTRUSTED_ORIGIN', 'Cross-origin API requests are not allowed.');
    }
  }

  const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    throw new AppError(403, 'UNTRUSTED_ORIGIN', 'Cross-origin API requests are not allowed.');
  }

  if (MUTATION_METHODS.has(request.method || '')) {
    const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'API mutations require application/json.');
    }
  }
}

async function readJsonBody(request, { limit = 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.groups || {} : null;
}

function actorFor(service, request) {
  return service.resolveActor(request.headers['x-andamento-actor-id']);
}

async function routeApi(service, request, response, url) {
  const { pathname } = url;
  let params;

  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', service: 'andamento', storage: 'sqlite' });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    sendJson(response, 200, await service.bootstrap());
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/projects') {
    sendJson(response, 201, await service.createProject(await readJsonBody(request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/discussions$/);
  if (params && request.method === 'GET') {
    sendJson(response, 200, { discussions: service.listDiscussions(params.projectId) });
    return true;
  }
  if (params && request.method === 'POST') {
    sendJson(response, 201, service.createDiscussion(params.projectId, await readJsonBody(request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/discussions\/(?<discussionId>[^/]+)$/);
  if (params && request.method === 'GET') {
    sendJson(response, 200, service.getDiscussion(params.discussionId));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/discussions\/(?<discussionId>[^/]+)\/messages$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    sendJson(response, 201, service.addMessage(params.discussionId, input, actorFor(service, request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/discussions\/(?<discussionId>[^/]+)\/agent-runs$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    sendJson(response, 202, service.startAgentRun(params.discussionId, input, actorFor(service, request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/agent-runs\/(?<runId>[^/]+)\/(?<action>retry|cancel)$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    const result = params.action === 'retry'
      ? service.retryAgentRun(params.runId, input, actorFor(service, request))
      : service.cancelAgentRun(params.runId, input, actorFor(service, request));
    sendJson(response, params.action === 'retry' ? 202 : 200, result);
    return true;
  }
  params = routeMatch(pathname, /^\/api\/messages\/(?<messageId>[^/]+)\/planning-points$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    sendJson(response, 201, service.capturePoint(params.messageId, input, actorFor(service, request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/planning-points\/(?<pointId>[^/]+)\/(?<action>replacement|disposition)$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    const result = params.action === 'replacement'
      ? service.replacePoint(params.pointId, input, actorFor(service, request))
      : service.dispositionPoint(params.pointId, input, actorFor(service, request));
    sendJson(response, params.action === 'replacement' ? 201 : 200, result);
    return true;
  }
  params = routeMatch(pathname, /^\/api\/discussions\/(?<discussionId>[^/]+)\/work-package$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    sendJson(response, 201, service.preparePackage(params.discussionId, input, actorFor(service, request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/work-package-versions\/(?<versionId>[^/]+)$/);
  if (params && request.method === 'PUT') {
    const input = await readJsonBody(request);
    sendJson(response, 200, service.updatePackageVersion(params.versionId, input, actorFor(service, request)));
    return true;
  }
  params = routeMatch(pathname, /^\/api\/work-package-versions\/(?<versionId>[^/]+)\/(?<action>approve|next-version)$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    const result = params.action === 'approve'
      ? service.approvePackageVersion(params.versionId, input, actorFor(service, request))
      : service.createNextPackageVersion(params.versionId, input, actorFor(service, request));
    sendJson(response, params.action === 'next-version' ? 201 : 200, result);
    return true;
  }
  params = routeMatch(pathname, /^\/api\/work-package-versions\/(?<versionId>[^/]+)\/execution-runs$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    const run = await service.dispatchExecution(params.versionId, input, actorFor(service, request));
    sendJson(response, 201, { run });
    return true;
  }
  params = routeMatch(pathname, /^\/api\/execution-runs\/(?<runId>[^/]+)\/(?<action>cancel|revert)$/);
  if (params && request.method === 'POST') {
    const input = await readJsonBody(request);
    const run = params.action === 'cancel'
      ? service.cancelExecution(params.runId, input, actorFor(service, request))
      : await service.revertExecution(params.runId, input, actorFor(service, request));
    sendJson(response, 200, { run });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/invariants') {
    sendJson(response, 200, service.verifyInvariants());
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/test/participants' && service.testMode) {
    sendJson(response, 201, { participant: service.createTestParticipant(await readJsonBody(request)) });
    return true;
  }
  return false;
}

async function serveStatic(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let requestedPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (!requestedPath || requestedPath.includes('\0')) return false;
  const absolutePath = path.resolve(PUBLIC_DIRECTORY, requestedPath);
  const relative = path.relative(PUBLIC_DIRECTORY, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const contentType = MIME_TYPES.get(path.extname(absolutePath).toLowerCase()) || 'application/octet-stream';
  securityHeaders(response);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': info.size,
    'Cache-Control': requestedPath === 'index.html' ? 'no-store' : 'public, max-age=300',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(absolutePath).pipe(response);
  return true;
}

export function createHttpServer({ service, host = '127.0.0.1', port = 47831 }) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${formattedHost(host)}:${port}`);
      enforceLocalRequestBoundary(server, host, port, request, url);
      if (url.pathname.startsWith('/api/')) {
        const handled = await routeApi(service, request, response, url);
        if (!handled) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'API route not found.' } });
        return;
      }
      if (await serveStatic(request, response, url)) return;
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Page not found.' } });
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(response, normalized.status || 500, {
        error: {
          code: normalized.code || 'INTERNAL_ERROR',
          message: normalized.message,
          ...(normalized.details === undefined ? {} : { details: normalized.details }),
        },
      });
    }
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      return { host, port: resolvedPort, url: `http://${formattedHost(host)}:${resolvedPort}` };
    },
    async close() {
      if (server.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
      await service.shutdown();
    },
  };
}
