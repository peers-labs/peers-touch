import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./GoalCancelControl.tsx', import.meta.url)),
  'utf8',
);

describe('GoalCancelControl contract', () => {
  it('limits this control to pre-execution Goal states', () => {
    for (const status of ['DRAFT', 'REVIEWING', 'READY']) {
      expect(source).toContain(`AgentGoalStatus.${status}`);
    }
    expect(source).not.toContain('AgentGoalStatus.RUNNING');
  });

  it('confirms the named Goal and preserves focus ownership', () => {
    expect(source).toContain('data-pt-home-goal-cancel-confirm');
    expect(source).toContain('data-pt-home-goal-cancel-dismiss');
    expect(source).toContain('goal.title');
    expect(source).toContain('focusTriggerAfterClose');
    expect(source).toContain('cancelledRef.current?.focus()');
  });

  it('waits for runtime cancellation and exposes retryable failure', () => {
    expect(source).toContain('await cancelHomeGoal()');
    expect(source).toContain("mutationState === 'cancelling'");
    expect(source).toContain("mutationState === 'cancel-failed'");
    expect(source).toContain('data-pt-home-goal-cancel-error');
    expect(source).toContain('data-pt-home-goal-cancel-reload');
    expect(source).toContain('data-pt-home-goal-cancelled');
  });
});
