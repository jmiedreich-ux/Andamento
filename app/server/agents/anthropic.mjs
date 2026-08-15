import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';

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
function mapError(error) {
  if (error instanceof APIUserAbortError) {
    return failure('The Claude contribution was cancelled.', 'CANCELLED');
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return failure('The Anthropic credential was refused.', 'CLAUDE_AUTH');
  }
  if (error instanceof RateLimitError) {
    return failure('Claude is rate limited.', 'CLAUDE_RATE_LIMITED');
  }
  if (error instanceof APIConnectionError) {
    return failure('Claude could not be reached.', 'CLAUDE_UNAVAILABLE');
  }
  if (error instanceof APIError) {
    const status = Number(error.status) || 0;
    if (status === 413) return failure('That request was too large for Claude.', 'CLAUDE_REQUEST_TOO_LARGE');
    if (status >= 500) return failure('Claude is unavailable.', 'CLAUDE_UNAVAILABLE');
    return failure(`Claude refused the request with status ${status}.`, 'CLAUDE_FAILURE');
  }
  return failure('Claude could not complete this contribution.', 'CLAUDE_FAILURE');
}

export class AnthropicPlanningAgent {
  constructor({ apiKey = '', model = DEFAULT_MODEL, maxTokens = 16_000, client = null } = {}) {
    this.id = 'claude';
    this.provider = 'anthropic';
    this.model = model || DEFAULT_MODEL;
    this.displayName = 'Claude';
    this.maxTokens = maxTokens;
    this.apiKey = apiKey;
    // Injectable so tests exercise this adapter without a network call.
    this.client = client || (apiKey
      ? new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 })
      : null);
  }

  configured() {
    return Boolean(this.client);
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
    let message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: PLANNING_INSTRUCTIONS,
        messages: [{ role: 'user', content: prompt }],
      }, { signal });
    } catch (error) {
      if (signal?.aborted) throw failure('The Claude contribution was cancelled.', 'CANCELLED');
      throw mapError(error);
    }

    // Check stop_reason before reading content: a refusal returns a successful
    // response whose content array is empty.
    if (message.stop_reason === 'refusal') {
      throw failure('Claude declined this request.', 'CLAUDE_REFUSED');
    }
    const content = (message.content || [])
      .filter(block => block?.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();
    if (!content) {
      throw failure('Claude returned an empty contribution.', 'CLAUDE_MALFORMED');
    }
    if (message.stop_reason === 'max_tokens') {
      return {
        provider: this.provider,
        model: message.model || this.model,
        content: `${content}\n\n[This contribution reached the response limit and may be incomplete.]`,
      };
    }
    return { provider: this.provider, model: message.model || this.model, content };
  }
}
