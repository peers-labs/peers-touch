import { describe, expect, it } from 'vitest';

import { lifecycleNeedsSessionRevalidation } from './useAppLifecycle';

describe('desktop app lifecycle auth gate', () => {
  it('revalidates only when the ready shell loses its session mirror', () => {
    expect(lifecycleNeedsSessionRevalidation('ready', false)).toBe(true);
    expect(lifecycleNeedsSessionRevalidation('ready', true)).toBe(false);
    expect(lifecycleNeedsSessionRevalidation('resuming', false)).toBe(false);
    expect(lifecycleNeedsSessionRevalidation('onboarding', false)).toBe(false);
  });
});
