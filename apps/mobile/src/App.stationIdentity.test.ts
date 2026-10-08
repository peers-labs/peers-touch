import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('Mobile App Station identity replacement', () => {
  it('requires destructive confirmation before replacing a saved identity', () => {
    expect(source).toContain('setPendingIdentityReplacement({');
    expect(source).toContain("t('mobile.launch.stationReplaceConfirmTitle')");
    expect(source).toContain("t('mobile.launch.stationReplace')");
    expect(source).toContain('data-product-surface="entry.station-identity-mismatch"');
    expect(source).toContain('resolveStationIdentityReplacement(true)');
    expect(source).toContain('resolveStationIdentityReplacement(false)');
  });

  it('guards both add and continue replacement paths with that confirmation', () => {
    const confirmations = source.match(
      /await confirmStationIdentityReplacement\(/g,
    );
    const replacements = source.match(/replaceStationEntryIdentity\(/g);

    expect(confirmations).toHaveLength(2);
    expect(replacements).toHaveLength(2);
  });

  it('delegates Shell admission to lifecycle readiness reconciliation', () => {
    expect(source).toContain(
      "reconcileLaunchState('access-granted')",
    );
    expect(source).not.toContain("transitionLaunchState('shell')");
  });
});
