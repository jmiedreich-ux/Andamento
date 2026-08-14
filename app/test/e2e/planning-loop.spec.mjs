import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
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
  await mkdir(path.join(root, '.git'), { recursive: true });
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

async function startDedicatedServer(request, { reset, port = 47842 }) {
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve('app/test/e2e/test-server.mjs')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANDAMENTO_HOST: '127.0.0.1',
      ANDAMENTO_PORT: String(port),
      ANDAMENTO_TEST_MODE: '1',
      ANDAMENTO_CODEX_URL: 'ws://127.0.0.1:1',
      ANDAMENTO_E2E_DATABASE_PATH: path.resolve('var', 'e2e-restart.db'),
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

  test('empty-validation-refusal', async ({ page }) => {
    await page.goto('/#/new-project');
    await page.getByRole('button', { name: 'Register project' }).click();
    await expect(page.getByLabel('Project name')).toHaveJSProperty('validity.valueMissing', true);
    await expect(page).toHaveURL(/#\/new-project$/);

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
    await capturePointUi(page, source, point);
    await decidePointUi(page, point, 'Accept');
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
    await seedDraftPackage(request, workspace.discussion.id, { pointText: 'Persist the exact draft across navigation.' });
    await page.goto(routeFor(workspace));
    await fillPackageUi(page, {
      ...completePackageContent,
      outcome: 'This saved draft survives refresh, leave, and return.',
      includedScope: ['Persist the exact draft across navigation.'],
    });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('button', { name: 'Draft saved' })).toBeVisible();
    await page.getByLabel('Outcome').fill('This undurable edit should be discarded.');
    await page.getByRole('button', { name: 'Discard edits' }).click();
    await expect(page.getByLabel('Outcome')).toHaveValue('This saved draft survives refresh, leave, and return.');
    const composer = page.locator('.composer');
    await composer.getByLabel('Add owner context').fill('This cancelled composer text must not become durable.');
    await composer.getByRole('button', { name: 'Cancel' }).click();
    await expect(composer.getByLabel('Add owner context')).toHaveValue('');

    await page.reload();
    await openPackageAtNarrowWidth(page);
    await expect(page.getByLabel('Outcome')).toHaveValue('This saved draft survives refresh, leave, and return.');
    await page.goto(`/#/projects/${workspace.project.id}`);
    await expect(page.getByRole('heading', { name: 'Persistence project' })).toBeVisible();
    await page.getByRole('link', { name: 'Persistence room', exact: true }).click();
    await openPackageAtNarrowWidth(page);
    await expect(page.getByLabel('Outcome')).toHaveValue('This saved draft survives refresh, leave, and return.');

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
    expect(detail.messages).toHaveLength(1);
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
  });

  test('supported-width-keyboard-overflow', async ({ page, request }) => {
    const workspace = await createWorkspaceApi(request, 'Display');
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
