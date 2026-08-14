import { setTimeout as delay } from 'node:timers/promises';

export class DeterministicPlanningAgent {
  constructor() {
    this.id = 'deterministic';
    this.provider = 'deterministic';
    this.model = 'planning-test-v1';
    this.displayName = 'Test planning agent';
  }

  async contribute({ prompt, retryOfRunId, signal }) {
    const wait = /\[slow\]/i.test(prompt) ? 850 : 120;
    await delay(wait, undefined, { signal });
    if (/\[fail-once\]/i.test(prompt) && !retryOfRunId) {
      const error = new Error('The deterministic participant failed for this first attempt.');
      error.code = 'DETERMINISTIC_FAILURE';
      throw error;
    }
    if (/\[malformed\]/i.test(prompt)) {
      const error = new Error('The participant returned an unusable contribution.');
      error.code = 'MALFORMED_CONTRIBUTION';
      throw error;
    }
    return {
      provider: this.provider,
      model: this.model,
      content: `Recommendation: keep the owner approval boundary explicit for “${prompt.replace(/\[(?:slow|fail-once|malformed)\]/gi, '').trim()}”. Preserve source attribution, validate stale writes, and make retries idempotent.`,
    };
  }
}
