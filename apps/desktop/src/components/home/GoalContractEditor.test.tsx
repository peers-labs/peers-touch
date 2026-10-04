import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./GoalContractEditor.tsx', import.meta.url)),
  'utf8',
);

describe('GoalContractEditor contract', () => {
  it('renders every durable Goal contract field from the dedicated store', () => {
    expect(source).not.toContain('useState');
    for (const field of [
      'state.outcome',
      'state.nonGoals',
      'state.constraints',
      'state.budget',
      'state.acceptanceCriteria',
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain('useGoalDraftStore');
    expect(source).toContain('updateHomeGoalContract');
    expect(source).toContain('reviewHomeGoalContract');
  });

  it('exposes exact review, conflict recovery, and terminal authorization states', () => {
    for (const selector of [
      'data-pt-home-goal-review-revision',
      'data-pt-home-goal-conflict',
      'data-pt-home-goal-conflict-reload',
      'data-pt-home-goal-forbidden',
      'data-pt-home-goal-update',
      'data-pt-home-goal-review',
    ]) {
      expect(source).toContain(selector);
    }
    expect(source).toContain('reloadHomeGoalContract');
    expect(source).toContain("mutationState === 'forbidden'");
  });
});
