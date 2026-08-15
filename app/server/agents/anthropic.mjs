// Anthropic Messages API adapter.
//
// This uses the built-in fetch rather than @anthropic-ai/sdk because PRODUCT.md
// records a dependency-light architecture on the Node HTTP surface; adding a
// runtime dependency is an owner decision, not an implementation detail.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-5';
const REQUEST_TIMEOUT_MS = 180_000;

const PLANNING_INSTRUCTIONS = [
  'You are a planning participant inside Andamento.',
  'Respond with concise recommendations, risks, assumptions, and alternatives for the owner to decide.',
  'Discussion and agent agreement are never authorization.',
  'Do not modify files, invoke tools, or claim approval.',
  'Preserve material dissent and state uncertainty plainly.',
].join(' ');

function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Provider errors are mapped to a fixed set of codes so no provider text or
// credential material can reach a durable record, a log, or the browser.
function mapStatus(status) {
  if (status === 401 || status === 403) return 'CLAUDE_AUTH';
  if (status === 429) return 'CLAUDE_RATE_LIMITED';
  if (status === 413) return 'CLAUDE_REQUEST_TOO_LARGE';
  if (status === 529 || status >= 500) return 'CLAUDE_UNAVAILABLE';
  return 'CLAUDE_FAILURE';
}

export class AnthropicPlanningAgent {
  constructor({ apiKey = '', model = DEFAULT_MODEL, maxTokens = 16_000 } = {}) {
    this.id = 'claude';
    this.provider = 'anthropic';
    this.model = model || DEFAULT_MODEL;
    this.displayName = 'Claude';
    this.maxTokens = maxTokens;
    this.apiKey = apiKey;
  }

  configured() {
    return Boolean(this.apiKey);
  }

  async available() {
    // A live probe would spend the owner's credit on every bootstrap, so
    // availability means "a credential is configured", not "the API answered".
    return this.configured();
  }

  async contribute({ prompt, signal }) {
    if (!this.configured()) {
      throw failure('No Anthropic credential is configured.', 'CLAUDE_NOT_CONFIGURED');
    }
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener('abort', relayAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: PLANNING_INSTRUCTIONS,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw failure('The Claude contribution was cancelled.', 'CANCELLED');
      throw failure('Claude could not be reached.', 'CLAUDE_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', relayAbort);
    }

    if (!response.ok) {
      throw failure(`Claude refused the request with status ${response.status}.`, mapStatus(response.status));
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw failure('Claude returned an unreadable response.', 'CLAUDE_MALFORMED');
    }

    // Check stop_reason before reading content: a refusal can return HTTP 200
    // with an empty content array.
    if (payload.stop_reason === 'refusal') {
      throw failure('Claude declined this request.', 'CLAUDE_REFUSED');
    }
    const content = (payload.content || [])
      .filter(block => block?.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();
    if (!content) {
      throw failure('Claude returned an empty contribution.', 'CLAUDE_MALFORMED');
    }
    if (payload.stop_reason === 'max_tokens') {
      return {
        provider: this.provider,
        model: payload.model || this.model,
        content: `${content}\n\n[This contribution reached the response limit and may be incomplete.]`,
      };
    }
    return { provider: this.provider, model: payload.model || this.model, content };
  }
}
