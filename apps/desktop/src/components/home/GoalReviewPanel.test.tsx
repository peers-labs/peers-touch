import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./GoalReviewPanel.tsx', import.meta.url)),
  'utf8',
);

describe('GoalReviewPanel contract', () => {
  it('renders material assumptions before exposing Start', () => {
    for (const assumption of [
      'outcome',
      'non-goals',
      'constraints',
      'budget',
      'acceptance',
    ]) {
      expect(source).toContain(
        assumption === 'acceptance'
          ? 'data-pt-home-goal-assumption="acceptance"'
          : `selector="${assumption}"`,
      );
    }
    expect(source).toContain('data-pt-home-goal-start');
    expect(source).toContain('startHomeGoal');
  });

  it('exposes admitted, running, and actionable rejection states', () => {
    for (const selector of [
      'data-pt-home-goal-admission-error',
      'data-pt-home-goal-review-ready',
      'data-pt-home-goal-running',
      'data-pt-home-goal-conflict',
      'data-pt-home-goal-forbidden',
    ]) {
      expect(source).toContain(selector);
    }
    expect(source).toContain('admissionReasonKeys');
    expect(source).toContain('reloadHomeGoalContract');
  });
});
