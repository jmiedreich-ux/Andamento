import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';

import { AnthropicPlanningAgent } from '../../server/agents/anthropic.mjs';

// The SDK owns the wire shape (headers, version, retries); this adapter owns
// how a response or a failure becomes a durable planning record. These tests
// exercise the adapter against an injected client rather than the network.
function agentWith(create) {
  return new AnthropicPlanningAgent({
    apiKey: 'sk-ant-test',
    model: 'claude-opus-5',
    client: { messages: { create } },
  });
}

function statusError(status) {
  return new APIError(
    status,
    { error: { message: 'sk-ant-secret-value leaked detail' } },
    'sk-ant-secret-value leaked detail',
    new Headers(),
  );
}

test('an unconfigured Claude adapter is unavailable and refuses before any request', async () => {
  const agent = new AnthropicPlanningAgent();
  assert.equal(agent.configured(), false);
  assert.equal(await agent.available(), false);
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_NOT_CONFIGURED');
      return true;
    },
  );
});

test('a configured contribution sends the planning contract and returns attributed text', async () => {
  let seen = null;
  const agent = agentWith(async body => {
    seen = body;
    return {
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Challenge the approval boundary.' },
      ],
    };
  });

  const result = await agent.contribute({ prompt: 'Review this package.' });
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.model, 'claude-opus-5');
  assert.equal(result.content, 'Challenge the approval boundary.');

  assert.equal(seen.model, 'claude-opus-5');
  assert.equal(typeof seen.max_tokens, 'number');
  assert.deepEqual(seen.messages, [{ role: 'user', content: 'Review this package.' }]);
  assert.match(seen.system, /never authorization/i);
  // Parameters that return 400 on current models must never be sent.
  for (const removed of ['temperature', 'top_p', 'top_k', 'thinking']) {
    assert.equal(Object.hasOwn(seen, removed), false, `${removed} must not be sent`);
  }
  // The last turn must not be an assistant prefill.
  assert.equal(seen.messages.at(-1).role, 'user');
});

test('a refusal is detected from stop_reason rather than from empty content', async () => {
  const agent = agentWith(async () => ({ stop_reason: 'refusal', content: [] }));
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_REFUSED');
      return true;
    },
  );
});

test('a truncated contribution is returned and marked rather than silently trimmed', async () => {
  const agent = agentWith(async () => ({
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: 'Partial reasoning' }],
  }));
  const result = await agent.contribute({ prompt: 'anything' });
  assert.match(result.content, /^Partial reasoning/);
  assert.match(result.content, /may be incomplete/i);
});

test('typed SDK errors map to safe codes and never echo provider or credential text', async () => {
  const cases = [
    [new AuthenticationError(401, {}, 'sk-ant-secret-value', new Headers()), 'CLAUDE_AUTH'],
    [new PermissionDeniedError(403, {}, 'sk-ant-secret-value', new Headers()), 'CLAUDE_AUTH'],
    [new RateLimitError(429, {}, 'sk-ant-secret-value', new Headers()), 'CLAUDE_RATE_LIMITED'],
    [new APIConnectionError({ message: 'socket hang up' }), 'CLAUDE_UNAVAILABLE'],
    [statusError(413), 'CLAUDE_REQUEST_TOO_LARGE'],
    [statusError(500), 'CLAUDE_UNAVAILABLE'],
    [statusError(529), 'CLAUDE_UNAVAILABLE'],
    [statusError(400), 'CLAUDE_FAILURE'],
    [new Error('sk-ant-secret-value exploded'), 'CLAUDE_FAILURE'],
  ];
  for (const [thrown, code] of cases) {
    const agent = agentWith(async () => { throw thrown; });
    await assert.rejects(
      () => agent.contribute({ prompt: 'anything' }),
      error => {
        assert.equal(error.code, code, `${thrown.constructor.name}`);
        assert.doesNotMatch(error.message, /sk-ant/, 'no credential material in the message');
        assert.doesNotMatch(error.message, /leaked detail|socket hang up|exploded/, 'no provider text');
        return true;
      },
    );
  }
});

test('cancellation is distinguished from a provider failure', async () => {
  const controller = new AbortController();
  const agent = agentWith(async () => {
    controller.abort();
    throw new APIConnectionError({ message: 'aborted' });
  });
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything', signal: controller.signal }),
    error => {
      assert.equal(error.code, 'CANCELLED');
      return true;
    },
  );
});

test('a textless response is refused rather than stored', async () => {
  const agent = agentWith(async () => ({
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }],
  }));
  await assert.rejects(
    () => agent.contribute({ prompt: 'anything' }),
    error => {
      assert.equal(error.code, 'CLAUDE_MALFORMED');
      return true;
    },
  );
});
