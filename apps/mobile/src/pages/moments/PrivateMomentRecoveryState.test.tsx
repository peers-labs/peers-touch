import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { PrivateMomentReadProjection } from '../../services/mobileCommands';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

import { PrivateMomentRecoveryState } from './PrivateMomentRecoveryState';

const baseProjection: Omit<PrivateMomentReadProjection, 'state'> = {
  postId: 'post-private-1',
  contentId: 'unavailable:post-private-1',
  generation: '0',
  authorPtid: '',
  audienceKind: 'UNKNOWN',
  mentions: [],
  reactions: [],
  reactionRevision: '0',
  reactionsHydrated: false,
};

describe('PrivateMomentRecoveryState', () => {
  it('keeps the exact post identity and exposes only native recovery intent', () => {
    const markup = renderToStaticMarkup(
      <PrivateMomentRecoveryState
        projection={{ ...baseProjection, state: 'RECOVERY_REQUIRED' }}
        busy={false}
        error={false}
        onBack={vi.fn()}
        onRecover={vi.fn()}
        onRetryVerification={vi.fn()}
      />,
    );

    expect(markup).toContain('data-private-moment-post-id="post-private-1"');
    expect(markup).toContain('mobile.moments.private.recovery.action');
    expect(markup).not.toMatch(/input|phrase|secret|handle/i);
  });

  it('keeps integrity failure separate from recovery', () => {
    const markup = renderToStaticMarkup(
      <PrivateMomentRecoveryState
        projection={{ ...baseProjection, state: 'INTEGRITY_FAILURE' }}
        busy={false}
        error={false}
        onBack={vi.fn()}
        onRecover={vi.fn()}
        onRetryVerification={vi.fn()}
      />,
    );

    expect(markup).toContain('mobile.moments.private.integrity.retry');
    expect(markup).not.toContain('mobile.moments.private.recovery.action');
  });

  it('renders revocation as terminal without a hidden retry path', () => {
    const markup = renderToStaticMarkup(
      <PrivateMomentRecoveryState
        projection={{
          ...baseProjection,
          state: 'DELETED_OR_REVOKED',
          errorCode: 'RECIPIENT_BLOCKED',
        }}
        busy={false}
        error={false}
        onBack={vi.fn()}
        onRecover={vi.fn()}
        onRetryVerification={vi.fn()}
      />,
    );

    expect(markup).toContain(
      'mobile.moments.private.revocation.RECIPIENT_BLOCKED.title',
    );
    expect(markup).toContain('mobile.moments.private.revocation.copyBoundary');
    expect(markup).not.toContain('mobile.moments.private.recovery.action');
    expect(markup).not.toContain('mobile.moments.private.integrity.retry');
  });
});
