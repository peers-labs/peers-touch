import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RuntimeBootstrapStatus } from '../../app/lifecycle/types';
import { DeferredCapabilityNotice } from './DeferredCapabilityNotice';

const styles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

function render(
  status: RuntimeBootstrapStatus,
  canRetry = true,
  compact = false,
) {
  return renderToStaticMarkup(
    <DeferredCapabilityNotice
      state={{
        kind: 'deferred-capability',
        unavailableRuntimes: [{
          runtimeId: 'social',
          title: 'Social Runtime',
          status,
          errorMessage: 'internal-only-error',
        }],
      }}
      t={(key) => key}
      canRetry={canRetry}
      compact={compact}
      onRetry={async () => undefined}
    />,
  );
}

describe('failed runtime recovery notice', () => {
  it('shows an actionable failure instead of an endless startup spinner', () => {
    const html = render('failed');
    expect(html).toContain('mobile.recovery.deferredCapability.failedTitle');
    expect(html).toContain('recovery-deferred-capability-retry');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('recovery-icon--spinning');
    expect(html).not.toContain('internal-only-error');
    expect(html).not.toContain('Social Runtime');
  });

  it('keeps in-progress bootstrap busy without admitting another restart', () => {
    const html = render('bootstrapping');
    expect(html).toContain('mobile.recovery.deferredCapability.title');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('recovery-deferred-capability-retry');
  });

  it('disables retry while the lifecycle owner is transitioning', () => {
    expect(render('failed', false)).toContain('disabled=""');
  });

  it('keeps shell degradation compact while retaining accessible detail', () => {
    const html = render('failed', true, true);
    expect(html).toContain('recovery-deferred-capability compact');
    expect(html).toContain('data-runtime-ids="social"');
    expect(html).toContain('aria-label="mobile.recovery.deferredCapability.failedTitle.');
    expect(html).not.toContain('<span class="recovery-notice__text">');
  });

  it('keeps compact recovery clear of centered actions in short landscape', () => {
    const marker =
      '/* Keep compact recovery clear of centered primary actions on short screens. */';
    const start = styles.indexOf(marker);
    const end = styles.indexOf(
      ".recovery-overlay-host:is(\n  [data-launch-state='shell'],",
      start + marker.length,
    );
    const contract = styles.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(contract).toContain(
      '@media (orientation: landscape) and (max-height: 500px)',
    );
    expect(contract).toContain('width: min(100%, 300px)');
    expect(contract).toContain('margin-inline: auto 0');
  });
});
