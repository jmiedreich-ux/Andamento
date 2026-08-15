import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { test, expect } from '@playwright/test';

const repositoryRoot = process.env.ANDAMENTO_E2E_REPOSITORY_ROOT || process.cwd();
const completePackageContent = {
  outcome: 'Ship one owner-governed planning loop.',
  includedScope: ['Keep the owner approval boundary explicit.'],
  exclusions: ['No package execution in this milestone.'],
  acceptanceCriteria: ['The exact approved version is visibly locked.'],
  reviewRequirements: ['Independent implementation review is required.'],
  evidenceRequirements: ['Return rerunnable implementation and Playwright evidence.'],
};
let sequence = 0;

function key(label) {
  sequence += 1;
  return `e2e:${label}:${sequence}`;
}

async function fixtureRepository(label) {
  const safeLabel = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const root = path.resolve('var', 'e2e-repositories', safeLabel || `repository-${sequence}`);
  await mkdir(root, { recursive: true });
  const initialized = spawn('git', ['init', '--quiet', root], { stdio: 'ignore' });
  const [code] = await once(initialized, 'exit');
  if (code !== 0) throw new Error(`Could not initialize end-to-end Git repository ${root}.`);
  return root;
}

async function json(response) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body;
}

async function createProjectApi(request, name, { base = '', root = repositoryRoot } = {}) {
  const resolvedRoot = root === repositoryRoot ? await fixtureRepository(`${name}-${sequence + 1}`) : root;
  const body = await json(await request.post(`${base}/api/projects`, {
    data: { name, repositoryRoot: resolvedRoot, idempotencyKey: key('project') },
  }));
  return body.project;
}

async function createDiscussionApi(request, projectId, title, { base = '' } = {}) {
  const body = await json(await request.post(`${base}/api/projects/${projectId}/discussions`, {
    data: { title, idempotencyKey: key('discussion') },
  }));
  return body.discussion;
}

async function createWorkspaceApi(request, label, options = {}) {
  const project = await createProjectApi(request, `${label} project`, options);
  const discussion = await createDiscussionApi(request, project.id, `${label} room`, options);
  return { project, discussion };
}

async function addMessageApi(request, discussionId, content, options = {}) {
  const base = options.base || '';
  const body = await json(await request.post(`${base}/api/discussions/${discussionId}/messages`, {
    data: {
      contributionType: options.contributionType || 'OWNER',
      content,
      displayName: options.displayName,
      provider: options.provider,
      model: options.model,
      idempotencyKey: options.idempotencyKey || key('message'),
    },
  }));
  return body;
}

async function capturePointApi(request, messageId, text, options = {}) {
  const base = options.base || '';
  const body = await json(await request.post(`${base}/api/messages/${messageId}/planning-points`, {
    data: {
      pointType: options.pointType || 'REQUIREMENT',
      text,
      idempotencyKey: options.idempotencyKey || key('point'),
    },
  }));
  return body.point;
}

async function dispositionPointApi(request, point, disposition = 'ACCEPTED', options = {}) {
  const base = options.base || '';
  const body = await json(await request.post(`${base}/api/planning-points/${point.id}/disposition`, {
    data: {
      disposition,
      expectedVersion: options.expectedVersion || point.rowVersion,
      idempotencyKey: options.idempotencyKey || key('disposition'),
    },
    headers: options.headers,
  }));
  return body.point;
}

async function seedAcceptedPoint(request, discussionId, text, options = {}) {
  const message = (await addMessageApi(request, discussionId, `${text} Source context.`, options)).message;
  const point = await capturePointApi(request, message.id, text, options);
  return dispositionPointApi(request, point, 'ACCEPTED', options);
}

async function preparePackageApi(request, discussionId, options = {}) {
  const base = options.base || '';
  const prepared = await json(await request.post(`${base}/api/discussions/${discussionId}/work-package`, {
    data: { idempotencyKey: options.idempotencyKey || key('prepare') },
  }));
  return prepared.version;
}

async function updatePackageApi(request, version, content = completePackageContent, options = {}) {
  const base = options.base || '';
  const body = await json(await request.put(`${base}/api/work-package-versions/${version.id}`, {
    data: {
      content,
      expectedVersion: options.expectedVersion || version.rowVersion,
      idempotencyKey: options.idempotencyKey || key('package-update'),
    },
    headers: options.headers,
  }));
  return body.version;
}

async function seedDraftPackage(request, discussionId, options = {}) {
  await seedAcceptedPoint(request, discussionId, options.pointText || 'Keep the owner approval boundary explicit.', options);
  return preparePackageApi(request, discussionId, options);
}

function routeFor({ project, discussion }, base = '') {
  return `${base}/#/projects/${project.id}/discussions/${discussion.id}`;
}

