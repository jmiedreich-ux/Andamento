import assert from 'node:assert/strict';
import http from 'node:http';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createApplication } from '../../server/application.mjs';
import {
  createFixture,
  createProjectAndDiscussion,
  idempotencyKey,
} from './test-support.mjs';

function rawRequest(base, { method = 'GET', pathname = '/', headers = {}, body = '' } = {}) {
  const target = new URL(base);
  const payload = Buffer.from(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      method,
      path: pathname,
      headers: {
        ...(payload.length ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : {},
        });
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

test('confines implicit owner authority to trusted same-origin JSON requests on loopback', async t => {
  const fixture = await createFixture(t);
  const address = await fixture.application.start();
  const allowedRepository = await fixture.makeRepository('allowed-http-repository');
  const hostileRepository = await fixture.makeRepository('hostile-http-repository');
  const allowedBody = JSON.stringify({
    name: 'Allowed local project',
    repositoryRoot: allowedRepository,
    idempotencyKey: idempotencyKey('allowed-http-project'),
  });
  const allowed = await rawRequest(address.url, {
    method: 'POST',
    pathname: '/api/projects',
    headers: { 'Content-Type': 'application/json' },
    body: allowedBody,
  });
  assert.equal(allowed.status, 201);

  const hostileBody = JSON.stringify({
    name: 'Hostile project',
    repositoryRoot: hostileRepository,
    idempotencyKey: idempotencyKey('hostile-http-project'),
  });
  const crossOriginSimpleWrite = await rawRequest(address.url, {
    method: 'POST',
    pathname: '/api/projects',
    headers: {
      Origin: 'https://attacker.example',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Sec-Fetch-Site': 'cross-site',
    },
    body: hostileBody,
  });
  assert.equal(crossOriginSimpleWrite.status, 403);
  assert.equal(crossOriginSimpleWrite.body.error.code, 'UNTRUSTED_ORIGIN');

  const nonJsonSameOrigin = await rawRequest(address.url, {
    method: 'POST',
    pathname: '/api/projects',
    headers: { Origin: address.url, 'Content-Type': 'text/plain' },
    body: hostileBody,
  });
  assert.equal(nonJsonSameOrigin.status, 415);
  assert.equal(nonJsonSameOrigin.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');

  const crossOriginJson = await rawRequest(address.url, {
    method: 'POST',
    pathname: '/api/projects',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: hostileBody,
  });
  assert.equal(crossOriginJson.status, 403);

  const reboundRead = await rawRequest(address.url, {
    pathname: '/api/bootstrap',
    headers: { Host: 'attacker.example' },
  });
  assert.equal(reboundRead.status, 421);
  assert.equal(reboundRead.body.error.code, 'UNTRUSTED_HOST');
  assert.equal(reboundRead.headers['x-frame-options'], 'DENY');
  assert.equal(fixture.service.listProjects().length, 1);

  const remoteDatabase = path.join(fixture.root, 'remote-binding', 'remote.db');
  await assert.rejects(
    createApplication({ databasePath: remoteDatabase, host: '0.0.0.0', port: 0 }),
    error => {
      assert.equal(error.code, 'REMOTE_BINDING_REQUIRES_AUTH');
      assert.match(error.message, /real authentication|loopback/);
      return true;
    },
  );
  await assert.rejects(access(remoteDatabase));
});

test('serves the health endpoint on the supported IPv6 loopback address', async t => {
  const fixture = await createFixture(t, { host: '::1' });
  const address = await fixture.application.start();
  assert.match(address.url, /^http:\/\/\[::1\]:\d+$/);

  const response = await fetch(`${address.url}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('exclusive database ownership makes overlapping startup harmless to live runs', async t => {
  const fixture = await createFixture(t);
  const address = await fixture.application.start();
  const { discussion } = await createProjectAndDiscussion(fixture, {
    repositoryDirectory: 'single-owner-repository',
    projectName: 'Single owner project',
    discussionTitle: 'Live run ownership',
  });
  const liveRun = fixture.service.startAgentRun(discussion.id, {
    adapter: 'deterministic',
    prompt: '[slow] Remain owned by the first service.',
    idempotencyKey: idempotencyKey('live-owner-run'),
  }).run;

  await assert.rejects(
    createApplication({
      databasePath: fixture.databasePath,
      host: '127.0.0.1',
      port: address.port,
      testMode: true,
      enableDeterministic: true,
      databaseBusyTimeoutMs: 50,
    }),
    error => {
      assert.equal(error.code, 'DATABASE_IN_USE');
      assert.match(error.message, /already owned/);
      return true;
    },
  );

  const afterOverlap = fixture.service.getDiscussion(discussion.id).runs.find(run => run.id === liveRun.id);
  assert.equal(afterOverlap.status, 'RUNNING');
  const cancelled = fixture.service.cancelAgentRun(liveRun.id, {
    idempotencyKey: idempotencyKey('cancel-live-owner-run'),
  }).run;
  assert.equal(cancelled.status, 'INTERRUPTED');
  assert.equal(cancelled.errorCode, 'CANCELLED');
  fixture.service.verifyInvariants();
});
