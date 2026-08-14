const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, pendingCommands, commandPrompt } = require('./relay');

test('accepts the configured VennuSign Git workspace', () => {
  const config = validateConfig({ spreadsheetId: '1DCtCrn5NAXCTNt5csmrjAOJvcCws7l9fdsnGQUCHFkM', workspaceRoot: 'C:\\Development\\VennuSign', codexExecutable: 'C:\\Users\\JeremyPC\\.vscode\\extensions\\openai.chatgpt-26.810.41047-win32-x64\\bin\\windows-x86_64\\codex.exe', webAppUrl: 'https://script.google.com/macros/s/test/exec', pollIntervalSeconds: 1 });
  assert.equal(config.workspaceRoot, path.resolve('C:\\Development\\VennuSign'));
  assert.equal(config.pollIntervalSeconds, 10);
});

test('selects only pending commands and retains sheet row number', () => {
  const rows = [[], ['CMD-1', '', '', '', 'MESSAGE', 'hello', '', '', 'PENDING'], ['CMD-2', '', '', '', 'MESSAGE', 'done', '', '', 'COMPLETED']];
  assert.deepEqual(pendingCommands(rows).map(item => item.rowNumber), [3]);
});

test('builds an authenticated command prompt', () => {
  const row = ['CMD-1', 'Ideas', 'PLAN-1', '', 'REVIEW', 'Review current work'];
  assert.match(commandPrompt(row), /Planning reference: Ideas \/ PLAN-1/);
  assert.match(commandPrompt(row), /Review current work/);
});

test('rejects empty command messages', () => {
  assert.throws(() => commandPrompt(['CMD-1', '', '', '', 'MESSAGE', '']), /empty/);
});
