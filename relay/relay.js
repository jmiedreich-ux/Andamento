const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const QRCode = require('qrcode');
const { CodexAppServer } = require('./app-server-client');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'relay.config.json');
const STATE_PATH = path.join(ROOT, 'relay.state.json');
const STOP_PATH = path.join(ROOT, 'relay.stop');
const COMMAND_RANGE = "'Codex Commands'!A2:M";
const ACTIVITY_RANGE = "'Codex Activity'!A:J";

function validateConfig(config) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(config.spreadsheetId || '')) throw new Error('Invalid spreadsheetId.');
  const workspace = path.resolve(config.workspaceRoot || '');
  if (!path.isAbsolute(workspace) || !fs.existsSync(path.join(workspace, '.git'))) {
    throw new Error('workspaceRoot must be an existing Git repository.');
  }
  const codexExecutable = path.resolve(config.codexExecutable || '');
  if (!path.isAbsolute(codexExecutable) || !fs.existsSync(codexExecutable)) throw new Error('codexExecutable does not exist.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(config.webAppUrl || '')) throw new Error('Invalid webAppUrl.');
  const localPort = Number(config.localPort) || 47821;
  if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) throw new Error('Invalid localPort.');
  return { ...config, workspaceRoot: workspace, codexExecutable, localPort, pollIntervalSeconds: Math.max(10, Number(config.pollIntervalSeconds) || 30) };
}

