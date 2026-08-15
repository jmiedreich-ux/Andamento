import { setTimeout as delay } from 'node:timers/promises';

export class DeterministicPlanningAgent {
  constructor() {
    this.id = 'deterministic';
    this.provider = 'deterministic';
    this.model = 'planning-test-v1';
    this.displayName = 'Test planning agent';
  }

  async execute({ content, signal }) {
    const marker = `${content.outcome} ${(content.includedScope || []).join(' ')}`;
    await delay(/\[slow\]/i.test(marker) ? 850 : 120, undefined, { signal });
    if (/\[fail\]/i.test(marker)) {
      const error = new Error('The deterministic participant could not produce a change set.');
      error.code = 'DETERMINISTIC_FAILURE';
      throw error;
    }
    if (/\[malformed\]/i.test(marker)) {
      return { provider: this.provider, model: this.model, diff: 'this is not a diff at all' };
    }
    if (/\[escape\]/i.test(marker)) {
      return {
        provider: this.provider,
        model: this.model,
        diff: 'diff --git a/../outside.txt b/../outside.txt\n--- a/../outside.txt\n+++ b/../outside.txt\n@@ -0,0 +1 @@\n+escaped\n',
      };
    }
    if (/\[no-change\]/i.test(marker)) {
      return { provider: this.provider, model: this.model, diff: '' };
    }
    const body = [
      `# ${content.outcome}`,
      '',
      ...(content.includedScope || []).map((item, index) => `${index + 1}. ${item}`),
    ];
    return {
      provider: this.provider,
      model: this.model,
      diff: [
        'diff --git a/PLANNED_WORK.md b/PLANNED_WORK.md',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/PLANNED_WORK.md',
        `@@ -0,0 +1,${body.length} @@`,
        ...body.map(line => `+${line}`),
        '',
      ].join('\n'),
    };
  }

  async suggest({ content, signal }) {
    await delay(/\[slow\]/i.test(content) ? 850 : 60, undefined, { signal });
    if (/\[fail\]/i.test(content)) {
      const error = new Error('The deterministic participant could not read that contribution.');
      error.code = 'DETERMINISTIC_FAILURE';
      throw error;
    }
    if (/\[no-points\]/i.test(content)) {
      return { provider: this.provider, model: this.model, text: '' };
    }
    const sentences = String(content).split(/(?<=[.!?])\s+/)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length >= 12)
      .slice(0, 3);
    return {
      provider: this.provider,
      model: this.model,
      text: sentences.map((sentence, index) => (
        `${index === 0 ? 'REQUIREMENT' : index === 1 ? 'RISK' : 'QUESTION'}|${sentence.replace(/\s+/g, ' ')}`
      )).join('\n'),
    };
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
