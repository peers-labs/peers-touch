import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

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

  it('lets maximum-text confirmation actions grow without clipping', () => {
    const buttonRule = styles.match(
      /\.entry-confirmation-button\s*\{[^}]*\}/,
    )?.[0];

    expect(buttonRule).toContain('min-height: 44px');
    expect(buttonRule).not.toMatch(/\n\s*height:\s*44px/);
    expect(buttonRule).toContain('overflow-wrap: anywhere');
  });

  it('delegates Shell admission to lifecycle readiness reconciliation', () => {
    expect(source).toContain(
      "reconcileLaunchState('access-granted')",
    );
    expect(source).not.toContain("transitionLaunchState('shell')");
  });

  it('fences a late access attempt after returning to Station selection', () => {
    expect(source).toContain('const accessGateStartRevisionRef = useRef(0)');
    expect(source).toContain(
      'const requestRevision = ++accessGateStartRevisionRef.current',
    );
    expect(source).toMatch(
      /requestRevision !== accessGateStartRevisionRef\.current[\s\S]*kernel\.getState\(\)\.launchState !== 'station-handshake'/,
    );
    expect(source).toMatch(
      /function showStationSelection\(\)[\s\S]*accessGateStartRevisionRef\.current \+= 1/,
    );
  });

  it('keeps the Shell mounted while native system surfaces background the app', () => {
    expect(source).toContain(
      "renderedLaunchState === 'background'",
    );
    expect(source).toMatch(
      /renderedLaunchState === 'shell'[\s\S]*renderedLaunchState === 'background'[\s\S]*renderedLaunchState === 'resume'[\s\S]*<MobileShell/,
    );
  });
});