class WorkbenchBridge {
  constructor(url) { this.url = url; this.token = ''; }
  async authorize() {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.clasprc.json'), 'utf8')).tokens.default;
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: auth.client_id, client_secret: auth.client_secret, refresh_token: auth.refresh_token, grant_type: 'refresh_token' }) });
    if (!response.ok) throw new Error(`Google OAuth failed: ${response.status}`);
    this.token = (await response.json()).access_token;
  }
  async request(url, options = {}) {
    if (!this.token) await this.authorize();
    let response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } });
    if (response.status === 401) { await this.authorize(); response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } }); }
    if (!response.ok) throw new Error(`Workbench API ${response.status}`);
    const result = await response.json();
    if (result.ok === false) throw new Error(result.error || 'Workbench API rejected the request.');
    return result;
  }
  poll() { return this.request(`${this.url}?relay=poll`); }
  diagnostics() { return this.request(`${this.url}?relay=diagnostics`); }
  post(payload) { return this.request(this.url, { method: 'POST', body: JSON.stringify(payload) }); }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) request.destroy(new Error('Request body is too large.'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body.')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorizeLocalRequest(request, response, url, config) {
  const address = request.socket.remoteAddress || '';
  if (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1') return true;
  const queryKey = url.searchParams.get('key');
  const cookie = String(request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('vennusign_lan='));
  const cookieKey = cookie ? decodeURIComponent(cookie.slice('vennusign_lan='.length)) : '';
  if (safeEqual(queryKey, config.lanAccessKey) || safeEqual(cookieKey, config.lanAccessKey)) {
    if (queryKey) response.setHeader('Set-Cookie', `vennusign_lan=${encodeURIComponent(config.lanAccessKey)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    return true;
  }
  response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('VennuSign Workbench access key required.');
  return false;
}

function readRepoMilestones(workspaceRoot) {
  const output = execFileSync('git', ['log', '--first-parent', '--date=short', '--pretty=format:%ad%x1f%s', '-n', '200'], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true });
  const milestones = [];
  for (const line of output.split(/\r?\n/)) {
    const [date, subject = ''] = line.split('\x1f');
    const merge = subject.match(/^Merge pull request #(\d+) from [^/]+\/(?:feature\/)?(menus-[^\s]+)$/i);
    const squash = subject.match(/^(Menus .+?)\s*\(#(\d+)\)(?:\s*\[skip ci\])?$/i);
    if (!merge && !squash) continue;
    let label = squash ? squash[1].replace(/^Menus\s+/i, '') : merge[2].replace(/^menus-/, '');
    if (merge) {
      const humanize = value => value.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      let match = label.match(/^m3a-s(\d+)-(.+)$/i);
      if (match) label = `M3-A Slice ${match[1]} · ${humanize(match[2])}`;
      else if ((match = label.match(/^m(\d+)a(\d+)-(.+)$/i))) label = `${match[1]}-A${match[2]} · ${humanize(match[3])}`;
      else if ((match = label.match(/^s(\d+)-(.+)$/i))) label = `Slice ${match[1]} · ${humanize(match[2])}`;
      else if ((match = label.match(/^m(\d+)-(.+)$/i))) label = `Milestone ${match[1]} · ${humanize(match[2])}`;
      else label = humanize(label);
    }
    milestones.push({ date, title: label, status: 'complete' });
    if (milestones.length === 12) break;
  }
  return milestones;
}

function startLocalServer(config, bridge, onCommandQueued) {
  const html = fs.readFileSync(path.join(ROOT, 'local-ui.html'));
  const prototype = fs.readFileSync(path.join(ROOT, 'planning-prototype.html'));
  const phoneConnect = fs.readFileSync(path.join(ROOT, 'phone-connect.html'), 'utf8');
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${config.localPort}`);
      if (!authorizeLocalRequest(request, response, url, config)) return;
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(html);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/prototype') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(prototype);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/connect') {
        const base = `http://${config.lanHost}:${config.localPort}`;
        const page = phoneConnect.replaceAll('{{WORKBENCH_URL}}', `${base}/?key=${config.lanAccessKey}`).replaceAll('{{PROTOTYPE_URL}}', `${base}/prototype?key=${config.lanAccessKey}`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(page);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/connect/qr') {
        const targetPath = url.searchParams.get('target') === 'prototype' ? '/prototype' : '/';
        const target = `http://${config.lanHost}:${config.localPort}${targetPath}?key=${config.lanAccessKey}`;
        const image = await QRCode.toBuffer(target, { type: 'png', width: 320, margin: 2, color: { dark: '#102f43', light: '#ffffff' } });
        response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        response.end(image);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/assets/vennu-display.woff2') {
        response.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
        response.end(fs.readFileSync(path.join(ROOT, 'assets', 'vennu-display.woff2')));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const result = await bridge.diagnostics();
        sendJson(response, 200, { online: true, activity: result.activity || [], threadId: bridge.threadId(), milestones: readRepoMilestones(config.workspaceRoot) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/threads') {
        const threads = await bridge.listThreads();
        sendJson(response, 200, { threads });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/threads/switch') {
        const input = await readJsonBody(request);
        sendJson(response, 200, { thread: await bridge.switchThread(input.threadId) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/threads/new') {
        const input = await readJsonBody(request);
        const name = String(input.name || '').trim();
        if (!name || name.length > 80) { sendJson(response, 400, { error: 'Enter a conversation name between 1 and 80 characters.' }); return; }
        sendJson(response, 200, { thread: await bridge.newThread(name) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/threads/delete') {
        const input = await readJsonBody(request);
        await bridge.deleteThread(String(input.threadId || ''));
        sendJson(response, 200, { deleted: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/commands') {
        const input = await readJsonBody(request);
        const result = await bridge.post({ action: 'enqueue', input });
        onCommandQueued();
        sendJson(response, 200, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/activity/clear') {
        const result = await bridge.post({ action: 'clearActivity' });
        sendJson(response, 200, result);
        return;
      }
      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(response, 500, { error: String(error.message || error) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.localPort, '0.0.0.0', () => resolve(server));
  });
}

function pendingCommands(rows) {
  return rows.map((row, index) => ({ rowNumber: index + 2, row })).filter(({ row }) => row[8] === 'PENDING');
}

function commandPrompt(row) {
  const type = String(row[4] || '').toUpperCase();
  const message = String(row[5] || '').trim();
  if (!['CONTINUE', 'MESSAGE', 'REVIEW', 'STOP', 'APPROVAL'].includes(type)) throw new Error(`Unsupported command type: ${type}`);
  if (!message) throw new Error('Command message is empty.');
  return [
    'This instruction came from the authenticated VennuSign Workbench.',
    `Command type: ${type}.`,
    row[1] && row[2] ? `Planning reference: ${row[1]} / ${row[2]}.` : '',
    message,
    'Use the selected conversation context and the VennuSign workspace. Treat discussion and review as read-only; make changes only when this command explicitly authorizes implementation.'
  ].filter(Boolean).join('\n');
}

class GoogleSheets {
  constructor(spreadsheetId) { this.spreadsheetId = spreadsheetId; this.token = ''; }

  async authorize() {
    const clasp = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.clasprc.json'), 'utf8'));
    const auth = clasp.tokens.default;
    const body = new URLSearchParams({
      client_id: auth.client_id,
      client_secret: auth.client_secret,
      refresh_token: auth.refresh_token,
      grant_type: 'refresh_token'
    });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
    if (!response.ok) throw new Error(`Google OAuth failed: ${response.status}`);
    this.token = (await response.json()).access_token;
  }

  async request(url, options = {}) {
    if (!this.token) await this.authorize();
    const run = () => fetch(url, { ...options, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
    let response = await run();
    if (response.status === 401) { await this.authorize(); response = await run(); }
    if (!response.ok) throw new Error(`Sheets API ${response.status}: ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }

  url(range, suffix = '') {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}${suffix}`;
  }

  async read(range) {
    const result = await this.request(this.url(range));
    return result.values || [];
  }

  async write(range, values) {
    return this.request(this.url(range, '?valueInputOption=RAW'), { method: 'PUT', body: JSON.stringify({ values }) });
  }

  async append(range, values) {
    return this.request(this.url(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { method: 'POST', body: JSON.stringify({ values }) });
  }
}

function runCodex(config, state, prompt) {
  return new Promise((resolve, reject) => {
    const args = state.threadId
      ? ['-a', 'never', '-s', 'workspace-write', 'exec', 'resume', state.threadId, prompt, '--json']
      : ['-a', 'never', '-s', 'workspace-write', '-C', config.workspaceRoot, 'exec', '--json', prompt];
    const child = spawn(config.codexExecutable, args, { cwd: config.workspaceRoot, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 900000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      let finalMessage = '';
      for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'thread.started' && event.thread_id) state.threadId = event.thread_id;
          if (event.type === 'item.completed' && event.item && event.item.type === 'agent_message') finalMessage = event.item.text || finalMessage;
        } catch {}
      }
      if (timedOut) return reject(new Error('Codex exceeded the 15-minute command timeout. Retry with a narrower instruction.'));
      if (code !== 0) return reject(new Error((stderr || stdout || `Codex exited ${code}`).trim().slice(-4000)));
      resolve(finalMessage || 'Codex completed the command without a final text response.');
    });
  });
}

async function setConfig(sheets, key, value) {
  const rows = await sheets.read("'Codex Config'!A2:B");
  const index = rows.findIndex(row => row[0] === key);
  if (index < 0) throw new Error(`Missing Codex Config key: ${key}`);
  await sheets.write(`'Codex Config'!B${index + 2}`, [[value]]);
}

async function activity(sheets, command, threadId, eventType, summary, details = '') {
  const row = command.row;
  await sheets.append(ACTIVITY_RANGE, [[
    `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, row[0], row[1] || '', row[2] || '',
    threadId || '', 'relay:vennusign-workbench', eventType, summary, details, new Date().toISOString()
  ]]);
}

async function updateCommand(sheets, command, values) {
  for (const [column, value] of Object.entries(values)) {
    await sheets.write(`'Codex Commands'!${column}${command.rowNumber}`, [[value]]);
  }
}

async function processCommand(sheets, config, state, command) {
  const now = new Date().toISOString();
  await updateCommand(sheets, command, { I: 'PROCESSING', J: 'relay:vennusign-workbench', K: now, M: '' });
  const verify = await sheets.read(`'Codex Commands'!A${command.rowNumber}:M${command.rowNumber}`);
  if (!verify[0] || verify[0][0] !== command.row[0] || verify[0][8] !== 'PROCESSING') throw new Error('Command claim verification failed.');
  await activity(sheets, command, state.threadId, 'STARTED', `${command.row[4]} command started.`);
  try {
    if (command.row[4] === 'STOP') {
      await activity(sheets, command, state.threadId, 'STOPPED', 'Queued work stopped. No Codex turn was started.');
    } else {
      const result = await runCodex(config, state, commandPrompt(command.row));
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
      await setConfig(sheets, 'active_thread_id', state.threadId || '');
      await activity(sheets, command, state.threadId, 'RESULT', result);
    }
    await updateCommand(sheets, command, { I: 'COMPLETED', L: new Date().toISOString(), M: '' });
  } catch (error) {
    const message = String(error.message || error).slice(0, 4000);
    await activity(sheets, command, state.threadId, 'ERROR', 'Command failed.', message);
    await updateCommand(sheets, command, { I: 'FAILED', L: new Date().toISOString(), M: message });
  }
}

async function main() {
  const config = validateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
  const sheetBridge = new WorkbenchBridge(config.webAppUrl);
  const appServer = new CodexAppServer(config, state, () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)));
  await appServer.start();
  const bridge = {
    diagnostics: () => sheetBridge.diagnostics(),
    poll: () => sheetBridge.poll(),
    post: input => sheetBridge.post(input),
    threadId: () => state.threadId || '',
    listThreads: () => appServer.listThreads(),
    switchThread: threadId => appServer.switchThread(threadId),
    newThread: name => appServer.newThread(name),
    deleteThread: threadId => appServer.deleteThread(threadId),
  };
  let wakePolling = function () {};
  function waitForPolling(delay) {
    return new Promise(resolve => {
      const timer = setTimeout(function () { wakePolling = function () {}; resolve(); }, delay);
      wakePolling = function () { clearTimeout(timer); wakePolling = function () {}; resolve(); };
    });
  }
  const localServer = await startLocalServer(config, bridge, function () { wakePolling(); });
  let heartbeatInFlight = false;
  const heartbeat = async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try { await bridge.post({ action: 'heartbeat' }); }
    catch (error) { console.error(new Date().toISOString(), error); }
    finally { heartbeatInFlight = false; }
  };
  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, config.pollIntervalSeconds * 1000);
  try {
    while (!fs.existsSync(STOP_PATH)) {
      try {
      const commands = (await bridge.poll()).commands || [];
      if (commands.length) {
        const command = commands[0];
        const claim = await bridge.post({ action: 'claim', commandId: command.command_id });
        if (claim.claimed) {
          let progressTimer;
          try {
            const row = COMMAND_HEADERS_FOR_RELAY.map(header => command[header] || '');
            if (command.command_type !== 'STOP') {
              progressTimer = setInterval(() => {
                bridge.post({ action: 'progress', commandId: command.command_id, threadId: state.threadId || '', summary: 'Codex is still working on this command.' }).catch(error => console.error(new Date().toISOString(), error));
              }, 20000);
            }
            const isHealthCheck = command.command_type === 'MESSAGE' && command.message.trim().toLowerCase() === 'test';
            const result = command.command_type === 'STOP'
              ? 'Queued work stopped. No Codex turn was started.'
              : isHealthCheck
                ? `Relay online. Workspace: ${config.workspaceRoot}. Codex commands are ready.`
                : await appServer.runTurn(commandPrompt(row), command.command_type);
            fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
            await bridge.post({ action: 'finish', commandId: command.command_id, status: 'COMPLETED', threadId: state.threadId || '', summary: result });
          } catch (error) {
            await bridge.post({ action: 'finish', commandId: command.command_id, status: 'FAILED', threadId: state.threadId || '', summary: 'Command failed.', error: String(error.message || error).slice(0, 4000) });
          } finally {
            if (progressTimer) clearInterval(progressTimer);
          }
        }
      }
      } catch (error) {
        console.error(new Date().toISOString(), error);
      }
      await waitForPolling(config.pollIntervalSeconds * 1000);
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
  await new Promise(resolve => localServer.close(resolve));
  appServer.stop();
  fs.unlinkSync(STOP_PATH);
}

const COMMAND_HEADERS_FOR_RELAY = ['command_id', 'source_tab', 'source_id', 'thread_id', 'command_type', 'message', 'requested_by', 'requested_at', 'status', 'claimed_by', 'claimed_at', 'processed_at', 'error'];

module.exports = { validateConfig, pendingCommands, commandPrompt };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
