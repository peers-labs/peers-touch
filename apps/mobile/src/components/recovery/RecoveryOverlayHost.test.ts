import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./RecoveryOverlayHost.tsx', import.meta.url),
  'utf8',
);

describe('RecoveryOverlayHost hook ordering', () => {
  it('runs every hook before the fixture-only conditional returns', () => {
    // A conditional return placed before a hook violates the Rules of Hooks:
    // switching into the recovery.session-valid-restore fixture changed the
    // hook count and crashed the overlay, so the inventory surface never
    // rendered. All hooks must precede every conditional return.
    const lines = source.split('\n');
    const hookPattern =
      /\buse(Effect|State|Memo|SyncExternalStore|MobileI18n|LifecycleKernel|MobileNavigationStore|RecoverySurfaceFixture)\b/;
    const restoreReturnIndex = lines.findIndex((line) =>
      line.includes(
        "if (fixture.surfaceId === 'recovery.session-valid-restore')",
      ),
    );
    const emptyReturnIndex = lines.findIndex((line) =>
      line.includes('if (visibleStates.length === 0) return null'),
    );

    expect(restoreReturnIndex).toBeGreaterThan(-1);
    expect(emptyReturnIndex).toBeGreaterThan(restoreReturnIndex);

    const firstConditionalReturn = restoreReturnIndex;
    const hooksAfterReturn = lines
      .slice(firstConditionalReturn)
      .some((line) => hookPattern.test(line));

    expect(hooksAfterReturn).toBe(false);
  });

  it('still renders the session restore notice from the fixture branch', () => {
    expect(source).toContain('<SessionRestoreNotice');
    const notice = readFileSync(
      new URL('./SessionRestoreNotice.tsx', import.meta.url),
      'utf8',
    );
    expect(notice).toContain(
      'data-product-surface="recovery.session-valid-restore"',
    );
  });
});
