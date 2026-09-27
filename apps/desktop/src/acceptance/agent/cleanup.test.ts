import { describe, expect, it, vi } from 'vitest';

import { runAcceptanceCleanupSteps } from './cleanup';

describe('runAcceptanceCleanupSteps', () => {
  it('runs every cleanup step and preserves failure order', async () => {
    const calls: string[] = [];
    const firstError = new Error('first failed');
    const thirdError = new Error('third failed');

    const failures = await runAcceptanceCleanupSteps([
      {
        name: 'first',
        run: vi.fn(async () => {
          calls.push('first');
          throw firstError;
        }),
      },
      {
        name: 'second',
        run: vi.fn(async () => {
          calls.push('second');
        }),
      },
      {
        name: 'third',
        run: vi.fn(async () => {
          calls.push('third');
          throw thirdError;
        }),
      },
    ]);

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(failures).toEqual([
      { name: 'first', error: firstError },
      { name: 'third', error: thirdError },
    ]);
  });
});
