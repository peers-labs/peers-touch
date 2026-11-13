// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { UIProvider } from '@peers-touch/ui';
import { create } from '@bufbuild/protobuf';
import { ReactionSummarySchema } from '../../../gen/proto/domain/social/post_pb';
import { ReactionKind } from '../../../gen/proto/domain/social/post_pb';
import type { PrivateReactionStatusProjection } from '../../../store/privateMoments';
import { SocialActionBar } from './SocialActionBar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('keeps a ballot separate and preserves concurrent per-kind reaction status and retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const react = vi.fn(), retry = vi.fn();
  const command = (kind: ReactionKind, state: PrivateReactionStatusProjection['state'],
    operation: PrivateReactionStatusProjection['operation'] = 'REACT'): PrivateReactionStatusProjection => ({
    postId: 'post', commentId: '', kind, state, operation, attemptCount: 1, projectionRevision: '1',
  });
  try {
    await act(async () => root.render(<UIProvider><SocialActionBar postId="post" commentsOpen={false}
      reactionCommands={[
        command(ReactionKind.REACTION_UNSPECIFIED, 'REACTION_PENDING', 'VOTE_POLL'),
        command(ReactionKind.REACTION_LIKE, 'REACTION_PENDING'),
        command(ReactionKind.REACTION_LOVE, 'REACTION_REJECTED'),
      ]} onReact={react} onRetryReaction={retry} onOpenComments={() => {}} /></UIProvider>));
    const statuses = [...host.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(2);
    expect(statuses[0].textContent).toContain('REACTION_PENDING');
    expect(statuses[1].textContent).toContain('REACTION_REJECTED');
    const retryButton = statuses[1].querySelector('button')!;
    await act(async () => retryButton.click());
    expect(retry).toHaveBeenCalledExactlyOnceWith(ReactionKind.REACTION_LOVE);
    // Replace the pending LIKE cell with just the ballot: LIKE must remain
    // available, and the ballot must never appear as a reaction notice.
    await act(async () => root.render(<UIProvider><SocialActionBar postId="post" commentsOpen={false}
      reactions={[create(ReactionSummarySchema, { kind: ReactionKind.REACTION_LIKE, count: 1n })]}
      reactionCommands={[command(ReactionKind.REACTION_UNSPECIFIED, 'REACTION_PENDING', 'VOTE_POLL')]}
      onReact={react} onOpenComments={() => {}} /></UIProvider>));
    expect(host.querySelector('[role="status"]')).toBeNull();
    const like = host.querySelector<HTMLButtonElement>(`[data-action-id="moment.reaction-chip.post.${ReactionKind.REACTION_LIKE}"]`);
    expect(like).not.toBeNull();
    expect(like!.disabled).toBe(false);
    await act(async () => like!.click());
    expect(react).toHaveBeenCalledWith(ReactionKind.REACTION_LIKE, expect.any(String));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
