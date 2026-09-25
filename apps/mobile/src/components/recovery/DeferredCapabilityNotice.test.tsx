import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RuntimeBootstrapStatus } from '../../app/lifecycle/types';
import { DeferredCapabilityNotice } from './DeferredCapabilityNotice';

function render(status: RuntimeBootstrapStatus, canRetry = true) {
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
});
