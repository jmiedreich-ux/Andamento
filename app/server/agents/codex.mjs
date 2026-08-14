const BASE_INSTRUCTIONS = [
  'You are a planning participant inside Andamento.',
  'Respond with concise recommendations, risks, assumptions, and alternatives for the owner to decide.',
  'Discussion and agent agreement are never authorization.',
  'Do not modify files, invoke tools, or claim approval.',
  'Preserve material dissent and state uncertainty plainly.',
].join(' ');

function abortedError() {
  const error = new Error('The Codex contribution was cancelled.');
  error.code = 'CANCELLED';
  return error;
}

function contributionTimeoutError() {
  const error = new Error('Codex exceeded the three-minute planning timeout.');
  error.code = 'CODEX_TIMEOUT';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortedError();
}

function waitWithAbort(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortedError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function requestWithAbort(connection, method, params, { signal, timeoutMs } = {}) {
  throwIfAborted(signal);
  return waitWithAbort(connection.request(method, params, { signal, timeoutMs }), signal);
}

export async function probeWebSocket(url, { timeoutMs = 900 } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      resolve(value);
    }
    socket.addEventListener('open', () => finish(true), { once: true });
    socket.addEventListener('error', () => finish(false), { once: true });
    socket.addEventListener('close', () => finish(false), { once: true });
  });
}

class AppServerConnection {
  constructor(url, signal) {
    this.url = url;
    this.signal = signal;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async open() {
    throwIfAborted(this.signal);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('Timed out connecting to the local Codex bridge.')), 5000);
      const onAbort = () => finish(abortedError());
      const onOpen = () => finish();
      const onError = () => finish(new Error('Unable to connect to the local Codex bridge.'));
      const onEarlyClose = () => finish(new Error('Unable to connect to the local Codex bridge.'));

