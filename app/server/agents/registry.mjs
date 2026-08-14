import { CodexPlanningAgent } from './codex.mjs';
import { DeterministicPlanningAgent } from './deterministic.mjs';
import { capabilityUnavailable } from '../domain/errors.mjs';

export function createAgentRegistry({ codexUrl, enableDeterministic = false }) {
  const codex = new CodexPlanningAgent({ url: codexUrl });
  const deterministic = new DeterministicPlanningAgent();

  return {
    get(adapter) {
      if (adapter === 'codex') return codex;
      if (adapter === 'deterministic' && enableDeterministic) return deterministic;
      throw capabilityUnavailable(`The ${adapter} participant is not configured.`, { adapter });
    },

    async capabilities() {
      const codexAvailable = await codex.available().catch(() => false);
      return {
        codex: {
          available: codexAvailable,
          label: 'Codex',
          provider: codex.provider,
          reason: codexAvailable ? '' : 'The local Codex bridge is not available. You can keep planning and import another agent contribution.',
        },
        deterministic: {
          available: enableDeterministic,
          label: 'Deterministic test participant',
          provider: deterministic.provider,
          reason: enableDeterministic ? '' : 'Available only in the local test harness.',
        },
        imported: {
          available: true,
          label: 'Imported contribution',
          provider: 'external',
          reason: '',
        },
      };
    },
  };
}
