import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexPlanningAgent } from '../../server/agents/codex.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function defaultResponse(method) {
  if (method === 'initialize' || method === 'thread/name/set' || method === 'turn/interrupt') return {};
  if (method === 'thread/resume') return { thread: { id: 'thread-existing' } };
  if (method === 'thread/start') return { thread: { id: 'thread-123' } };
  if (method === 'turn/start') return { turn: { id: 'turn-456' } };
  throw new Error(`Unexpected protocol method in test: ${method}`);
}

class ProtocolConnection {
  constructor(onRequest = (method) => defaultResponse(method)) {
    this.onRequest = onRequest;
    this.calls = [];
    this.listeners = new Set();
  }

  async open() {
    this.calls.push({ kind: 'open' });
  }

  send(message) {
    this.calls.push({ kind: 'send', message });
  }

  request(method, params, options) {
    this.calls.push({ kind: 'request', method, params, options });
    return this.onRequest(method, params, options);
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message) {
    for (const listener of this.listeners) listener(message);
  }

  close() {
    this.calls.push({ kind: 'close' });
  }
}

function createAgent(connection, options = {}) {
  return new CodexPlanningAgent({
    url: 'ws://andamento.test',
    connectionFactory: () => connection,
    contributionTimeoutMs: 1000,
    interruptTimeoutMs: 100,
    ...options,
  });
}

function contribution(agent, signal, overrides = {}) {
  return agent.contribute({
    prompt: 'Challenge the planning assumptions.',
    repositoryRoot: '/repo',
    onThread: async () => {},
    signal,
    ...overrides,
  });
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(1);
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

function promptly(promise, timeoutMs = 250) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Cancellation did not settle promptly.')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function requestMethods(connection) {
  return connection.calls.filter(call => call.kind === 'request').map(call => call.method);
}

function cancelled(error) {
  assert.equal(error.code, 'CANCELLED');
  assert.equal(error.message, 'The Codex contribution was cancelled.');
  return true;
}

test('early cancellation is prompt and never reaches turn/start', { timeout: 3000 }, async t => {
  await t.test('before opening the connection', async () => {
    const connection = new ProtocolConnection();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(promptly(contribution(createAgent(connection), controller.signal)), cancelled);
    assert.deepEqual(requestMethods(connection), []);
    assert.equal(connection.calls.some(call => call.kind === 'open'), false);
    assert.equal(connection.calls.at(-1)?.kind, 'close');
  });

  for (const scenario of [
    { blockedMethod: 'initialize', threadId: 'thread-existing' },
    { blockedMethod: 'thread/resume', threadId: 'thread-existing' },
    { blockedMethod: 'thread/start', threadId: undefined },
    { blockedMethod: 'thread/name/set', threadId: undefined },
  ]) {
    await t.test(`during ${scenario.blockedMethod}`, async () => {
      const blocked = deferred();
      const connection = new ProtocolConnection(method => (
        method === scenario.blockedMethod ? blocked.promise : defaultResponse(method)
      ));
      const controller = new AbortController();
      const pending = contribution(createAgent(connection), controller.signal, { threadId: scenario.threadId });

      await waitFor(
        () => requestMethods(connection).includes(scenario.blockedMethod),
        `${scenario.blockedMethod} request`,
      );
      controller.abort();
      await assert.rejects(promptly(pending), cancelled);
      blocked.resolve(defaultResponse(scenario.blockedMethod));
      await delay(0);

      assert.equal(requestMethods(connection).includes('turn/start'), false);
      assert.equal(connection.calls.at(-1)?.kind, 'close');
    });
  }
});

test('cancellation uses matching turn/started when turn/start response is delayed', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const controller = new AbortController();
  const pending = contribution(createAgent(connection), controller.signal);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  controller.abort();
  await delay(5);
  connection.emit({
    method: 'turn/started',
    params: { threadId: 'thread-123', turn: { id: 'turn-notified', status: 'inProgress', items: [] } },
  });
  await assert.rejects(promptly(pending), cancelled);

  const interrupt = connection.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-123', turnId: 'turn-notified' });
  assert.equal(connection.calls.at(-1)?.kind, 'close');
  blockedTurn.resolve(defaultResponse('turn/start'));
});

