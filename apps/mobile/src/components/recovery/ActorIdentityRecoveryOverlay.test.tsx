import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActorIdentityRecoveryOverlay } from './ActorIdentityRecoveryOverlay';

const baseProps = {
  t: (key: string) => key,
  onRecover: vi.fn(),
  onSwitchStation: vi.fn(),
};

describe('ActorIdentityRecoveryOverlay', () => {
  it('exposes only the native recovery intent and never renders secret input', () => {
    const markup = renderToStaticMarkup(
      <ActorIdentityRecoveryOverlay
        {...baseProps}
        backupAvailable
        backupChecking={false}
        backupCheckError={false}
      />,
    );

    expect(markup).toContain('data-product-surface="messaging.actor-identity-recovery"');
    expect(markup).toContain('data-acceptance-id="recovery-actor-identity-submit"');
    expect(markup).toContain('mobile.recovery.actorIdentity.secureInput');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<textarea');
  });

  it('shows the checking state and disables recovery while the backup check runs', () => {
    const markup = renderToStaticMarkup(
      <ActorIdentityRecoveryOverlay
        {...baseProps}
        backupAvailable={null}
        backupChecking
        backupCheckError={false}
      />,
    );

    expect(markup).toContain('mobile.recovery.actorIdentity.checking');
    expect(markup).toContain('data-recovery-backup-state="checking"');
    expect(markup).toMatch(/data-acceptance-id="recovery-actor-identity-submit"[\s\S]*disabled/);
  });

  it('hides the phrase path entirely when no recovery backup exists', () => {
    const markup = renderToStaticMarkup(
      <ActorIdentityRecoveryOverlay
        {...baseProps}
        backupAvailable={false}
        backupChecking={false}
        backupCheckError={false}
      />,
    );

    expect(markup).toContain('data-recovery-backup-state="absent"');
    expect(markup).toContain('mobile.recovery.actorIdentity.noBackup');
    expect(markup).not.toContain('mobile.recovery.actorIdentity.secureInput');
    expect(markup).not.toContain('data-acceptance-id="recovery-actor-identity-submit"');
    expect(markup).toContain('mobile.recovery.actorIdentity.switchStation');
  });

  it('fails open to the phrase path when the backup check errors', () => {
    const markup = renderToStaticMarkup(
      <ActorIdentityRecoveryOverlay
        {...baseProps}
        backupAvailable={null}
        backupChecking={false}
        backupCheckError
      />,
    );

    expect(markup).toContain('data-recovery-backup-state="error"');
    expect(markup).toContain('data-acceptance-id="recovery-actor-identity-submit"');
  });
});
