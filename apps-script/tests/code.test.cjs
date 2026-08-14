const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const context = vm.createContext({
  console,
  Object,
  Set,
  Date,
  Number,
  String,
  Boolean,
  Math,
});
vm.runInContext(source, context);

test('normalizes valid idempotency keys', () => {
  assert.equal(
    context.normalizeIdempotencyKey_('550e8400-e29b-41d4-a716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000'
  );
});

test('rejects short idempotency keys', () => {
  assert.throws(() => context.normalizeIdempotencyKey_('short'), /Invalid command/);
});

test('escapes formula-like spreadsheet values', () => {
  assert.equal(context.escapeForSheet_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(context.escapeForSheet_('+1'), "'+1");
  assert.equal(context.escapeForSheet_('normal text'), 'normal text');
});

test('requires a message for MESSAGE commands', () => {
  assert.throws(
    () => context.buildMessage_('MESSAGE', 'Slice 7', 'S7-PLN-01', ''),
    /follow-up/
  );
});

test('builds an explicit approval message', () => {
  assert.match(
    context.buildMessage_('CONTINUE', 'Slice 7', 'S7-PLN-01', ''),
    /explicitly approved/
  );
});

test('finds established workbook id columns', () => {
  assert.equal(context.findIdColumn_(['decision id', 'area']), 0);
  assert.equal(context.findIdColumn_(['milestone', 'name']), 0);
  assert.equal(context.findIdColumn_(['other', 'backlog id']), 1);
});
