export const SUGGESTION_INSTRUCTIONS = [
  'You are proposing candidate planning points from one contribution inside Andamento.',
  'A planning point is a single, decidable statement the owner could accept, reject, or defer.',
  'Return one candidate per line and nothing else: no preamble, no numbering, no commentary.',
  'Each line is TYPE|text, where TYPE is one of',
  'QUESTION, DECISION, REQUIREMENT, CONSTRAINT, RISK, DEPENDENCY, ASSUMPTION, PROPOSED_WORK, PARKING_LOT.',
  'Propose only what the contribution actually supports. Return nothing rather than inventing points.',
  'You are proposing, never deciding: the owner disposes of every candidate.',
].join(' ');

const POINT_TYPES = new Set([
  'QUESTION', 'DECISION', 'REQUIREMENT', 'CONSTRAINT', 'RISK',
  'DEPENDENCY', 'ASSUMPTION', 'PROPOSED_WORK', 'PARKING_LOT',
]);
const MAX_SUGGESTIONS = 12;
const MAX_TEXT = 2000;

export function buildSuggestionPrompt(content) {
  return `Contribution to read:\n\n${content}`;
}

// Parses the agent's lines defensively: an unrecognised type falls back to a
// proposal rather than being discarded, and anything unusable is dropped.
export function parseSuggestions(text) {
  const seen = new Set();
  const suggestions = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '');
    if (!line) continue;
    // Only an all-caps token is treated as a type label, so ordinary prose that
    // happens to contain a colon keeps its full text.
    const separated = line.match(/^([A-Z][A-Z_]{2,23})\s*[|:]\s*(.+)$/);
    let pointType = 'PROPOSED_WORK';
    let body = line;
    if (separated) {
      const candidateType = separated[1].trim();
      body = separated[2].trim();
      if (POINT_TYPES.has(candidateType)) pointType = candidateType;
    }
    body = body.trim();
    if (body.length < 8) continue;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ pointType, text: body.slice(0, MAX_TEXT) });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
