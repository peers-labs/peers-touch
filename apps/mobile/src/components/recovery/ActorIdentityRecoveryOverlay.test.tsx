import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActorIdentityRecoveryOverlay } from './ActorIdentityRecoveryOverlay';

describe('ActorIdentityRecoveryOverlay', () => {
  it('exposes only the native recovery intent and never renders secret input', () => {
    const markup = renderToStaticMarkup(
      <ActorIdentityRecoveryOverlay
        t={(key) => key}
        onRecover={vi.fn()}
        onSwitchStation={vi.fn()}
      />,
    );

    expect(markup).toContain('data-product-surface="messaging.actor-identity-recovery"');
    expect(markup).toContain('data-acceptance-id="recovery-actor-identity-submit"');
    expect(markup).toContain('mobile.recovery.actorIdentity.secureInput');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<textarea');
  });
});
