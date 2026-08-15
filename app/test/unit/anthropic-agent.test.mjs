import assert from 'node:assert/strict';
import test from 'node:test';

import { AnthropicPlanningAgent } from '../../server/agents/anthropic.mjs';

function stubFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('an unconfigured Claude adapter is unavailable and refuses before any request', async t => {
  const agent = new AnthropicPlanningAgent();
  let called = false;
  stubFetch(t, async () => { called = true; return jsonResponse({}); });

  assert.equal(agent.configured(), false);
  assert.equal(await agent.available(), false);
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_NOT_CONFIGURED');
      return true;
    },
  );
  assert.equal(called, false, 'no network call is made without a credential');
});

test('a configured contribution sends the documented request shape and returns text', async t => {
  const agent = new AnthropicPlanningAgent({ apiKey: 'sk-ant-test', model: 'claude-opus-5' });
  let seen = null;
  stubFetch(t, async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return jsonResponse({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Challenge the approval boundary.' },
      ],
    });
  });

  const result = await agent.contribute({ prompt: 'Review this package.' });
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.model, 'claude-opus-5');
  assert.equal(result.content, 'Challenge the approval boundary.');

  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(seen.body.model, 'claude-opus-5');
  assert.equal(typeof seen.body.max_tokens, 'number');
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'Review this package.' }]);
  assert.match(seen.body.system, /never authorization/i);
  // Parameters that return 400 on current models must never be sent.
  for (const removed of ['temperature', 'top_p', 'top_k', 'thinking']) {
    assert.equal(Object.hasOwn(seen.body, removed), false, `${removed} must not be sent`);
  }
  // The last turn must not be an assistant prefill.
  assert.equal(seen.body.messages.at(-1).role, 'user');
});

test('a refusal is detected from stop_reason rather than from empty content', async t => {
  const agent = new AnthropicPlanningAgent({ apiKey: 'sk-ant-test' });
  stubFetch(t, async () => jsonResponse({ stop_reason: 'refusal', content: [] }));
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_REFUSED');
      return true;
    },
  );
});

test('a truncated contribution is returned and marked rather than silently trimmed', async t => {
  const agent = new AnthropicPlanningAgent({ apiKey: 'sk-ant-test' });
  stubFetch(t, async () => jsonResponse({
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: 'Partial reasoning' }],
  }));
  const result = await agent.contribute({ prompt: 'anything' });
  assert.match(result.content, /^Partial reasoning/);
  assert.match(result.content, /may be incomplete/i);
});

test('provider failures map to safe codes and never echo provider or credential text', async t => {
  const cases = [
    [401, 'CLAUDE_AUTH'],
    [403, 'CLAUDE_AUTH'],
    [429, 'CLAUDE_RATE_LIMITED'],
    [413, 'CLAUDE_REQUEST_TOO_LARGE'],
    [500, 'CLAUDE_UNAVAILABLE'],
    [529, 'CLAUDE_UNAVAILABLE'],
    [400, 'CLAUDE_FAILURE'],
  ];
  for (const [status, code] of cases) {
    const agent = new AnthropicPlanningAgent({ apiKey: 'sk-ant-secret-value' });
    stubFetch(t, async () => ({
      ok: false,
      status,
      json: async () => ({ error: { message: 'sk-ant-secret-value leaked detail' } }),
    }));
    await assert.rejects(
      () => agent.contribute({ prompt: 'anything' }),
      error => {
        assert.equal(error.code, code, `status ${status}`);
        assert.doesNotMatch(error.message, /sk-ant/, 'no credential material in the message');
        assert.doesNotMatch(error.message, /leaked detail/, 'no provider text in the message');
        return true;
      },
    );
  }
});

test('a transport failure and a cancellation are distinguished', async t => {
  const agent = new AnthropicPlanningAgent({ apiKey: 'sk-ant-test' });
  stubFetch(t, async () => { throw new Error('socket hang up'); });
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_UNAVAILABLE');
      assert.doesNotMatch(error.message, /socket hang up/);
      return true;
    },
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything', signal: controller.signal }),
    error => {
      assert.equal(error.code, 'CANCELLED');
      return true;
    },
  );
});

test('an unreadable or textless response is refused rather than stored', async t => {
  const agent = new AnthropicPlanningAgent({ apiKey: 'sk-ant-test' });
  stubFetch(t, async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_MALFORMED');
      return true;
    },
  );

  stubFetch(t, async () => jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }));
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_MALFORMED');
      return true;
    },
  );
});