async function createProjectUi(page, name, { firstRun = false } = {}) {
  await page.goto(firstRun ? '/' : '/#/new-project');
  await expect(page.getByRole('heading', { name: firstRun ? 'Start with the work' : /^(Start with the work|Register another project)$/ })).toBeVisible();
  await page.getByLabel('Project name').fill(name);
  await page.getByLabel('Local Git repository').fill(await fixtureRepository(`${name}-${sequence + 1}`));
  await page.getByRole('button', { name: 'Register project' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const match = page.url().match(/#\/projects\/([^/]+)$/);
  expect(match).toBeTruthy();
  return { id: match[1], name };
}

async function createDiscussionUi(page, project, title) {
  await page.getByLabel('New planning room').fill(title);
  await page.getByRole('button', { name: 'Open room' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const match = page.url().match(/#\/projects\/([^/]+)\/discussions\/([^/]+)$/);
  expect(match).toBeTruthy();
  return { projectId: project.id, id: match[2], title };
}

async function addOwnerMessageUi(page, content) {
  await page.getByRole('button', { name: 'Owner note' }).click();
  await page.getByLabel('Add owner context').fill(content);
  await page.getByRole('button', { name: 'Add to discussion' }).click();
  await expect(page.locator('.message-trace').filter({ hasText: content })).toBeVisible();
}

async function importMessageUi(page, { content, displayName = 'Claude', provider = 'Anthropic', model = 'claude-test' }) {
  await page.getByRole('button', { name: 'Import agent input' }).click();
  await page.getByLabel('Contributor').fill(displayName);
  await page.getByLabel('Provider').fill(provider);
  await page.getByLabel('Model').fill(model);
  await page.getByLabel('Paste the attributed contribution').fill(content);
  await page.getByRole('button', { name: 'Add to discussion' }).click();
  await expect(page.locator('.message-trace').filter({ hasText: content })).toContainText(displayName);
}

async function capturePointUi(page, sourceText, pointText, pointType = 'REQUIREMENT') {
  const source = page.locator('.message-trace').filter({ hasText: sourceText });
  await source.getByRole('button', { name: 'Capture point' }).click();
  await source.getByLabel('Point type').selectOption(pointType);
  await source.getByLabel('Proposed planning point').fill(pointText);
  await source.getByRole('button', { name: 'Add proposal' }).click();
  await expect(page.locator('.decision-row').filter({ hasText: pointText })).toBeVisible();
}

async function decidePointUi(page, pointText, decision) {
  const row = page.locator('.decision-row').filter({ hasText: pointText });
  await row.getByRole('button', { name: decision }).click();
  await expect(row).toContainText(decision === 'Accept' ? 'ACCEPTED' : decision === 'Defer' ? 'DEFERRED' : 'REJECTED');
}

async function openPackageAtNarrowWidth(page) {
  const packageStation = page.locator('#packageStation');
  const packageTab = page.getByRole('tab', { name: /^Package/ });
  await expect(packageStation).toBeAttached();
  if (await packageStation.isHidden()) await packageTab.click();
  await expect(packageStation).toBeVisible();
}

async function fillPackageUi(page, content = completePackageContent) {
  await openPackageAtNarrowWidth(page);
  await page.getByLabel('Outcome').fill(content.outcome);
  await page.getByLabel('Included scope').fill(content.includedScope.join('\n'));
  await page.getByLabel('Exclusions').fill(content.exclusions.join('\n'));
  await page.getByLabel('Acceptance criteria').fill(content.acceptanceCriteria.join('\n'));
  await page.getByLabel('Review requirements').fill(content.reviewRequirements.join('\n'));
  await page.getByLabel('Evidence requirements').fill(content.evidenceRequirements.join('\n'));
}

async function openApprovalCheckpoint(page, { versionNumber = 1, completeSections = 6, sourceCount = 1 } = {}) {
  await openPackageAtNarrowWidth(page);
  await page.getByRole('button', { name: `Review approval of v${versionNumber}`, exact: true }).click();
  const checkpoint = page.locator('.approval-checkpoint');
  await expect(checkpoint.getByRole('heading', { name: `Approve version ${versionNumber} as Owner?`, exact: true })).toBeVisible();
  await expect(checkpoint.getByText(`v${versionNumber} · Draft`, { exact: true })).toBeVisible();
  await expect(checkpoint.getByText(`${completeSections}/6 required sections`, { exact: true })).toBeVisible();
  await expect(checkpoint.getByText(`${sourceCount} accepted point${sourceCount === 1 ? '' : 's'}`, { exact: true })).toBeVisible();
  await expect(checkpoint).toContainText('Confirmation records an append-only owner event and makes this exact version immutable.');
  await expect(checkpoint).toContainText('It marks the package ready; it does not execute or change the repository.');
  const confirm = checkpoint.getByRole('button', { name: `Confirm approval of v${versionNumber}`, exact: true });
  await expect(confirm).toBeFocused();
  return { checkpoint, confirm };
}

async function assertHappyPathLineage(page, { ownerSource, acceptedPoint }) {
  const ownerSourceNode = page.getByRole('button', {
    name: 'M1, source contribution from Owner, 1 planning point',
    exact: true,
  });
  const importedSourceNode = page.getByRole('button', {
    name: 'M2, source contribution from Claude, 2 planning points',
    exact: true,
  });
  const agentSourceNode = page.getByRole('button', {
    name: 'M3, source contribution from Test planning agent, 2 planning points',
    exact: true,
  });
  const acceptedNode = page.getByRole('button', {
    name: 'P1 sourced from M1, accepted, included in work package v1',
    exact: true,
  });
  const rejectedNode = page.getByRole('button', {
    name: 'P2 sourced from M2, rejected, not included in the current work package',
    exact: true,
  });
  const deferredNode = page.getByRole('button', {
    name: 'P3 sourced from M2, deferred, not included in the current work package',
    exact: true,
  });
  const supersededNode = page.getByRole('button', {
    name: 'P4 sourced from M3, superseded, not included in the current work package',
    exact: true,
  });
  const replacementNode = page.getByRole('button', {
    name: 'P5 sourced from M3, accepted, replacement for P4, included in work package v1',
    exact: true,
  });
  const packageNode = page.getByRole('button', {
    name: 'Work package v1, draft, includes 2 planning points',
    exact: true,
  });

  for (const node of [ownerSourceNode, importedSourceNode, agentSourceNode, acceptedNode, rejectedNode, deferredNode, supersededNode, replacementNode, packageNode]) {
    await expect(node).toBeVisible();
  }

  await ownerSourceNode.click();
  await expect(page.locator('.message-trace').filter({ hasText: ownerSource })).toBeFocused();
  await acceptedNode.click();
  await expect(page.locator('.decision-row').filter({ hasText: acceptedPoint })).toBeFocused();
  await packageNode.click();
  await expect(page.locator('[role="tab"][data-tab="package"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#packageStation')).toBeVisible();
}

async function waitForHealth(request, base, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await request.get(`${base}/api/health`, { timeout: 1_000 });
      if (response.ok()) return;
    } catch {
      // The restart boundary is expected to refuse connections briefly.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${base}.`);
}

function webSocketFrame(value, opcode = 0x1) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function consumeWebSocketFrames(buffer, socket, onText) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const extended = buffer.readBigUInt64BE(offset + 2);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized WebSocket frame in E2E bridge.');
      length = Number(extended);
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;
    const maskStart = offset + headerLength;
    const payloadStart = maskStart + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (masked) {
      const mask = buffer.subarray(maskStart, maskStart + 4);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    offset += frameLength;
    if (opcode === 0x1) onText(payload.toString('utf8'));
    if (opcode === 0x8) {
      socket.write(webSocketFrame(payload, 0x8));
      socket.end();
    }
    if (opcode === 0x9) socket.write(webSocketFrame(payload, 0xa));
  }
  return buffer.subarray(offset);
}

async function startCodexQuarantineBridge() {
  const threadId = 'e2e-shared-codex-thread';
  const sockets = new Set();
  const observedTurns = new Set();
  const turnWaiters = new Map();
  const turns = new Map();
  let turnSequence = 0;
  const markTurn = prompt => {
    observedTurns.add(prompt);
    for (const resolve of turnWaiters.get(prompt) || []) resolve();
    turnWaiters.delete(prompt);
  };
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    const clientKey = request.headers['sec-websocket-key'];
    if (!clientKey) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(`${clientKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    const send = message => socket.write(webSocketFrame(JSON.stringify(message)));
    const handleMessage = line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!Object.hasOwn(message, 'id')) return;
      if (message.method === 'initialize') send({ id: message.id, result: {} });
      if (message.method === 'thread/start' || message.method === 'thread/resume') {
        send({ id: message.id, result: { thread: { id: threadId } } });
      }
      if (message.method === 'thread/name/set') send({ id: message.id, result: {} });
      if (message.method === 'turn/start') {
        turnSequence += 1;
        const turnId = `e2e-turn-${turnSequence}`;
        const prompt = message.params?.input?.[0]?.text || '';
        turns.set(turnId, { prompt, threadId });
        send({ id: message.id, result: { turn: { id: turnId } } });
        markTurn(prompt);
        if (prompt.includes('[complete]')) {
          setTimeout(() => {
            send({
              method: 'item/completed',
              params: { threadId, turnId, item: { type: 'agentMessage', text: `Bridge completion: ${prompt}` } },
            });
            send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
          }, 20);
        }
      }
      if (message.method === 'turn/interrupt') {
        const interrupted = turns.get(message.params?.turnId);
        if (interrupted?.prompt.includes('[confirm-cleanup]')) {
          setTimeout(() => {
            send({ id: message.id, result: {} });
            send({
              method: 'turn/completed',
              params: { threadId: interrupted.threadId, turn: { id: message.params.turnId, status: 'interrupted' } },
            });
          }, 3_000);
        } else {
          setTimeout(() => send({ id: message.id, result: { cleanupConfirmed: false } }), 1_200);
        }
      }
    };
    socket.on('data', chunk => {
      pending = consumeWebSocketFrames(Buffer.concat([pending, chunk]), socket, handleMessage);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `ws://127.0.0.1:${address.port}`,
    async waitForTurn(prompt, timeout = 5_000) {
      if (observedTurns.has(prompt)) return;
      await Promise.race([
        new Promise(resolve => {
          if (!turnWaiters.has(prompt)) turnWaiters.set(prompt, new Set());
          turnWaiters.get(prompt).add(resolve);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for Codex prompt: ${prompt}`)), timeout)),
      ]);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function startDedicatedServer(request, {
  reset,
  port = 47842,
  codexUrl = 'ws://127.0.0.1:1',
  databaseName = 'e2e-restart.db',
}) {
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve('app/test/e2e/test-server.mjs')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANDAMENTO_HOST: '127.0.0.1',
      ANDAMENTO_PORT: String(port),
      ANDAMENTO_TEST_MODE: '1',
      ANDAMENTO_CODEX_URL: codexUrl,
      ANDAMENTO_E2E_DATABASE_PATH: path.resolve('var', databaseName),
      ANDAMENTO_E2E_RESET: reset ? '1' : '0',
      ANDAMENTO_E2E_REPOSITORY_ROOT: repositoryRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.once('exit', code => {
    if (code && code !== 0) child.failure = new Error(`Dedicated service exited ${code}: ${stderr}`);
  });
  await waitForHealth(request, base);
  if (child.failure) throw child.failure;
  return { base, child };
}

async function stopDedicatedServer(instance) {
  const hasExited = child => child.exitCode !== null || child.signalCode !== null;
  if (!instance?.child || hasExited(instance.child)) return;
  const exited = once(instance.child, 'exit').then(() => true, () => true);
  instance.child.kill('SIGTERM');
  const exitedGracefully = await Promise.race([
    exited,
    new Promise(resolve => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exitedGracefully && !hasExited(instance.child)) {
    instance.child.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ]);
  }
  if (!hasExited(instance.child)) throw new Error('Dedicated E2E service did not stop cleanly.');
}

test.describe.serial('Night 1 planning loop', () => {
  test('first-run-to-approved-package', async ({ page, request }) => {
    const project = await createProjectUi(page, 'Night one proving ground', { firstRun: true });
    const discussion = await createDiscussionUi(page, project, 'Bound the first implementation');
    await expect(page.getByText('Set the planning context')).toBeVisible();

    const ownerSource = 'We need a fast local planning loop with an explicit owner boundary.';
    const importedSource = 'Pushback: an agent recommendation must never become approval by agreement.';
    await addOwnerMessageUi(page, ownerSource);
    await importMessageUi(page, { content: importedSource });
    await expect(page.locator('.message-trace').filter({ hasText: importedSource })).toContainText('Anthropic · claude-test');

    await page.getByRole('button', { name: 'Test participant' }).click();
    await page.getByLabel('Ask for a planning contribution').fill('Challenge the first package boundary');
    await page.getByRole('button', { name: 'Request contribution' }).click();
    await expect(page.getByText(/Recommendation: keep the owner approval boundary explicit/)).toBeVisible();
    await expect(page.locator('.message-trace').filter({ hasText: 'Recommendation:' })).toContainText('deterministic · planning-test-v1');

    const acceptedPoint = 'All work requires one explicit owner approval event.';
    const rejectedPoint = 'Agent consensus may approve the package.';
    const deferredPoint = 'Choose a remote synchronization provider tonight.';
    const originalPoint = 'Let an agent infer the final acceptance criteria.';
    const replacementPoint = 'The owner states the final observable acceptance criteria.';
    await capturePointUi(page, ownerSource, acceptedPoint, 'REQUIREMENT');
    await capturePointUi(page, importedSource, rejectedPoint, 'RISK');
    await capturePointUi(page, importedSource, deferredPoint, 'QUESTION');
    await capturePointUi(page, 'Challenge the first package boundary', originalPoint, 'ASSUMPTION');
    await decidePointUi(page, acceptedPoint, 'Accept');
    await decidePointUi(page, rejectedPoint, 'Reject');
    await decidePointUi(page, deferredPoint, 'Defer');
    const originalRow = page.locator('.decision-row').filter({ hasText: originalPoint });
    await originalRow.getByRole('button', { name: 'Edit' }).click();
    await originalRow.getByLabel('Replacement proposal').fill(replacementPoint);
    await originalRow.getByRole('button', { name: 'Create replacement' }).click();
    await expect(page.locator('.decision-row').filter({ hasText: originalPoint })).toHaveCount(0);
    await decidePointUi(page, replacementPoint, 'Accept');

    await openPackageAtNarrowWidth(page);
    const preparePackage = page.getByRole('button', { name: 'Prepare package' });
    await expect(preparePackage.locator('svg')).toHaveCSS('width', '19px');
    await expect(preparePackage.locator('svg')).toHaveCSS('height', '19px');
    await preparePackage.click();
    const preparedScope = (await page.getByLabel('Included scope').inputValue()).split(/\r?\n/).filter(Boolean);
    expect(preparedScope).toHaveLength(2);
    expect(preparedScope).toEqual(expect.arrayContaining([acceptedPoint, replacementPoint]));
    await expect(page.getByLabel('Included scope')).not.toHaveValue(/Agent consensus/);
    await expect(page.getByLabel('Included scope')).not.toHaveValue(/remote synchronization/);
    await fillPackageUi(page, { ...completePackageContent, includedScope: [acceptedPoint, replacementPoint] });
    await assertHappyPathLineage(page, { ownerSource, acceptedPoint });
    const { confirm } = await openApprovalCheckpoint(page, { versionNumber: 1, completeSections: 6, sourceCount: 2 });
    await confirm.click();
    await expect(page.getByText('Ready for execution', { exact: true })).toBeVisible();
    await expect(page.getByText('Approval did not dispatch execution.')).toBeVisible();
    await expect(page.locator('.package-sheet')).toHaveAttribute('data-status', 'READY_FOR_EXECUTION');

    const detail = await json(await request.get(`/api/discussions/${discussion.id}`));
    expect(detail.workPackage.approvals).toHaveLength(1);
    expect(detail.workPackage.currentVersion.sourcePointIds).toHaveLength(2);
    expect(detail.workPackage.currentVersion.status).toBe('READY_FOR_EXECUTION');
    const invariants = await json(await request.get('/api/invariants'));
    expect(invariants.passed.length).toBeGreaterThan(0);
  });

  test('empty-validation-refusal', async ({ page, request }) => {
    let bootstrapFailureArmed = true;
    const failInitialBootstrap = async route => {
      if (bootstrapFailureArmed) {
        bootstrapFailureArmed = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route('**/api/bootstrap', failInitialBootstrap);
    await page.goto('/#/new-project');
    await expect(page.getByRole('heading', { name: 'Local service unavailable', exact: true })).toBeVisible();
    await expect(page.locator('.project-cell')).toContainText('Project status unknown');
    await expect(page.locator('.room-cell')).toContainText('Register unavailable');
    await expect(page.getByRole('button', { name: 'Register project', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Register another project' })).toBeDisabled();
    await page.unroute('**/api/bootstrap', failInitialBootstrap);
    await page.getByRole('button', { name: 'Try local service again', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^(Start with the work|Register another project)$/ })).toBeVisible();
    await expect(page.getByLabel('Project name')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Register another project' })).toBeEnabled();
    await expect(page.locator('.project-cell')).not.toContainText('Project status unknown');
    await expect(page.locator('#liveRegion')).toHaveText('The local project register is available again.');
    await expect(page.locator('#assertiveRegion')).toHaveText('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Register project' }).click();
    await expect(page.getByLabel('Project name')).toHaveJSProperty('validity.valueMissing', true);
    await expect(page).toHaveURL(/#\/new-project$/);

    const registeredProjects = await json(await request.get('/api/bootstrap'));
    const routedProject = registeredProjects.projects[0];
    expect(routedProject).toBeTruthy();
    let releaseHeldBootstrap;
    const heldBootstrapRelease = new Promise(resolve => { releaseHeldBootstrap = resolve; });
    let markHeldBootstrapRequested;
    const heldBootstrapRequested = new Promise(resolve => { markHeldBootstrapRequested = resolve; });
    let heldBootstrapArmed = true;
    const holdOneBootstrap = async route => {
      if (heldBootstrapArmed) {
        heldBootstrapArmed = false;
        markHeldBootstrapRequested();
        await heldBootstrapRelease;
      }
      await route.continue();
    };
    await page.route('**/api/bootstrap', holdOneBootstrap);
    try {
      await page.reload();
      await heldBootstrapRequested;
      await expect(page.locator('.loading-surface')).toBeVisible();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${routedProject.id}`);
      await expect(page.locator('.loading-surface')).toBeVisible();
      releaseHeldBootstrap();
      await expect(page.getByRole('heading', { name: routedProject.name, exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${routedProject.id}$`));
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseHeldBootstrap();
      await page.unroute('**/api/bootstrap', holdOneBootstrap);
    }
    await page.goto('/#/new-project');
    await expect(page.getByRole('heading', { name: /^(Start with the work|Register another project)$/ })).toBeVisible();

    const project = await createProjectUi(page, 'Validation paths');
    await page.getByRole('button', { name: 'Open room' }).click();
    await expect(page.getByLabel('New planning room')).toHaveJSProperty('validity.valueMissing', true);
    const discussion = await createDiscussionUi(page, project, 'Refuse incomplete authority');

    await page.getByRole('button', { name: 'Import agent input' }).click();
    await page.getByLabel('Contributor').fill('Claude reviewer');
    await page.getByLabel('Provider').fill('');
    await page.getByLabel('Paste the attributed contribution').fill('Keep this valid contribution while provider validation is corrected.');
    await page.getByRole('button', { name: 'Add to discussion' }).click();
    await expect(page.getByLabel('Provider')).toHaveJSProperty('validity.valueMissing', true);
    await expect(page.getByLabel('Contributor')).toHaveValue('Claude reviewer');
    await expect(page.getByLabel('Paste the attributed contribution')).toHaveValue('Keep this valid contribution while provider validation is corrected.');
    await page.getByLabel('Provider').fill('Anthropic');
    await page.getByRole('button', { name: 'Add to discussion' }).click();
    await expect(page.getByText('Keep this valid contribution while provider validation is corrected.')).toBeVisible();

    const source = 'Keep this valid contribution while provider validation is corrected.';
    const point = 'Incomplete packages must be refused without losing valid input.';
    const sourceDetail = await json(await request.get(`/api/discussions/${discussion.id}`));
    const sourceMessage = sourceDetail.messages.find(message => message.content === source);
    const captureEndpoint = `/api/messages/${sourceMessage.id}/planning-points`;
    let releaseCapture;
    const captureRelease = new Promise(resolve => { releaseCapture = resolve; });
    let markCaptureCommitted;
    const captureCommitted = new Promise(resolve => { markCaptureCommitted = resolve; });
    const holdCaptureResponse = async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      markCaptureCommitted();
      await captureRelease;
      await route.fulfill({ response });
    };
    await page.route(`**${captureEndpoint}`, holdCaptureResponse);
    try {
      const sourceCard = page.locator('.message-trace').filter({ hasText: source });
      await sourceCard.getByRole('button', { name: 'Capture point' }).click();
      await sourceCard.getByLabel('Proposed planning point').fill(point);
      await sourceCard.getByRole('button', { name: 'Add proposal' }).click();
      await captureCommitted;
      await expect(sourceCard.getByRole('button', { name: 'Capture point' })).toBeDisabled();
      await expect(sourceCard.getByLabel('Point type')).toBeDisabled();
      await expect(sourceCard.getByLabel('Proposed planning point')).toBeDisabled();
      await expect(sourceCard.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await expect(sourceCard.getByRole('button', { name: 'Adding…', exact: true })).toBeDisabled();
      releaseCapture();
      await expect(page.locator('.decision-row').filter({ hasText: point })).toBeVisible();
    } finally {
      releaseCapture();
      await page.unroute(`**${captureEndpoint}`, holdCaptureResponse);
    }

    const capturedDetail = await json(await request.get(`/api/discussions/${discussion.id}`));
    const capturedPoint = capturedDetail.points.find(item => item.text === point);
    const replacementPoint = 'Incomplete packages are refused while all valid owner input remains recoverable.';
    const replacementEndpoint = `/api/planning-points/${capturedPoint.id}/replacement`;
    let releaseReplacement;
    const replacementRelease = new Promise(resolve => { releaseReplacement = resolve; });
    let markReplacementCommitted;
    const replacementCommitted = new Promise(resolve => { markReplacementCommitted = resolve; });
    const holdReplacementResponse = async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      markReplacementCommitted();
      await replacementRelease;
      await route.fulfill({ response });
    };
    await page.route(`**${replacementEndpoint}`, holdReplacementResponse);
    try {
      const capturedRow = page.locator('.decision-row').filter({ hasText: point });
      await capturedRow.getByRole('button', { name: 'Edit proposal' }).click();
      await capturedRow.getByLabel('Replacement proposal').fill(replacementPoint);
      await capturedRow.getByRole('button', { name: 'Create replacement' }).click();
      await replacementCommitted;
      await expect(capturedRow.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
      await expect(capturedRow.getByRole('button', { name: 'Defer', exact: true })).toBeDisabled();
      await expect(capturedRow.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
      await expect(capturedRow.getByRole('button', { name: 'Edit proposal', exact: true })).toBeDisabled();
      await expect(capturedRow.getByLabel('Point type')).toBeDisabled();
      await expect(capturedRow.getByLabel('Replacement proposal')).toBeDisabled();
      await expect(capturedRow.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await expect(capturedRow.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
      releaseReplacement();
      await expect(page.locator('.decision-row').filter({ hasText: replacementPoint })).toBeVisible();
    } finally {
      releaseReplacement();
      await page.unroute(`**${replacementEndpoint}`, holdReplacementResponse);
    }
    await decidePointUi(page, replacementPoint, 'Accept');
    await openPackageAtNarrowWidth(page);
    await page.getByRole('button', { name: 'Prepare package' }).click();
    await page.getByLabel('Outcome').fill('Preserve this outcome through the refusal.');
    await page.getByLabel('Exclusions').fill('No execution.');
    const incompleteApproval = await openApprovalCheckpoint(page, { versionNumber: 1, completeSections: 3, sourceCount: 1 });
    await incompleteApproval.confirm.click();
    await expect(page.getByRole('alert')).toContainText('Complete every required package section before approval.');
    await expect(page.getByRole('alert')).toContainText('Missing:');
    await expect(page.getByLabel('Outcome')).toHaveValue('Preserve this outcome through the refusal.');

    await page.getByLabel('Acceptance criteria').fill('The refusal remains visible.');
    await page.getByLabel('Review requirements').fill('Independent review.');
    await page.getByLabel('Evidence requirements').fill('Playwright output.');
    const completeApproval = await openApprovalCheckpoint(page, { versionNumber: 1, completeSections: 6, sourceCount: 1 });
    await completeApproval.confirm.click();
    await expect(page.getByText('Ready for execution', { exact: true })).toBeVisible();
    expect(discussion.id).toBeTruthy();
  });

  test('partial-provider-failure-retry', async ({ page, request, browser }) => {
    const workspace = await createWorkspaceApi(request, 'Failure retry');
    await page.goto(routeFor(workspace));
    await page.getByRole('button', { name: 'Test participant' }).click();
    const failedPrompt = '[fail-once] challenge the approval seam';
    await page.getByLabel('Ask for a planning contribution').fill(failedPrompt);
    await page.getByRole('button', { name: 'Request contribution' }).click();
    const failedRun = page.locator('.run-trace').filter({ hasText: failedPrompt });
    await expect(failedRun).toHaveAttribute('data-status', 'FAILED');
    await expect(failedRun).toContainText('Prompt preserved:');

    const failedDetail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    const failedRunRecord = failedDetail.runs.find(run => run.prompt === failedPrompt);
    expect(failedRunRecord?.status).toBe('FAILED');
    await page.setViewportSize({ width: 1024, height: 768 });
    const retryButton = failedRun.getByRole('button', { name: 'Retry', exact: true });
    await expect(retryButton).toBeVisible();
    await expect(retryButton.locator('svg')).toHaveCSS('width', '19px');
    await expect(retryButton.locator('svg')).toHaveCSS('height', '19px');
    const retryActor = await browser.newContext();
    const retryUrl = `${new URL(page.url()).origin}/api/agent-runs/${failedRunRecord.id}/retry`;
    const firstRetryKey = key('concurrent-retry-first-actor');
    const secondRetryKey = key('concurrent-retry-second-actor');
    expect(firstRetryKey).not.toBe(secondRetryKey);
    let concurrentRetries;
    try {
      concurrentRetries = await Promise.all([
        page.context().request.post(retryUrl, {
          data: { idempotencyKey: firstRetryKey },
        }).then(json),
        retryActor.request.post(retryUrl, {
          data: { idempotencyKey: secondRetryKey },
        }).then(json),
      ]);
    } finally {
      await retryActor.close();
    }
    expect(concurrentRetries[0].run.id).toBe(concurrentRetries[1].run.id);
    const retryRunId = concurrentRetries[0].run.id;
    await expect.poll(async () => {
      const current = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
      return current.runs.find(run => run.id === retryRunId)?.status;
    }).toBe('COMPLETED');
    await page.reload();
    await expect(page.getByText(/Recommendation: keep the owner approval boundary explicit for “challenge the approval seam”/)).toBeVisible();
    await expect(page.locator('.message-trace').filter({ hasText: 'challenge the approval seam' })).toHaveCount(1);

    const retriedDetail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    const retryChildren = retriedDetail.runs.filter(run => run.retryOfRunId === failedRunRecord.id);
    expect(retryChildren).toHaveLength(1);
    expect(retryChildren[0].id).toBe(retryRunId);
    expect(retriedDetail.messages.filter(message => message.agentRunId === retryRunId)).toHaveLength(1);
    expect(retriedDetail.messages.filter(message => message.agentRunId === failedRunRecord.id)).toHaveLength(0);

    await page.getByRole('button', { name: 'Test participant' }).click();
    const cancelledPrompt = '[slow] cancellation retains this prompt';
    await page.getByLabel('Ask for a planning contribution').fill(cancelledPrompt);
    await page.getByRole('button', { name: 'Request contribution' }).click();
    const cancelledRun = page.locator('.run-trace').filter({ hasText: cancelledPrompt });
    await expect(cancelledRun).toHaveAttribute('data-status', 'RUNNING');
    const cancelContribution = cancelledRun.getByRole('button', { name: 'Cancel contribution' });
    await expect(cancelContribution.locator('svg')).toHaveCSS('width', '19px');
    await expect(cancelContribution.locator('svg')).toHaveCSS('height', '19px');
    await cancelContribution.click();
    await expect(cancelledRun).toHaveAttribute('data-status', 'INTERRUPTED');
    await expect(cancelledRun).toContainText('Prompt preserved:');
    await cancelledRun.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/Recommendation: keep the owner approval boundary explicit for “cancellation retains this prompt”/)).toBeVisible();

    await page.getByRole('button', { name: 'Test participant' }).click();
    const malformedPrompt = '[malformed] provider returned unusable planning data';
    await page.getByLabel('Ask for a planning contribution').fill(malformedPrompt);
    await page.getByRole('button', { name: 'Request contribution' }).click();
    const malformedRun = page.locator('.run-trace').filter({ hasText: malformedPrompt });
    await expect(malformedRun).toHaveAttribute('data-status', 'FAILED');
    await expect(malformedRun).toContainText('unusable contribution');
    await expect(page.locator('.message-trace').filter({ hasText: 'provider returned unusable planning data' })).toHaveCount(0);

    const detail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(detail.runs.filter(run => run.status === 'COMPLETED')).toHaveLength(2);
    expect(detail.messages.filter(message => message.contributionType === 'AGENT')).toHaveLength(2);
    expect(detail.runs.filter(run => run.retryOfRunId)).toHaveLength(2);
    expect(detail.runs.filter(run => run.errorCode === 'MALFORMED_CONTRIBUTION')).toHaveLength(1);
  });

  test('refresh-leave-return', async ({ page, request }) => {
    const workspace = await createWorkspaceApi(request, 'Persistence');
    const navigationWorkspace = await createWorkspaceApi(request, 'Navigation target');
    const routeTargetWorkspace = await createWorkspaceApi(request, 'Route target');
    await seedDraftPackage(request, workspace.discussion.id, { pointText: 'Persist the exact draft across navigation.' });
    await page.goto(routeFor(workspace));
    await fillPackageUi(page, {
      ...completePackageContent,
      outcome: 'This saved draft survives refresh, leave, and return.',
      includedScope: ['Persist the exact draft across navigation.'],
    });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('button', { name: 'Draft saved' })).toBeVisible();

    const savedDespiteRefreshFailure = 'This package save remains durable when its display refresh is interrupted.';
    const detailEndpoint = `/api/discussions/${workspace.discussion.id}`;
    let markPackageRefreshFailure;
    const packageRefreshFailed = new Promise(resolve => { markPackageRefreshFailure = resolve; });
    let packageRefreshFailureArmed = true;
    const failOnePackageRefresh = async route => {
      if (route.request().method() === 'GET' && packageRefreshFailureArmed) {
        packageRefreshFailureArmed = false;
        markPackageRefreshFailure();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${detailEndpoint}`, failOnePackageRefresh);
    await page.getByLabel('Outcome').fill(savedDespiteRefreshFailure);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await packageRefreshFailed;
    await page.unroute(`**${detailEndpoint}`, failOnePackageRefresh);
    await expect(page.getByRole('alert')).toContainText('action was saved locally, but the latest view could not refresh');
    await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();
    await expect(page.locator('.local-status')).toHaveText('Action needs attention');
    const packageAfterFailedRefresh = await json(await request.get(detailEndpoint));
    expect(packageAfterFailedRefresh.workPackage.currentVersion.content.outcome).toBe(savedDespiteRefreshFailure);
    await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.local-status')).toHaveText('Local service ready');

    const decisionSource = await addMessageApi(request, workspace.discussion.id, 'A committed owner decision must not be reported as a failed mutation.');
    const decisionPoint = await capturePointApi(request, decisionSource.message.id, 'Keep committed owner decisions durable across display refresh failure.');
    await page.reload();
    const decisionRow = page.locator(`#point-${decisionPoint.id}`);
    await expect(decisionRow).toBeVisible();
    const decisionEndpoint = `/api/planning-points/${decisionPoint.id}/disposition`;
    let markDecisionCommitted;
    const decisionCommitted = new Promise(resolve => { markDecisionCommitted = resolve; });
    let releaseDecisionResponse;
    const decisionResponseRelease = new Promise(resolve => { releaseDecisionResponse = resolve; });
    const holdDecisionResponse = async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      markDecisionCommitted();
      await decisionResponseRelease;
      await route.fulfill({ response });
    };
    let markDecisionRefreshFailure;
    const decisionRefreshFailed = new Promise(resolve => { markDecisionRefreshFailure = resolve; });
    let decisionRefreshFailureArmed = true;
    const failOneDecisionRefresh = async route => {
      if (route.request().method() === 'GET' && decisionRefreshFailureArmed) {
        decisionRefreshFailureArmed = false;
        markDecisionRefreshFailure();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${decisionEndpoint}`, holdDecisionResponse);
    await page.route(`**${detailEndpoint}`, failOneDecisionRefresh);
    try {
      await decisionRow.getByRole('button', { name: 'Accept', exact: true }).click();
      await decisionCommitted;
      await expect(decisionRow.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
      await expect(decisionRow.getByRole('button', { name: 'Defer', exact: true })).toBeDisabled();
      await expect(decisionRow.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
      await expect(decisionRow.getByRole('button', { name: 'Edit proposal', exact: true })).toBeDisabled();
      await expect(decisionRow.getByText('Recording owner decision…', { exact: true })).toBeVisible();
      releaseDecisionResponse();
      await decisionRefreshFailed;
    } finally {
      releaseDecisionResponse();
      await page.unroute(`**${decisionEndpoint}`, holdDecisionResponse);
      await page.unroute(`**${detailEndpoint}`, failOneDecisionRefresh);
    }
    await expect(page.getByRole('alert')).toContainText('action was saved locally, but the latest view could not refresh');
    await expect(page.locator('.local-status')).toHaveText('Action needs attention');
    const decisionAfterFailedRefresh = await json(await request.get(detailEndpoint));
    expect(decisionAfterFailedRefresh.points.find(point => point.id === decisionPoint.id).disposition).toBe('ACCEPTED');
    await expect(decisionRow).toHaveAttribute('data-state', 'ACCEPTED', { timeout: 5_000 });
    await expect(decisionRow.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.local-status')).toHaveText('Local service ready');

    const detachedDecisionSource = await addMessageApi(request, workspace.discussion.id, 'A decision refresh may finish after its room is left.');
    const detachedDecisionPoint = await capturePointApi(request, detachedDecisionSource.message.id, 'Do not apply a completed refresh to the room that replaced it.');
    await page.reload();
    const detachedDecisionRow = page.locator(`#point-${detachedDecisionPoint.id}`);
    await expect(detachedDecisionRow).toBeVisible();
    let markDetachedRefreshCaptured;
    const detachedRefreshCaptured = new Promise(resolve => { markDetachedRefreshCaptured = resolve; });
    let releaseDetachedRefresh;
    const detachedRefreshRelease = new Promise(resolve => { releaseDetachedRefresh = resolve; });
    let detachedRefreshHeld = false;
    const holdDetachedDecisionRefresh = async route => {
      if (route.request().method() === 'GET' && !detachedRefreshHeld) {
        detachedRefreshHeld = true;
        const response = await route.fetch();
        markDetachedRefreshCaptured();
        await detachedRefreshRelease;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    };
    await page.route(`**${detailEndpoint}`, holdDetachedDecisionRefresh);
    try {
      await detachedDecisionRow.getByRole('button', { name: 'Accept', exact: true }).click();
      await detachedRefreshCaptured;
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${navigationWorkspace.project.id}`);
      await expect(page.getByRole('heading', { name: navigationWorkspace.project.name, exact: true })).toBeVisible();
      releaseDetachedRefresh();
      await expect(page).toHaveURL(new RegExp(`#\/projects\/${navigationWorkspace.project.id}$`));
      await expect(page.getByRole('heading', { name: navigationWorkspace.project.name, exact: true })).toBeVisible();
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseDetachedRefresh();
      await page.unroute(`**${detailEndpoint}`, holdDetachedDecisionRefresh);
    }
    const detachedDecisionAfterLeave = await json(await request.get(detailEndpoint));
    expect(detachedDecisionAfterLeave.points.find(point => point.id === detachedDecisionPoint.id).disposition).toBe('ACCEPTED');
    await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${workspace.project.id}/discussions/${workspace.discussion.id}`);
    await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();

    const timedOutDecisionSource = await addMessageApi(request, workspace.discussion.id, 'A timed-out owner decision response must reconcile against durable state.');
    const timedOutDecisionPoint = await capturePointApi(request, timedOutDecisionSource.message.id, 'Clear an unconfirmed decision alert after an authoritative read.');
    await page.reload();
    const timedOutDecisionRow = page.locator(`#point-${timedOutDecisionPoint.id}`);
    await expect(timedOutDecisionRow).toBeVisible();
    const timedOutDecisionEndpoint = `/api/planning-points/${timedOutDecisionPoint.id}/disposition`;
    let markTimedOutDecisionCommitted;
    const timedOutDecisionCommitted = new Promise(resolve => { markTimedOutDecisionCommitted = resolve; });
    let releaseTimedOutDecisionResponse;
    const timedOutDecisionResponseRelease = new Promise(resolve => { releaseTimedOutDecisionResponse = resolve; });
    const holdTimedOutDecisionResponse = async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      markTimedOutDecisionCommitted();
      await timedOutDecisionResponseRelease;
      await route.fulfill({ response }).catch(() => {});
    };
    let releaseTimedOutDecisionRead;
    const timedOutDecisionReadRelease = new Promise(resolve => { releaseTimedOutDecisionRead = resolve; });
    const holdTimedOutDecisionRead = async route => {
      await timedOutDecisionReadRelease;
      await route.continue();
    };
    await page.route(`**${timedOutDecisionEndpoint}`, holdTimedOutDecisionResponse);
    await page.route(`**${detailEndpoint}`, holdTimedOutDecisionRead);
    try {
      await timedOutDecisionRow.getByRole('button', { name: 'Accept', exact: true }).click();
      await timedOutDecisionCommitted;
      await expect(page.getByRole('alert')).toContainText('local service did not respond within 6 seconds', { timeout: 9_000 });
      await expect(page.getByRole('button', { name: 'Reconcile saved state', exact: true })).toBeVisible();
      releaseTimedOutDecisionResponse();
      releaseTimedOutDecisionRead();
      await expect(timedOutDecisionRow).toHaveAttribute('data-state', 'ACCEPTED', { timeout: 5_000 });
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.locator('#liveRegion')).toHaveText('Latest saved state reconciled.');
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseTimedOutDecisionResponse();
      releaseTimedOutDecisionRead();
      await page.unroute(`**${timedOutDecisionEndpoint}`, holdTimedOutDecisionResponse);
      await page.unroute(`**${detailEndpoint}`, holdTimedOutDecisionRead);
    }
    await openPackageAtNarrowWidth(page);

    await page.getByLabel('Outcome').fill('This undurable edit should be discarded.');
    await page.getByRole('button', { name: 'Discard edits' }).click();
    await expect(page.getByLabel('Outcome')).toHaveValue(savedDespiteRefreshFailure);
    const composer = page.locator('.composer');
    await composer.getByLabel('Add owner context').fill('This cancelled composer text must not become durable.');
    await composer.getByRole('button', { name: 'Cancel' }).click();
    await expect(composer.getByLabel('Add owner context')).toHaveValue('');

    await page.reload();
    await openPackageAtNarrowWidth(page);
    await expect(page.getByLabel('Outcome')).toHaveValue(savedDespiteRefreshFailure);
    await page.goto(`/#/projects/${workspace.project.id}`);
    await expect(page.getByRole('heading', { name: 'Persistence project' })).toBeVisible();
    await page.getByRole('link', { name: 'Persistence room', exact: true }).click();
    await openPackageAtNarrowWidth(page);
    await expect(page.getByLabel('Outcome')).toHaveValue(savedDespiteRefreshFailure);

    const navigationRegisterEndpoint = `/api/projects/${navigationWorkspace.project.id}/discussions`;
    let markFirstRegisterRequest;
    const firstRegisterRequest = new Promise(resolve => { markFirstRegisterRequest = resolve; });
    let releaseFirstRegisterRequest;
    const firstRegisterRelease = new Promise(resolve => { releaseFirstRegisterRequest = resolve; });
    let registerAttempt = 0;
    const failNavigationRegister = async route => {
      registerAttempt += 1;
      if (registerAttempt === 1) {
        markFirstRegisterRequest();
        await firstRegisterRelease;
      }
      await route.abort('failed');
    };
    await page.route(`**${navigationRegisterEndpoint}`, failNavigationRegister);
    try {
      await page.getByLabel('Current project').selectOption(navigationWorkspace.project.id);
      await firstRegisterRequest;
      await expect(page.getByLabel('Current project')).toHaveValue(navigationWorkspace.project.id);
      await expect(page.locator('.room-cell')).toContainText('Project register');
      await expect(page.locator('.room-cell')).not.toContainText('Persistence room');

      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${routeTargetWorkspace.project.id}/discussions/${routeTargetWorkspace.discussion.id}`);
      await expect(page.getByRole('heading', { name: routeTargetWorkspace.discussion.title, exact: true })).toBeVisible();
      const routeTargetDraft = 'A stale project-register failure must not eject this newer room or clear its draft.';
      await page.getByLabel('Add owner context').fill(routeTargetDraft);
      releaseFirstRegisterRequest();
      await expect(page).toHaveURL(new RegExp(`#\/projects\/${routeTargetWorkspace.project.id}\/discussions\/${routeTargetWorkspace.discussion.id}$`));
      await expect(page.getByRole('heading', { name: routeTargetWorkspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue(routeTargetDraft);

      await page.getByLabel('Current project').selectOption(navigationWorkspace.project.id);
      await expect(page.getByRole('heading', { name: navigationWorkspace.project.name, exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Failed to fetch');
      await expect(page.getByRole('heading', { name: 'Planning room list unavailable', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open room', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Try room list again', exact: true })).toBeVisible();
      await expect(page.locator('.room-register .room-row')).toHaveCount(0);
      await expect(page.getByRole('link', { name: workspace.discussion.title, exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: routeTargetWorkspace.discussion.title, exact: true })).toHaveCount(0);

      const failNavigationRoom = async route => route.abort('failed');
      await page.route(`**/api/discussions/${navigationWorkspace.discussion.id}`, failNavigationRoom);
      try {
        await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${navigationWorkspace.project.id}/discussions/${navigationWorkspace.discussion.id}`);
        await expect(page.getByRole('heading', { name: navigationWorkspace.project.name, exact: true })).toBeVisible();
        await expect(page.getByRole('alert')).toContainText('room list could not be loaded');
        await expect(page.getByRole('heading', { name: 'Planning room list unavailable', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open room', exact: true })).toBeDisabled();
        await expect(page.locator('.room-register .room-row')).toHaveCount(0);
        await expect(page.getByRole('link', { name: workspace.discussion.title, exact: true })).toHaveCount(0);
      } finally {
        await page.unroute(`**/api/discussions/${navigationWorkspace.discussion.id}`, failNavigationRoom);
      }
    } finally {
      releaseFirstRegisterRequest();
      await page.unroute(`**${navigationRegisterEndpoint}`, failNavigationRegister);
    }
    await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${workspace.project.id}/discussions/${workspace.discussion.id}`);
    await openPackageAtNarrowWidth(page);
    await expect(page.getByLabel('Outcome')).toHaveValue(savedDespiteRefreshFailure);

    const delayedMessageEndpoint = `/api/discussions/${workspace.discussion.id}/messages`;
    const delayedMessageText = 'This committed message returns after leaving and re-entering the room.';
    const newerReturnedDraft = 'This newer draft must survive the earlier response after return.';
    let markMessageCommitted;
    const messageCommitted = new Promise(resolve => { markMessageCommitted = resolve; });
    let releaseMessageResponse;
    const messageResponseRelease = new Promise(resolve => { releaseMessageResponse = resolve; });
    const holdMessageResponse = async route => {
      const serverResponse = await route.fetch();
      expect(serverResponse.ok()).toBe(true);
      markMessageCommitted();
      await messageResponseRelease;
      await route.fulfill({ response: serverResponse });
    };
    await page.route(`**${delayedMessageEndpoint}`, holdMessageResponse);
    try {
      const delayedMessageResponse = page.waitForResponse(response => (
        response.request().method() === 'POST' && response.url().endsWith(delayedMessageEndpoint)
      ));
      await page.getByLabel('Add owner context').fill(delayedMessageText);
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await messageCommitted;
      await expect(page.locator('.composer').getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${workspace.project.id}`);
      await expect(page.getByRole('heading', { name: 'Persistence project', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Persistence room', exact: true }).click();
      const returnedComposer = page.getByLabel('Add owner context');
      await returnedComposer.fill(newerReturnedDraft);
      await returnedComposer.blur();
      await returnedComposer.focus();
      releaseMessageResponse();
      expect((await delayedMessageResponse).ok()).toBe(true);
      await expect(page.getByText(delayedMessageText, { exact: true })).toBeVisible();
      await expect(returnedComposer).toHaveValue(newerReturnedDraft);
      await expect(page.getByRole('button', { name: 'Add to discussion', exact: true })).toBeEnabled();
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseMessageResponse();
      await page.unroute(`**${delayedMessageEndpoint}`, holdMessageResponse);
    }

    let markOldPollCaptured;
    const oldPollCaptured = new Promise(resolve => { markOldPollCaptured = resolve; });
    let releaseOldPoll;
    const oldPollRelease = new Promise(resolve => { releaseOldPoll = resolve; });
    let oldPollHeld = false;
    const intermediatePollMessage = 'Intermediate context captured only by the older poll response.';
    const holdOneOldPoll = async route => {
      if (route.request().method() === 'GET' && !oldPollHeld) {
        oldPollHeld = true;
        await addMessageApi(request, workspace.discussion.id, intermediatePollMessage);
        const response = await route.fetch();
        markOldPollCaptured();
        await oldPollRelease;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    };
    await page.route(`**${detailEndpoint}`, holdOneOldPoll);
    try {
      await oldPollCaptured;
      const messageAfterOlderPoll = 'A newer mutation refresh must win over an older in-flight poll.';
      await page.getByLabel('Add owner context').fill(messageAfterOlderPoll);
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await expect(page.getByText(messageAfterOlderPoll, { exact: true })).toBeVisible();
      await page.evaluate(text => {
        window.__stalePollRollbackObserved = false;
        window.__stalePollObserver = new MutationObserver(() => {
          if (!document.body.innerText.includes(text)) window.__stalePollRollbackObserved = true;
        });
        window.__stalePollObserver.observe(document.body, { childList: true, subtree: true });
      }, messageAfterOlderPoll);
      releaseOldPoll();
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => window.__stalePollRollbackObserved)).toBe(false);
      await page.evaluate(() => window.__stalePollObserver?.disconnect());
      await expect(page.getByText(messageAfterOlderPoll, { exact: true })).toBeVisible();
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseOldPoll();
      await page.unroute(`**${detailEndpoint}`, holdOneOldPoll);
    }

    let markOldRouteResponseCaptured;
    const oldRouteResponseCaptured = new Promise(resolve => { markOldRouteResponseCaptured = resolve; });
    let releaseOldRouteResponse;
    const oldRouteResponseRelease = new Promise(resolve => { releaseOldRouteResponse = resolve; });
    let oldRouteResponseHeld = false;
    const intermediateRouteMessage = 'Intermediate context captured only by the old A-route response.';
    const holdOldRouteResponse = async route => {
      if (route.request().method() === 'GET' && !oldRouteResponseHeld) {
        oldRouteResponseHeld = true;
        await addMessageApi(request, workspace.discussion.id, intermediateRouteMessage);
        const response = await route.fetch();
        markOldRouteResponseCaptured();
        await oldRouteResponseRelease;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    };
    await page.route(`**${detailEndpoint}`, holdOldRouteResponse);
    try {
      await oldRouteResponseCaptured;
      const messageAfterRouteABA = 'This durable context was added after the stale route response snapshot.';
      await addMessageApi(request, workspace.discussion.id, messageAfterRouteABA);
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${navigationWorkspace.project.id}/discussions/${navigationWorkspace.discussion.id}`);
      await expect(page.getByRole('heading', { name: navigationWorkspace.discussion.title, exact: true })).toBeVisible();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${workspace.project.id}/discussions/${workspace.discussion.id}`);
      await expect(page.getByText(messageAfterRouteABA, { exact: true })).toBeVisible();
      const abaDraft = 'This new A-route draft must survive the old A-route response.';
      await page.getByLabel('Add owner context').fill(abaDraft);
      await page.evaluate(text => {
        window.__routeABARollbackObserved = false;
        window.__routeABAObserver = new MutationObserver(() => {
          if (!document.body.innerText.includes(text)) window.__routeABARollbackObserved = true;
        });
        window.__routeABAObserver.observe(document.body, { childList: true, subtree: true });
      }, messageAfterRouteABA);
      releaseOldRouteResponse();
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => window.__routeABARollbackObserved)).toBe(false);
      await page.evaluate(() => window.__routeABAObserver?.disconnect());
      await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByText(messageAfterRouteABA, { exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue(abaDraft);
    } finally {
      releaseOldRouteResponse();
      await page.unroute(`**${detailEndpoint}`, holdOldRouteResponse);
    }

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    let markMessageRefreshFailure;
    const messageRefreshFailed = new Promise(resolve => { markMessageRefreshFailure = resolve; });
    let messageRefreshFailureArmed = true;
    const failOneMessageRefresh = async route => {
      if (route.request().method() === 'GET' && messageRefreshFailureArmed) {
        messageRefreshFailureArmed = false;
        markMessageRefreshFailure();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    const messageSavedWithoutRefresh = 'This message stays durable when the post-commit display refresh fails.';
    await page.route(`**${detailEndpoint}`, failOneMessageRefresh);
    await page.getByLabel('Add owner context').fill(messageSavedWithoutRefresh);
    await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
    await messageRefreshFailed;
    await page.unroute(`**${detailEndpoint}`, failOneMessageRefresh);
    await expect(page.getByRole('alert')).toContainText('action was saved locally, but the latest view could not refresh');
    await expect(page.getByLabel('Add owner context')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Add to discussion', exact: true })).toBeEnabled();
    await expect(page.locator('.local-status')).toHaveText('Action needs attention');
    const messageAfterFailedRefresh = await json(await request.get(detailEndpoint));
    expect(messageAfterFailedRefresh.messages.filter(message => message.content === messageSavedWithoutRefresh)).toHaveLength(1);
    await expect(page.getByText(messageSavedWithoutRefresh, { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.local-status')).toHaveText('Local service ready');

    await page.getByRole('button', { name: 'Register another project' }).click();
    const delayedProjectName = 'Delayed project registration';
    await page.getByLabel('Project name').fill(delayedProjectName);
    await page.getByLabel('Local Git repository').fill(await fixtureRepository('delayed-project-registration'));
    let markProjectCommitted;
    const projectCommitted = new Promise(resolve => { markProjectCommitted = resolve; });
    let releaseProjectResponse;
    const projectResponseRelease = new Promise(resolve => { releaseProjectResponse = resolve; });
    const holdProjectResponse = async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const serverResponse = await route.fetch();
      expect(serverResponse.ok()).toBe(true);
      markProjectCommitted();
      await projectResponseRelease;
      await route.fulfill({ response: serverResponse });
    };
    await page.route('**/api/projects', holdProjectResponse);
    try {
      const projectResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST' && response.url().endsWith('/api/projects')
      ));
      await page.getByRole('button', { name: 'Register project', exact: true }).click();
      await projectCommitted;
      await expect(page.getByLabel('Project name')).toBeDisabled();
      await expect(page.getByLabel('Local Git repository')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Return to current project', exact: true })).toBeDisabled();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${navigationWorkspace.project.id}`);
      await expect(page.getByRole('heading', { name: 'Navigation target project', exact: true })).toBeVisible();
      releaseProjectResponse();
      expect((await projectResponsePromise).ok()).toBe(true);
      await expect(page).toHaveURL(new RegExp(`#\/projects\/${navigationWorkspace.project.id}$`));
      await expect(page.getByRole('heading', { name: 'Navigation target project', exact: true })).toBeVisible();
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
      await expect(page.getByLabel('Current project').locator('option', { hasText: delayedProjectName })).toHaveCount(1);
    } finally {
      releaseProjectResponse();
      await page.unroute('**/api/projects', holdProjectResponse);
    }
    const projectsAfterDelayedRegistration = await json(await request.get('/api/bootstrap'));
    expect(projectsAfterDelayedRegistration.projects.filter(project => project.name === delayedProjectName)).toHaveLength(1);

    const bootstrapRecoveryProjectName = 'Project survives bootstrap refresh failure';
    await page.getByRole('button', { name: 'Register another project' }).click();
    await expect(page.getByLabel('Project name')).toHaveValue('');
    await expect(page.getByLabel('Local Git repository')).toHaveValue('');
    await page.getByLabel('Project name').fill(bootstrapRecoveryProjectName);
    await page.getByLabel('Local Git repository').fill(await fixtureRepository('bootstrap-refresh-recovery'));
    let markBootstrapRefreshFailure;
    const bootstrapRefreshFailed = new Promise(resolve => { markBootstrapRefreshFailure = resolve; });
    let bootstrapRefreshFailureArmed = true;
    const failOneBootstrapRefresh = async route => {
      if (route.request().method() === 'GET' && bootstrapRefreshFailureArmed) {
        bootstrapRefreshFailureArmed = false;
        markBootstrapRefreshFailure();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route('**/api/bootstrap', failOneBootstrapRefresh);
    await page.getByRole('button', { name: 'Register project', exact: true }).click();
    await bootstrapRefreshFailed;
    await page.unroute('**/api/bootstrap', failOneBootstrapRefresh);
    await expect(page.getByRole('heading', { name: bootstrapRecoveryProjectName, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register project', exact: true })).toHaveCount(0);
    await expect(page.locator('.local-status')).toHaveText('Local service ready');
    const projectsAfterBootstrapFailure = await json(await request.get('/api/bootstrap'));
    expect(projectsAfterBootstrapFailure.projects.filter(project => project.name === bootstrapRecoveryProjectName)).toHaveLength(1);
    await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${navigationWorkspace.project.id}`);
    await expect(page.getByRole('heading', { name: navigationWorkspace.project.name, exact: true })).toBeVisible();

    const delayedRoomTitle = 'Delayed room stays with its captured project';
    await page.getByLabel('New planning room').fill(delayedRoomTitle);
    const roomEndpoint = `/api/projects/${navigationWorkspace.project.id}/discussions`;
    let markRoomCommitted;
    const roomCommitted = new Promise(resolve => { markRoomCommitted = resolve; });
    let releaseRoomResponse;
    const roomResponseRelease = new Promise(resolve => { releaseRoomResponse = resolve; });
    const holdRoomResponse = async route => {
      const serverResponse = await route.fetch();
      expect(serverResponse.ok()).toBe(true);
      markRoomCommitted();
      await roomResponseRelease;
      await route.fulfill({ response: serverResponse });
    };
    await page.route(`**${roomEndpoint}`, holdRoomResponse);
    try {
      const roomResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST' && response.url().endsWith(roomEndpoint)
      ));
      await page.getByRole('button', { name: 'Open room', exact: true }).click();
      await roomCommitted;
      await expect(page.getByLabel('New planning room')).toBeDisabled();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${workspace.project.id}`);
      await expect(page.getByRole('heading', { name: 'Persistence project', exact: true })).toBeVisible();
      releaseRoomResponse();
      expect((await roomResponsePromise).ok()).toBe(true);
      await expect(page).toHaveURL(new RegExp(`#\/projects\/${workspace.project.id}$`));
      await expect(page.getByRole('heading', { name: 'Persistence project', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open room', exact: true })).toBeEnabled();
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseRoomResponse();
      await page.unroute(`**${roomEndpoint}`, holdRoomResponse);
    }
    const capturedProjectRooms = await json(await request.get(roomEndpoint));
    expect(capturedProjectRooms.discussions.filter(discussion => discussion.title === delayedRoomTitle)).toHaveLength(1);

    let server = await startDedicatedServer(request, { reset: true });
    try {
      const restartWorkspace = await createWorkspaceApi(request, 'Service restart', { base: server.base });
      await addMessageApi(request, restartWorkspace.discussion.id, 'Durable context before the process restart.', { base: server.base });
      let restartRoute = routeFor(restartWorkspace, server.base);
      await page.goto(restartRoute);
      await expect(page.getByText('Durable context before the process restart.')).toBeVisible();
      await json(await request.post(`${server.base}/api/discussions/${restartWorkspace.discussion.id}/agent-runs`, {
        data: { adapter: 'deterministic', prompt: '[slow] interrupted contribution resumes explicitly', idempotencyKey: key('restart-run') },
      }));
      await stopDedicatedServer(server);
      server = await startDedicatedServer(request, { reset: false, port: 47843 });
      restartRoute = routeFor(restartWorkspace, server.base);
      const restartedDetail = await json(await request.get(`${server.base}/api/discussions/${restartWorkspace.discussion.id}`));
      expect(restartedDetail.runs.find(run => run.prompt.includes('interrupted contribution'))?.status).toBe('INTERRUPTED');
      await page.goto(restartRoute);
      await expect(page.getByText('Durable context before the process restart.')).toBeVisible();
      const interruptedRun = page.locator('.run-trace').filter({ hasText: '[slow] interrupted contribution resumes explicitly' });
      await expect(interruptedRun).toHaveAttribute('data-status', 'INTERRUPTED');
      await interruptedRun.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByText(/Recommendation: keep the owner approval boundary explicit for “interrupted contribution resumes explicitly”/)).toBeVisible();
    } finally {
      await stopDedicatedServer(server);
    }
  });

  test('stale-refresh-alert-suppression', async ({ page, request }) => {
    const workspace = await createWorkspaceApi(request, 'Stale refresh');
    const target = await createWorkspaceApi(request, 'Stale refresh target');
    const detailEndpoint = `/api/discussions/${workspace.discussion.id}`;
    const messageEndpoint = `${detailEndpoint}/messages`;
    await page.goto(routeFor(workspace));

    let releaseHeldReads;
    const heldReadRelease = new Promise(resolve => { releaseHeldReads = resolve; });
    let markReadHeld;
    const readHeld = new Promise(resolve => { markReadHeld = resolve; });
    const holdEveryRoomRead = async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      markReadHeld();
      await heldReadRelease;
      await route.abort('failed');
    };
    const refuseOneMessage = async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.abort('failed');
    };
    await page.route(`**${detailEndpoint}`, holdEveryRoomRead);
    await page.route(`**${messageEndpoint}`, refuseOneMessage);
    try {
      await page.getByLabel('Add owner context').fill('An unconfirmed contribution arms the explicit reconcile action.');
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      const reconcile = page.getByRole('button', { name: 'Reconcile saved state', exact: true });
      await expect(reconcile).toBeVisible();
      await reconcile.click();
      await readHeld;

      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${target.project.id}/discussions/${target.discussion.id}`);
      await expect(page.getByRole('heading', { name: target.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      releaseHeldReads();
      await page.waitForTimeout(700);
      await expect(page.getByRole('heading', { name: target.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
      await expect(page.locator('#assertiveRegion')).not.toContainText('Failed to fetch');
    } finally {
      releaseHeldReads();
      await page.unroute(`**${messageEndpoint}`, refuseOneMessage);
      await page.unroute(`**${detailEndpoint}`, holdEveryRoomRead);
    }

    let releaseSecondStaleRead;
    const secondStaleReadRelease = new Promise(resolve => { releaseSecondStaleRead = resolve; });
    let markSecondStaleReadHeld;
    const secondStaleReadHeld = new Promise(resolve => { markSecondStaleReadHeld = resolve; });
    let secondStaleReadArmed = true;
    const holdOneRoomRead = async route => {
      if (route.request().method() === 'GET' && secondStaleReadArmed) {
        secondStaleReadArmed = false;
        markSecondStaleReadHeld();
        await secondStaleReadRelease;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${workspace.project.id}/discussions/${workspace.discussion.id}`);
    await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
    await page.route(`**${detailEndpoint}`, holdOneRoomRead);
    try {
      await secondStaleReadHeld;
      const durableAfterStaleRead = 'This durable context proves a newer read already succeeded.';
      await page.getByLabel('Add owner context').fill(durableAfterStaleRead);
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await expect(page.getByText(durableAfterStaleRead, { exact: true })).toBeVisible();
      releaseSecondStaleRead();
      await page.waitForTimeout(700);
      await expect(page.getByText(durableAfterStaleRead, { exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      releaseSecondStaleRead();
      await page.unroute(`**${detailEndpoint}`, holdOneRoomRead);
    }
  });

  test('unconfirmed-input-recovery', async ({ page, request }) => {
    const workspace = await createWorkspaceApi(request, 'Unconfirmed recovery');
    const siblingRoom = await createDiscussionApi(request, workspace.project.id, 'Unconfirmed recovery sibling room');
    const elsewhere = await createWorkspaceApi(request, 'Unconfirmed recovery elsewhere');
    const packageWorkspace = await createWorkspaceApi(request, 'Unconfirmed package recovery');
    const packageVersion = await seedDraftPackage(request, packageWorkspace.discussion.id, {
      pointText: 'Reconcile a package save whose receipt is lost.',
    });
    const roomHash = `#/projects/${workspace.project.id}/discussions/${workspace.discussion.id}`;
    const siblingHash = `#/projects/${workspace.project.id}/discussions/${siblingRoom.id}`;
    const elsewhereHash = `#/projects/${elsewhere.project.id}/discussions/${elsewhere.discussion.id}`;
    const packageHash = `#/projects/${packageWorkspace.project.id}/discussions/${packageWorkspace.discussion.id}`;
    const packageEndpoint = `/api/work-package-versions/${packageVersion.id}`;
    const goToHash = async hash => page.evaluate(target => { window.location.hash = target; }, hash);
    await page.goto(routeFor(workspace));

    const messageEndpoint = `/api/discussions/${workspace.discussion.id}/messages`;
    const unsentMessage = 'This owner context never reached the local service.';
    const appendedMessage = `${unsentMessage} It also keeps the sentence typed after the refusal.`;
    const messageKeys = [];
    let refuseMessageArmed = true;
    const refuseOneMessage = async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      messageKeys.push(route.request().postDataJSON().idempotencyKey);
      if (refuseMessageArmed) {
        refuseMessageArmed = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${messageEndpoint}`, refuseOneMessage);
    try {
      await page.getByLabel('Add owner context').fill(unsentMessage);
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add to discussion', exact: true })).toBeEnabled();
      expect(messageKeys).toHaveLength(1);

      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue('');
      await goToHash(elsewhereHash);
      await expect(page.getByRole('heading', { name: elsewhere.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue('');

      await goToHash(roomHash);
      await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue(unsentMessage);
      await expect(page.locator('.feedback[data-tone]')).toContainText('Nothing was submitted');

      // Editing after the refusal must survive, and a second leave must not lose the input.
      await page.getByLabel('Add owner context').fill(appendedMessage);
      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await goToHash(roomHash);
      await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue(appendedMessage);

      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await expect(page.getByLabel('Add owner context')).toHaveValue('');
      await expect(page.getByText(appendedMessage, { exact: true })).toBeVisible();
    } finally {
      await page.unroute(`**${messageEndpoint}`, refuseOneMessage);
    }
    const recoveredMessages = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(recoveredMessages.messages.filter(message => message.content === appendedMessage)).toHaveLength(1);
    expect(recoveredMessages.messages.filter(message => message.content === unsentMessage)).toHaveLength(0);

    // A mutation that committed before its receipt was lost must NOT be offered back as unsent input.
    const durableMessage = 'This owner context committed before its receipt was lost.';
    const durableMessageKeys = [];
    let loseMessageReceiptArmed = true;
    let markMessageReceiptLost;
    const messageReceiptLost = new Promise(resolve => { markMessageReceiptLost = resolve; });
    const loseOneMessageReceipt = async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      durableMessageKeys.push(route.request().postDataJSON().idempotencyKey);
      if (loseMessageReceiptArmed) {
        loseMessageReceiptArmed = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markMessageReceiptLost();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${messageEndpoint}`, loseOneMessageReceipt);
    try {
      await page.getByLabel('Add owner context').fill(durableMessage);
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await messageReceiptLost;
      await expect(page.getByRole('button', { name: 'Add to discussion', exact: true })).toBeEnabled();

      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await goToHash(roomHash);
      await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByText(durableMessage, { exact: true })).toBeVisible();
      await expect(page.locator('.feedback[data-tone]')).toContainText('already saved before its receipt was lost');
      await expect(page.getByLabel('Add owner context')).toHaveValue('');
      expect(durableMessageKeys).toHaveLength(1);
    } finally {
      await page.unroute(`**${messageEndpoint}`, loseOneMessageReceipt);
    }
    const durableMessages = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(durableMessages.messages.filter(message => message.content === durableMessage)).toHaveLength(1);

    const captureSource = await addMessageApi(request, workspace.discussion.id, 'Source contribution for unconfirmed capture recovery.');
    const captureEndpoint = `/api/messages/${captureSource.message.id}/planning-points`;
    const capturedText = 'This proposed point survives leaving after an unconfirmed capture.';
    const captureKeys = [];
    let refuseCaptureArmed = true;
    const refuseOneCapture = async route => {
      captureKeys.push(route.request().postDataJSON().idempotencyKey);
      if (refuseCaptureArmed) {
        refuseCaptureArmed = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${captureEndpoint}`, refuseOneCapture);
    try {
      const sourceCard = page.locator('.message-trace').filter({ hasText: 'Source contribution for unconfirmed capture recovery.' });
      await expect(sourceCard).toBeVisible();
      await sourceCard.getByRole('button', { name: 'Capture point' }).click();
      await sourceCard.getByLabel('Proposed planning point').fill(capturedText);
      await sourceCard.getByRole('button', { name: 'Add proposal' }).click();
      await expect(sourceCard.getByRole('button', { name: 'Add proposal' })).toBeEnabled();
      expect(captureKeys).toHaveLength(1);

      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Proposed planning point')).toHaveCount(0);
      await goToHash(roomHash);
      const returnedSourceCard = page.locator('.message-trace').filter({ hasText: 'Source contribution for unconfirmed capture recovery.' });
      await expect(returnedSourceCard.getByLabel('Proposed planning point')).toHaveValue(capturedText);

      await returnedSourceCard.getByRole('button', { name: 'Add proposal' }).click();
      await expect(page.locator('.decision-row').filter({ hasText: capturedText })).toBeVisible();
      expect(captureKeys).toHaveLength(2);
      expect(captureKeys[0]).toBe(captureKeys[1]);
    } finally {
      await page.unroute(`**${captureEndpoint}`, refuseOneCapture);
    }
    const recoveredPoints = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(recoveredPoints.points.filter(point => point.text === capturedText)).toHaveLength(1);

    const capturedPoint = recoveredPoints.points.find(point => point.text === capturedText);
    const replacementEndpoint = `/api/planning-points/${capturedPoint.id}/replacement`;
    const replacementText = 'This replacement proposal survives leaving after an unconfirmed edit.';
    const replacementKeys = [];
    let refuseReplacementArmed = true;
    const refuseOneReplacement = async route => {
      replacementKeys.push(route.request().postDataJSON().idempotencyKey);
      if (refuseReplacementArmed) {
        refuseReplacementArmed = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${replacementEndpoint}`, refuseOneReplacement);
    try {
      const capturedRow = page.locator(`#point-${capturedPoint.id}`);
      await capturedRow.getByRole('button', { name: 'Edit proposal' }).click();
      await capturedRow.getByLabel('Replacement proposal').fill(replacementText);
      await capturedRow.getByRole('button', { name: 'Create replacement' }).click();
      await expect(capturedRow.getByRole('button', { name: 'Create replacement' })).toBeEnabled();
      expect(replacementKeys).toHaveLength(1);

      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Replacement proposal')).toHaveCount(0);
      await goToHash(roomHash);
      const returnedRow = page.locator(`#point-${capturedPoint.id}`);
      await expect(returnedRow.getByLabel('Replacement proposal')).toHaveValue(replacementText);

      await returnedRow.getByRole('button', { name: 'Create replacement' }).click();
      await expect(page.locator('.decision-row').filter({ hasText: replacementText })).toBeVisible();
      expect(replacementKeys).toHaveLength(2);
      expect(replacementKeys[0]).toBe(replacementKeys[1]);
    } finally {
      await page.unroute(`**${replacementEndpoint}`, refuseOneReplacement);
    }
    const recoveredReplacements = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(recoveredReplacements.points.filter(point => point.text === replacementText)).toHaveLength(1);

    await goToHash(packageHash);
    await expect(page.getByRole('heading', { name: packageWorkspace.discussion.title, exact: true })).toBeVisible();

    const durableOutcome = 'This package save is durable even though its receipt is lost.';
    let markPackageReceiptLost;
    const packageReceiptLost = new Promise(resolve => { markPackageReceiptLost = resolve; });
    let losePackageReceiptArmed = true;
    const loseOnePackageReceipt = async route => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      if (losePackageReceiptArmed) {
        losePackageReceiptArmed = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markPackageReceiptLost();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${packageEndpoint}`, loseOnePackageReceipt);
    try {
      await openPackageAtNarrowWidth(page);
      await page.getByLabel('Outcome').fill(durableOutcome);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await packageReceiptLost;
      await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible({ timeout: 9_000 });
      await expect(page.getByLabel('Outcome')).toHaveValue(durableOutcome);
      await expect(page.locator('.feedback[data-tone]')).toContainText('already saved in the current draft of v1');
      await expect(page.getByText('This package changed in another view while you were editing.')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Resolve conflicts to save' })).toHaveCount(0);
      await expect(page.locator('.local-status')).toHaveText('Local service ready');
    } finally {
      await page.unroute(`**${packageEndpoint}`, loseOnePackageReceipt);
    }
    const reconciledPackage = await json(await request.get(`/api/discussions/${packageWorkspace.discussion.id}`));
    expect(reconciledPackage.workPackage.versions.filter(version => version.status === 'DRAFT')).toHaveLength(1);
    expect(reconciledPackage.workPackage.currentVersion.content.outcome).toBe(durableOutcome);

    const heldOutcome = 'This unsaved package outcome returns after leaving an unconfirmed save.';
    const refuseOnePackageSave = async route => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      await route.abort('failed');
    };
    await page.route(`**${packageEndpoint}`, refuseOnePackageSave);
    try {
      await page.getByLabel('Outcome').fill(heldOutcome);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
      await goToHash(elsewhereHash);
      await expect(page.getByRole('heading', { name: elsewhere.discussion.title, exact: true })).toBeVisible();
      await goToHash(packageHash);
      await expect(page.getByRole('heading', { name: packageWorkspace.discussion.title, exact: true })).toBeVisible();
      await openPackageAtNarrowWidth(page);
      await expect(page.getByLabel('Outcome')).toHaveValue(heldOutcome);
      await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
    } finally {
      await page.unroute(`**${packageEndpoint}`, refuseOnePackageSave);
    }
    const unsavedPackage = await json(await request.get(`/api/discussions/${packageWorkspace.discussion.id}`));
    expect(unsavedPackage.workPackage.currentVersion.content.outcome).toBe(durableOutcome);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();
    const savedPackage = await json(await request.get(`/api/discussions/${packageWorkspace.discussion.id}`));
    expect(savedPackage.workPackage.currentVersion.content.outcome).toBe(heldOutcome);

    const roomEndpoint = `/api/projects/${workspace.project.id}/discussions`;
    const heldRoomTitle = 'This room title returns after an unconfirmed open';
    const roomKeys = [];
    let refuseRoomArmed = true;
    const refuseOneRoom = async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      roomKeys.push(route.request().postDataJSON().idempotencyKey);
      if (refuseRoomArmed) {
        refuseRoomArmed = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${roomEndpoint}`, refuseOneRoom);
    try {
      await goToHash(`#/projects/${workspace.project.id}`);
      await expect(page.getByRole('heading', { name: workspace.project.name, exact: true })).toBeVisible();
      await page.getByLabel('New planning room').fill(heldRoomTitle);
      await page.getByRole('button', { name: 'Open room', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open room', exact: true })).toBeEnabled();
      expect(roomKeys).toHaveLength(1);

      await goToHash(`#/projects/${elsewhere.project.id}`);
      await expect(page.getByRole('heading', { name: elsewhere.project.name, exact: true })).toBeVisible();
      await expect(page.getByLabel('New planning room')).toHaveValue('');
      await goToHash(`#/projects/${workspace.project.id}`);
      await expect(page.getByRole('heading', { name: workspace.project.name, exact: true })).toBeVisible();
      await expect(page.getByLabel('New planning room')).toHaveValue(heldRoomTitle);

      await page.getByRole('button', { name: 'Open room', exact: true }).click();
      await expect(page.getByRole('heading', { name: heldRoomTitle, exact: true })).toBeVisible();
      expect(roomKeys).toHaveLength(2);
      expect(roomKeys[0]).toBe(roomKeys[1]);
    } finally {
      await page.unroute(`**${roomEndpoint}`, refuseOneRoom);
    }
    const recoveredRooms = await json(await request.get(roomEndpoint));
    expect(recoveredRooms.discussions.filter(discussion => discussion.title === heldRoomTitle)).toHaveLength(1);

    // A replacement whose point was decided elsewhere must refuse honestly, not announce a phantom restore.
    const decidedSource = await addMessageApi(request, workspace.discussion.id, 'Source contribution for a point decided during an unconfirmed edit.');
    const decidedPoint = await capturePointApi(request, decidedSource.message.id, 'This proposal is decided while its replacement is unconfirmed.');
    const decidedReplacementEndpoint = `/api/planning-points/${decidedPoint.id}/replacement`;
    const refuseDecidedReplacement = async route => route.abort('failed');
    await goToHash(roomHash);
    await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
    await page.route(`**${decidedReplacementEndpoint}`, refuseDecidedReplacement);
    try {
      const decidedRow = page.locator(`#point-${decidedPoint.id}`);
      await expect(decidedRow).toBeVisible();
      await decidedRow.getByRole('button', { name: 'Edit proposal' }).click();
      await decidedRow.getByLabel('Replacement proposal').fill('This replacement never reaches the local service.');
      await decidedRow.getByRole('button', { name: 'Create replacement' }).click();
      await expect(decidedRow.getByRole('button', { name: 'Create replacement' })).toBeEnabled();

      await dispositionPointApi(request, decidedPoint, 'ACCEPTED');
      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await goToHash(roomHash);
      await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.locator('.feedback[data-tone]')).toContainText('has since been decided');
      await expect(page.getByLabel('Replacement proposal')).toHaveCount(0);
      await expect(page.locator(`#point-${decidedPoint.id}`)).toHaveAttribute('data-state', 'ACCEPTED');
    } finally {
      await page.unroute(`**${decidedReplacementEndpoint}`, refuseDecidedReplacement);
    }

    // The owner decided on 2026-08-15 that unsent input survives a full reload.
    const survivesReload = 'This held recovery record survives a full page reload.';
    const refuseReloadMessage = async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.abort('failed');
    };
    await page.route(`**${messageEndpoint}`, refuseReloadMessage);
    try {
      await page.getByLabel('Add owner context').fill(survivesReload);
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add to discussion', exact: true })).toBeEnabled();
      await goToHash(siblingHash);
      await expect(page.getByRole('heading', { name: siblingRoom.title, exact: true })).toBeVisible();
      await goToHash(roomHash);
      await expect(page.getByLabel('Add owner context')).toHaveValue(survivesReload);

      // A full reload drops every in-memory record, so anything that returns
      // here came from the durable service-side draft.
      await page.reload();
      await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
      await expect(page.getByLabel('Add owner context')).toHaveValue(survivesReload);
      await expect(page.locator('.feedback[data-tone]')).toContainText('Nothing was submitted');
      const heldAfterReload = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
      expect(heldAfterReload.messages.filter(message => message.content === survivesReload)).toHaveLength(0);
    } finally {
      await page.unroute(`**${messageEndpoint}`, refuseReloadMessage);
    }

    // The draft is retired by the same transaction that made the input durable,
    // so a reload right after submitting is clean rather than offering the
    // entry back or reporting a stale reconciliation.
    await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
    await expect(page.getByText(survivesReload, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: workspace.discussion.title, exact: true })).toBeVisible();
    await expect(page.getByLabel('Add owner context')).toHaveValue('');
    await expect(page.locator('.feedback[data-tone]')).toHaveCount(0);
    const settled = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(settled.messages.filter(message => message.content === survivesReload)).toHaveLength(1);
    const remainingDrafts = await json(await request.get(
      `/api/drafts?projectId=${workspace.project.id}&discussionId=${workspace.discussion.id}`,
    ));
    assert.equal(remainingDrafts.drafts.length, 0);
  });

  test('authority-immutability-idempotency', async ({ page, request }) => {
    const workspace = await createWorkspaceApi(request, 'Authority');
    const messageKey = key('fixed-message');
    const firstMessage = await addMessageApi(request, workspace.discussion.id, 'One mutation receipt protects this source.', { idempotencyKey: messageKey });
    const replayedMessage = await addMessageApi(request, workspace.discussion.id, 'One mutation receipt protects this source.', { idempotencyKey: messageKey });
    expect(replayedMessage.message.id).toBe(firstMessage.message.id);
    expect(replayedMessage.replayed).toBe(true);

    const point = await capturePointApi(request, firstMessage.message.id, 'Only the owner may authorize this package.');
    const participant = (await json(await request.post('/api/test/participants', {
      data: { kind: 'AGENT', displayName: 'Untrusted review agent', provider: 'test', model: 'authority-test' },
    }))).participant;
    const denied = await request.post(`/api/planning-points/${point.id}/disposition`, {
      data: { disposition: 'ACCEPTED', expectedVersion: point.rowVersion, idempotencyKey: key('forbidden-disposition') },
      headers: { 'x-andamento-actor-id': participant.id },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.message).toContain('Only the owner');

    const accepted = await dispositionPointApi(request, point);
    let version = await preparePackageApi(request, workspace.discussion.id);
    version = await updatePackageApi(request, version);

    await page.goto(routeFor(workspace));
    const committedAfterLostResponse = 'Receipt recovery preserves this committed owner message.';
    const changedPayloadProbe = 'Receipt recovery eventually sends this changed canonical payload.';
    const abandonedPayload = 'Receipt recovery rotates this same payload after explicit clear.';
    const messageEndpoint = `/api/discussions/${workspace.discussion.id}/messages`;
    const messageRequests = [];
    const contentAttempts = new Map();
    const recoverLostMessageResponse = async route => {
      const payload = route.request().postDataJSON();
      messageRequests.push({ content: payload.content, idempotencyKey: payload.idempotencyKey });
      const attempt = (contentAttempts.get(payload.content) || 0) + 1;
      contentAttempts.set(payload.content, attempt);
      if (payload.content === committedAfterLostResponse && attempt < 3) {
        const serverResponse = await route.fetch();
        expect(serverResponse.ok()).toBe(true);
        await route.abort('failed');
        return;
      }
      if ((payload.content === changedPayloadProbe || payload.content === abandonedPayload) && attempt === 1) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(`**${messageEndpoint}`, recoverLostMessageResponse);
    try {
      await page.getByRole('button', { name: 'Owner note', exact: true }).click();
      const composer = page.getByLabel('Add owner context');
      const submitMessage = page.getByRole('button', { name: 'Add to discussion', exact: true });
      await composer.fill(committedAfterLostResponse);
      await submitMessage.click();
      await expect.poll(() => messageRequests.length).toBe(1);
      await expect(page.getByRole('alert')).toContainText('Failed to fetch');
      await expect(composer).toHaveValue(committedAfterLostResponse);
      await expect(submitMessage).toBeEnabled();

      await submitMessage.click();
      await expect.poll(() => messageRequests.length).toBe(2);
      await expect(page.getByRole('alert')).toContainText('Failed to fetch');
      await expect(composer).toHaveValue(committedAfterLostResponse);
      expect(messageRequests[1].idempotencyKey).toBe(messageRequests[0].idempotencyKey);

      await composer.fill(changedPayloadProbe);
      await submitMessage.click();
      await expect.poll(() => messageRequests.length).toBe(3);
      await expect(page.getByRole('alert')).toContainText('Failed to fetch');
      await expect(composer).toHaveValue(changedPayloadProbe);
      expect(messageRequests[2].idempotencyKey).not.toBe(messageRequests[0].idempotencyKey);

      await composer.fill(committedAfterLostResponse);
      const recoveredAResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && response.url().endsWith(messageEndpoint)
        && response.request().postDataJSON()?.content === committedAfterLostResponse
      ));
      await submitMessage.click();
      await expect.poll(() => messageRequests.length).toBe(4);
      const recoveredAResponse = await recoveredAResponsePromise;
      expect(recoveredAResponse.ok()).toBe(true);
      expect(messageRequests[3].idempotencyKey).toBe(messageRequests[0].idempotencyKey);
      await expect(page.locator('.message-trace').filter({ hasText: committedAfterLostResponse })).toHaveCount(1);

      await composer.fill(changedPayloadProbe);
      const changedResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && response.url().endsWith(messageEndpoint)
        && response.request().postDataJSON()?.content === changedPayloadProbe
      ));
      await submitMessage.click();
      const changedResponse = await changedResponsePromise;
      expect(changedResponse.ok()).toBe(true);
      expect(changedResponse.status()).toBe(201);
      expect(messageRequests[4].idempotencyKey).not.toBe(messageRequests[2].idempotencyKey);
      await expect(page.locator('.message-trace').filter({ hasText: changedPayloadProbe })).toHaveCount(1);

      await composer.fill(abandonedPayload);
      await submitMessage.click();
      await expect.poll(() => messageRequests.length).toBe(6);
      await expect(page.getByRole('alert')).toContainText('Failed to fetch');
      await expect(composer).toHaveValue(abandonedPayload);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await composer.fill(abandonedPayload);
      const afterAbandonResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && response.url().endsWith(messageEndpoint)
        && response.request().postDataJSON()?.content === abandonedPayload
      ));
      await submitMessage.click();
      const afterAbandonResponse = await afterAbandonResponsePromise;
      expect(afterAbandonResponse.ok()).toBe(true);
      expect(messageRequests[6].idempotencyKey).not.toBe(messageRequests[5].idempotencyKey);
      await expect(page.locator('.message-trace').filter({ hasText: abandonedPayload })).toHaveCount(1);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(messageRequests).toHaveLength(7);
    } finally {
      await page.unroute(`**${messageEndpoint}`, recoverLostMessageResponse);
    }

    const recoveredMessages = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(recoveredMessages.messages.filter(item => item.content === committedAfterLostResponse)).toHaveLength(1);
    expect(recoveredMessages.messages.filter(item => item.content === changedPayloadProbe)).toHaveLength(1);
    expect(recoveredMessages.messages.filter(item => item.content === abandonedPayload)).toHaveLength(1);

    const delayedOwnerMessage = 'This successful pending owner message must not erase newer composer work.';
    const newerImportedDraft = 'This newer imported draft remains editable after the earlier response arrives.';
    let markDelayedMessageCommitted;
    const delayedMessageCommitted = new Promise(resolve => { markDelayedMessageCommitted = resolve; });
    let releaseDelayedMessage;
    const delayedMessageRelease = new Promise(resolve => { releaseDelayedMessage = resolve; });
    const holdSuccessfulMessageResponse = async route => {
      const serverResponse = await route.fetch();
      expect(serverResponse.ok()).toBe(true);
      markDelayedMessageCommitted();
      await delayedMessageRelease;
      await route.fulfill({ response: serverResponse });
    };
    await page.route(`**${messageEndpoint}`, holdSuccessfulMessageResponse);
    try {
      await page.getByRole('button', { name: 'Owner note', exact: true }).click();
      await page.getByLabel('Add owner context').fill(delayedOwnerMessage);
      const delayedResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && response.url().endsWith(messageEndpoint)
        && response.request().postDataJSON()?.content === delayedOwnerMessage
      ));
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await delayedMessageCommitted;
      await page.getByRole('button', { name: 'Import agent input', exact: true }).click();
      await page.getByLabel('Contributor').fill('Newer Claude draft');
      await page.getByLabel('Provider').fill('Anthropic');
      await page.getByLabel('Model').fill('claude-newer-draft');
      await page.getByLabel('Paste the attributed contribution').fill(newerImportedDraft);
      releaseDelayedMessage();
      const delayedResponse = await delayedResponsePromise;
      expect(delayedResponse.ok()).toBe(true);
      await expect(page.getByRole('button', { name: 'Import agent input', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Contributor')).toHaveValue('Newer Claude draft');
      await expect(page.getByLabel('Provider')).toHaveValue('Anthropic');
      await expect(page.getByLabel('Model')).toHaveValue('claude-newer-draft');
      await expect(page.getByLabel('Paste the attributed contribution')).toHaveValue(newerImportedDraft);
    } finally {
      releaseDelayedMessage();
      await page.unroute(`**${messageEndpoint}`, holdSuccessfulMessageResponse);
    }
    await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
    await expect(page.locator('.message-trace').filter({ hasText: delayedOwnerMessage })).toHaveCount(1);
    await expect(page.locator('.message-trace').filter({ hasText: newerImportedDraft })).toHaveCount(1);
    const authorityApproval = await openApprovalCheckpoint(page, { versionNumber: 1, completeSections: 6, sourceCount: 1 });
    const approvalRequestPromise = page.waitForRequest(candidate => (
      candidate.method() === 'POST'
      && candidate.url().endsWith(`/api/work-package-versions/${version.id}/approve`)
    ));
    await authorityApproval.confirm.click();
    const approvalRequest = await approvalRequestPromise;
    const approvalPayload = approvalRequest.postDataJSON();
    await expect(page.getByText('Ready for execution', { exact: true })).toBeVisible();
    const approvedDetail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    const approvedVersion = approvedDetail.workPackage.currentVersion;
    const recordedApproval = approvedDetail.workPackage.approvals[0];
    const replayedApproval = await json(await request.post(`/api/work-package-versions/${version.id}/approve`, {
      data: approvalPayload,
    }));
    expect(replayedApproval.approval.id).toBe(recordedApproval.id);
    expect(replayedApproval.replayed).toBe(true);

    const immutableEdit = await request.put(`/api/work-package-versions/${version.id}`, {
      data: { content: { ...completePackageContent, outcome: 'Illicit rewrite' }, expectedVersion: approvedVersion.rowVersion, idempotencyKey: key('immutable-edit') },
    });
    expect(immutableEdit.status()).toBe(409);
    expect((await immutableEdit.json()).error.message).toContain('immutable');

    await openPackageAtNarrowWidth(page);
    await expect(page.getByText('Ready for execution', { exact: true })).toBeVisible();
    await expect(page.getByText(completePackageContent.outcome)).toBeVisible();
    await page.getByRole('button', { name: 'Create version 2 draft' }).click();
    await expect(page.locator('#packageStation')).toContainText('Version 2 · Draft');
    await page.getByRole('button', { name: 'v1 · Approved' }).click();
    await expect(page.getByText(completePackageContent.outcome)).toBeVisible();
    await expect(page.getByText('Version 1 is immutable.')).toBeVisible();

    const detail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
    expect(detail.messages).toHaveLength(6);
    expect(detail.workPackage.approvals).toHaveLength(1);
    expect(detail.workPackage.versions).toHaveLength(2);
    expect(detail.workPackage.versions.find(item => item.versionNumber === 1).content.outcome).toBe(completePackageContent.outcome);
    expect(accepted.disposition).toBe('ACCEPTED');
  });

  test('stale-concurrent-actors', async ({ page, request, browser }) => {
    const workspace = await createWorkspaceApi(request, 'Concurrency');
    await seedDraftPackage(request, workspace.discussion.id, { pointText: 'Concurrent views must never overwrite silently.' });
    await page.goto(routeFor(workspace));
    await openPackageAtNarrowWidth(page);

    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const secondPage = await secondContext.newPage();
    try {
      await secondPage.goto(routeFor(workspace, new URL(page.url()).origin));
      await openPackageAtNarrowWidth(secondPage);
      await page.getByLabel('Outcome').fill('Saved by the first owner view.');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page.getByRole('button', { name: 'Draft saved' })).toBeVisible();

      await secondPage.getByLabel('Outcome').fill('Preserved text from the stale second view.');
      await secondPage.getByRole('button', { name: 'Save draft' }).click();
      await expect(secondPage.locator('.feedback[data-tone="warning"]')).toContainText('This package changed in another view');
      await expect(secondPage.getByLabel('Outcome')).toHaveValue('Preserved text from the stale second view.');
      await secondPage.getByRole('button', { name: 'Compare and reapply changes' }).click();
      const outcomeCollision = secondPage.locator('.field-collision').filter({ hasText: 'Outcome changed in both views' });
      await expect(outcomeCollision).toContainText('Preserved text from the stale second view.');
      await expect(outcomeCollision).toContainText('Saved by the first owner view.');
      await outcomeCollision.getByRole('button', { name: 'Keep yours' }).click();
      await secondPage.getByRole('button', { name: 'Save draft' }).click();
      await expect(secondPage.getByRole('button', { name: 'Draft saved' })).toBeVisible();

      await Promise.all([
        request.post(`/api/discussions/${workspace.discussion.id}/agent-runs`, {
          data: { adapter: 'deterministic', prompt: 'Concurrent recommendation alpha', idempotencyKey: key('agent-alpha') },
        }).then(json),
        request.post(`/api/discussions/${workspace.discussion.id}/agent-runs`, {
          data: { adapter: 'deterministic', prompt: 'Concurrent recommendation beta', idempotencyKey: key('agent-beta') },
        }).then(json),
      ]);
      await page.reload();
      await expect(page.getByText(/Concurrent recommendation alpha/)).toBeVisible();
      await expect(page.getByText(/Concurrent recommendation beta/)).toBeVisible();
      await expect(page.locator('.message-trace').filter({ hasText: 'Concurrent recommendation alpha' })).toContainText('Test planning agent');
      await expect(page.locator('.message-trace').filter({ hasText: 'Concurrent recommendation beta' })).toContainText('Test planning agent');

      const detail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
      expect(detail.workPackage.currentVersion.content.outcome).toBe('Preserved text from the stale second view.');
      expect(detail.messages.filter(item => item.contributionType === 'AGENT')).toHaveLength(2);

      const approvedConcurrentOutcome = 'Approved by the second owner view without the first view edits.';
      await fillPackageUi(secondPage, {
        ...completePackageContent,
        outcome: approvedConcurrentOutcome,
        includedScope: ['Concurrent views must never overwrite silently.'],
      });
      await secondPage.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(secondPage.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();
      await page.reload();
      await openPackageAtNarrowWidth(page);
      await expect(page.getByLabel('Outcome')).toHaveValue(approvedConcurrentOutcome);
      const heldOutcome = 'UNSAVED OWNER TEXT THAT MUST SURVIVE CONCURRENT APPROVAL';
      await page.getByLabel('Outcome').fill(heldOutcome);

      const concurrentApproval = await openApprovalCheckpoint(secondPage, {
        versionNumber: 1,
        completeSections: 6,
        sourceCount: 1,
      });
      await concurrentApproval.confirm.click();
      await expect(secondPage.getByText('Ready for execution', { exact: true })).toBeVisible();
      const heldEdits = page.locator('.package-orphan');
      await expect(heldEdits).toContainText('Your unsaved edits were not part of approved v1.');
      await expect(heldEdits).toContainText('Held fields: Outcome.');
      await expect(page.getByText(heldOutcome, { exact: true })).toHaveCount(0);
      const carryHeldEdits = heldEdits.getByRole('button', { name: 'Create v2 and carry edits', exact: true });
      await expect(carryHeldEdits).toBeFocused();
      await carryHeldEdits.click();
      await expect(page.locator('#packageStation')).toContainText('Version 2 · Draft');
      await expect(page.getByLabel('Outcome')).toHaveValue(heldOutcome);
      await expect(page.locator('.feedback[data-tone="warning"]')).toContainText('held edits are applied to the current draft');
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();

      const recoveredDetail = await json(await request.get(`/api/discussions/${workspace.discussion.id}`));
      expect(recoveredDetail.workPackage.versions.find(item => item.versionNumber === 1).content.outcome)
        .toBe(approvedConcurrentOutcome);
      expect(recoveredDetail.workPackage.versions.find(item => item.versionNumber === 2).content.outcome)
        .toBe(heldOutcome);

      const advancedWorkspace = await createWorkspaceApi(request, 'Approval and version advance');
      let advancedV1 = await seedDraftPackage(request, advancedWorkspace.discussion.id, {
        pointText: 'Held edits must also survive when another actor already creates v2.',
      });
      advancedV1 = await updatePackageApi(request, advancedV1, {
        ...completePackageContent,
        outcome: 'Durable v1 before concurrent approval and version advance.',
        includedScope: ['Held edits must also survive when another actor already creates v2.'],
      });
      await page.reload();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${advancedWorkspace.project.id}/discussions/${advancedWorkspace.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      const advancedHeldOutcome = 'HELD TEXT CARRIED INTO AN ALREADY-CREATED V2';
      await page.getByLabel('Outcome').fill(advancedHeldOutcome);
      const advancedHeldEdits = page.locator('.package-orphan');
      const heldAdvancedSaveEndpoint = `/api/work-package-versions/${advancedV1.id}`;
      let markAdvancedSaveObserved;
      const advancedSaveObserved = new Promise(resolve => { markAdvancedSaveObserved = resolve; });
      let releaseAdvancedPrecommitSave;
      const advancedPrecommitSaveRelease = new Promise(resolve => { releaseAdvancedPrecommitSave = resolve; });
      const holdAdvancedPrecommitSave = async route => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        markAdvancedSaveObserved();
        await advancedPrecommitSaveRelease;
        await route.continue();
      };
      let approvedAdvancedV1;
      let externallyCreatedV2;
      let externallyEditedV2;
      await page.route(`**${heldAdvancedSaveEndpoint}`, holdAdvancedPrecommitSave);
      try {
        const advancedSaveResponse = page.waitForResponse(response => (
          response.request().method() === 'PUT' && response.url().endsWith(heldAdvancedSaveEndpoint)
        ));
        await page.getByRole('button', { name: 'Save draft', exact: true }).click();
        await advancedSaveObserved;
        approvedAdvancedV1 = await json(await request.post(`/api/work-package-versions/${advancedV1.id}/approve`, {
          data: { expectedVersion: advancedV1.rowVersion, idempotencyKey: key('advanced-v1-approval') },
        }));
        externallyCreatedV2 = await json(await request.post(`/api/work-package-versions/${approvedAdvancedV1.version.id}/next-version`, {
          data: { idempotencyKey: key('advanced-v2-create') },
        }));
        externallyEditedV2 = await updatePackageApi(request, externallyCreatedV2.version, {
          ...completePackageContent,
          outcome: 'Another actor changed v2 before the held edits were carried.',
          includedScope: ['Held edits must also survive when another actor already creates v2.'],
        });
        await expect(advancedHeldEdits).toContainText('Your unsaved edits were not part of approved v1.');
        await expect(advancedHeldEdits.getByRole('button', { name: 'Compare and carry edits into v2', exact: true })).toBeDisabled();
        await expect(advancedHeldEdits.getByRole('button', { name: 'Discard held edits', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'v2 · Draft', exact: true })).toBeDisabled();
        releaseAdvancedPrecommitSave();
        expect((await advancedSaveResponse).status()).toBe(409);
        await expect(advancedHeldEdits.getByRole('button', { name: 'Compare and carry edits into v2', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'v2 · Draft', exact: true })).toBeEnabled();
        await expect(page.locator('#packageStation')).toContainText('Version 2 · Draft');
      } finally {
        releaseAdvancedPrecommitSave();
        await page.unroute(`**${heldAdvancedSaveEndpoint}`, holdAdvancedPrecommitSave);
      }
      await advancedHeldEdits.getByRole('button', { name: 'Compare and carry edits into v2', exact: true }).click();
      const advancedOutcomeCollision = page.locator('.field-collision').filter({ hasText: 'Outcome changed in both views' });
      await expect(advancedOutcomeCollision).toContainText(advancedHeldOutcome);
      await expect(advancedOutcomeCollision).toContainText('Another actor changed v2 before the held edits were carried.');
      const advancedKeepYours = advancedOutcomeCollision.getByRole('button', { name: 'Keep yours', exact: true });
      await expect(advancedKeepYours).toBeFocused();
      await advancedKeepYours.click();
      await expect(page.getByLabel('Outcome')).toHaveValue(advancedHeldOutcome);
      await expect(page.getByLabel('Outcome')).toBeFocused();
      const advancedSaveEndpoint = `/api/work-package-versions/${externallyEditedV2.id}`;
      let markAdvancedSaveCommitted;
      const advancedSaveCommitted = new Promise(resolve => { markAdvancedSaveCommitted = resolve; });
      let releaseAdvancedSave;
      const advancedSaveRelease = new Promise(resolve => { releaseAdvancedSave = resolve; });
      const holdAdvancedSave = async route => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markAdvancedSaveCommitted();
        await advancedSaveRelease;
        await route.fulfill({ response });
      };
      await page.route(`**${advancedSaveEndpoint}`, holdAdvancedSave);
      try {
        await page.getByRole('button', { name: 'Save draft', exact: true }).click();
        await advancedSaveCommitted;
        await expect(page.getByRole('button', { name: 'Use latest saved version', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'v2 · Draft', exact: true })).toBeDisabled();
        releaseAdvancedSave();
        await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();
      } finally {
        releaseAdvancedSave();
        await page.unroute(`**${advancedSaveEndpoint}`, holdAdvancedSave);
      }
      const advancedDetail = await json(await request.get(`/api/discussions/${advancedWorkspace.discussion.id}`));
      expect(advancedDetail.workPackage.versions.find(item => item.id === approvedAdvancedV1.version.id).content.outcome)
        .toBe('Durable v1 before concurrent approval and version advance.');
      expect(advancedDetail.workPackage.currentVersion.id).toBe(externallyEditedV2.id);
      expect(advancedDetail.workPackage.currentVersion.content.outcome).toBe(advancedHeldOutcome);

      const committedLostWorkspace = await createWorkspaceApi(request, 'Committed save response loss');
      let committedLostV1 = await seedDraftPackage(request, committedLostWorkspace.discussion.id, {
        pointText: 'A committed save must not be presented later as an unsaved held edit.',
      });
      committedLostV1 = await updatePackageApi(request, committedLostV1, {
        ...completePackageContent,
        outcome: 'Base before the owner save whose response is lost.',
        includedScope: ['A committed save must not be presented later as an unsaved held edit.'],
      });
      await page.reload();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${committedLostWorkspace.project.id}/discussions/${committedLostWorkspace.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      const committedOwnerOutcome = 'OWNER SAVE COMMITTED BEFORE ITS RESPONSE WAS LOST';
      await page.getByLabel('Outcome').fill(committedOwnerOutcome);
      const committedLostEndpoint = `/api/work-package-versions/${committedLostV1.id}`;
      let markCommittedLostSave;
      const committedLostSave = new Promise(resolve => { markCommittedLostSave = resolve; });
      const loseCommittedSaveResponse = async route => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markCommittedLostSave();
        await route.abort('failed');
      };
      await page.route(`**${committedLostEndpoint}`, loseCommittedSaveResponse);
      try {
        await page.getByRole('button', { name: 'Save draft', exact: true }).click();
        await committedLostSave;
        await expect(page.getByRole('alert')).toContainText('Failed to fetch');
      } finally {
        await page.unroute(`**${committedLostEndpoint}`, loseCommittedSaveResponse);
      }
      const committedAfterLoss = await json(await request.get(`/api/discussions/${committedLostWorkspace.discussion.id}`));
      const savedBeforeLostResponse = committedAfterLoss.workPackage.currentVersion;
      expect(savedBeforeLostResponse.content.outcome).toBe(committedOwnerOutcome);
      const approvedAfterLostResponse = await json(await request.post(`/api/work-package-versions/${savedBeforeLostResponse.id}/approve`, {
        data: { expectedVersion: savedBeforeLostResponse.rowVersion, idempotencyKey: key('committed-lost-approval') },
      }));
      const v2AfterLostResponse = await json(await request.post(`/api/work-package-versions/${approvedAfterLostResponse.version.id}/next-version`, {
        data: { idempotencyKey: key('committed-lost-v2') },
      }));
      const newerV2Outcome = 'A newer intentional v2 outcome remains current.';
      const editedV2AfterLostResponse = await updatePackageApi(request, v2AfterLostResponse.version, {
        ...completePackageContent,
        outcome: newerV2Outcome,
        includedScope: ['A committed save must not be presented later as an unsaved held edit.'],
      });
      const committedLostV2Button = page.getByRole('button', { name: 'v2 · Draft', exact: true });
      await expect(committedLostV2Button).toBeVisible();
      await committedLostV2Button.click();
      await expect(page.locator('#packageStation')).toContainText('Version 2 · Draft');
      await expect(page.getByRole('textbox', { name: 'Outcome', exact: true })).toHaveValue(newerV2Outcome);
      await expect(page.locator('.package-orphan')).toHaveCount(0);
      const committedLostFinal = await json(await request.get(`/api/discussions/${committedLostWorkspace.discussion.id}`));
      expect(committedLostFinal.workPackage.versions.find(item => item.id === approvedAfterLostResponse.version.id).content.outcome)
        .toBe(committedOwnerOutcome);
      expect(committedLostFinal.workPackage.currentVersion.id).toBe(editedV2AfterLostResponse.id);
      expect(committedLostFinal.workPackage.currentVersion.content.outcome).toBe(newerV2Outcome);

      const unresolvedWorkspace = await createWorkspaceApi(request, 'Unresolved collision approval');
      let unresolvedV1 = await seedDraftPackage(request, unresolvedWorkspace.discussion.id, {
        pointText: 'A local side of an unresolved collision must remain recoverable after approval.',
      });
      unresolvedV1 = await updatePackageApi(request, unresolvedV1, {
        ...completePackageContent,
        outcome: 'Base outcome before either owner view changes it.',
        includedScope: ['A local side of an unresolved collision must remain recoverable after approval.'],
      });
      await page.reload();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${unresolvedWorkspace.project.id}/discussions/${unresolvedWorkspace.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      const unresolvedLocalOutcome = 'LOCAL COLLISION VALUE THAT MUST SURVIVE APPROVAL';
      await page.getByLabel('Outcome').fill(unresolvedLocalOutcome);
      const unresolvedLatestOutcome = 'Latest saved outcome from the other owner view.';
      const unresolvedLatestV1 = await updatePackageApi(request, unresolvedV1, {
        ...completePackageContent,
        outcome: unresolvedLatestOutcome,
        includedScope: ['A local side of an unresolved collision must remain recoverable after approval.'],
      });
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('changed in another view');
      await expect(page.locator('.local-status')).toHaveText('Package edits unsaved');
      await expect(page.getByRole('button', { name: 'Compare and reapply changes', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Compare and reapply changes', exact: true }).click();
      const unresolvedCollision = page.locator('.field-collision').filter({ hasText: 'Outcome changed in both views' });
      const unresolvedKeepYours = unresolvedCollision.getByRole('button', { name: 'Keep yours', exact: true });
      await expect(unresolvedCollision).toContainText(unresolvedLocalOutcome);
      await expect(unresolvedCollision).toContainText(unresolvedLatestOutcome);
      const unresolvedOutcomeField = page.getByRole('textbox', { name: 'Outcome', exact: true });
      await expect(unresolvedOutcomeField).toHaveValue(unresolvedLocalOutcome);
      await expect(unresolvedOutcomeField).toBeDisabled();
      await expect(unresolvedKeepYours).toBeFocused();
      const unresolvedApproval = await json(await request.post(`/api/work-package-versions/${unresolvedLatestV1.id}/approve`, {
        data: { expectedVersion: unresolvedLatestV1.rowVersion, idempotencyKey: key('unresolved-v1-approval') },
      }));
      const unresolvedHeldEdits = page.locator('.package-orphan');
      await expect(unresolvedHeldEdits).toContainText('Your unsaved edits were not part of approved v1.');
      await expect(unresolvedHeldEdits).toContainText('Held fields: Outcome.');
      const unresolvedCarry = unresolvedHeldEdits.getByRole('button', { name: 'Create v2 and carry edits', exact: true });
      await expect(unresolvedCarry).toBeFocused();
      await unresolvedCarry.click();
      await expect(page.getByLabel('Outcome')).toHaveValue(unresolvedLocalOutcome);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();
      const unresolvedRecoveredDetail = await json(await request.get(`/api/discussions/${unresolvedWorkspace.discussion.id}`));
      expect(unresolvedRecoveredDetail.workPackage.versions.find(item => item.id === unresolvedApproval.version.id).content.outcome)
        .toBe(unresolvedLatestOutcome);
      expect(unresolvedRecoveredDetail.workPackage.currentVersion.versionNumber).toBe(2);
      expect(unresolvedRecoveredDetail.workPackage.currentVersion.content.outcome).toBe(unresolvedLocalOutcome);

      const routeIsolationA = await createWorkspaceApi(request, 'Route isolation A');
      let routeIsolationAVersion = await seedDraftPackage(request, routeIsolationA.discussion.id, {
        pointText: 'Project A transient package text must remain in project A.',
      });
      routeIsolationAVersion = await updatePackageApi(request, routeIsolationAVersion, {
        ...completePackageContent,
        outcome: 'Durable project A package.',
        includedScope: ['Project A transient package text must remain in project A.'],
      });
      const routeIsolationB = await createWorkspaceApi(request, 'Route isolation B');
      let routeIsolationBVersion = await seedDraftPackage(request, routeIsolationB.discussion.id, {
        pointText: 'Project B must never receive project A transient state.',
      });
      routeIsolationBVersion = await updatePackageApi(request, routeIsolationBVersion, {
        ...completePackageContent,
        outcome: 'Durable project B package.',
        includedScope: ['Project B must never receive project A transient state.'],
      });
      await page.reload();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${routeIsolationA.project.id}/discussions/${routeIsolationA.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      const projectATransientText = 'ALPHA UNSAVED PACKAGE TEXT MUST NEVER ENTER BETA';
      await page.getByLabel('Outcome').fill(projectATransientText);
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${routeIsolationB.project.id}/discussions/${routeIsolationA.discussion.id}`);
      await expect(page.getByRole('heading', { name: routeIsolationB.project.name, exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('does not belong to this project');
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${routeIsolationB.project.id}/discussions/${routeIsolationB.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      await expect(page.getByLabel('Outcome')).toHaveValue('Durable project B package.');
      await expect(page.locator('.package-orphan')).toHaveCount(0);
      await expect(page.getByText(projectATransientText, { exact: true })).toHaveCount(0);
      const routeIsolationBDetail = await json(await request.get(`/api/discussions/${routeIsolationB.discussion.id}`));
      expect(routeIsolationBDetail.workPackage.currentVersion.id).toBe(routeIsolationBVersion.id);
      expect(routeIsolationBDetail.workPackage.currentVersion.content.outcome).toBe('Durable project B package.');

      const approvalRaceA = await createWorkspaceApi(request, 'Approval race A');
      let approvalRaceAVersion = await seedDraftPackage(request, approvalRaceA.discussion.id, {
        pointText: 'Approval must remain bound to package A.',
      });
      approvalRaceAVersion = await updatePackageApi(request, approvalRaceAVersion, {
        ...completePackageContent,
        outcome: 'Complete package A before the delayed save.',
        includedScope: ['Approval must remain bound to package A.'],
      });
      const approvalRaceB = await createWorkspaceApi(request, 'Approval race B');
      let approvalRaceBVersion = await seedDraftPackage(request, approvalRaceB.discussion.id, {
        pointText: 'Package B must never inherit package A approval.',
      });
      approvalRaceBVersion = await updatePackageApi(request, approvalRaceBVersion, {
        ...completePackageContent,
        outcome: 'Complete package B remains an independent draft.',
        includedScope: ['Package B must never inherit package A approval.'],
      });

      await page.reload();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${approvalRaceA.project.id}/discussions/${approvalRaceA.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      await page.getByLabel('Outcome').fill('Dirty complete package A is saved without detached approval.');
      const delayedApproval = await openApprovalCheckpoint(page, {
        versionNumber: 1,
        completeSections: 6,
        sourceCount: 1,
      });
      const heldSavePattern = `**/api/work-package-versions/${approvalRaceAVersion.id}`;
      let markSaveObserved;
      const saveObserved = new Promise(resolve => { markSaveObserved = resolve; });
      let releaseSave;
      const saveRelease = new Promise(resolve => { releaseSave = resolve; });
      let saveWasObserved = false;
      let saveWasReleased = false;
      const releaseHeldSave = () => {
        if (saveWasReleased) return;
        saveWasReleased = true;
        releaseSave();
      };
      const holdPackageSave = async route => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        saveWasObserved = true;
        markSaveObserved();
        await saveRelease;
        await route.continue();
      };
      await page.route(heldSavePattern, holdPackageSave);
      try {
        await delayedApproval.confirm.click();
        await saveObserved;
        expect(saveWasObserved).toBe(true);
        const packageFields = page.locator('#packageStation textarea');
        await expect(packageFields).toHaveCount(6);
        for (const label of ['Outcome', 'Included scope', 'Exclusions', 'Acceptance criteria', 'Review requirements', 'Evidence requirements']) {
          await expect(page.getByLabel(label)).toBeDisabled();
        }
        await expect(page.getByRole('button', { name: 'Discard edits', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Review approval of v1', exact: true })).toBeDisabled();

        await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${approvalRaceB.project.id}/discussions/${approvalRaceB.discussion.id}`);
        await expect(page.getByRole('heading', { name: 'Approval race B room' })).toBeVisible();
        await openPackageAtNarrowWidth(page);
        await expect(page.getByLabel('Outcome')).toHaveValue('Complete package B remains an independent draft.');
        releaseHeldSave();
        await expect(page.locator('#assertiveRegion')).toHaveText(
          'The draft was saved, but approval stopped because you left the reviewed package.',
        );

        await expect(page).toHaveURL(new RegExp(`#\/projects\/${approvalRaceB.project.id}\/discussions\/${approvalRaceB.discussion.id}$`));
        await expect(page.getByRole('heading', { name: 'Approval race B room' })).toBeVisible();
        await expect(page.getByLabel('Outcome')).toHaveValue('Complete package B remains an independent draft.');
        await expect(page.getByLabel('Outcome')).toBeEnabled();
        await expect(page.locator('.local-status')).toHaveText('Local service ready');
        await expect(page.getByText('Ready for execution', { exact: true })).toHaveCount(0);
        const approvalRaceADetail = await json(await request.get(`/api/discussions/${approvalRaceA.discussion.id}`));
        const approvalRaceBDetail = await json(await request.get(`/api/discussions/${approvalRaceB.discussion.id}`));
        expect(approvalRaceADetail.workPackage.currentVersion.status).toBe('DRAFT');
        expect(approvalRaceADetail.workPackage.approvals).toHaveLength(0);
        expect(approvalRaceBDetail.workPackage.currentVersion.id).toBe(approvalRaceBVersion.id);
        expect(approvalRaceBDetail.workPackage.currentVersion.status).toBe('DRAFT');
        expect(approvalRaceBDetail.workPackage.approvals).toHaveLength(0);
      } finally {
        releaseHeldSave();
        await page.unroute(heldSavePattern, holdPackageSave);
      }

      const sequencedConflictWorkspace = await createWorkspaceApi(request, 'Sequenced package conflict');
      let sequencedBaseVersion = await seedDraftPackage(request, sequencedConflictWorkspace.discussion.id, {
        pointText: 'A mutation conflict snapshot must outrank an older poll response.',
      });
      sequencedBaseVersion = await updatePackageApi(request, sequencedBaseVersion, {
        ...completePackageContent,
        outcome: 'Base before the poll and mutation diverge.',
        includedScope: ['A mutation conflict snapshot must outrank an older poll response.'],
      });
      await page.reload();
      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${sequencedConflictWorkspace.project.id}/discussions/${sequencedConflictWorkspace.discussion.id}`);
      await openPackageAtNarrowWidth(page);
      const sequencedLocalOutcome = 'LOCAL OWNER TEXT HELD THROUGH THE SEQUENCED CONFLICT';
      await page.getByLabel('Outcome').fill(sequencedLocalOutcome);
      const sequencedDetailPattern = `**/api/discussions/${sequencedConflictWorkspace.discussion.id}`;
      let markSequencedPollCaptured;
      const sequencedPollCaptured = new Promise(resolve => { markSequencedPollCaptured = resolve; });
      let releaseSequencedPoll;
      const sequencedPollRelease = new Promise(resolve => { releaseSequencedPoll = resolve; });
      let sequencedIntermediateVersion;
      let sequencedPollHeld = false;
      const intermediateOutcome = 'Intermediate row captured by the older poll.';
      const holdSequencedPoll = async route => {
        if (sequencedPollHeld) {
          await route.continue();
          return;
        }
        sequencedPollHeld = true;
        sequencedIntermediateVersion = await updatePackageApi(request, sequencedBaseVersion, {
          ...completePackageContent,
          outcome: intermediateOutcome,
          includedScope: ['A mutation conflict snapshot must outrank an older poll response.'],
        });
        const response = await route.fetch();
        markSequencedPollCaptured();
        await sequencedPollRelease;
        await route.fulfill({ response });
      };
      await page.route(sequencedDetailPattern, holdSequencedPoll);
      try {
        await sequencedPollCaptured;
        const latestOutcome = 'Authoritative row returned by the newer mutation conflict.';
        const sequencedLatestVersion = await updatePackageApi(request, sequencedIntermediateVersion, {
          ...completePackageContent,
          outcome: latestOutcome,
          includedScope: ['A mutation conflict snapshot must outrank an older poll response.'],
        });
        await page.getByRole('button', { name: 'Save draft', exact: true }).click();
        await expect(page.locator('.feedback[data-tone="warning"]')).toContainText('changed in another view');
        releaseSequencedPoll();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Compare and reapply changes', exact: true }).click();
        const sequencedCollision = page.locator('.field-collision').filter({ hasText: 'Outcome changed in both views' });
        await expect(sequencedCollision).toContainText(sequencedLocalOutcome);
        await expect(sequencedCollision).toContainText(latestOutcome);
        await expect(sequencedCollision).not.toContainText(intermediateOutcome);
        const sequencedDetail = await json(await request.get(`/api/discussions/${sequencedConflictWorkspace.discussion.id}`));
        expect(sequencedDetail.workPackage.currentVersion.id).toBe(sequencedLatestVersion.id);
        expect(sequencedDetail.workPackage.currentVersion.content.outcome).toBe(latestOutcome);
      } finally {
        releaseSequencedPoll();
        await page.unroute(sequencedDetailPattern, holdSequencedPoll);
      }
    } finally {
      await secondContext.close();
    }
  });

  test('capability-and-repository-unavailable', async ({ page, request }) => {
    await page.goto('/#/new-project');
    await page.getByLabel('Project name').fill('Repository recovery');
    await page.getByLabel('Local Git repository').fill(path.join(repositoryRoot, 'does-not-exist'));
    await page.getByRole('button', { name: 'Register project' }).click();
    await expect(page.getByRole('alert')).toContainText('Repository root must be an existing local Git repository.');
    await expect(page.getByLabel('Project name')).toHaveValue('Repository recovery');
    await expect(page.getByLabel('Local Git repository')).toHaveValue(path.join(repositoryRoot, 'does-not-exist'));
    await page.getByLabel('Local Git repository').fill(repositoryRoot);
    await page.getByRole('button', { name: 'Register project' }).click();
    await expect(page.getByRole('heading', { name: 'Repository recovery' })).toBeVisible();
    const projectMatch = page.url().match(/#\/projects\/([^/]+)$/);
    const firstProjectId = projectMatch[1];
    const firstDiscussion = await createDiscussionUi(page, { id: firstProjectId }, 'Unavailable adapter still permits planning');

    const codexButton = page.getByRole('button', { name: 'Ask Codex' });
    await expect(codexButton).toBeDisabled();
    await expect(codexButton).toHaveAttribute('title', /local Codex bridge is not available/i);
    await importMessageUi(page, { content: 'Imported Claude guidance remains available without the Codex bridge.' });

    const isolated = await createWorkspaceApi(request, 'Isolated second');
    await addMessageApi(request, isolated.discussion.id, 'Only the second project may see this content.');
    await page.reload();
    await page.getByLabel('Current project').selectOption(isolated.project.id);
    await expect(page.getByRole('heading', { name: 'Isolated second project' })).toBeVisible();
    await expect(page.getByText('Unavailable adapter still permits planning')).not.toBeVisible();
    await page.getByLabel('Current project').selectOption(firstProjectId);
    await expect(page.getByRole('heading', { name: 'Repository recovery' })).toBeVisible();
    await expect(page.getByRole('link', { name: firstDiscussion.title, exact: true })).toBeVisible();
    await expect(page.getByText('Only the second project may see this content.')).not.toBeVisible();

    await page.getByRole('link', { name: firstDiscussion.title, exact: true }).click();
    const outageDraft = 'Keep this planning draft and focus through a temporary local-service outage.';
    const outageComposer = page.getByLabel('Add owner context');
    await outageComposer.fill(outageDraft);
    await outageComposer.focus();
    await page.evaluate(() => {
      window.__pollAlertInsertions = 0;
      window.__pollAlertObserver = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches('[role="alert"]')) window.__pollAlertInsertions += 1;
            window.__pollAlertInsertions += node.querySelectorAll?.('[role="alert"]').length || 0;
          }
        }
      });
      window.__pollAlertObserver.observe(document.body, { childList: true, subtree: true });
    });
    const discussionPollPattern = `**/api/discussions/${firstDiscussion.id}`;
    let failedPollRequests = 0;
    const failDiscussionPoll = async route => {
      failedPollRequests += 1;
      await route.abort('failed');
    };
    await page.route(discussionPollPattern, failDiscussionPoll);
    try {
      await expect(page.getByRole('alert')).toContainText('Live updates are paused while Andamento reconnects');
      await page.waitForTimeout(2400);
      expect(failedPollRequests).toBeGreaterThanOrEqual(2);
      expect(failedPollRequests).toBeLessThanOrEqual(3);
      expect(await page.evaluate(() => window.__pollAlertInsertions)).toBe(1);
      await expect(outageComposer).toHaveValue(outageDraft);
      await expect(outageComposer).toBeFocused();
    } finally {
      await page.unroute(discussionPollPattern, failDiscussionPoll);
    }
    await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('#liveRegion')).toHaveText('Local service connection restored.');
    await expect(outageComposer).toHaveValue(outageDraft);
    await expect(outageComposer).toBeFocused();
    await page.evaluate(() => window.__pollAlertObserver?.disconnect());

    const timedOutMessageEndpoint = `/api/discussions/${firstDiscussion.id}/messages`;
    let markTimedOutMessageCommitted;
    const timedOutMessageCommitted = new Promise(resolve => { markTimedOutMessageCommitted = resolve; });
    let releaseTimedOutMessageResponse;
    const timedOutMessageResponseRelease = new Promise(resolve => { releaseTimedOutMessageResponse = resolve; });
    let timedOutMessageHeld = false;
    const holdCommittedMessagePastClientTimeout = async route => {
      if (!timedOutMessageHeld) {
        timedOutMessageHeld = true;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markTimedOutMessageCommitted();
        await timedOutMessageResponseRelease;
        await route.fulfill({ response }).catch(() => {});
        return;
      }
      await route.continue();
    };
    await page.route(`**${timedOutMessageEndpoint}`, holdCommittedMessagePastClientTimeout);
    try {
      await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
      await timedOutMessageCommitted;
      await expect(page.locator('.composer').getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await expect(page.getByRole('alert')).toContainText('local service did not respond within 6 seconds', { timeout: 9_000 });
      await expect(outageComposer).toHaveValue(outageDraft);
      await expect(page.getByRole('button', { name: 'Add to discussion', exact: true })).toBeEnabled();
      await expect(page.locator('.composer').getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
      releaseTimedOutMessageResponse();
    } finally {
      releaseTimedOutMessageResponse();
      await page.unroute(`**${timedOutMessageEndpoint}`, holdCommittedMessagePastClientTimeout);
    }
    await page.getByRole('button', { name: 'Add to discussion', exact: true }).click();
    await expect(outageComposer).toHaveValue('');
    await expect(page.locator('.message-trace').filter({ hasText: outageDraft })).toHaveCount(1);
    const detailAfterTimedOutReplay = await json(await request.get(`/api/discussions/${firstDiscussion.id}`));
    expect(detailAfterTimedOutReplay.messages.filter(message => message.content === outageDraft)).toHaveLength(1);

    const codexBridge = await startCodexQuarantineBridge();
    let quarantineServer;
    try {
      quarantineServer = await startDedicatedServer(request, {
        reset: true,
        port: 47844,
        codexUrl: codexBridge.url,
        databaseName: 'e2e-codex-quarantine.db',
      });
      const quarantinedWorkspace = await createWorkspaceApi(request, 'Codex quarantine', { base: quarantineServer.base });
      const sharedDiscussion = await createDiscussionApi(
        request,
        quarantinedWorkspace.project.id,
        'Shared thread without the failed run',
        { base: quarantineServer.base },
      );
      const confirmedDiscussion = await createDiscussionApi(
        request,
        quarantinedWorkspace.project.id,
        'Confirmed Codex cleanup',
        { base: quarantineServer.base },
      );
      const sharedPrompt = '[complete] establish the shared Codex thread safely';
      const sharedRun = (await json(await request.post(
        `${quarantineServer.base}/api/discussions/${sharedDiscussion.id}/agent-runs`,
        { data: { adapter: 'codex', prompt: sharedPrompt, idempotencyKey: key('shared-thread-run') } },
      ))).run;
      await codexBridge.waitForTurn(sharedPrompt);
      await expect.poll(async () => {
        const detail = await json(await request.get(`${quarantineServer.base}/api/discussions/${sharedDiscussion.id}`));
        return detail.runs.find(run => run.id === sharedRun.id)?.status;
      }).toBe('COMPLETED');

      const sharedWorkspace = { project: quarantinedWorkspace.project, discussion: sharedDiscussion };
      await page.goto(routeFor(sharedWorkspace, quarantineServer.base));
      const askCodex = page.getByRole('button', { name: 'Ask Codex', exact: true });
      await expect(askCodex).toBeEnabled();
      await askCodex.click();
      const preservedBlockedDraft = 'Keep this shared-room Codex draft while quarantine becomes visible.';
      await page.getByLabel('Ask for a planning contribution').fill(preservedBlockedDraft);

      const confirmedCleanupPrompt = '[confirm-cleanup] Confirm this owner-cancelled Codex turn stopped.';
      const confirmedRun = (await json(await request.post(
        `${quarantineServer.base}/api/discussions/${confirmedDiscussion.id}/agent-runs`,
        { data: { adapter: 'codex', prompt: confirmedCleanupPrompt, idempotencyKey: key('confirmed-cleanup-run') } },
      ))).run;
      await codexBridge.waitForTurn(confirmedCleanupPrompt);
      const pendingPage = await page.context().newPage();
      try {
        await pendingPage.goto(routeFor({ project: quarantinedWorkspace.project, discussion: confirmedDiscussion }, quarantineServer.base));
        const pendingRun = pendingPage.locator('.run-trace').filter({ hasText: confirmedCleanupPrompt });
        const pendingCancellationResponse = pendingPage.waitForResponse(response => (
          response.request().method() === 'POST'
          && response.url().endsWith(`/api/agent-runs/${confirmedRun.id}/cancel`)
        ));
        await pendingRun.getByRole('button', { name: 'Cancel contribution', exact: true }).click();
        const pendingCancellation = await json(await pendingCancellationResponse);
        expect(pendingCancellation.run.errorCode).toBe('CODEX_CLEANUP_PENDING');
        await expect(pendingPage.locator('#assertiveRegion')).toHaveText(
          'Cancellation requested. Andamento is confirming that the Codex turn stopped.',
        );
        await expect(pendingRun).toContainText('Retry is blocked while Andamento confirms that the Codex turn stopped.');
        await expect(pendingRun.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
      } finally {
        await pendingPage.close();
      }
      await expect(askCodex).toBeDisabled({ timeout: 12_000 });
      await expect(page.getByLabel('Ask for a planning contribution')).toHaveValue(preservedBlockedDraft);
      await expect.poll(async () => {
        const detail = await json(await request.get(`${quarantineServer.base}/api/discussions/${confirmedDiscussion.id}`));
        return detail.runs.find(run => run.id === confirmedRun.id)?.errorCode;
      }).toBe('CANCELLED');
      await expect(askCodex).toBeEnabled({ timeout: 12_000 });
      await expect(page.getByLabel('Ask for a planning contribution')).toHaveValue(preservedBlockedDraft);

      const quarantinePrompt = 'Leave this Codex cleanup deliberately unconfirmed.';
      const unsafeRun = (await json(await request.post(
        `${quarantineServer.base}/api/discussions/${quarantinedWorkspace.discussion.id}/agent-runs`,
        { data: { adapter: 'codex', prompt: quarantinePrompt, idempotencyKey: key('quarantine-run') } },
      ))).run;
      await codexBridge.waitForTurn(quarantinePrompt);
      const unsafePending = await json(await request.post(`${quarantineServer.base}/api/agent-runs/${unsafeRun.id}/cancel`, {
        data: { idempotencyKey: key('quarantine-cancel') },
      }));
      expect(unsafePending.run.errorCode).toBe('CODEX_CLEANUP_PENDING');
      await expect.poll(async () => {
        const detail = await json(await request.get(`${quarantineServer.base}/api/discussions/${quarantinedWorkspace.discussion.id}`));
        return detail.runs.find(run => run.id === unsafeRun.id)?.errorCode;
      }).toBe('CODEX_CLEANUP_UNCONFIRMED');

      await expect(askCodex).toBeDisabled({ timeout: 12_000 });
      await expect(askCodex).toHaveAttribute('title', /could not confirm that the Codex contribution stopped/i);
      await expect(page.locator('.capability-note')).toContainText('Codex is blocked in this room');
      await expect(page.getByLabel('Ask for a planning contribution')).toHaveValue(preservedBlockedDraft);
      await expect(page.getByRole('button', { name: 'Codex blocked', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Owner note', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Import agent input', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Test participant', exact: true })).toBeEnabled();
      const sharedBlockedDetail = await json(await request.get(`${quarantineServer.base}/api/discussions/${sharedDiscussion.id}`));
      expect(sharedBlockedDetail.agentAvailability.codex.blocked).toBe(true);
      expect(sharedBlockedDetail.runs.some(run => run.errorCode === 'CODEX_CLEANUP_UNCONFIRMED')).toBe(false);

      await page.evaluate(hash => { window.location.hash = hash; }, `#/projects/${quarantinedWorkspace.project.id}/discussions/${quarantinedWorkspace.discussion.id}`);
      await expect(page.getByRole('heading', { name: 'Codex quarantine room', exact: true })).toBeVisible();
      const quarantinedRun = page.locator('.run-trace').filter({ hasText: quarantinePrompt });
      await expect(quarantinedRun).toContainText('Prompt preserved:');
      await expect(quarantinedRun).toContainText('Retry is blocked until Codex cleanup can be confirmed.');
      await expect(quarantinedRun.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Ask Codex', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Test participant', exact: true }).click();
      const deterministicControlPrompt = 'Quarantined Codex must not block this deterministic participant.';
      await page.getByLabel('Ask for a planning contribution').fill(deterministicControlPrompt);
      await page.getByRole('button', { name: 'Request contribution', exact: true }).click();
      await expect(page.locator('.message-trace').filter({ hasText: deterministicControlPrompt })).toContainText('Test planning agent');
    } finally {
      await stopDedicatedServer(quarantineServer);
      await codexBridge.close();
    }
  });

  test('supported-width-keyboard-overflow', async ({ page, request }) => {
    const workspace = await createWorkspaceApi(request, 'Display');
    const packageBoundaryWorkspace = await createWorkspaceApi(request, 'Package boundary display');
    let packageBoundaryVersion = await seedDraftPackage(request, packageBoundaryWorkspace.discussion.id, {
      pointText: 'Valid package fields larger than the old browser cap remain editable.',
    });
    const boundaryScope = Array.from({ length: 7 }, (_, index) => `${index + 1}:${'x'.repeat(1998)}`);
    packageBoundaryVersion = await updatePackageApi(request, packageBoundaryVersion, {
      ...completePackageContent,
      outcome: 'Edit a service-valid package whose aggregate text exceeds twelve thousand characters.',
      includedScope: boundaryScope,
    });
    const longPoint = `A very long planning point must wrap without obscuring its state or owner controls: ${'bounded lineage '.repeat(18)}`;
    for (let index = 0; index < 14; index += 1) {
      const message = (await addMessageApi(request, workspace.discussion.id, `Contribution ${index + 1}: ${'attributed planning context '.repeat(12)}`)).message;
      if (index < 10) await capturePointApi(request, message.id, index === 0 ? longPoint : `Visible point ${index + 1}: ${'traceable work '.repeat(10)}`);
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(routeFor(workspace));
    await expect(page.locator('#minimumWidthNotice')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Display room' })).toBeVisible();
    await expect(page.locator('.message-trace')).toHaveCount(14);
    await expect(page.locator('.decision-row')).toHaveCount(10);
    await expect(page.getByText(longPoint)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capture point' }).first()).toHaveAccessibleName('Capture point');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('#messageScroll').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

    const packageTab = page.getByRole('tab', { name: /^Package/ });
    await packageTab.focus();
    await expect(packageTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(packageTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#packageStation')).toBeVisible();
    await expect(page.locator('#decisionStation')).toBeHidden();

    await page.goto(routeFor(packageBoundaryWorkspace));
    await openPackageAtNarrowWidth(page);
    const boundaryScopeField = page.getByLabel('Included scope');
    expect((await boundaryScopeField.inputValue()).length).toBeGreaterThan(12_000);
    expect(await boundaryScopeField.evaluate(control => control.maxLength)).toBe(200099);
    expect(await page.getByLabel('Exclusions').evaluate(control => control.maxLength)).toBe(120099);
    expect(await page.getByLabel('Acceptance criteria').evaluate(control => control.maxLength)).toBe(120099);
    expect(await page.getByLabel('Review requirements').evaluate(control => control.maxLength)).toBe(60049);
    expect(await page.getByLabel('Evidence requirements').evaluate(control => control.maxLength)).toBe(60049);
    await boundaryScopeField.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Backspace');
    expect(await boundaryScopeField.evaluate(control => control.validity.tooLong)).toBe(false);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Draft saved', exact: true })).toBeVisible();
    const boundaryDetail = await json(await request.get(`/api/discussions/${packageBoundaryWorkspace.discussion.id}`));
    expect(boundaryDetail.workPackage.currentVersion.id).toBe(packageBoundaryVersion.id);
    expect(boundaryDetail.workPackage.currentVersion.content.includedScope.at(-1)).toHaveLength(1999);

    await page.goto(routeFor(workspace));
    await expect(page.locator('.message-trace')).toHaveCount(14);
    await expect(page.locator('.decision-row')).toHaveCount(10);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('#decisionStation')).toBeVisible();
    await expect(page.locator('#packageStation')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Capture point' }).first()).toHaveAccessibleName('Capture point');
    await expect(page.locator('.decision-row').first()).toContainText('PROPOSED');

    await page.setViewportSize({ width: 1000, height: 768 });
    await expect(page.locator('#minimumWidthNotice')).toBeVisible();
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.getByLabel('Current project')).toBeVisible();
    await expect(page.getByLabel('Current project')).toHaveValue(workspace.project.id);
    await expect(page.getByRole('heading', { name: 'Display room' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Owner note' })).toBeEnabled();
    const decisionsTab = page.getByRole('tab', { name: /^Decisions/ });
    await decisionsTab.click();
    await expect(decisionsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#decisionStation')).toBeVisible();
    await expect(page.locator('#packageStation')).toBeHidden();
    await decisionsTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(packageTab).toBeFocused();
    await expect(packageTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#packageStation')).toBeVisible();

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(page.locator('#minimumWidthNotice')).toBeVisible();
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.getByLabel('Current project')).toBeVisible();
    await expect(page.getByLabel('Current project')).toHaveValue(workspace.project.id);
    const narrowWidths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(narrowWidths.viewportWidth).toBe(320);
    expect(narrowWidths.documentWidth).toBeLessThanOrEqual(narrowWidths.viewportWidth);

    const roomReturn = page.getByRole('link', { name: 'Return to Display project rooms', exact: true });
    await expect(roomReturn).toBeVisible();
    await roomReturn.click();
    await expect(page.getByRole('heading', { name: 'Display project', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Display room', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Display room', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Display room', exact: true })).toBeVisible();

    const ownerNote = page.getByRole('button', { name: 'Owner note', exact: true });
    await expect(ownerNote).toBeVisible();
    await ownerNote.focus();
    await expect(ownerNote).toBeFocused();
    const ownerComposer = page.getByLabel('Add owner context');
    await expect(ownerComposer).toBeVisible();
    await ownerComposer.fill('Reachable at the 400 percent zoom equivalent.');
    await expect(ownerComposer).toHaveValue('Reachable at the 400 percent zoom equivalent.');
    await ownerComposer.clear();

    await decisionsTab.click();
    await expect(decisionsTab).toHaveAttribute('aria-selected', 'true');
    const firstAcceptAction = page.locator('.decision-row').first().getByRole('button', { name: 'Accept', exact: true });
    await expect(firstAcceptAction).toBeVisible();
    await expect(firstAcceptAction).toBeEnabled();
    await firstAcceptAction.focus();
    await expect(firstAcceptAction).toBeFocused();
    await packageTab.click();
    await expect(packageTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Prepare package', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
