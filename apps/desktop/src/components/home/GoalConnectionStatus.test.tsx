import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./GoalConnectionStatus.tsx', import.meta.url)),
  'utf8',
);

describe('GoalConnectionStatus', () => {
  it('renders every Home connection state from the runtime store', () => {
    for (const state of [
      'fresh',
      'reconnecting',
      'resyncing',
      'stale',
      'unauthorized',
    ]) {
      expect(source).toContain(state);
    }
    expect(source).toContain('data-pt-home-connection-state');
  });

  it('only exposes retry when the runtime marks the failure retryable', () => {
    expect(source).toContain('const retry = retryable ?');
    expect(source).toContain('data-pt-home-connection-retry');
    expect(source).toContain('refreshHomeProjection()');
  });
});
