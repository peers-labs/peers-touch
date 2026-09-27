import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('Mobile App Station identity replacement', () => {
  it('requires destructive confirmation before replacing a saved identity', () => {
    expect(source).toContain('Modal.confirm({');
    expect(source).toContain("title: t('mobile.launch.stationReplaceConfirmTitle')");
    expect(source).toContain("okText: t('mobile.launch.stationReplace')");
    expect(source).toContain('okButtonProps: { danger: true }');
    expect(source).toContain('onOk: () => resolve(true)');
    expect(source).toContain('onCancel: () => resolve(false)');
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
