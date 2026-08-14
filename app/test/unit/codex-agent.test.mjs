import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { AppServerConnection, CodexPlanningAgent } from '../../server/agents/codex.mjs';

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
    this.calls.push({ kind: 'notification', message });
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

function timedOut(error) {
  assert.equal(error.code, 'CODEX_TIMEOUT');
  assert.equal(error.message, 'Codex exceeded the three-minute planning timeout.');
  return true;
}

function cleanupUnconfirmed(error) {
  assert.equal(error.code, 'CODEX_CLEANUP_UNCONFIRMED');
  assert.equal(error.message, 'Codex could not confirm that the planning turn stopped.');
  return true;
}

function emitTurnStarted(connection, turnId = 'turn-notified') {
  connection.emit({
    method: 'turn/started',
    params: { threadId: 'thread-123', turn: { id: turnId, status: 'inProgress', items: [] } },
  });
}

function emitTurnCompleted(connection, turnId, status = 'interrupted') {
  connection.emit({
    method: 'turn/completed',
    params: { threadId: 'thread-123', turn: { id: turnId, status } },
  });
}

async function refusalFromWire(error) {
  const connection = new AppServerConnection('ws://andamento.test');
  const response = new Promise((resolve, reject) => {
    connection.pending.set(41, { resolve, reject });
  });
  connection.handle(JSON.stringify({ id: 41, error }));
  return response.then(
    () => assert.fail('Expected the wire response to be refused.'),
    failure => failure,
  );
}

