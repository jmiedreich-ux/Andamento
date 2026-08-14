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
    if (this.signal?.aborted) throw abortedError();
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to the local Codex bridge.')), 5000);
      const onAbort = () => reject(abortedError());
      this.signal?.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        this.signal?.removeEventListener('abort', onAbort);
        resolve();
      }, { once: true });
      socket.addEventListener('message', event => this.handle(String(event.data)));
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Unable to connect to the local Codex bridge.'));
      }, { once: true });
      socket.addEventListener('close', () => this.failPending(new Error('Codex App Server connection closed.')));
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Codex App Server connection is not writable.');
    }
    this.socket.send(JSON.stringify(message));
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      this.send({ id, method, params });
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
    try { this.socket?.close(); } catch {}
  }
}

export class CodexPlanningAgent {
  constructor({ url }) {
    this.url = url;
    this.id = 'codex';
    this.provider = 'openai';
    this.model = 'codex-local';
    this.displayName = 'Codex';
  }

  async available() {
    return probeWebSocket(this.url);
  }

  async contribute({ prompt, repositoryRoot, threadId, onThread, signal }) {
    const connection = new AppServerConnection(this.url, signal);
    let activeThreadId = threadId;
    let activeTurnId = '';
    try {
      await connection.open();
      await connection.request('initialize', {
        clientInfo: { name: 'andamento', title: 'Andamento', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      connection.send({ method: 'initialized' });

      if (activeThreadId) {
        try {
          await connection.request('thread/resume', {
            threadId: activeThreadId,
            cwd: repositoryRoot,
            approvalPolicy: 'never',
            sandbox: 'read-only',
          });
        } catch {
          activeThreadId = '';
        }
      }
      if (!activeThreadId) {
        const started = await connection.request('thread/start', {
          cwd: repositoryRoot,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          serviceName: 'andamento-planning',
          baseInstructions: BASE_INSTRUCTIONS,
          ephemeral: false,
        });
        activeThreadId = started.thread.id;
        await connection.request('thread/name/set', { threadId: activeThreadId, name: 'Andamento planning room' });
        await onThread(activeThreadId);
      }

      let finalMessage = '';
      let resolveCompletion;
      let rejectCompletion;
      const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      const removeListener = connection.onMessage(message => {
        if (message.method === 'item/completed') {
          const item = message.params?.item;
          if (item?.type === 'agentMessage') finalMessage = item.text || finalMessage;
        }
        if (message.method === 'turn/completed') {
          const turn = message.params?.turn;
          if (!turn || (activeTurnId && turn.id !== activeTurnId)) return;
          if (turn.status === 'completed') resolveCompletion(finalMessage || 'Codex completed without a text contribution.');
          else rejectCompletion(new Error(`Codex could not complete the planning turn (${turn.status || 'unknown status'}).`));
        }
      });

      const startedTurn = await connection.request('turn/start', {
        threadId: activeThreadId,
        input: [{ type: 'text', text: prompt }],
        cwd: repositoryRoot,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      });
      activeTurnId = startedTurn.turn.id;

      let timeoutId;
      let removeAbortListener = () => {};
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Codex exceeded the three-minute planning timeout.')), 180000);
      });
      const cancellation = new Promise((_, reject) => {
        if (!signal) return;
        const onAbort = () => reject(abortedError());
        if (signal.aborted) onAbort();
        else {
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        }
      });
      const content = await Promise.race([completion, timeout, cancellation]).finally(() => {
        clearTimeout(timeoutId);
        removeAbortListener();
      });
      removeListener();
      return { provider: this.provider, model: this.model, content };
    } catch (error) {
      if (signal?.aborted) {
        if (activeThreadId && activeTurnId) {
          await connection.request('turn/interrupt', { threadId: activeThreadId, turnId: activeTurnId }, 5000).catch(() => {});
        }
        throw abortedError();
      }
      error.code ||= 'CODEX_FAILURE';
      throw error;
    } finally {
      connection.close();
    }
  }
}