      const cleanup = () => {
        clearTimeout(timeout);
        this.signal?.removeEventListener('abort', onAbort);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onEarlyClose);
      };
      function finish(error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          try { socket.close(); } catch {}
          reject(error);
          return;
        }
        resolve();
      }

      this.signal?.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onEarlyClose, { once: true });
      socket.addEventListener('message', event => this.handle(String(event.data)));
      socket.addEventListener('close', () => this.failPending(new Error('Codex App Server connection closed.')));
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Codex App Server connection is not writable.');
    }
    this.socket.send(JSON.stringify(message));
  }

  request(method, params, options = {}) {
    if (typeof options === 'number') options = { timeoutMs: options };
    const { timeoutMs = 30000, signal = this.signal } = options;
    if (signal?.aborted) return Promise.reject(abortedError());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };
      const onAbort = () => settle(reject, abortedError());
      const timeout = setTimeout(
        () => settle(reject, new Error(`Codex App Server request ${method} timed out.`)),
        timeoutMs,
      );
      this.pending.set(id, {
        resolve: value => settle(resolve, value),
        reject: error => settle(reject, error),
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.send({ id, method, params });
      } catch (error) {
        settle(reject, error);
      }
    });
  }

  handle(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (Object.hasOwn(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error('The local Codex bridge refused a planning request.'));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  failPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close() {
    this.failPending(new Error('Codex App Server connection closed.'));
    try { this.socket?.close(); } catch {}
  }
}

export class CodexPlanningAgent {
  constructor({
    url,
    connectionFactory = (connectionUrl, signal) => new AppServerConnection(connectionUrl, signal),
    contributionTimeoutMs = 180000,
    interruptTimeoutMs = 5000,
  }) {
    this.url = url;
    this.connectionFactory = connectionFactory;
    this.contributionTimeoutMs = contributionTimeoutMs;
    this.interruptTimeoutMs = interruptTimeoutMs;
    this.id = 'codex';
    this.provider = 'openai';
    this.model = 'codex-local';
    this.displayName = 'Codex';
  }

  async available() {
    return probeWebSocket(this.url);
  }

  async contribute({ prompt, repositoryRoot, threadId, onThread, signal }) {
    const connection = this.connectionFactory(this.url, signal);
    let activeThreadId = threadId;
    let activeTurnId = '';
    let turnTerminal = false;
    let contributionTimeoutId;
    let removeListener = () => {};
    try {
      throwIfAborted(signal);
      await waitWithAbort(connection.open(), signal);
      await requestWithAbort(connection, 'initialize', {
        clientInfo: { name: 'andamento', title: 'Andamento', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }, { signal });
      throwIfAborted(signal);
      connection.send({ method: 'initialized' });

      if (activeThreadId) {
        try {
          await requestWithAbort(connection, 'thread/resume', {
            threadId: activeThreadId,
            cwd: repositoryRoot,
            approvalPolicy: 'never',
            sandbox: 'read-only',
          }, { signal });
        } catch (error) {
          if (signal?.aborted || error?.code === 'CANCELLED') throw abortedError();
          activeThreadId = '';
        }
      }
      if (!activeThreadId) {
        const started = await requestWithAbort(connection, 'thread/start', {
          cwd: repositoryRoot,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          serviceName: 'andamento-planning',
          baseInstructions: BASE_INSTRUCTIONS,
          ephemeral: false,
        }, { signal });
        activeThreadId = started.thread.id;
        await requestWithAbort(
          connection,
          'thread/name/set',
          { threadId: activeThreadId, name: 'Andamento planning room' },
          { signal },
        );
        await waitWithAbort(onThread(activeThreadId), signal);
      }

      let finalMessage = '';
      let resolveCompletion;
      let rejectCompletion;
      const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      let resolveTurnIdentity;
      const turnIdentity = new Promise(resolve => {
        resolveTurnIdentity = resolve;
      });
      const contributionDeadline = new Promise((_, reject) => {
        contributionTimeoutId = setTimeout(
          () => reject(contributionTimeoutError()),
          this.contributionTimeoutMs,
        );
      });
      let turnStartIssued = false;
      removeListener = connection.onMessage(message => {
        if (message.method === 'turn/started') {
          const { threadId: notificationThreadId, turn } = message.params || {};
          if (
            !turnStartIssued
            || notificationThreadId !== activeThreadId
            || typeof turn?.id !== 'string'
            || !turn.id
            || (activeTurnId && activeTurnId !== turn.id)
          ) return;
          activeTurnId = turn.id;
          resolveTurnIdentity(turn.id);
          return;
        }
        if (message.method === 'item/completed') {
          const { threadId: notificationThreadId, turnId, item } = message.params || {};
          if (
            notificationThreadId !== activeThreadId
            || !activeTurnId
            || turnId !== activeTurnId
          ) return;
          if (item?.type === 'agentMessage') finalMessage = item.text || finalMessage;
          return;
        }
        if (message.method === 'turn/completed') {
          const { threadId: notificationThreadId, turn } = message.params || {};
          if (
            notificationThreadId !== activeThreadId
            || !activeTurnId
            || turn?.id !== activeTurnId
          ) return;
          turnTerminal = true;
          if (turn.status === 'completed') resolveCompletion(finalMessage || 'Codex completed without a text contribution.');
          else rejectCompletion(new Error(`Codex could not complete the planning turn (${turn.status || 'unknown status'}).`));
        }
      });

      throwIfAborted(signal);
      turnStartIssued = true;
      const turnStart = Promise.resolve(connection.request('turn/start', {
        threadId: activeThreadId,
        input: [{ type: 'text', text: prompt }],
        cwd: repositoryRoot,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      }, {
        signal: null,
        timeoutMs: Math.max(
          this.contributionTimeoutMs + this.interruptTimeoutMs + 1000,
          30000,
        ),
      }));
      const turnStartResult = turnStart.then(startedTurn => {
        const turnId = startedTurn?.turn?.id;
        if (typeof turnId !== 'string' || !turnId) {
          throw new Error('The local Codex bridge returned an invalid turn start response.');
        }
        return { source: 'response', turnId };
      });
      try {
        const acceptedTurn = await waitWithAbort(Promise.race([
          turnStartResult,
          turnIdentity.then(turnId => ({ source: 'notification', turnId })),
          contributionDeadline,
        ]), signal);
        if (activeTurnId && activeTurnId !== acceptedTurn.turnId) {
          throw new Error('The local Codex bridge returned inconsistent turn identity.');
        }
        activeTurnId = acceptedTurn.turnId;
        resolveTurnIdentity(activeTurnId);
      } catch (error) {
        if (!activeTurnId) {
          let identityTimeoutId;
          const boundedIdentityWait = new Promise(resolve => {
            identityTimeoutId = setTimeout(
              () => resolve(''),
              Math.max(1, Math.min(this.interruptTimeoutMs, 500)),
            );
          });
          const lateResponseIdentity = new Promise(resolve => {
            turnStart.then(startedTurn => {
              const turnId = startedTurn?.turn?.id;
              if (typeof turnId === 'string' && turnId) resolve(turnId);
            }, () => {});
          });
          activeTurnId = await Promise.race([
            turnIdentity,
            lateResponseIdentity,
            boundedIdentityWait,
          ]).finally(() => clearTimeout(identityTimeoutId));
        }
        throw error;
      }
      throwIfAborted(signal);

      const content = await waitWithAbort(Promise.race([completion, contributionDeadline]), signal);
      return { provider: this.provider, model: this.model, content };
    } catch (error) {
      const failure = error instanceof Error
        ? error
        : new Error('Codex could not complete the planning contribution.');
      const cancelled = signal?.aborted || failure.code === 'CANCELLED';
      const timedOut = failure.code === 'CODEX_TIMEOUT';
      if (activeThreadId && activeTurnId && !turnTerminal) {
        const interruptController = new AbortController();
        const interruptDeadline = setTimeout(() => interruptController.abort(), this.interruptTimeoutMs);
        await requestWithAbort(connection, 'turn/interrupt', {
          threadId: activeThreadId,
          turnId: activeTurnId,
        }, {
          signal: interruptController.signal,
          timeoutMs: this.interruptTimeoutMs,
        }).catch(() => {}).finally(() => clearTimeout(interruptDeadline));
      }
      if (cancelled) {
        throw abortedError();
      }
      failure.code ||= 'CODEX_FAILURE';
      throw failure;
    } finally {
      clearTimeout(contributionTimeoutId);
      removeListener();
      connection.close();
    }
  }
}