async function notSentFromProductionConnection() {
  const connection = new AppServerConnection('ws://andamento.test');
  connection.send = () => {
    throw new Error('Private socket failure detail.');
  };
  return connection.request('turn/start', {}, { signal: null, timeoutMs: 100 }).then(
    () => assert.fail('Expected the request send to fail.'),
    failure => failure,
  );
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

test('cancellation uses the full cleanup budget to reconcile response identity after 650ms', { timeout: 3000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const controller = new AbortController();
  const pending = contribution(
    createAgent(connection, { interruptTimeoutMs: 1000 }),
    controller.signal,
  );
  const expectedCancellation = assert.rejects(pending, cancelled);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  controller.abort();
  await delay(650);
  blockedTurn.resolve(defaultResponse('turn/start'));
  await waitFor(() => requestMethods(connection).includes('turn/interrupt'), 'turn/interrupt request');
  emitTurnCompleted(connection, 'turn-456');
  await expectedCancellation;

  const interrupt = connection.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-123', turnId: 'turn-456' });
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('synchronous turn/start request failure is not treated as an accepted turn', async () => {
  const requestFailure = new Error('The turn request could not be sent.');
  const connection = new ProtocolConnection(method => {
    if (method === 'turn/start') throw requestFailure;
    return defaultResponse(method);
  });

  await assert.rejects(contribution(createAgent(connection)), error => {
    assert.equal(error.code, 'CODEX_FAILURE');
    assert.equal(error.message, requestFailure.message);
    return true;
  });

  assert.equal(requestMethods(connection).includes('turn/start'), true);
  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('correlated server refusal remains retryable and cannot claim a later notification', async () => {
  const refusal = await refusalFromWire({
    code: -32001,
    message: 'Server overloaded; private diagnostic detail.',
  });
  assert.equal(refusal.code, 'CODEX_REQUEST_REFUSED');
  assert.equal(refusal.message, 'The local Codex bridge refused a planning request.');
  assert.equal(refusal.message.includes('private diagnostic'), false);

  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const pending = contribution(createAgent(connection));
  const expectedFailure = assert.rejects(pending, error => {
    assert.equal(error.code, 'CODEX_FAILURE');
    assert.equal(error.message, 'The local Codex bridge refused a planning request.');
    return true;
  });

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  blockedTurn.reject(refusal);
  emitTurnStarted(connection, 'turn-external');
  await expectedFailure;

  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('late definite turn/start failure proves no turn was accepted', { timeout: 1000 }, async t => {
  await t.test('after cancellation preserves cancellation without cleanup quarantine', async () => {
    const blockedTurn = deferred();
    const refusal = await refusalFromWire({ code: -32001, message: 'Server overloaded.' });
    const connection = new ProtocolConnection(method => (
      method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
    ));
    const controller = new AbortController();
    const pending = contribution(createAgent(connection), controller.signal);
    const expectedCancellation = assert.rejects(pending, cancelled);

    await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
    controller.abort();
    await delay(5);
    blockedTurn.reject(refusal);
    emitTurnStarted(connection, 'turn-external');
    await expectedCancellation;

    assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
    assert.equal(connection.calls.at(-1)?.kind, 'close');
  });

  await t.test('after contribution deadline preserves timeout without cleanup quarantine', async () => {
    const blockedTurn = deferred();
    const notSent = await notSentFromProductionConnection();
    const connection = new ProtocolConnection(method => (
      method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
    ));
    const pending = contribution(createAgent(connection, { contributionTimeoutMs: 15 }));
    const expectedTimeout = assert.rejects(pending, timedOut);

    await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
    await delay(25);
    blockedTurn.reject(notSent);
    await expectedTimeout;

    assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
    assert.equal(connection.calls.at(-1)?.kind, 'close');
  });

  await t.test('generic late transport failure remains cleanup-unconfirmed', async () => {
    const blockedTurn = deferred();
    const connection = new ProtocolConnection(method => (
      method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
    ));
    const controller = new AbortController();
    const pending = contribution(createAgent(connection), controller.signal);
    const expectedCleanupFailure = assert.rejects(pending, cleanupUnconfirmed);

    await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
    controller.abort();
    await delay(5);
    blockedTurn.reject(new Error('The transport closed after sending.'));
    await expectedCleanupFailure;

    assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
    assert.equal(connection.calls.at(-1)?.kind, 'close');
  });
});

test('production send throw is marked definitely not sent and remains retryable', async () => {
  const notSent = await notSentFromProductionConnection();
  assert.equal(notSent.code, 'CODEX_REQUEST_NOT_SENT');
  assert.equal(notSent.message, 'The local Codex bridge could not receive a planning request.');
  assert.equal(notSent.message.includes('Private socket'), false);

  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? Promise.reject(notSent) : defaultResponse(method)
  ));
  await assert.rejects(contribution(createAgent(connection)), error => {
    assert.equal(error.code, 'CODEX_FAILURE');
    assert.equal(error.message, 'The local Codex bridge could not receive a planning request.');
    return true;
  });

  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('active cancellation requires interrupt acknowledgement then matching terminal before close', { timeout: 1000 }, async () => {
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
  const expectedCancellation = assert.rejects(pending, cancelled);

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
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(connection.calls.some(call => call.kind === 'close'), false);
  emitTurnCompleted(connection, 'turn-456');
  await expectedCancellation;
  const terminalIndex = connection.calls.findIndex(call => (
    call.kind === 'notification'
    && call.message.method === 'turn/completed'
    && call.message.params.turn.id === 'turn-456'
  ));
  assert.ok(
    connection.calls.findIndex(call => call.kind === 'interrupt-acknowledged')
      < terminalIndex,
  );
  assert.ok(terminalIndex < connection.calls.findIndex(call => call.kind === 'close'));
});

test('matching terminal confirms cleanup even when interrupt rejects', { timeout: 1000 }, async () => {
  const interrupt = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/interrupt' ? interrupt.promise : defaultResponse(method)
  ));
  const controller = new AbortController();
  const pending = contribution(createAgent(connection), controller.signal);
  const expectedCancellation = assert.rejects(pending, cancelled);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await waitFor(() => requestMethods(connection).includes('turn/interrupt'), 'turn/interrupt request');

  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  interrupt.reject(new Error('The turn already completed.'));
  emitTurnCompleted(connection, 'turn-external', 'completed');
  await delay(5);
  assert.equal(settled, false);
  assert.equal(connection.calls.some(call => call.kind === 'close'), false);

  emitTurnCompleted(connection, 'turn-456', 'completed');
  await expectedCancellation;
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('interrupt rejection reports cleanup unconfirmed and closes the connection', { timeout: 1000 }, async () => {
  const connection = new ProtocolConnection(method => {
    if (method === 'turn/interrupt') {
      return Promise.reject(new Error('The bridge rejected interruption.'));
    }
    return defaultResponse(method);
  });
  const controller = new AbortController();
  const pending = contribution(createAgent(connection), controller.signal);
  const expectedCleanupFailure = assert.rejects(pending, cleanupUnconfirmed);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await expectedCleanupFailure;

  const interrupt = connection.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-123', turnId: 'turn-456' });
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('interrupt acknowledgement without terminal confirmation reports cleanup unconfirmed', { timeout: 1000 }, async () => {
  const connection = new ProtocolConnection();
  const controller = new AbortController();
  const pending = contribution(
    createAgent(connection, { interruptTimeoutMs: 40 }),
    controller.signal,
  );
  const expectedCleanupFailure = assert.rejects(pending, cleanupUnconfirmed);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await expectedCleanupFailure;

  assert.equal(requestMethods(connection).includes('turn/interrupt'), true);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('uncorrelated same-thread turn/started cannot become cancellation identity', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const controller = new AbortController();
  const pending = contribution(
    createAgent(connection, { interruptTimeoutMs: 40 }),
    controller.signal,
  );
  const expectedCleanupFailure = assert.rejects(pending, cleanupUnconfirmed);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  controller.abort();
  emitTurnStarted(connection, 'turn-external');
  await expectedCleanupFailure;

  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
  blockedTurn.resolve(defaultResponse('turn/start'));
});

test('uncorrelated notifications cannot supply content or complete the requested turn', { timeout: 1000 }, async () => {
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

  emitTurnStarted(connection, 'turn-external');
  connection.emit({
    method: 'item/completed',
    params: {
      threadId: 'thread-123',
      turnId: 'turn-external',
      item: { type: 'agentMessage', text: 'External recommendation.' },
    },
  });
  connection.emit({
    method: 'turn/completed',
    params: { threadId: 'thread-123', turn: { id: 'turn-external', status: 'completed' } },
  });
  await delay(0);
  assert.equal(settled, false);

  blockedTurn.resolve(defaultResponse('turn/start'));
  await delay(0);
  connection.emit({
    method: 'item/completed',
    params: {
      threadId: 'thread-123',
      turnId: 'turn-456',
      item: { type: 'agentMessage', text: 'Matched recommendation.' },
    },
  });
  emitTurnCompleted(connection, 'turn-456', 'completed');

  const result = await promptly(pending);
  assert.equal(result.content, 'Matched recommendation.');
  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
});

test('request failure cannot claim a later uncorrelated turn/started notification', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const pending = contribution(createAgent(connection));

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  const requestTimeout = new Error('Codex App Server request turn/start timed out.');
  const expectedFailure = assert.rejects(pending, cleanupUnconfirmed);
  blockedTurn.reject(requestTimeout);
  await delay(5);
  emitTurnStarted(connection, 'turn-external');

  await expectedFailure;
  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.some(call => call.kind === 'close'), true);
});

test('contribution timeout quarantines when only uncorrelated turn identity is available', { timeout: 1000 }, async () => {
  const blockedTurn = deferred();
  const connection = new ProtocolConnection(method => (
    method === 'turn/start' ? blockedTurn.promise : defaultResponse(method)
  ));
  const agent = createAgent(connection, { contributionTimeoutMs: 15 });
  const pending = contribution(agent);
  const expectedTimeout = assert.rejects(pending, cleanupUnconfirmed);

  await waitFor(() => requestMethods(connection).includes('turn/start'), 'turn/start request');
  emitTurnStarted(connection, 'turn-external');

  await expectedTimeout;
  assert.equal(requestMethods(connection).includes('turn/interrupt'), false);
  assert.equal(connection.calls.at(-1)?.kind, 'close');
  blockedTurn.resolve(defaultResponse('turn/start'));
});
