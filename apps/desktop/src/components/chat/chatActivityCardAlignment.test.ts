// Source-contract: the service activity card follows the north-star
// ActivityCard — running state spins a Loader2 glyph, and known-history
// conflict/history-only notes are revealed only while expanded.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const card = readFileSync(
  new URL('./message/ServiceMessageCard.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

describe('activity card running glyph (north-star ActivityCard parity)', () => {
  it('uses a spinning Loader2 for running, not a static clock glyph', () => {
    expect(card).toContain('Loader2');
    expect(card).not.toContain('Clock3');
    expect(card).toContain(
      "<Glyph size={16} className={running ? 'sc-activity__spinning' : undefined} />",
    );
    expect(chatCss).toMatch(/\.sc-activity__spinning\s*\{[^}]*animation:[^}]*\}/);
  });
});

describe('activity known-history notes', () => {
  it('renders conflict and history-only notes only when the roll-up is expanded', () => {
    expect(card).toContain('aggregation?.expanded && aggregation.conflicting');
    expect(card).toContain('aggregation?.expanded && aggregation.knownHistoryOnly');
  });
});
