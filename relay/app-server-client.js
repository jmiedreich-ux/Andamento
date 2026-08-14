const { spawn } = require('node:child_process');
const readline = require('node:readline');

class CodexAppServer {
  constructor(config, state, persistState) {
    this.config = config;
    this.state = state;
    this.persistState = persistState;
    this.nextId = 1;
    this.pending = new Map();
    this.currentTurn = null;
    this.chatRoot = config.remoteWorkspaceRoot || config.chatOnlyRoot;
  }

  async start() {
    if (this.config.remoteAppServerUrl) {
      await this.startWebSocket();
    } else {
      this.startProcess();
    }
    await this.initialize();
    await this.openThread();
  }

  startProcess() {
    this.process = spawn(this.config.codexExecutable, ['app-server', '--stdio'], {
      cwd: this.config.workspaceRoot,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stderr.on('data', chunk => process.stderr.write(chunk));
    this.process.on('exit', code => this.failAll(new Error(`Codex App Server exited with code ${code}.`)));
    readline.createInterface({ input: this.process.stdout }).on('line', line => this.handleLine(line));
  }

  startWebSocket() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.config.remoteAppServerUrl);
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('message', event => this.handleLine(event.data));
      this.socket.addEventListener('error', () => reject(new Error(`Unable to connect to ${this.config.remoteAppServerUrl}.`)), { once: true });
      this.socket.addEventListener('close', () => this.failAll(new Error('Codex App Server connection closed.')));
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'vennusign-workbench-relay', title: 'VennuSign Workbench Relay', version: '0.2.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.send({ method: 'initialized' });
    if (this.config.enableRemoteControl) {
      const remote = await this.request('remoteControl/enable', { ephemeral: false });
      console.log(`Codex Remote ${remote.status}; environment ${remote.environmentId || 'pending'}.`);
    }
  }

  async openThread() {
    if (this.state.threadId) {
      try {
        await this.request('thread/resume', {
          threadId: this.state.threadId,
          cwd: this.chatRoot,
          approvalPolicy: 'never',
          sandbox: 'read-only',
        });
        return;
      } catch (error) {
        console.error(`Unable to resume Codex thread ${this.state.threadId}: ${error.message}`);
        this.state.threadId = '';
      }
    }
    this.persistState();
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  send(message) {
    if (this.socket) {
      if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Codex App Server WebSocket is not writable.');
      this.socket.send(JSON.stringify(message));
      return;
    }
    if (!this.process || !this.process.stdin.writable) throw new Error('Codex App Server process is not writable.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (!this.currentTurn || !message.method) return;
    if (message.method === 'item/completed') {
      const item = message.params && message.params.item;
      if (item && item.type === 'agentMessage') this.currentTurn.finalMessage = item.text || this.currentTurn.finalMessage;
    }
    if (message.method === 'turn/completed') {
      const turn = message.params && message.params.turn;
      if (!turn || (this.currentTurn.turnId && turn.id !== this.currentTurn.turnId)) return;
      const current = this.currentTurn;
      this.currentTurn = null;
      clearTimeout(current.timeout);
      if (turn.status === 'completed') current.resolve(current.finalMessage || 'Codex completed without a final text response.');
      else current.reject(new Error((turn.error && turn.error.message) || `Codex turn ${turn.status}.`));
    }
  }

  async runTurn(prompt, commandType) {
    if (!this.state.threadId) throw new Error('Create or select a conversation before sending a message.');
    if (this.currentTurn) throw new Error('A Codex turn is already active.');
    let resolveTurn;
    let rejectTurn;
    const completion = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    this.currentTurn = { turnId: '', finalMessage: '', resolve: resolveTurn, reject: rejectTurn, timeout: null };
    try {
      const mayWrite = commandType === 'CONTINUE';
      const response = await this.request('turn/start', {
        threadId: this.state.threadId,
        input: [{ type: 'text', text: prompt }],
        cwd: this.chatRoot,
        approvalPolicy: 'never',
        sandboxPolicy: mayWrite
          ? { type: 'workspaceWrite', writableRoots: [this.chatRoot], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
          : { type: 'readOnly', networkAccess: false },
      });
      this.currentTurn.turnId = response.turn.id;
      this.currentTurn.timeout = setTimeout(() => {
        this.request('turn/interrupt', { threadId: this.state.threadId, turnId: this.currentTurn.turnId }).catch(() => {});
        const current = this.currentTurn;
        this.currentTurn = null;
        current.reject(new Error('Codex exceeded the 15-minute command timeout.'));
      }, 900000);
      return completion;
    } catch (error) {
      this.currentTurn = null;
      throw error;
    }
  }

  async listThreads() {
    const response = await this.request('thread/list', {
      limit: 30,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
    });
    const deleted = new Set(this.state.deletedThreadIds || []);
    const threads = (response.data || []).filter(thread => !deleted.has(thread.id));
    if (this.state.threadId && !threads.some(thread => thread.id === this.state.threadId)) {
      threads.unshift({ id: this.state.threadId, name: this.state.threadName || 'Current workbench conversation', preview: '' });
    }
    return threads;
  }

  async switchThread(threadId) {
    if (this.currentTurn) throw new Error('Wait for the current Codex command to finish before switching conversations.');
    const response = await this.request('thread/resume', {
      threadId,
      cwd: this.chatRoot,
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    this.state.threadId = response.thread.id;
    this.state.threadName = response.thread.name || '';
    this.persistState();
    return response.thread;
  }

  async newThread(name) {
    if (this.currentTurn) throw new Error('Wait for the current Codex command to finish before starting a conversation.');
    const response = await this.request('thread/start', {
      cwd: this.chatRoot,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceName: 'vennusign-workbench-relay',
      baseInstructions: 'VennuSign planning and coding workbench. Use the VennuSign workspace and planning context to answer questions, review work, and carry out explicit implementation requests. Discussing or reviewing does not authorize edits. Only modify files or run consequential commands when the user explicitly asks to implement, approve and continue, or otherwise authorizes the action.',
      ephemeral: false,
    });
    await this.request('thread/name/set', { threadId: response.thread.id, name });
    response.thread.name = name;
    this.state.threadId = response.thread.id;
    this.state.threadName = name;
    this.persistState();
    return response.thread;
  }

  async deleteThread(threadId) {
    if (!threadId) throw new Error('Select a conversation to delete.');
    await this.request('thread/delete', { threadId });
    this.state.deletedThreadIds = [...new Set([...(this.state.deletedThreadIds || []), threadId])];
    if (threadId === this.state.threadId) {
      this.state.threadId = '';
      this.state.threadName = '';
    }
    this.persistState();
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (this.currentTurn) {
      this.currentTurn.reject(error);
      this.currentTurn = null;
    }
  }

  stop() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    if (this.process && !this.process.killed) this.process.kill();
  }
}

module.exports = { CodexAppServer };