test('active cancellation interrupts the exact turn and awaits acknowledgement before close', { timeout: 1000 }, async () => {
  const interruptAcknowledgement = deferred();
  const connection = new ProtocolConnection(method => {
    if (method !== 'turn/interrupt') return defaultResponse(method);
    return interruptAcknowledgement.promise.then(result => {
      connection.calls.push({ kind: 'interrupt-acknowledged' });
      return result;
    });
  });
  const controller = new AbortController();
  const pending = contribution(createAgent(connection), controller.signal);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await waitFor(() => requestMethods(connection).includes('turn/interrupt'), 'turn/interrupt request');

  const interrupt = connection.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-123', turnId: 'turn-456' });
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(connection.calls.some(call => call.kind === 'close'), false);

  interruptAcknowledgement.resolve({});
  await assert.rejects(promptly(pending), cancelled);
  assert.ok(
    connection.calls.findIndex(call => call.kind === 'interrupt-acknowledged')
      < connection.calls.findIndex(call => call.kind === 'close'),
  );
});

test('unrelated notifications cannot supply content or complete the requested turn', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const pending = contribution(createAgent(connection));

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  connection.emit({
    method: 'turn/started',
    params: { threadId: 'thread-other', turn: { id: 'turn-other', status: 'inProgress', items: [] } },
  });
  connection.emit({
    method: 'item/completed',
    params: {
      threadId: 'thread-other',
      turnId: 'turn-other',
      item: { type: 'agentMessage', text: 'Unrelated recommendation.' },
    },
  });
  connection.emit({
    method: 'turn/completed',
    params: { threadId: 'thread-other', turn: { id: 'turn-other', status: 'completed' } },
  });
  await delay(0);
  assert.equal(settled, false);

  connection.emit({
    method: 'turn/started',
    params: { threadId: 'thread-123', turn: { id: 'turn-notified', status: 'inProgress', items: [] } },
  });
  connection.emit({
    method: 'item/completed',
    params: {
      threadId: 'thread-123',
      turnId: 'turn-other',
      item: { type: 'agentMessage', text: 'Wrong turn recommendation.' },
    },
  });
  connection.emit({
    method: 'turn/completed',
    params: { threadId: 'thread-123', turn: { id: 'turn-other', status: 'completed' } },
  });
  await delay(0);
  assert.equal(settled, false);

  connection.emit({
    method: 'item/completed',
    params: {
      threadId: 'thread-123',
      turnId: 'turn-notified',
      item: { type: 'agentMessage', text: 'Matched recommendation.' },
    },
  });
  connection.emit({
    method: 'turn/completed',
    params: { threadId: 'thread-123', turn: { id: 'turn-notified', status: 'completed' } },
  });

  const result = await promptly(pending);
  assert.equal(result.content, 'Matched recommendation.');
  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
  blockedTurn.resolve(defaultResponse('turn/start'));
});

test('request timeout reconciles a delayed turn/started before interrupting the nonterminal turn', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const pending = contribution(createAgent(connection));

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  const requestTimeout = new Error('Codex App Server request turn/start timed out.');
  const expectedFailure = assert.rejects(pending, error => {
    assert.equal(error.code, 'CODEX_FAILURE');
    assert.equal(error.message, requestTimeout.message);
    return true;
  });
  blockedTurn.reject(requestTimeout);
  await delay(5);
  connection.emit({
    method: 'turn/started',
    params: { threadId: 'thread-123', turn: { id: 'turn-notified', status: 'inProgress', items: [] } },
  });

  await expectedFailure;
  const interrupt = connection.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-123', turnId: 'turn-notified' });
  assert.ok(
    connection.calls.findIndex(call => call.method === 'turn/interrupt')
      < connection.calls.findIndex(call => call.kind === 'close'),
  );
});

test('contribution timeout interrupts a notified turn when turn/start response is lost', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const agent = createAgent(connection, { contributionTimeoutMs: 15 });
  const pending = contribution(agent);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  connection.emit({
    method: 'turn/started',
    params: { threadId: 'thread-123', turn: { id: 'turn-notified', status: 'inProgress', items: [] } },
  });

  await assert.rejects(pending, error => {
    assert.equal(error.code, 'CODEX_TIMEOUT');
    assert.equal(error.message, 'Codex exceeded the three-minute planning timeout.');
    return true;
  });

  const interrupt = connection.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-123', turnId: 'turn-notified' });
  assert.ok(
    connection.calls.findIndex(call => call.method === 'turn/interrupt')
      < connection.calls.findIndex(call => call.kind === 'close'),
  );
  blockedTurn.resolve(defaultResponse('turn/start'));
});
